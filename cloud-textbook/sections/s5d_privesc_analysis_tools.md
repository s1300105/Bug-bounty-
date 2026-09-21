## IAMグラフ分析・過剰権限検出ツール

IAM（Identity and Access Management、AWSにおけるアクセス制御の中核サービス）の設定は、ポリシー単体を目視で読んでいるだけでは全体像を把握できない。1つのアカウントに数百のIAMユーザー・ロール・ポリシーが存在し、それぞれが「ロールを引き受ける（AssumeRole）」「ポリシーをアタッチする」「インスタンスプロファイルを渡す」といった形で連鎖的に権限を渡し合っているため、ある principal（IAMユーザーやロールなど、権限が紐づく主体）が直接持つ権限だけでなく、間接的に到達できる権限まで含めて評価しないと、真の攻撃対象領域（attack surface）は見えてこない。本節では、この課題に取り組む3つの代表的なオープンソースツール — IAM関係をグラフとして解析するPMapper、ポリシーの過剰権限を静的スキャンするCloudsplaining、そして取得した認証情報をコンソールアクセスに変換するaws_consolerを扱う。いずれも防御側の監査・可視化を主目的として紹介するが、攻撃者が同じロジックで権限昇格経路を探索するため、守る側もその手法を理解しておく必要がある。

### PMapper（Principal Mapper）— IAMをグラフ化し権限昇格経路を発見する

#### 何を解決するツールか

PMapper（Principal Mapper）はNCC Groupが開発した、AWSアカウント（または AWS Organizations 全体）のIAM設定を有向グラフとしてモデル化し、権限昇格や意図しないアクセス経路を検出するためのPython製ツール/ライブラリである。README曰く、PMapperは「アカウント内のIAMユーザーとロールを有向グラフとしてモデル化し、権限昇格のチェックや、攻撃者がリソースへアクセスするために取りうる代替経路のチェックを可能にする」ツールである。

ここで重要なのは、PMapperが単なるポリシードキュメントの文字列解析ではなく、**「ある principal が別の principal を経由して間接的に権限へ到達できるか」**をシミュレートする点である。README中の具体例が分かりやすい。

> 「あるユーザーが S3 オブジェクトを直接読む権限を持っていなくても、その S3 オブジェクトを読む権限を持つ EC2 インスタンスを起動できる場合、PMapperのクエリエンジンはそれを検出する」

つまりPMapperは、IAMポリシーのAllow/Denyを評価するAWSの認可アルゴリズムをローカルでシミュレートし（「local simulation of AWS's authorization behavior」）、そのシミュレーション結果をノード（principal）とエッジ（「AがBの権限を掌握できる」という関係）から成るグラフの上で辿ることで、直接の権限評価では見えない到達可能性を明らかにする。エッジは例えば「`sts:AssumeRole` によるロール引き受け」「EC2インスタンスへのインスタンスプロファイルの付与とそこからのメタデータ窃取」「Lambda関数への実行ロールのアタッチ」のような、AWSの各種サービスが提供する「他の principal の権限を借用できる」機能に対応する（README本体には各エッジ種別の網羅的な一覧は記載されておらず、詳細はプロジェクトwikiのCore Conceptsページに委ねられている。取得を試みたがwikiの当該ページは内容を取得できなかった)。

#### 使い方とクエリ言語

PMapperの利用は大きく「グラフ作成」→「クエリ／可視化」の2段階に分かれる。

```bash
# アカウントの権限グラフを作成する（CLIプロファイル "skywalker" 経由でAPIを呼び出す）
pmapper --profile skywalker graph create

# 「iam:CreateUser を実行できるのは誰か」を問い合わせる
pmapper --profile skywalker query 'who can do iam:CreateUser'

# 条件付きクエリ: 高額なEC2インスタンスを起動できるのは誰か(管理者を除く)
pmapper --account 000000000000 argquery -s --action 'ec2:RunInstances' \
  --condition 'ec2:InstanceType=c6gd.16xlarge'

# 権限昇格のプリセットクエリを実行し、既存の管理者は除外して報告する
pmapper --account 000000000000 query -s 'preset privesc *'

# 管理者/権限昇格経路/principal間アクセスをSVGとして可視化する
pmapper --account 000000000000 visualize --filetype svg
```

`graph create` はboto3/botocoreを通じてIAM関連のAPI（ユーザー・ロール・ポリシー・グループの列挙など）を呼び出し、ローカルにグラフを構築する。以降の `query`／`argquery`／`visualize` はこのローカルグラフに対して動作するため、API呼び出しを繰り返さずに何度でも高速にクエリできるのが特徴であり、これは大規模アカウントや複数アカウントの定期監査に向く設計である。

`query -s 'preset privesc *'` は組み込みの権限昇格検出プリセットで、`-s`（`--skip-admin`のショートオプション）を付けると、すでに事実上の管理者権限を持つprincipalの分析結果を省き、「管理者ではないが権限昇格によって管理者相当になれる」principalだけを抽出できる。これはレポートのノイズを減らし、監査担当者が本当に修正すべき経路にフォーカスするために重要である。可視化コマンド `visualize` はGraphviz（`pydot`経由で利用、事前にOS側へのgraphvizインストールが必要）を用いてグラフをSVG等の画像として出力し、`--only-privesc` を付けると権限昇格に関わるノード・エッジのみを描画した図が得られ、監査レポートに添付するのに適している。

#### 前提条件

PMapperはPython 3.5以降と `botocore`、グラフ生成用の `pydot`／Graphviz本体を必要とする。AWS認証情報はAWS CLIと同様の仕組み（`--profile` オプションまたは環境変数）で渡す。Dockerイメージも提供されており、`docker run` 時に `-e`／`--env-file` で認証情報を渡すか、`~/.aws/` をボリュームマウントして `AWS_CONFIG_FILE` 等の環境変数で参照させる運用ができる。

#### 防御的な使い方

セキュリティチームがPMapperを使う典型的なワークフローは、(1) 定期的に `graph create` でスナップショットを取得し、(2) `query -s 'preset privesc *'` で新たに生まれた昇格経路がないかを差分監視し、(3) `visualize` で可視化した図を用いてIAM設計のレビュー会議で説明する、というものである。CI/CDパイプラインに組み込み、IaC（Infrastructure as Code）の変更がマージされる前に権限昇格経路の増加を検知するゲートとして使う事例も一般的である。

> 出典: Principal Mapper (PMapper) README — https://github.com/nccgroup/PMapper

> ⚠️ **未取得の資料**: PMapperのエッジ種別の網羅的な一覧・権限昇格プリセットの具体的な検出ロジック・クエリ出力の詳細フォーマットについては、プロジェクトwikiの「Core Concepts」「Query Reference」ページに記載されているが、自動取得ではページ内容（JavaScriptで動的に読み込まれる本文）を取得できなかった。詳細は以下から直接ご確認いただきたい: https://github.com/nccgroup/PMapper/wiki
>
> （以下は未取得資料の補足として一般知識に基づく解説です）PMapperが検出する典型的な権限昇格パターンには、`iam:CreatePolicyVersion`（既存の管理ポリシーに新しいデフォルトバージョンとして任意の権限を追加できる）、`iam:AttachUserPolicy` / `iam:AttachRolePolicy`（AdministratorAccessなど強力な管理ポリシーを自分自身にアタッチできる）、`iam:PassRole` と `lambda:CreateFunction` ＋ `lambda:InvokeFunction` の組み合わせ（強力なロールをLambda関数に渡し、そのロールの権限でコードを実行させる）、`ec2:RunInstances` と `iam:PassRole` の組み合わせ（強力なインスタンスプロファイルを付与したEC2インスタンスを起動し、インスタンスメタデータサービス経由で一時認証情報を窃取する）などがある。これらはRhino Security Labsが公開した「AWS IAM Privilege Escalation」の手法リストとおおむね一致し、PMapperのプリセットクエリはこの種の既知パターンをグラフ上のエッジ探索として実装していると考えられる。

### Cloudsplaining — IAMポリシーの過剰権限を静的スキャンで検出する

#### 目的とアプローチ

Cloudsplaining はSalesforceが開発したAWS IAMセキュリティ評価ツールで、「最小権限の原則（least privilege）の違反を特定し、リスクを優先順位付けしたHTMLレポートを生成する」ことを目的とする。PMapperが「principal間の到達可能性」というグラフ構造に着目するのに対し、Cloudsplainingは「個々のIAMポリシーが、リソースを制限せずに危険なアクションを許可していないか」という**ポリシー単体の静的解析**に焦点を当てる、相補的なツールである。

Cloudsplainingの前身であるPolicy Sentryが明らかにしたのは、「リソースARNを制限しないIAMポリシー」を書くのは技術的には容易であり、既存環境にはそのような設計負債が大量に蓄積しているという問題意識である。以下は README が挙げる典型的な「悪い」ポリシーの例である。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "*"
    }
  ]
}
```

`Resource: "*"` により、このポリシーを持つprincipalはアカウント内の**あらゆる**S3バケットへオブジェクトを書き込める。本来は以下のようにARNで対象を絞るべきである。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::my-bucket/*"
    }
  ]
}
```

Cloudsplainingは、こうした「リソース制約を欠くアクション」を自動検出し、そのアクションが引き起こしうるリスクの種類ごとに分類する。分類は以下の5カテゴリである。

1. **データ漏えい（Data Exfiltration）**: `s3:GetObject`、`ssm:GetParameter`、`secretsmanager:GetSecretValue` など、機微データを読み出せるアクションがリソース制約なしに許可されている。
2. **インフラ改変（Infrastructure Modification）**: ECRやS3など、リソースレベルの制限なくインフラを変更できる。
3. **リソース露出（Resource Exposure）**: バケットポリシーやリポジトリポリシー、ACLなど「リソースベースポリシー」自体を書き換えられる（＝他の principal に対して新たなアクセスを付与できてしまう）。
4. **権限昇格（Privilege Escalation）**: ロール引き受けやサービス操作を通じて自身の権限を昇格できる（Pathfinding.cloudの分類に基づく）。
5. **認証情報の露出（Credentials Exposure）**: 認証情報の取得・変更ができる。

さらにCloudsplainingは、EC2・ECS・EKS・Lambdaなどのコンピュートサービスが引き受け可能なIAMロールを高リスクとしてフラグする。README はその理由を次のように説明する。攻撃者が `ssm:SendCommand`（Systems Manager経由でリモートコマンドを実行する権限）を得て、かつSSMエージェントが導入された強力な権限のEC2インスタンスが存在する場合、攻撃者は事実上そのインスタンスのロール権限を乗っ取ったことになる。これは既知の昇格・悪用経路だが、Cloudsplainingはこうしたコンピュートサービスに紐づくロールを機械的に洗い出すことで、監査者がこの種の経路を見落とすリスクを減らす。

#### 動作の仕組みとコマンド

単一ポリシーファイルのスキャン:

```bash
cloudsplaining scan-policy-file --input-file examples/policies/explicit-actions.json
```

出力は次のような形式になる（READMEの実例）。

```console
Issue found: Data Exfiltration
Actions: s3:GetObject

Issue found: Resource Exposure
Actions: ecr:DeleteRepositoryPolicy, ecr:SetRepositoryPolicy, s3:PutBucketPolicy, ...

Issue found: Unrestricted Infrastructure Modification
Actions: ecr:BatchDeleteImage, ecr:CreateRepository, s3:DeleteBucket, s3:PutObject, ...
```

アカウント全体をスキャンする場合は、まずIAMの `GetAccountAuthorizationDetails` API（アカウント内のユーザー・グループ・ロール・カスタマー管理ポリシー・AWS管理ポリシーの情報をまとめて取得する、約100KB相当のJSONを返すAPI）を呼び出してデータを取得する。このAPI呼び出しには `iam:GetAccountAuthorizationDetails` 権限が必要で、AWS管理ポリシー `SecurityAudit` にはこの権限が含まれている。

```bash
# アカウント権限情報のダウンロード
cloudsplaining download --profile myprofile

# 除外設定ファイルの雛形生成
cloudsplaining create-exclusions-file

# ダウンロードしたJSONをスキャンし、HTML/JSONレポートを生成
cloudsplaining scan --exclusions-file exclusions.yml \
  --input-file default.json --output examples/files/
```

これは単一のAPI呼び出しでアカウント全体のIAM構成をローカルに取得し、以降はオフラインで何度でもスキャンできる設計であり、PMapperの「グラフを1回作って繰り返しクエリする」設計思想と共通する。出力はブラウザで閲覧できるインタラクティブなHTMLレポートと、機械可読な `default-iam-results.json` の両方が生成され、後者はCI/CDでの自動判定や他ツールとの連携に利用できる。

#### 除外ファイルによる誤検知の制御

Cloudsplaining自身がREADMEで強調するのは、「AWSインフラの設計背景にある文脈を知っているのはユーザー自身だけである」という点である。例えばユーザー向けポリシーは意図的に緩く設計されていることがある一方、システムロールはより厳格であるべきといった、組織固有の事情がある。そこで除外ファイル（YAML）を使い、対象外にしたいポリシー名・ロール名・アクションをホワイトリスト的に指定できる。

```yaml
policies:
  - "AWSServiceRoleFor*"
  - "AdministratorAccess"
roles:
  - "service-role*"
include-actions:
  - "s3:GetObject"
exclude-actions:
  - ""
```

これにより、AWSのサービスリンクロールや意図的に付与されたAdministratorAccessなど、既知かつ許容されている構成をレポートから除外し、本当にレビューすべき新規の過剰権限だけにチームの注意を集中させられる。

> 出典: Cloudsplaining README — https://github.com/salesforce/cloudsplaining

### aws_consoler — CLI認証情報をAWSマネジメントコンソールへ変換する

#### 目的

aws_consoler はNetSPIが開発したユーティリティで、「AWS CLIの認証情報（アクセスキー・シークレットキー・セッショントークン）をAWSマネジメントコンソールへのアクセスに変換する」ツールである。PMapperやCloudsplainingがIAM設定を「分析」するツールであるのに対し、aws_consolerは取得済みの認証情報の**実効的な影響範囲を確認する**ための実務ツールであり、ペネトレーションテストやインシデント対応における「この認証情報で実際に何ができるか」を素早く可視化する用途で使われる。防御側にとっては、インシデント対応中に侵害された認証情報の実際のコンソール権限を素早く確認し、被害範囲評価（impact assessment）を行う手段として位置づけられる。

#### 仕組み: AWS Federation エンドポイントの悪用ではなく正規利用

aws_consolerが利用するのは、AWSが公式に提供している「フェデレーション（federation）」の仕組みである。これはSAMLなどの外部IDプロバイダ連携でIAMユーザーを持たない者に一時的なコンソールアクセスを発行するために、AWS自身が用意している機能であり、脆弱性の悪用ではない。ソースコード（`aws_consoler/logic.py`）を見ると処理の流れが明確に分かる。

```python
# 一時認証情報を JSON にまとめる
json_creds = json.dumps(
    {"sessionId": creds.access_key,
     "sessionKey": creds.secret_key,
     "sessionToken": creds.token})
token_params = {
    "Action": "getSigninToken",
    "SessionDuration": 43200,
    "Session": json_creds
}
resp = requests.get(url=federation_endpoint, params=token_params)
fed_token = json.loads(resp.text)["SigninToken"]

# サインイントークンを使ってコンソールへのログインURLを組み立てる
login_params = {
    "Action": "login",
    "Issuer": "consoler.local",
    "Destination": console_endpoint + "?" + urllib.parse.urlencode(console_params),
    "SigninToken": fed_token
}
login_url = federation_endpoint + "?" + urllib.parse.urlencode(login_params)
```

処理は2段階のHTTPリクエストで構成される。まず `https://signin.aws.amazon.com/federation`（パーティションごとに異なるエンドポイントを自動選択、後述）に対して `Action=getSigninToken` と一時認証情報のJSONを送り、`SigninToken` を取得する。次にそのトークンと `Action=login`、リダイレクト先の `Destination`（実際のコンソールURL）、任意の `Issuer` 文字列を組み合わせたURLを生成する。このURLをブラウザで開くと、ブラウザのCookieにセッションが確立され、対応するIAM principalとしてコンソールにログインした状態になる。これはAWS公式ドキュメントが定めるフェデレーション用URLの正規の構築手順そのものであり、aws_consolerはこの一連の手順（一時認証情報の用意、`getSigninToken`呼び出し、URL組み立て）を自動化しているに過ぎない。

なお `SessionDuration: 43200`（秒、すなわち12時間）はフェデレーションセッションの最大許容値である。

**重要な分岐点**: 入力された認証情報がすでに一時的なもの（STSが発行したセッショントークン付き）であれば、そのままフェデレーションに使える。しかし恒久的なIAMユーザーのアクセスキー（`AKIA`から始まるプレフィックス）が渡された場合、フェデレーションエンドポイントは恒久キーを直接は受け付けないため、aws_consolerは内部で `sts:GetFederationToken` を呼び出し、一時セッションに変換してから使う。

```python
elif session.get_credentials().get_frozen_credentials() \
        .access_key.startswith("AKIA"):
    sts = session.client("sts", endpoint_url=args.sts_endpoint)
    resp = sts.get_federation_token(
        Name="aws_consoler",
        PolicyArns=[
            {"arn": "arn:aws:iam::aws:policy/AdministratorAccess"}
        ])
```

ここでの `PolicyArns` に `AdministratorAccess` を指定している点は初見だと誤解しやすいが、これは「フェデレーションセッションに管理者権限を付与する」という意味ではない。`sts:GetFederationToken` で得られる実効権限は「元のIAMユーザーが持つ権限」と「ここで指定したポリシー」の**論理積（intersection）**であるとAWSの仕様で定められている。つまり `AdministratorAccess` を指定するのは、元の認証情報が持つ権限を可能な限りそのまま透過させる（上限を広く取っておき、実際の制約は元のIAMユーザー側のポリシーに委ねる）ための実務的なテクニックであり、権限を拡大する抜け道ではない。ソースコード中のコメントも「Effective access is calculated as the union of our permanent creds and the policies supplied here」と説明している（正確には「and」との積であり、和集合ではなく交差点である点に注意。コメント表現はやや簡略化されている)。

#### 主なCLIオプション

```bash
# アクセスキー・シークレット・セッショントークンを直接指定し、ブラウザで開く
aws_consoler -a <ACCESS_KEY_ID> -s <SECRET_ACCESS_KEY> -t <SESSION_TOKEN> -o

# ロールを引き受けてからコンソールに入る
aws_consoler -p <profile> -r arn:aws:iam::123456789012:role/SomeRole -o

# CLIプロファイルを使用
aws_consoler -p myprofile -o
```

`-r/--role-arn` を指定した場合は、`getSigninToken` を呼ぶ前にまず `sts:AssumeRole` でそのロールへスイッチする処理が入る。ソースコード上のコメントには「Stacking AssumeRole sessions together will generate a 400 error here」とあり、すでにAssumeRoleで得たセッション認証情報をさらに `GetFederationToken` に渡すような多重スタックはAWS側でエラーになる制約も明記されている。また `-eS/-eF/-eC`（STS/フェデレーション/コンソールの各エンドポイントを手動指定するオプション)は、社内プロキシ経由や中国リージョン・GovCloudなど特殊なパーティションで動作させる際に使う高度なオプションである。パーティション判定はリージョン名の正規表現マッチ（`^cn-\w+-\d+$` など）によって自動化されている。

#### 防御的な観点での意義

インシデント対応では、漏えいした認証情報がどの範囲のコンソール操作を許すのかを、IAMポリシーを読み解くだけでなく実際の画面で素早く確認したい場面がある。aws_consolerはCLI認証情報からワンコマンドでコンソールセッションURLを生成できるため、対応チームが被害範囲を迅速に把握する助けになる。一方でこのツール自体が「認証情報さえあればコンソールに入れる」ことを再確認させる存在でもあり、防御側としては、漏えいした認証情報の即時失効（アクセスキーの無効化、STSセッションの取り消しが可能な場合は該当ロールの信頼ポリシー変更や `aws:TokenIssueTime` 条件によるセッション無効化）を優先する運用が重要である。

> 出典: aws_consoler README / ソースコード（`aws_consoler/logic.py`, `aws_consoler/cli.py`）— https://github.com/NetSPI/aws_consoler

### 3ツールの位置づけの整理

| ツール | 分析対象 | 手法 | 主な出力 |
|---|---|---|---|
| PMapper | アカウント全体のIAM principal間関係 | グラフ構築＋到達可能性シミュレーション | クエリ結果／SVGグラフ |
| Cloudsplaining | 個々のIAMポリシーのリソース制約有無 | 静的スキャン（`GetAccountAuthorizationDetails`） | HTML/JSONレポート |
| aws_consoler | 保有済み認証情報の実効的なコンソール権限 | AWS Federationエンドポイントの正規利用 | コンソールログインURL |

PMapperは「principal同士の間接的な到達可能性」という構造面のリスクを、Cloudsplainingは「個別ポリシーの記述レベルの緩さ」という設定面のリスクを、それぞれ異なる粒度で可視化する。両者を組み合わせることで、静的なポリシー記述の問題（Cloudsplaining）と、それが実際にどのような昇格チェーンを生むか（PMapper）の両面から監査でき、aws_consolerは監査で見つかったリスクの「実害があるかどうか」を実機のコンソール画面で確認する最終検証ステップとして位置づけられる。定期的な自動スキャンにCloudsplainingとPMapperを組み込み、重大な発見に対してのみaws_consolerで実際の影響を確認する、という段階的な運用が実務では現実的である。
