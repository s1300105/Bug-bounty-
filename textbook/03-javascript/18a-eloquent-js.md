# JavaScriptという「寛容すぎる」言語 — 診断者のための基礎（Eloquent JavaScript前半）

> **この節で分かること**
> - JavaScriptがなぜ「エラーを教えてくれない」設計になったのか、その歴史と設計思想を説明できる
> - 高階関数（filter/map/reduce/some/find）と、UTF-16のcode unit問題が診断でなぜ効くのかを説明できる
> - プロトタイプ連鎖と「素のオブジェクトをマップに使う危険」を、prototype pollutionの前提として説明できる
> - `#`によるプライベートプロパティ・Symbol・iteratorといったカプセル化の仕組みを自分で書ける
> - strict mode・例外・`finally`・選択的catchを使い、静かに壊れるコードを見つけて防げる

**元資料**: https://eloquentjavascript.net/ （原典は取得できず、著者公式ソースリポジトリ marijnh/Eloquent-JavaScript master ブランチの原稿全文から取得。サイト本体はエージェントプロキシの組織ポリシーで遮断されたため保守的に「二次情報ベース」扱い）
**関連する節**: 同じ書籍の後半（第9章 正規表現とReDoS、第10章 モジュール、第11章 非同期、第13〜21章 ブラウザとNode.js）を扱う節

---

## 0. この節の位置づけ — なぜバグハンターが「入門書」を読むのか

### Eloquent JavaScriptは「攻撃名を教える本」ではない

まず最初にはっきりさせておく。Eloquent JavaScript（第4版、Marijn Haverbeke著）は、クライアントサイド脆弱性の攻撃手法を教える本**ではない**。原稿全文を検索して確認した事実として、この本には次の語が**一度も出てこない**。

- `XSS` / `Cross-Site Scripting`（クロスサイトスクリプティング）
- `CSRF` / `Cross-Site Request Forgery`（クロスサイトリクエストフォージェリ）
- `Same-Origin Policy`（同一オリジンポリシー）/ `CORS` / `clickjacking` / `Content Security Policy`

つまり、XSS・CSRF・CORS・CSPといった具体的な攻撃・防御の技術は、この本からは引用できない。それらはOWASPやPortSwigger、MDNなど別の資料から学ぶことになる。

### では、なぜ読むのか

理由は、この本が**「ブラウザのサンドボックスという設計思想と、その上で動くDOM・イベント・HTTP APIを正確に教える」**からである。脆弱性ハンティングとは、突き詰めれば「この言語とブラウザがどう動くと**思われているか**」と「実際にどう動くか」のズレを探す作業だ。攻撃名を暗記しても、土台となる言語の挙動を正確に知らなければ、ズレには気づけない。

〔補足〕この節が扱うのは前半、すなわち言語本体（第0・5・6・8章）である。正規表現（ReDoSの原理）、モジュール、非同期、ブラウザAPIは別の節で扱う。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Eloquent JavaScript 第4版（オンライン無料版） — https://eloquentjavascript.net/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限。エージェントプロキシの組織ポリシーで遮断され、curlも403となった）。本文の記述は著者公式リポジトリ（marijnh/Eloquent-JavaScript, master）のMarkdown原稿という**原典そのもの**にもとづく要約だが、「サイトのページとして」の体裁（章ごとのコードサンドボックスへのリンク、翻訳一覧、紙版リンク）は読めていない。
> **読みどころ**:
> 1. 各章末のサンドボックス（例: https://eloquentjavascript.net/code#5）で、本文のコードをブラウザ上で実際に実行して挙動を確かめる
> 2. 第5章のSCRIPTSデータセットのように、本文が依存する外部データ込みで動かせる環境が用意されている
> 3. `{{if commercial}}` で囲まれた「速度最適化の章」は紙版・有料版のみで、無料オンライン版には**存在しない章**がある点を確認する
> **代替手段**: 著者公式リポジトリ https://github.com/marijnh/Eloquent-JavaScript のMarkdown原稿（`00_intro.md` 〜 `21_skillsharing.md`）が無料で全章読める。ライセンスは非商用の派生（翻訳など）を許す形。

## 1. JavaScriptの歴史と「寛容すぎる」という設計 — なぜバグが静かに隠れるのか

### なぜそうなっているのか（設計意図）

JavaScriptは**1995年**、Netscape Navigatorでウェブページにプログラムを載せる手段として導入された。ページをリロードせずに操作できる「モダンWebアプリケーション」を可能にした立役者である。

名前が「Java」に似ているのは、Javaとほぼ無関係であるにもかかわらず、当時Javaが強く売り込まれ人気だったため、その成功に便乗しようとした**マーケティング上の判断**による。著者は「今もその名前に縛られている」と書いている。

Netscape外に採用が広がると、実装間で同じ言語を保証するために標準文書が書かれた。標準化団体Ecma Internationalにちなみ、標準は**ECMAScript（エクマスクリプト）**と呼ばれる。実務上、ECMAScriptとJavaScriptは同じ言語の2つの名前として交換可能に使われる。

### どう動くのか（バージョン史）

原文の記述をそのまま整理すると、次のようになる。

| 版 | 時期 | 位置づけ |
|---|---|---|
| ECMAScript 3 | 2000〜2010年頃 | 支配的で広くサポートされた版 |
| version 4 | （計画のみ） | 野心的すぎて政治的に困難と判明し、**2008年に作業放棄** |
| version 5 | 2009年 | 論争のない改良だけを入れた版 |
| version 6 | 2015年 | version 4のアイデアの一部を含む大型更新（`class`・`Symbol`など） |
| 以降 | 毎年 | 小さな更新 |

本書は2024年版のJavaScriptを使う。言語設計者は既存プログラムを壊す変更を避けるよう注意しているので、新しいブラウザでも古いプログラムが動く。この「後方互換性への執着」が、後で述べるstrict modeやプロトタイプの奇妙な仕様の背景になる。

JavaScriptはブラウザ専用ではない。MongoDBやCouchDBといったデータベースがスクリプト／クエリ言語として使い、サーバ向けプラットフォーム（最も有名なのが**Node.js**）がブラウザ外の実行環境を提供する。

### 攻撃者はどこを突くのか — 「寛容さ」という穴

診断の文脈でこの本の最も本質的な一文は、著者自身によるJavaScript評である。

> JavaScriptは許容範囲がばかばかしいほど寛容（ridiculously liberal in what it allows）である。この設計の背後にある考えは初心者に易しくすることだったが、実際にはシステムが問題を指摘してくれないため、プログラムの問題を見つけるのを難しくしているだけだ。

`true * "monkey"` のような明らかに無意味な式さえ、JavaScriptはエラーを出さずに実行し、`NaN`（Not a Number、数でない値）を返す。この「静かに間違った値を作り続ける」性質こそが、後述するバグと脆弱性の温床になる。

### どう守るのか（この節全体の予告）

この寛容さに対する防御は、本書全体を通じて次の3層で提示される。この節では前半の言語部分を扱う。

1. **抽象化と語彙**（第5・6章）— 問題に合った語彙でコードを書き、複雑さそのものを減らす
2. **strict modeと型**（第8章）— 言語に「もっと文句を言わせる」
3. **例外とアサーション**（第8章）— 静かな失敗を、大声で失敗する形に変える

## 2. 高階関数 — 「隙間のある計算」を抽象化する

### なぜそうなっているのか — 大きなプログラムは高コスト

第5章の主張は明快だ。**大きなプログラムは高コストなプログラムである。** 単に構築時間のためだけではない。サイズはほぼ常に**複雑さ**を伴い、複雑さはプログラマを混乱させ、混乱したプログラマはバグを入れる。しかも大きなプログラムはバグの隠れ場所を多く提供するので、発見が難しくなる。

著者は、6行の自己完結プログラムより、外部の2関数（`sum`と`range`）に依存する1行のプログラムのほうが正しい可能性が高いと主張する。理由は、**解かれている問題に対応する語彙で解が表現されている**からだ。「数の範囲を合計する」ことは、ループやカウンタの話ではなく、範囲と合計の話である。

ここで診断者にとって重要なスキルが語られる。**「抽象度が低すぎるレベルで作業していると気づくのは、プログラミングにおける有用なスキルである。」** コードレビューでも同じで、低レベルな手続きが延々と並ぶコードは、しばしばバグと脆弱性の巣になる。

### どう動くのか — 高階関数の3つの形

他の関数を引数に取るか返すかして、関数に対して操作する関数を**高階関数（higher-order function）**と呼ぶ。用語は数学に由来する。高階関数は値だけでなく**アクションに対する抽象化**を可能にし、形は3つある。

- 新しい関数を**作る**関数
- 他の関数を**変える**関数
- 新しい種類の**制御フロー**を提供する関数

まず、ループを抽象化する`repeat`から見る。

```javascript
function repeat(n, action) {
  for (let i = 0; i < n; i++) {
    action(i);
  }
}

repeat(3, console.log);
// → 0
// → 1
// → 2
```

`action`という「隙間（gap）」を関数として外から差し込めるのが要点だ。次は3つの形の実例である。

```javascript
function greaterThan(n) {
  return m => m > n;
}
let greaterThan10 = greaterThan(10);
console.log(greaterThan10(11));
// → true
```

```javascript
function noisy(f) {
  return (...args) => {
    console.log("calling with", args);
    let result = f(...args);
    console.log("called with", args, ", returned", result);
    return result;
  };
}
noisy(Math.min)(3, 2, 1);
// → calling with [3, 2, 1]
// → called with [3, 2, 1] , returned 1
```

`noisy`のように既存関数を包んでログを差し込むパターンは、そのままデバッグやトレースの道具になる。

### 配列の高階メソッド — filter/map/reduce/some/find

配列は多数の高階メソッドを備える。まず自前実装を見て、標準メソッドと対応づける。

```javascript
function filter(array, test) {
  let passed = [];
  for (let element of array) {
    if (test(element)) {
      passed.push(element);
    }
  }
  return passed;
}
```

```javascript
function map(array, transform) {
  let mapped = [];
  for (let element of array) {
    mapped.push(transform(element));
  }
  return mapped;
}
```

```javascript
function reduce(array, combine, start) {
  let current = start;
  for (let element of array) {
    current = combine(current, element);
  }
  return current;
}

console.log(reduce([1, 2, 3, 4], (a, b) => a + b, 0));
// → 10
```

標準メソッドの役割を整理する。

| メソッド | 役割 |
|---|---|
| `forEach` | 各要素をループで処理する |
| `filter` | 述語関数を通った要素だけの新しい配列を返す |
| `map` | 各要素を関数に通して変換する |
| `reduce` | 全要素を単一の値に結合する（`start`省略時は最初の要素が初期値） |
| `some` | いずれかの要素が述語に一致すれば`true` |
| `find` | 述語に一致する最初の要素を返す |

これらをつなぐと、ループを使わずに「生きている表記体系の平均起源年」を計算できる。

```javascript
console.log(Math.round(average(
  SCRIPTS.filter(s => s.living).map(s => s.year))));
// → 1165
```

ここで`SCRIPTS`は、章のサンドボックスで提供されるデータセットで、Unicodeの**140の表記体系（script）**の情報を持つ（うち81が使用中、59が歴史的）。各要素は次の形をしている。

```json
{
  name: "Coptic",
  ranges: [[994, 1008], [11392, 11508], [11513, 11520]],
  direction: "ltr",
  year: -200,
  living: false,
  link: "https://en.wikipedia.org/wiki/Coptic_alphabet"
}
```

`ranges`はUnicode文字範囲の配列で、各要素は`[下限, 上限]`。**下限はinclusive（含む）、上限はnoninclusive（含まない）**という非対称に注意。この「境界の含む・含まない」の取り違えは、範囲チェックのオフバイワンエラー、ひいては境界チェックのバイパスの典型的な原因になる。

## 3. UTF-16とcode unit — 診断で最も効く「文字数の嘘」

### なぜそうなっているのか

JavaScriptの文字列は**16ビット数の列**としてエンコードされ、この単位を**code unit（コードユニット）**と呼ぶ。Unicodeの文字コードは当初この1ユニット（65,000文字強）に収まる想定だったが、足りないと判明した。メモリ増を嫌う声に対処するために発明されたのが**UTF-16**で、一般的な文字は1ユニット、それ以外は2ユニットのペア（サロゲートペア）で表す。

著者の評価は辛辣だ。

> UTF-16 is generally considered a bad idea today. It seems almost intentionally designed to invite mistakes.（UTF-16は今日では悪いアイデアと見なされている。まるで意図的にミスを誘うよう設計されたかのようだ。）

### どう動くのか — length は文字数ではない

決定的な事実は、**`length`プロパティと角括弧アクセスはcode unitしか扱わない**という点だ。絵文字は多くが2ユニット文字なので、次のようになる。

```javascript
// Two emoji characters, horse and shoe
let horseShoe = "🐴👟";
console.log(horseShoe.length);
// → 4
console.log(horseShoe[0]);
// → (Invalid half-character)
console.log(horseShoe.charCodeAt(0));
// → 55357 (Code of the half-character)
console.log(horseShoe.codePointAt(0));
// → 128052 (Actual code for horse emoji)
```

2文字の絵文字なのに`length`は`4`を返す。`charCodeAt`はcode unit（半分の文字）を返し、後から追加された`codePointAt`は完全な文字を返すが、渡す引数は依然としてcode unit列へのインデックスである。

正しく1文字ずつ走るには、UTF-16の問題が意識されていた時期に導入された`for`/`of`ループを使う。これは**code unitではなく実際の文字**を返す。

```javascript
let roseDragon = "🌹🐉";
for (let char of roseDragon) {
  console.log(char);
}
// → 🌹
// → 🐉
```

### 攻撃者はどこを突くのか

〔補足〕このcode unitと文字の乖離は、次の脆弱性の原理になる（ただし本書はこの応用には言及していない）。

- **長さ制限バリデーションのバイパス**: `length`で入力長を数えるバリデーションは、絵文字やまれな漢字で「見た目の文字数」と食い違う。
- **文字列切り詰めによる出力破壊**: `slice`などがサロゲートペアを分断すると、不正な半文字が生まれ、後続のパーサが差異を起こす（パーサ間の解釈のズレは、それ自体がインジェクションの足がかりになる）。

### どう守るのか

ユーザー入力の長さや切り詰めを扱うコードでは、`length`を「文字数」と信じないこと。文字単位で数えるなら`[...str].length`や`for`/`of`を使い、切り詰めがサロゲートペアを割らないことを確認する。

## 4. プロトタイプ連鎖 — prototype pollutionの前提

### なぜそうなっているのか

プロトタイプ（prototype）は、オブジェクトを他のオブジェクトにリンクし、その他のオブジェクトが持つ全プロパティを「魔法のように」得る仕組みである。`{}`で作った素のオブジェクトは**`Object.prototype`**という名のオブジェクトにリンクされる。この仕組みのおかげで、すべてのオブジェクトが`toString`のような共通機能を持てる。

### どう動くのか — 連鎖探索

オブジェクトが自分の持たないプロパティを要求されると、そのプロトタイプが探される。そこにもなければ**プロトタイプのプロトタイプ**が探され、プロトタイプが`null`のオブジェクト（＝`Object.prototype`）に到達するまで続く。

```
myObject
   │ プロトタイプは？
   ▼
Array.prototype  （配列なら）
   │
   ▼
Object.prototype  （toString などを提供）
   │
   ▼
null  （連鎖の終端）
```

関数は`Function.prototype`から、配列は`Array.prototype`から派生する。

```javascript
console.log(Object.getPrototypeOf({}) == Object.prototype);
// → true
console.log(Object.getPrototypeOf(Object.prototype));
// → null
console.log(Object.getPrototypeOf([]) == Array.prototype);
// → true
```

`Object.create`を使うと、特定のプロトタイプを持つオブジェクトを作れる。

```javascript
let protoRabbit = {
  speak(line) {
    console.log(`The ${this.type} rabbit says '${line}'`);
  }
};
let blackRabbit = Object.create(protoRabbit);
blackRabbit.type = "black";
blackRabbit.speak("I am fear and darkness");
// → The black rabbit says 'I am fear and darkness'
```

### 攻撃者はどこを突くのか — 素のオブジェクトをマップに使う「危険」

本書はセキュリティという語こそ使わないが、素のオブジェクトをマップ（キーと値の対応表）に使うことを明確に**「危険（dangerous）」**と呼んでいる。理由は、素のオブジェクトが`Object.prototype`から派生するため、誰も登録していないキーが「存在する」ことになってしまうからだ。

```javascript
let ages = {
  Boris: 39,
  Liang: 22,
  Júlia: 62
};

console.log("Is Jack's age known?", "Jack" in ages);
// → Is Jack's age known? false
console.log("Is toString's age known?", "toString" in ages);
// → Is toString's age known? true
```

`"toString" in ages`が`true`になる。これは「連鎖探索がプロトタイプまで見に行く」性質の直接の帰結だ。

〔補足〕この連鎖探索の性質こそが、**prototype pollution**（`__proto__`や`constructor.prototype`への書き込みが、全オブジェクトに波及する攻撃）の前提である。ユーザー入力をオブジェクトのキーにするコードは、この波及の入口になりうる。**ただし本書はprototype pollutionという攻撃名・手法には一切言及していない。**

### どう守るのか — 3つの安全なパターン

| 手法 | やること | 効果 |
|---|---|---|
| `Object.create(null)` | プロトタイプを持たないオブジェクトを作る | `"toString" in obj`が`false`になる |
| `Map`クラス | 専用のマップ型を使う | 任意の型のキーを許し、プロトタイプ汚染と無縁 |
| `Object.hasOwn` | `in`の代わりに使う | プロトタイプを無視し、自身のプロパティだけ見る |

```javascript
console.log("toString" in Object.create(null));
// → false
```

```javascript
let ages = new Map();
ages.set("Boris", 39);
console.log(ages.has("toString"));
// → false
```

```javascript
console.log(Object.hasOwn({x: 1}, "toString"));
// → false
```

〔補足〕`Object.create(null)`・`Map`・`Object.hasOwn`の使い分けは、ユーザー入力をキーにするコードの安全性レビューにおける主要チェックポイントである。

## 5. メソッドと `this` — アロー関数の落とし穴

### どう動くのか

JavaScriptではメソッドは、関数値を保持するプロパティにすぎない。関数が`object.method()`の形で呼ばれると、その本体の`this`は自動的に呼び出し対象のオブジェクトを指す。`this`は「通常のパラメータとは異なる方法で渡される追加パラメータ」と考えられ、明示的に与えるには`call`を使う。

```javascript
function speak(line) {
  console.log(`The ${this.type} rabbit says '${line}'`);
}
let whiteRabbit = {type: "white", speak};

whiteRabbit.speak("Oh my fur and whiskers");
// → The white rabbit says 'Oh my fur and whiskers'
speak.call(whiteRabbit, "Hurry");
// → The white rabbit says 'Hurry'
```

### 攻撃者はどこを突くのか（診断上の注意）

決定的なのは次の違いだ。

- **`function`キーワードで定義した通常の関数**は、呼び出し方に依存する独自の`this`を持つので、囲むスコープの`this`を参照**できない**。
- **アロー関数は違う**。自分の`this`をバインドせず、周囲のスコープの`this`を見る。

コールバックの中で`this`が期待通りかどうかは、アロー関数と通常関数のどちらを選んだかに完全に依存する。イベントハンドラやコールバックで`this`が`undefined`になったり別のオブジェクトを指したりするバグは、ここが原因であることが多い。

## 6. クラスとカプセル化 — 隠すための道具

### なぜそうなっているのか — 抽象データ型

オブジェクト指向の主要アイデアは、オブジェクトの**型**をプログラム組織化の単位にすることだ。任意に複雑なコードを、使う人が触るべき限られたメソッドとプロパティだけを露出する形に包む。これを**抽象データ型（abstract data type）**と呼び、電動ミキサーに喩えられる。設計者は材料科学と電気を理解するが、生地を混ぜたい人はノブだけ理解すればよい。

各抽象データ型は**インターフェース（interface）**、すなわち外部が実行できる操作の集合を持つ。それを越える詳細は**カプセル化（encapsulation）**され、型の内部として扱われる。

### どう動くのか — class

`class`は2015年版で導入された。それ以前は、通常の関数を書いてその`prototype`プロパティを操作するのがクラス定義だった。この経緯から、**すべての非アロー関数は空オブジェクトを持つ`prototype`プロパティを持って始まる**。

```javascript
class Rabbit {
  constructor(type) {
    this.type = type;
  }
  speak(line) {
    console.log(`The ${this.type} rabbit says '${line}'`);
  }
}

let killerRabbit = new Rabbit("killer");
```

`new`を付けて呼ぶと、関数の`prototype`プロパティのオブジェクトをプロトタイプに持つ新インスタンスを作り、`this`をそれにバインドして実行し、そのオブジェクトを返す。

### どう守るのか — private プロパティ

名前の前に`#`を付けると、そのメソッドやプロパティは**クラス宣言の内側からしか**アクセスできなくなる。外部からのアクセスはエラーになり、その存在はクラスの外に完全に隠れる。

```javascript
class RandomSource {
  #max;
  constructor(max) {
    this.#max = max;
  }
  getNumber() {
    return Math.floor(Math.random() * this.#max);
  }
}
```

重要な制約として、**privateインスタンスプロパティは宣言が必須**である。通常のプロパティは代入するだけで作れるが、privateプロパティはクラス宣言で`#max;`のように宣言されていないと使えない。これは「隠されるべき状態が、どこにどれだけあるか」をコードから読み取れるという、レビュー上の利点でもある。

### オーバーライドの挙動

オブジェクトにプロパティを追加すると、プロトタイプに同名があっても、そのプロパティは**オブジェクト自身**に追加され、プロトタイプの値を隠す。

```javascript
Rabbit.prototype.teeth = "small";
let killerRabbit = new Rabbit("killer");
killerRabbit.teeth = "long, sharp, and bloody";
console.log(killerRabbit.teeth);
// → long, sharp, and bloody
console.log(Rabbit.prototype.teeth);
// → small
```

## 7. ポリモーフィズム・Symbol・iterator

### ポリモーフィズムとarray-like object

特定のインターフェース（たとえば`toString`メソッド）を持つオブジェクトで動くコードは、そのインターフェースを備えるあらゆるオブジェクトを差し込んで動かせる。これを**ポリモーフィズム（polymorphism, 多態性）**と呼ぶ。

広く使われる例が**array-like object**で、`length`プロパティと番号付きプロパティを持つ。配列でも文字列でもない普通のオブジェクトに、配列メソッドを流用できる。

```javascript
Array.prototype.forEach.call({
  length: 2,
  0: "A",
  1: "B"
}, elt => console.log(elt));
// → A
// → B
```

〔補足〕この「array-likeなら配列メソッドが効く」性質は、ブラウザのDOM APIが返すオブジェクト（NodeListなど）を扱うときに繰り返し出てくる。

### Symbol — 衝突しないプロパティ名

**Symbol（シンボル）**は2015年に追加された。複数のインターフェースが同じ名前のプロパティを別目的で使う衝突を避けるため、**他のいかなるものとも衝突しない一意のプロパティ型**が必要とされた。`Symbol`関数で作られ、**新しく作ったSymbolは一意で、同じものを2回作れない**。

```javascript
let sym = Symbol("name");
console.log(sym == Symbol("name"));
// → false
```

渡す文字列は表示時に認識しやすくするためだけのラベルで、それ以上の意味はない。オブジェクトにSymbolプロパティを含めるには角括弧で囲む。

### iterator インターフェース

`for`/`of`に渡すオブジェクトは**iterable（反復可能）**であることが期待される。つまり`Symbol.iterator`で名付けられたメソッドを持ち、それが**iterator**を返す。iteratorは`next`メソッドを持ち、呼ばれるたびに`value`（次の値）と`done`（終わりかどうか）を持つオブジェクトを返す。

```javascript
let okIterator = "OK"[Symbol.iterator]();
console.log(okIterator.next());
// → {value: "O", done: false}
console.log(okIterator.next());
// → {value: "K", done: false}
console.log(okIterator.next());
// → {value: undefined, done: true}
```

**`next`・`value`・`done`は素の文字列**であり、シンボルではない。実際のシンボルは`Symbol.iterator`だけで、これは多くのオブジェクトに追加されうるので衝突回避が必要だからだ。

### 継承への警告

著者は継承（`extends`）について、設計レビューで引用価値の高い評価を与えている。カプセル化とポリモーフィズムはコードを互いから分離して絡み合いを減らすが、**継承は根本的にクラスを結び付け、より多くの絡み合いを作る**。継承は「最初に手を伸ばすべき道具ではなく、クラス階層を作る機会を積極的に探すべきでもない」。絡み合いの多いコードほど、変更が予期しない箇所を壊し、脆弱性が潜みやすい。

## 8. バグの分類と strict mode — 言語に文句を言わせる

### なぜそうなっているのか — 2種類のバグ

バグは大きく2種類に分けられる。

1. **思考そのものが混乱していたことによるもの**（診断・修正が難しい）
2. **思考をコードに変換する過程で入り込んだミス**

JavaScriptの緩さは2番目を悪化させる。バインディングとプロパティの概念が曖昧で、実行するまでタイポを捕まえられない。しかも無意味な計算は`NaN`や`undefined`を静かに生み、**エラーを一切起こさず、プログラムの出力だけを間違ったものにすることがある**。この静かな失敗こそ、源を見つけるのが最も難しい。

### どう守るのか — strict mode

ファイルまたは関数本体の先頭に`"use strict"`を置くと有効化される。**クラスとモジュールの中は自動的にstrict**である。strict modeは次のように「言語に文句を言わせる」。

```javascript
function canYouSpotTheProblem() {
  "use strict";
  for (counter = 0; counter < 10; counter++) {
    console.log("Happy happy");
  }
}

canYouSpotTheProblem();
// → ReferenceError: counter is not defined
```

`let`を付け忘れると、非strictでは静かにグローバルバインディングが作られる。strictではエラーになる。**ただし、そのバインディングがスコープのどこかに既に存在する場合は働かず、ループは静かに値を上書きする**という限界がある。

もう一つの重要な変更は、**メソッドとして呼ばれていない関数では`this`が`undefined`になる**ことだ。非strictでは`this`はグローバルオブジェクトを指すので、`new`を付け忘れたコンストラクタが静かにグローバルを汚染する。

```javascript
"use strict";
function Person(name) { this.name = name; }
let ferdinand = Person("Ferdinand"); // forgot new
// → TypeError: Cannot set property 'name' of undefined
```

strict modeはさらに、**同名の複数パラメータを禁止**し、`with`文（「so wrong」で本書ではこれ以上議論しないとされる）を削除する。

### 型と TypeScript

型が既知なら、コンピュータが実行前にミスを指摘できる。型を追加してチェックするJavaScriptの方言で最も人気なのが**TypeScript**（https://www.typescriptlang.org/）で、著者は「厳格さを追加したいなら試すことを推奨する」と述べる。ただし本書は「生の、危険な、型なしのJavaScriptコード」を使い続ける。診断者にとっては、型がないコードほど「静かに壊れる」余地が広い、と読める。

## 9. 例外と finally — 静かな失敗を止める

### なぜそうなっているのか — 特別な戻り値の限界

外界と通信するプログラムは、不正入力・過負荷・ネットワーク断に遭う。エラーを`null`・`undefined`・`-1`のような特別な値で示す方法は、エラーが一般的で呼び出し側が明示的に考慮すべき場面では良い。だが2つの欠点がある。

1. **関数がすでにあらゆる値を返しうる場合**、成功と失敗を区別するため結果をオブジェクトでラップする必要がある。
2. **不器用なコードにつながる**。`null`チェックが呼び出し側の連鎖にわたって伝播する。

### どう動くのか — 例外とスタックのアンワインド

例外（exception）は、問題に遭遇したコードが値を**throw（raise）**する機構である。例外は現在の関数とその呼び出し側から一気に飛び出し、最初の呼び出しまで下る。これを**スタックのアンワインド（unwinding the stack）**と呼ぶ。途中に`try`/`catch`という「障害物」を置くと、そこで捕まえられる。

```javascript
function promptDirection(question) {
  let result = prompt(question);
  if (result.toLowerCase() == "left") return "L";
  if (result.toLowerCase() == "right") return "R";
  throw new Error("Invalid direction: " + result);
}

try {
  console.log("You see", look());
} catch (error) {
  console.log("Something went wrong: " + error);
}
```

`Error`インスタンスは、作られた時点の呼び出しスタック情報（stack trace）を`stack`プロパティに収集する。最大の利点は、**エラー処理コードはエラーが起きる箇所と処理される箇所にだけ必要**で、間の関数は忘れてよいことだ。

### 攻撃者はどこを突くのか — 例外による副作用の中断

例外はもう一種類の制御フローを生む。ほぼすべての関数呼び出しとプロパティアクセスが例外を起こしうるので、複数の副作用のうち一部だけが実行されて止まることがある。次の銀行コードは、**まず**口座から金を引き、**それから**`getAccount`を呼ぶ。ここで例外が起きると、金が消える。

```javascript
function transfer(from, amount) {
  if (accounts[from] < amount) return;
  accounts[from] -= amount;
  accounts[getAccount()] += amount;
}
```

これは「途中で止まると不整合な状態が残る」問題で、レビューでは常に「この操作は途中で例外が飛んだら何が壊れるか」を問うべきだ。

### どう守るのか — finally

`try`文には`finally`ブロックを続けられる。これは「**何が起きようとも**、`try`ブロックを実行しようとした後にこのコードを実行する」ことを保証する。例外が飛んでも`finally`は実行され、しかも**例外に干渉せず、実行後にアンワインドが続く**。

```javascript
function transfer(from, amount) {
  if (accounts[from] < amount) return;
  let progress = 0;
  try {
    accounts[from] -= amount;
    progress = 1;
    accounts[getAccount()] += amount;
    progress = 2;
  } finally {
    if (progress == 1) {
      accounts[from] += amount;
    }
  }
}
```

`progress`で「どこまで進んだか」を記録し、中途半端な状態を巻き戻す。副作用を減らす（既存データを変更せず新しい値を計算する）スタイルも、途中で止まっても既存データが壊れないので回復しやすい。

## 10. 選択的catch — 「全部キャッチ」がバグを埋葬する

### 攻撃者はどこを突くのか — 包括catchの罠

未処理の例外の扱いは環境で異なる。**ブラウザではJavaScriptコンソールにエラーが書かれ、Node.jsはデータ破損に慎重で、未処理例存があるとプロセス全体を中断する。** 通常の使用で起きうる問題を、未処理例外でクラッシュさせるのはひどい戦略だ。

ここでJavaScriptの「かなり露骨な欠落」が問題になる。**JavaScriptは例外を選択的にキャッチする直接のサポートを持たない。すべてキャッチするか、まったくキャッチしないかのどちらか**である。これは「得た例外が、`catch`を書いたとき想定したものだ」と仮定したくなる誘惑を生む。

次のコードは、`promtDirection`というタイポにより"undefined variable"エラーが起きる。だが`catch`は例外値を無視して「不正な入力」と決めつけるので、**無限ループを引き起こし、しかもタイポの有用なエラーメッセージを「埋葬」する**。

```javascript
for (;;) {
  try {
    let dir = promtDirection("Where?"); // ← typo!
    console.log("You chose ", dir);
    break;
  } catch (e) {
    console.log("Not a valid direction. Try again.");
  }
}
```

### どう守るのか — 新しいエラー型を instanceof で識別する

一般ルールはこうだ。**例外を「どこかにルーティングする」目的以外では、包括的にキャッチするな。そしてその場合も、何の情報を隠しているかを注意深く考えよ。**

`message`プロパティを文字列比較で判定するのは**不安定**である。人間向けのメッセージをプログラムの判断に使うと、誰かがメッセージを変更・翻訳した途端に壊れる。正しい方法は、**新しいエラー型を`Error`から派生させ、`instanceof`で識別する**ことだ。

```javascript
class InputError extends Error {}

function promptDirection(question) {
  let result = prompt(question);
  if (result.toLowerCase() == "left") return "L";
  if (result.toLowerCase() == "right") return "R";
  throw new InputError("Invalid direction: " + result);
}
```

```javascript
for (;;) {
  try {
    let dir = promptDirection("Where?");
    console.log("You chose ", dir);
    break;
  } catch (e) {
    if (e instanceof InputError) {
      console.log("Not a valid direction. Try again.");
    } else {
      throw e;
    }
  }
}
```

`InputError`でなければ再throwする。これで、想定内の入力エラーだけを扱い、タイポやバグは埋もれずに表に出る。

### アサーション — わざと大声で壊す

**アサーション（assertion）**は、何かが想定通りかを検証するチェックで、通常操作のためではなく**プログラマのミスを見つけるため**に使う。静かに`undefined`を返すのではなく、誤用された途端にプログラムを爆発させる。

```javascript
function firstElement(array) {
  if (array.length == 0) {
    throw new Error("firstElement called with []");
  }
  return array[0];
}
```

ただし著者は「あらゆる悪い入力にアサーションを書くのは推奨しない。大変で騒がしいコードになる。しやすいミスのために予約せよ」と釘を刺す。

## 手を動かす

1. Eloquent JavaScriptのオンライン版（https://eloquentjavascript.net/）を開き、第5章のサンドボックス（https://eloquentjavascript.net/code#5 ）に移動する。ページに`SCRIPTS`が読み込まれた状態でコードを実行できる。
2. コンソールに`"🐴👟".length`と打ち、`4`が返ることを確認する。続けて`[..."🐴👟"].length`と打ち、`2`が返ることを確認する。`length`が「文字数」ではないことを自分の目で確かめる。
3. `let o = {}; console.log("toString" in o);`を実行し`true`を確認したら、`let m = Object.create(null); console.log("toString" in m);`を実行し`false`を確認する。プロトタイプの有無で結果が変わることを体験する。
4. 関数の先頭に`"use strict";`を書いた版と書かない版を作り、`let`なしの代入や`new`なしのコンストラクタ呼び出しでエラーの有無がどう変わるかを比べる。
5. `class InputError extends Error {}`を定義し、`throw new InputError("x")`した例外を`try`/`catch`で受け、`e instanceof InputError`で分岐するコードを書いて動かす。わざとタイポを混ぜ、包括catchだとエラーが埋もれ、選択的catchだと表に出ることを確認する。
6. 上記の`transfer`（`finally`版）を写経し、`getAccount`が例外を投げる状況を作って、`progress`による巻き戻しが効くことを確認する。

## つまずきポイント

- **`length`を文字数だと思い込む。** UTF-16のcode unit数であり、絵文字やまれな漢字では見た目の文字数とずれる。長さバリデーションの盲点になる。
- **範囲の境界（inclusive / noninclusive）を取り違える。** `ranges`の下限は含み、上限は含まない。境界1つの取り違えがオフバイワンやチェックのすり抜けを生む。
- **`"toString" in obj`が`true`なのを「登録されている」と誤読する。** プロトタイプ連鎖が見えているだけ。マップには`Map`か`Object.create(null)`か`Object.hasOwn`を使う。
- **アロー関数と通常関数で`this`が違うことを忘れる。** 通常関数は独自の`this`を持ち、アロー関数は周囲の`this`を見る。コールバックの`this`バグの大半はここ。
- **`catch (e) {}`で全部キャッチして満足する。** 想定外の例外（タイポ・バグ）まで飲み込み、無限ループや情報の埋葬を招く。`instanceof`で選別し、違えば再throwする。
- **エラー判定を`message`の文字列比較でやる。** メッセージの変更・翻訳で壊れる。エラー型で判定する。
- **Eloquent JavaScriptにXSS/CSRF/CORS/CSPが載っていると期待する。** 載っていない。この本は言語とブラウザの土台を教える本で、攻撃名はOWASP・PortSwigger・MDNなどから学ぶ。

## この節のまとめ

- JavaScriptは1995年にNetscapeで生まれ、標準はECMAScript。`class`・`Symbol`は2015年（version 6）で導入された。後方互換性への執着が仕様の奇妙さの背景にある。
- 著者はJavaScriptを「ばかばかしいほど寛容」と評する。無意味な計算が静かに`NaN`や`undefined`を生み、間違った出力を作り続ける。これが診断の最大の敵である。
- 高階関数（filter/map/reduce/some/find）は「隙間のある計算」を抽象化し、問題に合った語彙でコードを書くことで複雑さそのものを減らす。
- 文字列はUTF-16のcode unit列で、`length`と角括弧はcode unitしか扱わない。絵文字は2ユニットなので`"🐴👟".length`は`4`。長さバリデーションと文字列切り詰めの盲点になる。
- `ranges`の境界は下限inclusive・上限noninclusive。境界の含む・含まないの取り違えは範囲チェックのすり抜けを生む。
- プロトタイプ連鎖は要求されたプロパティを連鎖の終端（`null`）まで探す。この性質が、素のオブジェクトをマップに使う「危険」と、prototype pollutionの前提になる（攻撃名は本書にない）。
- マップの安全なパターンは`Object.create(null)`・`Map`・`Object.hasOwn`の3つ。
- 通常関数は独自の`this`を持ち、アロー関数は周囲の`this`を見る。コールバックの`this`バグの原因になる。
- `class`は抽象データ型を作る道具で、`#`でprivateにできる。privateプロパティは宣言必須。継承は絡み合いを増やすので安易に使わない。
- Symbolは一意で衝突しないプロパティ名。iteratorは`next`/`value`/`done`で反復を提供し、`for`/`of`と`...`が使う。
- strict mode（`"use strict"`、クラス・モジュールでは自動）は`let`忘れや`new`忘れをエラーにし、`this`を`undefined`にして静かなグローバル汚染を防ぐ。
- 特別な戻り値によるエラー通知は不器用になりやすい。例外はスタックをアンワインドし、エラー処理を起きる箇所と処理する箇所に局所化する。
- `finally`は何が起きても実行され、例外に干渉しない。途中で止まる副作用の巻き戻しに使う。
- JavaScriptは選択的catchを直接サポートしない。全部キャッチは想定外の例外を埋葬する。新しいエラー型を`instanceof`で選別し、違えば再throwするのが正しい。
- アサーションはプログラマのミスを大声で暴くためのもので、静かな`undefined`より安全。ただし濫用しない。

## 理解度チェック

1. Eloquent JavaScriptに「XSS」「CSRF」「Same-Origin Policy」という語は登場するか。
   ▶ 答え: いずれも一度も登場しない。この本は攻撃名ではなく、言語とブラウザの土台を教える本である。攻撃の具体論はOWASPやPortSwigger、MDNなど別資料から学ぶ。

2. `"🐴👟".length`はいくつを返すか。またその理由は。
   ▶ 答え: `4`。文字列はUTF-16のcode unit列で、`length`はcode unit数を返す。絵文字は多くが2ユニット（サロゲートペア）なので、2文字でも4になる。文字単位で数えるなら`[...str]`や`for`/`of`を使う。

3. 素のオブジェクト`{}`で`"toString" in obj`が`true`になるのはなぜか。安全にマップを作る方法を3つ挙げよ。
   ▶ 答え: `{}`は`Object.prototype`から派生し、`in`はプロトタイプ連鎖まで探すため。安全な方法は`Object.create(null)`でプロトタイプなしのオブジェクトを作る、`Map`クラスを使う、`in`の代わりに`Object.hasOwn`を使う、の3つ。

4. `ranges`の範囲`[994, 1008]`について、下限と上限はそれぞれ含むか含まないか。
   ▶ 答え: 下限994はinclusive（含む、コード994はコプト文字）、上限1008はnoninclusive（含まない、1008は別の文字）。この非対称の取り違えがオフバイワンや境界チェックのすり抜けを生む。

5. 通常の`function`とアロー関数で、`this`の扱いはどう違うか。
   ▶ 答え: 通常関数は呼び出し方に依存する独自の`this`を持ち、囲むスコープの`this`を参照できない。アロー関数は自分の`this`をバインドせず、周囲のスコープの`this`を見る。コールバック内の`this`が期待通りかは、この選択に依存する。

6. strict modeを有効にすると、`new`を付け忘れたコンストラクタ呼び出しはどうなるか。非strictとの違いは。
   ▶ 答え: strictでは`this`が`undefined`になり、`this.name = ...`が`TypeError`になる。非strictでは`this`がグローバルオブジェクトを指し、静かにグローバルバインディング（例: `name`）を作って汚染する。

7. 次の`catch`のどこが危険か。`for(;;){ try { let d = promtDirection("Where?"); break; } catch(e){ console.log("retry"); } }`
   ▶ 答え: `promtDirection`はタイポで、実際は"undefined variable"エラーが起きる。だが`catch`が例外値を無視して入力エラーと決めつけるため、無限ループになり、タイポの有用なエラーメッセージを埋葬する。`instanceof`で想定した例外型だけを扱い、違えば再throwすべき。

8. `finally`ブロックは、`try`内で例外が投げられたとき実行されるか。実行後どうなるか。
   ▶ 答え: 実行される。しかも例外に干渉せず、`finally`実行後にスタックのアンワインドが続く。途中で止まった副作用の巻き戻しに使える。

9. アサーションは通常の入力エラー処理のために書くべきか。
   ▶ 答え: いいえ。アサーションは通常操作で起きうる状況ではなく、プログラマのミスを見つけるために使う。あらゆる悪い入力に書くのは非推奨で、しやすいミスのために予約する。

10. `#`を付けたプロパティを使うために必要なことは何か。
    ▶ 答え: クラス宣言での宣言が必須。通常のプロパティは代入だけで作れるが、privateプロパティ（`#max`など）はクラス内で宣言されていないと利用できない。

## 出典

- https://eloquentjavascript.net/ （原典サイトは執筆環境から取得不可。以下の著者公式リポジトリ原稿を根拠とした）
- https://github.com/marijnh/Eloquent-JavaScript （著者公式ソースリポジトリ、master ブランチ）
- https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/README.md
- https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/00_intro.md
- https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/05_higher_order.md
- https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/06_object.md
- https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/08_error.md
- https://www.typescriptlang.org/ （本書が推奨する型付きJavaScriptの方言）

<!-- sources: https://eloquentjavascript.net/, https://github.com/marijnh/Eloquent-JavaScript, https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/00_intro.md, https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/05_higher_order.md, https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/06_object.md, https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/08_error.md, https://www.typescriptlang.org/ -->
<!-- terms: ECMAScript, 高階関数, code unit, UTF-16, サロゲートペア, プロトタイプ, prototype pollution, Object.create(null), Object.hasOwn, Map, this, アロー関数, 抽象データ型, カプセル化, private プロパティ, Symbol, iterator, ポリモーフィズム, strict mode, TypeScript, 例外, スタックのアンワインド, finally, 選択的catch, instanceof, アサーション -->
<!-- self-read: https://eloquentjavascript.net/ | サイト側の制限（エージェントプロキシの組織ポリシーで遮断、curlも403）。原稿は著者公式リポジトリから取得済みだが、サイトのページ体裁とサンドボックスは自分で開く必要がある -->
