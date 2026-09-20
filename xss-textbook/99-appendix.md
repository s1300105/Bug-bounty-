# 付録

- [付録A：全資料一覧（章別）](#付録a全資料一覧章別)
- [付録B：自動取得できなかった資料のまとめ](#付録b自動取得できなかった資料のまとめ)
- [付録C：用語集](#付録c用語集)
- [付録D：参考書籍](#付録d参考書籍)

---

## 付録A：全資料一覧（章別）

本教科書が参照した資料の一覧です。各URLの内容は本文の該当章で解説しています。原典を確認したい場合や、本書で扱いきれなかった細部を追いたい場合は、以下から直接アクセスしてください。

### 第1章 基礎（Lv1）

- PortSwigger: What is XSS and how to prevent it — https://portswigger.net/web-security/cross-site-scripting
- PortSwigger: Reflected XSS — https://portswigger.net/web-security/cross-site-scripting/reflected
- PortSwigger 学習パス index — https://portswigger.net/web-security/learning-paths
- OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- Huli "Beyond XSS"（無料オンライン書籍）英語トップ — https://aszx87410.github.io/beyond-xss/en/
- Huli "Beyond XSS" 日本語版 — https://aszx87410.github.io/beyond-xss/ja/
- YesWeHack: XSS attacks & exploitation ultimate guide — https://www.yeswehack.com/learn-bug-bounty/xss-attacks-exploitation-ultimate-guide
- （日本語）Flatt Security: なぜいまだにXSSは生まれてしまうのか — https://blog.flatt.tech/entry/still_xss
- （日本語）Flatt Security: XSSの発生原理以外の話（リスク） — https://blog.flatt.tech/entry/xss_risk
- （日本語）徳丸浩のブログ — https://blog.tokumaru.org/

### 第2章 コンテキストとペイロード技法（Lv2）

- PortSwigger XSS Cheat Sheet（随時更新、WAFバイパス多数）— https://portswigger.net/web-security/cross-site-scripting/cheat-sheet
- OWASP XSS Filter Evasion Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html
- Invicti: XSS Filter Evasion — Why Filtering Doesn't Stop XSS — https://www.invicti.com/blog/web-security/xss-filter-evasion
- PayloadsAllTheThings: XSS Injection — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XSS%20Injection/README.md
- Masato Kinugawa: filterbypass（ブラウザXSSフィルタ回避チートシート）— https://github.com/masatokinugawa/filterbypass
- （日本語スライド）Masato Kinugawa「XSSフィルターの使い方」Shibuya.XSS #9 — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-9
- （日本語スライド）Masato Kinugawa「5文字で書くJavaScript」Shibuya.XSS #10 — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-10
- （日本語スライド）はせがわようすけ 難読化JavaScript — https://www.docswell.com/s/hasegawa/K9VW8M-jsobfus
- 書籍: Gareth Heyes『JavaScript for hackers』— https://leanpub.com/javascriptforhackers

### 第3章 DOMベースXSS（Lv3）

- PortSwigger: DOM-based XSS — https://portswigger.net/web-security/cross-site-scripting/dom-based
- PortSwigger: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader
- PortSwigger Docs: DOM Invader — https://portswigger.net/burp/documentation/desktop/tools/dom-invader
- PortSwigger Docs: Testing for DOM XSS with DOM Invader — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
- PortSwigger Docs: web message DOM XSS with DOM Invader — https://portswigger.net/burp/documentation/desktop/testing-workflow/input-validation/xss/web-message-dom-xss
- HackTricks: DOM Invader — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html
- Medium (Hacksheets): DOM Invader でDOM XSSを簡単に見つける — https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44
- （日本語スライド）はせがわようすけ JavaScript Security beyond HTML5 — https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823
- （日本語）Flatt Security: SPAにおけるインジェクション（DOM based XSS）— https://blog.flatt.tech/entry/spa_injection
- postMessage経由のDOM XSS入門（YesWeHack）— https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
- Detectify: postMessage XSS on a million sites — https://labs.detectify.com/writeups/postmessage-xss-on-a-million-sites/
- Intigriti: Exploiting postMessage vulnerabilities — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities

### 第4章 高度クラス（Lv4）

**mXSS / サニタイザバイパス**
- Cure53: mXSS Attacks（原典論文PDF）— https://cure53.de/fp170.pdf
- Michał Bentkowski（Securitum）: Mutation XSS via namespace confusion — DOMPurify < 2.0.17 bypass（CVE-2020-26870）— https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/
- Michał Bentkowski 研究インデックス — https://www.bentkowski.info/research/
- Securitum research（Bentkowski著者ページ）— https://research.securitum.com/authors/michal-bentkowski/
- PortSwigger Research (Gareth Heyes): Bypassing DOMPurify again with mutation XSS — https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss
- Daniel Santos (@vovohelo): From SVG and back — DOMPurify < 2.2.2 bypass — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f
- Sonar: mXSS — The Vulnerability Hiding in Your Code — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/
- SonarSource mXSS Cheatsheet（GitHub）— https://github.com/SonarSource/mxss-cheatsheet
- （日本語）Flatt Security (RyotaK): Bypassing DOMPurify with good old XML — https://flatt.tech/research/posts/bypassing-dompurify-with-good-old-xml/
- Huli "Beyond XSS": Bypassing Your Defense — Mutation XSS — https://aszx87410.github.io/beyond-xss/en/ch2/mutation-xss/
- HackerOne: Internet Bug Bounty DOMPurify bypass report #1024734 — https://hackerone.com/reports/1024734

**prototype pollution → XSS**
- s1r1us: Prototype Pollution — https://blog.s1r1us.ninja/research/PP
- BlackFan: client-side-prototype-pollution（gadget集）— https://github.com/BlackFan/client-side-prototype-pollution
- HackTricks: Client Side Prototype Pollution — https://hacktricks.wiki/en/pentesting-web/deserialization/nodejs-proto-prototype-pollution/client-side-prototype-pollution.html
- Huli "Beyond XSS": Prototype Pollution — https://aszx87410.github.io/beyond-xss/en/ch3/prototype-pollution/
- Sonar: RCE via Prototype Pollution in Blitz.js — https://www.sonarsource.com/blog/blitzjs-prototype-pollution/

**DOM clobbering**
- Michał Bentkowski: XSS in GMail's AMP4Email via DOM Clobbering — https://research.securitum.com/xss-in-amp4email-dom-clobbering/
- OWASP: DOM Clobbering Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html
- jackfromeast: dom-clobbering-collection — https://github.com/jackfromeast/dom-clobbering-collection

**CSP バイパス / script gadgets**
- Weichselbaum & Spagnuolo: "CSP Is Dead, Long Live CSP!"（Google Research）— https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/
- DeepSec スライド版 "CSP Is Dead, Long Live Strict CSP!" — https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf
- Google CSP Evaluator（ツール）— https://csp-evaluator.withgoogle.com/
- Lekies/Kotowicz/Vela Nava: Black Hat "Bypassing XSS Mitigations via Script Gadgets"（スライドPDF）— https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf
- Code-Reuse Attacks for the Web（CCS'17 論文PDF）— https://acmccs.github.io/papers/p1709-lekiesA.pdf
- Google: script-gadgets PoC リポジトリ — https://github.com/google/security-research-pocs/tree/master/script-gadgets
- Truesec: Bypassing modern XSS mitigations with code-reuse attacks — https://www.truesec.com/hub/blog/bypassing-modern-xss-mitigations-with-code-reuse-attacks
- PortSwigger Research: Hunting nonce-based CSP bypasses with dynamic analysis — https://portswigger.net/research/hunting-nonce-based-csp-bypasses-with-dynamic-analysis
- Johan Carlsson: CSP bypass on portswigger.net using Google script resources — https://joaxcar.com/blog/2024/02/19/csp-bypass-on-portswigger-net-using-google-script-resources/
- Huli "Beyond XSS": Common CSP Bypasses — https://aszx87410.github.io/beyond-xss/en/ch2/csp-bypass/
- HackTricks: CSP bypass — https://book.hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html

### 第5章 フレームワーク固有のXSS（Lv5）

- PortSwigger: Client-side template injection — https://portswigger.net/web-security/cross-site-scripting/contexts/client-side-template-injection
- PortSwigger Research: XSS without HTML — Client-Side Template Injection with AngularJS — https://portswigger.net/research/xss-without-html-client-side-template-injection-with-angularjs
- HackTricks: Client Side Template Injection (CSTI) — https://hacktricks.wiki/en/pentesting-web/client-side-template-injection-csti.html
- Huli "Beyond XSS": Template Injection in Frontend (CSTI) — https://aszx87410.github.io/beyond-xss/en/ch3/csti/
- Pragmatic Web Security: Preventing XSS in React (Part 2) dangerouslySetInnerHTML — https://pragmaticwebsecurity.com/articles/spasecurity/react-xss-part2.html
- XSS in React（readthedocs）— https://web-security-react.readthedocs.io/en/latest/pages/xss_in_react.html
- AngularJS CSTI 練習ラボ — https://github.com/MrT3acher/angularjs-client-side-template-injection-lab

### 第6章 実例ライトアップ（Lv6）

- Gareth Heyes 個人サイト — https://garethheyes.co.uk/
- Masato Kinugawa: How I Hacked Microsoft Teams and got $150,000 in Pwn2Own（英語スライド）— https://speakerdeck.com/masatokinugawa/how-i-hacked-microsoft-teams-and-got-150000-dollars-in-pwn2own
- （日本語）Masato Kinugawa: Pwn2OwnでMicrosoft Teamsをハッキングして2000万円 — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-12
- Masato Kinugawa Speaker Deck プロフィール — https://speakerdeck.com/masatokinugawa
- Masato Kinugawa: Shadow DOMとセキュリティ Shibuya.XSS #13 — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-13
- Sonar: Reply to calc — The Attack Chain to Compromise Mailspring — https://www.sonarsource.com/blog/reply-to-calc-the-attack-chain-to-compromise-mailspring/
- HackerOne: Simplenote Stored XSS via Markdown SVG filter bypass #271007 — https://hackerone.com/reports/271007
- InfoSec Write-ups: postMessage + AI prompt injection + sandbox escape 連鎖 — https://infosecwriteups.com/postmessage-misconfiguration-ai-prompt-injection-sandbox-escape-xss-data-exfiltration-d1d29821a2de
- HackerOne: How to Find XSS Vulnerabilities — https://www.hackerone.com/blog/how-find-xss-techniques-security-researchers-use-real-environments

### 第7章 ハンズオン（Lv7）

- PortSwigger Web Security Academy（トップ）— https://portswigger.net/web-security
- PortSwigger: All labs — https://portswigger.net/web-security/all-labs
- PortSwigger: Lab — Reflected XSS with some SVG markup allowed — https://portswigger.net/web-security/cross-site-scripting/contexts/lab-some-svg-markup-allowed
- ライトアップ例（Medium, 全Apprentice XSSラボ解説）— https://medium.com/@thanujthilakarathne/portswigger-xss-labs-a-complete-guide-to-all-9-apprentice-level-challenges-6fba56da8635
- prototype pollution 全ラボ ライトアップ — https://medium.com/@awes0me.writes/portswigger-labs-prototype-pollution-writeup-all-labs-9a2534bc8e07
- PortSwigger学習チェックリスト（GitHub）— https://github.com/ashardian/Portswigger_checklist

### 第8章 発展・最先端・防御の理解（Lv8）

- web.dev: Prevent DOM-based XSS with Trusted Types — https://web.dev/articles/trusted-types
- Chrome Developers: Mitigate DOM-based XSS with Trusted Types — https://developer.chrome.com/docs/lighthouse/best-practices/trusted-types-xss
- HackTricks: XSS in Markdown — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/xss-in-markdown.html
- Medium (Jakob Pennington): Exploiting XSS via Markdown — https://medium.com/taptuit/exploiting-xss-via-markdown-72a61e774bf8
- Bugcrowd: The guide to blind XSS — https://www.bugcrowd.com/blog/the-guide-to-blind-xss-advanced-techniques-for-bug-bounty-hunters-worth-250000/
- 徳丸浩: 画像ファイルによるXSS 傾向と対策 — https://blog.tokumaru.org/2007/12/image-xss-summary.html

---

## 付録B：自動取得できなかった資料のまとめ

本教科書の生成はサンドボックス環境（クラウド上のコンテナ）で行われました。この環境の**egress（送信）プロキシは、XSSドキュメントを提供する主要ドメインのほぼ全て**（portswigger.net、owasp.org、medium.com、speakerdeck.com、flatt.tech、research.securitum.com、sonarsource.com、hacktricks.wiki、web.dev、research.google、blackhat.com、cure53.de、blog.tokumaru.org など）への直接アクセスをブロックしました。

そのため、以下の **61 件の資料は「ページ本体を直接取得できませんでした」**。各セクションでは、次の方法で内容を復元しています。

- WebSearch（検索エンジン）の要約・スニペット
- 到達可能だった一次ソース（例: GitHub 上の DOMPurify 公式Wiki/回帰テスト、`aemkei/jsfuck` リポジトリ、CVE 登録情報、各PR）
- 執筆モデルの専門知識による補足（その旨は本文中に明記）

> ⚠️ **重要**: このため、本教科書（特に第4〜8章）の記述は、**原典そのものではなく「復元・要約」に基づく部分が多く含まれます**。技術的な正確性には最大限配慮していますが、**必ず下記の原典URLをご自身で開いて、一次情報を確認してください**。特に mXSS・サニタイザバイパス・CSPガジェットなどのバージョン依存が激しい分野では、原典の確認が不可欠です。

（この一覧は自動生成です。本文中の各「⚠️ 未取得の資料」注記と対応しています。）

| 章 | 資料URL | 状況 |
|----|---------|------|
| 第1章 | https://www.yeswehack.com/learn-bug-bounty/xss-attacks-exploitation-ultimate-guide | WebSearch要約＋専門知識で内容を復元・補完 |
| 第1章 | https://blog.flatt.tech/entry/still_xss | WebSearch要約＋専門知識で内容を復元・補完 |
| 第1章 | https://blog.flatt.tech/entry/xss_risk | WebSearch要約＋専門知識で内容を復元・補完 |
| 第1章 | https://blog.tokumaru.org/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第2章 | https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-10 | WebSearch要約＋専門知識で内容を復元・補完 |
| 第2章 | https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-9 | WebSearch要約＋専門知識で内容を復元・補完 |
| 第2章 | https://www.docswell.com/s/hasegawa/K9VW8M-jsobfus | WebSearch要約＋専門知識で内容を復元・補完 |
| 第2章 | https://leanpub.com/javascriptforhackers | WebSearch要約＋専門知識で内容を復元・補完 |
| 第3章 | https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44 | WebSearch要約＋専門知識で内容を復元・補完 |
| 第3章 | https://blog.flatt.tech/entry/spa_injection | WebSearch要約＋専門知識で内容を復元・補完 |
| 第3章 | https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823 | WebSearch要約＋専門知識で内容を復元・補完 |
| 第3章 | https://labs.detectify.com/writeups/postmessage-xss-on-a-million-sites/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第3章 | https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities | WebSearch要約＋専門知識で内容を復元・補完 |
| 第3章 | https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://cure53.de/fp170.pdf | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://research.securitum.com/authors/michal-bentkowski/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://www.bentkowski.info/research/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://github.com/SonarSource/mxss-cheatsheet | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://aszx87410.github.io/beyond-xss/en/ch2/mutation-xss/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://flatt.tech/research/posts/bypassing-dompurify-with-good-old-xml/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://hackerone.com/reports/1024734 | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://blog.s1r1us.ninja/research/PP | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://aszx87410.github.io/beyond-xss/en/ch3/prototype-pollution/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://www.sonarsource.com/blog/blitzjs-prototype-pollution/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://research.securitum.com/xss-in-amp4email-dom-clobbering/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://csp-evaluator.withgoogle.com/ | 直接取得不可 |
| 第4章 | https://acmccs.github.io/papers/p1709-lekiesA.pdf | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://portswigger.net/research/hunting-nonce-based-csp-bypasses-with-dynamic-analysis | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://www.truesec.com/hub/blog/bypassing-modern-xss-mitigations-with-code-reuse-attacks | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://aszx87410.github.io/beyond-xss/en/ch2/csp-bypass/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第4章 | https://joaxcar.com/blog/2024/02/19/csp-bypass-on-portswigger-net-using-google-script-resources/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第5章 | https://portswigger.net/research/xss-without-html-client-side-template-injection-with-angularjs | WebSearch要約＋専門知識で内容を復元・補完 |
| 第5章 | https://portswigger.net/web-security/cross-site-scripting/contexts/client-side-template-injection | WebSearch要約＋専門知識で内容を復元・補完 |
| 第5章 | https://aszx87410.github.io/beyond-xss/en/ch3/csti/ | 直接取得不可 |
| 第5章 | https://pragmaticwebsecurity.com/articles/spasecurity/react-xss-part2.html | 直接取得不可 |
| 第5章 | https://web-security-react.readthedocs.io/en/latest/pages/xss_in_react.html | 直接取得不可 |
| 第6章 | https://garethheyes.co.uk/ | 直接取得不可 |
| 第6章 | https://speakerdeck.com/masatokinugawa | 直接取得不可 |
| 第6章 | https://speakerdeck.com/masatokinugawa/how-i-hacked-microsoft-teams-and-got-150000-dollars-in-pwn2own | 直接取得不可 |
| 第6章 | https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-12 | 直接取得不可 |
| 第6章 | https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-13 | 直接取得不可 |
| 第6章 | https://hackerone.com/reports/271007 | WebSearch要約＋専門知識で内容を復元・補完 |
| 第6章 | https://www.sonarsource.com/blog/reply-to-calc-the-attack-chain-to-compromise-mailspring/ | WebSearch要約＋専門知識で内容を復元・補完 |
| 第6章 | https://infosecwriteups.com/postmessage-misconfiguration-ai-prompt-injection-sandbox-escape-xss-data-exfiltration-d1d29821a2de | WebSearch要約＋専門知識で内容を復元・補完 |
| 第6章 | https://www.hackerone.com/blog/how-find-xss-techniques-security-researchers-use-real-environments | WebSearch要約＋専門知識で内容を復元・補完 |
| 第7章 | https://portswigger.net/web-security | 直接取得不可 |
| 第7章 | https://portswigger.net/web-security/all-labs | 直接取得不可 |
| 第7章 | https://medium.com/@awes0me.writes/portswigger-labs-prototype-pollution-writeup-all-labs-9a2534bc8e07 | 直接取得不可 |
| 第7章 | https://medium.com/@thanujthilakarathne/portswigger-xss-labs-a-complete-guide-to-all-9-apprentice-level-challenges-6fba56da8635 | 直接取得不可 |
| 第8章 | https://developer.chrome.com/docs/lighthouse/best-practices/trusted-types-xss | WebSearch要約＋専門知識で内容を復元・補完 |
| 第8章 | https://web.dev/articles/trusted-types | WebSearch要約＋専門知識で内容を復元・補完 |
| 第8章 | https://medium.com/taptuit/exploiting-xss-via-markdown-72a61e774bf8 | WebSearch要約＋専門知識で内容を復元・補完 |
| 第8章 | https://blog.tokumaru.org/2007/12/image-xss-summary.html | WebSearch要約＋専門知識で内容を復元・補完 |
| 第8章 | https://www.bugcrowd.com/blog/the-guide-to-blind-xss-advanced-techniques-for-bug-bounty-hunters-worth-250000/ | WebSearch要約＋専門知識で内容を復元・補完 |

---

## 付録C：用語集

本書で繰り返し登場する用語を、簡潔にまとめます。各章の初出時にも説明していますが、忘れたときの参照用です。

| 用語 | 読み/英語 | 説明 |
|------|-----------|------|
| XSS | Cross-Site Scripting | 攻撃者が用意したスクリプトを、被害者のブラウザ上で正規サイトの権限で実行させる脆弱性。 |
| 反射型XSS | Reflected XSS | リクエストに含めた入力が、その場の応答HTMLにそのまま反映されて発火する型。 |
| 格納型XSS | Stored XSS | 入力がサーバに保存され、後で別のユーザーがそのページを開いたときに発火する型。永続型とも。 |
| DOMベースXSS | DOM-based XSS | サーバを介さず、ブラウザ内のJavaScriptがユーザー入力を危険な地点に渡すことで発火する型。 |
| source | ソース | ユーザーが制御できる入力の出発点（例: `location.hash`, `document.referrer`, `postMessage`のdata）。 |
| sink | シンク | 入力が最終的に実行・解釈される危険な代入先（例: `innerHTML`, `eval`, `document.write`）。 |
| ペイロード | payload | 攻撃を成立させるために送り込む具体的な入力（攻撃コード）。 |
| ブレークアウト | breakout | 注入位置のコンテキスト（属性値、JS文字列など）から脱出し、スクリプト実行に持ち込む操作。 |
| ポリグロット | polyglot | 複数のコンテキストで同時に成立するように作られた万能ペイロード。 |
| サニタイズ | sanitize | 入力に含まれる危険な文字列を、無害な形へ変換・除去する処理。 |
| エスケープ/エンコード | escape/encode | 特殊文字を、その文脈で「ただの文字」として扱われる表現に変換すること（例: `<` → `&lt;`）。 |
| WAF | Web Application Firewall | 悪意あるリクエストをパターンで検知・遮断する防御装置。回避の対象になる。 |
| mXSS | Mutation XSS | ブラウザのHTMLパーサが文字列を「読み直した」ときに別物へ変異させる挙動を突くXSS。 |
| サニタイザ | sanitizer | 危険なHTMLを除去して安全なHTMLを返すライブラリ（例: DOMPurify）。 |
| CSP | Content Security Policy | ブラウザに「どこのスクリプトを実行してよいか」を指示する防御ヘッダ。 |
| nonce | ナンス | CSPで「このランダム値を持つ`<script>`だけ実行可」と許可するための一回限りの値。 |
| strict-dynamic | ― | 信頼済みスクリプトが動的に読み込むスクリプトを連鎖的に信頼するCSPのキーワード。 |
| script gadget | スクリプトガジェット | サイトが既に読み込む正規コードの中にある、攻撃に転用できる「善意のコード片」。 |
| コード再利用攻撃 | code-reuse attack | 攻撃コードを注入せず、既存のgadgetを組み合わせて防御を回避する攻撃。 |
| prototype pollution | プロトタイプ汚染 | JavaScriptオブジェクトが共有する原型（`Object.prototype`）を汚染し、既存コードの挙動を乗っ取る攻撃。 |
| DOM clobbering | DOMクロバリング | HTMLの`id`/`name`属性だけで、JavaScriptの変数・関数を上書きする（スクリプト不要の）攻撃。 |
| CSTI | Client-Side Template Injection | フロントエンドのテンプレート機能（AngularJSの`{{ }}`等）へ式を注入して実行させる攻撃。 |
| sandbox escape | サンドボックス脱出 | AngularJSの式評価サンドボックスなど、制限された実行環境から抜け出す技術。 |
| Trusted Types | ― | 危険なDOM sinkへ「信頼済み型」以外の文字列を渡せなくするブラウザ防御機構。 |
| blind XSS | ブラインドXSS | 攻撃者が結果を直接見られない場所（管理画面等）で発火するXSS。外部コールバックで検知する。 |
| OAST | Out-of-band Application Security Testing | 外部サーバへのコールバックで、目に見えない脆弱性の発火を検知する手法。 |
| DOM Invader | ― | Burp Suite内蔵ブラウザの拡張。source→sinkのデータフローを自動追跡しDOM XSSを支援する。 |

---

## 付録D：参考書籍

- **Gareth Heyes『JavaScript for hackers』**：括弧なしペイロード、fuzzing、XSSベクタなどを扱う実践書。Leanpub版（2022-12-21公開、79ページ）とペーパーバック版（Independently published、2022年12月30日、105ページ、ISBN 9798371872166）があり、Amazon/Apple Booksでも販売。— https://leanpub.com/javascriptforhackers
- **『The Web Application Hacker's Handbook』**：PortSwigger創設者 Dafydd Stuttard 著の定番書。Web Security Academyの基礎に相当する内容を体系的にカバーする。

---

（目次へ戻る: [README.md](./README.md)）
