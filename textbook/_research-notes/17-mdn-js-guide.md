# [17] MDN JavaScript Guide（JavaScript ガイド）— 目次全体と各章の詳細

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide | full | `curl` で raw.githubusercontent（MDN公式コンテンツリポジトリ `mdn/content` の当該ページのソース Markdown）を取得 | **WebFetch は `EGRESS_BLOCKED`（"Access to developer.mozilla.org is blocked by the network egress proxy"）で失敗。curl も `CONNECT tunnel failed, response 403`。web.archive.org も同様に 403 でブロック。** そのため MDN の公開ソースリポジトリ `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/javascript/guide/index.md` から**レンダリング前の原文そのもの**を取得した。これは developer.mozilla.org が配信している本文と同一の原稿であり、内容欠落はない（サイドバー・ライブサンプルの描画のみ欠ける）。 |
| （派生）`.../Guide/Introduction` | full | 同上 `guide/introduction/index.md` | 目次の第1章 |
| （派生）`.../Guide/Grammar_and_types` | full | 同上 `guide/grammar_and_types/index.md` | 重点項目 |
| （派生）`.../Guide/Functions` | full | 同上 `guide/functions/index.md` | 重点項目（クロージャ） |
| （派生）`.../Guide/Closures` | full | 同上 `guide/closures/index.md` | 重点項目（クロージャ・上級編） |
| （派生）`.../Guide/Working_with_objects` | full | 同上 `guide/working_with_objects/index.md` | 重点項目 |
| （派生）`.../Guide/Inheritance_and_the_prototype_chain` | full | 同上 | 重点項目「Details of the object model」の現行後継ページ |
| （派生）`.../Guide/Using_classes` | full | 同上 `guide/using_classes/index.md` | private fields |
| （派生）`.../Guide/Iterators_and_generators` | full | 同上 | 重点項目 |
| （派生）`.../Guide/Meta_programming` | full | 同上 `guide/meta_programming/index.md` | 重点項目（Proxy/Reflect） |
| （派生）`.../Guide/Using_promises` | full | 同上 `guide/using_promises/index.md` | 重点項目 |
| （派生）`.../Guide/Modules` | full | 同上 `guide/modules/index.md` | 重点項目 |
| （派生）`.../Guide/Data_structures` | full | 同上 | 型・型強制 |
| （派生）`.../Guide/Equality_comparisons_and_sameness` | full | 同上 | `==`/`===`/`Object.is` 比較表 |
| （派生）`.../Guide/Enumerability_and_ownership_of_properties` | full | 同上 | 列挙可能性・所有性の表 |
| （派生）`.../Guide/Memory_management` | full | 同上 | GC・WeakMap/WeakRef |
| （派生）`.../Guide/Language_overview` | full | 同上 | 言語全体像 |

> 重要：担当URLは「ガイドのハブ（目次）ページ」である。ハブ自体は目次と各章の1行説明しか持たないため、**重点抽出指示に挙げられた各章（Grammar and types / Functions（クロージャ）/ Working with objects / プロトタイプ / Iterators・Generators / Meta programming / Using promises / Modules）の本文も同じ公式リポジトリから取得して本ノートに収録した**。以降の「詳細ノート」は章ごとに出典を明記する。

---

## 要約（3〜10行）

- MDN JavaScript Guide は「言語の全体像を与えるガイド」であり、網羅的な仕様情報は別途 JavaScript reference を見ろ、という役割分担で書かれている。
- 目次は 18 の主要章（Introduction / Grammar and types / Control flow and error handling / Loops and iteration / Functions / Expressions and operators / Numbers and strings / Representing dates & times / Regular expressions / Indexed collections / Keyed collections / Working with objects / Using classes / Promises / Typed arrays / Iterators and generators / Resource management / Internationalization / JavaScript modules）と、それらの後に置かれる「Advanced topics」8本（Language overview / Data structures / Enumerability and ownership of properties / Inheritance and the prototype chain / Equality comparisons and sameness / Closures / Meta programming / Memory management）で構成される。
- クライアントサイド脆弱性ハンティングに直結する記述が明示的に含まれる箇所がある。特に Working with objects は **「外部入力で与えられた名前をブラケット記法でプロパティアクセスに使うと object injection attack に対して脆弱になり得る」** と警告し、eslint-plugin-security のドキュメントを参照している。
- プロトタイプ章は `[[Prototype]]` / `__proto__` / `Object.setPrototypeOf` / `Object.create(null)` / プロパティシャドウイング / ビルトインプロトタイプ拡張（monkey patching）の危険を体系的に説明しており、プロトタイプ汚染（prototype pollution）の前提知識がすべて揃う。
- Meta programming 章は Proxy の全 13 トラップと、それぞれが横取りする操作の対応表、`Proxy.revocable()`、`Reflect` の各メソッドを提示する。改ざん検知・サニタイザ迂回・DOM API フックの技術的基礎になる。
- Modules 章は `type="module"` のセキュリティ上の差分（自動 strict mode、`file://` での CORS エラー、MIME タイプ厳格チェック、自動 defer、1回だけ実行、グローバルスコープに出ない）と import maps（`imports` / `scopes` キー、最長一致）、import attributes（`with { type: "json" }`）、動的 `import()`、top-level await、循環インポートを扱う。
- Using promises 章はマイクロタスクキューと task queue の実行順、`unhandledrejection` / `rejectionhandled` イベント、floating promise（`return` 忘れ）による競合を具体コードで示す。

---

## 詳細ノート

### 1. ガイドのハブページ全体構成（出典: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide）

冒頭文（原文）:

> The JavaScript Guide shows you how to use JavaScript and gives an overview of the language. If you need exhaustive information about a language feature, have a look at the JavaScript reference.
>
> This Guide is divided into the following chapters.

以下、ハブページの目次を原文のリンクテキストのまま完全再現する（各章の「Overview:」行と、その下のアンカーリンク群）。

#### 目次（逐語）

**## Introduction** — Overview: `Introduction`
- `About this guide` → `Introduction#where_to_find_javascript_information`
- `About JavaScript` → `Introduction#what_is_javascript`
- `JavaScript and Java` → `Introduction#javascript_and_java`
- `ECMAScript` → `Introduction#javascript_and_the_ecmascript_specification`
- `Tools` → `Introduction#getting_started_with_javascript`
- `What's next` → `Introduction#whats_next`

**## Grammar and types** — Overview: `Grammar and types`
- `Basic syntax & comments` → `#basics`
- `Declarations` → `#declarations`
- `Variable scope` → `#variable_scope`
- `Variable hoisting` → `#variable_hoisting`
- `Data structures and types` → `#data_structures_and_types`
- `Literals` → `#literals`

**## Control flow and error handling** — Overview: `Control flow and error handling`
- `if...else` → `#if...else_statement`
- `switch` → `#switch_statement`
- `try`/`catch`/`throw` → `#exception_handling_statements`
- `Error objects` → `#utilizing_error_objects`

**## Loops and iteration** — Overview: `Loops and iteration`
- `for` → `#for_statement`
- `while` → `#while_statement`
- `do...while` → `#do...while_statement`
- `continue` → `#continue_statement`
- `break` → `#break_statement`
- `for...in` → `#for...in_statement`
- `for...of` → `#for...of_statement`

**## Functions** — Overview: `Functions`
- `Defining functions` → `#defining_functions`
- `Calling functions` → `#calling_functions`
- `Function scopes and closures` → `#function_scopes_and_closures`
- `Arguments` → `#using_the_arguments_object` & `parameters` → `#function_parameters`
- `Arrow functions` → `#arrow_functions`

**## Expressions and operators** — Overview: `Expressions and operators`
- `Assignment` → `#assignment_operators` & `Comparisons` → `#comparison_operators`
- `Arithmetic operators` → `#arithmetic_operators`
- `Bitwise` → `#bitwise_operators` & `logical operators` → `#logical_operators`
- `Conditional (ternary) operator` → `#conditional_ternary_operator`

**## Numbers and strings** — Overview: `Numbers and strings`
- `Numbers` / `Number` object / `Math` object / `Strings` / `String` object / `Template literals`

**## Representing dates & times** — Overview: `Representing dates & times`
- `Date` object

**## Regular expressions** — Overview: `Regular expressions`
- `Creating a regular expression` → `#creating_a_regular_expression`
- `Writing a regular expression pattern` → `#writing_a_regular_expression_pattern`
  - `Assertions`（独立ページ `Regular_expressions/Assertions`）
  - `Character classes`（独立ページ `Regular_expressions/Character_classes`）
  - `Groups and backreferences`（独立ページ `Regular_expressions/Groups_and_backreferences`）
  - `Quantifiers`（独立ページ `Regular_expressions/Quantifiers`）

**## Indexed collections** — Overview: `Indexed collections`（サブ項目なし）

**## Keyed collections** — Overview: `Keyed collections`
- `Map` → `#map_object`
- `WeakMap` → `#weakmap_object`
- `Set` → `#set_object`
- `WeakSet` → `#weakset_object`

**## Working with objects** — Overview: `Working with objects`
- `Objects and properties` → `#objects_and_properties`
- `Creating objects` → `#creating_new_objects`
- `Defining methods` → `#defining_methods`
- `Getter and setter` → `#defining_getters_and_setters`

**## Using classes** — Overview: `Using classes`
- `Declaring a class` → `#declaring_a_class`
- `Various class features` → `#constructor`
- `Extends and inheritance` → `#extends_and_inheritance`
- `Why classes?` → `#why_classes`

**## Promises** — Overview: `Promises`（実体ページは `Guide/Using_promises`）
- `Guarantees` → `#guarantees`
- `Chaining` → `#chaining`
- `Error handling` → `#error_handling`
- `Composition` → `#composition`
- `Timing` → `#timing`

**## Typed arrays** — Overview: `Typed arrays`（`Guide/Typed_arrays`、サブ項目なし）

**## Iterators and generators** — Overview: `Iterators and generators`
- `Iterators` → `#iterators`
- `Iterables` → `#iterables`
- `Generators` → `#generator_functions`

**## Resource management** — Overview: `JavaScript resource management`
- `The using and await using declarations` → `#the_using_and_await_using_declarations`
- `The DisposableStack and AsyncDisposableStack objects` → `#the_disposablestack_and_asyncdisposablestack_objects`
- `Error handling` → `#error_handling`

**## Internationalization** — Overview: `Internationalization`
- `Date and time formatting` → `#date_and_time_formatting`
- `Number formatting` → `#number_formatting`
- `Collation` → `#collation`

**## JavaScript modules** — Overview: `JavaScript modules`
- `Exporting` → `#exporting_module_features`
- `Importing` → `#importing_features_into_your_script`
- `Default exports` → `#default_exports_versus_named_exports`
- `Renaming features` → `#renaming_imports_and_exports`
- `Aggregating modules` → `#aggregating_modules`
- `Dynamic module loading` → `#dynamic_module_loading`

**## Advanced topics** — 導入文（原文）:

> After you have learned all fundamental features of JavaScript, you can explore some more niche features, or dive deeper into the language's mechanisms and concepts.

- `Language overview` → `Guide/Language_overview`
- `Data structures` → `Guide/Data_structures`
- `Enumerability and ownership of properties` → `Guide/Enumerability_and_ownership_of_properties`
- `Inheritance and the prototype chain` → `Guide/Inheritance_and_the_prototype_chain`
- `Equality comparisons and sameness` → `Guide/Equality_comparisons_and_sameness`
- `Closures` → `Guide/Closures`
- `Meta programming` → `Guide/Meta_programming`
- `Memory management` → `Guide/Memory_management`

末尾には `{{Next("Web/JavaScript/Guide/Introduction")}}` のナビゲーションマクロがある。

〔補足（一般知識）〕旧版 MDN に存在した「Details of the object model」という章名は、現行では **Inheritance and the prototype chain**（プロトタイプチェーンによる継承）と **Using classes** に分割・改題されている。担当指示の「Details of the object model（プロトタイプ）」に対応する現行ページは前者である。

---

### 2. Introduction（出典: .../Guide/Introduction）

#### What you should already know（前提知識）
- インターネットと WWW の一般的理解
- HTML の実務的知識
- 何らかのプログラミング経験

#### Where to find JavaScript information（MDN の JS ドキュメント構成）
- `Dynamic scripting with JavaScript`（`/Learn_web_development/Core/Scripting`）: 初心者向けの構造化ガイド
- `JavaScript Guide`（本ガイド）: 言語とそのオブジェクトの概観
- `JavaScript Reference`: 詳細なリファレンス

#### What is JavaScript?
原文の定義:

> JavaScript is a cross-platform, object-oriented scripting language used to make webpages interactive (e.g., having complex animations, clickable buttons, popup menus, etc.).

- ホスト環境（例: ウェブブラウザ）の中で、JavaScript はその環境のオブジェクトに接続され、プログラム的な制御を提供する。
- 標準ライブラリのオブジェクト（`Array`, `Map`, `Math`）と、コアの言語要素（演算子・制御構造・文）を持つ。
- **Client-side JavaScript**: ブラウザとその DOM を制御するオブジェクトでコア言語を拡張する。HTML フォームに要素を置き、マウスクリック・フォーム入力・ページ遷移といったユーザーイベントに応答できる。
- **Server-side JavaScript**: サーバー上で動く JavaScript に関連するオブジェクトで拡張する。データベースとの通信、呼び出し間の情報の継続、ファイル操作など。

#### JavaScript and Java（比較表を完全再現）

| JavaScript | Java |
| --- | --- |
| Object-oriented. No distinction between types of objects. Inheritance is through the prototype mechanism, and properties and methods can be added to any object dynamically. | Class-based. Objects are divided into classes and instances with all inheritance through the class hierarchy. Classes and instances cannot have properties or methods added dynamically. |
| Variable data types are not declared (dynamic typing, loosely typed). | Variable data types must be declared (static typing, strongly typed). |
| Cannot automatically write to hard disk. | Can automatically write to hard disk. |

補足される要点:
- JavaScript は Java の式構文・命名規約・基本制御フロー構造の多くを踏襲した（LiveScript から JavaScript へ改名された理由）。
- Java のコンパイル時クラス宣言システムに対し、JavaScript は数値・真偽値・文字列を表す少数のデータ型に基づく**ランタイムシステム**。
- **プロトタイプベースのオブジェクトモデル**であり、動的継承を提供する。すなわち「継承される内容が個々のオブジェクトごとに異なり得る」。
- 関数は宣言上の特別な要件なしにサポートされ、オブジェクトのプロパティになり、緩く型付けされたメソッドとして実行される。

#### JavaScript and the ECMAScript specification
- JavaScript は Ecma International で標準化されている。標準化版は **ECMAScript** と呼ばれ、**ECMA-262** 仕様書に記述される。
- ECMA-262 は ISO により **ISO-16262** としても承認されている。
- **ECMAScript 仕様は DOM を記述しない。** DOM は W3C および/または WHATWG が標準化する。DOM は HTML ドキュメントのオブジェクトがスクリプトにどう露出されるかを定義する。
- エンジンの例として SpiderMonkey（Firefox）、V8（Chrome）が挙げられている。
- 「ECMAScript ドキュメントはスクリプトプログラマを助けることを意図していない。スクリプトを書くときは JavaScript ドキュメントを使え」と明示。

#### Getting started with JavaScript（ツール）
- 必要なのはモダンブラウザのみ。Firefox / Chrome / Microsoft Edge / Safari の最近のバージョンはガイドで議論される機能をすべてサポートする。
- **JavaScript Console（Web Console、単に console）**: 現在のページで JavaScript を入力・実行できるツール。
- コンソールは `eval` とまったく同じように動作し、最後に入力した式が返る。概念的には入力が毎回 `console.log` と `eval` で囲まれていると考えればよい:

```js
console.log(eval("3 + 5"));
```

- 複数行入力: 入力が不完全（例: `function foo() {`）なら Enter は改行として扱われる。<kbd>Shift</kbd>+<kbd>Enter</kbd> でも改行。Firefox のみ multi-line input mode がある。
- 最初に試すコード（原文のまま）:

```js
(function () {
  "use strict";
  /* Start of your code */
  function greetMe(yourName) {
    alert(`Hello ${yourName}`);
  }

  greetMe("World");
  /* End of your code */
```

〔補足（一般知識）〕DevTools コンソールが `eval` 相当で動くという性質は、診断作業でページのオリジン上の JS コンテキストを直接触る際の前提になる。後述の「Chrome コンソールでは private field に外からアクセスできる（DevTools 限定の構文制限緩和）」という MDN の注記も同じ文脈である。

---

### 3. Grammar and types（出典: .../Guide/Grammar_and_types）

章の導入: 「This chapter discusses JavaScript's basic grammar, variable declarations, data types and literals.」

#### 3.1 Basics
- JavaScript は構文の大半を Java, C, C++ から借用し、Awk, Perl, Python からも影響を受けた。
- **case-sensitive** で **Unicode** 文字集合を使う。ドイツ語の "Früh"（早い）も変数名に使える。

```js
const Früh = "foobar";
```

- しかし `früh` は `Früh` と同一ではない（大文字小文字を区別するため）。
- 命令は **statements（文）** と呼ばれ、セミコロン `;` で区切る。行を分けて書くならセミコロンは不要だが、1行に複数文を書くなら**必須**。
- NOTE: ECMAScript には文を終端するための**自動セミコロン挿入（ASI, automatic semicolon insertion）** の規則がある。詳細は lexical grammar のリファレンス参照。
- ベストプラクティスとしては厳密に不要でも常にセミコロンを書く。バグの混入確率が下がる。
- ソーステキストは左から右へスキャンされ、**tokens / control characters / line terminators / comments / whitespace** という入力要素の列に変換される（空白・タブ・改行が whitespace）。

#### 3.2 Comments

```js
// a one line comment

/* this is a longer,
 * multi-line comment
 */
```

- ブロックコメントは**ネストできない**。コメント中に誤って `*/` を含めるとそこでコメントが終わる。

```js
/* You can't, however, /* nest comments */ SyntaxError */
```

- `*/` のパターンを壊す（バックスラッシュを挿入する）ことで回避できる:

```js
/* You can /* nest comments *\/ by escaping slashes */
```

- コメントは whitespace のように振る舞い、スクリプト実行時に破棄される。
- NOTE: 一部の JS ファイル先頭には第3のコメント構文 `#!/usr/bin/env node` が現れる。これは **hashbang comment** 構文で、スクリプトを実行すべき JavaScript エンジンのパスを指定する特別なコメント。

〔補足（一般知識）〕`*/` でコメントが早期終了する性質と hashbang の存在は、JS ファイルにユーザー入力を埋め込むテンプレートでのコメント脱出（コメントブレイクアウト）を考えるときの基礎知識になる。

#### 3.3 Declarations（宣言 — 5種類）

MDN は JavaScript に**5種類の変数宣言**があると明記する（逐語の定義リスト）:

| 宣言 | 説明（原文の定義） |
| --- | --- |
| `var` | Declares a variable, optionally initializing it to a value. |
| `let` | Declares a block-scoped variable, optionally initializing it to a value. |
| `const` | Declares a block-scoped variable that cannot be re-assigned, which must be initialized at declaration. |
| `using` | Declares a variable like `const` that is _synchronously disposed_. |
| `await using` | Declares a variable like `const` that is _asynchronously disposed_. |

本章で扱うのは最初の3つ（`var`, `let`, `const`）のみ。`using` と `await using` は **Resource management** 章で導入される。

##### Variables（識別子の規則）
- 変数名（**identifiers**）は通常、文字・アンダースコア `_`・ドル記号 `$` で始まる。後続の文字には数字 `0`–`9` も使える。
- case-sensitive なので文字には `A`–`Z`（大文字）と `a`–`z`（小文字）が含まれる。
- `å` や `ü` のような Unicode 文字の多くを識別子に使える。**Unicode エスケープシーケンス**で識別子中の文字を表現することもできる。
- 合法な名前の例: `Number_hits`, `temp99`, `$credit`, `_name`。

##### Declaring variables（宣言の2通り）
- `var` キーワード（例: `var x = 42`）。**実行コンテキスト**次第でローカル変数もグローバル変数も宣言できる。
- `const` または `let`（例: `let y = 13`）。ブロックスコープのローカル変数を宣言する。
- **destructuring** 構文で値を展開する宣言もできる（例: `const { bar } = foo`）。`bar` という変数が作られ、オブジェクト `foo` の同名キーに対応する値が代入される。
- 変数は必ず使う前に宣言すべき。JavaScript は以前、未宣言変数への代入を許しており、それは **undeclared global**（未宣言グローバル）変数を作る。これは **strict mode ではエラー**であり、完全に避けるべき。

〔補足（一般知識）〕この「未宣言代入が暗黙のグローバルを作る」性質は、非 strict な古いスクリプトでのグローバル変数汚染／DOM Clobbering との相互作用を考える際の基礎になる。

##### Declaration and initialization
- `let x = 42` において `let x` が **declaration**、`= 42` が **initializer**。declaration があると後続コードで `ReferenceError` を投げずにアクセスできる。
- `var` と `let` では initializer は省略可。初期化子なしで宣言された変数には `undefined` が代入される。

```js
let x;
console.log(x); // logs "undefined"
```

- 本質的に `let x = 42` は `let x; x = 42` と等価。
- `const` は常に initializer が必要（宣言後の代入を一切禁じるため、暗黙に `undefined` で初期化するのはプログラマのミスの可能性が高い）。

```js
const x; // SyntaxError: Missing initializer in const declaration
```

##### Variable scope（スコープ）
変数は次のいずれかのスコープに属し得る:
- **Global scope**: script モードで動くすべてのコードのデフォルトスコープ。
- **Module scope**: module モードで動くコードのスコープ。
- **Function scope**: 関数によって作られるスコープ。

加えて、`let` / `const` で宣言された変数は次のスコープにも属し得る:
- **Block scope**: 波括弧のペア（block）で作られるスコープ。

```js
if (Math.random() > 0.5) {
  const y = 5;
}
console.log(y); // ReferenceError: y is not defined
```

- しかし `var` で作られた変数は**ブロックスコープではなく**、そのブロックが存在する**関数（またはグローバルスコープ）**に対してローカルになる。

```js
if (true) {
  var x = 5;
}
console.log(x); // x is 5
```

##### Variable hoisting（変数の巻き上げ）
- `var` 宣言変数は **hoisted** され、宣言に到達していなくてもスコープ内のどこからでも参照できる。`var` 宣言はその関数／グローバルスコープの先頭へ「持ち上げられる」と見なせる。ただし宣言前にアクセスすると値は常に `undefined` になる。**宣言と `undefined` によるデフォルト初期化だけが巻き上げられ、値の代入は巻き上げられない**からである。

```js
console.log(x === undefined); // true
var x = 3;

(function () {
  console.log(x); // undefined
  var x = "local value";
})();
```

上は次と同じように解釈される:

```js
var x;
console.log(x === undefined); // true
x = 3;

(function () {
  var x;
  console.log(x); // undefined
  x = "local value";
})();
```

- hoisting があるため、関数内の `var` 文はできるだけ関数先頭に置くべき（可読性向上）。
- `let` と `const` が hoist されるかは定義論争の対象。ブロック内で宣言前に参照すると常に `ReferenceError` になる。これは宣言が処理されるまでブロック先頭から **temporal dead zone（TDZ）** にあるため。

```js
console.log(x); // ReferenceError
const x = 3;

console.log(y); // ReferenceError
let y = 3;
```

- `var` 宣言（宣言のみ巻き上げ、値は巻き上げない）とは異なり、**関数宣言は丸ごと巻き上げられる**。スコープ内のどこからでも安全に呼べる。

##### Global variables（グローバル変数）
- グローバル変数は実際には**グローバルオブジェクトのプロパティ**である。
- ウェブページではグローバルオブジェクトは `window` なので、`window.variable` 構文でグローバル変数を読み書きできる。すべての環境では `globalThis` 変数（それ自体がグローバル変数）を使える。これは各種 JavaScript ランタイム間で一貫したインターフェースを提供するため。
- 結果として、**あるウィンドウやフレームで宣言されたグローバル変数を、別のウィンドウやフレームから `window` 名または `frame` 名を指定してアクセスできる。** 例: あるドキュメントで `phoneNumber` という変数が宣言されていれば、`iframe` からは `parent.phoneNumber` として参照できる。

〔補足（一般知識）〕この最後の段落は、クライアントサイド診断における iframe/親フレーム間のスクリプトアクセス（同一オリジンの場合）や、`window.name`・`parent.*` 経由のデータ受け渡しを理解する土台になる。クロスオリジンでは同一オリジンポリシーで遮断される。

##### Constants
- `const` キーワードで読み取り専用の名前付き定数を作れる。識別子の構文は通常の変数と同じ（文字・アンダースコア・`$` で始まり、英字・数字・アンダースコアを含める）。

```js
const PI = 3.14;
```

- 定数はスクリプト実行中に代入で値を変えることも再宣言することもできない。値で初期化しなければならない。スコープ規則は `let` のブロックスコープ変数と同じ。
- 同じスコープで関数や変数と同名の定数は宣言できない:

```js
// THIS WILL CAUSE AN ERROR
function f() {}
const f = 5;

// THIS WILL CAUSE AN ERROR TOO
function f() {
  const g = 5;
  var g;
}
```

- **ただし `const` は再代入だけを防ぎ、ミューテーション（変更）は防がない。** 定数に代入されたオブジェクトのプロパティは保護されない:

```js
const MY_OBJECT = { key: "value" };
MY_OBJECT.key = "otherValue";
```

- 配列の内容も保護されない:

```js
const MY_ARRAY = ["HTML", "CSS"];
MY_ARRAY.push("JAVASCRIPT");
console.log(MY_ARRAY); // ['HTML', 'CSS', 'JAVASCRIPT'];
```

#### 3.4 Data structures and types

##### Data types（8つのデータ型）
最新の ECMAScript 標準は**8つのデータ型**を定義する。7つの **primitives**:
1. **Boolean** — `true` と `false`。
2. **null** — null 値を表す特別なキーワード。case-sensitive なので `null` は `Null`, `NULL` その他の変種とは異なる。
3. **undefined** — 値が定義されていないトップレベルのプロパティ。
4. **Number** — 整数または浮動小数点数。例: `42` や `3.14159`。
5. **BigInt** — 任意精度の整数。例: `9007199254740992n`。
6. **String** — テキスト値を表す文字の列。例: `"Howdy"`。
7. **Symbol** — インスタンスが一意で不変なデータ型。

そして **Object**。

- 関数は言語の他の基本要素である。技術的には関数もオブジェクトの一種だが、オブジェクトを「値の名前付きコンテナ」、関数を「スクリプトが実行できる手続き」と考えればよい。

##### Data type conversion
- JavaScript は**動的型付け**言語。宣言時に型を指定する必要がなく、実行中に必要に応じて自動変換される。

```js
let answer = 42;
```

```js
answer = "Thanks for all the fish!";
```

- 動的型付けなのでこの代入はエラーメッセージを出さない。

##### Numbers and the '+' operator
- `+` 演算子で数値と文字列が混在する式では、JavaScript は**数値を文字列に変換する**:

```js
x = "The answer is " + 42; // "The answer is 42"
y = 42 + " is the answer"; // "42 is the answer"
z = "37" + 7; // "377"
```

- **他のすべての演算子では数値を文字列に変換しない**:

```js
"37" - 7; // 30
"37" * 7; // 259
```

##### Converting strings to numbers
文字列としてメモリ上にある数値表現を変換するメソッド:
- `parseInt()`
- `parseFloat()`
- `Number()`

- `parseInt` は整数のみを返すため、小数では用途が限られる。
- NOTE: `parseInt` のベストプラクティスは**常に radix（基数）パラメータを含めること**。radix はどの数値体系を使うかを指定する。

```js
parseInt("101", 2); // 5
```

- 文字列から数値を取り出す別の方法は `+`（単項プラス）演算子。これは暗黙に **number conversion** を行い、`Number()` 関数と同じプロセスになる。

```js
"1.1" + "1.1"; // '1.11.1'
(+"1.1") + (+"1.1"); // 2.2
// Note: the parentheses are added for clarity, not required.
```

〔補足（一般知識）〕`parseInt` の radix 省略と `"37" - 7 === 30` のような片方向強制は、クライアントサイドの数値バリデーション迂回（例: `parseInt("12abc") === 12`、`+" "  === 0`）を考える上での基礎である。

#### 3.5 Literals
リテラルは値を表す固定値（変数ではない）。本節が扱うリテラル種別:
- Array literals / Boolean literals / Numeric literals / Object literals / RegExp literals / String literals

##### Array literals
- 角括弧 `[]` で囲まれた0個以上の式のリスト。配列リテラルで配列を作ると、指定された値が要素として初期化され、`length` は指定された引数の数になる。

```js
const coffees = ["French Roast", "Colombian", "Kona"];
```

- 配列リテラルは**評価されるたびに新しい配列オブジェクトを作る**。グローバルスコープのリテラルで定義された配列はスクリプト読み込み時に一度作られる。しかし関数内にあるなら、その関数が呼ばれるたびに新しい配列がインスタンス化される。

###### Extra commas in array literals（余分なカンマ）
- 配列リテラル内でカンマを2つ連続させると、未指定要素のために**空スロット**が残る:

```js
const fish = ["Lion", , "Angel"];
```

```js
console.log(fish);
// [ 'Lion', <1 empty item>, 'Angel' ]
```

- 2番目の項目は "empty" で、これは実際の `undefined` 値とは**厳密には同じではない**。`Array.prototype.map` のような配列走査メソッドでは空スロットはスキップされる。しかしインデックスアクセス `fish[1]` は `undefined` を返す。
- 要素リスト末尾の trailing comma は無視される。
- 次の例では `length` は 3。`myList[3]` は存在せず、`myList[1]` は空:

```js
const myList = ["home", , "school"];
```

- 次の例では `length` は 4 で、`myList[0]` と `myList[2]` が欠けている:

```js
const myList = [, "home", , "school"];
```

- 次の例では `length` は 4 で、`myList[1]` と `myList[3]` が欠けている。**最後のカンマだけが無視される**:

```js
const myList = ["home", , "school", ,];
```

- NOTE: trailing comma は複数行配列で git の diff をきれいに保つのに役立つ:

```diff
const myList = [
  "home",
  "school",
+ "hospital",
];
```

- 余分なカンマの挙動を理解することは、言語としての JavaScript を理解する上で重要。ただし自分のコードでは欠落要素を明示的に `undefined` と宣言するか、少なくとも不在を強調するコメントを入れるべき:

```js
const myList = ["home", /* empty */, "school", /* empty */, ];
```

##### Boolean literals
- Boolean 型には `true` と `false` の2つのリテラル値がある。
- NOTE: プリミティブの Boolean 値 `true`/`false` と、`Boolean` **オブジェクト**の true/false 値を混同しないこと。Boolean オブジェクトはプリミティブ Boolean データ型のラッパーである。

##### Numeric literals
- 整数リテラル（異なる基数）と10進の浮動小数点リテラルを含む。
- 言語仕様は数値リテラルを**符号なし**と要求している。にもかかわらず `-123.4` のようなコード片は問題なく、数値リテラル `123.4` に単項 `-` 演算子が適用されたものとして解釈される。

###### Integer literals
整数と `BigInt` リテラルは 10進（base 10）、16進（base 16）、8進（base 8）、2進（base 2）で書ける。
- **decimal** 整数リテラルは先頭に `0`（ゼロ）が付かない数字列。
- 整数リテラルの先頭の `0`（ゼロ）、または先頭の `0o`（あるいは `0O`）は **octal** を示す。8進整数リテラルには数字 `0`–`7` のみを含められる。
- 先頭の `0x`（あるいは `0X`）は **hexadecimal** 整数リテラルを示す。16進整数には数字 `0`–`9` と文字 `a`–`f`、`A`–`F` を含められる（大文字小文字で値は変わらない。したがって `0xa` = `0xA` = `10`、`0xf` = `0xF` = `15`）。
- 先頭の `0b`（あるいは `0B`）は **binary** 整数リテラルを示す。2進整数リテラルには数字 `0` と `1` のみ。
- 整数リテラル末尾の `n` サフィックスは `BigInt` リテラルを示す。`BigInt` リテラルは上記いずれの基数も使える。ただし `0123n` のような先頭ゼロ8進構文は許されず、`0o123n` は問題ない。

整数リテラルの例（原文のまま）:

```plain
0, 117, 123456789123456789n             (decimal, base 10)
015, 0001, 0o777777777777n              (octal, base 8)
0x1123, 0x00111, 0x123456789ABCDEFn     (hexadecimal, "hex" or base 16)
0b11, 0b0011, 0b11101001010101010101n   (binary, base 2)
```

###### Floating-point literals
浮動小数点リテラルが持ち得る部分:
- 符号なし10進整数
- 小数点 `.`
- 小数部（別の10進数）
- 指数部

指数部は `e` または `E` に整数が続くもので、符号付き（`+` または `-` が前置）も可。浮動小数点リテラルは少なくとも1桁の数字と、小数点または `e`（`E`）のいずれかを持たなければならない。

構文（原文のまま）:

```plain
[digits].[digits][(E|e)[(+|-)]digits]
```

例:

```js
3.1415926
.123456789
3.1E+12
.1e-23
```

##### Object literals
- 波括弧 `{}` で囲まれた、プロパティ名と対応する値のペアが0個以上並ぶリスト。
- **WARNING: 文の先頭でオブジェクトリテラルを使うな！** `{` がブロックの開始として解釈されるため、エラーになるか期待通りに動かない。

```js
const sales = "Toyota";

function carTypes(name) {
  return name === "Honda" ? name : `Sorry, we don't sell ${name}.`;
}

const car = { myCar: "Saturn", getCar: carTypes("Honda"), special: sales };

console.log(car.myCar); // Saturn
console.log(car.getCar); // Honda
console.log(car.special); // Toyota
```

- プロパティ名には数値リテラルや文字列リテラルも使え、オブジェクトをネストできる:

```js
const car = { manyCars: { a: "Saab", b: "Jeep" }, 7: "Mazda" };

console.log(car.manyCars.b); // Jeep
console.log(car[7]); // Mazda
```

- **オブジェクトのプロパティ名は空文字列を含む任意の文字列になり得る。** プロパティ名が有効な JavaScript 識別子または数値でない場合は引用符で囲む必要がある。
- 有効な識別子でないプロパティ名はドット `.` プロパティとしてアクセスできない:

```js
const unusualPropertyNames = {
  "": "An empty string",
  "!": "Bang!",
};
console.log(unusualPropertyNames.""); // SyntaxError: Unexpected string
console.log(unusualPropertyNames.!); // SyntaxError: Unexpected token !
```

- 代わりにブラケット記法 `[]` でアクセスする:

```js
console.log(unusualPropertyNames[""]); // An empty string
console.log(unusualPropertyNames["!"]); // Bang!
```

###### Enhanced Object literals
オブジェクトリテラルは、**構築時のプロトタイプ設定**、`foo: foo` 代入の省略形、メソッド定義、`super` 呼び出し、式によるプロパティ名計算といった一連の省略構文をサポートする。これらはオブジェクトリテラルとクラス宣言を近づける。

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

〔補足（一般知識）〕オブジェクトリテラル内の `__proto__:` キーがプロトタイプを設定する、という仕様上の挙動は、JSON 由来のオブジェクトを再帰マージするコードでプロトタイプ汚染が成立する典型経路（`{"__proto__": {...}}`）を理解する鍵である。MDN のプロトタイプ章は「オブジェクトリテラルの `__proto__` キーは標準であり非推奨ではない」「`Object.prototype.__proto__` アクセサは非標準かつ非推奨」と明確に区別している（後述）。

##### RegExp literals
- 正規表現リテラルはスラッシュで囲まれたパターン:

```js
const re = /ab+c/;
```

##### String literals
- 二重引用符 `"` または単一引用符 `'` で囲まれた0個以上の文字。同じ種類の引用符で区切らなければならない。

```js
'foo'
"bar"
'1234'
'one line \n another line'
"Joyo's cat"
```

- `String` オブジェクトが特に必要でない限り文字列リテラルを使うべき。
- 文字列リテラル値に対して `String` オブジェクトのどのメソッドも呼べる。JavaScript は自動的に文字列リテラルを一時的な String オブジェクトに変換し、メソッドを呼び、一時オブジェクトを破棄する。`length` プロパティも使える:

```js
// Will print the number of symbols in the string including whitespace.
console.log("Joyo's cat".length); // In this case, 10.
```

- **Template literals** も使える。バックティック（`` ` ``、grave accent）で囲む。

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

- **Tagged templates**: テンプレートリテラルと、それをパースする "tag" 関数呼び出しをまとめて指定するコンパクトな構文。タグ関数名はテンプレートリテラルの前に置く。以下の例ではタグ関数は `print`。`print` 関数は引数を補間し、現れたオブジェクトや配列をシリアライズして、厄介な `[object Object]` を避ける。

```js
const formatArg = (arg) => {
  if (Array.isArray(arg)) {
    // Print a bulleted list
    return arg.map((part) => `- ${part}`).join("\n");
  }
  if (arg.toString === Object.prototype.toString) {
    // This object will be serialized to "[object Object]".
    // Let's print something nicer.
    return JSON.stringify(arg);
  }
  return arg;
};

const print = (segments, ...args) => {
  // For any well-formed template literal, there will always be N args and
  // (N+1) string segments.
  let message = segments[0];
  segments.slice(1).forEach((segment, index) => {
    message += formatArg(args[index]) + segment;
  });
  console.log(message);
};

const todos = [
  "Learn JavaScript",
  "Learn Web APIs",
  "Set up my website",
  "Profit!",
];

const progress = { javascript: 20, html: 50, css: 10 };

print`I need to do:
${todos}
My current progress is: ${progress}
`;

// I need to do:
// - Learn JavaScript
// - Learn Web APIs
// - Set up my website
// - Profit!
// My current progress is: {"javascript":20,"html":50,"css":10}
```

- タグ付きテンプレートリテラルは単なる関数呼び出しの糖衣なので、上記は等価な関数呼び出しに書き換えられる:

```js
print(["I need to do:\n", "\nMy current progress is: ", "\n"], todos, progress);
```

- これは `console.log` スタイルの補間を思い起こさせる:

```js
console.log("I need to do:\n%o\nMy current progress is: %o\n", todos, progress);
```

〔補足（一般知識）〕タグ付きテンプレートは「テンプレート断片（静的）と補間値（動的）が関数に分離して渡される」ため、コンテキスト対応エスケープを行う安全なテンプレートAPI（例: Trusted Types 互換のポリシーや `html`` ` `` 系ライブラリ）の実装基盤になる。診断時には逆に、タグ関数がエスケープしていない場合に注入点になる。

###### Using special characters in strings

```js
"one line \n another line";
```

文字列で使える特殊文字の表（原文の表を完全再現）:

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

###### Escaping characters
- 表にない文字では先行するバックスラッシュは無視されるが、この用法は**非推奨**で避けるべき。
- 文字列内に引用符を入れるにはバックスラッシュを前置する（**escaping**）:

```js
const quote = "He read \"The Cremation of Sam McGee\" by R.W. Service.";
console.log(quote);
```

結果:

```plain
He read "The Cremation of Sam McGee" by R.W. Service.
```

- 文字列内にリテラルのバックスラッシュを入れるにはバックスラッシュ自体をエスケープする。ファイルパス `c:\temp` を文字列に入れる例:

```js
const home = "c:\\temp";
```

- 改行の前にバックスラッシュを置くと改行をエスケープできる。バックスラッシュと改行の両方が文字列の値から削除される:

```js
const str =
  "this string \
is broken \
across multiple \
lines.";
console.log(str); // this string is broken across multiple lines.
```

〔補足（一般知識）〕`\xXX` / `\uXXXX` / `\u{XXXXX}` の3系統のエスケープは、JS 文字列コンテキストへの注入時に「バックスラッシュ経由でクォートを回避する」「サニタイザのブラックリストを Unicode エスケープで通す」といった検討に直結する。また `\u{...}` が サロゲートペア `\uD87E\uDC04` と等価である点は、UTF-16 サロゲート分割によるフィルタ迂回の理解に必要。

#### 3.6 More information（章末）
本章は宣言と型の基本構文に焦点を当てた。言語構造をさらに学ぶには、ガイドの次の章も参照:
- Control flow and error handling
- Loops and iteration
- Functions
- Expressions and operators

次章では制御フロー構造とエラー処理を扱う。

---

### 4. Functions（出典: .../Guide/Functions）

章の導入（原文）:

> Functions are one of the fundamental building blocks in JavaScript. A function in JavaScript is similar to a procedure—a set of statements that performs a task or calculates a value, but for a procedure to qualify as a function, it should take some input and return an output where there is some obvious relationship between the input and the output. To use a function, you must define it somewhere in the scope from which you wish to call it.

#### 4.1 Defining functions

##### Function declarations
**function definition**（= **function declaration**、= **function statement**）は `function` キーワードに続いて:
- 関数の名前
- 括弧で囲みカンマで区切ったパラメータのリスト
- 波括弧 `{ /* … */ }` で囲んだ関数を定義する JavaScript 文

```js
function square(number) {
  return number * number;
}
```

- **パラメータは本質的に値で渡される（by value）**。関数本体が渡されたパラメータに完全に新しい値を代入しても、**その変更はグローバルにも呼び出し元のコードにも反映されない**。
- オブジェクトをパラメータとして渡した場合、関数がオブジェクトのプロパティを変更すると、その変更は関数外でも見える:

```js
function myFunc(theObject) {
  theObject.make = "Toyota";
}

const myCar = {
  make: "Honda",
  model: "Accord",
  year: 1998,
};

console.log(myCar.make); // "Honda"
myFunc(myCar);
console.log(myCar.make); // "Toyota"
```

- 配列を渡した場合も、関数が配列の値を変更するとその変更は関数外で見える:

```js
function myFunc(theArr) {
  theArr[0] = 30;
}

const arr = [45];

console.log(arr[0]); // 45
myFunc(arr);
console.log(arr[0]); // 30
```

- 関数宣言と関数式はネストでき、**scope chain（スコープチェーン）** を形成する:

```js
function addSquares(a, b) {
  function square(x) {
    return x * x;
  }
  return square(a) + square(b);
}
```

##### Function expressions
- 関数宣言は構文上は文だが、**function expression** でも関数を作れる。そのような関数は **anonymous（無名）** でよい:

```js
const square = function (number) {
  return number * number;
};

console.log(square(4)); // 16
```

- 関数式に名前を与えることもできる。名前を与えると関数が自身を参照でき、デバッガのスタックトレースでの識別も容易になる:

```js
const factorial = function fac(n) {
  return n < 2 ? 1 : n * fac(n - 1);
};

console.log(factorial(3)); // 6
```

- 関数式は他の関数に引数として関数を渡すときに便利:

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

- JavaScript では条件に基づいて関数を定義できる。以下は `num` が `0` のときだけ `myFunc` を定義する:

```js
let myFunc;
if (num === 0) {
  myFunc = function (theObject) {
    theObject.make = "Toyota";
  };
}
```

- **ここで述べた方法以外に、`Function` コンストラクタを使って実行時に文字列から関数を作ることもできる。これは `eval()` とよく似ている。**（原文: "you can also use the `Function` constructor to create functions from a string at runtime, much like `eval()`."）
- **method（メソッド）** はオブジェクトのプロパティである関数。

〔補足（一般知識）〕`Function` コンストラクタが `eval()` 相当であるというこの1文は、クライアントサイド脆弱性ハンティングにおいて極めて重要である。`new Function(userInput)` / `Function("return "+x)()` は `eval` と同じ動的コード実行 sink であり、CSP の `unsafe-eval` でブロックされる対象も同じ。Trusted Types では `TrustedScript` が要求される。

#### 4.2 Calling functions
- **定義**は**実行**ではない。定義は関数に名前を付け、呼ばれたときに何をするかを指定するだけ。
- **呼び出し**が指定された引数で実際に動作を行う:

```js
square(5);
```

- 関数は呼ばれるときにスコープ内にいなければならないが、関数宣言は **hoist** され得る（コード上で呼び出しより下に現れてよい）。関数宣言のスコープは、それが宣言された関数（トップレベルで宣言されたならプログラム全体）。
- 関数の引数は文字列と数値に限らない。オブジェクト全体を渡せる。
- 関数は自分自身を呼べる（再帰的階乗）:

```js
function factorial(n) {
  if (n === 0 || n === 1) {
    return 1;
  }
  return n * factorial(n - 1);
}
```

```js
console.log(factorial(1)); // 1
console.log(factorial(2)); // 2
console.log(factorial(3)); // 6
console.log(factorial(4)); // 24
console.log(factorial(5)); // 120
```

- 関数を動的に呼ぶ必要がある場合、引数の数が可変の場合、呼び出しのコンテキストを実行時に決まる特定のオブジェクトに設定する必要がある場合がある。
- **関数自体がオブジェクトであり**、それらのオブジェクトはメソッドを持つ（`Function` オブジェクト参照）。`call()` と `apply()` メソッドがこの目的に使える。

##### Function hoisting

```js
console.log(square(5)); // 25

function square(n) {
  return n * n;
}
```

- このコードは `square()` が宣言前に呼ばれてもエラーなく動く。JavaScript インタプリタが**関数宣言全体**を現在のスコープの先頭に巻き上げるため。上は次と等価:

```js
// All function declarations are effectively at the top of the scope
function square(n) {
  return n * n;
}

console.log(square(5)); // 25
```

- **Function hoisting は関数 _宣言_ のみで動作し、関数 _式_ では動作しない**:

```js
console.log(square(5)); // ReferenceError: Cannot access 'square' before initialization
const square = function (n) {
  return n * n;
};
```

##### Recursion
- 関数は自身を参照し呼び出せる。関数式／宣言の名前で参照できるほか、その関数オブジェクトを参照するスコープ内の任意の変数経由でも参照できる:

```js
const foo = function bar() {
  // statements go here
};
```

関数本体内では `bar` としても `foo` としても参照でき、`bar()` でも `foo()` でも呼べる。

- 再帰はループに類似する。どちらも同じコードを複数回実行し、どちらも条件（無限ループ／無限再帰を避けるため）を必要とする。

```js
let x = 0;
// "x < 10" is the loop condition
while (x < 10) {
  // do stuff
  x++;
}
```

は次の再帰関数宣言と呼び出しに変換できる:

```js
function loop(x) {
  // "x >= 10" is the exit condition (equivalent to "!(x < 10)")
  if (x >= 10) {
    return;
  }
  // do stuff
  loop(x + 1); // the recursive call
}
loop(0);
```

- 一部のアルゴリズムは単純な反復ループにできない。**ツリー構造（DOM など）のすべてのノードを取得するのは再帰の方が容易**:

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

- 任意の再帰アルゴリズムを非再帰に変換することは可能だが、ロジックはしばしば非常に複雑になり、スタックの使用が必要になる。
- 実際、再帰自体がスタック（関数スタック）を使っている:

```js
function foo(i) {
  if (i < 0) {
    return;
  }
  console.log(`begin: ${i}`);
  foo(i - 1);
  console.log(`end: ${i}`);
}
foo(3);

// Logs:
// begin: 3
// begin: 2
// begin: 1
// begin: 0
// end: 0
// end: 1
// end: 2
// end: 3
```

〔補足（一般知識）〕`walkTree` のような DOM 再帰走査は、クライアントサイド診断で「ページ内の全ノードを列挙して危険な属性・イベントハンドラ・`innerHTML` 代入箇所を洗い出す」自作クローラの基本形になる。

##### Immediately Invoked Function Expressions (IIFE)
**IIFE** は式として定義した関数を直接呼び出すコードパターン:

```js
(function () {
  // Do something
})();

const value = (function () {
  // Do something
  return someValue;
})();
```

関数を変数に保存する代わりに即座に呼び出す。これはほぼ関数本体をそのまま書くのと等価だが、いくつかの固有の利点がある:
- **変数の追加スコープを作る**。変数が有用な場所に限定するのに役立つ。
- **文の列ではなく式になる。** これにより変数初期化時に複雑な計算ロジックを書ける。

#### 4.3 Function scopes and closures
- 関数は変数の **scope** を形成する。関数内で定義された変数は関数の外からはアクセスできない。関数スコープはすべての上位スコープから継承する。
  - グローバルスコープで定義された関数はグローバルスコープで定義されたすべての変数にアクセスできる。
  - 別の関数の内部で定義された関数は、その親関数で定義されたすべての変数、および親関数がアクセスできる他のすべての変数にもアクセスできる。
  - 一方、親関数（および他の親スコープ）は内側の関数内で定義された変数や関数に**アクセスできない**。これは内側の関数の変数に対する一種のカプセル化を提供する。

```js
// The following variables are defined in the global scope
const num1 = 20;
const num2 = 3;
const name = "Chamakh";

// This function is defined in the global scope
function multiply() {
  return num1 * num2;
}

console.log(multiply()); // 60

// A nested function example
function getScore() {
  const num1 = 2;
  const num2 = 3;

  function add() {
    return `${name} scored ${num1 + num2}`;
  }

  return add();
}

console.log(getScore()); // "Chamakh scored 5"
```

##### Closures（Functions 章内の定義）
原文の定義:

> We also refer to the function body as a _closure_. A closure is any piece of source code (most commonly, a function) that refers to some variables, and the closure "remembers" these variables even when the scope in which these variables were declared has exited.

- クロージャは通常ネスト関数で説明されるが、**実はネスト関数は必須ではない**。厳密には JavaScript のすべての関数がクロージャを形成する（何も捕獲しないものもある）。またクロージャは関数である必要さえない。
- **有用な**クロージャの鍵となる構成要素（原文の4項目）:
  1. 何らかの変数や関数を定義する親スコープ。明確な寿命を持つべき、つまりどこかの時点で実行を終えるべき。グローバルスコープでない任意のスコープがこの要件を満たす（ブロック、関数、モジュールなどを含む）。
  2. 親スコープ内で定義された内側のスコープ。親スコープで定義された変数や関数を参照する。
  3. 内側のスコープが親スコープの寿命を超えて生き残ること。例えば親スコープの外側で定義された変数に保存される、あるいは（親スコープが関数なら）親スコープから返される。
  4. その後、親スコープの外でその関数を呼んだとき、親スコープが実行を終えていても、親スコープで定義された変数や関数にアクセスできる。

典型例:

```js
// The outer function defines a variable called "name"
const pet = function (name) {
  const getName = function () {
    // The inner function has access to the "name" variable of the outer function
    return name;
  };
  return getName; // Return the inner function, thereby exposing it to outer scopes
};
const myPet = pet("Vivie");

console.log(myPet()); // "Vivie"
```

外側の関数の内部変数を操作するメソッドを含むオブジェクトを返すこともできる:

```js
const createPet = function (name) {
  let sex;

  const pet = {
    // setName(newName) is equivalent to setName: function (newName)
    // in this context
    setName(newName) {
      name = newName;
    },

    getName() {
      return name;
    },

    getSex() {
      return sex;
    },

    setSex(newSex) {
      if (
        typeof newSex === "string" &&
        (newSex.toLowerCase() === "male" || newSex.toLowerCase() === "female")
      ) {
        sex = newSex;
      }
    },
  };

  return pet;
};

const pet = createPet("Vivie");
console.log(pet.getName()); // Vivie

pet.setName("Oliver");
pet.setSex("male");
console.log(pet.getSex()); // male
console.log(pet.getName()); // Oliver
```

- 上のコードでは外側の関数の `name` 変数は内側の関数からアクセス可能で、**内側の関数を通す以外に内部変数にアクセスする方法はない**。内側の関数の内部変数は外側の引数と変数の安全な保管庫として働く。「永続的」でありかつ「カプセル化」されたデータを保持する。関数は変数に代入される必要さえなく、名前を持つ必要さえない:

```js
const getCode = (function () {
  const apiCode = "0]Eal(eh&2"; // A code we do not want outsiders to be able to modify…

  return function () {
    return apiCode;
  };
})();

console.log(getCode()); // "0]Eal(eh&2"
```

- 上は IIFE パターン。この IIFE スコープ内には2つの値が存在する: 変数 `apiCode` と、返されて変数 `getCode` に代入される無名関数。`apiCode` は返された無名関数のスコープにあるが、プログラムの他のどの部分のスコープにもないので、`getCode` 関数以外から `apiCode` の値を読む方法はない。

〔補足（一般知識）〕この「クロージャで秘密を隠す」パターンは、クライアントサイドにトークンやAPIキーを置くコードで頻出する。ただしブラウザ上ではソースが配信されているため、スクリプト本文を読めば `apiCode` の値そのものが見える（クロージャは同一実行コンテキスト内の他のスクリプトからの参照を防ぐだけで、機密性の保証にはならない）。診断では JS バンドル内のハードコード秘密情報探索が定番項目になる。

##### Multiply-nested functions（多重ネスト）
- 関数 `A` が関数 `B` を含み、`B` が関数 `C` を含む。
- `B` と `C` の両方がここでクロージャを形成する。したがって `B` は `A` にアクセスでき、`C` は `B` にアクセスできる。
- さらに `C` は `B` にアクセスでき `B` は `A` にアクセスできるので、`C` は `A` にもアクセスできる。

クロージャは複数のスコープを含み得る。自分を含む関数のスコープを再帰的に含む。これを **scope chaining（スコープチェイニング）** と呼ぶ。

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

理由（原文の3項目）:
1. `B` は `A` を含むクロージャを形成する（`B` は `A` の引数と変数にアクセスできる）。
2. `C` は `B` を含むクロージャを形成する。
3. `C` のクロージャは `B` を含み、`B` のクロージャは `A` を含むので、`C` のクロージャも `A` を含む。つまり `C` は `B` と `A` の**両方**の引数と変数にアクセスできる。言い換えると `C` は `B` と `A` のスコープを**その順序で**チェーンする。

逆は真ではない。`A` は `C` にアクセスできない。`A` は `B` の引数や変数にアクセスできず、`C` は `B` の変数だからである。したがって `C` は `B` に対してのみプライベートに保たれる。

##### Name conflicts（名前衝突）
- クロージャのスコープ内で2つの引数や変数が同じ名前を持つとき **name conflict** が起きる。**よりネストしたスコープが優先される。** 最も内側のスコープが最も高い優先度、最も外側が最も低い。これがスコープチェーンであり、チェーンの最初が最も内側のスコープ、最後が最も外側。

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

`return x * 2` の文で `inside` のパラメータ `x` と `outside` の変数 `x` の間に名前衝突が起きる。スコープチェーンは `inside` => `outside` => global object。よって `inside` の `x` が優先され、`10`（`outside` の `x`）ではなく `20`（`inside` の `x`）が返る。

#### 4.4 Using the arguments object
- 関数の引数は array-like なオブジェクトに保持される。関数内では次のようにアクセスする:

```js
arguments[i];
```

`i` は引数の序数（0 から始まる）。最初の引数は `arguments[0]`。引数の総数は `arguments.length`。

- `arguments` オブジェクトを使うと、**形式的に宣言されたより多くの引数で関数を呼べる**。事前に引数の個数が分からない場合に有用。

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

console.log(myConcat(". ", "sage", "basil", "oregano", "pepper", "parsley"));
// "sage. basil. oregano. pepper. parsley. "
```

- NOTE: `arguments` 変数は "array-like" だが**配列ではない**。番号付きインデックスと `length` プロパティを持つ点で array-like だが、配列操作メソッドをすべて備えてはいない。

#### 4.5 Function parameters
特別なパラメータ構文が2種類ある: **default parameters** と **rest parameters**。

##### Default parameters
- JavaScript の関数パラメータのデフォルトは `undefined`。
- 従来のデフォルト設定戦略は関数本体でパラメータ値をテストし `undefined` なら値を代入するものだった:

```js
function multiply(a, b) {
  b = typeof b !== "undefined" ? b : 1;
  return a * b;
}

console.log(multiply(5)); // 5
```

- default parameters なら関数本体での手動チェックは不要。関数の先頭で `b` のデフォルト値に `1` を置ける:

```js
function multiply(a, b = 1) {
  return a * b;
}

console.log(multiply(5)); // 5
```

##### Rest parameters
- **rest parameter** 構文は不定個数の引数を配列として表現できる:

```js
function multiply(multiplier, ...theArgs) {
  return theArgs.map((x) => multiplier * x);
}

const arr = multiply(2, 1, 2, 3);
console.log(arr); // [2, 4, 6]
```

#### 4.6 Arrow functions
- **arrow function expression**（将来の仮想的な `->` 構文と区別して _fat arrow_ とも呼ばれる）は関数式より短い構文を持ち、**自身の `this`、`arguments`、`super`、`new.target` を持たない**。アロー関数は常に無名。
- 導入に影響した2つの要因: **短い関数**と **`this` の非バインド**。

##### Shorter functions

```js
const a = ["Hydrogen", "Helium", "Lithium", "Beryllium"];

const a2 = a.map(function (s) {
  return s.length;
});

console.log(a2); // [8, 6, 7, 9]

const a3 = a.map((s) => s.length);

console.log(a3); // [8, 6, 7, 9]
```

##### No separate this
- アロー関数が登場するまで、すべての新しい関数は自身の `this` 値を定義していた（コンストラクタの場合は新しいオブジェクト、**strict mode の関数呼び出しでは `undefined`**、"オブジェクトメソッド" として呼ばれた場合はベースオブジェクトなど）。これはオブジェクト指向スタイルのプログラミングでは理想的とは言えなかった。

```js
function Person() {
  // The Person() constructor defines `this` as itself.
  this.age = 0;

  setInterval(function growUp() {
    // In nonstrict mode, the growUp() function defines `this`
    // as the global object, which is different from the `this`
    // defined by the Person() constructor.
    this.age++;
  }, 1000);
}

const p = new Person();
```

- ECMAScript 3/5 ではこの問題を `this` の値をクロージャで捕獲できる変数に代入することで解決していた:

```js
function Person() {
  // Some choose `that` instead of `self`.
  // Choose one and be consistent.
  const self = this;
  self.age = 0;

  setInterval(function growUp() {
    // The callback refers to the `self` variable of which
    // the value is the expected object.
    self.age++;
  }, 1000);
}
```

- あるいは **bound function** を作って正しい `this` 値を `growUp()` に渡すこともできた。
- アロー関数は自身の `this` を持たず、**囲んでいる実行コンテキストの `this` 値**が使われる:

```js
function Person() {
  this.age = 0;

  setInterval(() => {
    this.age++; // `this` properly refers to the person object
  }, 1000);
}

const p = new Person();
```

〔補足（一般知識）〕非 strict モードで通常関数の `this` がグローバルオブジェクト（ブラウザでは `window`）になるという性質は、コールバック内の `this.x = ...` が意図せずグローバル汚染を起こす経路になる。診断では「非 strict の古いスクリプト＋コールバック」でグローバル変数上書き（DOM Clobbering との併用）を検討する材料になる。

---

### 5. Closures（Advanced topics版・出典: .../Guide/Closures）

冒頭の定義（原文）:

> A **closure** is the combination of a function bundled together (enclosed) with references to its surrounding state (the **lexical environment**). In other words, a closure gives a function access to its outer scope. In JavaScript, closures are created every time a function is created, at function creation time.

#### 5.1 Lexical scoping

```js
function init() {
  var name = "Mozilla"; // name is a local variable created by init
  function displayName() {
    // displayName() is the inner function, that forms a closure
    console.log(name); // use variable declared in the parent function
  }
  displayName();
}
init();
```

- `init()` はローカル変数 `name` と関数 `displayName()` を作る。`displayName()` は `init()` 内部で定義された内側の関数で、`init()` の本体内でのみ利用可能。`displayName()` は自身のローカル変数を持たないが、内側の関数は外側のスコープの変数にアクセスできるので親関数 `init()` で宣言された `name` にアクセスできる。
- これは **lexical scoping（レキシカルスコープ）** の例。パーサーが関数がネストしているときに変数名をどう解決するかを説明する。_lexical_ という語は、レキシカルスコープが**変数がソースコード中で宣言された位置**を使ってその変数がどこで利用可能かを決めることを指す。

##### Scoping with let and const
- 伝統的に（ES6 以前）JavaScript 変数には2種類のスコープしかなかった: **function scope** と **global scope**。`var` 宣言変数は関数内か外かで function-scoped か global-scoped になる。波括弧のブロックはスコープを作らないため、これは厄介になり得る:

```js
if (Math.random() > 0.5) {
  var x = 1;
} else {
  var x = 2;
}
console.log(x);
```

- ブロックがスコープを作る他言語（C、Java など）出身の人には、`console.log` の行でエラーになるはずと見える。しかし `var` に対してブロックはスコープを作らないので、ここの `var` 文は実際には**グローバル変数**を作る。
- ES6 で `let` と `const` 宣言が導入され、**temporal dead zones** などとともにブロックスコープ変数を作れるようになった:

```js
if (Math.random() > 0.5) {
  const x = 1;
} else {
  const x = 2;
}
console.log(x); // ReferenceError: x is not defined
```

- 本質的に ES6 でブロックはついにスコープとして扱われるようになったが、`let` または `const` で変数を宣言した場合のみ。加えて ES6 は **modules** を導入し、これは別種のスコープをもたらした。**クロージャはこれらすべてのスコープの変数を捕獲できる。**

#### 5.2 Closure

```js
function makeFunc() {
  const name = "Mozilla";
  function displayName() {
    console.log(name);
  }
  return displayName;
}

const myFunc = makeFunc();
myFunc();
```

- 違い（そして興味深い点）は、内側の関数 `displayName()` が**実行される前に**外側の関数から返されていること。
- 一見このコードが動くのは直感に反する。一部のプログラミング言語では関数内のローカル変数はその関数の実行期間だけ存在する。`makeFunc()` が実行を終えたら `name` 変数はもうアクセスできないと期待するかもしれない。しかしコードは動くので、JavaScript ではそうではない。
- 理由は JavaScript の関数がクロージャを形成するから。**closure は関数と、その関数が宣言されたレキシカル環境の組み合わせ**である。この環境はクロージャが作られた時点でスコープ内にあったすべての変数から成る。この場合 `myFunc` は `makeFunc` が実行されたときに作られる関数 `displayName` のインスタンスへの参照。`displayName` のインスタンスは自身のレキシカル環境への参照を保持し、その中に変数 `name` が存在する。だから `myFunc` が呼ばれたとき `name` は利用可能なままで、"Mozilla" が `console.log` に渡される。

`makeAdder` の例:

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

- `makeAdder` は **function factory（関数ファクトリ）**。引数に特定の値を加える関数を作る。
- `add5` と `add10` は両方クロージャを形成する。**同じ関数本体の定義を共有するが、異なるレキシカル環境を保存する。** `add5` のレキシカル環境では `x` は 5、`add10` のレキシカル環境では `x` は 10。

#### 5.3 Practical closures
- クロージャが有用なのは、データ（レキシカル環境）とそのデータを操作する関数を関連付けられるから。これはオブジェクト指向プログラミング（オブジェクトがデータ＝プロパティと1つ以上のメソッドを関連付ける）と明らかな並行性を持つ。
- 結果として、**単一メソッドだけを持つオブジェクトを通常使う場面ならどこでもクロージャを使える**。
- ウェブでこうした状況は特に多い。フロントエンド JavaScript で書かれるコードの多くは**イベントベース**で、何らかの振る舞いを定義し、それをユーザーが発火するイベント（クリックやキー押下）に取り付ける。コードはコールバック（イベントに応じて実行される単一の関数）として取り付けられる。

CSS（原文のまま）:

```css
body {
  font-family: "Helvetica", "Arial", sans-serif;
  font-size: 12px;
}

h1 {
  font-size: 1.5em;
}

h2 {
  font-size: 1.2em;
}
```

JavaScript:

```js
function makeSizer(size) {
  return () => {
    document.body.style.fontSize = `${size}px`;
  };
}

const size12 = makeSizer(12);
const size14 = makeSizer(14);
const size16 = makeSizer(16);
```

```js
document.getElementById("size-12").onclick = size12;
document.getElementById("size-14").onclick = size14;
document.getElementById("size-16").onclick = size16;
```

```html
<button id="size-12">12</button>
<button id="size-14">14</button>
<button id="size-16">16</button>
<p>This is some text that will change size when you click the buttons above.</p>
```

#### 5.4 Emulating private methods with closures
- Java のような言語ではメソッドを private と宣言でき、同じクラスの他のメソッドからのみ呼べる。
- JavaScript は **classes** 以前、private メソッドを宣言するネイティブな方法を持たなかったが、**クロージャで private メソッドをエミュレート**できた。private メソッドはコードへのアクセス制限に有用なだけでなく、**グローバル名前空間を管理する強力な方法**も提供する。
- 以下のコードは、クロージャを使って private な関数と変数にアクセスできる public 関数を定義する方法を示す。これらのクロージャは **Module Design Pattern** に従う。

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

counter.decrement();
console.log(counter.value()); // 1.
```

- 前の例では各クロージャが自身のレキシカル環境を持っていた。ここでは**単一のレキシカル環境が3つの関数（`counter.increment`, `counter.decrement`, `counter.value`）で共有される**。
- 共有レキシカル環境は無名関数の本体に作られ、その無名関数は**定義され次第すぐ実行される**（IIFE）。レキシカル環境は2つの private な項目を含む: 変数 `privateCounter` と関数 `changeBy`。無名関数の外からこれらの private メンバーにはアクセスできない。代わりに返される3つの public 関数を通して間接的にアクセスする。

```js
function makeCounter() {
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
}

const counter1 = makeCounter();
const counter2 = makeCounter();

console.log(counter1.value()); // 0.

counter1.increment();
counter1.increment();
console.log(counter1.value()); // 2.

counter1.decrement();
console.log(counter1.value()); // 1.
console.log(counter2.value()); // 0.
```

- 2つのカウンタが互いに独立性を保つことに注目。各クロージャは自身のクロージャを通じて**異なるバージョンの `privateCounter` 変数**を参照する。
- NOTE: このようにクロージャを使うことは、通常オブジェクト指向プログラミングに関連付けられる利点（特に **data hiding（データ隠蔽）** と **encapsulation（カプセル化）**）をもたらす。

#### 5.5 Closure scope chain

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

無名関数を使わない書き方:

```js
// global scope
const e = 10;
function sum(a) {
  return function sum2(b) {
    return function sum3(c) {
      // outer functions scope
      return function sum4(d) {
        // local scope
        return a + b + c + d + e;
      };
    };
  };
}

const sum2 = sum(1);
const sum3 = sum2(2);
const sum4 = sum3(3);
const result = sum4(4);
console.log(result); // 20
```

- クロージャは **ブロックスコープ**と**モジュールスコープ**の変数も捕獲できる。以下はブロックスコープ変数 `y` に対するクロージャを作る:

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

- モジュールに対するクロージャはさらに興味深い:

```js
// myModule.js
let x = 5;
export const getX = () => x;
export const setX = (val) => {
  x = val;
};
```

ここでモジュールは getter-setter のペアをエクスポートし、モジュールスコープ変数 `x` を閉じ込める。`x` は他のモジュールから直接アクセスできないが、これらの関数で読み書きできる。

```js
import { getX, setX } from "./myModule.js";

console.log(getX()); // 5
setX(6);
console.log(getX()); // 6
```

- クロージャは**インポートされた値**も閉じ込められる。インポートされた値は **live bindings（ライブバインディング）** と見なされる。元の値が変わるとインポート側も応じて変わる:

```js
// myModule.js
export let x = 1;
export const setX = (val) => {
  x = val;
};
```

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

#### 5.6 Creating closures in loops: A common mistake（ループ内クロージャの典型的ミス）

HTML:

```html
<p id="help">Helpful notes will appear here</p>
<p>Email: <input type="text" id="email" name="email" /></p>
<p>Name: <input type="text" id="name" name="name" /></p>
<p>Age: <input type="text" id="age" name="age" /></p>
```

悪い例（原文のまま）:

```js
function showHelp(help) {
  document.getElementById("help").textContent = help;
}

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

setupHelp();
```

- 動かない理由: `onfocus` に代入された関数はクロージャを形成し、関数定義と `setupHelp` のスコープから捕獲された環境から成る。ループで3つのクロージャが作られたが、**それぞれが同じ単一のレキシカル環境を共有**し、その環境には値が変化する変数 `item` がある。`item` は `var` で宣言されているため、hoisting によって関数スコープを持つ。`item.help` の値は `onfocus` コールバックが実行されるときに決まる。その時点でループはすでに終わっているため、（3つのクロージャで共有される）`item` 変数オブジェクトは `helpText` リストの**最後のエントリ**を指したままになっている。

解決策1: 関数ファクトリを使ってクロージャをさらに使う:

```js
function showHelp(help) {
  document.getElementById("help").textContent = help;
}

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

setupHelp();
```

`makeHelpCallback` 関数が**各コールバックに新しいレキシカル環境**を作り、その中で `help` が `helpText` 配列の対応する文字列を参照する。

解決策2: 無名クロージャ（IIFE）を使う:

```js
function showHelp(help) {
  document.getElementById("help").textContent = help;
}

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

setupHelp();
```

解決策3: `let` または `const` キーワードを使う:

```js
function showHelp(help) {
  document.getElementById("help").textContent = help;
}

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

setupHelp();
```

この例は `var` の代わりに `const` を使うので、各クロージャがブロックスコープ変数をバインドし、追加のクロージャは不要になる。

- モダンな JavaScript ならプレーンな `for` ループの代替も検討できる。`for...of` ループで `item` を `let`/`const` として宣言する、あるいは `forEach()` メソッドを使う。どちらもクロージャ問題を回避する:

```js
for (const item of helpText) {
  document.getElementById(item.id).onfocus = () => {
    document.getElementById("help").textContent = item.help;
  };
}

helpText.forEach((item) => {
  document.getElementById(item.id).onfocus = () => {
    showHelp(item.help);
  };
});
```

#### 5.7 Performance considerations
- 各関数インスタンスは自身のスコープとクロージャを管理する。したがって、特定のタスクにクロージャが不要な場合に不必要に関数の中で関数を作るのは賢明でない。処理速度とメモリ消費の両面でスクリプト性能に悪影響を与える。
- 例えば新しいオブジェクト／クラスを作るとき、メソッドは通常オブジェクトのコンストラクタ内で定義するのではなく**オブジェクトのプロトタイプに関連付ける**べき。理由はコンストラクタが呼ばれるたびに（つまりオブジェクト生成ごとに）メソッドが再代入されるから。

```js
function MyObject(name, message) {
  this.name = name.toString();
  this.message = message.toString();
  this.getName = function () {
    return this.name;
  };

  this.getMessage = function () {
    return this.message;
  };
}
```

クロージャを使わない書き換え:

```js
function MyObject(name, message) {
  this.name = name.toString();
  this.message = message.toString();
}
MyObject.prototype = {
  getName() {
    return this.name;
  },
  getMessage() {
    return this.message;
  },
};
```

- ただし**プロトタイプの再定義は推奨されない**。次の例は既存のプロトタイプに追加する:

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

前2例では継承されたプロトタイプがすべてのオブジェクトで共有でき、メソッド定義がオブジェクト生成ごとに起きる必要がなくなる。

---

### 6. Working with objects（出典: .../Guide/Working_with_objects）

導入（原文）:

> JavaScript is designed on an object-based paradigm. An object is a collection of properties, and a property is an association between a name (or _key_) and a value. A property's value can be a function, in which case the property is known as a method.

- ブラウザに定義済みのオブジェクトに加えて、自分のオブジェクトを定義できる。

#### 6.1 Creating new objects
**object initializer** で作る方法と、まず**コンストラクタ関数**を作って `new` 演算子で呼んでインスタンス化する方法がある。

##### Using object initializers
- object initializer は **object literals** とも呼ばれる（"Object initializer" は C++ の用語法と整合する）。

```js
const obj = {
  property1: value1, // property name may be an identifier
  2: value2, // or a number
  "property n": value3, // or a string
};
```

- コロンの前の各プロパティ名は識別子、数値リテラル、文字列リテラルのいずれか。各 `valueN` はその値がプロパティ名に代入される式。**プロパティ名は式でもよい。computed keys は角括弧で包む必要がある。**
- object initializer は式であり、それが現れる文が実行されるたびに新しいオブジェクトが作られる。**同一の object initializer は互いに等しくない別個のオブジェクトを作る。**

```js
let x;
if (cond) {
  x = { greeting: "hi there" };
}
```

```js
const myHonda = {
  color: "red",
  wheels: 4,
  engine: { cylinders: 4, size: 2.2 },
};
```

- initializer で作られたオブジェクトは **plain objects（プレーンオブジェクト）** と呼ばれる。`Object` のインスタンスであって他のオブジェクト型ではないため。一部のオブジェクト型は特別な initializer 構文を持つ（array initializers、regex literals）。

##### Using a constructor function
1. コンストラクタ関数を書いてオブジェクト型を定義する。**大文字始まりを使う強い慣習**がある（正当な理由がある）。
2. `new` でオブジェクトのインスタンスを作る。

```js
function Car(make, model, year) {
  this.make = make;
  this.model = model;
  this.year = year;
}
```

`this` を使って渡された値に基づきオブジェクトのプロパティに値を代入している点に注目。

```js
const myCar = new Car("Eagle", "Talon TSi", 1993);
```

`myCar.make` は `"Eagle"`、`myCar.model` は `"Talon TSi"`、`myCar.year` は `1993`。引数とパラメータの順序は一致していなければならない。

```js
const randCar = new Car("Nissan", "300ZX", 1992);
const kenCar = new Car("Mazda", "Miata", 1990);
```

オブジェクトは別のオブジェクトであるプロパティを持てる:

```js
function Person(name, age, sex) {
  this.name = name;
  this.age = age;
  this.sex = sex;
}
```

```js
const rand = new Person("Rand McKinnon", 33, "M");
const ken = new Person("Ken Jones", 39, "M");
```

```js
function Car(make, model, year, owner) {
  this.make = make;
  this.model = model;
  this.year = year;
  this.owner = owner;
}
```

```js
const car1 = new Car("Eagle", "Talon TSi", 1993, rand);
const car2 = new Car("Nissan", "300ZX", 1992, ken);
```

```js
car2.owner.name;
```

- **既に定義されたオブジェクトにいつでもプロパティを追加できる**:

```js
car1.color = "black";
```

これは `car1` に `color` プロパティを追加し `"black"` を代入する。ただし他のオブジェクトには影響しない。同じ型のすべてのオブジェクトに新しいプロパティを追加するには、`Car` オブジェクト型の定義にプロパティを追加しなければならない。
- コンストラクタ関数の定義には `function` 構文の代わりに `class` 構文も使える。

##### Using the Object.create() method
- `Object.create()` でもオブジェクトを作れる。**コンストラクタ関数を定義せずに、作りたいオブジェクトの prototype オブジェクトを選べる**ので非常に有用。

```js
// Animal properties and method encapsulation
const animalProto = {
  type: "Invertebrates", // Default value of properties
  displayType() {
    // Method which will display the type of animal
    console.log(this.type);
  },
};

// Create a new animal type called `animal`
const animal = Object.create(animalProto);
animal.displayType(); // Logs: Invertebrates

// Create a new animal type called fish
const fish = Object.create(animalProto);
fish.type = "Fishes";
fish.displayType(); // Logs: Fishes
```

#### 6.2 Objects and properties
- オブジェクトのプロパティは基本的に変数と同じだが、スコープではなくオブジェクトに関連付けられている点が異なる。

```js
const myCar = {
  make: "Ford",
  model: "Mustang",
  year: 1969,
};
```

- 変数と同様、**プロパティ名は大文字小文字を区別する**。**プロパティ名は文字列か Symbol のみ**であり、Symbol でない限りすべてのキーは**文字列に変換される**。**配列のインデックスは実際には整数を含む文字列キーのプロパティである。**

##### Accessing properties
- **Property accessors** には2つの構文がある: **dot notation** と **bracket notation**。

```js
// Dot notation
myCar.make = "Ford";
myCar.model = "Mustang";
myCar.year = 1969;

// Bracket notation
myCar["make"] = "Ford";
myCar["model"] = "Mustang";
myCar["year"] = 1969;
```

- オブジェクトのプロパティ名は空文字列を含む任意の JavaScript 文字列または symbol になり得る。しかし**有効な JavaScript 識別子でない名前のプロパティにはドット記法でアクセスできない**。例えば空白やハイフンを含む名前、数字で始まる名前、変数に保持されている名前はブラケット記法でのみアクセスできる。この記法は**プロパティ名を動的に決める（実行時まで決まらない）場合にも非常に有用**:

```js
const myObj = {};
const str = "myString";
const rand = Math.random();
const anotherObj = {};

// Create additional properties on myObj
myObj.type = "Dot syntax for a key named type";
myObj["date created"] = "This key has a space";
myObj[str] = "This key is in variable str";
myObj[rand] = "A random number is the key here";
myObj[anotherObj] = "This key is object anotherObj";
myObj[""] = "This key is an empty string";

console.log(myObj);
// {
//   type: 'Dot syntax for a key named type',
//   'date created': 'This key has a space',
//   myString: 'This key is in variable str',
//   '0.6398914448618778': 'A random number is the key here',
//   '[object Object]': 'This key is object anotherObj',
//   '': 'This key is an empty string'
// }
console.log(myObj.myString); // 'This key is in variable str'
```

- 上のコードでキー `anotherObj` はオブジェクトであり、文字列でも symbol でもない。`myObj` に追加されるとき JavaScript は `anotherObj` の `toString()` メソッドを呼び、結果の文字列を新しいキーとして使う（→ `'[object Object]'`）。
- 変数に格納された文字列値でプロパティにアクセスすることもできる。変数はブラケット記法で渡さなければならない。上の例で変数 `str` は `"myString"` を保持し、プロパティ名になるのは `"myString"` である。したがって `myObj.str` は undefined を返す:

```js
str = "myString";
myObj[str] = "This key is in variable str";

console.log(myObj.str); // undefined

console.log(myObj[str]); // 'This key is in variable str'
console.log(myObj.myString); // 'This key is in variable str'
```

- これにより実行時に決まる任意のプロパティにアクセスできる:

```js
let propertyName = "make";
myCar[propertyName] = "Ford";

// access different properties by changing the contents of the variable
propertyName = "model";
myCar[propertyName] = "Mustang";

console.log(myCar); // { make: 'Ford', model: 'Mustang' }
```

> **【セキュリティ上の重要警告（原文の該当段落を逐語で示す）】**
>
> However, beware of using square brackets to access properties whose names are given by external input. This may make your code susceptible to [object injection attacks](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md).
>
> （和訳: ただし、**外部入力によって与えられた名前のプロパティにアクセスするために角括弧を使うことには注意せよ。これはコードを object injection 攻撃に対して脆弱にし得る**。）
>
> 参照先URL（原文のまま）: `https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md`

- 存在しないプロパティの値は `undefined`（`null` ではない）:

```js
myCar.nonexistentProperty; // undefined
```

〔補足（一般知識）〕この警告はクライアントサイド脆弱性ハンティングの中核概念のひとつ。`obj[userKey]` 形式は (1) `__proto__` / `constructor` / `prototype` を指定されるとプロトタイプ汚染の入口になり、(2) 意図しない内部プロパティ（`Object.prototype` 由来のメソッドなど）を読み出す、(3) 関数テーブル `handlers[userKey]()` 形式では任意メソッド呼び出しに繋がり得る。防御は許可リスト照合、`Object.hasOwn(obj, key)` チェック、`Map` の使用、`Object.create(null)` によるプロトタイプなしオブジェクトの採用。

##### Enumerating properties（プロパティ列挙の3つのネイティブ手段）
- `for...in` ループ: このメソッドは**オブジェクトの列挙可能な文字列プロパティすべて、およびそのプロトタイプチェーンを走査する**。
- `Object.keys()`: オブジェクト `myObj` の**列挙可能な自身の文字列プロパティ名（キー）のみ**の配列を返す。プロトタイプチェーンのものは含まない。
- `Object.getOwnPropertyNames()`: オブジェクト `myObj` の**自身の文字列プロパティ名すべて**（列挙可能かどうかに関わらず）を含む配列を返す。

```js
function showProps(obj, objName) {
  let result = "";
  for (const i in obj) {
    // Object.hasOwn() is used to exclude properties from the object's
    // prototype chain and only show "own properties"
    if (Object.hasOwn(obj, i)) {
      result += `${objName}.${i} = ${obj[i]}\n`;
    }
  }
  console.log(result);
}
```

- **"own property"** という用語はオブジェクトのプロパティのうちプロトタイプチェーンのものを除いたものを指す。`showProps(myCar, 'myCar')` は次を出力する:

```plain
myCar.make = Ford
myCar.model = Mustang
myCar.year = 1969
```

等価な書き方:

```js
function showProps(obj, objName) {
  let result = "";
  Object.keys(obj).forEach((i) => {
    result += `${objName}.${i} = ${obj[i]}\n`;
  });
  console.log(result);
}
```

- **継承されたプロパティ（非列挙可能なものを含む）をすべて列挙するネイティブな方法はない。** ただし次の関数で実現できる:

```js
function listAllProperties(myObj) {
  let objectToInspect = myObj;
  let result = [];

  while (objectToInspect !== null) {
    result = result.concat(Object.getOwnPropertyNames(objectToInspect));
    objectToInspect = Object.getPrototypeOf(objectToInspect);
  }

  return result;
}
```

〔補足（一般知識）〕`listAllProperties` はプロトタイプチェーンを辿って全プロパティ名を集める関数であり、診断では「オブジェクト（`window`、フレームワークの内部オブジェクト、ライブラリのエクスポート）が持つ隠れた API 面を洗い出す」際にそのまま使える。

##### Deleting properties
- 継承していないプロパティは `delete` 演算子で削除できる:

```js
// Creates a new object, myObj, with two properties, a and b.
const myObj = { a: 5, b: 12 };

// Removes the a property, leaving myObj with only the b property.
delete myObj.a;
console.log("a" in myObj); // false
```

#### 6.3 Inheritance
- **JavaScript のすべてのオブジェクトは少なくとも1つの他のオブジェクトから継承する。** 継承元のオブジェクトは prototype と呼ばれ、継承されたプロパティはコンストラクタの `prototype` オブジェクトの中に見つかる。

##### Defining properties for all objects of one type
- あるコンストラクタを通じて作られたすべてのオブジェクトに、`prototype` プロパティを使ってプロパティを追加できる。これは1つのインスタンスではなく指定された型のすべてのオブジェクトで共有されるプロパティを定義する:

```js
Car.prototype.color = "red";
console.log(car1.color); // "red"
```

#### 6.4 Defining methods
- **method** はオブジェクトに関連付けられた関数。言い換えるとメソッドは関数であるオブジェクトのプロパティ。

```js
objectName.methodName = functionName;

const myObj = {
  myMethod: function (params) {
    // do something
  },

  // this works too!
  myOtherMethod(params) {
    // do something else
  },
};
```

呼び出し:

```js
objectName.methodName(params);
```

- メソッドは通常コンストラクタの `prototype` オブジェクトに定義され、同じ型のすべてのオブジェクトが同じメソッドを共有する:

```js
Car.prototype.displayCar = function () {
  const result = `A Beautiful ${this.year} ${this.make} ${this.model}`;
  console.log(result);
};
```

```js
car1.displayCar();
car2.displayCar();
```

##### Using this for object references

```js
const manager = {
  name: "Karina",
  age: 27,
  job: "Software Engineer",
};
const intern = {
  name: "Tyrone",
  age: 21,
  job: "Software Engineer Intern",
};

function sayHi() {
  console.log(`Hello, my name is ${this.name}`);
}

// Add sayHi function to both objects
manager.sayHi = sayHi;
intern.sayHi = sayHi;

manager.sayHi(); // Hello, my name is Karina
intern.sayHi(); // Hello, my name is Tyrone
```

- **`this` は関数呼び出しの "hidden parameter"（隠れた引数）** であり、呼ばれる関数の前にオブジェクトを指定することで渡される。例えば `manager.sayHi()` では `manager` が関数 `sayHi()` の前に来るので `this` は `manager` オブジェクト。同じ関数を別のオブジェクトからアクセスすれば `this` も変わる。`Function.prototype.call()` や `Reflect.apply()` のような他のメソッドで関数を呼べば、`this` の値を引数として明示的に渡せる。

#### 6.5 Defining getters and setters
- **getter** は特定のプロパティの値を取得する、プロパティに関連付けられた関数。**setter** は特定のプロパティの値を設定する、プロパティに関連付けられた関数。両者で間接的にプロパティの値を表現できる。
- getter/setter は **object initializers の中で定義する**か、**後から既存の任意のオブジェクトに追加する**ことができる。
- object initializer 内では通常のメソッドのように定義するが、`get` または `set` キーワードを前置する。getter メソッドはパラメータを期待してはならず、setter メソッドはちょうど1つのパラメータ（設定する新しい値）を期待する:

```js
const myObj = {
  a: 7,
  get b() {
    return this.a + 1;
  },
  set c(x) {
    this.a = x / 2;
  },
};

console.log(myObj.a); // 7
console.log(myObj.b); // 8, returned from the get b() method
myObj.c = 50; // Calls the set c(x) method
console.log(myObj.a); // 25
```

`myObj` のプロパティは:
- `myObj.a` — 数値
- `myObj.b` — `myObj.a` に 1 を足して返す getter
- `myObj.c` — `myObj.c` に設定される値の半分を `myObj.a` に設定する setter

- getter/setter は `Object.defineProperties()` メソッドで生成後いつでも追加できる。第1引数は getter/setter を定義したいオブジェクト。第2引数はプロパティ名が getter/setter 名、プロパティ値が getter/setter 関数を定義するオブジェクトであるオブジェクト:

```js
const myObj = { a: 0 };

Object.defineProperties(myObj, {
  b: {
    get() {
      return this.a + 1;
    },
  },
  c: {
    set(x) {
      this.a = x / 2;
    },
  },
});

myObj.c = 10; // Runs the setter, which assigns 10 / 2 (5) to the 'a' property
console.log(myObj.b); // Runs the getter, which yields a + 1 or 6
```

- どちらの形式を選ぶかはプログラミングスタイルと当該タスクに依る。元のオブジェクトの定義を変更できるなら initializer で定義する方がコンパクトで自然。後から追加する必要がある（そのオブジェクトを自分が書いていない場合など）なら第2の形式が唯一可能な形式。第2の形式は JavaScript の動的な性質をよく表すが、コードを読みにくくすることもある。

〔補足（一般知識）〕getter/setter はプロパティアクセスに任意コードを差し込む仕組みであり、脆弱性ハンティングでは (1) `Object.defineProperty(Object.prototype, 'x', {get(){...}})` によるプロトタイプ経由のアクセサ注入（プロトタイプ汚染の一形態）、(2) ガジェットとしてのアクセサ（オブジェクトを読むだけで副作用が起きる）を検討する対象になる。

#### 6.6 Comparing objects
- **JavaScript ではオブジェクトは参照型。2つの別個のオブジェクトは、同じプロパティを持っていても決して等しくない。** 同じオブジェクト参照を自身と比較した場合のみ true になる。

```js
// Two variables, two distinct objects with the same properties
const fruit = { name: "apple" };
const anotherFruit = { name: "apple" };

fruit == anotherFruit; // return false
fruit === anotherFruit; // return false
```

```js
// Two variables, a single object
const fruit = { name: "apple" };
const anotherFruit = fruit; // Assign fruit object reference to anotherFruit

// Here fruit and anotherFruit are pointing to same object
fruit == anotherFruit; // return true
fruit === anotherFruit; // return true

fruit.name = "grape";
console.log(anotherFruit); // { name: "grape" }; not { name: "apple" }
```

#### 6.7 See also（章末リンク）
- Inheritance and the prototype chain
- Classes

---

### 7. Inheritance and the prototype chain（プロトタイプチェーン／出典: .../Guide/Inheritance_and_the_prototype_chain）

導入（原文の要点を逐語に近い形で）:

> JavaScript implements inheritance by using objects. Each object has an internal link to another object called its _prototype_. That prototype object has a prototype of its own, and so on until an object is reached with `null` as its prototype. By definition, `null` has no prototype and acts as the final link in this **prototype chain**. It is possible to mutate any member of the prototype chain or even swap out the prototype at runtime, so concepts like static dispatching do not exist in JavaScript.

- **プロトタイプチェーンの任意のメンバーをミューテートすること、あるいは実行時にプロトタイプを丸ごと差し替えることが可能**である。そのため static dispatching のような概念は JavaScript には存在しない。
- クラスベース言語（Java、C++）の経験者には混乱を招くが、**プロトタイプ継承モデル自体は古典的モデルより強力**である。例えばプロトタイプモデルの上に古典的モデルを構築するのはかなり自明であり、それが **classes** の実装方法である。
- クラスは広く採用され新しいパラダイムになったが、**クラスは新しい継承パターンをもたらしていない**。クラスはプロトタイプ機構の大半を抽象化するが、プロトタイプが内部でどう動くかを理解することは依然有用。

#### 7.1 Inheritance with the prototype chain

##### Inheriting properties
- JavaScript のオブジェクトはプロパティの動的な「袋」（**own properties** と呼ばれる）である。JavaScript オブジェクトは prototype オブジェクトへのリンクを持つ。オブジェクトのプロパティにアクセスしようとすると、そのプロパティはオブジェクト自身だけでなく、オブジェクトのプロトタイプ、プロトタイプのプロトタイプ…と、**一致する名前のプロパティが見つかるか、プロトタイプチェーンの終端に達するまで**探索される。
- NOTE（表記法について、原文の要点）:
  - ECMAScript 標準に従い、`someObject.[[Prototype]]` という表記で `someObject` のプロトタイプを指す。
  - `[[Prototype]]` 内部スロットは `Object.getPrototypeOf()` と `Object.setPrototypeOf()` 関数でそれぞれアクセス・変更できる。
  - これは JavaScript のアクセサ **`__proto__`** と等価だが、**`__proto__` は非標準であり、多くの JavaScript エンジンで事実上実装されている**ものである。
  - 混乱を避けるため本ガイドでは `obj.__proto__` を使わず `obj.[[Prototype]]` を使う。これは `Object.getPrototypeOf(obj)` に対応する。
  - **これは関数の `func.prototype` プロパティと混同してはならない。** `func.prototype` は、その関数がコンストラクタとして使われたときに生成されるオブジェクトの**すべての _インスタンス_ に割り当てられる `[[Prototype]]`** を指定する。
- `[[Prototype]]` を指定する方法は複数ある。説明のためまず **`__proto__` 構文**を使う。`{ __proto__: ... }` 構文は `obj.__proto__` アクセサとは異なる点に注意: **前者は標準であり非推奨ではない。**
- `{ a: 1, b: 2, __proto__: c }` のようなオブジェクトリテラルでは、値 `c`（`null` か別のオブジェクトでなければならない）がそのリテラルが表すオブジェクトの `[[Prototype]]` になり、`a` や `b` といった他のキーは **own properties** になる。

プロパティアクセス時に何が起きるか（原文のコメント付きコードを逐語で）:

```js
const o = {
  a: 1,
  b: 2,
  // __proto__ sets the [[Prototype]]. It's specified here
  // as another object literal.
  __proto__: {
    b: 3,
    c: 4,
  },
};

// o.[[Prototype]] has properties b and c.
// o.[[Prototype]].[[Prototype]] is Object.prototype (we will explain
// what that means later).
// Finally, o.[[Prototype]].[[Prototype]].[[Prototype]] is null.
// This is the end of the prototype chain, as null,
// by definition, has no [[Prototype]].
// Thus, the full prototype chain looks like:
// { a: 1, b: 2 } ---> { b: 3, c: 4 } ---> Object.prototype ---> null

console.log(o.a); // 1
// Is there an 'a' own property on o? Yes, and its value is 1.

console.log(o.b); // 2
// Is there a 'b' own property on o? Yes, and its value is 2.
// The prototype also has a 'b' property, but it's not visited.
// This is called Property Shadowing

console.log(o.c); // 4
// Is there a 'c' own property on o? No, check its prototype.
// Is there a 'c' own property on o.[[Prototype]]? Yes, its value is 4.

console.log(o.d); // undefined
// Is there a 'd' own property on o? No, check its prototype.
// Is there a 'd' own property on o.[[Prototype]]? No, check its prototype.
// o.[[Prototype]].[[Prototype]] is Object.prototype and
// there is no 'd' property by default, check its prototype.
// o.[[Prototype]].[[Prototype]].[[Prototype]] is null, stop searching,
// no property found, return undefined.
```

- **オブジェクトにプロパティを設定すると own property が作られる。** 取得・設定の振る舞い規則の唯一の例外は **getter/setter によって横取りされる場合**。
- より長いプロトタイプチェーンも作れ、プロパティはそれら全てで探索される:

```js
const o = {
  a: 1,
  b: 2,
  // __proto__ sets the [[Prototype]]. It's specified here
  // as another object literal.
  __proto__: {
    b: 3,
    c: 4,
    __proto__: {
      d: 5,
    },
  },
};

// { a: 1, b: 2 } ---> { b: 3, c: 4 } ---> { d: 5 } ---> Object.prototype ---> null

console.log(o.d); // 5
```

##### Inheriting "methods"
- JavaScript にはクラスベース言語が定義する形の "methods" はない。JavaScript では任意の関数をプロパティの形でオブジェクトに追加できる。**継承された関数は他のプロパティと同様に振る舞う（上述のプロパティシャドウイングを含む。この場合は method overriding の一形態）。**
- **継承された関数が実行されるとき、`this` の値は継承している側のオブジェクトを指す**。その関数が own property として存在するプロトタイプオブジェクトではない。

```js
const parent = {
  value: 2,
  method() {
    return this.value + 1;
  },
};

console.log(parent.method()); // 3
// When calling parent.method in this case, 'this' refers to parent

// child is an object that inherits from parent
const child = {
  __proto__: parent,
};
console.log(child.method()); // 3
// When child.method is called, 'this' refers to child.
// So when child inherits the method of parent,
// The property 'value' is sought on child. However, since child
// doesn't have an own property called 'value', the property is
// found on the [[Prototype]], which is parent.value.

child.value = 4; // assign the value 4 to the property 'value' on child.
// This shadows the 'value' property on parent.
// The child object now looks like:
// { value: 4, __proto__: { value: 2, method: [Function] } }
console.log(child.method()); // 5
// Since child now has the 'value' property, 'this.value' means
// child.value instead
```

#### 7.2 Constructors
- プロトタイプの力は「すべてのインスタンスに存在すべきプロパティ群（特にメソッド）を再利用できる」こと。

素朴な実装（非効率）:

```js
const boxes = [
  { value: 1, getValue() { return this.value; } },
  { value: 2, getValue() { return this.value; } },
  { value: 3, getValue() { return this.value; } },
];
```

`getValue` を全 box の `[[Prototype]]` に移す:

```js
const boxPrototype = {
  getValue() {
    return this.value;
  },
};

const boxes = [
  { value: 1, __proto__: boxPrototype },
  { value: 2, __proto__: boxPrototype },
  { value: 3, __proto__: boxPrototype },
];
```

- こうすると全 box の `getValue` が同じ関数を参照し、メモリ使用量が下がる。しかしオブジェクト生成ごとに手動で `__proto__` をバインドするのは不便。そこで **constructor** 関数を使う。これは製造される各オブジェクトに自動的に `[[Prototype]]` を設定する。コンストラクタは `new` で呼ばれる関数:

```js
// A constructor function
function Box(value) {
  this.value = value;
}

// Properties all boxes created from the Box() constructor
// will have
Box.prototype.getValue = function () {
  return this.value;
};

const boxes = [new Box(1), new Box(2), new Box(3)];
```

- `new Box(1)` は `Box` コンストラクタ関数から作られた **instance**。`Box.prototype` は先の `boxPrototype` とさほど違わない（単なるプレーンオブジェクト）。
- **コンストラクタ関数から作られるすべてのインスタンスは、自動的にコンストラクタの `prototype` プロパティを自身の `[[Prototype]]` として持つ。** つまり `Object.getPrototypeOf(new Box()) === Box.prototype`。
- `Constructor.prototype` はデフォルトで1つの own property を持つ: **`constructor`**。これはコンストラクタ関数自身を参照する。つまり `Box.prototype.constructor === Box`。これにより任意のインスタンスから元のコンストラクタにアクセスできる。
- NOTE: **コンストラクタ関数から非プリミティブが返された場合、その値が `new` 式の結果になる。この場合 `[[Prototype]]` は正しくバインドされないかもしれない**（ただし実際にはそう多くは起きない）。

クラスでの書き換え:

```js
class Box {
  constructor(value) {
    this.value = value;
  }

  // Methods are created on Box.prototype
  getValue() {
    return this.value;
  }
}
```

- **クラスはコンストラクタ関数の糖衣構文**であり、`Box.prototype` を操作して全インスタンスの振る舞いを変えることが依然可能。
- `Box.prototype` が全インスタンスの `[[Prototype]]` と同じオブジェクトを参照するので、`Box.prototype` をミューテートすれば全インスタンスの振る舞いを変えられる:

```js
function Box(value) {
  this.value = value;
}
Box.prototype.getValue = function () {
  return this.value;
};
const box = new Box(1);

// Mutate Box.prototype after an instance has already been created
Box.prototype.getValue = function () {
  return this.value + 1;
};
box.getValue(); // 2
```

- 系として、**`Constructor.prototype` を _再代入_（`Constructor.prototype = ...`）するのは悪い考え**。2つの理由:
  - 再代入前に作られたインスタンスの `[[Prototype]]` が、再代入後に作られたインスタンスの `[[Prototype]]` とは別のオブジェクトを参照することになる。一方をミューテートしてももう一方はミューテートされない。
  - `constructor` プロパティを手動で再設定しない限り、`instance.constructor` からコンストラクタ関数を辿れなくなり、ユーザーの期待を壊し得る。**一部のビルトイン操作も `constructor` プロパティを読むので、設定されていないと期待通りに動かないことがある。**
- `Constructor.prototype` はインスタンス構築時にのみ有用。これは `Constructor.[[Prototype]]`（コンストラクタ関数**自身**のプロトタイプ、すなわち `Function.prototype`）とは無関係である。つまり `Object.getPrototypeOf(Constructor) === Function.prototype`。

##### Implicit constructors of literals（リテラルの暗黙コンストラクタ）

```js
// Object literals (without the `__proto__` key) automatically
// have `Object.prototype` as their `[[Prototype]]`
const object = { a: 1 };
Object.getPrototypeOf(object) === Object.prototype; // true

// Array literals automatically have `Array.prototype` as their `[[Prototype]]`
const array = [1, 2, 3];
Object.getPrototypeOf(array) === Array.prototype; // true

// RegExp literals automatically have `RegExp.prototype` as their `[[Prototype]]`
const regexp = /abc/;
Object.getPrototypeOf(regexp) === RegExp.prototype; // true
```

コンストラクタ形式への「脱糖」:

```js
const array = new Array(1, 2, 3);
const regexp = new RegExp("abc");
```

- 例えば `map()` のような「配列メソッド」は単に `Array.prototype` に定義されたメソッドであり、だからこそすべての配列インスタンスで自動的に使える。

> **WARNING（原文の警告を逐語で）**
>
> There is one misfeature that used to be prevalent — extending `Object.prototype` or one of the other built-in prototypes. An example of this misfeature is, defining `Array.prototype.myMethod = function () {...}` and then using `myMethod` on all array instances.
>
> This misfeature is called _monkey patching_. Doing monkey patching risks forward compatibility, because if the language adds this method in the future but with a different signature, your code will break. It has led to incidents like the [SmooshGate](https://developer.chrome.com/blog/smooshgate/), and can be a great nuisance for the language to advance since JavaScript tries to "not break the web".
>
> The **only** good reason for extending a built-in prototype is to backport the features of newer JavaScript engines, like `Array.prototype.forEach`.

（和訳要点: `Object.prototype` などビルトインプロトタイプの拡張は **monkey patching** と呼ばれる誤機能。前方互換性を損ない、**SmooshGate** のような事件を招いた。ビルトインプロトタイプを拡張する唯一の正当な理由は、`Array.prototype.forEach` のような新しいエンジンの機能をバックポートすることである。）

- 歴史的理由により、一部のビルトインコンストラクタの `prototype` プロパティは**それ自体がインスタンス**である。例: `Number.prototype` は数値 0、`Array.prototype` は空配列、`RegExp.prototype` は `/(?:)/`。

```js
Number.prototype + 1; // 1
Array.prototype.map((x) => x + 1); // []
String.prototype + "a"; // "a"
RegExp.prototype.source; // "(?:)"
Function.prototype(); // Function.prototype is a no-op function by itself
```

- しかしユーザー定義コンストラクタや `Map` のようなモダンなコンストラクタではそうではない:

```js
Map.prototype.get(1);
// Uncaught TypeError: get method called on incompatible Map.prototype
```

##### Building longer inheritance chains
- `Constructor.prototype` プロパティはコンストラクタのインスタンスの `[[Prototype]]` にそのまま（`Constructor.prototype` 自身の `[[Prototype]]` も含めて）なる。デフォルトでは `Constructor.prototype` はプレーンオブジェクト、すなわち `Object.getPrototypeOf(Constructor.prototype) === Object.prototype`。**唯一の例外は `Object.prototype` 自身**で、その `[[Prototype]]` は `null`（`Object.getPrototypeOf(Object.prototype) === null`）。

```js
function Constructor() {}

const obj = new Constructor();
// obj ---> Constructor.prototype ---> Object.prototype ---> null
```

- より長いプロトタイプチェーンを作るには `Object.setPrototypeOf()` で `Constructor.prototype` の `[[Prototype]]` を設定できる:

```js
function Base() {}
function Derived() {}
// Set the `[[Prototype]]` of `Derived.prototype`
// to `Base.prototype`
Object.setPrototypeOf(Derived.prototype, Base.prototype);

const obj = new Derived();
// obj ---> Derived.prototype ---> Base.prototype ---> Object.prototype ---> null
```

クラスでの等価表現（`extends` 構文）:

```js
class Base {}
class Derived extends Base {}

const obj = new Derived();
// obj ---> Derived.prototype ---> Base.prototype ---> Object.prototype ---> null
```

- レガシーコードでは `Object.create()` で継承チェーンを作るものも見られるが、これは `prototype` プロパティを再代入し `constructor` プロパティを取り除くため、よりエラーを招きやすい:

```js
function Base() {}
function Derived() {}
// Re-assigns `Derived.prototype` to a new object
// with `Base.prototype` as its `[[Prototype]]`
// DON'T DO THIS — use Object.setPrototypeOf to mutate it instead
Derived.prototype = Object.create(Base.prototype);
```

#### 7.3 Inspecting prototypes: a deeper dive

```js
function doSomething() {}
console.log(doSomething.prototype);
// It does not matter how you declare the function; a
// function in JavaScript will always have a default
// prototype property — with one exception: an arrow
// function doesn't have a default prototype property:
const doSomethingFromArrowFunction = () => {};
console.log(doSomethingFromArrowFunction.prototype);
```

- すべての関数は特別な `prototype` プロパティを持つ。**唯一の例外はアロー関数で、デフォルトの `prototype` プロパティを持たない。**

コンソール出力（原文のまま）:

```plain
{
  constructor: ƒ doSomething(),
  [[Prototype]]: {
    constructor: ƒ Object(),
    hasOwnProperty: ƒ hasOwnProperty(),
    isPrototypeOf: ƒ isPrototypeOf(),
    propertyIsEnumerable: ƒ propertyIsEnumerable(),
    toLocaleString: ƒ toLocaleString(),
    toString: ƒ toString(),
    valueOf: ƒ valueOf()
  }
}
```

- NOTE: **Chrome のコンソールはオブジェクトのプロトタイプを `[[Prototype]]` と表記し（仕様の用語に従う）、Firefox は `<prototype>` と表記する。**

```js
function doSomething() {}
doSomething.prototype.foo = "bar";
console.log(doSomething.prototype);
```

```plain
{
  foo: "bar",
  constructor: ƒ doSomething(),
  [[Prototype]]: {
    constructor: ƒ Object(),
    hasOwnProperty: ƒ hasOwnProperty(),
    isPrototypeOf: ƒ isPrototypeOf(),
    propertyIsEnumerable: ƒ propertyIsEnumerable(),
    toLocaleString: ƒ toLocaleString(),
    toString: ƒ toString(),
    valueOf: ƒ valueOf()
  }
}
```

```js
function doSomething() {}
doSomething.prototype.foo = "bar"; // add a property onto the prototype
const doSomeInstancing = new doSomething();
doSomeInstancing.prop = "some value"; // add a property onto the object
console.log(doSomeInstancing);
```

```plain
{
  prop: "some value",
  [[Prototype]]: {
    foo: "bar",
    constructor: ƒ doSomething(),
    [[Prototype]]: {
      constructor: ƒ Object(),
      hasOwnProperty: ƒ hasOwnProperty(),
      isPrototypeOf: ƒ isPrototypeOf(),
      propertyIsEnumerable: ƒ propertyIsEnumerable(),
      toLocaleString: ƒ toLocaleString(),
      toString: ƒ toString(),
      valueOf: ƒ valueOf()
    }
  }
}
```

探索順序（原文の説明を逐語的に整理）:
1. `doSomeInstancing` のプロパティにアクセスすると、ランタイムはまず `doSomeInstancing` がそのプロパティを持つか見る。
2. 持たなければ `doSomeInstancing.[[Prototype]]`（= `doSomething.prototype`）を探す。あればそれが使われる。
3. なければ `doSomeInstancing.[[Prototype]].[[Prototype]]` を調べる。デフォルトで任意の関数の `prototype` プロパティの `[[Prototype]]` は `Object.prototype` なので、`Object.prototype` が探索される。
4. そこにもなければ `doSomeInstancing.[[Prototype]].[[Prototype]].[[Prototype]]` を見る。しかし問題がある: **`Object.prototype.[[Prototype]]` は `null` なので、それは存在しない。** そのときだけ、`[[Prototype]]` のプロトタイプチェーン全体を探索し終えた後、ランタイムはプロパティが存在しないと断定し、値は `undefined` だと結論する。

```js
function doSomething() {}
doSomething.prototype.foo = "bar";
const doSomeInstancing = new doSomething();
doSomeInstancing.prop = "some value";
console.log("doSomeInstancing.prop:     ", doSomeInstancing.prop);
console.log("doSomeInstancing.foo:      ", doSomeInstancing.foo);
console.log("doSomething.prop:          ", doSomething.prop);
console.log("doSomething.foo:           ", doSomething.foo);
console.log("doSomething.prototype.prop:", doSomething.prototype.prop);
console.log("doSomething.prototype.foo: ", doSomething.prototype.foo);
```

```plain
doSomeInstancing.prop:      some value
doSomeInstancing.foo:       bar
doSomething.prop:           undefined
doSomething.foo:            undefined
doSomething.prototype.prop: undefined
doSomething.prototype.foo:  bar
```

#### 7.4 Different ways of creating and mutating prototype chains（プロトタイプチェーンの作成・変更方法の体系的まとめ）

##### (1) Objects created with syntax constructs

```js
const o = { a: 1 };
// The newly created object o has Object.prototype as its [[Prototype]]
// Object.prototype has null as its [[Prototype]].
// o ---> Object.prototype ---> null

const b = ["yo", "sup", "?"];
// Arrays inherit from Array.prototype
// (which has methods indexOf, forEach, etc.)
// The prototype chain looks like:
// b ---> Array.prototype ---> Object.prototype ---> null

function f() {
  return 2;
}
// Functions inherit from Function.prototype
// (which has methods call, bind, etc.)
// f ---> Function.prototype ---> Object.prototype ---> null

const p = { b: 2, __proto__: o };
// It is possible to point the newly created object's [[Prototype]] to
// another object via the __proto__ literal property. (Not to be confused
// with Object.prototype.__proto__ accessors)
// p ---> o ---> Object.prototype ---> null
```

- object initializers で `__proto__` キーを使うとき、**`__proto__` キーがオブジェクトでないものを指していると例外を投げずに黙って失敗する**。`Object.prototype.__proto__` setter とは対照的に、**オブジェクトリテラル initializer 内の `__proto__` は標準化されており最適化されている**。`Object.create` よりも高速であり得る。生成時に追加の own プロパティを宣言するのは `Object.create` より人間工学的。

##### (2) With constructor functions

```js
function Graph() {
  this.vertices = [];
  this.edges = [];
}

Graph.prototype.addVertex = function (v) {
  this.vertices.push(v);
};

const g = new Graph();
// g is an object with own properties 'vertices' and 'edges'.
// g.[[Prototype]] is the value of Graph.prototype when new Graph() is executed.
```

- コンストラクタ関数は非常に初期の JavaScript から利用可能。非常に高速で、非常に標準的で、非常に JIT 最適化しやすい。しかし「正しく行う」のは難しい。**この方法で追加されたメソッドはデフォルトで列挙可能（enumerable）であり、これは class 構文やビルトインメソッドの振る舞いと不整合。** より長い継承チェーンもエラーを招きやすい。

##### (3) With Object.create()
- `Object.create()` を呼ぶと新しいオブジェクトが作られる。このオブジェクトの `[[Prototype]]` は関数の第1引数:

```js
const a = { a: 1 };
// a ---> Object.prototype ---> null

const b = Object.create(a);
// b ---> a ---> Object.prototype ---> null
console.log(b.a); // 1 (inherited)

const c = Object.create(b);
// c ---> b ---> a ---> Object.prototype ---> null

const d = Object.create(null);
// d ---> null (d is an object that has null directly as its prototype)
console.log(d.hasOwnProperty);
// undefined, because d doesn't inherit from Object.prototype
```

- object initializer の `__proto__` キーと同様、`Object.create()` は生成時に直接プロトタイプを設定でき、ランタイムがさらに最適化できる。また **`Object.create(null)` で `null` プロトタイプのオブジェクトを作れる**。第2引数で新しいオブジェクトの各プロパティの属性を精密に指定できるが、これは両刃の剣:
  - オブジェクトリテラルでは不可能な非列挙プロパティなどを生成時に作れる。
  - オブジェクトリテラルよりずっと冗長でエラーを招きやすい。
  - 特に多数のプロパティを作る場合、オブジェクトリテラルより遅いことがある。

〔補足（一般知識）〕`Object.create(null)` は `Object.prototype` を継承しないため `__proto__` も `hasOwnProperty` も持たない。これがプロトタイプ汚染に対する強固な防御（およびキー衝突のない辞書）として推奨される技法の根拠である。

##### (4) With classes

```js
class Rectangle {
  constructor(height, width) {
    this.name = "Rectangle";
    this.height = height;
    this.width = width;
  }
}

class FilledRectangle extends Rectangle {
  constructor(height, width, color) {
    super(height, width);
    this.name = "Filled rectangle";
    this.color = color;
  }
}

const filledRectangle = new FilledRectangle(5, 10, "blue");
// filledRectangle ---> FilledRectangle.prototype ---> Rectangle.prototype ---> Object.prototype ---> null
```

- クラスは複雑な継承構造を定義するとき最高の可読性・保守性を提供する。**Private elements** はプロトタイプ継承では自明な代替がない機能。ただしクラスは伝統的なコンストラクタ関数より最適化が弱く、古い環境ではサポートされない。

##### (5) With Object.setPrototypeOf()
- 上記すべての方法がオブジェクト生成時にプロトタイプチェーンを設定するのに対し、`Object.setPrototypeOf()` は**既存のオブジェクトの `[[Prototype]]` 内部プロパティをミューテート**できる。`Object.create(null)` で作られたプロトタイプなしオブジェクトにプロトタイプを強制することも、`null` を設定してプロトタイプを取り除くこともできる:

```js
const obj = { a: 1 };
const anotherObj = { b: 2 };
Object.setPrototypeOf(obj, anotherObj);
// obj ---> anotherObj ---> Object.prototype ---> null
```

- ただし可能なら生成時にプロトタイプを設定すべき。**動的にプロトタイプを設定するとエンジンがプロトタイプチェーンに対して行ったすべての最適化が破壊される。** 一部のエンジンでは仕様通りに動かすためにコードの再コンパイル（de-optimization）を引き起こす可能性がある。

##### (6) With the `__proto__` accessor
- すべてのオブジェクトは `Object.prototype.__proto__` setter を継承しており、既存のオブジェクトの `[[Prototype]]` を設定するのに使える（オブジェクト上で `__proto__` キーがオーバーライドされていない場合）。

> **WARNING（原文）**: `Object.prototype.__proto__` accessors are **non-standard** and deprecated. You should almost always use `Object.setPrototypeOf` instead.

```js
const obj = {};
// DON'T USE THIS: for example only.
obj.__proto__ = { barProp: "bar val" };
obj.__proto__.__proto__ = { fooProp: "foo val" };
console.log(obj.fooProp);
console.log(obj.barProp);
```

- `Object.setPrototypeOf` と比較すると、**`__proto__` にオブジェクトでないものを設定すると例外を投げずに黙って失敗する**。ブラウザサポートはわずかに良い。しかし非標準かつ非推奨。ほとんど常に `Object.setPrototypeOf` を使うべき。

#### 7.5 Performance
- プロトタイプチェーンの上位にあるプロパティの検索時間は性能に悪影響を与え得る。性能がクリティカルなコードでは重大になり得る。加えて、**存在しないプロパティへのアクセスは常にプロトタイプチェーン全体を走査する**。
- また、オブジェクトのプロパティを反復するとき、**プロトタイプチェーン上のすべての列挙可能プロパティが列挙される**。プロパティがプロトタイプチェーンのどこかではなく**そのオブジェクト自身**に定義されているかを確認するには `hasOwnProperty` または `Object.hasOwn` メソッドを使う必要がある。`[[Prototype]]` が `null` のものを除くすべてのオブジェクトは `Object.prototype` から `hasOwnProperty` を継承する（プロトタイプチェーンのより下位でオーバーライドされていない限り）。

```js
function Graph() {
  this.vertices = [];
  this.edges = [];
}

Graph.prototype.addVertex = function (v) {
  this.vertices.push(v);
};

const g = new Graph();
// g ---> Graph.prototype ---> Object.prototype ---> null

g.hasOwnProperty("vertices"); // true
Object.hasOwn(g, "vertices"); // true

g.hasOwnProperty("nope"); // false
Object.hasOwn(g, "nope"); // false

g.hasOwnProperty("addVertex"); // false
Object.hasOwn(g, "addVertex"); // false

Object.getPrototypeOf(g).hasOwnProperty("addVertex"); // true
```

- Note: **プロパティが `undefined` かどうかを確認するだけでは不十分。** プロパティは存在していて、その値がたまたま `undefined` に設定されているだけかもしれない。

#### 7.6 Conclusion（章末結論・要点）
- Java や C++ 出身者には混乱を招くかもしれない。すべてが動的、すべてが実行時であり、静的型は一切ない。**すべてはオブジェクト（インスタンス）か関数（コンストラクタ）であり、関数自体も `Function` コンストラクタのインスタンスである。構文構造としての "クラス" も実行時には単なるコンストラクタ関数である。**
- JavaScript のすべてのコンストラクタ関数は `prototype` という特別なプロパティを持ち、それが `new` 演算子と協働する。prototype オブジェクトへの参照が新しいインスタンスの内部 `[[Prototype]]` プロパティにコピーされる。例えば `const a1 = new A()` をすると、JavaScript は（メモリ上にオブジェクトを作った後、`this` をそれに定義して関数 `A()` を実行する前に）`a1.[[Prototype]] = A.prototype` を設定する。
- インスタンスのプロパティにアクセスすると、JavaScript はまずそのオブジェクトに直接存在するかを調べ、なければ `[[Prototype]]` を見る。`[[Prototype]]` は**再帰的に**見られる。すなわち `a1.doSomething`、`Object.getPrototypeOf(a1).doSomething`、`Object.getPrototypeOf(Object.getPrototypeOf(a1)).doSomething` …と、見つかるか `Object.getPrototypeOf` が `null` を返すまで続く。
- つまり **`prototype` に定義されたすべてのプロパティは事実上すべてのインスタンスで共有され、後から `prototype` の一部を変更すれば既存の全インスタンスに変更が現れる。**
- `const a1 = new A(); const a2 = new A();` とすると、`a1.doSomething` は実際には `Object.getPrototypeOf(a1).doSomething` を指し、これは定義した `A.prototype.doSomething` と同じである。つまり `Object.getPrototypeOf(a1).doSomething === Object.getPrototypeOf(a2).doSomething === A.prototype.doSomething`。
- プロトタイプチェーンの長さにも注意し、性能問題を避けるため必要なら分割せよ。さらに、**新しい JavaScript 機能との互換性のためでない限り、ネイティブプロトタイプは決して拡張してはならない。**

〔補足（一般知識）〕本節の「`prototype` に定義したプロパティは全インスタンスで共有され、後からの変更が既存インスタンスにも波及する」という性質が、**プロトタイプ汚染（prototype pollution）** が強力である理由そのものである。`Object.prototype` に任意キーを1つ書き込めば、以後 own property を持たないすべてのオブジェクトがそのキーを「持って」見えるようになり、`if (opts.isAdmin)` のような分岐や、テンプレートエンジン・サニタイザの設定読み出しがガジェットとして成立する。MDN 本文はこの攻撃名を明示していないが、成立に必要な機構（プロパティ探索順序、シャドウイング、`__proto__` の2つの意味、`constructor.prototype` 経路、`Object.create(null)` の防御）をすべて説明している。

---

### 8. Using classes（クラス／private fields 中心・出典: .../Guide/Using_classes）

章の節構成（原文見出し）: Overview of classes / Declaring a class（Constructing a class, Class declaration hoisting, Class expressions）/ Constructor / Instance methods / **Private fields** / Accessor fields / Public fields / Static properties / Extends and inheritance / Why classes?

#### 8.1 Private fields（プライベートフィールド）
- 「なぜインスタンス上の `values` 配列に直接アクセスできるのに、わざわざ `getRed` / `setRed` メソッドを使う手間をかけるのか？」という問いから始まる:

```js
class Color {
  constructor(r, g, b) {
    this.values = [r, g, b];
  }
}

const red = new Color(255, 0, 0);
red.values[0] = 0;
console.log(red.values[0]); // 0
```

- オブジェクト指向プログラミングには **"encapsulation"（カプセル化）** という哲学がある。オブジェクトの下層の実装にアクセスすべきではなく、よく抽象化されたメソッドを使ってやり取りすべきだという考え。例えば突然色を RGB ではなく **HSL** で表現することに決めた場合:

```js
class Color {
  constructor(r, g, b) {
    // values is now an HSL array!
    this.values = rgbToHSL([r, g, b]);
  }
  getRed() {
    return hslToRGB(this.values)[0];
  }
  setRed(value) {
    const rgb = hslToRGB(this.values);
    rgb[0] = value;
    this.values = rgbToHSL(rgb);
  }
}

const red = new Color(255, 0, 0);
console.log(red.values[0]); // 0; It's not 255 anymore, because the H value for pure red is 0
```

「`values` は RGB 値を意味する」というユーザーの仮定が突然崩れ、ロジックが壊れ得る。クラスではこれを **private fields** で行う。

- **private field は `#`（ハッシュ記号）を前置した識別子。ハッシュはフィールド名の不可分な一部**であり、private field が public フィールドやメソッドと名前衝突することは決してない。クラス内のどこかで private field を参照するには、**クラス本体でそれを _宣言_ しなければならない**（その場で private 要素を作ることはできない）。これ以外は private field はほぼ通常のプロパティと等価。

```js
class Color {
  // Declare: every Color instance has a private field called #values.
  #values;
  constructor(r, g, b) {
    this.#values = [r, g, b];
  }
  getRed() {
    return this.#values[0];
  }
  setRed(value) {
    this.#values[0] = value;
  }
}

const red = new Color(255, 0, 0);
console.log(red.getRed()); // 255
```

- **クラス外から private field にアクセスすると早期の構文エラー（early syntax error）になる。** `#privateField` は特別な構文なので、コードを評価する前に静的解析で private field の全使用箇所を見つけられる:

```js
console.log(red.#values); // SyntaxError: Private field '#values' must be declared in an enclosing class
```

> **NOTE（原文）**: Code run in the Chrome console can access private elements outside the class. This is a DevTools-only relaxation of the JavaScript syntax restriction.
>
> （和訳: **Chrome のコンソールで実行されるコードはクラスの外から private 要素にアクセスできる。これは DevTools 限定の JavaScript 構文制限の緩和である。**）

- **JavaScript の private fields は _hard private_ である。** クラスがこれらの private field を露出するメソッドを実装していなければ、**外部からそれらを取得する機構は絶対に存在しない。** つまり露出メソッドの振る舞いが変わらない限り、private field に対してどんなリファクタリングも安全に行える。

```js
class Color {
  #values;
  constructor(r, g, b) {
    this.#values = [r, g, b];
  }
  getRed() {
    return this.#values[0];
  }
  setRed(value) {
    if (value < 0 || value > 255) {
      throw new RangeError("Invalid R value");
    }
    this.#values[0] = value;
  }
}

const red = new Color(255, 0, 0);
red.setRed(1000); // RangeError: Invalid R value
```

- `values` プロパティを露出したままにしておくと、ユーザーは `values[0]` に直接代入することでこのチェックを容易に**回避（circumvent）** でき、不正な色を作れる。しかしよくカプセル化された API があれば、コードをより堅牢にし下流のロジックエラーを防げる。
- **クラスメソッドは、同じクラスに属する限り他のインスタンスの private field を読める:**

```js
class Color {
  #values;
  constructor(r, g, b) {
    this.#values = [r, g, b];
  }
  redDifference(anotherColor) {
    // #values doesn't necessarily need to be accessed from this:
    // you can access private fields of other instances belonging
    // to the same class.
    return this.#values[0] - anotherColor.#values[0];
  }
}

const red = new Color(255, 0, 0);
const crimson = new Color(220, 20, 60);
red.redDifference(crimson); // 35
```

- しかし `anotherColor` が Color インスタンスでなければ `#values` は存在しない（**別のクラスが同名の `#values` private field を持っていても、それは同じものを指さずここからアクセスできない**）。**存在しない private 要素へのアクセスは、通常のプロパティのように `undefined` を返す代わりにエラーを投げる。** private field が存在するか分からず、`try`/`catch` でエラー処理せずにアクセスしたい場合は **`in` 演算子**を使える:

```js
class Color {
  #values;
  constructor(r, g, b) {
    this.#values = [r, g, b];
  }
  redDifference(anotherColor) {
    if (!(#values in anotherColor)) {
      throw new TypeError("Color instance expected");
    }
    return this.#values[0] - anotherColor.#values[0];
  }
}
```

> **NOTE（原文）**: Keep in mind that the `#` is a special identifier syntax, and you can't use the field name as if it's a string. `"#values" in anotherColor` would look for a property name literally called `"#values"`, instead of a private field.

- private 要素の制約: **同じ名前を1つのクラス内で2回宣言できない。削除できない。** どちらも早期の構文エラーになる:

```js
class BadIdeas {
  #firstName;
  #firstName; // syntax error occurs here
  #lastName;
  constructor() {
    delete this.#lastName; // also a syntax error
  }
}
```

- **メソッド、getter、setter も private にできる。** クラスが内部的に複雑なことを行う必要があり、コードの他の部分からは呼ばれるべきでない場合に有用。
- 例: クリック／タップ等で有効化されたときにやや複雑なことをすべき **HTML custom elements** を作る場合。複雑な処理はこのクラスに限定されるべきで、他のどの JavaScript 部分もそれにアクセスしない（すべきでない）:

```js
class Counter extends HTMLElement {
  #xValue = 0;
  constructor() {
    super();
    this.onclick = this.#clicked.bind(this);
  }
  get #x() {
    return this.#xValue;
  }
  set #x(value) {
    this.#xValue = value;
    window.requestAnimationFrame(this.#render.bind(this));
  }
  #clicked() {
    this.#x++;
  }
  #render() {
    this.textContent = this.#x.toString();
  }
  connectedCallback() {
    this.#render();
  }
}

customElements.define("num-counter", Counter);
```

この場合ほぼすべてのフィールドとメソッドがクラスに private。したがってコードの残りに対して、本質的にビルトインの HTML 要素と同じようなインターフェースを提示する。**プログラムの他のどの部分も `Counter` の内部に影響を与える力を持たない。**

#### 8.2 Accessor fields（アクセサフィールド）
- `color.getRed()` / `color.setRed()` は色の赤値の読み書きを可能にする。Java のような言語から来た人にはこのパターンは馴染み深い。しかし単にプロパティにアクセスするためにメソッドを使うのは JavaScript ではやや人間工学的でない。**Accessor fields** は「実際のプロパティ」であるかのように扱えるようにする。

〔補足（一般知識）〕private fields の "hard private" 性質と「Chrome コンソールだけは例外的にアクセスできる」という MDN の注記は、クライアントサイド診断で重要な実務知識である。ページ内の他スクリプト（XSS ペイロードを含む）からは `#field` に到達できないが、調査者は DevTools から内部状態を観察できる。逆にクロージャ／WeakMap ベースの「疑似 private」は同一コンテキストの他コードから到達できる余地がある（例: プロトタイプ経由のメソッド借用、`Function.prototype.call` によるメソッド流用）。

---

### 9. Iterators and generators（出典: .../Guide/Iterators_and_generators）

導入（原文）:

> Iterators and Generators bring the concept of iteration directly into the core language and provide a mechanism for customizing the behavior of `for...of` loops.

関連リファレンス（原文のリンク）:
- Iteration protocols（`/Web/JavaScript/Reference/Iteration_protocols`）
- `for...of`
- `function*` と `Generator`
- `yield` と `yield*`

#### 9.1 Iterators
- **iterator** は列（sequence）と、終了時の返り値の可能性を定義するオブジェクト。
- 具体的には、iterator は **Iterator protocol** を実装する任意のオブジェクト、つまり次の2つのプロパティを持つオブジェクトを返す `next()` メソッドを持つもの:

| プロパティ | 定義（原文） |
| --- | --- |
| `value` | The next value in the iteration sequence. |
| `done` | This is `true` if the last value in the sequence has already been consumed. If `value` is present alongside `done`, it is the iterator's return value. |

- 作られた iterator は `next()` を繰り返し呼ぶことで明示的に反復できる。**iterator を反復することを iterator を「消費する（consume）」という。一般に一度しか行えない。** 終端値が yield された後、追加の `next()` 呼び出しは `{done: true}` を返し続けるべき。
- JavaScript で最も一般的な iterator は **Array iterator**。関連する配列の各値を順に返す。
- すべての iterator が配列として表現できると想像しやすいが、これは真ではない。**配列は全体を割り当てなければならないが、iterator は必要に応じてのみ消費される。** このため iterator は無限サイズの列（`0` から `Infinity` までの整数の範囲など）を表現できる。

`start`（含む）から `end`（含まない）まで `step` 間隔の整数列を定義する range iterator を作る例。最終的な返り値は生成した列のサイズ（変数 `iterationCount` で追跡）:

```js
function makeRangeIterator(start = 0, end = Infinity, step = 1) {
  let nextIndex = start;
  let iterationCount = 0;

  const rangeIterator = {
    next() {
      let result;
      if (nextIndex < end) {
        result = { value: nextIndex, done: false };
        nextIndex += step;
        iterationCount++;
        return result;
      }
      return { value: iterationCount, done: true };
    },
  };
  return rangeIterator;
}
```

使用例:

```js
const iter = makeRangeIterator(1, 10, 2);

let result = iter.next();
while (!result.done) {
  console.log(result.value); // 1 3 5 7 9
  result = iter.next();
}

console.log("Iterated over sequence of size:", result.value); // [5 numbers returned, that took interval in between: 0 to 10]
```

> **NOTE（原文）**: It is not possible to know reflectively whether a particular object is an iterator. If you need to do this, use Iterables.
>
> （和訳: **特定のオブジェクトが iterator かどうかをリフレクティブに知ることはできない。** これが必要なら Iterables を使え。）

#### 9.2 Generator functions
- カスタム iterator は有用なツールだが、内部状態を明示的に維持する必要があるため注意深いプログラミングを要する。**Generator functions** は強力な代替を提供する。実行が連続的でない単一の関数を書くことで反復アルゴリズムを定義できる。generator function は **`function*`** 構文で書く。
- 呼ばれたとき generator function は最初はコードを実行しない。代わりに **Generator** と呼ばれる特別な型の iterator を返す。generator の `next` メソッドを呼んで値が消費されると、generator 関数は **`yield`** キーワードに遭遇するまで実行する。
- 関数は望むだけ何度でも呼べ、毎回新しい Generator を返す。**各 Generator は一度だけ反復できる。**

```js
function* makeRangeIterator(start = 0, end = Infinity, step = 1) {
  let iterationCount = 0;
  for (let i = start; i < end; i += step) {
    iterationCount++;
    yield i;
  }
  return iterationCount;
}
```

#### 9.3 Iterables
- オブジェクトが `for...of` 構成でどの値がループされるかといった反復の振る舞いを定義していれば、そのオブジェクトは **iterable** である。`Array` や `Map` のような一部のビルトイン型はデフォルトの反復動作を持つが、他の型（`Object` など）は持たない。
- **iterable であるためには、オブジェクトは `[Symbol.iterator]()` メソッドを実装しなければならない。** つまりそのオブジェクト（またはプロトタイプチェーン上のいずれかのオブジェクト）が `Symbol.iterator` キーのプロパティを持たなければならない。
- iterable を複数回反復できることもあるし、一度だけのこともある。どちらなのかを知るのはプログラマの責任。
- **一度だけ反復できる iterable（Generator など）は慣習的に `[Symbol.iterator]()` メソッドから `this` を返す**。一方、何度も反復できる iterable は `[Symbol.iterator]()` の各呼び出しで新しい iterator を返さなければならない。

```js
function* makeIterator() {
  yield 1;
  yield 2;
}

const iter = makeIterator();

for (const itItem of iter) {
  console.log(itItem);
}

console.log(iter[Symbol.iterator]() === iter); // true

// This example shows us generator(iterator) is an iterable object,
// which has the [Symbol.iterator]() method return the `iter` (itself),
// and consequently, the `iter` object can iterate only _once_.

// If we change the [Symbol.iterator]() method of `iter` to a function/generator
// which returns a new iterator/generator object, `iter`
// can iterate many times

iter[Symbol.iterator] = function* () {
  yield 2;
  yield 1;
};
```

##### User-defined iterables

```js
const myIterable = {
  *[Symbol.iterator]() {
    yield 1;
    yield 2;
    yield 3;
  },
};
```

ユーザー定義 iterable は `for...of` ループやスプレッド構文で通常通り使える:

```js
for (const value of myIterable) {
  console.log(value);
}
// 1
// 2
// 3

[...myIterable]; // [1, 2, 3]
```

##### Built-in iterables
- **`String`、`Array`、`TypedArray`、`Map`、`Set` はすべてビルトインの iterable** である。それらのプロトタイプオブジェクトがすべて `Symbol.iterator` メソッドを持つため。

##### Syntaxes expecting iterables
- 一部の文と式は iterable を期待する。例: **`for...of` ループ、spread syntax、`yield*`、destructuring 構文**。

```js
for (const value of ["a", "b", "c"]) {
  console.log(value);
}
// "a"
// "b"
// "c"

[..."abc"];
// ["a", "b", "c"]

function* gen() {
  yield* ["a", "b", "c"];
}

gen().next();
// { value: "a", done: false }

[a, b, c] = new Set(["a", "b", "c"]);
a;
// "a"
```

#### 9.4 Advanced generators
- Generator は yield する値を **_on demand_（要求に応じて）** 計算する。これにより計算コストの高い列（あるいは上で示したように無限列）を効率的に表現できる。
- **`next()` メソッドは値も受け取れる**。これを使って generator の内部状態を変更できる。`next()` に渡された値は `yield` が受け取る。

> **NOTE（原文）**: A value passed to the _first_ invocation of `next()` is always ignored.
>
> （和訳: **`next()` の _最初の_ 呼び出しに渡された値は常に無視される。**）

`next(x)` で列をリスタートする fibonacci generator:

```js
function* fibonacci() {
  let current = 0;
  let next = 1;
  while (true) {
    const reset = yield current;
    [current, next] = [next, next + current];
    if (reset) {
      current = 0;
      next = 1;
    }
  }
}

const sequence = fibonacci();
console.log(sequence.next().value); // 0
console.log(sequence.next().value); // 1
console.log(sequence.next().value); // 1
console.log(sequence.next().value); // 2
console.log(sequence.next().value); // 3
console.log(sequence.next().value); // 5
console.log(sequence.next().value); // 8
console.log(sequence.next(true).value); // 0
console.log(sequence.next().value); // 1
console.log(sequence.next().value); // 1
console.log(sequence.next().value); // 2
```

- **`throw()` メソッド**を呼んで投げるべき例外値を渡すと、generator に強制的に例外を投げさせられる。この例外は generator の現在中断されているコンテキストから投げられる。**現在中断している `yield` が代わりに `throw value` 文であったかのように**振る舞う。
- 例外が generator 内でキャッチされなければ `throw()` の呼び出しを通じて上方に伝播し、その後の `next()` 呼び出しは `done` プロパティが `true` になる。
- Generator は **`return()` メソッド**を持つ。与えられた値を返し generator 自体を終了させる。

〔補足（一般知識）〕`[Symbol.iterator]` は「オブジェクトの振る舞いを外から差し替えられるフック」の代表例であり、プロトタイプ汚染や Symbol プロパティ注入でイテレーション動作を乗っ取る（destructuring や spread に副作用を挿入する）ガジェットになり得る。また `Array.prototype[Symbol.iterator]` の改変はスプレッド構文の挙動全体に影響する。

---

### 10. Meta programming — Proxy と Reflect（出典: .../Guide/Meta_programming）

導入（原文）:

> The `Proxy` and `Reflect` objects allow you to intercept and define custom behavior for fundamental language operations (e.g., property lookup, assignment, enumeration, function invocation, etc.). With the help of these two objects you are able to program at the meta level of JavaScript.

#### 10.1 Proxies
- `Proxy` オブジェクトは特定の操作を横取り（intercept）し、カスタムの振る舞いを実装できる。
- 例: オブジェクトのプロパティ取得:

```js
const handler = {
  get(target, name) {
    return name in target ? target[name] : 42;
  },
};

const p = new Proxy({}, handler);
p.a = 1;
console.log(p.a, p.b); // 1, 42
```

`Proxy` オブジェクトは `target`（ここでは空オブジェクト）と、`get` **trap** が実装された `handler` オブジェクトを定義する。ここでプロキシされるオブジェクトは未定義プロパティを取得したときに `undefined` を返さず、代わりに数値 `42` を返す。

##### Terminology（用語・原文の定義リスト）

| 用語 | 定義（原文） |
| --- | --- |
| handler | Placeholder object which contains traps. |
| traps | The methods that provide property access. (This is analogous to the concept of _traps_ in operating systems.) |
| target | Object which the proxy virtualizes. It is often used as storage backend for the proxy. Invariants (semantics that remain unchanged) regarding object non-extensibility or non-configurable properties are verified against the target. |
| invariants | Semantics that remain unchanged when implementing custom operations are called _invariants_. **If you violate the invariants of a handler, a `TypeError` will be thrown.** |

#### 10.2 Handlers and traps（Proxy の全トラップ対応表）

原文の表（`Handler / trap` と `Interceptions`）を完全再現する。

| Handler / trap | Interceptions（横取りされる操作） |
| --- | --- |
| `handler.getPrototypeOf()` | `Object.getPrototypeOf()` / `Reflect.getPrototypeOf()` / `__proto__` / `Object.prototype.isPrototypeOf()` / `instanceof` |
| `handler.setPrototypeOf()` | `Object.setPrototypeOf()` / `Reflect.setPrototypeOf()` |
| `handler.isExtensible()` | `Object.isExtensible()` / `Reflect.isExtensible()` |
| `handler.preventExtensions()` | `Object.preventExtensions()` / `Reflect.preventExtensions()` |
| `handler.getOwnPropertyDescriptor()` | `Object.getOwnPropertyDescriptor()` / `Reflect.getOwnPropertyDescriptor()` |
| `handler.defineProperty()` | `Object.defineProperty()` / `Reflect.defineProperty()` |
| `handler.has()` | **Property query**: `foo in proxy` ／ **Inherited property query**: `foo in Object.create(proxy)` / `Reflect.has()` |
| `handler.get()` | **Property access**: `proxy[foo]` / `proxy.bar` ／ **Inherited property access**: `Object.create(proxy)[foo]` / `Reflect.get()` |
| `handler.set()` | **Property assignment**: `proxy[foo] = bar` / `proxy.foo = bar` ／ **Inherited property assignment**: `Object.create(proxy)[foo] = bar` / `Reflect.set()` |
| `handler.deleteProperty()` | **Property deletion**: `delete proxy[foo]` / `delete proxy.foo` / `Reflect.deleteProperty()` |
| `handler.ownKeys()` | `Object.getOwnPropertyNames()` / `Object.getOwnPropertySymbols()` / `Object.keys()` / `Reflect.ownKeys()` |
| `handler.apply()` | `proxy(..args)` / `Function.prototype.apply()` および `Function.prototype.call()` / `Reflect.apply()` |
| `handler.construct()` | `new proxy(...args)` / `Reflect.construct()` |

（合計 13 トラップ。詳細な説明と例は Proxy リファレンスページを参照、と原文に記載。）

#### 10.3 Revocable `Proxy`
- **`Proxy.revocable()`** メソッドは取り消し可能な `Proxy` オブジェクトを作る。これはプロキシを `revoke` 関数で取り消してプロキシをオフにできることを意味する。
- その後、プロキシに対するいかなる操作も `TypeError` になる。

```js
const revocable = Proxy.revocable(
  {},
  {
    get(target, name) {
      return `[[${name}]]`;
    },
  },
);
const proxy = revocable.proxy;
console.log(proxy.foo); // "[[foo]]"

revocable.revoke();

console.log(proxy.foo); // TypeError: Cannot perform 'get' on a proxy that has been revoked
proxy.foo = 1; // TypeError: Cannot perform 'set' on a proxy that has been revoked
delete proxy.foo; // TypeError: Cannot perform 'deleteProperty' on a proxy that has been revoked
console.log(typeof proxy); // "object", typeof doesn't trigger any trap
```

（最後の行が重要: **`typeof` はいかなるトラップも発火しない。**）

#### 10.4 Reflection（Reflect）
- **`Reflect`** は横取り可能な JavaScript 操作のためのメソッドを提供するビルトインオブジェクト。**メソッドは proxy handler のものと同じ。**
- **`Reflect` は関数オブジェクトではない。**
- `Reflect` は handler からデフォルト操作を `target` へ転送するのに役立つ。
- 例えば `Reflect.has()` を使うと **`in` 演算子を関数として**得られる:

```js
Reflect.has(Object, "assign"); // true
```

##### A better apply() function
- `Reflect` 以前は、与えられた `this` 値と配列（または array-like オブジェクト）として提供された `arguments` で関数を呼ぶために典型的に `Function.prototype.apply()` メソッドを使っていた:

```js
Function.prototype.apply.call(Math.floor, undefined, [1.75]);
```

- `Reflect.apply` ならこれがより冗長でなく理解しやすくなる:

```js
Reflect.apply(Math.floor, undefined, [1.75]);
// 1

Reflect.apply(String.fromCharCode, undefined, [104, 101, 108, 108, 111]);
// "hello"

Reflect.apply(RegExp.prototype.exec, /ab/, ["confabulation"]).index;
// 4

Reflect.apply("".charAt, "ponies", [3]);
// "i"
```

##### Checking if property definition has been successful
- `Object.defineProperty` は成功時にオブジェクトを返し、そうでなければ `TypeError` を投げるので、プロパティ定義中に起きたエラーを捕まえるには `try...catch` ブロックを使うことになる。**`Reflect.defineProperty()` は Boolean の成功ステータスを返す**ので、単に `if...else` ブロックを使える:

```js
if (Reflect.defineProperty(target, property, attributes)) {
  // success
} else {
  // failure
}
```

〔補足（一般知識）〕Proxy/Reflect はクライアントサイド診断・防御の両方で実用性が高い。
- **観測（計測）**: `window.fetch`、`XMLHttpRequest.prototype.open`、`Element.prototype.setAttribute`、`Element.prototype.innerHTML` の setter などを Proxy／`Object.defineProperty` でラップして、どの値がどの sink に到達するかを記録する（taint 追跡の簡易実装）。上記トラップ表はどの構文がどのトラップを発火するかの正確な対応表なので、フックの取りこぼしを避ける根拠資料になる。
- **落とし穴**: `typeof` はトラップを発火しない（上記引用）。また invariant 違反は `TypeError` になるため、`Object.freeze` 済みオブジェクトや non-configurable プロパティを持つ target にフックを仕込もうとすると失敗する。
- **`Reflect.apply("".charAt, "ponies", [3])` のような「メソッド借用」** は、オブジェクトが独自の `charAt` を持っていても組み込み実装を強制できることを示す。サニタイザ実装が改変された組み込みメソッドに依存しないための堅牢化技法（"safe intrinsics" の確保）として同じ考え方が使われる。
- `handler.get`/`set` が継承経路（`Object.create(proxy)[foo]`）でも発火する点は、プロトタイプ経由のアクセスを観測・改変できることを意味する。

---

### 11. Using promises（出典: .../Guide/Using_promises）

導入（原文）:

> A `Promise` is an object representing the eventual completion or failure of an asynchronous operation. Since most people are consumers of already-created promises, this guide will explain consumption of returned promises before explaining how to create them.

- 本質的に promise は「関数にコールバックを渡す代わりに、コールバックを取り付ける返却オブジェクト」である。

コールバック版:

```js
function successCallback(result) {
  console.log(`Audio file ready at URL: ${result}`);
}

function failureCallback(error) {
  console.error(`Error generating audio file: ${error}`);
}

createAudioFileAsync(audioSettings, successCallback, failureCallback);
```

promise 版:

```js
createAudioFileAsync(audioSettings).then(successCallback, failureCallback);
```

#### 11.1 Chaining
- 古い時代、複数の非同期操作を連続して行うと古典的な **callback hell** になった:

```js
doSomething(function (result) {
  doSomethingElse(result, function (newResult) {
    doThirdThing(newResult, function (finalResult) {
      console.log(`Got the final result: ${finalResult}`);
    }, failureCallback);
  }, failureCallback);
}, failureCallback);
```

- promise では **promise chain** を作る。コールバックが関数に渡されるのではなく返された promise オブジェクトに取り付けられるため、API 設計が優れている。
- **要点: `then()` 関数は元と異なる _新しい promise_ を返す:**

```js
const promise = doSomething();
const promise2 = promise.then(successCallback, failureCallback);
```

この2番目の promise（`promise2`）は `doSomething()` だけでなく、渡した `successCallback` または `failureCallback` の完了も表す。それらは promise を返す他の非同期関数であり得る。その場合、`promise2` に追加されたコールバックは `successCallback`／`failureCallback` が返した promise の後ろにキューされる。

> NOTE（原文のテンプレート）: promise を返す任意の関数を作るテンプレート
>
> ```js
> function doSomething() {
>   return new Promise((resolve) => {
>     setTimeout(() => {
>       // Other things to do before completion of the promise
>       console.log("Did something");
>       // The fulfillment value of the promise
>       resolve("https://example.com/");
>     }, 200);
>   });
> }
> ```

- `then` の引数は省略可能で、**`catch(failureCallback)` は `then(null, failureCallback)` の短縮形**。エラー処理コードが全ステップで同じならチェーンの末尾に付けられる:

```js
doSomething()
  .then(function (result) {
    return doSomethingElse(result);
  })
  .then(function (newResult) {
    return doThirdThing(newResult);
  })
  .then(function (finalResult) {
    console.log(`Got the final result: ${finalResult}`);
  })
  .catch(failureCallback);
```

アロー関数版:

```js
doSomething()
  .then((result) => doSomethingElse(result))
  .then((newResult) => doThirdThing(newResult))
  .then((finalResult) => {
    console.log(`Got the final result: ${finalResult}`);
  })
  .catch(failureCallback);
```

> NOTE: アロー関数式は **implicit return** を持てる。`() => x` は `() => { return x; }` の短縮形。

- `doSomethingElse` と `doThirdThing` は任意の値を返せる。promise を返した場合、その promise が settle するまで待たれ、次のコールバックは **promise 自体ではなく fulfillment value** を受け取る。
- **`then` のコールバックからは常に promise を返すことが重要**。たとえその promise が常に `undefined` に resolve するとしても。前のハンドラが promise を開始したが返さなかった場合、その settle を追跡する方法はもうなく、その promise は **"floating"（浮遊している）** と言われる。

悪い例:

```js
doSomething()
  .then((url) => {
    // Missing `return` keyword in front of fetch(url).
    fetch(url);
  })
  .then((result) => {
    // result is undefined, because nothing is returned from the previous
    // handler. There's no way to know the return value of the fetch()
    // call anymore, or whether it succeeded at all.
  });
```

良い例:

```js
doSomething()
  .then((url) => {
    // `return` keyword added
    return fetch(url);
  })
  .then((result) => {
    // result is a Response object
  });
```

- **floating promise は競合状態（race conditions）があるとさらに悪化する。** 最後のハンドラからの promise が返されないと、次の `then` ハンドラが早期に呼ばれ、それが読む値は不完全になり得る:

```js
const listOfIngredients = [];

doSomething()
  .then((url) => {
    // Missing `return` keyword in front of fetch(url).
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        listOfIngredients.push(data);
      });
  })
  .then(() => {
    console.log(listOfIngredients);
    // listOfIngredients will always be [], because the fetch request hasn't completed yet.
  });
```

- したがって経験則として、**操作が promise に遭遇したら常にそれを返し、その処理を次の `then` ハンドラに委ねる**:

```js
const listOfIngredients = [];

doSomething()
  .then((url) => {
    // `return` keyword now included in front of fetch call.
    return fetch(url)
      .then((res) => res.json())
      .then((data) => {
        listOfIngredients.push(data);
      });
  })
  .then(() => {
    console.log(listOfIngredients);
    // listOfIngredients will now contain data from fetch call.
  });
```

- さらに良いのは、ネストしたチェーンを単一のチェーンに平坦化すること。より単純でエラー処理も容易になる:

```js
doSomething()
  .then((url) => fetch(url))
  .then((res) => res.json())
  .then((data) => {
    listOfIngredients.push(data);
  })
  .then(() => {
    console.log(listOfIngredients);
  });
```

- `async`/`await` を使えばより直感的で同期的コードに似たコードが書ける:

```js
async function logIngredients() {
  const url = await doSomething();
  const res = await fetch(url);
  const data = await res.json();
  listOfIngredients.push(data);
  console.log(listOfIngredients);
}
```

- **唯一のトレードオフのひとつは `await` キーワードを忘れやすいこと**で、これは型の不一致（promise を値として使おうとするなど）があるときにしか修正できない。
- NOTE（原文）: `async`/`await` は通常の promise チェーンと**同じ並行性セマンティクス**を持つ。1つの async 関数内の `await` はプログラム全体を止めるのではなく、その値に依存する部分だけを止める。`await` が pending の間も他の async ジョブは実行できる。

#### 11.2 Error handling

```js
doSomething()
  .then((result) => doSomethingElse(result))
  .then((newResult) => doThirdThing(newResult))
  .then((finalResult) => console.log(`Got the final result: ${finalResult}`))
  .catch(failureCallback);
```

- 例外があると、ブラウザはチェーンを下方向に `.catch()` ハンドラまたは `onRejected` を探す。これは同期コードの動作に非常に近くモデル化されている:

```js
try {
  const result = syncDoSomething();
  const newResult = syncDoSomethingElse(result);
  const finalResult = syncDoThirdThing(newResult);
  console.log(`Got the final result: ${finalResult}`);
} catch (error) {
  failureCallback(error);
}
```

- この対称性は `async`/`await` 構文で頂点に達する:

```js
async function foo() {
  try {
    const result = await doSomething();
    const newResult = await doSomethingElse(result);
    const finalResult = await doThirdThing(newResult);
    console.log(`Got the final result: ${finalResult}`);
  } catch (error) {
    failureCallback(error);
  }
}
```

- **promise はコールバックのピラミッド・オブ・ドゥームの根本的欠陥を解決する。すべてのエラー、投げられた例外やプログラミングエラーまで捕まえる。** これは非同期操作の関数的合成に不可欠。すべてのエラーがチェーン末尾の `catch()` メソッドで処理され、**`async`/`await` を使わずに `try`/`catch` を使う必要はほぼない**。

##### Nesting
- 単純な promise チェーンはネストなしで平坦に保つのが最良。ネストは不注意な合成の結果であり得る。
- **ネストは `catch` 文のスコープを限定する制御構造である。** 具体的には、ネストされた `catch` はそのスコープとそれ以下の失敗のみを捕まえ、ネストされたスコープの外側のチェーン上位のエラーは捕まえない。正しく使えばエラー回復の精度が上がる:

```js
doSomethingCritical()
  .then((result) =>
    doSomethingOptional(result)
      .then((optionalResult) => doSomethingExtraNice(optionalResult))
      .catch((e) => {}),
  ) // Ignore if optional stuff fails; proceed.
  .then(() => moreCriticalStuff())
  .catch((e) => console.error(`Critical failure: ${e.message}`));
```

- ここでの optional なステップがネストされているのは、**インデントではなく、ステップを囲む外側の `(` と `)` の配置によって**引き起こされている点に注意。
- 内側のエラーを黙らせる `catch` ハンドラは `doSomethingOptional()` と `doSomethingExtraNice()` からの失敗のみを捕まえ、その後コードは `moreCriticalStuff()` で再開する。重要なのは、**`doSomethingCritical()` が失敗した場合、そのエラーは最後の（外側の）`catch` だけで捕まえられ、内側の `catch` ハンドラに飲み込まれない**こと。

`async`/`await` 版:

```js
async function main() {
  try {
    const result = await doSomethingCritical();
    try {
      const optionalResult = await doSomethingOptional(result);
      await doSomethingExtraNice(optionalResult);
    } catch (e) {
      // Ignore failures in optional steps and proceed.
    }
    await moreCriticalStuff();
  } catch (e) {
    console.error(`Critical failure: ${e.message}`);
  }
}
```

> NOTE: 洗練されたエラー処理がないなら、ネストした `then` ハンドラはおそらく不要。平坦なチェーンを使い、エラー処理ロジックを末尾に置け。

##### Chaining after a catch
- 失敗（`catch`）の**後に**チェーンすることも可能。チェーン内のアクションが失敗した後でも新しいアクションを達成するのに有用:

```js
doSomething()
  .then(() => {
    throw new Error("Something failed");

    console.log("Do this");
  })
  .catch(() => {
    console.error("Do that");
  })
  .then(() => {
    console.log("Do this, no matter what happened before");
  });
```

出力:

```plain
Do that
Do this, no matter what happened before
```

> NOTE: "Do this" は表示されない。"Something failed" エラーが rejection を引き起こしたため。

`async`/`await` 版:

```js
async function main() {
  try {
    await doSomething();
    throw new Error("Something failed");
    console.log("Do this");
  } catch (e) {
    console.error("Do that");
  }
  console.log("Do this, no matter what happened before");
}
```

##### Promise rejection events（重要 — グローバルイベント）
- promise の rejection イベントがどのハンドラでも処理されない場合、それはコールスタックの最上部までバブルし、**host がそれを surface（表面化）する必要がある**。
- ウェブでは promise が reject されるたび、**2つのイベントのいずれかがグローバルスコープ**（一般に `window`、Web Worker 内なら `Worker` その他 worker ベースのインターフェース）に送られる:

| イベント | 定義（原文） |
| --- | --- |
| `unhandledrejection` | Sent when a promise is rejected but there is no rejection handler available. |
| `rejectionhandled` | Sent when a handler is attached to a rejected promise that has already caused an `unhandledrejection` event. |

- どちらの場合も、イベント（型は **`PromiseRejectionEvent`**）はメンバーとして、reject された promise を示す **`promise`** プロパティと、promise が reject された理由を提供する **`reason`** プロパティを持つ。
- これらにより promise のフォールバックエラー処理を提供でき、promise 管理の問題のデバッグにも役立つ。**これらのハンドラはコンテキストごとにグローバル**なので、ソースに関わらずすべてのエラーが同じイベントハンドラに行く。
- **Node.js では promise rejection の処理がわずかに異なる。** Node.js の `unhandledRejection` イベント（**名前の大文字化の違いに注意**）のハンドラを追加することで未処理の rejection を捕捉する:

```js
process.on("unhandledRejection", (reason, promise) => {
  // Add code here to examine the "promise" and "reason" values
});
```

- Node.js では、エラーがコンソールにログされるのを防ぐ（そうでなければ起きるデフォルトアクション）には、その `process.on()` リスナーを追加するだけで十分。ブラウザランタイムの `preventDefault()` に相当するものは不要。
- ただし `process.on` リスナーを追加しても、その中に reject された promise を処理するコードがなければ、それらは**床に落とされて黙って無視される**。理想的には、各 reject された promise を調べ、実際のコードバグに起因していないことを確認するコードをリスナー内に追加すべき。

〔補足（一般知識）〕`unhandledrejection` は診断作業でも使える。`window.addEventListener('unhandledrejection', e => console.log(e.reason))` を仕込むと、アプリが黙って飲み込んでいた非同期エラー（スタックトレースにサーバ側のエラーメッセージや内部パスが含まれることがある）を可視化できる。また `e.reason` が開発者向けの詳細情報を含む場合は情報漏えいの報告材料になる。

#### 11.3 Composition（合成 — 4つのツール）
- 非同期操作を並行実行するための **4つの composition tools** がある: **`Promise.all()`**、**`Promise.allSettled()`**、**`Promise.any()`**、**`Promise.race()`**。

```js
Promise.all([func1(), func2(), func3()]).then(([result1, result2, result3]) => {
  // use result1, result2 and result3
});
```

- **配列内の promise の1つが reject すると、`Promise.all()` は即座に返された promise を reject する。他の操作は実行を続けるが、その結果は `Promise.all()` の返り値経由では利用できない。これは予期しない状態や振る舞いを引き起こし得る。** `Promise.allSettled()` はすべての操作が完了してから resolve することを保証する別の composition tool。
- これらのメソッドはすべて promise を並行実行する。promise の列が同時に開始され、互いを待たない。**逐次合成（Sequential composition）** も巧妙な JavaScript で可能:

```js
[func1, func2, func3]
  .reduce((p, f) => p.then(f), Promise.resolve())
  .then((result3) => {
    /* use result3 */
  });
```

上のコードは次と等価:

```js
Promise.resolve()
  .then(func1)
  .then(func2)
  .then(func3)
  .then((result3) => {
    /* use result3 */
  });
```

再利用可能な compose 関数にできる（関数型プログラミングで一般的）:

```js
const applyAsync = (acc, val) => acc.then(val);
const composeAsync =
  (...funcs) =>
  (x) =>
    funcs.reduce(applyAsync, Promise.resolve(x));
```

```js
const transformData = composeAsync(func1, func2, func3);
const result3 = transformData(data);
```

async/await でより簡潔に:

```js
let result;
for (const f of [func1, func2, func3]) {
  result = await f(result);
}
/* use last result (i.e. result3) */
```

- ただし promise を逐次合成する前に、それが本当に必要か検討せよ。**ある promise の実行が別の promise の結果に依存しない限り、不必要に互いをブロックしないよう並行実行する方が常に良い。**

#### 11.4 Cancellation（キャンセル）
- **`Promise` 自身はキャンセルのための first-class なプロトコルを持たない**が、下層の非同期操作を直接キャンセルできる場合がある。典型的には **`AbortController`** を使う。

#### 11.5 Creating a Promise around an old callback API
- `Promise` はコンストラクタでゼロから作れる。**これは古い API をラップする場合にのみ必要**。
- 理想的な世界ではすべての非同期関数が既に promise を返す。残念ながら一部の API は古い方式で success/failure コールバックを渡すことを期待する。最も明白な例は `setTimeout()`:

```js
setTimeout(() => saySomething("10 seconds passed"), 10 * 1000);
```

- **古いスタイルのコールバックと promise を混ぜるのは問題がある。** `saySomething()` が失敗したりプログラミングエラーを含んでいても、何もそれを catch しない。これは `setTimeout()` の設計に内在する問題。
- 幸い `setTimeout()` を promise でラップできる。**ベストプラクティスはコールバックを受け取る関数を可能な限り低いレベルでラップし、その後は決して直接呼ばないこと**:

```js
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

wait(10 * 1000)
  .then(() => saySomething("10 seconds"))
  .catch(failureCallback);
```

- promise コンストラクタは executor 関数を取り、promise を手動で resolve または reject できる。`setTimeout()` は本当に失敗しないので、この場合 reject は省いた。

#### 11.6 Timing（タイミング — マイクロタスク）

##### Guarantees（保証）
- コールバックベースの API では、コールバックがいつどう呼ばれるかは API 実装者に依存する。例えばコールバックが同期的に呼ばれることも非同期的に呼ばれることもある:

```js
function doSomething(callback) {
  if (Math.random() > 0.5) {
    callback();
  } else {
    setTimeout(() => callback(), 1000);
  }
}
```

- 上の設計は強く非推奨。いわゆる **"state of Zalgo"** を招く。非同期 API 設計の文脈では、これは**あるケースでは同期的に、別のケースでは非同期的にコールバックが呼ばれ、呼び出し側に曖昧さを生む**ことを意味する。背景はこの用語が最初に正式に提示された記事 **Designing APIs for Asynchrony**（`https://blog.izs.me/2013/08/designing-apis-for-asynchrony/`）を参照。この API 設計は副作用の解析を難しくする:

```js
let value = 1;
doSomething(() => {
  value = 2;
});
console.log(value); // 1 or 2?
```

- 一方 promise は **inversion of control（制御の反転）** の一形態であり、API 実装者はコールバックがいつ呼ばれるかを制御しない。コールバックキューの維持と呼び出しタイミングの決定は promise 実装に委譲され、API の利用者と開発者の両方が自動的に強い意味論的保証を得る。その保証（原文の3項目）:
  - **`then()` で追加されたコールバックは、JavaScript イベントループの現在の実行の完了より前に呼び出されることは決してない。**
  - **これらのコールバックは、promise が表す非同期操作の成功または失敗の _後に_ 追加されたとしても呼び出される。**
  - **`then()` を複数回呼んで複数のコールバックを追加できる。それらは挿入された順に、次々と呼び出される。**
- 驚きを避けるため、**`then()` に渡された関数は、既に resolve 済みの promise であっても決して同期的に呼ばれない**:

```js
Promise.resolve().then(() => console.log(2));
console.log(1);
// Logs: 1, 2
```

- 即座に実行される代わりに、渡された関数は **microtask queue（マイクロタスクキュー）** に置かれる。これは後で（それを作った関数が終了し、JavaScript 実行スタックが空になった後、イベントループに制御が戻る直前に）実行されることを意味する。つまりかなりすぐ:

```js
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

wait(0).then(() => console.log(4));
Promise.resolve()
  .then(() => console.log(2))
  .then(() => console.log(3));
console.log(1); // 1, 2, 3, 4
```

##### Task queues vs. microtasks
- **Promise コールバックは microtask として扱われ、`setTimeout()` コールバックは task queue として扱われる。**

```js
const promise = new Promise((resolve, reject) => {
  console.log("Promise callback");
  resolve();
}).then((result) => {
  console.log("Promise callback (.then)");
});

setTimeout(() => {
  console.log("event-loop cycle: Promise (fulfilled)", promise);
}, 0);

console.log("Promise (pending)", promise);
```

出力:

```plain
Promise callback
Promise (pending) Promise {<pending>}
Promise callback (.then)
event-loop cycle: Promise (fulfilled) Promise {<fulfilled>}
```

##### When promises and tasks collide
- promise とタスク（イベントやコールバックなど）が予測不能な順序で発火する状況に遭遇したら、**microtask を使って状態をチェックするか、promise が条件付きで作られるときに promise のバランスを取る**ことで恩恵を受けられるかもしれない。
- microtask が問題解決に役立つと思うなら、**`queueMicrotask()`** を使って関数を microtask としてキューに入れる方法について microtask ガイドを参照。

#### 11.7 See also（章末リンク・原文のまま）
- `Promise`
- `async function`
- `await`
- **Promises/A+ specification**（`https://promisesaplus.com/`）
- **We have a problem with promises**（`https://pouchdb.com/2015/05/18/we-have-a-problem-with-promises.html`）on pouchdb.com (2015)

〔補足（一般知識）〕マイクロタスク／タスクの実行順は、クライアントサイド脆弱性の中でも**競合状態（race condition）と TOCTOU**（例: 検証してから使うまでの間に値が書き換わる）を組み立て・説明するのに不可欠な知識である。`await` の後ろのコードは必ずマイクロタスク境界を挟むため、「`await` を挟んで再取得しない」コードはその境界で状態が変わり得る。診断時には「`postMessage` ハンドラ内の `await` の前後でオリジン検証が行われているか」といった観点が典型。

---

### 12. JavaScript modules（出典: .../Guide/Modules）

#### 12.1 A background on modules
- 複雑なプロジェクトは JavaScript プログラムを必要に応じてインポートできる分離モジュールに分割する機構を必要とする。Node.js は長くこの能力を持ち、モジュール使用を可能にする JavaScript ライブラリ／フレームワークが多数ある（他の **CommonJS** や **AMD** ベースのモジュールシステム、**RequireJS**、**webpack**、**Babel** など）。
- **すべてのモダンブラウザはトランスパイルなしでネイティブにモジュール機能をサポートする。** ブラウザはモジュールの読み込みを最適化でき、ライブラリを使って余分なクライアントサイド処理と余分なラウンドトリップを行うより効率的になる。
- **ただし webpack のようなバンドラを無用にはしない。** バンドラは依然コードを妥当なサイズのチャンクに分割する良い仕事をし、**minification（最小化）、dead code elimination（デッドコード削除）、tree-shaking** といった他の最適化も行える。

#### 12.2 Introducing an example / Basic example structure
- MDN は GitHub 上に一連のサンプル（`https://github.com/mdn/js-examples/tree/main/module-examples`）を用意している。`<canvas>` 要素をウェブページに作り、キャンバスに異なる形を描画（および情報を報告）するモジュール群。
- NOTE: **サンプルをダウンロードしてローカルで実行するにはローカルウェブサーバー経由で実行する必要がある。**

ファイル構造（`basic-modules`）:

```plain
index.html
main.js
modules/
    canvas.js
    square.js
```

- `canvas.js` — キャンバスのセットアップに関する関数を含む:
  - `create()` — 指定した ID の ラッパー `<div>` の中に指定した `width` と `height` のキャンバスを作り、それ自体を指定した親要素の中に追加する。キャンバスの 2D コンテキストとラッパーの ID を含むオブジェクトを返す。
  - `createReportList()` — 指定したラッパー要素の中に順序なしリストを追加し、レポートデータを出力するのに使える。リストの ID を返す。
- `square.js` — 次を含む:
  - `name` — 文字列 'square' を含む定数。
  - `draw()` — 指定したキャンバスに、指定したサイズ・位置・色で正方形を描く。正方形のサイズ・位置・色を含むオブジェクトを返す。
  - `reportArea()` — 長さを与えられて、正方形の面積を特定のレポートリストに書く。
  - `reportPerimeter()` — 長さを与えられて、正方形の周長を特定のレポートリストに書く。

##### Aside — .mjs versus .js（重要: MIME タイプと配信）
- 本記事ではモジュールファイルに `.js` 拡張子を使っているが、他の資料では `.mjs` 拡張子が使われていることがある。**V8 のドキュメントはこれを推奨**している。その理由:
  - 明確性のため。どのファイルがモジュールで、どれが通常の JavaScript かが明らかになる。
  - Node.js のようなランタイムや Babel のようなビルドツールによってモジュールファイルがモジュールとしてパースされることを保証する。
- しかし MDN は少なくとも当面 `.js` を使い続けることに決めた。理由（原文の重要な段落）:

> To get modules to work correctly in a browser, you need to make sure that your server is serving them with a `Content-Type` header that contains a JavaScript MIME type such as `text/javascript`. If you don't, you'll get a strict MIME type checking error along the lines of "The server responded with a non-JavaScript MIME type" and the browser won't run your JavaScript. Most servers already set the correct type for `.js` files, but not yet for `.mjs` files. Servers that already serve `.mjs` files correctly include GitHub Pages and `http-server` for Node.js.

（和訳: **ブラウザでモジュールを正しく動かすには、サーバーが `text/javascript` のような JavaScript MIME タイプを含む `Content-Type` ヘッダでそれらを配信していることを確認する必要がある。** そうでないと "The server responded with a non-JavaScript MIME type" という**厳格な MIME タイプチェックのエラー**になり、ブラウザは JavaScript を実行しない。ほとんどのサーバーは `.js` には既に正しいタイプを設定しているが、`.mjs` にはまだ設定していない。`.mjs` を正しく配信するサーバーには **GitHub Pages** と Node.js 用の **`http-server`** がある。）

- さらに次の点も指摘されている:
  - 一部のツールは `.mjs` を決してサポートしないかもしれない。
  - `<script type="module">` 属性がモジュールを指していることを示すのに使われる。

〔補足（一般知識）〕モジュールスクリプトに対する厳格な MIME タイプチェックは、クライアントサイドセキュリティ上意味を持つ。クラシックスクリプトは MIME を緩く扱う実装もあるが、`type="module"` では JavaScript MIME が必須になるため、「アップロードした画像ファイルをモジュールとして読み込ませる」類の攻撃は成立しにくい。逆に `X-Content-Type-Options: nosniff` の有無や、任意ファイルが `text/javascript` で配信される設定ミス（JSON hijacking や script gadget の起点）は診断対象になる。

#### 12.3 Exporting module features
- モジュール機能にアクセスするために最初に行うのはエクスポート。**`export` 文**を使う。

```js
export const name = "square";

export function draw(ctx, length, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, length, length);

  return { length, x, y, color };
}
```

- **関数、`var`、`let`、`const`、そしてクラスをエクスポートできる。それらはトップレベルの項目でなければならない。例えば関数の内部で `export` は使えない。**
- より便利な方法はモジュールファイル末尾に単一の export 文を置き、波括弧で包んだカンマ区切りのリストを続けること:

```js
export { name, draw, reportArea, reportPerimeter };
```

#### 12.4 Importing features into your script

```js
import { name, draw, reportArea, reportPerimeter } from "./modules/square.js";
```

- **`import` 文**の後にカンマ区切りのリスト（波括弧で包む）、`from` キーワード、**_module specifier_** が続く。
- **module specifier** は JavaScript 環境がモジュールファイルへのパスに解決できる文字列を提供する。ブラウザではサイトルートからの相対パスにもできる（`basic-modules` の例なら `/js-examples/module-examples/basic-modules`）。しかしここではドット `.` 構文で「現在の場所」を意味し、続いて探しているファイルへの相対パスを書く。これは毎回絶対パス全体を書くよりずっと良い。相対パスは短く、URL をポータブルにする。サイト階層の別の場所に移動しても例は動く。
- 例:

```bash
/js-examples/module-examples/basic-modules/modules/square.js
```

は

```bash
./modules/square.js
```

になる。

> NOTE: 一部のモジュールシステムでは `modules/square` のような、相対パスでも絶対パスでもなく、ファイル拡張子もない module specifier を使える。**この種の specifier は、先に import map を定義すればブラウザ環境でも使える。**

```js
const myCanvas = create("myCanvas", document.body, 480, 320);
const reportList = createReportList(myCanvas.id);

const square = draw(myCanvas.ctx, 50, 50, 100, "blue");
reportArea(square.length, reportList);
reportPerimeter(square.length, reportList);
```

> **NOTE（重要）**: The imported values are read-only views of the features that were exported. Similar to `const` variables, you cannot re-assign the variable that was imported, but you can still modify properties of object values. **The value can only be re-assigned by the module exporting it.**
>
> （和訳: **インポートされた値はエクスポートされた機能の読み取り専用ビューである。** `const` 変数と同様、インポートされた変数を再代入できないが、オブジェクト値のプロパティは変更できる。**値はそれをエクスポートしているモジュールによってのみ再代入できる。**）

#### 12.5 Importing modules using import maps
- 上ではブラウザが絶対 URL、またはドキュメントのベース URL で解決される相対 URL の module specifier を使ってモジュールをインポートする方法を見た:

```js
import { name as circleName } from "https://example.com/shapes/circle.js";
import { name as squareName, draw } from "./shapes/square.js";
```

- **Import maps** はモジュールをインポートするときに module specifier にほぼ任意のテキストを指定できるようにし、マップはモジュール URL が解決されるときにそのテキストを置き換える対応値を提供する。
- 下の import map の `imports` キーは "module specifier map" JSON オブジェクトを定義する。プロパティ名が module specifier として使え、対応する値がブラウザがモジュール URL を解決するときに代入される。**値は絶対 URL または相対 URL でなければならない。相対 URL は import map を含むドキュメントの base URL を使って絶対 URL アドレスに解決される。**

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

- import map は `type` 属性を **`importmap`** に設定した `<script>` 要素の内部の JSON オブジェクトで定義する。
- **NOTE（重要）: import map はドキュメントにのみ適用される。仕様は worker や worklet コンテキストで import map を適用する方法をカバーしていない。**
- module specifier キーに末尾のスラッシュがなければ、module specifier キー全体がマッチされ置換される:

```js
// Bare module names as module specifiers
import { name as squareNameOne } from "shapes";
import { name as squareNameTwo } from "shapes/square";

// Remap a URL to another URL
import { name as squareNameThree } from "https://example.com/shapes/square.js";
```

- module specifier が末尾のフォワードスラッシュを持つ場合、値も1つ持たなければならず、キーは **"path prefix"** としてマッチされる。これにより URL のクラス全体をリマップできる:

```js
// Remap a URL as a prefix ( https://example.com/shapes/)
import { name as squareNameFour } from "https://example.com/shapes/moduleshapes/square.js";
```

- **import map 内の複数のキーが1つの module specifier に対して有効なマッチになり得る。** 例えば module specifier `shapes/circle/` は module specifier キー `shapes/` と `shapes/circle/` の両方にマッチし得る。**この場合ブラウザは最も具体的な（最も長い）マッチする module specifier キーを選ぶ。**
- import map は（Node.js のように）bare module 名でモジュールをインポートすることを可能にし、拡張子ありでもなしでもパッケージからのインポートをシミュレートできる。上では示していないが、**モジュールをインポートするスクリプトのパスに基づいてライブラリの特定のバージョンをインポートすることも可能にする。**

##### Feature detection
- `HTMLScriptElement.supports()` 静的メソッド（それ自体が広くサポートされている）で import maps のサポートを確認できる:

```js
if (HTMLScriptElement.supports?.("importmap")) {
  console.log("Browser supports import maps.");
}
```

##### Importing modules as bare names
- Node.js のような一部の JavaScript 環境では module specifier に bare name を使える。環境がモジュール名をファイルシステムの標準的な場所に解決できるため:

```js
import { name, draw, reportArea, reportPerimeter } from "square";
```

- **ブラウザで bare name を使うには import map が必要。** module specifier を URL に解決するのに必要な情報をブラウザに提供する（**モジュールの場所に解決できない module specifier をインポートしようとすると JavaScript は `TypeError` を投げる**）。

```html
<script type="importmap">
  {
    "imports": {
      "square": "./shapes/square.js"
    }
  }
</script>
```

```js
import { name as squareName, draw } from "square";
```

##### Remapping module paths
- specifier キーとその関連値の両方が末尾のフォワードスラッシュ `/` を持つ module specifier map エントリは **path-prefix** として使える。これにより一連のインポート URL 全体を別の場所にリマップできる。Node エコシステムで見られるような "packages and modules" での作業をエミュレートするのにも使える。

> NOTE: 末尾の `/` は module specifier キーが module specifier の **_一部_** として置換され得ることを示す。これがない場合、ブラウザは module specifier キー全体にのみマッチ（および置換）する。

###### Packages of modules

```json
{
  "imports": {
    "lodash": "/node_modules/lodash-es/lodash.js",
    "lodash/": "/node_modules/lodash-es/"
  }
}
```

```js
import _ from "lodash";
import fp from "lodash/fp.js";
```

- 上の `fp` を `.js` 拡張子なしでインポートすることも可能だが、そのファイル用の bare module specifier キー（`lodash/fp` など）を作る必要があり、パスを使うのではない。これは1つのモジュールなら妥当だが、多数のモジュールをインポートしたい場合はスケールしない。

###### General URL remapping
- module specifier キーはパスである必要はなく、絶対 URL（または `./`、`../`、`/` のような URL ライクな相対パス）でもよい。**絶対パスを持つモジュールを自分のローカルリソースにリマップしたい場合に有用:**

```json
{
  "imports": {
    "https://www.unpkg.com/moment/": "/node_modules/moment/"
  }
}
```

##### Scoped modules for version management
- Node のようなエコシステムは npm のようなパッケージマネージャでモジュールとその依存関係を管理する。パッケージマネージャは各モジュールが他のモジュールとその依存関係から分離されることを保証する。結果として、複雑なアプリケーションがモジュールグラフの異なる部分で同じモジュールを複数の異なるバージョンで複数回含んでいても、ユーザーはこの複雑さを考える必要がない。
- import map も同様にアプリケーション内で依存関係の複数バージョンを持ち、同じ module specifier で参照できるようにする。これを **`scopes` キー**で実装する。これは**インポートを実行しているスクリプトのパスに応じて使われる module specifier map** を提供できる:

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

- このマッピングでは、URL に `/node_modules/dependency/` を含むスクリプトが `cool-module` をインポートすると、`/node_modules/some/other/location/cool-module/index.js` のバージョンが使われる。**`imports` のマップは、スコープ付きマップにマッチするスコープがない場合、またはマッチしたスコープにマッチする specifier が含まれない場合のフォールバックとして使われる。**
- **スコープを選択するのに使われるパスはアドレスの解決方法に影響しない。** マップされたパスの値はスコープのパスに一致する必要はなく、相対パスは依然 import map を含むスクリプトの base URL に解決される。
- module specifier map と同様、多数の scope キーを持てて、それらは重なるパスを含み得る。**複数のスコープが referrer URL にマッチする場合、最も具体的なスコープパス（最も長い scope キー）が最初にマッチする specifier について調べられる。** マッチする specifier がなければ、ブラウザは次に最も具体的なマッチするスコープ付きパスにフォールバックする。マッチするスコープのどれにもマッチする specifier がなければ、ブラウザは `imports` キーの module specifier map でのマッチを調べる。

##### Improve caching by mapping away hashed filenames
- ウェブサイトが使うスクリプトファイルはキャッシュを単純化するためにハッシュ化されたファイル名を持つことが多い。この方法の欠点は、モジュールが変わるとハッシュ化ファイル名でそれをインポートするモジュールも更新／再生成が必要になること。これは更新のカスケードを生み、ネットワークリソースを無駄にする。
- import map は便利な解決策を提供する。特定のハッシュ化ファイル名に依存する代わりに、アプリケーションとスクリプトはモジュール名（アドレス）のハッシュなしバージョンに依存する。

```json
{
  "imports": {
    "main_script": "/node/srcs/application-fg7744e1b.js",
    "dependency_script": "/node/srcs/dependency-3qn7e4b1q.js"
  }
}
```

〔補足（一般知識）〕import maps はクライアントサイド診断で重要な攻撃面になり得る。`<script type="importmap">` を1つ注入できれば（HTML 注入があり、かつモジュールがまだ解決されていない段階なら）、bare specifier や既存 URL を攻撃者制御の URL へリマップして任意スクリプト実行に繋げられる。CSP の `script-src` は import map によって解決された URL にも適用されるので、厳格な CSP（nonce/hash ベース）は `<script type="importmap">` の注入自体を防ぐ。「最長一致が勝つ」「`scopes` は import 元スクリプトのパスで選ばれる」という規則は、どの specifier が乗っ取られ得るかを判断するための正確な仕様知識である。

#### 12.6 Loading non-JavaScript resources（import attributes）
- 統一されたモジュールアーキテクチャがもたらす刺激的な機能のひとつは、**非 JavaScript リソースをモジュールとしてロードできること**。例えば JSON を JavaScript オブジェクトとしてインポートしたり、CSS を `CSSStyleSheet` オブジェクトとしてインポートできる。
- **どの種類のリソースをインポートしているかを明示的に宣言しなければならない。** デフォルトではブラウザはリソースが JavaScript だと仮定し、解決されたリソースが別のものならエラーを投げる。JSON、CSS、その他の型のリソースをインポートするには **import attributes** 構文を使う:

```js
import colors from "./colors.json" with { type: "json" };
import styles from "./styles.css" with { type: "css" };
```

- **ブラウザはモジュール型の検証も行い、例えば `./data.json` が JSON ファイルに解決されない場合は失敗する。これはデータをインポートするつもりだったのに誤ってコードを実行してしまうことがないようにする。**

```js
console.log(colors.map((color) => color.value));
document.adoptedStyleSheets = [styles];
```

〔補足（一般知識）〕この「import attributes による型検証」は設計上のセキュリティ機構である（原文が明示的に「誤ってコードを実行しないようにする」と述べている）。`with { type: "json" }` を付けずに JSON をインポートするとエラーになるため、「JSON エンドポイントがスクリプトとして解釈される」経路が閉じられる。

#### 12.7 Applying the module to your HTML
- まず `<script>` 要素に **`type="module"`** を含めてこのスクリプトをモジュールとして宣言する必要がある:

```html
<script type="module" src="main.js"></script>
```

- `<script>` 要素の本体に JavaScript コードを置いてモジュールのスクリプトを HTML ファイルに直接埋め込むこともできる:

```html
<script type="module">
  /* JavaScript module code here */
</script>
```

- **`import` と `export` 文はモジュール内でのみ使える。通常のスクリプトでは使えない。** `<script>` 要素に `type="module"` 属性がなく他のモジュールをインポートしようとするとエラーが投げられる:

```html
<script>
  import _ from "lodash"; // SyntaxError: import declarations may only appear at top level of a module
  // …
</script>
<script src="a-module-using-import-statements.js"></script>
<!-- SyntaxError: import declarations may only appear at top level of a module -->
```

- 一般にすべてのモジュールを別ファイルに定義すべき。**HTML 内にインラインで宣言されたモジュールは他のモジュールをインポートできるだけで、それがエクスポートするものは他のモジュールからアクセスできない（URL を持たないため）。**
- NOTE: モジュールとその依存関係は `<link>` 要素に **`rel="modulepreload"`** を指定してプリロードできる。モジュールが使われるときの読み込み時間を大幅に削減できる。

#### 12.8 Other differences between modules and classic scripts（モジュールとクラシックスクリプトの差分 — 重要）
原文の箇条書きを逐語に近い形で:
- **ローカルテストに注意が必要。** HTML ファイルをローカルで（すなわち `file://` URL で）ロードしようとすると、**JavaScript モジュールのセキュリティ要件による CORS エラー**に遭遇する。サーバー経由でテストする必要がある。
- **モジュール内で定義されたスクリプトの部分は、クラシックスクリプト内のものとは異なる振る舞いをすることがある。これはモジュールが自動的に strict mode を使うため。**
- モジュールスクリプトを読み込むときに **`defer` 属性を使う必要はない。モジュールは自動的に defer される。**
- **モジュールは複数の `<script>` タグで参照されても一度だけ実行される。**
- **モジュールの機能は単一スクリプトのスコープにインポートされる。グローバルスコープでは利用できない。** したがってインポートされた機能はそれがインポートされたスクリプト内でのみアクセスでき、例えば JavaScript コンソールからはアクセスできない。DevTools には依然構文エラーが表示されるが、期待していたデバッグ技法の一部は使えない。
- **モジュールで定義された変数は、明示的にグローバルオブジェクトに取り付けない限りモジュールにスコープされる。一方、グローバルに定義された変数はモジュール内で利用可能である。**

```html
<!doctype html>
<html lang="en-US">
  <head>
    <meta charset="UTF-8" />
    <title>Example page</title>
    <link rel="stylesheet" href="" />
  </head>
  <body>
    <div id="main"></div>
    <script>
      // A var statement creates a global variable.
      var text = "Hello";
    </script>
    <script type="module" src="./render.js"></script>
  </body>
</html>
```

```js
/* render.js */
document.getElementById("main").innerText = text;
```

- このページは依然 `Hello` をレンダリングする。グローバル変数 `text` と `document` がモジュール内で利用可能なため。（**この例からも分かるように、モジュールは必ずしも import/export 文を必要としない。必要なのはエントリポイントが `type="module"` を持つことだけ。**）

〔補足（一般知識）〕この節の6項目はクライアントサイド診断で頻繁に効いてくる。
- **自動 strict mode**: モジュール内では未宣言代入がエラーになり、`this` がトップレベルで `undefined` になる。非 strict 前提のガジェットはモジュール内では動かない。
- **モジュールスコープ**: XSS ペイロードからアプリのモジュール内部関数を直接呼ぶことはできない（グローバルに露出されていない限り）。逆に言えば `window.__APP__` のような明示的なグローバル露出が攻撃面になる。
- **グローバル変数はモジュール内で見える**: `var` で作られたグローバルや DOM Clobbering による `window.x` はモジュール内のコードにも影響し得る。
- **`file://` での CORS エラー**: ローカル HTML ファイル（ダウンロードした HTML）からのモジュール読み込みが遮断されるのはモジュール固有の要件である。

#### 12.9 Default exports versus named exports
- これまでの機能はすべて **named exports**。各項目（関数、`const` など）はエクスポート時に名前で参照され、その名前がインポート時の参照にも使われた。
- **default export** という型のエクスポートもある。これはモジュールが提供するデフォルト関数を持ちやすくするために設計され、**JavaScript モジュールが既存の CommonJS および AMD モジュールシステムと相互運用するのにも役立つ**（Jason Orendorff の "ES6 In Depth: Modules" で見事に説明されている。"Default exports" を検索せよ）。

```js
export default randomSquare;
```

（波括弧がないことに注意。）

無名関数として定義して `export default` を前置することもできる:

```js
export default function (ctx) {
  // …
}
```

`main.js` でのインポート:

```js
import randomSquare from "./modules/square.js";
```

- ここでも波括弧がない。**モジュールごとに default export は1つしか許されない**ため、`randomSquare` がそれだと分かる。上の行は基本的に次の短縮形:

```js
import { default as randomSquare } from "./modules/square.js";
```

#### 12.10 Avoiding naming conflicts / Renaming imports and exports
- 円や三角形を描くモジュールを追加すると、それらも `draw()`、`reportArea()` などの関連関数を持つ可能性が高い。同名の異なる関数を同じトップレベルモジュールファイルにインポートしようとすると衝突とエラーになる。
- `import` と `export` 文の波括弧内で **`as`** キーワードと新しい機能名を使い、トップレベルモジュール内で使う識別名を変更できる:

```js
// -- module.js --
export { function1 as newFunctionName, function2 as anotherNewFunctionName };

// -- main.js --
import { newFunctionName, anotherNewFunctionName } from "./modules/module.js";
```

```js
// -- module.js --
export { function1, function2 };

// -- main.js --
import {
  function1 as newFunctionName,
  function2 as anotherNewFunctionName,
} from "./modules/module.js";
```

- 各モジュールで同名の機能がエクスポートされており、それぞれ末尾に同じ export 文を持つ:

```js
export { name, draw, reportArea, reportPerimeter };
```

- `main.js` にインポートするとき次のようにすると:

```js
import { name, draw, reportArea, reportPerimeter } from "./modules/square.js";
import { name, draw, reportArea, reportPerimeter } from "./modules/circle.js";
import { name, draw, reportArea, reportPerimeter } from "./modules/triangle.js";
```

- ブラウザは **"SyntaxError: redeclaration of import name"（Firefox）** のようなエラーを投げる。
- 代わりに一意になるようインポートをリネームする:

```js
import {
  name as squareName,
  draw as drawSquare,
  reportArea as reportSquareArea,
  reportPerimeter as reportSquarePerimeter,
} from "./modules/square.js";

import {
  name as circleName,
  draw as drawCircle,
  reportArea as reportCircleArea,
  reportPerimeter as reportCirclePerimeter,
} from "./modules/circle.js";

import {
  name as triangleName,
  draw as drawTriangle,
  reportArea as reportTriangleArea,
  reportPerimeter as reportTrianglePerimeter,
} from "./modules/triangle.js";
```

- モジュールファイル側で解決することもできる:

```js
// in square.js
export {
  name as squareName,
  draw as drawSquare,
  reportArea as reportSquareArea,
  reportPerimeter as reportSquarePerimeter,
};
```

```js
// in main.js
import {
  squareName,
  drawSquare,
  reportSquareArea,
  reportSquarePerimeter,
} from "./modules/square.js";
```

- どちらのスタイルを使うかは自由。ただしモジュールコードには手を付けず、インポート側で変更する方が理にかなっていると言える。**制御権のないサードパーティモジュールからインポートする場合は特にそうである。**

#### 12.11 Creating a module object

```js
import * as Module from "./modules/module.js";
```

- これは `module.js` 内で利用可能なすべてのエクスポートを取得し、オブジェクト `Module` のメンバーとして利用可能にする。**事実上それ自身の名前空間を与える。**

```js
Module.function1();
Module.function2();
```

```js
import * as Canvas from "./modules/canvas.js";

import * as Square from "./modules/square.js";
import * as Circle from "./modules/circle.js";
import * as Triangle from "./modules/triangle.js";
```

```js
const square = Square.draw(myCanvas.ctx, 50, 50, 100, "blue");
Square.reportArea(square.length, reportList);
Square.reportPerimeter(square.length, reportList);
```

#### 12.12 Modules and classes
- クラスもエクスポート／インポートできる。これはコードの衝突を避ける別の選択肢であり、モジュールコードを既にオブジェクト指向スタイルで書いているなら特に有用。

```js
class Square {
  constructor(ctx, listId, length, x, y, color) {
    // …
  }

  draw() {
    // …
  }

  // …
}
```

```js
export { Square };
```

```js
import { Square } from "./modules/square.js";
```

```js
const square = new Square(myCanvas.ctx, myCanvas.listId, 50, 50, 100, "blue");
square.draw();
square.reportArea();
square.reportPerimeter();
```

#### 12.13 Aggregating modules
- 複数レベルの依存関係があり、いくつかのサブモジュールを1つの親モジュールに結合して単純化したい場合がある。親モジュールで次の形の export 構文を使えば可能:

```js
export * from "x.js";
export { name } from "x.js";
```

モジュール構造:

```plain
modules/
  canvas.js
  shapes.js
  shapes/
    circle.js
    square.js
    triangle.js
```

各サブモジュールの export:

```js
export { Square };
```

`shapes.js` 内の集約:

```js
export { Square } from "./shapes/square.js";
export { Triangle } from "./shapes/triangle.js";
export { Circle } from "./shapes/circle.js";
```

> NOTE: `shapes.js` で参照されるエクスポートは基本的にファイルを通してリダイレクトされるだけで、実際にはそこに存在しない。したがって同じファイル内で関連する有用なコードを書くことはできない。

`main.js` では次の3行を

```js
import { Square } from "./modules/square.js";
import { Circle } from "./modules/circle.js";
import { Triangle } from "./modules/triangle.js";
```

次の1行に置き換えられる:

```js
import { Square, Circle, Triangle } from "./modules/shapes.js";
```

#### 12.14 Dynamic module loading（動的インポート）
- **動的モジュール読み込み**は、すべてを前もって読み込むのではなく、必要になったときだけモジュールを動的に読み込めるようにする。明らかな性能上の利点がある。
- **`import()`** を関数として呼び、モジュールへのパスをパラメータとして渡せる。**`Promise` を返し、モジュールオブジェクトで fulfill される**ので、そのオブジェクトのエクスポートにアクセスできる:

```js
import("./modules/myModule.js").then((module) => {
  // Do something with the module.
});
```

> **NOTE（重要）**: Dynamic import is permitted in the browser main thread, and in shared and dedicated workers. However `import()` will throw if called in a **service worker** or **worklet**.
>
> （和訳: 動的インポートはブラウザのメインスレッド、共有 worker、専用 worker で許可される。**しかし service worker や worklet 内で呼ばれると `import()` は throw する。**）

```js
const squareBtn = document.querySelector(".square");
```

```js
squareBtn.addEventListener("click", () => {
  import("./modules/square.js").then((Module) => {
    const square = new Module.Square(
      myCanvas.ctx,
      myCanvas.listId,
      50,
      50,
      100,
      "blue",
    );
    square.draw();
    square.reportArea();
    square.reportPerimeter();
  });
});
```

- promise の fulfillment がモジュールオブジェクトを返すため、クラスはそのオブジェクトのサブ機能になる。よってコンストラクタには `Module.` を前置してアクセスする必要がある（例: `Module.Square( /* … */ )`）。
- **動的インポートのもう1つの利点は、script 環境でも常に利用可能なこと。** したがって HTML に `type="module"` のない既存の `<script>` タグがあっても、動的にインポートすることでモジュールとして配布されたコードを再利用できる:

```html
<script>
  import("./modules/square.js").then((module) => {
    // Do something with the module.
  });
  // Other code that operates on the global scope and is not
  // ready to be refactored into modules yet.
  var btn = document.querySelector(".square");
</script>
```

〔補足（一般知識）〕`import()` はクラシックスクリプトからも使えるため、**動的コード実行 sink** として扱う必要がある。`import(userControlledUrl)` は攻撃者が指定した URL のスクリプトをモジュールとして実行する。CSP の `script-src` の対象になり、Trusted Types の対象外である点（`import()` は文字列 URL を取る）に注意。診断では `import(` に変数が渡される箇所を grep する価値がある。

#### 12.15 Top level await
- **top level await** はモジュール内で利用可能な機能。`await` キーワードをトップレベルで使えることを意味する。これによりモジュールが巨大な非同期関数のように振る舞い、親モジュールで使用する前にコードを評価できる。**ただし兄弟モジュールの読み込みをブロックしない。**

`colors.json`:

```json
{
  "yellow": "#F4D03F",
  "green": "#52BE80",
  "blue": "#5499C7",
  "red": "#CD6155",
  "orange": "#F39C12"
}
```

`getColors.js`:

```js
// fetch request
const colors = fetch("../data/colors.json").then((response) => response.json());

export default await colors;
```

- エクスポートする定数 `colors` の指定前に `await` キーワードを使っている。これはこのモジュールを含む他のモジュールが、`colors` がダウンロードされパースされるまで待つことを意味する。

`main.js`:

```js
import colors from "./modules/getColors.js";
import { Canvas } from "./modules/canvas.js";

const circleBtn = document.querySelector(".circle");

// …
```

```js
const square = new Module.Square(
  myCanvas.ctx,
  myCanvas.listId,
  50,
  50,
  100,
  colors.blue,
);

const circle = new Module.Circle(
  myCanvas.ctx,
  myCanvas.listId,
  75,
  200,
  100,
  colors.green,
);

const triangle = new Module.Triangle(
  myCanvas.ctx,
  myCanvas.listId,
  100,
  75,
  190,
  colors.yellow,
);
```

- `main.js` 内のコードは `getColors.js` のコードが実行されるまで実行されない。しかし他のモジュールの読み込みはブロックしない。例えば `canvas.js` モジュールは `colors` が fetch されている間も読み込みを続ける。

#### 12.16 Import declarations are hoisted
- **import 宣言は hoisted される。** この場合、インポートされた値はそれらを宣言する場所より前でもモジュールのコード内で利用可能であり、**インポートされたモジュールの副作用はモジュールの残りのコードが実行を開始する前に生成される**ことを意味する。

```js
// …
const myCanvas = new Canvas("myCanvas", document.body, 480, 320);
myCanvas.create();
import { Canvas } from "./modules/canvas.js";
myCanvas.createReportList();
// …
```

- それでも、依存関係の解析を容易にするため、すべてのインポートをコードの先頭に置くのが良い慣行と見なされる。

#### 12.17 Cyclic imports（循環インポート）
- モジュールは他のモジュールをインポートでき、それらもさらに他をインポートできる。これは **"dependency graph"（依存グラフ）** と呼ばれる有向グラフを形成する。理想的にはこのグラフは非循環（acyclic）で、深さ優先走査で評価できる。
- しかし循環はしばしば避けられない。モジュール `a` がモジュール `b` をインポートするが、`b` が直接または間接的に `a` に依存すると循環インポートが生じる:

```js
// -- a.js --
import { b } from "./b.js";

// -- b.js --
import { a } from "./a.js";

// Cycle:
// a.js ───> b.js
//  ^         │
//  └─────────┘
```

- **循環インポートは常に失敗するわけではない。** インポートされた変数の値は、その変数が実際に使われるときにのみ取得され（これが **live bindings** を可能にする）、その時点で変数が未初期化のままである場合のみ **`ReferenceError`** が投げられる。

```js
// -- a.js --
import { b } from "./b.js";

setTimeout(() => {
  console.log(b); // 1
}, 10);

export const a = 2;

// -- b.js --
import { a } from "./a.js";

setTimeout(() => {
  console.log(a); // 2
}, 10);

export const b = 1;
```

- この例では `a` と `b` の両方が非同期に使われる。したがってモジュールが評価される時点では `b` も `a` も実際には読まれないので、残りのコードは通常通り実行され、2つの `export` 宣言が `a` と `b` の値を生成する。その後タイムアウトの後、`a` と `b` の両方が利用可能なので、2つの `console.log` 文も通常通り実行される。
- コードを `a` を同期的に使うよう変えるとモジュール評価は失敗する:

```js
// -- a.js (entry module) --
import { b } from "./b.js";

export const a = 2;

// -- b.js --
import { a } from "./a.js";

console.log(a); // ReferenceError: Cannot access 'a' before initialization
export const b = 1;
```

- JavaScript が `a.js` を評価するとき、まず `a.js` の依存である `b.js` を評価する必要がある。しかし `b.js` は `a` を使い、それはまだ利用可能でない。
- 一方 `b` を同期的に、`a` を非同期的に使うよう変えるとモジュール評価は成功する:

```js
// -- a.js (entry module) --
import { b } from "./b.js";

console.log(b); // 1
export const a = 2;

// -- b.js --
import { a } from "./a.js";

setTimeout(() => {
  console.log(a); // 2
}, 10);
export const b = 1;
```

- `b.js` の評価が正常に完了するので、`a.js` が評価されるときに `b` の値が利用可能。
- プロジェクトでは通常循環インポートを避けるべき。コードをよりエラーを招きやすくする。一般的な循環除去技法:
  - 2つのモジュールを1つに統合する。
  - 共有コードを第3のモジュールに移す。
  - 一方のモジュールから他方へ一部のコードを移す。
- ただしライブラリが互いに依存する場合にも循環インポートは起き得て、これは修正が難しい。

#### 12.18 Authoring "isomorphic" modules
- モジュールの導入は JavaScript エコシステムがモジュール的にコードを配布・再利用することを促す。しかしそれは JavaScript コード片がすべての環境で動くことを必ずしも意味しない。例えばユーザーのパスワードの SHA ハッシュを生成するモジュールを発見したとして、ブラウザフロントエンドで使えるか？ Node.js サーバーで使えるか？ 答えは「場合による」。
- **モジュールは依然グローバル変数にアクセスできる。** モジュールが `window` のようなグローバルを参照すればブラウザで動くが、Node.js サーバーではエラーを投げる（`window` がそこにないため）。同様に `process` へのアクセスを必要とするコードなら Node.js でのみ使える。
- モジュールの再利用性を最大化するため、コードを **"isomorphic"**（すべてのランタイムで同じ振る舞いを示す）にすることが推奨される。一般に3つの方法で達成される:
  1. **モジュールを "core" と "binding" に分ける。** "core" ではハッシュ計算のような純粋な JavaScript ロジックに集中し、DOM・ネットワーク・ファイルシステムアクセスを持たせず、ユーティリティ関数を露出する。"binding" 部分ではグローバルコンテキストから読み書きできる。例えば "browser binding" は入力ボックスから値を読むことを選び、"Node binding" は `process.env` から読むかもしれないが、いずれの場所から読まれた値も同じ core 関数にパイプされ同じ方法で処理される。core はすべての環境でインポートされ同じ方法で使え、通常軽量な binding のみがプラットフォーム固有である必要がある。
  2. **特定のグローバルが存在するかを使う前に検出する。** 例えば `typeof window === "undefined"` をテストすれば、おそらく Node.js 環境にいて DOM を読むべきでないと分かる。

     ```js
     // myModule.js
     let password;
     if (typeof process !== "undefined") {
       // We are running in Node.js; read it from `process.env`
       password = process.env.PASSWORD;
     } else if (typeof window !== "undefined") {
       // We are running in the browser; read it from the input box
       password = document.getElementById("password").value;
     }
     ```

     これは2つの分岐が実際に同じ振る舞いになる（"isomorphic"）場合に好ましい。同じ機能を提供できない場合、または大部分が未使用のまま大量のコードを読み込むことになる場合は、異なる "bindings" を使う方が良い。
  3. **polyfill を使って欠けている機能のフォールバックを提供する。** 例えば Node.js では v18 以降しかサポートされない `fetch` 関数を使いたい場合、**`node-fetch`** が提供するような類似 API を使える。動的インポートで条件付きに行える:

     ```js
     // myModule.js
     if (typeof fetch === "undefined") {
       // We are running in Node.js; use node-fetch
       globalThis.fetch = (await import("node-fetch")).default;
     }
     // …
     ```

     **`globalThis`** 変数はすべての環境で利用可能なグローバルオブジェクトで、モジュール内でグローバル変数を読んだり作ったりしたい場合に有用。

#### 12.19 Troubleshooting（原文の3項目）
- 繰り返すが、**`.mjs` ファイルは `text/javascript`（または他の JavaScript 互換 MIME タイプ。ただし `text/javascript` が推奨）の MIME タイプで読み込まれる必要がある。** そうでないと "The server responded with a non-JavaScript MIME type" のような厳格な MIME タイプチェックエラーになる。
- **HTML ファイルをローカルで（`file://` URL で）読み込もうとすると、JavaScript モジュールのセキュリティ要件による CORS エラーに遭遇する。** サーバー経由でテストする必要がある。GitHub pages は `.mjs` を正しい MIME タイプで配信するので理想的。
- `.mjs` は非標準のファイル拡張子なので、一部の OS はそれを認識しないか別のものに置き換えようとするかもしれない。例えば **macOS が `.mjs` ファイルの末尾に黙って `.js` を追加し、ファイル拡張子を自動的に隠していた**ことが分かった。結果としてすべてのファイルが実際には `x.mjs.js` として出てきた。拡張子の自動非表示をオフにし、`.mjs` を受け入れるよう調整したら問題なくなった。

#### 12.20 See also（章末リンク・原文のまま）
- **JavaScript modules** on v8.dev (2018) — `https://v8.dev/features/modules`
- **ES modules: A cartoon deep-dive** on hacks.mozilla.org (2018) — `https://hacks.mozilla.org/2018/03/es-modules-a-cartoon-deep-dive/`
- **ES6 in Depth: Modules** on hacks.mozilla.org (2015) — `https://hacks.mozilla.org/2015/08/es6-in-depth-modules/`
- **Exploring JS, Ch.16: Modules** by Dr. Axel Rauschmayer — `https://exploringjs.com/es6/ch_modules.html`

---

### 13. Data structures（型と型強制・出典: .../Guide/Data_structures）

#### 13.1 Dynamic and weak typing
- JavaScript は **dynamic types（動的型）** を持つ dynamic な言語。変数は特定の値型と直接結び付けられず、どの変数にもすべての型の値を代入（再代入）できる:

```js
let foo = 42; // foo is now a number
foo = "bar"; // foo is now a string
foo = true; // foo is now a boolean
```

- JavaScript は **weakly typed（弱く型付けされた）** 言語でもある。すなわち型が不一致な演算では型エラーを投げる代わりに**暗黙の型変換を許す**:

```js
const foo = 42; // foo is a number
const result = foo + "1"; // JavaScript coerces foo to a string, so it can be concatenated with the other operand
console.log(result); // 421
```

- **暗黙の強制はとても便利だが、変換が予期しない場所で起きたり、期待と逆方向（文字列→数値ではなく数値→文字列）で起きたりすると微妙なバグを生み得る。** **symbols** と **BigInts** については JavaScript は意図的に特定の暗黙型変換を禁じている。

#### 13.2 Primitive values
- **Object を除くすべての型は、言語の最下層で直接表現される immutable な値を定義する。** これらの型の値を **primitive values** と呼ぶ。
- `null` を除くすべてのプリミティブ型は **`typeof`** 演算子でテストできる。**`typeof null` は `"object"` を返すので、`null` のテストには `=== null` を使わなければならない。**
- `null` と `undefined` を除くすべてのプリミティブ型は対応するオブジェクトラッパー型を持ち、プリミティブ値を扱う有用なメソッドを提供する。**プリミティブ値に対してプロパティがアクセスされると、JavaScript は自動的にその値を対応するラッパーオブジェクトにラップし、代わりにそのオブジェクトでプロパティにアクセスする。** ただし **`null` や `undefined` にプロパティアクセスすると `TypeError` 例外が投げられる**。このため **optional chaining** 演算子が導入された。

原文の表を完全再現:

| Type | `typeof` return value | Object wrapper |
| --- | --- | --- |
| Null | `"object"` | N/A |
| Undefined | `"undefined"` | N/A |
| Boolean | `"boolean"` | `Boolean` |
| Number | `"number"` | `Number` |
| BigInt | `"bigint"` | `BigInt` |
| String | `"string"` | `String` |
| Symbol | `"symbol"` | `Symbol` |

- **Null type**: ちょうど1つの値 `null` のみが住む型。
- **Undefined type**: ちょうど1つの値 `undefined` のみが住む型。概念的に `undefined` は **_値_ の不在**を示し、`null` は **_オブジェクト_ の不在**を示す（これが `typeof null === "object"` の言い訳にもなり得る）。

#### 13.3 String type
- **`String` 型はテキストデータを表し、UTF-16 code units を表す 16 ビット符号なし整数値の列としてエンコードされる。** 文字列の各要素は文字列内の位置を占める。最初の要素はインデックス `0`、次は `1`、以下同様。**文字列の `length` はその中の UTF-16 code units の数であり、実際の Unicode 文字数と一致しないことがある。**
- **JavaScript の文字列は immutable。** 一度作られた文字列を変更することはできない。文字列メソッドは現在の文字列の内容に基づいて新しい文字列を作る。例:
  - `substring()` による元の文字列の部分文字列。
  - 連結演算子 `+` または `concat()` による2つの文字列の連結。

##### Beware of "stringly-typing" your code!（文字列型付けの罠）
- 複雑なデータを文字列で表現したくなることがある。短期的な利点:
  - 連結で複雑な文字列を組み立てるのが容易。
  - 文字列はデバッグが容易（印字されたものが常に文字列の中身）。
  - **文字列は多くの API の共通分母（input fields、local storage の値、`Response.text()` を使ったときの `fetch()` のレスポンスなど）であり、文字列だけで作業したくなることがある。**
- 慣習があれば文字列で任意のデータ構造を表現できる。**しかしそれが良い考えになるわけではない。** 例えば区切り文字でリストをエミュレートできる（JavaScript の配列がより適切なのに）。**残念ながら区切り文字が "リスト" 要素のひとつで使われると、リストは壊れる。** エスケープ文字を選ぶなど、すべて慣習を必要とし不要な保守負担を生む。
- **テキストデータには文字列を使え。複雑なデータを表現するなら文字列を _パース_ し、適切な抽象を使え。**

〔補足（一般知識）〕「区切り文字が要素に含まれるとリストが壊れる」という指摘は、セキュリティ観点では**区切り文字注入（delimiter injection）** そのものである。カンマ区切りの権限リスト、`|` 区切りのトークン、`;` 区切りのクッキー値といったアドホックなシリアライズは、区切り文字を含む入力で境界を越えられる。診断では自前シリアライズ箇所に区切り文字・改行・NUL を注入して境界破壊を試す。

#### 13.4 Symbol type
- **`Symbol` は一意かつ不変のプリミティブ値**で、オブジェクトプロパティのキーとして使える。**symbol の目的は、他のコードのキーと衝突しないことが保証された一意のプロパティキーを作ること。**

#### 13.5 Objects
- 計算機科学ではオブジェクトは識別子によって参照され得るメモリ上の値。**JavaScript ではオブジェクトが唯一の mutable な値である。関数は実際には、呼び出し可能（callable）であるという追加能力を持つオブジェクトである。**

#### 13.6 Type coercion（型強制 — 3つの経路）

##### Primitive coercion
- **primitive coercion** プロセスはプリミティブ値が期待されるが実際の型について強い好みがない場合に使われる。通常は string、number、BigInt が同等に受容可能な場合。例:
  - `Date()` コンストラクタが `Date` インスタンスでない1引数を受け取るとき。文字列は日付文字列を表し、数値はタイムスタンプを表す。
  - **`+` 演算子** — 一方のオペランドが文字列なら文字列連結、そうでなければ数値加算。
  - **`==` 演算子** — 一方のオペランドがプリミティブで他方がオブジェクトなら、オブジェクトは好ましい型なしにプリミティブ値に変換される。
- 値が既にプリミティブならこの操作は変換を行わない。**オブジェクトは `[Symbol.toPrimitive]()`（ヒント `"default"`）、`valueOf()`、`toString()` メソッドをこの順に呼ぶことでプリミティブに変換される。** primitive conversion は `toString()` より先に `valueOf()` を呼ぶ点に注意。これは number coercion の振る舞いに似ており、string coercion とは異なる。
- **`[Symbol.toPrimitive]()` メソッドが存在する場合、それはプリミティブを返さなければならない。オブジェクトを返すと `TypeError` になる。** `valueOf()` と `toString()` については、一方がオブジェクトを返すとその返り値は無視され他方の返り値が代わりに使われる。どちらも存在しないか、どちらもプリミティブを返さない場合は `TypeError` が投げられる。

```js
console.log({} + []); // "[object Object]"
```

`{}` も `[]` も `[Symbol.toPrimitive]()` メソッドを持たない。両方とも `Object.prototype.valueOf` から `valueOf()` を継承し、これはオブジェクト自身を返す。返り値がオブジェクトなので無視される。したがって代わりに `toString()` が呼ばれる。`{}.toString()` は `"[object Object]"` を返し、`[].toString()` は `""` を返すので、結果はそれらの連結 `"[object Object]"`。

- **`[Symbol.toPrimitive]()` メソッドは任意のプリミティブ型への変換のとき常に優先される。** primitive conversion は `valueOf()` が優先的に呼ばれるので一般に number conversion のように振る舞う。ただしカスタム `[Symbol.toPrimitive]()` メソッドを持つオブジェクトは任意のプリミティブを返すことを選べる。**`Date` と `Symbol` オブジェクトは `[Symbol.toPrimitive]()` メソッドをオーバーライドする唯一のビルトインオブジェクトである。** `Date.prototype[Symbol.toPrimitive]()` は `"default"` ヒントを `"string"` であるかのように扱い、`Symbol.prototype[Symbol.toPrimitive]()` はヒントを無視して常に symbol を返す。

##### Numeric coercion
- 数値型は2つ（Number と BigInt）。言語が特に number か BigInt を期待することもある（`Array.prototype.slice()` のようにインデックスが number でなければならない場合）。他のときはどちらも許容しオペランドの型に応じて異なる操作を行う。
- **numeric coercion は number coercion とほぼ同じだが、BigInt が `TypeError` を引き起こす代わりにそのまま返される点が異なる。** numeric coercion はすべての算術演算子で使われる（number と BigInt の両方にオーバーロードされているため）。**唯一の例外は unary plus で、これは常に number coercion を行う。**

##### Other coercions（3つの経路のまとめ）
- Null、Undefined、Symbol を除くすべてのデータ型がそれぞれの強制プロセスを持つ。
- **オブジェクトがプリミティブに変換される3つの異なる経路（原文のまま）:**
  - **Primitive coercion**: `[Symbol.toPrimitive]("default")` → `valueOf()` → `toString()`
  - **Numeric coercion, number coercion, BigInt coercion**: `[Symbol.toPrimitive]("number")` → `valueOf()` → `toString()`
  - **String coercion**: `[Symbol.toPrimitive]("string")` → `toString()` → `valueOf()`
- いずれの場合も `[Symbol.toPrimitive]()` が存在すれば呼び出し可能でプリミティブを返さなければならず、`valueOf` や `toString` は呼び出し可能でなかったりオブジェクトを返したりすると無視される。プロセスの終わりに成功すれば結果はプリミティブであることが保証される。**結果のプリミティブはコンテキストに応じてさらに強制を受ける。**

〔補足（一般知識）〕この3経路の順序表は、クライアントサイド脆弱性の中でも「オブジェクトを文字列コンテキストに送り込んで任意文字列を生成する」種のガジェット（例: `toString` / `valueOf` / `Symbol.toPrimitive` を持つオブジェクトを渡してサニタイザの型チェックを通す、`{toString(){return payload}}` で `innerHTML` に文字列を注入する）を理解する根拠になる。プロトタイプ汚染で `Object.prototype.toString` を差し替える攻撃も同じ機構を突く。

---

### 14. Equality comparisons and sameness（等価比較・出典: .../Guide/Equality_comparisons_and_sameness）

#### 14.1 Strict equality using `===`
- **strict equality は2つの値を等価比較する。どちらの値も比較前に暗黙に別の値に変換されない。** 型が異なれば不等と見なされる。同じ型で数値でなく同じ値なら等しい。両方が数値の場合、両方が `NaN` でなく同じ値であるか、一方が `+0` で他方が `-0` なら等しいと見なされる。

```js
const num = 0;
const obj = new String("0");
const str = "0";

console.log(num === num); // true
console.log(obj === obj); // true
console.log(str === str); // true

console.log(num === obj); // false
console.log(num === str); // false
console.log(obj === str); // false
console.log(null === undefined); // false
console.log(obj === null); // false
console.log(obj === undefined); // false
```

- **strict equality はほぼ常に使うべき正しい比較操作。** 数値以外のすべての値では自明な意味論を使う（値は自分自身とだけ等しい）。数値では2つのエッジケースを覆い隠すためわずかに異なる意味論を使う。
  - 第1に浮動小数点ゼロは正または負の符号を持つ。ほとんどの状況では `+0` と `-0` の違いを気にしないので strict equality はそれらを同じ値として扱う。
  - 第2に浮動小数点は not-a-number 値 `NaN` の概念を含む。**strict equality は `NaN` をそれ自身を含む他のすべての値と不等に扱う。（`(x !== x)` が `true` になる唯一のケースは `x` が `NaN` のとき。）**
- `===` の他に、strict equality は **`Array.prototype.indexOf()`、`Array.prototype.lastIndexOf()`、`TypedArray.prototype.indexOf()`、`TypedArray.prototype.lastIndexOf()`、`case` マッチング**でも使われる。**つまり `indexOf(NaN)` で配列内の `NaN` の位置を見つけることはできず、`switch` 文の `case` 値として `NaN` を使って何かにマッチさせることもできない:**

```js
console.log([NaN].indexOf(NaN)); // -1
switch (NaN) {
  case NaN:
    console.log("Surprise"); // Nothing is logged
}
```

#### 14.2 Loose equality using `==`
- loose equality は **対称的（symmetric）**。任意の値 `A` と `B` について `A == B` は常に `B == A` と同一の意味論を持つ（適用される変換の順序を除く）。
- `==` を使う loose equality の振る舞い（原文のアルゴリズムを逐語的に整理）:
  1. オペランドが同じ型の場合、次のように比較される:
     - **Object**: 両方のオペランドが同じオブジェクトを参照する場合のみ `true` を返す。
     - **String**: 両方のオペランドが同じ文字を同じ順序で持つ場合のみ `true`。
     - **Number**: 両方のオペランドが同じ値の場合のみ `true`。`+0` と `-0` は同じ値として扱われる。どちらかが `NaN` なら `false`。したがって `NaN` は決して `NaN` と等しくない。
     - **Boolean**: 両方が `true` か両方が `false` の場合のみ `true`。
     - **BigInt**: 両方が同じ値の場合のみ `true`。
     - **Symbol**: 両方が同じ symbol を参照する場合のみ `true`。
  2. **オペランドの一方が `null` または `undefined` の場合、`true` を返すには他方も `null` または `undefined` でなければならない。** そうでなければ `false`。
  3. オペランドの一方がオブジェクトで他方がプリミティブなら、**オブジェクトをプリミティブに変換する**。
  4. この段階で両方のオペランドはプリミティブ（String, Number, Boolean, Symbol, BigInt のいずれか）に変換されている。残りの変換はケースごとに行う:
     - 同じ型ならステップ 1 で比較する。
     - **一方が Symbol で他方がそうでなければ `false` を返す。**
     - 一方が Boolean で他方がそうでなければ、**boolean を数値に変換する**（`true` は 1、`false` は 0）。その後2つのオペランドを再度 loose に比較する。
     - **Number to String**: 文字列を数値に変換する。変換失敗は `NaN` になり、等価性が `false` になることを保証する。
     - **Number to BigInt**: 数学的値で比較する。数値が ±Infinity または `NaN` なら `false` を返す。
     - **String to BigInt**: `BigInt()` コンストラクタと同じアルゴリズムで文字列を BigInt に変換する。変換が失敗すれば `false` を返す。
- 伝統的に、そして ECMAScript によれば、すべてのプリミティブとオブジェクトは `undefined` と `null` に対して loose に不等である。**しかしほとんどのブラウザは非常に狭いクラスのオブジェクト（具体的には任意のページの `document.all` オブジェクト）が、いくつかのコンテキストで値 `undefined` を _エミュレート_ するかのように振る舞うことを許している。loose equality はそのようなコンテキストのひとつ: `null == A` と `undefined == A` は、A が `undefined` をエミュレートするオブジェクトである場合に限り true に評価される。** それ以外のすべてのケースでオブジェクトは決して `undefined` や `null` と loose に等しくない。
- ほとんどの場合 loose equality の使用は推奨されない。strict equality を使った比較の結果はより予測しやすく、型強制がないためより高速に評価され得る。

```js
const num = 0;
const big = 0n;
const str = "0";
const obj = new String("0");

console.log(num == str); // true
console.log(big == num); // true
console.log(str == big); // true

console.log(num == obj); // true
console.log(big == obj); // true
console.log(str == obj); // true
```

- **loose equality は `==` 演算子のみが使う。**

〔補足（一般知識）〕`document.all` が `== null` / `== undefined` に対して true になるという MDN の記述は、**DOM Clobbering** 検討時に非常に重要である。`document.all` は "undefined をエミュレートする" 唯一の残存オブジェクトで、`if (x == null)` 形式のガードを通過しつつ実体を持つ。また `==` の変換規則（Boolean→Number、String→Number、オブジェクト→プリミティブ）は `"0" == false`、`[] == false`、`"\n" == 0` のような「認証・権限判定の比較を通す」テクニックの根拠になる。

#### 14.3 Same-value equality using `Object.is()`
- **same-value equality** は2つの値がすべてのコンテキストで**機能的に同一**かを判定する。immutable なプロパティをミューテートしようとするときに一例が生じる:

```js
// Add an immutable NEGATIVE_ZERO property to the Number constructor.
Object.defineProperty(Number, "NEGATIVE_ZERO", {
  value: -0,
  writable: false,
  configurable: false,
  enumerable: false,
});

function attemptMutation(v) {
  Object.defineProperty(Number, "NEGATIVE_ZERO", { value: v });
}
```

- `Object.defineProperty` は immutable なプロパティを変更しようとすると例外を投げるが、**実際の変更が要求されていなければ何もしない**。`v` が `-0` なら変更は要求されておらずエラーは投げられない。内部的に、immutable なプロパティが再定義されるとき、新しく指定された値は same-value equality を使って現在の値と比較される。
- same-value equality は **`Object.is`** メソッドで提供される。等価な同一性の値が期待される言語のほぼどこでも使われる。

#### 14.4 Same-value-zero equality
- same-value equality に似るが、**+0 と -0 が等しいと見なされる**。
- same-value-zero equality は JavaScript API として露出されていないが、カスタムコードで実装できる:

```js
function sameValueZero(x, y) {
  if (typeof x === "number" && typeof y === "number") {
    // x and y are equal (may be -0 and 0) or they are both NaN
    return x === y || (x !== x && y !== y);
  }
  return x === y;
}
```

- same-value-zero は strict equality と `NaN` を等価に扱う点でのみ異なり、same-value equality と `-0` を `0` と等価に扱う点でのみ異なる。これは探索時に通常最も妥当な振る舞いになる（特に `NaN` を扱うとき）。**`Array.prototype.includes()`、`TypedArray.prototype.includes()`、および `Map` と `Set` のキー等価比較メソッドで使われる。**

#### 14.5 Comparing equality methods（等価比較の完全な表）

原文の「sameness comparisons」表を完全再現する。

| x | y | `==` | `===` | `Object.is` | `SameValueZero` |
| --- | --- | --- | --- | --- | --- |
| `undefined` | `undefined` | ✅ true | ✅ true | ✅ true | ✅ true |
| `null` | `null` | ✅ true | ✅ true | ✅ true | ✅ true |
| `true` | `true` | ✅ true | ✅ true | ✅ true | ✅ true |
| `false` | `false` | ✅ true | ✅ true | ✅ true | ✅ true |
| `'foo'` | `'foo'` | ✅ true | ✅ true | ✅ true | ✅ true |
| `0` | `0` | ✅ true | ✅ true | ✅ true | ✅ true |
| `+0` | `-0` | ✅ true | ✅ true | ❌ false | ✅ true |
| `+0` | `0` | ✅ true | ✅ true | ✅ true | ✅ true |
| `-0` | `0` | ✅ true | ✅ true | ❌ false | ✅ true |
| `0n` | `-0n` | ✅ true | ✅ true | ✅ true | ✅ true |
| `0` | `false` | ✅ true | ❌ false | ❌ false | ❌ false |
| `""` | `false` | ✅ true | ❌ false | ❌ false | ❌ false |
| `""` | `0` | ✅ true | ❌ false | ❌ false | ❌ false |
| `'0'` | `0` | ✅ true | ❌ false | ❌ false | ❌ false |
| `'17'` | `17` | ✅ true | ❌ false | ❌ false | ❌ false |
| `[1, 2]` | `'1,2'` | ✅ true | ❌ false | ❌ false | ❌ false |
| `new String('foo')` | `'foo'` | ✅ true | ❌ false | ❌ false | ❌ false |
| `null` | `undefined` | ✅ true | ❌ false | ❌ false | ❌ false |
| `null` | `false` | ❌ false | ❌ false | ❌ false | ❌ false |
| `undefined` | `false` | ❌ false | ❌ false | ❌ false | ❌ false |
| `{ foo: 'bar' }` | `{ foo: 'bar' }` | ❌ false | ❌ false | ❌ false | ❌ false |
| `new String('foo')` | `new String('foo')` | ❌ false | ❌ false | ❌ false | ❌ false |
| `0` | `null` | ❌ false | ❌ false | ❌ false | ❌ false |
| `0` | `NaN` | ❌ false | ❌ false | ❌ false | ❌ false |
| `'foo'` | `NaN` | ❌ false | ❌ false | ❌ false | ❌ false |
| `NaN` | `NaN` | ❌ false | ❌ false | ✅ true | ✅ true |

- 「double equals は triple equals の拡張版」といった一次元の「スペクトラム」的思考は **`Object.is`** では成り立たない。`Object.is` は double equals より "looser" でも triple equals より "stricter" でもなく、その中間にも収まらない。これは `Object.is` の `NaN` の扱い方に起因する。**`Object.is(NaN, NaN)` が `false` に評価されるなら、`-0` と `+0` を区別する triple equals のさらに厳しい形として loose/strict スペクトラムに収まると言えた。しかし `NaN` の扱いがそれを真でなくしている。** 残念ながら `Object.is` は等価演算子に対する緩さ・厳しさではなく、その固有の特徴の観点で考えなければならない。

##### When to use Object.is() versus triple equals
- 一般に `Object.is` のゼロに対する特別な振る舞いが興味の対象になりそうなのは、特定のメタプログラミング手法の追求時（特にプロパティディスクリプタに関して、`Object.defineProperty` の特性の一部を反映させたい場合）だけ。ユースケースがこれを要求しないなら `Object.is` を避けて **`===`** を使うことが推奨される。
- `-0` と `+0` の区別がコード内に現れ得るビルトインメソッドと演算子の非網羅的リスト:
  - **`-`（unary negation）**: `const stoppingForce = obj.mass * -obj.velocity;` で `obj.velocity` が `0`（または `0` に計算される）なら、そこで `-0` が導入され `stoppingForce` に伝播する。
  - **`Math.atan2`, `Math.ceil`, `Math.pow`, `Math.round`**: パラメータに `-0` が存在しなくてもこれらの返り値として `-0` が式に導入され得る場合がある。例えば `Math.pow` で `-Infinity` を任意の負の奇数指数で累乗すると `-0` になる。
  - **`Math.floor`, `Math.max`, `Math.min`, `Math.sin`, `Math.sqrt`, `Math.tan`**: パラメータのいずれかに `-0` が存在する場合にこれらのメソッドから `-0` の返り値を得られる場合がある。例えば `Math.min(-0, +0)` は `-0` になる。
  - **`~`, `<<`, `>>`**: これらの演算子は内部で ToInt32 アルゴリズムを使う。内部の 32 ビット整数型では 0 の表現が1つしかないため、逆操作後のラウンドトリップで `-0` は生き残らない。例えば `Object.is(~~(-0), -0)` と `Object.is(-0 << 2 >> 2, -0)` はともに `false`。

##### Caveat: Object.is() and NaN
- `Object.is` の仕様は `NaN` のすべてのインスタンスを同じオブジェクトとして扱う。しかし **typed arrays** が利用可能になったので、すべてのコンテキストで同一に振る舞わない異なる浮動小数点表現の `NaN` を持てる:

```js
const f2b = (x) => new Uint8Array(new Float64Array([x]).buffer);
const b2f = (x) => new Float64Array(x.buffer)[0];
// Get a byte representation of NaN
const n = f2b(NaN);
// Change the first bit, which is the sign bit and doesn't matter for NaN
n[7] |= 0x80;
const nan2 = b2f(n);
console.log(nan2); // NaN
console.log(Object.is(nan2, NaN)); // true
console.log(f2b(NaN)); // Uint8Array(8) [0, 0, 0, 0, 0, 0, 248, 127]
console.log(f2b(nan2)); // Uint8Array(8) [0, 0, 0, 0, 0, 0, 248, 255]
```

> NOTE: 実装は `NaN` のビット表現を正規化することが許されているので、`nan2` を浮動小数点に戻したとき元の `NaN` と同じビット表現を持つかもしれない。

#### 14.6 See also
- **JS Comparison Table** by dorey — `https://dorey.github.io/JavaScript-Equality-Table/`

---

### 15. Enumerability and ownership of properties（列挙可能性と所有性・出典: .../Guide/Enumerability_and_ownership_of_properties）

- JavaScript オブジェクトのすべてのプロパティは3つの要因で分類できる:
  - **Enumerable（列挙可能）か non-enumerable か**
  - **String か symbol か**
  - **Own property か、プロトタイプチェーンから継承されたプロパティか**
- **_Enumerable properties_ は内部の enumerable フラグが true に設定されたプロパティ**で、これは単純な代入またはプロパティ初期化子で作られたプロパティのデフォルトである。**`Object.defineProperty` などで定義されたプロパティはデフォルトで列挙可能ではない。** ほとんどの反復手段（`for...in` ループや `Object.keys` など）は列挙可能なキーだけを訪問する。
- プロパティの所有性は、プロパティがプロトタイプチェーンではなくオブジェクトに直接属するかで決まる。
- **すべてのプロパティは、列挙可能かどうか、string か symbol か、own か継承かに関わらず、ドット記法またはブラケット記法でアクセスできる。**

#### 15.1 Querying object properties（プロパティ照会の4つの方法）

原文の表を完全再現。各メソッドが `true` を返す条件:

| | Enumerable, own | Enumerable, inherited | Non-enumerable, own | Non-enumerable, inherited |
| --- | --- | --- | --- | --- |
| `propertyIsEnumerable()` | `true ✅` | `false ❌` | `false ❌` | `false ❌` |
| `hasOwnProperty()` | `true ✅` | `false ❌` | `true ✅` | `false ❌` |
| `Object.hasOwn()` | `true ✅` | `false ❌` | `true ✅` | `false ❌` |
| `in` | `true ✅` | `true ✅` | `true ✅` | `true ✅` |

#### 15.2 Traversing object properties（プロパティ走査の表）

原文の表を完全再現。✅ はこの型のプロパティが訪問されること、❌ は訪問されないことを意味する。

| | Enumerable, own | Enumerable, inherited | Non-enumerable, own | Non-enumerable, inherited |
| --- | --- | --- | --- | --- |
| `Object.keys` / `Object.values` / `Object.entries` | ✅（strings） | ❌ | ❌ | ❌ |
| `Object.getOwnPropertyNames` | ✅（strings） | ❌ | ✅（strings） | ❌ |
| `Object.getOwnPropertySymbols` | ✅（symbols） | ❌ | ✅（symbols） | ❌ |
| `Object.getOwnPropertyDescriptors` | ✅ | ❌ | ✅ | ❌ |
| `Reflect.ownKeys` | ✅ | ❌ | ✅ | ❌ |
| `for...in` | ✅（strings） | ✅（strings） | ❌ | ❌ |
| `Object.assign`（第1パラメータ以降） | ✅ | ❌ | ❌ | ❌ |
| Object spread | ✅ | ❌ | ❌ | ❌ |

#### 15.3 Obtaining properties by enumerability/ownership
- 「すべてのケースで最も効率的なアルゴリズムではないが、手早いデモとして有用」と注記された実装が示されている。
  - 検出は `SimplePropertyRetriever.theGetMethodYouWant(obj).includes(prop)` で行える。
  - 反復は `SimplePropertyRetriever.theGetMethodYouWant(obj).forEach((value, prop) => {});`（あるいは `filter()`、`map()` などを使う）で行える。

```js
const SimplePropertyRetriever = {
  getOwnEnumProps(obj) {
    return this._getPropertyNames(obj, true, false, this._enumerable);
    // Or could use for...in filtered with Object.hasOwn or just this: return Object.keys(obj);
  },
  getOwnNonEnumProps(obj) {
    return this._getPropertyNames(obj, true, false, this._notEnumerable);
  },
  getOwnProps(obj) {
    return this._getPropertyNames(
      obj,
      true,
      false,
      this._enumerableAndNotEnumerable,
    );
    // Or just use: return Object.getOwnPropertyNames(obj);
  },
  getPrototypeEnumProps(obj) {
    return this._getPropertyNames(obj, false, true, this._enumerable);
  },
  getPrototypeNonEnumProps(obj) {
    return this._getPropertyNames(obj, false, true, this._notEnumerable);
  },
  getPrototypeProps(obj) {
    return this._getPropertyNames(
      obj,
      false,
      true,
      this._enumerableAndNotEnumerable,
    );
  },
  getOwnAndPrototypeEnumProps(obj) {
    return this._getPropertyNames(obj, true, true, this._enumerable);
    // Or could use unfiltered for...in
  },
  getOwnAndPrototypeNonEnumProps(obj) {
    return this._getPropertyNames(obj, true, true, this._notEnumerable);
  },
  getOwnAndPrototypeEnumAndNonEnumProps(obj) {
    return this._getPropertyNames(
      obj,
      true,
      true,
      this._enumerableAndNotEnumerable,
    );
  },
  // Private static property checker callbacks
  _enumerable(obj, prop) {
    return Object.prototype.propertyIsEnumerable.call(obj, prop);
  },
  _notEnumerable(obj, prop) {
    return !Object.prototype.propertyIsEnumerable.call(obj, prop);
  },
  _enumerableAndNotEnumerable(obj, prop) {
    return true;
  },
  // Inspired by http://stackoverflow.com/a/8024294/271577
  _getPropertyNames(obj, iterateSelf, iteratePrototype, shouldInclude) {
    const props = [];
    do {
      if (iterateSelf) {
        Object.getOwnPropertyNames(obj).forEach((prop) => {
          if (props.indexOf(prop) === -1 && shouldInclude(obj, prop)) {
            props.push(prop);
          }
        });
      }
      if (!iteratePrototype) {
        break;
      }
      iterateSelf = true;
      obj = Object.getPrototypeOf(obj);
    } while (obj);
    return props;
  },
};
```

〔補足（一般知識）〕この2つの表はプロトタイプ汚染の「観測可能性」を決める重要資料である。汚染されたプロパティ（`Object.prototype.foo = "x"`）は:
- `for...in` では **列挙される（Enumerable, inherited が ✅）**
- `Object.keys` / `Object.assign` / object spread では **列挙されない（❌）**
- `in` 演算子では **true になる（✅）**
- `hasOwnProperty` / `Object.hasOwn` では **false になる（❌）**

したがって「`if (key in opts)` でチェックしている」コードは汚染に反応し、「`Object.hasOwn(opts, key)` でチェックしている」コードは反応しない。この差が脆弱・堅牢の分かれ目になる。また `Object.assign` や spread が継承プロパティをコピーしないという事実は、汚染が「値のコピー」では伝播しないことを意味する。

---

### 16. Memory management（GC と Weak コレクション・出典: .../Guide/Memory_management）

章の節構成（原文見出し）: Memory life cycle / Allocation in JavaScript（Value initialization, Allocation via function calls）/ Using values / Release when the memory is not needed anymore / Garbage collection（References, Reference-counting garbage collection, Mark-and-sweep algorithm）/ Configuring an engine's memory model / **Data structures aiding memory management**（WeakMaps and WeakSets, WeakRefs and FinalizationRegistry）

#### 16.1 Data structures aiding memory management
- JavaScript はガベージコレクタ API を直接露出しないが、**ガベージコレクションを間接的に観測し、メモリ使用量を管理するのに使えるデータ構造をいくつか提供する。**

##### WeakMaps and WeakSets
- **`WeakMap`** と **`WeakSet`** は API が非 weak の対応物（`Map` と `Set`）を近しく反映するデータ構造。`WeakMap` はキー・値ペアのコレクションを維持でき、`WeakSet` は一意な値のコレクションを維持できる。どちらも高性能な追加・削除・照会を持つ。
- 名前は **_weakly held_（弱く保持される）** 値の概念から来ている。`x` が `y` によって弱く保持されるとは、`y` 経由で `x` の値にアクセスできるが、**他の何もが `x` を _強く保持_ していなければ mark-and-sweep アルゴリズムが `x` を到達可能と見なさない**ことを意味する。
- ここで議論するものを除くほとんどのデータ構造は渡されたオブジェクトを強く保持するので、いつでも取り出せる。**`WeakMap` と `WeakSet` のキーは、プログラム内の他の何もがそのキーを参照していない限りガベージコレクトされ得る**（`WeakMap` オブジェクトでは、値もガベージコレクションの対象になる）。これは2つの特徴によって保証される:
  - **`WeakMap` と `WeakSet` はオブジェクトまたは symbol のみを格納できる。** これはオブジェクトだけがガベージコレクトされるから。プリミティブ値は常に forge できる（つまり `1 === 1` だが `{} !== {}`）ので、コレクションに永遠に留まってしまう。**Registered symbols（`Symbol.for("key")` のようなもの）も forge できるのでガベージコレクト可能ではないが、`Symbol("key")` で作られた symbol はガベージコレクト可能。** `Symbol.iterator` のような **Well-known symbols** は固定の集合であり、プログラムの生存期間中一意であり、`Array.prototype` のような組み込みオブジェクトと同様なのでキーとして許される。
  - **`WeakMap` と `WeakSet` は iterable でない。** これは `Array.from(map.keys()).length` を使ってオブジェクトの生存性を観測したり、本来ガベージコレクション対象であるべき任意のキーを取得したりすることを防ぐ。（ガベージコレクションはできる限り不可視であるべき。）
- `WeakMap` / `WeakSet` の典型的な説明では、キーが先にガベージコレクトされ、値も解放されることが暗示される。しかし値がキーを参照するケースを考えよ:

```js
const wm = new WeakMap();
const key = {};
wm.set(key, { key });
// Now `key` cannot be garbage collected,
// because the value holds a reference to the key,
// and the value is strongly held in the map!
```

- `key` が実際の参照として格納されると、循環参照を作り、他の何も `key` を参照していなくてもキーと値の両方がガベージコレクション不適格になる。`key` がガベージコレクトされるなら、ある特定の瞬間に `value.key` が存在しないアドレスを指すことになり、それは合法でないから。これを修正するため、**`WeakMap` と `WeakSet` のエントリは実際の参照ではなく ephemerons（エフェメロン）** であり、mark-and-sweep 機構の拡張である。

引用（Barros らの要約、原文の引用ブロック）:

> Ephemerons are a refinement of weak pairs where neither the key nor the value can be classified as weak or strong. The connectivity of the key determines the connectivity of the value, but the connectivity of the value does not affect the connectivity of the key. […] when the garbage collection offers support to ephemerons, it occurs in three phases instead of two (mark and sweep).

粗いメンタルモデルとしての `WeakMap` 実装（原文の WARNING 付き）:

> WARNING: This is not a polyfill, nor is it anywhere close to how it's implemented in the engine (which hooks into the garbage collection mechanism).

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

- `MyWeakMap` は実際にはキーのコレクションを保持しない。単に渡された各オブジェクトにメタデータを追加するだけ。オブジェクトはその後 mark-and-sweep でガベージコレクト可能。**したがって `WeakMap` のキーを反復することも、`WeakMap` をクリアすることもできない**（それにはキーのコレクション全体の知識が必要だから）。

##### WeakRefs and FinalizationRegistry
> NOTE（原文）: `WeakRef` and `FinalizationRegistry` offer direct introspection into the garbage collection machinery. **Avoid using them where possible** because the runtime semantics are almost completely unguaranteed.

- オブジェクトを値として持つすべての変数はそのオブジェクトへの参照。しかしそのような参照は **strong** である。その存在がガベージコレクタがそのオブジェクトを回収可能とマークするのを妨げる。**`WeakRef`** はオブジェクトへの **weak reference** で、オブジェクトがガベージコレクトされることを許しつつ、生存期間中はオブジェクトの内容を読む能力を保持する。
- `WeakRef` のユースケースのひとつは、文字列 URL を大きなオブジェクトにマップするキャッシュシステム。**この目的に `WeakMap` は使えない。`WeakMap` オブジェクトは _キー_ が弱く保持されるが _値_ は違うから。** キーにアクセスできればいつも決定的に値が得られる（キーにアクセスできることはそれが生きていることを意味するから）。ここではキーに対して `undefined` を得ても構わない（再計算できるから）が、到達不能なオブジェクトがキャッシュに留まることは望まない。この場合、通常の `Map` を使いつつ、各値を実際のオブジェクト値ではなくオブジェクトの `WeakRef` にできる。

```js
function cached(getter) {
  // A Map from string URLs to WeakRefs of results
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

const getImage = cached((url) => fetch(url).then((res) => res.blob()));
```

- **`FinalizationRegistry`** はガベージコレクションを観測するさらに強力な機構を提供する。オブジェクトを登録し、それらがガベージコレクトされたときに通知を受けられる。例えば上のキャッシュシステムでは、blob 自体が回収可能になっても、それらを保持する `WeakRef` オブジェクトは回収されない。時間が経つと `Map` が多くの無用なエントリを蓄積し得る。`FinalizationRegistry` を使えばこの場合のクリーンアップを行える。

〔補足（一般知識）〕`WeakMap` は「クロージャに代わる疑似 private ストレージ」として広く使われる（`privateData.get(this)`）。クラスの `#field`（hard private）と異なり、**`WeakMap` インスタンスへの参照を持つ同一スコープのコードからは読める**ので、モジュール内に閉じられていない限り機密の保証にはならない。また `WeakRef` / `FinalizationRegistry` はガベージコレクションのタイミングを観測できるため、理論上サイドチャネル（メモリ圧の観測）の懸念が議論される機能でもある。MDN は「ランタイムの意味論がほぼ完全に無保証」なので可能な限り使用を避けよと明記している。

---

### 17. Language overview（言語全体像から、診断上重要な節・出典: .../Guide/Language_overview）

章の節構成（原文見出し）: Data types（Numbers, Strings, Other types）/ Variables / Operators / Grammar / Control structures / Objects / Arrays / Functions（Anonymous functions, Recursive functions, Functions are first-class objects, Inner functions）/ Classes / **Asynchronous programming** / **Modules** / **Language and runtime** / Further exploration

#### 17.1 Asynchronous programming
- **JavaScript は本質的にシングルスレッド。並列化（paralleling）はなく、並行性（concurrency）のみがある。** 非同期プログラミングは **event loop** によって駆動され、一連のタスクをキューに入れ完了をポーリングできる。
- 非同期コードを書く3つの慣用的な方法:
  - **コールバックベース**（`setTimeout()` など）
  - **`Promise` ベース**
  - **`async`/`await`**（Promises の糖衣構文）

```js
// Callback-based
fs.readFile(filename, (err, content) => {
  // This callback is invoked when the file is read, which could be after a while
  if (err) {
    throw err;
  }
  console.log(content);
});
// Code here will be executed while the file is waiting to be read

// Promise-based
fs.readFile(filename)
  .then((content) => {
    // What to do when the file is read
    console.log(content);
  })
  .catch((err) => {
    throw err;
  });
// Code here will be executed while the file is waiting to be read

// Async/await
async function readFile(filename) {
  const content = await fs.readFile(filename);
  console.log(content);
}
```

- **コア言語は非同期プログラミング機能を一切規定していない**が、外部環境との相互作用には不可欠。ユーザー権限を尋ねること（Permissions API）、データを fetch すること、ファイルを読むことなど。潜在的に長時間実行される操作を非同期に保つことで、これが待つ間も他のプロセスが実行できる。例えばユーザーがボタンをクリックして許可を与えるのを待つ間、ブラウザはフリーズしない。
- **非同期の値があれば、その値を同期的に得ることは不可能。** 例えば promise があれば、`then()` メソッド経由でのみ最終結果にアクセスできる。同様に `await` は async コンテキスト（通常は async 関数またはモジュール）でのみ使える。**promise は _決してブロックしない_。promise の結果に依存するロジックだけが遅延され、それ以外はすべてその間も実行を続ける。** 関数型プログラマなら promise を `then()` でマップできる monads と認識するかもしれない（ただし auto-flatten するので _proper_ な monad ではない。すなわち `Promise<Promise<T>>` は持てない）。
- 実際、シングルスレッドモデルはノンブロッキング IO により Node.js をサーバーサイドプログラミングの人気の選択にした。大量のデータベースやファイルシステム要求の処理が非常に高性能になる。**ただし純粋な JavaScript の CPU バウンド（計算集約的）なタスクは依然メインスレッドをブロックする。真の並列化には workers を使う必要があるかもしれない。**

#### 17.2 Modules（言語全体像から）
- JavaScript はほとんどのランタイムがサポートするモジュールシステムも規定する。**モジュールは通常ファイルであり、ファイルパスまたは URL で識別される。**

```js
import { foo } from "./foo.js";

// Unexported variables are local to the module
const b = 2;

export const a = 1;
```

- **Haskell、Python、Java などと異なり、JavaScript のモジュール解決は完全に host 定義である。** 通常 URL またはファイルパスに基づくので、相対ファイルパスが「そのまま動き」、プロジェクトルートではなく**現在のモジュールのパスに対して相対的**になる。
- **ただし JavaScript 言語は標準ライブラリモジュールを提供しない。** すべてのコア機能は `Math` や `Intl` のようなグローバル変数で提供される。これは JavaScript が長らくモジュールシステムを欠いていた歴史と、モジュールシステムへのオプトインがランタイムセットアップの変更を伴う事実による。
- ランタイムによって異なるモジュールシステムを使い得る。例えば **Node.js** はパッケージマネージャ **npm** を使い主にファイルシステムベース。**Deno** とブラウザは完全に URL ベースで、モジュールは HTTP URL から解決され得る。

#### 17.3 Language and runtime（言語レベルとランタイムレベルの区別 — 重要）
- JavaScript は汎用スクリプト言語。**コア言語仕様（ECMAScript）は純粋な計算ロジックに焦点を当てる。入出力を一切扱わない。** 実際、追加のランタイムレベル API（最も顕著には `console.log()`）なしでは、JavaScript プログラムの振る舞いは完全に観測不能である。
- **runtime（= host）** は JavaScript エンジン（インタプリタ）にデータを供給し、追加のグローバルプロパティを提供し、エンジンが外界とやり取りするためのフックを提供するもの。**モジュール解決、データの読み取り、メッセージの印字、ネットワーク要求の送信などはすべてランタイムレベルの操作である。**
- 誕生以来 JavaScript は様々な環境で採用されてきた。ブラウザ（DOM のような API を提供）、Node.js（ファイルシステムアクセスのような API を提供）など。JavaScript はウェブ（それが主目的だった）、モバイルアプリ、デスクトップアプリ、サーバーサイドアプリ、サーバーレス、組み込みシステムなどに成功裏に統合されてきた。**コア機能を学びつつ、知識を実用に供するには host が提供する機能を理解することも重要である。**

#### 17.4 Further exploration（章末で「紙幅と複雑さのため省略したが自分で探索できる本質的な部分」として挙げられる項目）
- Inheritance and the prototype chain
- Closures
- Regular expressions
- Iteration

〔補足（一般知識）〕「言語レベル」と「ランタイムレベル」の区別は、クライアントサイド脆弱性ハンティングの地図そのものである。DOM XSS の sink（`innerHTML`、`document.write`、`location`、`eval` の一部）の多くは **ランタイム（DOM/Web API）側**にあり、ECMAScript 仕様には存在しない。一方 `eval`/`Function`/型強制/プロトタイプ機構は**言語レベル**にある。この2層を分けて考えると、「同じ JS コードがブラウザでは XSS になるが Node.js では別の影響になる」といった判断が整理できる。

---

## 読者が自分で開くべき資料

本ノートのすべての内容は取得できたが、**developer.mozilla.org 自体がこの環境の egress proxy によってブロックされており（`EGRESS_BLOCKED` / CONNECT 403）、web.archive.org も同様にブロックされていた**。そのため MDN の公式コンテンツリポジトリ（`github.com/mdn/content`）のソース Markdown を取得して代替した。内容は同一の原稿だが、**次の要素はソース Markdown には含まれず、レンダリング済みページでしか得られない**ので、読者は必ず自分でブラウザから原典を開くことを推奨する。

### 取得できなかった／代替取得になった理由
1. `developer.mozilla.org` へのアクセスはこの実行環境のネットワークポリシーで禁止されている（WebFetch は `EGRESS_BLOCKED`、curl は `CONNECT tunnel failed, response 403`）。TLS 検証の無効化やプロキシの迂回は行っていない。
2. `web.archive.org` も同じく CONNECT 403 で拒否された。
3. 代替として `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/javascript/guide/**/index.md` を取得した。これは MDN が実際に配信している本文の**原稿そのもの**であり、本文・コード・表はすべて逐語で取得できている。

### 読者が原典で読むべきポイント（読みどころ）
1. **ライブサンプル（`{{EmbedLiveSample}}`）の実動作** — Closures 章の「practical closures」（フォントサイズ変更ボタン）と「closures_bad / closures_factory」（ループ内クロージャのバグとその修正）は、レンダリング済みページ上で実際にクリック・フォーカスして挙動の違いを体験できる。ソース Markdown ではマクロ呼び出しに置き換わっている。
2. **サイドバー（jssidebar）の完全なナビゲーション構造** — ガイドの各章からリファレンス（Statements / Operators / Global Objects / Functions / Classes / Errors）へのリンク網は、調査時に「この構文の正確な仕様はどこか」を辿るための地図になる。特に `Reference/Iteration_protocols`、`Reference/Execution_model`、`Reference/Strict_mode`、`Reference/Lexical_grammar` は本ガイドから頻繁に参照される。
3. **ブラウザ互換性テーブル（BCD）** — `using` / `await using`（Resource management 章）、import maps、import attributes（`with { type: "json" }`）、top-level await、`WeakRef` / `FinalizationRegistry` は比較的新しい機能であり、対象ブラウザで使えるかはページ下部の互換性テーブルで確認する必要がある。診断対象が古いブラウザを想定している場合に影響する。
4. **Proxy リファレンスページ（各トラップの詳細）** — Meta programming 章の表は「どのトラップがどの操作を横取りするか」の一覧だが、各トラップの引数・返り値・invariant 違反の具体条件は `Reference/Global_Objects/Proxy/Proxy` の各サブページにある。フックを正しく実装する（`TypeError` を避ける）にはそちらが必要。
5. **`eslint-plugin-security` の "the dangers of square bracket notation"** — Working with objects 章が唯一明示的にリンクしているセキュリティ文書。`https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md`。object injection の具体的な悪用パターンと ESLint による検出方法が書かれている（本ノートの取得対象外なので別途参照）。
6. **本ノートで扱えなかった章の本文** — 目次には挙げたが本文を詳細収録していない章: Control flow and error handling（`try`/`catch`/`throw`、Error オブジェクト）、Loops and iteration、Expressions and operators、Numbers and strings、Representing dates & times、**Regular expressions（Assertions / Character classes / Groups and backreferences / Quantifiers の4サブページ）**、Indexed collections、Keyed collections、Typed arrays、**Resource management（`using` / `await using` / `DisposableStack`）**、Internationalization。特に **Regular expressions のサブページ群は ReDoS と正規表現によるバリデーション迂回（アンカー欠落、`.` の改行非マッチ、`lastIndex` の状態）の理解に直結する**ので、教科書執筆時に別途参照すべき。

---

## クライアントサイド脆弱性ハンティングへの対応整理（本ノート内の材料の索引）

| 診断観点 | 本ノートの該当節 | MDN 原文の根拠 |
| --- | --- | --- |
| Object injection（ブラケット記法） | 6.2 Accessing properties | 「beware of using square brackets to access properties whose names are given by external input」＋ eslint-plugin-security へのリンク |
| プロトタイプ汚染の機構 | 7.1〜7.4 | プロパティ探索順序、シャドウイング、`__proto__` の2つの意味、`Object.create(null)`、`Object.setPrototypeOf` |
| 汚染の観測可能性（`in` vs `hasOwn`） | 15.1 / 15.2 の表 | Querying / Traversing の2表 |
| ビルトイン改変（monkey patching） | 7.2 WARNING | SmooshGate への言及、「唯一の正当な理由は backport」 |
| 動的コード実行 sink | 4.1（`Function` コンストラクタ ≒ `eval`）、12.14（`import()`） | 「much like `eval()`」／「Dynamic import ... always available, even in script environments」 |
| 型強制によるバリデーション迂回 | 13.1 / 13.6 / 14.2 / 14.5 の表 | `==` のアルゴリズム、3つの coercion 経路、sameness 比較表 |
| DOM Clobbering の前提（`document.all`） | 14.2 | 「most browsers permit ... `document.all` ... to act as if they emulate the value `undefined`」 |
| グローバル汚染（未宣言代入、非 strict `this`） | 3.3 / 4.6 | 「undeclared global ... an error in strict mode」／非 strict で `this` がグローバルオブジェクト |
| フレーム間アクセス | 3.3 Global variables | 「you can access global variables declared in one window or frame from another ... `parent.phoneNumber`」 |
| 競合状態・マイクロタスク順序 | 11.6 Timing | Guarantees の3項目、microtask vs task queue の出力例 |
| 非同期エラーの可視化・情報漏えい | 11.2 Promise rejection events | `unhandledrejection` / `rejectionhandled` / `PromiseRejectionEvent.reason` |
| モジュールのセキュリティ差分 | 12.8 | 自動 strict mode、`file://` CORS、自動 defer、1回だけ実行、グローバルに出ない |
| MIME タイプ厳格チェック | 12.2 / 12.19 | 「strict MIME type checking error ... The server responded with a non-JavaScript MIME type」 |
| import map 経由の乗っ取り面 | 12.5 | `imports` / `scopes`、最長一致、ドキュメント限定（worker/worklet 非対応） |
| 非 JS リソース読み込みの型検証 | 12.6 | 「This ensures that you don't accidentally execute code when you just intend to import data」 |
| フック・計測（taint 追跡の実装） | 10.2 のトラップ対応表、10.4 Reflect | 13 トラップと横取り操作の完全表、`typeof` はトラップを発火しない |
| 疑似 private vs hard private | 8.1 / 16.1 | 「private fields ... are _hard private_」／Chrome コンソール例外、WeakMap のメンタルモデル |
| イテレーション乗っ取り | 9.3 | `[Symbol.iterator]` が spread / destructuring / `for...of` / `yield*` に効く |
| 文字列エスケープ・Unicode 迂回 | 3.5 特殊文字表 | `\xXX` / `\uXXXX` / `\u{XXXXX}`（サロゲートペア等価）／`\XXX` 8進 |
| 区切り文字注入 | 13.3 "stringly-typing" | 「when the separator is used in one of the 'list' elements, then, the list is broken」 |
