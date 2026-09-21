# 第4章 クラウドメタデータの悪用（IMDS/GCP/Azure）

## EC2メタデータ奪取の基本手順（Hacking the Cloud/HackTricks）

### 4a.1 IMDS（Instance Metadata Service）とは何か

クラウドの仮想マシン（EC2、GCE、Azure VM など）は、OS起動後にインスタンス固有の情報――インスタンスID、リージョン、ネットワーク設定、そして最も重要な**一時的なIAM認証情報**――をVM自身に配布する仕組みを持つ。この配布経路が **IMDS（Instance Metadata Service）** である。AWSでは `169.254.169.254` という **リンクローカルアドレス**（RFC 3927で定義された、ルーティングされずセグメント内でのみ到達可能なIPアドレス帯）宛のHTTPリクエストとして実装されている。

このアドレスが選ばれている理由は、「インターネットからは絶対に到達できないが、VM上で動くどのプロセスからも到達できる」という性質にある。逆に言えば、**VM上で動作するアプリケーションがどこか任意のURLへHTTPリクエストを発行できてしまえば（＝SSRF脆弱性があれば）、そのアプリケーションの権限で `169.254.169.254` にもリクエストを送れてしまう**。これがSSRFとIMDSが組み合わさったときに致命傷になる理由である。IMDS自体には本来「悪意」はなく、あくまで「VM内部からの読み取りを信頼する」設計であり、SSRFはその信頼境界（本来はアプリケーション利用者ではなくVM自身だけが読めるはずの領域）をアプリケーション経由ですり抜ける攻撃である。

IAMロールがアタッチされたEC2インスタンスでは、IMDS経由で一時的なアクセスキー（AccessKeyId / SecretAccessKey / SessionToken）を取得できる。これはEC2が裏側でSTS（Security Token Service）から定期的に更新している短命の認証情報であり、これをSSRFで窃取されると、攻撃者はそのIAMロールが持つ権限（S3読み取り、EC2操作、Lambda実行など）をインターネット越しに行使できてしまう。

### 4a.2 IMDSv1: なぜ「ただのGETリクエスト」で盗めるのか

IMDSv1では認証や事前ハンドシェイクが一切なく、単純なHTTP GETリクエストだけで全メタデータにアクセスできる。Hacking the Cloudの手順は次の3ステップで構成される。

**ステップ1: IAMロールの有無を確認する**

```
GET http://169.254.169.254/latest/meta-data/iam/
```

- **404** が返れば、そのインスタンスにIAMロールがアタッチされていない（＝この経路からは認証情報を取れない）。
- **200**（本文が空でも）が返れば、ロールが過去にアタッチされ、後に取り消された可能性がある。IAM関連のパスが存在すること自体が、探索を続ける価値があるサインになる。

**ステップ2: アタッチされているロール名を取得する**

```
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

このエンドポイントは、インスタンスにアタッチされたIAMロールの名前をプレーンテキストで返す（例: `ec2-default-ssm`）。ロール名は多くの場合、その組織の命名規則（サービス名や用途を反映）が現れるため、次にどのAWSサービスと連携しているか（SSM、S3バックアップ、CI/CDなど）を推測する材料にもなる。

**ステップ3: 一時認証情報を取得する**

```
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/[ROLE-NAME]/
```

`[ROLE-NAME]` にステップ2で得たロール名を差し込むと、次のようなJSONが返る（値は例示）。

```json
{
  "Code": "Success",
  "LastUpdated": "2026-09-20T12:00:00Z",
  "Type": "AWS-HMAC",
  "AccessKeyId": "ASIAxxxxxxxxxxxxxxxx",
  "SecretAccessKey": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "Token": "IQoJb3JpZ2luX2VjExxxxxxxxxxxxxxxxxxxxxxxxxxx...",
  "Expiration": "2026-09-20T18:00:00Z"
}
```

`AccessKeyId` / `SecretAccessKey` / `Token`（セッショントークン）の3点セットが揃えば、攻撃者は自分の端末で `aws configure` にこれらを設定するか、環境変数（`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`）にセットして、そのIAMロールとして正規のAWS CLI/SDK呼び出しを行える。つまりSSRF一発が「クラウド環境への正規APIアクセス権」に直結する。

> ⚠️ 実運用上の重要な注意（本教科書のスコープ制約）: 上記の手順は、あくまで**自分が管理・許可を得た検証環境**でIMDS保護設定を確認するためのものであり、他者のシステムに対して無許可で行ってはならない。

> 出典: Steal EC2 Metadata Credentials via SSRF — https://hackingthe.cloud/aws/exploitation/ec2-metadata-ssrf/

Hacking the Cloudの記事はさらに、Mandiantの観測事例として「攻撃者が公開Webアプリケーションを自動スキャンし、IAM認証情報をIMDS経由で収集している」という実際の脅威動向を引用している。つまりこれは理論上のリスクではなく、インターネット上で継続的に悪用が観測されている実在の攻撃パターンである。

### 4a.3 IMDSv2: なぜトークン方式が導入されたのか

上記の単純なGETベースの窃取があまりに容易だったため、AWSは2019年に **IMDSv2** を導入した。IMDSv2の核心は「PUTリクエストでセッショントークンを取得し、そのトークンをヘッダーに付けたGETリクエストでのみメタデータを読めるようにする」という**2段階のチャレンジ・レスポンス方式**である。

```bash
# ステップ1: トークンを取得（PUTメソッド、有効期限をヘッダーで指定）
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")

# ステップ2: トークンをヘッダーに付けてメタデータを取得
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/"
```

この方式がSSRF対策としてなぜ有効なのかを仕組みレベルで理解することが重要である。

1. **メソッドの制約**: 典型的なSSRF脆弱性（例: `?url=` パラメータをそのまま `fetch()`/`requests.get()` に渡す実装）は、多くの場合GETリクエストしか発行できない。攻撃者がURLを注入できても、アプリケーションが内部で使うHTTPライブラリの呼び出し方（メソッドが固定でGETしか使わない）まで変えられないケースが多く、PUTリクエストを要求するトークン取得ステップをそもそも実行できない。
2. **ヘッダー制御の制約**: 多くのSSRFはURL（パスやクエリ）は注入できてもカスタムHTTPヘッダーまでは注入できない。トークンをヘッダーで渡す必要があるIMDSv2は、「URLだけ制御できるSSRF」では完結しない設計になっている。
3. **ホップリミット（hop limit）**: IMDSv2で取得したトークンの応答には、IPのTTL（Time To Live、パケットが通過できるルーター段数の上限）に相当する「ホップ数の制限」がデフォルトでかけられている。これはトークン取得リクエストがVM上から直接発行された場合は1ホップで届くが、リバースプロキシやコンテナのネットワークブリッジを経由する場合は複数ホップになり、TTL超過でパケットが破棄される、という性質を利用している。これにより、EC2インスタンス上で動くDockerコンテナの中から（コンテナのネットワーク名前空間はホストとは別ホップとして扱われるため）IMDSv2のトークン取得が失敗しやすくなる。ホップ数の上限はデフォルトで1に設定されており、コンテナ環境で複数ホップ必要な運用では管理者が明示的に増やさない限りブロックされる。

つまりIMDSv2は「認証情報を暗号化する」のではなく、「単純なSSRF（URLのみ制御可能・GETのみ）では届かない構造」にすることで防御している。逆に言えば、攻撃者がSSRFに加えて**任意のHTTPメソッドとヘッダーを制御できる**脆弱性（例: SSRF経由でPUTを発行できるプロキシ型の脆弱なコード、XXE経由でのHTTPリクエスト偽造など状況次第）を持っていれば、IMDSv2であっても2段階を両方満たして突破される可能性は残る。IMDSv2は「多くの単純なSSRFを無力化する」対策であり、「SSRFというクラス全体を無効化する魔法」ではない、という理解が防御設計上重要である。

> ⚠️ **未取得の資料の一部について**: HackTricksのCloud SSRFページ本体（`https://hacktricks.wiki/en/pentesting-web/ssrf-server-side-request-forgery/cloud-ssrf.html`）は、直接アクセスすると `tollbit.hacktricks.wiki` への302リダイレクト後にHTTP 402（Payment Required）が返り、自動取得がブロックされました。代替として、同内容のGitHub原本（`https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/ssrf-server-side-request-forgery/cloud-ssrf.md`）から本文を取得できたため、以下はその内容に基づきます。（一部、IMDSv2のホップリミットの仕組みなど詳細部分は、未取得箇所の補足として一般知識に基づく解説を加えています。）

> 出典: Cloud SSRF — HackTricks — https://hacktricks.wiki/en/pentesting-web/ssrf-server-side-request-forgery/cloud-ssrf.html （GitHub原本: https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/ssrf-server-side-request-forgery/cloud-ssrf.md）

### 4a.4 主要クラウドのメタデータエンドポイント比較

HackTricksのCloud SSRFページは、AWSに限らず主要クラウドすべてのメタデータサービスを横断的にまとめている点に価値がある。SSRFの被害範囲はEC2に限らないため、ここを押さえておくと防御対象を漏らさずに把握できる。

#### AWS（EC2 / Lambda / ECS / EKS）

```
# インスタンスアイデンティティドキュメント（署名付き、リージョンやアカウントIDを含む）
GET http://169.254.169.254/latest/dynamic/instance-identity/document

# 旧来のEC2認証情報経路
GET http://169.254.169.254/latest/meta-data/identity-credentials/ec2/security-credentials/
```

- **Lambda関数**: Lambdaの実行環境にはIMDSのような`169.254.169.254`は存在しないが、一時認証情報は**環境変数**（`AWS_ACCESS_KEY_ID` など）としてプロセスに渡される。したがって、LambdaでSSRFではなく**ローカルファイル読み取り系の脆弱性**（例: テンプレートインジェクションやパストラバーサルで `file:///proc/self/environ` を読める場合）があると、そこから認証情報が漏洩し得る。これはIMDSとは異なる経路だが、「一時認証情報がプロセスに配布される」という構造は共通している。
- **ECSコンテナ**: `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` という環境変数にGUIDを含むパスがセットされており、`http://169.254.170.2/v2/credentials/<GUID>` にアクセスすると、そのタスクにアタッチされたIAMロールの認証情報が取得できる。169.254.170.2はECSタスクメタデータエンドポイント専用のリンクローカルアドレスであり、EC2のIMDS（169.254.169.254）とは別物である点に注意。
- **EKS Pod Identity**: `AWS_CONTAINER_CREDENTIALS_FULL_URI` と、Kubernetesの**投影サービスアカウントトークン（projected service account token）**を組み合わせて認証情報を取得する方式。Podごとに異なるIAMロールをマッピングできるIRSA（IAM Roles for Service Accounts）の仕組みに対応する。

#### GCP（Google Compute Engine / Cloud Run / Cloud Functions）

GCPのメタデータサーバーは `metadata.google.internal` または `169.254.169.254` でアクセスでき、**必須ヘッダー** `Metadata-Flavor: Google` が付いていないリクエストは拒否される。これはAWS IMDSv1が「ヘッダー無しの素のGETで丸ごと取れてしまう」のと比べ、SSRFの難易度をわずかに上げる設計である（URLだけ制御できてヘッダーを制御できないSSRFでは、このヘッダーを付与できず失敗する場合がある）。

```bash
# サービスアカウントのアクセストークンを取得
curl -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"

# 特定オーディエンス（audience）向けのIDトークンを取得
curl -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=TARGET"
```

`identity?audience=` のIDトークンが特に強力なのは、Cloud RunやCloud Functionsが「特定のオーディエンス（呼び出し先サービスのURL）に対してのみ有効な署名済みJWT」を発行できる点にある。これにより、攻撃者はSSRFを踏み台にして、本来インターネットに公開されていない別の内部Cloud Run/Cloud Functionsサービスに対して、正規の呼び出し元であるかのように認証して到達できてしまう可能性がある。

#### Azure（Azure VM / WireServer）

Azureのメタデータサービス（IMDS）は `169.254.169.254` で提供され、必須ヘッダーとして `Metadata: true` を要求する。さらにAzureは **`X-Forwarded-For` ヘッダーを含むリクエストを拒否する**という独自の防御を持つ。これはリバースプロキシ経由のSSRF（プロキシが`X-Forwarded-For`を自動付与する構成）を狙い撃ちで防ぐための設計であり、GCPの必須ヘッダー方式とは逆に「特定ヘッダーの存在」でブロックする点が対照的である。

WireServer（`168.63.129.16`）は、Azure VMエージェントが使用する管理用エンドポイントで、Managed Identity（マネージドID、Azureが提供するAzure ADへの自動認証の仕組み）の一覧やExtensionsConfigのXMLを取得できる。ここからユーザー割り当てIDのClientId / ObjectId / ResourceIdを抽出し、そのIDのトークンを要求する、という流れになる。VMエージェントのコンテキスト（Run Commandなど特権的な実行経路）とSSHセッションのような非特権実行経路とでアクセスできる範囲が異なる点もHackTricksは指摘している。

### 4a.5 なぜ「メタデータサービス」という設計そのものがSSRFに弱いのか

ここまでの各クラウドの違いを俯瞰すると、共通する脆弱性の本質が見えてくる。

1. **リンクローカルアドレスは「ネットワーク的にVM内部からしか届かない」ことを認証の代替にしている。** つまり「そのIPに到達できる＝VM内部のプロセスである」という**暗黙の信頼**がベースになっている。SSRFは「VM内部のアプリケーションに、任意の宛先へのHTTPリクエストを代理発行させる」攻撃であるため、この暗黙の信頼をそっくりそのまま流用できてしまう。
2. **IMDSv1やGCP/Azureの基本エンドポイントは、認証情報を「読み取り専用の静的リソース」として配布している。** 認可のロジックが「特定ヘッダーの有無」程度の軽量なチェックに留まっているため、攻撃者がURL・メソッド・ヘッダーのどこまでを制御できるSSRFかによって、突破の可否が分かれる。
3. **各クラウドが独自に緩和策（IMDSv2のトークン化、GCPの`Metadata-Flavor`必須化、Azureの`X-Forwarded-For`拒否とWireServerの特権分離）を講じているのは、いずれも「SSRFが持つ制御の自由度を制限する」方向の対策である。** 完全に無効化するのではなく、単純なSSRF（URLのみ制御可能）では突破できないように「複数の条件をANDで要求する」ことがどのクラウドにも共通する防御思想と言える。

### 4a.6 防御側の実装チェックリスト

本セクションは防御目的で書かれているため、最後に実装者・運用者が確認すべき点を整理する。

- **IMDSv2の強制**: AWSでは `aws ec2 modify-instance-metadata-options --http-tokens required` のように、インスタンスメタデータオプションで `HttpTokens` を `required` に設定し、IMDSv1（トークン無し）でのアクセスを完全に拒否できる。新規起動のインスタンスでもこれをデフォルトにするIAM/Organizationsのガードレール（SCPやLaunch Templateの標準化）を敷くことが望ましい。
- **ホップリミットの明示設定**: コンテナ基盤を使わない限り、`HttpPutResponseHopLimit` はデフォルトの1のままにしておく。コンテナから直接IMDSv2を触る必要がある構成では、リミットを上げる代わりに、後述のネットワーク制御やIMDSプロキシ（`aws-imds-proxy` のような、コンテナごとに認証情報のスコープを絞るプロキシ）を検討する。
- **IAMロールの権限最小化**: 仮にIMDS経由で認証情報が漏れても被害を抑えられるよう、EC2にアタッチするIAMロールは必要最小限の権限（最小権限の原則）に絞る。ワイルドカードで `*` を許可するポリシーは避ける。
- **アプリケーション層でのSSRF対策**: 本教科書の他章で扱うSSRF対策（許可リストによる宛先制限、リダイレクト追跡の禁止、プライベート/リンクローカルアドレス帯へのアクセス拒否など）を、IMDSの防御の「最後の砦」ではなく「最初の防波堤」として実装する。ネットワーク層の対策（VPC内でのファイアウォールルールにより `169.254.169.254` へのアクセスをアプリケーションサーバーから制限するなど）も多層防御として有効である。
- **異常アクセスの監視**: CloudTrailでIMDS由来の一時認証情報が「通常とは異なるIPアドレス（インターネット側）」から使われていないかを監視する。Mandiantの報告が示すように、この種の悪用は実際に自動スキャンで行われているため、検知の仕組みを持つことが被害極小化に直結する。

### 4a.7 まとめ

EC2メタデータ窃取は、SSRFの「宛先を攻撃者が制御できる」という性質と、IMDSの「宛先到達性そのものを認可の代わりにする」という設計が組み合わさったときに成立する、クラウド特有の重大な攻撃パターンである。IMDSv1はGETリクエスト一発で認証情報が漏洩する設計であり、IMDSv2はPUTによるトークン取得とヘッダー必須化、ホップリミットによって単純なSSRFを無力化する。GCPは`Metadata-Flavor`ヘッダー必須、Azureは`X-Forwarded-For`拒否とWireServerの特権分離という、それぞれ異なるアプローチで同種のリスクに対処している。しかし、いずれの対策も「SSRFというクラスの脆弱性そのもの」を消すものではなく、あくまで「単純な形のSSRFでは突破できない」ようにするものである点を理解し、アプリケーション層の対策とクラウド側の対策を多層で組み合わせることが防御の要となる。

---

## IMDSv2実悪用と実攻撃キャンペーン（Yassine/F5/Resecurity）

前節までで、EC2 インスタンスメタデータサービス（IMDS＝Instance Metadata Service、インスタンス自身が自分の設定情報や一時認証情報を `http://169.254.169.254/` から取得できる仕組み）が SSRF（Server-Side Request Forgery＝サーバに任意の宛先へリクエストを送らせる脆弱性）の主要な標的であることを見てきた。本節では、その「仕組みの話」を **実際の攻撃事例** に接続する。具体的には次の3つを扱う。

1. **IMDSv2 が有効な環境ですら SSRF で資格情報を抜かれた** ライトアップ（Yassine Aboukir）。ここでは「IMDSv2 にすれば安全」という思い込みがなぜ崩れうるかを、リクエストの中身まで踏み込んで理解する。
2. **CVE に紐づかない、金銭目的の実キャンペーン**（F5 Labs, 2025年3月）。攻撃者が実運用でどんなパラメータ・パスを機械的に叩いているかを知る。
3. **SSRF から認証情報奪取・S3データ取得・EC2列挙・横展開まで** の影響全体像（Resecurity）。

これらを通じ、「IMDSv2 が効く条件」と「効かない条件」を仕組みレベルで切り分けることが本節のゴールである。防御の設計判断はこの切り分けに全面的に依存する。

> **スコープ注記**: 本節は防御目的の解説である。掲載するペイロードは攻撃者の実手口を理解し検知・緩和するためのものであり、無許可の実在サービス・本番環境への適用を意図しない。

---

### 前提知識の再確認：IMDSv1 と IMDSv2 の差はどこにあるか

SSRF とメタデータの関係を正しく語るには、v1 と v2 の **プロトコル上の差** を一点だけ厳密に押さえる必要がある。

- **IMDSv1**: `GET http://169.254.169.254/latest/meta-data/...` を投げれば、**認証なし・カスタムヘッダなし** で応答が返る。SSRF は多くの場合「攻撃者が URL を差し込めるだけ」なので、GET 1発で成立する v1 は SSRF と極めて相性がよい（＝抜かれやすい）。
- **IMDSv2**: アクセスの前に、まず **PUT リクエストでセッショントークンを取得** し、以降のすべての GET に `X-aws-ec2-metadata-token: <token>` という **カスタムヘッダ** を付ける必要がある。

```
# IMDSv2 手順（正規の使い方）
# 1) トークン取得（PUT + TTLヘッダ）
curl -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"

# 2) 取得したトークンをカスタムヘッダに載せて GET
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/ \
  -H "X-aws-ec2-metadata-token: $TOKEN"
```

**なぜ v2 が SSRF に強いのか（原理）**: 典型的な SSRF は「サーバが受け取った URL 文字列にリクエストを飛ばす」だけで、**HTTP メソッドを PUT に変えたり、任意のリクエストヘッダを付与したりする自由度は持たない**。IMDSv2 は「PUT で取ったトークンを、以降のヘッダに載せる」という2段階＋ヘッダ制御を要求するため、URL しか操れない SSRF では最初の PUT すら成立しない。加えてトークン取得時の TTL や、後述の **ホップ制限（TTL=1）** により、リクエストがプロキシ/コンテナ境界を1つでも越えると弾かれる設計になっている。F5 Labs も「SSRF は通常カスタムヘッダを指定できないため、IMDSv2 は SSRF 経由のメタデータ露出を完全に緩和する」と明言している。

裏を返せば、**「URL しか操れない」という前提が崩れる SSRF** では v2 でも危うい。そのショーケースが次の Yassine の事例である。

---

### 事例1: IMDSv2 環境での実悪用（Yassine Aboukir）

#### 何が起きたか

Confluence の SSRF（**CVE-2019-8451**、Confluence の `makeRequest` ガジェットに起因する SSRF）を起点に、**IMDSv2 が有効化されていたにもかかわらず** EC2 の IAM 資格情報と `user-data` が漏洩した事例である。攻撃対象は dev/staging/production に分かれた複数の Confluence インスタンスだった。

#### なぜ IMDSv2 を突破できたのか（核心）

鍵は、悪用した SSRF が **「ただ URL を投げるだけ」ではなかった** 点にある。Confluence の `makeRequest` エンドポイントは、`url` に加えて `httpMethod`（HTTPメソッド）、`postData`、そして **`headers`（任意のリクエストヘッダ）** を攻撃者に指定させてしまう。つまりこの SSRF は「フル HTTP リクエストを組み立てられる SSRF」であり、前節で述べた「v2 が効く前提（URL しか操れない）」が成立しない。

最初は、認証なしで直接メタデータへアクセスしようとすると失敗した。

```
# 直アクセスは 401 で拒否 → IMDSv2 が有効である証拠
GET http://169.254.169.254/   →  401 - unauthorized
```

**なぜ 401 なのか**: IMDSv2 有効時は、トークンヘッダの無い GET はサービス側で拒否される。この 401 自体が「v2 が効いている」という指紋（フィンガープリント）になる点も実務上重要で、攻撃者はこれを見て「ヘッダ注入が可能な SSRF か」を見極める。

そこで攻撃者は、`makeRequest` の `headers` パラメータを使って `X-aws-ec2-metadata-token` を注入した。実際のリクエストは概ね次の形である。

```
POST /plugins/servlet/gadgets/makeRequest HTTP/1.1
Host: confluence.dev.<redacted>.com
X-Atlassian-Token: no-check
Content-Type: application/x-www-form-urlencoded

url=http://169.254.169.254/latest/meta-data&httpMethod=GET&headers=X-aws-ec2-metadata-token=AQAEAH7TsExwreOTsHbZjebiYB7ypANA_l6JycUp2g0hDYNN9-kucA%3D%3D
```

ここで実装上の細かな、しかし決定的なハマりどころがある。**トークン末尾の Base64 パディング `==` はそのまま送るとパラメータ処理で欠落するため、`%3D%3D` に URL エンコード** する必要があった。

**なぜエンコードが必要か（パーサの挙動）**: `headers=X-aws-ec2-metadata-token=...==` という値の中の生の `=` は、`application/x-www-form-urlencoded` のパーサからはキー/値の区切りに見えてしまい、末尾 `==` が切り落とされる。切れたトークンは無効なので 401 が返り続ける。`=` を `%3D` としてパーセントエンコードすると、パーサは「区切り文字ではなく単なるデータ」として扱い、トークンが完全な形でメタデータサービスに届く。**パーサがどの層でデコード・分割を行うかを理解していないと、正しいトークンを持っていても失敗し続ける**——この一点が、この事例の技術的な肝である。

#### 抜かれたもの

トークンが通った後、攻撃者は次を取得した。

```
# 1) user-data（起動時に実行されるデプロイスクリプト）
GET http://169.254.169.254/latest/user-data
```

`user-data` からは、デプロイ用 bash スクリプトが返り、その中に **PostgreSQL RDS の資格情報、Nessus エージェントの資格情報、Hibernate の接続パスワード** が平文で含まれていた。

> **なぜ user-data が危険か**: `user-data` はインスタンス起動時の初期化スクリプトを置く場所で、開発者がここに DB パスワードや API キーを直書きしがちである。IMDSv2 でトークンさえ通れば **認証情報以外の初期化スクリプトも読める** ため、IAM ロールの権限とは別経路で秘密が漏れる。

```
# 2) インスタンスの IAM ロール資格情報
GET http://169.254.169.254/latest/meta-data/identity-credentials/ec2/security-credentials/ec2-instance
```

このエンドポイントから EC2 インスタンスのロール資格情報（アクセスキー/シークレット/セッショントークン）が得られ、AWS インフラのさらなる列挙へつながった。

#### この事例の教訓

IMDSv2 は「銀の弾丸」ではない。**ヘッダ・メソッドを攻撃者が制御できる SSRF（＝リッチな SSRF）** の前では、v2 の防御前提が崩れる。したがって防御は「v2 化して終わり」ではなく、後述の **IMDS への到達自体を絞る（ホップ制限・ネットワーク遮断）** と **アプリ側で SSRF を潰す（ヘッダ注入・任意メソッドを許さない）** の多層で考える必要がある。

> 出典: Yassine Aboukir — Exploitation of an SSRF vulnerability against EC2 IMDSv2 — https://www.yassineaboukir.com/blog/exploitation-of-an-SSRF-vulnerability-against-EC2-IMDSv2/

---

### 事例2: 実攻撃キャンペーン（F5 Labs, 2025年3月）

#### 概要と時系列

F5 Labs は 2025年3月、**特定 CVE に紐づかない** SSRF ベースのキャンペーンを観測した。AWS 上でホストされる Web サイトを無差別に狙い、EC2 メタデータを掠め取ろうとするものである。時系列は次の通り。

- **2025-03-13**: 偵察開始（単一IP `193.41.206.72`）
- **2025-03-15**: 本格展開（主IP `193.41.206.189`）
- **2025-03-25 頃 終息**: 約11日間の活動
- 使用IPはすべて **ASN 34534（FBW NETWORKS SAS、フランス/ルーマニア）** に属する複数アドレス

弱点としては **CWE-200（認可されていない者への機微情報の露出）** と SSRF の組み合わせと整理されている。

#### 攻撃の実際の形（機械的な総当たり）

このキャンペーンの技術的な価値は、**攻撃者が実運用で叩いているパラメータ名とパスの網羅リスト** が観測された点にある。攻撃はシンプルな GET で、URL パラメータにメタデータ URL を差し込む形だった。

```
# 観測された典型パターン
/?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/
# 一般化: /?<param>=http://169.254.169.254/latest/<subpath>
```

**総当たりされたパラメータ名（6種）**:

```
dest, file, redirect, target, uri, url
```

**要求されたメタデータパス（4種）**:

```
/latest/meta-data/
/latest/meta-data/iam/security-credentials/
/latest/meta-data/iam/security-credentials/admin-role
/latest/user-data
```

**なぜこの形なのか（原理）**: これらのパラメータ名は、リダイレクト処理・ファイル取得・プロキシ機能などで **URL を受け取りがちな定番の名前** である。攻撃者は対象アプリの内部を知らなくても、「よくある URL 受け口 × よくあるメタデータパス」を総当たりするだけで、どこかで SSRF が刺されば資格情報に届く。`admin-role` のような **代表的なロール名を推測** している点にも注目したい——これは IMDSv1 なら `security-credentials/` でロール名一覧が取れるが、そこが読めない場合でも「ありがちなロール名」で直接叩けば当たることがあるためである。

#### なぜ IMDSv2 移行が効くのか（このキャンペーン文脈で）

このキャンペーンが成功するのは、標的が **IMDSv1 を許可している** 場合に限られる。F5 Labs は、成功時には「認証要件なしに、その EC2 インスタンスの有効な AWS 資格情報」が露出し、攻撃者は IAM ロールを引き受けてクラウド基盤を侵害できると述べる。そして中核的な緩和策として IMDSv2 への移行を挙げ、**v2 は攻撃者に `X-aws-ec2-metadata-token` というカスタムヘッダで秘密を供給させることを要求するため、（ヘッダを指定できない典型的な SSRF に対して）メタデータ露出を完全に緩和する** と結論づけている。事例1と読み合わせると、「典型的な（URLだけの）SSRF には v2 が決定打／ヘッダ注入できるリッチな SSRF には別の層が要る」という切り分けが立体的に理解できる。

#### 防御の具体策（F5 Labs 推奨）

- **脆弱性を積極的にスキャン** し、優先度の高いものを速やかにパッチ。
- **WAF ルールで `169.254.169.254` 宛のリクエストをブロック**（宛先IPリテラルに基づく検知）。
- **IMDSv1 → IMDSv2 への移行**（最重要）。

> **WAF ブロックの限界に注意**: `169.254.169.254` の文字列一致だけでは、10進数表記（`http://2852039166/`）、8進/16進表記、DNS リバインディング等で回避されうる。WAF は補助線であって、IMDSv2 化とネットワーク遮断の代替にはならない。

> 出典: F5 Labs — Campaign Targets Amazon EC2 Instance Metadata via SSRF — https://www.f5.com/labs/articles/campaign-targets-amazon-ec2-instance-metadata-via-ssrf

---

### 事例3: 影響の全体像 — 資格情報奪取から横展開まで（Resecurity）

#### 攻撃チェーン

Resecurity のレポートは、「アプリの脆弱性」から「クラウド資格情報の侵害」へ至る一連の流れを段階として整理している。

1. **SSRF** — Web アプリで URL 由来のユーザ入力が検証されない（sink＝入力が最終的にリクエスト送信という危険な操作に到達する箇所）。
2. **メタデータアクセス** — その SSRF で EC2 IMDS を叩く。
3. **資格情報抽出** — IAM ロールの一時資格情報を取得。
4. **横展開（Lateral Movement）** — 盗んだ資格情報で他の AWS サービスへアクセス。

#### 使われるエンドポイントと戻り値の構造

```
http://169.254.169.254/                                              # ベース
http://169.254.169.254/latest/meta-data/                            # メタデータ一覧
http://169.254.169.254/latest/meta-data/iam/security-credentials/   # ロール名の一覧
http://169.254.169.254/latest/meta-data/iam/security-credentials/<role-name>  # 資格情報本体
```

**手順の理由**: まず `security-credentials/`（末尾スラッシュ）で **アタッチされているロール名** を得て、その名前を末尾に付けて再度叩くと **資格情報 JSON** が返る、という2段構えになっている。ロール名を知らないと本体に届かないため、この列挙ステップが必須になる（事例2の攻撃者が `admin-role` を推測していたのは、この列挙を飛ばして直接当てにいく戦術）。

返る一時セキュリティ資格情報の構造は次の通り。

```
AccessKeyId       … 公開識別子
SecretAccessKey   … 署名用の秘密鍵
Token             … 一時セッションの証明（セッショントークン）
Expiration        … 有効期限（通常は数時間）
```

**なぜ「一時」なのか、なぜそれでも危険か**: これらは STS（Security Token Service）が発行する短命の資格情報で、数時間で失効する。しかし攻撃者にとっては数時間あれば十分で、その間 **インスタンスにアタッチされた IAM ロールの権限をそのまま行使** できる。ここで効いてくるのが「ロールの過剰権限」である。ロールが S3 フルアクセスや広い EC2 権限を持っていれば、資格情報1組で **S3 バケットのデータ取得・EC2 インスタンスの列挙・さらなる横展開** まで一気に広がる。これが「一時資格情報でも壊滅的」になる理由であり、Resecurity が **最小権限（least privilege）** を強く推す背景でもある。

> ℹ️ 攻撃後の AWS CLI コマンド（`aws s3 ls` 等）の具体例は本記事では提示されていない。記事の焦点は HTTP ベースの抽出手法そのものにある。実務では、盗まれた資格情報が正規 API 経由で使われるため **アプリ層の SSRF 検知だけでは追えず、CloudTrail 等での API 異常検知が最後の砦** になる、と理解しておくとよい。

#### 根本原因（Resecurity の整理）

- **検証されていないユーザ入力を信頼** している（URL 処理コード）。
- **IMDSv2 が強制されておらず**、既定でメタデータにアクセスできる。
- インスタンスに **過剰権限の IAM ロール** がアタッチされている。
- **ネットワークレベルでのメタデータ制限が無い**。

#### 防御策（Resecurity 推奨）

1. **IMDSv2 を有効化**（セッションベースのトークンを要求）。
2. **URL 検証はブラックリストではなくホワイトリスト** で行う。
3. **ネットワーク制限** — セキュリティグループ等で `169.254.169.254` へのアクセスを遮断。
4. **最小権限 IAM** — ロール権限を絞り、被害範囲（blast radius）を最小化。

> 出典: Resecurity — SSRF to AWS Metadata Exposure: How Attackers Steal Cloud Credentials — https://www.resecurity.com/blog/article/ssrf-to-aws-metadata-exposure-how-attackers-steal-cloud-credentials

---

### 3事例を貫く防御の設計原則

最後に、3つの事例から導かれる **多層防御** を、効く前提とともに整理する。単独の対策に依存しないことが要点である。

| 対策 | 何を防ぐか | 効く前提／限界 |
|---|---|---|
| **IMDSv2 の強制**（HttpTokens=required） | 典型的な（URLのみの）SSRF からのメタデータ窃取 | ヘッダ・メソッドを操れるリッチな SSRF（事例1）には単独では不十分 |
| **ホップ制限 TTL=1**（HttpPutResponseHopLimit=1） | プロキシ/コンテナ境界を越える中継型 SSRF | アプリと同一ホップからの SSRF は防げない |
| **ネットワーク遮断**（169.254.169.254 へのegress遮断） | あらゆる経路のメタデータ到達 | 正規にメタデータを使うワークロードとの両立設計が必要 |
| **最小権限 IAM ロール** | 資格情報漏洩後の横展開（S3/EC2列挙） | 漏洩自体は防げない＝被害「後」の縮小策 |
| **アプリ側の SSRF 修正**（ホワイトリスト、任意ヘッダ/メソッド禁止） | SSRF そのもの | 実装漏れがあれば無効化される |
| **WAF で 169.254.169.254 をブロック** | 素朴なペイロード（事例2の総当たり） | 10進/16進表記・DNSリバインディングで回避されうる補助線 |
| **CloudTrail 等での API 異常検知** | 盗まれた一時資格情報の悪用 | 予防ではなく検知＝「最後の砦」 |

**設計上の結論**: 事例1は「v2 でも油断できない（アプリ側の SSRF 品質とホップ制限・ネットワーク遮断が要る）」ことを、事例2は「v1 が残っていれば総当たりで即陥落する（v2 強制が決定打）」ことを、事例3は「一度資格情報が漏れれば最小権限だけが被害を止める」ことを示す。したがって **「IMDSv2 強制 ＋ ホップ制限 ＋ ネットワーク遮断 ＋ 最小権限 ＋ アプリ側 SSRF 対策 ＋ 検知」の全部を積む** のが正解であり、どれか1つで足りると考えることが最大の落とし穴である。

> **時事性の注記**: 本節の数値・時系列は主に 2025年3月の F5 Labs 観測、および CVE-2019-8451（Confluence）を前提とした Yassine の事例に基づく。AWS は新規起動時の IMDSv2 既定化・強制を進めているが、既存インスタンスや古い AMI では IMDSv1 が残存しうるため、環境ごとに `HttpTokens=required` の実設定を確認すること。

---

## ナビゲーション

← [第3章 Blind SSRF と OAST/OOB 検出](03-blind-oast.md)  ｜  [📚 目次（ホーム）](index.md)  ｜  [第5章 URLパーサ／フィルタ回避【核心】](05-filter-bypass.md) →
