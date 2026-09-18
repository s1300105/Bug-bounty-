# JavaScript 言語コアとDOM・イベントの基盤 — クライアントサイド脆弱性の下地を作る

> **この節で分かること**
> - レキシカル環境・クロージャ・`[[Environment]]` がスコープをどう決めるかを説明できる
> - `var`／グローバルオブジェクト／`eval`／`new Function` がどこで「グローバル汚染」や「コード文字列実行」の入口になるかを見分けられる
> - プロトタイプ継承の仕組みと、`__proto__` を起点にしたプロトタイプ汚染（Prototype Pollution）がなぜ起きるかを説明でき、`Map` や `Object.create(null)` で回避できる
> - `innerHTML`／`outerHTML`／`insertAdjacentHTML`／`document.write` と `textContent`／`append` のエスケープの有無を区別し、XSS シンク（注入先）を分類できる
> - イベントのバブリング・キャプチャ・デリゲーションと、`data-*` behavior パターンがなぜ攻撃の観測点・ガジェットになるかを説明できる
> - microtask／macrotask とイベントループの実行順序を自分で追える

**元資料**: https://javascript.info/ （原典サイトは取得できず、公式ソースリポジトリ `javascript-tutorial/en.javascript.info` の Markdown を逐語取得したものにもとづく）
**関連する節**: 「Same-Origin Policy・CORS・Cookie・クリックジャッキング」（本教材の同ノート後半パート）、「正規表現の破滅的バックトラッキング（ReDoS）」

---

## 0. この節の材料について — なぜ「教材そのもの」を土台にするのか

この節は、`javascript.info`（正式名 The Modern JavaScript Tutorial、著者 Ilya Kantor）というオンライン教材を材料にしている。`javascript.info` とは、JavaScript という言語そのものからブラウザの API までを、仕様（ECMA-262 や WHATWG の DOM・HTML・Fetch・URL 仕様）に沿って段階的に解説する、事実上の標準教材のこと。攻撃手法のカタログではなく「ブラウザとJSが実際にどう動くか」を一次的に理解させる教材であり、脆弱性ハンティングの土台になる。

脆弱性ハンティング（bug bounty などで自分でバグを探す活動）では、攻撃ペイロードを暗記するより「なぜその挙動が起きるのか」を理解しているほうが強い。未知のシンク（危険な書き込み先）や未知のガジェット（悪用の部品）を、動作原理から導けるようになるからだ。この節はその原理側を固める。

> ### 📌 ここは自分で開いて読んでください
> **資料**: The Modern JavaScript Tutorial（javascript.info 本体） — https://javascript.info/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 組織のegressポリシーにより `javascript.info:443` への接続が 403 で拒否された。サイト側の悪意ではなく、こちら側のネットワーク制限）。本文そのものは公式GitHubリポジトリ `javascript-tutorial/en.javascript.info` に同一内容のMarkdownとして存在するため逐語取得できているが、サイト上だけにある「実行できるコード例」「図版（SVG）」「各記事末尾の課題と解答」は取得できていない。以下の記述はその Markdown 本文にもとづく要約である。
> **読みどころ**:
> 1. `/closure` の V8 デバッガの例（`debugger;` で止めて変数を打つと見えない／同名の外側変数が見える）を実際に動かして体感する
> 2. `/prototype-methods` の `prompt("What's the key?", "__proto__")` を使ったプロトタイプ汚染デモを動かす
> 3. `/event-loop` の `setTimeout` / `queueMicrotask` による描画タイミング差を動かす
> 4. `object-prototype-2.svg`（`__proto__` が `Object.prototype` 上のアクセサであることを示す図）と各種フロー図を目で見る
> **代替手段**: ブロックされている環境なら、次のコマンドで本文Markdownをローカルに取得できる。
> ```bash
> git clone --depth 1 --filter=blob:none --sparse https://github.com/javascript-tutorial/en.javascript.info.git
> cd en.javascript.info
> git sparse-checkout set --no-cone '/*.md' '/**/*.md'
> ```
> フォルダ名から先頭の `NN-` を除いたものが記事の slug（例: `1-js/06-advanced-functions/03-closure/article.md` → `https://javascript.info/closure`）。ローカルでサイトとして表示するサーバは https://github.com/javascript-tutorial/server にある。

---

## 1. レキシカル環境とクロージャ — スコープはどう決まるのか

### 1.1 なぜこの仕組みが必要か（設計意図）

JavaScript は関数の中に関数を書ける言語で、内側の関数が外側の変数を「覚えている」必要がある。この「覚える」仕組みを仕様として厳密に定義したものがレキシカル環境（Lexical Environment）である。レキシカル環境とは、変数がどこに実際に格納され、どの順で探されるかを説明するための内部オブジェクトのこと。

### 1.2 どう動くのか（仕組み）

まずブロックスコープから。`{...}` 内で `let` / `const` 宣言した変数はそのブロック内でのみ見える。`if`、`for`、`while` の `{...}` も同じ。`for (let i = 0; ...)` の `i` は見た目はブロックの外だが、`for` 構文は特別で、その中で宣言された変数はブロックの一部と見なされる。

原文はレキシカル環境をこう定義している（逐語訳）。

> JavaScript では、**実行中のすべての関数、コードブロック `{...}`、およびスクリプト全体**が、*Lexical Environment* と呼ばれる内部（隠れた）オブジェクトを関連付けて持つ。

このオブジェクトは2つの部分からなる。

1. **Environment Record** — すべてのローカル変数をプロパティとして格納するオブジェクト（`this` の値なども含む）。
2. **外側のレキシカル環境への参照**（outer lexical environment）。

つまり「変数」とは、内部オブジェクト Environment Record のプロパティにすぎない。「変数を取得/変更する」とは「そのオブジェクトのプロパティを取得/変更する」ことである。

仕組みは4ステップで整理できる。

| ステップ | 内容 |
|---|---|
| Step 1（変数） | スクリプト開始時、レキシカル環境は宣言済みの全変数で事前に埋められる。初期状態は "Uninitialized"（未初期化）で、`let` の宣言に到達するまで参照できない。宣言到達で `undefined`、代入で値が入る。 |
| Step 2（関数宣言） | **Function Declaration は即座に完全初期化される**。レキシカル環境が作られた時点ですぐ使える（宣言前でも呼べる）。`let say = function(){}` のような Function Expression には適用されない。 |
| Step 3（内側と外側） | 関数実行時、呼び出しの先頭で新しいレキシカル環境が作られ、ローカル変数と引数を保持する。変数アクセスは内側→外側→さらに外側→グローバルの順に探す。 |
| Step 4（関数を返す） | すべての関数は、生成されたレキシカル環境を隠れプロパティ **`[[Environment]]`** に記憶する。この参照は関数生成時に一度だけ設定され、以後不変。 |

Step 3 の探索で「どこにも見つからない場合」の挙動が重要だ。strict モードではエラーになる。しかし `use strict` なしでは、存在しない変数への代入は互換性のため新しいグローバル変数を作ってしまう。これがグローバル汚染の原典的な根拠になる。

### 1.3 クロージャの定義

クロージャ（closure）とは、外側の変数を記憶しアクセスできる関数のこと。原文はこう書いている。

> JavaScript では**すべての関数が自然にクロージャである**（例外は1つだけで、`new Function` の章で扱う）。

典型例を原文のまま示す。`count` という外側変数を、返された関数が覚え続ける。

```js run
function makeCounter() {
  let count = 0;

  return function() {
    return count++;
  };
}

let counter = makeCounter();

alert( counter() ); // 0
alert( counter() ); // 1
alert( counter() ); // 2
```

`makeCounter()` が返す無名関数は、その `[[Environment]]` に `{count: 0}` のレキシカル環境を記憶している。呼び出すたびに新しいレキシカル環境が作られ、その outer 参照は記憶しておいた `[[Environment]]` から取られる。変数は、それが存在するレキシカル環境で更新される。

```js
function f() {
  let value = 123;

  return function() {
    alert(value);
  }
}

let g = f(); // g.[[Environment]] stores a reference to the Lexical Environment
// of the corresponding f() call
```

### 1.4 攻撃者はどこを突くのか — デバッグ時に変数が消えるV8の挙動

到達可能なネスト関数がある限り、関数が終わってもレキシカル環境は生き続ける。`let arr = [f(), f(), f()]` のように結果を保存すれば、3つのレキシカル環境がメモリに残る。`g = null` にすれば解放される。

ここで診断上ハマりやすい落とし穴がある。エンジンは変数の使用を解析し、外側変数が使われないと明白なら除去して最適化する。原文の警告（逐語趣旨）。

> **V8（Chrome, Edge, Opera）における重要な副作用は、そのような変数がデバッグ時に利用不可能になることである。**

つまり `debugger;` で止めて `alert(value)` を打っても「そんな変数はない」と言われる。さらに悪いことに、同名の外側変数が見えてしまうこともある。

```js run
function f() {
  let value = Math.random();

  function g() {
    debugger; // in console: type alert(value); No such variable!
  }

  return g;
}

let g = f();
g();
```

```js run global
let value = "Surprise!";

function f() {
  let value = "the closest value";

  function g() {
    debugger; // in console: type alert(value); Surprise!
  }

  return g;
}

let g = f();
g();
```

これは「デバッガのバグではなく V8 の特別な機能」である。脆弱性検証中に DOM XSS の値を追っていて「変数が見えない／別の値が見える」ときは、この最適化を疑う。

---

## 2. `var`・グローバルオブジェクトとスコープ汚染

### 2.1 旧 `var` の挙動

`var` は古いコードを読むために知っておく必要がある。`let`/`const` と違い、`var` にはブロックスコープがない。`var` で宣言した変数は関数スコープかグローバルスコープのいずれかで、ブロックを貫通して見える。

- `if (true) { var test = true; }` の後で `alert(test)` は `true`（グローバル変数になる）。`let` なら `ReferenceError`。
- `var` は再宣言を許す。`var user = "Pete"; var user = "John";` はエラーにならず、2つ目は何もしない。
- `var` はホイスティングされる。宣言は関数（グローバルならスクリプト）開始時に処理されるが、**代入はホイストされない**。`alert(phrase); var phrase = "Hello";` は `undefined` を表示する。

〔補足〕ホイスティング（hoisting）とは、宣言がコードの見た目の位置より前（スコープの先頭）に「巻き上げ」られたかのように扱われる挙動のこと。

### 2.2 グローバルオブジェクトと汚染の関係

グローバルオブジェクトとは、どこからでも直接アクセスできる最上位のオブジェクトのこと。ブラウザでは `window`、Node.js では `global`、標準名は `globalThis`。`alert("Hello")` は `window.alert("Hello")` と同じ。

ここが汚染に直結する。ブラウザでは、`var`（`let`/`const` ではない）で宣言されたグローバル変数・関数はグローバルオブジェクトのプロパティになる。

| 宣言 | `window` から見えるか |
|---|---|
| `var gVar = 5;` | `window.gVar` は `5` |
| `let gLet = 5;` | `window.gLet` は `undefined` |
| メインコードの Function Declaration | `var` と同じくプロパティになる |

原文の警告：「これに依存しないこと。この挙動は互換性のために存在する。現代のスクリプトは JavaScript モジュールを使い、そこではこういうことは起きない。」

### 2.3 攻撃者はどこを突くのか／どう守るのか

第1節で見た「strict なしの未宣言変数への代入は新しいグローバル変数を作る」性質と、この「`var` はグローバルプロパティになる」性質が組み合わさると、ページに攻撃者が名前を注入できる状況で `window.<名前>` を上書きするガジェットになりうる。守る側は `"use strict"`（またはモジュール）を使い、グローバルへ置きたい値は `window.currentUser = {...}` のように明示的に書く。原文も「将来性と可読性のため、グローバルオブジェクトのプロパティは `window.x` として直接アクセスすべき」と述べている。

### 2.4 IIFE（即時実行関数式）— 古いスクリプトで `var` を閉じ込める手法

`var` にブロックスコープがなかった時代、擬似的にブロックスコープを作るために使われたのが IIFE（即時実行関数式, immediately-invoked function expressions）である。IIFE とは、関数を定義した直後にその場で呼び出して、内部で宣言した `var` を外へ漏らさないための書き方のこと。現代では使うべきでないが、古いコードを読むと今も出てくる。

ここで初学者がつまずくのが「なぜ関数を括弧で囲むのか」だ。理由は次のとおり。エンジンはメインコードで `function` というキーワードを見ると、そこを Function Declaration（関数宣言）の開始だと解釈する。だが Function Declaration には名前が必須で、しかも定義した直後にそのまま `()` で呼び出すことは許されない。そこで関数全体を括弧で囲み「これは宣言ではなく式（Function Expression）だ」とエンジンに教える。式なら名前は省略でき、直後に `()` を付けて即時呼び出しできる。

原文は括弧以外の起動方法も含め、4通りの生成コードを逐語で示している（`*!*` … `*/!*` は javascript.info 独自の強調表示マーカーで、サイト上では該当行がハイライトされるだけの飾りである。読むときは無視してよい）。

```js run
// Ways to create IIFE

*!*(*/!*function() {
  alert("Parentheses around the function");
}*!*)*/!*();

*!*(*/!*function() {
  alert("Parentheses around the whole thing");
}()*!*)*/!*;

*!*!*/!*function() {
  alert("Bitwise NOT operator starts the expression");
}();

*!*+*/!*function() {
  alert("Unary plus starts the expression");
}();
```

上から順に、(1) 関数だけを括弧で囲む、(2) 呼び出しまで含めて全体を括弧で囲む、(3) 先頭にビット NOT 演算子 `!` を置く、(4) 先頭に単項プラス `+` を置く、という4パターンだ。(3)(4) は「文の先頭が `function` でなくなれば、エンジンはそれを式と解釈する」ことを利用している。いずれも狙いは同じで「`function` を宣言ではなく式として始めさせる」ことにある。

---

## 3. `eval` と `new Function` — コード文字列を実行するシンク

### 3.1 なぜ危険なのか（設計意図と挙動）

`eval` と `new Function` はどちらも「文字列をコードとして実行する」機能で、攻撃者が文字列に影響できれば任意コード実行に化ける。ただし2つは**実行されるスコープが違う**ため、到達できる識別子の集合が異なる。この違いはシンク分類のときに効く。

### 3.2 `new Function`

構文は次の通り。

```js
let func = new Function ([arg1, arg2, ...argN], functionBody);
```

決定的な特徴は、実行時に渡された文字列から文字どおり関数が作られること。原文の逐語例。

```js
let str = ... receive the code from a server dynamically ...

let func = new Function(str);
func();
```

そして**クロージャの唯一の例外**がこれだ。`new Function` で作られた関数の `[[Environment]]` は、生成場所のレキシカル環境ではなく**グローバル環境**を参照する。だから外側のローカル変数にはアクセスできず、グローバル変数だけにアクセスできる。

なぜこの設計か。原文の論拠は minifier（ミニファイア。公開前にコードを圧縮しローカル変数を短い名前に変えるツール）との整合だ。`let userName` が `let a` にリネームされたあと、`new Function` が外側変数を見られたらリネーム後の名前を見つけられない。「もし `new Function` が外側変数にアクセスできたら、minifier と問題を起こす」。

### 3.3 `eval`

`eval(code)` は文字列 `code` を実行し、最後の文の結果を返す。`eval('1+1')` は `2`、`eval('let i = 0; ++i')` は `1`。

`new Function` と違い、**`eval` されたコードは現在のレキシカル環境で実行される**。だから外側変数が見え、変更もできる。

- `let a = 1; function f() { let a = 2; eval('alert(a)'); } f();` は `2`。
- `let x = 5; eval("x = 10"); alert(x);` は `10`（外側変数を書き換えた）。

ただし strict モードでは `eval` は自身のレキシカル環境を持つので、`eval` 内で宣言した変数・関数は外から見えない。`eval("let x = 5; function f() {}"); alert(typeof x);` は `undefined`。非 strict なら `x` と `f` が外から見える。

`eval` はツールチェーンにも副作用を持つ。原文いわく、`eval` が使われると、そのコード文字列から外側のローカル変数がアクセスされうるため、minifier（ミニファイア。公開前にコードを圧縮し変数を短い名前に変えるツール）は `eval` から見える可能性のある全変数のリネームを避ける。結果として圧縮率が落ちる。第3.2節で見た `new Function` の minifier 整合と対になる話で、「文字列としてコードを扱う機能はツールの静的解析を無効にする」という同じ根がある。

### 3.4 どう守るのか

原文は「eval is evil」の代替を2つ示す。

- **eval されるコードが外側変数を使わないなら `window.eval(...)` を使う**。グローバルスコープで実行される。

```js
let x = 1;
{
  let x = 5;
  window.eval('alert(x)'); // 1 (global variable)
}
```

- **ローカル変数が必要なら `eval` をやめて `new Function` にし、引数として渡す**。

```js
let f = new Function('a', 'alert(a)');
f(5); // 5
```

〔補足〕診断上の要点として原典が重要なのは、`eval` が「現在のレキシカル環境」で動くという性質。DOM XSS の注入点がクロージャ内部にあるとき、`eval` 系ならスコープ内の機密（トークン等）へ到達できる。逆に `new Function`／`window.eval` はグローバル固定なので到達できる識別子が違う。シンク分類のとき、この2つは分けて扱うべきだと原典が根拠づけている。

---

## 4. `this` の束縛と `bind`

### 4.1 `this` は呼び出し時に決まる

オブジェクトのプロパティに入った関数をメソッドと呼ぶ。`this` の値は「ドットの前のオブジェクト」＝メソッド呼び出しに使われたオブジェクトになる。重要なのは、`this` は束縛されていないこと。原文いわく「`this` の値は実行時に、コンテキストに応じて評価される」。同じ関数を2つのオブジェクトに代入すれば、呼び出しごとに `this` が変わる。

オブジェクトなしで呼ぶと strict モードでは `this == undefined`。だが**非 strict モードでは `this` はグローバルオブジェクト（`window`）になる**。矢印関数は自分の `this` を持たず、外側の通常関数から取る。

〔補足〕診断上の要点：非 strict の `this === window` は、メソッドを剥がして呼ぶ（`const f = obj.method; f()`）と `window` にプロパティが書かれるガジェットになりうる。`"use strict"` がこれを修正する。

### 4.2 「`this` を失う」問題と `bind`

典型例は `setTimeout(user.sayHi, 1000)` が `Hello, undefined!` になること。ブラウザの `setTimeout` は関数呼び出しに `this=window` を設定するので、`this.firstName` が `window.firstName` を取ろうとして失敗する。

解決策は2つ。ラッパーで包む方法（`setTimeout(() => user.sayHi(), 1000)`）と、`bind` を使う方法。ただしラッパーには原文が指摘する弱点がある。「a slight vulnerability appears in our code structure」――発火前の遅延中に `user` の値が変わると、別のオブジェクトを呼んでしまう。

`func.bind(context)` は `this=context` を固定した、関数として呼べる特殊な "exotic object"（風変わりオブジェクト）を返す。bind 後は `user` が変わっても bind 時点の参照を使う。部分適用（引数を先に固定する）もできる。`let double = mul.bind(null, 2)` なら `double(3)` は `mul(2, 3)`。コンテキストを固定せず引数だけ固定するには自作関数が要る。

```js
function partial(func, ...argsBound) {
  return function(...args) { // (*)
    return func.call(this, ...argsBound, ...args);
  }
}
```

---

## 5. プロトタイプ継承とネイティブプロトタイプ

### 5.1 仕組み

JavaScript のオブジェクトは隠れプロパティ `[[Prototype]]`（仕様上の名称）を持ち、`null` か他のオブジェクトを参照する。プロパティを読むときに存在しなければ、自動的にプロトタイプから取得する。これがプロトタイプ継承だ。`rabbit.__proto__ = animal` は `rabbit.[[Prototype]] = animal` を設定する。チェーンは長くできる（`longEar` → `rabbit` → `animal`）。

制限は次の通り。参照は循環できない。`__proto__` の値はオブジェクトか `null` のいずれか（他の型は無視される）。`[[Prototype]]` は1つだけで、2つのオブジェクトからは継承できない。

重要なのは、`__proto__` は `[[Prototype]]` そのものではなく、その歴史的な getter/setter だということ。この一文がプロトタイプ汚染の核心なので覚えておく。現代的には `Object.getPrototypeOf` / `Object.setPrototypeOf` が推奨される。

### 5.2 書き込みはプロトタイプを使わない

プロトタイプは**読み取りにのみ**使われる。書き込み・削除はオブジェクトに直接作用する。ただし例外がアクセサプロパティ（getter/setter を持つプロパティ）だ。プロトタイプ上に setter があると、`admin.fullName = "Alice Cooper"` はプロトタイプ上の setter を起動する。だが `this` はドットの前の `admin` なので、`admin` の状態だけ変わり `user` は守られる。原文いわく「`this` はプロトタイプの影響を一切受けない」。結果として「メソッドは共有されるが、オブジェクトの状態は共有されない」。

`for..in` は継承プロパティも列挙するが、`Object.keys` は自身のキーだけ返す。`hasOwnProperty` が `for..in` に出ないのは、`Object.prototype` の全プロパティ同様 `enumerable:false` だから。

### 5.3 ネイティブプロトタイプと method borrowing

`obj = {}` は `obj = new Object()` と同じで、`[[Prototype]]` は `Object.prototype`。仕様上、すべての組み込みプロトタイプの頂点に `Object.prototype` がある。文字列・数値・真偽値はプロパティアクセス時に一時ラッパーが作られメソッドを提供して消える。`null` と `undefined` にはラッパーもプロトタイプもない。

ネイティブプロトタイプは変更できるが、原文は強く戒める。「プロトタイプはグローバルなので衝突しやすい。2つのライブラリが `String.prototype.show` を追加したら一方が他方を上書きする」。容認される唯一のケースはポリフィルだけ。

method borrowing（メソッド借用）も要注意だ。`obj.join = Array.prototype.join` は動く。組み込み `join` は正しいインデックスと `length` だけを見て、本当に配列かは検査しない。多くの組み込みメソッドがそうである。

〔補足〕診断上の要点：この「配列かどうかを検査しない」緩さは、array-like な攻撃者制御オブジェクト（`{0:..., length:...}`）を組み込みメソッドに食わせる型混同系テストにつながる。

---

## 6. プロトタイプ汚染（Prototype Pollution）— 本教材で最重要のシンク

プロトタイプ汚染とは、`Object.prototype` などの共有プロトタイプにプロパティを書き込み、すべてのオブジェクトの挙動を横断的に変えてしまう脆弱性のこと。原典（`/prototype-methods`）はこれを、攻撃名を出さずに「バグ」として正確に描写している。

### 6.1 なぜ起きるのか

オブジェクトはキー/値の連想配列として使える。ところが**ユーザ提供のキー**を保存しようとすると不具合が出る。原文の逐語デモ。

```js run
let obj = {};

let key = prompt("What's the key?", "__proto__");
obj[key] = "some value";

alert(obj[key]); // [object Object], not "some value"!
```

ユーザが `__proto__` と入力すると4行目の代入が無視される。`__proto__` プロパティは特別で、オブジェクトか `null` でなければならず、文字列はプロトタイプになれないからだ。原文はこう続ける。

> しかし他のケースでは `obj` に文字列ではなくオブジェクトを保存しているかもしれず、そうすると**プロトタイプが実際に変更されてしまう**。結果として、実行はまったく予期しない形で誤った方向に進む。
>
> **さらに悪いのは — 通常、開発者はそのような可能性をまったく考えないことである。そのためこの種のバグは気づきにくく、脆弱性に変わることさえある。とくに JavaScript がサーバサイドで使われる場合。**

`obj.toString` への代入でも予期しないことが起こりうる（組み込みメソッドだから）。

### 6.2 仕組み — なぜ `__proto__` だけ特別なのか

鍵は、`__proto__` がオブジェクト自身のプロパティではなく `Object.prototype` 上のアクセサプロパティだという事実だ。だから `obj.__proto__` を読み書きすると、プロトタイプから継承した getter/setter が呼ばれ、`[[Prototype]]` を取得/設定してしまう。

### 6.3 どう守るのか（2つの回避策）

**回避策1: `Map` を使う**。`Map` はキーを内部に持ち、`__proto__` を特別扱いしない。

```js run
let map = new Map();

let key = prompt("What's the key?", "__proto__");
map.set(key, "some value");

alert(map.get(key)); // "some value" (as intended)
```

**回避策2: プロトタイプなしオブジェクト**。`Object.create(null)`（または `{ __proto__: null }`）はプロトタイプのない空オブジェクトを作る。継承 getter/setter が存在しないので、`__proto__` は通常のデータプロパティとして処理される。

```js run
let obj = Object.create(null);
// or: obj = { __proto__: null }

let key = prompt("What's the key?", "__proto__");
obj[key] = "some value";

alert(obj[key]); // "some value"
```

このようなオブジェクトを "very plain" または "pure dictionary" オブジェクトと呼ぶ。欠点は `toString` などの組み込みメソッドを欠くこと（`alert(obj)` はエラー）だが、連想配列としては問題ない。`Object.keys(obj)` などの `Object.something(...)` 形式のメソッドはプロトタイプにないので動き続ける。

```js run
let chineseDictionary = Object.create(null);
chineseDictionary.hello = "你好";
chineseDictionary.bye = "再见";

alert(Object.keys(chineseDictionary)); // hello,bye
```

### 6.4 歴史（年代を保持）

| 年 | 出来事 |
|---|---|
| ごく古い時代 | コンストラクタ関数の `prototype` プロパティが機能。所与のプロトタイプでオブジェクトを作る最古の方法。 |
| 2012年 | `Object.create` が標準化。生成はできるが取得/設定は不可。一部ブラウザが非標準の `__proto__` アクセサを実装。 |
| 2015年 | `Object.setPrototypeOf` / `Object.getPrototypeOf` が標準化。`__proto__` は非推奨扱いで Annex B（非ブラウザ環境ではオプショナル）へ移動。 |
| 2022年 | オブジェクトリテラル内の `__proto__` 使用が公式に許可。ただし getter/setter としての `obj.__proto__` は依然 Annex B。 |

### 6.5 速度の警告

原文は、既存オブジェクトの `[[Prototype]]` を変更するな、と強く言う。「`Object.setPrototypeOf` や `obj.__proto__=` でプロトタイプを『オンザフライ』に変更するのは、オブジェクトのプロパティアクセス操作に対する内部最適化を壊すため非常に遅い」。通常は生成時に一度だけ設定する。

---

## 7. プロパティフラグと記述子 — 凍結による緩和とその落とし穴

オブジェクトのプロパティは `value` に加えて3つのフラグを持つ。

| フラグ | 意味 |
|---|---|
| `writable` | `true` なら値を変更できる。そうでなければ読み取り専用。 |
| `enumerable` | `true` ならループで列挙される。 |
| `configurable` | `true` なら削除でき、フラグも変更できる。 |

「通常の方法」で作ると全フラグ `true`。`Object.getOwnPropertyDescriptor(obj, name)` で記述子を得て、`Object.defineProperty(obj, name, descriptor)` で変更する。存在しないプロパティに `defineProperty` すると、供給されなかったフラグは `false` と見なされる。

### 7.1 実例で見るフラグの効果 — `Math.PI`

具体例として `Math.PI` を見る。この値は `writable`／`enumerable`／`configurable` がすべて `false` で、記述子の実値は `3.141592653589793` である。フラグがすべて閉じているので、次のような操作はすべて弾かれる。

- `Math.PI = 3;` は値を変更できない（non-writable）。
- `delete Math.PI` は削除できない（non-configurable）。
- `Object.defineProperty(Math, "PI", { writable: true })` も、`configurable: false` のためフラグ変更が拒否されエラーになる。

ここで**非 strict モードの落とし穴**が効いてくる。`Math.PI = 3;` を非 strict のスクリプトで実行しても、**例外は投げられず、しかし値も変わらない（読み直すと依然 `3.141592653589793`）**。フラグ違反の操作は非 strict では黙って無視されるからだ。strict モードなら同じ代入が `TypeError` を投げる。

`configurable: false` には1つだけ例外的な緩みがある。`configurable: false` でも `writable: true` のプロパティは、値の変更は許される。さらに `writable` については **`true` → `false` の一方向変更だけは `configurable: false` でも可能**である（一度読み取り専用にしたら二度と書き込み可能へは戻せない）。つまり「削除もフラグ変更も禁じつつ、値だけは書き換えられる／あるいは後から凍結だけできる」状態が作れる。

### 7.2 記述子の一括操作とフラグ込みクローン

複数のプロパティをフラグ付きで一気に定義するには `Object.defineProperties(obj, descriptors)` を使う。逆に全プロパティの記述子をまとめて取り出すには `Object.getOwnPropertyDescriptors(obj)` を使う。

この2つを組み合わせると、**フラグまで含めた正確なクローン**が作れる。単純な `for..in` ＋代入ループでは、コピー先のフラグはすべて `true` になり、シンボルや non-enumerable なプロパティも落ちてしまう。`getOwnPropertyDescriptors` は `for..in` と違い、シンボリックなキーも non-enumerable なプロパティも含む**すべて**の記述子を返すので、これらが保たれる。

```js
let clone = Object.defineProperties({}, Object.getOwnPropertyDescriptors(obj));
```

〔補足〕診断上の要点：オブジェクトを「安全にコピーしたつもり」で `for..in` を使うと、元が読み取り専用にしていたプロパティがコピー先では書き換え可能になる。防御ロジックのレビューでは、この種の「フラグを落とすコピー」がガード解除になっていないか見る。

脆弱性検証で重要な注意点がある。**非 strict モードでは、non-writable プロパティへの書き込みなどでエラーは出ないが、操作も成功しない（黙って無視される）**。だから「攻撃が効いたか」をエラーの有無で判断してはいけない。上の `Math.PI = 3;` がまさにその実例で、代入しても例外が出ず値も変わらない。

オブジェクト全体を封じるメソッドは次の通り。

| メソッド | 効果 |
|---|---|
| `Object.preventExtensions(obj)` | 新しいプロパティの追加を禁止。 |
| `Object.seal(obj)` | 追加/削除を禁止。既存の全プロパティに `configurable: false`。 |
| `Object.freeze(obj)` | 追加/削除/変更を禁止。既存の全プロパティに `configurable: false, writable: false`。 |
| `Object.isExtensible(obj)` | 追加が禁止なら `false`。 |
| `Object.isSealed(obj)` | seal 済みなら `true`。 |
| `Object.isFrozen(obj)` | freeze 済みなら `true`。 |

〔補足〕診断上の要点：`Object.freeze(Object.prototype)` はプロトタイプ汚染の緩和策としてよく提案される。だが原典が述べるとおり非 strict では違反が黙って無視されるので、「効いているか」は例外の有無ではなくフラグの状態（`Object.isFrozen`）で確認する必要がある。

---

## 8. クラスとプライベートフィールド

### 8.1 クラスは関数の一種

JavaScript の class は関数の一種で、`typeof User` は `"function"`。`class User {...}` は (1) `constructor` を本体とする `User` という関数を作り、(2) メソッドを `User.prototype` に格納する。つまりプロトタイプ継承の糖衣だが、単なる糖衣ではない3つの差がある。

1. `class` の関数は内部プロパティ `[[IsClassConstructor]]: true` を持ち、`new` 付きで呼ばないとエラー（`Class constructor User cannot be invoked without 'new'`）。
2. クラスメソッドは non-enumerable（`"prototype"` 内の全メソッドに `enumerable:false`）。
3. クラスは常に `use strict`。

### 8.2 クラスフィールドで束縛済みメソッドを作る

クラスフィールド（`name = "John"` の形）は `User.prototype` ではなく個々のオブジェクトに設定される。これを使うとイベントリスナ向けに `this` を固定したメソッドが作れる。

```js run
class Button {
  constructor(value) {
    this.value = value;
  }
  click = () => {
    alert(this.value);
  }
}

let button = new Button("hello");

setTimeout(button.click, 1000); // hello
```

`click = () => {...}` はオブジェクトごとに作られ、内部の `this` はそのオブジェクトを指す。ブラウザのイベントリスナで特に有用だ。

### 8.3 プライベートフィールド

`#` プレフィックスのプライベートフィールドは言語自体によって強制される。パブリックの同名フィールドと衝突しない。継承先からも直接アクセスできず（別クラスの `method()` 内で `this.#waterAmount` はエラー）、**`this['#name']` のような動的アクセスもできない**。これはプライバシー保証のための構文上の制約であり、後で見る Proxy の制限にもつながる。

---

## 9. 非同期実行モデル — microtask・macrotask・イベントループ

### 9.1 なぜ順序を知る必要があるか

DOM XSS や競合状態（レース）の検証では「どのコードがいつ動くか」を追えることが決定的だ。ブラウザのイベントループは、タスクを2種類のキューで管理する。

### 9.2 イベントループの基本

イベントループのアルゴリズムはこうだ。(1) タスクがある間、最も古いタスクから実行する。(2) タスクが現れるまでスリープし、1に戻る。タスクは macrotask queue（v8 用語）を作り、"first come – first served" で処理される。macrotask の例は、外部スクリプトのロード完了時の実行、`mousemove` のディスパッチ、`setTimeout` の期限到来時のコールバックなど。

2つの追加事項が重要。**エンジンがタスクを実行している間、レンダリングは決して起こらない**。DOM への変更はタスク完了後にのみ描画される。だから重い処理は `setTimeout` で分割すると途中経過を描画できる。

分割のときに知っておくべき具体的な数値がある。**ネストした `setTimeout`（コールバックの中でさらに `setTimeout` を呼ぶ形）には、ブラウザ側の最小遅延 4ms がある。`setTimeout(f, 0)` のように `0` を指定しても、実際には 4ms 以上待たされる。** そのため、重い処理を分割するときはスケジューリングを処理関数の先頭に置くほうが速く回る（この 4ms のオーバーヘッドが早く消化されるため）。CPU を占有しない分割処理や、タイミングを測る検証では、この 4ms が効いてくる。

### 9.3 microtask とその優先

microtask とは、我々のコードからのみ発生する小さなタスクで、通常は Promise が作る。`.then`/`.catch`/`.finally` ハンドラの実行が microtask になり、`await` の裏側でも microtask が使われる。`queueMicrotask(func)` で明示的にエンキューもできる。

Promise ハンドラは**常に非同期**で、Promise が即解決済みでも `.then` の後ろの行が先に走る。ECMA 標準は内部キュー `PromiseJobs`（＝microtask キュー）を規定し、FIFO で、他に何も実行中でないときのみ実行する。

決定的なルールが1つ。

> **すべての *macrotask* の直後に、エンジンは *microtask* キューのすべてのタスクを実行する。他の macrotask やレンダリングやその他何かを実行する前に。**

実行順の例。

```js
setTimeout(() => alert("timeout"));
Promise.resolve().then(() => alert("promise"));
alert("code");
```

出力は `code` → `promise` → `timeout`。同期コード → microtask（Promise）→ macrotask（timeout）の順だ。microtask 間には UI やネットワークのイベントが入らないので、その間はマウス座標もネットワークデータも変わらないことが保証される。

### 9.4 詳細アルゴリズム（原文のまとめ）

1. macrotask キューから最も古いタスクをデキューして実行（例: "script"）。
2. すべての microtask を実行（キューが空になるまで最も古いものから）。
3. 変更があればレンダリングする。
4. macrotask キューが空なら、現れるまで待つ。
5. 1に戻る。

新しい macrotask はゼロ遅延 `setTimeout(f)`、新しい microtask は `queueMicrotask(f)` でスケジュールする。長い重い計算は Web Workers（別スレッド）に逃がす。ただし **Web Workers は DOM にアクセスできない**。

### 9.5 未処理 rejection と async/await

未処理 rejection（unhandledrejection）は、microtask キューの終端で Promise のエラーが処理されていないとき発火する。`setTimeout(() => promise.catch(...), 1000)` で後から `catch` を足しても、先に `unhandledrejection` が出てしまう。

`async` 関数は常に Promise を返し、中で `await` が使える。`await promise` は Promise が settle するまで実行を「一時停止」し結果を返す。CPU は消費せず、その間エンジンは他のジョブを行える。モジュール内ではトップレベル `await` が使え、そうでなければ `(async () => { ... })();` でラップする万能レシピがある。`await` は `.then` を持つ任意の "thenable" を受け付ける。エラーは `try..catch` で捕捉でき、捕捉し忘れると `unhandledrejection` に流れる。

---

## 10. Proxy と Reflect — オブジェクト操作を横取りする

### 10.1 基本

Proxy とは、オブジェクトへの操作を横取り（インターセプト）できるラッパーのこと。

```js
let proxy = new Proxy(target, handler)
```

`target` はラップ対象（関数を含め何でもよい）、`handler` は操作を横取りするメソッド（trap）の集合。trap がなければ操作は `target` にそのまま転送される。空の handler の Proxy は透過的なラッパーになる。内部メソッドと trap の対応は次の通り（原文の表を再現）。

| Internal Method | Handler Method | Triggers when... |
|-----------------|----------------|-------------|
| `[[Get]]` | `get` | reading a property |
| `[[Set]]` | `set` | writing to a property |
| `[[HasProperty]]` | `has` | `in` operator |
| `[[Delete]]` | `deleteProperty` | `delete` operator |
| `[[Call]]` | `apply` | function call |
| `[[Construct]]` | `construct` | `new` operator |
| `[[GetPrototypeOf]]` | `getPrototypeOf` | Object.getPrototypeOf |
| `[[SetPrototypeOf]]` | `setPrototypeOf` | Object.setPrototypeOf |
| `[[IsExtensible]]` | `isExtensible` | Object.isExtensible |
| `[[PreventExtensions]]` | `preventExtensions` | Object.preventExtensions |
| `[[DefineOwnProperty]]` | `defineProperty` | Object.defineProperty, Object.defineProperties |
| `[[GetOwnProperty]]` | `getOwnPropertyDescriptor` | Object.getOwnPropertyDescriptor, `for..in`, `Object.keys/values/entries` |
| `[[OwnPropertyKeys]]` | `ownKeys` | Object.getOwnPropertyNames, Object.getOwnPropertySymbols, `for..in`, `Object.keys/values/entries` |

JavaScript は不変条件（invariants）を強制する。例えば `[[Set]]` は成功時 `true`、失敗時 `false` を返さねばならず、`[[GetPrototypeOf]]` はプロキシと target で同じプロトタイプを返さねばならない。

### 10.2 Reflect

`Reflect` は内部メソッドの最小ラッパーで、Proxy の作成を楽にする。`Proxy` で trap 可能なすべての内部メソッドについて、`Reflect` に同名・同引数のメソッドがある。

| Operation | `Reflect` call | Internal method |
|-----------------|----------------|-------------|
| `obj[prop]` | `Reflect.get(obj, prop)` | `[[Get]]` |
| `obj[prop] = value` | `Reflect.set(obj, prop, value)` | `[[Set]]` |
| `delete obj[prop]` | `Reflect.deleteProperty(obj, prop)` | `[[Delete]]` |
| `new F(value)` | `Reflect.construct(F, value)` | `[[Construct]]` |

getter を扱う Proxy では `receiver`（正しい `this`）を渡す必要があり、`return Reflect.get(target, prop, receiver);`（短くは `Reflect.get(...arguments)`）が安全な定型句になる。

### 10.3 攻撃・診断に効く制限（4つ）

1. **組み込みオブジェクトの内部スロット**：`Map`、`Set`、`Date`、`Promise` はデータを内部スロット（`Map` なら `[[MapData]]`）に持ち、組み込みメソッドは `[[Get]]/[[Set]]` を経由せず直接アクセスする。だから `new Proxy(new Map(), {}).set('test', 1)` はエラー。回避は `get` trap で `value.bind(target)` を返すこと。**例外は `Array` で、内部スロットを使わないのでそのままプロキシ化できる**。なぜ `Array` だけ例外なのかというと、`Array` は言語の中でも登場が古く、内部スロットという設計が導入される前から存在するためである。歴史的な経緯でデータを内部スロットに隠していないので、プロキシの `get`/`set` trap がそのまま効く。
2. **プライベートフィールド**も内部スロット実装なので同様に失敗する。
3. **Proxy ≠ target**：厳密等価 `===` はインターセプトできない。「オブジェクトを等価比較するすべての操作と組み込みクラスは、オブジェクトとプロキシを区別する」。`Set` のキーに元オブジェクトを入れた後プロキシ化すると `has` が `false` になる。
4. **パフォーマンス**：最も単純なプロキシでもプロパティアクセスが数倍遅い。

### 10.4 各 trap の引数と挙動 — レビューで効く細部

trap は単に呼ばれるだけでなく、決められた引数と戻り値の規約を持つ。防御コードの正しさを判定するとき、この規約を満たしているかが焦点になる。主要なものを原文にもとづき挙げる。

- **`get(target, property, receiver)`**：`receiver` は、target のプロパティが getter だった場合にその getter で `this` として使われるオブジェクトのこと。通常は `proxy` 自身（またはプロキシを継承したオブジェクト）を指す。getter を持つオブジェクトを正しくラップするには、`get` trap の中で `return Reflect.get(target, prop, receiver);`（短くは `Reflect.get(...arguments)`）と書き、`receiver` を getter に渡す必要がある。これを怠ると `this` が target になり、継承先での getter がずれる。
- **`set(target, property, value, receiver)`**：**成功時は `true`、失敗時は `false` を返さなければならない**。`false` を返すと代入は `TypeError` を引き起こす。戻り値を書き忘れたり falsy を返したりすると、意図せず `TypeError` になる。防御用の `set` trap を書くとき、この戻り値規約の抜けはよくあるバグである。
- **`ownKeys(target)`**：`Object.keys`／`for..in`／`Object.getOwnPropertyNames` などが使う。ここで**オブジェクトに実在しないキーを返しても `Object.keys` はそれを列挙しない**。理由は、`Object.keys` は `enumerable` フラグの立ったプロパティだけを返す仕様で、各キーについて内部メソッド `[[GetOwnProperty]]`（trap 名 `getOwnPropertyDescriptor`）を呼んで記述子を取りにいくが、実在しないキーは記述子が空で `enumerable` フラグを持たないためスキップされるからだ。「`ownKeys` で偽のキーを足せば列挙に混ぜられる」と誤解しやすいので注意する。
- **`apply(target, thisArg, args)`**：プロキシを関数として呼ぶ操作を処理する。**プロキシは通常のラッパー関数と違い、`length` や `name` などのプロパティの読み書きもすべて target へ転送する**。たとえば手書きのラッパー関数だと `wrapper.length` が `0` になってしまうが、プロキシなら target 関数の `length`（引数の数）がそのまま見える。

### 10.5 撤回可能プロキシと `WeakMap` 保存パターン

`Proxy.revocable(target, handler)` は `revoke()` で target への参照を切れる撤回可能プロキシを作る。

```js
let {proxy, revoke} = Proxy.revocable(target, handler)
```

`revoke()` を呼ぶと、プロキシから target への内部参照がすべて除去され、両者は切り離される。以後 `proxy.data` のようなアクセスは Error になる。`revoke` は `proxy` とは分離して受け取れるので、`proxy` を外部へ渡しつつ `revoke` は手元に残す、という使い方ができる。

原文が示すのは、**プロキシをキー、対応する `revoke` を値として `WeakMap` に保存するパターン**である。`Map` ではなく `WeakMap` を使うのは、プロキシがどこからも参照されなくなったときにガベージコレクション（GC）をブロックしないためだ。プロキシが不要になれば `WeakMap` のエントリごと自動で回収される。

〔補足〕`get` trap で `value.bind(target)` を返す解決策について、原文は「ラップされていないオブジェクトをメソッドに渡すと予期しない結果が生じうるので、どこでも使うべきではない」と警告している。防御コードのレビューで、この bind による横流しがガジェットを生んでいないか見る観点になる。

---

## 11. ブラウザ環境 — DOM / BOM / CSSOM

### 11.1 host environment としてのブラウザ

JavaScript 仕様は実行プラットフォームを host environment（ホスト環境）と呼ぶ。ブラウザはこれに独自のオブジェクトと関数を加える。ルートは `window` で、2つの役割を持つ。(1) JavaScript のグローバルオブジェクト、(2) ブラウザウィンドウを表し制御するメソッドの提供。

- **DOM（Document Object Model）** — ページ内容全体を変更可能なオブジェクトとして表す。`document` が主要なエントリポイント。仕様は DOM Living Standard（https://dom.spec.whatwg.org）。DOM はブラウザ専用ではなく、サーバサイドの HTML 処理でも使える。
- **CSSOM（CSS Object Model）** — CSS ルールとスタイルシートのための別仕様（https://www.w3.org/TR/cssom-1/）。実務ではほぼ CSS クラスの追加/削除で足りる。
- **BOM（Browser Object Model）** — ドキュメント以外を扱う追加オブジェクト。`navigator`（`navigator.userAgent` / `navigator.platform`）、`location`（URL の読み取り・リダイレクト）、`alert`/`confirm`/`prompt` などが含まれる。

`location` はリダイレクトに使えるので、URL を組み立てる箇所はオープンリダイレクトの観測点になる。

```js run
alert(location.href); // shows current URL
if (confirm("Go to Wikipedia?")) {
  location.href = "https://wikipedia.org"; // redirect the browser to another URL
}
```

仕様の対応は、DOM 仕様＝ドキュメント構造・操作・イベント、CSSOM＝スタイル、HTML 仕様＝HTML 言語に加え BOM（`setTimeout`、`alert`、`location` など）。調べるときは「WHATWG [用語]」「MDN [用語]」で検索するのが便利、と原文は勧める。

---

## 12. DOM ノードのプロパティ — XSS シンクとセーフシンクの一次定義

### 12.1 DOM ノードのクラス階層

DOM ノードはクラス階層を持つ。ルートは `EventTarget`、それを `Node` が継承する。

| クラス | 役割 |
|---|---|
| `EventTarget` | 全ノードのルート抽象クラス。イベントをサポートする基底。 |
| `Node` | ツリー機能 `parentNode`、`nextSibling`、`childNodes` を提供する抽象クラス。 |
| `Document` | ドキュメント全体。グローバル `document` はこのクラス。 |
| `CharacterData` | `Text` と `Comment` の抽象基底。 |
| `Text` / `Comment` | 要素内テキスト／コメント。 |
| `Element` | 要素の基底。`children`、`querySelector` などを提供。`HTMLElement` の基底。 |
| `HTMLElement` | 全 HTML 要素の基本クラス。`HTMLInputElement`、`HTMLAnchorElement` などに継承される。 |

`<input>` は `HTMLInputElement` → `HTMLElement` → `Element` → `Node` → `EventTarget` → `Object` の順でプロパティを継承する。`console.dir(elem)` は要素を DOM オブジェクトとして表示し、プロパティ探索に向く。`nodeType` は `1`=要素、`3`=テキスト、`9`=document。タグ名は XML モード以外では常に大文字（HTML モードでは `<BoDy>` も `BODY`）。

〔補足〕仕様上、DOM のこれらのクラスは JavaScript ではなく **IDL（Interface Description Language, インターフェース記述言語）** という言語で記述される。IDL とは、言語に依存しない形で「このオブジェクトはどんなプロパティやメソッドを持つか」を定義するための記法のこと。だから WHATWG DOM 仕様を読むと、見慣れない型注釈付きの定義が並ぶ。

タグ名を取るプロパティには `nodeName` と `tagName` の2つがあり、違いを押さえておく。**`tagName` は `Element` ノードにのみ存在する**。一方 **`nodeName` は任意の `Node` に定義される**。要素に対してはどちらも同じ（`BODY` など）を返すが、要素以外のノードでは `nodeName` だけが機能し、ノード型を表す文字列を返す。たとえばコメントノードなら `#comment`、document ノードなら `#document`。DOM を走査していて「テキストやコメントも含めて種類を知りたい」なら `nodeName`、「要素のタグ名だけでよい」なら `tagName` を使う。

### 12.2 コンテンツ系プロパティ — シンク分類表

ここが XSS 検証の中核だ。値を書き込むと「HTML として解釈されるか、テキストとして扱われるか」でシンクの危険度が決まる。

| プロパティ | HTML として解釈されるか | 備考 |
|---|---|---|
| `innerHTML` | **される（危険）** | 要素ノードのみ。不正 HTML は修正される。`<script>` を挿入しても HTML の一部にはなるが実行はされない。 |
| `outerHTML` | **される（危険）** | 書き込みは要素を変更せず、DOM から除去して新しい HTML をその位置に挿入する。書き込んだ変数は古い値を保持し続ける。 |
| `insertAdjacentHTML` | **される（危険）** | 後述（第14節）。任意の HTML を追加する主要手段。 |
| `document.write` | **される（危険）** | 後述（第14節）。ロード中のみ機能。 |
| `nodeValue` / `data` | されない | 非要素ノード（テキスト、コメント）の内容。 |
| `textContent` | **されない（安全）** | テキストとして挿入。ユーザ入力の表示に使うべき。 |
| `value` / `href` / `id` | — | 各要素の値・リンク先・id。 |

`innerHTML +=` には強い副作用がある。これは `innerHTML = innerHTML + "..."` の短縮で、古いコンテンツを一度ゼロ化して書き直す。そのため画像など全リソースが再ロードされ、選択やユーザ入力中の `<input>` テキストも消える。

`innerHTML` と `textContent` の差を示す原文のデモ。

```html run
<div id="elem1"></div>
<div id="elem2"></div>

<script>
  let name = prompt("What's your name?", "<b>Winnie-the-Pooh!</b>");

  elem1.innerHTML = name;
  elem2.textContent = name;
</script>
```

`elem1` は名前を HTML として受け取るのでタグが効いて太字になる（＝ユーザ入力に `<img src=x onerror=...>` を入れれば XSS）。`elem2` は文字どおり `<b>...</b>` が見える。原文いわく「ほとんどの場合、ユーザからのテキストはテキストとして扱いたい。`textContent` への代入はまさにそれを行う」。**守る側の基本は、ユーザ由来の値を出すなら `textContent`（や後述の `append`）を使うこと**である。

### 12.3 DOM ノードは普通のオブジェクト — `Element.prototype` の改変が全要素に及ぶ

DOM ノードは特別に見えるが、実体は通常の JavaScript オブジェクトである。だから独自プロパティや独自メソッドを足せる（`document.body.myData = {...}`、`document.body.sayTagName = function() {...}`）。

さらに踏み込むと、第5.3節で見た「ネイティブプロトタイプの改変」がここでも効く。**組み込みプロトタイプ `Element.prototype` にメソッドを追加すると、そのメソッドは全 DOM 要素で使えるようになる**。

```js run
Element.prototype.sayHi = function() {
  alert(`Hello, I'm ${this.tagName}`);
};

document.documentElement.sayHi(); // Hello, I'm HTML
document.body.sayHi();            // Hello, I'm BODY
```

`Element.prototype` は `HTMLElement` 以下すべての要素の祖先プロトタイプなので、`document.body` でも `document.documentElement`（`<html>`）でも同じメソッドが呼べる。これは第5.3節の「ネイティブプロトタイプはグローバルなので衝突しやすく、変更はポリフィル以外では戒められる」という警告が、言語の組み込み型だけでなく DOM の要素にもそのまま当てはまることを示す具体例である。裏を返せば、プロトタイプ汚染が `Element.prototype` にまで及べば、ページ上の全要素の挙動を横断的に書き換えられるということでもある。

---

## 13. 属性とプロパティ — 生の値と正規化された値

ブラウザは HTML をパースして DOM オブジェクトを作り、多くの標準 HTML 属性を自動的に DOM プロパティにする。ただし対応は1対1ではない。非標準属性は DOM プロパティを生まない（`<body something="x">` で `document.body.something` は `undefined`）。属性を正確に操作するメソッドは次の通り。

| メソッド | 動作 |
|---|---|
| `elem.hasAttribute(name)` | 存在をチェック |
| `elem.getAttribute(name)` | 値を取得 |
| `elem.setAttribute(name, value)` | 値を設定 |
| `elem.removeAttribute(name)` | 属性を削除 |
| `elem.attributes` | 全属性のコレクション（iterable、標準・非標準を含む） |

HTML 属性は名前が大文字小文字を区別せず、値は常に文字列。一方 DOM プロパティは型付きで、名前は case-sensitive。この差が検証で効く。

- `input.checked` は boolean、`style` プロパティはオブジェクト。
- **`href` DOM プロパティは常に完全な URL** に正規化される。`<a href="#hello">` で `a.getAttribute('href')` は `#hello`、`a.href` は `http://site.com/page#hello`。
- `input.value` は 属性→プロパティ の方向にのみ同期する。`input.value = 'newValue'` の後でも `getAttribute('value')` は元の値のまま。
- `data-*` 属性は `dataset` で読める（`data-order-state` → `dataset.orderState`）。

〔補足〕診断上の要点：`a.href`（常に絶対 URL）と `getAttribute('href')`（生の文字列）の差は、`javascript:` スキームや相対パス由来のオープンリダイレクト／DOM XSS を検査するときの観測点の選択に直結する。生の値を見たいなら `getAttribute` を使う。

---

## 14. ドキュメント変更 API — どれがエスケープするか

要素の作り方は `document.createElement(tag)`、`document.createTextNode(text)`、`elem.cloneNode(true/false)`。挿入メソッドは次の通りで、**文字列引数はすべてテキストとして（`<`, `>` をエスケープして）挿入される＝安全**。

| メソッド | 挿入位置 | 文字列引数の扱い |
|---|---|---|
| `node.append(...)` | `node` の末尾 | テキストとして（エスケープ） |
| `node.prepend(...)` | `node` の先頭 | 同上 |
| `node.before(...)` | `node` の直前 | 同上 |
| `node.after(...)` | `node` の直後 | 同上 |
| `node.replaceWith(...)` | `node` を置換 | 同上 |
| `node.remove()` | 削除 | — |

原文いわく「文字列は `elem.textContent` がそうするように安全な方法で挿入される」。`div.before('<p>Hello</p>', ...)` の結果は `&lt;p&gt;Hello&lt;/p&gt;` になる。

### 14.1 旧式の挿入/削除メソッド

上の `append`／`before` などは新しい API で、実コードや古い解説記事では旧式のメソッドが今も多く登場する。XSS 解析でコードを読むときに必ず出てくるので押さえておく。これらは**ノード（文字列ではなく DOM ノード）**を対象に取る。

| メソッド | 動作 |
|---|---|
| `parentElem.appendChild(node)` | `node` を `parentElem` の最後の子として追加 |
| `parentElem.insertBefore(node, nextSibling)` | `node` を `parentElem` 内の `nextSibling` の前に挿入 |
| `parentElem.replaceChild(node, oldChild)` | `parentElem` の子のうち `oldChild` を `node` で置換 |
| `parentElem.removeChild(node)` | `parentElem` から `node` を削除（`node` がその子である前提） |

これらはいずれも、挿入または削除したノードを戻り値として返す。新式の `append`／`replaceWith`／`remove` と機能はほぼ重なるが、旧式は文字列を直接受け取らずノードを要求する点が違う（だから旧式メソッド自体は HTML 文字列を解釈するシンクにはならない。危険なのはあくまで `innerHTML` や `insertAdjacentHTML` の側だ）。

### 14.2 `DocumentFragment`

`DocumentFragment` は、複数のノードをまとめて受け渡すためのラッパーとして機能する特別な DOM ノードのこと。`DocumentFragment` に子ノードを詰めておき、それをどこかへ挿入すると、ラッパー自体ではなく**中身のノード群が代わりに挿入される**（"blends in" する）。

現代では明示的に使われることは稀で、配列を返して `...`（スプレッド）で `append` すれば足りる。ただし `<template>` 要素のような上位概念がこの `DocumentFragment` の仕組みの上に成り立っているため、名前と挙動は知っておくとよい。

対して `insertAdjacentHTML(where, html)` は第2引数を**HTML として**挿入する＝危険なシンク。第1引数は位置指定。

| `where` の値 | 挿入位置 |
|---|---|
| `"beforebegin"` | `elem` の直前 |
| `"afterbegin"` | `elem` の内部・先頭 |
| `"beforeend"` | `elem` の内部・末尾 |
| `"afterend"` | `elem` の直後 |

兄弟の `insertAdjacentText`（テキストとして）、`insertAdjacentElement`（要素）もあるが「実際にはほとんど `insertAdjacentHTML` のみが使われる」。

`document.write(html)` はロード中のみ機能し、ロード後に呼ぶと既存ドキュメントを消去する。DOM 変更を伴わずページテキストに直接書くため速いが、これも HTML として書き込むシンクである。

まとめると、シンク分類の骨格はこうだ。**HTML として解釈するもの**＝`innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`。**テキストとして安全なもの**＝`textContent`、`append`／`prepend`／`before`／`after`／`replaceWith`、`insertAdjacentText`、`createTextNode`。

---

## 15. イベント — 割り当て・伝播・デリゲーション

### 15.1 ハンドラの割り当て3方式

イベントとは、クリックやキー入力など「何かが起きた」という信号のこと。主要なものは `click`、`contextmenu`（右クリック）、`mouseover`/`mouseout`、`keydown`/`keyup`、`submit`、`focus`、`DOMContentLoaded`、`transitionend` など。ハンドラの割り当ては3方式ある。

1. **HTML 属性** `on<event>`（`<input onclick="alert('Click!')">`）。ブラウザは属性の内容から関数を作り DOM プロパティに書く。名前は case-insensitive。
2. **DOM プロパティ** `elem.onclick = function(){...}`。`onclick` は1つしかないので複数ハンドラは付けられない（上書きされる）。名前は case-sensitive。削除は `= null`。
3. **`addEventListener(event, handler, [options])`**。同一イベントに複数付けられる。

`options` は `once`（発火後に自動削除）、`capture`（処理フェーズ）、`passive`（`true` なら `preventDefault` を呼ばない）。ハンドラの削除には割り当てたのと同じ関数を渡す必要があり、無名関数だと削除できない。`DOMContentLoaded` のような一部イベントは `addEventListener` でしか動かない。

よくある間違い：`button.onclick = sayThanks;`（正）に対し `sayThanks()`（誤、結果 `undefined` が代入される）。ハンドラに `setAttribute` を使うと、属性は文字列なので関数が文字列化され壊れる。

イベントオブジェクトは `event.type`、`event.currentTarget`（＝`this`。ただし矢印関数や bind 時は `event.currentTarget` から要素を得る）、`event.clientX`/`clientY` を持つ。`addEventListener` には関数の代わりにオブジェクトも渡せ、その場合 `obj.handleEvent(event)` が呼ばれる。

〔補足〕診断上の要点：`handleEvent` 内での動的メソッド名解決（`this[method](event)`）は、イベント型名を攻撃者が制御できる状況でプロトタイプ経由のメソッド呼び出し（ガジェット）になりうる。次の `data-action` デリゲーションも同型だ。

### 15.2 バブリングとキャプチャ

原文の定義。

> **要素でイベントが発生すると、まずその要素のハンドラが走り、次に親、さらに他のすべての祖先へと上っていく。**

これがバブリング（bubbling）。`FORM > DIV > P` の `<p>` をクリックすると `p` → `div` → `form` → … → `document` まで上る。ほとんど全イベントがバブルするが、**`focus` はバブルしない**などの例外がある。

- `event.target` — イベントを引き起こした最も深い要素。バブリング中も変わらない。
- `this`（＝`event.currentTarget`）— 今ハンドラが動いている要素。
- `event.stopPropagation()` — 上方向への移動を止める。`event.stopImmediatePropagation()` はそれに加え、同じ要素上の他のハンドラも止める。

原文は「必要もなくバブリングを停止するな」と強く警告する。分析システムが `document` 上でクリックを捕捉しようとしても、途中で `stopPropagation` されると「デッドゾーン」ができてしまう。脆弱性検証でも、`stopPropagation` はイベントの観測を阻む要素として意識する。

伝播には3フェーズある。

```
（capturing: 下る）  HTML → BODY → FORM → DIV → P
（target）                                       P
（bubbling: 上る）    P → DIV → FORM → BODY → HTML
```

1. Capturing phase（下る）
2. Target phase（到達）
3. Bubbling phase（上る）

`on<event>` プロパティ・HTML 属性・2引数の `addEventListener` はキャプチャを知らず、第2・第3フェーズでのみ走る。キャプチャで捕まえるには `{capture: true}`（略して `true`）を渡す。キャプチャ中に `stopPropagation()` を呼ぶとバブリングも起きない。

いま自分がどのフェーズにいるかは `event.eventPhase` で分かる。**`event.eventPhase` は、そのハンドラが呼ばれたフェーズを表す番号を返す。値は capturing（下り）=`1`、target（到達）=`2`、bubbling（上り）=`3`** である。あとの「手を動かす」では、この 1／2／3 を出力してフェーズの進行順を目で確かめる。

もう1つ、実装の予測可能性に効く保証がある。**同一要素・同一フェーズに複数のリスナを `addEventListener` で付けた場合、それらは設定した順（登録順）に実行されることが仕様で保証されている**。だから「先に登録したロギング用リスナは、後から登録した処理用リスナより必ず先に走る」と当てにできる（ただし `stopImmediatePropagation()` が挟まると後続は止まる）。

### 15.3 イベントデリゲーション

デリゲーション（delegation）とは、多数の子要素それぞれにハンドラを付けず、共通の祖先1つにハンドラを置いて `event.target` で判定するパターンのこと。堅牢な実装は原文のこれ。

```js
table.onclick = function(event) {
  let td = event.target.closest('td'); // (1)

  if (!td) return; // (2)

  if (!table.contains(td)) return; // (3)

  highlight(td); // (4)
};
```

`closest(selector)` で最も近い祖先の `<td>` を得て（1）、無ければ return（2）、ネストしたテーブルの外なら return（3）、該当すれば処理（4）。この `table.contains(td)` チェックが抜けると、ネストした別テーブルのクリックまで拾ってしまう。

マークアップ側にアクションを書く `data-action` パターンも普及している。

```html autorun height=60 run untrusted
<div id="menu">
  <button data-action="save">Save</button>
  <button data-action="load">Load</button>
  <button data-action="search">Search</button>
</div>

<script>
  class Menu {
    constructor(elem) {
      this._elem = elem;
      elem.onclick = this.onClick.bind(this); // (*)
    }

    save() {
      alert('saving');
    }

    load() {
      alert('loading');
    }

    search() {
      alert('searching');
    }

    onClick(event) {
      let action = event.target.dataset.action;
      if (action) {
        this[action]();
      }
    };
  }

  new Menu(menu);
</script>
```

`(*)` で `this.onClick` を bind するのが重要で、しないと内部の `this` が DOM 要素になり `this[action]` が壊れる。

〔補足〕診断上の要点：`this[action]()` は `action` が DOM 属性（しばしば HTML インジェクション経由で攻撃者が制御可能）から来るため、プロトタイプチェーン上の任意メソッド（`constructor`、`toString` 等）を呼ぶガジェットになりうる。原典はこれを推奨パターンとして提示しているので、実装として広く使われる一方、注入時にはガジェット性を持つ、と両面で理解する。

### 15.4 behavior パターンとデリゲーションの制限

behavior パターンは (1) 要素に振る舞いを表すカスタム属性を付け、(2) ドキュメント全体のハンドラがそれを追跡してアクションを実行する。原文の警告：「**document レベルのハンドラには常に `addEventListener` を使え**。`document.on<event>` は衝突を起こす（新しいハンドラが古いものを上書きする）」。実プロジェクトでは異なるコードが `document` に多数のハンドラを付けるのが普通だからだ。

原文は具体例を2つ挙げている。

- **Counter（カウンタ）**：ボタンに `data-counter` 属性を付けておき、`document.addEventListener('click', ...)` の中で `event.target.dataset.counter != undefined` かどうかを判定する。属性を持つボタンがクリックされたら、その要素に紐づくカウントを増やす。「振る舞い（クリックで数える）」を属性で宣言し、実処理は document 上の1つのハンドラに集約する形だ。
- **Toggler（トグラー）**：要素に `data-toggle-id` 属性で「切り替えたい対象要素の id」を書いておく。クリック時に document 上のハンドラが `document.getElementById(id)` でその対象を取り、`hidden` プロパティをトグルして表示/非表示を切り替える。

どちらも共通して、「HTML 側に属性で意図を書き、JavaScript 側は document 上の1ハンドラでそれを解釈する」という構造をとる。ここが攻撃面でもあり、`data-*` 属性を HTML インジェクションで注入できれば、既存の behavior ハンドラを外部から起動する部品として使える点は前小節の `data-action` と同じ観察点になる。

デリゲーションの制限は2つ。第一に**イベントはバブリングしなければならない**（バブルしないイベントや `stopPropagation` されたものは拾えない）。第二にコンテナレベルのハンドラが全イベントに反応するため CPU 負荷が増えうる（通常は無視できる）。

---

## 手を動かす

1. 本文Markdownをローカルに取得する。ブロックされていない環境ならサイトを直接開いてもよい。
   ```bash
   git clone --depth 1 --filter=blob:none --sparse https://github.com/javascript-tutorial/en.javascript.info.git
   cd en.javascript.info
   git sparse-checkout set --no-cone '/*.md' '/**/*.md'
   ```
2. ブラウザの開発者ツール（F12）でコンソールを開き、クロージャのデバッグ最適化を体感する。次を貼って `debugger;` で止まったら、コンソールで `alert(value)` を打ってみる。V8 系では「見えない／別の値」になることを確認する。
   ```js
   function f() {
     let value = "the closest value";
     function g() { debugger; }
     return g;
   }
   f()();
   ```
3. プロトタイプ汚染の入口を再現する。コンソールで次を実行し、`__proto__` を入れると代入が無視されることを見る。
   ```js
   let obj = {};
   let key = prompt("What's the key?", "__proto__");
   obj[key] = "some value";
   alert(obj[key]); // [object Object]
   ```
   続けて `let m = new Map(); m.set("__proto__","v"); alert(m.get("__proto__"))` と `Object.create(null)` 版を試し、回避できることを確認する。
4. シンクの違いを目で見る。空の HTML ページに `<div id="a"></div><div id="b"></div>` を置き、コンソールで次を実行する。`a` にだけタグが効くことを確認する。
   ```js
   let s = "<img src=x onerror=alert(1)>";
   a.innerHTML = s;   // 実行される（危険シンク）
   b.textContent = s; // 文字列のまま表示（安全）
   ```
5. イベントループの順序を確認する。次を実行し、`code` → `promise` → `timeout` の順に出ることを見る。
   ```js
   setTimeout(() => console.log("timeout"));
   Promise.resolve().then(() => console.log("promise"));
   console.log("code");
   ```
6. バブリングとキャプチャを観察する。ネストした要素に `addEventListener('click', fn)` と `addEventListener('click', fn, true)` の両方を付け、`event.eventPhase` を出力して、下り（1）→ target（2）→ 上り（3）の順を確かめる。

## つまずきポイント

- **`__proto__` はプロパティではなくアクセサ**。`Object.prototype` 上の getter/setter なので、`obj[userKey] = x` の `userKey` が `__proto__` だと `[[Prototype]]` を触ってしまう。`Object.create(null)` や `Map` で回避できる理由もここにある。
- **非 strict では失敗が黙って無視される**。non-writable への書き込みや `Object.freeze` 済みプロパティへの代入はエラーにならない。「効いたか」を例外の有無で判断せず、`Object.isFrozen` などフラグ状態で確認する。
- **`innerHTML` に `<script>` を入れても実行されない**。だが `<img src=x onerror=...>` や `<svg onload=...>` は実行される。「script が動かない＝安全」ではない。
- **`a.href` は常に絶対 URL に正規化される**。生の値がほしいなら `getAttribute('href')`。オープンリダイレクト検査で観測点を間違えやすい。
- **`eval` と `new Function` はスコープが違う**。`eval` は現在のレキシカル環境、`new Function`／`window.eval` はグローバル。到達できる機密が変わる。
- **`stopPropagation` はデッドゾーンを作る**。イベントを観測したいときや、逆に自分が防御コードを書くとき、安易に止めると分析やロギングが効かなくなる。
- **`setTimeout` のコールバックは `this=window`（ブラウザ）**。メソッドを直接渡すと `this` を失う。`bind` か矢印関数ラッパーで対処する。

## この節のまとめ

- レキシカル環境は変数の格納場所と探索順を定義する仕様上のオブジェクトで、関数は生成時のそれを `[[Environment]]` に記憶する。JavaScript の全関数はクロージャである。
- strict なしでの未宣言変数への代入、`var`、Function Declaration はグローバルオブジェクト（`window`）を汚染する経路になる。`"use strict"` とモジュールがこれを塞ぐ。
- `eval` は現在のスコープで、`new Function`／`window.eval` はグローバルスコープでコード文字列を実行する。到達できる識別子が違うのでシンクとして区別する。
- `this` は呼び出し時に「ドットの前のオブジェクト」で決まり、非 strict では `undefined` の代わりに `window` になる。`bind` で固定できる。
- プロトタイプは読み取りにのみ使われ、`__proto__` は `Object.prototype` 上のアクセサである。ユーザ提供キーの代入がここを突くとプロトタイプ汚染になる。`Map` と `Object.create(null)` が回避策。
- プロパティは `writable`/`enumerable`/`configurable` のフラグを持ち、`Object.freeze` などで封じられるが、非 strict では違反が黙って無視される。
- class は関数の糖衣だが `[[IsClassConstructor]]`、non-enumerable メソッド、常時 strict の3点で異なる。`#` プライベートフィールドは言語が強制し `this['#x']` では触れない。
- イベントループは macrotask と microtask を回し、各 macrotask の直後に microtask を全消化してからレンダリングや次の macrotask に進む。順序は同期 → microtask → macrotask。
- Proxy は内部メソッドを trap で横取りするが、組み込みの内部スロット・プライベートフィールド・`===` はインターセプトできない。`Reflect` が転送の定型句を与える。
- ブラウザ環境は DOM・CSSOM・BOM からなり、`document` が DOM のエントリポイント、`location` はリダイレクトの観測点。
- DOM ノードのコンテンツ系プロパティは「HTML として解釈する（`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`）」と「テキストとして安全（`textContent`/`append` 系）」に二分でき、これが XSS シンク分類の骨格になる。
- 属性（生の文字列、case-insensitive）と DOM プロパティ（型付き、正規化、case-sensitive）は一致せず、`href` の絶対 URL 化や `value` の片方向同期など差がある。
- イベントは capturing → target → bubbling の3フェーズで伝播し、デリゲーションと `data-action` behavior パターンは実装として普及する一方、`this[action]()` は注入時のガジェットになりうる。

## 理解度チェック

1. `eval` と `new Function` は、どちらもコード文字列を実行するが、実行されるスコープが決定的に違う。それぞれどのスコープで動くか。
   ▶ 答え：`eval` は呼び出された場所の「現在のレキシカル環境」で動き、外側のローカル変数が見え・変更もできる（ただし strict モードでは eval 自身の環境を持つ）。`new Function`（および `window.eval`）はグローバル環境で動き、ローカル変数にはアクセスできない。
2. `let obj = {}; obj["__proto__"] = "x";` として `obj["__proto__"]` を読むと `"x"` が返らない。なぜか。回避策を2つ挙げよ。
   ▶ 答え：`__proto__` は `Object.prototype` 上のアクセサ（getter/setter）で、代入すると `[[Prototype]]` を設定しようとするが文字列はプロトタイプになれず無視されるため。回避策は (1) `Map` を使う、(2) `Object.create(null)`（または `{__proto__: null}`）のプロトタイプなしオブジェクトを使う。
3. ユーザ入力を画面に表示したい。`innerHTML` と `textContent` のどちらを使うべきか、理由とともに答えよ。
   ▶ 答え：`textContent`。`innerHTML` は値を HTML として解釈するので `<img src=x onerror=...>` などが実行され XSS になる。`textContent` はテキストとして挿入し `<`, `>` をエスケープするので安全。
4. 次のコードの出力順を答えよ。`setTimeout(() => alert("timeout")); Promise.resolve().then(() => alert("promise")); alert("code");`
   ▶ 答え：`code` → `promise` → `timeout`。同期コードが先、次に microtask（Promise の `.then`）、最後に macrotask（`setTimeout`）。各 macrotask の直後に microtask が全消化されるため。
5. `<a href="#hello">` について、`a.getAttribute('href')` と `a.href` はそれぞれ何を返すか。どちらが「生の値」か。
   ▶ 答え：`getAttribute('href')` は `#hello`（生の文字列）、`a.href` は `http://site.com/page#hello`（絶対 URL に正規化された値）。生の値は `getAttribute` の方。
6. 非 strict モードで `Object.freeze` 済みのプロパティに代入したとき、どうなるか。攻撃検証でこれがなぜ問題か。
   ▶ 答え：エラーは出ないが操作も成功しない（黙って無視される）。「例外が出ない＝防御が効いていない」と誤読しやすいので、`Object.isFrozen` などフラグ状態で確認する必要がある。
7. イベントデリゲーションの `data-action` パターンで `this[event.target.dataset.action]()` を呼ぶ実装は、なぜ注入時にガジェットになりうるか。
   ▶ 答え：`action` は DOM 属性由来で、HTML インジェクションで攻撃者が制御できることがある。任意の文字列で `this[...]` を呼べるため、プロトタイプチェーン上の `constructor` や `toString` など意図しないメソッドを起動できる。
8. V8 系ブラウザでクロージャ内の変数を `debugger` で見ようとすると「見えない／別の値が見える」ことがある。なぜか。
   ▶ 答え：エンジンが「外側変数が使われない」と判断して最適化・除去するため。原文いわくこれは「デバッガのバグではなく V8 の特別な機能」で、同名の外側変数が代わりに見えることもある。

## 出典

- https://javascript.info/ （サイト本体。取得できず、以下の一次ソースの逐語読解にもとづく）
- https://github.com/javascript-tutorial/en.javascript.info （公式ソースリポジトリ。サイト本文と同一の Markdown）
- https://javascript.info/closure
- https://javascript.info/var
- https://javascript.info/global-object
- https://javascript.info/new-function
- https://javascript.info/eval
- https://javascript.info/object-methods
- https://javascript.info/bind
- https://javascript.info/prototype-inheritance
- https://javascript.info/native-prototypes
- https://javascript.info/prototype-methods
- https://javascript.info/property-descriptors
- https://javascript.info/class
- https://javascript.info/private-protected-properties-methods
- https://javascript.info/microtask-queue
- https://javascript.info/event-loop
- https://javascript.info/async-await
- https://javascript.info/proxy
- https://javascript.info/browser-environment
- https://javascript.info/basic-dom-node-properties
- https://javascript.info/dom-attributes-and-properties
- https://javascript.info/modifying-document
- https://javascript.info/introduction-browser-events
- https://javascript.info/bubbling-and-capturing
- https://javascript.info/event-delegation

<!-- self-read: https://javascript.info/ | 組織のegressポリシーで javascript.info:443 への接続が403拒否。本文は公式GitHubミラーで取得済みだが、ライブ実行例・図版・課題解答はサイト上のみ -->
<!-- sources: https://javascript.info/, https://github.com/javascript-tutorial/en.javascript.info, https://javascript.info/closure, https://javascript.info/var, https://javascript.info/global-object, https://javascript.info/new-function, https://javascript.info/eval, https://javascript.info/object-methods, https://javascript.info/bind, https://javascript.info/prototype-inheritance, https://javascript.info/native-prototypes, https://javascript.info/prototype-methods, https://javascript.info/property-descriptors, https://javascript.info/class, https://javascript.info/private-protected-properties-methods, https://javascript.info/microtask-queue, https://javascript.info/event-loop, https://javascript.info/async-await, https://javascript.info/proxy, https://javascript.info/browser-environment, https://javascript.info/basic-dom-node-properties, https://javascript.info/dom-attributes-and-properties, https://javascript.info/modifying-document, https://javascript.info/introduction-browser-events, https://javascript.info/bubbling-and-capturing, https://javascript.info/event-delegation -->
<!-- terms: レキシカル環境, クロージャ, [[Environment]], ホイスティング, グローバルオブジェクト, globalThis, eval, new Function, this束縛, bind, 部分適用, プロトタイプ継承, [[Prototype]], __proto__, プロトタイプ汚染, Object.create(null), プロパティ記述子, writable, enumerable, configurable, Object.freeze, クラスフィールド, プライベートフィールド, microtask, macrotask, イベントループ, queueMicrotask, async/await, Proxy, Reflect, 内部スロット, DOM, BOM, CSSOM, innerHTML, outerHTML, textContent, insertAdjacentHTML, document.write, DOM属性とプロパティ, dataset, イベントバブリング, イベントキャプチャ, stopPropagation, イベントデリゲーション, data-action, behaviorパターン, IIFE, DocumentFragment, appendChild, insertBefore, nodeName, tagName, IDL, eventPhase, Object.getOwnPropertyDescriptors, Object.defineProperties, Proxy.revocable, Math.PI -->
