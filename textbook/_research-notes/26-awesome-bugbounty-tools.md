# [26] Awesome Bug Bounty Tools（vavkamil/awesome-bugbounty-tools）— バグバウンティ用ツール網羅カタログ

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|-----|------|----------|------|
| https://github.com/vavkamil/awesome-bugbounty-tools | full | `curl` → `https://raw.githubusercontent.com/vavkamil/awesome-bugbounty-tools/HEAD/README.md`（HTTP 200 / 61,441 bytes / 633行）。HEAD・main・master の3ブランチで取得し、いずれも同一サイズであることを確認 | このリポジトリの実体はREADME.md 1枚。**全文（412件のツールエントリ）を欠落なく取得**し、以下に全件を原文の説明つきで再現した |
| https://github.com/vavkamil/awesome-bugbounty-tools （HTMLページ本体） | failed | WebFetch → HTTP 503、`curl` → HTTP 403（サイズ378バイト） | GitHubのHTMLページはボット判定で取得不可。ただしREADME全文はraw経由でfullに取得済みなので情報欠落はない。星数などのメタデータは下記のGitHub API（MCP経由）で補完済み |
| https://api.github.com/repos/vavkamil/awesome-bugbounty-tools （メタデータ） | full | GitHub MCP `search_repositories`（`curl`での直接API叩きはセッションのGitHubアクセス制限で拒否されたためMCPにフォールバック） | star数・fork数・topics・license・最終push日を取得 |
| https://raw.githubusercontent.com/vavkamil/awesome-bugbounty-tools/HEAD/contributing.md | full | `curl`（HTTP 200） | 貢献ガイドライン。内容は awesome-list テンプレートのほぼそのままで、技術的情報はない（下記に全文引用） |

**結論: 担当URLの実質的な中身（README全文）は full で取得できた。** ただしGitHubのWeb UI上の表示（星数バッジ、最終更新表示、ファイル一覧）だけはHTML取得が403のためAPI経由で補った。

## 要約

- `vavkamil/awesome-bugbounty-tools` は「バグバウンティで使うツールの厳選リスト（A curated list of various bug bounty tools）」を名乗る awesome-list 形式のリポジトリで、実体は README.md 1枚に **412件のツールエントリ（ユニークURL 400件）** をカテゴリ別に1行説明つきで並べたカタログである。
- 構造は3つの大分類 + 未分類の4ブロック: **Recon（122件）/ Exploitation（138件）/ Miscellaneous（136件）/ Uncategorized（16件）**。その下に44個のサブカテゴリがある。
- クライアントサイド脆弱性ハンティングに直結するサブカテゴリは **Links（17件: JavaScriptからのエンドポイント抽出）**、**Content Discovery（15件: クローラ・ディレクトリ探索）**、**Secrets（29件: JSやGitからのシークレット検出）**、**Parameters（6件）**、**XSS Injection（40件: 本リスト最大のサブカテゴリの一つ）**、**postMessage（2件）**、**CORS Misconfiguration（5件）**、**Technologies（12件: retire.js など）**、**Useful（8件: anew/gf/uro/unfurl/qsreplace などパイプライン接着剤）**。
- 収録数の多い順は Subdomain Enumeration（42）> XSS Injection（40）> Secrets（29）> SSRF（21）= Vulnerability Scanners（21）> Buckets（18）> Links（17）> SQL Injection（16）> Content Discovery（15）。**「サブドメイン列挙」と「XSS」にコミュニティの工具が最も厚く積み上がっている**という事実自体が、バグバウンティの労力配分を示す一次データとして使える。
- 設計思想として明確なのは、ProjectDiscovery系（subfinder / dnsx / httpx / naabu / katana / nuclei / uncover / proxify / interactsh / notify / alterx / cdncheck / tlsx / asnmap / mapcidr / cvemap / URLFinder / chaos-client / shuffledns）と tomnomnom系（assetfinder / waybackurls / anew / gf / unfurl / qsreplace）という2つの「stdin→stdout でつながる小道具群」が、リストの背骨になっていること。これが第4章で教えるべき「パイプライン型recon」の実体である。
- 2026年時点の新傾向として **AI Agents（4件）** サブカテゴリが追加されており（shannon, Darkmoon, PentestGPT, Agentic Bug Bounty Hunter）、自律型ペンテストエージェントがカタログに入り始めている。
- ライセンスは **CC0-1.0（パブリックドメイン相当）** なので、教科書への引用・再構成は法的に自由。

## リポジトリ・メタデータ（出典: GitHub API）

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
| has_issues / has_wiki / has_discussions | `true` / `true` / `false` |

READMEの冒頭は次の通り（逐語）:

```markdown
# Awesome Bug Bounty Tools [![Awesome](https://awesome.re/badge.svg)](https://awesome.re)

> A curated list of various bug bounty tools
```

ライセンス表記（逐語）:

```
To the extent possible under law, vavkamil has waived all copyright and
related or neighboring rights to this work.
```

## 全体構造（カテゴリ体系と収録数）

READMEの `## Contents` 節に書かれた目次は以下の通り（逐語・アンカー付き）。

```markdown
## Contents

- [Recon](#Recon)
    - [Subdomain Enumeration](#Subdomain-Enumeration)
    - [Port Scanning](#Port-Scanning)
    - [Screenshots](#Screenshots)
    - [Technologies](#Technologies)
    - [Content Discovery](#Content-Discovery)
    - [Content Filtering](#Content-Filtering)
    - [Links](#Links)
    - [Parameters](#Parameters)
    - [Fuzzing](#Fuzzing)
    - [Monitoring](#Monitoring)
    - [Waf Evasion](#Waf-Evasion)

- [Exploitation](#Exploitation)
    - [Command Injection](#Command-Injection)
    - [CORS Misconfiguration](#CORS-Misconfiguration)
    - [CRLF Injection](#CRLF-Injection)
    - [CSRF Injection](#CSRF-Injection)
    - [Directory Traversal](#Directory-Traversal)
    - [File Inclusion](#File-Inclusion)
    - [GraphQL Injection](#GraphQL-Injection)
    - [Header Injection](#Header-Injection)
    - [Insecure Deserialization](#Insecure-Deserialization)
    - [Insecure Direct Object References](#Insecure-Direct-Object-References)
    - [Open Redirect](#Open-Redirect)
    - [Race Condition](#Race-Condition)
    - [Request Smuggling](#Request-Smuggling)
    - [Server Side Request Forgery](#Server-Side-Request-Forgery)
    - [SQL Injection](#SQL-Injection)
    - [XSS Injection](#XSS-Injection)
    - [XXE Injection](#XXE-Injection)
    - [Cache Poisoning](#Web-Cache-Poisoning)

- [Miscellaneous](#Miscellaneous)
    - [Passwords](#Passwords)
    - [Secrets](#Secrets)
    - [Git](#Git)
    - [Buckets](#Buckets)
    - [CMS](#CMS)
    - [JSON Web Token](#JSON-Web-Token)
    - [postMessage](#postMessage)
    - [Subdomain Takeover](#Subdomain-Takeover)
    - [Vulnerability Scanners](#Vulnerability-Scanners)
    - [Forbidden Bypass](#Forbidden-Bypass)
    - [Permutation](#Permutation)
    - [Web Proxy and Traffic Interception](#Web-Proxy-and-Traffic-Interception)
    - [Origin IP](#Origin-IP)
    - [Useful](#Useful)
    - [AI Agents](#AI-Agents)
    - [Uncategorized](#Uncategorized)
```

本文（見出し）側の実際の収録数を数えたものが以下。**目次と本文にはずれがある**（後述の「原文の不整合」節を参照）。

| 大分類 | サブカテゴリ | 収録件数 |
|--------|--------------|----------|
| Recon | Subdomain Enumeration | 42 |
| Recon | Port Scanning | 8 |
| Recon | Screenshots | 10 |
| Recon | Technologies | 12 |
| Recon | Content Discovery | 15 |
| Recon | Content Filtering | 1 |
| Recon | Links | 17 |
| Recon | Parameters | 6 |
| Recon | Fuzzing | 9 |
| Recon | Monitoring | 2 |
| **Recon 小計** | | **122** |
| Exploitation | Command Injection | 1 |
| Exploitation | CORS Misconfiguration | 5 |
| Exploitation | CRLF Injection | 4 |
| Exploitation | CSRF Injection | 1 |
| Exploitation | Directory Traversal | 4 |
| Exploitation | File Inclusion | 5 |
| Exploitation | GraphQL Injection | 5 |
| Exploitation | Header Injection | 1 |
| Exploitation | Insecure Deserialization | 4 |
| Exploitation | Insecure Direct Object References | 1 |
| Exploitation | Open Redirect | 4 |
| Exploitation | Race Condition | 5 |
| Exploitation | Request Smuggling | 5 |
| Exploitation | Server Side Request Forgery | 21 |
| Exploitation | SQL Injection | 16 |
| Exploitation | XSS Injection | 40 |
| Exploitation | XXE Injection | 9 |
| Exploitation | SSTI Injection | 2 |
| Exploitation | Web-Cache-Poisoning | 1 |
| Exploitation | Waf Evasion | 4 |
| **Exploitation 小計** | | **138** |
| Miscellaneous | Passwords | 5 |
| Miscellaneous | Secrets | 29 |
| Miscellaneous | Git | 7 |
| Miscellaneous | Buckets | 18 |
| Miscellaneous | CMS | 9 |
| Miscellaneous | JSON Web Token | 7 |
| Miscellaneous | postMessage | 2 |
| Miscellaneous | Subdomain Takeover | 13 |
| Miscellaneous | Vulnerability Scanners | 21 |
| Miscellaneous | Permutation | 6 |
| Miscellaneous | Web Proxy and Traffic Interception | 5 |
| Miscellaneous | Origin IP | 2 |
| Miscellaneous | Useful | 8 |
| Miscellaneous | AI Agents | 4 |
| **Miscellaneous 小計** | | **136** |
| （大分類直下） | Uncategorized | 16 |
| **総計** | | **412**（ユニークURL 400） |

## 詳細ノート: 全ツール一覧（出典: https://github.com/vavkamil/awesome-bugbounty-tools）

以下は README 本文の全エントリを、原文の1行説明を**英語のまま逐語で**保持して再現したもの。カテゴリ順・掲載順も原文通り。
### Recon（大分類）
#### Subdomain Enumeration

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `Sublist3r` | https://github.com/aboul3la/Sublist3r | Fast subdomains enumeration tool for penetration testers |
| 2 | `Amass` | https://github.com/OWASP/Amass | In-depth Attack Surface Mapping and Asset Discovery |
| 3 | `massdns` | https://github.com/blechschmidt/massdns | A high-performance DNS stub resolver for bulk lookups and reconnaissance (subdomain enumeration) |
| 4 | `Findomain` | https://github.com/Findomain/Findomain | The fastest and cross-platform subdomain enumerator, do not waste your time. |
| 5 | `Sudomy` | https://github.com/Screetsec/Sudomy | Sudomy is a subdomain enumeration tool to collect subdomains and analyzing domains performing automated reconnaissance (recon) for bug hunting / pentesting |
| 6 | `chaos-client` | https://github.com/projectdiscovery/chaos-client | Go client to communicate with Chaos DNS API. |
| 7 | `domained` | https://github.com/TypeError/domained | Multi Tool Subdomain Enumeration |
| 8 | `bugcrowd-levelup-subdomain-enumeration` | https://github.com/appsecco/bugcrowd-levelup-subdomain-enumeration | This repository contains all the material from the talk "Esoteric sub-domain enumeration techniques" given at Bugcrowd LevelUp 2017 virtual conference |
| 9 | `shuffledns` | https://github.com/projectdiscovery/shuffledns | shuffleDNS is a wrapper around massdns written in go that allows you to enumerate valid subdomains using active bruteforce as well as resolve subdomains with wildcard handling and easy input-output… |
| 10 | `puredns` | https://github.com/d3mondev/puredns | Fast domain resolver and subdomain bruteforcing with accurate wildcard filtering with wildcard(*) |
| 11 | `censys-subdomain-finder` | https://github.com/christophetd/censys-subdomain-finder | Perform subdomain enumeration using the certificate transparency logs from Censys. |
| 12 | `Turbolist3r` | https://github.com/fleetcaptain/Turbolist3r | Subdomain enumeration tool with analysis features for discovered domains |
| 13 | `censys-enumeration` | https://github.com/0xbharath/censys-enumeration | A script to extract subdomains/emails for a given domain using SSL/TLS certificate dataset on Censys |
| 14 | `tugarecon` | https://github.com/LordNeoStark/tugarecon | Fast subdomains enumeration tool for penetration testers. |
| 15 | `as3nt` | https://github.com/cinerieus/as3nt | Another Subdomain ENumeration Tool |
| 16 | `Subra` | https://github.com/si9int/Subra | A Web-UI for subdomain enumeration (subfinder) |
| 17 | `Substr3am` | https://github.com/nexxai/Substr3am | Passive reconnaissance/enumeration of interesting targets by watching for SSL certificates being issued |
| 18 | `domain` | https://github.com/jhaddix/domain/ | enumall.py Setup script for Regon-ng |
| 19 | `altdns` | https://github.com/infosec-au/altdns | Generates permutations, alterations and mutations of subdomains and then resolves them |
| 20 | `brutesubs` | https://github.com/anshumanbh/brutesubs | An automation framework for running multiple open sourced subdomain bruteforcing tools (in parallel) using your own wordlists via Docker Compose |
| 21 | `dns-parallel-prober` | https://github.com/lorenzog/dns-parallel-prober | his is a parallelised domain name prober to find as many subdomains of a given domain as fast as possible. |
| 22 | `dnscan` | https://github.com/rbsec/dnscan | dnscan is a python wordlist-based DNS subdomain scanner. |
| 23 | `knock` | https://github.com/guelfoweb/knock | Knockpy is a python tool designed to enumerate subdomains on a target domain through a wordlist. |
| 24 | `hakrevdns` | https://github.com/hakluke/hakrevdns | Small, fast tool for performing reverse DNS lookups en masse. |
| 25 | `dnsx` | https://github.com/projectdiscovery/dnsx | Dnsx is a fast and multi-purpose DNS toolkit allow to run multiple DNS queries of your choice with a list of user-supplied resolvers. |
| 26 | `subfinder` | https://github.com/projectdiscovery/subfinder | Subfinder is a subdomain discovery tool that discovers valid subdomains for websites. |
| 27 | `assetfinder` | https://github.com/tomnomnom/assetfinder | Find domains and subdomains related to a given domain |
| 28 | `crtndstry` | https://github.com/nahamsec/crtndstry | Yet another subdomain finder |
| 29 | `VHostScan` | https://github.com/codingo/VHostScan | A virtual host scanner that performs reverse lookups |
| 30 | `scilla` | https://github.com/edoardottt/scilla | Information Gathering tool - DNS / Subdomains / Ports / Directories enumeration |
| 31 | `sub3suite` | https://github.com/3nock/sub3suite | A research-grade suite of tools for subdomain enumeration, intelligence gathering and attack surface mapping. |
| 32 | `cero` | https://github.com/glebarez/cero | Scrape domain names from SSL certificates of arbitrary hosts |
| 33 | `shosubgo` | https://github.com/incogbyte/shosubgo | Small tool to Grab subdomains using Shodan api |
| 34 | `haktrails` | https://github.com/hakluke/haktrails | Golang client for querying SecurityTrails API data |
| 35 | `bbot` | https://github.com/blacklanternsecurity/bbot | A recursive internet scanner for hackers |
| 36 | `crt.go` | https://github.com/TaurusOmar/crt.sh | This Go script simplifies the process of efficiently saving and analyzing subdomain output from the crt.sh website. |
| 37 | `github-subdomains` | https://github.com/gwen001/github-subdomains | This Go tool performs searches on GitHub and parses the results to find subdomains of a given domain. |
| 38 | `gitlab-subdomains` | https://github.com/gwen001/gitlab-subdomains | This Go tool performs searches on GitLab and parses the results to find subdomains of a given domain. |
| 39 | `subdominator` | https://github.com/RevoltSecurities/Subdominator | Fast and powerfull to enumerate subdomains (50+ passive results ). |
| 40 | `csprecon` | https://github.com/edoardottt/csprecon | Discover new target domains using Content Security Policy |
| 41 | `related-domains` | https://github.com/gwen001/related-domains | Find related domains of a given domain. this tool search for domains that have been registered by the same peoples/companies. |
| 42 | `hakip2host` | https://github.com/hakluke/hakip2host | hakip2host takes a list of IP addresses via stdin, then does a series of checks to return associated domain names. |

#### Port Scanning

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `masscan` | https://github.com/robertdavidgraham/masscan | TCP port scanner, spews SYN packets asynchronously, scanning entire Internet in under 5 minutes. |
| 2 | `RustScan` | https://github.com/RustScan/RustScan | The Modern Port Scanner |
| 3 | `naabu` | https://github.com/projectdiscovery/naabu | A fast port scanner written in go with focus on reliability and simplicity. |
| 4 | `nmap` | https://github.com/nmap/nmap | Nmap - the Network Mapper. Github mirror of official SVN repository. |
| 5 | `sandmap` | https://github.com/trimstray/sandmap | Nmap on steroids. Simple CLI with the ability to run pure Nmap engine, 31 modules with 459 scan profiles. |
| 6 | `ScanCannon` | https://github.com/johnnyxmas/ScanCannon | Combines the speed of masscan with the reliability and detailed enumeration of nmap |
| 7 | `nrich` | https://gitlab.com/shodan-public/nrich | A command-line tool to quickly analyze all IPs in a file and see which ones have open ports/ vulnerabilities. |
| 8 | `NimScan` | https://github.com/elddy/NimScan/ | Fast Port Scanner 🚀 |

#### Screenshots

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `EyeWitness` | https://github.com/FortyNorthSecurity/EyeWitness | EyeWitness is designed to take screenshots of websites, provide some server header info, and identify default credentials if possible. |
| 2 | `aquatone` | https://github.com/michenriksen/aquatone | Aquatone is a tool for visual inspection of websites across a large amount of hosts and is convenient for quickly gaining an overview of HTTP-based attack surface. |
| 3 | `screenshoteer` | https://github.com/vladocar/screenshoteer | Make website screenshots and mobile emulations from the command line. |
| 4 | `gowitness` | https://github.com/sensepost/gowitness | gowitness - a golang, web screenshot utility using Chrome Headless |
| 5 | `WitnessMe` | https://github.com/byt3bl33d3r/WitnessMe | Web Inventory tool, takes screenshots of webpages using Pyppeteer (headless Chrome/Chromium) and provides some extra bells & whistles to make life easier. |
| 6 | `eyeballer` | https://github.com/BishopFox/eyeballer | Convolutional neural network for analyzing pentest screenshots |
| 7 | `scrying` | https://github.com/nccgroup/scrying | A tool for collecting RDP, web and VNC screenshots all in one place |
| 8 | `Depix` | https://github.com/beurtschipper/Depix | Recovers passwords from pixelized screenshots |
| 9 | `httpscreenshot` | https://github.com/breenmachine/httpscreenshot/ | HTTPScreenshot is a tool for grabbing screenshots and HTML of large numbers of websites. |
| 10 | `invisible-playwright` | https://github.com/feder-cr/invisible_playwright | Playwright wrapper for a stealth-patched Firefox 150 binary, useful for screenshotting and recon against targets with anti-bot detection (reCAPTCHA v3, FingerprintPro, Cloudflare). |

#### Technologies

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `wappalyzer` | https://github.com/AliasIO/wappalyzer | Identify technology on websites. |
| 2 | `webanalyze` | https://github.com/rverton/webanalyze | Port of Wappalyzer (uncovers technologies used on websites) to automate mass scanning. |
| 3 | `python-builtwith` | https://github.com/claymation/python-builtwith | BuiltWith API client |
| 4 | `whatweb` | https://github.com/urbanadventurer/whatweb | Next generation web scanner |
| 5 | `retire.js` | https://github.com/RetireJS/retire.js | scanner detecting the use of JavaScript libraries with known vulnerabilities |
| 6 | `httpx` | https://github.com/projectdiscovery/httpx | httpx is a fast and multi-purpose HTTP toolkit allows to run multiple probers using retryablehttp library, it is designed to maintain the result reliability with increased threads. |
| 7 | `fingerprintx` | https://github.com/praetorian-inc/fingerprintx | fingerprintx is a standalone utility for service discovery on open ports that works well with other popular bug bounty command line tools. |
| 8 | `graphw00f` | https://github.com/dolevf/graphw00f | graphw00f is GraphQL Server Engine Fingerprinting utility for software security professionals looking to learn more about what technology is behind a given GraphQL endpoint. |
| 9 | `wafw00f` | https://github.com/EnableSecurity/wafw00f | wafw00f allows one to identify and fingerprint Web Application Firewall (WAF) products protecting a website. |
| 10 | `cdncheck` | https://github.com/projectdiscovery/cdncheck | cdncheck is a tool for identifying the technology associated with dns / ip network addresses. |
| 11 | `tlsx` | https://github.com/projectdiscovery/tlsx | A fast and configurable TLS grabber focused on TLS based data collection and analysis. |
| 12 | `MurMurHash` | https://github.com/Viralmaniar/MurMurHash | This little tool is to calculate a MurmurHash value of a favicon. This favicon hash can be used to look for similar websites on various search engines. |

#### Content Discovery

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `gobuster` | https://github.com/OJ/gobuster | Directory/File, DNS and VHost busting tool written in Go |
| 2 | `recursebuster` | https://github.com/C-Sto/recursebuster | rapid content discovery tool for recursively querying webservers, handy in pentesting and web application assessments |
| 3 | `feroxbuster` | https://github.com/epi052/feroxbuster | A fast, simple, recursive content discovery tool written in Rust. |
| 4 | `dirsearch` | https://github.com/maurosoria/dirsearch | Web path scanner |
| 5 | `dirsearch` | https://github.com/evilsocket/dirsearch | A Go implementation of dirsearch. |
| 6 | `filebuster` | https://github.com/henshin/filebuster | An extremely fast and flexible web fuzzer |
| 7 | `dirstalk` | https://github.com/stefanoj3/dirstalk | Modern alternative to dirbuster/dirb |
| 8 | `dirbuster-ng` | https://github.com/digination/dirbuster-ng | dirbuster-ng is C CLI implementation of the Java dirbuster tool |
| 9 | `gospider` | https://github.com/jaeles-project/gospider | Gospider - Fast web spider written in Go |
| 10 | `hakrawler` | https://github.com/hakluke/hakrawler | Simple, fast web crawler designed for easy, quick discovery of endpoints and assets within a web application |
| 11 | `crawley` | https://github.com/s0rg/crawley | fast, feature-rich unix-way web scraper/crawler written in Golang. |
| 12 | `katana` | https://github.com/projectdiscovery/katana | A next-generation crawling and spidering framework |
| 13 | `kiterunner` | https://github.com/assetnote/kiterunner | Fast API endpoint bruteforcer and content discovery tool for modern web applications. |
| 14 | `vaf` | https://github.com/andreiverse/vaf | Vaf is a cross-platform very advanced and fast web fuzzer written in nim . |
| 15 | `uncover` | https://github.com/projectdiscovery/uncover | uncover is a go wrapper using APIs of well known search engines to quickly discover exposed hosts on the internet. |

#### Content Filtering

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `Hacker-Scoper` | https://github.com/ItsIgnacioPortal/Hacker-Scoper | CLI tool for filtering a mixed list of targets (URLs/IPs) according to the bug-bounty program's scope. The scope can be supplied manually, or it can also be detected automatically by just giving hacker-scoper the name of the targeted company. Hacker-Scoper supports IPs, URLs, wildcards, CIDR ranges, Nmap octet ranges, and even full Regex scopes. |

#### Links

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `LinkFinder` | https://github.com/GerbenJavado/LinkFinder | A python script that finds endpoints in JavaScript files |
| 2 | `JS-Scan` | https://github.com/zseano/JS-Scan | a .js scanner, built in php. designed to scrape urls and other info |
| 3 | `LinksDumper` | https://github.com/arbazkiraak/LinksDumper | Extract (links/possible endpoints) from responses & filter them via decoding/sorting |
| 4 | `GoLinkFinder` | https://github.com/0xsha/GoLinkFinder | A fast and minimal JS endpoint extractor |
| 5 | `BurpJSLinkFinder` | https://github.com/InitRoot/BurpJSLinkFinder | Burp Extension for a passive scanning JS files for endpoint links. |
| 6 | `urlgrab` | https://github.com/IAmStoxe/urlgrab | A golang utility to spider through a website searching for additional links. |
| 7 | `waybackurls` | https://github.com/tomnomnom/waybackurls | Fetch all the URLs that the Wayback Machine knows about for a domain |
| 8 | `gau` | https://github.com/lc/gau | Fetch known URLs from AlienVault's Open Threat Exchange, the Wayback Machine, and Common Crawl. |
| 9 | `getJS` | https://github.com/003random/getJS | A tool to fastly get all javascript sources/files |
| 10 | `linx` | https://github.com/riza/linx | Reveals invisible links within JavaScript files |
| 11 | `waymore` | https://github.com/xnl-h4ck3r/waymore | Find way more from the Wayback Machine! |
| 12 | `xnLinkFinder` | https://github.com/xnl-h4ck3r/xnLinkFinder | A python tool used to discover endpoints, potential parameters, and a target specific wordlist for a given target |
| 13 | `URLFinder` | https://github.com/projectdiscovery/urlfinder | A high-speed tool for passively gathering URLs, optimized for efficient web asset discovery without active scanning. |
| 14 | `github-endpoints` | https://github.com/gwen001/github-endpoints | This Go tool performs searches on GitHub and parses the results to find endpoints of a given domain. |
| 15 | `jsleak` | https://github.com/byt3hx/jsleak | jsleak is a tool to find secret , paths or links in JavaScript files or source code. |
| 16 | `jsfinder` | https://github.com/kacakb/jsfinder | A tool that scans web pages to find JavaScript file URLs linked in the HTML source code. |
| 17 | `jsluice` | https://github.com/BishopFox/jsluice | This tool extracts URLs, paths, secrets, and other interesting bits from JavaScript files. Values are extracted based not just on how they look, but also based on how they are used. |

#### Parameters

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `parameth` | https://github.com/maK-/parameth | This tool can be used to brute discover GET and POST parameters |
| 2 | `param-miner` | https://github.com/PortSwigger/param-miner | This extension identifies hidden, unlinked parameters. It's particularly useful for finding web alterx poisoning vulnerabilities. |
| 3 | `ParamPamPam` | https://github.com/Bo0oM/ParamPamPam | This tool for brute discover GET and POST parameters. |
| 4 | `Arjun` | https://github.com/s0md3v/Arjun | HTTP parameter discovery suite. |
| 5 | `ParamSpider` | https://github.com/devanshbatham/ParamSpider | Mining parameters from dark corners of Web Archives. |
| 6 | `x8` | https://github.com/Sh1Yo/x8 | Hidden parameters discovery suite written in Rust. |

#### Fuzzing

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `wfuzz` | https://github.com/xmendez/wfuzz | Web application fuzzer |
| 2 | `ffuf` | https://github.com/ffuf/ffuf | Fast web fuzzer written in Go |
| 3 | `fuzzdb` | https://github.com/fuzzdb-project/fuzzdb | Dictionary of attack patterns and primitives for black-box application fault injection and resource discovery. |
| 4 | `IntruderPayloads` | https://github.com/1N3/IntruderPayloads | A collection of Burpsuite Intruder payloads, BurpBounty payloads, fuzz lists, malicious file uploads and web pentesting methodologies and checklists. |
| 5 | `fuzz.txt` | https://github.com/Bo0oM/fuzz.txt | Potentially dangerous files |
| 6 | `fuzzilli` | https://github.com/googleprojectzero/fuzzilli | A JavaScript Engine Fuzzer |
| 7 | `fuzzapi` | https://github.com/Fuzzapi/fuzzapi | Fuzzapi is a tool used for REST API pentesting and uses API_Fuzzer gem |
| 8 | `qsfuzz` | https://github.com/ameenmaali/qsfuzz | qsfuzz (Query String Fuzz) allows you to build your own rules to fuzz query strings and easily identify vulnerabilities. |
| 9 | `vaf` | https://github.com/d4rckh/vaf | very advanced (web) fuzzer written in Nim. |

#### Monitoring

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `bbscope` | https://github.com/sw33tLie/bbscope | Scope aggregation tool for HackerOne, Bugcrowd, Intigriti, YesWeHack, Immunefi |
| 2 | `jsmon` | https://github.com/robre/jsmon | A Javascript change monitoring tool for Bug Bounty. |

### Exploitation（大分類）
#### Command Injection

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `commix` | https://github.com/commixproject/commix | Automated All-in-One OS command injection and exploitation tool. |

#### CORS Misconfiguration

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `Corsy` | https://github.com/s0md3v/Corsy | CORS Misconfiguration Scanner |
| 2 | `Corser` | https://github.com/cyinnove/corser | Corser is a Golang CLI Application for Advanced CORS Misconfiguration Detection. |
| 3 | `CORStest` | https://github.com/RUB-NDS/CORStest | A simple CORS misconfiguration scanner |
| 4 | `cors-scanner` | https://github.com/laconicwolf/cors-scanner | A multi-threaded scanner that helps identify CORS flaws/misconfigurations |
| 5 | `CorsMe` | https://github.com/Shivangx01b/CorsMe | Cross Origin Resource Sharing MisConfiguration Scanner |

#### CRLF Injection

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `CRLFsuite` | https://github.com/Nefcore/CRLFsuite | A fast tool specially designed to scan CRLF injection |
| 2 | `crlfuzz` | https://github.com/dwisiswant0/crlfuzz | A fast tool to scan CRLF vulnerability written in Go |
| 3 | `CRLF-Injection-Scanner` | https://github.com/MichaelStott/CRLF-Injection-Scanner | Command line tool for testing CRLF injection on a list of domains. |
| 4 | `Injectus` | https://github.com/BountyStrike/Injectus | CRLF and open redirect fuzzer |

#### CSRF Injection

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `XSRFProbe` | https://github.com/0xInfection/XSRFProbe | The Prime Cross Site Request Forgery (CSRF) Audit and Exploitation Toolkit. |

#### Directory Traversal

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `dotdotpwn` | https://github.com/wireghoul/dotdotpwn | DotDotPwn - The Directory Traversal Fuzzer |
| 2 | `FDsploit` | https://github.com/chrispetrou/FDsploit | File Inclusion & Directory Traversal fuzzing, enumeration & exploitation tool. |
| 3 | `off-by-slash` | https://github.com/bayotop/off-by-slash | Burp extension to detect alias traversal via NGINX misconfiguration at scale. |
| 4 | `liffier` | https://github.com/momenbasel/liffier | tired of manually add dot-dot-slash to your possible path traversal? this short snippet will increment ../ on the URL. |

#### File Inclusion

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `liffy` | https://github.com/mzfr/liffy | Local file inclusion exploitation tool |
| 2 | `Burp-LFI-tests` | https://github.com/Team-Firebugs/Burp-LFI-tests | Fuzzing for LFI using Burpsuite |
| 3 | `LFI-Enum` | https://github.com/mthbernardes/LFI-Enum | Scripts to execute enumeration via LFI |
| 4 | `LFISuite` | https://github.com/D35m0nd142/LFISuite | Totally Automatic LFI Exploiter (+ Reverse Shell) and Scanner |
| 5 | `LFI-files` | https://github.com/hussein98d/LFI-files | Wordlist to bruteforce for LFI |

#### GraphQL Injection

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `inql` | https://github.com/doyensec/inql | InQL - A Burp Extension for GraphQL Security Testing |
| 2 | `GraphQLmap` | https://github.com/swisskyrepo/GraphQLmap | GraphQLmap is a scripting engine to interact with a graphql endpoint for pentesting purposes. |
| 3 | `shapeshifter` | https://github.com/szski/shapeshifter | GraphQL security testing tool |
| 4 | `graphql_beautifier` | https://github.com/zidekmat/graphql_beautifier | Burp Suite extension to help make Graphql request more readable |
| 5 | `clairvoyance` | https://github.com/nikitastupin/clairvoyance | Obtain GraphQL API schema despite disabled introspection! |

#### Header Injection

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `headi` | https://github.com/mlcsec/headi | Customisable and automated HTTP header injection. |

#### Insecure Deserialization

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `ysoserial` | https://github.com/frohoff/ysoserial | A proof-of-concept tool for generating payloads that exploit unsafe Java object deserialization. |
| 2 | `GadgetProbe` | https://github.com/BishopFox/GadgetProbe | Probe endpoints consuming Java serialized objects to identify classes, libraries, and library versions on remote Java classpaths. |
| 3 | `ysoserial.net` | https://github.com/pwntester/ysoserial.net | Deserialization payload generator for a variety of .NET formatters |
| 4 | `phpggc` | https://github.com/ambionics/phpggc | PHPGGC is a library of PHP unserialize() payloads along with a tool to generate them, from command line or programmatically. |

#### Insecure Direct Object References

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `Autorize` | https://github.com/Quitten/Autorize | Automatic authorization enforcement detection extension for burp suite written in Jython developed by Barak Tawily |

#### Open Redirect

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `Oralyzer` | https://github.com/r0075h3ll/Oralyzer | Open Redirection Analyzer |
| 2 | `Injectus` | https://github.com/BountyStrike/Injectus | CRLF and open redirect fuzzer |
| 3 | `dom-red` | https://github.com/Naategh/dom-red | Small script to check a list of domains against open redirect vulnerability |
| 4 | `OpenRedireX` | https://github.com/devanshbatham/OpenRedireX | A Fuzzer for OpenRedirect issues |

#### Race Condition

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `razzer` | https://github.com/compsec-snu/razzer | A Kernel fuzzer focusing on race bugs |
| 2 | `racepwn` | https://github.com/racepwn/racepwn | Race Condition framework |
| 3 | `requests-racer` | https://github.com/nccgroup/requests-racer | Small Python library that makes it easy to exploit race conditions in web apps with Requests. |
| 4 | `turbo-intruder` | https://github.com/PortSwigger/turbo-intruder | Turbo Intruder is a Burp Suite extension for sending large numbers of HTTP requests and analyzing the results. |
| 5 | `race-the-web` | https://github.com/TheHackerDev/race-the-web | Tests for race conditions in web applications. Includes a RESTful API to integrate into a continuous integration pipeline. |

#### Request Smuggling

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `http-request-smuggling` | https://github.com/anshumanpattnaik/http-request-smuggling | HTTP Request Smuggling Detection Tool |
| 2 | `smuggler` | https://github.com/defparam/smuggler | Smuggler - An HTTP Request Smuggling / Desync testing tool written in Python 3 |
| 3 | `h2csmuggler` | https://github.com/BishopFox/h2csmuggler | HTTP Request Smuggling over HTTP/2 Cleartext (h2c) |
| 4 | `tiscripts` | https://github.com/defparam/tiscripts | These scripts I use to create Request Smuggling Desync payloads for CLTE and TECL style attacks. |
| 5 | `smugglex` | github.com/hahwul/smugglex | Rust-powered HTTP Request Smuggling Scanner. |

#### Server Side Request Forgery

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `SSRFmap` | https://github.com/swisskyrepo/SSRFmap | Automatic SSRF fuzzer and exploitation tool |
| 2 | `Gopherus` | https://github.com/tarunkant/Gopherus | This tool generates gopher link for exploiting SSRF and gaining RCE in various servers |
| 3 | `ground-control` | https://github.com/jobertabma/ground-control | A collection of scripts that run on my web server. Mainly for debugging SSRF, blind XSS, and XXE vulnerabilities. |
| 4 | `SSRFire` | https://github.com/micha3lb3n/SSRFire | An automated SSRF finder. Just give the domain name and your server and chill! ;) Also has options to find XSS and open redirects |
| 5 | `httprebind` | https://github.com/daeken/httprebind | Automatic tool for DNS rebinding-based SSRF attacks |
| 6 | `ssrf-sheriff` | https://github.com/teknogeek/ssrf-sheriff | A simple SSRF-testing sheriff written in Go |
| 7 | `B-XSSRF` | https://github.com/SpiderMate/B-XSSRF | Toolkit to detect and keep track on Blind XSS, XXE & SSRF |
| 8 | `extended-ssrf-search` | https://github.com/Damian89/extended-ssrf-search | Smart ssrf scanner using different methods like parameter brute forcing in post and get... |
| 9 | `gaussrf` | https://github.com/KathanP19/gaussrf | Fetch known URLs from AlienVault's Open Threat Exchange, the Wayback Machine, and Common Crawl and Filter Urls With OpenRedirection or SSRF Parameters. |
| 10 | `ssrfDetector` | https://github.com/JacobReynolds/ssrfDetector | Server-side request forgery detector |
| 11 | `grafana-ssrf` | https://github.com/RandomRobbieBF/grafana-ssrf | Authenticated SSRF in Grafana |
| 12 | `sentrySSRF` | https://github.com/xawdxawdx/sentrySSRF | Tool to searching sentry config on page or in javascript files and check blind SSRF |
| 13 | `lorsrf` | https://github.com/knassar702/lorsrf | Bruteforcing on Hidden parameters to find SSRF vulnerability using GET and POST Methods |
| 14 | `singularity` | https://github.com/nccgroup/singularity | A DNS rebinding attack framework. |
| 15 | `whonow` | https://github.com/brannondorsey/whonow | A "malicious" DNS server for executing DNS Rebinding attacks on the fly (public instance running on rebind.network:53) |
| 16 | `dns-rebind-toolkit` | https://github.com/brannondorsey/dns-rebind-toolkit | A front-end JavaScript toolkit for creating DNS rebinding attacks. |
| 17 | `dref` | https://github.com/FSecureLABS/dref | DNS Rebinding Exploitation Framework |
| 18 | `rbndr` | https://github.com/taviso/rbndr | Simple DNS Rebinding Service |
| 19 | `httprebind` | https://github.com/daeken/httprebind | Automatic tool for DNS rebinding-based SSRF attacks |
| 20 | `dnsFookup` | https://github.com/makuga01/dnsFookup | DNS rebinding toolkit |
| 21 | `surf` | https://github.com/assetnote/surf | Escalate your SSRF vulnerabilities on Modern Cloud Environments. `surf` allows you to filter a list of hosts, returning a list of viable SSRF candidates. |

#### SQL Injection

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `sqlmap` | https://github.com/sqlmapproject/sqlmap | Automatic SQL injection and database takeover tool |
| 2 | `NoSQLMap` | https://github.com/codingo/NoSQLMap | Automated NoSQL database enumeration and web application exploitation tool. |
| 3 | `SQLiScanner` | https://github.com/0xbug/SQLiScanner | Automatic SQL injection with Charles and sqlmap api |
| 4 | `SleuthQL` | https://github.com/RhinoSecurityLabs/SleuthQL | Python3 Burp History parsing tool to discover potential SQL injection points. To be used in tandem with SQLmap. |
| 5 | `mssqlproxy` | https://github.com/blackarrowsec/mssqlproxy | mssqlproxy is a toolkit aimed to perform lateral movement in restricted environments through a compromised Microsoft SQL Server via socket reuse |
| 6 | `sqli-hunter` | https://github.com/zt2/sqli-hunter | SQLi-Hunter is a simple HTTP / HTTPS proxy server and a SQLMAP API wrapper that makes digging SQLi easy. |
| 7 | `waybackSqliScanner` | https://github.com/ghostlulzhacks/waybackSqliScanner | Gather urls from wayback machine then test each GET parameter for sql injection. |
| 8 | `ESC` | https://github.com/NetSPI/ESC | Evil SQL Client (ESC) is an interactive .NET SQL console client with enhanced SQL Server discovery, access, and data exfiltration features. |
| 9 | `mssqli-duet` | https://github.com/Keramas/mssqli-duet | SQL injection script for MSSQL that extracts domain users from an Active Directory environment based on RID bruteforcing |
| 10 | `burp-to-sqlmap` | https://github.com/Miladkhoshdel/burp-to-sqlmap | Performing SQLInjection test on Burp Suite Bulk Requests using SQLMap |
| 11 | `BurpSQLTruncSanner` | https://github.com/InitRoot/BurpSQLTruncSanner | Messy BurpSuite plugin for SQL Truncation vulnerabilities. |
| 12 | `andor` | https://github.com/sadicann/andor | Blind SQL Injection Tool with Golang |
| 13 | `Blinder` | https://github.com/mhaskar/Blinder | A python library to automate time-based blind SQL injection |
| 14 | `sqliv` | https://github.com/the-robot/sqliv | massive SQL injection vulnerability scanner |
| 15 | `nosqli` | https://github.com/Charlie-belmer/nosqli | NoSql Injection CLI tool, for finding vulnerable websites using MongoDB. |
| 16 | `ghauri` | https://github.com/r0oth3x49/ghauri | An advanced cross-platform tool that automates the process of detecting and exploiting SQL injection security flaws |

#### XSS Injection

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `XSStrike` | https://github.com/s0md3v/XSStrike | Most advanced XSS scanner. |
| 2 | `xssor2` | https://github.com/evilcos/xssor2 | XSS'OR - Hack with JavaScript. |
| 3 | `xsscrapy` | https://github.com/DanMcInerney/xsscrapy | XSS spider - 66/66 wavsep XSS detected |
| 4 | `sleepy-puppy` | https://github.com/Netflix-Skunkworks/sleepy-puppy | Sleepy Puppy XSS Payload Management Framework |
| 5 | `ezXSS` | https://github.com/ssl/ezXSS | ezXSS is an easy way for penetration testers and bug bounty hunters to test (blind) Cross Site Scripting. |
| 6 | `xsshunter` | https://github.com/mandatoryprogrammer/xsshunter | The XSS Hunter service - a portable version of XSSHunter.com |
| 7 | `dalfox` | https://github.com/hahwul/dalfox | DalFox(Finder Of XSS) / Parameter Analysis and XSS Scanning tool based on golang |
| 8 | `xsser` | https://github.com/epsylon/xsser | Cross Site "Scripter" (aka XSSer) is an automatic -framework- to detect, exploit and report XSS vulnerabilities in web-based applications. |
| 9 | `XSpear` | https://github.com/hahwul/XSpear | Powerful XSS Scanning and Parameter analysis tool&gem |
| 10 | `weaponised-XSS-payloads` | https://github.com/hakluke/weaponised-XSS-payloads | XSS payloads designed to turn alert(1) into P1 |
| 11 | `tracy` | https://github.com/nccgroup/tracy | A tool designed to assist with finding all sinks and sources of a web application and display these results in a digestible manner. |
| 12 | `ground-control` | https://github.com/jobertabma/ground-control | A collection of scripts that run on my web server. Mainly for debugging SSRF, blind XSS, and XXE vulnerabilities. |
| 13 | `xssValidator` | https://github.com/nVisium/xssValidator | This is a burp intruder extender that is designed for automation and validation of XSS vulnerabilities. |
| 14 | `JSShell` | https://github.com/Den1al/JSShell | An interactive multi-user web JS shell |
| 15 | `bXSS` | https://github.com/LewisArdern/bXSS | bXSS is a utility which can be used by bug hunters and organizations to identify Blind Cross-Site Scripting. |
| 16 | `docem` | https://github.com/whitel1st/docem | Uility to embed XXE and XSS payloads in docx,odt,pptx,etc (OXML_XEE on steroids) |
| 17 | `XSS-Radar` | https://github.com/bugbountyforum/XSS-Radar | XSS Radar is a tool that detects parameters and fuzzes them for cross-site scripting vulnerabilities. |
| 18 | `BruteXSS` | https://github.com/rajeshmajumdar/BruteXSS | BruteXSS is a tool written in python simply to find XSS vulnerabilities in web application. |
| 19 | `findom-xss` | https://github.com/dwisiswant0/findom-xss | A fast DOM based XSS vulnerability scanner with simplicity. |
| 20 | `domdig` | https://github.com/fcavallarin/domdig | DOM XSS scanner for Single Page Applications |
| 21 | `femida` | https://github.com/wish-i-was/femida | Automated blind-xss search for Burp Suite |
| 22 | `B-XSSRF` | https://github.com/SpiderMate/B-XSSRF | Toolkit to detect and keep track on Blind XSS, XXE & SSRF |
| 23 | `domxssscanner` | https://github.com/yaph/domxssscanner | DOMXSS Scanner is an online tool to scan source code for DOM based XSS vulnerabilities |
| 24 | `xsshunter_client` | https://github.com/mandatoryprogrammer/xsshunter_client | Correlated injection proxy tool for XSS Hunter |
| 25 | `extended-xss-search` | https://github.com/Damian89/extended-xss-search | A better version of my xssfinder tool - scans for different types of xss on a list of urls. |
| 26 | `xssmap` | https://github.com/Jewel591/xssmap | XSSMap 是一款基于 Python3 开发用于检测 XSS 漏洞的工具 |
| 27 | `XSSCon` | https://github.com/menkrep1337/XSSCon | XSSCon: Simple XSS Scanner tool |
| 28 | `BitBlinder` | https://github.com/BitTheByte/BitBlinder | BurpSuite extension to inject custom cross-site scripting payloads on every form/request submitted to detect blind XSS vulnerabilities |
| 29 | `XSSOauthPersistence` | https://github.com/dxa4481/XSSOauthPersistence | Maintaining account persistence via XSS and Oauth |
| 30 | `shadow-workers` | https://github.com/shadow-workers/shadow-workers | Shadow Workers is a free and open source C2 and proxy designed for penetration testers to help in the exploitation of XSS and malicious Service Workers (SW) |
| 31 | `rexsser` | https://github.com/profmoriarity/rexsser | This is a burp plugin that extracts keywords from response using regexes and test for reflected XSS on the target scope. |
| 32 | `xss-flare` | https://github.com/EgeBalci/xss-flare | XSS hunter on cloudflare serverless workers. |
| 33 | `Xss-Sql-Fuzz` | https://github.com/jiangsir404/Xss-Sql-Fuzz | burpsuite 插件对GP所有参数(过滤特殊参数)一键自动添加xss sql payload 进行fuzz |
| 34 | `vaya-ciego-nen` | https://github.com/hipotermia/vaya-ciego-nen | Detect, manage and exploit Blind Cross-site scripting (XSS) vulnerabilities. |
| 35 | `dom-based-xss-finder` | https://github.com/AsaiKen/dom-based-xss-finder | Chrome extension that finds DOM based XSS vulnerabilities |
| 36 | `XSSTerminal` | https://github.com/machinexa2/XSSTerminal | Develop your own XSS Payload using interactive typing |
| 37 | `xss2png` | https://github.com/vavkamil/xss2png | PNG IDAT chunks XSS payload generator |
| 38 | `XSSwagger` | https://github.com/vavkamil/XSSwagger | A simple Swagger-ui scanner that can detect old versions vulnerable to various XSS attacks |
| 39 | `JSONBee` | https://github.com/zigoo0/JSONBee | A ready to use JSONP endpoints/payloads to help bypass content security policy (CSP) of different websites. |
| 40 | `CSPBypass` | https://github.com/renniepak/CSPBypass | a tool designed to help bypass restrictive Content Security Policies (CSP) and exploit XSS (Cross-Site Scripting) vulnerabilities on sites where injections are blocked by CSPs that only allow certain whitelisted domains. |

#### XXE Injection

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `ground-control` | https://github.com/jobertabma/ground-control | A collection of scripts that run on my web server. Mainly for debugging SSRF, blind XSS, and XXE vulnerabilities. |
| 2 | `dtd-finder` | https://github.com/GoSecure/dtd-finder | List DTDs and generate XXE payloads using those local DTDs. |
| 3 | `docem` | https://github.com/whitel1st/docem | Uility to embed XXE and XSS payloads in docx,odt,pptx,etc (OXML_XEE on steroids) |
| 4 | `xxeserv` | https://github.com/staaldraad/xxeserv | A mini webserver with FTP support for XXE payloads |
| 5 | `xxexploiter` | https://github.com/luisfontes19/xxexploiter | Tool to help exploit XXE vulnerabilities |
| 6 | `B-XSSRF` | https://github.com/SpiderMate/B-XSSRF | Toolkit to detect and keep track on Blind XSS, XXE & SSRF |
| 7 | `XXEinjector` | https://github.com/enjoiz/XXEinjector | Tool for automatic exploitation of XXE vulnerability using direct and different out of band methods. |
| 8 | `oxml_xxe` | https://github.com/BuffaloWill/oxml_xxe | A tool for embedding XXE/XML exploits into different filetypes |
| 9 | `metahttp` | https://github.com/vp777/metahttp | A bash script that automates the scanning of a target network for HTTP resources through XXE |

#### SSTI Injection

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `tplmap` | https://github.com/epinna/tplmap | Server-Side Template Injection and Code Injection Detection and Exploitation Tool |
| 2 | `SSTImap` | https://github.com/vladko312/SSTImap | Automatic SSTI detection tool with interactive interface |

#### Web-Cache-Poisoning

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `toxicache` | https://github.com/xhzeem/toxicache | Go scanner to find web cache poisoning vulnerabilities in a list of URLs . |

#### Waf Evasion

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `nomore403` | https://github.com/devploit/nomore403 | Advanced tool for security researchers to bypass 403/40X restrictions . |
| 2 | `XFFenum` | https://github.com/vavkamil/XFFenum | A simple tool to bypass 403 forbidden end-points behind load balancers (Cloudflare) based on X-Forwarded-For header. |
| 3 | `Forbidden Buster` | https://github.com/Sn1r/Forbidden-Buster | A tool designed to automate various techniques in order to bypass HTTP 401 and 403 response codes and gain access to unauthorized areas in the system. |
| 4 | `nowafpls` | https://github.com/assetnote/nowafpls/ | Burp Plugin to Bypass WAFs through the insertion of Junk Data. |

### Miscellaneous（大分類）
#### Passwords

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `thc-hydra` | https://github.com/vanhauser-thc/thc-hydra | Hydra is a parallelized login cracker which supports numerous protocols to attack. |
| 2 | `DefaultCreds-cheat-sheet` | https://github.com/ihebski/DefaultCreds-cheat-sheet | One place for all the default credentials to assist the Blue/Red teamers activities on finding devices with default password |
| 3 | `changeme` | https://github.com/ztgrace/changeme | A default credential scanner. |
| 4 | `BruteX` | https://github.com/1N3/BruteX | Automatically brute force all services running on a target. |
| 5 | `patator` | https://github.com/lanjelot/patator | Patator is a multi-purpose brute-forcer, with a modular design and a flexible usage. |

#### Secrets

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `git-secrets` | https://github.com/awslabs/git-secrets | Prevents you from committing secrets and credentials into git repositories |
| 2 | `gitleaks` | https://github.com/zricethezav/gitleaks | Scan git repos (or files) for secrets using regex and entropy |
| 3 | `truffleHog` | https://github.com/dxa4481/truffleHog | Searches through git repositories for high entropy strings and secrets, digging deep into commit history |
| 4 | `gitGraber` | https://github.com/hisxo/gitGraber | gitGraber: monitor GitHub to search and find sensitive data in real time for different online services |
| 5 | `talisman` | https://github.com/thoughtworks/talisman | By hooking into the pre-push hook provided by Git, Talisman validates the outgoing changeset for things that look suspicious - such as authorization tokens and private keys. |
| 6 | `GitGot` | https://github.com/BishopFox/GitGot | Semi-automated, feedback-driven tool to rapidly search through troves of public data on GitHub for sensitive secrets. |
| 7 | `git-all-secrets` | https://github.com/anshumanbh/git-all-secrets | A tool to capture all the git secrets by leveraging multiple open source git searching tools |
| 8 | `github-search` | https://github.com/gwen001/github-search | Tools to perform basic search on GitHub. |
| 9 | `git-vuln-finder` | https://github.com/cve-search/git-vuln-finder | Finding potential software vulnerabilities from git commit messages |
| 10 | `commit-stream` | https://github.com/x1sec/commit-stream | #OSINT tool for finding Github repositories by extracting commit logs in real time from the Github event API |
| 11 | `gitrob` | https://github.com/michenriksen/gitrob | Reconnaissance tool for GitHub organizations |
| 12 | `repo-supervisor` | https://github.com/auth0/repo-supervisor | Scan your code for security misconfiguration, search for passwords and secrets. |
| 13 | `GitMiner` | https://github.com/UnkL4b/GitMiner | Tool for advanced mining for content on Github |
| 14 | `shhgit` | https://github.com/eth0izzle/shhgit | Ah shhgit! Find GitHub secrets in real time |
| 15 | `detect-secrets` | https://github.com/Yelp/detect-secrets | An enterprise friendly way of detecting and preventing secrets in code. |
| 16 | `rusty-hog` | https://github.com/newrelic/rusty-hog | A suite of secret scanners built in Rust for performance. Based on TruffleHog |
| 17 | `whispers` | https://github.com/Skyscanner/whispers | Identify hardcoded secrets and dangerous behaviours |
| 18 | `yar` | https://github.com/nielsing/yar | Yar is a tool for plunderin' organizations, users and/or repositories. |
| 19 | `dufflebag` | https://github.com/BishopFox/dufflebag | Search exposed EBS volumes for secrets |
| 20 | `secret-bridge` | https://github.com/duo-labs/secret-bridge | Monitors Github for leaked secrets |
| 21 | `earlybird` | https://github.com/americanexpress/earlybird | EarlyBird is a sensitive data detection tool capable of scanning source code repositories for clear text password violations, PII, outdated cryptography methods, key files and more. |
| 22 | `Trufflehog-Chrome-Extension` | https://github.com/trufflesecurity/Trufflehog-Chrome-Extension | Trufflehog-Chrome-Extension |
| 23 | `noseyparker` | https://github.com/praetorian-inc/noseyparker | Nosey Parker is a command-line program that finds secrets and sensitive information in textual data and Git history. |
| 24 | `GitHound` | https://github.com/tillson/git-hound | Recon tool leveraging Code Search API. Scans for exposed API keys across all of GitHub, not just known repos and orgs. Support for GitHub dorks. |
| 25 | `cariddi` | https://github.com/edoardottt/cariddi | Take a list of domains, crawl urls and scan for endpoints, secrets, api keys, file extensions, tokens and more... |
| 26 | `SecretFinder` | https://github.com/m4ll0k/SecretFinder | A python script for finding sensitive data (apikeys, accesstoken,jwt,..) and search anything on javascript files. |
| 27 | `js-snitch` | https://github.com/vavkamil/js-snitch | Scans remote JavaScript files with Trufflehog + Semgrep to detect leaked secrets. |
| 28 | `keyhacks` | https://github.com/streaak/keyhacks | KeyHacks shows methods to validate different API keys found on a Bug Bounty Program or a pentest. |
| 29 | `keyFinder` | https://github.com/momenbasel/keyFinder | A Chrome extension that passively scans web pages for API keys, tokens, and secrets using 80+ regex patterns and Shannon entropy analysis across 10 attack surfaces. |

#### Git

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `GitTools` | https://github.com/internetwache/GitTools | A repository with 3 tools for pwn'ing websites with .git repositories available |
| 2 | `gitjacker` | https://github.com/liamg/gitjacker | Leak git repositories from misconfigured websites |
| 3 | `git-dumper` | https://github.com/arthaud/git-dumper | A tool to dump a git repository from a website |
| 4 | `GitHunter` | https://github.com/digininja/GitHunter | A tool for searching a Git repository for interesting content |
| 5 | `dvcs-ripper` | https://github.com/kost/dvcs-ripper | Rip web accessible (distributed) version control systems: SVN/GIT/HG... |
| 6 | `Gato (Github Attack TOolkit)` | https://github.com/praetorian-inc/gato | GitHub Self-Hosted Runner Enumeration and Attack Tool |
| 7 | `zizmor` | https://github.com/zizmorcore/zizmor | Static analysis tool for GitHub Actions |

#### Buckets

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `S3Scanner` | https://github.com/sa7mon/S3Scanner | Scan for open AWS S3 buckets and dump the contents |
| 2 | `AWSBucketDump` | https://github.com/jordanpotti/AWSBucketDump | Security Tool to Look For Interesting Files in S3 Buckets |
| 3 | `CloudScraper` | https://github.com/jordanpotti/CloudScraper | CloudScraper: Tool to enumerate targets in search of cloud resources. S3 Buckets, Azure Blobs, Digital Ocean Storage Space. |
| 4 | `s3viewer` | https://github.com/SharonBrizinov/s3viewer | Publicly Open Amazon AWS S3 Bucket Viewer |
| 5 | `festin` | https://github.com/cr0hn/festin | FestIn - S3 Bucket Weakness Discovery |
| 6 | `s3reverse` | https://github.com/hahwul/s3reverse | The format of various s3 buckets is convert in one format. for bugbounty and security testing. |
| 7 | `mass-s3-bucket-tester` | https://github.com/random-robbie/mass-s3-bucket-tester | This tests a list of s3 buckets to see if they have dir listings enabled or if they are uploadable |
| 8 | `S3BucketList` | https://github.com/AlecBlance/S3BucketList | Firefox plugin that lists Amazon S3 Buckets found in requests |
| 9 | `dirlstr` | https://github.com/cybercdh/dirlstr | Finds Directory Listings or open S3 buckets from a list of URLs |
| 10 | `Burp-AnonymousCloud` | https://github.com/codewatchorg/Burp-AnonymousCloud | Burp extension that performs a passive scan to identify cloud buckets and then test them for publicly accessible vulnerabilities |
| 11 | `kicks3` | https://github.com/abuvanth/kicks3 | S3 bucket finder from html,js and bucket misconfiguration testing tool |
| 12 | `2tearsinabucket` | https://github.com/Revenant40/2tearsinabucket | Enumerate s3 buckets for a specific target. |
| 13 | `s3_objects_check` | https://github.com/nccgroup/s3_objects_check | Whitebox evaluation of effective S3 object permissions, to identify publicly accessible files. |
| 14 | `s3tk` | https://github.com/ankane/s3tk | A security toolkit for Amazon S3 |
| 15 | `CloudBrute` | https://github.com/0xsha/CloudBrute | Awesome cloud enumerator |
| 16 | `s3cario` | https://github.com/0xspade/s3cario | This tool will get the CNAME first if it's a valid Amazon s3 bucket and if it's not, it will try to check if the domain is a bucket name. |
| 17 | `S3Cruze` | https://github.com/JR0ch17/S3Cruze | All-in-one AWS S3 bucket tool for pentesters. |
| 18 | `s3dns` | https://github.com/olizimmermann/s3dns | Passive DNS-based discovery of S3 (and other cloud) buckets by resolving CNAMEs and IPs during recon—ideal for stealthy and early identification of cloud storage exposures |

#### CMS

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `wpscan` | https://github.com/wpscanteam/wpscan | WPScan is a free, for non-commercial use, black box WordPress security scanner |
| 2 | `WPSpider` | https://github.com/cyc10n3/WPSpider | A centralized dashboard for running and scheduling WordPress scans powered by wpscan utility. |
| 3 | `wprecon` | https://github.com/blackcrw/wprecon | Wordpress Recon |
| 4 | `Temodar Agent` | https://github.com/xeloxa/temodar-agent | AI-powered WordPress plugin/theme security analysis platform with Semgrep-based static analysis and agent-assisted investigation workflows |
| 5 | `CMSmap` | https://github.com/Dionach/CMSmap | CMSmap is a python open source CMS scanner that automates the process of detecting security flaws of the most popular CMSs. |
| 6 | `joomscan` | https://github.com/OWASP/joomscan | OWASP Joomla Vulnerability Scanner Project |
| 7 | `pyfiscan` | https://github.com/fgeek/pyfiscan | Free web-application vulnerability and version scanner |
| 8 | `aemhacker` | https://github.com/0ang3el/aem-hacker | Tools to identify vulnerable Adobe Experience Manager (AEM) webapps. |
| 9 | `aemscan` | https://github.com/Raz0r/aemscan | Adobe Experience Manager Vulnerability Scanner |

#### JSON Web Token

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `jwt_tool` | https://github.com/ticarpi/jwt_tool | A toolkit for testing, tweaking and cracking JSON Web Tokens |
| 2 | `c-jwt-cracker` | https://github.com/brendan-rius/c-jwt-cracker | JWT brute force cracker written in C |
| 3 | `jwt-heartbreaker` | https://github.com/wallarm/jwt-heartbreaker | The Burp extension to check JWT (JSON Web Tokens) for using keys from known from public sources |
| 4 | `jwtear` | https://github.com/KINGSABRI/jwtear | Modular command-line tool to parse, create and manipulate JWT tokens for hackers |
| 5 | `jwt-key-id-injector` | https://github.com/dariusztytko/jwt-key-id-injector | Simple python script to check against hypothetical JWT vulnerability. |
| 6 | `jwt-hack` | https://github.com/hahwul/jwt-hack | jwt-hack is tool for hacking / security testing to JWT. |
| 7 | `jwt-cracker` | https://github.com/lmammino/jwt-cracker | Simple HS256 JWT token brute force cracker |

#### postMessage

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `postMessage-tracker` | https://github.com/fransr/postMessage-tracker | A Chrome Extension to track postMessage usage (url, domain and stack) both by logging using CORS and also visually as an extension-icon |
| 2 | `PostMessage_Fuzz_Tool` | https://github.com/kiranreddyrebel/PostMessage_Fuzz_Tool | #BugBounty #BugBounty Tools #WebDeveloper Tool |

#### Subdomain Takeover

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `subjack` | https://github.com/haccer/subjack | Subdomain Takeover tool written in Go |
| 2 | `SubOver` | https://github.com/Ice3man543/SubOver | A Powerful Subdomain Takeover Tool |
| 3 | `autoSubTakeover` | https://github.com/JordyZomer/autoSubTakeover | A tool used to check if a CNAME resolves to the scope address. If the CNAME resolves to a non-scope address it might be worth checking out if subdomain takeover is possible. |
| 4 | `NSBrute` | https://github.com/shivsahni/NSBrute | Python utility to takeover domains vulnerable to AWS NS Takeover |
| 5 | `can-i-take-over-xyz` | https://github.com/EdOverflow/can-i-take-over-xyz | "Can I take over XYZ?" — a list of services and how to claim (sub)domains with dangling DNS records. |
| 6 | `cnames` | https://github.com/cybercdh/cnames | take a list of resolved subdomains and output any corresponding CNAMES en masse. |
| 7 | `subHijack` | https://github.com/vavkamil/old-repos-backup/tree/master/subHijack-master | Hijacking forgotten & misconfigured subdomains |
| 8 | `tko-subs` | https://github.com/anshumanbh/tko-subs | A tool that can help detect and takeover subdomains with dead DNS records |
| 9 | `HostileSubBruteforcer` | https://github.com/nahamsec/HostileSubBruteforcer | This app will bruteforce for existing subdomains and provide information if the 3rd party host has been properly setup. |
| 10 | `second-order` | https://github.com/mhmdiaa/second-order | Second-order subdomain takeover scanner |
| 11 | `takeover` | https://github.com/mzfr/takeover | A tool for testing subdomain takeover possibilities at a mass scale. |
| 12 | `dnsReaper` | https://github.com/punk-security/dnsReaper | DNS Reaper is yet another sub-domain takeover tool, but with an emphasis on accuracy, speed and the number of signatures in our arsenal! |
| 13 | `subzy` | https://github.com/PentestPad/subzy | Subdomain takeover tool which works based on matching response fingerprints from `can-i-take-over-xyz`. |

#### Vulnerability Scanners

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `nuclei` | https://github.com/projectdiscovery/nuclei | Nuclei is a fast tool for configurable targeted scanning based on templates offering massive extensibility and ease of use. |
| 2 | `nuclei-templates` | https://github.com/projectdiscovery/nuclei-templates | Community curated list of templates for the nuclei engine to find security vulnerabilities. |
| 3 | `Sn1per` | https://github.com/1N3/Sn1per | Automated pentest framework for offensive security experts |
| 4 | `metasploit-framework` | https://github.com/rapid7/metasploit-framework | Metasploit Framework |
| 5 | `nikto` | https://github.com/sullo/nikto | Nikto web server scanner |
| 6 | `arachni` | https://github.com/Arachni/arachni | Web Application Security Scanner Framework |
| 7 | `jaeles` | https://github.com/jaeles-project/jaeles | The Swiss Army knife for automated Web Application Testing |
| 8 | `retire.js` | https://github.com/RetireJS/retire.js | scanner detecting the use of JavaScript libraries with known vulnerabilities |
| 9 | `Osmedeus` | https://github.com/j3ssie/Osmedeus | Fully automated offensive security framework for reconnaissance and vulnerability scanning |
| 10 | `Vigolium` | https://github.com/vigolium/vigolium | High-fidelity vulnerability scanner fusing agentic AI with native speed, modularity, and precision |
| 11 | `getsploit` | https://github.com/vulnersCom/getsploit | Command line utility for searching and downloading exploits |
| 12 | `flan` | https://github.com/cloudflare/flan | A pretty sweet vulnerability scanner |
| 13 | `Findsploit` | https://github.com/1N3/Findsploit | Find exploits in local and online databases instantly |
| 14 | `BlackWidow` | https://github.com/1N3/BlackWidow | A Python based web application scanner to gather OSINT and fuzz for OWASP vulnerabilities on a target website. |
| 15 | `backslash-powered-scanner` | https://github.com/PortSwigger/backslash-powered-scanner | Finds unknown classes of injection vulnerabilities |
| 16 | `Eagle` | https://github.com/BitTheByte/Eagle | Multithreaded Plugin based vulnerability scanner for mass detection of web-based applications vulnerabilities |
| 17 | `cariddi` | https://github.com/edoardottt/cariddi | Take a list of domains, crawl urls and scan for endpoints, secrets, api keys, file extensions, tokens and more... |
| 18 | `OWASP ZAP` | https://github.com/zaproxy/zaproxy | World’s most popular free web security tools and is actively maintained by a dedicated international team of volunteers |
| 19 | `SSTImap` | https://github.com/vladko312/SSTImap | SSTImap is a penetration testing software that can check websites for Code Injection and Server-Side Template Injection vulnerabilities and exploit them, giving access to the operating system itself. |
| 20 | `Lonkero` | https://github.com/bountyyfi/lonkero | Enterprise-grade web vulnerability scanner with 60+ attack modules, built in Rust for penetration testing and security assessments. |
| 21 | `OWASP PTK` | https://github.com/DenisPodgurskii/pentestkit | Browser-based vulnerability scanner for bug bounty and pentesting workflows, combining DAST, SAST, IAST, and SCA capabilities to detect runtime, source-level, interactive, and dependency-related security issues. |

#### Permutation

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `alterx` | https://github.com/projectdiscovery/alterx | Fast and customizable subdomain wordlist generator using DSL. alterx takes patterns as input and generates subdomain permutation wordlist based on that pattern. |
| 2 | `gotator` | https://github.com/Josue87/gotator | Gotator is a tool to generate DNS wordlists through permutations. |
| 3 | `ripgen` | https://github.com/resyncgg/ripgen | Rust-based high performance domain permutation generator. |
| 4 | `dnsgen` | https://github.com/AlephNullSK/dnsgen | DNSGen is a powerful and flexible DNS name permutation tool designed for security researchers and penetration testers. It generates intelligent domain name variations to assist in subdomain discovery and security assessments. |
| 5 | `goaltdns` | https://github.com/subfinder/goaltdns | A permutation generation tool written in golang. |
| 6 | `altdns` | https://github.com/infosec-au/altdns | Generates permutations, alterations and mutations of subdomains and then resolves them. |

#### Web Proxy and Traffic Interception

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `mitmproxy` | https://github.com/mitmproxy/mitmproxy | An interactive TLS-capable intercepting HTTP proxy for penetration testers and software developers. |
| 2 | `proxify` | https://github.com/projectdiscovery/proxify | A versatile and portable proxy for capturing, manipulating, and replaying HTTP/HTTPS traffic on the go. |
| 3 | `FoxyProxy Browser Extension` | https://github.com/foxyproxy/browser-extension | FoxyProxy is an open-source, advanced proxy management tool that completely replaces Chrome's limited proxying capabilities. |
| 4 | `zaproxy` | https://github.com/zaproxy/zaproxy | ZAP is what is known as a “manipulator-in-the-middle proxy.” It stands between the tester’s browser and the web application so that it can intercept and inspect messages sent between browser and web application, modify the contents if needed, and then forward those packets on to the destination. |
| 5 | `hetty` | https://github.com/dstotijn/hetty | hetty is a free opensource alternative to Burpsuite pro |

#### Origin IP

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `CloudRip` | https://github.com/staxsum/CloudRip | A tool that helps you find the real IP addresses hiding behind Cloudflare by checking subdomains. |
| 2 | `hakoriginfinder` | https://github.com/hakluke/hakoriginfinder | Tool for discovering the origin host behind a reverse proxy. Useful for bypassing WAFs and other reverse proxies. |

#### Useful

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `anew` | https://github.com/tomnomnom/anew | A tool for adding new lines to files, skipping duplicates |
| 2 | `gf` | https://github.com/tomnomnom/gf | A wrapper around grep, to help you grep for things |
| 3 | `uro` | https://github.com/s0md3v/uro | declutters url lists for crawling/pentesting |
| 4 | `unfurl` | https://github.com/tomnomnom/unfurl | Pull out bits of URLs provided on stdin |
| 5 | `qsreplace` | https://github.com/tomnomnom/qsreplace | Accept URLs on stdin, replace all query string values with a user-supplied value |
| 6 | `interactsh` | https://github.com/projectdiscovery/interactsh | Interactsh is an open-source tool for detecting out-of-band interactions. It is a tool designed to detect vulnerabilities that cause external interactions. |
| 7 | `CyberChef` | https://github.com/gchq/CyberChef | The Cyber Swiss Army Knife - a web app for encryption, encoding, compression and data analysis |
| 8 | `notify` | https://github.com/projectdiscovery/notify | Notify is a Go-based assistance package that enables you to stream the output of several tools (or read from a file) and publish it to a variety of supported platforms. |

#### AI Agents

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `shannon` | https://github.com/KeygraphHQ/shannon | Fully autonomous AI hacker to find actual exploits in your web apps. |
| 2 | `Darkmoon` | https://github.com/ASCIT31/Dark-Moon | Open source (GPL-3.0) autonomous AI penetration testing platform that orchestrates 80+ tools over MCP with dedicated per-technology offensive sub-agents (GraphQL, Spring Boot, ASP.NET, Node.js, Flask, PHP, Ruby) and a per-finding evidence trail. |
| 3 | `PentestGPT` | https://github.com/GreyDGL/PentestGPT | AI-powered penetration testing assistant that helps automate security testing workflows and vulnerability discovery. |
| 4 | `Agentic Bug Bounty Hunter` | https://github.com/Awarexone/Agentic-Bug-Hunter | Claude Code plugin for autonomous bug bounty hunting across HackerOne, Bugcrowd, Intigriti and Immunefi — 15 skills, 33 commands and 9 agents covering recon-to-report, 21 web vuln classes, web3/meme-coin audits, LLM red-teaming, GraphQL/CORS/JWT/NoSQL scanners and persistent hunt memory. Works with or without a subscription. |

### Uncategorized（大分類）

| # | ツール | URL | 原文の説明（逐語・英語のまま） |
|---|--------|-----|--------------------------------|
| 1 | `ARS3NAL` | https://github.com/inflictx/Arsenal | Offline-first, searchable arsenal for pentest & bug bounty: ~1500 payloads, a click-to-build command generator, GTFOBins, wordlists, an embedded CyberChef, reverse shells and 70 checklists. Self-hosted web app with a live static demo. |
| 2 | `RF Swift` | https://github.com/PentHertz/RF-Swift | A powerful multi-platform RF toolbox that deploys specialized radio tools in seconds on Linux, Windows, and macOS—supporting x86_64, ARM64 (Raspberry Pi, Apple Silicon), and RISC-V architectures without disrupting your primary OS. |
| 3 | `bountyplz` | https://github.com/fransr/bountyplz | Automated security reporting from markdown templates (HackerOne and Bugcrowd are currently the platforms supported) |
| 4 | `PayloadsAllTheThings` | https://github.com/swisskyrepo/PayloadsAllTheThings | A list of useful payloads and bypass for Web Application Security and Pentest/CTF |
| 5 | `bounty-targets-data` | https://github.com/arkadiyt/bounty-targets-data | This repo contains hourly-updated data dumps of bug bounty platform scopes (like Hackerone/Bugcrowd/Intigriti/etc) that are eligible for reports |
| 6 | `android-security-awesome` | https://github.com/ashishb/android-security-awesome | A collection of android security related resources |
| 7 | `awesome-mobile-security` | https://github.com/vaib25vicky/awesome-mobile-security | An effort to build a single place for all useful android and iOS security related stuff. |
| 8 | `awesome-vulnerable-apps` | https://github.com/vavkamil/awesome-vulnerable-apps | Awesome Vulnerable Applications |
| 9 | `SecLists` | https://github.com/danielmiessler/SecLists | It's a collection of multiple types of lists used during security assessments, collected in one place. List types include usernames, passwords, URLs, sensitive data patterns, fuzzing payloads, web shells, and many more. |
| 10 | `asnmap` | https://github.com/projectdiscovery/asnmap | Go CLI and Library for quickly mapping organization network ranges using ASN information. |
| 11 | `mapcidr` | https://github.com/projectdiscovery/mapcidr | Utility program to perform multiple operations for a given subnet/CIDR ranges. |
| 12 | `BigBountyRecon` | https://github.com/Viralmaniar/BigBountyRecon | BigBountyRecon tool utilises 58 different techniques using various Google dorks and open source tools to expedite the process of initial reconnaissance on the target organisation. |
| 13 | `Bypass bot detection` | https://github.com/portswigger/bypass-bot-detection | Burp Suite extension that mutates ciphers to bypass TLS-fingerprint based bot detection. |
| 14 | `cvemap` | https://github.com/projectdiscovery/cvemap | Modern CLI for exploring vulnerability data with powerful search, filtering, and analysis capabilities. |
| 15 | `cut-cdn` | https://github.com/ImAyrix/cut-cdn | Removing CDN IPs from the list of IP addresses. |
| 16 | `ds_store_exp` | https://github.com/lijiejie/ds_store_exp | A .DS_Store file disclosure exploit. It parses .DS_Store file and downloads files recursively. |

---

## 詳細ノート: ch04向けの読み解き（JavaScript / recon ツールの体系化）

〔補足（一般知識）〕以下の「役割」「典型的な使いどころ」「ツール間の関係」は、READMEの1行説明と各ツールの一般に知られた用途に基づく整理である。READMEに書かれていない機能は断定せず、一般知識に基づく補足には行頭に〔補足（一般知識）〕を付ける。

### 4-1. クライアントサイド脆弱性ハンティングでの「JavaScript攻撃面」ツール群

このリストで最もch04（クライアントサイド脆弱性ハンティングの教科書）に直結するのが **Links** サブカテゴリ（17件）と **Secrets** サブカテゴリ（29件）の一部、そして **Technologies** の retire.js である。JavaScript を起点とした攻撃面把握は次の3段階に分解できる。

**(A) JSファイルの収集（どのJSが存在するか）**
- `getJS`（https://github.com/003random/getJS） — "A tool to fastly get all javascript sources/files"。ページからJSのソース/ファイルURLを高速に列挙。
- `subjs` — 〔補足（一般知識）〕本READMEには**未収録**（担当タスクの重点リストにあるが原文には存在しない。存在しないものを収録済みと書かない）。同種の役割は getJS が担う。
- `waybackurls`（https://github.com/tomnomnom/waybackurls） — "Fetch all the URLs that the Wayback Machine knows about for a domain"。過去に存在した（今は消えた）JSやエンドポイントもWayback Machineから拾える点がクライアントサイド調査で重要。
- `gau`（https://github.com/lc/gau） — "Fetch known URLs from AlienVault's Open Threat Exchange, the Wayback Machine, and Common Crawl."。複数のURL履歴ソースを統合。
- `waymore`（https://github.com/xnl-h4ck3r/waymore） — "Find way more from the Wayback Machine!"。waybackurlsの上位互換的な網羅取得。
- `URLFinder`（https://github.com/projectdiscovery/urlfinder） — "A high-speed tool for passively gathering URLs, optimized for efficient web asset discovery without active scanning."（ProjectDiscovery製の受動的URL収集）。
- `github-endpoints`（https://github.com/gwen001/github-endpoints） — "This Go tool performs searches on GitHub and parses the results to find endpoints of a given domain."（GitHub検索からエンドポイントを抽出）。

**(B) JS本文からのエンドポイント/パス/パラメータ抽出（クロールとパース）**
- `LinkFinder`（https://github.com/GerbenJavado/LinkFinder） — "A python script that finds endpoints in JavaScript files"。**このジャンルの定番**。正規表現でJS中のパス文字列を掘り出す。
- `GoLinkFinder`（https://github.com/0xsha/GoLinkFinder） — "A fast and minimal JS endpoint extractor"（LinkFinderのGo実装）。
- `BurpJSLinkFinder`（https://github.com/InitRoot/BurpJSLinkFinder） — "Burp Extension for a passive scanning JS files for endpoint links."（Burp拡張、受動スキャン）。
- `xnLinkFinder`（https://github.com/xnl-h4ck3r/xnLinkFinder） — "A python tool used to discover endpoints, potential parameters, and a target specific wordlist for a given target"。エンドポイントだけでなく**潜在パラメータとターゲット固有ワードリスト**まで生成する点が強力。
- `jsluice`（https://github.com/BishopFox/jsluice） — "This tool extracts URLs, paths, secrets, and other interesting bits from JavaScript files. Values are extracted based not just on how they look, but also based on how they are used."。**「見た目」だけでなく「使われ方」に基づいて抽出**するのが他ツールとの決定的な違い（AST/構文木ベース）。ch04で「なぜ正規表現ベースだと取りこぼすか」を語るときの主役。
- `linx`（https://github.com/riza/linx） — "Reveals invisible links within JavaScript files"（JS内の見えないリンクを可視化）。
- `urlgrab`（https://github.com/IAmStoxe/urlgrab） — "A golang utility to spider through a website searching for additional links."
- `LinksDumper`（https://github.com/arbazkiraak/LinksDumper） — "Extract (links/possible endpoints) from responses & filter them via decoding/sorting"。
- `JS-Scan`（https://github.com/zseano/JS-Scan） — "a .js scanner, built in php. designed to scrape urls and other info"。
- `jsfinder`（https://github.com/kacakb/jsfinder） — "A tool that scans web pages to find JavaScript file URLs linked in the HTML source code."（(A)寄り: HTMLからJS URLを列挙）。
- `jsleak`（https://github.com/byt3hx/jsleak） — "jsleak is a tool to find secret , paths or links in JavaScript files or source code."（(B)+(C)両対応）。

**(C) JS内シークレット/APIキー検出（Secretsサブカテゴリ）**
- `SecretFinder`（https://github.com/m4ll0k/SecretFinder） — "A python script for finding sensitive data (apikeys, accesstoken,jwt,..) and search anything on javascript files."。**JSファイル専用のシークレット検出の定番**。
- `keyFinder`（https://github.com/momenbasel/keyFinder） — "A Chrome extension that passively scans web pages for API keys, tokens, and secrets using 80+ regex patterns and Shannon entropy analysis across 10 attack surfaces."（80以上の正規表現 + シャノンエントロピー、ブラウザ拡張）。
- `keyhacks`（https://github.com/streaak/keyhacks） — "KeyHacks shows methods to validate different API keys found on a Bug Bounty Program or a pentest."。**見つけたキーが本物か検証する手順集**。抽出だけでなく「そのキーで何ができるか」を確認する後工程を担う。
- `js-snitch`（https://github.com/vavkamil/js-snitch） — "Scans remote JavaScript files with Trufflehog + Semgrep to detect leaked secrets."（リスト作者 vavkamil 自身のツール。Trufflehog + Semgrep を JS に適用）。
- `cariddi`（https://github.com/edoardottt/cariddi） — "Take a list of domains, crawl urls and scan for endpoints, secrets, api keys, file extensions, tokens and more..."（クロール + secrets + endpoints を1本で。ReconとSecretsの橋渡し）。
- `truffleHog`（https://github.com/dxa4481/truffleHog） — "Searches through git repositories for high entropy strings and secrets, digging deep into commit history"。**注意: このリストの truffleHog エントリは `dxa4481/truffleHog`（旧版）で、Gitコミット履歴向けの説明**。現行の `trufflehog`（trufflesecurity版）という名称は本リストの見出しには無く、代わりに `Trufflehog-Chrome-Extension`（https://github.com/trufflesecurity/Trufflehog-Chrome-Extension）が別項目として載る。
- `mantra` / `trufflehog`（trufflesecurity/trufflehog本体）/ `JSScanner` — 〔補足（一般知識）〕いずれも本READMEには**未収録**（担当タスクの重点リストに名前があるが原文検索で0件。捏造を避けるため「載っている」とは書かない）。

**(D) クロール基盤（(A)(B)の入口になる汎用スパイダー）** — Content Discovery サブカテゴリ
- `katana`（https://github.com/projectdiscovery/katana） — "A next-generation crawling and spidering framework"。**JSクロール・ヘッドレス対応の次世代クローラ**。ch04では「SPAのJSを実行してエンドポイントを引き出す」文脈で中心。
- `hakrawler`（https://github.com/hakluke/hakrawler） — "Simple, fast web crawler designed for easy, quick discovery of endpoints and assets within a web application"。
- `gospider`（https://github.com/jaeles-project/gospider） — "Gospider - Fast web spider written in Go"。
- `crawley`（https://github.com/s0rg/crawley） — "fast, feature-rich unix-way web scraper/crawler written in Golang."
- `gau` / `waybackurls`（前掲、受動的URL収集としてこの入口にも該当）。

**(E) 既知脆弱性を持つJSライブラリの検出** — Technologies
- `retire.js`（https://github.com/RetireJS/retire.js） — "scanner detecting the use of JavaScript libraries with known vulnerabilities"。**フロントの依存ライブラリのCVE検出**。ch04の「サードパーティJSの脆弱性」節で必須。

### 4-2. postMessage / DOM XSS 系（クライアントサイド固有）

- `postMessage-tracker`（https://github.com/fransr/postMessage-tracker） — "A Chrome Extension to track postMessage usage (url, domain and stack) both by logging using CORS and also visually as an extension-icon"。**postMessageの呼び出し箇所（URL・ドメイン・スタック）を追跡**するブラウザ拡張。クロスオリジンメッセージングの脆弱性調査の起点。
- `PostMessage_Fuzz_Tool`（https://github.com/kiranreddyrebel/PostMessage_Fuzz_Tool） — "#BugBounty #BugBounty Tools #WebDeveloper Tool"（説明はハッシュタグのみ。postMessageのファジング用）。
- DOM系XSSツール（XSS Injectionサブカテゴリ内、クライアントサイド直結）:
  - `tracy`（https://github.com/nccgroup/tracy） — "A tool designed to assist with finding all sinks and sources of a web application and display these results in a digestible manner."。**source/sink（源泉/沈点）を洗い出す**思想はch04のDOM XSS理論そのもの。
  - `findom-xss`（https://github.com/dwisiswant0/findom-xss） — "A fast DOM based XSS vulnerability scanner with simplicity."
  - `domdig`（https://github.com/fcavallarin/domdig） — "DOM XSS scanner for Single Page Applications"（SPA向けDOM XSSスキャナ）。
  - `domxssscanner`（https://github.com/yaph/domxssscanner） — "DOMXSS Scanner is an online tool to scan source code for DOM based XSS vulnerabilities"。
  - `dom-based-xss-finder`（https://github.com/AsaiKen/dom-based-xss-finder） — "Chrome extension that finds DOM based XSS vulnerabilities"。
  - `dom-red`（https://github.com/Naategh/dom-red、Open Redirect節） — "Small script to check a list of domains against open redirect vulnerability"。
- Blind XSS（out-of-band 検知）系: `xsshunter` / `ezXSS` / `bXSS` / `xss-flare` / `BitBlinder` / `femida` / `xsshunter_client` / `B-XSSRF` / `vaya-ciego-nen`。ch04の「Blind XSSの検知にはコールバックサーバが要る」を裏づける実物リスト。

### 4-3. CORS / CSP バイパス（クライアントサイド境界）

- CORS Misconfiguration（5件）: `Corsy`, `Corser`, `CORStest`, `cors-scanner`, `CorsMe`。いずれも "CORS misconfiguration scanner" 系。
- CSPバイパス: `JSONBee`（https://github.com/zigoo0/JSONBee） — "A ready to use JSONP endpoints/payloads to help bypass content security policy (CSP) of different websites."、`CSPBypass`（https://github.com/renniepak/CSPBypass） — ホワイトリスト型CSPを突破してXSSにつなげる。ch04の「CSPはXSSの緩和であって根絶ではない」節の教材。

### 4-4. パイプライン設計（stdin/stdout でつなぐ小道具）— Useful

ch04で「収集→整形→検査」を1行のパイプで組む思想を教えるなら、Usefulサブカテゴリが核心。
- `anew`（https://github.com/tomnomnom/anew） — "A tool for adding new lines to files, skipping duplicates"（差分だけ追記＝新規発見の抽出）。
- `gf`（https://github.com/tomnomnom/gf） — "A wrapper around grep, to help you grep for things"（パターン集をgrepに与える。gf-patternsでXSS/SSRF/redirect候補パラメータを抽出）。
- `uro`（https://github.com/s0md3v/uro） — "declutters url lists for crawling/pentesting"（URLリストの重複・ノイズ除去）。
- `unfurl`（https://github.com/tomnomnom/unfurl） — "Pull out bits of URLs provided on stdin"（URLからドメイン/パス/パラメータ名などを切り出す）。
- `qsreplace`（https://github.com/tomnomnom/qsreplace） — "Accept URLs on stdin, replace all query string values with a user-supplied value"（全クエリ値をペイロードに一括置換＝反射確認の量産）。
- `interactsh`（https://github.com/projectdiscovery/interactsh） — "Interactsh is an open-source tool for detecting out-of-band interactions..."（OOB相互作用検知。Blind XSS/SSRF/XXEのコールバック受け）。
- `notify`（https://github.com/projectdiscovery/notify） — ツール出力をSlack等へ流す通知パイプ。
- `CyberChef`（https://github.com/gchq/CyberChef） — "The Cyber Swiss Army Knife"（エンコード/デコード/解析のGUI万能ナイフ）。

〔補足（一般知識）〕典型的な連鎖例（本READMEのツールのみで構成、防御・許可済み診断前提）: `waybackurls target.com | uro | gf xss | qsreplace '"><svg onload=alert(1)>' | httpx -silent` のように、収集(gau/waybackurls)→整形(uro/gf)→ペイロード注入(qsreplace)→到達確認(httpx)を1行でつなぐのが本リストの道具立ての意図するワークフローである。

### 4-5. Vulnerability Scanners の中核: nuclei

- `nuclei`（https://github.com/projectdiscovery/nuclei） — "Nuclei is a fast tool for configurable targeted scanning based on templates offering massive extensibility and ease of use."
- `nuclei-templates`（https://github.com/projectdiscovery/nuclei-templates） — "Community curated list of templates for the nuclei engine to find security vulnerabilities."
ch04でも「収集したエンドポイント群に対しテンプレートベースで既知脆弱性を当てる」最終段としてnucleiが位置づく。

## 原文の不整合・注意点（教科書執筆時に転記すべき注意）

READMEを逐語で読むと、原文にいくつかの誤記・不整合がある。教科書に引用する際に注意すべき点として記録する（**修正はせず、原文が誤っている事実を明記する**方針）。

1. **目次と本文のずれ**: 目次(Contents)では Exploitation 配下に `Cache Poisoning` と表記されアンカーは `#Web-Cache-Poisoning`。本文の見出しは `### Web-Cache-Poisoning`。また本文には目次に無い `### SSTI Injection`（tplmap, SSTImap）が存在する。逆に目次の `Forbidden Bypass`（Miscellaneous配下）は本文では独立見出しが無く、`### Waf Evasion`（Recon配下）に `Forbidden Buster` 等がまとまっている。
2. **重複エントリ（同一URLが複数カテゴリに再掲）**: 以下は意図的なクロスリスト。`ground-control`（×3: SSRF/XSS/XXE）、`B-XSSRF`（×3: SSRF/XSS/XXE）、`Injectus`（×2: CRLF/Open Redirect）、`retire.js`（×2: Technologies/Vulnerability Scanners）、`httprebind`（×2: SSRF内で2回）、`cariddi`（×2: Secrets/Vulnerability Scanners）、`altdns`（×2: Subdomain Enumeration/Permutation）、`SSTImap`（×2: SSTI/Vulnerability Scanners）、`docem`（×2: XSS/XXE）、`zaproxy`（×2: Web Proxy … では ZAP の別記述）。→ 総エントリ412件だがユニークURLは400件。
3. **リンク先の軽微な誤り**: `smugglex` の行だけ Markdown リンクが壊れており `[smugglex](github.com/hahwul/smugglex)` と `https://` が欠落している（原文ママ）。`crt.go` は表示名とURL(`TaurusOmar/crt.sh`)が食い違う。`param-miner` の説明に "web alterx poisoning vulnerabilities" とあるが、これは原文の誤記とみられる（一般には web cache poisoning）。→ **教科書では原文引用しつつ〔補足〕で訂正を添えるのが安全**。
4. **説明文中のタイポ（原文ママで保持）**: `dns-parallel-prober` の説明冒頭 "his is a parallelised…"（"This"のTが欠落）、Screenshots等いくつかで軽微な英語タイポあり。逐語再現の表ではこれらを**訂正せずそのまま**残してある。
5. **担当タスクの重点リストにあるが本READMEに存在しないツール**: `subjs`, `JSScanner`, `mantra`, `trufflehog`（trufflesecurity版の本体、ただし派生の Chrome拡張と旧 dxa4481/truffleHog は収録）は、原文検索で本文に見つからなかった。**「このリストに載っている」と書いてはならない**（別の有名リストには載るが本URLの範囲外）。

## contributing.md（全文・逐語）

出典: https://raw.githubusercontent.com/vavkamil/awesome-bugbounty-tools/HEAD/contributing.md

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

（内容は awesome-list テンプレートのプレースホルダそのままで、収録基準の技術的な定義はない。＝このリストは「厳選(curated)」を名乗るが**明文化された収録基準は無い**という事実として記録。）

## 読者が自分で開くべき資料

このノートはREADME全文をfullで再現しているが、リストは「リンク集」であり各ツールの**使い方・オプション・実際の出力**は個々のリポジトリを開かないと分からない。読者（＝教科書執筆者および学習者）が自分でアクセスすべき箇所と読みどころ:

- **本体 README（https://github.com/vavkamil/awesome-bugbounty-tools）** — 読みどころ:
  1. カテゴリ体系そのもの（Recon / Exploitation / Miscellaneous の3分類）を「バグバウンティ作業のメンタルモデル」として俯瞰する。
  2. `Links` と `Secrets` サブカテゴリ = クライアントサイド(JS)攻撃面ツールの一次索引として使う。
  3. `Useful` サブカテゴリ = tomnomnom系パイプライン道具（anew/gf/uro/unfurl/qsreplace）の起点。
  4. `AI Agents` サブカテゴリ = 2026年時点の自律型ペンテストの新潮流を確認。
  5. star/fork数は本ノート記載のAPI値（6,265 / 999）を参照。リスト自体の更新頻度（pushed_at 2026-09-02）から「今も生きているカタログ」であることを確認。

- **クライアントサイド重点ツールの個別リポジトリ**（教科書ch04を書くなら必ず一次ソースを開くべき）:
  1. `jsluice`（BishopFox） — READMEの「使われ方に基づく抽出（AST）」の具体例と、`jsluice urls` / `jsluice secrets` サブコマンドの実挙動。正規表現ベースとの精度差を自分の目で確認。
  2. `katana`（ProjectDiscovery） — ヘッドレス/JSクロール(`-jc`, `-headless`)のオプション、SPAでのエンドポイント抽出の実例。
  3. `LinkFinder` / `xnLinkFinder` — 使用する正規表現パターン（何を「エンドポイントらしい」と判定するか）を読む。取りこぼしの理由を理解するのに必須。
  4. `SecretFinder` / `keyFinder` / `keyhacks` — どの正規表現でどのサービスのキーを拾うか、そして keyhacks で「拾ったキーの検証コマンド」を確認。
  5. `postMessage-tracker` / `tracy` — source/sink 追跡のUIと出力形式。DOM XSS理論を実務に落とす具体像。
  6. `retire.js` — 脆弱ライブラリDBの形式と、CI/ブラウザ拡張/CLIの3形態。

- **取得できなかったGitHub Web UI（HTML 403）について** — 星数・fork数・最終更新・issue数などの「今この瞬間の数値」はREADMEには載らない。読者が最新値を知りたい場合はブラウザで直接リポジトリのトップページを開く（本ノートのAPI値は2026-09-18時点のスナップショット）。読みどころ: Issues/Pull requestsタブで「収録待ち・却下されたツール」の議論を見ると、コミュニティが何を「バグバウンティ向け」と見なすかの生きた基準が読める。

- **横断的に併読すべき外部資料（本リスト内で言及されている、教材性が高いもの）**:
  1. `PayloadsAllTheThings`（swisskyrepo） — "A list of useful payloads and bypass for Web Application Security and Pentest/CTF"。ペイロード事典。ツールが吐く前に「何を撃つか」の辞書。
  2. `SecLists`（danielmiessler） — ワードリスト/パターンの総本山。Content Discovery/Fuzzingの燃料。
  3. `bounty-targets-data`（arkadiyt） — "hourly-updated data dumps of bug bounty platform scopes"。スコープ(対象範囲)の一次データ。
  4. `can-i-take-over-xyz`（EdOverflow） — サブドメインテイクオーバの可否判定リファレンス。
  5. `keyhacks`（streaak） — 見つけたAPIキーの悪用可否検証手順（クライアントサイド調査の後工程）。
