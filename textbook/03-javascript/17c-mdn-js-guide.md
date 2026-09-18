# JavaScriptモジュールと言語基盤 — 型強制・等価比較・列挙可能性・メモリ管理から見るクライアントサイド診断

> **この節で分かること**
> - JavaScriptモジュール（ESM）がクラシックスクリプトとどう違い、`type="module"`・import maps・動的`import()`・import attributesのどこが攻撃面になるかを説明できる
> - `==`と`===`と`Object.is()`の変換規則を表で読み、型強制を使ったバリデーション迂回や`document.all`によるDOM Clobberingの前提を理解できる
> - `for...in` / `in` / `Object.keys` / `hasOwn`が継承プロパティをどう扱うかを対応表で示し、プロトタイプ汚染の「観測可能性」を判断できる
> - `WeakMap`・`WeakRef`・`FinalizationRegistry`のメンタルモデルを説明し、疑似privateと`#`によるhard privateの差を区別できる
> - 「言語レベル（ECMAScript）」と「ランタイムレベル（DOM/Web API）」の境界を引き、DOM XSSのsinkがどちらにあるかを整理できる
> - MDN原典で必ず自分の目で読むべき箇所と、その理由を挙げられる

**元資料**: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide （原典は取得できず二次情報ベース：MDN公式コンテンツリポジトリ `github.com/mdn/content` のソースMarkdownから同一原稿を取得）
**関連する節**: 「MDN JavaScript ガイド」ユニット17a・17b（Grammar and types / Functions / Working with objects / プロトタイプ / Meta programming など）

---

## 0. この節の位置づけ

この節はMDNの「JavaScript ガイド（JavaScript Guide）」から、**言語のやや深い章**を扱う。具体的には JavaScript modules（モジュール）、Data structures（型と型強制）、Equality comparisons and sameness（等価比較）、Enumerability and ownership of properties（列挙可能性と所有性）、Memory management（メモリ管理）、Language overview（言語全体像）である。

これらは一見「基礎文法」に見えるが、**クライアントサイド脆弱性ハンティングの中核**に直結する。型強制はバリデーション迂回の道具になり、`in` と `hasOwn` の差はプロトタイプ汚染に反応するかどうかを決め、`import()` は動的コード実行のsink（脆弱性の出口）になる。この節は「なぜそうなっているのか → どう動くのか → 攻撃者はどこを突くのか → どう守るのか」の順で、診断者の目でこれらの章を読み直す。

> 用語の確認。**sink（シンク）**とは、外部から来たデータが最終的に流れ込む「危険な出口」のこと。たとえば `eval(x)` の `x` や `element.innerHTML = x` の `x` が典型的なsinkである。逆に、データが入ってくる入口を **source（ソース）**と呼ぶ。

---

## 1. JavaScriptモジュール（ESM）— なぜ生まれ、何が違うのか

### 1.1 なぜモジュールが必要になったのか（設計意図）

複雑なプロジェクトは、JavaScriptプログラムを必要に応じてインポートできる「分離モジュール」に分割する仕組みを必要とする。**モジュール（module）**とは、変数や関数を自分の中に閉じ込めておき、明示的に公開（export）したものだけを他のファイルから使えるようにする単位のこと。たとえば「正方形を描く関数」だけを外に出し、内部の補助関数は隠す、といった使い方をする。

Node.jsは古くからこの能力を持ち、モジュールを扱うライブラリやフレームワークが多数あった（**CommonJS** や **AMD** ベースのモジュールシステム、**RequireJS**、**webpack**、**Babel** など）。そして今は、**すべてのモダンブラウザがトランスパイル（変換）なしでネイティブにモジュールをサポートする**。ブラウザはモジュールの読み込みを最適化でき、ライブラリで余分なクライアントサイド処理とラウンドトリップを行うより効率的になる。

ただしネイティブ対応があっても、webpackのようなバンドラが無用になるわけではない。バンドラはコードを妥当なサイズのチャンクに分割し、**minification（最小化）**、**dead code elimination（デッドコード削除）**、**tree-shaking（未使用コードの刈り取り）**といった最適化も行える。

### 1.2 export と import の基本形（どう動くのか）

モジュール機能にアクセスするには、まず `export` 文でエクスポートする。

```js
export const name = "square";

export function draw(ctx, length, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, length, length);

  return { length, x, y, color };
}
```

関数、`var`、`let`、`const`、そしてクラスをエクスポートできる。ただし**それらはトップレベルの項目でなければならず、関数の内部で `export` は使えない**。より便利なのは、ファイル末尾に単一のexport文を置く方法である。

```js
export { name, draw, reportArea, reportPerimeter };
```

インポート側は次のように書く。

```js
import { name, draw, reportArea, reportPerimeter } from "./modules/square.js";
```

`from` の後ろの文字列を **module specifier（モジュール指定子）**と呼ぶ。これはJavaScript環境がモジュールファイルへのパスに解決できる文字列である。ドット `.` は「現在の場所」を意味し、そこからの相対パスを書く。相対パスは短く、URLをポータブル（移植可能）にする。たとえば絶対パス `/js-examples/module-examples/basic-modules/modules/square.js` は `./modules/square.js` になる。

インポートされた値の性質は重要である。

> **NOTE（原文）**: The imported values are read-only views of the features that were exported. Similar to `const` variables, you cannot re-assign the variable that was imported, but you can still modify properties of object values. The value can only be re-assigned by the module exporting it.

つまり、インポートされた値は**エクスポート元機能の読み取り専用ビュー**である。`const` 変数と同様、インポートした変数そのものは再代入できないが、**オブジェクト値のプロパティは変更できる**。値の再代入ができるのは、それをエクスポートしているモジュールだけである。

### 1.3 HTMLへの適用と `.mjs` / MIMEタイプの罠

スクリプトをモジュールとして宣言するには `<script>` に **`type="module"`** を付ける。

```html
<script type="module" src="main.js"></script>
```

`import` と `export` 文は**モジュール内でのみ使える**。`type="module"` のない通常の `<script>` で `import` を書くとエラーになる。

```html
<script>
  import _ from "lodash"; // SyntaxError: import declarations may only appear at top level of a module
</script>
```

ファイル拡張子には `.js` と `.mjs` の議論がある。V8のドキュメントは `.mjs` を推奨する（どのファイルがモジュールかが明確になり、Node.jsやBabelがモジュールとして確実にパースするため）が、MDNは当面 `.js` を使い続けると決めた。その理由の中に、診断上きわめて重要な段落がある。

> **原文**: To get modules to work correctly in a browser, you need to make sure that your server is serving them with a `Content-Type` header that contains a JavaScript MIME type such as `text/javascript`. If you don't, you'll get a strict MIME type checking error along the lines of "The server responded with a non-JavaScript MIME type" and the browser won't run your JavaScript. Most servers already set the correct type for `.js` files, but not yet for `.mjs` files. Servers that already serve `.mjs` files correctly include GitHub Pages and `http-server` for Node.js.

和訳すると、ブラウザでモジュールを正しく動かすには、サーバーが `text/javascript` のようなJavaScript MIMEタイプを含む `Content-Type` ヘッダで配信していることを確認する必要がある。そうでなければ「The server responded with a non-JavaScript MIME type」という**厳格なMIMEタイプチェックのエラー**になり、ブラウザはJavaScriptを実行しない。`.mjs` を正しく配信するサーバーには **GitHub Pages** と Node.js用の **`http-server`** がある。

> **MIMEタイプ**とは、ファイルの種類をサーバーがブラウザに伝えるラベルのこと。`text/javascript`（JavaScript）、`application/json`（JSON）、`image/png`（PNG画像）などがある。

〔補足〕この「モジュールスクリプトへの厳格なMIMEタイプチェック」はクライアントサイドセキュリティ上の意味を持つ。クラシックスクリプトはMIMEを緩く扱う実装もあるが、`type="module"` ではJavaScript MIMEが必須になるため、「アップロードした画像ファイルをモジュールとして読み込ませる」類の攻撃は成立しにくい。逆に、任意ファイルが誤って `text/javascript` で配信される設定ミス（JSON hijackingやscript gadgetの起点）や、`X-Content-Type-Options: nosniff` ヘッダの有無は診断対象になる。

### 1.4 モジュールとクラシックスクリプトの6つの差分（攻撃者が最も気にする箇所）

MDNはモジュールがクラシックスクリプトとどう違うかを列挙する。ここが診断で繰り返し効いてくる。

| 差分 | 内容 | 診断上の意味 |
| --- | --- | --- |
| ローカルテスト | `file://` で開くとJSモジュールのセキュリティ要件による**CORSエラー**になる | ダウンロードしたHTMLからのモジュール読み込みは遮断される |
| 自動strict mode | モジュールは**自動的にstrict modeを使う** | 未宣言代入がエラー、トップレベルの `this` が `undefined` |
| defer不要 | モジュールは**自動的にdeferされる** | `defer` 属性を書く必要がない |
| 1回だけ実行 | 複数の `<script>` タグで参照されても**一度だけ実行される** | 副作用は重複しない |
| モジュールスコープ | 機能は単一スクリプトのスコープにインポートされ、**グローバルには出ない** | コンソールやXSSから内部関数を直接呼べない |
| グローバルは見える | グローバル変数はモジュール内で利用可能 | `var` グローバルやClobberingがモジュールに影響し得る |

このうち「グローバルは見える」を示すMDNの例を確認する。

```html
<script>
  // A var statement creates a global variable.
  var text = "Hello";
</script>
<script type="module" src="./render.js"></script>
```

```js
/* render.js */
document.getElementById("main").innerText = text;
```

このページは `Hello` をレンダリングする。グローバル変数 `text` と `document` がモジュール内で利用可能だからである。この例からも分かるように、**モジュールは必ずしもimport/export文を必要とせず、エントリポイントが `type="module"` を持つことだけが条件**である。

〔補足〕この6項目を攻撃者視点で読み替えると次のようになる。

- **自動strict mode**：モジュール内では未宣言代入がエラーになり、`this` がトップレベルで `undefined` になる。非strictを前提にしたガジェット（gadget、既存コード片を悪用する部品）はモジュール内では動かない。
- **モジュールスコープ**：XSSペイロードからアプリのモジュール内部関数を直接呼ぶことはできない（グローバルに露出されていない限り）。逆に言えば `window.__APP__` のような明示的なグローバル露出が攻撃面になる。
- **グローバルは見える**：`var` で作られたグローバルや、DOM Clobberingによる `window.x` はモジュール内のコードにも影響し得る。

### 1.5 Import maps — bare specifierと乗っ取り面

**Import maps（インポートマップ）**は、モジュールをインポートするときにmodule specifierへほぼ任意のテキストを指定できるようにし、マップがそのテキストを実URLへ置き換える仕組みである。`<script>` に **`type="importmap"`** を付けたJSONで定義する。

```html
<script type="importmap">
  {
    "imports": {
      "shapes": "./shapes/square.js",
      "shapes/square": "./modules/shapes/square.js",
      "https://example.com/shapes/square.js": "./shapes/square.js",
      "https://example.com/shapes/": "/shapes/square/",
      "../shapes/square": "./shapes/square.js"
    }
  }
</script>
```

これにより、ブラウザでは本来使えない **bare name（拡張子もパスもない裸の名前）** をmodule specifierに使える。

```js
import { name, draw } from "square";
```

module specifierを解決できないインポートをしようとすると、JavaScriptは **`TypeError`** を投げる。マッチングには2つの重要な規則がある。

1. **末尾スラッシュなし**のキーは、キー全体がマッチされ置換される。
2. **末尾スラッシュあり**のキーは "path prefix"（パスの接頭辞）として扱われ、URLのクラス全体をリマップできる。

そして、**複数のキーが1つのmodule specifierに有効なマッチになり得る場合、ブラウザは最も具体的な（最も長い）マッチするキーを選ぶ**。バージョン管理のための **`scopes` キー**もあり、これは「インポートを実行しているスクリプトのパス」に応じて使うマップを提供する。

```json
{
  "imports": {
    "cool-module": "/node_modules/cool-module/index.js"
  },
  "scopes": {
    "/node_modules/dependency/": {
      "cool-module": "/node_modules/some/other/location/cool-module/index.js"
    }
  }
}
```

URLに `/node_modules/dependency/` を含むスクリプトが `cool-module` をインポートすると、スコープ側のバージョンが使われる。`imports` はスコープにマッチしない場合の**フォールバック**である。複数のスコープが referrer URL にマッチするなら、**最も具体的なスコープパス（最も長いscopeキー）**が最初に調べられる。

また、import mapには適用範囲の制限がある。

> **NOTE（重要）**: import mapはドキュメントにのみ適用される。仕様はworkerやworkletコンテキストでimport mapを適用する方法をカバーしていない。

サポート判定は `HTMLScriptElement.supports()` で行える。

```js
if (HTMLScriptElement.supports?.("importmap")) {
  console.log("Browser supports import maps.");
}
```

〔補足〕import mapsはクライアントサイド診断で重要な攻撃面になり得る。`<script type="importmap">` を1つ注入できれば（HTML注入があり、かつモジュールがまだ解決されていない段階なら）、bare specifierや既存URLを攻撃者制御のURLへリマップして任意スクリプト実行に繋げられる。防御側では、**CSPの `script-src` はimport mapによって解決されたURLにも適用される**ため、nonce/hashベースの厳格なCSPは `<script type="importmap">` の注入自体を防ぐ。「最長一致が勝つ」「`scopes` はimport元スクリプトのパスで選ばれる」という規則は、どのspecifierが乗っ取られ得るかを判断するための正確な仕様知識である。

### 1.6 非JavaScriptリソースのインポート（import attributes）— 設計上の防御機構

統一されたモジュールアーキテクチャの機能のひとつは、**非JavaScriptリソースをモジュールとしてロードできること**である。JSONをJavaScriptオブジェクトとして、CSSを `CSSStyleSheet` オブジェクトとしてインポートできる。ただし、**どの種類のリソースをインポートしているかを明示的に宣言しなければならない**。デフォルトではブラウザはリソースがJavaScriptだと仮定するため、**import attributes（インポート属性）**構文を使う。

```js
import colors from "./colors.json" with { type: "json" };
import styles from "./styles.css" with { type: "css" };
```

ここが防御機構である。

> **原文の要点**: ブラウザはモジュール型の検証も行い、`./data.json` がJSONファイルに解決されない場合は失敗する。これはデータをインポートするつもりだったのに誤ってコードを実行してしまうことがないようにする。

〔補足〕この型検証は設計上のセキュリティ機構である（原文が明示的に「誤ってコードを実行しないように」と述べている）。`with { type: "json" }` を付けずにJSONをインポートするとエラーになるため、「JSONエンドポイントがスクリプトとして解釈される」経路が閉じられる。

### 1.7 動的インポート `import()` — 動的コード実行のsink

**動的モジュール読み込み**は、すべてを前もって読み込むのではなく、必要になったときだけモジュールを動的に読み込む。`import()` を**関数のように**呼び、パスを渡す。返り値は **`Promise`** で、モジュールオブジェクトでfulfill（成功完了）される。

```js
import("./modules/myModule.js").then((module) => {
  // Do something with the module.
});
```

環境による制限がある。

> **NOTE（原文）**: Dynamic import is permitted in the browser main thread, and in shared and dedicated workers. However `import()` will throw if called in a service worker or worklet.

動的インポートはメインスレッド、共有worker、専用workerで許可されるが、**service workerやworklet内で呼ぶと `import()` はthrowする**。そして診断上決定的に重要なのが次の性質である。

> **原文の要点**: 動的インポートのもう1つの利点は、script環境でも常に利用可能なこと。したがってHTMLに `type="module"` のない既存の `<script>` タグがあっても、動的にインポートすることでモジュールとして配布されたコードを再利用できる。

```html
<script>
  import("./modules/square.js").then((module) => {
    // Do something with the module.
  });
</script>
```

〔補足〕`import()` はクラシックスクリプトからも使えるため、**動的コード実行sink**として扱う必要がある。`import(userControlledUrl)` は攻撃者が指定したURLのスクリプトをモジュールとして実行する。CSPの `script-src` の対象になるが、**Trusted Typesの対象外**である点（`import()` は文字列URLを取る）に注意する。診断では `import(` に変数が渡される箇所をgrepする価値がある。

### 1.8 その他のモジュール機能（差分の理解に必要な最小限）

**default export と named export**：named exportは名前で参照される。**default export**はモジュールごとに1つだけ許され、波括弧なしでインポートする。

```js
export default randomSquare;
// import側
import randomSquare from "./modules/square.js";
// これは次の短縮形
import { default as randomSquare } from "./modules/square.js";
```

**名前衝突の回避**：`as` キーワードで識別名を変更できる。同名を複数インポートすると「SyntaxError: redeclaration of import name」（Firefox）になる。制御権のないサードパーティモジュールからインポートする場合は、モジュール側でなくインポート側でリネームする方が理にかなう。

**名前空間オブジェクト**：`import * as Module from "./modules/module.js";` ですべてのエクスポートを `Module` のメンバーにできる。

**集約（re-export）**：`export { Square } from "./shapes/square.js";` で複数のサブモジュールを1つの親に束ねられる。ただしリダイレクトされるだけなので、そのファイル内に関連コードは書けない。

**top level await**：モジュール内では `await` をトップレベルで使える。モジュールが巨大な非同期関数のように振る舞い、親モジュールが使う前に評価が完了する。**ただし兄弟モジュールの読み込みはブロックしない**。

```js
// getColors.js
const colors = fetch("../data/colors.json").then((response) => response.json());
export default await colors;
```

**import宣言のホイスティング（hoisting、巻き上げ）**：import宣言は巻き上げられ、宣言位置より前でも値が使える。副作用はモジュール本体の実行前に生成される。それでも可読性のためインポートは先頭に置くのが良い慣行である。

**循環インポート（cyclic imports）**：モジュール `a` が `b` をインポートし、`b` が（直接／間接に）`a` に依存すると循環になる。

```plain
a.js ───> b.js
 ^         │
 └─────────┘
```

循環は常に失敗するわけではない。インポートされた変数の値は**実際に使われるときにのみ取得される**（これが **live bindings（ライブバインディング）**を可能にする）ため、変数が未初期化のまま使われた時だけ **`ReferenceError`** になる。

```js
// -- b.js --
import { a } from "./a.js";
console.log(a); // ReferenceError: Cannot access 'a' before initialization
export const b = 1;
```

`a` を非同期（`setTimeout` 内など）で使えば、評価完了後に値が揃うため成功する。循環除去の技法は「2モジュールを統合」「共有コードを第3モジュールへ」「一部コードを移す」である。

**isomorphic（同型）モジュール**：すべてのランタイムで同じ振る舞いをするコードのこと。3つの方法がある。(1) coreとbindingに分ける、(2) `typeof window === "undefined"` などでグローバルの存在を検出する、(3) polyfillでフォールバックを提供する（Node.jsで `fetch` がなければ `node-fetch` を使うなど）。`globalThis` はすべての環境で使えるグローバルオブジェクトである。

**トラブルシューティング（3点）**：(1) `.mjs` は `text/javascript` で配信しないと「non-JavaScript MIME type」エラーになる。(2) `file://` での読み込みはCORSエラーになるのでサーバー経由でテストする。(3) `.mjs` は非標準拡張子なので、macOSが黙って `.js` を追加し `x.mjs.js` になる例が報告された。

---

## 2. 型と型強制（Data structures）— バリデーション迂回の源泉

### 2.1 動的型・弱い型付け（なぜ強制が起きるのか）

JavaScriptは **dynamic types（動的型）**を持つ。変数は特定の型と結び付かず、どの変数にもすべての型の値を再代入できる。

```js
let foo = 42; // number
foo = "bar"; // string
foo = true;  // boolean
```

さらに **weakly typed（弱く型付けされた）**言語でもある。型が不一致な演算で型エラーを投げる代わりに、**暗黙の型変換（型強制、type coercion）**を許す。

```js
const foo = 42;
const result = foo + "1"; // fooが文字列に強制される
console.log(result); // 421
```

暗黙の強制は便利だが、変換が予期しない場所で、あるいは期待と逆方向で起きると微妙なバグを生む。なお **symbols** と **BigInts** については、JavaScriptは意図的に特定の暗黙変換を禁じている。

### 2.2 プリミティブ値と `typeof`

**Objectを除くすべての型は、言語の最下層で直接表現される不変（immutable）な値を定義する**。これを **primitive values（プリミティブ値）**と呼ぶ。`null` を除くすべてのプリミティブ型は `typeof` でテストできるが、**`typeof null` は `"object"` を返す**ので、`null` の判定には `=== null` を使わなければならない。

| Type | `typeof` の返り値 | Object wrapper |
| --- | --- | --- |
| Null | `"object"` | N/A |
| Undefined | `"undefined"` | N/A |
| Boolean | `"boolean"` | `Boolean` |
| Number | `"number"` | `Number` |
| BigInt | `"bigint"` | `BigInt` |
| String | `"string"` | `String` |
| Symbol | `"symbol"` | `Symbol` |

`null` と `undefined` を除くプリミティブは対応するラッパー型を持つ。プリミティブにプロパティアクセスすると、JavaScriptは自動的にラッパーオブジェクトにラップしてアクセスする。ただし **`null` や `undefined` へのプロパティアクセスは `TypeError`** を投げる（このため **optional chaining** `?.` が導入された）。概念的に `undefined` は「値の不在」、`null` は「オブジェクトの不在」を示す。

### 2.3 文字列型と "stringly-typing" の罠

**`String` 型はテキストデータを表し、UTF-16 code unitsを表す16ビット符号なし整数の列としてエンコードされる**。`length` はUTF-16 code unitsの数であり、実際のUnicode文字数と一致しないことがある。文字列は**immutable**で、メソッドは常に新しい文字列を作る。

MDNは "stringly-typing"（何でも文字列で表す設計）を戒める。文字列は多くのAPIの共通分母（input fields、local storageの値、`Response.text()` を使ったときの `fetch()` のレスポンスなど）だが、区切り文字でリストをエミュレートすると、**区切り文字が要素のひとつに含まれた瞬間にリストが壊れる**。テキストにだけ文字列を使い、複雑なデータは文字列をパースして適切な抽象を使え、というのが結論である。

〔補足〕「区切り文字が要素に含まれるとリストが壊れる」という指摘は、セキュリティ観点では**区切り文字注入（delimiter injection）**そのものである。カンマ区切りの権限リスト、`|` 区切りのトークン、`;` 区切りのクッキー値のようなアドホックなシリアライズは、区切り文字を含む入力で境界を越えられる。診断では自前シリアライズ箇所に区切り文字・改行・NULを注入して境界破壊を試す。

### 2.4 型強制の3つの経路（攻撃者が突く変換順序）

オブジェクトがプリミティブに変換される経路は3つあり、それぞれ呼び出すメソッドの順序が異なる。

| 経路 | 呼び出し順序 |
| --- | --- |
| **Primitive coercion** | `[Symbol.toPrimitive]("default")` → `valueOf()` → `toString()` |
| **Numeric / Number / BigInt coercion** | `[Symbol.toPrimitive]("number")` → `valueOf()` → `toString()` |
| **String coercion** | `[Symbol.toPrimitive]("string")` → `toString()` → `valueOf()` |

`[Symbol.toPrimitive]()` が存在すれば、それは**プリミティブを返さなければならず、オブジェクトを返すと `TypeError`** になる。`valueOf()` と `toString()` は、一方がオブジェクトを返すとその返り値が無視され他方が使われる。どちらもプリミティブを返さなければ `TypeError` になる。有名な例が次である。

```js
console.log({} + []); // "[object Object]"
```

`{}` も `[]` も `[Symbol.toPrimitive]()` を持たず、継承した `valueOf()` は自身（オブジェクト）を返すので無視され、`toString()` が呼ばれる。`{}.toString()` は `"[object Object]"`、`[].toString()` は `""` なので、結果は `"[object Object]"` になる。なお **`Date` と `Symbol` は `[Symbol.toPrimitive]()` をオーバーライドする唯一のビルトイン**である。`+`（単項プラス）は常にnumber coercionを行う点も覚えておく。

〔補足〕この3経路の順序表は、「オブジェクトを文字列コンテキストに送り込んで任意文字列を生成する」種のガジェットを理解する根拠になる。たとえば `{ toString() { return payload } }` を `innerHTML` に渡して文字列を注入したり、`toString`/`valueOf`/`Symbol.toPrimitive` を持つオブジェクトを渡してサニタイザの型チェックを通す。プロトタイプ汚染で `Object.prototype.toString` を差し替える攻撃も同じ機構を突く。防御側は、外部入力を受ける箇所で「文字列であること」を `typeof x === "string"` で明示的に確認し、オブジェクトを暗黙に文字列化しないことが基本になる。

---

## 3. 等価比較（Equality comparisons and sameness）

### 3.1 `===`（strict equality）— ほぼ常に正しい比較

**strict equality（厳密等価）は、比較前にどちらの値も暗黙変換しない**。型が異なれば不等である。数値では2つのエッジケースがある。

- 第1に、`+0` と `-0` は**同じ値として扱う**。
- 第2に、`NaN`（not-a-number）は**自分自身を含む他のすべての値と不等**である。`(x !== x)` が `true` になる唯一のケースは `x` が `NaN` のときである。

```js
console.log([NaN].indexOf(NaN)); // -1
switch (NaN) {
  case NaN:
    console.log("Surprise"); // 何も出力されない
}
```

`===` の他に、strict equalityは `Array.prototype.indexOf()` / `lastIndexOf()`、`TypedArray` の同メソッド、`case` マッチングでも使われる。したがって `indexOf(NaN)` で `NaN` の位置は見つけられず、`switch` の `case NaN` は決してマッチしない。

### 3.2 `==`（loose equality）— 型強制を伴う対称的比較

loose equality（緩い等価）は**対称的**で、`A == B` は常に `B == A` と同じ意味論を持つ。アルゴリズムの要点は次である。

1. 同じ型なら型ごとの規則で比較する（Objectは同一参照のときだけ `true`、など）。
2. 一方が `null` または `undefined` なら、`true` には他方も `null` または `undefined` でなければならない。
3. 一方がオブジェクトで他方がプリミティブなら、**オブジェクトをプリミティブに変換する**。
4. 両方がプリミティブになったら、型ごとに変換して比較する。要点は次の変換規則である。
   - 一方がSymbolで他方がそうでなければ `false`。
   - 一方がBooleanなら、**Booleanを数値に変換**（`true`→1、`false`→0）してから再度比較する。
   - **Number to String**：文字列を数値に変換する（失敗すれば `NaN` になり `false`）。
   - **Number to BigInt**：数学的値で比較（±Infinityや `NaN` は `false`）。
   - **String to BigInt**：`BigInt()` と同じアルゴリズムで変換（失敗すれば `false`）。

そして診断上決定的に重要な例外がある。

> **原文の要点**: ほとんどのブラウザは、非常に狭いクラスのオブジェクト（具体的には任意のページの `document.all` オブジェクト）が、いくつかのコンテキストで値 `undefined` を _エミュレート_ するかのように振る舞うことを許している。loose equalityはそのコンテキストのひとつで、`null == A` と `undefined == A` は、Aが `undefined` をエミュレートするオブジェクトである場合に限りtrueになる。

```js
const num = 0, big = 0n, str = "0", obj = new String("0");
console.log(num == str); // true
console.log(big == num); // true
console.log(num == obj); // true
```

`==` を使うのは `==` 演算子だけである。一般にloose equalityは推奨されない。strict equalityの方が結果が予測しやすく、型強制がないぶん高速に評価され得る。

〔補足〕`document.all` が `== null` / `== undefined` に対してtrueになるというMDNの記述は、**DOM Clobbering** の検討で非常に重要である。`document.all` は「undefinedをエミュレートする」唯一の残存オブジェクトで、`if (x == null)` 形式のガードを通過しつつ実体を持つ。また `==` の変換規則（Boolean→Number、String→Number、オブジェクト→プリミティブ）は、`"0" == false`、`[] == false`、`"\n" == 0` のような「認証・権限判定の比較を通す」テクニックの根拠になる。防御側は権限・認証まわりの比較で **必ず `===` を使う**ことが第一歩になる。

### 3.3 `Object.is()`（same-value equality）とsame-value-zero

**same-value equality（同値等価）**は、2つの値がすべてのコンテキストで機能的に同一かを判定する。`Object.defineProperty` で不変プロパティを「実際には変えない値」で再定義してもエラーにならないのは、内部でsame-value equalityを使って現在値と比較しているからである。これは **`Object.is`** で提供される。

**same-value-zero** はsame-value equalityに似るが、`+0` と `-0` を等しいと見なす。JavaScript APIとしては露出されていないが、`Array.prototype.includes()`、`TypedArray.prototype.includes()`、`Map` と `Set` のキー等価比較で使われる。カスタム実装は次のようになる。

```js
function sameValueZero(x, y) {
  if (typeof x === "number" && typeof y === "number") {
    return x === y || (x !== x && y !== y);
  }
  return x === y;
}
```

### 3.4 4つの等価比較の完全対応表

これは診断で頻繁に参照する表である（MDN原文の "sameness comparisons" 表）。

| x | y | `==` | `===` | `Object.is` | `SameValueZero` |
| --- | --- | --- | --- | --- | --- |
| `undefined` | `undefined` | ✅ | ✅ | ✅ | ✅ |
| `null` | `null` | ✅ | ✅ | ✅ | ✅ |
| `true` | `true` | ✅ | ✅ | ✅ | ✅ |
| `false` | `false` | ✅ | ✅ | ✅ | ✅ |
| `'foo'` | `'foo'` | ✅ | ✅ | ✅ | ✅ |
| `0` | `0` | ✅ | ✅ | ✅ | ✅ |
| `+0` | `-0` | ✅ | ✅ | ❌ | ✅ |
| `+0` | `0` | ✅ | ✅ | ✅ | ✅ |
| `-0` | `0` | ✅ | ✅ | ❌ | ✅ |
| `0n` | `-0n` | ✅ | ✅ | ✅ | ✅ |
| `0` | `false` | ✅ | ❌ | ❌ | ❌ |
| `""` | `false` | ✅ | ❌ | ❌ | ❌ |
| `""` | `0` | ✅ | ❌ | ❌ | ❌ |
| `'0'` | `0` | ✅ | ❌ | ❌ | ❌ |
| `'17'` | `17` | ✅ | ❌ | ❌ | ❌ |
| `[1, 2]` | `'1,2'` | ✅ | ❌ | ❌ | ❌ |
| `new String('foo')` | `'foo'` | ✅ | ❌ | ❌ | ❌ |
| `null` | `undefined` | ✅ | ❌ | ❌ | ❌ |
| `null` | `false` | ❌ | ❌ | ❌ | ❌ |
| `undefined` | `false` | ❌ | ❌ | ❌ | ❌ |
| `{ foo: 'bar' }` | `{ foo: 'bar' }` | ❌ | ❌ | ❌ | ❌ |
| `new String('foo')` | `new String('foo')` | ❌ | ❌ | ❌ | ❌ |
| `0` | `null` | ❌ | ❌ | ❌ | ❌ |
| `0` | `NaN` | ❌ | ❌ | ❌ | ❌ |
| `'foo'` | `NaN` | ❌ | ❌ | ❌ | ❌ |
| `NaN` | `NaN` | ❌ | ❌ | ✅ | ✅ |

この表の最下行が示すとおり、「`==` は `===` の拡張、`Object.is` はさらに厳しい版」という一次元のスペクトラム思考は成り立たない。`Object.is(NaN, NaN)` が `true` である一方 `Object.is(+0, -0)` が `false` なので、`Object.is` は独自の特徴で理解しなければならない。

一般には、ゼロの符号を区別する必要がある特殊なメタプログラミング以外では **`===` を使う**ことが推奨される。`-0` が式に紛れ込む演算子には、単項マイナス `-`、一部の `Math` メソッド（`Math.min(-0, +0)` は `-0`）などがある。ビット演算子 `~` `<<` `>>` は内部でToInt32を使うため `-0` が生き残らない（`Object.is(-0 << 2 >> 2, -0)` は `false`）。

---

## 4. 列挙可能性と所有性（Enumerability and ownership）— プロトタイプ汚染の観測可能性

### 4.1 3つの分類軸

JavaScriptオブジェクトのすべてのプロパティは3つの要因で分類できる。

- **Enumerable（列挙可能）か non-enumerable か**：内部のenumerableフラグ。単純な代入や初期化子で作ると既定でtrue。**`Object.defineProperty` で定義したプロパティは既定で列挙可能でない**。`for...in` や `Object.keys` は列挙可能なキーだけを訪問する。
- **String か symbol か**
- **Own property（自身のプロパティ）か、プロトタイプチェーンから継承されたプロパティか**

なお、列挙可能かどうか・stringかsymbolか・ownか継承かに関わらず、**すべてのプロパティはドット記法またはブラケット記法でアクセスできる**。

### 4.2 プロパティ照会の対応表（`in` vs `hasOwn`）

各メソッドが `true` を返す条件を示す（MDN原文の表）。

| | Enumerable, own | Enumerable, inherited | Non-enumerable, own | Non-enumerable, inherited |
| --- | --- | --- | --- | --- |
| `propertyIsEnumerable()` | ✅ | ❌ | ❌ | ❌ |
| `hasOwnProperty()` | ✅ | ❌ | ✅ | ❌ |
| `Object.hasOwn()` | ✅ | ❌ | ✅ | ❌ |
| `in` | ✅ | ✅ | ✅ | ✅ |

### 4.3 プロパティ走査の対応表

✅ はその型のプロパティが訪問されること、❌ は訪問されないことを意味する。

| | Enum, own | Enum, inherited | Non-enum, own | Non-enum, inherited |
| --- | --- | --- | --- | --- |
| `Object.keys` / `values` / `entries` | ✅（strings） | ❌ | ❌ | ❌ |
| `Object.getOwnPropertyNames` | ✅（strings） | ❌ | ✅（strings） | ❌ |
| `Object.getOwnPropertySymbols` | ✅（symbols） | ❌ | ✅（symbols） | ❌ |
| `Object.getOwnPropertyDescriptors` | ✅ | ❌ | ✅ | ❌ |
| `Reflect.ownKeys` | ✅ | ❌ | ✅ | ❌ |
| `for...in` | ✅（strings） | ✅（strings） | ❌ | ❌ |
| `Object.assign`（第1引数以降） | ✅ | ❌ | ❌ | ❌ |
| Object spread（`{...obj}`） | ✅ | ❌ | ❌ | ❌ |

〔補足〕この2つの表は**プロトタイプ汚染の「観測可能性」**を決める最重要資料である。汚染されたプロパティ（`Object.prototype.foo = "x"`）は次のように扱われる。

- `for...in` では **列挙される**（Enumerable, inherited が ✅）
- `Object.keys` / `Object.assign` / object spread では **列挙されない**（❌）
- `in` 演算子では **true になる**（✅）
- `hasOwnProperty` / `Object.hasOwn` では **false になる**（❌）

したがって、`if (key in opts)` でチェックするコードは汚染に反応し（脆弱側）、`if (Object.hasOwn(opts, key))` でチェックするコードは反応しない（堅牢側）。この差が脆弱・堅牢の分かれ目になる。また `Object.assign` やspreadが継承プロパティをコピーしない事実は、汚染が「値のコピー」では伝播しないことを意味する。防御側は、外部入力でオプションをマージする箇所で `in` ではなく `Object.hasOwn` を使い、`Object.create(null)` でプロトタイプなしオブジェクトを使うことが基本になる。

MDNには列挙可能性・所有性でプロパティを取得する `SimplePropertyRetriever` の実装デモも載っている（効率最優先ではないが、`Object.getOwnPropertyNames` とプロトタイプチェーン走査を組み合わせて、own/prototype × enumerable/non-enumerable の各組を取り出す手本になる）。

---

## 5. メモリ管理（Memory management）— WeakMap / WeakRef と疑似private

### 5.1 なぜWeakコレクションがあるのか

JavaScriptはガベージコレクタ（garbage collector、GC：不要になったメモリを自動回収する仕組み）APIを直接露出しないが、**GCを間接的に観測し、メモリ使用量を管理できるデータ構造**を提供する。それが `WeakMap` / `WeakSet` / `WeakRef` / `FinalizationRegistry` である。

### 5.2 WeakMap と WeakSet

**`WeakMap`** と **`WeakSet`** はAPIが `Map` / `Set` を近しく反映するが、名前のとおり値を **weakly held（弱く保持）**する。`x` が `y` によって弱く保持されるとは、`y` 経由で `x` にアクセスできるが、**他の何もが `x` を強く保持していなければmark-and-sweepが `x` を到達可能と見なさない**、という意味である。これを保証する2つの特徴がある。

- **`WeakMap` と `WeakSet` はオブジェクトまたはsymbolのみを格納できる**。オブジェクトだけがGC対象だからである。プリミティブは常にforge（同じ値を作り直す）できるので永遠に残ってしまう。`Symbol.for("key")` のようなregistered symbolもforgeできるためGC不可だが、`Symbol("key")` で作ったsymbolはGC可能。`Symbol.iterator` のようなwell-known symbolsは固定集合なのでキーに使える。
- **`WeakMap` と `WeakSet` はiterableでない**。`Array.from(map.keys()).length` でオブジェクトの生存性を観測されるのを防ぐ（GCはできる限り不可視であるべき）。

値がキーを参照するケースには注意が必要である。

```js
const wm = new WeakMap();
const key = {};
wm.set(key, { key });
// valueがkeyを参照し、valueはmapに強く保持されるため、
// keyはガベージコレクトできなくなる。
```

これを解くため、`WeakMap` / `WeakSet` のエントリは実際の参照ではなく **ephemerons（エフェメロン）**であり、mark-and-sweepの拡張になっている。粗いメンタルモデルとしてMDNは次の実装を示す（**これはpolyfillでもエンジン実装でもない**という警告付き）。

```js
class MyWeakMap {
  #marker = Symbol("MyWeakMapData");
  get(key) {
    return key[this.#marker];
  }
  set(key, value) {
    key[this.#marker] = value;
  }
  has(key) {
    return this.#marker in key;
  }
  delete(key) {
    delete key[this.#marker];
  }
}
```

これはキーのコレクションを保持せず、各オブジェクトにメタデータを付けるだけである。だから**`WeakMap` のキーを反復することもクリアすることもできない**。

### 5.3 WeakRef と FinalizationRegistry

> **NOTE（原文）**: `WeakRef` and `FinalizationRegistry` offer direct introspection into the garbage collection machinery. Avoid using them where possible because the runtime semantics are almost completely unguaranteed.

**`WeakRef`** はオブジェクトへの **weak reference（弱参照）**で、オブジェクトがGCされることを許しつつ、生存中は `deref()` で内容を読める。用途の例は「URL文字列→大きなオブジェクト」のキャッシュである。ここで `WeakMap` が使えない理由は、`WeakMap` は**キーが弱く保持されるが値は強く保持される**ため、到達不能なオブジェクトがキャッシュに留まってしまうからである。代わりに通常の `Map` に `WeakRef` を格納する。

```js
function cached(getter) {
  const cache = new Map();
  return async (key) => {
    if (cache.has(key)) {
      const dereferencedValue = cache.get(key).deref();
      if (dereferencedValue !== undefined) {
        return dereferencedValue;
      }
    }
    const value = await getter(key);
    cache.set(key, new WeakRef(value));
    return value;
  };
}
```

**`FinalizationRegistry`** はオブジェクトを登録し、GCされたときに通知を受け取れる。上のキャッシュで、blobが回収されても残る `WeakRef` エントリの掃除に使える。

〔補足〕`WeakMap` は「クロージャに代わる疑似privateストレージ」として広く使われる（`privateData.get(this)`）。クラスの `#field`（hard private）と異なり、**`WeakMap` インスタンスへの参照を持つ同一スコープのコードからは読める**ので、モジュール内に閉じられていない限り機密の保証にはならない。また `WeakRef` / `FinalizationRegistry` はGCのタイミングを観測できるため、理論上サイドチャネル（メモリ圧の観測）の懸念が議論される機能でもある。MDNは「ランタイムの意味論がほぼ完全に無保証」なので可能な限り使用を避けよと明記している。

---

## 6. 言語全体像（Language overview）— 言語レベルとランタイムレベルの境界

### 6.1 非同期プログラミングの前提

**JavaScriptは本質的にシングルスレッド**である。並列化（paralleling）はなく、並行性（concurrency）のみがある。非同期コードは **event loop（イベントループ）**で駆動され、タスクをキューに入れて完了をポーリングする。慣用的な書き方はコールバックベース、`Promise` ベース、`async`/`await`（Promiseの糖衣構文）の3つである。

コア言語は非同期機能を一切規定していないが、外部環境との相互作用（Permissions APIでの権限要求、データのfetch、ファイル読み込み）には不可欠である。**非同期の値は同期的に取り出せない**。promiseの結果に依存するロジックだけが遅延され、それ以外はその間も実行を続ける（**promiseは決してブロックしない**）。ただし純粋なJavaScriptのCPUバウンドなタスクは依然メインスレッドをブロックするため、真の並列化にはworkersが要る。

### 6.2 モジュール解決はhost定義である

JavaScriptはモジュールシステムを規定する。**モジュールは通常ファイルで、ファイルパスまたはURLで識別される**。ただしHaskell、Python、Javaなどと異なり、**JavaScriptのモジュール解決は完全にhost（ランタイム）定義**である。相対パスは「プロジェクトルート」ではなく**現在のモジュールのパスに対して相対的**に解決される。また**JavaScript言語は標準ライブラリモジュールを提供しない**。`Math` や `Intl` のようなコア機能はすべてグローバル変数で提供される。ランタイムによってシステムは異なり、Node.jsはnpmでファイルシステムベース、Denoとブラウザは完全にURLベースである。

### 6.3 言語レベルとランタイムレベルの区別（診断の地図）

これがこの節で最も重要な概念である。

- **コア言語仕様（ECMAScript）は純粋な計算ロジックに焦点を当て、入出力を一切扱わない**。追加のランタイムAPI（最も顕著には `console.log()`）なしでは、JavaScriptプログラムの振る舞いは完全に観測不能である。
- **runtime（= host）**は、JavaScriptエンジンにデータを供給し、追加のグローバルプロパティを提供し、外界とやり取りするフックを提供する。**モジュール解決、データの読み取り、メッセージの印字、ネットワーク要求の送信はすべてランタイムレベルの操作**である。

```plain
┌──────────────────────────────────────────────┐
│  ランタイムレベル（host: ブラウザ / Node.js）    │
│  DOM, fetch, location, innerHTML, document ... │  ← DOM XSSのsinkの多くはここ
│  ┌────────────────────────────────────────┐  │
│  │  言語レベル（ECMAScript コア）            │  │
│  │  eval, Function, 型強制, プロトタイプ,    │  │  ← 言語機能を突く攻撃はここ
│  │  Proxy/Reflect, ==/=== ...              │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

〔補足〕この区別はクライアントサイド脆弱性ハンティングの地図そのものである。DOM XSSのsink（`innerHTML`、`document.write`、`location`、`eval` の一部）の多くは**ランタイム（DOM/Web API）側**にあり、ECMAScript仕様には存在しない。一方 `eval`/`Function`/型強制/プロトタイプ機構は**言語レベル**にある。この2層を分けて考えると、「同じJSコードがブラウザではXSSになるがNode.jsでは別の影響になる」といった判断が整理できる。MDNのガイド末尾は、紙幅の都合で省いたが自分で探索すべき本質として **Inheritance and the prototype chain / Closures / Regular expressions / Iteration** を挙げている。

---

## 7. クライアントサイド脆弱性ハンティングへの対応表（この節の材料の索引）

ここまでの内容と、ユニット17a・17bで扱う内容を、診断観点から一覧にまとめる。これはMDNガイド全体を「どこを読めば何が分かるか」の地図として使うための索引である。

| 診断観点 | 関連する言語機能・章 | MDN原文の根拠 |
| --- | --- | --- |
| Object injection（ブラケット記法） | Working with objects | 「beware of using square brackets to access properties whose names are given by external input」＋ eslint-plugin-securityへのリンク |
| プロトタイプ汚染の機構 | プロトタイプチェーン | プロパティ探索順序、シャドウイング、`__proto__` の2つの意味、`Object.create(null)`、`Object.setPrototypeOf` |
| 汚染の観測可能性（`in` vs `hasOwn`） | 本節4.2 / 4.3の表 | Querying / Traversing の2表 |
| ビルトイン改変（monkey patching） | プロトタイプ章のWARNING | SmooshGateへの言及、「唯一の正当な理由はbackport」 |
| 動的コード実行sink | `Function` コンストラクタ（≒`eval`）、本節1.7の `import()` | 「much like `eval()`」／「Dynamic import ... always available, even in script environments」 |
| 型強制によるバリデーション迂回 | 本節2.4 / 3.2 / 3.4 の表 | `==` のアルゴリズム、3つのcoercion経路、sameness比較表 |
| DOM Clobberingの前提（`document.all`） | 本節3.2 | 「most browsers permit ... `document.all` ... to act as if they emulate the value `undefined`」 |
| グローバル汚染（未宣言代入、非strict `this`） | Grammar and types / Functions | 「undeclared global ... an error in strict mode」／非strictで `this` がグローバルオブジェクト |
| フレーム間アクセス | Global variables | 「you can access global variables declared in one window or frame from another ... `parent.phoneNumber`」 |
| 競合状態・マイクロタスク順序 | Using promises（Timing） | Guaranteesの3項目、microtask vs task queueの出力例 |
| 非同期エラーの可視化・情報漏えい | Using promises（rejection events） | `unhandledrejection` / `rejectionhandled` / `PromiseRejectionEvent.reason` |
| モジュールのセキュリティ差分 | 本節1.4 | 自動strict mode、`file://` CORS、自動defer、1回だけ実行、グローバルに出ない |
| MIMEタイプ厳格チェック | 本節1.3 / 1.8 | 「strict MIME type checking error ... non-JavaScript MIME type」 |
| import map経由の乗っ取り面 | 本節1.5 | `imports` / `scopes`、最長一致、ドキュメント限定（worker/worklet非対応） |
| 非JSリソース読み込みの型検証 | 本節1.6 | 「This ensures that you don't accidentally execute code when you just intend to import data」 |
| フック・計測（taint追跡の実装） | Meta programming（Proxy/Reflect） | 13トラップと横取り操作の完全表、`typeof` はトラップを発火しない |
| 疑似private vs hard private | Using classes / 本節5.2 | 「private fields ... are _hard private_」／WeakMapのメンタルモデル |
| イテレーション乗っ取り | Iterators and generators | `[Symbol.iterator]` が spread / destructuring / `for...of` / `yield*` に効く |
| 文字列エスケープ・Unicode迂回 | Grammar and types（特殊文字表） | `\xXX` / `\uXXXX` / `\u{XXXXX}`（サロゲートペア等価）／`\XXX` 8進 |
| 区切り文字注入 | 本節2.3 "stringly-typing" | 「when the separator is used in one of the 'list' elements, then, the list is broken」 |

> **表の使い方**：バグバウンティで対象のクライアントサイドコードを読むとき、まず「入力がどこから来て（source）、どこへ流れるか（sink）」を追う。sinkが見つかったら、この表で「その機構をMDNのどの章で確認できるか」を引く。たとえば `opts[userKey] = val` を見たらObject injectionとプロトタイプ汚染の行を、`import(x)` を見たら動的コード実行sinkの行を、`if (x == null)` を見たらDOM Clobberingと型強制の行を確認する、という使い方をする。

---

## 手を動かす

以下はすべて**自分で立てた検証環境**を前提とする。他者のサイトに対しては、明示的な許可（バグバウンティのスコープ内など）がある場合のみ行う。

1. **モジュールが `file://` で動かないことを体験する。** 適当なフォルダに次の2ファイルを置く。

   ```html
   <!-- index.html -->
   <script type="module" src="./m.js"></script>
   ```

   ```js
   // m.js
   console.log("module loaded");
   ```

   これを `file://` で直接ブラウザに開くとCORSエラーになる。次に同じフォルダで簡易サーバーを立てて `http://localhost:8000/` で開くと動く。

   ```bash
   python3 -m http.server 8000
   ```

2. **型強制でガードを抜けることを確認する。** ブラウザのDevToolsコンソール（F12）で次を打ち、`===` と `==` の差を見る。

   ```js
   "0" == false;   // true  ← 権限チェックが == なら "0" で抜ける可能性
   "0" === false;  // false
   [] == false;    // true
   ```

3. **プロトタイプ汚染の観測可能性を確かめる。** コンソールで次を実行し、`in` と `Object.hasOwn` の反応差を見る。

   ```js
   Object.prototype.polluted = "x";
   const o = {};
   "polluted" in o;            // true  ← 汚染に反応する
   Object.hasOwn(o, "polluted"); // false ← 反応しない
   Object.keys(o);             // []    ← spread/keysには出ない
   delete Object.prototype.polluted; // 後片付け
   ```

4. **`import()` を動的コード実行sinkとして意識する。** コードレビュー時は次のようにgrepして、変数が渡される動的インポートを洗い出す。

   ```bash
   grep -rnE "import\s*\(" ./src | grep -v "import(['\"]"
   ```

   文字列リテラルでないパスが `import()` に入っていれば、その値がどこから来るかを追う。

5. **WeakMapの疑似privateが同一スコープから読めることを確認する。** モジュール外に `WeakMap` インスタンスが露出していれば `wm.get(instance)` で中身が読める。`#field` では `SyntaxError` になり読めない。この違いを実際に試す。

---

## つまずきポイント

- **「モジュールはグローバルに出ないから安全」は誤解。** モジュールの内部関数はグローバルに露出されないが、`window.__APP__ = internalFn` のような明示的露出があれば攻撃面になる。逆にグローバル変数やClobberingはモジュール内に「入って」くる。
- **`==` を「型を無視する便利な比較」と思ってはいけない。** 変換規則は複雑で、`"0" == false` や `[] == false` のような非直感的なtrueを生む。認証・権限の比較では必ず `===` を使う。
- **`Object.is` は `===` の厳しい版ではない。** `NaN` の扱い（`Object.is(NaN, NaN)` は `true`）のせいで、緩さ・厳しさの一次元スペクトラムに収まらない。特殊なメタプログラミング以外では `===` を使う。
- **プロトタイプ汚染は `Object.keys` では見えない。** 汚染は `for...in` と `in` には現れるが、`Object.keys` / `Object.assign` / spread には現れない。「keysに出ないから汚染されていない」は誤り。
- **import mapはドキュメント限定。** worker/workletでは適用されないので、workerのモジュール解決を守るつもりでimport mapを使っても効かない。
- **`import()` はTrusted Typesの対象外。** 文字列URLを取るため、DOM sinkを守るTrusted Typesでは防げない。CSPの `script-src` で守る。
- **`WeakMap` によるprivateはhard privateではない。** `WeakMap` 参照を持つコードからは読める。真に隠すにはクラスの `#field` を使うか、`WeakMap` をモジュール内に閉じ込める。
- **`.mjs` のMIMEタイプ設定漏れで動かない。** サーバーが `.mjs` を `text/javascript` で返さないと「non-JavaScript MIME type」エラーになる。

---

## この節のまとめ

- モジュール（ESM）は `export` / `import` で機能を出し入れし、`from` の後ろの文字列を module specifier と呼ぶ。インポートされた値は読み取り専用ビューである。
- `type="module"` は自動strict mode、自動defer、1回だけ実行、モジュールスコープ、`file://` でのCORSエラーという6つの差分をクラシックスクリプトに対して持つ。
- モジュールスクリプトには厳格なMIMEタイプチェックがあり、`text/javascript` で配信しないと実行されない。これは画像等をスクリプトとして読み込む攻撃を抑止するが、設定ミスは診断対象になる。
- import mapsはmodule specifierを実URLへリマップし、末尾スラッシュの有無でprefixマッチが決まり、最長一致が勝つ。`scopes` はimport元スクリプトのパスで選ばれ、ドキュメントにのみ適用される。HTML注入と組み合わさると乗っ取り面になり、厳格なCSPで防ぐ。
- import attributes（`with { type: "json" }`）は型検証により「データを誤ってコード実行する」経路を閉じる設計上の防御機構である。
- 動的 `import()` はPromiseを返し、service worker/worklet以外で使え、クラシックスクリプトからも呼べるため動的コード実行sinkとして扱う。Trusted Types対象外、CSP `script-src` 対象。
- JavaScriptは動的型・弱い型付けで、暗黙の型強制が起きる。オブジェクト→プリミティブ変換にはPrimitive / Numeric / Stringの3経路があり、`[Symbol.toPrimitive]` → `valueOf`/`toString` の順序が経路ごとに違う。
- `toString`/`valueOf`/`Symbol.toPrimitive` を持つオブジェクトを渡すガジェットで、サニタイザの型チェックを抜けたり任意文字列を注入したりできる。
- `===` はほぼ常に正しい比較で、`+0`/`-0` を同一、`NaN` を自身とも不等に扱う。`==` は型強制を伴い、`"0" == false` のような非直感的なtrueを生む。認証・権限比較では `===` を使う。
- `document.all` は `== null` / `== undefined` にtrueを返す唯一の残存オブジェクトで、DOM Clobberingでガードを抜ける前提になる。
- `Object.is` は独自の等価で、`NaN` を等しく `-0`/`+0` を区別する。4つの等価（`==` / `===` / `Object.is` / SameValueZero）の対応表は診断の常用資料。
- 列挙可能性・所有性の2表は、プロトタイプ汚染の観測可能性を決める。汚染は `for...in`・`in` に現れ、`Object.keys`・`hasOwn`・spreadには現れない。`in` チェックは脆弱、`Object.hasOwn` チェックは堅牢。
- `WeakMap`/`WeakSet` はオブジェクト/symbolのみ格納しiterableでなく、ephemeronsで循環参照を扱う。疑似privateに使われるがhard privateではない。`WeakRef`/`FinalizationRegistry` はGCを観測でき、無保証なので使用は避けるべき。
- 「言語レベル（ECMAScript）」と「ランタイムレベル（DOM/Web API）」の区別が診断の地図になる。DOM XSSのsinkの多くはランタイム側、型強制やプロトタイプ機構は言語側にある。

---

## 理解度チェック

1. `type="module"` のスクリプトがクラシックスクリプトと異なる点を3つ挙げ、それぞれ攻撃者/防御者にとって何を意味するか述べよ。
   - **▶ 答え**：(1) 自動strict mode → 未宣言代入がエラー・トップレベルの `this` が `undefined` になり、非strict前提のガジェットが動かない。(2) モジュールスコープ → 内部関数がグローバルに出ず、XSSから直接呼べない（逆に明示的グローバル露出が攻撃面）。(3) `file://` でCORSエラー → ダウンロードしたローカルHTMLからのモジュール読み込みが遮断される。他に自動defer、1回だけ実行、グローバル変数はモジュール内で見える、も可。

2. import mapで `shapes/` と `shapes/circle/` の両方が module specifier `shapes/circle/foo` にマッチするとき、どちらが選ばれるか。またその規則が乗っ取り面とどう関係するか。
   - **▶ 答え**：最も具体的な（最も長い）マッチするキー、すなわち `shapes/circle/` が選ばれる。攻撃者が `<script type="importmap">` を注入できる場合、この最長一致規則を使ってどのspecifierがどのURLに解決されるかを予測・操作できる。厳格なCSP（nonce/hash）でimport map注入自体を防ぐ。

3. `import()` を「動的コード実行sink」として扱うべき理由を2つ述べよ。
   - **▶ 答え**：(1) `import(userControlledUrl)` は攻撃者指定URLのスクリプトをモジュールとして実行する。(2) クラシックスクリプト（`type="module"` なしの `<script>`）からも常に利用可能なので、モジュール未使用のページでも実行経路になり得る。加えて文字列URLを取るためTrusted Types対象外である。

4. `"0" == false` が `true` になる過程を、`==` の変換規則に沿って説明せよ。
   - **▶ 答え**：一方がBoolean（`false`）なので、まずBooleanを数値に変換して `false`→`0` になる。次に `"0" == 0` の比較で、Number to Stringの規則により文字列 `"0"` を数値に変換して `0` になる。`0 == 0` は `true`。したがって全体で `true`。

5. `Object.prototype.foo = "x"` で汚染したとき、`"foo" in obj`、`Object.hasOwn(obj, "foo")`、`Object.keys(obj)` はそれぞれどうなるか。
   - **▶ 答え**：`"foo" in obj` は `true`（`in` は継承プロパティも見る）、`Object.hasOwn(obj, "foo")` は `false`（ownのみ）、`Object.keys(obj)` は空配列（列挙可能なownのみ、継承は含まない）。したがって `in` を使うコードは汚染に反応し、`Object.hasOwn` を使うコードは反応しない。

6. `document.all` が診断上特別なのはなぜか。
   - **▶ 答え**：ほとんどのブラウザで `document.all` は値 `undefined` を「エミュレート」する唯一の残存オブジェクトで、`null == document.all` / `undefined == document.all` が `true` になる。そのため `if (x == null)` 形式のガードを通過しつつ実体（DOM要素等）を持てる。DOM Clobberingで認証・存在チェックを抜ける前提になる。

7. `WeakMap` による疑似privateと、クラスの `#field`（hard private）の違いを述べよ。
   - **▶ 答え**：`#field` はhard privateで、クラス外からは構文的に一切アクセスできない（`SyntaxError`）。`WeakMap` による疑似privateは、その `WeakMap` インスタンスへの参照を持つ同一スコープのコードからは `wm.get(instance)` で読める。したがって `WeakMap` をモジュール内に閉じ込めていなければ機密の保証にはならない。

8. なぜMDNは `WeakRef` と `FinalizationRegistry` の使用を「可能な限り避けよ」と言うのか。
   - **▶ 答え**：これらはGC機構への直接的なイントロスペクション（内部観測）を提供するが、**ランタイムの意味論がほぼ完全に無保証**だからである。いつ・どのようにGCが起きるかは実装依存で予測できず、GCタイミングの観測はサイドチャネルの懸念にもつながる。

9. 「言語レベル」と「ランタイムレベル」の区別が、DOM XSSの理解にどう役立つか。
   - **▶ 答え**：DOM XSSのsink（`innerHTML`、`document.write`、`location` など）の多くはランタイム（DOM/Web API）側にあり、ECMAScript仕様には存在しない。一方 `eval`/`Function`/型強制/プロトタイプはコア言語側にある。この2層を分けると、どのsinkがどの環境（ブラウザ／Node.js）で危険になるかを整理でき、同じコードでも環境による影響差を判断できる。

---

## 出典

- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide （ハブ／目次）
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Enumerability_and_ownership_of_properties
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Memory_management
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Language_overview
- https://github.com/mdn/content （MDN公式コンテンツリポジトリ、原稿の代替取得元）
- https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md
- https://v8.dev/features/modules
- https://hacks.mozilla.org/2018/03/es-modules-a-cartoon-deep-dive/
- https://hacks.mozilla.org/2015/08/es6-in-depth-modules/
- https://exploringjs.com/es6/ch_modules.html
- https://dorey.github.io/JavaScript-Equality-Table/

---

## 読者が自分で開くべき資料（この節の範囲）

本ノートの内容はすべて取得できたが、**developer.mozilla.org 自体がこの執筆環境の egress proxy によってブロックされており（`EGRESS_BLOCKED` / CONNECT 403）、web.archive.org も同様にブロックされていた**。そのため MDN の公式コンテンツリポジトリ（`github.com/mdn/content`）のソース Markdown を取得して代替した。内容は同一の原稿だが、次の要素はソース Markdown には含まれず、レンダリング済みページでしか得られないので、必ず自分でブラウザから原典を開くことを推奨する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: MDN JavaScript Guide（レンダリング済みページ一式）— https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress proxy による制限、`EGRESS_BLOCKED` / CONNECT 403）。以下の記述は公式ソースリポジトリ `github.com/mdn/content` の同一原稿にもとづく要約である。
> **読みどころ**:
> 1. **ライブサンプルの実動作** — Closures 章の「practical closures」や「closures_bad / closures_factory」（ループ内クロージャのバグと修正）は、レンダリング済みページ上で実際にクリック・フォーカスして挙動差を体験できる。ソース Markdown ではマクロ呼び出しに置き換わっている。
> 2. **サイドバー（jssidebar）の完全なナビゲーション** — 各章からリファレンス（Statements / Operators / Global Objects / Functions / Classes / Errors）へのリンク網は、「この構文の正確な仕様はどこか」を辿る地図になる。特に `Reference/Iteration_protocols`、`Reference/Execution_model`、`Reference/Strict_mode`、`Reference/Lexical_grammar`。
> 3. **ブラウザ互換性テーブル（BCD）** — `using` / `await using`、import maps、import attributes（`with { type: "json" }`）、top-level await、`WeakRef` / `FinalizationRegistry` は比較的新しく、対象ブラウザで使えるかはページ下部の互換性テーブルで確認する。診断対象が古いブラウザ想定なら影響する。
> 4. **Proxy リファレンス（各トラップの詳細）** — Meta programming 章の表は「どのトラップがどの操作を横取りするか」の一覧だが、各トラップの引数・返り値・invariant 違反の具体条件は `Reference/Global_Objects/Proxy/Proxy` の各サブページにある。フックを正しく実装する（`TypeError` を避ける）にはそちらが必要。
> **代替手段**: MDN 公式ソースリポジトリ `https://github.com/mdn/content`（本文・コード・表は逐語で確認できる。ただしライブサンプル・BCD・サイドバーは描画されない）。

> ### 📌 ここは自分で開いて読んでください
> **資料**: eslint-plugin-security「the dangers of square bracket notation」— https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md
> **なぜ**: 本教科書の執筆環境からは取得対象外だった（理由: サイト側の制限で MDN 本体が取得できず、リンク先の外部文書も未取得）。MDN の Working with objects 章が唯一明示的にリンクしているセキュリティ文書であり、object injection の具体的な悪用パターンと ESLint による検出方法が書かれている。以下の記述は MDN の言及（「外部入力で与えた名前をブラケット記法でプロパティアクセスに使うと object injection attack に脆弱になり得る」）にもとづく。
> **読みどころ**:
> 1. `obj[userInput]` 形式のブラケットアクセスがなぜ危険か（`__proto__`・`constructor`・`prototype` へのアクセスとプロトタイプ汚染への接続）。
> 2. ESLint ルール（`security/detect-object-injection`）がどのパターンを検出し、どう修正すべきか。
> **代替手段**: 本節4.2/4.3の観測可能性の表と、ユニット17bのプロトタイプ章（`Object.create(null)`・`Object.hasOwn` による防御）を併読する。

〔補足〕本ノートで目次には挙げたが本文を詳細収録していない章がある。特に **Regular expressions（Assertions / Character classes / Groups and backreferences / Quantifiers の4サブページ）** は ReDoS と正規表現によるバリデーション迂回（アンカー欠落、`.` の改行非マッチ、`lastIndex` の状態）の理解に直結するため、別途原典を参照するとよい。他に Control flow and error handling、Loops and iteration、Expressions and operators、Numbers and strings、Representing dates & times、Indexed collections、Keyed collections、Typed arrays、Resource management（`using` / `await using` / `DisposableStack`）、Internationalization も未収録である。

<!-- sources: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Enumerability_and_ownership_of_properties, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Memory_management, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Language_overview, https://github.com/mdn/content, https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md -->
<!-- terms: モジュール（ESM）, module specifier, import maps, import attributes, 動的import(), top level await, 循環インポート, live bindings, 型強制（type coercion）, primitive coercion, strict equality（===）, loose equality（==）, Object.is, SameValueZero, document.all, 列挙可能性, Object.hasOwn, プロトタイプ汚染, WeakMap, WeakRef, FinalizationRegistry, ephemerons, hard private, event loop, 言語レベルとランタイムレベル, MIMEタイプ厳格チェック, sink, 区切り文字注入, DOM Clobbering -->
<!-- self-read: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide | サイト側のegress proxy制限（EGRESS_BLOCKED / CONNECT 403）でレンダリング済みページ・ライブサンプル・BCD・サイドバーが自動取得できず、ソースMarkdownで代替した -->
<!-- self-read: https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md | MDN本体が取得できず、リンク先の外部セキュリティ文書も未取得のため -->
