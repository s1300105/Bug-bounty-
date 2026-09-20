## コード再利用攻撃（CCS17論文 / Google PoC）

前節（s4j）では、Script Gadgets の考え方とツール（CSP Evaluator / Black Hat 発表）を概観した。本節では、その理論的土台となった査読付き学術論文 **"Code-Reuse Attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets"（ACM CCS 2017）** を一次資料として精読し、ガジェットの**体系的な分類**、各種XSS対策の**具体的な突破コード**、そして「実際のWebでどれほど蔓延しているか」を測った**大規模実証実験の数値**まで、原典に沿って詳しく解説する。あわせて、これらの攻撃を再現可能な形で公開した **Google の `script-gadgets` PoC リポジトリ**の構造と、フレームワーク別の突破一覧表（bypass matrix）を扱う。

この論文が重要なのは、「CSP・サニタイザ・WAF・ブラウザ内蔵XSSフィルタという当時の4大XSS対策すべてが、原理的に同じ盲点を持つ」ことを、机上の空論ではなく **Alexa 上位5000サイト・約65万ページのクロール**によって定量的に証明した点にある。結論を先に言えば、著者らは「**今日書かれているWebアプリのほとんどのXSS対策はバイパス可能だと想定してよい**」（原文: *we assume most mitigation techniques in web applications written today can be bypassed*）と述べている。

### 1. 論文の位置づけと「コード再利用攻撃」という比喩

著者は Sebastian Lekies、Krzysztof Kotowicz、Eduardo A. Vela Nava（以上 Google）、Samuel Groß、Martin Johns（以上 SAP）。2017年10月、テキサス州ダラスで開催された CCS'17 のセッション "H2: Code Reuse Attacks" で発表された。

論文の中心概念は **script gadget（スクリプトガジェット）**、すなわち「Webページの正規コード（アプリ自身、またはロード済みのライブラリ/フレームワーク）の中に含まれる、**特定の形をしたDOM内容の存在に反応して動作する、小さなJavaScriptコード片**」である。攻撃の流れはこうだ。

1. 攻撃者は、一見無害なHTMLマークアップ（`<script>`もイベントハンドラも`javascript:`も含まない）をページに注入する。
2. 現行のXSS対策はそのマークアップに実行可能なスクリプトが無いと判断し、**そのまま通してしまう**。
3. しかしページの寿命の間に、そのサイトのスクリプトガジェットが注入内容を拾い上げ、**意図せずそのペイロードを実行可能なコードへと変換してしまう**。

著者はこれを、メモリ破壊系の脆弱性攻略で使われる **return-to-libc / ROP（Return-Oriented Programming）** に明確になぞらえている。ROPが「バイナリ中に既に存在する実行可能な命令列（gadget）を再利用して任意処理を組み立てる」のに対し、Script Gadgets は「ページ中に既に存在する正規JavaScriptロジックを再利用する」。攻撃者は新しいコードを持ち込まず、**既存コードの正規の振る舞いを鎖のようにつなぐ**だけで任意コード実行に至る。これが「Web版コード再利用攻撃」という呼称の由来である。

> 補足: この攻撃には、初期のHTMLインジェクション口が必要である。それが反射型か格納型か、あるいはサニタイザを通したDOMインジェクションかは**攻撃には無関係**（irrelevant）だと論文は明言する。攻撃者モデルはあくまで古典的なXSS攻撃者、すなわち「対象文書のコンテンツに任意のHTMLを注入できる者」である。

### 2. 前提となる技術背景：DOMセレクタと「無害なHTML」

#### 2.1 なぜガジェットが「トリガー」されるのか

現代のJavaScriptは、`document.getElementById` や `document.getElementsByClassName`、そしてそれらの下敷きである `document.querySelectorAll` を通じて、絶えずDOMからデータを読み込んでいる。これらはすべて **DOMセレクタ**（タグ名 `div`、ID `#foo`、クラス `.foo`、属性 `[foo]`）に基づく。jQuery の `$()` 関数はこのセレクタ言語に大量の糖衣構文を足したものにすぎない。

ライブラリは「特定のセレクタにマッチする要素を見つけて、その属性値に応じて処理する」という設計を当たり前に持つ。例えば「`tooltip` 属性を持つ全要素を装飾する」といった具合だ。攻撃者は、**まさにそのセレクタにマッチする無害な要素**を注入することで、正規コード（ガジェット）に自分の入力を「掴ませる」ことができる。

論文が挙げる、DOMからデータを読む正規コードの典型例（Listing 2 より）:

```js
// ユーザーランドのコード
var button = document.getElementById("button");
button.getAttribute("data-text");

var links = $("a[href]").children();

// Aureliaフレームワークが 'ref' 属性を読む箇所
if (attrName === 'ref') {
  info.attrName = attrName;
  info.attrValue = attrValue;
  info.expression = new NameExpression(
    this.parser.parse(attrValue), 'element',
    resources.lookupFunctions);
}

// Vue.js が v-html 属性を読む箇所
if ((binding = el.attrsMap['v-html'])) {
  return [{ type: EXPRESSION, value: binding }]
}
```

**なぜ動くか**: これらはどれも「攻撃者が注入し得る属性名（`data-text`, `ref`, `v-html`）」を読んでいる。属性値そのものは攻撃者が完全に制御できるので、後段でこの値がコード実行シンク（`innerHTML`、`eval`、`new Function` など）に流れれば、それがガジェットチェーンの入り口になる。

#### 2.2 「無害なHTML（benign HTML）」の定義

論文は、現行の対策が素通しする「無害なHTML」を厳密に定義する。すなわち **`<script>`タグ、インラインイベントハンドラ、`javascript:`/`data:` を持つ `src`/`href`、その他JavaScript実行能力を持つタグ（`<link rel=import>`、`<meta>`、`<style>`）を一切含まないマークアップ**である（Listing 1）:

```html
<div class="greeting">
  <b>Hello</b> world!
</div>
```

対策はこの種のマークアップに「実行可能なスクリプトが無い」と見て無変更で通す。**この「無害であるという判断」こそが攻撃者に悪用される前提**である。

> 出典: Code-Reuse Attacks for the Web — https://acmccs.github.io/papers/p1709-lekiesA.pdf

### 3. スクリプトガジェットの分類（論文 Section 3.5）

論文の最大の貢献の一つは、ガジェットを機能別に分類したことである。多くは単独では実行に至らず、**鎖（chain）**としてつなぐことで初めて有効になる。

#### 3.1 文字列操作ガジェット（String manipulation gadgets）

正規表現・文字置換などで入力文字列を変換するコード。**パターンマッチ型の対策を欺く**のに使える。有名な例が Polymer の「ダッシュ区切り属性名をキャメルケースに変換する」処理（Listing 4）:

```js
dash.replace(/-[a-z]/g, (m) => m[1].toUpperCase())
```

**なぜ動くか**: `inner-h-t-m-l` という属性名を注入すると、この処理が `innerHTML` に復元してしまう。WAFやサニタイザは「`innerHTML`」という危険な文字列を探すが、`inner-h-t-m-l` はそのブラックリストに引っかからない。ガジェットが「安全に見える文字列」を「危険な文字列」へと変換するため、**文脈破壊文字の検出そのものが無力化される**。

同様の変換は AngularJS のディレクティブ名正規化にも存在する（Listing 5）。`data-` や `x-` の接頭辞を剥がし、`:` `-` `_` に続く文字をキャメルケース化する:

```js
var PREFIX_REGEXP = /^((?:x|data)[:\-_])/i;
var SPECIAL_CHARS_REGEXP = /[:\-_]+(.)/g;
function directiveNormalize(name) {
  return name.replace(PREFIX_REGEXP, '')
    .replace(SPECIAL_CHARS_REGEXP, fnCamelCaseReplace);
}
```

**なぜ動くか**: サニタイザにブロックされる `ng-` 属性の代わりに、許可されがちな `data-ng-` 系の属性を使える。正規化後に AngularJS はそれを `ng-` ディレクティブとして解釈するため、対策の裏をかける。

#### 3.2 要素生成ガジェット（Element construction gadgets）

新しいDOM要素、特に **`<script>` 要素を生成する**コード（Listing 6）:

```js
document.createElement(input)
document.createElement("script")
jQuery("<" + tag + ">")
jQuery.html(input) // input が <script> を含む場合
```

代表格は jQuery の `$.globalEval`。これは新しい script 要素を作り `text` プロパティを設定してDOMに追加＝コードを実行する。要素生成ガジェット（3.1系）とJS実行シンクガジェット（3.4系）を兼ねており、`$.html` など多くのjQueryメソッドから呼ばれるため、**strict-dynamic CSPの突破に極めて有用**（後述4.3）。

#### 3.3 関数生成ガジェット（Function creation gadgets）

`new Function(...)` で新しい関数オブジェクトを作るコード。本体は入力と定数文字列の混合で構成される（Listing 7）。Knockout と Underscore.js の実物:

```js
// Knockout の関数生成ガジェット
var body = "with($context){with($data||{}){return{" +
  rewrittenBindings + "}}}";
return new Function("$context", "$element", body);

// Underscore.js の関数生成ガジェット
source = "var __t,__p='',__j=Array.prototype.join," +
  "print=function(){__p+=__j.call(arguments,'');};\n" +
  source + 'return __p;\n';
var render = new Function(
  settings.variable || 'obj', '_', source);
```

**なぜ動くか**: `new Function` は `eval` と同様に文字列からコードを生成する。`rewrittenBindings` や `source` に攻撃者制御文字列が混ざれば任意コードになる。ただし生成された関数は**別のガジェットが呼び出す**必要がある（単独では実行されない）。

#### 3.4 JavaScript実行シンクガジェット（JavaScript execution sink gadgets）

チェーンの終端。前段からの入力をDOM XSSの実行シンクに流し込む（Listing 8）:

```js
eval(input);
inputFunction.apply();
node.innerHTML = "prefix" + input + "suffix";
jQuery.html(input);
scriptElement.src = input;
node.appendChild(input);
```

最も単純なガジェットの例（Listing 3）はこれ一行で成立する:

```js
var button = getElementById("my-button");
button.innerHTML = button.getAttribute("data-text");
```

**なぜ動くか**: `data-text` 属性から読んだ値を無検証で `innerHTML` に代入している。`data-text="<img src=x onerror=alert(1)>"` を仕込むだけで実行に至る。

#### 3.5 式パーサ内のガジェット（Gadgets in expression parsers）— 最強のクラス

Aurelia、AngularJS、Polymer、Ractive.js、Vue.js といった**テンプレート系フレームワーク**は、DOMツリーの一部をUIコンポーネントのテンプレートとして解釈し、`${...}` や `{{...}}` のような区切り記号で囲まれた**独自の式言語（expression language）**を評価する。例えば Aurelia の式（Listing 9）:

```html
<td>${customer.name.capitalize()}</td>
```

フレームワークはこの式を **AST（抽象構文木）にパースして評価**する。ここが致命的なのは、**これら式言語がすべてチューリング完全**である点だ。攻撃者は式言語の表現力を使い、**プロトタイプチェーンを辿ってオブジェクトのコンストラクタや `window` オブジェクトへの参照を取得**し、任意関数を呼べる。Aurelia の式パーサのガジェット実物（Listing 10、簡略版）:

```js
if (this.optional('.')) { // プロパティアクセス
  result = new AccessMember(result, name);
}
AccessMember.prototype.evaluate = function(...) {
  return instance[this.name];
};
if (this.optional('(')) { // 関数呼び出し
  result = new CallMember(result, name, args);
}
CallMember.prototype.evaluate = function(...) {
  return func.apply(instance, args);
};
```

これらを鎖状につなぐと、**無害なHTMLマークアップだけ**で `window.alert` などの任意関数を呼べる。Aurelia を狙う実物のペイロード（Listing 11）:

```html
<div ref=me
 s.bind="$this.me.ownerDocument.defaultView.alert(1)"
></div>
```

**なぜ動くか**: Aurelia は文書内の `ref` 属性と `*.bind` 属性を探してガジェットを起動する。`ref=me` で自要素への参照を `me` に束縛し、`s.bind` の式で `me`（この `<div>`）から `.ownerDocument.defaultView`（＝`window`）を辿り、`alert(1)` を呼ぶ。`<script>` も `eval` も `javascript:` も一切使っていない。式言語のプロパティ辿りだけで `window` に到達している点が肝である。

Polymer 1.x を狙うペイロード（Listing 12）:

```html
<template is=dom-bind><div
 c={{alert('1',ownerDocument.defaultView)}}
 b={{set('_rootDataHost',ownerDocument.defaultView)}}>
</div></template>
```

**なぜ動くか**: 著者は手動コード解析により、Polymer 1.x で **`_rootDataHost` という「私的」プロパティを上書きすると、式を別スコープで実行できる**ことを発見した。このプロパティは本来Polymer式からアクセスされることを想定していない「意図せぬガジェット（unintentional gadget）」である。`set()` で `_rootDataHost` を `window` に差し替え、後続のガジェットチェーンを別スコープで発火させている。

#### 3.6 ガジェットベース攻撃の表現力

論文は、ガジェット経由で**チューリング完全な任意コード**を実行する3つの道を整理する。

- **eval系関数の呼び出し**: `eval` や `new Function` を呼べれば任意実行は直截。`window.alert` を1引数で呼べる例なら、同じ手口で `window.eval` も呼べる。
- **script要素の追加**: 攻撃者制御の `src` または本体を持つ `<script>` を追加する。
- **式言語の表現力の悪用**: CSPの一部の変種（nonceのみ、hashのみ）では上記2つが使えない。その場合でも式言語自体がチューリング完全なので、式インタプリタを起動できれば式言語と同等の表現力を得られる。

### 4. 4大XSS対策の具体的な突破（論文 Section 4）

論文は対策を「戦略」で3分類する。**(1) リクエストフィルタリング**（リクエストがアプリに届く前に遮断＝NoScript、WAF）、**(2) レスポンスサニタイズ**（レスポンス中の悪性コードを検出・除去＝HTMLサニタイザ、IE/EdgeのXSSフィルタ）、**(3) コードフィルタリング**（実行直前に良性/悪性を判定＝CSP、ChromeのXSS Auditor）。ガジェットはこの**どの戦略も原理的に回避する**。

#### 4.1 リクエストフィルタリング（NoScript / WAF）の突破

これらは `<script>` や `onerror` のような**既知の攻撃文字列**や文脈破壊文字（`<` `>`）を列挙して検出する。ガジェットは `class` や `id`、`data-*` のような**無害とされる属性**しか使わないため検出をすり抜ける。Knockout を使い NoScript を破る例（Listing 13）:

```html
<iframe src="//knockout.example.com/?xss=
    <div data-bind=value:a=location></div>
    <div data-bind=value:a.href=name></div>"
  name="javascript:alert(1)"></iframe>
```

**なぜ動くか**: NoScript は `location.href=name`（`name` は攻撃者が設定可能なので危険）を攻撃と判定する。しかしフレームワークの表現力を使い、これを `a=location` と `a.href=name` の**2つの無害な式に分割**している。個々には無害だが、Knockout が両方を評価するとき合わさって「`location.href` を `name`（`javascript:alert(1)`）に設定」となる。NoScript はマークアップを解析して「この2つが一緒に実行される」ことまでは見抜けない。

#### 4.2 レスポンスサニタイズ（DOMPurify / Closure / IE-Edge）の突破

サニタイザはホワイトリストで安全なタグ・属性を列挙し、それ以外を除去する。しかし `data-*`・`id`・`class` は大抵許可される。jQuery Mobile を使い DOMPurify を破る例（Listing 14。IEのXSSフィルタにも有効）:

```html
<div data-role=popup id='-->
  &lt;script&gt;alert(1)&lt;/script&gt;'>
</div>
```

**なぜ動くか**: DOMPurify から見れば、これは `data-role` と `id` を持つ完全に安全な `<div>` である。ところが jQuery Mobile は `data-role=popup` の要素を見つけると、**その `id` を使ってHTMLコメントを自動的に注入する**。攻撃者は `id` 値の中の `-->` でそのコメントから脱出し、その後の（HTMLエンティティが復元された）`<script>` を実行させる。サニタイザは「サニタイズ後は安全」と判断するが、ライブラリのその後の処理が安全性を壊す。

#### 4.3 コードフィルタリング（CSP / XSS Auditor）の突破 — 最重要

論文は「コードフィルタリングこそガジェットに**最も脆弱**」と結論する。ガジェットは正規コードの一部なので、実行時のコード検査をすり抜けるのは当然だからだ。

**XSS Auditor（Chrome/Safari）**: 16フレームワーク中13で突破。多くのガジェットが伝統的DOM XSSシンクを使い、DOM XSS防御がAuditorの既知の弱点だったため。Dojo の例（Listing 15）:

```html
<div
  data-dojo-type="dijit/Declaration"
  data-dojo-props="}-alert(1)-{">
</div>
```

**なぜ動くか**: Dojo は `data-dojo-props` 属性の値を `eval` に渡す。`}-alert(1)-{` は Dojo がオブジェクトリテラルに埋め込むと `eval` 内で `alert(1)` が評価される形になる。ペイロードは（リクエスト中のスクリプトと一致しないので）Auditorのマッチングを逃れる。

**unsafe-eval CSP**: 16中10で突破。式パーサのガジェットか eval系ガジェットを使う。通常 `unsafe-eval` は「攻撃者が直接 `eval` への注入口を見つけるのは難しい」ためそこそこ安全と信じられてきたが、ガジェットは **DOMノードとして注入した内容を eval-gadget に評価させる**という間接経路を提供する。著者はクロール中に**意図せず Tumblr の unsafe-eval ポリシーを自動突破してしまった**と報告している。

**strict-dynamic CSP**: 16中13で突破（うち2つは `unsafe-eval` の併存に依存）。`strict-dynamic` は「nonce付きで信頼されたスクリプトが動的に生成した子スクリプトへ、信頼を自動伝播する」キーワードである。RequireJS の例（Listing 16）:

```html
<script data-main='data:1,alert(1)'></script>
```

**なぜ動くか**: `<script>` に `data-main` 属性があるため、RequireJS のガジェットが `src` を `data:,alert(1)` に向けた**新しいscript要素を生成**する。RequireJS 自体は既に信頼されているので、`strict-dynamic` が**その信頼を新要素に伝播**させ、`data:` スクリプトが実行される。著者は「多くのフレームワークにガジェットが遍在する以上、strict-dynamic で現代Webアプリを守るのは従来考えられていたほど有効ではない」と述べる。Facebook の `fbevents.js` にも strict-dynamic 突破ガジェットを検出したと報告している。

**nonce/hash/whitelist のみの強いCSP**: これらでも**式パーサ内ガジェット**は有効。`eval` も新script要素も使わず `window` を取って任意関数を呼ぶため、CSPには検出・遮断のしようがない（Aurelia・Vue.js・Polymer 1.x で確認）。さらに Ractive では **CSP nonce を盗み出して新scriptに再利用する**ガジェットを発見（Listing 17）:

```html
<script id='template' type='text/ractive'>
<iframe srcdoc='<script
  nonce={{@global.document.currentScript.nonce}}>
  alert(document.domain)
</{{}}script>'>
</iframe>
</script>
```

**なぜ動くか**: Ractive のテンプレート式 `{{@global.document.currentScript.nonce}}` が**現在実行中スクリプトの正規nonceを読み取り**、それを `srcdoc` 内の新しい `<script>` に付与する。nonceが正しいのでCSPは信頼して実行する。`</{{}}script>` は式評価で `</script>` になり、外側のscriptを閉じないための小技。**nonceのみの「強い」CSPすら破られる**ことを示す決定的な例である。

### 5. 実証実験：どれほど蔓延しているか（論文 Section 5）

著者は「ガジェットが稀ならライブラリ側の注意で済むが、蔓延していればXSS自体を直すのと同じくらい難しい問題だ」という問いを立て、**大規模自動計測**を行った。

#### 5.1 検出手法

- **大規模検出**: ブラウザベースの**動的テイント追跡（taint tracking）エンジン**を自作。DOMノードから `eval`・`innerHTML`・`document.write`・`XMLHttpRequest.open()` など**60種類以上のシンク**へのデータフローを報告する。DOMツリー全体を「汚染済み」とマーク（＝反射型HTMLインジェクション能力の模擬）し、汚染値がシンクに届くかを見る。
- **検証（偽陽性ゼロ方式）**: フローが実際に無害マークアップから悪用可能かを、**検証用関数 `verify()` を呼ばせる実exploit**を生成して確かめる。ペイロードは既定では実行されない形に加工する。例えば `<svg onload=verify()>` を `data-text` 属性に**HTMLエンコードして**格納し（Listing 20）、ガジェットが読み取って復元・実行したときだけ `verify()` が発火する:

```html
<div id="button"
    data-text="&lt;svg onload=verify()&gt;">
</div>
```

さらに、CSPが無くても直接実行してしまう**偽陽性を避けるため**、`<xmp>` などの非実行タグを使う工夫もした（Listing 22）:

```html
<xmp id="foo"><script>verify()</script></xmp>
```

**なぜこう作るか**: これにより「ガジェットが読んで復元して初めて実行される」ケースだけをカウントできる。極めて保守的で偽陽性ゼロだが、その代償として**検出できないケース（偽陰性）が増える**ため、得られた数値はすべて**下限（lower bound）**である。

#### 5.2 主要な数値

Alexa 上位5000サイトを起点に、同一ドメイン/サブドメインへの一次リンクを辿り **647,085ページ**をクロール（37,232サブドメイン、4,557セカンドレベルドメインを含む）。

| 計測項目 | 数値 |
|---|---|
| 総シンク呼び出し数（DOM由来データ付き） | **4,352,491回** |
| DOM内のユニークなソース数 | 4,889,568 |
| 1URLあたり平均シンク呼び出し | 7.67回 |
| 何らかの関連データフローを持つドメイン割合 | **81.85%** |
| JS実行関数で終わるフローを持つドメイン（unsafe-eval関連） | **47.76%** |
| script要素生成/src注入系フローを持つドメイン（strict-dynamic関連） | **73.03%** |
| HTML属性→シンクのフローを持つドメイン | 78.30% |
| うち `data-*` 属性由来 | 59.51% |
| `id` 属性由来 / `class` 属性由来 | 15.67% / 10% |
| 生成した exploit 候補 | 1,762,823件 |
| **検証済みガジェット** | **285,894件** |
| **ガジェットを検証できたドメイン** | **906ドメイン＝全体の 19.88%** |

論文が16フレームワークを手動解析した結果の対策別突破本数（Table 1）:

| CSP whitelist | CSP nonce | unsafe-eval | strict-dynamic | Chrome XSS | Edge XSS | NoScript | DOMPurify | Closure | ModSecurity |
|---|---|---|---|---|---|---|---|---|---|
| 3 | 4 | 10 | 13 | 13 | 9 | 9 | 9 | 6 | 9 |

**読み方**: コードフィルタリング系（strict-dynamic 13、Chrome XSS Auditor 13、unsafe-eval 10）が最も破られやすい。**16フレームワーク中13で strict-dynamic を突破**できたことが、「nonce + strict-dynamic こそ現代CSPの本命」という当時の楽観への強い反証となった。一方、実証実験では自動検出可能なシンク終端型ガジェットに絞ったため、**19.88%のドメインで完全動作するexploitを生成・検証**できた（これも下限値）。

### 6. Google `script-gadgets` PoC リポジトリ

論文の攻撃を再現できる形で公開されたのが GitHub の **`google/security-research-pocs` 内 `script-gadgets` ディレクトリ**である（2023年1月10日にアーカイブ＝読み取り専用化）。

#### 6.1 構成

- 著者: Sebastian Lekies、Eduardo Vela Nava、Krzysztof Kotowicz（Google）。
- 収録資料: AppSec EU 2017 スライド、Black Hat USA 2017 スライド（`Breaking_XSS_mitigations_via_Script_Gadgets_BHUSA.pdf`）、CCS'17 論文本体（`ccs_gadgets.pdf`）。
- 実行環境: PHP対応のHTTP(S)サーバ（Apache2 + mod_php）。仮想ホスト `victim.example.com` と `attacker.example.com` を同一ディレクトリで提供する。一部ペイロードは ModSecurity や TLS証明書（LetsEncrypt）を要する。
- **突破する対策ごとにディレクトリ整理**されている。例: `/repo/csp/sd/` が strict-dynamic 突破、`/repo/csp/ue/` が unsafe-eval 突破。各ディレクトリの `*-exploit.*` ファイルが1フレームワーク分。例えば `/repo/csp/ue/aurelia_exploit.php` は「Aureliaで unsafe-eval CSP を破る」PoC。
- 突破一覧は `bypasses.md`。

#### 6.2 フレームワーク別 突破マトリクス（bypasses.md）

各セルは「そのフレームワークのガジェットで、その対策を突破できる」ことを示す。原典のPoC付き一覧を要約する（✔＝突破あり、-＝不可/条件付き）。

| フレームワーク | CSP whitelist | CSP nonce | unsafe-eval | strict-dynamic | Chrome | Edge | NoScript | DOMPurify | Closure | ModSecurity |
|---|---|---|---|---|---|---|---|---|---|---|
| Vue.js 2.3.0 | | | ✔ | ✔(u-e) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Aurelia (2017-03-21) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Angular 1.6.1 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Polymer 1.7.1 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | -(`<template`) | -(`<template`) | ✔ |
| Underscore 1.8.3 / Backbone | | | ✔ | - | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Knockout 3.4.1 | | | ✔ | ✔(u-e) | ✔ | ✔ | ✔ | ✔ | -(data-/comments) | ✔ |
| jQuery Mobile 1.4.5 | - | - | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ | ✔ |
| Ember.js 2.10.2 | - | - | ✔(dev) | ✔(dev) | | | | | | |
| React | - | - | | | | | | | | |
| Closure | | | | ✔ | ✔ | -(`<a.*`) | ✔ | | | |
| Ractive 0.8.1 | -(`{{}}`はeval) | ✔ | ✔ | ✔ | ✔ | -(`<script`) | -(scriptノード) | -(script) | -(script) | -(script) |
| Dojo 1.12.2 | | | ✔ | | ✔ | ✔ | ✔ | ✔ | -(data-) | ✔ |
| RequireJS 2.3.2 | | | | ✔ | ✔ | -(`<script`) | | | | |
| jQuery 3.1.1 | - | - | | ✔ | | -(`<script`) | | | | |
| jQuery UI 1.12.1 | - | - | | ✔ | ✔ | | ✔ | ✔ | ✔ | ✔ |
| Bootstrap 3.3.7 | | | | ✔ | ✔ | ✔ | -(HTML in attr) | ✔ | | |

**この表から読み取るべきこと**:

- **Aurelia と Angular 1.6.1 は全対策を突破**（式パーサ由来の最強クラスのガジェットを持つため）。whitelist/nonceのみの強いCSPすら破れるのは、この式パーサガジェットの威力を示す。
- **React だけが突破例ゼロ**。理由は、Reactが**JSXでコンパイル済みの仮想DOMを使い、HTML文字列やDOM属性を式言語として解釈しない設計**だからである。DOM属性から実行に至る「意味の再解釈」経路を持たないアーキテクチャが、構造的にガジェットを生みにくいことを端的に示す（設計上の重要な教訓）。
- Polymer が DOMPurify/Closure で `-` なのは、両サニタイザが `<template>` を（当時）サポートせず除去するため。Ractive が多くの列で `-` なのは、そのガジェットが `<script>` ノードを要し、それらの対策に除去されるため。つまり**「バージョンと対策の組み合わせ」で成否が決まる**点に注意。
- 対象バージョンはすべて2016〜2017年頃のもの。これらは古い版であり、後継版（Angular 2+/Vue 3 等）や各サニタイザの更新で状況は変わり得る。本表はあくまで**論文発表時点（2017年）のスナップショット**として読むこと。

> 出典: google/security-research-pocs — script-gadgets — https://github.com/google/security-research-pocs/tree/master/script-gadgets

### 7. 防御：論文の結論と実務的な指針

論文（Section 6）は、対策を3方向で論じつつ、いずれも決定打にならないと率直に述べる。

1. **対策技術を直す（Fix the Mitigation）**: 全ガジェットに対応するのは困難。式言語・フレームワーク・ユーザーランドコードのバリエーションが多すぎる。ただし部分的には可能で、**HTMLサニタイザが `data-*`・`id`・`class` 属性をフィルタする**ことは有効な一歩だと提案する（実証実験で `data-` 由来フローが59.51%あったことが根拠）。
2. **アプリ/ライブラリを直す（Fix the Applications）**: ライブラリからガジェットを除去する。しかしガジェットの多くはフレームワークの**機能そのもの**であり開発者が消したがらない。加えて「意図せぬガジェット（`_rootDataHost` の例）」は発見が普通のXSSより難しく、**XSS自体を直すのと同じくらい大変**だと結論。
3. **緩和（mitigation）から隔離・予防（isolation & prevention）へ発想を転換**: 論文の最終提言。Sandboxed iframe、Suborigins、Isolated Scripts などの**隔離技術**と、そもそも脆弱性を書けなくする**安全な既定API（secure-by-default）**へ舵を切るべきだとする。「Webプラットフォームは本質的に危険であり、初心者が安全なアプリを作れる仕組みが必要」という主張は、後年の **Trusted Types**（本書 s8a で扱う）や CSP の強化提案へと繋がっていく。

#### 実務者へのまとめ

- **CSP を貼っただけ、サニタイザを通しただけでは安全ではない。** ページ上に動いている全ライブラリの「DOM属性をコードとして再解釈する挙動」まで含めて脅威モデルに入れること。
- **`unsafe-eval` と `strict-dynamic` はCSPを大きく弱める**（論文は "considerably weaken a CSP policy" と明言）。使うなら細心の注意を。
- サニタイザ設定では、**`data-*`・`id`・`class` を無条件に許可しない**ことを検討する。フレームワーク（Angular/Vue/Polymer 等）を使うページでは、これらが式・ディレクティブの入り口になり得る。
- 新規開発では、**DOM属性やHTML文字列を式言語として解釈しないアーキテクチャ**（React系のコンパイル型、あるいは Trusted Types による実行シンクの型強制）を選ぶこと自体が、ガジェット面積を根本的に減らす。

> 本節ではラボの攻略手順そのものは扱わない。原理の理解と防御設計への応用を目的とする。掲載したコードは、論文・PoCが公開している「なぜ現行対策が原理的に破られるか」を説明するための引用であり、対象バージョン（2016〜2017年頃）における研究成果である点に留意すること。

> 出典: Code-Reuse Attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets (ACM CCS 2017) — https://acmccs.github.io/papers/p1709-lekiesA.pdf
