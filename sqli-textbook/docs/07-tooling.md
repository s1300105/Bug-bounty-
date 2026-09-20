# 第7章 ツール習熟（sqlmap・Ghauri・手動vs自動）

## sqlmapの中核（Usage・Techniques・FAQ）

### この節で扱うこと

sqlmapは「SQLインジェクションの検出と悪用を自動化するオープンソースの侵入テストツール」であり、単なるペイロード投げ機ではない。内部には、(1) 対象パラメータへのヒューリスティック判定、(2) `--level`/`--risk`で制御されるテストの網羅度、(3) 6種類のインジェクション技法（B/E/U/S/T/Q）ごとの検出・抽出アルゴリズム、(4) DBMS固有の列挙・ファイルアクセス・OSコマンド実行エンジン、という階層構造がある。この節では sqlmap 公式wikiの **Usage**（フラグ・スイッチの全体像）、**Techniques**（各インジェクション技法がどう自動化されるか）、**FAQ**（tamperスクリプトの誤用を戒める公式スタンスなど）の3資料を基に、「なぜそのオプションでその挙動になるのか」という仕組みのレベルまで掘り下げる。

対象バージョンについて注記しておく。sqlmapはGit HEADを追随する形で頻繁に更新されるローリングリリースのツールであり、`--timeless`（HTTP/2 timeless timing攻撃）、`--openapi`系オプション、GraphQL/LDAP/XPath/SSTI/XXE/HQL対応などは比較的新しく追加された機能である。本節の記述は2026年時点のsqlmap wiki（GitHub: `sqlmapproject/sqlmap`）の内容に基づく。Python 2.7と3.xの両方が2019年5月以降サポートされている。

---

### 1. Usage — オプション体系の全体像

> 出典: Usage — https://github.com/sqlmapproject/sqlmap/wiki/Usage

sqlmapのコマンドラインオプションは機能ごとに大きなセクションへ分類されている。この分類自体が「sqlmapが内部でどういうフェーズを踏んで動くか」を映しており、単なる暗記対象ではなく実行フローの理解に直結する。

#### 1.1 Target（対象指定） — 「何を」攻撃するか

最低1つの指定が必須。

```bash
# 単一URL、GETパラメータを対象
python sqlmap.py -u "http://www.site.com/vuln.php?id=1"

# 生のHTTPリクエストファイルから読み込む（Burpの「Copy to file」など）
python sqlmap.py -r request.txt

# 直接DB接続文字列（アプリを経由せず、DB資格情報を握っている場合のポストエクスプロイト用途）
python sqlmap.py -d "mysql://user:pass@127.0.0.1:3306/testdb"
```

- `-u/--url`: URL指定。GETパラメータがある場合、`?`以降がそのままテスト対象になる。
- `-d`: **DB接続文字列**による直接接続。これはWebアプリのSQLi脆弱性を探すのではなく、既に得たDB資格情報を使って列挙・コマンド実行まで一気に進める「ポストエクスプロイト」用途。インジェクション検証フェーズを丸ごとスキップできる。
- `-l`: Burp/WebScarabのプロキシログから対象を抽出。プロキシで巡回したトラフィックをそのままsqlmapに食わせられる。
- `-m`: 複数ターゲットをテキストファイルから一括スキャン。
- `-r`: HTTPリクエストファイルからの読み込み。POSTボディ、Cookie、独自ヘッダなど、URLだけでは表現できない複雑なリクエストを正確に再現できるため、実務では`-u`より`-r`が多用される。
- `-g`: Googleドークの検索結果をターゲットリストとして処理。
- `--openapi` / `--openapi-base` / `--openapi-tags`: OpenAPI/Swagger定義からターゲット（エンドポイント×パラメータの組）を機械的に導出する。API群を手動で1本ずつ`-u`指定する手間を省ける。

**なぜ`-r`が推奨されるのか**: HTTPプロトコル上、GETのクエリ文字列だけでは表現できない「どのヘッダにどんな値が乗っているか」「POSTボディのエンコーディングは何か」といった情報が、注入点の推測精度と誤検知率に直結する。sqlmapの検出エンジンはHTTPレスポンスの差分比較（後述のBoolean-basedの原理）に依存するため、リクエストの再現性が低いと差分比較自体が汚染され、誤検知・見逃しの両方が増える。

#### 1.2 Request（HTTP通信の制御）

- `--data`: POSTボディを指定（暗黙的にHTTPメソッドをPOSTへ変更）。
- `--cookie` / `--cookie-del`: Cookieヘッダの値とその区切り文字（デフォルト`;`）。
- `--random-agent` / `-A/--user-agent`: User-Agentの制御。**FAQで明言されている通り、sqlmapのデフォルトUser-Agent（`sqlmap/x.x-dev`など）はWAF/IPSのシグネチャに引っかかりやすいため、`--random-agent`は実務上ほぼ必須**。
- `--auth-type` / `--auth-cred` / `--auth-file`: Basic/Digest/Bearer認証や証明書ベース認証。
- `--proxy` / `--proxy-cred` / `--proxy-file` / `--tor`: プロキシおよびTor経由での通信。
- `--delay`: リクエスト間隔（秒）。レート制限やWAFのしきい値型検知を回避する目的で使う。
- `--timeout`（デフォルト30秒）/ `--retries`（デフォルト3回）: 接続タイムアウトと再試行回数。
- `--csrf-token` / `--csrf-url` / `--csrf-method` / `--csrf-data` / `--csrf-retries`: アンチCSRFトークンを自動的に事前取得し、各リクエストに埋め込み直す機構。CSRFトークンが毎回変わるアプリでもsqlmapのステートフルなインジェクション試行を継続できる。
- `--chunked`: HTTPチャンク転送エンコーディングの使用。
- `--hpp`: HTTP Parameter Pollution（同名パラメータを複数指定する手法）を使ったインジェクション。WAFが単純な単一パラメータ値だけを検査している場合に、パラメータを分割することでフィルタを迂回しつつバックエンドには結合された値として解釈させる狙いがある。

```bash
# POSTデータ + Cookie + User-Agentランダム化 + プロキシ経由
python sqlmap.py -u "http://target.com/login" \
  --data="user=admin&pass=test" \
  --cookie="PHPSESSID=abc123" \
  --random-agent \
  --proxy="http://127.0.0.1:8080"
```

#### 1.3 Optimization（性能最適化）

- `-o`: 主要な最適化スイッチを一括有効化。
- `--null-connection`: レスポンスボディ全体を取得せず、Content-Lengthなどからページ長だけを取得して比較する。ネットワーク帯域を節約しつつBoolean-based判定を高速化する。
- `--threads`（デフォルト1、最大10）: 並列HTTPリクエスト数。特にBoolean-based/Time-basedの文字ごとの二分探索や、ブルートフォース系オプションで効果が大きい。
- `--no-keep-alive`: 持続的接続を無効化（環境によってはKeep-Aliveがかえって不安定要因になる場合の回避策）。

**なぜスレッド数がBlind系技法で効くのか**: Blind系（Boolean-based/Time-based）は「1文字を確定するのに約7回のHTTPリクエストが必要」という後述の二分探索アルゴリズムに支配されており、文字列全体の抽出にはリクエスト数が線形に近い形で積み上がる。スレッド並列化はこの逐次待機時間を隠蔽できるため、実務上の体感速度に直結する。ただしTime-basedは応答時間そのものが測定対象なので、過度な並列化はネットワーク輻輳による誤測定を招くリスクがある点に注意。

#### 1.4 Injection（注入点とペイロード整形の制御）

- `-p`: テスト対象パラメータを明示指定（指定しない場合は自動的にすべてのパラメータを試行）。
- `--skip` / `--skip-static`: 除外パラメータ、または値が変化しない（動的でない）パラメータのスキップ。
- `--dbms`: バックエンドDBMSを強制指定（MySQL, PostgreSQL, Oracle, Microsoft SQL Serverなど）。ヒューリスティックなfingerprint段階をスキップして、そのDBMS向けの構文だけを試すため高速化できる。
- `--os`: バックエンドOSを強制指定。
- `--prefix` / `--suffix`: 注入ペイロードの前後に付与する文字列。既存クエリの構文を壊さずに割り込むための「型抜き」を手動で与える。

```bash
# クエリが ('...') のような文脈にある場合の手動プレフィックス/サフィックス指定
python sqlmap.py -u "http://target.com/page" -p id \
  --prefix="')" --suffix="AND ('a'='a"
```

  この例が示す原理は重要である。仮にバックエンドのSQL文が `SELECT * FROM t WHERE (col='$id')` のような形をしていると、素朴な `id=1' OR '1'='1` ペイロードでは括弧の数が合わず構文エラーになる。`--prefix="')"` で「まず閉じ括弧とクォートを閉じる」ことで元の文の構文的整合性を先に回復し、`--suffix="AND ('a'='a"` で「後続の閉じ括弧」を自分たちのペイロードの後ろに配置し直すことで、注入した部分文だけが有効なSQL断片として挿入される。sqlmapはこの`--prefix`/`--suffix`を全ペイロードに機械的に前後結合するため、通常の自動テストでは検出できない複雑なネスト構造にも対応できる。

- `--tamper`: WAF/IPSやフィルタ回避のための「tamperスクリプト」（後述FAQで詳説）。
- `--invalid-bignum` / `--invalid-logical` / `--invalid-string`: 意図的に不正な値を注入してページの差分挙動を引き出す際の「不正値」の生成方式を切り替える（巨大数、論理演算、ランダム文字列）。
- `--no-cast` / `--no-escape`: ペイロードのキャスト処理・エスケープ処理を無効化する。ペイロードを短縮できるがDBMS固有の型変換前提が崩れるため、期待通り動かないケースもある。

```bash
# tamperスクリプトの併用例（大文字小文字のランダム化 + キーワード分割）
python sqlmap.py -u "http://target.com/page?id=1" --tamper="between,randomcase"
```

#### 1.5 Detection（検出の網羅度と判定基準）

- `--level`（1〜5、デフォルト1）/ `--risk`（1〜3、デフォルト1）: **levelはテストするペイロードの種類と数、riskはペイロードが対象に与える潜在的な副作用（データ破壊などのリスク）の大きさ**を制御する2軸。level 1は基本的なテストのみ、level 5では非常に多くのペイロードパターン（Cookie/Refererなど追加のテスト対象ヘッダも含む）を網羅的に試す。riskを上げるとOR系のペイロードなどWHERE句全体を書き換えてデータ変更・削除につながりうるテストも実行対象になる。**本番環境で不用意に`--risk`を上げるのは実務上避けるべき**というのが暗黙の前提である。
- `--string` / `--not-string` / `--regexp` / `--code`: TrueページとFalseページを識別するための比較基準を手動指定。デフォルトの自動ページ比較（後述）が効かない、あるいは不安定な場合に使う。
- `--text-only` / `--titles`: HTMLタグやスクリプトを除去してテキスト内容だけで比較する、あるいはページタイトルだけで比較する。動的広告やタイムスタンプなど「本質的でない差分」がノイズになってBoolean判定が安定しない場合に有効。
- `--smart`: ポジティブなヒューリスティック判定が出た場合にのみ、時間のかかる網羅的テストへ進む。全パラメータへの総当たりを避け、スキャン全体の時間を短縮する。

#### 1.6 Techniques（技法の選択とチューニング）

- `--technique`（デフォルト`"BEUSTQ"`）: 使用する注入技法の絞り込み。文字がそのまま Boolean/Error/Union/Stacked/Time/inline(Q) の頭文字に対応する。
- `--time-sec`（デフォルト5秒）: Time-basedの遅延秒数。ネットワーク遅延と区別できる十分な秒数が必要。
- `--timeless`: HTTP/2環境でのtimeless timing攻撃（後述Techniques節で詳説）。
- `--union-cols` / `--union-char` / `--union-from` / `--union-values`: UNIONクエリの列数探索範囲、列数ブルートフォースに使う識別文字、FROM句に補うダミーテーブル名、注入する列値。
- `--dns-domain`: DNS経由のデータ外部送出（out-of-band）攻撃用ドメイン。
- `--graphql` / `--ldap` / `--nosql` / `--xpath` / `--ssti` / `--xxe` / `--hql`: SQL以外の注入系エンジンの明示的な有効化スイッチ。

```bash
# Boolean-basedとTime-basedのみに絞り、時間ベースの待機を10秒に延長
python sqlmap.py -u "http://target.com/page?id=1" --technique=BT --time-sec=10
```

#### 1.7 Fingerprint / Enumeration（DBMS判定とデータ抽出）

- `-f/--fingerprint`: DBMSバージョンの詳細指紋取得。
- `-a/--all`: すべての列挙処理を一括実行。
- `-b/--banner`, `--current-user`, `--current-db`, `--hostname`, `--is-dba`: 基礎情報の取得。
- `--users` / `--passwords` / `--privileges` / `--roles`: ユーザー、パスワードハッシュ、権限、ロールの列挙。
- `--dbs` / `--tables` / `--columns` / `--schema`: データベース・テーブル・カラム・スキーマ構造の列挙。
- `--dump` / `--dump-all`: テーブル内容の抽出。`-D`/`-T`/`-C`で対象DB/テーブル/カラムを絞り込み、`--where`でWHERE条件、`--start`/`--stop`/`--first`/`--last`で抽出範囲を制御できる。
- `--sql-query` / `--sql-shell` / `--sql-file`: 任意SQL文の実行、対話的SQLシェル、SQLファイルからの一括実行。

```bash
# 特定DB・テーブルの特定カラムだけを条件付きでダンプ
python sqlmap.py -u "http://target.com/page?id=1" \
  -D appdb -T users -C username,password \
  --where="role='admin'" --dump
```

  **なぜパスワードハッシュだけ取得できないケースがあるのか**（FAQでも触れられる論点）: 列挙処理はすべて「現在のセッションユーザーの権限」で実行されるSQLクエリに依存する。`mysql.user`や`pg_shadow`のようなシステムカタログはDBMS側で読み取り権限が制限されていることが多く、アプリケーションが使うDBアカウントが最小権限で運用されていれば、sqlmapがどれだけペイロードを工夫してもハッシュ列には到達できない。これはsqlmapの不具合ではなく、対象DBの権限設計そのものの結果である。

#### 1.8 File system / OS / Windows Registry（ポストエクスプロイト）

- `--file-read` / `--file-write` / `--file-dest`: DBMSファイルシステムの読み書き。MySQLの`LOAD_FILE()`/`INTO OUTFILE`、MSSQLの`OPENROWSET(BULK...)`、PostgreSQLの大きなオブジェクト機構などDBMS固有の機能を裏で使い分ける。
- `--os-cmd` / `--os-shell`: OSコマンドの単発実行、対話的OSシェル。stacked queriesが使えるDBMS（MSSQL, PostgreSQLなど）ではUDF（User-Defined Function、ユーザー定義関数）やストアドプロシージャ経由でOSコマンド実行にまで到達できる。
- `--os-pwn` / `--os-smbrelay`: Metasploitと連携したMeterpreter/VNCシェルの取得。
- `--udf-inject` / `--shared-lib`: 任意共有ライブラリをUDFとしてDBMSにロードし、SQL関数経由で任意コード実行に到達する手法。
- `--reg-read` / `--reg-add` / `--reg-del`: Windowsレジストリの読み書き削除（MSSQL拡張ストアドプロシージャ経由）。

これらはいずれも「SQLインジェクション自体」の話ではなく、**stacked queriesまたはDBMSの管理者権限を前提としたポストエクスプロイト機能**である点を強調しておく。Web経由のSQLiが常にstacked queriesに対応しているとは限らず（後述Techniques節参照）、対応の可否とDB側の権限次第でここまで到達できるかが決まる。

#### 1.9 General / Miscellaneous（運用上重要なオプション）

- `--batch`: すべての確認プロンプトにデフォルト回答で自動応答する非対話モード。CI/CDやスクリプト化に必須。
- `--flush-session`: キャッシュされたセッション情報（既知の注入点・技法など）をクリアして再検出させる。対象アプリが変化した場合や誤検知したセッションを破棄したい場合に使う。
- `--crawl`: 対象URLを起点にサイトをクロールし、発見したリンクをすべてテスト対象にする。
- `--dump-format`（CSV, HTML, SQLITE, JSONL）: ダンプ出力形式。
- `--skip-waf`: WAF/IPS存在検出そのものをスキップする。
- `-z`: 短縮記法（mnemonics）を使ってワンライナーでオプションを羅列できる（例: `flu,bat,ban`）。
- `--gui` / `--tui` / `--shell` / `--wizard`: それぞれTkinter GUI、ncurses TUI、対話的sqlmapシェル、初心者向けウィザードモード。

> 出典: Usage — https://github.com/sqlmapproject/sqlmap/wiki/Usage

---

### 2. Techniques — 6つの注入技法はどう自動化されているか

> 出典: Techniques — https://github.com/sqlmapproject/sqlmap/wiki/Techniques

sqlmapは6種類のSQLインジェクション技法を検出・悪用できる。`--technique`の頭文字（B/E/U/S/T/Q）はここに対応する。原理を理解すると、なぜ`--level`/`--risk`を上げても検出できないケースがあるか、なぜ特定の技法だけ`--technique`で明示的に絞る意味があるかが分かる。

#### 2.1 Boolean-based blind（B）— 真偽値の差分から1文字ずつ推測する

対象パラメータに構文的に妥当なSQL文（`SELECT`のサブ文など）を挿入し、**各HTTPレスポンス（ヘッダ・ボディ）を元のリクエストと比較する**ことで、注入した文の出力を1文字ずつ推測する。ユーザーが「Trueのときに現れる文字列/正規表現」を`--string`/`--regexp`で明示的に指定することも可能。

**核心は二分探索(bisection)アルゴリズム**である。sqlmapはASCIIの1文字を約7回のHTTPリクエストで確定させる。これは典型的なASCII印字可能文字の範囲（約128通り）を`SUBSTRING(output,N,1) > CHAR(X)`のような不等号判定で二分していくと `log2(128) ≈ 7` 回で1点に絞り込める、という計算量に由来する。マルチバイト文字（日本語などUnicode）の場合は候補範囲が大きく広がるため、より多くのリクエストを要する。頻出する文字についてはHuffman符号化的な最適化で平均リクエスト数を下げる工夫もされている。

```
GET /page.php?id=1 AND ASCII(SUBSTRING((SELECT password FROM users LIMIT 1),1,1))>77
```

上記のような比較を、真になるかどうかでレスポンスが変化するかを見ながら二分探索的に繰り返し、パスワードの先頭文字のASCIIコードを絞り込んでいく。これが「Blind（盲目的）」と呼ばれる所以で、直接データが画面に表示されるわけではなく、真偽の「差」だけが情報源になる。

#### 2.2 Time-based blind（T）— レスポンス時間の差から1文字ずつ推測する

Boolean-basedと同じ二分探索アルゴリズムを使うが、比較対象が「ページ内容の差」ではなく「**レスポンスタイムの差**」である点が異なる。注入する文は「条件が真ならDBMSを一定秒数待機させる」もの（例: MySQLの`SLEEP(5)`、PostgreSQLの`pg_sleep(5)`）。`--time-sec`で待機秒数を制御する（デフォルト5秒）。

これはBoolean-basedが使えない状況——例えばTrue/Falseでレスポンス内容やステータスコードに一切差が出ない、いわゆる完全なblind SQLi——でも有効という利点がある反面、ネットワーク遅延やサーバ負荷の揺らぎと区別する必要があるため、本質的にノイズに弱い。

**HTTP/2環境での改良: `--timeless`**。HTTP/2は複数のリクエストを1本のTCPコネクション上で多重化（マルチプレクス）して並行処理できる。この性質を利用し、人工的な`SLEEP()`による遅延の代わりに、「意図的にリクエストの処理順序・完了順序を操作して、真偽の違いを応答の到着順序（タイミング）として観測する」という、いわゆる **timeless timing attack**（USENIX Security 2020の研究に基づく）に置き換えることができる。これにより、ネットワークジッター（遅延のばらつき）に対して頑健な計測が可能になり、実サーバ上での待機を伴わないぶん検出速度も速く、WAF/IPSのレート・しきい値ベースの検知に引っかかりにくいという利点がある。

#### 2.3 Error-based（E）— DBMSのエラーメッセージに出力を埋め込ませる

DBMS固有のエラーを意図的に引き起こす文を注入し、HTTPレスポンス中のDBMSエラーメッセージをパースして、あらかじめ埋め込んだ目印の文字列とサブクエリの出力をそこから抽出する。

**この技法が成立する条件は明確に限定されている**: Webアプリケーションがバックエンドのエラーメッセージをそのままユーザーに返す（デバッグモードが有効、あるいはエラーハンドリングが不十分）設定になっていなければならない。本番運用でエラーメッセージを握りつぶす、あるいは汎用的な500エラーページに差し替えているアプリケーションでは、この技法は原理的に機能しない。

代表的な原理はMySQLの`extractvalue()`や`updatexml()`のように、XPath式の評価エラーメッセージにサブクエリの結果を混入させる手法である。DBMSが「このXPath式は不正です: {ここにサブクエリの出力}」という形のエラー文字列を返す仕様を逆手に取っている。

#### 2.4 UNION query-based（U）— 結果セットを合併して直接表示させる

`UNION ALL SELECT`で始まる構文的に妥当なSQL文をパラメータに追加する。アプリケーションが`SELECT`の出力を`for`ループ等でページ内に直接列挙して表示する場合に機能する。ページの各行が元クエリの結果に加えて、注入したUNIONの結果行としても表示されるため、DBの中身を直接読み取れる。

**partial（single entry）UNIONインジェクション**というバリエーションも自動的に検出・悪用される。これは出力が`for`構文でループ表示されておらず、クエリ結果の最初の1件しか表示されないページ構造の場合に対応するもので、その1件枠をUNION行として乗っ取ることでデータを抽出する。

UNION技法の成立には、元クエリと注入するUNION文とで**列数と互換なデータ型が一致している**必要がある。これが`--union-cols`（列数の探索範囲）や`--union-char`（列数ブルートフォース時のプレースホルダ文字）といったオプションが存在する理由であり、sqlmapは`ORDER BY`によるエラー確認や`NULL`埋めなど複数の手法を組み合わせて自動的に正しい列数を特定する。

#### 2.5 Stacked queries（S）— セミコロンで別文を継ぎ足す（piggy-backing）

まずWebアプリケーションが**複数文の同時実行（stacked queries）**をサポートしているかをテストし、サポートしている場合はパラメータにセミコロン(`;`)に続けて任意のSQL文を追加する。

これが重要なのは、`SELECT`以外の**データ定義文(DDL)やデータ操作文(DML)**——`INSERT`, `UPDATE`, `DROP`, `CREATE`など——を実行できる唯一の経路になるからである。stacked queriesが有効なDBMS/ドライバ構成（例: PHPのPDO+MSSQL、Pythonのpsycopg2+PostgreSQLなど、複数文実行を許すAPI）では、ここからファイルシステムの読み書きやOSコマンド実行にまでエスカレーションしうる。**逆にMySQLの標準PHP拡張(mysqli単純クエリ)のように、そもそも1リクエストで複数文を実行できないAPI設計のバックエンドでは、この技法は原理的に使えない**——これはアプリ側の実装（ドライバ/APIの選択）に依存する制約であり、DBMSの種類だけでは決まらない点に注意。

#### 2.6 Inline queries（Q）— ネストされたSELECTに埋め込む

注入した文を、元の（サブ）クエリの内部にそのまま埋め込む（例: `SELECT (SELECT <injected>) FROM ...`）ことで、埋め込んだ文の出力を同じレスポンスの中でイン・バンドに返させる。対象パラメータがネストした`SELECT`が評価される位置にあり、かつその評価結果がレスポンスに反映される場合に有効。UNIONほど汎用ではないが、UNIONが使えない構文的制約下でも通用する場合がある狭い適用範囲の技法。

#### 2.7 SQL以外の注入エンジン（参考）

sqlmapはSQLインジェクション以外にも、NoSQL（MongoDB/CouchDBの`$`演算子、ElasticsearchやSolrのLuceneクエリ構文、Cypher/N1QL/AQLの文字列エスケープ崩し、MongoDBの`$where`を使った時間ベース攻撃など）、GraphQL（イントロスペクションによるスキーマ復元、無効時はフィールド推測によるスキーマ推定）、LDAP、XPath、SSTI（Jinja2, Mako, Twig, ERB, Pug, Handlebars, Thymeleaf, FreeMarker, Velocityなどのテンプレートエンジン指紋判定とOSコマンド実行）、XXE（外部エンティティ経由の高価値ファイルの自動収穫、完全blindな場合はOOBコレクタで抽出）、HQL/JPQL（Hibernate ORM固有のパーサ診断やORM専用構文でのみ確定させる）にも対応する。これらはそれぞれ独立したエンジンで、SQLiのようなDB全体・テーブル全体の列挙が可能なわけではなく、「その注入経路が到達できる範囲」に閉じている点がSQLiとの大きな違いである。

> 出典: Techniques — https://github.com/sqlmapproject/sqlmap/wiki/Techniques

---

### 3. FAQ — 実務で誤りやすいポイントと公式スタンス

> 出典: FAQ — https://github.com/sqlmapproject/sqlmap/wiki/FAQ

#### 3.1 tamperスクリプトは「手動でバイパス方法を理解していない限り使うな」

FAQの中でも実務上もっとも重要な項目がこれである。開発チームの立場は明確で、**「手動で対象を評価できないのであればtamperスクリプトを使うな（Don't use tamper scripts if you are not able to manually assess the target）」**という一文に集約される。

これがなぜ重要かを仕組みの面から補足する（以下は未取得資料の補足ではなく取得できたFAQ本文の趣旨に基づく解説）。tamperスクリプトは「ペイロード文字列をWAF/IPS/フィルタに引っかからない形へ機械的に書き換える」プラグインであり、`--list-tampers`で一覧表示できるように数十種類が同梱されている（例: `between`は`>`のような比較演算子を`NOT BETWEEN 0 AND`のような同義の構文へ置換、`randomcase`はSQLキーワードの大文字小文字をランダム化、`space2comment`は空白をSQLコメント`/**/`へ置換するなど）。

**闇雲な組み合わせが危険な理由は2つある。**

1. **フィルタの仕組みを理解せずに複数のtamperを重ねても、命中率は上がらずノイズだけが増える**。WAFのブロック理由が「特定のキーワードの検知」なのか「特定の記号パターンの検知」なのか「リクエストの統計的異常(頻度・User-Agentなど)」なのかによって、有効なtamperはまったく異なる。原因を特定せずに手当たり次第組み合わせると、ペイロードが不必要に複雑化して誤動作したり、逆にDBMS側の構文パーサを壊して本来通るはずの注入まで失敗させたりする。
2. **tamperは「WAFを迂回する」ためのものであり、「SQLインジェクションを成立させる」ためのものではない**。土台となる注入点自体が正しく機能する構文になっていることを、まず手動（ブラウザやBurp Repeaterでの単発リクエスト検証など）で確認できて初めて、tamperの効果を正しく評価できる。手動でのベースライン確認をせずにtamperだけを変えて試行錯誤するのは、何が効いているのか全く分からないブラックボックスな試行になり、時間を浪費するだけでなく誤った結論（「このWAFは回避不能」「この点は脆弱ではない」）に至りやすい。

これは章全体のテーマである「手動 vs 自動」の核心的な教訓でもある。自動化ツールは検出・抽出を高速化する道具であって、防御機構の仕組みを理解する作業の代替にはならない。

```bash
# 利用可能なtamperスクリプトの一覧
python sqlmap.py --list-tampers

# 複数tamperの併用例（あくまで「フィルタの仕組みを理解した上で」選ぶべき）
python sqlmap.py -u "http://target.com/page?id=1" --tamper="between,randomcase"
```

#### 3.2 WAF/IPS越しの接続エラーへの対処

「普段のブラウジングは問題ないのにsqlmapだけ接続タイムアウトになる」という症状は、WAF/IPSがsqlmapの**デフォルトUser-Agent文字列**（`sqlmap/x.x.x#stable`のような識別可能な値）をシグネチャとして検知・ブロックしているケースが典型的である。対処として`--random-agent`（ブラウザのUser-Agentリストからランダムに選択）を使う、あるいはプロキシ設定を`--proxy`/`--ignore-proxy`で明示的に制御することが推奨されている。これは「ツールの正体を隠す」というより、「検知ロジックが何に反応しているかを切り分ける」診断的な使い方だと理解するのがよい。

#### 3.3 DB直接接続によるポストエクスプロイト（`-d`）

`-d "mysql://user:pass@127.0.0.1:3306/testdb"`のような接続文字列を使えば、SQLi脆弱性の検証を経由せず、既知のDB資格情報から直接列挙やOSコマンド実行に進める。これはWebアプリのバグではなく「DB認証情報の漏洩後の被害範囲確認」という侵入テストのフェーズで使われる機能である。

#### 3.4 INSERT/UPDATEの実行可否

`INSERT`/`UPDATE`のようなデータ操作文を実行するには、(a) stacked queries技法が対象アプリでサポートされている、または(b) `-d`での直接接続かつセッションユーザーが十分な権限を持っている、のいずれかが条件になる。単純なBoolean-based/UNIONベースのSQLiだけでは、読み取り以上のことはできない場合が多い——これは2.5節のstacked queriesの制約と表裏一体である。

#### 3.5 パスワードハッシュが取れない理由

前述1.7節と同じ論点がFAQでも扱われている。セッションユーザーがシステムカタログ（`mysql.user`など）への読み取り権限を持たない場合、sqlmapがどんなペイロードを試しても列挙できない。これはツールの限界ではなく対象環境の権限設計の結果であると明言されている。

#### 3.6 商用ツールとの比較で「検出できない/できる」の差

「他の商用ツールでは検出できるのにsqlmapでは検出できない」という報告に対し、FAQは「商用ツールの多くはエラーメッセージの有無だけで判定しており、それが誤検知(false positive)の温床になっている」と指摘している。sqlmapは実際に悪用可能であることを検証するプロセス（実データの抽出やタイミング差の再現性確認など）を経てから脆弱性を確定させる設計思想であるため、判定に保守的になりやすい。これは検出漏れというより「誤検知を許容するか、確度を優先するか」というツール設計上のトレードオフである。

#### 3.7 その他の運用上のFAQ

- **練習環境**: 許可のない対象への実行は違法であることが明記されている。合法的な練習用途としては意図的に脆弱に作られたデモサイト（例: sekumartのようなプロジェクト）の利用が案内されている。
- **`--text-only`の役割**: HTMLタグやスクリプトを取り除いてテキスト内容のみで比較することで、Boolean-basedの検出精度を上げる。動的に変化する装飾要素（広告、タイムスタンプなど）がノイズとなって誤判定を招くケースへの対策。
- **`mod_rewrite`環境でのテスト**: URLのパス部分に注入点があり、クエリ文字列の形を取らない場合、アスタリスク(`*`)で注入位置を明示する（例: `-u "http://target.tld/id1/1*/id2/2"`）。
- **`--start`/`--stop`/`--first`/`--last`、または`--sql-query`/`--sql-shell`/`--sql-file`**: 大量データのダンプを条件付き・範囲指定で絞り込む方法。抽出対象を絞ることで時間とリクエスト数を大幅に節約できる。

> 出典: FAQ — https://github.com/sqlmapproject/sqlmap/wiki/FAQ

---

### まとめ

sqlmapの強力さは、Usageで見た膨大なオプション体系そのものではなく、その背後にある「HTTPレスポンスの差分をどう解釈してSQL文の出力を復元するか」という6つの技法の原理（二分探索によるBoolean/Time-based、エラーメッセージのパースによるError-based、結果セットの合併によるUNION、複数文実行によるStacked、ネストクエリ埋め込みによるInline）にある。そしてFAQが繰り返し強調するのは、**自動化はあくまで「理解した上での加速装置」であり、tamperスクリプトの闇雲な重ねがけのような「理解を飛ばした自動化」は、時間の浪費と誤った結論を招くだけ**だという点である。次節以降でGhauriとの比較、手動検証との併用パターンを扱う際も、この原則——「まず仕組みを理解し、そのうえでツールに任せる」——が一貫した軸になる。

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

---

[← 第6章 応用・現代トピック（second-order・ORM・GraphQL・SQLi→RCE）](06-advanced-modern.md) ｜ [📖 目次](index.md) ｜ [第8章 防御・検出・修正 →](08-defense.md)
