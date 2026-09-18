# webcrack で本番 JavaScript を読める形に戻す（難読化解除と unminify の仕組み）

> **この節で分かること**
> - webcrack が何をするツールで、バグバウンティのどの場面で使うのかを説明できる
> - obfuscator.io（javascript-obfuscator）の各難読化オプションと、webcrack がそれをどう解除するかの対応関係を説明できる
> - 文字列配列（String Array）を「静的解析ではなく実際に評価して」デコードする設計と、その隔離実行（サンドボックス）の意味を説明できる
> - 制御フロー平坦化（Control Flow Flattening）・デッドコード注入・Self Defending・Debug Protection が AST パターンでどう検出・除去されるかを説明できる
> - unminify が縮小化コードを可読な構文へ戻す 20 種類以上の変換を、before → after で自分で確認できる
> - webcrack をインストールして、難読化された JS ファイルを実際に復元する手順を再現できる

**元資料**: https://github.com/j4k0xb/webcrack （原典取得済み。README・ドキュメント Markdown・`packages/webcrack/src/` の実装ソースを逐語取得）
**関連する節**: 20b（webcrack のバンドル展開・transpile 解除・JSX 復元・CLI/API リファレンス）

---

## 1. webcrack とは何か、なぜバグバウンティで要るのか

### 1.1 一言でいうと「JS を元の姿に近づける道具」

webcrack（ウェブクラック）とは、**JavaScript のリバースエンジニアリング（reverse engineering、逆解析）用のツール**のこと。リバースエンジニアリングとは、完成した成果物から元の設計や仕組みを読み解く作業のことで、ここでは「読みにくくされた本番 JS を、人間が読める元のソースコードに近づける」という意味になる。

GitHub のリポジトリ `j4k0xb/webcrack` の説明文（description）は次のとおりである。

```
Deobfuscate obfuscator.io, unminify and unpack bundled javascript
```

README 冒頭の逐語（原文のまま）はこうなっている。

```
webcrack is a tool for reverse engineering javascript.
It can deobfuscate [obfuscator.io](https://github.com/javascript-obfuscator/javascript-obfuscator), unminify,
transpile, and unpack [webpack](https://webpack.js.org/)/[browserify](https://browserify.org/),
to resemble the original source code as much as possible.
```

つまり webcrack は 5 つの機能を持つ。

1. **Deobfuscate（難読化解除）** — obfuscator.io で難読化されたコードを元に戻す
2. **Unminify（縮小化の巻き戻し）** — 縮小（minify）されたコードを人間可読な構文へ戻す
3. **Transpile（トランスパイル解除）** — Babel/TypeScript/SWC がダウンレベル化した古い構文をモダン構文へ復元する（本節では概要のみ。詳細は 20b）
4. **Unpack Bundles（バンドル展開）** — webpack / browserify のバンドルをモジュールごとのファイルに分解する（詳細は 20b）
5. **JSX 復元** — `React.createElement(...)` を JSX に戻す（詳細は 20b）

本節（20a）では、このうち **難読化解除** と **unminify** を扱う。

### 1.2 なぜクライアントサイド診断で必要なのか

バグバウンティでクライアントサイドの脆弱性（ブラウザ側で起きる欠陥）を探すとき、まず読むのは Web サイトが配信している JavaScript である。ところが本番の JS はほぼ例外なく、縮小化（minify、改行や空白を削り変数名を短くする処理）やバンドル化（複数ファイルを 1 つにまとめる処理）を経ており、さらにスキマー（決済情報を盗むスクリプト）やマルウェア、ライセンス保護スクリプトでは意図的な難読化（obfuscation）が施されている。

これらは人間には読めない。webcrack は、この読めない本番 JS を**読める形に戻して、source（入力の入口）と sink（危険な出力先）を探すための前処理ツール**として位置づけられる。ソースコードが読めなければ、どこにユーザー入力が入り、どこで `innerHTML` や `eval` に渡るのか、といった脆弱性の芽を追うことができない。

> 〔補足〕source とは、攻撃者が値を注入できる入口（`location.hash`、`postMessage` の `event.data` など）のこと。sink とは、その値が届くと危険な出力先（`innerHTML`、`document.write`、`eval` など）のこと。難読化されたコードでは、この source から sink までの流れ（データフロー）が意図的に見えなくされている。

### 1.3 設計の 6 本柱

README では webcrack の設計方針が 6 つの柱として挙げられている（逐語）。

```
- 🚀 **Performance** - Various optimizations to make it fast
- 🛡️ **Safety** - Considers variable references and scope
- 🔬 **Auto-detection** - Finds code patterns without needing a config
- ✍🏻 **Readability** - Removes obfuscator/bundler artifacts
- ⌨️ **TypeScript** - All code is written in TypeScript
- 🧪 **Tests** - To make sure nothing breaks
```

日本語で整理すると次のようになる。

| 柱 | 意味 |
| --- | --- |
| Performance（性能） | 高速に動かすための各種最適化 |
| Safety（安全性） | 変数の参照とスコープを考慮して壊さない |
| Auto-detection（自動検出） | 設定ファイル不要でコードパターンを自動で見つける |
| Readability（可読性） | 難読化器/バンドラが残す「痕跡（アーティファクト）」を除去する |
| TypeScript | 全コードが TypeScript で書かれている |
| Tests（テスト） | 何も壊れないことを保証するためのテスト |

とくに重要なのは **Auto-detection** と **Safety** である。Auto-detection は「難読化の種類をいちいち指定しなくても、既知のパターンを webcrack が勝手に見つける」ことを意味する。Safety は「変数のスコープ（有効範囲）を壊さずに変換する」ことを意味し、後述するデッドコード除去で同名変数の衝突を避ける処理などに具体化されている。

### 1.4 メタ情報

一次ソースから取得したリポジトリのメタ情報を表にまとめる。

| 項目 | 値 |
| --- | --- |
| リポジトリ | `j4k0xb/webcrack` |
| ライセンス | MIT |
| npm パッケージ名 | `webcrack` |
| バージョン（HEAD 時点） | 2.16.0 |
| homepage | `https://webcrack.netlify.app` |
| スター / フォーク | 2.9k / 336（取得時点の表示値） |
| watcher（監視者数） | 27（取得時点の表示値） |
| コミット数 | 593（取得時点の表示値） |
| open issue / PR | 40 / 10（取得時点の表示値） |
| Topics | `ast`, `browserify`, `bundle`, `debundle`, `deobfuscation`, `deobfuscator`, `extract`, `javascript`, `javascript-obfuscator`, `reverse-engineering`, `unminify`, `unpack`, `webpack` |

#### リポジトリのディレクトリ構成

一次ソース（GitHub のツリーページ）から取得したトップレベル構成は次のとおり。どこに何があるかを把握しておくと、ソースを自分で確認したいときに迷わない。

```
webcrack/
├── .github/            # CI・Issue テンプレート等
├── .vscode/
├── apps/               # アプリ群
│   ├── docs/           # VitePress 製のドキュメントサイト
│   ├── playground/     # Web プレイグラウンド
│   └── web/
├── packages/           # 本体パッケージ群（webcrack 本体はここ）
├── patches/
├── .gitignore
├── .prettierrc
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── eslint.config.js
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── turbo.json
├── vitest.config.js
└── vitest.workspace.json
```

本体の変換ロジックは `packages/webcrack/src/` 配下にあり、主要ディレクトリは `ast-utils`, `deobfuscate`, `transpile`, `unminify`, `unpack`, `transforms`, `plugin`, `utils` などである。本節で扱うパターンマッチのコードはほとんどが `deobfuscate` と `unminify` の下にある。

#### 寄付先（Donations）

README には作者への寄付先が記載されている（原文のまま逐語）。ツールの素性を確認する材料として、また「誰が作っているか」を知る手がかりとして挙げておく。

```
- GitHub Sponsors: https://github.com/sponsors/j4k0xb
- Ethereum: 0xb3eFD474Dd8aFA715F563EfA322F6ae9Ae9DfCeA
- Bitcoin: bc1qc3u7ef2rue75f6t8x290r0qk0u84f0ln8ndjun
- Solana: 6w9SFAYBxCKdtuj8DEAV9YT5zP68g4PyEkb21AmdxcBq
- Monero: 87iYegrerGf1DUsTvUnbsv8gjTMJmzS3idRxHWkCy4iz1Xz5CUnDXy3VkTToSg32LUW3cwNrgLKd1TXRJqJY7MnvVR9yidm
```

内部実装は **Babel の AST（抽象構文木、Abstract Syntax Tree）** を使っている。AST とは、ソースコードを「木構造のデータ」として表現したもので、`@babel/parser` がコードを AST に変換し、`@babel/traverse` で木を歩き、`@babel/types` でノードを組み立て直す。webcrack はこの AST に対してパターンマッチと書き換えを行う。パターンマッチには `@codemod/matchers` というライブラリを使う。

`@codemod/matchers` とは、AST のノードが「特定の形をしているか」を宣言的に書いて照合するためのライブラリのこと。本節に出てくる `m.capture`（一致した部分を捕捉して後で参照する）、`m.fromCapture`（捕捉した値と同一であることを要求する＝バックリファレンス）、`m.containerOf`（入れ子のどこかに含まれることを要求する）、`m.anyList` / `m.zeroOrMore`（可変長の並びを表す）などはすべてこのライブラリのマッチャである。webcrack のパターンマッチのコードは、この語彙を知らないと読み解けない。

> ### 📌 ここは自分で開いて読んでください
> **資料**: `@codemod/matchers`（AST パターンマッチのライブラリ） — https://github.com/codemod-js/codemod/tree/main/packages/matchers#readme
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: GitHub のサブディレクトリ README で、本ノートの一次取得対象は webcrack 本体に絞っていたため）。本節が引用する matcher コード（`m.capture` / `m.fromCapture` / `m.containerOf` / `m.anyList` / `m.zeroOrMore` など）は全編にわたって登場するので、語彙を押さえておくと読みやすさが段違いになる。
> **読みどころ**:
> 1. `m.capture` / `m.fromCapture` によるバックリファレンス（同じ変数名の再出現を要求する仕組み）
> 2. `m.containerOf` / `m.anyList` / `m.zeroOrMore` などの構造マッチャ
> 3. `mappings` オプションに渡せるマッチャの一覧
> 4. 独自マッチャ（`m.matcher(fn)`）の書き方
> **代替手段**: なし（同ライブラリの README が一次情報。webcrack の各 `*.ts` を併読すると具体例で理解できる）

> ### 📌 ここは自分で開いて読んでください
> **資料**: Babel Plugin Handbook（AST 変換の基礎） — https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#writing-your-first-babel-plugin
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 担当 URL 外だが、webcrack の変換はすべて Babel の visitor と AST 操作の上に成り立っており、`renameFast` / `generateUid` など本節に出る道具の背景は一次資料で理解するのが早い）。
> **読みどころ**:
> 1. visitor の書き方（`enter` / `exit`。本節の `control-flow-switch` などが `exit` を使う理由が分かる）
> 2. `path.replaceWith` / `path.remove` / `path.scope`（本節の削除・置換処理の土台）
> 3. `@babel/types` のビルダとバリデータ
> 4. スコープとバインディングの扱い（webcrack の `renameFast` / `generateUid` の背景。§10 のスコープ衝突回避を読む前に有用）
> **代替手段**: 日本語訳（同リポジトリの `translations/` 配下）も参照できる

### 1.5 ドキュメントサイトの構成

webcrack のドキュメントは `apps/docs/` にある **VitePress**（Vue 製の静的ドキュメントサイト生成ツール）で作られており、`https://webcrack.netlify.app/docs` で公開されている。ドキュメントの実体は `apps/docs/src/` 配下の Markdown なので、サイトが開けない環境でも GitHub の raw から同じ内容を読める（本節もその方法で一次取得している）。

トップページ（`apps/docs/src/index.md`）の features 表（原文のまま逐語）。

| アイコン | title | details |
| --- | --- | --- |
| 🛡️ | Deobfuscate | `Undo all the obfuscation techniques of obfuscator.io` |
| 🧹 | Unminify | `Convert minified code to human readable code` |
| 🧩 | Transpile | `Convert transpiled syntax back to modern JavaScript` |
| 📦 | Unpack Bundles | `Extract modules from webpack and browserify bundles to separate files` |

サイドバー構成（`.vitepress/config.ts` に定義。netlify 上の URL 構造そのもの）。どのページに何が書いてあるかの索引として使える。

| セクション | 項目 | リンク（`https://webcrack.netlify.app/docs` 起点） |
| --- | --- | --- |
| Guide | Introduction | `/guide/introduction` |
| Guide | CLI | `/guide/cli` |
| Guide | Node.js API | `/guide/api` |
| Guide | Website | `/guide/web` |
| Guide | Common Errors | `/guide/common-errors` |
| Concepts | Deobfuscate | `/concepts/deobfuscate` |
| Concepts | Unminify | `/concepts/unminify` |
| Concepts | Transpile | `/concepts/transpile` |
| Concepts | Unpack Bundle | `/concepts/unpack` |
| Concepts | JSX | `/concepts/jsx` |

サイト設定（`.vitepress/config.ts`、逐語）は次のとおり。

| 設定項目 | 値 |
| --- | --- |
| `title` | `'webcrack'` |
| `description` | `'Deobfuscate, unminify and unpack bundled javascript'` |
| `base` | `'/docs/'` |
| 検索 provider | `'local'`（ローカル全文検索。外部サービスに依存しない） |

編集リンクのパターンは次のとおりで、これは**ドキュメントの実体が `apps/docs/src/` 配下にある**ことの直接の根拠でもある。

```
https://github.com/j4k0xb/webcrack/edit/master/apps/docs/src/:path
```

## 2. 動作要件とインストール

### 2.1 Node.js のバージョン制約

README の要件（原文のまま逐語）はこうである。

```
## Requirements

Node.js 22 or 24.

> [!NOTE]
> webcrack depends on [`isolated-vm`](https://github.com/laverdet/isolated-vm), which [does not recommend using odd-numbered Node.js releases](https://github.com/laverdet/isolated-vm#security) because they frequently break ABI/API compatibility with V8.
```

つまり **Node.js 22 か 24** を使う。奇数系（23 など）が推奨されないのは、webcrack が依存する `isolated-vm` が「奇数バージョンの Node は V8 との ABI/API 互換をよく壊す」として推奨していないためである。ABI（Application Binary Interface）とは、コンパイル済みバイナリ同士が呼び合うための約束事のことで、これが崩れるとネイティブ拡張がクラッシュしうる。

`packages/webcrack/package.json` の `engines` フィールド（逐語）はさらに厳密で、次のとおり。

```json
"engines": {
  "node": ">=22.0.0 <23 || >=24.0.0 <25 || >=26.0.0 <27"
},
```

偶数メジャー（22 / 24 / 26）だけを受け付ける形になっている。`isolated-vm` は optionalDependencies として Node のメジャーバージョンで切り替える 2 つのエイリアスを持つ（逐語）。

```
"isolated-vm-6": "npm:isolated-vm@^6.1.2",
"isolated-vm-7": "npm:isolated-vm@^7.0.0"
```

主要な依存関係は次のとおり（逐語）。

```
@babel/generator ^7.29.1
@babel/helper-validator-identifier ^7.28.5
@babel/parser ^7.29.2
@babel/template ^7.28.6
@babel/traverse ^7.29.0
@babel/types ^7.29.0
@codemod/matchers ^1.7.1
commander ^14.0.3
debug ^4.4.3
```

### 2.2 インストールと基本コマンド

README のインストール手順（原文のまま逐語）。グローバルインストールは次のとおり。

```bash
npm install -g webcrack@latest
```

基本の使い方（逐語）。

```bash
webcrack input.js
webcrack input.js > output.js
webcrack bundle.js -o output-dir
```

- `webcrack input.js` — 復元結果を標準出力に表示する
- `webcrack input.js > output.js` — 結果をファイルへリダイレクトする
- `webcrack bundle.js -o output-dir` — バンドルを展開して出力ディレクトリへ書き出す（バンドル展開は 20b で扱う）

プロジェクトに組み込むためのローカルインストール（逐語）。

```bash
npm install webcrack@latest
```

Node API から使う最小例（README、逐語）。

```js
import fs from 'fs';
import { webcrack } from 'webcrack';

const input = fs.readFileSync('bundle.js', 'utf8');

const result = await webcrack(input);
console.log(result.code);
console.log(result.bundle);
await result.save('output-dir');
```

`webcrack(code)` は非同期関数で、`{ code, bundle, save(path) }` を返す。`code` が復元後のコード文字列、`bundle` はバンドルが検出された場合のモジュール情報、`save(path)` は結果をディレクトリへ書き出す関数である（API の詳細は 20b）。

### 2.3 開発予定（Planned Features）

Introduction ページの「Planned Features」（原文のまま逐語）。これは「まだできないこと」を知る手がかりにもなる。

```
- Smarter variable renaming, possibly with LLMs like GPT-3.5
- Support older obfuscator.io versions
- Unpack multi-chunk bundles
- Decompile [@babel/preset-env](https://babeljs.io/docs/babel-preset-env) helpers
- Decompile TypeScript helpers, modules and enums
```

つまり現状では「変数名を意味のある名前に戻す」機能は限定的で、「古い obfuscator.io バージョン」や「複数チャンクのバンドル」への対応は今後の課題として残っている。

## 3. 難読化解除がカバーする obfuscator.io のオプション一覧

### 3.1 obfuscator.io とは

obfuscator.io（javascript-obfuscator）とは、各難読化オプションを個別に ON/OFF できる OSS の JS 難読化器のことで、マルウェア配布スクリプトやスキマー、ライセンス保護スクリプトで広く使われる。webcrack はその「既知の出力テンプレート」を AST パターンとして直接マッチさせて元に戻す、という設計方針を採る。

ドキュメントの Deobfuscation ページ本文（原文のまま逐語）は、webcrack が解除できるオプションを次のように列挙している。

```
# Deobfuscation

webcrack can deobfuscate code obfuscated with [javascript-obfuscator](https://github.com/javascript-obfuscator/javascript-obfuscator) ([obfuscator.io](https://obfuscator.io))

- String Array
  - Rotate
  - Shuffle
  - Index Shift
  - Calls Transform
  - Variable/Function Wrapper Type
  - None/Base64/RC4 Encoding
  - Split Strings
  - Unicode Escape Sequence
- Other Transformations
  - Compact
  - Simplify
  - Numbers To Expressions
  - Control Flow Flattening
  - Dead Code Injection
  - Transform Object Keys
- Disable Console Output
- Self Defending
- Debug Protection
- Domain Lock
```

### 3.2 オプションと webcrack の対応表

各オプションを webcrack のどの変換（transform）が処理するかを対応表にまとめる。「変換」とは、AST に対する 1 つの書き換え処理の単位のことで、それぞれ `safe`（意味を変えない安全な変換）か `unsafe`（意味を変えうる変換）のタグを持つ。

| 分類 | obfuscator.io のオプション | webcrack の対応 |
| --- | --- | --- |
| String Array | Rotate | 対応（`array-rotator.ts` がローテータ IIFE を検出） |
| String Array | Shuffle | 対応 |
| String Array | Index Shift | 対応 |
| String Array | Calls Transform | 対応（`inline-object-props.ts` が引数オブジェクトを展開） |
| String Array | Variable/Function Wrapper Type | 対応（`inline-decoder-wrappers.ts` がエイリアスをインライン化） |
| String Array | None/Base64/RC4 Encoding | 対応（サンドボックスで実際にデコード関数を実行） |
| String Array | Split Strings | 対応（`merge-strings` で再結合） |
| String Array | Unicode Escape Sequence | 対応（`raw-literals` で元の文字へ） |
| Other Transformations | Compact | 対応（unminify 一式） |
| Other Transformations | Simplify | 対応 |
| Other Transformations | Numbers To Expressions | 対応（`number-expressions` の定数畳み込み） |
| Other Transformations | Control Flow Flattening | 対応（`control-flow-object.ts` / `control-flow-switch.ts`） |
| Other Transformations | Dead Code Injection | 対応（`dead-code.ts`） |
| Other Transformations | Transform Object Keys | 対応 |
| 単独機能 | Disable Console Output | 対応（`self-defending.ts` の SingleCallController マッチャが兼務） |
| 単独機能 | Self Defending | 対応（`self-defending.ts`） |
| 単独機能 | Debug Protection | 対応（`debug-protection.ts`） |
| 単独機能 | Domain Lock | 対応（`self-defending.ts` が兼務） |

この表にいくつか先取りの用語が出てくるので、ここで軽く定義しておく（詳しい解説はそれぞれの節で行う）。

- **定数畳み込み（constant folding）**とは、コンパイル時に定数式を計算して、その結果の値に置き換えることのこと。たとえば `1 + 2 * 3` を実行時ではなくあらかじめ `7` にしてしまう処理を指す。obfuscator.io の「Numbers To Expressions」は逆に `7` をわざと `-0x1021e + ...` のような式に膨らませる難読化なので、webcrack の `number-expressions`（定数畳み込み）はそれを計算し直して元の数値に戻す。実際の before → after は §13.3 の `number-expressions` の項で示す。
- **プロキシ関数（proxy function）**とは、受け取った引数を右から左へ中継するだけの関数のこと。たとえば `function(a, b){ return a + b }` のように、それ自体は意味のある処理をせず「加算を中継するだけ」の関数を指す。制御フロー平坦化のオブジェクト方式でよく使われる。詳しくは §9.2 で扱う。

IIFE（Immediately Invoked Function Expression、即時実行関数式）とは、`(function(){ ... })()` のように定義と同時に実行される関数のこと。難読化器はこの形で「配列を回す処理」などを埋め込むため、webcrack はこの形をシグネチャ（特徴的な形）として検出する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: javascript-obfuscator（難読化器本体） — https://github.com/javascript-obfuscator/javascript-obfuscator
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 担当 URL 外のため本ノートでは扱っていない）。以下の記述は webcrack 側のソースに書かれた対応テンプレートへの参照にもとづく要約である。
> **読みどころ**:
> 1. 各オプション（String Array Encoding, Control Flow Flattening Threshold, Dead Code Injection Threshold など）の意味と既定値
> 2. `src/custom-code-helpers/` 配下のテンプレート（webcrack がマッチさせている元コードそのもの）
> 3. `SelfDefendingTemplate.ts` / `DomainLockTemplate.ts` / `DebugProtectionFunctionTemplate.ts` / `SingleCallControllerTemplate.ts`
> 4. オプションの組み合わせによる出力の違い
> **代替手段**: オンライン版 https://obfuscator.io で自分でサンプルを難読化し、webcrack に食わせて before/after を比べる

## 4. 難読化解除のパイプライン全体像

### 4.1 なぜ「入口が String Array」なのか

obfuscator.io の難読化は、まず全ての文字列を 1 つの配列（String Array、文字列配列）に集め、コード中の文字列を「配列の何番目か」を返すデコード関数の呼び出しに置き換える、というのが基本構造である。だから webcrack は「String Array が見つかるかどうか」を難読化解除の入口にしている。見つからなければ obfuscator.io ではないと判断して処理をやめる。

### 4.2 パイプラインの実行順序（一次ソース）

`deobfuscate` トランスフォームは `name: 'deobfuscate'`, `tags: ['unsafe']`, `scope: true` で定義され、`sandbox`（隔離実行の関数）が渡されないと**何もしない**。実装の逐語コードは次のとおり。

```ts
export default {
  name: 'deobfuscate',
  tags: ['unsafe'],
  scope: true,
  async run(ast, state, sandbox) {
    if (!sandbox) return;

    const logger = debug('webcrack:deobfuscate');
    const stringArray = findStringArray(ast);
    logger(
      stringArray
        ? `String Array: ${stringArray.originalName}, length ${stringArray.length}`
        : 'String Array: no',
    );
    if (!stringArray) return;

    const rotator = findArrayRotator(stringArray);
    logger(`String Array Rotate: ${rotator ? 'yes' : 'no'}`);

    const decoders = findDecoders(stringArray);
    logger(
      `String Array Decoders: ${decoders
        .map((d) => d.originalName)
        .join(', ')}`,
    );

    state.changes += applyTransform(ast, inlineObjectProps).changes;

    for (const decoder of decoders) {
      state.changes += applyTransform(
        ast,
        inlineDecoderWrappers,
        decoder,
      ).changes;
    }

    const vm = new VMDecoder(sandbox, stringArray, decoders, rotator);
    state.changes += (
      await applyTransformAsync(ast, inlineDecodedStrings, { vm })
    ).changes;

    if (decoders.length > 0) {
      stringArray.path.remove();
      rotator?.remove();
      decoders.forEach((decoder) => decoder.path.remove());
      state.changes += 2 + decoders.length;
    }

    state.changes += applyTransforms(
      ast,
      [mergeStrings, deadCode, controlFlowObject, controlFlowSwitch],
      { noScope: true },
    ).changes;
  },
} satisfies AsyncTransform<Sandbox>;
```

処理の流れを日本語で追うと次のようになる。

1. **String Array を見つける** — 見つからなければ obfuscator.io ではないと判断し、難読化解除を中断する。
2. **Rotator（配列回転 IIFE）を探す**。配列は正しい並びになるよう「回転」されているため、その回転処理を特定する。
3. **Decoder 関数群を探す**（複数あり得る）。
4. `inline-object-props` で「Calls Transform」により作られた引数オブジェクトを展開する。
5. デコーダごとに `inline-decoder-wrappers` を適用し、`var alias = decode;` のようなラッパ/エイリアスをすべて本体に置き換える。
6. `VMDecoder` を構築し、`inline-decoded-strings` で **デコード呼び出しを実際に評価した結果の文字列リテラルへ置換**する。
7. デコーダが 1 つ以上見つかった場合、String Array 本体・Rotator・各 Decoder の宣言を AST から**削除**する。
8. 最後に `mergeStrings`（分割文字列の再結合）→ `deadCode`（デッドコード除去）→ `controlFlowObject`（制御フロー用オブジェクトの展開）→ `controlFlowSwitch`（switch ディスパッチャの平坦化解除）を `noScope: true` で一括適用する。

デバッグログは `debug` パッケージの名前空間 `webcrack:deobfuscate` に出る。ソース冒頭には AST を観察するための AST Explorer の参考リンクがコメントされている。

```
// https://astexplorer.net/#/gist/b1018df4a8daebfcb1daf9d61fe17557/4ff9ad0e9c40b9616956f17f59a2d9888cd62a4f
```

なお `self-defending` / `debug-protection` / `merge-object-assignments` / `evaluate-globals` は、この `deobfuscate` 内ではなく **unminify の後** に実行される。ソース中のコメントにその理由がある。

```ts
// Have to run this after unminify to properly detect it
```

## 5. String Array の検出

### 5.1 何を探すのか

`StringArray` インターフェース（逐語）は、検出した文字列配列の情報を次の形で保持する。

```ts
export interface StringArray {
  path: NodePath<t.FunctionDeclaration | t.VariableDeclaration>;
  references: NodePath[];
  name: string;
  originalName: string;
  length: number;
}
```

### 5.2 マッチする構造

obfuscator.io は文字列配列を「配列を返す関数」の形で埋め込む。webcrack のマッチャは 2 つの典型形を許容する（逐語、要点部分）。

```ts
  // getStringArray = function () { return array; };
  const functionAssignment = m.assignmentExpression(
    '=',
    m.identifier(m.fromCapture(functionName)),
    m.functionExpression(
      undefined,
      [],
      m.blockStatement([m.returnStatement(m.fromCapture(arrayIdentifier))]),
    ),
  );
  const variableDeclaration = m.variableDeclaration(undefined, [
    m.variableDeclarator(arrayIdentifier, arrayExpression),
  ]);
  // `function getStringArray() { ... }` or `var getStringArray = function() { ... }`
  const matcher = varFunctionOrDeclaration(
    m.identifier(functionName),
    [],
    m.or(
      // var array = ["hello", "world"];
      // return (getStringArray = function () { return array; })();
      m.blockStatement([
        variableDeclaration,
        m.returnStatement(m.callExpression(functionAssignment)),
      ]),
      // var array = ["hello", "world"];
      // getStringArray = function () { return array; });
      // return getStringArray();
      m.blockStatement([
        variableDeclaration,
        m.expressionStatement(functionAssignment),
        m.returnStatement(m.callExpression(m.identifier(functionName))),
      ]),
    ),
  );
```

検出できた String Array 関数は次のようにリネームされる。

```ts
renameFast(binding, '__STRING_ARRAY__');
```

これは、ログや中間出力で「これが文字列配列だ」と識別しやすくするためである。配列要素は `m.arrayOf(m.or(m.stringLiteral(), undefinedMatcher))` で「文字列リテラルまたは `undefined` のみ」を許容する。

## 6. Array Rotator（配列回転）の検出

### 6.1 回転とは

Rotate は「配列を正しい並びになるまで `push(shift())` で回し続け、`parseInt` を使ったチェックサム的な条件が満たされたら `break` する IIFE」という形をとる。`shift()` は配列の先頭を取り出し、`push()` は末尾に追加するので、この 2 つを組み合わせると配列が 1 つずつ回転する。ソースの JSDoc（原文のまま逐語）にその構造が書かれている。

```
/**
 * Structure:
 * ```
 * iife (>= 2 parameters, called with 0 or 2 arguments)
 *  2 variable declarations (array and decoder)
 *  endless loop:
 *   try:
 *    if/break/parseInt/array.push(array.shift())
 *   catch:
 *    array.push(array.shift())
 * ```
 */
```

### 6.2 実装の核

マッチャの核（逐語）は次のとおり。

```ts
  // e.g. array.push(array.shift())
  const pushShift = m.callExpression(
    constMemberExpression(arrayIdentifier, 'push'),
    [
      m.callExpression(
        constMemberExpression(m.fromCapture(arrayIdentifier), 'shift'),
      ),
    ],
  );

  const callMatcher = iife(
    m.anything(),
    m.blockStatement(
      m.anyList(
        m.zeroOrMore(),
        infiniteLoop(
          m.matcher((node) => {
            return (
              m
                .containerOf(callExpression(m.identifier('parseInt')))
                .match(node) &&
              m
                .blockStatement([
                  m.tryStatement(
                    m.containerOf(pushShift),
                    m.containerOf(pushShift),
                  ),
                ])
                .match(node)
            );
          }),
        ),
      ),
    ),
  );

  const matcher = m.expressionStatement(
    m.or(callMatcher, m.unaryExpression('!', callMatcher)),
  );
```

webcrack はこの回転 IIFE を **丸ごと 1 つのシグネチャとして検出**し、後段で実際に実行して配列の最終状態（正しい並び）を得る。先頭に `!` が付く形（`!function(){...}()`）も許容している。

## 7. Decoder（デコード関数）の検出

### 7.1 デコーダの役割

Decoder（デコード関数）とは、1 個以上の数値/文字列の引数で呼ばれ、文字列配列から文字列を返す関数のこと。Base64 や RC4 でデコードする場合もある。クラスの JSDoc（原文のまま逐語）はこう説明する。

```
/**
 * A function that is called with >= 1 numeric/string arguments
 * and returns a string from the string array. It may also decode
 * the string with Base64 or RC4.
 */
```

### 7.2 静的に値が決まる呼び出しだけを集める

webcrack は「引数が静的に値の決まる呼び出し」だけを評価対象として集める。引数として許すのは、数値/文字列リテラル、それらの二項演算、単項マイナスである（逐語、抜粋）。

```ts
    const literalArgument: m.Matcher<t.Expression> = m.or(
      m.binaryExpression(
        m.anything(),
        m.matcher((node) => literalArgument.match(node)),
        m.matcher((node) => literalArgument.match(node)),
      ),
      m.unaryExpression(
        '-',
        m.matcher((node) => literalArgument.match(node)),
      ),
      m.numericLiteral(),
      m.stringLiteral(),
    );
```

三項演算子を含む呼び出しは、あらかじめ枝ごとの呼び出しに分配してから評価する（逐語）。

```ts
    const buildExtractedConditional = expression`TEST ? CALLEE(CONSEQUENT) : CALLEE(ALTERNATE)`;
```

```ts
        // decode(test ? 1 : 2) -> test ? decode(1) : decode(2)
```

つまり `decode(cond ? a : b)` を `cond ? decode(a) : decode(b)` に書き換えてから、それぞれ個別に評価する。こうしないと「条件によって異なる文字列」を静的に確定できないためである。

## 8. サンドボックスによる実評価（設計の要）

### 8.1 なぜ「実行して」デコードするのか

obfuscator.io のデコード関数は、RC4 復号や複雑なインデックス計算を含み、静的解析だけでは結果を再現しにくい。そこで webcrack は **デコード関数を実際に実行して、その返り値の文字列を得る** という方針を採る。ただし対象コードは信頼できない入力なので、ホスト環境から隔離した「サンドボックス」で実行する。サンドボックスとは、外部から遮断された安全な実行領域のこと。

`Sandbox` 型（逐語）はシンプルで、コードを受け取って結果を返す非同期関数である。

```ts
export type Sandbox = (code: string) => Promise<unknown>;
```

### 8.2 Node 用サンドボックス（isolated-vm）

Node では `isolated-vm` を使い、タイムアウト 10 秒の隔離 Isolate で実行する（逐語）。

```ts
export function createNodeSandbox(): Sandbox {
  return async (code: string) => {
    const { Isolate } = await importIsolatedVM();
    const isolate = new Isolate();
    const context = await isolate.createContext();
    const result = (await context.eval(code, {
      timeout: 10_000,
      copy: true,
      filename: 'file:///obfuscated.js',
    })) as unknown;
    context.release();
    isolate.dispose();
    return result;
  };
}
```

`Isolate` は V8 の独立したインスタンスで、ホストのグローバル変数（`process` や `require` など）に到達できない。`timeout: 10_000` は 10 秒で強制中断、`copy: true` は結果を値コピーで受け取る指定である。

ブラウザ用は、呼び出し側が独自の sandbox 関数を渡す前提になっている（逐語）。

```ts
export function createBrowserSandbox(): Sandbox {
  return () => {
    // TODO: use sandybox (not available in web workers though)
    throw new Error('Custom Sandbox implementation required.');
  };
}
```

### 8.2.1 ブラウザ側（プレイグラウンド）の隔離構成

ブラウザには `isolated-vm` が無いので、公式プレイグラウンドは別の方法で「信頼できないコードを安全に実行する」を実現している。ドキュメント（Website ページ）は「より安全な実装」として次のコードを逐語で示している。

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

原文の説明（逐語）はこうである。

```
This is how the webcrack playground currently implements it in a more secure way, with sandybox, a Content-Security-Policy to prevent network access and a timeout:
```

防御設計として重要な 3 点は次のとおり。これは「信頼できないコードをブラウザで動かすときの型」としてそのまま参考になる。

1. **sandybox で iframe 内に隔離する。** sandybox とは、`iframe` を使って関数を隔離実行するための小さなライブラリのこと。`Sandybox.create()` でサンドボックスを作り、`addFunction` / `removeFunction` で関数を出し入れする。
2. **CSP `default-src 'none'` でネットワークアクセスを遮断する。** iframe の `<head>` に `<meta http-equiv="Content-Security-Policy" content="default-src 'none';">` を注入し、隔離コードが外部と通信できないようにする。難読化コードが実行時に外部へデータを送る（＝情報漏えい）ことを防ぐ。
3. **`Promise.race` による 10 秒タイムアウト。** 実行が 10 秒を超えたら `Sandbox timeout` で打ち切る。無限ループを仕込まれてもブラウザが固まらない。加えて実行後は `finally` で `sandbox.removeFunction(fn)` を必ず呼び、後片付けする。

つまり Node 側（`isolated-vm` + 10 秒タイムアウト）とブラウザ側（sandybox + CSP `default-src 'none'` + 10 秒タイムアウト）で、隔離の実現手段は違っても「ホストから遮断・通信禁止・時間制限」という設計思想は共通している。

> ### 📌 ここは自分で開いて読んでください
> **資料**: sandybox（ブラウザ用サンドボックス） — https://github.com/trentmwillis/sandybox
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 担当 URL 外だが、プレイグラウンドの隔離実行の土台であり、iframe ベースの隔離の限界を知るには一次資料が要る）。
> **読みどころ**:
> 1. `Sandybox.create()` と `addFunction` / `removeFunction` の API
> 2. iframe ベースの隔離モデルの限界（どこまで守れて、どこは守れないか）
> 3. CSP との併用方法
> **代替手段**: なし（公式 README が一次情報）

Node のメジャーバージョンで `isolated-vm` を切り替える処理（逐語）。

```ts
async function importIsolatedVM(): Promise<typeof IsolatedVM> {
  const major = Number(globalThis.process.versions.node.split('.')[0]);
  const { default: ivm } = (await (major >= 26
    ? import('isolated-vm-7')
    : import('isolated-vm-6'))) as { default: typeof IsolatedVM };
  return ivm;
}
```

### 8.3 Self Defending を回避する重要テクニック

デコーダを VM に流し込むとき、webcrack は **あえて compact（1 行・コメントなし）で再生成** する。コメント（逐語）にその理由が書かれている。

```ts
    // Generate as compact to bypass the self defense
    // (which tests someFunction.toString against a regex)
    const generateOptions = {
      compact: true,
      shouldPrintComment: () => false,
    };
```

obfuscator.io の Self Defending は「自分自身の関数の `toString()` を正規表現で検査し、整形されていたら壊れる（無限ループ等）」という仕組みである。だから webcrack はデコーダを整形せず compact のまま再生成することで、この自己防衛チェックを通過させる。実行対象は「String Array 本体 + 各 Decoder + Rotator」のコードを連結したセットアップコードである。

> 〔補足〕診断目的でこの種のツールを使うとき、対象コードは**信頼できない入力**として扱う必要がある。webcrack が `isolated-vm` を使うのも、`eval` や `vm` モジュールのようにホストのグローバルへ到達しうる実行環境を避けるためである。API ドキュメント側にも、`sandbox: eval` に対して「Simplest possible implementation. Don't run this with untrusted or malicious code.」という CAUTION が明記されている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: isolated-vm — サンドボックス実行基盤 — https://github.com/laverdet/isolated-vm
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 担当 URL 外だが webcrack の隔離実行の土台であり、原理を理解するには一次資料が要る）。
> **読みどころ**:
> 1. `Isolate` / `Context` / `eval(code, {timeout, copy, filename})` の意味
> 2. Node の偶数系バージョンのみ推奨という制約の理由（V8 ABI 互換）
> 3. `--no-node-snapshot` が必要になる条件
> 4. メモリ制限の設定方法
> **代替手段**: なし（公式 README が一次情報）

## 9. 制御フロー平坦化（Control Flow Flattening）の解除

### 9.1 そもそも平坦化とは

Control Flow Flattening（制御フロー平坦化）とは、素直な処理の流れをわざと分断し、「どの順で実行するか」を別のデータ（配列や switch のラベル）で間接的に指定する難読化のこと。処理の流れが追えなくなるので解析が難しくなる。webcrack はこれを 2 方式（オブジェクト方式と switch ディスパッチャ方式）で解除する。

### 9.2 オブジェクト方式（control-flow-object.ts）

トランスフォーム定義: `name: 'control-flow-object'`, `tags: ['safe']`, `scope: true`。ソース冒頭に説明図へのリンクがコメントされている（逐語）。

```ts
/**
 * Explanation: https://excalidraw.com/#json=0vehUdrfSS635CNPEQBXl,hDOd-UO9ETfSDWT9MxVX-A
 */
```

マッチ対象（逐語、コメントが仕様を示す）は次のとおり。

```ts
    const varId = m.capture(m.identifier());
    const propertyName = m.matcher<string>((name) => /^[a-z]{5}$/i.test(name));
    const propertyKey = constKey(propertyName);
    const propertyValue = m.or(
      // E.g. "6|0|4|3|1|5|2"
      m.stringLiteral(),
      // E.g. function (a, b) { return a + b }
      createFunctionMatcher(2, (left, right) => [
        m.returnStatement(
          m.or(
            m.binaryExpression(undefined, left, right),
            m.logicalExpression(undefined, left, right),
            m.binaryExpression(undefined, right, left),
            m.logicalExpression(undefined, right, left),
          ),
        ),
      ]),
      // E.g. function (a, b, c) { return a(b, c) } with an arbitrary number of arguments
      m.matcher<FunctionExpression>((node) => {
        return (
          t.isFunctionExpression(node) &&
          createFunctionMatcher(node.params.length, (...params) => [
            m.returnStatement(m.callExpression(params[0], params.slice(1))),
          ]).match(node)
        );
      }),
      // E.g. function (a, ...b) { return a(...b) }
      (() => {
        const fnName = m.capture(m.identifier());
        const restName = m.capture(m.identifier());

        return m.functionExpression(
          undefined,
          [fnName, m.restElement(restName)],
          m.blockStatement([
            m.returnStatement(
              m.callExpression(m.fromCapture(fnName), [
                m.spreadElement(m.fromCapture(restName)),
              ]),
            ),
          ]),
        );
      })(),
    );
    // E.g. "rLxJs": "6|0|4|3|1|5|2"
    const objectProperties = m.capture(
      m.arrayOf(m.objectProperty(propertyKey, propertyValue)),
    );
```

日本語の要点は次のとおり。

- **キー名は「英字 5 文字ちょうど」** という正規表現 `/^[a-z]{5}$/i` で識別する（obfuscator.io が生成するキーの特徴）。これは「プロキシ関数（proxy function、中継するだけの関数）」を格納するオブジェクトを見分けるための強いシグネチャである。
- 値として許すのは 4 種類。①`"6|0|4|3|1|5|2"` のような**制御フロー順序を表す文字列**、②`function (a, b) { return a + b }` のような**二項/論理演算をラップするだけの関数**、③`function (a, b, c) { return a(b, c) }` のような**呼び出しを中継するだけの関数（任意引数数）**、④`function (a, ...b) { return a(...b) }` のような**rest/spread 中継関数**。
- さらに `const alias = obj;` のようなエイリアス変数（`aliasVar`）も追跡し、エイリアス経由のアクセスも解決する。
- 検出後は `inlineFunctionCall` によって呼び出し箇所に**元の演算/呼び出しを直接書き戻し**、オブジェクトを丸ごと削除する。これが「プロキシ関数の除去」に相当する。
- 安全のため `isReadonlyObject` を使い、オブジェクトが後から書き換えられていないことを確認する。
- 展開後に `mergeStrings` を適用して分割文字列を結合する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Control Flow Object 変換の図解（Excalidraw） — https://excalidraw.com/#json=0vehUdrfSS635CNPEQBXl,hDOd-UO9ETfSDWT9MxVX-A
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: Excalidraw の JS 必須のインタラクティブ図であり、静的テキスト取得ができない）。リンクは `control-flow-object.ts` の JSDoc に記載された一次情報である。以下の記述はソースコメントと実装にもとづく要約である。
> **読みどころ**:
> 1. 制御フロー用オブジェクトの生成と参照の関係
> 2. エイリアス変数を経由した間接参照がどう解決されるか
> 3. プロキシ関数（`function(a,b){return a+b}`）がどこにインライン展開されるか
> 4. `"6|0|4|3|1|5|2"` のような順序文字列の役割
> **代替手段**: なし（同等の無料図解は見当たらない。ソース `control-flow-object.ts` を併読するとよい）

### 9.3 switch ディスパッチャ方式（control-flow-switch.ts）

定義: `name: 'control-flow-switch'`, `tags: ['safe']`。この変換の仕組みが最も分かりやすい教材になるので、全文を逐語で示す。

```ts
export default {
  name: 'control-flow-switch',
  tags: ['safe'],
  visitor() {
    const sequenceName = m.capture(m.identifier());
    const sequenceString = m.capture(
      m.matcher<string>((s) => /^\d+(\|\d+)*$/.test(s)),
    );
    const iterator = m.capture(m.identifier());

    const cases = m.capture(
      m.arrayOf(
        m.switchCase(m.stringLiteral(m.matcher((s) => /^\d+$/.test(s)))),
      ),
    );

    const matcher = m.blockStatement(
      m.anyList<t.Statement>(
        // E.g. const sequence = "2|4|3|0|1".split("|")
        m.variableDeclaration(undefined, [
          m.variableDeclarator(
            sequenceName,
            m.callExpression(
              constMemberExpression(m.stringLiteral(sequenceString), 'split'),
              [m.stringLiteral('|')],
            ),
          ),
        ]),
        // E.g. let iterator = 0 or -0x1a70 + 0x93d + 0x275 * 0x7
        m.variableDeclaration(undefined, [m.variableDeclarator(iterator)]),
        infiniteLoop(
          m.blockStatement([
            m.switchStatement(
              // E.g. switch (sequence[iterator++]) {
              m.memberExpression(
                m.fromCapture(sequenceName),
                m.updateExpression('++', m.fromCapture(iterator)),
                true,
              ),
              cases,
            ),
            m.breakStatement(),
          ]),
        ),
        m.zeroOrMore(),
      ),
    );

    return {
      BlockStatement: {
        exit(path) {
          if (!matcher.match(path.node)) return;

          const caseStatements = new Map(
            cases.current!.map((c) => [
              (c.test as t.StringLiteral).value,
              t.isContinueStatement(c.consequent.at(-1))
                ? c.consequent.slice(0, -1)
                : c.consequent,
            ]),
          );

          const sequence = sequenceString.current!.split('|');
          const newStatements = sequence.flatMap((s) => caseStatements.get(s)!);

          path.node.body.splice(0, 3, ...newStatements);
          this.changes += newStatements.length + 3;
        },
      },
    };
  },
} satisfies Transform;
```

仕組みを日本語で説明する。

1. 難読化後の典型形は「`const sequence = "2|4|3|0|1".split("|")` → `let iterator = 0` → `while (true) { switch (sequence[iterator++]) { case "0": …; continue; … } break; }`」の 3 文構成である。
2. webcrack は `sequence` 文字列（正規表現 `/^\d+(\|\d+)*$/`）と `case` ラベル（`/^\d+$/` の文字列リテラル）を捕捉する。
3. 各 `case` の本体から末尾の `continue` を取り除いてマップ化する。
4. `sequence` の順序どおりに case 本体を**フラットに並べ直し**、元の 3 文（`splice(0, 3, ...)`）を置き換える。
5. これで「実行順序が配列で間接指定されていたコード」が**元の直線的な順序**に戻る。

## 10. Dead Code Injection（デッドコード注入）の解除

### 10.1 何を注入するのか

Dead Code Injection とは、`if ("abc" === "abc") { 本物 } else { 偽物 }` のように**文字列リテラル同士の比較**をゲートにした分岐を挿入し、解析者を惑わせる難読化のこと。条件は常に真か常に偽なので、実行時には片方の枝しか動かない（＝もう片方はデッドコード＝死んだコード）。

### 10.2 実装

定義: `name: 'dead-code'`, `tags: ['unsafe']`, `scope: true`。全文（逐語）。

```ts
export default {
  name: 'dead-code',
  tags: ['unsafe'],
  scope: true,
  visitor() {
    const stringComparison = m.binaryExpression(
      m.or('===', '==', '!==', '!='),
      m.stringLiteral(),
      m.stringLiteral(),
    );
    const testMatcher = m.or(
      stringComparison,
      m.unaryExpression('!', stringComparison),
    );

    return {
      'IfStatement|ConditionalExpression': {
        exit(_path) {
          const path = _path as NodePath<
            t.IfStatement | t.ConditionalExpression
          >;

          if (!testMatcher.match(path.node.test)) return;

          if (path.get('test').evaluateTruthy()) {
            replace(path, path.get('consequent'));
          } else if (path.node.alternate) {
            replace(path, path.get('alternate') as NodePath);
          } else {
            path.remove();
          }

          this.changes++;
        },
      },
    };
  },
} satisfies Transform;
```

スコープ衝突を避ける置換関数（逐語）。

```ts
function replace(path: NodePath<t.Conditional>, replacement: NodePath) {
  if (t.isBlockStatement(replacement.node)) {
    // If statements can contain variables that shadow variables in the parent scope.
    // Since the block scope is merged with the parent scope, we need to rename those
    // variables to avoid duplicate declarations.
    const childBindings = replacement.scope.bindings;
    for (const name in childBindings) {
      const binding = childBindings[name];
      if (path.scope.hasOwnBinding(name)) {
        renameFast(binding, path.scope.generateUid(name));
      }
      binding.scope = path.scope;
      path.scope.bindings[binding.identifier.name] = binding;
    }
    path.replaceWithMultiple(replacement.node.body);
  } else {
    path.replaceWith(replacement);
  }
}
```

日本語の要点。webcrack は「文字列リテラル同士の比較（`===`, `==`, `!==`, `!=` と `!` 付き）」だけを対象に `evaluateTruthy()` で真偽を静的評価し、生き残る枝だけを残す。ブロックを親スコープにマージするとき、**同名変数のシャドーイング（内側の変数が外側の同名変数を隠すこと）による重複宣言を避けるため `generateUid` でリネーム**する。これが設計柱の Safety（スコープを考慮）の具体例である。なおこの変換は `unsafe` タグ（意味を変えうる可能性がある）に分類されている。

## 11. Self Defending / Domain Lock / Console Output / Debug Protection

### 11.1 共通テンプレートを 1 発で除去する（self-defending.ts）

定義: `name: 'self-defending'`, `tags: ['safe']`, `scope: true`。ソース先頭のコメントは、どの obfuscator.io テンプレートに対応するかの一次情報である（逐語）。

```ts
// SingleCallController: https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/common/templates/SingleCallControllerTemplate.ts

// Works for
// self defending: https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/self-defending/templates/SelfDefendingTemplate.ts
// domain lock: https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/domain-lock/templates/DomainLockTemplate.ts
// console output: https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/console-output/templates/ConsoleOutputDisableTemplate.ts
// debug protection function call: https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/debug-protection/templates/debug-protection-function-call/DebugProtectionFunctionCallTemplate.ts
```

マッチする構造（コメントが構造を示す、逐語、抜粋）。

```ts
    // const callControllerFunctionName = (function() { ... })();
    const matcher = m.variableDeclarator(
      m.identifier(callController),
      iife(
        [],
        m.blockStatement([
          // let firstCall = true;
          m.variableDeclaration(undefined, [
            m.variableDeclarator(firstCall, trueMatcher),
          ]),
          // return function (context, fn) {
          m.returnStatement(
            m.functionExpression(
              null,
              [context, fn],
              m.blockStatement([
                m.variableDeclaration(undefined, [
                  // const rfn = firstCall ? function() {
                  m.variableDeclarator(
                    rfn,
                    m.conditionalExpression(
                      m.fromCapture(firstCall),
                      m.functionExpression(
                        null,
                        [],
                        m.blockStatement([
                          // if (fn) {
                          m.ifStatement(
                            m.fromCapture(fn),
                            m.blockStatement([
                              // const res = fn.apply(context, arguments);
                              ...
                              // fn = null;
```

日本語の要点。obfuscator.io の **SingleCallController**（「一度しか実行されない呼び出し制御関数」）は、Self Defending・Domain Lock・Console Output 無効化・Debug Protection の呼び出し部で**共通に**使われるテンプレートである。webcrack はこの共通テンプレートを 1 つのマッチャで捕捉して丸ごと除去するので、4 つの防御機構をまとめて無力化できる。これが対応表で Domain Lock と Console Output が `self-defending.ts` の「兼務」になっていた理由である。

### 11.2 Debug Protection の解除（debug-protection.ts）

Debug Protection とは、「再帰的に自分を呼びながら `debugger` 文（または `(function(){}).constructor('debugger')()`）を踏ませ、開発者ツール（DevTools）を開くと固まる」防御のこと。さらに `setInterval(..., 4000)` で定期実行する版もある。

定義: `name: 'debug-protection'`, `tags: ['safe']`, `scope: true`。検出パターン（逐語）。

```ts
    const debuggerTemplate = m.ifStatement(
      undefined,
      undefined,
      m.containerOf(
        m.or(
          m.debuggerStatement(),
          m.callExpression(
            constMemberExpression(m.anyExpression(), 'constructor'),
            [m.stringLiteral('debugger')],
          ),
        ),
      ),
    );
    // that.setInterval(debugProtectionFunctionName, 4000);
    const intervalCall = m.callExpression(
      constMemberExpression(m.anyExpression(), 'setInterval'),
      [
        m.identifier(m.fromCapture(debugProtectionFunctionName)),
        m.numericLiteral(),
      ],
    );
```

再帰構造のマッチャ（逐語、抜粋）。

```ts
    // function debugProtectionFunctionName(ret) {
    const matcher = varFunctionOrDeclaration(
      m.identifier(debugProtectionFunctionName),
      [ret],
      m.blockStatement([
        // function debuggerProtection (counter) {
        varFunctionOrDeclaration(
          debuggerProtection,
          [counter],
          m.blockStatement([
            debuggerTemplate,
            // debuggerProtection(++counter);
            m.expressionStatement(
              m.callExpression(m.fromCapture(debuggerProtection), [
                m.updateExpression('++', m.fromCapture(counter), true),
              ]),
            ),
          ]),
        ),
        m.tryStatement(
          ...
```

webcrack は `debugger` 文と `constructor('debugger')` の**両方**をパターンに含め、`try/catch` を伴う再帰構造ごと除去する。

> 〔補足〕診断でこの種の anti-debug（反デバッグ）に遭遇した場合、webcrack で静的に除去する以外に、DevTools の "Never pause here"（ブレークポイント無効化）や、`Function.prototype.constructor` の差し替えといった動的な回避も使われる。ただし本節の主題は静的解除である。

## 12. Calls Transform とラッパのインライン化

### 12.1 引数オブジェクトの展開（inline-object-props.ts）

Calls Transform オプションは、デコード呼び出しの引数を一度オブジェクトに詰め替えて分かりにくくする。JSDoc（原文のまま逐語）が例を示す。

```ts
/**
 * Inline objects that only have string or numeric literal properties.
 * Used by the "String Array Calls Transform" option for moving the
 * decode call arguments into an object.
 * Example:
 * ```js
 * const obj = {
 *   c: 0x2f2,
 *   d: '0x396',
 * };
 * console.log(decode(obj.c, obj.d));
 * ```
 * ->
 * ```js
 * console.log(decode(0x2f2, '0x396'));
 * ```
 */
```

マッチャ（逐語、抜粋）。

```ts
    const propertyName = m.capture(
      m.matcher<string>((name) => /^[\w]+$/i.test(name)),
    );
    const propertyKey = constKey(propertyName);
    // E.g. "_0x51b74a": 0x80
    const objectProperties = m.capture(
      m.arrayOf(
        m.objectProperty(
          propertyKey,
          m.or(m.stringLiteral(), m.numericLiteral()),
        ),
      ),
    );
    // E.g. obj._0x51b74a
    const memberAccess = constMemberExpression(
      m.fromCapture(varId),
      propertyName,
    );
    ...
    // E.g. { e: 0x80 }.e
    const literalMemberAccess = constMemberExpression(
      m.objectExpression(objectProperties),
      propertyName,
    );
```

ソース中の TODO コメント（逐語）: `// TODO: move do decoder.ts collectCalls to avoid traversing the whole AST`。

### 12.2 デコーダラッパのインライン化（inline-decoder-wrappers.ts）

Variable/Function Wrapper Type オプションは、デコーダを `var alias = decode;` のようなエイリアスで包んで呼び出しを分散させる。webcrack はこのラッパを全部本体に戻す。全文（逐語）。

```ts
/**
 * Replaces all references to `var alias = decode;` with `decode`
 */
export default {
  name: 'inline-decoder-wrappers',
  tags: ['unsafe'],
  scope: true,
  run(ast, state, decoder) {
    if (!decoder) return;
    const decoderBinding = decoder.path.parentPath.scope.getBinding(
      decoder.name,
    );
    if (decoderBinding) {
      state.changes += inlineVariableAliases(decoderBinding).changes;
      state.changes += inlineFunctionAliases(decoderBinding).changes; // FIXME: may be var = function(){}
    }
  },
} satisfies Transform<Decoder>;
```

### 12.3 オブジェクト代入のマージ（merge-object-assignments.ts）

JSDoc（原文のまま逐語）。

```ts
/**
 * Merges object assignments into the object expression.
 * Example:
 * ```js
 * const obj = {};
 * obj.foo = 'bar';
 * ```
 * ->
 * ```js
 * const obj = { foo: 'bar' };
 * ```
 */
```

実装中の重要コメント（逐語）。

```ts
            // { [1]: value, "foo bar": value } can be simplified to { 1: value, "foo bar": value }
```

```ts
            // Example: const obj = { x: 1 }; obj.foo = 'bar'; -> const obj = { x: 1, foo: 'bar' };
```

```ts
            // Example: const obj = { foo: 'bar' }; return obj; -> return { foo: 'bar' };
```

このとき `hasCircularReference(value.current!, binding)` で循環参照をチェックし、`obj.self = obj` のようなケースを避ける。

## 13. Unminify（縮小化の巻き戻し）

### 13.1 「整形」ではなく「構文の復元」

Unminify（アンミニファイ）とは、縮小化されたコードを人間可読な構文へ戻すこと。ドキュメント冒頭（原文のまま逐語）がその立ち位置を説明する。

```
Bundlers and obfuscators commonly minify code (remove new lines and whitespace, replace variable names with shorter ones, use a shorter syntax).

Most unminify sites just format the code, but webcrack also converts the syntax back to make it more readable and similar to the original code:
```

つまり、よくある unminify サイトは「整形（インデントを付けるだけ）」しかしないが、webcrack は**構文そのものを元の読みやすい形に戻す**。`unminify` は `mergeTransforms` で全変換を 1 つの visitor に統合して実行する（`name: 'unminify'`, `tags: ['safe']`）。visitor（ビジター）とは、AST を歩きながら各ノードで処理を行う仕組みのこと。

### 13.2 unminify 変換の完全一覧

`packages/webcrack/src/unminify/transforms/index.ts` の全 export（逐語）。

```ts
export { default as blockStatements } from './block-statements';
export { default as computedProperties } from './computed-properties';
export { default as forToWhile } from './for-to-while';
export { default as infinity } from './infinity';
export { default as invertBooleanLogic } from './invert-boolean-logic';
export { default as jsonParse } from './json-parse';
export { default as logicalToIf } from './logical-to-if';
export { default as mergeElseIf } from './merge-else-if';
export { default as mergeStrings } from './merge-strings';
export { default as numberExpressions } from './number-expressions';
export { default as rawLiterals } from './raw-literals';
export { default as removeDoubleNot } from './remove-double-not';
export { default as sequence } from './sequence';
export { default as splitForLoopVars } from './split-for-loop-vars';
export { default as splitVariableDeclarations } from './split-variable-declarations';
export { default as stringLiteralInTemplate } from './string-literal-in-template';
export { default as ternaryToIf } from './ternary-to-if';
export { default as truncateNumberLiteral } from './truncate-number-literal';
export { default as typeofUndefined } from './typeof-undefined';
export { default as unaryExpressions } from './unary-expressions';
export { default as unminifyBooleans } from './unminify-booleans';
export { default as voidToUndefined } from './void-to-undefined';
export { default as yoda } from './yoda';
```

このうち `string-literal-in-template`, `truncate-number-literal`, `unary-expressions` の 3 つはドキュメントページには未記載だが実装に存在する。

### 13.3 各変換の before → after（逐語で再現）

以下はすべて「上＝変換前、下＝変換後」。原文では VitePress の `// [!code --]`（削除）/ `// [!code ++]`（追加）マーカーで差分表示されている。

**block-statement**（`if` の 1 行を波括弧つきに）
```js
if (a) b(); // [!code --]
if (a) { // [!code ++]
  b();  // [!code ++]
} // [!code ++]
```

**computed-properties**（`obj["log"]` を `obj.log` に）
```js
console["log"](a); // [!code --]
console.log(a); // [!code ++]
```

**for-to-while**（無限/条件 for を while に）
```js
for (;;) a(); // [!code --]
while (true) a(); // [!code ++]
```
```js
for (; a < b;) c(); // [!code --]
while (a < b) c(); // [!code ++]
```

**infinity**（`1/0` を `Infinity` に）
```js
1 / 0 // [!code --]
Infinity // [!code ++]
```

**invert-boolean-logic**（ド・モルガンの法則で否定を分配）
```js
!(a == b) // [!code --]
a != b // [!code ++]
```
```js
!(a || b || c) // [!code --]
!a && !b && !c // [!code ++]
```
```js
!(a && b && c) // [!code --]
!a || !b || !c // [!code ++]
```

**json-parse**（定数の `JSON.parse` を直接リテラルに）
```js
JSON.parse("[1,2,3]") // [!code --]
[1, 2, 3] // [!code ++]
```

**logical-to-if**（`&&`/`||` の短絡を `if` 文に）
```js
x && y && z(); // [!code --]
if (x && y) { // [!code ++]
  z(); // [!code ++]
} // [!code ++]
```
```js
x || y || z(); // [!code --]
if (!(x || y)) { // [!code ++]
  z(); // [!code ++]
} // [!code ++]
```

**merge-else-if**（`else { if }` を `else if` に）
```js
if (x) {
} else {  // [!code --]
  if (y) {}  // [!code --]
}  // [!code --]

if (x) {
} else if (y) {} // [!code ++]
```

**merge-strings**（分割文字列の再結合）
```js
"a" + "b" + "c" // [!code --]
"abc" // [!code ++]
```

**number-expressions**（定数畳み込み＝Numbers To Expressions の解除）
```js
-0x1021e + -0x7eac8 + 0x17 * 0xac9c // [!code --]
431390 // [!code ++]
```

**raw-literals**（Unicode Escape / 16 進リテラルの復元）
```js
'\x61"✏️\t' // [!code --]
"a\"✏️\t" // [!code ++]
```
```js
0x1 // [!code --]
1 // [!code ++]
```

**remove-double-not**（二重否定の除去）
```js
if (!!a) b(); // [!code --]
if (a) b(); // [!code ++]
```
```js
!!a ? b() : c(); // [!code --]
a ? b() : c(); // [!code ++]
```
```js
return !!!a; // [!code --]
return !a; // [!code ++]
```
```js
[].filter(a => !!a); // [!code --]
[].filter(a => a); // [!code ++]
```

**sequence**（カンマ演算子の分解、全 8 例）
```js
if (a) b(), c(); // [!code --]
if (a) { // [!code ++]
  b(); // [!code ++]
  c(); // [!code ++]
} // [!code ++]
```
```js
if (a(), b()) c(); // [!code --]
a(); // [!code ++]
if (b()) { // [!code ++]
  c(); // [!code ++]
} // [!code ++]
```
```js
return a(), b(), c(); // [!code --]
a(); // [!code ++]
b(); // [!code ++]
return c(); // [!code ++]
```
```js
for (let key in a = 1, object) {} // [!code --]
a = 1; // [!code ++]
for (let key in object) {} // [!code ++]
```
```js
for (let value of (a = 1, array)) {} // [!code --]
a = 1; // [!code ++]
for (let value of array) {} // [!code ++]
```
```js
for((a(), b());;) {} // [!code --]
a(); // [!code ++]
b(); // [!code ++]
for(;;) {} // [!code ++]
```
```js
for(; i < 10; a(), b(), i++) {} // [!code --]
for(; i < 10; i++) { // [!code ++]
  a(); // [!code ++]
  b(); // [!code ++]
} // [!code ++]
```
```js
a = (b = null, c); // [!code --]
b = null; // [!code ++]
a = c; // [!code ++]
```

**split-for-loops-vars**（ループに無関係な変数を外へ出す）。原文の解説（逐語）。
```
Minifiers commonly inline variables into for loops. Example: [esbuild](https://esbuild.github.io/try/#dAAwLjE5LjExAC0tbWluaWZ5AHZhciBqID0gMDsKZm9yICh2YXIgaSA9IDA7IGkgPCAzOyBpKyspIHt9)

To improve readability we only move the variables outside that are not used in the loop's test or update expressions.
```
```js
for (var j = 0, i = 0; i < 3; i++) {} // [!code --]
var j = 0; // [!code ++]
for (var i = 0; i < 3; i++) {} // [!code ++]
```

**split-variable-declarations**（1 行の複数宣言を分割）
```js
const a = 1, b = 2, c = 3; // [!code --]
const a = 1; // [!code ++]
const b = 2; // [!code ++]
const c = 3; // [!code ++]
```

**ternary-to-if**（三項演算子を `if/else` 文に）
```js
a ? b() : c(); // [!code --]
if (a) { // [!code ++]
  b(); // [!code ++]
} else { // [!code ++]
  c(); // [!code ++]
} // [!code ++]
```
```js
return a ? b() : c(); // [!code --]
if (a) { // [!code ++]
  return b(); // [!code ++]
} else { // [!code ++]
  return c(); // [!code ++]
} // [!code ++]
```

**typeof-undefined**（縮小された `typeof` 比較の復元）
```js
typeof a > "u" // [!code --]
typeof a === "undefined" // [!code ++]
```
```js
typeof a < "u" // [!code --]
typeof a !== "undefined" // [!code ++]
```

**unminify-booleans**（`!0`/`!1` を `true`/`false` に）
```js
!0 // [!code --]
true // [!code ++]
```
```js
!1 // [!code --]
false // [!code ++]
```

**void-to-undefined**（`void 0` を `undefined` に）
```js
void 0 // [!code --]
undefined // [!code ++]
```

**yoda**（ヨーダ記法を通常の比較順に。参考リンクは原文のまま）
```
<https://eslint.org/docs/latest/rules/yoda> and <https://babeljs.io/docs/en/babel-plugin-minify-flip-comparisons>
```
```js
"red" === color // [!code --]
color === "red" // [!code ++]
```

これらの変換はいずれも `safe` タグに属し、コードの意味を変えずに読みやすさだけを回復する。難読化が施されていないただの minify 済みコードでも、webcrack を通すだけでこの一覧の変換が一括で効く。

## 手を動かす

以下は、自分で立てた検証環境（自分のマシン、または自分が難読化したサンプル）を前提とする。他者のサイトのコードを許可なく持ち出して解析することは避け、バグバウンティでは対象プログラムの scope とルールに従うこと。

1. **Node のバージョンを確認する。** 偶数系（22 か 24）であることを確かめる。
   ```bash
   node -v
   ```
   奇数系だった場合は 22 か 24 に切り替える。

2. **webcrack をグローバルインストールする。**
   ```bash
   npm install -g webcrack@latest
   ```

3. **難読化サンプルを用意する。** obfuscator.io（https://obfuscator.io）で適当な JS を難読化し、`obf.js` として保存する。String Array・Control Flow Flattening・Dead Code Injection・Self Defending あたりを ON にすると効果が分かりやすい。

4. **復元してファイルに書き出す。**
   ```bash
   webcrack obf.js > clean.js
   ```
   `clean.js` を開き、`__STRING_ARRAY__` にリネームされた配列が消え、デコード呼び出しが実際の文字列リテラルに戻っていることを確認する。

5. **デバッグログで検出状況を見る。** どのステージで何が検出されたかを確認する。
   ```bash
   DEBUG='webcrack:deobfuscate' webcrack obf.js > clean.js
   ```
   `String Array: ...`, `String Array Rotate: yes/no`, `String Array Decoders: ...` といったログが `webcrack:deobfuscate` 名前空間で出る。

6. **Node API で組み込んで使う。** 復元後のコードとバンドル情報をプログラムから受け取る。
   ```js
   import fs from 'fs';
   import { webcrack } from 'webcrack';

   const input = fs.readFileSync('obf.js', 'utf8');
   const result = await webcrack(input);
   console.log(result.code);
   ```

7. **復元後のコードで source/sink を探す。** `clean.js` に対して `location`, `postMessage`, `innerHTML`, `eval`, `document.write` などを grep し、ユーザー入力が危険な出力先に届く経路を追う。
   ```bash
   grep -nE 'innerHTML|document\.write|eval\(|location\.(hash|search)|postMessage' clean.js
   ```

## つまずきポイント

- **Node が奇数系だと `isolated-vm` が動かない。** `engines` は 22/24/26 の偶数メジャーだけを許容する。奇数系では ABI 非互換でクラッシュしうる。
- **`sandbox` を渡さないと難読化解除は「何もしない」。** `deobfuscate` トランスフォームは `if (!sandbox) return;` で始まる。CLI は Node 用サンドボックスを自動で使うが、ブラウザ環境では呼び出し側が sandbox 関数を渡す必要がある。
- **String Array が見つからないと以降を中断する。** obfuscator.io 以外の難読化（別ツール製）は、この経路では解除されない。unminify だけは効く。
- **Self Defending は「整形すると壊れる」。** だから webcrack はデコーダを VM に流すとき compact のまま再生成する。手作業で整形してから実行しようとすると、自己防衛チェックに引っかかって無限ループ等になりうる。
- **`dead-code` は `unsafe` タグ。** 文字列比較を静的評価して枝を落とすため、稀にコードの意味を変える可能性がある。復元結果は「元と厳密に同じ」ではなく「読むための近似」だと理解しておく。
- **変数名は意味のある名前には戻らない。** 「Smarter variable renaming」は Planned Features であり、現状の webcrack は `_0x51b74a` のような名前をそのまま残すことが多い。

## この節のまとめ

- webcrack は JavaScript のリバースエンジニアリング用ツールで、難読化解除・unminify・transpile 解除・バンドル展開・JSX 復元の 5 機能を持つ。本節は前半 2 つを扱った。
- バグバウンティでは、読めない本番 JS を可読化して source/sink を探すための前処理ツールとして使う。
- 設計の 6 本柱は Performance / Safety / Auto-detection / Readability / TypeScript / Tests。中でも Auto-detection（設定不要の自動検出）と Safety（スコープ考慮）が中核。
- Node.js は偶数メジャー（22/24/26）が必須。依存する `isolated-vm` が奇数系を推奨しないため。
- 難読化解除の入口は String Array の検出で、見つからなければ全体を中断する。
- 文字列は静的解析ではなく、隔離サンドボックス（Node は `isolated-vm`、タイムアウト 10 秒）で**実際に評価**してデコードする。
- Self Defending は関数の `toString()` を正規表現で検査するので、webcrack はデコーダを compact のまま再生成して回避する。
- Control Flow Flattening はオブジェクト方式（キーが英字 5 文字ちょうど、というシグネチャ）と switch ディスパッチャ方式（`sequence` 文字列で順序を指定）の 2 系統を解除する。
- Dead Code Injection は「文字列リテラル同士の比較」をゲートにした分岐を静的評価で除去する。スコープ衝突を避けるため `generateUid` でリネームする。
- SingleCallController は Self Defending・Domain Lock・Console Output 無効化・Debug Protection で共通に使われるテンプレートで、1 つのマッチャでまとめて除去できる。
- Debug Protection は `debugger` 文と `constructor('debugger')` の両方を含む再帰構造を、`setInterval` 版も含めて除去する。
- Calls Transform（引数オブジェクト化）と Variable/Function Wrapper Type（デコーダのエイリアス化）は、それぞれ `inline-object-props` と `inline-decoder-wrappers` で本体に戻す。
- unminify は 20 種類以上の `safe` 変換で、`!0`→`true`、`void 0`→`undefined`、三項→`if/else`、カンマ演算子の分解など、構文レベルで可読化する。
- 各変換は `safe` / `unsafe` タグを持ち、`unsafe`（`deobfuscate`, `dead-code` など）は意味を変えうる。復元結果は「読むための近似」である。

## 理解度チェック

1. webcrack の難読化解除は「まず何を探し、それが無ければどうする」か。
   ▶ 答え: まず String Array（文字列配列）を探す。見つからなければ obfuscator.io ではないと判断して難読化解除全体を中断する（`if (!stringArray) return;`）。

2. webcrack が文字列をデコードするとき、なぜ静的解析ではなく「実際に評価」するのか。またその実行はどこで行うか。
   ▶ 答え: デコード関数は RC4 復号や複雑なインデックス計算を含み静的に再現しにくいため、実際に実行して返り値を得る。実行はホストから隔離したサンドボックス（Node では `isolated-vm`、タイムアウト 10 秒の Isolate）で行う。

3. Self Defending を回避するために webcrack がデコーダに対して行う処理は何か。
   ▶ 答え: デコーダを VM に流し込む前に、あえて compact（1 行・コメントなし）で再生成する。Self Defending が関数の `toString()` を正規表現で検査するため、整形されていない形にして検査を通過させる。

4. Control Flow Flattening のオブジェクト方式を検出する「強いシグネチャ」は何か。
   ▶ 答え: プロパティのキー名が「英字 5 文字ちょうど」（正規表現 `/^[a-z]{5}$/i`）であること。値は順序文字列や中継関数（プロキシ関数）に限られる。

5. Dead Code Injection の解除で `dead-code` が対象にする条件式の形は何か。また設計柱のどれと関係するか。
   ▶ 答え: 文字列リテラル同士の比較（`===`, `==`, `!==`, `!=` と `!` 付き）。ブロックを親スコープにマージする際、同名変数の重複宣言を `generateUid` でリネームして避ける点が Safety（スコープを考慮）と関係する。

6. SingleCallController テンプレートを 1 つ除去すると、まとめて無力化できる 4 つの防御機構は何か。
   ▶ 答え: Self Defending、Domain Lock、Console Output 無効化、Debug Protection（の呼び出し部）。

7. webcrack を動かすのに推奨される Node.js のメジャーバージョンと、その理由は何か。
   ▶ 答え: 偶数系（22 / 24、`engines` では 26 も）。依存する `isolated-vm` が、奇数系は V8 との ABI/API 互換をよく壊すとして推奨していないため。

8. unminify で `!0`、`void 0`、`typeof a > "u"` はそれぞれ何に戻るか。
   ▶ 答え: `!0`→`true`、`void 0`→`undefined`、`typeof a > "u"`→`typeof a === "undefined"`。

9. `safe` タグと `unsafe` タグの違いは何か。難読化解除の主要トランスフォームはどちらか。
   ▶ 答え: `safe` はコードの意味を変えない変換、`unsafe` は意味を変えうる変換。`deobfuscate` 本体や `dead-code`、`inline-decoder-wrappers` は `unsafe`。unminify 一式や `control-flow-object`/`control-flow-switch`、`self-defending`、`debug-protection` は `safe`。

10. 現状の webcrack が「まだ十分にできないこと」を Planned Features から 2 つ挙げよ。
    ▶ 答え: 意味のある変数名への賢いリネーム（LLM 利用を検討）、古い obfuscator.io バージョンへの対応、複数チャンクのバンドル展開、`@babel/preset-env` ヘルパの復元、TypeScript ヘルパ/モジュール/enum の復元、のうち任意の 2 つ。

## 出典

- https://github.com/j4k0xb/webcrack
- https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/README.md
- https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/concepts/deobfuscate.md
- https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/concepts/unminify.md
- https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/guide/introduction.md
- https://webcrack.netlify.app/docs/concepts/deobfuscate.html
- https://webcrack.netlify.app/docs/concepts/unminify.html
- https://github.com/javascript-obfuscator/javascript-obfuscator
- https://github.com/laverdet/isolated-vm
- https://github.com/trentmwillis/sandybox
- https://github.com/codemod-js/codemod/tree/main/packages/matchers#readme
- https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#writing-your-first-babel-plugin
- https://excalidraw.com/#json=0vehUdrfSS635CNPEQBXl,hDOd-UO9ETfSDWT9MxVX-A

<!-- self-read: https://github.com/javascript-obfuscator/javascript-obfuscator | 担当URL外・obfuscator.io の各オプションと元テンプレートの一次情報 -->
<!-- self-read: https://github.com/laverdet/isolated-vm | 担当URL外だがサンドボックス実行の土台。API と Node偶数系制約の一次情報 -->
<!-- self-read: https://github.com/codemod-js/codemod/tree/main/packages/matchers#readme | サブディレクトリREADMEで未取得。m.capture/m.fromCapture/m.containerOf/m.anyList/m.zeroOrMore が全編で登場 -->
<!-- self-read: https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#writing-your-first-babel-plugin | 担当URL外。visitor enter/exit・path.replaceWith/remove/scope・renameFast/generateUid の背景 -->
<!-- self-read: https://github.com/trentmwillis/sandybox | 担当URL外だがプレイグラウンドの隔離実行の土台。iframe隔離の限界とCSP併用 -->
<!-- self-read: https://excalidraw.com/#json=0vehUdrfSS635CNPEQBXl,hDOd-UO9ETfSDWT9MxVX-A | JS必須のインタラクティブ図で静的取得不可。制御フローオブジェクト変換の図解 -->
<!-- sources: https://github.com/j4k0xb/webcrack, https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/README.md, https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/concepts/deobfuscate.md, https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/concepts/unminify.md, https://webcrack.netlify.app/docs/concepts/deobfuscate.html, https://webcrack.netlify.app/docs/concepts/unminify.html, https://github.com/javascript-obfuscator/javascript-obfuscator, https://github.com/laverdet/isolated-vm, https://github.com/trentmwillis/sandybox, https://github.com/codemod-js/codemod/tree/main/packages/matchers#readme, https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#writing-your-first-babel-plugin -->
<!-- terms: webcrack, リバースエンジニアリング, 難読化解除（Deobfuscation）, unminify, obfuscator.io, javascript-obfuscator, String Array（文字列配列）, Array Rotator（配列回転）, Decoder（デコード関数）, サンドボックス（Sandbox）, isolated-vm, Self Defending, Domain Lock, Debug Protection, Control Flow Flattening（制御フロー平坦化）, Dead Code Injection（デッドコード注入）, SingleCallController, Calls Transform, AST（抽象構文木）, Babel, @codemod/matchers, IIFE, source/sink, safe/unsafe タグ, 定数畳み込み（constant folding）, プロキシ関数（proxy function）, sandybox, CSP（Content-Security-Policy）, VitePress, visitor, renameFast, generateUid -->
