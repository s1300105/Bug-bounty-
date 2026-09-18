# JavaScript の土台：宣言・型変換・関数・クロージャを攻撃者の目で読む

> **この節で分かること**
> - MDN JavaScript ガイドの全体構成と、「ガイド」と「リファレンス」の役割分担を説明できる
> - 変数宣言（`var`/`let`/`const`）・巻き上げ・TDZ・未宣言グローバルの仕組みと、それがグローバル汚染にどう関わるかを説明できる
> - 動的型付けと型強制（coercion）が、クライアントサイドのバリデーション迂回にどう使われるかを説明できる
> - 文字列の特殊文字エスケープ（`\xXX`/`\uXXXX`/`\u{XXXXX}`）が、注入とサニタイザ迂回にどう関わるかを説明できる
> - `Function` コンストラクタが `eval()` 相当の動的コード実行 sink であることを指摘できる
> - クロージャの仕組みを理解し、「クロージャで秘密を隠す」パターンがクライアントサイドでは機密性を保証しないことを説明できる

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

### 3.2 未宣言代入が「暗黙のグローバル」を作る

変数は必ず使う前に宣言すべきである。理由は次の性質にある。

> JavaScript は以前、未宣言変数への代入を許しており、それは undeclared global（未宣言グローバル）変数を作る。これは strict mode ではエラーであり、完全に避けるべき。

`strict mode`（厳格モード）とは、JavaScript のゆるい挙動を禁止して間違いを早く検出させる実行モードのこと。`"use strict";` を先頭に書くか、モジュールとして読み込むと有効になる。

〔補足〕この「未宣言代入が暗黙のグローバルを作る」性質は、非 strict な古いスクリプトでのグローバル変数汚染や、DOM Clobbering（HTML 要素の `id`/`name` でグローバル変数や既存プロパティを上書きする手法）との相互作用を考える基礎になる。攻撃者は「どこかで `x = 値` と未宣言代入している非 strict コード」を見つけると、そのグローバルを外から観測・上書きできる余地を疑う。

### 3.3 スコープと巻き上げ（hoisting）

変数のスコープ（scope、変数が有効な範囲）は次のいずれか。`var` は関数スコープ、`let`/`const` はブロックスコープになる。

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

### 3.4 定数は「再代入」だけを防ぎ「変更」は防がない

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

### 3.5 グローバル変数はグローバルオブジェクトのプロパティ

グローバル変数は実際には**グローバルオブジェクトのプロパティ**である。ウェブページでは `window` がグローバルオブジェクトなので `window.variable` で読み書きでき、全環境共通では `globalThis` が使える。そして次の性質が攻撃面になる。

> あるウィンドウやフレームで宣言されたグローバル変数を、別のウィンドウやフレームから `window` 名または `frame` 名を指定してアクセスできる。例えばあるドキュメントで `phoneNumber` という変数が宣言されていれば、`iframe` からは `parent.phoneNumber` として参照できる。

〔補足〕この段落は、同一オリジンの iframe・親フレーム間でスクリプトが互いのグローバルにアクセスできることを示す。`window.name` や `parent.*` 経由のデータ受け渡しを理解する土台になる。ただしクロスオリジンでは同一オリジンポリシー（Same-Origin Policy, SOP）で遮断される。診断では「同一オリジンで複数フレームを使うページ」で、フレーム間のグローバル参照がデータ流入経路になっていないかを見る。

---

## 4. データ型と型変換：バリデーション迂回の温床

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

### 4.3 リテラルと数値の基数表現

整数リテラルは10進・16進・8進・2進で書ける。先頭 `0x` は16進、`0o`（または旧式の先頭 `0`）は8進、`0b` は2進、末尾 `n` は BigInt を示す。

```plain
0, 117, 123456789123456789n             (decimal, base 10)
015, 0001, 0o777777777777n              (octal, base 8)
0x1123, 0x00111, 0x123456789ABCDEFn     (hexadecimal, "hex" or base 16)
0b11, 0b0011, 0b11101001010101010101n   (binary, base 2)
```

複数の基数表現があることは、フィルタが `"0x..."` や8進表記を想定していない場合の迂回材料になる。

### 4.4 文字列の特殊文字とエスケープ：注入の基礎

文字列コンテキストへの注入を考えるうえで、エスケープ表は暗記に近い重要度を持つ。以下は原文の表である。

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
| `\uXXXX` | The Unicode character specified by the four hexadecimal digits `XXXX`. For example, `©` is the Unicode sequence for the copyright symbol. |
| `\u{XXXXX}` | Unicode code point escapes. For example, `\u{2F804}` is the same as the Unicode escapes `你`. |

文字列内にクォートを含めるにはバックスラッシュでエスケープする。

```js
const quote = "He read \"The Cremation of Sam McGee\" by R.W. Service.";
```

〔補足〕`\xXX` / `\uXXXX` / `\u{XXXXX}` の3系統は、JS 文字列コンテキストへの注入時に「バックスラッシュ経由でクォートを回避する」「ブラックリスト方式のサニタイザを Unicode エスケープで通す」といった検討に直結する。特に `\u{2F804}` がサロゲートペア `你` と等価である点は、UTF-16 のサロゲート分割によるフィルタ迂回を理解するために必要である。防御側は、エスケープ済み文字列を「表示前に必ず正規化し、コンテキストに応じた出力エンコードを行う」ことで、こうした表現ゆらぎを潰す。

### 4.5 コメントの早期終了と hashbang

ブロックコメント `/* ... */` はネストできず、途中に `*/` が現れるとそこで終わる。

```js
/* You can't, however, /* nest comments */ SyntaxError */
```

〔補足〕`*/` でコメントが早期終了する性質は、ユーザー入力を JS のコメント内に埋め込むテンプレートでのコメントブレイクアウト（コメント脱出）を考える基礎になる。入力に `*/` を含められれば、コメントを抜けて後続をコードとして評価させられる余地が生まれる。

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

この「オブジェクトは参照が共有される」性質は、渡した設定オブジェクトが関数内で書き換えられ得ることを意味し、後述のプロトタイプ汚染や設定改ざんを読む土台になる。

### 5.2 関数式・無名関数・そして `Function` コンストラクタ

関数は宣言（`function square() {}`）だけでなく、関数式でも作れる。関数式は無名でよい。

```js
const square = function (number) {
  return number * number;
};
```

そして MDN は、動的コード実行の核心をさらりと書いている。

> you can also use the `Function` constructor to create functions from a string at runtime, much like `eval()`.

つまり `new Function(userInput)` は「文字列から実行時に関数を作る」ものであり、`eval()` とよく似た危険を持つ。

〔補足〕この1文はクライアントサイド脆弱性ハンティングで極めて重要である。`new Function(x)` や `Function("return " + x)()` は `eval` と同じ**動的コード実行 sink** であり、外部入力がここに到達すると任意 JS 実行につながる。防御側では、コンテンツセキュリティポリシー（Content Security Policy, CSP）の `unsafe-eval` を許可しなければ `eval` と `Function` コンストラクタの両方がブロックされる。さらに Trusted Types を使うと、これらに渡す文字列に `TrustedScript` を要求できる。診断では、コード中の `Function(`、`eval(`、`setTimeout(文字列)`、`setInterval(文字列)` を grep して sink を洗い出すのが定番になる。

### 5.3 巻き上げの差：宣言は動く、式は動かない

関数宣言は巻き上げられるので呼び出しより下に書いてよいが、関数式（`const square = function...`）は巻き上げられない。

```js
console.log(square(5)); // ReferenceError: Cannot access 'square' before initialization
const square = function (n) {
  return n * n;
};
```

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

### 5.5 IIFE：スコープを閉じる基本パターン

**IIFE（Immediately Invoked Function Expression、即時実行関数式）**とは、式として定義した関数をその場で呼び出すパターンのこと。

```js
(function () {
  // Do something
})();

const value = (function () {
  // Do something
  return someValue;
})();
```

利点は「変数の追加スコープを作る」「文の列ではなく式になる」の2つ。後述のモジュールパターンやクロージャによるデータ隠蔽の土台になる。

### 5.6 アロー関数と非 strict の `this` グローバル汚染

アロー関数（arrow function）は短い構文を持ち、**自身の `this`、`arguments`、`super`、`new.target` を持たない**。`this` は囲む実行コンテキストのものを使う。

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

### 6.3 クロージャで「秘密」を隠すパターンとその限界

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

### 6.4 モジュールパターンによる private エミュレーション

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

`makeCounter()` を関数にすれば、呼ぶたびに独立したカウンタが得られる。これはデータ隠蔽（data hiding）とカプセル化（encapsulation）の利点をもたらすが、6.3 と同じく「ソースが読める環境では実装の秘密は守れない」点は変わらない。

### 6.5 ループ内クロージャの典型バグ（`var` の罠）

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

解決策は次の3つが示される。

```js
// 解決策3: let または const を使う（各反復でブロックスコープにバインドされる）
for (let i = 0; i < helpText.length; i++) {
  const item = helpText[i];
  document.getElementById(item.id).onfocus = () => {
    showHelp(item.help);
  };
}
```

`let`/`const` が反復ごとに新しい束縛を作るため、追加のクロージャなしで直る。`for...of` や `forEach()` でも回避できる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: MDN「Closures」章のライブサンプル（practical closures のフォントサイズ変更ボタン、および closures_bad / closures_factory のループ内バグと修正） — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures
> **なぜ**: 本教科書の執筆環境からは developer.mozilla.org を自動取得できなかった（理由: egress プロキシによるサイト側の制限 / `EGRESS_BLOCKED`・CONNECT 403）。代替として MDN 公式リポジトリのソース Markdown を取得したため本文・コードは逐語で得られているが、`{{EmbedLiveSample}}` で描画される**実際に動くサンプル**はソース原稿には含まれない。以下の記述はその原稿（一次資料の本文）にもとづく要約である。
> **読みどころ**:
> 1. practical closures のフォントサイズボタンを実際にクリックし、`makeSizer(12/14/16)` が返す各クロージャが別々の `size` を覚えていることを体感する。
> 2. ループ内クロージャのバグ版（`var`）と修正版（`let`）を、各入力欄にフォーカスして挙動の違いを確かめる。「最後のエントリしか出ない」現象を目で見る。
> **代替手段**: ソース原稿は公開ミラー `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/javascript/guide/closures/index.md` で読める（本文・コードは同一。ただしライブ描画は含まれない）。

### 6.6 クロージャの性能上の注意

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

3. **動的コード実行 sink を探す**：対象の JS バンドルをブラウザの Sources タブで開き、`eval(`、`new Function(`、`Function(`、`setTimeout("`、`setInterval("` を検索する。ヒットした箇所について、そこへ到達するデータが外部入力（URL、`postMessage`、DOM、localStorage）由来かを追う。

4. **ハードコード秘密を探す**：同じバンドルに対し `apiKey`、`api_key`、`secret`、`token`、`Bearer ` などで検索する。クロージャ内に隠したつもりの値も、ソースを読めば見えることを確認する。

5. **DOM を歩くクローラを書く**：Console に `walkTree` を貼り、`document.body` から全ノードを列挙して、`innerHTML` を持つ要素や `onclick` などインラインハンドラを持つ要素を集めてみる。危険な sink の地図を自分で作る。

## つまずきポイント

- **`const` は不変ではない**。再代入は防ぐが、オブジェクトや配列の中身は書き換えられる。`const CONFIG = {...}` を「安全な設定」と思い込むと汚染を見逃す。
- **`==` と型強制を後半パートの話だと油断しない**。本節の `"37" - 7 === 30` の時点で、片方向の暗黙変換はすでに始まっている。
- **クロージャ＝機密性、ではない**。クロージャは同一コンテキスト内の他スクリプトからの参照を防ぐだけ。ブラウザではソースが配信されるので、値そのものは読める。
- **ECMAScript と DOM を混同しない**。`eval`/`Function` は言語（ECMAScript）側、`innerHTML`/`document.write` は DOM 側。標準団体が別なので、仕様を当たる場所も別になる。
- **巻き上げの向きを取り違える**。関数宣言は丸ごと巻き上がるが、`const f = function...` の関数式は TDZ に入り、宣言前アクセスは `ReferenceError`。
- **非 strict の `this`**。通常関数のコールバックでは `this` が `window` になり得る。`this.x = ...` が黙ってグローバルを汚す。

## この節のまとめ

- MDN ガイドは「概観」担当、リファレンスは「網羅的仕様」担当という役割分担で書かれている。
- ECMAScript は DOM を定義しない。言語のルールとブラウザ API のルールは別団体の別仕様であり、その境界にクライアントサイド脆弱性が集まる。
- DevTools コンソールは `eval` 相当で動き、診断でオリジン上の JS コンテキストを直接触る入口になる。
- 未宣言代入は非 strict では暗黙のグローバルを作り、strict mode ではエラーになる。グローバル汚染・DOM Clobbering の前提知識である。
- `var` は関数スコープで巻き上げられ（値は巻き上げない）、`let`/`const` はブロックスコープで TDZ を持つ。関数宣言は丸ごと巻き上がる。
- `const` は再代入を防ぐがミューテーションは防がない。設定オブジェクトのプロパティは書き換え可能。
- グローバル変数はグローバルオブジェクトのプロパティで、同一オリジンのフレーム間で `parent.変数名` として参照できる。
- 動的型付けと型強制（`parseInt` の寛容さ、`"37" - 7 === 30`、単項 `+`）は数値・文字列バリデーション迂回の温床。
- 文字列の `\xXX`/`\uXXXX`/`\u{XXXXX}` エスケープは注入とサニタイザ迂回に直結し、`\u{...}` はサロゲートペアと等価。
- `new Function(文字列)` は `eval()` 相当の動的コード実行 sink で、CSP `unsafe-eval` の対象、Trusted Types では `TrustedScript` が要求される。
- 関数のオブジェクト引数は参照が共有され、関数内での中身の変更が呼び出し元に反映される。
- クロージャは関数とレキシカル環境の組。秘密を隠すパターンは頻出だが、ブラウザではソースが配信されるため機密性を保証しない。
- ループ内クロージャで `var` を使うと全コールバックが最後の値を共有するバグになる。`let`/`const`/`for...of`/`forEach` で回避する。

## 理解度チェック

1. ECMAScript 仕様は DOM を定義しているか。診断上なぜこの区別が重要か。
   ▶ 答え：定義していない。DOM は W3C/WHATWG が標準化する別仕様。`eval`/`Function` は言語側、`innerHTML`/`document.write` は DOM 側に属し、仕様を当たる場所も攻撃面の考え方も別になるため。

2. `const CONFIG = { admin: false }` に対し `CONFIG.admin = true` は成功するか。
   ▶ 答え：成功する。`const` は再代入を防ぐだけでミューテーションは防がない。中身のプロパティは書き換えられる。

3. `parseInt("12abc")` と `+" "` の結果は何か。これがバリデーション迂回にどう関わるか。
   ▶ 答え：それぞれ `12` と `0`。数値化が寛容なため、末尾ゴミや空白を含む入力が「数値として通ってしまい」、範囲チェックをすり抜ける余地が生まれる。

4. `new Function(userInput)` はなぜ危険か。どの防御でブロックできるか。
   ▶ 答え：文字列を実行時にコードとして実行する `eval()` 相当の動的コード実行 sink だから。CSP で `unsafe-eval` を許可しなければブロックされ、Trusted Types では `TrustedScript` が要求される。

5. 「API キーをクロージャの内側変数に入れれば外から読めない」は正しいか。
   ▶ 答え：クライアントサイドでは正しくない。クロージャは同一コンテキスト内の他スクリプトからの参照を防ぐだけ。ブラウザはソースを配信するので、JS バンドルを読めば値そのものが見える。

6. `var` を使ったループでイベントハンドラを登録すると、どのハンドラも最後のデータしか使わないのはなぜか。
   ▶ 答え：`var` は関数スコープなので全コールバックが同じ変数を共有し、コールバック実行時にはループが終わって変数が最後のエントリを指しているため。`let`/`const` なら反復ごとに新しい束縛が作られ回避できる。

7. 非 strict モードの通常関数コールバック内で `this` は何を指し得るか。それがなぜ問題か。
   ▶ 答え：グローバルオブジェクト（ブラウザでは `window`）を指し得る。`this.x = ...` が意図せずグローバルを汚染し、DOM Clobbering などと併せて悪用される経路になる。

8. `\u{2F804}` はどの表現と等価か。フィルタ迂回でなぜ重要か。
   ▶ 答え：サロゲートペア `你` と等価。UTF-16 のサロゲート分割や Unicode エスケープで、ブラックリスト方式のサニタイザを通り抜ける迂回を理解する材料になる。

## 出典

- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_types
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Functions
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures
- https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/javascript/guide/closures/index.md

<!-- sources: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_types, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Functions, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures -->
<!-- terms: ECMAScript, ホスト環境, 同一オリジンポリシー, 巻き上げ, temporal dead zone, 型強制, strict mode, Function コンストラクタ, 動的コード実行 sink, クロージャ, レキシカル環境, IIFE, モジュールパターン, DOM Clobbering, Trusted Types, CSP, グローバルオブジェクト -->
<!-- self-read: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures | egress プロキシによりサイト側で制限（EGRESS_BLOCKED / CONNECT 403）。ライブサンプルの実動作は原稿に含まれないため要ブラウザ確認 -->
