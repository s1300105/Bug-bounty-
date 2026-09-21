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
