# JavaScript攻撃面を掘るツール群 — Awesome Bug Bounty Tools を「道具箱」から「作業手順」に読み替える

> **この節で分かること**
> - `awesome-bugbounty-tools` のカタログを、クライアントサイド脆弱性ハンティングの「作業工程」として読み替えられる
> - JavaScript攻撃面の把握を「収集→抽出→シークレット検出→検証」の段階に分解して説明できる
> - `jsluice` のような「使われ方に基づく抽出」が正規表現ベースと何が違うかを説明できる
> - postMessage/DOM XSS・CORS・CSPバイパスに使われるツールがどこを突く道具なのかを言える
> - tomnomnom系の小道具（anew/gf/uro/unfurl/qsreplace）を stdin→stdout でつなぐパイプライン思想を自分で組める
> - カタログを一次索引として使い、各ツールの一次リポジトリを自分で開いて確かめる習慣が身につく

**元資料**: https://github.com/vavkamil/awesome-bugbounty-tools （原典取得済み。README全文をrawで取得、メタデータはGitHub API経由で補完）
**関連する節**: 「Awesome Bug Bounty Tools（前半）— Recon/Exploitation カタログの全体像」（同一ノートのパート1）

---

## 0. この節の立ち位置（前半とのつなぎ）

前半のパートでは、`vavkamil/awesome-bugbounty-tools` というカタログの全体像（Recon / Exploitation / Miscellaneous / Uncategorized の4ブロック、44サブカテゴリ、ユニークURL 400件）を扱った。

この後半では、そのカタログを **「クライアントサイド脆弱性ハンティングの作業手順」に読み替える**ことに集中する。具体的には、Miscellaneous と Uncategorized に含まれるツール表を押さえたうえで、JavaScript を起点とした攻撃面把握のワークフロー（4-1〜4-5）を組み立てる。

awesome-list（アウェサム・リスト）とは、ある分野の優れた資料やツールを1つのMarkdownに厳選して並べたGitHubリポジトリ形式のこと。実体は README.md 1枚である。だからこのカタログは「読む本」ではなく「索引（インデックス）」であり、本当の情報は各ツールの個別リポジトリを開いて初めて得られる。この節はその索引を、初学者が迷わないよう工程順に並べ替える作業だと考えてほしい。

## 1. Miscellaneous ブロックのツール表（クライアントサイドに効く道具の在庫）

Miscellaneous（雑多カテゴリ）には、Recon/Exploitation のどちらにも入りきらない実務道具が集まっている。ここではクライアントサイド調査に直結するサブカテゴリを中心に、原文の説明（逐語・英語のまま）を表で示す。

### 1-1. Secrets（29件） — JS/Gitからの機密情報検出

Secrets サブカテゴリとは、ソースコードやJavaScriptファイル、Git履歴に紛れ込んだAPIキー・トークン・パスワードなどの「秘密」を見つけ出すツール群のこと。クライアントサイド調査では、ブラウザに配信されるJSに機密が埋め込まれている事故がよくあるため、ここは最重要ジャンルの一つである。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `git-secrets` | https://github.com/awslabs/git-secrets | Prevents you from committing secrets and credentials into git repositories |
| `gitleaks` | https://github.com/zricethezav/gitleaks | Scan git repos (or files) for secrets using regex and entropy |
| `truffleHog` | https://github.com/dxa4481/truffleHog | Searches through git repositories for high entropy strings and secrets, digging deep into commit history |
| `gitGraber` | https://github.com/hisxo/gitGraber | gitGraber: monitor GitHub to search and find sensitive data in real time for different online services |
| `talisman` | https://github.com/thoughtworks/talisman | By hooking into the pre-push hook provided by Git, Talisman validates the outgoing changeset for things that look suspicious - such as authorization tokens and private keys. |
| `GitGot` | https://github.com/BishopFox/GitGot | Semi-automated, feedback-driven tool to rapidly search through troves of public data on GitHub for sensitive secrets. |
| `git-all-secrets` | https://github.com/anshumanbh/git-all-secrets | A tool to capture all the git secrets by leveraging multiple open source git searching tools |
| `github-search` | https://github.com/gwen001/github-search | Tools to perform basic search on GitHub. |
| `git-vuln-finder` | https://github.com/cve-search/git-vuln-finder | Finding potential software vulnerabilities from git commit messages |
| `commit-stream` | https://github.com/x1sec/commit-stream | #OSINT tool for finding Github repositories by extracting commit logs in real time from the Github event API |
| `gitrob` | https://github.com/michenriksen/gitrob | Reconnaissance tool for GitHub organizations |
| `repo-supervisor` | https://github.com/auth0/repo-supervisor | Scan your code for security misconfiguration, search for passwords and secrets. |
| `GitMiner` | https://github.com/UnkL4b/GitMiner | Tool for advanced mining for content on Github |
| `shhgit` | https://github.com/eth0izzle/shhgit | Ah shhgit! Find GitHub secrets in real time |
| `detect-secrets` | https://github.com/Yelp/detect-secrets | An enterprise friendly way of detecting and preventing secrets in code. |
| `rusty-hog` | https://github.com/newrelic/rusty-hog | A suite of secret scanners built in Rust for performance. Based on TruffleHog |
| `whispers` | https://github.com/Skyscanner/whispers | Identify hardcoded secrets and dangerous behaviours |
| `yar` | https://github.com/nielsing/yar | Yar is a tool for plunderin' organizations, users and/or repositories. |
| `dufflebag` | https://github.com/BishopFox/dufflebag | Search exposed EBS volumes for secrets |
| `secret-bridge` | https://github.com/duo-labs/secret-bridge | Monitors Github for leaked secrets |
| `earlybird` | https://github.com/americanexpress/earlybird | EarlyBird is a sensitive data detection tool capable of scanning source code repositories for clear text password violations, PII, outdated cryptography methods, key files and more. |
| `Trufflehog-Chrome-Extension` | https://github.com/trufflesecurity/Trufflehog-Chrome-Extension | Trufflehog-Chrome-Extension |
| `noseyparker` | https://github.com/praetorian-inc/noseyparker | Nosey Parker is a command-line program that finds secrets and sensitive information in textual data and Git history. |
| `GitHound` | https://github.com/tillson/git-hound | Recon tool leveraging Code Search API. Scans for exposed API keys across all of GitHub, not just known repos and orgs. Support for GitHub dorks. |
| `cariddi` | https://github.com/edoardottt/cariddi | Take a list of domains, crawl urls and scan for endpoints, secrets, api keys, file extensions, tokens and more... |
| `SecretFinder` | https://github.com/m4ll0k/SecretFinder | A python script for finding sensitive data (apikeys, accesstoken,jwt,..) and search anything on javascript files. |
| `js-snitch` | https://github.com/vavkamil/js-snitch | Scans remote JavaScript files with Trufflehog + Semgrep to detect leaked secrets. |
| `keyhacks` | https://github.com/streaak/keyhacks | KeyHacks shows methods to validate different API keys found on a Bug Bounty Program or a pentest. |
| `keyFinder` | https://github.com/momenbasel/keyFinder | A Chrome extension that passively scans web pages for API keys, tokens, and secrets using 80+ regex patterns and Shannon entropy analysis across 10 attack surfaces. |

このうち **`SecretFinder` / `keyFinder` / `keyhacks` / `js-snitch` / `cariddi`** がとくにクライアントサイド（JSファイル）向けである。詳しくは4-1(C)で工程として説明する。

### 1-2. postMessage（2件） — クロスオリジンメッセージング

postMessage とは、異なるオリジン（Origin、スキーム＋ホスト＋ポートの組）の窓（ウィンドウやiframe）どうしが同一オリジンポリシーを越えて安全にメッセージを送り合うためのブラウザAPIのこと。受信側の検証が甘いとDOM XSSやデータ漏えいにつながるため、専用の追跡ツールがある。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `postMessage-tracker` | https://github.com/fransr/postMessage-tracker | A Chrome Extension to track postMessage usage (url, domain and stack) both by logging using CORS and also visually as an extension-icon |
| `PostMessage_Fuzz_Tool` | https://github.com/kiranreddyrebel/PostMessage_Fuzz_Tool | #BugBounty #BugBounty Tools #WebDeveloper Tool |

### 1-3. JSON Web Token（7件）

JSON Web Token（JWT）とは、ヘッダ・ペイロード・署名の3つをドット区切りで並べた、改ざん検知つきの認証トークン形式のこと。クライアント側（localStorageやCookie）に置かれることが多く、JSから漏れたトークンの検証・改ざんテストに使う。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `jwt_tool` | https://github.com/ticarpi/jwt_tool | A toolkit for testing, tweaking and cracking JSON Web Tokens |
| `c-jwt-cracker` | https://github.com/brendan-rius/c-jwt-cracker | JWT brute force cracker written in C |
| `jwt-heartbreaker` | https://github.com/wallarm/jwt-heartbreaker | The Burp extension to check JWT (JSON Web Tokens) for using keys from known from public sources |
| `jwtear` | https://github.com/KINGSABRI/jwtear | Modular command-line tool to parse, create and manipulate JWT tokens for hackers |
| `jwt-key-id-injector` | https://github.com/dariusztytko/jwt-key-id-injector | Simple python script to check against hypothetical JWT vulnerability. |
| `jwt-hack` | https://github.com/hahwul/jwt-hack | jwt-hack is tool for hacking / security testing to JWT. |
| `jwt-cracker` | https://github.com/lmammino/jwt-cracker | Simple HS256 JWT token brute force cracker |

### 1-4. その他 Miscellaneous サブカテゴリ（在庫の把握）

以下は本ブロックの残りのサブカテゴリである。クライアントサイド調査の直接の主役ではないが、周辺工程で使うので在庫として把握しておく。原文の1行説明（逐語・英語のまま）を落とさずに表で示す。名前だけ覚えても「何をする道具か」は分からないので、逐語説明を必ず添える。

なお **Vulnerability Scanners（21件）** は本節7で、**Useful（8件）** は本節6で、それぞれ表つきで詳述するのでここでは省く。

#### Passwords（5件）

ログインクラッカー（ログイン試行を自動化して認証を突破する道具）や、機器の初期パスワードのチェックに使う。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `thc-hydra` | https://github.com/vanhauser-thc/thc-hydra | Hydra is a parallelized login cracker which supports numerous protocols to attack. |
| `DefaultCreds-cheat-sheet` | https://github.com/ihebski/DefaultCreds-cheat-sheet | One place for all the default credentials to assist the Blue/Red teamers activities on finding devices with default password |
| `changeme` | https://github.com/ztgrace/changeme | A default credential scanner. |
| `BruteX` | https://github.com/1N3/BruteX | Automatically brute force all services running on a target. |
| `patator` | https://github.com/lanjelot/patator | Patator is a multi-purpose brute-forcer, with a modular design and a flexible usage. |

#### Git（7件）

Webサーバ上に消し忘れで露出した `.git` ディレクトリからリポジトリを丸ごと復元する系が中心。フロントエンドのソースコードや履歴がまるごと手に入る攻撃面であり、クライアントサイド調査とも地続きである。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `GitTools` | https://github.com/internetwache/GitTools | A repository with 3 tools for pwn'ing websites with .git repositories available |
| `gitjacker` | https://github.com/liamg/gitjacker | Leak git repositories from misconfigured websites |
| `git-dumper` | https://github.com/arthaud/git-dumper | A tool to dump a git repository from a website |
| `GitHunter` | https://github.com/digininja/GitHunter | A tool for searching a Git repository for interesting content |
| `dvcs-ripper` | https://github.com/kost/dvcs-ripper | Rip web accessible (distributed) version control systems: SVN/GIT/HG... |
| `Gato (Github Attack TOolkit)` | https://github.com/praetorian-inc/gato | GitHub Self-Hosted Runner Enumeration and Attack Tool |
| `zizmor` | https://github.com/zizmorcore/zizmor | Static analysis tool for GitHub Actions |

#### Buckets（18件）

クラウドストレージ（Amazon S3 バケットなど）の公開ミスを見つける系。とくに `kicks3` と `S3BucketList` はJS/HTMLからバケット名を拾う点でクライアントサイド寄りである。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `S3Scanner` | https://github.com/sa7mon/S3Scanner | Scan for open AWS S3 buckets and dump the contents |
| `AWSBucketDump` | https://github.com/jordanpotti/AWSBucketDump | Security Tool to Look For Interesting Files in S3 Buckets |
| `CloudScraper` | https://github.com/jordanpotti/CloudScraper | CloudScraper: Tool to enumerate targets in search of cloud resources. S3 Buckets, Azure Blobs, Digital Ocean Storage Space. |
| `s3viewer` | https://github.com/SharonBrizinov/s3viewer | Publicly Open Amazon AWS S3 Bucket Viewer |
| `festin` | https://github.com/cr0hn/festin | FestIn - S3 Bucket Weakness Discovery |
| `s3reverse` | https://github.com/hahwul/s3reverse | The format of various s3 buckets is convert in one format. for bugbounty and security testing. |
| `mass-s3-bucket-tester` | https://github.com/random-robbie/mass-s3-bucket-tester | This tests a list of s3 buckets to see if they have dir listings enabled or if they are uploadable |
| `S3BucketList` | https://github.com/AlecBlance/S3BucketList | Firefox plugin that lists Amazon S3 Buckets found in requests |
| `dirlstr` | https://github.com/cybercdh/dirlstr | Finds Directory Listings or open S3 buckets from a list of URLs |
| `Burp-AnonymousCloud` | https://github.com/codewatchorg/Burp-AnonymousCloud | Burp extension that performs a passive scan to identify cloud buckets and then test them for publicly accessible vulnerabilities |
| `kicks3` | https://github.com/abuvanth/kicks3 | S3 bucket finder from html,js and bucket misconfiguration testing tool |
| `2tearsinabucket` | https://github.com/Revenant40/2tearsinabucket | Enumerate s3 buckets for a specific target. |
| `s3_objects_check` | https://github.com/nccgroup/s3_objects_check | Whitebox evaluation of effective S3 object permissions, to identify publicly accessible files. |
| `s3tk` | https://github.com/ankane/s3tk | A security toolkit for Amazon S3 |
| `CloudBrute` | https://github.com/0xsha/CloudBrute | Awesome cloud enumerator |
| `s3cario` | https://github.com/0xspade/s3cario | This tool will get the CNAME first if it's a valid Amazon s3 bucket and if it's not, it will try to check if the domain is a bucket name. |
| `S3Cruze` | https://github.com/JR0ch17/S3Cruze | All-in-one AWS S3 bucket tool for pentesters. |
| `s3dns` | https://github.com/olizimmermann/s3dns | Passive DNS-based discovery of S3 (and other cloud) buckets by resolving CNAMEs and IPs during recon—ideal for stealthy and early identification of cloud storage exposures |

#### CMS（9件）

WordPress / Joomla / Adobe Experience Manager（AEM）など既製CMS（Content Management System、コンテンツ管理システム）の脆弱性スキャナ。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `wpscan` | https://github.com/wpscanteam/wpscan | WPScan is a free, for non-commercial use, black box WordPress security scanner |
| `WPSpider` | https://github.com/cyc10n3/WPSpider | A centralized dashboard for running and scheduling WordPress scans powered by wpscan utility. |
| `wprecon` | https://github.com/blackcrw/wprecon | Wordpress Recon |
| `Temodar Agent` | https://github.com/xeloxa/temodar-agent | AI-powered WordPress plugin/theme security analysis platform with Semgrep-based static analysis and agent-assisted investigation workflows |
| `CMSmap` | https://github.com/Dionach/CMSmap | CMSmap is a python open source CMS scanner that automates the process of detecting security flaws of the most popular CMSs. |
| `joomscan` | https://github.com/OWASP/joomscan | OWASP Joomla Vulnerability Scanner Project |
| `pyfiscan` | https://github.com/fgeek/pyfiscan | Free web-application vulnerability and version scanner |
| `aemhacker` | https://github.com/0ang3el/aem-hacker | Tools to identify vulnerable Adobe Experience Manager (AEM) webapps. |
| `aemscan` | https://github.com/Raz0r/aemscan | Adobe Experience Manager Vulnerability Scanner |

#### Subdomain Takeover（13件）

放置されたDNSレコード（dangling DNS、宙ぶらりんのDNS。指し先のサービスが消えたのに残っているCNAMEなど）を乗っ取る系。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `subjack` | https://github.com/haccer/subjack | Subdomain Takeover tool written in Go |
| `SubOver` | https://github.com/Ice3man543/SubOver | A Powerful Subdomain Takeover Tool |
| `autoSubTakeover` | https://github.com/JordyZomer/autoSubTakeover | A tool used to check if a CNAME resolves to the scope address. If the CNAME resolves to a non-scope address it might be worth checking out if subdomain takeover is possible. |
| `NSBrute` | https://github.com/shivsahni/NSBrute | Python utility to takeover domains vulnerable to AWS NS Takeover |
| `can-i-take-over-xyz` | https://github.com/EdOverflow/can-i-take-over-xyz | "Can I take over XYZ?" — a list of services and how to claim (sub)domains with dangling DNS records. |
| `cnames` | https://github.com/cybercdh/cnames | take a list of resolved subdomains and output any corresponding CNAMES en masse. |
| `subHijack` | https://github.com/vavkamil/old-repos-backup/tree/master/subHijack-master | Hijacking forgotten & misconfigured subdomains |
| `tko-subs` | https://github.com/anshumanbh/tko-subs | A tool that can help detect and takeover subdomains with dead DNS records |
| `HostileSubBruteforcer` | https://github.com/nahamsec/HostileSubBruteforcer | This app will bruteforce for existing subdomains and provide information if the 3rd party host has been properly setup. |
| `second-order` | https://github.com/mhmdiaa/second-order | Second-order subdomain takeover scanner |
| `takeover` | https://github.com/mzfr/takeover | A tool for testing subdomain takeover possibilities at a mass scale. |
| `dnsReaper` | https://github.com/punk-security/dnsReaper | DNS Reaper is yet another sub-domain takeover tool, but with an emphasis on accuracy, speed and the number of signatures in our arsenal! |
| `subzy` | https://github.com/PentestPad/subzy | Subdomain takeover tool which works based on matching response fingerprints from `can-i-take-over-xyz`. |

#### Permutation（6件）

既知のサブドメイン名を並べ替え・変異させて、新しいサブドメイン候補のワードリストを生成する系。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `alterx` | https://github.com/projectdiscovery/alterx | Fast and customizable subdomain wordlist generator using DSL. alterx takes patterns as input and generates subdomain permutation wordlist based on that pattern. |
| `gotator` | https://github.com/Josue87/gotator | Gotator is a tool to generate DNS wordlists through permutations. |
| `ripgen` | https://github.com/resyncgg/ripgen | Rust-based high performance domain permutation generator. |
| `dnsgen` | https://github.com/AlephNullSK/dnsgen | DNSGen is a powerful and flexible DNS name permutation tool designed for security researchers and penetration testers. It generates intelligent domain name variations to assist in subdomain discovery and security assessments. |
| `goaltdns` | https://github.com/subfinder/goaltdns | A permutation generation tool written in golang. |
| `altdns` | https://github.com/infosec-au/altdns | Generates permutations, alterations and mutations of subdomains and then resolves them. |

#### Web Proxy and Traffic Interception（5件）

ブラウザとサーバの間に立ってHTTP/HTTPSを傍受・改変する道具。リクエストとレスポンスを手元で書き換えられるので、クライアントサイド調査の常設装備になる。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `mitmproxy` | https://github.com/mitmproxy/mitmproxy | An interactive TLS-capable intercepting HTTP proxy for penetration testers and software developers. |
| `proxify` | https://github.com/projectdiscovery/proxify | A versatile and portable proxy for capturing, manipulating, and replaying HTTP/HTTPS traffic on the go. |
| `FoxyProxy Browser Extension` | https://github.com/foxyproxy/browser-extension | FoxyProxy is an open-source, advanced proxy management tool that completely replaces Chrome's limited proxying capabilities. |
| `zaproxy` | https://github.com/zaproxy/zaproxy | ZAP is what is known as a “manipulator-in-the-middle proxy.” It stands between the tester’s browser and the web application so that it can intercept and inspect messages sent between browser and web application, modify the contents if needed, and then forward those packets on to the destination. |
| `hetty` | https://github.com/dstotijn/hetty | hetty is a free opensource alternative to Burpsuite pro |

#### Origin IP（2件）

CDN（Content Delivery Network、配信を代行する中継網）やWAF（Web Application Firewall、Webの防火壁）の裏に隠れた、実サーバの本当のIPアドレスを探す系。実IPが分かると防御装置を迂回できる。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `CloudRip` | https://github.com/staxsum/CloudRip | A tool that helps you find the real IP addresses hiding behind Cloudflare by checking subdomains. |
| `hakoriginfinder` | https://github.com/hakluke/hakoriginfinder | Tool for discovering the origin host behind a reverse proxy. Useful for bypassing WAFs and other reverse proxies. |

### 1-5. AI Agents（4件） — 2026年の新傾向

AI Agents サブカテゴリとは、大規模言語モデル（LLM）を頭脳にして、偵察から報告までの一連の作業を自律的に進めようとするペンテスト（侵入テスト）自動化ツール群のこと。2026年時点で本カタログに新設されたサブカテゴリで、パート1の要約でも「自律型ペンテストエージェントがカタログに入り始めた」新傾向として強調した論点である。名前だけでは各ツールの正体が分からないので、原文の逐語説明をそのまま示す。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `shannon` | https://github.com/KeygraphHQ/shannon | Fully autonomous AI hacker to find actual exploits in your web apps. |
| `Darkmoon` | https://github.com/ASCIT31/Dark-Moon | Open source (GPL-3.0) autonomous AI penetration testing platform that orchestrates 80+ tools over MCP with dedicated per-technology offensive sub-agents (GraphQL, Spring Boot, ASP.NET, Node.js, Flask, PHP, Ruby) and a per-finding evidence trail. |
| `PentestGPT` | https://github.com/GreyDGL/PentestGPT | AI-powered penetration testing assistant that helps automate security testing workflows and vulnerability discovery. |
| `Agentic Bug Bounty Hunter` | https://github.com/Awarexone/Agentic-Bug-Hunter | Claude Code plugin for autonomous bug bounty hunting across HackerOne, Bugcrowd, Intigriti and Immunefi — 15 skills, 33 commands and 9 agents covering recon-to-report, 21 web vuln classes, web3/meme-coin audits, LLM red-teaming, GraphQL/CORS/JWT/NoSQL scanners and persistent hunt memory. Works with or without a subscription. |

逐語説明から読み取れる各ツールの識別情報は次の通りである。

- **`shannon`** — 自らを "Fully autonomous AI hacker"（完全自律のAIハッカー）と名乗り、Webアプリの「実際に動く攻撃（actual exploits）」を見つけることを掲げる。
- **`Darkmoon`** — ライセンスは GPL-3.0。**80以上のツールを MCP（Model Context Protocol、AIモデルと外部ツールをつなぐ規約）上でオーケストレーション（統括実行）**し、GraphQL / Spring Boot / ASP.NET / Node.js / Flask / PHP / Ruby という**技術スタックごとの専用サブエージェント**を持ち、発見ごとに証拠の履歴（evidence trail）を残す。
- **`PentestGPT`** — セキュリティテストの手順と脆弱性発見を自動化するAI補助アシスタント。
- **`Agentic Bug Bounty Hunter`** — **Claude Code のプラグイン**として動き、HackerOne / Bugcrowd / Intigriti / Immunefi をまたいで自律的にバグバウンティを行う。**15個のskill・33個のcommand・9個のagent**を備え、偵察から報告まで、21種類のWeb脆弱性クラス、web3/ミームコイン監査、**LLM の red-teaming（AIを攻撃者役でわざと試す検査）**、GraphQL/CORS/JWT/NoSQL スキャナ、持続的なハント記憶までカバーする。サブスクリプションの有無を問わず動作する。

〔補足〕これらは自律実行を掲げるが、無許可の対象に走らせれば不正アクセスになる。必ず許可された範囲・自分の検証環境に限って使うこと。自律エージェントは「対象範囲（スコープ）の外に出ない」制御が特に難しいので、扱いには通常のツール以上の注意が要る。

## 2. Uncategorized ブロック（横断的な教材リポジトリ）

Uncategorized（未分類）には、単体ツールというより「辞書」「データセット」「ワードリスト」といった横断的資料が入る。クライアントサイド調査でも燃料や参照として頻繁に使う。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `ARS3NAL` | https://github.com/inflictx/Arsenal | Offline-first, searchable arsenal for pentest & bug bounty: ~1500 payloads, a click-to-build command generator, GTFOBins, wordlists, an embedded CyberChef, reverse shells and 70 checklists. Self-hosted web app with a live static demo. |
| `RF Swift` | https://github.com/PentHertz/RF-Swift | A powerful multi-platform RF toolbox that deploys specialized radio tools in seconds on Linux, Windows, and macOS... |
| `bountyplz` | https://github.com/fransr/bountyplz | Automated security reporting from markdown templates (HackerOne and Bugcrowd are currently the platforms supported) |
| `PayloadsAllTheThings` | https://github.com/swisskyrepo/PayloadsAllTheThings | A list of useful payloads and bypass for Web Application Security and Pentest/CTF |
| `bounty-targets-data` | https://github.com/arkadiyt/bounty-targets-data | This repo contains hourly-updated data dumps of bug bounty platform scopes (like Hackerone/Bugcrowd/Intigriti/etc) that are eligible for reports |
| `android-security-awesome` | https://github.com/ashishb/android-security-awesome | A collection of android security related resources |
| `awesome-mobile-security` | https://github.com/vaib25vicky/awesome-mobile-security | An effort to build a single place for all useful android and iOS security related stuff. |
| `awesome-vulnerable-apps` | https://github.com/vavkamil/awesome-vulnerable-apps | Awesome Vulnerable Applications |
| `SecLists` | https://github.com/danielmiessler/SecLists | It's a collection of multiple types of lists used during security assessments... |
| `asnmap` | https://github.com/projectdiscovery/asnmap | Go CLI and Library for quickly mapping organization network ranges using ASN information. |
| `mapcidr` | https://github.com/projectdiscovery/mapcidr | Utility program to perform multiple operations for a given subnet/CIDR ranges. |
| `BigBountyRecon` | https://github.com/Viralmaniar/BigBountyRecon | ...utilises 58 different techniques using various Google dorks and open source tools... |
| `Bypass bot detection` | https://github.com/portswigger/bypass-bot-detection | Burp Suite extension that mutates ciphers to bypass TLS-fingerprint based bot detection. |
| `cvemap` | https://github.com/projectdiscovery/cvemap | Modern CLI for exploring vulnerability data with powerful search, filtering, and analysis capabilities. |
| `cut-cdn` | https://github.com/ImAyrix/cut-cdn | Removing CDN IPs from the list of IP addresses. |
| `ds_store_exp` | https://github.com/lijiejie/ds_store_exp | A .DS_Store file disclosure exploit. It parses .DS_Store file and downloads files recursively. |

このうちクライアントサイド脆弱性ハンティングで日常的に開くのは、ペイロード辞書の **`PayloadsAllTheThings`**、ワードリストの総本山 **`SecLists`**、スコープ（診断が許可された対象範囲）の一次データ **`bounty-targets-data`** の3つである。

## 3. JavaScript攻撃面ツールの体系（なぜこの分解が要るのか）

ここから本節の核心に入る。カタログはアルファベット順・カテゴリ順に並んでいるだけで、「どの順に使うか」は書かれていない。初学者が最初につまずくのはここである。そこで、JavaScriptを起点とした攻撃面把握を **5つの段階（A〜E）** に分解する。

〔補足（一般知識）〕以下の「役割」「使いどころ」「ツール間の関係」は、READMEの1行説明と各ツールの一般に知られた用途に基づく整理である。READMEに書かれていない機能は断定していない。

### 3-1. なぜ「攻撃面把握」から始めるのか（設計意図）

クライアントサイドの脆弱性（DOM XSS、ハードコードされたシークレット、危険なpostMessageハンドラなど）は、すべて **ブラウザが実行するJavaScriptの中**にある。だからまず「対象がどんなJSを、どのURLで配信しているか」を漏れなく集めることが出発点になる。集めきれなければ、その先の抽出も検査も穴だらけになる。この「集める→切り出す→検査する」という流れが、以下A〜Eの背骨である。

```
(A) JSの収集        どのJSが存在するか（URLの列挙）
        │
(B) 抽出            JS本文からエンドポイント/パス/パラメータを掘る
        │
(C) シークレット検出  JS内のAPIキー/トークンを見つけ、本物か検証する
        │
(D) クロール基盤     (A)(B)の入口になる汎用スパイダー
        │
(E) 既知脆弱性       古い脆弱JSライブラリをCVE照合で検出
```

#### A〜E と、この後の節4・5・6の関係

先に地図を示しておく。この A〜E は「JSという攻撃面を**収集して整理する工程**」の縦の流れである。これに対して、本節の後半（節4・5・6）はA〜Eの続きの工程ではなく、**別の軸**を扱う。

- **節4（postMessage / DOM XSS）と節5（CORS / CSP）** は、A〜Eで見つけたJSの中に潜む「クライアントサイド固有の脆弱性クラス（脆弱性の種類）」そのものである。A〜Eが「どこにJSがあるか」を地図にする作業なら、節4・5は「その地図のどこにどんな穴が空きやすいか」を分類する縦割りの知識だと考えればよい。
- **節6（パイプライン設計）** は、A〜Eの各工程を stdin→stdout でつなぐ「横断の接着剤」である。A〜Eを1本のコマンド列に組み上げるための道具立てにあたる。

つまり A〜E＝工程の縦軸、節4・5＝脆弱性クラスの分類、節6＝工程をつなぐ横串、という3層で本節を読むと迷わない。

### 3-2. (A) JSファイルの収集

「どのJSが存在するか」を列挙する段階。現在のページに載っているJSだけでなく、**過去に存在した（今は消えた）JSやエンドポイント**まで拾うのがバグバウンティの勘所である。攻撃者は消し忘れの古いエンドポイントを好んで狙う。

| ツール | URL | 原文の説明 |
|--------|-----|-----------|
| `getJS` | https://github.com/003random/getJS | A tool to fastly get all javascript sources/files |
| `waybackurls` | https://github.com/tomnomnom/waybackurls | Fetch all the URLs that the Wayback Machine knows about for a domain |
| `gau` | https://github.com/lc/gau | Fetch known URLs from AlienVault's Open Threat Exchange, the Wayback Machine, and Common Crawl. |
| `waymore` | https://github.com/xnl-h4ck3r/waymore | Find way more from the Wayback Machine! |
| `URLFinder` | https://github.com/projectdiscovery/urlfinder | A high-speed tool for passively gathering URLs, optimized for efficient web asset discovery without active scanning. |
| `github-endpoints` | https://github.com/gwen001/github-endpoints | This Go tool performs searches on GitHub and parses the results to find endpoints of a given domain. |

`waybackurls` / `gau` / `waymore` はいずれも「アーカイブ（Wayback Machine や Common Crawl）から過去のURLを引く」道具で、消えたJSを掘り起こせる。`getJS` は今このページにあるJSを高速列挙する。

〔補足（一般知識）〕`subjs`（同種の役割を持つとされる別ツール）は本READMEには収録されていない。存在しないものを「このリストに載っている」と書いてはならない。同じ役割は `getJS` が担う。

### 3-3. (B) JS本文からのエンドポイント/パス/パラメータ抽出

集めたJSファイルの中身をパース（構文解析）して、APIのパスや隠しエンドポイント、パラメータ名を掘り出す段階。ここがクライアントサイド recon の花形である。

| ツール | URL | 原文の説明 |
|--------|-----|-----------|
| `LinkFinder` | https://github.com/GerbenJavado/LinkFinder | A python script that finds endpoints in JavaScript files |
| `GoLinkFinder` | https://github.com/0xsha/GoLinkFinder | A fast and minimal JS endpoint extractor |
| `BurpJSLinkFinder` | https://github.com/InitRoot/BurpJSLinkFinder | Burp Extension for a passive scanning JS files for endpoint links. |
| `xnLinkFinder` | https://github.com/xnl-h4ck3r/xnLinkFinder | A python tool used to discover endpoints, potential parameters, and a target specific wordlist for a given target |
| `jsluice` | https://github.com/BishopFox/jsluice | This tool extracts URLs, paths, secrets, and other interesting bits from JavaScript files. Values are extracted based not just on how they look, but also based on how they are used. |
| `linx` | https://github.com/riza/linx | Reveals invisible links within JavaScript files |
| `urlgrab` | https://github.com/IAmStoxe/urlgrab | A golang utility to spider through a website searching for additional links. |
| `LinksDumper` | https://github.com/arbazkiraak/LinksDumper | Extract (links/possible endpoints) from responses & filter them via decoding/sorting |
| `JS-Scan` | https://github.com/zseano/JS-Scan | a .js scanner, built in php. designed to scrape urls and other info |
| `jsfinder` | https://github.com/kacakb/jsfinder | A tool that scans web pages to find JavaScript file URLs linked in the HTML source code. |
| `jsleak` | https://github.com/byt3hx/jsleak | jsleak is a tool to find secret , paths or links in JavaScript files or source code. |

#### 「見た目」ベース vs 「使われ方」ベース — jsluice が主役になる理由

`LinkFinder` は**定番**で、正規表現でJS中のパス文字列を掘り出す。しかし正規表現は「`/api/` で始まる文字列」のような**見た目のパターン**しか判定できないため、動的に組み立てられるURLや、変数に入っただけのパスを取りこぼす。

対して `jsluice` は原文が言う通り、"Values are extracted based **not just on how they look, but also based on how they are used**"（見た目だけでなく、それがどう使われているかに基づいて抽出する）。これは抽象構文木（AST, Abstract Syntax Tree、コードを木構造に分解した表現）を使い、「この文字列は `fetch()` に渡されている＝エンドポイントだ」といった**使われ方**から判断する。だから正規表現ベースが取りこぼす箇所を拾える。ch04で「なぜ正規表現ベースだと取りこぼすか」を語るときの主役がこのツールである。

`xnLinkFinder` も強力で、エンドポイントだけでなく**潜在パラメータとターゲット固有のワードリスト**まで生成する。パラメータ名が分かれば、後段のファジング（fuzzing、大量の入力を投げて反応を見る手法）の精度が上がる。

### 3-4. (C) JS内シークレット/APIキー検出と検証

JSにハードコードされたAPIキーやトークンを見つける段階。ここで重要なのは、**「見つける」と「本物か確かめる」は別工程**だという点である。

| ツール | URL | 原文の説明 |
|--------|-----|-----------|
| `SecretFinder` | https://github.com/m4ll0k/SecretFinder | A python script for finding sensitive data (apikeys, accesstoken,jwt,..) and search anything on javascript files. |
| `keyFinder` | https://github.com/momenbasel/keyFinder | A Chrome extension that passively scans web pages for API keys, tokens, and secrets using 80+ regex patterns and Shannon entropy analysis across 10 attack surfaces. |
| `keyhacks` | https://github.com/streaak/keyhacks | KeyHacks shows methods to validate different API keys found on a Bug Bounty Program or a pentest. |
| `js-snitch` | https://github.com/vavkamil/js-snitch | Scans remote JavaScript files with Trufflehog + Semgrep to detect leaked secrets. |
| `cariddi` | https://github.com/edoardottt/cariddi | Take a list of domains, crawl urls and scan for endpoints, secrets, api keys, file extensions, tokens and more... |
| `truffleHog` | https://github.com/dxa4481/truffleHog | Searches through git repositories for high entropy strings and secrets, digging deep into commit history |

- `SecretFinder` は**JSファイル専用のシークレット検出の定番**。
- `keyFinder` は80以上の正規表現に加え、シャノンエントロピー（Shannon entropy、文字列のランダムさを測る指標。ランダムに見える文字列ほどキーらしい）を組み合わせてブラウザ拡張として受動スキャンする。
- `keyhacks` は抽出ツールではなく、**見つけたキーが本物か・何ができるかを検証する手順集**。「拾って終わり」にせず、そのキーで実際にAPIを叩けるかまで確かめる後工程を担う。バグバウンティでは「動く証拠」がないと報告が通りにくいので、この検証工程が報奨につながる。
- `js-snitch` はリスト作者 vavkamil 自身のツールで、Trufflehog + Semgrep をリモートJSに適用する。
- `cariddi` はクロール＋secrets＋endpoints を1本でこなし、ReconとSecretsの橋渡しをする。

#### truffleHog エントリの注意（原文の状態を正しく理解する）

このリストの `truffleHog` エントリは **`dxa4481/truffleHog`（旧版）** で、説明も「Gitコミット履歴向け」である。現行の `trufflehog`（trufflesecurity版の本体）という名称は本リストの見出しには無く、代わりに `Trufflehog-Chrome-Extension`（https://github.com/trufflesecurity/Trufflehog-Chrome-Extension）が別項目として載る。

〔補足（一般知識）〕`mantra` / `trufflehog`（trufflesecurity版本体）/ `JSScanner` は本READMEには収録されていない（原文検索で0件）。別の有名リストには載るが、本URLの範囲外なので「このリストに載っている」と書いてはならない。

### 3-5. (D) クロール基盤（汎用スパイダー）

(A)(B)の入口になる汎用クローラの段階。Content Discovery サブカテゴリに属する。

| ツール | URL | 原文の説明 |
|--------|-----|-----------|
| `katana` | https://github.com/projectdiscovery/katana | A next-generation crawling and spidering framework |
| `hakrawler` | https://github.com/hakluke/hakrawler | Simple, fast web crawler designed for easy, quick discovery of endpoints and assets within a web application |
| `gospider` | https://github.com/jaeles-project/gospider | Gospider - Fast web spider written in Go |
| `crawley` | https://github.com/s0rg/crawley | fast, feature-rich unix-way web scraper/crawler written in Golang. |

`katana` は**JSクロール・ヘッドレス対応の次世代クローラ**。ヘッドレス（headless、画面表示なしでブラウザエンジンだけ動かすこと）でJSを実際に実行するため、SPA（Single Page Application、JSでページを描画するアプリ）のように「HTMLを見ただけではエンドポイントが分からない」対象でも、JSを走らせてエンドポイントを引き出せる。ch04では「SPAのJSを実行してエンドポイントを抽出する」文脈の中心になる。

### 3-6. (E) 既知脆弱性を持つJSライブラリの検出

フロントエンドが使っている jQuery や古いライブラリに既知のCVE（Common Vulnerabilities and Exposures、採番された既知脆弱性）が無いかを照合する段階。Technologies サブカテゴリに属する。

| ツール | URL | 原文の説明 |
|--------|-----|-----------|
| `retire.js` | https://github.com/RetireJS/retire.js | scanner detecting the use of JavaScript libraries with known vulnerabilities |

READMEの逐語説明は "scanner detecting the use of JavaScript libraries with known vulnerabilities"（既知の脆弱性を持つJavaScriptライブラリの使用を検出するスキャナ）のみである。つまり原文が保証しているのは「既知脆弱ライブラリの検出」までである。ch04の「サードパーティJSの脆弱性」節で必須の道具である。

〔補足（一般知識）〕`retire.js` は一般に、脆弱ライブラリのDBを持ち、CLI・ブラウザ拡張・CI（継続的インテグレーション、コード変更のたびに自動検査する仕組み）の複数形態で提供されることが知られている。ただしこれはREADMEの1行説明には書かれておらず一般知識由来なので、断定せず補足として区別しておく（実際の対応形態は各自でリポジトリを確認すること）。

## 4. postMessage / DOM XSS 系（クライアントサイド固有）

ここはサーバ側には無い、ブラウザ内部だけで完結する脆弱性を突く道具である。

### 4-1. source と sink という考え方

DOM XSS（Document Object Model based XSS）とは、サーバを経由せず、ブラウザ内のJavaScriptが「攻撃者が操作できる入力（source、源泉）」を「危険な出力先（sink、沈点）」にそのまま流し込むことで起きるクロスサイトスクリプティングのこと。たとえば `location.hash`（source）の中身を `innerHTML`（sink）に代入すると、URLに仕込んだスクリプトが実行されてしまう。

`tracy`（https://github.com/nccgroup/tracy）は原文が言う通り "A tool designed to assist with finding all **sinks and sources** of a web application and display these results in a digestible manner."。source と sink を洗い出す思想は、DOM XSS理論そのものを実務に落とした道具である。

### 4-2. postMessage の追跡とファジング

`postMessage-tracker`（https://github.com/fransr/postMessage-tracker）は、postMessage の呼び出し箇所（URL・ドメイン・スタックトレース）を追跡するブラウザ拡張。受信ハンドラがどこにあり、どんな検証をしているかを可視化する起点になる。`PostMessage_Fuzz_Tool` は postMessage のファジング用（原文の説明はハッシュタグのみ）。

攻撃者が突くのは、受信側が `event.origin`（送信元オリジン）を検証せずにメッセージ本文をそのまま `eval` や `innerHTML` に渡している箇所である。守る側は、受信ハンドラで必ず送信元オリジンをホワイトリスト照合し、本文を安全に扱う。

### 4-3. DOM XSS / Blind XSS のツール群

DOM系XSSスキャナ（XSS Injectionサブカテゴリ内、クライアントサイド直結）:

| ツール | URL | 原文の説明 |
|--------|-----|-----------|
| `findom-xss` | https://github.com/dwisiswant0/findom-xss | A fast DOM based XSS vulnerability scanner with simplicity. |
| `domdig` | https://github.com/fcavallarin/domdig | DOM XSS scanner for Single Page Applications |
| `domxssscanner` | https://github.com/yaph/domxssscanner | DOMXSS Scanner is an online tool to scan source code for DOM based XSS vulnerabilities |
| `dom-based-xss-finder` | https://github.com/AsaiKen/dom-based-xss-finder | Chrome extension that finds DOM based XSS vulnerabilities |
| `dom-red` | https://github.com/Naategh/dom-red | Small script to check a list of domains against open redirect vulnerability |

Blind XSS（out-of-band で検知するXSS、注入したスクリプトが管理画面など別の場所で後から実行される型）系は、コールバックサーバが要る。本リストには `xsshunter` / `ezXSS` / `bXSS` / `xss-flare` / `BitBlinder` / `femida` / `xsshunter_client` / `B-XSSRF` / `vaya-ciego-nen` が並ぶ。これは「Blind XSSの検知には自前のコールバック受信サーバが要る」という理論を裏づける実物リストである。

## 5. CORS / CSP バイパス（クライアントサイド境界）

### 5-1. CORS Misconfiguration（5件）

CORS（Cross-Origin Resource Sharing、オリジンをまたいだリソース共有）とは、同一オリジンポリシーを一部緩めて別オリジンからのアクセスを許すための仕組みのこと。設定を誤ると、攻撃者サイトから被害者の認証済みデータを読めてしまう。

本リストの CORS Misconfiguration スキャナは `Corsy`, `Corser`, `CORStest`, `cors-scanner`, `CorsMe` の5件で、いずれも設定ミスを検出する系である。攻撃者は `Access-Control-Allow-Origin` が任意オリジンを反射する、あるいは `null` を許可するといった穴を突く。守る側は許可オリジンを厳密にホワイトリスト化する。

### 5-2. CSPバイパス

CSP（Content Security Policy、コンテンツセキュリティポリシー）とは、どこからのスクリプトを実行してよいかをブラウザに指示するHTTPヘッダのこと。XSSの**緩和策**であって根絶策ではない、という点が重要である。

- `JSONBee`（https://github.com/zigoo0/JSONBee） — "A ready to use JSONP endpoints/payloads to help bypass content security policy (CSP) of different websites."
- `CSPBypass`（https://github.com/renniepak/CSPBypass） — ホワイトリスト型CSPを突破してXSSにつなげる。

CSPで許可されたドメインにJSONP（別オリジンからスクリプトとしてデータを読む古い手法）エンドポイントがあると、そこを踏み台にCSPを回避できる。「CSPを入れたから安全」ではなく、許可リストの中に危険な踏み台が無いかまで見る必要がある。

## 6. パイプライン設計 — stdin/stdout でつなぐ小道具（Useful）

このカタログの背骨は、ProjectDiscovery系と tomnomnom系という2つの「stdin→stdout でつながる小道具群」である。ch04で「収集→整形→検査」を1行のパイプで組む思想を教えるなら、Useful サブカテゴリが核心になる。

「〜系」というのは、同じ作者（または開発チーム）が同じ設計思想で作った道具の一群、という意味である。この Useful サブカテゴリの中で言うと、**tomnomnom系**が `anew` / `gf` / `unfurl` / `qsreplace`（作者 tomnomnom）、それに近い思想の `uro`（作者 s0md3v）で、いずれも「テキストのURLリストを stdin で受け、加工して stdout に流す」極小の道具である。一方の **ProjectDiscovery系**は、この表の中では `interactsh` と `notify`（どちらも ProjectDiscovery 製）が該当し、収集の受け皿や通知といった「工程の外枠」を担う。2系統の対応を整理すると次のとおりである。

| 系統 | この表での該当ツール | 役割の性格 |
|------|--------------------|-----------|
| tomnomnom系（＋近縁の uro） | `anew`, `gf`, `unfurl`, `qsreplace`, `uro` | URLテキストを stdin→stdout で加工する極小道具 |
| ProjectDiscovery系 | `interactsh`, `notify` | コールバック受信・通知など工程の外枠 |
| どちらでもない汎用 | `CyberChef` | エンコード/デコードのGUI万能ナイフ |

| ツール | URL | 原文の説明 |
|--------|-----|-----------|
| `anew` | https://github.com/tomnomnom/anew | A tool for adding new lines to files, skipping duplicates |
| `gf` | https://github.com/tomnomnom/gf | A wrapper around grep, to help you grep for things |
| `uro` | https://github.com/s0md3v/uro | declutters url lists for crawling/pentesting |
| `unfurl` | https://github.com/tomnomnom/unfurl | Pull out bits of URLs provided on stdin |
| `qsreplace` | https://github.com/tomnomnom/qsreplace | Accept URLs on stdin, replace all query string values with a user-supplied value |
| `interactsh` | https://github.com/projectdiscovery/interactsh | Interactsh is an open-source tool for detecting out-of-band interactions. It is a tool designed to detect vulnerabilities that cause external interactions. |
| `CyberChef` | https://github.com/gchq/CyberChef | The Cyber Swiss Army Knife - a web app for encryption, encoding, compression and data analysis |
| `notify` | https://github.com/projectdiscovery/notify | Notify is a Go-based assistance package that enables you to stream the output of several tools (or read from a file) and publish it to a variety of supported platforms. |

### 6-1. 各小道具の役割

- `anew` — 差分だけ追記（重複をスキップ）。**新規発見の抽出**に使う。
- `gf` — grep のラッパー。パターン集を与えて、XSS/SSRF/redirect の候補パラメータを一括抽出する。
- `uro` — URLリストの重複・ノイズ除去。
- `unfurl` — URLからドメイン/パス/パラメータ名などを切り出す。
- `qsreplace` — 全クエリ値をユーザ指定のペイロードに一括置換。**反射確認の量産**に使う。
- `interactsh` — OOB（out-of-band、帯域外）相互作用の検知。Blind XSS/SSRF/XXE のコールバック受け。
- `notify` — ツール出力を Slack 等へ流す通知パイプ。
- `CyberChef` — エンコード/デコード/解析の GUI 万能ナイフ。

### 6-2. 典型的な連鎖の考え方

〔補足（一般知識）〕本READMEのツールだけで組む典型的な連鎖（防御・許可済み診断が前提）を、パイプの流れとして示す。

```
収集              整形            注入              到達確認
waybackurls ─▶  uro / gf ─▶  qsreplace ─▶  httpx で確認
（URL履歴）     （重複除去・   （クエリ値を    （反射・応答を
                候補抽出）     ペイロード化）   まとめて見る）
```

このように「収集→整形→ペイロード注入→到達確認」を1本のパイプでつなぐのが、本リストの道具立てが意図するワークフローである。小道具が stdin/stdout で統一されているからこそ、こう組める。

> ### 📌 ここは自分で開いて読んでください
> **資料**: awesome-bugbounty-tools 内の重点ツール個別リポジトリ（jsluice / katana / LinkFinder / xnLinkFinder / SecretFinder / keyFinder / keyhacks / postMessage-tracker / tracy / retire.js） — それぞれのGitHub URL（本節の各表を参照）
> **なぜ**: 本教科書の執筆環境からはカタログのREADMEは全文取得できたが、各ツールの**実際のオプション・出力・正規表現パターン**は個別リポジトリを開かないと分からない。以下の記述は1行説明と一般知識に基づく要約である。
> **読みどころ**:
> 1. `jsluice`（BishopFox） — 「使われ方に基づく抽出（AST）」の具体例と、`jsluice urls` / `jsluice secrets` サブコマンドの実挙動。正規表現ベースとの精度差を自分の目で確認する。
> 2. `katana`（ProjectDiscovery） — ヘッドレス/JSクロール（`-jc`, `-headless`）のオプションと、SPAでのエンドポイント抽出の実例。
> 3. `LinkFinder` / `xnLinkFinder` — 使用する正規表現パターン（何を「エンドポイントらしい」と判定するか）。取りこぼしの理由を理解するのに必須。
> 4. `SecretFinder` / `keyFinder` / `keyhacks` — どの正規表現でどのサービスのキーを拾うか、そして keyhacks で「拾ったキーの検証コマンド」を確認する。
> 5. `postMessage-tracker` / `tracy` — source/sink 追跡のUIと出力形式。DOM XSS理論を実務に落とす具体像。
> 6. `retire.js` — 脆弱ライブラリDBの形式と、CI/ブラウザ拡張/CLIの3形態。
> **代替手段**: 各リポジトリのREADMEはいずれも無料公開。ライセンスも大半がOSSなので、ローカルにクローンして `--help` を読むのが最短。

## 7. Vulnerability Scanners（21件） — 収集の最終段に当てるスキャナ群

Vulnerability Scanners（脆弱性スキャナ）サブカテゴリは、A〜Eで集めたエンドポイント群に対して「既知の穴が無いか」を機械的に当てていく最終段の道具である。本カタログでは Subdomain Enumeration・XSS Injection と並んで収録数が多く（21件）、コミュニティの工具が厚く積まれている領域である。名前だけの一行に丸めず、原文の逐語説明を全件示す。

| ツール | URL | 原文の説明（逐語・英語のまま） |
|--------|-----|--------------------------------|
| `nuclei` | https://github.com/projectdiscovery/nuclei | Nuclei is a fast tool for configurable targeted scanning based on templates offering massive extensibility and ease of use. |
| `nuclei-templates` | https://github.com/projectdiscovery/nuclei-templates | Community curated list of templates for the nuclei engine to find security vulnerabilities. |
| `Sn1per` | https://github.com/1N3/Sn1per | Automated pentest framework for offensive security experts |
| `metasploit-framework` | https://github.com/rapid7/metasploit-framework | Metasploit Framework |
| `nikto` | https://github.com/sullo/nikto | Nikto web server scanner |
| `arachni` | https://github.com/Arachni/arachni | Web Application Security Scanner Framework |
| `jaeles` | https://github.com/jaeles-project/jaeles | The Swiss Army knife for automated Web Application Testing |
| `retire.js` | https://github.com/RetireJS/retire.js | scanner detecting the use of JavaScript libraries with known vulnerabilities |
| `Osmedeus` | https://github.com/j3ssie/Osmedeus | Fully automated offensive security framework for reconnaissance and vulnerability scanning |
| `Vigolium` | https://github.com/vigolium/vigolium | High-fidelity vulnerability scanner fusing agentic AI with native speed, modularity, and precision |
| `getsploit` | https://github.com/vulnersCom/getsploit | Command line utility for searching and downloading exploits |
| `flan` | https://github.com/cloudflare/flan | A pretty sweet vulnerability scanner |
| `Findsploit` | https://github.com/1N3/Findsploit | Find exploits in local and online databases instantly |
| `BlackWidow` | https://github.com/1N3/BlackWidow | A Python based web application scanner to gather OSINT and fuzz for OWASP vulnerabilities on a target website. |
| `backslash-powered-scanner` | https://github.com/PortSwigger/backslash-powered-scanner | Finds unknown classes of injection vulnerabilities |
| `Eagle` | https://github.com/BitTheByte/Eagle | Multithreaded Plugin based vulnerability scanner for mass detection of web-based applications vulnerabilities |
| `cariddi` | https://github.com/edoardottt/cariddi | Take a list of domains, crawl urls and scan for endpoints, secrets, api keys, file extensions, tokens and more... |
| `OWASP ZAP` | https://github.com/zaproxy/zaproxy | World’s most popular free web security tools and is actively maintained by a dedicated international team of volunteers |
| `SSTImap` | https://github.com/vladko312/SSTImap | SSTImap is a penetration testing software that can check websites for Code Injection and Server-Side Template Injection vulnerabilities and exploit them, giving access to the operating system itself. |
| `Lonkero` | https://github.com/bountyyfi/lonkero | Enterprise-grade web vulnerability scanner with 60+ attack modules, built in Rust for penetration testing and security assessments. |
| `OWASP PTK` | https://github.com/DenisPodgurskii/pentestkit | Browser-based vulnerability scanner for bug bounty and pentesting workflows, combining DAST, SAST, IAST, and SCA capabilities to detect runtime, source-level, interactive, and dependency-related security issues. |

### 7-1. 表の読みどころ

- この表の中で **`retire.js` と `cariddi` はクロスリスト（複数カテゴリへの再掲）**である。`retire.js` は Technologies（節3-6）から、`cariddi` は Secrets（節1-1・節3-4）から、それぞれここにも顔を出している。同じツールが「JSライブラリのCVE照合」「シークレット/エンドポイント抽出」「脆弱性スキャナ」という複数の役割で数えられている、ということである。
- **`OWASP ZAP` と `zaproxy` は実体が同じ ZAP**（同一URL `zaproxy/zaproxy`）だが、本カタログでは Vulnerability Scanners では "OWASP ZAP"、Web Proxy では "zaproxy" という別名・別説明で二重に載っている（節8の不整合#2を参照）。
- **`Vigolium` や `OWASP PTK` のように、AIやブラウザ内実行（DAST/SAST/IAST/SCA）を掲げる新顔**も入っており、脆弱性スキャナの領域にも2026年的な傾向が現れている。
- **`nuclei`** は**テンプレートベースのスキャナ**で、YAML（設定を書くための読みやすい記法）で書かれたテンプレートに従って既知脆弱性を当てる。ch04の文脈では、収集したエンドポイント群に対し「テンプレートで既知脆弱性を一括照合する」最終段として位置づく。テンプレート集の `nuclei-templates` とセットで使う。
- ここでの `SSTImap` は Server-Side Template Injection（サーバ側テンプレートインジェクション）向けで、厳密にはサーバサイドの穴だが、クロスリストで本サブカテゴリにも再掲されている。

## 8. 原文の不整合・注意点（引用時の心得）

READMEを逐語で読むと、原文にいくつかの誤記・不整合がある。**修正はせず、原文が誤っている事実を明記する**のが正しい態度である。カタログを鵜呑みにせず一次ソースで裏を取る習慣につながる。

| # | 不整合の種類 | 内容 |
|---|-------------|------|
| 1 | 目次と本文のずれ | 目次では `Cache Poisoning`（アンカー `#Web-Cache-Poisoning`）だが本文見出しは `Web-Cache-Poisoning`。本文には目次に無い `SSTI Injection`（tplmap, SSTImap）がある。目次の `Forbidden Bypass` は本文に独立見出しが無く `Waf Evasion` に統合。 |
| 2 | 重複エントリ | 同一URLが複数カテゴリに再掲。`ground-control`（×3）、`B-XSSRF`（×3）、`Injectus`（×2）、`retire.js`（×2）、`cariddi`（×2）、`altdns`（×2）、`SSTImap`（×2）、`docem`（×2）など。総エントリ412件だがユニークURLは400件。 |
| 3 | リンク先の軽微な誤り | `smugglex` はMarkdownリンクが壊れ `https://` が欠落（原文ママ）。`crt.go` は表示名とURL（`TaurusOmar/crt.sh`）が食い違う。`param-miner` の説明の "web alterx poisoning vulnerabilities" は原文の誤記とみられる（一般には web cache poisoning）。 |
| 4 | 説明文中のタイポ | `dns-parallel-prober` の説明冒頭 "his is a parallelised…"（"This" のTが欠落）など。逐語再現では訂正せず残す。 |
| 5 | 重点リストにあるが未収録 | `subjs`, `JSScanner`, `mantra`, `trufflehog`（trufflesecurity版本体）は原文に見つからない。「このリストに載っている」と書いてはならない。 |

〔補足〕教科書で原文を引用するときは、逐語引用しつつ〔補足〕で訂正を添えるのが安全である。誤記を黙って直すと、読者が原文と照合したとき混乱する。

## 9. contributing.md が教えてくれること（「厳選」の実態）

このカタログは「厳選（curated）」を名乗るが、貢献ガイドライン `contributing.md` を読むと、**明文化された収録基準は無い**ことが分かる。全文（逐語）は次の通り。

```markdown
# Contribution Guidelines

Please note that this project is released with a
[Contributor Code of Conduct](code-of-conduct.md). By participating in this
project you agree to abide by its terms.

---

Ensure your pull request adheres to the following guidelines:

- Make sure you take care of this
- And this as well
- And don't forget to check this

Thank you for your suggestions!


## Updating your PR

A lot of times, making a PR adhere to the standards above can be difficult.
If the maintainers notice anything that we'd like changed, we'll ask you to
edit your PR before we merge it. There's no need to open a new PR, just edit
the existing one. If you're not sure how to do that,
[here is a guide](https://github.com/RichardLitt/knowledge/blob/master/github/amending-a-commit-guide.md)
on the different ways you can update your PR so that we can merge it.
```

### 9-1. Updating your PR の読み方

"Ensure your pull request adheres to the following guidelines: Make sure you take care of this / And this as well / And don't forget to check this" は、awesome-list テンプレートの**プレースホルダ（穴埋め用の仮文）そのまま**である。つまり「this」の中身が定義されていない。

`## Updating your PR` の節は、収録依頼のプルリクエスト（PR、変更提案）が基準に合わないときにメンテナが修正を求める、という運用手順を述べているだけで、**何を収録するかの技術的な定義はない**。

### 9-2. これが読者に意味すること

収録基準が明文化されていない、ということは **「このリストに載っている＝良いツール」とは限らない**ということである。カタログは「一次索引」として使い、最終判断は自分で各リポジトリを開いて star 数・最終更新・実挙動を確かめる。バグバウンティで信頼できるのは、カタログの権威ではなく、自分の手で確認した事実だけである。

## 手を動かす

前提: 以下は**許可された診断・バグバウンティ・自分で立てた検証環境**でのみ行う。無許可の対象に対して実行してはならない。

1. カタログ本体を索引として開く。ブラウザで `https://github.com/vavkamil/awesome-bugbounty-tools` を開き、`## Contents` の目次から `Links` `Secrets` `Useful` の3サブカテゴリにジャンプする。この3つがクライアントサイド調査の一次索引になる。

2. カタログのREADMEをローカルに取得して、自分でも全文検索できるようにする。
   ```bash
   curl -s https://raw.githubusercontent.com/vavkamil/awesome-bugbounty-tools/HEAD/README.md -o awesome.md
   grep -n -i "javascript\|secret\|postMessage" awesome.md
   ```

3. JS抽出の定番を2つクローンして `--help` を読み比べる。正規表現ベースと AST ベースの違いを体感する。
   ```bash
   git clone https://github.com/GerbenJavado/LinkFinder
   git clone https://github.com/BishopFox/jsluice
   ```
   `jsluice` のREADMEで `jsluice urls` と `jsluice secrets` のサブコマンドがどう抽出するかを確認する。

4. tomnomnom系パイプラインを1行で組む練習をする（対象は自分の検証サイトに置き換えること）。
   ```bash
   # 収集 → 重複除去 → 候補抽出 → クエリ値をペイロードに置換
   cat urls.txt | uro | gf xss | qsreplace 'FUZZ'
   ```
   まだ攻撃はせず、`qsreplace` の出力（クエリ値が置き換わったURL群）を目で確認する段階で止める。

5. `keyhacks`（https://github.com/streaak/keyhacks）を開き、仮に見つけたキーの「検証コマンド」の書式を1つ読む。「拾う」と「本物か確かめる」が別工程だと実感する。

## つまずきポイント

- **カタログを「読む本」だと思ってしまう**。実体はREADME1枚の索引であり、情報の本体は各リポジトリにある。開かなければ何も分からない。
- **リストに載っている＝安全・高品質、と誤解する**。`contributing.md` は収録基準を定義していない。star 数や最終更新を自分で確かめる。
- **正規表現ベースの抽出を万能だと思う**。`LinkFinder` は見た目のパターンしか見ないので、動的に組まれるURLを取りこぼす。`jsluice` の「使われ方ベース」と補い合う。
- **シークレットを「見つけたら終わり」にする**。`keyhacks` で本物か検証しないと、報告しても「動く証拠がない」と扱われやすい。
- **原文の誤記を鵜呑みにする**。`param-miner` の説明の "web alterx poisoning" は誤記とみられる（一般には web cache poisoning）。逐語引用は保ちつつ、裏取りは自分で行う。
- **重点リストに名前があるツールが必ずこのカタログに載っていると思い込む**。`subjs` `mantra` `trufflehog`本体などは本READMEには無い。別リストと混同しない。

## この節のまとめ

- `awesome-bugbounty-tools` は awesome-list 形式のカタログで、実体はREADME.md 1枚の「索引」である。
- クライアントサイド調査は「(A)JSの収集 →(B)エンドポイント抽出 →(C)シークレット検出と検証 →(D)クロール基盤 →(E)既知脆弱ライブラリ検出」の5段階に分解できる。
- (A)では `getJS` に加え、`waybackurls`/`gau`/`waymore` で過去の消えたJSまで拾うのが勘所。
- (B)の主役は `jsluice`。「見た目」ではなく「使われ方（AST）」で抽出するので、正規表現ベースの `LinkFinder` が取りこぼす箇所を拾える。
- (C)では `SecretFinder`/`keyFinder` で見つけ、`keyhacks` で本物か検証する。「見つける」と「確かめる」は別工程。
- `katana` はヘッドレスでJSを実行するので、SPAのエンドポイント抽出に強い。
- DOM XSS は source→sink の流れで起き、`tracy` が source/sink を洗い出す。Blind XSS にはコールバックサーバ（interactsh 等）が要る。
- postMessage は受信側の `event.origin` 検証漏れが穴。`postMessage-tracker` で呼び出し箇所を可視化する。
- CORS の設定ミスは `Corsy` 等で検出。CSP は XSS の緩和であって根絶ではなく、JSONP 踏み台で `CSPBypass`/`JSONBee` により回避されうる。
- Useful サブカテゴリ（anew/gf/uro/unfurl/qsreplace/interactsh/notify/CyberChef）は stdin→stdout でつなぐパイプライン道具。「収集→整形→注入→到達確認」を1行で組める。
- `retire.js` は脆弱JSライブラリのCVE照合、`nuclei` はテンプレートベースの最終段スキャナ。
- 原文には目次と本文のずれ・重複エントリ・リンク切れ・タイポがある。修正せず、誤りとして明記して引用する。
- `contributing.md` は収録基準を定義していない。カタログの権威ではなく、自分で確かめた事実を信頼する。
- すべての攻撃手法は許可された対象に限る。防御（オリジン検証・CORSホワイトリスト・CSP設計・依存更新）とセットで理解する。

## 理解度チェック

1. `awesome-bugbounty-tools` の「実体」は何か。なぜ「読む本」ではなく「索引」なのか。
   ▶ 答え: 実体は README.md 1枚。各ツールの実際のオプション・出力・正規表現は個別リポジトリを開かないと分からないため、カタログは一次索引としてしか機能しない。

2. JavaScript攻撃面把握の5段階（A〜E）を順に挙げよ。
   ▶ 答え: (A)JSの収集 →(B)エンドポイント/パラメータ抽出 →(C)シークレット検出と検証 →(D)クロール基盤 →(E)既知脆弱ライブラリ検出。

3. `jsluice` が `LinkFinder` のような正規表現ベースより取りこぼしが少ないのはなぜか。
   ▶ 答え: 原文が言う通り「見た目だけでなく、それがどう使われているか（used）」に基づいて抽出するから。ASTを使い「fetchに渡されている＝エンドポイント」といった使われ方から判断できる。

4. シークレット検出で `SecretFinder` と `keyhacks` の役割はどう違うか。
   ▶ 答え: `SecretFinder` は JSファイルからキー/トークンを「見つける」抽出ツール。`keyhacks` は見つけたキーが本物か・何ができるかを「検証する」手順集。工程が別。

5. `katana` がSPAのエンドポイント抽出に強い理由は何か。
   ▶ 答え: ヘッドレスでJSを実際に実行するため。HTMLを見ただけでは分からない、JSで動的に構築されるエンドポイントも引き出せる。

6. DOM XSS の source と sink とは何か。1つずつ例を挙げよ。
   ▶ 答え: source は攻撃者が操作できる入力（例: `location.hash`）、sink は危険な出力先（例: `innerHTML`）。source の値が検証なく sink に流れると DOM XSS になる。`tracy` がこれを洗い出す。

7. CSP を入れれば XSS は根絶できるか。本節の資料に照らして答えよ。
   ▶ 答え: できない。CSP は緩和策であって根絶策ではない。許可ドメインに JSONP 踏み台があると `CSPBypass`/`JSONBee` で回避されうる。許可リストの中の危険な踏み台まで見る必要がある。

8. `contributing.md` から読み取れる、このカタログの収録基準についての事実は何か。
   ▶ 答え: 明文化された収録基準は無い（テンプレートのプレースホルダのまま）。だから「載っている＝良い」とは限らず、star数・最終更新・実挙動を自分で確かめる必要がある。

9. Useful サブカテゴリの小道具が「1行のパイプ」で組めるのはなぜか。
   ▶ 答え: すべて stdin から入力を受け、stdout へ出力する統一設計だから。収集→整形（uro/gf）→注入（qsreplace）→到達確認をパイプでつなげる。

10. 重点リストに名前があっても本READMEに載っていないツールの例を挙げ、扱い方を述べよ。
    ▶ 答え: `subjs`, `JSScanner`, `mantra`, `trufflehog`（trufflesecurity版本体）。原文検索で0件なので「このリストに載っている」と書いてはならない。別の有名リストとの混同を避ける。

## 出典

- https://github.com/vavkamil/awesome-bugbounty-tools
- https://raw.githubusercontent.com/vavkamil/awesome-bugbounty-tools/HEAD/README.md
- https://raw.githubusercontent.com/vavkamil/awesome-bugbounty-tools/HEAD/contributing.md
- https://github.com/BishopFox/jsluice
- https://github.com/GerbenJavado/LinkFinder
- https://github.com/xnl-h4ck3r/xnLinkFinder
- https://github.com/projectdiscovery/katana
- https://github.com/m4ll0k/SecretFinder
- https://github.com/momenbasel/keyFinder
- https://github.com/streaak/keyhacks
- https://github.com/fransr/postMessage-tracker
- https://github.com/nccgroup/tracy
- https://github.com/RetireJS/retire.js
- https://github.com/projectdiscovery/nuclei

<!-- sources: https://github.com/vavkamil/awesome-bugbounty-tools, https://raw.githubusercontent.com/vavkamil/awesome-bugbounty-tools/HEAD/contributing.md, https://github.com/BishopFox/jsluice, https://github.com/GerbenJavado/LinkFinder, https://github.com/xnl-h4ck3r/xnLinkFinder, https://github.com/projectdiscovery/katana, https://github.com/m4ll0k/SecretFinder, https://github.com/momenbasel/keyFinder, https://github.com/streaak/keyhacks, https://github.com/fransr/postMessage-tracker, https://github.com/nccgroup/tracy, https://github.com/RetireJS/retire.js, https://github.com/projectdiscovery/nuclei -->
<!-- terms: awesome-list, 同一オリジンポリシー, postMessage, DOM XSS, source（源泉）, sink（沈点）, AST（抽象構文木）, ヘッドレス, SPA, シャノンエントロピー, CVE, CORS, CSP, JSONP, Blind XSS, JWT, out-of-band, ペイロード, ファジング, スコープ -->
<!-- self-read: https://github.com/BishopFox/jsluice | 各ツールの実オプション・出力・正規表現は個別リポジトリを開かないと分からず、執筆環境からは1行説明しか取得できていないため -->
