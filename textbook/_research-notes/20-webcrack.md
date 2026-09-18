# [20] webcrack — JavaScript リバースエンジニアリング（難読化解除・unminify・バンドル展開）完全ノート

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://github.com/j4k0xb/webcrack | full | WebFetch（リポジトリページ） + `curl` で `https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/README.md` | README 全文を逐語取得。さらに `apps/docs/src/**` と `packages/webcrack/src/**` の一次ソースも raw 経由で取得し補強した |
| https://webcrack.netlify.app/docs/concepts/deobfuscate.html | full（代替経路） | WebFetch は `EGRESS_BLOCKED`、`curl` は `CONNECT tunnel failed, response 403`。→ 当該ページの**生成元 Markdown** を `https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/concepts/deobfuscate.md` から逐語取得 | `webcrack.netlify.app` ドメインが本環境の egress プロキシで遮断されているため HTML そのものは取得不可。VitePress のソース Markdown＝ページ本文なので内容は完全に一致する。`web.archive.org` も同様に遮断され利用不可 |
| （補強・自主取得）https://raw.githubusercontent.com/j4k0xb/webcrack/HEAD/apps/docs/src/guide/cli.md | full | curl | CLI リファレンス全文（netlify の /docs/guide/cli.html に相当） |
| （補強・自主取得）.../apps/docs/src/guide/api.md | full | curl | Node API リファレンス全文 |
| （補強・自主取得）.../apps/docs/src/guide/introduction.md, web.md, common-errors.md | full | curl | 導入・プレイグラウンド・よくあるエラー |
| （補強・自主取得）.../apps/docs/src/concepts/unminify.md, transpile.md, unpack.md, jsx.md | full | curl | 概念ページ全文 |
| （補強・自主取得）.../packages/webcrack/src/{index.ts,cli.ts,deobfuscate/*.ts,unpack/bundle.ts,unminify/transforms/index.ts,transpile/transforms/index.ts}, package.json | full | curl | AST 変換の実装・パイプライン順序・オプション型定義の一次ソース |

> 注意: GitHub の REST API（api.github.com）は本セッションでは「repository not enabled」で拒否されたため、ファイル一覧の列挙は GitHub の HTML ツリーページを WebFetch する方法と、raw.githubusercontent.com への直接アクセスで代替した。

## 要約（3〜10行）

- webcrack は **JavaScript のリバースエンジニアリング用ツール**。①obfuscator.io（javascript-obfuscator）の難読化解除、②unminify（縮小化されたコードを人間可読な構文へ戻す）、③transpile 解除（Babel/TS/SWC がダウンレベル化した構文をモダン構文へ復元）、④webpack / browserify **バンドルの展開（debundle）**、⑤`React.createElement` → **JSX 復元** の 5 機能を持つ。
- 設計の柱は 6 つ: Performance（高速化最適化）、Safety（変数参照とスコープを考慮）、Auto-detection（設定不要でパターンを自動検出）、Readability（難読化器/バンドラのアーティファクト除去）、TypeScript、Tests。
- 実装は **Babel の AST**（`@babel/parser` / `types` / `traverse` / `template`）＋ **`@codemod/matchers`** によるパターンマッチで、各「変換 (transform)」は `safe` / `unsafe` のタグを持つ。
- 文字列配列（String Array）のデコードは **静的解析ではなく実際に評価**する方式で、Node では `isolated-vm`（タイムアウト 10 秒の隔離 Isolate）、ブラウザでは呼び出し側が `sandbox` 関数を渡す（プレイグラウンドは sandybox + CSP `default-src 'none'` + 10 秒タイムアウト）。
- CLI は `webcrack [options] [file]`、stdin 対応。`-o <dir>` でバンドルを展開し、出力ディレクトリに `deobfuscated.js` / `bundle.json` / `index.js` / `1.js, 2.js …` を書き出す。
- Node API は `webcrack(code, options)` が `{ code, bundle, save(path) }` を返す。`mappings` オプションでモジュールに人間可読なパスを割り当てられ、バージョン間の差分追跡に有用。`plugins` オプションで 5 つのステージに Babel 互換プラグインを差し込める。
- バグバウンティ／クライアントサイド診断の文脈では、難読化・バンドル化された本番 JS を**読める形に戻して source/sink を探す**ための前処理ツールとして位置づけられる。

---

## 詳細ノート

### 1. プロジェクト概要とメタ情報 （出典: https://github.com/j4k0xb/webcrack, README.md）

- リポジトリ: `j4k0xb/webcrack`
- GitHub の description: **"Deobfuscate obfuscator.io, unminify and unpack bundled javascript"**
- Topics: `ast`, `browserify`, `bundle`, `debundle`, `deobfuscation`, `deobfuscator`, `extract`, `javascript`, `javascript-obfuscator`, `reverse-engineering`, `unminify`, `unpack`, `webpack`
- ライセンス: **MIT**
- スター 2.9k / フォーク 336 / watcher 27 / コミット 593 / open issue 40 / PR 10（取得時点の GitHub ページ表示値）
- npm パッケージ名: `webcrack`、`package.json` の version は **2.16.0**（HEAD 時点）
- homepage: `https://webcrack.netlify.app`
- リポジトリのトップレベル構成: ディレクトリ `.github`, `.vscode`, `apps`, `packages`, `patches` / ファイル `.gitignore`, `.prettierrc`, `CONTRIBUTING.md`, `LICENSE`, `README.md`, `eslint.config.js`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `vitest.config.js`, `vitest.workspace.json`
- `apps/` 配下: `docs`（VitePress ドキュメント）, `playground`（Web プレイグラウンド）, `web`
- `packages/webcrack/src/` 配下の主要ディレクトリ: `ast-utils`, `deobfuscate`, `transpile`, `unminify`, `unpack`, `transforms`, `plugin`, `utils` ほか

#### README 本文（原文のまま逐語）

```
webcrack is a tool for reverse engineering javascript.
It can deobfuscate [obfuscator.io](https://github.com/javascript-obfuscator/javascript-obfuscator), unminify,
transpile, and unpack [webpack](https://webpack.js.org/)/[browserify](https://browserify.org/),
to resemble the original source code as much as possible.

Try it in the [online playground](https://webcrack.netlify.app/) or view the [documentation](https://webcrack.netlify.app/docs).

- 🚀 **Performance** - Various optimizations to make it fast
- 🛡️ **Safety** - Considers variable references and scope
- 🔬 **Auto-detection** - Finds code patterns without needing a config
- ✍🏻 **Readability** - Removes obfuscator/bundler artifacts
- ⌨️ **TypeScript** - All code is written in TypeScript
- 🧪 **Tests** - To make sure nothing breaks
```

#### 動作要件（原文のまま逐語）

```
## Requirements

Node.js 22 or 24.

> [!NOTE]
> webcrack depends on [`isolated-vm`](https://github.com/laverdet/isolated-vm), which [does not recommend using odd-numbered Node.js releases](https://github.com/laverdet/isolated-vm#security) because they frequently break ABI/API compatibility with V8.
```

`packages/webcrack/package.json` の `engines` フィールド（逐語）:

```json
"engines": {
  "node": ">=22.0.0 <23 || >=24.0.0 <25 || >=26.0.0 <27"
},
```

- 依存関係（逐語）: `@babel/generator ^7.29.1`, `@babel/helper-validator-identifier ^7.28.5`, `@babel/parser ^7.29.2`, `@babel/template ^7.28.6`, `@babel/traverse ^7.29.0`, `@babel/types ^7.29.0`, `@codemod/matchers ^1.7.1`, `commander ^14.0.3`, `debug ^4.4.3`
- optionalDependencies: `"isolated-vm-6": "npm:isolated-vm@^6.1.2"`, `"isolated-vm-7": "npm:isolated-vm@^7.0.0"`（Node のメジャーバージョンで切り替える）

#### インストールと基本コマンド（README、原文のまま逐語）

```bash
npm install -g webcrack@latest
```

```bash
webcrack input.js
webcrack input.js > output.js
webcrack bundle.js -o output-dir
```

```bash
npm install webcrack@latest
```

```js
import fs from 'fs';
import { webcrack } from 'webcrack';

const input = fs.readFileSync('bundle.js', 'utf8');

const result = await webcrack(input);
console.log(result.code);
console.log(result.bundle);
await result.save('output-dir');
```

#### Donations（README、逐語）

- [GitHub Sponsors](https://github.com/sponsors/j4k0xb)
- Ethereum: `0xb3eFD474Dd8aFA715F563EfA322F6ae9Ae9DfCeA`
- Bitcoin: `bc1qc3u7ef2rue75f6t8x290r0qk0u84f0ln8ndjun`
- Solana: `6w9SFAYBxCKdtuj8DEAV9YT5zP68g4PyEkb21AmdxcBq`
- Monero: `87iYegrerGf1DUsTvUnbsv8gjTMJmzS3idRxHWkCy4iz1Xz5CUnDXy3VkTToSg32LUW3cwNrgLKd1TXRJqJY7MnvVR9yidm`

#### ドキュメントサイトのトップ（`apps/docs/src/index.md` の features、逐語）

| アイコン | title | details |
| --- | --- | --- |
| 🛡️ | Deobfuscate | `Undo all the obfuscation techniques of <a href="https://obfuscator.io">obfuscator.io</a>` |
| 🧹 | Unminify | `Convert minified code to human readable code` |
| 🧩 | Transpile | `Convert transpiled syntax back to modern JavaScript` |
| 📦 | Unpack Bundles | `Extract modules from webpack and browserify bundles to separate files` |

#### ドキュメントのサイドバー構成（`.vitepress/config.ts` より、netlify 上の URL 構造そのもの）

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

- サイト設定: `title: 'webcrack'`, `description: 'Deobfuscate, unminify and unpack bundled javascript'`, `base: '/docs/'`, 検索は `provider: 'local'`。
- 編集リンクのパターン: `https://github.com/j4k0xb/webcrack/edit/master/apps/docs/src/:path` — **ドキュメントの実体が `apps/docs/src/` 配下にある**ことの根拠。

#### 開発予定（Introduction ページ「Planned Features」、原文のまま逐語）

```
- Smarter variable renaming, possibly with LLMs like GPT-3.5
- Support older obfuscator.io versions
- Unpack multi-chunk bundles
- Decompile [@babel/preset-env](https://babeljs.io/docs/babel-preset-env) helpers
- Decompile TypeScript helpers, modules and enums
```

---

### 2. Deobfuscation（難読化解除）でサポートする obfuscator.io のオプション一覧 （出典: https://webcrack.netlify.app/docs/concepts/deobfuscate.html）

このページは、webcrack が **javascript-obfuscator（obfuscator.io）** の「どの難読化オプションを解除できるか」を列挙したもの。ページ本文は以下が全文である（原文のまま逐語）。

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

対応表として整理すると:

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

> 〔補足（一般知識）〕javascript-obfuscator（obfuscator.io）は、上記の各オプションを個別に ON/OFF できる OSS の JS 難読化器で、マルウェア配布スクリプトやスキマー、ライセンス保護スクリプトで広く使われる。webcrack はその「既知の出力テンプレート」を AST パターンとして直接マッチさせて元に戻す、という設計方針を採る。

#### 2.1 Deobfuscate パイプラインの実行順序（一次ソース: `packages/webcrack/src/deobfuscate/index.ts`）

`deobfuscate` トランスフォームは `name: 'deobfuscate'`, `tags: ['unsafe']`, `scope: true` で定義され、`sandbox` が渡されないと**何もしない**。処理順は次のとおり（逐語コード）:

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

ポイント（日本語での読み解き）:

1. **String Array を見つける** — 見つからなければ obfuscator.io ではないと判断して deobfuscate 全体を中断する（＝String Array の存在が検出の入口）。
2. **Rotator（配列回転 IIFE）を探す**。
3. **Decoder 関数群を探す**（複数あり得る）。
4. `inline-object-props` で「Calls Transform」により作られた引数オブジェクトを展開する。
5. デコーダごとに `inline-decoder-wrappers` を適用し、`var alias = decode;` のようなラッパ/エイリアスをすべて本体に置き換える。
6. `VMDecoder` を構築し、`inline-decoded-strings` で **デコード呼び出しを実際に評価した結果の文字列リテラルへ置換**する。
7. デコーダが 1 つ以上見つかった場合、String Array 本体・Rotator・各 Decoder の宣言を AST から**削除**する。
8. 最後に `mergeStrings`（分割文字列の再結合）→ `deadCode`（デッドコード除去）→ `controlFlowObject`（制御フロー用オブジェクトの展開）→ `controlFlowSwitch`（switch ディスパッチャの平坦化解除）を、`noScope: true` で一括適用する。
9. デバッグログは `debug` パッケージの名前空間 `webcrack:deobfuscate` に出る。ソース冒頭には AST Explorer の参考リンクがコメントされている: `// https://astexplorer.net/#/gist/b1018df4a8daebfcb1daf9d61fe17557/4ff9ad0e9c40b9616956f17f59a2d9888cd62a4f`

なお `self-defending` / `debug-protection` / `merge-object-assignments` / `evaluate-globals` は上の `deobfuscate` 内ではなく、**unminify の後**に実行される（後述のパイプライン節を参照）。ソース中のコメント: `// Have to run this after unminify to properly detect it`。

#### 2.2 String Array の検出パターン（`deobfuscate/string-array.ts`）

`StringArray` インターフェース（逐語）:

```ts
export interface StringArray {
  path: NodePath<t.FunctionDeclaration | t.VariableDeclaration>;
  references: NodePath[];
  name: string;
  originalName: string;
  length: number;
}
```

マッチャの構造（逐語、要点部分）:

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

検出できた String Array 関数は `renameFast(binding, '__STRING_ARRAY__');` で **`__STRING_ARRAY__` にリネーム**される（ログや中間出力で識別しやすくするため）。配列要素は `m.arrayOf(m.or(m.stringLiteral(), undefinedMatcher))` — 文字列リテラルまたは `undefined` のみを許容する。

#### 2.3 Array Rotator（String Array Rotate）の検出（`deobfuscate/array-rotator.ts`）

ソースの JSDoc（原文のまま逐語）:

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

実装の核（逐語）:

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

日本語の要点: Rotate は「配列を正しい並びになるまで `push(shift())` で回し続け、`parseInt` を使ったチェックサム的な条件が満たされたら `break` する IIFE」という形をとる。webcrack はこれを**丸ごと 1 つのシグネチャとして検出**し、後段で実際に実行して配列の最終状態を得る。先頭に `!` が付く形（`!function(){...}()`）も許容する。

#### 2.4 Decoder（デコード関数）の検出（`deobfuscate/decoder.ts`）

クラスの JSDoc（原文のまま逐語）:

```
/**
 * A function that is called with >= 1 numeric/string arguments
 * and returns a string from the string array. It may also decode
 * the string with Base64 or RC4.
 */
```

呼び出し収集時のマッチャ（逐語、抜粋）:

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

三項演算子を含む呼び出しの分配（逐語）:

```ts
    const buildExtractedConditional = expression`TEST ? CALLEE(CONSEQUENT) : CALLEE(ALTERNATE)`;
```

```ts
        // decode(test ? 1 : 2) -> test ? decode(1) : decode(2)
```

要点: 引数が「数値・文字列リテラル、それらの二項演算、単項マイナス」で構成される呼び出し（＝静的に値が決まる呼び出し）を `literalCall` として集め、`decode(cond ? a : b)` は `cond ? decode(a) : decode(b)` に**書き換えてから**個別に評価する。

#### 2.5 サンドボックスによる実評価（`deobfuscate/vm.ts`）

`Sandbox` 型（逐語）:

```ts
export type Sandbox = (code: string) => Promise<unknown>;
```

Node 用サンドボックス（逐語）:

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

ブラウザ用（逐語）:

```ts
export function createBrowserSandbox(): Sandbox {
  return () => {
    // TODO: use sandybox (not available in web workers though)
    throw new Error('Custom Sandbox implementation required.');
  };
}
```

Node のメジャーバージョンによる `isolated-vm` 切り替え（逐語）:

```ts
async function importIsolatedVM(): Promise<typeof IsolatedVM> {
  const major = Number(globalThis.process.versions.node.split('.')[0]);
  const { default: ivm } = (await (major >= 26
    ? import('isolated-vm-7')
    : import('isolated-vm-6'))) as { default: typeof IsolatedVM };
  return ivm;
}
```

**Self Defending を回避するための重要なテクニック**（逐語コメント）:

```ts
    // Generate as compact to bypass the self defense
    // (which tests someFunction.toString against a regex)
    const generateOptions = {
      compact: true,
      shouldPrintComment: () => false,
    };
```

日本語の要点: obfuscator.io の Self Defending は「自分自身の関数の `toString()` を正規表現で検査し、整形されていたら壊れる（無限ループ等）」という仕組み。webcrack はデコーダを VM に流し込む際、**あえて compact（1 行・コメントなし）で再生成**することでこの自己防衛チェックを通過させる。実行対象は String Array 本体 + 各 Decoder + Rotator のコードを連結した「セットアップコード」。

> 〔補足（一般知識）〕診断目的でこの種のツールを使う場合、対象コードは**信頼できない入力**として扱う必要がある。webcrack が `isolated-vm` を使うのも、`eval` や `vm` モジュールのようにホストのグローバルへ到達しうる実行環境を避けるため。API ドキュメント側にも「Simplest possible implementation. Don't run this with untrusted or malicious code.」という `sandbox: eval` に対する CAUTION が明記されている。

#### 2.6 Control Flow Flattening 解除（オブジェクト方式）— `deobfuscate/control-flow-object.ts`

ソース冒頭に説明図へのリンクがコメントされている（逐語）:

```ts
/**
 * Explanation: https://excalidraw.com/#json=0vehUdrfSS635CNPEQBXl,hDOd-UO9ETfSDWT9MxVX-A
 */
```

トランスフォーム定義: `name: 'control-flow-object'`, `tags: ['safe']`, `scope: true`。

マッチ対象（逐語、コメントが仕様を示す）:

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

日本語の要点:

- **キー名は「英字 5 文字ちょうど」**という正規表現 `/^[a-z]{5}$/i` で識別する（obfuscator.io が生成するキーの特徴）。これは「proxy function（プロキシ関数）」を格納するオブジェクトを見分けるための強いシグネチャ。
- 値として許すのは 4 種類: ①`"6|0|4|3|1|5|2"` のような**制御フロー順序を表す文字列**、②`function (a, b) { return a + b }` のような**二項/論理演算をラップするだけの関数**、③`function (a, b, c) { return a(b, c) }` のような**呼び出しを中継するだけの関数（任意引数数）**、④`function (a, ...b) { return a(...b) }` のような**rest/spread 中継関数**。
- さらに `const alias = obj;` のようなエイリアス変数（`aliasVar`）も追跡し、エイリアス経由のアクセスも解決する。
- 検出後は `inlineFunctionCall` によって呼び出し箇所に**元の演算/呼び出しを直接書き戻し**、オブジェクトを丸ごと削除する。これが「プロキシ関数の除去」に相当する。
- 安全性のために `isReadonlyObject` を使い、オブジェクトが後から書き換えられていないことを確認する。
- 展開後に `mergeStrings` を適用して分割文字列を結合する。

#### 2.7 Control Flow Flattening 解除（switch ディスパッチャ方式）— `deobfuscate/control-flow-switch.ts`

定義: `name: 'control-flow-switch'`, `tags: ['safe']`。**全文を逐語で記録する**（この変換の仕組みが最も分かりやすい教材になるため）:

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

日本語の要点（教科書向けの説明）:

1. 難読化後の典型形は「`const sequence = "2|4|3|0|1".split("|")` → `let iterator = 0` → `while (true) { switch (sequence[iterator++]) { case "0": …; continue; … } break; }`」の 3 文構成。
2. webcrack は `sequence` 文字列（正規表現 `/^\d+(\|\d+)*$/`）と `case` ラベル（`/^\d+$/` の文字列リテラル）を捕捉。
3. 各 `case` の本体から末尾の `continue` を取り除いてマップ化。
4. `sequence` の順序どおりに case 本体を**フラットに並べ直し**、元の 3 文（`splice(0, 3, ...)`）を置き換える。
5. これで「実行順序が配列で間接指定されていたコード」が**元の直線的な順序**に戻る。

#### 2.8 Dead Code Injection 解除 — `deobfuscate/dead-code.ts`

定義: `name: 'dead-code'`, `tags: ['unsafe']`, `scope: true`。全文（逐語）:

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

スコープ衝突を避ける置換関数（逐語）:

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

日本語の要点: obfuscator.io の Dead Code Injection は `if ("abc" === "abc") { 本物 } else { 偽物 }` のように**文字列リテラル同士の比較**をゲートにした分岐を挿入する。webcrack はこの形（`===`, `==`, `!==`, `!=` と `!` 付き）だけを対象に `evaluateTruthy()` で真偽を静的評価し、生き残る枝だけを残す。ブロックを親スコープにマージする際、**同名変数のシャドーイングによる重複宣言を避けるため `generateUid` でリネーム**する点が「Safety（スコープを考慮）」の具体例。なおこの変換は `unsafe` タグ（＝意味を変えうる可能性がある）に分類されている。

#### 2.9 Self Defending / Domain Lock / Console Output 無効化 — `deobfuscate/self-defending.ts`

定義: `name: 'self-defending'`, `tags: ['safe']`, `scope: true`。ソース先頭のコメント（**どの obfuscator.io テンプレートに対応するかの一次情報**、逐語）:

```ts
// SingleCallController: https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/common/templates/SingleCallControllerTemplate.ts

// Works for
// self defending: https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/self-defending/templates/SelfDefendingTemplate.ts
// domain lock: https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/domain-lock/templates/DomainLockTemplate.ts
// console output: https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/console-output/templates/ConsoleOutputDisableTemplate.ts
// debug protection function call: https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/debug-protection/templates/debug-protection-function-call/DebugProtectionFunctionCallTemplate.ts
```

マッチする構造（コード中のコメントが構造を示す、逐語）:

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

日本語の要点: obfuscator.io の **SingleCallController**（「一度しか実行されない呼び出し制御関数」）は、Self Defending・Domain Lock・Console Output 無効化・Debug Protection の呼び出し部で**共通に**使われるテンプレート。webcrack はこの共通テンプレートを 1 つのマッチャで捕捉して丸ごと除去するので、4 つの防御機構をまとめて無力化できる。

#### 2.10 Debug Protection 解除 — `deobfuscate/debug-protection.ts`

定義: `name: 'debug-protection'`, `tags: ['safe']`, `scope: true`。対応する obfuscator.io テンプレート（逐語コメント）:

```ts
// https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/debug-protection/templates/debug-protection-function-interval/DebugProtectionFunctionIntervalTemplate.ts

// https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/debug-protection/templates/debug-protection-function/DebugProtectionFunctionTemplate.ts

// https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/debug-protection/templates/debug-protection-function/DebuggerTemplate.ts

// https://github.com/javascript-obfuscator/javascript-obfuscator/blob/d7f73935557b2cd15a2f7cd0b01017d9cddbd015/src/custom-code-helpers/debug-protection/templates/debug-protection-function/DebuggerTemplateNoEval.ts
```

検出パターン（逐語）:

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

日本語の要点: Debug Protection は「再帰的に自分を呼びながら `debugger` 文（または `(function(){}).constructor('debugger')()`）を踏ませ、DevTools を開くと固まる」防御。さらに `setInterval(..., 4000)` で定期実行する版もある。webcrack は `debugger` 文と `constructor('debugger')` の**両方**をパターンに含め、`try/catch` を伴う再帰構造ごと除去する。

> 〔補足（一般知識）〕診断でこの種の anti-debug に遭遇した場合、webcrack で静的に除去する以外に、DevTools の "Never pause here"（ブレークポイント無効化）や、`Function.prototype.constructor` の差し替えといった動的な回避も使われる。ただし本ノートの主題は静的解除である。

#### 2.11 Calls Transform 解除 — `deobfuscate/inline-object-props.ts`

JSDoc（原文のまま逐語）:

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

マッチャ（逐語）:

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

ソース中の TODO コメント（逐語）: `// TODO: move do decoder.ts collectCalls to avoid traversing the whole AST`

#### 2.12 Decoder ラッパのインライン化 — `deobfuscate/inline-decoder-wrappers.ts`

全文（逐語）:

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

これが obfuscator.io の **"Variable/Function Wrapper Type"** オプションに対応する処理。

#### 2.13 オブジェクト代入のマージ — `deobfuscate/merge-object-assignments.ts`

JSDoc（原文のまま逐語）:

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

実装中の重要コメント（逐語）:

```ts
            // { [1]: value, "foo bar": value } can be simplified to { 1: value, "foo bar": value }
```

```ts
            // Example: const obj = { x: 1 }; obj.foo = 'bar'; -> const obj = { x: 1, foo: 'bar' };
```

```ts
            // Example: const obj = { foo: 'bar' }; return obj; -> return { foo: 'bar' };
```

循環参照チェック（`hasCircularReference(value.current!, binding)`）で、`obj.self = obj` のようなケースを避ける。

---

### 3. Unminify（縮小化の巻き戻し） （出典: https://webcrack.netlify.app/docs/concepts/unminify.html）

ページ冒頭（原文のまま逐語）:

```
Bundlers and obfuscators commonly minify code (remove new lines and whitespace, replace variable names with shorter ones, use a shorter syntax).

Most unminify sites just format the code, but webcrack also converts the syntax back to make it more readable and similar to the original code:
```

`unminify` は `mergeTransforms` で全変換を 1 つの visitor に統合して実行する（`name: 'unminify'`, `tags: ['safe']`）。

#### 3.1 unminify 変換の完全一覧（`packages/webcrack/src/unminify/transforms/index.ts` より、逐語）

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

（ドキュメントページには未記載だが実装に存在する変換: `string-literal-in-template`, `truncate-number-literal`, `unary-expressions`）

#### 3.2 各変換の before → after（ドキュメント原文の全例を逐語で再現）

以下はすべて「上＝変換前、下＝変換後」。原文では VitePress の `// [!code --]` / `// [!code ++]` マーカーで差分表示されている。

**block-statement**
```js
if (a) b(); // [!code --]
if (a) { // [!code ++]
  b();  // [!code ++]
} // [!code ++]
```

**computed-properties**
```js
console["log"](a); // [!code --]
console.log(a); // [!code ++]
```

**for-to-while**
```js
for (;;) a(); // [!code --]
while (true) a(); // [!code ++]
```
```js
for (; a < b;) c(); // [!code --]
while (a < b) c(); // [!code ++]
```

**infinity**
```js
1 / 0 // [!code --]
Infinity // [!code ++]
```

**invert-boolean-logic**
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

**json-parse**
```js
JSON.parse("[1,2,3]") // [!code --]
[1, 2, 3] // [!code ++]
```

**logical-to-if**
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

**merge-else-if**
```js
if (x) {
} else {  // [!code --]
  if (y) {}  // [!code --]
}  // [!code --]

if (x) {
} else if (y) {} // [!code ++]
```

**merge-strings**
```js
"a" + "b" + "c" // [!code --]
"abc" // [!code ++]
```

**number-expressions**（＝定数畳み込み / Numbers To Expressions の解除）
```js
-0x1021e + -0x7eac8 + 0x17 * 0xac9c // [!code --]
431390 // [!code ++]
```

**raw-literals**（Unicode Escape Sequence / 16 進数リテラルの復元）
```js
'\x61"✏️\t' // [!code --]
"a\"✏️\t" // [!code ++]
```
```js
0x1 // [!code --]
1 // [!code ++]
```

**remove-double-not**
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

**sequence**（カンマ演算子の分解 — 全 8 例）
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

**split-for-loops-vars**（原文の解説を逐語）
```
Minifiers commonly inline variables into for loops. Example: [esbuild](https://esbuild.github.io/try/#dAAwLjE5LjExAC0tbWluaWZ5AHZhciBqID0gMDsKZm9yICh2YXIgaSA9IDA7IGkgPCAzOyBpKyspIHt9)

To improve readability we only move the variables outside that are not used in the loop's test or update expressions.
```
```js
for (var j = 0, i = 0; i < 3; i++) {} // [!code --]
var j = 0; // [!code ++]
for (var i = 0; i < 3; i++) {} // [!code ++]
```

**split-variable-declarations**
```js
const a = 1, b = 2, c = 3; // [!code --]
const a = 1; // [!code ++]
const b = 2; // [!code ++]
const c = 3; // [!code ++]
```

**ternary-to-if**
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

**typeof-undefined**
```js
typeof a > "u" // [!code --]
typeof a === "undefined" // [!code ++]
```
```js
typeof a < "u" // [!code --]
typeof a !== "undefined" // [!code ++]
```

**unminify-booleans**
```js
!0 // [!code --]
true // [!code ++]
```
```js
!1 // [!code --]
false // [!code ++]
```

**void-to-undefined**
```js
void 0 // [!code --]
undefined // [!code ++]
```

**yoda**（参考リンクは原文のまま）
```
<https://eslint.org/docs/latest/rules/yoda> and <https://babeljs.io/docs/en/babel-plugin-minify-flip-comparisons>
```
```js
"red" === color // [!code --]
color === "red" // [!code ++]
```

---

### 4. Transpile（トランスパイル済み構文のモダン構文復元） （出典: https://webcrack.netlify.app/docs/concepts/transpile.html）

ページ冒頭（逐語）: `Convert transpiled syntax back to modern JavaScript.`

変換の完全一覧（`src/transpile/transforms/index.ts`、逐語）:

```ts
export { default as defaultParameters } from './default-parameters';
export { default as logicalAssignments } from './logical-assignments';
export { default as nullishCoalescing } from './nullish-coalescing';
export { default as nullishCoalescingAssignment } from './nullish-coalescing-assignment';
export { default as optionalChaining } from './optional-chaining';
export { default as templateLiterals } from './template-literals';
```

#### 各変換の before → after（原文の全例を逐語）

**default-parameters**（参考: `<https://babeljs.io/docs/babel-plugin-transform-parameters>`）
```js
function f() { // [!code --]
  var x = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1; // [!code --]
  var y = arguments.length > 1 ? arguments[1] : undefined; // [!code --]
} // [!code --]

function f(x = 1, y) {} // [!code ++]
```

**logical-assignments**（参考: `<https://babeljs.io/docs/babel-plugin-transform-logical-assignment-operators>, TypeScript and SWC`）
```js
x || (x = y) // [!code --]
x ||= y // [!code ++]
```
```js
var _x, _y; // [!code --]
(_x = x)[_y = y] && (_x[_y] = z); // [!code --]
x[y] &&= z; // [!code ++]
```

**nullish-coalescing**
```js
a !== null && a !== undefined ? a : b; // [!code --]
a ?? b; // [!code ++]
```
```js
var _a$b; // [!code --]
(_a$b = a.b) !== null && _a$b !== undefined ? _a$b : c; // [!code --]
a.b ?? c; // [!code ++]
```
```js
function foo(foo, qux = (_foo$bar => (_foo$bar = foo.bar) !== null && _foo$bar !== undefined ? _foo$bar : "qux")()) {} // [!code --]
function foo(foo, qux = foo.bar ?? "qux") {} // [!code ++]
```

**nullish-coalescing-assignment**
```js
a ?? (a = b); // [!code --]
a ??= b; // [!code ++]
```
```js
var _a; // [!code --]
(_a = a).b ?? (_a.b = c); // [!code --]
a.b ??= c; // [!code ++]
```

**optional-chaining**
```js
a === null || a === undefined ? undefined : a.b; // [!code --]
a?.b; // [!code ++]
```
```js
var _a; // [!code --]
(_a = a) === null || _a === undefined ? undefined : _a.b; // [!code --]
a?.b; // [!code ++]
```

**template-literals**（参考: `<https://babeljs.io/docs/babel-plugin-transform-template-literals>`）
```js
"'".concat(foo, "' \"").concat(bar, "\"") // [!code --]
`'${foo}' "${bar}"` // [!code ++]
```

> 診断上の意義: `_a`, `_a$b`, `_foo$bar` のような Babel が生成する一時変数はノイズになる。これらを `?.` / `??` / `||=` に戻すことで、**どの値が nullable でどこで分岐しているか**が一目で読めるようになり、source→sink の追跡が容易になる。

---

### 5. JSX 復元 （出典: https://webcrack.netlify.app/docs/concepts/jsx.html）

ページ全文（原文のまま逐語）:

```
# JSX

Tools such as [Babel](https://babeljs.io/), [TypeScript](https://www.typescriptlang.org/)
or bundlers convert JSX to `React.createElement` calls.
This feature does the opposite.

```jsx
React.createElement(
  'div',
  null,
  React.createElement('span', null, 'Hello ', name),
);
```

->

```jsx
<div>
  <span>Hello {name}</span>
</div>
```

> [!NOTE]
> This currently only works for the React **UMD** build, not when bundled.
```

実装上は `src/transforms/jsx.ts`（クラシック `React.createElement`）と `src/transforms/jsx-new.ts`（新しい JSX ランタイム `jsx/jsxs`）の 2 つがあり、`options.jsx` が true のときに両方が適用される（`src/index.ts` の `options.jsx ? [jsx, jsxNew] : []`）。

**重要な制限**: 現状 React の **UMD ビルド**にのみ対応し、バンドル済み（`React` がローカル変数にリネームされている）コードでは機能しない。

---

### 6. Bundle Unpacking（webpack / browserify の展開） （出典: https://webcrack.netlify.app/docs/concepts/unpack.html）

#### 6.1 Webpack（原文の箇条書きを逐語）

```
- `__webpack_require(id)__` gets rewritten to `require('./relative/path.js')`.

- Modules may get converted to ESM.

- multiple chunks are not supported _yet_.
```

ページには `![Webpack structure](../assets/webpack-structure.png)` という構造図が埋め込まれている（画像そのものは本ノートには取り込めていない）。

#### 6.2 Webpack のモジュールラッパ型定義（原文のまま逐語）

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

#### 6.3 `__webpack_require__` の全プロパティ（原文のまま逐語）

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

表形式での整理（webpack ランタイムのヘルパ一覧）:

| プロパティ | シグネチャ | 意味 |
| --- | --- | --- |
| （呼び出し） | `(moduleId: number): Exports` | モジュールを読み込む |
| `d` | `d(exports, name, getter): void` | ESM エクスポート用の getter を定義 |
| `e` | `e(chunkId): Promise<Exports>` | チャンクを読み込む |
| `g` | `g(): typeof globalThis` | `globalThis` か `window` を返す |
| `l` | `l(url, done, key, chunkId): void` | script タグでスクリプトを読み込む |
| `n` | `n(exports): { (): Exports; get a(): Exports }` | 非 ESM 互換のための default export 取得 |
| `o` | `o(object, property): boolean` | `Object.prototype.hasOwnProperty.call` |
| `oe` | `oe(err: Error): never` | 非同期読み込みのエラーハンドラ |
| `r` | `r(exports): void` | `__esModule` を true に設定 |
| `t` | `t(value, mode): unknown` | 偽の namespace オブジェクトを作る |
| `u` | `u(chunkId): string` | JS チャンクのファイル名。例: `u(0) -> 'chunks/0.138aa346.js'` |
| `c` | `Record<number, Module>` | インストール済み全モジュール（キー＝モジュール id） |
| `f.j` | `j(chunkId, promises): void` | JavaScript の JSONP チャンクローディング |
| `m` | `Record<number, FactoryFunction>` | 全モジュール関数（キー＝モジュール id） |
| `p` | `string` | チャンクの public base path。例: `'/_next/'` |
| `s` | `number` | エントリモジュール id |
| `w` | `Record<number, Exports>` | 全 `WebAssembly.instance` の exports（キー＝wasm モジュール id） |

> 診断上の意義: `__webpack_require__.p`（public path）と `u(chunkId)`（チャンクファイル名生成）を読むと、**追加で取得すべき JS チャンクの URL 組み立て規則**が分かる。`m`（全モジュール関数）と `s`（エントリ id）が分かればバンドル全体を機械的に分解できる。`l()` の `script` タグ挿入は、public path が攻撃者制御下に入る場合の script gadget / XSS の観点でも注目点になる。

#### 6.4 Browserify（原文のまま逐語）

```
Each module has a numerical id and contains a list of dependencies: `{ './foo': 1, './bar': 3 }`.
These paths are relative to the current module and are used like `require('./foo')`.

The absolute path a module is not stored anywhere, so webcrack builds a dependency tree
and resolves the paths to preserve the original file structure as much as possible.

Sometimes the entry module was deeply nested (e.g. `src/app/index.js`), but `"src"` or `"app"` is not included in the bundle.
In this case, directory names like `tmp0/tmp1`, etc. are used instead.
```

例（原文のまま逐語）— モジュール id → 依存関係:

```js
{
  0: { 1: './a.js', 4: 'lib' }, // entry
  1: { 2: '../bar/b.js' },
  2: { 3: '../../c.js' },
  3: {},
  4: {},
}
```

結果のファイル構造（原文のまま逐語）:

```txt
├── tmp0
│   ├── tmp1
│   │   ├── index.js
│   │   └── a.js
│   └── bar
│       └── b.js
├── c.js
```

#### 6.5 `Bundle` クラスと出力の実装（`src/unpack/bundle.ts`）

```ts
export class Bundle {
  type: 'webpack' | 'browserify';
  entryId: string;
  modules: Map<string, Module>;
```

`bundle.json` の生成内容（逐語）:

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

**パストラバーサル対策**（逐語）— mappings で悪意あるパスを与えられても出力ディレクトリの外に書き込まない:

```ts
        const modulePath = normalize(join(path, module.path));
        if (relative(path, modulePath).startsWith('..')) {
          throw new Error(`detected path traversal: ${module.path}`);
        }
```

`applyMappings` の挙動（逐語の要点）:

```ts
              const resolvedPath = mappingPath.startsWith('./')
                ? mappingPath
                : `node_modules/${mappingPath}`;
              module.path = resolvedPath;
```

同じ mapping が 2 回マッチすると `throw new Error(\`Mapping ${mappingPath} is already used.\`);` となる。

---

### 7. Command Line Interface（CLI） （出典: https://webcrack.netlify.app/docs/guide/cli.html）

#### 7.1 インストール（原文のまま逐語、パッケージマネージャ別）

```bash [npm]
npm install -g webcrack@latest
```

```bash [yarn]
yarn global add webcrack@latest
```

```bash [pnpm]
pnpm add -g webcrack@latest --allow-build=isolated-vm
```

（pnpm では `--allow-build=isolated-vm` が必要 — pnpm 10 以降が postinstall を既定で実行しないため）

#### 7.2 `--help` 出力（原文のまま逐語）

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

CLI オプション完全一覧（表）:

| 短縮形 | 長形式 | 引数 | 説明（原文） | 既定値 |
| --- | --- | --- | --- | --- |
| `-V` | `--version` | なし | `output the version number` | — |
| `-o` | `--output <path>` | パス | `output directory for bundled files` | 未指定なら stdout |
| `-f` | `--force` | なし | `overwrite output directory` | false |
| `-m` | `--mangle` | なし | `mangle variable names` | false |
| — | `--no-jsx` | なし | `do not decompile JSX` | jsx: true |
| — | `--no-unpack` | なし | `do not extract modules from the bundle` | unpack: true |
| — | `--no-deobfuscate` | なし | `do not deobfuscate the code` | deobfuscate: true |
| — | `--no-unminify` | なし | `do not unminify the code` | unminify: true |
| `-h` | `--help` | なし | `display help for command` | — |
| （引数） | `[file]` | ファイル | `input file, defaults to stdin` | stdin |

CLI 実装（`src/cli.ts`）の逐語:

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

`-f/--force` の実際の挙動（逐語）— **既存ディレクトリは `force` 指定時に `rm -rf` される**点に注意:

```ts
    if (output) {
      if (force || !existsSync(output)) {
        await rm(output, { recursive: true, force: true });
      } else {
        program.error('output directory already exists');
      }
    }
```

CLI は起動時に `debug.enable('webcrack:*');` を実行するため、**既定でデバッグログが有効**になる。

#### 7.3 入力の与え方（原文のまま逐語）

```bash
webcrack input.js
# or download/pipe a script from a website
curl https://pastebin.com/raw/ye3usFvH | webcrack
```

原文の説明: `By default it outputs debug logs and the deobfuscated/unminified code to the terminal.` / `To write the code to a file, you can do:`

```bash
webcrack input.js > output.js
```

#### 7.4 バンドルの展開と出力ディレクトリ構造（原文のまま逐語）

```bash
webcrack bundle.js -o output
```

```
The output directory will contain the following files:

- `deobfuscated.js` - deobfuscated/unminified code
- `bundle.json` - bundle type and module ids/paths
- `index.js` - entry point
- all remaining modules (`1.js`, `2.js`, etc.)
```

出力ファイル一覧（表）:

| ファイル | 内容 |
| --- | --- |
| `deobfuscated.js` | 難読化解除 / unminify 済みのコード全体 |
| `bundle.json` | バンドル種別（`type`）、`entryId`、モジュールの `id` と `path` の一覧 |
| `index.js` | エントリポイント |
| `1.js`, `2.js`, … | 残りのモジュール |

`-o` を指定せずにバンドルを処理した場合、モジュールはターミナルに表示されず、次のログが出る（`src/cli.ts` 逐語）:

```ts
        debug('webcrack:unpack')(
          'Modules are not displayed in the terminal. Use the --output option to save them to a directory.',
        );
```

#### 7.5 他言語からの呼び出し（原文のまま逐語）

```
If the package is installed locally instead of globally, the path of the CLI would look like `node_modules/.bin/webcrack`.

Spawn a new process where the code is piped to stdin.
The logs will be written to stderr and the output code will be written to stdout.

Example in Python:
```

```py
import subprocess

code = "1+1"
result = subprocess.run(
    ["webcrack"], input=code, capture_output=True, text=True
)
print(result.stdout)
```

**重要**: ログは **stderr**、出力コードは **stdout** に分かれる。自動化パイプラインではこの分離を前提にできる。

---

### 8. Node.js API （出典: https://webcrack.netlify.app/docs/guide/api.html）

#### 8.1 インストール（原文のまま逐語）

```bash [npm]
npm install webcrack@latest
```

```bash [yarn]
yarn add webcrack@latest
```

```bash [pnpm]
pnpm add webcrack@latest --allow-build=isolated-vm
```

#### 8.2 基本的な使い方（原文のまま逐語）

```js
import { webcrack } from 'webcrack';

const result = await webcrack('const a = 1+1;');
console.log(result.code); // 'const a = 2;'
```

CommonJS の場合（原文の NOTE ブロックを逐語）:

```js
const { webcrack } = require('webcrack');

webcrack('const a = 1+1;').then((result) => {
  console.log(result.code); // 'const a = 2;'
});
```

難読化解除したコードと展開したバンドルを指定ディレクトリへ保存（逐語）:

```js
import fs from 'fs';
import { webcrack } from 'webcrack';

const code = fs.readFileSync('bundle.js', 'utf8');
const result = await webcrack(code);
await result.save('output-dir');
```

#### 8.3 バンドル情報の取得（原文のまま逐語）

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

#### 8.4 オプション（原文のまま逐語）

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

フィルタ付き mangle（逐語）:

```js
await webcrack(code, {
  mangle: (id) => id.startsWith('_0x'),
});
```

（`_0x` 始まりの識別子のみをリネーム対象にする＝obfuscator.io 由来の名前だけを整理する典型的な使い方）

原文の "Other options" 記述（逐語）:

```
- `mappings`: The `mappings` option takes a function that receives an instance of [@codemod/matchers](https://github.com/codemod-js/codemod/tree/main/packages/matchers#readme), and returns an object that maps any matching nodes, to the path specified in the object key.
```

`src/index.ts` の `Options` インターフェース（一次ソース、逐語 — ドキュメントに載っていない `onProgress` も含む）:

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
   *
   * @example
   * ```js
   * m => ({
   *   './utils/color.js': m.regExpLiteral('^#([0-9a-f]{3}){1,2}$')
   * })
   * ```
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

戻り値の型（逐語）:

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

オプション既定値のマージ（逐語）— `sandbox` の既定はブラウザかどうかで分岐する:

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

オプション一覧（表）:

| オプション | 型 | 既定値 | 説明（原文） |
| --- | --- | --- | --- |
| `jsx` | `boolean` | `true` | `Decompile react components to JSX.` |
| `unpack` | `boolean` | `true` | `Extract modules from the bundle.` |
| `deobfuscate` | `boolean` | `true` | `Deobfuscate the code.` |
| `unminify` | `boolean` | `true` | `Unminify the code. Required for some of the deobfuscate/unpack/jsx transforms.` |
| `mangle` | `boolean \| ((id: string) => boolean)` | `false` | `Mangle variable names.` |
| `plugins` | `Partial<Record<Stage, Plugin[]>>` | `{}` | `Run AST transformations after specific stages` |
| `mappings` | `(m: Matchers) => Record<string, m.Matcher<unknown>>` | `() => ({})` | `Assigns paths to modules based on the given matchers. This will also rewrite require() calls to use the new paths.` |
| `sandbox` | `Sandbox` | Node: `createNodeSandbox()` / ブラウザ: `createBrowserSandbox()` | `Function that executes a code expression and returns the result (typically from the obfuscator).` |
| `onProgress` | `(progress: number) => void` | `() => {}` | `@param progress Progress in percent (0-100)` |

`save(path)` の実装（逐語）:

```ts
    async save(path) {
      const { mkdir, writeFile } = await import('node:fs/promises');
      path = normalize(path);
      await mkdir(path, { recursive: true });
      await writeFile(join(path, 'deobfuscated.js'), outputCode, 'utf8');
      await bundle?.save(path);
    },
```

#### 8.5 ブラウザでの利用と Sandbox（原文のまま逐語）

```
The `sandbox` option has to be passed when trying to deobfuscate string arrays in a browser.
In future versions, this should hopefully not be necessary anymore.

It is an (optionally async) function that takes a `code` parameter and returns the evaluated value.

> [!CAUTION]
> Simplest possible implementation. Don't run this with untrusted or malicious code.
```

```js
const result = await webcrack('function _0x317a(){....', { sandbox: eval });
```

プレイグラウンドのより安全な実装（原文のまま逐語）:

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

原文の説明: `This is how the webcrack playground currently implements it in a more secure way, with [sandybox](https://github.com/trentmwillis/sandybox), a Content-Security-Policy to prevent network access and a timeout:`

要点（防御設計として重要）:
1. **sandybox** で iframe 内に隔離
2. iframe に `<meta http-equiv="Content-Security-Policy" content="default-src 'none';">` を注入して**ネットワークアクセスを遮断**
3. `Promise.race` による **10 秒タイムアウト**
4. 実行後は `sandbox.removeFunction(fn)` で必ず後片付け

#### 8.6 Customize Paths（`mappings`）（原文のまま逐語）

```
Useful for reverse-engineering and tracking changes across multiple versions of a bundle.

The `mappings` option takes a function that receives an instance of [@codemod/matchers](https://github.com/codemod-js/codemod/tree/main/packages/matchers#readme), and returns an object that maps any matching nodes, to the path specified in the object key.

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

新しいフォルダ構造（原文のまま逐語）:

```txt
├── index.js
├── utils
│   └── color.js
└── node_modules
    └── lodash
        └── index.js
```

> 診断上の意義: バンドルのモジュール id は**ビルドのたびに変わる**ため、そのままでは「先週の 47.js」と「今週の 52.js」を比較できない。`mappings` で「この正規表現リテラルを含むモジュール＝`./utils/color.js`」と**内容ベースで安定した名前**を付けておけば、バージョン間 diff を取って新規追加された機能・エンドポイント・sink を洗い出せる。

#### 8.7 Plugins（原文のまま逐語）

```
Webcrack's processing pipeline consists of six key stages:

1. **Parse**: The input code is parsed into an Abstract Syntax Tree (AST).
2. **Prepare**: Performs basic normalization, such as adding block statements.
3. **[Deobfuscate](../concepts/deobfuscate.md)**
4. **[Transpile](../concepts/transpile.md)** and **[Unminify](../concepts/unminify.md)**
5. **[JSX](../concepts/jsx.md)** and **[Unpack](../concepts/unpack.md)**
6. **Generate**: Converts the modified AST back into executable code.

You can extend or modify webcrack's behavior by hooking into its pipeline stages using plugins. Plugins allow you to manipulate the AST at specific stages of the pipeline.
```

**Supported Stages**（原文のまま逐語）:

```
- `afterParse`
- `afterPrepare`
- `afterDeobfuscate`
- `afterUnminify`
- `afterUnpack`
```

`Plugins are executed sequentially in the order they are defined for each stage.`

**Writing Plugins**（原文のまま逐語）:

```
Refer to the [Babel Plugin Handbook](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#writing-your-first-babel-plugin) for a detailed guide on writing plugins.

Webcrack's plugin API is similar to Babel's but only the following utility libraries are provided to the plugin function:

- [`parse`](https://babeljs.io/docs/babel-parser)
- [`types`](https://babeljs.io/docs/babel-types)
- [`traverse`](https://babeljs.io/docs/babel-traverse)
- [`template`](https://babeljs.io/docs/babel-template)
- [`matchers`](https://github.com/codemod-js/codemod/tree/main/packages/matchers)
```

**Example Plugin**（原文のまま逐語）:

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

**Using Babel plugins**（原文のまま逐語）:

```
It should be compatible with most Babel plugins as long as they only access the limited API specified above.
```

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

---

### 9. 実際の処理パイプライン（一次ソース: `packages/webcrack/src/index.ts`）

ドキュメントの「6 ステージ」より詳細な実体は次のとおり（逐語）:

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

**ブックマークレット（`javascript:` URL）を自動検出して URL デコードする**という、診断で地味に役立つ機能がある。

パース設定（逐語）:

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

`errorRecovery: true` により、**構文的に壊れた/断片的なスクリプトでも可能な限り解析を続行**する。

prepare ステージ（逐語、コメント含む）:

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

ステージ配列の全体（逐語、要点）:

```ts
    options.deobfuscate &&
      (() => applyTransformAsync(ast, deobfuscate, options.sandbox)),
    plugins.afterDeobfuscate && ...

    options.unminify &&
      (() => {
        applyTransforms(ast, [transpile, unminify]);
      }),
    plugins.afterUnminify && ...

    options.mangle &&
      (() =>
        applyTransform(
          ast,
          mangle,
          typeof options.mangle === 'boolean' ? () => true : options.mangle,
        )),
    // TODO: Also merge unminify visitor (breaks selfDefending/debugProtection atm)
    (options.deobfuscate || options.jsx) &&
      (() => {
        applyTransforms(
          ast,
          [
            // Have to run this after unminify to properly detect it
            options.deobfuscate ? [selfDefending, debugProtection] : [],
            options.jsx ? [jsx, jsxNew] : [],
          ].flat(),
        );
      }),
    options.deobfuscate &&
      (() => applyTransforms(ast, [mergeObjectAssignments, evaluateGlobals])),
    () => (outputCode = generate(ast)),
    // Unpacking modifies the same AST and may result in imports not at top level
    // so the code has to be generated before
    options.unpack && (() => (bundle = unpackAST(ast, options.mappings(m)))),
```

日本語での実行順まとめ（教科書向け）:

| # | ステージ | 内容 |
| --- | --- | --- |
| 0 | ブックマークレット検出 | `javascript:` プレフィックスを剥がして URL デコード |
| 1 | Parse | `@babel/parser`（`sourceType: 'unambiguous'`, `errorRecovery: true`, jsx プラグイン） |
| — | `afterParse` プラグイン | |
| 2 | Prepare | `removeNodeFields` → `blockStatements`, `sequence`, `splitVariableDeclarations` |
| — | `afterPrepare` プラグイン | |
| 3 | Deobfuscate | String Array → Rotator → Decoders → VM デコード → mergeStrings/deadCode/controlFlowObject/controlFlowSwitch |
| — | `afterDeobfuscate` プラグイン | |
| 4 | Transpile + Unminify | `transpile` → `unminify`（各々 mergeTransforms 済み） |
| — | `afterUnminify` プラグイン | |
| 5 | Mangle（任意） | `mangle: true` または フィルタ関数 |
| 6 | selfDefending / debugProtection（unminify 後でないと検出できない）+ jsx / jsxNew | |
| 7 | mergeObjectAssignments + evaluateGlobals | |
| 8 | Generate | `generate(ast)` で `outputCode` を確定 |
| 9 | Unpack | `unpackAST(ast, options.mappings(m))`（AST を破壊的に変更するため generate の**後**） |
| — | `afterUnpack` プラグイン | |

進捗は各ステージ終了ごとに `options.onProgress((100 / stages.length) * (i + 1))` で報告される。

---

### 10. Web プレイグラウンド （出典: https://webcrack.netlify.app/docs/guide/web.html）

原文（逐語）:

```
On the [playground](https://webcrack.netlify.app/) you can deobfuscate code without installing anything.
It runs entirely in the browser, so the code never leaves your computer.
```

キーボードショートカット（原文の TIP ブロックを逐語）:

```
- Press `F1` to open the command palette
- Press `Alt`+`Enter` to run webcrack on the code
- Press `Shift`+`Enter` to evaluate and replace the selected code as a value (`[[3+4]][0]` -> `[7]`)
- Press `Ctrl`+`Shift`+`Enter` to evaluate and replace the selected code raw (`'x' + ' = \'val\''` -> `x = 'val'` instead of a string)
- Press `Ctrl`+`S` to download the code in the active tab as a `.js` file
```

ショートカット表:

| キー | 動作 |
| --- | --- |
| `F1` | コマンドパレットを開く |
| `Alt`+`Enter` | コードに webcrack を実行 |
| `Shift`+`Enter` | 選択範囲を**値として**評価して置換（`[[3+4]][0]` → `[7]`） |
| `Ctrl`+`Shift`+`Enter` | 選択範囲を**raw として**評価して置換（`'x' + ' = \'val\''` → 文字列ではなく `x = 'val'`） |
| `Ctrl`+`S` | アクティブタブのコードを `.js` としてダウンロード |

クエリパラメータ（原文の表を逐語）:

| Parameter | Description                            |
| --------- | -------------------------------------- |
| `code`    | Code as a string (max length: ~16,000) |
| `url`     | URL to fetch code from                 |

原文の説明と例（逐語）:

```
Pass either `code` or `url` parameters to load code into the editor.
Keep in mind to encode them (e.g. `encodeURIComponent` in js).

Examples:

- [/?url=https://pastebin.com/raw/ye3usFvH](https://webcrack.netlify.app/?url=https%3A%2F%2Fpastebin.com%2Fraw%2Fye3usFvH)

> [!WARNING]
> Use this only if you don't mind netlify or corsproxy.io seeing the code/url, otherwise paste it directly into the editor.
```

**重要な運用上の注意**: `url=` パラメータを使うと **netlify と corsproxy.io にコード/URL が見える**。バグバウンティで顧客の非公開資産を扱う場合は、この機能を使わずエディタへ直接貼り付けるか、ローカル CLI を使うべき。

---

### 11. よくあるエラーと対処 （出典: https://webcrack.netlify.app/docs/guide/common-errors.html）

#### 11.1 isolated-vm 関連（原文のまま逐語）

```
If you see errors like

> - isolated_vm.node: undefined symbol: \_ZNK2v815ValueSerializer8Delegate20SupportsSharedValuesEv
> - ERR_DLOPEN_FAILED
> - Segmentation fault

it most likely means that the Node.js version you are using is not compatible with the [isolated-vm](https://github.com/laverdet/isolated-vm) package. This can also happen if you upgrade Node.js after installing `webcrack`.
See [Requirements](./introduction.md#requirements) for the supported Node.js versions.

A possibly fix is to run `npm rebuild isolated-vm` in your project directory or delete the `node_modules/isolated-vm` directory and run `npm install` again.

For Node 20.x and above, disabling snapshots may be necessary:
```

```sh [Windows]
set NODE_OPTIONS=--no-node-snapshot
webcrack input.js
```

```sh [Linux/Mac]
NODE_OPTIONS=--no-node-snapshot webcrack input.js
```

```sh
node --no-node-snapshot your-script.js
```

#### 11.2 Cannot Find Module（原文のまま逐語）

```
> Error: Cannot find module './out/isolated_vm'

This error may happen when using pnpm 10 or later, because it does not run the `postinstall` script by default to build or download the native modules of isolated-vm.

To fix this, re-run the install command with `--allow-build=isolated-vm --force` added or see the [pnpm 10 changelog](https://github.com/pnpm/pnpm/releases/tag/v10.0.0).
```

#### 11.3 Heap Out Of Memory（原文のまま逐語）

```
> FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory

Fix by running node with the [--max-old-space-size](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-megabytes) flag. For example:
```

```sh [Windows]
set NODE_OPTIONS=--max-old-space-size=8192 && webcrack bundle.js
```

```sh [Linux/Mac]
NODE_OPTIONS="--max-old-space-size=8192" webcrack bundle.js
```

```sh
node --max-old-space-size=8192 your-script.js
```

#### 11.4 `__DECODE_0__`（原文のまま逐語）

```
If this appears in your code, the deobfuscator failed to decode a string from the string array.
This can happen in forked javascript-obfuscator versions or when `Dead Code Injection` is enabled.

[Open an issue](https://github.com/j4k0xb/webcrack/issues/new?assignees=&labels=bug&projects=&template=bug_report.yml) if you encounter this.
```

エラー対処の一覧表:

| 症状 | 原因 | 対処（原文コマンド） |
| --- | --- | --- |
| `isolated_vm.node: undefined symbol: _ZNK2v8...` / `ERR_DLOPEN_FAILED` / `Segmentation fault` | Node バージョンと isolated-vm の ABI 非互換（Node 更新後にも発生） | `npm rebuild isolated-vm`、または `node_modules/isolated-vm` を削除して `npm install` |
| 同上（Node 20.x 以上） | snapshot 機能との衝突 | `NODE_OPTIONS=--no-node-snapshot webcrack input.js` / `node --no-node-snapshot your-script.js` |
| `Error: Cannot find module './out/isolated_vm'` | pnpm 10 以降が既定で postinstall を実行しない | インストール時に `--allow-build=isolated-vm --force` を付ける |
| `FATAL ERROR: Ineffective mark-compacts near heap limit ...` | 大きなバンドルでヒープ不足 | `NODE_OPTIONS="--max-old-space-size=8192" webcrack bundle.js` |
| 出力に `__DECODE_0__` が残る | String Array のデコード失敗。javascript-obfuscator のフォーク版、または Dead Code Injection 有効時に起きる | issue を報告する |

---

### 12. バグバウンティ／クライアントサイド診断での実践的な使い方（章 ch04 向けの整理）

〔補足（一般知識）〕以下は原文に明示されていない運用上の位置づけを、上記の一次情報から導ける範囲で整理したもの。ツール名・オプション名・出力ファイル名はすべて上記の一次情報に基づく。

1. **収集 → 展開 → 探索**の流れ: 対象サイトの `main.[hash].js` などを取得し、`webcrack bundle.js -o out` でモジュール単位に分割。`out/bundle.json` で `entryId` と全モジュールの `id`/`path` を確認し、`out/*.js` を grep して source（`location.hash`, `postMessage`, `document.referrer` 等）と sink（`innerHTML`, `eval`, `document.write` 等）を探す。
2. **バンドルのまま grep するより有利な理由**: unminify によって `!0`→`true`、`void 0`→`undefined`、`console["log"]`→`console.log`、カンマ演算子の分解、三項→if が適用されるので、**識別子や文字列が grep で引っかかる形に戻る**。特に `computed-properties`（`obj["dangerous"]` → `obj.dangerous`）と `raw-literals`（`'\x61\x6c\x65\x72\x74'` → `"alert"`）は、文字列ベースの sink 検索の成否を左右する。
3. **難読化された第三者スクリプトの解析**: obfuscator.io で保護された広告/計測/スキマー系スクリプトは String Array 方式が多く、webcrack の deobfuscate で**文字列がすべて平文リテラルに戻る**。ここから外部送信先ドメイン・エンドポイント・収集対象フィールド名が判明する。
4. **バージョン間 diff**: `mappings` で内容ベースの安定パス（例: `'./utils/color.js': m.regExpLiteral('^#([0-9a-f]{3}){1,2}$')`）を与えて出力を固定し、デプロイのたびに diff を取れば新機能・新エンドポイントの検知に使える（原文: `Useful for reverse-engineering and tracking changes across multiple versions of a bundle.`）。
5. **プラグインでの自動走査**: `plugins: { afterUnminify: [myPlugin] }` に Babel 互換の visitor を差し込めば、`innerHTML` 代入や `new Function(...)` のような sink を AST レベルで列挙できる（ドキュメントの `babel-plugin-transform-remove-console` の例と同じ形式）。
6. **安全上の注意**: 解析対象は信頼できないコードである。API の `sandbox: eval` は原文で明確に `Don't run this with untrusted or malicious code.` と警告されている。Node CLI は既定で `isolated-vm`（10 秒タイムアウトの隔離 Isolate）を使うため相対的に安全だが、解析は隔離環境で行うのが望ましい。また `-f/--force` は出力ディレクトリを `rm -rf` する点に注意。
7. **プライバシー**: プレイグラウンドはブラウザ内完結（`the code never leaves your computer`）だが、`?url=` パラメータ経由の読み込みは netlify / corsproxy.io にデータが渡る。顧客資産の解析ではローカル CLI を使う。
8. **限界の把握**: ①webpack のマルチチャンクは未対応（`multiple chunks are not supported _yet_.`）、②JSX 復元は React **UMD** ビルドのみ、③古い obfuscator.io バージョンは未対応（Planned Features に記載）、④`__DECODE_0__` が残ったらフォーク版か Dead Code Injection の影響。

---

## 読者が自分で開くべき資料

本ノートは全内容を一次ソースから逐語取得できたが、以下は**画像・インタラクティブ要素・図解**のため本ノートに取り込めていない。読者は自分で開くこと。

1. **https://webcrack.netlify.app/docs/concepts/unpack.html — Webpack 構造図**
   - 取得できなかった理由: ページ中に `![Webpack structure](../assets/webpack-structure.png)` として埋め込まれた**画像**であり、テキスト化できない。また `webcrack.netlify.app` 自体が本セッションの egress プロキシで遮断されていた（WebFetch: `EGRESS_BLOCKED`、curl: `CONNECT tunnel failed, response 403`）。
   - 読みどころ: ①webpack バンドル全体のトップレベル IIFE 構造、②`modules` 配列/オブジェクトとモジュール id の対応、③`__webpack_require__` とモジュールファクトリ関数の引数の関係、④エントリモジュールがどこから起動されるか。
2. **https://excalidraw.com/#json=0vehUdrfSS635CNPEQBXl,hDOd-UO9ETfSDWT9MxVX-A — Control Flow Object 変換の図解**
   - 取得できなかった理由: Excalidraw の**JS 必須のインタラクティブ図**であり、静的テキスト取得ができない。リンクは `packages/webcrack/src/deobfuscate/control-flow-object.ts` の JSDoc に記載されている一次情報。
   - 読みどころ: ①制御フロー用オブジェクトの生成と参照の関係、②エイリアス変数を経由した間接参照がどう解決されるか、③プロキシ関数（`function(a,b){return a+b}`）がどこにインライン展開されるか、④`"6|0|4|3|1|5|2"` のような順序文字列の役割。
3. **https://webcrack.netlify.app/ — オンラインプレイグラウンド**
   - 取得できなかった理由: 上記と同じくドメインが遮断。かつ Monaco ベースの**対話的エディタ**なので静的取得に意味がない。
   - 読みどころ: ①`Alt`+`Enter` で実際に難読化サンプルを変換して before/after を体感する、②`Shift`+`Enter` / `Ctrl`+`Shift`+`Enter` による選択範囲の部分評価（難読化文字列の手動デコードに有用）、③左右タブでモジュールごとの出力を確認する、④`Ctrl`+`S` で結果をダウンロードする。
4. **https://github.com/javascript-obfuscator/javascript-obfuscator — 難読化器本体**
   - 本ノートでは扱っていない（担当 URL 外）。
   - 読みどころ: ①各オプション（String Array Encoding, Control Flow Flattening Threshold, Dead Code Injection Threshold など）の意味と既定値、②`src/custom-code-helpers/` 配下のテンプレート（webcrack がマッチさせている元コードそのもの）、③`SelfDefendingTemplate.ts` / `DomainLockTemplate.ts` / `DebugProtectionFunctionTemplate.ts` / `SingleCallControllerTemplate.ts`、④オプションの組み合わせによる出力の違い。
5. **https://github.com/laverdet/isolated-vm — サンドボックス実行基盤**
   - 読みどころ: ①`Isolate` / `Context` / `eval(code, {timeout, copy, filename})` の意味、②Node の偶数系バージョンのみ推奨という制約の理由（V8 ABI 互換）、③`--no-node-snapshot` が必要になる条件、④メモリ制限の設定方法。
6. **https://github.com/codemod-js/codemod/tree/main/packages/matchers#readme — `@codemod/matchers`**
   - 読みどころ: ①`m.capture` / `m.fromCapture` によるバックリファレンス、②`m.containerOf` / `m.anyList` / `m.zeroOrMore` などの構造マッチャ、③`mappings` オプションに渡せるマッチャの一覧、④独自マッチャ（`m.matcher(fn)`）の書き方。
7. **https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#writing-your-first-babel-plugin — Babel Plugin Handbook**
   - 読みどころ: ①visitor の書き方（`enter` / `exit`）、②`path.replaceWith` / `path.remove` / `path.scope`、③`@babel/types` のビルダとバリデータ、④スコープとバインディングの扱い（webcrack の `renameFast` / `generateUid` の背景）。
8. **https://github.com/trentmwillis/sandybox — ブラウザ用サンドボックス**
   - 読みどころ: ①`Sandybox.create()` と `addFunction` / `removeFunction` の API、②iframe ベースの隔離モデルの限界、③CSP との併用方法。

---

## 付録: 本ノート作成時に取得した一次ソースのローカルパス

作業ディレクトリ: `/tmp/claude-0/-home-user-Bug-bounty-/32de2d37-9918-5d2d-9855-7e3b08d1c1c2/scratchpad/`

- `wc-readme.md` — README.md 全文
- `wcdocs/apps_docs_src_*.md` — ドキュメントサイトの各ページ Markdown
- `wcdocs/deob_*.ts` — `packages/webcrack/src/deobfuscate/` 配下の変換実装
- `wcdocs/main_index.ts`, `wcdocs/main_cli.ts` — パイプラインと CLI の実装
