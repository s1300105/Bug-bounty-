## ES6+・クロージャ・プロトタイプ・非同期の土台

クライアントサイド脆弱性（XSS、DOM Clobbering、プロトタイプ汚染、レースコンディションなど）を正しく理解するには、まず「なぜそのコードがその挙動になるのか」をJavaScript言語仕様のレベルで説明できる必要があります。本節では、脆弱性ハンティングの土台となる4つの柱——**スコープとクロージャ**、**プロトタイプチェーン**、**class構文**、**非同期処理（イベントループ）**——を、原典（javascript.info / MDN / Eloquent JavaScript）の構成に沿って整理します。攻撃コードそのものではなく、あくまで「防御側がコードを読み解くための仕組み理解」に焦点を当てます。

### 1. スコープとクロージャ

#### var / let / const とスコープの違い

`var` は関数スコープ、`let`・`const` はブロックスコープを持ちます。この違いはホイスティング（変数宣言の巻き上げ）の挙動と密接に関係します。

```javascript
function example() {
  if (true) {
    var x = 1;   // 関数スコープ → forブロックの外でも参照可能
    let y = 2;   // ブロックスコープ → ブロック外では参照不可
  }
  console.log(x); // 1
  console.log(y); // ReferenceError: y is not defined
}
```

`let`・`const` で宣言された変数は、宣言前にアクセスすると「TDZ（Temporal Dead Zone、一時的デッドゾーン）」により `ReferenceError` になります。これは `var` が「宣言だけ巻き上げられ値は `undefined`」になるのと対照的です。この違いを理解していないと、リンター回避や難読化されたコードの中で「実際にどの変数がどのスコープを指しているか」を誤読しやすく、コードレビュー（脆弱性ハンティングにおける静的解析）で見落としが生まれます。

> 出典: The Modern JavaScript Tutorial — https://javascript.info/ （"Variables scope, closure" モジュールで関数スコープ/ブロックスコープと閉包の関係を体系的に解説）

#### クロージャ（closure）とは何か、なぜ生まれるか

クロージャとは、「関数が定義された時点のレキシカル環境（外側スコープの変数群）を、関数が実行される場所とは関係なく保持し続ける」仕組みです。JavaScriptの関数はすべて内部的に `[[Environment]]` という隠しプロパティを持ち、これが定義時のスコープチェーンへの参照を保持します。関数がどこで呼ばれても、この参照は変わりません。

```javascript
function makeCounter() {
  let count = 0;              // このcountはmakeCounter呼び出しごとに新しく作られる
  return function() {
    count++;                  // 外側スコープのcountをクロージャとして参照
    return count;
  };
}

const counter1 = makeCounter();
const counter2 = makeCounter();
console.log(counter1()); // 1
console.log(counter1()); // 2
console.log(counter2()); // 1 （counter1とは別のcount変数を保持している）
```

**なぜこうなるのか**: `makeCounter()` が呼ばれるたびに新しい実行コンテキスト（と新しい `count` 変数）が生成され、返される内部関数はその実行コンテキストへの参照（レキシカル環境オブジェクト）を保持します。JavaScriptエンジンは、外部からまだ参照されているレキシカル環境をガベージコレクションの対象から外すため、`makeCounter` の実行が終わっても `count` はメモリ上に生き続けます。これが「関数の外からは触れないがプログラムの寿命の間ずっと保持される状態（プライベート変数のシミュレーション）」を作り出す原理です。

クロージャは脆弱性ハンティングの観点でも重要です。たとえば以下のような場面で頻出します。

- モジュールパターンでAPIキーやトークンを「プライベート変数」として隠蔽している実装 → クロージャの中身自体はJS実行コンテキスト内から到達不能でも、`eval`や`Function`コンストラクタ経由でスコープを操作されると露出しうる（安全でないコード生成が二次被害を生む一因）。
- イベントハンドラ内でループ変数を誤ってクロージャ捕捉する古典的バグ（`var i` で書かれた `for` ループ内の非同期コールバックが全て同じ `i` の最終値を参照する）は、意図しない状態共有を生み、権限チェックロジックなどに紛れ込むと論理的な脆弱性の温床になります。

```javascript
// 古典的な落とし穴（varの場合）
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0); // 3, 3, 3 が出力される
}
// letなら各反復でブロックスコープの新しいiが作られるため 0, 1, 2 になる
for (let j = 0; j < 3; j++) {
  setTimeout(() => console.log(j), 0); // 0, 1, 2
}
```

> 出典: The Modern JavaScript Tutorial — https://javascript.info/ （クロージャとレキシカル環境の仕組みを図解付きで解説）
> 出典: MDN JavaScript Guide（Closures） — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide （Advanced topicsのClosures章で、レキシカルスコープとクロージャによるプライベート状態のカプセル化を解説）

### 2. プロトタイプチェーン

#### `__proto__` と `[[Prototype]]`、プロパティ解決の仕組み

JavaScriptのオブジェクトはクラスベースではなくプロトタイプベースの継承モデルを採用しています。すべてのオブジェクトは内部スロット `[[Prototype]]`（ES5以前の非標準アクセサとしては `__proto__`）を持ち、あるプロパティにアクセスしたとき、そのオブジェクト自身が持っていなければ `[[Prototype]]` を辿って上位のオブジェクトを検索します。これを繰り返してどこにも見つからなければ `undefined` を返し、これ以上遡れない終端が `Object.prototype` で、その `[[Prototype]]` は `null` です。

```javascript
const animal = { eats: true };
const rabbit = Object.create(animal); // rabbit.[[Prototype]] = animal
rabbit.jumps = true;

console.log(rabbit.eats);  // true（自身にはないのでプロトタイプチェーンを辿ってanimalから取得）
console.log(rabbit.jumps); // true（自身のプロパティ）
console.log(Object.getPrototypeOf(rabbit) === animal); // true
```

**なぜこの仕組みが脆弱性に直結するのか**: 多くのJavaScriptライブラリ（かつてのlodash、jQueryの一部バージョンなど）は、オブジェクトをマージ/クローンするユーティリティ関数の中で、ユーザー制御可能なキー文字列（例: JSONとして受け取ったキー名）をそのままプロパティ代入に使っていました。もしそのキーが `"__proto__"` や `"constructor.prototype"` のような特殊な文字列だった場合、代入先が実際のオブジェクトの `[[Prototype]]`（=`Object.prototype`）そのものになってしまい、アプリケーション全体の「すべてのオブジェクト」に意図しないプロパティを注入できてしまいます。これが「プロトタイプ汚染（Prototype Pollution）」と呼ばれる脆弱性クラスの根本原理です。本教科書の別章で攻撃手法と防御策を詳しく扱いますが、その前提となるのが本節で説明した「プロパティ解決はチェーンを辿る」「`__proto__`はチェーンの参照そのものに触れるアクセサである」という2点です。

```javascript
// 危険なマージ関数の典型パターン（説明用の簡略化コード。実装への攻撃コードではない）
function merge(target, source) {
  for (const key in source) {
    if (typeof source[key] === 'object') {
      if (!target[key]) target[key] = {};
      merge(target[key], source[key]); // keyが "__proto__" の場合の検証がない
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
```
上記のような「キーの許可リスト検証（`__proto__`, `constructor`, `prototype` の拒否）を欠いた再帰マージ」がプロトタイプ汚染の典型的な脆弱パターンです。防御としては `Object.create(null)` で `[[Prototype]]` を持たないオブジェクトを使う、`Map` を用いてキー文字列とプロトタイプチェーンの意味論を分離する、`Object.freeze(Object.prototype)` で汚染そのものを不可能にする、といった手法があります。

#### コンストラクタ関数と `class` 構文の関係

ES6の `class` は、内部的には従来のコンストラクタ関数 + `prototype` オブジェクトへのメソッド追加という仕組みの「糖衣構文（syntax sugar）」です。つまり次の2つはほぼ等価です。

```javascript
// 従来のコンストラクタ関数
function Animal(name) {
  this.name = name;
}
Animal.prototype.speak = function() {
  return `${this.name} makes a noise.`;
};

// ES6 class（内部的にはprototypeへのメソッド追加と同じ）
class AnimalES6 {
  constructor(name) {
    this.name = name;
  }
  speak() {
    return `${this.name} makes a noise.`;
  }
}
```

`class` は `typeof` では `"function"` を返し、インスタンスメソッドは実体として `AnimalES6.prototype.speak` に置かれます。この事実を知っていると、「`class` で書かれたコードだからプロトタイプ汚染とは無縁」という誤解を避けられます。`extends` によるクラス継承も、内部的には `[[Prototype]]` チェーンの構築（`Sub.prototype.__proto__ = Super.prototype`）にすぎません。

> 出典: MDN JavaScript Guide（Inheritance and the prototype chain / Using classes） — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide （プロトタイプチェーンによるプロパティ解決と、class構文がプロトタイプベースの継承の上に成り立つ仕組みを解説）
> 出典: Eloquent JavaScript, 4th ed., Chapter 7 "The Secret Life of Objects" — https://eloquentjavascript.net/ （オブジェクトの内部構造とプロトタイプによる委譲モデルを平易に解説）

### 3. 非同期処理とイベントループ

#### 実行スタック・タスクキュー・マイクロタスクキュー

JavaScriptはシングルスレッドですが、ブラウザ環境ではI/O待ちなどをブロックせずに処理できます。これを実現する仕組みが「イベントループ」です。ブラウザ（ホスト環境）には次の要素があります。

- **コールスタック（Call Stack）**: 現在実行中の関数呼び出しを積むスタック。同期コードはここで完結します。
- **マクロタスクキュー（Task queue）**: `setTimeout`、DOMイベント、I/O完了などのコールバックが積まれるキュー。
- **マイクロタスクキュー（Microtask queue）**: `Promise` の `.then`/`.catch`/`.finally`、`queueMicrotask` が積まれるキュー。

イベントループは「コールスタックが空になるたびに、まずマイクロタスクキューを（新しく追加されたものも含めて）空になるまで全部実行し、そのあとでマクロタスクキューから1つだけ取り出して実行する」というルールで動きます。

```javascript
console.log('1: 同期');

setTimeout(() => console.log('2: マクロタスク(setTimeout)'), 0);

Promise.resolve().then(() => console.log('3: マイクロタスク(Promise)'));

console.log('4: 同期');

// 実行順序: 1: 同期 → 4: 同期 → 3: マイクロタスク(Promise) → 2: マクロタスク(setTimeout)
```

**なぜこの順序になるのか**: `console.log('1')` と `console.log('4')` は同期コードなのでコールスタック上で即座に実行されます。`setTimeout` はタイマーAPIに登録されるだけで、コールバックは最短でも「現在の同期コードとマイクロタスクがすべて終わった後」まで実行されません。`Promise.resolve().then(...)` はマイクロタスクキューに積まれ、マクロタスク（`setTimeout`）より優先して処理されるため、`3` が `2` より先に出力されます。

この実行順序の理解は、クライアントサイド脆弱性ハンティングにおいて次の場面で重要になります。

- **レースコンディション系の脆弱性**（例: 認証チェックとDOM書き込みの実行順序に依存する処理、`postMessage` の非同期受信とタイミング依存の検証ロジック）を読み解くには、「どのコードがマイクロタスクで、どのコードがマクロタスクか」を正確に把握する必要があります。
- **DOM-based XSS のsink実行タイミング**を追う際、`await` の直後に実行されるコードがどのタイミングで走るかを誤解すると、実際にはレンダリング前に無害化されるはずの値が、非同期処理の順序次第で無害化前にDOMへ書き込まれてしまうような競合を見落とします。

#### Promiseとasync/await

`Promise` は「将来のある時点で成功（resolve）または失敗（reject）する値」を表すオブジェクトです。3つの状態（pending / fulfilled / rejected）を持ち、一度確定した状態は変化しません（immutability of settled state）。

```javascript
function fetchData(url) {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then(response => {
        if (!response.ok) {
          reject(new Error(`HTTP error: ${response.status}`));
          return;
        }
        resolve(response.json());
      })
      .catch(reject);
  });
}
```

`async/await` は、Promiseチェーンを同期的な見た目で書けるようにする構文糖です。`async` 関数は常にPromiseを返し、関数内部の `await` は「そのPromiseが確定するまで、この関数の続きの処理をマイクロタスクキューに退避させて、コールスタックを空ける」という動作をします。つまり `await` は処理を「止めている」のではなく、他のマクロタスク/マイクロタスクの実行機会を明示的に生み出しています。

```javascript
async function loadUser(id) {
  try {
    const res = await fetch(`/api/users/${id}`); // ここでいったん制御を返す
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('failed to load user', err);
    throw err;
  }
}
```

**なぜtry/catchで例外を捕まえられるのか**: `await` された式が reject されると、`async` 関数内部ではそのPromiseの拒否理由が「その `await` 式で投げられた例外」として扱われます。これはasync関数がPromiseチェーンの`.then`/`.catch`構造をシンタックス上で「隠している」だけで、内部的なマイクロタスクベースの制御フローは変わらないためです。この仕組みを理解していないと、非同期処理の中で発生したエラー（例: CSPレポート送信の失敗、Fetchによる検証リクエストの失敗）が握りつぶされて防御機構が沈黙する、といった見落としに繋がります。

> 出典: The Modern JavaScript Tutorial — https://javascript.info/ （"Promise, async/await" セクションおよび "Event loop: microtasks and macrotasks" で、マイクロタスク/マクロタスクの実行順序とasync/awaitの内部動作を具体的なコード例とともに解説）
> 出典: MDN JavaScript Guide（Promises） — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide （Guarantees / Chaining / Error handling / Timingの各節でPromiseの状態遷移とタイミング保証を解説）
> 出典: Eloquent JavaScript, 4th ed., Chapter 12 "Asynchronous Programming" — https://eloquentjavascript.net/ （コールバックからPromise、async/awaitへ至る非同期処理の設計思想を平易に解説）

### 4. ES6+の構文機能（読解のための最低限）

脆弱性ハンティングでは、難読化・圧縮されたコードや、モダンなフレームワークが生成するコードを読む機会が多いため、以下の構文を「読める」ことが前提になります。

```javascript
// 分割代入（Destructuring）
const { token, csrf: csrfToken = 'none' } = response.headers;
const [first, , third] = ['a', 'b', 'c'];

// スプレッド構文とレスト引数
const merged = { ...defaults, ...userOptions }; // 後勝ちでプロパティ上書き
function logAll(...args) { console.log(args); }

// テンプレートリテラル（HTML文字列組み立てで頻出＝XSSのsinkになりやすい）
element.innerHTML = `<div>${userInput}</div>`; // userInputのエスケープ有無が脆弱性の分岐点

// モジュールと動的import（コード分割・遅延ロードで使われ、sinkの起点になることがある）
import { sanitize } from './utils.js';
const module = await import(`./plugins/${pluginName}.js`); // pluginNameが外部制御可能だと危険
```

**なぜテンプレートリテラルの例が重要か**: `${userInput}` の部分はJavaScriptエンジンにとって単なる文字列結合であり、それ自体にエスケープ処理は一切含まれません。エスケープするかどうかは完全に呼び出し側の責任です。`element.innerHTML` に代入された文字列はHTMLパーサーによって解釈され、`<script>` タグやイベントハンドラ属性が含まれていれば実行されます。これが「sink（入力が最終的に実行・解釈される危険な代入先）」という概念の最も基本的な具体例であり、DOM-based XSSを理解するための出発点です（sinkとエスケープの詳細は別章で扱います）。

**なぜ動的importの例が重要か**: `import()` に渡される文字列がユーザー制御可能な値（URLパラメータなど）を含む場合、パストラバーサルや意図しないリモートコードの読み込みにつながりえます。ビルドツール（webpackなど）は静的解析できない動的importに対して警告を出すことが多く、そうした警告はしばしば潜在的な脆弱性のシグナルです。

> 出典: The Modern JavaScript Tutorial — https://javascript.info/ （"Destructuring assignment"、"Rest parameters and spread syntax"、"Modules" の各章でES6+構文と動的importの挙動を解説）
> 出典: MDN JavaScript Guide（JavaScript modules） — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide （静的import/exportと動的import()の違い、モジュールスコープの分離を解説）

### まとめ

- **クロージャ**は「関数定義時のレキシカル環境を保持し続ける」仕組みであり、状態のカプセル化と、意図しない状態共有バグの両方の源泉になります。
- **プロトタイプチェーン**は「プロパティが見つかるまで `[[Prototype]]` を辿る」仕組みであり、`__proto__` の不用意な代入がプロトタイプ汚染の技術的根拠になります。`class` はこの仕組みの上に構築された糖衣構文にすぎません。
- **イベントループ**は「同期コード→マイクロタスク（Promise）→マクロタスク（setTimeout等）」という優先順位で処理され、この順序の誤解はレースコンディション系脆弱性や非同期sinkの見落としに直結します。
- **ES6+構文**（テンプレートリテラル、分割代入、動的import等）はモダンなコードベースを読解するための必須知識であり、特にテンプレートリテラルによる文字列組み立てはXSSのsinkの温床になりやすい点に注意が必要です。

（本節はすべて防御・読解目的の解説であり、実在サービスへの攻撃コードは含みません。実務での検証は必ず許可を得た環境・スコープ内で行ってください。）
