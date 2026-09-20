# 第3章 JavaScriptの深い理解と読解スキル


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

## 攻撃者目線のJS読解（JavaScript for hackers）

クライアントサイドの脆弱性ハンティングでは、JavaScriptを「書けること」以上に「攻撃者の目で読めること」が武器になります。ここで言う攻撃者目線とは、対象アプリのJSを眺めたときに (1) 外部から制御可能な入力（source＝ユーザーが操作できるデータの入口。`location.hash`、`document.referrer`、`postMessage`のデータなど）を見つけ、(2) それが最終的に危険な代入先（sink＝入力が実行・解釈される終着点。`eval`、`innerHTML`、`location`代入、`Function`コンストラクタなど）に届く経路を追い、(3) 途中のフィルタやサニタイザ（不正な文字を除去・無害化する処理）を「JS言語仕様のクセ」で回避できないかを考える、という一連の読み方です。

本節では、この読み方を体系化したGareth Heyes（PortSwiggerの研究者）の著書『JavaScript for hackers』と、同氏の研究記事を軸に、「なぜそのペイロードが動くのか」を言語エンジン・パーサのレベルまで掘り下げて解説します。防御目的の学習として、脆弱性を「見抜き、直す」ための知識として扱ってください（実在サービスへの無許可の検証は行わないこと）。

### 教科書としての『JavaScript for hackers』

Gareth Heyesは、XSSペイロードの短縮化・難読化・パーサのクセの発見で知られる第一人者です。彼の著書『JavaScript for hackers』は、そうしたテクニックを「発見の方法論」として整理したもので、単なるペイロード集ではなく「未知の挙動をどう探すか」を教える点に価値があります。

書籍の構成（章立て）はおおむね次のとおりで、本節が扱う「攻撃者目線の読解」の全体地図になります。

- **第2章 括弧なしのJavaScript**: `()` を使わずに関数を呼び出す方法。タグ付きテンプレート、`throw`式、`Symbol.hasInstance` など。フィルタが `(` `)` を弾く状況を突破する基礎。
- **第3章 ファジング**: JavaScript URL、HTTP URL、HTMLに対する体系的な入力探索。既知の挙動やエスケープの網羅的テスト。
- **第4章 ハッカーのためのDOM**: `window`スコープとHTMLイベントスコープの関係、DOM Clobbering（後述）。
- **第5章 ブラウザエクスプロイト**: Firefox/Safari/IE/Chrome/OperaごとのSOP（同一オリジンポリシー）バイパス事例。
- **第6章 プロトタイプ汚染**: クライアント側・サーバー側のPrototype Pollution。
- **第7章 非英数字JavaScript**: 文字・数字を使わずJSを書く技法。「6文字の壁（six character wall）」の概念。
- **第8章 XSS（20の小節）**: スクリプトのクローズ／コメント技法、SVG内スクリプトのHTMLエンティティ、`window.name`ペイロード、ソースマップ、動的import、XHTML/XML名前空間の悪用、SVGの`use`要素、イベントベクタ、Popoverなど。

本節ではこのうち、読解・回避の土台として特に重要な「括弧なし呼び出し」「非英数字JS」「ファジングの発想」「DOM Clobbering」「プロトタイプ汚染」を、原典の実物ペイロードを引きながら解説します。

> ⚠️ **未取得の資料**: 書籍本文（有料PDF/EPUB）のフルテキストは自動取得できませんでした（理由: Leanpubの販売ページのみ取得可能で、本文は購入者限定コンテンツのため。取得できたのは目次・章題・書籍メタデータのみ）。以下のURLからご自身で直接ご覧ください: https://leanpub.com/javascriptforhackers
>
> （以下は未取得資料の補足として一般知識に基づく解説です）販売ページから確認できるメタデータ: 著者 Gareth Heyes、進捗100%完成、フォーマットはPDF/EPUB、31言語の翻訳版あり、価格の目安は20〜35ドル。タスク指示にある独立出版版（105ページ、ISBN 9798371872166、Leanpub版2022-12-21公開）はペーパーバック版の書誌情報に該当します。本文中の具体的なペイロードは、内容が重複する著者自身の公開研究記事（PortSwigger Research / garethheyes.co.uk）を一次情報として引用し、以下で解説します。
>
> 出典: JavaScript for hackers (Gareth Heyes) — https://leanpub.com/javascriptforhackers

### 攻撃者目線の読解フロー: source → 経路 → sink

具体テクニックに入る前に、読解の型を固定します。対象のJSを読むとき、頭の中で常に次の3点を追います。

1. **source（入口）を特定する**: 攻撃者が値を注入できる場所。代表例は `location.href` / `location.hash` / `location.search`、`document.referrer`、`window.name`、`postMessage`の`event.data`、`localStorage`/`sessionStorage`、URLフラグメント、DOM上の`data-*`属性など。
2. **データフローを追う**: sourceの値が変数に代入され、加工され、関数に渡され……と流れる経路を追う。文字列連結、`JSON.parse`、正規表現による置換（フィルタ）などが途中に挟まる。
3. **sink（終着点）に届くか判定する**: `eval`、`setTimeout`/`setInterval`（文字列引数）、`Function`コンストラクタ、`element.innerHTML`/`outerHTML`、`document.write`、`location`への代入、`element.setAttribute('href'|'src', …)`、jQueryの`$()`、テンプレートエンジンへの受け渡しなど。

この「source→sink」の経路が、途中のフィルタで完全に無害化されずに繋がっていれば、それがDOM-based XSSなどの脆弱性です。攻撃者目線の読解の妙は、「フィルタがあるから安全」と切り捨てず、**JS言語仕様のクセでフィルタをすり抜けられないか**を疑うところにあります。以降のテクニックは、まさにその「すり抜け」の道具箱です。

### 括弧なしで関数を呼び出す（JavaScript without parentheses）

多くの素朴なフィルタやWAF（Web Application Firewall、通信を検査して攻撃らしいパターンを弾く仕組み）は、`alert(` のような「関数名 + 開き括弧」や、`(` `)` そのものをブロックします。しかしJavaScriptには、括弧を書かずに関数を実行する方法が複数あります。これを知っていると、フィルタを読んだ瞬間に「括弧を消してるだけなら意味がない」と見抜けます。

Heyesの研究では、括弧なし呼び出しの主要な手口が整理されています。まず、括弧を使わず関数呼び出しを成立させる代表的な6通りは次のとおりです。

```javascript
// 1. タグ付きテンプレート（tagged template）
alert`1337`

// 2. throw 式 + onerror ハンドラ
throw onerror=alert,1337

// 3. Function コンストラクタ + タグ付きテンプレート
Function`x${'alert\x281337\x29'}x`

// 4. instanceof と Symbol.hasInstance
'alert\x281337\x29'instanceof{[Symbol['hasInstance']]:eval}

// 5. valueOf の上書き（暗黙の型変換で呼ばせる）
valueOf=alert;window+''

// 6. DOMMatrix + javascript: プロトコル
x=new DOMMatrix;matrix=alert;x.a=1337;location='javascript'+':'+x
```

> 出典: The seventh way to call a JavaScript function without parentheses — https://portswigger.net/research/the-seventh-way-to-call-a-javascript-function-without-parentheses

それぞれ「なぜ動くのか」を仕組みレベルで説明します。

#### タグ付きテンプレートが呼び出しになる理由

`` alert`1337` `` が `alert('1337')` 相当になるのは、ES6のタグ付きテンプレートリテラル仕様のためです。`関数`テンプレート文字列`` という構文は、その関数を「タグ関数」として呼び出す糖衣構文で、エンジンは第1引数に「文字列部分の配列」、第2引数以降に `${}` 内の式の値を渡します。つまりバッククォートが暗黙の呼び出しを起こすため、`(` `)` を一切書かずに関数実行が成立します。ただし引数は文字列配列で渡るため、`eval` のように文字列そのものを評価したい場合はそのまま使えますが、任意引数を厳密に制御したい場合は工夫が要ります（後述の第7の手口がこれを解決します）。

#### throw + onerror が呼び出しになる理由

```html
<script>onerror=alert;throw 1337</script>
```

`window.onerror` は、キャッチされない例外が発生したときにブラウザが呼ぶグローバルなハンドラです。`onerror=alert` でハンドラに `alert` を差し込み、`throw 1337` で例外を発生させると、ブラウザが `onerror` を実行するため、結果として `alert` が呼ばれます。セミコロンすら避けたい場合は、ブロック文を使って次のように書けます。

```html
<script>{onerror=alert}throw 1337</script>
```

`{…}` はブロック文なので、その直後に文が続いても文法的に成立し、ステートメント区切りのセミコロンが不要になります。さらに、`onerror` に渡る引数（例外メッセージ）を制御して任意コードを走らせるには、`eval` を差し込み、メッセージの先頭を `=` にして「`Uncaught` というプレフィックス」を変数代入の一部に化けさせる手口があります。

```html
<script>{onerror=eval}throw'=alert\x281337\x29'</script>
```

ここで `\x28` `\x29` はそれぞれ `(` `)` のエスケープ表記で、ソース上に生の括弧を出さずに済ませています。ブラウザは例外を文字列化する際に先頭へ `Uncaught` を付けることがあり、その結果 `eval` に渡る文字列が `Uncaught =alert(1337)` のようになります。先頭の `Uncaught =` は「`Uncaught` という識別子への代入」と解釈され、後続の `alert(1337)` が有効な式として評価される、という仕掛けです。

Firefoxのように例外文字列の整形が異なるブラウザ向けには、Errorオブジェクトのプロパティを模したオブジェクトを投げて整形を制御する変種もあります。

```html
<script>{onerror=eval}throw{lineNumber:1,columnNumber:1,fileName:1,message:'alert\x281\x29'}</script>
```

さらに `throw` すら書かずに例外を誘発する高度な変種として、`TypeError.prototype` を改変して型エラー自体をトリガに使う手口も示されています。

```html
<script>TypeError.prototype.name='=/',0[onerror=eval]['/-alert(1)//']</script>
```

> 出典: XSS without parentheses and semi-colons — https://portswigger.net/research/xss-without-parentheses-and-semi-colons

#### Symbol.hasInstance と valueOf が呼び出しになる理由

`'…'instanceof{[Symbol.hasInstance]:eval}` が動くのは、`instanceof` 演算子が右辺オブジェクトの `Symbol.hasInstance` メソッドを呼び出す仕様だからです。そこに `eval` を仕込むと、左辺の文字列が `eval` の引数として渡り、評価されます。同様に `valueOf=alert;window+''` は、`window+''`（文字列化）の際にオブジェクトの `valueOf`（プリミティブ変換用の内部メソッド）が呼ばれる仕様を突いています。`valueOf` を `alert` に差し替えておくと、暗黙の型変換のタイミングで `alert` が実行されます。これらはいずれも「演算子や型変換が内部的にメソッド呼び出しを起こす」というエンジンの仕様を利用しており、ソース上に呼び出し括弧を書かずに済みます。

#### 第7の手口: `[].sort.call` + タグ付きテンプレート

タグ付きテンプレートの弱点は、第1引数に「文字列配列」が入ってしまうことでした。これだと `setTimeout` のように第1引数へ関数や特定の値を渡したい呼び出しには使えません。Heyesが示した7番目の手口は、配列メソッドの `call` を経由して `this` と引数の割り当てを差し替えます。

```javascript
[].sort.call`${alert}1337`
```

ポイントは、`Function.prototype.call` を配列メソッド（`sort`）から呼ぶと、`this` に任意のオブジェクトを渡しても「Illegal invocation（不正な呼び出し）」エラーにならないことです。タグ付きテンプレートの `${alert}` はプレースホルダの式として評価され、`call` の引数列に流れ込みます。これにより、テンプレート由来の値を関数の実引数として使えるようになり、括弧なしのまま柔軟な呼び出しが実現します。`[].map.call` や `Reflect.apply` を使う変種もあります。

> 出典: The seventh way to call a JavaScript function without parentheses — https://portswigger.net/research/the-seventh-way-to-call-a-javascript-function-without-parentheses

**防御の観点**: これらが示す教訓は、「特定の文字列（`alert(` や `eval`）や記号（`(`）をブロックする」ブラックリスト方式のフィルタは原理的に破られる、ということです。防御側は、危険なsinkにユーザー入力を渡さない（設計で断つ）、出力コンテキストに応じたエスケープを行う、CSP（Content Security Policy）でインラインスクリプトや`javascript:`を禁じる、といった「文字を数える」のではない対策を採るべきです。

### 非英数字JavaScript（六文字の壁）

`(` だけでなく、英字・数字すら弾くような極端なフィルタも存在します。それでもJavaScriptは、`[` `]` `(` `)` `!` `+` といった記号だけで任意のコードを組み立てられます（いわゆるJSFuck系の技法）。攻撃者目線では、「記号しか通らない入力欄でも実行に持ち込める可能性がある」と知っておくことが重要です。

原理はJavaScriptの暗黙の型変換の連鎖です。

```javascript
// 数値を作る: 真偽値→数値の型変換を利用
+[]        // 0   （空配列を数値化すると 0）
+!+[]      // 1   （+[] は 0、!0 は true、+true は 1）
!+[]+!+[]  // 2   （true + true = 2）
```

```javascript
// 文字列を作る: 型変換で "undefined" などを生成し、添字で1文字ずつ取り出す
[][[]]         // undefined（存在しないプロパティアクセス）
[][[]]+[]      // "undefined"（文字列化）
// "undefined" の各文字 u,n,d,e,f,i,... を index で抽出
```

こうして得た文字を継ぎ足すと `"find"` のような単語が作れます。配列の `find` メソッドを `toString()` すると `"function find() { [native code] }"` という文字列が得られ、そこから `c`（constructor に必要）など新たな文字が採れます。文字が揃えば `"constructor"` を組み立て、`[]['constructor']['constructor']` で **Functionコンストラクタ**（文字列からコードを生成・実行できる、`eval`と並ぶ強力なsink）に到達できます。最後はタグ付きテンプレートで括弧すら使わずに実行します。

```javascript
Function`code`   // バッククォートで暗黙に呼び出し、code を関数本体として実行
```

「六文字の壁（six character wall）」とは、この構築を突き詰めると、ごく少数の文字種（記号）だけで実行可能なコードに到達できる、という到達点を指す概念です。**防御の観点**では、「英数字を弾いたから安全」という思い込みが誤りであることを示します。記号のみでも `Function`/`eval` へ到達しうるため、入力を実行系sinkに渡さない設計が唯一の確実な対策です。

> 出典: Executing non-alphanumeric JavaScript without parenthesis — https://portswigger.net/research/executing-non-alphanumeric-javascript-without-parenthesis

### ファジングの発想: 未知の挙動を体系的に探す

『JavaScript for hackers』の第3章が説くのは、「既知のペイロードを試す」のではなく「パーサに全文字を投げて、想定外の反応を観測する」というファジング（fuzzing、多数の入力を機械的に投げて異常な挙動を探す手法）の姿勢です。攻撃者目線の読解が「静的にコードを読む」なら、ファジングは「動的にパーサを揺さぶる」相補的な技術です。

具体的な発想は次のようなものです。

- **HTMLパーサのファジング**: タグ名・属性区切り・イベントハンドラ属性の位置に、全Unicodeコードポイントを1文字ずつ差し込み、どの文字がタグ境界や属性境界として扱われるかを観測する。これによりサニタイザが見落とす区切り文字（例: 特定の空白類似文字）が見つかる。
- **JavaScript URLのファジング**: `javascript:` スキームの後ろで、どの文字が無視され、どの文字がコードとして解釈されるかを網羅テストする。
- **既知エスケープの周辺探索**: `\x28` のようなエスケープが効くなら、その前後や別表記（`(`、`\u{28}`）も試し、フィルタの取りこぼしを探す。

この「ブラウザのパーサは仕様書どおりに動くとは限らない」という前提が、mXSS（mutation XSS、サニタイズ後にブラウザがHTMLを再解釈して無害化されたはずのペイロードが復活する現象）やSOPバイパスといった発見に繋がります。読解時にも、「このサニタイザはブラウザの実際のパース結果とズレていないか」を疑う視点が役立ちます。

> 出典: JavaScript for hackers (Gareth Heyes) — https://leanpub.com/javascriptforhackers

### DOM Clobbering: HTMLでJSの変数を上書きする

DOM Clobbering（DOMクロバリング）は、`id` や `name` 属性を持つHTML要素が、対応する名前のグローバル変数やプロパティとして参照できてしまうという、レガシーなブラウザ仕様を悪用する技法です。スクリプト注入（`<script>`）が封じられていても、**HTML要素の注入だけでJSの挙動を書き換えられる**点が強力で、CSPでスクリプトを禁じた環境でも成立しうるのが読解上の重要ポイントです。

原理は、ブラウザが `id`/`name` を持つ要素を `window` オブジェクトのプロパティ（名前付きアクセス）として露出する仕様にあります。たとえば次のHTMLを注入できると、

```html
<a id="config"></a>
```

JS側で `window.config`（＝`config`）を参照したとき、本来のオブジェクトの代わりにこの `<a>` 要素が返ります。さらに入れ子で属性を「捏造」することもできます。

```html
<!-- config.url を攻撃者制御の値に見せかける -->
<a id="config"><a id="config" name="url" href="cid:malicious"></a>
```

この結果、アプリのコードが `config.url` を信頼して sink（例: `script.src = config.url`）に渡していれば、攻撃者の値が流れ込みます。Heyesの「DOM Clobbering strikes back」(2020) や「Bypassing CSP via DOM clobbering」(2023) は、この技法を現代のブラウザ・CSP環境向けに拡張したものです。

**防御の観点**: サニタイザで `id`/`name` 属性を許可しない、グローバル変数の存在を `typeof x === 'object'` などで無防備に信頼しない、`Object.freeze` や明示的な初期化で上書きを防ぐ、といった対策が有効です。

> 出典: DOM Clobbering strikes back / Bypassing CSP via DOM clobbering (Gareth Heyes) — https://garethheyes.co.uk/

### プロトタイプ汚染（Prototype Pollution）

プロトタイプ汚染は、`Object.prototype`（すべてのオブジェクトが継承する大元のプロトタイプ）に攻撃者がプロパティを注入することで、アプリ全体のオブジェクトの既定値を書き換える脆弱性です。JavaScriptのプロトタイプチェーン（オブジェクトがプロパティを見つけられないとき親のプロトタイプを辿る仕組み）を悪用します。

典型的には、`__proto__` や `constructor.prototype` というキーを含む入力を、再帰的マージ（deep merge）やクエリ文字列パースなどで無防備に処理すると発生します。

```javascript
// 悪意ある入力（例: JSONやクエリ文字列由来）
{"__proto__": {"isAdmin": true}}

// 無防備な再帰マージの結果、以後すべてのオブジェクトが
({}).isAdmin // → true になってしまう
```

汚染されたプロパティは、後続のコードが「そのプロパティは存在しないはず」と仮定している箇所で牙をむきます。クライアント側では、汚染された既定値がHTML生成やスクリプトのオプションに流れ込み、XSSに繋がることがあります（いわゆるgadget＝汚染されたプロパティを危険な動作に変換する既存コード）。サーバー側（Node.js）では、設定値の改ざんやRCE（リモートコード実行）に至る場合もあります。

Heyesは「Server-side prototype pollution: black-box detection without the DoS」(2023) で、クラッシュを誘発せずにレスポンスの差分から汚染可能性を検出する手法も示しています。

**防御の観点**: `__proto__`/`constructor`/`prototype` をキーとして拒否する、`Object.create(null)` でプロトタイプを持たないオブジェクトを使う、`Object.freeze(Object.prototype)` で凍結する、信頼できるマージライブラリを使う、といった対策が有効です。

> 出典: Prototype pollution / Server-side prototype pollution (Gareth Heyes) — https://garethheyes.co.uk/

### まとめ: 読解チェックリスト

攻撃者目線でJSを読むとき、本節の道具を次の順で当てはめると効率的です。

1. **source を洗い出す**: `location.*`、`postMessage`、`document.referrer`、`window.name`、ストレージ、DOM属性。
2. **sink を洗い出す**: `eval`/`Function`/`setTimeout(str)`、`innerHTML`/`document.write`、`location`代入、`setAttribute`、テンプレートエンジン。
3. **経路を接続する**: source→sink が繋がるか。途中のフィルタが「文字ベースのブラックリスト」なら、括弧なし呼び出し・非英数字JS・別エスケープ表記で回避可能と疑う。
4. **スクリプト封じの環境でも諦めない**: `<script>`が使えなくても DOM Clobbering、プロトタイプ汚染 gadget、mXSS、`javascript:`スキーム、イベント属性など「HTMLやデータだけで実行に持ち込む」経路を探す。
5. **ブラウザ差異を疑う**: サニタイザの想定とブラウザの実パース結果のズレ（mXSS、SOPバイパス）をファジングで検証する。

これらは攻撃のためではなく、**自分たちのコードのどこにこの経路が潜むかを見抜き、設計とCSPで断つため**の読解術です。ブラックリストではなく「危険なsinkに信頼できない入力を渡さない」設計こそが、これら全テクニックへの共通の答えになります。

> 出典: JavaScript for hackers (Gareth Heyes) — https://leanpub.com/javascriptforhackers ／ Gareth Heyes research — https://garethheyes.co.uk/

---

[← 第2章 ブラウザのセキュリティモデル](02-browser-security-model.md) ｜ [📖 目次](index.md) ｜ [第4章 クライアントサイドコードのリバースエンジニアリング →](04-client-side-reversing.md)
