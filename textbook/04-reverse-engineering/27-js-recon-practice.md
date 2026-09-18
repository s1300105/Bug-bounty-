# JS収集〜解析の実務パイプライン：偵察から差分監視までを自動化する

> **この節で分かること**
> - クライアントサイドのバグハンティングで「JS偵察（JS recon）」が中核になる理由を説明できる。
> - サブドメイン列挙からシークレット抽出・差分監視まで、8段の標準パイプラインを自分の手で組み立てられる。
> - `subfinder` `httpx` `katana` `gau` `waymore` など各ツールを STDIN/STDOUT で連結し、ワンライナーに落とし込める。
> - `.js.map`（ソースマップ）から元ソースを復元し、アーカイブに残った「消えたJS」まで掘る高度な手法を実行できる。
> - シークレット検出の誤検知（false positive）を「四層構え」で削り、報告に値する所見だけを残せる。
> - JSの更新を継続監視し、新しいエンドポイントやキーが混入した瞬間を捉える運用を作れる。

**元資料**: https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e ／ https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6 （いずれも**原典は取得できず**、egressポリシーによる遮断のため二次情報＝各ツール公式READMEベース）
**関連する節**: 25 LinkFinder/SecretFinder、26 バグバウンティツール総覧

---

## 0. この節の立ち位置と注意

### なぜツール公式ドキュメントを土台にしているのか

この節の元になった2本の記事（自動化と高度な漏洩ハンティング）は、本教科書の執筆環境からは取得できなかった。組織のネットワーク送信（egress）ポリシーが Medium 系ドメインを遮断していたためである。egress ポリシーとは、社内ネットワークから外部へ出ていく通信を許可・拒否するルールのこと。ここでは対象ホストへの接続そのものが 403（CONNECT トンネル確立失敗）で拒否された。

そこで本節は、記事タイトルが約束する主題（①JS抽出の**自動化**、②**高度な**機密データ漏洩ハンティング）を、パイプラインを構成する各ツールの**公式README（GitHub raw で全文取得）**で埋め直している。つまりここに載るコマンド・オプション・正規表現は、原則として実ツールの公式ドキュメントからの逐語か、明示的に「〔補足〕」を付けた一般知識のいずれかである。元の2記事そのものからの引用は一切含まない。

### 対象記事は読者自身の環境で開いてほしい

読者の通常のブラウザからは、この2記事はおそらく読める。本節の各所と末尾に「📌 ここは自分で開いて読んでください」ブロックを置くので、本節を基準線（ベースライン）として、記事側の独自の工夫との差分を取るのがよい学び方になる。

### 前提（許可の範囲）

以降の手法はすべて、バグバウンティのスコープ内ドメイン、または明示的に許可を得た診断対象、あるいは自分で立てた検証環境に対してのみ実行する。攻撃的な操作は一切前提にしない。JS偵察は本来「そこに何が公開されているかを観察する」受動的な作業が中心であり、対象に負荷をかけない配慮とスコープ外を踏まない仕組みが、技術そのものと同じくらい重要である。

---

## 1. なぜJSが宝の山なのか（設計意図から理解する）

### SPAは「アプリのロジックごと」クライアントに配られる

現代のWebアプリの多くは SPA（Single Page Application、単一ページアプリ）である。SPAとは、最初に大きな JavaScript のかたまり（バンドル）を1回ダウンロードし、以降は画面遷移をサーバーに頼らずブラウザ内で行うアプリのこと。たとえば Gmail やダッシュボード系の管理画面がこれにあたる。

この設計は使い勝手を上げる一方で、**アプリの内部ロジックを丸ごとクライアントに送り届ける**という副作用を持つ。バンドルされたJSの中には、次のようなものが埋もれていることが多い。

- 画面からは辿れない**未公開のAPIエンドポイント**（管理用・内部用のパス）。
- サーバーがまだ実装途中の**隠しパラメータ**。
- 本来サーバーに置くべきだった**ハードコードされたシークレット**（APIキー、トークン、認証情報）。

### だから「recon（偵察）」の中核になる

これらを体系的に集めて読み解く作業が recon（偵察）である。recon とは、攻撃・診断の前段として対象の構造や資産を洗い出す情報収集のこと。JS偵察はその中でも、**画面をクリックしても出てこない攻撃面（attack surface）を、配布済みのコードから逆算して見つける**という点で特に効率がよい。

### 攻撃者はどこを突くのか／どう守るのか

攻撃者（＝許可された診断者）が狙うのは、開発者が「クライアントには見えないだろう」と油断して残した情報である。守る側の原則は単純で、**クライアントに配るものはすべて公開情報とみなす**こと。秘密はサーバー側に置き、クライアントに置かざるを得ないキーは権限を最小化し、本番からはソースマップやデバッグ用コメントを削除する。この節で学ぶ手法は、裏返せばそのまま防御側のチェックリストになる。

---

## 2. パイプライン全体像（8段の地図）

標準的なJS偵察は、およそ次の8段（0を入れて9段）で構成される。各段は STDIN/STDOUT で連結でき、`anew` で差分を累積し、`gf` で名前付きのgrepパターンを再利用することで、自動化・継続監視に落とし込める。

```
(0) スコープ確定
        │
(1) サブドメイン列挙      subfinder ──► subs.txt
        │
(2) 生存確認・プロービング  httpx    ──► live.txt
        │
(3) URL収集
     ├ 能動クロール       katana / hakrawler
     └ 受動収集           gau / waybackurls / waymore ──► urls.txt
        │
(4) JSファイル抽出        grep / getJS / subjs / katana -em js ──► jsurls.txt
        │
(5) ダウンロード＋整形     curl + js-beautify、.js.map復元 sourcemapper ──► js/ ・ src/
        │
(6) エンドポイント抽出     LinkFinder / jsluice urls / xnLinkFinder ──► endpoints.txt
        │
(7) シークレット抽出       SecretFinder / jsluice secrets / trufflehog / gitleaks / gf ──► secrets.txt
        │
(8) 差分監視             JSMon / anew ＋ cron
```

### 段ごとの成果物をファイルに残す

作業ディレクトリを作り、各段の出力をファイルに残すのが実務の基本である（例: `subs.txt`, `live.txt`, `urls.txt`, `jsurls.txt`, `js/`, `endpoints.txt`, `secrets.txt`）。こうしておくと、再実行時に「新規分だけ」を検出でき（後述の `anew` / `JSMon`）、どこで何が取れたかを後から追える。

---

## 3. ステージ1：サブドメイン列挙（subfinder）

### 何をする段か

`subfinder` はパッシブ（受動的）なサブドメイン発見に特化したツールである。パッシブとは、対象サーバーに直接大量アクセスするのではなく、公開されている第三者データ（証明書透明性ログ、検索エンジンなど）から拾う方式のこと。対象に足跡を残しにくく、最初の一歩に向く。

STDIN/STDOUT に対応しているので、後段へパイプでつなぎやすい。主要フラグは公式READMEの「Usage」から次のとおり。

```
INPUT:
  -d, -domain string[]  domains to find subdomains for
  -dL, -list string     file containing list of domains for subdomain discovery

SOURCE:
  -s, -sources string[]           specific sources to use for discovery (-s crtsh,github). Use -ls to display all available sources.
  -recursive                      use only sources that can handle subdomains recursively (e.g. subdomain.domain.tld vs domain.tld)
  -all                            use all sources for enumeration (slow)
  -es, -exclude-sources string[]  sources to exclude from enumeration (-es alienvault,zoomeyeapi)

OUTPUT:
  -o, -output string       file to write output to
  -oJ, -json               write output in JSONL(ines) format

DEBUG:
  -silent             show only subdomains in output
```

### ポイントと典型ワンライナー

`-silent` を付けると標準出力にサブドメインだけが出るので、後段へのパイプが綺麗になる。`-all` は全ソースを使うぶん網羅的だが遅い。

READMEにあるヘルプ表示の起動例はこれだけである。

```sh
subfinder -h
```

〔補足〕実務での典型的な使い方は次のとおり。

```bash
subfinder -d example.com -all -silent -o subs.txt
# または複数ドメインをまとめて
subfinder -dL roots.txt -all -silent | anew subs.txt
```

---

## 4. ステージ2：生存確認・プロービング（httpx）

### 何をする段か

`httpx` は公式が「fast and multi-purpose HTTP toolkit（高速で多目的なHTTPツールキット）」と呼ぶツールである。列挙したサブドメインのうち、**実際にHTTP(S)で応答するホストだけ**を絞り込み、ステータスコード・ページタイトル・技術スタックなどを付与する。JS偵察では「生存ホスト → クロール対象」への橋渡しに使う。プロービング（probing）とは、対象に軽く探りを入れて状態を確かめること。

主要フラグ（README逐語抜粋）。

```
INPUT:
   -l, -list string              input file containing list of hosts to process
   -u, -target string[]          input target host(s) to probe

PROBES:
   -sc, -status-code                      display response status-code
   -cl, -content-length                   display response content-length
   -ct, -content-type                     display response content-type
   -location                              display response redirect location
   -title                                 display page title
   -td, -tech-detect                      display technology in use based on wappalyzer dataset
   -method                                display http request method
   -ip                                    display host ip

MATCHERS:
   -mc, -match-code string            match response with specified status code (-mc 200,302)
   -ms, -match-string string[]        match response with specified string (-ms admin)
   -mr, -match-regex string[]         match response with specified regex (-mr admin)

EXTRACTOR:
   -er, -extract-regex string[]   display response content with matched regex
   -ep, -extract-preset string[]  display response content matched by a pre-defined regex (url,ipv4,mail)

FILTERS:
   -fc, -filter-code string               filter response with specified status code (-fc 403,401)
   -fs, -filter-string string[]           filter response with specified string (-fs admin)

OUTPUT:
   -o, -output string                     file to write output results
   -j, -json                              store output in JSONL(ines) format
   -sr, -store-response                   store http response to output directory
   -srd, -store-response-dir string       store http response to custom directory
   -irh, -include-response-header         include http response (headers) in JSON output (-json only)
   -irr, -include-response                include http request/response (headers + body) in JSON output (-json only)

CONFIGURATIONS:
   -H, -header string[]             custom http headers to send with request
   -http-proxy, -proxy string       proxy (http|socks) to use (eg http://127.0.0.1:8080)
   -fr, -follow-redirects           follow http redirects
   -random-agent                    enable Random User-Agent to use (default true)
```

### JS偵察で効く機能

- `-extract-regex` / `-er` … 応答本文から任意の正規表現でマッチ抽出できる。レスポンス中のURLやキーを直接拾える。
- `-extract-preset url` … 事前定義の正規表現で URL / IPv4 / mail を抽出する。
- `-store-response` / `-srd` … 応答を保存できる。後段でローカルにgrepやシークレットスキャンをかけられる。
- `-mc 200` … ステータスコードで生存を絞る。

〔補足〕典型ワンライナー。

```bash
# サブドメイン → 生存URL
httpx -l subs.txt -silent -o live.txt
# ステータス・タイトル・技術・IPを付けて可視化
httpx -l subs.txt -sc -title -td -ip -o live_verbose.txt
```

---

## 5. ステージ3：URL収集（能動クロール＋受動収集）

このステージには2つのアプローチがある。**能動クロール**（自分でページを巡回してリンクを辿る）と、**受動収集**（第三者のアーカイブから既知URLを取り寄せる）である。両方を合流させると網羅性が上がる。

### 5-1. katana（能動クロール）

`katana` は「automation pipeline 向けの高速クローラ」。headless なし（通常）と headless（ブラウザを裏で動かす）の両モードを持つ。headless とは、画面表示なしでブラウザエンジンを動かす方式のこと。SPAはJSを実行しないと本当のリンクが現れないため、これが効く。

JS偵察で最重要なフラグは、JS中のエンドポイントまでクロールする `-jc`（`-js-crawl`）、jsluice解析を内蔵する `-jsl`、出力を拡張子で絞る `-em` である。READMEの `-js-crawl` の説明は次のとおり。

> *`-js-crawl`*
> Option to enable JavaScript file parsing + crawling the endpoints discovered in JavaScript files, disabled as default.
>
> ```
> katana -u https://tesla.com -jc
> ```

設定フラグ（README逐語抜粋）。

```
CONFIGURATION:
   -d, -depth int                maximum depth to crawl (default 3)
   -jc, -js-crawl                enable endpoint parsing / crawling in javascript file
   -jsl, -jsluice                enable jsluice parsing in javascript file (memory intensive)
   -kf, -known-files string      enable crawling of known files (all,robotstxt,sitemapxml), a minimum depth of 3 is required...
   -fx, -form-extraction         extract form, input, textarea & select elements in jsonl output
   -H, -headers string[]         custom header/cookie to include in all http request in header:value format (file)
   -proxy string                 http/socks5 proxy to use
```

新しめの「KNOWLEDGE BASE」機能は、シークレットやエンドポイントの抽出を内蔵している。

```
   -kb, -knowledge-base          enable knowledge base classification
   -kb-secrets                   enable secrets extractor in the knowledge base
   -kb-validate-secrets          validate detected secrets against their provider (sends live API calls)
   -kb-endpoints                 enable endpoints extractor (classifies REST/GraphQL/SOAP/XHR requests)
```

拡張子でJSに絞る FILTER 機能（README逐語）。

```
FILTER:
   -mr, -match-regex string[]             regex or list of regex to match on output url (cli, file)
   -fr, -filter-regex string[]            regex or list of regex to filter on output url (cli, file)
   -em, -extension-match string[]         match output for given extension (eg, -em php,html,js,none)
   -ef, -extension-filter string[]        filter output for given extension (eg, -ef png,css)
```

> **注意**: `-kb-validate-secrets` は検出したシークレットを**実際にプロバイダへ問い合わせて検証する（ライブAPI呼び出しを送る）**。便利だが、対象の許可範囲を超えた通信になりうるので、スコープと相談してから使う。

katana の実行例（README逐語）。

```sh
katana -u https://tesla.com
katana -u https://tesla.com,https://google.com
katana -list url_list.txt
echo https://tesla.com | katana
cat domains | httpx | katana
```

拡張子でJSに絞る（README逐語）。`none` を混ぜると拡張子なしURLも拾える。

```
katana -u https://tesla.com -silent -em js,jsp,json
katana -u https://tesla.com -silent -em js,jsp,json,none
```

深さ・既知ファイル・Cookie付きクロール（README逐語）。

```
katana -u https://tesla.com -d 5
katana -u https://tesla.com -kf robotstxt,sitemapxml
katana -u https://tesla.com -H 'Cookie: usrsess=AmljNrESo'
```

headless モード（SPAのDOMレンダリング後にエンドポイントを取得）。READMEは、継続的な websocket / polling で `load` が完了しないSPAには `domcontentloaded` 戦略が特に有用だと明記している。

```console
katana -u https://tesla.com -headless -no-sandbox
katana -u https://tesla.com -headless -pls domcontentloaded -dwt 10
```

出力フィールド（`-f`）で欲しい情報だけ抜ける。READMEの表の一部。

| FIELD   | DESCRIPTION                 | EXAMPLE                                       |
| ------- | --------------------------- | --------------------------------------------- |
| `url`   | URL Endpoint                | `https://.../admin/login?user=admin&password=admin` |
| `qurl`  | URL including query param   | `https://.../login.php?user=admin&password=admin` |
| `ufile` | URL with File               | `https://admin.projectdiscovery.io/login.js`  |
| `file`  | Filename in URL             | `login.php`                                   |
| `key`   | Parameter keys in URL       | `user,password`                               |

〔補足〕JS収集向けの典型起動。

```bash
# 生存URLを入力に、JSクロール＋js/json/mapに絞ってURL蓄積
katana -list live.txt -jc -d 5 -em js,json,map -silent | anew jsurls.txt
# headlessでSPAの動的エンドポイントも拾う
katana -list live.txt -headless -jc -silent | anew urls_dynamic.txt
```

### 5-2. gau / waybackurls（受動的な既知URL収集）

`gau`（getallurls）は AlienVault OTX・Wayback Machine・Common Crawl・URLScan から**既知URL**を取得する。過去に存在した（今は消えた）JSやエンドポイントも拾えるのが強みである。

使用例（README逐語）。

```bash
$ printf example.com | gau
$ cat domains.txt | gau --threads 5
$ gau example.com google.com
$ gau --o example-urls.txt example.com
$ gau --blacklist png,jpg,gif example.com
```

主要フラグ（README表の逐語抜粋）。

| Flag | Description | Example |
|------|-------------|---------|
|`--blacklist`| list of extensions to skip | gau --blacklist ttf,woff,svg,png|
|`--fc`| list of status codes to filter | gau --fc 404,302 |
|`--from`| fetch urls from date (format: YYYYMM) | gau --from 202101 |
|`--mc`| list of status codes to match | gau --mc 200,500 |
|`--mt`| list of mime-types to match |gau --mt text/html,application/json|
|`--o`| filename to write results to | gau --o out.txt |
|`--providers`| list of providers to use (wayback,commoncrawl,otx,urlscan) | gau --providers wayback|
|`--subs`| include subdomains of target domain | gau example.com --subs |
|`--threads`| number of workers to spawn | gau example.com --threads |

`waybackurls` は Wayback 専用の軽量版で、公式説明は「Accept line-delimited domains on stdin, fetch known URLs from the Wayback Machine for `*.domain`」。使用例（README逐語）。

```
▶ cat domains.txt | waybackurls > urls
```

〔補足〕JSだけ取り出す連結。

```bash
cat subs.txt | gau --subs --mt application/javascript | grep -iE '\.js(\?|$)' | anew jsurls.txt
cat subs.txt | waybackurls | grep -iE '\.js(\?|$)' | anew jsurls.txt
```

### 5-3. hakrawler（軽量クローラ）

`hakrawler` は「Fast golang web crawler for gathering URLs and JavaScript file locations」。使用例とオプション（README逐語）。

```
echo https://google.com | hakrawler
cat urls.txt | hakrawler
cat urls.txt | hakrawler -timeout 5
cat urls.txt | hakrawler -proxy http://localhost:8080
echo https://google.com | hakrawler -subs
echo google.com | haktrails subdomains | httpx | hakrawler
```

```
Usage of hakrawler:
  -d int        Depth to crawl. (default 2)
  -dr           Disable following HTTP redirects.
  -h string     Custom headers separated by two semi-colons. E.g. -h "Cookie: foo=bar;;Referer: http://example.com/"
  -i            Only crawl inside path
  -insecure     Disable TLS verification.
  -json         Output as JSON.
  -proxy string Proxy URL. E.g. -proxy http://127.0.0.1:8080
  -s            Show the source of URL based on where it was found. E.g. href, form, script, etc.
  -size int     Page size limit, in KB. (default -1)
  -subs         Include subdomains for crawling.
  -t int        Number of threads to utilise. (default 8)
  -timeout int  Maximum time to crawl each URL from stdin, in seconds. (default -1)
  -u            Show only unique urls.
  -w            Show at which link the URL is found.
```

### 5-4. waymore（アーカイブの「応答本体」まで落とす）

`gau` や `waybackurls` は「URLの一覧」を返すだけだが、`waymore` は**アーカイブされた応答そのもの（レスポンス本体）をダウンロードできる**。ここが決定的な違いである。すでに削除されたJSの中身、開発者のコメント、未使用パラメータを掘り起こせるため、JS偵察では非常に強力になる。

READMEの核心（逐語）。

> 👉 The biggest difference between **waymore** and other tools is that it can also **download the archived responses**
> for URLs on wayback machine (and URLScan) so that you can then search these for even more links, developer comments,
> extra parameters, etc. etc.
> 👉 Also, other tools do not currently deal with the rate limiting now in place by the sources, and will often just stop
> with incomplete results and not let you know they are incomplete.

収集元は Wayback Machine / Common Crawl / Alien Vault OTX / URLScan / Virus Total / GhostArchive / Intelligence X（学術・有料枠のみ）。動作モードはREADMEに次のとおり。

> `-mode` … The mode to run: `U` (retrieve URLs only), `R` (download Responses only) or `B` (Both).
> If `-i` is a domain only, then `-mode` will default to `B`. If `-i` is a domain with path then `-mode` will default to `R`.

JS偵察で効く主要オプション（README準拠）。

| Arg | 意味（README準拠） |
|---|---|
| `-i` / `--input` | 対象ドメイン（またはドメインのファイル）。`www.` は付けない |
| `-oR` / `--output-responses` | ダウンロードした応答の保存先ディレクトリ |
| `-l` / `--limit` | 保存する応答数。**正値=先頭N件、負値=末尾N件、0=全件**（default: 5000） |
| `-ci` / `--capture-interval` | 1URLにつき最大1キャプチャ/時(`h`)・日(`d`)・月(`m`)。default `d`、`none` で無制限 |
| `-ko` / `--keywords-only` | キーワード（正規表現）に合うものだけ。**JSだけ採るなら `-ko "\.js(\?.*\|$)"`** |
| `-ra` / `--regex-after` | 全ソース由来のリンク**および**DL済み応答に対する事後フィルタ |
| `-oijs` / `--output-inline-js` | `-mode R`/`B` 時、**インラインJSを結合**して `combinedInline{N}.js` に保存（1ファイル1000スクリプト）。外部 `src` 一覧は `combinedInlineSrc.txt` |
| `-url-filename` | 保存名をURLベースにする（既定はハッシュ＝同一応答は1ファイルに集約） |
| `-from` / `-to` | 期間指定（`YYYY` / `YYYYMM`） |
| `-co` / `--check-only` | 何リクエスト・どれくらい時間がかかりそうかを事前見積り |
| `-p` | 並列プロセス数（READMEは **default 3 のままを推奨**） |

出力ファイルは、`-mode U`/`B` で得たリンク一覧が `waymore.txt`、`-mode R`/`B` かつ `-url-filename` なしのときは `<hash>,<archive URL>,<timestamp>` 形式のCSV `index.txt` になる（README逐語の実例）。

```
4847147712618,https://web.archive.org/web/20220426044405/https://www.redbull.com/additional-services/geo ,2022-06-24 20:07:50.603486
```

応答本体は、拡張子がパスから、なければ content-type から決まり、javascript を含む content type は `.js` として保存される。保存前に `web.archive.org` への参照は除去される（README明記）。使用例と強い注意書き（README逐語）。

```
waymore -i redbull.com -mode U | unfurl keys | sort -u
cat redbull_subs.txt | waymore
```

> ⚠️ **A common mistake that is made is passing a file of subdomains to get everything for a domain. DON'T DO IT!
> Just pass the domain only to get all subs for that domain. It will be SO much quicker, and you won't miss anything.**
>
> 👉 **THIS TOOL CAN BE VERY SLOW, BUT IT IS MEANT FOR COVERAGE, NOT SPEED**

つまり、サブドメインのファイルを渡すのではなくドメインだけを渡すのが正しい。応答取得を途中で止めても、`responses.tmp` と `continueResp.tmp` が残り、次回起動時に「続きから再開するか」を尋ねられる。

〔補足〕JS狙いの典型起動。

```bash
# アーカイブ済みJSの「本体」だけを、日次1キャプチャ・2022年以降で収集
waymore -i example.com -mode B -ko "\.js(\?.*|$)" -ci d -from 2022 -oR ./waymore_js -l 0
# インラインJSも結合回収
waymore -i example.com -mode R -oijs -oR ./waymore_js
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: osintteam.blog「Automate JavaScript (JS) Extraction for Bug Bounty Recon」 — https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 遮断＝Medium系ドメインがCONNECT 403で拒否。freedium・web.archive.org・archive.ph 等の代替経路も全滅）。以下の記述は各ツール公式ドキュメントにもとづく再構成であり、記事本文の引用ではない。
> **読みどころ**:
> 1. 著者独自のワンライナーの「つなぎ方」を学ぶ。本節のステージ1〜8と照合し、どの段を省略しどの段に独自の工夫を入れているか（特に `anew` の差し込み位置）を比較する。
> 2. `.js` 抽出の正規表現を学ぶ。本節の `grep -iE 'https?://[^ ]+\.js(\?[^ ]*)?$'` より取りこぼしの少ない書き方か、クエリ付き・パス途中・`.js.map` の扱いを見る。
> 3. 自動化の実装形態を学ぶ。cron か GitHub Actions か単発シェルか、通知（Telegram/Slack/Discord）の組み込み方。
> 4. レート制限・スコープ事故の回避策を学ぶ。大量クロールで対象に負荷をかけない配慮の記述があるか。
> **代替手段**: 無料で足りる同等資料として JSFScan.sh（自動化の実装。README: https://raw.githubusercontent.com/KathanP19/JSFScan.sh/master/README.md ）、katana の JS クロール、waymore の README を挙げる。読者環境で開ける場合は web.archive.org または freedium.cfd 経由も有効。

---

## 6. ステージ4：JSファイルの抽出

収集した大量URL群から `.js` に該当するものだけを抜き出す段。方法は複数ある。

### 6-1. grep で .js を抜く

〔補足〕最も素朴だが確実な方法。

```bash
# 収集URLから .js だけ（クエリ付きも許容）を一意化
grep -iE 'https?://[^ ]+\.js(\?[^ ]*)?$' urls.txt | sort -u > jsurls.txt
# もっと緩く（パス途中の .js も）
grep -oiE 'https?://[^"'"'"' ]+\.js' urls.txt | sort -u | anew jsurls.txt
```

### 6-2. getJS（script src を抽出）

`getJS` は「extracting JavaScript sources from URLs, web pages, and HTTP responses」。オプションと使用例（README逐語）。

```
- `-url string`: The URL from which JavaScript sources should be extracted.
- `-input string`: Optional URLs input files. Each URL should be on a new line in plain text format. Can be used multiple times.
- `-output string`: Optional output file where results are written to. Can be used multiple times.
- `-complete`: Complete/Autofill relative URLs by adding the current origin.
- `-resolve`: Resolve the JavaScript files. Can only be used in combination with `--complete`.
- `-threads int`: The number of processing threads to spawn (default: 2).
- `-method string`: The request method used to fetch remote contents (default: "GET").
- `-header string`: Optional request headers to add to the requests. Can be used multiple times.
- `-timeout duration`: The request timeout while fetching remote contents (default: 5s).
```

```
getJS -url https://destroy.ai
curl https://destroy.ai | getJS
getJS -url "http://example.com" -header "User-Agent: foo bar" -method POST --timeout=15s
getJS -input foo.txt -input bar.txt
getJS -url "http://example.com" -output results.txt
```

相対URLを絶対化し、到達可能なものだけ解決するには `-complete` と `-resolve` を併用する。

### 6-3. subjs（URL/サブドメインからJSを取得）

`subjs` は「subjs fetches javascript files from a list of URLS or subdomains」。READMEは「gau とペアにして、その後 LinkFinder に渡す」ことを推奨している。使用例とフラグ（README逐語）。

```bash
$ cat urls.txt | subjs
$ subjs -i urls.txt
$ cat hosts.txt | gau | subjs
```

| Flag | Description | Example |
|------|-------------|---------|
| `-c` | Number of concurrent workers | `subjs -c 40` |
| `-i` | Input file containing URLS | `subjs -i urls.txt` |
| `-t` | Timeout (in seconds) for http client (default 15) | `subjs -t 20` |
| `-ua` | User-Agent to send in requests | `subjs -ua "Chrome..."` |

### 6-4. JSFScan.sh（まるごと自動化）

記事①のタイトルがまさに扱う領域の既存実装。サブドメインリストを渡すだけで、収集→エンドポイント→シークレット→ワードリスト→DOM XSS→HTMLレポートまで一気に回す。READMEの機能一覧とオプション（逐語）。

```
1 - Gather Jsfile Links from different sources.
2 - Import File Containing JSUrls
3 - Extract Endpoints from Jsfiles
4 - Find Secrets from Jsfiles
5 - Get Jsfiles store locally for manual analysis
6 - Make a Wordlist from Jsfiles
7 - Extract Variable names from jsfiles for possible XSS.
8 - Scan JsFiles For DomXSS.
9 - Generate Html Report.
```

```
Usage:
       -l   Gather Js Files Links
       -f   Import File Containing JS Urls
       -e   Gather Endpoints For JSFiles
       -s   Find Secrets For JSFiles
       -m   Fetch Js Files for manual testing
       -o   Make an Output Directory to put all things Together
       -w   Make a wordlist using words from jsfiles
       -v   Extract Vairables from the jsfiles
       -d   Scan for Possible DomXSS from jsfiles
       -r   Generate Scan Report in html
       --all Scan Everything!
```

インストールと入力形式（README逐語）。入力は `https://` / `http://` 付きの生存URL一覧である必要がある。

```
$ git clone https://github.com/KathanP19/JSFScan.sh
$ cd JSFScan.sh/
$ docker build . -t jsfscan
$ docker run -it jsfscan "/bin/bash"
```

```
https://hackerone.com
https://github.com
```

> このスクリプトは内部で `hakrawler` 等を呼ぶ**薄いオーケストレータ**である。本節のステージ1〜8を1本のシェルに落とすと何になるか、の実例として `JSFScan.sh` 本体を読む価値が高い。認証付きクロールをしたい場合はスクリプト23行目の `hakrawler` 行を直接編集する設計になっている（READMEは「重ければ23行目をコメントアウトしてよい、ただしリンクが少し減る」と注記）。

---

## 7. ステージ5：ダウンロードと整形、そしてソースマップ復元

### 7-1. beautify（整形）

抽出したJSはミニファイ（1行に圧縮）されていることが多い。beautify（整形）してから grep や解析にかけると、正規表現のマッチ精度と可読性が上がる。ミニファイとは、空白や改行を除いてファイルサイズを縮める処理のこと。

〔補足〕一括ダウンロードと整形。

```bash
mkdir -p js
# jsurls.txt の各URLを保存（ファイル名衝突を避けるためハッシュ名など）
while read -r u; do
  fn="js/$(echo -n "$u" | md5sum | cut -c1-16).js"
  curl -sSL --max-time 30 -A "Mozilla/5.0" "$u" -o "$fn"
done < jsurls.txt

# js-beautify（npm install -g js-beautify）で整形
for f in js/*.js; do js-beautify "$f" > "${f%.js}.beauty.js"; done
```

### 7-2. ソースマップ（.js.map）から元ソースを復元する — sourcemapper

これは高度な漏洩ハンティングの核心の一つである。webpack などのビルドツールは、開発時のデバッグを助けるために**ソースマップ**を生成する。ソースマップとは、ミニファイ・難読化された本番コードを、元のソースコードの行・ファイルに対応づける地図ファイル（`.js.map`）のこと。これが本番に残っていると、**難読化前の元のソースコードがディレクトリ構成つきでそのまま復元できる**。

READMEの定義（逐語）。

> Sourcemapper is a bit of golang to parse a sourcemap, as generated by webpack or similar, and spit out the original
> JavaScript files, recreating the source tree based on the file paths in the sourcemap.

インストールとヘルプ全文（README逐語）。

```bash
go install github.com/denandz/sourcemapper@latest
```

```text
Usage of ./sourcemapper:
  -dir string
    	Directory of .map files to process recursively
  -header value
    	A header to send with the request, similar to curl's -H. Can be set multiple times...
  -help
    	Show help
  -insecure
    	Ignore invalid TLS certificates
  -jsurl string
    	URL to JavaScript file
  -output string
    	Source file output directory - REQUIRED
  -proxy string
    	Proxy URL
  -url string
    	URL or path to the Sourcemap file
```

`-url`, `-jsurl`, `-dir` は排他（同時に1つだけ）で、`-output` は必須である。3つの入口の使い分けは次のとおり。

- **`-url`** … `.map` のURL/ローカルパスを直接渡す。復元結果は `webpack:/app/scripts/components/` のような元のディレクトリ構造として展開される。README実行例（逐語・抜粋）。

```text
doi@asov:~$ ./sourcemapper -output dhubsrc -url https://hub.docker.com/public/js/client.356c14916fb23f85707f.js.map
[+] Retriving Sourcemap from https://hub.docker.com/public/js/client.356c14916fb23f85707f.js.map
[+] Read 23045027 bytes, parsing JSON
[+] Retrieved Sourcemap with version 3, containing 1828 entries
[+] Writing 9076765 bytes to dhubsrc/webpack:/js/client.356c14916fb23f85707f.js
[+] Writing 3174 bytes to dhubsrc/webpack:/app/scripts/client.js
```

- **`-jsurl`** … JSファイルのURLを渡すと、sourcemap参照があるか判定し、あればDLしてパースする。絶対・相対・`data:`（base64のインライン）参照に対応する。

```text
$ ./sourcemapper -output test -jsurl http://localhost:8080/main.js
[.] Found SourceMap in JavaScript body: data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxl...
[+] Writing 4262 bytes to test/webpack:/app/node_modules/ansi-html-community/index.js.
```

- **`-dir`** … `.map` を集めたディレクトリを再帰的に一括処理する。壊れたsourcemapはログを出してスキップされ、1つのファイルでバッチ全体が止まらない。

**セキュリティ上の注意（README逐語）**。

> **Note: sourcemapper will retrieve any URL referenced as a sourcemap, so a malicious JavaScript file parsed with
> sourcemapper can force sourcemapper to make a GET request to any URL**

つまり、信頼できない対象のJSを解析する行為自体が SSRF（Server-Side Request Forgery）的なリスクになる。SSRFとは、ツールやサーバーを騙して意図しない先へリクエストを送らせる攻撃のこと。隔離環境や `-proxy` 経由での実行を検討する。

〔補足〕ソースマップの在り処を探す。

```bash
# 収集済みJSから sourceMappingURL 参照を洗い出す（ミニファイ1行でも拾えるよう -a を付ける）
grep -aoE 'sourceMappingURL=[^[:space:]"'"'"']+' js/*.js | sort -u

# 参照が無くても慣例の .map を総当たりしてみる（存在すれば200が返る）
while read -r u; do
  curl -sS -o /dev/null -w "%{http_code} ${u}.map\n" --max-time 20 "${u}.map"
done < jsurls.txt | grep '^200'

# 見つかったJSを sourcemapper に食わせて元ソースを復元
while read -r u; do sourcemapper -jsurl "$u" -output "src/$(echo -n "$u"|md5sum|cut -c1-12)"; done < jsurls.txt

# 復元後は「元ソース」に対してシークレットスキャンをかけるのが効率的
trufflehog filesystem ./src/ --results=verified,unknown --json > secrets_from_sourcemaps.json
```

> なぜ効くか。復元された元ソースには、変数名・コメント・`.env` 相当の設定オブジェクト・テスト用資格情報が難読化前の姿で残っていることがある。ミニファイ済みバンドルに正規表現を当てるより、シグナル対ノイズ比（有用な所見と誤検知の比）が桁違いに良い。

> ### 📌 ここは自分で開いて読んでください
> **資料**: samael0x4.medium.com「Hunting Sensitive Data Leaks in JavaScript: An Advanced Recon Guide」 — https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 遮断＝`*.medium.com` がCONNECT 403で拒否。freedium・web.archive.org・archive.ph・scribe.rip 等の代替も全滅）。以下は各ツール公式ドキュメントにもとづく再構成であり、記事本文の引用ではない。
> **読みどころ**:
> 1. 著者の正規表現セットを学び、本節7-6（SecretFinder既定辞書）・7-7（secrets-patterns-db の1600超）を基準線として、独自パターンが何を追加しているかを見る。
> 2. 「Advanced」の中身を特定する。本節が一次資料から補った高度技法は (a) ソースマップ復元、(b) アーカイブ応答本体の発掘、(c) 検証付き検出 `trufflehog --results=verified`、(d) 構文木ベースの `jsluice secrets`。記事がこれ以外（DevToolsでの動的解析、Webpackチャンク列挙、GraphQLイントロスペクション等）を扱っていれば、それが本節に欠けている知識である。
> 3. 誤検知削減の方法論を学ぶ。本節7-10の「四層構え」と比較する。
> 4. 影響評価と報告の作法を学ぶ。「公開前提のクライアントキー」と「本当に漏れてはいけない鍵」の見分け方。ここは独学が最も難しいので重点的に読む。
> **代替手段**: 無料で足りる同等資料として sourcemapper（https://raw.githubusercontent.com/denandz/sourcemapper/master/README.md ）、背景解説 https://pulsesecurity.co.nz/articles/javascript-from-sourcemaps 、jsluice、trufflehog、secrets-patterns-db の各README。読者環境で開ける場合は web.archive.org または freedium.cfd 経由も有効。

---

## 8. ステージ6：エンドポイント抽出

整形済みJSから、相対パス・APIパス・完全URLなどの**エンドポイント**を抽出する段。エンドポイントとは、アプリがデータをやり取りするURLの入口（`/api/v2/users` など）のこと。

### 8-1. LinkFinder（定番・詳細は別節25）

`LinkFinder`（GerbenJavado/LinkFinder）はJS中のエンドポイントを正規表現で抽出する定番。基本形（詳細は本教科書の別節25参照）。

```bash
python3 linkfinder.py -i https://example.com/1.js -o cli
python3 linkfinder.py -i https://example.com -d -o results.html   # ドメイン全体を走査
python3 linkfinder.py -i 'js/*.beauty.js' -o cli                  # ローカルのファイル群
```

### 8-2. jsluice（構文解析でURL/シークレット抽出）

`jsluice` は正規表現だけでなく **go-tree-sitter による構文木**を用いる。構文木とは、コードを文法的な構造（どこが代入で、どこが関数呼び出しか）として解析した木構造のこと。`document.location` への代入、`window.open()` や `fetch()` への引数など「URLが使われる場所」を狙って抽出するため、単純な正規表現では見落とすクエリパラメータも拾える。

READMEの要点（逐語）。

> Rather than using regular expressions alone, `jsluice` uses `go-tree-sitter` to look for places that
> URLs are known to be used, such as being assigned to `document.location`, passed to `window.open()`,
> or passed to `fetch()` etc.

文字列連結を理解する例（README逐語）。素朴な grep は `method` パラメータを取り逃すが、jsluice は連結を解して `"/login?redirect=EXPR&method=oauth"`（queryParams: method, redirect）を得られる。値が確定できない式は `EXPR` に置換される。

```
▶ JS='document.location = "/login?redirect=" + redirect + "&method=oauth"'
▶ echo $JS | grep -oE 'document\.location = "[^"]+"'
document.location = "/login?redirect="
```

インストールと基本サブコマンド。

```
▶ go install github.com/BishopFox/jsluice/cmd/jsluice@latest
```

```bash
cat file.beauty.js | jsluice urls       # URL/パス抽出
cat file.beauty.js | jsluice secrets    # シークレット抽出
```

なお katana からは `-jsl`（`-jsluice`）で jsluice 解析を内蔵有効化できる（メモリ消費大）。

### 8-3. xnLinkFinder（LinkFinderの発展形）

`xnLinkFinder` は、LinkFinder の正規表現を出発点に、**入力ソースの幅**と**出力の種類**を大幅に広げたツール。エンドポイント・潜在パラメータ・対象固有ワードリスト・シークレットをまとめて出せる。READMEの自己紹介（逐語）。

> This is a tool used to discover endpoints, discover potential parameters, generate a target specific wordlist and
> find secrets for a given target.

受け付ける入力は、ドメイン/URL、URLのファイル、ディレクトリ、単一ファイル、Burp XML、ZAPメッセージ、Caido CSV、HAR、そして**waymore結果ディレクトリ**である。インストール（README逐語）。

```bash
pip install xnLinkFinder
```

主要引数（README表の逐語要点）。

| Arg | Long Arg | 意味 |
|---|---|---|
| `-i` | `--input` | URL / URLリスト / ディレクトリ / Burp XML / ZAP / Caido CSV / HAR / 単一ファイル |
| `-o` | `--output` | リンク出力先（default `output.txt`）。`cli` でSTDOUTのみ |
| `-op` | `--output-params` | **潜在パラメータ**の出力先（default `parameters.txt`） |
| `-owl` | `--output-wordlist` | **対象固有ワードリスト**の出力先 |
| `-os` | `--output-secrets` | **応答中のシークレット**をJSONで出力（型と値でグループ化） |
| `-sp` | `--scope-prefix` | `/` 始まりの相対リンクにスコープドメインを補完 |
| `-sf` | `--scope-filter` | 出力をスコープ内ドメインに限定。**ドメイン/URL入力時は必須** |
| `-ra` | `--regex-after` | 出力前のフィルタ正規表現（例 `/api/v[0-9]\.[0-9]*`） |
| `-d` | `--depth` | 探索深度（default 1）。Burp/ZAP/Caido/HAR入力では無視 |
| `-c` / `-H` | `--cookies` / `--headers` | 認証情報の付与 |

使用例（README逐語）。本パイプラインの `jsurls.txt` がそのまま入力になる。

```
xnLinkFinder -i target.com -sf target.com
xnLinkFinder -i target_js.txt -sf target.com
xnLinkFinder -i ~/.config/waymore/results/target.com
```

> **本節で最も実務価値が高い連携**がこれである。`waymore -mode B` でアーカイブ応答を落とし、そのディレクトリを `xnLinkFinder -i` に渡すだけで、「**過去に存在したJSの中身から**エンドポイント・パラメータ・シークレットを抽出」できる。現行サイトのクロールでは絶対に到達できない領域である。なお `-sf`（scope-filter）はドメイン/URL入力時に必須で、これは「スコープ外のサイトをクロールしないため」に必須化された。事故を防ぐ設計そのものなので、面倒がらず必ず付ける。

---

## 9. ステージ7：シークレット抽出

JS中にハードコードされたAPIキー・トークン・認証情報を探す段。シークレットとは、本来は秘密にすべき鍵や資格情報のこと。**正規表現ベース**（SecretFinder / gf / gitleaks）と**検証機能付き**（trufflehog）を組み合わせるのが実務的である。

### 9-1. SecretFinder

`SecretFinder` は「discover sensitive data like apikeys, accesstoken, authorizations, jwt … in JavaScript files」。ヘルプと使用例（README逐語）。

```
usage: SecretFinder.py [-h] [-e] -i INPUT [-o OUTPUT] [-r REGEX] [-b]
                       [-c COOKIE] [-g IGNORE] [-n ONLY] [-H HEADERS] [-p PROXY]
  -e, --extract         Extract all javascript links located in a page and process it
  -i INPUT              Input a: URL, file or folder
  -o OUTPUT             Where to save the file... Default: output.html
  -g IGNORE             Ignore js url, if it contain the provided string (string;string2..)
  -n ONLY              Process js url, if it contain the provided string (string;string2..)
```

```
python3 SecretFinder.py -i https://example.com/1.js -o cli
python3 SecretFinder.py -i https://example.com/ -e
python3 SecretFinder.py -i https://example.com/ -e -g 'jquery;bootstrap;api.google.com'
```

`-o cli` は STDOUT 出力で、jsbeautifier を使わないぶん高速。`-g` で外部ライブラリ（jQueryなど）を除外できる点が、後述の誤検知削減で効く。

### 9-2. jsluice secrets

構文木ベースでキーと値の両方を検査し、親オブジェクトを文脈（context）として付けられる。出力例（README逐語）。この `context` があると、そのキーが何のために使われているかまで分かる。

```
{
  "kind": "fakeApi",
  "data": { "key": "apiKey", "value": "AUTH_1a2b3c4d5e6f" },
  "severity": "low",
  "context": { "apiKey": "AUTH_1a2b3c4d5e6f", "apiURL": "https://api.example.com/v2/" }
}
```

### 9-3. trufflehog（検証付き検出）

`trufflehog` の最大の特徴は、検出したシークレットを**プロバイダに対して実際に検証（verify）**できること。つまり「本当に今も生きている鍵か」を判定できる。JS偵察では、ダウンロード済みJSディレクトリを `filesystem` で走査するのが実務的。使用例（README逐語）。

```bash
trufflehog filesystem path/to/file1.txt path/to/dir
trufflehog git https://github.com/trufflesecurity/test_keys --results=verified
trufflehog github --org=trufflesecurity --results=verified
trufflehog s3 --bucket=<bucket name> --results=verified,unknown
```

`--results=verified` は検証に成功した本物のみを出すので、誤検知を大幅に削減できる。`verified,unknown` にすると、検証はできないが高信頼のものも含む。

〔補足〕ダウンロード済みJSディレクトリの走査。

```bash
trufflehog filesystem ./js/ --results=verified,unknown --json > secrets_trufflehog.json
```

### 9-4. gitleaks（ベースライン運用）

`gitleaks` は正規表現ベースで `git` / `dir` / `stdin` の3モードを持つ。差分運用に有用な**ベースライン**機能がある。ベースラインとは「既知の検出をまとめたファイル」で、これを渡すと既知分を無視して新規のみ報告できる。

```
gitleaks git --report-path gitleaks-report.json
gitleaks git --baseline-path gitleaks-report.json --report-path findings.json
```

〔補足〕JSディレクトリ走査。

```bash
gitleaks dir -v ./js/ -f json -r gitleaks-js.json
```

### 9-5. gf（名前付きgrepパターン）

`gf` は「A wrapper around grep to avoid typing common patterns.（よく使うgrepパターンを打ち直さずに済ませるラッパ）」。パターンは `~/.gf/*.json` に保存する（README逐語）。

```
▶ cat ~/.gf/php-sources.json
{ "flags": "-HnrE", "pattern": "(\\$_(POST|GET|COOKIE|REQUEST|SERVER|FILES)|php://(input|stdin))" }
```

```
▶ gf <tab>
base64  debug-pages  fw  php-curl  php-errors  php-sinks  php-sources  sec  takeovers  urls
```

### 9-6. シークレット正規表現辞書（SecretFinder 既定）

SecretFinder が内蔵する `_regex` 辞書の逐語。JS内シークレット探索の正規表現集としてそのまま流用できる（gf / grep / `httpx -er` などに）。

```py
_regex = {
    'google_api'     : r'AIza[0-9A-Za-z-_]{35}',
    'google_captcha' : r'6L[0-9A-Za-z-_]{38}|^6[0-9a-zA-Z_-]{39}$',
    'google_oauth'   : r'ya29\.[0-9A-Za-z\-_]+',
    'amazon_aws_access_key_id' : r'A[SK]IA[0-9A-Z]{16}',
    'amazon_mws_auth_toke' : r'amzn\\.mws\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    'amazon_aws_url' : r's3\.amazonaws.com[/]+|[a-zA-Z0-9_-]*\.s3\.amazonaws.com',
    'facebook_access_token' : r'EAACEdEose0cBA[0-9A-Za-z]+',
    'authorization_basic' : r'basic\s*[a-zA-Z0-9=:_\+\/-]+',
    'authorization_bearer' : r'bearer\s*[a-zA-Z0-9_\-\.=:_\+\/]+',
    'authorization_api' : r'api[key|\s*]+[a-zA-Z0-9_\-]+',
    'mailgun_api_key' : r'key-[0-9a-zA-Z]{32}',
    'twilio_api_key' : r'SK[0-9a-fA-F]{32}',
    'twilio_account_sid' : r'AC[a-zA-Z0-9_\-]{32}',
    'twilio_app_sid' : r'AP[a-zA-Z0-9_\-]{32}',
    'paypal_braintree_access_token' : r'access_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}',
    'square_oauth_secret' : r'sq0csp-[ 0-9A-Za-z\-_]{43}|sq0[a-z]{3}-[0-9A-Za-z\-_]{22,43}',
    'square_access_token' : r'sqOatp-[0-9A-Za-z\-_]{22}|EAAA[a-zA-Z0-9]{60}',
    'stripe_standard_api' : r'sk_live_[0-9a-zA-Z]{24}',
    'stripe_restricted_api' : r'rk_live_[0-9a-zA-Z]{24}',
    'github_access_token' : r'[a-zA-Z0-9_-]*:[a-zA-Z0-9_\-]+@github\.com*',
    'rsa_private_key' : r'-----BEGIN RSA PRIVATE KEY-----',
    'ssh_dsa_private_key' : r'-----BEGIN DSA PRIVATE KEY-----',
    'ssh_dc_private_key' : r'-----BEGIN EC PRIVATE KEY-----',
    'pgp_private_block' : r'-----BEGIN PGP PRIVATE KEY BLOCK-----',
    'json_web_token' : r'ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$',
}
```

### 9-7. jsleak ＋ secrets-patterns-db（信頼度付き1600超）

`jsleak` は LinkFinder に触発されたGo製CLIで、**外部の正規表現YAMLを差し替えられる**のが利点。READMEは secrets-patterns-db との連携を明記している。使用例（README逐語）。

```
echo "http://testphp.vulnweb.com/" | jsleak -t trufflehog-v3.yaml -s
echo http://testphp.vulnweb.com/ | jsleak -l                      # Link Finder
echo http://testphp.vulnweb.com/ | jsleak -c 20 -k                # Check Status
cat urls.txt | jsleak -l -s -c 30
```

フラグは、`-s` シークレット検出、`-l` リンク抽出、`-e` 相対URLの絶対化、`-c N` 並列数、`-k` ステータス確認、`-t <yaml>` パターンファイル指定。

> **重要な制約**: READMEの「To Do」に *Support scanning local files.* が**未実装**とある。つまり jsleak は基本的に**URL入力**のツールであり、ローカル保存済みのJSディレクトリを直接走査するなら `trufflehog filesystem` / `gitleaks dir` / `SecretFinder` を使う。

`secrets-patterns-db` は「The largest open-source database for detecting secrets（シークレット検出のための最大級のオープンソースDB）」で、1600超の正規表現を**信頼度（confidence）でカテゴリ分け**している。READMEはこう説明する。

> There are limited resources online for Regular Expressions patterns for secrets. TruffleHog offers ~700 as built-in
> rules. GitLeaks offers ~60 rules. While it's a good start, it's not enough.

既存ツール用フォーマットへ変換できる（README逐語）。

```shell
./scripts/convert-rules.py --db ./db/rules-stable.yml --type trufflehogv3
./scripts/convert-rules.py --db ./db/rules-stable.yml --type gitleaks
```

### 9-8. Mantra（JS＋HTMLからAPIキー）

`Mantra` はGo製で、「JavaScriptファイルとHTMLページからAPIキーを探す」。JSファイル専用ツールと違い**HTMLページも見る**点が差である。インストール（README逐語）。

```
go install github.com/Brosck/mantra@latest
```

> **正直な限界**: このREADMEの「Help」「Usage」は**スクリーンショット画像のみ**で、フラグ一覧がテキストで存在しない。したがって Mantra の個別オプションはここに書けない（書けば捏造になる）。読者は `mantra -h` を実行して確認すること。なおリポジトリの現行版は `brosck/mantra` である（`MrEmpy/Mantra` は404と実測確認済み）。

### 9-9. nuclei（露出テンプレートの大規模実行）

`nuclei` は、テンプレート化した検査を大量ホストへ一括適用するツール。JS偵察の文脈では「収集したURL/ホスト群への露出（exposure）テンプレート適用」に使う。基本形（README逐語）。

```
$ nuclei -target example.com
$ nuclei -target example.com -t http/cves/ -t ssl
$ nuclei -list hosts.txt
$ nuclei -target example.com -json-export output.json
```

READMEのテンプレート分類には「Secret files or data exposure」というカテゴリが明示されている。

> **ここは慎重に**: 個々のテンプレートの具体パスは nuclei 本体のREADMEには列挙されていない。実際のパスは `nuclei-templates` リポジトリまたは `nuclei -tl`（テンプレート一覧）で確認する。本節はREADMEに書かれた範囲を超えた具体パスを断定しない。

### 9-10. 誤検知を削る「四層構え」

JS内シークレット探索で初心者が必ずぶつかるのが**誤検知の山**である。取得済みの一次資料から、有効な対策は次の4層に整理できる。

| 層 | 手段 | 根拠（README） |
|---|---|---|
| 1. 構文で絞る | `jsluice secrets` … 正規表現でなく構文木でキーと値を見て、親オブジェクトを `context` に付与 | BishopFox/jsluice |
| 2. 実際に検証する | `trufflehog --results=verified` … 検出値をプロバイダに問い合わせて生死判定。`verified,unknown` で高信頼のみ | trufflesecurity/trufflehog |
| 3. 既知分を消す | `gitleaks --baseline-path <前回レポート>` … 既知の検出を無視し新規のみ報告 | gitleaks/gitleaks |
| 4. 信頼度で切る | secrets-patterns-db の `confidence` ／ `jsleak -t <yaml>` でパターン群を差し替え | mazen160/secrets-patterns-db, channyein1337/jsleak |

さらに入力側のノイズ除去が効く。外部ライブラリ除外（`SecretFinder -g 'jquery;bootstrap'`）、同一応答の重複排除（waymore は既定でハッシュ名保存＝同一応答は1ファイル）、差分だけ流す（`anew` で前回分を除外）。

〔補足〕検出後の作法。見つかった鍵は**権限の有無を最小限の無害な方法で確認**するに留め、データの読み出し・変更・他アカウントへの影響が出る操作は行わない。Firebase の `apiKey` のように**設計上クライアントに配布される公開キー**は、それ自体は脆弱性ではない。報告の分かれ目は「鍵が見つかった」ことではなく「その鍵で何が不正にできるか（設定不備の実害）」を示せるかである。

---

## 10. ステージ8：差分監視（更新を捉える）

対象のJSは頻繁に更新される。**新しいエンドポイントやキーが混入した瞬間**を捉えるため、継続監視（差分検知）を組み込むのが上級偵察である。

### 10-1. anew（新規行のみ追記＆出力）

`anew` は「Append lines from stdin to a file, but only if they don't already appear in the file.（標準入力の行を、ファイルにまだ無いものだけ追記する）」。新しく出た行だけを次段に流せる。例（README逐語）。

```
▶ cat newthings.txt | anew things.txt
Three
Four
```

`-d` はドライラン（ファイルに追記せず標準出力だけ）、`-q` は静音（追記のみ、標準出力なし）。

〔補足〕anew を使った継続偵察の骨格。

```bash
subfinder -d example.com -all -silent | anew subs.txt | httpx -silent | anew live.txt \
  | katana -jc -silent | anew urls.txt | grep -iE '\.js(\?|$)' | anew jsurls.txt
```

### 10-2. JSMon（JS変更監視）

`JSMon` は、指定したJSファイル群を毎回取得して前回版と比較し、変わっていれば Telegram などへ通知するツール。仕組み（README要点）は、監視対象を `targets/` に1行1エンドポイントで書き、取得結果を `downloads/` に md5 ハッシュ先頭10文字のファイル名で保存し、変化があれば通知する。インストールと cron 設定（README逐語）。

```bash
git clone https://github.com/robre/jsmon.git
cd jsmon
python setup.py install
```

```
JSMON_NOTIFY_TELEGRAM=True
JSMON_TELEGRAM_TOKEN=YOUR TELEGRAM TOKEN
JSMON_TELEGRAM_CHAT_ID=YOUR TELEGRAM CHAT ID
```

```
crontab -e
@daily /path/to/jsmon.sh
```

READMEは「`.sh` を実行すること（そうしないと環境変数が壊れる）」と明記。監視対象追加と初回取得。

```
echo "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.5.1/jquery.js" >> targets/cdnjs-example
python jsmon.py
```

### 10-3. 自前の差分監視

〔補足〕JSMonを使わなくても、ハッシュ保存＋再取得＋diffで同等のことができる。

```bash
while read -r u; do
  new=$(curl -sSL --max-time 30 -A "Mozilla/5.0" "$u")
  key=$(echo -n "$u" | md5sum | cut -c1-16)
  old="monitor/$key.js"
  if [ -f "$old" ] && ! diff -q <(echo "$new") "$old" >/dev/null; then
    echo "[CHANGED] $u"
    diff <(js-beautify "$old") <(echo "$new" | js-beautify -) > "monitor/$key.diff"
  fi
  echo "$new" > "$old"
done < jsurls.txt
```

---

## 手を動かす

以下は許可された検証対象（自分で立てたSPAやスコープ内ドメイン）を前提とする、通しの実習である。

1. 作業ディレクトリを作る。`mkdir js src monitor && cd` して各成果物をここに残す。
2. サブドメインを列挙する。

```bash
subfinder -d example.com -all -silent -o subs.txt
```

3. 生存ホストを絞る。

```bash
httpx -l subs.txt -silent -o live.txt
```

4. 能動＋受動でURLを集め、JSだけ蓄積する。

```bash
cat live.txt | katana -jc -d 5 -em js,json,map -silent | anew jsurls.txt
cat subs.txt | gau --subs | grep -iE '\.js(\?|$)' | anew jsurls.txt
cat subs.txt | waybackurls  | grep -iE '\.js(\?|$)' | anew jsurls.txt
```

5. 「消えたJS」まで掘る。waymore でアーカイブ応答を落とし、その中身を xnLinkFinder に渡す。

```bash
waymore -i example.com -mode B -ko "\.js(\?.*|$)" -ci d -oR ./wm/example.com -l 0
xnLinkFinder -i ./wm/example.com -sf example.com -op params.txt -owl wordlist.txt -os secrets.json
```

6. ソースマップが生きていれば元ソースを復元する（最もS/N比が良い）。

```bash
grep -aoE 'sourceMappingURL=[^[:space:]"'"'"']+' js/*.js | sort -u
while read -r u; do sourcemapper -jsurl "$u" -output "src/$(echo -n "$u"|md5sum|cut -c1-12)"; done < jsurls.txt
trufflehog filesystem ./src/ --results=verified,unknown --json > secrets_from_sourcemaps.json
```

7. エンドポイントとシークレットを抽出する。

```bash
for f in js/*.js; do cat "$f" | jsluice urls; done | anew endpoints.txt
trufflehog filesystem ./js/ --results=verified,unknown --json > secrets_trufflehog.json
gitleaks dir -v ./js/ -f json -r gitleaks-js.json
```

8. 差分監視を仕込む。JSMon なら `crontab` に `@daily /path/to/jsmon.sh` を登録する。自前なら10-3のスクリプトを cron で回す。
9. 見つかった鍵は「その鍵で何が不正にできるか」まで最小限に確認し、公開前提の鍵かどうかを見極める。プログラムのポリシーに従って報告する。

---

## つまずきポイント

- **サブドメインのファイルを waymore に渡してしまう**。READMEが強く警告しているとおり、ドメインだけを渡す。そのほうが速く、しかも取りこぼさない。
- **ミニファイのまま grep する**。整形（beautify）してからのほうが正規表現のマッチ精度が上がる。1行に詰まったコードは `-a` 付き grep でないと拾えないこともある。
- **jsleak にローカルファイルを食わせようとする**。jsleak はローカルファイル走査が未実装。保存済みJSは trufflehog / gitleaks / SecretFinder で走査する。
- **誤検知の山に溺れる**。全部の正規表現をいきなり当てると数千件の誤検知になる。四層構え（構文・検証・ベースライン・信頼度）で削る。
- **公開キーを脆弱性として報告する**。Firebase の apiKey など設計上クライアントに配るキーは、それ自体は脆弱性ではない。実害を示せるかが分かれ目。
- **`-sf` を付け忘れる**。xnLinkFinder はスコープフィルタ必須。付けないとスコープ外を踏む事故につながる。
- **信頼できない対象のソースマップをそのまま解析する**。sourcemapper は参照された任意URLへGETを飛ばす（SSRF的リスク）。隔離環境や `-proxy` を使う。
- **`-kb-validate-secrets` を無断で使う**。検出鍵にライブAPI呼び出しを送るので、スコープを超えかねない。

---

## この節のまとめ

- SPAはアプリのロジックを丸ごとクライアントに配るため、JSの中に未公開エンドポイント・隠しパラメータ・ハードコードされたシークレットが埋もれやすい。
- JS偵察は「配布済みコードから攻撃面を逆算する」効率のよい recon であり、裏返せば防御側のチェックリストになる。
- 標準パイプラインは8段：スコープ確定→サブドメイン列挙→生存確認→URL収集→JS抽出→整形→エンドポイント抽出→シークレット抽出→差分監視。
- 各段は STDIN/STDOUT で連結でき、`anew` で差分を累積し `gf` で名前付きパターンを再利用して自動化する。
- `subfinder`（列挙）→`httpx`（生存）→`katana`（能動クロール、`-jc` でJS内までクロール）が収集の骨格。
- 受動収集の `gau`/`waybackurls` は「消えたURL」を、`waymore` は「消えた応答本体」まで取り戻せる。
- `waymore -mode B` の結果ディレクトリを `xnLinkFinder -i` に渡すのが最も実務価値の高い連携で、現行サイトに無い領域を掘れる。
- ソースマップ（`.js.map`）が残っていれば `sourcemapper` で元ソースをディレクトリごと復元でき、S/N比が桁違いに良い。
- シークレット抽出は正規表現ベース（SecretFinder/gitleaks/gf）と検証付き（trufflehog）を組み合わせる。
- 誤検知は「構文（jsluice）・検証（trufflehog verified）・ベースライン（gitleaks）・信頼度（secrets-patterns-db）」の四層で削る。
- 公開前提のクライアントキーは脆弱性ではない。実害を示せるかが報告の分かれ目。
- 差分監視は `JSMon` か `anew`＋cron で組み、新しいキーやエンドポイントの混入を捉える。
- Mantra の個別フラグと nuclei の露出テンプレート具体パスはREADMEに無いため、`-h` / `-tl` で各自確認する。
- 元記事2本は本環境から取得できなかったため、本節は一次ツールドキュメント由来の解説である。記事の主張として引用してはならない。

---

## 理解度チェック

1. SPAのバンドルJSに機密が埋もれやすいのはなぜか。
   ▶ 答え：SPAは最初にアプリのロジックを丸ごとクライアントへ配る設計のため、未公開APIパスや隠しパラメータ、ハードコードされたキーがコードごと配布されてしまうから。

2. `gau`/`waybackurls` と `waymore` の決定的な違いは何か。
   ▶ 答え：前者は既知URLの「一覧」を返すだけだが、waymore はアーカイブされた「応答本体（レスポンス）」までダウンロードできる。消えたJSの中身や開発者コメント、未使用パラメータを掘り起こせる。

3. ソースマップ（`.js.map`）が本番に残っていると何が起きるか。sourcemapper は何をするか。
   ▶ 答え：難読化前の元ソースコードがディレクトリ構成つきで復元できる。sourcemapper はソースマップを解析して元のソースツリーを再構築する。変数名・コメント・設定オブジェクトが残るためS/N比が良い。

4. `trufflehog --results=verified` は普通の正規表現検出と何が違うか。
   ▶ 答え：検出したシークレットをプロバイダへ実際に問い合わせて「今も生きている本物か」を検証する。誤検知を大幅に削減できる。

5. シークレット検出の誤検知を削る「四層構え」を挙げよ。
   ▶ 答え：①構文で絞る（jsluice secrets）、②実際に検証する（trufflehog verified）、③既知分を消す（gitleaks baseline）、④信頼度で切る（secrets-patterns-db の confidence／jsleak のパターン差し替え）。

6. Firebase の apiKey のような鍵を見つけた。これは脆弱性として報告すべきか。
   ▶ 答え：それ自体は脆弱性ではない。設計上クライアントに配布される公開キーだから。報告の分かれ目は「その鍵で何が不正にできるか（設定不備の実害）」を示せるかどうか。

7. xnLinkFinder でドメイン/URLを入力にするとき必須の引数は何か。なぜか。
   ▶ 答え：`-sf`（`--scope-filter`）。スコープ外のサイトをクロールしてしまう事故を防ぐために必須化されている。

8. jsleak をローカル保存済みのJSディレクトリ走査に使えないのはなぜか。代わりに何を使うか。
   ▶ 答え：jsleak はローカルファイル走査が未実装（TODO）でURL入力が基本のため。ローカルディレクトリには `trufflehog filesystem` / `gitleaks dir` / `SecretFinder` を使う。

9. 信頼できない対象のJSを sourcemapper で解析するときのリスクは何か。
   ▶ 答え：sourcemapper は参照された任意のURLへGETを飛ばすため、悪意あるJSにSSRF的に任意URLへリクエストさせられる。隔離環境や `-proxy` 経由で実行する。

10. JSの継続監視を `anew` だけで実現する考え方を説明せよ。
    ▶ 答え：各段の出力を `anew <file>` に通すと、ファイルにまだ無い「新規行だけ」が標準出力に流れる。再実行のたびに新しいサブドメイン・URL・JSだけを検出して次段（抽出・通知）へ回せる。

---

## 出典

- subfinder README: https://raw.githubusercontent.com/projectdiscovery/subfinder/HEAD/README.md
- httpx README: https://raw.githubusercontent.com/projectdiscovery/httpx/HEAD/README.md
- katana README: https://raw.githubusercontent.com/projectdiscovery/katana/HEAD/README.md
- gau README: https://raw.githubusercontent.com/lc/gau/HEAD/README.md
- waybackurls README: https://raw.githubusercontent.com/tomnomnom/waybackurls/HEAD/README.mkd
- hakrawler README: https://raw.githubusercontent.com/hakluke/hakrawler/master/README.md
- waymore README: https://raw.githubusercontent.com/xnl-h4ck3r/waymore/main/README.md
- getJS README: https://raw.githubusercontent.com/003random/getJS/master/README.md
- subjs README: https://raw.githubusercontent.com/lc/subjs/master/README.md
- JSFScan.sh README: https://raw.githubusercontent.com/KathanP19/JSFScan.sh/master/README.md
- sourcemapper README: https://raw.githubusercontent.com/denandz/sourcemapper/master/README.md
- sourcemapper 背景解説: https://pulsesecurity.co.nz/articles/javascript-from-sourcemaps
- jsluice README: https://raw.githubusercontent.com/BishopFox/jsluice/HEAD/README.mkd
- xnLinkFinder README: https://raw.githubusercontent.com/xnl-h4ck3r/xnLinkFinder/main/README.md
- SecretFinder README: https://raw.githubusercontent.com/m4ll0k/SecretFinder/master/README.md
- trufflehog README: https://raw.githubusercontent.com/trufflesecurity/trufflehog/HEAD/README.md
- gitleaks README: https://raw.githubusercontent.com/gitleaks/gitleaks/master/README.md
- gf README: https://raw.githubusercontent.com/tomnomnom/gf/HEAD/README.md
- jsleak README: https://raw.githubusercontent.com/channyein1337/jsleak/main/README.md
- secrets-patterns-db README: https://raw.githubusercontent.com/mazen160/secrets-patterns-db/master/README.md
- Mantra README: https://raw.githubusercontent.com/brosck/mantra/main/README.md
- nuclei README: https://raw.githubusercontent.com/projectdiscovery/nuclei/HEAD/README.md
- anew README: https://raw.githubusercontent.com/tomnomnom/anew/HEAD/README.mkd
- JSMon README: https://raw.githubusercontent.com/robre/jsmon/master/README.md
- （取得不能）osintteam.blog「Automate JavaScript (JS) Extraction for Bug Bounty Recon」: https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e
- （取得不能）samael0x4.medium.com「Hunting Sensitive Data Leaks in JavaScript: An Advanced Recon Guide」: https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6

<!-- sources: https://raw.githubusercontent.com/projectdiscovery/subfinder/HEAD/README.md, https://raw.githubusercontent.com/projectdiscovery/httpx/HEAD/README.md, https://raw.githubusercontent.com/projectdiscovery/katana/HEAD/README.md, https://raw.githubusercontent.com/lc/gau/HEAD/README.md, https://raw.githubusercontent.com/tomnomnom/waybackurls/HEAD/README.mkd, https://raw.githubusercontent.com/hakluke/hakrawler/master/README.md, https://raw.githubusercontent.com/xnl-h4ck3r/waymore/main/README.md, https://raw.githubusercontent.com/003random/getJS/master/README.md, https://raw.githubusercontent.com/lc/subjs/master/README.md, https://raw.githubusercontent.com/KathanP19/JSFScan.sh/master/README.md, https://raw.githubusercontent.com/denandz/sourcemapper/master/README.md, https://raw.githubusercontent.com/BishopFox/jsluice/HEAD/README.mkd, https://raw.githubusercontent.com/xnl-h4ck3r/xnLinkFinder/main/README.md, https://raw.githubusercontent.com/m4ll0k/SecretFinder/master/README.md, https://raw.githubusercontent.com/trufflesecurity/trufflehog/HEAD/README.md, https://raw.githubusercontent.com/gitleaks/gitleaks/master/README.md, https://raw.githubusercontent.com/tomnomnom/gf/HEAD/README.md, https://raw.githubusercontent.com/channyein1337/jsleak/main/README.md, https://raw.githubusercontent.com/mazen160/secrets-patterns-db/master/README.md, https://raw.githubusercontent.com/brosck/mantra/main/README.md, https://raw.githubusercontent.com/projectdiscovery/nuclei/HEAD/README.md, https://raw.githubusercontent.com/tomnomnom/anew/HEAD/README.mkd, https://raw.githubusercontent.com/robre/jsmon/master/README.md, https://pulsesecurity.co.nz/articles/javascript-from-sourcemaps, https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e, https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6 -->
<!-- terms: JS偵察, recon, SPA, バンドル, egressポリシー, サブドメイン列挙, subfinder, httpx, プロービング, katana, 能動クロール, headless, gau, waybackurls, waymore, アーカイブ応答, hakrawler, getJS, subjs, JSFScan.sh, ミニファイ, beautify, ソースマップ, sourcemapper, SSRF, LinkFinder, jsluice, 構文木, xnLinkFinder, スコープフィルタ, シークレット, SecretFinder, trufflehog, 検証, gitleaks, ベースライン, gf, jsleak, secrets-patterns-db, 信頼度, Mantra, nuclei, 露出テンプレート, 誤検知, anew, JSMon, 差分監視, エンドポイント -->
<!-- self-read: https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e | サイト側の egress 遮断（Medium系ドメインがCONNECT 403）で自動取得不能、二次情報ベース -->
<!-- self-read: https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6 | サイト側の egress 遮断（*.medium.com がCONNECT 403）で自動取得不能、二次情報ベース -->
