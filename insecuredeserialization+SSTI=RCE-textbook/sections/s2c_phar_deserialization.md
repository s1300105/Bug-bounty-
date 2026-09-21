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
