## Content Security Policy の基礎とstrict CSP

### この節で扱うこと

Content Security Policy（CSP、コンテンツセキュリティポリシー）は、ブラウザに「このページはどこから来たリソースだけを信頼して実行・読み込みしてよいか」を宣言することで、XSS（クロスサイトスクリプティング）の**影響範囲を縮小する**ための多層防御機構です。入力バリデーションや出力エンコーディングに代わるものではなく、それらが破られたときの「最後の砦」として機能します。

本節では、CSPの基本的な仕組みから、現在のベストプラクティスである「strict CSP（nonceまたはhashベースのポリシー）」の具体的な実装、そして実装時に踏みがちな落とし穴までを、原典（web.dev の CSP解説、OWASP Cheat Sheet Series）に基づいて解説します。

---

### 1. CSPの基本モデル：allowlist（許可リスト）による制御

CSPは、HTTPレスポンスヘッダーまたは `<meta>` タグでブラウザに送られる**ポリシー文字列**です。ポリシーは「ディレクティブ（directive、制御対象のリソース種別を指定するキーワード）」と「ソース（そのディレクティブに対して許可する取得元）」の組で構成されます。

```
Content-Security-Policy: script-src 'self' https://apis.google.com
```

このヘッダーは「このページで実行されるスクリプトは、自分自身のオリジン（`'self'`）と `https://apis.google.com` からのものだけを許可する」という意味です。ブラウザはHTMLパーサ・スクリプトローダのレベルでこの制約を強制するため、たとえ攻撃者が `<script>` タグをHTML内に注入できても（＝XSSに成功しても）、そのスクリプトのソースがallowlistに含まれていなければ**実行されずにブロック**されます。これがCSPが「XSSの影響を軽減する」と言われる理由の核心です。

> 出典: Content security policy — https://web.dev/articles/csp

#### 主要ディレクティブ一覧

| ディレクティブ | 制御対象 |
|---|---|
| `script-src` | JavaScriptの実行元 |
| `script-src-elem` | `<script>` 要素として読み込まれるスクリプト（CSP3で追加された細分化） |
| `script-src-attr` | `onclick` 等のインラインイベントハンドラ |
| `style-src` | CSS（スタイルシート）の読み込み元 |
| `img-src` | 画像の読み込み元 |
| `font-src` | Webフォントの読み込み元 |
| `connect-src` | `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource` の接続先 |
| `media-src` | 動画・音声の読み込み元 |
| `object-src` | `<object>`/`<embed>`/`<applet>`（プラグイン系）の実行元 |
| `frame-src` / `child-src` | `<iframe>` に読み込めるコンテンツ元 |
| `frame-ancestors` | 自分自身を `<iframe>` 等で埋め込むことを許可する親ページのオリジン（クリックジャッキング対策） |
| `base-uri` | `<base>` 要素で指定できるURLの制限 |
| `form-action` | `<form>` の送信先URLの制限 |
| `default-src` | 個別指定がないディレクティブへのフォールバック値 |
| `worker-src` | Web Worker / Service Worker のスクリプト取得元 |
| `upgrade-insecure-requests` | HTTPリクエストを自動的にHTTPSへ書き換える |
| `report-uri` / `report-to` | ポリシー違反をレポートする送信先 |

重要な仕組み上の注意点として、**「指定されなかったディレクティブは `default-src` にフォールバックするが、一度でも明示的に指定したディレクティブはフォールバックしない」**という規則があります。たとえば `default-src 'none'; script-src 'self';` と書いた場合、`img-src` は指定されていないので `default-src 'none'` の効果を受けて全画像がブロックされますが、`script-src` は明示指定されているため `default-src` の値とは独立に評価されます。これを誤解して「`default-src` を厳しくすれば全部安全」と思い込むと、個別ディレクティブの記述漏れに気づけません。

> 出典: OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

また `frame-ancestors` と `sandbox`、そしてレポート系ディレクティブ（`report-uri`/`report-to`）は、後述する `<meta>` タグ経由の配信では**機能しません**。これはブラウザの仕様上、これらのディレクティブがHTTPレスポンスのナビゲーション処理（フレーム内に読み込まれる前の判定）に関わるため、DOM構築後に評価される `<meta>` タグでは間に合わないという実装上の制約です。

---

### 2. なぜ `'unsafe-inline'` はXSS対策として無意味になるのか

CSP導入以前のWebページでは、次のようにHTML内に直接スクリプトを書く「インラインスクリプト」が一般的でした。

```html
<script>
  function doAmazingThings() {
    alert('YOU ARE AMAZING!');
  }
</script>
<button onclick='doAmazingThings();'>Am I amazing?</button>
```

CSPはデフォルトで、`script-src` にソースを1つでも指定すると**インラインスクリプトとインラインイベントハンドラを自動的にブロック**します。これは「XSSの注入先の多くはインラインスクリプトである」という前提に基づいた設計です。攻撃者が `<script>alert(1)</script>` をページに注入できても、CSPがインラインスクリプトを許可していなければブラウザはそれを実行しません。

しかし、既存コードとの互換性のために `'unsafe-inline'` キーワードを `script-src` に加えると、この防御は完全に無効化されます。

```
Content-Security-Policy: script-src 'self' 'unsafe-inline'
```

この設定では、攻撃者が注入したインラインスクリプトも「インラインスクリプトである」という理由だけで実行が許可されてしまい、CSPが本来防ぐべき攻撃をそのまま通してしまいます。同様に `'unsafe-eval'` を許可すると、`eval()` や `new Function()`、文字列を渡す形の `setTimeout("code", n)` を通じた動的コード実行を許可することになり、攻撃者が文字列注入経由でコードを実行できる経路が残ります。

**CSP準拠への書き換え例**（インラインコードの外部ファイル化）：

```html
<!-- 変更前：インラインで危険 -->
<script>
  function doAmazingThings() { alert('YOU ARE AMAZING!'); }
</script>
<button onclick='doAmazingThings();'>Am I amazing?</button>
```

```html
<!-- 変更後：外部スクリプト + addEventListener -->
<script src='amazing.js'></script>
<button id='amazing'>Am I amazing?</button>
```

```javascript
// amazing.js
function doAmazingThings() {
  alert('YOU ARE AMAZING!');
}
document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('amazing')
    .addEventListener('click', doAmazingThings);
});
```

`eval()` を使う文字列渡しのタイマー処理も同様に書き換えます。

```javascript
// 変更前：文字列を渡すとCSPでブロックされる（内部的にeval相当の処理を伴う）
setTimeout("document.querySelector('a').style.display = 'none';", 10);

// 変更後：関数を渡す
setTimeout(function () {
  document.querySelector('a').style.display = 'none';
}, 10);
```

JSON文字列のパースに `eval()` を使っているコードも、`JSON.parse()` に置き換えることで `unsafe-eval` への依存を減らせます。

> 出典: Content security policy — https://web.dev/articles/csp

---

### 3. strict CSP：nonceベースとhashベース

allowlist方式（`script-src https://cdn-a.example https://cdn-b.example ...`）には根本的な弱点があります。allowlistに含まれるドメインの中に、JSONPエンドポイントや古いライブラリバージョンなど「任意のJavaScriptを実行させられる抜け道」を持つものが1つでもあれば、攻撃者はそのドメインを踏み台にしてCSPをバイパスできてしまいます。実際に大手CDNやアナリティクスサービスのドメインを使ったバイパスが繰り返し報告されてきました。

そこでGoogleが提唱し、現在のベストプラクティスとなっているのが**strict CSP**です。ドメイン単位の信頼ではなく、「そのスクリプトタグ自体が正当かどうか」を検証する方式に転換します。実装方法は2通りあります。

#### (a) nonceベース

`nonce`（number used once、一度限りの値）は、サーバーが**リクエストごとに新規生成する予測不可能なランダム値**です。CSPヘッダーとHTML内の `<script>` タグの両方に同じ値を埋め込みます。

```
Content-Security-Policy: script-src 'nonce-EDNnf03nceIOfn39fn3e9h3sdfa' 'strict-dynamic'; object-src 'none'; base-uri 'none';
```

```html
<script nonce="EDNnf03nceIOfn39fn3e9h3sdfa">
  // このスクリプトは正しいnonceを持つため実行される
</script>
```

**仕組みレベルでの理解**：ブラウザはHTMLパーサが `<script>` 要素を解釈する際に、その要素の `nonce` 属性値がCSPヘッダーで宣言された値と一致するかを照合します。一致すれば実行、しなければブロックです。攻撃者がXSS経由でHTMLに `<script>` タグを注入できたとしても、レスポンスごとに変わる正しいnonce値を**知る手段がなければ**そのスクリプトは実行されません（反射型XSSでレスポンス自体にnonceが漏れる特殊なケースを除く）。

重要な実装上の警告として、OWASPは次のように強調しています。「攻撃者が注入したスクリプトにもnonceが付いてしまうような、全ての `<script>` タグを一括置換するミドルウェアを作ってはいけない」。つまり、テンプレートエンジンの外側で正規表現的に `<script>` を `<script nonce="...">` に書き換えるような実装をすると、攻撃者がHTMLに注入した `<script>` タグにも同じミドルウェアがnonceを付与してしまい、strict CSPの意味が失われます。**nonceは、信頼できるテンプレートエンジンが「開発者が書いたスクリプトタグ」だけに、レンダリング時点で個別に埋め込む必要があります。**

#### (b) hashベース

スクリプトの中身のSHA-256ハッシュ値を計算し、それをCSPヘッダーに列挙する方式です。

```html
<script>alert('Hello, world.');</script>
```

```
Content-Security-Policy: script-src 'sha256-qznLcsROx4GACP2dm0UCKCzCG-HiZ1guq6ZZDob_Tng='
```

ハッシュはスクリプトタグの**中身のバイト列**（開始・終了タグ自体は含まない）に対して計算されます。大文字小文字、空白（前後の空白を含む）が1文字でも異なればハッシュ値は変わり、そのスクリプトは実行されなくなります。正確なハッシュ値は、Chrome DevToolsのConsoleタブに表示されるCSP違反メッセージ（"Refused to execute inline script because it violates the following Content Security Policy directive..."）内に推奨値として表示されるほか、`report-uri.com/home/hash` のような外部ツールでも生成できます。

OWASPはhash方式について明確なリスクを指摘しています。「スクリプトタグの中身を少しでも変更する（フォーマット整形による空白の変化ですら）とハッシュが変わり、スクリプトが描画されなくなる」ため、**ビルドパイプラインやコード整形ツールが介在する環境では保守コストが高くなりがち**です。CI/CDでミニファイのたびにハッシュを再計算する仕組みが必要になります。

#### `strict-dynamic`：動的に生成されるスクリプトへの伝播

nonceやhashで許可されたスクリプト（トップレベルスクリプト）が、実行時に `document.createElement('script')` などで**新たに** `<script>` 要素を生成する場合、その子スクリプトにもnonce/hashを個別に付与するのは非現実的です（多くのライブラリローダーがこのパターンを使います）。この問題を解決するのが `strict-dynamic` キーワードです。

```
script-src 'nonce-{RANDOM}' 'strict-dynamic';
```

`strict-dynamic` を指定すると、「正しいnonce/hashを持つスクリプトが自身のロジックでロードした追加のスクリプト」は自動的に信頼されます。仕組みとしては、ブラウザが「信頼されたスクリプト実行コンテキストから発行された `createElement('script')` 呼び出し」を追跡し、そこから生成された要素の実行を許可する、という実行コンテキストの伝播モデルです。これにより、モジュールバンドラやタグマネージャのような「動的スクリプト読み込みを行うが個々の子スクリプトのハッシュは予測できない」構成でもstrict CSPを適用できます。

なお `strict-dynamic` が有効な場合、`script-src` に書かれたホスト名ベースのallowlist（`https://apis.google.com` など）は**無視されます**（対応ブラウザ上では、nonce/hashとstrict-dynamicの組み合わせが優先される）。これは仕様上意図された挙動で、ドメイン単位の信頼を意図的にスクリプト単位の信頼に置き換えるためです。

> 出典: Content security policy — https://web.dev/articles/csp / OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

---

### 4. strict CSPの推奨テンプレートと `object-src` / `base-uri`

OWASP Cheat Sheetが示す、現在推奨されるstrict CSPの型は次の2つです。

```
# nonceベースのstrict CSP
script-src 'nonce-{RANDOM}' 'strict-dynamic';
object-src 'none';
base-uri 'none';
```

```
# hashベースのstrict CSP
script-src 'sha256-{HASHED_INLINE_SCRIPT}' 'strict-dynamic';
object-src 'none';
base-uri 'none';
```

`script-src` 以外の2行が付随する理由を仕組みレベルで説明します。

- **`object-src 'none'`**：`<object>`/`<embed>`/`<applet>` はFlashやJavaアプレットなど、ブラウザの通常のスクリプト実行モデルの外側で任意コードを実行できるレガシーなプラグイン機構の入り口です。これらは `script-src` の制御対象外であるため、`script-src` をどれだけ厳格にしても `object-src` を放置すると、プラグイン経由でCSPをすり抜けてスクリプト相当の処理を実行される余地が残ります。strict CSPでは無条件に `'none'` にします。
- **`base-uri 'none'`**：HTMLの `<base href="...">` は、そのページ内の相対URL（`<script src="app.js">` など）の解決基準を変更します。攻撃者が `<base href="https://attacker.example/">` をXSSで注入できると、正規のnonce/hash検証を通過した相対パスの `<script src="app.js">` が、実際には攻撃者のサーバーから読み込まれてしまいます。ホスト名ベースのallowlistではこの経路をブロックできないため、strict CSPでは `base-uri` も明示的にロックダウンします。

このテンプレートには意図的に `default-src` が含まれていません。strict CSPはあくまで「スクリプト実行」の防御に特化しており、画像やスタイルなど他のリソース種別は別途、サイトの実情に応じて `img-src`・`style-src` 等を個別に設定する運用が想定されています。

---

### 5. レポート機能：`report-uri` と `report-to`

CSP違反が発生した際、ブラウザに違反内容をサーバーへ通知させることができます。これにより本番投入前の影響調査や、投入後の継続的な監視が可能になります。

#### レガシー方式：`report-uri`

```
Content-Security-Policy: default-src 'self'; report-uri /csp-report-handler
```

違反発生時にブラウザが送信するレポートの例：

```json
{
  "csp-report": {
    "document-uri": "http://example.org/page.html",
    "referrer": "http://evil.example.com/",
    "blocked-uri": "http://evil.example.com/evil.js",
    "violated-directive": "script-src 'self' https://apis.google.com",
    "original-policy": "script-src 'self' https://apis.google.com; report-uri /handler"
  }
}
```

`blocked-uri`（ブロックされたリソースのURL）や `violated-directive`（違反したディレクティブ）から、意図しない外部リソースの混入やXSS試行の痕跡を検知できます。

#### 現行方式：`report-to`（CSP Level 3）

`report-to` はブラウザの Reporting API と連携する仕組みで、`Report-To`（または新しい `Reporting-Endpoints`）ヘッダーで事前に定義したエンドポイントグループ名を参照します。JSON形式でより多くのメタデータを含むレポートを送信できます。ただし対応状況の差があるため、OWASPは移行期の実装として**両方を併記する**ことを推奨しています。

```
Content-Security-Policy: default-src 'self'; report-to csp-endpoint; report-uri https://example.com/csp-reports
```

`report-to` に対応するブラウザはそちらを使用し、対応していない古いブラウザは `report-uri` にフォールバックします。

#### Report-Onlyモード：本番影響ゼロでの事前検証

```
Content-Security-Policy-Report-Only: default-src 'self'; report-uri /handler
```

`Content-Security-Policy-Report-Only` ヘッダーを使うと、ポリシーに違反するリソースを**ブロックせずに**レポートだけを送信します。これは「fail open（違反があっても処理を止めない）」な動作であり、strict CSPを本番の強制ポリシーとして投入する前に、既存ページのどの部分が違反するかを洗い出す段階的導入に使います。ブラウザは `Content-Security-Policy` と `Content-Security-Policy-Report-Only` を同時に送ることをサポートしているため、「厳格なポリシーをReport-Onlyで先行検証しつつ、緩いポリシーを実運用で強制する」という並行運用も可能です。

> 出典: OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

---

### 6. 配信方法の違い：HTTPヘッダー vs `<meta>` タグ

CSPは2通りの方法でブラウザに伝達できます。

**HTTPヘッダー方式（推奨）**

```
Content-Security-Policy: default-src 'self'
```

すべてのディレクティブに対応し、レスポンスの最初のバイトを受信した時点からブラウザにポリシーが伝わるため、パース開始前の早い段階で保護が有効になります。CDNやアプリケーションサーバーでヘッダーを制御できる環境ではこちらを使うべきです。

**`<meta>` タグ方式（代替手段）**

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src https://cdn.example.net; child-src 'none'; object-src 'none'">
```

静的ホスティングなどHTTPヘッダーを制御できない環境向けの代替手段ですが、前述の通り `frame-ancestors`・`sandbox`・レポート系ディレクティブ（`report-uri`/`report-to`）は機能しません。これはブラウザの実装が、これらのディレクティブをHTML文書がパースされる前のナビゲーション判定やネットワークレイヤーの処理として扱っているためで、DOM内に埋め込まれた `<meta>` タグの評価タイミングでは間に合わないという構造的な制約です。攻撃者がXSSで `<meta>` タグを追加でDOMに注入することでポリシーを上書き（正確には追加のポリシーとして重畳）できてしまう可能性がある点も、ヘッダー方式より脆弱な理由の一つです。

> 出典: Content security policy — https://web.dev/articles/csp / OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

---

### 7. よくある設定ミスとバイパスに関する注意点

#### 廃止済みヘッダーの使用

`X-Content-Security-Policy` や `X-WebKit-CSP` は、Firefox 23／Chrome 25（いずれも2013年前後）で標準の `Content-Security-Policy` ヘッダーがサポートされて以降、実装が不完全かつ不整合であるとして**使用が非推奨**です。現在のモダンブラウザは `Content-Security-Policy` ヘッダーのみを対象に実装しており、プレフィックス付きヘッダーは無視されるか誤動作します。

#### 廃止されたディレクティブの残存

`prefetch-src` はCSP Level 3の仕様策定過程で削除された実験的ディレクティブで、モダンブラウザでは無視されます。古い設定例をそのままコピーすると、意図した制御が実は効いていないという状況になり得ます。

#### 単独防御としての過信

OWASPは明確に「CSPをXSSに対する唯一の防御機構として頼るべきではない」と述べています。CSPはブラウザ側の実装差異、`unsafe-inline`/`unsafe-eval` を必要とするレガシーコードの残存、allowlistに含まれるドメインの脆弱性など、様々な理由で完全ではありません。入力バリデーション・出力エンコーディングといった根本的なXSS対策（Cross-Site Scripting Prevention Cheat Sheetの範囲）と併用することが前提です。

#### Subresource Integrity（SRI）との組み合わせ

完全に静的なサイトであっても、CSPで**Subresource Integrity（サブリソース完全性、外部リソースのハッシュ検証）**の使用を強制できます。これは、サードパーティのJavaScript配信元（CDNなど）が侵害された場合に、改ざんされたスクリプトの実行を防ぐ効果があります。`script-src` のallowlistに含めた外部ドメイン自体が攻撃者に侵害された場合の保険として機能します。

> 出典: OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

---

### 8. ブラウザサポートとバージョンに関する補足

CSPは策定時期の異なる複数のレベルがあります。

- **CSP Level 1 / Level 2**：Chrome 25以降、Firefox 23以降、Safari 7以降、Edge 14以降でサポートされているW3C勧告標準で、`script-src`、`nonce`、`hash`、`frame-ancestors` などの基本機構はこの時点で利用可能です。
- **CSP Level 3**：`strict-dynamic`、`worker-src`、`report-to`、`script-src-elem`/`script-src-attr` などの細分化ディレクティブを含みますが、本稿執筆時点でも実装状況にはブラウザ間で差があるため、対象ブラウザで動作検証を行うべきです。

strict CSP（nonce/hash + `strict-dynamic`）は比較的新しいブラウザでの利用を前提としており、`strict-dynamic` 非対応の古いブラウザではホスト名ベースのallowlistへのフォールバック記述を併記する設計が一般的です（`strict-dynamic` に対応したブラウザはallowlist部分を無視し、非対応ブラウザはallowlistを使う、という後方互換の書き方）。導入時は自組織が対象とするブラウザの最小バージョンを明記し、フォールバックの要否を都度判断する必要があります。

---

### まとめ

- CSPは「どこから来たリソースを実行・読み込みしてよいか」をブラウザに宣言する、allowlistベースの多層防御であり、XSSの検知ではなく**影響軽減**を目的とする。
- `'unsafe-inline'`/`'unsafe-eval'` を許可すると、CSPの主要な防御効果（インラインスクリプト・動的コード実行のブロック）が失われる。
- 現在のベストプラクティスは、ドメイン単位のallowlistではなく、nonceまたはhashで「そのスクリプトタグ自体」を検証する**strict CSP**であり、`strict-dynamic` と `object-src 'none'; base-uri 'none';` を伴うのが定型。
- nonceはリクエストごとに再生成する必要があり、一括置換ミドルウェアでの実装は攻撃者の注入スクリプトにもnonceを与えてしまうため危険。hashは中身の完全一致が必要でビルドパイプラインとの相性に注意する。
- `report-to`/`report-uri` による違反レポートと `Content-Security-Policy-Report-Only` による段階的導入を組み合わせることで、本番影響を抑えつつCSPを安全に強化できる。
- `<meta>` タグ配信は `frame-ancestors`・`sandbox`・レポート系ディレクティブが機能しないため、可能な限りHTTPヘッダーでの配信を優先する。
- CSPは唯一の防御ではなく、入力バリデーション・出力エンコーディング・SRIと組み合わせた多層防御の一部として運用する。
