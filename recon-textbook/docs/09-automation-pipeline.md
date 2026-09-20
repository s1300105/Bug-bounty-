# 第9章 Reconの自動化・パイプライン化・スケーリング


## ProjectDiscoveryツール群でのパイプライン構築

Reconを「作業」から「武器」へ変える分岐点は、個々のツールの使い方を覚えることではなく、**ツール同士を連結して回り続ける仕組み（パイプライン）にすること**にある。本節では、ProjectDiscovery（以下PD）が公開しているOSSツール群を題材に、(1) なぜこれらのツールがパイプで繋がる設計になっているのかという原理、(2) 実務的な多段パイプラインの組み方と状態管理、(3) クローラ `katana` を安全に運用するためのスコープ・レート制御、を仕組みレベルで整理する。

> 本節はすべて防御・学習目的の解説である。示すコマンド例は、自分が管理する環境、または対象プログラムが明示的に能動テストを許可した範囲でのみ実行すること。実在サービスへの無許可の能動スキャン・大量リクエストは、利用規約違反および法令違反になりうる。

---

### 1. パイプラインの土台にあるUnix哲学

PDのツール群が相互に繋がるのは偶然ではなく、全ツールが**同じ入出力契約（I/O contract）**を守るよう設計されているからである。その契約は次の3点に集約できる。

1. **1行 = 1レコード**：標準出力（stdout）には、1行につき1つの結果だけを出す。
2. **標準入力（stdin）から読める**：前段の出力をそのまま `|`（パイプ）で受け取れる。`-l <file>` でファイル入力にも切り替えられる。
3. **人間向けの装飾は stdout から分離する**：バナーやプログレス表示は標準エラー出力（stderr）へ、あるいは `-silent` で抑制する。

この契約があるために、「ドメイン → サブドメイン → 生存ホスト → エンドポイント → 検出結果」という変換の連鎖を、シェルのパイプ1本で表現できる。**パイプは前段プロセスの stdout を後段プロセスの stdin に接続するOSのカーネル機能**であり、中間ファイルを作らず、前段が出力した端から後段が処理を始める（ストリーミング）。つまり subfinder がまだ列挙を続けている最中に、既に出たサブドメインを httpx が並行してプローブする。これが「全部終わってから次へ」という逐次実行より圧倒的に速い理由である。

PDの公式ページに示されている各ツールの説明は、この「入力 → 出力」の変換として一貫して書かれている。

| ツール | 区分 | 変換（公式の説明） |
|---|---|---|
| `subfinder` | 資産発見／列挙 | 「ドメインを受け取り、1行1サブドメインで返す」。証明書透明性（CT）ログやパッシブDNSなどの受動ソースへ問い合わせる |
| `dnsx` | 名前解決 | 「サブドメインを受け取り、指定したレコード型を返す」 |
| `naabu` | ポートスキャン | 「ホストまたはCIDRを受け取り、1行1つの `host:port`（開いているもの）を返す」。CONNECT/SYNの2モード |
| `httpx` | HTTPプローブ | 「ホストを受け取り、応答したものについてステータス・タイトル・content length・技術スタックを返す」 |
| `katana` | クロール | 「URLを受け取り、到達できたエンドポイントをすべて返す」。ヘッドレスブラウザとJSパースに対応 |
| `nuclei` | 検出 | 「URLまたはホストを受け取り、マッチ1件につき1つの findings を返す」。テンプレートベース |
| `tlsx` | 証明書プローブ | 「ホストを受け取り、発行者・有効期限・証明書内の名前を返す」 |
| `uncover` | 発見 | 「クエリを受け取り `host:port` を返す」。Shodan/Censys/FOFA等を横断検索 |
| `alterx` | 列挙（順列） | 「サブドメインを受け取り、解決すべき順列（permutation）を返す」 |
| `shuffledns` | 列挙（総当たり） | 「ドメインとワードリストを受け取り、解決したサブドメインを返す」 |
| `asnmap` | マッピング | 「組織名・ASN・IP・ドメインを受け取り、そのASが広告しているCIDRを返す」 |
| `mapcidr` | マッピング | 「CIDRを受け取り、アドレスまたはレンジを返す」 |
| `cdncheck` | 判定 | 「IPを受け取り、その前段にいるCDN・WAF・クラウド事業者を返す」 |
| `vulnx` | 参照 | 「CVE IDまたはクエリを受け取り、該当レコードを返す」。EPSS・KEVステータス付き |
| `chaos-client` | 発見 | 「ドメインを受け取り、PDのDNSデータセットが把握しているサブドメインを返す」 |
| `interactsh` | 検出補助 | 「一意のホスト名を払い出し、そこへ届いたDNS/HTTP/SMTPのインタラクションを報告する」 |
| `notify` | ユーティリティ | ツール出力をSlack・Discord・Telegram・Webhookへ投稿する |
| `proxify` | ユーティリティ | 通信をキャプチャ／リプレイし、リクエスト・レスポンスをJSONLに記録する |
| `pdtm` | マネージャ | 「このページにある全ツールをインストールし、更新する」 |

`nuclei-templates` はコミュニティ管理のテンプレート集で、公式ページ記載時点でおよそ13,600件の公開テンプレート（うち4,400件以上がCVE対応）、ライセンスはMIT。

> 出典: ProjectDiscovery — Open source tools — https://projectdiscovery.io/open-source

#### なぜ `cdncheck` や `uncover` が「同じ流儀」で存在するのか

この一覧で見落とされがちだが重要なのは、`cdncheck` のような**判定・フィルタ専用の小さなツール**が独立して存在している点である。これは「1つのことをうまくやる」というUnix哲学の帰結で、たとえば naabu の前段に cdncheck を挟んで CDN 上のIPを除外すれば、「CDNエッジに対して無意味なフルポートスキャンを投げる」という典型的な浪費と迷惑行為を構造的に防げる。機能を大きな1ツールに詰め込まず分離しておくことで、**パイプラインの任意の位置に安全装置を挿し込める**ようになっている。

---

### 2. pdtm：ツール群のバージョンを揃える

パイプラインの再現性を最初に壊すのは、ツールのバージョン差である。`pdtm`（ProjectDiscovery Tools Manager）は、これをまとめて管理するための公式ツールである。READMEの定義はこうだ。

> "**pdtm** is a simple and easy-to-use golang based tool for managing open source projects from ProjectDiscovery."（pdtmは、ProjectDiscoveryのOSSプロジェクトを管理するためのシンプルで使いやすいGo製ツールである）

インストールは Go 1.24.3 以上を前提に次の通り（リリース版バイナリの配布もある）。

```sh
go install -v github.com/projectdiscovery/pdtm/cmd/pdtm@latest
```

主要なフラグは用途別に整理されている。

```console
CONFIG:
  -config            設定ファイルパス (既定: $HOME/.config/pdtm/config.yaml)
  -bp, -binary-path  バイナリの配置先      (既定: $HOME/.pdtm/go/bin)

INSTALL:
  -i,  -install      指定プロジェクトをインストール（カンマ区切り）
  -ia, -install-all  全プロジェクトをインストール
  -ip, -install-path PATH 環境変数へパスを追記
  -igp, -install-go-path GOBIN/GOPATH を PATH へ追記

UPDATE:
  -u,  -update       指定プロジェクトを更新
  -ua, -update-all   全プロジェクトを更新
  -up, -self-update  pdtm 自身を更新
  -duc, -disable-update-check 自動更新チェックを無効化

REMOVE:
  -r,  -remove       指定プロジェクトを削除
  -ra, -remove-all   全プロジェクトを削除
  -rp, -remove-path  PATH からパスを除去

DEBUG:
  -sp, -show-path    バイナリパスを表示
  -version / -v / -nc / -dc
```

> 出典: projectdiscovery/pdtm README — https://github.com/projectdiscovery/pdtm

**運用上の要点（仕組みの理解）**：`-bp` の既定値が `$HOME/.pdtm/go/bin` であるのは、Goの `go install` が使う `$GOPATH/bin` と衝突させないためである。パイプラインをcronやCIから起動する場合、**cronのシェルはログインシェルのプロファイル（`.zshrc` / `.bashrc`）を読まない**ため `PATH` にこのディレクトリが入らず、「手元では動くがcronでは `command not found`」という定番の失敗を起こす。スクリプト冒頭で明示的に `export PATH="$HOME/.pdtm/go/bin:$PATH"` を宣言しておくのが確実である。

また、`-duc`（更新チェック無効化）は自動実行では実質必須である。更新チェックはネットワークI/Oを伴い、実行のたびに数百ms〜数秒を消費するうえ、更新告知の出力がパイプを汚す可能性がある。逆に `-ua` は**手動で、パイプライン改訂のタイミングで**実行すべきもので、cronで毎晩ツールを自動更新すると「昨日と今日で結果が変わった原因が、対象側の変化なのかツール側の変化なのか切り分けられない」という、継続監視にとって致命的な状態を招く。

---

### 3. 最小パイプラインの解剖

公式ページが示す最小構成はこれである。

```sh
subfinder -d example.com -silent | httpx -silent -json | nuclei -severity high,critical -jsonl
```

連結に効くフラグとして、公式は次の2つを挙げている。

- `-silent`：stdout を結果だけに保つ
- `-json` / `-jsonl`：1行につき1つのJSONオブジェクトを書き出す

そして、subfinder / dnsx / naabu / httpx / katana / nuclei の主要ツールはすべて stdin もしくは `-l` から読み込めるため、パイプで連結可能である。

> 出典: ProjectDiscovery — Open source tools — https://projectdiscovery.io/open-source

#### なぜ `-silent` が必須なのか

PDのツールは通常、起動時にASCIIアートのバナー、設定サマリ、発見件数などを表示する。これらの多くは stderr に出るが、**stdout に混ざる情報（統計行や警告）が1つでもあると、後段はそれを「ホスト名」や「URL」として解釈しようとする**。たとえば後段の httpx が `[INF] Found 132 subdomains` という行を受け取れば、それをホスト名としてDNS解決しようとして失敗する。`-silent` は「機械が読む出力のみを stdout に出す」というモードであり、パイプラインでは省略不可と考えてよい。

#### なぜ JSON Lines（JSONL）なのか

`-jsonl` が出力するのは「JSON配列」ではなく「1行1JSONオブジェクト」である。この違いは決定的だ。JSON配列は最後の `]` を書くまで構文的に完結しないため、**ストリーム処理できず、必ず全件がメモリに載るまで待たねばならない**。JSONLは各行が独立して完結しているので、`jq` や `grep` に1行ずつ流し込める。すなわち「長時間走るスキャンの途中結果をリアルタイムに処理する」「途中でプロセスが死んでも、それまでの行は有効なデータとして残る」という、パイプラインに不可欠な性質を持つ。

```sh
# JSONL から特定の条件を抜き出す例（httpx の出力を想定）
httpx -l hosts.txt -silent -json \
  | jq -r 'select(.status_code == 200 and (.title // "" | test("admin"; "i"))) | .url'
```

`(.title // "")` は「`title` フィールドが存在しない（null）場合は空文字として扱う」というjqのイディオムで、フィールド欠落時に `test` がエラーで落ちるのを防ぐ。スキャン結果は**フィールドが常に揃っているとは限らない**（応答がなければタイトルもtechも無い）ため、JSONLを消費するコードは常に欠落を前提に書く必要がある。

#### パイプのバッファリングという落とし穴

パイプは便利だが、C標準ライブラリ由来の一般的なプログラムは、出力先が端末でない場合に**フルバッファリング（通常4KB〜64KB単位）**へ切り替わる。Go製のPDツールは多くの場合そのまま書き出すが、パイプラインに `grep` や `sed` のような外部コマンドを挟むと、そこで出力が数KB溜まるまで止まって見えることがある。リアルタイム性が必要な箇所では、GNU coreutils の `stdbuf -oL`（行バッファ化）や `grep --line-buffered` を挟む。

```sh
subfinder -d example.com -silent \
  | grep --line-buffered -v '\.cdn\.example\.com$' \
  | httpx -silent
```

---

### 4. 実務パイプライン：段階設計と状態管理

ここからは、単発のワンライナーではなく「毎日回して差分を取る」段階設計に進む。

> ⚠️ **未取得の資料**: 「How I Built an Automated Recon Pipeline for Bug Bounty Hunting」（ATNO For Cybersecurity）は自動取得できませんでした（理由: Medium が HTTP 403 Forbidden を返し、本文を取得できなかったため）。以下のURLからご自身で直接ご覧ください: https://medium.com/@atnoforcybersecurity/how-i-built-an-automated-recon-pipeline-for-bug-bounty-hunting-bed3cb545317

検索経由で確認できた同記事の骨子は次の通りである（2026年4月公開）。

- 基本思想は「**Manual recon is how you learn. Automated recon is how you scale.**（手動のReconは学ぶための手段、自動化されたReconはスケールするための手段）」であり、寝ている間にバックグラウンドで回り続けるパイプラインは、手動Reconに常に勝るとしている。
- 使用ツールは `subfinder`, `assetfinder`, `httpx`, `naabu`, `katana`, `nuclei`, `notify`, `anew`。
- `recon.sh` という単一のbashスクリプトが対象ドメインを引数に取り、`subdomains` / `hosts` / `ports` / `endpoints` / `vulnerabilities` というサブディレクトリを持つ出力ディレクトリ構造を作る。
- 1段目はサブドメイン列挙で、`subfinder` と `assetfinder` を併用する。subfinder は高速で単体ツールとしては最多のサブドメインを出す傾向がある一方、assetfinder は軽量で、subfinder が時折取り逃す証明書／DNS由来のサブドメインを拾う、という役割分担。
- `subfinder → httpx → nuclei → notify` を1コマンドに連結でき、真の優位は**速度と一貫性**、とりわけ「新しいサブドメインが現れたときに、最初にきちんとプローブできる」点にあるとする。
- cronジョブやCIパイプラインから自動実行することで継続監視に接続する。

> 出典: 🔍 How I Built an Automated Recon Pipeline for Bug Bounty Hunting — https://medium.com/@atnoforcybersecurity/how-i-built-an-automated-recon-pipeline-for-bug-bounty-hunting-bed3cb545317

（以下は未取得資料の補足として一般知識に基づく解説です）

#### なぜ段階ごとにファイルへ落とすのか

ワンライナーの弱点は、**中間状態が残らない**ことである。`subfinder | httpx | nuclei` を1本で流すと、nuclei が途中で落ちた場合、subfinder の列挙結果まで失われて全部やり直しになる。また「昨日と比べて何が増えたか」という差分も取れない。したがって実務パイプラインは、段ごとに「①前段の出力を読む → ②処理する → ③自分の出力を追記する」という形に分解する。

```sh
#!/usr/bin/env bash
set -euo pipefail

DOMAIN="$1"
BASE="$HOME/recon/$DOMAIN"
DATE="$(date -u +%Y%m%d-%H%M%S)"
export PATH="$HOME/.pdtm/go/bin:$PATH"

mkdir -p "$BASE"/{subdomains,hosts,ports,endpoints,vulnerabilities,runs/$DATE}
RUN="$BASE/runs/$DATE"

# --- 1) サブドメイン列挙（受動ソースのみ） ---
subfinder -d "$DOMAIN" -all -silent -duc \
  | anew "$BASE/subdomains/all.txt" \
  > "$RUN/new-subdomains.txt"

# --- 2) 名前解決（存在しないものを落とす） ---
dnsx -l "$BASE/subdomains/all.txt" -silent -a -resp -duc \
  | tee "$RUN/dns.txt" \
  | cut -d' ' -f1 | anew "$BASE/hosts/resolved.txt" > /dev/null

# --- 3) HTTPプローブ（生存と指紋） ---
httpx -l "$BASE/hosts/resolved.txt" \
      -silent -json -duc \
      -status-code -title -tech-detect -follow-redirects \
  > "$RUN/httpx.jsonl"

jq -r '.url' "$RUN/httpx.jsonl" | anew "$BASE/hosts/live.txt" > "$RUN/new-hosts.txt"
```

**`anew` が担っている役割（仕組み）**：`anew`（TomNomNom作）は「標準入力の各行を、指定ファイルに既に存在するかどうか判定し、**存在しない行だけを stdout に出しつつ、ファイルへ追記する**」という、たった1つの機能を持つツールである。`sort -u` との決定的な違いは、(a) 累積ファイルの順序を壊さない、(b) **今回新しく現れた行だけが stdout に流れる**、という点だ。この (b) がそのまま「差分検知」になる。上のスクリプトでは `new-subdomains.txt` に「今回初めて見つかったサブドメイン」だけが入るので、これをそのまま通知やnuclei実行の入力にすれば、**毎回全量を再スキャンせずに新規資産だけへリソースを集中できる**。

**`set -euo pipefail` の意味**：`-e` はコマンド失敗で即終了、`-u` は未定義変数の参照をエラー、`pipefail` は**パイプの途中のコマンドが失敗したらパイプライン全体を失敗扱いにする**。既定のシェルでは `a | b` の終了ステータスは `b` のものだけなので、pipefail を付けないと「subfinder が API キー不正で全滅したのに、httpx が正常終了したのでスクリプトは成功扱い」という、最悪の沈黙した失敗が起きる。継続監視パイプラインでは必ず設定する。

#### 新規資産にだけ検査を走らせ、通知する

```sh
# --- 4) 新規ホストのみクロール ---
if [ -s "$RUN/new-hosts.txt" ]; then
  katana -list "$RUN/new-hosts.txt" \
         -silent -jc -kf robotstxt,sitemapxml \
         -d 3 -fs rdn -rl 20 -c 5 -duc \
    | anew "$BASE/endpoints/all.txt" > "$RUN/new-endpoints.txt"
fi

# --- 5) 検出（テンプレートは対象と重大度を絞る） ---
if [ -s "$RUN/new-hosts.txt" ]; then
  nuclei -l "$RUN/new-hosts.txt" \
         -severity critical,high \
         -jsonl -o "$RUN/nuclei.jsonl" \
         -rl 30 -c 10 -duc -silent
fi

# --- 6) 通知（新規のみ） ---
if [ -s "$RUN/new-subdomains.txt" ]; then
  notify -silent -bulk -data "$RUN/new-subdomains.txt" \
         -id recon-alerts \
         -mf "新規サブドメイン ($DOMAIN): {{data}}"
fi
```

**なぜ「新規だけ」に絞るのが原理的に正しいのか**：対象の資産数を N、1資産あたりのスキャンコストを C とすると、全量スキャンは毎回 O(N·C) のトラフィックを対象へ投げる。N は時間とともに単調増加するので、これは**対象への負荷も自分のコストも日々増え続ける設計**である。一方、新規差分 ΔN のみをスキャンすれば O(ΔN·C) で済み、ΔN は通常 N よりはるかに小さい。継続監視の価値は「新しく現れたものに最速で到達すること」なので、**差分駆動は効率化であると同時に、監視の目的そのものに合致した設計**である。ただし、既存資産の構成変更（新しい脆弱なコンポーネントの導入など）は差分に現れないので、週次や月次で全量スキャンを別枠で回す二層構成にするのが実務的である。

**`notify` の仕組み**：`notify` は `$HOME/.config/notify/provider-config.yaml` にSlack/Discord/Telegram/Webhookの宛先を定義し、`-id` でそのプロファイルを選ぶ。`-bulk` はストリームを1件ずつ送らずまとめて送るモードで、これが無いと数百件の新規サブドメインが数百通の個別メッセージとしてチャンネルに流れ、各プラットフォームのレート制限に抵触する。通知先のWebhook URLは秘密情報なので、リポジトリにコミットせず、設定ファイルのパーミッションを `600` にすること。

#### cronでの定期実行

```cron
# 毎日 03:15 (UTC) に実行。PATH をcron環境に明示する。
PATH=/usr/local/bin:/usr/bin:/bin:/home/user/.pdtm/go/bin
15 3 * * * /usr/bin/flock -n /tmp/recon.lock /home/user/bin/recon.sh example.com >> /home/user/recon/cron.log 2>&1
```

`flock -n` は**多重起動防止**である。前回の実行が終わっていないのに次のcronが発火すると、同じ対象へ2倍のトラフィックを投げ、出力ファイルへの同時追記でデータが壊れる。`anew` は追記時にファイルロックを取らないため、この保護はスクリプト側の責務になる。

---

### 5. katana：クロール段の設計と安全装置

パイプラインの中でもっとも「対象に負荷をかける」段がクローラである。`katana` はPDのクローリングフレームワークで、公式READMEは主要機能を次のように列挙している。

- "Fast And fully configurable web crawling"（高速かつ完全に設定可能なWebクローリング）
- 標準モードとヘッドレスモードの2方式
- JavaScriptのパースとエンドポイント発見
- フォームの自動入力
- 事前定義フィールドまたは正規表現によるスコープ管理
- 機械学習ベースのページ分類
- 出力フォーマットのカスタマイズ
- STDIN・URL・ファイルリスト・JSONの入出力

インストールは Go 1.26 以上が前提で、ヘッドレス機能のために CGO が必要である（2026年9月時点のREADME）。

```console
CGO_ENABLED=1 go install github.com/projectdiscovery/katana/cmd/katana@latest
```

> ⚠️ **未取得の資料**: 「Katana to Kill-Switch: Mastering ProjectDiscovery's Crawler from Zero to Pro」は自動取得できませんでした（理由: Medium が HTTP 403 Forbidden を返し、本文を取得できなかったため）。以下のURLからご自身で直接ご覧ください: https://adce626.medium.com/katana-to-kill-switch-mastering-projectdiscoverys-crawler-from-zero-to-pro-with-real-world-62a7dec5a744
>
> 代替として、同記事が解説対象としている katana そのものの公式README（原典）から技術的事実を抽出して以下に記述する。

> 出典: projectdiscovery/katana README — https://github.com/projectdiscovery/katana

#### 5.1 標準モード vs ヘッドレスモード：何が違うのか

- **標準モード**：Goの標準HTTPライブラリでリクエストを投げ、**生のレスポンス本文を解析する**。ブラウザを起動しないので高速・低メモリだが、JavaScriptを実行しないため、DOMを動的に構築するSPAでは「HTMLにはリンクが1本も無い」状態になり、エンドポイントを取り逃す。
- **ヘッドレスモード**：READMEの表現では "Headless mode hooks internal headless calls to handle HTTP requests/responses directly within the browser context."（ヘッドレスモードは内部のヘッドレス呼び出しをフックし、ブラウザのコンテキスト内で直接HTTPリクエスト／レスポンスを処理する）。

この「フックする」という一語が要点である。一般的なヘッドレスクロールは、ブラウザがレンダリングした後のDOMを読むだけなので、`fetch()` や `XMLHttpRequest` が投げた**API呼び出しそのもの**は見えない。katana はブラウザのネットワーク層に介入することで、レンダリング済みDOMから辿れるリンクに加えて、**ページが実際に発行したリクエスト（XHR/fetchのURL、メソッド、ボディ）**も収集できる。SPAのバックエンドAPIを列挙するには、この差が決定的になる。代償は、Chromeプロセスの起動コスト・メモリ・レンダリング待ち時間で、標準モードより1桁遅いと考えてよい。

実務的な使い分けは、「まず標準モードで広く速く回し、SPA判定されたホスト（httpxの `-tech-detect` で React/Vue/Angular等が出たもの）だけをヘッドレスで再クロールする」という二層構成である。

ヘッドレス関連の主なオプション：

| フラグ | 意味 |
|---|---|
| `-sc, -system-chrome` | 同梱Chromiumではなく、システムにインストール済みのChromeを使う |
| `-sb, -show-browser` | ヘッドレス動作を可視化（デバッグ用） |
| `-pls, -page-load-strategy` | 待機条件（`heuristic` / `load` / `domcontentloaded` / `networkidle` / `none`） |
| `-dwt, -dom-wait-time` | DOMContentLoaded後の追加待機時間 |
| `-csp, -captcha-solver-provider` | CAPTCHA自動解決（capsolver） |

`-pls networkidle` は「一定時間ネットワークリクエストが途絶えるまで待つ」条件で、遅延読み込み（lazy loading）されるチャンクを確実に拾いたいときに使う。ただし常時ポーリング（WebSocketや定期的なヘルスチェックXHR）を行うページでは**networkidleが永遠に来ない**ため、`-ct, -crawl-duration` によるタイムアウトと併用しないと1ページで詰まる。

#### 5.2 スコープ制御：パイプラインの「キルスイッチ」

自動クロールで最も危険なのは、**スコープ外へ出ていくこと**である。リンクを辿るだけで、対象の外部SaaS、広告ドメイン、あるいは無関係な第三者サイトへリクエストを飛ばしうる。katanaのスコープ制御は次の5つ。

| フラグ | 役割 | 例 |
|---|---|---|
| `-fs, -field-scope` | 事前定義のスコープ境界 | `-fs rdn`（ルートドメイン単位）、`-fs fqdn`（そのFQDNのみ） |
| `-cs, -crawl-scope` | スコープ内とみなすURLの正規表現 | `-cs login/` |
| `-cos, -crawl-out-scope` | 除外するURLパターン | `-cos logout` |
| `-ns, -no-scope` | 既定のスコープ制御を無効化 | `-ns` |
| `-do, -display-out-scope` | スコープ外URLも出力に表示する | `-do` |

**なぜ `-fs rdn` が既定的に安全なのか**：`rdn`（root domain name）は eTLD+1、すなわち `app.example.com` に対する `example.com` を境界とする。これにより `api.example.com` や `static.example.com` は辿るが、`cdn.thirdparty.net` へは出ない。逆に `-fs fqdn` は「クロール開始したホスト名と完全一致するもののみ」なので、サブドメインをまたぎたくない場合に使う。

**`-cos logout` が実務で必須な理由**：クローラはリンクを機械的に辿るため、`/logout` や `/signout` を踏む。認証付きクロール（`-H 'Cookie: ...'`）をしている最中にこれを踏むと、**セッションが破棄されてそれ以降のクロールが全部ログイン前ページになる**。同様に `/delete`、`/unsubscribe`、`/cancel` のような**状態変更を伴うパス**は必ず除外する。これが記事タイトルにある「キルスイッチ」の実体であり、自動化におけるもっとも現実的な事故防止策である。

```sh
katana -u https://app.example.com \
  -fs rdn \
  -cos 'logout|signout|delete|remove|unsubscribe|cancel|reset' \
  -d 3 -ct 10m \
  -rl 20 -hrl 10 -c 5 \
  -jsonl -o endpoints.jsonl
```

`-ns`（スコープ無効化）は、**自動実行するパイプラインでは決して使ってはならない**。到達範囲が無制限になり、対象プログラムのスコープ外資産や無関係な第三者へトラフィックを送ることになる。

#### 5.3 深さ・レート・並列度

| フラグ | 制御対象 |
|---|---|
| `-d, -depth` | 最大クロール深度（既定 3） |
| `-ct, -crawl-duration` | クロールの時間上限 |
| `-c, -concurrency` | 1ターゲット内で同時に取得するURL数 |
| `-p, -parallelism` | 同時に処理するターゲット数 |
| `-rd, -delay` | リクエスト間の待機秒数 |
| `-rl, -rate-limit` | 全体の毎秒リクエスト数（既定 150） |
| `-hrl, -host-rate-limit` | ホストあたりの毎秒リクエスト数 |
| `-rlm, -rate-limit-minute` | 全体の毎分リクエスト数 |

**既定の `-rl 150` は「自分の回線とツールの能力」に対する上限であって、「相手が耐えられる量」ではない**。ここを理解していないと、単一ホストへ毎秒150リクエストを投げることになり、実質的にDoSである。重要なのは `-c`（ターゲット内同時実行）と `-p`（ターゲット間同時実行）と `-hrl`（ホスト毎秒）の関係で、**多数のホストを同時に薄く舐める**のが正しい形になる。すなわち `-p` を上げて `-c` と `-hrl` を下げる。逆の設定（`-p 1 -c 50`）は、1つのホストに全火力を集中させる最悪の形になる。

**深さ 3 が意味すること**：深度は「開始URLからのリンク辿り回数」であり、1ページあたりの平均リンク数を b とすると、探索対象は概ね b^d で増える。b=50、d=3 なら12万ページ規模になりうる。深度を1増やす判断は、**トラフィックを1桁増やす判断**と等価だと認識しておく必要がある。時間上限 `-ct` を必ず併設するのは、この指数的爆発に対する保険である。

#### 5.4 発見量を増やす仕組み：`-jc` と `-kf`

- `-jc, -js-crawl`：JavaScriptファイルの中身を解析してエンドポイントを抽出する。仕組みとしては、JSのソース中に現れる文字列リテラル（`"/api/v2/users"` のようなパスらしき文字列）や相対URLを検出して候補に加える。**JSを実行して得るのではなく静的に文字列を拾う**ため、`base + "/v2/" + resource` のように分割・結合されるパスは原理的に取り逃す。この限界を知らずに「JSクロールしたから全エンドポイントを網羅した」と考えるのが典型的な誤りである。
- `-kf, -known-files`：`robots.txt` と `sitemap.xml` を取りに行く。`robots.txt` の `Disallow:` は「検索エンジンに来てほしくないパス」の一覧であり、しばしば管理画面や内部ツールのパスがそのまま書かれている。sitemap.xml は逆に、リンクから辿れないページも含む正規のURL一覧を提供する。どちらもリンクグラフを辿るだけでは到達できない入口を、**1〜2リクエストで得られる**という費用対効果の極端に高い情報源である。

#### 5.5 出力の整形：フィールドとカスタム抽出

`-f, -field` は、クロール結果のどの部分を出力するかを選ぶ（READMEでは `-output-template` への移行が推奨されている）。利用できるフィールドは次の通り。

```
url, qurl, qpath, path, fqdn, rdn, rurl, ufile, file, key, value, kv, dir, udir
```

- `qurl` はクエリ文字列付きURL、`qpath` はクエリ付きパス。**パラメータfuzzingの候補を作るには `qurl` が要る**（クエリが無いURLはパラメータ探索の対象にならないため）。
- `key` / `value` / `kv` はクエリパラメータの名前・値・ペアを抜き出す。ここから「この対象でよく使われているパラメータ名」の辞書を作り、隠しパラメータ探索（arjun等）のワードリストとして再投入する、という**パイプラインの中で自分用の辞書を自己生成する**使い方ができる。
- `-sf, -store-field` はホストごとにフィールドを保存し、`-sfd, -store-field-dir` で保存先を変えられる。

さらに、`$HOME/.config/katana/field-config.yaml` で独自の抽出ルールを正規表現で定義できる。

```yaml
- name: email
  type: regex
  regex: ['([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)']
```

これは「クロールしたレスポンス本文に対して正規表現を適用し、マッチを名前付きフィールドとして出力する」機能で、`-flc, -field-config` で設定ファイルを指定する。対象組織固有の内部ホスト名パターンや社内トークン形式を知っている場合、ここに登録しておけばクロールと同時に抽出できる。

#### 5.6 重複の抑制：`-fsu` と `-pcs`

クローラを実務で使うと、出力の大半が `/users/1`, `/users/2`, … のような**同一テンプレートの別インスタンス**で埋まる。katanaはこれに2段階の対策を持つ。

- `-fsu, -filter-similar`：`/users/123` と `/users/456` のようにURL構造が似たものを重複排除する。`-fst, -filter-similar-threshold`（既定 10）で感度を調整する。
- `-pcs, -page-content-similar`：**ページ内容**の類似度で重複排除する。アルゴリズムとして simhash / tfidf / bm25 を選べる。

**simhashが効く理由**：simhashは文書を局所性鋭敏型ハッシュ（LSH）に落とす手法で、「内容がほぼ同じ文書は、ハッシュのハミング距離が小さくなる」という性質を持つ。通常の暗号学的ハッシュ（SHA-256等）は1バイト違えば全く別の値になるため類似判定に使えないが、simhashなら「商品IDだけが違う商品詳細ページ」を同一クラスタとして畳める。結果として、後段のnucleiに投げるURL数を桁で減らせる——これは**対象への負荷削減とスキャン時間短縮の両方に直結する**、パイプライン全体の効率を決める重要な設定である。

#### 5.7 認証付きクロールと分類機能

認証が必要な領域をクロールするには、ヘッダやCookieを渡す。

```console
katana -u https://example.com -H 'Cookie: session=VALUE'
```

ファイルからの読み込みも可能。

```console
katana -u https://example.com -H cookie.txt
```

また、リモートデバッグポートを開いた実ブラウザのセッションへ接続する方式もある。

```console
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
katana -headless -u https://example.com -cwu ws://127.0.0.1:9222/...
```

`-cwu`（connect to websocket url）は Chrome DevTools Protocol の WebSocket エンドポイントに接続する方式で、**既にログイン済み・MFA通過済みのブラウザセッションをそのまま使える**点が利点である。Cookieを手で抜き出す必要がなく、セッション更新（リフレッシュトークンによる再発行）もブラウザ側が面倒を見てくれる。ただし、自分の実ブラウザのセッション権限でクロールが走るということは、**そのアカウントが可能な操作をクローラが実行しうる**ことを意味する。5.2で述べた `-cos` による破壊的パスの除外は、このモードでは必須である。

`-kb` フラグは機械学習ベースのページ分類を有効化する。ページ種別（ログイン、エラー、CAPTCHA、パーキングドメイン）の判定、フォームとその入力欄の分類、`-kb-secrets`（露出したAPIキー／トークンの検出）、`-kb-endpoints`（REST/GraphQL/SOAP/XHRの分類）を提供する。分類モデルは初回利用時に `~/.dit/model.json` へ自動ダウンロードされる。

**この機能のパイプライン上の意味**：従来、クロール結果から「ログイン画面だけ抜く」「GraphQLエンドポイントだけ抜く」にはURLやタイトルの正規表現に頼るしかなく、`/auth`, `/signin`, `/login` のような命名の揺れで取り逃していた。分類器はページの構造・内容から判定するので、命名に依存しない。一方でMLベースである以上、誤分類は必ず存在し、モデルの更新によって**同じ入力でも日によって結果が変わりうる**。継続監視で差分を取る用途では、この非決定性が「差分の原因がモデル更新なのか対象変化なのか分からない」問題を生むため、**差分検知には分類結果ではなく生のURLを使う**のが安全である。

> 出典: projectdiscovery/katana README — https://github.com/projectdiscovery/katana
>
> 出典: Katana to Kill-Switch: Mastering ProjectDiscovery's Crawler from Zero to Pro — https://adce626.medium.com/katana-to-kill-switch-mastering-projectdiscoverys-crawler-from-zero-to-pro-with-real-world-62a7dec5a744 （本文は取得不可。上記の技術的事実は公式READMEに基づく）

---

### 6. パイプラインを壊す典型的な要因と対処

ここまでの部品を組み上げたあと、実運用で必ず遭遇する問題を仕組みとセットで整理する。

**(a) CDN/WAF によるブロックと汚染データ**
`cdncheck` でCDN配下のIPを識別し、ポートスキャン段から除外する。CDNエッジのIPは対象組織の資産ではなく共有インフラなので、スキャンしても無意味であるばかりか、**他テナントへの攻撃と解釈されうる**。また、WAFが全URLに200を返す設定の場合、コンテンツ探索の結果が全部「発見」になる。httpxの `-fr`（レスポンスサイズでのフィルタ）や、既知の存在しないパスを投げてベースラインを取る手法（いわゆるソフト404検出）が必要になる。

**(b) ワイルドカードDNSによる偽サブドメイン**
`*.example.com` が全て同一IPへ解決される設定だと、総当たり列挙の結果が数千件の偽サブドメインで埋まる。`dnsx` / `shuffledns` はワイルドカード検出機能を持つので、列挙段では必ず有効にする。検出の原理は「存在しないはずのランダムな名前（例: `a8f3k2-nonexistent.example.com`）を引いて、それが解決されるならワイルドカードと判定し、同じ応答を返す名前を除外する」というもの。

**(c) 非決定性と状態の汚染**
受動ソース（CTログ、パッシブDNS）は第三者のデータベースであり、同じクエリでも日によって返す件数が変わる。したがって「件数が減った＝資産が消えた」と即断できない。`anew` は追記のみで削除しないため、**累積ファイルは常に「これまでに一度でも観測された資産の和集合」**になる。これは意図的な設計で、消えたように見える資産が実はDNSレコードだけ消えてサーバは生きている、というケースを取りこぼさないために有効である。

**(d) APIキーとレート制限**
subfinder は多数の受動ソースを使うが、その多くはAPIキーが必要で、キー無しの場合は黙ってそのソースをスキップする。`-all` を付けると低速なソースも含めて全ソースを使う。結果が想定より少ないときは、まず `$HOME/.config/subfinder/provider-config.yaml` にキーが正しく設定されているかを疑う。キーは秘密情報なので、リポジトリにコミットしない。

**(e) バージョン依存**
本節のフラグ名と既定値は**2026年9月時点**の公式README（katana: Go 1.26+ / CGO_ENABLED=1 前提、`-rl` 既定150、`-d` 既定3、`-fst` 既定10、pdtm: Go 1.24.3 前提、`-bp` 既定 `$HOME/.pdtm/go/bin`）に基づく。PDツール群は更新頻度が高く、フラグの追加・非推奨化（例: katanaの `-f, -field` は `-output-template` への移行が推奨されている）が起きる。スクリプトを長期運用する場合は、**ツールのバージョンを固定し、更新は意図的なタイミングで行い、更新後に必ず既知の対象で出力を突き合わせる**こと。

---

### 7. まとめ：パイプライン設計の判断基準

1. **すべてのツールを「変換器」として捉える**。入力の型と出力の型が合っているか（ドメイン／ホスト／IP／URL）を常に意識し、合わないところには `jq`、`cut`、`dnsx`、`mapcidr` などの変換段を明示的に挟む。
2. **`-silent` と `-jsonl` を標準装備にする**。stdout は機械が読むものとして扱い、人間向けの情報は stderr とログファイルに分離する。
3. **段ごとにファイルへ落とし、`anew` で差分を取る**。これが再開可能性・冪等性・継続監視の3つを同時に実現する唯一のシンプルな方法である。
4. **火力は `-p`（ターゲット間並列）で稼ぎ、`-c` と `-hrl`（ホストあたり）で絞る**。既定のレート制限は「相手が耐えられる値」ではない。
5. **`-cos` による破壊的パスの除外と、`-fs` によるスコープ固定を、自動実行の前提条件にする**。`-ns` は自動化では使わない。
6. **ツールの自動更新と自動スキャンを同時に回さない**。差分の原因を切り分けられなくなる。

最後に改めて強調する。自動化は「より多く・より速く打てる」ことを意味するが、**打ってよい相手と範囲は自動化によって1ミリも広がらない**。パイプラインを組む前に、対象プログラムのスコープ定義と禁止事項（自動スキャン禁止、レート上限、対象外サブドメイン）を読み、それをスクリプトの除外リストとレート設定として**コードに落とし込む**こと。スコープはドキュメントではなく設定ファイルとして実装されて初めて、自動化の世界では機能する。

## オールインワンフレームワークと分散スケーリング

前節までで、個々のツール（subfinder、httpx、nuclei…）を自前のシェルスクリプトで繋ぐ「手組みパイプライン」の作り方を見てきた。本節では、その先にある二つのステップを扱う。ひとつは**オールインワンフレームワーク**（数十のツールの起動順・入出力・閾値制御をまとめて面倒見てくれる統合基盤）、もうひとつは**水平分散スケーリング**（1台では時間がかかりすぎる処理をクラウド上の多数のインスタンスへ分割して流す手法）である。

重要なのは、これらが「ボタンひとつで結果が出る魔法」ではないという点だ。オールインワン化と分散化は、**間違いも同じ倍率で増幅する**。だからこそ、内部で何が起きているのか（なぜその閾値があるのか、なぜそのツールだけが分散されるのか）を仕組みレベルで理解しておく必要がある。

> **本節のスコープ**: 本書は防御・自組織のアタックサーフェス管理（ASM: Attack Surface Management、自分たちが外部に露出している資産を継続的に洗い出して管理すること）を目的とする。実在サービスや本番環境への無許可の検証、破壊的な手順は扱わない。以下の設定例は、**自分が所有・管理権限を持つ資産**、または明示的に許可された範囲にのみ適用すること。

---

### reconFTW — モジュラー・オーケストレーションの代表例

#### 何を自動化しているのか

reconFTW は公式ドキュメントで「セキュリティリサーチャー、ペネトレーションテスター、バグバウンティハンター向けの**モジュラーな偵察自動化フレームワーク**」と定義されており、**80以上のセキュリティツール**を一本の偵察パイプラインとして統合する。単なるラッパー集ではなく、フェーズごとに責務が切られている。

| フェーズ | 主な内容 |
| --- | --- |
| OSINT | Google dorks、GitHub のシークレット走査、ドキュメントのメタデータ抽出、メールアドレス収集、API リーク、クラウド／S3 バケット列挙 |
| Subdomains | パッシブ収集、DNS ブルートフォース、AI による置換（permutation）生成、CT ログ、ゾーン転送、サブドメインテイクオーバー検出 |
| Web Analysis | HTTP プローブ、スクリーンショット、JS 内シークレット、ディレクトリファジング、CMS 判定、GraphQL／gRPC 探索 |
| Vulnerabilities | Nuclei テンプレート、XSS、SQLi、SSRF、LFI、SSTI、CORS、プロトタイプ汚染、WAF バイパス |
| Host Analysis | ポートスキャン（nmap／naabu）、CDN 判定、WAF フィンガープリント、ジオロケーション |
| Automation | チェックポイント／レジューム、差分（incremental）スキャン、Slack／Discord／Telegram 通知、分散スキャン |

実装は8つのモジュールに分割されている。`core.sh`（ライフサイクル、ロギング、通知、クリーンアップ）、`modes.sh`（スキャンモード定義と引数パース）、`subdomains.sh`、`web.sh`、`vulns.sh`、`osint.sh`、`utils.sh`（共通ユーティリティと検証）、`axiom.sh`（分散フリート管理）である。**このファイル分割がそのまま「自分のパイプラインをどう設計すべきか」の設計図**になっている点は、フレームワークを使わない読者にとっても参考になる。

#### スキャンモード — 「どこまでやるか」を一文字で切り替える

```bash
git clone https://github.com/six2dez/reconftw.git
cd reconftw
./install.sh
./reconftw.sh -d example.com -r
```

ターゲット指定とモード指定が直交しているのが設計上のポイントである。

| 種別 | フラグ | 意味 |
| --- | --- | --- |
| ターゲット | `-d` | 単一ドメイン |
| | `-l` | ドメイン一覧ファイル |
| | `-m` | 企業名による複数ドメイン走査 |
| | `-x` / `-i` | スコープ外サブドメインの除外／スコープ内のみに限定 |
| モード | `-p` (Passive) | パッシブのみ。対象へ一切パケットを送らない |
| | `-s` (Subdomains) | サブドメイン列挙＋Web プローブ |
| | `-r` (Recon) | 能動的な攻撃を伴わないフル偵察 |
| | `-a` (All) | フル偵察＋能動的な脆弱性チェック |
| | `-w` (Web) | 指定した Web ターゲットのみの検査 |
| | `-n` (OSINT) | OSINT モジュールのみ |
| | `-z` (Zen) | 基本チェックのみの軽量偵察 |
| | `-c` (Custom) | 特定の関数だけを実行 |
| 全般 | `--deep` | 拡張スキャン（VPS 推奨） |
| | `-f` / `-o` | 設定ファイル／出力先の指定 |
| | `-v` / `--vps-count` | Ax 分散スキャンの有効化／インスタンス数の上書き |
| | `-q` | レートリミット（requests per second） |
| | `--incremental` | 前回実行以降の新規分のみ走査 |
| | `--quick-rescan` | 新規発見が少なければ重いモジュールを省略 |
| | `--adaptive-rate` | エラー発生時にレートを自動調整 |
| | `--parallel` | 独立した関数を並行実行 |
| | `--monitor` | 継続監視モード |
| | `--dry-run` / `--health-check` | 実行せず計画を表示／環境の妥当性検証 |
| | `--export` | レポート出力（json, html, csv, all） |

防御目的の運用で最初に覚えるべきは `-p` と `--dry-run` である。**`-p` は対象のインフラに一切触れずに済む**ため、許可プロセスが完了していない段階や、自社資産の棚卸しの初期段階で安全に使える。`--dry-run` は「この設定でどのモジュールが走るか」を実行前に見せてくれるので、誤って能動スキャンを本番に向けてしまう事故を構造的に防げる。

出力は `subdomains/`、`hosts/`、`webs/`、`urls/`、`vulns/`、`osint/`、`ai_result/`、`report/` とフェーズ単位のディレクトリに整理される。この構造は後段の差分検知（前回の `subdomains/subdomains.txt` との `comm -13`）を素直に書けるようにするための設計であり、自作パイプラインでも踏襲する価値がある。

> 出典: reconFTW Documentation (Introduction) — https://docs.reconftw.com/
> 出典: six2dez/reconftw README — https://github.com/six2dez/reconftw

#### 設定ファイルこそが本体 — `reconftw.cfg`

reconFTW は**300以上の設定オプション**を `reconftw.cfg` で持ち、認証情報は `secrets.cfg` に分離する（こちらはコミットしてはならない）。API キーは環境変数、`secrets.cfg`、Docker のランタイムシークレットのいずれかで渡し、設定ファイルへのハードコードは避ける、という方針が明記されている。これは単なる行儀の問題ではない。偵察フレームワークの設定ファイルには Shodan、Censys、GitHub、各種クラウドのトークンが集まるため、**リポジトリに1回混入しただけで、そのトークンが持つ全権限が外部の偵察対象になる**（皮肉なことに、reconFTW 自身の OSINT フェーズが探すのはまさにその種の漏洩である）。

##### 閾値による「組合せ爆発」の抑制

```bash
DEEP=false
DEEP_LIMIT=500
DEEP_LIMIT2=1500
```

ここが初学者に最も誤解されやすい部分である。`DEEP_LIMIT=500` は「サブドメイン等の入力件数が 500 を超えたら、重いモジュールを既定ではスキップする」という一次閾値、`DEEP_LIMIT2=1500` はさらに強い制限をかける二次閾値であり、`DEEP=true` にするとこれらの制限が解除されて網羅的スキャンになる。

**なぜ閾値が必要なのか**。パイプライン後段のコストは入力件数に対して線形では増えないからである。たとえば「サブドメイン N 件 × ポート P 個 × ディレクトリ辞書 W 語 × パラメータ辞書 K 語」というファジング系の処理は、N が 50 から 5,000 に増えた瞬間にリクエスト総数が 100 倍になる。さらに permutation（`dev`, `stg`, `api` などの語をサブドメイン要素へ機械的に組み合わせて候補を生成する手法）は、既知サブドメイン N 件と語彙 M 語から O(N×M) の候補を作り、その全件を DNS 解決しにいく。**閾値は「事故的に数百万リクエストを発射しない」ための安全装置**であって、単なる性能チューニングではない。`--deep` を付けるときは、対象の規模と、自分の回線・リゾルバ・許可範囲がそれに耐えるかを先に見積もること。

##### スレッド数とレートリミットの分離

```bash
# CPU コア数 (AVAILABLE_CORES) に応じて自動スケールする並列度
FFUF_THREADS=$(( AVAILABLE_CORES * 10 ))
HTTPX_THREADS=$(( AVAILABLE_CORES * 12 ))
DALFOX_THREADS=$(( AVAILABLE_CORES * 15 ))
DNSX_THREADS=100
TLSX_THREADS=1000

# 対象側への負荷の上限（req/s）
HTTPX_RATELIMIT=150
NUCLEI_RATELIMIT=150
```

**スレッド数（並列度）とレートリミット（秒あたりリクエスト数）は別物である**。スレッド数は「自分のマシンが同時に抱えられるソケット／プロセスの数」、レートリミットは「相手に到達する毎秒のリクエスト数」を決める。前者だけを上げると、自分側の CPU・ファイルディスクリプタ・DNS リゾルバが先に飽和して、**タイムアウトを本物の「応答なし」と誤認する**（偽陰性）。逆に後者を上げすぎれば相手の WAF／レートリミッタに引っかかり、429/503 が返って**それを「脆弱でない」と誤判定する**。`TLSX_THREADS=1000` のように極端に高い値が許されるのは、TLS ハンドシェイクだけを取る処理が CPU よりネットワーク I/O 待ちに支配される（I/O バウンド）からであり、`FFUF` のようにレスポンス本文を解析する処理では同じ値にしてはいけない。

##### 動作モードのトグル

```bash
PARALLEL_MODE=true        # 相互依存のない関数を並行実行
INCREMENTAL_MODE=false    # 前回からの新規発見のみを対象にする
MONITOR_MODE=false        # --monitor による継続監視
ADAPTIVE_RATE_LIMIT=false # 429/503 を検知してレートを自動降下
```

`ADAPTIVE_RATE_LIMIT` は防御的運用と相性が良い。HTTP 429（Too Many Requests）や 503（Service Unavailable）は、**相手側のインフラが「もう受け切れない」と明示的に通知している信号**である。これを無視して定速で撃ち続ける偵察は、自社環境相手であってもサービス影響を出しうるし、結果の信頼性も落ちる。`ADAPTIVE_RATE_LIMIT=true` は、その信号をフィードバックループとして使い、実効スループットを相手の許容量に収束させる。継続的な ASM 運用では、固定レートより適応レートのほうが**長期的な総取得量は増える**（止められないため）。

`INCREMENTAL_MODE` と `--quick-rescan` は、継続監視で本質的に効いてくる。毎日フルスキャンを回すのは無駄であり、実務上知りたいのは「昨日と比べて何が増えたか」——新しいサブドメイン、新しく開いたポート、新しく現れたエンドポイントである。差分だけを重いモジュールに流せば、**1日1回のフルスキャンより、1時間ごとの差分スキャンのほうが検知が速く、かつ総負荷は軽い**。

> 出典: reconFTW Documentation (Introduction) — https://docs.reconftw.com/

---

### Ax / Axiom による水平分散

#### 仕組み — 「入力ファイルを割って配って集める」

Axiom（現在は Ax としてメンテナンスが継続されている）は、クラウド上に使い捨てのインスタンス群（**fleet**）を立ち上げ、そこへ偵察ツールを配って並列実行するためのフレームワークである。reconFTW ドキュメントは、これにより偵察を水平スケールさせ、スキャン時間を「数時間から数分へ」短縮できるとしている。

原理は素朴だが強力だ。`axiom-scan` は、**入力ファイル（ターゲット一覧）を fleet のインスタンス数で分割し、各インスタンスで同じコマンドを自分の担当分に対して実行し、出力を手元にマージして戻す**。Ax の主要コマンドは以下の5つに整理される。

| コマンド | 役割 |
| --- | --- |
| `axiom-fleet` | インスタンス群の新規デプロイ |
| `axiom-ls` | インスタンスと状態の一覧 |
| `axiom-exec` | 全インスタンスでの任意コマンド実行 |
| `axiom-scan` | スキャン処理の分散実行（split → 並列 → merge） |
| `axiom-rm` | インスタンスの破棄とクリーンアップ |

```bash
# インストール（Ax）
bash <(curl -s https://raw.githubusercontent.com/attacksurge/ax/master/interact/axiom-configure) --run

# 認証情報とプロバイダの設定
axiom-configure

# fleet の起動・確認・破棄
axiom-fleet reconftw -i 10
axiom-ls
axiom-rm "reconftw*" -f
```

対応プロバイダは Digital Ocean（推奨）、IBM Cloud、Linode、Azure、AWS、Hetzner、GCP、Scaleway、Exoscale の9つ。どのツールをどう分散するかは**モジュール定義（JSON）**で記述され、単発実行用の one-shot モジュール、既存モジュールのマージ・拡張、JSON／HCL によるカスタムプロビジョナ定義に対応する。この「モジュール JSON がツールごとの分割戦略を持つ」という設計が肝で、**入力を行単位で割ってよいツールだけが素直に分散できる**ことを意味する。

> 出典: Ax (attacksurge/ax) README — https://github.com/attacksurge/ax

#### reconFTW からの使い方

reconFTW 側では `reconftw.cfg` の Ax セクションで fleet を宣言し、実行時に `-v`（`--vps`）を付けるだけでよい。

```bash
AXIOM=true
AXIOM_FLEET_LAUNCH=true        # 未起動なら自動で fleet を立ち上げる
AXIOM_FLEET_NAME="reconFTW"    # インスタンス名のプレフィックス
AXIOM_FLEET_COUNT=10           # インスタンス数
AXIOM_FLEET_REGIONS="eu-central"
AXIOM_FLEET_SHUTDOWN=true      # スキャン後に自動で破棄
AXIOM_THREADS=...              # 1インスタンスあたりのスレッド数
AXIOM_INSTANCE_TYPE="s-1vcpu-1gb"
AXIOM_RESOLVERS_PATH="/home/op/lists/..."   # fleet 側のリゾルバ一覧のパス
```

```bash
./reconftw.sh -d example.com -a --vps
./reconftw.sh -d example.com -a -v
./reconftw.sh -d target.com -r -v 30   # 第2引数でインスタンス数を上書き
```

分散対象となるのは、reconFTW ドキュメントによれば **subfinder、httpx、nuclei、ffuf、dnsx、nmap、katana、dalfox** であり、いずれも「ターゲット分割（target split）」方式で各インスタンスが部分集合を処理する。

**なぜこの8つなのか**を考えると、分散の適用条件が見えてくる。これらは全て「入力が行単位で独立しており、行 i の処理結果が行 j の処理に影響しない」——つまり **embarrassingly parallel（自明並列）** な処理である。逆に、
- **状態を跨いで共有する必要がある処理**（再帰的なサブドメイン列挙で、新発見を次のラウンドの入力に戻すようなループ）
- **グローバルな重複排除が必要な処理**（マージ後でないと正しく数えられない）
- **単一の外部 API のクォータを消費する処理**（パッシブ収集の API キーはアカウント単位でレート制限されるため、10台に増やしても総取得量は増えず、むしろ一斉アクセスで BAN される）

は分散に向かない。`AXIOM_RESOLVERS_PATH` がわざわざ fleet 側のパスとして設定されているのも同じ理由で、**DNS リゾルバ一覧は全インスタンスに配って各自が引く**必要がある。ここを誤って1台の共有リゾルバに集中させると、そのリゾルバが詰まってタイムアウトが偽陰性を生む——10台に増やした結果、精度が落ちるという最悪のパターンになる。

#### レートリミットの算術（最重要）

分散時に最も事故りやすいのがここである。`HTTPX_RATELIMIT=150` を設定したまま 10 インスタンスの fleet で走らせると、**対象が受ける実効レートは 150 req/s ではなく 1,500 req/s になる**。各インスタンスはそれぞれ独立に自分のレートリミッタを持っているだけで、fleet 全体での協調は行われないからだ。許可された上限が 150 req/s なのであれば、

```
1インスタンスあたりのレート = 全体の許容レート ÷ インスタンス数
                            = 150 ÷ 10 = 15 req/s
```

と**割り算してから**設定しなければならない。送信元 IP が 10 個に分散されるため相手側のレートリミッタには引っかかりにくくなる——つまり**事故が起きても止めてもらえない**。これは「WAF をすり抜けるテクニック」としてではなく、「自分で制御しなければ誰も止めてくれない」というリスクとして理解すべきである。自組織の ASM であっても、本番への総流量は事前に見積もり、メンテナンス窓や監視チームへの事前連絡とセットで運用する。

#### コストと寿命

reconFTW ドキュメントは「10インスタンス × $0.007/hr = $0.07/hr」、スキャン所要2時間で **1回の偵察あたり約 $0.14** という試算を挙げている。この安さが分散偵察の実用性を支えているが、コスト管理上の要点は単価ではなく**寿命**である。`AXIOM_FLEET_SHUTDOWN=true` を設定し忘れた fleet は走り続け、月末の請求で気付くことになる。運用ルールとしては、

1. `AXIOM_FLEET_SHUTDOWN=true` を既定にする
2. スキャンが異常終了する場合に備え、`axiom-ls` の定期確認と `axiom-rm "<prefix>*" -f` を cron 等に置く
3. fleet 名にプレフィックス（`AXIOM_FLEET_NAME`）を必ず付け、他用途のインスタンスを巻き込んで削除しないようにする

の3点を押さえる。3番目は地味だが重要で、`axiom-rm "*" -f` のようなワイルドカードは同一アカウント内の無関係なインスタンスまで消しうる。

> 出典: reconFTW Documentation — Axiom Integration — https://docs.reconftw.com/integrations/axiom

---

### フレームワークの地図 — 何を選ぶべきか

s0cm0nkey のリファレンスガイドは、偵察フレームワークを目的別に整理している。まず古典的な三本柱。

- **SpiderFoot**（https://www.spiderfoot.net/）— 「Web UI とテンプレート、多数のモジュールを備えた OSINT 自動化プラットフォーム。公開情報や API から対象データを収集する」
- **Recon-ng**（https://github.com/lanmaster53/recon-ng）— 「モジュラーな Python 製偵察フレームワーク」。再利用可能なモジュール、API ルックアップ、構造化出力に向く
- **Maltego**（https://www.maltego.com/）— 「人物・ドメイン・インフラ・ソーシャルアカウント等のエンティティを結びつけるグラフィカルなリンク解析／OSINT プラットフォーム」

続いて、攻撃的偵察および ASM 寄りのフレームワーク群。

| ツール | 位置づけ |
| --- | --- |
| BBOT | 再帰的・モジュラーなフレームワーク。サブドメイン列挙、ポートスキャン、スクリーンショット |
| ReconFTW | ドメイン／バグバウンティ対象向けの自動化ワークフロー |
| Sn1per | OSINT・スキャン・レポーティングを含む自動偵察／ペンテストフレームワーク |
| reNgine | Web アプリ偵察。エンジン定義と継続監視 |
| OWASP Amass | 外部アタックサーフェスのマッピング |
| runZero | ネットワーク探索と資産インベントリ |
| ReconNess | ターゲット整理のための管理プラットフォーム |
| Axiom | 分散偵察インフラのフレームワーク |
| JupyterPen | Jupyter ベースの OSINT／ペンテスト環境 |

さらに sn0int、Raccoon、ReconSpider、OWASP Maryam、Discover Scripts、DMitry、finalrecon、gasmask、machinae といった特化型ツールが列挙されている。なお同ガイドは **DarkSide、hackingtool、eReKon については利用前に検証すべき（flagged for validation）** と注記している。**素性の確認されていない「オールインワン」スクリプトを無警戒に実行しない**——偵察ツールは大量の外部バイナリをダウンロードし、API キーを読み、ネットワークへ出ていく。サプライチェーンとして最も甘くなりやすい領域である。

この一覧から読み取るべきは個々の名前ではなく、**4つの層に分かれている**という構造である。

1. **相関・調査層**（Maltego、SpiderFoot、Recon-ng）— 人・組織・資産の関係をグラフとして辿る。ヒトが介在する調査向き
2. **パイプライン層**（reconFTW、Sn1per、BBOT）— 発見から検証までを一気通貫で回す。CI 的に繰り返す用途
3. **ASM／継続監視層**（reNgine、ReconNess、runZero、Amass）— 結果を DB に持ち、時系列の差分と資産台帳を管理する
4. **インフラ層**（Axiom / Ax）— 上のどの層に対しても直交して「計算資源を掛ける」

3層目と4層目の区別が特に重要だ。**スケールの問題（遅い）と、継続性の問題（前回との差分が分からない）は別の問題**であり、前者は Ax で、後者はデータベースを持つプラットフォームで解く。両方を同じツールに求めると設計が破綻する。

> 出典: Recon Frameworks — s0cm0nkey's Security Reference Guide — https://s0cm0nkey.gitbook.io/s0cm0nkeys-security-reference-guide/red-offensive/scanning-active-recon/recon-frameworks

---

### reconFTW / reNgine / AutoRecon の比較

> ⚠️ **未取得の資料**: 「A list of automated recon tools」（cybersecuritywriteups.com）は自動取得できませんでした（理由: サーバーが HTTP 403 Forbidden を返し、`?gi=` 付きの代替 URL でも同様にブロックされたため）。以下のURLからご自身で直接ご覧ください: https://cybersecuritywriteups.com/a-list-of-automated-recon-tools-f0d034429532
>
> 記事の要旨は検索結果から確認できた範囲で以下の通りです。reconFTW は「パッシブ解析、ブルートフォース、permutation、CT ログ、ソースコードのスクレイピング、アナリティクス ID、DNS レコード」という複数手法でサブドメインを発見し、XSS・オープンリダイレクト・SSRF・CRLF・LFI・SQLi・SSL の問題・SSTI・DNS ゾーン転送などの脆弱性評価を行う。AutoRecon は「サービスの自動列挙を行うマルチスレッドのネットワーク偵察ツール」で、まずポートスキャン／サービス検出を行い、その結果に応じて後続の列挙スキャンを起動する（例: HTTP が見つかれば feroxbuster を起動する）。記事はほかに MagicRecon、LazyRecon、BugBountyScanner、ReconPi なども挙げている。

（以下は未取得資料の補足として、公開ドキュメントと一般知識に基づく解説です。）

#### reNgine — DB を持つプラットフォーム型

reNgine は Django + Celery + Docker Compose で構成される Web アプリ偵察スイートである。ここが reconFTW との決定的な違いで、**reconFTW が「ファイルシステムに出力する Bash パイプライン」であるのに対し、reNgine は「結果をリレーショナル DB に蓄積する常駐アプリケーション」**である。

```yaml
# reNgine の Scan Engine は YAML で宣言する（概念例）
# 実際のエンジン定義は Web UI 上で編集・複製できる
subdomain_discovery:
  uses_tools: [subfinder, ctfr, sublist3r]
  threads: 30
port_scan:
  ports: [top-100]
  rate_limit: 150
```

- **Celery のワーカー並列度**は `MAX_CONCURRENCY` / `MIN_CONCURRENCY` で制御する。ドキュメントの推奨は RAM 4GB で MAX=10、8GB で MAX=30、16GB で MAX=50、高負荷用途では最大 80、平常時の下限は 10。**メモリ量に応じて並列度を決める**という指針は、各ワーカーが独立したツールプロセス（と、そのメモリ常駐の辞書やレスポンスバッファ）を抱えるためである。ここを CPU コア数基準で決めると OOM で落ちる
- **Subscan** は「reNgine を他と分ける画期的な機能で、この種のオープンソースツールで唯一」と位置づけられる。パイプライン全体の完走を待たずに、**走査中に新しく見つかったサブドメインに対してポートスキャンや脆弱性評価を個別に起動できる**。前項の「自明並列でない処理」の一部を、人間の判断を挟んで解く現実的な折衷案といえる
- **継続監視**は clocked scan（指定時刻）と periodic scan（一定間隔）に対応し、Discord／Slack／Telegram へ通知する

> 出典: reNgine README (yogeshojha/rengine) — https://github.com/yogeshojha/rengine

#### 三者の設計軸

| 観点 | reconFTW | reNgine | AutoRecon |
| --- | --- | --- | --- |
| 主対象 | ドメイン／外部アタックサーフェス | Web アプリ資産 | ホスト上のサービス（内部ネットワーク／CTF・OSCP 系） |
| 実行モデル | Bash オーケストレーション（CLI） | Django + Celery 常駐（Web UI） | Python マルチスレッド（CLI） |
| 起点 | ドメイン名 | ドメイン／組織 | IP／ホスト（ポートスキャン結果） |
| 状態保持 | ファイルツリー＋チェックポイント | リレーショナル DB | 実行ディレクトリ |
| 継続監視 | `--monitor` / `--incremental` | スケジューラ内蔵 | なし（単発前提） |
| スケール手段 | Ax による水平分散（`-v`） | Celery ワーカーの垂直/水平増強 | ホスト内スレッド数 |

**選択の指針**は単純で、「入口がドメインか IP か」「結果を時系列で持ちたいか」の2軸でほぼ決まる。外部から未知の資産を広く掘りたいなら reconFTW、見つけた資産を台帳として運用したいなら reNgine、既に到達できるホスト群のサービスを深掘りしたいなら AutoRecon 系、という住み分けになる。

---

### 分散化の落とし穴と、防御側としての運用

オールインワン＋分散は、精度に対して中立ではない。増幅されるのは速度だけではない。

**1. 偽陽性の増幅**。Nuclei テンプレートやテイクオーバー判定は、ワイルドカード DNS や CDN のデフォルトページに対して誤検知を出しうる。1台なら目視で気付く誤検知も、10台×数万ホストになると通知チャネルが埋まり、**本物のアラートが埋没する**。`--export json` で機械可読に出し、**前回結果との差分だけを人に見せる**運用が必須になる。

**2. 偽陰性の増幅**。前述のとおり、リゾルバ飽和・レート超過による 429/503・タイムアウトは、いずれも「存在しない」と区別がつかない。分散前に必ず**小規模な既知の正解セット**（自分が存在を知っているサブドメインやエンドポイント）を混ぜて流し、それが検出されるかで設定の健全性を確認する。これは機械学習でいうカナリアテストに相当し、`--health-check` や `--dry-run` と併せて習慣化する価値がある。

**3. スコープの逸脱**。permutation と再帰列挙は、**許可されていない第三者のホスト名を生成しうる**。reconFTW の `-x`（除外）/`-i`（スコープ内限定）のようなフィルタを、パイプラインの出力側ではなく**能動モジュールの入力側**に必ず挟むこと。出力を後でフィルタしても、パケットは既に飛んでいる。

**4. 検知される側から見た姿**。防御担当としては、これらのフレームワークがログに何を残すかを知っておくと有用である。分散偵察は「複数のクラウド IP（同一 ASN・同一リージョン）から、短時間に、辞書由来の規則的なホスト名・パスへ、同一の User-Agent 傾向でアクセスが来る」という形で現れる。単一 IP のレート閾値では検知できないため、**ASN 単位・リージョン単位での集約、存在しないホスト名への DNS クエリ急増（NXDOMAIN レート）、404 の分布の偏り**といった指標を監視側の検知ロジックに入れる。つまり本節の知識は、そのまま自組織の検知チューニングに転用できる。

**5. 再現性**。フレームワークはバージョンで挙動が変わる。reconFTW は80以上のツールを束ねており、依存ツールの更新で結果が変動する。**スキャンごとに `reconftw.cfg` と各ツールのバージョン、実行日時を成果物と一緒に保存**しておかないと、「先月は検出されたのに今月は出ない」が設定変更によるものか環境の変化によるものか切り分けられなくなる。本節で挙げた設定値（`DEEP_LIMIT=500`、`AXIOM_FLEET_COUNT=10` など）も執筆時点（2026年9月）のリポジトリ既定値であり、追従が必要である。

### まとめ — 導入チェックリスト

1. **`-p`（パッシブ）と `--dry-run` から始める**。能動モジュールは許可範囲を確定してから
2. **スコープフィルタ（`-x` / `-i`）を能動モジュールの入力側に置く**
3. **`DEEP` を上げる前に、入力件数 × 辞書サイズでリクエスト総数を見積もる**
4. **分散するなら、レートリミットをインスタンス数で割ってから設定する**
5. **`AXIOM_FLEET_SHUTDOWN=true` とプレフィックス付き fleet 名、`axiom-rm` の後始末を運用に組み込む**
6. **`secrets.cfg` をコミットしない**。API キーは環境変数かランタイムシークレットで
7. **既知の正解セットをカナリアとして混ぜ、偽陰性を検出する**
8. **差分（`--incremental`）を主、フルスキャンを従にする**。継続監視では差分こそが価値
9. **スケールの問題（Ax）と継続性の問題（DB を持つプラットフォーム）を混同しない**

## TomNomNom流Unix哲学とデータ運用

### 9c.1 なぜ「小さなツール」が偵察を強くするのか

Recon（偵察）の自動化には二つの流派がある。ひとつは reconFTW や reNgine のように「全部入り」のフレームワークを回す流派。もうひとつが、Tom Hudson（ハンドルネーム **TomNomNom**）が体現する、**単機能のツールをパイプでつなぐ**流派である。後者はUnix哲学 —— "Do one thing and do it well"（ひとつのことだけをうまくやる）、"Write programs to work together"（プログラムは協調するように書く）、"Handle text streams, because that is a universal interface"（テキストストリームを扱え。それが普遍的なインタフェースだから）—— の直系である。

Daniel Miesslerはこの点を「discrete, Unixy tools are powerful because they can be combined in extraordinary ways（個別に切り出されたUnix的なツールは、とんでもない仕方で組み合わせられるから強力なのだ）」と要約している。重要なのは、これが単なる美学ではなく**偵察という問題領域に構造的に適合している**ことだ。

- 偵察のデータは本質的に**改行区切りのフラットなリスト**である（ドメイン1行、ホスト1行、URL1行）。JSONのような入れ子構造を必要としない。そのため `stdin`/`stdout` のテキストストリームが損失なく使える。
- 偵察は**同じ対象に何度も走らせる反復作業**である。よって「前回との差分」を扱う機構が中核になる。
- 偵察のワークフローは**人によって・対象によって違う**。フレームワークは他人の手順を押し付けるが、パイプラインは自分の手順を組み立てられる。

本節では、まず個々のツールが「何をしないか」まで含めて仕組みレベルで理解し、次にTomNomNom自身がShopifyのバグバウンティで見せた実演ノートから、**ファイルを状態（state）として運用するデータ運用の型**を抽出する。

> 本節は防御・学習目的で記述する。ここで扱うコマンドは、自組織の資産、または明示的に許可されたバグバウンティ対象に対してのみ実行すること。実在サービスへの無許可のスキャンや、レート制限を無視した大量リクエストは行ってはならない。

---

### 9c.2 ツール群の解剖 —— 「何をしないか」で設計されている

Miesslerのprimerが取り上げるのは `gf` / `httprobe` / `unfurl` / `meg` / `anew` / `waybackurls` の6本である。それぞれ原典のREADMEに当たって、動作原理まで踏み込む。

#### anew —— 「重複を落とす `tee -a`」が状態管理の中心になる

READMEの定義はこうだ。

> Append lines from stdin to a file, but only if they don't already appear in the file. Outputs new lines to `stdout` too, making it a bit like a `tee -a` that removes duplicates.
> （標準入力から来た行をファイルに追記する。ただしそのファイルにまだ存在しない行だけを。新しい行は標準出力にも出すので、重複を除去する `tee -a` のようなものになる。）

```
▶ cat things.txt
Zero
One
Two

▶ cat newthings.txt
One
Two
Three
Four

▶ cat newthings.txt | anew things.txt
Three
Four
```

**なぜこう動くのか**：`anew` は起動時に対象ファイルを1回読み込み、各行をハッシュ集合（Goの `map[string]bool`）に載せる。以降は標準入力を1行ずつ読み、集合に問い合わせて（平均O(1)）、無ければ①ファイルに追記し②標準出力にも書く。この設計から3つの性質が導かれる。

1. **順序が保存される**。`sort -u` と違って既存の並びを壊さない。偵察ファイルは「発見順＝時系列」になっているほうが後から追いやすい。
2. **ストリーミングで動く**。入力全体をメモリに溜めない（メモリ消費は既存ファイルのサイズにのみ比例する）。数百万行のURLリストでも詰まらない。
3. **標準出力が「差分」になる**。これが決定的に重要で、`anew` は追記ツールであると同時に**差分検出器**である。継続監視（Lv10）で「新しく出現したサブドメインだけを通知する」処理が、`| anew domains | notify` の1本で書けるのはこの性質のおかげだ。

フラグは2つだけ。`-d`（dry-run：標準出力には出すがファイルは書き換えない）と `-q`（quiet：ファイルには追記するが標準出力には何も出さない）。なお新しい行は標準出力に出るので、`cat newthings.txt | anew things.txt > added-lines.txt` のように「今回増えた分」をそのままファイルに落とせる。

#### httprobe —— 生きているホストを絞る

```
▶ cat domains.txt | httprobe
http://example.com
http://example.net
https://example.com
```

ドメインのリストを受け取り、HTTP（80番）とHTTPS（443番）に接続を試み、**応答したものだけをスキーム付きURLとして出力する**。内部ではワーカプール（既定20並列）を作り、各ワーカがTCP接続→（HTTPSならTLSハンドシェイク）→HTTPリクエストを行う。

主要フラグと、それぞれが効く理由：

| フラグ | 意味 | なぜ必要か |
|---|---|---|
| `-c <n>` | 並列数（既定20） | 待ち時間の大半はネットワークI/O。並列数を上げると総時間はほぼ線形に短縮されるが、対象側への負荷も線形に増える |
| `-t <ms>` | タイムアウト（ミリ秒） | 応答しないホストに張り付くと全体が詰まる。既定より短くすると速いが取りこぼす |
| `-p <proto:port>` | 追加プローブ（例 `-p http:81 -p https:8443`） | 管理画面や開発用サービスは非標準ポートに載っていることが多い |
| `-s` | 既定の80/443を試さない | `-p` で指定した非標準ポートだけを狙うとき |
| `--prefer-https` | HTTPSが通ったらHTTPは試さない | 同一ホストについて2行出るのを防ぎ、**リクエスト数をほぼ半減**させる |

`--prefer-https` は地味に見えて、後段のパイプライン全体の入力量を半分にする。1ホストにつき `http://` と `https://` の2行が下流に流れると、`meg` や `waybackurls` の処理量も倍になるからだ。

#### waybackurls —— アーカイブを「押す」のではなく「読む」

```
▶ cat domains.txt | waybackurls > urls
```

ドメインを受け取り、Wayback Machineが `*.domain` について保持している既知URLを列挙する。対象サーバには一切リクエストを送らない passive recon（受動偵察）である。内部ではInternet ArchiveのCDX API（Capture inDeX API）を叩いている。mhmdiaa氏の `waybackurls.py` に着想を得たツールだと原典に明記がある。

#### unfurl —— URLを部品に分解する

URLを構造として扱うための唯一の道具。`domains` / `paths` / `keys` / `values` / `keypairs` / `apexes` / `json` / `format` といったモードがあり、`-u`（`--unique`）は全モードで重複を落とす。

```
▶ echo https://sub.example.com/users?id=123&name=Sam | unfurl domains
sub.example.com

▶ cat urls.txt | unfurl keys          # クエリパラメータ名だけを抽出
▶ cat urls.txt | unfurl -u apexes     # ユニークなapexドメイン（example.com）だけ
▶ cat urls.txt | unfurl format %d%p   # ドメイン＋パス
```

`format` モードの書式指定子は次の通り（原典README）：`%s` scheme、`%d` domain、`%S` subdomain、`%r` root、`%t` TLD、`%P` port、`%p` path、`%e` extension、`%q` query string、`%f` fragment、`%a` authority、`%@`（userinfo があれば `@`）、`%:`（portがあれば `:`）、`%?`（queryがあれば `?`）、`%#`（fragmentがあれば `#`）、`%%`（リテラルの `%`）。

**なぜ `sed` や正規表現ではなく `unfurl` なのか**：URLのパースは正規表現で書くと必ずどこかで壊れる（ポート付き、userinfo付き、IPv6リテラル `http://[::1]:8080/`、パーセントエンコードされたパスなど）。`unfurl` はGo標準の `net/url` パーサを使うため、**ブラウザやサーバ側の実装に近い解釈**になる。偵察データの正規化で正規表現の自作パーサを使うのは、静かな取りこぼしの温床である。

#### gf —— grepのパターンに名前を付ける

TomNomNom自身が動機をこう書いている。複雑なパターンを毎回手打ちすると打ち間違えるし、「結果がゼロなのは本当に無いからか、パターンをミスったからか」が分からなくなる。

```
▶ grep -HnrE '(\$_(POST|GET|COOKIE|REQUEST|SERVER|FILES)|php://(input|stdin))' *
```

これが `gf php-sources` の一言になる。定義は `~/.gf/` に小さなJSONファイルとして置く（バージョン管理できるのが狙い）。

```json
▶ cat ~/.gf/php-sources.json
{
    "flags": "-HnrE",
    "pattern": "(\\$_(POST|GET|COOKIE|REQUEST|SERVER|FILES)|php://(input|stdin))"
}
```

長くなるときは `patterns` 配列に分割できる。

```json
▶ cat ~/.gf/php-sources-multiple.json
{
    "flags": "-HnrE",
    "patterns": [
        "\\$_(POST|GET|COOKIE|REQUEST|SERVER|FILES)",
        "php://(input|stdin)"
    ]
}
```

コマンドラインからパターンを保存する `-save` もある。

```
▶ gf -save php-serialized -HnrE '(a:[0-9]+:{|O:[0-9]+:"|s:[0-9]+:")'
```

さらに `engine` キーで grep 以外の検索エンジンに差し替えられる（例：the silver searcher）。その際、エンジンごとにフラグ体系が違う点に注意が必要である——下の例では `ag` に無い `E` フラグを外している。

```json
{
  "engine": "ag",
  "flags": "-Hanr",
  "pattern": "([^A-Z0-9]|^)(AKIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{12,}"
}
```

補完スクリプト（`gf-completion.bash` / `.zsh` / `.fish`）を `source` すると、`gf <tab>` でパターン名が一覧される。zsh（特にoh-my-zsh）では `gf` が `git fetch` のエイリアスになっていることがあるため、`unalias gf` かリネームが必要、と原典が注意している。

#### meg —— 「速く、かつ行儀よく」を両立させる設計

`meg` は多数のホスト×多数のパスを取得するツールだが、その**巡回順序**が設計の核心である。

> It can be used to fetch many paths for many hosts; fetching one path for all hosts before moving on to the next path and repeating.
> （多数のホストに対し多数のパスを取得できる。ひとつのパスを全ホストぶん取得してから次のパスへ移り、それを繰り返す。）

つまり「ホストAに全パス→ホストBに全パス」ではなく「全ホストに `/robots.txt`→全ホストに `/package.json`」と**列方向に**回す。結果として、こちらは常時20並列で走っていながら、**個々のホストから見れば5秒に1リクエスト**（`-d` の既定値5000ms）でしかない。スループットとレート制限を同時に満たす、順序だけで解いた綺麗な設計である。

```
▶ meg --verbose paths hosts
out/example.com/45ed6f717d44385c5e9c539b0ad8dc71771780e0 http://example.com/robots.txt (404 Not Found)
...
```

引数を省略すると、パスは `./paths`、ホストは `./hosts`、出力先は `./out` が既定になる。保存されるのは**生のリクエストとレスポンス全文**で、ファイル名はURLのSHA-1ハッシュ、`./out/index` が対応表になる。

```
▶ head -n 20 ./out/example.com/45ed6f717d44385c5e9c539b0ad8dc71771780e0
http://example.com/robots.txt

> GET /robots.txt HTTP/1.1
> Host: example.com

< HTTP/1.1 404 Not Found
< Server: ECS (lga/13A2)
< Content-Type: text/*
...
```

**なぜ生で保存するのか**：これがデータ運用上の最重要ポイントである。取得時に「何を探すか」を決めてしまうと、後から別の観点で見たくなったときに再取得が要る。生で持っておけば、以後の分析は全て `grep` で済む。ネットワークは高価、ディスクは安価、という非対称性に賭けた設計だ。

```
▶ grep -Hnri '< Server:' out/
```

主なオプション：`-c/--concurrency`（既定20）、`-d/--delay`（同一ホストへの間隔ms、既定5000）、`-H/--header`（任意ヘッダ付与）、`-s/--savestatus`（指定ステータスのみ保存）、`-X/--method`、`-r/--rawhttp`。原典は delay を下げる前の注意を明記している——「**before reducing the delay, ensure that you have permission to make large volumes of requests to the hosts you're targeting**（delayを下げる前に、対象ホストへ大量のリクエストを送る許可があることを確認せよ）」。

`-r/--rawhttp` は、Goの標準HTTPクライアントが弾いてしまう不正なリクエスト（例：壊れたパーセントエンコード `/%%0a0afoo:bar`）を送るための実験的モードで、`tomnomnom/rawhttp` ライブラリを使う。検証をほぼ行わない代わりに chunked transfer encoding 未対応などの制約がある。

#### qsreplace —— リクエスト数を「組み合わせ」の単位で畳む

primerには含まれないが、同じ設計思想の重要ツールなので併せて押さえる。URLを受け取り、全クエリ値を指定値に置換し、**ホストとパスごとに、クエリパラメータの組み合わせが同じものは1回しか出力しない**。

```
▶ cat urls.txt
https://example.com/path?one=1&two=2
https://example.com/path?two=2&one=1
https://example.com/pathtwo?two=2&one=1
https://example.net/a/path?two=2&one=1

▶ cat urls.txt | qsreplace newval
https://example.com/path?one=newval&two=newval
https://example.com/pathtwo?one=newval&two=newval
https://example.net/a/path?one=newval&two=newval
```

1行目と2行目は**パラメータの順序が違うだけ**で、サーバ側から見れば同じエンドポイント・同じパラメータ集合である。`qsreplace` はキーをソートして正規化するため、この重複が畳まれる。値を渡さない `-a`（append）単独指定なら、値を壊さずに重複だけを落とせる。

```
▶ cat urls.txt | qsreplace -a
https://example.com/path?one=1&two=2
https://example.com/pathtwo?one=1&two=2
https://example.net/a/path?one=1&two=2
```

アーカイブ由来のURLリストは同一エンドポイントの値違いが数千行並ぶのが普通なので、この一段を挟むだけで後段のリクエスト数が桁で落ちる。**「対象に優しくする」ことが、そのまま「自分の待ち時間を減らす」ことと一致する**のがこの種のツールの美点である。

> 出典: A TomNomNom Recon Tools Primer — https://danielmiessler.com/blog/a-tomnomnom-tools-primer
> （各ツールの仕様・コード例は原典READMEに当たって補足した：anew/httprobe/waybackurls/unfurl/gf/meg/qsreplace、いずれも https://github.com/tomnomnom/ 配下）

---

### 9c.3 Shopify実演に見る「ファイルを状態として運用する」型

TomNomNomがShopifyのバグバウンティプログラムで行ったライブ偵察の実演ノートには、ツールの使い方そのものより価値の高い**データ運用の型**が記録されている。

#### 台帳ファイルの三層構造

実演で彼が保持していたファイルは、粒度の違う三層になっている。

```
wildcards  →  domains  →  hosts
（スコープ）  （名前解決候補）  （生きているURL）
```

まずプログラムのスコープにあるワイルドカードを `wildcards` に手で書き出す。そこから：

```bash
cat wildcards | assetfinder --subs-only | anew domains
```

`assetfinder --subs-only` がサブドメインを吐き、`anew domains` が**既に知っているものを除いて** `domains` に追記する。次に生死確認：

```bash
cat domains | httprobe -c 80 --prefer-https | anew hosts
```

同時接続80で、443または80に応答したものを `hosts` に貯める。`--prefer-https` はこの実演のために彼自身が `httprobe` に足した機能である。

**この三層が効く理由**：層ごとに「そこに入る条件」が明確で、かつ**前の層から次の層への変換が冪等（idempotent）**になっている。何度回しても `domains` や `hosts` は壊れず、増えるだけ。だから cron で毎日回しても、手で気まぐれに回しても、同じファイルに収束する。偵察を「実行するもの」から「保守するデータ」へ変える転換点がここにある。

#### `anew` を置く位置で、送信リクエスト数が変わる

実演で最も示唆的なのが、複数の列挙ツールを併用するときのパイプの組み方である。彼は `assetfinder` に加えて `findomain` も使う。

```bash
findomain -f wildcards | tee -a findomain.out
cat findomain.out | anew domains | httprobe -c 50 | anew hosts
```

ここで **`anew domains` を `httprobe` の前に置いている**ことが要点である。`findomain` の出力には、すでに `assetfinder` 経由で知っているドメインが大量に含まれる。もし

```bash
# 悪い例：既知のドメインまで全部プローブしてしまう
cat findomain.out | httprobe -c 50 | anew hosts
```

と書くと、既知ドメインにも改めてHTTP/HTTPS接続を張ってしまう。`anew` を前段に置けば、`httprobe` に流れるのは**今回はじめて見たドメインだけ**になる。ノイズ（＝対象への不要なトラフィック）を抑えるコツであり、同時に自分の実行時間も短くなる。

なお `anew` 以前、彼は `tee -a` を使っていた。「ドメインのファイルを持っていて、毎回重複排除するのが面倒だったから `anew` を作った」というのが誕生の経緯である。ツールが先にあったのではなく、**パイプラインの摩擦が先にあった**。

#### この型の落とし穴：`anew` は失敗を隠す

実演ノートの筆者は、この気持ちよいワークフローに率直な批判を添えている。要旨はこうだ——コマンドにタイプミスがあった、あるいはツールが処理できないエラーコードを受け取った等で `httprobe` が実質的に走らなかった場合、パイプラインはエラーを表に出さず、`anew` が「新しい行はありませんでした」という**正常時と見分けのつかない出力**を返してしまう。

**なぜそうなるのか（シェルの仕組み）**：POSIXシェルのパイプラインの終了ステータスは、既定では**最後のコマンドの終了ステータスだけ**である。途中の `httprobe` が非ゼロで死んでも、最後の `anew` が成功すればパイプライン全体は成功（0）を返す。自動化では致命的なので、スクリプト化する際は必ず次を入れる。

```bash
#!/bin/bash
set -euo pipefail
# -e        : コマンドが非ゼロで終了したら即座に停止
# -u        : 未定義変数の参照をエラーにする（タイポ対策）
# -o pipefail: パイプライン中のどれかが失敗したら、全体を失敗にする
```

加えて、各段の**行数を記録して異常を検知する**のが実務的である。

```bash
before=$(wc -l < hosts)
cat domains | httprobe -c 80 --prefer-https | anew hosts
after=$(wc -l < hosts)
echo "hosts: ${before} -> ${after}"
```

「昨日は1200行だったのに今日は0行増えた」ではなく「昨日は1200行だったのに今日は全体が0行になった」を検知できる形にしておく。**差分ベースの自動化は、壊れたときに静かに壊れる**——これがLv9のパイプライン化で最も踏みやすい地雷である。

#### 低テクなデータクレンジング

列挙ツールの出力には `-cisco.shopify.com` のように先頭にゴミ文字が付いた行や、`*.shopify.com` のようなワイルドカード行が混ざる。彼の対処は徹底して低テクだ——エディタ（Vim）で `:sort` してから `G` で末尾へ飛ぶ。ASCIIのソート順では記号が英数字より前（または後）に固まるので、**壊れた行が一箇所にまとまり、目視で一括削除できる**。なお `_dev.shopify.com` のようなアンダースコア始まりは正当なレコードであり得るので残す、という判断も記録されている。

正規表現で「正しい行」を定義しようとすると必ず境界例で取りこぼす。ソートして端に寄せて目で見る、というのは、**データ量が数千行のうちは人間の目が最も安価で確実なフィルタである**という現実的な判断である。

#### 漏斗（funnel）としてのパイプライン

同じノートには、アーカイブ由来URLを段階的に絞る一般的な型も記録されている。実測として、あるホストでWayback由来の136件のリンクに `gf` パターンを適用したところ36件まで減ったが、単純に `grep '='`（クエリパラメータを持つURL）で絞ったほうが**より多く**残った、という観察がある。

**なぜこうなるのか**：`gf` のパターンは「よくある脆弱パラメータ名」のホワイトリストに近い。ヒット率は高いが、**命名が独特なパラメータを丸ごと捨ててしまう**。逆に `grep '='` は再現率（recall）が高く、精度（precision）が低い。どちらが正しいかは目的次第で、「まず広く取り、後段で絞る」のがパイプラインの作法である。典型的な絞り込みの段は次のように積む。

```
アーカイブURL
  → grep '='          … パラメータを持つものだけ（再現率重視）
  → egrep -iv '\.(jpg|jpeg|gif|css|tif|png|ttf|woff|woff2|ico|svg)$'
                       … 静的アセットを除外（サーバ側で解釈されない拡張子）
  → qsreplace -a       … ホスト×パス×パラメータ集合の重複を畳む
  → （ここではじめて能動的な確認を行う）
```

`egrep -iv` で画像やフォントを落とすのは、これらが通常テンプレートエンジンやアプリケーションロジックを通らず、静的配信されるためである。**「サーバ側で入力として解釈され得るものだけを残す」**という原理で絞っている。

最終段の能動的な確認は、必ず**許可された対象に対してのみ**、かつレート制限を守って行う。本書ではこれ以上の具体的な攻撃手順は扱わない。

> 出典: Live Recon and Automation on Shopify's Bug Bounty Program with @TomNomNom（The Top Hacker Methodologies & Tools Notes、実演ノートPDF） — https://bibliography.mk.iq/files/pdf1737733544.pdf

---

### 9c.4 ProjectDiscovery系ツールとの接続点

> ⚠️ **未取得の資料**: NahamSec「Free Recon Course and Methodology For Bug Bounty Hunters」（動画）は自動取得できませんでした（理由: YouTubeのページから字幕・本文テキストを抽出できず、フッタのナビゲーションのみが返ったため）。以下のURLからご自身で直接ご覧ください: https://www.youtube.com/watch?v=evyxNUzl-HA

動画そのものは取得できなかったが、共同制作者であるProjectDiscoveryが公表した内容紹介から、扱われているパイプラインの骨格は確認できた（2025年9月22日公開、ProjectDiscovery公式告知 2025年9月23日）。内容は、VPS上に偵察用マシンを構築し、Goインストーラで ProjectDiscovery のツール群を導入・管理したうえで、次の連鎖を組むというものである。

```
Subfinder → AlterX → DNSX → Naabu → HTTPX → Katana
```

（以下は未取得資料の補足として一般知識に基づく解説です）

この連鎖は、9c.2〜9c.3で見たTomNomNomのパイプラインと**同じ形をしている**。対応を取ると理解が早い。

| 役割 | TomNomNom系 | ProjectDiscovery系 |
|---|---|---|
| サブドメイン列挙 | `assetfinder --subs-only` | `subfinder` |
| 名前の変異生成 | （`dnsgen` 等の外部ツール） | `alterx` |
| DNS解決の確認 | （`filter-resolved`） | `dnsx` |
| ポート走査 | （なし／`nmap` 併用） | `naabu` |
| HTTP生死確認 | `httprobe` | `httpx` |
| クロール・URL収集 | `waybackurls` + `meg` | `katana` |
| 差分の蓄積 | `anew` | `anew`（そのまま使う） |

重要なのは、**ProjectDiscoveryのツール群も例外なく「stdinを読んでstdoutに改行区切りで書く」規約を守っている**ことだ。だからこそ `anew` や `unfurl` や `qsreplace` といったTomNomNom製の部品が、そのまま両者の接着剤として機能する。ツール実装が別のプロジェクトでも、**インタフェースが同じなら組み替えられる**——これがUnix哲学の実用的な配当である。

```bash
# 二つのエコシステムを混ぜた例（許可された対象に対してのみ）
subfinder -d example.com -silent \
  | anew domains \
  | httpx -silent -title -tech-detect -status-code \
  | anew hosts.txt
```

ただし `httpx`（ProjectDiscovery）は既定でURL以外の付帯情報（タイトル、技術スタック、ステータスコード）を同じ行に混ぜて出力するため、**そのまま次のツールにパイプするとURLとして解釈できなくなる**点に注意が必要である。付帯情報を出す段と、次段へ渡す段は分けるか、`unfurl` で正規化してから流す。「テキストストリームが普遍インタフェース」であることの裏返しとして、**1行のフォーマットを崩すツールがパイプラインの断絶点になる**。

なお、この種のマルチツール連鎖では「どのツールがどのポート・どのプロトコルに実際にパケットを送るか」を把握しておくこと。`subfinder` や `waybackurls` は passive（対象に触れない）だが、`dnsx` はDNSサーバに、`naabu` は対象のTCPポートに、`httpx`・`katana` は対象のWebサーバに直接到達する。**受動と能動の境界線がどこにあるかを言えない自動化は、許可範囲を越えるリスクがある。**

> 出典: Free Recon Course and Methodology For Bug Bounty Hunters（NahamSec × ProjectDiscovery、2025年9月22日） — https://www.youtube.com/watch?v=evyxNUzl-HA

---

### 9c.5 設計原則のまとめ —— 自分のパイプラインを組むときの指針

ここまでを、再利用できる原則に落とす。

1. **1行1レコード、改行区切りを守る**。これを破った瞬間にパイプが切れる。CSVやJSONを挟みたくなったら、`jq -r` や `unfurl` でその場でフラットに戻す。
2. **ファイルを状態として持ち、`anew` で育てる**。実行結果を上書きしない。追記して、差分を出力させる。「昨日との差」が自動的に手に入る構造にしておくと、Lv10の継続監視へそのまま延長できる。
3. **生データを保存し、分析は後から `grep` で何度でもやる**（`meg` の設計）。ネットワークは高価でディスクは安い。取得時に捨てた情報は二度と戻らない。
4. **`anew` は絞り込み段の「前」に置く**。既知のものを下流に流さないことが、対象への礼儀と自分の時間の両方を守る。
5. **正規表現を書く前に専用パーサを探す**。URLは `unfurl`、JSONは `jq`（または `gron`）。自作の正規表現パーサは静かに取りこぼす。
6. **必ず `set -euo pipefail` を書き、各段の行数をログに残す**。差分ベースの自動化は、壊れたとき「差分ゼロ」という正常に見える姿で壊れる。
7. **レート制御を後付けにしない**。`meg` のように巡回順序そのものでレートを解くか、`-d` / `-c` を明示的に設定する。「全力で叩いてから怒られる」は、防御側から見れば単なるDoSである。
8. **許可範囲をパイプラインの入口（`wildcards` ファイル）に固定する**。スコープの判断をパイプの途中に散らさない。入口のファイルが唯一の権限の source of truth になる。

#### 防御側（Blue Team）から見たとき

同じ道具立ては、そのまま自組織のアタックサーフェス管理（ASM）に使える。むしろそちらが本来の使い道である。

- `anew` の差分出力は「**意図せず公開された新しいホスト**」の検知器になる。開発チームが立てたステージング環境が証明書透明性ログ経由で見えるようになった瞬間に通知が飛ぶ。
- `httprobe` / `httpx` の結果と、社内の資産台帳を `comm` や `grep -vxF -f` で突き合わせれば、**台帳に無いのにインターネットから生きて見えるホスト**（shadow IT）が落ちてくる。
- `meg` で保存した生レスポンス群を `grep` すれば、セキュリティヘッダの欠落や、想定外の `Server:` バナー露出を全社横断で棚卸しできる。

検知側の視点も持っておきたい。これらのツールのトラフィックは、ログ上では「短時間に多数の異なるホスト名へ向かう、User-Agentが既定値のままのリクエスト群」として見える。`meg` の「同一ホストには5秒に1回」という設計は、まさにこのパターンを単一ホストのログから見えにくくするものであり、**防御側は1ホストのログではなく、組織全体・エッジ全体を横断した相関で見る必要がある**ことを意味している。

---

### 9c.6 陳腐化への注記（2026年9月時点）

- **インストール方法**：Miesslerのprimer（執筆当時）では `go get -u github.com/tomnomnom/...` が示されているが、**`go get` によるバイナリのインストールはGo 1.17で非推奨化され、Go 1.18で廃止された**。現在は各ツールのREADMEが示す通り `go install github.com/tomnomnom/<tool>@latest` を使う。`gf` のREADMEなど一部は `go get -u` の記述が残っているので読み替えること。
- **`$GOPATH` 前提の記述**：`gf` のパターン例を `cp -r $GOPATH/src/github.com/tomnomnom/gf/examples ~/.gf` でコピーする手順は、`go install` を使うモジュール時代には `$GOPATH/src` が存在しないため成立しない。リポジトリを `git clone` して `examples/` をコピーする。
- **`gf` とzshのエイリアス衝突**：oh-my-zsh環境では `gf` が `git fetch` に割り当てられている。README記載の通り `unalias gf` するか、バイナリ側をリネームする。
- **`assetfinder` / `findomain`**：実演ノートはこの2本を併用しているが、passive列挙ツールは背後のデータソース（各種APIの無料枠・提供終了）に強く依存するため、**年単位で「よく効くツール」が入れ替わる**。パイプラインを特定ツールに固定せず、「列挙する段」「`anew` で溜める段」という役割で設計しておくと入れ替えが効く。
- **Wayback / Common Crawl 側のAPI**：`waybackurls` が依存するCDX APIはレート制限や可用性が変動する。取得失敗が空出力として返ると、`anew` の差分ゼロと見分けがつかない（9c.3の落とし穴と同じ構造）ので、終了ステータスと行数の両方を見ること。
- **ProjectDiscoveryの連鎖**：9c.4の `Subfinder → AlterX → DNSX → Naabu → HTTPX → Katana` は2025年9月時点の構成である。各ツールのフラグ（特に `httpx` の出力フォーマット系）はマイナーバージョンで変わることがあるため、スクリプト化する際は `-version` を記録に残しておく。

---

### 本節のまとめ

TomNomNomのツール群から学ぶべきものは、`anew` や `unfurl` の使い方そのものではない。**偵察を「実行するコマンド」ではなく「保守するデータセット」として設計する**という発想である。

- 単機能ツール × 改行区切りテキスト × パイプ、という組み合わせが、偵察データの性質（フラット・反復・個人差）に構造的に適合している。
- `anew` が持つ「追記器かつ差分検出器」という二面性が、その場限りのスキャンを継続監視へ橋渡しする。
- `meg` の巡回順序と `qsreplace` の正規化が示すように、**対象に優しくすることと効率的であることは、しばしば同じ設計から出てくる**。
- 差分ベースの自動化は静かに壊れる。`set -euo pipefail` と行数ログは飾りではなく必須部品である。

次節以降では、ここで組み上げたパイプラインを常時稼働させ、差分を通知として受け取る継続監視の実装へ進む。

---

[← 第8章 歴史データ・アーカイブの活用](08-historical-data.md) ｜ [📖 目次](index.md) ｜ [第10章 継続的Reconとモニタリング →](10-continuous-recon.md)
