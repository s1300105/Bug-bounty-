# 第10章 発展・方法論・防御理解・ハンズオン環境

## テスト方法論と検出回避・防御理解

これまでの章では、IMDS（インスタンスメタデータサービス）からの認証情報窃取、S3の設定不備、IAM権限昇格、シークレットの露出など、クラウド特有の脆弱性クラスを個別に見てきた。本章ではそれらを「どのような順序・方針で調べ、攻撃者はどう検出を回避しようとし、防御側はどこを見張ればよいのか」というメタなレベルで統合する。ここで扱うのは次の3つの視点である。

1. **列挙の方法論** — 侵入した認証情報から攻撃経路をどう体系的に洗い出すか（CloudFoxのワークフロー）。
2. **検出回避（detection evasion）** — AWS GuardDuty・CloudTrailといった監視機構が「何をトリガーに」検知するのか、その仕組みを裏返すと攻撃者がどう回避を試みるのか（CloudGoat `detection_evasion`）。
3. **攻撃経路の連鎖** — SSRFを起点にIMDSから認証情報を奪い、`AssumeRole`チェーンでクロスアカウントに横展開する一連の流れ（クラウド環境におけるSSRF）。

これらはいずれも「防御側が自分の環境の穴と監視の死角を理解するため」に学ぶものである。原理を仕組みレベルで理解することが、有効な検知ルールと最小権限設計につながる。

---

### 10.1 クラウド列挙の方法論 — CloudFoxワークフロー

#### なぜ「状況認識」が最初のステップなのか

クラウドのペネトレーションテストや侵害後調査（post-compromise assessment）では、なんらかの認証情報（アクセスキー、STS一時トークン、EC2インスタンスロールなど）を手にした直後に、必ず「この認証情報で何ができるのか」を把握する必要がある。これを**状況認識（situational awareness）**と呼ぶ。オンプレミスのネットワークにおける「侵入したホストから見えるネットワーク・権限を調べる」段階に相当する。

Bishop Fox社の「CloudFox Workshop: Cloud Enumeration for Pentesting」は、この状況認識を自動化するオープンソースツール **CloudFox** を軸に、列挙の方法論を体系化している。ワークショップが提示する中核的な作業の流れは次の4段階である。

> **enumerate（列挙） → correlate（相関） → exploit（悪用） → escalate（昇格）**

- **enumerate**: どんなリソース・ロール・権限が存在するかを網羅的に洗い出す。
- **correlate**: 発見した認証情報と、その認証情報が持つ権限（何ができるか）を突き合わせる。
- **exploit**: 相関から見えた「今すぐアクセスできるリソース」に手をかける。
- **escalate**: ロールの信頼関係（trust）をたどって、より高い権限や別アカウントへ横展開する。

CloudFoxの重要な設計思想は、**環境に一切の状態変更を加えない（state changes を作らない）**点にある。すべての操作は読み取り専用のAPI呼び出しであり、「テスト中に誤ってリソースを削除したり、ユーザーをロックアウトしたりするリスクを排除する」ことを明示的に目標としている。これは防御目的の評価において極めて重要な性質である。列挙そのものが破壊的であってはならない。

> 出典: BishopFox「CloudFox Workshop: Cloud Enumeration for Pentesting」 — https://bishopfox.com/resources/cloudfox-cloud-enumeration-penetration-testing

#### 対応プロバイダーと出力形式

CloudFoxは **AWS・Azure・GCP** の3クラウドに対応する（AWS向けが最も成熟している）。出力は次の3形式で生成される。

- **CSV / JSON** — 機械可読な一覧。他ツールへの取り込みや差分比較に向く。
- **table（テーブル）** — 端末上で人間が読むための整形出力。
- **loot（戦利品）フォルダ** — 発見したリソースへ「すぐに実行できるコマンド」をまとめた専用フォルダ。列挙結果を次の行動へ直結させるための橋渡しである。

#### 何を列挙し、どう相関させるか

ワークショップが強調する「列挙すべき対象」と「それが攻撃経路の発見にどうつながるか」は次の通りである。

**(1) 認証情報（シークレット）の発見**

平文で保存された認証情報は、次のような場所に紛れ込みやすいとされる。

- CloudFormationテンプレート
- Lambda関数のコード
- S3バケット
- 環境変数
- **EC2のユーザーデータ（user data）**

なぜここに集中するのか。これらはいずれも「開発者が起動時の初期化やアプリ設定のために任意テキストを埋め込める領域」であり、かつIAM権限を持つ主体が読み取り可能なAPI（`ec2:DescribeInstanceAttribute` でuser-dataを取得、`lambda:GetFunction` でコードを取得、など）で機械的に列挙できるからである。攻撃者は人手でファイルを漁る必要がなく、API経由で一括収集できる。

**(2) 権限の相関 — `permissions.txt`**

CloudFoxは列挙した各プリンシパル（IAMユーザー/ロール）の権限を `permissions.txt` にまとめて出力する。これにより、「発見した認証情報 ↔ その認証情報が実際に持つ権限」を突き合わせ、攻撃経路を効率的に特定できる。correlate（相関）段階の中核となる成果物である。

**(3) リソースの信頼関係 — `resource-trusts.txt`**

S3などのサービスに設定された**リソースレベルのアクセス制御（リソースポリシー）**を明らかにする。あるバケットが「特定の外部アカウントに読み取りを許している」といった、リソース側から見た信頼関係を可視化する。

**(4) ロールの信頼関係 — role-trust ファイル**

**「どのプリンシパルがどのロールをassumeできるか」**を明らかにするファイル群を出力する。これがescalate（昇格）段階の鍵である。ロールAをassumeでき、ロールAがロールBをassumeできる……という連鎖をたどることで、多段の権限昇格経路（アタックパス）を発見できる。後述するSSRF起点のAssumeRoleチェーン（10.3節）と直結する概念である。

**(5) 環境の全体像 — `inventory.txt`**

環境の規模やリソースの複雑さ（どのリージョンに何がどれだけあるか）の指標を提供する。テストの範囲感を掴み、優先順位をつけるために使う。

#### 防御側にとっての含意

CloudFoxのワークフローを裏返すと、防御側が自分の環境で「攻撃者が最初に見るもの」を先回りして点検できる。

- **user data・環境変数・Lambdaコード・CloudFormationテンプレートに平文シークレットがないか** を定期的に走査する（第7章のシークレット走査ツールと連携）。
- **role-trust の可視化** — 自分の環境のロール信頼ポリシーを棚卸しし、過度に緩いassume許可（`Principal: "*"` や不要な外部アカウント許可）を潰す。
- **読み取り専用APIの大量発行を監視する** — CloudFox的な列挙は「短時間に大量のDescribe/List/Get系API」を発行する。これはCloudTrailで検知可能な特徴的パターンであり、GuardDutyの偵察系ファインディング（後述）が拾う対象でもある。

> 出典: BishopFox「CloudFox Workshop: Cloud Enumeration for Pentesting」 — https://bishopfox.com/resources/cloudfox-cloud-enumeration-penetration-testing

---

### 10.2 検出回避の仕組みを理解する — CloudGoat `detection_evasion`

Rhino Security Labs社が公開する**CloudGoat**は、意図的に脆弱性を仕込んだAWS環境を`terraform`で構築できる「脆弱なクラウド演習環境（vulnerable-by-design）」である。その中の `detection_evasion` シナリオは、**AWSの監視機構（CloudTrail・GuardDuty・CloudWatch）が何をトリガーに検知するのか**を、回避側の視点から理解させることを狙いとしている。

本節は「防御側が検知ルールの死角を理解する」ためのものである。実在環境への無許可の回避行為を推奨するものではなく、あくまで自分が管理するCloudGoat演習環境での学習を前提とする。

> 出典: Rhino Security Labs「CloudGoat detection_evasion Walkthrough」 — https://rhinosecuritylabs.com/cloud-security/cloudgoat-detection_evasion-walkthrough/

#### 前提となる検知パイプラインの仕組み

このシナリオを理解する鍵は、AWSの検知が「即座」ではなく**パイプライン（多段の非同期処理）**で成り立っている点にある。

```
API呼び出し
   │
   ▼
CloudTrail がイベントを記録
   │  （配信までにラグがある）
   ▼
CloudWatch Logs のロググループへ配信
   │
   ▼
メトリクスフィルタ（metric filter）がパターンに一致
   │
   ▼
アラート発報
```

ワークスルーが明示的に指摘する重要な事実として、**「CloudTrailでのイベント生成 → CloudWatchロググループへの配信 → アラート発報」の各段階の間には有意なラグタイム（time lag）が存在する**。この非同期性そのものが、攻撃者にとっての「猶予」であり、防御側にとっては「なぜ検知が遅れるのか」を理解すべきポイントである。数分単位の遅延が生じ得るため、短時間で完結する攻撃はアラートが鳴る前に完了してしまう可能性がある。

このシナリオでは、CloudTrailログがCloudWatchロググループに流れ込み、**メトリクスフィルタ**（ログ中の特定パターンにマッチしたら数値メトリクスを増やす仕組み）が条件に一致するとアラートが発報される、という構成が使われている。

#### 2種類のアラート（検知）メカニズム

シナリオには2つの独立した検知フィルタが仕込まれている。それぞれ「何を見て」検知するかが異なる。

**(1) ハニートークン検知フィルタ（Honeytoken Detection Filter）**

特定のARNパターンに一致する認証情報が**使用された瞬間**にトリガーされる。ハニートークンとは、**「本物に見えるが、使われること自体が侵害のシグナルになる、罠として仕掛けられた認証情報」**である。CanaryTokensやSpaceSirenといったサードパーティサービスが発行するダミー認証情報が代表例で、正規の業務では絶対に使われないため、`sts:GetCallerIdentity` のような無害なAPIに使われただけでも「誰かが盗んだ認証情報を試している」と判断できる。

- **仕組み**: フィルタは、これらハニートークンに固有のARNパターンがCloudTrailログに現れたかを監視する。ハニートークンは使用＝即アラートなので、攻撃者にとっては「触れてはいけない地雷」になる。

**(2) IPベースのインスタンス検知フィルタ（IP-Based Instance Detection Filter）**

**「信頼されていないIPアドレスから使われたEC2インスタンスプロファイル認証情報」**を検知する。具体的には、CloudTrailログの `sourceIPAddress` が、そのインスタンスの本来のIP（EC2が実際に通信に使うIP）と食い違ったときにトリガーされる。

- **なぜ有効な検知なのか**: EC2インスタンスに割り当てられたロール認証情報（IMDS経由で取得される一時トークン）は、本来そのインスタンス自身からしか使われないはずである。もし同じ認証情報が**別の場所（攻撃者の手元のPCなど）から**使われれば、`sourceIPAddress` はインスタンスのIPと一致しなくなる。この不一致は「インスタンスロール認証情報が外部に持ち出された（漏洩した）」ことの強力な証拠になる。これはGuardDutyの `UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration`（インスタンス認証情報の外部利用）系ファインディングと同じ発想である。

#### 攻撃者が回避を試みる仕組み（＝防御側が塞ぐべき穴）

上の2つの検知の「トリガー条件」を理解すると、回避の理屈が見えてくる。

**ハニートークンの回避**

Rhinoは、攻撃者が **Pacu**（同社製のAWS攻撃フレームワーク）の `iam__detect_honeytokens` モジュールを使い、CanaryTokensやSpaceSirenが作った認証情報を自動判定し、**検知されたハニートークンを単に使わない**ことで回避する、と説明している。

- **仕組み**: `iam__detect_honeytokens` は、認証情報を実際にAWSに投げる前に（あるいは無害な方法で）その認証情報がハニートークン特有のパターン・発行元に一致するかを判定する。一致すれば「これは罠だ」と分かるので、攻撃者はその認証情報を使わずに他の経路を探す。
- **防御側の対抗策**: この回避が成立するのは、**ハニートークンが「見分けられる特徴」を持っているから**である。したがって防御側は、**予測困難で本物と区別のつかない命名・属性のハニートークン**を配置すべきである（後述の防御推奨に対応）。パターンで見分けられなければ、攻撃者は「安全なトークンだけを選ぶ」ことができなくなる。

**IPベース検知の回避 — VPCエンドポイントによるIP「スプーフィング」（ハードパス）**

シナリオには2つの難易度の経路があり、難しい方（hard path）では、インターネットに直接出られない（パブリックアクセスを持たない）EC2インスタンスが対象になる。ここで用いられるのが **VPCエンドポイント（VPC Endpoints）を使ってAWS APIエンドポイントを呼び出す際の送信元IPを『ハード』インスタンスのものに見せかける**技術である。

- **仕組み**: 通常、盗んだインスタンスロール認証情報を攻撃者のPCから使うと `sourceIPAddress` が攻撃者のIPになり、IPベースフィルタに引っかかる。しかし、**VPCエンドポイント**（VPC内からAWSサービスへプライベートに到達するための出口）を経由してAPIを呼ぶと、CloudTrailに記録される `sourceIPAddress` がそのVPC/インスタンス由来のものになり得る。つまり「本来のインスタンスから呼んでいるように見せかける」ことで、IPの不一致を消し、検知を回避する。ワークスルーでは、この構成をTerraformコードとして公開リポジトリで提供している。
- **認証情報の取得元**: いずれの場合も、攻撃者は **IMDS（インスタンスメタデータサービス）から認証情報を取得**する。回避の要点は、その認証情報を使う際に `sourceIPAddress` を本来のインスタンスと一致させ続けることにある。

> 出典: Rhino Security Labs「CloudGoat detection_evasion Walkthrough」 — https://rhinosecuritylabs.com/cloud-security/cloudgoat-detection_evasion-walkthrough/

#### 防御側の推奨事項（このシナリオの教訓）

シナリオが暗に示す防御策を、上で説明した「回避が成立する条件」と対応づけて整理する。

| 防御策 | なぜ効くか（回避条件をどう潰すか） |
|---|---|
| **予測困難な命名のハニートークンを配置する** | 攻撃者が `iam__detect_honeytokens` 等で「見分ける」ことを不可能にする。特徴がなければ罠を避けられない。 |
| **CloudTrailの `sourceIPAddress` 不整合を監視する** | インスタンスロール認証情報の外部持ち出しを検知する核心。VPCエンドポイント経由の偽装も含め、期待IPとの照合を厳密化する。 |
| **迅速なアラート機構を実装する** | パイプラインのラグタイム（検知の遅れ）を短縮し、攻撃完了前にアラートを間に合わせる。 |
| **IMDSv2による保護を使う** | 後述10.3節の通り、SSRF経由の認証情報窃取自体を困難にし、そもそも「持ち出せる認証情報」を減らす。 |

ここで最も重要な教訓は、**「検知は非同期パイプラインであり、ラグと死角がある」**という事実を防御側が正しく理解することである。検知ルールを「置いただけ」で安心せず、ラグの短縮・IP整合の厳密化・罠の秘匿性という3点を意識的に設計する必要がある。

> 出典: Rhino Security Labs「CloudGoat detection_evasion Walkthrough」 — https://rhinosecuritylabs.com/cloud-security/cloudgoat-detection_evasion-walkthrough/

---

### 10.3 攻撃経路の連鎖 — クラウドSSRFとAssumeRoleチェーン

AppSecure社の「SSRF in Cloud Environments: Hidden Paths」は、SSRF（Server-Side Request Forgery＝サーバ側リクエスト偽造。攻撃者が、サーバに任意のURLへリクエストを送らせる脆弱性）が、クラウドではなぜ致命的になるのか、そして単発の認証情報窃取が**多段のアカウント侵害**へと連鎖していく「隠れた経路（hidden paths）」を解説している。第2章で学んだIMDS窃取の基礎を、方法論として整理し直す位置づけである。

> 出典: AppSecure「SSRF in Cloud Environments: Hidden Paths」 — https://www.appsecure.security/blog/ssrf-cloud-environments

#### なぜクラウドでSSRFが致命傷になるのか — メタデータエンドポイント

クラウドのVM（EC2など）には、**メタデータサービス**という「自分自身に関する情報（インスタンスID、ネットワーク設定、そして最も重要なIAMロールの一時認証情報）を返す内部エンドポイント」が存在する。このエンドポイントはVM内部からのみ到達可能なリンクローカルアドレス `169.254.169.254` で提供される。SSRFで「サーバにこのアドレスへリクエストを送らせる」ことができれば、攻撃者は**そのVMのIAMロール認証情報を丸ごと奪える**。

各クラウドのエンドポイントは次の通り。

**AWS EC2 IMDS**

```
http://169.254.169.254/latest/meta-data/
http://169.254.169.254/latest/meta-data/iam/security-credentials/
http://169.254.169.254/latest/meta-data/iam/security-credentials/[role-name]
http://169.254.169.254/latest/user-data
```

`iam/security-credentials/` にアクセスするとロール名の一覧が返り、`.../[role-name]` を指定すると `AccessKeyId`・`SecretAccessKey`・`SessionToken` を含む一時認証情報が返る。**この認証情報は、そのロールに付与されたIAM権限をそのまま持つ**。ロールがS3フルアクセスを持っていれば、攻撃者もS3フルアクセスを得る。`user-data` には起動スクリプトが入り、平文シークレットが埋まっていることもある（10.1節のCloudFoxが列挙対象にしていたのと同じ領域である）。

**Azure Instance Metadata Service**

```
http://169.254.169.254/metadata/instance?api-version=2021-02-01           （要ヘッダ: Metadata: true）
http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/
```

Azureは `Metadata: true` ヘッダを要求する。マネージドID（Managed Identity）のOAuth2アクセストークンが返り、そのサービスプリンシパルに割り当てられた範囲でリソースを操作できる。

**GCP メタデータサーバ**

```
http://metadata.google.internal/computeMetadata/v1/            （要ヘッダ: Metadata-Flavor: Google）
http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token
http://metadata.google.internal/computeMetadata/v1/project/attributes/
```

GCPは `Metadata-Flavor: Google` ヘッダを要求する。サービスアカウントのOAuth2トークンが返り、そのアカウントのロールバインディング（権限割り当て）の範囲で影響が及ぶ。

> **設計上のポイント**: AzureとGCPが「特別なヘッダ」を要求するのは、素朴なSSRF（URLを差し替えるだけ）を防ぐための最初の防御線である。多くのSSRFはヘッダを自由に付けられないため、この要件だけで一部の攻撃が失敗する。AWSがIMDSv2で導入した対策（後述）も同じ発想に基づく。

#### IMDSv1 と IMDSv2 — なぜv2はSSRFを防ぐのか

AWSのIMDSには2つのバージョンがある。この違いは、SSRF防御の核心であり、10.2節の「持ち出せる認証情報を減らす」という防御策の実体でもある。

**IMDSv1**: 追加の検証なしに単純なGETリクエストを受け付ける。SSRFで `http://169.254.169.254/...` をGETさせるだけで認証情報が返るため、基本的なSSRFで悪用可能。

**IMDSv2**: **セッショントークンの事前取得を要求する**。まず`PUT`リクエストでトークンを取得し、以降のメタデータ問い合わせにそのトークンをヘッダで添える。

```
# ステップ1: PUTでセッショントークンを取得
PUT http://169.254.169.254/latest/api/token
X-aws-ec2-metadata-token-ttl-seconds: 21600

# ステップ2: 取得したトークンをヘッダに載せてメタデータへアクセス
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/
X-aws-ec2-metadata-token: <ステップ1で得たトークン>
```

**なぜこれがSSRFを防ぐのか**（仕組みレベルの説明）:

- 多くのSSRF脆弱性は「サーバに**GET**で任意URLを取得させる」ものであり、**PUTメソッドを発行できない**、あるいは**任意のリクエストヘッダ（`X-aws-ec2-metadata-token-ttl-seconds`）を付けられない**。
- IMDSv2は「PUT＋カスタムヘッダでトークンを取る」という、**単純なGET系SSRFでは再現できない2段階の儀式**を必須にした。したがって、大半のSSRFベクタはトークンを取得できず、そもそもメタデータに到達できない。
- 記事の言葉では、v2は「ほとんどのSSRFベクタがPUTリクエストやカスタムヘッダの付与をできないため、単純なSSRF悪用を防ぐ」。

これが、10.2節の防御表に出てきた「IMDSv2による保護」の実質的な中身である。

#### 権限昇格の連鎖 — AssumeRoleチェーン

SSRF→IMDSで得た認証情報が、**それ単体で終わらず**、複数アカウントの侵害へ連鎖するのが「hidden paths」の核心である。鍵となるのがAWS STS（Security Token Service）の **`AssumeRole`** である。

```
aws sts assume-role \
  --role-arn arn:aws:iam::TARGET-ACCOUNT:role/TargetRole \
  --role-session-name attack
```

**仕組み**: 侵害したIAMロールが `sts:AssumeRole` 権限を（対象ロールに対して）持っている場合、攻撃者はそのロールになりすまして**別のロール・別のアカウントの認証情報**を得られる。これを繰り返すと、アカウントAのインスタンス → ロールX → アカウントBのロールY → ……と、**クロスアカウントに横展開**していける。10.1節でCloudFoxが `role-trust` ファイルとして可視化していた「誰がどのロールをassumeできるか」の連鎖が、まさにこの攻撃経路の地図になる。列挙（CloudFox）と悪用（AssumeRoleチェーン）は表裏一体である。

**成立条件**（防御側が塞ぐべき点）: この連鎖が成立するのは、

1. 侵害されたロールに `sts:AssumeRole` 権限が付いており、かつ
2. 対象ロールの**信頼ポリシー（trust policy）**がそのロールからのassumeを許している、

の両方が満たされる場合に限る。したがって、**信頼ポリシーを最小化し、不要なassume許可を削る**ことが連鎖の遮断に直結する。

#### フィルタ回避（SSRFを通すための小技）

SSRF対策として「`169.254.169.254` という文字列をブロックする」実装は多いが、IPは複数の表記で書けるため、単純な文字列一致は容易に迂回される。記事が挙げる代表的なエンコーディング回避は次の通り。

```
http://2852039166/          # 169.254.169.254 の10進数（整数）表記
http://0xa9fea9fe/          # 16進数表記
http://0251.0376.0251.0376/ # 8進数表記
```

- **なぜ通るのか**: これらはいずれも `169.254.169.254` と**同じ32ビット整数**を表す。OSやライブラリのアドレス解決（`inet_aton` 等）は10進整数・16進・8進をすべて同じIPとして解釈する。一方、防御側の「`169.254.169.254` という**文字列**をブロックする」フィルタは、これらの別表記を素通りさせてしまう。つまり「文字列で防ぐ」と「数値で解決される」の層のズレを突いている。
- その他、**DNSリバインディング**（一度は正常なIPを返し、TTL経過後に `169.254.169.254` を返すよう切り替える）、`gopher://`・`dict://`・`file://` といった**プロトコルスマグリング**も挙げられている。

#### テスト方法論（防御側の点検手順）

記事が示す、SSRF起点のクラウド侵害を評価するための手順（自分の管理環境・許可された対象に限る）:

1. URLを入力として受け取る機能を洗い出す（画像処理、ドキュメント変換、Webhook、RSSリーダーなど）。
2. 上掲のメタデータエンドポイントへの直接アクセスを試す。
3. 各種エンコーディング回避（10進/16進/8進、DNSリバインディング）を試す。
4. クラウド固有のエンドポイント（ECSタスクメタデータ、GKE等）も確認する。
5. 盗んだ認証情報が**実際にリソースアクセスに使えるか**を確認する（トークンが返るだけでなく、権限を伴うか）。
6. `file://` プロトコルでローカルリソースの読み出しを試す。

#### 防御策（多層防御）

| 層 | 対策 | 狙い |
|---|---|---|
| メタデータ保護 | **IMDSv2をアカウント全体で強制**（AWS Config ルール、またはSCP＝サービスコントロールポリシーで） | 単純なGET系SSRFでの認証情報窃取を封じる |
| 入力検証 | 許可ドメインの**アローリスト**による厳格な入力検証 | そもそも外部・内部の不正URLへ到達させない |
| ネットワーク | **RFC1918のプライベート帯**（10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16）と**リンクローカル**（169.254.0.0/16）へのアクセスを遮断 | メタデータIPそのものへの到達を止める |
| IAM | ロール権限の**最小権限化**（Administrator権限を付けない） | 万一漏洩しても被害範囲を限定し、`AssumeRole`チェーンを断つ |
| K8s | サービスメッシュの**egress（外向き通信）フィルタリング** | Pod からメタデータ/内部への不正到達を制御 |
| 監視 | CloudTrail・Activity Log・Cloud Audit Logs での**包括的な監査ログ** | 認証情報の異常利用（10.2節のIP不整合など）を検知 |
| WAF | メタデータサービスIP帯を**ブロックするWAFルール** | アプリ層でメタデータ狙いのリクエストを遮断 |

> **章の統合的な教訓**: SSRF単体（10.3節の入口）→ IMDS認証情報窃取 → CloudFox的な列挙で `role-trust` を把握（10.1節）→ AssumeRoleチェーンで横展開 → その間、`sourceIPAddress` 不整合やハニートークンで検知される/回避される（10.2節）、という一連の連鎖が、クラウド攻撃の典型的な骨格である。防御は「入口（SSRF/IMDSv2）」「経路（最小権限・信頼ポリシー）」「検知（IP整合・ハニートークン・ラグ短縮）」の各層で同時に手を打つことで初めて連鎖を断てる。

> 出典: AppSecure「SSRF in Cloud Environments: Hidden Paths」 — https://www.appsecure.security/blog/ssrf-cloud-environments

## flaws.cloud / flaws2.cloud 常設ラボ

クラウドセキュリティを「手を動かして」学ぶ上で最も有名な常設ラボが、AWS のセキュリティエンジニア Scott Piper（IAM 権限昇格解析ツール `PMapper` の作者としても知られる）が公開した **flaws.cloud** と、その続編 **flaws2.cloud** である。どちらも本物の AWS リソース（S3・EC2・Lambda・ECS/Fargate・API Gateway など）上に意図的な誤設定を再現しており、CTF 形式でレベルを1つずつクリアしていく。破壊的な操作は不要で、読み取り系の列挙・認証情報の奪取だけで完結するように設計されている点が学習教材として優れている。本節では両ラボの構成と、各レベルが体現している「クラウド特有の脆弱性クラス」を、原理まで踏み込んで解説する。

> ⚠️ 本節は防御目的の解説である。flaws.cloud / flaws2.cloud は著者が明示的に攻撃演習を許可している教育目的の公開ラボであり、記載の手順はそのラボ内でのみ有効である。実在の本番環境・他者の AWS アカウントに対して同様の操作を行うことは、たとえ手法が同一であっても不正アクセスに該当し得るため厳禁である。

### flaws.cloud 全体像

flaws.cloud は6つのレベルで構成され、各レベルをクリアすると次のレベルの URL（サブドメイン）が手に入る。攻撃対象はレベルが進むごとに「S3 の公開設定」→「クロスアカウントアクセス」→「Git 履歴」→「EBS スナップショット」→「メタデータサービスへの SSRF」→「IAM ポリシーの読み解き」と変化し、AWS 特有の落とし穴を一通り体験できるカリキュラムになっている。

> 出典: flaws.cloud — http://flaws.cloud/

#### レベル1: S3 静的サイトホスティングとバケットの公開列挙

flaws.cloud のトップページ自体が S3 の静的website ホスティング機能で配信されている。S3 で独自ドメイン（例: `flaws.cloud`）を使う場合、バケット名をそのドメイン名と一致させる必要があるという AWS の仕様上の制約があるため、**ドメイン名が分かれば対応する S3 バケット名も自動的に分かる**。これが攻撃の起点になる。

```bash
# S3 の REST API エンドポイントを直接叩き、バケットの中身を列挙する
curl http://flaws.cloud.s3.amazonaws.com/
# もしくは AWS CLI（匿名アクセス可、--no-sign-request でも可）
aws s3 ls s3://flaws.cloud --no-sign-request
```

バケットの ACL または バケットポリシーで `s3:ListBucket` が `Principal: "*"`（誰でも）に許可されていると、上記のように XML 形式でオブジェクト一覧がそのまま返る。ここに `secret-xxxxxxx.html` のようなファイル名が含まれており、これが次レベルへのヒントになる。

**なぜそうなるか（原理）**: S3 のアクセス制御は「バケットポリシー」「ACL」「パブリックアクセスブロック設定」の3層で決まる。`ListBucket` 権限はオブジェクトの中身ではなく「一覧を見る」権限であり、これを誰にでも許可してしまうと、直接 URL を知らないファイルまで発見されてしまう。静的サイトホスティングのために `GetObject` を公開するのは一般的だが、`ListBucket` まで公開してしまうケースが実務でも頻発する誤設定である。

#### レベル2: クロスアカウントでの S3 アクセスとバケットポリシー

レベル2のバケットは、匿名（Principal `*`）ではなく「認証済み AWS ユーザーなら誰でも（`AuthenticatedUsers` グループ）」アクセスできるよう設定されている。これは S3 の「レガシー ACL」に存在する特殊なグループで、**自分の AWS アカウントを持ってさえいれば、他人のバケットを読める**という直感に反する挙動を生む。

```bash
# 自分の（無関係な）AWS アカウントの認証情報で読める
aws s3 ls s3://level2-<hash>.flaws.cloud/ --profile my-own-account
```

**なぜそうなるか**: `http://acs.amazonaws.com/groups/global/AuthenticatedUsers` という特別なグループ URI に権限を付与すると、AWS 全体のどのアカウントのユーザーでもアクセス可能になる。管理者は「社内の誰でも」を意図してこの設定をしがちだが、実際には「AWS を使っている世界中の誰でも」を意味してしまう、悪名高いミスコンフィグである。

#### レベル3: `.git` ディレクトリの公開と認証情報の漏洩

バケットの中に `.git/` フォルダがそのまま公開されている。バケット全体をローカルに同期し、Git の履歴を遡ることで、**現在のファイルには存在しないが過去のコミットには存在した認証情報**を復元できる。

```bash
aws s3 sync s3://level3-<hash>.flaws.cloud/ ./level3 --no-sign-request
cd level3
git log --all
git checkout <古いコミットハッシュ>
cat access_keys.txt   # AKIA... で始まるアクセスキーとシークレットキーが残っている
```

**なぜそうなるか**: Git はファイルを「削除」してもオブジェクトデータベース（`.git/objects`）には過去の内容を保持し続ける。`git rm` や単なる上書きコミットは、リポジトリの見た目を変えるだけでヒストリーを消さない。したがって「機密ファイルを消して再コミットした」つもりでも、`.git` フォルダごと公開されていれば、履歴を辿るだけで復元可能である。これは AWS 固有の問題ではなく、Web/クラウドを問わず `.git` ディレクトリの誤公開全般に共通する原理である。

#### レベル4: 暗号化されていない EBS スナップショットの公開

レベル3で得たアクセスキーには EC2 の読み取り権限があり、`describe-snapshots` で他アカウントに対しても公開（`Group: all`）されているスナップショットを検索できる。

```bash
aws ec2 describe-snapshots \
  --filters "Name=status,Values=completed" \
  --owner-ids <ターゲットのアカウントID> \
  --profile level3-flaws
```

見つかったスナップショットが `Public` であれば、自分のアカウントにボリュームとして作成し、自分の EC2 インスタンスにアタッチしてマウントするだけで、中のファイルシステムを丸ごと読める。ラボでは `setupNginx.sh` のようなプロビジョニングスクリプトに Basic 認証のパスワード（`nCP8xigdjpjyiXgJ7nJu7rw5Ro68iE8M`）が平文で残っていた。

**なぜそうなるか**: EBS スナップショットは「共有設定」を誤って `Public` にすると、ディスクイメージそのものが誰でもコピー可能になる。暗号化（EBS 暗号化）をしていないスナップショットであれば、コピー後は完全に中身を読める。ディスクの中には設定ファイル・シークレット・SSH 鍵・アプリケーションのソースコードなど、Web アプリのレスポンスには決して出てこない情報が大量に眠っているため、影響範囲は S3 の誤公開よりもしばしば大きい。

#### レベル5: インスタンスメタデータサービスへの SSRF

レベル4で判明したパスワードでアクセスできる EC2 上のアプリケーションは、ユーザーが指定した URL のコンテンツを取得して返す「プロキシ」機能を持つ。これはまさに **SSRF（Server-Side Request Forgery）** の典型的なシンク（sink、入力が最終的に危険な形で使われる箇所）であり、プロキシに `http://169.254.169.254/...` を渡すことで、サーバー自身に EC2 のインスタンスメタデータサービス（IMDS）を叩かせることができる。

```bash
# EC2インスタンスから見た「特別な」内部専用IP、外部からは到達不可能
curl "http://<flaws4のホスト>/proxy/169.254.169.254/latest/meta-data/iam/security-credentials/"
curl "http://<flaws4のホスト>/proxy/169.254.169.254/latest/meta-data/iam/security-credentials/flaws"
```

IAM ロールがアタッチされた EC2 インスタンスは、このエンドポイントから一時的な `AccessKeyId` / `SecretAccessKey` / `SessionToken` を無認証で取得できる（インスタンス自身が「自分はこのロールである」ことを証明する必要がないため）。SSRF によってこれをアプリケーションの外側から引き出せてしまえば、インスタンスにアタッチされた IAM ロールの権限をそのまま奪取したことになる。

**なぜそうなるか（プロトコル/内部実装レベル）**: `169.254.169.254` は AWS だけでなく多くのクラウド事業者が使う link-local アドレスで、ハイパーバイザー/ホスト側が各インスタンスに対して個別に応答を返す「そのインスタンス専用の」仮想エンドポイントである。ネットワーク的にはインスタンス内部からしか到達できない設計だが、**サーバー側でユーザー指定 URL への HTTP リクエストを代行する機能（プロキシ、Webhook、画像取得、URLプレビューなど）があると、そのリクエストの送信元は「インスタンス自身」になるため、外部の攻撃者でも間接的にメタデータへ到達できてしまう**。これが SSRF から権限奪取に至る本質的なメカニズムである。実務上の恒久対策は IMDSv2（トークンベースで `PUT` によるセッショントークン取得を必須化し、単純な SSRF では突破しづらくする）の強制利用、およびプロキシ機能側でのメタデータ IP・プライベートIPレンジへのアクセスをブロックする allowlist/denylist の実装である。

> 出典: Hacking AWS[Flaws.cloud Walkthrough] — https://kishoreramk.medium.com/hacking-aws-flaws-cloud-walkthrough-2f13083b0b4d

#### レベル6: IAM ポリシーの列挙と最終ゴール

最終レベルでは `SecurityAudit` という AWS 管理ポリシー（多くのリソースに対する読み取り専用権限を付与するポリシー）を持つユーザーの認証情報が渡される。攻撃者はこの「読み取り専用」権限だけを使い、アカウント内に他にどんなリソース・ポリシーがあるかを列挙していく。

```bash
aws iam list-attached-user-policies --user-name Level6
aws iam get-policy-version --policy-arn <カスタムポリシーARN> --version-id v1
# カスタムポリシーに apigateway:GET が許可されていることが判明
aws apigateway get-rest-apis
aws lambda list-functions
aws lambda get-policy --function-name Level6
```

これにより API Gateway 経由で Lambda 関数が呼び出し可能であることが分かり、対応する REST API のエンドポイントを直接叩くことでクリアとなる。

**なぜそうなるか**: `SecurityAudit` は「攻撃には使えない安全な読み取り専用ポリシー」と思われがちだが、実際には IAM ポリシー・Lambda の設定・API Gateway のルーティングなど、**攻撃の足がかりになる構成情報そのもの**を丸ごと読める。クラウド環境では「読み取り権限だけなら安全」という前提が成り立たないことが多く、構成情報の列挙（recon）自体が次の権限昇格の設計図になり得る、という教訓がこのレベルの核心である。

### flaws2.cloud 全体像 — サーバーレス/コンテナ編、攻守両視点

flaws2.cloud は flaws.cloud の続編で、対象技術が EC2/S3 中心から **Lambda・ECS/Fargate・ECR（コンテナレジストリ）・API Gateway** などのサーバーレス/コンテナ構成に広がっている。最大の特徴は、単なる攻撃演習にとどまらず **「Attacker（攻撃者）パス」と「Defender（防御者・インシデントレスポンダー）パス」の2本立て**になっている点で、同じシナリオを「攻める側」と「CloudTrail ログなどから事後調査する側」の両方から学べる。

> 出典: flaws2.cloud — http://flaws2.cloud/

#### Attacker パス レベル1: エラーメッセージ経由の認証情報漏洩

ラボは「100桁の PIN コードを入力せよ」という一見無理なパズルとして始まる。しかし本質は入力バリデーションの不備にある。ブラウザの開発者ツール（Network タブ）でリクエストを捕捉し、数値であるべきパラメータに文字列を挿入して再送信すると、バックエンド（Lambda 関数）が想定外の入力で例外を投げ、その **500 エラーのレスポンス本文に環境変数がそのままダンプされる**。この中に AWS のアクセスキー・シークレットキー・セッショントークンが平文で含まれている。

```bash
aws configure --profile level1-flaws2
# AccessKeyId / SecretAccessKey / SessionToken をエラーメッセージから貼り付け
aws --profile level1-flaws2 s3 ls
```

**なぜそうなるか**: サーバーレス関数（Lambda）は往々にして「動作確認用のデバッグ出力」を本番コードに残したまま、あるいはフレームワークのデフォルトのスタックトレース表示を無効化しないままデプロイされる。例外処理で `process.env` やスタックトレースをそのままクライアントに返す実装は、開発中には便利だが、本番ではシークレット漏洩の典型的な経路になる。これは Web アプリのスタックトレース漏洩問題がサーバーレス環境でも同じ形で再現される、という点で示唆的である。

#### Attacker パス レベル2: 公開 ECR（コンテナレジストリ）からのイメージ抽出

Level1 の認証情報で AWS を探索すると、`level2` という名前の ECR（Elastic Container Registry、AWS のコンテナイメージレジストリ）リポジトリが見つかる。S3 と同様、ECR にもリポジトリポリシーがあり、これが公開設定になっていると、リポジトリ名さえ分かれば誰でもイメージ層を取得できる。

```bash
aws --profile level1-flaws2 ecr batch-get-image --repository-name level2 --image-ids imageTag=latest
aws --profile level1-flaws2 ecr get-download-url-for-layer --repository-name level2 --layer-digest <digest>
# レイヤーを展開すると設定ファイルの中に /etc/nginx/.htpasswd の認証情報が残っている
```

**なぜそうなるか**: コンテナイメージはファイルシステムの層（レイヤー）をそのままアーカイブしたものであり、ビルド時に一時的にでも配置した設定ファイル・認証情報・SSH 鍵は、たとえ最終レイヤーで削除しても Git と同様に「以前のレイヤーには残る」ことが多い（マルチステージビルドを使わない Dockerfile の典型的な落とし穴）。加えてレジストリ自体のアクセス制御を誤ると、S3 バケットの公開と全く同じ構造の問題がコンテナイメージ側でも発生する。

#### Attacker パス レベル3: ECS タスクメタデータへの SSRF

Level2 で得られる Web アプリは `container.target.flaws2.cloud/proxy/<URL>` という形式のプロキシ機能を持ち、任意の URL を取得して結果を返す。flaws.cloud のレベル5と同じ SSRF の構造だが、対象は EC2 ではなく **ECS（コンテナオーケストレーションサービス）のタスク用認証情報エンドポイント** である点が異なる。

```bash
# まずプロセスの環境変数を読み、資格情報エンドポイントのURI（GUID部分）を特定する
curl "http://container.target.flaws2.cloud/proxy/proc/self/environ"
# AWS_CONTAINER_CREDENTIALS_RELATIVE_URI=/v2/credentials/<GUID> が含まれる

# ECS専用のリンクローカルIP 169.254.170.2 にそのGUIDでアクセスする
curl "http://container.target.flaws2.cloud/proxy/169.254.170.2/v2/credentials/<GUID>"
```

**なぜそうなるか**: ECS/Fargate のタスクには EC2 の IMDS（`169.254.169.254`）に代わり、`169.254.170.2` という別のリンクローカルアドレスと、タスクごとに一意な GUID を含む URI パスで認証情報が払い出される仕組みがある。GUID を知らなければ取得できない設計だが、その GUID は環境変数 `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` としてコンテナ内プロセスから読める。SSRF で `/proc/self/environ` を読める状態は、この GUID をそのまま攻撃者に渡してしまうのと同義であり、結果としてタスクにアタッチされた IAM ロールの一時認証情報を奪取できる。EC2 の IMDS 攻略と本質的に同型の脆弱性が、コンテナ環境という異なるレイヤーで再発する好例である。

#### Attacker パス レベル4〜6、および Defender パス（概説）

レベル4以降は、レベル3で取得した IAM ロールの権限を使ってさらに別の S3 バケット・Lambda・API Gateway を探索し、最終的に管理者相当のリソースへ到達する、という「権限昇格の連鎖」構造が続く。並行して用意されている **Defender パス**では、まったく同じシナリオが「すでに侵害されたアカウント」として提示され、CloudTrail のログ（誰が・いつ・どの API を・どの認証情報で呼び出したか)を読み解いて、攻撃者がどこから侵入し、どの経路で権限を昇格させたかを再構築する、インシデントレスポンスの実地演習になっている。

> ⚠️ **未取得の資料の一部**: flaws2.cloud のレベル4〜6の具体的な手順および Defender パスの詳細な CloudTrail 演習内容は、複数の一次情報源から断片的にしか取得できませんでした。網羅的な手順は下記URLからご自身で直接ご覧ください。
> - http://flaws2.cloud/（公式サイト、各レベルのヒントとリンクを保持）
> - https://kishoreramk.medium.com/flaws2-cloud-walkthrough-aws-cloud-security-5540360e512f（攻略ウォークスルー）
>
> （以下は未取得資料の補足として一般知識に基づく解説です）Defender パスの学習価値は、攻撃側の技術（S3 誤公開・SSRF・IAM ポリシー読み解き）を裏側から見ることで、「ログのどの項目を見れば同じ攻撃を検知できたか」を体得できる点にある。具体的には、`sts:AssumeRole` や `GetSessionToken` の異常な呼び出し元 IP・呼び出し元 User-Agent、通常業務では使われない API の呼び出し（`iam:ListAttachedUserPolicies` のような列挙系 API の連続呼び出し）、および短命の一時認証情報が本来アタッチされているはずのないリソースから使われている痕跡などが、実務の CloudTrail / GuardDuty 監視で着目すべき典型的なシグナルとなる。

> 出典: Flaws2.cloud WalkThrough-AWS Cloud Security — https://kishoreramk.medium.com/flaws2-cloud-walkthrough-aws-cloud-security-5540360e512f

### 両ラボを通じた設計原則のまとめ

flaws.cloud / flaws2.cloud の6+6レベルを俯瞰すると、根底にある問題は一貫して次の3つに整理できる。

1. **「公開」の粒度を誤る**: S3 の `ListBucket`、ECR のリポジトリポリシー、EBS スナップショットの共有設定など、AWS の各サービスにはそれぞれ独自の「公開」単位・スコープ（匿名・認証済み全ユーザー・特定アカウント・アカウント内のみ）が存在し、Web の感覚で「非公開のつもり」が実際には広く開いてしまう設定が多数ある。
2. **秘密情報の「消したつもり」問題**: Git の履歴、コンテナイメージのレイヤーなど、最終成果物からは見えなくても、生成過程の中間状態にシークレットが残り続ける構造がクラウド開発の随所にある。
3. **メタデータサービス/認証情報エンドポイントへの SSRF**: EC2 (`169.254.169.254`) でも ECS (`169.254.170.2`) でも、「サーバーに代理でリクエストさせる機能」がある限り、インスタンス/タスクにアタッチされた IAM 権限がそのまま奪取対象になる。これはクラウド環境における SSRF の被害が、オンプレミス環境よりも一段深刻になりやすい理由でもある。IMDSv2 の強制、プロキシ機能でのプライベート/リンクローカル IP のブロック、最小権限の IAM ロール設計が、いずれも直接の対策となる。

どちらのラボも一次情報・ヒントはラボのページ上に段階的に提示される設計であり、本節で解説した手法は「後から答えを見る」学習用途としてのみ位置づけている。

## CloudGoat（意図的脆弱AWS環境）

### この節で学ぶこと

CloudGoatは、Rhino Security Labsが公開している「意図的に脆弱な設計（vulnerable-by-design）」のAWS学習環境構築ツールです。本物のAWSアカウント上にTerraformで実際のリソース（EC2、IAM、S3、RDS、Lambda、ECSなど）を展開し、実際のクラウドAPIやメタデータサービスを相手にした攻撃演習ができる点が、静的なCTF問題との最大の違いです。防御側の視点で見れば、CloudGoatは「攻撃者がクラウド環境に対して実際にどのような順序で偵察・権限昇格・データ窃取を行うか」を安全な自分専用アカウント内で体験し、検知ルールやIAM設計のレビューに活かすための教材と位置づけられます。

> 出典: CloudGoat — Rhino Security Labs — https://github.com/RhinoSecurityLabs/cloudgoat

### アーキテクチャとインストール

CloudGoatはPython製のCLIツールで、内部でTerraformを呼び出してクラウドリソースをプロビジョニングします。現行版（CloudGoat 2系）は次のような要件を持ちます。

- Python 3.9以上
- Terraform 1.5.0以上（`$PATH`上に配置されている必要がある）
- AWS CLI（AWSシナリオ用）／Azure CLI（Azureシナリオ用）
- `jq`（JSON整形用）

インストールは`pipx`経由が推奨されています。

```bash
pipx install cloudgoat
cloudgoat config aws        # AWSプロファイル設定
cloudgoat config whitelist --auto  # 自分のグローバルIPを自動検出してホワイトリスト登録
```

「なぜホワイトリストが必要か」という点が重要です。CloudGoatが展開するEC2インスタンスのセキュリティグループやRDSのアクセス制御は、実習者自身のIPアドレスからのみ許可されるよう設計されています。これは、意図的に脆弱なAWS環境をインターネット全体に公開してしまい、第三者に悪用される事故を防ぐための安全弁です。`config.yml`にAWS/Azureの認証情報が、`whitelist.txt`に許可IPが保存され、シナリオ展開時にTerraformの変数として注入されます。

Dockerイメージも提供されており、ローカル環境を汚さずに試すことができます。

```bash
docker run -it -v ~/.aws:/root/.aws/ rhinosecuritylabs/cloudgoat:latest
```

自分のAWS認証情報ディレクトリ（`~/.aws`）をコンテナにマウントすることで、コンテナ内のCloudGoat CLIがホストの認証情報を使ってTerraformを実行できます。

> 出典: CloudGoat — Rhino Security Labs — https://github.com/RhinoSecurityLabs/cloudgoat

### コマンド体系

CloudGoatのコマンドは `cloudgoat [command] [sub-command] [--arg-name] [arg-value]` という統一構造を持ちます。中心となるのは次の5つです。

| コマンド | 役割 |
|---|---|
| `create` | 指定したシナリオのリソースをクラウド上に実際にデプロイする |
| `list` | シナリオ一覧を表示（`all`/`undeployed`/`deployed`でフィルタ、クラウド別フィルタも可） |
| `destroy` | デプロイ済みシナリオのリソースを削除し、シナリオフォルダを`./trash`へ退避 |
| `config` | IPホワイトリスト、AWS/Azureプロファイル、シェル補完の設定 |
| `help` | 文脈に応じたヘルプ（例: `cloudgoat create help`） |

```bash
cloudgoat create rce_web_app --profile my-aws-profile
# ...演習後...
cloudgoat destroy rce_web_app
```

ここで押さえるべき設計思想は、**`create`が既存の同名シナリオを検出すると自動的に破棄してから再構築する**という挙動です。これにより「前回の状態が中途半端に残っていて攻撃が再現できない」という事故を防ぎつつ、常にクリーンな状態から演習を始められます。ただし、シナリオ実行中に受講者自身が作成したリソース（例: SSHキーペアをAWS上に登録した、S3に追加オブジェクトをアップロードしたなど）はCloudGoat管理外のため`destroy`では削除されず、手動での後始末が必要な点は運用上の注意点です。

> 出典: CloudGoat — Rhino Security Labs — https://github.com/RhinoSecurityLabs/cloudgoat

### CloudGoat 2 で刷新された設計思想

初代CloudGoatは単一の大きな脆弱環境を提供する形でしたが、CloudGoat 2では「シナリオ単位で独立したTerraformモジュールを持つ」設計に全面刷新されました。各シナリオはそれぞれ専用のディレクトリに`main.tf`などのTerraform定義、`start.txt`（開始時のヒント）、`cleanup.sh`（追加リソースの後始末補助）、READMEを持ち、他のシナリオと状態を共有しません。

この刷新が防御学習の観点で重要なのは、**1つのシナリオが1つの明確な攻撃ストーリー（多くは「初期アクセス→権限列挙→権限昇格→機密データ到達」という連鎖）を体現する**ように設計されている点です。難易度はEasy／Medium／Hardに分類されており、たとえば以下のような構成です。

- Easy: `iam_enum_basics`（IAM列挙の基礎）、`iam_privesc_by_rollback`（IAMポリシーバージョンのロールバックを悪用した昇格）、`iam_privesc_by_key_rotation`（キーローテーション権限の悪用）
- Medium: `ec2_ssrf`（EC2上のWebアプリのSSRFからインスタンスメタデータ経由でIAM認証情報を窃取）、`codebuild_secrets`（CodeBuild/SSMパラメータストアからのシークレット窃取）
- Hard: `rce_web_app`（Webアプリのコマンド実行からクラウド全体への侵入）など、複数の昇格経路を持つ複合シナリオ

各シナリオは「攻撃者が実際の侵入テストで遭遇した設定ミスのパターン」をモデルにしており、Rhino Security Labsは新規シナリオの提案・実装をコミュニティにも呼びかけています。

> 出典: CloudGoat 2: The New & Improved "Vulnerable by Design" AWS Deployment Tool — Rhino Security Labs — https://rhinosecuritylabs.com/aws/introducing-cloudgoat-2/

### ウォークスルー: `rce_web_app` シナリオに見る「Web侵害からクラウド侵害への連鎖」

`rce_web_app`は、Webアプリケーションの脆弱性がどのようにクラウド基盤全体の侵害に発展するかを示す代表的なシナリオです。このシナリオは2つの独立した攻撃経路（"Lara"パスと"McDuck"パス）が用意されており、最終的に同じゴールへ収束する構成になっています。防御側として重要なのは、**入口となる脆弱性の種類が違っても、着地点（IAMロールの権限昇格とデータ窃取）が同じになる**という点です。これはクラウド環境では「境界防御を1つ破られただけで、内部のIAM設計次第では致命傷になる」ことを示しています。

**Laraパス（Webアプリ経由）**

まず偵察として、公開されているロードバランサーのアクセスログをS3バケットから取得します。

```bash
aws s3 cp s3://<lb-logs-bucket>/... .
```

ログを解析すると、ロードバランサー配下に隠しパス（秘密のURL）を持つWebアプリケーションが存在することが分かり、そこにアクセスするとコマンドインジェクションに脆弱な機能が見つかります。

```bash
whoami       # root として実行されていることを確認
curl ifconfig.co
```

「なぜrootで動くWebアプリが危険か」を仕組みレベルで説明すると、コマンドインジェクション脆弱性はアプリケーションプロセスの実行ユーザーの権限をそのまま攻撃者に付与します。rootで動いていれば、任意のシステムファイルの読み書き、他ユーザーの認証設定の改ざんが可能になります。実際にこのシナリオでは、RCEを使って自分のSSH公開鍵をOSユーザー（ubuntu）の`authorized_keys`に追記し、パスワードなしでSSHログインできる永続的な足場を作ります。

```bash
echo "<公開鍵>" >> /home/ubuntu/.ssh/authorized_keys
```

これは典型的な「RCEを一時的な処刑コンテキストから永続的なシェルアクセスへ昇格させる」手口で、`authorized_keys`ファイルへの書き込み権限があれば、公開鍵認証の仕組み上、対応する秘密鍵を持つ攻撃者はいつでも正規のSSHセッションとして接続できてしまいます。

**McDuckパス（認証情報の直接露出）**

もう一方の経路では、S3バケットに置かれたSSH秘密鍵ファイルをそのままダウンロードします。

```bash
aws s3 cp s3://cg-keystore-s3-bucket/cloudgoat .
```

これはWebアプリの脆弱性すら不要な、シンプルな「バケットの権限設定ミスによる鍵の露出」であり、クラウド環境でしばしば実際に発生するミスです。

**収束点: インスタンスメタデータサービス経由のIAM認証情報窃取**

どちらの経路でも、最終的にはEC2インスタンスへSSHログインします。

```bash
ssh -i <private_key> ubuntu@<public_ip>
```

ここが本シナリオの核心です。EC2インスタンスにIAMロールがアタッチされている場合、インスタンス内部からはAWS CLIの追加設定なしにインスタンスメタデータサービス（IMDS、`169.254.169.254`）経由で一時的なIAM認証情報を取得できます。これはEC2の設計上の機能であり、インスタンス上で動くアプリケーションがAWS APIを呼び出せるようにするための仕組みですが、**インスタンス上で任意コード実行を獲得した攻撃者にとっては、そのままIAMロールの権限を丸ごと乗っ取る手段**になります。AWS CLIやSDKはEC2上で実行されると自動的にこのメタデータ経由の認証情報を利用するため、攻撃者は追加の認証情報入力なしにIAMロールの権限で操作を続行できます。

```bash
aws s3 ls s3://cg-secret-s3-bucket/ --recursive
aws s3 cp s3://cg-secret-s3-bucket/db.txt .
```

取得した`db.txt`にはRDSデータベースの接続情報が記載されており、最終的にデータベースへ直接接続してフラグ（機密情報）を取得します。

```bash
psql postgresql://cgadmin:Purplepwny2029@<rds-instance>:5432/cloudgoat
select * from sensitive_information;
```

このウォークスルー全体が示す教訓は、**「Webアプリのコマンドインジェクション」→「SSH永続化」→「IAMロールの窃取」→「RDSの機密データ到達」という、レイヤーをまたいだ攻撃チェーン**です。防御側はこれを踏まえ、(1) Webアプリのroot実行を避ける最小権限化、(2) EC2にアタッチするIAMロールの権限を必要最小限にするIAMポリシー設計、(3) IMDSv2（トークン必須化）の強制によるSSRF経由でのメタデータ窃取対策、(4) RDS認証情報をプレーンテキストでS3やテキストファイルに置かない（Secrets Managerの利用）、といった多層的な対策の必要性を学べます。

> 出典: CloudGoat Official Walkthrough Series: "rce_web_app" — Rhino Security Labs — https://rhinosecuritylabs.com/aws/cloudgoat-walkthrough-rce_web_app/

### 学習効果を高める使い方（防御目線）

CloudGoatのシナリオは攻撃技術の習得だけでなく、**検知ルールやアラートの有効性検証**にも使えます。たとえば`rce_web_app`のような環境を自分専用のAWSアカウントに展開した状態で、CloudTrailやGuardDutyのログを観察すれば、「IAMロールの認証情報がEC2以外の場所（攻撃者の端末）から使われた」という異常検知が実際にどう記録されるかを確認できます。これは、座学だけでは得にくい「実際のログの形」を理解する上で非常に有効です。

なお、CloudGoatは本番環境やAWS Organizationsの共有アカウントでの実行を強く禁止しています。展開されるリソースは意図的に脆弱であり、ホワイトリスト機能を使っても完全に閉じられるわけではないため、必ず専用の使い捨てAWSアカウント（学習用サンドボックスアカウント）で実行し、演習後は`destroy`と手動確認の両方でリソースを完全に削除することが安全な運用の前提になります。

> 出典: CloudGoat — Rhino Security Labs — https://github.com/RhinoSecurityLabs/cloudgoat

### 未取得の資料について

> ⚠️ **未取得の資料**: 「Working with CloudGoat: The "vulnerable by design" AWS environment」（Infosec Institute）は自動取得できませんでした（理由: アクセス先サーバーがHTTP 403を返却、代替ドメインもDNS解決に失敗し取得不可）。以下のURLからご自身で直接ご覧ください: https://www.infosecinstitute.com/resources/cloud/working-with-cloudgoat-the-vulnerable-by-design-aws-environment/

（以下は未取得資料の補足として一般知識に基づく解説です）Infosec Instituteのこの記事は、CloudGoatの導入からシナリオ実行までの一連の流れを初学者向けに整理したチュートリアル記事シリーズの入口にあたるものです。一般に、このようなハンズオン系記事では、AWS CLIのプロファイル作成（`aws configure --profile cloudgoat`）、IAMユーザーへの一時的な管理者権限付与、CloudGoatの`create`コマンドによるシナリオ展開、AWSマネジメントコンソールでの作成済みリソースの確認、シナリオごとの攻撃ステップの実演、そして最後に`destroy`コマンドによる後片付けという流れで構成されることが多く、本節で解説したRhino Security Labs公式のウォークスルーと内容的に重なる部分が大きいと考えられます。実際の学習では、公式リポジトリのREADMEおよび各シナリオのSTART/SOLUTIONドキュメントを一次情報として参照することを推奨します。

### まとめ

CloudGoatは、静的な学習教材では得にくい「実際のAWS API・IAMロール・メタデータサービスの挙動」を安全に体験できる、防御側の理解を深める上でも価値の高いハンズオン環境です。シナリオ単位でTerraform管理された独立環境、`create`/`destroy`による再現性の高いライフサイクル管理、そして`rce_web_app`に見られるような「Web層の脆弱性がクラウドのIAM権限昇格へ連鎖する」設計は、実務におけるクラウドセキュリティレビューやインシデント対応シミュレーションの土台として活用できます。演習は必ず専用のサンドボックスAWSアカウントで行い、実サービスや本番環境に対しては一切適用しないことが大前提です。

## IAM Vulnerable / CloudFoxable / AWSGoat

クラウドセキュリティ、とりわけAWSのIAM（Identity and Access Management、権限管理サービス）まわりの攻撃手法は、座学だけでは身につきにくい分野です。IAMポリシーのJSONを目で読んでも、それがどう権限昇格（privilege escalation、低い権限のプリンシパルがより高い権限を得ること）につながるかは、実際にAWSアカウント上で手を動かして確認しないと直感的に理解できません。本節では、そうした実践演習のために作られた3つのオープンソース環境——**IAM Vulnerable**、**CloudFoxable**、**AWSGoat**——を紹介します。いずれも「防御側の学習」を目的として意図的に脆弱に作られた環境であり、実運用のAWSアカウントとは切り離した専用アカウントで使うことが大前提です。本書では、これらの環境を使った具体的な攻略手順（いわゆる「ラボ攻略」）には立ち入らず、各ツールが何を教えてくれるのか、その設計思想と仕組みを解説します。

### なぜハンズオン環境が必要なのか

IAMの権限昇格は、単一の脆弱な設定だけで成立することは少なく、「あるポリシーが許可しているAPIアクション」と「そのAPIアクションが持つ副作用」の組み合わせで初めて悪用可能になります。たとえば `iam:PassRole` というアクションは一見無害に見えますが、これは「あるIAMロールを他のAWSサービスに引き渡す権限」であり、そのロール自体が強力な権限を持っていて、かつそのロールを引き渡せるサービス（Lambda、EC2、CloudFormationなど）でコードやコマンドを実行できるなら、間接的に管理者権限まで到達できてしまいます。こうした「権限の連鎖」を理解するには、実際にポリシーをアタッチしたIAMユーザーとしてログインし、AWS CLIやPacu（AWS専用の攻撃フレームワーク）を使って列挙・悪用の手順を踏むのが最も効果的です。IAM Vulnerable、CloudFoxable、AWSGoatは、この学習体験を安全かつ再現可能な形で提供するために設計されています。

### IAM Vulnerable（BishopFox、31 privesc経路）

#### 概要と仕組み

IAM Vulnerableは、セキュリティ企業BishopFoxが公開しているTerraform（HashiCorp社のInfrastructure as Codeツール。設定ファイルに書いたインフラ構成をクラウド上に再現できる）構成ファイル集です。`terraform apply` を実行すると、単一のAWSアカウントに250以上のIAMリソース（ユーザー、ロール、ポリシー）がデプロイされ、そのうち31個が、それぞれ異なる仕組みで権限昇格を許してしまう「意図的に脆弱な経路」として設計されています。

```bash
git clone https://github.com/BishopFox/iam-vulnerable
cd iam-vulnerable
terraform init
terraform plan   # 何が作られるか事前確認
terraform apply  # 実際にデプロイ
```

なぜ `terraform plan` を先に実行するかというと、Terraformは宣言的にインフラの「あるべき状態」を記述するツールであり、`apply` は現在のAWSアカウントの状態を書き換える破壊的操作になり得るからです。`plan` はドライラン（実際には変更を加えず、何が変更されるかだけを表示する実行モード）であり、意図しないリソースが作られたり、既存のリソースが上書きされたりしないかを事前に確認できます。BishopFoxのドキュメントは「本番環境やデータを含むアカウントでは絶対に実行しないこと」を強く警告しています。IAMリソースを大量に作成するため、既存のIAM構成と衝突したり、後片付け（`terraform destroy`）に失敗したりするリスクがあるためです。万が一Terraformの状態ファイル（`.tfstate`、作成したリソースの管理台帳）が失われた場合に備え、リポジトリにはPythonとBashの両方でクリーンアップスクリプトが同梱されています。

#### 31個の権限昇格経路の分類

IAM Vulnerableが実装する31経路は、悪用に使われるAPIアクションの性質によって大きく次のように分類できます。

1. **IAM他ユーザーの認証情報を操作する経路（3種）**
   `iam:CreateAccessKey`（他ユーザーの新しいアクセスキーを発行できる）、`iam:CreateLoginProfile` / `iam:UpdateLoginProfile`（他ユーザーのコンソールログイン用パスワードを設定・変更できる）。これらの権限を持つプリンシパルは、より強い権限を持つ別のIAMユーザーになりすませます。なぜなら、アクセスキーやパスワードを新規発行できるということは、そのユーザーの認証情報を事実上乗っ取れることと同義だからです。

2. **サービスへのPassRoleを悪用する経路（13種）**
   CloudFormation、CodeBuild、DataPipeline、EC2、Glue、Lambda（複数バリエーション）、SageMaker（複数バリエーション）といったサービスに対して、`iam:PassRole` と当該サービスの起動系アクション（例: `lambda:CreateFunction` や `ec2:RunInstances`）の両方を持つ場合に成立します。仕組みとしては、AWSの多くのマネージドサービスは「実行時にどのIAMロールを引き受けるか」を呼び出し元が指定できるようになっており、`PassRole` はまさに「このロールをこのサービスに引き渡してよい」という許可です。攻撃者は、強い権限を持つロールをEC2インスタンスやLambda関数に紐付けて起動し、そのインスタンス/関数の中からロールの権限を使ってコードを実行することで、間接的に昇格します。

   ```json
   {
     "Effect": "Allow",
     "Action": ["iam:PassRole", "lambda:CreateFunction", "lambda:InvokeFunction"],
     "Resource": "*"
   }
   ```
   このポリシーを持つユーザーは、管理者権限を持つロールをLambda関数に割り当てて作成し、その関数内で任意のAWS APIを呼び出すコードを実行させることで、管理者権限を事実上獲得できます。

3. **IAMポリシー自体を操作する経路（11種）**
   `iam:AddUserToGroup`、`iam:AttachGroupPolicy`、`iam:AttachRolePolicy`、`iam:AttachUserPolicy`、`iam:CreateNewPolicyVersion`（カスタマー管理ポリシーの新バージョンを作成できる。IAMポリシーはバージョン管理されており、新しいデフォルトバージョンを作ることは実質的にポリシー内容の書き換えと同じ）、`iam:PutGroupPolicy` / `iam:PutRolePolicy` / `iam:PutUserPolicy`（インラインポリシーの追加・上書き）、`iam:SetExistingDefaultPolicyVersion`（既存の別バージョンをデフォルトに戻す。過去に管理者権限を与えていたバージョンが残っていれば、それを再度有効化できる）。これらはいずれも「自分自身、あるいは自分が所属するグループ・ロールに、より強いポリシーを後から付け足せる」という直接的な昇格経路です。

4. **AWSサービス経由での間接的な昇格（8種）**
   EC2 Instance Connect（EC2インスタンスへSSH公開鍵をpushして接続できる機能）、CloudFormationのスタック更新、Glueジョブ、Lambda関数のコード編集、SageMakerのノートブックインスタンス、SSM（Systems Manager、複数種）、STSのAssumeRoleなど。これらは「すでに存在する高権限のリソース（実行中のEC2やLambda）を操作・乗っ取りできる」ことによる昇格です。たとえば `lambda:UpdateFunctionCode` を持つユーザーは、既存の高権限ロールにアタッチされたLambda関数の中身を、任意のコードを実行するものに書き換えられます。

5. **AssumeRoleポリシー自体を書き換える経路（1種）**
   ロールの信頼ポリシー（trust policy、「誰がこのロールをAssumeできるか」を定義するポリシー）を編集できる権限を持てば、信頼ポリシーの `Principal` に自分自身を追加することで、そのロールを自由に引き受けられるようになります。

> 出典: IAM Vulnerable (BishopFox) — https://github.com/BishopFox/iam-vulnerable

#### 検出ツールとの組み合わせ

IAM Vulnerableは「脆弱性を作る」側のツールであり、それ単体では攻撃も検出もしません。BishopFoxはこれを、Cloudsplaining（IAMポリシーを静的解析し、過剰な権限を検出するツール）、PMapper（Principal Mapper、IAMプリンシパル間の権限昇格グラフを可視化するツール）、Pacu（AWS専用のペネトレーションテスト・フレームワークで、権限列挙から昇格モジュールまで揃っている）といった「検出・悪用ツール」を実際に動かして試すための土台として設計しています。この組み合わせにより、「検出ツールが本当に31種類の昇格経路を漏れなく見つけられるか」を評価する、いわばIAM監査ツールのベンチマークとしても使えます。

### CloudFoxable（BishopFox、CTF形式のクラウドペンテスト演習）

#### 概要と設計思想

CloudFoxableもBishopFoxが公開している教育用環境ですが、IAM Vulnerableとは目的が異なります。CloudFoxableは「AWSクラウドペンテストの技法そのものを教える」ことを目的とした、**CTF（Capture The Flag）形式**の演習環境です。CloudGoat（Rhino Security Labsによる先行する脆弱AWS環境）、flaws.cloud（有名な公開型クラウドセキュリティCTF）、Metasploitable（伝統的な脆弱VM）からインスピレーションを受けて設計されており、複数のフラグ（攻略成功の証となる文字列やリソース）を、実際の攻撃経路をたどって発見していく形式を取ります。

現時点でCloudFoxableが対象とするのはAWS環境のみです。これは、姉妹ツールであるCloudFox自体がAWSとGCP（Google Cloud Platform）の両方に対応しているのとは対照的で、演習環境としてはAWSに絞って深さを追求している設計だと理解できます。

#### CloudFoxとの関係

CloudFoxは、クラウド環境に対して大量の列挙コマンド（enumeration commands）を実行し、「攻撃経路を照らし出す（illuminate attack paths）」ことを目的としたオープンソースの偵察ツールです。侵入テスターがクラウド環境に足がかりを得た後、「次にどこを攻めればよいか」を素早く把握するために使われます。CloudFoxableは、このCloudFoxというツールの有用性を、実際に手を動かして体感するための実践プラットフォームという位置づけです。つまり、CloudFoxが「地図を描くツール」だとすれば、CloudFoxableは「その地図を使って実際に探索する迷路」に相当します。

#### 学習方法

CloudFoxableはワークショップ資料、ブログ記事、デモ動画といった学習コンテンツとセットで提供されています。利用者はCloudFoxやAWS CLI、Pacuなどのツールを使いながら、デプロイされた環境内に散りばめられたフラグを見つけていくことで、S3バケットの誤設定、IAMロールの過剰権限、Lambda環境変数への機密情報の混入といった、実際のクラウド環境でよく見られる攻撃経路のパターンを体系的に学べます。

> 出典: CloudFoxable (BishopFox) — https://bishopfox.com/tools/cloudfox-tool

### AWSGoat（INE、OWASP Top 10＋AWS誤設定）

#### 概要と設計思想

AWSGoatは、セキュリティ教育企業INE（Pentester Academyの運営元）が公開している「vulnerable by design（意図的に脆弱に設計された）」AWSインフラストラクチャです。IAM Vulnerableが「IAMの権限昇格」という単一テーマに特化しているのに対し、AWSGoatはより広く、**アプリケーション層の脆弱性（OWASP Top 10）とクラウドインフラの誤設定を組み合わせた、実際のWebアプリケーションを模した環境**を提供する点が特徴です。

#### モジュール構成

AWSGoatは複数の独立したモジュールとして提供されており、それぞれ異なるAWSアーキテクチャパターンを題材にしています。

- **Module 1: サーバーレスブログアプリケーション** — Lambda、S3、API Gateway、DynamoDBを組み合わせたサーバーレス構成。ブラックボックス的なアプローチで、複数の侵害経路（chained vulnerabilities、単発の脆弱性ではなく複数を連鎖させて最終的な侵害に至る設計）が仕込まれています。稼働コストの目安は時間あたり0.0125ドルと案内されています。
- **Module 2: HR給与管理アプリケーション** — AWS ECS（Elastic Container Service、コンテナオーケストレーションサービス）を基盤とした、社内向け業務アプリケーションを模した構成。コンテナ環境特有の攻撃面（コンテナブレイクアウトなど）を学べます。時間あたりの目安コストは0.0505ドルです。

#### 含まれる脆弱性のカテゴリ

AWSGoatが組み込んでいる脆弱性は、OWASP Top 10 2021（Webアプリケーションセキュリティの代表的なリスク分類）に沿ったアプリケーション層の脆弱性と、AWS特有のクラウド設定不備の両方にまたがります。

- アプリケーション層: XSS（クロスサイトスクリプティング）、SQLインジェクション、安全でない直接オブジェクト参照（IDOR）、SSRF（サーバーサイドリクエストフォージェリ。特にLambda関数の実行環境からクラウドのメタデータサービスなどへ到達する経路として悪用されやすい）、機密情報の露出
- クラウド基盤層: S3バケットの設定ミス（パブリック公開や過剰な読み書き権限）、IAMロールの権限昇格経路、ECSコンテナからのブレイクアウト（コンテナの分離が破られ、ホストや他のコンテナ・IAMロールへアクセスできてしまう状態）

このように「入口はWebアプリケーションの脆弱性、出口はクラウドインフラの権限昇格」という一連の流れを体験できるよう設計されており、実際のインシデントでよく見られる「アプリ層の穴からクラウド全体を掌握される」というシナリオの縮図になっています。

#### デプロイ方法

AWSGoatは自動デプロイと手動デプロイの両方をサポートしています。自動デプロイでは、AWS認証情報をGitHub Secretsに登録した上でGitHub Actionsのワークフローを使ってTerraformを実行します。手動デプロイの場合は、他の2ツールと同様にTerraformベースの標準的な手順を踏みます。

```bash
git clone https://github.com/ine-labs/AWSGoat
aws configure
cd AWSGoat/Module-1  # 対象モジュールのディレクトリへ
terraform init
terraform apply
```

デプロイにはAWS管理者権限相当、もしくはそれに準じるカスタムIAMポリシーが必要とされており、AWSフリーティアの範囲内であれば無料枠で試せますが、超過分は前述の時間単価で課金されます。動作環境としてはLinux（`/bin/bash`）とChromeブラウザが推奨されています。

> 出典: AWSGoat (ine-labs) — https://github.com/ine-labs/AWSGoat

### 3ツールの位置づけの違いと選び方

| 観点 | IAM Vulnerable | CloudFoxable | AWSGoat |
|---|---|---|---|
| 学習の焦点 | IAM権限昇格そのもの（31経路を網羅的に） | クラウド偵察・攻撃経路発見のワークフロー（CTF形式） | Webアプリ脆弱性からクラウド侵害へ至る一連の流れ |
| 構成 | IAMリソースのみ（250超） | AWS環境全般、フラグ探索形式 | サーバーレス／コンテナのフルスタックアプリ |
| 主に使うツール | Pacu、Cloudsplaining、PMapperなど検出ツール全般 | CloudFox、AWS CLI | ブラウザ、Burp Suite等のWebツール＋AWS CLI |
| 想定読者 | IAMポリシーの設計・監査を学びたい人 | クラウド侵入テストの実務フローを学びたい人 | クラウドネイティブアプリのセキュリティを一気通貫で学びたい人 |

いずれの環境も、防御側の学習を目的として公開されているオープンソースプロジェクトです。実際に手元で動かす際は、必ず検証専用に分離したAWSアカウントを用意し、組織のポリシーで許可されている範囲内で、かつ使用後は `terraform destroy` 等で確実にリソースを削除することが、コスト面・セキュリティ面の両方から強く推奨されます。本番アカウントや共有アカウントでの実行は、どのプロジェクトのドキュメントでも明確に禁止されています。

## ガイド付きラボとCTF集約

クラウドセキュリティは座学だけでは身につきにくい分野である。IAM（Identity and Access Management、アイデンティティとアクセス管理）ポリシーの評価ロジック、メタデータサービスの挙動、権限昇格チェーンの組み立て方は、実際に脆弱な環境へアクセス制御を試し、失敗と成功を繰り返して初めて「仕組みレベル」で理解できる。本節では、防御的な学習目的で安全に使えるガイド付きラボプラットフォームと、無料で公開されているクラウドセキュリティCTF・自習環境の集約リストを紹介する。いずれも許可された学習用環境であり、実在の本番サービスに対する無許可の検証は対象外である。

### なぜハンズオン環境が必要か

クラウドの脆弱性は、Webアプリケーションのそれと異なり「単一のリクエストで再現できるバグ」ではないことが多い。たとえばIAMの権限昇格は、複数の小さな権限（`iam:PassRole`、`lambda:CreateFunction`、`lambda:InvokeFunction`など）が組み合わさって初めて成立する「攻撃パス」として現れる。こうしたパスは、実際にクラウドコンソールやCLI（Command Line Interface、コマンドライン操作用のツール）でAPIを叩き、ポリシー評価の結果を目で確認しないと直感が育たない。ガイド付きラボは、この試行錯誤を安全な使い捨て環境で行わせることで、学習者が「なぜこのポリシーだと昇格できるのか」という因果関係を体得できるようにする仕組みである。

### Pwned Labs — クラウド/AI/K8sのガイド付きラボ

Pwned Labsは、クラウド・AI・Kubernetes・CI/CD・ハイブリッド環境を横断した実践的なハンズオン型セキュリティ学習プラットフォームである。ブラウザベースでラボ環境が提供されるため、学習者自身がAWSアカウントやKubernetesクラスタを構築する必要がなく、参入障壁が低い点が特徴である。

#### 対象範囲と提供形式

対象となる技術スタックは以下の通り広範囲に及ぶ。

- **クラウドプラットフォーム**: AWS、Microsoft Azure、Google Cloud、Oracle Cloud Infrastructure（OCI）
- **SaaS/コラボレーション基盤**: Microsoft 365、Google Workspace
- **コンテナ/オーケストレーション**: Kubernetes
- **開発パイプライン**: CI/CD（継続的インテグレーション/継続的デリバリー）
- **新興領域**: AIシステム、LLM（大規模言語モデル）/チャットボット、AIエージェントに対する攻撃

提供形式は3種類に分かれており、学習の深度に応じて選択できる。

| 形式 | 内容 |
|---|---|
| Academy（アカデミー） | ガイド付きの段階的ラボ。無料プランでも一部利用可能で、初学者が仕組みを順を追って学べる |
| Bootcamps | インストラクター主導の集中講座。修了により認定資格を取得できる有料プログラム |
| Cyber Ranges | 本番環境に近い規模・複雑さを再現した攻防シミュレーション環境 |

#### 学習できる具体的なシナリオ

攻撃側（Red Team視点）のシナリオとしては、フィッシングを起点とした初期アクセス獲得、C2（Command and Control、攻撃者が侵害端末を遠隔操作する通信基盤）の確立とパーシステンス（persistence、再起動やログオフ後も攻撃者のアクセスを維持する手法）、LLMに対するプロンプトインジェクション（AIへの入力に悪意ある指示を混入させ、意図しない出力や権限逸脱を引き起こす攻撃）、認証情報の窃取と横展開（lateral movement、侵害した一台の権限を足がかりに他のリソースへ移動すること）が扱われる。

防御側（Blue Team視点）のシナリオとしては、テレメトリ（クラウド監査ログやメトリクスなどの観測データ）の収集とアラート設計、サイバーキルチェーン（攻撃者が目的達成までに踏む一連の段階モデル）に沿った検知ルールの作成、インシデント対応プレイブックの運用が含まれる。この両輪構成は、攻撃技術を学ぶだけでなく「その痕跡をどう検知し、どう対応するか」まで一貫して学べる設計になっている点が教育的に重要である。なぜなら、攻撃手法の理解と検知ロジックの設計は表裏一体であり、片方だけを学んでも実務の防御力にはつながりにくいからである。

#### 対象読者と認定資格

初心者から上級のセキュリティチームまでを対象とし、特にRed Team・Blue Team・Purple Team（攻守双方の視点を統合するチーム）の実務者を想定している。ACRTP、MCRTPなど7種類の実践的認定資格が用意されており、Ford、Capital One、Vodafoneといった大手企業でも導入実績があるとされる。

#### 学習上の位置づけ

Pwned Labsの強みは、ブラウザ完結型で環境構築コストがゼロに近いことと、攻撃と検知を対にした設計にある。一方で、無料枠で触れられる範囲は限定的であり、体系的に全領域を学ぶには有料プランやBootcampsが必要になる。したがって、まずは無料のAcademyラボでIAM権限昇格やメタデータサービス悪用といった基礎的な攻撃パターンの「感覚」を掴み、より高度なAIエージェント攻撃やCI/CD侵害のシナリオへ進む段階的な使い方が現実的である。

> 出典: Pwned Labs — https://pwnedlabs.io/

### Awesome-CloudSec-Labs — 無料ラボ・CTF集約リスト

Awesome-CloudSec-Labs（GitHub: iknowjason/Awesome-CloudSec-Labs）は、クラウドネイティブセキュリティを無料で学べるハンズオンラボ、CTF、自習用の脆弱環境（intentionally vulnerable environment、意図的に脆弱に作られた学習用環境）をキュレーションしたリストである。個別サービスとは異なり、既存のOSS（オープンソースソフトウェア）プロジェクトやコミュニティ主催CTFへのリンク集という性質を持つため、学習者は自分の興味やクラウドプロバイダに応じて選択的に取り組める。

#### AWS向けラボ

AWSは対応ラボの数が最も多く、IAM権限昇格を中心テーマとするものが目立つ。

**The Big IAM Challenge**（https://bigiamchallenge.com/）は、IAMポリシーの設定ミスを特定・悪用するCTF形式のチャレンジである。難易度は中程度で、実際のAWSアカウント上でIAMポリシーの評価ロジック（明示的Deny優先、リソースベースポリシーとアイデンティティベースポリシーの組み合わせ評価など）を突いて権限昇格経路を発見させる。IAMのポリシー評価がなぜ複雑なのか、どこに設定ミスが生まれやすいのかを実地で学べる代表的教材である。

**flaws.cloud**（http://flaws.cloud）と**flaws2.cloud**（http://flaws2.cloud）は、レベル制のCTFで、各レベルにヒントが用意されている。flaws.cloudはS3バケットの設定ミス、公開スナップショット、脆弱なEC2インスタンスなどAWSの基本的な設定ミスパターンを段階的に学ぶ構成であり、flaws2.cloudは攻撃者ルートと防御者ルートの2つの進路を選べる点が特徴で、防御的な視点の学習にも活用できる。

**CloudGoat**（https://github.com/RhinoSecurityLabs/cloudgoat）はRhino Security Labsが公開する、Terraform（インフラをコードで定義・構築するツール）で構築する「シナリオ型」の脆弱AWS環境である。31種類の権限昇格パターンを収録し、自分のAWSアカウント上にデプロイして自習する形式のため、中〜上級者向けである。

**IAM Vulnerable**（https://github.com/BishopFox/iam-vulnerable）はBishop Foxが公開する、31の権限昇格攻撃パスウェイに特化した教材で、IAMポリシーの組み合わせによる昇格ロジックを網羅的に学べる上級者向け教材である。

**CloudFoxable**（https://github.com/BishopFox/cloudfoxable）は自習用の脆弱AWSペネトレーション環境で、偵察ツール（cloudfox等）を用いた列挙から攻撃パス発見までの一連の流れを体験できる中級者向け教材である。

**The Ultimate Cloud Security Championship**（https://www.cloudsecuritychampionship.com/）はWizが主催する月次CTFチャレンジで、難易度は回によって変動する。継続的に新しいシナリオが供給されるため、最新の設定ミスパターンを追い続けたい学習者に向く。

#### Azure向けラボ

**EntraGoat**（https://github.com/Semperis/EntraGoat）はSemperisが公開する、Microsoft Entra ID（旧Azure AD、Azureのアイデンティティ基盤）を対象にした脆弱インフラで、6つの攻撃シナリオが用意されている。Entra ID特有の条件付きアクセスやロール割り当ての誤設定を学ぶのに適している。

**Broken Azure**（https://www.brokenazure.cloud/）はホスト型のCTFで、Terraformによる自習型デプロイのオプションも提供する。

**XMGoat**（https://github.com/XMCyber/XMGoat）はXM Cyberが公開する教材で、5つのシナリオと解決手順のドキュメントが付属し、独学でも進めやすい構成になっている。

#### GCP向けラボ

**Thunder CTF**（https://thunder-ctf.cloud/）は6レベル構成で、GCP（Google Cloud Platform）上に構築された脆弱なクラウドプロジェクトを攻略する形式である。

**GCP Goat**（Josh Jebaraj氏公開、https://gcpgoat.joshuajebaraj.com/）はガイド付きのMdbook形式ワークブックとして提供され、GCPのIAMやサービスアカウント関連の設定ミスを段階的に学べる。

#### Kubernetes/コンテナ向けラボ

**OWASP EKS Goat**（https://eksgoat.kubernetesvillage.com）はOWASPコミュニティが公開する、AWS EKS（Elastic Kubernetes Service）を対象とした自習型教材で、20以上の攻撃・防御ハンズオンラボを収録する。

**Kubernetes Goat**（https://github.com/madhuakula/kubernetes-goat）はGKE/EKS/AKSいずれのマネージドKubernetesにも対応するマルチクラウド構成の教材で、ガイド付きで進められる。

**Kube Security Lab**（https://github.com/raesene/kube_security_lab）はローカルのDocker環境上に14種類の脆弱なKubernetesクラスタを構築する教材で、クラウド利用料を発生させずに学べる点が特徴である。

#### CI/CD向けラボ

**CI/CD Goat**（https://github.com/cider-security-research/cicd-goat）はCI/CDパイプラインを対象としたCTFで、Docker上で動作する。パイプライン設定の誤りやシークレット漏洩などを学ぶ。

**GitHub Actions Goat**（https://github.com/step-security/github-actions-goat）はGitHub上でホストされる教材で、GitHub Actionsワークフローに対する脅威シナリオがMITRE ATT&CK等のフレームワークにマッピングされている。

#### 主要トピック別の対応表

| トピック | 代表的なラボ |
|---|---|
| IAM/権限管理 | The Big IAM Challenge、IAM Vulnerable |
| S3/オブジェクトストレージの設定ミス | flaws.cloud |
| 権限昇格チェーン | CloudGoat、IAM Vulnerable |
| Entra ID/Azure AD | EntraGoat、XMGoat |
| GCPサービスアカウント/IAM | Thunder CTF、GCP Goat |
| Kubernetesクラスタの侵害 | Kubernetes Goat、OWASP EKS Goat、Kube Security Lab |
| CI/CDパイプライン侵害 | CI/CD Goat、GitHub Actions Goat |
| Infrastructure as Codeの脆弱性 | TerraGoat（Terraformテンプレートの脆弱パターン集） |

#### 料金体系と学習の進め方

このリストに掲載されているラボはほぼすべて無料で利用できる。ただし「無料」であっても、CloudGoatやIAM VulnerableのようにTerraformで自分のクラウドアカウント上にデプロイする形式のものは、実際にはクラウドリソースの利用料金（多くは少額だが、放置すると想定外の課金につながりうる）が別途発生する点に注意が必要である。学習後は必ず`terraform destroy`等でリソースを破棄し、不要な請求を防ぐ運用が望ましい。一方、flaws.cloudやThunder CTF、The Big IAM Challengeのようにホスト型で提供されるラボは、運営側のアカウント上で動作するため学習者側の課金リスクがない。

進め方としては、まずホスト型で無料・低リスクなflaws.cloudやThe Big IAM Challengeでクラウド特有の設定ミスパターンに慣れ、次にCloudGoatやIAM Vulnerableのような自習デプロイ型でより複雑な権限昇格チェーンの構築を体験し、最後にKubernetes GoatやCI/CD Goatで周辺エコシステム（コンテナオーケストレーション、パイプライン）へと学習範囲を広げる段階的アプローチが効率的である。

> 出典: Awesome-CloudSec-Labs (iknowjason) — https://github.com/iknowjason/Awesome-CloudSec-Labs

### まとめ

Pwned LabsはAI/LLM攻撃やハイブリッド環境まで含む幅広い商用プラットフォームであり、攻撃と検知を対にした実践的なカリキュラムが特徴である。一方Awesome-CloudSec-Labsは、AWS・Azure・GCP・Kubernetes・CI/CDにまたがる無料OSS教材を横断的に集約したリファレンスであり、特定プロバイダの特定トピック（IAM権限昇格、S3設定ミス、Entra ID侵害など)に絞って深掘りしたい学習者に向く。両者は競合するものではなく、商用の体系的カリキュラムで基礎から学びたい場合はPwned Labs、無料でプロバイダ・トピックごとにピンポイントで深堀りしたい場合はAwesome-CloudSec-Labsの各リポジトリ、という使い分けが実務上有効である。いずれのラボも学習用に意図的に脆弱化された使い捨て環境であり、実在の本番サービスへの適用や無許可の検証行為は本教科書の対象範囲外である。


---

[← 第9章 実例・ライトアップ・報奨事例](09-real-world-cases.md) ｜ [目次](index.md)
