# WebAssembly テキスト形式（WAT）の読解と WABT による wasm 解析（前編）

> **この節で分かること**
> - WebAssembly のテキスト形式（WAT）がなぜ存在し、`.wasm` を解析するとき何を読み取ればよいかを説明できる。
> - S 式・module・関数・スタックマシン・線形メモリ・テーブルという WAT の基本構造を、コードを見て読み解ける。
> - import / export・線形メモリの offset/length 受け渡し・`call_indirect` が、クライアントサイド脆弱性ハンティングで「どこを見るべき攻撃面か」を判断できる。
> - WABT（`wat2wasm` / `wasm2wat` / `wasm-objdump` / `wasm-interp` など）を使って `.wasm` を読める形に戻し、構造を把握する診断ワークフローを自分で実行できる。
> - 各ツールのオプションと、読めない `.wasm` に出会ったときの `--enable-all` のような定石を使い分けられる。

**元資料**:
- https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format
- https://github.com/WebAssembly/wabt

（いずれも割り当てられた原典 URL はネットワーク遮断で自動取得できず、**同一の正規ソース**〔MDN は `mdn/content` リポジトリの生成元 Markdown、WABT は `raw.githubusercontent.com` 上の README / `man/*.1` / `CMakeLists.txt`〕から逐語取得した。本文・コード例・オプション表はすべて原典と同一内容である。）

**関連する節**: `wasm-decompile` の出力言語の設計・実装・命名/演算子優先順位の詳細、および WAT の正式文法（全命令リスト）は本節の後編（同ノートの後半パート）で扱う。本節は WAT の読み方と WABT の使い方までを担当する。

---

## 1. なぜ WAT を読むのか — テキスト形式の位置づけ

### WebAssembly とテキスト形式（WAT）とは

WebAssembly（略称 Wasm）とは、ブラウザやサーバの中で高速に動く**低レベルのバイナリ命令フォーマット**のこと。C/C++/Rust などをコンパイルして得られる `.wasm` ファイルが、JavaScript から呼び出されて動く。たとえば画像処理・暗号・ゲームエンジンのような重い処理を JS より速く回すために使われる。

その `.wasm` は生のバイト列なので、人間はそのままでは読めない。そこで **Wasm バイナリ形式には、人間が読み書き・編集できるテキスト表現が用意されている**。これが**テキスト形式（WebAssembly text format, 通称 WAT / `.wat`）**である。WAT は、テキストエディタ・ブラウザの開発者ツール（DevTools）・および類似の環境で表示されることを想定した中間形式だ。

原文（MDN）は次のように注記している（逐語訳）。

> これは、Wasm モジュールをページに読み込んでコード内で使いたいだけの Web 開発者にとってはおそらく過剰である。たとえば JavaScript ライブラリの性能を最適化するために Wasm モジュールを書きたい場合や、自分自身の WebAssembly コンパイラを作りたい場合には、より有用である。

### バグハンティングでこの形式が重要になる理由

「テキスト形式は開発者ツールに表示されることを前提にした形式である」という点が、そのまま診断の武器になる。ブラウザの DevTools が `.wasm` を人間が読める形で見せてくれるのは、まさにこの WAT だ。つまり**攻撃対象のページが読み込んでいる `.wasm` は、後述の `wasm2wat` を使えば同じ WAT に戻せる**。

本節の目的は、その戻した WAT を読んで「この module は外界とどこで接しているか（攻撃面）」「線形メモリのどこが危ういか」を自力で判断できるようになることだ。以降は、WAT の骨格（module → 関数 → 命令）を順に組み立てながら、各要素が**設計上なぜそうなっているか → どう動くか → 攻撃者はどこを突くか → どう守るか**の順で見ていく。

> ### 📌 ここは自分で開いて読んでください
> **資料**: WebAssembly テキスト形式の理解（MDN Web Docs）— https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `developer.mozilla.org` が組織の egress プロキシで遮断され、`curl` も `CONNECT tunnel failed, response 403` になった）。以下の記述は、このページの生成元である `mdn/content` リポジトリの Markdown（同一内容、931 行を逐語取得）にもとづく要約である。
> **読みどころ**:
> 1. 「S-expressions」〜「Stack machines」の 4 節。WAT の文法とスタックマシンの検証規則。ここを理解していないと `wasm2wat` の出力が読めない。
> 2. 「WebAssembly Memory」節。特に `data` セクションと offset/length の受け渡し。Wasm ↔ JS の文字列受け渡しの標準形であり、over-read バグの温床。`Memory.grow()` による `ArrayBuffer` の detach の説明も読む。
> 3. 「Multiple memories」節。MDN 自身が意図的な長さ不一致（`;; string length 20 - overruns the length of the data for illustration`）を書いており、over-read の最小再現例として最良。
> 4. 「WebAssembly tables」節（`call_indirect`）。「`anyfunc` を線形メモリに置けないのはセキュリティ上の理由」という設計理由の説明。
> **代替手段**: 同内容の Markdown ソースが `https://raw.githubusercontent.com/mdn/content/main/files/en-us/webassembly/guides/understanding_the_text_format/index.md` にある（`developer.mozilla.org` が開けない環境ではこれを読む）。

---

## 2. S 式と module — WAT の骨格とマジックバイト

### コードの基本単位は module

バイナリ形式でもテキスト形式でも、**WebAssembly におけるコードの基本単位は module（モジュール）** である。module とは、Wasm の 1 つのプログラム単位のこと。JS からは 1 つの `.wasm` ファイルが 1 つの module に対応すると考えてよい。

テキスト形式では、module 全体が **1 個の大きな S 式（S-expression）** として表現される。S 式とは、木構造を表現するための古く単純なテキスト形式のこと。丸括弧 `( ... )` を入れ子にして木を書く記法で、たとえば Lisp で使われる。したがって module は「module の構造とコードを記述するノードの木」と考えられる。

ただしプログラミング言語の抽象構文木（AST, Abstract Syntax Tree = プログラムの構造を木で表したもの）とは異なり、**WebAssembly の木はかなり平坦（fairly flat）で、その大部分は命令のリストで構成されている**。深い入れ子ではなく、命令が縦に並んだ列だと思えばよい。

### ノードの書き方

木の各ノードは丸括弧のペア `( ... )` の内側に入る。括弧内の**最初のラベルがそのノードの種類**を示し、その後にスペース区切りで属性または子ノードのリストが続く。

```wat
(module (memory 1) (func))
```

これは、ルートノード "module" と 2 個の子ノードからなる木を表す。子ノードは、属性 "1" を持つ "memory" ノードと、"func" ノードである。

### 最も単純な module とマジックバイト

最も単純で最も短い Wasm module は、空の module だ。

```wat
(module)
```

この module は空だが、それでも**妥当な（valid）module** である。妥当とは、後述の検証（validation）規則に違反していない状態のこと。

これをバイナリに変換すると、**8 バイトの module ヘッダ**だけが現れる。

```plain
0000000: 0061 736d              ; WASM_BINARY_MAGIC
0000004: 0100 0000              ; WASM_BINARY_VERSION
```

この 8 バイトは非常に実用的だ。先頭 4 バイト `00 61 73 6d`（ASCII で `\0asm`）が Wasm のマジックナンバー（ファイル種別を示す固定の目印）で、続く 4 バイト `01 00 00 00` がバージョンを表す。

〔補足〕この 8 バイトは、ネットワークトラフィックやレスポンスボディから Wasm バイナリを識別するためのマジックとして実務でそのまま使える。たとえばプロキシで捕まえたバイナリの先頭が `00 61 73 6d` なら、それは `.wasm` だと判断してよい。

---

## 3. 関数・署名・ローカル変数・スタックマシン

### 関数の構造

WebAssembly module 内の全コードは**関数（function）**にグループ化される。関数は以下の疑似コード構造を持つ。

```wat
( func <signature> <locals> <body> )
```

- **signature（署名）** は、関数が何を受け取る（パラメータ）か、何を返す（戻り値）かを宣言する。
- **locals（ローカル変数）** は JavaScript の `var` のようなものだが、**型が明示的に宣言される**。
- **body（本体）** は、低レベル命令の単なる線形リストである。

### 署名とパラメータ

署名は「パラメータ型宣言の列」に続いて「戻り値型宣言のリスト」が並ぶ。要点は次のとおり。

- `(result)` が無いことは、その関数が何も返さないことを意味する。
- 現行では**戻り値型は最大 1 個**だが、後の multi-value 提案で任意個に緩和される（第 10 節）。

各パラメータは型が明示宣言される。Wasm の数値型（number types）は次の 4 つである。

| 型 | 意味 |
| --- | --- |
| `i32` | 32-bit integer（32 ビット整数） |
| `i64` | 64-bit integer（64 ビット整数） |
| `f32` | 32-bit float（32 ビット浮動小数点数） |
| `f64` | 64-bit float（64 ビット浮動小数点数） |

単一のパラメータは `(param i32)`、戻り値型は `(result i32)` と書く。「2 個の 32 ビット整数を取り 64 ビット浮動小数点数を返す関数」は次のようになる。

```wat
(func (param i32) (param i32) (result f64) ...)
```

署名の後に locals が型付きで並ぶ（例: `(local i32)`）。**パラメータは本質的に、呼び出し側が渡した引数の値で初期化された locals にすぎない。**

### locals とパラメータの取得・設定

locals / パラメータは、関数本体から `local.get` と `local.set` 命令で読み書きできる。参照は**数値インデックス**で行い、順序は「まずパラメータが宣言順に並び、続いて locals が宣言順に並ぶ」。

```wat
(func (param i32) (param f32) (local f64)
  local.get 0
  local.get 1
  local.get 2
)
```

`local.get 0` は i32 パラメータ、`local.get 1` は f32 パラメータ、`local.get 2` は f64 の local を取得する。

数値インデックスは分かりにくいので、**ドル記号 `$` を前置した名前**をパラメータ・locals などに付けられる（型宣言の直前に置く）。

```wat
(func (param $p1 i32) (param $p2 f32) (local $loc f64) …)
```

こうすると `local.get 0` の代わりに `local.get $p1` と書ける。**ただしこのテキストがバイナリに変換されると、バイナリには整数しか含まれない**という点が重要だ。名前 `$p1` は消え、`0` だけが残る。

〔補足〕この「名前はバイナリに残らない」性質が、実務で `.wasm` を読むときの最大の障壁になる。名前が残るのは name セクション（後述の `wat2wasm --debug-names` / `wasm2wat --no-debug-names` / `wasm-strip` が関わる領域）だけである。逆に言えば、name セクションが残っている `.wasm` は関数名・変数名が読めるので解析が一気に楽になる。

### スタックマシン

関数本体を書く前に、もう 1 つ重要な概念がある。**スタックマシン**だ。スタックとは「後に入れたものを先に取り出す（LIFO）」データ構造のこと。ブラウザは実際にはこれをより効率的な機械語にコンパイルするが、**Wasm の実行はスタックマシンとして定義されている**。

基本的な考え方は「あらゆる種類の命令が、一定個数の `i32`/`i64`/`f32`/`f64` 値をスタックに push（積む）、および/または スタックから pop（取り出す）する」である。

- `local.get` は「読み取った local の値をスタックに push する」と定義される。
- `i32.add` は「2 個の `i32` 値を pop し（暗黙に、直前に push された 2 個の値を取る）、その和を 2^32 を法として計算し、結果の i32 値を push する」と定義される。

関数が呼ばれると**空のスタック**から始まり、本体の命令が実行されるにつれて満たされ、また空になっていく。

```wat
(func (param $p i32)
  (result i32)
  local.get $p
  local.get $p
  i32.add
)
```

これを実行した後、スタックにはちょうど 1 個の `i32` 値、すなわち `($p + $p)` の結果が入っている。**関数の戻り値は、スタックに最後に残った値そのものである。**

### 最初の関数本体

まとめると、2 個のパラメータを足して返す関数は次のように書ける。

```wat
(module
  (func (param $lhs i32) (param $rhs i32) (result i32)
    local.get $lhs
    local.get $rhs
    i32.add
  )
)
```

利用可能なオペコード（命令）の完全なリストは、仕様の semantics reference（後述の出典）を参照。MDN のページ自身が「全命令の網羅的リストは含んでいない」と明記している点に注意（正確な意味を確かめるときは仕様を引く）。

---

## 4. 検証規則（validation）— 型とスタックの静的チェック

### なぜ検証があるのか

Wasm は「信頼できない `.wasm` をブラウザで安全に実行する」ことを目的に設計されている。そのため、実行前に module 全体が**検証（validation）**を通る。検証とは、実行せずに静的（コードを読むだけ）で型やスタックの整合性を確認する工程のこと。

**WebAssembly の検証規則は、スタックが厳密に一致することを保証する。** 具体的には、`(result f32)` を宣言したなら、関数の終了時にスタックにはちょうど 1 個の `f32` が入っていなければならない。result 型が無いなら、スタックは空でなければならない。型や個数が合わなければ、その module はロード時に拒否される。

### 攻撃者視点での意味

この静的検証があるため、「型が食い違う関数を無理やり呼ぶ」「スタックを壊して任意コードに飛ぶ」といった**バイナリ改変による古典的攻撃は、検証を通らず弾かれる**。したがって攻撃面は「検証を通ってしまう正当な module の中の論理・境界の緩さ」に移る。以降の節で見る線形メモリの offset/length や `call_indirect` のインデックスが、まさにその「検証を通るが危うい」部分だ。

---

## 5. 関数呼び出しと JavaScript 相互運用（import / export / global）

### 同一 module 内の他の関数を呼ぶ

`call` 命令は、**インデックスまたは名前**で指定された単一の関数を呼び出す。次の module には 2 個の関数があり、1 つは `42` を返し、もう 1 つはその結果に 1 を足して返す。

```wat
(module
  (func $getAnswer (result i32)
    i32.const 42
  )
  (func (export "getAnswerPlus1") (result i32)
    call $getAnswer
    i32.const 1
    i32.add
  )
)
```

`i32.const` は 32 ビット整数を定義してスタックに push する命令だ。`(export "getAnswerPlus1")` は「この関数をエクスポートしたい」ことと「エクスポート名」を宣言する短縮記法で、次と機能的に等価である。

```wat
(export "getAnswerPlus1" (func $functionName))
```

呼び出す JavaScript は次のとおり。

```js
WebAssembly.instantiateStreaming(fetch("call.wasm")).then((obj) => {
  console.log(obj.instance.exports.getAnswerPlus1()); // "43"
});
```

### export — JS から Wasm を駆動する入口

ES module と同様、**Wasm の関数は module 内の `export` 文で明示的にエクスポートしなければならない**。エクスポート宣言は次の形。

```wat
(export "add" (func $add))
```

ここで `add` は **JavaScript 側でその関数が識別される名前**、`$add` は **module 内のどの Wasm 関数がエクスポートされるか**を指す。JS からは `instance.exports.add(...)` で呼べる。

```wat
(module
  (func $add (param $lhs i32) (param $rhs i32) (result i32)
    local.get $lhs
    local.get $rhs
    i32.add
  )
  (export "add" (func $add))
)
```

```js
WebAssembly.instantiateStreaming(fetch("add.wasm")).then((obj) => {
  console.log(obj.instance.exports.add(1, 2)); // "3"
});
```

### import — Wasm から外界（JS）を呼ぶ入口

WebAssembly には JavaScript に関する組み込みの知識は一切ないが、**JavaScript 関数でも Wasm 関数でも受け取れる汎用のインポート機構**を持つ。

```wat
(module
  (import "console" "log" (func $log (param i32)))
  (func (export "logIt")
    i32.const 13
    call $log
  )
)
```

**WebAssembly は 2 階層の名前空間（two-level namespace）を持つ**。ここでの import 文は `console` module から `log` 関数をインポートしている。2 階層とは「グループ名（`console`）」＋「メンバ名（`log`）」の 2 段構えのこと。

インポートされた関数は通常の関数と全く同様で、**署名を持ち、WebAssembly の検証がそれを静的に検査し、インデックスが与えられ、名前で呼べる。** ただし重要な非対称性がある。**JavaScript 関数には署名の概念がないため、import が宣言した署名に関係なく、任意の JS 関数を渡せる。**

module が import を宣言したら、`WebAssembly.instantiate()` の呼び出し側は、対応するプロパティを持つ import オブジェクトを渡さなければならない。上の import は `importObject.console.log` が JS 関数であるオブジェクトを要求する。

```js
const importObject = {
  console: {
    log(arg) {
      console.log(arg);
    },
  },
};

WebAssembly.instantiateStreaming(fetch("logger.wasm"), importObject).then(
  (obj) => {
    obj.instance.exports.logIt();
  },
);
```

### 攻撃面としての import / export

ここが診断の要点だ。**インポートされた関数が、Wasm 側から見えるすべての外界**である。Wasm は JS のグローバルにも DOM にも勝手に触れず、渡された import 関数を通してしか外に働きかけられない。したがって:

- **`.wasm` の import セクションは、その module の攻撃面（外界とのインターフェース）の完全な一覧**になる。何を JS に頼っているかがここで分かる。
- **export セクションは、JS 側から Wasm を駆動できる入口の完全な一覧**になる。攻撃者制御の入力がどの関数に届くかを追う起点になる。

`wasm-objdump -x`（第 14〜15 節）でこの両方をまとめて列挙できる。

### グローバル変数

WebAssembly は**グローバル変数インスタンス**を作れる。これは JavaScript からもアクセス可能で、1 個以上の `WebAssembly.Module` インスタンス間でインポート/エクスポートでき、**複数 module の動的リンクを可能にする**。

```wat
(module
  (global $g (import "js" "global") (mut i32))
  (func (export "getGlobal") (result i32)
    (global.get $g)
  )
  (func (export "incGlobal")
    (global.set $g (i32.add (global.get $g) (i32.const 1)))
  )
)
```

`global` キーワードでグローバル値を指定し、**可変にしたい場合は値のデータ型とともに `mut` キーワードを指定する**。JS 側では `WebAssembly.Global()` コンストラクタで等価な値を作る。

```js
const global = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: WABT — The WebAssembly Binary Toolkit（GitHub リポジトリ）— https://github.com/WebAssembly/wabt
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: GitHub の HTML ページが HTTP 503、`api.github.com` の contents API が空応答、GitHub MCP がリポジトリ許可外）。以下の記述は、`raw.githubusercontent.com` から直接取得した同一内容の README / `man/*.1` / `CMakeLists.txt` / `wasm2c/README.md` にもとづく。
> **読みどころ**:
> 1. README 冒頭のツール一覧。11 個のツールと 1 行説明。各エントリが `https://webassembly.github.io/wabt/doc/<tool>.1.html` の man ページにリンクしている。
> 2. "Supported Proposals" の表。解析対象の `.wasm` が読めないときに、どの `--enable-*` / `--disable-*` フラグを足すべきかを決める一覧。`interpret` 列と `wasm2c` 列が空の提案は、そのツールでは扱えない。
> 3. `wasm2c/README.md`（README からリンク）。`wasm_rt_trap_t` の trap 種別、`wasm_rt_memory_t` の構造、embedder が実装すべき `wasm_rt_*` 関数群の契約。Wasm を組み込むネイティブアプリの脅威モデルを理解するのに最も有用。
> 4. "Sanitizers" と "Fuzzing" の節。wabt 自身が ASAN/MSAN/LSAN/UBSAN と libFuzzer/oss-fuzz でテストされている。
> **代替手段**: README 相当の内容は `https://raw.githubusercontent.com/WebAssembly/wabt/HEAD/README.md`、各 man ページは `https://raw.githubusercontent.com/WebAssembly/wabt/HEAD/man/<tool>.1` から取得できる。インストールは `brew install wabt` / `sudo apt install wabt`。

---

## 6. 線形メモリ（linear memory）と data セクション

### 線形メモリとは

文字列やその他の複雑なデータ型を扱うには `memory` を使う。**WebAssembly における `memory` とは、時間とともに拡張できる、大きな連続した可変の生バイト配列（a large contiguous, mutable array of raw bytes that can grow over time）にすぎない**。これを線形メモリ（linear memory）と呼ぶ。「線形」とは、0 番地から順に一直線に並んだアドレス空間という意味だ。

WebAssembly は memory 命令、たとえば `i32.load`（メモリから値を読む）や `i32.store`（メモリに値を書く）を持ち、スタックと memory の任意の位置の間でバイトを読み書きする。

JavaScript の視点では、memory はすべてが 1 個の大きな拡張可能な `ArrayBuffer` の中にあるかのように見える。`ArrayBuffer` とは、JS で生のバイト列を保持するオブジェクトのこと。JS は `WebAssembly.Memory()` インターフェースで線形メモリインスタンスを作れるし、Wasm 側が作ってエクスポートした memory にアクセスすることもできる。`Memory` インスタンスの `buffer` ゲッタは、**線形メモリ全体を指す `ArrayBuffer`** を返す。

### grow と ArrayBuffer の detach

memory インスタンスは拡張できる（JS では `Memory.grow()`、Wasm では `memory.grow`）。ここに落とし穴がある。`ArrayBuffer` オブジェクトはサイズを変更できないため、**現在の `ArrayBuffer` は detach（切り離し）され、より大きい新しいメモリを指す新しい `ArrayBuffer` が作られる**。

memory を作るときは初期サイズを定義し、拡張可能な最大サイズを任意で指定できる。**このメソッドが失敗するのは _初期_ サイズを確保できない場合のみ**である。

〔補足〕`ArrayBuffer` が detach されるという性質は、実際のバグを生む。JS 側で `new Uint8Array(memory.buffer)` をキャッシュしているコードは、`memory.grow` の後に**古い（detached な）ビューを参照してしまう**。`memory.grow` を跨いでビューを再取得しないコードは要注意箇所である。

### data セクションで文字列を書き込む

この例では JS 側で 1 ページの memory を作り、Wasm にインポートする。

```js
const memory = new WebAssembly.Memory({ initial: 1 });

const importObject = {
  js: { mem: memory },
};

WebAssembly.instantiateStreaming(
  fetch("the_wasm_to_import.wasm"),
  importObject,
).then((obj) => {
  // Call exported functions ...
});
```

Wasm 側では、この memory を同じ 2 階層キー（`js.mem`）でインポートする。

```wat
(import "js" "mem" (memory 1))
```

`1` は「インポートされる memory が少なくとも 1 ページの memory を持たなければならない」ことを示す。**WebAssembly は現在 1 ページを 64KB（65536 バイト）と定義している。** これは最初にインポートされる memory なので memory インデックスは `0` になり、単一 memory では省略できる。

memory に文字列 "Hi" を書き込むには **`data` セクション**を使う。**data セクションは、インスタンス化時に指定されたオフセットにバイト列を書き込むことを可能にし、ネイティブ実行形式の `.data` セクションに似ている。**

```wat
(module
  (import "js" "mem" (memory 1))
  ;; ...
  (data (i32.const 0) "Hi")
  ;;
)
```

`;;`（二重セミコロン）は WAT のコメントを示す。最終的な module は次のようになる。

```wat
(module
  (import "console" "log" (func $log (param i32 i32)))
  (import "js" "mem" (memory 1))
  (data (i32.const 0) "Hi")
  (func (export "writeHi")
    i32.const 0  ;; pass offset 0 to log
    i32.const 2  ;; pass length 2 to log
    call $log
  )
)
```

### offset + length を JS に渡すパターンが over-read の温床

JS 側の完全なコードはこうなる。

```js
const memory = new WebAssembly.Memory({ initial: 1 });

// Logging function ($log) called from WebAssembly
function consoleLogString(offset, length) {
  const bytes = new Uint8Array(memory.buffer, offset, length);
  const string = new TextDecoder("utf8").decode(bytes);
  console.log(string);
}

const importObject = {
  console: { log: consoleLogString },
  js: { mem: memory },
};

WebAssembly.instantiateStreaming(fetch("logger2.wasm"), importObject).then(
  (obj) => {
    // Call the function exported from logger2.wasm
    obj.instance.exports.writeHi();
  },
);
```

ロギング関数 `consoleLogString()` は、渡されたオフセットと長さで、共有 memory 上の文字列に対する `Uint8Array` のビューを作り、`TextDecoder` で UTF-8 からデコードする。

〔補足〕この「offset + length を JS に渡し、JS 側が `new Uint8Array(memory.buffer, offset, length)` でビューを作る」パターンが、Wasm ↔ JS 境界で最も一般的な文字列受け渡しである。**JS 側が offset/length を検証しない実装では、Wasm 側（あるいは Wasm を駆動する攻撃者制御入力）から、線形メモリ内の意図しない領域を読み出させる**ことができる。これが over-read（読み過ぎ）であり、次節でその最小再現例を見る。

---

## 7. 複数メモリと over-read（情報漏洩の最小再現）

### 複数メモリ

より新しい実装では、WebAssembly と JavaScript で複数の memory オブジェクトを使える。複数 memory は、公開データ vs 非公開データ、永続化が必要なデータ、スレッド間で共有するデータのように、**扱いを分けるべきデータを分離する**のに有用だ。

Wasm から使える memory には、**0 始まりで順に割り当てられる memory インデックス番号**が与えられる。すべての memory 命令（`load` や `store`）はインデックスで任意の memory を参照でき、デフォルトインデックスは 0 である。

なお wabt（例: `wat2wasm`）でテキストを Wasm に変換する場合、**multi-memory サポートはまだオプショナルなので `--enable-multi-memory` を渡す必要があるかもしれない**。

```wat
(module
  ;; ...

  (import "js" "mem0" (memory 1))
  (import "js" "mem1" (memory 1))

  ;; Create and export a third memory
  (memory $mem2 1)
  (export "memory2" (memory $mem2))

  ;; ...
)
```

`data` 命令で memory インデックスを指定して書き込み先を選べる。

```wat
  (data (memory 0) (i32.const 0) "Memory 0 data")
  (data (memory 1) (i32.const 0) "Memory 1 data")
  (data (memory 2) (i32.const 0) "Memory 2 data")

  ;; Add text to default (0-index) memory
  (data (i32.const 13) " (Default)")
```

### 意図的な長さ不一致が示す over-read

MDN の完全な例は、まさに「長さがデータより長い」ケースを意図的に含んでいる。

```wat
(module
  (import "console" "log" (func $log (param i32 i32 i32)))

  (import "js" "mem0" (memory 1))
  (import "js" "mem1" (memory 1))

  ;; Create and export a third memory
  (memory $mem2 1)
  (export "memory2" (memory $mem2))

  (data (memory 0) (i32.const 0) "Memory 0 data")
  (data (memory 1) (i32.const 0) "Memory 1 data")
  (data (memory 2) (i32.const 0) "Memory 2 data")

  ;; Add text to default (0-index) memory
  (data (i32.const 13) " (Default)")

  (func $logMemory (param $memIndex i32) (param $memOffSet i32) (param $stringLength i32)
    local.get $memIndex
    local.get $memOffSet
    local.get $stringLength
    call $log
  )

  (func (export "logAllMemory")
    ;; Log memory index 0, offset 0
    (i32.const 0)  ;; memory index 0
    (i32.const 0)  ;; memory offset 0
    (i32.const 23)  ;; string length 23
    (call $logMemory)

    ;; Log memory index 1, offset 0
    i32.const 1  ;; memory index 1
    i32.const 0  ;; memory offset 0
    i32.const 20  ;; string length 20 - overruns the length of the data for illustration
    call $logMemory

    ;; Log memory index 2, offset 0
    i32.const 2  ;; memory index 2
    i32.const 0  ;; memory offset 0
    i32.const 13  ;; string length 13
    call $logMemory
  )
)
```

JS 側は、memory インデックスに応じて正しい `Memory` を選び、`Uint8Array` でビューを作ってデコードする。

```js
const memory0 = new WebAssembly.Memory({ initial: 1 });
const memory1 = new WebAssembly.Memory({ initial: 1 });
let memory2; // Created by module

function consoleLogString(memoryInstance, offset, length) {
  let memory;
  switch (memoryInstance) {
    case 0:
      memory = memory0;
      break;
    case 1:
      memory = memory1;
      break;
    case 2:
      memory = memory2;
      break;
    // code block
  }
  const bytes = new Uint8Array(memory.buffer, offset, length);
  const string = new TextDecoder("utf8").decode(bytes);
  log(string); // implementation not shown - could call console.log()
}

const importObject = {
  console: { log: consoleLogString },
  js: { mem0: memory0, mem1: memory1 },
};

WebAssembly.instantiateStreaming(fetch("multi-memory.wasm"), importObject).then(
  (obj) => {
    // Get exported memory
    memory2 = obj.instance.exports.memory2;
    // Log memory
    obj.instance.exports.logAllMemory();
  },
);
```

出力は次のようになる。ただし **"Memory 1 data" には末尾にゴミ文字（trailing "rubbish characters"）が付くことがある。テキストデコーダに、文字列をエンコードするのに使われたよりも多いバイト数が渡されるためである。**

```plain
Memory 0 data (Default)
Memory 1 data
Memory 2 data
```

### 攻撃者はどこを突くか / どう守るか

この "rubbish characters" は、まさに**長さの取り違えによる隣接メモリ内容の漏洩（over-read）**の教科書的な最小再現例だ。MDN は説明のために意図的に `;; string length 20 - overruns the length of the data for illustration` と書いているが、実アプリで同じ形が出れば情報漏洩になり得る。

- **どこを突くか**: `length` が攻撃者の制御下にあり、かつ実データより長く指定できる箇所。`Uint8Array(memory.buffer, offset, length)` の `length` に検証が無ければ、線形メモリ内の隣接データ（他の文字列・鍵・ポインタ相当の値）まで読み出せる。
- **どう守るか**: JS 側で offset/length を「その data セグメントの実際の長さ」に対して検証する。ヌル終端に頼らず明示長を管理する。`wasm2wat` で戻した WAT を読むときは、`call $log` などに渡る length がどこ由来かを追うのが出発点になる。

---

## 8. テーブルと call_indirect（動的呼び出しの安全設計）

### なぜ table が必要か

`call` 命令は**静的な関数インデックス**を取るため、常に 1 個の関数しか呼べない。では呼び出し先が実行時に決まる場合は？ これは JavaScript の第一級関数、C/C++ の関数ポインタ、C++ の仮想関数として現れる。WebAssembly はこれを実現するため、**動的な関数オペランドを取る `call_indirect`** を用意した。

問題は、Wasm のオペランドに渡せる型が（現在）`i32`/`i64`/`f32`/`f64` だけだということ。関数そのものを直接渡せない。

### anyfunc を線形メモリに置けない — 設計上のセキュリティ判断

Wasm は `anyfunc` 型（任意署名の関数を保持できる型）を追加できたが、**この `anyfunc` 型はセキュリティ上の理由で線形メモリに格納できない**。理由は明快だ。**線形メモリは格納された値の生の内容をバイトとして露出する**ため、そこに関数を置くと、**Wasm のコンテンツが生の関数アドレスを任意に観測・破壊できてしまう。これは Web 上で許すことができない。**

解決策は**関数参照を table に格納し、代わりに table のインデックス（単なる i32 値）を受け渡す**ことだった。**table とは基本的に、Wasm コードからインデックスでアクセスできる、リサイズ可能な参照の配列**である。生アドレスは Wasm から見えず、Wasm が扱うのは「table の何番目か」という i32 だけになる。

〔補足〕この設計のおかげで、Wasm 内では「生の関数ポインタを線形メモリ経由で書き換える」古典的な制御フロー奪取が**そのままでは成立しない**。C/C++ をそのままコンパイルした場合の最大の防御ポイントの 1 つだ。一方で、`call_indirect` のターゲットが「攻撃者が制御できる i32 インデックス」なら、**table 内の任意の同一型関数へ処理を向けられる**（範囲外や型不一致は trap する）。さらに table は JS から `set()` で書き換えられるため、**table を握られた JS 側のバグは、Wasm 側の間接呼び出し先のすり替えになる**。

### Wasm で table を定義する

`data` セクションが線形メモリをバイトで初期化するのと同様に、**`elem` セクション**が table を関数で初期化する。

```wat
(module
  (table 2 funcref)
  (elem (i32.const 0) $f1 $f2)
  (func $f1 (result i32)
    i32.const 42)
  (func $f2 (result i32)
    i32.const 13)
  ...
)
```

- `(table 2 funcref)` の `2` は table の**初期サイズ**、`funcref` は要素型が関数参照であることを宣言する。
- `elem` セクションは、module 内の関数の**任意の部分集合を任意の順序で、重複ありで**列挙できる。
- `elem` 内の `(i32.const 0)` は**オフセット**で、table のどのインデックスから埋め始めるかを指定する。ここでは 0 なので、インデックス 0 と 1 に 2 個の参照を埋める。
- **初期化されていない要素には、呼び出すと throw するデフォルト値が与えられる**（Uninitialized elements are given a default throw-on-call value）。

JS で同等の table を作る場合はこうなる。

```js
function module() {
  // table section
  const tbl = new WebAssembly.Table({ initial: 2, element: "anyfunc" });

  // function sections:
  const f1 = () => 42; /* some imported WebAssembly function */
  const f2 = () => 13; /* some imported WebAssembly function */

  // elem section
  tbl.set(0, f1);
  tbl.set(1, f2);
}
```

### table を使う — call_indirect と型チェック

```wat
...
(type $return_i32 (func (result i32))) ;; if this was f32, type checking would fail
(func (export "callByIndex") (param $i i32) (result i32)
  local.get $i
  call_indirect (type $return_i32)
)
```

- `(type $return_i32 (func (result i32)))` は**参照名付きの型**を指定する。table の関数参照呼び出しの型チェックに使われる。
- `callByIndex` は `i32` の `$i` を取り、それをスタックに積み、`call_indirect` で table の `$i` 番目の関数を呼ぶ（`$i` は暗黙に pop される）。

パラメータは呼び出しコマンド内で明示宣言することもできる。

```wat
(call_indirect (type $return_i32) (local.get $i))
```

型チェックが要点だ。`funcref` は任意の関数署名を持ち得るので、**呼び出し箇所で呼び出し先の想定署名を供給しなければならない**。そのため `$return_i32` 型を含めて「`i32` を返す関数が期待される」と指定する。**呼び出し先が一致する署名を持たない場合（たとえば `f32` が返る場合）、`WebAssembly.RuntimeError` が throw される。**

`call_indirect` がどの table を呼ぶかは、**現在 module インスタンスあたり table は 1 個だけ許されており、`call_indirect` はそれを暗黙に呼んでいる**からである。将来複数 table が許されれば、`call_indirect $my_spicy_table (type $i32_to_void)` のように識別子を書く。

完全な module は次のとおり。

```wat
(module
  (table 2 funcref)
  (func $f1 (result i32)
    i32.const 42
  )
  (func $f2 (result i32)
    i32.const 13
  )
  (elem (i32.const 0) $f1 $f2)
  (type $return_i32 (func (result i32)))
  (func (export "callByIndex") (param $i i32) (result i32)
    local.get $i
    call_indirect (type $return_i32)
  )
)
```

JS から呼ぶと、範囲外インデックスはエラーになる。

```js
WebAssembly.instantiateStreaming(fetch("wasm-table.wasm")).then((obj) => {
  console.log(obj.instance.exports.callByIndex(0)); // returns 42
  console.log(obj.instance.exports.callByIndex(1)); // returns 13
  console.log(obj.instance.exports.callByIndex(2)); // returns an error, because there is no index position 2 in the table
});
```

---

## 9. table の変更と動的リンク（共有アドレス空間）

### JS から table を書き換えられる

**JavaScript は関数参照への完全なアクセスを持つため、Table オブジェクトは JS から `grow()`、`get()`、`set()` メソッドで変更できる。** また Wasm コード自身も、`table.get` や `table.set` などの命令（reference types の一部）で table を操作できる。

table は可変なので、**洗練されたロード時・実行時の動的リンク方式**を実装できる。プログラムが動的リンクされるとき、**複数のインスタンスが同じ memory と table を共有する**。これは、複数のコンパイル済み `.dll` が単一プロセスのアドレス空間を共有するネイティブアプリに似ている。

### 共有アドレス空間の例

`shared0.wat`:

```wat
(module
  (import "js" "memory" (memory 1))
  (import "js" "table" (table 1 funcref))
  (elem (i32.const 0) $shared0func)
  (func $shared0func (result i32)
    i32.const 0
    i32.load
  )
)
```

`shared1.wat`:

```wat
(module
  (import "js" "memory" (memory 1))
  (import "js" "table" (table 1 funcref))
  (type $void_to_i32 (func (result i32)))
  (func (export "doIt") (result i32)
   i32.const 0
   i32.const 42
   i32.store  ;; store 42 at address 0
   i32.const 0
   call_indirect (type $void_to_i32)
  )
)
```

動作はこうだ。`shared0func` は `shared0.wat` で定義され、インポートされた table に格納される。`shared1.wat` の `doIt` は `i32.store` で memory インデックス 0 に `42` を格納し、続いて table のインデックス 0 の関数（＝`shared0func`）を `call_indirect` で呼ぶ。呼ばれた `shared0func` は memory の 0 番地から値をロードして返すので、結果は `42` になる。

JS 側は両 module に同じ `memory` と `table` を渡す。

```js
const importObj = {
  js: {
    memory: new WebAssembly.Memory({ initial: 1 }),
    table: new WebAssembly.Table({ initial: 1, element: "anyfunc" }),
  },
};

Promise.all([
  WebAssembly.instantiateStreaming(fetch("shared0.wasm"), importObj),
  WebAssembly.instantiateStreaming(fetch("shared1.wasm"), importObj),
]).then((results) => {
  console.log(results[1].instance.exports.doIt()); // prints 42
});
```

コンパイルされる各 module は**同じ memory と table オブジェクトをインポートでき、したがって同じ線形メモリと table の「アドレス空間」を共有する**。

### 信頼境界への影響

〔補足〕「複数インスタンスが同じ memory / table を共有する」という動的リンクの形は、**あるインスタンスの境界チェックの緩さが他インスタンスのデータに波及する**構造を作る。共有 memory / 共有 table を import している module が複数ある場合、**それらは事実上ひとつの信頼境界内にある**と考えるべきだ。診断では、`import` に同じ `memory` / `table` が現れる module 群をまとめて 1 つの境界として扱う。

---

## 10. 型・バルクメモリ・スレッドなどの発展機能

### バルクメモリ操作

バルクメモリ操作は比較的新しい追加で、**7 個の新しい組み込み操作**が、コピーや初期化のために提供される。Wasm が `memcpy` や `memmove` のようなネイティブ関数を効率的にモデル化できるようにする。

| 操作 | 意味（原文の説明） |
| --- | --- |
| `data.drop` | Discard the data in a data segment.（data セグメントのデータを破棄する） |
| `elem.drop` | Discard the data in an element segment.（element セグメントのデータを破棄する） |
| `memory.copy` | Copy from one region of linear memory to another.（線形メモリのある領域から別の領域へコピー） |
| `memory.fill` | Fill a region of linear memory with a given byte value.（線形メモリの領域を指定バイト値で埋める） |
| `memory.init` | Copy a region from a data segment.（data セグメントから領域をコピー） |
| `table.copy` | Copy from one region of a table to another.（table のある領域から別の領域へコピー） |
| `table.init` | Copy a region from an element segment.（element セグメントから領域をコピー） |

〔補足〕`memory.copy` / `memory.fill` は WAT を読むときに**バッファ操作のホットスポット**になる。長さ引数の出自を追うことが、線形メモリ内のオーバーフロー（Wasm 内ヒープの破壊）を探す出発点になる。

### 数値型・ベクタ型・参照型

数値型（number types）は第 3 節の 4 種（`i32`/`i64`/`f32`/`f64`）。ベクタ型（vector types）は次の 1 種。

| 型 | 意味 |
| --- | --- |
| `v128` | 128-bit vector of packed integer, floating-point data, or a single 128-bit type. |

参照型（reference types）の提案は主に 2 機能を提供する。

- 新しい型 `externref`。**任意の JavaScript の値（文字列、DOM 参照、オブジェクトなど）を保持できる**。`externref` は Wasm の視点からは**不透明（opaque）**で、Wasm module はこれらの値にアクセス・操作できず、受け取って渡し返すことしかできない。それでも Wasm が JS 関数や DOM API を呼べるようにする上で有用。値型としても table の要素としても使える。
- Wasm module が JS API 経由でなく**直接 table を操作できる**いくつかの新命令。

〔補足〕`externref` は「Wasm が DOM 参照やオブジェクトを不透明に保持して JS に返す」チャネルである。Wasm 側で中身を改ざんはできないが、**Wasm を経由して DOM 参照が意図しない JS シンクへ回される**経路が作れる点は設計レビューで意識する価値がある。

### マルチバリュー

WebAssembly multi-value は、**関数が複数の値を返せるようになり、命令列が複数のスタック値を消費・生成できる**ことを意味する。MDN 執筆時点（**2020 年 6 月**）ではまだ初期段階だった。

```wat
(module
  (func $get_two_numbers (result i32 i32)
    i32.const 1
    i32.const 2
  )
  (func (export "add_two_numbers") (result i32)
    call $get_two_numbers
    i32.add
  )
)
```

### スレッド・共有メモリ・アトミック

WebAssembly Threads は、**JS の `SharedArrayBuffer` と同じやり方で、別々の Web Worker で実行される複数の Wasm インスタンス間で Memory オブジェクトを共有できる**ようにする。提案は **shared memories** と **atomic memory accesses** の 2 部からなる。

共有 memory は、`SharedArrayBuffer` と同様に `postMessage()` で Window と Worker の間を転送できる。JS では `WebAssembly.Memory()` の初期化オブジェクトに `shared: true` を加える。

```js
const memory = new WebAssembly.Memory({
  initial: 10,
  maximum: 100,
  shared: true,
});
```

この memory の `buffer` は `SharedArrayBuffer` を返す。

```js
memory.buffer; // returns SharedArrayBuffer
```

テキスト形式では `shared` キーワードで共有メモリを作る。

```wat
(memory 1 2 shared)
```

**共有メモリは、非共有メモリと異なり、JS のコンストラクタでも Wasm テキスト形式でも "maximum" サイズを指定しなければならない。**

〔補足〕`SharedArrayBuffer` が必要なため、共有メモリを使う Wasm アプリは **cross-origin isolation（COOP/COEP）**を要求する。COOP は `Cross-Origin-Opener-Policy`、COEP は `Cross-Origin-Embedder-Policy` という HTTP ヘッダで、これらが揃うとページが「クロスオリジン隔離」状態になり `SharedArrayBuffer` が使える。逆に言えば、**対象サイトがこの 2 ヘッダを送っていれば、Wasm threads を使っている可能性が高い**という当たりが付く。

---

## 11. WABT ツールチェーンの全体像と設計目標

ここからは、`.wasm` を読める形に戻し、構造を調べるための道具箱 **WABT（The WebAssembly Binary Toolkit、発音は "wabbit"）** を扱う。

### 11 個のツール

README のツール一覧を逐語で表にする。

| ツール | 説明（原文逐語） | 日本語 |
| --- | --- | --- |
| **wat2wasm** | translate from WebAssembly text format to the WebAssembly binary format | WAT → wasm バイナリ |
| **wasm2wat** | the inverse of wat2wasm, translate from the binary format back to the text format (also known as a .wat) | wasm バイナリ → WAT（解析の主力） |
| **wasm-objdump** | print information about a wasm binary. Similiar to objdump.（※原文の "Similiar" は原文のスペルのまま） | wasm バイナリの情報表示 |
| **wasm-interp** | decode and run a WebAssembly binary file using a stack-based interpreter | スタックベースインタプリタで実行 |
| **wat-desugar** | parse .wat text form as supported by the spec interpreter (s-expressions, flat syntax, or mixed) and print "canonical" flat format | WAT の正規化（folded ↔ flat） |
| **wasm2c** | convert a WebAssembly binary file to a C source and header | wasm → C ソース＋ヘッダ |
| **wasm-strip** | remove sections of a WebAssembly binary file | セクション削除 |
| **wasm-validate** | validate a file in the WebAssembly binary format | バイナリの検証 |
| **wast2json** | convert a file in the wasm spec test format to a JSON file and associated wasm binary files | spec test 形式 → JSON + wasm |
| **wasm-stats** | output stats for a module | module の統計出力 |
| **spectest-interp** | read a Spectest JSON file, and run its tests in the interpreter | Spectest JSON をインタプリタで実行 |

### 設計目標 — 1:1 ラウンドトリップ

README は WABT の位置づけをこう述べている（逐語訳）。

> これらのツールは、WebAssembly ファイルを操作したいツールチェーン（またはその開発）や他のシステムでの使用を意図している。WebAssembly の spec インタプリタ（可能な限り単純・宣言的で "speccy" に書かれている）とは異なり、これらは C/C++ で書かれ、他のシステムへの統合が容易になるよう設計されている。Binaryen とは異なり、これらのツールは**最適化プラットフォームや高水準のコンパイラターゲットを提供することを目指していない。代わりに仕様への完全な忠実性と準拠（たとえば命令に変更を加えない 1:1 のラウンドトリップ）を目指す**。

〔補足〕この「1:1 ラウンドトリップで命令を変えない」という設計目標が、**解析用途に wabt が適している最大の理由**である。Binaryen（`wasm-opt` 等）は最適化を行うため元のバイナリと出力が構造的に異なり得るが、wabt の `wasm2wat` は元の命令をそのまま WAT に写す。**「読んでいる WAT が元のバイナリと同じ挙動である」ことが保証されるので、解析の信頼性が高い。**

### オンラインデモ

wabt は emscripten 経由で JavaScript にコンパイルされており、以下のデモで一部機能が使える。

- index: `https://webassembly.github.io/wabt/demo/`
- wat2wasm: `https://webassembly.github.io/wabt/demo/wat2wasm/`
- wasm2wat: `https://webassembly.github.io/wabt/demo/wasm2wat/`

〔補足〕ローカルにビルドできない環境でも、ブラウザ上でこのデモを使って WAT ↔ wasm 変換を試せる。**ただしバウンティ対象の機密バイナリを第三者サイトに貼るのは避けるべき。** ローカルの `wasm2wat` / `wasm-objdump` で扱う。

> ### 📌 ここは自分で開いて読んでください
> **資料**: WABT の man ページ HTML 版 各 12 本（代表: `wasm-decompile.1.html`）とオンラインデモ — https://webassembly.github.io/wabt/doc/wasm-decompile.1.html および https://webassembly.github.io/wabt/demo/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `webassembly.github.io` が組織の egress ポリシーで遮断され、`curl`・`WebFetch`・Wayback・`r.jina.ai` の全 6 経路が 403 で失敗した）。ただし内容の欠落はない。これらの HTML の中身は man ページであり、**12 ツールすべての mdoc ソース `man/<tool>.1` を wabt リポジトリから逐語取得し、第 15 節のオプション表として全文再現した。**
> **読みどころ**:
> 1. `wasm-decompile.1.html`（本来の対象 URL）。このドキュメントは wabt のリリースに追従するため、`wasm-decompile` が 1.0.42 で削除されたことに合わせてリンク切れになっていても正常。読む目的は「自分の環境の wabt に `wasm-decompile` が入っているか」を判断すること。手元で `wasm-decompile --help` を叩くほうが確実。
> 2. 各ツールの man ページ（`wat2wasm.1.html` ほか）の OPTIONS 節。読む目的は「自分がインストールした版のオプションを確認すること」。**機能フラグは `--enable-*` と `--disable-*` の向きが版によって反転する**ため、手元の `--help` が最終的な正解。
> 3. `demo/wat2wasm/`。左に WAT、右にバイナリと逐バイト注釈が出るので、第 15 節の型エンコーディング（`7f`=i32 など）を自分の目で確かめる教材に最適。
> **代替手段**: man ページの mdoc ソースは `https://raw.githubusercontent.com/WebAssembly/wabt/HEAD/man/<tool>.1` から取得できる（第 15 節はこれを転記したもの）。手元でツールを入れたら `<tool> --help` が最も確実な一次情報。

---

## 12. サポートされている提案と読めない .wasm への対処

### Supported Proposals 表

WebAssembly は「提案（proposal）」という単位で機能が段階的に追加される。wabt がどの提案をどの操作でサポートするかは README の表で分かる。列の意味は次のとおり（逐語訳）。

- **Proposal**: WebAssembly 提案リポジトリの名前とリンク
- **flag**: 機能を有効/無効にするためにツールに渡すフラグ
- **default**: 機能がデフォルトで有効かどうか
- **binary**: wabt がバイナリ形式を読み書きできるか
- **text**: wabt がテキスト形式を読み書きできるか
- **validate**: wabt が構文を検証できるか
- **interpret**: `wasm-interp` または `spectest-interp` で実行できるか
- **wasm2c**: wasm2c がサポートするか

表（原文のまま逐語、✓ は原文どおり）。

| Proposal   | flag | default | binary | text | validate | interpret | wasm2c |
| --------------------- | --------------------------- | - | - | - | - | - | - |
| exception handling | `--disable-exceptions`      | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| mutable globals   | `--disable-mutable-globals` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| nontrapping float-to-int conversions | `--disable-saturating-float-to-int` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| sign extension    | `--disable-sign-extension`  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| simd              | `--disable-simd`            | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| threads           | `--enable-threads`          |   | ✓ | ✓ | ✓ | ✓ |   |
| multi-value       | `--disable-multi-value`     | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| tail-call         | `--disable-tail-call`       | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| bulk memory       | `--disable-bulk-memory`     | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| reference types   | `--disable-reference-types` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| annotations       | `--disable-annotations`     | ✓ |   | ✓ |   |   |   |
| memory64          | `--disable-memory64`        | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| multi-memory      | `--disable-multi-memory`    | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| extended-const    | `--disable-extended-const`  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| relaxed-simd      | `--disable-relaxed-simd`    | ✓ | ✓ | ✓ | ✓ | ✓ |   |
| custom-page-sizes | `--enable-custom-page-sizes`|   | ✓ | ✓ | ✓ | ✓ | ✓ |
| compact-imports   | `--enable-compact-imports`  |   | ✓ |   | ✓ |   |   |
| function-references | `--enable-function-references` |   | ✓ | ✓ | ✓ | ✓ |   |
| wide-arithmetic   | `--enable-wide-arithmetic`  |   | ✓ | ✓ | ✓ |   |   |

各提案のリポジトリは `https://github.com/WebAssembly/<提案名>` にある（例: `https://github.com/WebAssembly/multi-memory`）。

### 読めない .wasm に出会ったら

〔補足〕解析実務で最も重要なのは、**「解析対象が使っている提案が無効だと `wasm2wat` / `wasm-validate` が失敗する」**点だ。ある提案（たとえば SIMD やスレッド）を使ったバイナリを、その機能を無効にしたツールに食わせるとエラーになる。読めない `.wasm` に出会ったら、**まず `--enable-all` を付けて再試行するのが定石**である（`--enable-all` = "Enable all features" は全ツールに存在する。第 15 節参照）。表の `interpret` 列と `wasm2c` 列が空の提案は、`wasm-interp` / `wasm2c` ではそのバイナリを扱えないので、その場合は `wasm2wat` での静的読解に切り替える。

---

## 13. WABT のビルド・インストール・サニタイザ・ファジング

### 手っ取り早く入れる（プリビルドバイナリ）

多くのプラットフォームでパッケージ済みバイナリが使える。

```sh
brew install wabt
```

```sh
sudo apt install wabt
```

プリビルドバイナリは GitHub の releases ページからも直接ダウンロードできる。

### ソースからクローン・ビルド

**サブモジュールの取得を忘れないこと**（testsuite と gtest を取得する。一部のテストに必要）。

```console
$ git clone --recursive https://github.com/WebAssembly/wabt
$ cd wabt
$ git submodule update --init
```

CMake で直接ビルドする（Linux / macOS）。

```console
$ mkdir build
$ cd build
$ cmake ..
$ cmake --build .
```

**NOTE（逐語訳）**: ビルド成果物用に**別のディレクトリを作らなければならない**（上記の `build` など）。リポジトリのルートから `cmake` を実行するとうまくいかない。ビルドが `wasm2c` という実行ファイルを生成し、`wasm2c` ディレクトリと衝突するからである。

トップレベルの `Makefile` を使う場合は `make` を実行すると CMake を呼び、結果をデフォルトで `out/clang/Debug/` に置く。

```console
$ make
```

これは **Clang コンパイラを使った debug ビルド**を作る。多くの make ターゲットがコンパイラ・ビルド種別・構成の組み合わせから生成される。

| 分類 | 選択肢（原文逐語） |
| --- | --- |
| compilers | `gcc`, `clang`, `gcc-i686`, `emscripten` |
| build types | `debug`, `release` |
| configurations | empty, `asan`, `msan`, `lsan`, `ubsan`, `fuzz`, `no-tests` |

ダッシュで組み合わせる。

```console
$ make clang-debug
$ make gcc-i686-release
$ make clang-debug-lsan
$ make gcc-debug-no-tests
```

### サニタイザ — メモリ安全性バグを検出する構成

[LLVM sanitizers] 付きでビルドするには、ターゲットにサニタイザ名を付ける。

```console
$ make clang-debug-asan
$ make clang-debug-msan
$ make clang-debug-lsan
$ make clang-debug-ubsan
```

各サニタイザの役割は次のとおり。**ASAN（Address Sanitizer）は不正なメモリアクセス（use after free、範囲外アクセス等）を、MSAN（Memory Sanitizer）は未初期化メモリの使用を、LSAN（Leak Sanitizer）はメモリリークを、UBSAN（Undefined Behavior Sanitizer）は未定義動作を見つける。** 特定のサニタイザで全テストを実行するには次のようにする。

```console
$ make test-asan
```

### ファジング

[LLVM fuzzer support] を使ってビルドするには、ターゲットに `fuzz` を付ける。

```console
$ make clang-debug-fuzz
```

これは `wasm2wat_fuzz` バイナリを生成する。**バイナリリーダのファジングに使えるほか、oss-fuzz が見つけた fuzzer エラーの再現にも使える。**

```console
$ out/clang/Debug/fuzz/wasm2wat_fuzz ...
```

〔補足〕wabt 自体が oss-fuzz に載っていることは、**「wasm パーサ／ツールチェーン自体もメモリ安全性バグの対象になる」**という事実の裏付けでもある。ブラウザやサーバサイドの wasm ランタイムに未検証の `.wasm` を食わせる経路は、それ自体が攻撃面だ。`wasm2c` で C に落として ASAN 付きでビルドすれば、既存の C 解析ツールに載せられる。

---

## 14. 各ツールの使い方と診断ワークフロー

### wat2wasm（WAT → wasm）

```sh
# parse test.wat and write to .wasm binary file with the same name
$ bin/wat2wasm test.wat

# parse test.wat and write to binary file test.wasm
$ bin/wat2wasm test.wat -o test.wasm

# parse spec-test.wast, and write verbose output to stdout (including the
# meaning of every byte)
$ bin/wat2wasm spec-test.wast -v
```

### wasm2wat（wasm → WAT、解析の主力）

```sh
# parse binary file test.wasm and write text file test.wat
$ bin/wasm2wat test.wasm -o test.wat

# parse test.wasm and write test.wat
$ bin/wasm2wat test.wasm -o test.wat
```

### wasm-interp（インタプリタで実行）

```sh
# parse binary file test.wasm, and type-check it
$ bin/wasm-interp test.wasm

# parse test.wasm and run all its exported functions
$ bin/wasm-interp test.wasm --run-all-exports

# parse test.wasm, run the exported functions and trace the output
$ bin/wasm-interp test.wasm --run-all-exports --trace

# parse test.json and run the spec tests
$ bin/wasm-interp test.json --spec

# parse test.wasm and run all its exported functions, setting the value stack
# size to 100 elements
$ bin/wasm-interp test.wasm -V 100 --run-all-exports
```

### 診断ワークフローの骨格

要約すると、`.wasm` を手に入れてから挙動を確認するまでの流れはこうなる。

```text
1. .wasm を入手（DevTools / プロキシ / ページの fetch から）
2. wasm-objdump -h    でセクション構成を把握（name/カスタムセクションの有無も確認）
3. wasm-objdump -x    で import / export / data / table を列挙 → JS 境界（攻撃面）を特定
4. wasm2wat --generate-names -f  で読める WAT に戻す
5. WAT を読み、memory の offset/length や call_indirect のインデックス出自を追う
6. wasm-interp --run-all-exports --trace  で挙動確認（境界チェックがどこで trap するか）
7. 必要なら wasm2c で C に落として ASAN 等の既存 C 解析ツールに載せる
```

〔補足〕`wasm-interp` の引数指定形式が `-a "i32:8"`（型:値）である点は実務上重要。`-r`（実行するエクスポート関数名）と `-a` を使えば、**ブラウザを一切使わずに特定のエクスポート関数へ任意の引数を与えて挙動を観察**できる。`--trace` はスタックマシンの各命令の実行を追えるので、境界チェックがどこで trap するかを確認する用途に適する。`--host-print` は自前のホスト関数を用意せずに module の出力を見る簡易フックになる。

---

## 15. ツール別オプション完全リファレンス

以下は wabt の man ページ（mdoc 形式）から抽出したオプションを逐語で再現したもの。**全ツールに共通の「機能フラグ群」は 1 回だけ表にし、以降は各ツール固有オプションのみを記す。** 出典は `https://raw.githubusercontent.com/WebAssembly/wabt/HEAD/man/*.1`。

### 共通の機能（feature）フラグ

`wat2wasm` / `wasm2wat` / `wasm-validate` / `wasm-interp` / `wasm2c` / `wat-desugar` / `wasm-stats` / `wast2json` / `spectest-interp` に共通。

| オプション（原文逐語） | 説明（原文逐語） |
| --- | --- |
| `--help` | Print this help message |
| `--version` | Print version information |
| `-v`, `--verbose` | Use multiple times for more info |
| `--disable-exceptions` | Disable Experimental exception handling |
| `--disable-mutable-globals` | Disable Import/export mutable globals |
| `--disable-saturating-float-to-int` | Disable Saturating float-to-int operators |
| `--disable-sign-extension` | Disable Sign-extension operators |
| `--disable-simd` | Disable SIMD support |
| `--enable-threads` | Enable Threading support |
| `--enable-function-references` | Enable Typed function references |
| `--disable-multi-value` | Disable Multi-value |
| `--disable-tail-call` | Disable Tail-call support |
| `--disable-bulk-memory` | Disable Bulk-memory operations |
| `--disable-reference-types` | Disable Reference types (externref) |
| `--disable-annotations` | Disable Custom annotation syntax |
| `--enable-code-metadata` | Enable Code metadata |
| `--enable-gc` | Enable Garbage collection |
| `--disable-memory64` | Disable 64-bit memory |
| `--disable-multi-memory` | Disable Multi-memory |
| `--disable-extended-const` | Disable Extended constant expressions |
| `--disable-relaxed-simd` | Disable Relaxed SIMD |
| `--enable-custom-page-sizes` | Enable Custom page sizes |
| `--enable-compact-imports` | Enable Compact import section |
| `--enable-wide-arithmetic` | Enable Wide arithmetic |
| `--enable-all` | Enable all features |

### wat2wasm 固有オプション

NAME: `wat2wasm` — translate from WebAssembly text format to the WebAssembly binary format
SYNOPSIS: `wat2wasm [options] filename`

| オプション | 説明（原文逐語） |
| --- | --- |
| `-d`, `--dump-module` | Print a hexdump of the module to stdout |
| `-o`, `--output=FILE` | Output wasm binary file. Use "-" to write to stdout. |
| `-r`, `--relocatable` | Create a relocatable wasm binary (suitable for linking with e.g. lld) |
| `--no-canonicalize-leb128s` | Write all LEB128 sizes as 5-bytes instead of their minimal size |
| `--debug-names` | Write debug names to the generated binary file |

### wasm2wat 固有オプション

NAME: `wasm2wat` — translate from the binary format to the text format
SYNOPSIS: `wasm2wat [options] filename`

| オプション | 説明（原文逐語） |
| --- | --- |
| `-o`, `--output=FILENAME` | Output file for the generated wast file, by default use stdout |
| `-f`, `--fold-exprs` | Write folded expressions where possible |
| `--inline-exports` | Write all exports inline |
| `--inline-imports` | Write all imports inline |
| `--no-debug-names` | Ignore debug names in the binary file |
| `--ignore-custom-section-errors` | Ignore errors in custom sections |
| `--generate-names` | Give auto-generated names to non-named functions, types, etc. |

〔補足〕解析のときは `wasm2wat --generate-names -f`（名前自動生成＋折り畳み式）が最も読みやすい。壊れた/難読化されたバイナリには `--ignore-custom-section-errors` を追加すると先に進めることがある。

### wasm-objdump 固有オプション

NAME: `wasm-objdump` — print information about a wasm binary
SYNOPSIS: `wasm-objdump [options] filename+`（複数ファイルを取れる）

**注: wasm-objdump には共通の feature フラグ群は無い**。オプションは以下の全部である。

| オプション | 説明（原文逐語） |
| --- | --- |
| `--help` | Print this help message |
| `--version` | Print version information |
| `-h`, `--headers` | Print headers |
| `-j`, `--section=SECTION` | Select just one section |
| `-s`, `--full-contents` | Print raw section contents |
| `-d`, `--disassemble` | Disassemble function bodies |
| `--debug` | Print extra debug information |
| `-x`, `--details` | Show section details |
| `-r`, `--reloc` | Show relocations inline with disassembly |

#### `wasm-objdump -x` の出力例（出典: wabt の `test/dump/import.txt`、逐語）

入力 WAT:

```wat
(module
  (import "ignored" "test" (func (param i32 i64 f32 f64)))
  (import "ignored" "test2" (func (param i32) (result i32)))
  (import "ignored" "testmem" (memory 0))
  (import "ignored" "testtable" (table 0 funcref))
  (import "ignored" "testtag" (tag (param i32)))
)
```

`-x` の出力:

```text
import.wasm:	file format wasm 0x1

Section Details:

Type[3]:
 - type[0] (i32, i64, f32, f64) -> nil
 - type[1] (i32) -> i32
 - type[2] (i32) -> nil
Import[5]:
 - func[0] sig=0 <ignored.test> <- ignored.test
 - func[1] sig=1 <ignored.test2> <- ignored.test2
 - memory[0] pages: initial=0 <- ignored.testmem
 - table[0] type=funcref initial=0 <- ignored.testtable
 - tag[0] sig=2 <ignored.testtag> <- ignored.testtag

Code Disassembly:

```

この `Import[5]` の一覧が、まさに第 5 節で述べた「攻撃面の完全な一覧」だ。`func` / `memory` / `table` / `tag` が何を外から受け取っているかがひと目で分かる。

#### `-v`（verbose）の逐バイト注釈と型エンコーディング

`wat2wasm -v` / `wasm-objdump -v` の verbose 出力は「**全バイトの意味**」を注釈付きで示す。

```text
0000000: 0061 736d                                 ; WASM_BINARY_MAGIC
0000004: 0100 0000                                 ; WASM_BINARY_VERSION
; section "Type" (1)
0000008: 01                                        ; section code
0000009: 00                                        ; section size (guess)
000000a: 03                                        ; num types
; func type 0
000000b: 60                                        ; func
000000c: 04                                        ; num params
000000d: 7f                                        ; i32
000000e: 7e                                        ; i64
000000f: 7d                                        ; f32
0000010: 7c                                        ; f64
0000011: 00                                        ; num results
; func type 1
0000012: 60                                        ; func
0000013: 01                                        ; num params
0000014: 7f                                        ; i32
0000015: 01                                        ; num results
0000016: 7f                                        ; i32
; func type 2
0000017: 60                                        ; func
0000018: 01                                        ; num params
0000019: 7f                                        ; i32
000001a: 00                                        ; num results
0000009: 11                                        ; FIXUP section size
; section "Import" (2)
000001b: 02                                        ; section code
000001c: 00                                        ; section size (guess)
000001d: 05                                        ; num imports
; import header 0
000001e: 07                                        ; string length
000001f: 6967 6e6f 7265 64                        ignored  ; import module name
0000026: 04                                        ; string length
0000027: 7465 7374                                test  ; import field name
000002b: 00                                        ; import kind
000002c: 00                                        ; import signature index
```

〔補足〕この逐バイト注釈は、**型エンコーディングやセクションコードを覚える**のに最適な教材だ。手書きで壊れた wasm を作ってパーサの挙動を確かめるときにも役立つ。主な対応は次のとおり。

| バイト | 意味 |
| --- | --- |
| `00 61 73 6d` | WASM_BINARY_MAGIC（`\0asm`） |
| `60` | func（関数型の先頭） |
| `7f` | i32 |
| `7e` | i64 |
| `7d` | f32 |
| `7c` | f64 |
| `01` | Type セクションのコード |
| `02` | Import セクションのコード |

### wasm-validate 固有オプション

NAME: `wasm-validate` — validate a file in the WebAssembly binary format
SYNOPSIS: `wasm-validate [options] filename`

| オプション | 説明（原文逐語） |
| --- | --- |
| `--no-debug-names` | Ignore debug names in the binary file |

### wasm-interp 固有オプション

NAME: `wasm-interp` — decode and run a WebAssembly binary file
SYNOPSIS: `wasm-interp [options] filename [arg]...`

| オプション | 説明（原文逐語） |
| --- | --- |
| `-V`, `--value-stack-size=SIZE` | Size in elements of the value stack |
| `-C`, `--call-stack-size=SIZE` | Size in elements of the call stack |
| `-t`, `--trace` | Trace execution |
| `-r`, `--run-export=FUNCTION` | Run exported function by name |
| `-a`, `--argument=ARGUMENT` | Add argument to an exported function execution |
| `--wasi` | Assume input module is WASI compliant (Export WASI API the the module and invoke _start function)（※原文のタイポ "the the" はそのまま） |
| `-e`, `--env=ENV` | Pass the given environment string in the WASI runtime |
| `-d`, `--dir=DIR` | Pass the given directory the the WASI runtime（※原文のタイポそのまま） |
| `--run-all-exports` | Run all the exported functions, in order. Useful for testing |
| `--host-print` | Include an importable function named "host.print" for printing to stdout |

追加の実行例（README に無い最後の例を含む、逐語）:

```text
$ wasm-interp test.wasm
$ wasm-interp test.wasm --run-all-exports
$ wasm-interp test.wasm --run-all-exports --trace
$ wasm-interp test.wasm -V 100 --run-all-exports
$ wasm-interp test.wasm -r "func_sum" -a "i32:8" -a "i32:5"
```

### wasm2c 固有オプション

NAME: `wasm2c` — convert a WebAssembly binary file to a C source and header
SYNOPSIS: `wasm2c [options] filename`

| オプション | 説明（原文逐語） |
| --- | --- |
| `-o`, `--output=FILENAME` | Output file for the generated C source file, by default use stdout |
| `--num-outputs=NUM` | Number of output files to write |
| `-n`, `--module-name=MODNAME` | Unique name for the module being generated. This name is prefixed toeach of the generated C symbols. By default, the module name from thenames section is used. If that is not present the name of the inputfile is used as the default.（※原文の詰まったスペースもそのまま） |

### wasm-strip 固有オプション

NAME: `wasm-strip` — remove sections of a WebAssembly binary file
SYNOPSIS: `wasm-strip [options] filename`

**注: wasm-strip にも共通 feature フラグ群は無い**。全オプション:

| オプション | 説明（原文逐語） |
| --- | --- |
| `--help` | Print this help message |
| `--version` | Print version information |
| `-o`, `--output=FILE` | output wasm binary file |
| `-k`, `--keep-section=SECTION` | NAME          Section name to keep in the final output |

例の説明は "Remove all custom sections from test.wasm"（test.wasm から全カスタムセクションを削除）。

〔補足〕逆に言えば、**本番配布された `.wasm` に name セクションや DWARF のカスタムセクションが残っていれば、関数名・変数名・ソースファイル名が読める**。`wasm-objdump -h` でカスタムセクションの有無を最初に確認する価値がある。開発者は配布前に `wasm-strip` でこれらを落とすべきだ。

### wat-desugar 固有オプション

NAME: `wat-desugar` — parse .wat text form and print "canonical" flat format
SYNOPSIS: `wat-desugar [options] filename`

| オプション | 説明（原文逐語） |
| --- | --- |
| `-o`, `--output=FILE` | Output file for the formatted file |
| `-f`, `--fold-exprs` | Write folded expressions where possible |
| `--inline-exports` | Write all exports inline |
| `--inline-imports` | Write all imports inline |

`--generate-names` は man ページのオプション一覧には無いが EXAMPLES に登場する（"generate names for indexed variables"）。

### wasm-stats 固有オプション

NAME: `wasm-stats` — show stats for a module
SYNOPSIS: `wasm-stats [options] filename+`

| オプション | 説明（原文逐語） |
| --- | --- |
| `-o`, `--output=FILENAME` | Output file for the stats, by default use stdout |
| `-c`, `--cutoff=N` | Cutoff for reporting counts less than N |

例の説明は "parse binary file test.wasm and write opcode dist file test.dist"（オペコード分布ファイルを書き出す）。

### wast2json 固有オプション

NAME: `wast2json` — convert a file in the wasm spec test format to a JSON file and associated wasm binary files
SYNOPSIS: `wast2json [options] filename`

| オプション | 説明（原文逐語） |
| --- | --- |
| `-o`, `--output=FILE` | output JSON file |
| `-r`, `--relocatable` | Create a relocatable wasm binary (suitable for linking with e.g. lld) |
| `--no-canonicalize-leb128s` | Write all LEB128 sizes as 5-bytes instead of their minimal size |
| `--debug-names` | Write debug names to the generated binary file |

例の説明は "parse spec-test.wast, and write files to spec-test.json. Modules are written to spec-test.0.wasm, spec-test.1.wasm, etc."。

### spectest-interp 固有オプション

NAME: `spectest-interp` — read a Spectest JSON file, and run its tests in the interpreter
SYNOPSIS: `spectest-interp [options] filename`

| オプション | 説明（原文逐語） |
| --- | --- |
| `-V`, `--value-stack-size=SIZE` | Size in elements of the value stack |
| `-C`, `--call-stack-size=SIZE` | Size in elements of the call stack |

---

## 16. wasm-decompile — C 風擬似コードへの逆コンパイル

### 重要な注意 — 1.0.42 で削除された

`wasm-decompile` は、`.wasm` を **WAT よりずっと読みやすい C 風の擬似コード**に変換するツールだ。ただし版に注意が必要である。wabt リポジトリを全数確認した結果、正確な事実はこうだ。

- **`wasm-decompile` はリリース版 `1.0.29`〜`1.0.41` のすべてに同梱されている。**
- **`1.0.42` で削除された。** `man/wasm-decompile.1`・`src/tools/wasm-decompile.cc`・`src/decompiler.cc`・`docs/decompiler.md` がまとめて消え、`main`（現在の HEAD）にも存在しない。
- 現在の HEAD の README のツール一覧にも `wasm-decompile` は含まれておらず、`CMakeLists.txt` でビルドされる実行ファイルは `wat2wasm` / `wast2json` / `wasm2wat` / `wasm2c` / `wasm-stats` / `wasm-objdump` / `wasm-interp` / `spectest-interp` / `wat-desugar` / `wasm-validate` / `wasm-strip`（＋fuzz 有効時の `wasm2wat-fuzz`）のみである。

したがって**入手して使うなら 1.0.41 以前を選ぶ必要がある。** ディストリビューションの `wabt` パッケージのバージョンによって有無が変わるので、手元で `wasm-decompile --help` が通るかどうかで確認する（通れば 1.0.41 以前）。

### man ページ（1.0.36 時点、逐語）

NAME: `wasm-decompile` — translate from the binary format to readable C-like syntax
SYNOPSIS: `wasm-decompile [options] file`
DESCRIPTION（逐語）: Read a file in the WebAssembly binary format, and convert it to a decompiled text file.

オプション（1.0.36 時点、逐語。**共通フラグの enable/disable の向きが現在の HEAD と反転している点に注意**）:

| オプション | 説明（原文逐語） |
| --- | --- |
| `--help` | Print a help message |
| `--version` | Print version information |
| `-o`, `--output=FILENAME` | Output file for the decompiled file, by default use stdout |
| `--enable-exceptions` | Enable Experimental exception handling |
| `--disable-mutable-globals` | Disable Import/export mutable globals |
| `--disable-saturating-float-to-int` | Disable Saturating float-to-int operators |
| `--disable-sign-extension` | Disable Sign-extension operators |
| `--disable-simd` | Disable SIMD support |
| `--enable-threads` | Enable Threading support |
| `--enable-function-references` | Enable Typed function references |
| `--disable-multi-value` | Disable Multi-value |
| `--enable-tail-call` | Enable Tail-call support |
| `--disable-bulk-memory` | Disable Bulk-memory operations |
| `--disable-reference-types` | Disable Reference types (externref) |
| `--enable-annotations` | Enable Custom annotation syntax |
| `--enable-code-metadata` | Enable Code metadata |
| `--enable-gc` | Enable Garbage collection |
| `--enable-memory64` | Enable 64-bit memory |
| `--enable-multi-memory` | Enable Multi-memory |
| `--enable-extended-const` | Enable Extended constant expressions |
| `--enable-all` | Enable all features |
| `--ignore-custom-section-errors` | Ignore errors in custom sections |

実行例（逐語）:

```text
$ wasm-decompile test.wasm -o test.dcmp
```

### 出力形式の例（`test/decompile/basic.txt`、逐語）

入力（抜粋、逐語）:

```wat
(module
  (import "ns" "fi" (func))
  (import "ns" "g3" (global i32))
  (import "ns" "tab3" (table 0 12 funcref))
  ;; (import "ns" "m1" (memory 1))  ;; Can test only 1 at a time :(

  (memory (export "m2") 1)

  (global $g1 (mut i32) (i32.const 10))
  (global (export "g2") (mut i32) (i32.const 11))

  (table $tab1 0 10 funcref)
  (table (export "tab2") 0 11 funcref)

  (data 0 (offset (i32.const 0)) "Hello, World!\n\00")
  ...
  (func $f (param i32 i32) (result i32) (local i64 f32 f64)
    i64.const 8
    local.set 2
    f32.const 6.0
    local.set 3
    f64.const 7.0
    local.tee 4
    f64.const 10.0
    f64.lt
    if
      i32.const 1
      i32.const 2
      i32.load offset=3 align=1
      i32.const 5
      i32.add
      i32.store offset=4
    end
    ...
```

出力（`.dcmp`、逐語）:

```text
export memory m2(initial: 1, max: 0);

import global ns_g3:int;
global g_b:int = 10;
export global g2:int = 11;

import table ns_tab3:funcref;
table T_b:funcref(min: 0, max: 10);
export table tab2:funcref(min: 0, max: 11);

data d_HelloWorld(offset: 0) = "Hello, World!\0a\00";
data d_abcdefghijklmnoqrstuvwxyzabc(offset: 100) =
  "abcdefghijklmnoqrstuvwxyzabcdefghijklmnoqrstuvwxyzabcdefghijklmnoqrstu"
  "vwxyzabcdefghijklmnoqrstuvwxyzabcdefghijklmnoqrstuvwxyzabcdefghijklmno"
  "qrstuvwxyzabcdefghijklmnoqrstuvwxyzabcdefghijklmnoqrstuvwxyzabcdefghij"
  "klmnoqrstuvwxyzabcdefghijklmnoqrstuvwxyzabcdefghijklmnoqrstuvwxyz";
data d_c(offset: 200) = "hi";
data d_d(offset: 300) = "Hello, World!\0a\00";

import function ns_fi();

export function f(a:int, b:int):int {
  var c:long = 8L;
  var d:float = 6.0f;
  var e:double = 7.0;
  if (e < 10.0) { d_HelloWorld[5@4]:int = d_HelloWorld[5]:int@1 + 5 }
  f(a + g_b, 9);
  loop L_b {
    if (if (0) { 1 } else { 2 }) goto B_c;
    continue L_b;
    label B_c:
    if (1) continue L_b;
  }
  select_if(1, 2, 1 == 1);
  br_table[B_f, B_g, B_h, B_i, ..B_e](a);
  unreachable;
  label B_i:
  return 100;
  label B_h:
  return 101;
  label B_g:
  return 102;
  label B_f:
  return 103;
  label B_e:
  104;
  if (1) goto B_j;
  label B_j:
  a = {
        2;
        if (0) goto B_k;
        3;
        label B_k:
      }
  nop;
  is_null(null);
  call_indirect(0);
  if (0) {}
  return 0;
}

function f_c() {
  var a:int;
  loop L_a {
    a = 1;
    if (a) continue L_a;
  }
  a;
}

function signature() {
}

function signature_1() {
}

function f_f() {
}
```

### 出力の読み方（原文から読み取れる事実）

- `data` セグメントの内容から**名前が自動生成される**（`d_HelloWorld`、`d_abcdefghijklmnoqrstuvwxyzabc`）。短すぎるデータには連番名が付く（`d_c`。原文コメントは `;; Too short for data derived name`）。
- メモリアクセスは `d_HelloWorld[5@4]:int = d_HelloWorld[5]:int@1 + 5` のように、**「data セグメント名[インデックス@オフセット]:型」**という配列アクセス風の記法になる（`@` の後が align / offset に相当）。線形メモリのどこを読み書きしているかが WAT より格段に追いやすい。
- 制御フローは `if/else`、`loop L_b { ... continue L_b; }`、`goto B_c;`、`label B_c:`、`br_table[B_f, B_g, B_h, B_i, ..B_e](a);` として表現される。
- 型名は `int`（i32）、`long`（i64）、`float`（f32）、`double`（f64）に写される。定数も `8L`、`6.0f` のように接尾辞が付く。
- `select_if(1, 2, 1 == 1)`、`is_null(null)`、`call_indirect(0)`、`unreachable`、`nop` はそのまま関数風に出る。
- 名前が無い関数には `f_c`、`f_f`、`signature`、`signature_1` のような自動生成名が付く。

〔補足〕診断では、まず `wasm2wat` で WAT に戻して命令レベルの正確さを担保しつつ、可読性が欲しい大きな関数は（1.0.41 以前の環境なら）`wasm-decompile` で C 風に眺める、という二段構えが有効だ。ただし後編で扱うとおり `wasm-decompile` の出力は独自の言語であり、その言語仕様・命名/演算子優先順位の詳細は本節の後編（同ノートの後半パート）に譲る。

---

## 手を動かす

1. **wabt を入れる。** `sudo apt install wabt`（Debian/Ubuntu 系）または `brew install wabt`（macOS）。`wasm-decompile` を使いたいなら、`wasm-decompile --help` が通るか確認する（通らなければ 1.0.42 以降なので、GitHub releases から 1.0.41 以前を入手する）。
2. **最小の WAT を作って往復させる。** 次を `add.wat` に保存する。
   ```wat
   (module
     (func $add (param $lhs i32) (param $rhs i32) (result i32)
       local.get $lhs
       local.get $rhs
       i32.add
     )
     (export "add" (func $add))
   )
   ```
   そして `wat2wasm add.wat -o add.wasm` でバイナリ化し、`wasm2wat add.wasm` で WAT に戻す。命令列が変わらない（1:1 ラウンドトリップ）ことを目で確かめる。
3. **逐バイトの意味を見る。** `wat2wasm add.wat -v` を実行し、先頭に `WASM_BINARY_MAGIC`（`0061 736d`）が、Type セクションに `60`（func）や `7f`（i32）が出るのを確認する。第 15 節の型エンコーディング表と突き合わせる。
4. **攻撃面を列挙する。** 解析したい `.wasm` に対し `wasm-objdump -h target.wasm` でセクション構成（name/カスタムセクションの有無）を、`wasm-objdump -x target.wasm` で import / export / data / table を列挙する。import が「Wasm が頼る外界」、export が「JS から叩ける入口」だと意識して読む。
5. **読みやすい WAT に戻す。** `wasm2wat --generate-names -f target.wasm -o target.wat`。読めなければ `--enable-all` を付けて再試行し、それでも custom section で止まるなら `--ignore-custom-section-errors` を足す。
6. **挙動を観察する。** `wasm-interp target.wasm --run-all-exports --trace` で各エクスポート関数を実行してスタックの動きを追う。特定の関数だけ試すなら `wasm-interp target.wasm -r "関数名" -a "i32:8" -a "i32:5"` のように型:値で引数を渡す。
7. **メモリ受け渡しを探す。** 戻した WAT の中で、`call $log` のように JS へ `offset` と `length` を渡している箇所を探し、その `length` がどの入力から来ているかを遡る。data セクション（`(data (i32.const 0) "...")`）の実長と食い違う長さが渡り得るなら over-read の候補である。
8. **（任意）C に落として ASAN に載せる。** `wasm2c target.wasm -o target.c` で C 化し、ASAN 付きでビルドして手元のファザ・解析ツールに載せる。

## つまずきポイント

- **「名前が読める」と思い込む。** `$add` のような名前はバイナリに残らない。読めるのは name セクションが付いている場合だけで、本番配布物は `wasm-strip` で落とされていることが多い。名前が無くても `wasm2wat --generate-names` で機械的な名前は付く。
- **`--enable-*` と `--disable-*` の向きが版で反転する。** 第 15 節の共通フラグは HEAD 基準では多くが `--disable-*`（デフォルト有効）だが、`wasm-decompile` 1.0.36 では `--enable-exceptions` のように向きが逆。手元の `--help` が最終的な正解。
- **`wasm-decompile` が入っていない。** 1.0.42 以降には同梱されない。`apt`/`brew` の版によっては使えないので、必要なら 1.0.41 以前を明示的に入手する。
- **読めない `.wasm` を「壊れている」と誤判定する。** 多くは提案（SIMD・threads 等）が無効なだけ。まず `--enable-all` を試す。`interpret` 列や `wasm2c` 列が空の提案は、そのツールでは扱えないので静的読解（`wasm2wat`）に切り替える。
- **オンラインデモに機密バイナリを貼る。** `webassembly.github.io/wabt/demo/` は便利だが第三者サイト。バウンティ対象の `.wasm` はローカルツールで扱う。
- **`memory.grow` を跨いだ古いビュー。** JS 側で `new Uint8Array(memory.buffer)` をキャッシュしているコードは grow 後に detached なビューを掴む。バグの温床であり、レビューで見るべき箇所。
- **table を「JS から書き換えられない」と考える。** `Table.set()` で JS から差し替え可能。共有 table を握る JS 側のバグは Wasm 側の間接呼び出し先すり替えになる。

## この節のまとめ

- WebAssembly のコードの基本単位は **module** で、WAT では module 全体が 1 個の巨大な **S 式**として表現される。木はかなり平坦で、大部分は命令のリストである。
- `.wasm` の先頭 8 バイトは `\0asm`（`00 61 73 6d`）＋バージョン `01 00 00 00`。トラフィックから Wasm を識別するマジックとして使える。
- Wasm の実行は**スタックマシン**として定義され、各命令が `i32`/`i64`/`f32`/`f64` を push/pop する。関数の戻り値はスタックに最後に残った値。**検証（validation）**がスタックの型と個数の厳密一致を静的に要求するので、バイナリ改変による古典的攻撃は弾かれる。
- パラメータ・local の**名前 `$...` はバイナリに残らない**。名前が読めるのは name セクションがある場合のみ。`wasm-strip` で落とされ得る。
- JS 相互運用は **2 階層名前空間の import** と **export** が中心。**import セクションは module の攻撃面（外界との接点）、export セクションは JS から Wasm を駆動する入口**の完全な一覧になる。JS 関数は署名チェックなしに渡せる。
- **線形メモリ**は連続した可変の生バイト配列で、JS からは 1 個の `ArrayBuffer` に見える。1 ページ = 64KB。`memory.grow` は現在の `ArrayBuffer` を detach し新しいものを作るため、古いビューのキャッシュがバグになる。
- **offset + length を JS に渡し `new Uint8Array(memory.buffer, offset, length)` でビューを作る**パターンが over-read の温床。MDN の multi-memory 例は意図的な長さ不一致で "rubbish characters"（隣接メモリ漏洩）を示している。
- 動的呼び出しは **table + `call_indirect`** で実現。生の関数アドレスを線形メモリに置けないのはセキュリティ上の設計判断で、Wasm は table のインデックス（i32）だけを扱う。`call_indirect` は型を明示し、不一致なら `WebAssembly.RuntimeError`。
- table は JS から `get()`/`set()`/`grow()` で変更でき、**共有 memory / 共有 table を import する複数 module は事実上ひとつの信頼境界**にある。
- **WABT（"wabbit"）**は 11 ツール群で、**仕様への完全忠実（命令を変えない 1:1 ラウンドトリップ）**を目標とし、最適化を行う Binaryen とは目的が異なる。だから解析に向く。
- 診断ワークフローは「入手 → `wasm-objdump -h/-x` で構造・攻撃面把握 → `wasm2wat --generate-names -f` で読める WAT に → offset/length と `call_indirect` の出自を追う → `wasm-interp --run-all-exports --trace` で挙動確認 →（必要なら）`wasm2c` で C 化」。
- 読めない `.wasm` に出会ったら**まず `--enable-all`**。提案が無効だと `wasm2wat`/`wasm-validate` が失敗する。
- wabt 自身が **ASAN/MSAN/LSAN/UBSAN と libFuzzer/oss-fuzz** でテストされている。wasm パーサ／ランタイム自体もメモリ安全性バグの対象であり、未検証の `.wasm` を食わせる経路は攻撃面。
- **`wasm-decompile`** は WAT より読みやすい C 風擬似コードを出すが、**1.0.41 まで同梱・1.0.42 で削除**。使うなら 1.0.41 以前。出力は `d_HelloWorld[5@4]:int` のような配列アクセス風記法と `int/long/float/double` への型写像が特徴。

## 理解度チェック

1. **問**: 攻撃対象ページが読み込む `.wasm` の「外界との接点（攻撃面）」と「JS から叩ける入口」を、それぞれどのセクションで確認できるか。1 コマンドで両方を列挙する方法は。
   ▶ 答え: 外界との接点は **import セクション**、JS から叩ける入口は **export セクション**。`wasm-objdump -x target.wasm` の `Import[...]` / `Export` 一覧で両方まとめて確認できる。

2. **問**: `.wasm` を解析するのに Binaryen の `wasm-opt` ではなく WABT の `wasm2wat` を使うべき理由は。
   ▶ 答え: WABT は**仕様への完全忠実（命令に変更を加えない 1:1 のラウンドトリップ）**を設計目標にしており、戻した WAT が元バイナリと同じ挙動であることが保たれる。Binaryen は最適化を行うため元と構造が変わり得る。

3. **問**: 関数のパラメータ名 `$lhs` は `.wasm` バイナリに残るか。残らないとしたら、解析時に名前を得る手段は。
   ▶ 答え: 残らない（バイナリには整数インデックスしか入らない）。名前が残るのは name セクションがある場合のみ。無ければ `wasm2wat --generate-names` で機械生成名を付けられる。

4. **問**: MDN の multiple-memory 例で "Memory 1 data" の末尾にゴミ文字が出るのはなぜか。これが実アプリで起きると何になるか。
   ▶ 答え: `i32.const 20` と、実データより長い length を渡しており、`TextDecoder` に文字列の実バイト数より多いバイトが渡るため。実アプリなら**隣接メモリ内容の漏洩（over-read／情報漏洩）**になり得る。

5. **問**: WebAssembly が関数参照を線形メモリに直接置かず table に格納する設計にした理由は。
   ▶ 答え: 線形メモリは値の生バイトを露出するため、そこに関数参照を置くと Wasm が生の関数アドレスを観測・破壊でき、制御フロー奪取に繋がる。これは Web で許容できないので、参照は table に置き、Wasm は i32 のインデックスだけを扱う。

6. **問**: `call_indirect` の呼び出し先の署名が一致しないと何が起きるか。
   ▶ 答え: `WebAssembly.RuntimeError` が throw される。`call_indirect` は呼び出し箇所で想定署名（`(type $...)`）を供給し、実際の関数署名と照合する。

7. **問**: 手元の `.wasm` が `wasm2wat` で読めない。最初に試すべきオプションと、それで直らないとき次に足すオプションは。
   ▶ 答え: まず `--enable-all`（使っている提案が無効だと失敗するため）。それでも custom section のエラーで止まるなら `--ignore-custom-section-errors` を足す。

8. **問**: `wasm-decompile` が手元の wabt に無い。理由として何が考えられ、どう入手すればよいか。
   ▶ 答え: `wasm-decompile` は 1.0.41 まで同梱・**1.0.42 で削除**された。インストール済みが 1.0.42 以降だと無い。GitHub releases から 1.0.41 以前を入手する（`wasm-decompile --help` が通れば 1.0.41 以前）。

9. **問**: 共有メモリ（`shared`）を使う Wasm アプリを外形から見分ける手がかりは。
   ▶ 答え: 共有メモリは `SharedArrayBuffer` を要し、それには cross-origin isolation が必要。対象サイトが `Cross-Origin-Opener-Policy`（COOP）と `Cross-Origin-Embedder-Policy`（COEP）を送っていれば、Wasm threads を使っている可能性が高い。

10. **問**: `wasm-interp` でブラウザを使わずに特定のエクスポート関数へ引数 8 と 5 を渡し、命令の実行を追うコマンドは。
    ▶ 答え: `wasm-interp test.wasm -r "関数名" -a "i32:8" -a "i32:5" --trace`。`-r` で関数名、`-a` で `型:値` の引数、`--trace` で実行トレース。

## 出典

- WebAssembly テキスト形式の理解（MDN Web Docs、生成元ソース `mdn/content` 経由で取得）: https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format
- 同上の Markdown ソース: https://raw.githubusercontent.com/mdn/content/main/files/en-us/webassembly/guides/understanding_the_text_format/index.md
- WABT — The WebAssembly Binary Toolkit（GitHub、`raw.githubusercontent.com` 経由で取得）: https://github.com/WebAssembly/wabt
- WABT README: https://raw.githubusercontent.com/WebAssembly/wabt/HEAD/README.md
- WABT man ページ mdoc ソース: https://raw.githubusercontent.com/WebAssembly/wabt/HEAD/man/
- WABT man ページ HTML 版（遮断、内容は man ソースから再現）: https://webassembly.github.io/wabt/doc/wasm-decompile.1.html
- WABT オンラインデモ: https://webassembly.github.io/wabt/demo/

<!-- sources: https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format, https://raw.githubusercontent.com/mdn/content/main/files/en-us/webassembly/guides/understanding_the_text_format/index.md, https://github.com/WebAssembly/wabt, https://raw.githubusercontent.com/WebAssembly/wabt/HEAD/README.md, https://webassembly.github.io/wabt/doc/wasm-decompile.1.html, https://webassembly.github.io/wabt/demo/ -->
<!-- terms: WebAssembly, テキスト形式（WAT）, S式, module, スタックマシン, 検証（validation）, 線形メモリ（linear memory）, ArrayBuffer, WebAssembly.Memory, dataセクション, elemセクション, table, call_indirect, funcref, anyfunc, externref, import, export, 2階層名前空間, name セクション, マジックバイト, over-read, バルクメモリ操作, 動的リンク, 共有メモリ, SharedArrayBuffer, COOP/COEP, WABT, wat2wasm, wasm2wat, wasm-objdump, wasm-interp, wasm2c, wasm-strip, wasm-validate, wasm-decompile, サニタイザ, ASAN, ファジング, oss-fuzz, RuntimeError, Binaryen -->
<!-- self-read: https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format | developer.mozilla.org が組織の egress プロキシで遮断され自動取得不能（内容は mdn/content の Markdown から逐語取得済み） -->
<!-- self-read: https://github.com/WebAssembly/wabt | GitHub HTML が 503・API 空応答・MCP 許可外で自動取得不能（内容は raw.githubusercontent.com から逐語取得済み） -->
<!-- self-read: https://webassembly.github.io/wabt/doc/wasm-decompile.1.html | webassembly.github.io が組織の egress ポリシーで遮断され全6経路が403で失敗（man ページの内容は man/*.1 の mdoc ソースから逐語再現済み） -->
