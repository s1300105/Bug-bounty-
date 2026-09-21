# 付録

## 付録A：全参考URL一覧（段階別）

本書が原典とした `roadmaps/xxe&fileupload.md` の全URLを、ロードマップの段階（Lv）ごとに再掲する。各リンクは本文の該当章・節で引用・解説している。

### Lv1：前提 — XML と DTD の基礎（第1章）

- PortSwigger「What is XXE injection?」: https://portswigger.net/web-security/xxe
- HackTricks「XXE - XEE - XML External Entity」: https://hacktricks.wiki/en/pentesting-web/xxe-xee-xml-external-entity.html
- The Hacker Recipes「XXE injection」: https://www.thehacker.recipes/web/inputs/xxe-injection/
- YesWeHack「XML external entity: The ultimate Bug Bounty guide to exploiting XXE」: https://www.yeswehack.com/learn-bug-bounty/xml-external-entity-guide-xxe
- OWASP「XML External Entity (XXE) Processing」: https://owasp.org/www-community/vulnerabilities/XML_External_Entity_(XXE)_Processing
- （日本語）MBSD「XXE攻撃 基本編」: https://www.mbsd.jp/research/20171130/xxe1/
- （日本語）徳丸浩「PHPプログラマのためのXXE入門」: https://blog.tokumaru.org/2017/12/introduction-to-xxe-for-php-programmers.html
- （日本語）yamory「油断ならない脆弱性 XXEへの対策」: https://yamory.io/blog/what-is-xxe
- （日本語・入門）minegishirei「XML外部エンティティ（XXE）とは？」: https://minegishirei.hatenablog.com/entry/2024/11/22/205514

### Lv2：古典的 XXE — ファイル読取と SSRF（第2章）

- PortSwigger Lab「Exploiting XXE using external entities to retrieve files」: https://portswigger.net/web-security/xxe
- PortSwigger Lab「Exploiting XXE to perform SSRF attacks」: https://portswigger.net/web-security/xxe/lab-exploiting-xxe-to-perform-ssrf
- PortSwigger Lab「Exploiting XInclude to retrieve files」: https://portswigger.net/web-security/xxe/lab-xinclude-attack
- PayloadsAllTheThings「XXE Injection」: https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection
- SecurityIdiots「XXE Cheat Sheet」: http://www.securityidiots.com/Web-Pentest/XXE/XXE-Cheat-Sheet-by-SecurityIdiots.html
- Depth Security「Exploitation: XML External Entity (XXE) Injection」: https://www.depthsecurity.com/blog/exploitation-xml-external-entity-xxe-injection/
- Hackviser「XML External Entity (XXE) Attack Guide」: https://hackviser.com/tactics/pentesting/web/xxe
- （writeup）Medium/BooRuleDie「PortSwigger XXE Lab #1」: https://medium.com/@booruledie/portswigger-web-security-academy-xxe-lab-1-820613089d3d
- （writeup）Medium/Dipikanta Dutta「PortSwigger XXE, CSRF, SSRF, CORS Apprentice Labs」: https://medium.com/@dipikanta.dutta/portswigger-web-security-academy-labs-xxe-injection-csrf-ssrf-cors-apprentice-level-9b5ec8b26295
- （日本語）徳丸浩の日記 2018年12月（XXE→SSRF, メタデータ/IAM取得）: https://blog.tokumaru.org/2018/12/

### Lv3：盲目 XXE（Blind XXE / OOB XXE）（第3章）

- PortSwigger「What is blind XXE?」: https://portswigger.net/web-security/xxe/blind
- Lab「Blind XXE with out-of-band interaction via XML parameter entities」: https://portswigger.net/web-security/xxe/blind/lab-xxe-with-out-of-band-interaction-using-parameter-entities
- Lab「Exploiting blind XXE to exfiltrate data using a malicious external DTD」: https://portswigger.net/web-security/xxe/blind/lab-xxe-with-out-of-band-exfiltration
- Invicti「Out-of-Band XML External Entity (OOB XXE)」: https://www.invicti.com/learn/out-of-band-xml-external-entity-oob-xxe
- Geek Girl（Shreya Pohekar）「Blind XXE attacks – OAST to exfiltrate data」: https://shreyapohekar.com/blogs/blind-xxe-attacks-out-of-band-interaction-techniques-oast-to-exfilterate-data/
- Medium/0xzd「Exploiting Blind XXE: Data Exfiltration thru External DTD」: https://medium.com/@jhncdrcbautista/exploiting-blind-xxe-data-exfiltration-thru-external-dtd-4ac392305b9f
- GitHub/ramyardaneshgar「XML-External-Entity-XXE-Exploitation」: https://github.com/ramyardaneshgar/XML-External-Entity-XXE-Exploitation
- （ローカルDTD再利用の原典）mohemiv「Exploiting XXE with local DTD files」: https://mohemiv.com/all/exploiting-xxe-with-local-dtd-files/
- （日本語）MBSD「XXE 応用編」: https://www.mbsd.jp/research/20171213/xxe2/

### Lv4：XML を解釈する各種ファイル形式経由の XXE（第4章）

- PortSwigger Lab「Exploiting XXE via image file upload」（SVG, Apache Batik）: https://portswigger.net/web-security/xxe/lab-xxe-via-file-upload
- BuffaloWill/oxml_xxe: https://github.com/BuffaloWill/oxml_xxe
- oxml_xxe公式スライド（Will Vandevanter, BH USA 2015）: https://oxmlxxe.github.io/reveal.js/slides.html
- Black Hat USA 2015スライドPDF「Exploiting XXE in File Parsing Functionality」: https://blackhat.com/docs/us-15/materials/us-15-Vandevanter-Exploiting-XXE-Vulnerabilities-In-File-Parsing-Functionality.pdf
- PortSwigger/office-open-xml-editor（Burp拡張）: https://github.com/PortSwigger/office-open-xml-editor
- GigaByteRex/officeXXE: https://github.com/GigaByteRex/officeXXE
- Willis Vandevanter「Exploiting XXE Vulnerabilities in OXML Documents - Part 1」: https://silentrobots.com/exploiting-xxe-vulnerabilities-in-oxml-documents-part-1/
- Book of BugBounty Tips「XXE」: https://gowsundar.gitbook.io/book-of-bugbounty-tips/xxe
- BugBountyHunter（zseano）「Learn about XML Injection (XXE)」: https://www.bugbountyhunter.com/vulnerability/?type=xxe
- SAML経由XXE：HackTricks「SAML Attacks」: https://hacktricks.wiki/en/pentesting-web/saml-attacks/index.html
- SVG XXEラボwriteup：Medium/Karthikeyan Nagaraj「Lab: Exploiting XXE via image file upload」: https://medium.com/infosecmatrix/11-8-lab-exploiting-xxe-via-image-file-upload-2024-e2840c3b85f3
- （日本語）SVGアップロードXSS実例：WESEEK Tips「SVGを利用したXSS」: https://tips.weseek.co.jp/5fbe725836ac6300497c219e
- （日本語）KobeSoft「XXE（XML外部エンティティ攻撃）とは」: https://kobesoft.co.jp/mikata/words/security/xxe-xml-external-entity/

### Lv5：発展・フィルタ回避・関連攻撃（第5章）

- Wallarm「XXE that can Bypass WAF Protection: 4 Ways」: https://lab.wallarm.com/xxe-that-can-bypass-waf-protection-98f679452ce0/
- GitHub/Ambrotd「XXE-Notes（WAF bypass）」: https://github.com/Ambrotd/XXE-Notes
- WAF-Bypass.com「Tag: XXE」: https://waf-bypass.com/tag/xxe/
- Positive Technologies (PT SWARM)「Impossible XXE in PHP」: https://swarm.ptsecurity.com/impossible-xxe-in-php/
- XXE→RCE：Medium/Airman「From XXE to RCE with PHP/expect — The Missing Link」: https://airman604.medium.com/from-xxe-to-rce-with-php-expect-the-missing-link-a18c265ea4c7
- XXE→RCE：Keiran Scott「Exploiting XXE Vulnerabilities」: https://keiran.scot/2022/02/10/exploiting-xxe-vulnerabilities/
- XSLT injection：HackTricks「XSLT Server Side Injection」: https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations
- XSLT：Acunetix「XSLT injection」: https://www.acunetix.com/vulnerabilities/web/xslt-injection/

### Lv6：ファイルアップロード脆弱性の基礎（第6章）

- PortSwigger「File upload vulnerabilities」ラーニングパス（全7ラボ）: https://portswigger.net/web-security/learning-paths/file-upload-vulnerabilities
- OWASP「Unrestricted File Upload」: https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload
- The Hacker Recipes「Unrestricted file upload」: https://www.thehacker.recipes/web/inputs/unrestricted-file-upload
- （writeup）Yash's CyberSec blog「Walkthrough - File Upload Portswigger labs」: https://yashfren.github.io/posts/FileUploadVulnerabilities_PortswiggerLabs_Walkthrough/
- （動画）YouTube「File Upload Vulnerabilities - PortSwigger（playlist）」: https://www.youtube.com/playlist?list=PLmqenIp2RQcjMBgl4bRtOQ0h6iCBLZZTI
- （日本語）GMO Flatt Security「ファイルアップロード機能の仕様パターンとセキュリティ観点」: https://blog.flatt.tech/entry/file_upload_security

### Lv7：アップロード検証のバイパス（第7章）

- HackTricks「File Upload」: https://hacktricks.wiki/en/pentesting-web/file-upload/index.html
- PayloadsAllTheThings「Upload Insecure Files」: https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Upload%20Insecure%20Files/README.md
- OnSecurity「File Upload Vulnerability Tricks and Checklist」: https://onsecurity.io/article/file-upload-checklist/
- Hacker's Grimoire「File upload bypass」: https://vulp3cula.gitbook.io/hackers-grimoire/exploitation/web-application/file-upload-bypass
- （writeup）Medium/Aytxc「File upload vulnerabilities — Portswigger」: https://medium.com/@aytxc/file-upload-vulnerabilities-portswigger-7cf5a42e0155
- （writeup）ethichooligan/Rza Shirinov「PortSwigger — File upload vulnerabilities」: https://ethichooligan.medium.com/portswigger-file-upload-vulnerabilities-51b09692c953
- （日本語writeup）Qiita「Web shell upload via obfuscated file extension #BSCP」: https://qiita.com/yna020311/items/bed8a913452bed0c898a
- （日本語）CyberCrew「ファイルアップロード機能に潜む脆弱性」: https://cyber.spool.co.jp/unrestricted-file-upload-extension-bypass/

### Lv8：アップロードから RCE / その他への昇格（第8章）

- 公式「ImageTragick」: https://imagetragick.com/
- Red Hat「ImageTragick - CVE-2016-3714」: https://access.redhat.com/security/vulnerabilities/ImageTragick
- BreakPoint Labs「ImageMagick Undocumented Feature – RCE (CVE-2016-3714)」: https://breakpoint-labs.com/imagemagick-undocumented-feature-rce-cve-2016-3714/
- Benny Simmonds「Technical Analysis of ImageTragick」: https://www.bencode.io/posts/2019-09-27-imagetragick/
- Exploit-DB「ImageMagick 7.0.1-0 / 6.9.3-9 - ImageTragick」: https://www.exploit-db.com/exploits/39767
- VoidSec「ImageTragick PoC」: https://voidsec.com/imagetragick-poc/
- （日本語）MBSD「ImageMagickを使うWebアプリのセキュリティ 1」: https://www.mbsd.jp/research/20180831/imagemagick1/
- （日本語）ITmedia「ImageMagickに脆弱性」: https://www.itmedia.co.jp/enterprise/articles/1605/06/news047.html
- （日本語）てきとうなメモ「ImageMagickの脆弱性(ImageTragick)」: https://boscono.hatenablog.com/entry/2016/05/08/111159
- Clear Gate「File Upload RCE Exploitation」: https://www.clear-gate.com/blog/exploiting-a-file-upload-mechanism-to-gain-rce/
- Snyk「Zip Slip Vulnerability」: https://security.snyk.io/research/zip-slip-vulnerability
- Snyk技術白書PDF「Zip Slip」: https://res.cloudinary.com/snyk/image/upload/v1528192501/zip-slip-vulnerability/technical-whitepaper.pdf
- Snyk GitHub「zip-slip-vulnerability」: https://github.com/snyk/zip-slip-vulnerability
- （SVGアップロードXSS writeup）Medium/Kunal Khubchandani「$1000 bounty File Upload to Stored XSS」: https://kunalkhubchandani.medium.com/how-i-was-rewarded-a-1000-bounty-after-abusing-file-upload-functionality-to-stored-xss-945a40ac6f94

### Lv9：ツールと方法論（第9章）

- PayloadsAllTheThings「XXE Injection」README: https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XXE%20Injection/README.md
- BuffaloWill/oxml_xxe: https://github.com/BuffaloWill/oxml_xxe
- PortSwigger/office-open-xml-editor: https://github.com/PortSwigger/office-open-xml-editor
- almandin/fuxploider: https://github.com/almandin/fuxploider
- fuxploider使い方：GeeksforGeeks: https://www.geeksforgeeks.org/linux-unix/fuxploider-file-upload-vulnerability-scanner-and-exploitation-tool/
- 学術（スキャナ限界）arXiv「FUEL: A Framework for Evaluating UFU Scanners」: https://arxiv.org/pdf/2405.16619

### Lv10：実例・ライトアップ・報奨事例（第10章）

- reddelexc/hackerone-reports: https://github.com/reddelexc/hackerone-reports
- reddelexc TOPXXE リスト: https://github.com/reddelexc/hackerone-reports/blob/master/tops_by_bug_type/TOPXXE.md
- reddelexc TOPRCE リスト: https://github.com/reddelexc/hackerone-reports/blob/master/tops_by_bug_type/TOPRCE.md
- Facebook BugBounty Writeups集: https://github.com/jaiswalakshansh/Facebook-BugBounty-Writeups
- Reginaldo Silva「How I found a Remote Code Execution bug affecting Facebook's servers」: https://www.ubercomp.com/posts/2014-01-16_facebook_remote_code_execution
- Bram.us「How I Hacked Facebook with a Word Document」: https://www.bram.us/2014/12/29/how-i-hacked-facebook-with-a-word-document/
- Threatpost「XXE Bug Patched in Facebook Careers Third-Party Service」: https://threatpost.com/xxe-bug-patched-in-facebook-careers-third-party-service/110151/
- SecurityWeek「Facebook Rewards Researcher For Reporting Critical Vulnerability」: https://www.securityweek.com/facebook-rewards-researcher-reporting-critical-vulnerability/
- The Hacker News「Facebook Hacker received $33,500 reward for RCE」: https://thehackernews.com/2014/01/facebook-hacker-received-33500-reward.html

### Lv11：発展・方法論・防御の理解（第11章）

- OWASP「XML External Entity Prevention Cheat Sheet」: https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html
- OWASP CheatSheetSeries GitHub（XXE Prevention原文）: https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.md
- （日本語）GMO Flatt Security「サーバーレスのセキュリティリスク（XXE/SSRF/RCE事例）」: https://blog.flatt.tech/entry/lambda_and_serverless_security
- （日本語・SSRF実例）GMO Flatt Security「GitHubの内部ネットワークにアクセス可能な脆弱性(SSRF)を報告した話」: https://blog.flatt.tech/entry/github_ssrf_h1-512

---

## 付録B：取得できなかった資料

以下は生成時に**原典を直接取得できなかった**資料の一覧である（計 18 件）。理由（HTTP 403/404・DNS 解決失敗・TLS 検証エラー・接続リセット・動的レンダリング・PDF バイナリ・有料リダイレクト等）を併記する。多くは GitHub raw ミラー・同一著者の一次資料・WebSearch 要約・ローカル pdftotext で**実質的な内容を補完済み**だが、最新性・正確性は必ず原典で確認すること。特に Medium / 個人ブログ / GitBook ミラーは内容が妥当でも一次資料での裏取りを推奨する。

| 章 | URL | 未取得の理由と補完方法 |
| --- | --- | --- |
| 第2章 | http://www.securityidiots.com/Web-Pentest/XXE/XXE-Cheat-Sheet-by-SecurityIdiots.html | DNS 解決失敗（getaddrinfo ENOTFOUND）。GitHub ミラーなし。WebSearch 要約と一般知識で補足し、本文に未取得注記を挿入。 |
| 第2章 | https://medium.com/@booruledie/portswigger-web-security-academy-xxe-lab-1-820613089d3d | HTTP 403（Medium のボット取得ブロック）。GitHub ミラーなし。WebSearch 抜粋と一般知識で補足。 |
| 第2章 | https://medium.com/@dipikanta.dutta/portswigger-web-security-academy-labs-xxe-injection-csrf-ssrf-cors-apprentice-level-9b5ec8b26295 | HTTP 403（Medium のボット取得ブロック）。GitHub ミラーなし。WebSearch 抜粋と一般知識で補足。 |
| 第3章 | https://medium.com/@jhncdrcbautista/exploiting-blind-xxe-data-exfiltration-thru-external-dtd-4ac392305b9f | HTTP 403（egress 側で Medium ブロック）。WebSearch で要点回収＋PortSwigger 一次資料で補足。 |
| 第4章 | https://medium.com/infosecmatrix/11-8-lab-exploiting-xxe-via-image-file-upload-2024-e2840c3b85f3 | HTTP 403（Medium ブロック）。WebSearch で同一ペイロード確認、cyberw1ng.medium.com ミラー URL を併記。 |
| 第4章 | https://blackhat.com/docs/us-15/materials/us-15-Vandevanter-Exploiting-XXE-Vulnerabilities-In-File-Parsing-Functionality.pdf | バイナリ PDF のため WebFetch では抽出不可。**ローカル pdftotext でテキスト化し原典の文言・ペイロード・CVE 番号を直接反映済み**（実質取得成功）。 |
| 第4章 | https://hacktricks.wiki/en/pentesting-web/saml-attacks/index.html | 302→402 Payment Required で失敗。**GitHub 原本（HackTricks-wiki/hacktricks の raw）から同内容を取得し反映済み**。 |
| 第4章 | https://silentrobots.com/exploiting-xxe-vulnerabilities-in-oxml-documents-part-1/ | 取得成功だが記事が Part 1 構成で具体ペイロードを続編に留保。取得できた構造・注入先の記述を反映し、残りは一般知識で明示補足。 |
| 第5章 | https://waf-bypass.com/tag/xxe/ | DNS 解決失敗（getaddrinfo ENOTFOUND）。WebSearch（プロトコル前空白・PUBLIC・異種エンコーディング等）と一般知識で補足。 |
| 第5章 | https://swarm.ptsecurity.com/impossible-xxe-in-php/ | TLS 証明書検証エラー（unable to get local issuer certificate）。WebSearch 要約と関連一次資料（Lexfo lightyear ブログ）で補完。 |
| 第5章 | https://airman604.medium.com/from-xxe-to-rce-with-php-expect-the-missing-link-a18c265ea4c7 | HTTP 403（Medium/freedium ミラーも解決不可）。WebSearch 要約と PayloadsAllTheThings 実物で補完。 |
| 第5章 | https://keiran.scot/2022/02/10/exploiting-xxe-vulnerabilities/ | 接続リセット（ECONNRESET）。WebSearch 要約で補完。 |
| 第6章 | https://yashfren.github.io/posts/FileUploadVulnerabilities_PortswiggerLabs_Walkthrough/ | HTTP 404 が継続。GitHub ミラー・Wayback ともに本環境の制約で取得不可。他の walkthrough 資料で代替。 |
| 第6章 | https://www.youtube.com/playlist?list=PLmqenIp2RQcjMBgl4bRtOQ0h6iCBLZZTI | JavaScript 動的レンダリングのため WebFetch でナビゲーションのみ取得。動画本編は未取得（プレイリスト URL のみ提示）。 |
| 第7章 | https://onsecurity.io/article/file-upload-checklist/ | HTTP 403（ミラーは DNS 解決不可、archive.org も取得不可）。WebSearch 要約で代替し本文に未取得注記。 |
| 第7章 | https://hacktricks.wiki/en/pentesting-web/file-upload/index.html | 302→402 Payment Required。**GitHub raw（HackTricks-wiki/hacktricks）から原文相当を取得し完全反映済み**。 |
| 第8章 | https://kunalkhubchandani.medium.com/how-i-was-rewarded-a-1000-bounty-after-abusing-file-upload-functionality-to-stored-xss-945a40ac6f94 | HTTP 403（cache・r.jina.ai も CAPTCHA で不可）。WebSearch 要約のみ利用し、本文に未取得警告＋一般知識で補足。 |
| 第10章 | https://hackerone.com/reports/897244 ほか個別 HackerOne レポート | HTTP 403（JS SPA の認証/レンダリング要求）。WebSearch で各レポートの技術的要点を補完し反映。 |

> **補足**：HackTricks は複数ドメイン（hacktricks.wiki, book.hacktricks.xyz, gitbook.io 系ミラー）に存在し、本環境では `.wiki` が有料リダイレクト（402）を返すことがあった。いずれも **GitHub の原本リポジトリ（HackTricks-wiki/hacktricks）の raw Markdown** から同内容を取得して反映している。Medium の 403 は自動取得ブロックが原因で、ブラウザからは通常閲覧可能。

---

## 付録C：用語集

| 用語 | 説明 |
| --- | --- |
| **XXE** | XML External Entity injection。XML パーサが外部実体を解決する仕様を悪用し、ファイル読取・SSRF・OOB exfiltration・（条件次第で）RCE を引き起こす脆弱性。 |
| **DTD** | Document Type Definition。XML の文書型定義。`<!ENTITY>` による実体宣言を含む。内部サブセット（文書内）と外部サブセット（`SYSTEM`/`PUBLIC` で参照）がある。 |
| **内部実体** | `<!ENTITY name "value">`。文書内で定義される置換テキスト。 |
| **外部実体** | `<!ENTITY name SYSTEM "URI">`。外部 URI の内容を取り込む実体。XXE の中核。 |
| **パラメータ実体** | `<!ENTITY % name ...>`。DTD 内でのみ参照可能（`%name;`）な実体。Blind XXE の exfiltration で多用される。 |
| **SYSTEM / PUBLIC** | 外部識別子。`SYSTEM` は URI 直接指定、`PUBLIC` は公開識別子＋URI。フィルタ回避で `PUBLIC` が使われることがある。 |
| **Blind XXE / OOB XXE** | 実体の値がレスポンスに反映されない XXE。攻撃者サーバへの帯域外（Out-of-Band）通信、またはエラーメッセージ経由でデータを抽出する。 |
| **外部 DTD** | 攻撃者が自前サーバにホストする悪意ある DTD。パラメータ実体のネストでファイル内容を URL に載せて送出させる。 |
| **ローカル DTD 再利用** | 標的ホストに元から存在する DTD（例：GNOME の `/usr/share/yelp/dtd/docbookx.dtd`）を再定義して悪用し、OOB 遮断環境でエラーベース抽出を行う手法（Arseniy Sharoglazov）。 |
| **OAST** | Out-of-band Application Security Testing。Burp Collaborator 等で外部到達を観測する検出手法。 |
| **XInclude** | XML の一部を外部から取り込む仕様。DOCTYPE を制御できない状況でファイル読取に使える。 |
| **OOXML** | Office Open XML。DOCX/XLSX/PPTX の実体は ZIP + 複数 XML。内部 XML のパースで XXE が発火しうる。 |
| **SVG** | Scalable Vector Graphics。XML ベースの画像形式。画像アップロード欄経由の XXE/XSS の代表的入口。 |
| **XMP** | Extensible Metadata Platform。画像に埋め込まれる XML メタデータ。パース経路によっては XXE の入口になる。 |
| **XSLT injection** | XSL 変換エンジンへの注入。ファイル読取や（拡張関数次第で）RCE に繋がる、XXE の関連攻撃。 |
| **Web シェル** | サーバ上でコマンド実行を可能にする、アップロードされたスクリプト（例：PHP の `<?php system($_GET['c']); ?>`）。 |
| **マジックバイト** | ファイル先頭のシグネチャ（例：GIF の `GIF89a`、PNG の `\x89PNG`）。MIME/内容検証を偽装する際に付与する。 |
| **二重拡張子** | `shell.php.jpg` のように複数拡張子を並べ、サーバの拡張子解釈の差を突く手法。 |
| **代替拡張子** | `.phtml`/`.php5`/`.phar` など、ブラックリストが漏らしがちな実行可能拡張子。 |
| **polyglot** | 複数のファイル形式として妥当に解釈されるファイル（例：GIFAR = GIF + JAR）。検証回避に使う。 |
| **.htaccess / web.config** | ディレクトリ単位でサーバ挙動を上書きする設定ファイル。アップロードして任意拡張子の実行を有効化する手口。 |
| **ImageTragick** | CVE-2016-3714。ImageMagick の delegate 機能でシェル特殊文字のフィルタが不十分なため、細工画像で任意コマンド実行が可能になる脆弱性群（兄弟 CVE -3715〜-3718 を含む）。 |
| **Zip Slip** | 展開時にアーカイブ内のパス（`../`）を検証しないことで、意図しない場所にファイルを書き込ませるディレクトリトラバーサル脆弱性。 |
| **fuxploider** | アップロード検証を自動テストするツール。手動理解の補完として使う。 |
| **oxml_xxe** | DOCX/XLSX/PPTX/ODT/SVG/PDF 等に XXE ペイロードを埋め込むツール（BuffaloWill）。 |

---

## 付録D：参考書籍・継続学習リソース

- **PortSwigger Web Security Academy**（XXE 9 ラボ／File upload 7 ラボ）——本書の実機演習の中核。無償。
- **OWASP Cheat Sheet Series**（XML External Entity Prevention / File Upload）——防御設計の一次資料。
- **PayloadsAllTheThings**（XXE Injection / Upload Insecure Files）——ペイロードとツールの体系的リファレンス。
- **HackTricks**（XXE, File Upload, SAML, XSLT）——公式は hacktricks.wiki / book.hacktricks.xyz。ミラーは古い場合あり。
- **The Hacker Recipes**（XXE injection / Unrestricted file upload）——簡潔で正確な技法カタログ。
- **reddelexc/hackerone-reports**（TOPXXE / TOPRCE）——実際に受理された報告から「影響の示し方」を学ぶ。
- **日本語**：MBSD「XXE 攻撃 基本編/応用編」「ImageMagick を使う Web アプリのセキュリティ」、徳丸浩「PHP プログラマのための XXE 入門」、GMO Flatt Security「ファイルアップロード機能の仕様パターンとセキュリティ観点」。

---

[目次](index.md) ｜ [← 第11章 発展・方法論・防御の理解](11-defense-understanding.md)
