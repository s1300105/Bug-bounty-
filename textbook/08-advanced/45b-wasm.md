# wasm を C に変換して読む ― wasm2c・wasm-decompile と WAT 正式文法

> **この節で分かること**
> - wasm2c で `.wasm` を等価な C ソースに変換し、ASAN などの既存の C 解析基盤に載せる手順を説明できる。
> - wasm2c ランタイムの trap 種別・メモリ／テーブル構造体・embedder（組み込み側）が実装すべき契約から、Wasm を組み込むネイティブアプリの脅威モデルを読み解ける。
> - wasm-decompile の C 風出力（`o[i]:int`、構造体推定、`label L:`、独自の演算子優先順位）を正しく読み、境界チェックの有無を見抜ける。
> - どの版の wabt に wasm-decompile が入っているか（1.0.41 が最後）を判断し、`.dcmp`・WAT・objdump を使い分けられる。
> - WAT の正式文法から `offset=`／`align=`・幅を狭めたロードの符号・全命令リストを読み、境界計算を誤らずにバグを探せる。
> - 「wasm を入手 → wat に戻す → 読解 → 動的確認 → C へ変換」の 10 ステップの解析ワークフローを自分で回せる。

**元資料**: https://github.com/WebAssembly/wabt （`wasm2c/README.md`, `docs/decompiler.md`, `man/wasm-decompile.1`, `src/tools/wasm-decompile.cc`, `test/decompile/*.txt`）／ https://github.com/WebAssembly/spec （`interpreter/README.md`）（いずれも原典取得済み。github.com の HTML ページは 503 のため、内容は同一の正規ソース `raw.githubusercontent.com` から逐語取得）
**関連する節**: 「WebAssembly テキスト形式（WAT）の理解と WABT ツールチェーン概観」（本節の前半パート。S 式・スタックマシン・線形メモリ・table・`wat2wasm`／`wasm2wat`／`wasm-objdump`／`wasm-interp` を扱う）

---

## 1. この節の位置づけ（前提の確認）

この節は「WAT と WABT」の後半である。前半で、**WebAssembly（略して Wasm）とは、ブラウザやサーバで動く低水準のバイナリ命令フォーマットのこと**で、その人間可読なテキスト表現が **WAT（WebAssembly Text format, `.wat`）**であること、そして **WABT（"wabbit" と読む WebAssembly Binary Toolkit）**という公式ツール群で `.wasm` を読める形に戻せることを扱った。

本節はそこから一歩進み、**Wasm を「読む」ための残り 3 つの武器**を扱う。

1. **wasm2c** ― `.wasm` を等価な C のソースに変換し、C 用の解析ツール（サニタイザ、ファザ）に載せる道具。
2. **wasm-decompile** ― `.wasm` を C 風の擬似コード（`.dcmp`）に逆コンパイルし、WAT より圧倒的に読みやすくする道具。
3. **WAT の正式文法** ― 前半の MDN 解説が意図的に省いた「全命令の網羅リスト」。境界計算の急所である `offset=` などがここで確定する。

最後に、これらを組み合わせた**バグハンティング用の解析ワークフロー**をまとめる。バグバウンティで `.wasm` を見つけたとき、何をどの順で叩けばよいかの地図になる。

〔前提のごく短い補足〕Wasm の実行は**スタックマシン**として定義される。命令は `i32`／`i64`（32／64 ビット整数）や `f32`／`f64`（32／64 ビット浮動小数点）の値をスタックに積んだり降ろしたりする。文字列などのデータは**線形メモリ（linear memory）**、すなわち「1 本の連続した生バイト配列」に置かれ、1 ページ = 64 KiB（65,536 バイト）である。関数ポインタ相当は **table**（関数参照の配列）と `call_indirect` 命令で実現する。以降はこの前提を使う。

---

## 2. wasm2c ― wasm を C に変換して既存の C 解析基盤に載せる

**出典**: `https://raw.githubusercontent.com/WebAssembly/wabt/HEAD/wasm2c/README.md`

### 2-1. なぜ C に変換するのか（設計意図）

Wasm 単体を解析するツールは、C/C++ の世界に比べればまだ少ない。一方 C の世界には、**ASAN（AddressSanitizer, メモリの範囲外アクセスを実行時に検出する仕組み）**や **UBSAN（UndefinedBehaviorSanitizer）**、libFuzzer といった成熟した解析基盤がそろっている。

**wasm2c は `.wasm` を等価な C のソースとヘッダに変換する。** これにより、Wasm の中身を C レベルで観測・計測できるようになる。生成される C コードは **C99 標準**を対象とする。ただし Wasm module が Wasm の threads/atomics（スレッド・原子操作）を使う場合は **C11 標準**を対象とする。

つまり wasm2c の狙いは「Wasm を、既に強力な解析ツールが存在する C の土俵に引きずり出す」ことである。診断では、Wasm 内部のメモリ操作の異常を C レベルのサニタイザで捕まえる、という使い方が中心になる。

### 2-2. チュートリアル: .wat -> .wasm -> .c

まず題材となる階乗関数を WAT で用意する（逐語）。

```wasm
(memory $mem 1)
(func (export "fac") (param $x i32) (result i32)
  (if (result i32) (i32.eq (local.get $x) (i32.const 0))
    (then (i32.const 1))
    (else
      (i32.mul (local.get $x) (call 0 (i32.sub (local.get $x) (i32.const 1))))
    )
  )
)
```

これを `fac.wat` に保存し、2 段階で変換する。まず `wat2wasm` で WAT をバイナリに、次に `wasm2c` で C に落とす。

```sh
$ wat2wasm fac.wat -o fac.wasm
```

```sh
$ wasm2c fac.wasm -o fac.c
```

これは `fac.c` と `fac.h` の 2 ファイルを生成する。C 側（`.c`）が実装、ヘッダ（`.h`）が外から呼ぶための宣言である。

### 2-3. 生成されるシンボルと使い方

`wasm2c` は `fac.wasm` module に基づいていくつかの C シンボルを生成する。名前の付け方（マングリング）を知っておくと、生成された C を読むときに迷わない。

| シンボル | 意味 |
| --- | --- |
| `w2c_fac` | `fac` module の**インスタンスを表す型**（構造体） |
| `wasm2c_fac_instantiate` | `w2c_fac` インスタンスを**構築する関数** |
| `wasm2c_fac_free` | インスタンスを**解放する関数** |
| `w2c_fac_fac` | エクスポートされた `fac` 関数そのもの（`w2c_fac` インスタンスに対して作用する） |

**エクスポートされる全シンボルは共通の module ID（`fac`）を共有する。** これはデフォルトでは module の name セクション、あるいは入力ファイル名に基づく。このプレフィックスは `-n/--module-name` コマンドラインフラグで上書きできる。

呼び出し側の `main.c` は次のようになる（逐語）。初期化 → インスタンス構築 → 呼び出し → 解放 → 後始末、という流れが読み取れる。

```c
#include <stdio.h>
#include <stdlib.h>

#include "fac.h"

int main(int argc, char** argv) {
  /* Make sure there is at least one command-line argument. */
  if (argc < 2) {
    printf("Invalid argument. Expected '%s NUMBER'\n", argv[0]);
    return 1;
  }

  /* Convert the argument from a string to an int. We'll implicitly cast the int
  to a `u32`, which is what `fac` expects. */
  u32 x = atoi(argv[1]);

  /* Initialize the Wasm runtime. */
  wasm_rt_init();

  /* Declare an instance of the `fac` module. */
  w2c_fac fac;

  /* Construct the module instance. */
  wasm2c_fac_instantiate(&fac);

  /* Call `fac`, using the mangled name. */
  u32 result = w2c_fac_fac(&fac, x);

  /* Print the result. */
  printf("fac(%u) -> %u\n", x, result);

  /* Free the fac module. */
  wasm2c_fac_free(&fac);

  /* Free the Wasm runtime state. */
  wasm_rt_free();

  return 0;
}
```

ここで最重要なのは呼び出し順序である。**`wasm_rt_init()` を最初に呼ばなければならない**（後述の embedder 契約）。

### 2-4. wasm2c 出力のコンパイルと最適化の注意

生成された C を、wasm2c 付属のランタイム実装と一緒にコンパイルする。

```sh
$ cc -o fac main.c fac.c wasm2c/wasm-rt-impl.c wasm2c/wasm-rt-mem-impl.c -Iwasm2c -lm
```

最適化に関する注意が原文にある（逐語訳）。**wasm2c は WebAssembly 仕様への準拠を維持するため、C コンパイラの特定の振る舞いに依存している。**特に「シグナリング」NaN を「クワイエット」NaN に変換する要件（NaN は非数を表す浮動小数点値。2 種類あり、扱いが仕様で決まっている）と、無限再帰が trap を生成する要件に関して。

最適化付き（`-O2` や `-O3` など）でコンパイルする場合、準拠を保つためにいくつかの最適化を無効にする必要がある。**GCC 11 ではコマンドライン引数 `-fno-optimize-sibling-calls -frounding-math -fsignaling-nans` を追加すれば十分なようである。clang 14 では `-fno-optimize-sibling-calls -frounding-math` だけで十分なようである。**

これを守らないと、C コンパイラの最適化が Wasm の意味を変えてしまい、「本来 trap するはずのコードが trap しない」といった観測ずれが起きる。解析目的で挙動を正しく再現したいなら、このフラグは外せない。

実行例（逐語）。

```sh
$ ./fac 1
fac(1) -> 1
$ ./fac 5
fac(5) -> 120
$ ./fac 10
fac(10) -> 3628800
```

ファイル一式は `wasm2c/examples/fac` にある。

### 2-5. `wasm_rt_trap_t` ― 安全違反の一覧（セキュリティ診断上もっとも重要な列挙）

生成ヘッダ `fac.h` は `wasm-rt.h` を取り込む。そこには **Wasm の実行が「どういう安全違反で停止するか」の一覧**が定義されている。trap（トラップ）とは、Wasm が安全規則に違反したときに実行を中断すること。この列挙はその理由の全リストである。

```c
typedef enum {
  WASM_RT_TRAP_NONE,
  WASM_RT_TRAP_OOB,
  WASM_RT_TRAP_INT_OVERFLOW,
  WASM_RT_TRAP_DIV_BY_ZERO,
  WASM_RT_TRAP_INVALID_CONVERSION,
  WASM_RT_TRAP_UNREACHABLE,
  WASM_RT_TRAP_CALL_INDIRECT,
  WASM_RT_TRAP_UNCAUGHT_EXCEPTION,
  WASM_RT_TRAP_EXHAUSTION,
} wasm_rt_trap_t;
```

各値のうち、診断でとくに意味が大きいものを挙げる。

| trap 値 | 何が起きたか | ブラウザ上での観測 |
| --- | --- | --- |
| `WASM_RT_TRAP_OOB` | 線形メモリ／table の**範囲外アクセス（Out Of Bounds）** | `WebAssembly.RuntimeError` |
| `WASM_RT_TRAP_CALL_INDIRECT` | 間接呼び出し（`call_indirect`）の**型不一致や範囲外** | `WebAssembly.RuntimeError` |
| `WASM_RT_TRAP_EXHAUSTION` | **スタック枯渇**（無限再帰など） | `WebAssembly.RuntimeError` |
| `WASM_RT_TRAP_INT_OVERFLOW` | 整数オーバーフロー（特定の変換で） | 同上 |
| `WASM_RT_TRAP_DIV_BY_ZERO` | ゼロ除算 | 同上 |
| `WASM_RT_TRAP_UNREACHABLE` | `unreachable` 命令の到達 | 同上 |

〔補足〕この列挙を頭に入れておくと、動的に Wasm を動かして `WebAssembly.RuntimeError` が出たときに「どの安全違反で止まったか」を推測できる。バグハンティングでは、`OOB` や `CALL_INDIRECT` が想定外の入力で起きないかを狙う。

### 2-6. ランタイムの型・funcref・memory・table の構造体

wasm2c ランタイムは、Wasm の値型・関数参照・メモリ・テーブルを、それぞれ C の構造体で表現する。これらの構造体は「Wasm のサンドボックス（隔離された実行環境）が C の世界でどう表現されるか」を示しており、脅威モデルを考えるうえで読む価値が高い。

**値型は 6 つ**である。

```c
typedef enum {
  WASM_RT_I32,
  WASM_RT_I64,
  WASM_RT_F32,
  WASM_RT_F64,
  WASM_RT_FUNCREF,
  WASM_RT_EXTERNREF,
} wasm_rt_type_t;
```

**関数コールバックは正規形に統一される。** table は任意の署名の関数を含み得るため、一度この汎用ポインタ型に落とす。

```c
typedef void (*wasm_rt_function_ptr_t)(void);
```

**関数参照（funcref）**は次の構造体で表す。`wasm_rt_func_type_t` は **`Z_[modname]_get_func_type` 関数で参照できる不透明な 256 ビット ID**（関数署名を一意に識別する値）である。`module_instance` は関数の出自である module インスタンスへのポインタで、func が呼ばれるときに渡される。

```c
typedef struct {
  wasm_rt_func_type_t func_type;
  wasm_rt_function_ptr_t func;
  void* module_instance;
} wasm_rt_funcref_t;
```

WebAssembly 1.0 ではこの funcref が全 table 要素の型だったが、その後 funcref は通常の値としても使えるようになり、table は externref 型として宣言することもできるようになった。

**memory インスタンス**の構造体は次のとおり。`data` は `size` バイトの線形メモリへのポインタである。

```c
typedef struct {
  uint8_t* data;
  uint32_t page_size;
  uint64_t pages, max_pages;
  uint64_t size;
  bool is64;
} wasm_rt_memory_t;
```

各フィールドの意味は次のとおり。

| フィールド | 意味 |
| --- | --- |
| `data` | `size` バイトの線形メモリへのポインタ |
| `size` | memory インスタンスの現在サイズ（バイト） |
| `pages` | 現在サイズ（ページ） |
| `page_size` | ページサイズ（バイト、**デフォルト 65,536**） |
| `max_pages` | module が指定した、または memory index type が許す最大ページ数 |
| `is64` | 2^64 バイトまで拡張できる memory では `true`、2^32 バイトに制限される memory では `false` |

**shared memory（共有メモリ）インスタンス**は通常の memory に似ているが、**複数の Wasm インスタンスから使用され得るメモリを表し、そのため操作に最低限のメモリ順序を強制する**。追加メンバ `mem_lock` は、スレッド安全性のために memory grow 操作中に使われるロックである。`data` が `_Atomic volatile` になっている点に注目。

```c
typedef struct {
  _Atomic volatile uint8_t* data;
  uint64_t pages, max_pages;
  uint64_t size;
  bool is64;
  mtx_t mem_lock;
} wasm_rt_shared_memory_t;
```

**table インスタンス**（funcref 版）の構造体。`data` は `size` 要素へのポインタ、`max_size` は最大サイズ、または**制限がない場合は `0xffffffff`**。

```c
typedef struct {
  wasm_rt_funcref_t* data;
  uint32_t max_size;
  uint32_t size;
} wasm_rt_funcref_table_t;
```

### 2-7. embedder が実装しなければならないランタイム契約（境界チェックの急所）

**embedder（組み込み側）とは、Wasm を自分のアプリに埋め込んで動かす側のこと。** wasm2c で吐いた C を実際に動かすには、embedder がいくつかの `wasm_rt_*` 関数を提供しなければならない。C の実装は `wasm-rt-impl.h` と `wasm-rt-impl.c` にある。

```c
void wasm_rt_init(void);
bool wasm_rt_is_initialized(void);
void wasm_rt_free(void);
void wasm_rt_trap(wasm_rt_trap_t) __attribute__((noreturn));
const char* wasm_rt_strerror(wasm_rt_trap_t trap);
void wasm_rt_allocate_memory(wasm_rt_memory_t*, uint32_t initial_pages, uint32_t max_pages, bool is64, uint32_t page_size);
uint32_t wasm_rt_grow_memory(wasm_rt_memory_t*, uint32_t pages);
void wasm_rt_free_memory(wasm_rt_memory_t*);
void wasm_rt_allocate_memory_shared(wasm_rt_shared_memory_t*, uint32_t initial_pages, uint32_t max_pages, bool is64, uint32_t page_size);
uint32_t wasm_rt_grow_memory_shared(wasm_rt_shared_memory_t*, uint32_t pages);
void wasm_rt_free_memory_shared(wasm_rt_shared_memory_t*);
void wasm_rt_allocate_funcref_table(wasm_rt_table_t*, uint32_t elements, uint32_t max_elements);
void wasm_rt_allocate_externref_table(wasm_rt_externref_table_t*, uint32_t elements, uint32_t max_elements);
void wasm_rt_free_funcref_table(wasm_rt_table_t*);
void wasm_rt_free_externref_table(wasm_rt_table_t*);
uint32_t wasm_rt_call_stack_depth; /* on platforms that don't use the signal handler to detect exhaustion */
void wasm_rt_init_thread(void);
void wasm_rt_free_thread(void);
```

契約の要点（逐語訳の要旨）を、診断の視点つきで整理する。

- **`wasm_rt_init` は他の何よりも先に embedder が呼ばなければならない。** `wasm_rt_free` はグローバル状態を解放。`wasm_rt_is_initialized` で初期化済みを確認できる。
- **`wasm_rt_trap` は module が trap したときに呼ばれる関数。** 実装例としては C++ 例外を投げる、あるいは単にプログラム実行を abort する。**wasm2c 同梱のデフォルトランタイムは `longjmp` でスタックを巻き戻す。** ホストはランタイムを `WASM_RT_TRAP_HANDLER` にトラップハンドラ関数名を定義してコンパイルすることでこの `longjmp` を上書きできる。ハンドラは `wasm_rt_trap_t` を引数に取り `void` を返す関数（例: `-DWASM_RT_TRAP_HANDLER=my_trap_handler`）。
- **`wasm_rt_allocate_memory` は memory インスタンスを初期化し、指定初期ページ数分以上を確保する。** 各ページは `page_size` バイトで、**custom-page-sizes 機能を使わない限り `WASM_DEFAULT_PAGE_SIZE`（64 KiB）でなければならない**。**メモリはゼロクリアされなければならない。** `is64` は memory が i32 か i64 のアドレスでインデックスされるかを示す。
- **`wasm_rt_grow_memory` は指定ページ数分 memory を拡張しなければならない。** 十分なメモリがない場合、または新しいページ数が最大ページ数を超える場合、**`0xffffffff` を返して失敗しなければならない。** 成功した場合は以前のサイズをページ単位で返す。ホストは `WASM_RT_GROW_FAILED_HANDLER` に関数名を定義することで失敗を通知され得る（例: `-DWASM_RT_GROW_FAILED_HANDLER=my_growfail_handler`）。
- **`wasm_rt_allocate_funcref_table`／`..._externref_table`** は指定型の table を初期化し、指定初期要素数分以上を確保する。**要素はゼロクリアされなければならない。**
- **`wasm_rt_call_stack_depth`** は現在のスタック呼び出し深さ。module 間で共有されるため、**embedder が一度だけ定義しなければならない**。シグナルハンドラで枯渇を検出しないプラットフォームでのみ使われる。
- **`wasm_rt_init_thread`／`wasm_rt_free_thread`** は、`wasm_rt_init` を呼んだスレッド以外のスレッドのランタイム状態を初期化・解放する。例は `wasm2c/examples/threads`。

〔補足（診断上の急所）〕この契約リストは、**Wasm を組み込むネイティブアプリの攻撃点を探す地図**でもある。とくに `wasm_rt_grow_memory` の「失敗時に `0xffffffff` を返す」という約束は、呼び出し側が戻り値を検証せずに使うと**サイズ計算の誤り（`0xffffffff` を成功サイズと勘違い）**につながる。「メモリはゼロクリア必須」「要素はゼロクリア必須」も、実装がサボると**未初期化メモリの読み出し**の温床になる。

### 2-8. 例外処理のためのランタイムサポート

wasm2c を例外サポート付きで実行する場合（避けたいなら `--disable-exceptions` を使う）、追加シンボルを定義しなければならない。`wasm-rt-exceptions.h` に定義され、C 実装は `wasm-rt-exceptions-impl.c` にある。

```c
void wasm_rt_load_exception(const char* tag, uint32_t size, const void* values);
WASM_RT_NO_RETURN void wasm_rt_throw(void);
WASM_RT_UNWIND_TARGET
WASM_RT_UNWIND_TARGET* wasm_rt_get_unwind_target(void);
void wasm_rt_set_unwind_target(WASM_RT_UNWIND_TARGET* target);
uint32_t wasm_rt_exception_tag(void);
uint32_t wasm_rt_exception_size(void);
void* wasm_rt_exception(void);
wasm_rt_try(target)
```

意味の要旨: `wasm_rt_load_exception` はアクティブな例外を指定の tag・size・内容に設定。`wasm_rt_throw` はアクティブな例外を投げる。`WASM_RT_UNWIND_TARGET` は例外が投げられ捕捉された場合の unwind target（巻き戻し先）の型。`wasm_rt_get_unwind_target`／`wasm_rt_set_unwind_target` は現在の unwind target を取得／設定。`wasm_rt_exception_tag`／`wasm_rt_exception_size`／`wasm_rt_exception` はアクティブな例外の tag・size・内容を返す。`wasm_rt_try(target)` は現在の呼び出し環境を unwind target として捕捉し `target`（型は `WASM_RT_UNWIND_TARGET`）に格納するマクロである。

### 2-9. エクスポートの扱い（関数以外）

エクスポートされた関数は、ヘッダにプレフィックス付きの等価な関数を宣言することで扱われる。**module が関数をインポートする場合、`wasm2c` は出力ヘッダにその関数を宣言し、ホスト側がその定義を提供する責任を持つ。** この「ホストが定義を提供する」箇所が、後述の脆弱パターンの舞台になる。

一方、globals（グローバル変数）、memories、tables のエクスポートは扱いが違う。これらは module インスタンスの一部であり、各インスタンスが自身のエクスポートを持てるため、`wasm2c` は**module インスタンスを引数に取り、対応するエクスポートを返す関数**を提供する。たとえば次のメモリエクスポートに対して、

```wasm
(export "mem" (memory $mem))
```

wasm2c はヘッダに次を宣言する。

```c
/* export: 'mem' */
wasm_rt_memory_t* w2c_fac_mem(w2c_fac* instance);
```

定義は次のようになる。

```c
/* export: 'mem' */
wasm_rt_memory_t* w2c_fac_mem(w2c_fac* instance) {
  return &instance->w2c_mem;
}
```

### 2-10. 生成された `fac.c` の中身（Wasm 命令との 1:1 対応）

生成ヘッダ `fac.h` の骨格は次のようになる。`w2c_fac` 型・インスタンス化・解放・エクスポート関数の宣言が並ぶ。

```c
/* Automatically generated by wasm2c */
#ifndef FAC_H_GENERATED_
#define FAC_H_GENERATED_

...

#include "wasm-rt.h"

...
#ifndef WASM_RT_CORE_TYPES_DEFINED
#define WASM_RT_CORE_TYPES_DEFINED

...

#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct w2c_fac {
  char dummy_member;
} w2c_fac;

void wasm2c_fac_instantiate(w2c_fac*);
void wasm2c_fac_free(w2c_fac*);
wasm_rt_func_type_t wasm2c_fac_get_func_type(uint32_t param_count, uint32_t result_count, ...);

/* export: 'fac' */
u32 w2c_fac_fac(w2c_fac*, u32);

#ifdef __cplusplus
}
#endif

#endif  /* FAC_H_GENERATED_ */
```

`fac.c` の中身は内部実装だが、仕組みを少し見ておくと有用である。**最初の数百行は各種 WebAssembly 命令を実装するのに使われるマクロを定義している。** 続いて各種初期化関数（`init`、`free`、`init_func_types`、`init_globals`、`init_memory`、`init_table`、`init_exports`）がある。

もっとも興味深いのが `fac` 関数の本体である。

```c
static u32 w2c_fac_fac_0(w2c_fac* instance, u32 var_p0) {
  FUNC_PROLOGUE;
  u32 var_i0, var_i1, var_i2;
  var_i0 = var_p0;
  var_i1 = 0u;
  var_i0 = var_i0 == var_i1;
  if (var_i0) {
    var_i0 = 1u;
  } else {
    var_i0 = var_p0;
    var_i1 = var_p0;
    var_i2 = 1u;
    var_i1 -= var_i2;
    var_i1 = w2c_fac_fac_0(instance, var_i1);
    var_i0 *= var_i1;
  }
  FUNC_EPILOGUE;
  return var_i0;
}
```

元の WebAssembly を **flat format（平坦形式）**で見ると、C 出力に **1:1 の対応**があるのが分かる。flat format とは、命令を 1 個ずつ縦に並べた（括弧で入れ子にしない）書き方である。

```wasm
(func $fac (param $x i32) (result i32)
  local.get $x
  i32.const 0
  i32.eq
  if (result i32)
    i32.const 1
  else
    local.get $x
    local.get $x
    i32.const 1
    i32.sub
    call 0
    i32.mul
  end)
```

これは 2-2 の階乗関数と違って見えるが、それは **"folded format"（折り畳み形式）ではなく "flat format" を使っているから**である。folded format は S 式で入れ子にした書き方で、flat format は命令を縦に並べた書き方。両者は `wat-desugar` で相互変換して確認できる。

```sh
$ wat-desugar fac-flat.wat --fold -o fac-folded.wat
```

折り畳むと次の formatになる。

```wasm
(module
  (func (;0;) (param i32) (result i32)
    (if (result i32)  ;; label = @1
      (i32.eq
        (local.get 0)
        (i32.const 0))
      (then
        (i32.const 1))
      (else
        (i32.mul
          (local.get 0)
          (call 0
            (i32.sub
              (local.get 0)
              (i32.const 1)))))))
  (export "fac" (func 0))
  (type (;0;) (func (param i32) (result i32))))
```

**書式が違い、変数名と関数名は失われているが、構造は同じである。**

〔補足〕`(;0;)` は wabt が生成するインデックス注釈コメントである。名前が無い関数・型に対して `wasm2wat` が自動で付けるので、WAT を読むときの目印になる。

### 2-11. 複数インスタンス化とホスト関数の脆弱パターン（どこを突くか）

memory などの実行コンテキスト情報は module インスタンス構造体にカプセル化され、その構造体へのポインタが関数呼び出しを通して渡される。したがって**同じ module の複数インスタンスを並べてインスタンス化できる**。これは Wasm のサンドボックスが「インスタンス単位」で切られていることの表れである。

`rot13`（文字を 13 個ずらす簡単な暗号）の例では、ホスト側が 2 つのインスタンスを作り、それぞれに独立したメモリを与えている（逐語）。

```c
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>

#include "rot13.h"

/* Define structure to hold the imports */
typedef struct w2c_host {
  wasm_rt_memory_t memory;
  char* input;
} w2c_host;

/* Accessor to access the memory member of the host */
wasm_rt_memory_t* w2c_host_mem(w2c_host* instance) {
  return &instance->memory;
}

int main(int argc, char** argv) {
  /* Make sure there is at least one command-line argument. */
  if (argc < 2) {
    printf("Invalid argument. Expected '%s WORD...'\n", argv[0]);
    return 1;
  }
  /* Initialize the Wasm runtime. */
  wasm_rt_init();

  /* Create two `host` instances to store the memory and current string */
  w2c_host host_1, host_2;
  wasm_rt_allocate_memory(&host_1.memory, 1, 1, false, WASM_DEFAULT_PAGE_SIZE);
  wasm_rt_allocate_memory(&host_2.memory, 1, 1, false, WASM_DEFAULT_PAGE_SIZE);

  /* Construct the `rot13` module instances */
  w2c_rot13 rot13_1, rot13_2;
  wasm2c_rot13_instantiate(&rot13_1, &host_1);
  wasm2c_rot13_instantiate(&rot13_2, &host_2);

  /* Call `rot13` on the first two arguments. */
  assert(argc > 2);
  host_1.input = argv[1];
  w2c_rot13_rot13(&rot13_1);
  host_2.input = argv[2];
  w2c_rot13_rot13(&rot13_2);

  /* Free the rot13 instances. */
  wasm2c_rot13_free(&rot13_1);
  wasm2c_rot13_free(&rot13_2);

  /* Free the Wasm runtime state. */
  wasm_rt_free();

  return 0;
}

/* Fill the wasm buffer with the input to be rot13'd.
 *
 * params:
 *   instance: An instance of the w2c_host structure
 *   ptr: The wasm memory address of the buffer to fill data.
 *   size: The size of the buffer in wasm memory.
 * result:
 *   The number of bytes filled into the buffer. (Must be <= size).
 */
u32 w2c_host_fill_buf(w2c_host* instance, u32 ptr, u32 size) {
  for (size_t i = 0; i < size; ++i) {
    if (instance->input[i] == 0) {
      return i;
    }
    instance->memory.data[ptr + i] = instance->input[i];
  }
  return size;
}

/* Called when the wasm buffer has been rot13'd.
 *
 * params:
 *   w2c_host: An instance of the w2c_host structure
 *   ptr: The wasm memory address of the buffer.
 *   size: The size of the buffer in wasm memory.
 */
void w2c_host_buf_done(w2c_host* instance, u32 ptr, u32 size) {
  /* The output buffer is not necessarily null-terminated, so use the %*.s
   * printf format to limit the number of characters printed. */
  printf("%s -> %.*s\n", instance->input, (int)size, &instance->memory.data[ptr]);
}
```

〔補足（診断上の要点）〕この `w2c_host_fill_buf` は、**ホスト関数（インポート関数）の典型的な脆弱パターン**を示している。`instance->memory.data[ptr + i] = ...` の行は、`ptr` を検証していない。もし `ptr` が線形メモリのサイズを超えていれば、これは**ホスト側でのヒープ外書き込み**になる。

この例では `ptr` は Wasm module 自身が渡すので実害はないが、一般に**ホスト側のインポート関数がポインタ引数を検証しないと、Wasm サンドボックスを突破してホストのメモリを壊せる**。Wasm を組み込むネイティブアプリ（ブラウザ拡張、プラグイン、エッジランタイムなど）を診断するときは、**import されたホスト関数の境界チェックが最初に見る場所**である。`w2c_host_buf_done` のコメント「出力バッファは必ずしもヌル終端されていない」も、Wasm 由来のバッファを C 文字列として扱う際の典型的な落とし穴を示している。

### 2-12. Segue 最適化・サニティチェック（どう動くか、どう守るか）

**追加のサニティチェック**として、wasm2c は **`WASM_RT_SANITY_CHECKS`** マクロを提供する。定義すると生成コード内で追加の健全性チェックが有効になる。ただし**性能オーバーヘッドが大きい可能性があり、デバッグビルドでのみ推奨**される。診断のときは、このマクロを有効にしたうえで ASAN/UBSAN と組み合わせると、Wasm 内部のメモリ操作の異常を最大限あぶり出せる。

**Segue（セグ）最適化**は Linux x86_64 固有の高速化である。**Segue 最適化は、x86 のセグメントレジスタを使って Wasm の線形メモリの位置を保持する。** 条件は「clang で Wasm module をコンパイルし、x86_64 Linux で動作し、マクロ `WASM_RT_ALLOW_SEGUE` が定義され、フラグ `-mfsgsbase` が clang に渡される」こと。Segue が使われないのは以下の場合（逐語訳）。

1. Wasm module が「非共有・デフォルトページ・32 ビットのインポートまたはエクスポートされた memory をちょうど 1 個」使っていない場合。
2. wasm2c コードが GCC でコンパイルされる場合。Segue は `(rd|wr)gsbase` のイントリンシック、ポインタアクセス用の "address namespaces"、カスタム "address namespaces" 付きポインタに対する memcpy のサポートを要求する。GCC は memcpy の要件をサポートしない。
3. Windows 向けにコンパイルされる場合。Windows はコンテキストスイッチ時にセグメントレジスタを復元しないため。

生成コードは wasm2c module への関数呼び出し時に未使用のセグメントレジスタ（x86_64 Linux では `%gs`）を設定し、外部 module への呼び出し後に復元する。**C で書かれたホスト関数は、C コードが未使用セグメントレジスタ `%gs` を変更しないため、変更なしで動作し続ける。ただしアセンブリで書かれ、空きセグメントレジスタを破壊するホスト関数は、wasm2c 生成コードを実行または制御を戻す前にこのレジスタの値を復元しなければならない。**

追加の最適化として、ホストプログラムが `%gs` セグメントレジスタを他の目的に使わない場合（多くのプログラムでは通常そう）、**`WASM_RT_SEGUE_FREE_SEGMENT` マクロを定義することで、古い値を復元せずに無条件に `%gs` を上書きすることを許可できる**。Segue の性能は Dhrystone（古典的なベンチマーク）で試せる。

```bash
cd wasm2c/benchmarks/segue && make
```

---

## 3. wasm-decompile ― C 風擬似コードで「読む」

ここからは、遮断された URL `https://webassembly.github.io/wabt/doc/wasm-decompile.1.html` の中身（man ページ）と、その HTML には載っていない設計文書・実装・出力例を、wabt リポジトリから取得してまとめる。**wasm-decompile は `.wasm` を C 風の可読な擬似コードに逆コンパイルするツール**で、WAT より圧倒的に読みやすい出力を出す。

出典（すべて `raw.githubusercontent.com` 経由で HTTP 200 を確認。`webassembly.github.io` 自体は組織の egress ポリシーで遮断）。

| 資料 | URL | サイズ |
| --- | --- | --- |
| 設計文書（HTML man ページには無い） | `https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/docs/decompiler.md` | 7,132 bytes |
| man ページ mdoc ソース（最終収録版） | `https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/man/wasm-decompile.1` | 2,076 bytes |
| 実装（処理パイプラインの確認用） | `https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/src/tools/wasm-decompile.cc` | 4,085 bytes |
| README のツール一覧と使用法 | `https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/README.md` | — |
| 出力例（期待値テスト） | `https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/test/decompile/{basic,names,precedence}.txt` | 4,665 / 2,347 / 815 bytes |

> ### 📌 ここは自分で開いて読んでください
> **資料**: WABT の man ページ HTML 版とブラウザデモ（`wasm-decompile.1.html` ほか 11 本、および `demo/`）— https://webassembly.github.io/wabt/doc/wasm-decompile.1.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `webassembly.github.io` がサイト側・組織側のネットワーク制限で遮断され、curl は CONNECT 403、WebFetch は EGRESS_BLOCKED、アーカイブ経路もすべて 403）。以下の記述は、同じ内容の正規ソースである wabt リポジトリの mdoc ソース `man/*.1`・設計文書 `docs/decompiler.md`・実装・期待値テストから逐語で再現した要約である。
> **読みどころ**:
> 1. `wasm-decompile.1.html` を開いて、自分の環境の wabt に `wasm-decompile` が入っているかの判断材料を得る（1.0.42 以降のサイトからはリンク切れになっている可能性がある。手元で `wasm-decompile --help` を叩くほうが確実）。
> 2. 各ツールの man ページ HTML の OPTIONS 節で、自分がインストールした版のオプションを確認する（**機能フラグは `--enable-*` と `--disable-*` の向きが版によって反転する**）。
> 3. `demo/wat2wasm/` と `demo/wasm2wat/` で、ローカルに wabt をビルドできない環境でも WAT ↔ wasm 変換を試す。ただし**バウンティ対象の `.wasm` は第三者ホストのデモに貼らず、ローカルツールで扱うこと**。
> **代替手段**: `https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/man/<tool>.1`（mdoc 形式。`man ./wasm-decompile.1` でローカル整形表示できる）。設計は `docs/decompiler.md`（HTML man ページより詳しい）。ローカルに `sudo apt install wabt` / `brew install wabt`、`wasm-decompile` が必要なら 1.0.41 以前を選ぶ。

### 3-1. どの版に `wasm-decompile` があるか（全数確認の結果）

wasm-decompile は、いつでも手に入るわけではない。**リリース版 1.0.29〜1.0.41 のすべてに同梱されており、1.0.42 で削除された**（`main` にも存在しない）。タグを 1 つずつ HTTP で叩いて確認した結果を、そのまま記録する。

| タグ / ブランチ | `src/tools/wasm-decompile.cc` | `man/wasm-decompile.1` | `docs/decompiler.md` |
| --- | --- | --- | --- |
| 1.0.29 | 200 | 200 | 200 |
| 1.0.32 | 200 | 200 | 200 |
| 1.0.33 | 200 | 200 | 200 |
| 1.0.34 | 200 | 200 | 200 |
| 1.0.35 | 200 | 200 | 200 |
| 1.0.36 | 200 | 200 | 200 |
| 1.0.37 | 200 | 200 | 200 |
| 1.0.38 | 200 | 200 | 200 |
| 1.0.39 | 200 | 200 | 200 |
| 1.0.40 | 200 | 200 | 200 |
| **1.0.41** | **200** | **200** | **200** |
| **1.0.42** | **404** | **404** | **404** |
| `main` | 404 | 404 | 404 |

補強証拠。

- `CMakeLists.txt` 内の文字列 `decompil` の出現件数: **1.0.40 / 1.0.41 では 8 件**、**1.0.42 と `main` では 0 件**。
- 1.0.41 の `CMakeLists.txt` の該当箇所（逐語）。

```cmake
  src/decompiler.cc
  ...
  include/wabt/decompiler-ast.h
  include/wabt/decompiler-ls.h
  include/wabt/decompiler-naming.h
  include/wabt/decompiler.h
  ...
  # wasm-decompile
  wabt_executable(
    NAME wasm-decompile
    SOURCES src/tools/wasm-decompile.cc
    INSTALL
  )
```

- 1.0.41 の `README.md` 内の `wasm-decompile` 出現回数は **4 回**、1.0.42 と `main` では **0 回**。
- `main` 上で `src/decompiler.cc`、`include/wabt/decompiler.h`、`src/wasm-decompile.cc`、`tools/wasm-decompile.cc` をそれぞれ試したがすべて 404。**移動ではなく削除である。**
- 存在するリリースタグの上限も確認: `1.0.41` と `1.0.42` は 200、`1.0.43` と `1.1.0` は 404。

**結論: `wasm-decompile` は 1.0.41 が最後の収録版であり、1.0.42 で削除された。** `apt install wabt` / `brew install wabt` で入る版に含まれるかはディストリのバージョン次第なので、**`wasm-decompile --help` が通るかで判定する**（通れば 1.0.41 以前だと分かる）。

### 3-2. README の記載と Running wasm-decompile

1.0.41 の README のツール一覧には、この 1 行がある（逐語）。

```markdown
 - [**wasm-decompile**](https://webassembly.github.io/wabt/doc/wasm-decompile.1.html): decompile a wasm binary into readable C-like syntax.
```

このリンク先が、まさに取得を遮断された URL である。README の "Running wasm-decompile" 節（逐語）は、基本的な使い方を示す。

````markdown
## Running wasm-decompile

For example:

```sh
# parse binary file test.wasm and write text file test.dcmp
$ bin/wasm-decompile test.wasm -o test.dcmp
```

You can use `--help` to get additional help:

```console
$ bin/wasm-decompile --help
```

See [decompiler.md](docs/decompiler.md) for more information on the language
being generated.
````

つまり基本の使い方は `wasm-decompile test.wasm -o test.dcmp` の 1 行だけである。出力の拡張子 `.dcmp` は decompile の略。

### 3-3. man ページ全文（オプション一覧）

以下が man ページ（タグ 1.0.41 = 最終収録版）の全文である。DESCRIPTION・OPTIONS・EXAMPLES・SEE ALSO・BUGS まで含む。

```
NAME
     wasm-decompile - translate from the binary format to readable C-like syntax

SYNOPSIS
     wasm-decompile [options] file

DESCRIPTION
     wasm-decompile Read a file in the WebAssembly binary format, and convert
     it to a decompiled text file.

     The options are as follows:
     --help                              Print a help message
     --version                           Print version information
     -o, --output=FILENAME               Output file for the decompiled file,
                                         by default use stdout
     --enable-exceptions                 Enable Experimental exception handling
     --disable-mutable-globals           Disable Import/export mutable globals
     --disable-saturating-float-to-int   Disable Saturating float-to-int operators
     --disable-sign-extension            Disable Sign-extension operators
     --disable-simd                      Disable SIMD support
     --enable-threads                    Enable Threading support
     --enable-function-references        Enable Typed function references
     --disable-multi-value               Disable Multi-value
     --enable-tail-call                  Enable Tail-call support
     --disable-bulk-memory               Disable Bulk-memory operations
     --disable-reference-types           Disable Reference types (externref)
     --enable-annotations                Enable Custom annotation syntax
     --enable-code-metadata              Enable Code metadata
     --enable-gc                         Enable Garbage collection
     --enable-memory64                   Enable 64-bit memory
     --enable-multi-memory               Enable Multi-memory
     --enable-extended-const             Enable Extended constant expressions
     --enable-all                        Enable all features
     --ignore-custom-section-errors      Ignore errors in custom sections

EXAMPLES
     Parse binary file test.wasm and write text file test.dcmp

           $ wasm-decompile test.wasm -o test.dcmp

SEE ALSO
     wasm-interp(1), wasm-objdump(1), wasm-stats(1), wasm-strip(1),
     wasm-validate(1), wasm2c(1), wasm2wat(1), wast2json(1), wat-desugar(1),
     wat2wasm(1), spectest-interp(1)

BUGS
     If you find a bug, please report it at
     https://github.com/WebAssembly/wabt/issues .
```

〔重要〕**`wasm-decompile` には `wasm2wat` の `--generate-names` / `--no-debug-names` / `-f, --fold-exprs` に相当するオプションが無い。** 名前生成は常に自動で行われる（3-4 で確認する）。実質的な制御点は、出力先の指定（`-o`）、機能フラグ（`--enable-*` / `--disable-*`）、そして `--ignore-custom-section-errors` だけである。

〔補足〕`--enable-*` と `--disable-*` の向きに注目。1.0.41 の wasm-decompile は `--enable-exceptions` / `--enable-tail-call` / `--enable-annotations` / `--enable-memory64` / `--enable-multi-memory` / `--enable-extended-const` が **enable 形**である。現在の HEAD の他ツールは `--disable-*` 形になっているものがあり、向きが逆なのは、このツールが更新されずに取り残されていたためである。**手元の `--help` が最終的な正解**なので、自分の環境のフラグは必ず確認する。

### 3-4. 出力言語の設計（`docs/decompiler.md` の全訳）

これが HTML man ページには載っていない、もっとも価値の高い資料である。ここを読むと `.dcmp` の記号がすべて意味を持って見えてくる。

#### 目的と非目的（なぜこの形なのか）

目的（逐語訳）は次のとおり。

> このツールは、**大量の Wasm コードを「読む」ことができるようになりたいユーザ**、すなわち言語・ランタイム・ツールの開発者、あるいは生成された wasm のソースコードが手元に無い、または生成コードが何をしているのか理解しようとしているプログラマ全般を対象としている。
>
> 構文は、**下層の Wasm の構成要素がはっきり見えることを保ちながら、可能なかぎり軽量かつ可読になるよう**設計されている。

冒頭の説明（逐語訳）: バイナリ wasm module を、**（C 系言語のユーザにとって）はるかにコンパクトで馴染みのあるテキスト形式に逆コンパイルする**。

非目的（Non-goals、逐語訳）は次のとおり。

> プログラミング言語であること。
>
> この出力コードを wasm module にコンパイルし戻すことは可能だが、そのような機能は現在提供されていない。**この形式は Wasm 自体と同様に非常に低水準であり、`.wat` 形式より高水準に見えても、汎用プログラミングに適しているわけではない。**

〔補足（診断上の含意）〕`.dcmp` は**読むための形式であり、編集して再ビルドする形式ではない**。PoC（概念実証コード）を作るときは WAT に戻って `wat2wasm` を使う。`.dcmp` は「当たりを付ける」段で使い、確証は `wasm-objdump -d` / WAT で取るのが正しい使い分けになる。

#### 命名（どこから名前を持ってくるか）

`wasm-decompile` は `wasm2wat` と同様に、名前を次の優先順位で導出する。

1. **name セクション**（最も優先。デバッグ用に埋め込まれる名前情報）
2. **リンカシンボル**（利用可能なら）
3. **import / export 名**（上記 2 つが無い場合）

名前が一切無いものには `a`, `b`, `c`, … と順に生成名が与えられる。さらに、引数・ローカル以外のものには**接頭辞**が付く。関数は `f_`、グローバルは `g_` など。

原文の注記（逐語訳）。

> 既存の名前は "demangle" された C++ 関数シグネチャとして生成されることがあり、STL 型を使う関数の場合は**数百文字の長さ**になることがある。識別子として通常使われない文字を除くほか、**デコンパイラはこれらから一般的なキーワード／型を削り落として長さを減らそうとする**。

> リンカシンボルは通常 wasm の `.o` ファイルにしか存在しないが、命名に有用な場合は **`wasm.ld` に `--emit-reloc` フラグを渡すことで、完全にリンクされた wasm module にも保持できる**。これにより **`--strip-debug` が使われていても大半の関数の名前が得られる**。

〔補足（診断上の要点）〕最後の一文は実務的に重要である。**リリースビルドで `--strip-debug`（デバッグ情報の除去）されていても、リンカが `--emit-reloc` を付けていれば linking セクションのシンボル表から関数名が復元できる**。`wasm-objdump -h` で `linking` カスタムセクションの有無を確認する価値がある。

#### トップレベル宣言

トップレベルの項目には `import` または `export` を前置できる。宣言の書式は次のとおり（原文逐語）。

| 種別 | 構文（原文逐語） |
| --- | --- |
| Memory | `memory m(initial: 1, max: 0);` |
| Global | `global my_glob:int;` |
| Data | `data d_a(offset: 0) = "Hello, World!";` |
| Function | `function f(a:int, b:int):int { return a + b; }` |

#### 文と式（statement と expression の区別）

ここが `.dcmp` を読むうえで独特な点である。

> **ちょうど 1 個の値をスタックに残す Wasm 命令列に対しては式（expression）が生成される。**
>
> **値をスタックに残さない命令に対しては文（statement）が生成される。** 文とは、制御フローブロックまたは関数自身の文脈において、それ自身の行に置かれる式である。分岐命令のように制御フロー経由で値を返す式に対しても文が生成されることがある。
>
> **複数の値をスタックに残す命令、あるいは「式の順序」を壊すようなスタック操作を行う命令については、値を一時変数（`t1`, `t2` など）に書き出させ**、後続の命令がそれを操作できるようにする（**これは MVP のみのコードでは起こらない**）。

MVP とは Minimum Viable Product、Wasm 1.0 の最小機能セットのこと。つまり `t1`, `t2` という一時変数が現れたら、multi-value など MVP 以降の機能を使っているサインである。

#### 引数とローカルの宣言

引数は関数シグネチャで定義される。**ローカルは最初の使用箇所で定義される**（C のような先頭宣言ではない）。書式は `var my_local:int = 1;`。

#### 型（`byte`/`short` が出たら幅の狭いロード）

デコンパイラが使う型は次のとおり。

| `.dcmp` の型 | 対応する Wasm |
| --- | --- |
| `int` | 32 ビット整数 |
| `long` | 64 ビット整数 |
| `float` | 32 ビット浮動小数点数 |
| `double` | 64 ビット浮動小数点数 |
| `byte` / `ubyte`（8 ビット） | **特定の load / store でのみ使われる** |
| `short` / `ushort`（16 ビット） | 同上 |
| `uint` | 同上（符号なし 32 ビット） |

〔補足（診断上の要点）〕`byte`/`ubyte`/`short`/`ushort` が現れた箇所は、元の Wasm では `i32.load8_s` / `i32.load8_u` / `i32.load16_s` / `i32.load16_u` などの**幅を狭めたロード**である。符号付き（`byte`/`short`）と符号なし（`ubyte`/`ushort`）の取り違えは、**長さ計算やインデックス計算での符号拡張バグ**の典型的な発生源であり、`.dcmp` 上で型名として可視化されるのは大きな利点である。

#### ロードとストア（最重要節）

ここが Wasm を読むうえで一番難しく、そして一番バグが潜む場所である。原文の書き出し（逐語訳）。

> これらは Wasm コードの中で最も「読む」のが難しい部分である傾向がある。**Wasm のコンパイル元言語が操作していたデータ構造と型の文脈をすべて失っている**からである。

`wasm-decompile` はこれを読みやすくするため、いくつもの工夫を持つ。順に見る。

**(1) 基本形は配列インデックス操作に見える。**

> `o[2]:int` は「`o` を int の配列として見たときの要素 2 を読む」という意味である。**したがってこれはバイトオフセット 8 の位置の 4 バイトにアクセスする。**

ここが最重要。`[]` の中はスケール前のインデックスであり、**実効バイトオフセットは「インデックス × 型サイズ」**である（`int` は 4 バイトなので、要素 2 はバイトオフセット 8）。

**(2) ポインタ型の推定と無名構造体。**

> `o` は単に `int` として宣言されている。Wasm にはポインタ型というものが存在しないからである。しかし `wasm-decompile` はそれを導出しようとする。たとえばコードが `o[0]:int = o[1]:int + o[2]:int` を行っているなら、`wasm-decompile` は **`o` が 3 個の int を持つ構造体を指していると仮定**し、代わりに次のようにコンパイルすることがある。

```
    var o:{ a:int, b:int, c:int };
    o.a = o.b + o.c
```

> `{}` 型は**無名の構造体宣言**（名前付きのものは未実装）であり、`o` がアクセスしているメモリレイアウトの種類を読者に示唆する。コード中に相関の無いインデックスが散らばっているよりも有益に見える。

**(3) 構造体推定が失敗する条件。**

> 残念ながら、**LLVM のようなコンパイラの最適化済み出力はメモリアクセスをとんでもない形に作り替えることが多く、この「構造体検出」は失敗する**。たとえば、メモリレイアウトに穴（holes）や重なり（overlaps）がある場合、型が混在している場合などには、インデックス操作へフォールバックする。**`o` のようなローカルがメモリ中の無関係なものに再利用されている場合はなおさらである。**

**(4) 連続していないが同じ型のアクセス。**

> 連続していないが少なくとも同じ型であるアクセスについては、デコンパイラはポインタ型を `o:int` から たとえば `o:float_ptr` に変え（同様に、実際のアクセスからは型を省略し、`o[2]:int` ではなく `o[2]` とする）。

**(5) インデックスのスケーリングの整理。**

> さらに `wasm-decompile` は典型的なインデックス操作を整理しようとする。たとえば 32 ビット要素の配列にアクセスするとき、**生成された Wasm コードはしばしば `(base + (index << 2))[0]:int` のように見える**。Wasm には、ロードする型のサイズでインデックスをスケールする組み込みの方法が無いためである。そこで `wasm-decompile` はこれを **単に `base[index]:int` に変換する**。`[]` の中身は型サイズでスケールされることが既に含意されているからである。

〔補足（診断上の要点）〕この 5 項目は **Wasm の線形メモリ上のバッファ境界バグを探すときの読み方そのもの**である。

- `o[i]:int` の `i` の出自（定数か、攻撃者が制御できる入力か）を追う。**`[]` の中はスケール前のインデックスであり、実効バイトオフセットは「インデックス × 型サイズ」である**点を忘れると境界計算を誤る。
- `var o:{ a:int, b:int, c:int }` のような構造体推定が出たら、**その構造体サイズを超えるインデックスでアクセスしている箇所**が近くにないか確認する。
- 逆に、構造体推定が崩れて生のインデックスに戻っている（原文が言う「穴や重なり」「型混在」「ローカルの再利用」）箇所は、**最適化で潰れているか、本当に型混乱がある**かの区別が付かない。そこは `wasm-objdump -d` と WAT で裏を取るべき箇所である。
- `float_ptr` のような `_ptr` 付き型が出たら、それは「同じ型の非連続アクセス」であり、**配列走査**である可能性が高い。

#### 制御フロー（`goto L;` と `label L:`）

Wasm の制御構造は、`.dcmp` では次のように写る。

- Wasm の if-then は C 風の `if (c) { 1; } else { 2; }` にかなり素直に対応する。**ほとんどの言語と違い、この if-then は式にもなり得る**（`wasm-decompile` は現在 `?:` 三項演算子を使わない）。
- Wasm の loop は **`loop L { ...; continue L; }`** 構造になる。**ラベルを含めることで、入れ子のループのどれに対しても continue できる**。
- Wasm の block は**前方ジャンプ用のラベルにすぎず**、`.wat` のような他のテキスト形式では過剰な入れ子を引き起こす。そこでここでは、block を**その本質であるラベルに還元する**。このラベルは、式として使われるときだけブロックを表す `{}` を使うので、**通常はインデントせず、したがって果てしない入れ子を引き起こさない**。

```
    if (c) goto L;
    ...
    label L:
```

〔補足（診断上の要点）〕`.wat` では `block`/`br` が深い括弧の入れ子になって読めなくなるが、`.dcmp` では `goto L;` と `label L:` の対に平坦化される。**境界チェック失敗時の早期脱出（エラーハンドリングの分岐）を追うのが格段に楽になる**。境界チェックが「あるか無いか」を見るには `.dcmp` が最短経路である。

#### 演算子の優先順位（C とは違う！）

`wasm-decompile` は独自の演算子優先順位を持つ。これを知らずに C の感覚で読むと式を誤読する。原文（逐語）。

> `wasm-decompile` は、式に必要な `()` の量を減らすために以下の演算子優先順位を用いる。高い（`()` を必要としない）ものから低い（入れ子のとき常に `()` を必要とする）ものへ:

```
* ()、a、1、a()
* []
* if () {} else {}
* *、/、%
* +、-
* <<、>>
* ==、!=、<、>、>=、<=
* &、|
* min、max
* =
```

> **結合的（associative）なのは `+` と `*` だけ**であり、つまり追加の `()` 無しに複数個を連続させられるのはこの 2 つだけである。

〔重要な注意〕この優先順位は **C の優先順位とは異なる**。とくに `<<`/`>>` が `+`/`-` より低く、`==` などの比較が `<<`/`>>` より低く、`&`/`|` が比較より低い。**C の感覚で `.dcmp` を読むと式の構造を読み違える**。次の実例で確認する。

### 3-5. 実装から読み取れる処理パイプライン（`src/tools/wasm-decompile.cc`）

man ページにも `docs/decompiler.md` にも書かれていない、実務上重要な挙動が実装から確認できる。処理は次の順に進み、いずれかが失敗するとそこで止まる。

1. `ReadFile` ― 入力ファイル読み込み。
2. `ReadBinaryIr(...)` ― バイナリを IR（内部表現）に読み込む。オプションは `ReadBinaryOptions(features, nullptr, true, kStopOnFirstError, fail_on_custom_section_error)` で、**`kStopOnFirstError = true`（最初のエラーで停止）**、`fail_on_custom_section_error` は既定 `true`（`--ignore-custom-section-errors` を渡すと `false` になる）。
3. **`ValidateModule(&module, &errors, options)` ― 検証。**
4. `GenerateNames(&module, NameOpts::AlphaNames)` ― **名前生成（`a`, `b`, `c` … の生成名）。常に実行される。**
5. `RenameAll(module)` ― コード中のコメントに「`ReadBinaryIr` と `GenerateNames` の後、`ApplyNames` の前に呼ばれなければならない」と明記されている。
6. `ApplyNames(&module)` ― 名前の適用。
7. `Decompile(module, decompile_options)` ― 逆コンパイルし、`-o` があればそのファイル、無ければ stdout に書く。

ここから導かれる実務上の帰結。

- **`wasm-decompile` は検証（validation）を通らない module を逆コンパイルできない。** 手で壊した wasm、難読化で不正なバイナリ、あるいは有効化していない提案を使っている wasm は、`ValidateModule` の段で止まる。→ この場合は **`--enable-all` を付けて再試行**し、それでも通らなければ `wasm-objdump -d`（objdump は検証を要求しない）に切り替えるのが正しい手順である。
- **名前生成は常に行われる**ので、`wasm2wat` のように `--generate-names` を明示する必要はない。
- カスタムセクションが壊れている場合の唯一の逃げ道が **`--ignore-custom-section-errors`** である。
- 実装は Apache License 2.0、著作権表記は "Copyright 2019 WebAssembly Community Group participants"（**ツールの初出は 2019 年**）。

### 3-6. 実際の出力例（期待値テストから逐語）

#### 命名の優先順位（`test/decompile/names.txt`）

このテストは、name セクション・linking セクションのシンボル表・export 名の**3 系統が競合したときにどれが勝つか**を検証している。入力側のコメント（逐語）。

- `;; This has both a sym and export name, prefer sym.`
- `;; If there's a name section name, prefer that over sym/export.`
- `;; If there's no name section name, prefer sym over export.`
- `;; If there's only export, use that.`
- `;; These can only be named thru symbols.`（data セグメントについて）

入力に含まれる名前は次の 3 系統である。

- name セクション: module 名 `M0`、関数 `F0`（index 0）、`F1_NS`（index 1）、ローカル `L0`
- linking セクションのシンボル表: `F1_SYM`、`F2_SYM`、`G0_SYM`、`D0_SYM`、`D1_SYM`
- export 名: `F1_EXPORT`、`F2_EXPORT`、`F3_EXPORT`、`G0_EXPORT`、`G1_EXPORT`

期待される `wasm-decompile` の出力（逐語）。

```
memory M_a(initial: 0, max: 0);

global G0_SYM:int = 0;
export global G1_EXPORT:int = 0;

data D0_SYM(offset: 0) = "Hello, World!";
data D1_SYM(offset: 10) = "bar";

function F0():int { // func0
  var L0:int;
  return L0;
}

function F1_NS() { // func1
}

function F2_SYM() { // func2
}

export function F3_EXPORT() { // func3
}
```

読み取れることを整理する。

- **優先順位が出力で確認できる**。index 1 の関数は name セクションの `F1_NS` が勝ち（`F1_SYM` も `F1_EXPORT` もあるのに）、index 2 は name セクションが無いのでシンボルの `F2_SYM` が勝ち、index 3 はどちらも無いので export 名の `F3_EXPORT` が使われる。グローバル 0 は `G0_SYM`（sym が export より優先）、グローバル 1 は export のみなので `G1_EXPORT`。
- **`data` セグメントはシンボル経由でしか名前が付かない**（`D0_SYM` / `D1_SYM`）。シンボルが無ければ `d_HelloWorld` のような内容由来の生成名になる。
- 名前の無い memory には**生成名 `M_a`**（`M_` 接頭辞 + `a`）が付く。
- **各関数に元のインデックスが `// func0` のような行コメントで併記される。** これは `wasm-objdump -x` / `-d` の出力と突き合わせるための鍵になる。
- export されている関数・グローバルには `export` が前置されるので、**攻撃面（JS から駆動できる入口）が一目で分かる**。

#### 演算子優先順位の実例（`test/decompile/precedence.txt`）

入力の WAT（逐語、抜粋）。前半は「括弧が生成されない順序」、後半は「括弧が生成される逆順」の命令列である。

```wat
(module
  (memory $m1 1)

  (func $precedence (param) (result)
    ;; some exp in order that will generate no parens
    i32.const 0
    i32.load offset=0
    i32.const 1
    i32.mul
    i32.const 2
    i32.add
    i32.const 3
    i32.shl
    i32.const 4
    i32.eq
    i32.const 5
    i32.and
    drop
    ;; some exp in reverse order that will generate parens.
    i32.const 6
    i32.const 5
    i32.and
    i32.const 4
    i32.eq
    i32.const 3
    i32.shl
    i32.const 2
    i32.add
    i32.const 1
    i32.mul
    i32.load offset=0
    drop
  )
  (export "precedence" (func $precedence))
)
```

期待される出力（逐語）。

```
memory M_a(initial: 1, max: 0);

export function precedence() { // func0
  0[0]:int * 1 + 2 << 3 == 4 & 5;
  (((((6 & 5) == 4) << 3) + 2) * 1)[0]:int;
}
```

〔重要〕**この 1 行目が優先順位表の実証である。** `0[0]:int * 1 + 2 << 3 == 4 & 5` は、デコンパイラの優先順位に従って次のように読む。

```
((((0[0]:int) * 1) + 2) << 3) == 4) & 5
```

**C の優先順位（`<<` が比較より高く、`&` が比較より低い、など）で読むと別物になる**。`.dcmp` を読むときは必ずこの優先順位表を手元に置くこと。

2 行目は同じ演算を逆順に積んだもので、**すべて括弧が付く**。最後の `[0]:int` は「その計算結果をアドレスとして int をロードする」であり、**`(base + (index << 2))[0]:int` 形のイディオムが整理されずに残った姿**でもある（前節の (5) を参照）。

### 3-7. 解析実務での `wasm-decompile` の位置づけ（使い分け表）

道具の使い分けをまとめる。目的ごとに最短の道具を選べるようにしておく。

| 目的 | 使うツール | 理由 |
| --- | --- | --- |
| 攻撃面（import/export）の一覧を確定する | `wasm-objdump -x` | セクション詳細が機械的に列挙される |
| 全体を「読む」 | **`wasm-decompile`（1.0.41 以前）** | block が `label L:` に平坦化され、ロード/ストアが `o[i]:int` になるので、境界チェックの有無と構造体レイアウトが見える |
| 命令の正確な意味・確証を取る | `wasm2wat --generate-names -f` / `wasm-objdump -d` | `.dcmp` は読むための形式であり再ビルドできない。デコンパイラの推定（構造体検出・インデックス整理）は失敗し得る |
| 検証を通らない壊れた wasm を見る | `wasm-objdump -d` | `wasm-decompile` は `ValidateModule` で止まる |
| PoC を作る | `wat2wasm`（必要なら `-v` / `--no-canonicalize-leb128s`） | `.dcmp` からはコンパイルし戻せない（設計上の非目的） |

〔補足〕**1.0.42 以降の wabt しか入手できない環境での代替**。`wasm-decompile` に相当する「C 風の可読な出力」は wabt からは失われたので、次のいずれかになる。

1. `apt`/`brew`/GitHub releases から **1.0.41 以前**を明示的に入れる。
2. `wasm2c` で C ソースに落として読む（本節 2 章。ただし出力は機械生成の C であり `.dcmp` ほど読みやすくはない）。
3. `wasm2wat --generate-names -f --inline-exports --inline-imports` で折り畳み式の WAT を読む。

---

## 4. WAT の正式な文法一覧（MDN が「含めなかった」全命令リスト）

本節の前半（MDN の解説）は、末尾でこう述べていた。

> 含めなかった主なものは、**関数本体に現れ得る全命令の網羅的なリスト**である。／仕様インタプリタが実装している grammar of the text format も参照。

その参照先を取得したので、MDN が意図的に省いた「全命令の網羅リスト」を補う。**出典**: `https://raw.githubusercontent.com/WebAssembly/spec/main/interpreter/README.md`（30,698 bytes、HTTP 200、`## S-Expression Syntax` 節）。

原文の前置き（逐語訳）。

> 実装は S 式構文で与えられた WebAssembly AST を消費する。以下は型・式・関数・module の文法の概観であり、design doc に記述されているものを反映している。
>
> **注: 文法は便宜のためここに示すものであり、決定的な出典は テキスト形式の仕様 である。**

〔注意〕これは**仕様そのものではなく仕様リファレンスインタプリタの README** である。GC（ガベージコレクション）／例外処理などの提案に関する記法（`struct.new`、`array.get`、`try_table`、`catch` 等）が含まれており、**各ブラウザや wabt が同じ構文を受け付けるとは限らない**。逐語の正確さのため、以下は改変せずそのまま転記する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: WebAssembly テキスト形式の仕様（決定的出典）— https://webassembly.github.io/spec/core/text/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `webassembly.github.io` が組織の egress ポリシーで遮断され、CONNECT 403）。下の文法は、同内容の正規ソースである仕様リファレンスインタプリタの `interpreter/README.md`（`raw.githubusercontent.com` 経由で取得）から逐語転記した「便宜的な文法」であり、仕様本文そのものではない。
> **読みどころ**:
> 1. 各命令の**正確な意味**（`text/` の説明と `exec/`（実行意味論）の対応）。文法は形だけで、意味はここで引く。
> 2. `load`/`store` の `offset=`・`align=` の正確な定義と、アラインメント違反時の扱い。
> 3. 自分が狙うブラウザ／ランタイムが、どの提案（GC・例外・memory64 など）を実装しているか（文法にあっても実装されているとは限らない）。
> **代替手段**: `webassembly.github.io/spec/…` が遮断される環境では、仕様リポジトリ `https://github.com/WebAssembly/spec` の `document/core/` 配下（`raw.githubusercontent.com` 経由）が同内容のソースになる。目次は `intro/index`, `syntax/index`, `valid/index`, `exec/index`, `binary/index`, `text/index`, `appendix/index` の 7 章構成。

### 4-1. 文法（逐語、無改変）

以下が S 式構文の全文である。長いが、**バグハンティングで「この記号は何だ？」となったときに戻ってくる辞書**として使う。とくに `op:` の列挙（命令の全リスト）が本命である。

```
num:    <digit>(_? <digit>)*
hexnum: <hexdigit>(_? <hexdigit>)*
nat:    <num> | 0x<hexnum>
int:    <nat> | +<nat> | -<nat>
float:  <num>.<num>?(e|E <num>)? | 0x<hexnum>.<hexnum>?(p|P <num>)?
name:   $(<letter> | <digit> | _ | . | + | - | * | / | \ | ^ | ~ | = | < | > | ! | ? | @ | # | $ | % | & | | | : | ' | `)+
string: "(<char> | \n | \t | \\ | \' | \" | \<hex><hex> | \u{<hex>+})*"

num: <int> | <float>
var: <nat> | <name>

unop:  ctz | clz | popcnt | ...
binop: add | sub | mul | ...
relop: eq | ne | lt | ...
sign:  s | u
offset: offset=<nat>
align: align=(1|2|4|8|...)
cvtop: trunc | extend | wrap | ...
castop: data | array | i31
externop: internalize | externalize

num_type: i32 | i64 | f32 | f64
vec_type: v128
vec_shape: i8x16 | i16x8 | i32x4 | i64x2 | f32x4 | f64x2 | v128
heap_type: any | eq | i31 | data | array | func | extern | none | nofunc | noextern | <var> | (rtt <var>)
ref_type:
  ( ref null? <heap_type> )
  ( rtt <var> )               ;; = (ref (rtt <var>))
  anyref                      ;; = (ref null any)
  eqref                       ;; = (ref null eq)
  i31ref                      ;; = (ref i31)
  dataref                     ;; = (ref null data)
  arrayref                    ;; = (ref null array)
  funcref                     ;; = (ref null func)
  externref                   ;; = (ref null extern)
  nullref                     ;; = (ref null none)
  nullfuncref                 ;; = (ref null nofunc)
  nullexternref               ;; = (ref null noextern)
val_type: <num_type> | <vec_type> | <ref_type>
block_type : ( result <val_type>* )*
func_type:   ( type <var> )? <param>* <result>*
global_type: <val_type> | ( mut <val_type> )
table_type:  <nat> <nat>? <ref_type>
memory_type: <nat> <nat>?
tag_type: ( type <var> )? <param>*

num: <int> | <float>
var: <nat> | <name>

unop:  ctz | clz | popcnt | ...
binop: add | sub | mul | ...
testop: eqz
relop: eq | ne | lt | ...
sign:  s | u
offset: offset=<nat>
align: align=(1|2|4|8|...)
cvtop: trunc | extend | wrap | ...
vecunop: abs | neg | ...
vecbinop: add | sub | min_<sign> | ...
vecternop: bitselect
vectestop: all_true | any_true
vecrelop: eq | ne | lt | ...
veccvtop: extend_low | extend_high | trunc_sat | ...
vecshiftop: shl | shr_<sign>

expr:
  ( <op> )
  ( <op> <expr>+ )                                                   ;; = <expr>+ (<op>)
  ( block <name>? <block_type> <instr>* )
  ( loop <name>? <block_type> <instr>* )
  ( if <name>? <block_type> ( then <instr>* ) ( else <instr>* )? )
  ( if <name>? <block_type> <expr>+ ( then <instr>* ) ( else <instr>* )? ) ;; = <expr>+ (if <name>? <block_type> (then <instr>*) (else <instr>*)?)
  ( try_table <name>? <block_type>  <catch>* <instr>* )

instr:
  <expr>
  <op>                                                               ;; = (<op>)
  block <name>? <block_type> <instr>* end <name>?                    ;; = (block <name>? <block_type> <instr>*)
  loop <name>? <block_type> <instr>* end <name>?                     ;; = (loop <name>? <block_type> <instr>*)
  if <name>? <block_type> <instr>* end <name>?                       ;; = (if <name>? <block_type> (then <instr>*))
  if <name>? <block_type> <instr>* else <name>? <instr>* end <name>? ;; = (if <name>? <block_type> (then <instr>*) (else <instr>*))
  try_table <name>? <block_type> <catch>* <instr>* end <name>?       ;; = (try_table <name>? <block_type> <catch>* <instr>*)

op:
  unreachable
  nop
  drop
  select
  br <var>
  br_if <var>
  br_table <var>+
  br_on_null <var>
  br_on_non_null <var>
  br_on_cast <var> <ref_type> <ref_type>
  br_on_cast_fail <var> <ref_type> <ref_type> 
  call <var>
  call_ref <var>
  call_indirect <var>? (type <var>)? <func_type>
  return
  return_call <var>
  return_call_ref <var>
  return_call_indirect <var>? (type <var>)? <func_type>
  throw <tag_type>
  throw_ref
  local.get <var>
  local.set <var>
  local.tee <var>
  global.get <var>
  global.set <var>
  table.get <var>?
  table.set <var>?
  table.size <var>?
  table.grow <var>?
  table.fill <var>?
  table.copy <var>? <var>?
  table.init <var>? <var>
  elem.drop <var>
  <num_type>.load((8|16|32)_<sign>)? <offset>? <align>?
  <num_type>.store(8|16|32)? <offset>? <align>?
  <vec_type>.load((8x8|16x4|32x2)_<sign>)? <offset>? <align>?
  <vec_type>.store <offset>? <align>?
  <vec_type>.load(8|16|32|64)_(lane|splat|zero) <offset>? <align>?
  <vec_type>.store(8|16|32|64)_lane <offset>? <align>?
  memory.size
  memory.grow
  memory.fill
  memory.copy
  memory.init <var>
  data.drop <var>
  ref.null <heap_type>
  ref.func <var>
  ref.is_null
  ref_as_non_null
  ref.test <var>
  ref.cast <var>
  ref.eq
  i31.new
  i31.get_<sign>
  struct.new(_<default>)? <var>
  struct.get(_<sign>)? <var> <var>
  struct.set <var> <var>
  array.new(_<default>)? <var>
  array.new_fixed <var> <nat>
  array.new_elem <var> <var>
  array.new_data <var> <var>
  array.get(_<sign>)? <var>
  array.set <var>
  array.len <var>
  extern.<externop>
  <num_type>.const <num>
  <num_type>.<unop>
  <num_type>.<binop>
  <num_type>.<testop>
  <num_type>.<relop>
  <num_type>.<cvtop>_<num_type>(_<sign>)?
  <vec_type>.const <vec_shape> <num>+
  <vec_shape>.<vecunop>
  <vec_shape>.<vecbinop>
  <vec_shape>.<vecternop>
  <vec_shape>.<vectestop>
  <vec_shape>.<vecrelop>
  <vec_shape>.<veccvtop>_<vec_shape>(_<sign>)?(_<zero>)?
  <vec_shape>.<vecshiftop>
  <vec_shape>.bitmask
  <vec_shape>.splat
  <vec_shape>.extract_lane(_<sign>)? <nat>
  <vec_shape>.replace_lane <nat>

catch:
  catch <var> <var>
  catch_ref <var> <var>
  catch_all <var>
  catch_all_ref <var>

func:    ( func <name>? <func_type> <local>* <instr>* )
         ( func <name>? ( export <string> ) <...> )                         ;; = (export <string> (func <N>)) (func <name>? <...>)
         ( func <name>? ( import <string> <string> ) <func_type>)           ;; = (import <string> <string> (func <name>? <func_type>))
param:   ( param <val_type>* ) | ( param <name> <val_type> )
result:  ( result <val_type>* )
local:   ( local <val_type>* ) | ( local <name> <val_type> )

global:  ( global <name>? <global_type> <instr>* )
         ( global <name>? ( export <string> ) <...> )                       ;; = (export <string> (global <N>)) (global <name>? <...>)
         ( global <name>? ( import <string> <string> ) <global_type> )      ;; = (import <string> <string> (global <name>? <global_type>))
table:   ( table <name>? <table_type> )
         ( table <name>? ( export <string> ) <...> )                        ;; = (export <string> (table <N>)) (table <name>? <...>)
         ( table <name>? ( import <string> <string> ) <table_type> )        ;; = (import <string> <string> (table <name>? <table_type>))
         ( table <name>? ( export <string> )* <ref_type> ( elem <var>* ) )  ;; = (table <name>? ( export <string> )* <size> <size> <ref_type>) (elem (i32.const 0) <var>*)
elem:    ( elem <var>? (offset <instr>* ) <var>* )
         ( elem <var>? <expr> <var>* )                                      ;; = (elem <var>? (offset <expr>) <var>*)
         ( elem <var>? declare <ref_type> <var>* )
elem:    ( elem <name>? ( table <var> )? <offset> <ref_type> <item>* )
         ( elem <name>? ( table <var> )? <offset> func <var>* )             ;; = (elem <name>? ( table <var> )? <offset> funcref (ref.func <var>)*)
         ( elem <var>? declare? <ref_type> <var>* )
         ( elem <name>? declare? func <var>* )                               ;; = (elem <name>? declare? funcref (ref.func <var>)*)
offset:  ( offset <instr>* )
         <expr>                                                             ;; = ( offset <expr> )
item:    ( item <instr>* )
         <expr>                                                             ;; = ( item <expr> )
memory:  ( memory <name>? <memory_type> )
         ( memory <name>? ( export <string> ) <...> )                       ;; = (export <string> (memory <N>))+ (memory <name>? <...>)
         ( memory <name>? ( import <string> <string> ) <memory_type> )      ;; = (import <string> <string> (memory <name>? <memory_type>))
         ( memory <name>? ( export <string> )* ( data <string>* ) )         ;; = (memory <name>? ( export <string> )* <size> <size>) (data (i32.const 0) <string>*)
data:    ( data <name>? ( memory <var> )? <offset> <string>* )

start:   ( start <var> )

typedef: ( type <name>? ( func <param>* <result>* ) )

import:  ( import <string> <string> <imkind> )
imkind:  ( func <name>? <func_type> )
         ( global <name>? <global_type> )
         ( table <name>? <table_type> )
         ( memory <name>? <memory_type> )
export:  ( export <string> <exkind> )
exkind:  ( func <var> )
         ( global <var> )
         ( table <var> )
         ( memory <var> )

module:  ( module <name>? <typedef>* <func>* <import>* <export>* <table>* <memory>? <global>* <elem>* <data>* <start>? )
         <typedef>* <func>* <import>* <export>* <table>* <memory>? <global>* <elem>* <data>* <start>?  ;; =
         ( module <typedef>* <func>* <import>* <export>* <table>* <memory>? <global>* <elem>* <data>* <start>? )
```

### 4-2. 文法の後に続く原文の注記（実務上これが本体）

文法の記号だけでは分からない「解釈のルール」が、原文の注記に書かれている（逐語訳）。ここがバグハンティングでは本体である。

1. **略記形（abbreviation forms）**: 上でコメントが付いている生成規則は、等価な展開の略記形である。とくに **WebAssembly はスタックマシンであるため、`(<op> <expr>+)` の形の式はすべて、対応する後行順（post-order）の命令列の略記にすぎない**。
2. **括弧の省略**: 生の命令については、**演算子名とその即値オペランドを囲む括弧を省略できる**。制御演算子（`block`、`loop`、`if`）の場合、これは入れ子の列の終わりを明示的な **`end` キーワード**で示すことを要求する。
3. **名前は記法上の便宜にすぎない**（最重要）: `<name>` および `<var>` によるあらゆる形の命名（式のラベルを含む）は、**このテキスト形式の記法上の便宜にすぎない。実際の AST には名前が存在せず、すべての束縛は順序付き数値インデックスで参照される。したがって名前はパーサで即座に解決されインデックスに置き換えられる。** テキスト形式ではインデックスを直接使うこともできる。
4. **memory フィールドのセグメント文字列**は、与えられたオフセットの連続したメモリを初期化するために使われる。
5. **`table` と `memory` の 2 つの略記形における `<size>`** は、そのセグメントを保持できる最小サイズである。すなわち **table では `<var>` の個数、memory では文字列の累積長をページサイズに切り上げたもの**。
6. **フィールドの順序**: 上記の文法規則に加えて、**module のフィールドは任意の順序で現れてよい。ただし、すべての import は、関数・table・memory・global の最初の本来の定義より前に現れなければならない。**
7. **コメントは 2 通りの書き方ができる**（逐語）。

```
comment:
  ;; <char>* <eol>
  (; (<char> | <comment>)* ;)
```

とくに後者の形式のコメントは**正しく入れ子になる（nest properly）**。

### 4-3. 前半パート（MDN）に対して新しく分かること（バグハンティング上の要点）

前半の MDN 解説には無かった、または曖昧だった点が、この文法で確定する。バグハンティングに効く差分だけを表にする。

| 項目 | 前半（MDN）の記述 | 仕様インタプリタ文法で確定すること |
| --- | --- | --- |
| **コメント構文** | `;;` の行コメントのみ言及 | **ブロックコメント `(; ... ;)` も存在し、正しく入れ子になる。** 難読化された WAT や、コメントでコードを隠している WAT を読むときに必須 |
| **load / store の即値** | `i32.load` / `i32.store` の存在のみ | **`<num_type>.load((8\|16\|32)_<sign>)? <offset>? <align>?` ― `offset=<nat>` と `align=(1\|2\|4\|8\|...)` という即値を取る。** 実効アドレスは「スタックのアドレス + `offset=`」であり、**`offset=` を見落とすと境界計算を誤る**。幅を狭めたロードの符号有無もここで読む |
| **命令の網羅リスト** | 「含めなかった」と明記 | `op:` の全列挙が 4-1 にある（`br_table <var>+`、`call_indirect <var>? (type <var>)? <func_type>`、`memory.copy`、`table.copy` などを含む） |
| **`call_indirect` の table 指定** | 「現在 module あたり table は 1 個なので暗黙」「将来は複数」 | 文法は既に **`call_indirect <var>? (type <var>)? <func_type>`** で、**table を指す `<var>` が省略可能な形で入っている**（MDN が「将来」と書いた形が仕様インタプリタでは既に受理される） |
| **参照型の全体像** | `externref` と `funcref` を中心に | `heap_type` / `ref_type` の全体。**`funcref` = `(ref null func)`、`externref` = `(ref null extern)` という展開関係**が明示 |
| **`table` の型** | `(table 2 funcref)` の例のみ | **`table_type: <nat> <nat>? <ref_type>`** ― 初期サイズ・最大サイズ（省略可）・要素型の 3 つ組。`memory_type: <nat> <nat>?` も同形 |
| **`elem` の形** | `(elem (i32.const 0) $f1 $f2)` のみ | 複数形あり。**`declare` 形（`(elem declare func $f)`）は `ref.func` を使うために必要な宣言**で、テキストだけ読むと見落としやすい |
| **名前がバイナリに残らない理由** | 「バイナリには整数しか含まれない」 | **「実際の AST には名前が存在せず、名前はパーサで即座にインデックスに置き換えられる」。** name セクションは**後付けのデバッグ情報**であり言語の一部ではない |
| **import の位置制約** | 言及なし | **「すべての import は、関数・table・memory・global の最初の本来の定義より前に現れなければならない」。** 手書き WAT の PoC で `wat2wasm` がエラーになる原因になりやすい |
| **文字列エスケープ** | `"Hi"` の例のみ | `string:` 定義に **`\<hex><hex>` の生バイト指定**が使える。data セグメントに任意バイト列（ヌルバイト含む）を置く方法 |
| **識別子に使える文字** | `$` を前置した名前 | `name:` 定義は記号を多く含められるため、難読化 WAT では `$/\^~` のような名前が出得る |
| **数値リテラル** | 言及なし | `num`/`hexnum` は **`_` を桁区切りとして許す**。16 進浮動小数点も可。定数を grep するときは `_` 混入を考慮する |

〔補足（診断上の最重要点）〕1 つ選ぶなら **`offset=` と `align=`** である。`wasm2wat` の出力で `i32.load offset=4` と書かれていれば、実効アドレスは「スタック上のアドレス + 4」であり、`.dcmp`（3 章）では `o[1]:int` のように**インデックスに畳み込まれて**表示される。同じアクセスが 2 つの形式で違う見え方をするので、境界の議論をするときは**どちらの形で読んでいるかを常に意識する**。

### 4-4. この資料自体の到達性メモ

参考までに、本節が使った URL の到達状況を残す。同じ遮断に当たった読者の道しるべになる。

| URL | 本セッションでの結果 |
| --- | --- |
| `https://github.com/WebAssembly/spec/blob/main/interpreter/README.md#s-expression-syntax`（MDN がリンクしている形） | github.com の HTML は本セッションでは不可 |
| `https://raw.githubusercontent.com/WebAssembly/spec/main/interpreter/README.md` | **HTTP 200 / 30,698 bytes（本章の出典）** |
| `https://webassembly.github.io/spec/core/text/`（決定的出典として原文が指す先） | 到達不可（`webassembly.github.io` は egress ポリシーで遮断） |
| `https://raw.githubusercontent.com/WebAssembly/spec/main/document/core/index.rst` | **HTTP 200 / 701 bytes。** 仕様本文のソース（reStructuredText）。目次は 7 章構成で、**遮断された `webassembly.github.io/spec/core/` の代替**として各章を `document/core/<章>/…` から読める |

---

## 5. 解析ワークフロー（wasm → wat → 読解）

ここまでの道具を組み合わせた、防御・診断目的の 10 ステップである。**ここで挙げるコマンドはすべて、本節および前半の逐語オプション表に存在するものだけ**を使う。前提として、対象の `.wasm` は「許可された診断・バグバウンティ・自分で立てた検証環境」で扱うものとする。

```
[入手] --8バイト識別--> [構造把握 objdump] --> [検証 validate]
   --> [WAT に戻す wasm2wat] --> [C 風に読む wasm-decompile]
   --> [動的確認 wasm-interp] --> [C 変換 wasm2c + ASAN]
   --> [統計 wasm-stats] --> [PoC wat2wasm] --> [正規化 wat-desugar]
```

1. **バイナリの入手と識別**: レスポンスボディ先頭 8 バイトが `0061 736d` + `0100 0000` なら Wasm（前半の module ヘッダの節）。
2. **全体構造の把握**（`wasm-objdump`）:
   - `wasm-objdump -h test.wasm` ― セクションヘッダ一覧（どのセクションがあるか、custom セクションが残っているか）。
   - `wasm-objdump -x test.wasm` ― **セクション詳細。Type / Import / Export / Memory / Table / Global / Elem / Data の全体像が出る。攻撃面（import/export）の一覧がここで確定する。**
   - `wasm-objdump -d test.wasm` ― 関数本体の逆アセンブル。
   - `wasm-objdump -s test.wasm` ― 生セクション内容（data セグメントの生バイト、埋め込み文字列・鍵・URL の発見に有効）。
   - `wasm-objdump -j <SECTION> test.wasm` ― 1 セクションだけに絞る。
   - `wasm-objdump -r test.wasm` ― 逆アセンブルにリロケーションをインラインで表示（relocatable バイナリの場合）。
3. **妥当性の確認**: `wasm-validate test.wasm`。失敗するなら機能フラグ不足を疑い `wasm-validate --enable-all test.wasm` を試す。
4. **読めるテキストに戻す**: `wasm2wat --generate-names -f test.wasm -o test.wat`。名前が残っていない場合は `--generate-names` が必須。壊れた custom セクションがあるなら `--ignore-custom-section-errors` を追加。`--inline-exports --inline-imports` で import/export をその場に展開すると対応が追いやすい。
5. **（wabt 1.0.41 以前があれば）C 風擬似コードに落とす**: `wasm-decompile test.wasm -o test.dcmp`。制御フローとメモリアクセスが平坦化され、WAT より圧倒的に読みやすい。
6. **動的に確認する**: `wasm-interp test.wasm --run-all-exports --trace`、あるいは特定関数に引数を与えて `wasm-interp test.wasm -r "func_sum" -a "i32:8" -a "i32:5"`。スタック枯渇の閾値を変えたいときは `-V`（value stack）/ `-C`（call stack）。
7. **C に変換してネイティブの解析基盤に載せる**: `wasm2c test.wasm -o test.c` → `cc -o test main.c test.c wasm2c/wasm-rt-impl.c wasm2c/wasm-rt-mem-impl.c -Iwasm2c -lm`。さらに `-DWASM_RT_SANITY_CHECKS` や ASAN/UBSAN と組み合わせると、Wasm 内部のメモリ操作の異常を C レベルで観測できる。準拠維持のため最適化時は `-fno-optimize-sibling-calls -frounding-math`（GCC は加えて `-fsignaling-nans`）を付ける。
8. **統計でホットスポットを探す**: `wasm-stats test.wasm -o test.dist`（オペコード分布）、`-c N` で N 未満のカウントを打ち切る。
9. **WAT を書いて実験する**: `wat2wasm poc.wat -o poc.wasm`、逐バイトの意味を見たいときは `wat2wasm poc.wat -v`、hexdump を見たいときは `-d/--dump-module`。最小サイズの LEB128 を使わない壊し方を試すなら `--no-canonicalize-leb128s`。名前を残すなら `--debug-names`。
10. **書式の正規化**: `wat-desugar test.wat --fold -o folded.wat`（flat ↔ folded）。spec テスト形式の `.wast` を扱うなら `wast2json spec-test.wast -o spec-test.json` → `spectest-interp spec-test.json`。

### 5-1. WAT を読むときのチェックリスト（原典に基づく着眼点）

このチェックリストは、実際に `.wat`／`.dcmp` を開いたときに上から順に見ていく。各行の根拠は本節と前半の原典に対応している。

| 着眼点 | 根拠となる原典の記述 |
| --- | --- |
| `import` の 2 階層名（`(import "mod" "field" ...)`）を全列挙する | MDN「two-level namespace」／ `wasm-objdump -x` の Import セクション |
| `export` を全列挙し、JS から駆動できる入口を特定する | MDN「Wasm functions must be explicitly exported by an `export` statement」 |
| インポートされた JS 関数の署名と実際の JS 実装の不一致 | MDN「JavaScript functions have no notion of signature」 |
| offset/length を JS に渡すパターンで長さ検証があるか | MDN の logger2 / multi-memory の例（意図的な長さ不一致で "rubbish characters"） |
| `memory.grow` を跨いだ `ArrayBuffer` ビューの再取得 | MDN「the current `ArrayBuffer` is detached and a new `ArrayBuffer` is created」 |
| `call_indirect` のインデックス源と `(type ...)` の指定 | MDN「call_indirect's operand can be an i32 index」「a `WebAssembly.RuntimeError` is thrown」 |
| JS からの `Table.set()/grow()/get()` の使用箇所 | MDN「the Table object can be mutated from JavaScript」 |
| 共有 memory / 共有 table を複数 module が import しているか | MDN「multiple instances share the same memory and table」 |
| `(memory 1 2 shared)` の有無（threads / SharedArrayBuffer） | MDN「shared memories must specify a "maximum" size」 |
| `mut` 付き global のインポート/エクスポート | MDN「we also specify the keyword `mut`」 |
| `data` セグメントに埋め込まれた秘密・URL・鍵 | MDN「Data sections allow a string of bytes」／ `wasm-objdump -s` |
| `memory.copy` / `memory.fill` の長さ引数の出自 | MDN の Bulk memory operations |
| name / DWARF などの custom セクションが残っているか | `wasm-strip`（"Remove all custom sections"）、`wasm2wat --no-debug-names` |
| **`load` / `store` の `offset=` 即値を実効アドレスに足しているか** | 4-1 の `<num_type>.load((8\|16\|32)_<sign>)? <offset>? <align>?`。**`offset=` を無視すると境界計算を誤る** |
| **幅を狭めたロードの符号（`load8_s` vs `load8_u`、`load16_s` vs `load16_u`）** | 4-1 の `op:` 一覧。`.dcmp` では `byte`/`ubyte`/`short`/`ushort` として型名に現れる。**符号拡張の取り違えは長さ計算バグの典型** |
| **ブロックコメント `(; … ;)` にコードが隠れていないか** | 4-2 の 7（MDN は `;;` のみ言及）。**入れ子になる**ので閉じ忘れを装った難読化があり得る |
| **`data` セグメントの `\<hex><hex>` エスケープに生バイト（ヌル含む）が入っていないか** | 4-1 の `string:` 定義。`wasm-objdump -s` で生バイトを見るのが確実 |
| **import が最初の定義より前に並んでいるか（手書き WAT が弾かれる原因）** | 4-2 の 6「すべての import は最初の本来の定義より前に現れなければならない」 |
| **`call_indirect` に table を指す `<var>` が付いているか** | 4-1 の `call_indirect <var>? (type <var>)? <func_type>` |
| **`elem … declare` 宣言の有無（`ref.func` を使うのに必要）** | 4-1 の `elem:` の `declare` 形 |
| **`linking` カスタムセクションが残っていないか** | 3-4「命名」: `wasm.ld --emit-reloc` で完全リンク済み module にも保持され、**`--strip-debug` 済みでも大半の関数名が得られる** |
| **`.dcmp` を読むときデコンパイラ独自の演算子優先順位を使っているか** | 3-4「演算子の優先順位」と 3-6 の実例。**`<<` が `+` より低く、`&` が比較より低い** |

---

## 手を動かす

以下は、自分で立てた検証環境（自作の `.wasm`）で全ツールの挙動を体験する手順である。**バウンティ対象の実バイナリは第三者ホストのデモに貼らず、ここで作る手元の環境で扱う。**

1. **wabt を入れる。** `wasm-decompile` が必要なので、まず版を確認する。

```sh
sudo apt install wabt   # あるいは brew install wabt
wasm-decompile --help    # これが通れば 1.0.41 以前。エラーなら 1.0.42 以降で decompile 無し
```

2. **題材の WAT を作る。** 2-2 の階乗関数を `fac.wat` に保存する（`(memory $mem 1)` から始まる 9 行）。

3. **バイナリ化 → C 変換 → コンパイル → 実行。** 2-2〜2-4 のコマンドをそのまま打つ。

```sh
wat2wasm fac.wat -o fac.wasm
wasm2c fac.wasm -o fac.c
# main.c は 2-3 の逐語コードを保存
cc -o fac main.c fac.c wasm2c/wasm-rt-impl.c wasm2c/wasm-rt-mem-impl.c -Iwasm2c -lm
./fac 5     # -> fac(5) -> 120 が出れば成功
```

4. **生成 C を読む。** `fac.c` の中の `w2c_fac_fac_0` を開き、2-10 の flat format WAT と 1 行ずつ対応を取る。`FUNC_PROLOGUE` / `FUNC_EPILOGUE` の間の `var_i0`〜`var_i2` が Wasm のスタックに対応することを確認する。

5. **C 風擬似コードを見る。** 別の題材で `wasm-decompile` を試す。

```sh
wasm-decompile fac.wasm -o fac.dcmp
cat fac.dcmp    # function ...() { ... } と // func0 の行コメントを確認
```

6. **演算子優先順位を体感する。** 3-6 の `precedence.txt` の入力 WAT を保存し、`wat2wasm` → `wasm-decompile` に通す。出力 1 行目 `0[0]:int * 1 + 2 << 3 == 4 & 5` が、C とは違う優先順位で解釈されることを、3-4 の優先順位表を見ながら括弧付けして確かめる。

7. **objdump で攻撃面を確認する。** `wasm-objdump -x fac.wasm` を打ち、Export セクションに `fac` が出ること、Memory セクションが `initial=1` であることを読み取る。

8. **動的に動かす。** `wasm-interp fac.wasm --run-all-exports --trace` でスタックの push/pop の trace を眺める。

9. **文法辞書を引く練習。** `wasm2wat fac.wasm` の出力に現れる各命令（`local.get`、`i32.eq`、`i32.mul` など）を、4-1 の `op:` 一覧で引いて意味を確認する。とくに `i32.load offset=N` が出る題材を作り、`offset=` が実効アドレスに足されることを意識する。

## つまずきポイント

- **wasm2c 出力を `-O2` で最適化したら挙動が変わった**: 準拠維持の最適化無効化フラグ（`-fno-optimize-sibling-calls -frounding-math`、GCC はさらに `-fsignaling-nans`）を付け忘れている。trap の発生や NaN の扱いがずれる。
- **`wasm-decompile` が「invalid module」で止まる**: `ValidateModule` の段で落ちている。未有効化の提案を使っている可能性があるので `--enable-all` を付ける。それでも通らなければ検証を要求しない `wasm-objdump -d` に切り替える。壊れた custom セクションなら `--ignore-custom-section-errors`。
- **手元の wabt に `wasm-decompile` が無い**: 1.0.42 で削除された。`--help` の有無で判定し、必要なら 1.0.41 以前を明示的に入れる。`apt`/`brew` が配る版に依存する。
- **`.dcmp` の式を C の感覚で読んで構造を取り違える**: デコンパイラ独自の優先順位（`<<` が `+` より低い、`&` が比較より低い）を使っている。3-4 の優先順位表を必ず参照する。
- **`o[2]:int` の `2` をバイトオフセットと勘違い**: `[]` の中はスケール前のインデックス。実効バイトオフセットは「インデックス × 型サイズ」で、`int` なら 2 は 8 バイト目。
- **`wasm2wat` の `offset=` を見落として境界計算を誤る**: 実効アドレスは「スタック上のアドレス + `offset=`」。`.dcmp` ではインデックスに畳み込まれるので、同じアクセスが 2 形式で違って見える。
- **`--strip-debug` されているから関数名は取れないと諦める**: リンカが `--emit-reloc` を付けていれば linking セクションから復元できる。`wasm-objdump -h` で `linking` セクションの有無を見る。
- **ホスト関数（インポート）の境界チェックを見ずに Wasm 内部だけ調べる**: サンドボックス突破は多くの場合、ポインタ引数を検証しないホスト関数側で起きる。`w2c_host_fill_buf` の `ptr` 未検証が典型例。
- **仕様インタプリタの文法にある命令が、対象ブラウザで動くと思い込む**: 文法（`interpreter/README.md`）は提案段階の記法も含む。実装状況は別（前半の "Supported Proposals" 表で確認）。
- **`webassembly.github.io` が開けない**: 組織のネットワーク制限。仕様は `github.com/WebAssembly/spec` の `document/core/` を raw 経由で、man ページは wabt リポジトリの `man/<tool>.1` を raw 経由で読む。

## この節のまとめ

- **wasm2c は `.wasm` を等価な C（C99、threads/atomics 使用時は C11）に変換する。** 狙いは、ASAN/UBSAN など成熟した C 解析基盤に Wasm を載せることである。
- 生成シンボルは `w2c_<mod>`（型）、`wasm2c_<mod>_instantiate`／`_free`（構築・解放）、`w2c_<mod>_<export>`（エクスポート関数）。プレフィックスは `-n/--module-name` で変えられる。
- **`wasm_rt_trap_t` は Wasm の安全違反の全リスト**。`WASM_RT_TRAP_OOB`（範囲外）・`WASM_RT_TRAP_CALL_INDIRECT`（間接呼び出しの型不一致/範囲外）・`WASM_RT_TRAP_EXHAUSTION`（スタック枯渇）はブラウザで `WebAssembly.RuntimeError` として観測される。
- embedder が実装する `wasm_rt_*` 契約は脅威モデルの地図。**`wasm_rt_grow_memory` は失敗時 `0xffffffff` を返す**、メモリ・table 要素は**ゼロクリア必須**、`page_size` は既定 64 KiB。
- **ホスト（インポート）関数のポインタ未検証が Wasm サンドボックス突破の主戦場**。`w2c_host_fill_buf` の `ptr + i` は境界チェックの好例（この例では実害無しだが一般には危険）。
- 最適化ビルドでは準拠維持のため `-fno-optimize-sibling-calls -frounding-math`（GCC はさらに `-fsignaling-nans`）が要る。Segue は x86_64 Linux + clang 固有の高速化。
- **wasm-decompile は `.wasm` を C 風擬似コード（`.dcmp`）に逆コンパイルする。1.0.29〜1.0.41 に同梱、1.0.42 で削除**。手元にあるかは `--help` で判定。
- `.dcmp` は**読むための形式で再ビルドできない**。名前は name セクション → リンカシンボル → import/export の順で導出。`--strip-debug 済みでも --emit-reloc があれば名前が復元できる。
- ロード/ストアは `o[i]:int`（`[]` はスケール前インデックス、実効オフセット = index × 型サイズ）。構造体推定 `var o:{ a, b, c }`、幅の狭いロードは `byte`/`ubyte`/`short`/`ushort` として型に現れる。
- **`.dcmp` の演算子優先順位は C と違う**（`<<` が `+` より低く、`&` が比較より低い。結合的なのは `+` と `*` だけ）。制御フローは `goto L;`/`label L:` に平坦化され、境界チェックの有無が追いやすい。
- **wasm-decompile は検証を通らない module を逆コンパイルできない**（`ValidateModule` で停止）。名前生成は常に実行。壊れた wasm は `wasm-objdump -d` に切り替える。
- **WAT の正式文法（`interpreter/README.md`）が全命令リストを与える**。`load`/`store` は `offset=`・`align=` の即値を取り、`offset=` は実効アドレスに足される。見落とすと境界計算を誤る。
- 名前は AST に存在せず**パーサでインデックスに置換される**。ブロックコメント `(; ;)` は入れ子可能。import は最初の本来の定義より前に置く必要がある。文字列は `\<hex><hex>` で生バイトを埋め込める。
- 解析ワークフローは「識別（8 バイト）→ objdump で構造・攻撃面 → validate → wasm2wat → wasm-decompile → wasm-interp → wasm2c+ASAN → wasm-stats → wat2wasm で PoC → wat-desugar で正規化」の 10 ステップ。

## 理解度チェック

1. wasm2c で生成した C を `-O2` でコンパイルするとき、なぜ特定の最適化を無効化する必要があるのか。GCC 11 で足すべきフラグは何か。
   ▶ 答え: wasm2c は WebAssembly 仕様への準拠を維持するため C コンパイラの特定の振る舞い（シグナリング NaN → クワイエット NaN 変換、無限再帰の trap 生成）に依存しており、最適化がそれを壊すため。GCC 11 では `-fno-optimize-sibling-calls -frounding-math -fsignaling-nans`（clang 14 では前 2 つだけ）。

2. `wasm_rt_grow_memory` は失敗時に何を返す契約か。これがなぜ診断上重要か。
   ▶ 答え: `0xffffffff` を返して失敗する契約。呼び出し側がこの戻り値を検証せず「成功した新サイズ」として使うと、サイズ計算を誤り境界外アクセスにつながるため。

3. wasm2c の `w2c_host_fill_buf` のどの行がホスト関数の脆弱パターンを示しているか。何が問題か。
   ▶ 答え: `instance->memory.data[ptr + i] = instance->input[i];`。`ptr` を検証していないため、`ptr` が線形メモリサイズを超えるとホスト側でヒープ外書き込みになる。一般にホスト（インポート）関数がポインタ引数を検証しないと Wasm サンドボックスを突破できる。

4. `wasm-decompile` はどの wabt 版まで同梱されているか。手元の版に入っているかをどう判定するか。
   ▶ 答え: 1.0.29〜1.0.41 に同梱され、1.0.42 で削除された（`main` にも無い）。判定は `wasm-decompile --help` が通るか（通れば 1.0.41 以前）。

5. `.dcmp` に `o[2]:int` とあった。これは `o` からバイトオフセットいくつの何バイトを読むか。
   ▶ 答え: `[]` の中はスケール前のインデックスで、実効バイトオフセットは「インデックス × 型サイズ」。`int` は 4 バイトなので、要素 2 はバイトオフセット 8 の 4 バイト。

6. `.dcmp` の 1 行 `0[0]:int * 1 + 2 << 3 == 4 & 5` を、デコンパイラの優先順位に従って括弧付けせよ。C の優先順位と何が違うか。
   ▶ 答え: `((((0[0]:int) * 1) + 2) << 3) == 4) & 5`。C とは違い `<<`/`>>` が `+`/`-` より低く、比較が `<<`/`>>` より低く、`&`/`|` が比較より低い。結合的なのは `+` と `*` だけ。

7. `wasm-decompile` が「invalid module」で停止したとき、処理パイプラインのどの段で止まっているか。次に試す手は何か。
   ▶ 答え: `ValidateModule`（検証）の段。まず `--enable-all` で再試行し、それでも通らなければ検証を要求しない `wasm-objdump -d` に切り替える。壊れた custom セクションが原因なら `--ignore-custom-section-errors`。

8. `wasm2wat` の出力に `i32.load offset=4` とあった。実効アドレスはどう決まるか。同じアクセスは `.dcmp` ではどう見えるか。
   ▶ 答え: 実効アドレスは「スタック上のアドレス + `offset=` の値（4）」。`.dcmp` では `o[1]:int` のようにインデックスに畳み込まれて表示される（同じアクセスが 2 形式で違って見える）。

9. リリースビルドで `--strip-debug` されている `.wasm` から、関数名を復元できる可能性がある条件は何か。どう確認するか。
   ▶ 答え: リンカ（`wasm.ld`）が `--emit-reloc` を付けていれば linking カスタムセクションのシンボル表が完全リンク済み module にも残り、大半の関数名が得られる。`wasm-objdump -h` で `linking` セクションの有無を確認する。

10. WAT のブロックコメントはどう書き、行コメントと何が違うか。バグハンティングでなぜ重要か。
    ▶ 答え: ブロックコメントは `(; ... ;)`（行コメントは `;;`）。ブロックコメントは正しく入れ子になる。難読化された WAT でコメントにコードを隠す・閉じ忘れを装う手口があり得るため、読むときに注意が要る。

## 出典

- WABT `wasm2c/README.md`: https://raw.githubusercontent.com/WebAssembly/wabt/HEAD/wasm2c/README.md
- WABT `docs/decompiler.md`（wasm-decompile 出力言語の設計）: https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/docs/decompiler.md
- WABT `man/wasm-decompile.1`（man ページ mdoc ソース、最終収録版）: https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/man/wasm-decompile.1
- WABT `src/tools/wasm-decompile.cc`（処理パイプライン）: https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/src/tools/wasm-decompile.cc
- WABT `test/decompile/names.txt` / `precedence.txt`（出力の期待値テスト）: https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/test/decompile/
- WABT `README.md`（1.0.41、ツール一覧と Running wasm-decompile）: https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/README.md
- WABT リポジトリ（man ページ HTML 版・デモの本来の配布元、遮断のため未取得）: https://github.com/WebAssembly/wabt / https://webassembly.github.io/wabt/doc/wasm-decompile.1.html
- WebAssembly 仕様リファレンスインタプリタの S 式文法: https://raw.githubusercontent.com/WebAssembly/spec/main/interpreter/README.md
- WebAssembly テキスト形式の仕様（決定的出典、遮断のため未取得）: https://webassembly.github.io/spec/core/text/
- WebAssembly 仕様本文ソースの目次: https://raw.githubusercontent.com/WebAssembly/spec/main/document/core/index.rst

<!-- sources: https://raw.githubusercontent.com/WebAssembly/wabt/HEAD/wasm2c/README.md, https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/docs/decompiler.md, https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/man/wasm-decompile.1, https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/src/tools/wasm-decompile.cc, https://raw.githubusercontent.com/WebAssembly/wabt/1.0.41/README.md, https://raw.githubusercontent.com/WebAssembly/spec/main/interpreter/README.md, https://github.com/WebAssembly/wabt, https://webassembly.github.io/wabt/doc/wasm-decompile.1.html, https://webassembly.github.io/spec/core/text/ -->
<!-- terms: wasm2c, wasm-decompile, WABT, WAT, 線形メモリ, スタックマシン, trap, wasm_rt_trap_t, WASM_RT_TRAP_OOB, call_indirect, funcref, externref, embedder, name セクション, linking セクション, Segue, ASAN, S 式, offset=, align=, 構造体推定, 演算子優先順位, ブロックコメント, オペコード, サンドボックス -->
<!-- self-read: https://webassembly.github.io/wabt/doc/wasm-decompile.1.html | webassembly.github.io が組織の egress ポリシーで遮断（CONNECT 403 / EGRESS_BLOCKED）。内容は wabt リポジトリの man/*.1・docs/decompiler.md から逐語再現 -->
<!-- self-read: https://webassembly.github.io/spec/core/text/ | webassembly.github.io が egress ポリシーで遮断（CONNECT 403）。文法は仕様インタプリタの interpreter/README.md から逐語転記した便宜的文法であり仕様本文そのものではない -->
