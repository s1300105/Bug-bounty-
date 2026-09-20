# 第11章 発展・方法論・実例


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

## 方法論アーカイブと発展トレーニング

Reconの学習は、あるところで「新しいツールを覚える」フェーズを卒業する。次に必要になるのは、**先行研究者が何を考えてその順番で手を動かしていたのか**という意思決定のフレームを取り込むことだ。ツール名は3年で入れ替わるが、「どの入力からどの出力を作り、何を根拠に次の一手を決めるか」という構造は10年単位で生き残る。

本節では、方法論のアーカイブ（歴代スライド・講演の集積）と、体系化されたフルトレーニング（TBHM）、そして最新（2025年）のパイプライン講座という3つの資料を、**「陳腐化する部分」と「陳腐化しない部分」に切り分けながら**読む方法を扱う。

> 本節は防御・学習目的の解説である。紹介するコマンド例は、自分が管理する環境、または対象プログラムが明示的に能動テストを許可した範囲でのみ実行すること。実在サービスや本番環境への無許可の検証は行わない。また本節は特定のラボの攻略手順を扱わない。

---

### 1. Bug Hunter Handbook「Presentations」——方法論アーカイブの構造

Bug Hunter Handbook の Presentations ページは、Bug Bounty黎明期（2017年前後）から2020年頃までの方法論スライド／講演を集めたリンク集である。単なるブックマークに見えるが、**並べて読むと「方法論の系譜」が見える**という点に教材としての価値がある。

#### 1-1. 収録されている資料（原典の一覧）

ページ本体のテーブルには、次の資料が収録されている。

| # | タイトル | URL |
|---|---|---|
| 1 | BUG BOUNTY FUNSHOP | `https://docs.google.com/presentation/d/1cpcxEBEb0dyXwRqSWQ6bknJS-PQO_e242Dioy9SU2Io/edit` |
| 2 | Bug Hunting Methodology | `https://blog.usejournal.com/bug-hunting-methodology-part-1-91295b2d2066` |
| 3 | It is little things - Nahamsec | `https://docs.google.com/presentation/d/1xgvEScGZ_ukNY0rmfKz1JN0sn-CgZY_rTp2B_SZvijk/edit` |
| 4 | Recon-1 | `https://bugbountytuts.files.wordpress.com/2019/01/dirty-recon-1.pdf` |
| 5 | All in one Recon | `https://drive.google.com/file/d/1uBTra6_jwhLnZALJVp9hmHaty2pBBUH2/view` |
| 6 | Automation for Bughunters（mhmdiaa） | `https://speakerdeck.com/mhmdiaa/automation-for-bug-hunters` |
| 7 | Passivish Recon（TomNomNom） | `https://tomnomnom.com/talks/passiveish.pdf` |
| 8 | Automating Application Security Bug Hunting（BSidesSF 2019） | `https://static.sched.com/hosted_files/bsidessf2019/65/...pdf` |
| 9 | BugBounty automation（ZeroNights 2018） | `https://2018.zeronights.ru/wp-content/uploads/materials/4%20ZN2018%20WV%20-%20BugBounty%20automation.pdf` |
| 10 | Automating Web Application Bug Hunting（Jerry Gamblin / Jonathan Cran） | `https://www.youtube.com/watch?v=12gtkYbMGd4` |
| 11 | Work Smarter, Not Harder | `https://vavkamil.cz/wp-content/uploads/2019/05/ctjb_2019_bugbounty.pdf` |
| 12 | Automating-the-recon-process | `https://null.community/event_sessions/2618-automating-the-recon-process` |
| 13 | Scrutiny on the bug bounty | `https://docs.google.com/presentation/d/1PCnjzCeklOeGMoWiE2IUzlRGOBxNp8K5hLQuvBNzrFY/edit` |
| 14 | Bug Bounties With Bash（TomNomNom） | `https://tomnomnom.com/talks/bash-bug-bounty.pdf` |
| 15 | ekoparty 2017 - the bug hunters methodology | `https://www.slideshare.net/bugcrowd/ekoparty-2017-the-bug-hunters-methodology` |

さらに **TBHM（The Bug Hunter's Methodology, Jason Haddix）の歴代版**が版ごとに列挙されている。ここが本ページの中核である。

| 版 | 内容・位置づけ | URL |
|---|---|---|
| v1 | 原典 "How Do I shot Web?"（PDF、jhaddix/tbhm リポジトリ） | `https://github.com/jhaddix/tbhm/blob/master/How%20Do%20I%20shot%20Web-.pdf` |
| v2.0 | Google Slides版 | `https://docs.google.com/presentation/d/1p8QiqbGndcEx1gm4_d3ne2fqeTqCTurTC77Lxe82zLY/edit` |
| v2.1 | Nullcon Goa 2018 版PDF | `https://nullcon.net/website/archives/pdf/goa-2018/jason-tbhm2.pdf` |
| v3 | Google Slides版 | `https://docs.google.com/presentation/d/1R-3eqlt31sL7_rj2f1_vGEqqb7hcx4vxX_L7E23lJVo/edit` |
| v4 | Google Drive PDF | `https://drive.google.com/file/d/1aG_qqRvNW-s5_8vvPk5rJiMSMeNL2uY9/view` |
| v4 Recon | v4のRecon特化版スライド | `https://docs.google.com/presentation/d/1MWWXXRvvesWL8V-GiwGssvg4iDM58_RMeI_SZ65VXwQ/edit` |
| 動画 | TBHM Video | `https://www.youtube.com/watch?v=gIz_yn0Uvb8` |

加えて **VirSecCon 2020** のスライド8本（うち `erbbysam` の "Trials, Tribulations & VHost Misconfigurations"、`tomnomnom.com/talks/bug-bounties-with-bash-virsec.pdf` など）と、**NahamCon** の埋め込み動画（`https://www.youtube.com/watch?v=MYsUhAgSgwc`）が続く。

> 出典: Bug Hunter Handbook — Presentations — https://gowthams.gitbook.io/bughunter-handbook/presentations

#### 1-2. 系譜として読む：3本の流れ

この一覧は、無秩序に見えて実は3つの流れが並走している。

1. **「方法論の体系化」の流れ**（ekoparty 2017 → TBHM v1〜v4 → v4 Recon）
   スコープ定義・資産発見・列挙・アプリ解析という**段階分け**そのものを発明していった系列。v1（"How Do I Shot Web?"）は「web hackingの総覧」だったが、v4でついに *Recon編* が独立したスライドに切り出された。これは、資産発見が「準備作業」から「独立した専門領域」へ昇格した瞬間を示す歴史的マーカーである。
2. **「自動化」の流れ**（Automation for Bug Hunters / ZeroNights 2018 BugBounty automation / Automating the recon process / BSidesSF 2019）
   ツールを繋いで回す発想。ここで確立した「1行1レコード＋パイプ＋差分検知」という設計が、のちのProjectDiscoveryツール群の入出力契約へ直結する。
3. **「シェル職人芸」の流れ**（TomNomNom: Passiveish / Bug Bounties With Bash）
   汎用ツールを作らず、`grep` `sort -u` `comm` `xargs -P` といったUnix標準コマンドで組む思想。**「パッシブ寄り（passiveish）」**という発想——つまり対象に直接パケットを送らずにどこまで情報が取れるかを最大化し、能動的な操作は最後に最小限だけ行う——は、スコープ遵守と検知回避の両面で今も有効な原則である。

#### 1-3. アーカイブ資料を扱うときの実務的注意（リンク腐食）

この種のリンク集は、**リンク腐食（link rot）**が最大の敵になる。Google Slides はオーナーが共有設定を変えれば即座に閲覧不能になり、カンファレンスサイト（ZeroNights 2018、Nullcon archives 等）はドメインごと消えることがある。有用な資料に出会ったら、その場で保全する習慣を持つ。

```bash
# 1) 現時点の版をWayback Machineに保存要求し、保存先URLを記録する
#    （save/ エンドポイントはアーカイブ後、Location か本文中に保存URLを返す）
curl -sS -I "https://web.archive.org/save/https://tomnomnom.com/talks/passiveish.pdf" \
  | grep -i '^content-location\|^location'

# 2) 手元にも原本を確保し、内容ハッシュを控える（後で「同じ版か」を判定できる）
curl -sSL -o passiveish.pdf "https://tomnomnom.com/talks/passiveish.pdf"
shasum -a 256 passiveish.pdf | tee passiveish.pdf.sha256
```

なぜハッシュまで取るのか。スライドは**同一URLのまま中身だけ差し替えられる**ことがあり、後日「自分が読んだのはどの版か」を証明できなくなるためである。教科書やノートに引用するときは、URLに加えて「取得日」と「SHA-256の先頭8桁」を添えておくと、再現性のある参照になる。

---

### 2. The Bug Hunter's Methodology フルトレーニング——カリキュラムの分解

> ⚠️ **未取得の資料**: 「The Bug Hunters Methodology full training（Class Central）」のページ本体は自動取得できませんでした（理由: サーバが HTTP 403 Forbidden を返し、ボット経由のアクセスを拒否したため）。以下のURLからご自身で直接ご覧ください: https://www.classcentral.com/course/youtube-the-bug-hunter-s-methodology-102530

ただし、同ページが掲載している**レッスン一覧（タイムスタンプ付き）**は検索経由で取得できたため、以下に再構成する。この講座は Jason Haddix による約2時間のフルトレーニング動画（YouTube配信をClass Centralがインデックス化したもの）で、構成は明確に **[MANUAL]（人間が判断する部分）** と **[AUTOMATION]（機械に任せる部分）** の二部制になっている。

| 区分 | レッスン | 開始位置 |
|---|---|---|
| MANUAL | Find root domain | 00:01:40 |
| MANUAL | Find sub-domains | 00:01:40 |
| MANUAL | Find acquisition domains | 00:05:40 |
| MANUAL | Find autonomous system numbers (ASNs) | 00:08:22 |
| MANUAL | ASN enumeration | 00:16:00 |
| MANUAL | Reverse WHOIS | 00:16:54 |
| MANUAL | AD/analytics relationships | 00:20:06 |
| MANUAL | Legal | 00:24:24 |
| MANUAL | SHODAN | 00:26:58 |
| AUTOMATION | Sub-domain enumeration | 00:27:57 |
| AUTOMATION | Sub-domain scrapping（scraping） | 00:40:12 |
| AUTOMATION | Questions/benchmarks | 01:08:32 |
| AUTOMATION | Sub-domain brute-force | 01:15:46 |
| AUTOMATION | Port analysis | 01:19:43 |
| AUTOMATION | Screenshots | 01:26:54 |
| AUTOMATION | Sub-domain takeover | 01:34:42 |
| AUTOMATION | Extending tools | 01:39:21 |
| AUTOMATION | Frameworks | 01:43:47 |

> 出典: Free Course: The Bug Hunter's Methodology（YouTube / Class Central） — https://www.classcentral.com/course/youtube-the-bug-hunter-s-methodology-102530

#### 2-1. この順番には必然性がある

カリキュラムを「章立て」としてではなく「**データフロー**」として読むと、設計意図が見えてくる。

- **root domain → sub-domains → acquisition domains → ASN**：これは*垂直*（1つの登録ドメインの下を掘る）から*水平*（組織が持つ別のドメイン群へ広げる）への拡張である。買収（acquisition）ドメインとASN（Autonomous System Number、BGPで経路広告を行う自律システムに割り当てられた番号）は、いずれも「同じ組織が支配する、別の名前空間／別のIP空間」を見つけるための手段だ。**DNS名から辿れない資産は、IP側（ASN → CIDR）から辿るしかない**——だからASNが早い段階に置かれている。
- **Reverse WHOIS / AD・analytics relationships**：登録者情報（組織名・メールアドレス）や、ページに埋め込まれた広告・解析タグ（例: Google Analytics のトラッキングID）を*共通キー*にして、別ドメインを相関させる手法。原理は単純で、**運用チームが同じなら同じ識別子を使い回す**という人間側の癖を突いている。技術的な穴ではなく運用上の痕跡を辿る点が重要で、だからこそDNS列挙では絶対に出てこない資産が出る。
- **Legal（00:24:24）が [MANUAL] の終盤に置かれている**：これは教材設計として極めて重要な配置である。資産を広げれば広げるほど「その資産は本当に対象組織のものか」「プログラムのスコープ内か」という帰属（attribution）と法的許諾の問題が急速に重くなる。**スコープ確認は自動化できない**ため、自動化パートに入る直前の関門として置かれている。クラウド共有基盤上のIPや、買収前の子会社資産は典型的な事故源である。
- **[AUTOMATION] へ移る境界（00:27:57）**：ここから先は「人間が判断した対象リストを、機械で網羅的に展開する」フェーズになる。列挙 → スクレイピング → ブルートフォース → ポート解析 → スクリーンショット → テイクオーバー判定、と**出力が次の入力になる直列構造**をとる。

#### 2-2. 「Questions/benchmarks」——この講座の思想的な核

注目すべきは、自動化パートの真ん中（01:08:32）に **Questions/benchmarks** が挟まっていることだ。ツールの使い方を並べる講座なら不要なセクションである。ここが入る理由は、**「どのサブドメイン列挙ツールが優れているか」を主観や流行ではなく計測で決める**という姿勢にある。

ベンチマークの基本形は、同じ入力に対して各ツールを走らせ、(a) ユニーク件数、(b) 他ツールにない固有の発見（unique contribution）、(c) 誤検出（解決しないホスト）の3軸で比較することだ。

```bash
# 前提: 自分が管理するドメイン、または能動的な列挙が明示的に許可された対象でのみ実行する
D=example.internal   # 自分の検証用ゾーン

# 各ツールの生出力を別ファイルに保存（比較可能にするため正規化: 小文字化 + 重複排除）
toolA -d "$D" | tr 'A-Z' 'a-z' | sort -u > a.txt
toolB -d "$D" | tr 'A-Z' 'a-z' | sort -u > b.txt

# 1) 件数
wc -l a.txt b.txt

# 2) Aだけが見つけたもの / Bだけが見つけたもの（comm は「ソート済み前提」で集合演算する）
comm -23 a.txt b.txt > only_a.txt
comm -13 a.txt b.txt > only_b.txt

# 3) 実在性の検証: 名前解決できたものだけを「真の発見」とみなす
cat a.txt b.txt | sort -u | dnsx -silent -a -resp-only >/dev/null
```

なぜ `sort -u` を先に通すのか。`comm` は**入力が辞書順にソート済みであることを前提に、2つのストリームを先頭から1行ずつ突き合わせる**アルゴリズムで動くため、未ソートのまま渡すと結果が静かに壊れる（エラーにならず、間違った差分が出る）。ここは初学者が最も踏みやすい罠である。また `tr 'A-Z' 'a-z'` を通すのは、DNS名が大小文字を区別しない（RFC 4343）一方で、ツールによっては CTログ由来の大文字混じりの名前をそのまま出力するため、正規化しないと「同じホストが2件」と数えられてしまうからだ。

**評価指標として件数だけを見てはいけない**理由も同じ文脈にある。ワイルドカードDNS（`*.example.com` が何を引いても同じIPを返す設定）が有効なゾーンでは、ブルートフォース系ツールが数万件の「解決するが実在しない」名前を吐く。したがって「解決したか」ではなく「**ワイルドカード応答と異なる結果を返したか**」で真偽を判定する必要がある。

#### 2-3. 「Extending tools」と「Frameworks」——最後の2章が意味するもの

末尾の2セクション（Extending tools 01:39:21 / Frameworks 01:43:47）は、この講座が単なるツール紹介で終わらないことを示している。

- **Extending tools**：既存ツールを「使う」のではなく「延長する」。具体的には、ツールの出力形式（JSON Lines等）を解釈して自分の判断ロジックを後段に足す、ワードリストを対象固有の語彙で育てる、テンプレート／シグネチャを自作する、といった行為を指す。**他のハンターと同じツールを同じ設定で回している限り、発見も他人と同じになる**——差別化の源泉がここにあるという主張である。
- **Frameworks**：個別ツールをオーケストレーションする枠組み（実行順序、再実行、差分管理、通知）へ移行する段階。本教科書のLv9（自動化）・Lv10（継続監視）に直結する。

#### 2-4. 陳腐化への注意——固有名詞は置換表で読む

この講座はTBHM v3〜v4期（おおむね2018〜2020年）の内容である。**構造（段階分けと判断基準）は現在も有効だが、登場するツール名の一部は保守停止・置換されている**。読むときは、以下のように「役割」に翻訳して受け取るとよい（2026年時点で一般的な選択肢を併記）。

| 講座中の役割 | 当時よく使われたもの | 現在の代表例（2026年時点） |
|---|---|---|
| パッシブなサブドメイン列挙 | sublist3r 等 | `subfinder`、`amass`（intel/enum）、CTログ直接照会 |
| 名前のブルートフォース | massdns + ラッパ | `puredns`、`shuffledns`（内部でmassdns） |
| 順列生成 | altdns | `alterx`、`gotator` |
| HTTPプローブ | httprobe | `httpx`（ステータス・タイトル・技術検出まで一括） |
| スクリーンショット | EyeWitness、aquatone | `gowitness`、`httpx -screenshot` |
| ポート解析 | masscan → nmap | `naabu` → `nmap`（naabuで絞ってからnmapで詳細） |
| テイクオーバー判定 | tko-subs、subjack | `nuclei`（takeoverテンプレート群）、`dnsx` のCNAME確認併用 |

重要なのは、**置換表の右側もいずれ古くなる**という点だ。だから覚えるべきは「HTTPプローブという工程が必要である」という構造の方であり、実装は都度公式ドキュメントで最新の推奨を確認する。

---

### 3. NahamSec × ProjectDiscovery「Free Post Recon Course」——自動化から方法論へ

> ⚠️ **未取得の資料**: 「NahamSec × ProjectDiscovery『Free Post Recon Course』」（YouTube動画）は自動取得できませんでした（理由: YouTubeの動画ページは説明文・チャプター情報をJavaScriptで描画するため、テキスト取得ではフッタのみが返り、本文メタデータを抽出できなかった。テキスト抽出プロキシ経由の再取得も 401 で拒否された）。以下のURLからご自身で直接ご覧ください: https://www.youtube.com/watch?v=RYdTp4a9S34

公開情報から確認できた範囲は次の通りである。

- タイトル: **"Free Post Recon Course and Methodology For Bug Bounty Hunters"**（NahamSecチャンネル、**2025年11月24日**公開）。
- 同シリーズの前編にあたる **"Free Recon Course and Methodology For Bug Bounty Hunters"**（`https://www.youtube.com/watch?v=evyxNUzl-HA`）が存在し、本動画はその「Recon の後」を扱う続編という位置づけ。
- ProjectDiscovery公式が同シリーズについて告知した内容（2025年9月）では、ウォークスルーの骨子が次のように示されている——「**VPS上にrecon用マシンを構築し／Go製インストーラ（pdtm）でPDツール群を一括導入・更新し／Subfinder → AlterX → DNSX → Naabu → HTTPX → Katana と連結し／automation から methodology へ進む**」。

> 出典: Free Post Recon Course and Methodology For Bug Bounty Hunters（NahamSec, 2025-11-24） — https://www.youtube.com/watch?v=RYdTp4a9S34
> 出典（補助）: ProjectDiscovery 公式告知（2025-09） — https://x.com/pdiscoveryio/status/1970567801023721872

（以下は未取得資料の補足として一般知識に基づく解説です）

#### 3-1. 「automation → methodology」という言い回しの意味

この一句が、シリーズ全体のテーゼである。パイプラインを組めるようになった直後のハンターが必ず直面する壁は、「**動いている。大量に出力される。で、どれを見ればいいのか？**」という問題だ。Reconの成果物は往々にして数千行のホスト一覧になるが、脆弱性は人が触ったところからしか出ない。したがって Post-Recon の本質は**トリアージ（選別）**である。

実務的には、次の軸で優先度をつける考え方が一般的である。

1. **新しさ**：直近に初めて観測された資産（新規サブドメイン、新規証明書、新規JSバンドル）。運用が固まる前の期間は設定不備が残りやすく、かつ他のハンターがまだ見ていない。差分検知（`anew` 等）の出力がそのまま優先キューになる。
2. **非標準性**：組織の大多数のホストと**違う**もの。異なるHTTPサーバ、異なるフレームワーク、異なる認証方式、非標準ポート。標準テンプレートから外れたホストは、標準の防御（WAFルール、共通ミドルウェア）からも外れている確率が高い。
3. **機能密度**：ログイン後の機能が多い、ファイルアップロードがある、外部連携（OAuth、Webhook、SSO）がある。攻撃面は「エンドポイント数」ではなく「状態遷移の数」に比例する。
4. **周辺性**：ステージング／レガシー／買収由来のホスト。ただし**スコープ内であることの確認が必須**で、ここを省略した瞬間に、学習が違反行為に変わる。

#### 3-2. チェーンの各段が「何を捨てているか」で理解する

告知にある `Subfinder → AlterX → DNSX → Naabu → HTTPX → Katana` は、Lv9で扱ったパイプラインと同型だが、Post-Recon の視点で見ると**各段は「候補を増やす段」と「候補を捨てる段」が交互に並んでいる**ことがわかる。

```
Subfinder  : 増やす（受動ソースから既知の名前を集める）
AlterX     : 増やす（既知名の語彙から順列候補を生成する＝まだ存在しない名前も含む）
DNSX       : 捨てる（解決しない名前を落とす＝実在性フィルタ）
Naabu      : 捨てる／絞る（開いているポートだけを残す）
HTTPX      : 捨てる／属性付け（応答したものだけを残し、ステータス・タイトル・技術を付与）
Katana     : 増やす（1ホストの内部を展開してエンドポイント集合にする）
```

この「増やす／捨てる」の交互構造が重要なのは、**捨てる段を省くと次段の負荷が指数的に増える**からだ。AlterXは組み合わせ爆発を起こしうる（語彙数×位置×区切り文字）ため、DNSXによる実在性フィルタなしにNaabuへ流せば、存在しないホストに対する無意味なスキャンを大量に発生させる。これは自分のコストの問題であると同時に、**対象や第三者のネットワークに無用な負荷をかけない**という倫理・法務上の要請でもある。

なお、ProjectDiscoveryの告知文では "Naboo" と綴られているが、これはポートスキャナ **`naabu`** の誤記と解するのが自然である（同社ツール群に "naboo" という製品は存在しない）。原典の表記を引く際は、こうした綴りのゆれに注意されたい。

#### 3-3. VPS上に「recon box」を作る、の技術的な意味

講座が「VPS recon box」を前提に置くのは、単に手元PCを汚したくないからではない。主な理由は3つある。

1. **ネットワーク的な事情**：家庭用回線の動的IPから大量のDNSクエリやHTTPリクエストを出すと、ISP側のレート制限やDNSリゾルバの制限に当たる。またプロバイダの利用規約に抵触する可能性もある。
2. **長時間実行**：継続Recon（Lv10）はcron等で回し続けるものであり、ノートPCの電源状態に依存させられない。
3. **再現性**：ツール群を `pdtm` で一括導入・更新することで、「自分の環境でだけ動く」状態を避けられる。

```bash
# pdtm（ProjectDiscovery Tools Manager）で主要ツールを導入・更新する
# ※ 事前に Go のツールチェーンが必要。導入先は既定で ~/.pdtm/go/bin
pdtm -install-all        # 一括導入
pdtm -update-all         # 一括更新（バージョン揃えは再現性の前提）
pdtm -list               # 導入済みツールとバージョンの確認
```

なぜバージョンを揃えることが「方法論」の一部なのか。Reconは**前回との差分**に価値がある活動であり、ツールの挙動（既定のソース、既定の並列度、出力フォーマット）が知らぬ間に変わると、**資産が増減したのかツールが変わったのか区別できなくなる**。差分運用を採る以上、環境の固定はデータ品質そのものである。実務では、パイプラインの実行ログに `pdtm -list` の出力を一緒に記録しておくとよい。

---

### 4. アーカイブを「自分の型」に変換する発展トレーニング

資料を読むだけでは方法論は身につかない。ここでは、上記3資料を素材にした学習設計を示す。**いずれも自分が管理する環境、または明示的に許可された範囲でのみ実施すること。**

#### 4-1. 三層に分けてノートを取る

1本のスライド／動画を消費するとき、内容を次の3層に分解して記録する。

| 層 | 記録する内容 | 陳腐化の速さ |
|---|---|---|
| **原理層** | なぜその手法が成立するのか（DNSの挙動、CTログの公開性、BGPの経路広告、HTTPの応答特性、人間の運用上の癖） | 遅い（年単位で不変） |
| **判断層** | どの条件でどちらへ進むか（「解決しないならCNAMEを見る」「CDN配下なら直接スキャンしない」「スコープ外なら触らない」） | 中程度 |
| **実装層** | 具体的なコマンド、ツール名、オプション | 速い（半年〜2年） |

TBHMの [MANUAL] 部はほぼ原理層と判断層でできており、[AUTOMATION] 部は実装層の比率が高い。**実装層だけを写経すると、ツールが変わった瞬間に何も残らない**。逆に原理層を押さえていれば、新しいツールが出ても「これは既知のどの工程の置換か」で即座に位置づけられる。

#### 4-2. 「同じ入力・違う方法論」で自己ベンチマークを回す

TBHMの Questions/benchmarks の思想を、自分の学習に適用する。手順は単純で、**自分が管理する検証用ドメインに対して**、(a) 手作業中心の方法論、(b) パイプライン中心の方法論、の両方を実行し、結果の集合を比較する。

```bash
# 自分の検証用ゾーンに対してのみ実行すること
mkdir -p runs/$(date +%F) && cd runs/$(date +%F)

# 方法論Aの結果、方法論Bの結果をそれぞれ正規化して保存
sort -u manual.txt  > A.txt
sort -u pipeline.txt > B.txt

# 「手作業でしか出なかったもの」が、方法論の穴を示す
comm -23 A.txt B.txt | tee gap_of_pipeline.txt
# 「自動化でしか出なかったもの」が、手作業の限界を示す
comm -13 A.txt B.txt | tee gap_of_manual.txt
```

この差分ファイルこそが**あなた固有の学習教材**である。`gap_of_pipeline.txt` に載った資産は、「自動化に組み込めば次回から自動で取れるようになる項目」のリストに等しい。方法論の改善とは、この差分を毎回ゼロに近づけ、そのうえで新しい発見経路を足していく作業にほかならない。

#### 4-3. 歴史資料を読むときのチェックリスト

- [ ] **公開年を特定したか**（スライドの表紙、カンファレンス名、URL中の年に注目）。例: ZeroNights 2018、VirSecCon 2020。
- [ ] **登場ツールが現在も保守されているか**を確認したか（最終コミット日、READMEのdeprecation表記）。
- [ ] **前提が変わっていないか**を確認したか。特に、CTログの必須化・DNS over HTTPS の普及・CDN配置の一般化・WHOIS情報のGDPRによる匿名化（2018年以降、登録者個人情報が大幅に秘匿された）は、当時の手法の有効性を直接左右する。
- [ ] **法的・スコープ上の前提**が現在のプログラム規約と一致しているか。古い資料には、現在では許容されない能動的手法が含まれることがある。
- [ ] 資料を**保全**したか（Wayback保存 + ローカル保存 + 取得日の記録）。

---

### まとめ

- **Bug Hunter Handbook の Presentations** は、TBHM v1〜v4を含む方法論の系譜を一望できるアーカイブである。「体系化」「自動化」「シェル職人芸」という3つの流れとして読むと、現代のパイプライン設計の由来が理解できる。リンク腐食に備え、有用な資料は取得日とハッシュ付きで保全する。
- **TBHMフルトレーニング**の構成（[MANUAL] 9項目 → [AUTOMATION] 9項目）は、垂直→水平の資産拡大、スコープ確認という関門、そして機械による網羅展開、という必然的なデータフローを表している。中央に置かれた *Questions/benchmarks* が示す「ツール選定を計測で決める」姿勢が、この教材の思想的な核である。ツール名は置換表で読み替え、構造だけを取り込む。
- **NahamSec × ProjectDiscovery の Post Recon 講座**（2025年11月）は、「automation → methodology」——すなわちパイプラインの出力をどう選別し、どこに人間の時間を投じるかという問題を扱う。チェーンを「増やす段」と「捨てる段」の交互構造として理解することが、負荷・倫理・効率の3面で正しい運用につながる。
- 発展トレーニングの要諦は、資料を**原理層／判断層／実装層**に分解して記録し、自分の検証環境で「手作業 vs 自動化」の差分を測り続けることにある。差分が、次に自動化すべき工程を教えてくれる。

## 実務家の思考とAI活用

Recon（偵察）は「ツールを並べて実行する作業」ではなく、「情報をどう流し込み、どう絞り込み、どう次の判断につなげるか」という**思考の設計**そのものである。本節では、Recon 分野で最も影響力のあるツール作者の一人である Tom Hudson（TomNomNom）の設計思想と、2025年前後に急速に広がった LLM（大規模言語モデル）活用の実例という、性質の異なる二つの資料を通じて、「熟練した実務家はどう考えるか」を掘り下げる。前者は「小さな道具をどう組み合わせるか」という**手作業の設計論**であり、後者は「AI という新しい道具をどう組み込むか」という**現在進行形の実践論**である。両者を対比させることで、Recon という営みの本質——「大量の入力を、意味のある小さな単位に分解し、パイプラインとして流し続けること」——が見えてくる。

### Tom Hudson（TomNomNom）とツール設計思想

#### 人物像とツール群

Tom Hudson は英国出身のセキュリティリサーチャーで、`tomnomnom` の名前で GitHub 上に多数の Recon 用コマンドラインツールを公開している。代表的なツールは以下の通りである。

| ツール | 役割 |
|---|---|
| `waybackurls` | Wayback Machine（Internet Archive）から対象ドメインの過去 URL を一括取得する |
| `httprobe` | ドメインリストを受け取り、HTTP/HTTPS で生存しているホストを判定する |
| `meg` | 大量ホスト × 大量パスの組み合わせを「幅優先」で走査するスキャナ |
| `unfurl` | URL を構成要素（ホスト名、パス、クエリのキー、拡張子など）に分解・整形する |
| `gf` | 複雑な `grep` パターン（SSRF が疑わしいパラメータ名、XSS が疑わしい文字を含む行、など）を名前付きで呼び出せるラッパー |
| `anew` | 標準入力の各行を、既存ファイルにまだ無い行だけ追記する（差分検知に使う） |
| `gron` | JSON を「1行1代入」の形に変換し、`grep`/`diff` で扱えるようにする |

これらはいずれも Go 言語で書かれており、単体のバイナリとして高速に動作する。

> ⚠️ **未取得の資料**: Tom Hudson の個人サイト（tomhudson.co.uk）は自動取得時にツール一覧・講演タイトル程度のごく簡潔な情報しか得られず、設計思想そのものを明記した文章は本文中に見つかりませんでした。以下は、公開されている代表的なツール群の実物（コマンド仕様）と、Daniel Miessler による解説記事（後述の出典参照）に基づく、Unix 哲学の観点からの補足です。詳細は本人のサイトおよび GitHub（https://github.com/tomnomnom）を直接ご確認ください。

#### 「1つのことをうまくやる」という設計原則

Tom Hudson のツール群に共通するのは、1970年代の Unix 哲学——"Write programs that do one thing and do it well. Write programs to work together."（1つのことをうまくやるプログラムを書け。互いに協調して動くプログラムを書け）——を Recon という文脈に忠実に適用している点である。

なぜこれが重要かを、仕組みのレベルで説明する。

```bash
cat domains.txt | httprobe | tee alive.txt | unfurl domains | gf ssrf
```

このパイプラインは次のように動作する。

1. `httprobe` は標準入力から1行ずつドメインを読み、HTTP/HTTPS 両方への接続を試み、生存確認できた URL だけを標準出力に1行ずつ書き出す。**入力も出力も「1行1件」のテキストストリーム**であることが鍵である。
2. `unfurl domains` は URL の羅列を受け取り、各行からホスト名部分だけを抜き出して1行ずつ出力する。内部的には URL パーサ（Go の `net/url`）で各行を解析し、必要なフィールドだけを再出力するだけの単純な処理である。
3. `gf ssrf` は、あらかじめ登録された「SSRF が疑わしいクエリパラメータ名」の正規表現パターン（`url=`, `dest=`, `redirect=`, `path=` など）を使って `grep -E` 相当の処理を行い、該当行だけを残す。

このパイプラインが「1本の巨大なツール」ではなく「4つの小さなツールの連結」で構成されていることには、実務上明確な利点がある。

- **差し替えが容易**: `gf ssrf` を `gf lfi` に変えるだけで、同じ収集結果から別の脆弱性クラスの候補を抽出できる。収集ロジックとフィルタリングロジックが分離されているため、片方だけを変更しても他方に影響しない。
- **デバッグが容易**: パイプラインの途中に `tee` を挟めば、任意の段階の中間出力をファイルに保存しながら処理を続けられる（上記の例では `alive.txt` に生存ホスト一覧を保存しつつ後続処理を続けている)。どの段階で想定外のデータが混入したかを、ファイルを見比べるだけで特定できる。
- **並列化・スケールが容易**: 各ツールが標準入出力のみでやり取りするため、`xargs -P` や `parallel` と組み合わせて複数ホストを並列処理することが自然にできる。1つの巨大なモノリシックツールでは、内部に並列処理を実装しなければこれができない。
- **他人のツールと組み合わせられる**: `subfinder`（サブドメイン列挙）や `httpx`（HTTP プロービング、Project Discovery 製）のような他作者のツールも、同じく「1行1件のテキストを標準入出力でやり取りする」という規約に従っているため、作者をまたいで自由に連結できる。これは特定のツールに依存しない、**エコシステムとしての設計**である。

`anew` は一見地味だが、Recon の実務では極めて重要な役割を持つ。継続的なスキャン（例: 毎日同じドメインに対して `subfinder` を実行する）において、

```bash
subfinder -d example.com -silent | anew subdomains.txt
```

とすれば、`subdomains.txt` に**まだ存在しない新規サブドメインだけ**が標準出力に出て、かつファイルにも追記される。これにより「昨日から増えた攻撃対象」だけを Slack 通知に流す、といった差分監視パイプラインを数行で組める。内部的には、ファイルの全行をメモリ上の集合（`map[string]struct{}`）に読み込み、標準入力の各行がその集合に存在するかを O(1) で判定しているだけの単純な実装だが、「差分検知」という Recon の中核的なニーズを1つのツールに切り出したことに価値がある。

`gron` は JSON を `grep`/`diff` できる形に変換する。

```bash
curl -s https://example.com/api/config.json | gron
```

は例えば

```
json = {};
json.apiKey = "abc123";
json.endpoints = [];
json.endpoints[0] = "https://internal-api.example.com";
```

のような「1行1代入」の出力を作る。JSON はネストした木構造であるため、通常は `jq` のようなクエリ言語を覚えないと特定の値を取り出せないが、`gron` の出力は単なるテキスト行なので、`grep internal` のような素朴な検索がそのまま使える。これは「新しいツールを学ぶコスト」を「既に知っている `grep`/`diff` の知識」で代替する、という設計判断であり、Recon 実務者が大量の JSON レスポンス（API のレスポンス、JS 内の設定オブジェクトなど）を高速に走査する際の負荷を大きく下げる。

`meg` は「幅優先（breadth-first）」でホストとパスの組み合わせを走査する点が特徴である。素朴な実装では「ホスト A に対してパス1〜1000を全部叩く → ホスト B に対して同様に」という**深さ優先**になりがちだが、これは1つのホストに短時間で大量のリクエストを送ることになり、WAF やレートリミットに引っかかりやすい。`meg` は「全ホストにパス1を送る → 全ホストにパス2を送る → …」という順序で処理することで、単一ホストへのリクエスト間隔を自然に空け、検知されにくく、かつ大規模な範囲を均等にカバーできる。これは「攻撃的ツールの設計であっても、対象への負荷分散という運用上の配慮が組み込まれている」実例であり、防御的な観点からも、Recon 起因のトラフィックパターンを理解するうえで参考になる（幅優先型のスキャンは、単一ホストへのリクエスト集中では検知しにくく、複数ホストにまたがる低頻度・広範囲のアクセスパターンとして現れる）。

> 出典: A @TomNomNom Recon Tools Primer — https://danielmiessler.com/blog/a-tomnomnom-tools-primer （Tom Hudson 本人のサイト https://tomhudson.co.uk/ は自動取得できた範囲が限定的だったため、ツール仕様の補足として本記事も参照した）

#### なぜ「Unix パイプライン」が Recon に向いているのか

Recon というタスクの本質は、**フィルタリングの連鎖**である。インターネット全体から始まり、

対象組織のドメイン → サブドメイン → 生存ホスト → 使用技術 → 公開エンドポイント → パラメータ → 脆弱性候補

という具合に、段階を追うごとに集合を絞り込んでいく。各段階は独立した「入力の集合を受け取り、出力の集合を返す」関数として捉えられるため、Unix パイプラインの「テキストストリームの変換の連鎖」というモデルと自然に一致する。これが、Recon コミュニティで小さな単機能ツールを大量に組み合わせるスタイル（TomNomNom 系ツール群、Project Discovery 系ツール群など）が主流であり続けている理由である。裏を返せば、防御側がログを監視する際も、「単一の巨大なスキャナーによる攻撃」だけでなく、「複数の小さなツールが順番に、あるいは並行して対象に触れる、段階的な偵察トラフィック」を想定する必要がある。

### バグバウンティにおける LLM 活用（morioka12, 2025年1月時点）

#### 全体像

日本語のセキュリティブログ「security researcher」を運営する morioka12 氏による記事「バグバウンティにおける LLM の活用事例」は、2025年1月時点（Burp Suite の AI 機能追加など2025年2月の情報も反映）で公開されていたバグバウンティ実務における LLM（ChatGPT、Claude、Gemini など）の具体的な活用ツール・手法を横断的にまとめたものである。記事は「セキュリティ知見の共有が目的であり、悪用を推奨しない」ことを明記している。

LLM の活用は大きく次の用途に分類される。

1. **Recon（情報収集）**: サブドメイン・ディレクトリ・パラメータの推測
2. **ソースコード解析**: JavaScript ファイルからの API エンドポイント抽出
3. **脆弱性スキャンの補助**
4. **ペイロード・ワードリスト生成**
5. **テストデータ・PoC 生成**
6. **レポート作成の自動化**

このうち、本節では Recon に直結する項目を中心に、仕組みと限界を掘り下げる。

#### Recon 領域での具体的なツール

**CewlAI** は Google Gemini を用いて、種となるドメイン名やキーワードから「意味的にありそうな」サブドメイン候補（`api-staging`, `internal-v2` など）を生成し、それを DNS 解決してサブドメイン推測の候補リストを広げる。これは、従来の辞書ベースのブルートフォース（固定ワードリストを総当たりする）が「命名規則の癖」を捉えられないのに対し、LLM が学習データ中の類似した命名パターン（`dev`, `staging`, `internal`, `v2`, `legacy` のような組織が使いがちな接頭辞・接尾辞の組み合わせ）から**確率的にもっともらしい候補を生成**できる点が本質的な違いである。ただし、これは既存の辞書攻撃を置き換えるものではなく、**候補集合を広げる補助**として使うのが実務上の位置づけである。

**Subwiz** は nanoGPT（小規模な GPT アーキテクチャ）を用い、既知のサブドメインの並びからビームサーチ（複数の候補を同時に保持しながら、最も確率の高い経路を探索するアルゴリズム）でサブドメイン名の続きを予測する。これは自然言語処理における「次の単語を予測する」タスクを、ドメイン名の文字列生成に応用したものであり、大規模な事前学習済み LLM ではなく**ドメイン特化の小規模モデルを自前で学習させる**アプローチである点が特徴的である。

**ffufai** は `ffuf`（Fuzz Faster U Fool、Go 製の高速ファザー）のワードリスト拡張に ChatGPT/Claude を利用する。対象 URL のパスパターンや HTTP レスポンスヘッダーの内容から、「この技術スタックならありそうなエンドポイント名・拡張子」を LLM に推論させ、ファジング対象のワードリストを動的に太らせる。

**Crawl4AI** は LLM を組み込んだクローラーで、単に HTML を取得するだけでなく、ページの意味的な構造（「これは API ドキュメントらしい」「これはログインフォームらしい」）を理解した上で、関連性の高いコンテンツやリンクを抽出する。従来のクローラーが「すべてのリンクを機械的に辿る」のに対し、LLM クローラーは「文脈的に価値がありそうなリンクを優先する」ことができる。

**Athena** と **WARC-GPT** はいずれも Wayback Machine のアーカイブデータ（WARC 形式）を LLM で解析するツールである。Wayback Machine には過去の Web ページのスナップショットが大量に保存されており、これは前述の `waybackurls` が取得対象とするデータでもある。従来は `waybackurls` で URL 一覧を機械的に取得するだけだったが、Athena/WARC-GPT はそのコンテンツ自体を LLM に要約・分析させることで、「過去にどのような変更があったか」「過去に存在した秘匿すべき情報（デバッグエンドポイント、内部 API のヒントなど）が残っていないか」をより効率的に発見できるとしている。

#### JavaScript 解析の具体的なワークフロー

記事で紹介されている実践的なフローは次の通りである。

1. ブラウザの開発者ツールで対象サイトの JavaScript ファイルを開き、内容をコピーする。
2. ChatGPT にファイル内容を貼り付け、次のようなプロンプトを与える。

```
このJavaScriptファイルを読んで、GET/POSTエンドポイントを構築するのを
手伝ってもらえますか？
```

3. LLM は JS コード中の `fetch(...)` や `axios.post(...)` のような API 呼び出し箇所、およびそこで使われているパラメータ名・エンドポイントパスを読み取り、実際に送信可能な HTTP リクエストの形（URL・メソッド・ボディ）に整形して提示する。
4. 得られたエンドポイント・パラメータ一覧を元に、IDOR（Insecure Direct Object Reference、他人のリソース識別子に差し替えてアクセス制御を確認する手法）や SQL インジェクションなどの脆弱性テストを実施する（本教科書のスコープ上、実際の攻撃手順そのものは扱わない）。

このワークフローが有効な理由を仕組みレベルで説明すると、難読化・minify（変数名短縮、改行除去などでファイルサイズを圧縮すること）された JavaScript は人間が目で読むと構造を追いにくいが、LLM は大量のコードコーパスで学習しているため、`function a(e,t){return fetch("/api/"+e+"/"+t)}` のような短縮された変数名のコードからでも、「これは `/api/{resource}/{id}` へのリクエストを組み立てる関数である」という**意味的なパターンマッチング**を行える。これは正規表現による機械的な `fetch(` 検索だけでは拾えない、複数行・複数関数にまたがる呼び出し関係の再構成を含む点で、従来の静的解析ツールと補完関係にある。ただし LLM は「もっともらしい」出力を生成する性質上、**存在しないエンドポイントを幻覚（hallucination、学習データやパターンから統計的にもっともらしいが事実に基づかない出力を生成する現象）として提示するリスク**があるため、生成された内容は必ず実際のレスポンスで検証する必要がある——記事自体はこの点を明示的には強調していないが、Recon 実務において LLM の出力を「仮説」として扱い、実測で裏取りする姿勢は必須である。

#### プロキシ統合とコマンドライン統合

Web プロキシ（Burp Suite、Caido）に AI を統合する動きも紹介されている。

- **Shift（Caido 用プラグイン）**: プロキシで捕捉したリクエストに対し、自然言語の指示でインターセプト内容の編集・リプレースルールの作成・ワードリスト生成・API エンドポイント内 JavaScript の解析を自動化する。
- **Hackvertor**: Repeater（リクエストを繰り返し送信して手動でテストする Burp Suite の機能）でのやり取りからエンコーディングパターンを学習し、カスタムタグ（特定のエンコード/デコード処理をリクエスト内に埋め込むための拡張記法）を Python で自動生成する。
- **BurpGPT**: 従来のスキャナーのシグネチャベース検知では見逃されがちな、文脈依存の脆弱性を LLM に評価させる。
- **Montoya API（Burp Suite 2025.2 以降）**: PortSwigger が提供する AI 連携基盤で、外部の API キーを個別に用意しなくても、PortSwigger 専用の AI プラットフォーム経由で LLM 機能を利用できるようになった。これはバージョン依存の情報であり、2025年2月時点でのリリース内容である。

コマンドライン統合の例として、Simon Willison 氏が開発した **`llm`** コマンドが紹介されている。これは ChatGPT や Gemini などの LLM を CLI から呼び出せるツールで、`katana`（クローリングツール）の出力や `Eyeballer`（スクリーンショットを分類する機械学習ツール）の分析結果とパイプで連結し、Google Dork（検索エンジンの高度な検索演算子を使った情報収集手法）の効率的な分析にも使えるとされている。これは前節で述べた TomNomNom 流の「標準入出力でツールを連結する」設計思想と、LLM ベースのツールが**同じ Unix パイプラインの作法に乗って合流している**ことを示しており、両資料の接続点として興味深い。

```bash
katana -u https://example.com -silent | llm "このURL一覧から、認証や管理機能に関連しそうなパスを抜き出して"
```

のような形で、既存の Recon パイプラインの最終段に LLM を「もう一つのフィルタ」として差し込める、というのが実務上の要点である。

#### 限界と実務上の位置づけ

記事で紹介されているツール群は、いずれも「LLM が Recon を自動的に代替する」ものではなく、**既存の Recon パイプラインに新しいフィルタ/生成ステップを1つ追加する**位置づけである点を押さえておく必要がある。具体的には次の限界がある。

- **幻覚のリスク**: LLM は学習データの統計的パターンから「もっともらしい」候補（サブドメイン名、エンドポイント、パラメータ）を生成するため、実在しないものを提示する場合がある。生成結果は必ず DNS 解決や実リクエストで検証する必要がある。
- **入力サイズの制約**: LLM にはコンテキストウィンドウ（一度に処理できるトークン数の上限）があるため、大規模な JavaScript バンドル全体を一度に渡せない場合があり、分割・要約が必要になることがある。
- **コストと再現性**: API 呼び出しには費用がかかり、また同じ入力でも生成結果が毎回微妙に異なる（決定論的でない）ため、大規模・継続的なスキャンにそのまま組み込むには、結果の一貫性をどう担保するかという設計上の課題がある。

記事は、著者自身の結論として「今後も AI/ML を活用したペンテストツールや活用事例は増加していくと予想されるため、バグバウンティハンター・セキュリティ実務者はこの分野を継続的にウォッチするか、自ら作ってみることを推奨する」と述べている。

> 出典: バグバウンティにおけるLLMの活用事例 — https://scgajge12.hatenablog.com/entry/bugbounty_llm

### 二つの資料から見える共通点

一見すると、TomNomNom の「小さな Go 製バイナリを標準入出力でつなぐ」流儀と、morioka12 が紹介する「LLM を Recon パイプラインに組み込む」流儀は対照的に見える。前者は決定論的で高速、後者は確率的で低速だが柔軟である。しかし実務家の視点で見れば、両者は同じ設計原則——**「1段階ごとに小さく専門化した処理を積み重ね、各段階の出力を次の段階の入力として渡す」**——の上に成り立っている。LLM ベースのツールが `llm` コマンドのように標準入出力に対応し、既存の Recon パイプラインの1ステップとして差し込める形で設計されているのは偶然ではなく、Unix パイプライン的な設計が数十年にわたって Recon（そして防御側のログ解析）の実務で有効であり続けてきたことの証左である。防御側にとっての含意は、「攻撃者・調査者のツールチェーンは今後ますます多様化し、LLM 生成のワードリストや幻覚を含む推測が混ざったトラフィックも増える」という点であり、単一ツールのシグネチャ検知だけに頼らず、パイプライン全体が生み出すトラフィックパターン（段階的な絞り込み、幅広いホストへの低頻度アクセスなど）を捉える監視設計が引き続き重要になる。

---

[← 第10章 継続的Reconとモニタリング](10-continuous-recon.md) ｜ [📖 目次](index.md) ｜ [付録 →](99-appendix.md)
