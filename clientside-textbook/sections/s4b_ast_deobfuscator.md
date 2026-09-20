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
