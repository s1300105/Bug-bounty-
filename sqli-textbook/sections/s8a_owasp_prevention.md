## OWASP防御チートシートとパラメータ化

これまでの章では、UNIONベース・エラーベース・ブラインド・OOBなど多様なSQLインジェクション（SQLi）の検出・悪用手法を扱ってきた。本節では視点を攻撃側から防御側へ移し、業界標準として広く参照される OWASP（Open Web Application Security Project）の Cheat Sheet Series が提示する防御策を、原典に忠実に、かつ「なぜそれが効くのか」という仕組みレベルまで掘り下げて解説する。防御を正しく理解することは、逆に「なぜその防御が破られるのか」を理解する土台にもなり、脆弱性診断・バグバウンティの現場で「この実装は本当に安全か」を判定する力に直結する。

### 8a.1 SQLインジェクションが起きる根本原因のおさらい

SQLiは、アプリケーションがユーザー入力を「データ」としてではなく「SQL文字列の一部（コード）」として組み立ててしまうことに起因する。データベースエンジンのSQLパーサは、渡された文字列をその場で字句解析・構文解析してから実行する。つまり、クエリ文字列とパラメータ値を単純な文字列結合（`"SELECT * FROM users WHERE name = '" + input + "'"`）で作ると、パーサはコードと値の区別を「文字列中のクォートや演算子の並び」でしか判断できない。攻撃者が `'` や `--` を混ぜ込めば、パーサから見て文の構造そのものが変わってしまう。

OWASPの防御策はすべて、この「コードとデータの混在」という根本原因をどう断ち切るかという一点に収斂する。

### 8a.2 OWASP SQL Injection Prevention Cheat Sheet の4大防御策

> 出典: SQL Injection Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

このチートシートは、SQLi防御を優先順位付きで4つに整理している。上から順に「推奨度が高い」防御であり、下に行くほど「やむを得ない場合の代替」「最終手段」という位置づけになる。

#### （1）Prepared Statements（パラメータ化クエリ）— 第一選択

**仕組み**: Prepared Statementでは、SQL文のテンプレート（プレースホルダ `?` や名前付きパラメータを含む）を先にデータベースへ送り、データベース側でそのテンプレートを構文解析・コンパイルして実行計画を確定させる。その後、実際のパラメータ値は別チャンネルでデータベースへ渡され、既に確定した構文木の「値スロット」に文字通り代入されるだけになる。つまりパラメータ値がどんな文字列（`' OR '1'='1` のような文字列）であっても、SQLパーサの構文解析フェーズを二度通過することはなく、コードとして再解釈される余地が原理的に存在しない。これが「Prepared Statementはコードとデータを完全に分離する」と言われる技術的根拠である。

原文はこう述べる:

> "Prepared statements are simple to write and easier to understand than dynamic queries, and parameterized queries force the developer to define all SQL code first and pass in each parameter to the query later."

Javaでの実装例（原典より）:

```java
String custname = request.getParameter("customerName");
String query = "SELECT account_balance FROM user_data WHERE user_name = ?";
PreparedStatement pstmt = connection.prepareStatement(query);
pstmt.setString(1, custname);
ResultSet results = pstmt.executeQuery();
```

ここで `custname` に `tom' or '1'='1` を入力しても、"parameterized query would look for a username that literally matches the entire string"（パラメータ化クエリは、その文字列全体と完全一致するユーザー名を探すだけになる）という結果になる。つまり `WHERE user_name = ?` の `?` に丸ごと1つの値として束縛されるため、`' or '1'='1` は「ユーザー名の一部」としてしか解釈されない。

C# / .NETの例:

```csharp
String query = "SELECT account_balance FROM user_data WHERE user_name = ?";
OleDbCommand command = new OleDbCommand(query, connection);
command.Parameters.Add(new OleDbParameter("customerName",
    CustomerName.Text));
OleDbDataReader reader = command.ExecuteReader();
```

Hibernate（HQL、ORMのクエリ言語）の例:

```java
// 安全版
Query safeHQLQuery = session.createQuery(
    "from Inventory where productID=:productid");
safeHQLQuery.setParameter("productid", userSuppliedParameter);
```

ORMを使っていても、内部で文字列連結によってHQL/JPQLを組み立てれば同様にインジェクションが成立する（本教科書の別章で扱うORMインジェクションを参照）。ORMだから安全、ではなく「パラメータバインドAPIを使っているか」が本質である点に注意したい。

#### （2）Stored Procedures（ストアドプロシージャ）— 条件付きで同等の効果

**仕組みと注意点**: ストアドプロシージャそのものがSQLiを防ぐわけではない。原文は明確にこう釘を刺す:

> "The safest approach to using them requires the developer to build SQL statements with parameters that are automatically parameterized, unless the developer does something largely out of the norm."

つまり、ストアドプロシージャの引数として渡された値が、プロシージャ内部で「さらに文字列結合されて動的SQLとして`EXEC`/`sp_executesql`される」ような実装（＝安全でない動的SQL生成）であれば、ストアドプロシージャの中であってもSQLiは成立する。逆に、ストアドプロシージャの引数が自動的にパラメータ化された形でクエリに束縛される限り、Prepared Statementと同等の保護が得られる。

Java（CallableStatement）の例:

```java
String custname = request.getParameter("customerName");
CallableStatement cs = connection.prepareCall(
    "{call sp_getAccountBalance(?)}");
cs.setString(1, custname);
ResultSet results = cs.executeQuery();
```

VB.NETの例:

```vb
Dim command As SqlCommand = new SqlCommand(
    "sp_getAccountBalance", connection)
command.CommandType = CommandType.StoredProcedure
command.Parameters.Add(new SqlParameter("@CustomerName",
    CustomerName.Text))
Dim reader As SqlDataReader = command.ExecuteReader()
```

**権限面の副次的リスク**: MS SQL Serverでは "stored procedures require execute rights, a role not available by default"（実行権限はデフォルトでは付与されない役割）であるため、権限設計が甘いと運用上「とりあえず`db_owner`で実行させる」といった過剰権限付与に流れがちである。これは後述の最小権限原則と表裏一体の問題で、ストアドプロシージャ自体は安全でも、それを呼び出すDBアカウントの権限が過大であれば、万一他の経路で侵害された際の被害が拡大する。

#### （3）Allow-list Input Validation（許可リスト方式の入力検証）— バインド変数が使えない箇所専用

**なぜ必要か**: Prepared Statementのプレースホルダは「値」しか束縛できない。テーブル名・カラム名・`ORDER BY`のソート方向（`ASC`/`DESC`）といった、SQL文の「構造」を構成する識別子はプレースホルダに渡せない（渡してもリテラル文字列として扱われ、`SELECT * FROM ?` のような使い方はできない）。こうした識別子が動的にならざるを得ない設計では、許可リスト（ホワイトリスト）方式で検証する。

原文はこう述べる:

> "When table or column names are needed, ideally those values come from the code and not from user parameters."

テーブル名を安全に選ぶ実装例（ユーザー入力を直接使わず、コード側の固定値にマッピングする）:

```java
String tableName;
switch(PARAM):
  case "Value1": tableName = "fooTable"; break;
  case "Value2": tableName = "barTable"; break;
  default: throw new InputValidationException(
      "unexpected value provided for table name");
```

これは「ユーザー入力をそのまま検証して通す」のではなく、「ユーザー入力は選択肢を選ぶためのキーとしてのみ使い、実際にSQLへ渡す値はコード内で定義した固定文字列」という点が重要である。入力値そのものを正規表現などで検査するアプローチよりも堅牢で、原文も "generic table validation functions can lead to data loss if table names are used in queries where they are not expected."（汎用的なテーブル名検証関数は、想定外の文脈でテーブル名が使われた場合にデータ損失を招きうる）と警告している。

ソート順（真偽値でASC/DESCを切り替える）の安全な例:

```java
public String someMethod(boolean sortOrder) {
  String SQLquery = "some SQL ... order by Salary " +
      (sortOrder ? "ASC" : "DESC");
```

ここでのポイントは、ユーザーから受け取った生の文字列（`"ASC"` や `"desc; DROP TABLE..."`）をそのまま連結するのではなく、一度 `boolean` という「SQL文字列を構成しえない型」に変換してから、コード側が用意した固定文字列（`"ASC"` / `"DESC"`）を選択している点である。日付・数値・列挙型など、非String型へ変換してから使うという発想は、テーブル名以外の識別子や制御構文にも応用できる。

原文はこの防御層についても限界を明記している:

> "Using user parameter values to target table or column names is a symptom of poor design and a full rewrite should be considered"

つまり、そもそもユーザー入力でテーブル名やカラム名を切り替えるような設計自体が、多くの場合「設計のまずさの兆候」であり、根本的な設計見直しが望ましいという立場である。

#### （4）Escaping（エスケープ処理）— 最終手段・非推奨

原文はこの手法を明確に格下に位置づける:

> "STRONGLY DISCOURAGED"

> "This methodology is fragile compared to other defenses, and we CANNOT guarantee that this option will prevent all SQL injections in all situations."

エスケープ処理（クォートやバックスラッシュなどの特殊文字をエスケープシーケンスに置換する）は、DBMSごとにエスケープ規則（"very database specific in its implementation"）が異なり、文字エンコーディング（マルチバイト文字、代替エンコーディングなど）の扱いを誤ると容易にバイパスされる。たとえば、あるDBMS用のエスケープ関数を別のDBMSや別の文字コンテキストで使い回すと、想定していないバイト列がクォートの終端として解釈され、エスケープが無力化されるケースがある。したがって、Prepared StatementやAllow-list検証が使えない特殊な状況でのみ、最後の手段として検討すべきとされる。

#### 防御の優先順位まとめ

1. 第一選択: Prepared Statements（パラメータ化クエリ）
2. 代替案: 安全に実装されたStored Procedures（動的SQL生成を含まないもの）
3. バインド変数が使えない識別子のみ: Allow-list検証
4. 最後の手段（非推奨）: Escaping

そして、いずれの防御を選んでも、原文は次を強調する:

> "Input validation is also recommended as a secondary defense in ALL cases"（すべてのケースにおいて、入力検証を二次防御として併用することが推奨される）

これは「入力検証さえすればSQLiを防げる」という誤解への釘刺しでもある。原文は "Validated data is not necessarily safe to insert into SQL queries via string building."（検証済みのデータであっても、文字列結合でSQLクエリに挿入するのが安全とは限らない）とも述べており、入力検証は防御の主役ではなく、あくまでPrepared Statement等と組み合わせる多層防御の一部という位置づけである。

### 8a.3 最小権限の原則（Least Privilege）

パラメータ化はSQLi「そのもの」の成立を防ぐ防御だが、万一何らかの理由で注入が成立してしまった場合の被害範囲を限定するのが、DBアカウントの権限設計である。原文の主張は次の通り。

> "Start from the ground up to determine what access rights your application accounts require, rather than trying to figure out what access rights you need to take away."

これは「まず全権限を与えてから不要な権限を剥がす」のではなく、「必要最小限の権限だけをゼロから積み上げる」という設計思想の転換を求めるものである。具体的な指針は以下の通り。

- **DBA/管理者権限をアプリケーションアカウントに付与しない**: 原文は "DO NOT ASSIGN DBA OR ADMIN TYPE ACCESS TO YOUR APPLICATION ACCOUNTS" と大文字で強調している。
- **読み取り専用の用途には読み取り権限のみ**を付与する。
- **DBMSプロセスを実行するOSアカウント自体も最小権限**で動作させる。
- **ビュー（View）を介した権限制限**: たとえばパスワードをハッシュ化して保存しているテーブルに対し、生のパスワードカラムへの直接アクセスを与えず、ハッシュ値だけを返すビューを作成してアプリケーションにはそのビューへのアクセス権のみを与える、という設計が例示されている。
- **アプリケーションごと・機能ごとにDBアカウントを分離する**: 原文は "Different DB users should be used for different web applications" と述べ、たとえばログイン機能と会員登録機能では必要なDB権限が異なるため、それぞれ異なるDBユーザーを使うべきだとしている。これにより、片方の機能に脆弱性があっても、他方の機能が扱うデータへの影響を限定できる。

最小権限は「SQLiを起こさない」ための防御ではなく、「SQLiが起きても被害を封じ込める」ための多層防御の一環であることを理解しておく必要がある。パラメータ化と最小権限は互いに代替関係ではなく、併用すべき別レイヤーの防御である。

### 8a.4 OWASP Injection Prevention Cheat Sheet — より広い文脈

> 出典: Injection Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html

このチートシートは、SQLiを「インジェクション脆弱性」という大きなクラスの一事例として位置づけ、共通する3つの基本ルールを提示する。

- **Rule #1（入力検証）**: "Perform proper input validation. Positive or allowlist input validation with appropriate canonicalization is also recommended, but is not a complete defense"。ここでも「入力検証は推奨されるが、それ単独では完全な防御にならない」という位置づけが繰り返されている。canonicalization（正規化）とは、入力を検証する前にエンコーディングの揺れ（URLエンコード、Unicode正規化形式の違いなど）を統一する処理であり、これを怠ると検証をすり抜ける文字列表現が存在しうる。
- **Rule #2（安全なAPIの使用）**: "The preferred option is to use a safe API which avoids the use of the interpreter entirely or provides a parameterized interface"。SQLiにおけるPrepared Statementは、まさにこの「パラメータ化されたインターフェースを提供する安全なAPI」の具体例である。
- **Rule #3（コンテキストに応じたエスケープ）**: "Contextually escape user data"。解釈系（インタプリタ）ごとの構文規則に従って特殊文字をエスケープする方法で、SQL Prevention Cheat Sheetにおける「Escaping」と同じく最終手段的な位置づけにある。

インジェクションの種類ごとの防御の要点は次の通り整理されている。

| インジェクションの種類 | 主な防御 | 補足検査手法 |
|---|---|---|
| SQL Injection | Prepared Statement／安全なストアドプロシージャ／Allow-list検証／（最終手段の）エスケープ | コードレビュー、SQLMap等の自動化ツール、静的解析 |
| LDAP Injection | RFC 4514/4515準拠のエンコーディング関数の使用 | コードレビュー、ZAP等のスキャナー |
| XPath Injection | （原文では詳細未記述） | — |
| OS Command Injection | 可能な限りパラメータ化、次いで入力検証（コマンド名はホワイトリスト、引数は正規表現、例: `^[a-z0-9]{3,10}$`） | — |
| スクリプト言語のeval()等 | 未検証入力を`eval()`等の動的実行APIに渡さない。Null Byte Injectionのリスク認識 | — |
| SMTP/IMAP/FTP等のプロトコルコマンド | セッション内でのコマンド注入対策 | — |

この一覧から読み取れる重要な教訓は、「パラメータ化（コードとデータの分離）」という発想がSQLiに限らず、OSコマンドインジェクション、LDAPインジェクションなど、あらゆる「文字列組み立てによってインタプリタへ命令を渡す」脆弱性クラスに共通する第一原理だという点である。SQLiの防御を学ぶことは、他のインジェクション系脆弱性の防御を理解する土台にもなる。

同チートシートは、より詳細な防御を扱う専門チートシートへの入り口として、SQL Injection Prevention Cheat Sheet、OS Command Injection Defense Cheat Sheet、LDAP Injection Prevention Cheat Sheet、Injection Prevention in Java Cheat Sheetへリンクしており、本節で扱うSQL Injection Prevention Cheat Sheetはその中でも中核をなす専門チートシートという位置づけになる。

### 8a.5 Bobby Tables — 言語別Prepared Statement実例集

> 出典: Bobby Tables: A guide to preventing SQL injection — https://bobby-tables.com/

このサイトは、著名なxkcd漫画「Exploits of a Mom」（生徒名を `Robert'); DROP TABLE Students;--` にした息子の逸話。学校の記録がSQLiで消し飛び、母親が "And I hope you've learned to sanitize your database inputs"＝「そして、データベースへの入力はちゃんとサニタイズするものだと学んでくれたと思うわ」と告げる、という風刺）を出発点として、OWASPが「Prepared Statementを使え」と原則を説くのに対し、「では実際に各言語・各DBドライバでどう書けばよいか」を具体的なコード片で示すことに特化したサイトである。ADO.NET、ASP、C#、ColdFusion、Delphi、Elixir、Entity Framework、Go、Java、MS Access、Perl、PHP、PL/SQL、PostgreSQL、Python、R、Ruby、Scheme、VB.NETという幅広い言語・フレームワークごとに個別ページを持つ構成になっている。

トップページ自体には各言語のコード例は掲載されておらず、リンクをたどった言語別ページに実例がある。代表的な2つを見てみよう。

**PHP（PDO・長い書き方）**:

```php
$dbh = new PDO('mysql:dbname=testdb;host=127.0.0.1', $user, $password);
$stmt = $dbh->prepare('INSERT INTO REGISTRY (name, value) VALUES (:name, :value)');
$stmt->bindParam(':name', $name);
$stmt->bindParam(':value', $value);
$stmt->execute();
```

**PHP（PDO・短い書き方、配列を直接`execute()`に渡す）**:

```php
$stmt = $dbh->prepare('UPDATE people SET name = :new_name WHERE id = :id');
$stmt->execute(['new_name' => $name, 'id' => $id]);
```

**PHP（mysqli拡張）**:

```php
$stmt = $db->prepare('update people set name = ? where id = ?');
$stmt->bind_param('si',$name,$id);
$stmt->execute();
```

ここで使われている `:name` や `?` は、いずれも「プレースホルダ」であり、`prepare()` の時点でSQLパーサがすでにクエリ構造（`INSERT INTO REGISTRY (name, value) VALUES (?, ?)` のような骨格）を確定させる。その後の `bindParam()` / `execute()` は、確定済みの構造に値を差し込むだけの操作であり、値の中にどんな文字が含まれていてもクエリ構造自体は変化しない。これはOWASPチートシートが述べる「クエリのロジックとユーザー入力の分離」を言語レベルで具体化したものである。

**Python（DB-API準拠ドライバ、例: psycopg2やMySQLdb）**:

```python
cmd = "update people set name=%s where id=%s"
curs.execute(cmd, (name, id))
```

```python
cmd = "SELECT * FROM PEOPLE WHERE name = %s"
curs.execute(cmd, (name,))
```

ここで注意すべき重要な落とし穴として、Pythonの `%s` はPython組み込みの文字列フォーマット演算子（`%`）とプレースホルダ構文が見た目上同じ記号を使う点である。つまり、次のように書いてしまうと一見似ているが実際には完全にSQLiに脆弱なコードになる。

```python
# 危険な例（Pythonの文字列フォーマットでSQLを組み立ててしまっている）
cmd = "SELECT * FROM PEOPLE WHERE name = '%s'" % name
curs.execute(cmd)
```

この場合、`%` 演算子はPythonインタプリタの実行時にクエリ文字列がデータベースへ送られる**前**に文字列を完成させてしまうため、`curs.execute()` に渡された時点では既に単なる1本のSQL文字列になっており、データベース側にはパラメータとコードの区別を判断する材料が残っていない。対して安全な例では、`cmd`（プレースホルダ `%s` を含む未完成のテンプレート）と `(name, id)`（値のタプル）を別々の引数として `execute()` に渡しており、パラメータ化はデータベースドライバ側（あるいはデータベース自体）が担当する。この「同じ `%s` という記号でも、Pythonの文字列演算子として評価されるか、DBドライバのプレースホルダとして評価されるかで安全性が正反対になる」という点は、実務でも非常に見落とされやすい罠であり、Bobby Tablesがこの対比を強調している理由でもある。

また、Bobby Tablesはプレースホルダの構文がDBMS・ドライバによって異なる点にも触れている。MySQLやPostgreSQL系のドライバでは `%s` が使われる一方、SQLiteの標準ドライバ（`sqlite3`モジュール）では `?` が使われるなど、同じ「パラメータ化」という概念でも記法はデータベースAPI仕様に依存する。これは、開発者が使用しているDB接続ライブラリのドキュメントを必ず確認し、思い込みで記法を混用しないことの重要性を示している。

### 8a.6 実務上のチェックリスト

本節で見た3資料の内容を、脆弱性診断・コードレビューの現場で使えるチェックリストとして整理する。

1. **クエリ構築箇所をすべて洗い出し、文字列結合（`+`, `.`, f-string, `%`演算子など）でSQL文が組み立てられていないか確認する**。1箇所でも動的連結があれば、その箇所は潜在的なSQLiポイントである。
2. **Prepared Statement / パラメータ化APIが使われているか確認する**。ORMを使っていても、生SQLやHQL/JPQLを文字列連結で構築している箇所がないか個別に確認する。
3. **ストアドプロシージャ内部で動的SQL（`EXEC`, `sp_executesql`等）を使っていないか確認する**。ストアドプロシージャという形式そのものは安全性を保証しない。
4. **テーブル名・カラム名・ソート順など、バインド変数が使えない箇所がAllow-list方式（コード側の固定値へのマッピング）になっているか確認する**。ユーザー入力の正規表現検証だけで済ませていないか注意する。
5. **エスケープ処理のみに依存している箇所がないか確認する**。あれば、Prepared Statementへの置き換えを最優先の改善提案とする。
6. **アプリケーションが使用するDBアカウントの権限が必要最小限か確認する**。DBA/管理者権限の付与、機能間でのアカウント共有がないかを点検する。
7. **入力検証（Allow-list、正規化）がPrepared Statementの代替ではなく補助として実装されているか確認する**。「入力検証をしているからエスケープや連結でも安全」という誤った設計判断がないか注意する。

これらはいずれも、原理としては「コードとデータを混在させない」「万一混在しても被害範囲を権限で限定する」という2つの柱に還元される。次節以降では、この防御原則がWAF（Web Application Firewall）やアプリケーション設計レベルの多層防御とどう組み合わさるかを扱う。
