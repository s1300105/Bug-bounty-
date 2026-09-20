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
