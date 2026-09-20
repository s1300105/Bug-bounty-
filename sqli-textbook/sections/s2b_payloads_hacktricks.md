## ペイロード集とHackTricksリファレンス

前節までで UNION 攻撃・エラーベース攻撃の原理（クエリ構造をどう壊し、どう再構成するか）を学んだ。本節ではその実践面を補強する。第一の資料 **PayloadsAllTheThings（PATT）** の SQL Injection README は「注入点をどう見つけ、どう突破口にするか」という攻める側の手順書として、第二の資料 **HackTricks** の SQL Injection ページは「UNION を確実に組み立てるための機械的な手順（カラム数特定 → 型確認 → データ抽出）」の定番リファレンスとして、それぞれ実務でもっとも頻繁に開き直されるチートシートである。両者は内容が重なる部分もあるが、PATT は「検出・突破」寄り、HackTricks は「UNION の組み立て手順」寄りに強みがあるため、相互補完的に使う。

### 1. 注入点の検出：3つの観測軸（PayloadsAllTheThings）

PATT はパラメータが SQL 文脈に直接連結されているかどうかを確認する手法を、大きく「エラー」「トートロジー（恒真命題）」「タイミング」の3つの軸で整理している。

#### 1.1 エラーメッセージによる検出

もっとも基本的な手法は、パラメータへ構文を壊す特殊文字を1つ挿入し、アプリケーションがエラーを返すかを観察することである。

```
'
"
;
)
*
```

これらは URL エンコード形式（`%27`, `%22`, `%3B`, `%29`, `%2A`）でも試す価値がある。なぜこれで検出できるのか。多くの脆弱なアプリケーションは、ユーザー入力を文字列としてそのまま SQL 文に連結している（プリペアドステートメントを使わず動的にクエリ文字列を組み立てている）。そこへクォート文字を1つだけ挿入すると、SQL パーサから見て文字列リテラルの開始と終了の対応が崩れ、構文エラーが発生する。このエラーがレスポンスに露出する、あるいはステータスコードや応答内容の変化として観測できれば、そのパラメータが SQL 文脈へ直接連結されている強い証拠になる。

#### 1.2 トートロジー（恒真命題）による検出

```sql
page.asp?id=1 or 1=1 -- true
page.asp?id=1' or 1=1 -- true
```

`OR 1=1` のように「常に真になる条件」を WHERE 句に注入すると、本来1件だけ返るはずのクエリが全件を返すようになったり、認証チェックが意図せず通過したりする。これは論理式全体が `真 OR 真` = 真に固定されてしまうためで、アプリケーションの挙動差分（返却件数、ログイン成否、表示内容の変化）から注入点の存在を推測できる。

#### 1.3 タイミングによる検出

エラーも表示差分も出ない「見た目には何も変わらない」レスポンスでも、`SLEEP()` や `BENCHMARK()` のような重い処理を条件式に混ぜ込み、レスポンス時間の変化を観測することで注入点を確認できる。

```sql
' AND SLEEP(5)/*
BENCHMARK(2000000,MD5(NOW()))
```

これはブラインド SQLi の基本技法そのものであり、出力チャネルが一切ない状況でも通用する唯一に近い観測手段である点が重要になる（ブラインド技法の詳細は第3章で扱う）。

> 出典: PayloadsAllTheThings — SQL Injection README — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/README.md

### 2. UNION ベース攻撃：最小構成の例（PayloadsAllTheThings）

PATT は UNION 攻撃の核心を、次のような最小構成で説明している。脆弱なバックエンドクエリを次と仮定する。

```sql
SELECT product_name, product_price FROM products WHERE product_id = 'input_id'
```

ここに次のペイロードを注入する。

```sql
1' UNION SELECT username, password FROM users --
```

すると実行されるクエリは次のようになる。

```sql
SELECT product_name, product_price FROM products WHERE product_id = '1' UNION 
SELECT username, password FROM users --';
```

**なぜこれで動くのか。** `UNION` は2つの `SELECT` 文の結果セットを縦に結合する SQL 標準の演算子である。ただし RDBMS の実装上、UNION で結合する両方の `SELECT` は「同じ数のカラム」を持たなければならない。ここが後述の HackTricks の「カラム数特定」の手順と直結する。カラム数さえ合わせれば、型がおおよそ整合する限り（文字列カラムに文字列を、数値カラムに数値を当てる）、`users` テーブルの `username`/`password` を `product_name`/`product_price` の位置に紛れ込ませてアプリケーションの通常の表示ロジックにそのまま流し込める。攻撃者からすれば、アプリが「本来表示するつもりのなかったデータ」をそのまま正規の表示領域に出力させる、というのが UNION 攻撃の本質である。行末の `--` はそれ以降の元クエリ（閉じクォートなど）をコメントアウトし、構文エラーを防ぐ役割を持つ。

> 出典: PayloadsAllTheThings — SQL Injection README — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/README.md

### 3. 認証バイパスのペイロード集（PayloadsAllTheThings）

ログインフォームのように「入力値が WHERE 句の条件として使われ、行が1件でも返れば認証成功とみなす」実装は、トートロジー注入の典型的な標的になる。

#### 3.1 基本的なバイパス

```sql
' OR '1'='1'--
```

想定される脆弱なクエリはこう組み立て直される。

```sql
SELECT * FROM users WHERE username = '' OR '1'='1'--' AND password = '';
```

`--` によってパスワード比較条件そのものがコメントアウトされ、`OR '1'='1'` の恒真部分だけが有効な WHERE 句として残るため、パスワードを知らなくても行が返ってしまう。

#### 3.2 LIMIT を使ったバイパス

```sql
' or 1=1 limit 1 --
```

アプリケーション側が「複数行返ってきた場合はログインを拒否する」といった簡易的な防御を入れているケースに対し、`LIMIT 1` で返却行数を1件に絞り込みつつ全件対象の恒真条件を使うことで、その防御をすり抜ける。ここから読み取れる教訓は、「返却行数の制御」は認証ロジックの防御にならないということである。

#### 3.3 MD5 ハッシュ衝突を利用したバイパス

パスワードがハッシュ化して保存されているためログイン画面への単純なトートロジーが通らない場合、UNION でハッシュ値ごと差し替える手がある。

```sql
admin' AND 1=0 UNION ALL SELECT 'admin', '161ebd7d45089b3446ee4e0d86dbcf92'--
```

ここで `161ebd7d45089b3446ee4e0d86dbcf92` は `MD5("P@ssw0rd")` の値である。`AND 1=0` で元の（存在しないかもしれない）行を確実に排除したうえで、UNION 側に「ユーザー名 `admin` とその MD5 ハッシュ既知のパスワード `P@ssw0rd`」という行を1行だけ差し込み、アプリケーションにその行をログイン成功として扱わせる。攻撃者は平文パスワードとハッシュ値の対応をあらかじめ知っている必要があるが、ハッシュ関数自体を突破する必要はない、という点が要点である。

#### 3.4 型変換の緩さを突く Raw MD5 バイパス

```php
sql = "SELECT * FROM admin WHERE pass = '".md5($password,true)."'";
```

PHP の `md5($password, true)` はハッシュ値を16進文字列ではなく生バイナリで返す。このバイナリがそのまま SQL 文字列リテラルに連結されると、バイナリ中にクォートや `OR` に相当する文字列断片が偶然出現し得る。入力 `ffifdyop` はこの性質を突いて `'or'` に類する文字列を生成する既知の値として知られており、WHERE 句が意図せず壊れて恒真化する。これは「ハッシュ関数を破る」のではなく、「ハッシュ出力を無検証で文字列連結する実装の不備」を突く攻撃である点に注意する。

#### 3.5 WAF 迂回の補助テクニック

```
%09  タブ文字によるスペース代替
%0A  改行によるスペース代替
%0D  復帰によるスペース代替
```

スペース文字だけをブロックする素朴な WAF/フィルタに対しては、SQL パーサがホワイトスペースとして受理する他の制御文字に置き換えることで構文を成立させたまま検出を回避できる。また `LIMIT 1,1` のようにカンマを含む構文が禁止されている場合は、`LIMIT 1 OFFSET 0` という等価な別構文に言い換えることでフィルタを迂回できる。これらは第5章で扱う WAF バイパスの導入部にあたる。

> 出典: PayloadsAllTheThings — SQL Injection README — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/README.md

### 4. UNION を確実に組み立てる手順（HackTricks）

HackTricks の SQL Injection ページは、UNION 攻撃を成功させるための機械的な手順を「カラム数の特定 → データ型の確認 → 実データの抽出」という順序で整理している点に強みがある。

#### 4.1 ORDER BY / GROUP BY によるカラム数特定

```sql
1' ORDER BY 1--+    #True
1' ORDER BY 2--+    #True
1' ORDER BY 3--+    #True
1' ORDER BY 4--+    #False - クエリは3カラムのみ
```

**なぜこれで特定できるのか。** `ORDER BY n` は「結果セットの n 番目のカラムでソートせよ」という指示である。元のクエリが実際には3カラムしか `SELECT` していないのに `ORDER BY 4` を指定すると、RDBMS は「存在しない4番目のカラムでソートしろと言われた」という構文/実行時エラーを返す。したがって `ORDER BY` の数値を1から順に増やしていき、エラーに転じた直前の数値が、元クエリの実際のカラム数である。`GROUP BY` でも同じ理屈（存在しないカラムでのグルーピングは不可能）でカラム数を特定できるとされている。この手順は UNION 攻撃の前提条件（両 `SELECT` のカラム数を一致させる必要がある）を満たすための、実務上もっとも確実で機械的な下準備である。

#### 4.2 NULL を使ったカラム数・型の仮当てはめ

```sql
1' UNION SELECT null--
1' UNION SELECT null,null--
1' UNION SELECT null,null,null--
```

カラム数を1つずつ増やしながら `UNION SELECT null,...` を試し、エラーが消えた時点のカラム数を確定させる方法は、`ORDER BY` が使えない（あるいは既にエラーで確認済みの数を UNION 側でも裏取りしたい）場面の代替手段になる。`NULL` を使う理由は、`NULL` がほぼすべての型（文字列・数値・日付など）に暗黙変換で受理されるため、型不一致によるエラーを気にせずカラム数の一致だけを検証できるからである。カラム数が確定したら、`NULL` を1つずつ実際の文字列（例えば `'a'`）に置き換えていき、型エラーが出ないカラムを「文字列を差し込める列」として特定する。この列こそが、後続のデータ抽出でアプリケーションの画面に表示させる出力チャネルになる。

#### 4.3 スキーマ情報の列挙とデータ抽出

カラム数と出力可能な列が判明したら、`information_schema` を辿ってスキーマ情報を抽出し、最終的に狙ったテーブルの中身を抜き出す。

```sql
-1' UniOn Select 1,2,gRoUp_cOncaT(0x7c,schema_name,0x7c) 
  fRoM information_schema.schemata

-1' UniOn Select 1,2,3,gRoUp_cOncaT(0x7c,table_name,0x7C) 
  fRoM information_schema.tables wHeRe table_schema=[database]

-1' UniOn Select 1,2,3,gRoUp_cOncaT(0x7c,column_name,0x7C) 
  fRoM information_schema.columns wHeRe table_name=[table name]
```

この3段階の仕組みを整理する。

1. `information_schema.schemata` は MySQL が内部的に保持する「このサーバー上に存在するすべてのデータベース（スキーマ）名」のカタログである。ここから狙うべきデータベース名を洗い出す。
2. `information_schema.tables` は「あるデータベースの中に存在するすべてのテーブル名」のカタログである。`table_schema=[database]` で対象データベースを絞り込み、テーブル名（例えば `users`）を洗い出す。
3. `information_schema.columns` は「あるテーブルの中に存在するすべてのカラム名」のカタログである。`table_name=[table name]` で対象テーブルを絞り込み、カラム名（例えば `username`, `password`）を洗い出す。

ここまでの手順で、攻撃者はテーブル定義を一切事前に知らなくても、DB自身が持つメタデータ（カタログ）を問い合わせるだけで攻撃対象のスキーマ構造を完全に復元できる。これが `information_schema` を狙う理由である。

`GROUP_CONCAT(0x7c, col, 0x7c)` は、本来複数行に渡る結果を UNION の1行1カラムに押し込めるための工夫である。UNION 攻撃では出力できる「枠」（表示可能なカラムと行数）が限られることが多いため、`GROUP_CONCAT` で複数行の値を1つの文字列に連結し、区切り文字（`0x7c` は `|` の16進表現）を挟んで一度に持ち出す。先頭の `-1'` は、元のクエリ側の `WHERE` 条件に一致する行を意図的にゼロ件にするための常套句で、こうすることでアプリケーションの表示領域が UNION 側の行だけで占められ、結果が読み取りやすくなる。

#### 4.4 エラーベース抽出の一例

```sql
(select 1 and row(1,1)>(select count(*),
concat(CONCAT(@@VERSION),0x3a,floor(rand()*2))x 
from (select 1 union select 2)a group by x limit 1))
```

これは MySQL の `GROUP BY` に対して重複キーが生じたときに投げる `Duplicate entry` エラーの本文に、抽出したいデータ（ここでは `@@VERSION`、サーバーのバージョン文字列）を紛れ込ませるテクニックである。`rand()*2` を `floor()` で丸めた0/1の値を `GROUP BY` のキーに使うと、MySQL の内部実装上、同じキーに対して集計行を再評価するタイミングで非決定的な重複が発生しやすくなり、その重複時のエラーメッセージに `concat()` で連結しておいたデータが一緒に出力される。アプリケーションがこの生のDBエラーメッセージをそのままレスポンスに出力してしまう実装であれば、UNION で表示用カラムを使わずとも、エラー文字列だけを頼りにデータを1バイトも表示せず抜き出せる。エラーベース抽出は、表示に使える出力カラムが1つもない、あるいは非常に限られている場面での UNION の代替として位置づけられる。

> 出典: HackTricks — SQL Injection — https://hacktricks.wiki/en/pentesting-web/sql-injection/index.html

### 5. 2つの資料をどう使い分けるか

まとめると、実務での動線は次のようになる。

1. **検出**（PATT §1）: パラメータが SQL に連結されているかをエラー・トートロジー・タイミングで確認する。
2. **カラム数特定**（HackTricks §4.1）: `ORDER BY`/`GROUP BY`、または `UNION SELECT null,...` で UNION に必要なカラム数を機械的に絞り込む。
3. **出力チャネルの特定**（HackTricks §4.2）: `NULL` を文字列に置き換え、どのカラムが表示に使えるかを確認する。
4. **スキーマ探索とデータ抽出**（HackTricks §4.3）: `information_schema` を辿ってテーブル・カラム名を洗い出し、`GROUP_CONCAT` で1行に集約して持ち出す。
5. **認証系の標的では**（PATT §3）: ログインフォームなど WHERE 句の真偽だけで動作が変わる箇所には、トートロジーや MD5 衝突・型変換の緩さを突くペイロードを個別に検討する。
6. **フィルタに阻まれたら**（PATT §3.5）: スペース代替文字や構文の言い換えで、第5章の WAF バイパス技法に接続する。

両資料とも継続的にメンテナンスされているコミュニティ主導のリポジトリ/wikiであり、DBMS 固有の関数名や `information_schema` 相当のカタログ名（PostgreSQL の `pg_catalog`、MSSQL の `sys.tables` など）は資料内で随時更新される。実際の診断では、まず対象 DBMS を第4章のフィンガープリンティング手法で特定したうえで、該当 DBMS 別のページ（両リポジトリともMySQL/MSSQL/PostgreSQL/Oracle/SQLiteなどに個別ページを持つ）を参照するのが正確である。
