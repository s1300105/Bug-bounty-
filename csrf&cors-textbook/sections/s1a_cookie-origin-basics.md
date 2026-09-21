## Same-origin policyとCookie属性の基礎

CSRF（Cross-Site Request Forgery）とCORS（Cross-Origin Resource Sharing）は、いずれも「オリジン（origin）」という概念を軸に成立する話です。この章では、両者を理解するために避けて通れない3つの土台——(1) オリジンとは何か、(2) ブラウザがオリジンをまたぐ通信をどう制限しているか（Same-origin policy）、(3) Cookieの属性がその制限とどう絡むか——を整理します。ここを正しく押さえておくと、後の章で扱うCSRF攻撃の成立条件やCORS設定ミスの危険性が、暗記ではなく「原理」として理解できるようになります。

### オリジンとは何か

**オリジン（origin）**とは、URLのうち「スキーム（プロトコル）」「ホスト」「ポート」の3つ組（scheme/host/portタプル）を指します。2つのURLが完全に同一のオリジンとみなされるのは、この3要素がすべて一致する場合だけです。パスやクエリ文字列は比較対象に含まれません。

MDNが示す例をもとに、`http://store.company.com/dir/page.html` を基準にした比較を見てみます。

| 比較対象URL | 同一オリジンか | 理由 |
|---|---|---|
| `http://store.company.com/dir2/other.html` | 同一 | パスが違うだけ |
| `http://store.company.com/dir/inner/another.html` | 同一 | パスが違うだけ |
| `https://store.company.com/page.html` | 別オリジン | スキームが違う（http ≠ https） |
| `http://store.company.com:81/dir/page.html` | 別オリジン | ポートが違う（httpの既定は80） |
| `http://news.company.com/dir/page.html` | 別オリジン | ホストが違う（サブドメインも別ホスト扱い） |

> 出典: MDN: Same-origin policy — https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy

なぜこの3要素だけで区別するのか、という点は実装上の理由があります。スキームが違えば通信路の暗号化・認証性が異なり（`http`と`https`では中間者攻撃への耐性がまったく違う）、ポートが違えば同じホスト上でも別のサービス（別のアプリケーション）が動いている可能性が高い、という前提がブラウザ設計に組み込まれているためです。逆に言えば、パスやクエリはアプリケーション内部のルーティングに過ぎず、セキュリティ境界としては信頼できないため区別に使われません。

`file:///` のようなローカルファイルのURLは、ブラウザによって**不透明オリジン（opaque origin）**として扱われます。同じディレクトリにある2つのHTMLファイルであっても「同一オリジン」とはみなされず、`fetch`などを使うとCORSエラーになることがあります。これはローカルファイルシステム上の任意のファイルを読み書きできてしまう危険を避けるための設計です。

### Same-origin policy（SOP）が制限すること・許可すること

Same-origin policy（同一オリジンポリシー、以下SOP）は、ブラウザに組み込まれたセキュリティモデルであり、「あるオリジンのスクリプトが、別オリジンのリソースとどこまでやり取りできるか」を規定します。SOPが存在しなければ、悪意あるWebサイトを開いただけで、そのタブが同時に開いている別サービス（Webメールや社内システムなど）のDOMを自由に読み取れてしまいます。

SOPの制限は「書き込み（write）」「埋め込み（embed）」「読み取り（read）」で扱いが異なります。

- **クロスオリジンの書き込みは基本的に許可**される: リンク遷移、リダイレクト、フォーム送信など。
- **クロスオリジンの埋め込みは基本的に許可**される: `<script src>`、`<link rel="stylesheet">`、`<img>`、`<video>`/`<audio>`、`<iframe>`、`@font-face`など。
- **クロスオリジンの読み取りは基本的に禁止**される: 別オリジンのレスポンス内容をJavaScriptから直接読み出すことはできない（ただし埋め込みリソース経由である程度の情報が漏れることもある）。

この非対称性——「送るのは自由、覗くのは禁止」——こそがCSRFの根本原因です。ブラウザは、フォームを他ドメインに送信すること自体は禁止していません(それはWebの基本的な使い方だからです)。禁止しているのは、送信した結果のレスポンス内容を攻撃者のスクリプトが読み取ることです。つまりCSRFは「SOPの穴」ではなく、「SOPが意図的に許可している範囲（書き込みは自由）」を悪用する攻撃だと理解する必要があります。これは次章以降で詳しく扱います。

DOM・スクリプトAPIレベルでは、クロスオリジンの`window`オブジェクトに対して許可される操作はごく限定的です。

```
許可されるメソッド: window.blur(), window.close(), window.focus(), window.postMessage()
許可される属性(読み取り専用): window.closed, window.frames, window.length,
                              window.opener, window.parent, window.self, window.top
許可される属性(読み書き可): window.location（書き込みのみ実質的に意味を持つ）
```

異なるオリジン間で安全にデータをやり取りしたい場合の正規の手段が `window.postMessage()` です。これはSOPを迂回するための「抜け道」ではなく、送信先オリジンを明示的に指定させることで、開発者が意図的に許可したデータ交換だけを行わせる設計になっています（送信先オリジンの検証を怠ると、それ自体が脆弱性になります）。

ストレージ系のAPI——`localStorage`、`sessionStorage`、IndexedDB——はオリジンごとに完全に分離されています。Cookieだけは少し異なり、`Domain`・`Path`・`Secure`といった独自の属性でスコープが決まる、SOPとは別のオリジン定義を持ちます。この「Cookieだけ特殊なスコープを持つ」という事実が、CSRFが成立する土台そのものです。

### document.domainによるSOPの緩和（レガシー、非推奨）

歴史的には、同じ親ドメインを持つサブドメイン間でSOPを緩和する手段として `document.domain` の書き換えが使われてきました。

```javascript
// http://store.company.com/dir/other.html 上で実行
document.domain = "company.com";
// これにより、同様に document.domain = "company.com" を設定した
// http://company.com/dir/page.html との間で同一オリジンとみなされるようになる
```

ただしこの仕組みには重要な副作用があります。

- ポート番号が両方とも `null` 扱いになり、以後のポート比較に影響する。
- 無関係な上位ドメインには設定できない（`company.com`のページから`evil.com`への変更は不可）。
- サンドボックス化された`iframe`内で実行すると`SecurityError`が発生する。
- `localStorage`・IndexedDB・`BroadcastChannel`・`SharedWorker`の分離には一切影響しない（これらは依然としてホスト名で厳密に分離される）。

`document.domain`は現在では非推奨の仕組みであり、Chromeなど主要ブラウザではオリジン分離を強化する方向（Origin-keyed Agent Clustersなど）で段階的に無効化が進められています（2026年時点でも既存システムに残っている例はあるため、レガシーコードの監査時には注意が必要です）。新規実装でこれに依存すべきではありません。

> 出典: MDN: Same-origin policy — https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy

### CookieのScope属性: Domain・Path・Secure・HttpOnly

CSRFを理解するうえで最も重要な事実は、「**ブラウザは、リクエストの送信先が誰であるかに関わらず、条件に合致するCookieを自動的に付与する**」という挙動です。これはブラウザの認証設計における最も基本的な性質であり、CSRFはこの性質そのものを悪用します。

Cookieがどのリクエストに付与されるかは、以下の属性で決まります。

- **Domain**: 指定するとそのドメインとすべてのサブドメインに送信される。省略時は設定元のホストのみ（サブドメイン非包含）。
- **Path**: 指定したパス以下のリクエストにのみ送信される。
- **Secure**: HTTPS接続でのみ送信される。
- **HttpOnly**: JavaScriptの`document.cookie`からの読み取りを禁止する。

```http
Set-Cookie: sessionId=38afes7a8; HttpOnly
```

`HttpOnly`はXSS（クロスサイトスクリプティング。悪意あるスクリプトがページ内で実行される脆弱性）対策として非常に有効ですが、CSRF対策にはなりません。なぜなら`HttpOnly`が防ぐのはJavaScriptからの**読み取り**だけであり、ブラウザが通常のHTTPリクエストや`fetch()`・`XMLHttpRequest`でリクエストを送信する際には、`HttpOnly`のCookieも変わらず自動的に付与されるからです。つまり攻撃者はCookieの中身を盗み見ることはできませんが、そのCookieを「知らないまま」ブラウザに使わせることはできてしまいます。これがCSRFの本質です。

Cookie名には特殊なプレフィックスもあり、属性設定ミスを防ぐ仕組みとして用意されています。

| プレフィックス | 要求される条件 |
|---|---|
| `__Secure-` | HTTPSオリジンから`Secure`属性付きで設定されていること |
| `__Host-` | `Secure`＋`Path=/`＋`Domain`属性なし（HTTPSオリジンから設定） |

```http
// 有効な __Host- Cookie
Set-Cookie: __Host-ID=123; Secure; Path=/

// 無効: Path=/ がない
Set-Cookie: __Host-id=1; Secure

// 無効: __Host- はDomain属性を許容しない
Set-Cookie: __Host-id=1; Secure; Path=/; Domain=example.com
```

`__Host-`プレフィックスは、Cookieが「そのオリジン専用」であることをブラウザレベルで保証するため、サブドメインテイクオーバーなどによるCookie固定化・上書き攻撃への耐性を高めます。認証セッションCookieには積極的に使うべき仕組みです。

> 出典: MDN: Set-Cookie — SameSite — https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite

### SameSite属性: Strict / Lax / None

`SameSite`属性は、Cookieがクロスサイトリクエストに付与されるかどうかを制御する、CSRF対策として最も重要なブラウザ機構です。まず前提として、「同一サイト（same-site）」と「クロスサイト（cross-site）」の定義を押さえます。

- **同一サイト**: スキームと「登録可能ドメイン（registrable domain。例: `example.com`）」が一致する。サブドメイン同士（`a.example.com`と`b.example.com`）は同一サイトとみなされる。
- **クロスサイト**: スキームまたは登録可能ドメインのいずれかが異なる。
- **schemeful same-site**（より厳格な定義）: スキームとドメインの両方が一致することを要求し、`http://example.com`と`https://example.com`はクロスサイト扱いになる。

「同一オリジン」と「同一サイト」は別の概念である点に注意してください。オリジンはポートまで含めた完全一致、サイトは登録可能ドメイン単位の一致です。`a.example.com`と`b.example.com`は別オリジンですが同一サイトです。SameSite属性の判定は「サイト」単位で行われます。

#### Strict

同一サイトのリクエストにのみCookieを送信します。他サイトのページからのリンククリックで自サイトに遷移した直後の最初のリクエストにもCookieが付与されないため、ログイン状態が一瞬失われたように見えるUXトレードオフがあります。決済・アカウント変更など高セキュリティが要求される操作向けの設定です。

#### Lax（モダンブラウザの既定値）

同一サイトのリクエストに加え、以下の**両方**の条件を満たすクロスサイトリクエストにもCookieを送信します。

1. **トップレベルナビゲーションであること**: ブラウザのアドレスバーのURLが変わる遷移（リンククリック、`document.location`への代入、`<form>`送信）。`fetch()`、`<img>`、`<script>`によるサブリソース読み込み、`<iframe>`内でのナビゲーションは対象外。
2. **安全なHTTPメソッドであること**: `GET`・`HEAD`・`OPTIONS`のみが対象。`POST`・`PUT`・`DELETE`は対象外。

さらにChromeなどChromium系ブラウザ(2020年頃以降のバージョン)には、より実用的な例外として「Cookie設定から2分以内であれば`POST`を含むトップレベルナビゲーションにもCookieを送る」という緩和(lax-allowing-unsafe)が実装されています。これはOAuthのようなリダイレクトチェーンでログイン直後に`POST`が発生するケースの互換性を保つための措置です。

```
注記: FirefoxやChromiumは、クライアントとサーバーの時計のずれを補正するため、
レスポンスのDateヘッダーを使って内部的にこの2分間の判定を調整する。
```

#### None

同一サイト・クロスサイトの両方のリクエストにCookieを送信します。サードパーティ埋め込みウィジェットや決済連携など、意図的にクロスサイトでCookieを共有したい場合に使います。`SameSite=None`を指定する場合は**`Secure`属性が必須**です（`localhost`を除く）。これはHTTPS化されていない通信路でクロスサイトCookieを平文送信すると、中間者攻撃によるセッションハイジャックのリスクが跳ね上がるためです。

```http
Set-Cookie: sessionId=38afes7a8; SameSite=None; Secure
```

| SameSite値 | Secure属性の要否 | 主な用途 |
|---|---|---|
| `Strict` | 不要 | 決済・アカウント変更など高セキュリティ操作 |
| `Lax` | 不要 | 一般的な認証セッション(現在の既定値) |
| `None` | **必須** | サードパーティ埋め込み・クロスサイト連携 |

#### 各ブラウザの既定値とサポート状況

Chromeは**バージョン76以降(2019年8月)**、`SameSite`属性が明示されていないCookieを`Lax`として扱う既定挙動("SameSite=Lax by default")を導入しました。これは開発者が明示的に`SameSite=None`を指定しない限り、新規に作られるCookieの多くが自動的にCSRF耐性を持つようになったことを意味します。ただし、これは**既定値であって銀の弾丸ではありません**。前述のとおり`Lax`は`GET`によるトップレベルナビゲーションを許容するため、状態変更を伴う操作を`GET`で実装しているアプリケーションは`Lax`だけでは守られません。また、レガシーブラウザや一部の環境では`SameSite`未指定のCookieが依然として无制限に送信されるケースもあるため、「ブラウザが守ってくれるはず」という前提だけに依存した設計は避けるべきです。

- Firefox: バージョン60以降(2018年3月)で本格サポート。
- Safari: バージョン13以降(2019年9月)で本格サポート。

CORSとの関係にも触れておきます。`fetch()`や`XMLHttpRequest`でクロスオリジンリクエストを行う際、Cookieは既定では送信されません。

```javascript
// credentials を指定しないと Cookie は送られない
fetch('https://other-site.com/api', {
  credentials: 'include'  // 明示的な指定が必須
});

xhr.withCredentials = true; // XMLHttpRequestの場合
```

さらにブラウザは、レスポンス側の`Set-Cookie`ヘッダーについても、リクエストが`credentials`付きでない限り無視します。この「明示しない限り認証情報は乗らない」という設計は、CORSの章で扱う`Access-Control-Allow-Credentials`とセットで理解する必要がある重要な原則です。

> 出典: MDN: Set-Cookie — SameSite — https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite

### CSRFが成立する条件(次章への橋渡し)

ここまでの内容を踏まえると、CSRFが成立するために必要な条件が自然に導けます。PortSwiggerは、CSRF攻撃が成立するための3条件を次のように整理しています。

1. **意味のあるアクションが存在する**: パスワード変更、メールアドレス変更、送金など、攻撃者にとって価値のある操作がサーバー側に存在すること。
2. **Cookieベースのセッション管理に依存している**: アプリケーションがユーザー識別を専らセッションCookieだけに頼っており、それ以外のリクエスト検証手段(トークンなど)を持たないこと。
3. **リクエストパラメータが予測可能**: 攻撃者が正しいリクエストを事前に組み立てられること(推測不可能な値が含まれていないこと)。

PortSwiggerが示す、対策がない脆弱なリクエストの例:

```
POST /email/change HTTP/1.1
Cookie: session=yvthwsztyeQkAPzeQ5gHgTvlyxHfsAfE
email=wiener@normal-user.com
```

このリクエストにはCookie以外の検証手段が何もありません。攻撃者は、ログイン中の被害者のブラウザに次のようなHTMLを読み込ませることで、被害者のセッションCookieを使って同じリクエストを送信させられます。

```html
<form action="https://vulnerable-website.com/email/change" method="POST">
  <input type="hidden" name="email" value="pwned@evil-user.net" />
</form>
<script>document.forms[0].submit();</script>
</html>
```

このPoC(概念実証)コードが動く理由は、まさに本章で説明したSOPの非対称性そのものです。`<form>`のクロスサイト`POST`送信は「書き込み」にあたり、SOPはこれを禁止していません。そしてブラウザは、送信先が`vulnerable-website.com`である以上、そのドメインに紐づくCookie(セッションCookieを含む)を仕様通りに自動添付します。攻撃者のスクリプトはレスポンスを一切読み取れません(SOPが読み取りを禁じているため)が、CSRFは読み取りを必要としない攻撃です。「操作を実行させる」ことだけが目的だからです。

PortSwiggerが挙げる主な防御手段は次の3つです。

- **CSRFトークン**: サーバーが生成する推測不可能な値をリクエストに含めることを必須にする。
- **SameSite Cookie**: 本章で解説したブラウザ側の制御。
- **Referer検証**: HTTPリファラーヘッダーを確認する方式(トークン方式より効果が弱いとされる)。

これらの防御手法の詳細な実装方法、トークン検証の典型的な不備、そしてCORS設定ミスがどのようにCSRF的な攻撃や情報漏洩に発展するかについては、次章以降で詳しく扱います。

> 出典: PortSwigger: What is CSRF — https://portswigger.net/web-security/csrf

### 本節のまとめ

- **オリジン**はスキーム・ホスト・ポートの3つ組で決まり、パスやクエリは無関係。
- SOPは「書き込み(送信)は許可、読み取りは禁止」という非対称なモデルであり、これがCSRFの土台になる。
- Cookieはオリジンとは別の(Domain/Pathベースの)スコープを持ち、条件が合えばブラウザが自動的に送信する——送信先が正規のリクエスト元かどうかは一切問わない。
- `HttpOnly`はXSS対策であってCSRF対策ではない。CSRFはCookieを読まずに「使わせる」攻撃だから。
- `SameSite=Lax`が事実上の既定値になったことで多くのCSRFは緩和されたが、`GET`での状態変更や、ブラウザ・環境依存の抜け穴があるため、CSRFトークンなど独立した防御と併用するのが原則。
