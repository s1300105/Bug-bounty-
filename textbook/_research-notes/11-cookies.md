# [11] Cookie の属性と SameSite — first-party/third-party、Strict/Lax/None、Lax+POST 2分猶予、__Secure-/__Host- プレフィックス、cookie tossing、CSRF との関係

担当ID: 11 (cookies) / 想定章: ch02

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://web.dev/articles/samesite-cookies-explained | full（本文は原稿全文を逐語取得） | `curl` → `https://raw.githubusercontent.com/GoogleChrome/web.dev/main/src/site/content/en/blog/samesite-cookies-explained/index.md`（HTTP 200 / 11,083 bytes）および同 repo の日本語版 `.../ja/blog/samesite-cookies-explained/index.md`（HTTP 200 / 25,246 bytes） | **web.dev への直アクセスは不可**。WebFetch は `EGRESS_BLOCKED (Access to web.dev is blocked by the network egress proxy)`、`curl` は `CONNECT tunnel failed, response 403`。そこで記事の**原典リポジトリ（GoogleChrome/web.dev）の記事原稿 Markdown** を取得。英語版は 2023-03-20 更新版（Cookie 基礎編が別記事に分離された現行版）、日本語版は 2020-05-28 版（Cookie 基礎・first/third-party の節を含む旧構成）で、**両方を併せることで公開記事の全文に相当**する。図版（PNG）と Eleventy ショートコード（`{% Aside %}` 等）のレンダリング結果のみ未確認。 |
| https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6 | failed | WebFetch → `EGRESS_BLOCKED (medium.com)` / `curl` → `CONNECT tunnel failed, response 403` / `web.archive.org` も `connect_rejected (403)` / WebSearch は本セッションの検索予算（200/200）を消費済みで実行不可 | medium.com はプロキシポリシーで全面ブロック。代替として同一トピック（`Set-Cookie` の各属性・`Secure`・`HttpOnly`・`SameSite`・cookie プレフィックス）を扱う**一次資料**で完全に補完した: (a) MDN `Set-Cookie` リファレンス原稿 `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/http/reference/headers/set-cookie/index.md`（HTTP 200 / 16,268 bytes、full）、(b) RFC 6265bis ドラフト原稿 `https://raw.githubusercontent.com/httpwg/http-extensions/main/draft-ietf-httpbis-rfc6265bis.md`（HTTP 200 / 113,482 bytes、full）、(c) Chromium 実装 `net/cookies/cookie_constants.{h,cc}`（full）。**「原典が読めなかったため二次情報/一次規格で補完」した節は各節の見出しに出典 URL を明記**している。 |

### 補完に使った追加資料（すべて full 取得）

| 追加 URL | 状態 | 用途 |
| --- | --- | --- |
| https://raw.githubusercontent.com/GoogleChrome/web.dev/main/src/site/content/en/blog/understanding-cookies/index.md | full (8,546 bytes) | web.dev「Understanding cookies」= 現行版で分離された Cookie 基礎・first/third-party 節 |
| https://raw.githubusercontent.com/GoogleChrome/web.dev/main/src/site/content/en/blog/samesite-cookie-recipes/index.md | full (12,993 bytes) | web.dev「SameSite cookie recipes」= 実装レシピ・非互換クライアント対策 |
| https://raw.githubusercontent.com/GoogleChrome/web.dev/main/src/site/content/en/blog/schemeful-samesite/index.md | full (13,955 bytes) | web.dev「Schemeful Same-Site」= scheme を含む site 定義、cross-scheme の許可/ブロック表 |
| https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/http/reference/headers/set-cookie/index.md | full (16,268 bytes) | 属性リファレンス（Domain/Path/Expires/Max-Age/Secure/HttpOnly/Partitioned/SameSite）、`__Secure-`/`__Host-`/`__Http-`/`__Host-Http-` プレフィックス |
| https://raw.githubusercontent.com/httpwg/http-extensions/main/draft-ietf-httpbis-rfc6265bis.md | full (113,482 bytes) | 規範仕様: ABNF、保存モデル、取得アルゴリズム、Lax-Allowing-Unsafe、Weak Confidentiality / Weak Integrity（= cookie tossing）、cookie-fixing 緩和 |
| https://raw.githubusercontent.com/chromium/chromium/main/net/cookies/cookie_constants.cc / .h | full | `kLaxAllowUnsafeMaxAge`（Lax+POST の 2 分猶予）の実装値 |

## 要約（3〜10行）

- Cookie は `key=value` ペアと、「いつ・どこで送るか」を制御する属性群（`Expires` / `Max-Age` / `Domain` / `Path` / `Secure` / `HttpOnly` / `SameSite` / `Partitioned`）で構成され、サーバは `Set-Cookie` レスポンスヘッダで設定し、ブラウザは `Cookie` リクエストヘッダで送り返す。JS からは `document.cookie` で読み書きできる（`HttpOnly` を除く）。
- 「ファーストパーティ/サードパーティ」は Cookie 固有の属性ではなく**ユーザーのコンテキストに対する相対的なラベル**。アドレスバーのサイトと一致すればファーストパーティ、それ以外はサードパーティ。同じ Cookie がどちらにもなり得る。
- `SameSite` は送信対象を制限する属性。`Strict`=同一サイトのみ、`Lax`=同一サイト＋**安全なメソッドのトップレベルナビゲーション**、`None`=すべて（ただし `Secure` 必須）。未指定は「Default」で、Chrome は 84 以降 `Lax` 相当を既定に。
- 既定 Lax には互換性のための例外「**Lax-allowing-unsafe**」がある: `SameSite` 未指定かつ**作成から 2 分以内**の Cookie はクロスサイトのトップレベル POST でも送られる（Chromium 実装値 `kLaxAllowUnsafeMaxAge = base::Minutes(2)`）。これは一時的緩和で、CSRF 防御の穴になり得る。
- `SameSite` は CSRF に対する多層防御（defense in depth）であって完全な対策ではない。Cookie はユーザー入力として扱い、サニタイズ・検証し、CSRF トークン等のサーバ側防御を併用する。
- Cookie は port・scheme・path による分離を保証せず（Weak Confidentiality）、兄弟サブドメインからの上書きを防げない（Weak Integrity）。これが **cookie tossing / cookie fixing** の根であり、`__Secure-` / `__Host-` プレフィックスと `Secure` 上書き禁止ルールが部分的な緩和策になる。
- Schemeful Same-Site により `http://` と `https://` の同一登録可能ドメインは**互いにクロスサイト**として扱われ、cross-scheme のナビゲーション/サブリソース/POST で送信可否が変わる。

---

## 詳細ノート

### 1. Cookie の基本動作と `Set-Cookie` / `Cookie` ヘッダ（出典: https://web.dev/articles/samesite-cookies-explained の日本語版原稿 / https://web.dev/articles/understanding-cookies）

- Cookie は Web サイトに**永続的な状態**を付与する手段の 1 つ。長年の機能拡張の結果、プラットフォームに問題のある旧来の挙動（legacy issues）が残った。これに対処するため、ブラウザ（Chrome、Firefox、Edge を含む）は**プライバシーをより良く保護する既定値**へ動作を変更している。
- それぞれの Cookie は `key=value` のペアと、「その Cookie がいつ、どこで使用されるのかを制御するためのいくつかの属性」で構成される。属性で有効期限を設定したり、HTTPS を介してのみ送るよう設定したりできる。Cookie は **HTTP ヘッダ経由**でも **JavaScript インターフェース経由**でも設定できる。
- 具体例（ブログで「新着情報」プロモを一度閉じたらしばらく表示しない、を 1 か月＝**2,600,000 秒**で期限切れ、HTTPS のみで送る）:

#### コード/コマンド（原文のまま逐語）

```text
Set-Cookie: promo_shown=1; Max-Age=2600000; Secure
```

- 条件（安全な接続であり、Cookie が 1 か月以内に作られたもの）を満たすページを閲覧すると、ブラウザはリクエストで次のヘッダを送る:

```text
Cookie: promo_shown=1
```

- JS からは `document.cookie` でそのサイトで利用可能な Cookie を追加・読み取りできる。`document.cookie` への**代入は、そのキーの Cookie の作成または上書き**になる。ブラウザの JavaScript コンソールでの実行例:

```text
→ document.cookie = "promo_shown=1; Max-Age=2600000; Secure"
← "promo_shown=1; Max-Age=2600000; Secure"
```

- `document.cookie` の**読み取り**は、現在のコンテキストでアクセス可能なすべての Cookie を**セミコロン区切り**で出力する:

```text
→ document.cookie;
← "promo_shown=1; color_theme=peachpuff; sidebar_loc=left"
```

- 人気サイトを見ると 3 個どころではない Cookie が設定されている。ほとんどの場合それらは**そのドメインへのすべてのリクエスト一つ一つ**で送信される。ユーザーのアップロード帯域はダウンロードより制限されていることが多いため、この送信オーバーヘッドは **Time to First Byte (TTFB)** に悪影響を与える。設定する Cookie の**数とサイズは控えめに**し、`Max-Age` を使って必要以上に長く残らないようにする。

〔補足（一般知識）〕診断の観点では、`document.cookie` が「現在のコンテキストで可視な Cookie の集合」を返す点が重要である。`HttpOnly` 付きの Cookie はここに現れない（後述の MDN 節参照）ので、XSS で盗める Cookie と盗めない Cookie の切り分けに使える。

### 2. ファーストパーティ Cookie とサードパーティ Cookie（出典: https://web.dev/articles/samesite-cookies-explained 日本語版原稿 / https://web.dev/articles/understanding-cookies）

- 現在訪問中のサイト（**ブラウザのアドレスバーに表示されているサイト**）のドメインに一致する Cookie を **first-party（ファーストパーティ）Cookie**、それ以外のドメインからの Cookie を **third-party（サードパーティ）Cookie** と呼ぶ。
- 原文の強調点: 「これは**絶対的な分類ではなく、ユーザーのコンテキストに応じた相対的なもの**。同じ Cookie でも、ユーザーがその時点でどのサイトにいるかによってファーストパーティ Cookie であったり、サードパーティ Cookie であったりする。」
- 例: 自分のブログ記事の猫画像が `/blog/img/amazing-cat.png` にあり、それを他人が自分のサイトで直接使っている。訪問者が過去にあなたのブログを訪れて `promo_shown` Cookie を持っていれば、**他人のサイト上でその画像を表示する際のリクエストに Cookie が送信される**。`promo_shown` は他人のサイトでは何の役にも立たず、単にリクエストのオーバーヘッドを増やすだけ。
- なぜこの挙動があるのか: この仕組みによって**サイトがサードパーティのコンテキストで使われても状態を維持できる**。例として YouTube 動画の埋め込み。訪問者が既に YouTube にサインインしていれば、そのセッションがサードパーティ Cookie によって埋め込みプレーヤー内で利用でき、「後で見る (Watch later)」ボタンがサインインを促さずに、ページから離脱させずに機能する。
- セキュリティ/プライバシー上の帰結（原文の CSRF 説明、逐語に近い訳）:
  - 「**クロスサイト リクエスト フォージェリ (CSRF) 攻撃は、誰がリクエストを開始したかに関わらず特定のオリジンに対するリクエストに Cookie が添付されてしまうという動作を悪用している**。たとえば、あなたが `evil.example` にアクセスすると、`your-blog.example` へのリクエストが誘発され、あなたのブラウザが関連する Cookie を喜んで添付してしまう可能性がある。あなたのブログがこういったリクエストの検証に注意を払っていなかった場合には、`evil.example` が**記事の削除や独自コンテンツの追加**などのアクションを起こしてしまう可能性がある。」
- これまで Cookie に**意図を明示する手段がなかった**点が問題。`promo_shown` はファーストパーティのコンテキストでのみ送られるべきだが、他サイトに埋め込まれる想定のウィジェット用セッション Cookie は、サードパーティのコンテキストでサインイン状態を提供するために**意図的に**存在する。
- 現行版の締め: 「You can explicitly state your intent with a cookie by setting the appropriate SameSite attribute.」「To identify your first-party cookies and set appropriate attributes, check out First-party cookie recipes (/first-party-cookie-recipes/)。」

### 3. 「site」の定義と Public Suffix List（出典: https://web.dev/articles/samesite-cookies-explained）

- `SameSite` 属性（**RFC6265bis** で定義: `https://tools.ietf.org/html/draft-ietf-httpbis-cookie-same-site-00`）の導入により、Cookie を **first-party / same-site コンテキストに限定するかどうかを宣言**できるようになった。
- ここでの「**site**」の定義（原文逐語）: 「The site is the combination of the domain suffix and the part of the domain just before it. For example, the `www.web.dev` domain is part of the `web.dev` site.」＝ **ドメインサフィックス + その直前のドメイン部分**の組み合わせ。
- key-term（逐語）:
  - 「If the user is on `www.web.dev` and requests an image from `static.web.dev` then that is a **same-site** request.」
  - 「If the user is on `your-project.github.io` and requests an image from `my-project.github.io` that's a **cross-site** request.」
- これを定義するのが **public suffix list**（`https://publicsuffix.org/`）で、`.com` のようなトップレベルドメインだけでなく `github.io` のようなサービスも含む。そのため `your-project.github.io` と `my-project.github.io` は**別々のサイト**として数えられる。

〔補足（一般知識）〕この「site = eTLD+1（登録可能ドメイン）」という境界は、同一サイト内のサブドメイン（例 `a.example.com` と `b.example.com`）が **SameSite の観点では同一サイト**である、という診断上重要な帰結を持つ。したがってサブドメイン XSS / サブドメイン乗っ取りがあると SameSite=Strict でも守れない。

### 4. `SameSite` 属性で Cookie の用途を明示する（出典: https://web.dev/articles/samesite-cookies-explained）

原文の構成に従い、3 つの制御方法を順に示す。

- 「Introducing the `SameSite` attribute on a cookie provides three different ways to control this behaviour. You can choose to not specify the attribute, or you can use `Strict` or `Lax` to limit the cookie to same-site requests.」

#### 4.1 `SameSite=Strict`

- `Strict` にすると Cookie は**ファーストパーティのコンテキストでのみ送信**される。ユーザー目線では「**Cookie のサイトがブラウザの URL バーに現在表示されているサイトに一致する場合にのみ送信される**」。

```text
Set-Cookie: promo_shown=1; SameSite=Strict
```

- 自サイトを閲覧中は期待通り送られる。しかし**別サイトからのリンクや友人からのメールのリンクをたどって入ってくる最初のリクエストでは送られない**。
- 適する用途: 「パスワードの変更や商品の購入」のように、**初回ナビゲーションの後ろにある機能**に関する Cookie。
- `promo_shown` には**制限が強すぎる**: リンクで流入した読者も設定を反映してほしいので Cookie を送ってほしい。

#### 4.2 `SameSite=Lax`

- `Lax` は「**これらのトップレベルナビゲーションでの Cookie 送信を許可する**」もの。原文の猫記事の例（他サイトがあなたのコンテンツを参照し、画像を直接使い、元記事へのリンクを置く）:

```html
<p>Look at this amazing cat!</p>
<img src="https://blog.example/blog/img/amazing-cat.png" />
<p>Read the <a href="https://blog.example/blog/cat.html">article</a>.</p>
```

```text
Set-Cookie: promo_shown=1; SameSite=Lax
```

- 挙動（原文の強調をそのまま）: 読者が他人のブログにいるとき、ブラウザが `amazing-cat.png` をリクエストしても Cookie は **will not be sent（送信されない）**。しかし読者がリンクをたどってあなたのブログの `cat.html` に行くとき、そのリクエストには Cookie が **will include（含まれる）**。
- したがって「**`Lax` はサイトの表示に影響する Cookie に適し、`Strict` はユーザーのアクションに関連する Cookie に適する**」。

#### 4.3 caution（セキュリティ上の注意、逐語訳）

- 「Neither `Strict` nor `Lax` are a complete solution for your site's security. Cookies are sent as part of the user's request and you should treat them the same as any other user input. That means sanitizing and validating the input. **Never use a cookie to store data you consider a server-side secret.**」
  = `Strict` も `Lax` も**サイトのセキュリティの完全な解ではない**。Cookie はユーザーのリクエストの一部として送られるので、**他のユーザー入力と同じように扱い、サニタイズ・検証する**。サーバーサイドの秘密情報を Cookie に保存してはならない。

#### 4.4 `SameSite=None`（値を指定しない従来の挙動の明示化）

- 従来「値を指定しない」ことが「すべてのコンテキストで送ってほしい」を**暗黙に**表明する方法だった。RFC6265bis の最新ドラフト（`https://tools.ietf.org/html/draft-ietf-httpbis-rfc6265bis-03`）でこれを**明示化する新しい値 `SameSite=None`** が導入された。`None` を使うことで「**意図的にサードパーティコンテキストで送りたい**」と明確に伝えられる。
- 図のキャプション（逐語）: 「Explicitly mark the context of a cookie as `None`, `Lax`, or `Strict`.」
- Aside（逐語訳）: 「ウィジェット、埋め込みコンテンツ、アフィリエイトプログラム、広告、複数サイト横断のサインインなど、**他サイトで消費されるサービスを提供する場合は `None` を使って意図を明確にすべき**。」

### 5. `SameSite` 無指定時の既定動作の変更（ブラウザ既定値の変遷）（出典: https://web.dev/articles/samesite-cookies-explained）

- 問題設定（逐語訳）: `SameSite` 属性は広くサポートされていたが**開発者に広く採用されなかった**。「どこにでも Cookie を送る」というオープンな既定はすべてのユースケースを動かす一方で、**ユーザーを CSRF と意図しない情報漏洩にさらす**。
- そこで IETF 提案「**Incrementally Better Cookies**」（`https://tools.ietf.org/html/draft-west-cookie-incrementalism-00`）が 2 つの重要な変更を提示（原文箇条書きの逐語）:

> - Cookies without a `SameSite` attribute will be treated as `SameSite=Lax`.
> - Cookies with `SameSite=None` must also specify `Secure`, meaning they require a secure context.

- ブラウザ対応状況（原文の記述そのまま）:
  - **Chrome はバージョン 84 からこの既定動作を実装**（"Chrome implements this default behavior as of version 84."）。
  - **Firefox は Firefox 69 からテスト可能**で、将来的に既定にする予定。テストするには [`about:config`](http://kb.mozillazine.org/About:config) を開き `network.cookie.sameSite.laxByDefault` を設定する。
  - **Edge も既定動作の変更を予定**（blink-dev アナウンス参照）。
- `samesite-cookie-recipes` 側の記述（逐語）: 「This feature is the [default behavior from Chrome 84 stable onward](https://blog.chromium.org/2020/05/resuming-samesite-cookie-changes-in-july.html).」および
  - 「Cookies without a `SameSite` attribute will be treated as `SameSite=Lax`, meaning the default behavior will be to restrict cookies to first party contexts **only**.」
  - 「Cookies for cross-site usage **must** specify `SameSite=None; Secure` to enable inclusion in third party context.」

#### 5.1 `SameSite=Lax` by default（比較ブロックを逐語で）

**Worse — No attribute set**

```text
Set-Cookie: promo_shown=1
```

> If you send a cookie without any `SameSite` attribute specified…

**Better — Default behavior applied**

```text
Set-Cookie: promo_shown=1; SameSite=Lax
```

> The browser will treat that cookie as if `SameSite=Lax` was specified.

- 原文の推奨: これは**より安全な既定**を意図した変更だが、「ブラウザに適用させるのを頼るのではなく、**明示的に `SameSite` 属性を設定するのが理想**」。意図が明確になり、ブラウザ間で一貫した体験になる可能性が高まる。

#### 5.2 Lax + POST の 2 分間猶予（caution、逐語）

- 「The default behaviour applied by Chrome is **slightly more permissive than an explicit `SameSite=Lax`** as it will allow **certain cookies to be sent on top-level POST requests**. You can see the exact details on [the blink-dev announcement](https://groups.google.com/a/chromium.org/d/msg/blink-dev/AknSSyQTGYs/YKBxPCScCwAJ). **This is intended as a temporary mitigation**, you should still be fixing your cross-site cookies to use `SameSite=None; Secure`.」
- すなわち、**Chrome の「既定 Lax」は明示 `SameSite=Lax` より緩い**。詳しい時間条件（2 分）は MDN と RFC6265bis、Chromium 実装で確認できる（次節 8・9 参照）。

#### 5.3 `SameSite=None` must be secure（比較ブロックを逐語で）

**Worse — Rejected**

```text
Set-Cookie: widget_session=abc123; SameSite=None
```

> Setting a cookie without `Secure` **will be rejected**.

**Better — Accepted**

```text
Set-Cookie: widget_session=abc123; SameSite=None; Secure
```

> You must ensure that you pair `SameSite=None` with the `Secure` attribute.

- テスト方法（逐語）: 「You can test this behavior as of **Chrome 76** by enabling `about://flags/#cookies-without-same-site-must-be-secure` and from **Firefox 69** in [`about:config`](http://kb.mozillazine.org/About:config) by setting `network.cookie.sameSite.noneRequiresSecure`.」
- 運用上の注意: 「You will want to apply this when setting new cookies and **actively refresh existing cookies even if they are not approaching their expiry date**.」（新規設定時に適用し、期限が近くない既存 Cookie も積極的にリフレッシュする）
- note（逐語訳）: サードパーティコンテンツを提供するサービスに依存している場合、**プロバイダ側が更新しているかを確認**する必要がある。依存関係やスニペットの更新が必要な場合もある。
- 後方互換性: これらの変更は、以前のバージョンの `SameSite` を正しく実装したブラウザ、あるいは全く対応していないブラウザとも**後方互換**。`SameSite=None` を認識しないクライアントはそれを無視し、属性が設定されていないものとして処理する。

#### 5.4 warning: 既知の非互換クライアント（逐語訳）

- 「Chrome、Safari、UC browser を含む**多数の旧バージョンのブラウザは新しい `None` 値と非互換**で、Cookie を無視したり制限したりする可能性がある。この挙動は現行バージョンでは修正されているが、**自サイトのトラフィックを確認して影響を受けるユーザーの割合を把握すべき**。」既知の非互換クライアント一覧: `https://www.chromium.org/updates/same-site/incompatible-clients`
- 記事末尾の謝辞（原文）: 「Kind thanks for contributions and feedback from Lily Chen, Malte Ubl, Mike West, Rob Dodson, Tom Steiner, and Vivek Sekhar」／著者: rowan_m（Rowan Merewood）、初出 2019-05-07、更新 2023-03-20。

### 6. SameSite cookie recipes: クロスサイト Cookie が必要になるユースケースと実装（出典: https://web.dev/articles/samesite-cookie-recipes）

原文の「Use cases for cross-site or third-party cookies」節を漏らさず記録する。

#### 6.1 `<iframe>` 内のコンテンツ

- 別サイトのコンテンツを `<iframe>` で表示するのはサードパーティコンテキスト。標準的なユースケース（逐語訳）:
  - 他サイトから共有された埋め込みコンテンツ（動画、地図、コードサンプル、ソーシャル投稿）
  - 外部サービスのウィジェット（決済、カレンダー、予約、リザベーション機能）
  - ソーシャルボタンや不正防止サービスなど、**目立たない `<iframes>` を作るウィジェット**
- Cookie の用途: セッション状態の維持、一般設定の保存、統計の有効化、既存アカウントを持つユーザー向けのコンテンツのパーソナライズなど。
- 図キャプション（逐語）: 「If the embedded content doesn't come from the same site as the top-level browsing context, it's third-party content.」
- Web は本質的に合成可能（composable）なので、**トップレベル（ファーストパーティ）でも閲覧されるコンテンツが `<iframe>` に埋め込まれる**こともある。その場合そのサイトの Cookie は**サードパーティ Cookie として扱われる**。他者に埋め込まれやすいサイトを作りつつ Cookie に依存するなら、クロスサイト用にマークするか、Cookie 無しで**優雅に劣化（gracefully fallback）**できるようにする必要がある。

#### 6.2 サイト間の "Unsafe" リクエスト

- 「"unsafe"」は**状態を変更しうるリクエスト**を指す。Web では主に **POST** リクエスト。
- 「Cookies marked as `SameSite=Lax` will be sent on **safe top-level navigations**, e.g. clicking a link to go to a different site. However something like a `<form>` submission via **POST** to a different site **would not include cookies**.」
- 図キャプション（逐語）: 「If the incoming request uses a "safe" method then the cookies will be sent.」
- 典型パターン: ユーザーを外部サービス（例: **サードパーティ IdP**）にリダイレクトして処理させ、戻ってくる形。サイトを離れる前に**使い捨てトークンを含む Cookie** を設定し、戻りのリクエストでそれを検証して **CSRF** を緩和する（OWASP CSRF Prevention Cheat Sheet を参照）。**その戻りリクエストが POST なら Cookie に `SameSite=None; Secure` を付ける必要がある**。

#### 6.3 リモートリソース

- `<img>`、`<script>` などページ上の任意のリモートリソースが Cookie に依存し得る。一般的な用途は**トラッキングピクセル**とコンテンツのパーソナライズ。
- JS 由来のリクエストにも当てはまる。`fetch()` が **`credentials: 'include'`** オプション付きで呼ばれている、`XMLHttpRequest` の **`withCredentials` が `true`** に設定されている場合は「そのリクエストで Cookie が期待されている良い指標」。これらの Cookie はクロスサイトリクエストに含まれるよう適切にマークする必要がある。

#### 6.4 WebView 内のコンテンツ

- プラットフォーム固有アプリの WebView はブラウザで駆動されるので、同じ制限/問題が当てはまるかテストが必要。**Android で WebView が Chrome 駆動の場合、Chrome 84 では新しい既定値は即時適用されない**が、将来適用する意図があるのでテストと準備は必要。
- Android はプラットフォーム固有アプリが **`CookieManager` API**（`https://developer.android.com/reference/android/webkit/CookieManager`）経由で直接 Cookie を設定することも許可している。ヘッダや JS 経由で設定する Cookie と同様、クロスサイト用途なら `SameSite=None; Secure` を検討する。

#### 6.5 今日 `SameSite` をどう実装するか

- ファーストパーティのみで必要な Cookie は、必要に応じて `SameSite=Lax` か `SameSite=Strict` を付けるのが理想。何もせずブラウザの既定に任せることも選べるが、**ブラウザ間で挙動が一貫しないリスクと、Cookie ごとのコンソール警告**が伴う。

```text
Set-Cookie: first_party_var=value; SameSite=Lax
```

- サードパーティコンテキストで必要な Cookie は `SameSite=None; Secure` を**両方セットで**。`None` だけで `Secure` が無ければ**Cookie は拒否される**。

```text
Set-Cookie: third_party_var=value; SameSite=None; Secure
```

#### 6.6 非互換クライアントの扱い（Handling incompatible clients）

- 一般原則（逐語訳）: 「**非互換クライアントを特殊ケースとして扱え。新しい規則を実装しているブラウザのために例外を作るな。**」
- 方法 1: **新旧両方の Cookie を設定する**（逐語）:

```text
Set-cookie: 3pcookie=value; SameSite=None; Secure
Set-cookie: 3pcookie-legacy=value; Secure
```

- 新しい挙動を実装したブラウザは `SameSite` 付きの Cookie を設定し、他のブラウザは無視/誤設定するが `3pcookie-legacy` を設定する。**サーバ側は新形式を先にチェックし、無ければレガシーにフォールバック**する。
- Node.js（Express + cookie-parser）の例（**原文のまま逐語**）:

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

- 欠点: 冗長な Cookie を設定し、**設定側と読み取り側の両方を変更**する必要がある。利点: ブラウザの挙動に関係なく全ブラウザをカバーできる。
- 方法 2: `Set-Cookie` 送出時点で **User-Agent 文字列でクライアントを判定**する。非互換クライアント一覧（`https://www.chromium.org/updates/same-site/incompatible-clients`）を参照し、適切なライブラリ（Node.js なら **ua-parser-js**）を使う。「これらの正規表現を自分で書きたくはないだろうから、UA 判定はライブラリに任せるのが望ましい」。
  - 利点: Cookie 設定箇所 1 か所の変更で済む。欠点（原文の警告）: 「**user agent sniffing is inherently fragile and may not catch all of the affected users**」（UA スニッフィングは本質的に壊れやすく、影響ユーザー全員を捕捉できない可能性がある）。
- Aside（逐語訳）: どの方法を選んでも、**レガシー経路を通るトラフィック量をログに取る手段**を用意し、許容閾値を下回ったらワークアラウンドを削除するリマインダ/アラートを設定すること。
- 言語/ライブラリ/フレームワークの `SameSite=None` 対応状況は **`SameSite` examples repo on GitHub**（`https://github.com/GoogleChromeLabs/samesite-examples`）に文書化されている。
- ヘルプの入手先（逐語の要点）: 上記 repo に issue を立てる / StackOverflow の "samesite" タグ / Chromium の挙動の問題は `[SameSite cookies]` issue テンプレート（`https://bit.ly/2lJMd5c`）/ Chrome の進捗は `https://www.chromium.org/updates/same-site`。
- クロスブラウザ対応表は MDN `Set-Cookie` の **Browser compatibility** セクションを参照（`https://developer.mozilla.org/docs/Web/HTTP/Headers/Set-Cookie#Browser_compatibility`）。

### 7. Schemeful Same-Site（scheme を含む site 定義）（出典: https://web.dev/articles/schemeful-samesite）

- **Schemeful Same-Site** は「(web)site」の定義を**登録可能ドメインのみ**から**scheme + 登録可能ドメイン**に変更する。
- key-term（逐語訳）: 「サイトの非セキュアな HTTP 版（例 **http**://website.example）とセキュアな HTTPS 版（**https**://website.example）は、**互いにクロスサイト**として扱われるようになった。」
- 完全に HTTPS 化済みのサイトなら何も心配は要らない。まだなら**それが最優先**。
- warning（逐語訳）: 長期計画では**サードパーティ Cookie は完全に段階的廃止**され、プライバシー保護の代替に置き換えられる。cross-scheme で送るために `SameSite=None; Secure` を設定するのは**完全 HTTPS への移行途中の一時的措置とみなすべき**。
- テスト有効化:
  - **Chrome 86 以降**: `about://flags/#schemeful-same-site` を有効化。進捗は Chrome Status ページ（`https://chromestatus.com/feature/5096179480133632`）。
  - **Firefox 79 以降**: `about:config` で `network.cookie.sameSite.schemeful` を `true` に設定。進捗は Bugzilla `https://bugzilla.mozilla.org/show_bug.cgi?id=1651119`。
- 理由（逐語訳）: 既定を `SameSite=Lax` に変えた主要な理由の 1 つは CSRF からの保護だった。しかし**非セキュアな HTTP トラフィックは、ネットワーク攻撃者が Cookie を改変し、それがセキュアな HTTPS 版で使われる機会を残している**。scheme 間に追加のクロスサイト境界を作ることで、これらの攻撃に対する防御をさらに強化する。

#### 7.1 Navigation（cross-scheme のナビゲーション）

cross-scheme 版のサイト間のナビゲーション（例 **http**://site.example → **https**://site.example）は、以前は `SameSite=Strict` Cookie の送信を許していたが、**今はクロスサイトナビゲーションとして扱われ `SameSite=Strict` Cookie はブロックされる**。

| | **HTTP → HTTPS** | **HTTPS → HTTP** |
| --- | --- | --- |
| `SameSite=Strict` | ⛔ Blocked | ⛔ Blocked |
| `SameSite=Lax` | ✓ Allowed | ✓ Allowed |
| `SameSite=None;Secure` | ✓ Allowed | ⛔ Blocked |

#### 7.2 Loading subresources（サブリソースの読み込み）

- warning（逐語訳）: すべての主要ブラウザは**アクティブな混在コンテンツ**（スクリプトや iframe）をブロックする。加えて Chrome や Firefox は**パッシブな混在コンテンツのアップグレード/ブロック**に取り組んでいる。
- サブリソースの例: 画像、iframe、XHR や Fetch によるネットワークリクエスト。
- cross-scheme のサブリソース読み込みは以前は `SameSite=Strict` や `SameSite=Lax` Cookie の送信/設定を許していたが、**今は他のサードパーティ/クロスサイトサブリソースと同様に扱われ、`Strict` と `Lax` の Cookie はブロックされる**。
- さらに、ブラウザが非セキュアな scheme のリソースをセキュアなページ上で読み込むことを許しても、**サードパーティ/クロスサイト Cookie は `Secure` を必要とするため、それらのリクエストではすべての Cookie がブロックされる**。

| | **HTTP → HTTPS** | **HTTPS → HTTP** |
| --- | --- | --- |
| `SameSite=Strict` | ⛔ Blocked | ⛔ Blocked |
| `SameSite=Lax` | ⛔ Blocked | ⛔ Blocked |
| `SameSite=None;Secure` | ✓ Allowed | ⛔ Blocked |

#### 7.3 POSTing a form（フォーム POST）

- cross-scheme 版間の POST は以前は `SameSite=Lax` / `SameSite=Strict` Cookie の送信を許していたが、**今はクロスサイト POST として扱われ、`SameSite=None` の Cookie のみ送信可能**。
- 遭遇しやすい場面: **既定で非セキュア版を表示しつつ、サインインやチェックアウトのフォーム送信時にセキュア版へアップグレードするサイト**。
- サブリソースと同様、セキュア（HTTPS）→ 非セキュア（HTTP）へ向かうリクエストでは**すべての Cookie がブロック**される。
- warning（逐語訳）: 最善の解決は**フォームのページと送信先の両方をセキュアな接続にする**こと。ユーザーが機密情報を入力する場合は特に重要。

| | **HTTP → HTTPS** | **HTTPS → HTTP** |
| --- | --- | --- |
| `SameSite=Strict` | ⛔ Blocked | ⛔ Blocked |
| `SameSite=Lax` | ⛔ Blocked | ⛔ Blocked |
| `SameSite=None;Secure` | ✓ Allowed | ⛔ Blocked |

#### 7.4 テスト方法（DevTools と Console のメッセージ、逐語）

Chrome 86 以降、DevTools の **Issue タブ**に Schemeful Same-Site の問題が表示される。

- Navigation issues:
  - "Migrate entirely to HTTPS to continue having cookies sent on same-site requests" — Cookie が**将来の Chrome でブロックされる**警告。
  - "Migrate entirely to HTTPS to have cookies sent on same-site requests" — Cookie が**ブロックされた**警告。
- Subresource loading issues:
  - "Migrate entirely to HTTPS to continue having cookies sent to same-site subresources" / "Migrate entirely to HTTPS to continue allowing cookies to be set by same-site subresources" — **将来ブロックされる**警告。
  - "Migrate entirely to HTTPS to have cookies sent to same-site subresources" / "Migrate entirely to HTTPS to allow cookies to be set by same-site subresources" — **ブロックされた**警告。後者はフォーム POST 時にも出得る。
- より詳しくは `https://www.chromium.org/updates/schemeful-same-site/testing-and-debugging-tips-for-schemeful-same-site`。
- Firefox 79 以降、`network.cookie.sameSite.schemeful` を `true` にするとコンソールに表示されるメッセージ:
  - "Cookie `cookie_name` **will be soon** treated as cross-site cookie against `http://site.example/` because the scheme does not match."
  - "Cookie `cookie_name` **has been** treated as cross-site against `http://site.example/` because the scheme does not match."

#### 7.5 FAQ（逐語の要点）

- **完全 HTTPS 化済みなのに DevTools で問題が出る**: 一部のリンクやサブリソースが非セキュア URL を指している可能性。対策として **HSTS（`Strict-Transport-Security`）+ `includeSubDomain`** ディレクティブ。これがあれば誤って非セキュアリンクを含んでもブラウザが自動的にセキュア版を使う。
- **HTTPS にできない場合**: ホスティング事業者に相談、自前運用なら **Let's Encrypt**、CDN/プロキシ経由で HTTPS を提供する、などを検討。それも不可能なら影響 Cookie の `SameSite` 保護を緩める:
  - `SameSite=Strict` だけがブロックされているなら `Lax` に下げる。
  - `Strict` と `Lax` 双方がブロックされ、Cookie の送信先（設定元）がセキュア URL なら `None` に下げる。
  - **このワークアラウンドは送信先（設定元）が非セキュアだと失敗する**。`SameSite=None` は `Secure` を必須とするため、非セキュア接続では送信/設定できない。この場合サイトを HTTPS 化するまでその Cookie にアクセスできない。
  - いずれも一時的措置。最終的にサードパーティ Cookie は完全に廃止される。
- **`SameSite` 未指定の Cookie はどう影響するか**: 「Cookies without a `SameSite` attribute are treated as if they specified `SameSite=Lax` and the same cross-scheme behavior applies to these cookies as well. **Note that the temporary exception to unsafe methods still applies**, see the Lax + POST mitigation in the Chromium `SameSite` FAQ (`https://www.chromium.org/updates/same-site/faq`).」
- **WebSocket はどう影響するか**: WebSocket 接続は**ページと secureness が同じなら same-site**とみなされる。
  - Same-site: `https://` からの `wss://` 接続 / `http://` からの `ws://` 接続
  - Cross-site: `http://` からの `wss://` 接続 / `https://` からの `ws://` 接続

### 8. `Set-Cookie` 属性の完全リファレンス（**原典（Medium 記事）が読めなかったため一次資料で補完**、出典: MDN `Set-Cookie` — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie / 原稿 https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/http/reference/headers/set-cookie/index.md）

- `Set-Cookie` は**レスポンスヘッダ**で、サーバから UA に Cookie を送る。**複数の Cookie を送るには、同一レスポンス内に複数の `Set-Cookie` ヘッダ**を送る。
- WARNING（逐語訳・重要）: 「ブラウザはフロントエンド JavaScript から `Set-Cookie` ヘッダへのアクセスをブロックする。これは Fetch 仕様の要求で、`Set-Cookie` は **forbidden response header name** として定義され、フロントエンドに露出するレスポンスからは**フィルタされなければならない**。」
  - さらに「Fetch API / XMLHttpRequest のリクエストが **CORS を使う**場合、**リクエストに credentials が含まれていない限り**、ブラウザはサーバレスポンス中の `Set-Cookie` ヘッダを**無視する**。」
- ヘッダの分類表（原文の properties table を再現）:

| 項目 | 値 |
| --- | --- |
| Header type | Response header |
| Forbidden request header | No |
| Forbidden response header | **Yes** |

#### 8.1 Syntax（原文のまま逐語）

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

#### 8.2 属性一覧（表として完全再現）

| 属性 | 必須/任意 | 意味と規則（MDN の記述を落とさず日本語化、値・文字集合は原文どおり） |
| --- | --- | --- |
| `<cookie-name>=<cookie-value>` | 必須 | Cookie 定義は name-value ペアで始まる。**`<cookie-name>` に使える文字**: 制御文字（ASCII 0〜31 と 127）と区切り文字（space, tab, および `( ) < > @ , ; : \ " / [ ] ? = { }`）を除く任意の US-ASCII。**`<cookie-value>`**: 任意でダブルクォートで囲める。制御文字（ASCII 0〜31 と 127）、空白、ダブルクォート、カンマ、セミコロン、バックスラッシュを除く US-ASCII。**エンコーディング**: 多くの実装が値にパーセントエンコーディングを行うが、RFC は要求していない。パーセントエンコーディングは許容文字の要件を満たす助けになる。NOTE: 一部の Cookie 名には**プレフィックス**が含まれ、対応 UA で属性に特定の制約を課す。 |
| `Domain=<domain-value>` | 任意 | Cookie がどのホストに送られるかを定義。**domain を設定するとそのドメインと全サブドメインで利用可能**になる。**省略すると、送信したホストにのみ返される（host-only cookie）**。これはホスト名を明示するより**制限が強い**（サブドメインに送られない）。値は `Set-Cookie` を送るサーバのドメイン、またはその**親ドメイン**でなければならない。`com`, `co.uk`, `github.io` のような**public suffix は不可**。例: `api.example.com` からのレスポンスは `Domain=api.example.com` か `Domain=example.com` を設定できるが、`Domain=beta.api.example.com`、`Domain=other.example.com`、`Domain=com` は不可。`shop.example.co.uk` は `Domain=shop.example.co.uk` か `Domain=example.co.uk` は可だが `Domain=co.uk` は **`co.uk` が public suffix なので**不可。**規則を破る Cookie は無視される**。旧仕様と異なり、**先頭のドット（`.example.com`）は無視される**。複数のホスト/ドメイン値は**不可**だが、domain を指定した場合は**常にサブドメインが含まれる**。 |
| `Expires=<date>` | 任意 | Cookie の最大寿命を **HTTP-date タイムスタンプ**で示す（書式は `Date` ヘッダ参照）。**未指定なら session cookie** になり、クライアント終了時にセッションが終わって削除される。WARNING: 多くのブラウザには**セッション復元機能**があり、全タブを保存して次回復元する。**session cookie も復元され**、ブラウザが閉じられなかったかのように振る舞う。`Expires` はサーバが自身の内部時計を基準に設定するのでクライアント時計と差があり得る。**Firefox と Chromium 系は内部的に、時計差を補正した expiry (max-age) 値を使い**、サーバが意図した時刻で保存/失効させる。時計ずれの補正は `DATE` ヘッダの値から計算される。仕様は解析方法を定めるが、受信側が値を補正すべきか/どう補正するかは示していない。 |
| `HttpOnly` | 任意 | **JavaScript から Cookie にアクセスすることを禁じる**（例 `Document.cookie` 経由）。注意: `HttpOnly` で作られた Cookie も、**JavaScript 起点のリクエスト**（`XMLHttpRequest.send()` や `fetch()` 呼び出し）では**送信される**。これは **XSS に対する攻撃を緩和**する。 |
| `Max-Age=<number>` | 任意 | Cookie 失効までの**秒数**。**0 または負の数は即時失効**。**`Expires` と `Max-Age` の両方が設定された場合は `Max-Age` が優先**。 |
| `Partitioned` | 任意 | Cookie を**パーティション化ストレージ**に保存すべきことを示す。これを設定する場合は **`Secure` も必須**。詳細は CHIPS（Cookies Having Independent Partitioned State）。 |
| `Path=<path-value>` | 任意 | ブラウザが `Cookie` ヘッダを送るために**リクエスト URL に存在しなければならないパス**を示す。**省略時は、その Cookie を設定したリクエスト URL のパス部分**が既定。例: `https://example.com/docs/Web/HTTP/index.html` へのリクエストで設定された場合、既定の path は `/docs/Web/HTTP/`。**`/` はディレクトリ区切りと解釈され、サブディレクトリもマッチ**する。`Path=/docs` の場合: マッチする → `/docs`, `/docs/`, `/docs/Web/`, `/docs/Web/HTTP`。マッチしない → `/`, `/docsets`, `/fr/docs`。NOTE: **`path` 属性はセキュリティ手段として意図されていない**。別パスからの Cookie の不正な読み取りを**防がない**。 |
| `SameSite=<samesite-value>` | 任意 | Cookie がクロスサイトリクエスト（**scheme を含め**、Cookie を設定したサイトとは別の site 由来のリクエスト）で送られるかを制御。これは **CSRF を含む一部のクロスサイト攻撃に対する保護**を提供する。値は `Strict` / `Lax` / `None`（下記）。 |
| `Secure` | 任意 | Cookie を**`https:` スキームのリクエストでのみ**サーバへ送る（**localhost は例外**）。これにより **MITM（manipulator in the middle）攻撃に対して耐性が高まる**。NOTE: `Secure` が Cookie 内の機密情報（セッションキー、ログイン情報など）への全アクセスを防ぐと**思い込まないこと**。この属性が付いた Cookie も、**クライアントのハードディスクへのアクセス**があれば、あるいは **`HttpOnly` が付いていなければ JavaScript から**読み取り/改変され得る。**非セキュアなサイト（`http:`）は `Secure` 付き Cookie を設定できない**。`Secure` が **localhost によって設定される場合は `https:` 要件は無視される**。 |

##### `SameSite` の 3 値（MDN の定義を逐語に近い形で）

- **`Strict`**: Cookie を設定した**同じ site 由来のリクエストにのみ**送る。
- **`Lax`**: 設定した同じ site 由来のリクエストに加え、**次の 2 条件を共に満たすクロスサイトリクエスト**にも送る。
  1. **トップレベルナビゲーションである**こと（本質的には**ブラウザのアドレスバーに表示される URL が変わる**リクエスト）。
     - 除外されるもの: `fetch()` API によるリクエスト、`<img>` や `<script>` 要素のサブリソースリクエスト、`<iframe>` 内のナビゲーション。
     - 含まれるもの: ユーザーがトップレベル閲覧コンテキストで別サイトへのリンクをクリックしたときのリクエスト、`document.location` への代入、**`<form>` の送信**。
  2. **safe メソッドを使う**こと。特に **`POST`、`PUT`、`DELETE` は除外**される。
  - 一部のブラウザは `SameSite` 未指定時の既定値として `Lax` を使う。
  - **NOTE（Lax+POST の 2 分猶予・逐語）**: 「When `Lax` is applied as a default, **a more permissive version is used**. In this more permissive version, cookies are also included in **`POST` requests, as long as they were set no more than two minutes before the request was made**.」
- **`None`**: クロスサイトと同一サイト両方のリクエストで送る。**この値を使う場合は `Secure` 属性も設定しなければならない**。

#### 8.3 Cookie プレフィックス（`__Secure-` / `__Host-` / `__Http-` / `__Host-Http-`）

MDN の記述（逐語訳）: 「一部の Cookie 名には、対応 UA において Cookie の属性に特定の制約を課す**プレフィックス**が含まれる。**すべての Cookie プレフィックスは二重アンダースコア（`__`）で始まりダッシュ（`-`）で終わる**。」

| プレフィックス | 要求される条件 | 得られる保証 |
| --- | --- | --- |
| **`__Secure-`** | セキュアなページ（HTTPS）から **`Secure` 属性付き**で設定されなければならない | 非セキュアオリジンからの設定・上書きを防ぐ |
| **`__Host-`** | セキュアなページ（HTTPS）から **`Secure` 属性付き**で設定され、加えて **`Domain` 属性を持たない**こと、**`Path` が `/`** であること | 「そのような Cookie が**設定したホストにのみ送られ、ドメイン上の他のホストには送られない**ことを保証する。また**ホスト全体に設定され、そのホストのどのパスからも上書きできない**ことを保証する。この組み合わせは、**オリジンをセキュリティ境界として扱うことに Cookie として最も近づいた**ものになる」 |
| **`__Http-`** | セキュアなページ（HTTPS）から **`Secure` フラグ付き**で設定され、加えて **`HttpOnly` 属性**を持つこと（= `Set-Cookie` ヘッダ経由で設定されたことの証明。`Document.cookie` や Cookie Store API のような JS 機能では設定・変更できない） | JS 由来でないことの保証 |
| **`__Host-Http-`** | `Secure` フラグ付き（HTTPS）＋ `HttpOnly` 必須、加えて **`__Host-` と同じ制約** | 「オリジンをセキュリティ境界として扱うことに最も近づけつつ、同時にスコープが HTTP リクエストに限定されていることを開発者とサーバ運用者が知れる」 |

- WARNING（逐語訳）: 「**Cookie プレフィックスをサポートしないブラウザではこれらの追加保証を期待できない**。そのような場合、プレフィックス付き Cookie は**常に受け入れられてしまう**。」

#### 8.4 例（原文のまま逐語）

**Session cookie**（`Expires` も `Max-Age` も指定しない Cookie が session cookie）

```http
Set-Cookie: sessionId=38afes7a8
```

**Permanent cookie**

```http
Set-Cookie: id=a3fWa; Expires=Wed, 21 Oct 2015 07:28:00 GMT
```

```http
Set-Cookie: id=a3fWa; Max-Age=2592000
```

**Invalid domains**（設定したサーバを含まないドメインの Cookie は UA が拒否すべき）

`original-company.com` でホストされたサーバが設定した場合、次は拒否される:

```http
Set-Cookie: qwerty=219ffwef9w0f; Domain=some-company.co.uk
```

`example.com` でホストされたサーバが設定した場合、**サブドメイン指定**も拒否される:

```http
Set-Cookie: sessionId=e8bb43229de9; Domain=foo.example.com
```

**Cookie prefixes**

```http
// Both accepted when from a secure origin (HTTPS)
Set-Cookie: __Secure-ID=123; Secure; Domain=example.com
Set-Cookie: __Host-ID=123; Secure; Path=/

// Rejected due to missing Secure attribute
Set-Cookie: __Secure-id=1

// Rejected due to the missing Path=/ attribute
Set-Cookie: __Host-id=1; Secure

// Rejected due to setting a Domain
Set-Cookie: __Host-id=1; Secure; Path=/; Domain=example.com

// Only settable via Set-Cookie
Set-Cookie: __Http-ID=123; Secure; Domain=example.com
Set-Cookie: __Host-Http-ID=123; Secure; Path=/
```

**Partitioned cookie**

```http
Set-Cookie: __Host-example=34d8g; SameSite=None; Secure; Path=/; Partitioned;
```

- NOTE（逐語訳）: パーティション化 Cookie は **`Secure` 付きで設定されなければならない**。加えて、**`__Host` または `__Host-Http-` プレフィックスの使用が推奨**される（登録可能ドメインではなく**ホスト名に束縛**するため）。

### 9. 規範仕様の該当箇所（**原典（Medium 記事）が読めなかったため一次規格で補完**、出典: RFC 6265bis ドラフト原稿 https://raw.githubusercontent.com/httpwg/http-extensions/main/draft-ietf-httpbis-rfc6265bis.md）

#### 9.1 `Set-Cookie` の ABNF（原文のまま逐語）

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

付随する規範的注意点（要点を落とさず）:
- サーバは**無名 Cookie（空の cookie-name）を生成してはならない (MUST NOT)**。UA が送り返す際に予測不能にシリアライズされ得るため。
- 任意データを入れたい場合は **Base64 等でエンコードすべき (SHOULD)**。
- cookie-value は DQUOTE で囲んでもよいが、**先頭・末尾の DQUOTE は除去されず値の一部として `Cookie` ヘッダに含まれる**。
- **同一 set-cookie-string 内に同名の属性を 2 つ生成してはならない (MUST NOT)**。
- **属性名は大文字小文字を区別しない**（"httponly", "Httponly", "hTTPoNLY" なども受理される）。
- **同一レスポンス内に同じ cookie-name の `Set-Cookie` を複数含めてはならない (MUST NOT)**。
- 複数レスポンスを同時に送ると（複数ソケット等）**race condition** になり予測不能な挙動を招く。
- 2 桁年の解釈が UA 間で異なるので **rfc1123-date（4 桁年）を使うべき (SHOULD)**。
- 一部 UA は日付を **32-bit UNIX time_t** として処理し、**2038 年以降**の日付を誤処理する実装バグがあり得る。

#### 9.2 属性のセマンティクス（非規範、逐語の要点）

- UA が `Set-Cookie` を受け取ると Cookie と属性を保存し、以後の HTTP リクエストで**該当する未失効の Cookie を `Cookie` ヘッダに含める**。
- **同じ cookie-name・domain-value・path-value** の Cookie を新たに受け取ると、**既存の Cookie は追い出され（evicted）、新しいものに置き換わる**。サーバは**過去の日時の `Expires`** を送ることで Cookie を削除できる。
- 属性が示さない限り、Cookie は**オリジンサーバにのみ返され（サブドメインには返らない）**、**現在のセッション終了時に失効**する。**UA は認識できない属性を無視する（Cookie 全体は無視しない）**。
- **`Expires`**: UA は指定日時を調整してよく、その日時まで保持する義務はない（メモリ圧やプライバシーで evict する）。Cookie の寿命は**UA の時計**基準でサーバの時計と異なり得る。サーバは**指定時刻に正確に evict されることに依存してはならない (MUST NOT)**。
- **`Max-Age`**: 失効までの秒数。UA は期間を調整してよい。注: **`Max-Age` をサポートしない既存 UA は属性を無視する**。**`Max-Age` と `Expires` の両方があれば `Max-Age` が優先**。両方無ければ「現在のセッションが終わるまで」保持。
- **`Domain`**: 値が `site.example` なら、UA は `site.example`、`www.site.example`、`www.corp.site.example` へのリクエストで Cookie を含める。**省略時はオリジンサーバにのみ返す**。
  - WARNING（逐語訳）: 「一部の既存 UA は、**`Domain` 属性が無い場合を、現在のホスト名を含む `Domain` 属性があるかのように扱う**。例えば `site.example` が `Domain` 無しの `Set-Cookie` を返すと、これらの UA は**誤って `www.site.example` にも Cookie を送る**。」
  - UA は、**Cookie のスコープがオリジンサーバを含まない `Domain`** の Cookie を拒否する。例: `foo.site.example` からは `Domain=site.example` や `Domain=foo.site.example` は受理するが、`Domain=bar.site.example` や `Domain=baz.foo.site.example` は受理しない。
  - 注: セキュリティ上の理由から、多くの UA は **public suffix に対応する `Domain`（`com`、`co.uk` など）を拒否**するよう構成されている。
- **`Path`**: 省略時は request-uri のパス成分の「ディレクトリ」が既定値。UA は request-uri のパス部分が Cookie の `Path` に**マッチ（またはそのサブディレクトリ）**の場合のみ Cookie を含める（`%x2F` = `/` をディレクトリ区切りとして解釈）。
  - 「ホスト内の異なるパス間で Cookie を分離するのに一見有用だが、**`Path` 属性はセキュリティのために依拠できない**（Security Considerations 参照）。」
- **`Secure`**: Cookie のスコープを「secure」チャネル（secure の定義は UA 依存）に限定。Cookie に `Secure` があるとき、UA は**リクエストが secure チャネル（典型的には TLS 上の HTTP）で送られる場合のみ**Cookie を含める。
- **`HttpOnly`**: Cookie のスコープを **HTTP リクエストに限定**。特に、**非 HTTP API 経由で Cookie にアクセスさせる際に Cookie を省略する**よう UA に指示する。注: **`HttpOnly` は `Secure` と独立**で、両方付けられる。
- **`SameSite`**（逐語の要点）: Cookie のスコープを、リクエストが same-site の場合にのみ添付されるよう限定する。例: `https://site.example/sekrit-image` へのリクエストは、「site for cookies」が scheme `https`、登録ドメイン `site.example` のオリジンであるコンテキストから開始された場合に限り same-site Cookie を添付する。
  - `Strict` → same-site リクエストのみ。`Lax` → same-site リクエスト＋**クロスサイトのトップレベルナビゲーション**。`None` → same-site と cross-site 両方。
  - **既知の 3 キーワード以外の値**は「**`Lax` と等価な既定強制モード**」の対象になる。UA が "Lax-allowing-unsafe" 強制を使う場合、この既定強制モードは代わりに "**Lax-allowing-unsafe** と等価"になる。
  - 重要（逐語訳）: 「`SameSite` 属性は**配信だけでなく Cookie の生成にも影響する**。`SameSite=Lax` または `SameSite=Strict` を主張する Cookie は、**クロスサイトのサブリソースリクエストへのレスポンスや、クロスサイトの入れ子ナビゲーションでは設定できない**。ただし**トップレベルナビゲーションであれば、クロスサイトかどうかに関わらず設定できる**。」

#### 9.3 「same-site」/「cross-site」リクエストの判定（逐語の要点）

- 2 つのオリジンが same-site かは `SAMESITE` 仕様の "same site" 基準による。リクエストが "same-site" であるのは次が真のとき:
  1. そのリクエストが、**UI 要素（ツールバーの更新ボタン等）経由でトリガーされたリロードナビゲーションの結果でない**。
  2. リクエストの current url のオリジンが、リクエストの client の「**site for cookies**」（オリジン）と same-site である。あるいはリクエストに client が無い/null である。
- UI 要素経由のリロードは、**リロードされた文書が元々 same-site リクエストでナビゲートされていた場合に限り same-site**。"same-site" でないリクエストは "cross-site"。
- **Document ベースのリクエスト**: アドレスバーの URI が「ユーザーに直接露出する唯一のセキュリティコンテキスト」であり、そのオリジン（top-level traversable の active document のオリジン）を「**top-level origin**」と定義する。トップレベルの文書の "site for cookies" は top-level origin。
- **入れ子文書（container documents）**では、**すべての祖先ナビゲーブルの active document のオリジンを監査**する必要がある（RFC7034 の "multiple-nested scenarios" を考慮）。文書の "site for cookies" が top-level origin になるのは、**top-level origin が当該文書のオリジンおよびすべての祖先文書のオリジンと same-site である場合に限る**。そうでなければ **opaque origin** になる。
- アルゴリズム（逐語訳）:
  1. `top-document` を `document` のナビゲーブルの top-level traversable の active document とする。
  2. `top-origin` を、`top-document` の sandboxed origin browsing context フラグが立っていれば `top-document` の URI のオリジン、そうでなければ `top-document` のオリジンとする。
  3. `documents` を `document` の inclusive ancestor navigables の active documents のリストとする。
  4. `documents` の各 `item` について: `origin` を（sandboxed フラグが立っていれば `item` の URI のオリジン、そうでなければ `item` のオリジン）とし、`origin` が `top-origin` と same-site でなければ **opaque origin を返す**。
  5. `top-origin` を返す。
  - 注: このアルゴリズムは `top-document` から `document` までの**文書の連鎖すべてが active な場合にのみ**適用される。
- **Dedicated / Shared Worker**: dedicated worker は 1 文書に束縛され、worker のオリジンが文書の "site for cookies" と same-site なら文書の "site for cookies" を継ぐ。そうでなければ opaque。shared worker は複数文書に束縛され得るので、**値がすべて worker のオリジンと same-site でない場合は opaque**、一致する場合は worker のオリジン。
- **Service Worker**: 登録した Document と接線的な関係しか持たない完全に独立した実行コンテキストなので複雑。UA の扱いは異なり得るが、**`SERVICE-WORKERS` 仕様に一致させるべき (SHOULD)**。
- **`Set-Cookie` の無視**: UA は **100 番台のステータスコードのレスポンス**に含まれる `Set-Cookie`、または cookie policy に基づいて無視してよい (MAY)。それ以外の `Set-Cookie` は、**400 番台・500 番台のレスポンスに含まれるものも含め**処理すべき (SHOULD)。

#### 9.4 サーバ向けのプレフィックス規定（原文のまま逐語の例を含む）

- 動機（逐語訳）: Weak Confidentiality と Weak Integrity の節が、Cookie の歴史的実装の欠点を述べている。特に「**サーバは、ある Cookie が特定の属性群で設定されたと確信することができない**」。後方互換な方法でその確信を与えるため、**Cookie 名の先頭数文字から 2 つの一般的な要件群を推論できる**ようにした。
- **互換性を最大化するため、サーバは下記のプレフィックスを使うべき (SHOULD)**。

**`__Secure-` プレフィックス**: 名前が **case-sensitive** に `__Secure-` に一致するなら、その Cookie は `Secure` 属性付きで設定されている。

適合 UA に**拒否される**例（`Secure` が無い）:

```
Set-Cookie: __Secure-SID=12345; Domain=site.example
```

secure origin（例 `https://site.example/`）から設定されれば**受理**され、それ以外では拒否される例:

```
Set-Cookie: __Secure-SID=12345; Domain=site.example; Secure
```

**`__Host-` プレフィックス**: 名前が case-sensitive に `__Host-` に一致するなら、その Cookie は **`Secure` 属性付き・`Path=/`・`Domain` 属性なし**で設定されている。

- 逐語訳の解説: 「この組み合わせは、**オリジンをセキュリティ境界として扱うことに Cookie として可能な限り近づいた** Cookie を生む。**`Domain` 属性が無いことで `host-only-flag` が true になり、Cookie が特定のホストに固定され、サブドメインにまたがらない**。**`Path` を `/` にすることで Cookie がホスト全体で有効になり、特定パスで上書きされない**。**`Secure` 属性は、Cookie が非セキュアなオリジンによって改変されず、プロトコルをまたがないことを保証する**。」
- 「**ポートだけは `__Host-` Cookie が依然として無視するオリジンモデルの要素**である。」

常に拒否される例（原文のまま逐語）:

```
Set-Cookie: __Host-SID=12345
Set-Cookie: __Host-SID=12345; Secure
Set-Cookie: __Host-SID=12345; Domain=site.example
Set-Cookie: __Host-SID=12345; Domain=site.example; Path=/
Set-Cookie: __Host-SID=12345; Secure; Domain=site.example; Path=/
```

secure origin から設定されれば受理される例:

```
Set-Cookie: __Host-SID=12345; Secure; Path=/
```

#### 9.5 UA 向けのプレフィックス規定（大文字小文字の落とし穴）

- **UA はプレフィックス文字列を case-insensitive にマッチしなければならない (MUST)**。サーバ側が Cookie を case-insensitive に処理することがあり、**誤った大文字小文字のプレフィックスを意図せず受理してしまう**ため。
- 例（逐語）: サーバが次を送り、UA が case-sensitive に判定すると、UA はこれを受理してしまい、サーバは `__Secure-` と同じ保証があると**誤って信じる**:

```
Set-Cookie: __SECURE-SID=12345
```

- さらに、**攻撃者が意図的に大文字小文字を崩してプレフィックス付き Cookie になりすます**攻撃にサーバは脆弱になる。例: サイトが既に `__Secure-SID=12345` を持つとき、攻撃者が何らかの手段で次の `Set-Cookie` を（case-sensitive 判定の UA に）送らせる:

```
Set-Cookie: __SeCuRe-SID=evil
```

次回訪問時、UA は**両方の Cookie を送る**:

```
Cookie: __Secure-SID=12345; __SeCuRe-SID=evil
```

- サーバが case-insensitive なので**両者を区別できず、攻撃者はサイトを侵害できる**。これを防ぐため UA は **MUST** で case-insensitive にマッチする。
- 注: 名前が異なる Cookie は UA にとって別物なので、**`__Secure-foo=bar` と `__secure-foo=baz` は同時に別の Cookie として存在でき、どちらにも `__Secure-` プレフィックスの要件が適用される**。

適合 UA に**拒否される** `Set-Cookie` の例（原文のまま逐語）:

```
Set-Cookie: __Secure-SID=12345; Domain=site.example
Set-Cookie: __secure-SID=12345; Domain=site.example
Set-Cookie: __SECURE-SID=12345; Domain=site.example
Set-Cookie: __Host-SID=12345
Set-Cookie: __host-SID=12345; Secure
Set-Cookie: __host-SID=12345; Domain=site.example
Set-Cookie: __HOST-SID=12345; Domain=site.example; Path=/
Set-Cookie: __Host-SID=12345; Secure; Domain=site.example; Path=/
Set-Cookie: __host-SID=12345; Secure; Domain=site.example; Path=/
Set-Cookie: __HOST-SID=12345; Secure; Domain=site.example; Path=/
```

secure origin から設定されれば**受理される**例:

```
Set-Cookie: __Secure-SID=12345; Domain=site.example; Secure
Set-Cookie: __secure-SID=12345; Domain=site.example; Secure
Set-Cookie: __SECURE-SID=12345; Domain=site.example; Secure
Set-Cookie: __Host-SID=12345; Secure; Path=/
Set-Cookie: __host-SID=12345; Secure; Path=/
Set-Cookie: __HOST-SID=12345; Secure; Path=/
```

#### 9.6 Cookie の寿命上限（400 日）

- 「When processing cookies with a specified lifetime, either with the Expires or with the Max-Age attribute, the user agent **MUST limit the maximum age of the cookie**. The limit **SHOULD NOT be greater than 400 days (34560000 seconds)** in the future. The RECOMMENDED limit is 400 days in the future, but the user agent MAY adjust the limit. **Expires or Max-Age attributes that specify a lifetime longer than the limit MUST be reduced to the limit.**」

#### 9.7 SameSite 属性の UA 処理と 2 つの強制モード

**属性の解析（逐語訳の手順）**:
1. `enforcement` を "Default" とする。
2. 属性値が **case-insensitive** に "None" に一致すれば `enforcement` を "None" にする。
3. "Strict" に一致すれば "Strict"。
4. "Lax" に一致すれば "Lax"。
5. cookie-attribute-list に attribute-name "SameSite"、attribute-value `enforcement` の属性を追加する。

**"Strict" と "Lax" の強制（逐語の要点）**:
- "Strict" の same-site Cookie は、**クロスサイトの文書コンテキストからトリガーされたトップレベルナビゲーションでは送られない**。既存のセッション管理システムと互換かどうかは場合による。
- CSRF リスクを緩和する**ドロップイン機構**として、開発者は "Lax" モードを設定できる。これは「**トップレベルナビゲーションであり、かつ HTTP メソッドが（RFC9110 の意味で）"safe" である場合に限り**、クロスサイトリクエストでも same-site Cookie を送る」例外を切り出す。
  - 注（重要）: 「**リダイレクトによってリクエストのメソッドが POST から GET に変わり得る**（RFC9110 の 15.4.2, 15.4.3 節）。その場合、リクエストの "safe" 性は**現在のリダイレクトホップのメソッド**に基づいて決定される。」
- **Lax は "unsafe" HTTP メソッド（`POST` 等）に依拠する CSRF に対して合理的な多層防御を提供するが、CSRF というカテゴリ全般に対する堅牢な防御ではない**:
  1. 「攻撃者は依然として**新しいウィンドウをポップアップしたり、トップレベルナビゲーションをトリガーして "same-site" リクエストを作れる**。これは搾取への道のりの**speedbump（減速帯）に過ぎない**。」
  2. 「**`<link rel='prerender'>`** のような機能は、**ユーザーに気づかれるリスクなく** "same-site" リクエストを作るのに悪用され得る。」
- 開発者は Top-level Navigations の節で述べるような**セッション管理機構によって CSRF をより完全に緩和できる**。

**"Lax-Allowing-Unsafe" 強制（Lax+POST 2 分猶予の規範的記述、逐語の要点）**:
- 互換性の懸念から、「**トップレベルリクエストであれば、リクエストメソッドに関わらず**クロスサイト HTTP リクエストで Cookie を送ることを許す」"Lax-allowing-unsafe" 強制モードが必要になり得る。つまり、取得アルゴリズムの `SameSite` 強制ステップにおいて、**HTTP リクエストのメソッドが "safe" であるという要件を免除する**。（`SameSite` 強制モードに関わらず、**すべての Cookie はトップレベルナビゲーションではメソッドに関わらず設定され得る**。）
- 「**"Lax-allowing-unsafe" は `SameSite` 属性の独立した値ではない**。むしろ UA は、**`SameSite` 属性を明示しなかった Cookie（same-site-flag が既定で "Default" になったもの）にのみ** "Lax-allowing-unsafe" 強制を適用してよい (MAY)。この互換モードのスコープを限定するため、"Lax-allowing-unsafe" を適用する UA は**最近作られた Cookie に限定すべき (SHOULD)**。**Deployment experience has shown a cookie age of 2 minutes or less to be a reasonable limit.**（デプロイ経験から、**2 分以下の Cookie 年齢**が妥当な上限であることが示されている）」
- UA が "Lax-allowing-unsafe" を使う場合、取得アルゴリズムに次の修正を適用しなければならない (MUST)。取得アルゴリズムのステップ 1 の最後から 2 番目の箇条書きの条件（原文のまま逐語）:

```
     * The HTTP request associated with the retrieval uses a "safe"
       method.
```

を次に置き換える（原文のまま逐語）:

```
     * At least one of the following is true:

       1.  The HTTP request associated with the retrieval uses a "safe"
           method.

       2.  The cookie's same-site-flag is "Default" and the amount of
           time elapsed since the cookie's creation-time is at most a
           duration of the user agent's choosing.
```

#### 9.8 保存モデル（storage model）の関連ステップ（逐語訳、番号は原文どおり）

- **16.** Cookie の `secure-only-flag` が false で、request-uri が "secure" 接続を示さない場合、**次のすべてを満たす Cookie が cookie store にあるならアルゴリズムを中止して Cookie 全体を無視する**:
  1. 名前が新しく作られる Cookie の名前と一致する。
  2. `secure-only-flag` が true である。
  3. その domain が新しい Cookie の domain と domain-match する（またはその逆）。
  4. 新しい Cookie の path が既存 Cookie の path と path-match する。
  - 注（逐語訳）: 「**path の比較は対称的ではなく**、新しく作られた**非セキュア Cookie が既存のセキュア Cookie を上塗りしないことだけを保証**し、**cookie-fixing 攻撃に対する一定の緩和**を提供する。すなわち、path `/login` の既存のセキュア Cookie `a` に対して、非セキュアな Cookie `a` は **path `/` や `/foo` には設定できるが、`/login` や `/login/en` には設定できない**。」
- **17.** cookie-attribute-list に attribute-name "SameSite" があり値が "Strict"/"Lax"/"None" のいずれかなら、**リスト中の最後の "SameSite" 属性の値**を same-site-flag に設定する。そうでなければ same-site-flag を "**Default**" にする。
- **18.** Cookie の `same-site-flag` が "None" でない場合:
  1. Cookie が "**non-HTTP" API から受け取られ**、その API が「site for cookies」が top-level origin と same-site でないナビゲーブルの active document から呼ばれたなら、**アルゴリズムを中止して新規 Cookie を完全に無視する**。
  2. Cookie が "same-site" リクエストから受け取られたなら、残りのサブステップを飛ばして処理を続行する。
  3. Cookie が **top-level traversable をナビゲートしているリクエスト**から受け取られたなら、残りを飛ばして処理を続行する。
     - 注（逐語訳）: 「**トップレベルナビゲーションは、たとえその新しい Cookie が既に存在していたとしてもそのリクエストでは送られなかったであろう場合でも、任意の `SameSite` 値で Cookie を作成できる**。」
  4. アルゴリズムを中止して新規 Cookie を完全に無視する。
- **19.** Cookie の `same-site-flag` が "None" なら、**`secure-only-flag` が true でない限り**アルゴリズムを中止して Cookie を完全に無視する。（= `SameSite=None` には `Secure` 必須の規範根拠）
- **20.** cookie-name が **case-insensitive** に `__Secure-` に一致して始まるなら、**`secure-only-flag` が true でない限り**無視する。
- **21.** cookie-name が case-insensitive に `__Host-` に一致して始まるなら、**次のすべてを満たさない限り**無視する: (1) `secure-only-flag` が true、(2) `host-only-flag` が true、(3) cookie-attribute-list に "Path" 属性があり、Cookie の path が `/`。
- **22.** cookie-name が空で、かつ cookie-value が case-insensitive に `__Secure-` または `__Host-` に一致して始まる場合、アルゴリズムを中止して Cookie を完全に無視する。
- **23.** 同じ name・domain・host-only-flag・path の Cookie が既にあれば、それを old-cookie とし、（2）**新規 Cookie が "non-HTTP" API 由来で old-cookie の `http-only-flag` が true なら中止して無視**する（= `HttpOnly` Cookie を JS から上書きできない根拠）。

#### 9.9 取得アルゴリズム（原文のまま逐語、cookie-list の条件とソート）

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

- 注（"secure" の定義、逐語訳）: 「"secure" 接続の概念は本文書では定義しない。典型的には UA は、接続が **SSL/TLS のようなトランスポート層セキュリティ**を使う場合、またはホストが**信頼されている**場合に secure とみなす。例えばほとんどの UA は "**https**" をセキュアなプロトコルを示す scheme とみなし、"**localhost**" を信頼されたホストとみなす。」
- **ソート順（SHOULD）**: (1) **path が長い Cookie を短い Cookie より先に**並べる。(2) path の長さが等しい Cookie 同士では、**creation-time が早いものを先に**並べる。
  - 注: すべての UA がこの順でソートするわけではないが、これは文書作成時点の一般的な実装を反映しており、歴史的に**この順序に（誤って）依存するサーバが存在した**。
- シリアライズ: 名前が空でなければ名前 + `=`、値が空でなければ値、最後の Cookie でなければ `%x3B %x20`（`"; "`）を出力。

#### 9.10 実装上の上限（Limits）

- 一般用途の UA は**最低限**次を提供すべき (SHOULD): 「**At least 50 cookies per domain.**」「**At least 3000 cookies total.**」
- UA は保存する Cookie の最大数を制限してよく (MAY)、**いつでも任意の Cookie を evict してよい**。
- サーバは、実装上限に達しないよう、Cookie ヘッダが全リクエストに含まれる帯域を最小化するため、**可能な限り少なく小さい Cookie を使うべき (SHOULD)**。
- サーバは、UA が Cookie を返さない場合でも**優雅に劣化すべき (SHOULD)**。UA はいつでも任意の Cookie を evict し得る。

#### 9.11 Privacy Considerations: サードパーティ Cookie（逐語訳）

- 「"third-party" または cross-site Cookie とは、**主リソース（通常はユーザーが見ている Web ページ）をホストするサーバとは別のサーバから取得された埋め込みコンテンツ（スクリプト、画像、スタイルシート、フレーム）に関連付けられた Cookie**である。サードパーティ Cookie は**異なるサイト上のユーザー活動を相関させる**のにしばしば使われる。」
- 「本質的なプライバシー問題のため、**ほとんどの UA は今ではさまざまな方法でサードパーティ Cookie を制限している**。あるものは**サードパーティの `Set-Cookie` を処理せず、サードパーティの `Cookie` ヘッダを送らないことで完全にブロック**する。あるものは **first-party コンテキストに基づいて Cookie をパーティション化**し、閲覧中のサイトに応じて異なる Cookie が送られるようにする。あるものは UA の cookie policy やユーザーコントロールに基づいてブロックする。」
- 「本文書は特定のアプローチを推奨/要求しないが、UA は**互換性の制約が許す限り制限的なポリシー**を採用することが RECOMMENDED である。したがって、**リソースは、当面 UA 間でサードパーティ Cookie が一貫して扱われることに依拠できない**。」
- **Cookie Policy**: UA は cookie policy を強制してよい (MAY)。ポリシーは、どのドメイン/パーティ（first / third）に Cookie アクセスを許すかを統制し得る。**Cookie のサイズ、失効（寿命上限）、ドメイン当たり/全体の Cookie 数の上限**も定義できる。**推奨される失効上限は 400 日**。

#### 9.12 Security Considerations: Weak Confidentiality（ポート・scheme・path の分離が無い）

（逐語訳、cookie tossing/cookie fixing の根拠となる節）

- 「**Cookie はポートによる分離を提供しない**。あるポートで動くサービスから読める Cookie は、**同じサーバの別のポート**で動くサービスからも読める。あるポートのサービスから書ける Cookie は別のポートからも書ける。このため、サーバは**同一ホストの異なるポートで相互に信頼しないサービスを動かしつつ、Cookie にセキュリティ上重要な情報を保存すべきではない (SHOULD NOT)**。」
- 「**Cookie は scheme による分離を提供しない**。最も一般的には http と https で使われるが、あるホストの Cookie は **ftp や gopher のような他の scheme でも利用可能**かもしれない。この scheme 分離の欠如は、Cookie へのアクセスを許す非 HTTP API（HTML の `document.cookie` API など）で最も顕著だが、実際には **Cookie 自体の処理要件にも存在**する。」
- 「**Cookie は path による分離を常に提供するわけではない**。ネットワークレベルのプロトコルはある path に保存された Cookie を別の path に送らないが、**一部の UA は非 HTTP API（HTML の `document.cookie` API など）経由で Cookie を露出する**。これらの UA（例: Web ブラウザ）は**異なる path から受け取ったリソースを分離しない**ため、**ある path から取得したリソースが別の path に保存された Cookie にアクセスできる**可能性がある。」

#### 9.13 Security Considerations: Weak Integrity（= cookie tossing の規範的記述）

（逐語訳）

- 「**Cookie は兄弟ドメイン（およびそのサブドメイン）に対する完全性保証を提供しない**。例えば `foo.site.example` と `bar.site.example` を考える。**`foo.site.example` サーバは `Domain=site.example` の Cookie を設定でき（`bar.site.example` が設定した既存の `site.example` Cookie を上書きする可能性がある）**、UA はその Cookie を `bar.site.example` への HTTP リクエストに含める。**最悪の場合、`bar.site.example` はこの Cookie を自分が設定した Cookie と区別できない**。`foo.site.example` サーバはこの能力を利用して `bar.site.example` に対する攻撃を仕掛けられるかもしれない。」
- 「`Set-Cookie` ヘッダは `Path` 属性をサポートするが、**`Path` 属性は完全性保護を一切提供しない**。UA は `Set-Cookie` 中の**任意の `Path` 属性を受け入れる**ためである。例えば `http://site.example/foo/bar` へのリクエストへの HTTP レスポンスは、**`Path=/qux` の Cookie を設定できる**。したがってサーバは、**同一ホストの異なるパスで相互に信頼しないサービスを動かしつつ Cookie にセキュリティ上重要な情報を保存すべきではない (SHOULD NOT)**。」
- 「**能動的なネットワーク攻撃者**は、`http://site.example/` からのレスポンスになりすまして `Set-Cookie` ヘッダを注入することで、**`https://site.example/` に送られる `Cookie` ヘッダに Cookie を注入**できる。site.example の HTTPS サーバは**これらの Cookie を自分が HTTPS レスポンスで設定した Cookie と区別できない**。site.example が HTTPS を排他的に使っていても、攻撃者はこの能力を利用して攻撃を仕掛けられるかもしれない。」
- 「サーバは **Cookie の内容を暗号化・署名する**か、**Cookie を `__Secure-` プレフィックスで命名する**ことで、これらの攻撃を部分的に緩和できる。**しかし暗号の使用は問題を完全には緩和しない**。攻撃者が正規の site.example サーバから受け取った Cookie を**ユーザーのセッションでリプレイでき、予測不能な結果を生む**からである。」
- 「最後に、攻撃者は**大量の Cookie を保存させることで UA に Cookie を削除させられる**かもしれない。UA が保存上限に達すると、**いくつかの Cookie を evict せざるを得なくなる**。サーバは **UA が Cookie を保持することに依拠すべきではない (SHOULD NOT)**。」
- **Reliance on DNS**: 「Cookie はセキュリティのために DNS に依拠している。**DNS が部分的または完全に侵害されると**、Cookie プロトコルはアプリケーションが要求するセキュリティ特性を提供できなくなり得る。」

〔補足（一般知識）〕上記 Weak Integrity の 1 つ目・2 つ目のパターンが、実務で「**cookie tossing**」（兄弟サブドメインや任意 path から Cookie を"投げ込み"、被害ホスト側で自分の Cookie と区別させない）、「**cookie fixing / session fixation 系**」と呼ばれる手口である。RFC6265bis 自体はこの俗称を使わず「Weak Integrity」「cookie-fixing attacks」（保存モデル step 16 の注）という語を用いる。

#### 9.14 Security Considerations: SameSite Cookies（CSRF との関係）

**Defense in depth（逐語訳）**
- 「"SameSite" Cookie は、**strict モードで配備され、クライアントがサポートしている場合、CSRF 攻撃に対する堅牢な防御**を提供する。しかし、**この指定をサイトの CSRF 防御の限界としないのが賢明**である。**same-site のナビゲーションや送信は、XSS やページリダイレクトの悪用といった他の攻撃ベクタと組み合わせて実行され得る**からである。」
- 「**リクエストがいつ same-site とみなされるかを理解することも重要**である。例えば、機密ページへの**クロスサイトのトップレベルリクエストはクロスサイトとみなされ `SameSite=Strict` Cookie は送られない**が、**そのページのサブリソースリクエストは same-site であり `SameSite=Strict` Cookie を受け取る**。サイトは、**初回のページリクエストが適切な Cookie を含まない場合にエラーを返す**ことで、これらのサブリソースへのアクセスを不注意に許してしまうのを避けられる。」
- 「開発者は、**通常のサーバ側防御（CSRF トークン、"safe" HTTP メソッドが冪等であることの保証など）を配備してリスクをより完全に緩和する**ことを強く推奨される。」
- 加えて、アプリ分離（app-isolation）で述べるような**クライアント側技術も CSRF に有効であり得る**ため、"SameSite" Cookie と組み合わせて検討する価値がある。

**Top-level Navigations（2 つの Cookie によるセッション管理、逐語訳）**
- `SameSite` を "strict" にすると CSRF に対する堅牢な多層防御になるが、**セッション管理がトップレベルナビゲーションを適切に扱わないとユーザーを混乱させる**恐れがある。
- シナリオ: ユーザーが MegaCorp Inc の webmail `https://site.example/` でメールを読み、メール中のリンク `https://projects.example/secret/project` をクリックする。閲覧権限があるので秘密プロジェクトが見えると期待するが、`https://projects.example` がセッション Cookie を `SameSite=Strict` にしていると、**このクロスサイトナビゲーションでは Cookie が送られない**。`https://projects.example` は秘密情報の漏洩を避けるため **404 エラーを描画**し、ユーザーは非常に混乱する。
- 回避策（逐語訳）: 「開発者は **1 つではなく 2 つの Cookie に依拠するセッション管理システム**を採用することでこの混乱を避けられる。**概念的に "read" アクセスを与える Cookie と、"write" アクセスを与える Cookie**。後者を **`SameSite=Strict`** にし、**それが無い場合は非冪等なアクションの実行前に再認証を促す**。前者は **`SameSite=Lax`** にしてトップレベルナビゲーション経由のデータ閲覧を許すか、**`SameSite=None`** にしてすべてのコンテキスト（クロスサイト埋め込みを含む）でのアクセスを許す。」

**Mashups and Widgets（逐語訳）**
- 「`Lax` と `Strict` は一部の重要なユースケースに**不適切**である。特に、**クロスサイトコンテキストへの埋め込みを意図したコンテンツ（ソーシャルネットワーキングウィジェットやコメントサービスなど）は same-site Cookie にアクセスできない**。こうした状況で必要な Cookie は **`SameSite=None`** でマークしてクロスサイトコンテキストでのアクセスを許すべき。」
- 「同様に、**一部の形態のシングルサインオン (SSO)** はクロスサイトコンテキストでの Cookie ベース認証を必要とし、same-site Cookie では意図通り機能せず **`SameSite=None` が必要**になる。」

**Server-controlled（逐語訳）**
- 「SameSite Cookie それ自体は RFC6265 7.1 節で述べた一般的なプライバシー懸念には**何も対処しない**。`SameSite` 属性は**サーバが設定**し、サーバが懸念する特定種類の攻撃のリスクを緩和するためのものである。**この決定にユーザーは関与しない**。さらに、**Cookie が無くてもサーバが別個のリクエストを紐付けられる side-channel が複数存在する**（例: same-site と cross-site リクエスト間のコネクション/ソケットプーリング）。」

**Reload navigations（逐語訳）**
- 「**UI 要素（ツールバーの更新ボタン等）によるリロード**のために発行されるリクエストは、**リロードされる文書が元々 same-site リクエストでナビゲートされていた場合にのみ same-site** である。これは他のリロードナビゲーションの扱いと異なる（後者はトップレベルであれば常に same-site。ソースナビゲーブルの active document がまさにリロードされる文書だから）。」
- 「この特別扱いは、**元のナビゲーションで withheld された `SameSite` Cookie を、ユーザー起点のリロードで送ってしまうことを避ける**ためである。リロードを same-site とみなして最初に withheld した Cookie をすべて送ると、**そもそも withhold したセキュリティ上の利益が無効化される**。クロスサイトナビゲーションで `SameSite` Cookie が無いことにより**目に見えるサイト破損**が起き、ユーザーがリロードを促されることがあるので、これは特に重要である。」
- 例（逐語訳）: ユーザーが `https://attacker.example/` から `https://victim.example/` へのリンクをクリック。これはクロスサイトリクエストなので `SameSite=Strict` Cookie は withheld される。`https://victim.example/` が壊れて見える（特定の `SameSite` Cookie がリクエストに含まれるときだけ機密コンテンツを表示するため）。ユーザーは苛立ってツールバーの更新を押す。**このリロードを same-site とみなして最初に withheld した Cookie を送ると、リロードナビゲーションが元の（潜在的に悪意ある）リクエストをリプレイし得るため、withhold の目的が損なわれる**。したがってリロードリクエストは、最初にページへナビゲートしたリクエストと同様に**クロスサイトとみなすべき**である。
- 「**ユーザー起点でないリロード**のために発行されるリクエストは**すべての SameSite Cookie を添付する**ため、開発者は **CSRF 攻撃を避けるためにいつリロードを開始するか慎重かつ思慮深くあるべき**。例えば、**初回リクエストに CSRF トークンがある場合にのみリロードを開始する**ようにできる。」

**Top-level requests with "unsafe" methods（Lax+POST が必要になる理由、逐語訳）**
- 「"Lax" 強制モードは、**トップレベルナビゲーションかつ "safe" HTTP メソッドである場合に限り**クロスサイト HTTP リクエストで Cookie を送ることを許す。実装経験は、**これを既定動作として適用するのは難しい**ことを示している。一部のサイトは、**`SameSite` 属性を明示しない Cookie が、"unsafe" HTTP メソッドのトップレベルクロスサイトリクエストに含まれること**に依存している（`SameSite` 属性導入前はそうだった）からである。」
- 「例えば、**ログインフローの最終ステップがクロスサイトのトップレベル `POST` リクエスト**でエンドポイントに送られることがあり、このエンドポイントは**ログインを安全に完了するために必要なトランザクション状態情報を含む、最近作られた Cookie を期待する**。そのような Cookie に対して "Lax" 強制は不適切で、**unsafe な HTTP メソッドのために Cookie が除外され、ログインフロー全体が回復不能に失敗する**ことになる。」
- 「"Lax-allowing-unsafe" 強制モードは、（"None" と比べて）**"Lax" 強制の保護の一部を保ちながら、最近作られた Cookie が unsafe なトップレベルリクエストでクロスサイトに送られることを許す**。」
- 「"Lax" のより寛容な変種として、"Lax-allowing-unsafe" は**必然的に CSRF に対する保護が少ない**。最終的に、こうした強制モードの提供は、**"Lax" 既定の採用を容易にするための一時的・過渡的措置**とみなすべきである。」

**Public Suffix List（逐語訳）**
- 「Cookie の境界はサイトの "**registrable domain**" に依存し、それはドメインの public suffix に依存する。可能な限り、UA は **Mozilla プロジェクトが維持するような最新の public suffix list を使うべき (SHOULD)**。**そうしないと、悪意ある/機密な Cookie が registrable domain 間で漏洩し得る**。」

### 10. Chromium 実装で確認した Lax+POST の猶予時間（出典: https://raw.githubusercontent.com/chromium/chromium/main/net/cookies/cookie_constants.h と .cc）

`net/cookies/cookie_constants.h`（原文のまま逐語）:

```cpp
// The time threshold for considering a cookie "short-lived" for the purposes of
// allowing unsafe methods for unspecified-SameSite cookies defaulted into Lax.
NET_EXPORT extern const base::TimeDelta kLaxAllowUnsafeMaxAge;
// The short version of the above time threshold, to be used for tests.
NET_EXPORT extern const base::TimeDelta kShortLaxAllowUnsafeMaxAge;
```

`net/cookies/cookie_constants.cc`（原文のまま逐語）:

```cpp
const base::TimeDelta kLaxAllowUnsafeMaxAge = base::Minutes(2);
const base::TimeDelta kShortLaxAllowUnsafeMaxAge = base::Seconds(10);
```

- すなわち、Chromium における「Lax+POST 例外」の閾値は **2 分**（テスト用の短縮版は 10 秒）。RFC6265bis の「2 minutes or less を妥当な上限」という記述、MDN の「set no more than two minutes before the request」という記述と一致する。

### 11. 診断・脆弱性ハンティングの観点（許可された検証/バグバウンティ前提。上記各出典の記述から導かれる確認項目）

〔補足（一般知識）〕以下は上記一次資料の規範的記述から導かれる検査項目の整理であり、資料に直接の「チェックリスト」として書かれているものではない（各項目の根拠節を併記する）。

| 確認項目 | 期待される安全な状態 | 根拠 |
| --- | --- | --- |
| セッション Cookie の `SameSite` | 明示的に `Strict`（またはトップレベル遷移が必要なら read/write 二重 Cookie 構成） | §4、§9.14 Top-level Navigations |
| `SameSite` 未指定の Cookie | 存在しない（既定 Lax 依存はブラウザ差・Lax-allowing-unsafe の穴を残す） | §5.1、§5.2、§9.7 |
| 状態変更エンドポイントの CSRF 対策 | `SameSite` に加えて CSRF トークン等のサーバ側防御 | §9.14 Defense in depth |
| **作成から 2 分以内**の `SameSite` 未指定 Cookie を使うクロスサイト POST 経路 | 存在しない（Lax+POST 例外で CSRF が成立し得る） | §5.2、§9.7、§10 |
| `SameSite=None` の Cookie | 必ず `Secure` 付き。かつ本当にサードパーティ用途か | §5.3、§9.8 step 19 |
| セッション Cookie の `HttpOnly` | 付与（XSS での窃取を緩和。ただし JS 起点リクエストには送られる点に注意） | §8.2、§9.2 |
| `Secure` | HTTPS サイトのすべての機密 Cookie に付与（`http:` からの上書きを防ぐ） | §8.2、§9.13 |
| `Domain` 属性の広さ | 必要以上に広い `Domain=example.com` にしない（サブドメインからの読み取り・上書きを招く） | §8.2、§9.2、§9.13 |
| プレフィックス | ホスト固定が必要な Cookie は `__Host-`（`Secure; Path=/`、`Domain` 無し）、少なくとも `__Secure-` | §8.3、§9.4、§9.13 |
| `Path` による分離に依拠していないか | 依拠しない（`Path` は完全性もアクセス制御も提供しない） | §8.2 NOTE、§9.2、§9.12、§9.13 |
| サブドメイン/兄弟ホストの信頼境界 | 相互に信頼しないサービスを同一 site の別サブドメイン/別ポート/別パスに置いて Cookie に機密を持たせない（cookie tossing） | §9.12、§9.13 |
| cross-scheme（http/https 混在）経路 | 完全 HTTPS 化 + HSTS `includeSubDomain` | §7、§7.5 |
| リロードで Cookie が復活する設計 | ユーザー起点でないリロードは全 SameSite Cookie を添付するため、CSRF トークン確認後にのみリロードを開始 | §9.14 Reload navigations |
| Cookie に機密（サーバ側の秘密）を保存していないか | 保存しない。Cookie はユーザー入力として検証・サニタイズ | §4.3 caution |
| Cookie 数・サイズ | 少なく小さく（evict による消失、ヘッダ上限、TTFB 悪化） | §1、§9.10、§9.13 最終段 |
| 寿命 | 400 日上限に丸められる前提で設計 | §9.6 |

## 読者が自分で開くべき資料

### (A) https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6 ← **取得失敗**

- **なぜ取得できなかったか**: この環境の egress プロキシが `medium.com` を全面ブロックしている（WebFetch は `EGRESS_BLOCKED`、`curl` は `CONNECT tunnel failed, response 403`）。`web.archive.org` も同様に `connect_rejected (403)` で使えず、WebSearch も本セッションの検索予算（200/200）を使い切っており代替記事の探索もできなかった。加えて Medium は無料閲覧数制限（メータードペイウォール）が掛かる場合があり、読者側でもログインを要求されることがある。
- **読者が自分で開いたときに読むべきどころ（3〜6 項目）**:
  1. `Set-Cookie` の**各属性の書式と最小例**（`Secure`、`HttpOnly`、`SameSite`、`Domain`、`Path`、`Expires`、`Max-Age`）— 本ノート §8 の MDN 版と食い違いがないか照合する。特に `Expires` の日付フォーマットと `Max-Age` の優先順位。
  2. **`HttpOnly` が何を防ぎ何を防がないか**（`document.cookie` からは隠れるが、JS 起点の `fetch`/XHR には**送信される**）の説明部分。
  3. **`Secure` の限界**（クライアント端末上のディスクアクセスや、`HttpOnly` 無しの場合の JS 読み取りは防げない／`http:` からは設定できない／localhost 例外）。
  4. **`SameSite` の 3 値の具体例とブラウザ既定値の変遷**（Chrome 80 で予告 → 84 で既定化）に関する記述。年号・バージョン番号を本ノート §5 と突き合わせ、古い記述（例: 「Chrome 80 から既定」）に注意する。
  5. 記事末尾にあることが多い**実装言語ごとのスニペット**（Express/Django/PHP 等の `set_cookie` オプション名）。フレームワーク側の既定値が `SameSite` を付けるかどうかは診断上重要。
  6. 記事の**公開日と最終更新日**。Cookie 周りは 2020 年（Chrome 84）、2023 年（`Partitioned`/CHIPS）、その後のサードパーティ Cookie 廃止方針の変遷で記述が急速に古くなるため、**MDN と RFC 6265bis で必ず裏を取る**。
- **到達手段の候補**: ブラウザで直接開く（必要ならログイン）／Medium アプリ／同著者が他ホストに再掲していないか確認／代替として MDN `Set-Cookie`（本ノート §8 の出典）と RFC 6265bis（§9）を読めば内容はほぼ完全にカバーできる。

### (B) https://web.dev/articles/samesite-cookies-explained ← 本文は原稿から full 取得済みだが、**公開ページ固有の要素**は未取得

- **なぜ直アクセスできなかったか**: egress プロキシが `web.dev`（および `developer.chrome.com`）をブロックしているため。本文は GitHub 上の記事原稿（`GoogleChrome/web.dev`）から逐語取得した。
- **読者が自分で開いたときに読むべきどころ**:
  1. **図版 4 点**（`Set-Cookie` で Cookie が送られる図、`Cookie` ヘッダで返る図、1 ページ内の複数ドメインから来る Cookie の図、`None`/`Lax`/`Strict` のラベル付き Cookie 図）。属性の意味を図で押さえると理解が速い。
  2. ページ上部のシリーズナビ 3 本のリンク先: **Understanding cookies**、**SameSite cookie recipes**、**Schemeful Same-Site**（本ノートでは §1・§2、§6、§7 として内容を収録済み）。
  3. 「**Changes to the default behavior without SameSite**」節に貼られた外部リンク（Incrementally Better Cookies ドラフト、blink-dev アナウンス、Chromium の incompatible clients 一覧）。バージョン番号と日付が一次情報。
  4. 記事の**更新日（2023-03-20）以降の変化**。`Partitioned`/CHIPS やサードパーティ Cookie 廃止の進捗はこの記事には含まれないので、MDN の `Set-Cookie`（`Partitioned` 属性）と Privacy Sandbox のドキュメントで補う。
  5. 原稿にしか無い/公開ページにしか無い差分（Eleventy ショートコード `{% Aside %}`、`{% Compare %}` のレンダリング結果）。**Compare ブロック（worse/better）の対比**は暗記価値が高い（本ノート §5.1・§5.3 に逐語収録済み）。

### (C) 追加で読む価値が高い一次資料（本ノートで参照した URL）

1. **RFC 6265bis ドラフト**（HTTP WG）: `https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/`（原稿は `https://github.com/httpwg/http-extensions`）。読みどころ: 4.1.2 各属性のセマンティクス、5.2 「same-site」判定と site for cookies、5.4 プレフィックス、5.6 保存モデル step 16〜23、5.8 取得アルゴリズム、8.6 Weak Confidentiality、8.7 Weak Integrity、8.8 SameSite Cookies。
2. **MDN `Set-Cookie`**: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie`。読みどころ: 属性表、Cookie prefixes（`__Secure-`/`__Host-`/`__Http-`/`__Host-Http-`）、Browser compatibility（既定 SameSite の実装差）、Partitioned/CHIPS。
3. **Chromium SameSite updates**: `https://www.chromium.org/updates/same-site` と FAQ `https://www.chromium.org/updates/same-site/faq`、非互換クライアント `https://www.chromium.org/updates/same-site/incompatible-clients`。読みどころ: Lax+POST 緩和の正確な適用条件、DevTools の警告文言。
4. **Chromium ソース** `net/cookies/cookie_constants.{h,cc}`、`net/cookies/canonical_cookie.cc`。読みどころ: `kLaxAllowUnsafeMaxAge`（2 分）、プレフィックス検証、`SameSite` 既定値の実装。
5. **publicsuffix.org**: `https://publicsuffix.org/`。読みどころ: registrable domain の決定規則（`github.io` 等のプライベートセクション）。
6. **GoogleChromeLabs/samesite-examples**: `https://github.com/GoogleChromeLabs/samesite-examples`。読みどころ: 言語・フレームワーク別に `SameSite=None` を設定する方法。
7. **OWASP CSRF Prevention Cheat Sheet**: `https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html`（web.dev recipes 記事からリンクされている）。読みどころ: SameSite と併用すべきトークンパターン。

## 用語集（本ノートで使用した用語）

| 用語 | 定義（出典付き） |
| --- | --- |
| site（サイト） | ドメインサフィックスとその直前のドメイン部分の組み合わせ。`www.web.dev` は `web.dev` サイトの一部（web.dev / §3）。Schemeful Same-Site 以降は **scheme + 登録可能ドメイン**（§7） |
| same-site / cross-site | リクエストの current url のオリジンが client の「site for cookies」と same-site なら same-site、そうでなければ cross-site（RFC6265bis / §9.3） |
| site for cookies | 文書の場合は top-level origin（ただし全祖先文書が top-level origin と same-site である場合に限る。さもなくば opaque origin）（RFC6265bis / §9.3） |
| first-party cookie | アドレスバーに表示されているサイトのドメインに一致する Cookie。**相対的なラベル**（web.dev / §2） |
| third-party cookie | 現在のサイト以外のドメインの Cookie。別サーバの埋め込みコンテンツに関連付けられた Cookie（web.dev / §2、RFC6265bis / §9.11） |
| `SameSite=Strict` | same-site リクエストのみで送信。クロスサイトのトップレベルナビゲーションでも送られない（§4.1、§9.2） |
| `SameSite=Lax` | same-site ＋「トップレベルナビゲーションかつ safe メソッド」のクロスサイトリクエストで送信（§4.2、§8.2、§9.7） |
| `SameSite=None` | same-site と cross-site 双方で送信。**`Secure` 必須**（§4.4、§5.3、§9.8 step 19） |
| Default（same-site-flag） | `SameSite` 属性を明示しなかった状態。既定強制は `Lax` 相当、UA が Lax-allowing-unsafe を使う場合はそれ相当（§9.2、§9.7、§9.8 step 17） |
| Lax-allowing-unsafe（Lax+POST） | `SameSite` 未指定かつ**最近作成（Chromium は 2 分以内）**の Cookie を、メソッドに関わらずトップレベルのクロスサイトリクエストで送る互換モード。`SameSite` の独立した値ではない（§9.7、§10） |
| safe メソッド | RFC9110 の意味での safe（`GET`/`HEAD` 等）。`POST`/`PUT`/`DELETE` は unsafe（§8.2、§9.7） |
| `Secure` | secure チャネル（典型的には HTTPS）でのみ送信。`http:` からは設定不可、localhost は例外（§8.2、§9.2） |
| `HttpOnly` | 非 HTTP API（`document.cookie` 等）から Cookie を隠す。JS 起点の fetch/XHR では送信される（§8.2、§9.2） |
| `Domain` | 送信先ホストのスコープ。省略時は host-only（サブドメインに送らない）。public suffix は不可（§8.2、§9.2） |
| `Path` | 送信に必要なパス前提。省略時はリクエスト URL のディレクトリ。**セキュリティ境界にならない**（§8.2、§9.2、§9.12、§9.13） |
| `Expires` / `Max-Age` | 寿命指定。両方あれば `Max-Age` 優先。どちらも無ければ session cookie。UA は最大 400 日に丸める（§8.2、§9.2、§9.6） |
| `Partitioned`（CHIPS） | パーティション化ストレージに保存。`Secure` 必須、`__Host-` プレフィックス推奨（§8.2、§8.4） |
| `__Secure-` プレフィックス | `Secure` 付き・secure origin から設定されたことを保証（§8.3、§9.4、§9.5） |
| `__Host-` プレフィックス | `Secure` 付き・`Path=/`・`Domain` 無し。ホストに固定され、任意パスから上書き不可。ポートのみ無視（§8.3、§9.4） |
| `__Http-` / `__Host-Http-` プレフィックス | `Secure` ＋ `HttpOnly` 必須（`Set-Cookie` 経由で設定された証明）。後者は `__Host-` の制約も併せ持つ（§8.3、MDN） |
| Weak Confidentiality | Cookie がポート・scheme・path による分離を保証しないこと（RFC6265bis / §9.12） |
| Weak Integrity | 兄弟ドメイン/任意パスからの Cookie 設定・上書きを防げず、被害側が自分の Cookie と区別できないこと（RFC6265bis / §9.13）。俗称 **cookie tossing** |
| cookie fixing | 非セキュア Cookie が既存のセキュア Cookie を上塗りする攻撃。保存モデル step 16 が部分的に緩和（RFC6265bis / §9.8） |
| Schemeful Same-Site | site の定義に scheme を含める変更。`http://` と `https://` の同一ドメインは互いに cross-site（§7） |
| CSRF | 誰がリクエストを開始したかに関わらず Cookie が添付される挙動を悪用する攻撃（web.dev / §2、RFC6265bis / §9.14） |
