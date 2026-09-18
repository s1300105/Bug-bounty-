# バグバウンティ工具カタログを地図として読む — awesome-bugbounty-tools（前編: Recon と Exploitation）

> **この節で分かること**
> - `awesome-bugbounty-tools` が何であり、なぜ「1枚のREADME」という形になっているのかを説明できる。
> - バグバウンティのツール群を Recon / Exploitation / Miscellaneous という3つのメンタルモデルに整理して俯瞰できる。
> - 各サブカテゴリの収録数から「コミュニティがどこに工具を積み上げてきたか」という一次データを読み取れる。
> - クライアントサイド脆弱性ハンティングに直結するサブカテゴリ（Links / Content Discovery / Technologies / Parameters / CORS / XSS など）の一次索引として、このカタログを使えるようになる。
> - ProjectDiscovery系と tomnomnom系という「stdin→stdout でつながる小道具群」が recon の背骨になっていることを理解できる。

**元資料**: https://github.com/vavkamil/awesome-bugbounty-tools （原典取得済み。README.md 全文を raw 経由で取得し、Recon と Exploitation の全エントリを原文の説明つきで再現している）
**関連する節**: 同じカタログの後編（Miscellaneous / Secrets / postMessage / Useful / AI Agents / Uncategorized）は別節で扱う。

---

## 1. このカタログは「ツールの地図」である

バグバウンティを始めると、最初にぶつかる壁は「そもそもどんなツールがあるのか分からない」ことである。個々のツールの使い方を覚える前に、まず**世の中にどんな種類の道具が存在し、それぞれが攻撃のどの工程に効くのか**という地図が要る。この節で扱う `vavkamil/awesome-bugbounty-tools` は、まさにその地図として使えるカタログである。

このリポジトリは「バグバウンティで使うツールの厳選リスト（原文: A curated list of various bug bounty tools）」を名乗る。実体は README.md というファイル1枚だけで、そこに **412件のツールエントリ（ユニークURLは400件）** がカテゴリ別に、1行の英語説明つきで並んでいる。ソースコードもバイナリも入っておらず、あくまで「リンク集」である。

### awesome-list という形式

このリポジトリは awesome-list（オーサム・リスト）という形式に従っている。awesome-list とは、あるテーマに関する優れた資料・ツールへのリンクを人手で厳選して並べた、GitHub上のキュレーション（人が選別した一覧）リポジトリのこと。README の冒頭に付く `[![Awesome](https://awesome.re/badge.svg)](https://awesome.re)` というバッジがその目印である。たとえば「awesome-python」「awesome-security」のように、`awesome-◯◯` という名前のリポジトリは同じ流儀で作られている。

READMEの冒頭は逐語で次のようになっている。

```markdown
# Awesome Bug Bounty Tools [![Awesome](https://awesome.re/badge.svg)](https://awesome.re)

> A curated list of various bug bounty tools
```

### なぜ「1枚のREADME」なのか（設計意図）

awesome-list が README 1枚という形を取るのには理由がある。第一に、リンク集は**目次から本文まで一度に眺められる**方が索引として速い。第二に、GitHub上でそのまま整形表示され、誰でも Pull Request（変更提案）でツールを追加・削除できる。編集の敷居が低いほど、コミュニティが継続的にメンテナンスしやすい。実際このリポジトリは 6,265 個のスター（後述）を集めながら、4個しか未解決の issue を抱えていない。

〔補足〕awesome-list は「網羅」ではなく「厳選」を建前とする。つまり、ここに載っているツールは「コミュニティが載せる価値があると認めた」ものであり、逆にここに無いからといって使えないわけではない。カタログは出発点であって、終着点ではない。

## 2. リポジトリのメタデータ — このカタログは「今も生きているか」

カタログを信用してよいかを判断するには、更新が続いているか・どれだけ支持されているかを見る。以下は GitHub API 経由で取得した値である（2026-09-18 時点のスナップショット）。

| 項目 | 値（原文のまま） |
|------|------------------|
| full_name | `vavkamil/awesome-bugbounty-tools` |
| description | `A curated list of various bug bounty tools` |
| owner | `vavkamil`（user id 47953210） |
| default_branch | `main` |
| created_at | `2021-01-11T19:31:28Z` |
| pushed_at | `2026-09-02T10:48:51Z` |
| updated_at | `2026-09-18T00:42:04Z` |
| stargazers_count | `6265` |
| watchers_count | `6265` |
| forks_count | `999` |
| open_issues_count | `4` |
| size | `153`（KB） |
| topics | `awesome`, `awesome-list`, `bugbounty`, `security-tools`, `tools`, `web-security` |
| license | `CC0-1.0` / `Creative Commons Zero v1.0 Universal` |
| archived / disabled | `false` / `false` |

### 読み取れること

`created_at` は 2021年1月、直近の `pushed_at` は 2026年9月。**5年以上メンテナンスが続いている**カタログであることが分かる。archived が false なので凍結もされていない。star が 6,265、fork が 999 と支持も厚い。この「更新が続いている」という一点だけでも、リンク集としての信頼性を大きく左右する。死んだカタログは、消えたツールやアーカイブされたリポジトリを掃除できずに腐っていくからである。

### ライセンス — 教科書に引用してよい理由

ライセンスは **CC0-1.0** である。CC0 とは、著作権を可能な限り放棄して作品をパブリックドメイン（誰でも自由に使える公有状態）に近づけるライセンスのこと。READMEには逐語で次の宣言がある。

```text
To the extent possible under law, vavkamil has waived all copyright and
related or neighboring rights to this work.
```

これは「作者 vavkamil が法の許す限りこの著作物への著作権と関連する権利をすべて放棄した」という意味である。したがって、本教科書がこのカタログの内容を引用・再構成することは法的に自由である。

## 3. 全体構造 — 3つの大分類 + 未分類

READMEの `## Contents`（目次）節を読むと、カタログは大きく3つの分類と1つの未分類ブロックに分かれている。逐語のアンカー付き目次のうち、大分類の骨格は次の通りである。

```text
- Recon（偵察）
- Exploitation（攻撃・悪用）
- Miscellaneous（雑多）
    - … Useful / AI Agents / Uncategorized
```

この3分類は、そのまま**バグバウンティ作業のメンタルモデル**として使える。

```text
攻撃対象を見つける          → Recon（偵察）
見つけた穴を突く            → Exploitation（悪用）
その他の道具・後工程・雑務  → Miscellaneous（雑多）
```

### 大分類ごとの収録数

本文側で実際に数えた収録件数は以下の通りである（大分類ごとの小計）。この節では前編として **Recon（122件）** と **Exploitation（138件）** を扱う。Miscellaneous（136件）と Uncategorized（16件）は後編に譲る。

| 大分類 | 収録件数 | この節での扱い |
|--------|----------|----------------|
| Recon（偵察） | 122 | 本節で全サブカテゴリを扱う |
| Exploitation（悪用） | 138 | 本節で全サブカテゴリを扱う |
| Miscellaneous（雑多） | 136 | 後編（別節） |
| Uncategorized（未分類） | 16 | 後編（別節） |
| **総計** | **412**（ユニークURL 400） | |

〔補足〕目次と本文の見出しには一部ずれがある（たとえば SSTI Injection は本文にあるが目次の並びには明示されていない、など）。原文がそういう構造なので、本節では**本文側で実際に見出しが立っている**サブカテゴリを正として扱う。

### 「412件だがユニークURLは400件」— 12件の差は意図的なクロスリストである

先ほどから「412件（ユニークURLは400件）」と2つの数を併記してきた。この **12件の差は誤植ではなく、原文が同じツールを複数のサブカテゴリに意図的に載せている（クロスリスト＝相互掲載）** ために生じる。1つのツールが複数の脆弱性クラスに効く場合、原文はそれぞれの該当カテゴリに再掲する方針を採っているのである。

たとえば `ground-control` は「SSRF・Blind XSS・XXE のデバッグ用サーバスクリプト集」なので、SSRF・XSS・XXE の3カテゴリに計3回登場する。同様に、カタログ全体で重複しているエントリは次の通りである（ノートの照合結果）。

| ツール | 掲載回数 | 掲載されるカテゴリ |
|--------|----------|--------------------|
| `ground-control` | 3 | SSRF / XSS / XXE |
| `B-XSSRF` | 3 | SSRF / XSS / XXE |
| `Injectus` | 2 | CRLF Injection / Open Redirect |
| `httprebind` | 2 | SSRF内で2回（後述） |
| `retire.js` | 2 | Technologies ほか |
| `docem` | 2 | XSS / XXE |
| `altdns` | 2 | Subdomain Enumeration ほか |
| `SSTImap` | 2 | SSTI ほか |
| `cariddi` | 2 | （後編カテゴリ） |
| `zaproxy` | 2 | （後編カテゴリ） |

この表を知っていれば、後続の一覧で「同じツールが2回出てくる」場面に出くわしても、転記ミスではなく**原文どおりの相互掲載**だと分かる。読者が自分でユニーク件数を数え直すときも、この12件を1件に畳めば400件に一致する。

## 4. 収録数は「労力配分の一次データ」

サブカテゴリごとの収録数は、単なる件数ではない。**コミュニティがどの攻撃面に工具を積み上げてきたか**を示す一次データとして読める。収録数の多い順に並べると次のようになる。

| 順位 | サブカテゴリ | 大分類 | 件数 |
|------|--------------|--------|------|
| 1 | Subdomain Enumeration（サブドメイン列挙） | Recon | 42 |
| 2 | XSS Injection | Exploitation | 40 |
| 3 | Secrets（シークレット検出） | Miscellaneous | 29 |
| 4 | Server Side Request Forgery（SSRF） | Exploitation | 21 |
| 4 | Vulnerability Scanners | Miscellaneous | 21 |
| 6 | Buckets | Miscellaneous | 18 |
| 7 | Links（JSからのリンク抽出） | Recon | 17 |
| 8 | SQL Injection | Exploitation | 16 |
| 9 | Content Discovery | Recon | 15 |

「サブドメイン列挙」と「XSS」に工具が最も厚く積み上がっている。これは偶然ではない。サブドメイン列挙は**攻撃対象の入口を増やす**作業であり、対象が広いほど脆弱性に当たる確率が上がる。XSS は Web で最も報告数が多い脆弱性クラスの一つで、需要が大きいから道具も増える。**「どこに工具が多いか」を見れば、コミュニティがどこに労力を注いでいるかが逆算できる。** 初学者はまずこの厚い層から手を付けると、情報も仲間も多く、学びやすい。

## 5. recon の背骨 — 2つの「小道具群」

このカタログを眺めると、名前が繰り返し出てくる2つの系統に気づく。これが第4章で教える「パイプライン型 recon」の実体である。パイプライン型 recon とは、小さな単機能ツールを `|`（パイプ）でつなぎ、あるツールの出力（標準出力）を次のツールの入力（標準入力）に流し込んで、偵察を自動の流れ作業にする手法のこと。

### ProjectDiscovery 系

ProjectDiscovery という組織が作る一連の Go 製ツール群。いずれも stdin（標準入力）で対象を受け取り、stdout（標準出力）に結果を吐くよう設計されている。本カタログに登場する主なものは次の通り。

| ツール | 役割（原文説明の要旨） |
|--------|------------------------|
| `subfinder` | サブドメイン発見 |
| `dnsx` | 高速・多目的の DNS ツールキット |
| `naabu` | 高速ポートスキャナ |
| `httpx` | 高速・多目的の HTTP ツールキット |
| `katana` | 次世代のクロール／スパイダリング基盤 |
| `uncover` | 各種検索エンジンAPIで露出ホストを発見 |
| `cdncheck` | DNS/IP に紐づく技術（CDN等）の識別 |
| `tlsx` | TLS ベースのデータ収集グラバ |
| `chaos-client` | Chaos DNS API と通信する Go クライアント |
| `shuffledns` | massdns のラッパーによるサブドメイン総当り／解決 |
| `URLFinder` | 受動的に URL を収集する高速ツール |

### tomnomnom 系

`tomnomnom` という個人が作る、極端に小さく単機能な Unix 哲学のツール群。本カタログに登場するものは次の通り。

| ツール | 役割（原文説明の要旨） |
|--------|------------------------|
| `assetfinder` | あるドメインに関連するドメイン／サブドメインを発見 |
| `waybackurls` | Wayback Machine が知る全 URL を取得 |

〔補足〕後編で扱う `Useful` サブカテゴリには、同じ tomnomnom 系の `anew` `gf` `unfurl` `qsreplace` といった「パイプラインの接着剤」がまとまっている。これらは単体では地味だが、上記の道具群をつなぐ潤滑油として働く。

### なぜ「小道具をつなぐ」設計なのか（設計意図）

一枚岩の巨大ツールではなく、単機能の小道具を組み合わせる設計には狙いがある。第一に、各ツールが1つのことだけをするので**差し替えや組み替えが自由**である。サブドメイン発見だけ別のツールに替える、といったことが `|` の付け替えでできる。第二に、stdin→stdout で統一されているので**シェルの標準機能だけでパイプラインが組める**。学ぶべき「つなぎ方」は Unix のパイプ1つだけで済む。これは Unix 哲学（1つのことをうまくやるプログラムを組み合わせる）そのものである。

## 6. Recon（偵察）カテゴリ詳解

ここからは Recon の各サブカテゴリを、原文の1行説明（英語のまま逐語）とともに再現する。クライアントサイド脆弱性ハンティングに直結するサブカテゴリには、その旨を注記する。

### 6.1 Subdomain Enumeration（サブドメイン列挙・42件）

サブドメイン列挙とは、`example.com` に対する `mail.example.com` `dev.example.com` のような下位のホスト名を洗い出す作業のこと。攻撃対象の入口を増やす、recon の最初の一手である。本カタログ最大のサブカテゴリ（42件）。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `Sublist3r` | https://github.com/aboul3la/Sublist3r | Fast subdomains enumeration tool for penetration testers |
| `Amass` | https://github.com/OWASP/Amass | In-depth Attack Surface Mapping and Asset Discovery |
| `massdns` | https://github.com/blechschmidt/massdns | A high-performance DNS stub resolver for bulk lookups and reconnaissance (subdomain enumeration) |
| `Findomain` | https://github.com/Findomain/Findomain | The fastest and cross-platform subdomain enumerator, do not waste your time. |
| `Sudomy` | https://github.com/Screetsec/Sudomy | Sudomy is a subdomain enumeration tool to collect subdomains and analyzing domains performing automated reconnaissance (recon) for bug hunting / pentesting |
| `chaos-client` | https://github.com/projectdiscovery/chaos-client | Go client to communicate with Chaos DNS API. |
| `domained` | https://github.com/TypeError/domained | Multi Tool Subdomain Enumeration |
| `bugcrowd-levelup-subdomain-enumeration` | https://github.com/appsecco/bugcrowd-levelup-subdomain-enumeration | This repository contains all the material from the talk "Esoteric sub-domain enumeration techniques" given at Bugcrowd LevelUp 2017 virtual conference |
| `shuffledns` | https://github.com/projectdiscovery/shuffledns | shuffleDNS is a wrapper around massdns written in go that allows you to enumerate valid subdomains using active bruteforce as well as resolve subdomains with wildcard handling and easy input-output… |
| `puredns` | https://github.com/d3mondev/puredns | Fast domain resolver and subdomain bruteforcing with accurate wildcard filtering with wildcard(*) |
| `censys-subdomain-finder` | https://github.com/christophetd/censys-subdomain-finder | Perform subdomain enumeration using the certificate transparency logs from Censys. |
| `Turbolist3r` | https://github.com/fleetcaptain/Turbolist3r | Subdomain enumeration tool with analysis features for discovered domains |
| `censys-enumeration` | https://github.com/0xbharath/censys-enumeration | A script to extract subdomains/emails for a given domain using SSL/TLS certificate dataset on Censys |
| `tugarecon` | https://github.com/LordNeoStark/tugarecon | Fast subdomains enumeration tool for penetration testers. |
| `as3nt` | https://github.com/cinerieus/as3nt | Another Subdomain ENumeration Tool |
| `Subra` | https://github.com/si9int/Subra | A Web-UI for subdomain enumeration (subfinder) |
| `Substr3am` | https://github.com/nexxai/Substr3am | Passive reconnaissance/enumeration of interesting targets by watching for SSL certificates being issued |
| `domain` | https://github.com/jhaddix/domain/ | enumall.py Setup script for Regon-ng |
| `altdns` | https://github.com/infosec-au/altdns | Generates permutations, alterations and mutations of subdomains and then resolves them |
| `brutesubs` | https://github.com/anshumanbh/brutesubs | An automation framework for running multiple open sourced subdomain bruteforcing tools (in parallel) using your own wordlists via Docker Compose |
| `dns-parallel-prober` | https://github.com/lorenzog/dns-parallel-prober | his is a parallelised domain name prober to find as many subdomains of a given domain as fast as possible. |
| `dnscan` | https://github.com/rbsec/dnscan | dnscan is a python wordlist-based DNS subdomain scanner. |
| `knock` | https://github.com/guelfoweb/knock | Knockpy is a python tool designed to enumerate subdomains on a target domain through a wordlist. |
| `hakrevdns` | https://github.com/hakluke/hakrevdns | Small, fast tool for performing reverse DNS lookups en masse. |
| `dnsx` | https://github.com/projectdiscovery/dnsx | Dnsx is a fast and multi-purpose DNS toolkit allow to run multiple DNS queries of your choice with a list of user-supplied resolvers. |
| `subfinder` | https://github.com/projectdiscovery/subfinder | Subfinder is a subdomain discovery tool that discovers valid subdomains for websites. |
| `assetfinder` | https://github.com/tomnomnom/assetfinder | Find domains and subdomains related to a given domain |
| `crtndstry` | https://github.com/nahamsec/crtndstry | Yet another subdomain finder |
| `VHostScan` | https://github.com/codingo/VHostScan | A virtual host scanner that performs reverse lookups |
| `scilla` | https://github.com/edoardottt/scilla | Information Gathering tool - DNS / Subdomains / Ports / Directories enumeration |
| `sub3suite` | https://github.com/3nock/sub3suite | A research-grade suite of tools for subdomain enumeration, intelligence gathering and attack surface mapping. |
| `cero` | https://github.com/glebarez/cero | Scrape domain names from SSL certificates of arbitrary hosts |
| `shosubgo` | https://github.com/incogbyte/shosubgo | Small tool to Grab subdomains using Shodan api |
| `haktrails` | https://github.com/hakluke/haktrails | Golang client for querying SecurityTrails API data |
| `bbot` | https://github.com/blacklanternsecurity/bbot | A recursive internet scanner for hackers |
| `crt.go` | https://github.com/TaurusOmar/crt.sh | This Go script simplifies the process of efficiently saving and analyzing subdomain output from the crt.sh website. |
| `github-subdomains` | https://github.com/gwen001/github-subdomains | This Go tool performs searches on GitHub and parses the results to find subdomains of a given domain. |
| `gitlab-subdomains` | https://github.com/gwen001/gitlab-subdomains | This Go tool performs searches on GitLab and parses the results to find subdomains of a given domain. |
| `subdominator` | https://github.com/RevoltSecurities/Subdominator | Fast and powerfull to enumerate subdomains (50+ passive results ). |
| `csprecon` | https://github.com/edoardottt/csprecon | Discover new target domains using Content Security Policy |
| `related-domains` | https://github.com/gwen001/related-domains | Find related domains of a given domain. this tool search for domains that have been registered by the same peoples/companies. |
| `hakip2host` | https://github.com/hakluke/hakip2host | hakip2host takes a list of IP addresses via stdin, then does a series of checks to return associated domain names. |

〔補足〕上の表の `crt.go` は、表示名（`crt.go`）とリンク先URL（`https://github.com/TaurusOmar/crt.sh`）が食い違っている（リポジトリ名は `crt.sh` だが、ツール名としては `crt.go` と表記されている）。原文がこの食い違いを含んだまま掲載しているため逐語で再現しているが、混乱しないよう注記しておく。実体は crt.sh（証明書透明性ログの検索サイト）の出力を扱う Go スクリプトである。

`csprecon` に注目したい。これは **Content Security Policy（コンテンツ・セキュリティ・ポリシー, CSP）** を手がかりに新しい対象ドメインを発見する。CSP とは、ブラウザに「このページはどこのスクリプトや画像を読み込んでよいか」を宣言する HTTP ヘッダのこと。CSP に列挙された許可ドメインを逆手に取れば、同じ組織が持つ別のホストが見つかる。**クライアントサイドのセキュリティ設定（CSP）が、そのまま recon の入力になる**という、クライアントサイド視点で覚えておく価値のある例である。

### 6.2 Port Scanning（ポートスキャン・8件）

ポートスキャンとは、対象ホストのどの通信口（ポート）が開いているかを調べる作業のこと。開いているポートはそれぞれ別のサービス（攻撃面）を意味する。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `masscan` | https://github.com/robertdavidgraham/masscan | TCP port scanner, spews SYN packets asynchronously, scanning entire Internet in under 5 minutes. |
| `RustScan` | https://github.com/RustScan/RustScan | The Modern Port Scanner |
| `naabu` | https://github.com/projectdiscovery/naabu | A fast port scanner written in go with focus on reliability and simplicity. |
| `nmap` | https://github.com/nmap/nmap | Nmap - the Network Mapper. Github mirror of official SVN repository. |
| `sandmap` | https://github.com/trimstray/sandmap | Nmap on steroids. Simple CLI with the ability to run pure Nmap engine, 31 modules with 459 scan profiles. |
| `ScanCannon` | https://github.com/johnnyxmas/ScanCannon | Combines the speed of masscan with the reliability and detailed enumeration of nmap |
| `nrich` | https://gitlab.com/shodan-public/nrich | A command-line tool to quickly analyze all IPs in a file and see which ones have open ports/ vulnerabilities. |
| `NimScan` | https://github.com/elddy/NimScan/ | Fast Port Scanner 🚀 |

### 6.3 Screenshots（スクリーンショット・10件）

大量のホストを一枚ずつブラウザで開くのは非現実的なので、**HTTP応答を自動でスクリーンショットに撮り、目視で攻撃面を素早く俯瞰する**ためのツール群。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `EyeWitness` | https://github.com/FortyNorthSecurity/EyeWitness | EyeWitness is designed to take screenshots of websites, provide some server header info, and identify default credentials if possible. |
| `aquatone` | https://github.com/michenriksen/aquatone | Aquatone is a tool for visual inspection of websites across a large amount of hosts and is convenient for quickly gaining an overview of HTTP-based attack surface. |
| `screenshoteer` | https://github.com/vladocar/screenshoteer | Make website screenshots and mobile emulations from the command line. |
| `gowitness` | https://github.com/sensepost/gowitness | gowitness - a golang, web screenshot utility using Chrome Headless |
| `WitnessMe` | https://github.com/byt3bl33d3r/WitnessMe | Web Inventory tool, takes screenshots of webpages using Pyppeteer (headless Chrome/Chromium) and provides some extra bells & whistles to make life easier. |
| `eyeballer` | https://github.com/BishopFox/eyeballer | Convolutional neural network for analyzing pentest screenshots |
| `scrying` | https://github.com/nccgroup/scrying | A tool for collecting RDP, web and VNC screenshots all in one place |
| `Depix` | https://github.com/beurtschipper/Depix | Recovers passwords from pixelized screenshots |
| `httpscreenshot` | https://github.com/breenmachine/httpscreenshot/ | HTTPScreenshot is a tool for grabbing screenshots and HTML of large numbers of websites. |
| `invisible-playwright` | https://github.com/feder-cr/invisible_playwright | Playwright wrapper for a stealth-patched Firefox 150 binary, useful for screenshotting and recon against targets with anti-bot detection (reCAPTCHA v3, FingerprintPro, Cloudflare). |

### 6.4 Technologies（技術特定・12件）※クライアントサイド重点

技術特定とは、対象サイトが**どのフレームワーク・ライブラリ・サーバソフトを使っているか**を見分ける作業のこと。クライアントサイド脆弱性ハンティングでは、古い JavaScript ライブラリを見つけることが直接の脆弱性発見につながる。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `wappalyzer` | https://github.com/AliasIO/wappalyzer | Identify technology on websites. |
| `webanalyze` | https://github.com/rverton/webanalyze | Port of Wappalyzer (uncovers technologies used on websites) to automate mass scanning. |
| `python-builtwith` | https://github.com/claymation/python-builtwith | BuiltWith API client |
| `whatweb` | https://github.com/urbanadventurer/whatweb | Next generation web scanner |
| `retire.js` | https://github.com/RetireJS/retire.js | scanner detecting the use of JavaScript libraries with known vulnerabilities |
| `httpx` | https://github.com/projectdiscovery/httpx | httpx is a fast and multi-purpose HTTP toolkit allows to run multiple probers using retryablehttp library, it is designed to maintain the result reliability with increased threads. |
| `fingerprintx` | https://github.com/praetorian-inc/fingerprintx | fingerprintx is a standalone utility for service discovery on open ports that works well with other popular bug bounty command line tools. |
| `graphw00f` | https://github.com/dolevf/graphw00f | graphw00f is GraphQL Server Engine Fingerprinting utility for software security professionals looking to learn more about what technology is behind a given GraphQL endpoint. |
| `wafw00f` | https://github.com/EnableSecurity/wafw00f | wafw00f allows one to identify and fingerprint Web Application Firewall (WAF) products protecting a website. |
| `cdncheck` | https://github.com/projectdiscovery/cdncheck | cdncheck is a tool for identifying the technology associated with dns / ip network addresses. |
| `tlsx` | https://github.com/projectdiscovery/tlsx | A fast and configurable TLS grabber focused on TLS based data collection and analysis. |
| `MurMurHash` | https://github.com/Viralmaniar/MurMurHash | This little tool is to calculate a MurmurHash value of a favicon. This favicon hash can be used to look for similar websites on various search engines. |

**`retire.js` はこの節の主役の一つ**である。原文の説明は「既知の脆弱性を持つ JavaScript ライブラリの使用を検出するスキャナ」。攻撃者は「サイトが読み込んでいる jQuery や Angular の古いバージョンに、既に公表された脆弱性がないか」を突く。守る側は同じ `retire.js` を CI（継続的インテグレーション）に組み込み、脆弱なライブラリを取り込んでいないかを自動チェックできる。**攻撃と防御が同じツールの表裏になっている**点を覚えておきたい。retire.js には CLI・ブラウザ拡張・CI連携の3形態があるので、詳細は一次ソースを開くとよい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: retire.js（脆弱ライブラリ検出スキャナ） — https://github.com/RetireJS/retire.js
> **なぜ**: 本教科書の執筆環境からはカタログのREADME全文は取得できたが、各ツール個別リポジトリの中身（使い方・オプション・出力形式）までは自動取得していない。以下の記述はカタログの1行説明にもとづく要約である。
> **読みどころ**:
> 1. 脆弱ライブラリ判定DBがどんな形式（バージョン範囲とCVEの対応表）で持たれているかを読む。ここを理解すると「なぜ誤検知・見逃しが起きるか」が分かる。
> 2. CLI / ブラウザ拡張 / CI の3形態それぞれの使い分けを読む。攻撃側は手動確認、防御側はCI組み込み、という対の使い方を掴む。
> **代替手段**: 同じ「技術特定」枠の `wappalyzer`（https://github.com/AliasIO/wappalyzer）はブラウザ拡張で無料。まずこちらで「サイトの技術を特定する」体験をしてから retire.js に進むとよい。

### 6.5 Content Discovery（コンテンツ探索・15件）※クライアントサイド重点

コンテンツ探索とは、リンクされていない隠れたページ・ディレクトリ・API エンドポイントを、クロールや総当りで洗い出す作業のこと。表に出ていない機能ほど、テストが甘く脆弱性が残りやすい。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `gobuster` | https://github.com/OJ/gobuster | Directory/File, DNS and VHost busting tool written in Go |
| `recursebuster` | https://github.com/C-Sto/recursebuster | rapid content discovery tool for recursively querying webservers, handy in pentesting and web application assessments |
| `feroxbuster` | https://github.com/epi052/feroxbuster | A fast, simple, recursive content discovery tool written in Rust. |
| `dirsearch` | https://github.com/maurosoria/dirsearch | Web path scanner |
| `dirsearch` | https://github.com/evilsocket/dirsearch | A Go implementation of dirsearch. |
| `filebuster` | https://github.com/henshin/filebuster | An extremely fast and flexible web fuzzer |
| `dirstalk` | https://github.com/stefanoj3/dirstalk | Modern alternative to dirbuster/dirb |
| `dirbuster-ng` | https://github.com/digination/dirbuster-ng | dirbuster-ng is C CLI implementation of the Java dirbuster tool |
| `gospider` | https://github.com/jaeles-project/gospider | Gospider - Fast web spider written in Go |
| `hakrawler` | https://github.com/hakluke/hakrawler | Simple, fast web crawler designed for easy, quick discovery of endpoints and assets within a web application |
| `crawley` | https://github.com/s0rg/crawley | fast, feature-rich unix-way web scraper/crawler written in Golang. |
| `katana` | https://github.com/projectdiscovery/katana | A next-generation crawling and spidering framework |
| `kiterunner` | https://github.com/assetnote/kiterunner | Fast API endpoint bruteforcer and content discovery tool for modern web applications. |
| `vaf` | https://github.com/andreiverse/vaf | Vaf is a cross-platform very advanced and fast web fuzzer written in nim . |
| `uncover` | https://github.com/projectdiscovery/uncover | uncover is a go wrapper using APIs of well known search engines to quickly discover exposed hosts on the internet. |

**`katana` はクライアントサイド探索の要**である。原文の説明は「次世代のクロール／スパイダリング基盤」。SPA（Single Page Application, 単一ページアプリ = JavaScriptで画面を書き換える近代的なWebアプリ）ではリンクがHTMLに書かれず、JavaScriptの実行で初めて現れる。そのため、`katana` のヘッドレスブラウザ（画面を持たずに動くブラウザ）を使った JS クロール機能で、JavaScript を実際に実行してからエンドポイントを収集する必要がある。詳細なオプションは一次ソースを開いて確認するとよい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: katana（次世代クロール／スパイダリング基盤） — https://github.com/projectdiscovery/katana
> **なぜ**: 本教科書の執筆環境ではカタログの1行説明までしか自動取得していない。ヘッドレス/JSクロールの具体的なオプションや、SPAでのエンドポイント抽出の実例は個別リポジトリを開かないと分からない。以下の記述は検索結果の一般知識とカタログの説明にもとづく要約である。
> **読みどころ**:
> 1. ヘッドレスクロールと JS クロールを有効にするオプションを読む。具体的には JS クロールを有効にする `-jc` と、ヘッドレスブラウザで動かす `-headless` の2フラグが要点。SPA相手に「静的クロールでは何が取りこぼされるか」を、この2フラグの有無で比べて理解する。
> 2. 出力を他のツール（httpxなど）へパイプする例を読む。パイプライン型 recon の一部として katana をどう挟むかを掴む。
> **代替手段**: 同じ枠の `hakrawler`（https://github.com/hakluke/hakrawler）はより軽量で、まず「クロールでエンドポイントが出てくる」体験をするのに向く。

### 6.6 Content Filtering（コンテンツ絞り込み・1件）

大量に集めた対象リストを、バグバウンティ・プログラムの**スコープ（対象範囲）**に合わせて絞り込むためのツール。スコープ外を攻撃しないための、地味だが重要な工程である。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `Hacker-Scoper` | https://github.com/ItsIgnacioPortal/Hacker-Scoper | CLI tool for filtering a mixed list of targets (URLs/IPs) according to the bug-bounty program's scope. The scope can be supplied manually, or it can also be detected automatically by just giving hacker-scoper the name of the targeted company. Hacker-Scoper supports IPs, URLs, wildcards, CIDR ranges, Nmap octet ranges, and even full Regex scopes. |

### 6.7 Links（JSからのリンク抽出・17件）※クライアントサイド最重点

Links サブカテゴリは、**JavaScript ファイルの中に書かれたエンドポイント・パス・URL を抽出する**ツール群である。クライアントサイド脆弱性ハンティングの一次索引として、まずここを開くとよい。近代的な Web アプリは、API のパスや隠れた機能への呼び出しを JavaScript の中に持っている。そこを機械的に掘り出せば、HTML には現れない攻撃面が手に入る。

#### JavaScript 攻撃面を「段階」に分解して考える

Links の各ツールをただ並べても使い分けが見えない。JavaScript を起点とする攻撃面探索は、次の段階（フェーズ）に分解すると整理できる。この分解を頭に入れておくと、「今どのツールを使う場面か」が判断できる。

```text
(A) JSファイル収集    … サイトが読み込む .js を集める      → getJS が起点
(B) エンドポイント抽出 … 集めたJSからURL/パスを掘り出す     → LinkFinder / jsluice / xnLinkFinder
(D) クロール基盤      … JSを実行して動的に出るURLも拾う     → katana（6.5）
(E) 脆弱ライブラリ検出 … 使われているJSライブラリの既知脆弱性 → retire.js（6.4）
```

（C にあたる「シークレット抽出」は後編の Secrets サブカテゴリで扱う。）この段階で見ると、Links の中の各ツールは役割が違う。

- **`getJS`（003random）は (A) の起点である。** 原文の説明は「JavaScript のソース／ファイルを高速に全部集めるツール」。まずここで対象が読み込む `.js` を残らず集め、その出力を (B) の抽出ツールへ渡す、という流れになる。
- **`xnLinkFinder`（xnl-h4ck3r）は (B) の中でも特に強力である。** 原文の説明は「エンドポイント、**潜在的なパラメータ**、そして**そのターゲット固有のワードリスト**を発見する Python ツール」。つまり単にエンドポイントを出すだけでなく、隠しパラメータの候補や、その標的専用のワードリスト（後段のファジングの燃料）まで生成する。1本で (B) から後工程の入力作りまでこなす点が、単純なリンク抽出ツールとの差である。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `LinkFinder` | https://github.com/GerbenJavado/LinkFinder | A python script that finds endpoints in JavaScript files |
| `JS-Scan` | https://github.com/zseano/JS-Scan | a .js scanner, built in php. designed to scrape urls and other info |
| `LinksDumper` | https://github.com/arbazkiraak/LinksDumper | Extract (links/possible endpoints) from responses & filter them via decoding/sorting |
| `GoLinkFinder` | https://github.com/0xsha/GoLinkFinder | A fast and minimal JS endpoint extractor |
| `BurpJSLinkFinder` | https://github.com/InitRoot/BurpJSLinkFinder | Burp Extension for a passive scanning JS files for endpoint links. |
| `urlgrab` | https://github.com/IAmStoxe/urlgrab | A golang utility to spider through a website searching for additional links. |
| `waybackurls` | https://github.com/tomnomnom/waybackurls | Fetch all the URLs that the Wayback Machine knows about for a domain |
| `gau` | https://github.com/lc/gau | Fetch known URLs from AlienVault's Open Threat Exchange, the Wayback Machine, and Common Crawl. |
| `getJS` | https://github.com/003random/getJS | A tool to fastly get all javascript sources/files |
| `linx` | https://github.com/riza/linx | Reveals invisible links within JavaScript files |
| `waymore` | https://github.com/xnl-h4ck3r/waymore | Find way more from the Wayback Machine! |
| `xnLinkFinder` | https://github.com/xnl-h4ck3r/xnLinkFinder | A python tool used to discover endpoints, potential parameters, and a target specific wordlist for a given target |
| `URLFinder` | https://github.com/projectdiscovery/urlfinder | A high-speed tool for passively gathering URLs, optimized for efficient web asset discovery without active scanning. |
| `github-endpoints` | https://github.com/gwen001/github-endpoints | This Go tool performs searches on GitHub and parses the results to find endpoints of a given domain. |
| `jsleak` | https://github.com/byt3hx/jsleak | jsleak is a tool to find secret , paths or links in JavaScript files or source code. |
| `jsfinder` | https://github.com/kacakb/jsfinder | A tool that scans web pages to find JavaScript file URLs linked in the HTML source code. |
| `jsluice` | https://github.com/BishopFox/jsluice | This tool extracts URLs, paths, secrets, and other interesting bits from JavaScript files. Values are extracted based not just on how they look, but also based on how they are used. |

**`jsluice`（BishopFox製）は特筆に値する。** 原文の説明の最後の一文が鍵で、「値は**どう見えるか**だけでなく、**どう使われているか**にもとづいて抽出される」とある。従来の `LinkFinder` などは正規表現で「URLらしい文字列」を拾うため、取りこぼしや誤検知が起きる。jsluice は JavaScript を AST（Abstract Syntax Tree, 抽象構文木 = プログラムを木構造で表した解析結果）として読み、たとえば「この文字列は `fetch()` の引数として使われている」といった**使われ方**まで見て抽出する。この精度差は、実際に両者を同じJSファイルにかけて比べると分かる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: jsluice（使われ方に基づくJS抽出ツール, BishopFox） — https://github.com/BishopFox/jsluice
> **なぜ**: 本教科書の執筆環境ではカタログの1行説明までしか自動取得していない。`jsluice urls` / `jsluice secrets` サブコマンドの実挙動や、正規表現ベースとの精度差は個別リポジトリを開かないと確認できない。以下の記述はカタログの説明にもとづく要約である。
> **読みどころ**:
> 1. 「used-based（使われ方に基づく）抽出」の具体例（READMEのExamples節）を読む。正規表現との違いを目で確認する。
> 2. `jsluice urls`（URL/パス抽出）と `jsluice secrets`（シークレット抽出）の2サブコマンドの使い分けを読む。同じJSから「攻撃面」と「漏洩情報」の両方を取る流れを掴む。
> **代替手段**: 同じ枠の `LinkFinder`（https://github.com/GerbenJavado/LinkFinder）はPythonで手軽。まず LinkFinder で正規表現ベースの抽出を体験し、その取りこぼしを jsluice と比べると学びが深い。

### 6.8 Parameters（パラメータ発見・6件）※クライアントサイド重点

パラメータ発見とは、リクエストに存在するが**リンクされていない・表に出ていないGET/POSTパラメータ**を洗い出す作業のこと。隠しパラメータは開発者がテストを忘れがちで、XSS や各種インジェクションの入口になりやすい。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `parameth` | https://github.com/maK-/parameth | This tool can be used to brute discover GET and POST parameters |
| `param-miner` | https://github.com/PortSwigger/param-miner | This extension identifies hidden, unlinked parameters. It's particularly useful for finding web alterx poisoning vulnerabilities. |
| `ParamPamPam` | https://github.com/Bo0oM/ParamPamPam | This tool for brute discover GET and POST parameters. |
| `Arjun` | https://github.com/s0md3v/Arjun | HTTP parameter discovery suite. |
| `ParamSpider` | https://github.com/devanshbatham/ParamSpider | Mining parameters from dark corners of Web Archives. |
| `x8` | https://github.com/Sh1Yo/x8 | Hidden parameters discovery suite written in Rust. |

〔補足〕`param-miner` の原文説明にある「finding **web alterx poisoning** vulnerabilities」という語は、**原文の誤記**である。「web alterx poisoning」という脆弱性クラスは実在せず、調べても何も出てこない。文脈から、一般に **web cache poisoning（Webキャッシュ・ポイズニング）** を指すとみられる（param-miner は隠しパラメータや隠しヘッダを発見でき、キャッシュ・ポイズニングの調査でよく使われる）。上の表は原文を逐語で引用しているため誤記もそのまま残しているが、読者が実在しない用語だと誤認しないよう、ここで訂正を添えておく。Webキャッシュ・ポイズニングを扱うツールとしては、後掲 7.19 の `toxicache`（web cache poisoning スキャナ）が該当する。

ファジングとは、入力欄やパスに大量のパターンを機械的に投げ込み、異常な応答（エラー・クラッシュ・想定外の挙動）から脆弱性の手がかりを探す手法のこと。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `wfuzz` | https://github.com/xmendez/wfuzz | Web application fuzzer |
| `ffuf` | https://github.com/ffuf/ffuf | Fast web fuzzer written in Go |
| `fuzzdb` | https://github.com/fuzzdb-project/fuzzdb | Dictionary of attack patterns and primitives for black-box application fault injection and resource discovery. |
| `IntruderPayloads` | https://github.com/1N3/IntruderPayloads | A collection of Burpsuite Intruder payloads, BurpBounty payloads, fuzz lists, malicious file uploads and web pentesting methodologies and checklists. |
| `fuzz.txt` | https://github.com/Bo0oM/fuzz.txt | Potentially dangerous files |
| `fuzzilli` | https://github.com/googleprojectzero/fuzzilli | A JavaScript Engine Fuzzer |
| `fuzzapi` | https://github.com/Fuzzapi/fuzzapi | Fuzzapi is a tool used for REST API pentesting and uses API_Fuzzer gem |
| `qsfuzz` | https://github.com/ameenmaali/qsfuzz | qsfuzz (Query String Fuzz) allows you to build your own rules to fuzz query strings and easily identify vulnerabilities. |
| `vaf` | https://github.com/d4rckh/vaf | very advanced (web) fuzzer written in Nim. |

`fuzzilli`（Google Project Zero製）は「JavaScript エンジンのファジャ」で、これはブラウザそのものの JavaScript エンジンにバグを探す、より深いレイヤーのツールである。同じ「ファジング」でも、Webアプリの入力欄を叩くもの（ffuf など）と、エンジンを叩くもの（fuzzilli）では対象が全く異なる点に注意したい。

### 6.10 Monitoring（監視・2件）

監視とは、対象の変化（新しいエンドポイント、変更された JavaScript、新規スコープ）を継続的に追いかけ、**変化した瞬間に気づく**ための仕組みのこと。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `bbscope` | https://github.com/sw33tLie/bbscope | Scope aggregation tool for HackerOne, Bugcrowd, Intigriti, YesWeHack, Immunefi |
| `jsmon` | https://github.com/robre/jsmon | A Javascript change monitoring tool for Bug Bounty. |

`jsmon` は「バグバウンティ向けの JavaScript 変更監視ツール」。対象サイトの JS が更新されると、新しいエンドポイントやコメントアウトされた機能が現れることがある。それを**変化した瞬間に検知する**ことで、他のハンターより先に新しい攻撃面へ到達できる。クライアントサイド脆弱性ハンティングでは、この「JSの差分監視」が息の長い定番戦術である。

## 7. Exploitation（悪用）カテゴリ詳解

Exploitation は「見つけた穴を実際に突く」段階のツール群（138件）。ここではクライアントサイドに直結する CORS / Open Redirect / XSS を厚めに扱い、他は一覧として提示する。

### 7.1 Command Injection（1件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `commix` | https://github.com/commixproject/commix | Automated All-in-One OS command injection and exploitation tool. |

### 7.2 CORS Misconfiguration（CORS設定不備・5件）※クライアントサイド重点

CORS（Cross-Origin Resource Sharing, オリジン間リソース共有）とは、あるサイトのページが別オリジン（別ドメイン）のデータを読む条件を、サーバ側のヘッダで許可する仕組みのこと。この許可設定を甘くすると、攻撃者のサイトから被害者のデータを読み出せてしまう。ここに並ぶのは、その設定不備を機械的に検出するスキャナ群である。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `Corsy` | https://github.com/s0md3v/Corsy | CORS Misconfiguration Scanner |
| `Corser` | https://github.com/cyinnove/corser | Corser is a Golang CLI Application for Advanced CORS Misconfiguration Detection. |
| `CORStest` | https://github.com/RUB-NDS/CORStest | A simple CORS misconfiguration scanner |
| `cors-scanner` | https://github.com/laconicwolf/cors-scanner | A multi-threaded scanner that helps identify CORS flaws/misconfigurations |
| `CorsMe` | https://github.com/Shivangx01b/CorsMe | Cross Origin Resource Sharing MisConfiguration Scanner |

**攻撃者はどこを突くか**: サーバが `Access-Control-Allow-Origin` に攻撃者のオリジンを反射（リクエストのOriginをそのまま許可）していないか、`null` オリジンや任意サブドメインを許していないか、を上記スキャナで探す。**どう守るか**: 許可オリジンをホワイトリスト（明示的な許可リスト）で固定し、認証付きリクエストで安易に `Allow-Credentials: true` を付けないこと。

### 7.3 CRLF Injection（4件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `CRLFsuite` | https://github.com/Nefcore/CRLFsuite | A fast tool specially designed to scan CRLF injection |
| `crlfuzz` | https://github.com/dwisiswant0/crlfuzz | A fast tool to scan CRLF vulnerability written in Go |
| `CRLF-Injection-Scanner` | https://github.com/MichaelStott/CRLF-Injection-Scanner | Command line tool for testing CRLF injection on a list of domains. |
| `Injectus` | https://github.com/BountyStrike/Injectus | CRLF and open redirect fuzzer |

### 7.4 CSRF Injection（1件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `XSRFProbe` | https://github.com/0xInfection/XSRFProbe | The Prime Cross Site Request Forgery (CSRF) Audit and Exploitation Toolkit. |

### 7.5 Directory Traversal（4件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `dotdotpwn` | https://github.com/wireghoul/dotdotpwn | DotDotPwn - The Directory Traversal Fuzzer |
| `FDsploit` | https://github.com/chrispetrou/FDsploit | File Inclusion & Directory Traversal fuzzing, enumeration & exploitation tool. |
| `off-by-slash` | https://github.com/bayotop/off-by-slash | Burp extension to detect alias traversal via NGINX misconfiguration at scale. |
| `liffier` | https://github.com/momenbasel/liffier | tired of manually add dot-dot-slash to your possible path traversal? this short snippet will increment ../ on the URL. |

### 7.6 File Inclusion（5件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `liffy` | https://github.com/mzfr/liffy | Local file inclusion exploitation tool |
| `Burp-LFI-tests` | https://github.com/Team-Firebugs/Burp-LFI-tests | Fuzzing for LFI using Burpsuite |
| `LFI-Enum` | https://github.com/mthbernardes/LFI-Enum | Scripts to execute enumeration via LFI |
| `LFISuite` | https://github.com/D35m0nd142/LFISuite | Totally Automatic LFI Exploiter (+ Reverse Shell) and Scanner |
| `LFI-files` | https://github.com/hussein98d/LFI-files | Wordlist to bruteforce for LFI |

### 7.7 GraphQL Injection（5件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `inql` | https://github.com/doyensec/inql | InQL - A Burp Extension for GraphQL Security Testing |
| `GraphQLmap` | https://github.com/swisskyrepo/GraphQLmap | GraphQLmap is a scripting engine to interact with a graphql endpoint for pentesting purposes. |
| `shapeshifter` | https://github.com/szski/shapeshifter | GraphQL security testing tool |
| `graphql_beautifier` | https://github.com/zidekmat/graphql_beautifier | Burp Suite extension to help make Graphql request more readable |
| `clairvoyance` | https://github.com/nikitastupin/clairvoyance | Obtain GraphQL API schema despite disabled introspection! |

### 7.8 Header Injection（1件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `headi` | https://github.com/mlcsec/headi | Customisable and automated HTTP header injection. |

### 7.9 Insecure Deserialization（4件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `ysoserial` | https://github.com/frohoff/ysoserial | A proof-of-concept tool for generating payloads that exploit unsafe Java object deserialization. |
| `GadgetProbe` | https://github.com/BishopFox/GadgetProbe | Probe endpoints consuming Java serialized objects to identify classes, libraries, and library versions on remote Java classpaths. |
| `ysoserial.net` | https://github.com/pwntester/ysoserial.net | Deserialization payload generator for a variety of .NET formatters |
| `phpggc` | https://github.com/ambionics/phpggc | PHPGGC is a library of PHP unserialize() payloads along with a tool to generate them, from command line or programmatically. |

### 7.10 Insecure Direct Object References（IDOR・1件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `Autorize` | https://github.com/Quitten/Autorize | Automatic authorization enforcement detection extension for burp suite written in Jython developed by Barak Tawily |

### 7.11 Open Redirect（オープンリダイレクト・4件）※クライアントサイド重点

オープンリダイレクトとは、`?next=` のようなパラメータで指定した任意のURLへ、サイトが無検証で遷移させてしまう不備のこと。フィッシングの踏み台や、他の脆弱性（OAuthトークン奪取など）の連鎖に使われる、クライアントサイドの定番バグである。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `Oralyzer` | https://github.com/r0075h3ll/Oralyzer | Open Redirection Analyzer |
| `Injectus` | https://github.com/BountyStrike/Injectus | CRLF and open redirect fuzzer |
| `dom-red` | https://github.com/Naategh/dom-red | Small script to check a list of domains against open redirect vulnerability |
| `OpenRedireX` | https://github.com/devanshbatham/OpenRedireX | A Fuzzer for OpenRedirect issues |

### 7.12 Race Condition（5件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `razzer` | https://github.com/compsec-snu/razzer | A Kernel fuzzer focusing on race bugs |
| `racepwn` | https://github.com/racepwn/racepwn | Race Condition framework |
| `requests-racer` | https://github.com/nccgroup/requests-racer | Small Python library that makes it easy to exploit race conditions in web apps with Requests. |
| `turbo-intruder` | https://github.com/PortSwigger/turbo-intruder | Turbo Intruder is a Burp Suite extension for sending large numbers of HTTP requests and analyzing the results. |
| `race-the-web` | https://github.com/TheHackerDev/race-the-web | Tests for race conditions in web applications. Includes a RESTful API to integrate into a continuous integration pipeline. |

### 7.13 Request Smuggling（5件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `http-request-smuggling` | https://github.com/anshumanpattnaik/http-request-smuggling | HTTP Request Smuggling Detection Tool |
| `smuggler` | https://github.com/defparam/smuggler | Smuggler - An HTTP Request Smuggling / Desync testing tool written in Python 3 |
| `h2csmuggler` | https://github.com/BishopFox/h2csmuggler | HTTP Request Smuggling over HTTP/2 Cleartext (h2c) |
| `tiscripts` | https://github.com/defparam/tiscripts | These scripts I use to create Request Smuggling Desync payloads for CLTE and TECL style attacks. |
| `smugglex` | github.com/hahwul/smugglex | Rust-powered HTTP Request Smuggling Scanner. |

〔補足〕上の表の `smugglex` のURLは、原文では `https://` が欠けた `github.com/hahwul/smugglex` になっている（原文の Markdown リンクが壊れている）。逐語再現のため欠けたまま載せているが、そのままコピーしてもブラウザで開けないことがある。正しくは **https://github.com/hahwul/smugglex** である。URLをコピーする際は先頭に `https://` を補うこと。

SSRF は「サーバ側」の脆弱性だが、DNS リバインディング（ブラウザ経由で内部ネットワークを攻撃する手法）系のツールが多く含まれ、クライアントサイドと接点がある。件数が21と厚いので、そのまま全件を掲げる。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `SSRFmap` | https://github.com/swisskyrepo/SSRFmap | Automatic SSRF fuzzer and exploitation tool |
| `Gopherus` | https://github.com/tarunkant/Gopherus | This tool generates gopher link for exploiting SSRF and gaining RCE in various servers |
| `ground-control` | https://github.com/jobertabma/ground-control | A collection of scripts that run on my web server. Mainly for debugging SSRF, blind XSS, and XXE vulnerabilities. |
| `SSRFire` | https://github.com/micha3lb3n/SSRFire | An automated SSRF finder. Just give the domain name and your server and chill! ;) Also has options to find XSS and open redirects |
| `httprebind` | https://github.com/daeken/httprebind | Automatic tool for DNS rebinding-based SSRF attacks |
| `ssrf-sheriff` | https://github.com/teknogeek/ssrf-sheriff | A simple SSRF-testing sheriff written in Go |
| `B-XSSRF` | https://github.com/SpiderMate/B-XSSRF | Toolkit to detect and keep track on Blind XSS, XXE & SSRF |
| `extended-ssrf-search` | https://github.com/Damian89/extended-ssrf-search | Smart ssrf scanner using different methods like parameter brute forcing in post and get... |
| `gaussrf` | https://github.com/KathanP19/gaussrf | Fetch known URLs from AlienVault's Open Threat Exchange, the Wayback Machine, and Common Crawl and Filter Urls With OpenRedirection or SSRF Parameters. |
| `ssrfDetector` | https://github.com/JacobReynolds/ssrfDetector | Server-side request forgery detector |
| `grafana-ssrf` | https://github.com/RandomRobbieBF/grafana-ssrf | Authenticated SSRF in Grafana |
| `sentrySSRF` | https://github.com/xawdxawdx/sentrySSRF | Tool to searching sentry config on page or in javascript files and check blind SSRF |
| `lorsrf` | https://github.com/knassar702/lorsrf | Bruteforcing on Hidden parameters to find SSRF vulnerability using GET and POST Methods |
| `singularity` | https://github.com/nccgroup/singularity | A DNS rebinding attack framework. |
| `whonow` | https://github.com/brannondorsey/whonow | A "malicious" DNS server for executing DNS Rebinding attacks on the fly (public instance running on rebind.network:53) |
| `dns-rebind-toolkit` | https://github.com/brannondorsey/dns-rebind-toolkit | A front-end JavaScript toolkit for creating DNS rebinding attacks. |
| `dref` | https://github.com/FSecureLABS/dref | DNS Rebinding Exploitation Framework |
| `rbndr` | https://github.com/taviso/rbndr | Simple DNS Rebinding Service |
| `httprebind` | https://github.com/daeken/httprebind | Automatic tool for DNS rebinding-based SSRF attacks |
| `dnsFookup` | https://github.com/makuga01/dnsFookup | DNS rebinding toolkit |
| `surf` | https://github.com/assetnote/surf | Escalate your SSRF vulnerabilities on Modern Cloud Environments. `surf` allows you to filter a list of hosts, returning a list of viable SSRF candidates. |

〔補足〕上の表で `httprebind`（https://github.com/daeken/httprebind）が2回並んでいる（DNS リバインディング系の並びの中で行が重複している）が、これは転記ミスではない。前述のとおり原文の SSRF カテゴリ内で同一エントリが二重掲載されており、それをそのまま逐語再現している。カタログ全体でユニークURLが400件（総エントリ412件）になる12件の差のうちの1件がこれである。

`dns-rebind-toolkit` の説明にある「front-end JavaScript toolkit」に注目。DNS リバインディングは、被害者のブラウザ（＝クライアントサイド）を経由して、外部からは届かない内部ネットワークへリクエストを飛ばす攻撃であり、まさにクライアントサイドとサーバサイドの境界を突く手法である。

### 7.15 SQL Injection（16件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `sqlmap` | https://github.com/sqlmapproject/sqlmap | Automatic SQL injection and database takeover tool |
| `NoSQLMap` | https://github.com/codingo/NoSQLMap | Automated NoSQL database enumeration and web application exploitation tool. |
| `SQLiScanner` | https://github.com/0xbug/SQLiScanner | Automatic SQL injection with Charles and sqlmap api |
| `SleuthQL` | https://github.com/RhinoSecurityLabs/SleuthQL | Python3 Burp History parsing tool to discover potential SQL injection points. To be used in tandem with SQLmap. |
| `mssqlproxy` | https://github.com/blackarrowsec/mssqlproxy | mssqlproxy is a toolkit aimed to perform lateral movement in restricted environments through a compromised Microsoft SQL Server via socket reuse |
| `sqli-hunter` | https://github.com/zt2/sqli-hunter | SQLi-Hunter is a simple HTTP / HTTPS proxy server and a SQLMAP API wrapper that makes digging SQLi easy. |
| `waybackSqliScanner` | https://github.com/ghostlulzhacks/waybackSqliScanner | Gather urls from wayback machine then test each GET parameter for sql injection. |
| `ESC` | https://github.com/NetSPI/ESC | Evil SQL Client (ESC) is an interactive .NET SQL console client with enhanced SQL Server discovery, access, and data exfiltration features. |
| `mssqli-duet` | https://github.com/Keramas/mssqli-duet | SQL injection script for MSSQL that extracts domain users from an Active Directory environment based on RID bruteforcing |
| `burp-to-sqlmap` | https://github.com/Miladkhoshdel/burp-to-sqlmap | Performing SQLInjection test on Burp Suite Bulk Requests using SQLMap |
| `BurpSQLTruncSanner` | https://github.com/InitRoot/BurpSQLTruncSanner | Messy BurpSuite plugin for SQL Truncation vulnerabilities. |
| `andor` | https://github.com/sadicann/andor | Blind SQL Injection Tool with Golang |
| `Blinder` | https://github.com/mhaskar/Blinder | A python library to automate time-based blind SQL injection |
| `sqliv` | https://github.com/the-robot/sqliv | massive SQL injection vulnerability scanner |
| `nosqli` | https://github.com/Charlie-belmer/nosqli | NoSql Injection CLI tool, for finding vulnerable websites using MongoDB. |
| `ghauri` | https://github.com/r0oth3x49/ghauri | An advanced cross-platform tool that automates the process of detecting and exploiting SQL injection security flaws |

### 7.16 XSS Injection（40件）※クライアントサイド最重点

XSS（Cross-Site Scripting, クロスサイト・スクリプティング）とは、攻撃者の用意した JavaScript を被害者のブラウザ上で実行させる脆弱性のこと。本カタログで2番目に厚い40件が積まれており、クライアントサイド脆弱性ハンティングの中心である。DOM系XSS用のスキャナ（`findom-xss` `domdig` `dom-based-xss-finder`）、Blind XSS（結果が後から届く盲目的XSS）用のフレームワーク（`ezXSS` `xsshunter` `bXSS`）、CSPバイパス（`JSONBee` `CSPBypass`）まで揃う。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `XSStrike` | https://github.com/s0md3v/XSStrike | Most advanced XSS scanner. |
| `xssor2` | https://github.com/evilcos/xssor2 | XSS'OR - Hack with JavaScript. |
| `xsscrapy` | https://github.com/DanMcInerney/xsscrapy | XSS spider - 66/66 wavsep XSS detected |
| `sleepy-puppy` | https://github.com/Netflix-Skunkworks/sleepy-puppy | Sleepy Puppy XSS Payload Management Framework |
| `ezXSS` | https://github.com/ssl/ezXSS | ezXSS is an easy way for penetration testers and bug bounty hunters to test (blind) Cross Site Scripting. |
| `xsshunter` | https://github.com/mandatoryprogrammer/xsshunter | The XSS Hunter service - a portable version of XSSHunter.com |
| `dalfox` | https://github.com/hahwul/dalfox | DalFox(Finder Of XSS) / Parameter Analysis and XSS Scanning tool based on golang |
| `xsser` | https://github.com/epsylon/xsser | Cross Site "Scripter" (aka XSSer) is an automatic -framework- to detect, exploit and report XSS vulnerabilities in web-based applications. |
| `XSpear` | https://github.com/hahwul/XSpear | Powerful XSS Scanning and Parameter analysis tool&gem |
| `weaponised-XSS-payloads` | https://github.com/hakluke/weaponised-XSS-payloads | XSS payloads designed to turn alert(1) into P1 |
| `tracy` | https://github.com/nccgroup/tracy | A tool designed to assist with finding all sinks and sources of a web application and display these results in a digestible manner. |
| `ground-control` | https://github.com/jobertabma/ground-control | A collection of scripts that run on my web server. Mainly for debugging SSRF, blind XSS, and XXE vulnerabilities. |
| `xssValidator` | https://github.com/nVisium/xssValidator | This is a burp intruder extender that is designed for automation and validation of XSS vulnerabilities. |
| `JSShell` | https://github.com/Den1al/JSShell | An interactive multi-user web JS shell |
| `bXSS` | https://github.com/LewisArdern/bXSS | bXSS is a utility which can be used by bug hunters and organizations to identify Blind Cross-Site Scripting. |
| `docem` | https://github.com/whitel1st/docem | Uility to embed XXE and XSS payloads in docx,odt,pptx,etc (OXML_XEE on steroids) |
| `XSS-Radar` | https://github.com/bugbountyforum/XSS-Radar | XSS Radar is a tool that detects parameters and fuzzes them for cross-site scripting vulnerabilities. |
| `BruteXSS` | https://github.com/rajeshmajumdar/BruteXSS | BruteXSS is a tool written in python simply to find XSS vulnerabilities in web application. |
| `findom-xss` | https://github.com/dwisiswant0/findom-xss | A fast DOM based XSS vulnerability scanner with simplicity. |
| `domdig` | https://github.com/fcavallarin/domdig | DOM XSS scanner for Single Page Applications |
| `femida` | https://github.com/wish-i-was/femida | Automated blind-xss search for Burp Suite |
| `B-XSSRF` | https://github.com/SpiderMate/B-XSSRF | Toolkit to detect and keep track on Blind XSS, XXE & SSRF |
| `domxssscanner` | https://github.com/yaph/domxssscanner | DOMXSS Scanner is an online tool to scan source code for DOM based XSS vulnerabilities |
| `xsshunter_client` | https://github.com/mandatoryprogrammer/xsshunter_client | Correlated injection proxy tool for XSS Hunter |
| `extended-xss-search` | https://github.com/Damian89/extended-xss-search | A better version of my xssfinder tool - scans for different types of xss on a list of urls. |
| `xssmap` | https://github.com/Jewel591/xssmap | XSSMap 是一款基于 Python3 开发用于检测 XSS 漏洞的工具 |
| `XSSCon` | https://github.com/menkrep1337/XSSCon | XSSCon: Simple XSS Scanner tool |
| `BitBlinder` | https://github.com/BitTheByte/BitBlinder | BurpSuite extension to inject custom cross-site scripting payloads on every form/request submitted to detect blind XSS vulnerabilities |
| `XSSOauthPersistence` | https://github.com/dxa4481/XSSOauthPersistence | Maintaining account persistence via XSS and Oauth |
| `shadow-workers` | https://github.com/shadow-workers/shadow-workers | Shadow Workers is a free and open source C2 and proxy designed for penetration testers to help in the exploitation of XSS and malicious Service Workers (SW) |
| `rexsser` | https://github.com/profmoriarity/rexsser | This is a burp plugin that extracts keywords from response using regexes and test for reflected XSS on the target scope. |
| `xss-flare` | https://github.com/EgeBalci/xss-flare | XSS hunter on cloudflare serverless workers. |
| `Xss-Sql-Fuzz` | https://github.com/jiangsir404/Xss-Sql-Fuzz | burpsuite 插件对GP所有参数(过滤特殊参数)一键自动添加xss sql payload 进行fuzz |
| `vaya-ciego-nen` | https://github.com/hipotermia/vaya-ciego-nen | Detect, manage and exploit Blind Cross-site scripting (XSS) vulnerabilities. |
| `dom-based-xss-finder` | https://github.com/AsaiKen/dom-based-xss-finder | Chrome extension that finds DOM based XSS vulnerabilities |
| `XSSTerminal` | https://github.com/machinexa2/XSSTerminal | Develop your own XSS Payload using interactive typing |
| `xss2png` | https://github.com/vavkamil/xss2png | PNG IDAT chunks XSS payload generator |
| `XSSwagger` | https://github.com/vavkamil/XSSwagger | A simple Swagger-ui scanner that can detect old versions vulnerable to various XSS attacks |
| `JSONBee` | https://github.com/zigoo0/JSONBee | A ready to use JSONP endpoints/payloads to help bypass content security policy (CSP) of different websites. |
| `CSPBypass` | https://github.com/renniepak/CSPBypass | a tool designed to help bypass restrictive Content Security Policies (CSP) and exploit XSS (Cross-Site Scripting) vulnerabilities on sites where injections are blocked by CSPs that only allow certain whitelisted domains. |

**source/sink 追跡ツールに注目**。`tracy`（nccgroup製）の説明は「Web アプリの全ての sink と source を見つけ、消化しやすい形で結果を表示する」。DOM XSS を理解するには、**source（攻撃者が制御できる入力、たとえば `location.hash`）** から **sink（実行につながる危険な出力、たとえば `innerHTML`）** への流れを追う必要がある。tracy はこの理論を実務に落とし込む道具である。`domdig` は SPA 向けの DOM XSS スキャナで、近代的な JS アプリを対象にできる。

DOM XSS を理解する主役として `tracy` を強調したが、その **UI（結果の見せ方）と出力形式**は言葉だけでは伝わりにくい。ここも一次ソースを開いて確認してほしい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: tracy（source/sink 追跡ツール, nccgroup） — https://github.com/nccgroup/tracy
> **なぜ**: 本教科書の執筆環境ではカタログの1行説明までしか自動取得していない。tracy の UI（sink/source を「消化しやすい形」で表示する画面）と出力形式は、スクリーンショットや実操作を見ないと具体像がつかめない。以下の記述はカタログの説明にもとづく要約である。
> **読みどころ**:
> 1. source（攻撃者が制御できる入力）と sink（実行につながる危険な出力）を、tracy がどんな画面・形式で対応づけて見せるかを読む。DOM XSS の「入力→出力の追跡」という抽象概念が、具体的な表示に落ちる様子を掴む。
> 2. ブラウザ拡張／プロキシとしての組み込み方と、追跡結果の出力（どのソースがどのシンクへ流れたか）の形式を読む。手作業の DOM 追跡をどこまで自動化できるかを見積もる。
> **代替手段**: source/sink の考え方だけなら、同じ XSS 枠のブラウザ拡張 `dom-based-xss-finder`（https://github.com/AsaiKen/dom-based-xss-finder）を自分のブラウザに入れ、検証用サイトで DOM XSS を検出させる体験から入るとよい。

### 7.17 XXE Injection（9件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `ground-control` | https://github.com/jobertabma/ground-control | A collection of scripts that run on my web server. Mainly for debugging SSRF, blind XSS, and XXE vulnerabilities. |
| `dtd-finder` | https://github.com/GoSecure/dtd-finder | List DTDs and generate XXE payloads using those local DTDs. |
| `docem` | https://github.com/whitel1st/docem | Uility to embed XXE and XSS payloads in docx,odt,pptx,etc (OXML_XEE on steroids) |
| `xxeserv` | https://github.com/staaldraad/xxeserv | A mini webserver with FTP support for XXE payloads |
| `xxexploiter` | https://github.com/luisfontes19/xxexploiter | Tool to help exploit XXE vulnerabilities |
| `B-XSSRF` | https://github.com/SpiderMate/B-XSSRF | Toolkit to detect and keep track on Blind XSS, XXE & SSRF |
| `XXEinjector` | https://github.com/enjoiz/XXEinjector | Tool for automatic exploitation of XXE vulnerability using direct and different out of band methods. |
| `oxml_xxe` | https://github.com/BuffaloWill/oxml_xxe | A tool for embedding XXE/XML exploits into different filetypes |
| `metahttp` | https://github.com/vp777/metahttp | A bash script that automates the scanning of a target network for HTTP resources through XXE |

### 7.18 SSTI Injection（2件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `tplmap` | https://github.com/epinna/tplmap | Server-Side Template Injection and Code Injection Detection and Exploitation Tool |
| `SSTImap` | https://github.com/vladko312/SSTImap | Automatic SSTI detection tool with interactive interface |

### 7.19 Web-Cache-Poisoning（1件）

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `toxicache` | https://github.com/xhzeem/toxicache | Go scanner to find web cache poisoning vulnerabilities in a list of URLs . |

### 7.20 Waf Evasion（WAF回避・4件）

WAF（Web Application Firewall, Webアプリケーション・ファイアウォール）とは、悪意あるリクエストを入口で弾く防御装置のこと。ここに並ぶのは、403/40X などの制限を回避するためのツール群である。攻撃検証だけでなく、**自分の防御が本当に効いているかを試す**目的でも使える。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `nomore403` | https://github.com/devploit/nomore403 | Advanced tool for security researchers to bypass 403/40X restrictions . |
| `XFFenum` | https://github.com/vavkamil/XFFenum | A simple tool to bypass 403 forbidden end-points behind load balancers (Cloudflare) based on X-Forwarded-For header. |
| `Forbidden Buster` | https://github.com/Sn1r/Forbidden-Buster | A tool designed to automate various techniques in order to bypass HTTP 401 and 403 response codes and gain access to unauthorized areas in the system. |
| `nowafpls` | https://github.com/assetnote/nowafpls/ | Burp Plugin to Bypass WAFs through the insertion of Junk Data. |

## 手を動かす

以下は「許可された診断・自分で立てた検証環境・バグバウンティのスコープ内」に限って行うこと。

1. カタログ本体を開いて全体像を掴む。ブラウザで https://github.com/vavkamil/awesome-bugbounty-tools を開き、`## Contents`（目次）を上から下まで一度スクロールする。3大分類（Recon / Exploitation / Miscellaneous）の並びを、そのまま「自分の作業手順」として頭に入れる。

2. クライアントサイドの一次索引を作る。目次の中から次の4つのサブカテゴリのリンクだけをブックマークする。`Links`（JSからのエンドポイント抽出）、`Content Discovery`（クロール）、`Technologies`（retire.js）、`Parameters`（隠しパラメータ）。これが「クライアントサイド攻撃面のツール棚」になる。

3. まず1つのツールを体験する。ブラウザ拡張の `wappalyzer`（https://github.com/AliasIO/wappalyzer）を自分のブラウザに入れ、自分が管理するサイトや検証用サイトを開いて「どんな技術が使われているか」を表示させる。技術特定という工程が何を返すかを体感する。

4. 収録数の表（本節の第4節）を見返し、「XSS が40件、サブドメイン列挙が42件」という事実から、自分が最初に深掘りすべき領域を1つ決める。工具が厚い＝情報も多い、という理由で選ぶとよい。

5. パイプラインの登場人物を確認する。第5節の2つの表（ProjectDiscovery系 / tomnomnom系）に出てくるツール名を眺め、「これらは stdin→stdout でつながる小道具である」という一点だけ覚える。個別の使い方は後の節で扱う。

## つまずきポイント

- **カタログを「全部使う道具リスト」だと誤解する**。これは索引であり、実際に使うのはこの中のごく一部でよい。まず1カテゴリ、1ツールに絞る。
- **1行説明だけで使えると思い込む**。カタログの説明はあくまで「何をするツールか」の1行であり、オプションや出力形式は個別リポジトリを開かないと分からない。📌ブロックで挙げた資料は必ず自分で開くこと。
- **star数が多い＝良いツール、と単純化する**。star は人気の指標にすぎない。用途に合うか、更新が続いているか（archived でないか）を必ず確認する。
- **目次と本文の件数のズレに戸惑う**。原文には目次と本文でわずかなズレがある。本文側の実際の見出しを正として扱えばよい。
- **同名・別作者のツールを混同する**。たとえば `dirsearch` は maurosoria版（Python）と evilsocket版（Go実装）の2つがカタログに載っている。URLで区別すること。
- **攻撃ツールを許可なく他人のサイトに向ける**。CORS・XSS・SSRF系のスキャナは、スコープ外に向ければ違法・規約違反になりうる。必ず自分の検証環境か、明示的に許可された対象だけに使う。

## この節のまとめ

- `vavkamil/awesome-bugbounty-tools` は README.md 1枚に412件のツールを並べた awesome-list 形式のカタログで、バグバウンティの「ツールの地図」として使える。
- ライセンスは CC0-1.0（パブリックドメイン相当）なので、引用・再構成は法的に自由である。
- リポジトリは2021年作成・2026年も更新中（pushed_at 2026-09-02）、star 6,265・fork 999 と、今も生きているカタログである。
- 構造は Recon（122）/ Exploitation（138）/ Miscellaneous（136）/ Uncategorized（16）の4ブロック、合計412件（ユニークURL 400）。本節は前編として Recon と Exploitation を扱った。
- サブカテゴリの収録数は「コミュニティの労力配分の一次データ」であり、Subdomain Enumeration（42）と XSS Injection（40）が二大巨頭である。
- recon の背骨は ProjectDiscovery系（subfinder/dnsx/httpx/katana など）と tomnomnom系（assetfinder/waybackurls など）で、いずれも stdin→stdout でつながる小道具群である。
- クライアントサイド脆弱性ハンティングの一次索引は、Links（JSからのリンク抽出・17件）、Content Discovery（15件）、Technologies（12件）、Parameters（6件）である。
- JavaScript 攻撃面は (A)JSファイル収集→(B)エンドポイント抽出→(D)クロール基盤→(E)脆弱ライブラリ検出の段階に分けて考えると、各ツールの使い所が整理できる。`getJS` が (A) の起点、`xnLinkFinder` は (B) でエンドポイント・潜在パラメータ・標的固有ワードリストまで生成する。
- Links の中でも `jsluice`（BishopFox）は「見た目」でなく「使われ方（AST解析）」で抽出する点が、正規表現ベースの `LinkFinder` と決定的に異なる。
- 総エントリは412件だがユニークURLは400件で、差の12件は原文が同じツールを複数カテゴリに載せる意図的なクロスリスト（`ground-control` ×3、`httprebind` は SSRF 内で2回など）である。転記ミスではない。
- 原文には軽微な誤りも含まれる（`param-miner` の「web alterx poisoning」は web cache poisoning の誤記、`smugglex` のリンクは `https://` 欠落、`crt.go` は表示名とURLの不一致）。逐語引用しつつ〔補足〕で訂正を添えてある。
- Technologies の `retire.js` は脆弱JSライブラリを検出し、攻撃側の発見にも防御側のCIチェックにも同じツールが使える。
- Content Discovery の `katana` はヘッドレス/JSクロールで SPA のエンドポイントを掘れる、近代Web向けの要のツールである。
- Exploitation 側でクライアントサイドに直結するのは CORS Misconfiguration（5）、Open Redirect（4）、XSS Injection（40）で、XSS には DOM系・Blind系・CSPバイパスまで揃う。
- XSS の DOM 系を理解する鍵は source（攻撃者制御の入力）から sink（危険な出力）への追跡であり、`tracy` がそれを可視化する。
- 攻撃ツールは必ず「許可された対象・自分の検証環境」に限って使い、防御・検出と対で理解すること。

## 理解度チェック

1. `awesome-bugbounty-tools` の実体はどんなファイル構成か。
   ▶ 答え: README.md というファイル1枚だけ。そこに412件（ユニークURL 400件）のツールが1行説明つきで並ぶリンク集である。ソースコードやバイナリは含まない。

2. このカタログを教科書に引用してよい法的根拠は何か。
   ▶ 答え: ライセンスが CC0-1.0（パブリックドメイン相当）で、作者 vavkamil が著作権と関連権利を可能な限り放棄しているため。

3. カタログの3大分類を挙げ、それぞれが攻撃のどの工程に対応するか答えよ。
   ▶ 答え: Recon（偵察＝攻撃対象を見つける）、Exploitation（悪用＝見つけた穴を突く）、Miscellaneous（雑多＝その他の道具・後工程）。

4. 収録数が最も多い2つのサブカテゴリは何か。それが示す一次データ的な意味は。
   ▶ 答え: Subdomain Enumeration（42件）と XSS Injection（40件）。工具が厚い＝コミュニティが労力を注いでいる領域であり、初学者も情報が多く学びやすい。

5. クライアントサイド脆弱性ハンティングで、JSからエンドポイントを抽出したい。カタログのどのサブカテゴリを開くべきか。代表ツールを1つ挙げよ。
   ▶ 答え: Links サブカテゴリ。代表は `jsluice`（BishopFox）や `LinkFinder`。

6. `jsluice` が従来の `LinkFinder` と決定的に違う点は何か。
   ▶ 答え: LinkFinder は正規表現で「URLらしい文字列」を拾うが、jsluice は JavaScript を AST（抽象構文木）として解析し、値が「どう使われているか」まで見て抽出する。取りこぼしと誤検知が減る。

7. `retire.js` は攻撃側と防御側でそれぞれどう使えるか。
   ▶ 答え: 攻撃側は「サイトが読み込む古いJSライブラリに既知の脆弱性がないか」を探す。防御側は同じツールをCIに組み込み、脆弱なライブラリの取り込みを自動検出する。

8. SPA（単一ページアプリ）でエンドポイントを取りこぼさないために、Content Discovery のどのツールのどんな機能が要るか。
   ▶ 答え: `katana` のヘッドレス/JSクロール機能。JavaScript を実際に実行してから、HTMLに現れないエンドポイントを収集する。

9. パイプライン型 recon を支える2つのツール系統と、その共通する設計上の特徴を答えよ。
   ▶ 答え: ProjectDiscovery系と tomnomnom系。どちらも stdin（標準入力）で受け取り stdout（標準出力）に吐く単機能の小道具で、シェルのパイプ `|` で自由につなげる（Unix哲学）。

10. DOM系XSSを追跡するときの「source」と「sink」とは何か。可視化を助けるツールを1つ挙げよ。
    ▶ 答え: source は攻撃者が制御できる入力（例: `location.hash`）、sink は実行につながる危険な出力（例: `innerHTML`）。source から sink への流れを追う。可視化ツールは `tracy`（nccgroup）。

11. カタログの総エントリは412件なのに「ユニークURLは400件」と書かれている。12件の差はなぜ生じるか。
    ▶ 答え: 原文が1つのツールを複数のサブカテゴリに意図的に再掲している（クロスリスト）ため。たとえば `ground-control` は SSRF/XSS/XXE の3カテゴリに、`httprebind` は SSRF 内で2回登場する。転記ミスではない。

12. 原文表の `param-miner` の説明にある「web alterx poisoning vulnerabilities」をどう扱うべきか。
    ▶ 答え: これは原文の誤記で、実在しない用語。一般には web cache poisoning（Webキャッシュ・ポイズニング）を指すとみられる。逐語引用は残しつつ、実在の脆弱性クラスと誤認しないよう訂正の補足を添える。

## 出典

- https://github.com/vavkamil/awesome-bugbounty-tools （README.md 全文・GitHub APIメタデータ）
- https://github.com/RetireJS/retire.js
- https://github.com/projectdiscovery/katana
- https://github.com/BishopFox/jsluice
- https://github.com/GerbenJavado/LinkFinder
- https://github.com/AliasIO/wappalyzer
- https://github.com/nccgroup/tracy
- https://github.com/003random/getJS
- https://github.com/xnl-h4ck3r/xnLinkFinder

<!-- self-read: https://github.com/RetireJS/retire.js | 個別リポジトリの使い方・DB形式・3形態の使い分けは自動取得しておらず、一次ソースを開く必要がある -->
<!-- self-read: https://github.com/projectdiscovery/katana | ヘッドレス/JSクロールの具体オプション(-jc/-headless)やSPAでの抽出例は自動取得しておらず、一次ソースを開く必要がある -->
<!-- self-read: https://github.com/BishopFox/jsluice | サブコマンドの実挙動と正規表現ベースとの精度差は自動取得しておらず、一次ソースを開く必要がある -->
<!-- self-read: https://github.com/nccgroup/tracy | source/sink追跡のUI・出力形式は自動取得しておらず、一次ソースを開く必要がある -->

<!-- sources: https://github.com/vavkamil/awesome-bugbounty-tools, https://github.com/RetireJS/retire.js, https://github.com/projectdiscovery/katana, https://github.com/BishopFox/jsluice, https://github.com/GerbenJavado/LinkFinder, https://github.com/AliasIO/wappalyzer, https://github.com/nccgroup/tracy, https://github.com/003random/getJS, https://github.com/xnl-h4ck3r/xnLinkFinder -->
<!-- terms: awesome-list, キュレーション, 同一オリジンポリシー, CORS, CSP, XSS, DOM XSS, source, sink, SSRF, DNSリバインディング, サブドメイン列挙, コンテンツ探索, ファジング, パイプライン型recon, ProjectDiscovery, tomnomnom, AST, ヘッドレスブラウザ, SPA, retire.js, jsluice, katana, getJS, xnLinkFinder, tracy, クロスリスト, Webキャッシュポイズニング, WAF, オープンリダイレクト, CC0 -->
