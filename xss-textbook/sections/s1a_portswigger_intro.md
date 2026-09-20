## XSSとは何か・反射型XSS・学習パス（PortSwigger）

### この章のねらい

XSS（クロスサイトスクリプティング）は「攻撃者が用意したJavaScriptを、被害者のブラウザの中で、被害者自身のセッション権限で実行させる」脆弱性です。SQLインジェクションが「サーバ側のデータベースに対する権限昇格」だとすれば、XSSは「クライアント側（ブラウザ）における権限昇格」だと考えると理解が速くなります。攻撃者は被害者のパスワードやCookieを直接盗むわけではなく、被害者のブラウザに「被害者になりすまして動くコード」を注入します。この節ではまず業界標準の教材であるPortSwigger Web Security Academyの総論ページと反射型XSSのページを軸に、XSSの定義・3分類・影響・防御の全体像と、最も基本形である反射型XSSの成立条件を仕組みレベルで解説します。最後に、学習を進めるためのプラットフォームの使い方（学習パス）を案内します。

### XSSの定義と、なぜ「クロスサイト」と呼ばれるのか

PortSwiggerの総論ページは、XSSを次のように定義しています。

> "Cross-site scripting (also known as XSS) is a web security vulnerability that allows an attacker to compromise the interactions that users have with a vulnerable application."
> （クロスサイトスクリプティングとは、攻撃者が脆弱なアプリケーションとユーザーとのやり取りを侵害できるようにするWebセキュリティ脆弱性である）

> 出典: Cross-site scripting — https://portswigger.net/web-security/cross-site-scripting

ここで重要なのは、XSSが「サーバの脆弱性」であると同時に「ブラウザの実行モデルを悪用する攻撃」であるという二面性です。名前の由来である「クロスサイト」は、歴史的には「攻撃者のサイトから、脆弱な別サイトへスクリプトを注入する」という初期の攻撃パターンに由来しますが、現在のXSSは必ずしも複数サイトをまたぐ必要はありません（自サイト内の入力欄に自分でスクリプトを仕込んで、それを他人に踏ませるだけでも成立します）。名前と実態がずれているため、初学者は「クロスサイト」という語感に引きずられず、「信頼されていない文字列が、ブラウザにコードとして解釈される場所に紛れ込む」ことこそが本質だと理解してください。

XSSが成立するために必要な条件は、原理的には次の2つだけです。

1. **入力点（Source）**: 攻撃者が何らかの形で文字列をアプリケーションに渡せる（URLパラメータ、フォーム入力、HTTPヘッダ、Cookie、postMessage、URLのフラグメントなど）。
2. **出力点（Sink）**: その文字列が、ブラウザによって「データ」ではなく「コード（あるいはコードを生成する材料）」として解釈される場所に、無害化されずに到達する（HTMLとして描画される、JavaScriptの文字列リテラルに埋め込まれる、`innerHTML`に代入される、`eval`に渡されるなど）。

この「Source → Sink」という図式は、反射型・格納型・DOM型のいずれにも共通する骨格です。3つの型の違いは、突き詰めれば「SourceとSinkの間に、どんな経路（サーバを経由するか、DBに保存されるか、クライアント側JSだけで完結するか）があるか」の違いにすぎません。

### XSSの3分類

PortSwiggerは3種類のXSSを次のように定義しています。

> "Reflected XSS, where the malicious script comes from the current HTTP request."
> "Stored XSS, where the malicious script comes from the website's database."
> "DOM-based XSS, where the vulnerability exists in client-side code rather than server-side code."

> 出典: Cross-site scripting — https://portswigger.net/web-security/cross-site-scripting

#### 反射型XSS（Reflected XSS）

> "Reflected cross-site scripting arises when an application receives data in an HTTP request and includes that data within the immediate response in an unsafe way."
> （反射型XSSは、アプリケーションがHTTPリクエストの中でデータを受け取り、そのデータを安全でない形で即座のレスポンスに含めてしまうときに発生する）

つまり、**1回のリクエスト・レスポンスの往復の中で完結する**XSSです。データベースへの保存を経由しないため、攻撃を成立させるには「悪意あるURLを被害者にクリックさせる」という追加の一手間（ソーシャルエンジニアリング、メール、SNS投稿、罠サイトへの埋め込みなど）が必要になります。この配送コストの高さが、後述するように格納型より一般に深刻度が低いとされる理由です。

#### 格納型XSS（Stored XSS）

> "Stored cross-site scripting arises when an application receives data from an untrusted source and includes that data within its later HTTP responses in an unsafe way."

攻撃者の入力がデータベースやログ、コメント欄、ユーザープロフィールなどに**保存**され、他のユーザーがそのページを閲覧するたびに実行されます。反射型と違って「被害者に特定のURLを踏ませる」手間が不要で、通常のページ閲覧だけで被害者が巻き込まれるため、一般に反射型より深刻度が高いとされます。

#### DOM型XSS（DOM-based XSS）

> "DOM-based XSS arises when an application contains some client-side JavaScript that processes data from an untrusted source in an unsafe way, usually by writing the data back to the DOM."

反射型・格納型が「サーバがHTMLを組み立てる過程」に脆弱性があるのに対し、DOM型は**サーバのレスポンスは無害なのに、ブラウザ内で動くJavaScriptが信頼できない値（`location.hash`、`document.referrer`、`postMessage`のデータなど）を危険なSink（`innerHTML`、`document.write`、`eval`など）に渡してしまう**ことで発生します。サーバ側のログやWAFには「攻撃の痕跡」が残らないことがあり、静的なコードレビューだけでは見つけにくいのが特徴です（DOM型の詳細な機序は本書の後続章で扱います）。

この3分類は「どこに脆弱性のコードがあるか」という軸での分類であり、互いに排他的というより「注入経路の違い」だと捉えるのが正確です。

### 反射型XSSの成立を仕組みレベルで追う

反射型XSSのページでは、次のような教科書的な例が示されています。攻撃者は次のようなURLを組み立てます。

```
https://insecure-website.com/search?term=<script>/* 悪意あるコード */</script>
```

そして、脆弱なアプリケーションは検索語をレスポンスHTMLの中にそのまま埋め込みます。

```html
<p>You searched for: <script>/* 悪意あるコード */</script></p>
```

> 出典: Reflected cross-site scripting — https://portswigger.net/web-security/cross-site-scripting/reflected

**なぜこれで任意コードが実行されるのか**を、ブラウザのHTMLパーサの動作から説明します。ブラウザがHTMLをレンダリングするとき、HTMLパーサは文字列を「テキストノード」「タグ」「属性」といった構造に逐次分解していきます。このとき、パーサは現在どの「解析状態（トークナイザの状態）」にいるかによって、同じ文字（例えば `<` や `"` ）の意味づけをまったく変えます。

上の例では、サーバはユーザー入力（`term`パラメータの値）を「HTMLのテキストノードの内容」としてそのまま出力バッファに連結しています。もし入力が単なる文字列 `gift` であれば、パーサは `<p>You searched for: gift</p>` を「pタグの中のテキスト `You searched for: gift`」として解釈し、何も問題は起きません。

しかし、入力に `<script>...</script>` という文字列がそのまま混入すると、HTMLパーサはこれを**攻撃者が意図した通りに「テキスト」ではなく「新しい要素の開始タグ」として解釈します**。パーサにとって、その文字列がどこから来たか（開発者が書いた固定文字列か、ユーザーが送ってきた入力か）は一切区別されません。HTMLパーサは「文字の並びとその出現位置」だけを見て構文木を組み立てるからです。これが、Web開発において「信頼できるコード（テンプレート側の文字列）」と「信頼できないデータ（ユーザー入力）」を、出力時に明確に区別してエンコードしなければならない根本的な理由です。この区別を怠ると、データがコードに「昇格」してしまいます。

この「コンテキストに応じた解釈の変化」がXSS対策の核心です。同じ `term` パラメータでも、それがどこに出力されるかによって危険な文字集合が変わります。

- **HTMLのテキストノードとして出力される場合**: `<` と `&` が危険（タグの開始やエンティティの開始と解釈されるため）。
- **HTML属性値の中に出力される場合**（例: `<input value="ここ">`）: 属性を閉じる引用符（`"` や `'`）が危険。属性が引用符なしで書かれている場合は空白文字すら危険になります。
- **JavaScriptの文字列リテラルの中に出力される場合**（例: `<script>var x = "ここ";</script>`）: 文字列を終端させる引用符やバックスラッシュ、さらに `</script>` という文字列そのものがHTMLパーサによって「scriptタグの終了」として解釈されてしまう点に注意が必要です（JSパーサとHTMLパーサという2段階の解釈が絡むため）。
- **URLの中に出力される場合**（例: `<a href="ここ">`）: `javascript:` スキームを使われると、リンククリック時にコードが実行されます。

反射型XSSページはこの「コンテキスト依存性」を、後続の攻略手順としてではなく原理として明示しています。攻撃者は自分の入力がどのコンテキストに落ちるかをまず観察し、そのコンテキストを「脱出」するペイロードを選びます。例えば属性値の中であれば `">` でまず属性とタグを閉じ、その後に新しいタグや `onerror` のようなイベントハンドラ属性を続ける、といった具合です。

### なぜ反射型XSSには「配送」という一手間が必要なのか

反射型XSSは「その場限りのリクエスト」に依存するため、攻撃者は**被害者に悪意あるURLを踏ませる**という追加のステップを必ず必要とします。PortSwiggerはこの点を明確にしています。

> "reflected XSS attacks require some way of luring the victim into making an unintended request that triggers the injected code... reflected XSS is generally less severe than stored XSS, where a self-contained attack can be delivered within the vulnerable application itself."

配送手段としては、フィッシングメールに罠URLを埋め込む、SNS投稿やコメント欄にリンクを貼る、短縮URLで見た目を偽装する、第三者サイトの `<img>` や `<iframe>` から誘導するなどが典型です。反射型は「1リクエスト完結」であるがゆえに、CSRF同様、被害者のブラウザに「クリックさせる/踏ませる」フェーズが攻撃全体のボトルネックになります。逆に言えば、反射型XSSを本番環境で評価する際は「このURLを実際に誰かに送りつけられる状況か」を合わせて検討する必要があります（例えば、POSTリクエストでしか再現しない反射型XSSは、GETによるワンクリック攻撃に比べて配送難易度が上がります）。

### 反射型XSSがもたらす実害

反射型XSSは「ただのアラート(`alert(1)`)が出るだけの無害なバグ」と誤解されがちですが、PortSwiggerは実害を明確に列挙しています。

> 攻撃者は被害者になりすまし、被害者が実行できる**あらゆる操作**を実行でき、被害者が閲覧できる**あらゆる情報**にアクセスできる。

具体的には、セッションCookieの窃取（`document.cookie` の外部送信）、CSRFトークンの読み取りによる別の防御機構の無効化、キーロガーの設置、フィッシングフォームの動的な差し込み、管理画面へのリクエストの代理実行（被害者が管理者であれば管理者権限での操作）などが挙げられます。総論ページはより一般的な影響として次を挙げています。

> "impersonate or masquerade as the victim user, carry out any action that the user is able to perform, read any data that the user is able to access, capture the user's login credentials, perform virtual defacement of the website, inject trojan functionality into the website"

> 出典: Cross-site scripting — https://portswigger.net/web-security/cross-site-scripting

深刻度は文脈に強く依存します。ブローシャー的な公開サイト（ログインもなく、個人情報も扱わない）であれば影響は軽微ですが、銀行や医療機関のように機微な情報を扱うアプリケーションでは深刻な情報漏洩につながり、被害者が管理者権限を持つユーザーであれば、XSS一つからアプリケーション全体の乗っ取り（管理アカウントの作成、全ユーザーデータの窃取など）に発展し得ます。

XSSが強力である理由の一つは、**同一オリジンポリシー（Same-Origin Policy）というブラウザの根幹的な防御をすり抜ける**点にあります。同一オリジンポリシーは「あるオリジンのスクリプトが、別オリジンのデータに自由にアクセスすることを防ぐ」仕組みですが、XSSによって注入されたコードは脆弱なサイト自身のオリジンで実行されるため、この防御の内側から動作します。攻撃者はブラウザの防御を破っているのではなく、防御が守ろうとしている「境界」の内側に、正規のコードとして紛れ込んでいるのです。

### 防御の全体像

XSS対策の基本原則は、総論ページと防御ページの双方で共通して示される次の2層構造です。

> "encode data on output" と "validate input on arrival"（出力時のエンコードと、入力到達時のバリデーション）

> 出典: Cross-site scripting: preventing — https://portswigger.net/web-security/cross-site-scripting/preventing

**出力時エンコードがコンテキストごとに異なる**ことが実務上もっとも間違えやすいポイントです。防御ページは次のような対応関係を示しています。

- HTMLコンテキストでは `<` を `&lt;`、`>` を `&gt;` のようにHTMLエンティティへ変換する。
- JavaScript文字列コンテキストでは、英数字以外の文字をUnicodeエスケープする（例: `<` を `<`）。
- HTML属性の中にあるイベントハンドラなど、複数のコンテキストが重なる場所では、**Unicodeエスケープしてから、さらにHTMLエンコードする**という2段階の処理が必要になる場合がある。

言語ごとの実装例として、PHPでは `htmlentities($input, ENT_QUOTES, 'UTF-8')` の使用が挙げられ、JavaScriptには標準のHTMLエンコードAPIが存在しないため独自実装が必要になる点、jQueryでは「セレクタの先頭が `<` の場合にHTMLとして描画される」という仕様上の落とし穴がある点が指摘されています。TwigやJinja、Reactのような現代的なテンプレートエンジンは、デフォルトでコンテキストに応じたエスケープを行うため、これらを正しく使うこと自体が強力な防御になります（ただし `dangerouslySetInnerHTML` のような「エスケープを意図的にバイパスするAPI」を使えば、当然この保護は失われます）。

**入力バリデーションはホワイトリスト方式を基本とすべき**であるとも強調されています。

> "Input validation should generally employ whitelists rather than blacklists."

URLであれば `http://` や `https://` で始まることを確認する、数値項目であれば数字以外を拒否する、といった「許可リスト」の考え方が、「危険な文字列パターンを列挙して拒否する」ブラックリスト方式より堅牢です。ブラックリストは `<script>` を拒否しても `<img onerror=...>` のような別表現を見落としがちで、原理的にいたちごっこになりやすいためです（この点は本書の後続章で、フィルタバイパスの技法として詳しく扱います）。

ユーザーがHTMLそのものを投稿できる機能（リッチテキストエディタなど）はXSSのリスクを本質的に高めるため、防御ページは「可能な限り避けるべき」としつつ、どうしても必要な場合はDOMPurifyのようなクライアントサイドのサニタイズライブラリの利用を推奨しています。

最後の防衛線として、**Content Security Policy（CSP）**が挙げられています。CSPはHTTPレスポンスヘッダでブラウザに「どのオリジンからのスクリプトなら実行してよいか」を宣言する仕組みで、次のような例が示されています。

```
default-src 'self'; script-src 'self'; object-src 'none';
```

インラインスクリプトを許可しつつ攻撃者による差し込みを防ぐ手段として、**nonceベースのCSP**にも言及があります。

> "A nonce is a random string...which will only be executed if the random string matches the server-generated one."

これはレスポンスごとにサーバがランダムな一回限りの文字列（nonce）を生成し、`<script nonce="...">` タグとCSPヘッダの両方に同じ値を埋め込むことで、「サーバが意図して発行したインラインスクリプトだけ」を実行許可する仕組みです。攻撃者は事前にnonce値を知る手段がないため、たとえHTMLインジェクションに成功しても、正しいnonceを持たないスクリプトタグは実行されません（ただし、CSPには数多くのバイパス手法が存在し、単体で万能の防御にはならない点には注意が必要です。これも後の章で扱います）。

なお、かつてInternet ExplorerやChromeには「XSS Auditor」「XSS Filter」と呼ばれる、ブラウザ側でリクエストとレスポンスを比較し反射型XSSらしきパターンを検知してブロックするヒューリスティックな機構が存在しました。しかしこれらは多数の回避手法が発見され、さらに正規のコンテンツを誤ってブロックする副作用（意図せぬ情報漏洩を招く「XSS Auditorを悪用した攻撃」すら発見された）が問題視され、Chromeは2019年にXSS Auditorを撤廃し、Microsoft EdgeもEdgeHTMLエンジンの終了とともにXSS Filterを廃止しました。この歴史が示す設計上の教訓は、「攻撃パターンの検知によるブラックリスト的防御は、ブラウザという巨大な攻撃対象領域の中では原理的に破られる」ということであり、これが現在のセキュリティ業界がCSPのような「許可されたものだけを実行する」ホワイトリスト型・宣言的な防御機構へ軸足を移した理由です。

### PortSwigger Web Security Academyの学習パス

PortSwiggerが提供する無料の実習プラットフォーム「Web Security Academy」には、体系的に学習を進めるための「Learning Paths（学習パス）」という機能があります。

> "Our learning paths provide a structured approach to learning web security, allowing you to advance at your own pace while ensuring a deep understanding of the subject matter."

> 出典: Learning paths | Web Security Academy — https://portswigger.net/web-security/learning-paths

学習パスは、複数の「トピック」にまとめられた「モジュール（インタラクティブなラボ、または脆弱性の解説コンテンツ）」から構成されており、学習者は進捗を記録しながら自分のペースで中断・再開できます。PortSwiggerの公式ブログによれば、最初に公開された学習パスは次の2本でした。

- **サーバーサイド脆弱性（Apprenticeレベル）**: 実際のシステムでどのように攻撃者がサーバーサイドの脆弱性を発見・悪用するかの概観を、初級者向けに提供するパス。
- **SQLインジェクション**: SQLインジェクションという古典的な脆弱性の発見と悪用の要点に絞ったパス。

> 出典: New learning paths, from the Web Security Academy — https://portswigger.net/blog/new-learning-paths-from-the-web-security-academy

その後、学習パスは認証（Authentication）、CSRF、GraphQL APIの脆弱性など、他の脆弱性カテゴリにも拡張されています。Academy全体は、脆弱性カテゴリ（XSS、SQLi、CSRF、SSRF、XXE、パストラバーサル、リクエストスマグリング、Webキャッシュ欺瞞、APIテストなど）ごとに、概念解説・実際に手を動かして攻撃を試せるハンズオンラボ・習熟度チェックのための試験問題が用意された、業界でもっとも網羅的な無料学習プラットフォームの一つです。本書でも以降の章で、各トピックのAcademyページを参照しながら解説を進めます。ラボそのものの個別の解法（どのペイロードをどこに入れれば「Solved」になるか、といった手順）は本書ではあえて記載しません。これは、実際に自分の手でHTTPリクエストを観察し、ペイロードを試行錯誤する過程そのものが学習の核心だからです。読者はぜひ、この節で説明した原理（Source/Sinkの図式、コンテキスト依存のエスケープ規則）を武器に、Academyの反射型XSSカテゴリのラボへ実際に挑戦してみてください。

### まとめ

- XSSの本質は「信頼できない文字列が、ブラウザにコードとして解釈される文脈に、無害化されずに紛れ込む」ことである。
- 反射型・格納型・DOM型の違いは、Source（入力点）からSink（出力点）に至る経路の違いであり、反射型は1リクエストで完結するがゆえに配送に一手間かかり、一般に格納型より深刻度が低いとされる。
- HTMLパーサは「文字がどこから来たか」を区別せず、現在の解析状態に応じて機械的に解釈するため、開発者はコンテキストごとに異なるエスケープ規則を出力時に適用しなければならない。
- 防御は「入力のホワイトリストバリデーション」と「出力のコンテキスト別エンコード」を土台に、CSPやHttpOnly Cookieなどの多層防御を重ねる。ブラウザ組み込みのXSSフィルタのような検知ベースの防御は歴史的に破られ廃止されており、宣言的・許可リスト型の防御へ移行してきたという経緯自体が重要な設計上の教訓である。
- 学習にはPortSwigger Web Security Academyの学習パスが有用であり、体系立ったトピック・モジュール構成で自分のペースで進められる。
