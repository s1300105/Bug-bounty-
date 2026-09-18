# [18] Eloquent JavaScript 第4版（Marijn Haverbeke）全章詳細ノート

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://eloquentjavascript.net/ | partial | WebFetch → **EGRESS_BLOCKED** / curl → **CONNECT tunnel failed, response 403** | サイト本体はエージェントプロキシの組織ポリシーで遮断。よって「サイトのindexページのHTML（紙版リンク・翻訳一覧・コードサンドボックスへのリンク等）」は取得できていない。本文は下記の著者公式ソースリポジトリから**完全取得**した |
| https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/README.md | full | curl | リポジトリREADME。「These are the sources used to build the fourth edition of Eloquent JavaScript (https://eloquentjavascript.net).」＝**本サイトの原稿そのもの**であることを明記 |
| https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/{00_intro … 21_skillsharing}.md | full | curl（22ファイル、計 16,760行 / 約 900KB） | 全22章のMarkdown原稿を逐語で取得。HTMLスクレイピングより忠実（コード例・表・脚注マークアップがそのまま入っている） |

**重要**：原稿は著者自身の公式リポジトリ（marijnh/Eloquent-JavaScript, master ブランチ）であり、二次情報ではなく**原典**である。ただし「eloquentjavascript.net のページとして」は読めていないので、状態は保守的に partial とした。

取得できた全ファイルと行数（実測）:

| ファイル | 行数 | 章タイトル |
|---|---|---|
| 00_intro.md | 277 | Introduction |
| 01_values.md | 452 | Values, Types, and Operators |
| 02_program_structure.md | 754 | Program Structure |
| 03_functions.md | 762 | Functions |
| 04_data.md | 1190 | Data Structures: Objects and Arrays |
| 05_higher_order.md | 670 | Higher-Order Functions |
| 06_object.md | 914 | The Secret Life of Objects |
| 07_robot.md | 491 | Project: A Robot |
| 08_error.md | 647 | Bugs and Errors |
| 09_regexp.md | 1005 | Regular Expressions |
| 10_modules.md | 487 | Modules |
| 11_async.md | 856 | Asynchronous Programming |
| 12_language.md | 654 | Project: A Programming Language |
| 13_browser.md | 266 | JavaScript and the Browser |
| 14_dom.md | 840 | The Document Object Model |
| 15_event.md | 793 | Handling Events |
| 16_game.md | 1054 | Project: A Platform Game |
| 17_canvas.md | 1091 | Drawing on Canvas |
| 18_http.md | 975 | HTTP and Forms |
| 19_paint.md | 1012 | Project: A Pixel Art Editor |
| 20_node.md | 755 | Node.js |
| 21_skillsharing.md | 815 | Project: Skill-Sharing Website |

---

## ⚠️ 教科書執筆者への最重要注意（捏造防止）

担当指示には「"Security and HTTP"節（sandbox/XSS/CSRFの説明）」とあったが、**実際の本には次の事実がある**。全22章のMarkdown全文に対して正規表現で検索して確認した結果：

- **`Security and HTTP` という節は存在しない。** 正しい節名は第18章の **`## Security and HTTPS`**（HTTPS の S 付き）である。
- **`XSS` / `Cross-Site Scripting` という語は本書に1回も出てこない。**
- **`CSRF` / `Cross-Site Request Forgery` という語も1回も出てこない。**
- **`same-origin` / `Same-Origin Policy` / `CORS` / `clickjacking` / `Content Security Policy` という語も1回も出てこない。**
- 出てくるのは索引語としての `"cross-domain request"` と、レスポンスヘッダ **`Access-Control-Allow-Origin: *`** の1行だけ。

つまり Eloquent JavaScript は**「攻撃名を教える本」ではなく「ブラウザのサンドボックスという設計思想と、その上で動くDOM/イベント/HTTP APIを正確に教える本」**である。教科書では、本書を「クライアントサイド脆弱性の前提となる言語・DOM・HTTPの土台」として位置づけ、**XSS/CSRF/CORS/CSPの具体論は本書からは引用できない**（他資料＝OWASP、PortSwigger、MDN等から引く）ことを明記すべき。

ただし本書は **CSRF の概念そのものは名前を付けずに説明している**（第18章 HTTP sandboxing の themafia.org → mybank.com の送金例）。この「名前のない説明」は教科書の導入として極めて良質なので、下記の逐語引用を活用してよい。

---

## 要約（3〜10行）

- Eloquent JavaScript 第4版は全22章。第1〜12章が言語本体、第13〜19章がブラウザ、第20〜21章が Node.js。うち5章がプロジェクト章（Robot / Egg言語 / Platform Game / Pixel Art Editor / Skill-Sharing Website）。ライセンスは非商用の派生を許す形（翻訳歓迎と README に明記）。
- 言語側で診断作業に直結するのは、第5章 Higher-Order Functions（filter/map/reduce/some/find、UTF-16のcode unit問題）、第6章 The Secret Life of Objects（prototype 連鎖、`Object.create(null)`、`Object.hasOwn`、Symbol、iterator、private `#` プロパティ）、第8章 Bugs and Errors（strict mode、例外、`finally`、選択的catch）、第9章 Regular Expressions（バックトラック爆発＝ReDoS の原理、greedy/non-greedy、`lastIndex` の副作用、動的RegExp生成時のメタ文字エスケープ）、第10章 Modules（ESM/CommonJS、`Function` コンストラクタの危険性、bundler/minifier）、第11章 Asynchronous Programming（Promise、async/await、event loop、非同期ギャップによるバグ）。
- ブラウザ側は第13章「In the sandbox」でサンドボックスの思想と「時々誰かが回避方法を見つけ、ブラウザ開発者が穴を塞ぐ」というループを明示。第14章 DOM（ツリー、live NodeList、`querySelectorAll` は非live、layout thrashing）、第15章 Handling Events（伝播、`stopPropagation`、`preventDefault`、`event.target` によるイベント委譲、Web Worker、`postMessage`、debounce）。
- 第18章 HTTP and Forms が最もセキュリティに近い。`## HTTP sandboxing` でクロスドメイン禁止の理由を「themafia.org のスクリプトが、私のブラウザの識別情報を使って mybank.com に送金指示を出せてはならない」と説明（＝CSRF の本質）、緩和手段として `Access-Control-Allow-Origin: *` を提示。`## Security and HTTPS` は中間者攻撃・証明書・盗聴改竄防止を説明し「偽造/盗難証明書や壊れたソフトのせいで HTTPS が破られた事例が複数ある」と注意。さらに `localStorage` のドメイン単位分離、file field を「gatekeeper」と位置づける設計、`Function` コンストラクタの注入リスクを扱う。
- 第20章 Node.js の file server には**パストラバーサル対策の実装が逐語で載っている**（`resolve` + `startsWith(baseDirectory + sep)` で基準ディレクトリ配下を検証し 403 を投げる）。第21章は「このプロトコルはアクセス制御を一切していない」と自ら明言。

---

## 詳細ノート

### 第0章 Introduction / What is JavaScript?（出典: 00_intro.md）

- JavaScript は **1995年**、Netscape Navigator でウェブページにプログラムを載せる手段として導入された。以後すべての主要グラフィカルブラウザが採用。ページリロードなしに操作できる「モダンWebアプリケーション」を可能にした。
- **Java とはほぼ無関係**。名前が似ているのは「良識よりマーケティング上の考慮」による。Java が強く売り込まれ人気を得ていた時期に、その成功に便乗しようとした結果で、「今もその名前に縛られている」。
- Netscape 外に採用が広がった後、実装間で同じ言語を提供していることを保証するため標準文書が書かれた。標準化を行った Ecma International にちなみ **ECMAScript 標準**と呼ばれる。実務上 ECMAScript と JavaScript は交換可能な同じ言語の2つの名前。
- バージョン史（原文の記述そのまま）：**ECMAScript 3** が 2000〜2010 年頃の支配的な広くサポートされたバージョン。この間、急進的な改良を計画した野心的な **version 4** が進行していたが、生きて広く使われている言語をそこまで急進的に変えるのは政治的に困難と判明し、**2008年に version 4 の作業は放棄**された。ずっと野心を抑え、論争のない改良だけを入れた **version 5 が2009年**に登場。**2015年に version 6** が登場し、version 4 で計画されていたアイデアの一部を含む大型更新となった。以後は毎年小さな更新がある。**本書は2024年版のJavaScriptを使用**。
- 言語設計者は既存プログラムを壊しうる変更を避けるよう注意しているので、新しいブラウザは古いプログラムも動かせる。
- JavaScript はブラウザ専用ではない。**MongoDB、CouchDB** などのデータベースがスクリプト／クエリ言語として使い、デスクトップ・サーバ向けプラットフォーム（最も有名なのが **Node.js**）がブラウザ外の実行環境を提供する。
- 著者の JavaScript 評（脆弱性ハンティングの文脈でも本質的）：「JavaScript は許容範囲がばかばかしいほど寛容（ridiculously liberal in what it allows）。この設計の背後にある考えは初心者に易しくすることだったが、実際にはシステムが問題を指摘してくれないため、プログラムの問題を見つけるのを難しくしているだけ。」
- 本の構成（原文）：最初の12章が JavaScript 言語、次の7章がウェブブラウザとそのプログラミング、最後の2章が Node.js。**5つのプロジェクト章**が大きめの例題プログラムを扱う。
  - 言語パート：最初の4章が基本構造（control structures / functions / data structures）。続く第5・6章が「より抽象的なコードを書き複雑さを抑える技術」。最初のプロジェクト章（crude delivery robot）の後、error handling and bug fixing → regular expressions（テキスト処理の重要ツール）→ modularity（複雑さに対するもう一つの防御）→ asynchronous programming（時間のかかるイベントの扱い）。2番目のプロジェクト章（プログラミング言語の実装）で第1部が終わる。
  - 第2部（第13〜19章）はブラウザ JavaScript が使えるツール群。画面への表示（第14・17章）、ユーザー入力への応答（第15章）、ネットワーク通信（第18章）。プロジェクト章は platform game と pixel paint program。
  - 第20章が Node.js、第21章がそれを使った小さなウェブサイト。
  - `{{if commercial ... if}}` ブロックに「最後に第?章が JavaScript プログラムを速度最適化する際の考慮点を述べる」という記述があり（商用版＝紙／有料版のみに現れる `fast` 章）、**オンライン無料版には存在しない章**がある点に注意。
- コードの実行について：多くの例は単独で動くが、後半の章は特定環境（ブラウザまたは Node.js）向けで、そこでしか動かない。また多くの章はより大きなプログラムを定義し、コード片が相互依存または外部ファイルに依存する。サイトの **sandbox**（https://eloquentjavascript.net/code）が章ごとに必要な全スクリプトとデータファイルを含む ZIP へのリンクを提供する。

#### コード/コマンド（原文のまま逐語）

README のビルド手順：

```
npm install
make html
```

```
apt-get install texlive texlive-xetex fonts-inconsolata fonts-symbola texlive-lang-chinese inkscape
make book.pdf
```

---

### 第5章 Higher-Order Functions（出典: 05_higher_order.md）

章頭引用は C.A.R. Hoare, "1980 ACM Turing Award Lecture"：「There are two ways of constructing a software design: One way is to make it so simple that there are obviously no deficiencies, and the other way is to make it so complicated that there are no obvious deficiencies.」

#### 抽象化とプログラムサイズ

- 「大きなプログラムは高コストなプログラム」であり、単に構築時間のためだけではない。サイズはほぼ常に**複雑さ**を伴い、複雑さはプログラマを混乱させる。混乱したプログラマはバグを入れる。大きなプログラムはそのバグが隠れる場所をたくさん提供するので、発見が難しくなる。
- 6行の自己完結プログラムと、外部2関数に依存する1行のプログラムを比較。`sum` と `range` の定義を数えれば2番目のほうが大きいのに、著者は2番目のほうが正しい可能性が高いと主張する。理由は**解かれている問題に対応する語彙で解が表現されている**から。「数の範囲を合計する」ことはループやカウンタの話ではなく、範囲と合計の話である。
- プログラミングでは必要な語がすべて辞書で待っているとは期待できない。だから第1のレシピ（低レベルな手順の羅列）のパターンに陥りやすい。**「抽象度が低すぎるレベルで作業していると気づくのは、プログラミングにおける有用なスキルである」**。

#### 高階関数の定義と形

- 他の関数を引数に取るか返すかして、関数に対して操作する関数を**高階関数**と呼ぶ。用語は数学（関数と他の値の区別をより真剣に扱う分野）に由来する。
- 高階関数は値だけでなく**アクションに対する抽象化**を可能にする。形はいくつかある：新しい関数を作る関数、他の関数を変える関数、新しい種類の**制御フロー**を提供する関数。

#### SCRIPTS データセット（数値を落とさない）

- Unicode 標準には **140 の異なる script（表記体系）**が含まれ、そのうち **81 が今日でも使用中、59 が歴史的**なもの。
- 例のデータセットは Unicode で定義された 140 の script についての情報を含み、章のコーディングサンドボックス（https://eloquentjavascript.net/code#5）で `SCRIPTS` バインディングとして利用可能。
- `ranges` プロパティは Unicode 文字範囲の配列で、各要素は下限と上限の2要素配列。**下限は inclusive（コード994はコプト文字）、上限は noninclusive（1008は違う）**。
- `direction` は `"ltr"`（左から右）、`"rtl"`（右から左＝アラビア語・ヘブライ語）、`"ttb"`（上から下＝モンゴル文字）。
- **Han script は Unicode 標準で 89,000 文字超**が割り当てられ、データセット中で圧倒的に最大の表記体系。Han は中国語・日本語・韓国語のテキストに使われることがある script。これら言語は多くの文字を共有するが書き方が異なる傾向がある。（米国拠点の）Unicode Consortium は文字コードを節約するため単一の表記体系として扱うことを決めた。これを **Han unification** と呼び、今でも一部の人々を非常に怒らせている。
- 生存 script の平均起源年は **1165年**、死滅 script は **204年**（`Math.round` 後の値）。

#### UTF-16 と code unit（診断で極めて重要）

- JavaScript の文字列は **16ビット数の列**としてエンコードされる。これを **code unit** と呼ぶ。Unicode 文字コードは当初この1ユニットに収まる想定だった（65,000文字強）。足りないと判明したとき、多くの人が1文字あたりのメモリ増加に難色を示した。その懸念に対処するため、JavaScript 文字列でも使われる **UTF-16** が発明された。ほとんどの一般的な文字を単一の16ビット code unit で記述し、それ以外は2ユニットのペアを使う。
- 原文の評価：「**UTF-16 is generally considered a bad idea today. It seems almost intentionally designed to invite mistakes.**」code unit と文字が同じものであるかのように書くプログラムを作るのは簡単で、自分の言語が2ユニット文字を使わなければ問題なく動いているように見える。しかし誰かがあまり一般的でない漢字で使おうとした途端に壊れる。幸い emoji の登場で誰もが2ユニット文字を使い始め、こうした問題に対処する負担がより公平に分配された。
- `length` プロパティと角括弧アクセスは **code unit しか扱わない**。
- `charCodeAt` は code unit を返し、後から追加された `codePointAt` は完全な Unicode 文字を返す。ただし `codePointAt` に渡す引数は依然として code unit 列へのインデックスである。文字列の全文字を走るには、文字が1ユニットか2ユニットかという問題を扱う必要がある。
- `for`/`of` ループは UTF-16 の問題が強く意識されていた時期に導入されたので、文字列に対して使うと **code unit ではなく実際の文字**を返す。
- 〔補足（一般知識）〕この code unit / 文字の乖離は、長さ制限バリデーションのバイパスや、サロゲートペアを分断する文字列切り詰めによる出力の破壊（および後続のパーサ差異）の原理になる。ただし本書はこの応用には言及していない。

#### コード/コマンド（原文のまま逐語）

`repeat` と高階関数の基本：

```
for (let i = 0; i < 10; i++) {
  console.log(i);
}
```

```
function repeatLog(n) {
  for (let i = 0; i < n; i++) {
    console.log(i);
  }
}
```

```
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

```
let labels = [];
repeat(5, i => {
  labels.push(`Unit ${i + 1}`);
});
console.log(labels);
// → ["Unit 1", "Unit 2", "Unit 3", "Unit 4", "Unit 5"]
```

関数を作る関数・関数を変える関数・新しい制御フロー：

```
function greaterThan(n) {
  return m => m > n;
}
let greaterThan10 = greaterThan(10);
console.log(greaterThan10(11));
// → true
```

```
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

```
function unless(test, then) {
  if (!test) then();
}

repeat(3, n => {
  unless(n % 2 == 1, () => {
    console.log(n, "is even");
  });
});
// → 0 is even
// → 2 is even
```

```
["A", "B"].forEach(l => console.log(l));
// → A
// → B
```

SCRIPTS データセットの1要素（原文 lang: "json"）：

```
{
  name: "Coptic",
  ranges: [[994, 1008], [11392, 11508], [11513, 11520]],
  direction: "ltr",
  year: -200,
  living: false,
  link: "https://en.wikipedia.org/wiki/Coptic_alphabet"
}
```

filter / map / reduce の自前実装と標準メソッド：

```
function filter(array, test) {
  let passed = [];
  for (let element of array) {
    if (test(element)) {
      passed.push(element);
    }
  }
  return passed;
}

console.log(filter(SCRIPTS, script => script.living));
// → [{name: "Adlam", …}, …]
```

```
console.log(SCRIPTS.filter(s => s.direction == "ttb"));
// → [{name: "Mongolian", …}, …]
```

```
function map(array, transform) {
  let mapped = [];
  for (let element of array) {
    mapped.push(transform(element));
  }
  return mapped;
}

let rtlScripts = SCRIPTS.filter(s => s.direction == "rtl");
console.log(map(rtlScripts, s => s.name));
// → ["Adlam", "Arabic", "Imperial Aramaic", …]
```

```
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

```
console.log([1, 2, 3, 4].reduce((a, b) => a + b));
// → 10
```

```
function characterCount(script) {
  return script.ranges.reduce((count, [from, to]) => {
    return count + (to - from);
  }, 0);
}

console.log(SCRIPTS.reduce((a, b) => {
  return characterCount(a) < characterCount(b) ? b : a;
}));
// → {name: "Han", …}
```

合成（パイプライン）と等価なループ：

```
function average(array) {
  return array.reduce((a, b) => a + b) / array.length;
}

console.log(Math.round(average(
  SCRIPTS.filter(s => s.living).map(s => s.year))));
// → 1165
console.log(Math.round(average(
  SCRIPTS.filter(s => !s.living).map(s => s.year))));
// → 204
```

```
let total = 0, count = 0;
for (let script of SCRIPTS) {
  if (script.living) {
    total += script.year;
    count += 1;
  }
}
console.log(Math.round(total / count));
// → 1165
```

`some` と文字コード：

```
function characterScript(code) {
  for (let script of SCRIPTS) {
    if (script.ranges.some(([from, to]) => {
      return code >= from && code < to;
    })) {
      return script;
    }
  }
  return null;
}

console.log(characterScript(121));
// → {name: "Latin", …}
```

UTF-16 の挙動（逐語・コメント含む）：

```
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

```
let roseDragon = "🌹🐉";
for (let char of roseDragon) {
  console.log(char);
}
// → 🌹
// → 🐉
```

`countBy` / `find` / `textScripts`：

```
function countBy(items, groupName) {
  let counts = [];
  for (let item of items) {
    let name = groupName(item);
    let known = counts.find(c => c.name == name);
    if (!known) {
      counts.push({name, count: 1});
    } else {
      known.count++;
    }
  }
  return counts;
}

console.log(countBy([1, 2, 3, 4, 5], n => n > 2));
// → [{name: false, count: 2}, {name: true, count: 3}]
```

```
function textScripts(text) {
  let scripts = countBy(text, char => {
    let script = characterScript(char.codePointAt(0));
    return script ? script.name : "none";
  }).filter(({name}) => name != "none");

  let total = scripts.reduce((n, {count}) => n + count, 0);
  if (total == 0) return "No scripts found";

  return scripts.map(({name, count}) => {
    return `${Math.round(count * 100 / total)}% ${name}`;
  }).join(", ");
}

console.log(textScripts('英国的狗说"woof", 俄罗斯的狗说"тяв"'));
// → 61% Han, 22% Latin, 17% Cyrillic
```

#### 章まとめ（原文の要旨）

関数値を他の関数に渡せることは JavaScript の深く有用な側面で、「隙間（gaps）」のある計算をモデル化する関数を書けるようにする。配列は多数の有用な高階メソッドを提供する：`forEach`（要素をループ）、`filter`（述語関数を通った要素だけの新配列）、`map`（各要素を関数に通して変換）、`reduce`（全要素を単一値に結合）、`some`（いずれかの要素が述語に一致するか）、`find`（一致する最初の要素）。

---

### 第6章 The Secret Life of Objects（出典: 06_object.md）

章頭引用は Barbara Liskov, "Programming with Abstract Data Types"：「An abstract data type is realized by writing a special kind of program […] which defines the type in terms of the operations which can be performed on it.」

#### 抽象データ型・インターフェース・カプセル化

- オブジェクト指向プログラミングの主要アイデアは、オブジェクト（というよりオブジェクトの**型**）をプログラム組織化の単位にすること。厳格に分離されたオブジェクト型の集合としてプログラムを構成すると、構造について考える方法が得られ、ある種の規律を強制でき、すべてが絡み合うのを防げる。
- 比喩：電動ミキサー。設計・組立する人は材料科学と電気の理解を要する専門作業をするが、それを滑らかなプラスチックの殻で覆い、パンケーキ生地を混ぜたいだけの人はミキサーを操作する少数のノブだけを理解すればよい。
- **abstract data type**（= object class）は、任意に複雑なコードを含みうるが、それを使う人が使うべき限られたメソッドとプロパティの集合だけを露出するサブプログラム。これにより大きなプログラムを複数の「家電タイプ」から組み上げられ、部品同士が特定の方法でしか相互作用しないよう要求することで絡み合いの度合いを制限する。
- あるオブジェクトクラスに問題が見つかったら、プログラムの他の部分に影響を与えず修理あるいは完全に書き直せることが多い。さらに複数の異なるプログラムで再利用できる可能性もある。JavaScript の組み込みデータ構造（配列や文字列）もそうした再利用可能な抽象データ型と考えられる。
- 各抽象データ型は **interface**（外部コードが実行できる操作の集合）を持つ。そのインターフェースを越える詳細は **encapsulated**＝型の内部として扱われ、プログラムの他の部分の関心事ではない。
- 数のような基本的なものすら、加算・乗算・比較を許すインターフェースを持つ抽象データ型と考えられる。実際、古典的OOPで単一の**オブジェクト**を主要な組織化単位とする固執はやや不幸である。有用な機能の断片はしばしば密接に協働する複数の異なるオブジェクトクラスの集団を含むからである。

#### メソッドと `this`

- JavaScript ではメソッドは関数値を保持するプロパティにすぎない。
- 関数がメソッドとして呼ばれる（プロパティとして参照され即座に呼ばれる、`object.method()` の形）とき、その本体の `this` というバインディングは自動的に呼び出し対象のオブジェクトを指す。
- `this` は「通常のパラメータとは異なる方法で関数に渡される追加のパラメータ」と考えられる。明示的に与えたい場合は関数の `call` メソッドを使う。第1引数が `this` の値、以降は通常のパラメータとして扱われる。
- 各関数は呼び出し方に依存する独自の `this` バインディングを持つので、**`function` キーワードで定義した通常の関数の中から、囲むスコープの `this` を参照できない**。
- **アロー関数は違う**：自分の `this` をバインドせず、周囲のスコープの `this` を見ることができる。（診断上重要：コールバック内で `this` が期待通りかはアロー/通常関数の選択に依存する。）
- オブジェクト式の中の `find(array)` のようなプロパティはメソッド定義の短縮記法。`find` というプロパティを作り、関数を値として与える。

#### プロトタイプ（DOM/ライブラリ汚染の基礎）

- プロトタイプはオブジェクトを他のオブジェクトにリンクし、その他のオブジェクトが持つ全プロパティを「魔法のように」得る仕組み。`{}` 記法で作られた素のオブジェクトは **`Object.prototype`** という名のオブジェクトにリンクされる。
- オブジェクトが自分の持たないプロパティへの要求を受けると、そのプロトタイプが探される。それも持たなければ**プロトタイプのプロトタイプ**が探され、プロトタイプを持たないオブジェクトに到達するまで続く（`Object.prototype` がそのようなオブジェクト＝プロトタイプは `null`）。
- 多くのオブジェクトは `Object.prototype` を直接のプロトタイプに持たず、別のデフォルトプロパティ集合を提供する別のオブジェクトを持つ。**関数は `Function.prototype` から、配列は `Array.prototype` から派生**する。そうしたプロトタイプオブジェクト自体もプロトタイプ（多くは `Object.prototype`）を持つので、間接的に `toString` などを提供し続ける。
- `Object.create` で特定のプロトタイプを持つオブジェクトを作れる。
- 〔補足（一般知識）〕この連鎖探索の性質が prototype pollution（`__proto__` / `constructor.prototype` への書き込みが全オブジェクトに波及する）の前提になる。**ただし本書は prototype pollution という攻撃名・手法には一切言及していない。**

#### クラス・private プロパティ

- `class` キーワードはクラス宣言を開始し、コンストラクタとメソッド集合を一緒に定義できる。`Rabbit` というバインディングを定義し、それは `constructor` のコードを実行する関数を保持し、`speak` メソッドを保持する `prototype` プロパティを持つ。
- コンストラクタは `new` を前に付けて呼ぶ。そうすると、関数の `prototype` プロパティのオブジェクトをプロトタイプに持つ新しいインスタンスオブジェクトを作り、`this` をその新オブジェクトにバインドして関数を実行し、最後にそのオブジェクトを返す。
- `class` は **2015年版の JavaScript で初めて導入**された。任意の関数がコンストラクタとして使え、2015年以前はクラス定義とは通常の関数を書いてその `prototype` プロパティを操作することだった。この理由から、**すべての非アロー関数は空オブジェクトを保持する `prototype` プロパティを持って始まる**。
- コンストラクタの名前は慣習として大文字始まり。
- 区別が重要：プロトタイプがコンストラクタに関連付けられる方法（コンストラクタの `prototype` プロパティ経由）と、オブジェクトがプロトタイプを**持つ**方法（`Object.getPrototypeOf` で分かる）。コンストラクタの実際のプロトタイプは `Function.prototype`（コンストラクタは関数だから）。コンストラクタ関数の `prototype` **プロパティ**は、それを通して作られるインスタンスに使われるプロトタイプを保持する。
- クラス宣言で直接プロパティを宣言できる。メソッドと違い、そうしたプロパティは**インスタンスオブジェクトに追加され、プロトタイプには追加されない**。
- `class` は `function` 同様、文としても式としても使える。式として使うとバインディングを定義せずコンストラクタを値として生成する。クラス式では名前を省略できる。
- **private メソッド**：名前の前に `#` を付ける。そうしたメソッドはそれを定義する `class` 宣言の内側からのみ呼べる。クラスがコンストラクタを宣言しない場合、自動的に空のコンストラクタを得る。クラス外から `#getSecret` を呼ぼうとするとエラーになる。その存在はクラス宣言の内側に完全に隠される。
- **private インスタンスプロパティを使うには宣言が必須**。通常のプロパティは代入するだけで作れるが、private プロパティは利用可能になるためにクラス宣言で宣言されなければならない。

#### プロパティのオーバーライド

- オブジェクトにプロパティを追加すると、プロトタイプに存在するかどうかに関係なく、そのプロパティは**オブジェクト自身**に追加される。同名プロパティがプロトタイプに既にあった場合、それはもはやオブジェクトに影響しない（オブジェクト自身のプロパティの背後に隠れる）。
- オーバーライドは、より一般的なオブジェクトクラスのインスタンスにおける例外的なプロパティを表現し、例外でないオブジェクトはプロトタイプから標準値を取る、という使い方に有用。
- 標準の function / array プロトタイプに基本 object プロトタイプとは違う `toString` を与えるのにもオーバーライドが使われる。配列に `toString` を呼ぶと `.join(",")` と似た結果（値の間にカンマ）。`Object.prototype.toString` を配列に直接呼ぶと別の文字列になる：その関数は配列を知らないので、単に `object` という語と型名を角括弧で囲む。

#### マップ（オブジェクトをマップに使う危険＝診断上重要）

- 素のオブジェクトをマップに使うのは**危険**。素のオブジェクトは `Object.prototype` から派生するため、`"toString" in ages` が `true` になってしまう（誰も toString という名の人物を登録していないのに）。
- 回避策1：**プロトタイプを持たないオブジェクトを作る**。`Object.create` に `null` を渡すと、結果のオブジェクトは `Object.prototype` から派生せず、マップとして安全に使える。
- オブジェクトのプロパティ名は文字列でなければならない。文字列に容易に変換できないキー（オブジェクトなど）が必要なら、オブジェクトをマップに使えない。
- 回避策2：**`Map` クラス**。マッピングを保持し任意の型のキーを許す。`set` / `get` / `has` が `Map` オブジェクトのインターフェースの一部。
- 素のオブジェクトをマップとして扱う必要がある場合、`Object.keys` はオブジェクトの**自身の**キーのみを返し、プロトタイプのものは返さないことを知っておくと有用。`in` 演算子の代替として、プロトタイプを無視する **`Object.hasOwn`** 関数を使える。
- 〔補足（一般知識）〕`Object.create(null)` / `Map` / `Object.hasOwn` の使い分けは、ユーザー入力をキーにするコードの安全性レビューの主要チェックポイントである。本書はセキュリティ文脈では述べていないが「dangerous」という語で危険性を明言している。

#### ポリモーフィズム・getter/setter/static・Symbol・iterator・継承

- `String` 関数（値を文字列に変換）をオブジェクトに呼ぶと、意味のある文字列を作ろうとして `toString` メソッドを呼ぶ。
- ある特定のインターフェース（この場合 `toString` メソッド）を持つオブジェクトで動くように書かれたコードは、そのインターフェースをサポートするあらゆる種類のオブジェクトを差し込んで動作させられる。この技法を **polymorphism** と呼ぶ。
- 広く使われるインターフェースの例が **array-like object**：数を保持する `length` プロパティと、各要素に対する番号付きプロパティを持つ。配列と文字列の両方がこのインターフェースをサポートし、他の様々なオブジェクト（ブラウザの章で見るものも含む）もサポートする。このインターフェースを提供するものには `Array.prototype.forEach` など多くの配列メソッドを呼べる。
- **getter**：オブジェクト式やクラス宣言でメソッド名の前に `get` を書く。プロパティを読むたびに関連メソッドが呼ばれる。**setter** はプロパティに書き込むとき。
- **static**：クラス宣言内で名前の前に `static` を書いたメソッドやプロパティはコンストラクタに格納される。クラスインスタンスへのアクセスは持たないが、インスタンス生成の追加手段を提供するのに使える。
- **Symbol**（2015年に追加）：複数のインターフェースが異なる目的で同じプロパティ名を使う可能性がある（array-like の `length` とハイキングルートの `length`）。iteration protocol のようなものに対し、言語設計者は**他のいかなるものとも本当に衝突しないプロパティ型**を必要とした。`Symbol` 関数で作られ、**新しく作られた Symbol は一意で、同じ Symbol を2回作れない**。`Symbol` に渡す文字列は文字列変換時に含まれ、コンソール表示時などに認識しやすくするだけで、それ以上の意味はない（複数の Symbol が同じ名前を持ちうる）。オブジェクト式やクラスに Symbol プロパティを含めるには角括弧で囲む。
- **iterable / iterator インターフェース**：`for`/`of` に渡されるオブジェクトは iterable であることが期待される。つまり `Symbol.iterator` シンボル（言語が定義するシンボル値で、`Symbol` 関数のプロパティとして格納されている）で名付けられたメソッドを持つ。呼ばれるとそのメソッドは第2のインターフェース **iterator** を提供するオブジェクトを返すべき。iterator は `next` メソッドを持ち、次の結果を返す。結果は `value` プロパティ（次の値があれば）と `done` プロパティ（もう結果がなければ true、それ以外は false）を持つオブジェクトであるべき。**`next` / `value` / `done` は素の文字列で、シンボルではない。** 実際のシンボルは `Symbol.iterator` だけで、これは非常に多くの異なるオブジェクトに追加される可能性が高いから。
- `...` 構文（配列記法と関数呼び出し）は任意の iterable オブジェクトで同様に動く。`[...value]` で任意の iterable の要素を含む配列を作れる。
- **継承**：`extends` はこのクラスがデフォルトの `Object` プロトタイプではなく他のクラスに基づくことを示す。これを **superclass**、派生クラスを **subclass** と呼ぶ。`super` キーワードでスーパークラスのコンストラクタを呼ぶ。`super.something` でスーパークラスのプロトタイプ上のメソッドやゲッターを呼べる。
- 継承への著者の評価（設計レビューで引用価値が高い）：カプセル化とポリモーフィズムはコード片を互いから**分離**しプログラム全体の絡み合いを減らせるが、**継承は根本的にクラスを結び付け、より多くの絡み合いを作る**。クラスから継承するとき、単に使うときよりそれがどう動くかをより多く知る必要がある。継承は一部のプログラムを簡潔にする有用なツールだが、**最初に手を伸ばすべきツールではなく、クラス階層を構築する機会を積極的に探すべきでもない**。
- **`instanceof`**：オブジェクトが特定のクラスから派生したかを知る二項演算子。継承された型も見通すので `LengthList` は `List` のインスタンス。`Array` のような標準コンストラクタにも適用できる。**ほぼすべてのオブジェクトは `Object` のインスタンス**。

#### コード/コマンド（原文のまま逐語）

メソッドと `this` / `call`：

```
function speak(line) {
  console.log(`The ${this.type} rabbit says '${line}'`);
}
let whiteRabbit = {type: "white", speak};
let hungryRabbit = {type: "hungry", speak};

whiteRabbit.speak("Oh my fur and whiskers");
// → The white rabbit says 'Oh my fur and whiskers'
hungryRabbit.speak("Got any carrots?");
// → The hungry rabbit says 'Got any carrots?'
```

```
speak.call(whiteRabbit, "Hurry");
// → The white rabbit says 'Hurry'
```

```
let finder = {
  find(array) {
    return array.some(v => v == this.value);
  },
  value: 5
};
console.log(finder.find([4, 5]));
// → true
```

プロトタイプ：

```
let empty = {};
console.log(empty.toString);
// → function toString(){…}
console.log(empty.toString());
// → [object Object]
```

```
console.log(Object.getPrototypeOf({}) == Object.prototype);
// → true
console.log(Object.getPrototypeOf(Object.prototype));
// → null
```

```
console.log(Object.getPrototypeOf(Math.max) ==
            Function.prototype);
// → true
console.log(Object.getPrototypeOf([]) == Array.prototype);
// → true
```

```
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

コンストラクタとクラス：

```
function makeRabbit(type) {
  let rabbit = Object.create(protoRabbit);
  rabbit.type = type;
  return rabbit;
}
```

```
class Rabbit {
  constructor(type) {
    this.type = type;
  }
  speak(line) {
    console.log(`The ${this.type} rabbit says '${line}'`);
  }
}
```

```
let killerRabbit = new Rabbit("killer");
```

```
function ArchaicRabbit(type) {
  this.type = type;
}
ArchaicRabbit.prototype.speak = function(line) {
  console.log(`The ${this.type} rabbit says '${line}'`);
};
let oldSchoolRabbit = new ArchaicRabbit("old school");
```

```
console.log(Object.getPrototypeOf(Rabbit) ==
            Function.prototype);
// → true
console.log(Object.getPrototypeOf(killerRabbit) ==
            Rabbit.prototype);
// → true
```

```
class Particle {
  speed = 0;
  constructor(position) {
    this.position = position;
  }
}
```

```
let object = new class { getWord() { return "hello"; } };
console.log(object.getWord());
// → hello
```

private プロパティ：

```
class SecretiveObject {
  #getSecret() {
    return "I ate all the plums";
  }
  interrogate() {
    let shallISayIt = this.#getSecret();
    return "never";
  }
}
```

```
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

オーバーライド：

```
Rabbit.prototype.teeth = "small";
console.log(killerRabbit.teeth);
// → small
killerRabbit.teeth = "long, sharp, and bloody";
console.log(killerRabbit.teeth);
// → long, sharp, and bloody
console.log((new Rabbit("basic")).teeth);
// → small
console.log(Rabbit.prototype.teeth);
// → small
```

```
console.log(Array.prototype.toString ==
            Object.prototype.toString);
// → false
console.log([1, 2].toString());
// → 1,2
```

```
console.log(Object.prototype.toString.call([1, 2]));
// → [object Array]
```

マップとプロトタイプ汚染の基礎（**診断で最重要のコード**）：

```
let ages = {
  Boris: 39,
  Liang: 22,
  Júlia: 62
};

console.log(`Júlia is ${ages["Júlia"]}`);
// → Júlia is 62
console.log("Is Jack's age known?", "Jack" in ages);
// → Is Jack's age known? false
console.log("Is toString's age known?", "toString" in ages);
// → Is toString's age known? true
```

```
console.log("toString" in Object.create(null));
// → false
```

```
let ages = new Map();
ages.set("Boris", 39);
ages.set("Liang", 22);
ages.set("Júlia", 62);

console.log(`Júlia is ${ages.get("Júlia")}`);
// → Júlia is 62
console.log("Is Jack's age known?", ages.has("Jack"));
// → Is Jack's age known? false
console.log(ages.has("toString"));
// → false
```

```
console.log(Object.hasOwn({x: 1}, "x"));
// → true
console.log(Object.hasOwn({x: 1}, "toString"));
// → false
```

ポリモーフィズム：

```
Rabbit.prototype.toString = function() {
  return `a ${this.type} rabbit`;
};

console.log(String(killerRabbit));
// → a killer rabbit
```

```
Array.prototype.forEach.call({
  length: 2,
  0: "A",
  1: "B"
}, elt => console.log(elt));
// → A
// → B
```

getter / setter / static：

```
let varyingSize = {
  get size() {
    return Math.floor(Math.random() * 100);
  }
};

console.log(varyingSize.size);
// → 73
console.log(varyingSize.size);
// → 49
```

```
class Temperature {
  constructor(celsius) {
    this.celsius = celsius;
  }
  get fahrenheit() {
    return this.celsius * 1.8 + 32;
  }
  set fahrenheit(value) {
    this.celsius = (value - 32) / 1.8;
  }

  static fromFahrenheit(value) {
    return new Temperature((value - 32) / 1.8);
  }
}

let temp = new Temperature(22);
console.log(temp.fahrenheit);
// → 71.6
temp.fahrenheit = 86;
console.log(temp.celsius);
// → 30
```

```
let boil = Temperature.fromFahrenheit(212);
console.log(boil.celsius);
// → 100
```

Symbol：

```
let sym = Symbol("name");
console.log(sym == Symbol("name"));
// → false
Rabbit.prototype[sym] = 55;
console.log(killerRabbit[sym]);
// → 55
```

```
const length = Symbol("length");
Array.prototype[length] = 0;

console.log([1, 2].length);
// → 2
console.log([1, 2][length]);
// → 0
```

```
let myTrip = {
  length: 2,
  0: "Lankwitz",
  1: "Babelsberg",
  [length]: 21500
};
console.log(myTrip[length], myTrip.length);
// → 21500 2
```

iterator インターフェース：

```
let okIterator = "OK"[Symbol.iterator]();
console.log(okIterator.next());
// → {value: "O", done: false}
console.log(okIterator.next());
// → {value: "K", done: false}
console.log(okIterator.next());
// → {value: undefined, done: true}
```

```
class List {
  constructor(value, rest) {
    this.value = value;
    this.rest = rest;
  }

  get length() {
    return 1 + (this.rest ? this.rest.length : 0);
  }

  static fromArray(array) {
    let result = null;
    for (let i = array.length - 1; i >= 0; i--) {
      result = new this(array[i], result);
    }
    return result;
  }
}
```

```
class ListIterator {
  constructor(list) {
    this.list = list;
  }

  next() {
    if (this.list == null) {
      return {done: true};
    }
    let value = this.list.value;
    this.list = this.list.rest;
    return {value, done: false};
  }
}
```

```
List.prototype[Symbol.iterator] = function() {
  return new ListIterator(this);
};
```

```
let list = List.fromArray([1, 2, 3]);
for (let element of list) {
  console.log(element);
}
// → 1
// → 2
// → 3
```

```
console.log([..."PCI"]);
// → ["P", "C", "I"]
```

継承と instanceof：

```
class LengthList extends List {
  #length;

  constructor(value, rest) {
    super(value, rest);
    this.#length = super.length;
  }

  get length() {
    return this.#length;
  }
}

console.log(LengthList.fromArray([1, 2, 3]).length);
// → 3
```

```
console.log(
  new LengthList(1, null) instanceof LengthList);
// → true
console.log(new LengthList(2, null) instanceof List);
// → true
console.log(new List(3, null) instanceof LengthList);
// → false
console.log([1] instanceof Array);
// → true
```

---

### 第8章 Bugs and Errors（出典: 08_error.md）

章頭引用は Brian Kernighan and P.J. Plauger, "The Elements of Programming Style"：「Debugging is twice as hard as writing the code in the first place. Therefore, if you write the code as cleverly as possible, you are, by definition, not smart enough to debug it.」

#### バグの分類と言語の緩さ

- バグは大きく2種類に分類できる：**思考そのものが混乱していたことによるもの**と、**思考をコードに変換する過程で入り込んだミスによるもの**。前者は後者より一般に診断と修正が難しい。
- JavaScript の緩さは障害になる。バインディングとプロパティの概念が曖昧なので、実行するまでタイポを捕まえることはほとんどない。実行時でも `true * "monkey"` のような明らかに無意味なことを文句なしに許す。
- JavaScript が文句を言うもの：文法に従わないプログラム（即座に文句）、関数でないものを呼ぶ、**undefined の値にプロパティを引く**（動作しようとしたときにエラー報告）。
- しかししばしば無意味な計算は単に `NaN` か undefined を生み、プログラムは意味のあることをしているつもりで幸せに続行する。ミスは偽の値が複数の関数を旅した後にようやく現れる。**エラーを一切起こさず、静かにプログラムの出力を間違ったものにすることもある。** そうした問題の源を見つけるのは難しい。

#### strict mode

- ファイルまたは関数本体の先頭に文字列 `"use strict"` を置くことで有効化。
- **クラスとモジュールの中のコードは自動的に strict**（モジュールは第10章）。非strictの古い挙動が残っているのは、古いコードがそれに依存している可能性があり、言語設計者は既存プログラムを壊さないよう懸命に働いているから。
- 通常、バインディングの前に `let` を付け忘れると JavaScript は静かにグローバルバインディングを作りそれを使う。strict mode ではエラーが報告される。**ただし、問題のバインディングがスコープのどこかに既に存在する場合はこれが働かない。その場合ループは依然として静かにバインディングの値を上書きする。**
- strict mode のもう一つの変更：**メソッドとして呼ばれていない関数では `this` バインディングが `undefined` を保持する**。strict mode 外でそうした呼び出しをすると、`this` はグローバルスコープオブジェクト（プロパティがグローバルバインディングであるオブジェクト）を参照する。だから strict mode でメソッドやコンストラクタを誤って呼ぶと、グローバルスコープに幸せに書き込むのではなく、`this` から何かを読もうとした途端にエラーを出す。
- `new` なしでコンストラクタ関数を呼ぶ例：非strictでは `Person("Ferdinand")` が成功して undefined を返し、**グローバルバインディング `name` を作ってしまう**。strict mode では `TypeError` になる。
- **`class` 記法で作られたコンストラクタは `new` なしで呼ばれると常に文句を言う**ので、非strictモードでもこの問題は小さくなっている。
- strict mode はさらにいくつかのことをする：**同名の複数パラメータを関数に与えることを禁止**し、**一部の問題ある言語機能を完全に削除する**（`with` 文。これは「so wrong it is not further discussed in this book」）。

#### 型と TypeScript

- 一部の言語はプログラムを実行する前にすべてのバインディングと式の型を知りたがり、型が一貫しない使い方をされたら即座に教えてくれる。JavaScript は実行時にしか型を考慮せず、しかもそこでも期待する型に暗黙変換しようとすることが多いので、あまり助けにならない。
- それでも型はプログラムについて語る有用な枠組みを提供する。多くのミスは関数に入る／出る値の種類についての混乱から来る。
- 型は有用であるだけの十分なコードを記述できるようになるために、自身の複雑さを導入する必要がある。配列からランダムな要素を返す `randomPick` の型は？ **type variable** _T_（任意の型を代替できる）を導入して `(T[]) → T` のような型を与える必要がある。
- 型が既知なら、コンピュータが実行前にチェックしてミスを指摘できる。型を追加してチェックする JavaScript の方言がいくつかあり、**最も人気のあるのが TypeScript**（https://www.typescriptlang.org/）。「プログラムにより厳格さを追加したいなら試すことを推奨する」。
- 「本書では生の、危険な、型なしの JavaScript コードを使い続ける」。

#### テスト

- 言語がミス発見にあまり助けにならないなら、難しい方法＝プログラムを実行して正しいことをするか見る、で見つけなければならない。
- 手でこれを何度も繰り返すのは本当に悪い考え。煩わしいだけでなく、変更のたびにすべてを網羅的にテストするには時間がかかりすぎるので効果的でもない傾向がある。
- 自動テストは別のプログラムをテストするプログラムを書くプロセス。手動テストより少し多くの作業だが、一度やれば**ある種のスーパーパワー**を得る：テストを書いたすべての状況でプログラムがまだ正しく振る舞うことを数秒で検証できる。何かを壊したら、後でランダムに遭遇するのではなく即座に気づく。
- テスト集合（**test suites**）の構築・実行を助けるソフトウェアが存在し、テスト表現に適した言語（関数とメソッドの形で）を提供し、テスト失敗時に有益な情報を出力する。これらは通常 **test runners** と呼ばれる。
- **テストしやすいコードとしにくいコードがある。一般に、コードが相互作用する外部オブジェクトが多いほど、テストする文脈のセットアップが難しくなる。** 変化するオブジェクトではなく自己完結した永続的な値を使うプログラミングスタイル（第7章のスタイル）はテストしやすい傾向がある。

#### デバッグ

- 問題を起こした行は、単に他の場所で生成された不安定な値が無効な形で使われた最初の場所にすぎないことがある。
- **ランダムな変更を加えて良くなるか見たいという衝動に抵抗しなければならない。代わりに考える（think）。** 何が起きているかを分析し、なぜそれが起きているかの**理論（theory）**を立てる。そしてこの理論を検証するための追加の観測を行う。まだ理論がなければ、理論を思いつくのを助ける追加の観測を行う。
- 戦略的な `console.log` 呼び出しをプログラムに入れるのは、プログラムが何をしているかについて追加情報を得る良い方法。
- `console.log` の代替として**ブラウザのデバッガ機能**を使う方法がある。ブラウザは特定の行に **breakpoint** を設定する能力を備えている。実行がブレークポイントのある行に到達すると一時停止し、その時点のバインディングの値を検査できる。「デバッガはブラウザごとに異なるので詳細には立ち入らないが、ブラウザの developer tools を見るか、ウェブで手順を検索せよ。」
- もう一つのブレークポイント設定方法は、プログラムに **`debugger` 文**（単にそのキーワードだけからなる）を含めること。ブラウザの developer tools がアクティブなら、そうした文に到達するたびにプログラムが一時停止する。

#### エラー伝播

- プログラムが何らかの形で外界と通信するなら、不正な入力を得たり、作業で過負荷になったり、ネットワークが落ちたりする可能性がある。
- 自分のためだけにプログラムするなら問題が起きるまで無視できるが、他人に使われるものを作るなら、単にクラッシュするより良いことをしたいのが普通。悪い入力を受け流して実行を続けるのが正しい場合もあり、何が悪かったかをユーザーに報告して諦めるのが良い場合もある。どちらの状況でも、プログラムは問題に応答して能動的に何かをしなければならない。
- 特別な値を返す選択肢。一般的な選択は `null`、`undefined`、`-1`。
- **エラーが一般的で、呼び出し側が明示的に考慮すべき状況では、特別な値を返すのはエラーを示す良い方法。** ただし欠点もある：
  1. **関数がすでにあらゆる種類の値を返しうる場合**、成功と失敗を区別できるよう結果をオブジェクトでラップするなどが必要（iterator インターフェースの `next` メソッドのように）。
  2. **不器用なコードにつながる**。`promptNumber` を10回呼ぶコードは `null` が返ったかを10回チェックしなければならない。`null` を見つけた応答が単に自分も `null` を返すことなら、その関数の呼び出し側も順にチェックしなければならず、以下同様。

#### 例外

- 例外は、問題に遭遇したコードが例外を **raise（throw）** できるようにする機構。例外は任意の値でよい。
- 例外を上げることは「強化された return」に似ている：現在の関数だけでなくその呼び出し側からも飛び出し、現在の実行を開始した最初の呼び出しまでずっと下る。これを **unwinding the stack** と呼ぶ。例外はこのスタックを一気に下り、遭遇したすべての呼び出しコンテキストを投げ捨てる。
- 例外が常にスタックの底まで下るだけなら大して役に立たない。力は、下っていく例外を **catch** する「障害物」をスタックに沿って置けることにある。
- `Error` コンストラクタは `message` プロパティを持つオブジェクトを作る標準の JavaScript コンストラクタ。`Error` のインスタンスは**例外が作られた時点で存在した呼び出しスタックについての情報（stack trace）も収集する**。この情報は `stack` プロパティに格納され、問題のデバッグ時に助けになる：問題が起きた関数と、失敗した呼び出しをした関数群を教えてくれる。
- 例外の大きな利点：**エラー処理コードはエラーが起きる箇所と処理される箇所でのみ必要**。間の関数はそれについて完全に忘れられる。

#### 例外後のクリーンアップ（`finally`）

- 例外の効果はもう一種類の制御フロー。例外を起こしうるすべてのアクション（ほぼすべての関数呼び出しとプロパティアクセス）が、制御が突然コードから離れる原因になりうる。
- つまりコードが複数の副作用を持つとき、「通常の」制御フローでは常にすべて起きるように見えても、例外がその一部を起こさせないことがありうる。
- 悪い銀行コードの例：`transfer` は**まず**口座から金を引き、**それから** `getAccount` を呼んでから別の口座に加える。その時点で例外により中断されると、単に金が消える。
- 対処法の一つは副作用を減らすこと。既存データを変更せず新しい値を計算するプログラミングスタイルが助けになる。新しい値の作成途中でコード片が停止しても既存のデータ構造は損傷しないので、回復しやすい。
- それが常に実用的でないので、`try` 文にはもう一つの機能がある：`catch` ブロックの代わりに、または加えて、**`finally` ブロック**を続けられる。`finally` は「**何が起きようとも**、`try` ブロックのコードを実行しようとした後にこのコードを実行する」と言う。
- 例外が `try` ブロックで投げられたときも `finally` のコードは実行されるが、**それは例外に干渉しない。`finally` ブロックが実行された後、スタックのアンワインドが続く。**
- 「例外が予期しない場所で飛び出しても信頼して動作するプログラムを書くのは難しい。多くの人は単に気にしない。例外は典型的に例外的な状況のために予約されているので、問題は非常にまれにしか起きず、気づかれさえしないかもしれない。それが良いことか本当に悪いことかは、ソフトウェアが失敗したときにどれだけの損害を与えるかに依存する。」

#### 選択的catch（診断・レビューで最重要）

- 例外がキャッチされずスタックの底まで到達すると、環境が処理する。何を意味するかは環境によって異なる。**ブラウザではエラーの説明が典型的に JavaScript コンソールに書かれる**（ブラウザの Tools または Developer メニューから到達可能）。**Node.js はデータ破損についてより慎重で、未処理の例外が起きるとプロセス全体を中断する。**
- プログラマのミスについては、単にエラーを通すのがしばしば最善。未処理の例外は壊れたプログラムを知らせる合理的な方法で、JavaScript コンソールは現代のブラウザでは問題発生時にスタック上にあった関数呼び出しについての情報を提供する。
- **通常の使用中に起きることが予期される問題については、未処理の例外でクラッシュするのはひどい戦略。**
- 言語の無効な使用（存在しないバインディングの参照、`null` へのプロパティ参照、関数でないものの呼び出し）も例外を発生させる。そうした例外もキャッチできる。
- **JavaScript は（かなり露骨な欠落として）例外を選択的にキャッチする直接的なサポートを提供しない。すべてキャッチするか、まったくキャッチしないかのどちらか。** これは、得た例外が `catch` ブロックを書いたときに考えていたものだと**仮定**したい誘惑を生む。
- 失敗例：`promtDirection`（タイポ）により "undefined variable" エラーが起きる。`catch` ブロックが例外値 `e` を完全に無視し、問題が何かを知っていると仮定するので、バインディングエラーを不正な入力と誤って扱う。**これは無限ループを引き起こすだけでなく、タイポされたバインディングについての有用なエラーメッセージを「埋葬」する。**
- **一般ルール：例外を「どこかにルーティングする」目的（例：ネットワーク越しに別システムにプログラムがクラッシュしたと伝える）以外では、包括的に例外をキャッチするな。そしてその場合でも、どんな情報を隠しているかを注意深く考えよ。**
- 特定の種類の例外をキャッチしたい。`catch` ブロックで得た例外が関心のあるものかチェックし、そうでなければ再throwする。では例外をどう認識するか？
- `message` プロパティを期待するエラーメッセージと比較できるが、**それは不安定な書き方**——人間の消費を意図した情報（メッセージ）をプログラム的な決定に使うことになる。誰かがメッセージを変更（または翻訳）した途端にコードは動かなくなる。
- 正しい方法：**新しいエラー型を定義し `instanceof` で識別する。** 新エラークラスは `Error` を extends。独自のコンストラクタを定義しないので、文字列メッセージを引数に期待する `Error` のコンストラクタを継承する。実際、何も定義しない——クラスは空。`InputError` オブジェクトは `Error` オブジェクトと同じように振る舞うが、認識できる異なるクラスを持つ点だけが違う。

#### アサーション

- **Assertions** はプログラム内部で、何かが想定通りであることを検証するチェック。通常の操作で起きうる状況を処理するためではなく、**プログラマのミスを見つけるため**に使われる。
- 静かに undefined を返す（存在しない配列プロパティを読むと得られる）のではなく、誤用された途端に大声でプログラムを爆発させる。これによりそうしたミスが気づかれずに済む可能性が低くなり、起きたときに原因を見つけやすくなる。
- 「**あらゆる種類の悪い入力に対してアサーションを書こうとするのは推奨しない。** それは大変な作業で、非常に騒がしいコードにつながる。しやすいミス（または自分がしがちだと気づいたミス）のために予約したい。」

#### コード/コマンド（原文のまま逐語）

strict mode：

```
function canYouSpotTheProblem() {
  "use strict";
  for (counter = 0; counter < 10; counter++) {
    console.log("Happy happy");
  }
}

canYouSpotTheProblem();
// → ReferenceError: counter is not defined
```

```
function Person(name) { this.name = name; }
let ferdinand = Person("Ferdinand"); // oops
console.log(name);
// → Ferdinand
```

```
"use strict";
function Person(name) { this.name = name; }
let ferdinand = Person("Ferdinand"); // forgot new
// → TypeError: Cannot set property 'name' of undefined
```

型注釈コメント：

```
// (graph: Object, from: string, to: string) => string[]
function findRoute(graph, from, to) {
  // ...
}
```

テスト：

```
function test(label, body) {
  if (!body()) console.log(`Failed: ${label}`);
}

test("convert Latin text to uppercase", () => {
  return "hello".toUpperCase() == "HELLO";
});
test("convert Greek text to uppercase", () => {
  return "Χαίρετε".toUpperCase() == "ΧΑΊΡΕΤΕ";
});
test("don't convert case-less characters", () => {
  return "مرحبا".toUpperCase() == "مرحبا";
});
```

デバッグ例（浮動小数点による出力破壊）：

```
function numberToString(n, base = 10) {
  let result = "", sign = "";
  if (n < 0) {
    sign = "-";
    n = -n;
  }
  do {
    result = String(n % base) + result;
    n /= base;
  } while (n > 0);
  return sign + result;
}
console.log(numberToString(13, 10));
// → 1.5e-3231.3e-3221.3e-3211.3e-3201.3e-3191.3e-3181.3…
```

観測されたログ（原文 lang: null）：

```
13
1.3
0.13
0.013
…
1.5e-323
```

修正：`n /= base` ではなく `n = Math.floor(n / base)` にする。

特別な戻り値：

```
function promptNumber(question) {
  let result = Number(prompt(question));
  if (Number.isNaN(result)) return null;
  else return result;
}

console.log(promptNumber("How many trees do you see?"));
```

```
function lastElement(array) {
  if (array.length == 0) {
    return {failed: true};
  } else {
    return {value: array[array.length - 1]};
  }
}
```

例外：

```
function promptDirection(question) {
  let result = prompt(question);
  if (result.toLowerCase() == "left") return "L";
  if (result.toLowerCase() == "right") return "R";
  throw new Error("Invalid direction: " + result);
}

function look() {
  if (promptDirection("Which way?") == "L") {
    return "a house";
  } else {
    return "two angry bears";
  }
}

try {
  console.log("You see", look());
} catch (error) {
  console.log("Something went wrong: " + error);
}
```

例外安全でない銀行コード（レビュー教材として価値が高い）：

```
const accounts = {
  a: 100,
  b: 0,
  c: 20
};

function getAccount() {
  let accountName = prompt("Enter an account name");
  if (!Object.hasOwn(accounts, accountName)) {
    throw new Error(`No such account: ${accountName}`);
  }
  return accountName;
}

function transfer(from, amount) {
  if (accounts[from] < amount) return;
  accounts[from] -= amount;
  accounts[getAccount()] += amount;
}
```

`finally` による修復：

```
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

包括catchの失敗例（タイポを埋葬する）：

```
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

選択的catchの正しい形：

```
class InputError extends Error {}

function promptDirection(question) {
  let result = prompt(question);
  if (result.toLowerCase() == "left") return "L";
  if (result.toLowerCase() == "right") return "R";
  throw new InputError("Invalid direction: " + result);
}
```

```
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

アサーション：

```
function firstElement(array) {
  if (array.length == 0) {
    throw new Error("firstElement called with []");
  }
  return array[0];
}
```

---

### 第9章 Regular Expressions（出典: 09_regexp.md）

章頭引用は Jamie Zawinski：「Some people, when confronted with a problem, think 'I know, I'll use regular expressions.' Now they have two problems.」（インタラクティブ版ではさらに Master Yuan-Ma, "The Book of Programming"：「When you cut against the grain of the wood, much strength is needed. When you program against the grain of the problem, much code is needed.」）

- プログラミングのツールと技法は混沌とした進化的な方法で生き残り広がる。**最善・最も優れたものが勝つとは限らず、適切なニッチで十分に機能するもの、あるいは別の成功した技術に統合されたものが勝つ。**
- 正規表現は「ひどく不器用（terribly awkward）でありながら極めて有用」。構文は難解で、JavaScript が提供するプログラミングインターフェースは不器用。しかし文字列の検査と処理のための強力なツール。

#### 生成と2つの記法（エスケープの違いが重要）

- 正規表現はオブジェクトの一種。`RegExp` コンストラクタで構築するか、パターンをスラッシュ `/` で囲んでリテラル値として書く。
- **`RegExp` コンストラクタを使うとき、パターンは通常の文字列として書かれるので、バックスラッシュに関する通常の規則が適用される。**
- **スラッシュ記法ではバックスラッシュの扱いが異なる**：(1) 前方スラッシュがパターンを終わらせるので、パターンの一部にしたい前方スラッシュの前にはバックスラッシュを置く必要がある。(2) 特殊文字コード（`\n` など）の一部でないバックスラッシュは、文字列のように無視されるのではなく**保存され**、パターンの意味を変える。疑問符やプラス記号のような一部の文字は正規表現で特別な意味を持ち、その文字自体を表すならバックスラッシュを前置しなければならない。
- 〔補足（一般知識）〕この2記法のエスケープ差異は、フィルタ実装のレビューで頻出の混乱源。文字列中では `\\s` と二重に書く必要がある（後述の動的生成の節に原文の実例あり）。

#### 文字集合

- 角括弧で囲むと、その部分は括弧内のいずれかの文字に一致する。
- 角括弧内でハイフン `-` を2文字の間に置くと文字の**範囲**を示し、順序は文字の **Unicode 番号**で決まる。文字 0 から 9 はこの順序で隣接している（**コード 48 から 57**）ので `[0-9]` はすべてをカバーし任意の数字に一致する。
- **文字クラス表（原文の表を完全再現）**：

| パターン | 意味 |
|---|---|
| `\d` | Any digit character |
| `\w` | An alphanumeric character ("word character") |
| `\s` | Any whitespace character (space, tab, newline, and similar) |
| `\D` | A character that is _not_ a digit |
| `\W` | A nonalphanumeric character |
| `\S` | A nonwhitespace character |
| `.` | Any character except for newline |

- バックスラッシュコードは角括弧の**内側**でも使える。例：`[\d.]` は任意の数字またはピリオド文字。**ピリオド自体は角括弧内では特別な意味を失う。** プラス記号 `+` などの他の特殊文字も同様。
- 文字集合を**反転**する（集合内の文字**以外**に一致させる）には、開き括弧の後に**キャレット `^`** を書く。

#### 国際文字（診断で重要な落とし穴）

- JavaScript の初期の単純な実装と、その単純なアプローチが後に標準の挙動として固定されたという事実のため、**JavaScript の正規表現は英語に現れない文字についてかなり愚か**。
- JavaScript の正規表現にとって「**word character**」は、**ラテンアルファベット26文字（大小）、10進数字、そしてなぜかアンダースコア文字だけ**。`é` や `β` のような、まったく間違いなく word character であるものは `\w` に一致せず、大文字の `\W`（非word カテゴリ）に一致**してしまう**。
- **奇妙な歴史的偶然により `\s`（whitespace）にはこの問題がなく**、Unicode 標準が whitespace とみなすすべての文字に一致する。nonbreaking space や Mongolian vowel separator のようなものも含む。
- `\p` を使うと Unicode 標準が与えたプロパティを持つすべての文字に一致させられる。**ただし、これも元の言語標準との互換性のため、正規表現の後に `u` 文字（Unicode 用）を付けたときにのみ認識される。**
- **Unicode プロパティ表（原文の表を完全再現）**：

| パターン | 意味 |
|---|---|
| `\p{L}` | Any letter |
| `\p{N}` | Any numeric character |
| `\p{P}` | Any punctuation character |
| `\P{L}` | Any nonletter (uppercase P inverts) |
| `\p{Script=Hangul}` | Any character from the given script (see Chapter 5) |

- **非英語テキスト（あるいは "cliché" のような借用語を含む英語テキスト）を扱う可能性のあるテキスト処理に `\w` を使うのは liability（負債）**。`é` のような文字を letter として扱わないから。やや冗長になる傾向はあるが、**`\p` プロパティグループのほうが堅牢**。
- 逆に、数値を何かに使うために一致させているなら、しばしば数字には `\d` が欲しい。任意の数値文字を JavaScript の数値に変換することは `Number` のような関数ができることではないから。

#### 繰り返しとグループ化

- `+`：1回以上の繰り返し。`*`：0回以上（**星が後に付くものはパターンの一致を妨げることは決してない——適切なテキストが見つからなければ0インスタンスに一致するだけ**）。`?`：0回または1回（optional）。
- 波括弧：`{4}` は正確に4回。`{2,4}` は最低2回・最大4回。`{5,}` は5回以上（カンマの後の数を省略して open-ended range）。
- `*` や `+` のような演算子を複数要素に一度に使うには括弧を使う。括弧で囲まれた正規表現の一部は、それに続く演算子にとって単一の要素として数えられる。
- `i` フラグは正規表現を case insensitive にする。

#### マッチとグループ

- `test` は一致したかどうかだけを教える最も単純な方法。`exec`（execute）は一致が見つからなければ `null` を返し、そうでなければ一致についての情報を持つオブジェクトを返す。
- `exec` が返すオブジェクトは **`index` プロパティ**を持ち、成功した一致が文字列のどこで始まるかを教える。それ以外はオブジェクトは文字列の配列のように見える（実際そうである）。**最初の要素は一致した文字列全体。**
- 文字列値の `match` メソッドも同様に振る舞う。
- 正規表現が括弧でグループ化された部分式を含む場合、それらのグループに一致したテキストも配列に現れる。**全体の一致が常に最初の要素**、次が最初のグループ（開き括弧が式の中で最初に来るもの）に一致した部分、次が2番目のグループ、以下同様。
- **グループが一致しなかった場合（例：疑問符が後に続く場合）、出力配列のその位置は `undefined` を保持する。グループが複数回一致した場合（例：`+` が後に続く場合）、最後の一致だけが配列に入る。**（診断で重要な落とし穴：`/(\d)+/.exec("123")` は `["123", "3"]`）
- 純粋にグループ化の目的だけで括弧を使い、マッチ配列に現れさせたくない場合は、開き括弧の後に **`?:`** を置く（**non-capturing group**）。

#### Date クラス

- `new Date()` で現在の日時。`new Date(2009, 11, 9)` などで特定時刻。
- **JavaScript は月番号が0始まり（だから12月は11）、なのに日番号は1始まりという規約を使う。「This is confusing and silly. Be careful.」**
- 最後の4引数（hours, minutes, seconds, milliseconds）はオプションで、与えられないと0とみなされる。
- タイムスタンプは **UTC タイムゾーンで1970年の開始からのミリ秒数**として格納される。これは当時発明された「Unix time」の規約に従う。1970年より前の時刻には負の数を使える。`getTime` メソッドがこの数を返す。
- `Date` コンストラクタに単一引数を与えると、その引数はミリ秒カウントとして扱われる。現在のミリ秒カウントは `new Date()` して `getTime()` するか、`Date.now` 関数で得られる。
- 抽出メソッド：`getFullYear`, `getMonth`, `getDate`, `getHours`, `getMinutes`, `getSeconds`。**`getFullYear` のほかに `getYear` があり、これは年から1900を引いた値（`98` や `125` など）を返し、ほぼ役に立たない。**

#### 境界と look-ahead

- `^` は入力文字列の先頭に一致、`$` は末尾に一致。`/^\d+$/` は1つ以上の数字だけからなる文字列に一致、`/^!/` は感嘆符で始まる任意の文字列に一致、`/x^/` はどの文字列にも一致しない（文字列の先頭より前に `x` は存在しえない）。
- **`\b` は word boundary に一致**——片側に word character、もう片側に非 word character がある位置。「残念ながら、これらは `\w` と同じ単純な word character の概念を使うので、あまり信頼できない。」
- これらの境界マーカーは実際の文字には一致しない。**現れた場所で与えられた条件が成立することを強制するだけ。**
- **Look-ahead** テストも似たことをする。パターンを提供し、入力がそのパターンに一致しなければマッチを失敗させるが、**マッチ位置を前進させない**。`(?=` と `)` の間に書く。`(?! )` は **negative look-ahead** を表す。

#### 選択パターンと照合の機構

- パイプ文字 `|` は左のパターンと右のパターンの間の選択を表す。括弧でパイプ演算子が適用される部分を限定でき、複数のパイプ演算子を並べて2つ以上の選択肢を表現できる。
- `exec` や `test` を使うとき、概念的に正規表現エンジンは文字列の先頭からマッチを試み、次に2文字目から、と一致が見つかるか文字列の終わりに到達するまで続ける。**見つかった最初の一致を返すか、まったく一致を見つけられずに失敗する。**
- 実際の照合のため、エンジンは正規表現を **flow diagram（フロー図／鉄道図）**のように扱う。図の左側から右側への経路を見つけられれば式は一致する。文字列内の現在位置を保持し、ボックスを通るたびに現在位置より後の文字列部分がそのボックスに一致することを検証する。

#### バックトラッキング（ReDoS の原理＝教科書で最重要）

- `/^([01]+b|[\da-f]+h|\d+)$/` は「`b` が後続する2進数」「`h` が後続する16進数（基数16、`a`〜`f` が10〜15を表す）」「接尾辞文字なしの通常の10進数」のいずれかに一致する。
- この式を照合するとき、入力が実際には2進数を含んでいなくても上（binary）の枝にしばしば入る。`"103"` を照合する場合、間違った枝にいると明らかになるのは `3` の時点。文字列は式に**一致する**が、現在いる枝ではない。
- **だからマッチャは backtrack する。** 枝に入るとき現在位置を覚えておき（この場合、文字列の先頭、最初の境界ボックスを過ぎたところ）、現在の枝がうまくいかなければ戻って別の枝を試せるようにする。`"103"` の場合、`3` に遭遇した後、マッチャは16進数の枝を試し始め、数の後に `h` がないので再び失敗する。それから10進数の枝を試す。これが合致し、結局マッチが報告される。
- **マッチャは完全な一致を見つけた途端に停止する。つまり複数の枝が潜在的に文字列に一致しうる場合、最初のもの（正規表現内で枝が現れる位置で順序付け）だけが使われる。**
- バックトラックは `+` や `*` のような繰り返し演算子でも起きる。`/^.*x/` を `"abcxe"` に照合すると、`.*` 部分は最初に文字列全体を消費しようとする。それからエンジンはパターンに一致させるには `x` が必要だと気づく。文字列の終わりより後に `x` はないので、星演算子は1文字少なく一致させようとする。しかしマッチャは `abcx` の後にも `x` を見つけないので再びバックトラックし、星演算子を `abc` だけに一致させる。**今度は**必要な場所に `x` を見つけ、位置 0 から 4 までの成功した一致を報告する。
- **大量のバックトラックをする正規表現を書くことは可能。この問題はパターンが入力の一部に多くの異なる方法で一致しうるときに起きる。** 例：2進数の正規表現を書いているときに混乱して `/([01]+)+b/` のようなものを誤って書いてしまうかもしれない。
- **それが末尾に `b` 文字のない長い0と1の列に一致しようとすると、マッチャはまず内側のループを数字が尽きるまで通る。それから `b` がないことに気づくので、1ポジション戻り、外側のループを1回通り、また諦め、内側のループからもう一度バックトラックしようとする。この2つのループを通るあらゆる可能な経路を試し続ける。これは追加の文字1つごとに作業量が倍になることを意味する。ほんの数十文字でも、結果のマッチは実質的に永遠にかかる。**
- 〔補足（一般知識）〕この「文字1つごとに作業量が倍」＝指数時間バックトラックが、**ReDoS（Regular expression Denial of Service）**の正体である。本書は「ReDoS」という語は使わず、性能問題として説明している。クライアントサイドでは入力バリデーション用の正規表現に長い文字列を与えてタブを固まらせる形で現れる。

#### replace メソッド

- 第1引数は正規表現でもよく、その場合正規表現の最初の一致が置換される。**`g` オプション（global）を正規表現の後に追加すると、最初のものだけでなく文字列内のすべての一致が置換される。**
- `replace` と正規表現を使う真の力は、**置換文字列内で一致したグループを参照できる**こと。`$1` と `$2` はパターン内の括弧グループを指す。`$1` は最初のグループに一致したテキストで置換され、`$2` は2番目、以下 **`$9` まで**。**全体の一致は `$&` で参照できる。**
- 第2引数に文字列ではなく**関数**を渡せる。各置換について、関数は一致したグループ（および一致全体）を引数として呼ばれ、その戻り値が新しい文字列に挿入される。

#### Greed（貪欲）

- 繰り返し演算子（`+`, `*`, `?`, `{}`）は **greedy** である、つまり可能な限り多くに一致してそこからバックトラックする。**疑問符を後に置くと（`+?`, `*?`, `??`, `{}?`）non-greedy になり、可能な限り少なく一致し始め、残りのパターンが小さい一致に合わないときだけより多く一致する。**
- コメント除去の例で `[^]*` は「空の文字集合に含まれない任意の文字」＝任意の文字に一致させる方法。ピリオドはブロックコメントが改行をまたげるのに改行に一致しないので使えない。
- 貪欲版 `/\/\/.*|\/\*[^]*\*\//g` は `"1 /* a */+/* b */ 1"` を `"1  1"` にしてしまう（最後のブロックコメントの終わりまで行ってしまう）。非貪欲版 `/\/\/.*|\/\*[^]*?\*\//g` で `"1 + 1"` になる。
- **「正規表現プログラムの多くのバグは、non-greedy のほうがうまく動くところで意図せず greedy な演算子を使ったことに追跡できる。繰り返し演算子を使うときは non-greedy の変種を優先せよ。」**

#### 動的な RegExp 生成とメタ文字エスケープ（インジェクション対策の原型）

- コードを書いているときに一致させる正確なパターンが分からない場合がある。文字列を組み立てて `RegExp` コンストラクタに渡せる。
- 文字列の `\s` 部分を作るとき、スラッシュで囲まれた正規表現ではなく通常の文字列で書いているので**バックスラッシュを2つ使わなければならない**。`RegExp` コンストラクタの第2引数は正規表現のオプション——この場合 global と case insensitive のための `"gi"`。
- **しかし名前が `"dea+hl[]rd"` だったら？（ユーザーが「オタクっぽい10代」の場合）それは実際にはユーザー名に一致しない無意味な正規表現になる。**
- **回避策：特別な意味を持つ任意の文字の前にバックスラッシュを追加する。**（＝正規表現インジェクションの対策そのもの。逐語コードは下記）

#### search メソッドと lastIndex プロパティ（状態を持つ正規表現の罠）

- 文字列の `indexOf` メソッドは正規表現で呼べないが、`search` メソッドは正規表現を期待する。`indexOf` と同様、式が見つかった最初のインデックスを返し、見つからなければ -1 を返す。
- **残念ながら、マッチが与えられたオフセットから始まるべきだと示す方法はない**（`indexOf` の第2引数のように）。しばしば有用なのに。
- 正規表現オブジェクトはプロパティを持つ。**`source`** は式が作られた元の文字列を含む。**`lastIndex`** は限定された状況下で次のマッチがどこから始まるかを制御する。
- その状況とは、**正規表現が global（`g`）または sticky（`y`）オプションを有効にしていて、マッチが `exec` メソッド経由で起きること**。「また、余分な引数を `exec` に渡せるようにするほうが混乱が少なかっただろうが、混乱は JavaScript の正規表現インターフェースの本質的な機能である。」（原文の皮肉）
- マッチが成功すると、`exec` の呼び出しは自動的に `lastIndex` プロパティをマッチの後を指すよう更新する。**マッチが見つからなければ `lastIndex` は 0 に戻され、これは新しく構築された正規表現オブジェクトが持つ値でもある。**
- **global と sticky の違い**：sticky が有効なとき、マッチは **`lastIndex` に直接始まる場合のみ成功**する。global では、マッチが始まれる位置を先方に探す。
- **複数の `exec` 呼び出しで共有された正規表現値を使うとき、`lastIndex` への自動更新が問題を引き起こしうる。正規表現が前の呼び出しから残ったインデックスから誤って開始するかもしれない。**（逐語例：`digit.exec("and now: 1")` が `null` になる）
- global オプションのもう一つの興味深い効果：文字列の `match` メソッドの動作を変える。**global な式で呼ばれると、`exec` が返すような配列ではなく、パターンのすべての一致を見つけ、一致した文字列を含む配列を返す。**
- 「**だから global な正規表現には慎重であれ。** それらが必要なケース——`replace` への呼び出しと、明示的に `lastIndex` を使いたい場所——は典型的にそれらを使いたい状況である。」
- 文字列内の正規表現のすべての一致を見つける一般的な方法は **`matchAll`** メソッド。これはマッチ配列の配列を返す。**`matchAll` に与える正規表現は `g` を有効にしていなければならない（must）。**

#### INI ファイルのパース

- INI 形式の正確な規則（原文の箇条書き）：
  - 空行とセミコロンで始まる行は無視される。
  - `[` と `]` で囲まれた行は新しいセクションを開始する。
  - 英数字の識別子の後に `=` 文字が続く行は、現在のセクションに設定を追加する。
  - それ以外は無効。
- 一部の OS は行の区切りに改行文字だけでなく**キャリッジリターンの後に改行（`"\r\n"`）**を使う。`split` メソッドは引数に正規表現も許すので、`/\r?\n/` のような正規表現を使って `"\n"` と `"\r\n"` の両方を許す形で分割できる。
- **`^` と `$` の繰り返しの使用に注目：式が行の一部ではなく行全体に一致することを確認するため。これらを省くと、ほとんど動くが一部の入力で奇妙に振る舞うコードになり、追跡が難しいバグになりうる。**
- `if (match = string.match(...))` のパターンは、**代入式（`=`）の値が代入された値であるという事実を利用する**。`match` への呼び出しが成功するか確信がないことが多いので、結果オブジェクトにアクセスできるのはこれをテストする `if` 文の内側だけ。`else if` の心地よい連鎖を壊さないため、マッチの結果をバインディングに代入し、その代入を即座に `if` 文のテストとして使う。
- 行がセクションヘッダでもプロパティでもない場合、`/^\s*(;|$)/` でコメントまたは空行かをチェックする（空白のみ、または空白の後にセミコロン＝行の残りがコメント）。どの期待された形にも一致しない行では例外を投げる。

#### code unit と文字（`u` フラグ）

- **JavaScript の正規表現で標準化されたもう一つの設計ミス：デフォルトで `.` や `?` のような演算子は（第5章で議論した）code unit に対して働き、実際の文字に対して働かない。** これは2つの code unit から構成される文字が奇妙に振る舞うことを意味する。
- 問題は、🍎 が2つの code unit として扱われ、`{3}` が2番目のユニットにのみ適用されること。同様にドットは2つではなく単一の code unit に一致する。
- **`u`（Unicode）オプションを正規表現に追加して、そうした文字を適切に扱わせなければならない。**

#### 章まとめの表（原文の表を完全再現）

| パターン | 意味 |
|---|---|
| `/abc/` | A sequence of characters |
| `/[abc]/` | Any character from a set of characters |
| `/[^abc]/` | Any character _not_ in a set of characters |
| `/[0-9]/` | Any character in a range of characters |
| `/x+/` | One or more occurrences of the pattern `x` |
| `/x+?/` | One or more occurrences, nongreedy |
| `/x*/` | Zero or more occurrences |
| `/x?/` | Zero or one occurrence |
| `/x{2,4}/` | Two to four occurrences |
| `/(abc)/` | A group |
| `/a\|b\|c/` | Any one of several patterns |
| `/\d/` | Any digit character |
| `/\w/` | An alphanumeric character ("word character") |
| `/\s/` | Any whitespace character |
| `/./` | Any character except newlines |
| `/\p{L}/u` | Any letter character |
| `/^/` | Start of input |
| `/$/` | End of input |
| `/(?=a)/` | A look-ahead test |

フラグまとめ（原文）：`i` は case insensitive。`g` は global（とりわけ `replace` が最初だけでなく全インスタンスを置換する）。`y` は sticky（マッチを探すとき先方を探して文字列の一部をスキップしない）。`u` は Unicode モードを有効にし、`\p` 構文を可能にし、2 code unit を占める文字の扱いに関する多数の問題を修正する。

最後の一文（原文）：「Regular expressions are a sharp tool with an awkward handle. They simplify some tasks tremendously but can quickly become unmanageable when applied to complex problems. Part of knowing how to use them is resisting the urge to try to shoehorn things into them that they cannot cleanly express.」

#### コード/コマンド（原文のまま逐語）

生成とエスケープ：

```
let re1 = new RegExp("abc");
let re2 = /abc/;
```

```
let aPlus = /A\+/;
```

```
console.log(/abc/.test("abcde"));
// → true
console.log(/abc/.test("abxde"));
// → false
```

文字集合：

```
console.log(/[0123456789]/.test("in 1992"));
// → true
console.log(/[0-9]/.test("in 1992"));
// → true
```

```
let dateTime = /\d\d-\d\d-\d\d\d\d \d\d:\d\d/;
console.log(dateTime.test("01-30-2003 15:20"));
// → true
console.log(dateTime.test("30-jan-2003 15:20"));
// → false
```

```
let nonBinary = /[^01]/;
console.log(nonBinary.test("1100100010100110"));
// → false
console.log(nonBinary.test("0111010112101001"));
// → true
```

Unicode プロパティ：

```
console.log(/\p{L}/u.test("α"));
// → true
console.log(/\p{L}/u.test("!"));
// → false
console.log(/\p{Script=Greek}/u.test("α"));
// → true
console.log(/\p{Script=Arabic}/u.test("α"));
// → false
```

繰り返し：

```
console.log(/'\d+'/.test("'123'"));
// → true
console.log(/'\d+'/.test("''"));
// → false
console.log(/'\d*'/.test("'123'"));
// → true
console.log(/'\d*'/.test("''"));
// → true
```

```
let neighbor = /neighbou?r/;
console.log(neighbor.test("neighbour"));
// → true
console.log(neighbor.test("neighbor"));
// → true
```

```
let dateTime = /\d{1,2}-\d{1,2}-\d{4} \d{1,2}:\d{2}/;
console.log(dateTime.test("1-30-2003 8:45"));
// → true
```

```
let cartoonCrying = /boo+(hoo+)+/i;
console.log(cartoonCrying.test("Boohoooohoohooo"));
// → true
```

マッチとグループ：

```
let match = /\d+/.exec("one two 100");
console.log(match);
// → ["100"]
console.log(match.index);
// → 8
```

```
console.log("one two 100".match(/\d+/));
// → ["100"]
```

```
let quotedText = /'([^']*)'/;
console.log(quotedText.exec("she said 'hello'"));
// → ["'hello'", "hello"]
```

```
console.log(/bad(ly)?/.exec("bad"));
// → ["bad", undefined]
console.log(/(\d)+/.exec("123"));
// → ["123", "3"]
```

```
console.log(/(?:na)+/.exec("banana"));
// → ["nana"]
```

Date：

```
console.log(new Date());
// → Fri Feb 02 2024 18:03:06 GMT+0100 (CET)
```

```
console.log(new Date(2009, 11, 9));
// → Wed Dec 09 2009 00:00:00 GMT+0100 (CET)
console.log(new Date(2009, 11, 9, 12, 59, 59, 999));
// → Wed Dec 09 2009 12:59:59 GMT+0100 (CET)
```

```
console.log(new Date(2013, 11, 19).getTime());
// → 1387407600000
console.log(new Date(1387407600000));
// → Thu Dec 19 2013 00:00:00 GMT+0100 (CET)
```

```
function getDate(string) {
  let [_, month, day, year] =
    /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(string);
  return new Date(year, month - 1, day);
}
console.log(getDate("1-30-2003"));
// → Thu Jan 30 2003 00:00:00 GMT+0100 (CET)
```

look-ahead：

```
console.log(/a(?=e)/.exec("braeburn"));
// → ["a"]
console.log(/a(?! )/.exec("a b"));
// → null
```

選択パターン：

```
let animalCount = /\d+ (pig|cow|chicken)s?/;
console.log(animalCount.test("15 pigs"));
// → true
console.log(animalCount.test("15 pugs"));
// → false
```

バックトラック爆発する式（**ReDoS 教材**）：

```
/^([01]+b|[\da-f]+h|\d+)$/
```

```
/([01]+)+b/
```

replace：

```
console.log("papa".replace("p", "m"));
// → mapa
```

```
console.log("Borobudur".replace(/[ou]/, "a"));
// → Barobudur
console.log("Borobudur".replace(/[ou]/g, "a"));
// → Barabadar
```

```
console.log(
  "Liskov, Barbara\nMcCarthy, John\nMilner, Robin"
    .replace(/(\p{L}+), (\p{L}+)/gu, "$2 $1"));
// → Barbara Liskov
//   John McCarthy
//   Robin Milner
```

```
let stock = "1 lemon, 2 cabbages, and 101 eggs";
function minusOne(match, amount, unit) {
  amount = Number(amount) - 1;
  if (amount == 1) { // only one left, remove the 's'
    unit = unit.slice(0, unit.length - 1);
  } else if (amount == 0) {
    amount = "no";
  }
  return amount + " " + unit;
}
console.log(stock.replace(/(\d+) (\p{L}+)/gu, minusOne));
// → no lemon, 1 cabbage, and 100 eggs
```

greedy / non-greedy（コメント除去）：

```
function stripComments(code) {
  return code.replace(/\/\/.*|\/\*[^]*\*\//g, "");
}
console.log(stripComments("1 + /* 2 */3"));
// → 1 + 3
console.log(stripComments("x = 10;// ten!"));
// → x = 10;
console.log(stripComments("1 /* a */+/* b */ 1"));
// → 1  1
```

```
function stripComments(code) {
  return code.replace(/\/\/.*|\/\*[^]*?\*\//g, "");
}
console.log(stripComments("1 /* a */+/* b */ 1"));
// → 1 + 1
```

動的 RegExp 生成（**正規表現インジェクション対策の原型。エスケープ用文字クラスは逐語で重要**）：

```
let name = "harry";
let regexp = new RegExp("(^|\\s)" + name + "($|\\s)", "gi");
console.log(regexp.test("Harry is a dodgy character."));
// → true
```

```
let name = "dea+hl[]rd";
let escaped = name.replace(/[\\[.+*?(){|^$]/g, "\\$&");
let regexp = new RegExp("(^|\\s)" + escaped + "($|\\s)",
                        "gi");
let text = "This dea+hl[]rd guy is super annoying.";
console.log(regexp.test(text));
// → true
```

search：

```
console.log("  word".search(/\S/));
// → 2
console.log("    ".search(/\S/));
// → -1
```

lastIndex（**状態を持つ正規表現の罠**）：

```
let pattern = /y/g;
pattern.lastIndex = 3;
let match = pattern.exec("xyzzy");
console.log(match.index);
// → 4
console.log(pattern.lastIndex);
// → 5
```

```
let global = /abc/g;
console.log(global.exec("xyz abc"));
// → ["abc"]
let sticky = /abc/y;
console.log(sticky.exec("xyz abc"));
// → null
```

```
let digit = /\d/g;
console.log(digit.exec("here it is: 1"));
// → ["1"]
console.log(digit.exec("and now: 1"));
// → null
```

```
console.log("Banana".match(/an/g));
// → ["an", "an"]
```

```
let input = "A string with 3 numbers in it... 42 and 88.";
let matches = input.matchAll(/\d+/g);
for (let match of matches) {
  console.log("Found", match[0], "at", match.index);
}
// → Found 3 at 14
//   Found 42 at 33
//   Found 88 at 40
```

INI ファイル（原文 lang: "null"）：

```
searchengine=https://duckduckgo.com/?q=$1
spitefulness=9.7

; comments are preceded by a semicolon...
; each section concerns an individual enemy
[larry]
fullname=Larry Doe
type=kindergarten bully
website=http://www.geocities.com/CapeCanaveral/11451

[davaeorn]
fullname=Davaeorn
type=evil wizard
outputdir=/home/marijn/enemies/davaeorn
```

```
function parseINI(string) {
  // Start with an object to hold the top-level fields
  let result = {};
  let section = result;
  for (let line of string.split(/\r?\n/)) {
    let match;
    if (match = line.match(/^(\w+)=(.*)$/)) {
      section[match[1]] = match[2];
    } else if (match = line.match(/^\[(.*)\]$/)) {
      section = result[match[1]] = {};
    } else if (!/^\s*(;|$)/.test(line)) {
      throw new Error("Line '" + line + "' is not valid.");
    }
  };
  return result;
}

console.log(parseINI(`
name=Vasilis
[address]
city=Tessaloniki`));
// → {name: "Vasilis", address: {city: "Tessaloniki"}}
```

code unit と `u` フラグ：

```
console.log(/🍎{3}/.test("🍎🍎🍎"));
// → false
console.log(/<.>/.test("<🌹>"));
// → false
console.log(/<.>/u.test("<🌹>"));
// → true
```

```
console.log(/🍎{3}/u.test("🍎🍎🍎"));
// → true
```

---

### 第10章 Modules（出典: 10_modules.md）

章頭引用は Tef, "programming is terrible"：「Write code that is easy to delete, not easy to extend.」

#### モジュールが解く2つの問題

- 実際にはプログラムは有機的に成長する。よく構造化された状態を保つには絶え間ない注意と作業を要する。その作業は将来、**次に**誰かがそのプログラムで作業するときにしか報われないので、怠って各部が深く絡み合うのを許したくなる。
- これが2つの実務的問題を引き起こす。**第一に、絡み合ったシステムを理解するのは難しい。** すべてが他のすべてに触れられるなら、任意の部分を孤立して見るのが困難で、全体の全体的理解を構築せざるを得ない。**第二に、そうしたプログラムの機能を別の状況で使いたい場合、文脈から解きほぐそうとするより書き直すほうが簡単かもしれない。**
- 「**big ball of mud（大きな泥団子）**」という語句がそうした大きく構造のないプログラムにしばしば使われる。すべてがくっつき合い、一片を取り出そうとすると全体がばらばらになり、散らかすことにしか成功しない。
- **モジュール**は、自分が依存する他の部分と、他のモジュールが使うために提供する機能（その **interface**）を指定するプログラムの一片。
- モジュールインターフェースはオブジェクトインターフェース（第6章）と多くの共通点がある。モジュールの一部を外界に利用可能にし、残りを private に保つ。
- モジュールが他者に提供するインターフェースは話の半分にすぎない。**良いモジュールシステムは、モジュールが他のモジュールからどのコードを使うかも指定するよう要求する。この関係を dependencies（依存関係）と呼ぶ。** モジュール A がモジュール B の機能を使うなら、A は B に **depend** すると言われる。これらがモジュール自体に明確に指定されていると、あるモジュールを使えるようにするために他にどのモジュールが存在する必要があるかを把握し、依存関係を自動的にロードするのに使える。
- モジュールが互いに相互作用する方法が明示的になると、システムは **LEGO** に近づく（部品が明確に定義されたコネクタを通して相互作用する）。すべてがすべてと混ざる泥からは遠ざかる。

#### ES modules

- 元の JavaScript 言語にはモジュールの概念がなかった。**すべてのスクリプトが同じスコープで実行され、別のスクリプトで定義された関数へのアクセスはそのスクリプトが作ったグローバルバインディングを参照することで行われた。** これはコードの偶発的で見づらい絡み合いを積極的に促し、無関係なスクリプトが同じバインディング名を使おうとするような問題を招いた。
- **ECMAScript 2015 以降、JavaScript は2種類のプログラムをサポートする。** _Scripts_ は古い方法で振る舞う：バインディングはグローバルスコープで定義され、他のスクリプトを直接参照する方法がない。_Modules_ は**独自の別スコープ**を持ち、スクリプトでは利用できない `import` と `export` キーワードをサポートして依存関係とインターフェースを宣言する。このモジュールシステムは通常 **ES modules** と呼ばれる（_ES_ は ECMAScript）。
- `export` キーワードは関数・クラス・バインディング定義の前に置いて、そのバインディングがモジュールのインターフェースの一部であることを示す。
- `import` キーワードの後に波括弧でバインディング名のリストを続けると、別のモジュールのバインディングを現在のモジュールで利用可能にする。**モジュールは引用符付き文字列で識別される。**
- **モジュール名が実際のプログラムにどう解決されるかはプラットフォームによって異なる。ブラウザはそれらをウェブアドレスとして扱い、Node.js はファイルに解決する。** モジュールを実行すると、それが依存する他のすべてのモジュール——およびそれらが依存するモジュール——がロードされ、エクスポートされたバインディングがそれをインポートするモジュールに利用可能になる。
- **`import` / `export` 宣言は関数・ループ・その他のブロックの内側に現れられない。それらはモジュールがロードされたときに即座に解決され、モジュール内のコードがどう実行されるかに関係ない。これを反映して、それらは外側のモジュール本体にのみ現れなければならない。**
- インポートしたバインディングは名前の後に `as` を使って新しいローカル名にリネームできる。
- モジュールは **`default`** という名の特別なエクスポートを持てる。単一のバインディングだけをエクスポートするモジュールでしばしば使われる。式・関数宣言・クラス宣言の前に `export default` と書く。そうしたバインディングはインポート名の周りの波括弧を省略してインポートする。
- モジュールから全バインディングを同時にインポートするには **`import *`** を使う。名前を提供すると、その名前がモジュールの全エクスポートを保持するオブジェクトにバインドされる。

#### Packages と NPM

- プログラムを別々の部品から構築し、一部を単独で実行できることの利点の一つは、同じ部品を異なるプログラムで使えるかもしれないこと。
- 依存関係が明確なら（この場合なし）、モジュールを新プロジェクトにコピーして使える。**しかしコードにミスを見つけたら、おそらくその時作業しているプログラムでだけ修正して、もう一方のプログラムでも修正するのを忘れる。**
- コードを複製し始めると、コピーを動かして最新に保つことに時間とエネルギーを浪費していることに気づく。そこで **package** が登場する。パッケージは配布（コピーしてインストール）できるコードの塊。1つ以上のモジュールを含みうるし、どの他のパッケージに依存するかの情報を持つ。パッケージは通常、それが何をするかを説明するドキュメントも付いてきて、書いていない人でも使えるようにする。
- インフラが必要：パッケージを格納・発見する場所と、インストール・アップグレードの便利な方法。JavaScript 界ではこのインフラは **NPM**（https://npmjs.com）が提供する。
- **NPM は2つのもの**：パッケージをダウンロード（およびアップロード）できるオンラインサービスと、それらのインストール・管理を助けるプログラム（Node.js にバンドルされている）。
- **執筆時点で NPM には300万を超える（more than three million）異なるパッケージ**が利用可能。「A large portion of those are rubbish, to be fair.（公平に言えば、その大部分はゴミである。）」しかしほぼすべての有用で公開されている JavaScript パッケージは NPM で見つかる。
- 品質の良いパッケージがダウンロード可能であることは極めて価値がある。100人が以前に書いたプログラムを再発明するのを避け、数キー押すだけで堅固でよくテストされた実装を得られる。
- **ライセンス**：デフォルトでは自分が書いたコードの著作権は自分が持ち、他人は許可なしでは使えない。しかし一部の人は単に親切で、良いソフトウェアの公開はプログラマの間で少し有名になるのを助けるので、多くのパッケージは他人が使うことを明示的に許すライセンスの下で公開される。
- **NPM のほとんどのコードはこのようにライセンスされる。一部のライセンスは、そのパッケージの上に構築したコードも同じライセンスで公開することを要求する。他はより要求が少なく、配布時にコードとともにライセンスを保持することだけを要求する。JavaScript コミュニティはほとんど後者のタイプを使う。他人のパッケージを使うとき、そのライセンスを認識しているようにせよ。**

#### CommonJS modules

- 2015年以前、JavaScript 言語に組み込みモジュールシステムがなかった時代にも、人々は既に JavaScript で大きなシステムを構築していた。それを機能させるため、モジュールを**必要とした**。
- コミュニティは言語の上に独自の即席モジュールシステムを設計した。**関数を使ってモジュールのローカルスコープを作り、通常のオブジェクトを使ってモジュールインターフェースを表現する。**
- 当初、人々はモジュール全体を「**immediately invoked function expression（IIFE）**」で手動でラップしてモジュールのスコープを作り、インターフェースオブジェクトを単一のグローバル変数に代入した。
- このスタイルはある程度の **isolation** を提供するが、**依存関係を宣言しない**。代わりにインターフェースをグローバルスコープに置き、依存関係があれば同じことをすると期待する。これは理想的ではない。
- 独自のモジュールローダを実装すればもっとうまくやれる。**後付けの JavaScript モジュールへの最も広く使われたアプローチは CommonJS modules と呼ばれる。** Node.js は当初からこのモジュールシステムを使い（今では ES modules のロード方法も知っている）、NPM の多くのパッケージが使うモジュールシステムである。
- CommonJS モジュールは通常のスクリプトのように見えるが、他のモジュールと相互作用するために使う2つのバインディングにアクセスできる。**第1は `require` という関数**。依存関係のモジュール名で呼ぶと、モジュールがロードされたことを確認しそのインターフェースを返す。**第2は `exports` というオブジェクト**。モジュールのインターフェースオブジェクトで、空で始まりプロパティを追加してエクスポートする値を定義する。
- CommonJS は、モジュールをロードするときにそのコードを関数でラップし（独自のローカルスコープを与え）、`require` と `exports` バインディングをその関数に引数として渡すモジュールローダで実装される。
- **`Function` は引数リスト（カンマ区切り文字列）と関数本体を含む文字列を取り、それらの引数と本体を持つ関数値を返す組み込み JavaScript 関数。これは興味深い概念——プログラムが文字列データから新しいプログラムの断片を作れる——だが、危険な概念でもある。なぜなら、誰かが自分の提供する文字列をあなたのプログラムに `Function` に渡させることに成功したら、プログラムに彼らの望むことを何でもさせられるからである。**（＝これが本書における最も明確なコードインジェクションの警告。原文の索引タグも `{{index "Function constructor", eval, security}}`）
- 標準 JavaScript は `readFile` のような関数を提供しないが、ブラウザや Node.js のような異なる JavaScript 環境はファイルにアクセスする独自の方法を提供する。例は単に `readFile` が存在するふりをしている。
- 同じモジュールを複数回ロードしないため、`require` はロード済みモジュールのストア（**cache**）を保持する。呼ばれたとき、まず要求されたモジュールがロードされたかチェックし、そうでなければロードする。これはモジュールのコードを読み、関数でラップし、それを呼ぶことを含む。
- **ES modules との重要な違い：ES module のインポートはモジュールのスクリプトが実行を開始する前に起きるが、`require` は通常の関数で、モジュールが既に実行中に呼ばれる。`import` 宣言と違い、`require` 呼び出しは関数の内側に現れられ、依存関係の名前は文字列に評価される任意の式でよい。一方 `import` は素の引用符付き文字列のみを許す。**
- JavaScript コミュニティの CommonJS スタイルから ES modules への移行は遅く、やや荒っぽいものだった。「幸い、NPM の人気パッケージのほとんどがコードを ES modules として提供し、Node.js が ES modules から CommonJS モジュールをインポートすることを許す時点に今はいる。CommonJS コードはまだ遭遇するものだが、**このスタイルで新しいプログラムを書く本当の理由はもはやない。**」

#### Building and bundling（ソースマップ／リコン文脈で重要）

- **多くの JavaScript パッケージは技術的には JavaScript で書かれていない。** TypeScript（型チェック方言、第8章で言及）のような言語拡張が広く使われる。人々はまた、実際に JavaScript を実行するプラットフォームに追加されるずっと前から、計画中の新しい言語機能を使い始めることも多い。これを可能にするため、コードを **compile** する——選んだ JavaScript 方言から素の古い JavaScript、あるいは過去のバージョンの JavaScript に翻訳する——ブラウザが実行できるように。
- **200個の異なるファイルからなるモジュラープログラムをウェブページに含めると独自の問題を生む。** ネットワーク越しに単一ファイルを取得するのに50ミリ秒かかるなら、プログラム全体のロードには10秒かかる。複数ファイルを同時にロードできるならその半分くらいかもしれない。それは大量の無駄な時間。**単一の大きなファイルを取得するほうが多数の小さなファイルを取得するより速い傾向があるので、ウェブプログラマは（苦労してモジュールに分割した）プログラムを、ウェブに公開する前に単一の大きなファイルに結合するツールを使い始めた。そうしたツールを bundlers と呼ぶ。**
- さらに進める。ファイル数のほかに、ファイルの**サイズ**もネットワーク越しにどれだけ速く転送できるかを決める。そこで JavaScript コミュニティは **minifiers** を発明した。**これは JavaScript プログラムを取り、コメントと空白を自動的に削除し、バインディングをリネームし、コードの断片をより少ない空間を占める等価なコードに置き換えることでより小さくするツール。**
- **「NPM パッケージやウェブページで実行されるコードが、複数の変換段階を経ていることは珍しくない——モダン JavaScript から歴史的 JavaScript への変換、モジュールの単一ファイルへの結合、そしてコードの minify。」** 本書ではこれらのツールの詳細には立ち入らない（多数あり、人気のものが定期的に変わるため）。そうしたものが存在することを認識し、必要なときに調べよ。
- 〔補足（一般知識）〕この bundling + minification の連鎖が、JS リコンにおいて source map（`.map` ファイル）の探索や、バンドル内のモジュール境界復元が有効になる理由である。本書は source map には言及していない。

#### Module design

- プログラムの構造化はプログラミングのより微妙な側面の一つ。自明でない機能はどれも様々な方法で組織できる。
- **良いプログラム設計は主観的——トレードオフと趣味の問題が関わる。よく構造化された設計の価値を学ぶ最善の方法は、多くのプログラムを読むか作業して、何が機能し何が機能しないかに気づくこと。「痛々しい混乱が『ただそういうものだ』と仮定するな。もっと考えを注ぐことで、ほぼ何でも構造を改善できる。」**
- モジュール設計の一側面は**使いやすさ**。複数の人（あるいは3ヶ月後に自分がやったことの詳細を覚えていない自分自身）が使うことを意図したものを設計しているなら、インターフェースが単純で予測可能であることが有用。
- それは既存の慣習に従うことを意味しうる。良い例が `ini` パッケージ。このモジュールは標準の `JSON` オブジェクトを模倣して `parse` と `stringify`（INI ファイルを書く）関数を提供し、`JSON` のように文字列と素のオブジェクトの間を変換する。インターフェースは小さく馴染みがあり、一度作業すれば使い方を覚えている可能性が高い。
- 模倣する標準関数や広く使われるパッケージがなくても、**単純なデータ構造を使い、単一の焦点を絞ったことをすることでモジュールを予測可能に保てる。** NPM の INI ファイルパースモジュールの多くは、例えばハードディスクからそうしたファイルを直接読んでパースする関数を提供する。**これはブラウザ（直接のファイルシステムアクセスがない）でそうしたモジュールを使うことを不可能にし、モジュールをファイル読み込み関数と composing することでよりよく対処できたはずの複雑さを追加している。**
- これはモジュール設計のもう一つの有用な側面を指す——**他のコードと合成できる容易さ**。値を計算する焦点を絞ったモジュールは、副作用を伴う複雑なアクションを実行するより大きなモジュールより、より広い範囲のプログラムに適用できる。ディスクからファイルを読むことを主張する INI ファイルリーダは、ファイルの内容が他のソースから来るシナリオでは役に立たない。
- 関連して、**状態を持つオブジェクトは時に有用あるいは必要だが、関数でできることなら関数を使え。** NPM の INI ファイルリーダのいくつかは、まずオブジェクトを作り、次にファイルをオブジェクトにロードし、最後に専用メソッドで結果を得るというインターフェーススタイルを要求する。**「This type of thing is common in the object-oriented tradition, and it's terrible.」** 単一の関数呼び出しをして進む代わりに、オブジェクトを様々な状態を通して動かす儀式を実行しなければならない。そしてデータが今や専用のオブジェクト型にラップされているので、それと相互作用するすべてのコードがその型について知らなければならず、不要な相互依存を作る。
- **「配列で十分なときは配列を使え。」**
- 合成の障壁：様々なパッケージが似たものを記述するのに異なるデータ構造を使っていると、それらを組み合わせるのが難しい。**合成可能性を設計したいなら、他の人がどんなデータ構造を使っているかを調べ、可能なときはその例に従え。**
- 問題を探索中でどれが機能するか試している段階では、モジュール構造をあまり心配しなくてよい（すべてを整理し続けることは大きな気散じになりうる）。**堅固だと感じるものができたら、一歩下がって整理するのに良い時。**

#### コード/コマンド（原文のまま逐語）

ES modules：

```
const names = ["Sunday", "Monday", "Tuesday", "Wednesday",
               "Thursday", "Friday", "Saturday"];

export function dayName(number) {
  return names[number];
}
export function dayNumber(name) {
  return names.indexOf(name);
}
```

```
import {dayName} from "./dayname.js";
let now = new Date();
console.log(`Today is ${dayName(now.getDay())}`);
// → Today is Monday
```

```
import {dayName as nomDeJour} from "./dayname.js";
console.log(nomDeJour(3));
// → Wednesday
```

```
export default ["Winter", "Spring", "Summer", "Autumn"];
```

```
import seasonNames from "./seasonname.js";
```

```
import * as dayName from "./dayname.js";
console.log(dayName.dayName(3));
// → Wednesday
```

NPM の ini パッケージ：

```
import {parse} from "ini";

console.log(parse("x = 10\ny = 20"));
// → {x: "10", y: "20"}
```

IIFE スタイル：

```
const weekDay = function() {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday",
                 "Thursday", "Friday", "Saturday"];
  return {
    name(number) { return names[number]; },
    number(name) { return names.indexOf(name); }
  };
}();

console.log(weekDay.name(weekDay.number("Sunday")));
// → Sunday
```

CommonJS：

```
const ordinal = require("ordinal");
const {days, months} = require("date-names");

exports.formatDate = function(date, format) {
  return format.replace(/YYYY|M(MMM)?|Do?|dddd/g, tag => {
    if (tag == "YYYY") return date.getFullYear();
    if (tag == "M") return date.getMonth();
    if (tag == "MMMM") return months[date.getMonth()];
    if (tag == "D") return date.getDate();
    if (tag == "Do") return ordinal(date.getDate());
    if (tag == "dddd") return days[date.getDay()];
  });
};
```

```
const {formatDate} = require("./format-date.js");

console.log(formatDate(new Date(2017, 9, 13),
                       "dddd the Do"));
// → Friday the 13th
```

簡略化した `require` の実装（**`Function` コンストラクタによる文字列→コード化の実例**）：

```
function require(name) {
  if (!(name in require.cache)) {
    let code = readFile(name);
    let exports = require.cache[name] = {};
    let wrapper = Function("require, exports", code);
    wrapper(require, exports);
  }
  return require.cache[name];
}
require.cache = Object.create(null);
```

dijkstrajs との合成：

```
const {find_path} = require("dijkstrajs");

let graph = {};
for (let node of Object.keys(roadGraph)) {
  let edges = graph[node] = {};
  for (let dest of roadGraph[node]) {
    edges[dest] = 1;
  }
}

console.log(find_path(graph, "Post Office", "Cabin"));
// → ["Post Office", "Alice's House", "Cabin"]
```

---

### 第11章 Asynchronous Programming（出典: 11_async.md）

章頭引用は Laozi, "Tao Te Ching"：「Who can wait quietly while the mud settles? / Who can remain still until the moment of action?」

#### 同期と非同期

- **synchronous** モデルでは物事が一度に一つ起きる。長時間実行されるアクションを行う関数を呼ぶと、そのアクションが終わって結果を返せるときにだけ返る。これはアクションにかかる時間だけプログラムを止める。
- **asynchronous** モデルは複数のことが同時に起きることを許す。アクションを開始するとプログラムは実行を続ける。アクションが終わるとプログラムに知らされ結果にアクセスできる。
- 同期システムでこの問題（2つのネットワーク要求を出して結果を結合する）を解く方法は、追加の**thread** を開始すること。thread は別の実行中のプログラムで、その実行は OS により他のプログラムとインターリーブされうる。ほとんどの現代コンピュータは複数のプロセッサを含むので、複数の thread が実際に同時に異なるプロセッサで動くこともある。
- 別の言い方：**アクションの終了を待つことが同期モデルでは implicit（暗黙）で、非同期モデルでは explicit（明示的）＝我々の制御下にある。**
- 「非同期性は両刃の剣。制御の直線モデルに合わないプログラムの表現を容易にするが、直線に従うプログラムの表現をより不器用にもする。」
- **JavaScript の2つの主要プラットフォーム——ブラウザと Node.js——はどちらも、時間がかかりうる操作を thread に頼るのではなく非同期にする。thread によるプログラミングは悪名高く難しい（複数のことを同時にしているとプログラムが何をするかを理解するのがずっと難しい）ので、これは一般に良いことと考えられる。**

#### コールバック

- 非同期プログラミングへの一つのアプローチは、何かを待つ必要のある関数に追加引数（**callback function**）を取らせること。非同期関数はプロセスを開始し、プロセス終了時にコールバック関数が呼ばれるよう設定し、そして返る。
- `setTimeout` は Node.js とブラウザ両方で利用可能で、指定ミリ秒待ってから関数を呼ぶ。
- **コールバックを使って複数の非同期アクションを連続して実行すると、アクション後の計算の continuation を扱う新しい関数を渡し続けなければならない。** インデントレベルが各非同期アクションごとに増える（別の関数の中に入るので）。非同期アクションをループでラップするようなより複雑なことをするのは不器用になりうる。
- **「ある意味で、非同期性は contagious（感染性）である。非同期に動作する関数を呼ぶ関数はそれ自体が非同期でなければならず、結果を届けるのにコールバックや類似の機構を使う。コールバックを呼ぶことは単に値を返すよりやや複雑でエラーを起こしやすいので、プログラムの大部分をそのように構造化する必要があるのは良くない。」**

#### Promise

- 非同期プログラムを構築するやや異なる方法は、非同期関数がコールバック関数を渡し回す代わりに、その（将来の）結果を表すオブジェクトを返すこと。
- **promise は、まだ利用可能でないかもしれない値を表す receipt（受領書）。** 待っているアクションが終わったときに呼ばれるべき関数を登録できる `then` メソッドを提供する。promise が **resolved**（値が利用可能になる）とき、そうした関数（複数ありうる）が結果値で呼ばれる。**既に resolve された promise に `then` を呼ぶことも可能——関数はやはり呼ばれる。**
- promise を作る最も簡単な方法は **`Promise.resolve`**。与えた値が promise でラップされることを保証する。既に promise ならそのまま返る。そうでなければ、その値を結果として即座に resolve する新しい promise を得る。
- 即座に resolve しない promise を作るには `Promise` をコンストラクタとして使える。**「やや奇妙なインターフェース」**：コンストラクタは引数として関数を期待し、それを即座に呼び、promise を resolve するために使える関数を渡す。
- `then` メソッドの有用な点は、**それ自体が別の promise を返す**こと。これはコールバック関数が返す値に resolve するか、返された値が promise ならその promise が resolve する値に resolve する。**だから複数の `then` 呼び出しを「chain」して非同期アクションの列を設定できる。**
- **「一般に、promise は『値がいつ到着するか』という問いをコードが無視できるようにする装置と考えると有用。通常の値は参照できる前に実際に存在しなければならない。promise された値は、既にそこにあるかもしれないし、将来のある時点に現れるかもしれない値である。promise で定義された計算は、`then` 呼び出しで配線することで、入力が利用可能になるにつれ非同期に実行される。」**

#### 失敗（rejection）

- **コールバックスタイルの最も切迫した問題の一つは、失敗がコールバックに適切に報告されることを保証するのが極めて困難なこと。**
- 一般的な慣習：**コールバックの第1引数でアクションの失敗を示し、第2引数で成功時にアクションが生成した値を渡す。** そうしたコールバック関数は常に例外を受け取ったかをチェックし、自分が呼ぶ関数が投げる例外を含め、自分が引き起こす問題が捕まえられて正しい関数に渡されることを保証しなければならない。
- Promise はこれを容易にする。**resolved**（アクションが成功裏に終了）または **rejected**（失敗）のいずれかになれる。resolve ハンドラ（`then` で登録）はアクションが成功したときだけ呼ばれ、**rejection は `then` が返す新しい promise に伝播する。** ハンドラが例外を投げると、自動的にその `then` 呼び出しが生成した promise が reject される。**非同期アクションの連鎖の任意の要素が失敗すると、連鎖全体の結果が rejected とマークされ、失敗した箇所より先の成功ハンドラは呼ばれない。**
- promise の resolve が値を提供するのと同様、reject も値を提供し、通常 rejection の **reason** と呼ばれる。ハンドラ関数内の例外が rejection を引き起こしたときは、その例外値が reason として使われる。同様に、ハンドラが reject された promise を返すと、その rejection が次の promise に流れる。**`Promise.reject`** 関数は新しい、即座に reject された promise を作る。
- **`catch`** メソッドは promise が reject されたときに呼ばれるハンドラを登録する。`then` と同様に新しい promise を返し、元の promise が正常に resolve したときはその値に、そうでなければ `catch` ハンドラの結果に resolve する。**`catch` ハンドラがエラーを投げると、新しい promise も reject される。**
- 短縮形として、`then` は第2引数として rejection ハンドラも受け取るので、単一のメソッド呼び出しで両方のハンドラをインストールできる：**`.then(acceptHandler, rejectHandler)`**。
- `Promise` コンストラクタに渡される関数は resolve 関数と並んで第2引数を受け取り、新しい promise を reject するのに使える。
- 「`then` と `catch` への呼び出しで作られた promise 値の連鎖は、非同期の値または失敗が移動するパイプラインを形成する。そうした連鎖はハンドラの登録で作られるので、各リンクは成功ハンドラまたは rejection ハンドラ（または両方）を関連付けている。**結果の型（成功または失敗）に一致しないハンドラは無視される。一致するハンドラが呼ばれ、その結果が次に来る値の種類を決める——非promise値を返せば成功、例外を投げれば rejection、promise を返せばその promise の結果。**」
- **未捕捉の例外が環境によって処理されるのと同様、JavaScript 環境は promise の rejection が処理されないことを検出し、これをエラーとして報告できる。**

#### Carla の passcode クラッキング（タイミングサイドチャネルの教材として極めて有用）

本書はカラスの Carla というキャラクターを使い、**タイミング差分を使った認証バイパス**を非同期プログラミングの題材にしている。**これは本書中で最も「脆弱性ハンティング」に近い記述**なので、教科書での引用価値が高い。

- 建物のワイヤレスルータは **20年前のもので、貧弱に保護されている**。Carla は**ネットワーク認証機構に使える欠陥**を見つける。
- ネットワーク参加時、デバイスは正しい**6桁のパスコード**を送らなければならない。アクセスポイントは正しいコードが提供されたかどうかに応じて成功または失敗メッセージを返す。
- **しかし、部分的なコード（例えば3桁だけ）を送ったとき、それらの桁がコードの正しい先頭かどうかで応答が異なる。間違った数字を送ると即座に失敗メッセージを返す。正しいものを送ると、アクセスポイントはさらに桁を待つ。**
- **これにより数の推測を大幅に高速化できる。** Carla は各数字を順に試し、即座に失敗を返さないものを見つけることで第1桁を見つけられる。1桁得たら、同じ方法で第2桁を見つけ、以下パスコード全体が分かるまで続ける。
- 〔補足（一般知識）〕この構造＝**応答時間の差が秘密の prefix 一致長を漏らす**は、タイミング攻撃／オラクルの典型であり、クライアントサイドでも「早期 return する比較」「文字単位のバリデーション」などで現れる。本書は「timing attack」「side channel」「oracle」という語は使っていない。
- `withTimeout` は「**promise は一度だけ resolve または reject できる**」という事実を利用する。引数の promise が先に resolve/reject すればそれが `withTimeout` が返す promise の結果になる。逆に `setTimeout` が先に発火して promise を reject すれば、それ以降の resolve/reject 呼び出しは無視される。
- **`for` ループの内側で promise を待てないので、Carla は再帰関数でこのプロセスを駆動する。**
- **アクセスポイントは不正な認証要求に約20ミリ秒で応答する傾向があるので、安全のためこの関数は要求をタイムアウトさせる前に50ミリ秒待つ。** 結果は `555555`。「Carla は首を傾げてため息をつく。コードがもう少し推測しにくかったらもっと満足感があっただろうに。」

#### async 関数

- promise があっても、この種の非同期コードは書くのが煩わしい。promise はしばしば冗長で任意に見える方法で結び付ける必要がある。非同期ループを作るため、Carla は再帰関数を導入せざるを得なかった。
- **JavaScript は非同期計算を記述する擬似同期コードを書けるようにする。`async` 関数は暗黙に promise を返し、その本体で他の promise を `await` でき、それが同期のように**見える**。**
- `async` 関数は `function` キーワードの前に `async` という語でマークされる。メソッドも名前の前に `async` を書いて async にできる。**そうした関数やメソッドが呼ばれると promise を返す。関数が何かを返した途端、その promise が resolve される。本体が例外を投げれば promise は reject される。**
- `async` 関数の内側で、`await` を式の前に置いて promise が resolve するのを待ち、それからのみ関数の実行を続ける。**promise が reject すると、`await` の箇所で例外が発生する。**
- **「そうした関数はもはや通常の JavaScript 関数のように開始から完了まで一気に実行されない。代わりに、`await` を持つ任意の点で frozen（凍結）され、後の時点で再開されうる。」**
- 「ほとんどの非同期コードでは、この記法は promise を直接使うより便利。**それでも promise の理解は必要**で、多くの場合は依然として直接それらと相互作用する。しかし配線するときは、`async` 関数のほうが `then` 呼び出しの連鎖より一般に書いて気持ちがよい。」

#### Generators

- 関数が一時停止して再開されるこの能力は `async` 関数だけのものではない。JavaScript は **generator** 関数という機能も持つ。似ているが promise がない。
- `function*` で関数を定義すると（`function` の後にアスタリスクを置く）generator になる。**generator を呼ぶと iterator を返す**（第6章で見たもの）。
- 最初に `powers` を呼んだとき、関数は開始位置で凍結される。iterator に `next` を呼ぶたび、関数は `yield` 式に当たるまで実行され、それが関数を一時停止し、yield された値が iterator が生成する次の値になる。関数が return すると（例のものは決してしない）iterator は done になる。
- **「iterator を書くのは generator 関数を使うとしばしばずっと簡単になる。」** iteration state を保持するオブジェクトを作る必要がもうない——**generator は yield するたびに自動的にローカル状態を保存する**。
- **そうした `yield` 式は generator 関数自体の直接の内側にのみ現れられ、その内側で定義した内部関数には現れられない。generator が yield 時に保存する状態は、そのローカル環境と yield した位置だけ。**
- **`async` 関数は特殊な種類の generator。** 呼ばれると promise を生成し、return（終了）すると resolve され、例外を投げると reject される。**promise を yield（await）するたび、その promise の結果（値または投げられた例外）が `await` 式の結果になる。**

#### Corvid Art Project（ネットワークスキャンの教材）

- LedTec **SIG-5030** という型番の、プログラム可能な amber LED マトリクスの交通標識。**ワイヤレスネットワーク越しにプログラムできる。**
- ネットワーク上の各デバイスは **IP address** を得る。Carla は自分の電話がすべて `10.0.0.20` や `10.0.0.33` のようなアドレスを得ていることに気づく。**そうした全アドレスにメッセージを送って、標識のマニュアルに記述されたインターフェースに応答するものがあるか見てみる価値があるかもしれない。**
- マニュアルによると、SIG-5030 標識の表示を変えるには `{"command": "display", "data": [0, 0, 3, …]}` のような内容のメッセージを送る。`data` は LED ドット1つあたり1つの数を保持し、その明るさを提供する——**0 は消灯、3 は最大輝度。各標識は幅50ライト・高さ30ライトなので、更新コマンドは 1,500 個の数を送る。**
- **IP アドレスの各数は 0 から 255 まで。** このコードはローカルネットワークの全アドレスに表示更新メッセージを送って何が引っかかるか見る。送るデータでは、ネットワークアドレスの最後の数に対応する数のライトを点灯させる。
- **これらのアドレスのほとんどは存在しないかそうしたメッセージを受け付けないので、`catch` 呼び出しはネットワークエラーがプログラムをクラッシュさせないことを保証する。要求はすべて他の要求の終了を待たずに即座に送出され、一部のマシンが答えないときに時間を浪費しないようにする。**
- 結果：9つの標識（縦3×横3）が全て応答。アドレスは `screenAddresses` に記録された9個。
- **`Promise.all`** は promise の配列を、結果の配列に resolve する単一の promise に変換する静的メソッド。**複数の非同期アクションを並行して起こし、すべての終了を待ち、それから結果で何かをする（あるいは少なくとも失敗しないことを確認するため終了を待つ）便利な方法を提供する。**
- 「標識の壁が立っていた一週間、毎晩、暗くなると巨大な輝くオレンジの鳥が神秘的にそこに現れた。」

#### イベントループ

- 非同期プログラムはメインスクリプトの実行で始まり、それはしばしば後で呼ばれるコールバックを設定する。**そのメインスクリプトとコールバックは、一続きで中断されずに完了まで実行される。しかしそれらの間で、プログラムは何かが起きるのを待って idle で座っていることがある。**
- **コールバックはそれをスケジュールしたコードによって直接呼ばれない。** 関数の中から `setTimeout` を呼べば、コールバック関数が呼ばれる時点でその関数は既に return している。そしてコールバックが return するとき、制御はそれをスケジュールした関数に戻らない。
- **「非同期の振る舞いは、それ自身の空の関数 call stack 上で起きる。これは promise なしでは非同期コードをまたいで例外を管理するのがとても難しい理由の一つ。各コールバックはほぼ空のスタックで始まるので、`catch` ハンドラは例外を投げるときスタック上にいない。」**（逐語コードあり：`try { setTimeout(() => { throw new Error("Woosh"); }, 20); } catch (e) { ... }` は捕まえられない）
- **「イベント——タイムアウトや到着する要求など——がどれだけ密接に起きても、JavaScript 環境は一度に一つのプログラムだけを実行する。」** プログラムの**周りに**大きなループが回っていると考えられ、これを **event loop** と呼ぶ。することがないときそのループは一時停止する。しかしイベントが入ってくると、それらはキューに追加され、コードが次々に実行される。**2つのことが同時に実行されないので、遅く実行されるコードが他のイベントの処理を遅延させうる。**
- **promise は常に新しいイベントとして resolve/reject する。promise が既に resolve されていても、それを待つとコールバックは即座ではなく現在のスクリプトが終了した後に実行される。**（逐語：`Promise.resolve("Done").then(console.log); console.log("Me first!");` → `Me first!` → `Done`）

#### 非同期バグ（非同期ギャップ＝レース条件の原型）

- プログラムが同期的に一続きで実行されるとき、プログラム自身が行う以外の状態変化は起きない。**非同期プログラムでは違う——実行中に他のコードが実行できる gaps（隙間）がありうる。**
- `fileSizes` の例：`+=` 演算子が問題。**`+=` は文の実行が始まった時点の `list` の**現在の**値を取り、`await` が終わったときに `list` バインディングをその値＋追加された文字列に設定する。**
- **「しかし文の実行開始時から終了時までの間に非同期ギャップがある。`map` 式はリストに何も追加される前に実行されるので、各 `+=` 演算子は空文字列から始まり、そのストレージ取得が終わったとき `list` を『自分の行を空文字列に足した結果』に設定してしまう。」** 結果、**常に1行だけ（最も読み込みに時間がかかったファイル）が出力される。**
- これは、バインディングを変更してリストを構築する代わりに、マップされた promise から行を返し `Promise.all` の結果に `join` を呼ぶことで容易に避けられた。**「いつものように、新しい値を計算することは既存の値を変更するよりエラーが起きにくい。」**
- **「このようなミスは、とくに `await` を使うときに犯しやすく、コードのどこにギャップがあるかを認識しているべきである。JavaScript の explicit な非同期性（コールバック、promise、`await` のいずれを通してでも）の利点は、これらのギャップを見つけるのが比較的容易なこと。」**

#### コード/コマンド（原文のまま逐語）

コールバック：

```
setTimeout(() => console.log("Tick"), 500);
```

```
readTextFile("shopping_list.txt", content => {
  console.log(`Shopping List:\n${content}`);
});
// → Shopping List:
// → Peanut butter
// → Bananas
```

```
function compareFiles(fileA, fileB, callback) {
  readTextFile(fileA, contentA => {
    readTextFile(fileB, contentB => {
      callback(contentA == contentB);
    });
  });
}
```

Promise：

```
let fifteen = Promise.resolve(15);
fifteen.then(value => console.log(`Got ${value}`));
// → Got 15
```

```
function textFile(filename) {
  return new Promise(resolve => {
    readTextFile(filename, text => resolve(text));
  });
}

textFile("plans.txt").then(console.log);
```

```
function randomFile(listFile) {
  return textFile(listFile)
    .then(content => content.trim().split("\n"))
    .then(ls => ls[Math.floor(Math.random() * ls.length)])
    .then(filename => textFile(filename));
}
```

```
function jsonFile(filename) {
  return textFile(filename).then(JSON.parse);
}

jsonFile("package.json").then(console.log);
```

エラーファーストコールバック規約：

```
someAsyncFunction((error, value) => {
  if (error) handleError(error);
  else processValue(value);
});
```

```
function textFile(filename) {
  return new Promise((resolve, reject) => {
    readTextFile(filename, (text, error) => {
      if (error) reject(error);
      else resolve(text);
    });
  });
}
```

rejection パイプライン：

```
new Promise((_, reject) => reject(new Error("Fail")))
  .then(value => console.log("Handler 1:", value))
  .catch(reason => {
    console.log("Caught failure " + reason);
    return "nothing";
  })
  .then(value => console.log("Handler 2:", value));
// → Caught failure Error: Fail
// → Handler 2: nothing
```

タイミング差分によるパスコードクラッキング（**promise版**）：

```
function withTimeout(promise, time) {
  return new Promise((resolve, reject) => {
    promise.then(resolve, reject);
    setTimeout(() => reject("Timed out"), time);
  });
}
```

```
function crackPasscode(networkID) {
  function nextDigit(code, digit) {
    let newCode = code + digit;
    return withTimeout(joinWifi(networkID, newCode), 50)
      .then(() => newCode)
      .catch(failure => {
        if (failure == "Timed out") {
          return nextDigit(newCode, 0);
        } else if (digit < 9) {
          return nextDigit(code, digit + 1);
        } else {
          throw failure;
        }
      });
  }
  return nextDigit("", 0);
}
```

```
crackPasscode("HANGAR 2").then(console.log);
// → 555555
```

同じものの **async/await 版**：

```
async function crackPasscode(networkID) {
  for (let code = "";;) {
    for (let digit = 0;; digit++) {
      let newCode = code + digit;
      try {
        await withTimeout(joinWifi(networkID, newCode), 50);
        return newCode;
      } catch (failure) {
        if (failure == "Timed out") {
          code = newCode;
          break;
        } else if (digit == 9) {
          throw failure;
        }
      }
    }
  }
}
```

Generators：

```
function* powers(n) {
  for (let current = n;; current *= n) {
    yield current;
  }
}

for (let power of powers(3)) {
  if (power > 50) break;
  console.log(power);
}
// → 3
// → 9
// → 27
```

```
Group.prototype[Symbol.iterator] = function*() {
  for (let i = 0; i < this.members.length; i++) {
    yield this.members[i];
  }
};
```

ネットワークスキャン（**全アドレスへの並行リクエスト**）：

```
for (let addr = 1; addr < 256; addr++) {
  let data = [];
  for (let n = 0; n < 1500; n++) {
    data.push(n < addr ? 3 : 0);
  }
  let ip = `10.0.0.${addr}`;
  request(ip, {command: "display", data})
    .then(() => console.log(`Request to ${ip} accepted`))
    .catch(() => {});
}
```

```
const screenAddresses = [
  "10.0.0.44", "10.0.0.45", "10.0.0.41",
  "10.0.0.31", "10.0.0.40", "10.0.0.42",
  "10.0.0.48", "10.0.0.47", "10.0.0.46"
];
```

`Promise.all`：

```
function displayFrame(frame) {
  return Promise.all(frame.map((data, i) => {
    return request(screenAddresses[i], {
      command: "display",
      data
    });
  }));
}
```

```
function wait(time) {
  return new Promise(accept => setTimeout(accept, time));
}

class VideoPlayer {
  constructor(frames, frameTime) {
    this.frames = frames;
    this.frameTime = frameTime;
    this.stopped = true;
  }

  async play() {
    this.stopped = false;
    for (let i = 0; !this.stopped; i++) {
      let nextFrame = wait(this.frameTime);
      await displayFrame(this.frames[i % this.frames.length]);
      await nextFrame;
    }
  }

  stop() {
    this.stopped = true;
  }
}
```

```
let video = new VideoPlayer(clipImages, 100);
video.play().catch(e => {
  console.log("Playback failed: " + e);
});
setTimeout(() => video.stop(), 15000);
```

イベントループと例外：

```
try {
  setTimeout(() => {
    throw new Error("Woosh");
  }, 20);
} catch (e) {
  // This will not run
  console.log("Caught", e);
}
```

```
let start = Date.now();
setTimeout(() => {
  console.log("Timeout ran at", Date.now() - start);
}, 20);
while (Date.now() < start + 50) {}
console.log("Wasted time until", Date.now() - start);
// → Wasted time until 50
// → Timeout ran at 55
```

```
Promise.resolve("Done").then(console.log);
console.log("Me first!");
// → Me first!
// → Done
```

非同期ギャップによる壊れたコード（**レース条件の教材**）：

```
async function fileSizes(files) {
  let list = "";
  await Promise.all(files.map(async fileName => {
    list += fileName + ": " +
      (await textFile(fileName)).length + "\n";
  }));
  return list;
}
```

修正版：

```
async function fileSizes(files) {
  let lines = files.map(async fileName => {
    return fileName + ": " +
      (await textFile(fileName)).length;
  });
  return (await Promise.all(lines)).join("\n");
}
```
