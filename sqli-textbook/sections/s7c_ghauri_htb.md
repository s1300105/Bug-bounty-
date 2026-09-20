## Ghauriと体系的sqlmapコース

SQLインジェクション（SQLi）の自動検出・自動悪用ツールといえば真っ先に名前が挙がるのが sqlmap だが、本節では対照的な2つの資料を扱う。ひとつは sqlmap の「弱点」を突く形で登場した新興ツール **Ghauri**、もうひとつは sqlmap そのものを体系立てて学べる **HTB Academy の「SQLMap Essentials」コース**である。前者は「なぜ手動確認と複数ツールの併用が必要になるのか」を、後者は「sqlmap を実務でどう回すか」を教えてくれる。両者をあわせて読むことで、sqlmap 単体では検出できないケースがあるという事実（＝自動化ツールへの過信の危険性）と、sqlmap を正しく体系的に使いこなす方法の両方が身につく。

### Ghauri ― もう一つのSQLi自動化ツールが生まれた理由

#### 概要と設計思想

[Ghauri](https://github.com/r0oth3x49/ghauri) は Nasir khan（GitHub: r0oth3x49）が開発した、Python 3 製のクロスプラットフォーム対応 SQLi 自動検出・自動悪用ツールである。公式READMEでは次のように紹介されている。

> An advanced cross-platform tool that automates the process of detecting and exploiting SQL injection security flaws.

着目すべきは開発動機の記述である。作者は sqlmap を日常的に使う中で、次のような課題に度々ぶつかったと述べている。

> [I] frequently encountered significant challenges in configuring and using SQLMap.

これは「sqlmap が万能ではない」ことを示す一次情報として重要である。sqlmap は非常に多機能で歴史も長いぶん、オプションの組み合わせ次第で検出ロジックが複雑化し、**デフォルト設定のまま流すだけでは検出できる注入を見逃す**ケースが実際に存在する。特に、リクエストが微妙に整形されている場合（JSON構造の中の1フィールドだけが注入点、ヘッダの値がBase64エンコードされている、レスポンス差分が非常に僅少など）、sqlmap の汎用的なブール条件比較ロジックがノイズに埋もれて false negative（本来脆弱なのに「脆弱ではない」と誤判定すること）を起こしうる。Ghauri はこうした「sqlmap が沈黙してしまう」場面を拾うための**セカンドオピニオン・ツール**として位置づけると理解しやすい。

> 出典: Ghauri (r0oth3x49) — https://github.com/r0oth3x49/ghauri

#### インストール

```bash
git clone https://github.com/r0oth3x49/ghauri.git
cd ghauri
python3 -m pip install --upgrade -r requirements.txt
python3 setup.py install
# もしくは editable install
python3 -m pip install -e .

ghauri --help
```

Python 3 系のみをサポートする点は sqlmap（Python 2/3 双方に対応してきた歴史がある）との違いのひとつで、依存ライブラリの解決やビルド環境がシンプルになる利点がある。

#### 対応するインジェクション手法とDBMS

Ghauri がサポートする検出・悪用手法は次の4種類である。

- **Boolean based**（真偽値ベースのブラインド注入。レスポンスの真偽差分から1ビットずつ情報を推測する）
- **Error Based**（DBMSのエラーメッセージにデータを埋め込ませて直接抽出する）
- **Time Based**（応答遅延の有無から真偽を判定するブラインド注入。ネットワーク越しでレスポンス内容に差が出ない場合の最終手段）
- **Stacked Queries**（`;`区切りで別のSQL文を追加実行させる。DBMSやドライバがマルチステートメントを許可している場合にのみ有効）

対応DBMSは MySQL、Microsoft SQL Server、PostgreSQL、Oracle、そして Microsoft Access（ただし boolean-based blind のみサポート）である。DBMSごとにエラーメッセージのフォーマットや遅延関数（`SLEEP()` / `WAITFOR DELAY` / `pg_sleep()` など）の文法が異なるため、ツール内部ではDBMS別のペイロードテンプレート（fingerprint）を切り替えて注入を試みる仕組みになっている。これは sqlmap の `--dbms` オプションによる挙動とも共通する設計である。

インジェクションの「入り口」としては、GET/POSTパラメータだけでなく、HTTPヘッダ、Cookie、multipart/form-data、JSON、SOAP/XML と幅広くカバーしている。これは近代的なWebアプリ・API（JSON API、SOAPベースの旧来型エンタープライズAPI等）を想定した設計であり、単純なクエリ文字列注入だけを想定したツールとは差別化されている。

#### 代表的なコマンド例

```bash
# 基本的な検出（GETパラメータ id を対象）
ghauri -u "http://www.site.com/vuln.php?id=1" --dbs

# HTTPリクエストファイルを読み込み、バッチモードで並列実行
ghauri -r request.txt --batch --threads 5

# パラメータを明示指定し、技法を BEST（自動最適判定）に、time-basedの遅延を5秒に設定
ghauri -u "http://target/vuln.php?id=1" -p id --technique BEST --time-sec 5

# boolean-basedで現在のユーザー・現在のDBを取得
ghauri -u "http://target/vuln.php?id=1" -b --current-user --current-db

# データベース・テーブルを指定してダンプ
ghauri -u "http://target/vuln.php?id=1" -D database -T table --dump
```

主なオプションは以下の通りで、sqlmap を使ったことがあるならほぼ違和感なく移行できるよう意図的に類似の命名規則が採られている。

| オプション | 意味 |
|---|---|
| `-u, --url` | ターゲットURL |
| `-m` | 複数ターゲットをテキストファイルから一括読み込み |
| `-r` | 生のHTTPリクエストファイルを解析して注入点を推定 |
| `-p` | テスト対象パラメータを明示指定 |
| `--dbms` | 対象DBMSを事前指定（fingerprintingを省略し高速化） |
| `--level` | テストの網羅レベル（1〜3。高いほど多くの注入点候補・ペイロードを試す） |
| `--technique` | 使用する注入技法（デフォルトは `BEST` で自動選択） |
| `--time-sec` | time-based注入で使う遅延秒数（デフォルト5秒） |
| `-D` / `-T` / `-C` | 対象データベース／テーブル／カラムの指定 |
| `--start` / `--stop` | ダンプするレコード範囲の指定 |
| `--count` | テーブルの行数のみ取得 |
| `--proxy` | プロキシ経由でのリクエスト送信（Burp Suite等との連携に使う） |
| `--skip-urlencode` | ペイロードのURLエンコードをスキップ（WAFやサーバのデコード仕様に依存して必要になる場合がある） |
| `--random-agent`, `--mobile` | User-Agentをランダム化／モバイル端末を偽装（WAFのUA判定回避） |
| `--sql-shell` | （実験的）インタラクティブなSQLシェルを取得 |
| `--update` | GitHub上の最新版へ更新 |

`--start`/`--stop` による抽出範囲の限定や、全フェーズの再開（resume）サポートは、大量データのダンプが途中でネットワーク断や検出（WAFによるIPブロック等）で中断した際に、最初からやり直す必要をなくすための実務的な機能である。

#### なぜ「sqlmapで検出できないものが検出できる」のか

これは技術的には主に次の2点に起因すると考えられる。

1. **真偽判定ロジックの違い**: sqlmap は複数のレスポンス比較アルゴリズム（動的な文字列類似度比較、正規表現マッチなど）を持つが、デフォルトのしきい値や比較対象の選び方によっては、微小なレスポンス差分（例: 空白1文字、末尾の改行、動的に変わる広告枠のような「ノイズ」領域）に埋もれて誤判定することがある。Ghauriはブラウザに近い挙動（リダイレクト追従・Cookie保持など）と独自の差分検出アルゴリズムを組み合わせることで、このノイズ耐性を変えている。
2. **リクエスト整形の自動化度合い**: JSON body内のネストしたフィールドや、Base64エンコードされたパラメータへの自動対応など、Ghauriは「実験的機能」として一部のエンコーディング/デシリアライズを自動検出する。sqlmapにも `--tamper` や `-p` の柔軟な指定で同等のことは可能だが、事前に注入点のエンコーディング形式を人間が把握し、明示的に設定する必要がある場面がある。

したがって実務上の教訓は「単一ツールの `Not Injectable` という結果を鵜呑みにしない」ことである。sqlmap で陰性判定が出た注入点に対しては、`--level`/`--risk` を上げた再テスト、手動でのブール条件確認（`' AND '1'='1` vs `' AND '1'='2'` の応答比較）、そしてGhauriのような別実装のツールでのクロスチェックを行う価値がある。

> ⚠️ **利用上の注意（原典より）**: READMEには「Usage of Ghauri for attacking targets without prior mutual consent is illegal.」（事前の相互合意なくターゲットを攻撃するためにGhauriを使用することは違法である）と明記されている。バグバウンティ等で用いる場合もスコープ・ルールオブエンゲージメントの範囲内でのみ使用すること。

> 出典: Ghauri (r0oth3x49/ghauri, GitHub) — https://github.com/r0oth3x49/ghauri （バージョン 1.4.3、MITライセンス、著者 Nasir khan）

### HTB Academy「SQLMap Essentials」― sqlmapを体系的に学ぶ

#### コース概要

[SQLMap Essentials](https://academy.hackthebox.com/course/preview/sqlmap-essentials) は Hack The Box Academy が提供する、難易度「Easy」に分類されるオフェンシブセキュリティ系のモジュールである。作者は stamparm ―— これは sqlmap プロジェクト自体のコア開発者（Miroslav Stampar）であり、公式ツール開発者本人が監修したコースという点で信頼性が高い。前提知識としては Linux コマンドラインの基本操作と情報セキュリティの基礎知識が要求され、推奨される前提モジュールは「Introduction to Networking」「Linux Fundamentals」「Web Requests」である。

コースは座学だけでなく各セクションに実習が付属し、時間制限も採点もない完了ベース（completion-based）で進行する。最後にはスキルアセスメント（総合演習）が用意されている構成である。

> 出典: SQLMap Essentials (HTB Academy) — https://academy.hackthebox.com/course/preview/sqlmap-essentials

#### カリキュラム構成

コースで扱われる主なトピックは以下の通りである。

**基礎編**
- sqlmap の概要とインストール
- SQLインジェクションの種類と、それぞれに適した検出方法
- sqlmap の出力（output）の読み方

**実践編**
- 「Running SQLMap on an HTTP Request」— 生のHTTPリクエストファイルを `-r` オプションで読み込ませて注入をテストする、実務で最も使う実行形態
- エラーハンドリング（誤検出やタイムアウト、WAFによる遮断時の対処）
- 攻撃のカスタマイズとチューニング（`--level` / `--risk` / `--technique` などのパラメータ調整）

**応用編**
- データベース列挙とテーブル・カラムの抽出
- 高度なデータ発見手法
- 認証情報の抽出とパスワードクラッキング（sqlmapが抽出したハッシュを `--passwords` 等で取得し、外部クラッカーに渡すワークフロー）
- 保護機構（WAF等）のバイパス
- ファイルの読み書き（`--file-read` / `--file-write`。DBMSの権限とファイルシステムアクセス権が揃っている場合にOSファイルへ直接アクセスする）
- OSコマンド実行とシステム制御（`--os-shell` 等。SQLiをRCEへエスカレーションする最終段階）

このカリキュラムの並び自体が、実務での攻撃フェーズ（検出 → チューニング → データ抽出 → 権限昇格・RCE）を忠実になぞっている点に注目したい。sqlmapを学ぶ教材は数あるが、「まず検出、次に列挙、最後にOSシェル」という段階を踏むことは、他のあらゆる自動化ツール（Ghauriを含む）を使う際にも共通する思考の型である。

#### sqlmapが対応する6つの注入技法（BEUSTQ）

コースで扱われる中核概念として、sqlmapは伝統的に6種類の注入技法を頭文字で **BEUSTQ** と呼び、`--technique` オプションの値として指定できる。

| 記号 | 技法 | 原理 |
|---|---|---|
| B | Boolean-based blind | 真偽条件をレスポンスの差分（内容・長さ）から判定する |
| E | Error-based | DBMSのエラーメッセージにサブクエリの結果を埋め込ませて抽出する（例: MySQLの`extractvalue()`/`updatexml()`を悪用したXPathエラー） |
| U | UNION query-based | `UNION SELECT` で攻撃者が制御する列をレスポンスに直接混入させる |
| S | Stacked queries | `;` で複数文を連結実行（DBMSドライバがバッチクエリを許容する場合のみ） |
| T | Time-based blind | 応答遅延の有無から真偽を判定する（レスポンス内容に差が出ない場合の最終手段） |
| Q | Inline queries | `SELECT (SELECT ...)` のようにサブクエリを式の一部として埋め込む形。対応DBMSは限定的 |

加えて、DNSやHTTPを介したアウトオブバンド（OOB）型の抽出（DNS exfiltration）にも対応しており、他の5技法がすべて使えない特殊な環境（レスポンスも遅延も一切観測できないが、DBMSからの外部通信だけは許可されている場合）での最終手段として機能する。

対応DBMSはMySQL、PostgreSQL、Oracle、MSSQLをはじめ27種類以上に及び、CockroachDBやApache Igniteのような比較的新しい・特殊なデータベースエンジンにも対応が進んでいる。これはsqlmapが2006年頃から継続的に開発・保守されてきたことの蓄積であり、Ghauriのような新興ツールが対応DBMS数でまだ追いつけていない部分でもある。

#### なぜ体系だったコースで学ぶ価値があるのか

sqlmapは非常にオプション数が多く（`sqlmap --help` の出力だけで100行を超える）、我流で覚えると「とりあえず `--batch --dbs` を打つだけ」といった表面的な使い方に留まりがちである。HTB Academyのコースが評価される理由は、単なるオプション羅列ではなく、

1. **なぜそのフェーズでその技法を選ぶのか**（例: レスポンス長に差が出ないなら boolean-based は使えず time-based に切り替える、といった判断基準）
2. **チューニングの意味**（`--level` を上げると何が増えるのか＝テストするパラメータの種類とペイロードのバリエーションが増える。`--risk` を上げると何が増えるのか＝データ破壊やロックの可能性があるペイロード（例: `OR`ベースの条件でWHERE句全体を無効化するもの）も試すようになる）
3. **検出から侵害の最終段階までの一連の流れ**

を、実際の演習環境を通して手を動かしながら学べる構成にある点にある。これはGhauriのようなツールを併用する際にも活きる知識で、「sqlmapのどのオプションが効かなかったから別ツールを試す」という判断ができるようになる。

### 2つの資料をあわせて読む意義

Ghauriのケースは「最も広く使われ、最も機能豊富な自動化ツールでも、実装依存の理由で検出漏れが起こりうる」という事実を示す一次資料であり、HTB Academyのコースは「その主力ツールを深く体系的に使いこなす」ための教材である。実務・バグバウンティの現場では、まずsqlmapを体系的な理解のもとでチューニングして試し（`--level 5 --risk 3` まで上げる、`-r` でリクエストファイルを正確に再現する、`--tamper` スクリプトでWAF回避を試す等）、それでも陰性判定が出た場合に初めてGhauriのような別実装のツールでクロスチェックする、という順序が合理的である。逆に、両者を並行して漫然と流すだけでは、検出漏れの根本原因（レスポンスのノイズ、エンコーディングの見落とし、WAFのルール）を理解しないまま「ツールが検出しなかったから脆弱性はない」と誤った結論を出すリスクが残る。自動化ツールはあくまで手動確認を補助するものであり、最終的な脆弱性の有無の判断は、実際のレスポンス差分やDBMSの挙動を人間が仕組みレベルで理解した上で下す必要がある。
