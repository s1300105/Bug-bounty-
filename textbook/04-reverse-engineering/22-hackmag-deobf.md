# 自作JavaScriptデオブフスケータの作り方 — Babel AST で難読化を解除する

> **この節で分かること**
> - JavaScript のデオブフスケーション（難読化解除）が「パース → 変換 → 再生成」の3段構成で成り立つ理由と仕組みを説明できる。
> - Babel の `parser` / `traverse` / `generator` / `types` を使い、visitor パターンで AST を書き換える最小コードを自分で書ける。
> - 定数畳み込み・定数伝播・文字列配列復号・デッドコード除去・制御フロー平坦化復元という代表的な逆変換の狙いどころを説明できる。
> - 文字列復号で「部分評価」と「実行環境の隔離（サンドボックス）」がなぜ必須なのかを説明できる。
> - AstExplorer.net などの補助ツールと既製デオブフスケータを使って、難読化されたクライアントサイド JS を解析する手順を組み立てられる。

**元資料**: https://hackmag.com/coding/js-deobfuscation （原典は取得できず二次情報ベース）
**関連する節**: JavaScript の難読化技法、クライアントサイドの静的解析

---

> ### 📌 ここは自分で開いて読んでください
> **資料**: 自作JavaScriptデオブフスケータの作り方（hackmag 原典） — https://hackmag.com/coding/js-deobfuscation
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress ポリシーで CONNECT 403 拒否。web.archive.org のミラーも同様に拒否）。以下の記述は二次情報（WebSearch の検索スニペット・要約）と、一般に確立した Babel デオブフス手法の知識にもとづく再構成であり、hackmag 記事固有のサンプルコードや具体数値は欠落している。
> **読みどころ**:
> 1. hackmag 固有の難読化サンプルコード（逐語）と、各変換に対する逆変換手順の具体例。
> 2. Babel `parser`/`traverse`/`generator` を使った自作デオブフスケータの完全なソース。
> 3. 文字列復号の具体的なデコーダ抽出・評価方法（記事独自の実装）。
> 4. 制御フロー平坦化の復元を行う実コード。
> 5. 部分評価（実行環境の部分評価）の実装詳細と隔離方法。
> **代替手段**: 二次情報として steakenthusiast.github.io の ReverseJS 連載、trickster.dev の Babel 連載、github.com/kuizuo/js-deobfuscator が同等の実コードを提供している（本文で紹介する）。

---

## 1. なぜデオブフスケータを自作するのか

### 難読化とは何か

難読化（obfuscation, オブフスケーション）とは、プログラムの動作を変えずにソースコードを人間に読みにくくする加工のこと。たとえば `alert("hi")` を `_0x1a2b(0x0)` のような意味不明な関数呼び出しに置き換え、変数名を消し、文字列を配列に隠す。

クライアントサイドの脆弱性ハンティングでは、対象サイトの JavaScript が難読化されていることが日常的にある。難読化を解除しない限り、どこで API を叩き、どこにトークンを埋め込み、どこに XSS のシンク（危険な代入先）があるのかを読み取れない。

### なぜ既製ツールだけでは足りないのか

既製のデオブフスケータ（後述）は強力だが、難読化のバリエーションは無限にあり、対象ごとに新しい層が現れる。自分で AST（抽象構文木）を書き換える技術を持っていれば、既製ツールが対応していないパターンにも自作の1パスを足して対応できる。

この節の狙いは「デオブフスケータをブラックボックスとして使う」段階から「中で何が起きているかを理解し、必要なら自作する」段階へ進むことである。

### 設計意図: 難読化は可逆な変換の積み重ね

重要な前提として、難読化は元コードと**振る舞いが等価**な変換の積み重ねである。振る舞いを保ったまま読みにくくしているだけなので、原理的には各変換に対応する**逆変換**を適用すれば元に近い形へ戻せる。デオブフスケーションはこの逆変換を機械的に行う作業である。

〔補足〕完全に元のソースへ戻せるとは限らない（変数名などの情報は失われている）。しかし「読める・解析できる」レベルまで復元することが目的であり、それは十分達成できる。

---

## 2. デオブフスケータの3段構成（Parse → Transform → Generate）

デオブフスケーション処理は、複数の二次情報が一致して次の3段階で動くと述べている。

```
難読化された JS ソース
      │
      ▼  ① Parse（構文解析）
   AST（抽象構文木）
      │
      ▼  ② Transform / Traverse（走査して書き換え）
 書き換え後の AST
      │
      ▼  ③ Generate（コード生成）
 読みやすい JS ソース
```

### 各段階の役割

- **① Parse**: JS ソースを読み、`@babel/parser` で AST に変換する。AST とは、コードの構造を木として表したデータのこと。たとえば `1 + 2` は「二項演算（BinaryExpression）」というノードになり、左に `1`、右に `2`、演算子に `+` を持つ。
- **② Transform / Traverse**: `@babel/traverse` で AST を深さ優先探索（Depth-First Search, DFS）でたどり、visitor（後述）のコールバックでノードを追加・更新・削除して難読化を打ち消す。
- **③ Generate**: `@babel/generator` で書き換え後の AST から JS ソースを再生成する。

### Babel とは

Babel（バベル）とは、JavaScript を AST に変換して操作するためのツール群のこと。もともとは新しい JS 構文を古い環境向けに変換（トランスパイル）するために作られたが、AST を自在に読み書きできるため、デオブフスケーションの定番基盤になっている。

`@babel/parser`（パーサ）・`@babel/traverse`（走査）・`@babel/generator`（生成）・`@babel/types`（ノード生成・判定のヘルパ）を使う。これらはいずれも `@babel/core` の依存なので、`@babel/core` を入れれば揃う（二次情報 nullteilerfrei / trickster.dev の記述）。

### 最小の雛形コード

〔補足（一般知識）〕次は標準的な Babel デオブフス雛形であり、hackmag 原典の逐語ではない。

```js
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const fs = require("fs");

const code = fs.readFileSync("obfuscated.js", "utf8");
const ast = parser.parse(code);

traverse(ast, {
  // ここに各ノード型の visitor を書く
});

const output = generate(ast, { comments: false }).code;
fs.writeFileSync("deobfuscated.js", output);
```

このファイルの中で `traverse(ast, {...})` の中身を書き足していくのが、デオブフスケータ開発の実体である。`generate` に `{ comments: false }` を渡すと、難読化器が挿入したノイズコメントを落とせる。

---

## 3. visitor パターンと path オブジェクト

### 設計意図: 「ノード型ごとに処理を書く」という発想

AST は数十種類のノード型からなる。二項演算、メンバーアクセス（`arr[0]` や `obj.x`）、関数呼び出し、変数宣言などである。難読化の各パターンは特定のノード型に現れるので、「ノード型をキーにして処理を登録する」形にすると書きやすい。これが visitor（ビジター）パターンである。

### 仕組み: visitor オブジェクト

`traverse(ast, visitor)` の `visitor` は「キー = AST ノード型、値 = 関数」のオブジェクトである。Babel は木をたどる途中で一致するノードに出会うたびに、その関数を1回呼ぶ。

コールバックには **`path`** オブジェクトが渡される。`path` はノードそのものではなく、ノードをラップした存在で、**親ノード・スコープ・自身を置換する方法**を保持している。ノードだけでは「この式を別の式に差し替える」ことができないため、`path` が置換手段を提供する点が重要である。

### 主要な path API

| API | 役割 |
|-----|------|
| `path.node` | ラップしている実際の AST ノード |
| `path.replaceWith(newNode)` | ノードを別ノードに置換する |
| `path.replaceWithMultiple([...])` | 複数ノードに置換する |
| `path.remove()` | ノードを削除する |
| `path.stop()` | トラバース（走査）を停止する |
| `path.skip()` | このノードの子孫の走査をスキップする |
| `path.evaluate()` | 静的評価する。戻り値の `confident`（真なら Babel が結果に確信）と `value` を見る |
| `path.scope` | スコープ情報（束縛・参照の解決）を持つ |

`path.evaluate()` はデオブフスケーションの主力である。「このノードはコンパイル時に値が確定するか？」を Babel が判断し、確定するなら `confident: true` とその `value` を返してくれる。

### 最初の一手: 文字列連結の畳み込み

〔補足（一般知識）〕次は文字列連結の定数畳み込み。二次情報が同種の例を挙げている。

```js
traverse(ast, {
  BinaryExpression(path) {
    const { left, right, operator } = path.node;
    if (operator === "+" && t.isStringLiteral(left) && t.isStringLiteral(right)) {
      path.replaceWith(t.stringLiteral(left.value + right.value));
    }
  }
});
```

難読化器はしばしば `"al" + "ert"` のように文字列を分割して隠す。この visitor は「`+` 演算子で左右がどちらも文字列リテラル」の二項演算を見つけ、連結した1つの文字列リテラルに置き換える。`t.isStringLiteral` は「そのノードが文字列リテラルか」を判定するヘルパ、`t.stringLiteral(...)` は新しい文字列リテラルノードを作るヘルパである。

〔補足〕`BinaryExpression` は常に left / right / operator の3要素を持つ（ReverseJS の Constant Folding 回で再確認できる）。

---

## 4. 定数変数のインライン展開（constant propagation）

### 攻撃者はどこを隠すのか

難読化器は、意味のある値を一度変数に入れて名前を消し、コードのあちこちから参照させる。たとえば `var _0xa = "https://evil"; fetch(_0xa);` のようにして、`fetch` の宛先を一見分かりにくくする。これを元に戻すのが定数伝播（constant propagation, 定数の伝播）である。

### 仕組み

`VariableDeclarator`（変数宣言子）を走査し、**再代入されない定数**変数を特定する。その変数の全参照を実際の値で置換すれば、変数を消せる。

「その変数が定数か」「どこから参照されているか」は、スコープの機能で分かる。`path.scope.getBinding(name)` は、その変数の束縛（binding）を返し、`binding.constant`（定数かどうか）と `binding.referencePaths`（全参照の path 配列）を持つ。この API が定数伝播の中核である（出典: WebSearch 要約 ReverseJS「Replacing References to Constant Variables」）。

### コード

〔補足（一般知識）〕定数変数のインライン化パターン。

```js
traverse(ast, {
  VariableDeclarator(path) {
    const { id, init } = path.node;
    if (!t.isIdentifier(id) || !init) return;
    const binding = path.scope.getBinding(id.name);
    if (!binding || !binding.constant) return;          // 再代入があるものは除外
    if (!t.isLiteral(init)) return;                     // リテラル初期化のみ安全にインライン
    for (const ref of binding.referencePaths) {
      ref.replaceWith(t.cloneNode(init));
    }
    path.remove();
  }
});
```

### なぜ「反復適用」が要るのか

定数伝播と定数畳み込み（節2・3）を交互に繰り返すと、変数を段階的に消せる。`var a = 1; var b = a + 2;` の場合、まず `a` を `1` に伝播すると `b = 1 + 2` になり、次に畳み込みで `b = 3` になり、さらに `b` を伝播できる。学術的にも「repeated constant folding + propagation」と呼ばれ、変化がなくなるまで（fixpoint, 不動点まで）繰り返すのが実務である。

---

## 5. string-array（文字列配列）マッピングの復号

### 攻撃者の狙い: すべての文字列を1か所に隠す

`javascript-obfuscator`（obfuscator.io、有名 OSS 難読化器）の中核パターンが string-array（文字列配列）である。仕組みは次のとおり。

- プログラム中の全文字列リテラルを**1つの配列に抽出**する。
- 元の参照を「配列からインデックスで取り出す関数呼び出し」に置換する。たとえば `"login"` が `_0x1234(0x0)` になる。
- さらに上に**並べ替え（rotate/shift）・算術オフセット・暗号化（base64 / RC4）**の層を重ねる。
- 配列は固定のランダム数だけ **shift（回転 IIFE）** され、順序復元を難しくする。要素は shuffle される場合もある。

### 多層構造の内訳

出典（WebSearch 要約: javascript-obfuscator README / DeepWiki「String Array System」「String Array Helpers」）によれば、string-array は次の層からなる。

| 層 | 内容 |
|----|------|
| 抽出 | 全文字列リテラルを1つの配列に集約 |
| エンコード | 各要素を `none` / `base64` / `rc4` のいずれかでエンコード。RC4 が最上位段で、各文字列は Base64 でラップした RC4 暗号ブロブになり、アクセサ関数に遅延 RC4 実装（オンデマンド復号）が組み込まれる |
| 回転（rotate） | 配列を固定・ランダムな数だけ shift し、削除済み文字列と元位置の対応付けを妨害。回転 IIFE が実行時に順序を戻す |
| shuffle | 要素順をシャッフルする設定もある |
| calls transform / index shift | 各参照をアクセサ関数呼び出しに置換し、呼び出しインデックスの型をランダムなリストから選ぶ |

IIFE（即時実行関数式, Immediately Invoked Function Expression）とは、定義した瞬間に自分自身を呼び出す関数のこと。回転 IIFE は起動時に配列の順序を「正しい」並びへ戻す役目を持つ。

### 逆変換の実務手順

複数ツールが共通で採用する手順（出典: WebSearch 要約 deobfuscate-js / webcrack）。

1. **string-array 変数**を検出する。
2. **回転 IIFE**（あれば）を検出し実行して、配列順序を確定する。
3. **デコーダ関数**（アクセサ）を検出し、**Node の隔離 vm コンテキストでサンドボックス実行**して平文を復元する。
4. `CallExpression`（アクセサ呼び出し）を実際の文字列リテラルに `replaceWith` する。
5. self-overwriting decoder（自己書き換えデコーダ）・オフセット付き回転・カスタム復号ロジックにも対応する。

### コード骨子

〔補足（一般知識）〕デコーダ呼び出しを実値へ置換する骨子。実デコード関数は対象コードから取り出して安全に評価する（節7 の部分評価を使う）。

```js
// 前提: 対象コードから復号関数 decoder(idx) を安全に取り出しておく（後述の部分評価）
traverse(ast, {
  CallExpression(path) {
    const callee = path.node.callee;
    if (t.isIdentifier(callee, { name: DECODER_NAME })) {
      const args = path.node.arguments;
      if (args.every(a => t.isNumericLiteral(a) || t.isStringLiteral(a))) {
        const decoded = decoder(...args.map(a => a.value));
        path.replaceWith(t.stringLiteral(decoded));
      }
    }
  }
});
```

`MemberExpression`（`arr[idx]` の形）や `CallExpression`（デコーダ呼び出し）を走査し、実際の文字列に `path.replaceWith()` するのが基本方針である。近代のデオブフスケータは accessor オフセット・回転 IIFE・別名チェーン（alias chain, デコーダに複数の別名がぶら下がる形）・RC4 暗号配列すべてに対応する必要がある。

### 既製の対応ツール

- **webcrack**（string array / rotate / shuffle / index shift / calls transform / wrapper type / none-base64-RC4 encoding を一括処理し、webpack バンドルも復元する）。
- **deobfuscate-js**（回転オフセット・base64/RC4・自己書き換えデコーダに対応）。

---

## 6. デッドコード / 到達不能コードの除去

### 攻撃者はノイズで埋める

難読化器は、意味のない空文や、決して実行されない分岐（`if (false) {...}`）を大量に挿入して、解析者の目を疲れさせる。これらは振る舞いに影響しないので、安全に削除できる。

### 仕組みと手順

- `EmptyStatement`（空文）ノードを走査して `path.remove()` で消す。
- 恒常 false 分岐（`if (false) {...}`）や到達不能ブロックを除去する。
- 定数条件は `path.evaluate()` で判定し、真なら consequent（then 側）、偽なら alternate（else 側）に畳む。

### コード

〔補足（一般知識）〕空文ステートメントの除去。

```js
traverse(ast, {
  EmptyStatement(path) { path.remove(); }
});
```

出典（WebSearch 要約 ReverseJS / uoftctf「Removing Dead or Unreachable Code」）。

---

## 7. 制御フロー平坦化（CFF）の復元

### 攻撃者の狙い: 実行順序を分からなくする

制御フロー平坦化（Control Flow Flattening, CFF）は、制御フローグラフ（プログラムの実行経路を表す図）を「平坦化」して、どのブロックがどの順で実行されるかを読み取りにくくする難読化である。もっとも強力な難読化の一つで、解析の最後の砦になりやすい。

### 仕組み: ディスパッチャループ

switch ベースの実装では、コードが次の形になる。

```
状態変数 state を用意
while (true) {
  switch (state) {
    case A: /* ブロック1 */ state = 次の番号; break;
    case B: /* ブロック2 */ state = 次の番号; break;
    ...
  }
}
```

- 各コードブロックが switch の **`case`** になる。
- switch 全体が**無限ループ（`while(true)`）**で囲まれる。
- **状態変数（state）**が switch の評価式で、次に実行する case を決める。しばしば `_0xstate = "3|1|2|0".split("|")` のような順序配列を1トークンずつ walk するインデックスを使う。元のソース順が、state への代入シーケンスに移し替えられている。

この「無限ループ + switch + 状態変数」の中枢を**ディスパッチャ（dispatcher）**と呼ぶ。整数 switch の場合もあれば、制御文字列（例 `"3|1|2|0"`）を分割して1トークンずつ進むインデックスの場合もある。

### unflatten（逆変換）の手順

出典（WebSearch 要約 crawlex / trickster.dev「unflattening the CFG」）。

1. まず二次難読化（文字列復号など）を先に剥がしてから CFF に着手する。CFF の上に文字列難読化が乗っていると、ディスパッチャすら読めないためである。
2. ディスパッチャを読み、**初期 state** を得る。
3. 各 case を歩き、「どのブロックを実行し、次にどの state を設定するか」を記録して**制御フローグラフ（辺）を再構築**する。
4. 辺が揃ったら通常の `if/else` とループとして**再出力（re-emit）**し、switch/while 骨格を除去する。
5. ネストの削減（reducing nestedness）も併用する。

つまり、状態遷移を静的に評価して case の実行順を復元し、各 case ブロックを元の逐次順に並べ替え、switch/while 骨格を除去して元の逐次・分岐構造へ戻す。

### 参考実装・事例

emotet_unflatten_poc（SophosLabs、マルウェア Emotet の CFF 復元 PoC）、eybisi.run の Control Flow Unflattening、Debray らの学術論文（unflatten.pdf、制御フロー unflatten の学術的定式化）。VirusBulletin 論文や Jscrambler 101、zerotistic の CFF remover 記事も同じ話題を扱う。

> ### 📌 ここは自分で開いて読んでください
> **資料**: JavaScript AST manipulation with Babel — unflattening the CFG（trickster.dev） — https://www.trickster.dev/post/javascript-ast-manipulation-with-babel-reducing-nestedness-unflattening-the-cfg/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: trickster.dev ドメインが egress プロキシでブロックされた）。以下の記述は検索結果の要約断片にもとづく。
> **読みどころ**:
> 1. ディスパッチャ（switch + while + state）から制御フローグラフの辺を再構築する具体コード。
> 2. ネスト削減（reducing nestedness）と unflatten を組み合わせる手順。
> 3. string-array 復号を先に済ませてから CFF に着手する順序の理由。
> **代替手段**: eybisi.run「Control Flow Unflattening」（https://eybisi.run/Control-Flow-Unflattening/ ）、blog.crawlex.net の CFF 連載、SophosLabs の emotet_unflatten_poc（GitHub）。

---

## 8. 部分評価（Partial Evaluation）と実行環境の隔離

### 発想: 事前に計算できるものは計算してしまう

デオブフスケーションは**部分評価（partial evaluation, 部分計算）**に類似している。部分評価とは、プログラムを「事前計算できる静的部分」と「実行時にしか決まらない動的部分」に分け、静的部分を先に計算してコードに畳み込む技法のこと（academic の定式化）。難読化された部分（デコーダ呼び出しなど）の多くは静的に確定するので、先に計算して結果で置き換えれば読みやすくなる。

### 手順

1. ファイルを AST にパースする。
2. 関連する定義（デコーダ関数・定数テーブルなど）を特定する。
3. **それらのノードだけを隔離コンテキストで評価**する。`path.evaluate()` の `confident` チェックを使うか、vm2 / isolated-vm などの隔離 VM を使う。
4. 残りのツリーを走査し、呼び出しを算出済みの定数値に置換する。

### なぜ隔離（サンドボックス）が必須なのか

これがこの節で最も重要な安全上の注意である。解析対象のコードには**悪性コードや副作用**が含まれうる。デコーダ関数を素朴に `eval` すると、解析者のマシン上で攻撃コードが走ってしまう。

そのため、対象コードの一部を実行して結果を得るツールは、必ず**隔離 VM（サンドボックス）**の中で動かす。Node.js の `vm` モジュール、より強固な `vm2` や `isolated-vm` を使う。awesome-javascript-deobfuscation の索引は「サンプルを実行するツール」に明示的なラベルを付けており、実行系ツールは危険を伴うことを警告している。

### 安全な静的畳み込みのコード

〔補足（一般知識）〕`path.evaluate` による安全な静的畳み込み。

```js
traverse(ast, {
  "BinaryExpression|UnaryExpression"(path) {
    const { confident, value } = path.evaluate();
    if (confident && (typeof value === "number" || typeof value === "string" || typeof value === "boolean")) {
      path.replaceWith(t.valueToNode(value));
    }
  }
});
```

`path.evaluate()` は Babel が安全に静的評価できる範囲でだけ `confident: true` を返す。この方法はコードを実行しないので、単純な算術・文字列演算の畳み込みには最も安全である。デコーダ関数のように実行が必要な場合にのみ、隔離 VM に踏み込む。

### 関連ツール・研究

- **JStillery**（Minded Security）= 部分評価による高度デオブフス。
- **JSimpo** = スライス記号実行 + 動的実行の構造的デオブフス（純粋な静的部分評価のスケーラビリティ問題を回避）。

出典: WebSearch 要約 Minded Security「Advanced JS Deobfuscation via AST and Partial Evaluation」/ JStillery / academic。

---

## 9. ワークフローと補助ツール

### 定石: まず AST を可視化する

visitor を書く前に、対象コードの AST を **AstExplorer.net** で可視化し、狙うノード型・構造を特定するのが定石である（複数の二次情報が共通してこう助言している）。AstExplorer は左にコード、右に AST ツリーを表示するオンラインツールで、どの部分がどのノード型になるかを一目で確認できる。ノード型が分かれば、それをキーにした visitor を書ける。

### 既製デオブフスケータ一覧

| ツール | 特徴 |
|--------|------|
| js-deobfuscator（kuizuo） | Babel AST ベース。オンライン playground + CLI + プログラマブル API |
| webcrack（j4k0xb） | javascript-obfuscator と webpack バンドルを一括アンパック。string array 系を網羅対応 |
| deobfuscate-js（pljeroen） | string array パターン特化。回転オフセット・base64/RC4・自己書き換えデコーダ対応 |
| babel-plugin-deobfuscate（mcountryman） | 解析用 Babel プラグイン |
| js-confuser-deobfuscator | js-confuser 難読化への対応 |
| JStillery（Minded Security） | 部分評価による高度デオブフス |
| deobfuscate.io / W3cubTools の JS deobfuscate | オンライン整形・簡易復号 |
| DeepWiki の javascript-obfuscator 解説 | 難読化器の内部構造ドキュメント（逆に読むと逆変換の設計図になる） |

### 反復適用（fixpoint）

1パスでは消えない層があるため、変化がなくなるまで visitor 群を繰り返し適用するのが実務である。文字列復号 → 定数畳み込み → 定数伝播 → デッドコード除去 → CFF 復元、という順に何周も回す。特に CFF は他の層を先に剥がしてから着手する。

---

## 手を動かす

1. Node.js を用意し、作業ディレクトリで Babel 一式を入れる。

   ```bash
   npm init -y
   npm install @babel/core @babel/parser @babel/traverse @babel/generator @babel/types
   ```

2. 難読化されたコードを `obfuscated.js` として保存する（自分で立てた検証環境や、許可されたバグバウンティ対象の JS を使うこと）。obfuscator.io で自作コードを難読化して素材を作るのが安全で学びやすい。

3. 節2の雛形を `deob.js` として保存し、まず何もしない `traverse(ast, {})` で通す。入力と同じ出力が出れば、パース → 生成の往復が動いている。

   ```bash
   node deob.js
   ```

4. 節3の `BinaryExpression` visitor（文字列連結の畳み込み）を足して実行し、`"al" + "ert"` のような分割文字列が結合されることを確認する。

5. AstExplorer.net を開き、対象コードを貼り付けて、デコーダ呼び出しや string-array がどのノード型（`CallExpression` / `ArrayExpression` / `MemberExpression`）になるかを確認する。

6. 節4の定数伝播、節6のデッドコード除去 visitor を順に足す。変化がなくなるまで `traverse` を複数回ループさせる（fixpoint）。

7. 文字列復号が必要になったら、デコーダ関数を **`vm` などの隔離環境**で取り出して評価し、節5の `CallExpression` visitor で実値に置換する。素朴な `eval` は絶対に使わない。

8. 難物（string array の回転や CFF）は、まず webcrack や deobfuscate-js といった既製ツールに通して、どこまで剥がれるかを見る。残った層だけ自作 visitor で対応する。

---

## つまずきポイント

- **`traverse` を default インポートし忘れる**: `require("@babel/traverse").default` と `.default` が必要。付け忘れると「traverse is not a function」になる。`generator` も同様に `.default` が要る。
- **path とノードを混同する**: `path.replaceWith` はできるが `path.node.replaceWith` はできない。置換・削除は必ず `path` 経由で行う。
- **`path.evaluate()` の confident を確認しない**: `confident` が false のときの `value` は信用できない。必ず `confident` を確認してから置換する。
- **デコーダを素朴に eval してしまう**: 解析対象を無防備に実行すると悪性コードが走る。必ず隔離 VM（vm / vm2 / isolated-vm）を使う。
- **1パスで終わると思い込む**: 難読化は多層。定数伝播と畳み込みは互いを呼ぶので、変化がなくなるまで繰り返す必要がある。
- **CFF から手を付ける**: 制御フロー平坦化の上に文字列難読化が乗っていると、ディスパッチャすら読めない。文字列復号を先に済ませる。
- **原典の逐語を持っていない**: 本節は二次情報ベースで、hackmag 記事固有のサンプルコードは欠落している。実装の細部は 📌 ブロックで挙げた資料を自分で開いて補うこと。

---

## この節のまとめ

- 難読化は振る舞いを保つ可逆な変換の積み重ねなので、逆変換を機械的に適用すれば解析可能なレベルまで戻せる。
- デオブフスケータは「Parse → Transform/Traverse → Generate」の3段構成で、実装は Babel（`@babel/parser` / `@babel/traverse` / `@babel/generator` / `@babel/types`）が定番。
- 書き換えは visitor パターン。ノード型をキーに関数を登録し、`path` 経由で `replaceWith` / `remove` / `evaluate` などを使う。
- `path` はノードをラップし、親・スコープ・置換手段を保持する。ノードだけでは差し替えられない。
- 代表的な逆変換は、文字列連結の定数畳み込み、定数変数のインライン展開（constant propagation）、string-array の復号、デッドコード除去、制御フロー平坦化の復元。
- 定数伝播は `path.scope.getBinding(name)` の `constant` と `referencePaths` が中核 API。
- string-array は抽出・エンコード（none/base64/RC4）・回転・shuffle・calls transform の多層構造。回転 IIFE を実行して順序を確定し、デコーダを隔離実行して実値に置換する。
- 制御フロー平坦化は「状態変数 + while(true) + switch」のディスパッチャ形。状態遷移を静的に復元して逐次・分岐構造へ戻す。
- デオブフスケーションは部分評価に類似し、静的に確定する部分を先に計算して畳み込む。
- 対象コードを実行して結果を得る処理は、悪性コード対策として必ず隔離 VM（vm / vm2 / isolated-vm）で行う。素朴な eval は禁止。
- visitor を書く前に AstExplorer.net で AST を可視化して狙うノード型を特定するのが定石。
- 難読化は多層なので、変化がなくなるまで visitor 群を反復適用（fixpoint）する。CFF は他の層を剥がしてから着手する。
- 既製ツール（js-deobfuscator, webcrack, deobfuscate-js, JStillery など）を土台にし、対応外の層だけ自作 visitor で補うのが実務的。

---

## 理解度チェック

1. デオブフスケータの3段構成を順に答えよ。それぞれで使う Babel パッケージも挙げよ。
   ▶ 答え: ① Parse（`@babel/parser`）、② Transform/Traverse（`@babel/traverse`）、③ Generate（`@babel/generator`）。ノード生成・判定には `@babel/types` を補助的に使う。

2. visitor のコールバックに渡される `path` は、ノードそのものと何が違うのか。
   ▶ 答え: `path` はノードをラップし、親ノード・スコープ・自身を置換する方法（`replaceWith` / `remove` など）を保持する。ノード（`path.node`）だけでは木の中で自分を差し替えられないため、置換・削除は必ず `path` 経由で行う。

3. 定数変数のインライン展開で、その変数が定数か、どこから参照されているかを知るために使う API は何か。
   ▶ 答え: `path.scope.getBinding(name)`。返り値の `binding.constant` で定数かを、`binding.referencePaths` で全参照を得る。

4. `javascript-obfuscator` の string-array に重なる層を3つ以上挙げよ。
   ▶ 答え: 文字列の抽出（1つの配列に集約）、エンコード（none / base64 / RC4）、回転（rotate/shift の IIFE）、shuffle、calls transform / index shift。このうち3つ以上。

5. デコーダ関数を評価して文字列を復元する際、なぜ素朴な `eval` を使ってはいけないのか。どうすべきか。
   ▶ 答え: 解析対象には悪性コードや副作用が含まれうるため、素朴に実行すると攻撃コードが解析者のマシンで走る。必ず隔離 VM（vm / vm2 / isolated-vm）でサンドボックス実行する。

6. 制御フロー平坦化（CFF）の switch ベース実装は、どの3要素で構成されるか。
   ▶ 答え: 状態変数（state）、無限ループ（`while(true)`）、`switch(state)`。各 case の末尾で state に代入して次に実行するブロックを決める。

7. CFF を解除するとき、なぜ先に文字列復号などの他の層を剥がすのか。
   ▶ 答え: CFF の上に文字列難読化が乗っていると、ディスパッチャ（switch/while/state）自体が読めず、状態遷移を復元できないため。

8. `path.evaluate()` の戻り値で必ず確認すべきフィールドは何か。なぜか。
   ▶ 答え: `confident`。真のときだけ `value` が信用でき、Babel が静的評価に確信を持っている。false のときの `value` を使って置換してはいけない。

9. visitor を書き始める前に AST を確認するために使う定番ツールは何か。
   ▶ 答え: AstExplorer.net。コードを貼り付けて AST を可視化し、狙うノード型・構造を特定してから visitor を書く。

10. 1パスで難読化が解けないのはなぜか。実務上どうするか。
    ▶ 答え: 難読化は多層で、定数伝播と定数畳み込みは互いを新たに可能にするなど、1回では消えない層があるため。変化がなくなるまで visitor 群を反復適用（fixpoint）する。

---

## 出典

- https://hackmag.com/coding/js-deobfuscation （原典・取得不能）
- https://steakenthusiast.github.io/2022/05/21/Deobfuscating-Javascript-via-AST-An-Introduction-to-Babel/
- https://steakenthusiast.github.io/2022/05/28/Deobfuscating-Javascript-via-AST-Manipulation-Constant-Folding/
- https://www.trickster.dev/post/javascript-ast-manipulation-with-babel-the-first-steps/
- https://www.trickster.dev/post/javascript-ast-manipulation-with-babel-defeating-string-array-mapping/
- https://www.trickster.dev/post/javascript-ast-manipulation-with-babel-reducing-nestedness-unflattening-the-cfg/
- https://blag.nullteilerfrei.de/2026/01/18/use-babel-to-deobfuscate-javascript-malware/
- https://github.com/kuizuo/js-deobfuscator
- https://github.com/mindedsecurity/JStillery
- https://blog.mindedsecurity.com/2015/10/advanced-js-deobfuscation-via-ast-and.html
- https://github.com/defuscator/awesome-javascript-deobfuscation
- https://www.npmjs.com/package/javascript-obfuscator
- https://github.com/javascript-obfuscator/javascript-obfuscator/blob/master/README.md
- https://deepwiki.com/javascript-obfuscator/javascript-obfuscator/8.1-string-array-system
- https://deepwiki.com/javascript-obfuscator/javascript-obfuscator/10.3-string-array-helpers
- https://github.com/pljeroen/deobfuscate-js
- https://webcrack.netlify.app/docs/concepts/deobfuscate.html
- https://klaroskope.com/learn/javascript-string-array-deobfuscation
- https://blog.crawlex.net/blog/control-flow-flattening-string-encryption/
- https://eybisi.run/Control-Flow-Unflattening/
- https://blog.jscrambler.com/jscrambler-101-control-flow-flattening
- https://github.com/sophoslabs/emotet_unflatten_poc
- https://smsf.cs.arizona.edu/~debray/Publications/unflatten.pdf

<!-- sources: https://hackmag.com/coding/js-deobfuscation, https://steakenthusiast.github.io/2022/05/21/Deobfuscating-Javascript-via-AST-An-Introduction-to-Babel/, https://www.trickster.dev/post/javascript-ast-manipulation-with-babel-defeating-string-array-mapping/, https://www.trickster.dev/post/javascript-ast-manipulation-with-babel-reducing-nestedness-unflattening-the-cfg/, https://github.com/kuizuo/js-deobfuscator, https://github.com/javascript-obfuscator/javascript-obfuscator/blob/master/README.md, https://deepwiki.com/javascript-obfuscator/javascript-obfuscator/8.1-string-array-system, https://github.com/pljeroen/deobfuscate-js, https://webcrack.netlify.app/docs/concepts/deobfuscate.html, https://blog.mindedsecurity.com/2015/10/advanced-js-deobfuscation-via-ast-and.html, https://eybisi.run/Control-Flow-Unflattening/, https://smsf.cs.arizona.edu/~debray/Publications/unflatten.pdf -->
<!-- terms: 難読化（obfuscation）, デオブフスケーション（難読化解除）, AST（抽象構文木）, Babel, visitor パターン, path オブジェクト, 定数畳み込み（constant folding）, 定数伝播（constant propagation）, string-array（文字列配列）, 回転 IIFE, 制御フロー平坦化（Control Flow Flattening, CFF）, ディスパッチャ, 部分評価（partial evaluation）, 隔離 VM（サンドボックス）, AstExplorer, RC4, webcrack, fixpoint（不動点） -->
<!-- self-read: https://hackmag.com/coding/js-deobfuscation | サイト側の egress ポリシーで CONNECT 403 拒否。archive.org ミラーも拒否。原典逐語取得不能 -->
<!-- self-read: https://www.trickster.dev/post/javascript-ast-manipulation-with-babel-reducing-nestedness-unflattening-the-cfg/ | trickster.dev ドメインが egress プロキシでブロック。検索スニペットのみ -->
