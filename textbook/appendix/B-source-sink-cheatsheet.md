# 付録B source / sink 早見表（常に手元に置く1枚）

> **この付録の使い方**
> 実在のサイトを調べるときに開いておく早見表。「攻撃者の入力はどこから入るか（source）」と「その入力が届くと危ないのはどこか（sink）」の対応、そしてDevToolsでどのブレークポイントを置けばそのデータフローを捕まえられるかをまとめた。
> 出典は主にPortSwigger Web Security Academy の DOM-based vulnerabilities 教材（GitHub逐語ミラー経由で取得）。詳しい解説は第7章にある。

---

## 0. まず用語

- **source（ソース／源泉）** … 攻撃者に制御されうるデータを受け取るJavaScriptのプロパティ。「汚染された入力の入口」。PortSwigger原文の定義: *"A source is a JavaScript property that accepts data that is potentially attacker-controlled."*（代表例は `location.search`。クエリ文字列は攻撃者が制御しやすい。）
- **sink（シンク／吐き出し口）** … 攻撃者が制御するデータを渡されると望ましくない影響を起こしうる、危険なJavaScript関数またはDOMオブジェクト。PortSwigger原文の定義: *"A sink is a potentially dangerous JavaScript function or DOM object that can cause undesirable effects if attacker-controlled data is passed to it."*（例: `eval()` は引数をJavaScriptとして実行するのでsink。`document.body.innerHTML` はHTMLを注入されうるのでHTML sink。）
- **taint-flow（汚染フロー）** … source から sink へ、無害化されずにデータが流れる経路。DOMベース脆弱性は「sourceのデータが、検証・エスケープ・サニタイズされずにsinkに渡る」と成立する。
- **どのsinkに届くかで脆弱性の種類が決まる。** 同じ汚染フローでも、届く先がHTMLを実行するsinkならDOM XSS、ナビゲーションを起こすsinkならオープンリダイレクト、というように変わる（§3の表）。

---

## 1. source 一覧（攻撃者の入力の入口）

PortSwiggerが挙げる代表的なsource（逐語）。手を動かすときは、これらに canary（目印の英数字文字列）を入れて、どのsinkに届くかを追う。

| source | 何か | 攻撃者の制御しやすさ |
| --- | --- | --- |
| `document.URL` | 現在ページの完全なURL | 高（URLを作れる） |
| `document.documentURI` | 現在ドキュメントのURI | 高 |
| `document.URLUnencoded` | エンコードを解いたURL（古いIE系） | 高 |
| `document.baseURI` | ベースURI | 中（`<base>`の影響を受ける） |
| `location` | URL全体。`location.search`（?以降）、`location.hash`（#以降）、`location.href`、`location.pathname` を含む総称 | 高 |
| `document.cookie` | Cookie文字列 | 中（別経路でCookieを書ければ） |
| `document.referrer` | 参照元URL | 中（誘導元ページで制御可） |
| `window.name` | ウィンドウ名。ページ遷移をまたいで残る | 高（別ページから設定可） |
| `history.pushState` / `history.replaceState` | 履歴に積むURL・状態 | 高 |
| `localStorage` / `sessionStorage` | ブラウザ内ストレージ | 中（XSS等で書ければ） |
| `IndexedDB`（`mozIndexedDB` / `webkitIndexedDB` / `msIndexedDB`） | ブラウザ内データベース | 中 |
| `Database`（Web SQL） | 旧Web SQL Database | 中 |

**別枠の重要なsource: web message（受信メッセージ）**
`window.addEventListener('message', handler)` の `handler` が受け取る `event.data` は、別オリジンのページ（iframe等）から `postMessage()` で送り込める攻撃者制御sourceになる。origin検証が甘いと危険。詳しくは第6章・第7章のpostMessage解説を参照。

**別枠: WebSocketのメッセージ**
`WebSocket` で受信したデータ（`onmessage` の `event.data`）も、サーバー側が汚染されていれば source になりうる（第8章）。

---

## 2. DOM XSS を起こす sink 一覧（最重要）

攻撃者の入力がここに届くと、HTMLやJavaScriptを実行される。PortSwigger逐語。

### 素のJavaScript / DOM の sink

| sink | なぜ危険か |
| --- | --- |
| `document.write()` | 引数をHTMLとして書き込む。`<script>`や`<img onerror>`を注入できる |
| `document.writeln()` | `document.write()` と同じ（末尾に改行が付くだけ） |
| `document.domain` | 設定するとオリジンの緩和が起き、別サブドメインとの境界が壊れる |
| `element.innerHTML` | 要素の中身をHTMLとして差し替える。後付けの`<script>`は実行されないが`<img src onerror=...>`等で実行できる |
| `element.outerHTML` | 要素自体をHTMLで置き換える |
| `element.insertAdjacentHTML` | 指定位置にHTMLを挿入する |
| `element.onevent`（`onclick`等） | イベントハンドラ属性にJavaScriptを書き込む |

〔補足〕この表以外にも、`eval()`・`Function()`・`setTimeout(文字列, ...)`・`setInterval(文字列, ...)`・`location`系（`javascript:`URL）・`Range.createContextualFragment()`・`DOMParser.parseFromString()`・`<script>`要素の`src`/`text`・`iframe`の`srcdoc` などがDOM XSSやコード実行のsinkになる（第2章のCSP、第7章のsink詳細、第8章で扱う）。

### jQuery の sink（HTMLを解釈する関数）

jQueryを使うサイトでは、次の関数に汚染データが渡ると危険。PortSwigger逐語。

```
add()  after()  append()  animate()  insertAfter()  insertBefore()  before()
html()  prepend()  replaceAll()  replaceWith()  wrap()  wrapInner()  wrapAll()
has()  constructor()  init()  index()  jQuery.parseHTML()  $.parseHTML()
```

特に `$()`（セレクタ関数）にURLフラグメント（`location.hash`）を渡している箇所、`attr()` で `href` 属性を書き換えている箇所は要注意。

---

## 3. 脆弱性カテゴリ → 代表sink 対応表

DOM XSS以外にも、同じ汚染フローで多様な脆弱性が生じる。「どのsinkに届いたか」で種類が決まる。PortSwigger逐語（代表sinkのみ。実際は各カテゴリに複数sinkがある）。

| DOMベース脆弱性カテゴリ | 代表sink | 何が起きるか |
| --- | --- | --- |
| DOM XSS（クロスサイトスクリプティング） | `document.write()` | 任意のスクリプト実行 |
| Open redirection（オープンリダイレクト） | `window.location` | 攻撃者サイトへ強制遷移（フィッシング等） |
| Cookie manipulation | `document.cookie` | Cookieの書き換え・セッション固定 |
| JavaScript injection | `eval()` | 任意JS実行 |
| Document-domain manipulation | `document.domain` | オリジン境界の緩和 |
| WebSocket-URL poisoning | `WebSocket`（コンストラクタ） | 攻撃者制御のWS接続先へ |
| Link manipulation | `element.src` | リンク先・読み込み先の乗っ取り |
| Web message manipulation | `postMessage()` | 別ウィンドウへ悪意あるメッセージ |
| Ajax request-header manipulation | `setRequestHeader()` | リクエストヘッダの注入 |
| Local file-path manipulation | `FileReader.readAsText()` | 読み込むファイルパスの操作 |
| Client-side SQL injection | `ExecuteSql()` | Web SQLへの注入 |
| HTML5-storage manipulation | `sessionStorage.setItem()` | ストレージの汚染 |
| Client-side XPath injection | `document.evaluate()` | XPath式の注入 |
| Client-side JSON injection | `JSON.parse()` | 不正JSONの解釈 |
| DOM-data manipulation | `element.setAttribute()` | 属性値の操作 |
| Denial of service | `RegExp()` | ReDoS等でページを固める |

---

## 4. source → sink を「捕まえる」ブレークポイント対応表

DevTools（第5章）で、どの調査にどのブレークポイントを置くかの対応。これが手動追跡の要。

| 調べたいこと | 置くブレークポイント | 使い方の要点 |
| --- | --- | --- |
| DOMが書き換わる原因コードを特定 | DOM change（subtree modifications / attribute modifications / node removal） | Elementsパネルで対象要素を右クリック → Break on |
| ある通信を出したコードを特定 | XHR/fetch breakpoint（URL部分一致） | SourcesパネルのXHR/fetch Breakpointsに文字列を登録 |
| どのハンドラがイベントで動くか | Event Listener breakpoint（カテゴリ別。例: message, click, load, hashchange） | Sourcesパネルで該当カテゴリにチェック。postMessage追跡なら`message` |
| 特定の値になった瞬間だけ止めたい | 条件付きブレークポイント（conditional） | 行番号を右クリック → Add conditional breakpoint。例: `url.includes('canary')` |
| 例外が出る箇所を止めたい | Exception breakpoint（caught / uncaught） | Sourcesパネルの一時停止アイコン |
| ある関数が呼ばれたら止めたい | Function breakpoint | Consoleで `debug(関数名)` |
| Trusted Types違反を捕まえたい | Trusted Type violation breakpoint | CSPのTrusted Types導入サイトで |
| CSP違反を捕まえたい | CSP violation breakpoint | |

**sinkで止めてsourceへ遡る型（手動追跡の基本形）**
```
1. 疑わしいsink（innerHTML等）にブレークポイントを置く、
   またはDOM Invaderのcanaryでsinkを特定する
2. 止まったらCall Stack（呼び出し履歴）を上に遡る
3. 各フレームのScope（変数の中身）で、その値がどこから来たか確認
4. 遡り続けてsource（location.hash等）に到達したら、
   source→sinkの1本の経路が確定
```

---

## 5. 手を動かす（このシートの使い方の実演）

1. 調査対象ページを開き、DevTools（F12）→ Sources を開く。
2. §1のsourceのうち、そのページが使っていそうなもの（まず `location.hash` / `location.search`）に、ブラウザのURLで canary文字列（例: `zzcanaryzz`）を入れる。
3. DevToolsのConsoleで `zzcanaryzz` を含むDOMを探す: `document.body.innerHTML.includes('zzcanaryzz')`。ヒットしたら、その文字列がHTMLに落ちている＝HTML sinkに届いている可能性。
4. Elementsパネルでcanaryが入った要素を探し、右クリック → Break on → subtree modifications。
5. もう一度canaryを流し込み、止まったらCall Stackを遡ってsource→sinkを確定する。
6. Burpを使えるなら、DOM Invader（第6章）でこの一連を自動化できる。

---

## つまずきポイント

- **「ページのソースを表示（View source）」はDOM XSSのテストに使えない。** それはサーバーから来た生のHTMLで、JavaScriptによるDOM変更を反映しない。必ずDevToolsのElements（＝現在のDOM）で確認する。
- **各sourceは1つずつ順番にテストする。** 複数同時に流すと、どのsourceがどのsinkに届いたか分からなくなる。
- **`<script>`をinnerHTMLに入れても実行されない。** 後付けのDOMでは`<script>`は動かないので、`<img src=1 onerror=...>`や`<svg onload=...>`を使う。
- **sinkに届いた＝即XSSではない。** その手前でサニタイズ（DOMPurify等）や検証が入っていれば防がれる。「届くか」と「ブレイクアウトできるか」は別問題。
- **根本対策は「信頼できないsourceのデータをsinkに動的に渡さない」こと。** 避けられないなら許可リスト（allowlist）で厳格に検証する。

## この付録のまとめ

- DOMベース脆弱性は source→sink の汚染フローで起きる。どのsinkに届くかで種類が決まる。
- sourceの代表は `location`系・`document.cookie`・`document.referrer`・`window.name`・ストレージ・web message。
- DOM XSSの主なsinkは `document.write`・`innerHTML`・`outerHTML`・`insertAdjacentHTML`・`element.onevent`、そしてjQueryのHTML系関数。
- カテゴリ→代表sinkの対応（§3）を覚えると、sinkを見た瞬間に脆弱性の種類の当たりがつく。
- 手動追跡は「sinkで止めてCall Stackをsourceへ遡る」が基本形。ブレークポイントの対応表（§4）を使う。

## 出典

- PortSwigger Web Security Academy: DOM-based vulnerabilities（`https://portswigger.net/web-security/dom-based`）と各サブページ、および Sources-And-Sinks-Cheatsheet の逐語転記
- 詳細な解説は本教科書 第7章、DevToolsのブレークポイントは第5章、DOM Invaderは第6章。

<!-- sources: https://portswigger.net/web-security/dom-based -->
<!-- terms: source, sink, taint-flow, DOM XSS, canary, ブレークポイント, allowlist, サニタイズ -->
