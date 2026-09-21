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
