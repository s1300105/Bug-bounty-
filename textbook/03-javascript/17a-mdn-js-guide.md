# JavaScript の土台：宣言・型変換・関数・クロージャを攻撃者の目で読む

> **この節で分かること**
> - MDN JavaScript ガイドの全体構成と、「ガイド」と「リファレンス」の役割分担を説明できる
> - 変数宣言（`var`/`let`/`const`）・巻き上げ・TDZ・未宣言グローバル・識別子規則の仕組みと、それがグローバル汚染にどう関わるかを説明できる
> - 動的型付けと型強制（coercion）が、クライアントサイドのバリデーション迂回にどう使われるかを説明できる
> - 配列リテラル・オブジェクトリテラル・テンプレートリテラルの構文と、`__proto__:` キーやタグ付きテンプレートがプロトタイプ汚染・注入とどう関わるかを説明できる
> - 文字列の特殊文字エスケープ（`\xXX`/`\uXXXX`/`\u{XXXXX}`）が、注入とサニタイザ迂回にどう関わるかを説明できる
> - `Function` コンストラクタが `eval()` 相当の動的コード実行 sink であることを指摘できる
> - クロージャの仕組み（スコープチェーン・ライブバインディング含む）を理解し、「クロージャで秘密を隠す」パターンがクライアントサイドでは機密性を保証しないことを説明できる

**元資料**: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide （原典は取得できず二次情報ベース。developer.mozilla.org は実行環境の egress プロキシにブロックされたため、MDN 公式コンテンツリポジトリ `github.com/mdn/content` のソース Markdown、すなわちレンダリング前の原稿そのものを取得した。本文・コード・表は逐語で取得済み）
**関連する節**: 同ノートの後半パート（Working with objects／プロトタイプ／メタプログラミング／Promise／モジュール）

---

## 1. MDN JavaScript ガイドとは何か

### 1.1 「ガイド」と「リファレンス」の役割分担

MDN JavaScript ガイド（MDN JavaScript Guide）とは、JavaScript 言語の全体像を与えるための解説文書のこと。冒頭で自らの役割をこう定義している。

> The JavaScript Guide shows you how to use JavaScript and gives an overview of the language. If you need exhaustive information about a language feature, have a look at the JavaScript reference.

つまり「使い方と概観」はガイドが担当し、「ある機能の網羅的・厳密な情報」はリファレンス（JavaScript Reference）が担当する、という分業になっている。バグバウンティで「この構文の正確な挙動はどこまで保証されるのか」を確かめたいときは、ガイドで当たりを付けてリファレンスで裏を取る、という流れになる。

### 1.2 ガイドの章立て（全体地図）

ガイドは18の主要章と、その後に置かれる8本の上級トピック（Advanced topics）で構成される。攻撃面（attack surface、攻撃者が狙える入口の総体）を意識しながら地図を頭に入れておくと、後で「どの機能がどの脆弱性に効くか」を辿りやすい。

| 区分 | 章 |
| --- | --- |
| 主要章 | Introduction / Grammar and types / Control flow and error handling / Loops and iteration / Functions / Expressions and operators / Numbers and strings / Representing dates & times / Regular expressions / Indexed collections / Keyed collections / Working with objects / Using classes / Promises / Typed arrays / Iterators and generators / Resource management / Internationalization / JavaScript modules |
| 上級トピック | Language overview / Data structures / Enumerability and ownership of properties / Inheritance and the prototype chain / Equality comparisons and sameness / Closures / Meta programming / Memory management |

上級トピックの導入文は次のとおり。

> After you have learned all fundamental features of JavaScript, you can explore some more niche features, or dive deeper into the language's mechanisms and concepts.

〔補足〕旧版 MDN にあった「Details of the object model」という章名は、現行では **Inheritance and the prototype chain**（プロトタイプチェーンによる継承）と **Using classes** に分割・改題されている。プロトタイプ汚染（prototype pollution）の前提知識を探すときは前者を見ればよい。

この節（パート1）では、地図のうち **Introduction / Grammar and types / Functions / Closures** を扱う。オブジェクト・プロトタイプ・メタプログラミング・Promise・モジュールは後半パートの担当である。

---

## 2. Introduction：JavaScript とは何か、そしてブラウザとの境界

### 2.1 JavaScript の定義とホスト環境

MDN は JavaScript をこう定義する。

> JavaScript is a cross-platform, object-oriented scripting language used to make webpages interactive (e.g., having complex animations, clickable buttons, popup menus, etc.).

ここで重要なのは、JavaScript 単体は「コア言語」しか持たず、実際にできることは**ホスト環境（host environment）**が与えるオブジェクト次第だという点。ホスト環境とは、JavaScript を動かす土台となるプログラム（ブラウザやサーバー）のこと。

- **クライアントサイド JavaScript（Client-side JavaScript）**：ブラウザとその DOM を制御するオブジェクトでコア言語を拡張する。フォーム要素の配置、マウスクリック・フォーム入力・ページ遷移といったユーザーイベントへの応答ができる。
- **サーバーサイド JavaScript（Server-side JavaScript）**：サーバー上のオブジェクトで拡張する。データベース通信、呼び出し間の情報継続、ファイル操作など。

クライアントサイド脆弱性ハンティングの対象は前者、すなわち「コア言語 + ブラウザが露出したオブジェクト（DOM など）」の組み合わせである。

### 2.2 ECMAScript は DOM を定義しない、という決定的な事実

JavaScript の標準化版は **ECMAScript** と呼ばれ、**ECMA-262** という仕様書に記述される（ISO では ISO-16262 として承認）。エンジンの例として SpiderMonkey（Firefox）、V8（Chrome）が挙げられている。

ここで攻撃者視点で最重要なのは次の一文である。

> ECMAScript 仕様は DOM を記述しない。DOM は W3C および/または WHATWG が標準化する。

つまり「言語仕様（ECMAScript）」と「ブラウザが提供する API（DOM）」は別の標準団体が定めた別物であり、その境界にこそクライアントサイド脆弱性が集まる。`document.write`、`innerHTML`、`location` といった危険な sink（データが最終的に流れ込んで害を成す場所）は、ECMAScript ではなく DOM 側の仕様に属する。言語のルールと DOM のルールを混同しないことが、後の章を理解する前提になる。

### 2.3 コンソールは `eval` と同じように動く

MDN は、モダンブラウザさえあれば学習に十分だとし、**JavaScript コンソール（Web Console、単に console）**を紹介する。ここには診断作業に直結する性質がある。

> コンソールは `eval` とまったく同じように動作し、最後に入力した式が返る。

概念的には、入力が毎回 `console.log` と `eval` で囲まれていると考えればよい。

```js
console.log(eval("3 + 5"));
```

〔補足〕DevTools コンソールが `eval` 相当で動くという性質は、診断でページのオリジン上の JS コンテキストを直接触るときの前提になる。あなたが権限を持つ検証環境やバグバウンティ対象で、コンソールに式を打ち込んで挙動を確かめる作業は、まさにこの `eval` 相当の入口を使っている。後述の「Chrome コンソールでは private field に外からアクセスできる」という MDN の注記も同じ文脈にある。

---

## 3. Grammar and types：宣言・スコープ・巻き上げ

ここからが言語のコアである。「なぜこの設計か → どう動くか → どこを突けるか」の順で読んでいく。

### 3.0 基本構文：大文字小文字の区別と自動セミコロン挿入

JavaScript は構文の大半を Java, C, C++ から借用し、Awk, Perl, Python からも影響を受けた言語である。ここで診断上意味を持つ2つの性質を押さえておく。

**（1）大文字小文字を区別し（case-sensitive）、Unicode 文字集合を使う。** ドイツ語の "Früh"（早い）のような Unicode 文字も変数名に使える。

```js
const Früh = "foobar";
```

しかし `früh` は `Früh` と同一ではない。大文字小文字（およびアクセント付き Unicode 文字）を区別するため、この2つは**別の識別子**になる。識別子を突き合わせてブラックリスト照合するようなコードでは、大文字小文字や Unicode 正規化の差が照合すり抜けの材料になり得る。

**（2）自動セミコロン挿入（ASI, automatic semicolon insertion）がある。** 文は `;` で区切るのが原則だが、行を分ければセミコロンは省略でき、ECMAScript が終端を補う。ただし1行に複数文を書くならセミコロンは必須。

> NOTE（原文）：ECMAScript には文を終端するための自動セミコロン挿入（ASI）の規則がある。詳細は lexical grammar のリファレンスを参照。

ベストプラクティスとしては、厳密に不要でも常にセミコロンを書く。ASI が意図しない位置で終端を補うことによるバグの混入確率が下がるためである。

### 3.1 5種類の変数宣言

MDN は JavaScript に5種類の変数宣言があると明記する（本章で扱うのは最初の3つ）。

| 宣言 | 説明（原文の定義） |
| --- | --- |
| `var` | Declares a variable, optionally initializing it to a value. |
| `let` | Declares a block-scoped variable, optionally initializing it to a value. |
| `const` | Declares a block-scoped variable that cannot be re-assigned, which must be initialized at declaration. |
| `using` | Declares a variable like `const` that is _synchronously disposed_. |
| `await using` | Declares a variable like `const` that is _asynchronously disposed_. |

`using` / `await using` は Resource management 章で導入される新しい構文なので、本節では触れない。

### 3.2 識別子（変数名）の規則と destructuring 宣言

変数名（**identifiers、識別子**）とは、変数・関数・定数などに付ける名前のこと。規則は次のとおり。

- 先頭は**文字・アンダースコア `_`・ドル記号 `$`** のいずれか。後続の文字にはそれらに加えて数字 `0`–`9` も使える。
- case-sensitive なので、`A`–`Z`（大文字）と `a`–`z`（小文字）は区別される。
- `å` や `ü` のような Unicode 文字の多くを識別子に使える。**Unicode エスケープシーケンス**で識別子中の文字を表すこともできる。
- 合法な名前の例：`Number_hits`, `temp99`, `$credit`, `_name`。

宣言には2つの書き方がある。`var x = 42`（実行コンテキスト次第でローカルにもグローバルにもなる）と、`let y = 13` / `const z = ...`（ブロックスコープのローカル変数）である。さらに **destructuring（分割代入）** 構文で値を展開しながら宣言できる。

```js
const { bar } = foo;
```

これは `bar` という変数を作り、オブジェクト `foo` の同名キー（`foo.bar`）の値を代入する。destructuring は「外部から来たオブジェクトから必要なキーだけ取り出す」コードで多用され、後の章のプロパティアクセスと合わせて読むとよい。

### 3.3 未宣言代入が「暗黙のグローバル」を作る

変数は必ず使う前に宣言すべきである。理由は次の性質にある。

> JavaScript は以前、未宣言変数への代入を許しており、それは undeclared global（未宣言グローバル）変数を作る。これは strict mode ではエラーであり、完全に避けるべき。

`strict mode`（厳格モード）とは、JavaScript のゆるい挙動を禁止して間違いを早く検出させる実行モードのこと。`"use strict";` を先頭に書くか、モジュールとして読み込むと有効になる。

〔補足〕この「未宣言代入が暗黙のグローバルを作る」性質は、非 strict な古いスクリプトでのグローバル変数汚染や、DOM Clobbering（HTML 要素の `id`/`name` でグローバル変数や既存プロパティを上書きする手法）との相互作用を考える基礎になる。攻撃者は「どこかで `x = 値` と未宣言代入している非 strict コード」を見つけると、そのグローバルを外から観測・上書きできる余地を疑う。

### 3.4 スコープと巻き上げ（hoisting）

変数のスコープ（scope、変数が有効な範囲）は次のいずれか。

- **Global scope（グローバルスコープ）**：script モードで動くすべてのコードのデフォルトスコープ。
- **Module scope（モジュールスコープ）**：module モードで動くコードのスコープ。モジュールはグローバルスコープに変数を出さないため、ここに宣言した変数は外から見えない。
- **Function scope（関数スコープ）**：関数によって作られるスコープ。
- **Block scope（ブロックスコープ）**：`let`/`const` で宣言された変数が属し得る、波括弧のペアで作られるスコープ。

`var` は関数スコープ、`let`/`const` はブロックスコープになる。

```js
if (Math.random() > 0.5) {
  const y = 5;
}
console.log(y); // ReferenceError: y is not defined
```

一方、`var` はブロックを無視して関数（またはグローバル）にローカルになる。

```js
if (true) {
  var x = 5;
}
console.log(x); // x is 5
```

**巻き上げ（hoisting）**とは、宣言がスコープの先頭へ持ち上げられたかのように振る舞う仕組みのこと。`var` は「宣言と `undefined` による初期化だけ」が巻き上げられ、値の代入は巻き上げられない。

```js
console.log(x === undefined); // true
var x = 3;

(function () {
  console.log(x); // undefined
  var x = "local value";
})();
```

`let`/`const` は宣言前に参照すると必ず `ReferenceError` になる。これは宣言が処理されるまでブロック先頭からその位置までが **temporal dead zone（TDZ、時間的死角）** にあるためである。

```js
console.log(x); // ReferenceError
const x = 3;
```

`var` と違い、**関数宣言は丸ごと巻き上げられる**ので、スコープ内のどこからでも安全に呼べる。

### 3.5 定数は「再代入」だけを防ぎ「変更」は防がない

`const` の落とし穴は診断で重要である。`const` は再代入を禁じるが、中身のミューテーション（mutation、オブジェクトや配列の内部を書き換えること）は防がない。

```js
const MY_OBJECT = { key: "value" };
MY_OBJECT.key = "otherValue";
```

```js
const MY_ARRAY = ["HTML", "CSS"];
MY_ARRAY.push("JAVASCRIPT");
console.log(MY_ARRAY); // ['HTML', 'CSS', 'JAVASCRIPT'];
```

つまり `const CONFIG = {...}` と書かれていても、その `CONFIG` のプロパティは書き換え可能である。「定数だから安全」という思い込みは、設定オブジェクトの汚染を見逃す原因になる。

なお `const` は識別子規則が通常の変数と同じで、値による初期化が必須である。さらに、**同じスコープで関数や変数と同名の定数は宣言できない**。

```js
// THIS WILL CAUSE AN ERROR
function f() {}
const f = 5; // SyntaxError
```

### 3.6 グローバル変数はグローバルオブジェクトのプロパティ

グローバル変数は実際には**グローバルオブジェクトのプロパティ**である。ウェブページでは `window` がグローバルオブジェクトなので `window.variable` で読み書きでき、全環境共通では `globalThis` が使える。そして次の性質が攻撃面になる。

> あるウィンドウやフレームで宣言されたグローバル変数を、別のウィンドウやフレームから `window` 名または `frame` 名を指定してアクセスできる。例えばあるドキュメントで `phoneNumber` という変数が宣言されていれば、`iframe` からは `parent.phoneNumber` として参照できる。

〔補足〕この段落は、同一オリジンの iframe・親フレーム間でスクリプトが互いのグローバルにアクセスできることを示す。`window.name` や `parent.*` 経由のデータ受け渡しを理解する土台になる。ただしクロスオリジンでは同一オリジンポリシー（Same-Origin Policy, SOP）で遮断される。診断では「同一オリジンで複数フレームを使うページ」で、フレーム間のグローバル参照がデータ流入経路になっていないかを見る。

---

## 4. データ型・リテラル・型変換：バリデーション迂回の温床

### 4.1 8つのデータ型

ECMAScript は8つのデータ型を定義する。7つのプリミティブ（Boolean / null / undefined / Number / BigInt / String / Symbol）と Object である。関数も技術的にはオブジェクトの一種。

### 4.2 動的型付けと片方向の型強制

JavaScript は**動的型付け**言語なので、宣言時に型を指定せず、実行中に自動変換される。この自動変換（型強制、type coercion）が迂回の温床になる。

`+` 演算子は数値を文字列に変換する。

```js
x = "The answer is " + 42; // "The answer is 42"
y = 42 + " is the answer"; // "42 is the answer"
z = "37" + 7; // "377"
```

ところが**他のすべての演算子では文字列を数値に変換する**。

```js
"37" - 7; // 30
"37" * 7; // 259
```

文字列を数値に変換する手段には `parseInt()` / `parseFloat()` / `Number()` があり、単項 `+` も `Number()` と同じ変換を行う。

```js
"1.1" + "1.1"; // '1.11.1'
(+"1.1") + (+"1.1"); // 2.2
```

MDN は `parseInt` について「常に radix（基数）を指定せよ」と注意する。

```js
parseInt("101", 2); // 5
```

〔補足〕`parseInt` の基数省略や `"37" - 7 === 30` のような片方向強制は、数値バリデーション迂回の基礎である。たとえば `parseInt("12abc")` は末尾を無視して `12` を返し、単項 `+" "` は `0` になる。「入力を数値化してからチェックする」コードは、この寛容さのせいで想定外の値を通してしまう。攻撃者は `"1e10"`、`"0x10"`、前後の空白、末尾ゴミなどで境界チェックをすり抜けられないか試す。

### 4.3 数値リテラルと基数表現

整数リテラルは10進・16進・8進・2進で書ける。先頭 `0x` は16進、`0o`（または旧式の先頭 `0`）は8進、`0b` は2進、末尾 `n` は BigInt を示す。

```plain
0, 117, 123456789123456789n             (decimal, base 10)
015, 0001, 0o777777777777n              (octal, base 8)
0x1123, 0x00111, 0x123456789ABCDEFn     (hexadecimal, "hex" or base 16)
0b11, 0b0011, 0b11101001010101010101n   (binary, base 2)
```

複数の基数表現があることは、フィルタが `"0x..."` や8進表記を想定していない場合の迂回材料になる。

### 4.4 配列リテラルと空スロット

**配列リテラル（Array literal）**とは、角括弧 `[]` で囲んだ0個以上の式のリストのこと。評価されるたびに新しい配列オブジェクトを作る。

```js
const coffees = ["French Roast", "Colombian", "Kona"];
```

診断で見落としやすいのが**空スロット（empty slot）**である。配列リテラル内でカンマを2つ連続させると、未指定要素のためのスロットが残る。

```js
const fish = ["Lion", , "Angel"];
console.log(fish);
// [ 'Lion', <1 empty item>, 'Angel' ]
```

この2番目の項目は "empty" であり、**実際の `undefined` 値とは厳密には同じではない**。両者の違いは走査時に現れる。`Array.prototype.map` のような配列走査メソッドでは空スロットは**スキップ**されるが、インデックスアクセス `fish[1]` は `undefined` を返す。「map は飛ばすのに直接読むと undefined」という食い違いは、配列を正規化・検証するコードの穴になり得る。

末尾の余分なカンマ（trailing comma）は `length` に影響しないが、途中の余分なカンマは要素を欠けさせる。

```js
const myList = ["home", , "school"];      // length は 3、myList[1] が空
const myList = [, "home", , "school"];    // length は 4、myList[0] と myList[2] が欠け
const myList = ["home", , "school", ,];   // length は 4、最後のカンマだけが無視される
```

### 4.5 オブジェクトリテラルと `__proto__:` によるプロトタイプ汚染経路

**オブジェクトリテラル（Object literal）**とは、波括弧 `{}` で囲んだ「プロパティ名と値のペア」を0個以上並べたリストのこと。

```js
const car = { myCar: "Saturn", getCar: carTypes("Honda"), special: sales };

console.log(car.myCar); // Saturn
```

> **WARNING（原文）**：文の先頭でオブジェクトリテラルを使ってはならない。行頭の `{` はブロックの開始として解釈されるため、エラーになるか期待通りに動かない。

プロパティ名には数値リテラルや文字列リテラルも使え、オブジェクトはネストできる。

```js
const car = { manyCars: { a: "Saab", b: "Jeep" }, 7: "Mazda" };

console.log(car.manyCars.b); // Jeep
console.log(car[7]); // Mazda
```

重要なのは、**プロパティ名は空文字列を含む任意の文字列になり得る**という点。有効な JavaScript 識別子でも数値でもない名前はドット記法でアクセスできず、ブラケット記法 `[]` が必須になる。

```js
const unusualPropertyNames = {
  "": "An empty string",
  "!": "Bang!",
};
console.log(unusualPropertyNames.""); // SyntaxError: Unexpected string
console.log(unusualPropertyNames.!);  // SyntaxError: Unexpected token !
```

```js
console.log(unusualPropertyNames[""]);  // An empty string
console.log(unusualPropertyNames["!"]); // Bang!
```

#### 拡張オブジェクトリテラル（Enhanced object literals）

オブジェクトリテラルは、構築時のプロトタイプ設定、`foo: foo` の省略形（shorthand）、メソッド定義、`super` 呼び出し、式によるプロパティ名の計算（computed property names）といった省略構文を備える。

```js
const theProtoObj = {};
const handler = {};
const obj = {
  // __proto__
  __proto__: theProtoObj,
  // Shorthand for 'handler: handler'
  handler,
  // Methods
  toString() {
    // Super calls
    return `d ${super.toString()}`;
  },
  // Computed (dynamic) property names
  ["prop_" + (() => 42)()]: 42,
};
```

〔補足〕この中で**最も落としてはいけないのが `__proto__:` キー**である。オブジェクトリテラル内の `__proto__:` キーは、そのオブジェクトの**プロトタイプ（`[[Prototype]]`）を設定する**という仕様上の挙動を持つ。これは、JSON 由来のオブジェクトを再帰的にマージ・コピーするコードで**プロトタイプ汚染（prototype pollution）**が成立する典型経路（`{"__proto__": {...}}`）を理解する鍵になる。攻撃者が外部入力に `__proto__` キーを仕込み、それがマージ関数を通じて `Object.prototype` に書き込まれると、アプリ全体のオブジェクトが汚染されたプロパティを継承してしまう。MDN のプロトタイプ章は「オブジェクトリテラルの `__proto__` キーは標準であり非推奨ではない」「`Object.prototype.__proto__` アクセサは非標準かつ非推奨」と両者を明確に区別している（詳細は後半パートのプロトタイプ章）。診断では、外部入力を受け取る再帰マージ・deep clone・クエリパーサに `__proto__` / `constructor` / `prototype` キーを流し込めないかを試す。防御側は `Object.create(null)` でプロトタイプを持たないオブジェクトを使う、`Map` を使う、危険キーを拒否する、といった対策を取る。

### 4.6 テンプレートリテラルとタグ付きテンプレート

**テンプレートリテラル（Template literal）**とは、バックティック `` ` ``（grave accent）で囲む文字列リテラルのこと。複数行と `${}` による式の補間（interpolation）ができる。

```js
// Basic literal string creation
`In JavaScript '\n' is a line-feed.`;

// Multiline strings
`In JavaScript, template strings can run
 over multiple lines, but double and single
 quoted strings cannot.`;

// String interpolation
const name = "Lev",
  time = "today";
`Hello ${name}, how are you ${time}?`;
```

**タグ付きテンプレート（Tagged template）**とは、テンプレートリテラルの前に「タグ関数」の名前を置き、そのテンプレートを関数でパースさせる構文のこと。次の例のタグ関数は `print` で、断片を補間しつつ配列・オブジェクトを整形して `[object Object]` を避ける。

```js
const print = (segments, ...args) => {
  // For any well-formed template literal, there will always be N args and
  // (N+1) string segments.
  let message = segments[0];
  segments.slice(1).forEach((segment, index) => {
    message += formatArg(args[index]) + segment;
  });
  console.log(message);
};

print`I need to do:
${todos}
My current progress is: ${progress}
`;
```

タグ付きテンプレートは**単なる関数呼び出しの糖衣**なので、上記は等価な関数呼び出しに書き換えられる。第1引数に静的な文字列断片の配列、以降に補間値が渡る。

```js
print(["I need to do:\n", "\nMy current progress is: ", "\n"], todos, progress);
```

〔補足〕タグ付きテンプレートは「テンプレート断片（静的）と補間値（動的）が関数に分離して渡される」構造を持つ。この分離のおかげで、補間値だけをコンテキストに応じて安全にエスケープする**安全なテンプレート API**（Trusted Types 互換のポリシーや `` html`...` `` 系ライブラリなど）の実装基盤になる。逆に、タグ関数がエスケープを行っていない場合や、開発者が「タグを付ければ安全」と誤解している場合、そのタグ付きテンプレートはそのまま**注入点**になる。診断では、`` html`...` `` のようなタグ関数が補間値をどう扱っているか（エスケープしているか、`innerHTML` に素通ししているか）を確認する。

### 4.7 文字列の特殊文字とエスケープ：注入の基礎

文字列コンテキストへの注入を考えるうえで、エスケープ表は暗記に近い重要度を持つ。以下は原文の表を逐語で再現したものである。

| Character | Meaning |
| --- | --- |
| `\0` | Null Byte |
| `\b` | Backspace |
| `\f` | Form Feed |
| `\n` | New Line |
| `\r` | Carriage Return |
| `\t` | Tab |
| `\v` | Vertical tab |
| `\'` | Apostrophe or single quote |
| `\"` | Double quote |
| `\\` | Backslash character |
| `\XXX` | The character with the Latin-1 encoding specified by up to three octal digits `XXX` between `0` and `377`. For example, `\251` is the octal sequence for the copyright symbol. |
| `\xXX` | The character with the Latin-1 encoding specified by the two hexadecimal digits `XX` between `00` and `FF`. For example, `\xA9` is the hexadecimal sequence for the copyright symbol. |
| `\uXXXX` | The Unicode character specified by the four hexadecimal digits `XXXX`. For example, `\u00A9` is the Unicode sequence for the copyright symbol. |
| `\u{XXXXX}` | Unicode code point escapes. For example, `\u{2F804}` is the same as the Unicode escapes `\uD87E\uDC04`. |

文字列内にクォートを含めるにはバックスラッシュでエスケープする。

```js
const quote = "He read \"The Cremation of Sam McGee\" by R.W. Service.";
```

〔補足〕`\xXX` / `\uXXXX` / `\u{XXXXX}` の3系統は、JS 文字列コンテキストへの注入時に「バックスラッシュ経由でクォートを回避する」「ブラックリスト方式のサニタイザを Unicode エスケープで通す」といった検討に直結する。ここで正確に理解すべきは、`\u{2F804}`（コードポイント U+2F804 を1つ表すコードポイントエスケープ）が、UTF-16 では**サロゲートペア（surrogate pair）** `\uD87E\uDC04` と等価だという点である。サロゲートペアとは、UTF-16 で1つのコードポイント（U+10000 以上）を**2つのコードユニット**（ここでは `\uD87E` と `\uDC04`）の組で表す方式のこと。この2ユニットが結合して初めて1つの文字 U+2F804 を表す。フィルタが1コードユニット単位で文字を検査していると、サロゲートペアを分割して片方だけを見たり、逆に2ユニットを1文字として数え損ねたりして、検査をすり抜けられる余地が生まれる。防御側は、エスケープ済み文字列を「表示前に必ず正規化し、コンテキストに応じた出力エンコードを行う」ことで、こうした表現ゆらぎを潰す。

### 4.8 コメントの早期終了と hashbang

ブロックコメント `/* ... */` は**ネストできず**、途中に `*/` が現れるとそこで終わる。

```js
/* You can't, however, /* nest comments */ SyntaxError */
```

この早期終了は、`*/` のパターンを壊す（スラッシュをエスケープする）ことで回避できる。

```js
/* You can /* nest comments *\/ by escaping slashes */
```

一部の JS ファイルの**先頭**には、第3のコメント構文である **hashbang comment（ハッシュバンコメント）** が現れる。

```js
#!/usr/bin/env node
```

これはスクリプトを実行すべき JavaScript エンジン（ランタイム）の実行ファイルのパスを指定する特別なコメントで、ファイルの1行目にのみ書ける。ブラウザではなく Node.js などで直接実行する `.js`／CLI スクリプトで使われる。

〔補足〕`*/` でコメントが早期終了する性質は、ユーザー入力を JS のコメント内に埋め込むテンプレートでの**コメントブレイクアウト（コメント脱出）**を考える基礎になる。入力に `*/` を含められれば、コメントを抜けて後続をコードとして評価させられる余地が生まれる。hashbang は「その `.js` がサーバー側で直接実行される種類のスクリプトかどうか」を見分ける手がかりにもなる。

---

## 5. Functions：`Function` コンストラクタという動的コード実行 sink

### 5.1 値渡しと参照の共有

関数のパラメータは基本的に値で渡される（by value）。プリミティブに新しい値を代入しても呼び出し元には影響しない。しかしオブジェクトや配列を渡すと、その中身への変更は関数外でも見える。

```js
function myFunc(theObject) {
  theObject.make = "Toyota";
}

const myCar = { make: "Honda", model: "Accord", year: 1998 };

console.log(myCar.make); // "Honda"
myFunc(myCar);
console.log(myCar.make); // "Toyota"
```

配列でも同じで、関数内での要素の変更は呼び出し元に反映される。

```js
function myFunc(theArr) {
  theArr[0] = 30;
}

const arr = [45];

console.log(arr[0]); // 45
myFunc(arr);
console.log(arr[0]); // 30
```

この「オブジェクト・配列は参照が共有される」性質は、渡した設定オブジェクトが関数内で書き換えられ得ることを意味し、後述のプロトタイプ汚染や設定改ざんを読む土台になる。

### 5.2 関数宣言・関数式・named function expression

関数は**関数宣言（function declaration）**で作れる。`function` キーワードに、名前・パラメータリスト・波括弧の本体が続く。関数宣言と関数式はネストでき、内側から外側の変数にアクセスできる**スコープチェーン（scope chain）**を形成する。

```js
function square(number) {
  return number * number;
}
```

一方、**関数式（function expression）**でも関数を作れ、これは無名（anonymous）でよい。

```js
const square = function (number) {
  return number * number;
};

console.log(square(4)); // 16
```

関数式には**名前を与える（named function expression）**こともできる。名前を付けると、関数が**自身を参照でき**（再帰に使える）、デバッガのスタックトレースでの識別も容易になる。

```js
const factorial = function fac(n) {
  return n < 2 ? 1 : n * fac(n - 1);
};

console.log(factorial(3)); // 6
```

関数式は、他の関数へ引数として関数を渡すときに便利である。次は無名関数式を `map` に渡す例。

```js
function map(f, a) {
  const result = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = f(a[i]);
  }
  return result;
}

const numbers = [0, 1, 2, 5, 10];
const cubedNumbers = map(function (x) {
  return x * x * x;
}, numbers);
console.log(cubedNumbers); // [0, 1, 8, 125, 1000]
```

条件に基づいて関数を定義することもできる。次は `num` が `0` のときだけ `myFunc` を定義する。

```js
let myFunc;
if (num === 0) {
  myFunc = function (theObject) {
    theObject.make = "Toyota";
  };
}
```

そして MDN は、動的コード実行の核心をさらりと書いている。

> you can also use the `Function` constructor to create functions from a string at runtime, much like `eval()`.

つまり `new Function(userInput)` は「文字列から実行時に関数を作る」ものであり、`eval()` とよく似た危険を持つ。なお、オブジェクトのプロパティである関数は**メソッド（method）**と呼ぶ。

〔補足〕この1文はクライアントサイド脆弱性ハンティングで極めて重要である。`new Function(x)` や `Function("return " + x)()` は `eval` と同じ**動的コード実行 sink** であり、外部入力がここに到達すると任意 JS 実行につながる。防御側では、コンテンツセキュリティポリシー（Content Security Policy, CSP）の `unsafe-eval` を許可しなければ `eval` と `Function` コンストラクタの両方がブロックされる。さらに Trusted Types を使うと、これらに渡す文字列に `TrustedScript` を要求できる。診断では、コード中の `Function(`、`eval(`、`setTimeout(文字列)`、`setInterval(文字列)` を grep して sink を洗い出すのが定番になる。

### 5.3 呼び出し・巻き上げの差・動的呼び出し

**定義は実行ではない**。定義は関数に名前を付け、呼ばれたときの動作を指定するだけで、実際の動作は**呼び出し**で起きる。関数宣言は巻き上げられるので呼び出しより下に書いてよいが、関数式（`const square = function...`）は巻き上げられない。

```js
console.log(square(5)); // ReferenceError: Cannot access 'square' before initialization
const square = function (n) {
  return n * n;
};
```

関数を**動的に呼ぶ**必要がある場合、引数の数が可変の場合、あるいは呼び出しの `this`（コンテキスト）を実行時に決める特定のオブジェクトに設定したい場合には、関数自体がオブジェクトである性質を使う。`Function` オブジェクトの `call()` と `apply()` メソッドがこの目的に使える。

〔補足〕`call()`/`apply()` は「任意のオブジェクトを `this` にして関数を呼ぶ」ため、`Array.prototype.slice.call(argumentsLike)` のようなイディオムや、`this` を差し替えたメソッド借用（method borrowing）の基礎になる。改ざん・フックの文脈でも、どのオブジェクトを `this` に据えて関数を走らせるかは重要な観察点になる。

### 5.4 DOM を再帰で歩く：自作クローラの原型

再帰はツリー構造の走査に向く。MDN は DOM を歩く典型例を示す。

```js
function walkTree(node) {
  if (node === null) {
    return;
  }
  // do something with node
  for (const child of node.childNodes) {
    walkTree(child);
  }
}
```

〔補足〕この `walkTree` は、診断で「ページ内の全ノードを列挙し、危険な属性・インラインイベントハンドラ・`innerHTML` 代入箇所を洗い出す」自作クローラの基本形になる。手を動かして DOM 全体を舐める道具は、この数行から始まる。

### 5.5 arguments オブジェクト：宣言より多い引数を受ける

**arguments オブジェクト**とは、関数に渡された全引数を保持する array-like（配列風）なオブジェクトのこと。関数内で `arguments[i]` としてアクセスし、`i` は0から始まる引数の序数（最初の引数は `arguments[0]`）、引数の総数は `arguments.length` で得る。

これを使うと、**形式的に宣言したより多くの引数で関数を呼べる**。事前に引数の個数が分からない場合に有用。

```js
function myConcat(separator) {
  let result = ""; // initialize list
  // iterate through arguments
  for (let i = 1; i < arguments.length; i++) {
    result += arguments[i] + separator;
  }
  return result;
}
```

```js
console.log(myConcat(", ", "red", "orange", "blue"));
// "red, orange, blue, "

console.log(myConcat("; ", "elephant", "giraffe", "lion", "cheetah"));
// "elephant; giraffe; lion; cheetah; "
```

> **NOTE（原文）**：`arguments` 変数は "array-like" だが**配列ではない**。番号付きインデックスと `length` プロパティを持つ点で array-like だが、配列操作メソッド（`map`、`forEach` など）をすべて備えてはいない。

〔補足〕「array-like だが配列ではない」ため、`arguments` に直接 `map` などを呼ぶとエラーになり、`Array.prototype.slice.call(arguments)` や `Array.from(arguments)`、あるいは後述の rest parameters で本物の配列に変換するイディオムが生まれる。診断でコードを読むとき、`arguments` を配列扱いしている箇所や、そこを経由して外部入力の個数・内容が処理に流れる箇所は観察対象になる。

### 5.6 関数パラメータ：default と rest

特別なパラメータ構文が2種類ある。**default parameters（デフォルトパラメータ）**と **rest parameters（残余パラメータ）**である。

JavaScript の関数パラメータのデフォルトは `undefined`。default parameters が導入される前は、関数本体で値をテストして `undefined` なら代入する、という戦略を取っていた。

```js
function multiply(a, b) {
  b = typeof b !== "undefined" ? b : 1;
  return a * b;
}

console.log(multiply(5)); // 5
```

default parameters を使えば、関数本体での手動チェックは不要になり、パラメータ宣言の位置でデフォルト値を書ける。

```js
function multiply(a, b = 1) {
  return a * b;
}

console.log(multiply(5)); // 5
```

**rest parameters** 構文（`...`）は、不定個数の引数を**本物の配列**として受け取る。

```js
function multiply(multiplier, ...theArgs) {
  return theArgs.map((x) => multiplier * x);
}

const arr = multiply(2, 1, 2, 3);
console.log(arr); // [2, 4, 6]
```

rest parameters は `arguments` と違って本物の配列なので、そのまま `map` などが使える。可変長入力を扱う関数を読むときは、どちらの方式で引数を受けているかで挙動が変わる点に注意する。

### 5.7 アロー関数と非 strict の `this` グローバル汚染

アロー関数（arrow function）は短い構文を持ち、**自身の `this`、`arguments`、`super`、`new.target` を持たない**。`this` は囲む実行コンテキストのものを使う。アロー関数は常に無名である。

導入前は、コールバック内の `this` が意図しない対象を指す問題があった。

```js
function Person() {
  this.age = 0;

  setInterval(function growUp() {
    // In nonstrict mode, the growUp() function defines `this`
    // as the global object, which is different from the `this`
    // defined by the Person() constructor.
    this.age++;
  }, 1000);
}
```

アロー関数ならこの問題が消える。

```js
function Person() {
  this.age = 0;

  setInterval(() => {
    this.age++; // `this` properly refers to the person object
  }, 1000);
}
```

〔補足〕非 strict モードで通常関数の `this` がグローバルオブジェクト（ブラウザでは `window`）になる性質は、コールバック内の `this.x = ...` が意図せずグローバルを汚染する経路になる。診断では「非 strict の古いスクリプト + コールバック」でグローバル変数の上書きが起きないか、DOM Clobbering と併せて検討する材料になる。

---

## 6. Closures：秘密を隠す、しかしブラウザでは隠しきれない

### 6.1 クロージャの定義

**クロージャ（closure）**とは、関数と、その関数が宣言されたレキシカル環境（lexical environment、宣言された場所の周囲の状態）を組にしたもののこと。MDN の定義は次のとおり。

> A closure is the combination of a function bundled together (enclosed) with references to its surrounding state (the lexical environment). In other words, a closure gives a function access to its outer scope. In JavaScript, closures are created every time a function is created, at function creation time.

内側の関数が外側の変数を「覚えている」ため、外側の関数が終了した後でもその変数にアクセスできる。

```js
function makeFunc() {
  const name = "Mozilla";
  function displayName() {
    console.log(name);
  }
  return displayName;
}

const myFunc = makeFunc();
myFunc(); // "Mozilla"
```

### 6.2 関数ファクトリと独立したレキシカル環境

```js
function makeAdder(x) {
  return function (y) {
    return x + y;
  };
}

const add5 = makeAdder(5);
const add10 = makeAdder(10);

console.log(add5(2)); // 7
console.log(add10(2)); // 12
```

`add5` と `add10` は同じ関数本体を共有するが、別々のレキシカル環境（`x` が 5 と 10）を保存する。この「環境ごとに独立した状態」を持てることが、次のデータ隠蔽につながる。

### 6.3 スコープチェーンと名前衝突

クロージャは複数のスコープを含み得る。関数がネストすると、内側の関数は自分を含む関数のスコープを**再帰的に**含む。これを **scope chaining（スコープチェイニング）** と呼ぶ。

```js
function A(x) {
  function B(y) {
    function C(z) {
      console.log(x + y + z);
    }
    C(3);
  }
  B(2);
}
A(1); // Logs 6 (which is 1 + 2 + 3)
```

`C` は `B` のスコープを含み、`B` は `A` のスコープを含むので、`C` は `B` と `A` の両方の引数・変数にその順序でアクセスできる。逆は成り立たない（`A` は `C` や `B` の内部変数にアクセスできない）。

同じ名前が複数のスコープに現れると**名前衝突（name conflict）**が起き、**よりネストした（内側の）スコープが優先される**。最も内側が最高優先度、最も外側が最低優先度で、この優先順位こそがスコープチェーンである。

```js
function outside() {
  const x = 5;
  function inside(x) {
    return x * 2;
  }
  return inside;
}

console.log(outside()(10)); // 20 (instead of 10)
```

`return x * 2` では、`inside` のパラメータ `x` と `outside` の変数 `x` が衝突する。スコープチェーンは `inside` → `outside` → グローバルなので、内側の `inside` の `x`（引数 `10`）が優先され、`10`（`outside` の `x`＝5 を使った場合の結果）ではなく `20` が返る。

〔補足〕スコープチェーンの「内側優先」は、シャドウイング（shadowing、外側の変数を内側の同名変数で覆い隠すこと）そのものである。後半パートのプロパティシャドウイング（プロトタイプ上の値をインスタンス側の同名プロパティが覆う）と同じ考え方で、汚染された値がどの層で読まれるかを追う土台になる。

### 6.4 クロージャで「秘密」を隠すパターンとその限界

クロージャの内側変数は外から直接触れないため、秘密の保管庫として使われる。

```js
const getCode = (function () {
  const apiCode = "0]Eal(eh&2"; // A code we do not want outsiders to be able to modify…

  return function () {
    return apiCode;
  };
})();

console.log(getCode()); // "0]Eal(eh&2"
```

`apiCode` は返された無名関数のスコープにしか存在しないので、`getCode` 以外から値を読む方法はない、とされる。

〔補足〕この「クロージャで秘密を隠す」パターンは、クライアントサイドにトークンや API キーを置くコードで頻出する。しかし決定的な限界がある。ブラウザ上ではソース（JS バンドル）そのものが配信されているため、**スクリプト本文を読めば `apiCode` の値がそのまま見える**。クロージャは同一実行コンテキスト内の他スクリプトからの参照を防ぐだけで、機密性（confidentiality）の保証にはならない。診断では、配信された JS バンドル内にハードコードされた秘密（API キー、署名鍵、内部エンドポイント）を探すのが定番項目になる。「クロージャに入れてあるから安全」は誤りである。

### 6.5 モジュールパターンによる private エミュレーション

クラス導入前、JavaScript はクロージャで private メソッドをエミュレートしていた。これを **Module Design Pattern（モジュールパターン）** と呼ぶ。

```js
const counter = (function () {
  let privateCounter = 0;
  function changeBy(val) {
    privateCounter += val;
  }

  return {
    increment() {
      changeBy(1);
    },
    decrement() {
      changeBy(-1);
    },
    value() {
      return privateCounter;
    },
  };
})();

console.log(counter.value()); // 0.
counter.increment();
counter.increment();
console.log(counter.value()); // 2.
```

`makeCounter()` を関数にすれば、呼ぶたびに独立したカウンタが得られる。これはデータ隠蔽（data hiding）とカプセル化（encapsulation）の利点をもたらすが、6.4 と同じく「ソースが読める環境では実装の秘密は守れない」点は変わらない。

### 6.6 クロージャのスコープチェーンと live bindings

クロージャは何層でもネストでき、各層の変数を閉じ込める。次はグローバル・外側関数・ローカルの各スコープをまたいで値を閉じ込める例で、`sum(1)(2)(3)(4)` が `20`（= 1+2+3+4+10）になる。

```js
// global scope
const e = 10;
function sum(a) {
  return function (b) {
    return function (c) {
      // outer functions scope
      return function (d) {
        // local scope
        return a + b + c + d + e;
      };
    };
  };
}

console.log(sum(1)(2)(3)(4)); // 20
```

クロージャは**ブロックスコープ**や**モジュールスコープ**の変数も閉じ込められる。次はブロック `{}` 内で宣言した `y` に対するクロージャを、ブロックの外へ持ち出す例。

```js
function outer() {
  let getY;
  {
    const y = 6;
    getY = () => y;
  }
  console.log(typeof y); // undefined
  console.log(getY()); // 6
}

outer();
```

モジュールスコープ変数を閉じ込めれば、getter/setter のペアで外から直接触れない状態を管理できる。

```js
// myModule.js
let x = 5;
export const getX = () => x;
export const setX = (val) => {
  x = val;
};
```

そして最も注目すべきは、**インポートされた値も閉じ込められ、それは live bindings（ライブバインディング）と見なされる**点である。ライブバインディングとは、インポート先が元の値への「生きた参照」を保持し、**元（エクスポート元）の値が変わるとインポート側も追随して変わる**仕組みのこと。

```js
// closureCreator.js
import { x } from "./myModule.js";

export const getX = () => x; // Close over an imported live binding
```

```js
import { getX } from "./closureCreator.js";
import { setX } from "./myModule.js";

console.log(getX()); // 1
setX(2);
console.log(getX()); // 2
```

〔補足〕ライブバインディングは「値のコピー」ではなく「束縛の共有」なので、あるモジュールが状態を変えると、それを閉じ込めた別モジュールのクロージャの返す値まで変わる。診断でモジュール間のデータフローを追うとき、`import` した値は静的なスナップショットではなく**動く参照**だという前提で読む必要がある。

### 6.7 ループ内クロージャの典型バグ（`var` の罠）と3つの解決策

MDN が示す最も有名な落とし穴。`var` で回すループ内でコールバックを作ると、すべてのコールバックが同じ変数を共有してしまう。

```js
function setupHelp() {
  var helpText = [
    { id: "email", help: "Your email address" },
    { id: "name", help: "Your full name" },
    { id: "age", help: "Your age (you must be over 16)" },
  ];

  for (var i = 0; i < helpText.length; i++) {
    // Culprit is the use of `var` on this line
    var item = helpText[i];
    document.getElementById(item.id).onfocus = function () {
      showHelp(item.help);
    };
  }
}
```

3つのクロージャが同じ `item`（`var` により関数スコープ）を共有し、コールバック実行時にはループが終わっているため、`item` は常に**最後のエントリ**を指す。どのフィールドにフォーカスしても "age" のヘルプしか出ない。

MDN は解決策を3つ示す。順に見ていく。

**解決策1：関数ファクトリ（`makeHelpCallback`）でクロージャを1つ挟む。** 各コールバックに新しいレキシカル環境を作り、その中で `help` が対応する文字列を保持する。

```js
function makeHelpCallback(help) {
  return function () {
    showHelp(help);
  };
}

function setupHelp() {
  var helpText = [
    { id: "email", help: "Your email address" },
    { id: "name", help: "Your full name" },
    { id: "age", help: "Your age (you must be over 16)" },
  ];

  for (var i = 0; i < helpText.length; i++) {
    var item = helpText[i];
    document.getElementById(item.id).onfocus = makeHelpCallback(item.help);
  }
}
```

**解決策2：無名クロージャ（IIFE）でループ本体を包む。** その反復時点の `item` の値をその場で捕獲する。

```js
function setupHelp() {
  var helpText = [
    { id: "email", help: "Your email address" },
    { id: "name", help: "Your full name" },
    { id: "age", help: "Your age (you must be over 16)" },
  ];

  for (var i = 0; i < helpText.length; i++) {
    (function () {
      var item = helpText[i];
      document.getElementById(item.id).onfocus = function () {
        showHelp(item.help);
      };
    })(); // Immediate event listener attachment with the current value of item (preserved until iteration).
  }
}
```

**解決策3：`let` または `const` を使う。** 各反復でブロックスコープに新しい束縛が作られる。

```js
function setupHelp() {
  const helpText = [
    { id: "email", help: "Your email address" },
    { id: "name", help: "Your full name" },
    { id: "age", help: "Your age (you must be over 16)" },
  ];

  for (let i = 0; i < helpText.length; i++) {
    const item = helpText[i];
    document.getElementById(item.id).onfocus = () => {
      showHelp(item.help);
    };
  }
}
```

`let`/`const` が反復ごとに新しい束縛を作るため、追加のクロージャなしで直る。`for...of` や `forEach()` でも回避できる。3つの解決策はいずれも「各反復に独立したレキシカル環境を与える」という同じ原理に立っている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: MDN「Closures」章のライブサンプル（practical closures のフォントサイズ変更ボタン、および closures_bad / closures_factory のループ内バグと修正） — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures
> **なぜ**: 本教科書の執筆環境からは developer.mozilla.org を自動取得できなかった（理由: egress プロキシによるサイト側の制限 / `EGRESS_BLOCKED`・CONNECT 403）。代替として MDN 公式リポジトリのソース Markdown を取得したため本文・コードは逐語で得られているが、`{{EmbedLiveSample}}` で描画される**実際に動くサンプル**はソース原稿には含まれない。以下の記述はその原稿（一次資料の本文）にもとづく要約である。
> **読みどころ**:
> 1. practical closures のフォントサイズボタンを実際にクリックし、`makeSizer(12/14/16)` が返す各クロージャが別々の `size` を覚えていることを体感する。
> 2. ループ内クロージャのバグ版（`var`）と修正版（`let`）を、各入力欄にフォーカスして挙動の違いを確かめる。「最後のエントリしか出ない」現象を目で見る。
> **代替手段**: ソース原稿は公開ミラー `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/javascript/guide/closures/index.md` で読める（本文・コードは同一。ただしライブ描画は含まれない）。

### 6.8 クロージャの性能上の注意

各関数インスタンスは自身のスコープとクロージャを管理するため、不要なのに関数の中で関数を作るのは避けるべきである。メソッドはコンストラクタ内ではなくプロトタイプに関連付ける方がよい（生成ごとに再代入されないため）。

```js
function MyObject(name, message) {
  this.name = name.toString();
  this.message = message.toString();
}
MyObject.prototype.getName = function () {
  return this.name;
};
MyObject.prototype.getMessage = function () {
  return this.message;
};
```

なおプロトタイプ丸ごとの再定義（`MyObject.prototype = {...}`）は推奨されず、既存プロトタイプへの追加が推奨される。プロトタイプの詳細は後半パートの担当である。

---

## 手を動かす

以下はすべて、自分で立てた検証環境か、あなたが権限を持つバグバウンティ対象でのみ行うこと。

1. **コンソール = eval を体感する**：任意のページで DevTools を開き、Console タブに `eval("3 + 5")` と打つ。次に `3 + 5` だけを打ち、返り値が同じであることを確認する。コンソールが「入力を毎回 `eval` している」ことを実感する。

2. **型強制でバリデーションを崩す**：Console で次を順に評価する。
   ```js
   parseInt("12abc");      // 12
   +" ";                    // 0
   "37" - 7;                // 30
   "37" + 7;                // "377"
   Number("0x10");          // 16
   ```
   「数値化してから範囲チェックする」コードが、これらの寛容さでどう騙され得るかを考える。

3. **空スロットと `__proto__` を観察する**：Console で `const a = ["Lion", , "Angel"]; a.map(x => x.toUpperCase()); a[1];` を評価し、`map` が空スロットを飛ばす一方 `a[1]` が `undefined` になる食い違いを確認する。次に `const o = JSON.parse('{"__proto__":{"polluted":1}}'); ({}).polluted;` と、素朴なマージ関数に同じ JSON を通した場合の違いを比べ、`__proto__:` キーがどの経路で効くかを考える。

4. **動的コード実行 sink を探す**：対象の JS バンドルをブラウザの Sources タブで開き、`eval(`、`new Function(`、`Function(`、`setTimeout("`、`setInterval("` を検索する。ヒットした箇所について、そこへ到達するデータが外部入力（URL、`postMessage`、DOM、localStorage）由来かを追う。

5. **ハードコード秘密を探す**：同じバンドルに対し `apiKey`、`api_key`、`secret`、`token`、`Bearer ` などで検索する。クロージャ内に隠したつもりの値も、ソースを読めば見えることを確認する。

6. **DOM を歩くクローラを書く**：Console に `walkTree` を貼り、`document.body` から全ノードを列挙して、`innerHTML` を持つ要素や `onclick` などインラインハンドラを持つ要素を集めてみる。危険な sink の地図を自分で作る。

## つまずきポイント

- **`const` は不変ではない**。再代入は防ぐが、オブジェクトや配列の中身は書き換えられる。`const CONFIG = {...}` を「安全な設定」と思い込むと汚染を見逃す。
- **`__proto__:` は「ただのキー名」ではない**。オブジェクトリテラルやマージ処理での `__proto__` はプロトタイプを設定する。素朴な再帰マージにこのキーを流し込めると `Object.prototype` が汚染される。
- **空スロットと `undefined` は別物**。`map` などは空スロットを飛ばすが、インデックスアクセスは `undefined` を返す。この差が正規化・検証の穴になる。
- **`arguments` は配列ではない**。array-like なので `map` などは直接使えない。可変長引数を本物の配列で受けたいなら rest parameters を使う。
- **`==` と型強制を後半パートの話だと油断しない**。本節の `"37" - 7 === 30` の時点で、片方向の暗黙変換はすでに始まっている。
- **クロージャ＝機密性、ではない**。クロージャは同一コンテキスト内の他スクリプトからの参照を防ぐだけ。ブラウザではソースが配信されるので、値そのものは読める。
- **ECMAScript と DOM を混同しない**。`eval`/`Function` は言語（ECMAScript）側、`innerHTML`/`document.write` は DOM 側。標準団体が別なので、仕様を当たる場所も別になる。
- **巻き上げの向きを取り違える**。関数宣言は丸ごと巻き上がるが、`const f = function...` の関数式は TDZ に入り、宣言前アクセスは `ReferenceError`。
- **非 strict の `this`**。通常関数のコールバックでは `this` が `window` になり得る。`this.x = ...` が黙ってグローバルを汚す。
- **サロゲートペアを1文字と混同しない**。`\u{2F804}` は UTF-16 では `\uD87E\uDC04` の2コードユニットで表され、それが結合して1コードポイントになる。1ユニット単位で検査するフィルタはこの差ですり抜けられる。

## この節のまとめ

- MDN ガイドは「概観」担当、リファレンスは「網羅的仕様」担当という役割分担で書かれている。
- ECMAScript は DOM を定義しない。言語のルールとブラウザ API のルールは別団体の別仕様であり、その境界にクライアントサイド脆弱性が集まる。
- DevTools コンソールは `eval` 相当で動き、診断でオリジン上の JS コンテキストを直接触る入口になる。
- JavaScript は大文字小文字・Unicode を区別し、ASI（自動セミコロン挿入）が文の終端を補う。`Früh` と `früh` は別の識別子。
- 識別子は文字・`_`・`$` で始まり後続に数字可。destructuring 宣言（`const { bar } = foo`）で必要なキーだけ取り出せる。
- 未宣言代入は非 strict では暗黙のグローバルを作り、strict mode ではエラーになる。グローバル汚染・DOM Clobbering の前提知識である。
- `var` は関数スコープで巻き上げられ（値は巻き上げない）、`let`/`const` はブロックスコープで TDZ を持つ。関数宣言は丸ごと巻き上がる。スコープ種別には Global/Module/Function/Block がある。
- `const` は再代入を防ぐがミューテーションは防がない。設定オブジェクトのプロパティは書き換え可能。同一スコープで関数/変数と同名の定数は宣言できない。
- グローバル変数はグローバルオブジェクトのプロパティで、同一オリジンのフレーム間で `parent.変数名` として参照できる。
- 動的型付けと型強制（`parseInt` の寛容さ、`"37" - 7 === 30`、単項 `+`）は数値・文字列バリデーション迂回の温床。
- 配列リテラルの空スロットは `undefined` と別物で、`map` は飛ばすがインデックスアクセスは `undefined` を返す。
- オブジェクトリテラルの `__proto__:` キーはプロトタイプを設定し、`{"__proto__": {...}}` はプロトタイプ汚染の典型経路。空文字列や `!` などの名前はブラケット記法必須で、computed/shorthand/メソッド定義の省略構文もある。
- テンプレートリテラルは複数行・`${}` 補間ができ、タグ付きテンプレートは関数呼び出しの糖衣。断片と値が分離される構造は安全なテンプレート API の基盤にも、エスケープしなければ注入点にもなる。
- 文字列の `\xXX`/`\uXXXX`/`\u{XXXXX}` エスケープは注入とサニタイザ迂回に直結し、`\u{2F804}` は UTF-16 のサロゲートペア `\uD87E\uDC04` と等価。
- ブロックコメントはネスト不可で `*/` により早期終了する。hashbang（`#!/usr/bin/env node`）はファイル先頭で実行エンジンを指定する第3のコメント構文。
- `new Function(文字列)` は `eval()` 相当の動的コード実行 sink で、CSP `unsafe-eval` の対象、Trusted Types では `TrustedScript` が要求される。
- 関数のオブジェクト・配列引数は参照が共有され、関数内での中身の変更が呼び出し元に反映される。`call()`/`apply()` は `this` を差し替えて動的に呼ぶ手段。
- `arguments` は array-like だが配列ではない。default parameters と rest parameters が可変長・省略引数を扱う。
- クロージャは関数とレキシカル環境の組で、スコープチェーンにより内側が外側を再帰的に含む。インポート値は live bindings として閉じ込められ、元が変わると追随する。秘密を隠すパターンは頻出だが、ブラウザではソースが配信されるため機密性を保証しない。
- ループ内クロージャで `var` を使うと全コールバックが最後の値を共有するバグになる。解決策は makeHelpCallback（関数ファクトリ）・IIFE・`let`/`const` の3つ。

## 理解度チェック

1. ECMAScript 仕様は DOM を定義しているか。診断上なぜこの区別が重要か。
   ▶ 答え：定義していない。DOM は W3C/WHATWG が標準化する別仕様。`eval`/`Function` は言語側、`innerHTML`/`document.write` は DOM 側に属し、仕様を当たる場所も攻撃面の考え方も別になるため。

2. `const CONFIG = { admin: false }` に対し `CONFIG.admin = true` は成功するか。
   ▶ 答え：成功する。`const` は再代入を防ぐだけでミューテーションは防がない。中身のプロパティは書き換えられる。

3. `parseInt("12abc")` と `+" "` の結果は何か。これがバリデーション迂回にどう関わるか。
   ▶ 答え：それぞれ `12` と `0`。数値化が寛容なため、末尾ゴミや空白を含む入力が「数値として通ってしまい」、範囲チェックをすり抜ける余地が生まれる。

4. `const fish = ["Lion", , "Angel"]` の `fish[1]` と、`fish.map(...)` での2番目の扱いはどう違うか。
   ▶ 答え：`fish[1]` はインデックスアクセスなので `undefined` を返すが、2番目は「空スロット（empty item）」であり `map` などの走査メソッドではスキップされる。空スロットは実際の `undefined` 値とは厳密には別物である。

5. オブジェクトリテラルやマージ処理で `__proto__` キーが特別なのはなぜか。どの脆弱性につながるか。
   ▶ 答え：`__proto__:` キーはオブジェクトの `[[Prototype]]`（プロトタイプ）を設定するため。外部入力の `{"__proto__": {...}}` を素朴な再帰マージ・deep clone に通すと `Object.prototype` が汚染され、プロトタイプ汚染（prototype pollution）が成立する。防御は `Object.create(null)`・`Map`・危険キーの拒否など。

6. `new Function(userInput)` はなぜ危険か。どの防御でブロックできるか。
   ▶ 答え：文字列を実行時にコードとして実行する `eval()` 相当の動的コード実行 sink だから。CSP で `unsafe-eval` を許可しなければブロックされ、Trusted Types では `TrustedScript` が要求される。

7. 「API キーをクロージャの内側変数に入れれば外から読めない」は正しいか。
   ▶ 答え：クライアントサイドでは正しくない。クロージャは同一コンテキスト内の他スクリプトからの参照を防ぐだけ。ブラウザはソースを配信するので、JS バンドルを読めば値そのものが見える。

8. `var` を使ったループでイベントハンドラを登録すると、どのハンドラも最後のデータしか使わないのはなぜか。解決策を3つ挙げよ。
   ▶ 答え：`var` は関数スコープなので全コールバックが同じ変数を共有し、コールバック実行時にはループが終わって変数が最後のエントリを指しているため。解決策は（1）関数ファクトリ `makeHelpCallback`、（2）IIFE で各反復を包む、（3）`let`/`const`（反復ごとに新しい束縛）。`for...of`/`forEach()` でも回避できる。

9. `arguments` と rest parameters（`...theArgs`）の違いは何か。
   ▶ 答え：`arguments` は array-like だが本物の配列ではなく、`map` などを直接呼べない。rest parameters は本物の配列で受け取るのでそのまま配列メソッドが使える。

10. `\u{2F804}` はどの表現と等価か。フィルタ迂回でなぜ重要か。
    ▶ 答え：UTF-16 のサロゲートペア `\uD87E\uDC04`（2コードユニット）と等価で、この2ユニットが結合して1コードポイント U+2F804 を表す。1コードユニット単位で検査するブラックリスト方式のサニタイザは、サロゲートの分割・結合の差ですり抜けられる余地がある。

## 出典

- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_types
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Functions
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures
- https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/javascript/guide/closures/index.md

<!-- sources: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_types, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Functions, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures -->
<!-- terms: ECMAScript, ホスト環境, 同一オリジンポリシー, 巻き上げ, temporal dead zone, 型強制, strict mode, 自動セミコロン挿入, destructuring, 配列リテラル, 空スロット, オブジェクトリテラル, プロトタイプ汚染, __proto__, テンプレートリテラル, タグ付きテンプレート, サロゲートペア, hashbang, Function コンストラクタ, 動的コード実行 sink, arguments オブジェクト, default parameters, rest parameters, クロージャ, レキシカル環境, スコープチェーン, live bindings, IIFE, モジュールパターン, DOM Clobbering, Trusted Types, CSP, グローバルオブジェクト -->
<!-- self-read: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures | egress プロキシによりサイト側で制限（EGRESS_BLOCKED / CONNECT 403）。ライブサンプルの実動作は原稿に含まれないため要ブラウザ確認 -->
