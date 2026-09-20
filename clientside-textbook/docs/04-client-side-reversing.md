# 第4章 クライアントサイドコードのリバースエンジニアリング


## minify/bundle/難読化の解体ツール

クライアントサイド脆弱性ハンティングでは、配布されているJavaScriptがそのまま読めることはほとんどない。ビルドパイプラインが変数名を短縮し(minify)、複数ファイルを1つのバンドルにまとめ(bundle)、場合によっては商用の難読化ツール(obfuscator)で解析を妨害している。ソースマップが公開されていれば復元は容易だが、本番環境ではソースマップが意図的に外されていることも多い。そこで必要になるのが、minify/bundle/難読化をそれぞれ「解体」する専用ツール群である。本節では代表的な3つのツール——**webcrack**、その公式ドキュメントにある「Deobfuscation」の考え方、そしてブラウザだけで動く**de4js**——を取り上げ、それぞれが「何を」「どういう仕組みで」元に戻しているのかを、実際の変換例とともに解説する。

読者への注意として、これらのツールはいずれも「静的解析＋AST(Abstract Syntax Tree、抽象構文木。ソースコードを木構造のデータに変換した表現で、ツールはこの木を走査・書き換えることでコードを変形する)変換」によって難読化前のコードに近づける仕組みであり、対象コードを実行するわけではない（ただしwebcrackは内部で `isolated-vm` というサンドボックス環境を用いて一部の式を安全に評価する場合がある。詳細は後述)。したがって、本節の内容は「受け取ったJavaScriptを解析する」防御的な目的の技術であり、本番サービスへの不正アクセスや破壊的検証を意図するものではない。

### 難読化解除ツールがなぜ必要か

バグバウンティやクライアントサイド脆弱性調査でJavaScriptを読む場面は大きく3種類に分かれる。

1. **minify(圧縮)されたコード** — Terser/UglifyJS/esbuildなどが変数名短縮・空白除去・構文の圧縮表現化(三項演算子化、シーケンス式化など)を行った結果。意味は変わらないが人間には読みにくい。
2. **bundle(束ね)されたコード** — webpack/browserify/RollupなどのモジュールバンドラーがCommonJSやESMの複数ファイルを1つの`.js`にまとめた結果。`__webpack_require__`のような内部ランタイム関数と、数値IDで管理されるモジュール配列が特徴。
3. **obfuscate(難読化)されたコード** — javascript-obfuscator(通称obfuscator.io)のような専用ツールが、文字列を配列に退避し、制御フローをswitch文でバラバラにし、無意味なデッドコードを注入するなどして、意図的に解析コストを上げた結果。

これらは独立した処理なので、実務では「難読化を解いて→バンドルを展開して→minifyを戻す」という順番でツールを通すことになる。webcrackはこの3段階をまとめて自動的に行う点が最大の特徴である。

### webcrack — 難読化解除・unminify・バンドル展開を1つに統合したツール

> 出典: webcrack (GitHub, j4k0xb/webcrack) — https://github.com/j4k0xb/webcrack

webcrackはREADMEで「a tool for reverse engineering javascript」と説明されており、次の4つを1本のツールで行う。

- obfuscator.io で難読化されたコードの deobfuscate(難読化解除)
- unminify(圧縮されたコードを人間が読みやすい構文に戻す)
- transpile(古い構文への変換を戻すなど)
- webpack / browserify バンドルの unpack(展開)

TypeScript製で、内部ではBabelのASTを解析・変換する。README記載の設計思想として以下の4点が明記されている。

- 🚀 Performance — 各種最適化で高速に処理する
- 🛡️ Safety — 変数の参照とスコープを考慮する(単純な文字列置換ではなく、変数が実際にどこで使われているかをASTレベルで追跡するため、誤った書き換えを避けられる)
- 🔬 Auto-detection — 設定不要でコードパターンを自動検出する(難読化ツールの種類やバージョンを手動指定する必要がない)
- ✍🏻 Readability — 難読化・バンドラーが残す痕跡(アーティファクト)を除去する

#### インストールと動作要件

```bash
# CLIとしてグローバルにインストール
npm install -g webcrack@latest

# ライブラリ(API)として使う場合
npm install webcrack@latest
```

2026年時点でのREADMEでは **Node.js 22 または 24** が必須とされている。これは、webcrackが依存する `isolated-vm`(V8の分離コンテキストでJavaScriptを安全に実行するためのネイティブアドオン)が、V8のABI(バイナリ互換性)の都合で奇数バージョンのNode.js(奇数リリースはNode.jsの非LTS版に多い)との組み合わせでビルド・動作が壊れやすいことが公式に警告されているためである。バージョン依存の強い制約なので、CIやDocker環境に組み込む際は固定したNodeバージョンを使うこと。

pnpmでインストールする場合はネイティブアドオンのビルドを明示的に許可する必要がある。

```bash
pnpm add -g webcrack@latest --allow-build=isolated-vm
```

#### CLIの使い方

```bash
webcrack input.js
webcrack input.js > output.js
webcrack bundle.js -o output-dir
```

公式ドキュメントに掲載されているCLIオプションの全体像は以下の通り。

```txt
Usage: webcrack [options] [file]

Arguments:
  file                 input file, defaults to stdin

Options:
  -V, --version        output the version number
  -o, --output <path>  output directory for bundled files
  -f, --force          overwrite output directory
  -m, --mangle         mangle variable names
  --no-jsx             do not decompile JSX
  --no-unpack          do not extract modules from the bundle
  --no-deobfuscate     do not deobfuscate the code
  --no-unminify        do not unminify the code
  -h, --help           display help for command
```

標準入力からも受け取れるため、URLから直接取得したスクリプトをそのままパイプできる。

```bash
curl https://pastebin.com/raw/ye3usFvH | webcrack
```

`-o` オプションでバンドルを展開すると、出力ディレクトリには次のファイルが生成される。

- `deobfuscated.js` — 難読化解除・unminify済みのコード
- `bundle.json` — バンドルの種類とモジュールIDやパスの対応表
- `index.js` — エントリーポイント
- 残りの各モジュールファイル(`1.js`, `2.js` など)

これは、単一の巨大な難読化済みバンドルを、元のプロジェクトのディレクトリ構成に近い形へ再構築してくれるという意味で非常に実務的である。バグバウンティで対象サイトのJS資産を丸ごと取得した後、ソースコードレビューに近い形で脆弱性(APIキーのハードコード、危険なDOM操作sink、内部APIエンドポイントなど)を探す際の下準備として使える。

Pythonなど他言語から呼び出す場合は、ローカルインストールしたバイナリをサブプロセスとして起動し、標準入出力でやり取りする。

```py
import subprocess

code = "1+1"
result = subprocess.run(
    ["webcrack"], input=code, capture_output=True, text=True
)
print(result.stdout)
```

#### APIの使い方

```javascript
import fs from 'fs';
import { webcrack } from 'webcrack';

const input = fs.readFileSync('bundle.js', 'utf8');

const result = await webcrack(input);
console.log(result.code);
console.log(result.bundle);
await result.save('output-dir');
```

`result.code` が変換後のソース全体、`result.bundle` がバンドル解析結果(webpack/browserifyのモジュール構造)、`result.save()` が展開結果をディスクへ書き出すメソッドである。自動化パイプライン(例えば「クロールしたJSを全部deobfuscateしてから静的解析にかける」)に組み込みやすい設計になっている。

#### bundle unpack(webpack/browserify展開)の仕組み

webcrackがバンドルを展開できるのは、webpackやbrowserifyが生成するランタイムコードに共通の「型」があるためである。公式ドキュメント(Bundle Unpacking)には、webpackランタイムの中核である `__webpack_require__` の構造がTypeScriptの型注釈付きで説明されている。

```ts
interface Module {
  exports: Exports; // module exports
  i: number; // module id
  l: boolean; // loaded
}

interface WebpackRequire {
  (moduleId: number): Exports;      // モジュールをロードして呼び出す
  d(exports, name, getter): void;   // ESM export用のgetterを定義
  e(chunkId): Promise<Exports>;     // チャンクをロード
  g(): typeof globalThis;           // globalThis/windowを返す
  n(exports): { (): Exports; get a(): Exports }; // default exportの互換用
  r(exports): void;                 // __esModule フラグを立てる
  c: Record<number, Module>;        // ロード済みモジュールのキャッシュ
  m: Record<number, FactoryFunction>; // モジュール関数の一覧(idがキー)
  p: string;                        // チャンクの公開パス
  s: number;                        // エントリーモジュールid
}
```

webcrackはこの `m`(モジュールIDをキーとするファクトリ関数のマップ)を検出し、各モジュールを個別ファイルへ分解した上で、`__webpack_require__(id)` の呼び出しを `require('./相対パス.js')` に書き換える。さらに `__webpack_require__.r()` や `.d()` の呼び出しパターンからESM(`export`/`import`)への変換も試みる。ただし現時点(本ドキュメント取得時)では **複数チャンクの展開には未対応** と明記されている。これは、動的import(`import()`)によって複数のJSファイルに分割されたコード分割(code splitting)構成では、完全な復元ができない場合があることを意味する。

browserifyバンドルの展開はさらに難しい問題を扱う。browserifyの各モジュールは数値IDと「相対パス→依存先ID」の対応表(例: `{ './foo': 1, './bar': 3 }`)しか持たず、**モジュールの絶対パスはバンドル内のどこにも保存されていない**。そこでwebcrackは依存関係グラフを構築し、相対パスの整合性を保ったまま元のディレクトリ構造をできるだけ再現する。ドキュメントの例:

```js
// モジュールid -> 依存関係
{
  0: { 1: './a.js', 4: 'lib' }, // エントリーポイント
  1: { 2: '../bar/b.js' },
  2: { 3: '../../c.js' },
  3: {},
  4: {},
}
```

これは次のようなファイル構造に復元される。

```txt
├── tmp0
│   ├── tmp1
│   │   ├── index.js
│   │   └── a.js
│   └── bar
│       └── b.js
├── c.js
```

エントリーモジュールが `src/app/index.js` のように深い階層にあっても、`"src"` や `"app"` という名前自体はバンドルに含まれないため、`tmp0/tmp1` のような仮名ディレクトリが割り当てられる。この仕組みを理解しておくと、「なぜ展開結果のディレクトリ名がオリジナルと一致しないのか」を混乱なく受け止められる。

### webcrackにおけるDeobfuscation(難読化解除)の考え方

> 出典: webcrack Documentation — Deobfuscation — https://webcrack.netlify.app/docs/concepts/deobfuscate.html

このドキュメントページ自体の記述は簡潔で、webcrackが対応する難読化パターンの一覧が中心となっている。対象はjavascript-obfuscator(obfuscator.io)で、以下の変換に対応する。

- **String Array(文字列配列)関連**
  - Rotate(配列の回転): 実行時に配列の先頭要素を末尾に回す自己書き換えループにより、静的なインデックス番号だけでは文字列を特定できないようにする
  - Shuffle(シャッフル): 配列の並び替え
  - Index Shift(インデックスシフト): アクセス時のインデックスに一定のオフセットを加える
  - Calls Transform(呼び出し変換): 文字列アクセスを専用のラッパー関数経由にする
  - Variable/Function Wrapper Type: 配列アクセスをラップする関数・変数の生成パターン
  - None/Base64/RC4 Encoding: 配列の各要素をBase64やRC4暗号でエンコードしておき、実行時に復号する
  - Split Strings: 1つの文字列を複数の断片に分割して配列に格納する
  - Unicode Escape Sequence: 文字列を`\uXXXX`形式のエスケープシーケンスで記述する
- **その他の変換**
  - Compact(コンパクト化): 改行・空白の除去
  - Simplify(簡素化): 冗長な式の単純化
  - Numbers To Expressions(数値の式化): リテラルの数値を計算式に置き換える(例: `5` を `2+3` のように出力する)
  - Control Flow Flattening(制御フローの平坦化): if/forなどの通常の制御構造をswitch文とディスパッチャ配列に変換し、実行順序を追いにくくする
  - Dead Code Injection(デッドコード注入): 実行されない無意味なコードブロックを混入させる
  - Transform Object Keys(オブジェクトキーの変換): プロパティ名を計算式や間接参照に置き換える
- **Disable Console Output**: `console.log`などを無効化する保護機構
- **Self Defending(自己防衛)**: コードが変更・整形されると動作しなくなる仕掛け
- **Debug Protection(デバッグ保護)**: DevToolsが開かれていることを検知して妨害する
- **Domain Lock**: 特定ドメイン以外での実行を拒否する

ドキュメントページ自体にはbefore/afterの具体例までは載っていないため、ここではwebcrackのソースコードリポジトリに含まれる実際のテストサンプルを引用し、「なぜその変換で元に戻るのか」を仕組みレベルで補足する。

> ⚠️ **未取得の資料についての補足**: 公式ドキュメントページの記述は上記の一覧にとどまっていたため、以下は同じリポジトリ内の実装・テストコード(パブリックなソース)から筆者が読み解いた、各変換の仕組みに関する補足である。

#### String Arrayの復元 — 「配列＋インデックス」の静的評価

最も基本的な難読化パターンは、文字列リテラルをすべて配列にまとめ、コード中では `配列[インデックス]` でアクセスする形に書き換えるというものである。webcrackのテストサンプル(`simple-string-array.js`)を見ると、この変換がどう解かれるかがよくわかる。

難読化(あるいは単純化)されたコード:

```js
const arr = ['log', 'Hello, World!'];
console[arr[0]](arr[1]);

// ignore mutable array
const arr2 = ['log', 'Hello, World!'];
arr2[0] = 'warn';
console[arr2[0]](arr2[1]);

const arr3 = ["requ", "m", "0x2649a392", "ire", "8", "v"];
const vm = eval(arr3[0] + arr3[3] + "(\"" + arr3[5] + "" + arr3[1] + "\")");
const v8 = eval(arr3[0] + arr3[3] + "(\"" + arr3[5] + "" + arr3[4] + "\")");

// ignore unreferenced array
const arr4 = ['log', 'Hello, World!'];
```

webcrackによる変換後:

```js
console.log("Hello, World!"); // ignore mutable array
const arr2 = ["log", "Hello, World!"];
arr2[0] = "warn";
console[arr2[0]](arr2[1]);
const vm = eval("require(\"vm\")");
const v8 = eval("require(\"v8\")"); // ignore unreferenced array
const arr4 = ["log", "Hello, World!"];
```

ここで重要なのは、**webcrackがすべての配列アクセスを無条件に置き換えるわけではない**という点である。3つの興味深い挙動がある。

1. `arr`(1つ目の配列)は、宣言後に一度も再代入されていないことをスコープ解析で確認できるため、`arr[0]`・`arr[1]` を安全に定数畳み込み(constant folding。式を実行前に計算し、確定した値に置き換える最適化手法)し、`console.log("Hello, World!")` まで書き換えている。
2. `arr2` は途中で `arr2[0] = 'warn'` と**再代入**されているため、静的な時点でのインデックス0の値が実行時に変わりうる。webcrackはこれを検出すると、「安全に推論できない」と判断してあえて元の `console[arr2[0]](arr2[1])` の形のまま残す。これがREADMEに書かれていた「🛡️ Safety - Considers variable references and scope(変数の参照とスコープを考慮する)」の具体的な意味であり、単純な文字列置換ツールとの決定的な違いである。
3. `arr3` の例では、文字列の断片(`"requ"`, `"ire"`, `"v"`, `"m"`)を実行時に連結して `eval("require(\"vm\")")` を組み立てるという、`eval`ベースの動的コード生成が使われている。webcrackはこの連結処理まで静的に評価し、最終的に `eval` に渡される文字列そのものを確定させて出力している。これは、文字列の断片化(Split Strings)や文字列連結による難読化に対して、コンパイラ的な定数畳み込みで対抗していることを示す好例である。

この「配列は不変か(immutable)を確認してから定数畳み込みする」という設計が、String Array系の各種変種(Rotate/Shuffle/Index Shift/Base64・RC4エンコード)にも一貫して適用される。仕組みとしては、配列の初期化式を見つけ、その配列に対する再代入がスコープ内に存在しないことをASTのバインディング解析(変数の宣言と参照の対応関係を追跡する処理)で確認したうえで、アクセス時のインデックス計算(回転・シフト・デコード関数の適用など)を実際に評価してから、元のリテラルへ置換する、という流れになる。Base64やRC4でエンコードされている場合は、そのデコードロジック自体(難読化ツールが挿入したデコーダ関数)を解析して同じ処理をwebcrack側でシミュレートすることで、平文の文字列を取り出す。

#### Control Flow Flattening(制御フロー平坦化)の復元

制御フロー平坦化は、通常のif/forによる分岐・ループ構造を、単一の`while`ループと`switch`文、そして実行順序を指定する配列(ディスパッチャ)に変換する難読化手法である。obfuscator.ioのテストサンプル(`obfuscator.io-control-flow.js`)の冒頭には、この特徴的なパターンが現れている。

```js
function a() {
    var h = [
        '4496112hRzUwi', 'convertESM', 'replaceRequireCalls',
        'inlineVarInjections', '10034958BKGbbp', 'modules',
        'capture', '4|3|0|5|2|6|1', 'aokfw', 'convertDefaultRequire',
        // ...
    ];
    a = function () { return h; };
    return a();
}
(function (c, d) {
    var e = c();
    while (!![]) {
        try {
            var f = -parseInt(b(0x15)) / 0x1 * (parseInt(b(0x5)) / 0x2) + /* ... */;
            if (f === d) { break; }
            // ...
        } catch (g) { /* ... */ }
    }
})(a, 0x93c19);
```

一見すると意味不明な自己実行関数(IIFE)だが、これは「文字列配列の並び替えオフセットを求めるための自己参照的な数値計算」であり、実行するとある固定値`d`に収束するまでループする。webcrackはこの種のパターンを、AST上のスコープ解析と部分評価(コード全体を実行するのではなく、副作用のない範囲でノードごとに値を計算する手法)によって、`switch`のcaseの実行順序を復元し、元のif/for相当の制御構造に戻す。

同じテストのスナップショット(復元後の期待値)を見ると、難読化前のコードは次のような読みやすい形に復元されることがわかる。

```js
function applyTransforms() {
  this.modules.forEach(varInjection_1.inlineVarInjections);
  this.modules.forEach(esm_1.convertESM);
  (0, getDefaultExport_1.convertDefaultRequire)(this);
  this.replaceRequireCalls();
  var f = m.capture(m.numericLiteral());
  var g = m.callExpression(m.identifier("require"), [f]);
  return g;
}
```

制御フロー平坦化を解く仕組みの核心は、「switchのディスパッチャ変数がどの順序で値を取るか」をトレースする点にある。難読化ツールは通常、ループの各反復でディスパッチャ変数(多くは文字列や数値の配列を`split`したもの)を1つずつ読み進めながら対応するcaseへジャンプするという形を取るため、webcrackはそのディスパッチャの初期値(多くは定数として埋め込まれている)を静的に読み取り、実行順序をシミュレートして、元の直列的なコードに並べ直す。

#### Self Defending / Debug Protection / Domain Lockへの対応

これら3つは「コードを変更されると壊れる」「開発者ツールが開かれると妨害する」「特定ドメイン以外では動かなくする」という、リバースエンジニアリング対策そのものを目的とした保護機構である。webcrackはこれらのガード処理に典型的なコードパターン(例えば `debugger` 文を連続実行して間隔を計測しDevToolsの有無を推測するコード、`toString()`の結果を検査して自身が改変されていないか確認する自己参照コードなど)を検出し、該当する保護コードのブロックごと除去することで、以降の解析(unminify・逆コンパイル)を妨げられないようにする。防御目的でこれらのツールを使う際には、対象コードが実際にこうした自己防衛機構を持っているかどうかを見極めるためにも、この一覧を知っておく価値がある。

### unminify(圧縮解除)の具体的な変換規則

webcrackのunminifyフェーズは、単に整形するだけでなく、圧縮によって変えられてしまった**構文そのもの**を、意味を保ったまま元に近い書き方へ戻す。ドキュメントに列挙されている代表的な変換をいくつか引用する(`// [!code --]`が変換前、`// [!code ++]`が変換後を表す差分記法)。

```js
if (a) b(); // 変換前
if (a) { // 変換後
  b();
}
```

```js
console["log"](a); // 変換前(計算プロパティアクセス)
console.log(a); // 変換後(ドット記法)
```

```js
for (;;) a(); // 変換前
while (true) a(); // 変換後
```

```js
!0 // 変換前
true // 変換後
!1 // 変換前
false // 変換後
```

```js
typeof a > "u" // 変換前(圧縮時によく使われるtypeof比較のトリック)
typeof a === "undefined" // 変換後
```

```js
x && y && z(); // 変換前
if (x && y) { // 変換後
  z();
}
```

`typeof a > "u"`という書き方は、Terserなどのminifierが `typeof a === "undefined"` より短いバイト数で済むように生成する定型パターンで、文字列の辞書式比較(`"undefined" > "u"`が真になる性質)を悪用したものである。このような「圧縮系ツールが生成する定番トリック」を辞書的に知っていることが、unminifyツールの精度を支えている。バグバウンティで生のminifyコードを読む際にも、この対応表そのものが有用なチートシートになる。

`for`ループの変数インライン化を戻す `split-for-loops-vars` の例も実務上有益である。

```js
for (var j = 0, i = 0; i < 3; i++) {} // 変換前
var j = 0; // 変換後
for (var i = 0; i < 3; i++) {}
```

ここでのポイントは「ループの条件式・更新式で使われていない変数だけを外に出す」という判定条件で、これを誤ると意味が変わってしまう(例えば`i`のように条件式で使われる変数を外に出すとバグる)。これもASTベースで変数の使用箇所を正確に追跡しているからこそ安全に行える変換である。

### de4js — ブラウザだけで動く軽量deobfuscator/unpacker

> 出典: de4js (lelinhtinh/de4js, ミラー: thanhle.io.vn) — https://lelinhtinh.github.io/de4js/

webcrackがNode.js環境でのCLI/API利用を前提とした本格的なツールであるのに対し、**de4js**はブラウザ上で完結する「JavaScript Deobfuscator and Unpacker」である。インストール不要で、ブラウザにURLを開くだけで使える手軽さが最大の利点であり、バグバウンティ調査中にすぐ試したい断片的なコードのデコードに向いている。

de4jsが対応する難読化・パッキング形式は以下の通り。

- **Eval** — `eval(...)`で包まれたコードの中身を安全に取り出して表示する(evalを実際に実行するのではなく、引数の文字列を抽出・整形する)
- **Array** — 配列に格納された文字列/コード断片を結合して復元する
- **Obfuscator IO** — javascript-obfuscator系の難読化コードに対する簡易的なデコード
- **_Number** — 数値エンコード形式のリテラル復元
- **JSFuck** — `[]`、`!`、`+`のような6種類の記号だけでJavaScriptの全構文を表現する極端な難読化方式のデコード(すべての文字・演算を`![]`や`+[]`などブール値と配列の暗黙変換だけで再現する手法で、可読性はゼロだが実行結果は元コードと同じになる)
- **JJencode** — 記号のみの変数名(`$`, `_`など)と文字コードの算術的組み立てで難読化する方式
- **AAencode** — 顔文字のような記号列(例: `ﾟωﾟ`)でコードを表現するjjencodeの派生方式。日本語圏のネタ的難読化として広まったが実際に配布コードの難読化にも使われることがある
- **URLencode** — `%XX`形式のパーセントエンコーディングされた文字列のデコード
- **Packer** — Dean Edwardsが開発した古典的な `eval(function(p,a,c,k,e,d){...})` 形式のパッカー(変数名や関数名を短い記号に置換し、辞書配列と組み合わせて復元する仕組み)のデコード
- **JS Obfuscator** — 一般的な難読化ツールが出力するコードへの汎用的な対応
- **My Obfuscate** — 特定の難読化ツール(myobfuscate系)向けのデコーダ
- **Wise Eval/Function** — `eval`や`Function`コンストラクタを使った特定パターンのデコーダ

入力方法は3種類用意されている。

1. **String** — テキストボックスに直接コードを貼り付ける
2. **Local File** — ローカルのJSファイルをアップロードする
3. **Remote File** — リモートURLを指定して読み込む(対象サーバーがCORS(Cross-Origin Resource Sharing、異なるオリジン間でのリソース共有を許可する仕組み)を許可している必要がある。許可されていないサーバーのスクリプトを直接this機能で取得することはできない)

処理を補助する機能として、行番号表示、コードの自動整形(インデント付け)、文字列のアンエスケープ(`\xNN`や`\uNNNN`をリテラル文字に戻す)、そして式の実行(evalに相当する評価をサンドボックス内で行い、結果を確認する)などが搭載されている。

**Packer形式の仕組みを補足しておく**。Dean Edwardsのpackerは、コード中の識別子・キーワードをbase-62(0-9, a-z, A-Zの62種)で表現される短い記号に置き換え、その記号と元の単語の対応表を配列として同梱した上で、実行時に`eval`で文字列置換・復元してから実行するという方式である。典型形は次のようになる。

```js
eval(function(p,a,c,k,e,d){
  e=function(c){return c};
  if(!''.replace(/^/,String)){
    while(c--){d[c]=k[c]||c}
    k=[function(e){return d[e]}];
    e=function(){return'\\w+'};
    c=1
  }
  while(c--){
    if(k[c]){
      p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])
    }
  }
  return p
}('0.1("2")',3,3,'console|log|hi'.split('|'),0,{}))
```

このコードの`p`が圧縮済みの本体文字列、`k`が単語の辞書配列、`c`が辞書のサイズであり、正規表現によるトークン単位の文字列置換を`c`回繰り返すことで元のソースを復元してから`eval`する。de4jsのようなツールは、この関数を実際に評価してしまうのではなく、`p, a, c, k` の各引数を静的に取り出し、同じ置換ロジックをツール側で安全に再現することで、`eval`を経由せずに復元後の文字列だけを表示する。これが「evalの中身を安全に取り出す」の具体的な意味である。

JSFuck/AAencode/JJencodeのような記号だけの難読化についても考え方は共通している。これらはいずれも「JavaScriptの型強制(type coercion)規則を悪用し、あらゆる文字・数値・関数呼び出しを、ごく少数の記号の組み合わせだけで表現し直す」符号化方式であり、暗号のような秘匿性はない(誰でも同じ規則で復元できる)。de4jsは各方式の復元アルゴリズムを実装済みのため、貼り付けるだけで元の(短縮されていない)JavaScriptを得られる。

### webcrackとde4jsの使い分け、実務上の注意

両者は競合というより補完関係にある。

- **webcrack**: Node.js環境が使え、対象がSPA(Single Page Application)の巨大なバンドルファイルである場合や、CI/自動化パイプラインに組み込みたい場合に向く。obfuscator.io系の難読化・webpack/browserifyバンドルの構造復元・unminifyまで一括して行える。
- **de4js**: ブラウザだけで完結し、断片的なコード(例えば`<script>`タグに埋め込まれた短いevalコードや、古典的なpacker/JSFuckでエンコードされた1行)を素早く確認したい場合に向く。インストール不要でその場で試せる手軽さが利点。

いずれのツールも「難読化を完全に元通りに戻す」ことを保証するものではない。難読化ツールのバージョンアップによって新しいエンコード方式やガード処理が追加された場合、対応する変換ルールが実装されるまでツール側が追従できないことがある(webcrackはREADME記載時点でNode.js 22/24を要求しており、GitHub上でも継続的にメンテナンスが行われている。実際に試す際は`npm install -g webcrack@latest`のように常に最新版を使うことが望ましい)。また、これらのツールを実在のサービスから取得したコードに対して使う場合も、取得自体が対象の利用規約やrobots的な制約に反しないか、防御目的の範囲を超えていないかを事前に確認したうえで利用すべきである。

最後に、これらのツールを使う際の思考の流れをまとめる。

1. 取得したJSがminifyだけされているのか、bundleされているのか、難読化まで施されているのかを、ざっと目視で切り分ける(`__webpack_require__`があればwebpack、大きな文字列配列と`while(true){try{...}catch{...}}`パターンがあればobfuscator.io系、というように特徴的なシグネチャで判別できる)。
2. bundle+難読化が疑われる場合はwebcrackをCLIで一括適用し、`-o`で展開してファイル単位のソースツリーを得る。
3. 断片的なコード、あるいはwebcrackが完全には解けなかった一部分(例えば独自の難読化ロジックが混ざっている場合)は、de4jsに貼り付けて個別に試す。
4. いずれの結果も「意味は保ったまま読みやすくなっただけ」であることを念頭に置き、最終的な脆弱性の有無(危険なsinkへのデータフロー、ハードコードされた秘密情報、内部APIの呼び出しパターンなど)は人間の目でロジックを追って判断する。

難読化解除ツールはあくまで「読解の負荷を下げる」ための道具であり、脆弱性を自動検出してくれるものではない。しかし、この負荷軽減こそが、クライアントサイドの大規模なJavaScript資産を現実的な時間で調査可能にする、最も重要な下地となる。

## AST解析と自作deobfuscator

実運用のフロントエンドは、minify（識別子短縮と空白除去）だけでなく、しばしば **難読化（obfuscation）** を経ている。難読化は minify と目的が違う。minify は「サイズを小さくする」ための可逆性を気にしない変形だが、難読化は「読ませない・自動解析させない」ことが目的で、**意味を変えずに構造を複雑化する変換を意図的に積む**。代表格が [obfuscator.io](https://obfuscator.io)（OSS版は `javascript-obfuscator`）で、バグバウンティで遭遇する難読化JSの大半はこの系統か、その派生である。

本節の目的は防御側の解析能力の獲得にある。自社・自分が管理するアプリのバンドル、あるいは許諾のある検証環境の成果物を対象に、「難読化されたコードから、危険な sink（入力が最終的に実行・解釈される代入先。`innerHTML`、`eval`、`location` など）や隠れたエンドポイント・ハードコードされた秘密情報を復元できる」状態を目指す。実在サービスへの無許可検証や、難読化を破ること自体を目的とした行為は扱わない。

### なぜ正規表現ではなくASTなのか

難読化解除（deobfuscation）の素朴な第一手は正規表現による置換である。しかしこれは原理的に上限が低い。JavaScript は文脈自由文法であり、**括弧の対応・入れ子・スコープ・文字列リテラル中の擬似コード**を正規表現では正しく扱えないからだ。`_0xabc(0x1a4, 0x2f)` を拾う正規表現は、引数にネストした呼び出し `_0xabc(_0xdef(0x1), 0x2)` が現れた瞬間に破綻する。

代わりに使うのが **AST（Abstract Syntax Tree／抽象構文木）** である。パーサがソースを木構造に変換し、ノード単位で「この `BinaryExpression` は定数同士なので畳み込める」「この `Identifier` の束縛はこのスコープのこの宣言だ」といった **構文的・意味的に正しい判断**ができる。deobfuscator は本質的に「難読化器が適用した変換の逆写像を、ASTの書き換えパスとして実装したもの」である。

JavaScript の AST は **ESTree** という事実上の標準仕様に従う（Esprima 発祥、Acorn・espree・Babel が概ね準拠。Babel は JSX/TypeScript/実験的構文のために独自拡張ノードを持つ）。ノードは `type` フィールドで種別を持ち、たとえば次のような対応になる。

| ソース片 | 主なノード種別 |
| --- | --- |
| `var a = 1;` | `VariableDeclaration` → `VariableDeclarator` → `Identifier` / `NumericLiteral` |
| `f(x, y)` | `CallExpression`（`callee`, `arguments`） |
| `a["b"]` / `a.b` | `MemberExpression`（`computed: true` / `false`） |
| `0x1a * 2 + 3` | `BinaryExpression` の入れ子 |
| `!![]` | `UnaryExpression(!)` × 2 の入れ子、内側は `ArrayExpression` |
| `switch (k) { case '0': ... }` | `SwitchStatement` → `SwitchCase` |

実際のノード構造を確認するには [astexplorer.net](https://astexplorer.net) が最短である（パーサを acorn / babel / espree / swc などから選べ、右ペインで変換プラグインを即書ける）。0xdevalias の資料でも解析の起点として挙げられている。

### Babel を使った変換パイプラインの型

Node.js で自作 deobfuscator を書くときの標準構成は次の3点セットである（Babel 7 系。2026年時点で Babel 8 への移行が進行中だが、下記 API は互換）。

```bash
npm i @babel/parser @babel/traverse @babel/generator @babel/types
```

```js
const parser    = require('@babel/parser');
const traverse  = require('@babel/traverse').default;
const generate  = require('@babel/generator').default;
const t         = require('@babel/types');
const fs        = require('fs');

const src = fs.readFileSync(process.argv[2], 'utf8');

// 1) パース：難読化コードは構文的に合法なので通常は素直に通る
const ast = parser.parse(src, {
  sourceType: 'unambiguous', // module / script を自動判定
  errorRecovery: true,       // 一部壊れていても木を作る
  plugins: []                // 必要に応じて 'jsx', 'typescript'
});

// 2) 走査と変換：ここに「打ち消しパス」を積む
traverse(ast, { /* visitors */ });

// 3) 生成
const out = generate(ast, {
  comments: false,
  jsescOption: { minimal: true } // 復元した日本語等を \uXXXX に再エスケープしない
}).code;
fs.writeFileSync('deobfuscated.js', out);
```

**なぜ `jsescOption: { minimal: true }` が要るのか**：`@babel/generator` は既定で非ASCII文字を `\uXXXX` にエスケープして出力する。せっかく文字列配列から日本語やUTF-8のエンドポイント名を復元しても、出力が再びエスケープされては可読性が戻らない。

走査の主役は **visitor（訪問者）** と **path（パス）** である。`path` は単なるノードではなく「親ノード・スコープ・兄弟関係を持った、書き換え可能なハンドル」で、これが Babel を deobfuscation 向きにしている核心である。

```js
traverse(ast, {
  // 定数畳み込み：難読化器が散らした算術/論理式を評価して literal に戻す
  'BinaryExpression|UnaryExpression|LogicalExpression|ConditionalExpression'(path) {
    const { confident, value } = path.evaluate();
    if (!confident) return;                       // 副作用や未束縛変数があれば諦める
    if (value === undefined || typeof value === 'object') return;
    path.replaceWith(t.valueToNode(value));
    path.skip();                                  // 生成し直したノードを再訪問しない
  }
});
```

**なぜこれで戻るのか**：`path.evaluate()` は Babel が静的に持つ簡易評価器で、**副作用が無く値が確定できる場合だけ** `confident: true` を返す。`0x3aa59b - (-0x10 * -0x80 + 0x69 * -0x1 + 0xa * -0xb5)` のような「わざと長くした定数式」や、`!![]`（→ `true`）、`![]`（→ `false`）、`'a' + 'b'` はここで解決される。逆に `window.x + 1` のような外部依存は `confident: false` になるので、誤変換のリスクが構造的に抑えられている。`path.skip()` を忘れると、置換後のノードを再度訪問して無限ループや無駄な再評価を招く。

もう一つ重要なのが **スコープ解析** である。難読化された識別子（`_0x58cd18` など）を安全に扱うには、名前の一致ではなく **binding（束縛）** で追う必要がある。

```js
traverse(ast, {
  Identifier(path) {
    const binding = path.scope.getBinding(path.node.name);
    if (!binding) return;                 // グローバル/未宣言
    binding.referencePaths;               // その束縛を「読んでいる」箇所すべて
    binding.constantViolations;           // 再代入している箇所（空なら実質const）
    binding.constant;                     // 再代入されていないか
  }
});
```

`binding.constant === true` であれば「この変数は宣言後に書き換えられない」と保証でき、初期化式をインライン展開しても意味が変わらない。**この保証が無いまま置換するのが、素朴な deobfuscator が壊れる最大の原因**である。リネームは `path.scope.rename('_0x58cd18', 'decodeStr')` を使えば、同名の別スコープ変数を巻き込まずに済む。大きく木を書き換えた後は `path.scope.crawl()` でスコープ情報を再構築する。

### 資料1：HackMag「自作deobfuscatorを書く」

HackMag の記事は、約3MBの難読化された実アプリのJSに対して、既存の自動ツール（obfuscator.io の公式デオブファスケータ、de4js、JS Beautifier など）が歯が立たなかったところから出発する、実践的なケーススタディである。記事が扱う難読化は obfuscator.io 系で、次の要素が重なっている。

- **文字列配列化（string array concealing）**：全文字列リテラルが `_0x5e2d()` が返す配列に退避され、コード中では `_0x3a86(0x1a4)` のようなインデックス呼び出しに置き換わる。記事の表現では「これらは何らかの形で訳し戻さなければならない暗号化された定数」である。
- **識別子難読化**：`_0x58cd18`、`_0x2f8935` のような16進パターンの無意味な名前。
- **ラッパーの多段化（間接参照の連鎖）**：`_0x1e0595(0x4f3, 0x854, 0x1210, ...)` → `_0x340121` → `_0x3a86` → 配列 `_0x5e2d` と、**同型だが別名のプロキシ関数を何段も挟む**。記事は「どれも同じ種類のものだ」と述べており、実装としては単に引数を転送して返すだけの関数が大量に生成されている。
- **算術による添字の隠蔽**：`_0x3aa59b - (-0x10 * -0x80 + 0x69 * -0x1 + 0xa * -0xb5)` のように、添字を直接書かず定数式で表す。
- **真偽値の難読化**：`(!![])==true` / `(![])==false` の多用。記事は**デオブファスケート実行前にこれらの真偽定数を先に置換しておく**ことを勧めている。

記事の手法は**正規表現による抽出＋ブラウザコンソール上での `eval` 評価**である。まず「最下層のラッパー関数」を型でマッチさせる。

```javascript
var reg = /function (_0x[a-f0-9]*)\(_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*\)\{return _0x3a86\([^)]*\);\}/g;
```

次に、**いま見つけた関数を呼んでいる関数**を、名前を埋め込んだ正規表現で再帰的に探す。これを新しい関数が出てこなくなるまで繰り返す（間接参照の連鎖を下から上へ辿る）。

```javascript
var reg1 = new RegExp("function (_0x[a-f0-9]*)\\(_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*,_0x[a-f0-9]*\\)\\{return "+names[i]+"\\([^)]*\\);\\}", "g");
```

最後に、判明した全関数の呼び出し式を列挙し、`eval` で実際に評価して literal に置き換える。

```javascript
var expressions=[];
for (var i=0;i<names.length;i++) {
  var reg1 = new RegExp(names[i]+"\\([^)]*,[^)]*,[^)]*,[^)]*,[^)]*,[^)]*[^)]*,[^)]*,[^)]*,[^)]*\\)", "g");
  while (found = reg1.exec(string)) {
    value=eval(test);
    expressions.push(found[0]);
    values.push(value);
  }
}
```

**なぜ `eval` に頼らざるを得ないのか**：文字列配列は単なる配列ではなく、**実行時に自己回転（rotate）するシャッフル機構**を伴うのが普通である。obfuscator.io の出力では、ファイル先頭付近に「配列を `push(shift())` で回転させながら、特定の定数式の合計がマジックナンバーと一致した時点で `break` する」IIFE が置かれる。

```javascript
(function (_0x4f1e, _0x2b7a) {
  const _0x5f = _0x3a86;
  while (!![]) {
    try {
      const _0x1c = parseInt(_0x5f(0x1a6)) / 0x1 + parseInt(_0x5f(0x1a9)) / 0x2 + /* ... */;
      if (_0x1c === _0x2b7a) break;
      else _0x4f1e['push'](_0x4f1e['shift']());
    } catch (_0x2d) {
      _0x4f1e['push'](_0x4f1e['shift']());
    }
  }
}(_0x5e2d, 0x3ad1f));
```

つまり**配列の正しい並びは、このループを実際に回さないと決まらない**。静的解析だけで添字→文字列の対応表を作ることは（回転量を解くという追加の解析を入れない限り）できず、だからこそ「復号器を実行する」アプローチが現実的になる。記事が `try-catch` で囲んで `eval` する（評価に失敗する式は捨てる）のも、この実行時依存性に由来する。

記事は自分の限界を明示している。「完全に機能する deobfuscator を書くには、正規表現の単純な検索置換では足りない」「最終的には自前の JavaScript マシンエミュレータを作ることになる」。得られるのは**部分的な解読**——文字列定数とメソッド名は読める形に戻るが、変数名・関数名は不透明なまま、`Class["Method"]` 形式のブラケット記法をドット記法に直す作業や、辞書変換の解決が残る。記事はこの先を webcrack のようなプロジェクトが担っていると位置づけ、続編でより高度な制御フロー・変数難読化の扱いを予告している。

> 出典: JavaScript deobfuscation: Writing your own deobfuscator — https://hackmag.com/coding/js-deobfuscation

#### 同じ処理をASTで書き直す（安全性と精度の両立）

記事の regex + `eval` を AST に載せ替えると、境界の判定が正確になり、かつ**復号器の実行をサンドボックスに封じ込められる**。要点は「解析対象の全体を実行しない。復号に必要な最小のコード断片だけを隔離環境で実行する」ことである。

```js
const vm = require('node:vm');

// 1) 文字列配列関数・回転IIFE・デコーダ関数のソース片だけを切り出して結合する
//    （path.getSource() で元ソースの該当範囲をそのまま取得できる）
const bootstrap = [arrayFnSrc, rotateIifeSrc, decoderFnSrc].join('\n');

// 2) 何も無いコンテキストで実行する：require も process も fetch も存在しない
const sandbox = vm.createContext(Object.create(null));
vm.runInContext(bootstrap, sandbox, { timeout: 5000 });

// 3) デコーダを呼ぶだけの小さな関数を取り出す
const decode = vm.runInContext(`(function(i){ return ${decoderName}(i); })`, sandbox, { timeout: 1000 });

// 4) AST上の呼び出しを、評価結果の文字列リテラルに置換する
traverse(ast, {
  CallExpression(path) {
    if (!t.isIdentifier(path.node.callee, { name: decoderName })) return;
    const args = path.node.arguments.map(a => {
      const r = path.get('arguments')[path.node.arguments.indexOf(a)].evaluate();
      return r.confident ? r.value : undefined;
    });
    if (args.some(a => a === undefined)) return;   // 静的に決まらない呼び出しは触らない
    let value;
    try { value = decode(...args); } catch { return; }
    if (typeof value !== 'string') return;
    path.replaceWith(t.stringLiteral(value));
  }
});
```

**なぜ `vm` + 空コンテキスト + `timeout` なのか**：解析対象が悪性コードである可能性を前提にするべきだからである。難読化JSの一部は `self-defending`（後述）や無限ループ、あるいは解析環境を探る処理を含む。`vm.createContext(Object.create(null))` は `require`・`process`・`fs` を一切渡さないため、仮に実行されてもファイルやネットワークに触れない。`timeout` は無限ループ対策。ただし **Node の `vm` は完全なセキュリティ境界ではない**（prototype 経由の脱出が知られる）ため、本当に素性の怪しい検体は使い捨てコンテナ／VM の中で扱うこと。ブラウザのコンソールで直に `eval` するのは、そのタブのオリジンの権限でコードを走らせることになるので、**自分のドメインでない対象には使わない**のが原則である。

### obfuscator.io の各変換と、対応する打ち消しパス

自作 deobfuscator は「難読化オプション1つ＝打ち消しパス1つ」という対応で設計するとよい。obfuscator.io の主要オプションと逆変換の対応は次の通り（オプション名は `javascript-obfuscator` のもの。2020年代を通じて名称はおおむね安定）。

| 難読化オプション | 出力の見た目 | 打ち消しパスの方針 |
| --- | --- | --- |
| `stringArray` / `stringArrayEncoding`（`base64`・`rc4`） | `_0x3a86(0x1a4)` | デコーダをサンドボックス実行し、呼び出しを文字列リテラルに置換 |
| `stringArrayRotate` / `shuffle` | 先頭の `while(!![])` 回転IIFE | 同上（実行して初めて並びが確定するため） |
| `stringArrayWrappersType: function-call` | 多段プロキシ `_0x1e0595 → _0x340121 → _0x3a86` | 「引数を転送して返すだけ」の関数を検出し、呼び出し元へ畳み込む |
| `numbersToExpressions` | `-0x10 * -0x80 + 0x69 * -0x1 + ...` | `path.evaluate()` による定数畳み込み |
| `simplify` の副作用・真偽値難読化 | `!![]` / `![]` / `(!![])==true` | 同上（`UnaryExpression` を含めて評価） |
| `transformObjectKeys` | `_0xobj['a']['b']` の辞書経由アクセス | 定数キーのオブジェクトを追跡し、プロパティ参照をインライン展開 |
| — （ブラケット記法） | `Class["Method"]` | `MemberExpression` で `computed && StringLiteral` かつ識別子として合法なら `computed: false` へ |
| `controlFlowFlattening` | `switch` + 順序配列 `'3\|1\|0\|2\|4'.split('\|')` | 順序配列を静的に読み、ケース本体を元の順で並べ直す |
| `deadCodeInjection` | `if (_0x5f(0x1a4) === _0x5f(0x1a7)) {本物} else {ダミー}` | 文字列復元後に条件が定数になるので、偽枝を除去 |
| `selfDefending` | 整形すると壊れる自己検査コード | 検査関数の呼び出しを検出して除去（先に消さないと整形で自爆する） |
| `debugProtection` | `setInterval` + 再帰 `debugger` | 該当関数と呼び出しを除去、または DevTools の "Deactivate breakpoints" |

#### 制御フロー平坦化（control flow flattening）の解き方

平坦化は obfuscator.io の中で最も読解を阻害する変換である。元の逐次実行が、次のような「順序配列 + `while` + `switch`」に組み替えられる。

```javascript
var _0x263bb9 = '3|1|0|2|4'['split']('|'), _0x1a2 = 0x0;
while (!![]) {
  switch (_0x263bb9[_0x1a2++]) {
    case '0': var total = price * qty; continue;
    case '1': var qty   = getQty();    continue;
    case '2': render(total);           continue;
    case '3': var price = getPrice();  continue;
    case '4': return total;
  }
  break;
}
```

**なぜ読みにくいのか**：ソース上の並び（`case '0'`,`'1'`,…）と実行順（`3,1,0,2,4`）が無関係になり、人間が上から読むと依存関係が滅茶苦茶に見える。逆に**プログラムにとっては簡単**で、順序配列は静的な文字列リテラルなので、次の手順で機械的に戻せる。

1. `while (true)` 内が単一の `SwitchStatement` で、`discriminant` が `配列[カウンタ++]` の形である構造を検出する。
2. 順序配列の初期化式（`'3|1|0|2|4'.split('|')`）を `path.evaluate()` で評価し、`['3','1','0','2','4']` を得る。
3. 各 `SwitchCase` の `test`（ケースラベル）で本体を索引化し、順序配列の並びで `consequent` を連結する。末尾の `continue` は落とす。
4. `while` 文全体を、連結した文の配列で `path.replaceWithMultiple(statements)` する。

これで元の逐次コードが戻る。実装上の注意は、**カウンタ変数が途中で書き換えられていないこと**（`binding.constantViolations` が `++` だけであること）と、`case` 内に `break`/`return` が混在するケースの扱いである。条件を満たさない形は触らずに残すのが安全で、deobfuscator は**確実に戻せる形だけを戻し、残りは人間に回す**という設計が正しい。

#### self-defending と debug protection

`selfDefending` は、コード自身が「自分が整形（beautify）されていないか」を検査する。原理は **`Function.prototype.toString` が関数のソースをそのまま返す**という言語仕様の利用で、正規表現で自身のソースの空白配置を検査し、改行やインデントが入っていたら無限ループや例外に落ちる。したがって**整形する前に検査コードを取り除く**必要がある。AST上では「`toString` を呼び、その結果を正規表現テストにかけ、失敗時に自身を再帰呼び出しする」という特徴的な形を検出して `path.remove()` する。

`debugProtection` は `setInterval` で `debugger` 文を含む関数を繰り返し呼び、DevTools を開くと実行が止まり続ける。静的には該当関数と `setInterval` 呼び出しを除去し、動的には Chrome DevTools の「Deactivate breakpoints」（Ctrl/Cmd+F8）や Sources の該当行右クリック → "Never pause here" で無効化できる。いずれも**自分が解析権限を持つコードに対して**行う。

### 資料2：0xdevalias「Deobfuscating/Unminifying Obfuscated JavaScript」ツール集

0xdevalias の gist は、この領域の**生きた索引**である（継続更新されるリンク集＋著者コメント）。自作する前に「どこまでは既製品で足りるか」を見極めるのに使う。主要項目を整理する。

**難読化解除・unminify 本体**

- **webcrack**（j4k0xb）: obfuscator.io 出力の解除に加え、bundle の展開（unpack）まで行う。変換パイプライン方式で、deobfuscator モジュールが分離されている。gist 著者は「React ライブラリの識別がハードコードされたグローバルではなく動的判定になっている点」に課題があると注記している。現時点で obfuscator.io 系に対する第一選択。
- **wakaru**: 「JavaScript decompiler, unpacker and unminify toolkit」。webpack/browserify からの抽出と、ヒューリスティック規則による識別子リネームを持つ。著者は「ast-types の制約に由来する scoping issue が既知で、識別子リネームは100%正確ではない」と明記している。
- **Restringer**: 文字列の再構成とロジック単純化を、**スコープの制約を尊重しながら**行う。前処理／後処理（preprocessors/postprocessors）を備え、`Obfuscation Detector` モジュールで難読化方式を自動判定する。
- **humanify**: LLM（ChatGPT / llama2 等）で**変数名を人間可読な名前に付け直す**。Babel の AST レベルで束縛単位のリネームを行うため、意味等価性が保たれる（LLM にコードを書き直させるのではなく、名前だけを差し替えるのがミソ）。ローカル推論サーバにも対応。
- **js-beautify**: 「ブックマークレットや汚いJavaScriptを再整形・再インデントする」。obfuscator.io 出力を部分的に解除できる。
- **shapesecurity/unminify**: 「minifier や素朴な難読化が適用した多くの変換を逆適用する」。安全性レベルを設定できる。
- **de4js**: ブラウザ上で動く deobfuscator / unpacker。ユーザースクリプト統合あり。
- **JSNice**: 「統計的リネーム、型推論、難読化解除」。機械学習モデルによる命名推定。
- **obfuscator-io-deobfuscator**: obfuscator.io 出力専用。

**bundle 展開・source map 系**

- **debundle**（およびフォーク）: webpack/browserify バンドルからバンドル前のソース構成を再現する。著者は「v2 ブランチのほうが設定が少なく信頼性が高い」と注記。
- **webpack-exploder**: `*.map`（source map）から React/webpack アプリの元ソースを取り出す。
- **webpack-unpack**: webpack バンドルからのモジュール抽出。
- **retidy**: webpack/parcel バンドルの抽出・unminify・整形を一括で行う。

source map が公開されている場合、それが**最短経路**である点は強調に値する。map には元ファイル名・元ソース本文（`sourcesContent`）・識別子名（`names`）が含まれるため、難読化解除を試みる前に必ず `.map` の有無を確認する。

**パーサ／AST ライブラリ**

- **Babel**: 「コードをASTにパースして再生成することで変換する」。deobfuscation 用の変換プラグインが書ける豊富なエコシステム。
- **Acorn**: 「完全にJavaScriptで書かれた、小さく高速なJavaScriptパーサ」。ESTree の事実上の基準実装。
- **espree**: ESLint の Esprima 互換パーサ（Acorn ベース）。
- **swc**: Rust 製の高速パーサ／トランスフォーマ。
- **oxc**: 「SWC パーサより2倍速い」。Test262 および Babel/TypeScript テストへの適合を謳う。
- **esbuild**: 高速バンドラ兼トランスフォーマ、パーサ機能を持つ。
- **tree-sitter**: 言語非依存のパース＋パターンマッチクエリ。

**解析・可視化**

- **ast-grep**: 「コードのパターンで検索するAST ベースのツール」（Rust 製、30以上の言語、Playground と VSCode 拡張あり）。`innerHTML` への代入のような sink を構文的に検索するのに向く。
- **astexplorer.net**: 各種パーサの AST を可視化するWebツール（スコープチェーンの可視化は課題として issue が立っている）。
- **eslint-scope**: 「ECMAScript スコープ解析器」。変数参照の追跡を提供する。
- **code2flow**: JavaScript/Python/Ruby/PHP のコールグラフ生成。
- **joern**: 「code property graph に基づくオープンソースのコード解析プラットフォーム」。JavaScript、C/C++、Java バイナリに対応。

**LLM ベースの手法（時事性あり）**

humanify は、**LLM に変数名を付け替えさせつつ、AST レベルの検証で等価性を担保する**（実行による検証ではなく構造的検証）というアプローチの実証例である。評価面では **JsDeObsBench** というベンチマークが GPT-4o・Mixtral・Llama・DeepSeek-Coder を難読化解除タスクで比較しており、「構文の正確さと実行の信頼性」に課題が残ると報告されている。gist 著者はこのリーダーボードに対するベンチマークを追跡している。**実務上の含意は明確で、LLM は「名前付けと要約」には強いが、「構造の逆変換」は決定的なASTパスに任せるほうが確実**である。

著者コメントの中で繰り返し現れる論点は **スコープの正確性**である（wakaru の scoping issue、webcrack の issue #3 における unmangle identifier 対応、「複数のツールが変数リネーム時のスコープ精度に苦しんでいる」）。自作するときも、ここが品質の分かれ目になる。もう一つ、著者は **tree-sitter の出力から制御フローグラフ（CFG）を生成する**手段が欠けていることを、この領域の未解決ギャップとして挙げている。

> 出典: Deobfuscating / Unminifying Obfuscated Web App / JavaScript Code (0xdevalias gist) — https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581

### 実務ワークフロー：どの順で手を動かすか

1. **source map を探す**。`//# sourceMappingURL=` コメント、`.js.map` の直接取得、`sourcesContent` の有無を確認。あれば難読化解除は不要になる場合が多い。
2. **難読化方式を判定する**。Restringer 同梱の `Obfuscation Detector`、あるいは目視（`_0x` 識別子 + 先頭の `while(!![])` 回転IIFE なら obfuscator.io 系）。
3. **既製ツールを当てる**。obfuscator.io 系なら webcrack、バンドル解体なら webcrack / wakaru / debundle、素朴な minify なら shapesecurity/unminify。**ここで9割解ければ自作は不要**。
4. **残差を自作パスで潰す**。既製ツールが扱えないカスタム難読化（社内製の変換、特殊な辞書、独自の制御フロー平坦化）だけを、Babel の visitor として書く。1パス＝1変換で小さく作り、各パスの前後でコードが依然パース可能かをテストする。
5. **リネームで可読性を上げる**。`path.scope.rename()` による機械的リネーム（`_0x3a86` → `decodeStr` など）、必要なら humanify で一括命名。
6. **sink を構文検索する**。ast-grep や自作 visitor で `innerHTML` 代入、`eval`/`Function`、`document.write`、`location` 代入、`postMessage` ハンドラ、`JSON.parse(location.hash...)` などを列挙し、Lv5以降の動的追跡（DevTools ブレークポイント）に引き渡す。

### 検証の原則（防御目的での実施）

- 解析は**自分が権限を持つコード**（自社のバンドル、許諾のある検証環境、自分で難読化した教材サンプル）に対して行う。練習素材は obfuscator.io に自作コードを投入して自分で生成するのが最も安全かつ効果的で、**「難読化前の正解」が手元にあるため、自作 deobfuscator の正しさを差分で検証できる**という大きな利点がある。
- 復号器の実行は必ず隔離環境で。ブラウザコンソールでの直接 `eval` は、そのオリジンの権限でコードを動かす行為であり、素性の不明なコードには使わない。
- deobfuscator は**確実に戻せる形だけを戻す**。自信のない変換（`confident: false`、束縛が非定数、構造が想定外）は手を出さずに残す。誤った「解読」は、存在しない脆弱性を報告する誤検知と、本物の sink の見落としの両方を生む。

#### この節のチェックリスト

- [ ] astexplorer で `!![]`、`a["b"]`、`switch` 文のノード種別を自分で確認した
- [ ] Babel の parse → traverse → generate を通す最小スクリプトを書いた
- [ ] `path.evaluate()` による定数畳み込みパスを書き、`confident` の意味を説明できる
- [ ] `scope.getBinding()` / `binding.constant` / `scope.rename()` の役割を説明できる
- [ ] obfuscator.io で自作コードを難読化し、文字列配列・回転IIFE・平坦化を実物で観察した
- [ ] 復号器をサンドボックス（空コンテキスト + timeout）で実行する方式を実装した
- [ ] 制御フロー平坦化を順序配列から元の順序へ戻すパスを書いた
- [ ] webcrack / wakaru / Restringer を実際に動かし、自作が必要な残差を見極められる

## source mapの回収とソースツリー復元

前節までで、本番のフロントエンドが minify（識別子短縮・空白除去）や難読化を経て「読みにくいバンドル」として配信されることを見てきた。しかし現実には、そうした逆コンパイル的な苦労を **完全に不要にしてしまう**成果物がしばしば同じサーバに転がっている。それが **source map（ソースマップ）** である。

source map が公開されていれば、minify・トランスパイル前の **元ソース（TypeScript / JSX / Vue SFC など）を、コメント・変数名・ディレクトリ構造ごとほぼ丸ごと復元できる**。本節は「なぜそんなことが可能なのか」をファイル形式の内部仕様から解き、復元ツール（`unwebpack-sourcemap`、`sourcemapper`）が具体的に何をしているか、そしてこの露出がなぜ脆弱性として扱われるかを、防御側の視点で解説する。

> **スコープ注意**: 本節は防御目的（自社アプリの監査、CI での露出検知、修正設定の設計）で記述する。実在サービスや本番環境への無許可のアクセス・検証、破壊的な手順は扱わない。以降のツール実行例は、自分が管理する成果物、または明示的な許諾のある検証環境を対象とすること。

### source mapとは何か — なぜ「元ソースが復元できる」のか

現代のフロントエンドはブラウザにそのまま送られるわけではない。TypeScript・JSX・SCSS・最新構文が、webpack / Vite / esbuild / Rollup などの **バンドラ**によって、(1) トランスパイル（古いJSへ変換）、(2) バンドル（多数のモジュールを少数のファイルへ結合）、(3) minify（短縮）される。結果として配信される `main.abc123.js` は、行番号も変数名も元と一致しない別物になる。

これではブラウザの DevTools でデバッグできない。そこで **source map** が導入された。source map は「変換後コードの各位置（行・桁）が、変換前のどのファイルのどの位置に対応するか」を記述した **対応表（写像）**である。ブラウザはこれを読み込むと、DevTools 上で minify されたコードの裏に元ソースを重ね、あたかも元のコードをデバッグしているかのように振る舞える。

ここが本節の核心だが、source map は「位置の対応表」だけでなく、**元ソースの本文そのもの**を埋め込むことができる。次項で見る `sourcesContent` フィールドがそれで、これが存在する map ファイルは、実質的に **元ソースコードのアーカイブ**である。攻撃者・監査者から見れば、`.map` を1つ落とすだけでフロントエンドのソースツリー全体が手に入る。

> Source map exposure が生まれる根本原因は、多くのバンドラが「開発時のデバッグ利便」のために source map を生成し、その設定が本番ビルドに漏れ出す点にある。source map 自体は正常な機能であり、問題は **本番で誰でもダウンロードできる状態に置かれること**（= exposure）である。

### `.map` ファイルの内部構造 — Source Map Revision 3

source map は JSON ファイル（慣例的に `*.js.map`）で、フォーマットは **Source Map Revision 3**（`version: 3`）が事実上の標準である。主要フィールドは次の通り。

| フィールド | 意味 | 復元における重要度 |
| --- | --- | --- |
| `version` | フォーマット版。現行は `3` | 判別に使う |
| `file` | この map が対応する生成ファイル名（例 `main.js`） | 参考情報 |
| `sourceRoot` | `sources` の各パスに前置される基準パス | パス復元に影響 |
| `sources` | 元ファイルのパス配列（例 `webpack:///src/App.tsx`） | **ツリー構造の復元に使う** |
| `sourcesContent` | 各元ファイルの **本文（文字列）** の配列。`sources` と並行（同じ添字が対応） | **★ソース本文の復元源そのもの** |
| `names` | 元の識別子名の配列（minify で失われた変数名） | シンボル復元 |
| `mappings` | VLQ（可変長量）でエンコードされた位置対応データ | 位置マッピング用 |

復元ツールが決定的に依存するのは `sources` と `sourcesContent` の **2つの並行配列**である。`sources[i]` が「元ファイルのパス」、`sourcesContent[i]` が「そのファイルの中身」で、この2つを添字 `i` で対にして走査し、パスの位置に本文を書き出せば、元のディレクトリツリーが丸ごと復元できる。`mappings` の複雑な VLQ デコードは、位置対応が要らない「ソース復元」目的では **一切不要**である点に注意したい（ツールは `mappings` を無視する）。

生成ファイル側には、map の在り処を示す **`sourceMappingURL` コメント**が末尾に付く。

```javascript
//# sourceMappingURL=main.abc123.js.map
```

ブラウザはこのコメント、または HTTP レスポンスヘッダ `SourceMap:`（旧称 `X-SourceMap:`。TC39 / ソースマップ仕様で規定）を見て map を取得する。復元ツールもこの同じ手がかりを辿る。

> 出典: Source Map Exposure の解説と影響・対策 — https://www.raijuna.com/knowledge/source-map-exposure
> 出典: Abusing Exposed Sourcemaps (Sentry Blog) — https://blog.sentry.security/abusing-exposed-sourcemaps/

#### なぜ `sourcesContent` に本文が入るのか（バンドラの devtool 設定）

`sourcesContent` の有無・map の生成有無はバンドラ設定で決まる。webpack では `devtool` オプションがこれを制御し、値の名前が map の性質を表す。

| `devtool` の値 | 性質 |
| --- | --- |
| `source-map` | 完全な外部 `.map` を生成。`sourcesContent` に元本文を含む。本番で誤って露出すると全ソースが漏れる |
| `eval-source-map` | 各モジュールを `eval()` 内に map 付きで埋め込む（開発向け・高速） |
| `hidden-source-map` | map は生成するが `sourceMappingURL` コメントを付けない。ファイル名を推測されれば取得可能 |
| `cheap-module-source-map` | 桁情報を省いた軽量版。ただし本文は含みうる |
| `false` | source map を生成しない（本番推奨） |

要点は、`hidden-source-map` は「コメントを消すだけ」で map ファイル自体は配信ディレクトリに置かれることが多く、`main.js` → `main.js.map` と **ファイル名を推測して `.map` を付けるだけで取得できてしまう**ことである。「コメントを消したから安全」は誤りで、これは典型的な *security by obscurity（隠蔽による安全性）* の失敗にあたる。

> 出典: Devtool | webpack — https://webpack.js.org/configuration/devtool/
> 出典: Source Map Exposure — https://www.raijuna.com/knowledge/source-map-exposure

### source mapの発見方法

監査時、source map の露出は次の手順で確認できる（すべて自分の管理対象・許諾済み環境に対して）。

1. **`sourceMappingURL` コメントの確認**: 配信されている `.js` を取得し、末尾に `//# sourceMappingURL=...` があるか見る。相対URLなら `.js` の位置を基準に解決する。
2. **`.map` 直付け推測**: 観測した JS の URL に `.map` を付けて取得を試す（`hidden-source-map` の取りこぼしを拾う）。
3. **HTTP ヘッダ確認**: レスポンスに `SourceMap:` / `X-SourceMap:` ヘッダがないか。
4. **DevTools での読み込み**: 取得した map を DevTools の Sources パネルに読ませ、元ツリーが復元されるか目視。

正規表現ベースの `sourceMappingURL` 抽出は、ツール（後述）でも次のようなパターンで行われる。

```
\/\/\#\s*sourceMappingURL=(.*)$
```

行末（`$`）にマッチさせるのは、`sourceMappingURL` コメントが慣例的にファイル末尾（最終行）に置かれるためである。

> 出典: Source Map Exposure — https://www.raijuna.com/knowledge/source-map-exposure

### ツール(1): unwebpack-sourcemap（rarecoil）

rarecoil の記事「SPA source code recovery by un-Webpacking source maps」は、この復元手法を広く知らしめた古典的資料である。中心的な主張は次の一点に集約される。**JavaScript バンドルはコンパイル済みバイナリのような「中間表現」だが、source map を一緒に配ってしまうと、バイナリにソースコードを添付して出荷するのと同じことになる。** その結果、コメントアウトされた関数、開発者名やメールアドレス、ドキュメント文字列、想定される API レスポンス例までもが、元ソースとして復元されてしまう。

> ⚠️ **未取得の資料**: 「SPA source code recovery by un-Webpacking source maps（rarecoil, Medium, 2019-06-13）」は自動取得できませんでした（理由: Medium が HTTP 403 Forbidden を返しブロック）。以下のURLからご自身で直接ご覧ください: https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d
> なお、記事本文で解説されている手法・ツールの実体は、著者自身の公開リポジトリ `rarecoil/unwebpack-sourcemap` から復元できたため、以下はそのリポジトリ（README・ソースコード）に基づく忠実な解説である。

`unwebpack-sourcemap` は Python 3 製のツールで、`sourcesContent` を持つ webpack source map から元ソースツリーを再構築する。依存は `requests` と `BeautifulSoup4`。3つの動作モードを持つ。

```bash
# ローカルの .map を処理
./unwebpack_sourcemap.py --local /path/to/source.map output/

# リモートの .map を直接取得して展開
./unwebpack_sourcemap.py https://example.com/source.map output/

# HTML から自動検出: <script src> を辿り JS を集め、sourceMappingURL を探して map を回収
./unwebpack_sourcemap.py --detect https://example.com/spa_root/ output/
```

主な CLI フラグ:

- `--local (-l)`: リモートではなくローカルファイルを処理
- `--detect (-d)`: 取得した HTML 内の JS アセットから source map を自動検出
- `--make-directory`: 出力先ディレクトリを無ければ作成
- `--dangerously-write-paths`: 信頼できないソースから来た **フルパスをそのまま書き込む**（危険。後述のパストラバーサル保護を無効化する意味を持つ）
- `--disable-ssl-verification`: SSL 証明書検証をスキップ

> 補足（バージョン/状態）: 本リポジトリは 2022年4月にアーカイブ済み（メンテ停止）。動作原理の学習には十分だが、現行環境では後述の `sourcemapper`（Go製）も併せて検討するとよい。

> 出典: unwebpack-sourcemap README / source — https://github.com/rarecoil/unwebpack-sourcemap

#### コアロジック: `_parse_sourcemap`

復元の中核は、`sources` と `sourcesContent` を `zip` で対にして走査し、各本文をサニタイズ済みパスへ書き出す部分である。実物のコードを見ると、`mappings` を一切触らず、2配列だけで復元が完結していることが分かる。

```python
def _parse_sourcemap(self, target, is_str=False):
    # ... map_data を読み込み ...
    try:
        map_object = json.loads(map_data)
    except json.JSONDecodeError:
        print("ERROR: Failed to parse sourcemap %s. Are you sure this is a sourcemap?" % target)
        return False

    # sources と sourcesContent が両方無ければ復元不能
    if 'sources' not in map_object or 'sourcesContent' not in map_object:
        print("ERROR: Sourcemap does not contain sources and/or sourcesContent, cannot extract.")
        return False

    # 添字対応が崩れていれば警告（ファイル名と中身がずれる可能性）
    if len(map_object['sources']) != len(map_object['sourcesContent']):
        print("WARNING: sources != sourcesContent, filenames may not match content")

    # ★ 2つの並行配列を zip して対にし、パスへ本文を書き出す
    for source, content in zip(map_object['sources'], map_object['sourcesContent']):
        write_path = self._get_sanitised_file_path(source)   # パスをサニタイズ
        if write_path is None:
            print("ERROR: Could not sanitize path %s" % source)
            continue
        os.makedirs(os.path.dirname(write_path), mode=0o755, exist_ok=True)
        with open(write_path, 'w', encoding='utf-8', errors='ignore', newline='') as f:
            print("Writing %s..." % os.path.basename(write_path))
            f.write(content)
```

なぜこれで復元できるのか。`sources[i]`（例 `webpack:///src/components/Button.tsx`）が **どこに書くか**を、`sourcesContent[i]`（そのファイルの生テキスト）が **何を書くか**を与える。この対応は map 仕様上「同じ添字が同じファイルを指す」と保証されているため、単純な `zip` で元のツリーが再現できる。`sourcesContent` が無い map（`sources` だけの map）は本文を持たないので、このツールは「復元不能」として明示的に弾く。

> 出典: unwebpack-sourcemap source (unwebpack_sourcemap.py) — https://github.com/rarecoil/unwebpack-sourcemap/blob/master/unwebpack_sourcemap.py

#### なぜパストラバーサル対策が要るのか（`webpack:///` と `../`）

ここが「復元ツールを自作・実行する側」が必ず理解すべき論点である。map の `sources` は **信頼できない入力**である。攻撃者が map を細工すれば、`sources` に `webpack:///../../../../etc/passwd` のようなパスを仕込める。ツールがこれを素直に `os.path.join(outdir, source)` すると、**出力ディレクトリの外へファイルを書き出す**（= 任意ファイル書き込み・パストラバーサル）危険が生じる。復元ツールは「攻撃者が用意した map を解析する」ことがまさに用途なので、この防御は必須である。

`unwebpack-sourcemap` の `_get_sanitised_file_path` は、まず `webpack:///` プレフィックスと相対パス記法を無害化（defang）する。

```python
def _get_sanitised_file_path(self, sourcePath):
    """Sanitise webpack paths for separators/relative paths"""
    sourcePath = sourcePath.replace("webpack:///", "")   # 疑似スキームを除去
    exts = sourcePath.split(" ")
    if exts[0] == "external":
        print("WARNING: Found external sourcemap %s, not currently supported. Skipping" % exts[1])
        return None

    path, filename = os.path.split(sourcePath)
    if path[:2] == './':                 # 先頭の ./ を除去
        path = path[2:]
    if path[:3] == '../':                # ★ ../ を親ディレクトリ脱出させず
        path = 'parent_dir/' + path[3:]  #    literal な 'parent_dir/' に置換して無害化
    if path[:1] == '.':                  # 残る先頭 . を空に
        path = ""
    filepath = self._path_sanitiser.make_valid_file_path(path, filename)
    return filepath
```

肝は `../` を「親へ上がる制御」としてではなく **文字列 `parent_dir/` に置換**する点である。これで `../` の意味論的な脱出能力が消える。しかしこの前処理だけでは取りこぼしがあるため、最終防衛線として `PathSanitiser` が絶対パスに正規化してから「本当に出力ルート配下か」を検証する。

```python
def make_valid_file_path(self, path=None, filename=None):
    root_path = self.get_root_path()
    # ... path/filename をファイルシステム的に無害化して結合 ...
    complete_path = os.path.abspath(complete_path)          # 絶対パスへ正規化
    if self.check_if_path_is_under(root_path, complete_path):
        return complete_path                                # ルート配下なら許可
    else:
        return None                                         # 脱出していたら拒否（=書き込まない）

def check_if_path_is_under(self, parent_path, child_path):
    child_parts  = self.path_split_into_list(child_path)
    parent_parts = self.path_split_into_list(parent_path)
    if len(parent_parts) > len(child_parts):
        return False
    # child のパス要素の先頭が parent のパス要素と完全一致するか
    return all(part1 == part2 for part1, part2 in zip(child_parts, parent_parts))
```

`os.path.abspath` で `..` を解決した後にルート配下判定を行うのが正攻法である。パス文字列を単純比較するのではなく、**要素（ディレクトリ名）のリストに分割して先頭一致を見る**ことで、`/root_evil` が `/root` 配下と誤判定される「プレフィックス文字列一致」の罠を避けている。ルート外なら `None` を返し、呼び出し側は書き込みをスキップする。前述の `--dangerously-write-paths` は、この保護をあえて外して「map に書かれたフルパスのまま書き出す」フラグであり、信頼できる map にのみ使うべきものだ。

> 出典: unwebpack-sourcemap source — https://github.com/rarecoil/unwebpack-sourcemap/blob/master/unwebpack_sourcemap.py

#### 検出モード（`--detect`）の仕組み

`--detect` は「SPA のルート URL から始めて map を自動発見する」モードで、内部の `_detect_js_sourcemaps` は次を行う。

1. 対象 URL の HTML を取得
2. `BeautifulSoup` で `<script src>` タグを抽出
3. 各 JS を取得し、**最終行**を正規表現 `\/\/\#\s*sourceMappingURL=(.*)$` で検査
4. 相対 map URL を JS の位置を基準に絶対化
5. 検出した map URI 群を返し、順に展開

このモードはリモートの JS をダウンロードして中身を辿る性質上、**細工した JS を食わせると任意 URL へ取得要求を出させる（SSRF 的な悪用）**余地がある点に注意する。監査時は対象を自分の管理下に限定すること。

> 出典: unwebpack-sourcemap README — https://github.com/rarecoil/unwebpack-sourcemap

### ツール(2): sourcemapper（Go製）

`denandz/sourcemapper` は同じ目的（source tree の再構築）を Go で実装したツールで、シングルバイナリで動く・並行処理・プロキシや独自ヘッダ対応など、実務的な取り回しの良さが特徴である。設計は `unwebpack-sourcemap` と本質的に同じで、`sourceMap` 構造体は `Version`（期待値 3）・`Sources`・`SourcesContent` を持ち、**2つの並行配列を同時に走査**して元ツリーを書き出す。

2つの動作モードを持つ。

```bash
# モード1: -url で .map を直接指定して取得・展開
sourcemapper -url https://example.com/bundle.js.map -outdir ./sources

# モード2: -jsurl で JS を指定し、そこから map を発見して展開
sourcemapper -jsurl https://example.com/bundle.js -outdir ./sources

# ネットワーク制御（プロキシ経由・独自ヘッダ・証明書検証スキップ）
sourcemapper -url map.js.map -outdir ./out -proxy http://proxy:8080 \
  -header "Authorization: Bearer token" -insecure
```

主な設定項目（`config` 構造体）:

- `outdir`: 展開先ディレクトリ（必須）
- `url` / `jsurl`: map 直指定 / JS からの発見（相互排他）
- `proxy`: 上流プロキシ（Burp などへ通す）
- `insecure`: TLS 証明書検証のスキップ
- `headers`: `-header` を複数指定でき、`textproto.Reader` で HTTP ヘッダとして解釈される（Go の `flag.Value` を実装した `headerList` 型で累積）

`-url` の取得（`getSourceMap()`）は3プロトコルに対応する: **HTTP/HTTPS**、**Data URI**（Base64 で URL に埋め込まれた map。`eval-source-map` 系や inline map で現れる）、**ローカルファイル**。`-jsurl` モードは (1) JS を取得 → (2) まず HTTP ヘッダ（TC39 仕様の `SourceMap:`）を確認し、無ければ `sourceMappingURL` コメントを解析 → (3) 発見した map を取得、という3段構えで map を探す。ここでも「細工した JS が任意 URL へ要求を出させうる」点が明記されており、`unwebpack-sourcemap` と同じ SSRF 的リスクを共有する。

パスの扱いも同様で、特に Windows 向けにプラットフォーム固有のパスクリーニングを行い、ファイル書き込み時のディレクトリトラバーサルを防ぐ。出力は `sources` 配列の構造に従い、例えば `webpack:/app/components/Button.js` は出力ルート下に同じ階層を作って書き出される。

> 出典: sourcemapper（DeepWiki） — https://deepwiki.com/denandz/sourcemapper

#### 2ツールの使い分け

| 観点 | unwebpack-sourcemap (Python) | sourcemapper (Go) |
| --- | --- | --- |
| 実行形態 | Python 3 + 依存パッケージ | シングルバイナリ |
| HTML からの自動検出 | `--detect` あり | `-jsurl`（単一 JS 起点） |
| Data URI / inline map | 主に外部 map 向け | `getSourceMap` が Data URI 対応 |
| プロキシ/ヘッダ | SSL 検証スキップ等 | `-proxy` / `-header` が充実 |
| メンテ状態 | 2022年アーカイブ | 継続的（Go 実装） |

どちらも「`sources` × `sourcesContent` を対で書き出す」中核は同じである。CI に組み込んで「自社の本番 URL に map が露出していないか」を定期チェックする用途では、依存の少ない Go 版が扱いやすい。

### 露出の実被害 — Sentry Blog の実例

Sentry Security Blog「Abusing Exposed Sourcemaps」は、露出した map が単なる情報漏洩を超えて **アカウント乗っ取りの起点**になった実例を示している。ポイントは「UI から消えても、バックエンドの機能は生きている」ことが map から露見する構図である。

研究者は対象アプリの露出 `.map` を復元し、UI からは呼ばれていないのにコード上は生きている関数 `updateUserData` を発見した。

```json
{
  key: "updateUserData",
  value: function updateUserData(account, userId, email, firstName,
  lastName, password, accessToken) {
    var path = '/user/update-user-data';
    var body = { account, userId, email, firstName, lastName, password, accessToken };
    return this.request.post(body, path);
  }
}
```

この関数は「ユーザーID・メール・パスワード等を受け取り、`/user/update-user-data` に POST する」ことを、**エンドポイントのパスとパラメータ名まで丸ごと**明かしている。攻撃連鎖は次の通り。

1. **列挙**: `/account/user-lookup/` を使って有効なユーザーを特定し、`userId` を取得。
2. **不正更新**: 判明した `/user/update-user-data` に、`password` を差し替えた POST を送る。応答は `HTTP 200 OK` で、認証情報の変更が成立した。

つまり map から得たのは「隠されていたはずのエンドポイントの完全な仕様」であり、それがそのまま **認可されていないパスワード変更 = アカウント乗っ取り**に繋がった。記事はこの教訓を *"obscurity is not security"（隠蔽は安全性ではない）* とまとめ、UI から要素を消しても対応するバックエンド機能を無効化しない限り悪用可能だと強調する。

同記事は他にも、map 経由で **ハードコードされた Stripe の API シークレットキー**が露出した事例を挙げている。復元後の探索は単純な grep で足りる。

```bash
# 復元ツリー内から機密の痕跡を探す（自分の成果物・許諾環境に対してのみ）
grep -r "API_KEY" output/
grep -r "password" output/
grep -rE "sk_live_|secret|token|Bearer " output/
```

> 出典: Abusing Exposed Sourcemaps (Sentry Blog) — https://blog.sentry.security/abusing-exposed-sourcemaps/

### 影響の整理と分類

source map の露出（Source Map Exposure）は、単体で直接コードを実行させる脆弱性ではないが、**偵察（recon）を桁違いに加速する**点で重大に扱われる。手作業のエンドポイント列挙を「`.map` を1つ落とす」だけに置き換えてしまうからだ。露出により典型的に判明するもの:

- **内部 API ルート**: 公開ドキュメントにないエンドポイントのパス・メソッド・パラメータ・レスポンス構造
- **コメント内の資格情報**: ビルド時点のコメントに残った API キー・トークン
- **ビジネスロジック**: クライアント側バリデーション規則、フィーチャーフラグ、権限チェックの実装
- **サードパーティ連携**: 設定定数、Webhook URL、サービス識別子
- **アーキテクチャ詳細**: 内部サービス名、マイクロサービスのエンドポイント、インフラ構成の手掛かり

分類・重大度（Raijuna の解説より）:

- **OWASP**: A05:2021（Security Misconfiguration / セキュリティ設定ミス）
- **CWE**: CWE-540（Inclusion of Sensitive Information in Source Code）
- **一般的な深刻度**: High（ただし復元された内容の機微さに依存する）
- **攻撃フェーズ**: 偵察の加速。大規模な脆弱性同定を容易にする

> 出典: Source Map Exposure — https://www.raijuna.com/knowledge/source-map-exposure

### 防御 — 露出させないための設定

修正の第一選択は **本番で source map を生成・配信しない**ことである。バンドラ別の設定と、配信層での遮断を組み合わせる。

**webpack（本番ビルド）:**

```javascript
// webpack.config.js
module.exports = {
  mode: 'production',
  devtool: false,   // 本番出力に source map を含めない
};
```

**主要バンドラ/フレームワークの既定と要注意点:**

| ツール | 本番設定 | 注意 |
| --- | --- | --- |
| webpack | `devtool: false` | 一部プリセットで既定有効。`hidden-source-map` はコメントを消すだけで map 自体は残るので不十分 |
| Vite | `build.sourcemap: false` | 本番は既定で無効。ただし明示 `true` に注意 |
| Rollup / esbuild | `sourcemap: false` | 設定次第。CI で出力を確認 |
| Create React App | `GENERATE_SOURCEMAP=false` | ビルド時の環境変数で抑止 |

**配信層での遮断（生成が避けられない場合の多層防御）:**

```nginx
# nginx: .map への要求を拒否
location ~* \.map$ {
    deny all;
    return 403;
}
```

代替として、map を生成しても **デプロイ成果物から `.map` を除外**する、あるいは **認証必須の内部パスにのみ配置**して Sentry などのエラートラッキングにだけ読ませる運用が有効である。`hidden-source-map` を使う場合でも、ファイル名推測で取得されうるため、必ず配信層の遮断か認証と併用すること。

さらに Sentry Blog の教訓を制度化するなら、**「UI から機能を消すときは、対応するバックエンドのエンドポイントも同時に無効化する」**ことをリリース手順に組み込む。map の露出対策と、隠れエンドポイントの棚卸しは、セットで初めて意味を持つ。

> 出典: Source Map Exposure — https://www.raijuna.com/knowledge/source-map-exposure
> 出典: Abusing Exposed Sourcemaps (Sentry Blog) — https://blog.sentry.security/abusing-exposed-sourcemaps/

### まとめ

- source map は minify/トランスパイル後コードと元ソースの対応表だが、`sourcesContent` フィールドに **元ソース本文を丸ごと埋め込む**ため、露出すればフロントエンドのソースツリー全体が漏れる。
- 復元の中核は `sources` と `sourcesContent` の **2つの並行配列を対で書き出す**だけで、`mappings` の VLQ デコードは不要。`unwebpack-sourcemap`（Python, 2022アーカイブ）と `sourcemapper`（Go）は共にこの原理で動く。
- map の `sources` は信頼できない入力なので、復元ツールは `../` の無害化・絶対パス正規化・ルート配下判定で **パストラバーサル**を防ぐ。`--detect` / `-jsurl` は細工 JS による **SSRF 的悪用**の余地があるため、対象は自分の管理下に限る。
- 露出は OWASP A05:2021 / CWE-540 に相当し、偵察を劇的に加速する。実例では隠れエンドポイント `/user/update-user-data` の露見からアカウント乗っ取りに至った。
- 防御は「本番で生成しない（`devtool: false` 等）」を第一に、配信層での `.map` 遮断・認証保護、そして「UI 撤去とバックエンド無効化をセットで行う」運用を組み合わせる。

## JSからのエンドポイント・シークレット抽出ツール

クライアントサイド脆弱性のハンティングにおいて、配信されているJavaScriptファイル自体は最も情報密度の高い偵察対象の一つである。ビルド時にminify・bundleされていても、フロントエンドは最終的にブラウザ上で平文として実行されなければならないため、APIのエンドポイントURL、内部パス、デバッグ用フラグ、そして場合によっては本来サーバーサイドに留めるべきAPIキーやトークンまでもがJSファイルの中にそのまま埋め込まれてしまうことがある。これらは攻撃対象領域（attack surface）を広げるための「隠れた入口」であり、XSSのsink（ユーザー入力が最終的に実行・解釈される危険な代入先、例えば`innerHTML`への代入や`eval()`呼び出し）を探す前段階として、まずどのエンドポイントが存在し、どのようなパラメータを受け取るのかを機械的に洗い出す作業が欠かせない。本節では、この「JS静的解析による情報抽出」を自動化する代表的な2つのツール（LinkFinder、SecretFinder）と、周辺ツールの見つけ方について解説する。

なお、本節で扱う内容はすべて防御目的、すなわち自組織が保有する資産や許可を得た対象に対する脆弱性診断・セキュリティレビューを想定している。実在の第三者サービスや本番環境に対する無許可の走査・検証は行ってはならない。

### なぜJSファイルにエンドポイントやシークレットが漏れるのか（仕組みの原理）

現代のSPA（Single Page Application）は、React/Vue/Angularなどのフレームワークでビルドされ、Webpack・Vite・Rollupといったバンドラによって複数のソースファイルが1つ、あるいは少数の`.js`ファイルに結合される。このビルドプロセスは「難読化（obfuscation）」ではなく「圧縮（minification）」に過ぎない場合が多く、変数名は`a`や`t`のように短縮されても、文字列リテラル――すなわちAPIのベースURL、パスパターン、環境変数から埋め込まれたキーなど――はほぼそのまま残る。これは、JavaScriptエンジン（V8など）が実行時にreflectionや文字列連結でURLやキーを組み立てるコードを解釈する必要があるためであり、コンパイル型言語のように定数をバイナリのシンボルテーブルへ隠すことができない、という言語仕様上の制約に起因する。

さらに、`.env`ファイルの内容をビルド時にバンドルへインライン化するツール（`dotenv-webpack`や`create-react-app`の`REACT_APP_`プレフィックス変数など）を誤って設定すると、本来サーバーサイドのみに存在すべき秘密鍵がクライアントバンドルへ焼き込まれてしまう事故が起きる。これはツールの脆弱性ではなく設定ミスだが、攻撃者（および防御側の診断者）から見れば「JSファイルをテキストとして正規表現でスキャンするだけで機密情報が取れる」という非常にコストの低い偵察手段になる。LinkFinderやSecretFinderはこの原理を利用し、正規表現とJavaScript構文の軽量な整形（beautify）を組み合わせて、人間が目視するには非現実的な量のミニファイ済みコードから機械的にパターンを抽出する。

### LinkFinderによるエンドポイント抽出

#### 目的と位置づけ

LinkFinder（GerbenJavado作）は、JavaScriptファイルの中に隠れているエンドポイントとそのパラメータを発見するために設計されたPython製スクリプトである。ペネトレーションテスターやバグバウンティハンターが、対象アプリケーションの「まだ見つかっていない」APIエンドポイントを洗い出す目的で広く使われてきた、この分野の草分け的ツールである。

> 出典: LinkFinder README — https://github.com/GerbenJavado/LinkFinder

#### 仕組み

LinkFinderは`jsbeautifier`ライブラリでミニファイされたJSを整形しつつ、大規模な正規表現（複数の小さなパターンを`|`で結合したもの）でURLやパスらしき文字列リテラルを走査する。抽出対象は次の4パターンに大別される。

1. 完全な絶対URL（`https://example.com/api/...`のようにスキームを含むもの）
2. ドット表記を含む絶対/相対URL（`/api/v1/...`や`../assets/...`）
3. 少なくとも1つのスラッシュを含む相対パス（`text/test.php`）
4. スラッシュを含まない単純な相対パス（`test.php`）

この段階的なパターン分割が重要な理由は、単一の巨大な正規表現でURLらしきものを一括りに拾おうとすると、CSSのクラス名や単なる文字列比較（例：`if (a === "error")`）まで大量に誤検出（false positive）してしまうためである。パターンを「スキームあり／ドット付きパス／スラッシュ付き相対パス／単純ファイル名」の階層で分けることで、後段のフィルタリング（`-r`オプションによる正規表現絞り込み）と組み合わせてノイズを抑えられる設計になっている。

#### インストール

```bash
git clone https://github.com/GerbenJavado/LinkFinder.git
cd LinkFinder
python setup.py install
pip3 install -r requirements.txt
```

Python 3系での動作を前提としており、依存モジュールは`argparse`と`jsbeautifier`のみと軽量だが、READMEの記述時点（Python 3系サポート明記）以降にリリースされたPythonのマイナーバージョンでは、`setup.py install`を使う古いインストール手順自体がPython 3.12以降で非推奨（`distutils`廃止の影響）となっているため、環境によっては`pip install .`や仮想環境（`venv`）を使った代替インストールが必要になる点に注意が必要である。これはツール自体の欠陥ではなく、Pythonエコシステムの世代交代によって古いツールほどセットアップで詰まりやすい、という一般的な傾向の一例である。

#### 使い方

```bash
# 単一のJSファイルをHTMLレポートに出力
python linkfinder.py -i https://example.com/1.js -o results.html

# CLI（標準出力）にそのまま出す
python linkfinder.py -i https://example.com/1.js -o cli

# ドメイン全体をクロールして参照されているJSをまとめて解析
python linkfinder.py -i https://example.com -d

# Burp Suiteでエクスポートしたトラフィックファイルを入力にする
python linkfinder.py -i burpfile -b

# ローカルのJSファイル群から /api/ で始まるパスだけ抽出
python linkfinder.py -i 'Desktop/*.js' -r ^/api/ -o results.html
```

主なオプションは以下の通り。

| オプション | 説明 |
|---|---|
| `-i` / `--input` | 入力（単一URL、ローカルファイル、ワイルドカード付きフォルダ、Burpファイル） |
| `-o` / `--output` | 出力先。省略時は`output.html`、`cli`指定で標準出力 |
| `-r` / `--regex` | 抽出結果をさらに絞り込むための正規表現フィルタ |
| `-d` / `--domain` | 指定ドメイン配下を丸ごと解析する再帰モード |
| `-b` / `--burp` | Burp Suiteのエクスポートファイルを入力として扱う |
| `-c` / `--cookies` | 認証が必要なJS取得のためにクッキーを付与 |

> 出典: LinkFinder README — https://github.com/GerbenJavado/LinkFinder

#### 防御的な観点での使いどころ

診断者側の立場では、自組織のフロントエンドバンドルに対してLinkFinderを走らせ、「意図せず露出しているinternal API」「デバッグ用/テスト用に残されたエンドポイント（`/admin/debug`など）」を洗い出し、アクセス制御や認可（authorization）の観点で本当に公開してよい設計になっているかをレビューする、という使い方が中心になる。抽出結果はあくまで「候補」であり、実在性や到達可能性は許可を得た環境で個別に確認する必要がある。

### SecretFinderによるシークレット検出

#### 目的と仕組み

SecretFinder（m4ll0k作）はLinkFinderをベースに派生した、JavaScriptファイル中の機密情報――APIキー、アクセストークン、認可ヘッダ、JWT（JSON Web Token）など――を発見するために書かれたPythonスクリプトである。LinkFinderと同じく`jsbeautifier`による整形と正規表現マッチングを組み合わせているが、URLパターンではなく「機密情報らしい文字列の形」を検出するための、サービスごとに個別化された正規表現群を持つ点が異なる。

> 出典: SecretFinder README — https://github.com/m4ll0k/SecretFinder

対応するシークレットの種類は多岐にわたり、代表的なものは次の通りである。

- Google API キー / Google Captcha キー / Google OAuth トークン
- Amazon AWS アクセスキー、AWS MWS（Marketplace Web Service）認証トークン
- Facebook アクセストークン
- Mailgun API キー、Twilio API キー
- PayPal Braintree、Square、Stripe の認証情報
- GitHub アクセストークン
- RSA / DSA / EC 秘密鍵、PGP秘密鍵ブロック（`-----BEGIN ... PRIVATE KEY-----`のようなPEM形式のヘッダ文字列を検出の起点にする）
- JWT（`eyJ`で始まるBase64URLエンコードされた3パート構造を検出）

これらの多くは「サービス固有のプレフィックス＋固定長の英数字」という形式的特徴を持つため、正規表現による検出と非常に相性が良い。例えばAWSのアクセスキーIDは`AKIA`で始まる20文字の英数字という固定フォーマットを持ち、Google APIキーは`AIza`で始まる39文字という具合に、各ベンダーがキー発行時に埋め込む識別用プレフィックスが、皮肉にも検出側にとっての強力なシグネチャになっている。JWTについても、ヘッダ部（`{"alg":"HS256","typ":"JWT"}`など）をBase64URLエンコードすると必ず`eyJ`という3文字から始まるという構造的な性質を利用している。

#### インストールと使い方

```bash
git clone https://github.com/m4ll0k/SecretFinder.git secretfinder
cd secretfinder
python -m pip install -r requirements.txt
```

```bash
# 単一ファイルを解析してHTMLレポートに出力
python3 SecretFinder.py -i https://example.com/1.js -o results.html

# 標準出力にそのまま結果を出す
python3 SecretFinder.py -i https://example.com/1.js -o cli

# ページ内で参照されているJSリンクを自動抽出して丸ごと解析（-eオプション）
python3 SecretFinder.py -i https://example.com/ -e

# 独自の正規表現を追加して特定パターンだけ拾う
python3 SecretFinder.py -i https://example.com/1.js -r 'apikey=my.api.key[a-zA-Z]+'
```

主なオプション一覧。

| オプション | 説明 |
|---|---|
| `-i INPUT` | 入力URL・ファイル・フォルダ |
| `-e` | ページ内のJavaScriptリンクを抽出して連鎖的に処理する |
| `-o OUTPUT` | 出力先（デフォルト`output.html`、`cli`で標準出力） |
| `-r REGEX` | 抽出をカスタム正規表現で絞り込み |
| `-b` | Burp Suiteエクスポートファイルへの対応 |
| `-c COOKIE` | 認証用クッキーの付与 |
| `-g IGNORE` | 指定文字列を含むJSファイルを除外 |
| `-n ONLY` | 指定文字列を含むJSファイルのみ処理 |
| `-H HEADERS` | カスタムHTTPヘッダーの付与 |
| `-p PROXY` | プロキシ経由でのリクエスト（Burp等での中継確認に有用） |

> 出典: SecretFinder README — https://github.com/m4ll0k/SecretFinder

#### 検出後の扱いに関する注意（防御目的の運用）

SecretFinderが「シークレットらしき文字列」を検出しても、それが本当に有効な（revokeされていない）認証情報かどうかは別問題である。自組織の診断であっても、検出したキーをそのまま外部APIに投げて有効性を確認する行為は、対象サービスの利用規約や倫理的な境界を踏み越える可能性があるため、まずは「このキーがクライアントに露出していること自体が設計上の問題である」という観点で報告し、キーのローテーション（無効化・再発行）を担当チームに促す、という防御的な運用が基本になる。またクライアントサイドに秘密鍵を置く設計そのものが誤りであり、根本対策は「サーバーサイドプロキシ経由でAPIを呼び出す」「公開しても問題のないスコープに制限されたキーのみをクライアントに渡す」というアーキテクチャ変更である。

### 周辺ツールの探し方：awesome-bugbounty-toolsとメンテナンス状況の確認

LinkFinderとSecretFinderはいずれも開発が比較的落ち着いている（≒更新頻度が低い）プロジェクトであり、Python 2系時代の設計を引きずっている部分もあるため、実運用では後継・類似ツールもあわせて把握しておく価値がある。vavkamil氏がまとめているキュレーションリスト「awesome-bugbounty-tools」には、JS解析・エンドポイント抽出・シークレット検出のカテゴリに複数のツールが列挙されている。

- **jsluice**（Go製）: 「JavaScriptファイルからURL、パス、シークレット、その他の興味深い情報を抽出する」ツールとして紹介されており、Goで書かれているためPythonのような依存関係地獄（`jsbeautifier`のバージョン不整合など）が起きにくく、近年の後継候補として言及されることが多い。
- **jsleak**: JavaScriptやソースコードからシークレット・パス・リンクを検出する類似ツール。
- **jsfinder**: HTMLソースコード中にリンクされたJavaScriptファイルのURLをスキャンする、収集フェーズに特化したツール。
- **gitleaks / truffleHog**: JS内ではなくGitリポジトリのコミット履歴に対してシークレットを検出するツールであり、対象がクライアントJSではなくソース管理システムである点でLinkFinder/SecretFinderと役割が異なるが、「シークレットの偶発的なコミット」という同根の問題に対応する。

> 出典: awesome-bugbounty-tools — https://github.com/vavkamil/awesome-bugbounty-tools

このリスト自体からは、各ツールの明示的な「メンテナンス状況（最終更新日やアーカイブ有無）を確認する方法」についての直接的な記述は得られなかった。実務上は、リストに掲載されたGitHubリンクを開き、各リポジトリの「最終コミット日時」「Issuesの放置状況」「Archivedバッジの有無」を確認することが、ツールを選定する際の標準的なチェック方法になる。LinkFinder・SecretFinderのようにPython 2系文化を引きずったツールを2026年時点で使う場合は、事前に`venv`で隔離した環境を用意し、`requirements.txt`のバージョン固定が古いことによる依存関係エラー（特に`jsbeautifier`や`chardet`まわり）に備えておくとよい。

### まとめ：JS偵察ツールを使う際の実務フロー

1. 対象アプリケーション（許可を得た範囲）のHTMLから参照されている全JSファイル（インライン・外部の両方、`.map`ソースマップの有無も含む）を列挙する。
2. LinkFinderで隠れたエンドポイント候補を抽出し、`-r`オプションで社内APIらしきパス（`/internal/`、`/admin/`、`/v2/`など）を優先的にフィルタする。
3. SecretFinderで同じJS群を走査し、APIキー・トークンらしき文字列を検出する。検出結果は「有効性の検証」ではなく「そもそもクライアントに露出していること」自体を問題として扱う。
4. 抽出したエンドポイントは、認可制御（IDOR、権限昇格の可能性）やXSSのsinkとの接続関係（例：URLパラメータがそのままDOMに書き込まれていないか）を調べる次工程への入力として使う。
5. ツール自体がPython 2系由来で環境依存が強い場合は、Go製の後継（jsluiceなど）や、`node`ベースの静的解析（AST解析によるsink検出）と併用し、正規表現ベースの手法だけに依存しない多層的な偵察を行う。

このように、LinkFinder・SecretFinderは「JSを文字列としてスキャンする」という単純だが強力な原理に基づいており、ビルドツールの仕組みとJavaScriptの言語特性（文字列リテラルが実行時までそのまま残る）を理解していれば、なぜこの手法が有効なのかが腑に落ちるはずである。

## JS recon の実践フローと誤検知の選別

クライアントサイド脆弱性ハンティングにおいて、対象アプリケーションの JavaScript（JS）ファイル群は「未整理のソースコード開示」に等しい情報量を持つ。サーバーサイドのロジックはブラックボックスのままでも、フロントエンドは必ずブラウザに配信されるため、バンドルされた JS を収集・展開・grep することで、内部 API のエンドポイント、認可ロジックの分岐、デバッグ用のフラグ、そして時に本番のシークレット（APIキー、トークン）までが読み取れる。本節では、この「JS recon（JavaScript reconnaissance、JS偵察）」を再現性のあるパイプラインとして構築する方法と、パイプラインが吐き出す大量のヒットから「本物」を選別する誤検知（false positive）フィルタリングの考え方を、実務のワークフローに沿って解説する。

なお本節は防御目的の技術解説であり、実在サービスや本番環境への無許可の走査・侵入は対象としない。手元のステージング環境や、バグバウンティプログラムが明示的に許可した対象、あるいは自分が管理するテスト環境での利用を前提とする。

### なぜ JS recon が有効なのか（仕組みレベルの理解）

Webアプリケーションの多くは SPA（Single Page Application）化に伴い、ロジックの大部分をクライアントサイドの JS バンドルに移している。ビルドツール（webpack、Vite、Rollup など）は複数のソースファイルを1つ、あるいは複数の chunk（分割された束）に結合し、圧縮（minify）してブラウザに配信する。この結合・圧縮の過程で、以下のような「開発者が意図せず持ち出してしまう情報」が残存しやすい。

- **文字列リテラルとしてのAPIエンドポイント**: `fetch("/api/v2/admin/users")` のような呼び出しは、コードがどれだけ難読化されても文字列部分（URLパス）は実行時に必要なため平文で残る。パーサやバンドラは変数名や制御フローは変換できても、実行時に外部と通信するために使う文字列は原則として書き換えない。
- **環境変数の埋め込み**: `process.env.API_KEY` のようなコードは、ビルド時に静的置換（例: webpack の `DefinePlugin`）される場合が多く、ビルド後の成果物には値がそのまま定数として埋め込まれる。つまり「ソースコードには変数だったものが、配布物には具体的な値になっている」という変換が JS recon を成立させる核心的な仕組みである。
- **ソースマップ（source map）の露出**: `//# sourceMappingURL=app.js.map` というコメントがファイル末尾に残っていると、圧縮前の元のファイル構成・変数名・コメントまで復元できる。これは JS のデバッグ体験を良くするための仕組みだが、本番で `.map` ファイルへのアクセスを塞いでいないと、圧縮によって隠したはずの情報が丸ごと復元されてしまう。

これらはすべて「JS recon で機械的に検出可能」という共通点を持つ。以降、収集・展開・抽出・選別という4段階のパイプラインとして整理する。

### ステップ1: JSファイルの収集（Discovery）

収集元は大きく分けて「現在クロールして見つかる JS」と「過去にアーカイブされた JS」の2系統がある。

> ⚠️ **未取得の資料**: 「Automate JavaScript (JS) Extraction for Bug Bounty Recon」（OSINT Team, Karthikeyan Nagaraj）は自動取得できませんでした（理由: 403 Forbidden によりWebFetchが直接本文を取得できず、代替ミラーもDNS解決不可のため取得不可）。以下のURLからご自身で直接ご覧ください: https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e

（以下は未取得資料の補足として、検索結果から確認できた記事の骨子と一般知識に基づく解説です）この記事は、`gau` / `waybackurls` によるアーカイブURLの取得、`grep` / `cut` による `.js` 拡張子のURLフィルタリング、`httpx` によるライブ確認とダウンロード、`LinkFinder` によるエンドポイント抽出、`SecretFinder` によるハードコードされた秘密情報の検出、という一連のツールチェーンを紹介している点で本節の骨子と一致する。

実務上、この収集段階は次のようなシェルパイプラインで再現できる。

```bash
# 1. 過去にアーカイブされたURL群を対象ドメインについて収集する
#    gau (getallurls) は Wayback Machine / Common Crawl / AlienVault OTX などを横断する
gau --subs example.com > all_urls.txt
cat all_urls.txt | grep -E '\.js(\?|$)' | sort -u > js_urls.txt

# 2. 現在稼働中のアプリをクロールして動的に読み込まれるJSも拾う
#    katana はヘッドレスブラウザモードでSPAのXHR/fetchも検知できる
katana -u https://example.com -jc -d 5 -silent | grep -E '\.js(\?|$)' >> js_urls.txt
sort -u -o js_urls.txt js_urls.txt

# 3. URLが実際に200を返すか（生きているか）を確認してからダウンロードする
httpx -l js_urls.txt -silent -mc 200 -o js_urls_alive.txt
mkdir -p js_files
while read -r url; do
  fname=$(echo "$url" | md5sum | cut -d' ' -f1)
  curl -s -A "Mozilla/5.0" "$url" -o "js_files/${fname}.js"
done < js_urls_alive.txt
```

**なぜこの順序なのか**: アーカイブ収集（`gau`/`waybackurls`）は「過去に存在したが現在は削除された、あるいはリンクが切れているページからしか到達できない古いJS」を拾うために不可欠である。開発者は古いバンドルを削除したつもりでも、URLパス自体（例: `/static/js/admin.legacy.abcd1234.js`）がアーカイブに残っていれば、CDNやオブジェクトストレージ上にファイル自体がまだ生きているケースが少なくない。これは「デプロイの削除」と「配信インフラからの削除」が必ずしも一致しないためで、特にビルドのハッシュ付きファイル名（cache busting 用）は一度発行されると誰も削除を意識しないまま残置されやすい。一方で `katana` のようなヘッドレスクロールは、SPAが実行時に動的 `import()` や `fetch` で読み込む chunk を拾うために必要であり、静的なHTMLの `<script>` タグだけを見る従来型クローラでは見逃す。

`httpx -mc 200` によるライブ確認は、この後の抽出ステップで「404ページのHTML」を JS として誤って処理し、無意味なノイズや誤検知を生成することを防ぐためのゲートである。ここで生死判定を怠ると、後段のシークレットスキャナが404ページの汎用JSやエラーページの文字列を「機密情報」として誤検知するリスクが増える。

### ステップ2: 展開と正規化（Deobfuscation / Beautify）

収集した JS はほぼ確実に minify されている。1行に数万文字が連結された状態では正規表現によるgrepも、目視レビューも実質不可能なため、まず整形（beautify）する。

```bash
# js-beautify で改行・インデントを復元する
npm install -g js-beautify
for f in js_files/*.js; do
  js-beautify "$f" -o "${f%.js}.beauty.js"
done
```

**なぜ整形が必要か**: minify は変数名の短縮（`e`, `t`, `n` など）と改行の除去を行うが、文字列リテラル自体は基本的に変更しない（前述の通り、実行時に必要な値だからである）。したがって整形しても中身の情報量は増えないが、`grep -A2 -B2` のような前後文脈表示や、行番号ベースのレビューが可能になり、人間およびスキャナのパターンマッチング精度が大きく向上する。また、圧縮アルゴリズムによっては複数のステートメントを `;` で1行に連結するため、整形しないと正規表現の `^`/`$` アンカーが機能せず、抽出漏れの原因になる。

ソースマップが取得できる場合は、これを使うことでさらに元のファイル構成・変数名・コメントまで復元できる。

```bash
# .js.map が存在するか確認する
curl -s -o /dev/null -w "%{http_code}\n" "https://example.com/static/js/app.abcd1234.js.map"

# 存在すれば sourcemapper 等のツールで元のディレクトリ構造を復元する
# (例: RetireJS, source-map-explorer, unwebpack_sourcemap.py など)
python3 unwebpack_sourcemap.py https://example.com/static/js/app.abcd1234.js.map ./restored/
```

**仕組み**: source map は「変換後の位置」→「変換前のファイル・行・列・変数名」のマッピングをBase64エンコードされたVLQ（Variable-Length Quantity）形式で保持するJSONファイルである。これは本来、本番環境でエラーが出た際に開発者が元のソースでスタックトレースを追えるようにする「デバッグ体験のための仕組み」だが、アクセス制御なしに公開されていると、圧縮によって隠したつもりの内部コメント（`// TODO: 認可チェックを追加`など）や、モジュール構成、内部APIクライアントの実装がそのまま復元できてしまう。

### ステップ3: 情報抽出（Extraction）

整形済みのファイル群に対し、目的別に3種類の抽出を並行して行う。

**(a) エンドポイント・パスの抽出**

```bash
# LinkFinder: JS内のURL・相対パスらしき文字列を正規表現ベースで抽出する
python3 linkfinder.py -i js_files/*.beauty.js -o cli
```

LinkFinder は本質的には「クオートで囲まれ、`/` を含み、URLパスらしい形をした文字列」を拾う正規表現の集合体である。過検出（何でも拾ってしまう）になりやすいため、後段のフィルタが重要になる。

**(b) シークレット・機密情報の抽出**

```bash
# SecretFinder: AWSキー、Google APIキー、JWT、Slackトークンなどのパターンを検出する
python3 SecretFinder.py -i js_files/*.beauty.js -o cli
```

SecretFinder はサービス別の既知フォーマット（例: AWS Access Key は `AKIA[0-9A-Z]{16}`、Google API Key は `AIza[0-9A-Z\-_]{35}`）に対する正規表現マッチを行う。ここで重要なのは、これらのキーフォーマットは「発行者側が意図的に埋め込んだプレフィックス（識別子）」を持つよう設計されており、その規則性を逆手に取って検出しているという点である。プレフィックスのないランダム文字列型の秘密情報（例: 自前実装のAPIキー）は、フォーマットベースの検出ができないため、後述のエントロピー（乱雑さ）ベースの検出が必要になる。

**(c) エンドポイント抽出の高精度版（AST/パーサベース）**

正規表現ベースの抽出はコメントアウトされたコードや文字列結合（`"/api/" + version + "/users"`）を正しく扱えないという弱点がある。これに対し、JavaScript を実際にパースして抽象構文木（AST）を構築し、`fetch()` や `axios.get()` などの呼び出し引数だけを狙い撃ちで抽出するツール（例: `jsluice`）はより精度が高い。

```bash
# jsluice: Go製、AST解析でURL/シークレットらしき箇所を構造的に抽出する
jsluice urls js_files/*.js | jq -r '.url' | sort -u
jsluice secrets js_files/*.js
```

**なぜASTベースの方が精度が高いのか**: 正規表現は「文字の並び」しか見ないため、`// fetch("/api/debug")` のようなコメントアウト済みコードも、`const s = "/api" + "/users"` のような動的結合も区別できない。一方AST解析は、JSエンジンが実際に解釈する構文木を構築するため、コメントノードとステートメントノードを型として区別でき、また文字列結合の場合は結合後の値をある程度シミュレートして再構成できる。これは静的解析ツール全般に共通する「字句レベルの一致」対「意味レベルの理解」というトレードオフであり、AST解析はより計算コストが高い代わりに誤検知・見逃しの双方を減らせる。

> ⚠️ **未取得の資料**: 「Hunting Sensitive Data Leaks in JavaScript — An Advanced Recon Guide」（samael0x4, Medium）は自動取得できませんでした（理由: 403 Forbidden によりWebFetchが直接本文を取得できず、代替ミラーもDNS解決不可のため取得不可）。以下のURLからご自身で直接ご覧ください: https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6

（以下は未取得資料の補足として、検索結果から確認できた記事の骨子と一般知識に基づく解説です）検索結果によれば同記事（2025年8月公開）は、JS Discovery系ツールとして `katana` / `subjs` / `gauplus` / `waybackurls` / `hakrawler`、Secret Scanner系として `SecretFinder` / `Mantra` / `nuclei`、Endpoint Extractor系として `Jsluice` / `LinkFinder` を組み合わせ、「収集 → 生存確認（httpx） → 整形 → 抽出」という、本節で解説したものと同系統のパイプラインを提示している。特に `nuclei` はテンプレートベースでシークレットパターンをスキャンできるため、大規模ドメインに対してSecretFinderと並行運用することで検出漏れを減らす構成が実務でよく使われる。

```bash
# nuclei の exposures/tokens 系テンプレートでJSファイル群を一括スキャンする例
nuclei -l js_urls_alive.txt -t exposures/tokens/ -t exposures/apis/ -o nuclei_js_findings.txt
```

> 出典: Automate JavaScript (JS) Extraction for Bug Bounty Recon — https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e （本文未取得、検索結果に基づく要約）
> 出典: Hunting Sensitive Data Leaks in JavaScript — An Advanced Recon Guide — https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6 （本文未取得、検索結果に基づく要約）

### ステップ4: 誤検知（False Positive）の選別 —— 本節の核心

JS recon パイプラインを大規模ドメインに対して回すと、数百〜数千件の「シークレットらしき文字列」がヒットする。しかし経験則として、その9割以上はテスト用のダミー値・ライブラリ内蔵のサンプルコード・公開されて問題のない値（サードパーティの公開可能なクライアントID等）である。誤検知を体系的に削るための判断軸を以下に整理する。

#### 4-1. フォーマットの妥当性による一次フィルタ

正規表現でヒットしても、そのフォーマットが実際の発行者仕様と一致しているかを機械的に再チェックする。

```python
import re

candidates = [
    "AKIAABCDEFGHIJKLMNOP",  # AWS Access Key風
    "AKIA_EXAMPLE_KEY_HERE", # ダミーによくある形
]

aws_key_pattern = re.compile(r'^AKIA[0-9A-Z]{16}$')
for c in candidates:
    if aws_key_pattern.fullmatch(c):
        print(f"[要確認] {c} はAWSキーの正規フォーマットに一致")
    else:
        print(f"[除外] {c} はフォーマット不一致（誤検知の可能性）")
```

**なぜこれで絞れるのか**: 多くの誤検知は、サンプルコードやドキュメントのコピペに由来する「それらしいが厳密には無効な値」（例: 桁数が違う、`EXAMPLE`や`XXXX`を含む、明らかな連番）である。発行者仕様の厳密なフォーマット（文字種・桁数・チェックサムの有無）と完全一致するかを機械的に再検証するだけで、かなりの割合のノイズを除外できる。

#### 4-2. コンテキストによる二次フィルタ

フォーマットが一致しても、周辺コードの文脈で「テスト用/モック用」であることが明示されている場合は除外する。

```bash
# ヒットした行の前後にテスト・モックを示唆するキーワードがないか確認する
grep -B3 -A3 "AKIA" app.beauty.js | grep -iE "test|mock|dummy|example|sandbox|staging_only"
```

**なぜ有効か**: 開発者はテスト用のダミー値を本物のフォーマットに似せて書く習慣がある（型チェックやバリデーションを通すため）。変数名やコメント、周辺の関数名（`getMockApiKey()`など）にその意図が残っていることが多く、これは正規表現だけでは判定できない「意味的コンテキスト」による選別である。

#### 4-3. エントロピー（乱雑さ）による優先度付け

同じフォーマットの一致でも、ランダム性が低い文字列（`0000000000000000` や `1234567890abcdef` など）は誤検知の可能性が高い。Shannonエントロピーを計算し、閾値以下のものを優先度を下げて扱う。

```python
import math
from collections import Counter

def shannon_entropy(s: str) -> float:
    counts = Counter(s)
    length = len(s)
    return -sum((c/length) * math.log2(c/length) for c in counts.values())

for s in ["0000000000000000", "aK9$mZ2#pQ7xR4tW"]:
    print(s, round(shannon_entropy(s), 2))
# 出力例: 0000000000000000 0.0   → ランダムでない → 誤検知の可能性大
#         aK9$mZ2#pQ7xR4tW 3.83  → ランダム性が高い → 本物の可能性が相対的に高い
```

**仕組み**: Shannon エントロピーは、文字列中の各文字（またはバイト）の出現確率のばらつきを情報理論的に定量化した指標であり、値が高いほど「予測しにくい＝ランダムに近い」ことを意味する。本物の秘密鍵やトークンは暗号論的擬似乱数生成器（CSPRNG）から生成されることが多く、必然的に高いエントロピーを持つ。一方、プレースホルダーや連番はエントロピーが極端に低い。ただしこれは統計的な優先度付けの補助手段であり、単独の判定基準にはならない点に注意する（短い文字列や、意図的にBase64エンコードされた低エントロピーの定数などで誤判定しうる）。

#### 4-4. 実害確認による最終選別（無許可の悪用はしない）

検出した値が「本当に有効な、現在も生きているクレデンシャル」であるかどうかは、原則としてプログラムのルールとスコープを厳守した上で、読み取り専用かつ非破壊的な確認手段（提供されている場合の検証エンドポイント、あるいはプログラム側が許可する範囲でのAPIレスポンスコード確認など）に限定するべきである。実在サービスや本番システムに対する無許可の検証、データの書き換えや削除を伴う確認は行ってはならない。多くのプログラムでは、鍵の有効性確認そのものを「攻撃的検証」とみなし、報告時にはPoC（概念実証）としてスコープ内の手段のみを使うよう定めている点に留意する。

#### 4-5. 誤検知選別のワークフロー全体像

上記を統合すると、実務では次のような優先度付けパイプラインになる。

```text
[ヒット候補 N件]
   │
   ├─ 1. フォーマット厳密一致チェック（正規表現の再検証）
   │        └─ 不一致 → 除外
   ├─ 2. コンテキスト（周辺コード・変数名・コメント）チェック
   │        └─ test/mock/dummyを示唆 → 除外 or 優先度低
   ├─ 3. エントロピー計算
   │        └─ 低エントロピー → 優先度低（要目視確認）
   └─ 4. スコープ内で許可された非破壊的な確認手段があれば実施
            └─ 有効性が確認できたもののみ、プログラムのルールに従い報告
```

このように、JS recon の価値は「収集・抽出の自動化」だけでなく、「機械的に増幅されたノイズを、人間の判断コストが現実的な水準まで削り込む選別ロジック」にある。特に大規模なスコープ（サブドメイン数百〜数千）を扱う場合、この選別工程を怠ると誤検知の山に埋もれてレポートの信頼性そのものが低下するため、収集の自動化と同じかそれ以上に選別ロジックへの投資が重要になる。

### まとめ

JS recon は「ビルドプロセスが文字列リテラルを保持する」「環境変数がビルド時に定数化される」「ソースマップがデバッグ用に配線情報を保存する」という3つの技術的性質を利用して、フロントエンドの配布物から内部構造を逆算する手法である。収集（アーカイブ＋動的クロール）→生存確認→整形→抽出（正規表現・ASTベースの併用）→選別（フォーマット・コンテキスト・エントロピーの多層フィルタ）という5段階を再現性のあるスクリプトとして組んでおくことで、対象範囲が広がっても品質を落とさずにスケールさせられる。次節では、この抽出フェーズで得られたシンク（sink、入力が最終的に実行・解釈される危険な代入先）候補を、実際の脆弱性評価にどうつなげるかを扱う。

---

[← 第3章 JavaScriptの深い理解と読解スキル](03-javascript-deep-reading.md) ｜ [📖 目次](index.md) ｜ [第5章 ブラウザDevToolsの徹底活用 →](05-devtools-mastery.md)
