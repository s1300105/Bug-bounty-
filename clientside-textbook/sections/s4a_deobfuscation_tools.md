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
