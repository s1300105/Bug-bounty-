# 付録

- [付録A — 全URL一覧](#付録a-全url一覧)
- [付録B — 未取得の資料](#付録b-未取得の資料)
- [付録C — 用語集](#付録c-用語集)
- [付録D — 参考書籍・一次資料](#付録d-参考書籍一次資料)

## 付録A — 全URL一覧

本書の土台となったロードマップ（`roadmaps/recon.md`）に登場する全URLを、ロードマップのレベル区分ごとに掲載します。各資料の詳しい位置づけは本文の該当章を参照してください。

### Lv1. Reconのマインドセットと全体像

- The Bug Hunter's Methodology v4.01 recon editionのまとめノート: <https://www.trickster.dev/post/notes-on-tbhm-v4-recon-edition/>
- TBHM v4 Recon Edition（Class Central経由のトーク紹介）: <https://www.classcentral.com/course/youtube-the-bug-hunter-s-methodology-v4-0-recon-edition-by-atjhaddix-nahamcon2020-179250>
- TBHM GitHubリポジトリ（Jason Haddix公式・補助）: <https://github.com/jhaddix/tbhm>
- TBHM Core（Arcanum、有料コースの構成理解用）: <https://arcanum-sec.com/training/the-bug-hunters-methodology/>
- NahamSec「The Truth About Recon」（recon思考7つのTips）: <https://www.classcentral.com/course/youtube-the-truth-about-recon-bug-bounty-tips-179355>
- NahamSec「Getting Started in Bug Bounty」: <https://www.nahamsec.com/getting-started-in-bug-bounty>
- Recon Methodology（Finding Attack Surface Others Miss）: <https://bug-bounties.as93.net/learn/bug-bounty-recon-methodology/>
- 日本語：morioka12「実践的なバグバウンティ入門」（Speaker Deck）: <https://speakerdeck.com/scgajge12/shi-jian-de-nabagubaunteiru-men>
- 日本語：morioka12「バグバウンティ入門(始め方)」: <https://scgajge12.hatenablog.com/entry/bugbounty_beginner>

### Lv2. 資産発見（Asset Discovery）／組織全体マッピング（★武器化の核）

- HackTricks「External Recon Methodology」（ASN・reverse whois・CT・買収・dmarcまで体系的）: <https://book.hacktricks.wiki/en/generic-methodologies-and-resources/external-recon-methodology/index.html>
- Bug Bounty Methodology — Horizontal Enumeration（ASN/horizontal相関の実践）: <https://apexvicky.medium.com/bug-bounty-methodology-horizontal-enumeration-89f7cd172e6e>
- Bug Bounty Recon: CIDR, ASN & Subdomain Enumeration Guide: <https://sinhaamrit.medium.com/bug-bounty-recon-cidr-asn-subdomain-enumeration-guide-25c447af9c40>
- Ultimate Reconnaissance RoadMap（Ahmad Halabi、WHOIS/DNS/買収の考え方）: <https://ahmdhalabi.medium.com/ultimate-reconnaissance-roadmap-for-bug-bounty-hunters-pentesters-507c9a5374d>
- My Recon Methodology ep1（amass intelでのシード拡張）: <https://medium.com/@realm3ter/my-recon-methodology-ep-1-bc9e6fd660ad>
- Selecting the Right Bug Bounty Targets & Reconnaissance（買収・WHOIS相関）: <https://dev.to/trumpiter/selecting-the-right-bug-bounty-targets-reconnaissance-276>
- OWASP Amass 詳解チュートリアル（intel＝reverse whois/ASN、enum）: <https://dionach.com/how-to-use-owasp-amass-an-extensive-tutorial/>
- Intigriti「Hacker tools: Amass – hunting for subdomains」: <https://www.intigriti.com/researchers/blog/hacking-tools/hacker-tools-amass-hunting-for-subdomains>
- Assetnote「Continuous Asset Discovery」（ASMの資産発見思想を学ぶ）: <https://www.assetnote.io/platform/asset-discovery>

### Lv3. サブドメイン列挙を深く（passive/active/permutation）

- ProjectDiscovery「Reconnaissance 102: Subdomain Enumeration」: <https://projectdiscovery.io/blog/recon-series-2>
- The Definitive Guide to Subdomain Enumeration（passive→active→permutationの連結）: <https://medium.com/@tanvir.infosec/the-definitive-guide-to-subdomain-enumeration-e2c04476ef27>
- Subdomain Enumeration Guide（GitBook, sidxparab）DNS Bruteforcing: <https://sidxparab.gitbook.io/subdomain-enumeration-guide/active-enumeration/dns-bruteforcing>
- Subdomain Enumeration Guide（自動化章、Axiom連携）: <https://sidxparab.gitbook.io/subdomain-enumeration-guide/automation>
- puredns（massdnsラッパー、ワイルドカード処理の要点確認・補助）: <https://github.com/d3mondev/puredns>
- Trickest resolvers（有効リゾルバリスト・補助）: <https://github.com/trickest/resolvers>
- Mastering Subdomain Enumeration with Amass（Vivek Bhatt）: <https://medium.com/@vivekbhatt2002/mastering-subdomain-enumeration-with-amass-a-complete-guide-for-ethical-hackers-276d6e915e51>
- 日本語：サブドメイン列挙 手順と実例まとめ（Qiita）: <https://qiita.com/nozomi2025/items/48f4e5ad6ebf5d79238f>

### Lv4. インターネット規模のデータソース活用（★他人と差がつく領域）

- Intigriti「Shodan & Censys for beginners: How to find more vulnerabilities」: <https://www.intigriti.com/researchers/blog/hacking-tools/complete-guide-to-finding-more-vulnerabilities-with-shodan-and-censys>
- Payatu「How to find assets using Favicon Hashes?」: <https://payatu.com/blog/favicon-hash/>
- Devansh Batham「Weaponizing favicon.ico for BugBounties, OSINT」（FavFreak）: <https://medium.com/@Asm0d3us/weaponizing-favicon-ico-for-bugbounties-osint-and-what-not-ace3c214e139>
- SANS ISC「Hunting phishing websites with favicon hashes」（mmh3の仕組み理解）: <https://isc.sans.edu/diary/27326>
- Using search engines for fun and bounties（Shodan ssl/orgフィルタの活用）: <https://archive.0x00sec.org/t/using-search-engines-for-fun-and-bounties/23832>
- awesome-ip-search-engines（Shodan/Censys/FOFA/ZoomEye/Netlasの学習リンク集）: <https://github.com/cipher387/awesome-ip-search-engines>
- Shodan Search Queries Cheat Sheet: <https://vespersec.net/docs/osint-reconnaissance/shodan-search-queries-cheat-sheet/>
- Censys Device Search Cheat Sheet: <https://vespersec.net/docs/osint-reconnaissance/censys-device-search-cheat-sheet/>

### Lv5. コンテンツ／パラメータ／APIエンドポイント発見を深く

- ffuf & feroxbuster 実践ガイド（ワードリスト戦略・再帰・フィルタ）: <https://payloadplayground.com/blog/content-discovery-with-ffuf>
- Ott3rly「Content Discovery With FFUF」: <https://ott3rly.com/find-sensitive-files-with-ffuf/>
- YesWeHack「Discover & map hidden endpoints & parameters」: <https://www.yeswehack.com/learn-bug-bounty/discover-map-hidden-endpoints-parameters>
- Assetnote wordlists（コンテンツ発見用ワードリスト・補助）: <https://wordlists.assetnote.io/>
- Web Content Discovery（Pentest List Wiki、feroxbuster/kiterunner設定例）: <https://wiki.pentestlist.com/offensive-security/web-application/discovery/web-content-discovery>
- Intigriti「Finding Hidden Parameters: Advanced Enumeration Guide」（Arjun/x8/Param Miner比較）: <https://www.intigriti.com/researchers/blog/hacking-tools/finding-hidden-input-parameters>
- Intigriti「Hacker tools: Arjun」: <https://www.intigriti.com/researchers/blog/hacking-tools/hacker-tools-arjun-the-parameter-discovery-tool>
- YesWeHack「Quick Guide to Start Parameter Discovery」: <https://www.yeswehack.com/learn-bug-bounty/parameter-discovery-quick-guide-to-start>
- Hunting for Hidden Parameters in Burp Suite（Param Miner実践）: <https://medium.com/fmisec/hunting-for-hidden-parameters-in-burp-suite-98b54616f863>
- Dana Epp「Finding hidden API parameters」: <https://danaepp.com/finding-hidden-api-parameters>
- YesWeHack「Hacking GraphQL endpoints」（introspection/InQL）: <https://www.yeswehack.com/learn-bug-bounty/hacking-graphql-endpoints>
- How I Hunt for Swagger UI on Real Targets: <https://medium.com/@MuhammedAsfan/how-i-hunt-for-swagger-ui-on-real-targets-a-practical-guide-for-bug-bounty-hunters-d44b284609aa>

### Lv6. JavaScript Recon／クライアント資産からの発見

- Practical JavaScript Recon for Bug Bounty（passive-firstワークフロー）: <https://wolfsec1337.medium.com/practical-javascript-recon-for-bug-bounty-a-real-world-passive-first-workflow-6559a5f4a93d>
- Recon Methodology: JavaScript File Hunting（Marduk I Am、収集の型）: <https://medium.com/@marduk.i.am/recon-methodology-javascript-file-hunting-254127ecd211>
- jsluiceのAST解析解説（regexとの違い）: <https://starlog.is/articles/cybersecurity/bishopfox-jsluice>
- Automate JavaScript Extraction for Bug Bounty Recon: <https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e>
- Hunting sensitive data leaks in JavaScript — Advanced Recon Guide: <https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6>
- JSFScan.sh（JS recon自動化・補助）: <https://github.com/KathanP19/JSFScan.sh>

### Lv7. OSINT／GitHub／クラウド資産のRecon

- The 2025 GitHub Recon Checklist for Bug Bounty Hunters（Tillson Galloway）: <https://medium.com/@tillson.galloway/the-2025-github-recon-checklist-for-bug-bounty-hunters-e626ee1a1012>
- HackTricks「Github Dorks & Leaks」: <https://blog.1nf1n1ty.team/hacktricks/generic-methodologies-and-resources/external-recon-methodology/github-leaked-secrets>
- GitHub Recon: The Underrated Technique（Codelivly）: <https://codelivly.com/github-recon-the-underrated-technique>
- GitHub Dorking: A Complete Guide（OSINT Team）: <https://osintteam.blog/github-dorking-a-complete-guide-for-bug-bounty-hunters-and-penetration-testers-b9f8e784e29b>
- A Bug Bounty Hunter's Guide to Cloud Misconfiguration: <https://medium.com/@cocopelly255/a-bug-bounty-hunters-guide-to-cloud-misconfiguration-522db28ff93e>
- AWS Pentesting: S3 Bucket Recon（cloud_enum/GrayhatWarfare/dork）: <https://rodelllemit.medium.com/aws-pentesting-s3-bucket-recon-6b906e7b6c86>
- cloud_enum（マルチクラウド列挙・補助）: <https://github.com/initstring/cloud_enum>
- cloud_osint（クラウドOSINTリソース集）: <https://github.com/7WaySecurity/cloud_osint>
- 10 Minute Bug Bounties: OSINT with Google Dorking, Censys, Shodan: <https://codelivly.com/10-minute-bug-bounties-osint-with-google-dorking-censys-and-shodan/>
- 日本語：OWASP Kansai DAY 2025.09「OSINTにふれてみよう」（Attack Surface Discovery）: <https://speakerdeck.com/deka_morita/owasp-kansai-day-2025-dot-09-osintnihuretemiyou>

### Lv8. 歴史データ・アーカイブの活用

- gau for Recon（Wayback/CommonCrawl/URLScan/OTX活用）: <https://medium.com/@felixmelvinchitechi/gau-for-recon-91f8b331293d>
- Trickest「gau: --providers, --subs, --fp」（プロバイダ/日付絞り込み）: <https://trickest.com/tools/gau>
- How I Use Wayback URLs, Gau & Paramspider to Supercharge Recon: <https://medium.com/@merida-/how-i-use-wayback-urls-gau-paramspider-to-supercharge-recon-1944105f5f7e>
- URL Archive Mining for Bug Bounty Recon（rojo-sombrero、CDX運用）: <https://rojosombrero.com/posts/url-archive-mining.html>
- The Ultimate Bug Bounty Recon Guide（WolfSec、gau/wayback/katana連結）: <https://wolfsec1337.medium.com/the-ultimate-bug-bounty-recon-guide-from-zero-to-finding-critical-vulnerabilities-6f8e9a264fc6>

### Lv9. Reconの自動化・パイプライン化・スケーリング（★武器化に必須）

- ProjectDiscovery「Open source tools」（pdtm、パイプライン基礎）: <https://projectdiscovery.io/open-source>
- How I Built an Automated Recon Pipeline for Bug Bounty Hunting: <https://medium.com/@atnoforcybersecurity/how-i-built-an-automated-recon-pipeline-for-bug-bounty-hunting-bed3cb545317>
- Katana to Kill-Switch: Mastering ProjectDiscovery's Crawler: <https://adce626.medium.com/katana-to-kill-switch-mastering-projectdiscoverys-crawler-from-zero-to-pro-with-real-world-62a7dec5a744>
- reconFTW ドキュメント（Introduction）: <https://docs.reconftw.com/>
- reconFTW × Axiom Integration（分散スキャン）: <https://docs.reconftw.com/integrations/axiom>
- Recon Frameworks（s0cm0nkey、フレームワーク俯瞰）: <https://s0cm0nkey.gitbook.io/s0cm0nkeys-security-reference-guide/red-offensive/scanning-active-recon/recon-frameworks>
- A list of automated recon tools（reconFTW/reNgine/AutoRecon比較）: <https://cybersecuritywriteups.com/a-list-of-automated-recon-tools-f0d034429532>
- A TomNomNom Recon Tools Primer（anew/gf/unfurl/httprobe/waybackurlsのUnix哲学）: <https://danielmiessler.com/blog/a-tomnomnom-tools-primer>
- Live Recon and Automation on Shopify with TomNomNom（実演ノート）: <https://bibliography.mk.iq/files/pdf1737733544.pdf>
- NahamSec「Free Recon Course and Methodology」（PD連携の実演動画）: <https://www.youtube.com/watch?v=evyxNUzl-HA>

### Lv10. 継続的Recon（Continuous Recon）とモニタリング（★武器化の決定打）

- Yassine Aboukir「Automated monitoring of subdomains — Sublert」: <https://medium.com/@yassineaboukir/automated-monitoring-of-subdomains-for-fun-and-profit-release-of-sublert-634cfc5d7708>
- Devansh Batham「Weaponizing Live CT logs for automated monitoring」（CertEagle）: <https://medium.com/@Asm0d3us/weaponizing-live-ct-logs-for-automated-monitoring-of-assets-39c6973177c7>
- CT Logs for OSINT: Map Subdomains Without Sending a Single Packet: <https://dev.to/roxdavirox/ct-logs-for-osint-map-subdomains-and-infrastructure-without-sending-a-single-packet-2eif>
- certstream-slack（CT→Slack通知・補助）: <https://github.com/mattmoyer/certstream-slack>
- Certificate-Transparency-to-Slack（Cert SpotterでのCT監視・補助）: <https://github.com/emtunc/Certificate-Transparency-to-Slack>
- Comprehensive Recon Guide（chs.us、継続監視・差分運用の思想）: <https://chs.us/guides/recon/>

### Lv11. 発展・方法論・実例

- Sam Curry「We Hacked Apple for 3 Months」：2020年7月6日〜10月6日にSam Curry、Brett Buerhaus、Ben Sadeghipour、Samuel Erb、Tanner Barnesの5人チームが実施。ライトアップ本文より「There were a total of 55 vulnerabilities discovered with 11 critical severity, 29 high severity, 13 medium severity, and 2 low severity reports.」。報酬は10月8日時点で32件・$288,500（最終的に$500,000超を見込むとCurry）。資産発見→内部システム侵害へ至る過程の教材として最良: <https://samcurry.net/hacking-apple>
- Bug Hunter Handbook（Presentations、歴代TBHM等のリンク集）: <https://gowthams.gitbook.io/bughunter-handbook/presentations>
- The Bug Hunters Methodology full training（Class Central）: <https://www.classcentral.com/course/youtube-the-bug-hunter-s-methodology-102530>
- NahamSec × ProjectDiscovery「Free Post Recon Course」: <https://www.youtube.com/watch?v=RYdTp4a9S34>
- Tom Hudson（TomNomNom）個人サイト（ツール設計思想）: <https://tomhudson.co.uk/>
- 日本語：morioka12「バグバウンティにおけるLLMの活用事例」（AI×recon）: <https://scgajge12.hatenablog.com/entry/bugbounty_llm>

## 付録B — 未取得の資料

以下は、自動生成時に**本文を直接取得できなかった**資料の一覧です。多くは Medium など配信側のボット遮断（HTTP 403）や有料化・リンク切れ（402/404）によるものです。該当節では代替の一次資料（GitHub 原本の raw README など）・WebSearch による要旨復元・執筆者の一般知識で内容を補い、本文中の該当箇所にも ⚠️ 警告ブロックを挿入しています。**必ず下記の原典URLをご自身で確認してください。**

| 節 | 資料URL | 未取得の理由（要約） |
|---|---|---|
| 第1章 The Bug Hunter's Methodology v4 | <https://www.classcentral.com/course/youtube-the-bug-hunter-s-methodology-v4-0-recon-edition-by-atjhaddix-nahamcon2020-179250> | HTTP 403 Forbidden（Class Central が自動アクセスを拒否）。WebSearch で代替情報（講演タイトル・発表者・NahamCon2020・YouTube 原典 URL https://www.youtube.com/watch?v=p4JgIu1mceI・30本超のツール紹介）を取得し、本文4節に ⚠… |
| 第1章 Recon思考の型 | <https://www.classcentral.com/course/youtube-the-truth-about-recon-bug-bounty-tips-179355> | HTTP 403 Forbidden on direct WebFetch; underlying YouTube video also not directly fetchable. Recovered the 7-tip list and tool names via WebSearch, and used general ex… |
| 第2章 External Recon Methodology | <https://ahmdhalabi.medium.com/ultimate-reconnaissance-roadmap-for-bug-bounty-hunters-507c9a5374d> | Medium が HTTP 403 Forbidden を返し本文取得不可。ロードマップ記載の別URL（...-pentesters-507c9a5374d）も403。代替として GitHub の ahmad0x1/ARWAD README を1回取得したが概要文のみで方法論本文なし。WebSearch 2回で著者・ARWAD概念・… |
| 第2章 External Recon Methodology | <https://book.hacktricks.wiki/en/generic-methodologies-and-resources/external-recon-methodology/index.html> | 部分的: 直接URLは tollbit.hacktricks.wiki へ302リダイレクトし、リダイレクト先は HTTP 402 Payment Required。ただし GitHub 原本 raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/generi… |
| 第2章 horizontal/vertical列挙 | <https://apexvicky.medium.com/bug-bounty-methodology-horizontal-enumeration-89f7cd172e6e> | Medium が HTTP 403 Forbidden を返し本文取得不可。WebSearch のインデックス経由で概要のみ確認（AS714/17.0.0.0/8、Whoxy 約329M件、mapcidr+dnsx、favicon）。本文に ⚠️ 未取得ブロックと補足を挿入。内容が実質同一の sidxparab Subdomain … |
| 第2章 horizontal/vertical列挙 | <https://sinhaamrit.medium.com/bug-bounty-recon-cidr-asn-subdomain-enumeration-guide-25c447af9c40> | Medium が HTTP 403 Forbidden を返し本文取得不可。freedium ミラーも DNS 解決不可（ENOTFOUND）。WebSearch で構成（amass intel / mapcidr / httpx / subfinder の連結）のみ確認。本文に ⚠️ 未取得ブロックを挿入し、一般知識に基づく補足と… |
| 第3章 passive列挙とCT | <https://medium.com/@tanvir.infosec/the-definitive-guide-to-subdomain-enumeration-e2c04476ef27> | WebFetchがHTTP 403 Forbiddenを返した。代替ミラー(freedium.cfd)はDNS解決エラー(ENOTFOUND)で失敗。WebSearchで得られた要旨的情報のみを本文中に補足として使用し、原文からの直接引用はしていない。 |
| 第3章 permutationと自動化 | <https://medium.com/@vivekbhatt2002/mastering-subdomain-enumeration-with-amass-a-complete-guide-for-ethical-hackers-276d6e915e51> | WebFetchがHTTP 403 Forbiddenを返した(Medium側のアクセス制限)。WebSearchで概要情報のみ取得し、本文内に注記・補足を挿入した。 |
| 第4章 スキャンDBのクエリ | <https://en.fofa.info/lab/query> | HTTP 404 Not Found（FOFA公式クエリ規則ページ）。代替として https://en.fofa.info/api を WebFetch で取得成功し、フィールド名群と論理演算子（&&, ／／, !=, =, ==）の存在を確認。本文内に未取得警告ブロックを挿入し、詳細挙動は一般知識に基づく補足である旨を明記した。 |
| 第4章 favicon hash相関 | <https://medium.com/@Asm0d3us/weaponizing-favicon-ico-for-bugbounties-osint-and-what-not-ace3c214e139> | WebFetch が HTTP 403 Forbidden を返し取得不可。著者ミラー devansh.xyz も 404。代替として FavFreak の GitHub 原本（README.md / favfreak.py）を WebFetch で取得し、WebSearch の二次情報とあわせて本文を補足。本文に未取得マーカーを挿… |
| 第5章 コンテンツ発見 | <https://payloadplayground.com/blog/content-discovery-with-ffuf> | WebFetchでの取得結果が実際のページ内容か生成的要約か確証が持てなかったため、本文中に未取得資料の注記とURL案内を挿入し、専門知識による補足で代替した。 |
| 第5章 パラメータ探索実践 | <https://medium.com/fmisec/hunting-for-hidden-parameters-in-burp-suite-98b54616f863> | WebFetchが403 Forbiddenで直接取得できなかった。代替のfreedium.cfdミラーもDNS解決エラーで失敗。WebSearchで得られた抜粋・要約情報を基に本文を構成し、本文中に注記と原URLを記載済み。 |
| 第5章 GraphQL/Swagger発見 | <https://medium.com/@MuhammedAsfan/how-i-hunt-for-swagger-ui-on-real-targets-a-practical-guide-for-bug-bounty-hunters-d44b284609aa> | WebFetchでの直接取得がHTTP 403 Forbiddenで拒否された（egress/WAFブロックと推定）。GitHub原本/rawミラーは存在しないため、WebSearchで記事の要点を復元し、本文に⚠️未取得資料の警告ボックスと復元内容・補足を記載した。 |
| 第6章 JSファイル収集 | <https://wolfsec1337.medium.com/practical-javascript-recon-for-bug-bounty-a-real-world-passive-first-workflow-6559a5f4a93d> | 直接WebFetchでHTTP 403。freedium.cfdミラーもDNS解決失敗。WebSearchで記事の要点(passive-first原則、量より質、ビジネス文脈、Wayback Machineの重要性)は復元できたが、記事全文は取得できていない。 |
| 第6章 JSファイル収集 | <https://medium.com/@marduk.i.am/recon-methodology-javascript-file-hunting-254127ecd211> | 直接WebFetchでHTTP 403。freedium.cfdミラーもDNS解決失敗。WebSearchでツール名(SubJS/GetJS/Katana/Linkfinder/gau/waybackurls)と概要は復元できたが、記事全文は取得できていない。 |
| 第6章 JSファイル収集 | <https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e> | 直接WebFetchでHTTP 403。freedium.cfdミラーもDNS解決失敗。WebSearchでツールセット(gau/waybackurls/httpx/LinkFinder/SecretFinder/GoSpider/Hakrawler/de4js)と関連スクリプト(JSFScan.sh)の概要は復元できたが、記事全文… |
| 第6章 シークレット/エンドポイント抽出 | <https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6> | WebFetch が HTTP 403 Forbidden（Medium 側のボット遮断）。代替の freedium ミラーは DNS 解決不可（ENOTFOUND）。WebSearch 1回で記事の骨子（漏洩カテゴリ5分類、推奨ツール群 katana/subjs/gauplus/waybackurls/hakrawler/Secr… |
| 第7章 GitHub Recon | <https://osintteam.blog/github-dorking-a-complete-guide-for-bug-bounty-hunters-and-penetration-testers-b9f8e784e29b> | Cloudflareのボット保護によりWebFetch・curl(UA偽装)ともにHTTP 403。freedium.cfdミラーもDNS解決不可(ENOTFOUND)。本文全体は取得できず、WebSearch由来のメタ情報(サポートするqualifier一覧、Git履歴永続の要点)で補い、本文に⚠️未取得ブロックとして明示した。 |
| 第7章 クラウド資産発見 | <https://medium.com/@cocopelly255/a-bug-bounty-hunter-s-guide-to-cloud-misconfiguration-522db28ff93e> | Medium が HTTP 403 Forbidden を返し本文を直接取得できず。WebSearch による記事要約・引用で内容を補完し、本文に未取得警告ボックスを挿入。 |
| 第7章 クラウド資産発見 | <https://rodelllemit.medium.com/aws-pentesting-s3-bucket-recon-6b906e7b6c86> | Medium が HTTP 403 Forbidden を返し本文を直接取得できず。WebSearch による記事要約・引用(cloud_enumコマンド, GrayhatWarfare, Googleドーク, 36%統計)で内容を補完し、本文に未取得警告ボックスを挿入。 |
| 第8章 履歴URL収集 | <https://medium.com/@felixmelvinchitechi/gau-for-recon-91f8b331293d> | WebFetchがHTTP 403 Forbiddenを返した（egressブロックの可能性）。WebSearchの要約で代替し、本文に未取得の注記を明記した。 |
| 第8章 履歴URL収集 | <https://medium.com/@merida-/how-i-use-wayback-urls-gau-paramspider-to-supercharge-recon-1944105f5f7e> | WebFetchがHTTP 403 Forbiddenを返した（egressブロックの可能性）。WebSearchの要約で代替し、本文に未取得の注記を明記した。 |
| 第8章 アーカイブマイニング | <https://wolfsec1337.medium.com/the-ultimate-bug-bounty-recon-guide-from-zero-to-finding-critical-vulnerabilities-6f8e9a264fc6> | Medium returned HTTP 403 Forbidden; direct WebFetch blocked. freedium mirror unreachable (ENOTFOUND). Technical substance recovered from WebSearch result metadata and … |
| 第9章 PDパイプライン | <https://medium.com/@atnoforcybersecurity/how-i-built-an-automated-recon-pipeline-for-bug-bounty-hunting-bed3cb545317> | WebFetch が HTTP 403 Forbidden（Medium のボット対策）。WebSearch 2回で記事の骨子（recon.sh、出力ディレクトリ構造、使用ツール一覧、中心思想の引用、cron連携）を復元し、本文に未取得注記＋一般知識による補足を挿入した。 |
| 第9章 PDパイプライン | <https://adce626.medium.com/katana-to-kill-switch-mastering-projectdiscoverys-crawler-from-zero-to-pro-with-real-world-62a7dec5a744> | WebFetch が HTTP 403 Forbidden（Medium のボット対策）。代替として解説対象の原典である projectdiscovery/katana の公式 README を raw 取得し、全フラグ・モード・スコープ制御・出力仕様を原文ベースで記述した。 |
| 第9章 フレームワークとスケーリング | <https://cybersecuritywriteups.com/a-list-of-automated-recon-tools-f0d034429532> | HTTP 403 Forbidden。?gi= 付きの代替URLでも同様に403。WebSearch 1回で記事要旨（reconFTW のサブドメイン発見手法と脆弱性チェック範囲、AutoRecon のサービス駆動型列挙、MagicRecon/LazyRecon/BugBountyScanner/ReconPi への言及）を回収し、… |
| 第9章 Unix哲学 | <https://www.youtube.com/watch?v=evyxNUzl-HA> | YouTubeページから字幕・説明文の実質テキストを抽出できず、フッタのナビゲーションリンクのみが返った。代替としてWebSearchでProjectDiscovery公式の告知内容（2025年9月22日公開、Subfinder→AlterX→DNSX→Naabu→HTTPX→Katanaの連鎖、VPS構築とGoインストーラ）を取得… |
| 第10章 CT監視 | <https://medium.com/@yassineaboukir/automated-monitoring-of-subdomains-for-fun-and-profit-release-of-sublert-634cfc5d7708> | WebFetchがHTTP 403 Forbiddenを返却（MediumのBot遮断）。代替として著者公式リポジトリ github.com/yassineaboukir/sublert の README・sublert.py の raw/HTML を取得し内容を再構成。本文中に⚠️未取得ブロックを挿入済み。 |
| 第10章 CT監視 | <https://medium.com/@Asm0d3us/weaponizing-live-ct-logs-for-automated-monitoring-of-assets-39c6973177c7> | WebFetchがHTTP 403 Forbiddenを返却（MediumのBot遮断）。著者ブログミラー devansh.xyz は404、scribe.rip も404。代替として著者公式リポジトリ github.com/devanshbatham/CertEagle の README・certeagle.py を取得し内容を再… |
| 第11章 方法論アーカイブ | <https://www.classcentral.com/course/youtube-the-bug-hunter-s-methodology-102530> | WebFetchがHTTP 403 Forbidden（ボットアクセス拒否）。代替としてWebSearch経由でレッスン一覧（タイムスタンプ付き18項目・[MANUAL]/[AUTOMATION]構成）を復元し本文に反映、ページ本体未取得の旨を警告ブロックで明記。 |
| 第11章 方法論アーカイブ | <https://www.youtube.com/watch?v=RYdTp4a9S34> | YouTubeの動画説明・チャプターはJS描画のためテキスト取得ではフッタのみ返却。テキスト抽出プロキシ経由の再取得も401。WebSearch 2回でタイトル・公開日(2025-11-24)・ProjectDiscovery公式告知のツールチェーン概要のみ復元し、警告ブロック＋一般知識補足として記述。 |
| 第11章 実務家の思考 | <https://tomhudson.co.uk/> | WebFetchで取得したが、ツール名と講演タイトルの簡単な列挙のみで、設計思想を説明する本文が得られなかった。代わりにDaniel Miesslerの解説記事(danielmiessler.com/blog/a-tomnomnom-tools-primer)とWebSearch結果で補完した。 |

> 注: 上表のうち「部分的」「代替取得成功」と記した資料は、GitHub 原本などから**同内容の全文を取得できており、本文の内容に欠落はありません**（例: HackTricks External Recon Methodology は GitHub raw から全文取得済み、katana/sublert/CertEagle/FavFreak は公式リポジトリのREADME・スクリプトから再構成）。純粋に要旨復元のみで補った資料は、原典の細部（具体的コマンド例など）が本書に反映されていない可能性があります。

## 付録C — 用語集

Reconで頻出する用語を、本書での使い方に沿って簡潔にまとめます。

- **attack surface（攻撃面）**: 攻撃者が到達・操作できる入口（ドメイン、IP、エンドポイント、パラメータ、APIなど）の総体。Reconの目的は、これを他人より広く・正確に把握すること。
- **wide recon / targeted recon**: 組織全体へ広く資産を掘る調査（wide）と、特定の資産を狙って深掘りする調査（targeted）。breadth-first（幅優先）で両者を往復するのが現代の方法論。
- **root/seed asset（ルート/シード資産）**: 調査の起点となる、対象組織が明確に所有する apex ドメインや主要IPレンジ。
- **horizontal enumeration（水平列挙）**: 買収・子会社・別ブランドなど、**別の apex ドメインや組織**へ資産を広げる列挙。
- **vertical enumeration（垂直列挙）**: 1つの apex ドメイン配下のサブドメインや、1つのASN配下のIPへ**深く**掘る列挙。
- **ASN（Autonomous System Number）**: インターネット上でルーティングを行う組織単位に割り当てられる番号。ASN→CIDR→IPレンジと辿ることでIP空間を特定する。
- **CIDR**: `192.0.2.0/24` のようなIPアドレス範囲の表記。
- **reverse WHOIS**: 登録者名・メール・組織名などから、それに紐づくドメイン群を逆引きする手法。
- **CT（Certificate Transparency）ログ**: 発行されたTLS証明書を公開記録するログ。crt.sh 等で検索でき、パケットを送らずにサブドメインを発見できる。
- **passive / active / permutation**: サブドメイン列挙の3層。passive（公開データ源から収集）→ active（DNSブルートフォース）→ permutation（既知名の変形生成）。
- **wildcard DNS（ワイルドカード）**: 存在しないサブドメインにも応答するDNS設定。ブルートフォースの誤検知源で、検出・除去が必須。
- **resolver（リゾルバ）**: DNS問い合わせを解決するサーバ。大規模ブルートフォースには信頼できるリゾルバリストの運用が要る。
- **favicon hash（mmh3）**: favicon画像を MurmurHash3 でハッシュ化した値。Shodan等の `http.favicon.hash` フィルタで、同一faviconを持つ資産（同一組織のクラウド資産・origin IPなど）を相関発見できる。
- **origin IP**: CDN/WAFの背後にある本来のサーバIP。これを掴めると防御層を迂回できる場合がある（帰属確認は必須）。
- **content discovery（コンテンツ発見）**: リンクされていないパス・ファイル・ディレクトリを、ワードリストで総当たりして発見すること（ffuf/feroxbuster）。
- **hidden parameter（隠しパラメータ）**: UIから見えないがサーバが解釈するリクエストパラメータ（Arjun/x8/Param Miner）。
- **introspection（GraphQL）**: GraphQLのスキーマ（型・クエリ・ミューテーション）を問い合わせで取得できる機能。無効化されていなければ内部設計図が丸ごと得られる。
- **JS recon**: JavaScriptバンドルからエンドポイント・シークレット・機能フラグを抽出する調査。jsluice/LinkFinder/SecretFinder など。
- **AST（抽象構文木）**: ソースコードを構文構造として解析した木。正規表現より正確にJS内の値・関数呼び出しを抽出できる（jsluice）。
- **dorking（ドーキング）**: 検索エンジンやGitHubの高度な検索演算子で、漏洩情報や露出資産を狙って探す技法。
- **subdomain takeover（サブドメインテイクオーバー）**: 解放済みの外部サービスを指したままのDNSレコードを第三者が乗っ取る脆弱性。継続監視の主要検知対象。
- **OOB / OAST**: Out-of-Band / Out-of-band Application Security Testing。対象からの外部通信（DNS/HTTP）を観測して結果を得るチャネル。
- **anew / gf / unfurl（TomNomNom系）**: 標準入出力で連結する小さなUnix哲学ツール群。anewは差分追記、gfはパターン抽出、unfurlはURL分解。
- **ASM（Attack Surface Management）**: 攻撃面を継続的に発見・監視・管理する運用／製品分野。

## 付録D — 参考書籍・一次資料

本書の根幹をなす、信頼性の高い一次・公式資料です。バージョン依存の情報は必ず原典の最新版で確認してください。

- **The Bug Hunter's Methodology（Jason Haddix / Arcanum）** — Recon方法論の事実上の共通言語。GitHub: <https://github.com/jhaddix/tbhm>
- **ProjectDiscovery 公式ドキュメント** — subfinder / dnsx / httpx / naabu / katana / nuclei / notify などの一次情報。<https://projectdiscovery.io/open-source>
- **OWASP Amass** — 資産発見・列挙の定番OSS。intel（reverse whois/ASN）とenumの使い分けが核心。
- **HackTricks — External Recon Methodology** — ASN/reverse whois/CT/買収まで体系化した無料リファレンス（GitHub原本で全文閲覧可）。
- **Shodan 公式ブログ「Deep Dive: http.favicon.hash」** — favicon hashの原理（MurmurHash3・Base64後にハッシュ化）の一次情報。
- **reconFTW ドキュメント** — オールインワン偵察パイプラインと Axiom 連携（分散スキャン）の思想。<https://docs.reconftw.com/>
- **Sam Curry「We Hacked Apple for 3 Months」** — 資産発見が成果に直結する過程を示す実例研究。<https://samcurry.net/hacking-apple>
- **日本語：morioka12（scgajge12）氏のバグバウンティ入門・実践資料** — 日本語で最も信頼できる個人発信の一つ。

---

[← 第11章 発展・方法論・実例](11-methodology-cases.md) ｜ [📖 目次](index.md)
