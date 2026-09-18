# オブジェクト・プロトタイプ・クラス・非同期 ― クライアントサイド脆弱性の土台を作るJavaScript中核機構

> **この節で分かること**
> - オブジェクトのプロパティアクセス（ドット記法／ブラケット記法）の仕組みと、外部入力をキーに使う「オブジェクトインジェクション」がなぜ危険かを説明できる
> - プロトタイプチェーンによるプロパティ探索・シャドウイング・`__proto__` の二つの意味を説明し、プロトタイプ汚染（prototype pollution）が成立する機構を自分の言葉で語れる
> - クラスのプライベートフィールド（`#`）が「ハードプライベート」であることと、DevTools だけが例外である事実を診断に活かせる
> - Proxy の全13トラップと Reflect を使って、`fetch` や `innerHTML` などの sink をフック（計測）する考え方を持てる
> - Promise のチェーン・エラー処理・`unhandledrejection`・マイクロタスク実行順を理解し、競合状態（race condition）の説明に使える

**元資料**: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide （原典は取得できず二次情報ベース。MDN 公式コンテンツリポジトリ `mdn/content` のソース Markdown を代替取得。本文・コード・表は逐語で取得済み）
**関連する節**: 17a・17c（同じ MDN JavaScript Guide の別範囲）

---

## 0. この節の位置づけ

〔補足〕本節は「MDN JavaScript ガイド」という長大な資料の一部（3分割の第2部）を担当する。扱うのは **オブジェクトの操作 → プロトタイプチェーン → クラス → イテレータ／ジェネレータ → メタプログラミング（Proxy／Reflect）→ Promise** という中核機構である。文法の入門や制御構文は別範囲が扱うので、ここでは「変数・関数・オブジェクトリテラルの基本は分かっている」ことを前提にする。

なぜこの範囲がバグバウンティに直結するのか。クライアントサイドの脆弱性の多くは、**JavaScript が「すべて実行時に決まる動的な言語」である**という設計に由来する。プロパティ名は文字列として実行時に組み立てられ、オブジェクトはプロトタイプを実行時に差し替えられ、非同期処理はマイクロタスクという見えないキューで並び替えられる。攻撃者はまさにこの「実行時の柔軟さ」を突く。だからこの節では、各機構について **なぜそう設計されたのか → どう動くのか → 攻撃者はどこを突くのか → どう守るのか** の順で見ていく。

---

## 1. オブジェクトとプロパティの基礎

### 1.1 オブジェクトとは何か（設計意図）

MDN は冒頭でこう述べる（原文）。

> JavaScript is designed on an object-based paradigm. An object is a collection of properties, and a property is an association between a name (or _key_) and a value. A property's value can be a function, in which case the property is known as a method.

つまり **オブジェクト（object）とは、プロパティ（property）の集まりのこと**。プロパティとは、名前（キー, key）と値の対応づけのことである。値が関数であるプロパティは特別に **メソッド（method）** と呼ぶ。ブラウザが最初から用意しているオブジェクトに加えて、自分でオブジェクトを定義できる。

### 1.2 オブジェクトの作り方（3通り）

オブジェクトを作る方法は主に3つある。

**(1) オブジェクト初期化子（object initializer）** ―「オブジェクトリテラル（object literals）」とも呼ぶ。波括弧に直接プロパティを書く形式。

```js
const obj = {
  property1: value1, // property name may be an identifier
  2: value2, // or a number
  "property n": value3, // or a string
};
```

コロンの前のプロパティ名は、識別子・数値リテラル・文字列リテラルのいずれか。プロパティ名を式で決めたい（computed keys）ときは角括弧で包む。重要なのは、**オブジェクト初期化子は「式」であり、実行されるたびに新しいオブジェクトを作る**点。同じ内容を書いても、別々に評価されれば互いに等しくない別個のオブジェクトになる。初期化子で作ったオブジェクトは `Object` のインスタンスなので **プレーンオブジェクト（plain objects）** と呼ばれる。

**(2) コンストラクタ関数（constructor function）** ― まず型を関数で定義し、`new` 演算子でインスタンス化する。慣習として関数名は大文字始まりにする（正当な理由がある、と MDN は言う）。

```js
function Car(make, model, year) {
  this.make = make;
  this.model = model;
  this.year = year;
}
```

```js
const myCar = new Car("Eagle", "Talon TSi", 1993);
```

`this` を通じて、渡された値をオブジェクトのプロパティに代入している。オブジェクトは別のオブジェクトをプロパティに持てる（`this.owner = owner` のように）。既存のオブジェクトにはいつでもプロパティを追加できる。

```js
car1.color = "black";
```

これは `car1` だけに `color` を追加し、他のオブジェクトには影響しない。同じ型のすべてのオブジェクトに追加したければ、コンストラクタの `prototype` に追加する（後述）。

**(3) `Object.create()`** ― コンストラクタ関数を書かずに、**作りたいオブジェクトのプロトタイプを直接選べる**。

```js
const animalProto = {
  type: "Invertebrates",
  displayType() {
    console.log(this.type);
  },
};

const animal = Object.create(animalProto);
animal.displayType(); // Logs: Invertebrates

const fish = Object.create(animalProto);
fish.type = "Fishes";
fish.displayType(); // Logs: Fishes
```

`animal` も `fish` も `animalProto` をプロトタイプとして共有し、`displayType` を継承する。この `Object.create()` は後で述べる `Object.create(null)`（プロトタイプなしオブジェクト）という防御技法の土台でもある。

### 1.3 プロパティ名は文字列かSymbolしかない

覚えておくべき基本原則がいくつかある。

- プロパティ名は **大文字小文字を区別する**。
- **プロパティ名になれるのは文字列か Symbol のみ**。Symbol でないキーはすべて文字列に変換される。
- したがって **配列のインデックスは、実際には整数を含む「文字列キー」のプロパティ**である。

この「キーは結局すべて文字列になる」という性質が、後で `__proto__` や `constructor` といった特別な文字列キーが攻撃面になる理由の出発点になる。

---

## 2. プロパティアクセスとオブジェクトインジェクション（セキュリティの核心）

### 2.1 二つのアクセス記法

プロパティアクセサ（property accessor）には **ドット記法（dot notation）** と **ブラケット記法（bracket notation）** の2つがある。

```js
// Dot notation
myCar.make = "Ford";

// Bracket notation
myCar["make"] = "Ford";
```

ドット記法は「有効な JavaScript 識別子である名前」にしか使えない。空白・ハイフンを含む名前、数字で始まる名前、そして **変数に入っている名前** はブラケット記法でしかアクセスできない。つまりブラケット記法の存在理由は、**プロパティ名を実行時に動的に決めたい**ことにある。

```js
let propertyName = "make";
myCar[propertyName] = "Ford";

propertyName = "model";
myCar[propertyName] = "Mustang";

console.log(myCar); // { make: 'Ford', model: 'Mustang' }
```

ここで注意したいのは、変数に入った文字列でアクセスするときは必ずブラケットで渡すという点。`myObj.str` は文字通り `"str"` というキーを探すので、変数 `str` の中身（例: `"myString"`）でアクセスしたいなら `myObj[str]` と書く。オブジェクトをキーに使うと、その `toString()` が呼ばれて `'[object Object]'` のような文字列キーになる。存在しないプロパティの値は `null` ではなく `undefined` である。

### 2.2 攻撃者はどこを突くのか ― オブジェクトインジェクション

MDN はこのブラケット記法の直後に、明確なセキュリティ警告を置いている。原文を逐語で示す。

> However, beware of using square brackets to access properties whose names are given by external input. This may make your code susceptible to [object injection attacks](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md).

和訳すると「**外部入力によって与えられた名前のプロパティにアクセスするために角括弧を使うことには注意せよ。これはコードをオブジェクトインジェクション攻撃に対して脆弱にし得る**」となる。

**オブジェクトインジェクション（object injection）** とは、攻撃者が制御する文字列を `obj[userKey]` の `userKey` に流し込み、開発者が想定していないプロパティにアクセスさせる攻撃のこと。たとえば URL のパラメータやフォーム入力がそのままキーになっている場合を考えるとよい。

〔補足〕`obj[userKey]` 形式が危険な理由は主に3つある。第一に、`__proto__` / `constructor` / `prototype` を指定されるとプロトタイプ汚染の入口になる（次章で詳述）。第二に、`Object.prototype` 由来のメソッドなど、意図しない内部プロパティを読み出せてしまう。第三に、`handlers[userKey]()` のような「関数テーブル」形式だと、任意のメソッド呼び出しに繋がり得る。

### 2.3 どう守るのか

防御の基本は「外部入力をそのままキーにしない」こと。具体的には次の技法がある。

- **許可リスト照合** ― 想定するキーの集合とだけ突き合わせる。
- **`Object.hasOwn(obj, key)` チェック** ― プロトタイプ由来ではなく、そのオブジェクト自身が持つプロパティかを確認する。
- **`Map` の使用** ― `Map` はキーと `Object.prototype` の名前空間が混ざらない。
- **`Object.create(null)` の採用** ― プロトタイプを持たないオブジェクトを辞書として使う（後述）。

このオブジェクトインジェクションの詳細は、MDN が唯一明示的にリンクしているセキュリティ文書に書かれている。本教科書の執筆環境からは取得できなかったので、読者は自分で開いてほしい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: eslint-plugin-security ― "The dangers of square bracket notation" — https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 取得対象範囲外の外部資料であり、MDN からのリンク先として名前と URL のみ確認できた）。以下の記述は MDN 本文からの引用断片にもとづく要約である。
> **読みどころ**:
> 1. `obj[key]` で外部入力をキーにした場合の具体的な悪用パターン（プロトタイプ汚染・意図しないメソッド呼び出し）を確認する。
> 2. ESLint の `security/detect-object-injection` ルールがどのようなコードを検出するか、そして誤検知（false positive）とどう付き合うかを学ぶ。
> **代替手段**: 同リポジトリの `docs/` ディレクトリに他の検出ルールの解説もある。無料で公開されている。

---

## 3. プロパティの列挙・削除・getter/setter・比較

### 3.1 列挙の3つのネイティブ手段

プロパティを列挙する方法は3つあり、「どこまで見るか」が違う。

| 手段 | 見る範囲 |
| --- | --- |
| `for...in` | オブジェクトの**列挙可能な文字列プロパティ**と、**そのプロトタイプチェーン**すべて |
| `Object.keys()` | **自身の列挙可能な文字列プロパティ名のみ**（プロトタイプは含まない） |
| `Object.getOwnPropertyNames()` | **自身の文字列プロパティ名すべて**（列挙可能かどうかを問わない） |

`for...in` はプロトタイプチェーンまで舐めてしまうので、「自身のプロパティ（own property）」だけを見たいなら `Object.hasOwn(obj, i)` でフィルタするのが定石である。

```js
function showProps(obj, objName) {
  let result = "";
  for (const i in obj) {
    if (Object.hasOwn(obj, i)) {
      result += `${objName}.${i} = ${obj[i]}\n`;
    }
  }
  console.log(result);
}
```

**継承されたプロパティ（非列挙のものを含む）をすべて列挙するネイティブな方法はない**が、プロトタイプチェーンを手で辿れば実現できる。

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

〔補足〕この `listAllProperties` は診断でそのまま使える。`window` やフレームワーク内部オブジェクト、ライブラリのエクスポートが「隠し持っている API 面」を洗い出すのに便利だ。プロパティの削除は継承していないものに対してのみ `delete` 演算子で行える。

### 3.2 getter と setter ― プロパティアクセスにコードを差し込む

**getter** はプロパティの値を取得するときに呼ばれる関数、**setter** は設定するときに呼ばれる関数。オブジェクト初期化子の中で `get` / `set` キーワードを前置して定義するか、`Object.defineProperties()` で後から足す。

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

console.log(myObj.b); // 8, returned from the get b() method
myObj.c = 50; // Calls the set c(x) method
console.log(myObj.a); // 25
```

〔補足〕getter/setter は「プロパティを読む／書くだけで任意コードが走る」仕組みだ。攻撃者視点では、`Object.defineProperty(Object.prototype, 'x', {get(){...}})` のようにプロトタイプ経由でアクセサを注入すると（プロトタイプ汚染の一形態）、無関係なオブジェクトを読んだだけで副作用を起こす「ガジェット」を作れる。

### 3.3 オブジェクトの比較は参照で決まる

**JavaScript ではオブジェクトは参照型**である。中身が同じでも、別々に作った2つのオブジェクトは決して等しくない。

```js
const fruit = { name: "apple" };
const anotherFruit = { name: "apple" };
fruit === anotherFruit; // false
```

同じオブジェクトを指す変数同士を比べたときだけ `true` になる。これは一見当たり前だが、後で述べる「`Promise.all` が返す配列の同一性」や「イテレータが自分自身を返すか」を理解する土台になる。

---

## 4. プロトタイプチェーン ― 継承の実体

### 4.1 なぜプロトタイプなのか（設計意図）

MDN は継承の仕組みをこう説明する（原文の要点）。

> JavaScript implements inheritance by using objects. Each object has an internal link to another object called its _prototype_. ... It is possible to mutate any member of the prototype chain or even swap out the prototype at runtime, so concepts like static dispatching do not exist in JavaScript.

つまり **各オブジェクトは、別のオブジェクト（プロトタイプ, prototype）への内部リンクを持つ**。プロトタイプもまた自分のプロトタイプを持ち…と続き、最後は `null`（プロトタイプを持たない終端）に至る。この連鎖を **プロトタイプチェーン（prototype chain）** と呼ぶ。

決定的に重要なのは、**このチェーンの任意のメンバーを実行時に書き換えたり、プロトタイプごと差し替えたりできる**ことだ。だから JavaScript には「静的ディスパッチ」のような固定的な概念がない。クラスベース言語（Java, C++）出身者には混乱するが、クラスは実はこのプロトタイプ機構の上に作られた糖衣構文にすぎない。

### 4.2 プロパティ探索の仕組み（どう動くのか）

プロパティにアクセスすると、ランタイムは「そのオブジェクト自身 → プロトタイプ → プロトタイプのプロトタイプ …」の順に、名前が一致するプロパティを探す。見つかればそれを使い、終端の `null` まで見つからなければ `undefined` を返す。

MDN の逐語コード（コメントが探索の全過程を示す）。

```js
const o = {
  a: 1,
  b: 2,
  __proto__: {
    b: 3,
    c: 4,
  },
};

// { a: 1, b: 2 } ---> { b: 3, c: 4 } ---> Object.prototype ---> null

console.log(o.a); // 1
console.log(o.b); // 2  ← 自身のbが使われ、プロトタイプのbは無視される（Property Shadowing）
console.log(o.c); // 4  ← 自身になし、プロトタイプで発見
console.log(o.d); // undefined  ← 終端まで探して見つからず
```

ここで `o.b` が `2` になる現象を **プロパティシャドウイング（property shadowing）** という。自身のプロパティがプロトタイプの同名プロパティを「覆い隠す」のだ。**オブジェクトにプロパティを設定すると own property が作られる**（getter/setter に横取りされる場合を除く）。

構造を図にすると次のようになる。

```
o
├─ a: 1          （own property）
├─ b: 2          （own property, プロトタイプの b=3 を隠す）
└─ [[Prototype]] ──▶ { b: 3, c: 4 }
                     └─ [[Prototype]] ──▶ Object.prototype
                                          └─ [[Prototype]] ──▶ null
```

### 4.3 `[[Prototype]]` と `__proto__` と `func.prototype` の区別

ここが最も混乱するポイントなので、3つの用語を整理する。

| 表記 | 意味 |
| --- | --- |
| `someObject.[[Prototype]]` | ECMAScript 仕様上の内部スロット。そのオブジェクトのプロトタイプ本体。`Object.getPrototypeOf()` / `Object.setPrototypeOf()` でアクセス・変更する |
| `obj.__proto__`（アクセサ） | `[[Prototype]]` と等価に働くが**非標準・非推奨**。多くのエンジンで事実上実装されているだけ |
| `{ __proto__: c }`（リテラル内キー） | オブジェクトリテラル内で使う `__proto__` は**標準であり非推奨ではない**。`c` をそのオブジェクトの `[[Prototype]]` にする |
| `func.prototype` | 関数がコンストラクタとして使われたとき、**生成される全インスタンスに割り当てられる `[[Prototype]]`** を指定するプロパティ。オブジェクトのプロトタイプ本体とは別物 |

つまり **`__proto__` には「アクセサとしての `__proto__`（非推奨）」と「リテラル内キーとしての `__proto__`（標準）」という2つの意味がある**。この二重性が、後述するプロトタイプ汚染で `__proto__` という文字列キーが攻撃に使われる理由の一つになっている。

継承されたメソッドを呼ぶとき、`this` は「継承している側のオブジェクト」を指す。メソッドが定義されているプロトタイプではない。

```js
const parent = {
  value: 2,
  method() {
    return this.value + 1;
  },
};
const child = { __proto__: parent };
console.log(child.method()); // 3 ← this は child を指す
child.value = 4;             // shadowing
console.log(child.method()); // 5 ← this.value は child.value
```

---

## 5. コンストラクタ・prototype・monkey patching

### 5.1 コンストラクタと `prototype` プロパティ

プロトタイプの威力は「全インスタンスで共有すべきメソッドを1か所に置ける」ことにある。手で `__proto__` をバインドする代わりに、コンストラクタ関数を使うと自動化できる。

```js
function Box(value) {
  this.value = value;
}
Box.prototype.getValue = function () {
  return this.value;
};
const boxes = [new Box(1), new Box(2), new Box(3)];
```

**コンストラクタから作られる全インスタンスは、自動的にコンストラクタの `prototype` プロパティを自身の `[[Prototype]]` に持つ**。つまり `Object.getPrototypeOf(new Box()) === Box.prototype`。また `Constructor.prototype` はデフォルトで `constructor` という own property を1つ持ち、これがコンストラクタ関数自身を指す（`Box.prototype.constructor === Box`）。

決定的に重要なのが次の性質だ。**`Box.prototype` は全インスタンスの `[[Prototype]]` と同じオブジェクトを指すので、`Box.prototype` を後から書き換えれば、既に作られたインスタンスの振る舞いまで変わる。**

```js
const box = new Box(1);
Box.prototype.getValue = function () {
  return this.value + 1;
};
box.getValue(); // 2 ← 生成済みインスタンスにも変更が波及
```

クラスはこのコンストラクタ関数の糖衣構文であり、`class Box { ... }` と書いてもメソッドは `Box.prototype` に作られる。なお、`Constructor.prototype` を丸ごと再代入するのは悪手とされる。再代入前後のインスタンスが別のプロトタイプを指してしまい、`constructor` プロパティも失われ、`constructor` を読むビルトイン操作が正しく動かなくなるからだ。

### 5.2 monkey patching ― ビルトインプロトタイプ拡張の危険

MDN は明確に警告する（原文）。

> There is one misfeature that used to be prevalent — extending `Object.prototype` or one of the other built-in prototypes. ... This misfeature is called _monkey patching_. Doing monkey patching risks forward compatibility, because if the language adds this method in the future but with a different signature, your code will break. It has led to incidents like the [SmooshGate](https://developer.chrome.com/blog/smooshgate/) ... The **only** good reason for extending a built-in prototype is to backport the features of newer JavaScript engines, like `Array.prototype.forEach`.

要点は、`Object.prototype` や `Array.prototype` を拡張する行為を **monkey patching（モンキーパッチ）** と呼び、前方互換性を損なうということ。将来言語が同名メソッドを別の仕様で追加するとコードが壊れる。実際に **SmooshGate**（`Array.prototype.flatten` を巡る事件）を招いた。ビルトインプロトタイプを拡張してよい唯一の正当な理由は、新しいエンジンの機能を古い環境に持ち込む「バックポート」だけである。

〔補足〕攻撃者視点では、この「ビルトインプロトタイプを1か所書き換えると全インスタンスに波及する」性質こそが、プロトタイプ汚染で `Object.prototype` を狙う理由そのものだ。防御側は、ライブラリがビルトインプロトタイプを勝手に拡張していないか、そしてそれが上書きされていないかを診断の観点に加える。

---

## 6. プロトタイプチェーンの作成・変更6方法とプロトタイプ汚染

### 6.1 6つの方法（一覧）

MDN はプロトタイプチェーンを作る・変える方法を体系的に6つ挙げている。

| # | 方法 | 特徴 |
| --- | --- | --- |
| (1) | 構文構造（リテラル・`__proto__` キー） | 最速・最適化されやすい。リテラル内 `__proto__` は標準 |
| (2) | コンストラクタ関数 | 古くから使え高速。ただしメソッドがデフォルトで列挙可能になり class と不整合 |
| (3) | `Object.create()` | 生成時にプロトタイプを直接指定。第2引数で属性を精密指定可能。`Object.create(null)` が可能 |
| (4) | クラス（`class` / `extends`） | 複雑な継承の可読性が最高。private 要素が使える |
| (5) | `Object.setPrototypeOf()` | 既存オブジェクトの `[[Prototype]]` を後から書き換える |
| (6) | `__proto__` アクセサ | 非標準・非推奨。ほぼ常に `Object.setPrototypeOf` を使うべき |

(5) と (6) は既存オブジェクトを書き換える点が (1)〜(4) と違う。ただし MDN は「**動的にプロトタイプを設定するとエンジンの最適化が破壊され、再コンパイル（de-optimization）を招き得る**」ので、可能なら生成時に設定せよと戒めている。

### 6.2 `Object.create(null)` ― プロトタイプなしオブジェクト

```js
const d = Object.create(null);
// d ---> null （d はプロトタイプを一切持たない）
console.log(d.hasOwnProperty);
// undefined, because d doesn't inherit from Object.prototype
```

〔補足〕`Object.create(null)` で作ったオブジェクトは `Object.prototype` を継承しないので、`__proto__` も `hasOwnProperty` も持たない。これが「プロトタイプ汚染に対する強固な防御」および「キー衝突のない辞書」として推奨される技法の根拠になる。攻撃者が `__proto__` というキーを流し込んでも、それは単なる普通のプロパティ名として扱われ、プロトタイプには到達しない。

### 6.3 プロトタイプ汚染（prototype pollution）とは何か

ここまでの機構を組み合わせると、クライアントサイド脆弱性の代表格である **プロトタイプ汚染** の正体が見えてくる。

〔補足〕プロトタイプ汚染とは、`Object.prototype` に攻撃者が任意のキーと値を書き込む攻撃のこと。前章までで見た性質のうち、次の3つが揃うことで成立する。第一に、`prototype` に定義したプロパティは own property を持たない全オブジェクトから「見えて」しまう（探索順序）。第二に、`__proto__` や `constructor.prototype` という文字列キーを経由してプロトタイプ本体に到達できる。第三に、`obj[userKey] = userValue` のような再帰マージ処理で外部入力がキーと値の両方を制御できる。

たとえば `Object.prototype.isAdmin = true` が書き込まれると、以後 `if (opts.isAdmin)` のような分岐や、テンプレートエンジン・サニタイザの設定読み出しが「ガジェット」として成立し、権限昇格や XSS に繋がり得る。

MDN 本文はこの攻撃名を明示していないが、**成立に必要な機構（プロパティ探索順序・シャドウイング・`__proto__` の二つの意味・`constructor.prototype` 経路・`Object.create(null)` による防御）はすべて説明している**。診断者は、外部入力をオブジェクトにマージする処理（`Object.assign` の再帰版、`merge` / `extend` ユーティリティ、`JSON.parse` 結果の展開）を見つけたら、`__proto__` / `constructor` / `prototype` というキーが弾かれているかを確認する。防御は、これらのキーの拒否、`Object.create(null)` の使用、`Map` の採用、`Object.freeze(Object.prototype)` である。

---

## 7. クラスとプライベートフィールド

### 7.1 なぜカプセル化か

MDN はクラスの章で「なぜ配列に直接アクセスできるのにゲッター／セッターを使うのか」という問いから始める。答えは **カプセル化（encapsulation）** ―「オブジェクトの内部実装に直接触らせず、抽象化されたメソッドでやり取りすべき」という考え方だ。内部表現を RGB から HSL に変えたとき、`values[0]` に直接依存したコードは壊れるが、`getRed()` を経由していれば壊れない。

### 7.2 プライベートフィールドは「ハードプライベート」

クラスではこれを **プライベートフィールド（private fields）** で実現する。`#` を前置した識別子で宣言する。

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
```

`#` はフィールド名の不可分な一部であり、public フィールドと名前衝突しない。**クラスの外から `#values` にアクセスすると「早期構文エラー（early syntax error）」になる**。これはコード実行前の静的解析で検出される。

```js
console.log(red.#values); // SyntaxError: Private field '#values' must be declared in an enclosing class
```

そして決定的な性質。**JavaScript のプライベートフィールドは _hard private_ である。** クラスが露出メソッドを用意していなければ、外部からそれを取得する機構は絶対に存在しない。露出メソッドの `setRed` に範囲チェックを入れておけば、`values` を露出したときのように `values[0] = 1000` で検証を回避されることがない。

### 7.3 診断上の意味 ― DevTools だけが例外

MDN は重要な注記を置いている（原文）。

> Code run in the Chrome console can access private elements outside the class. This is a DevTools-only relaxation of the JavaScript syntax restriction.

つまり **Chrome のコンソールで実行するコードだけは、例外的にクラス外からプライベート要素にアクセスできる**。これは DevTools 限定の構文制限の緩和である。

〔補足〕この事実は診断で実用的だ。ページ内の他スクリプト（XSS ペイロードを含む）からは `#field` に到達できないが、**調査者は DevTools のコンソールから内部状態を観察できる**。逆に、クロージャや `WeakMap` で実装された「疑似プライベート」は hard private ではなく、同一コンテキストの他コード（プロトタイプ経由のメソッド借用、`Function.prototype.call` によるメソッド流用）から到達できる余地がある。「本当に守られている状態か、DevTools やメソッド借用で覗けるか」を見分けることが重要になる。

なお、存在しないプライベート要素へのアクセスは `undefined` を返さずエラーを投げる。存在確認をしたいときは `#values in anotherColor` のように `in` 演算子を使う（`"#values" in obj` は文字列キーを探してしまうので不可）。同名の二重宣言や `delete this.#field` はどちらも構文エラーになる。メソッド・getter・setter も `#` で private にできる。

---

## 8. イテレータとジェネレータ

### 8.1 イテレータ ― 必要なときだけ値を作る

**イテレータ（iterator）** とは、値の列と、その終了を定義するオブジェクト。具体的には `next()` メソッドを持ち、呼ぶたびに次の2つを持つオブジェクトを返す。

| プロパティ | 意味（原文） |
| --- | --- |
| `value` | The next value in the iteration sequence. |
| `done` | This is `true` if the last value in the sequence has already been consumed. |

イテレータを反復することを「消費する（consume）」といい、一般に一度しかできない。配列と違い、**イテレータは値を必要なときにだけ作る**ので、無限列（0 から `Infinity` まで）も表現できる。

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

なお **あるオブジェクトがイテレータかどうかをリフレクティブに知ることはできない**。それが必要なら「イテラブル」を使う。

### 8.2 ジェネレータ関数

内部状態を手で管理するのは面倒なので、**ジェネレータ関数（generator function）** が代替を提供する。`function*` で書き、呼ぶと最初はコードを実行せず **Generator**（特別なイテレータ）を返す。`next()` を呼ぶと `yield` に当たるまで実行される。

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

各 Generator は一度だけ反復できる。`next(x)` で値を渡すと `yield` がそれを受け取り内部状態を変えられる（ただし最初の `next()` に渡した値は常に無視される）。`throw()` で generator 内に例外を注入したり、`return()` で終了させたりもできる。

### 8.3 イテラブルとイテレーションの乗っ取り

オブジェクトが `for...of` でどう回るかを定義していれば **イテラブル（iterable）** である。イテラブルになるには **`[Symbol.iterator]()` メソッドを実装**しなければならない。`String` / `Array` / `TypedArray` / `Map` / `Set` はビルトインのイテラブルだ。イテラブルを期待する構文は **`for...of`・スプレッド構文・`yield*`・分割代入（destructuring）** である。

```js
const myIterable = {
  *[Symbol.iterator]() {
    yield 1;
    yield 2;
    yield 3;
  },
};
[...myIterable]; // [1, 2, 3]
```

〔補足〕`[Symbol.iterator]` は「オブジェクトの振る舞いを外から差し替えられるフック」の代表例だ。攻撃者視点では、プロトタイプ汚染や Symbol プロパティ注入でイテレーション動作を乗っ取ると、スプレッドや分割代入に副作用を挿入できる。特に `Array.prototype[Symbol.iterator]` を改変すると、スプレッド構文の挙動全体が影響を受ける。

---

## 9. メタプログラミング ― Proxy と Reflect

### 9.1 Proxy とは（設計意図）

MDN の導入（原文）。

> The `Proxy` and `Reflect` objects allow you to intercept and define custom behavior for fundamental language operations (e.g., property lookup, assignment, enumeration, function invocation, etc.). ...

**Proxy** は、プロパティ取得・代入・列挙・関数呼び出しといった「言語の基本操作」を横取り（intercept）し、独自の振る舞いを差し込むためのオブジェクト。JavaScript の「メタレベル」でプログラムできる。

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

用語を整理する。

| 用語 | 定義（原文） |
| --- | --- |
| handler | Placeholder object which contains traps. |
| traps | The methods that provide property access.（OS の trap に相当） |
| target | Object which the proxy virtualizes.（プロキシが仮想化する対象） |
| invariants | Semantics that remain unchanged.（不変条件。**違反すると `TypeError`**） |

### 9.2 全13トラップ対応表（どの構文がどのトラップを発火するか）

Proxy には13個のトラップがあり、それぞれが横取りする操作が決まっている。この表は「フックを仕込むとき、どの構文を捕まえられるか」を知るための地図になる。

| Handler / trap | 横取りされる操作 |
| --- | --- |
| `getPrototypeOf()` | `Object.getPrototypeOf()` / `Reflect.getPrototypeOf()` / `__proto__` / `isPrototypeOf()` / `instanceof` |
| `setPrototypeOf()` | `Object.setPrototypeOf()` / `Reflect.setPrototypeOf()` |
| `isExtensible()` | `Object.isExtensible()` / `Reflect.isExtensible()` |
| `preventExtensions()` | `Object.preventExtensions()` / `Reflect.preventExtensions()` |
| `getOwnPropertyDescriptor()` | `Object.getOwnPropertyDescriptor()` / `Reflect.getOwnPropertyDescriptor()` |
| `defineProperty()` | `Object.defineProperty()` / `Reflect.defineProperty()` |
| `has()` | `foo in proxy` / `foo in Object.create(proxy)` / `Reflect.has()` |
| `get()` | `proxy[foo]` / `proxy.bar` / `Object.create(proxy)[foo]` / `Reflect.get()` |
| `set()` | `proxy[foo] = bar` / `proxy.foo = bar` / `Object.create(proxy)[foo] = bar` / `Reflect.set()` |
| `deleteProperty()` | `delete proxy[foo]` / `delete proxy.foo` / `Reflect.deleteProperty()` |
| `ownKeys()` | `getOwnPropertyNames()` / `getOwnPropertySymbols()` / `Object.keys()` / `Reflect.ownKeys()` |
| `apply()` | `proxy(..args)` / `Function.prototype.apply()`・`call()` / `Reflect.apply()` |
| `construct()` | `new proxy(...args)` / `Reflect.construct()` |

`get` / `set` / `has` が **継承経路（`Object.create(proxy)[foo]`）でも発火する**点に注目してほしい。これはプロトタイプ経由のアクセスまで観測・改変できることを意味する。

### 9.3 取り消し可能な Proxy と `typeof` の抜け穴

**`Proxy.revocable()`** は取り消せる Proxy を作る。`revoke()` を呼ぶと以後どの操作も `TypeError` になる。

```js
const revocable = Proxy.revocable({}, {
  get(target, name) { return `[[${name}]]`; },
});
const proxy = revocable.proxy;
console.log(proxy.foo); // "[[foo]]"
revocable.revoke();
console.log(proxy.foo); // TypeError: Cannot perform 'get' on a proxy that has been revoked
console.log(typeof proxy); // "object", typeof doesn't trigger any trap
```

最後の行が重要だ。**`typeof` はいかなるトラップも発火しない。** フックで捕まえられない操作があることを覚えておく。

### 9.4 Reflect ― 既定動作の転送とメソッド借用

**Reflect** は、横取り可能な操作と同名のメソッドを持つビルトインオブジェクト（関数オブジェクトではない）。proxy handler から既定動作を `target` へ転送するのに使う。`in` 演算子を関数化した `Reflect.has(Object, "assign")` などがある。

`Reflect.apply` は「メソッド借用」を簡潔にする。

```js
Reflect.apply(Math.floor, undefined, [1.75]); // 1
Reflect.apply("".charAt, "ponies", [3]);      // "i"
```

また `Object.defineProperty` は失敗時に例外を投げるが、`Reflect.defineProperty()` は成功／失敗を Boolean で返すので `if...else` で扱える。

```js
if (Reflect.defineProperty(target, property, attributes)) {
  // success
} else {
  // failure
}
```

### 9.5 攻撃・防御の両面で使う

〔補足〕Proxy / Reflect は診断でも防御でも実用性が高い。

- **観測（計測・taint 追跡）** ― `window.fetch`、`XMLHttpRequest.prototype.open`、`Element.prototype.setAttribute`、`innerHTML` の setter などを Proxy や `Object.defineProperty` でラップし、どの値がどの sink に届くかを記録する。上の13トラップ表は「どの構文がどのトラップを発火するか」の正確な対応なので、フックの取りこぼしを防ぐ根拠資料になる。
- **落とし穴** ― `typeof` はトラップを発火しない。また invariant 違反は `TypeError` になるため、`Object.freeze` 済みや non-configurable プロパティを持つ target にはフックを仕込めない。
- **メソッド借用による堅牢化** ― `Reflect.apply("".charAt, "ponies", [3])` は、対象が独自の `charAt` を持っていても組み込み実装を強制できることを示す。サニタイザが改変された組み込みメソッドに依存しないための「safe intrinsics（安全な組み込み）」確保に同じ考え方が使われる。

各トラップの引数・返り値・invariant 違反の具体条件は Proxy リファレンスの各サブページにある。本教科書環境では取得できなかったので、フックを正しく実装したい読者は自分で開いてほしい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: MDN `Proxy` リファレンス（各トラップの詳細ページ） — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `developer.mozilla.org` がこの実行環境の egress proxy によりブロックされ、`web.archive.org` も同様に拒否された）。以下の記述は MDN ガイドのソース Markdown からの要約である。
> **読みどころ**:
> 1. 各トラップ（`get` / `set` / `has` / `apply` など）の引数・返り値の正確な仕様を確認し、フックが `TypeError`（invariant 違反）を起こさない実装を学ぶ。
> 2. ページ下部のブラウザ互換性テーブルで、対象ブラウザが Proxy をサポートしているかを確認する。
> **代替手段**: MDN のソース原稿は `github.com/mdn/content` の `files/en-us/web/javascript/reference/global_objects/proxy/` から無料で読める。

---

## 10. Promise ― 非同期処理とタイミング

### 10.1 Promise とチェーン（設計意図）

**Promise** は「非同期操作の最終的な完了または失敗を表すオブジェクト」。関数にコールバックを渡す代わりに、返ってきたオブジェクトにコールバックを取り付ける。

```js
createAudioFileAsync(audioSettings).then(successCallback, failureCallback);
```

コールバックを深くネストする **コールバック地獄（callback hell）** を、Promise は **チェーン（promise chain）** で解消する。要点は **`then()` が元とは別の新しい Promise を返す** こと。だから連結できる。

```js
doSomething()
  .then((result) => doSomethingElse(result))
  .then((newResult) => doThirdThing(newResult))
  .then((finalResult) => {
    console.log(`Got the final result: ${finalResult}`);
  })
  .catch(failureCallback);
```

`catch(failureCallback)` は `then(null, failureCallback)` の短縮形。チェーン末尾に置けば全ステップのエラーをまとめて処理できる。

### 10.2 floating promise ― `return` 忘れが競合を生む

**`then` のコールバックからは常に Promise を返すこと**が重要だ。返さないと、その Promise の settle（決着）を追跡できなくなる。これを **floating（浮遊している）** 状態という。

```js
// 悪い例：fetch(url) の前に return がない
doSomething()
  .then((url) => {
    fetch(url); // ← 返していない
  })
  .then((result) => {
    // result is undefined
  });
```

これは競合状態（race condition）があるとさらに悪化する。次の例では `listOfIngredients` が常に空になる。fetch が完了する前に次の `then` が走るからだ。

```js
const listOfIngredients = [];
doSomething()
  .then((url) => {
    fetch(url) // ← return なし
      .then((res) => res.json())
      .then((data) => { listOfIngredients.push(data); });
  })
  .then(() => {
    console.log(listOfIngredients); // 常に []
  });
```

経験則は「**Promise に遭遇したら必ず返し、その処理を次の `then` に委ねる**」。理想はネストを平坦なチェーンにすること。`async`/`await` を使うとさらに同期コードに近く書けるが、**`await` の付け忘れ**という別の落とし穴がある。

### 10.3 エラー処理とネストによる catch のスコープ限定

Promise チェーンのエラーは、下方向に `.catch()` を探して伝播する。これは `try`/`catch` に近い。**Promise はコールバックの根本的欠陥を解決し、投げられた例外やプログラミングエラーまで含めてすべてのエラーを捕まえる。**

ネストは「`catch` のスコープを限定する制御構造」として使える。次の例では、オプション処理の失敗は内側の `catch` が飲み込み、`doSomethingCritical()` の失敗だけは外側の `catch` に届く。

```js
doSomethingCritical()
  .then((result) =>
    doSomethingOptional(result)
      .then((optionalResult) => doSomethingExtraNice(optionalResult))
      .catch((e) => {}), // オプションの失敗は無視して続行
  )
  .then(() => moreCriticalStuff())
  .catch((e) => console.error(`Critical failure: ${e.message}`));
```

ネストを生んでいるのはインデントではなく、ステップを囲む `(` と `)` の位置である点に注意する。

### 10.4 Promise rejection イベント（診断で重要）

reject がどのハンドラでも処理されないと、host がそれを表面化する必要がある。ウェブでは Promise が reject されるたび、グローバルスコープ（通常 `window`）に次の2つのイベントのいずれかが送られる。

| イベント | 意味（原文） |
| --- | --- |
| `unhandledrejection` | Sent when a promise is rejected but there is no rejection handler available. |
| `rejectionhandled` | Sent when a handler is attached to a rejected promise that has already caused an `unhandledrejection` event. |

どちらも型は **`PromiseRejectionEvent`** で、reject された Promise を示す `promise` プロパティと、理由を示す `reason` プロパティを持つ。**これらのハンドラはコンテキストごとにグローバル**なので、ソースを問わず全エラーが同じハンドラに集まる。なお Node.js では `unhandledRejection`（**大文字化が違う**）を `process.on` で捕まえる。

〔補足〕`unhandledrejection` は診断作業にも使える。

```js
window.addEventListener('unhandledrejection', e => console.log(e.reason));
```

これを仕込むと、アプリが黙って飲み込んでいた非同期エラーを可視化できる。`e.reason` にサーバ側のエラーメッセージや内部パスが含まれていれば、情報漏えいの報告材料になる。

### 10.5 合成（4つのツール）とキャンセル

並行実行のための **合成ツール（composition tools）** が4つある。

| メソッド | 振る舞い |
| --- | --- |
| `Promise.all()` | 1つでも reject すると即座に reject。他は実行を続けるが結果は取れない |
| `Promise.allSettled()` | 全部が settle するのを待ってから resolve |
| `Promise.any()` | いずれか1つが fulfill すれば resolve |
| `Promise.race()` | 最初に settle したものに従う |

`Promise.all()` の「1つ reject すると即返るが他は走り続ける」性質は、予期しない状態を生み得る。全完了を保証したいなら `Promise.allSettled()` を使う。これらは並行実行なので、**互いに依存しないなら不必要にブロックせず並行にする方が常に良い**。Promise 自身はキャンセルの first-class なプロトコルを持たないので、通常は **`AbortController`** で下層の操作を中断する。

### 10.6 タイミング ― マイクロタスクと task queue（競合の理解に必須）

Promise は **制御の反転（inversion of control）** の一形態で、コールバックのタイミングを実装に委ねることで強い保証を与える（原文の3項目）。

- `then()` で追加したコールバックは、現在の実行が完了する前には決して呼ばれない。
- 非同期操作の成功／失敗の「後」に追加しても呼ばれる。
- 複数追加でき、追加した順に呼ばれる。

驚きを避けるため、**`then()` に渡した関数は、既に resolve 済みでも決して同期的には呼ばれない**。代わりに **マイクロタスクキュー（microtask queue）** に置かれ、実行スタックが空になった直後に走る。

```js
Promise.resolve().then(() => console.log(2));
console.log(1);
// Logs: 1, 2
```

そして決定的な違い。**Promise コールバックはマイクロタスク、`setTimeout()` コールバックは task queue として扱われ、マイクロタスクの方が先に走る。**

```js
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

wait(0).then(() => console.log(4));
Promise.resolve()
  .then(() => console.log(2))
  .then(() => console.log(3));
console.log(1); // 1, 2, 3, 4
```

〔補足〕このマイクロタスク／タスクの実行順は、**競合状態（race condition）と TOCTOU**（Time Of Check to Time Of Use、検証してから使うまでの隙間で値が書き換わる問題）を組み立て・説明するのに不可欠だ。**`await` の後ろのコードは必ずマイクロタスク境界を挟む**ため、「`await` を挟んで再取得しない」コードはその境界で状態が変わり得る。診断では「`postMessage` ハンドラ内の `await` の前後でオリジン検証が行われているか」といった観点が典型になる。

---

## 手を動かす

以下はいずれも自分のブラウザの DevTools コンソール（F12 → Console）や自分で立てた検証環境で試すこと。他人のサイトに対しては、許可された診断・バグバウンティの範囲でのみ行う。

1. **オブジェクトインジェクションを体感する**。次を貼り付け、キーを変えて挙動を見る。

```js
const config = { theme: "dark", lang: "ja" };
function getSetting(userKey) {
  return config[userKey]; // ← 危険なパターン
}
console.log(getSetting("theme"));       // "dark"
console.log(getSetting("__proto__"));   // [Object: null prototype] {} など、内部に到達
console.log(getSetting("constructor")); // ƒ Object() ... 想定外のものが返る
```

2. **防御版に書き換える**。許可リストと `Object.hasOwn` でガードする。

```js
const ALLOWED = new Set(["theme", "lang"]);
function getSettingSafe(userKey) {
  if (!ALLOWED.has(userKey) || !Object.hasOwn(config, userKey)) return undefined;
  return config[userKey];
}
console.log(getSettingSafe("__proto__")); // undefined
```

3. **プロトタイプ汚染の成立と防御を観察する**。検証用オブジェクトで試す。

```js
const obj = {};
obj["__proto__"]; // これは代入ではないので汚染しない（アクセサ）
// 危険なマージを模す:
function unsafeMerge(dst, key, val) { dst[key] = val; }
const victim = {};
// (実際の攻撃は再帰マージで __proto__ 経由に到達する。ここは概念確認)
const safe = Object.create(null);
console.log("__proto__" in safe); // false ← 防御されている
```

4. **sink をフックして計測する**。自分のページで `fetch` に届く URL を記録する。

```js
const origFetch = window.fetch;
window.fetch = function (...args) {
  console.log("[fetch]", args[0]);
  return origFetch.apply(this, args);
};
```

5. **private フィールドを DevTools から覗く**。7章の `Color` クラスを定義し、`const c = new Color(1,2,3);` のあと、コンソールで `c.#values` と打つ。スクリプト内では構文エラーになるが、Chrome コンソールだけは値を返すことを確認する。

6. **マイクロタスクとタスクの順序を確かめる**。10.6 の `1, 2, 3, 4` を出力するコードを貼り、出力順が「同期 → マイクロタスク → タスク」になることを目で見る。

## つまずきポイント

- **`obj.__proto__` と `{ __proto__: x }` と `func.prototype` を混同する**。前二者はプロトタイプ「本体」に関わり（アクセサ版は非推奨、リテラルキー版は標準）、`func.prototype` は「その関数で作るインスタンスに配られるプロトタイプ」を指す。まったく別物。
- **`for...in` がプロトタイプまで舐めることを忘れる**。自身のプロパティだけ見たいなら `Object.hasOwn` でフィルタするか `Object.keys()` を使う。
- **プロパティが `undefined` かどうかだけで存在判定する**。値がたまたま `undefined` の場合と区別できない。`Object.hasOwn` / `in` を使う。
- **`then` の中で Promise を `return` し忘れる**（floating promise）。競合状態を生み、次の `then` が空の値を読む。
- **`typeof` で Proxy を検知できると思う**。`typeof` はどのトラップも発火しない。
- **private フィールドを「絶対に覗けない」と誤解する**。スクリプトからは hard private だが、DevTools コンソールは例外。クロージャ／WeakMap の疑似 private はさらに緩い。
- **`Promise.all` が全完了を保証すると思う**。1つでも reject すれば即座に返る。全完了は `Promise.allSettled`。
- **ビルトインプロトタイプを気軽に拡張する（monkey patching）**。前方互換性を壊し、SmooshGate のような事故を招く。

## この節のまとめ

- オブジェクトはプロパティ（キーと値の対応）の集まり。キーは文字列か Symbol のみで、他は文字列に変換される。配列インデックスも実は文字列キー。
- ブラケット記法は動的なキーアクセスのためにあるが、**外部入力をキーにすると object injection（オブジェクトインジェクション）に脆弱**になる。MDN が唯一明示的にリンクするセキュリティ文書がこれを扱う。
- 防御は許可リスト・`Object.hasOwn`・`Map`・`Object.create(null)`。
- 各オブジェクトは `[[Prototype]]` で別オブジェクトに繋がり、プロパティは自身→プロトタイプ→…と探索される。自身のプロパティが同名を隠すのがシャドウイング。
- `__proto__` には非推奨のアクセサと標準のリテラルキーの2つの意味がある。`func.prototype` はインスタンスに配るプロトタイプで別物。
- コンストラクタの `prototype` を書き換えると、生成済みインスタンスにも波及する。この性質が **プロトタイプ汚染（prototype pollution）** が強力な理由。MDN は攻撃名こそ出さないが、成立に必要な機構をすべて説明している。
- ビルトインプロトタイプの拡張（monkey patching）は前方互換性を壊す。SmooshGate が実例。
- クラスの `#` プライベートフィールドは **hard private**。ただし Chrome の DevTools コンソールだけは外からアクセスできる。診断でこの差を使い分ける。
- イテレータは必要なときに値を作り、`[Symbol.iterator]` がスプレッド・分割代入・`for...of` を制御する。これ自体が乗っ取りのフックになり得る。
- Proxy は13のトラップで基本操作を横取りする。`get`/`set`/`has` は継承経路でも発火する。`typeof` は発火しない。Reflect は既定動作の転送とメソッド借用に使う。
- Proxy/Reflect は sink のフック（taint 追跡）と、safe intrinsics による堅牢化の両方に使える。
- Promise は非同期の完了／失敗を表し、`then` は新しい Promise を返してチェーンできる。`return` 忘れ（floating promise）は競合を生む。
- 未処理の reject は `unhandledrejection` イベントで表面化する。診断者はこれを仕込んで隠れた非同期エラーや情報漏えいを可視化できる。
- Promise コールバックはマイクロタスク、`setTimeout` はタスクで、マイクロタスクが先。この順序が競合状態・TOCTOU の理解に不可欠。`await` の後ろは必ずマイクロタスク境界を挟む。

## 理解度チェック

1. `obj[userKey]` で `userKey` に外部入力を使うと、なぜ危険なのか。3つの理由を挙げよ。
▶ 答え: (1) `__proto__` / `constructor` / `prototype` を指定されるとプロトタイプ汚染の入口になる、(2) `Object.prototype` 由来のメソッドなど意図しない内部プロパティを読み出せる、(3) `handlers[userKey]()` 形式では任意メソッド呼び出しに繋がり得る。

2. `for...in` と `Object.keys()` の違いは何か。自身のプロパティだけを安全に扱うにはどうするか。
▶ 答え: `for...in` は列挙可能な文字列プロパティをプロトタイプチェーンまで走査するが、`Object.keys()` は自身の列挙可能な文字列プロパティ名のみを返す。`for...in` を使うなら `Object.hasOwn(obj, key)` でフィルタする。

3. `obj.__proto__`（アクセサ）と、オブジェクトリテラル内の `{ __proto__: x }` は標準・非推奨の点でどう違うか。
▶ 答え: アクセサとしての `Object.prototype.__proto__` は非標準かつ非推奨で、ほぼ常に `Object.setPrototypeOf` を使うべき。一方、オブジェクトリテラル初期化子の中で使う `__proto__` キーは標準であり非推奨ではない。

4. プロトタイプ汚染が成立するために、この節で学んだどの機構が必要か。防御技法を1つ挙げよ。
▶ 答え: プロパティ探索順序（プロトタイプまで見える）、`__proto__` や `constructor.prototype` という文字列キー経由でプロトタイプ本体に到達できること、外部入力がキーと値を制御できるマージ処理。防御は `Object.create(null)`、キー（`__proto__`等）の拒否、`Map` の使用、`Object.freeze(Object.prototype)` など。

5. クラスの `#` プライベートフィールドは「hard private」だが、唯一の例外は何か。診断でこれをどう使うか。
▶ 答え: Chrome の DevTools コンソールで実行したコードだけは、クラス外からプライベート要素にアクセスできる。診断者はスクリプトからは到達できない内部状態を、DevTools コンソールから観察できる。

6. Proxy の `get` トラップは、直接の `proxy.foo` 以外にどんな経路で発火するか。逆に発火しない操作は何か。
▶ 答え: `Object.create(proxy)[foo]` のような継承経路や `Reflect.get()` でも発火する。一方 `typeof proxy` はどのトラップも発火しない。

7. `then` のコールバックで Promise を `return` し忘れると何が起きるか。名前を付けて説明せよ。
▶ 答え: その Promise は floating promise（浮遊した Promise）になり、settle を追跡できなくなる。競合状態があると次の `then` が完了前の不完全な値（例: 空配列）を読み、バグや競合を生む。

8. `Promise.all()` と `Promise.allSettled()` の違いは何か。
▶ 答え: `Promise.all()` は1つでも reject すると即座に reject し、他の操作は走り続けるが結果は取れない。`Promise.allSettled()` はすべての操作が settle してから resolve するので、全完了を保証したいときに使う。

9. マイクロタスクと task queue はどちらが先に実行されるか。この順序がなぜセキュリティ診断に関係するか。
▶ 答え: Promise コールバックはマイクロタスク、`setTimeout` はタスクで、マイクロタスクが先に実行される。`await` の後ろは必ずマイクロタスク境界を挟むため、検証してから使うまでの間に状態が変わる TOCTOU・競合状態の理解に不可欠。

10. `unhandledrejection` イベントは診断でどう役立つか。
▶ 答え: `window.addEventListener('unhandledrejection', e => console.log(e.reason))` を仕込むと、アプリが黙って飲み込んでいた非同期エラーを可視化できる。`e.reason` にサーバ側メッセージや内部パスが含まれていれば情報漏えいの報告材料になる。

## 出典

- MDN JavaScript Guide（ハブ）: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide
- Working with objects: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Working_with_objects
- Inheritance and the prototype chain: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Inheritance_and_the_prototype_chain
- Using classes: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_classes
- Iterators and generators: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Iterators_and_generators
- Meta programming: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Meta_programming
- Using promises: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
- eslint-plugin-security "The dangers of square bracket notation": https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md
- SmooshGate: https://developer.chrome.com/blog/smooshgate/
- MDN Proxy リファレンス: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy

<!-- sources: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Working_with_objects, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Inheritance_and_the_prototype_chain, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_classes, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Iterators_and_generators, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Meta_programming, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises, https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md -->
<!-- terms: オブジェクトインジェクション（object injection）, ブラケット記法（bracket notation）, プロトタイプチェーン（prototype chain）, プロパティシャドウイング（property shadowing）, プロトタイプ汚染（prototype pollution）, monkey patching, Object.create(null), プライベートフィールド（private fields）, hard private, イテレータ（iterator）, ジェネレータ（generator）, イテラブル（iterable）, Symbol.iterator, Proxy, トラップ（trap）, Reflect, invariants, Promise, floating promise, unhandledrejection, PromiseRejectionEvent, マイクロタスク（microtask）, task queue, 制御の反転（inversion of control）, AbortController, race condition, TOCTOU -->
<!-- self-read: https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/the-dangers-of-square-bracket-notation.md | 取得対象範囲外の外部資料でありMDNからのリンク先として名前とURLのみ確認 -->
<!-- self-read: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy | developer.mozilla.orgがegress proxyでブロックされ各トラップ詳細ページを取得できず -->
