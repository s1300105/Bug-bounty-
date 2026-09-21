# 付録

本書が典拠とした資料を一覧します。原典リンクはロードマップの学習段階（Lv）順に整理しました。

## 付録A：全URL一覧（学習段階順）


## Part A：安全でないデシリアライゼーション


### Lv1. 基礎：シリアライゼーションとは何か、なぜRCEに繋がるか

- [PortSwigger: Insecure deserialization（トピック概要）](https://portswigger.net/web-security/deserialization)
- [PortSwigger: Exploiting insecure deserialization vulnerabilities](https://portswigger.net/web-security/deserialization/exploiting)
- [OWASP: PHP Object Injection（Community、POPチェーンの前提条件）](https://owasp.org/www-community/vulnerabilities/PHP_Object_Injection)
- [日本語：デシリアライゼーション攻撃とは（シス担のミカタ）](https://kobesoft.co.jp/mikata/words/security/deserialization-attack/)
- [日本語：PHPで安全でないデシリアライゼーションを学ぼう（Zenn / shlia）](https://zenn.dev/shlia/articles/f80215c6538f2c)
- [横断解説：Why Every Serialization Format Has a Different RCE Path（DEV/roxdavirox）](https://dev.to/roxdavirox/python-pickle-java-gadget-chains-and-yaml-why-every-serialization-format-has-a-different-rce-path-2o5f)
- [PayloadsAllTheThings: Insecure Deserialization（言語別マジックバイト判定含む）](https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Insecure%20Deserialization)
- [DeepWiki: PayloadsAllTheThings Insecure Deserialization解説](https://deepwiki.com/swisskyrepo/PayloadsAllTheThings/3.8-insecure-deserialization)

### Lv2. PHPオブジェクトインジェクション（入りやすい）

- [PortSwigger ラボ: Modifying serialized objects](https://portswigger.net/web-security/deserialization/exploiting/lab-deserialization-modifying-serialized-objects)
- [PortSwigger ラボ: Using application functionality to exploit insecure deserialization](https://portswigger.net/web-security/deserialization/exploiting/lab-deserialization-using-application-functionality-to-exploit-insecure-deserialization)
- [OWASP: PHP Object Injection](https://owasp.org/www-community/vulnerabilities/PHP_Object_Injection)
- [Demystifying PHP Object Injection（secops.group）](https://secops.group/blog/demystifying-php-object-injection/)
- [PayloadsAllTheThings: PHP Deserialization](https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Insecure%20Deserialization/PHP.md)
- [Vickie Li: PHP Phar Deserialization](https://vickieli.dev/insecure%20deserialization/php-phar/)
- [Exploiting PHP Phar Deserialization（Keysight, Part 1）](https://www.keysight.com/blogs/en/tech/nwvs/2020/07/23/exploiting-php-phar-deserialization-vulnerabilities-part-1)
- [How to exploit the PHAR deserialization vulnerability（Pentest-Tools）](https://pentest-tools.com/blog/exploit-phar-deserialization-vulnerability)
- [SuiteCRM PHAR deserialization to RCE（Snyk）](https://snyk.io/blog/suitecrm-phar-deserialization-vulnerability-to-code-execution/)
- [phpggc（ambionics）リポジトリ](https://github.com/ambionics/phpggc)
- [phpggc解説（Lexfo, Charles Fol）](https://blog.lexfo.fr/php-generic-gadget-chains.html)
- [phpggc（Kali Tools ページ、CLI例）](https://www.kali.org/tools/phpggc/)

### Lv3. Javaデシリアライゼーション ★この分野の中核・最重要

- [Foxglove Security: What Do WebLogic, WebSphere, JBoss, Jenkins, OpenNMS... Have in Common?（Stephen Breen, 2015）](https://foxglovesecurity.com/2015/11/06/what-do-weblogic-websphere-jboss-jenkins-opennms-and-your-application-have-in-common-this-vulnerability/)
- [Dark Reading: Why The Java Deserialization Bug Is A Big Deal](https://www.darkreading.com/application-security/why-the-java-deserialization-bug-is-a-big-deal)
- [Sijmen Ruwhof: Scanning an enterprise organisation for the critical Java deserialization vulnerability](https://sijmen.ruwhof.net/weblog/683-scanning-an-enterprise-organisation-for-the-critical-java-deserialization-vulnerability)
- [PortSwigger（Java例を含むExploitingセクション）](https://portswigger.net/web-security/deserialization/exploiting)
- [K logix Scorpion Labs: Java Deserialization Gadget Chains（CommonsCollections1を1行ずつ解説）](https://www.klogixsecurity.com/scorpion-labs-blog/gadget-chains)
- [ysoserial（frohoff オリジナル）](https://github.com/frohoff/ysoserial)
- [ysoserial（synacktiv メンテナンスフォーク、--inline等の追加機能）](https://github.com/synacktiv/ysoserial)
- [CommonsCollections1 ソース（reflection/InvokerTransformerの流れ）](https://github.com/frohoff/ysoserial/blob/master/src/main/java/ysoserial/payloads/CommonsCollections1.java)
- [Synacktiv: Finding gadgets like it's 2015: part 2（gadget-inspector実践）](https://www.synacktiv.com/en/publications/finding-gadgets-like-its-2015-part-2.html)
- [Moritz Bechler: PSA: Log4Shell and the current state of JNDI injection](https://mbechler.github.io/2021/12/10/PSA_Log4Shell_JNDI_Injection/)
- [Munoz & Mirosh: A Journey From JNDI/LDAP Manipulation to RCE（Black Hat 2016 PDF）](https://www.blackhat.com/docs/us-16/materials/us-16-Munoz-A-Journey-From-JNDI-LDAP-Manipulation-To-RCE.pdf)
- [HackTricks: JNDI & Log4Shell](https://hacktricks.wiki/en/pentesting-web/deserialization/jndi-java-naming-and-directory-interface-and-log4shell.html)
- [Semgrep: Understanding and mitigating Log4Shell](https://semgrep.dev/blog/2021/understanding-log4j-and-log4shell/)
- [MOGWAI LABS: Vulnerability notes Log4Shell](https://mogwailabs.de/en/blog/2021/12/vulnerability-notes-log4shell/)
- [Java Deserialization Scanner（Burp拡張, federicodotta）](https://github.com/federicodotta/Java-Deserialization-Scanner)
- [Java Deserialization Scanner（PortSwigger BApp フォーク）](https://github.com/PortSwigger/java-deserialization-scanner)
- [GadgetProbe（BurpsuiteExtensions, 盲目的クラスパス探索）](https://github.com/BurpsuiteExtensions/GadgetProbe)
- [marshalsec（mbechler, JNDI攻撃サーバ含むアンマーシャラ研究）](https://github.com/mbechler/marshalsec)
- [marshalsec 論文 "Java Unmarshaller Security"（PDF）](https://github.com/mbechler/marshalsec/blob/master/marshalsec.pdf)
- [Knownsec404: Analysis of WebLogic Deserialization (CVE-2018-2628)](https://medium.com/@knownsec404team/analysis-of-weblogic-deserialization-vulnerability-cve-2018-2628-164bbed7a71d)
- [Tenable: Oracle WebLogic ClassFilter Bypass RCE (CVE-2015-4852周辺)](https://www.tenable.com/security/research/tra-2016-09)
- [Sean Melia: Exploiting Java Deserialization Via JBoss（バグバウンティ実例）](https://seanmelia.wordpress.com/2016/07/22/exploiting-java-deserialization-via-jboss/)

### Lv4. .NETデシリアライゼーション

- [ysoserial.net（pwntester）](https://github.com/pwntester/ysoserial.net)
- [Soroush Dalili (@irsdl): Exploiting Deserialisation in ASP.NET via ViewState](https://soroush.me/blog/exploiting-deserialisation-in-asp-net-via-viewstate)
- [NotSoSecure: Exploiting ViewState Deserialization using Blacklist3r and YSoSerial.Net](https://notsosecure.com/exploiting-viewstate-deserialization-using-blacklist3r-and-ysoserial-net)
- [Claranet: Exploiting ViewState Deserialization（同テーマ別解説）](https://www.claranet.com/us/blog/2019-06-13-exploiting-viewstate-deserialization-using-blacklist3r-and-ysoserialnet)
- [NotSoSecure: Path Traversal to Remote Code Execution（MachineKey入手→RCE）](https://notsosecure.com/path-traversal-remote-code-execution)
- [SANS ISC: Stealing Machine Keys for fun and profit (SharePoint)](https://isc.sans.edu/diary/32174)
- [Munoz & Mirosh: Friday the 13th JSON Attacks（Black Hat 2017 白書PDF）](https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf)
- [Friday the 13th JSON Attacks（DEF CON 25 スライドPDF）](https://infocon.org/cons/DEF%20CON/DEF%20CON%2025/DEF%20CON%2025%20presentations/DEF%20CON%2025%20-%20Alvaro-Munoz-JSON-attacks.pdf)
- [Friday the 13th: Attacking JSON（動画, AppSecUSA 2017）](https://www.youtube.com/watch?v=NqHsaVhlxAQ)

### Lv5. Python / Ruby / Node.js

- [David Hamann: Exploiting Python pickle](https://davidhamann.de/2020/04/05/exploiting-python-pickle/)
- [PentesterLab Glossary: Python Pickle](https://pentesterlab.com/glossary/python-pickle)
- [Huntr: Pkl Rick'd — How Loading a .pkl File Can Lead to RCE](https://blog.huntr.com/pickle-rickd-how-loading-a-malicious-pickle-can-pwn-your-machine)
- [arXiv: PickleBall: Secure Deserialization of Pickle-based ML Models（背景理解の1次寄り）](https://arxiv.org/abs/2508.15987)
- [arXiv: A Large-Scale Exploit Instrumentation Study of AI/ML Supply Chain Attacks in Hugging Face Models（59%が危険形式、実際に14件の悪意モデルを検出）](https://arxiv.org/pdf/2410.04490)
- [devcraft (William Bowling): Universal Deserialisation Gadget for Ruby 2.x-3.x](https://devcraft.io/2021/01/07/universal-deserialisation-gadget-for-ruby-2-x-3-x.html)
- [Staaldraad: Universal RCE with Ruby YAML.load (versions > 2.7)](https://staaldraad.github.io/post/2021-01-09-universal-rce-ruby-yaml-load-updated/)
- [Bishop Fox (Ben Lincoln): Ruby Vulnerabilities: Exploiting Open, Send, and Deserialization](https://bishopfox.com/blog/ruby-vulnerabilities-exploits)
- [elttam: Ruby 4.0 Universal RCE Deserialization Gadget Chain（Luke Jahnke系譜、年表付き）](https://www.elttam.com/blog/ruby-4-0-universal-rce-deserialization-gadget-chain)
- [Trail of Bits: Marshal madness — A brief history of Ruby deserialization exploits](https://blog.trailofbits.com/2025/08/20/marshal-madness-a-brief-history-of-ruby-deserialization-exploits/)
- [nastystereo (Luke Jahnke): Ruby 3.4 Universal RCE Deserialization Gadget Chain](https://nastystereo.com/security/ruby-3.4-deserialization.html)
- [GitHub Security Lab (Peter Stöckli): Execute commands by sending JSON?（Ruby unsafe deserialization）](https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/)
- [GitHubSecurityLab: ruby-unsafe-deserialization（PoC集）](https://github.com/GitHubSecurityLab/ruby-unsafe-deserialization)
- [Behrad's Blog: Hunting for Deserialization Gadgets in the Rails Ecosystem](https://behradtaher.dev/Hunting-for-Deserialization-Gadgets/)
- [OpSecX (Ajin Abraham): Exploiting Node.js deserialization bug for RCE（node-serialize, CVE-2017-5941）](https://opsecx.com/index.php/2017/02/08/exploiting-node-js-deserialization-bug-for-remote-code-execution/)
- [node-serialize（npm）](https://www.npmjs.com/package/node-serialize)
- [node-serialize IIFE攻撃の原Issue（luin/serialize #4, ajinabrahamによる報告）](https://github.com/luin/serialize/issues/4)

### Lv6. デシリアライゼーションの発展・ツール・方法論

- [GadgetInspector（JackOfMostTrades, Black Hat USA 2018）](https://github.com/JackOfMostTrades/gadgetinspector)
- [Ian Haken: Automated Discovery of Deserialization Gadget Chains（Black Hat スライドPDF）](https://i.blackhat.com/us-18/Thu-August-9/us-18-Haken-Automated-Discovery-of-Deserialization-Gadget-Chains.pdf)
- [Ian Haken: 同 白書（wp）PDF](https://data.hackinn.com/ppt/BlackHat-USA-2018/us-18-Haken-Automated-Discovery-of-Deserialization-Gadget-Chains-wp.pdf)
- [Black Hat USA 2018 講演動画](https://www.youtube.com/watch?v=fdctNIt8OIw)
- [arXiv: ODDFUZZ — Discovering Java Deserialization Vulnerabilities via Directed Greybox Fuzzing（自動化ツールの検出力比較）](https://arxiv.org/pdf/2304.04233)
- [AppSecCali 2015 "Marshalling Pickles"（Frohoff & Lawrence, ysoserialの起点。ysoserial README経由で参照）](https://github.com/frohoff/ysoserial)

## Part B：サーバサイドテンプレートインジェクション（SSTI）


### Lv7. SSTIの基礎

- [PortSwigger: Server-side template injection（トピック概要）](https://portswigger.net/web-security/server-side-template-injection)
- [PortSwigger Research: Server-Side Template Injection（James Kettle, 2015、起点論文）](https://portswigger.net/research/server-side-template-injection)
- [PortSwigger Research: Template Injection Research ハブ](https://portswigger.net/research/template-injection)
- [PortSwigger ラボ: Basic server-side template injection（ERB）](https://portswigger.net/web-security/server-side-template-injection/exploiting/lab-server-side-template-injection-basic)
- [GoSecure: Template Injection in Action（decision treeワークショップ）](https://gosecure.github.io/template-injection-workshop/)
- [PayloadsAllTheThings: SSTI（README、検出手法）](https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Server%20Side%20Template%20Injection)
- [HackTricks: SSTI（index、全エンジン横断）](https://hacktricks.wiki/en/pentesting-web/ssti-server-side-template-injection/index.html)
- [日本語：SSTIという脆弱性に関する紹介（パーソルクロステクノロジー）](https://staff.persol-xtech.co.jp/corporate/security/article.html?id=94)
- [日本語：サーバーサイド・テンプレートインジェクション（SSTI）とは？（Classmethod Security）](https://www.classmethod-security.jp/post/_ssti)
- [SSTIラボ ウォークスルー動画（PortSwigger向け, YouTube playlist）](https://www.youtube.com/playlist?list=PL1GDzLoRwyVCEG_dnWcQDbDXJSBw7lTOT)

### Lv8. エンジン別SSTIエクスプロイト ★実践の核・サンドボックス脱出

- [HackTricks: Jinja2 SSTI（サンドボックス脱出詳解）](https://hacktricks.wiki/en/pentesting-web/ssti-server-side-template-injection/jinja2-ssti.html)
- [OnSecurity: Server Side Template Injection with Jinja2（フィルタ回避 `.`/`_`/`[]`/`|join`）](https://onsecurity.io/article/server-side-template-injection-with-jinja2/)
- [pequalsnp-team: Cheatsheet - Flask & Jinja2 SSTI](https://pequalsnp-team.github.io/cheatsheet/flask-jinja2-ssti)
- [R3d Buck3T (Nairuz Abulhul): RCE with Server-Side Template Injection](https://medium.com/r3d-buck3t/rce-with-server-side-template-injection-b9c5959ad31e)
- [GreHack 2021: Optimizing SSTI payloads for Jinja2（最短ペイロード探索の方法論）](https://www.researchgate.net/publication/378299322_GreHack_2021_-_Optimizing_Server_Side_Template_Injection_payloads_for_Jinja2)
- [PayloadsAllTheThings: SSTI Python（Mako, Tornado含む）](https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/Python.md)
- [PayloadsAllTheThings: SSTI PHP](https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/PHP.md)
- [PayloadsAllTheThings: SSTI Java（EL/SpEL、複数式構文）](https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/Java.md)
- [Armaan Pathan: RCE via SSTI in FreeMarker（CVE-2021-25770周辺、Executeクラス）](https://medium.com/@armaanpathan/breaking-the-barrier-remote-code-execution-via-ssti-in-freemarker-template-engine-9797079752ac)
- [Synack: Discovering a SSTI Vuln in FreeMarker（バグバウンティ実例）](https://www.synack.com/exploits-explained/exploits-explained-discovering-a-server-side-template-injection-vuln-in-freemarker/)
- [PayloadsAllTheThings: SSTI JavaScript](https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md)
- [Payloadplayground: SSTI cheatsheet（エンジン別テスト式一覧）](https://payloadplayground.com/cheatsheets/ssti)

### Lv9. SSTIツールと実例

- [SSTImap（vladko312, 対話的インターフェース）](https://github.com/vladko312/SSTImap)
- [tplmap（epinna, 15+エンジン対応）](https://github.com/epinna/tplmap)
- [InfoSec Write-ups: Deep Dive into SSTI（検出→RCEの実践フロー）](https://infosecwriteups.com/deep-dive-into-ssti-finding-and-exploiting-server-side-template-injection-like-a-pro-bd018ee7ab69)
- [HackerOne #125980: uber.com RCE by Flask Jinja2 Template Injection（Orange Tsai。riders.uber.comのプロフィール名に `{{ '7'*7 }}` を注入しメール本文に「7777777」を確認、Uber報奨 $10,000、2016年4月6日開示。reddelexc集計のTop RCE上位）](https://hackerone.com/reports/125980)
- [HackerOne #164224: Unikrn — SSTI via Smarty allows RCE（yaworsk）](https://hackerone.com/reports/164224)
- [Intigriti Bug Bytes #13: Handlebars template injection and RCE in a Shopify app（$10,000, 未知エンジン特定→RCE）](https://blog.intigriti.com/2019/04/09/bug-bytes-13-shopify-rce-0xpatriks-interview-xss-in-google-search/)
- [Gaurav Narwani: Injecting {{6*200}} to $1200（パスワードリセットのusernameでSSTI）](https://gauravnarwani.com/injecting-6200-to-1200/)

## Part C：統合・発展


### Lv10. 実例・ライトアップ・CVE（実際に受理された脆弱性を学ぶ）

- [reddelexc/hackerone-reports: Top SSTI reports / Top RCE reports（HackerOne実報告の分類集）](https://github.com/reddelexc/hackerone-reports)
- [HackerOne #502758: Starbucks RCE and Complete Server Takeover（報告者 Eugene Lim / @spaceraccoon、.NETデシリアライゼーション。Starbucks側トリアージは「有効な攻撃でRCEとターゲットの完全な侵害を実証、脆弱サイトはオフラインにした」と評価。報奨額は黒塗り／非公開）](https://hackerone.com/reports/502758)
- [Orange Tsai: How I Chained 4 Vulnerabilities on GitHub Enterprise → RCE](https://blog.orange.tw/2017/07/how-i-chained-4-vulnerabilities-on.html)
- [Orange Tsai: How I Chained 4 Bugs into RCE on Amazon（Seam/XStream/FastJSON）](https://blog.orange.tw/posts/2018-08-how-i-chained-4-bugs-features-into-rce-on-amazon/)
- [exploit-db: IBM WebSphere RCE Java Deserialization (CVE-2015-7450, Metasploit)](https://www.exploit-db.com/exploits/41613)

### Lv11. 発展・方法論・防御の理解（攻撃視点での回避）

- [Trail of Bits: Marshal madness（防御と回避の歴史、Ruby）](https://blog.trailofbits.com/2025/08/20/marshal-madness-a-brief-history-of-ruby-deserialization-exploits/)
- [Bishop Fox: Ruby Vulnerabilities（Open/Send/Deserializationの防御バイパス視点）](https://bishopfox.com/blog/ruby-vulnerabilities-exploits)
- [arXiv: PickleBall（安全なpickleデシリアライズ研究＝防御の最前線）](https://arxiv.org/abs/2508.15987)
- [GitHub Security Lab: Execute commands by sending JSON?（CodeQLでの検出＝防御自動化）](https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/)
- [Synacktiv: Finding gadgets like it's 2015: part 2（現代のガジェット探索の実務）](https://www.synacktiv.com/en/publications/finding-gadgets-like-its-2015-part-2.html)
- [spaceraccoonブログの正確なスラッグ未確認：HackerOne #502758は確認済みだが、対応する個人ブログ記事の正確なURLは未特定。spaceraccoon.dev（https://spaceraccoon.dev/）から辿ること。](https://spaceraccoon.dev/）から辿ること。)

## 付録B：取得できなかった／間接取得にとどまった資料

以下の原典は、本書の生成時に直接取得できなかった（403/402、JavaScript描画、接続断、DNSエラー等）か、間接的にしか取得できなかったものです。該当章では同一研究の別資料・WebSearch・一般知識で内容を補完し、本文中に注記を入れています。原典に当たる際の参考にしてください。

| 章/節ID | URL | 状況 |
|---|---|---|
| `s3a_java_classics` | https://www.darkreading.com/application-security/why-the-java-deserialization-bug-is-a-big-deal | WebFetchがHTTP 403 Forbiddenを返し直接取得不可。WebSearchで要旨を取得し本文に反映、原文へのリンクも本文中に明記した。 |
| `s3b_gadget_chains` | https://www.klogixsecurity.com/scorpion-labs-blog/gadget-chains | 記事本文はWebFetchで取得できたが、記事内のクラス関係図（画像）はテキスト抽出できず未取得。本文中に注記を挿入済み。 |
| `s3d_jndi_log4shell` | https://hacktricks.wiki/en/pentesting-web/deserialization/jndi-java-naming-and-directory-interface-and-log4shell.html | リダイレクト先（tollbit.hacktricks.wiki）がHTTP 402 Payment Requiredを返し取得不可。代替ミラーも無く、Log4Shellのペイロード/難読化・CVE詳細はWebSearchとBechler記事・Apache勧告の一般知識で補完し、本文に未取得資料の警告ボックスを挿入した。 |
| `s3d_jndi_log4shell` | https://www.blackhat.com/docs/us-16/materials/us-16-Munoz-A-Journey-From-JNDI-LDAP-Manipulation-To-RCE.pdf | WebFetchのテキスト抽出は失敗（バイナリPDF）したが、ローカル保存されたPDFをReadツールでページ画像として読み取り、技術内容を完全に抽出できたため実質的に取得成功。inaccessibleではあるが内容は反映済み。 |
| `s3h_java_cves` | https://medium.com/@knownsec404team/analysis-of-weblogic-deserialization-vulnerability-cve-2018-2628-164bbed7a71d | WebFetchでHTTP 403 Forbidden（アクセスブロック）。web.archive.org経由の再取得も環境ポリシーでブロックされたため、WebSearchで得られた関連情報（CVSS、対象バージョン、ClassFilter/MarshalledObjectバイパスの概要）と一般知識で補足し、本文中に取得不可の警告注記を挿入した。 |
| `s4c_json_attacks` | https://infocon.org/cons/DEF%20CON/DEF%20CON%2025/DEF%20CON%2025%20presentations/DEF%20CON%2025%20-%20Alvaro-Munoz-JSON-attacks.pdf | infocon.orgへの接続がread ECONNRESETで切断され、複数回試行しても取得できなかった。同一研究の白書(URL1)を全文取得できたため内容を代替。 |
| `s4c_json_attacks` | https://www.youtube.com/watch?v=NqHsaVhlxAQ | YouTubeページからは字幕・トランスクリプトが取得できず、ナビゲーション/フッター要素のみが返り実質内容を抽出できなかった。同一著者・同一研究の白書(URL1)で内容を代替。 |
| `s5f_nodejs` | https://www.npmjs.com/package/node-serialize | WebFetchでHTTP 403 Forbiddenが返却されブロックされたため、WebSearchによる代替情報収集で補完した |
| `s6a_gadgetinspector` | https://data.hackinn.com/ppt/BlackHat-USA-2018/us-18-Haken-Automated-Discovery-of-Deserialization-Gadget-Chains-wp.pdf | DNS解決エラー（getaddrinfo ENOTFOUND data.hackinn.com）。同一発表のスライドPDF（i.blackhat.com）を取得済みのため内容は実質的に補完済み。 |
| `s7d_ssti_japanese` | https://www.youtube.com/playlist?list=PL1GDzLoRwyVCEG_dnWcQDbDXJSBw7lTOT | プレイリストページの動画一覧はJavaScriptによる動的読み込みで構成されており、WebFetchによる静的取得ではページのフッターナビゲーション要素のみが返され、収録動画のタイトル一覧や説明文が得られなかった。WebSearchで関連動画タイトルの一部を補完した。 |
| `s8a_jinja2_escape` | https://hacktricks.wiki/en/pentesting-web/ssti-server-side-template-injection/jinja2-ssti.html | 302リダイレクト先のtollbitプロキシが402 Payment Requiredを返した。GitHub原本(HackTricks-wiki/hacktricks)のrawミラーから同一内容を取得して代替。 |
| `s8a_jinja2_escape` | https://onsecurity.io/article/server-side-template-injection-with-jinja2/ | 403 Forbidden。WebSearch経由の同記事要約と、内容が一致するHackTricks原本から再構成。 |
| `s8a_jinja2_escape` | https://medium.com/r3d-buck3t/rce-with-server-side-template-injection-b9c5959ad31e | 403 Forbidden。Google翻訳ミラー(medium-com.translate.goog)経由で同記事の検出手順・RCEペイロードを取得して代替。 |
| `s8b_jinja2_optimization` | https://www.researchgate.net/publication/378299322_GreHack_2021_-_Optimizing_Server_Side_Template_Injection_payloads_for_Jinja2 | WebFetchでHTTP 403 Forbidden。ただし同一著者Podaliriusの公開ページ(podalirius.net)から同一論文の解説記事を取得でき、技術内容はそこから記述した。 |
| `s8b_jinja2_optimization` | https://tollbit.hacktricks.wiki/en/pentesting-web/ssti-server-side-template-injection/jinja2-ssti.html | 補足参照として試行したがHTTP 402 Payment Required。担当2資料でカバーできたため影響なし。 |
| `s8d_freemarker` | https://medium.com/@armaanpathan/breaking-the-barrier-remote-code-execution-via-ssti-in-freemarker-template-engine-9797079752ac | WebFetchでHTTP 403 Forbiddenが返却され本文を直接取得できなかった。代替としてWebSearchの要約と同一手法を扱う別記事(blogs.sayaan.in)で技術内容を裏取りし、本文中に注記を挿入した。 |
| `s8e_js_ssti_cheatsheet` | https://payloadplayground.com/cheatsheets/ssti | 取得自体は成功したが、内容がJinja2/Twig/FreeMarker/ERB/Velocity/Thymeleaf/SpEL/Pebble向けの汎用SSTIチートシートであり、担当URL文脈が示唆するJavaScript(Handlebars/Pug/EJS/Nunjucks)エンジン固有の記載は含まれていなかった(再確認クエリで明示的に確認済み)。本文中でその旨を記載し、転用可能な検知方法論のみ補足として引用した。 |
| `s9a_ssti_tools` | https://infosecwriteups.com/deep-dive-into-ssti-finding-and-exploiting-server-side-template-injection-like-a-pro-bd018ee7ab69 | WebFetchでHTTP 403 Forbiddenが返却され本文取得不可。gi=パラメータ付きURLでも再試行したが同様に403。WebSearchのスニペットで内容を補足した。 |
| `s9b_ssti_reports` | https://hackerone.com/reports/125980 | WebFetchで直接取得すると本文が空(「HackerOne」のみ)でJS描画コンテンツのため取得不可。WebSearchおよびorange.tw原著者ブログ(リダイレクトのみ取得できず)で代替情報を収集し本文に反映した。 |
| `s9b_ssti_reports` | https://hackerone.com/reports/164224 | WebFetchで直接取得すると本文が空(「HackerOne」のみ)でJS描画コンテンツのため取得不可。WebSearchで代替情報を収集し本文に反映した。 |
| `s10a_report_collections` | https://hackerone.com/reports/502758 | 直接WebFetchはクライアントサイドレンダリングのプレースホルダのみ返却。web.archive.orgへのアクセスは環境からブロック。関連ブログ(spaceraccoon.dev)やMedium記事も本件の技術詳細に言及したものが見つからず、報告本文の一次情報（具体的ペイロード・修正経緯）は確認不可 |
| `s10c_cve_exploit` | https://hackerone.com/reports/502758 | WebFetchで取得した内容がページヘッダーのみで、動的レンダリングされる本文(脆弱性詳細・タイムライン・PoC)が抽出できなかった。WebSearchで断片情報(タイトル、報奨金$4,000、'RCE and Complete Server Takeover'という要約)は得られたため、これを基に一般知識で簡潔補足し、本文中に取得不可の注記を明記した。代替として、同じ脆弱性チェーンを詳細に解説する著者本人のブログ記事本文をWebFetchで取得し、技術的核心はそちらでカバーした。 |

## 付録C：用語集

- **シリアライゼーション / デシリアライゼーション**：オブジェクトをバイト列や文字列に変換する処理と、その逆変換。逆変換時に信頼できない入力を処理すると脆弱性になる。
- **ガジェット**：単体では正常な、既存クラスのメソッドや処理断片。攻撃者はこれを連鎖させて任意処理を実現する。
- **ガジェットチェーン / POPチェーン**：複数のガジェットを数珠つなぎにして最終的にコード実行へ至らせる連鎖。PHPでは Property-Oriented Programming (POP) チェーンと呼ぶ。
- **マジックメソッド**：`__wakeup`/`__destruct`/`__toString`（PHP）、`readObject`（Java）、`__reduce__`（Python pickle）など、復元時に自動的に呼ばれるメソッド。チェーンの発火点。
- **PHARデシリアライゼーション**：PHPで、`phar://`ストリームラッパー経由でメタデータがunserializeされる性質を悪用し、明示的なunserialize呼び出しなしにPOPチェーンを発火させる手法。
- **ysoserial / phpggc / ysoserial.net**：それぞれJava/PHP/.NET向けの、既知ガジェットチェーンを含むペイロード生成ツール。
- **JNDI Injection / Log4Shell**：JNDI（Java Naming and Directory Interface）のルックアップに攻撃者制御のLDAP/RMI URLを注入し、遠隔クラスロードでRCEに至らせる系統。Log4Shell（CVE-2021-44228）はその代表例。
- **ViewState / MachineKey**：ASP.NET Webフォームがクライアントに持ち回らせる状態（`__VIEWSTATE`）と、その署名・暗号に使う鍵。MachineKey漏洩は署名付き悪意ViewStateの作成を許す。
- **SSTI（サーバサイドテンプレートインジェクション）**：テンプレートエンジンが攻撃者の入力を式として評価してしまう脆弱性。`{{7*7}}` が `49` になるかで一次検出する。
- **サンドボックス脱出**：Jinja2の`__class__`/`__mro__`/`__subclasses__`のように、制限された評価環境から汎用的なコード実行フローへ復帰する技術。
- **safetensors**：MLモデルの重みを、任意コード実行を伴わずに安全にシリアライズする形式。pickleベースのモデルファイルに対する防御策。
- **look-ahead deserialization**：デシリアライズ実行前にクラス名を検査し、許可リスト外の型を拒否する防御手法。

## 付録D：さらに学ぶための一次・二次資料

- James Kettle, *Server-Side Template Injection: RCE for the Modern Web App*（Black Hat USA 2015 白書）— SSTIの起点。
- Frohoff & Lawrence, *Marshalling Pickles*（AppSecCali 2015）— Javaデシリアライゼーション近代攻撃の起点（ysoserial）。
- Munoz & Mirosh, *A Journey From JNDI/LDAP Manipulation to RCE*（Black Hat 2016）/ *Friday the 13th JSON Attacks*（Black Hat 2017）。
- Cao et al., *Efficient Detection of Java Deserialization Gadget Chains*; ODDFUZZ（arXiv:2304.04233）— 自動ガジェット探索の評価。
- Casey, Santos & Mirakhorli, *A Large-Scale Exploit Instrumentation Study of AI/ML Supply Chain Attacks in Hugging Face Models*（arXiv:2410.04490）。
- PickleBall（arXiv:2508.15987, CCS 2025）— pickleの安全なデシリアライズ研究。
- OWASP: A08:2021 Software and Data Integrity Failures; PortSwigger Web Security Academy（Deserialization / SSTI）。

---

### ナビゲーション

- ← 前の章: [第11章 防御の理解と回避技術の最前線](11-defense-and-evasion.md)
- 🏠 [目次（ホーム）](index.md)
