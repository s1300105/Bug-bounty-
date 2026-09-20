## ORM・NoSQL・GraphQLとSQLi

これまでの章では、生のSQL文字列を組み立てるアプリケーションを対象にSQLiを扱ってきた。しかし現代のアプリケーションの多くは、SQLを直接書かずにデータベースへアクセスする層――ORM（Object-Relational Mapping、オブジェクトとリレーショナルDBのテーブルを対応付けて操作を抽象化する仕組み）や、そもそもリレーショナルではないNoSQLデータベース、さらにはHTTP APIの前段に立つGraphQLレイヤーを介している。本節では、これら「抽象化レイヤーの向こう側」でSQLiやそれに類する注入がどう成立するのかを、仕組みのレベルで解説する。結論を先に言えば、抽象化レイヤーは注入を「なくす」のではなく「注入が起きる場所と形をずらす」だけであり、開発者がレイヤーの提供する安全機構（プレースホルダ、バインドパラメータ）を使わずに文字列結合をすれば、ORMでもNoSQLでもGraphQLでも同じ穴が開く。

### ORM Injection ― 安全なはずの層に潜む注入

#### 定義と基本構造

ORM Injectionとは、ORMが生成するデータアクセス層に対してSQL Injectionを行う攻撃を指す。テスターの視点からは通常のSQLiとほぼ見分けがつかないが、脆弱性そのものはORM層が生成（または実行）するコードの中に存在する点が異なる。

> 出典: ORM Injection — OWASP WSTG (05.7-ORM_Injection.md) — https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/05.7-ORM_Injection.md

ORMツール（Hibernate、NHibernate、ActiveRecord、Sequelize、Eloquentなど）を使う利点は、(1) オブジェクト層を素早く生成できる、(2) データアクセスコードのテンプレートを統一できる、(3) 通常はSQL Injectionから守るための「安全な関数」（プレースホルダ・バインドパラメータ）が用意されている、という3点にある。ORMが生成するオブジェクトはCRUD（Create/Read/Update/Delete）操作のためにSQL、あるいはHQL（Hibernate Query Language）のようなSQLの方言を内部的に使う。問題は、開発者がこの「安全な関数」を使わずに、ユーザー入力をクエリ文字列へ直接連結してしまった場合に生じる。

#### 弱いORM実装：文字列連結によるHQL Injection

SANSの資料から引用された、Hibernate（Javaの代表的ORM）における脆弱なコード例は以下の通りである。

```java
List results = session.createQuery("from Orders as orders where orders.id = " + currentOrder.getId()).list();
List results = session.createSQLQuery("Select * from Books where author = " + book.getAuthor()).list();
```

これは一見「ORMを使っているから安全」に見えるが、実態は文字列連結でHQL（あるいは生SQL）を組み立てているだけであり、通常のSQLiと全く同じ穴が開いている。`currentOrder.getId()` や `book.getAuthor()` が外部入力に由来するなら、そこにSQLメタ文字を注入して`WHERE`句のロジックを書き換えられる。

正しい実装は、位置パラメータ（プレースホルダ）を使い、値の埋め込みをORMのバインド機構に委ねることである。

```java
Query hqlQuery = session.createQuery("from Orders as orders where orders.id = ?");
List results = hqlQuery.setString(0, "123-ADB-567-QTWYTFDL").list(); // 0番目のプレースホルダに文字列を安全にバインド
```

この違いが本質である。文字列連結ではDBエンジンに渡す時点で「コード（SQL構文）」と「データ（ユーザー入力）」が1本の文字列に混ざってしまい、パーサはメタ文字の区別ができない。一方プレースホルダ方式では、クエリの構文（プリペアドステートメント）が先にDBエンジンへコンパイルされ、その後で値だけが別チャネルで結合される。したがってユーザー入力に`'`や`;`が含まれていても、それは「値」としてしか解釈されず、構文としては機能しない。これは前章までに扱ったプレースホルダ/プリペアドステートメントの原理そのものであり、ORMを挟んでも原理は変わらないという点が重要である。

> 出典: ORM Injection — OWASP WSTG — https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/05.7-ORM_Injection.md

#### 「実装は正しくてもORM自体が脆弱」なケース

もう一つの経路は、ORMライブラリ自体のバグである。ORM層はサードパーティのコードであり、他のソフトウェアと同様に脆弱性を持ちうる。WSTGは以下の実例を挙げている。

- **Sequelize（Node.js用ORM）**: 2019年、SequelizeのnpmライブラリにSQL Injectionの脆弱性が発見された。
- **Hibernate（Java用ORM）**: RIPS Techの調査により、Hibernateの実装にバイパス手法が存在することが示された。RIPS Techのブログ記事をもとに、WSTGはDBMSごとのバイパス用チートシートを掲載している。

| DBMS | SQL Injection（バイパス例） |
|---|---|
| MySQL | `abc\' INTO OUTFILE --` |
| PostgreSQL | `$$='$$=chr(61) \|\| chr(0x27) and 1=pg_sleep(2) \|\| version()'` |
| Oracle | `NVL(TO_CHAR(DBMS_XMLGEN.getxml('select 1 where 1337>1')),'1')!='1'` |
| MS SQL | `1<LEN((select top 1 name from users)` |

これらのペイロードが機能する理由は、HQLやJPQL（Java Persistence Query Language）がSQLそのものではなく「SQLに変換される中間言語」だからである。ORMの構文パーサは、開発者が想定していない特殊なトークンの組み合わせ（関数呼び出し、サブクエリ、文字列演算子の入れ子など）を許容してしまうことがあり、そのトークン列が最終的にSQLへコンパイルされる際に、意図しないSQL構造として解釈される。つまりパラメータバインドを正しく使っていても、HQL自体の構文（例えば`(select ...)`のようなサブクエリをどこまで許すか）にバグがあれば、その隙間から注入が成立する。これはSQLiというより「HQLi」と呼ぶべき現象だが、最終的にRDBMSへ届く時点でSQL Injectionとして現れる。

- **Laravel Query Builder**: 2019年、Laravelの`Query-Builder`パッケージでも同種の脆弱性が公表されている。

#### 攻撃者視点でのテスト手順

WSTGが示す手順は以下の通りである。

1. **ORM層の特定**: 情報収集フェーズで使用技術（言語・フレームワーク）を特定し、その言語で一般的に使われるORMの一覧と照合する。
2. **ORM層の悪用**: 使用されているORMが分かれば、そのパーサの挙動を調べ、既知のCVEがないか確認する。ORM層の実装が甘い場合は、ORM層を意識せず通常のSQL Injectionテスト（第2〜4章で扱った手法）がそのまま通用することも多い。

> 出典: ORM Injection — OWASP WSTG — https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/05.7-ORM_Injection.md

実務上の教訓は、「ORMを使っている」という事実だけではSQLi対策の証明にならず、(a) 文字列連結を使っていないか、(b) 使用しているORMのバージョンに既知の脆弱性がないか、の2点を必ず確認する必要があるということである。

---

### NoSQL Injection ― 構文が変わっても注入の本質は変わらない

#### なぜNoSQLでも「injection」が成立するのか

NoSQLデータベースはリレーショナルDBほど厳格な整合性制約を要求しないため、性能・スケーラビリティで有利とされる。しかし「SQL構文を使っていない」ことは「注入に強い」ことを意味しない。NoSQLのデータベース呼び出しは、アプリケーションのプログラミング言語そのもの、カスタムAPI呼び出し、あるいはJSON・XML・LINQなどの共通フォーマットで記述される。これらは通常のSQLiフィルタ（`< > & ;`のようなHTML特殊文字を落とす処理など）をすり抜ける。たとえばJSON APIに対する攻撃では`/ { } :`のような文字が意味を持つため、HTML用フィルタでは防げない。

> 出典: NoSQL Injection — OWASP WSTG (05.6-NoSQL_Injection.md) — https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/05.6-NoSQL_Injection.md

さらにNoSQL Injectionは、宣言型のSQL言語ではなく、手続き型言語（JavaScriptなど）の中で実行される場合があり、その場合の影響はSQLiより大きくなりうる。データを盗まれるだけでなく、任意コード実行にまで発展しうるからである。NoSQL製品ごとにAPIも言語も異なるため汎用的なペイロード集は存在しないが、本節では最も普及しているMongoDBを例に説明する。

#### MongoDBにおける`$where`演算子とJavaScript注入

MongoDBのAPIは本来BSON（Binary JSON）形式の安全なクエリ組み立てツールを提供しているが、`$where`のような一部のクエリ演算子は、シリアライズされていない生のJavaScript式を許可する。

```js
db.myCollection.find( { $where: "this.credits == this.debits" } );
```

より高度な条件にはJavaScript関数そのものも渡せる。

```js
db.myCollection.find( { $where: function() { return obj.credits - obj.debits < 0; } } );
```

もしユーザー入力がサニタイズされずに`$where`へ渡ると、任意のJavaScriptを注入できる。

```js
db.myCollection.find( { active: true, $where: function() { return obj.credits - obj.debits < $userInput; } } );
```

`$userInput`に外部入力がそのまま埋め込まれる場合、次のような文字列を送るだけでDBエラーを誘発でき、サニタイズの有無を判定できる。

```
' " \ ; { }
```

これはSQLiにおける`'`一発でのエラー検知テストと全く同じ発想である。さらに一歩進めると、`$where`はJavaScriptという「フルスペックの言語」を評価するため、単なるデータの窃取・改ざんに留まらず任意コード実行に相当する挙動を起こせる。WSTGはCPU使用率を100%に固定するDoSペイロードを例示している。

```
0;var date=new Date(); do{curDate = new Date();}while(curDate-date<10000)
```

これが`$userInput`に挿入されると、実行されるJavaScript関数は以下のようになる。

```js
function() {
  return obj.credits - obj.debits < 0;
  var date=new Date();
  do{curDate = new Date();}while(curDate-date<10000);
}
```

この式はMongoDBインスタンスを10秒間100%のCPU使用率に張り付かせる。原理は単純で、`$where`に渡された文字列はMongoDBサーバ側のJavaScriptエンジンでそのまま`eval`的に実行されるため、注入された文字列は「データ」ではなく「実行可能なコード片」として振る舞う。これはSQLiにおける「文字列リテラルの終端を書き換えて後続を制御構造として解釈させる」テクニックの、JavaScript版と言える。

> 出典: NoSQL Injection — OWASP WSTG — https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/05.6-NoSQL_Injection.md

#### 予約演算子名の衝突によるインジェクション（パラメータ汚染経路）

もう一つの経路は、ユーザー入力が全くサニタイズなしでクエリに渡らない場合でも成立する。MongoDBの`$where`はクエリ演算子として予約された名前だが、PHPでは`$where`は単なる変数名としても有効である。PHP用MongoDBドライバの公式ドキュメントは明示的に警告している。

> 「すべての特殊クエリ演算子（`$`で始まるもの）については、PHPが`$exists`をその変数`$exists`の値に置き換えてしまわないよう、必ずシングルクォートで囲んでください。」

つまり、クエリが直接ユーザー入力に依存していなくても、攻撃者はHTTP Parameter Pollution（同名パラメータを複数送ることでサーバ側の変数束縛を混乱させる手法）を使い、`$where`という名前のPHP変数を外部から生成・上書きできる可能性がある。これが成功すると、クエリは以下のように置き換わる。

```
$where: function() { /* 任意のJavaScript */ }
```

この経路の教訓は、「入力値そのものはエスケープされているから安全」という思い込みが、言語・フレームワーク側の変数名解決の仕組みによって裏切られうるという点である。SQLiで言えば、値のエスケープは万全でもクエリの「構造」そのものが外部から操作可能であるケースに相当する。

> 出典: NoSQL Injection — OWASP WSTG — https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/05.6-NoSQL_Injection.md

#### 構文インジェクションと演算子インジェクション（PortSwigger分類）

PortSwiggerの学習パスでは、NoSQL Injectionを大きく2種類に分類している。

- **構文インジェクション（syntax injection）**: NoSQLクエリの構文そのものを破壊して悪意あるペイロードを注入する。従来のSQLiと発想は同じだが、対象言語がNoSQLのクエリ言語になる。
- **演算子インジェクション（operator injection）**: 構文を破壊するのではなく、NoSQL側のクエリ演算子（`$ne`、`$regex`、`$where`、`$in`など）そのものを注入して意味を書き換える。

> 出典: NoSQL injection — PortSwigger Web Security Academy — https://portswigger.net/web-security/learning-paths/nosql-injection および https://portswigger.net/web-security/nosql-injection

**構文インジェクションの検出**: `'`のような特殊文字をカテゴリパラメータへ送り、内部クエリが以下のようになるかを観察する。

```
this.category == '''
```

エラーが起き、クォートをエスケープすると通る（`this.category == '\''`）場合、アプリケーションは脆弱と判断できる。真偽条件を送ってレスポンス差分を見るテストも有効である。

```
category=fizzy' && 0 && 'x
category=fizzy' && 1 && 'x
```

常に真となる条件を注入すれば、フィルタ条件を無視して全件を返させられる。

```
category=fizzy'||'1'=='1'
```

**演算子インジェクションの検出**: URLパラメータ形式の入力をJSONオブジェクトへ変換して解釈するアプリケーションでは、演算子をJSONとして注入できる。ログインフォームのパスワードフィールドへ以下を送ると、「パスワードが`"invalid"`と等しくない」という常に真に近い条件になり、認証をバイパスできることがある。

```json
{"username":{"$ne":"invalid"},"password":{"$ne":"invalid"}}
```

`$regex`演算子を使えば、正規表現マッチによるブラインド抽出（1文字ずつ真偽を判定してデータを抜き出す手法）も可能になる。

```json
{"username":"admin","password":{"$regex":"^a.*"}}
```

`$where`を悪用した文字単位のデータ抽出パターンも存在する。

```
admin' && this.password[0] == 'a' || 'a'=='b
```

これらはいずれも、SQLiにおけるブールブラインド（真偽の違いをレスポンスの差で判定する手法）や時間ベースブラインド（`pg_sleep`等で応答遅延を意図的に発生させる手法）と原理的に同一である。MongoDBでもタイミング差を使う手法が使える。

```
admin'+function(x){var waitTill = new Date(new Date().getTime() + 5000);
while((x.password[0]==="a") && waitTill > new Date()){};}(this)+'
```

**防御策**: PortSwiggerは以下を推奨している。(1) 入力値をアローリスト（許可する値のリスト）方式で検証・サニタイズする、(2) 文字列連結ではなくパラメータ化されたクエリ構築を使う、(3) 受け付けるオブジェクトキー自体をアローリスト化し、`$ne`や`$regex`のような演算子キーが混入すること自体を拒否する。

> 出典: NoSQL injection — PortSwigger Web Security Academy — https://portswigger.net/web-security/nosql-injection

3番目の対策が特にNoSQL特有である点に注意したい。SQLiのプレースホルダ対策は「値」を守ればよいが、NoSQL演算子インジェクションは「キー」（`$ne`等の演算子名）そのものが攻撃面になるため、値のエスケープだけでは防げない。リクエストボディのJSONを受け取った時点で、期待する型（例えば文字列のみ）であることを検証し、オブジェクト型が混入していないかをチェックする実装が必須になる。

---

### GraphQL経由のSQL Injection ― APIレイヤーを越えて届く注入

#### GraphQLはSQLiを「防がない」

GraphQLは、クライアントが必要なフィールドだけを指定してデータを取得できるクエリ言語であり、REST APIの代替として普及している。しかしGraphQL自体はインジェクション対策の仕組みを内蔵していない。GraphQLサーバーは多くの場合、受け取ったクエリ引数をバックエンドのデータベース操作（多くはSQL）へ変換するだけであり、そこでユーザー入力がサニタイズなしに文字列結合されれば、通常のSQLiと同じ脆弱性が生まれる。

> 出典: GraphQL Injection — PayloadsAllTheThings — https://swisskyrepo.github.io/PayloadsAllTheThings/GraphQL%20Injection/

これは前章までのSQLiと本質的に同じ話だが、攻撃面（フィールドの引数）と発見経路（GraphQLの内省機能）がREST APIとは異なるため、テスト手法として独立して扱う価値がある。

#### 基本的な注入ポイント：フィールド引数

GraphQLのクエリはフィールドに引数を渡す形をとる。引数が文字列としてバックエンドのSQL文へ渡される際にプレースホルダを使わず連結されていれば、以下のように単純な`'`一発で構文を壊せる。

```graphql
{
  bacon(id: "1'") {
    id
    type
    price
  }
}
```

これがSQL構文エラーを誘発すれば、`bacon`フィールドの`id`引数がSQL文へ直接連結されている証拠になる。

時間ベースのブラインドSQLiも同様に成立する。

```graphql
query {
  user(name: "patt';SELECT 1;SELECT pg_sleep(30);--'") {
    id
    email
  }
}
```

ここでバックエンドが `SELECT * FROM users WHERE name = '` + 引数 + `'` のような文字列結合でクエリを組み立てている場合、注入されたSQLがそのまま実行される。`pg_sleep(30)`はPostgreSQL固有の関数で、指定秒数だけクエリの応答を遅延させる。エラーメッセージがアプリケーション側で握りつぶされていても、レスポンス時間の差という「サイドチャネル」から注入の成否を判定できる点が、ブラインドSQLiの核心である。

> 出典: GraphQL Injection — PayloadsAllTheThings — https://swisskyrepo.github.io/PayloadsAllTheThings/GraphQL%20Injection/

なお、GraphQL経由ではSQLiだけでなくNoSQLi（前節の`$regex`など）も同様に発生しうる。GraphQLのresolver（フィールドへの問い合わせを実際のデータ取得処理へ橋渡しする関数）がMongoDBを叩く実装であれば、引数として渡したJSON文字列内に`$regex`演算子を仕込むことで、GraphQL経由のNoSQL Injectionが成立する。

```graphql
{
  doctors(
    options: "{\"limit\": 1, \"patients.ssn\" :1}",
    search: "{ \"patients.ssn\": { \"$regex\": \".*\"}, \"lastName\":\"Admin\" }")
  {
    firstName lastName id patients{ssn}
  }
}
```

これはGraphQLが「クエリ言語」であって「注入対策そのもの」ではないことを端的に示す例である。GraphQLサーバーは受け取った引数文字列の中身を検証しないので、その文字列がどんなバックエンドのクエリ言語（SQL、MongoDBクエリ、LDAPフィルタなど）へ渡されるかによって、注入の「方言」が決まる。

#### 内省（introspection）による攻撃面の探索

GraphQLの大きな特徴は、スキーマそのものをクエリで問い合わせられる「内省（introspection）」機能である。`__schema`メタフィールドを使うと、公開されている全ての型・フィールド・引数・ディレクティブを列挙できる。

```graphql
{__schema{queryType{name}mutationType{name}subscriptionType{name}types{...FullType}directives{name description locations args{...InputValue}}}}
```

特定の型だけを調べる簡易版も使える。

```graphql
{__type (name: "User") {name fields{name type{name kind ofType{name kind}}}}}
```

内省はGraphQLサーバーの標準機能であり、本番環境で無効化されていない限り誰でも使える。攻撃者はこれを使って「どのフィールドが文字列引数を受け取るか」を機械的に洗い出し、SQLi・NoSQLiの候補ポイントを絞り込む。テスターにとっても同じ手順が偵察の第一歩になる。基本的な偵察エンドポイントの例は以下の通りである。

```
example.com/graphql?query={__schema{types{name}}}
example.com/graphiql?query={__schema{types{name}}}
```

> 出典: GraphQL Injection — PayloadsAllTheThings — https://swisskyrepo.github.io/PayloadsAllTheThings/GraphQL%20Injection/

#### テスト用ツール：InQLとGraphQLmap

- **InQL**（doyensec製、Burp Suite拡張）: GraphQLの内省結果を解析し、スキーマ内の全クエリ・ミューテーションを一覧化してテスト用リクエストを自動生成する。SQLmapに着想を得た設計で、クエリや変数へのペイロード注入による欠陥検出を自動化する。
- **GraphQLmap**（swisskyrepo製）: GraphQLエンドポイントに対して対話的にリクエストを送るスクリプティングエンジンで、ペンテスト用途に特化している。複数フィールド・複数ミューテーションにまたがる注入テストを自動化できる。

> 出典: GraphQL Injection — PayloadsAllTheThings — https://swisskyrepo.github.io/PayloadsAllTheThings/GraphQL%20Injection/

これらのツールは「GraphQLスキーマを内省で洗い出し、文字列引数を持つフィールドへ機械的にSQLi/NoSQLiペイロードを流し込む」という作業を自動化するものであり、手動での偵察→ペイロード注入という基本の流れを高速化するに過ぎない。原理を理解していれば、ツールなしでもBurp Suiteの通常のIntruder機能等で同じテストを再現できる。

#### バッチングによる防御回避

GraphQLの実装によっては、1回のHTTPリクエストに複数のクエリを配列で束ねる「バッチング」が許可されている。

```json
[
  {"query":"..."},
  {"query":"..."}
]
```

エイリアス（同じフィールドに別名を付けて複数回呼び出す機能）を使えば、1つのGraphQLクエリの中に複数のミューテーション呼び出しを埋め込むこともできる。

```graphql
mutation {
  login(pass: 1111, username: "bob")
  second: login(pass: 2222, username: "bob")
  third: login(pass: 3333, username: "bob")
}
```

これ自体はSQLiではないが、SQLiのブラインド抽出やブルートフォースを行う際に、リクエスト単位のレート制限を回避する手段として悪用されうる。1リクエストあたりの送信回数に制限を掛けているだけの防御は、バッチングを考慮しない限り無意味になる。

> 出典: GraphQL Injection — PayloadsAllTheThings — https://swisskyrepo.github.io/PayloadsAllTheThings/GraphQL%20Injection/

#### ケーススタディ：Praetorianによる金融系GraphQL APIでのSQLi発見

Praetorian社は、PostgreSQLをバックエンドに持つ金融データアプリケーションのGraphQL APIにおいて、実際にSQL Injectionを発見した事例を公開している。この事例は「GraphQLの向こうにSQLiが隠れる」ことの実証として、方法論・ペイロード・影響まで具体的に示されている点で価値が高い。

**発見の流れ**:

1. **偵察**: Burp Suiteでリクエストを傍受し、認証済みユーザーが「プロセス作成」機能を操作する際のGraphQLトラフィックを観察した。クライアントが生成した検索語（search term）をサーバーに渡す特定の関数が標的になった。
2. **最初のペイロード投入**: 検索語を`' OR 1=1--`に置き換えたところ、SQLエラーが返り、SQL Injectionが可能であることが確認された。
3. **時間ベースのブラインド抽出への切り替え**: エラーメッセージが常に得られるとは限らないため、チームはタイミングベースのブラインド手法に切り替えた。真の条件はレスポンスを遅延させ、偽の条件は即座に返る、という差分を利用する。

権限確認に使われた具体的なペイロードは以下の通りである。

```sql
';SELECT case when (SELECT current_setting('is_superuser'))='on'
then pg_sleep(25) end;--
```

このクエリは、現在のDB接続が`is_superuser`（PostgreSQLのスーパーユーザー権限）を持っているかどうかをCASE式で判定し、真であれば`pg_sleep(25)`で25秒遅延させる。25秒の遅延が発生しなかったことから、当該DB接続はスーパーユーザー権限では動いていないと判断できた（＝この経路からの直接的な特権昇格は難しいことが分かった）。`current_setting()`はPostgreSQLの設定値を取得する関数であり、このように「取得したい情報の真偽をpg_sleepの有無に変換する」のがPostgreSQL系の時間ベースブラインドSQLiの定石である。

**判明した影響**:

- **列挙能力**: ブラインドSQLiを使い、テーブル名・カラム名を1文字ずつ抽出することに成功した。
- **データ整合性リスク**: テスト用テーブル`cmd_exec`に対して`INSERT`・`UPDATE`・`DELETE`が実行可能であることを確認した。
- **RCEへの拡張可能性**: PostgreSQLの`CVE-2019-9193`（`COPY ... TO/FROM PROGRAM`構文を悪用してOSコマンドを実行できる問題）を、SQLiからRCE（Remote Code Execution）へエスカレーションしうる経路として言及している。これは第6章前半で扱うSQLi→RCEの実例そのものであり、GraphQL層を経由していても最終的な到達点はRDBMSのネイティブ機能に依存するという点を裏付けている。

**推奨される対策**: Praetorianは(1) バインドされた型付きパラメータを使うパラメータ化クエリ、(2) パラメータ化されたストアドプロシージャの慎重な利用、の2点を挙げている。これはJava・.NET・Perl・PHPなど言語を問わず適用できる原則であり、GraphQLというレイヤーが増えても、最終防衛線は結局「SQL文の構築方法」に帰着することを示している。

> 出典: Identifying SQL Injections in a GraphQL API — Praetorian — https://www.praetorian.com/blog/identifying-sql-injections-in-a-graphql-api/

### まとめ：抽象化レイヤーが変えるのは「攻撃面」であって「原理」ではない

本節で見た3つのレイヤー――ORM、NoSQL、GraphQL――に共通するのは以下の構造である。

1. **抽象化レイヤーは「安全な既定経路」を提供するが、それを使うかどうかは開発者次第**である。ORMのプレースホルダ、NoSQLドライバのBSON組み立て機能、GraphQLサーバーの型システムは、いずれも正しく使えば注入を防げる。しかし文字列結合という「近道」を取った瞬間、レイヤーの種類に関わらず同じ穴が開く。
2. **フィルタは対象言語の構文を知らなければ意味を持たない**。HTML用フィルタはJSON特殊文字（`{ } :`）を素通りさせ、SQL用フィルタはJavaScriptの構文やGraphQLのフィールド構造を意識していない。防御側は「最終的にどの言語のパーサへ値が渡るか」を起点に対策を設計する必要がある。
3. **攻撃面の発見手段はレイヤーごとに異なる**。ORMでは使用ライブラリとCVEの特定、NoSQLでは演算子キーの注入可否、GraphQLでは内省クエリによるスキーマ列挙が、それぞれの偵察の起点になる。しかし注入が成立した後のブラインド抽出手法（真偽差分、時間差分）は、SQLi・NoSQLiを通じてほぼ共通の原理で動く。
4. **最終的な到達点は変わらない**。GraphQLやORMを経由しても、バックエンドがRDBMSであればSQLiとしての影響（データ抽出・改ざん・場合によってはRCE）がそのまま生じる。レイヤーが増えるほど「どこで文字列が組み立てられているか」を追跡するテスターの負担は増えるが、脆弱性の根本原因は一貫して「信頼できない入力とクエリ構文の未分離」である。
