## AWS IMDSの基礎とSSRFからのクレデンシャル窃取（決定版）

### この節で扱うこと

SSRF（Server-Side Request Forgery、サーバー側でアプリケーションに任意のURLへリクエストを発行させる脆弱性）は、単体では「サーバーが代わりに通信してくれる」だけの問題に見えることがある。しかしクラウド環境、特にAWS EC2インスタンス上で動くアプリケーションがSSRFを持つ場合、その先には**インスタンスメタデータサービス（IMDS: Instance Metadata Service）**という、そのインスタンス自身に紐づくIAMロールの一時クレデンシャル（一時的なアクセスキー・シークレットキー・セッショントークンの組）を配布する内部APIが存在する。攻撃者はSSRFを踏み台にしてIMDSへアクセスし、そのクレデンシャルを窃取して、EC2インスタンスが持つIAM権限をまるごと乗っ取ることができる。これは「サーバー内部の情報漏洩」ではなく、多くの場合「クラウドアカウント全体の侵害」に直結する、クラウド特有かつ最重要のSSRF帰結である。

本節では、IMDSv1とIMDSv2の仕組みの違い、具体的な攻撃手順、実際の攻撃連鎖、そして防御策を体系的に解説する。

### IMDS（インスタンスメタデータサービス）とは何か

EC2インスタンスは起動時、OSやアプリケーションが自分自身の情報（インスタンスID、AMI ID、ネットワーク設定、そして最も重要な**IAMロールの一時クレデンシャル**）を取得できるよう、特別なHTTPエンドポイントを内部に持つ。これがIMDSであり、常に**リンクローカルアドレス`169.254.169.254`**上でリッスンしている。

> ⚠️ **未取得の資料の補足として**：`169.254.169.254`はIPv4のリンクローカルアドレス空間（169.254.0.0/16）に属し、ルーティングされずそのホスト（正確にはハイパーバイザー経由でEC2インスタンスに提供される仮想NIC）からのみ到達可能という前提でAWSは設計している。つまり本来「そのインスタンス自身のOS・アプリケーションだけがアクセスできる」ことを暗黙の信頼境界としている。SSRFはこの信頼境界を、外部の攻撃者が「サーバーに代理リクエストさせる」ことで内側から突破してしまう攻撃である。

IAMロールをアタッチされたEC2インスタンスでは、次のパスを辿ることでロールの一時クレデンシャルを取得できる。

```
GET http://169.254.169.254/latest/meta-data/iam/
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/<role-name>
```

- 1段目：`iam/`配下が存在する＝そのインスタンスに何らかのIAMロールがアタッチされていることを示す（404ならロールなし＝この経路での攻撃は不成立）。
- 2段目：アタッチされているロール名を返す（複数ロールが返る構成もある）。
- 3段目：ロール名を指定すると、`AccessKeyId`・`SecretAccessKey`・`Token`（セッショントークン）・有効期限（`Expiration`）を含むJSONが返る。

> 出典: Hacking Articles — AWS EC2 Credentials Theft via SSRF Abuse — https://www.hackingarticles.in/aws-ec2-credentials-theft-via-ssrf-abuse/

この記事のラボでは、IAMロール`ec2-admin`（管理者級の広い権限を持つロール）がEC2インスタンス`lgt_server`にアタッチされている想定で、次のように段階的にメタデータを引き出している。

```
http://65.1.93.95/fetch.php?url=http://169.254.169.254/latest/meta-data/
http://169.254.169.254/latest/meta-data/iam/security-credentials/
http://169.254.169.254/latest/meta-data/iam/security-credentials/ec2-admin
```

最後のリクエストで得られるレスポンスには`AccessKeyId`・`SecretAccessKey`・`SessionToken`が含まれており、これをそのまま環境変数にセットすればAWS CLIから正規のAPI呼び出しが可能になる。

```bash
export AWS_ACCESS_KEY_ID=ASIAXPJ...
export AWS_SECRET_ACCESS_KEY=SvEMItwhRPI+0FZf...
export AWS_SESSION_TOKEN="IQoJb3JpZ2luX2VjEIX..."

aws sts get-caller-identity   # 誰として認証されているかの確認
aws s3 ls s3://igt-bucket/    # 窃取した権限でS3を列挙
aws s3 rm s3://igt-bucket/secrets.txt  # 権限次第では破壊的操作も可能
```

なぜこれが致命的なのか。この一時クレデンシャルは**AWS STS（Security Token Service）が発行した正規の認証情報**であり、IMDS経由で取得した時点でAWS側から見れば「そのIAMロールとして振る舞う正規の呼び出し」と区別がつかない。EC2インスタンス自体を侵害せずとも、Webアプリケーションの一つのSSRFバグだけで、インスタンスが持つIAM権限をまるごと奪える。ラボの例のように、S3の閲覧に加えて削除（`rm`）まで可能な設計であれば、機密情報の窃取に留まらずデータ破壊・ランサム的な悪用にまで発展し得る。

> 出典: Hacking Articles — AWS EC2 Credentials Theft via SSRF Abuse — https://www.hackingarticles.in/aws-ec2-credentials-theft-via-ssrf-abuse/

（本書では防御目的の学習に限定し、実在環境に対する検証・破壊的操作は行わない。上記コマンド例は攻撃者視点の手口を理解し、防御側が検知・遮断すべきポイントを把握するための引用である。）

### SSRFがIMDSに到達する経路：脆弱なコード例

なぜSSRFがこの攻撃を可能にするのか、原理を見ておく。Hacking Articlesの記事では、URLパラメータをそのままサーバー側で取得（フェッチ）する典型的な脆弱コードが例示されている。

```php
<?php
if (isset($_GET['url'])) {
    $url = $_GET['url'];
    $content = file_get_contents($url);
    echo $content;
}
?>
```

このコードの問題は、`url`パラメータの値に対して**検証もフィルタリングも一切行っていない**ことにある。`file_get_contents()`はスキーム（`http://`, `file://`など）とホストを問わずリクエストを発行できるため、攻撃者が`url=http://169.254.169.254/latest/meta-data/iam/security-credentials/ec2-admin`のような値を渡せば、サーバー自身がそのリクエストを（あたかも自分自身が発行したかのように）実行し、結果をそのまま応答本文として返してしまう。

つまりSSRFの本質は「**sink（入力が最終的に到達し、危険な処理へ渡される箇所）**である`file_get_contents`のようなURL取得関数に、ユーザー入力（source）が未検証で流れ込むこと」であり、IMDS窃取はその中でも「到達先がクラウドメタデータという、極めて価値の高い内部APIである」特殊ケースにあたる。

> 出典: Hacking Articles — AWS EC2 Credentials Theft via SSRF Abuse — https://www.hackingarticles.in/aws-ec2-credentials-theft-via-ssrf-abuse/

Resecurityの記事も同様に、クエリパラメータ経由でプロキシ的にURLを取得させる構造を典型パターンとして挙げている。

```
GET /proxy?url=http://169.254.169.254/latest/meta-data/
```

こうした「URLフェッチ機能」「Webhookプレビュー」「画像URLの取り込み」「PDF生成のためのURLレンダリング」「外部APIプロキシ」など、サーバーがユーザー指定のURLに対して通信を行う機能は、すべてIMDSへの到達経路になり得る。

> 出典: Resecurity — SSRF to AWS Metadata Exposure: How Attackers Steal Cloud Credentials — https://www.resecurity.com/blog/article/ssrf-to-aws-metadata-exposure-how-attackers-steal-cloud-credentials

### IMDSv1とIMDSv2の違い：なぜバージョンが防御の分水嶺になるのか

ここが本節の核心である。AWSは2019年にIMDSv2を導入し、SSRF経由のメタデータ窃取に対する緩和策として位置づけた。両者の違いを仕組みレベルで理解する。

**IMDSv1（レガシー方式）**

単純な`GET`リクエストだけで、認証なしにメタデータへアクセスできる。

```
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/ec2-admin
```

この方式の問題は、**HTTPの`GET`メソッドと、送信元がホスト自身であることだけ**に依存しており、リクエストが「本当にそのホスト上で動くOSやアプリケーションが自発的に発行したものか」「外部から注入された（SSRF経由の）ものか」を一切区別できないことにある。多くのSSRF脆弱性（URLフェッチ、画像プロキシ、Webhookなど）は単純な`GET`リクエストの中継しかできないが、IMDSv1はまさにその`GET`だけで完結するため、極めて相性良く悪用されてしまう。

**IMDSv2（トークンベース方式）**

IMDSv2では、メタデータを取得する前に、まず`PUT`メソッドでセッショントークンを要求する必要がある。

```bash
# ステップ1: PUTリクエストでトークンを取得（TTLを秒単位で指定）
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")

# ステップ2: 取得したトークンをヘッダーに付けてメタデータへアクセス
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/ec2-admin
```

（このコマンド例は本書がIMDSv2の仕組みを説明するために一般的なAWSの公開情報に基づいて構成したものであり、防御側が挙動を理解するための参考である。実環境での実行はAWSの利用規約・自組織のポリシーに従うこと。）

IMDSv2がSSRFに強い理由は主に2点ある。

1. **`PUT`メソッドかつカスタムヘッダーが必須**であること。多くのSSRF脆弱性（URLをそのままフェッチするだけの機能）は`GET`しか発行できず、攻撃者が任意のHTTPメソッドやカスタムヘッダーを注入できない。そのため、トークン取得の`PUT`リクエスト自体を成立させられず、攻撃の入口で詰まる。
2. **ホップ制限（デフォルトでホップ数1）**。EC2インスタンスはIMDSv2のトークン応答に対してTTL（Time To Live、IPパケットの転送可能回数）を1に設定でき、これによりロードバランサやプロキシを一段介しただけでリクエストが到達しなくなるよう設計できる。これはSSRFが典型的にアプリケーションサーバー内部の別プロセス（リバースプロキシ等）を経由する構成を想定した緩和策である。

Hacking The Cloudの記事は、この効果を端的にまとめている。

> "IMDSv2 would significantly reduce the risk of an adversary stealing IAM credentials via SSRF or XXE attacks"
> （IMDSv2はSSRFやXXE攻撃を介した攻撃者によるIAMクレデンシャル窃取のリスクを大幅に低減する）

> 出典: Hacking The Cloud — Steal EC2 Metadata Credentials via SSRF — https://hackingthe.cloud/aws/exploitation/ec2-metadata-ssrf/

ただし重要な注意点として、**IMDSv2は「GETしか送れない単純なSSRF」を防ぐものであり、万能の防御ではない**。次のようなケースではIMDSv2があっても窃取が成立し得る。

- SSRFの脆弱性が**任意のHTTPメソッドとヘッダーを注入可能**なタイプ（例: サーバー側でリクエストのメソッドやヘッダーをある程度制御できるSSRF、あるいはリバースプロキシの設定不備によりクライアント指定のヘッダーがそのまま内部リクエストに転送されるケース）である場合、攻撃者は`PUT`でのトークン取得から`GET`でのメタデータ取得までの2段階を両方実行できてしまう。
- アプリケーション自体がIMDSv2のトークンをキャッシュして保持しており、SSRFによってそのキャッシュ値（あるいはトークンを使ってメタデータを取得済みのレスポンス）が読み出せる場合。
- 古いAWS SDKやミドルウェアがIMDSv1にフォールバックする設定のままになっている場合（後述のホップ制限やv1無効化設定がされていない構成）。

このため、IMDSv2の有効化は極めて有効な緩和策ではあるが、「IMDSv2にしているから安全」という誤った安心につながらないよう、後述する多層防御（ネットワーク遮断・最小権限）と組み合わせることが前提となる。

> 出典: Hacking The Cloud — Steal EC2 Metadata Credentials via SSRF — https://hackingthe.cloud/aws/exploitation/ec2-metadata-ssrf/

Resecurityの記事も、"IMDSv2を強制しない限り、デフォルトのままではアクセス可能"と指摘しており、**IMDSv1とIMDSv2を両方許可したまま**にしている構成（AWSのデフォルトの後方互換設定）こそが最大のリスクだと強調している。

> 出典: Resecurity — SSRF to AWS Metadata Exposure: How Attackers Steal Cloud Credentials — https://www.resecurity.com/blog/article/ssrf-to-aws-metadata-exposure-how-attackers-steal-cloud-credentials

Hacking Articlesのラボでも同様に、"V1とV2（トークンオプション）の両方が有効化されている"構成が脆弱性の一因として名指しされている。本番環境では**「IMDSv2のみを必須（`HttpTokens: required`）」に設定し、IMDSv1を完全に無効化する**ことが推奨される。

> 出典: Hacking Articles — AWS EC2 Credentials Theft via SSRF Abuse — https://www.hackingarticles.in/aws-ec2-credentials-theft-via-ssrf-abuse/

### 攻撃連鎖の全体像

Hacking Articlesの記事は、この攻撃を1つのSSRF脆弱性から始まり、クラウド環境全体の侵害へと至る攻撃連鎖（キルチェーン）として図解している。

```
限定的な権限を持つIAMユーザー（攻撃者が別経路で入手した低権限アカウント）
    ↓
Webアプリケーションに存在するSSRF脆弱性を悪用
    ↓
SSRF経由でIMDS（169.254.169.254）へアクセス
    ↓
アタッチされているIAMロールの一時クレデンシャルを窃取
    ↓
窃取したクレデンシャルでEC2インスタンスのIAMロールになりすます
    ↓
そのロールが持つ権限を列挙（多くの場合、開発時の利便性のために過度に広い権限が付与されている）
    ↓
S3・EC2など他のAWSリソースへ横展開
    ↓
AWS環境全体の侵害（データ窃取・破壊・追加の権限昇格）
```

> 出典: Hacking Articles — AWS EC2 Credentials Theft via SSRF Abuse — https://www.hackingarticles.in/aws-ec2-credentials-theft-via-ssrf-abuse/

このラボが示す重要な教訓は、**低権限のIAMユーザーしか持たない攻撃者でも、SSRF一つでEC2インスタンスの（しばしばより強力な）IAMロールへと権限を昇格できる**ということである。これはIAMロールの権限設計（最小権限の原則）が、SSRFという一見無関係な脆弱性の被害規模を直接左右することを意味する。ロールが必要最小限のS3読み取り権限しか持たなければ被害はその範囲に限定されるが、`AdministrativeAccess`のような広範な権限が付与されていれば、被害はアカウント全体に及ぶ。

### 実被害の規模：自動化されたスキャンの存在

これは理論上の脅威ではなく、実際に自動化された攻撃として観測されている。Hacking The Cloudの記事では、セキュリティベンダーMandiant（Google Cloud傘下の脅威インテリジェンス企業）が、SSRF脆弱性を悪用してIMDSクレデンシャルを窃取する**自動化されたスキャン（automated scanning）**を確認していることに言及している。つまり攻撃者は個々のターゲットを手動で狙うのではなく、インターネット上でSSRFの疑いがある入力点（URLフェッチ機能など）を広く走査し、そこにIMDS宛のペイロードを機械的に投げ込むボットのような手法で、無差別にクレデンシャルを収集していることを意味する。この事実は、「うちは狙われるほど有名ではない」という油断が通用しないことを示している。

> 出典: Hacking The Cloud — Steal EC2 Metadata Credentials via SSRF — https://hackingthe.cloud/aws/exploitation/ec2-metadata-ssrf/

### 攻撃が可能にすること：影響の全体像

Resecurityの記事は、SSRFからIMDS窃取に至った場合の影響を5つに整理している。

- **クラウド認証情報の盗難**：一時的とはいえ有効期限内（デフォルトでは数時間〜最大36時間程度に設定可能）は正規の認証情報として使い放題になる。
- **内部ネットワークスキャニング**：SSRF自体がそのまま内部ネットワークへのポートスキャン・サービス探索の踏み台にもなる。
- **内部APIへのアクセス**：VPC内部にのみ公開された管理API・データベース管理画面などへの到達。
- **ファイアウォール迂回**：外部から直接到達できないリソースへ、信頼されたサーバー経由でアクセスできてしまう。
- **インフラへの横展開**：窃取したIAM権限を起点に、他のEC2インスタンス、S3バケット、Lambda関数など周辺リソースへと侵害を広げる。

> 出典: Resecurity — SSRF to AWS Metadata Exposure: How Attackers Steal Cloud Credentials — https://www.resecurity.com/blog/article/ssrf-to-aws-metadata-exposure-how-attackers-steal-cloud-credentials

特に「IAMロール権限が広範な場合、盗まれた認証情報でS3やDynamoDB、EC2へのアクセスが可能」になる点は、前述のIAM最小権限の原則の重要性と直結する。

### 防御策：多層防御としてのまとめ

3つの資料が共通して挙げる防御策を、実装の優先度が高い順に整理する。

**1. IMDSv2の必須化（IMDSv1の無効化）**

最も直接的かつ効果の大きい対策。EC2インスタンスのメタデータオプションで`HttpTokens`を`required`に設定し、`HttpPutResponseHopLimit`を1（デフォルト）のまま維持することで、単純な`GET`ベースのSSRFからの窃取をほぼ無効化できる。AWS CLIやTerraform、CloudFormationのいずれからも設定可能であり、既存インスタンスにも後から適用できる。

> 出典: Hacking The Cloud / Resecurity / Hacking Articles（3記事共通の推奨事項）

**2. 入力検証とURLホワイトリスト化**

SSRFの根本原因である「ユーザー入力を検証せずにサーバー側で取得する」実装そのものを是正する。具体的には、許可するホスト名・スキームをホワイトリスト方式で限定し、リンクローカルアドレス（`169.254.0.0/16`）やプライベートアドレス（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）、`localhost`/`127.0.0.1`宛のリクエストを明示的に拒否する。DNSリバインディング（名前解決結果が検証後に変わる攻撃）にも配慮し、検証したIPアドレスに対して実際に接続する実装（TOCTOU、Time-Of-Check to Time-Of-Useの不整合を避ける実装）が望ましい。

> 出典: Resecurity — SSRF to AWS Metadata Exposure — https://www.resecurity.com/blog/article/ssrf-to-aws-metadata-exposure-how-attackers-steal-cloud-credentials

**3. ネットワークレベルでのアクセス制限**

アプリケーション層の防御だけに頼らず、ホストのファイアウォール（`iptables`やセキュリティグループに相当するホスト側制御）で、アプリケーションプロセスの実行ユーザーから`169.254.169.254`への通信を遮断する多層防御も有効である。コンテナ環境（ECS/EKS）ではタスクロールの認証情報エンドポイントが別アドレスになる点に注意しつつ、同様の原則（メタデータエンドポイントへの到達をアプリケーションの信頼境界の外に置かない）を適用する。

> 出典: Resecurity — SSRF to AWS Metadata Exposure — https://www.resecurity.com/blog/article/ssrf-to-aws-metadata-exposure-how-attackers-steal-cloud-credentials

**4. IAMロールの最小権限原則**

たとえIMDS窃取が成立しても、被害範囲を限定するための最後の防波堤。Hacking Articlesのラボが示すように、`ec2-admin`のような広範な管理者権限をEC2インスタンスに付与すること自体がリスクの核心である。インスタンスが実際に必要とするAPIアクション・リソースのみをIAMポリシーで許可し、`AdministratorAccess`のようなAWS管理ポリシーの安易なアタッチは避ける。

> 出典: Hacking Articles — AWS EC2 Credentials Theft via SSRF Abuse — https://www.hackingarticles.in/aws-ec2-credentials-theft-via-ssrf-abuse/

**5. ロギングと異常検知**

CloudTrailでIMDS経由のクレデンシャル利用を監視し（`userIdentity`内のセッションコンテキストから、通常と異なるIPアドレス・地理的位置からのAPI呼び出しを検知）、アプリケーション側でも外部URLフェッチの試行ログを記録し、内部IPレンジへのリクエストパターンを異常として検知する仕組みを整える。

> 出典: Hacking Articles — AWS EC2 Credentials Theft via SSRF Abuse — https://www.hackingarticles.in/aws-ec2-credentials-theft-via-ssrf-abuse/

### まとめ

SSRFは一般的には「情報漏洩」や「内部ネットワークへの到達」のリスクとして語られがちだが、AWS環境においては**IMDSという単一のリンクローカルエンドポイントを経由するだけで、クラウドアカウント全体を乗っ取り得る特権昇格経路**に直結する。IMDSv1が単純な`GET`リクエストのみで認証なしにクレデンシャルを配布してしまう設計上の弱点を持つのに対し、IMDSv2は`PUT`メソッドとカスタムヘッダーによるトークン取得を必須化し、ホップ制限を組み合わせることで、多くのSSRFパターンからの窃取を防ぐ。しかしこれは万能ではなく、IAMの最小権限原則・入力検証・ネットワーク遮断・監視という多層防御と組み合わせて初めて実効性を持つ。次節以降では、この窃取したクレデンシャルを起点にどのように権限昇格・横展開が行われるか、より具体的なケースを見ていく。
