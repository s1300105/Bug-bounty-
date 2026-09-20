## DOMベースXSSの基礎とDOM Invader導入

反射型・格納型のXSS（Cross-Site Scripting: 攻撃者が仕込んだ文字列が、ブラウザによって「データ」ではなく「コード」として解釈・実行されてしまう脆弱性）では、悪意ある入力は**必ず一度サーバを通り、サーバが組み立てたHTMLに載って**ブラウザへ返ってきます。ところがWebアプリケーションの主戦場がサーバ側テンプレートから**クライアント側のJavaScript**へと移った結果、「サーバは一切関与していないのに、ブラウザ内でだけXSSが成立する」という第三の類型が主役級の重要度を持つようになりました。これが本章のテーマ **DOMベースXSS（DOM-based XSS）** です。

本セクションは、この分野の事実上の標準教材である PortSwigger（Burp Suite の開発元）の2つの資料——「What is DOM-based XSS?」と「Introducing DOM Invader」——を直接取得（WebFetch）した上で精読・統合し、(1) DOMベースXSSの原理と source/sink の体系、(2) 手作業での発見がなぜ困難か、(3) その困難を一変させたツール **DOM Invader** の全体像、を初学者が原文なしで完全に理解できるところまで解説します。単なる用語集ではなく、「**なぜブラウザはその代入先で入力をコードとして実行してしまうのか**」という仕組みのレベルまで掘り下げることが本セクションの価値の中心です。

---

### 1. DOMベースXSSとは何か — 反射型・格納型との根本的な違い

#### 1.1 定義

**DOMベースXSS**とは、**ページ内で動くJavaScript（クライアント側スクリプト）が、攻撃者の操作できるデータを読み取り、それを無防備な形で「危険な代入先」に渡してしまう**ことで発生するXSSです。PortSwigger の定義を直接引用すると次のとおりです。

> "DOM-based vulnerabilities arise when a website contains JavaScript that takes an attacker-controllable value, known as a **source**, and passes it into a dangerous function, known as a **sink**."

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

> **重要な原則**: ソースそのものは「危険」ではありません。危険なのは、**ソースの値がサニタイズ（入力に含まれる危険な文字列を無害な形へ変換・除去する処理）されないまま sink に届く**ことです。ソースを見つけたら、その値がコード中でどこへ流れるか（＝どの sink に到達するか）を追跡するのが分析の本質です。

> 出典: What is DOM-based XSS? — https://portswigger.net/web-security/cross-site-scripting/dom-based

---

### 3. sink（シンク）— 危険な代入先と、その「発火の仕組み」

sink は「攻撃者データが渡ると望ましくない効果を引き起こす、危険なJavaScript関数やDOMオブジェクト」です。DOMベースXSSでは、sink はおおむね次の3系統に分かれます。**なぜそこで発火するのか**という仕組みが重要なので、系統ごとに原理を説明します。

#### 3.1 系統A: HTMLとして再解釈される sink（HTMLパース系）

代入した文字列を、ブラウザの **HTMLパーサ（HTML構文解析器: 文字列を読んでDOMツリーへ変換する部品）が「新しいHTML」として解釈し直す** sink です。ここが最頻出です。PortSwigger が挙げる代表的な実行系sinkは次のとおりです。

| sink | 挙動 |
|---|---|
| `document.write()` / `document.writeln()` | ドキュメントストリームへ文字列を書き出し、HTMLとして解析させる |
| `element.innerHTML` | 要素の中身を、渡された文字列を**HTMLとして解析**して置き換える |
| `element.outerHTML` | 要素自身を含めてHTMLとして置き換える |
| `element.insertAdjacentHTML()` | 指定位置に文字列をHTMLとして挿入する |
| `document.domain` | ドキュメントのドメインを変更する（同一オリジンポリシーの境界に関わる） |
| `element.onevent` | イベントハンドラ属性・プロパティへの代入（文字列がコードとして扱われる経路がある） |

**発火の仕組み（最重要）**: `innerHTML = '<b>x</b>'` のように文字列を代入すると、ブラウザはその文字列を単なるテキストではなく**HTMLソースコードとして読み直し**、`<b>` を要素ノードに変換してDOMツリーへ組み込みます。この「文字列 → DOM要素」の再解釈の過程で、攻撃者が仕込んだイベントハンドラ属性（`onerror` など）や危険なタグが**正規のHTML要素として生成され、ブラウザのイベント機構に登録される**ため、コードとして動き出すのです。

> **落とし穴（試験に出る仕組み）**: `innerHTML` に `<script>alert(1)</script>` を入れても**スクリプトは実行されません**。これはHTML仕様で「パーサ挿入以外の経路で後から挿入された `<script>` 要素は実行しない」と定められているためです。だからこそ攻撃者は `<script>` を使わず、**`<img src=1 onerror=alert(document.domain)>` のように「読み込み失敗イベントで発火するタグ」**を使います。存在しない画像 `src=1` の読み込みは必ず失敗し、`onerror` ハンドラが呼ばれる——この「必ず失敗する」性質を逆手に取るのが定石です。実際にPortSwigger が示す典型的な脆弱コードと攻撃はこうなります。

```javascript
// 脆弱なコード
document.write('... <script>alert(document.domain)</script> ...');
```

```html
<!-- innerHTML経由での等価な攻撃 -->
element.innerHTML='... <img src=1 onerror=alert(document.domain)> ...'
```

#### 3.2 系統B: 文字列をコードとして実行する sink（JavaScript実行系）

渡された文字列を、そのまま**JavaScriptソースコードとして評価・実行**してしまう sink です。HTMLパースを経由しないぶん、より直接的です。

| sink | 挙動 |
|---|---|
| `eval()` | 引数の文字列をJavaScriptとして実行 |
| `Function()`（`new Function(...)`） | 文字列から関数を生成して実行可能にする |
| `setTimeout()` / `setInterval()` | **第1引数が文字列だと**、それをコードとして評価して実行する |

**発火の仕組み**: `eval("alert(1)")` は、JavaScriptエンジンが引数の文字列を新しいソースコードとしてコンパイルし、その場のスコープで走らせます。`setTimeout("alert(1)", 100)` のように**関数ではなく文字列を渡すと、内部的に `eval` 相当の評価が起きる**点が盲点です（関数を渡せば安全）。

#### 3.3 系統C: ナビゲーション/URL系 sink（`javascript:` スキーム）

`location` / `location.href` / `location.assign()` / `location.replace()`、あるいは `a.href` や `iframe.src` などのURL属性は、遷移先URLとして解釈されます。ブラウザは `javascript:` で始まるURLへの遷移を「そのコードを実行せよ」という命令として扱うため、攻撃者が遷移先URLを制御できれば、`javascript:` スキームでコード実行に持ち込めます。

具体例として、PortSwigger が示す実例を見てみましょう。

```javascript
$('#backLink').attr("href", (new URLSearchParams(window.location.search)).get('returnUrl'));
```

このコードは、URLパラメータ `returnUrl` の値をそのまま `<a>` タグの `href` 属性に設定しています。攻撃者が次のようなURLを踏ませれば、

```
?returnUrl=javascript:alert(document.domain)
```

被害者が「戻る」リンクをクリックした瞬間に `javascript:` スキームが実行されます。**なぜ動くのか**: `href` 属性は本来「移動先URL」を保持するだけですが、ブラウザは `javascript:` プレフィックスを特別扱いし、リンククリック時にプレフィックス以降をコードとしてそのまま実行する、というブラウザの仕様そのものが悪用されています。

#### 3.4 系統D: jQuery など JavaScript ライブラリの sink

ライブラリの便利関数が、内部で `innerHTML` 相当の処理を呼ぶために sink になります。PortSwigger が挙げる jQuery の代表的な sink 一覧は次のとおりです。

```
add(), after(), append(), animate(), insertAfter(), insertBefore(),
before(), html(), prepend(), replaceAll(), replaceWith(), wrap(),
wrapInner(), wrapAll(), has(), constructor(), init(), index(),
jQuery.parseHTML(), $.parseHTML()
```

**jQuery `$()` の危険な仕組み（頻出）**: `$(x)` は通常「CSSセレクタで要素を探す」関数ですが、jQuery は**引数の文字列が `<` で始まると「これはHTMLだ」と判断してその場でHTML要素を生成**します。PortSwigger が挙げる典型パターンはこうです。

```javascript
$(window).on('hashchange', function() {
    var element = $(location.hash);
    element[0].scrollIntoView();
});
```

このコードでは、URLフラグメント（`location.hash`）の値がそのまま `$()` へ渡されています。フラグメントが `#<img src=1 onerror=alert(1)>` のように `<` を含む文字列であれば、jQuery はセレクタ検索のつもりが**新しい要素の生成＝コード実行**に化けます。ただし通常は被害者にリンクをクリックさせる（＝`hashchange` を発火させる）操作が必要になるため、PortSwigger は次のように**iframeを使って被害者の操作なしに `hashchange` を起こす**実戦的な悪用例も示しています。

```html
<iframe src="https://vulnerable-website.com#" onload="this.src+='<img src=1 onerror=alert(1)>'"></iframe>
```

**なぜ動くのか**: iframeを空のフラグメント（`#`）付きでまず読み込み、`onload` イベントでフラグメントに攻撃文字列を追記する。フラグメントの変更は `hashchange` イベントを発火させるため、脆弱なハンドラが**被害者の一切の操作なしに**起動し、`$(location.hash)` がペイロードをHTML化します。

> **バージョン依存の注意（陳腐化への警戒）**: この種の `$()` 悪用は、jQuery のバージョンによって成立条件が変わります。**jQuery 1.9.0（2013年公開）より前**は `$()` が `#` を含む文字列でもHTMLとして扱いやすく、より緩い条件で発火しました。それ以降のバージョンでは、入力が `#` で始まる場合にHTML注入を防ぐよう挙動が厳格化されています。現場で古いjQueryを見たら、この差を必ず意識してください。

> 出典: What is DOM-based XSS (cross-site scripting)? Tutorial & Examples — https://portswigger.net/web-security/cross-site-scripting/dom-based

---

### 4. 具体的なコード例・ペイロード例（原理つき）

ここまでの source/sink を、追加の代表例で具体化します。各例に「**なぜ動くのか**」を必ず添えます。

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

**なぜ動くのか**: `document.write()` は引数をドキュメントストリームへ流し込み、HTMLパーサに解析させる。ソース `location.search` の値が無検証で連結されているため、攻撃者のタグがそのままDOM化して実行される。`document.write` が `<select>` 要素の内側など「特定の親要素の中」で使われている場合は、まず `</select>` などで文脈（コンテキスト）を抜けてからペイロードを置く、という**コンテキスト脱出**が必要になることもあります。

#### 4.3 `eval()` 周辺の例

脆弱なコード（クエリからJSONを読もうとして `eval` を使ってしまう悪例）:

```javascript
var data = eval('(' + location.search.slice(3) + ')');
```

`?x={});alert(1);({` のような入力で、`eval` がコードとして評価し `alert(1)` が走ります。

**なぜ動くのか**: `eval` は引数文字列を無条件にJavaScriptとしてコンパイル・実行する。攻撃者は JSON のふりをした文字列の中に文をねじ込み、括弧のバランスを調整してコードを紛れ込ませる。正しくは `JSON.parse()`（データとしてのみ解釈し、コードは実行しない）を使うべきで、`eval` を JSON パースに使うこと自体がアンチパターン。

---

### 5. どうやって見つけるか — 手作業の限界と、ツールが必要な理由

#### 5.1 手作業のアプローチ

原理的には、DOM XSS の探索は次の手順です。

1. ページで動く**全JavaScriptを読み、各ソース（`location` 等）が参照されている箇所を洗い出す**。
2. そのソースの値が代入・連結・関数呼び出しを経て**どこへ流れるか（データフロー）を追跡**する。
3. 途中でサニタイズされずに**危険な sink に到達していれば脆弱**。
4. sink に届く形に合わせてペイロードを組み立て、コンテキスト脱出などを施して発火させる。

PortSwigger 自身、DOM XSS の検出方法として、Burp の Web脆弱性スキャナによる自動検出に加え、**ブラウザ開発者ツール上での検索**（DOM内の注入文字列を `Ctrl+F`/`Cmd+F` で探す、JavaScriptコードを `Ctrl+Shift+F`/`Cmd+Alt+F` で横断検索する）という手作業の手段を挙げています。

#### 5.2 なぜ DOM XSS は難しいのか

- **コードが人間可読でない**。本番のJavaScriptは**ミニファイ（minify: 空白・改行・意味のある変数名を削って圧縮した状態）**され、しばしば**難読化**されている。ソースからsinkへの流れが**数千行**に散らばり、変数名も `a`, `b`, `c` のように潰れている。
- **フレームワークが sink を隠す**。jQuery や各種SPA（Single Page Application）フレームワークの内部で `innerHTML` 相当が呼ばれるため、表面のコードを見ても sink が見えない。
- **サーバに痕跡が残らない**（§1.3）。したがってプロキシでリクエスト/レスポンスを眺める従来型の手法だけでは、ブラウザ内で完結するフローを捉えきれない。

結果として、DOM XSS の手作業探索は「複雑なJavaScriptの中で入力の流れを延々と手で追う、退屈で骨の折れる作業」になります。実際、PortSwigger のブログ記事「Introducing DOM Invader」は、現代のサイトが「複数のJavaScriptライブラリを使い、大量の複雑で難読化されたコードを持つ（multiple JavaScript libraries, and have many lines of complex, minified code）」ため、手動テストが極めて困難であると述べています。**この作業を、あたかも反射型XSSを探すかのように簡単にする**ために作られたのが DOM Invader です。

> 出典: What is DOM-based XSS? — https://portswigger.net/web-security/cross-site-scripting/dom-based
> 出典: Introducing DOM Invader: DOM XSS just got a whole lot easier to find — https://portswigger.net/blog/introducing-dom-invader

---

### 6. DOM Invader 導入 — DOM XSS 探索を一変させたツール

#### 6.1 DOM Invader とは何か・登場の背景

**DOM Invader** は、PortSwigger が **2021年6月30日** に発表した、Burp Suite 向けの新ツールです。ブログ記事のタイトルそのものが主張になっています——「**DOM XSS just got a whole lot easier to find（DOM XSS の発見が一気に簡単になった）**」。開発は **Gareth Heyes** を中心に、PortSwigger のスキャナ開発チーム（James Kettle、Patrick Albinson、Alex、Paul Wilshaw ほか）が携わりました。同チームは公開前に DOM Invader を実戦投入し、**PayPal の DOM XSS 脆弱性**を実際に発見したことをブログで紹介しています。

背景にあるのは §5.2 で見た「DOM XSS は手作業では非常に見つけにくい」という長年の問題です。従来もブラウザの開発者ツール（DevTools）でブレークポイントを張って追う、あるいは古い専用ツールを使う、といった方法はありましたが、いずれも熟練と根気を要しました。DOM Invader はこの探索を、**Burp に組み込まれたブラウザ（Burp's embedded browser: Chromium ベースの内蔵ブラウザ）に載る拡張機能**として実装し、「ターゲットのDOMを計装（instrument）し、遭遇するJavaScriptのソースとシンクを片っ端から傍受する（instruments your target's DOM, intercepting any JavaScript sources and sinks it might come across）」ことで、探索の大部分を自動化・可視化します。ソースは `location.search` や `document.URL`、`window.name` のようにユーザー入力を受け取るJavaScriptオブジェクト、シンクは `eval`、`innerHTML`、`setTimeout` のようにコード実行を可能にする関数、という位置づけです。

**重要な特徴**: DOM Invader は **2021.7 リリース（Early Adopter チャンネル）**で登場し、**Burp Suite Professional（有償版）だけでなく Community Edition（無償版）でも利用できる**、内蔵ブラウザの標準機能です。高価なライセンスがなくても DOM XSS の体系的探索ができる、という点が学習者にとって大きな意味を持ちます。利用するには、**Burp の内蔵ブラウザ右上のアイコンをクリックして有効化**します。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader
> 出典: DOM Invader（Burp ドキュメント） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader

#### 6.2 中核機能1: canary（カナリア）

**canary（カナリア）** とは、**ユーザー入力が sink まで届いているかを追跡するための、目印になるユニークな文字列（"a unique string that's used to see where your user input is reflected inside a sink"）**です（炭鉱のカナリア＝危険の察知役、が語源）。

使い方の原理はこうです。テスターは canary（既定ではランダム生成される文字列だが、任意の値に変更もできる）を、テストしたいソース——URLのクエリパラメータやフラグメントなど——に入れます。DOM Invader は**この canary がページ内でどの sink に到達したかを検出**し、DevTools 上で該当箇所を**自動的にハイライト**して教えてくれます。

**なぜ有効か**: 反射型XSSでは「入力した目印文字列がレスポンスHTMLのどこに出るか」を見て反射点を探します。canary はこの発想を DOM の世界へ持ち込むもので、**数千行のJSを手で追う代わりに、目印が sink に着いたかどうかを機械に判定させる**ことができます。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader

#### 6.3 中核機能2: Augmented DOM（拡張DOM）

**Augmented DOM（拡張DOM）** は、Burp 内蔵ブラウザの DevTools に追加される専用タブで、**そのページに存在する source と sink をツリー状に一覧表示**します。DOM Invader が検出できる source と sink の一覧は非常に網羅的で、それぞれに**重要度に基づく数値ランク**（1に近いほど優先度が高い）が付与されています。ブログでは「**最も興味深いものが最初に表示される（the most interesting ones appearing first）**」と説明されており、たとえば `eval` はランク2、`innerHTML` はランク21、`location` 関連の sink は20番台といった具合に、危険度の高いものから並びます（ランクの総数はドキュメント時点でおよそ80台に及びます）。

PortSwigger 自身がこの機能の意義を次のように表現しています。

> Augmented DOM を使えば、**DOM XSS をあたかも反射型XSSであるかのように見つけられる**。

**なぜ画期的か**: 従来は「JavaScript を読んで source→sink のデータフローを頭の中で再構築する」必要がありました。Augmented DOM は**そのデータフローの結果（どのソースがどの sink に届いているか）をツリーとして直接提示**するため、コード読解というボトルネックを丸ごと省けます。各 sink アクセスをクリックすると、それが**どこから呼ばれたか（スタックトレース: 関数呼び出しの経路）**を DevTools コンソールで確認でき、脆弱箇所の特定が容易になります。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader

#### 6.4 中核機能3: Web メッセージ（postMessage）のテスト

DOM Invader は、専用の **Postmessage タブ**で、ページ上で `postMessage()` により送受信される **Web メッセージ**を**傍受・改変**できます。特に注目すべき機能として、「**'Spoof origin' チェックボックスをクリックするだけで、Web メッセージの送信元（origin）を偽装できる（you can spoof the origin of a web message, simply by clicking the 'Spoof origin' check box）**」ことが挙げられます。これにより、Web メッセージの送信元検証が不十分な実装（送信元を確認せず `event.data` を信頼してしまうコード）を素早く突くことができ、**Web メッセージ由来の DOM XSS**（送られてきた `event.data` が sink に流れるパターン。第7章で詳述）を効率的に検証できます。DOM Invader はまた、検出結果から**PoC（Proof of Concept: 脆弱性の実証コード）を自動生成**する機能も持ちます。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader

#### 6.5 実際の使い方（基本フロー）

1. Burp を起動し、**内蔵ブラウザ**を開く。ブラウザ右上のアイコンをクリックして DOM Invader を有効化する。
2. canary を設定する（既定のランダム値でよい。任意の文字列に変更も可）。
3. テスト対象サイトを開き、**canary を URL のクエリやフラグメント等のソースに差し込む**。
4. DevTools の **Augmented DOM タブ**を開き、canary が到達した source/sink を確認する。ランク順に表示されるため、危険な sink（`eval`, `innerHTML` 等）に届いていれば有望。
5. sink アクセスのスタックトレースで、脆弱なコード箇所を特定する。
6. Web メッセージが絡む場合は Postmessage タブでメッセージを観察し、必要なら「Spoof origin」で送信元検証をすり抜けてテストする。
7. その sink の性質に合わせてペイロードを組み立て、発火を確認する。

#### 6.6 その後の進化（バージョン注記 — 陳腐化への注意）

2021年の初版ブログが扱った中核は **canary / Augmented DOM / Web メッセージ**の3本柱でした。その後 DOM Invader は継続的に強化され、**プロトタイプ汚染（prototype pollution: JavaScript のオブジェクトの“親テンプレート”を汚染して挙動を乗っ取る攻撃。第4章で詳述）の自動検出**などの機能が加わっています。本セクションの主眼である「登場背景と基礎機能」は初版ブログに基づきますが、**実際にツールを使う際は必ず最新版のドキュメントで現行機能を確認**してください（ツールは頻繁に更新されます）。DOM Invader の詳細なオプション設定・Web メッセージテストの手順は、PortSwigger の公式ドキュメント `https://portswigger.net/burp/documentation/desktop/tools/dom-invader` に継続的に反映されています。

> 出典: DOM Invader（Burp ドキュメント、最新機能一覧） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader

---

### 7. DOMベースXSS以外の「DOM系脆弱性」全体像

PortSwigger は、DOM XSS を「攻撃者データが source → sink へ流れて悪影響を及ぼす」という同じ枠組みで捉えられる**DOM系脆弱性ファミリー**の一員として位置づけています。sink が変われば影響も変わる、という発想です。学習者はこの地図を押さえておくと、実務で「XSSにはならないが別の被害が出る」ケースを見逃さずに済みます。

| 脆弱性の種類 | 典型的な sink | 何が起きるか（影響） |
|---|---|---|
| **DOM-based XSS** | `innerHTML`, `eval`, `document.write`, jQuery `html()` 等 | 任意のJavaScript実行 |
| **DOM-based open redirection**（オープンリダイレクト） | `location`, `location.href`, `location.assign()`, `location.replace()` | 攻撃者サイトへ強制遷移（フィッシング等） |
| **DOM-based cookie manipulation**（Cookie操作） | `document.cookie` | Cookie を攻撃者値で上書き。セッション固定や他攻撃の足場 |
| **DOM-based JavaScript injection** | `eval`, `Function`, `setTimeout`（文字列）等 | コード実行（XSSと重なる） |
| **DOM-based document-domain manipulation** | `document.domain` | 同一オリジンポリシーの境界を緩めさせられる |
| **DOM-based link manipulation**（リンク操作） | `a.href`, `element.src` 等 | 正規リンクを差し替え |
| **DOM-based web-message manipulation** | `postMessage()` の宛先 | 別ウィンドウへ悪意あるメッセージ送信 |
| **DOM-based HTML5-storage manipulation** | `localStorage.setItem()`, `sessionStorage.setItem()` | ストレージ汚染（後続のDOM XSSの source になりうる） |

このファミリー観の実務的な含意は明快です。**「その sink はコード実行に至るか？」を毎回問う**こと。至るなら XSS、至らないなら別カテゴリの被害を評価する、という切り分けができるようになります。

---

### 8. 防御 — クライアント側でしか守れない

DOM XSS の防御は、§1.3 で述べたとおり**サーバ側では完結できません**（サーバに届かない攻撃があるため）。防御はJavaScriptコードの内側で行う必要があります。PortSwigger は「**信頼できないソースから来たデータを、動的にHTMLドキュメントへ書き込むことを避ける（avoid allowing data from any untrusted source to be dynamically written to the HTML document）**」ことを基本原則として掲げています。この原則と実務のベストプラクティスをまとめます。

1. **そもそも危険な sink に、攻撃者制御データを渡さない**。これが最上位の原則。動的にHTMLを組み立てる必要が本当にあるかを問い直す。
2. **安全な代替 sink を使う**。テキストを表示したいだけなら `innerHTML` ではなく **`textContent`**（渡した文字列を必ずプレーンテキストとして扱い、HTMLとして解釈しない）を使う。これだけで大多数の innerHTML 由来 DOM XSS は消える。
3. **どうしてもHTMLを動的生成するなら、コンテキストに応じたエスケープ／サニタイズを施す**。HTML文脈・属性文脈・JavaScript文脈・URL文脈で必要な処理は異なる（詳細は第2章のコンテキスト別対策を参照）。**HTML用のサニタイズとJavaScript用のサニタイズは別物**であり、PortSwigger も「HTML sink とJavaScript実行 sink を区別して対策を実装すべき」と述べています。
4. **信頼できるサニタイズライブラリを使う（自作しない）**。事実上の標準は **DOMPurify** で、HTMLをパースして危険な要素・属性を除去する。
   > **バージョン依存の注意（重要）**: DOMPurify は繰り返しバイパス（回避手法）が発見され、その都度修正されてきた。例えば **DOMPurify 2.0.17（2020年公開）より前**のバージョンには既知のバイパスが存在し、古いバージョンをそのまま使い続けると防御が破られる。特に **mXSS（mutation XSS: ブラウザがDOMを再シリアライズ／再パースする際にHTMLが“変異”して、サニタイズ後に危険な形へ化ける現象。名前空間の切り替え〔HTML/SVG/MathML〕を悪用するものが有名）** による名前空間混同バイパスは近年も複数報告されている。**DOMPurify は必ず最新版に追従し、更新を怠らないこと**。（mXSS の仕組みは第4章で詳述。）
5. **Trusted Types を導入する**。**Trusted Types** は、`innerHTML` などの危険な sink へ渡せる値を「検証済みの特別な型（TrustedHTML など）」に限定するブラウザ機構で、CSP（Content Security Policy）ヘッダ `require-trusted-types-for 'script'` で有効化する。**生の文字列を sink に渡すこと自体をブラウザレベルで禁止**できるため、DOM XSS を構造的に封じる強力な多層防御になる（対応ブラウザは Chromium 系が中心）。
6. **`eval` / `Function` / 文字列引数の `setTimeout` を使わない**。JSONは必ず `JSON.parse()` で扱う。

> 出典: What is DOM-based XSS?（防御セクション） — https://portswigger.net/web-security/cross-site-scripting/dom-based

---

### 9. 本セクションのまとめ

- **DOMベースXSS**は、サーバではなく**ブラウザ内のJavaScript**が、攻撃者制御データ（**source**）を危険な代入先（**sink**）へ無検証で渡すことで起きる。`location.hash` を使う型は**サーバに届かず**、WAFやサーバ側エスケープが原理的に無力になる点が決定的な特徴。
- **source** はURL系（`location.*`, `document.URL`）を筆頭に、`document.referrer`, `window.name`, `postMessage`, ストレージなど多岐にわたる。**sink** はHTMLパース系（`innerHTML`, `document.write`）、コード実行系（`eval`, 文字列 `setTimeout`）、URL系（`javascript:`）、ライブラリ系（jQuery `$()`, `.html()`）に大別できる。
- 発火の核心は**ブラウザによる再解釈**——文字列をHTMLパーサがDOM要素に変換する（`onerror` 発火）、あるいはJSエンジンがソースとしてコンパイルする——という仕組みにある。`innerHTML` 経由の `<script>` が動かない一方 `<img onerror>` が動く理由も、この仕組みから導ける。
- DOM XSS は3類型の中でも発見が難しい。ミニファイ／難読化された数千行のJSでデータフローを手追いする作業を、**DOM Invader**（2021年6月30日、Gareth Heyes らが開発。Burp 内蔵ブラウザの拡張。Community 版でも利用可）が **canary・Augmented DOM・Web メッセージ（Spoof origin機能付き）**で「反射型XSSのように」簡単にした。
- 防御はクライアント側でしか完結しない。`textContent` への置き換え、DOMPurify（**最新版必須**）、Trusted Types が主力。`eval` 系は排除する。

次セクション以降では、ここで俯瞰した DOM 系脆弱性の各論——DOM Invader のより詳細な設定・Web メッセージ、プロトタイプ汚染、mXSS——を、それぞれの発火メカニズムまで掘り下げて扱います。
