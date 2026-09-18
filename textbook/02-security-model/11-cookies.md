# Cookie の属性と SameSite ── いつ・どこへ送られるかを制御する

> **この節で分かること**
> - `Set-Cookie` / `Cookie` ヘッダで Cookie がどう設定され送り返されるかを説明できる
> - `Domain` / `Path` / `Secure` / `HttpOnly` / `SameSite` / `Partitioned` 各属性の意味と、どれがセキュリティ境界になり「どれはならないか」を区別できる
> - `SameSite` の `Strict` / `Lax` / `None`、既定 Lax、そして「Lax+POST 2 分猶予（Lax-allowing-unsafe）」の穴を説明できる
> - `__Secure-` / `__Host-` プレフィックスが何を保証し、cookie tossing / cookie fixing をどう部分的に緩和するかを説明できる
> - Cookie の「Weak Confidentiality（弱い機密性）」「Weak Integrity（弱い完全性）」が何であり、どこを攻撃者が突くかを説明できる
> - 診断時に Cookie 設定を見て CSRF や兄弟サブドメインからの上書きのリスクを自分で評価できる

**元資料**: https://web.dev/articles/samesite-cookies-explained （原典 web.dev は取得できず、記事原稿リポジトリ GoogleChrome/web.dev から全文取得済み）／ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie （原典取得済み）／ RFC 6265bis ドラフト原稿 https://github.com/httpwg/http-extensions （原典取得済み）／ https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6 （原典は取得できず一次資料で補完）
**関連する節**: 同一オリジンポリシー、CSRF、XSS の各節

---

## 1. なぜ Cookie に「属性」が必要なのか

Cookie（クッキー）とは、サーバが Web ブラウザに保存させる小さな `key=value` のデータのこと。ブラウザは以後そのサーバへのリクエストのたびに保存した Cookie を自動で送り返す。これによって「ログイン済み」「カートの中身」といった**状態**を Web に持たせられる。

Cookie は Web の初期から存在し、長年の拡張の結果、プラットフォームに問題のある旧来の挙動（legacy issues）が残った。そのため Chrome・Firefox・Edge を含むブラウザは、**プライバシーをより良く保護する既定値**へと動作を変え続けている。この節で扱う属性群は、まさにその「旧来の緩い挙動」を絞り込むために足されてきたものだ。

それぞれの Cookie は `key=value` のペアと、「その Cookie が**いつ・どこで使われるか**を制御するいくつかの属性」で構成される。属性で有効期限を設定したり、HTTPS でのみ送るよう設定したりできる。Cookie は **HTTP ヘッダ経由**でも **JavaScript インターフェース経由**でも設定できる。

### 1.1 `Set-Cookie` と `Cookie` ヘッダの往復

サーバは **`Set-Cookie` レスポンスヘッダ**で Cookie を設定し、ブラウザは **`Cookie` リクエストヘッダ**で送り返す。次の例は、ブログで「新着情報」プロモを一度閉じたらしばらく出さない、という Cookie を 1 か月（= **2,600,000 秒**）で期限切れにし、HTTPS のみで送る設定である。

```text
Set-Cookie: promo_shown=1; Max-Age=2600000; Secure
```

条件（安全な接続で、Cookie が 1 か月以内に作られたもの）を満たすページを閲覧すると、ブラウザは次のヘッダを送り返す。

```text
Cookie: promo_shown=1
```

```
サーバ                         ブラウザ
  |  --- Set-Cookie: promo_shown=1 --->  | 保存
  |                                      |
  |  <-- Cookie: promo_shown=1 --------  | 以後のリクエストで自動送信
```

### 1.2 JavaScript からの読み書き（`document.cookie`）

JavaScript からは `document.cookie` でそのサイトで利用可能な Cookie を追加・読み取りできる。`document.cookie` への**代入は、そのキーの Cookie の作成または上書き**になる。ブラウザの JavaScript コンソールでの実行例:

```text
→ document.cookie = "promo_shown=1; Max-Age=2600000; Secure"
← "promo_shown=1; Max-Age=2600000; Secure"
```

`document.cookie` の**読み取り**は、現在のコンテキストでアクセス可能なすべての Cookie を**セミコロン区切り**で返す:

```text
→ document.cookie;
← "promo_shown=1; color_theme=peachpuff; sidebar_loc=left"
```

〔補足〕診断の観点では、`document.cookie` が「現在のコンテキストで**可視な** Cookie の集合」を返す点が重要だ。後述の `HttpOnly` 付き Cookie はここに現れない。つまり XSS（Cross-Site Scripting、クロスサイトスクリプティング。攻撃者の JavaScript を被害者ブラウザで実行させる攻撃）で盗める Cookie と盗めない Cookie の切り分けに、この 1 行が使える。

### 1.3 数とサイズは控えめに

人気サイトを見ると 3 個どころではない Cookie が設定されている。ほとんどの場合それらは**そのドメインへのすべてのリクエスト一つ一つ**で送信される。ユーザーのアップロード帯域はダウンロードより制限されていることが多いため、この送信オーバーヘッドは **Time to First Byte（TTFB、最初の 1 バイトが返るまでの時間）** を悪化させる。設定する Cookie の**数とサイズは控えめに**し、`Max-Age` で必要以上に長く残らないようにするのが基本である。

## 2. ファーストパーティ Cookie とサードパーティ Cookie

「ファーストパーティ / サードパーティ」は Cookie 固有の属性**ではない**。ユーザーが今どこにいるかに対する**相対的なラベル**である。

現在訪問中のサイト（**ブラウザのアドレスバーに表示されているサイト**）のドメインに一致する Cookie を **ファーストパーティ Cookie（first-party cookie）**、それ以外のドメインからの Cookie を **サードパーティ Cookie（third-party cookie）** と呼ぶ。原文はこう強調している ──「これは絶対的な分類ではなく、ユーザーのコンテキストに応じた相対的なもの。同じ Cookie でも、ユーザーがその時点でどのサイトにいるかによってファーストパーティであったりサードパーティであったりする。」

### 2.1 具体例で理解する

自分のブログの猫画像が `/blog/img/amazing-cat.png` にあり、それを他人が自分のサイトで直接使っているとする。訪問者が過去にあなたのブログを訪れて `promo_shown` Cookie を持っていれば、**他人のサイト上でその画像を表示する際のリクエストにも Cookie が送信される**。`promo_shown` は他人のサイトでは何の役にも立たず、リクエストのオーバーヘッドを増やすだけだ。

なぜこんな挙動があるのか（設計意図）。それは**サイトがサードパーティのコンテキストで使われても状態を維持できる**ようにするためだ。たとえば YouTube 動画の埋め込み。訪問者が既に YouTube にサインインしていれば、そのセッションがサードパーティ Cookie によって埋め込みプレーヤー内で使え、「後で見る（Watch later）」ボタンがサインインを促さずに機能する。

### 2.2 攻撃者はどこを突くか ── CSRF の芽

この「誰が始めたリクエストでも Cookie が付く」挙動こそ、CSRF（Cross-Site Request Forgery、クロスサイトリクエストフォージェリ。被害者のログイン状態を悪用して意図しない操作を行わせる攻撃）の土台である。原文の説明（訳）:

> クロスサイトリクエストフォージェリ攻撃は、**誰がリクエストを開始したかに関わらず特定のオリジンに対するリクエストに Cookie が添付されてしまう**という動作を悪用している。たとえば `evil.example` にアクセスすると、`your-blog.example` へのリクエストが誘発され、ブラウザが関連する Cookie を喜んで添付してしまう。ブログがリクエストの検証に注意を払っていなければ、`evil.example` が記事の削除や独自コンテンツの追加などのアクションを起こし得る。

これまで Cookie には**意図を明示する手段がなかった**のが問題だった。`promo_shown` はファーストパーティでのみ送られるべきだが、埋め込みウィジェット用のセッション Cookie はサードパーティのコンテキストでサインイン状態を提供するために**意図的に**存在する。両者を区別する手段が `SameSite` 属性である。

## 3. 「site（サイト）」の定義と Public Suffix List

`SameSite` を理解するには、まず「site（サイト）」の定義が要る。ここでの site とは、**ドメインサフィックス + その直前のドメイン部分**の組み合わせのこと。原文（訳）: 「`www.web.dev` ドメインは `web.dev` サイトの一部である。」

- ユーザーが `www.web.dev` にいて `static.web.dev` から画像を要求 → **same-site（同一サイト）** リクエスト。
- ユーザーが `your-project.github.io` にいて `my-project.github.io` から画像を要求 → **cross-site（クロスサイト）** リクエスト。

なぜ後者がクロスサイトなのか。これを定義するのが **Public Suffix List（公開サフィックスリスト、`https://publicsuffix.org/`）** で、`.com` のようなトップレベルドメインだけでなく `github.io` のような**サービスも含む**からだ。そのため `your-project.github.io` と `my-project.github.io` は別々のサイトに数えられる。

〔補足〕この「site = eTLD+1（登録可能ドメイン）」という境界は、診断上とても重要な帰結を持つ。同一サイト内のサブドメイン（例 `a.example.com` と `b.example.com`）は **SameSite の観点では同一サイト**である。したがってサブドメイン XSS やサブドメイン乗っ取りがあると、`SameSite=Strict` でも守り切れない。

## 4. `Set-Cookie` 属性の完全リファレンス

ここからは各属性を 1 つずつ見る。属性の意味・値・規則は MDN のリファレンスに基づく。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Secure, HttpOnly, SameSite ... Cookies Attributes and Set-Cookie Explained（Medium） — https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限／Medium のメータードペイウォールでログインを要求される場合がある）。以下の属性の記述は MDN `Set-Cookie` と RFC 6265bis という一次資料で完全に補完している。
> **読みどころ**:
> 1. `Set-Cookie` の各属性の書式と最小例。特に `Expires` の日付フォーマットと `Max-Age` の優先順位を、本節の記述と照合する。
> 2. `HttpOnly` が何を防ぎ何を防がないか（`document.cookie` からは隠れるが JS 起点の `fetch`/XHR には送られる）。
> 3. `Secure` の限界（ディスクアクセスや `HttpOnly` 無しの JS 読み取りは防げない／`http:` からは設定不可／localhost 例外）。
> 4. `SameSite` 3 値の例とブラウザ既定値の変遷（Chrome 80 予告 → 84 既定化）。年号・バージョンを本節と突き合わせる。
> 5. 記事末尾にあることが多い Express/Django/PHP 等の `set_cookie` オプション名。フレームワークの既定値が `SameSite` を付けるかは診断上重要。
> **代替手段**: MDN `Set-Cookie`（本節の出典）と RFC 6265bis を読めば内容はほぼ完全にカバーできる。

### 4.1 ヘッダの性質と重要な警告

`Set-Cookie` は**レスポンスヘッダ**であり、複数の Cookie を送るには**同一レスポンス内に複数の `Set-Cookie` ヘッダ**を並べる。ここで診断上きわめて重要な仕様がある（MDN の警告、訳）:

> ブラウザはフロントエンド JavaScript から `Set-Cookie` ヘッダへのアクセスを**ブロックする**。Fetch 仕様の要求で、`Set-Cookie` は **forbidden response header name（禁止レスポンスヘッダ名）** として定義され、フロントエンドに露出するレスポンスからは**フィルタされなければならない**。

さらに Fetch API / XMLHttpRequest が **CORS を使う**場合、**リクエストに credentials が含まれていない限り**、ブラウザはレスポンス中の `Set-Cookie` を**無視する**。

| 項目 | 値 |
| --- | --- |
| Header type | Response header |
| Forbidden request header | No |
| Forbidden response header | **Yes** |

構文（原文のまま）:

```http
Set-Cookie: <cookie-name>=<cookie-value>
Set-Cookie: <cookie-name>=<cookie-value>; Domain=<domain-value>
Set-Cookie: <cookie-name>=<cookie-value>; Expires=<date>
Set-Cookie: <cookie-name>=<cookie-value>; HttpOnly
Set-Cookie: <cookie-name>=<cookie-value>; Max-Age=<number>
Set-Cookie: <cookie-name>=<cookie-value>; Partitioned
Set-Cookie: <cookie-name>=<cookie-value>; Path=<path-value>
Set-Cookie: <cookie-name>=<cookie-value>; Secure

Set-Cookie: <cookie-name>=<cookie-value>; SameSite=Strict
Set-Cookie: <cookie-name>=<cookie-value>; SameSite=Lax
Set-Cookie: <cookie-name>=<cookie-value>; SameSite=None; Secure

// Multiple attributes are also possible, for example:
Set-Cookie: <cookie-name>=<cookie-value>; Domain=<domain-value>; Secure; HttpOnly
```

### 4.2 属性一覧（意味と規則）

| 属性 | 必須/任意 | 意味と規則 |
| --- | --- | --- |
| `<cookie-name>=<cookie-value>` | 必須 | name-value ペアで始まる。名前に使えるのは制御文字・区切り文字を除く US-ASCII。値はダブルクォートで囲んでもよいが、制御文字・空白・`"`・`,`・`;`・`\` は不可。名前によっては**プレフィックス**が特別な制約を課す（§8）。 |
| `Domain=<domain-value>` | 任意 | どのホストに送られるかを定義。**設定するとそのドメインと全サブドメインに送られる**。**省略すると送信したホストにのみ返る（host-only cookie。より制限が強い）**。値は自分のドメインか親ドメインでなければならず、`com` / `co.uk` / `github.io` のような **public suffix は不可**。規則を破る Cookie は無視される。先頭のドット（`.example.com`）は無視される。 |
| `Expires=<date>` | 任意 | 最大寿命を HTTP-date で示す。**未指定なら session cookie**（クライアント終了で削除）。ただし多くのブラウザには**セッション復元**機能があり session cookie も復元されることに注意。時計ずれは `Date` ヘッダから補正される。 |
| `Max-Age=<number>` | 任意 | 失効までの**秒数**。**0 または負なら即時失効**。`Expires` と両方あれば **`Max-Age` が優先**。 |
| `Partitioned` | 任意 | パーティション化ストレージ（CHIPS）に保存。**`Secure` 必須**。 |
| `Path=<path-value>` | 任意 | `Cookie` を送るために URL に必要なパス。省略時は設定リクエストの URL のディレクトリ。`/` はディレクトリ区切りでサブディレクトリもマッチ。**セキュリティ手段として意図されておらず、別パスからの読み取りを防がない**。 |
| `SameSite=<value>` | 任意 | クロスサイトリクエスト（scheme も含めて別 site 由来）で送るかを制御。CSRF を含む一部の攻撃への保護になる。値は `Strict`/`Lax`/`None`。 |
| `Secure` | 任意 | **`https:` のリクエストでのみ**送る（**localhost は例外**）。MITM（manipulator in the middle、通信経路上の攻撃者）耐性が上がる。**ただし全アクセスを防ぐと思い込むな**: ディスクアクセスや `HttpOnly` 無しの JS からは読める。**`http:` からは `Secure` 付き Cookie を設定できない**。 |
| `HttpOnly` | 任意 | **JavaScript から Cookie へのアクセスを禁じる**（`document.cookie` 経由など）。ただし **JS 起点のリクエスト（`fetch()` / `XMLHttpRequest.send()`）では送信される**。XSS での窃取を緩和する。 |

〔補足〕`Domain` の設計意図と落とし穴を押さえておく。`Domain` を**省略した方が安全**（host-only で、サブドメインへ漏れない）。逆に `Domain=example.com` のように広く設定すると、すべてのサブドメインへ送られ、後述の cookie tossing の的になる。RFC の警告として、一部の古い UA は `Domain` 無しを「現在のホスト名の `Domain` があるかのように」扱い、`www.site.example` にも誤って送ることがある。

### 4.3 `Set-Cookie` の例（原文のまま）

Session cookie（`Expires` も `Max-Age` も無ければ session cookie）:

```http
Set-Cookie: sessionId=38afes7a8
```

Permanent cookie:

```http
Set-Cookie: id=a3fWa; Expires=Wed, 21 Oct 2015 07:28:00 GMT
```

```http
Set-Cookie: id=a3fWa; Max-Age=2592000
```

Invalid domains（設定サーバを含まないドメインは UA が拒否すべき）。`original-company.com` が設定した次は拒否される:

```http
Set-Cookie: qwerty=219ffwef9w0f; Domain=some-company.co.uk
```

`example.com` が設定した次のサブドメイン指定も拒否される:

```http
Set-Cookie: sessionId=e8bb43229de9; Domain=foo.example.com
```

### 4.4 ABNF と規範的な注意点（RFC 6265bis）

規格（RFC 6265bis。RFC 6265 の後継ドラフトで、Cookie の現行の正確な挙動を定める文書）の `Set-Cookie` の ABNF（構文定義の記法）は次のとおり:

```abnf
set-cookie        = set-cookie-string
set-cookie-string = BWS cookie-pair *( BWS ";" OWS cookie-av )
cookie-pair       = cookie-name BWS "=" BWS cookie-value
cookie-name       = token
cookie-value      = *cookie-octet / ( DQUOTE *cookie-octet DQUOTE )
cookie-octet      = %x21 / %x23-2B / %x2D-3A / %x3C-5B / %x5D-7E
                      ; US-ASCII characters excluding CTLs,
                      ; whitespace, DQUOTE, comma, semicolon,
                      ; and backslash
token             = <token, defined in [HTTP], Section 5.6.2>

cookie-av         = expires-av / max-age-av / domain-av /
                    path-av / secure-av / httponly-av /
                    samesite-av / extension-av
expires-av        = "Expires" BWS "=" BWS sane-cookie-date
sane-cookie-date  =
    <IMF-fixdate, defined in [HTTP], Section 5.6.7>
max-age-av        = "Max-Age" BWS "=" BWS 1*DIGIT
domain-av         = "Domain" BWS "=" BWS domain-value
domain-value      = <subdomain>
                      ; see details below
path-av           = "Path" BWS "=" BWS path-value
path-value        = *av-octet
secure-av         = "Secure"
httponly-av       = "HttpOnly"
samesite-av       = "SameSite" BWS "=" BWS samesite-value
samesite-value    = "Strict" / "Lax" / "None"
extension-av      = 1*av-octet
av-octet          = %x20-3A / %x3C-7E
                      ; any CHAR except CTLs or ";"
```

規範上の要点（診断で効くもの）:

- サーバは**無名 Cookie（空の cookie-name）を生成してはならない（MUST NOT）**。UA のシリアライズが予測不能になるため。
- **属性名は大文字小文字を区別しない**（`httponly`, `Httponly`, `hTTPoNLY` も受理）。
- **同一レスポンス内に同じ cookie-name の `Set-Cookie` を複数含めてはならない（MUST NOT）**。
- **同一 set-cookie-string 内に同名の属性を 2 つ生成してはならない（MUST NOT）**。
- 年は 4 桁（rfc1123-date）を使うべき（SHOULD）。一部 UA は日付を 32-bit UNIX time_t として扱い **2038 年以降**を誤処理し得る。

### 4.5 UA の受理・保存・取得（ざっくり仕様）

UA が `Set-Cookie` を受け取ると Cookie と属性を保存し、以後の HTTP リクエストで**該当する未失効の Cookie を `Cookie` ヘッダに含める**。同じ **cookie-name・domain・path** の Cookie を新たに受け取ると、既存を追い出して置き換える。サーバは**過去日時の `Expires`** を送れば Cookie を削除できる。**UA は認識できない属性を無視する（Cookie 全体は捨てない）**。

取得（Cookie を送るかどうか）の判定は、RFC 6265bis の「取得アルゴリズム」で規範化されている（原文のまま）:

```
3. Let cookie-list be the set of cookies from the cookie store that meets all
   of the following requirements:

   * Either:
     *   The cookie's host-only-flag is true and retrieval-host-canonical is
         identical to the cookie's domain.
     Or:
     *   The cookie's host-only-flag is false and retrieval-host-canonical
         domain-matches (see {{domain-matching}}) the cookie's domain.
     *  The cookie's domain is not a public suffix, for user agents configured
        to reject "public suffixes".
   * The retrieval's URI's path path-matches the cookie's path.
   * If the cookie's secure-only-flag is true, then the retrieval's URI must
     denote a "secure" connection (as defined by the user agent).
   * If the cookie's http-only-flag is true, then exclude the cookie if the
     retrieval's type is "non-HTTP".
   * If the cookie's same-site-flag is not "None" and the retrieval's same-site
     status is "cross-site", then exclude the cookie unless all of the
     following conditions are met:
     * The retrieval's type is "HTTP".
     * The same-site-flag is "Lax" or "Default".
     * The HTTP request associated with the retrieval uses a "safe" method.
     * The target browsing context of the HTTP request associated with the
       retrieval is the active browsing context or a top-level traversable.
```

〔補足〕この最後の 5 行が `SameSite` の心臓部だ。「same-site-flag が `None` でなく、リクエストが cross-site なら、**HTTP かつ Lax/Default かつ safe メソッドかつトップレベル**という 4 条件が全部揃わない限り Cookie を除外する」と読める。これが次章以降の `Lax` 挙動そのものである。

なお UA は「**localhost を信頼されたホスト**」「**https を secure な scheme**」とみなすのが典型（規格は "secure" の厳密な定義を UA に委ねている）。ソート順は「**path が長い Cookie を先に**、同長なら**作成が早い方を先に**」（SHOULD）。実装上限は「**ドメイン当たり最低 50、全体で最低 3000**」を提供すべき（SHOULD）で、UA はいつでも任意の Cookie を evict（追い出し）してよい。Cookie の寿命は **400 日（34560000 秒）に丸められる**（`Expires`/`Max-Age` がそれを超えれば MUST で削減）。

## 5. `SameSite` 属性で「送る文脈」を宣言する

`SameSite` は、Cookie を送る文脈を制限する属性だ。3 つの値があり、「送るべきでないところに送らせない」ことで CSRF などを緩和する。

### 5.1 `SameSite=Strict`

`Strict` にすると Cookie は**ファーストパーティのコンテキストでのみ**送られる。ユーザー目線では「Cookie のサイトが**アドレスバーに現在表示されているサイトに一致するときだけ**送られる」。

```text
Set-Cookie: promo_shown=1; SameSite=Strict
```

自サイトを閲覧中は期待どおり送られる。しかし**別サイトのリンクや友人のメールのリンクをたどって入ってくる最初のリクエストでは送られない**。適するのは「パスワード変更や商品購入」のように**初回ナビゲーションの後ろにある機能**の Cookie だ。`promo_shown` には強すぎる（リンク流入した読者にも設定を反映したい）。

### 5.2 `SameSite=Lax`

`Lax` は「**トップレベルナビゲーションでの送信を許可する**」もの。トップレベルナビゲーションとは、本質的に**アドレスバーの URL が変わる**遷移のこと。原文の猫記事の例:

```html
<p>Look at this amazing cat!</p>
<img src="https://blog.example/blog/img/amazing-cat.png" />
<p>Read the <a href="https://blog.example/blog/cat.html">article</a>.</p>
```

```text
Set-Cookie: promo_shown=1; SameSite=Lax
```

挙動: 読者が他人のブログにいて、ブラウザが `amazing-cat.png` を要求しても Cookie は**送られない**。しかし読者がリンクをたどって `cat.html` に行くとき、そのリクエストには Cookie が**含まれる**。したがって「**`Lax` はサイトの表示に影響する Cookie に、`Strict` はユーザーのアクションに関わる Cookie に適する**」。

MDN による `Lax` の 2 条件（両方満たすクロスサイトリクエストで送る）:

1. **トップレベルナビゲーションである**こと。除外される例は `fetch()`、`<img>`/`<script>` のサブリソース、`<iframe>` 内ナビゲーション。含まれる例はリンククリック、`document.location` への代入、**`<form>` 送信**。
2. **safe メソッド**であること。**`POST`・`PUT`・`DELETE` は除外**される。safe メソッドとは RFC 9110 の意味での安全なメソッド（`GET`・`HEAD` など、サーバ状態を変えない前提のもの）のこと。

### 5.3 セキュリティ上の注意（`Strict`/`Lax` は完全な解ではない）

原文の caution（訳）: 「`Strict` も `Lax` も**サイトのセキュリティの完全な解ではない**。Cookie はユーザーのリクエストの一部として送られるので、**他のユーザー入力と同じように扱い、サニタイズ・検証する**。**サーバ側の秘密情報を Cookie に保存してはならない。**」

### 5.4 `SameSite=None`

従来は「値を指定しない」ことが「すべての文脈で送ってほしい」を**暗黙に**表明する手段だった。RFC 6265bis はこれを**明示する値 `SameSite=None`** を導入した。`None` を使うと「**意図的にサードパーティ文脈で送りたい**」と明確に伝えられる。ウィジェット、埋め込み、アフィリエイト、広告、複数サイト横断サインインなど、他サイトで消費されるサービスを提供する場合に使う。

| 値 | same-site リクエスト | cross-site サブリソース/iframe | cross-site トップレベル safe（リンク等） | cross-site トップレベル POST |
| --- | --- | --- | --- | --- |
| `Strict` | 送る | 送らない | 送らない | 送らない |
| `Lax` | 送る | 送らない | 送る | 送らない |
| `None`（`Secure` 必須） | 送る | 送る | 送る | 送る |

## 6. 既定値の変遷 ── 「無指定＝Lax」への転換

`SameSite` は広くサポートされたが**開発者にほとんど採用されなかった**。「どこにでも送る」というオープンな既定は全ユースケースを動かす一方、**ユーザーを CSRF と意図しない情報漏洩にさらす**。そこで IETF 提案「Incrementally Better Cookies」が 2 つの変更を示した（原文のまま）:

> - Cookies without a `SameSite` attribute will be treated as `SameSite=Lax`.
> - Cookies with `SameSite=None` must also specify `Secure`, meaning they require a secure context.

ブラウザ対応:

| ブラウザ | 既定 Lax 化 | テスト方法 |
| --- | --- | --- |
| Chrome | **バージョン 84 から実装** | ― |
| Firefox | Firefox 69 からテスト可能、将来既定化予定 | `about:config` で `network.cookie.sameSite.laxByDefault` |
| Edge | 既定変更を予定 | blink-dev アナウンス参照 |

### 6.1 Lax by default（比較）

**Worse — 属性なし**

```text
Set-Cookie: promo_shown=1
```

> `SameSite` 属性なしで送ると…

**Better — 既定が適用される**

```text
Set-Cookie: promo_shown=1; SameSite=Lax
```

> ブラウザは `SameSite=Lax` が指定されたかのように扱う。

原文の推奨: これは**より安全な既定**を狙った変更だが、「ブラウザ任せにせず、**明示的に `SameSite` を設定するのが理想**」。意図が明確になり、ブラウザ間で一貫する。

### 6.2 `SameSite=None` must be Secure（比較）

**Worse — 拒否される**

```text
Set-Cookie: widget_session=abc123; SameSite=None
```

> `Secure` 無しは**拒否される**。

**Better — 受理される**

```text
Set-Cookie: widget_session=abc123; SameSite=None; Secure
```

> `SameSite=None` は必ず `Secure` と対にする。

この規範根拠は RFC 6265bis の保存モデル step 19「same-site-flag が `None` なら、**`secure-only-flag` が true でない限り** Cookie を完全に無視する」にある。テストは Chrome 76 で `about://flags/#cookies-without-same-site-must-be-secure`、Firefox 69 で `network.cookie.sameSite.noneRequiresSecure`。運用上は**新規設定時に適用し、期限が近くない既存 Cookie も積極的にリフレッシュ**する。`SameSite=None` を認識しないクライアントは属性を無視するので後方互換。ただし Chrome・Safari・UC browser の**旧バージョンは `None` と非互換**で無視/制限し得るため、影響ユーザーの割合を把握すべき（非互換クライアント一覧: `https://www.chromium.org/updates/same-site/incompatible-clients`）。

## 7. Lax+POST の「2 分猶予」── 攻撃者が最も突く穴

ここが CSRF ハンティングの要所である。

### 7.1 なぜ穴があるのか（設計意図）

既定を Lax にする最大の障害は互換性だった。RFC 6265bis の説明（訳）: 一部のサイトは、**`SameSite` 未指定の Cookie が unsafe メソッドのトップレベル・クロスサイトリクエストに含まれること**に依存している。たとえば**ログインフローの最終ステップがクロスサイトのトップレベル `POST`** で、そのエンドポイントが**ログイン完了に必要な、最近作られた Cookie を期待する**ことがある。純粋な `Lax` だと POST で Cookie が落ち、**ログインフロー全体が回復不能に失敗**してしまう。

### 7.2 どう動くのか（規範と実装）

そこで「**トップレベルなら、メソッドに関わらず**クロスサイトで送る」という互換モード **"Lax-allowing-unsafe"** が用意された。規格の重要な限定（訳）:

- 「**"Lax-allowing-unsafe" は `SameSite` の独立した値ではない。**」
- UA は**`SameSite` を明示しなかった Cookie（same-site-flag が既定で "Default"）にのみ**適用してよい（MAY）。
- **最近作られた Cookie に限定すべき（SHOULD）**。「**Deployment experience has shown a cookie age of 2 minutes or less to be a reasonable limit.**（デプロイ経験から、2 分以下の Cookie 年齢が妥当な上限）」

取得アルゴリズムでは、safe メソッド要件が次のように置き換わる（原文のまま）:

```
     * At least one of the following is true:

       1.  The HTTP request associated with the retrieval uses a "safe"
           method.

       2.  The cookie's same-site-flag is "Default" and the amount of
           time elapsed since the cookie's creation-time is at most a
           duration of the user agent's choosing.
```

Chromium の実装値はソースで確認できる。`net/cookies/cookie_constants.h`:

```cpp
// The time threshold for considering a cookie "short-lived" for the purposes of
// allowing unsafe methods for unspecified-SameSite cookies defaulted into Lax.
NET_EXPORT extern const base::TimeDelta kLaxAllowUnsafeMaxAge;
// The short version of the above time threshold, to be used for tests.
NET_EXPORT extern const base::TimeDelta kShortLaxAllowUnsafeMaxAge;
```

`net/cookies/cookie_constants.cc`:

```cpp
const base::TimeDelta kLaxAllowUnsafeMaxAge = base::Minutes(2);
const base::TimeDelta kShortLaxAllowUnsafeMaxAge = base::Seconds(10);
```

つまり Chromium の「Lax+POST 例外」の閾値は **2 分**（テスト用短縮版は 10 秒）。MDN の「set no more than two minutes before the request」と一致する。

### 7.3 攻撃者はどこを突くか

`SameSite` を**明示していない**セッション/トランザクション Cookie を使うクロスサイト POST 経路があり、その Cookie が**作成 2 分以内**に狙われるなら、**Lax 既定でも CSRF が成立し得る**。原文の警告どおり「**This is intended as a temporary mitigation**（一時的緩和）」であり、`SameSite=None; Secure` へ直すべき穴だ。

### 7.4 どう守るか

状態変更エンドポイントの Cookie は**`SameSite` を明示**（多くは `Strict`、必要なら §12 の read/write 二重 Cookie）し、加えて **CSRF トークン**（サーバが発行しリクエストごとに検証する予測不能な値）を併用する。既定 Lax に依存しないことが肝心である。

## 8. Cookie プレフィックス（`__Secure-` / `__Host-`）

### 8.1 なぜプレフィックスが要るのか

後述の Weak Integrity のため、**サーバは「ある Cookie が特定の属性で設定された」と確信できない**。そこで**名前の先頭数文字**から属性の要件を推論できるようにしたのがプレフィックスだ。すべてのプレフィックスは**二重アンダースコア `__` で始まりダッシュ `-` で終わる**。

| プレフィックス | 要求される条件 | 得られる保証 |
| --- | --- | --- |
| `__Secure-` | HTTPS ページから **`Secure` 付き**で設定 | 非セキュアオリジンからの設定・上書きを防ぐ |
| `__Host-` | HTTPS から **`Secure` 付き・`Domain` なし・`Path=/`** | 設定したホストにのみ送られ、どのパスからも上書き不可。**オリジンをセキュリティ境界に最も近づけた** Cookie |
| `__Http-` | HTTPS から **`Secure` + `HttpOnly`** | `Set-Cookie` 経由で設定された証明（JS では設定・変更不可） |
| `__Host-Http-` | `Secure` + `HttpOnly` + `__Host-` の全制約 | 上記 2 つを兼ねる |

規格の受理/拒否例（`__Host-`、原文のまま。**常に拒否**される例）:

```
Set-Cookie: __Host-SID=12345
Set-Cookie: __Host-SID=12345; Secure
Set-Cookie: __Host-SID=12345; Domain=site.example
Set-Cookie: __Host-SID=12345; Domain=site.example; Path=/
Set-Cookie: __Host-SID=12345; Secure; Domain=site.example; Path=/
```

secure origin から設定されれば**受理**される例:

```
Set-Cookie: __Host-SID=12345; Secure; Path=/
```

### 8.2 大文字小文字の落とし穴（攻撃者の抜け道）

UA は**プレフィックスを case-insensitive にマッチしなければならない（MUST）**。理由は攻撃だ。もし UA が case-sensitive に判定すると、サーバ側は Cookie 名を case-insensitive に処理しがちなので、**大文字小文字を崩したなりすまし**が通る。既に `__Secure-SID=12345` があるとき攻撃者が次を送らせると:

```
Set-Cookie: __SeCuRe-SID=evil
```

次回、UA は**両方を送る**:

```
Cookie: __Secure-SID=12345; __SeCuRe-SID=evil
```

サーバは両者を区別できず**侵害され得る**。だから UA は MUST で case-insensitive にマッチする。プレフィックス非対応の古いブラウザではこれらの保証が効かず、**プレフィックス付き Cookie も常に受理されてしまう**点にも注意。

## 9. Weak Confidentiality と Weak Integrity ── cookie tossing の根

Cookie は同一オリジンポリシーほど強い分離を持たない。RFC 6265bis の Security Considerations が、その「弱さ」を規範として明記している。

### 9.1 Weak Confidentiality（弱い機密性）

Cookie は**ポート・scheme・path による分離を保証しない**（訳の要点）:

- **ポート分離なし**: あるポートで読める Cookie は**同じサーバの別ポート**からも読め、書ける。相互に信頼しないサービスを同一ホストの別ポートに置いて Cookie に機密を持たせるべきではない（SHOULD NOT）。
- **scheme 分離なし**: `http` と `https` で Cookie が共有され、`ftp` などでも使えることがある。
- **path 分離は常には無い**: ネットワークレベルでは別 path に送らないが、**一部 UA は `document.cookie` で path を越えて露出**する。UA は異なる path のリソースを分離しないため、**ある path のリソースが別 path の Cookie にアクセスできる**ことがある。

### 9.2 Weak Integrity（弱い完全性）＝ cookie tossing

Cookie は**兄弟ドメインやサブドメイン・任意パスに対する完全性を保証しない**。これが俗に **cookie tossing（クッキートッシング。兄弟サブドメインや任意パスから Cookie を"投げ込み"、被害ホストが自分の Cookie と区別できなくする手口）** と呼ばれるものの正体だ（規格の訳）:

- `foo.site.example` は `Domain=site.example` の Cookie を設定でき、`bar.site.example` が設定した既存 Cookie を**上書きし得る**。UA はそれを `bar.site.example` へのリクエストに含め、**最悪 `bar` は自分が設定した Cookie と区別できない**。
- `Path` 属性は**完全性保護を一切提供しない**。UA は任意の `Path` を受理するので、`http://site.example/foo/bar` へのレスポンスが `Path=/qux` の Cookie を設定できる。
- **能動的なネットワーク攻撃者**は `http://site.example/` のレスポンスになりすまして `Set-Cookie` を注入し、**`https://site.example/` に送られる Cookie を注入**できる。HTTPS 排他でも防げないことがある。俗に **cookie fixing（非セキュア Cookie が既存のセキュア Cookie を上塗りする攻撃）** と呼ばれる。
- 暗号化・署名や `__Secure-` 命名で**部分的に**緩和できるが、攻撃者が正規サーバから受け取った Cookie を**リプレイ**できるため完全ではない。
- 攻撃者は**大量の Cookie を保存させて既存 Cookie を evict** させることもできる。サーバは Cookie の保持に依拠すべきではない（SHOULD NOT）。

### 9.3 どう守るか

保存モデルの規定が部分的な緩和を与える:

- **step 16（cookie fixing 緩和）**: `secure-only-flag` が false の非セキュア Cookie が、同名の**セキュア Cookie を上塗りしようとすると無視**される。ただし path 比較は非対称で、既存のセキュア Cookie `a`（`Path=/login`）に対し、非セキュア `a` は `/` や `/foo` には設定できるが `/login`・`/login/en` には設定できない、という限定的なものである。
- **step 23（`HttpOnly` 保護）**: 新規 Cookie が "non-HTTP" API 由来で、既存の同名 Cookie の `http-only-flag` が true なら無視。**`HttpOnly` Cookie を JS から上書きできない**規範根拠。
- **step 20/21（プレフィックス）**: `__Secure-` は `secure-only-flag` が true でなければ、`__Host-` は `secure-only` かつ `host-only` かつ `Path=/` でなければ無視。
- 運用では、機密 Cookie に **`__Host-`**（`Secure; Path=/`、`Domain` なし）、少なくとも `__Secure-` を付け、`Domain` を**必要以上に広げない**。DNS への依存も念頭に置く（DNS が侵害されると Cookie の保証は崩れる）。

## 10. Schemeful Same-Site（scheme を含む site 定義）

**Schemeful Same-Site** は「site」の定義を、登録可能ドメインのみから**scheme + 登録可能ドメイン**へ変える。つまり `http://website.example` と `https://website.example` は**互いにクロスサイト**になった。

### 10.1 なぜ（設計意図）

既定を Lax にした主目的は CSRF 防御だった。しかし**非セキュアな HTTP トラフィックはネットワーク攻撃者が Cookie を改変し、それがセキュアな HTTPS 版で使われる隙**を残す。scheme 間にクロスサイト境界を作ることで、この攻撃への防御を強める。完全 HTTPS 化済みなら心配は要らない。まだなら**それが最優先**。

### 10.2 どう変わるか（送信可否の表）

Navigation（cross-scheme ナビゲーション）:

| | HTTP → HTTPS | HTTPS → HTTP |
| --- | --- | --- |
| `SameSite=Strict` | ⛔ Blocked | ⛔ Blocked |
| `SameSite=Lax` | ✓ Allowed | ✓ Allowed |
| `SameSite=None;Secure` | ✓ Allowed | ⛔ Blocked |

Loading subresources（画像・iframe・XHR/Fetch）:

| | HTTP → HTTPS | HTTPS → HTTP |
| --- | --- | --- |
| `SameSite=Strict` | ⛔ Blocked | ⛔ Blocked |
| `SameSite=Lax` | ⛔ Blocked | ⛔ Blocked |
| `SameSite=None;Secure` | ✓ Allowed | ⛔ Blocked |

POSTing a form:

| | HTTP → HTTPS | HTTPS → HTTP |
| --- | --- | --- |
| `SameSite=Strict` | ⛔ Blocked | ⛔ Blocked |
| `SameSite=Lax` | ⛔ Blocked | ⛔ Blocked |
| `SameSite=None;Secure` | ✓ Allowed | ⛔ Blocked |

いずれも HTTPS → HTTP はすべてブロック（サードパーティ/クロスサイト Cookie は `Secure` 必須のため）。遭遇しやすいのは、**既定で非セキュア版を表示しつつサインイン/チェックアウトのフォーム送信で HTTPS にアップグレードするサイト**。最善は**フォームのページと送信先の両方を HTTPS** にすることだ。

### 10.3 テストと守り

Chrome 86 以降は `about://flags/#schemeful-same-site` を有効化すると DevTools の Issue タブに問題が出る（例:「Migrate entirely to HTTPS to continue having cookies sent on same-site requests」＝将来ブロック、「... to have cookies sent ...」＝ブロック済み）。Firefox 79 以降は `about:config` で `network.cookie.sameSite.schemeful` を `true` にするとコンソールに「will be soon treated as cross-site」「has been treated as cross-site」が出る。FAQ の要点:

- 完全 HTTPS 済みでも Issue が出るなら、一部リンク/サブリソースが非セキュア URL を指している。対策は **HSTS（`Strict-Transport-Security`）+ `includeSubDomain`**。
- HTTPS にできない場合の一時策として `Strict`→`Lax`→`None` へ緩めるが、**送信元が非セキュアだと `SameSite=None` は `Secure` 必須のため失敗**する。いずれも一時的措置で、最終的にサードパーティ Cookie は廃止される。
- **WebSocket**: ページと secureness が同じなら same-site（`https://` からの `wss://`、`http://` からの `ws://`）。異なれば cross-site。

> ### 📌 ここは自分で開いて読んでください
> **資料**: SameSite cookies explained（web.dev。図版とシリーズナビを含む公開ページ） — https://web.dev/articles/samesite-cookies-explained
> **なぜ**: 本教科書の執筆環境からは web.dev への直アクセスがネットワーク制限でブロックされ自動取得できなかった。本文は GitHub の記事原稿から全文取得済みだが、**公開ページ固有の要素**は未取得である。以下の記述は原稿（Markdown）にもとづく要約である。
> **読みどころ**:
> 1. 図版 4 点（`Set-Cookie` の送信図、`Cookie` の返送図、1 ページに複数ドメインから来る Cookie の図、`None`/`Lax`/`Strict` のラベル付き図）。属性の意味を図で押さえると速い。
> 2. シリーズナビのリンク先「Understanding cookies」「SameSite cookie recipes」「Schemeful Same-Site」（本節では §1・§2、§11、§10 に収録済み）。
> 3. 「Changes to the default behavior without SameSite」節の外部リンク（Incrementally Better Cookies ドラフト、blink-dev アナウンス、Chromium の incompatible clients）。バージョン番号と日付が一次情報。
> 4. 記事更新日（2023-03-20）以降の変化。`Partitioned`/CHIPS やサードパーティ Cookie 廃止の進捗は MDN と Privacy Sandbox で補う。
> **代替手段**: 記事原稿は公開リポジトリ GoogleChrome/web.dev で読める。属性の規範は MDN `Set-Cookie` と RFC 6265bis で裏が取れる。

## 11. クロスサイト Cookie が要るケースと実装レシピ

`Lax`/`Strict` では届かないが正当に Cookie が要る場面を、web.dev の「SameSite cookie recipes」から整理する。

### 11.1 どんなときにクロスサイト Cookie が要るか

- **`<iframe>` 内のコンテンツ**: 共有された埋め込み（動画・地図・コードサンプル・ソーシャル投稿）、外部サービスのウィジェット（決済・カレンダー・予約）、目立たない iframe を作るソーシャルボタンや不正防止サービス。トップレベルでも見られるサイトが iframe に埋め込まれると、その Cookie は**サードパーティ Cookie 扱い**になる。
- **サイト間の "unsafe" リクエスト**: 主に **POST**。`Lax` は safe なトップレベルナビゲーションでは送るが、**別サイトへの `<form>` POST では Cookie を含めない**。IdP（Identity Provider、認証を担う外部サービス）へリダイレクトして戻る形では、離脱前に**使い捨てトークンを含む Cookie** を設定し戻りで検証して CSRF を緩和する。戻りが POST なら `SameSite=None; Secure` が要る。
- **リモートリソース**: `<img>`/`<script>` やトラッキングピクセル。**`fetch()` が `credentials: 'include'`、`XMLHttpRequest` の `withCredentials` が `true`** なら「その Cookie が期待されている良い指標」。
- **WebView 内**: Android の WebView が Chrome 駆動でも Chrome 84 の新既定は即時適用されない。`CookieManager` API で直接設定する Cookie もクロスサイト用途なら `SameSite=None; Secure` を検討。

### 11.2 今日どう実装するか

ファーストパーティのみで要る Cookie:

```text
Set-Cookie: first_party_var=value; SameSite=Lax
```

サードパーティ文脈で要る Cookie（`None` だけで `Secure` 無しは**拒否**）:

```text
Set-Cookie: third_party_var=value; SameSite=None; Secure
```

### 11.3 非互換クライアントの扱い

原則は「**非互換クライアントを特殊ケースとして扱え。新しい規則を実装したブラウザのために例外を作るな。**」方法 1 は**新旧両方の Cookie を設定**する:

```text
Set-cookie: 3pcookie=value; SameSite=None; Secure
Set-cookie: 3pcookie-legacy=value; Secure
```

Node.js（Express + cookie-parser）の実装例（原文のまま）:

```javascript
const express = require('express');
const cp = require('cookie-parser');
const app = express();
app.use(cp());

app.get('/set', (req, res) => {
  // Set the new style cookie
  res.cookie('3pcookie', 'value', { sameSite: 'none', secure: true });
  // And set the same value in the legacy cookie
  res.cookie('3pcookie-legacy', 'value', { secure: true });
  res.end();
});

app.get('/', (req, res) => {
  let cookieVal = null;

  if (req.cookies['3pcookie']) {
    // check the new style cookie first
    cookieVal = req.cookies['3pcookie'];
  } else if (req.cookies['3pcookie-legacy']) {
    // otherwise fall back to the legacy cookie
    cookieVal = req.cookies['3pcookie-legacy'];
  }

  res.end();
});

app.listen(process.env.PORT);
```

方法 2 は `Set-Cookie` 送出時に **User-Agent で判定**（Node.js なら `ua-parser-js`）。ただし原文の警告どおり「**UA スニッフィングは本質的に壊れやすく、影響ユーザー全員を捕捉できない**」。どちらでもレガシー経路のトラフィック量をログし、閾値を下回ったら削除するアラートを設ける。言語別の実装は `https://github.com/GoogleChromeLabs/samesite-examples` に文書化されている。

## 12. `SameSite` と CSRF ── 多層防御としての正しい位置づけ

### 12.1 Defense in depth（多層防御）

規格の Security Considerations（訳）: 「`SameSite` Cookie は strict モードでクライアントが対応していれば CSRF への**堅牢な防御**を提供する。しかし**これをサイトの CSRF 防御の限界としないのが賢明**。same-site のナビゲーションや送信は、**XSS やページリダイレクトの悪用**と組み合わせて実行され得るからだ。」

理解の要点: **クロスサイトのトップレベルリクエストはクロスサイト**扱いで `Strict` Cookie は送られないが、**そのページのサブリソースリクエストは same-site** であり `Strict` Cookie を受け取る。だから「**初回ページリクエストが適切な Cookie を含まなければエラーを返す**」ことで、サブリソースへの不注意なアクセスを避けられる。開発者は **CSRF トークン**や **safe メソッドの冪等性保証**などサーバ側防御を併用することが強く推奨される。

RFC は Lax の限界も明言する。Lax は unsafe メソッド依存の CSRF には合理的な多層防御だが、CSRF 全般への堅牢な防御ではない ──「攻撃者は依然として**新しいウィンドウをポップアップしたりトップレベルナビゲーションを起こして same-site リクエストを作れる**。これは**speedbump（減速帯）に過ぎない**」「**`<link rel='prerender'>`** のような機能は**ユーザーに気づかれずに** same-site リクエストを作るのに悪用され得る」。

### 12.2 read/write 二重 Cookie(トップレベルナビゲーション問題)

`Strict` は堅いが、セッション管理を誤ると**ユーザーが混乱**する。例: webmail `https://site.example/` のメール内リンク `https://projects.example/secret/project` をクリックすると、`projects.example` のセッション Cookie が `Strict` なら**このクロスサイト遷移で送られず**、`projects.example` は漏洩回避のため **404 を描画**してしまう。

回避策（訳）は**2 つの Cookie に分ける**こと。概念的に「read アクセス」の Cookie と「write アクセス」の Cookie を持ち、後者を **`SameSite=Strict`** にして、無ければ非冪等アクション前に**再認証**を促す。前者は **`SameSite=Lax`**（トップレベル遷移での閲覧を許す）か **`SameSite=None`**（すべての文脈でのアクセスを許す）にする。

### 12.3 その他の規範的注意

- **Mashups / Widgets**: 埋め込み前提のウィジェットや一部の SSO（Single Sign-On、一度の認証で複数サービスを使う仕組み）は same-site Cookie では機能せず **`SameSite=None` が必要**。
- **Reload navigations**: **UI 要素（更新ボタン）によるリロード**は、元が same-site リクエストでナビゲートされた場合にのみ same-site。これは、クロスサイトで withheld された `SameSite` Cookie を**ユーザー起点のリロードで送ってしまい防御を無効化する**のを避けるためだ。一方**ユーザー起点でないリロードは全 SameSite Cookie を添付**するので、開発者は**初回リクエストに CSRF トークンがあるときだけリロードを開始**するなど慎重であるべき。
- **Server-controlled**: `SameSite` は**サーバが設定**し、ユーザーは関与しない。Cookie 無しでもリクエストを紐付ける side-channel（コネクション/ソケットプーリング等）は複数存在する。
- **Public Suffix List**: Cookie 境界は registrable domain に依存し、UA は**最新の Public Suffix List を使うべき（SHOULD）**。さもないと**機密 Cookie が registrable domain 間で漏洩し得る**。

## 13. 診断・脆弱性ハンティングの観点

〔補足〕以下は上記一次資料の規範から導いた検査項目の整理であり、資料に「チェックリスト」として書かれているものではない（根拠節を併記する）。すべて**許可された診断・バグバウンティ・自分で立てた検証環境**を前提とする。

| 確認項目 | 期待される安全な状態 | 根拠 |
| --- | --- | --- |
| セッション Cookie の `SameSite` | 明示的に `Strict`（トップレベル遷移が要るなら read/write 二重 Cookie） | §5・§12 |
| `SameSite` 未指定の Cookie | 存在しない（既定 Lax 依存はブラウザ差と Lax-allowing-unsafe の穴を残す） | §6・§7 |
| 状態変更エンドポイントの CSRF 対策 | `SameSite` に加えて CSRF トークン等のサーバ側防御 | §12.1 |
| **作成 2 分以内**の `SameSite` 未指定 Cookie を使うクロスサイト POST 経路 | 存在しない（Lax+POST 例外で CSRF が成立し得る） | §7 |
| `SameSite=None` の Cookie | 必ず `Secure` 付き。かつ本当にサードパーティ用途か | §6.2 |
| セッション Cookie の `HttpOnly` | 付与（XSS 窃取を緩和。ただし JS 起点リクエストには送られる） | §4.2 |
| `Secure` | HTTPS サイトの全機密 Cookie に付与（`http:` からの上書きを防ぐ） | §4.2・§9.2 |
| `Domain` の広さ | 必要以上に広い `Domain=example.com` にしない（サブドメインからの読み取り・上書きを招く） | §4.2・§9.2 |
| プレフィックス | ホスト固定が要る Cookie は `__Host-`、少なくとも `__Secure-` | §8・§9.3 |
| `Path` による分離に依拠していないか | 依拠しない（`Path` は完全性もアクセス制御も提供しない） | §4.2・§9.1 |
| サブドメイン/兄弟ホストの信頼境界 | 相互に信頼しないサービスを同一 site の別サブドメイン/別ポート/別パスに置いて Cookie に機密を持たせない（cookie tossing） | §9 |
| cross-scheme（http/https 混在）経路 | 完全 HTTPS 化 + HSTS `includeSubDomain` | §10 |
| リロードで Cookie が復活する設計 | ユーザー起点でないリロードは全 SameSite Cookie を添付するため、CSRF トークン確認後にのみリロードを開始 | §12.3 |
| Cookie に機密（サーバ側の秘密）を保存していないか | 保存しない。Cookie はユーザー入力として検証・サニタイズ | §5.3 |
| Cookie 数・サイズ | 少なく小さく（evict による消失、ヘッダ上限、TTFB 悪化） | §1.3・§4.5 |
| 寿命 | 400 日上限に丸められる前提で設計 | §4.5 |

## 手を動かす

1. **Cookie を自分で観察する**。任意の自分のサイト、または自分で立てた検証サーバをブラウザで開き、DevTools を起動する（多くのブラウザで F12）。Application（または Storage）タブ → Cookies を開き、各 Cookie の `SameSite`・`Secure`・`HttpOnly`・`Domain`・`Path` 列を見る。
2. **`document.cookie` で可視 Cookie を確認する**。Console タブで次を実行する。

   ```javascript
   document.cookie
   ```

   出てくる Cookie と、DevTools の Cookies 一覧を見比べる。**一覧にあるのに `document.cookie` に出ない Cookie が `HttpOnly` 付き**である。
3. **属性の効きを検証環境で試す**。自分で立てたローカルサーバ（例: 前掲の Express コード）で、次のような `Set-Cookie` を返し、DevTools の Network タブでレスポンスヘッダを確認する。

   ```text
   Set-Cookie: test_strict=1; SameSite=Strict; Secure; Path=/
   Set-Cookie: test_lax=1; SameSite=Lax; Secure; Path=/
   Set-Cookie: test_none=1; SameSite=None; Secure; Path=/
   ```
4. **クロスサイト送信を観察する**。別オリジンに置いた自分のページからリンク（トップレベルナビゲーション）とフォーム POST を張り、検証サーバへ飛ばして、`Cookie` リクエストヘッダに `test_strict` / `test_lax` / `test_none` のどれが含まれるかを Network タブで確認する。§5.4 の表と一致するはずだ。
5. **プレフィックスの拒否を確認する**。`http://localhost` ではなく `http://` の非セキュアなオリジン（検証用）から次を返し、ブラウザが Cookie を保存しないことを Application タブで確かめる。

   ```text
   Set-Cookie: __Host-test=1; Secure
   ```

   `Path=/` が無いので `__Host-` は拒否される（§8.1）。
6. **Schemeful のテスト**。Chrome なら `about://flags/#schemeful-same-site` を有効化し、`http://` と `https://` 版の自分の検証サイト間を遷移して、DevTools の Issues タブに警告が出るかを見る。

## つまずきポイント

- **「ファーストパーティ/サードパーティは Cookie の種類」ではない**。同じ Cookie が、ユーザーが今どのサイトにいるかで両方になり得る相対的なラベルである。
- **`Path` はセキュリティ境界ではない**。「`/admin` に置いたから他パスの JS からは読めない」は誤り。`document.cookie` は path を越えて Cookie を露出し得る（§9.1）。
- **`HttpOnly` は「JS からは隠す」だけ**。JS 起点の `fetch()`/XHR には**送信される**ので、XSS があれば Cookie 値を直接読めなくても認証済みリクエストは飛ばせる。
- **`Domain` は省略した方が安全**。`Domain` を付けると全サブドメインに広がる。付けない host-only が既定でより狭い。
- **「既定が Lax だから CSRF は安全」は危険**。`SameSite` 未指定 Cookie は Chromium で**作成 2 分以内ならクロスサイト POST でも送られる**（Lax-allowing-unsafe）。明示 `Lax`/`Strict` とは挙動が違う。
- **`SameSite=None` は必ず `Secure` とセット**。`Secure` 無しの `None` は拒否される。
- **`Strict` の Cookie でもサブリソースは same-site 扱い**。トップレベルで弾かれても、そのページ内のサブリソースには送られる（§12.1）。
- **プレフィックスは大文字小文字を崩したなりすましに注意**。UA は case-insensitive にマッチする義務がある(§8.2)が、サーバ実装が緩いと事故になる。
- **サブドメイン XSS/乗っ取りは SameSite を無力化する**。同一 site 内サブドメインは same-site なので、`Strict` でも兄弟サブドメインから攻撃が届く（§3・§9.2）。

## この節のまとめ

- Cookie は `key=value` と属性で構成され、サーバは `Set-Cookie`、ブラウザは `Cookie` ヘッダで往復する。JS は `document.cookie` で読み書きできるが `HttpOnly` は見えない。
- ファーストパーティ/サードパーティは Cookie 固有の属性ではなく、ユーザーの現在地に対する**相対的なラベル**である。
- 「site」は**登録可能ドメイン（eTLD+1）**で決まり、Public Suffix List が境界を定める。同一 site 内サブドメインは same-site。
- `Domain` は省略が最も狭い（host-only）。付けると全サブドメインへ広がる。public suffix は不可。
- `Secure` は HTTPS 限定送信（localhost 例外）、`HttpOnly` は JS からのアクセス禁止（ただし JS 起点リクエストには送られる）、`Path` は**セキュリティ境界ではない**。
- `SameSite=Strict` は同一 site のみ、`Lax` は同一 site + safe なトップレベルナビゲーション、`None`（`Secure` 必須）はすべて。`Max-Age` と `Expires` があれば `Max-Age` 優先。
- ブラウザは無指定を Lax 相当に既定化した（Chrome 84）。ただし明示 `Lax` より緩い **Lax-allowing-unsafe** があり、Chromium では**作成 2 分以内**（`kLaxAllowUnsafeMaxAge = base::Minutes(2)`）の無指定 Cookie がクロスサイト POST でも送られる。
- `SameSite` は CSRF への**多層防御**であって完全な対策ではない。CSRF トークン等サーバ側防御を併用し、状態変更 Cookie は `SameSite` を明示する。
- `Strict` のトップレベル遷移問題は、read 用（`Lax`/`None`）と write 用（`Strict`）の**2 つの Cookie**で回避する。
- Cookie は port/scheme/path で分離されず（**Weak Confidentiality**）、兄弟ドメイン・任意パスからの上書きを防げない（**Weak Integrity** ＝ cookie tossing）。cookie fixing は非セキュア Cookie がセキュア Cookie を上塗りする攻撃。
- `__Secure-`（`Secure` 必須）と `__Host-`（`Secure`・`Path=/`・`Domain` なし）は、これらの弱さを部分的に緩和し、`__Host-` はオリジンをセキュリティ境界に最も近づける。
- Schemeful Same-Site により `http://` と `https://` は互いにクロスサイト。HTTPS → HTTP はすべての Cookie がブロックされる。守りは完全 HTTPS 化 + HSTS。
- 診断では、`SameSite` 未指定・広すぎる `Domain`・`Secure`/`HttpOnly` の欠落・作成 2 分以内 Cookie を使うクロスサイト POST・兄弟サブドメインの信頼境界を重点的に見る。

## 理解度チェック

1. 同じ `promo_shown` Cookie が「ファーストパーティ」にも「サードパーティ」にもなり得るのはなぜか。
   ▶ 答え: ファーストパーティ/サードパーティは Cookie 固有の属性ではなく、ユーザーが今いるサイト（アドレスバーのサイト）に対する相対的なラベルだから。自分のブログを見ているときはファーストパーティ、他人のサイトに埋め込まれた自分の画像経由で送られるときはサードパーティになる。

2. `your-project.github.io` と `my-project.github.io` はなぜクロスサイトなのか。
   ▶ 答え: Public Suffix List が `github.io` を public suffix（サービス提供のためのサフィックス）として含むため。site は「サフィックス + 直前のドメイン部分」で決まり、両者は別々の登録可能ドメインとして別サイトに数えられる。

3. `SameSite=Lax` の Cookie が「別サイトからのリンククリック」では送られるのに「別サイトからのフォーム POST」では送られないのはなぜか。
   ▶ 答え: `Lax` はトップレベルナビゲーションかつ safe メソッドの両条件を満たすクロスサイトリクエストにのみ送る。リンククリックは safe（GET）なので送られるが、POST は unsafe なので除外される。

4. Chromium の `kLaxAllowUnsafeMaxAge` は何秒で、何を意味するか。
   ▶ 答え: `base::Minutes(2)` = 2 分。`SameSite` を明示していない（Default）Cookie は、作成から 2 分以内ならクロスサイトのトップレベル POST でも送られる（Lax-allowing-unsafe）。互換のための一時的緩和で、CSRF の穴になり得る。

5. `SameSite=None` を使うときに必ず付けなければならない属性は何か。付け忘れるとどうなるか。
   ▶ 答え: `Secure`。付け忘れると Cookie は拒否される（保存モデル step 19「same-site-flag が None なら secure-only-flag が true でない限り無視」）。

6. `__Host-` プレフィックスが要求する 3 条件と、それが与える保証を述べよ。
   ▶ 答え: 条件は「`Secure` 付き・`Domain` 属性なし・`Path=/`」。保証は、Cookie が設定したホストにのみ固定され（`Domain` なしで host-only）、どのパスからも上書きされない（`Path=/`）こと。オリジンをセキュリティ境界として扱うことに Cookie として最も近づく（ポートだけは無視される）。

7. cookie tossing（Weak Integrity）とはどんな攻撃で、`Path` 属性で防げるか。
   ▶ 答え: 兄弟サブドメイン（例 `foo.site.example`）が `Domain=site.example` の Cookie を設定して `bar.site.example` の Cookie を上書きし、被害ホストが自分の Cookie と区別できなくする攻撃。`Path` は完全性保護を一切提供せず（UA は任意の `Path` を受理する）防げない。緩和は暗号化・署名や `__Secure-`/`__Host-`、Domain を広げないこと。

8. `HttpOnly` Cookie は XSS に対して「完全な」防御になるか。
   ▶ 答え: ならない。`document.cookie` からは隠れて値を直接盗まれにくくなるが、JS 起点の `fetch()`/`XMLHttpRequest` では Cookie が送信されるため、XSS があれば認証済みリクエストを攻撃者の JS から発行できる。

9. Schemeful Same-Site 下で、`https://site.example` から `http://site.example` へフォーム POST するとき、どの `SameSite` 値の Cookie も送られない理由は。
   ▶ 答え: HTTPS → HTTP はサードパーティ/クロスサイト送信であり、そこで送り得る `SameSite=None` は `Secure` を必須とするため非セキュア接続では送れない。`Strict`/`Lax` はクロスサイト POST では元々送られない。結果としてすべてブロックされる。

10. `SameSite=Strict` のセッション Cookie で、外部リンクから入ってきたユーザーがログイン済みなのに 404 になる問題を、どう設計で回避するか。
    ▶ 答え: セッションを read 用と write 用の 2 つの Cookie に分け、write 用を `SameSite=Strict`（無ければ非冪等アクション前に再認証）、read 用を `SameSite=Lax`（または `None`）にする。これでトップレベル遷移での閲覧を許しつつ、状態変更は Strict で守る。

## 出典

- https://web.dev/articles/samesite-cookies-explained
- https://web.dev/articles/understanding-cookies
- https://web.dev/articles/samesite-cookie-recipes
- https://web.dev/articles/schemeful-samesite
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
- https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/
- https://github.com/httpwg/http-extensions
- https://github.com/chromium/chromium （`net/cookies/cookie_constants.h` と `.cc`）
- https://publicsuffix.org/
- https://github.com/GoogleChromeLabs/samesite-examples
- https://www.chromium.org/updates/same-site
- https://www.chromium.org/updates/same-site/incompatible-clients
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6 （取得できず一次資料で補完）

<!-- self-read: https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6 | サイト側の制限・ペイウォールで自動取得できず。属性の記述は MDN と RFC 6265bis で補完 -->
<!-- self-read: https://web.dev/articles/samesite-cookies-explained | web.dev への直アクセスがネットワーク制限でブロック。本文は記事原稿から取得済みだが図版・シリーズナビ等の公開ページ固有要素は未取得 -->

<!-- sources: https://web.dev/articles/samesite-cookies-explained, https://web.dev/articles/understanding-cookies, https://web.dev/articles/samesite-cookie-recipes, https://web.dev/articles/schemeful-samesite, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie, https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/, https://github.com/httpwg/http-extensions, https://github.com/chromium/chromium, https://publicsuffix.org/, https://github.com/GoogleChromeLabs/samesite-examples, https://www.chromium.org/updates/same-site, https://www.chromium.org/updates/same-site/incompatible-clients, https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html, https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6 -->
<!-- terms: Cookie, Set-Cookie, Cookie ヘッダ, document.cookie, ファーストパーティ Cookie, サードパーティ Cookie, site, same-site, cross-site, Public Suffix List, 登録可能ドメイン, Domain 属性, Path 属性, Expires, Max-Age, Secure, HttpOnly, Partitioned, CHIPS, SameSite, SameSite=Strict, SameSite=Lax, SameSite=None, Default (same-site-flag), Lax-allowing-unsafe, Lax+POST, kLaxAllowUnsafeMaxAge, safe メソッド, unsafe メソッド, トップレベルナビゲーション, __Secure- プレフィックス, __Host- プレフィックス, __Http- プレフィックス, __Host-Http- プレフィックス, Cookie プレフィックス, Weak Confidentiality, Weak Integrity, cookie tossing, cookie fixing, CSRF, CSRF トークン, XSS, Schemeful Same-Site, HSTS, MITM, host-only cookie, session cookie, TTFB, IdP, SSO, forbidden response header name -->
