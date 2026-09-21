## 継続監視・差分検知・通知パイプライン：出力でなく発見を生む自動化

自動化は「たくさんスキャンして大量の行を出力すること」だと誤解されがちだ。しかし出力（output）は成果ではない。成果とは**発見（finding）** — 「昨日まで存在しなかった攻撃面が今日出現した」「他の誰もまだ気づいていない構成が見えた」という、行動につながる情報だ。本節では、出力を垂れ流すだけの自動化と、発見を生む自動化の違いを、原理レベルとツール実装レベルの両方から解説する。中心となる部品は3つ — (1) 資産の**継続監視（continuous monitoring）**、(2) 前回結果との**差分検知（diff detection）**、(3) 差分だけを人間に届ける**通知パイプライン（notification pipeline）** である。

対象は防御・許可された自身の資産の監視を前提とする。実在サービスへの無許可検証や破壊的手順は本節では扱わない。ここで示すパイプラインは、自分が正当に権限を持つ資産（自社ドメイン、自分がスコープ内と確認済みのバグバウンティ対象）を対象に運用することを前提に読んでほしい。

### なぜ「reconの自動化」の大半は無意味なのか

2026年時点で、ほとんどのハンターのツールキットは似通っている。`subfinder` でサブドメインを列挙し、`httpx` で生存確認し、`nuclei` のテンプレートを流し、cron で回す。一見立派だが、この構成には致命的な欠陥がある — **一度きりの全量スキャンを繰り返しているだけ**で、「前と何が変わったか」を一切見ていない点だ。

> ⚠️ **未取得の資料**: 「Everyone Is Automating Bug Bounty Recon in 2026, Almost Nobody Is Automating the Right Things」(R.H Rizvi, Medium, 2026-06-11) は自動取得できませんでした（理由: Medium が HTTP 403 を返しブロック。ミラー(freedium)も DNS 解決不能）。以下のURLからご自身で直接ご覧ください: https://medium.com/@R.H_Rizvi/everyone-is-automating-bug-bounty-recon-in-2026-almost-nobody-is-automating-the-right-things-feafb1b500f2

検索経由で確認できた記事の主張の核は以下である。

- 本当のボトルネックは**ツールの速度ではなく、「どこを見るか」と「見たときに何を認識できるか」**だった。より速いスキャナを買っても、見る場所と読解力が同じなら成果は増えない。
- 標準的な recon パイプライン（subfinder → httpx → nuclei → cron）は、そのままでは「低い果実（low-hanging CVE）」しか拾えない。しかもその CVE は、3週間前に他の自動スキャナがすでに拾って報告済みだ。つまり**遅れて同じものを見つける機械**にしかなっていない。
- 「正しく自動化すべきもの」として記事が挙げるのは、(a) **新規サブドメインの監視**（一度の列挙ではなく、時系列で「今日新しく現れたホスト」を検出する）、(b) **差分アラート**（前回との差分だけを通知する）、(c) **fingerprint 駆動の優先順位付け**（検出した技術スタック・バージョン・構成に基づいて、どこを先に調べるかを機械が並べ替える）である。

> （以下は未取得資料の補足として一般知識に基づく解説です）この主張が正しい理由は、**攻撃面の価値は「新しさ」と「独占性」に強く相関する**からだ。あるサブドメインが半年前から存在するなら、すでに何百人ものハンターと自動スキャナが叩いている。逆に、企業が昨夜デプロイしたばかりのステージング環境や、買収に伴って追加された新ドメインは、まだ誰も見ていない。全量スキャンを毎回眺めても「新しさ」は見えない。**前回のスナップショットとの差分を取って初めて「新しさ」が浮かび上がる**。だから差分検知が recon 自動化の中核になる。

#### 「出力」と「発見」を分けるアーキテクチャ

この観点を設計に落とすと、パイプラインは2層に分かれる。

1. **収集層（全量・冪等）**: `subfinder`/`assetfinder` → `httprobe`/`httpx` → `waybackurls` などで、対象の**現在の全状態**を毎回丸ごと取得する。ここは何度実行しても同じ結果になる（冪等）ように作る。
2. **差分・通知層（増分・状態あり）**: 収集層の結果を「これまでに見た集合」と突き合わせ、**新規行だけ**を取り出して通知する。ここは前回状態を永続化して初めて機能する（状態あり）。

多くの人が作るのは収集層だけで、差分・通知層が欠けている。だから「毎朝1万行のログが届くが、そのうち何が新しいのか分からない」状態に陥る。以降で、この2層を TomNomNom 系ツールで具体的に組む。

### TomNomNom のツール哲学：小さな Unix フィルタを stdin/stdout でつなぐ

TomNomNom（Tom Hudson, 英ヨークシャー在住のオープンソースツール作者）の一連のツールは、いずれも**「標準入力(stdin)から1行ずつ受け取り、加工して標準出力(stdout)に1行ずつ出す」だけの単機能フィルタ**として設計されている。これは古典的な Unix 哲学 — 「一つのことをうまくやるプログラムを、パイプ `|` でつなぐ」 — の忠実な実践だ。この設計が差分検知・通知パイプラインに決定的に向いている理由を、各ツールを見ながら説明する。

> 出典: TomNomNom GitHub プロフィール — https://github.com/tomnomnom

代表的なリポジトリ（2026年時点、括弧内は概算スター数）:

| ツール | 役割 | 概算スター |
|---|---|---|
| `gron` | JSON を grep 可能な平坦形式に変換 | 14.5k |
| `waybackurls` | Wayback Machine が知る全 URL をドメインから取得 | 4.6k |
| `assetfinder` | 関連ドメイン・サブドメインを発見 | 3.7k |
| `httprobe` | ドメイン一覧に対し稼働中の HTTP/HTTPS を探索 | 3.1k |
| `gf` | grep のラッパー。定義済みパターンで「探すべきもの」を探す | 2.1k |
| `unfurl` | URL を部品（ドメイン/パス/クエリキー等）に分解・整形 | — |
| `meg` | 多数ホストに対し多数パスを、サーバに優しく並列取得 | — |
| `anew` | stdin の行を、重複を除いてファイルに追記（新規行だけ stdout） | — |

### 差分検知の心臓部：`anew`

パイプライン全体で最も重要なのに最も地味なのが `anew` だ。動作は単純で、**「stdin の各行を、指定ファイルにまだ無ければ追記し、かつ新規だった行だけを stdout に出す」**。`tee -a`（追記しつつ表示）に似ているが、**重複を排除する**点が決定的に違う。

> 出典: tomnomnom/anew README — https://github.com/tomnomnom/anew

README の例をそのまま示す。既存の `things.txt`:

```
Zero
One
Two
```

新しい入力 `newthings.txt`:

```
One
Two
Three
Four
```

実行すると:

```
$ cat newthings.txt | anew things.txt
Three
Four
```

**なぜこの2行だけが出力されるのか。** `anew` は追記先ファイル `things.txt` の既存内容を集合（set）としてメモリに読み込み、stdin の各行がその集合に含まれるか判定する。`One`/`Two` は既に存在するので黙って捨てられ、ファイルにも追記されない。`Three`/`Four` は未知なのでファイルに追記され、同時に stdout にも出る。**この「新規だった行だけが stdout に流れる」性質こそが差分検知の本体**だ。stdout に何か出れば「変化があった」、何も出なければ「変化なし」を意味する。

主なフラグ:

- `-d`（dry-run）: ファイルに追記せず、新規行を stdout に出すだけ。「もし実行したら何が新規か」を壊さず確認できる。
- `-q`（quiet）: ファイルに追記するが stdout には出さない。初回にベースラインを作るときなど、通知を出したくない場合に使う。

新規行を別ファイルに保存する定番:

```
cat newthings.txt | anew things.txt > added-lines.txt
```

**継続監視への応用がここで見える。** サブドメイン一覧を毎日 `anew subs-all.txt` に通す。初日は全件が新規（=全部 stdout に出る）だが、`-q` でベースラインを黙って作れば通知は出ない。翌日以降、`subfinder` の出力を同じ `subs-all.txt` に `anew` で通すと、**stdout には「昨日まで存在しなかった新規サブドメイン」だけが流れる**。これがそのまま「今日調べるべき最優先ターゲット」になる。全量スキャンを差分監視に変える魔法は、この1コマンドで完結する。

```bash
# 毎日 cron で実行する監視の骨格（自身の資産に対して）
subfinder -d example.com -silent \
  | httprobe \
  | anew ~/monitor/example.com/live-hosts.txt
# → stdout には「新しく生存が確認できたホスト」だけが流れる
```

### 収集層のツール

#### `assetfinder` / `waybackurls`：攻撃面を広く集める

`assetfinder` は与えたドメインに関連するドメイン・サブドメインを、複数の公開ソース（証明書透明性ログ、各種 DNS データセット等）から集める。`waybackurls` は Wayback Machine（インターネットアーカイブ）が記録している、そのドメインの**過去の全 URL** を吐き出す。

`waybackurls` が価値を持つ理由は、**古い URL ほど脆弱な傾向がある**からだ。過去に存在したがリンクが消えたエンドポイント（旧 API、デバッグページ、廃止予定だが動いている機能）は、現在のサイトをクロールしても見つからないが、アーカイブには残っている。これらは「メンテされていない＝壊れている」可能性が高い。NahamSec × TomNomNom のライブ recon 動画でも、この「歴史的データは古いものほど脆弱で、追加情報も得られるので価値が高い」という点が強調されている。

> ⚠️ **未取得の資料**: 「Live Recon and Automation on Shopify's Bug Bounty Program with @TomNomNomDotCom」(NahamSec, YouTube, 2021-04-19) は自動取得できませんでした（理由: YouTube 本体は動的レンダリングで本文抽出不可、要約ミラー(eightify)も HTTP 403）。以下のURLからご自身で直接ご覧ください: https://www.youtube.com/watch?v=SYExiynPEKM

> （以下は未取得資料の補足として、動画作者の告知・検索要約と一般知識に基づく解説です）この動画で TomNomNom が実演したのは、まさに本節のパイプライン思想そのものだ。動画作者(NahamSec)自身の告知によれば、使用ツールは **assetfinder / meg / httprobe / fff / gf** など。流れは概ね「`assetfinder` で資産を広げる → `httprobe` で生きているホストに絞る → `meg` で多数ホスト×多数パスを一括取得しローカルに保存 → `gf` で保存済みレスポンスから興味深いパターン（機微なキーワード等）を grep で拾う」という、収集→保存→パターン抽出のパイプラインである。ポイントは、**一度取得したものをローカルに保存し、後から何度でも grep し直せる**構造にしていること。ネットワークアクセス（コスト・レート制限・相手への負荷）は一度で済ませ、分析は手元で反復する。

> 出典: NahamSec による動画告知（使用ツール一覧）— https://twitter.com/NahamSec/status/1384185778301853699

#### `httprobe`：生きているホストだけに絞る

`httprobe` は stdin のドメイン一覧を受け取り、HTTP(80)/HTTPS(443) で応答するものだけを `http(s)://host` の形で stdout に出す。列挙されたサブドメインの大半は DNS はあっても Web サーバは動いていない。ここで絞ることで、後段の負荷と誤検知を減らす。

> 出典: tomnomnom/httprobe README — https://github.com/tomnomnom/httprobe

```bash
cat domains.txt | httprobe
# 既定ポート以外も探る
cat domains.txt | httprobe -p http:81 -p https:8443
# 並列数と timeout（ミリ秒）
cat domains.txt | httprobe -c 50 -t 20000
# HTTPS が通れば HTTP を省略（重複を減らす）
cat domains.txt | httprobe --prefer-https
```

主フラグ: `-c`（並列数）、`-t`（timeout ミリ秒）、`-p protocol:port`（追加プローブ）、`-s`（既定プローブを無効化し `-p` 指定のみ）、`--prefer-https`。**`--prefer-https` を使う理由**は、同一ホストが http/https 両方で応答するとき、下流で「同じサイトを2回」扱ってしまう重複を減らせるからだ。差分監視では重複は偽の「新規」を生む雑音になるため、入り口で抑えるほど後が楽になる。

#### `meg`：多数ホスト × 多数パスを「サーバに優しく」取得する

`meg` は「パス一覧(`./paths`)」と「ホスト一覧(`./hosts`)」を受け取り、全ホストに対して各パスを取得し、結果を `./out` にインデックス付きで保存する。設計上の肝は**取得順序**で、「あるパスを全ホストに投げ終えてから次のパスへ進む」。これにより、**同一ホストへの連続アクセスを避け、1台のサーバに負荷が集中しない**。

> 出典: tomnomnom/meg README — https://github.com/tomnomnom/meg

主フラグ: `-c`（並列数, 既定20）、`-d`（**同一ホスト**への次リクエストまでの遅延ミリ秒, 既定5000）、`-H`（追加ヘッダ）、`-s`（保存対象を HTTP ステータスで絞る）、`-X`（HTTP メソッド, 既定 GET）、`-r`（rawhttp で非標準リクエスト）。

```bash
meg /robots.txt          # 全ホストの /robots.txt を取得
meg -s 200 -X HEAD       # 200 応答だけ保存、HEAD で軽量に
meg -c 30 /              # 並列30でトップページ
```

**`-d 5000`(既定5秒)の意味を理解することが重要**だ。これは「同じホストに5秒間隔でしかアクセスしない」という礼儀の設定で、相手サーバへの過負荷（実質的な DoS）を避け、レート制限で BAN されるのも防ぐ。攻撃面を広げるほど「速く叩く誘惑」が増すが、`meg` は**広さ（多数ホスト）を並列で稼ぎ、深さ（同一ホスト連打）はわざと抑える**という賢い設計になっている。取得結果を `./out` に保存する点も重要で、これが「一度取得→手元で何度も分析」を可能にする。

#### `gf`：「探すべきもの」をパターンとして再利用する

`gf` は grep のラッパーで、**よく使う正規表現とフラグの組を名前付きパターンとして `~/.gf` に JSON で保存**しておき、`gf <name>` で呼び出せる。毎回長い正規表現を打つ代わりに、チームや自分の知見を「パターン資産」として蓄積・バージョン管理できる。

> 出典: tomnomnom/gf README — https://github.com/tomnomnom/gf

パターンファイルの形式（`~/.gf/php-sources.json` の例）:

```json
{
    "flags": "-HnrE",
    "pattern": "(\\$_(POST|GET|COOKIE|REQUEST|SERVER|FILES)|php://(input|stdin))"
}
```

複数パターンをまとめる場合:

```json
{
    "flags": "-HnrE",
    "patterns": [
        "\\$_(POST|GET|COOKIE|REQUEST|SERVER|FILES)",
        "php://(input|stdin)"
    ]
}
```

`engine` フィールドで grep 以外（例: `ag`）も指定でき、`-save` フラグで現在のコマンドラインからパターンファイルを自動生成できる。**なぜ JSON で外出しするのか** — 「何を探すか（＝どんな脆弱性の痕跡か）」という知識を、コマンド履歴に埋もれさせず、Git 管理できる再利用資産にするためだ。`meg` で保存したレスポンス群に対し `gf aws-keys` や `gf debug-pages` を流せば、収集済みの大量データから「興味深い痕跡」を機械的に何度でも掘り直せる。

#### `unfurl`：URL を部品に分解して監視対象を正規化する

`unfurl` は stdin の URL 群を、指定した部品（キー・値・ドメイン・パス・拡張子など）だけに整形して出す。差分監視では「URL 全体」ではなく「パラメータ名の集合」や「パスの集合」を監視したいことが多く、その正規化に使う。

> 出典: tomnomnom/unfurl README — https://github.com/tomnomnom/unfurl

主なモード: `keys`（クエリのキー）、`values`、`keypairs`、`domains`、`paths`、`apexes`（apex ドメイン）、`json`、`format`（自由整形）。`format` の主なディレクティブ: `%d`(ドメイン)、`%S`(サブドメイン)、`%r`(ルートドメイン)、`%t`(TLD)、`%p`(パス)、`%q`(クエリ)、`%s`(スキーム)、`%P`(ポート)。

```bash
cat urls.txt | unfurl keys                    # 全 URL のクエリキーだけ
cat urls.txt | unfurl format %s://%d%p?%q     # 正規化した形に再構成
cat urls.txt | unfurl --unique domains        # ドメインを重複排除
```

**応用例**: `waybackurls` で集めた大量 URL から `unfurl keys | sort -u` でパラメータ名の一覧を作り、これを `anew params.txt` に通せば「新しく登場したパラメータ名」を監視できる。新パラメータは新機能・新エンドポイントの兆候で、テスト対象として価値が高い。

### 通知パイプライン：差分だけを人間に届ける `notify`

差分検知で「新規行」を得たら、それを人間の目に届ける最後の一手が通知だ。ここでは ProjectDiscovery の `notify` を使う（TomNomNom 系の思想と同じく stdin を受けるフィルタとして振る舞う）。`notify` は stdin または `-data <file>` を読み、Slack / Discord / Telegram / Email / Microsoft Teams / Google Chat に投稿する。

> 出典: projectdiscovery/notify README — https://github.com/projectdiscovery/notify

設定ファイルは既定で `$HOME/.config/notify/provider-config.yaml`。プロバイダごとに必要な項目:

```yaml
slack:
  - id: "recon"
    slack_webhook_url: "https://hooks.slack.com/services/XXX/YYY/ZZZ"
    slack_channel: "recon-alerts"
    slack_username: "notify-bot"

discord:
  - id: "vulns"
    discord_webhook_url: "https://discord.com/api/webhooks/XXX/YYY"
    discord_channel: "findings"
    discord_username: "notify-bot"

telegram:
  - id: "recon"
    telegram_api_key: "<bot token>"
    telegram_chat_id: "<chat id>"
    telegram_parsemode: "Markdown"
```

主フラグ: `-bulk`（複数行を1メッセージにまとめて送る）、`-data`（入力ファイル）、`-id`（`recon,vulns` のように送信先 ID を選択）、`-provider`（`slack,telegram` のようにプラットフォーム選択）、`-silent`（余計な出力抑制）、`-char-limit`（1メッセージ最大文字数, 既定4000）、`-delay`（通知間の秒数）。

```bash
# ツール出力を直接パイプ
subfinder -d example.com | notify -bulk
# ファイルから特定プロバイダへ
notify -data new-hosts.txt -bulk -provider discord,slack
# 収集→生存確認→脆弱性テンプレ→通知の連結
subfinder -d example.com | httpx | nuclei -tags exposure | notify -bulk
```

**`-bulk` を使う理由と `-char-limit 4000` の意味**: 差分が一度に大量に出たとき、行ごとに通知すると数百通の連投になり、Slack/Discord のレート制限に当たり、人間も読めない。`-bulk` は複数行を1メッセージに束ねるが、各プラットフォームには1メッセージあたりの文字数上限（Slack/Discord とも概ね数千文字）があるため、`notify` は `-char-limit`(既定4000)で自動分割する。**通知は「量」ではなく「変化があった事実と、その内容」を届けるのが目的**なので、束ねて静かに届けるのが正しい。

### 3層を1本につなぐ：継続監視パイプラインの全体像

ここまでの部品を、cron で毎日回る1本のパイプラインに組む。**収集（冪等）→ 差分（`anew` が状態を持つ）→ 通知（差分があるときだけ発火）** という構造を、自分の資産に対して運用する。

```bash
#!/usr/bin/env bash
set -euo pipefail
DOMAIN="example.com"                 # 自分が権限を持つ資産のみ
BASE="$HOME/monitor/$DOMAIN"
mkdir -p "$BASE"

# 1) 収集層：現在の全生存ホストを取得（冪等）
#    2) 差分層：anew が「新規に現れたホスト」だけを stdout に流す
NEW_HOSTS="$(
  assetfinder --subs-only "$DOMAIN" \
    | httprobe --prefer-https -c 50 \
    | anew "$BASE/live-hosts.txt"
)"

# 3) 通知層：新規があったときだけ通知する（無ければ静か）
if [ -n "$NEW_HOSTS" ]; then
  printf '%s\n' "$NEW_HOSTS" \
    | notify -silent -bulk -id recon \
        -provider slack
fi

# 新規ホストがあれば、それだけを対象に軽い追加調査を回す（任意）
if [ -n "$NEW_HOSTS" ]; then
  printf '%s\n' "$NEW_HOSTS" \
    | waybackurls \
    | unfurl --unique keys \
    | anew "$BASE/params.txt" \
    | notify -silent -bulk -id recon -provider slack
fi
```

**この設計が「発見を生む」理由**を整理する。

- **冪等な収集 + 状態を持つ差分**の分離により、パイプライン全体は毎日同じコマンドで回せるのに、通知されるのは「昨日と違う部分」だけになる。ノイズが構造的に消える。
- **通知は差分があるときだけ発火する（`if [ -n "$NEW_HOSTS" ]`）**。「何も新しくない日は何も通知しない」— これが疲労を防ぎ、通知が来た＝必ず見る価値がある、という信頼を作る。通知を毎日出すと人はすぐ無視するようになる（アラート疲れ）。
- **新規ホストにだけ追加調査を集中**する。全量に毎回重い調査をかけるのではなく、「新しく現れた1〜2件」に `waybackurls`/`unfurl` を回す。相手への負荷も自分の計算量も最小で、かつ最も価値の高い（＝誰もまだ見ていない）対象に投資が向く。

#### 状態の持ち方に関する注意（陳腐化・堅牢性）

- 差分の要は `anew` が読む状態ファイル（`live-hosts.txt` など）だ。これを**消すと全件が再び「新規」になり、大量の誤通知が出る**。ベースライン構築時は `anew -q` で黙って作り、通知は翌日以降に限定する運用が安全。
- 状態ファイルは Git 管理すると変化の履歴を後から追える（`gf` のパターンと同様、知識資産として versioned にする発想）。
- ツールのバージョン差に注意。`assetfinder`/`httprobe`/`meg`/`gf`/`unfurl`/`anew` は本節執筆時点(2026年)の README に基づく。`assetfinder` は開発が緩やかで、`--subs-only` の挙動やデータソースは版により異なる。`notify` のフラグ(`-char-limit` 既定4000 等)や `provider-config.yaml` のスキーマも ProjectDiscovery 側で更新され得るので、運用前に手元の `--help` と設定例で確認すること。
- 相手サーバへの礼儀は自動化の前提だ。`meg -d`(既定5秒)や `httprobe`/`meg` の `-c`、`notify -delay` を過度に上げない。速度を求めて相手や自分のインフラを壊すのは、本節のスコープ（防御目的・無許可検証や破壊的手順を書かない）から外れる。

### まとめ：自動化の正しい問い

「何を自動化するか」ではなく、**「自動化の出力を見て、翌朝に取る行動が変わるか」**を問うべきだ。全量スキャンのログは行動を変えない（毎日同じだから）。しかし「昨日存在しなかったホストが1件現れた」という差分は、その日の最優先タスクを即座に決める。TomNomNom 系ツールの小さなフィルタ群 — 収集の `assetfinder`/`waybackurls`/`httprobe`/`meg`、抽出の `gf`/`unfurl`、そして差分検知の心臓 `anew` — を stdin/stdout で連結し、`notify` で差分だけを静かに届ける。この構造が、出力の洪水ではなく発見を生む自動化の骨格である。
