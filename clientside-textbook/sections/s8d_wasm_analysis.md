## WebAssembly解析の入口

クライアントサイドの攻撃面を洗い出していると、遅かれ早かれ `.wasm` ファイルに出くわす。画像処理、暗号化、ライセンス検証、ゲームロジック、アンチボット（bot detection）、PDFレンダラ、動画コーデック、独自の難読化ランタイム——本来ならJavaScriptで書かれていたはずのロジックが、バイナリの塊として配信されている。JavaScriptならば整形して読めばよかったものが、WebAssembly（以下 Wasm）になった途端に「読めないもの」として調査対象から外されてしまう。しかし実際には、Wasmはバイナリとしては極めて素直な形式であり、**逆アセンブル（バイナリからテキスト表現への復元）が公式ツールで完全かつ可逆に行える**という、ネイティブバイナリにはない大きな利点を持つ。本節は、その「読む」ための最小限の基盤——**WAT（WebAssembly Text Format）の読解**と、**wabt（WebAssembly Binary Toolkit）によるツールチェーン運用**——を仕組みのレベルで解説する。

> 本節は防御・自己所有環境での解析を目的とする。実在サービスや本番環境への無許可検証、破壊的な手順は扱わない。以降の手順は、自分で用意した `.wat` / `.wasm` ファイル、あるいは自分が権限を持つ環境で取得した成果物に対して実行する前提である。

### なぜハンターがWasmを読む必要があるのか

まず攻撃面（attack surface）の所在を正しく押さえておきたい。Wasmは**サンドボックス化された仮想マシン**であり、それ自体は DOM にも `document` にもネットワークにも直接触れない。Wasmコードができるのは、(1) 自分の**線形メモリ（linear memory、後述の巨大なバイトの配列）**を読み書きすること、(2) **インポートされた関数（ホスト側=JavaScriptが渡した関数）を呼ぶこと**、(3) 自分の内部で計算すること、この3つだけである。したがって、

- **Wasm自体は `innerHTML` のような sink（入力が最終的に実行・解釈される危険な代入先）を持たない。** `document.write` を呼びたければ、JavaScript側がその関数をインポートとして渡していなければならない。
- **危険はほぼ必ず「境界」に現れる。** すなわち、Wasmモジュールとそれを起動する**グルーコード（glue code、Emscripten等が自動生成するJavaScriptの橋渡し層）**とのやり取りの部分である。Wasmが返したメモリオフセットをグルーが文字列に復元し、それをそのまま `innerHTML` に渡していれば、XSSの sink はJS側にある。
- **同時に、Wasmの中身は「読めば分かる」貴重な情報源になる。** ハードコードされたAPIキーやエンドポイント、署名アルゴリズム、アンチデバッグのチェックロジック、ライセンス判定の分岐——これらはバイナリの中にあるだけで、暗号化されているわけではない。Wasmに秘密を置いても秘密にはならない、というのが防御側が理解すべき第一原則である。

つまりWasm解析の目的は「Wasmを攻撃する」ことではなく、**(a) Wasmが公開している輸出入インタフェースを列挙して境界の型と意味を把握し、(b) 線形メモリを通じて流れるデータの実体を観測し、(c) 内部ロジックのうちセキュリティ上重要な判断（検証・分岐）がどこにあるかを特定する**ことにある。そのすべての出発点が、バイナリをWATへ戻して読むという作業である。

### WATの読み方（1）: S式とモジュール構造

WATは **S式（S-expression、記号表現）** で書かれる。LISPと同じく、すべてが括弧で囲まれた木構造であり、括弧の直後のラベルがノードの種類を表す。最小のモジュールはこれである。

```wat
(module)
```

これは有効な（そして何もしない）モジュールで、コンパイルするとわずか8バイトになる。wabtの `wat2wasm -v`（後述）は、生成した各バイトの意味を注釈付きで出力してくれる。

```
0000000: 0061 736d              ; WASM_BINARY_MAGIC
0000004: 0100 0000              ; WASM_BINARY_VERSION
```

先頭4バイト `00 61 73 6d` は ASCII で `\0asm`、続く4バイトがバージョン `1`（リトルエンディアンの `0x00000001`）。**ファイルの先頭がこの8バイトかどうかが、そのファイルがWasmかどうかの最も確実な判定**であり、プロキシのログやレスポンスボディから `.wasm` を拾うときの目印になる。MIMEタイプは `application/wasm` で、拡張子が `.wasm` でなくても（`.bin`、`.dat`、拡張子なしでも）中身がこの8バイトで始まればWasmである。

モジュールの中には、**セクション**に対応する要素が並ぶ。ハンターが最初に見るべきは次の5種類だ。

| 要素 | 意味 | 解析上の価値 |
|---|---|---|
| `(import "mod" "name" ...)` | 外部（JS）から受け取るもの | **Wasmが外界へ及ぼせる影響の全リスト**。ここにない能力はWasmは持てない |
| `(export "name" ...)` | 外部へ公開するもの | JS側から呼べるエントリポイント一覧 |
| `(memory n)` / `(data ...)` | 線形メモリとその初期値 | **文字列・鍵・URLなどの定数がここに埋まる** |
| `(table n funcref)` / `(elem ...)` | 間接呼び出し用の関数参照表 | 仮想関数・関数ポインタの解決先 |
| `(func ...)` | 関数本体 | ロジックそのもの |

### WATの読み方（2）: 関数・型・ローカル変数

関数の骨格はこうなっている。

```wat
(func <signature> <locals> <body>)
```

シグネチャ（signature、関数の型）は引数と戻り値の型を並べたものだ。

```wat
(func (param i32) (param i32) (result f64) ...)
```

`(result ...)` が無ければ戻り値なし。型は次のものがある。

- **数値型**: `i32`（32ビット整数）、`i64`（64ビット整数）、`f32`（単精度浮動小数）、`f64`（倍精度浮動小数）
- **ベクトル型**: `v128`（128ビットSIMDベクトル）
- **参照型**: `funcref`（関数への参照）、`externref`（任意のJavaScript値への不透明な参照）

ここで解析上きわめて重要な事実がある。**Wasmには文字列型もオブジェクト型も構造体型も無い。** C/C++/Rustから来た文字列は、必ず「線形メモリ上のオフセット（`i32`）」として表現される。つまり関数シグネチャに `i32` が2つ並んでいたら、それは `(offset, length)` のペアである可能性が高い——この読み替えができるかどうかが、Wasm解析の第一の勘所になる。

引数とローカル変数には `$name` 形式で名前を付けられる。

```wat
(func (param $p1 i32) (param $p2 f32) (local $loc f64) …)
```

ただし**バイナリに変換した時点で名前は捨てられ、整数のインデックスだけが残る**。インデックスは「引数を宣言順に0から数え、その続きにローカル変数が並ぶ」という規則で決まる。

```wat
(func (param i32) (param f32) (local f64)
  local.get 0    ;; i32 の引数を取得
  local.get 1    ;; f32 の引数を取得
  local.get 2    ;; f64 のローカル変数を取得
)
```

したがって、バイナリを `wasm2wat` で戻したときに `$p1` のような読みやすい名前ではなく `local.get 0` や `$var0` が並ぶのは正常である。**名前を残したい/残っている場合は「name section」という任意のカスタムセクション**に依存する。デバッグビルドではこれが含まれるため関数名が読めることがあり、リリースビルドでは `wasm-strip` などで除去されているのが普通だ。**逆に言えば、配布物に name section が残っていれば、元の関数名・ローカル名という一級の解析情報が手に入る。**

### WATの読み方（3）: スタックマシンという実行モデル

Wasmは**スタックマシン（stack machine）**として定義されている。各命令は値スタックから値を pop し、結果を push する。レジスタという概念は（仕様上は）無い。

```wat
(func (param $p i32)
  (result i32)
  local.get $p
  local.get $p
  i32.add
)
```

スタックの遷移を追うとこうなる。

1. `local.get $p` → スタック `[$p]`
2. `local.get $p` → スタック `[$p, $p]`
3. `i32.add` は2つ pop し、和（2³²を法とする、つまり32ビットで折り返す加算）を push → スタック `[$p + $p]`

関数の戻り値は、本体実行後にスタックに残っている値である。ここが**Wasmが高速に検証できる理由**でもある：各命令のスタック効果は静的に分かっているので、ブラウザはコードを実行せずに「スタックの型と深さが常に整合するか」「宣言された戻り値型と一致するか」を1パスで検証できる。検証を通らないモジュールは実行前に拒否されるため、型混同によるメモリ破壊は原理的に起こらない。

同じ意味のコードを、S式の入れ子（folded form、畳み込み形式）で書くこともできる。

```wat
(func (param $p i32) (result i32)
  (i32.add (local.get $p) (local.get $p))
)
```

**この2つは完全に等価**で、バイナリ上は同じ命令列になる。読みやすさが違うだけだ。wabtの `wat-desugar` は、S式・フラット形式・混在のいずれで書かれたWATも受け取って「正準（canonical）なフラット形式」に揃えてくれるので、異なるツールが吐いたWATを比較（diff）したいときに有用である。

### 輸出入インタフェース: Wasmと外界の唯一の接点

完全なモジュールを見てみよう。

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

`(export "add" (func $add))` によって、JS側からは `instance.exports.add` として見える。

```javascript
WebAssembly.instantiateStreaming(fetch("add.wasm")).then((obj) => {
  console.log(obj.instance.exports.add(1, 2)); // "3"
});
```

エクスポートは `(func (export "name") ...)` とインライン記法でも書ける。逆方向、すなわちJSの関数をWasmへ渡すのが `import` である。

```wat
(module
  (import "console" "log" (func $log (param i32)))
  (func (export "logIt")
    i32.const 13
    call $log
  )
)
```

```javascript
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

インポート名が `"console"` と `"log"` の**2レベル名前空間**になっている点に注目してほしい。これはJS側のインポートオブジェクトのネスト構造（`importObject.console.log`）に直接対応する。そして**シグネチャは静的に検査される**：宣言と実際に渡された関数の型が食い違えば、インスタンス化の時点で `LinkError` になる。

**解析上の意味は決定的だ。** import 一覧は「このモジュールが持ちうる全能力のホワイトリスト」である。`fetch` 相当や `eval` 相当の関数がインポートされていなければ、Wasmは決して通信も動的コード実行もできない。逆に、グルーコードが便利のために `eval` や DOM 操作関数を丸ごとインポートさせている場合、そこが境界の弱点になる。**ゆえに解析の最初の一手は常に import/export の列挙**であり、これは `wasm-objdump -x`（後述）ですぐ得られる。

グローバル変数も輸出入できる。

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

```javascript
const global = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
```

`(mut i32)` の `mut` が可変を意味する。可変グローバルは JS と Wasm の双方から書き換えられる共有状態なので、**フラグ・状態機械・「検証済み」ビットのような判定結果がここに載っていることがある**。

### 線形メモリ: 文字列と構造体が住む場所

線形メモリは「大きく連続した可変のバイト配列」で、JS側からは `ArrayBuffer` として見える。これがWasm解析における最大の観測点だ。

```javascript
const memory = new WebAssembly.Memory({ initial: 1 });
const importObject = { js: { mem: memory } };
WebAssembly.instantiateStreaming(fetch("the_wasm_to_import.wasm"), importObject);
```

```wat
(import "js" "mem" (memory 1))
```

`1` は**最小1ページ**の意味で、**1ページ = 64KiB（65,536バイト）**である。メモリはモジュール内で定義することも（`(memory 1)`）、JSからインポートすることもできる。

初期データは `data` セグメントで埋め込む。

```wat
(module
  (import "console" "log" (func $log (param i32 i32)))
  (import "js" "mem" (memory 1))
  (data (i32.const 0) "Hi")
  (func (export "writeHi")
    i32.const 0  ;; オフセット
    i32.const 2  ;; 長さ
    call $log
  )
)
```

```javascript
const memory = new WebAssembly.Memory({ initial: 1 });

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
    obj.instance.exports.writeHi(); // "Hi" と表示される
  },
);
```

この短い例に、Wasm解析の本質が凝縮されている。**Wasmは「文字列を渡す」ことができないので、代わりに `(offset, length)` という2つの `i32` を渡し、JS側が `memory.buffer` からその範囲を切り出してデコードする。** 実際のEmscripten製グルーコードがやっているのも、まさにこれ（`UTF8ToString(ptr)` のような関数で、NUL終端まで読む変種が多い）である。

ここから2つの実践が導かれる。

1. **静的解析**: `data` セグメントには、文字列定数・URL・エラーメッセージ・鍵素材がそのまま並ぶ。`wasm-objdump -s`（セクションの生バイトを表示）や `wasm2wat` の出力中の `(data ...)` を読むだけで、モジュールの素性が相当わかる。
2. **動的観測（自分の検証用ページで）**: インスタンスから `exports.memory` を取り、任意時点のメモリをダンプできる。

```javascript
// 自己所有の検証ページで、Wasmインスタンスのメモリを観測する
const mem = instance.exports.memory;            // エクスポートされている場合
const view = new Uint8Array(mem.buffer);
// 例: オフセット 1024 から 64 バイトを16進で眺める
console.log([...view.slice(1024, 1088)]
  .map((b) => b.toString(16).padStart(2, "0")).join(" "));
```

これが可能なのは、`memory.buffer` が**ただの `ArrayBuffer`** であり、JSから完全に読み書きできるからだ。**Wasmのサンドボックスは「WasmがJSを侵さない」方向の保護であって、「JSからWasmの内部が見えない」保護ではない。** 難読化の手段としてWasmを使っても、メモリは丸見えである。

メモリ操作の命令は次のとおり。

- `i32.load` … スタックからオフセットを pop し、その位置の値を push
- `i32.store` … オフセットと値を pop して書き込む
- `memory.grow` … メモリをページ単位で拡張
- `memory.copy` / `memory.fill` / `memory.init` … 一括操作（bulk memory operations）

bulk memory 提案では `data.drop` / `elem.drop` / `memory.copy` / `memory.fill` / `memory.init` / `table.copy` / `table.init` の7命令が追加された。例えば

```wat
(memory.fill (i32.const 0) (i32.const 0) (i32.const 100))
```

はオフセット0から100バイトをバイト値0で埋める（`memset` 相当）。C/C++由来のコードでは、`memcpy`/`memset` がこれらの命令に落ちるため、**バッファサイズ計算が絡む処理を見分ける手がかり**になる。

なお、現在のWasmは**マルチメモリ（複数の線形メモリ）**もサポートしており、各メモリは0から始まる索引を持つ。`(data (memory 1) (i32.const 0) "Memory 1 data")` のようにメモリ索引を明示でき、省略時はメモリ0に対する指定となる。解析時にメモリが複数ある場合は、どの `i32` オフセットがどのメモリのものかを取り違えないよう注意が要る。

スレッド利用時は**共有メモリ（shared memory）**になる。

```wat
(memory 1 2 shared)
```

```javascript
const memory = new WebAssembly.Memory({ initial: 10, maximum: 100, shared: true });
// memory.buffer は SharedArrayBuffer になる
```

共有メモリは最大サイズの指定が必須で、`postMessage()` で Window と Worker の間を行き来できる。アクセスの同期には `i32.atomic.load` / `i32.atomic.store` / `i32.atomic.rmw.add` / `i32.atomic.compare_exchange` / `memory.atomic.wait` / `memory.atomic.notify` といったアトミック命令を使う。**`SharedArrayBuffer` を使うページは、ブラウザ側で cross-origin isolation（`COOP`/`COEP` ヘッダ）が要求される**点は、ヘッダ調査の際に覚えておく価値がある（Spectre系サイドチャネル対策として導入された要件）。

### テーブルと `call_indirect`: 間接呼び出しが解析を難しくする理由

テーブル（table）は「**参照**のリサイズ可能な配列」である。線形メモリがバイトを持つのに対し、テーブルは関数参照などのリファレンスを持つ。

なぜ別立ての仕組みが要るのか。理由は明快だ。

- `call` は**静的な関数インデックス**しか取れない（直接呼び出し専用）。
- 関数ポインタのような動的呼び出しには、実行時に決まる値が要る。
- しかし**関数参照を線形メモリに置くことはできない**。線形メモリは自由に書き換え可能なので、そこに生の関数アドレスを置くと、改竄によって任意アドレスへ制御を飛ばされてしまう（=セキュリティ上の理由）。
- そこで参照はテーブルに格納し、線形メモリには**テーブルの索引（ただの `i32`）**だけを置く。`call_indirect` は索引をスタックから pop し、テーブルを引いて呼び出す。

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

```javascript
WebAssembly.instantiateStreaming(fetch("wasm-table.wasm")).then((obj) => {
  console.log(obj.instance.exports.callByIndex(0)); // 42
  console.log(obj.instance.exports.callByIndex(1)); // 13
  console.log(obj.instance.exports.callByIndex(2)); // エラー: 索引2は存在しない
});
```

`call_indirect (type $return_i32)` に型注釈が付いているのがポイントで、**呼び出し時にテーブル要素の実際の型と注釈が一致するかを実行時チェックする**。一致しなければトラップ（trap、実行中断）する。これは実質的に**制御フロー整合性（CFI）を言語レベルで強制している**ということで、C/C++をWasmにコンパイルしても「関数ポインタ書き換えで任意コード実行」という古典的な手口が成立しにくい理由になっている。ただし**同じ型シグネチャを持つ関数同士の入れ替えは防げない**ため、Wasm上のメモリ破壊バグが完全に無害になるわけではない。

テーブルとメモリは複数モジュール間で共有でき、これが**動的リンク**の基盤になる。

```wat
;; shared0.wat
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

```wat
;; shared1.wat
(module
  (import "js" "memory" (memory 1))
  (import "js" "table" (table 1 funcref))
  (type $void_to_i32 (func (result i32)))
  (func (export "doIt") (result i32)
    i32.const 0
    i32.const 42
    i32.store
    i32.const 0
    call_indirect (type $void_to_i32)
  )
)
```

```javascript
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
  console.log(results[1].instance.exports.doIt()); // 42
});
```

`shared1` が線形メモリのオフセット0に42を書き、テーブル索引0（= `shared0` の関数）を間接呼び出しし、その関数がオフセット0を読んで返す。両モジュールが同一のメモリ・テーブル実体を共有しているから成立する。**解析時にモジュールが複数ある場合、この共有関係を把握しないと片方だけ読んでもロジックが繋がらない。**

なお、テーブルはJS側からも操作できる。

```javascript
const tbl = new WebAssembly.Table({ initial: 2, element: "anyfunc" });
tbl.set(0, f1);
tbl.set(1, f2);
const result = tbl.get(0)(); // 索引0の関数を呼ぶ
```

テーブルがエクスポートされていれば、**自分の検証環境では `tbl.get(i)` で各スロットの実体を列挙し、`call_indirect` の飛び先候補を静的に絞り込める**。

最後に、多値返却（multi-value）も現在は利用できる。

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

呼び出し側から見れば「スタックに2つ積まれた」だけなので、`i32.add` がそのまま両方を消費できる。WAT読解時に「戻り値が1つのはずなのにスタックが合わない」と感じたら、多値返却を疑うとよい。

> 出典: Understanding WebAssembly text format（MDN Web Docs） — https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format

### wabt: WATとバイナリを往復するための公式ツールキット

WATをバイナリに、バイナリをWATに変換する標準的な道具が **WABT（WebAssembly Binary Toolkit、"wabbit" と発音する）** である。wabtは最適化プラットフォームではなく（それは Binaryen の役割）、**仕様への完全な忠実性——命令を一切変えずに1:1でラウンドトリップできること**を目指して設計されている。この「忠実さ」こそが解析ツールとして重要で、`wasm2wat` の出力は元のバイナリの命令列そのものだと信頼してよい。

wabt が同梱する主なツールは次のとおり（READMEの記載に基づく）。

| ツール | 役割 | 解析での使いどころ |
|---|---|---|
| `wat2wasm` | テキスト形式 → バイナリ形式へ変換 | PoC用の最小モジュールを自作して挙動を確かめる |
| `wasm2wat` | その逆変換（バイナリ → テキスト） | **最重要。まずこれで全体を読む** |
| `wasm-objdump` | wasmバイナリの情報を表示（objdump 相当） | セクション構成・import/export・data の一覧取得 |
| `wasm-interp` | スタックベースのインタプリタでデコードして実行 | ブラウザ無しで関数を動かし挙動を観察 |
| `wat-desugar` | S式/フラット/混在のWATを正準フラット形式で出力 | 異なるツール出力の diff を取る前処理 |
| `wasm2c` | wasmバイナリをCのソース＋ヘッダへ変換 | C読解に持ち込む・既存のC解析ツールを使う |
| `wasm-strip` | バイナリからセクションを除去 | 配布物の name section 有無の検証 |
| `wasm-validate` | バイナリ形式の妥当性検証 | 壊れた/改変されたモジュールの切り分け |
| `wast2json` | 仕様テスト形式ファイルをJSON＋wasm群へ変換 | 仕様準拠テスト資産の取り込み |
| `wasm-stats` | モジュールの統計情報を出力 | 命令分布から「暗号処理らしさ」等を推測 |
| `spectest-interp` | Spectest JSON を読み、インタプリタでテスト実行 | 仕様テストの再現 |

（READMEの一覧には含まれないが、wabt には逆コンパイル風の擬似コードを出力する `wasm-decompile` も同梱されている。WATより読みやすい高水準表現が欲しいときに併用する価値がある。）

#### 導入

最も手軽なのはパッケージマネージャ経由である。

```sh
brew install wabt
```

```sh
sudo apt install wabt
```

GitHub の releases ページから各プラットフォーム向けのビルド済みバイナリを落とすこともできる。ソースから入れる場合は、**サブモジュールを忘れずに取得する**こと（テストスイートと gtest が入っている）。

```console
$ git clone --recursive https://github.com/WebAssembly/wabt
$ cd wabt
$ git submodule update --init
```

CMake で直接ビルドする手順は次のとおり。

```console
$ mkdir build
$ cd build
$ cmake ..
$ cmake --build .
```

ここで **「ビルド成果物用のディレクトリを必ず別に作れ」** という注意がREADMEに明記されている。理由は具体的で、ビルドが生成する実行ファイル `wasm2c` が、リポジトリ直下にある `wasm2c` **ディレクトリ**と名前衝突するためである。リポジトリルートで `cmake` を走らせると失敗する。

トップレベルの `Makefile` 経由（内部で CMake → Ninja を呼ぶ）でもビルドできる。

```console
$ make
$ make clang-debug
$ make gcc-i686-release
```

ターゲット名は「コンパイラ（`gcc` / `clang` / `gcc-i686` / `emscripten`）- ビルド種別（`debug` / `release`）- 構成（空、`asan` / `msan` / `lsan` / `ubsan` / `fuzz` / `no-tests`）」の組み合わせで生成される。ただし macOS ではこの経路がうまく動かないことがあるとREADMEが注意しており、その場合は上のCMake直接ビルドに切り替える。

#### 使い方（READMEの実例）

`wat2wasm`:

```sh
# test.wat を解析し、同名の .wasm バイナリを書き出す
$ bin/wat2wasm test.wat

# test.wat を解析し、test.wasm へ書き出す
$ bin/wat2wasm test.wat -o test.wasm

# spec-test.wast を解析し、詳細出力（すべてのバイトの意味を含む）を標準出力へ
$ bin/wat2wasm spec-test.wast -v
```

3つ目の `-v` が、前述した「バイト単位の注釈付きダンプ」を出すモードである。**バイナリ形式そのものを学ぶ最良の教材**であり、自分で書いた1行のWATが何バイトになるかを確かめながらエンコーディングを体得できる。

`wasm2wat`:

```sh
# バイナリ test.wasm を解析して、テキスト test.wat を書き出す
$ bin/wasm2wat test.wasm -o test.wat
```

`wasm-interp`:

```sh
# test.wasm を解析し、型検査する
$ bin/wasm-interp test.wasm

# test.wasm を解析し、エクスポートされた全関数を実行する
$ bin/wasm-interp test.wasm --run-all-exports

# 全エクスポートを実行し、実行トレースを出力する
$ bin/wasm-interp test.wasm --run-all-exports --trace

# test.json を仕様テストとして実行する
$ bin/wasm-interp test.json --spec

# 値スタックのサイズを100要素にして全エクスポートを実行する
$ bin/wasm-interp test.wasm -V 100 --run-all-exports
```

`--trace` は解析実務でとりわけ有用だ。**ブラウザを起動せずに、命令単位の実行トレース（どの値がスタックに積まれ、どの分岐が取られたか）が得られる**ため、条件分岐が何を比較しているのかを「読む」代わりに「観測する」ことができる。ただし外部インポートに依存するモジュールはそのままでは動かないので、スタブを与えるか、対象関数だけを切り出して試すことになる。

なお、インストール不要で試したいだけなら、wabt は emscripten で JavaScript にコンパイルされたオンラインデモ（`wat2wasm` / `wasm2wat`）も公開されている。**ただし解析対象が第三者の成果物や機微を含む場合、外部ホストのWeb UIへアップロードするのは情報取り扱い上ふさわしくない。手元のバイナリを使うこと。**

#### 「デコードできない」ときの犯人はだいたい提案フラグ

wabt は WebAssembly の各**提案（proposal）**ごとに有効/無効フラグを持つ。READMEの対応表（2026年9月時点の `main` ブランチ）では、既定で有効なものと、明示的に有効化が必要なものが分かれている。

- **既定で有効**: 例外処理（`--disable-exceptions` で無効化）、可変グローバル、非トラップ float→int 変換、符号拡張、SIMD、multi-value、tail-call、bulk memory、reference types、annotations、memory64、multi-memory、extended-const、relaxed-simd
- **明示的に有効化が必要**: `--enable-threads`（スレッド）、`--enable-custom-page-sizes`、`--enable-compact-imports`、`--enable-function-references`、`--enable-wide-arithmetic`

例えば MDN のマルチメモリ例は、次のように書かれている。

```sh
wat2wasm --enable-multi-memory multi-memory.wat -o multi-memory.wasm
```

（multi-memory は現在の wabt では既定で有効だが、古いバージョンではこのフラグが必要だった。**フラグの既定値はバージョンで変わる**ため、自分の環境で `wat2wasm --help` を確認するのが確実である。）

実務上の教訓は明確だ。**`wasm2wat` が「unknown opcode」や「invalid」で落ちたら、まず壊れたファイルを疑う前に、そのバイナリが使っている提案が自分のwabtで有効かを疑う。** スレッド（アトミック命令）を使うモジュールは `--enable-threads` を付けないと読めず、これは実際によく遭遇する。同様に、wabtのバージョンが古くて新しい提案に未対応というケースもあるので、解析用のwabtは新しく保つのが望ましい。また、提案対応表には「binary / text / validate / interpret / wasm2c」の列があり、**同じ提案でもバイナリは読めるが `wasm-interp` では実行できない**、といった差がある点にも注意が要る（例えばスレッドや relaxed-simd、function-references は wasm2c 非対応）。

> 出典: WABT: The WebAssembly Binary Toolkit（GitHub） — https://github.com/WebAssembly/wabt

### 実践: 解析ワークフローの組み立て（自己所有環境）

ここまでの要素を、実際の手順として並べ直す。対象は**自分が権限を持つ環境の成果物、または自分でビルドしたモジュール**に限る。

1. **バイナリの取得と同定**
   `Content-Type: application/wasm` のレスポンス、あるいは先頭8バイトが `00 61 73 6d 01 00 00 00` のファイルを収集する。`file` コマンドや `xxd | head -1` で確認できる。

2. **妥当性確認**
   `wasm-validate target.wasm`。ここで落ちるなら、取得ミス（部分ダウンロード）か、提案フラグ不足かを切り分ける。

3. **インタフェースの棚卸し**
   `wasm-objdump -x target.wasm` でセクション一覧・import・export・関数型・テーブル・メモリ定義を得る。**ここが最も情報密度が高い**。import に何が並んでいるかで、モジュールの「できること」の上限が決まる。

4. **定数データの抽出**
   `wasm-objdump -s target.wasm`（生バイト表示）や、`wasm2wat` 出力中の `(data ...)` を読む。URL、エラーメッセージ、フォーマット文字列、Base64断片などが露出する。Wasmに秘密を埋めても秘密にならないことを、ここで実感できるはずだ。

5. **全体をテキスト化して読む**
   `wasm2wat target.wasm -o target.wat`。name section が残っていれば関数名が読め、読解コストが桁違いに下がる。無ければ `$func42` のような機械的な名前になるので、エクスポート名から辿って呼び出しグラフを手で埋めていく。

6. **読みやすさを上げる**
   `wasm-decompile` で擬似Cライクな表現を得る、あるいは `wasm2c` でCソースへ変換して既存のC読解手法・静的解析ツールに載せる。

7. **動的に観測する**
   `wasm-interp target.wasm --run-all-exports --trace` でトレースを取る。ブラウザ側で見たい場合は、自分の検証ページでインスタンス化し、`exports.memory` をダンプする、インポート関数を自前のログ関数に差し替えて `(offset, length)` から文字列を復元する、といった手が使える。**インポート関数の差し替えは、境界を通過するデータを丸ごと観測できる最も強力な方法**である。

8. **境界のsinkを評価する**
   最後に、Wasmではなく**グルーコード側**を読む。Wasmが返したポインタ/長さを、JSがどのAPIへ流しているか。`innerHTML`・`eval`・`location` へ届いていないか。Wasmから渡された値を信頼して検証を省いていないか。前節までのDOM XSS解析手法が、ここでそのまま接続する。

### 防御側の視点でのまとめ

- **Wasmは難読化ではない。** WATへ完全に戻せるうえ、線形メモリはJSから素通しで読める。認証トークン、APIキー、署名ロジック、ライセンス判定をWasmに置いても秘匿されない。秘密はサーバ側に置く、が唯一の正解である。
- **Wasmのサンドボックスは強いが、境界は弱くなりうる。** import として渡す能力を最小化すること（必要な関数だけを渡す）が、そのままWasmモジュールの権限最小化になる。DOM操作や `eval` をまとめて渡すグルー設計は避ける。
- **Wasm内部のメモリ破壊は「サンドボックス内」で起こりうる。** 線形メモリ内のバッファオーバーフローは、Wasmの検証機構では防げない（線形メモリ内であれば範囲外ではない）。ただし `call_indirect` の実行時型チェックにより、関数ポインタ経由の任意コード実行は同一シグネチャ間の入れ替えに限定される。C/C++由来のコードをWasmにしても、メモリ安全性の問題そのものは消えない。
- **name section とソースマップの取り扱い。** デバッグ情報が残ったモジュールを本番配布すると、内部構造が容易に読める。リリースビルドでは `wasm-strip` 等で除去し、必要なら別途シンボルを保管する運用にする。
- **バージョン依存に注意。** WebAssemblyは提案ベースで拡張が続いており、本節の記述（multi-memory が既定有効、threads が明示有効化、など）は **2026年9月時点の wabt `main` ブランチおよび MDN の記載**に基づく。解析環境の `wat2wasm --help` / `wasm2wat --help` で、自分のバージョンの既定値を都度確認すること。

Wasm解析は、専用の巨大な知識体系を要求するものではない。**「import/export で境界を押さえ、線形メモリで実データを観測し、WATで論理を読む」**——この3点を押さえれば、バイナリは十分に読めるものになる。そして最も価値のある脆弱性は、たいていWasmの中ではなく、Wasmとそれを呼ぶJavaScriptの継ぎ目に潜んでいる。
