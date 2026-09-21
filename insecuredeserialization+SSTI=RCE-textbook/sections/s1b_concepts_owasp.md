## POPチェーン/ガジェットの概念とOWASPでの位置づけ

デシリアライゼーション脆弱性を理解するうえで最初に押さえるべきは、「なぜ`unserialize()`のような一見無害な関数呼び出しがリモートコード実行（RCE: Remote Code Execution、攻撃者が対象サーバー上で任意のコードを実行できる状態）にまで発展するのか」という因果の連鎖です。この連鎖の中核にあるのが、本節で扱う**POPチェーン（Property-Oriented Programming Chain）**と**ガジェット（gadget）**という概念です。ここを正しく理解しないまま先の章（実際のペイロード生成やツール利用）に進むと、「なぜこのペイロードが動くのか」がブラックボックスのままになってしまいます。

### 1. sinkとしての`unserialize()`——脆弱性の入口

まず基礎用語を整理します。**sink（シンク）**とは、外部から流入した入力が最終的に実行・解釈される危険な代入先やAPI呼び出しのことです。デシリアライゼーション脆弱性におけるsinkは、PHPであれば`unserialize()`、Javaであれば`ObjectInputStream.readObject()`、Pythonであれば`pickle.loads()`、Rubyであれば`Marshal.load()`や`YAML.load()`（SafeLoaderを使わない場合）といった、シリアライズされたバイト列やテキストを「生きたオブジェクト」に復元する処理です。

これらの関数自体は、本来アプリケーションの状態（セッション情報、キャッシュ、設定オブジェクトなど）をファイルやネットワーク越しに保存・復元するための正当な機能です。問題は、**攻撃者が制御できる文字列をこのsinkに直接渡してしまうこと**にあります。攻撃者は「復元されるオブジェクトの型」と「そのオブジェクトが持つプロパティの値」を自由に指定できるため、アプリケーションが想定していないクラスのインスタンスを、想定していないプロパティ値で生成させることが可能になります。

> ⚠️ **未取得の資料はありません。** 本節で参照する3件のURLはすべて正常に取得できました。

### 2. OWASPにおけるPHP Object Injectionの定義と前提条件

OWASP Community Pagesの「PHP Object Injection」は、この脆弱性を次のように定義しています。

> "PHP Object Injection is an application level vulnerability that could allow an attacker to perform different kinds of malicious attacks, such as Code Injection, SQL Injection, Path Traversal and Application Denial of Service, depending on the context."
> （PHPオブジェクトインジェクションはアプリケーションレベルの脆弱性であり、文脈次第でコードインジェクション、SQLインジェクション、パストラバーサル、アプリケーションDoSなど様々な悪意ある攻撃を可能にし得る）

> 出典: OWASP Community — PHP Object Injection — https://community.owasp.org/vulnerabilities/PHP_Object_Injection

重要なのは、OWASPがこの脆弱性を「単体の脆弱性クラス」としてではなく、**他の脆弱性（コードインジェクション、SQLi、パストラバーサル、DoS）へ到達するための「入口（エントリポイント）」**として位置づけている点です。つまりオブジェクトインジェクション自体は「任意のクラスをインスタンス化できる」という限定的な能力に過ぎず、実際の被害（RCEなど）は、アプリケーション内に存在する**他のコードパス（ガジェット）と組み合わさって初めて発生する**という構造になっています。この「単体では無害だが組み合わせると危険」という性質こそが、次に説明するPOPチェーンの本質です。

OWASPは、悪用が成立するための前提条件を2つに整理しています。

1. アプリケーション内に、悪用可能な操作を行う**マジックメソッド**（`__wakeup`や`__destruct`など）を実装したクラスが存在し、それがPOPチェーンの起点となり得ること
2. `unserialize()`の実行時点で、攻撃に必要な**すべてのクラスが宣言済み、またはオートロード（autoloading、クラスが使用される際に自動的に読み込む仕組み）で解決可能**であること

この2つ目の条件は見落とされがちですが非常に重要です。PHPの`unserialize()`は、シリアライズされた文字列中に記述されたクラス名を見て、そのクラスが定義済みであれば対応するオブジェクトを生成しようとします。**クラスが定義されていなければ、そのクラスの魔術メソッドは呼び出されず、攻撃は成立しません。** したがって攻撃者は、対象アプリケーションが利用しているフレームワークやライブラリ（Laravel、Symfony、Monologなど）のソースコードを事前に調査し、「オートロード可能で、かつ危険な魔術メソッドを持つクラス」を探し出す必要があります。これが、Java版ツールであるysoserialが「Commons Collections」「Spring」といったライブラリ名でガジェットチェーンを分類しているのと同じ発想です。

> 出典: OWASP Community — PHP Object Injection — https://community.owasp.org/vulnerabilities/PHP_Object_Injection

### 3. マジックメソッドという「フック」——なぜオブジェクトが「動き出す」のか

デシリアライゼーションRCEの仕組みを理解する鍵は、多くの言語処理系が「オブジェクトのライフサイクル（生成・復元・破棄・文字列化など）の節目で、開発者が定義した特別なメソッドを自動的に呼び出す」という設計を持っていることです。PHPではこれを**マジックメソッド（magic method）**と呼びます。OWASPの記事は代表的な3つを例示しています。

#### `__destruct` — オブジェクト破棄時に自動実行される

```php
class Example1 {
   public $cache_file;
   function __destruct() {
      $file = "/var/www/cache/tmp/{$this->cache_file}";
      if (file_exists($file)) @unlink($file);
   }
}
$user_data = unserialize($_GET['data']);
```

`__destruct`は、そのオブジェクトへの参照がなくなりガベージコレクションされるタイミング（PHPではスクリプト終了時にも全オブジェクトに対して呼ばれる）で自動的に呼び出されます。この例では`cache_file`プロパティの値をパスの一部として`unlink()`（ファイル削除）に渡しています。攻撃者が`unserialize()`に渡す文字列の中で`cache_file`プロパティの値をパストラバーサル文字列（`../../`）に書き換えれば、本来削除されるべきでない任意のファイルを削除できます。

攻撃ペイロードの例（OWASP記事より）:

```
http://testsite.com/vuln.php?data=O:8:"Example1":1:{s:10:"cache_file";s:15:"../../index.php";}
```

このシリアライズ文字列は「PHP独自のシリアライズフォーマット」で書かれています。`O:8:"Example1"`は「オブジェクト（Object）、クラス名の長さ8文字、クラス名`Example1`」を意味し、`:1:{...}`はプロパティが1個あることと、その内容（プロパティ名の長さと値の長さ・内容）を表します。**なぜこれが「動く」のか**——`unserialize()`はこの文字列をパースする際、指定されたクラス名`Example1`が定義済みであることを確認し、そのクラスの新しいインスタンスを生成した上で、文字列中に書かれたプロパティ値をそのままオブジェクトの内部状態として設定します。この時点でPHPのバリデーションは一切働かず、**「型」と「値」を攻撃者が完全にコントロールできる**というのが核心です。その後スクリプトの終了処理で`__destruct`が呼ばれ、攻撃者が仕込んだ`cache_file`の値がそのまま危険な操作（ファイル削除）に使われてしまいます。

#### `__wakeup` — デシリアライズ直後に自動実行される

```php
class Example2 {
   private $hook;
   function __wakeup() {
      if (isset($this->hook)) eval($this->hook);
   }
}
$user_data = unserialize($_COOKIE['data']);
```

`__wakeup`は`unserialize()`によってオブジェクトが復元された直後に自動的に呼ばれる、いわば「復元後の後始末」を行うためのフックです。本来はDBへの再接続やリソースの再取得など、シリアライズでは保存できない状態を復元するための機構ですが、この例のように`eval()`（文字列をPHPコードとして実行する関数）へ`hook`プロパティの値をそのまま渡していると、攻撃者は`hook`プロパティに任意のPHPコードを仕込むだけで、`unserialize()`を呼んだ瞬間に任意コード実行が成立します。これはCookieという、攻撃者が完全に制御できる入力源から`unserialize()`に渡されている点も注目すべきです。セッション処理やCookieベースの状態保持を実装しているアプリケーションでは、この経路が典型的な攻撃対象になります。

> 出典: OWASP Community — PHP Object Injection — https://community.owasp.org/vulnerabilities/PHP_Object_Injection

### 4. POPチェーンの本質——単体では無害な部品を「連結」する

ここまでの2例（`__destruct`、`__wakeup`）は、脆弱なクラス単体が直接危険な操作（ファイル削除、`eval`）を行うケースでした。しかし実際の攻撃、特に大規模なフレームワークに対する攻撃では、**そのアプリケーション自身に`eval()`のような直接的な危険操作を行う魔術メソッドが存在しないことがほとんど**です。ここで登場するのがPOPチェーンです。

OWASPのExample 3は、この「間接的な連結」の最小例を示しています。

```php
class Example3 {
   protected $obj;
   function __toString() {
      if (isset($this->obj)) return $this->obj->getValue();
   }
}

class SQL_Row_Value {
   private $_table;
   function getValue($id) {
      $sql = "SELECT * FROM {$this->_table} WHERE id = " . (int)$id;
      $result = mysql_query($sql, $DBFactory::getConnection());
      $row = mysql_fetch_assoc($result);
      return $row['value'];
   }
}
```

ここでの`__toString`（オブジェクトが文字列として扱われる際、例えば文字列結合や`echo`されるときに自動的に呼ばれるマジックメソッド）は、それ自体は何も危険なことをしていません。単に`$this->obj->getValue()`を呼んで結果を返しているだけです。しかし、`obj`プロパティに**攻撃者がどんなオブジェクトでも代入できる**という前提を思い出してください。攻撃者が`obj`プロパティに`SQL_Row_Value`クラスのインスタンス（`_table`プロパティにSQLインジェクション用の文字列を仕込んだもの）を代入した状態でシリアライズ文字列を作れば、`Example3`が文字列化されるたびに、無関係な`SQL_Row_Value::getValue()`が呼ばれ、そこでSQLインジェクションが発生します。

この「Aというクラスの些細な処理が、攻撃者が注入したBというクラスのインスタンスを介して、Bの中にある本来無関係な危険操作に到達する」という構造こそがPOPチェーン（Property-Oriented Programming Chain、プロパティ指向プログラミング連鎖）です。PayloadsAllTheThingsのDeepWikiページはこれを次のように簡潔に定義しています。

> "Property Oriented Programming (POP) gadgets are code fragments that can be chained together to achieve arbitrary code execution."
> （POPガジェットとは、連結することで任意コード実行を達成できるコード断片である）

> 出典: DeepWiki — PayloadsAllTheThings: Insecure Deserialization — https://deepwiki.com/swisskyrepo/PayloadsAllTheThings/3.8-insecure-deserialization

「Property-Oriented（プロパティ指向）」という命名は、通常のプログラムが「制御フロー（if文やループ、関数呼び出しの順序）」によって処理の流れを決めるのに対し、この攻撃手法では**オブジェクトのプロパティに何を代入するか（型と値の組み合わせ）だけを操作して、既存コードの実行順序を乗っ取る**ことに由来します。攻撃者は新しいコードを一切書き込まず、アプリケーションやライブラリにすでに存在するメソッド群を「部品（ガジェット）」として選び出し、プロパティの値だけで実行順序を組み立てます。これはメモリ破壊系脆弱性におけるROP（Return-Oriented Programming、リターン命令のつながりを使って既存のコード片=ガジェットを連結し任意の処理を実現する攻撃手法）と発想が同一であり、「ガジェット」という用語もそこから借用されています。

### 5. なぜガジェットチェーンは「探索」が必要なのか——シリアライズ可能性・アクセス可能性・呼び出し可能性

DeepWikiのページは、ガジェットとして機能するための要件を次のように整理しています。

- シリアライズ可能であること（Serializability）
- パブリック、またはアクセス可能なプロパティを持つこと
- 悪用可能なマジックメソッドを持つこと
- 呼び出し可能なクラスへのアクセス経路があること

> 出典: DeepWiki — PayloadsAllTheThings: Insecure Deserialization — https://deepwiki.com/swisskyrepo/PayloadsAllTheThings/3.8-insecure-deserialization

これらの条件は、実際の攻撃者（およびセキュリティ研究者）が手動で、あるいはツール（PHPではphpggc、Javaではysoserial）を使って半自動的に、**対象アプリケーションが読み込んでいる全クラス（自作コードだけでなく、Composerで導入したライブラリやフレームワーク本体を含む）の中から、この4条件を満たす「入口クラス（kick-off gadget）」「中継クラス（pop gadget）」「終端クラス（sink gadget）」の組み合わせを探索する**という作業に直結します。

- 入口クラス: `__wakeup`や`__destruct`など、デシリアライズ完了後すぐに自動的に呼ばれるクラス
- 中継クラス: `__toString`や`__call`など、他のオブジェクトのメソッドを呼び出す性質を持つクラス。0個以上連鎖することがある
- 終端クラス（sink gadget）: 実際に`eval()`、`system()`、ファイル操作、SQLクエリなど危険な操作を行うクラス

PayloadsAllTheThingsのリポジトリ構成自体が、この探索作業を言語別に体系化したものです。GitHubページの内容によれば、同リポジトリは以下の言語別ガイドを持ちます。

- `Java.md` — ysoserialおよび関連するJavaエクスプロイト手法（Commons Collections、Spring、Groovyなどのガジェットチェーン）
- `PHP.md` — オブジェクトインジェクションおよびphpggcツール
- `Ruby.md` — 汎用RCEガジェットチェーン
- `Python.md` — pickleおよびPyYAMLのデシリアライズ攻撃
- `.NET.md` — ysoserial.netおよびBinaryFormatterの脆弱性

> 出典: PayloadsAllTheThings — Insecure Deserialization — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Insecure%20Deserialization

この言語別の分かれ方自体が重要な教訓を含んでいます。**POPチェーンの探索は原理上は言語横断的に同じ発想（マジックメソッド＋プロパティ制御）で行えますが、実際に「どのライブラリにどんなガジェットが存在するか」は完全に言語・フレームワーク依存であり、既知のガジェットチェーンを収集・カタログ化したデータベース（ysoserial、phpggcなど）を参照するのが実務上のアプローチになる**、という点です。これは次章以降で扱うツール実践編の土台になります。

### 6. シリアライズフォーマットの識別——「マジックバイト」による事前判定

実務では、脆弱性を調べる対象のフィールド（Cookie、hidden input、APIパラメータなど）が「そもそもシリアライズされたオブジェクトを含んでいるかどうか」を判定する必要があります。PayloadsAllTheThingsは、各言語のシリアライズフォーマットが持つ固有の先頭バイト列（マジックバイト、magic bytes）を一覧化しています。

| 言語/形式 | 16進ヘッダ | Base64ヘッダ |
|---|---|---|
| Java Serialized | `AC ED 00 05` | `rO0` |
| .NET BinaryFormatter | `AA EA AD` | `AAEAAD` |
| .NET ViewState | `FF 01` | `/w` |
| PHP Serialized | `4F 3A` (`O:`) | `Tz` |
| Python Pickle | `80 04 95` | `gASV` |
| Ruby Marshal | `04 08` | `BAgK` |

> 出典: DeepWiki — PayloadsAllTheThings: Insecure Deserialization — https://deepwiki.com/swisskyrepo/PayloadsAllTheThings/3.8-insecure-deserialization ／ GitHub — PayloadsAllTheThings: Insecure Deserialization — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Insecure%20Deserialization

なぜこの判定が重要かというと、**シリアライズフォーマットは自己記述的（self-describing）**であり、値の型・長さ・構造をバイト列自体の中に埋め込んでいるため、対象データがBase64デコードした結果、これらの先頭バイトと一致すれば「デシリアライズ処理系に到達している可能性が高い」と推測できるからです。例えばPHPのシリアライズ文字列が`O:`（Object、大文字のオー）で始まるのは、前節のExample1のペイロード`O:8:"Example1":1:{...}`がまさにそうであるように、PHPの`serialize()`実装がオブジェクト型を`O:<クラス名の長さ>:"<クラス名>":<プロパティ数>:{...}`という固定フォーマットで書き出す仕様になっているためです。この「型情報が値と一緒に平文で埋め込まれる」という設計自体が、攻撃者が任意のクラス名を差し込める根本原因でもあります（JSONのような、型情報を持たないデータ形式に置き換えることが有効な防御になる理由もここにあります）。

### 7. 防御の原則とOWASPの位置づけの再確認

最後に、OWASPが示す防御指針を確認します。

> "Do not use unserialize() function with user-supplied input, use JSON functions instead."
> （ユーザー入力に対して`unserialize()`関数を使用しないこと。代わりにJSON関数を使用すること）

> 出典: OWASP Community — PHP Object Injection — https://community.owasp.org/vulnerabilities/PHP_Object_Injection

DeepWikiのページも同様に、緩和策として以下を挙げています。

- 信頼できない入力のデシリアライズを避ける
- クラスのアローリスト（allowlist、許可リスト）を実装する
- pickleやserializeよりも安全な代替（JSONなど）を使う
- 言語固有の保護機構（Javaの`ObjectInputFilter`など）を用いる

> 出典: DeepWiki — PayloadsAllTheThings: Insecure Deserialization — https://deepwiki.com/swisskyrepo/PayloadsAllTheThings/3.8-insecure-deserialization

これらの防御策がすべて「型情報を伴う任意のオブジェクト復元をさせない」という同一の原則に収束していることに注目してください。JSONへの置き換えは「型を固定データ構造（連想配列やスカラー値）に限定し、クラスのインスタンス化という危険な操作自体を発生させない」ことに相当し、アローリストは「ガジェットとして悪用され得るクラスの復元を最初から拒否する」ことに相当します。

OWASPがPHP Object Injectionを独立したページとして扱っている位置づけは、CWEでいう**CWE-502（Deserialization of Untrusted Data、信頼できないデータのデシリアライズ）**という一般的な脆弱性クラスの、PHP言語における具体的な発現形態という整理になります。つまり本節で見たPOPチェーンやガジェットの概念は、PHPに限らずJava・Python・Ruby・.NETなど、オブジェクトのライフサイクルに開発者フックを提供するあらゆる言語処理系に共通する構造的な問題です。この後の章で扱うSSTI（Server-Side Template Injection）からRCEへ至る経路も、実は「テンプレートエンジンが提供する評価可能な式」という別種の"フック"を悪用する点で、本質的な発想はここで学んだPOPチェーンと同じ——**「単体では無害に見える正規機能の連結によって、開発者が意図しない実行経路を組み立てる」**——という原理に基づいています。次節以降では、この原理を踏まえた上で、実際に各言語でどのようにガジェットチェーンが構築されるかを具体的に見ていきます。
