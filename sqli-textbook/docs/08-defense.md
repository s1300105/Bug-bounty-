# 第8章 防御・検出・修正

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

## 日本語の防御・セキュアコーディング

### この節で扱うこと

これまでの章では、SQLインジェクション（SQLi）がどのように発見され、どのように悪用されるかを見てきた。この節では視点を攻撃側から防御側に切り替え、「なぜプレースホルダを使えばSQLiが防げるのか」を**仕組みのレベル**で理解し、さらに「プレースホルダを使っているのに、なぜSQLiが混入するのか」という、実務でよく見落とされる落とし穴まで踏み込む。

軸になる資料は2つある。

1. IPA（独立行政法人情報処理推進機構）が公開する「安全なウェブサイトの作り方」および別冊「安全なSQLの呼び出し方」。日本の官公庁・企業の開発現場で事実上の標準リファレンスとして扱われているドキュメントである。
2. 徳丸浩氏の著書『体系的に学ぶ 安全なWebアプリケーションの作り方 第2版』の考え方に沿って桑田誠氏がPHP Conference 2015で発表したスライド「SQLインジェクション対策の真実」。ここでは「プレースホルダを使っていてもSQLiは起こり得る」という、初中級者向けの説明ではあまり語られない論点が扱われている。

読者にはすでに「プレースホルダを使いましょう」という結論そのものは既知だろう。この節のゴールは、その結論の**なぜ**を説明できるようになること、そして「プレースホルダを使っているから安全」という誤った安心感を崩すことにある。

---

### 1. 根本的解決策としてのプレースホルダ

> 出典: 安全なウェブサイトの作り方 — 1.1 SQLインジェクション — https://www.ipa.go.jp/security/vuln/websecurity/about.html （同ページから遷移する https://www.ipa.go.jp/security/vuln/websecurity/sql.html を含む）

IPAの分類では、脆弱性対策は「根本的解決策」と「保険的対策（＝影響を軽減するだけで脆弱性そのものはなくならない対策）」に分けられる。SQLiにおける根本的解決策として最初に挙げられているのが、**プレースホルダを用いたSQL文の組み立て**である。

> 「SQL文の雛形の中に変数の場所を示す記号（プレースホルダ）を置いて、後に、そこに実際の値を機械的な処理で割り当てる」

これだけだと「値を後から入れるだけ」に聞こえるが、SQLiが防げる理由は**構文解析（パース）と値の代入が、時間的にも処理系としても分離される**という点にある。通常の文字列連結によるSQL構築では、SQL文字列は次のように「一括して」組み立てられ、その1本の文字列をまとめてSQLパーサに渡す。

```sql
-- 文字列連結（危険）
"SELECT * FROM users WHERE name = '" + userInput + "'"
```

パーサから見ると、この文字列は「構文」と「データ」の区別がない、ただの1本のテキストである。`userInput` に `' OR '1'='1` のような文字列が入っていれば、パーサはそれをSQL構文の一部として字句解析してしまう。攻撃者が **構文を注入（inject）できてしまう**のはこのためである。

これに対しプレースホルダを使う実装は、次の2段階に処理を分離する。

```sql
-- 静的プレースホルダの例（JDBC PreparedStatement）
PreparedStatement stmt = con.prepareStatement(
    "SELECT * FROM users WHERE name = ?"
);
stmt.setString(1, userInput);
```

IPAの資料は、プレースホルダへの値の割り当て処理を「バインド」と呼び、バインドの方式を2種類に整理している。

- **静的プレースホルダ**: プレースホルダを含んだままSQL文を先にデータベースエンジン側へ送ってコンパイル（構文解析・実行計画の生成）させておき、後から値だけを別チャネルでデータベースエンジンに渡して割り当てる方式。
- **動的プレースホルダ**: アプリケーション側（DB接続ライブラリ内部）で値をエスケープ処理したうえでSQL文字列のプレースホルダ位置にはめ込み、その時点で完成した1本のSQL文をデータベースエンジンに送る方式。

この2つの違いが「なぜ安全か」の核心である。

**静的プレースホルダ**は、構文解析が完了した時点（=どこが値の挿入位置かをデータベースエンジンが構文木として確定させた時点）より**後**に値を渡す。つまりデータベースエンジンにとって、後から届く値は最初から「この位置に入るリテラル値」としてしか解釈されず、値の中にどんな文字列が入っていようと、それが新しい構文（`OR`、`;`、コメント記号など）として再解釈されることは原理的に起こらない。これはJDBCの`PreparedStatement`、PDOのプリペアドステートメント、多くのORMのパラメータバインドが内部的に利用しているプロトコルレベルの仕組み（例: MySQLのバイナリプロトコルにおけるプリペアドステートメント）に対応する。

一方**動的プレースホルダ**は、値を「エスケープしてから文字列としてはめ込む」方式であるため、構文とデータの分離はアプリケーション（ドライバ）側の実装の正しさに依存する。エスケープ処理そのものにバグがあったり、エスケープすべき文字の網羅漏れがあったりすると、静的プレースホルダほどの確実性は担保されない。IPAの資料が静的プレースホルダをより安全とする、または少なくとも区別して説明しているのはこのためである。実務では「ドライバが対応していれば静的プレースホルダ（サーバサイドプリペアドステートメント）を使う」ことが望ましく、例えばPHPのPDOはデフォルトで動的プレースホルダ（クライアントサイドのエミュレーション）を使う設定になっているドライバ・バージョンがあるため、`PDO::ATTR_EMULATE_PREPARES` を`false`に設定してサーバサイドの静的プレースホルダを強制する、といった設定確認が必要になる場面がある。

### 2. やむを得ず文字列連結を使う場合のエスケープ処理

> 出典: 安全なウェブサイトの作り方 — 1.1 SQLインジェクション — https://www.ipa.go.jp/security/vuln/websecurity/sql.html

プレースホルダが使えない状況（動的にカラム名・テーブル名・ソートキーを組み立てる必要がある場合など）では、IPAは次のように述べている。

> 「文字列型として埋め込む場合は、値をシングルクォートで囲んで記述しますが、その際に文字列リテラル内で特別な意味を持つ記号文字をエスケープ処理」する必要がある。

ここで強調すべきは、**プレースホルダが使えない場面ですら、生の文字列連結ではなく「データベースエンジンが提供するエスケープ用API」を使うべき**という点である。自前で `str_replace("'", "''", $input)` のような素朴な置換を書くのは推奨されない。理由は、DBMSごとにエスケープすべき特殊文字・エンコーディング（マルチバイト文字の扱い）・クォートのルールが微妙に異なり、自前実装は抜け漏れの温床になりやすいためである。たとえば古典的な脆弱性として知られるのが「マルチバイト文字コード（GBKなど）でシングルクォートのエスケープ処理用のバックスラッシュがマルチバイト文字の一部として解釈されてしまい、エスケープが無効化される」というクラスの不具合であり、これはアプリケーション層の文字コード設定とDBドライバのエスケープ関数の文字コード認識がずれていると発生する。したがって「DBエンジンのAPIを用いて正しくリテラルを構成する」ことが重要になる。

### 3. 保険的対策（根本的解決ではないが影響を軽減する）

> 出典: 安全なウェブサイトの作り方 — 1.1 SQLインジェクション — https://www.ipa.go.jp/security/vuln/websecurity/sql.html

IPAは根本的解決策とは別に、次の2点を保険的対策として挙げている。保険的対策は「脆弱性そのものを解消する対策ではなく、攻撃が成功した場合の被害を小さくする対策」という位置づけである点に注意したい。プレースホルダ導入の代わりにはならない。

- **エラーメッセージをそのままブラウザに表示しない**。データベースのエラーメッセージには、テーブル名・カラム名・SQL文の一部・DBMSの種類やバージョンなど、攻撃者にとって有用な情報（error-based SQLiの足がかり）が含まれることが多い。詳細エラーは内部ログにのみ記録し、利用者には汎用的なエラーページを返すべきである。
- **データベースアカウントの権限を必要最小限にする**。「ウェブアプリケーションからデータベースに渡す命令文の実行に必要な最小限の権限をデータベースアカウントに与えてください」とされている。これは、万一SQLiが成立してしまった場合でも、そのDBアカウントが`DROP TABLE`や他スキーマへのアクセス、ファイルシステムへのアクセス（MySQLの`LOAD_FILE`/`INTO OUTFILE`やMSSQLの`xp_cmdshell`など）を実行できなければ被害範囲を限定できる、という「多層防御（defense in depth）」の考え方に基づく。Webアプリケーション用のDBアカウントには、業務上必要なSELECT/INSERT/UPDATE/DELETEのみを付与し、DDL権限やスーパーユーザー権限は分離した管理用アカウントに留める設計が推奨される。

> ⚠️ **未取得の資料の補足について**: IPAの別冊「安全なSQLの呼び出し方」（PDF、全40ページ）は、Java×Oracle、PHP×PostgreSQL、Perl×MySQL、Java×MySQL、ASP.NET×SQL Serverの5組み合わせについて、実際の安全なコード例を第5章で提示している。このPDF本文の直接取得は本節の自動取得プロセスでは成功しませんでした（PDFバイナリの直接抽出がブロックされたため）。具体的な各言語別のコード例をそのまま参照したい場合は、次のURLから直接ダウンロードしてご覧ください: https://www.ipa.go.jp/security/vuln/websecurity/about.html （ページ内の「安全なSQLの呼び出し方」PDFリンクから入手可能）。（以下は未取得資料の補足として一般知識に基づく解説です）5言語共通で強調されるのは、いずれの言語・DBMSの組み合わせでも「標準のプリペアドステートメントAPI（JDBCの`PreparedStatement`、PDOの`prepare`/`bindValue`、Perl DBIの`prepare`/`execute`、ADO.NETの`SqlCommand.Parameters`など）を一貫して使う」という結論に集約される点であり、DBMSやフレームワークが変わっても「値をプレースホルダ経由で渡す」という原則自体は変わらない。

### 4. 「プレースホルダを使っているのにSQLiが起きる」問題

> 出典: SQLインジェクション対策の真実（桑田誠、PHP Conference 2015） — https://www.slideshare.net/kwatch/sql-53624630

ここからが徳丸原則に沿ったスライドの核心であり、初中級者向け教材では省かれがちな論点である。スライドは、実際に発生したクレジットカード情報漏洩事件（賠償額 約2,262万円の判例、IPAの推計ではSQLi被害額は概ね4,800万円〜1億円程度とされる）を引用しつつ、「プレースホルダを使っていればSQLiは起きない」という通説に対して次のように反論する。

> 「実情は、プレースホルダつきの安全なSQLを組み立てている最中にSQL Injectionが入り込んでいる」

これはどういうことか。実務のコードでは、プレースホルダ自体は正しく使われていても、**SQL文の「雛形」を組み立てる段階**で文字列連結が行われることがある。典型例は、検索条件やソート順を動的に切り替える処理である。

```php
// 一見プレースホルダを使っているが危険な例
$sql = "SELECT * FROM items WHERE 1=1";
if ($category) {
    $sql .= " AND category = ?"; // ここはプレースホルダなので安全
}
if ($sortKey) {
    $sql .= " ORDER BY " . $sortKey; // ★ここが文字列連結
}
$stmt = $pdo->prepare($sql);
$stmt->execute($params);
```

`category`の値はプレースホルダ経由で渡っているため一見安全に見えるが、`ORDER BY`句のカラム名（`$sortKey`）はプレースホルダの対象にできない（プレースホルダは「値（リテラル）」の位置にしか置けず、識別子であるカラム名・テーブル名の位置には使えないというSQL構文上の制約がある）ため、開発者はやむなく文字列連結でカラム名を組み立ててしまう。ここにSQLiが混入する。スライドはこの構造を捉えて「プレースホルダ付きの安全なSQLを組み立てている**最中**に注入が入り込む」と表現しており、根本原因を次のように整理している。

> 「SQL Injection が発生する本当の原因は、ライブラリやAPIのインターフェースに欠陥があるからである」

つまり、多くのDBアクセスAPIは「文字列連結でSQLの雛形を作り、値だけプレースホルダにする」という**半端な安全設計**しか提供していない。カラム名・テーブル名・`ORDER BY`の向き（ASC/DESC）・`IN`句の要素数といった「値ではなく構文の一部」を動的に決めたいというニーズに対して、標準のプリペアドステートメントAPIは答えを持っていないため、開発者は結局そこだけ文字列連結に頼らざるを得ず、結果として抜け穴になる。

### 5. 安全な動的SQL構築のための設計アプローチ

> 出典: SQLインジェクション対策の真実（桑田誠、PHP Conference 2015） — https://www.slideshare.net/kwatch/sql-53624630

スライドはこの問題への対処として、2つの設計アプローチを紹介している。

**(1) SQLテンプレート方式（例: SQLTempl8）**

テンプレートエンジンによってSQL生成そのものを制御し、「開発者が文字列連結を書けない文法」を強制する方式である。テンプレート内では`--#if`や`--#end`のような専用の条件分岐記法で条件付きSQLを表現し、内部実装としては文字列連結を使っていても、開発者が触れるインターフェースからは生の文字列連結を行う手段が取り除かれている。さらに、SQL文を指定する際にAPIへ渡すのは生のSQL文字列ではなく「SQL IDとしてのテンプレートファイル名」であるため、そもそも呼び出し側が任意のSQL構文を組み立てて渡すこと自体ができない設計になっている。

**(2) SQL構文木方式（Query Builder / O/Rマッパー）**

SQLを最初から「文字列」ではなく「構文木（AST: Abstract Syntax Tree、構文の構造を木構造で表現したデータ）」として組み立て、最後にまとめて文字列化する方式である。

```php
// Query Builderパターンの例（擬似コード）
$q->select('*')->from('books')->where('id', '=', 123);

// O/Rマッパーパターン（演算子オーバーロードによる自然な記述）
```

この方式がなぜ安全かというと、`where('id', '=', $userInput)`のように渡された値は、木構造の「値ノード」としてデータのまま保持され、最終的な文字列化の段階で必ずプレースホルダ（またはDBエンジンAPIによる正しいエスケープ）を経由してSQL文に変換される。攻撃者が悪意ある文字列を値として渡しても、木構造そのもの（`WHERE`句の構造や比較演算子の並び）は変化しないため、スライドの言葉を借りれば「悪意ある値を受けとっても、木構造は影響を受けない」。これは前節の静的プレースホルダの考え方（構文確定と値代入の分離）を、より高レベルなAPI設計として一般化したものと理解できる。

ただし、この方式にも実装上の未解決課題がスライド内で指摘されている。

- **NULL値との比較**: SQLの`=`演算子は`NULL`との比較で常に`NULL`（真でも偽でもない）を返すという仕様があるため、`WHERE col = NULL`という機械的な変換は意図通りに動かない。MySQLでは`<=>`（NULL安全な比較演算子）、PostgreSQLでは`IS NOT DISTINCT FROM`のような専用構文が必要で、Query Builder側がこれを自動的に使い分ける実装になっていないと、正しさとNULL安全性を両立できない。
- **カラム名・テーブル名など識別子の動的指定**: 値ではなく識別子（=先述の`ORDER BY`のカラム名のような構文要素）を動的に扱いたい場合、スライドでは`[=:sortkey=]`のような制限付きの埋め込み記法を提案している。この記法では埋め込める文字種を英数字・アンダースコア・ドットのみに限定することで、少なくとも構文注入に使われる記号（クォート、セミコロン、コメント記号、空白を利用した追加句など）を排除している。これは「識別子はプレースホルダ化できない」という制約に対する現実的な折衷案であり、**ホワイトリスト方式**（許可された文字種・許可されたカラム名の集合のみを通す）の一種と位置づけられる。
- **`IN (...)`句の動的な要素数への対応、バルクINSERTでのforeach処理、PDOでの厳密なデータ型指定**といった点は、スライドの時点（2015年）でも未解決の課題として挙げられている。実務では、`IN`句の要素数に応じてプレースホルダの個数を動的に生成する（`IN (?, ?, ?)`のように要素数ぶん`?`を並べる）実装で対応するのが一般的である。

### 6. まとめ: 教科書的原則から現場での実践へ

本節で見た2つの資料を統合すると、SQLi対策の実践は次のように段階付けて整理できる。

1. **第一選択**: すべてのSQL文をプレースホルダ（可能であれば静的プレースホルダ＝サーバサイドプリペアドステートメント）で組み立てる。これがIPAの言う根本的解決策であり、構文とデータの分離をデータベースエンジンのレベルで保証する。
2. **識別子（カラム名・テーブル名・ソート順など）を動的に扱う必要がある場合**、それはプレースホルダの対象外になるという**SQL構文上の構造的な限界**を正しく認識したうえで、生の文字列連結を避け、許可リスト（ホワイトリスト）方式で厳密に値を検証してから組み込む、またはQuery Builder/ORMのAPIが提供する識別子用のエスケープ機構（バッククォートや二重引用符での識別子クォーティングなど、DBMSごとの識別子エスケープ規則に従うAPI）を利用する。
3. **やむを得ず文字列連結を使う場面**でも、自前のエスケープ処理ではなく、DBドライバ・DBエンジンが提供する正規のエスケープAPIを利用する。
4. これらの根本的解決策を実装してもなお、**保険的対策**（エラーメッセージの非表示、DBアカウントの権限最小化）を併用し、万一の実装ミスや未知の抜け穴に備えた多層防御を構成する。
5. 最後に、「プレースホルダを使っているから安全」という単純化された理解ではなく、「SQL文の雛形を組み立てる全過程のうち、どこか一箇所でも生の文字列連結が紛れ込んでいないか」という**API設計・コードレビューの観点**を持つことが、実務のセキュアコーディングでは不可欠である。桑田氏のスライドが指摘する通り、この種の脆弱性の根本原因は開発者の不注意だけでなく、しばしば「値と構文を厳密に分離しきれないAPI・ライブラリの設計そのもの」にある。ツール選定・ライブラリ選定の段階で、識別子の動的指定やIN句の可変長対応まで安全に扱えるAPIかどうかを確認することも、セキュアコーディングの一部である。

---

[← 第7章 ツール習熟（sqlmap・Ghauri・手動vs自動）](07-tooling.md) ｜ [📖 目次](index.md) ｜ [第9章 練習環境・継続学習 →](09-practice.md)
