# 第2章 PHPオブジェクトインジェクションとPHARデシリアライゼーション

## PHPシリアライズ入門ラボ（参照）

本節では、PHPオブジェクトインジェクションの理解を助ける2つのPortSwiggerラボを題材に、「なぜPHPのシリアライズフォーマットが攻撃対象になるのか」「アプリケーションの正規機能がどのようにデシリアライゼーションの武器になるのか」という**仕組みのレベル**で解説する。ラボそのものの攻略手順（どのボタンをどう押すか）は本書のスコープ外であり、防御側の設計者・レビュアーが押さえるべき原理のみを扱う。

### PHPシリアライズフォーマットの基礎

PHPは `serialize()` 関数を使って、オブジェクトや配列などの値を、復元（`unserialize()`）可能な文字列表現に変換する。この文字列は独自のテキストベースフォーマットであり、JSONのような一般的なデータ交換形式とは異なり、**型情報と長さ情報を文字列自身に埋め込む**という特徴を持つ。代表的な表現は次のとおりである。

```
b:1;                          // boolean(true)
i:42;                         // integer(42)
s:5:"hello";                  // string, 長さ5, "hello"
a:2:{i:0;s:3:"foo";i:1;s:3:"bar";}   // array(2) { [0]=>"foo", [1]=>"bar" }
O:4:"User":2:{s:4:"name";s:5:"admin";s:5:"admin";b:1;}
                               // object, クラス名長4 "User", プロパティ2個
```

ここで sink（入力が最終的に実行・解釈される危険な代入先）となるのは `unserialize()` である。この関数はシリアライズ文字列を先頭から機械的にパースし、`O:` で始まるトークンを見つけると、**そのクラス名でオブジェクトを生成し、後続のプロパティをそのまま復元する**。つまり `unserialize()` は「文字列から任意のプロパティ値を持つ、任意の（オートロード可能な）クラスのオブジェクトを生成できる」機能であり、その入力が信頼できないユーザー由来であれば、攻撃者は文字列を書き換えるだけでオブジェクトの内部状態を自由に操作できる。ここがPHPデシリアライゼーション攻撃全体の核心であり、以降に紹介するラボもこの性質を利用している。

セッション管理の実装でしばしば見られるのが、ログイン状態やロールなどのユーザー属性をPHPオブジェクトとしてシリアライズし、それをそのままセッションクッキーの値として（多くの場合Base64でURLセーフにエンコードして）クライアントに保存させる設計である。サーバーはクッキーを受け取ると、Base64デコード後に `unserialize()` してオブジェクトを復元し、その属性（例: `admin` フラグ）を信頼して認可判断に使う。この設計自体が、次に述べる改ざん攻撃の前提条件になる。

### ラボ1: シリアライズされたオブジェクトの改ざん（Modifying serialized objects）

> 出典: Lab: Modifying serialized objects — https://portswigger.net/web-security/deserialization/exploiting/lab-deserialization-modifying-serialized-objects

このラボが示す脆弱性のパターンは、「シリアライズベースのセッション機構」において、セッションクッキーの中身が暗号署名も整合性チェックもされないままクライアント側に渡されている、というものである。クッキーをBase64デコードすると、PHPシリアライズされたオブジェクトの平文が現れ、その中に `admin` という属性がブール値 `b:0`（false）として格納されている。

```
O:4:"User":3:{s:8:"username";s:5:"carla";s:5:"admin";b:0;s:12:"session_id";s:8:"abc12345";}
```

このフォーマットが読めれば、`b:0` を `b:1` に書き換えるだけで `admin` プロパティの値を true に反転できることが一目で分かる。書き換え後の文字列を再度Base64エンコードしてクッキーとして送信すれば、サーバー側の `unserialize()` はそれをそのまま復元し、`admin` が true のユーザーオブジェクトとして扱う。

ここで重要なのは、**なぜこの改ざんが成立するのか**という原理である。

1. **整合性検証の欠如**: シリアライズデータにMAC（メッセージ認証コード）や署名が付与されていない。サーバーは「このバイト列は自分が発行したものか」「途中で改ざんされていないか」を検証する手段を持たない。
2. **長さプレフィックスとの整合**: PHPのシリアライズフォーマットでは文字列の前に必ずバイト長（`s:5:"hello"` の `5`）が明示される。値の型（`b:`, `i:`, `s:`）や長さを変えずに値そのものだけを書き換える分には、パーサはこれを正当な入力として受理してしまう。もし攻撃者が文字列の長さを変えるような改変を行えば、後続のバイトとのオフセットがずれてパースエラーになるため、値の桁数・型を保ったまま書き換えるのが典型的な手口になる（例: `b:0` → `b:1` は桁数も型も変わらないため特に成功しやすい）。
3. **サーバー側の信頼過多**: デシリアライズ後、アプリケーションは復元されたオブジェクトの属性値を「サーバーが自ら生成したものだから正しい」という前提で扱っている。しかし実際にはクライアントを経由しているため、この前提は成立しない。

この構造は、JWTの `alg: none` 攻撃やCookieの平文改ざんなど、「クライアントに渡す状態表現を検証なしで信頼する」系統の脆弱性と本質的に同根である。攻撃者にとっての利点は、リバースエンジニアリングの労力が小さいこと——PHPシリアライズフォーマットは仕様が単純で人間が目視で読み書きできるため、専用ツールがなくてもBurp SuiteのInspectorのようなデコード支援機能だけで十分に解析・改変が可能な点にある。

**防御の要点**

- セッション状態をクライアント側に持たせる場合は、シリアライズデータに対してHMACなどの完全性検証を必ず付与し、サーバー側で検証してから `unserialize()` する（あるいは検証に失敗したら復元自体を行わない）。
- より根本的には、権限に関わる属性（`admin` など）をクライアント発行のトークンに含めず、サーバー側のデータストア（DBやサーバーサイドセッションストア）で管理し、クライアントには不透明なセッションIDのみを渡す設計にする。
- PHPであれば `unserialize()` の第二引数 `allowed_classes` を使い、復元を許可するクラスを明示的に制限する、またはJSONなど検証しやすい形式に置き換えることも有効な緩和策である。

### ラボ2: アプリケーション機能を利用したデシリアライゼーションの悪用（Using application functionality to exploit insecure deserialization）

> 出典: Lab: Using application functionality to exploit insecure deserialization — https://portswigger.net/web-security/deserialization/exploiting/lab-deserialization-using-application-functionality-to-exploit-insecure-deserialization

このラボは、前述の「属性値の単純な書き換え」よりも一段進んだ考え方を扱う。攻撃者が **新しい任意コードや新しいガジェットチェーン（複数のクラス・マジックメソッドを連鎖させて意図しない処理列を作る手法）を必要とせず、アプリケーションが元々持っている正規の機能そのものを「乗っ取り先」として利用する**というアプローチである。

具体的な構図は次のように整理できる。

```
本来の処理フロー:
  ユーザーがアバター削除をリクエスト
    → セッションオブジェクトの avatar_link 属性を参照
    → その属性が指すファイルパスに対して削除処理を実行

悪用後の処理フロー:
  攻撃者がセッションクッキーをデコードし、avatar_link の値を
  被害者のホームディレクトリ内の任意ファイルパスに書き換える
    → クッキーを再エンコードして送信
    → アプリケーションは「自分のアバター削除」のつもりで
      同じ削除ロジックをそのまま実行
    → 実際には攻撃者が指定した任意パスのファイルが削除される
```

このパターンが成立する理由を仕組みレベルで見ると、次の3点に集約される。

1. **属性とロジックの結合**: アプリケーションのコードは「このオブジェクトの `avatar_link` プロパティは、常に自分自身が過去に設定した安全な値である」という暗黙の前提でファイル操作を実装している。しかしオブジェクトそのものがクライアント経由で復元される以上、その前提はデシリアライズの時点で崩れている。
2. **sink側の権限とinput側の信頼レベルの不一致**: ファイル削除処理（sink）はサーバー権限で実行される強力な操作であるのに対し、その入力（`avatar_link`）はクライアントが完全にコントロールできる。パス検証（例: ホワイトリスト化、ディレクトリトラバーサル対策、正規のアバターディレクトリ配下であることの確認）が欠如していると、この権限とデータの信頼レベルのギャップがそのまま任意ファイル操作の脆弱性になる。
3. **既存の「危険なメソッド」を再利用するだけで攻撃が成立する**: 一般的なガジェットチェーン攻撃では、`__wakeup()`（デシリアライズ直後に自動的に呼ばれるマジックメソッドで、内部状態の再初期化などに使われる）や `__destruct()`（オブジェクトが破棄される際に自動的に呼ばれるマジックメソッドで、リソースの解放処理などに使われる）を起点に、アプリケーション内の複数のクラスをつなぎ合わせて「本来届くはずのない危険な関数呼び出し」に到達させる必要がある。これは攻撃者にとってコード読解とチェーン構築の手間が大きい。これに対し本ラボが示すのは、**既に用意されている「削除」という正規機能そのものが十分に危険なsinkであり、追加のガジェットチェーンを組まなくても、対象属性を1つ書き換えるだけで悪用が完了する**という、より低コストな攻撃経路である。言い換えれば、マジックメソッドを起点とする複雑なガジェットチェーンは「新しい実行経路を作る」ための手段だが、本ラボのケースは「既存の正規実行経路の入力を乗っ取る」だけで済む、より単純だが実務上頻出するパターンである。

この違いは防御設計において重要な示唆を持つ。ガジェットチェーン対策として `__wakeup()` や `__destruct()` の実装を安全化しても、本ラボのような「属性値の乗っ取り」による正規機能の悪用は防げない。両者は独立した脅威であり、それぞれに対応する緩和策が必要になる。

**防御の要点**

- デシリアライズ後にオブジェクトの属性値をそのまま危険な操作（ファイルパス指定、コマンド引数、SQLクエリなど）に渡す前に、**用途に応じた検証**（許可されたディレクトリ配下か、想定されるファイル名パターンに合致するか等）を必ず行う。属性がどこから来たか（クライアント経由か、サーバー内部生成か）に関わらず、sinkの直前でのバリデーションを徹底する「多層防御」の考え方が有効である。
- ファイル操作系のsinkでは、パスの正規化（`realpath()` など）を行った上で、想定ディレクトリのプレフィックスと比較する形の許可リスト方式を採用し、`../` などによるディレクトリトラバーサルだけでなく、「別ユーザーの正当なファイルパスへの差し替え」も検知できるようにする。
- そもそも論として、信頼境界を越えるデータ（クライアントに渡すセッション表現）にはシリアライズ形式ではなくJSONなど構造が単純で検証しやすい形式を用い、加えてサーバー側で整合性検証（署名）を行うことが、ラボ1・ラボ2双方に共通する根本的な対策となる。

### 2つのラボから読み取れる共通原理

両ラボはいずれも「PHPの `unserialize()` が、検証なしにクライアント由来のバイト列からオブジェクトの内部状態を復元してしまう」という同一の脆弱性クラスに属しながら、悪用の“出口”（sink）が異なる点に注目したい。ラボ1は認可フラグ（`admin`）という**判断ロジックへの入力**を直接書き換える攻撃であり、ラボ2はファイルパスという**危険な操作への入力**を書き換える攻撃である。防御側は「シリアライズされたデータを復元しないようにする」という入口対策と、「復元後の値をどこでどう使うかに応じて出口ごとに検証する」という出口対策の両方を組み合わせて初めて、この脆弱性クラス全体をカバーできる。次節以降で扱うマジックメソッドを起点とした本格的なガジェットチェーン（POPチェーン）攻撃も、この「復元されたオブジェクトの属性が信頼できないまま危険な処理に流れ込む」という基本構造の延長線上にある。

## マジックメソッドとPOPチェーン構築

### この節で扱うこと

前節でPHPの`serialize()`/`unserialize()`がどのようなフォーマットで動作するかを見た。本節ではその先、「なぜシリアライズされた文字列を送り込むだけでコード実行に至るのか」という核心部分——**マジックメソッド**と、それらを連鎖させて任意コード実行の道筋を作る**POPチェーン（Property Oriented Programming chain）**——を扱う。読者が対象とする実アプリのソースを読んだときに、どこを見れば「これは危険なsink（入力が最終的に実行・解釈される危険な代入先）か」を自力で判断できるようになることを目標にする。

### マジックメソッドとは何か、なぜ危険なのか

PHPのマジックメソッドは、特定のイベント（オブジェクトの生成・破棄・文字列化・存在しないプロパティへのアクセスなど）が起きたときにPHPエンジンが**自動的に**呼び出す特殊メソッドである。名前が二重アンダースコア(`__`)で始まるのが特徴で、開発者が明示的に呼ばなくても発火する点が攻撃者にとって都合が良い。

`unserialize()`は、渡された文字列を解析してクラス名とプロパティ値を読み取り、対応するクラスのインスタンスをメモリ上に**プロパティの初期値を検証せずに**再構築する。このとき、通常のコンストラクタ(`__construct()`)は呼ばれない代わりに、以下のマジックメソッドが自動的に呼び出される機会がある。

| メソッド | 発火タイミング | 攻撃者にとっての意味 |
|---|---|---|
| `__wakeup()` | `unserialize()`実行直後 | 「復元後の後始末」処理（DB再接続、リソース再取得など）が、検証なしのプロパティ値で動く |
| `__destruct()` | オブジェクトが破棄される時（スクリプト終了時や変数のスコープアウト時も含む） | クリーンアップ処理（ファイル削除、ログ書き込みなど）が攻撃者制御下の値で動く |
| `__toString()` | オブジェクトが文字列として扱われる時 | 文字列結合やecho、比較処理などあらゆる場所が発火点になりうる |
| `__call()` / `__callStatic()` | 存在しない（またはアクセス不可な）メソッドが呼ばれた時 | 別クラスへの呼び出しを横流しする「中継地点」として使われる |
| `__get()` / `__set()` | アクセス不可・未定義のプロパティに読み書きされた時 | プロパティアクセスの連鎖を作る接着剤になる |
| `__invoke()` | オブジェクトが関数のように`$obj()`呼ばれた時 | コールバック(`array_map`, `call_user_func`など)に渡されたオブジェクトが直接実行されうる |
| `__unset()` / `__isset()` | `unset()`/`isset()`/`empty()`が対象プロパティに使われた時 | 存在確認や削除処理が別の副作用を起こす |
| `__clone()` | `clone`演算子でオブジェクトが複製される時 | 複製時の再初期化処理が悪用対象になる |
| `__sleep()` / `__serialize()` | `serialize()`実行時 | 直接の攻撃sinkにはなりにくいが、シリアライズ対象プロパティの制御に関わる |
| `__set_state()` | `var_export()`利用時 | デバッグ出力経由の間接攻撃に関与することがある |
| `__debugInfo()` | `var_dump()`実行時 | デバッグ表示処理の悪用に関与することがある |

> 出典: Demystifying PHP Object Injection — https://secops.group/blog/demystifying-php-object-injection/
> 出典: PayloadsAllTheThings: PHP Deserialization — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Insecure%20Deserialization/PHP.md

この一覧のうち、実際のPOPチェーンで「起点（entry point）」として最も多用されるのは`__wakeup()`と`__destruct()`である。理由は単純で、この2つは**攻撃者が明示的に呼び出さなくても、`unserialize()`を1回実行するだけで自動的にトリガーされる**からだ。他方、`__toString()`・`__call()`・`__get()`などは「起点」自体にはなりにくいが、起点から**次の危険な処理へバケツリレーする中継点（ミドルウェア的な役割）**として極めて重要になる。ここがPOPチェーンの核心である。

### なぜ「単一の危険なクラス」だけでは攻撃が成立しないことが多いのか

初心者が誤解しやすい点として、「`__destruct()`の中で`system($this->cmd)`のようなコードを書いているクラスがなければRCEは無理だ」という思い込みがある。しかし実務でそのような「一発アウト」なクラスが対象アプリケーションに存在することは稀である。現実のPOPチェーン構築は、**単体では無害な複数のクラスのマジックメソッドを、プロパティ値の細工だけで意図しない順序・引数で連鎖させる**ことで成立する。

例えば以下のような3つのクラスがフレームワーク内に個別に（無関係な目的で）存在するとする。

```php
class Logger {
    private $writer;
    public function __destruct() {
        // ログの最終フラッシュ処理のつもりで書かれている
        echo $this->writer;
    }
}

class Formatter {
    private $callback;
    private $data;
    public function __toString() {
        // 表示用フォーマット処理のつもりで書かれている
        return call_user_func($this->callback, $this->data);
    }
}
```

`Logger`の開発者は「`$writer`は常にFileWriterクラスのインスタンスが入る」と想定してコードを書いている。しかし`unserialize()`で復元されるオブジェクトのプロパティ型はPHPが実行時に検証しない。したがって攻撃者は`$writer`に`Formatter`のインスタンスを注入できる。すると`echo $this->writer`が`Formatter`オブジェクトを文字列として扱おうとし、`__toString()`が発火する。その中の`call_user_func($this->callback, $this->data)`は、`$callback`が`"system"`、`$data`が`"id"`であれば`system("id")`と等価になる——という具合に、**個々には無害な2つのクラスの組み合わせ**でコード実行に到達する。これがPOP（Property Oriented Programming）チェーンという名前の由来であり、ROP（Return Oriented Programming、バイナリのリターンアドレスを繋いで任意コード実行を組み立てる手法）の発想をPHPのオブジェクトプロパティの世界に持ち込んだものと理解すると仕組みが掴みやすい。

### 具体的な攻撃パターンとペイロード

#### 1. パス操作・ファイル削除系(`__destruct()`起点)

`__destruct()`内でファイルパスに関する処理(削除・移動・読み込みなど)を行うクラスがある場合、プロパティに任意パスを注入できる。

```
O:6:"POI2PT":1:{s:12:"existingfile";s:22:"../../../../etc/passwd";}
```

このペイロードの構造を分解すると:
- `O:6:"POI2PT"` — クラス名`POI2PT`(6文字)のオブジェクト
- `1:{...}` — プロパティ数1個
- `s:12:"existingfile"` — プロパティ名`existingfile`(12文字の文字列)
- `s:22:"../../../../etc/passwd"` — その値として22文字のパス文字列

`unserialize()`はこの文字列を検証なしにパースし、`POI2PT`クラスのインスタンスに`existingfile`プロパティとしてこの値を代入する。もし`POI2PT::__destruct()`内で`unlink($this->existingfile)`のような処理があれば、パストラバーサル(`../`を連ねて意図しないディレクトリへ移動する手法)によって任意ファイル削除やパス誤認による情報漏洩につながる。

> 出典: Demystifying PHP Object Injection — https://secops.group/blog/demystifying-php-object-injection/

#### 2. コマンドインジェクション系(`__destruct()`起点)

```
O:6:"POI2CI":1:{s:16:"arbitrarycommand";s:2:"id";}
```

`POI2CI`クラスの`__destruct()`が`system($this->arbitrarycommand)`のような呼び出しをしていれば、オブジェクトがガベージコレクションされる(スクリプト終了時、または明示的な`unset()`時)瞬間に`system("id")`が実行される。攻撃者はコマンドを文字列プロパティとして注入するだけでよく、コード自体を送り込む必要はない——**既存の危険なsinkに、既存の変数経由で値を流し込むだけ**という点が、SQLインジェクションなど他の注入系脆弱性と共通する発想である。

同様の考え方で、PayloadsAllTheThings側は次のような（脆弱なデモクラスに対する）ペイロード例を示している。

```
O:18:"PHPObjectInjection":1:{s:6:"inject";s:17:"system('whoami');";}"
```

ここで注意すべきは、この形の「プロパティ値そのものがPHPコード文字列」というのは**そのクラスが`eval()`や`assert()`のような文字列評価sinkを使っている場合にのみ**意味を持つ、という点である。単に`system($this->inject)`であれば`$this->inject`には`"whoami"`という**コマンド文字列**を入れればよく、`"system('whoami');"`というPHPコードそのものを入れる意味はない。原典のこの例はやや単純化されたデモである点に留意し、実際の監査では「対象クラスのsinkが文字列をどう使うか(コマンドとして渡すのか、evalするのか)」をソースコードで必ず確認する必要がある。

> 出典: PayloadsAllTheThings: PHP Deserialization — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Insecure%20Deserialization/PHP.md

#### 3. 型juggling(緩い型比較)を使った認証バイパス

PHPの`==`演算子による比較は、両辺の型が異なる場合に暗黙の型変換(type juggling)を行う。これ自体はデシリアライゼーション特有の脆弱性ではないが、**シリアライズされたプロパティの型を攻撃者が自由に選べる**ことと組み合わさると強力な武器になる。

```
a:2:{s:8:"username";b:1;s:8:"password";b:1;}
```

この配列では`username`と`password`の値がどちらも真偽値`true`(`b:1`)としてシリアライズされている。アプリケーション側が`if ($input['password'] == $storedHash)`のように緩い比較をしていた場合、`true == "任意の空でない文字列"`は真になるため、実際のパスワードハッシュを知らなくても認証を突破できる。

このカテゴリの実例としてExpressionEngine CMSでは、クッキーの整合性検証において、MD5ハッシュが`"0e"`から始まり以降がすべて数字である文字列(`"0e123456789..."`のような値)を、PHPが**科学的記数法の数値**(0×10^123456789)として解釈し、別の同様な値と`==`比較すると数値同士では両方0として一致してしまう、という「マジックハッシュ」問題を利用した。研究者は該当ハッシュを総当たりで探索し、事前認証状態でのSQLインジェクションに到達したと報告されている。

> 出典: Demystifying PHP Object Injection — https://secops.group/blog/demystifying-php-object-injection/

**なぜここが仕組みレベルで重要か**: `unserialize()`は文字列だけでなく整数・真偽値・配列・オブジェクトなど任意の型を復元できる。開発者が「このパラメータはユーザーが入力するのだから文字列のはず」という前提でコードを書いていても、シリアライズされたペイロードでは**型そのものを攻撃者が指定できる**。これが緩い比較との組み合わせで型juggling脆弱性を生む根本原因である。

### 実例で見るPOPチェーンの流れ

原典で紹介されているMoodleのShibboleth連携モジュールの事例は、POPチェーンの「起点発見」の考え方を学ぶのに適している。`logout_file_session()`というハンドラがセッションファイルの中身をパイプ文字(`|`)区切りとして単純にパースしており、値の一部が本来ユーザー名やタイムスタンプの想定であったところに、次のようなペイロードを紛れ込ませることができた。

```
xxx|O:8:"Evil":0:{}
```

パース処理がこの文字列の`O:8:"Evil":0:{}`部分を(本来意図しない形で)`unserialize()`に渡してしまい、事前認証状態でのオブジェクトインジェクション、ひいてはRCEに至ったとされる。この事例が教えてくれるのは、**「`unserialize()`という関数呼び出しを直接検索する」だけでは不十分**で、「パイプ区切り文字列のパース処理」「セッションデータの復元処理」「キャッシュの読み込み処理」など、**間接的にシリアライズフォーマットの文字列を受け取ってしまう箇所**まで洗い出す必要がある、という点である。

> 出典: Demystifying PHP Object Injection — https://secops.group/blog/demystifying-php-object-injection/

### POPチェーンを手作業で組み立てる際の手順

実際の監査・研究(防御目的のコードレビューやCVE再現分析)でPOPチェーンを構築する際は、次のような手順を踏むのが定石である。

1. **`unserialize()`の呼び出し箇所(sink)を洗い出す** — 直接呼ばれている箇所だけでなく、`unserialize()`をラップした内部関数、セッションハンドラ、キャッシュ層など間接的な経路も含める。
2. **`__wakeup()`と`__destruct()`を実装しているクラスを列挙する** — これらが「起点」候補になる。
3. **起点クラスのプロパティが、他のどのクラスを受け取りうるか(型が固定されていないか)を確認する** — PHPは型宣言がない限りプロパティの型を強制しない。
4. **起点から辿れる先に、`__toString()`・`__call()`・`__get()`など「中継点」となるマジックメソッドを持つクラスがないか探す**。
5. **最終的に到達できる危険なsink(`system()`, `eval()`, `assert()`, `include()`, ファイル操作関数など)を特定し、そこまでの各段階でプロパティ値を望みの型・値に設定できるかを検証する**。
6. **上記の連鎖を1つのシリアライズ済み文字列として組み立てる**。

この手順を手作業で行うのは煩雑であり、規模の大きいフレームワークでは現実的でない場合が多い。そこで実務では既知フレームワーク向けのペイロード生成ツールが使われる。

### PHPGGC — 既知フレームワーク向けPOPチェーン生成ツール

`phpggc`(ambionics/phpggc)は、Laravel・Symfony・Doctrine・Guzzle・Monolog・SwiftMailer・WordPress・Drupal7・Magento・Slim・Phalcon・CodeIgniter4・Yii・ZendFrameworkなど、**94以上の既知ガジェットチェーン**をライブラリ化し、コマンドラインから生成できるツールである(数値・対応フレームワークの範囲は原典執筆時点のバージョンに基づく。フレームワーク側の修正状況により、同一バージョンでもチェーンが無効化されている場合がある点に注意)。

```bash
# 利用可能な全チェーンを一覧表示
phpggc --list

# 特定フレームワークのチェーンのみ絞り込み
phpggc -l Laravel

# 特定チェーンの詳細情報(発火する脆弱性の種類、必要なトリガー方法など)を確認
phpggc -i Laravel/RCE1

# Monolog向けチェーンで任意PHPコードを実行するペイロードを生成
phpggc monolog/rce1 'phpinfo();' -s

# SwiftMailer向けチェーンでファイル書き込み(シェル設置)を狙う
phpggc swiftmailer/fw1 /var/www/html/shell.php /tmp/data

# Monolog向けでコマンド実行、Phar形式で出力
phpggc Monolog/RCE2 system 'id' -p phar -o /tmp/testinfo.ini
```

各チェーンには「Name(識別名)」「Version(対応バージョン範囲)」「Type(RCE/SQLi/ファイル操作など到達する脆弱性の種類)」「Vector(起点となるマジックメソッド、例えば`__destruct`か`__wakeup`か)」「Information(追加の前提条件)」といったメタ情報が付与されている。監査業務でこのツールを使う意義は、**既知のオープンソースコンポーネントが対象アプリに含まれているかを確認できれば、フレームワーク内部のPOPチェーンをゼロから手作業で組み立て直す必要がない**という点にある。ただし対象は防御目的の検証(自組織が保有する環境・許可された検証環境)に限られ、無許可の本番環境に対して使用してはならない。

> 出典: PayloadsAllTheThings: PHP Deserialization — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Insecure%20Deserialization/PHP.md

### `-p phar`オプションが意味すること(次節への接続)

上記の`phpggc`の例に`-p phar`というオプションが登場した。これは生成したPOPチェーンのペイロードを、通常の`serialize()`文字列としてではなく**PHARアーカイブ形式**で出力するモードである。PHARファイルはスタブ(`__HALT_COMPILER();`で終わるPHPコード)・マニフェスト(メタデータ)・ファイル本体・署名という構造を持ち、このマニフェスト部分に`setMetadata()`でシリアライズ済みオブジェクトを埋め込める。重要なのは、**`unserialize()`を直接呼んでいなくても、`file_exists()`や`fopen()`などのファイル操作関数が`phar://`スキームを介してPHARファイルに触れるだけで、内部のシリアライズされたメタデータが自動的にunserializeされる**という挙動である。この「見た目はファイル操作なのに、実体はデシリアライゼーション攻撃になる」という仕組み(phar deserialization)については、次節「PHARデシリアライゼーションの仕組みと悪用」で、なぜファイル拡張子の偽装(JPEGヘッダ付与など)が可能になるのかというパーサレベルの理由とあわせて詳しく扱う。

### 防御の要点

本節で見た攻撃パターンはいずれも、**「信頼できない入力を`unserialize()`(または間接的に同等の処理)に渡している」**という一点に起因する。したがって最も確実な対策は以下の順で検討すべきである。

1. **そもそもユーザー入力を`unserialize()`に渡さない設計にする** — 可能な限り`json_encode()`/`json_decode()`のような、オブジェクト再構築を行わないシリアライゼーション形式に置き換える。JSONはマジックメソッドの自動発火という概念自体を持たないため、POPチェーンの前提が成立しない。
2. **`unserialize()`を使わざるを得ない場合は、第2引数の`allowed_classes`オプションでクラスを許可リスト化する**(例: `unserialize($data, ['allowed_classes' => false])`とすればオブジェクトへの復元自体を禁止し、スカラー値・配列のみを許可できる)。
3. **デシリアライズ対象データに対してHMACなどの改ざん検知(整合性検証)を、`unserialize()`実行前に必ず行う** — 署名鍵は入力側からは推測不可能な形で保管する。
4. **セッションハンドラ・キャッシュ層・パイプ区切りパーサなど、`unserialize()`を間接的に呼び出す全ての経路を棚卸しする** — Moodleの事例が示す通り、直接の呼び出し箇所だけを見ても見落としが生じる。
5. **PHP自体のバージョンとフレームワークの依存ライブラリを最新に保つ** — PHPGGCが対応するガジェットチェーンの多くは、該当フレームワークの特定バージョンでのみ有効であり、修正パッチの適用によって鎖が切断される。

これらの対策はいずれも「攻撃者にPOPチェーンを組ませない・組めても発火させない」という発想に基づいており、個々のマジックメソッドを無くすことはできない(PHP言語仕様の一部であるため)以上、**入力の入り口(unserializeへの到達経路)を塞ぐこと**が最も費用対効果の高い防御であることを強調しておく。

## PHARデシリアライゼーション（unserialize呼び出しなしの発火）

これまでのセクションでは、`unserialize()` に攻撃者制御データが直接渡されるケースを扱ってきた。しかし2018年のBlackHat US-18でSam Thomas氏が発表した手法は、この前提を覆す。**アプリケーションコード中に `unserialize()` という文字列が一切存在しなくても、PHPのデシリアライゼーション脆弱性（オブジェクトの直列化データを復元する処理に潜む欠陥）は発火しうる**、というのがこの節の核心である。原因は、PHPアーカイブ形式である「Phar（PHp ARchive）」の内部構造と、ファイル操作関数群が持つ「ストリームラッパー」という仕組みにある。

### Pharファイルとは何か

Pharは、tarやzipのように複数ファイルを1つにまとめてPHPアプリケーションを配布・実行するためのアーカイブ形式である。重要なのは、Pharアーカイブが単なるファイルの集合ではなく、**アーカイブに関するメタデータをシリアライズ（PHPオブジェクトを文字列に変換すること）した形で内部に保持している**という点だ。

> ⚠️ 出典: Vickie Li「PHP Phar Deserialization」 — https://vickieli.dev/insecure%20deserialization/php-phar/
> 「phar files contain metadata about the files in the archive. In a phar file, metadata is stored in a serialized format.」（Pharファイルはアーカイブ内のファイルに関するメタデータを含み、そのメタデータはシリアライズ形式で保存される）

Keysightのブログはこの構造をさらに詳細に4要素へ分解している。

> 出典: Exploiting PHP Phar Deserialization（Keysight, Part 1） — https://www.keysight.com/blogs/en/tech/nwvs/2020/07/23/exploiting-php-phar-deserialization-vulnerabilities-part-1

1. **スタブ（Stub）**: `<?php __HALT_COMPILER();` を必ず含むPHPブートストラップコード。Pharとして認識されるための必須マーカーであり、これ以降のバイト列がアーカイブ本体として扱われる。
2. **マニフェスト（Manifest）**: アーカイブ内のソースファイルを記述する部分で、**シリアライズされたメタデータ**をここに格納できる。Keysightはこれを「this serialized chunk is a critical link in the exploitation chain（このシリアライズされたチャンクこそが攻撃連鎖の重要な結節点である）」と表現しており、本脆弱性の核心はまさにここにある。
3. **ソースファイル本体**: アーカイブが実際に持つファイル群。
4. **署名（Signature）**（任意）: アーカイブの整合性検証用のハッシュ。

Pentest-Toolsの記事も同様の4分割（スタブ／マニフェスト／ファイル内容／署名）を示しており、複数の一次資料で構造の理解が一致している。

> 出典: How to exploit the PHAR deserialization vulnerability（Pentest-Tools） — https://pentest-tools.com/blog/exploit-phar-deserialization-vulnerability

### なぜ `unserialize()` を呼ばずに発火するのか——`phar://` ストリームラッパーの仕組み

PHPには、`fopen()` や `file_get_contents()` のようなファイル操作関数に「どのプロトコルでファイルを開くか」を指定できる**ストリームラッパー**という仕組みがある。`http://`、`ftp://` と同様に、PHPは `phar://` という独自のラッパーを提供しており、`phar://path/to/archive.phar/internal/file.txt` のようにPharアーカイブ内部のファイルへ透過的にアクセスできるようにしている。

ここに脆弱性の本質がある。**`phar://` ラッパーを経由してPharファイルにアクセスすると、PHPはそのアーカイブのメタデータ（マニフェスト内のシリアライズ済みデータ）を自動的にデシリアライズする。** これは `unserialize()` を明示的に呼び出しているわけではなく、Pharの内部実装（拡張モジュール `phar` がストリームを開く際に行う前処理）がメタデータの復元を暗黙に行うために起きる。

> 出典: Vickie Li「PHP Phar Deserialization」 — https://vickieli.dev/insecure%20deserialization/php-phar/
> 「the phar file's metadata would be unserialized」（Pharファイルのメタデータはデシリアライズされる）

言い換えると、**sink（入力が最終的に実行・解釈される危険な代入先）は `unserialize()` そのものではなく、`phar://` を扱えるあらゆるファイル操作関数**になる。これがコードレビューやgrepベースの静的解析で本脆弱性が見落とされやすい理由である。「`unserialize` を検索して呼び出し箇所がなければ安全」という短絡的な判断は、Phar経由の攻撃経路を完全に見逃す。

### 発火点（sink）となる関数群

Vickie Liの記事は、`phar://` ラッパーを経由することでデシリアライズを誘発しうる関数として次を挙げている。

> 出典: Vickie Li「PHP Phar Deserialization」 — https://vickieli.dev/insecure%20deserialization/php-phar/

- `file()`
- `file_exists()`
- `file_get_contents()`
- `fopen()`
- `rename()`
- `unlink()`
- `include()`

Keysightの記事はさらに広く、`copy()`、`stat()`、`parse_ini_file()` など計24個のファイルシステム関数がこの経路に該当すると述べている。

> 出典: Exploiting PHP Phar Deserialization（Keysight, Part 1） — https://www.keysight.com/blogs/en/tech/nwvs/2020/07/23/exploiting-php-phar-deserialization-vulnerabilities-part-1

つまり、アプリケーションが「ファイルの存在確認」「ファイルの読み込み」「ファイル削除」「テンプレート/設定ファイルのinclude」といったごく普通の処理に、**攻撃者が一部でも制御可能なパス文字列**を渡していれば、そのパスの先頭を `phar://` に書き換えるだけで攻撃の入口になりうる。これはファイルインクルード脆弱性（LFI）や、単なるパストラバーサル、あるいはファイル列挙機能ですら、条件次第でRCEへ格上げされることを意味する。

> 出典: Vickie Li「PHP Phar Deserialization」 — https://vickieli.dev/insecure%20deserialization/php-phar/
> 「would allow attackers to escalate a file inclusion or enumeration vulnerability into remote code execution」

### 攻撃の前提条件

Pentest-Toolsの記事は、実際に悪用が成立するための必要条件を整理している。

> 出典: How to exploit the PHAR deserialization vulnerability（Pentest-Tools） — https://pentest-tools.com/blog/exploit-phar-deserialization-vulnerability

1. **POPチェーン（gadget chain）の存在**: アプリケーションまたはその依存ライブラリ内に、`__wakeup()` や `__destruct()` などのマジックメソッド（PHPがオブジェクトのライフサイクルの節目で自動的に呼び出す、二重アンダースコアで始まる特殊メソッド）を悪用可能な形で実装したクラスが存在すること。これを「POP chain（Property-Oriented Programming chain）」と呼ぶ。既存メソッドの実行順序をプロパティ値の細工だけで乗っ取る手法である。
2. **悪意あるPharのアップロード**: 攻撃者が細工したPharファイル（拡張子を `.jpg` や `.zip` などに偽装した「ポリグロット」ファイルであることも多い）をサーバー上の任意の場所に配置できること。多くの場合、通常のファイルアップロード機能を悪用する。
3. **エントリポイント**: サニタイズされていないユーザー入力が、上記の脆弱な関数（sink）に渡り、かつパスの一部として `phar://` を注入できること。

Vickie Liの記事も同様に「ファイルアップロード機能」と「攻撃者がファイルパス全体を制御できること」の2条件を挙げており、複数資料で条件が一致している。

### マジックメソッドが引き金になる仕組み

PHPのシリアライズは、オブジェクトのプロパティ（クラス名と値）を保存するが、メソッドのコードそのものは保存しない。デシリアライズ時にPHPが行うのは「同名のクラスを探し、保存されていたプロパティ値をセットしてインスタンスを再構築すること」だけである。しかし、そのクラスに `__wakeup()`（デシリアライズ直後に自動実行）や `__destruct()`（オブジェクトがガベージコレクトされる際に自動実行）が定義されていれば、**再構築されたプロパティ値を使ってそのメソッドが実行される**。

> 出典: Exploiting PHP Phar Deserialization（Keysight, Part 1） — https://www.keysight.com/blogs/en/tech/nwvs/2020/07/23/exploiting-php-phar-deserialization-vulnerabilities-part-1

Keysightが示す典型的な危険パターンは次の通りである。

```php
class PDFGenerator {
    public $fileName;
    public $callback;
    function __destruct() {
        call_user_func($this->callback, $this->fileName);
    }
}
```

このクラスの `__destruct()` は、`$this->callback` に格納された値を関数名として呼び出し、`$this->fileName` を引数として渡している。攻撃者が `callback` プロパティに `"passthru"`、`fileName` プロパティに `"uname -a > pwned"` をセットしたシリアライズ済みオブジェクトを用意できれば、そのオブジェクトが（どこで復元されようと）ガベージコレクトされた瞬間に `passthru("uname -a > pwned")` が実行される。**攻撃者はこのクラスのコードを一切書き換えていない。アプリケーションが元々持っていたクラス定義を、プロパティ値の選択だけで悪用している**——これがPOP（Property-Oriented Programming）と呼ばれる所以である。

### 悪意あるPharの作成と悪用の一連の流れ

Keysightの記事は、検証目的での概念実証コードを次のように示している（読者の理解のためにコードの構造のみを引用し、破壊的な実行手順の詳細な再現は本書の対象外とする）。

```php
<?php
class PDFGenerator { }
$dummy = new PDFGenerator();
$dummy->callback = "passthru";
$dummy->fileName = "uname -a > pwned";

@unlink("poc.phar");
$poc = new Phar("poc.phar");
$poc->startBuffering();
$poc->setStub("<?php echo 'Here is the STUB!'; __HALT_COMPILER();");
$poc["file"] = "text";
$poc->setMetadata($dummy);
$poc->stopBuffering();
?>
```

> 出典: Exploiting PHP Phar Deserialization（Keysight, Part 1） — https://www.keysight.com/blogs/en/tech/nwvs/2020/07/23/exploiting-php-phar-deserialization-vulnerabilities-part-1

このコードで注目すべきは `$poc->setMetadata($dummy)` の行である。Vickie Liの記事も同様に `Phar::setMetadata()` メソッドについて「任意のシリアライズ済みPHPオブジェクトをアーカイブのメタデータに埋め込む」機能だと説明している。

> 出典: Vickie Li「PHP Phar Deserialization」 — https://vickieli.dev/insecure%20deserialization/php-phar/
> 「The Phar::setMetadata method embeds any serialized PHP object into the archive's metadata.」

つまり `setMetadata()` に渡したオブジェクト `$dummy`（`PDFGenerator` クラスのインスタンスで、危険なプロパティ値をあらかじめセットしたもの）が、このPharファイルを開いたときに自動デシリアライズされる「時限爆弾」の中身になる。

このPharが（アップロード機能などを通じて）サーバー上に配置された後、アプリケーション側が次のようなコードで、攻撃者が一部制御可能な引数を使ってファイル読み込みを行っていたとする。

```php
class Editor {
    public function __construct() {
        global $argv;
        $this->image = @file_get_contents($argv[1]);
    }
}
$obj = new Editor();
```

このアプリケーションに対し、`file_get_contents()` へ渡すパスの先頭を `phar://` にして呼び出すと、`file_get_contents(phar://poc.phar)` の形でPharが解釈され、`setMetadata()` で埋め込んでおいた `PDFGenerator` オブジェクトのデシリアライズが走る。その結果として `__destruct()` が実行され、`passthru("uname -a > pwned")` が動く——これが「`unserialize()` を一度も呼んでいないのにRCEに至る」仕組みの全体像である。

> 出典: Exploiting PHP Phar Deserialization（Keysight, Part 1） — https://www.keysight.com/blogs/en/tech/nwvs/2020/07/23/exploiting-php-phar-deserialization-vulnerabilities-part-1

### 実際の被害範囲とgadget chainの発見手段

この手法は理論上の話にとどまらず、実際に有名OSSで多数のRCEチェーンが発見されている。Pentest-Toolsの記事は次の実例を挙げている。

> 出典: How to exploit the PHAR deserialization vulnerability（Pentest-Tools） — https://pentest-tools.com/blog/exploit-phar-deserialization-vulnerability

- WordPress（Sam Thomas氏による発見）
- Magento（Simon Scannell氏による発見）
- Drupal（Sam Thomas氏による発見）

Keysightの記事はより具体的なCVE番号とバージョンを挙げている（時事性のある情報のため、対象バージョンと修正状況を明記する）。

> 出典: Exploiting PHP Phar Deserialization（Keysight, Part 1） — https://www.keysight.com/blogs/en/tech/nwvs/2020/07/23/exploiting-php-phar-deserialization-vulnerabilities-part-1

- **WordPress 5.0.1未満**（CVE-2018-20148）
- **Drupal 8.6.x／8.5.x／7.x**（CVE-2019-6339）
- **phpBB 3.2.3**（CVE-2018-19274）
- **PrestaShop 1.6.x／1.7.x**（CVE-2018-19126）

これらの脆弱性が横断的に発見された背景には、**PHPGGC（PHP Generic Gadget Chains）** というプロジェクトの存在がある。Pentest-Toolsによれば、PHPGGCはZend、Guzzle、Symfony、Laravelといった主要フレームワークで悪用可能なマジックメソッドのgadget chainをカタログ化しており、攻撃者はアプリケーション自体にPOPチェーンがなくても、**Composerで導入された依存ライブラリ（サードパーティ製オートローダー経由）に存在するgadgetを流用できる**。これはアプリケーション本体のコードレビューだけでは不十分であり、依存関係全体を含めたgadget chain調査が必要であることを示している。

> 出典: How to exploit the PHAR deserialization vulnerability（Pentest-Tools） — https://pentest-tools.com/blog/exploit-phar-deserialization-vulnerability

### ケーススタディ：SuiteCRMにおける対策バイパス（CVE-2020-8801の再燃）

「一度パッチを当てれば終わり」ではないことを示す好例として、SnykによるSuiteCRMの分析がある。

> 出典: SuiteCRM PHAR deserialization to RCE（Snyk） — https://snyk.io/blog/suitecrm-phar-deserialization-vulnerability-to-code-execution/

SuiteCRMは以前のCVE-2020-8801への対策として、リクエストパス中に `phar://` という文字列が含まれていないかを `strpos()` でチェックするコードを7.11.13で導入した。しかしSnykの分析によれば、この検査は**大文字・小文字を区別する（case-sensitive）**実装になっていた。

> 出典: SuiteCRM PHAR deserialization to RCE（Snyk） — https://snyk.io/blog/suitecrm-phar-deserialization-vulnerability-to-code-execution/
> 「check is case-sensitive」（このチェックは大文字小文字を区別する）

PHPの `phar://` ストリームラッパーはプロトコル名の大文字小文字を区別せずに解決するため、攻撃者は単に **`PHAR://`** と大文字で書くだけで、`strpos("phar://", $path)` ベースのブラックリスト検査を素通りできた。これは「入力検証（バリデーション）を実装したつもりでも、検証ロジックがsinkの実際の解釈仕様と一致していなければ意味がない」という、Webセキュリティ全般に通じる重要な教訓を示している——**フィルタは攻撃者が使いうる正規化・表記ゆれのすべてを考慮しなければ、簡単に迂回される**。

この脆弱性は7.11.19で修正されている。対象がSuiteCRMのバックアップ機能・インポート機能・UpgradeWizard機能という「管理者向け」の複数の機能にまたがっていた点も特徴で、Snykは「トランジティブ依存関係（間接的に取り込まれるライブラリ）も含めてgadget chainのリスク評価を行うべき」と指摘している。実際、このケースで使われたgadgetはSuiteCRM自身のコードではなく、依存先の `zf1/zend-http` パッケージの `Stream.php` にある `__destruct()`（`$stream_name` プロパティに対して `@unlink` を実行するもの）であり、SuiteCRM本体が `__wakeup()` に防御コードを入れていても、依存ライブラリ側は同様に堅牢化されていなかった。

> 出典: SuiteCRM PHAR deserialization to RCE（Snyk） — https://snyk.io/blog/suitecrm-phar-deserialization-vulnerability-to-code-execution/

このgadgetはPHPGGCに`ZendFramework/FD1`として収録されており、任意ファイル削除（`.htaccess` の削除など、アクセス制御の迂回に悪用可能）を引き起こす。さらにSnykは、SuiteCRMのファイルアップロード実装における設計上の非一貫性も指摘している。通常のドキュメントアップロードはファイル名がUUIDにリネームされ推測不能になる一方、「Module Loader」機能によるZIPアップロードだけは**推測可能な固定パス（`/upload/upgrades/module/`）に元の拡張子のまま**保存されていた。この非一貫性が、攻撃者が悪意あるPharファイルの正確なパスを特定してPharストリーム経由でアクセスするための足がかりになった。

このケースが教える防御上の要点は次の3つに整理できる。

1. **ブラックリスト方式でのプロトコル文字列検査は、大文字小文字・エンコーディングなどの表記ゆれを網羅しない限り迂回される**。ホワイトリスト方式（許可する拡張子・パスパターンのみを許容する）の方が堅牢である。
2. **アップロード機能ごとに保存先のリネームポリシーが異なると、一部の機能だけが「推測可能なパス」という弱点を持つ**。すべてのアップロード経路で一貫してランダム化されたファイル名を用いるべきである。
3. **自社コードにgadgetがなくても、依存パッケージ（Composerの間接依存を含む）にgadgetが存在すれば攻撃は成立する**。セキュリティレビューはアプリケーション本体だけでなく依存ツリー全体を対象にする必要がある。

### 防御策のまとめ

各資料が共通して示す防御の要点を整理する。

> 出典: How to exploit the PHAR deserialization vulnerability（Pentest-Tools） — https://pentest-tools.com/blog/exploit-phar-deserialization-vulnerability

1. **信頼できない入力の検証**: アップロードされるファイルの種類を検証し、サーバー側でファイル名をランダム化（推測不能化）する。ユーザーが指定した拡張子やMIMEタイプを鵜呑みにしない。
2. **`phar://` ラッパーの無効化・制限**: アプリケーションが本来Pharを扱う必要がないなら、`phar.readonly` の設定や、`allow_url_fopen`／利用可能なストリームラッパーの制限などにより、`phar://` 経由のアクセス自体を遮断する。PHP 8.0以降でも `phar` 拡張自体は既定で有効なままの構成が多いため、アプリケーション側での制限が現実的な対策になる。
3. **拡張子のホワイトリスト化**: ファイル操作関数に渡すパスについて、想定される拡張子のみを許可するチェックを行う（ただし、SuiteCRMの事例が示す通り、大文字小文字などの表記ゆれを見落とさないよう注意する）。
4. **信頼できないデータのデシリアライズを避ける**: 最も根本的な対策は、アプリケーション（および依存ライブラリ）内で `__wakeup()`／`__destruct()` に危険な処理（コマンド実行、ファイル操作など）を実装しないこと、あるいはそれらのクラスが復元されうる経路を最小化することである。
5. **依存関係の棚卸し**: PHPGGCのようなツールで、自社が利用するフレームワーク・ライブラリに既知のgadget chainが存在しないかを事前に確認し、パッチが提供されている場合は速やかに適用する。

本セクションで扱った内容はあくまで防御的な理解を目的としたものであり、実際のPharファイル作成手順や特定製品への攻撃再現手順（ラボ攻略に相当する内容）は本書の範囲外とする。実務では、ユーザー制御のパスをファイル操作関数に渡す箇所を特定し、そこに `phar://`（および大文字小文字違いの表記）が到達しうるかを起点にレビューすることが、最も効果的な発見手法となる。

## phpggcによるガジェットチェーン自動生成

前節までで、PHPの `unserialize()` がなぜ危険なのか（信頼できない文字列から任意のクラスのオブジェクトを復元し、`__wakeup()` や `__destruct()` などのマジックメソッド ―― PHPが特定のタイミングで自動的に呼び出す特殊なメソッド ―― を起点に、複数クラスのメソッド呼び出しを連鎖させて最終的に危険な sink（入力が実行・評価・ファイル操作などに使われる終着点）へ到達する「POP チェーン（Property-Oriented Programming chain。オブジェクトのプロパティ値を細工することでコードのメソッド呼び出し列を乗っ取る手法）」を組み立てられるか、という原理を扱ってきた。本節では、この POP チェーン構築を人手ではなく自動化するツール「phpggc（PHP Generic Gadget Chains）」を、内部構造・使い方・原理の3方向から解説する。

読者が押さえるべき前提は一つだけである。**phpggc はエクスプロイトを届ける手段ではなく、「対象アプリケーションが読み込んでいるライブラリの中に、攻撃者が制御可能な形で存在するガジェット（悪用可能なメソッド連鎖の断片）」をカタログ化し、シリアライズ済みペイロード文字列として出力するだけのツールである。** つまり phpggc 自体は診断対象に一切通信しない。診断者・開発者は、この節で学ぶ生成物を「どのバージョンのどのライブラリがどう危険か」を理解するための教材として使い、実務では自分が権限を持つ検証環境でのみ動作確認を行うべきである。

### phpggcとは何か、なぜ必要なのか

> ⚠️ 以下は取得できた情報に基づく解説である。

Java のデシリアライゼーション攻撃には ysoserial という定番の POP チェーン生成ツールが存在し、"既知の脆弱ライブラリが classpath にあるかどうかさえ分かれば任意コード実行ペイロードを機械的に組み立てられる" という状況を作り出した。PHP エコシステムにはこれに相当するものが長らく存在しなかったため、Charles Fol（Ambionics Security）が phpggc を開発した。phpggc は「ysoserial の PHP 版」と位置づけられ、**アプリケーション固有のコードを一切解析せずに、Composer 等で導入された著名ライブラリ（Monolog、Guzzle、Symfony、Laravel、Doctrine、SwiftMailer、CodeIgniter4、CakePHP、Drupal、WordPress、Magento、Yii、ZendFramework、Bitrix 等）の中から、`unserialize()` 経由で悪用可能なクラス連鎖（ガジェットチェーン）を選んでペイロードを生成する」ライブラリ兼 CLI ツールである。

> 出典: phpggc（ambionics）リポジトリ — https://github.com/ambionics/phpggc

これが可能なのは、PHP のオブジェクトインジェクションが「アプリケーションが書いたコードの脆弱性」ではなく「デシリアライズという言語機能が、クラス名とプロパティ値を攻撃者に指定させてしまうことに起因する構造的な脆弱性」だからである。攻撃者は自分のクラスを注入できるわけではなく、**その環境に既にオートロードされている既存クラス**（vendor/ 配下のライブラリ）だけを部品として使い、それらのコンストラクタ・マジックメソッド・プロパティを望みの値に「配線」し直すことで、任意のメソッド呼び出し列を作り出す。ライブラリが同じであれば、狙えるガジェットチェーンも共通化できるため、"よく使われるライブラリ × よく使われるバージョン" の組み合わせをあらかじめ研究してデータベース化しておけば、新しい対象に出会うたびにゼロから解析する必要がなくなる。これが phpggc の存在意義である。

### 基本的な使い方 ―― 一覧・詳細・生成

phpggc は PHP 5.6 以上で動作する CLI ツールで、Kali Linux では `apt install phpggc` として同梱パッケージからも導入できる（依存は php-cli のみ、パッケージサイズは約650KB）。

> 出典: phpggc（Kali Tools ページ、CLI例） — https://www.kali.org/tools/phpggc/

基本操作は3系統に分かれる。

```bash
# 1. 収録されているガジェットチェーンの一覧を見る
./phpggc -l

# 特定ライブラリだけに絞り込む(部分一致)
./phpggc -l laravel

# 2. 特定チェーンの詳細情報(対応バージョン・作者・説明)を見る
./phpggc -i symfony/rce1

# 3. ペイロードを生成する
./phpggc Symfony/RCE1 id
./phpggc monolog/rce1 assert 'phpinfo()'
```

> 出典: phpggc（ambionics）リポジトリ — https://github.com/ambionics/phpggc

`./phpggc Symfony/RCE1 id` を実行すると、標準出力に PHP の `serialize()` 形式の文字列（例: `O:23:"Symfony\...":2:{...}` のような表現）がそのまま出力される。この文字列こそが「攻撃対象アプリケーションの `unserialize($_GET['data'])` のような sink に渡すべきバイト列」であり、対象アプリが内部でその文字列を `unserialize()` すると、Symfony にバンドルされている特定のクラス群が連鎖的にインスタンス化・メソッド呼び出しされ、最終的に `id` というシェルコマンドが実行される。

なぜ「`id` を渡すだけ」で任意コマンド実行になるのか。各チェーンの実装（`gadgets.php`）は、ユーザーが CLI で渡した「関数名」や「コード文字列」といったパラメータを、あらかじめ研究済みのオブジェクトグラフの中の特定プロパティに埋め込むテンプレートになっている。たとえば Monolog のあるガジェットチェーンは、ログのフォーマッタやハンドラを模したオブジェクトの中に `call_user_func()` 相当の呼び出しが仕込まれており、ユーザーが指定した関数名（`system` や `assert` など）とその引数が、最終的にその呼び出しの実引数として展開される。つまり phpggc は「攻撃者が動かしたい命令」と「その命令を実行させるための既存クラスの配線図」を分離しており、CLI 引数は前者だけを埋め込む役割を持つ。

### なぜ`__destruct`が狙われるのか ―― PHPのライフサイクルとの関係

> ⚠️ 以下は取得できた情報を踏まえた、一般知識に基づく補足である。

`unserialize()` がオブジェクトを復元した直後、PHP はまず該当クラスに `__wakeup()` が定義されていればそれを呼び出す。この時点では、PHP エンジンはまだ「復元されたオブジェクトがどこにも参照されていない」状態であり、変数のスコープを抜けたりスクリプトが終了したりして参照カウントが0になった瞬間に `__destruct()` が呼ばれる。多くの POP チェーンは `__destruct()` を起点（トリガー）に選ぶ。理由は、`__wakeup()` を持つクラスを起点にすると「そのクラス自身が __wakeup 内で危険な処理をしている」という限定的なケースにしか使えないのに対し、`__destruct()` は事実上すべてのオブジェクトが対象になり得るスクリプト終了時に自動発火するため、悪用できるクラスの選択肢が圧倒的に広いからである。

phpggc の `-f` / `--fast-destruct` オプションは、この `__destruct()` の発火タイミングを早める工夫である。通常、`unserialize()` によって生成されたオブジェクトが変数に代入され続けている限り `__destruct()` は呼ばれず、スクリプトの終了処理まで待たされる可能性がある（発火の信頼性が下がる）。fast-destruct は、内部的にオブジェクトの参照カウントを早期にゼロへ落とす配線を追加することで、`unserialize()` 呼び出し直後の行で即座に `__destruct()` を起こし、後続処理の影響を受けにくくする。

```bash
./phpggc -f monolog/rce2 system id
```

`__toString()`（オブジェクトが文字列コンテキストで評価されたときに呼ばれる）や `offsetGet()`（配列アクセス演算子 `$obj['key']` に対して呼ばれる、`ArrayAccess` インターフェースのメソッド）を起点とするチェーンも収録されている。これらは、対象アプリが「デシリアライズ結果をそのまま文字列結合したり配列アクセスしたりしている」という追加の挙動を必要とするため、`__destruct()` 起点よりも使える場面は限られるが、`__destruct()` が使えない場合の代替経路として重要である。

### 具体例で読み解くガジェットチェーンの内部構造

phpggc のリポジトリは各チェーンを `gadgets/<ライブラリ名>/<チェーン名>/` 以下に配置し、`gadgets.php`（各ガジェットクラスのスタブ定義）と `chain.php`（チェーンの組み立てロジックと対応バージョンの説明）の2ファイルで1チェーンを構成する。ある `chain.php` は概ね次のような形を取る（構造の要旨。実際のクラス名・プロパティ名はライブラリのソースに一致させる必要がある）。

```php
class RCE1 extends GadgetChain
{
    // このチェーンが動作すると確認されているバージョン範囲
    // 例: '2.0.0 <= 4.4.1+'
    public static $version = '2.0.0 <= 4.4.1+';

    public static $vector = 'destruct'; // 起点となるマジックメソッド

    public static $author = 'Charles Fol';

    public static $function = 'rce'; // system, exec, file_get_contents 等

    public function generate(array $parameters)
    {
        // parameters['function'], parameters['parameter'] を
        // ターゲットライブラリの実クラスのプロパティに埋め込み、
        // それらのクラスをネストしたオブジェクトグラフを組み立てる
        $chain = new GadgetChainNode(...);
        return $chain;
    }
}
```

`generate()` の中身が「なぜ動くのか」を理解する鍵は、対象ライブラリの実クラスを1つずつ遡ることにある。たとえば Monolog を狙うチェーンでは、ログの出力先（Handler）やフォーマッタとして使われるクラスの中に、あるプロパティの値を関数として呼び出す処理（PHP の `call_user_func()` や可変関数呼び出し `$var()` に相当する記述）が存在する。攻撃者はそのプロパティに `system` のような危険な関数名を注入した状態でオブジェクトをシリアライズしておけば、対象アプリがそのバイト列を `unserialize()` した瞬間に、ログ出力用の内部処理を装った形でその関数が呼び出される。ライブラリの作者はもちろんこの用途を意図していないが、「ユーザーが指定したコールバック値をそのまま実行する」という正当な機能実装が、外部から復元可能なオブジェクトの中に存在してしまっている点が攻撃の核心である。

Symfony/Doctrine 連携のチェーンも同様の考え方で、Doctrine の Proxy クラス（遅延読み込みのために本物のエンティティクラスの代理として振る舞うオブジェクト）が `__destruct()` 時に「まだロードされていなければロードする」という処理を行うことを利用し、その「ロード処理」の内部でファイルパスやクラス名を攻撃者が操作できる位置まで辿り着くと、任意ファイルの読み書きや RCE に接続できる。

これらのチェーンは、PHP のマイナーバージョンやライブラリのマイナーバージョンごとに、途中のプロパティ名やメソッドシグネチャが変わるため頻繁に壊れる。phpggc がバージョン範囲（例: `'2.0.0 <= 4.4.1+'`）を明記し、`test-gc-compatibility.py` のような互換性テストスクリプトを同梱しているのはこのためである。**したがって、あるバージョンのライブラリで「RCE1が効かなかった」からといって、そのアプリが安全とは限らない。** 対応表に載っている別のチェーン（RCE2, RCE3...）や、収録されていない未知の亜種が存在し得ることを踏まえて評価する必要がある。

> 出典: phpggc（ambionics）リポジトリ — https://github.com/ambionics/phpggc

### CLIオプションの意味と、それぞれが解決する現実の障害

生成したペイロードをそのまま HTTP パラメータやファイルに埋め込もうとすると、いくつかの実務的な障害にぶつかる。phpggc の各オプションは、その障害に一対一で対応している。

```bash
# URLエンコードして出力(パラメータとして送る場合)
./phpggc -u Symfony/RCE1 id

# Base64エンコード
./phpggc -b Symfony/RCE1 id

# Base64 → URLエンコードの順で二重処理(順序が結果を左右する)
./phpggc -b -u -u slim/rce1 system id

# NULLバイトを含む非公開/保護プロパティ名を、可読性を保ったまま安全な形式に
./phpggc -s Symfony/RCE1 id
```

シリアライズされた文字列には非公開（`private`）・保護（`protected`）プロパティのシリアライズ表現として NULL バイトを含む特殊なエンコーディングが使われる（PHP の内部仕様に由来する `\0ClassName\0propertyName` のような形式）。これは HTTP のテキストベースのパラメータや、NULLバイトを許容しないミドルウェア・WAF を通過する際に問題になりやすい。`--public-properties` はプロパティの可視性表現を「公開扱い」の形式へ書き換えることで NULL バイトそのものを排除し、`-s`（ソフトエンコード）はペイロードの可読性を保ちながら安全に扱える文字だけに変換する。

```bash
# 全プロパティを"public"表現に変換してNULLバイトを排除
./phpggc --public-properties Symfony/RCE1 id

# シリアライズ表現のクラス名バイト数を "O:+123:" のような形式にし、
# "O:[0-9]+:" という単純な正規表現ベースの検知(WAF等)を回避する
./phpggc -n Symfony/RCE1 id
```

`-n`（プラス符号付与）は、シリアライズ形式の `O:<桁数>:"<クラス名>":...` という表現に含まれる桁数部分に `+` を付加できる PHP のパーサ仕様を利用する。多くの WAF・IDS のシグネチャは `O:[0-9]+:"` という素朴な正規表現でオブジェクトインジェクションを検知しているため、桁数表記を `O:+23:` のように変形しても PHP 自体は正しく解釈できる一方、単純な正規表現マッチングは回避できてしまう。ただし記事によれば PHP 7.2 以降ではこの緩い解釈が許される型が `i`（integer）と `d`（double）のみに制限されており、オブジェクト長（`O:` の後の桁数）自体には効かないバージョンがあるため、対象の PHP バージョンによって有効性が変わる点に注意が必要である。

`--armor-strings` は文字列部分をすべて16進数表現に変換するオプションで、ペイロードサイズは約3倍に増えるが、文字列内容に基づくシグネチャ検知を広範囲に回避する目的で用意されている。

> 出典: phpggc（ambionics）リポジトリ — https://github.com/ambionics/phpggc

これらのエンコード・回避系オプションは、防御側の視点では「WAF やシグネチベースの検知だけに頼ることの限界」を示す実例として読むべきである。デシリアライズ脆弱性への根本対策は、そもそも信頼できない入力を `unserialize()` に渡さないこと、または `unserialize()` の `allowed_classes` オプション（PHP 7以降で利用可能。復元を許可するクラスをホワイトリスト指定でき、指定外のクラス名は `__PHP_Incomplete_Class` に落ちてマジックメソッドが発火しない）で復元可能なクラスを厳格に制限することであり、パターンマッチングによる検知は迂回策の存在を前提に設計しなければならない。

### PHARデシリアライゼーションとの接続 ―― `-p`オプション

本章のテーマである「PHARデシリアライゼーション」との橋渡しとして重要なのが `-p`（PHAR生成）オプションである。PHP の PHAR アーカイブ形式は、ファイル末尾にメタデータ領域を持ち、そのメタデータは PHP のネイティブなシリアライズ形式で保存されている。通常このメタデータは `unserialize()` を明示的に呼ばなくても、PHP のファイル操作関数（`file_exists()`、`file_get_contents()`、`fopen()`、`getimagesize()` など、ファイルシステム関数の多く）が対象パスを `phar://` スキームとして扱える状況下で暗黙に読み込まれ、その過程でメタデータが自動的にデシリアライズされる。これは「攻撃者が明示的に `unserialize()` を呼ばせなくても、ファイルパスをアプリケーションに処理させるだけでオブジェクトインジェクションが成立し得る」ことを意味し、通常のオブジェクトインジェクションよりも到達点（sink）の候補が大幅に広がる。

```bash
# PHAR形式でペイロードを埋め込んだファイルを生成
./phpggc -p phar -o /tmp/z.phar monolog/rce1 system id

# ZIP形式ベースのPHAR(拡張子偽装がしやすい)
./phpggc -p zip -o /tmp/z.zip.phar monolog/rce1 system id

# JPEGファイルとのポリグロット(画像として見せかけつつPHARとしても解釈される)
./phpggc -pj /tmp/dummy.jpg -o /tmp/z.zip.phar monolog/rce1 system id
```

この PHAR 生成機能は BlackHat US 2018 で発表された拡張として phpggc に統合されている。ポリグロット（画像とアーカイブの両方として解釈可能なファイル）生成オプション `-pj` は、画像アップロード機能を経由してサーバ上に配置されたファイルが、後に何らかの処理で `phar://` 経由でアクセスされた場合に発火する、というシナリオを想定したものである。

> 出典: phpggc（ambionics）リポジトリ — https://github.com/ambionics/phpggc

防御の観点では、この経路の対策は「ユーザー制御下にあるファイルパスをファイルシステム関数に渡す前に、スキーム（`phar://` など）を許可リストで制限する」「PHP 7.4以降で導入された `phar.readonly` に加え、可能であれば `phar` 拡張自体を無効化する、あるいは業務上不要ならアンインストールする」といった対応が中心になる。これらは次節（PHARデシリアライゼーションの詳細）で改めて掘り下げる。

### チェーンの新規作成・テストの仕組み

phpggc は既存チェーンの利用だけでなく、研究者が新しいガジェットチェーンを追加するための足場も提供している。

```bash
# 新規チェーンの雛形を生成(gadgets.php / chain.php の骨組みを自動作成)
./phpggc --new Drupal RCE
```

そして、あるチェーンが「対応バージョンとして宣言した範囲全体で本当に動くか」を機械的に検証する仕組みも用意されている。

```bash
# 単一バージョン環境での動作確認(ペイロードを実際に生成してunserialize相当の検証を行う)
cd some_symfony_install
phpggc monolog/rce2 --test-payload

# 複数バージョンにまたがる互換性の一括テスト
./test-gc-compatibility.py monolog/monolog monolog/rce1 monolog/rce3
```

この仕組みが存在すること自体が、ガジェットチェーンが「特定バージョンの内部実装詳細に強く依存する、壊れやすい攻撃資産」であることを裏付けている。防御側にとっての実務的な含意は、脆弱と分類されたライブラリバージョンをアップグレードすれば同じチェーンでの攻撃を機械的に無効化できる可能性が高いという点であり、依存ライブラリの継続的なバージョン管理（SCA: Software Composition Analysis）がデシリアライズ攻撃対策の重要な一角を占める理由でもある。

> 出典: phpggc（ambionics）リポジトリ — https://github.com/ambionics/phpggc

### プログラム的な利用（API）とラッパー機構

phpggc は CLI ツールであると同時に、PHP コードから直接呼び出せるライブラリとしても設計されている。

```php
include("phpggc/lib/PHPGGC.php");
$gc = new \GadgetChain\Guzzle\RCE1();
$parameters = $gc->process_parameters(['function' => 'system', 'parameter' => 'id']);
$object = $gc->generate($parameters);
$serialized = serialize($object);
```

これは、脆弱性診断の自動化ツールや、脆弱性再現用のテストハーネスに phpggc の生成ロジックを組み込みたい場合に使われる形態である。

また `-w`（ラッパー）オプションは、生成されたオブジェクト・シリアライズ結果に対して、対象アプリ固有の追加処理（例えば、対象がペイロードを配列でラップしてから `unserialize()` している、特定のプレフィックス文字列を要求する、など）を差し込むためのフック機構である。

```php
// wrapper.php の例(概念)
function process_parameters(array $parameters) {
    // generate() 実行前にパラメータを調整
    return $parameters;
}

function process_object(object $object) {
    // serialize() する前にオブジェクトそのものを加工
    return $object;
}

function process_serialized(string $serialized) {
    // serialize() 後の文字列を後処理(例: 配列でラップした形式に変形)
    return $serialized;
}
```

```bash
./phpggc -w /tmp/my_wrapper.php slim/rce1 system id
```

> 出典: phpggc（ambionics）リポジトリ — https://github.com/ambionics/phpggc

この柔軟性は、実際のアプリケーションが「素の `unserialize()` 呼び出し」ではなく、独自のシリアライズ前後処理（暗号化、署名検証、Base64ラップなど）を挟んでいるケースが多いという現実に対応するためのものである。裏を返せば、防御側が `unserialize()` の入力に何らかの前処理（署名検証や暗号化）を加えることは有効な緩和策になり得るが、それだけで根本解決にはならず、あくまで多層防御の一枚として位置づけるべきである。

### 出典に基づく背景 ―― Lexfoによる技術的位置づけ

Charles Fol（phpggc の開発者）による Lexfo のブログ記事は、この分野の技術的背景を要約している。記事は、`unserialize()` と信頼できない入力の組み合わせが「何年も前から重大な脅威」であり続けていること、多くの現代的な CMS がより安全な `json_decode()`（JSON はクラス情報を保持しないため、この種のオブジェクトインジェクションが原理的に成立しない）へ移行する一方で、カスタム開発されたサイトや古いレガシーコードでは依然としてこの脆弱性パターンが残っていることを指摘している。また、Piwik（現 Matomo）の実際の脆弱性事例で、Monolog のガジェットチェーンを用いて実際に RCE が成立した例を挙げており、phpggc のようなツールがなぜ研究の効率化に貢献するかを裏付けている。

> 出典: phpggc解説（Lexfo, Charles Fol） — https://blog.lexfo.fr/php-generic-gadget-chains.html

> ⚠️ **未取得の資料の可能性についての補足**: 上記記事は WebFetch により取得できたが、要約された内容は同記事の要点であり、記事本文に含まれるコード断片・詳細な図解のすべてを網羅しているわけではない可能性がある。より詳細な技術的挙動（各ガジェットチェーンの図示やコード全文）を確認したい場合は、原文 https://blog.lexfo.fr/php-generic-gadget-chains.html を直接参照することを推奨する。（以下は未取得資料の補足として一般知識に基づく解説）記事のタイトルにある "Generic" は、特定のアプリケーションコードに依存せず、Composer 経由で広く配布されている汎用ライブラリだけを使ってチェーンを構築する、という phpggc の設計思想そのものを指していると考えられる。

### 防御側がここから学ぶべきこと

本節の内容を診断・防御の観点でまとめると、次の3点に集約できる。

1. **攻撃面はアプリケーションコードではなく依存ライブラリにある。** 自社が一行も書いていないコード（Composer でインストールしたパッケージ）が、`unserialize()` の入力次第で RCE の踏み台になり得る。したがって、依存ライブラリの棚卸しとバージョン管理（SCA）は、独自コードの脆弱性診断と同じ重みで扱う必要がある。
2. **`__destruct()` を安全側から見る。** マジックメソッドは「デシリアライズされた瞬間に呼ばれる」という前提に立ち、`__destruct()` や `__wakeup()` の実装が「復元されたプロパティの値を無条件に信頼していないか」を確認するコードレビュー観点を持つ。
3. **検知よりも入力遮断を優先する。** phpggc の `-n` や `--armor-strings` のようなエンコード回避オプションの存在は、シグネチャベースの WAF 検知が本質的な対策になり得ないことを示している。信頼できない入力を `unserialize()` に到達させないアーキテクチャ（`json_decode()` への置き換え、`allowed_classes` の厳格な指定、外部入力の型検証）を優先し、WAF はあくまで多層防御の一部として位置づける。

次節では、この phpggc が生成するペイロードが、実際に PHAR ファイルのメタデータという形でどのように「暗黙のデシリアライズ」を引き起こすのか、その内部フォーマットとファイル操作関数群の挙動を詳しく見ていく。


---

### ナビゲーション

- ← 前の章: [第1章 デシリアライゼーションの基礎とRCE到達の枠組み](01-deserialization-basics.md)
- 🏠 [目次（ホーム）](index.md)
- → 次の章: [第3章 Javaデシリアライゼーションとガジェットチェーン](03-java-deserialization.md)
