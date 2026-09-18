# Eloquent JavaScript で学ぶ土台技術（後編）：正規表現・モジュール・非同期

> **この節で分かること**
> - 正規表現のバックトラッキングが指数時間に爆発する仕組みを説明でき、ReDoS（正規表現によるサービス妨害）の原理を自分の言葉で語れる
> - 動的に組み立てる正規表現でメタ文字をエスケープする理由と、原典どおりのエスケープコードを説明できる
> - `Function` コンストラクタや `eval` が「文字列をコードに変える」ことの危険を説明でき、モジュールシステムがどこでそれを使うか指摘できる
> - Promise・async/await・イベントループの仕組みを説明でき、「非同期ギャップ」がレース条件（競合状態）を生む場所を指摘できる
> - パスコードの応答時間差から秘密を1桁ずつ漏らすタイミングサイドチャネルの構造を説明できる

**元資料**: https://eloquentjavascript.net/ （原典は取得できず二次情報ベース。ただし本文は著者マラインの公式ソースリポジトリ https://github.com/marijnh/Eloquent-JavaScript の第9〜11章 Markdown 原稿から完全取得しており、内容は原典そのものである）
**関連する節**: 「Eloquent JavaScript で学ぶ土台技術（前編）：値・関数・データ・オブジェクト・エラー処理」（同じ書籍の第1〜8章を扱う前半パート）

---

## 0. この節の位置づけ

この節は名著『Eloquent JavaScript 第4版』（Marijn Haverbeke 著）を材料に、クライアントサイドの脆弱性を探すための「言語の土台」を身につける後編である。前編（第1〜8章）に続き、ここでは**第9章 正規表現（Regular Expressions）**、**第10章 モジュール（Modules）**、**第11章 非同期プログラミング（Asynchronous Programming）**を扱う。

〔補足〕まず大事な前提を1つ。Eloquent JavaScript は「XSS」「CSRF」といった攻撃名を教える本ではない。実際、本書全文を検索しても `XSS` / `CSRF` / `CORS` / `Same-Origin Policy` / `Content Security Policy` という語は一度も出てこない。これは弱点ではなく設計である。本書は**「攻撃名」ではなく「攻撃が成立する土台＝言語とブラウザの正確な挙動」を教える本**なのだ。だからこの節でも、攻撃名を暗記するのではなく、「ここでバグが生まれる」という**設計の急所**を1つずつ押さえていく。

本書の著者は言語そのものについて厳しい評を残している。「JavaScript は許容範囲がばかばかしいほど寛容（ridiculously liberal in what it allows）。この設計の背後にある考えは初心者に易しくすることだったが、実際にはシステムが問題を指摘してくれないため、プログラムの問題を見つけるのを難しくしているだけ」。この「システムが問題を指摘してくれない」という性質こそ、脆弱性が静かに紛れ込む温床である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Eloquent JavaScript 第4版（オンライン版トップ／コードサンドボックス） — https://eloquentjavascript.net/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト本体がエージェントプロキシの組織ポリシーで遮断され 403 応答となった）。以下の記述は著者公式リポジトリの Markdown 原稿にもとづく要約であり、内容は原典と一致するが、「ブラウザ上で動くインタラクティブなコード実行」だけは体験できていない。
> **読みどころ**:
> 1. 各章末のコード例は、サイト上で実際に編集・実行できる。とくに正規表現の例（`/([01]+)+b/` のような爆発する式）を短い入力で試し、入力を伸ばすとブラウザが固まる瞬間を体感すること。ReDoS の危険を「頭で分かる」から「手で分かる」に変える。
> 2. サイトの `/code` にある章別サンドボックスから、章ごとに必要な全スクリプトとデータの ZIP をダウンロードできる。第11章の非同期例を手元で動かすのに使う。
> **代替手段**: 著者公式リポジトリ https://github.com/marijnh/Eloquent-JavaScript に全章の Markdown 原稿とコードがあり、無料で読める。翻訳版へのリンクも README にある。

---

## 1. 正規表現とは何か、なぜ危ういのか

### 正規表現の位置づけ

正規表現（Regular Expression, regexp）とは、**文字列のパターンを1行のミニ言語で記述し、そのパターンに一致する部分を検査・抽出・置換する道具**のこと。たとえば「数字が1つ以上並んだところ」を `/\d+/` と書く、といった具合だ。

本書は正規表現を「ひどく不器用（terribly awkward）でありながら極めて有用」と評する。構文は難解で、JavaScript が提供するインターフェースも不器用だ。だが文字列の検査と処理においては強力で、Web のあちこちで使われている。入力バリデーション（入力値の妥当性検査）、URL の解析、ログの抽出——どれも正規表現の出番だ。

第9章の章頭には有名な警句が引かれている。「Some people, when confronted with a problem, think 'I know, I'll use regular expressions.' Now they have two problems.（問題に直面した人が『正規表現を使おう』と思う。すると彼は2つの問題を抱えることになる）」。この「2つ目の問題」の中に、実は**脆弱性**が潜んでいる。

### 診断者が正規表現に注目すべき理由

脆弱性ハンティングで正規表現が重要なのは、次の3点で「静かに壊れる」からである。

1. **ReDoS**: 書き方を誤ると、短い入力でも処理が指数時間に爆発し、タブやサーバを固められる（本節2章）。
2. **正規表現インジェクション**: ユーザー入力をそのまま正規表現に埋め込むと、入力がパターンを乗っ取る（本節4章）。
3. **状態を持つ罠**: `g`（global）や `y`（sticky）フラグ付きの正規表現は `lastIndex` という内部状態を持ち、使い回すと検査が誤って通ったり漏れたりする（本節5章）。

まずは正規表現の「読み方」の最小限を押さえ、それから急所へ進む。

### 2つの記法とエスケープの差

正規表現はオブジェクトの一種で、作り方が2通りある。

```javascript
let re1 = new RegExp("abc");
let re2 = /abc/;
```

`re1` は `RegExp` コンストラクタに**文字列**を渡す書き方。`re2` はスラッシュ `/` で囲む**リテラル**の書き方。この2つはバックスラッシュ（`\`）の扱いが違い、これが後で述べるインジェクション対策の核心になる。

- `RegExp` コンストラクタに渡す文字列では、**通常の文字列のバックスラッシュ規則**が適用される。つまり `\s`（空白）を文字列で書くには `"\\s"` と二重にする必要がある。
- スラッシュ記法では、特殊文字コード（`\n` など）でないバックスラッシュは**保存され**、パターンの意味を変える。また前方スラッシュ自体をパターンに含めたいときは `\/` とエスケープする。

疑問符 `?` やプラス `+` のような文字は正規表現で特別な意味を持つ。その文字自体を表したいなら、前にバックスラッシュを置く。

```javascript
let aPlus = /A\+/;
```

これは「大文字 A の後ろにプラス記号」というパターンだ。`\+` としないと `+` は「直前の要素の1回以上の繰り返し」という演算子になってしまう。

### 一致するかどうかを調べる

`test` メソッドは、一致したかどうかを真偽値で返す最も単純な方法だ。

```javascript
console.log(/abc/.test("abcde"));
// → true
console.log(/abc/.test("abxde"));
// → false
```

パターン `/abc/` は文字列の**どこかに** `abc` が含まれていれば `true` になる。先頭・末尾を固定したいときは後述の `^` `$` を使う。

## 2. 文字集合・繰り返し・グループ

### 文字集合と範囲

角括弧 `[ ]` で囲むと、その中のいずれか1文字に一致する。

```javascript
console.log(/[0123456789]/.test("in 1992"));
// → true
console.log(/[0-9]/.test("in 1992"));
// → true
```

角括弧内のハイフン `-` は**範囲**を示す。順序は文字の Unicode 番号で決まり、数字の `0`〜`9` は Unicode コードの 48〜57 に隣接して並んでいるので `[0-9]` で全数字をカバーできる。

```javascript
let dateTime = /\d\d-\d\d-\d\d\d\d \d\d:\d\d/;
console.log(dateTime.test("01-30-2003 15:20"));
// → true
console.log(dateTime.test("30-jan-2003 15:20"));
// → false
```

`\d` は「任意の数字」を表す短縮記法だ。バックスラッシュで始まる文字クラスは次のようにまとまっている。

| パターン | 意味 |
|---|---|
| `\d` | Any digit character（任意の数字） |
| `\w` | An alphanumeric character（英数字＝"word character"） |
| `\s` | Any whitespace character（空白・タブ・改行など） |
| `\D` | A character that is _not_ a digit（数字以外） |
| `\W` | A nonalphanumeric character（英数字以外） |
| `\S` | A nonwhitespace character（空白以外） |
| `.` | Any character except for newline（改行以外の任意の文字） |

これらのコードは角括弧の**内側**でも使える。`[\d.]` は「任意の数字またはピリオド」。ピリオドは角括弧内では特別な意味を失い、ただのピリオドになる。

集合を**反転**して「その集合以外」に一致させるには、開き括弧の直後にキャレット `^` を書く。

```javascript
let nonBinary = /[^01]/;
console.log(nonBinary.test("1100100010100110"));
// → false
console.log(nonBinary.test("0111010112101001"));
// → true
```

`[^01]` は「0でも1でもない文字」だから、`2` が混ざった2つ目の文字列でだけ `true` になる。この「2進数以外が含まれるか」という発想は、後述のバックトラック爆発の例につながる。

### 国際文字という落とし穴（診断で重要）

ここは診断者が必ず知っておくべき落とし穴だ。JavaScript の初期実装が単純だったこと、そしてその単純さが標準の挙動として固定されてしまったことにより、**JavaScript の正規表現は英語以外の文字についてかなり愚か**である。

正規表現にとっての「word character（`\w`）」は、**ラテンアルファベット26文字（大小）、10進数字、そしてなぜかアンダースコアだけ**。`é` や `β` のような、誰がどう見ても文字であるものは `\w` に一致せず、逆に「非word」を表す `\W` に一致**してしまう**。

一方、奇妙な歴史的偶然により `\s`（空白）にはこの問題がなく、Unicode 標準が空白とみなす文字すべて（nonbreaking space や Mongolian vowel separator まで）に一致する。

より堅牢に「文字」を扱うには `\p`（Unicode プロパティ）を使う。ただしこれは元の言語標準との互換性のため、正規表現の後に **`u` フラグ（Unicode 用）**を付けたときにだけ認識される。

| パターン | 意味 |
|---|---|
| `\p{L}` | Any letter（任意の文字） |
| `\p{N}` | Any numeric character（任意の数値文字） |
| `\p{P}` | Any punctuation character（任意の句読点） |
| `\P{L}` | Any nonletter（大文字 P は反転） |
| `\p{Script=Hangul}` | 指定した文字体系の任意の文字 |

```javascript
console.log(/\p{L}/u.test("α"));
// → true
console.log(/\p{L}/u.test("!"));
// → false
console.log(/\p{Script=Greek}/u.test("α"));
// → true
console.log(/\p{Script=Arabic}/u.test("α"));
// → false
```

**診断上の含意**: 入力バリデーションに `\w` を使っているコードは、非英語文字を「文字ではない」と誤判定する。たとえば「英数字だけ許可」のつもりのフィルタが `é` を弾く、あるいは逆に、`\W`（非word）で危険文字を検出しようとするフィルタが `é` を「危険文字」と誤検出して想定外の分岐に入る、といった食い違いが起きる。本書は「非英語テキストや `cliché` のような借用語を含むテキストに `\w` を使うのは負債（liability）」と明言している。**バリデーションとサニタイズ（無害化処理）で文字クラスの定義がズレると、そこが回避の入口になる**。

### 繰り返しとグループ化

繰り返しを表す演算子は次のとおり。

- `+`: 1回以上
- `*`: 0回以上（**星の付いた要素は一致を妨げない——適切なテキストがなければ0回に一致するだけ**）
- `?`: 0回または1回（省略可能）
- `{4}`: 正確に4回、`{2,4}`: 2〜4回、`{5,}`: 5回以上

```javascript
console.log(/'\d+'/.test("'123'"));  // → true
console.log(/'\d+'/.test("''"));     // → false
console.log(/'\d*'/.test("'123'"));  // → true
console.log(/'\d*'/.test("''"));     // → true
```

`+` と `*` の違いに注目。`\d*` は「数字0個以上」なので空でも一致する。**「0個でも通る」性質はバリデーションの穴になりやすい**（空入力を弾いたつもりが通る）。

複数の要素にまとめて演算子をかけるには括弧 `( )` でグループ化する。`i` フラグを付けると case insensitive（大文字小文字を区別しない）になる。

```javascript
let cartoonCrying = /boo+(hoo+)+/i;
console.log(cartoonCrying.test("Boohoooohoohooo"));
// → true
```

この `(hoo+)+` のような「繰り返しの中の繰り返し」が、次章のバックトラック爆発の火種になる。今のうちに形を覚えておこう。

## 3. バックトラッキングと ReDoS（この節で最重要）

### 一致の仕組み：フロー図とバックトラック

`exec` や `test` を使うとき、正規表現エンジンは文字列の先頭から一致を試み、だめなら1文字ずらして再試行し、一致が見つかるか末尾に達するまで続ける。**見つかった最初の一致を返すか、まったく見つからずに失敗する**。

エンジンは正規表現を **flow diagram（フロー図・鉄道図）**のように扱う。左から右へ抜ける経路が見つかれば一致成立だ。ここで鍵になるのが**バックトラック（backtrack、後戻り）**である。

次の式は「`b` が後続する2進数」「`h` が後続する16進数」「接尾辞なしの10進数」のいずれかに一致する。

```javascript
/^([01]+b|[\da-f]+h|\d+)$/
```

`"103"` を照合するとき、エンジンはまず一番上の枝（2進数）に入ってしまうことがある。`3` に達してその枝が間違いと分かると、エンジンは**枝に入った位置を覚えておいて後戻りし**、次の枝（16進数）を試す。そこも `h` がなくて失敗すると、最後の枝（10進数）を試して一致する。この「うまくいかなかったら覚えた位置まで戻って別の道を試す」動作がバックトラックだ。

繰り返し演算子でも同じことが起きる。`/^.*x/` を `"abcxe"` に照合すると、`.*` はまず文字列全体を飲み込もうとし、次に「`x` が必要だ」と気づいて1文字ずつ手放しながら後戻りし、最終的に `abc` まで戻って `x` を見つける。

### バックトラック爆発＝ReDoS の正体

問題は、**同じ入力に多くの異なる一致経路が存在するとき**に起きる。本書は「2進数の正規表現を書こうとして混乱し、うっかりこう書いてしまうかもしれない」として、次の式を挙げる。

```javascript
/([01]+)+b/
```

末尾に `b` のない、0と1が長く並んだ列をこの式に一致させようとすると、何が起きるか。本書の説明をそのまま噛み砕く。

1. マッチャはまず内側のループ（`[01]+`）を数字が尽きるまで通す。
2. `b` がないと気づくので、1文字戻り、外側のループ（`( )+`）を1回通り、また諦める。
3. 内側のループからもう一度バックトラックし直す。
4. **この2つのループを通るあらゆる可能な経路を試し続ける**。

これは「入力に1文字加えるごとに作業量が倍になる」ことを意味する。つまり計算量が**指数時間**になる。本書いわく「ほんの数十文字でも、結果のマッチは実質的に永遠にかかる」。

```
入力の長さ n が1増えるごとに → 試す経路の数が約2倍
n=20  →  約100万経路
n=30  →  約10億経路
n=40  →  約1兆経路（事実上フリーズ）
```

〔補足〕この「1文字ごとに作業量が倍」＝指数時間バックトラックが、**ReDoS（Regular expression Denial of Service、正規表現によるサービス妨害）**の正体である。本書は「ReDoS」という語は使わず、あくまで性能問題として説明している。だが脆弱性としては、攻撃者が入力欄やクエリパラメータに細工した長い文字列を送り込み、脆弱な正規表現に食わせることでブラウザのタブやサーバのスレッドを固める、立派な攻撃だ。

### 攻撃者はどこを突くか / どう守るか

**攻撃者が突く場所**: ユーザー入力を検査する正規表現、とくに「繰り返しの中に繰り返しがある」「複数の枝が同じ文字集合に一致しうる」パターン。メールアドレスや URL のバリデーション正規表現に、この種の危険な構造が紛れていることが多い。攻撃者はまず「多義的に一致しうる長い列」＋「最後の一致を外す1文字」を末尾に付けた入力を作る（上の例なら `0000...000!` のように `b` を欠いた列）。

**防御**:
- `([01]+)+` のような「入れ子の量指定子」を避け、`[01]+` で済むなら1重にする。
- 曖昧に重なる枝（同じ文字が複数の道に一致する）を排除する。
- バリデーションはできるだけ正規表現に頼りすぎず、長さ制限を先にかける。
- 〔補足〕本書の範囲外だが、実務では ReDoS を起こしにくい実装（バックトラックしない有限オートマトン型のエンジンや、タイムアウト付きの照合）を検討する。

**検出**: 診断では、入力を段階的に伸ばして応答時間を測る。長さに対して処理時間が急激（指数的）に伸びるなら、その裏に危険な正規表現がいる可能性が高い。前掲の 📌 で紹介したサイトのサンドボックスで `/([01]+)+b/` を短い入力から試し、数文字伸ばすごとに固まっていく様子を体感しておくとよい。

## 4. マッチ結果・置換・動的生成（インジェクション対策の原型）

### exec とグループの取り出し

`exec`（execute）は一致がなければ `null`、あれば一致情報のオブジェクトを返す。返り値は文字列の配列のように見え、**最初の要素は一致した文字列全体**、`index` プロパティに一致開始位置が入る。

```javascript
let match = /\d+/.exec("one two 100");
console.log(match);        // → ["100"]
console.log(match.index);  // → 8
```

括弧グループがあると、各グループの一致が配列に順に並ぶ。全体一致が常に `[0]`、以降が各グループだ。

```javascript
let quotedText = /'([^']*)'/;
console.log(quotedText.exec("she said 'hello'"));
// → ["'hello'", "hello"]
```

ここで診断上の落とし穴が2つ。**一致しなかったグループの位置は `undefined` になり、複数回一致したグループは最後の一致だけが入る**。

```javascript
console.log(/bad(ly)?/.exec("bad"));
// → ["bad", undefined]
console.log(/(\d)+/.exec("123"));
// → ["123", "3"]
```

`/(\d)+/` は「3桁全部」に一致しているのに、キャプチャされるグループは最後の `3` だけだ。これを知らずにグループの値を使うと、想定と違う値（`undefined` や末尾だけ）が下流に流れ、バリデーションを誤らせる。

純粋にグループ化だけしたく、配列に出したくないときは開き括弧の直後に `?:` を置く（non-capturing group、非捕捉グループ）。

```javascript
console.log(/(?:na)+/.exec("banana"));
// → ["nana"]
```

### 境界と look-ahead

- `^` は入力の先頭、`$` は末尾に一致する。`/^\d+$/` は「数字だけからなる文字列」。
- `\b` は word boundary（単語境界）に一致するが、`\w` と同じ単純な word 概念を使うので「あまり信頼できない」と本書は注意する。
- **look-ahead**（先読み）はパターンを検査するが**位置を進めない**。`(?= )` が肯定先読み、`(?! )` が否定先読み。

```javascript
console.log(/a(?=e)/.exec("braeburn"));
// → ["a"]
console.log(/a(?! )/.exec("a b"));
// → null
```

〔補足〕`^` と `$` を付け忘れると、「文字列全体が数字か」を検査したつもりが「どこかに数字があるか」になってしまう。これはバリデーションのバイパスに直結する典型的なミスだ。本書も INI パーサの例で「`^` と `$` を省くと、ほとんど動くが一部の入力で奇妙に振る舞う、追跡困難なバグになる」と警告している。

### 選択パターンと replace

パイプ `|` は左右のパターンの選択を表し、括弧で適用範囲を限定できる。

```javascript
let animalCount = /\d+ (pig|cow|chicken)s?/;
console.log(animalCount.test("15 pigs"));   // → true
console.log(animalCount.test("15 pugs"));   // → false
```

`replace` は一致部分を置換する。`g`（global）フラグを付けると最初だけでなく全一致を置換する。

```javascript
console.log("Borobudur".replace(/[ou]/, "a"));   // → Barobudur
console.log("Borobudur".replace(/[ou]/g, "a"));  // → Barabadar
```

置換文字列ではグループを `$1`〜`$9` で参照でき、全体一致は `$&` で参照できる。第2引数に**関数**を渡すこともでき、一致ごとに呼ばれてその戻り値が挿入される。

```javascript
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

### 貪欲と非貪欲（greedy / non-greedy）

繰り返し演算子は既定で **greedy（貪欲）**で、可能な限り多く飲み込んでから後戻りする。直後に `?` を付けると **non-greedy（非貪欲）**になり、できるだけ少なく一致する。コメント除去の例が分かりやすい。

```javascript
function stripComments(code) {
  return code.replace(/\/\/.*|\/\*[^]*\*\//g, "");
}
console.log(stripComments("1 /* a */+/* b */ 1"));
// → 1  1
```

貪欲な `[^]*` が最後のコメント終端まで飲み込み、間の `+/* b */` まで消してしまった。非貪欲にすると直る。

```javascript
function stripComments(code) {
  return code.replace(/\/\/.*|\/\*[^]*?\*\//g, "");
}
console.log(stripComments("1 /* a */+/* b */ 1"));
// → 1 + 1
```

本書は「正規表現プログラムの多くのバグは、non-greedy のほうがうまく動くところで意図せず greedy を使ったことに追跡できる。繰り返し演算子を使うときは non-greedy の変種を優先せよ」と述べる。**サニタイザやコメント除去のような「危険な部分を削る」処理が貪欲だと、削りすぎ・削り漏れが起き、無害化の穴になる**ことを覚えておこう。

### 動的 RegExp 生成とメタ文字エスケープ（正規表現インジェクションの原型）

コードを書く時点で一致させたいパターンが決まらないとき、文字列を組み立てて `RegExp` コンストラクタに渡せる。たとえば「ある名前が単語として文中にあるか」を調べる式はこう作れる。

```javascript
let name = "harry";
let regexp = new RegExp("(^|\\s)" + name + "($|\\s)", "gi");
console.log(regexp.test("Harry is a dodgy character."));
// → true
```

文字列で書いているので `\s` は `"\\s"` と二重にする点に注意。第2引数 `"gi"` は global と case insensitive のフラグだ。

ここに**設計の急所**がある。名前がユーザー入力で、たとえば `"dea+hl[]rd"` だったらどうなるか。`+` `[` `]` は正規表現で特別な意味を持つので、組み立てた式は「意図とまったく違う、あるいは無意味なパターン」になり、正しくユーザー名に一致しなくなる。攻撃者はこの性質を使って、**入力でパターンそのものを乗っ取る（正規表現インジェクション）**。ReDoS を狙う爆発パターンを注入することさえできる。

対策は、特別な意味を持つ文字の前にバックスラッシュを足して「ただの文字」に無害化することだ。本書はその実装を逐語で示している。

```javascript
let name = "dea+hl[]rd";
let escaped = name.replace(/[\\[.+*?(){|^$]/g, "\\$&");
let regexp = new RegExp("(^|\\s)" + escaped + "($|\\s)",
                        "gi");
let text = "This dea+hl[]rd guy is super annoying.";
console.log(regexp.test(text));
// → true
```

`/[\\[.+*?(){|^$]/g` はメタ文字（`\` `[` `.` `+` `*` `?` `(` `)` `{` `|` `^` `$`）の集合で、それらの各文字を `\$&`（バックスラッシュ＋その文字自体）に置換している。これが**正規表現インジェクション対策の原型**だ。診断では「ユーザー入力を `new RegExp(...)` にそのまま連結していないか」を探すこと。エスケープなしで連結していれば、そこが注入点になる。

## 5. 状態を持つ正規表現の罠と Unicode

### search と lastIndex

`search` メソッドは正規表現を受け取り、最初に一致したインデックス（なければ -1）を返す。

```javascript
console.log("  word".search(/\S/));  // → 2
console.log("    ".search(/\S/));    // → -1
```

正規表現オブジェクトは `source`（元のパターン文字列）と `lastIndex` というプロパティを持つ。**`lastIndex` は、`g`（global）または `y`（sticky）フラグが有効で `exec` を使うときに、次の一致をどこから始めるかを制御する**。一致成功後、`exec` は `lastIndex` を一致の直後に自動更新する。一致に失敗すると `lastIndex` は 0 に戻る。

```javascript
let pattern = /y/g;
pattern.lastIndex = 3;
let match = pattern.exec("xyzzy");
console.log(match.index);       // → 4
console.log(pattern.lastIndex); // → 5
```

`g` と `y` の違いは、`y`（sticky）が「`lastIndex` の位置ちょうどから始まる一致だけ成功」とするのに対し、`g` は「先の方まで探しにいく」点だ。

```javascript
let global = /abc/g;
console.log(global.exec("xyz abc"));  // → ["abc"]
let sticky = /abc/y;
console.log(sticky.exec("xyz abc"));  // → null
```

### 使い回しが引き起こすバグ（診断で重要）

**状態を持つ正規表現を複数の `exec` 呼び出しで共有すると、前回の `lastIndex` が残って誤った位置から検査を始めてしまう**。

```javascript
let digit = /\d/g;
console.log(digit.exec("here it is: 1"));  // → ["1"]
console.log(digit.exec("and now: 1"));     // → null
```

2回目は明らかに数字があるのに `null` になった。1回目で `lastIndex` が進み、2回目はその位置から始めたので、2文字目以降に数字がなく見逃したのだ。**同じ正規表現オブジェクトを再利用するバリデーションで、ある入力は通り別の入力は誤って弾かれる（あるいは危険な入力が見逃される）**という、再現の難しいバグ＝バイパスがここから生まれる。本書は「global な正規表現には慎重であれ」と繰り返し警告する。

`g` フラグは `match` の挙動も変える。global で呼ぶと、`exec` のような詳細オブジェクトではなく「全一致の文字列配列」を返す。

```javascript
console.log("Banana".match(/an/g));  // → ["an", "an"]
```

全一致を安全に列挙するなら `matchAll` を使う。これはマッチ配列の配列を返し、渡す正規表現は `g` が必須である。

```javascript
let input = "A string with 3 numbers in it... 42 and 88.";
let matches = input.matchAll(/\d+/g);
for (let match of matches) {
  console.log("Found", match[0], "at", match.index);
}
// → Found 3 at 14
//   Found 42 at 33
//   Found 88 at 40
```

### code unit と `u` フラグ

もう一つの標準化された設計ミス。**既定では `.` や `?` のような演算子は「文字」ではなく「code unit（コードユニット）」に対して働く**。code unit とは、JavaScript が文字列を内部表現する16ビットの単位のこと（詳細は前編の第5章を参照）。絵文字など2つの code unit で構成される文字は、この仕組みで奇妙に振る舞う。

```javascript
console.log(/🍎{3}/.test("🍎🍎🍎"));  // → false
console.log(/<.>/.test("<🌹>"));       // → false
console.log(/<.>/u.test("<🌹>"));      // → true
```

`{3}` が2番目の code unit だけにかかり、`.` が1 code unit しか食わないため、絵文字を正しく扱えていない。`u`（Unicode）フラグを付けると正しく扱える。

```javascript
console.log(/🍎{3}/u.test("🍎🍎🍎"));  // → true
```

〔補足〕この「1文字が2単位に割れる」性質は、長さ計算や文字数制限、危険文字のフィルタで**サロゲートペア（絵文字などを表す2単位の組）を割って通す**バイパスの温床になる。フィルタが `u` フラグを付けているか、code unit 単位で切り詰めていないかは、診断でチェックする価値がある。

### 第9章まとめの一覧表

本書章末の一覧表を再掲する。読めない記号は手を止めてこの表に戻ること。

| パターン | 意味 |
|---|---|
| `/abc/` | A sequence of characters（文字の並び） |
| `/[abc]/` | Any character from a set（集合内の任意の1文字） |
| `/[^abc]/` | Any character _not_ in a set（集合外の任意の1文字） |
| `/[0-9]/` | Any character in a range（範囲内の任意の文字） |
| `/x+/` | One or more occurrences（1回以上） |
| `/x+?/` | One or more, nongreedy（1回以上・非貪欲） |
| `/x*/` | Zero or more（0回以上） |
| `/x?/` | Zero or one（0または1回） |
| `/x{2,4}/` | Two to four（2〜4回） |
| `/(abc)/` | A group（グループ） |
| `/a\|b\|c/` | Any one of several patterns（いずれか） |
| `/\d/` | Any digit character（任意の数字） |
| `/\w/` | An alphanumeric character（英数字） |
| `/\s/` | Any whitespace character（空白） |
| `/./` | Any character except newlines（改行以外） |
| `/\p{L}/u` | Any letter character（任意の文字・要 u） |
| `/^/` | Start of input（先頭） |
| `/$/` | End of input（末尾） |
| `/(?=a)/` | A look-ahead test（先読み） |

フラグの整理：`i`＝case insensitive、`g`＝global（`replace` が全置換になる等）、`y`＝sticky（先を探さず現在位置固定）、`u`＝Unicode モード（`\p` を有効化し、2 code unit 文字の多数の問題を修正）。

本書はこう締めくくる。「正規表現は握りの悪い鋭い道具（a sharp tool with an awkward handle）。一部の作業を劇的に簡単にするが、複雑な問題に当てるとすぐ手に負えなくなる。使いこなす技の一部は、きれいに表現できないものを無理に押し込もうとする衝動に抗うことだ」。

## 6. モジュール：コードを分けて依存を明示する

### モジュールが解く2つの問題

第10章はモジュール（module）を扱う。モジュールとは、**自分が依存する部分と、他に提供する機能（インターフェース、interface）を明示したプログラムの一片**のこと。

プログラムは放っておくと有機的に絡み合っていく。よく構造化された状態を保つには絶え間ない注意が要り、その報酬は「次に誰かが手を入れるとき」にしか得られないので、つい怠けて各部が深く結び付くのを許してしまう。これが2つの実務問題を生む。

1. **絡み合ったシステムは理解が難しい**。すべてが他のすべてに触れられると、一部だけを孤立して読めず、全体を理解せざるを得ない。
2. **再利用が難しい**。ある機能を別の状況で使いたくても、文脈から解きほぐすより書き直すほうが速い、という状態になる。

本書はこうした構造のないプログラムを「**big ball of mud（大きな泥団子）**」と呼ぶ。すべてがくっつき、一片を取り出そうとすると全体が崩れる。モジュールが「他モジュールからどのコードを使うか」＝**依存関係（dependencies）**を明示すると、システムは泥から **LEGO** に近づく——部品が明確なコネクタを通して結び付く。

〔補足〕診断の観点では、この「依存が明示される」ことは重要だ。脆弱性は自作コードだけでなく、**依存パッケージ**にも潜む。依存が明示されていれば、どのサードパーティコードがアプリに取り込まれているか（＝攻撃面）を把握できる。

### ES modules

元の JavaScript にはモジュールの概念がなかった。**すべてのスクリプトが同じスコープで実行され**、別スクリプトの関数へのアクセスはグローバルバインディング（グローバル変数）を経由した。これはコードの偶発的な絡み合いを積極的に促し、無関係なスクリプトが同じ名前を奪い合う事故を招いた。

ECMAScript 2015 以降、JavaScript は2種類のプログラムを持つ。**Scripts** は古い方式（グローバルスコープ）で、**Modules** は独自の別スコープを持ち、`import` と `export` で依存とインターフェースを宣言する。この仕組みを **ES modules** と呼ぶ（ES は ECMAScript）。

```javascript
const names = ["Sunday", "Monday", "Tuesday", "Wednesday",
               "Thursday", "Friday", "Saturday"];

export function dayName(number) {
  return names[number];
}
export function dayNumber(name) {
  return names.indexOf(name);
}
```

```javascript
import {dayName} from "./dayname.js";
let now = new Date();
console.log(`Today is ${dayName(now.getDay())}`);
// → Today is Monday
```

`export` はそのバインディングをインターフェースの一部として公開する印、`import` は別モジュールのバインディングを取り込む。モジュールは引用符付き文字列で識別され、**その名前の解決はプラットフォーム次第**——ブラウザはウェブアドレスとして扱い、Node.js はファイルに解決する。この違いはブラウザ側の攻撃面（どこからスクリプトが読み込まれるか）を考えるうえで重要だ。

名前を変えて取り込む（`as`）、既定エクスポート（`export default`）、名前空間としてまとめて取り込む（`import * as ...`）も使える。

```javascript
import {dayName as nomDeJour} from "./dayname.js";
```
```javascript
export default ["Winter", "Spring", "Summer", "Autumn"];
```
```javascript
import * as dayName from "./dayname.js";
console.log(dayName.dayName(3));
// → Wednesday
```

### NPM とパッケージ

NPM（Node Package Manager）は公開された JavaScript パッケージの巨大な集まりであり、それをダウンロードする道具でもある。たとえば INI ファイルを解析する `ini` パッケージはこう使う。

```javascript
import {parse} from "ini";
console.log(parse("x = 10\ny = 20"));
// → {x: "10", y: "20"}
```

〔補足〕診断上、NPM は「依存の連鎖」を意味する。1つのパッケージがさらに多数のパッケージに依存するため、**取り込んだ覚えのないコードがバンドルに混入する**。サプライチェーン（供給網）の観点で、どのパッケージが最終的にブラウザで実行されるかを把握することが攻撃面の理解につながる。

### CommonJS と `Function` コンストラクタの危険（最も明確なインジェクション警告）

2015年以前のモジュール事情も知っておく価値がある。標準のモジュールがなかった時代、コミュニティは言語の上に独自の仕組みを作った。最初は「即時実行関数式（immediately invoked function expression, IIFE）」でモジュール全体を手動で包み、スコープを作った。

```javascript
const weekDay = function() {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday",
                 "Thursday", "Friday", "Saturday"];
  return {
    name(number) { return names[number]; },
    number(name) { return names.indexOf(name); }
  };
}();
```

これは孤立は与えるが**依存を宣言しない**ため理想的ではなかった。より広く使われたのが **CommonJS modules** だ。Node.js が当初から使い、NPM の多くのパッケージが採用した。CommonJS モジュールは2つのバインディングにアクセスできる。**`require`**（依存モジュール名で呼ぶとそのインターフェースを返す関数）と、**`exports`**（プロパティを足して公開するインターフェースオブジェクト）だ。

```javascript
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

このモジュールローダを簡略化して実装すると、その内部で**文字列をコードに変える**組み込み関数 `Function` が登場する。ここが本節でとくに重要だ。

```javascript
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

`Function` は「引数リスト（カンマ区切りの文字列）」と「関数本体の文字列」を取り、その内容を持つ関数値を返す組み込み関数だ。つまり**プログラムが文字列データから新しいプログラムの断片を作れる**。本書はこう警告する。

> これは興味深い概念——プログラムが文字列データから新しいプログラムの断片を作れる——だが、危険な概念でもある。なぜなら、誰かが自分の提供する文字列をあなたのプログラムに `Function` に渡させることに成功したら、プログラムに彼らの望むことを何でもさせられるからである。

これは**本書における最も明確なコードインジェクションの警告**であり、原典の索引タグも `Function constructor, eval, security` となっている。`Function` と、同じく文字列をコードとして実行する `eval` は、攻撃者が文字列の内容を制御できる場所に置かれると、任意コード実行に直結する。

**攻撃者が突く場所**: ユーザー入力・URL パラメータ・受信メッセージ・設定値などが、`eval(...)` や `new Function(...)` に流れ込む経路。**防御**: 文字列をコードとして実行しない。動的な振る舞いが必要でも、`eval`/`Function` ではなくデータとして扱う設計にする。診断では、コード中の `Function(` と `eval(` を grep し、その引数がユーザー由来のデータで組み立てられていないかを追う。

### ビルドとバンドル（ソースを読むときの前提）

ブラウザで数百のファイルを個別に取得すると遅い。そこで開発者はプログラムを **bundler（バンドラ）**で1つ（または少数）の大きなファイルに結合してから配信する。さらに **minifier（ミニファイア、最小化ツール）**がコードを小さくする——空白やコメントを削り、バインディング名を短い無意味な名前に置き換える。

〔補足〕診断者にとってこれは決定的な前提だ。ブラウザで見る JavaScript の多くは、バンドルされ・最小化された後の姿であり、元の変数名やモジュール境界は失われている。**source map（ソースマップ）**という補助ファイルがあれば最小化前の姿に復元でき、読解が一気に楽になる。ES modules と CommonJS の見分けや、どのパッケージが結合されているかを読み解く力が、実際のコードレビューで効いてくる。本書は「新しいプログラムを CommonJS スタイルで書く本当の理由はもはやない」と述べつつ、「CommonJS コードにはまだ遭遇する」とも言う。既存コードを読む診断では両方を見分けられる必要がある。

## 7. 非同期プログラミング：時間を扱う

### 同期と非同期

第11章は非同期プログラミング（asynchronous programming）を扱う。**synchronous（同期）**モデルでは物事が一度に一つ起き、時間のかかる関数を呼ぶと終わるまでプログラムが止まる。**asynchronous（非同期）**モデルでは、アクションを開始してもプログラムは進み続け、アクションが終わると知らされて結果にアクセスできる。

同期モデルで待ち時間を避ける古典的な方法は**スレッド（thread）**——OS が他のプログラムと切り替えながら走らせる、別の実行中プログラム——を使うことだ。だが本書は「スレッドによるプログラミングは悪名高く難しい」とし、ブラウザと Node.js はどちらも「時間のかかる操作をスレッドではなく非同期で扱う」と説明する。本書の言葉では「アクションの終了を待つことが、同期モデルでは暗黙（implicit）、非同期モデルでは明示的（explicit）＝我々の制御下にある」。

### コールバックとその感染性

非同期の最初のアプローチが**コールバック関数（callback function）**だ。時間のかかる関数に「終わったら呼ぶ関数」を追加引数として渡す。`setTimeout` はその典型で、指定ミリ秒後に関数を呼ぶ。

```javascript
setTimeout(() => console.log("Tick"), 500);
```

複数の非同期アクションを連ねると、各アクションの後続処理を関数として渡し続けることになり、インデントがどんどん深くなる。本書はこの厄介さを「**非同期性は感染性（contagious）である**」と表現する。非同期関数を呼ぶ関数もまた非同期にならざるを得ず、コールバックを渡し回す構造がプログラム全体に広がっていく。

さらに深刻なのは**失敗の扱い**だ。「コールバックスタイルの最も切迫した問題の一つは、失敗がコールバックに適切に報告されるのを保証するのが極めて困難なこと」。慣習として、コールバックの第1引数でエラー、第2引数で成功値を渡す「エラーファースト規約」がある。

```javascript
someAsyncFunction((error, value) => {
  if (error) handleError(error);
  else processValue(value);
});
```

だがこの方式は、あらゆる場所で自分でエラーを捕まえて正しく転送する規律を要し、抜けやすい。**エラー処理の抜け＝例外的な入力で想定外の状態に落ちる場所**なので、診断の観点でも要注目である。

### Promise

Promise は「まだ利用可能でないかもしれない値」を表す**receipt（受領書）**である。`then` メソッドで「値が来たら呼ぶ関数」を登録する。promise が **resolved（解決）**すると、その値で登録関数が呼ばれる。

```javascript
let fifteen = Promise.resolve(15);
fifteen.then(value => console.log(`Got ${value}`));
// → Got 15
```

`Promise.resolve` は与えた値を promise で包む最も簡単な方法。まだ解決しない promise を作るにはコンストラクタを使い、「解決に使う関数」を受け取る。

```javascript
function textFile(filename) {
  return new Promise(resolve => {
    readTextFile(filename, text => resolve(text));
  });
}
textFile("plans.txt").then(console.log);
```

`then` は**それ自体が別の promise を返す**ので、`then` を連ねて（chain して）非同期アクションの列を組める。返した値が promise なら、その解決値にさらに解決する。

```javascript
function randomFile(listFile) {
  return textFile(listFile)
    .then(content => content.trim().split("\n"))
    .then(ls => ls[Math.floor(Math.random() * ls.length)])
    .then(filename => textFile(filename));
}
```

本書の要諦：「promise は『値がいつ到着するか』という問いをコードが無視できるようにする装置」。通常の値は参照前に存在していなければならないが、promise された値は今あるかもしれないし将来現れるかもしれない値だ。

### 失敗（rejection）

Promise は **resolved（成功）**か **rejected（失敗）**のどちらかになる。resolve ハンドラ（`then`）は成功時のみ呼ばれ、**rejection は `then` が返す新しい promise に伝播する**。ハンドラが例外を投げると、その `then` が生む promise が自動的に reject される。**連鎖のどこかで失敗すると、連鎖全体が失敗とマークされ、失敗地点より先の成功ハンドラは呼ばれない**。

失敗を捕まえるのが `catch` だ。`then` の第2引数に rejection ハンドラを渡す短縮形（`.then(acceptHandler, rejectHandler)`）もある。

```javascript
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

`Handler 1` が飛ばされて `catch` に落ち、そこで値を返したので後続の `Handler 2` が復帰して呼ばれている。本書は「`then` と `catch` で作る連鎖は、非同期の値または失敗が流れるパイプライン」と表現し、「型（成功／失敗）に一致しないハンドラは無視される」と述べる。**JavaScript 環境は未処理の rejection を検出してエラー報告できる**——放置された失敗は静かに消えず、必ずどこかに現れる。

## 8. タイミングサイドチャネル：応答時間差から秘密を漏らす

### 設定：貧弱に守られたルータ

第11章には、脆弱性ハンティングにきわめて近い題材がある。本書はカラス（corvid）のキャラクター Carla を使い、**応答時間の差から秘密を1桁ずつ漏らす**攻撃を非同期プログラミングの練習題材にしている。

設定はこうだ。建物のワイヤレスルータは**20年前のもので貧弱に守られており**、Carla はその認証機構に使える欠陥を見つける。ネットワーク参加時、デバイスは正しい**6桁のパスコード**を送る必要がある。アクセスポイントは正しいコードかどうかで成功／失敗メッセージを返す。

### 急所：部分一致で応答が変わる

欠陥の核心はここだ。**部分的なコード（たとえば3桁だけ）を送ったとき、その桁がコードの正しい先頭（prefix）かどうかで応答が変わる**。

- 間違った数字を送ると、アクセスポイントは**即座に失敗メッセージ**を返す。
- 正しい数字を送ると、アクセスポイントは**さらに桁を待つ**（すぐには失敗を返さない）。

この「正しい prefix なら待ち、間違えたら即失敗」という応答の差が、秘密を漏らす**オラクル（oracle、質問すると秘密のヒントを返してしまう仕組み）**になっている。Carla は各桁を順に試し、「即座に失敗を返さないもの」を見つけることで第1桁を確定する。1桁分かったら同じ方法で第2桁、と進めば、総当たりよりはるかに速くパスコード全体が割れる。

```
総当たり: 6桁すべての組み合わせ = 100万通りを試す
prefix漏洩を使うと: 各桁10通り × 6桁 = 最大60回の試行で済む
```

〔補足〕この構造＝**応答時間の差が「秘密と入力が何桁一致したか」を漏らす**は、**タイミング攻撃（timing attack）／タイミングサイドチャネル（timing side channel）**の典型である。本書は「timing attack」「side channel」「oracle」という語を使っていないが、構造は完全にそれだ。クライアントサイドでも、**入力を1文字ずつ比較して不一致で早期 return する比較**や、**文字単位で逐次バリデーションする処理**が、処理時間の差として秘密のヒントを漏らすことがある。診断では「秘密（トークン・パスワード・パスコード）の比較や検証が、一致長に応じて処理時間を変えていないか」を疑う。

### 実装：タイムアウトと再帰で桁を確定する

Carla のコードは「**promise は一度だけ resolve または reject できる**」性質を使う。`withTimeout` は、渡された promise が先に決着すればそれを結果とし、先に `setTimeout` が発火すれば `"Timed out"` で reject する。

```javascript
function withTimeout(promise, time) {
  return new Promise((resolve, reject) => {
    promise.then(resolve, reject);
    setTimeout(() => reject("Timed out"), time);
  });
}
```

アクセスポイントは不正な認証要求に約20ミリ秒で応答するので、安全のため50ミリ秒待ってからタイムアウトさせる。`for` ループの内側で promise を待てないため、Carla は再帰関数でプロセスを駆動する。「タイムアウトした（＝すぐ失敗が返らなかった）＝その桁は正しい」とみなして次の桁へ進み、即失敗なら次の数字を試す。

```javascript
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

```javascript
crackPasscode("HANGAR 2").then(console.log);
// → 555555
```

結果は `555555`。本書はユーモアを込めて「Carla は首を傾げてため息をつく。コードがもう少し推測しにくかったらもっと満足感があっただろうに」と結ぶ。**防御**の教訓は明確だ——**秘密の検証は、一致の有無や一致長にかかわらず一定時間で行う**（定数時間比較）。prefix が正しいときだけ処理を長引かせる実装は、それ自体が漏洩経路になる。

## 9. async/await とジェネレータ

### async 関数

promise でも非同期コードは書くのが煩わしい。JavaScript は**擬似同期的に書ける** `async` 関数を用意している。`async` 関数は暗黙に promise を返し、本体で他の promise を `await` でき、それが同期のように**見える**。

先ほどのパスコードクラッキングを async/await で書き直すと、再帰なしのふつうのループになる。

```javascript
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

`async` 関数が呼ばれると promise を返す。何かを return した瞬間その promise が resolve し、例外を投げれば reject する。`await` を置いた式は promise の解決を待ち、reject されると `await` の箇所で例外が発生する。本書の重要な一文：「そうした関数はもはや開始から完了まで一気には実行されない。`await` を持つ任意の点で凍結（frozen）され、後で再開されうる」。**この「凍結される点」こそが非同期ギャップ**であり、次章のバグの舞台になる。

### ジェネレータ

関数を一時停止・再開する能力は `async` 専用ではない。`function*`（アスタリスク付き）で定義する**ジェネレータ（generator）**関数も同じことをする。ジェネレータを呼ぶと iterator（反復子）が返り、`next` を呼ぶたびに `yield` まで実行されて一時停止する。

```javascript
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

ジェネレータは yield するたびにローカル状態を自動保存するので、反復子を手書きするより楽になる。本書は「**`async` 関数は特殊な種類のジェネレータ**」だと明かす——promise を生成し、await するたびにその結果が式の値になる。

### ネットワークスキャンと Promise.all

第11章の別の題材「Corvid Art Project」は**ネットワークスキャン**の練習になる。プログラム可能な LED マトリクス標識（型番 LedTec SIG-5030）がワイヤレスで操作できる。ネットワーク上の各デバイスは `10.0.0.20` のような **IP アドレス**を持ち、IP の各数は 0〜255 だ。Carla は「全アドレスにメッセージを送って、マニュアルどおりのインターフェースで応答するものがあるか」を試す。

```javascript
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

ここで大事なのは非同期の使い方だ。**要求はすべて他の要求の終了を待たず即座に送出され**、存在しない・応答しないアドレスの `catch` は空にしてクラッシュを防いでいる。応答しないマシンで時間を浪費しないための設計だ。

〔補足〕この構造は、診断で「同一ネットワーク内の到達可能なエンドポイントを列挙する」発想そのものである。ブラウザ上の JavaScript からも、同一オリジン内やアクセス可能な範囲に対して同様の並行リクエストが投げられる。攻撃・診断のどちらの文脈でも、「並行して大量に投げ、応答したものだけ拾う」は基本形だ。

複数の非同期アクションの結果をまとめるには **`Promise.all`** を使う。promise の配列を「結果の配列に解決する単一の promise」に変える。

```javascript
function displayFrame(frame) {
  return Promise.all(frame.map((data, i) => {
    return request(screenAddresses[i], {
      command: "display",
      data
    });
  }));
}
```

`Promise.all` は「複数を並行に起こし、全部の終了を待ってから次に進む」定石だ。ただし1つでも失敗すると全体が失敗する点は覚えておく。

## 10. イベントループと非同期バグ（レース条件の原型）

### イベントループ

非同期プログラムはメインスクリプトの実行から始まり、しばしば後で呼ばれるコールバックを仕掛ける。そのメインスクリプトとコールバックは、それぞれ**一続きで中断されずに完了まで実行される**。だがその合間、プログラムは何かが起きるのを待って idle で座っていることがある。

重要なのは、**コールバックはそれをスケジュールしたコードから直接呼ばれない**点だ。`setTimeout` でコールバックが呼ばれる時点では、それを仕掛けた関数はとっくに return している。その結果、非同期の振る舞いは**それ自身の空の呼び出しスタック上で起きる**。だから次のような `try...catch` は機能しない。

```javascript
try {
  setTimeout(() => {
    throw new Error("Woosh");
  }, 20);
} catch (e) {
  // This will not run
  console.log("Caught", e);
}
```

`throw` が起きる頃には `try` ブロックはもう終わっており、`catch` はスタック上にいない。本書はこれを「promise なしでは非同期コードをまたいで例外を管理するのがとても難しい理由の一つ」と説明する。

プログラムの周りには大きなループが回っていて、これを **event loop（イベントループ）**と呼ぶ。イベント（タイムアウト、到着する要求など）はキューに入り、コードが順に実行される。**JavaScript 環境は一度に一つのプログラムしか実行しない**ので、遅いコードは他のイベント処理を遅延させる。

```javascript
let start = Date.now();
setTimeout(() => {
  console.log("Timeout ran at", Date.now() - start);
}, 20);
while (Date.now() < start + 50) {}
console.log("Wasted time until", Date.now() - start);
// → Wasted time until 50
// → Timeout ran at 55
```

20ミリ秒後に走るはずのタイムアウトが、忙しいループのせいで55ミリ秒後まで遅れている。**この「一度に一つ」性質は、ReDoS（本節3章）でタブが固まる理由でもある**——爆発する正規表現がイベントループを占有すると、他の一切が止まる。

promise の解決も同様に「新しいイベント」として扱われる。既に解決済みの promise を待っても、コールバックは即座ではなく現在のスクリプト終了後に走る。

```javascript
Promise.resolve("Done").then(console.log);
console.log("Me first!");
// → Me first!
// → Done
```

### 非同期ギャップ＝レース条件の原型（診断で最重要）

同期的に一続きで実行される間は、プログラム自身の操作以外に状態は変わらない。だが**非同期プログラムには、実行中に他のコードが走り込める gaps（隙間・ギャップ）がある**。ここがレース条件（race condition、競合状態）の生まれる場所だ。

本書の壊れたコード例を見る。ファイルサイズ一覧を作るつもりのコードだ。

```javascript
async function fileSizes(files) {
  let list = "";
  await Promise.all(files.map(async fileName => {
    list += fileName + ": " +
      (await textFile(fileName)).length + "\n";
  }));
  return list;
}
```

問題は `+=` にある。`+=` は「文の実行が始まった時点の `list` の値」を取り、`await` が終わった時点で「その値＋追加分」を `list` に代入する。だが**開始時から終了時までの間に非同期ギャップがある**。`map` 式はリストに何も足される前に一斉に走るので、各 `+=` は「空文字列」から始まり、自分のファイル取得が終わったときに `list` を「空文字列＋自分の行」に上書きしてしまう。結果、**最後に読み終えた1行しか残らない**。これがまさにレース条件だ——複数の非同期処理が同じ状態を「読んで→書く」際、割り込みで互いの結果を踏み潰す。

修正は簡単だ。状態を書き換えるのをやめ、各 promise から行を返し、`Promise.all` の結果を `join` する。

```javascript
async function fileSizes(files) {
  let lines = files.map(async fileName => {
    return fileName + ": " +
      (await textFile(fileName)).length;
  });
  return (await Promise.all(lines)).join("\n");
}
```

本書の結論はこの節全体の教訓でもある。「いつものように、新しい値を計算することは既存の値を変更するよりエラーが起きにくい」。そして「このようなミスは、とくに `await` を使うときに犯しやすく、コードのどこにギャップがあるかを認識しているべきである」。

**診断上の含意**: レース条件は、認証・認可・残高・在庫・使用回数といった「共有状態の読んで書く」処理で悪用される。クライアントサイドでも、非同期で状態を更新する UI ロジックや、`await` を挟んだ権限チェックと処理の間に割り込む余地があると、TOCTOU（Time Of Check to Time Of Use、検査時と使用時のずれ）型のバグになる。**「`await` の前後で状態が変わりうるか」を常に問う**のが、非同期コードを読む診断の基本姿勢だ。JavaScript の明示的な非同期性（コールバック・promise・await のいずれでも）の利点は、こうしたギャップが「どこにあるか比較的見つけやすい」ことにある。

## 手を動かす

1. 前掲の 📌 で紹介した https://eloquentjavascript.net/ を開き、第9章のサンドボックスで `/([01]+)+b/` を用意する。`test` の入力を `"0"`, `"00"`, `"000"` …と1文字ずつ伸ばし、末尾には `b` を付けないでおく。20文字を超えたあたりからブラウザの応答が目に見えて遅くなる。これが ReDoS の体感である。安全な `[01]+b` と比べ、処理時間の差を確認せよ。

2. 正規表現インジェクションの実験。次を Node.js かブラウザのコンソールで実行し、エスケープの有無で挙動が変わることを確かめよ（自分の環境でのみ）。
```javascript
let name = "dea+hl[]rd";
// エスケープなし（壊れる／注入される）
try { new RegExp("(^|\\s)" + name + "($|\\s)", "gi"); }
catch (e) { console.log("raw:", e.message); }
// エスケープあり（安全）
let escaped = name.replace(/[\\[.+*?(){|^$]/g, "\\$&");
console.log("escaped ok:", new RegExp(escaped).source);
```

3. `lastIndex` の罠を再現する。
```javascript
let digit = /\d/g;
console.log(digit.exec("here it is: 1"));  // → ["1"]
console.log(digit.exec("and now: 1"));     // → null（見逃し！）
```
同じオブジェクトを使い回すと2回目が `null` になることを確認し、`matchAll` や毎回新しい正規表現を作る方式に直せば直ることを確かめよ。

4. `Function` コンストラクタの危険を安全な範囲で観察する。自分のローカル環境で、`Function("a, b", "return a + b")(2, 3)` が `5` を返すことを確かめ、第2引数の文字列に任意のコードを書けてしまうことを理解せよ。**本番コードでユーザー入力をここに流さない**理由を言葉にする。

5. 非同期ギャップを再現する。本節10章の壊れた `fileSizes` と修正版を、`textFile` を `Promise.resolve` でモックして両方走らせ、壊れた版が1行しか返さないこと、修正版が全行返すことを比較せよ。

6. イベントループの順序を予測する。次を実行する前に出力順を紙に書き、それから確かめよ。
```javascript
Promise.resolve("Done").then(console.log);
console.log("Me first!");
```

## つまずきポイント

- **「ReDoS は特殊な攻撃だ」と思い込む**: 実体はただの「バックトラックの爆発」で、`(a+)+` のような入れ子の量指定子を書けば誰でもうっかり作れる。特別なペイロードではなく「長い曖昧な列＋最後を外す1文字」で起きる。
- **`\w` を「文字全般」と誤解する**: `\w` はラテン英数字とアンダースコアだけ。`é` や `β` は含まれない。国際文字を扱うバリデーションで穴になる。
- **エスケープの二重バックスラッシュ**: `RegExp` コンストラクタに文字列で渡すときは `\\s` と二重に書く。スラッシュ記法 `/\s/` とは違う。この混乱が動的生成のバグを生む。
- **`g` フラグ付き正規表現の使い回し**: `lastIndex` が残り、2回目以降の検査が誤る。オブジェクトを共有しない、`matchAll` を使う、で回避する。
- **`^` `$` の付け忘れ**: 「文字列全体が数字か」のつもりが「どこかに数字があるか」になる。バリデーションバイパスの定番。
- **`try...catch` で非同期例外を捕まえようとする**: `setTimeout` の中の `throw` は同期の `catch` に届かない。promise か async/await のエラー処理を使う。
- **`await` の前後で状態が変わらないと思い込む**: 非同期ギャップで他のコードが割り込み、共有状態を書き換える。`+=` で状態を積み上げる非同期ループは典型的な壊れ方。
- **`Promise.all` は1つ失敗すると全体失敗**: 「全部並行に待つ」便利さの裏で、部分的失敗の扱いを忘れやすい。

## この節のまとめ

- Eloquent JavaScript は攻撃名を教える本ではなく、攻撃が成立する「言語とブラウザの正確な挙動」を教える本である。この節は正規表現・モジュール・非同期の3章から、脆弱性の土台を抜き出した。
- 正規表現エンジンはフロー図を辿り、行き詰まると覚えた位置へ**バックトラック**する。入れ子の量指定子や曖昧に重なる枝があると、入力1文字ごとに作業量が倍増し、指数時間に爆発する。これが **ReDoS** の正体である。
- 対策は入れ子の量指定子を避け、曖昧な枝を排除し、長さ制限を先にかけること。診断では入力を伸ばして応答時間の急増を測る。
- ユーザー入力を `new RegExp(...)` に連結すると**正規表現インジェクション**になる。メタ文字を `\` でエスケープする（本書の `/[\\[.+*?(){|^$]/g` → `\\$&`）のが対策の原型である。
- `g` / `y` フラグ付き正規表現は `lastIndex` という状態を持ち、使い回すと検査が誤る。既定は code unit 単位で動くので絵文字などは `u` フラグが要る。`\w` はラテン英数字＋アンダースコアだけで国際文字を扱えない。
- モジュールは依存とインターフェースを明示してコードを「泥団子」から「LEGO」に変える。ES modules（`import`/`export`）が現代の標準、CommonJS（`require`/`exports`）は既存コードで今も出会う。
- モジュールローダの実装に現れる **`Function` コンストラクタ**は文字列をコードに変える。`eval` と並び、攻撃者が文字列を制御できるとコードインジェクションに直結する。これが本書で最も明確なインジェクション警告である。
- ブラウザで読む JavaScript はバンドル・最小化された後の姿であり、元の名前や境界は失われている。source map で復元できることを知っておく。
- 非同期はスレッドを避けて時間のかかる操作を扱う。コールバックは感染性で失敗の扱いが難しく、**Promise** が解決／失敗をパイプラインとして扱えるようにした。`async`/`await` は擬似同期的に書ける糖衣で、`await` の点で関数が凍結される。
- パスコードの**部分一致で応答が変わる**（正しい prefix なら待ち、間違えれば即失敗）と、応答時間差から秘密を1桁ずつ漏らせる。これが**タイミングサイドチャネル**であり、秘密の比較は一致長によらず定数時間で行うべきである。
- **イベントループ**は一度に一つのプログラムしか実行しない。だから遅いコード（爆発する正規表現含む）は全体を止める。非同期の例外は空のスタックで起きるので同期 `catch` では捕まらない。
- `await` の前後には**非同期ギャップ**があり、他のコードが割り込んで共有状態を書き換えると**レース条件**になる。状態を書き換えず新しい値を計算する（`Promise.all` + `join`）のが安全側の書き方であり、TOCTOU 型バグを避ける基本である。

## 理解度チェック

1. `/([01]+)+b/` に、末尾に `b` のない長い0と1の列を与えると何が起きるか。なぜか。
   ▶ 答え: バックトラックが爆発し、入力1文字ごとに試す経路が約2倍になって指数時間かかる。内側と外側の繰り返しが同じ文字集合に多義的に一致でき、`b` がないと分かるまであらゆる経路を試すため。これが ReDoS の原理。

2. ユーザー入力の名前を `new RegExp("..." + name + "...")` に連結する実装の危険と、その対策を述べよ。
   ▶ 答え: 名前に含まれる `+` `[` `]` などのメタ文字がパターンを乗っ取る正規表現インジェクション。対策はメタ文字を `\` でエスケープすること。本書は `name.replace(/[\\[.+*?(){|^$]/g, "\\$&")` を示している。

3. 次のコードで2回目が `null` になる理由は何か。
```javascript
let digit = /\d/g;
digit.exec("here it is: 1"); digit.exec("and now: 1");
```
   ▶ 答え: `g` フラグ付きなので `exec` 成功後に `lastIndex` が一致の直後へ進む。同じオブジェクトを使い回した2回目はその位置から検査を始め、その先に数字がないため見逃して `null` になる。

4. `Function` コンストラクタ（や `eval`）が「危険な概念」と本書が呼ぶのはなぜか。
   ▶ 答え: 文字列をコードに変えて実行するため。攻撃者が渡す文字列をプログラムがそこに流すと、プログラムに任意のことをさせられる（コードインジェクション）。

5. パスコードの「部分一致で応答が変わる」欠陥を使うと、6桁を総当たりより速く割れるのはなぜか。
   ▶ 答え: 正しい prefix を送ると即失敗せず待つので、桁ごとに「即失敗しない数字」を探せる。1桁ずつ確定でき、100万通りの総当たりが最大60回程度の試行に減る。これはタイミングサイドチャネル。

6. 同期の `try...catch` で `setTimeout` 内の `throw` を捕まえられないのはなぜか。
   ▶ 答え: コールバックは自分自身の空の呼び出しスタック上で、後の時点で実行される。`throw` の頃には `try` ブロックはとうに終わっており、`catch` はスタック上にいないため。

7. 次の `fileSizes` が1行しか返さない理由と、正しい直し方を述べよ。
```javascript
async function fileSizes(files) {
  let list = "";
  await Promise.all(files.map(async fileName => {
    list += fileName + ": " + (await textFile(fileName)).length + "\n";
  }));
  return list;
}
```
   ▶ 答え: `+=` は文の開始時の `list`（空文字列）を読み、`await` 後にそれ＋自分の行を代入する。非同期ギャップの間に他の反復も同様に走るため、各代入が互いを踏み潰し最後の1行しか残らない（レース条件）。直し方は状態を書き換えず、各 promise から行を返して `Promise.all` の結果を `join` する。

8. `\w` を入力バリデーションに使うと国際文字でどんな食い違いが起きるか。より堅牢な代替は何か。
   ▶ 答え: `\w` はラテン英数字とアンダースコアだけなので、`é` や `β` を「文字でない」と誤判定する。堅牢にするには `u` フラグ付きの `\p{L}`（Unicode プロパティ）を使う。

9. イベントループが「一度に一つのプログラムだけ実行する」ことは、ReDoS の被害とどうつながるか。
   ▶ 答え: 爆発する正規表現の照合がイベントループを占有すると、その間は他のイベント処理が一切進まない。だからタブやサーバ全体が固まる（サービス妨害）。

## 出典

- Eloquent JavaScript 第4版 トップ（オンライン版・コードサンドボックス）: https://eloquentjavascript.net/
- 著者公式ソースリポジトリ（全章 Markdown 原稿）: https://github.com/marijnh/Eloquent-JavaScript
- 第9章 Regular Expressions 原稿: https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/09_regexp.md
- 第10章 Modules 原稿: https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/10_modules.md
- 第11章 Asynchronous Programming 原稿: https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/11_async.md

<!-- sources: https://eloquentjavascript.net/, https://github.com/marijnh/Eloquent-JavaScript, https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/09_regexp.md, https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/10_modules.md, https://raw.githubusercontent.com/marijnh/Eloquent-JavaScript/master/11_async.md -->
<!-- terms: 正規表現, バックトラッキング, ReDoS, 正規表現インジェクション, メタ文字エスケープ, lastIndex, sticky フラグ, code unit, uフラグ, Unicodeプロパティ, look-ahead, non-capturing group, greedy, non-greedy, モジュール, ES modules, CommonJS, import, export, require, exports, Function コンストラクタ, eval, コードインジェクション, バンドラ, minifier, source map, big ball of mud, 依存関係, 同期, 非同期, コールバック, Promise, resolve, reject, catch, async, await, ジェネレータ, yield, Promise.all, イベントループ, 非同期ギャップ, レース条件, TOCTOU, タイミング攻撃, タイミングサイドチャネル, オラクル, 定数時間比較, ネットワークスキャン -->
<!-- self-read: https://eloquentjavascript.net/ | サイト本体がエージェントプロキシの組織ポリシーで遮断され403応答となり自動取得できず、インタラクティブなコード実行環境を体験できていない。本文は著者公式リポジトリのMarkdown原稿から完全取得しており内容は原典と一致する -->
