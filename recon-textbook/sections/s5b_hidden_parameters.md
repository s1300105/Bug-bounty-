## 隠しパラメータ発見（Arjun/x8/Param Miner）

Web アプリケーションは、UI やドキュメントに現れない入力パラメータ（クエリ文字列や POST ボディのキー）を、内部的に受け付けていることがある。これらを **隠しパラメータ（hidden parameters）** と呼ぶ。開発の名残であるデバッグ用スイッチ、旧 API の互換パラメータ、管理者向けの内部フラグ、あるいは「ドキュメントに書かなければ誰も見つけない」という思い込み（＝**security through obscurity**、隠すことで守った気になる誤った防御）で放置された入力が典型例である。本節では、こうした隠しパラメータを体系的に列挙するための代表的ツールである **Arjun**・**x8**・**Param Miner** の 3 つを、「なぜ発見できるのか」という原理レベルまで掘り下げて解説する。

> ⚠️ 本節は防御・自己資産の評価を目的とする。ここで示すコマンドやペイロードは、自分が管理する資産、あるいは書面による明示的な許可を得た対象に対してのみ実行すること。実在サービスや本番環境への無許可のパラメータ・ファジングは、たとえ「読み取りだけ」に見えても不正アクセスに該当しうる。

### なぜ隠しパラメータが重要なのか

隠しパラメータは、通常のブラックボックステスト（画面から辿れる入力だけを試す手法）では到達できない **追加の攻撃面（attack surface）** を開く。重要なのは、これらのパラメータが「UI から使われない」がゆえに、開発者の意識から漏れ、入力検証（バリデーション）が甘いまま残りやすいという点である。Intigriti のガイドはこの構造を端的に述べている。「開発者は無意識のうちに obscurity（隠蔽）を防御手段として当てにしている。ドキュメント化しなければ、攻撃者は（ボディやクエリの）パラメータを見つけないだろうと信じている」。

その結果、隠しパラメータは以下のような脆弱性クラスの入口になりやすい。YesWeHack のガイドは、パラメータ発見から到達しうる脆弱性として次を列挙している。

- クロスサイトスクリプティング（XSS）
- オープンリダイレクト
- SSRF（Server-Side Request Forgery、サーバーに任意先へリクエストを送らせる）
- SQL インジェクション
- ローカルファイルインクルージョン（LFI）
- コマンドインジェクション
- サーバーサイドテンプレートインジェクション（SSTI）
- IDOR（Insecure Direct Object Reference、識別子を差し替えて他人のデータにアクセスする）

つまり隠しパラメータ発見それ自体は「偵察（recon）」の工程だが、そこで見つかった 1 つのパラメータが、後続の脆弱性検証における最も価値の高い入力点になりうる。YesWeHack はこれを「型破りで高額報奨につながるバグ（unconventional and high reward paying bugs）」への道と表現している。

> 出典: Finding Hidden Parameters: Advanced Enumeration Guide — https://www.intigriti.com/researchers/blog/hacking-tools/finding-hidden-input-parameters
> 出典: Parameter Discovery: Quick Guide to Start — https://www.yeswehack.com/learn-bug-bounty/parameter-discovery-quick-guide-to-start

### パラメータ発見の 5 つのアプローチ

ファジングツールに入る前に、Intigriti のガイドが整理する「パラメータを見つける 5 つの手法」を押さえておく。ファジングは最後の手段であり、その前に受動的（passive、対象に余計なリクエストを送らない）に得られる情報を吸い上げておくのが効率的だからである。

1. **HTML の input フィールド**: フォーム内外を問わず、`id` や `name` 属性を抽出する。GoSpider や GetAllParams のようなクローラーで自動化できる。
2. **JavaScript の列挙**: パラメータ値を読み出している関数呼び出しを調べる。JavaScript 内の変数名そのものが、サーバー側で受け付けるパラメータ名であることも多い。
3. **検索エンジン・アーカイブ**: Google ドーク（`site:.example.com inurl:? || inurl:&` のようにクエリ文字列を含む URL を狙う検索）や Wayback Machine（過去のクロール結果を保持するアーカイブ）から、パラメータ付きの過去の URL を回収する。
4. **パラメータ・ファジング**: 最も正確な手法。パラメータを送り込み、レスポンスの変化からサーバーが処理したかを判定する。品質の高いワードリストが必要で、対象特化のカスタムワードリストは汎用リストを上回る。
5. **パラメータの再利用（re-use）**: あるエンドポイントで受け付けられるクエリ／ボディパラメータは、別のエンドポイントでも通ることが多い。Burp Suite や ZAProxy のクロール履歴をエクスポートし、既知のパラメータ集合を横展開する。

このうち 1〜3・5 は受動的・半受動的で、まず先にやるべき工程である。本節の主役である Arjun・x8・Param Miner は 4 の「ファジングによる能動的発見」を担う。

> 出典: Finding Hidden Parameters: Advanced Enumeration Guide — https://www.intigriti.com/researchers/blog/hacking-tools/finding-hidden-input-parameters

### 発見の原理: 「レスポンス差分（response diffing）」と探索効率

隠しパラメータ発見ツールが共通して依拠する原理は、極めてシンプルである。**「あるパラメータをリクエストに追加したとき、レスポンスが基準（ベースライン）から変化するか」を観測する** ことだ。サーバーがそのパラメータを認識して処理すれば、何らかの形でレスポンスが変わる可能性が高い。逆に無視されれば、レスポンスはベースラインと同一のままになる。

ここで 2 つの技術的難所が生じる。

**難所 1: 何を「変化」とみなすか（差分ヒューリスティック）**

Web レスポンスは、同じリクエストを送っても毎回わずかに揺れる。CSRF トークン、タイムスタンプ、ランダムな広告 ID、キャッシュ状態などがそれである。単純に「レスポンス本文が 1 バイトでも違えば当たり」とすると、大量の誤検知（false positive）が出る。そのため各ツールは、複数の観測軸を組み合わせて「安定して現れる差分」だけを拾う設計になっている。

**難所 2: リクエスト数の爆発（探索効率）**

ワードリストが数万件あるとき、1 パラメータにつき 1 リクエストを送ると数万リクエストになり、遅く、対象への負荷も大きい。そこで **チャンク化（chunking）＋二分探索（binary search）** という手法が使われる。原理はこうだ。

1. ワードリストを大きなかたまり（チャンク）に分け、1 リクエストに多数のパラメータを一度に詰め込んで送る。
2. そのチャンクを含むレスポンスがベースラインと変わらなければ、「このチャンクの中に有効なパラメータは 1 つもない」と結論し、チャンク全体を丸ごと捨てる。
3. 変化があれば、「この中に少なくとも 1 つ当たりがある」ので、チャンクを半分に割ってそれぞれを再テストする（＝二分探索）。
4. 当たりを含む側だけを再帰的に分割していき、最終的に個々のパラメータまで絞り込む。

この方式なら、当たりが少ない大規模ワードリストを、リクエスト数を対数オーダー（当たりの数に比例＋分割のログ）に抑えて処理できる。Arjun がこの威力を数値で示している。デフォルト辞書 25,890 件を「10 秒足らず、わずか 50〜60 リクエストで」走査できるのは、まさにこのチャンク化＋二分探索によるものだ。

> 出典: Finding Hidden Parameters: Advanced Enumeration Guide — https://www.intigriti.com/researchers/blog/hacking-tools/finding-hidden-input-parameters

### Arjun — Python 製・多形式対応の定番

**Arjun**（作者: s0md3v）は、HTTP パラメータ発見ツールの中で最も広く使われている Python 製 CLI である。GET／POST／POST-JSON／POST-XML の各リクエスト形式に対応し、チャンク化した bulk リクエストで高速に走査する。

#### 内部動作と差分ヒューリスティック

Arjun の核心は、リクエストに一度に多数のパラメータを詰め込み、レスポンスを複数の軸で比較して「揺れ」と「本当の差分」を切り分ける点にある。ソース（`arjun/core/anomaly.py`）が採用する比較軸は次のとおりである。これらを組み合わせることで、単一軸では拾えない誤検知を抑える。

- **ステータスコード（same_code）**: HTTP レスポンスコードの変化を検知する。
- **レスポンス本文（same_body）**: 本文全体が変わったか。
- **行数（lines_num / lines_diff）**: 本文中の改行数、および行単位の差分。
- **プレーンテキスト（same_plaintext）**: HTML タグを除去した後のテキスト内容。マークアップに隠れた実質的な変化を捉えるため。
- **HTTP ヘッダ（same_headers）**: レスポンスヘッダのキー集合の変化。
- **パラメータ名の反射（param_missing）**: 送り込んだパラメータ「名」がレスポンスに現れたか。正規表現 `[\'"\s]%s[\'"\s]` でマッチし、元々ページに存在していた語は誤検知回避のため除外する。
- **パラメータ値の反射（value_missing）**: 送り込んだ「値」がレスポンスに現れたか。精度のため 6 文字のランダム文字列に限定して照合する。
- **リダイレクト（same_redirect）**: リダイレクト設定に応じて、URL パスや `Location` ヘッダを比較する。

「値を 6 文字のランダム文字列にする」のは重要な工夫だ。もし普通の値（`1` や `true`）を送ると、それが偶然ページ内の別の箇所にも現れて誤反射と誤判定されうる。十分ランダムで一意な文字列なら、レスポンスに出た＝サーバーがその入力を反射した、と高い確度で言える。これは後段の XSS 探索（反射があるかを見る）にも直結する情報である。

#### インストールと基本コマンド

推奨インストールは pipx（アプリを隔離環境に入れる方法）である。

```bash
# 推奨（隔離環境にインストール）
pipx install arjun

# 旧環境向けの代替
pip install arjun

# ソースから
git clone https://github.com/s0md3v/Arjun
cd Arjun
python3 setup.py install   # /usr/local/bin/arjun に入る
```

（Python 3.4 以上が必要。以前の Intigriti 記事では `apt-get install python3` → `git clone` → `python3 setup.py install` という手順が示されているが、現在の公式推奨は `pipx install arjun` である。）

基本的な使い方は次のとおり。

```bash
# 単一 URL を GET で走査（デフォルト）
arjun -u https://demo.testfire.net/

# POST で走査
arjun -u https://target.example/test -m POST

# URL 一覧を入力し、結果を JSON に出力（自動化パイプライン向け）
arjun -i urls.txt -oJ results.json
```

#### 主要フラグ

| フラグ | 機能 | 例 |
|---|---|---|
| `-u` | 単一 URL | `arjun -u https://site.example/page/` |
| `-i` | URL リストファイル | `arjun -i urls.txt` |
| `-m` | HTTP メソッド（GET/POST/JSON/XML） | `-m POST` |
| `-w` | カスタムワードリスト | `-w parameters.txt` |
| `-t` | スレッド数（デフォルト 2） | `-t 20` |
| `-d` | リクエスト間の遅延（秒） | `-d 2` |
| `-oJ` / `-oT` | JSON / テキスト出力 | `-oJ results.json` |
| `--headers` | カスタムヘッダ（Cookie 認証など） | `--headers 'Cookie: PHPSESSID=xxxx'` |
| `--include` | リクエストに固定データを含める | `--include '{"api_key":"xxxxx"}'` |

**なぜこれらが要るのか**: `-d`（遅延）と `-t`（スレッド）は、対象への負荷とプログラムのレート制限（バグバウンティで「1 秒あたり何リクエストまで」と定められることがある）を守るための調整弁である。無許可・過剰なリクエストは対象を壊しかねず、また規約違反になる。`--headers` は認証が必要なエンドポイント（ログイン後にしか見えないパラメータ）を評価するのに不可欠だ。ボディ形式（JSON/XML）では、プレースホルダ `$arjun$` を使ってパラメータを挿入する位置を指定できる。

Arjun のデフォルトワードリスト 25,890 件は、CommonCrawl（大規模 Web クロールの公開データセット）から抽出した頻出パラメータ名、SecLists、param-miner の各ワードリストの「良い部分」を統合し、`db/special.json` の特殊ペイロードを加えて構成されている。加えて Arjun は、JavaScript や 3 つの外部ソースからパラメータを受動抽出する `--passive` 相当の機能や、結果を Burp・テキスト・JSON として入出力する連携機能も持つ。

> 出典: Hacker tools: Arjun — the parameter discovery tool — https://www.intigriti.com/researchers/blog/hacking-tools/hacker-tools-arjun-the-parameter-discovery-tool
> 出典: Finding Hidden Parameters: Advanced Enumeration Guide — https://www.intigriti.com/researchers/blog/hacking-tools/finding-hidden-input-parameters

### x8 — Rust 製・高速かつ挿入点が柔軟

**x8**（作者: sh1yo）は Rust で書かれた高速なパラメータ発見ツールである。Arjun より挿入点（injection point）の指定が柔軟で、クエリ・ボディだけでなく、任意の位置やヘッダにもパラメータを注入できるのが特徴だ。

#### 動作原理

x8 は起動時にまず **学習リクエスト（learning requests、デフォルト 9 回）** を送り、対象ページの「素の揺れ」を把握してベースラインを作る。その上で、次の 3 軸で差分を判定する。

- ページの **行単位比較（line-by-line comparison）**
- **レスポンスコード** の比較
- **反射（reflections）** の検出＝送り込んだ入力が出力に現れるか

これにより、`admin=true` のような「固定値を持つパラメータ」の発見や、反射系パラメータの検出を精度よく行える。設計は数千 URL を並列処理できるようスケールする。

#### 挿入点プレースホルダ `%s`

x8 の最大の武器は `%s` プレースホルダである。これを使うと、URL・ボディ・ヘッダの任意の位置に「ここにパラメータ群を展開せよ」と指示できる。

```bash
# クエリ文字列に注入
x8 -u "https://example.com/?%s" -w wordlist.txt

# POST の JSON ボディの入れ子位置に注入
x8 -u "https://example.com/" -X POST -b '{"x":{%s}}' -w wordlist.txt

# ヘッダを探索（隠しヘッダの発見）
x8 -u "https://example.com" --headers -w wordlist.txt

# 特定ヘッダ値に注入（Cookie の隠しキーなど）
x8 -u "https://example.com" -H "Cookie: %s" -w wordlist.txt

# 複数 URL を完全並列で
x8 -u "https://example.com/" "https://another.example/" -W0 -w wordlist.txt
```

**なぜ挿入点の柔軟性が効くのか**: 現代の API は、パラメータをクエリではなく JSON ボディの深い階層や、独自ヘッダで受け取ることが多い。`%s` で注入位置を明示できると、`{"x":{%s}}` のようにネストしたオブジェクトの内側にパラメータ候補を展開でき、Arjun の標準形では届きにくい構造化ボディの隠しキーを掘り出せる。

#### 主要フラグ

| フラグ | 機能 |
|---|---|
| `-u, --url` | 対象 URL（`%s` で注入点指定可） |
| `-w, --wordlist` | パラメータ候補リスト |
| `-X, --method` | HTTP メソッド |
| `-b, --body` | ボディテンプレート（`%s` プレースホルダ） |
| `-c` | 1 URL あたりの同時リクエスト数（デフォルト 1） |
| `-W, --workers` | 並列 URL 数（`-W0` で全件並列） |
| `--learn-requests` | 学習リクエスト数（デフォルト 9） |
| `-m, --max` | 1 リクエストあたり最大パラメータ数 |
| `--reflected-only` | 反射するパラメータのみ探索 |
| `--verify` | 発見したパラメータを再検証 |
| `--recursion-depth` | 発見済みパラメータを再帰的に再テスト |
| `--custom-parameters` | 非ランダムな固定候補（既定で admin, bot, debug など） |
| `--custom-values` | テストする値（既定 `1 0 false off null true yes no`） |
| `-d, --delay` | リクエスト間の遅延（ミリ秒） |
| `--timeout` | HTTP タイムアウト秒数（デフォルト 15） |
| `-x, --proxy` / `--replay-proxy` | プロキシ経由送信／発見分の再送プロキシ |
| `-O, --output-format` | 出力形式（standart / json / url / request） |

`--verify` と `--recursion-depth` は特に重要だ。`--verify` は「当たり」を単発でなく再送して確定させ、差分の偶然性を排除する。`--recursion-depth` は、見つかったパラメータを組み込んだ状態でさらにワードリストを回すことで、「あるパラメータが有効なときだけ現れる別のパラメータ」を掘る（パラメータ間の依存関係を辿る）。

**バージョン注意（時事性）**: x8 の **v4.0.0 以降**、`cargo install` でビルドすると HTTP の正規化（normalization）を行わない標準 `reqwest` ライブラリが使われる。特殊なリクエスト（あえて正規化してほしくない生リクエスト）を扱いたい場合は、Releases ページ配布のバイナリを使うか、ソースからビルドする必要がある。Burp Suite とは「Custom Send To」拡張から `x8 --progress-bar-len 20 -c 3 -r %R -w /path/to/wordlist --proto %T --port %P` の形で連携できる。

> 出典: Finding Hidden Parameters: Advanced Enumeration Guide — https://www.intigriti.com/researchers/blog/hacking-tools/finding-hidden-input-parameters
> 出典: x8 リポジトリ README（sh1yo/x8）— https://github.com/sh1yo/x8

### Param Miner — Burp 統合・二分探索とキャッシュ悪用検知

**Param Miner** は PortSwigger 公式の Burp Suite 拡張（Java）で、BApps マーケットプレイスから導入する。CLI ではなく Burp のワークフローに溶け込む点が強みで、プロキシで捕捉した実リクエストに対して右クリックから直接パラメータ推測を走らせられる。

#### 使い方と推測方式

対象リクエストを右クリックし、`Guess (cookies|headers|params)` を選ぶと推測が始まる。1 リクエストあたり **最大 65,000 個** のパラメータ名を推測できる。この驚異的な効率は、前述の **二分探索（binary search）＋精緻な差分ロジック** による（この差分ロジックは PortSwigger の Backslash Powered Scanner から流用されたもの）。1 リクエストに大量の候補を詰め込み、差分が出たチャンクだけを半分に割って再帰的に絞り込むため、65,000 候補でも実リクエスト数はごくわずかで済む。

ワードリストは「入念にキュレーションされた組み込みリスト」に加え、監視中の in-scope トラフィックから動的に語彙を収集して拡張される。つまり、あなたがブラウジング中に流れた実際のパラメータ名を学習し、その対象に固有の語彙で推測精度を上げる。

#### キャッシュポイズニング検知という独自価値

Param Miner の際立った特徴は、**Web キャッシュポイズニング（cache poisoning）** の検知に特化している点だ。2020 年の「Web Cache Entanglement」アップデートで、いわゆる **fat GET キャッシュポイズニング**（本来ボディを持たない GET リクエストにボディを付け、キャッシュ層が無視するがバックエンドは処理する差異を突く）などの検出機能が追加された。隠しパラメータの中には、キャッシュのキー（cache key、どのリクエストを同一とみなすかの判定材料）に含まれないものがあり、そこに悪意ある値を仕込むと、他ユーザーにも配信されるキャッシュを汚染できる。Param Miner はこの「キャッシュされるが鍵に入らないパラメータ／ヘッダ」を炙り出せる。

#### 結果と設定

- **Burp Suite Pro** では、発見パラメータはスキャナの issue として上がる。
- **それ以外**では `Extender → Extensions → Param Miner → Output` に出力される。
- 非デフォルト設定はハイライトされ、初期値へのリセットも可能。
- ペース制御には「Distribute Damage」拡張を併用してレート制限をかけられる。
- 動作要件は **Burp Suite 2021.9 以降**。

> 出典: Finding Hidden Parameters: Advanced Enumeration Guide — https://www.intigriti.com/researchers/blog/hacking-tools/finding-hidden-input-parameters
> 出典: Parameter Discovery: Quick Guide to Start — https://www.yeswehack.com/learn-bug-bounty/parameter-discovery-quick-guide-to-start
> 出典: param-miner リポジトリ README（PortSwigger/param-miner）— https://github.com/PortSwigger/param-miner

### 3 ツールの使い分け

| 観点 | Arjun | x8 | Param Miner |
|---|---|---|---|
| 実装言語 | Python | Rust | Java（Burp 拡張） |
| 形態 | CLI | CLI | Burp 統合（GUI） |
| 強み | 多形式（JSON/XML）・自動化パイプライン | 高速・挿入点が柔軟・ヘッダ探索 | Burp ワークフロー・キャッシュ悪用検知・in-scope 学習 |
| 探索効率 | チャンク化（25,890 件を 50〜60 req） | 学習リクエスト＋並列 | 二分探索（最大 65,000 params/req） |
| 典型用途 | URL 一覧を一括処理し JSON 出力 | 構造化ボディ・独自ヘッダの深掘り | 手動テスト中の対象特化推測 |

実務的には、まず受動的手法（HTML/JS 解析、アーカイブ、パラメータ再利用）で候補を集め、対象特化のワードリストを作る。次に大量 URL には Arjun や x8 を CLI で回し、手作業で精査したい重要リクエストには Burp 上で Param Miner を当てる、という多層的な使い方が効率的だ。ここで一貫して重要なのは、**カスタムワードリストが汎用リストを上回る** という Intigriti の指摘である。対象の JavaScript や過去 URL から抽出した語彙を辞書に足すほど、当たり率は上がる。

> 出典: Finding Hidden Parameters: Advanced Enumeration Guide — https://www.intigriti.com/researchers/blog/hacking-tools/finding-hidden-input-parameters

### 発見後の扱いと防御的観点

隠しパラメータの列挙はあくまで recon の一部であり、発見自体がゴールではない。YesWeHack のクイックガイドは、発見→脆弱性種別でのフィルタ→自動スキャナでの検証→確定、という流れを示している（例えばパラメータ集合を XSS 候補で絞り込み、検証ツールに流すパイプライン）。ただし本教科書のスコープに従い、具体的な攻撃・破壊的手順の実行はここでは扱わない。

**防御側にとっての示唆** はむしろ明確だ。隠しパラメータが危険なのは、それが「文書化されず、検証されず、監視されず」に生き残るからである。したがって緩和策は次の点に集約される。

- パラメータの **明示的な許可リスト（allowlist）**: 受け付けるパラメータ名を明示し、未知のパラメータは無視・拒否する。obscurity に頼らない。
- 使われなくなったデバッグ／レガシーパラメータの **確実な削除**: 「動いているから残す」をやめる。
- 全パラメータへの **一様な入力検証**: UI から来る入力も、そうでない入力も同じ厳格さで検証する。
- **キャッシュキーの設計**: キャッシュされる応答に影響する入力は、必ずキャッシュキーに含める（fat GET 等のキャッシュポイズニングを防ぐ）。
- 自組織資産に対する **定期的な自己パラメータ発見**: 攻撃者が使うのと同じ Arjun/x8/Param Miner を、許可された自社環境で定期的に走らせ、意図せず露出したパラメータを棚卸しする。

これは本教科書が繰り返し強調する姿勢——「攻撃者の recon 手法を、自組織の露出把握に転用する」——の、パラメータ層における実践である。

> 出典: Parameter Discovery: Quick Guide to Start — https://www.yeswehack.com/learn-bug-bounty/parameter-discovery-quick-guide-to-start
> 出典: Discover & map hidden endpoints & parameters — https://www.yeswehack.com/learn-bug-bounty/discover-map-hidden-endpoints-parameters
