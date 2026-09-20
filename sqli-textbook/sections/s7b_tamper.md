## tamperスクリプトとコマンドレシピ

前節までで、sqlmapがどのように注入点を検出し、DBMSごとに異なる技法（UNION、エラーベース、blind、時間ベース、OOB）を使い分けるかを見てきた。しかし実運用の標的には、前段にWAF（Web Application Firewall）が置かれているケースが多い。sqlmapは検出ロジックそのものをWAF回避用に変えることはしないが、**送信前のペイロード文字列を書き換える「フィルタ関数」の集合**を持っており、これが本節の主題である **tamper（タンパー）スクリプト** である。tamperスクリプトは、5章で学んだ「WAFの理解とDBMSの理解のズレ（パーサ差分）」を突く技法を、sqlmapのリクエスト送信パイプラインの中で自動的かつ機械的に適用する仕組みだと言える。

本節では、(1) sqlmap本体に同梱されている組み込みtamperスクリプト群の構造と代表例、(2) 実務で使うsqlmapのコマンドレシピ（level/risk/verbosity等のオプション体系）、(3) 自分専用のtamperスクリプトを一から書く手順、の3つを扱う。

### tamperスクリプトとは何か——sqlmapの処理パイプラインにおける位置づけ

sqlmapは注入点を発見したあと、実際にDBMSへ送るペイロード文字列を組み立てる。tamperスクリプトは、この「ペイロード文字列が完成してからHTTPリクエストとして送信されるまでの間」に挟み込まれ、文字列を書き換える単純な関数である。各スクリプトは基本的に次の3要素からなる。

- `__priority__`: 複数のtamperを同時に使うときの適用順序を決める整数値。
- `dependencies()`: そのtamperが有効に働かないDBMS/条件を宣言し、警告を出す関数（省略可）。
- `tamper(payload, **kwargs)`: 実際にペイロード文字列を受け取り、書き換えて返す関数。これが本体。

sqlmapは`--tamper`オプションで指定されたスクリプト名（カンマ区切り、拡張子なし）を`__priority__`の順に**チェインして**適用する。つまり「あるtamperの出力が次のtamperの入力になる」ため、実行順序が最終的なペイロードの形を大きく左右する。優先度が正しく設定されていないと、あるtamperが挿入したスペースを別のtamperがコメントに置換しそこねる、といった「片方の変換が他方の前提を壊す」不具合が起きる。これがsqlmap側に`PRIORITY`という列挙型が用意されている理由である。

```python
class PRIORITY(object):
    LOWEST = -100
    LOWER = -50
    LOW = -10
    NORMAL = 0
    HIGH = 10
    HIGHER = 50
    HIGHEST = 100
```

> 出典: sqlmapproject/sqlmap — lib/core/enums.py — https://github.com/sqlmapproject/sqlmap/blob/master/lib/core/enums.py

`HIGHEST`に近いtamperほど先に適用される。たとえば「`=`を`LIKE`に置換する」ような構文の根本を変えるtamperは早い段階（HIGHESTに近い優先度）で走らせ、「スペースをコメントに変える」ような表層的な整形は後段で走らせる、といった設計思想がsqlmap本体の組み込みスクリプト群に一貫して見られる。

### 組み込みtamperディレクトリの全体像

sqlmapのソースツリーの`tamper/`ディレクトリには、2026年9月時点で130本前後のPythonスクリプトが収録されている。すべて1ファイル1変換という単純な構造で、目的別に大きく次のように分類できる。

> 出典: sqlmapproject/sqlmap — tamper ディレクトリ — https://github.com/sqlmapproject/sqlmap/tree/master/tamper

**エンコーディング/難読化系**
- `base64encode.py`、`charencode.py`（URLエンコード）、`chardoubleencode.py`（二重URLエンコード）
- `htmlencode.py`、`hexentities.py`、`decentities.py`（HTML実体参照への変換）
- `overlongutf8.py`（UTF-8のオーバーロング表現を使った不正だが一部パーサが受理するエンコーディング）、`charunicodeencode.py`（Unicodeフルワイド文字によるエンコード）

**SQL構文の等価書き換え系**
- `between.py`（比較演算子をBETWEENに書き換え）、`greatest.py`/`least.py`（`>`/`<`を関数呼び出しに置換）
- `space2comment.py`、`space2plus.py`（空白文字の別表現への置換）
- `plus2concat.py`、`concat2concatws.py`（文字列結合表現の書き換え）
- `if2case.py`、`ifnull2casewhenisnull.py`（条件分岐構文の等価変換）

**UNIONベース注入向け**
- `unionalltounion.py`（`UNION ALL`を`UNION`に）、`unionvalues.py`、`uniontable.py`
- `0eunion.py`、`misunion.py`、`dunion.py`（UNIONキーワード自体の分断・偽装）

**DBMS固有の文法を突くもの**
- `mssqlnosemicolon.py`（MSSQLでのセミコロン省略）、`oraclequote.py`（Oracle固有のクォート処理）
- `sleep2getlock.py`、`sleep2hex.py`（時間ベース技法の代替関数への置換）

**WAF/フィルタ回避に特化したもの**
- `versionedkeywords.py`、`modsecurityversioned.py`（MySQLのバージョンコメント`/*!50000...*/`を使い、ModSecurityなど特定WAFの既知の弱点を突く）
- `randomcase.py`、`randomcomments.py`（大文字小文字やコメント挿入をランダム化し、固定文字列シグネチャを崩す）

これらはいずれも「DBMSのパーサが受理する構文的に等価な別表現」に変換するという1点で共通している。ここが5章で述べた原理の実装そのものである。WAFのシグネチャは特定の文字列パターン（例:`union select`という連続文字列や、大文字小文字を区別しない`SLEEP(`という呼び出し）を検知するよう作られているが、DBMSのパーサはより寛容な文法を受理する。tamperスクリプトは、この「受理範囲の差分」に該当する具体的な変換規則を1つずつコード化したものである。

### 代表的なtamperスクリプトの実装を読む

抽象的な説明だけでは実感がわきにくいので、実際のソースコードの要点を確認する。

#### `between.py` — 比較演算子の等価書き換え

`>`（大なり）と`=`（等号）をそれぞれ`NOT BETWEEN 0 AND #`と`BETWEEN # AND #`に置き換える。

```
入力: 1 AND A > B--
出力: 1 AND A NOT BETWEEN 0 AND B--

入力: 1 AND A = B--
出力: 1 AND A BETWEEN B AND B--
```

**なぜ機能するのか**: `BETWEEN x AND y`はSQL標準で「x以上y以下」を意味する。`A NOT BETWEEN 0 AND B`は「Aが0からBの範囲に**含まれない**」ことを意味し、Aが正の値である一般的な文脈では実質的に`A > B`と同じ真偽値を返す。WAFのシグネチャは`>`という1文字、あるいは`select.*from`のような定型パターンを狙って書かれていることが多く、`BETWEEN`構文自体は業務アプリケーションのSQLにも普通に登場するため、シグネチャに組み込みにくい。つまりtamperは「危険な記号」を「一見無害な、しかし数学的に等価な構文」に変換することでシグネチャの網の目を抜ける。優先度は`HIGHEST`に近い値が設定されており、これは後段のスペース変換などが働く前に、比較演算子という構文の根本部分を先に書き換えておく必要があるためである。

> 出典: sqlmapproject/sqlmap — tamper/between.py — https://github.com/sqlmapproject/sqlmap/blob/master/tamper/between.py

#### `space2comment.py` — 空白のコメント化

ペイロード中の空白文字（クォートで囲まれた文字列の内部は除く）を`/**/`というインラインコメントに置換する。

```
入力: SELECT id FROM users
出力: SELECT/**/id/**/FROM/**/users
```

**なぜ機能するのか**: MySQLの字句解析器（レキサ、トークンを切り出す処理系）は、`/* ... */`をコメントとして読み飛ばし、トークンとトークンの区切りとして扱う。つまり字句解析のレベルでは、スペース1個と`/**/`は「トークン境界」という意味で等価である。一方でWAFの多くは、リクエスト文字列に対して`\s+`（1個以上の空白）を検出条件の一部にしたシグネチャ（例:`union\s+select`）を用いており、スペースが1個もない文字列にはマッチしない。スクリプトはクォート状態を1文字ずつ追跡しながら、文字列リテラルの内部にあるスペースまでコメント化してしまわないよう分岐している——これを誤ると、書き換え後のペイロードが元のSQL文と異なる意味になってしまう（クエリの破壊）。

> 出典: sqlmapproject/sqlmap — tamper/space2comment.py — https://github.com/sqlmapproject/sqlmap/blob/master/tamper/space2comment.py

#### `randomcase.py` — キーワードの大文字小文字ランダム化

`INSERT`→`InSeRt`、`SELECT id FROM user`→`SeLeCt id FrOm user`のように、SQLキーワードだけを狙って大文字小文字をランダムに入れ替える。

**なぜ機能するのか**: 標準SQLでは予約語の大文字小文字は意味を持たない（`SELECT`と`select`と`SeLeCt`は文法上まったく同じトークンとして解釈される）。しかしシグネチャベースのWAFの中には、大文字小文字を正規化せずに固定文字列またはケースセンシティブな正規表現で照合している実装が存在する（記述時点でも「作りの甘いWAF」向けと明記されている点に注意)。スクリプトは2文字以上の単語をsqlmap内蔵のキーワード辞書と照合し、識別子（バッククォートやクォート、角括弧で囲まれた部分）や関数呼び出しの引数部分を除外したうえでランダム化する。また「全部小文字」「全部大文字」のいずれとも異なる結果になるよう保証している——これは、たまたまランダム化の結果が元の大文字小文字パターンと一致してしまい、意味のある書き換えにならない事故を防ぐためである。

> 出典: sqlmapproject/sqlmap — tamper/randomcase.py — https://github.com/sqlmapproject/sqlmap/blob/master/tamper/randomcase.py

#### `equaltolike.py` — 等号のLIKE置換とDBMS依存の落とし穴

`=`を`LIKE`に置換する。`id=1`は`id LIKE 1`になる。

```python
# 概念的な正規表現（クエリ内の裸の等号のみにマッチし、>=, <=, != などの複合演算子は除外する）
retVal = re.sub(r"\s*(?<![<>!=])=(?!=)\s*", " LIKE ", payload)
```

**なぜ機能するのか、そしてなぜ常に使えるわけではないのか**: MySQL、MariaDB、SQLite、SQL Server、Oracleは、数値と`LIKE`比較を行うときに暗黙の型変換（数値を文字列化してからパターンマッチ）を行うため、ワイルドカードを含まない`LIKE`はほぼ`=`と同じ結果になる。しかしPostgreSQLは数値型オペランドに対して`LIKE`演算子自体を定義しておらず、`1 LIKE 1`のような式はエラー（`operator does not exist: integer ~~ integer`）になる。この事実は、tamperスクリプトが「あるDBMSでは万能に見える変換でも、別のDBMSでは通用しない」ことを示す典型例であり、`dependencies()`関数の役割——特定DBMS環境では警告を出す、あるいは適用しない——が実務上なぜ必要なのかを裏付けている。優先度は`HIGHEST`で、`=`という記号自体を構文レベルで置き換えるため、他の表層的な変換より先に実行する必要がある。

> 出典: sqlmapproject/sqlmap — tamper/equaltolike.py — https://github.com/sqlmapproject/sqlmap/blob/master/tamper/equaltolike.py

### コマンドレシピ——実務でよく使うsqlmapオプションの構造

> 出典: Cybr — SQLMap Cheat Sheets to Help You Find SQL Injections — https://cybr.com/ethical-hacking-archives/sqlmap-cheat-sheets-to-help-you-find-sql-injections/

#### tamperの指定方法

`--tamper`にはカンマ区切りでスクリプト名（拡張子なし）を複数渡せる。

```bash
sqlmap -u 'http://target/vuln.php?id=1' --tamper="between,randomcase"
```

```bash
sqlmap -u 'http://target/vuln.php?id=1' \
  --tamper="random,appendnullbyte,between,base64encode"
```

複数指定時は前述の`__priority__`順（数値が大きいほど先）に適用されるため、コマンドラインに書いた順序ではなく、各スクリプトの優先度が実際の適用順を決める点に注意する。利用可能な全tamperの一覧と説明は次のコマンドで確認できる。

```bash
sqlmap --list-tampers
```

#### `--level`と`--risk`——テストの網羅性と侵襲性を分けて制御する

sqlmapは「どこを、どれだけ試すか」を`--level`（テスト対象の広さ・パラメータ種別）と`--risk`（1回1回のペイロードがどれだけDBMSに負荷や副作用を与えうるか）という**独立した2軸**で制御する。この分離を理解していないと、「時間がかかりすぎる」「標的DBを壊しかねない」といった事故につながる。

| level | 対象と目安リクエスト数 |
|---|---|
| 1（既定） | GET/POSTパラメータのみ（目安 約100リクエスト） |
| 2 | Cookieヘッダーも対象に追加（100〜200リクエスト） |
| 3 | User-Agent・Refererヘッダーも対象に追加（200〜500リクエスト） |
| 4 | 技法固有の追加ペイロード（500〜1,000リクエスト） |
| 5 | Hostヘッダー等を含む最大範囲の検査（1,000リクエスト超） |

| risk | 特性 |
|---|---|
| 1（既定） | 非破壊的なペイロードのみ |
| 2 | 時間ベース（`SLEEP`等）の重いクエリを含む。標的DBの応答を一時的に遅延させうる |
| 3 | OR条件を使うペイロードを含む。`WHERE`句の意味が変わりデータの更新・削除に波及しうる |

**なぜこの分離が必要なのか**: `--level`は「どこまで広く注入点候補を試すか」というリクエストの網羅性の問題であり、`--risk`は「1つの注入点候補に対してどれだけ攻撃的な（=システムに影響を与えうる）ペイロードを試すか」という侵襲性の問題である。この2つは独立にスケールする——広く浅く（level高・risk低）試したいケースと、狭く深く（level低・risk高）試したいケースの両方があるため、1つのパラメータに統合せず直交する軸として設計されている。実務、特にバグバウンティのように「本番環境に対して許可された範囲でしか試験できない」文脈では、`--risk`を既定の1から不用意に上げないことが重要になる。

```bash
sqlmap -u 'http://localhost:8440/' --level=2
sqlmap -u 'http://localhost:8440/' --level=2 --cookie="PHPSESSID=..." --param-exclude="PHPSESSID"
sqlmap -u 'http://localhost:8440/' --level=2 --skip="cookies"
sqlmap -u 'http://localhost:8440/' --level=2 -p "id"
```

`--param-exclude`は特定パラメータ（ここではセッションCookie）を検査対象から除外し、`--skip`はヘッダー種別ごと除外、`-p`は逆に検査対象を1つのパラメータに絞り込む。特にセッションCookieは、注入テストの過程で不正な値を送り続けるとセッションが切れて以降のリクエストが認証エラーになる、という事故が起きやすいため、除外オプションの使い分けは実務上重要である。

#### 詳細度（`-v`）とデバッグ

```bash
sqlmap -u 'http://target/vuln.php?id=1' -v 4
```

| レベル | 内容 |
|---|---|
| 0 | 致命的メッセージのみ |
| 1（既定） | 情報・警告 |
| 2 | デバッグメッセージ |
| 3 | 実際に注入したペイロード |
| 4 | 送信したHTTPリクエスト全体 |
| 5 | 受信したHTTPレスポンスヘッダー |
| 6 | 受信したHTTPレスポンス本文全体 |

tamperスクリプトを自作・チェインしているときは、`-v 3`または`-v 4`で「変換後に実際に送られたペイロード文字列」を目視確認するのが最も確実なデバッグ手段になる。tamperの適用順序を誤ると、期待した最終形にならないことがあるため、複数tamperを組み合わせた際は必ずこのオプションで実際の送信内容を確認する習慣をつけるとよい。

#### sqlmapのディレクトリ構成（tamperの位置づけの全体像）

| パス | 役割 |
|---|---|
| `tamper/` | 本節で扱うWAF回避スクリプト群 |
| `data/txt/` | よく使われるカラム名・テーブル名の辞書、User-Agent一覧などのワードリスト |
| `data/xml/payloads/` | DBMS別・技法別のペイロードテンプレート（XML定義） |
| `sqlmap.conf` | 既定オプションを定義する設定ファイル |
| `output/` | 実行結果の保存先 |
| `history/` | 過去の実行履歴を記録するSQLiteデータベース |

`tamper/`はこの中で唯一「ペイロードを検出後に加工する」段階を担うディレクトリであり、`data/xml/payloads/`（どんなペイロードを試すか）とは役割が異なることに注意する。tamperは「試すペイロードの内容」ではなく「送信直前の文字列表現」を変えるレイヤーである。

### 自作tamperスクリプトを書く

> ⚠️ **未取得の資料**: 「How to Create Your Own SQLMap Tamper Scripts — Step-by-step guide」（nav1n, Medium）は自動取得できませんでした（理由: `medium.com`および著者サブドメイン`nav1n.medium.com`のいずれもHTTP 403 Forbiddenを返し、検索エンジンのキャッシュ経由でも本文を取得できなかったため）。以下のURLからご自身で直接ご覧ください: https://medium.com/@nav1n/how-to-create-your-own-sqlmap-tamper-scripts-step-by-step-guide-5dd3c299c210

（以下は未取得資料の補足として一般知識に基づく解説です。検索エンジンの要約と、sqlmap公式リポジトリの`tamper/`配下にある大量の実例コードから確認できる共通構造を根拠にしている。）

組み込みのtamperスクリプトはすべて共通のテンプレートに従っており、自作する際もこれに倣えばsqlmapのtamperローダーが自動的に認識してくれる。最小構成は次のようになる。

```python
#!/usr/bin/env python
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

def dependencies():
    # 特定DBMS専用、あるいは他tamperと併用不可、といった制約があれば
    # ここでロガーに警告を出す。制約がなければ空実装でよい。
    pass

def tamper(payload, **kwargs):
    """
    この関数のdocstringが --list-tampers の説明文として表示される。

    >>> tamper("1 AND 1=1")
    '<変換後の文字列>'
    """
    if payload:
        # payload文字列を書き換えるロジックをここに書く
        payload = payload.replace("SELECT", "SEL/**/ECT")
    return payload
```

**各要素が必要な理由**:

- `tamper(payload, **kwargs)`という**関数名・引数名**は固定である。sqlmapのtamperローダーはこのシグネチャに一致する関数をモジュールから探して呼び出すため、名前を変えると認識されない。`**kwargs`には、そのリクエストのinjection情報（DBMSの種類など）が渡されることがあり、`dependencies()`と同様にDBMS依存の分岐に使える。
- `__priority__`を明示しないと既定の`PRIORITY.NORMAL`（0）扱いになる。自作スクリプトを既存のtamperと組み合わせる場合、「自分のスクリプトが他のスクリプトの変換結果を壊さない順序」になるよう、意図的に優先度を設定する必要がある。たとえば「等号をLIKEに変える」ような構文の根本変換を書くなら`HIGHEST`寄りに、「スペースを別表現にする」ような表層変換を書くなら低めに設定するのが、組み込みスクリプト群の慣習と整合する。
- docstringは単なるコメントではなく、`--list-tampers`の出力や`--tamper`使用時のログに表示される実用的なドキュメントとして扱われる。doctest形式（`>>> tamper(...)`という行）で入出力例を書いておくと、他の開発者（および将来の自分）がスクリプトの意図を素早く把握できる。

**配置と実行手順**:

1. 上記テンプレートを元に`myfilter.py`のようなファイル名で保存する。
2. sqlmapのインストールディレクトリ直下の`tamper/`フォルダ（Kali Linuxの既定パッケージでは`/usr/share/sqlmap/tamper/`、pipやgit cloneで導入した場合はリポジトリ直下の`tamper/`）に配置する。
3. `--tamper=myfilter`のようにファイル名（拡張子なし）を指定して実行する。

```bash
sqlmap -u 'http://target/vuln.php?id=1' --tamper=myfilter -v 3
```

4. `-v 3`（実際に注入したペイロード）または`-v 4`（送信HTTPリクエスト全体）で、書き換え後の文字列が意図通りかを確認しながら反復開発する。

**設計上の注意点（一般的なベストプラクティス）**:

- 変換は**可逆的にDBMSが解釈できる範囲**にとどめること。たとえばクォートの数を変えたり、コメントの開始だけ挿入して閉じ忘れたりすると、ペイロード自体が構文エラーになり、注入が成立しているのに「脆弱ではない」という誤った結果をsqlmapが出してしまう。
- 文字列リテラル内部（クォートで囲まれた部分）を誤って書き換えないよう、状態（現在クォートの中かどうか)を1文字ずつ追跡する実装が組み込みスクリプトの定石になっている（`space2comment.py`の実装がまさにこのパターン）。
- 1つのtamperスクリプトには1つの変換規則だけを持たせ、複数の変換を組み合わせたい場合は`--tamper`でチェインする、という「単一責任」の設計が組み込みスクリプト群全体の慣習である。これにより優先度による順序制御が意味を持つ。

### まとめ

tamperスクリプトは、WAFのシグネチャベース検知とDBMSパーサの受理範囲との間にある差分を、「1変換=1スクリプト」という単位でコード化し、`--tamper`オプションを通じてsqlmapの送信パイプラインに機械的に組み込む仕組みである。組み込みスクリプトを読むと、優先度設計・クォート境界の追跡・DBMS依存性の明示という3点が繰り返し現れる共通パターンであることが分かる。実務では、まず`--list-tampers`で候補を確認し、`-v 3`/`-v 4`で実際の送信内容を検証しながら組み合わせを絞り込み、それでも回避できない独自のWAFロジックに対しては、本節のテンプレートに従って自作スクリプトを書くのが定石である。
