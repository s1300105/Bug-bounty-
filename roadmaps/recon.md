# Reconを武器化する：バグバウンティ偵察の段階的学習ロードマップ

## TL;DR

- Reconを「武器」にする分岐点は、①資産発見（ASN/買収/インターネット規模データソース/favicon相関）で誰よりも広い攻撃面を描くこと、②自動化パイプライン化で継続的にスケールさせること、③継続監視（差分検知）で新資産を最速で掴むこと、の3領域を厚く鍛えることにある。
- 学習は11段階で構成する。Lv1〜3（マインドセット/資産発見/サブドメイン列挙）が土台、Lv4〜8（インターネット規模データ/コンテンツ・パラメータ/JS/OSINT・GitHub・クラウド/歴史データ）が差別化の中核、Lv9〜11（自動化/継続監視/方法論・実例）が武器化の決定打。
- 2次資料中心で構成した。The Bug Hunter's Methodology（Jason Haddix）、Assetnote/ProjectDiscoveryのブログ、NahamSec/TomNomNomのコンテンツ、Intigriti/YesWeHackの教育記事、HackTricksのExternal Recon Methodologyを軸に、各段階で多数のURLを提示する。

## Key Findings

- 「wide recon（広く資産を掘る）」と「targeted recon（狙って深掘る）」の両輪を、breadth-first（幅優先）の思考プロセスで回すのが現代のRecon方法論の核。TBHM v4（Jason Haddix）がこの思考の基準になっている。
- 資産発見では、ASN→CIDR→IPレンジ、reverse WHOIS、買収・子会社マッピング（horizontal/vertical enumeration）が、他人が到達しない資産を掘り当てる最大の差別化ポイント。
- サブドメイン列挙は passive（CT/crt.sh・パッシブDNS）→ active（massdns/puredns によるブルートフォース＋ワイルドカード処理）→ permutation（alterx/dnsgen）の3層を必ず連結する。
- インターネット規模のデータソース（Shodan/Censys/FOFA/Netlas）と favicon hash 相関は、DNSベースの列挙では見えないクラウド資産・origin IPを掘り当てる強力な手段。favicon hashは、Shodanが約10年前に導入した手法で、favicon画像をMurmurHash3（mmh3）でハッシュ化し `http.favicon.hash` フィルタで検索する（Shodan公式ブログ blog.shodan.io/deep-dive-http-favicon：「The favicon hash is calculated by applying the MurmurHash3 algorithm to the http.favicon.data property on the banner.」。Base64エンコード後にハッシュ化する点が実装上の注意）。
- 自動化（ProjectDiscoveryツール群、reconFTW/Osmedeus/reNgine）と分散スケーリング（Axiom）、そして継続監視（certstream/sublert、notifyによる差分通知）こそが「Recon自体が武器になる」レベルへの到達条件。

## Details

### Lv1. Reconのマインドセットと全体像

**なぜ必要か**：Reconは単なる手順ではなく「攻撃面（attack surface）を誰よりも広く・深く把握する思考様式」。ここが弱いと、以降のツールを使っても他人と同じ資産しか見つけられない。wide recon と targeted recon の使い分け、スコープ理解、メモ運用（XMind等のツリー構造）の思想を最初に固める。
**習得できること**：breadth-first のrecon思考、スコープの読み方、資産管理・ノート運用の型。

- The Bug Hunter's Methodology v4.01 recon editionのまとめノート：https://www.trickster.dev/post/notes-on-tbhm-v4-recon-edition/
- TBHM v4 Recon Edition（Class Central経由のトーク紹介）：https://www.classcentral.com/course/youtube-the-bug-hunter-s-methodology-v4-0-recon-edition-by-atjhaddix-nahamcon2020-179250
- TBHM GitHubリポジトリ（Jason Haddix公式・補助）：https://github.com/jhaddix/tbhm
- TBHM Core（Arcanum、有料コースの構成理解用）：https://arcanum-sec.com/training/the-bug-hunters-methodology/
- NahamSec「The Truth About Recon」（recon思考7つのTips）：https://www.classcentral.com/course/youtube-the-truth-about-recon-bug-bounty-tips-179355
- NahamSec「Getting Started in Bug Bounty」：https://www.nahamsec.com/getting-started-in-bug-bounty
- Recon Methodology（Finding Attack Surface Others Miss）：https://bug-bounties.as93.net/learn/bug-bounty-recon-methodology/
- 日本語：morioka12「実践的なバグバウンティ入門」（Speaker Deck）：https://speakerdeck.com/scgajge12/shi-jian-de-nabagubaunteiru-men
- 日本語：morioka12「バグバウンティ入門(始め方)」：https://scgajge12.hatenablog.com/entry/bugbounty_beginner

### Lv2. 資産発見（Asset Discovery）／組織全体マッピング（★武器化の核）

**なぜ必要か**：ここが「Recon自体が武器になる」最大の分岐点。ルート/シード資産の特定、買収・子会社のマッピング（horizontal correlation）、ASN→IP空間（vertical）を押さえれば、他人が対象にすらしていない資産に到達できる。
**習得できること**：ASN列挙（bgp.he.net）、reverse WHOIS、買収調査（Crunchbase等）、apex/rootドメインの網羅的発見。

- HackTricks「External Recon Methodology」（ASN・reverse whois・CT・買収・dmarcまで体系的）：https://book.hacktricks.wiki/en/generic-methodologies-and-resources/external-recon-methodology/index.html
- Bug Bounty Methodology — Horizontal Enumeration（ASN/horizontal相関の実践）：https://apexvicky.medium.com/bug-bounty-methodology-horizontal-enumeration-89f7cd172e6e
- Bug Bounty Recon: CIDR, ASN & Subdomain Enumeration Guide：https://sinhaamrit.medium.com/bug-bounty-recon-cidr-asn-subdomain-enumeration-guide-25c447af9c40
- Ultimate Reconnaissance RoadMap（Ahmad Halabi、WHOIS/DNS/買収の考え方）：https://ahmdhalabi.medium.com/ultimate-reconnaissance-roadmap-for-bug-bounty-hunters-pentesters-507c9a5374d
- My Recon Methodology ep1（amass intelでのシード拡張）：https://medium.com/@realm3ter/my-recon-methodology-ep-1-bc9e6fd660ad
- Selecting the Right Bug Bounty Targets & Reconnaissance（買収・WHOIS相関）：https://dev.to/trumpiter/selecting-the-right-bug-bounty-targets-reconnaissance-276
- OWASP Amass 詳解チュートリアル（intel＝reverse whois/ASN、enum）：https://dionach.com/how-to-use-owasp-amass-an-extensive-tutorial/
- Intigriti「Hacker tools: Amass – hunting for subdomains」：https://www.intigriti.com/researchers/blog/hacking-tools/hacker-tools-amass-hunting-for-subdomains
- Assetnote「Continuous Asset Discovery」（ASMの資産発見思想を学ぶ）：https://www.assetnote.io/platform/asset-discovery

### Lv3. サブドメイン列挙を深く（passive/active/permutation）

**なぜ必要か**：資産発見の解像度を上げる中核作業。passive/active/permutationの3層を連結し、ワイルドカード処理とリゾルバ運用を正しく行えるかで、拾える資産量が桁違いに変わる。
**習得できること**：CT/crt.shとパッシブDNSの活用、massdns/purednsによる大規模ブルートフォース、ワイルドカード検出、alterx/dnsgenによるpermutation、リゾルバリスト運用。

- ProjectDiscovery「Reconnaissance 102: Subdomain Enumeration」：https://projectdiscovery.io/blog/recon-series-2
- The Definitive Guide to Subdomain Enumeration（passive→active→permutationの連結）：https://medium.com/@tanvir.infosec/the-definitive-guide-to-subdomain-enumeration-e2c04476ef27
- Subdomain Enumeration Guide（GitBook, sidxparab）DNS Bruteforcing：https://sidxparab.gitbook.io/subdomain-enumeration-guide/active-enumeration/dns-bruteforcing
- Subdomain Enumeration Guide（自動化章、Axiom連携）：https://sidxparab.gitbook.io/subdomain-enumeration-guide/automation
- puredns（massdnsラッパー、ワイルドカード処理の要点確認・補助）：https://github.com/d3mondev/puredns
- Trickest resolvers（有効リゾルバリスト・補助）：https://github.com/trickest/resolvers
- Mastering Subdomain Enumeration with Amass（Vivek Bhatt）：https://medium.com/@vivekbhatt2002/mastering-subdomain-enumeration-with-amass-a-complete-guide-for-ethical-hackers-276d6e915e51
- 日本語：サブドメイン列挙 手順と実例まとめ（Qiita）：https://qiita.com/nozomi2025/items/48f4e5ad6ebf5d79238f

### Lv4. インターネット規模のデータソース活用（★他人と差がつく領域）

**なぜ必要か**：クラウド資産や origin IP はDNS列挙だけでは見えない。Shodan/Censys/FOFA/Netlasのクエリ技法と favicon hash（mmh3）相関を使うことで、他人が見つけられない露出資産にたどり着ける。favicon hashは、faviconをMurmurHash3でハッシュ化し `http.favicon.hash` で検索する手法で、Shodan公式ブログが「The favicon hash is calculated by applying the MurmurHash3 algorithm to the http.favicon.data property on the banner.」と説明している。
**習得できること**：各スキャンDBのクエリ演算子、ssl/org/http.title等のフィルタ、favicon hashによる資産クラスタリング、証明書相関。

- Intigriti「Shodan & Censys for beginners: How to find more vulnerabilities」：https://www.intigriti.com/researchers/blog/hacking-tools/complete-guide-to-finding-more-vulnerabilities-with-shodan-and-censys
- Payatu「How to find assets using Favicon Hashes?」：https://payatu.com/blog/favicon-hash/
- Devansh Batham「Weaponizing favicon.ico for BugBounties, OSINT」（FavFreak）：https://medium.com/@Asm0d3us/weaponizing-favicon-ico-for-bugbounties-osint-and-what-not-ace3c214e139
- SANS ISC「Hunting phishing websites with favicon hashes」（mmh3の仕組み理解）：https://isc.sans.edu/diary/27326
- Using search engines for fun and bounties（Shodan ssl/orgフィルタの活用）：https://archive.0x00sec.org/t/using-search-engines-for-fun-and-bounties/23832
- awesome-ip-search-engines（Shodan/Censys/FOFA/ZoomEye/Netlasの学習リンク集）：https://github.com/cipher387/awesome-ip-search-engines
- Shodan Search Queries Cheat Sheet：https://vespersec.net/docs/osint-reconnaissance/shodan-search-queries-cheat-sheet/
- Censys Device Search Cheat Sheet：https://vespersec.net/docs/osint-reconnaissance/censys-device-search-cheat-sheet/

### Lv5. コンテンツ／パラメータ／APIエンドポイント発見を深く

**なぜ必要か**：発見した各ホストの内部攻撃面を掘る作業。賢いワードリスト運用、再帰・拡張子・フィルタリング、隠しパラメータ、Swagger/GraphQL発見までできると、リンクされていない入口を掘り当てられる。
**習得できること**：ffuf/feroxbufferの実践、Assetnote/SecListsワードリストの使い分け、arjun/Param Miner、Swagger/OpenAPI・GraphQL introspection。

- ffuf & feroxbuster 実践ガイド（ワードリスト戦略・再帰・フィルタ）：https://payloadplayground.com/blog/content-discovery-with-ffuf
- Ott3rly「Content Discovery With FFUF」：https://ott3rly.com/find-sensitive-files-with-ffuf/
- YesWeHack「Discover & map hidden endpoints & parameters」：https://www.yeswehack.com/learn-bug-bounty/discover-map-hidden-endpoints-parameters
- Assetnote wordlists（コンテンツ発見用ワードリスト・補助）：https://wordlists.assetnote.io/
- Web Content Discovery（Pentest List Wiki、feroxbuster/kiterunner設定例）：https://wiki.pentestlist.com/offensive-security/web-application/discovery/web-content-discovery
- Intigriti「Finding Hidden Parameters: Advanced Enumeration Guide」（Arjun/x8/Param Miner比較）：https://www.intigriti.com/researchers/blog/hacking-tools/finding-hidden-input-parameters
- Intigriti「Hacker tools: Arjun」：https://www.intigriti.com/researchers/blog/hacking-tools/hacker-tools-arjun-the-parameter-discovery-tool
- YesWeHack「Quick Guide to Start Parameter Discovery」：https://www.yeswehack.com/learn-bug-bounty/parameter-discovery-quick-guide-to-start
- Hunting for Hidden Parameters in Burp Suite（Param Miner実践）：https://medium.com/fmisec/hunting-for-hidden-parameters-in-burp-suite-98b54616f863
- Dana Epp「Finding hidden API parameters」：https://danaepp.com/finding-hidden-api-parameters
- YesWeHack「Hacking GraphQL endpoints」（introspection/InQL）：https://www.yeswehack.com/learn-bug-bounty/hacking-graphql-endpoints
- How I Hunt for Swagger UI on Real Targets：https://medium.com/@MuhammedAsfan/how-i-hunt-for-swagger-ui-on-real-targets-a-practical-guide-for-bug-bounty-hunters-d44b284609aa

### Lv6. JavaScript Recon／クライアント資産からの発見

**なぜ必要か**：モダンWebでは、隠しAPI・シークレット・機能フラグがJSバンドルに埋まっている。JS収集→エンドポイント/シークレット抽出→差分監視までを回すと、他人が見ない入口が大量に出る。
**習得できること**：JS収集（katana/gau/getJS）、LinkFinder/SecretFinder/jsluiceでの抽出、AST解析、差分監視。

- Practical JavaScript Recon for Bug Bounty（passive-firstワークフロー）：https://wolfsec1337.medium.com/practical-javascript-recon-for-bug-bounty-a-real-world-passive-first-workflow-6559a5f4a93d
- Recon Methodology: JavaScript File Hunting（Marduk I Am、収集の型）：https://medium.com/@marduk.i.am/recon-methodology-javascript-file-hunting-254127ecd211
- jsluiceのAST解析解説（regexとの違い）：https://starlog.is/articles/cybersecurity/bishopfox-jsluice
- Automate JavaScript Extraction for Bug Bounty Recon：https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e
- Hunting sensitive data leaks in JavaScript — Advanced Recon Guide：https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6
- JSFScan.sh（JS recon自動化・補助）：https://github.com/KathanP19/JSFScan.sh

### Lv7. OSINT／GitHub／クラウド資産のRecon

**なぜ必要か**：漏洩シークレットや公開バケットは、単独でクリティカル（P1）になりうる高ROI領域。GitHub recon、Google/GitHub dorking、S3/GCS/Azure Blob発見を体系化する。
**習得できること**：gitdorks/trufflehog/gitleaks、dorkの高度技法、cloud_enum等でのクラウド資産発見、GrayhatWarfare活用。

- The 2025 GitHub Recon Checklist for Bug Bounty Hunters（Tillson Galloway）：https://medium.com/@tillson.galloway/the-2025-github-recon-checklist-for-bug-bounty-hunters-e626ee1a1012
- HackTricks「Github Dorks & Leaks」：https://blog.1nf1n1ty.team/hacktricks/generic-methodologies-and-resources/external-recon-methodology/github-leaked-secrets
- GitHub Recon: The Underrated Technique（Codelivly）：https://codelivly.com/github-recon-the-underrated-technique
- GitHub Dorking: A Complete Guide（OSINT Team）：https://osintteam.blog/github-dorking-a-complete-guide-for-bug-bounty-hunters-and-penetration-testers-b9f8e784e29b
- A Bug Bounty Hunter's Guide to Cloud Misconfiguration：https://medium.com/@cocopelly255/a-bug-bounty-hunters-guide-to-cloud-misconfiguration-522db28ff93e
- AWS Pentesting: S3 Bucket Recon（cloud_enum/GrayhatWarfare/dork）：https://rodelllemit.medium.com/aws-pentesting-s3-bucket-recon-6b906e7b6c86
- cloud_enum（マルチクラウド列挙・補助）：https://github.com/initstring/cloud_enum
- cloud_osint（クラウドOSINTリソース集）：https://github.com/7WaySecurity/cloud_osint
- 10 Minute Bug Bounties: OSINT with Google Dorking, Censys, Shodan：https://codelivly.com/10-minute-bug-bounties-osint-with-google-dorking-censys-and-shodan/
- 日本語：OWASP Kansai DAY 2025.09「OSINTにふれてみよう」（Attack Surface Discovery）：https://speakerdeck.com/deka_morita/owasp-kansai-day-2025-dot-09-osintnihuretemiyou

### Lv8. 歴史データ・アーカイブの活用

**なぜ必要か**：過去に存在した（今は消えた）エンドポイント・パラメータ・資産は、しばしばバックエンドで生きている。Wayback/Common Crawl/URLScan/OTXの発掘は、他人が見ない古い入口を拾う。
**習得できること**：waybackurls/gau/katanaの使い分け、履歴URLからのフィルタ、パラメータ抽出とfuzz候補生成。

- gau for Recon（Wayback/CommonCrawl/URLScan/OTX活用）：https://medium.com/@felixmelvinchitechi/gau-for-recon-91f8b331293d
- Trickest「gau: --providers, --subs, --fp」（プロバイダ/日付絞り込み）：https://trickest.com/tools/gau
- How I Use Wayback URLs, Gau & Paramspider to Supercharge Recon：https://medium.com/@merida-/how-i-use-wayback-urls-gau-paramspider-to-supercharge-recon-1944105f5f7e
- URL Archive Mining for Bug Bounty Recon（rojo-sombrero、CDX運用）：https://rojosombrero.com/posts/url-archive-mining.html
- The Ultimate Bug Bounty Recon Guide（WolfSec、gau/wayback/katana連結）：https://wolfsec1337.medium.com/the-ultimate-bug-bounty-recon-guide-from-zero-to-finding-critical-vulnerabilities-6f8e9a264fc6

### Lv9. Reconの自動化・パイプライン化・スケーリング（★武器化に必須）

**なぜ必要か**：手作業では継続性とスケールで負ける。ProjectDiscoveryツール群の連携、オールインワンフレームワーク、分散スキャン（Axiom）、データ正規化・重複排除（anew）を身につけると、Reconが「回り続ける武器」になる。
**習得できること**：subfinder→dnsx→httpx→naabu→katana→nuclei→notifyの連携、reconFTW/Osmedeus/reNgineの思想、Axiomでのfleet運用、データ運用。

- ProjectDiscovery「Open source tools」（pdtm、パイプライン基礎）：https://projectdiscovery.io/open-source
- How I Built an Automated Recon Pipeline for Bug Bounty Hunting：https://medium.com/@atnoforcybersecurity/how-i-built-an-automated-recon-pipeline-for-bug-bounty-hunting-bed3cb545317
- Katana to Kill-Switch: Mastering ProjectDiscovery's Crawler：https://adce626.medium.com/katana-to-kill-switch-mastering-projectdiscoverys-crawler-from-zero-to-pro-with-real-world-62a7dec5a744
- reconFTW ドキュメント（Introduction）：https://docs.reconftw.com/
- reconFTW × Axiom Integration（分散スキャン）：https://docs.reconftw.com/integrations/axiom
- Recon Frameworks（s0cm0nkey、フレームワーク俯瞰）：https://s0cm0nkey.gitbook.io/s0cm0nkeys-security-reference-guide/red-offensive/scanning-active-recon/recon-frameworks
- A list of automated recon tools（reconFTW/reNgine/AutoRecon比較）：https://cybersecuritywriteups.com/a-list-of-automated-recon-tools-f0d034429532
- A TomNomNom Recon Tools Primer（anew/gf/unfurl/httprobe/waybackurlsのUnix哲学）：https://danielmiessler.com/blog/a-tomnomnom-tools-primer
- Live Recon and Automation on Shopify with TomNomNom（実演ノート）：https://bibliography.mk.iq/files/pdf1737733544.pdf
- NahamSec「Free Recon Course and Methodology」（PD連携の実演動画）：https://www.youtube.com/watch?v=evyxNUzl-HA

### Lv10. 継続的Recon（Continuous Recon）とモニタリング（★武器化の決定打）

**なぜ必要か**：新資産をいち早く掴む者が勝つ。CT監視・スケジューリング・差分通知（Slack/Discord/Telegram）を仕組み化すると、証明書発行のタイミングで新インフラを検知でき、競合ハンターより先に到達できる。
**習得できること**：certstream監視、sublertでのCT監視、notifyでの差分通知、サブドメインテイクオーバーの継続検知。

- Yassine Aboukir「Automated monitoring of subdomains — Sublert」：https://medium.com/@yassineaboukir/automated-monitoring-of-subdomains-for-fun-and-profit-release-of-sublert-634cfc5d7708
- Devansh Batham「Weaponizing Live CT logs for automated monitoring」（CertEagle）：https://medium.com/@Asm0d3us/weaponizing-live-ct-logs-for-automated-monitoring-of-assets-39c6973177c7
- CT Logs for OSINT: Map Subdomains Without Sending a Single Packet：https://dev.to/roxdavirox/ct-logs-for-osint-map-subdomains-and-infrastructure-without-sending-a-single-packet-2eif
- certstream-slack（CT→Slack通知・補助）：https://github.com/mattmoyer/certstream-slack
- Certificate-Transparency-to-Slack（Cert SpotterでのCT監視・補助）：https://github.com/emtunc/Certificate-Transparency-to-Slack
- Comprehensive Recon Guide（chs.us、継続監視・差分運用の思想）：https://chs.us/guides/recon/

### Lv11. 発展・方法論・実例

**なぜ必要か**：一流リサーチャーの思考を言語化して取り込むことで、自分のReconを「型」から「武器」へ昇華させる。大規模成果のライトアップは、資産発見がどう成果に直結するかを示す。
**習得できること**：TBHM系方法論の深掘り、Sam Curryらの実例（Apple 55件）、実務家の思考プロセスの吸収。

- Sam Curry「We Hacked Apple for 3 Months」：2020年7月6日〜10月6日にSam Curry、Brett Buerhaus、Ben Sadeghipour、Samuel Erb、Tanner Barnesの5人チームが実施。ライトアップ本文より「There were a total of 55 vulnerabilities discovered with 11 critical severity, 29 high severity, 13 medium severity, and 2 low severity reports.」。報酬は10月8日時点で32件・$288,500（最終的に$500,000超を見込むとCurry）。資産発見→内部システム侵害へ至る過程の教材として最良：https://samcurry.net/hacking-apple
- Bug Hunter Handbook（Presentations、歴代TBHM等のリンク集）：https://gowthams.gitbook.io/bughunter-handbook/presentations
- The Bug Hunters Methodology full training（Class Central）：https://www.classcentral.com/course/youtube-the-bug-hunter-s-methodology-102530
- NahamSec × ProjectDiscovery「Free Post Recon Course」：https://www.youtube.com/watch?v=RYdTp4a9S34
- Tom Hudson（TomNomNom）個人サイト（ツール設計思想）：https://tomhudson.co.uk/
- 日本語：morioka12「バグバウンティにおけるLLMの活用事例」（AI×recon）：https://scgajge12.hatenablog.com/entry/bugbounty_llm

## Recommendations

- **フェーズ1（1〜2週間、土台）**：Lv1〜Lv3を集中。まずTBHM v4のノートとNahamSecのrecon思考を読み、bgp.he.netでのASN列挙・crt.shでのCT列挙・subfinder→puredns→alterxの1本のパイプラインを手で通す。ベンチマーク：1つのプログラムでpassive/active/permutationを連結し、重複排除済みのライブホスト一覧を作れること。
- **フェーズ2（3〜4週間、差別化）**：Lv4〜Lv8。Shodan/Censysのクエリとfavicon hash相関、ffuf/arjun/GraphQL introspection、JS recon（jsluice/LinkFinder）、gau/waybackでの歴史URL発掘を実践。ベンチマーク：DNS列挙では出なかったクラウド資産/origin IPを favicon or 証明書相関で1件以上掘り当てられること。
- **フェーズ3（継続、武器化）**：Lv9〜Lv11。ProjectDiscoveryツール群でパイプラインを組み、Axiomで分散化、certstream/sublert＋notifyで継続監視を稼働させる。ベンチマーク：新サブドメイン/新JS/新エンドポイントの差分がSlack/Discordに自動通知され、週次で新資産を検知できる状態。
- **判断を変える閾値**：（a）passive+activeで取りこぼしが多いと感じたらpermutationのワードリスト（Assetnote）を強化する。（b）手作業の再実行が負担になったら自動化（Lv9）へ前倒し。（c）競合と資産がかぶり成果が頭打ちなら、資産発見（Lv2）と継続監視（Lv10）に時間配分を寄せる——ここが優位性の源泉。
- **データ運用**：発見資産はanewで差分管理し、ドメイン/IP/エンドポイントを正規化して保存。既に学習中のOAuth/IDOR/XSS/クライアントサイド解析は、Reconで掘った「他人が見ていない入口」に対して適用すると成果に直結する。

## Caveats

- 本ロードマップは英語圏の2次資料が中心。Medium記事は個人発信で品質にばらつきがあり、コマンド例はバージョン差で動かない場合があるため、公式ドキュメント（ProjectDiscovery, Amass等）で最新の使い方を都度確認すること。
- 一部URL（TBHMの有料コース、Udemy、arcanum-sec等）は商用・有料。無料の2次資料（ブログ/動画/GitBook）を軸にしつつ、深掘りしたい段階で有料を検討するとよい。
- Assetnoteは2025年1月29日にSearchlight Cyber（英Portsmouth拠点）に買収され（プレスリリース businesswire.com 2025-01-29：「Searchlight Cyber ... today announced that it has acquired Assetnote, a Brisbane-based Attack Surface Management (ASM) company.」）、ブランドがSearchlight Exposureへ移行中。創業者Michael Gianarakis・Shubham ShahがASM部門を継続統括。過去のリサーチブログ記事は引き続き高品質だが、リンク構造が変わる可能性がある。
- スコープ厳守は絶対。特にactive列挙・ブルートフォース・クラウド資産のアクセスは、対象プログラムのルールと法令の範囲内でのみ実施すること。ASN/IPレンジがクラウド共有基盤上にある場合、対象組織が管理していない資産が混ざりうるため、必ず帰属を確認する。
- favicon hash相関やインターネット規模データソースは強力だが誤検知（別組織の同一favicon等）を含む。発見資産は必ず帰属確認（reverse DNS、証明書、WHOIS等）を行ってからテスト対象に含めること。
- x8（隠しパラメータ発見ツール）には単独の高品質2次資料が乏しいため、Intigritiの「Advanced Enumeration Guide」等の比較記事内で学ぶのが現実的。日本語のRecon専用の網羅記事は少なく、morioka12（scgajge12）氏のコンテンツが最も信頼できる個人発信源。