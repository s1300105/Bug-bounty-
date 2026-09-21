## 鍵発見→権限検証のワークフロー

クラウド環境の侵入テスト・バグバウンティにおいて、AWSアクセスキー（`AKIA...` などの Access Key ID と Secret Access Key のペア、あるいは一時的な STS トークンの組）を発見した後の最初の一手は「破壊」ではなく「観測」である。攻撃者・診断者が最初に行うべきは、その鍵がどのアカウントに属し、どんな IAM（Identity and Access Management、AWSのアクセス制御基盤）権限を持っているかを **非破壊的に** 洗い出すことだ。本節では、鍵を発見してから権限を検証するまでの実務的なワークフローを、代表的な2つのOSSツール・記事から具体的なコード例とともに解説する。

このワークフローは大きく2段階に分かれる。

1. **鍵発見（Secret Discovery）**: ソースコード、JSファイル、Gitコミット履歴、公開バケットなどから漏洩したAWS認証情報を見つける。
2. **権限検証（Permission Enumeration / Privilege Enumeration）**: 見つかった鍵が「有効か」「どのサービス・どのAPIコールが許可されているか」をブラックボックスに近い形で洗い出す。鍵の持ち主に問い合わせずとも、AWS APIへの実際の呼び出しが成功するか失敗するかという応答だけを手がかりに権限を推定する。

### なぜ「試して応答を見る」しかないのか

AWSのIAMには「このユーザーは何ができるか」を一覧表示する単一のAPIは存在しない（`iam:GetAccountAuthorizationDetails` は強力な管理者権限がなければ呼べず、そもそも権限がなければこの情報自体を見ることができない）。そのため、攻撃者側の一般的な手法は「各サービスの代表的なAPIコール（多くは `List*` や `Describe*` といった読み取り専用の列挙系API）を総当たりで呼び出し、`AccessDenied` エラーが返るか、正常応答が返るかを見て権限を逆算する」というものになる。これは典型的なブラックボックス列挙で、HTTPステータスコードや例外の型がそのままオラクル（真偽を判定する手がかり）として機能する仕組みだ。

- 呼び出しが成功する → そのAPIアクションに対応するIAMポリシーの `Allow` が存在する（少なくとも明示的な `Deny` はない）。
- `AccessDeniedException` が返る → そのアクションは許可されていない。
- `InvalidClientTokenId` が返る → 鍵自体が無効（削除済み、タイプミス、ローテーション済みなど）。
- `SubscriptionRequiredException` などのエラー → 権限はあるがサービス自体が有効化されていない、あるいはルートキー的な広い権限を持っている兆候。

この「Allow/Deny をAPIレスポンスから逆算する」原理は、Webアプリケーションにおけるブラインド脆弱性の列挙(例えばブラインドSQLi)と同じ発想であり、クラウドのIAMを対象にした偵察でも根本原理は変わらない。

---

### 1. weirdAAL（carnal0wnage、AWS Attack Library）

weirdAAL は carnal0wnage（Brian Fehrman/Rob Fuller界隈で知られるAWSペンテスト系リサーチャー）が公開している Python3 製の AWS 攻撃・偵察ライブラリで、READMEには一貫してプロジェクトの目的がこう明記されている。

> The WeirdAAL project has two goals:
> 1. Answer what can I do with this AWS Keypair [blackbox]?
> 2. Be a repository of useful functions (offensive & defensive) to interact with AWS services.

つまり「このAWSキーペアで何ができるかをブラックボックスで答える」ことと、「AWSサービスと対話する攻守両用の関数群を提供すること」が明確な設計目標であり、まさに本節のテーマである「鍵発見後の権限検証」を専門に扱うツールである。

#### セットアップの流れ

```bash
git clone https://github.com/carnal0wnage/weirdAAL.git
cd weirdAAL
python3 -m venv weirdAAL
source weirdAAL/bin/activate
pip3 install -r requirements.txt

# sqlite3 データベースの初期化（結果の保存先。これをやらないと動作しない）
python3 create_dbs.py
```

weirdAAL は boto3（AWSの公式Python SDK）をラップして動いており、`create_dbs.py` で `AWSKey`・`recon`・`services` という3つのテーブルを作るsqlite3データベースに、列挙結果を保存していく。これにより、複数の鍵を横断して「このキーはどのサービスにアクセスできたか」を後から検索できる、攻撃側の情報管理台帳のような役割を果たす。

#### 鍵の投入方法

```bash
cat env.sample
# [default]
# aws_access_key_id = <insert key id>
# aws_secret_access_key = <insert secret key>

cp env.sample .env
vi .env   # ここに発見したキーペアを書き込む
```

内部的には、weirdAAL は環境変数 `AWS_SHARED_CREDENTIALS_FILE` を `.env` で上書きすることで、boto3 にこの鍵を読み込ませている。boto3 は標準でSTS(Security Token Service)の一時トークンにも対応しているため、漏洩したものが長期キーではなく `aws_session_token` を伴う一時クレデンシャルであっても同じ枠組みで扱える。

#### recon_all: 総当たり列挙の中核モジュール

権限検証の最初の一歩は `recon_all` モジュールの実行である。

```bash
python3 weirdAAL.py -m recon_all -t MyTarget
```

`-t`（target）はターゲット名のラベルであり、実際のAWSアカウントIDやドメイン名ではなく、結果をDBに紐づけるための任意の識別子として使われる。

鍵が無効な場合、`get_accountid()` 関数内の例外ハンドリングが `botocore.exceptions.ClientError` を捕捉し、次のように早期終了する。

```python
def get_accountid():
    try:
        client = boto3.client("sts")
        account_id = client.get_caller_identity()["Account"]
        print("Account Id: {}".format(account_id))
    except botocore.exceptions.ClientError as e:
        if e.response['Error']['Code'] == 'InvalidClientTokenId':
            sys.exit("{} : The AWS KEY IS INVALID. Exiting".format(AWS_ACCESS_KEY_ID))
        ...
```

つまりまず `sts:GetCallerIdentity`（STSが提供する、認証情報の持ち主のアカウントIDとARNを返すだけの軽量API）を叩いて疎通確認をしている。このAPIは特別なIAM権限がなくても（ほぼ常に）呼び出せるため、鍵の有効性チェックに最適な「ノーコストのオラクル」として使われている。この設計判断は覚えておく価値がある。無権限でも呼べるAPIをまず1本通すことで、後続の数百コールを浪費せずに済む。

鍵が有効な場合、`recon_all` は `brute_*_permissions()` という命名規則の関数を、アルファベット順にほぼ全サービスぶん(数百個)呼び出していく。

```python
def module_recon_all():
    get_accountid()
    check_root_account()
    brute_accessanalyzer_permissions()
    brute_acm_permissions()
    brute_acm_pca_permissions()
    brute_alexaforbusiness_permissions()
    ...
    brute_cloudwatch_permissions()
    ...
```

各 `brute_<service>_permissions()` 関数は、その内部で該当サービスの「引数を必要としない読み取り系API」(例: `ec2.describe_instances()`, `s3.list_buckets()`)を `try/except botocore.exceptions.ClientError` で包んで叩き、成功すれば `[+] <service> Actions allowed are [+]` として一覧に追加、`AccessDeniedException` なら `[-] No <service> actions allowed [-]` として握りつぶす、という実装パターンになっている。これは「例外を制御フローとして使う」典型例であり、Pythonの `try/except` がそのままAWS側のポリシー評価結果を可視化するインターフェースとして機能している。

実行結果の例(README/Wikiより):

```
$ python3 weirdAAL.py -m recon_all -t MyTarget
Account Id: 382756349351
AKIAIXXXXXXXXXXXXXXX : Is NOT a root key
### Enumerating ACM Permissions ###
An error occurred (AccessDeniedException) when calling the ListCertificates operation:
User: arn:aws:iam::XXXXXXXXXXXX:user/training is not authorized to perform: acm:ListCertificates

[-] No acm actions allowed [-]
...
[+] ec2 Actions allowed are [+]
['DescribeInstances', 'DescribeInstanceStatus', 'DescribeImages', 'DescribeVolumes', ...]
...
[+] elb Actions allowed are [+]
['DescribeLoadBalancers', 'DescribeAccountLimits']
```

この出力からわかる通り、権限検証の本質は「AccessDeniedExceptionのエラーメッセージに含まれるARN(`arn:aws:iam::...:user/training`)からIAMユーザー名まで判明する」点も含めて、失敗レスポンスそのものが偵察情報の宝庫になっているということだ。エラーメッセージにユーザー名・アカウントIDが平文で含まれるのは、AWS側の仕様上避けられない挙動であり、これ自体が防御側の設計上の留意点になる(後述)。

#### list_services_by_key: 結果の集約表示

```bash
python3 weirdAAL.py -m list_services_by_key -t MyTarget
```

これは `recon_all` の実行結果をsqlite3データベースから読み出し、`<サービス>:<アクション>` の形式(IAMポリシーの `Action` フィールドと同じ表記)でフラットに列挙し直すモジュールである。

```
Services enumerated for AKIAXXXXXXXXXXXXXX
autoscaling:DescribeAccountLimits
...
ec2:DescribeInstances
ec2:DescribeInstanceStatus
...
sts:GetCallerIdentity
```

この一覧そのものが「このキーが持つIAMポリシーの実効的な許可アクション一覧(の下界)」であり、次の攻撃・調査ステップ(例えば `ec2_describe_instances_basic` モジュールで実際にインスタンス一覧を取得する、など)へ橋渡しする成果物になる。README記載のTLDR(要約)は次の4ステップに集約される。

```
1. cp env.sample を .env にコピーしキーペアを設定
2. python3 weirdAAL.py -m recon_all -t MyTarget
3. python3 weirdAAL.py -m list_services_by_key -t MyTarget
4. 利用可能なサービスから足がかりを広げる(ピボット)
```

#### モジュール構成

`modules/aws/` 配下には `iam.py`、`iam_pwn.py`、`s3.py`、`ec2.py`、`rds.py`、`sts.py`、`route53.py` など、サービスごとの攻守両用モジュールが多数収録されている。特に `iam_pwn.py` は「IAM権限そのものを悪用してさらに強い権限を得る(権限昇格)」ための調査に寄っており、鍵発見→権限検証の次段階である「権限昇格の糸口探し」にそのまま接続する設計になっている。ただし権限昇格や実際の悪用手順は本節のスコープ外であり、ここでは「検証(列挙)」までを扱う。

> 出典: WeirdAAL (AWS Attack Library) — https://github.com/carnal0wnage/weirdAAL （README/Wiki: Setup, Usage ページを含む）

---

### 2. Trufflehog + Enumerate-IAM: 鍵発見から権限検証までの実践フロー

#### 取得不可の資料についての注記

> ⚠️ **未取得の資料**: 「DrSecurityGuru氏によるMedium記事 “Unmasking AWS Secrets: My Journey with Trufflehog and Enumerate-IAM for Bug Bounty Hunters”」は自動取得できませんでした（理由: Mediumのbot対策によりHTTP 403 Forbiddenが返り、本文を取得できませんでした）。以下のURLからご自身で直接ご覧ください: https://medium.com/@earth22sky/unmasking-aws-secrets-my-journey-with-trufflehog-and-enumerate-iam-for-bug-bounty-hunters-9e5599df0c5a

代替として、同じ手法(Trufflehog拡張機能によるAWS鍵発見 → enumerate-iamによる検証)を扱う同系統の実在記事(0xKayala氏、HACKLIDO掲載、2023年1月公開)の本文を取得できたため、以下はその実物の内容に基づく解説である。手法・使用ツールが対象記事と一致しており、ワークフローの理解には十分な代表例となる。

#### ステップ1: ブラウザ拡張機能による鍵の発見

Trufflehog にはCLIツール版(Gitリポジトリのコミット履歴を正規表現/エントロピー解析でスキャンするもの)とは別に、ブラウザ拡張機能版が存在する。この拡張機能は、閲覧しているWebページが読み込む全JavaScriptソースをクロールし、AWSアクセスキーのパターン(`AKIA[0-9A-Z]{16}` に代表される固定プレフィックス+Base32的な文字列など)にマッチする文字列を自動検出してポップアップ通知する。

> I got a Pop-up saying that this website contains AWS API keys... Most of the time, it will show the exposed key and the path where it is present. You can also copy the path and leaked key from the Pop-up box.

これは、フロントエンドのJSバンドルに開発者が誤って本番用のAWSキーをハードコードしてしまうケース(例: S3への直接アップロード機能をクライアントサイドで実装する際にSDK初期化コードへ平文で埋め込む、CI/CDの環境変数がバンドルに焼き込まれる、等)を狙った受動的スキャンである。攻撃者は能動的にリポジトリを漁らずとも、通常のブラウジング中に自動で検出できてしまう点が実務上のリスクを高めている。

#### ステップ2: enumerate-iam による権限の検証

発見した鍵ペアの有効性と権限範囲を検証するために使われるのが `enumerate-iam`(andresriancho作)である。このツールはweirdAALと発想は同じだが、より軽量・高速に「総当たりでAPIを試す」ことに特化している。

```bash
git clone git@github.com:andresriancho/enumerate-iam.git
cd enumerate-iam/
pip install -r requirements.txt

./enumerate-iam.py --access-key AKIA... --secret-key StF0q...
```

公式READMEに掲載されている実行例:

```
2019-05-10 15:57:58,447 - [INFO] Starting permission enumeration for access-key-id "AKIA..."
2019-05-10 15:58:01,532 - [INFO] Run for the hills, get_account_authorization_details worked!
2019-05-10 15:58:26,709 - [INFO] -- gamelift.list_builds() worked!
2019-05-10 15:58:26,850 - [INFO] -- cloudformation.list_stack_sets() worked!
2019-05-10 15:58:26,982 - [INFO] -- directconnect.describe_locations() worked!
2019-05-10 15:58:27,311 - [INFO] -- sqs.list_queues() worked!
```

ログ中の "Run for the hills"(直訳: 逃げ出せ)というコメントは、`iam:GetAccountAuthorizationDetails` が成功したことを示している。このAPIはIAMユーザー・グループ・ロール・ポリシーの詳細な割り当て構造を丸ごと返す非常に強力な管理API であり、これが成功する鍵は事実上IAM管理者権限(あるいはそれに準ずる強い権限)を持つ「アタッカーにとっての大当たり」を意味する。ツールの作者が皮肉を込めてこの文言を選んでいる。

##### 実装原理: `bruteforce_tests.py` という「総当たり辞書」

enumerate-iam の核心は `enumerate_iam/bruteforce_tests.py` という、サービス名とその引数不要な列挙系API名を網羅したPythonの辞書(dict)である。README にはこの辞書の生成方法も明記されている。

```bash
cd enumerate_iam/
git clone https://github.com/aws/aws-sdk-js.git
python generate_bruteforce_tests.py
rm -rf aws-sdk-js
```

つまり、AWS公式のJavaScript SDK(`aws-sdk-js`)に含まれるサービス定義(各APIのメタデータ、特に「引数なしで呼べる`List*`/`Describe*`/`Get*`系API」)を機械的に解析し、総当たり対象のAPIコール一覧を自動生成している。AWSは四半期ごとに新サービスをリリースするため、この辞書は定期的に再生成しないと最新のサービスを見落とす、という保守上の注意点もREADMEに明記されている(バージョン依存性の高い設計であることに留意)。

各APIコールは `get*` または `list*` のみに限定されており、README上で明示的に非破壊(non-destructive)であることが強調されている。

> The calls performed by this tool are all non-destructive (only get* and list* calls are performed).

これは本教科書全体のスコープ制約(防御目的・非破壊)とも合致する重要な設計方針である。列挙自体は読み取り専用APIのみで完結し、リソースの作成・変更・削除は一切行わない。

##### ライブラリとしての利用

enumerate-iam はCLIだけでなくPythonライブラリとしても設計されており、他ツールへの組み込みを前提としている。

```python
from enumerate_iam.main import enumerate_iam

enumerate_iam(access_key, secret_key, session_token, region)
```

戻り値はPythonの辞書型で、許可されたAPIコールの一覧をプログラム的に扱えるため、自動化パイプライン(例: 発見した鍵を自動でこの関数に渡し、Slack通知や脆弱性管理システムに結果を投げる、といった仕組み)に組み込みやすい。

##### 記事における結果と限界

参照記事(HACKLIDO版)では、実際に検証した結果について次のように率直な限界が述べられている。

> There is no guarantee that the Leaked keys will be Valid and give more info at all times. I was fortunate to get some basic info which is of no use to increase the impact on the target.

つまり、鍵が「有効」であっても、必ずしも即座に重大な影響(インパクト)につながる情報が得られるとは限らない。IAMポリシーが最小権限の原則(Principle of Least Privilege)に沿って設計されていれば、`sts:GetCallerIdentity` 程度しか通らず、実害に乏しいケースも多い。バグバウンティの文脈では、この「有効性の確認」と「実害の証明(Proof of Impact)」は別工程であり、多くのプログラムでは単に鍵が有効であることを示すだけでは受理されず、実際にアクセスできたデータやリソースを(権限の範囲内で、かつ非破壊的に)示す必要がある点に注意したい。

> 出典: enumerate-iam (andresriancho) 公式README — https://github.com/andresriancho/enumerate-iam
> 出典(代替資料・同一手法の実例記事): "How I Found AWS API Keys using Trufflehog and Validated them using enumerate-iam tool" (0xKayala, HACKLIDO, 2023) — https://hacklido.com/blog/218-how-i-found-aws-api-keys-using-trufflehog-and-validated-them-using-enumerate-iam-tool
> 元々指定されていた資料: DrSecurityGuru「Unmasking AWS Secrets: My Journey with Trufflehog and Enumerate-IAM for Bug Bounty Hunters」 — https://medium.com/@earth22sky/unmasking-aws-secrets-my-journey-with-trufflehog-and-enumerate-iam-for-bug-bounty-hunters-9e5599df0c5a

---

### ワークフローの統合と防御的な示唆

ここまでの2つの資料を統合すると、鍵発見後のenumeration(列挙)ワークフローは次の5段階に整理できる。

1. **発見**: コード・JSバンドル・Git履歴・公開リポジトリから鍵パターンを検出(Trufflehog等の正規表現/エントロピーベースのスキャナ)。
2. **疎通確認**: `sts:GetCallerIdentity` のような無権限でも呼べるAPIで、鍵が有効かどうかだけをまず判定する(weirdAALの `get_accountid()` の設計思想)。
3. **総当たり列挙**: `List*`/`Describe*`/`Get*` 系の読み取り専用APIを辞書化し、`AllowedならOK・AccessDeniedならNG` という二値のオラクルとして大量に試行する(weirdAALの `brute_*_permissions()`、enumerate-iamの `bruteforce_tests.py`)。
4. **集約**: 許可されたアクションを `サービス:アクション` 形式で一覧化し、次のピボット先を判断する(`list_services_by_key`)。
5. **影響評価**: 単に鍵が有効というだけでなく、実際にどんなデータ・リソースへアクセスできるかを最小権限の範囲で確認し、インパクトを説明する。

防御側の観点では、この一連の手口を踏まえて次のような対策が有効である。

- **CloudTrailの異常検知**: 短時間に数百種類の異なるサービスへ `List*`/`Describe*` 系APIが呼ばれる(特に単一のIAMプリンシパルから、普段使わないサービスへ多数のAPIコールが飛ぶ)というパターンは、まさにこのenumerationツール特有の挙動であり、GuardDutyやCloudTrail Insightsでの検知ルールの対象にしやすい。
- **最小権限の徹底**: `iam:GetAccountAuthorizationDetails` のような強力な列挙系APIを一般ユーザーに許可しない。これが許可されていると、上述の "Run for the hills" のケースに直結する。
- **鍵の即時失効フロー**: 漏洩が疑われた時点で、まず該当のアクセスキーを無効化(`Inactive`化)し、その後にCloudTrailログで実際の悪用有無を確認する、という順序を徹底する。
- **JSバンドルへの機密情報混入防止**: フロントエンドのビルドプロセスでシークレットスキャン(gitleaks、trufflehog CLI等)をCI/CDに組み込み、ビルド成果物に鍵が焼き込まれることを未然に防ぐ。

これらのツールはいずれも「読み取り専用APIのみを使い、対象環境を変更しない」という設計上の制約を持つため、防御的な検証(自社環境に対する許可された診断)においても同様の手法で「意図せず広すぎる権限を持つIAMユーザー」を洗い出す監査ツールとして活用できる。実運用にあたっては、必ず対象アカウントの管理者権限を持つ者自身が、事前に許可された範囲内でのみ実施すべきである。
