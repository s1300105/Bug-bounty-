# webcrack実践編 — トランスパイル復元・バンドル展開・CLI/APIで本番JSを読める形に戻す

> **この節で分かること**
> - webcrackがトランスパイルで壊された構文（`?.` `??` `||=`など）をどう復元し、なぜそれが脆弱性ハンティングに効くかを説明できる
> - webpack / browserifyバンドルの内部構造（`__webpack_require__`・モジュールファクトリ・依存ツリー）を読み解き、`-o`オプションでモジュール単位に展開できる
> - webcrackのCLIとNode.js APIを使い、難読化・縮小された本番JavaScriptを人間が読める形へ戻せる
> - `mappings`でモジュールに内容ベースの安定パスを付け、デプロイのたびにdiffを取って新エンドポイントやsinkを検知する手順を実行できる
> - `sandbox`オプションと`isolated-vm`による隔離実行の仕組み、および安全上の注意点を説明できる
> - 難読化された第三者スクリプト（広告・計測・スキマー系）を平文に戻し、外部送信先やsource/sinkを洗い出す実務フローを組み立てられる

**元資料**: https://github.com/j4k0xb/webcrack （原典取得済み。ドキュメントはVitePressの生成元Markdownとして https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/ 以下から逐語取得）
**関連する節**: 20a webcrack導入・難読化解除編（プロジェクト概要とdeobfuscateの仕組み）

---

## 0. この節の位置づけ

前半（20a）ではwebcrackが何であり、obfuscator.io（javascript-obfuscator）の難読化をどう解除するかを見た。webcrackとは、難読化・縮小・バンドル化されたJavaScriptを「元のソースコードにできるだけ近い形」へ戻すリバースエンジニアリング用ツールのこと。この後半では、残る4つの機能と実務での使い方を扱う。

具体的には、①トランスパイル済み構文のモダン構文復元、②JSX復元、③webpack/browserifyバンドルの展開（debundle）、④CLIとNode.js APIの操作、⑤処理パイプラインの実体、⑥プレイグラウンドとよくあるエラー、⑦バグバウンティでの実践フローである。

読者は「webpack」や「トランスパイル」という言葉を初めて見るかもしれない。各トピックの冒頭でその意味を定義するので、順に読めば単体で理解できる。

---

## 1. Transpile復元 — ダウンレベル化された構文をモダン構文へ戻す

### 1.1 なぜトランスパイル復元が必要か（設計意図）

トランスパイル（transpile）とは、新しい構文で書かれたJavaScriptを、古いブラウザでも動くように古い構文へ書き換えること。BabelやTypeScript、SWCといったツールが行う。たとえば`a ?? b`（nullish合体）は古い環境で動かないので、`a !== null && a !== undefined ? a : b`のような冗長な三項演算子へ変換される。

この「ダウンレベル化」された結果は、機能的には同じでも読みにくい。Babelは`_a`, `_a$b`, `_foo$bar`のような一時変数を大量に生成するため、コードがノイズだらけになる。

webcrackのtranspile機能は、この処理を逆向きに行う。ドキュメントの説明を逐語で引くと次のとおり。

```text
Convert transpiled syntax back to modern JavaScript.
```

### 1.2 どう動くか — 変換の完全一覧

transpileステージが持つ変換は、一次ソース `src/transpile/transforms/index.ts` に列挙されている（逐語）。

```ts
export { default as defaultParameters } from './default-parameters';
export { default as logicalAssignments } from './logical-assignments';
export { default as nullishCoalescing } from './nullish-coalescing';
export { default as nullishCoalescingAssignment } from './nullish-coalescing-assignment';
export { default as optionalChaining } from './optional-chaining';
export { default as templateLiterals } from './template-literals';
```

6つの変換それぞれについて、webcrackのドキュメントは「before（削除される冗長な形）→ after（復元されるモダンな形）」の実例を載せている。以下、原文の全例を逐語で示す（`// [!code --]`は削除される行、`// [!code ++]`は追加される行を表すVitePressの記法）。

### 1.3 default-parameters（デフォルト引数の復元）

`arguments.length`を使った冗長なデフォルト引数を、`x = 1`という形へ戻す（参考: `https://babeljs.io/docs/babel-plugin-transform-parameters`）。

```js
function f() { // [!code --]
  var x = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1; // [!code --]
  var y = arguments.length > 1 ? arguments[1] : undefined; // [!code --]
} // [!code --]

function f(x = 1, y) {} // [!code ++]
```

### 1.4 logical-assignments（論理代入演算子の復元）

`x || (x = y)`のような短絡評価を`x ||= y`へ戻す（参考: `https://babeljs.io/docs/babel-plugin-transform-logical-assignment-operators`、およびTypeScript and SWC）。

```js
x || (x = y) // [!code --]
x ||= y // [!code ++]
```

一時変数を経由する複雑なケースも復元される。

```js
var _x, _y; // [!code --]
(_x = x)[_y = y] && (_x[_y] = z); // [!code --]
x[y] &&= z; // [!code ++]
```

### 1.5 nullish-coalescing（nullish合体演算子の復元）

`a !== null && a !== undefined ? a : b`を`a ?? b`へ戻す。

```js
a !== null && a !== undefined ? a : b; // [!code --]
a ?? b; // [!code ++]
```

プロパティアクセスを含む場合、Babelは`_a$b`のような一時変数を生成するが、それも整理される。

```js
var _a$b; // [!code --]
(_a$b = a.b) !== null && _a$b !== undefined ? _a$b : c; // [!code --]
a.b ?? c; // [!code ++]
```

デフォルト引数の中に埋め込まれた即時実行関数（IIFE）まで復元される。

```js
function foo(foo, qux = (_foo$bar => (_foo$bar = foo.bar) !== null && _foo$bar !== undefined ? _foo$bar : "qux")()) {} // [!code --]
function foo(foo, qux = foo.bar ?? "qux") {} // [!code ++]
```

### 1.6 nullish-coalescing-assignment（nullish代入演算子の復元）

`a ?? (a = b)`を`a ??= b`へ戻す。

```js
a ?? (a = b); // [!code --]
a ??= b; // [!code ++]
```

```js
var _a; // [!code --]
(_a = a).b ?? (_a.b = c); // [!code --]
a.b ??= c; // [!code ++]
```

### 1.7 optional-chaining（オプショナルチェーンの復元）

`a === null || a === undefined ? undefined : a.b`を`a?.b`へ戻す。

```js
a === null || a === undefined ? undefined : a.b; // [!code --]
a?.b; // [!code ++]
```

```js
var _a; // [!code --]
(_a = a) === null || _a === undefined ? undefined : _a.b; // [!code --]
a?.b; // [!code ++]
```

### 1.8 template-literals（テンプレートリテラルの復元）

`.concat()`の連鎖をバッククォートのテンプレート文字列へ戻す（参考: `https://babeljs.io/docs/babel-plugin-transform-template-literals`）。

```js
"'".concat(foo, "' \"").concat(bar, "\"") // [!code --]
`'${foo}' "${bar}"` // [!code ++]
```

### 1.9 攻撃者はどこを突くのか・診断上の意義

ノート原文の指摘を引くと次のとおり。`_a`, `_a$b`, `_foo$bar`のようなBabelが生成する一時変数はノイズになる。これらを`?.` / `??` / `||=`に戻すことで、**どの値がnullable（null/undefinedになりうる）でどこで分岐しているか**が一目で読めるようになり、source→sink（入力源から危険な処理までの流れ）の追跡が容易になる。

たとえば、ユーザー入力が`location.hash`から来て、いくつもの三項演算子を経て最終的に`innerHTML`へ届く経路を、モダン構文に戻すことで人間が短時間で追えるようになる。

---

## 2. JSX復元 — `React.createElement`をタグ記法へ戻す

### 2.1 なぜ必要か

JSXとは、Reactで使うHTMLに似たタグ記法のこと。たとえば`<div>Hello</div>`のように書ける。ただしブラウザはJSXをそのまま実行できないので、Babel・TypeScript・バンドラが`React.createElement('div', null, 'Hello')`という関数呼び出しへ変換する。webcrackのJSX機能はこの逆を行う。

### 2.2 どう動くか（原文逐語）

ドキュメントページ全文を逐語で引く。

```text
Tools such as Babel, TypeScript
or bundlers convert JSX to `React.createElement` calls.
This feature does the opposite.
```

before → afterの例（逐語）。

```jsx
React.createElement(
  'div',
  null,
  React.createElement('span', null, 'Hello ', name),
);
```

これが次のように復元される。

```jsx
<div>
  <span>Hello {name}</span>
</div>
```

### 2.3 実装と重要な制限

実装は2種類ある。`src/transforms/jsx.ts`がクラシックな`React.createElement`を、`src/transforms/jsx-new.ts`が新しいJSXランタイム（`jsx` / `jsxs`関数）を扱う。`options.jsx`がtrueのとき`src/index.ts`の中で`options.jsx ? [jsx, jsxNew] : []`として両方が適用される。

重要な制限として、原文のNOTEブロックを逐語で引く。

```text
This currently only works for the React UMD build, not when bundled.
```

つまり現状はReactの**UMDビルド**（`React`がグローバル変数として存在する形）にのみ対応し、バンドル済み（`React`がローカル変数にリネームされている）コードでは機能しない。UMD（Universal Module Definition）とは、ブラウザ・CommonJS・AMDのどの環境でも読み込めるようにしたJavaScriptモジュールの配布形式のこと。

---

## 3. Bundle Unpacking — webpack/browserifyバンドルの展開

### 3.1 なぜバンドルを展開するのか（設計意図）

バンドラ（bundler）とは、多数の`.js`ファイルを1つの大きなファイルにまとめるツールのこと。webpackやbrowserifyが代表例である。本番サイトの`main.[hash].js`はたいていこの形で配信される。1ファイルに全機能が詰まっているため、そのままではどの機能がどこにあるか分かりにくい。webcrackのunpack機能は、これを元のモジュール単位のファイル群へ戻す（debundle）。

### 3.2 Webpackの展開ルール（原文逐語）

```text
- `__webpack_require(id)__` gets rewritten to `require('./relative/path.js')`.

- Modules may get converted to ESM.

- multiple chunks are not supported _yet_.
```

つまり、モジュールIDによる内部呼び出しが相対パスのrequireに書き換えられ、必要に応じてESM（ECMAScriptモジュール、`import`/`export`形式）へ変換される。ただし**複数チャンク（multiple chunks）は未対応**である点は限界として覚えておく。チャンクとは、webpackが遅延読み込みのために本体とは別に分割出力するJSファイルのこと。

なお、ドキュメントページには`![Webpack structure](../assets/webpack-structure.png)`という構造図（画像）が埋め込まれている。この画像は本教科書には取り込めていない。

> ### 📌 ここは自分で開いて読んでください
> **資料**: webcrack Unpack概念ページ（Webpack構造図） — https://webcrack.netlify.app/docs/concepts/unpack.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `webcrack.netlify.app`ドメインがegressプロキシで遮断され、かつ本文中の構造図が画像＝テキスト化できないため）。以下の記述はVitePressの生成元Markdownと型定義にもとづく要約である。
> **読みどころ**:
> 1. webpackバンドル全体のトップレベルIIFE（即時実行関数）構造
> 2. `modules`配列/オブジェクトとモジュールIDの対応関係
> 3. `__webpack_require__`とモジュールファクトリ関数の引数の関係
> 4. エントリモジュールがどこから起動されるか
> **代替手段**: 同じ内容の型定義（下記3.3〜3.4）を本節に逐語掲載しているので、まずそれを読む。図解が必要なら実際にwebpackで小さなプロジェクトをビルドして出力を眺めるのが確実。

### 3.3 Webpackのモジュールラッパ型定義（原文逐語）

各モジュールは「ファクトリ関数」で包まれており、`module` / `exports` / `__webpack_require__`をあたかもグローバル変数のように受け取る。

```ts
/**
 * Most of the time this is an object for multiple exports,
 * but a module can export anything
 */
type Exports = unknown;

/**
 * Each module is wrapped in a factory function to give it access to these arguments like they were global variables
 */
type FactoryFunction = (
  module: Module,
  exports: Exports,
  __webpack_require__: WebpackRequire,
) => void;

interface Module {
  exports: Exports; // module exports
  i: number; // module id
  l: boolean; // loaded
}
```

### 3.4 `__webpack_require__`の全プロパティ（原文逐語）

webpackランタイムの中心となる`__webpack_require__`関数には、多くのヘルパプロパティがぶら下がっている。

```ts
interface WebpackRequire {
  // Call to load a module
  (moduleId: number): Exports;
  // Define getter functions for esm exports
  d(exports: Exports, name: string, getter: () => Exports): void;
  // Load a chunk
  e(chunkId: number): Promise<Exports>;
  // Returns globalThis or window
  g(): typeof globalThis;
  // loadScript function to load a script via script tag
  l(
    url: string,
    done: (event: Event) => void,
    key: string | undefined,
    chunkId: number,
  ): void;
  // Get the default export of a module, for compatibility with non-esm
  n(exports: Exports): { (): Exports; get a(): Exports };
  // Object.prototype.hasOwnProperty.call
  o(object: unknown, property: string): boolean;
  // On error function for async loading
  oe(err: Error): never;
  // Set __esModule to true
  r(exports: Exports): void;
  // Create a fake namespace object
  t(value: number | Record<string, unknown>, mode: number): unknown;
  // Get javascript chunk filename. Example: u(0) -> 'chunks/0.138aa346.js'
  u(chunkId: number): string;

  // Contains all installed modules. The keys are module ids
  c: Record<number, Module>;
  f: {
    // JSONP chunk loading for javascript
    j(chunkId: number, promises: Promise<unknown>[]): void;
  };
  // Contains all module functions. The keys are module ids
  m: Record<number, FactoryFunction>;
  // Public base path for chunks. Example: '/_next/'
  p: string;
  // Entry module id
  s: number;
  // All WebAssembly.instance exports. The keys are wasm module ids
  w: Record<number, Exports>;
}
```

これを一覧表にすると次のとおり。

| プロパティ | シグネチャ | 意味 |
| --- | --- | --- |
| （呼び出し） | `(moduleId: number): Exports` | モジュールを読み込む |
| `d` | `d(exports, name, getter): void` | ESMエクスポート用のgetterを定義 |
| `e` | `e(chunkId): Promise<Exports>` | チャンクを読み込む |
| `g` | `g(): typeof globalThis` | `globalThis`か`window`を返す |
| `l` | `l(url, done, key, chunkId): void` | scriptタグでスクリプトを読み込む |
| `n` | `n(exports): {...}` | 非ESM互換のためのdefault export取得 |
| `o` | `o(object, property): boolean` | `Object.prototype.hasOwnProperty.call` |
| `oe` | `oe(err: Error): never` | 非同期読み込みのエラーハンドラ |
| `r` | `r(exports): void` | `__esModule`をtrueに設定 |
| `t` | `t(value, mode): unknown` | 偽のnamespaceオブジェクトを作る |
| `u` | `u(chunkId): string` | JSチャンクのファイル名。例: `u(0) -> 'chunks/0.138aa346.js'` |
| `c` | `Record<number, Module>` | インストール済み全モジュール（キー＝モジュールID） |
| `f.j` | `j(chunkId, promises): void` | JavaScriptのJSONPチャンクローディング |
| `m` | `Record<number, FactoryFunction>` | 全モジュール関数（キー＝モジュールID） |
| `p` | `string` | チャンクのpublic base path。例: `'/_next/'` |
| `s` | `number` | エントリモジュールID |
| `w` | `Record<number, Exports>` | 全`WebAssembly.instance`のexports（キー＝wasmモジュールID） |

### 3.5 攻撃者はどこを突くのか（診断上の意義）

ノート原文の指摘を再構成する。`__webpack_require__.p`（public path）と`u(chunkId)`（チャンクファイル名生成）を読むと、**追加で取得すべきJSチャンクのURL組み立て規則**が分かる。つまり、まだ手元にない遅延読み込みチャンクのURLを自分で組み立てて全部ダウンロードできる。

`m`（全モジュール関数）と`s`（エントリID）が分かれば、バンドル全体を機械的に分解できる。さらに`l()`の`script`タグ挿入は、public pathが攻撃者制御下に入る場合の**script gadget / XSS**の観点でも注目点になる。たとえば`p`がユーザー入力で汚染できれば、任意のスクリプトを読み込ませられる可能性がある。

### 3.6 Browserifyの展開（原文逐語）

browserifyはwebpackと違い、各モジュールが数値IDと依存関係リストを持つ。

```text
Each module has a numerical id and contains a list of dependencies: `{ './foo': 1, './bar': 3 }`.
These paths are relative to the current module and are used like `require('./foo')`.

The absolute path a module is not stored anywhere, so webcrack builds a dependency tree
and resolves the paths to preserve the original file structure as much as possible.

Sometimes the entry module was deeply nested (e.g. `src/app/index.js`), but `"src"` or `"app"` is not included in the bundle.
In this case, directory names like `tmp0/tmp1`, etc. are used instead.
```

つまり絶対パスはどこにも保存されないため、webcrackは依存ツリーを構築して相対パスを解決し、元のファイル構造をできるだけ復元する。ただし深くネストしたエントリの場合、実際のディレクトリ名が分からないので`tmp0/tmp1`のような仮の名前が使われる。

モジュールID → 依存関係の例（逐語）。

```js
{
  0: { 1: './a.js', 4: 'lib' }, // entry
  1: { 2: '../bar/b.js' },
  2: { 3: '../../c.js' },
  3: {},
  4: {},
}
```

これが次のファイル構造に復元される（逐語）。

```txt
├── tmp0
│   ├── tmp1
│   │   ├── index.js
│   │   └── a.js
│   └── bar
│       └── b.js
├── c.js
```

### 3.7 `Bundle`クラスと出力の実装・パストラバーサル対策

一次ソース `src/unpack/bundle.ts` の`Bundle`クラス（逐語）。

```ts
export class Bundle {
  type: 'webpack' | 'browserify';
  entryId: string;
  modules: Map<string, Module>;
```

`bundle.json`の生成内容（逐語）。

```ts
    const bundleJson = {
      type: this.type,
      entryId: this.entryId,
      modules: Array.from(this.modules.values(), (module) => ({
        id: module.id,
        path: module.path,
      })),
    };
```

ここで防御実装として重要なのが**パストラバーサル対策**である。パストラバーサル（path traversal）とは、`../`を使って本来書き込むべきディレクトリの外にファイルを書き込ませる攻撃のこと。webcrackは後述の`mappings`で悪意あるパスを与えられても、出力ディレクトリの外へは書き込まない（逐語）。

```ts
        const modulePath = normalize(join(path, module.path));
        if (relative(path, modulePath).startsWith('..')) {
          throw new Error(`detected path traversal: ${module.path}`);
        }
```

`applyMappings`の挙動（逐語の要点）。`./`で始まるパスはそのまま、それ以外は`node_modules/`配下として扱う。

```ts
              const resolvedPath = mappingPath.startsWith('./')
                ? mappingPath
                : `node_modules/${mappingPath}`;
              module.path = resolvedPath;
```

同じmappingが2回マッチすると`throw new Error(\`Mapping ${mappingPath} is already used.\`);`となる。

---

## 4. Command Line Interface（CLI）

### 4.1 インストール（原文逐語、パッケージマネージャ別）

```bash
npm install -g webcrack@latest
```

```bash
yarn global add webcrack@latest
```

```bash
pnpm add -g webcrack@latest --allow-build=isolated-vm
```

pnpmでは`--allow-build=isolated-vm`が必要になる。理由はpnpm 10以降がpostinstallスクリプトを既定で実行しないためで、これがないとネイティブモジュール`isolated-vm`がビルドされない。

### 4.2 `--help`出力（原文逐語）

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

CLIオプション完全一覧を表にすると次のとおり。`--no-*`系はすべて既定でtrueの機能を無効化するスイッチである。

| 短縮形 | 長形式 | 引数 | 説明（原文） | 既定値 |
| --- | --- | --- | --- | --- |
| `-V` | `--version` | なし | `output the version number` | — |
| `-o` | `--output <path>` | パス | `output directory for bundled files` | 未指定ならstdout |
| `-f` | `--force` | なし | `overwrite output directory` | false |
| `-m` | `--mangle` | なし | `mangle variable names` | false |
| — | `--no-jsx` | なし | `do not decompile JSX` | jsx: true |
| — | `--no-unpack` | なし | `do not extract modules from the bundle` | unpack: true |
| — | `--no-deobfuscate` | なし | `do not deobfuscate the code` | deobfuscate: true |
| — | `--no-unminify` | なし | `do not unminify the code` | unminify: true |
| `-h` | `--help` | なし | `display help for command` | — |
| （引数） | `[file]` | ファイル | `input file, defaults to stdin` | stdin |

CLI実装（`src/cli.ts`）の該当部分（逐語）。`commander`ライブラリでオプションを定義している。

```ts
program
  .version(version)
  .description(description)
  .option('-o, --output <path>', 'output directory for bundled files')
  .option('-f, --force', 'overwrite output directory')
  .option('-m, --mangle', 'mangle variable names')
  .option('--no-jsx', 'do not decompile JSX')
  .option('--no-unpack', 'do not extract modules from the bundle')
  .option('--no-deobfuscate', 'do not deobfuscate the code')
  .option('--no-unminify', 'do not unminify the code')
  .argument('[file]', 'input file, defaults to stdin')
```

### 4.3 `-f/--force`の危険な挙動

`-f/--force`の実際の挙動は要注意である。既存ディレクトリは`force`指定時に`rm -rf`相当で削除される（逐語）。

```ts
    if (output) {
      if (force || !existsSync(output)) {
        await rm(output, { recursive: true, force: true });
      } else {
        program.error('output directory already exists');
      }
    }
```

大事なファイルが入ったディレクトリを`-o`に指定して`-f`を付けると、中身ごと消える。出力先は必ず空か新規のディレクトリにすること。

なおCLIは起動時に`debug.enable('webcrack:*');`を実行するため、**既定でデバッグログが有効**になる。ログはstderrへ出る。

### 4.4 入力の与え方（原文逐語）

```bash
webcrack input.js
# or download/pipe a script from a website
curl https://pastebin.com/raw/ye3usFvH | webcrack
```

原文の説明を引くと、`By default it outputs debug logs and the deobfuscated/unminified code to the terminal.`（既定ではデバッグログと難読化解除済みコードをターミナルに出力する）。ファイルに書き出すには次のようにする。

```bash
webcrack input.js > output.js
```

### 4.5 バンドルの展開と出力ディレクトリ構造（原文逐語）

```bash
webcrack bundle.js -o output
```

出力ディレクトリには次のファイルが作られる（逐語）。

```text
The output directory will contain the following files:

- `deobfuscated.js` - deobfuscated/unminified code
- `bundle.json` - bundle type and module ids/paths
- `index.js` - entry point
- all remaining modules (`1.js`, `2.js`, etc.)
```

表にすると次のとおり。

| ファイル | 内容 |
| --- | --- |
| `deobfuscated.js` | 難読化解除 / unminify済みのコード全体 |
| `bundle.json` | バンドル種別（`type`）、`entryId`、モジュールの`id`と`path`の一覧 |
| `index.js` | エントリポイント |
| `1.js`, `2.js`, … | 残りのモジュール |

`-o`を指定せずにバンドルを処理した場合、モジュールはターミナルに表示されず、次のログが出る（`src/cli.ts`逐語）。

```ts
        debug('webcrack:unpack')(
          'Modules are not displayed in the terminal. Use the --output option to save them to a directory.',
        );
```

### 4.6 他言語からの呼び出し（原文逐語）

CLIはstdin/stdoutを介するので、Pythonなど他言語からも簡単に呼べる。

```text
If the package is installed locally instead of globally, the path of the CLI would look like `node_modules/.bin/webcrack`.

Spawn a new process where the code is piped to stdin.
The logs will be written to stderr and the output code will be written to stdout.
```

Pythonの例（逐語）。

```py
import subprocess

code = "1+1"
result = subprocess.run(
    ["webcrack"], input=code, capture_output=True, text=True
)
print(result.stdout)
```

重要なのは、ログは**stderr**、出力コードは**stdout**に分かれる点。自動化パイプラインではこの分離を前提にできる。

---

## 5. Node.js API

### 5.1 インストールと基本的な使い方（原文逐語）

ドキュメントはnpm / yarn / pnpmの3つのパッケージマネージャの逐語コマンドを載せている。CLI節（4.1）と同じく、どれを使ってもよい。

```bash
npm install webcrack@latest
```

```bash
yarn add webcrack@latest
```

```bash
pnpm add webcrack@latest --allow-build=isolated-vm
```

なお`--allow-build=isolated-vm`はpnpmの例にのみ付いている。これはpnpmがネイティブアドオンのビルドをデフォルトでブロックするためで、`isolated-vm`（後述するサンドボックス実行に使うネイティブモジュール）のビルドを明示的に許可する意味である。npm / yarnではこのフラグは不要である。

基本形。`webcrack()`は非同期関数で、`result.code`に結果が入る。

```js
import { webcrack } from 'webcrack';

const result = await webcrack('const a = 1+1;');
console.log(result.code); // 'const a = 2;'
```

CommonJSの場合（原文のNOTEブロックを逐語）。

```js
const { webcrack } = require('webcrack');

webcrack('const a = 1+1;').then((result) => {
  console.log(result.code); // 'const a = 2;'
});
```

難読化解除したコードと展開したバンドルを指定ディレクトリへ保存する（逐語）。

```js
import fs from 'fs';
import { webcrack } from 'webcrack';

const code = fs.readFileSync('bundle.js', 'utf8');
const result = await webcrack(code);
await result.save('output-dir');
```

### 5.2 バンドル情報の取得（原文逐語）

戻り値の`bundle`プロパティから、バンドルの種別・エントリID・全モジュールを取得できる。

```js
const { bundle } = await webcrack(code);
bundle.type; // 'webpack' or 'browserify'
bundle.entryId; // '0'
bundle.modules; // Map(10) { '0' => Module { id: '0', ... }, 1 => ... }

const entry = bundle.modules.get(bundle.entryId);
entry.id; // '0'
entry.path; // './index.js'
entry.code; // 'const a = require("./1.js");'
```

### 5.3 オプション（原文逐語）

```js
await webcrack(code, {
  jsx: true, // Decompile react components to JSX
  unpack: true, // Extract modules from the bundle
  unminify: true, // Unminify the code
  deobfuscate: true, // Deobfuscate the code
  mangle: false, // Mangle variable names
  plugins: {}, // Explained below
  sandbox, // Explained below
});
```

`mangle`（変数名の短縮化）はフィルタ関数も渡せる。次は`_0x`で始まる識別子（obfuscator.io由来の名前）だけをリネーム対象にする典型例。

```js
await webcrack(code, {
  mangle: (id) => id.startsWith('_0x'),
});
```

一次ソース`src/index.ts`の`Options`インターフェース（逐語）。ドキュメントに載っていない`onProgress`も含む。

```ts
export interface Options {
  /**
   * Decompile react components to JSX.
   * @default true
   */
  jsx?: boolean;
  /**
   * Extract modules from the bundle.
   * @default true
   */
  unpack?: boolean;
  /**
   * Deobfuscate the code.
   * @default true
   */
  deobfuscate?: boolean;
  /**
   * Unminify the code. Required for some of the deobfuscate/unpack/jsx transforms.
   * @default true
   */
  unminify?: boolean;
  /**
   * Mangle variable names.
   * @default false
   */
  mangle?: boolean | ((id: string) => boolean);
  /**
   * Run AST transformations after specific stages
   */
  plugins?: Partial<Record<Stage, Plugin[]>>;
  /**
   * Assigns paths to modules based on the given matchers.
   * This will also rewrite `require()` calls to use the new paths.
   */
  mappings?: (m: Matchers) => Record<string, m.Matcher<unknown>>;
  /**
   * Function that executes a code expression and returns the result (typically from the obfuscator).
   */
  sandbox?: Sandbox;
  /**
   * @param progress Progress in percent (0-100)
   */
  onProgress?: (progress: number) => void;
}
```

戻り値の型（逐語）。

```ts
export interface WebcrackResult {
  code: string;
  bundle: Bundle | undefined;
  /**
   * Save the deobfuscated code and the extracted bundle to the given directory.
   * @param path Output directory
   */
  save(path: string): Promise<void>;
}
```

既定値のマージ（逐語）。`sandbox`の既定はブラウザかどうかで分岐する点に注目。

```ts
  const mergedOptions: Required<Options> = {
    jsx: true,
    unminify: true,
    unpack: true,
    deobfuscate: true,
    mangle: false,
    plugins: options.plugins ?? {},
    mappings: () => ({}),
    onProgress: () => {},
    sandbox: isBrowser() ? createBrowserSandbox() : createNodeSandbox(),
    ...options,
  };
```

オプション一覧（表）。

| オプション | 型 | 既定値 | 説明（原文） |
| --- | --- | --- | --- |
| `jsx` | `boolean` | `true` | `Decompile react components to JSX.` |
| `unpack` | `boolean` | `true` | `Extract modules from the bundle.` |
| `deobfuscate` | `boolean` | `true` | `Deobfuscate the code.` |
| `unminify` | `boolean` | `true` | `Unminify the code. Required for some of the deobfuscate/unpack/jsx transforms.` |
| `mangle` | `boolean \| ((id: string) => boolean)` | `false` | `Mangle variable names.` |
| `plugins` | `Partial<Record<Stage, Plugin[]>>` | `{}` | `Run AST transformations after specific stages` |
| `mappings` | `(m: Matchers) => Record<string, m.Matcher<unknown>>` | `() => ({})` | `Assigns paths to modules based on the given matchers.` |
| `sandbox` | `Sandbox` | Node: `createNodeSandbox()` / ブラウザ: `createBrowserSandbox()` | `Function that executes a code expression and returns the result.` |
| `onProgress` | `(progress: number) => void` | `() => {}` | `@param progress Progress in percent (0-100)` |

`save(path)`の実装（逐語）。`deobfuscated.js`を書き、続けてバンドルを保存する。

```ts
    async save(path) {
      const { mkdir, writeFile } = await import('node:fs/promises');
      path = normalize(path);
      await mkdir(path, { recursive: true });
      await writeFile(join(path, 'deobfuscated.js'), outputCode, 'utf8');
      await bundle?.save(path);
    },
```

### 5.4 ブラウザでの利用とSandbox（原文逐語）

`sandbox`オプションは、ブラウザで文字列配列（String Array）を復号するときに必ず渡す必要がある。サンドボックス（sandbox）とは、コードを外部と隔離した安全な環境で実行する仕組みのこと。

```text
The `sandbox` option has to be passed when trying to deobfuscate string arrays in a browser.
It is an (optionally async) function that takes a `code` parameter and returns the evaluated value.
In future versions, this should hopefully not be necessary anymore.
```

〔補足〕原文の最後の一文（`In future versions, this should hopefully not be necessary anymore.`）は、「将来のバージョンでは、この`sandbox`指定はおそらく不要になる見込み」という意味である。つまりブラウザでの`sandbox`必須は現時点の制約であり、恒久的な仕様ではない。読者が使うバージョンによっては挙動が変わりうる点に留意する。

最も単純な実装は`eval`をそのまま渡すこと。ただし原文はCAUTIONブロックで強く警告している。

```text
Simplest possible implementation. Don't run this with untrusted or malicious code.
```

```js
const result = await webcrack('function _0x317a(){....', { sandbox: eval });
```

`eval`を信頼できないコードに使うのは危険なので、プレイグラウンドはより安全な実装を採用している（原文逐語）。

```js
const sandbox = await Sandybox.create();
const iframe = document.querySelector('.sandybox');
iframe?.contentDocument?.head.insertAdjacentHTML(
  'afterbegin',
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none';">`,
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evalCode(code) {
  const fn = await sandbox.addFunction(`() => ${code}`);
  return Promise.race([
    fn(),
    sleep(10_000).then(() => Promise.reject(new Error('Sandbox timeout'))),
  ]).finally(() => sandbox.removeFunction(fn));
}

const result = await webcrack('function _0x317a(){....', { sandbox: evalCode });
```

この防御設計の要点は4つ。

1. **sandybox**でiframe内に隔離する
2. iframeに`<meta http-equiv="Content-Security-Policy" content="default-src 'none';">`を注入して**ネットワークアクセスを遮断**する（CSP＝Content Security Policy、コンテンツセキュリティポリシー。読み込み先を制限するブラウザの仕組み）
3. `Promise.race`による**10秒タイムアウト**で無限ループを止める
4. 実行後は`sandbox.removeFunction(fn)`で必ず後片付けする

> ### 📌 ここは自分で開いて読んでください
> **資料**: sandybox（ブラウザ用サンドボックス） — https://github.com/trentmwillis/sandybox
> **なぜ**: 本節では利用例のみ扱っており、iframe隔離モデルそのものの詳細は取り込んでいない。
> **読みどころ**:
> 1. `Sandybox.create()`と`addFunction` / `removeFunction`のAPI
> 2. iframeベースの隔離モデルの限界
> 3. CSPとの併用方法
> **代替手段**: なし（GitHubリポジトリ本体を読む）

> ### 📌 ここは自分で開いて読んでください
> **資料**: isolated-vm（Node用サンドボックス実行基盤） — https://github.com/laverdet/isolated-vm
> **なぜ**: webcrackがNode環境で文字列配列を復号する際の隔離実行基盤だが、その内部やABI制約の詳細は本節に取り込んでいない。
> **読みどころ**:
> 1. `Isolate` / `Context` / `eval(code, {timeout, copy, filename})`の意味
> 2. Nodeの偶数系バージョンのみ推奨という制約の理由（V8のABI互換）
> 3. `--no-node-snapshot`が必要になる条件
> 4. メモリ制限の設定方法
> **代替手段**: なし（GitHubリポジトリ本体を読む）

### 5.5 Customize Paths（`mappings`）（原文逐語）

`mappings`はバージョン間の差分追跡に有用な機能である。

```text
Useful for reverse-engineering and tracking changes across multiple versions of a bundle.

The `mappings` option takes a function that receives an instance of @codemod/matchers, and returns an object that maps any matching nodes, to the path specified in the object key.

If a matching node in the AST of a module is found, it will be renamed to the given path.

- Path starting with `./` are relative to the output directory.
- Otherwise, the path is treated as a node module.
```

```js
const result = await webcrack(code, {
  mappings: (m) => ({
    './utils/color.js': m.regExpLiteral('^#([0-9a-f]{3}){1,2}$'),
    'lodash/index.js': m.memberExpression(
      m.identifier('lodash'),
      m.identifier('map'),
    ),
  }),
});
await result.save('output-dir');
```

これにより次のフォルダ構造になる（逐語）。

```txt
├── index.js
├── utils
│   └── color.js
└── node_modules
    └── lodash
        └── index.js
```

診断上の意義は大きい。バンドルのモジュールIDは**ビルドのたびに変わる**ため、そのままでは「先週の47.js」と「今週の52.js」を比較できない。`mappings`で「この正規表現リテラルを含むモジュール＝`./utils/color.js`」と**内容ベースで安定した名前**を付けておけば、バージョン間diffを取って新規追加された機能・エンドポイント・sinkを洗い出せる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: @codemod/matchers — https://github.com/codemod-js/codemod/tree/main/packages/matchers#readme
> **なぜ**: `mappings`に渡すマッチャの一覧やバックリファレンスの書き方はこのライブラリのREADMEにあり、本節では利用例のみを扱っている。
> **読みどころ**:
> 1. `m.capture` / `m.fromCapture`によるバックリファレンス
> 2. `m.containerOf` / `m.anyList` / `m.zeroOrMore`などの構造マッチャ
> 3. `mappings`オプションに渡せるマッチャの一覧
> 4. 独自マッチャ（`m.matcher(fn)`）の書き方
> **代替手段**: なし

### 5.6 Plugins（原文逐語）

webcrackの処理は6ステージから成り、各ステージの後にプラグインを差し込める。

```text
Webcrack's processing pipeline consists of six key stages:

1. Parse: The input code is parsed into an Abstract Syntax Tree (AST).
2. Prepare: Performs basic normalization, such as adding block statements.
3. Deobfuscate
4. Transpile and Unminify
5. JSX and Unpack
6. Generate: Converts the modified AST back into executable code.
```

差し込めるステージ（原文逐語）。

```text
- `afterParse`
- `afterPrepare`
- `afterDeobfuscate`
- `afterUnminify`
- `afterUnpack`
```

プラグインは定義順に逐次実行される（`Plugins are executed sequentially in the order they are defined for each stage.`）。プラグイン関数には限定されたユーティリティのみが渡される（原文逐語）。

```text
- `parse`
- `types`
- `traverse`
- `template`
- `matchers`
```

プラグインの例（逐語）。すべての数値リテラルを文字列`'x'`に置換する。

```js
import { webcrack } from 'webcrack';

function myPlugin({ types: t }) {
  return {
    pre() {
      console.log('Running before traversal');
    },
    visitor: {
      NumericLiteral(path) {
        console.log('Found a number:', path.node.value);
        path.replaceWith(t.stringLiteral('x'));
      },
    },
    post() {
      console.log('Running after traversal');
    },
  };
}

const result = await webcrack('1 + 1', {
  plugins: {
    afterParse: [myPlugin],
  },
});
console.log(result.code); // '"xx"'
```

既存のBabelプラグインも、上記の限定APIしか使わなければ利用できる（逐語）。

```js
import removeConsole from 'babel-plugin-transform-remove-console';
import { webcrack } from 'webcrack';

const result = await webcrack('consol.log(a), b()', {
  plugins: {
    afterUnminify: [removeConsole],
  },
});
console.log(result.code); // 'b();'
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: Babel Plugin Handbook — https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#writing-your-first-babel-plugin
> **なぜ**: 独自プラグインのvisitorを書くにはBabelのプラグイン基礎が必要だが、本節では最小例のみ扱っている。
> **読みどころ**:
> 1. visitorの書き方（`enter` / `exit`）
> 2. `path.replaceWith` / `path.remove` / `path.scope`
> 3. `@babel/types`のビルダとバリデータ
> 4. スコープとバインディングの扱い（webcrackの`renameFast` / `generateUid`の背景。変数リネームや一意な識別子生成がなぜ安全に行えるかがここで理解できる）
> **代替手段**: なし

---

## 6. 実際の処理パイプライン（一次ソース: `src/index.ts`）

### 6.1 ブックマークレットの自動検出

ドキュメントの「6ステージ」より詳細な実体がソースに書かれている。まず入力が`javascript:`で始まるブックマークレットの場合、自動でURLデコードする（逐語）。

```ts
  const isBookmarklet = /^javascript:./.test(code);
  if (isBookmarklet) {
    code = code
      .replace(/^javascript:/, '')
      .split(/%(?![a-f\d]{2})/i)
      .map(decodeURIComponent)
      .join('%');
  }
```

### 6.2 パース設定

壊れた/断片的なスクリプトでも可能な限り解析を続ける設定になっている（逐語）。`errorRecovery: true`がその要である。

```ts
      ast = parse(code, {
        sourceType: 'unambiguous',
        allowReturnOutsideFunction: true,
        errorRecovery: true,
        plugins: ['jsx'],
      });
      if (ast.errors?.length) {
        debug('webcrack:parse')('Recovered from parse errors', ast.errors);
      }
```

パース時にエラーがあっても`errorRecovery: true`で解析は続行されるが、そのとき`ast.errors`に回復したエラーが溜まる。上のコードはそれが存在する場合に`debug('webcrack:parse')`で回復ログを出す。`debug`は環境変数`DEBUG`で有効化される定番のデバッグ出力ライブラリで、`DEBUG=webcrack:parse`を付けて実行するとどこで構文が壊れていたかを追える。断片的なスクリプトを扱うときの手掛かりになる。

### 6.3 prepareステージ — なぜ`removeNodeFields`を別traverseで走らせるか

prepareステージは、後段の解析を軽く速くするための下ごしらえを行う。その先頭で呼ばれる`removeNodeFields`について、ソースには設計意図のコメントが逐語で付いている。

```ts
      // Separate traverseFast is ~4x faster than running it within the merged prepare visitor.
      // This introduces some initial performance overhead, but reduces the memory usage of each AST node by half,
      removeNodeFields(ast);
      applyTransforms(
        ast,
        [blockStatements, sequence, splitVariableDeclarations],
        { name: 'prepare' },
      );
```

コメントの意味はこうである。`removeNodeFields`はASTの各ノードから不要なフィールドを削り落とす処理で、これを他のprepare変換とまとめた1つのvisitorで走らせるのではなく、専用の高速走査（`traverseFast`）で単独実行している。理由は2つ。①`traverseFast`で単独に回すほうが約4倍速い、②最初に少しオーバーヘッドが増えるが、以降ASTノード1つあたりのメモリ使用量が半減する。つまり大きなバンドルでもヒープを節約しながら解析するための最適化である。前述のHeap Out Of Memory（8.3）とも関係する。

### 6.4 実行順まとめ（教科書向け）

パイプライン全体を表にすると次のとおり。プラグインの差し込み点も併記する。

| # | ステージ | 内容 |
| --- | --- | --- |
| 0 | ブックマークレット検出 | `javascript:`プレフィックスを剥がしてURLデコード |
| 1 | Parse | `@babel/parser`（`sourceType: 'unambiguous'`, `errorRecovery: true`, jsxプラグイン） |
| — | `afterParse`プラグイン | |
| 2 | Prepare | `removeNodeFields` → `blockStatements`, `sequence`, `splitVariableDeclarations` |
| — | `afterPrepare`プラグイン | |
| 3 | Deobfuscate | String Array → Rotator → Decoders → VMデコード → mergeStrings/deadCode/controlFlowObject/controlFlowSwitch |
| — | `afterDeobfuscate`プラグイン | |
| 4 | Transpile + Unminify | `transpile` → `unminify` |
| — | `afterUnminify`プラグイン | |
| 5 | Mangle（任意） | `mangle: true`またはフィルタ関数 |
| 6 | selfDefending / debugProtection（unminify後でないと検出できない）+ jsx / jsxNew | |
| 7 | mergeObjectAssignments + evaluateGlobals | |
| 8 | Generate | `generate(ast)`で`outputCode`を確定 |
| 9 | Unpack | `unpackAST(ast, options.mappings(m))`（ASTを破壊的に変更するためgenerateの後） |
| — | `afterUnpack`プラグイン | |

進捗は各ステージ終了ごとに`options.onProgress((100 / stages.length) * (i + 1))`で0〜100%として報告される。unpackがgenerateの後に来るのは、モジュール展開がASTを破壊的に変更し、importがトップレベルに来なくなる可能性があるため、コードを先に生成しておく必要があるからである。

---

## 7. Webプレイグラウンド

### 7.1 概要（原文逐語）

```text
On the playground you can deobfuscate code without installing anything.
It runs entirely in the browser, so the code never leaves your computer.
```

インストール不要で、ブラウザ内で完結する。コードは自分のPCから出ない。

キーボードショートカット（原文のTIPブロックを逐語）。

```text
- Press `F1` to open the command palette
- Press `Alt`+`Enter` to run webcrack on the code
- Press `Shift`+`Enter` to evaluate and replace the selected code as a value (`[[3+4]][0]` -> `[7]`)
- Press `Ctrl`+`Shift`+`Enter` to evaluate and replace the selected code raw (`'x' + ' = \'val\''` -> `x = 'val'` instead of a string)
- Press `Ctrl`+`S` to download the code in the active tab as a `.js` file
```

表にすると次のとおり。`Shift`+`Enter`系は難読化文字列の手動デコードに特に有用である。

| キー | 動作 |
| --- | --- |
| `F1` | コマンドパレットを開く |
| `Alt`+`Enter` | コードにwebcrackを実行 |
| `Shift`+`Enter` | 選択範囲を**値として**評価して置換（`[[3+4]][0]` → `[7]`） |
| `Ctrl`+`Shift`+`Enter` | 選択範囲を**rawとして**評価して置換（`'x' + ' = \'val\''` → 文字列ではなく`x = 'val'`） |
| `Ctrl`+`S` | アクティブタブのコードを`.js`としてダウンロード |

### 7.2 クエリパラメータとプライバシー（原文逐語）

```text
| Parameter | Description                            |
| --------- | -------------------------------------- |
| `code`    | Code as a string (max length: ~16,000) |
| `url`     | URL to fetch code from                 |
```

`code`か`url`のどちらかを渡してエディタにコードを読み込める。ただし警告がある（原文逐語）。

```text
Use this only if you don't mind netlify or corsproxy.io seeing the code/url, otherwise paste it directly into the editor.
```

重要な運用上の注意として、`url=`パラメータを使うと**netlifyとcorsproxy.ioにコード/URLが見える**。バグバウンティで顧客の非公開資産を扱う場合は、この機能を使わずエディタへ直接貼り付けるか、ローカルCLIを使うべきである。

> ### 📌 ここは自分で開いて読んでください
> **資料**: webcrackオンラインプレイグラウンド — https://webcrack.netlify.app/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: ドメインがegressプロキシで遮断され、かつMonacoベースの対話的エディタは静的取得に意味がないため）。
> **読みどころ**:
> 1. `Alt`+`Enter`で難読化サンプルを実際に変換しbefore/afterを体感する
> 2. `Shift`+`Enter` / `Ctrl`+`Shift`+`Enter`による選択範囲の部分評価（難読化文字列の手動デコードに有用）
> 3. 左右タブでモジュールごとの出力を確認する
> 4. `Ctrl`+`S`で結果をダウンロードする
> **代替手段**: ローカルCLI（`webcrack input.js`）でほぼ同じ変換を実行できる。

---

## 8. よくあるエラーと対処

### 8.1 isolated-vm関連（原文逐語）

```text
- isolated_vm.node: undefined symbol: ...
- ERR_DLOPEN_FAILED
- Segmentation fault
```

`undefined symbol`の`...`部分には、実機では次のような具体的なC++シンボル名が入る（ドキュメントの例を逐語）。実際に同じメッセージが出たか照合する手掛かりになる。

```text
isolated_vm.node: undefined symbol: _ZNK2v815ValueSerializer8Delegate20SupportsSharedValuesEv
```

これは、V8（Node.jsのJavaScriptエンジン）の内部シンボルで、Nodeのバージョンが変わるとこの名前や有無が変わる。だからNode本体と`isolated-vm`のビルドがずれると「そんなシンボルは無い」というエラーになる。これらは、使っているNode.jsバージョンが`isolated-vm`パッケージと非互換なときに起きる。webcrackインストール後にNodeをアップグレードしても発生する。対処は`npm rebuild isolated-vm`を実行するか、`node_modules/isolated-vm`ディレクトリを削除して`npm install`し直すこと。

Node 20.x以上ではsnapshot無効化が必要な場合がある（逐語）。

```sh
set NODE_OPTIONS=--no-node-snapshot
webcrack input.js
```

```sh
NODE_OPTIONS=--no-node-snapshot webcrack input.js
```

```sh
node --no-node-snapshot your-script.js
```

### 8.2 Cannot Find Module（原文逐語）

```text
Error: Cannot find module './out/isolated_vm'
```

pnpm 10以降が既定でpostinstallスクリプトを実行しないために起きる。インストールコマンドに`--allow-build=isolated-vm --force`を付けて再実行する。

### 8.3 Heap Out Of Memory（原文逐語）

```text
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

大きなバンドルでヒープが足りないときに起きる。`--max-old-space-size`フラグでヒープ上限を増やす（この例では8192MB＝8GB）。ドキュメントはWindows / Linux・Mac / node実行の3バリアントを逐語で載せている。環境に合わせて選ぶ。

Windows（コマンドプロンプト。`set`で環境変数を設定してから実行する）:

```sh
set NODE_OPTIONS=--max-old-space-size=8192 && webcrack bundle.js
```

Linux / Mac（環境変数を同じ行の先頭に置く）:

```sh
NODE_OPTIONS="--max-old-space-size=8192" webcrack bundle.js
```

Node.jsスクリプトとして直接実行する場合（`node`に直接フラグを渡す）:

```sh
node --max-old-space-size=8192 your-script.js
```

### 8.4 `__DECODE_0__`が残る（原文逐語）

```text
If this appears in your code, the deobfuscator failed to decode a string from the string array.
This can happen in forked javascript-obfuscator versions or when `Dead Code Injection` is enabled.
```

出力に`__DECODE_0__`が残っていたら、文字列配列からの復号に失敗している。javascript-obfuscatorのフォーク版、またはDead Code Injection（ダミーコード注入）が有効なときに起きる。この場合はwebcrackにissueを報告する。ドキュメントはバグ報告テンプレート付きのissue作成URLを逐語で案内している。

```text
Open an issue if you encounter this.
https://github.com/j4k0xb/webcrack/issues/new?assignees=&labels=bug&projects=&template=bug_report.yml
```

このURLにはあらかじめ`labels=bug`とバグ報告用テンプレート（`bug_report.yml`）が指定されているので、開くと報告フォームがそのまま表示される。再現できるサンプルコードを添えると開発者が対処しやすい。

### 8.5 エラー対処の一覧表

| 症状 | 原因 | 対処（原文コマンド） |
| --- | --- | --- |
| `isolated_vm.node: undefined symbol: _ZNK2v8...` / `ERR_DLOPEN_FAILED` / `Segmentation fault` | Nodeバージョンとisolated-vmのABI非互換 | `npm rebuild isolated-vm`、または`node_modules/isolated-vm`削除→`npm install` |
| 同上（Node 20.x以上） | snapshot機能との衝突 | `NODE_OPTIONS=--no-node-snapshot webcrack input.js` |
| `Error: Cannot find module './out/isolated_vm'` | pnpm 10以降が既定でpostinstallを実行しない | `--allow-build=isolated-vm --force`を付ける |
| `FATAL ERROR: Ineffective mark-compacts near heap limit` | 大きなバンドルでヒープ不足 | `NODE_OPTIONS="--max-old-space-size=8192" webcrack bundle.js` |
| 出力に`__DECODE_0__`が残る | 文字列配列のデコード失敗（フォーク版/Dead Code Injection） | `issues/new?...&template=bug_report.yml`のURLからissueを報告する |

---

## 9. バグバウンティ／クライアントサイド診断での実践的な使い方

〔補足〕以下は原文に明示されていない運用上の位置づけを、上記の一次情報から導ける範囲で整理したもの。ツール名・オプション名・出力ファイル名はすべて上記の一次情報に基づく。攻撃手法はすべて、許可された診断・バグバウンティ・自分で立てた検証環境を前提とする。

### 9.1 収集 → 展開 → 探索の流れ

対象サイトの`main.[hash].js`などを取得し、`webcrack bundle.js -o out`でモジュール単位に分割する。`out/bundle.json`で`entryId`と全モジュールの`id`/`path`を確認し、`out/*.js`をgrepしてsource（`location.hash`, `postMessage`, `document.referrer`など、攻撃者が操作できる入力源）とsink（`innerHTML`, `eval`, `document.write`など、危険な処理点）を探す。

### 9.2 バンドルのままgrepするより有利な理由

unminifyによって`!0`→`true`、`void 0`→`undefined`、`console["log"]`→`console.log`、カンマ演算子の分解、三項→ifが適用されるので、**識別子や文字列がgrepで引っかかる形に戻る**。特に`computed-properties`（`obj["dangerous"]` → `obj.dangerous`）と`raw-literals`（`'\x61\x6c\x65\x72\x74'` → `"alert"`）は、文字列ベースのsink検索の成否を左右する。

### 9.3 難読化された第三者スクリプトの解析

obfuscator.ioで保護された広告/計測/スキマー系スクリプトは文字列配列方式が多く、webcrackのdeobfuscateで**文字列がすべて平文リテラルに戻る**。ここから外部送信先ドメイン・エンドポイント・収集対象フィールド名が判明する。

### 9.4 バージョン間diff

`mappings`で内容ベースの安定パス（例: `'./utils/color.js': m.regExpLiteral('^#([0-9a-f]{3}){1,2}$')`）を与えて出力を固定し、デプロイのたびにdiffを取れば新機能・新エンドポイントの検知に使える（原文: `Useful for reverse-engineering and tracking changes across multiple versions of a bundle.`）。

### 9.5 プラグインでの自動走査

`plugins: { afterUnminify: [myPlugin] }`にBabel互換のvisitorを差し込めば、`innerHTML`代入や`new Function(...)`のようなsinkをASTレベルで列挙できる（ドキュメントの`babel-plugin-transform-remove-console`の例と同じ形式）。

### 9.6 安全上の注意

解析対象は信頼できないコードである。APIの`sandbox: eval`は原文で明確に`Don't run this with untrusted or malicious code.`と警告されている。Node CLIは既定で`isolated-vm`（10秒タイムアウトの隔離Isolate）を使うため相対的に安全だが、解析は隔離環境で行うのが望ましい。また`-f/--force`は出力ディレクトリを`rm -rf`する点に注意。

### 9.7 限界の把握

①webpackのマルチチャンクは未対応（`multiple chunks are not supported _yet_.`）、②JSX復元はReact **UMD**ビルドのみ、③古いobfuscator.ioバージョンは未対応、④`__DECODE_0__`が残ったらフォーク版かDead Code Injectionの影響。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Control Flow Object変換の図解（Excalidraw） — https://excalidraw.com/#json=0vehUdrfSS635CNPEQBXl,hDOd-UO9ETfSDWT9MxVX-A
> **なぜ**: JS必須のインタラクティブ図であり静的テキスト取得ができない。リンクは`src/deobfuscate/control-flow-object.ts`のJSDocに記載された一次情報。
> **読みどころ**:
> 1. 制御フロー用オブジェクトの生成と参照の関係
> 2. エイリアス変数を経由した間接参照がどう解決されるか
> 3. プロキシ関数（`function(a,b){return a+b}`）がどこにインライン展開されるか
> 4. `"6|0|4|3|1|5|2"`のような順序文字列の役割
> **代替手段**: なし

> ### 📌 ここは自分で開いて読んでください
> **資料**: javascript-obfuscator（難読化器本体） — https://github.com/javascript-obfuscator/javascript-obfuscator
> **なぜ**: webcrackが解除対象とする難読化器そのもの。本節では扱っていない（担当URL外）。
> **読みどころ**:
> 1. 各オプション（String Array Encoding, Control Flow Flattening Threshold, Dead Code Injection Thresholdなど）の意味と既定値
> 2. `src/custom-code-helpers/`配下のテンプレート（webcrackがマッチさせている元コードそのもの）
> 3. `SelfDefendingTemplate.ts` / `DomainLockTemplate.ts` / `DebugProtectionFunctionTemplate.ts` / `SingleCallControllerTemplate.ts`
> 4. オプションの組み合わせによる出力の違い
> **代替手段**: なし

---

## 手を動かす

1. **インストール**: Node.js 22または24（および将来の偶数系26系）を用意し、`npm install -g webcrack@latest`を実行する（pnpmなら`pnpm add -g webcrack@latest --allow-build=isolated-vm`）。対応バージョンは`package.json`の`engines`フィールド（`">=22.0.0 <23 || >=24.0.0 <25 || >=26.0.0 <27"`）が正で、README準拠なら偶数系メジャーが対象になる。奇数系は避ける。
2. **1行で試す**: `echo "const a = 1+1;" | webcrack` を実行し、`const a = 2;`と表示されることを確認する。
3. **難読化サンプルの解除**: obfuscator.ioで自分の書いた小さなJSを難読化してファイルに保存し、`webcrack obf.js > clean.js`で復元。`clean.js`を開いて文字列が平文に戻っているか確認する。
4. **バンドルの展開**: webpackで作った`bundle.js`を用意し、`webcrack bundle.js -o out`を実行。`out/bundle.json`で`type`と`entryId`を、`out/index.js`と`out/1.js`などでモジュール本体を確認する。
5. **sink検索**: 展開後のディレクトリで`grep -rn "innerHTML\|eval\|document.write" out/`を実行し、危険な処理点を洗い出す。
6. **Node APIとmappings**: 次のスクリプトを書いて実行し、`output-dir`に安定パスでモジュールが保存されるか確認する。

```js
import fs from 'fs';
import { webcrack } from 'webcrack';

const code = fs.readFileSync('bundle.js', 'utf8');
const result = await webcrack(code, {
  mappings: (m) => ({
    './utils/color.js': m.regExpLiteral('^#([0-9a-f]{3}){1,2}$'),
  }),
});
await result.save('output-dir');
```

7. **プラグインで自動列挙**: `afterUnminify`に自作のBabel互換visitorを差し込み、`AssignmentExpression`のうち左辺が`innerHTML`のものをコンソールに列挙してみる。

## つまずきポイント

- `-f/--force`は指定した出力ディレクトリを丸ごと削除する。既存の作業ディレクトリを`-o`に指定してはいけない。
- ログはstderr、コードはstdoutに分かれる。`webcrack input.js > output.js`ではログは画面に残り、コードだけがファイルへ行く。これは仕様。
- Nodeの奇数系メジャーバージョンは`isolated-vm`のABIが壊れやすく非推奨。エラーが出たら偶数系（22/24、および`engines`が許可する26系）に切り替える。対応範囲は`package.json`の`engines`フィールド（`">=22.0.0 <23 || >=24.0.0 <25 || >=26.0.0 <27"`）が正なので、26などの新しい偶数系を非対応と早合点しないこと。
- JSX復元はReactの**UMDビルド**のみ。バンドル済みで`React`がローカル変数化しているコードでは効かない。
- webpackの**マルチチャンク**は未対応。本体だけ展開しても遅延読み込みチャンクは別途取得が必要。
- 出力に`__DECODE_0__`が残っていたら復号失敗のサイン。フォーク版obfuscatorやDead Code Injectionが原因。
- プレイグラウンドの`?url=`はnetlify/corsproxy.ioにデータが渡る。顧客の非公開資産にはローカルCLIを使う。
- `sandbox: eval`は信頼できないコードに使ってはいけない。原文が明確に警告している。

## この節のまとめ

- webcrackのtranspile機能は、Babel等がダウンレベル化した`?.` `??` `||=` `??=`・デフォルト引数・テンプレートリテラルをモダン構文へ復元し、`_a`のような一時変数ノイズを消す。
- モダン構文への復元は、どの値がnullableでどこで分岐するかを読みやすくし、source→sink追跡を助ける。
- JSX機能は`React.createElement`をタグ記法へ戻すが、現状はReactのUMDビルドのみ対応。
- webpackバンドルは`__webpack_require__`とモジュールファクトリで構成され、`p`（public path）と`u(chunkId)`から追加チャンクのURL組み立て規則が読める。
- `l()`のscriptタグ挿入とpublic pathの汚染はscript gadget / XSSの観点で注目点になる。
- browserifyは絶対パスを保存しないため、webcrackが依存ツリーから相対パスを再構築する（不明な階層は`tmp0/tmp1`）。
- `Bundle`はパストラバーサル検知（`relative(...).startsWith('..')`で例外）を備え、悪意あるmappingでも出力ディレクトリ外に書かない。
- CLIは`webcrack [options] [file]`でstdin対応、`-o`でモジュール展開、`-f`は出力先を`rm -rf`するので注意。
- 出力ディレクトリには`deobfuscated.js` / `bundle.json` / `index.js` / `1.js…`が生成される。
- Node APIは`webcrack(code, options)`が`{ code, bundle, save(path) }`を返し、`mangle`はフィルタ関数も取れる。
- `sandbox`はブラウザで文字列配列復号に必須。プレイグラウンドはsandybox＋CSP `default-src 'none'`＋10秒タイムアウトで安全に実装している。
- Node環境の既定sandboxは`isolated-vm`（隔離Isolate、10秒タイムアウト）。
- `mappings`で内容ベースの安定パスを付ければ、ビルドごとに変わるモジュールIDに惑わされずバージョン間diffが取れる。
- プラグインは5つのステージ（afterParse/afterPrepare/afterDeobfuscate/afterUnminify/afterUnpack）に差し込め、Babel互換visitorでsinkを自動列挙できる。
- パイプラインはブックマークレット検出→Parse→Prepare→Deobfuscate→Transpile+Unminify→Mangle→selfDefending/JSX→Generate→Unpackの順で、unpackはASTを壊すのでgenerateの後。
- よくあるエラーはisolated-vmのABI非互換・pnpm 10のpostinstall・ヒープ不足・`__DECODE_0__`の4系統で、それぞれ定型の対処がある。
- 実務では「収集→展開→grep でsource/sink探索」が基本フロー。unminifyで文字列・識別子がgrepにかかる形に戻るのが利点。

## 理解度チェック

1. transpile機能が`a !== null && a !== undefined ? a : b`を何に復元するか。
   ▶ 答え: `a ?? b`（nullish合体演算子）。

2. JSX復元が対応しているReactのビルド形式は何か。バンドル済みコードで効くか。
   ▶ 答え: React UMDビルドのみ。バンドル済み（`React`がローカル変数化）では効かない。

3. webpackランタイムで、追加チャンクのファイル名を生成するプロパティとpublic base pathを持つプロパティはそれぞれ何か。
   ▶ 答え: ファイル名生成は`u(chunkId)`、public base pathは`p`。

4. browserifyバンドルで、元のディレクトリ名が分からないときwebcrackが使う仮の名前は何か。
   ▶ 答え: `tmp0`, `tmp1`のような`tmp`＋連番のディレクトリ名。

5. `webcrack bundle.js -o out`を実行したとき、`out`に生成される4種類のファイル（群）を挙げよ。
   ▶ 答え: `deobfuscated.js`、`bundle.json`、`index.js`、残りのモジュール`1.js` `2.js`…。

6. CLIの`-f/--force`を既存の作業ディレクトリに使うと何が起きるか。
   ▶ 答え: そのディレクトリが`rm -rf`相当で丸ごと削除される。中身も消える。

7. ブラウザで文字列配列を復号するとき必須のオプションは何か。プレイグラウンドはそれをどう安全に実装しているか。
   ▶ 答え: `sandbox`オプション。sandybox（iframe隔離）＋CSP `default-src 'none'`（ネットワーク遮断）＋`Promise.race`による10秒タイムアウトで実装している。

8. `mappings`オプションはバグバウンティのどんな作業に役立つか。
   ▶ 答え: モジュールに内容ベースの安定パスを付けることで、ビルドごとに変わるIDに関係なくバージョン間diffを取り、新エンドポイントやsinkを検知できる。

9. 出力に`__DECODE_0__`が残っていたら何を意味するか。原因は何か。
   ▶ 答え: 文字列配列からの復号失敗。原因はjavascript-obfuscatorのフォーク版、またはDead Code Injectionが有効なこと。

10. unminifyがsink検索に有利な理由を、具体的な変換を2つ挙げて説明せよ。
    ▶ 答え: `computed-properties`（`obj["dangerous"]`→`obj.dangerous`）や`raw-literals`（`'\x61\x6c\x65\x72\x74'`→`"alert"`）により、識別子や文字列がgrepで引っかかる平文の形に戻るため。

## 出典

- https://github.com/j4k0xb/webcrack
- https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/concepts/transpile.md
- https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/concepts/jsx.md
- https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/concepts/unpack.md
- https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/guide/cli.md
- https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/guide/api.md
- https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/guide/web.md
- https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/guide/common-errors.md
- https://webcrack.netlify.app/docs/concepts/unpack.html
- https://webcrack.netlify.app/
- https://github.com/trentmwillis/sandybox
- https://github.com/laverdet/isolated-vm
- https://github.com/codemod-js/codemod/tree/main/packages/matchers#readme
- https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#writing-your-first-babel-plugin
- https://github.com/javascript-obfuscator/javascript-obfuscator
- https://excalidraw.com/#json=0vehUdrfSS635CNPEQBXl,hDOd-UO9ETfSDWT9MxVX-A

<!-- sources: https://github.com/j4k0xb/webcrack, https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/concepts/transpile.md, https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/concepts/jsx.md, https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/concepts/unpack.md, https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/guide/cli.md, https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/guide/api.md, https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/guide/web.md, https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/guide/common-errors.md, https://webcrack.netlify.app/docs/concepts/unpack.html, https://webcrack.netlify.app/, https://github.com/trentmwillis/sandybox, https://github.com/laverdet/isolated-vm, https://github.com/codemod-js/codemod/tree/main/packages/matchers#readme, https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#writing-your-first-babel-plugin, https://github.com/javascript-obfuscator/javascript-obfuscator, https://excalidraw.com/#json=0vehUdrfSS635CNPEQBXl,hDOd-UO9ETfSDWT9MxVX-A -->
<!-- terms: トランスパイル, ダウンレベル化, nullish合体演算子, オプショナルチェーン, 論理代入演算子, テンプレートリテラル, JSX, React.createElement, UMDビルド, バンドラ, webpack, browserify, debundle, __webpack_require__, モジュールファクトリ, チャンク, public path, エントリモジュール, 依存ツリー, パストラバーサル, ESM, CLI, stdin, stdout, mangle, mappings, sandbox, isolated-vm, sandybox, CSP, プラグイン, visitor, AST, ブックマークレット, errorRecovery, source, sink, script gadget, Dead Code Injection, 文字列配列 -->
<!-- self-read: https://webcrack.netlify.app/docs/concepts/unpack.html | webcrack.netlify.appがegressプロキシで遮断され、本文中の構造図が画像でテキスト化できない -->
<!-- self-read: https://github.com/trentmwillis/sandybox | 本節は利用例のみ扱いiframe隔離モデルの詳細を取り込んでいない -->
<!-- self-read: https://github.com/laverdet/isolated-vm | Node環境の隔離実行基盤だが内部やABI制約の詳細を取り込んでいない -->
<!-- self-read: https://github.com/codemod-js/codemod/tree/main/packages/matchers#readme | mappingsに渡すマッチャの一覧とバックリファレンスの書き方は本節に取り込んでいない -->
<!-- self-read: https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#writing-your-first-babel-plugin | 独自visitorを書くためのBabelプラグイン基礎を本節では最小例のみ扱う -->
<!-- self-read: https://webcrack.netlify.app/ | ドメイン遮断かつMonacoベースの対話的エディタで静的取得に意味がない -->
<!-- self-read: https://excalidraw.com/#json=0vehUdrfSS635CNPEQBXl,hDOd-UO9ETfSDWT9MxVX-A | JS必須のインタラクティブ図で静的テキスト取得ができない -->
<!-- self-read: https://github.com/javascript-obfuscator/javascript-obfuscator | webcrackが解除対象とする難読化器本体で本節の担当URL外 -->
