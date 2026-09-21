# 安全でないデシリアライゼーション & SSTI → RCE 到達 学習ロードマップ

## TL;DR

- デシリアライゼーションとSSTIはどちらも「信頼できない入力がコード実行に化ける」脆弱性で、バグバウンティでCritical/RCEとして受理される。武器化の核は「ガジェットチェーン構築」と「サンドボックス脱出」であり、自動ツールが苦手な人間の実力差が出る領域。
- 学習順序は Part A デシリアライゼーション（Lv1基礎→Lv2 PHP→Lv3 Java★→Lv4 .NET→Lv5 Python/Ruby/Node→Lv6 発展/ツール）→ Part B SSTI（Lv7基礎→Lv8エンジン別★→Lv9ツール/実例）→ Part C（Lv10実例/CVE→Lv11発展/防御）が最短。
- 各段階に実在URL（2次資料中心）を多数掲載。PortSwigger Web Security Academyのラボで手を動かし、ysoserial/phpggc/ysoserial.net/SSTImapを実際に走らせ、HackerOneの実報告とCVEで「現実の受理事例」を学ぶこと。

## Key Findings

- **PortSwigger Web Security Academy** がデシリアライゼーション/SSTIの両方に無料ラボを備えており、実践学習の中心に据えるべき。SSTIは James Kettle の「Server-Side Template Injection: RCE for the Modern Web App」（Black Hat USA 2015 白書）が起点で、FreeMarker・Velocity・Smarty・Twig・Jade の5大エンジンで汎用エクスプロイトとサンドボックス脱出を実証した。同論文は「テンプレートインジェクションは明示的に探した監査者にしか見えず、誤って低深刻度に見えることがある」と結んでおり、まさに人間が意図的に探しに行く価値がある脆弱性である。
- **Javaデシリアライゼーション**はこの分野の中核。2015年のFoxglove Security記事とAppSecCali "Marshalling Pickles"（Frohoff & Lawrence）→ ysoserial が現代的攻撃の出発点。CommonsCollectionsチェーンの内部（reflection / InvocationHandler / InvokerTransformer）を読み解けるかが実力の分水嶺。
- **ガジェットチェーン発見の自動化**（GadgetInspector, ODDFuzz）には静的解析の明確な限界がある。Cao et al.（"Efficient Detection of Java Deserialization Gadget Chains via Bottom-up Gadget Search"）の評価では GadgetInspector の誤検知率は 97.6% に達し、ODDFuzz論文（arXiv:2304.04233）でも ysoserial の既知34チェーンのうち GadgetInspector は3件・SerHybrid は2件しか検出できなかった（ODDFuzz は16件を誤検知ゼロで検出）。手動のチェーン読解・構築力が依然として決定的。
- **SSTIサンドボックス脱出**はJinja2の`__class__`/`__mro__`/`__subclasses__`を使ったPython実行フロー復帰が典型。フィルタ回避（`.`・`_`・`[]`の禁止回避）まで習得すると武器になる。
- **AIセキュリティ接続点**：Python pickleの`__reduce__`によるMLモデルファイル（.pkl/joblib/PyTorch）のRCEは現在ホットな領域。Casey, Santos & Mirakhorli（arXiv:2410.04490, 2024）はHugging Face上の22,834モデルファイル中13,466件（59%）が安全でないシリアライズ形式を使用し、解析した12,973件のうち14件が実際に悪意あるモデル（うち9件=64%が外部ソケットに接続）で、Hugging Faceのスキャナは8,329件（62%）を見逃したと報告している。防御はsafetensors。

## Details

### Part A：安全でないデシリアライゼーション

---

#### Lv1. 基礎：シリアライゼーションとは何か、なぜRCEに繋がるか

**なぜ必要か**：全言語共通の「マジックメソッド／ガジェット／POPチェーン」という概念枠組みを先に固めると、以降の言語別学習が一気に加速する。
**習得できること**：シリアライズ/デシリアライズの仕組み、信頼できないデータの危険性、OWASPでの位置づけ（2017 A8:Insecure Deserialization → 2021 A08:Software and Data Integrity Failures）、ガジェット/チェーン/マジックメソッドの概念。

- PortSwigger: Insecure deserialization（トピック概要） — https://portswigger.net/web-security/deserialization
- PortSwigger: Exploiting insecure deserialization vulnerabilities — https://portswigger.net/web-security/deserialization/exploiting
- OWASP: PHP Object Injection（Community、POPチェーンの前提条件） — https://owasp.org/www-community/vulnerabilities/PHP_Object_Injection
- 日本語：デシリアライゼーション攻撃とは（シス担のミカタ） — https://kobesoft.co.jp/mikata/words/security/deserialization-attack/
- 日本語：PHPで安全でないデシリアライゼーションを学ぼう（Zenn / shlia） — https://zenn.dev/shlia/articles/f80215c6538f2c
- 横断解説：Why Every Serialization Format Has a Different RCE Path（DEV/roxdavirox） — https://dev.to/roxdavirox/python-pickle-java-gadget-chains-and-yaml-why-every-serialization-format-has-a-different-rce-path-2o5f
- PayloadsAllTheThings: Insecure Deserialization（言語別マジックバイト判定含む） — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Insecure%20Deserialization
- DeepWiki: PayloadsAllTheThings Insecure Deserialization解説 — https://deepwiki.com/swisskyrepo/PayloadsAllTheThings/3.8-insecure-deserialization

---

#### Lv2. PHPオブジェクトインジェクション（入りやすい）

**なぜ必要か**：serialize文字列が人間可読で、POPチェーンの概念を最小コストで体得できる。バグバウンティでも現役。
**習得できること**：serialize/unserialize、`__wakeup`/`__destruct`/`__toString`、POPチェーン構築、PHARデシリアライゼーション（unserialize呼び出しなしで発火）、phpggcでの自動生成。

- PortSwigger ラボ: Modifying serialized objects — https://portswigger.net/web-security/deserialization/exploiting/lab-deserialization-modifying-serialized-objects
- PortSwigger ラボ: Using application functionality to exploit insecure deserialization — https://portswigger.net/web-security/deserialization/exploiting/lab-deserialization-using-application-functionality-to-exploit-insecure-deserialization
- OWASP: PHP Object Injection — https://owasp.org/www-community/vulnerabilities/PHP_Object_Injection
- Demystifying PHP Object Injection（secops.group） — https://secops.group/blog/demystifying-php-object-injection/
- PayloadsAllTheThings: PHP Deserialization — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Insecure%20Deserialization/PHP.md
- Vickie Li: PHP Phar Deserialization — https://vickieli.dev/insecure%20deserialization/php-phar/
- Exploiting PHP Phar Deserialization（Keysight, Part 1） — https://www.keysight.com/blogs/en/tech/nwvs/2020/07/23/exploiting-php-phar-deserialization-vulnerabilities-part-1
- How to exploit the PHAR deserialization vulnerability（Pentest-Tools） — https://pentest-tools.com/blog/exploit-phar-deserialization-vulnerability
- SuiteCRM PHAR deserialization to RCE（Snyk） — https://snyk.io/blog/suitecrm-phar-deserialization-vulnerability-to-code-execution/
- **phpggc**（ambionics）リポジトリ — https://github.com/ambionics/phpggc
- phpggc解説（Lexfo, Charles Fol） — https://blog.lexfo.fr/php-generic-gadget-chains.html
- phpggc（Kali Tools ページ、CLI例） — https://www.kali.org/tools/phpggc/

---

#### Lv3. Javaデシリアライゼーション ★この分野の中核・最重要

**なぜ必要か**：エンタープライズ製品（WebLogic, WebSphere, JBoss, Jenkins等）で頻出し、報奨額も大きい。ガジェットチェーンの内部理解が「他人のペイロードを流すだけ」から「新規チェーンを作れる」への飛躍点。
**習得できること**：Javaシリアライズ形式（マジックバイト `ac ed 00 05`）、`readObject`、ysoserialのCommonsCollections/Spring/Groovyチェーン、reflection/InvocationHandler/InvokerTransformerの動作、JNDI/RMI/LDAP経由のRCE、Log4Shellとの関連、検出ツール。

**基礎・古典（必読の2次資料）**

- Foxglove Security: What Do WebLogic, WebSphere, JBoss, Jenkins, OpenNMS... Have in Common?（Stephen Breen, 2015） — https://foxglovesecurity.com/2015/11/06/what-do-weblogic-websphere-jboss-jenkins-opennms-and-your-application-have-in-common-this-vulnerability/
- Dark Reading: Why The Java Deserialization Bug Is A Big Deal — https://www.darkreading.com/application-security/why-the-java-deserialization-bug-is-a-big-deal
- Sijmen Ruwhof: Scanning an enterprise organisation for the critical Java deserialization vulnerability — https://sijmen.ruwhof.net/weblog/683-scanning-an-enterprise-organisation-for-the-critical-java-deserialization-vulnerability
- PortSwigger（Java例を含むExploitingセクション） — https://portswigger.net/web-security/deserialization/exploiting

**ガジェットチェーンの内部を読み解く（実力差が出る核心）**

- K logix Scorpion Labs: Java Deserialization Gadget Chains（CommonsCollections1を1行ずつ解説） — https://www.klogixsecurity.com/scorpion-labs-blog/gadget-chains
- **ysoserial**（frohoff オリジナル） — https://github.com/frohoff/ysoserial
- ysoserial（synacktiv メンテナンスフォーク、--inline等の追加機能） — https://github.com/synacktiv/ysoserial
- CommonsCollections1 ソース（reflection/InvokerTransformerの流れ） — https://github.com/frohoff/ysoserial/blob/master/src/main/java/ysoserial/payloads/CommonsCollections1.java
- Synacktiv: Finding gadgets like it's 2015: part 2（gadget-inspector実践） — https://www.synacktiv.com/en/publications/finding-gadgets-like-its-2015-part-2.html

**JNDI / RMI / LDAP / Log4Shell**

- Moritz Bechler: PSA: Log4Shell and the current state of JNDI injection — https://mbechler.github.io/2021/12/10/PSA_Log4Shell_JNDI_Injection/
- Munoz & Mirosh: A Journey From JNDI/LDAP Manipulation to RCE（Black Hat 2016 PDF） — https://www.blackhat.com/docs/us-16/materials/us-16-Munoz-A-Journey-From-JNDI-LDAP-Manipulation-To-RCE.pdf
- HackTricks: JNDI & Log4Shell — https://hacktricks.wiki/en/pentesting-web/deserialization/jndi-java-naming-and-directory-interface-and-log4shell.html
- Semgrep: Understanding and mitigating Log4Shell — https://semgrep.dev/blog/2021/understanding-log4j-and-log4shell/
- MOGWAI LABS: Vulnerability notes Log4Shell — https://mogwailabs.de/en/blog/2021/12/vulnerability-notes-log4shell/

**検出ツール**

- Java Deserialization Scanner（Burp拡張, federicodotta） — https://github.com/federicodotta/Java-Deserialization-Scanner
- Java Deserialization Scanner（PortSwigger BApp フォーク） — https://github.com/PortSwigger/java-deserialization-scanner
- GadgetProbe（BurpsuiteExtensions, 盲目的クラスパス探索） — https://github.com/BurpsuiteExtensions/GadgetProbe
- marshalsec（mbechler, JNDI攻撃サーバ含むアンマーシャラ研究） — https://github.com/mbechler/marshalsec
- marshalsec 論文 "Java Unmarshaller Security"（PDF） — https://github.com/mbechler/marshalsec/blob/master/marshalsec.pdf

**実例・CVE**

- Knownsec404: Analysis of WebLogic Deserialization (CVE-2018-2628) — https://medium.com/@knownsec404team/analysis-of-weblogic-deserialization-vulnerability-cve-2018-2628-164bbed7a71d
- Tenable: Oracle WebLogic ClassFilter Bypass RCE (CVE-2015-4852周辺) — https://www.tenable.com/security/research/tra-2016-09
- Sean Melia: Exploiting Java Deserialization Via JBoss（バグバウンティ実例） — https://seanmelia.wordpress.com/2016/07/22/exploiting-java-deserialization-via-jboss/

---

#### Lv4. .NETデシリアライゼーション

**なぜ必要か**：ASP.NET ViewStateやSharePoint系（近年のMachineKey漏洩RCE）で高額報奨。JSON系シンクの盲点も学べる。
**習得できること**：BinaryFormatter/ObjectStateFormatter/LosFormatter/Json.NET/XmlSerializer等のシンク、ysoserial.netの使い方、ViewState（`__VIEWSTATE`, MachineKey）デシリアライゼーション、ObjectDataProvider/TypeConfuseDelegateガジェット。

- **ysoserial.net**（pwntester） — https://github.com/pwntester/ysoserial.net
- Soroush Dalili (@irsdl): Exploiting Deserialisation in ASP.NET via ViewState — https://soroush.me/blog/exploiting-deserialisation-in-asp-net-via-viewstate
- NotSoSecure: Exploiting ViewState Deserialization using Blacklist3r and YSoSerial.Net — https://notsosecure.com/exploiting-viewstate-deserialization-using-blacklist3r-and-ysoserial-net
- Claranet: Exploiting ViewState Deserialization（同テーマ別解説） — https://www.claranet.com/us/blog/2019-06-13-exploiting-viewstate-deserialization-using-blacklist3r-and-ysoserialnet
- NotSoSecure: Path Traversal to Remote Code Execution（MachineKey入手→RCE） — https://notsosecure.com/path-traversal-remote-code-execution
- SANS ISC: Stealing Machine Keys for fun and profit (SharePoint) — https://isc.sans.edu/diary/32174
- Munoz & Mirosh: Friday the 13th JSON Attacks（Black Hat 2017 白書PDF） — https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf
- Friday the 13th JSON Attacks（DEF CON 25 スライドPDF） — https://infocon.org/cons/DEF%20CON/DEF%20CON%2025/DEF%20CON%2025%20presentations/DEF%20CON%2025%20-%20Alvaro-Munoz-JSON-attacks.pdf
- Friday the 13th: Attacking JSON（動画, AppSecUSA 2017） — https://www.youtube.com/watch?v=NqHsaVhlxAQ

---

#### Lv5. Python / Ruby / Node.js

**なぜ必要か**：現代のWeb/API/MLパイプラインで頻出。特にPython pickleはAIセキュリティと直結、Rubyは「ユニバーサルガジェット」という美しい研究群がある。
**習得できること**：Python pickle `__reduce__` によるRCE、MLモデルファイル悪用、yaml.load、Ruby Marshal/YAML(Psych)のユニバーサルガジェットチェーン、Node.jsのnode-serialize。

**Python pickle（+ AIセキュリティ接続）**

- David Hamann: Exploiting Python pickle — https://davidhamann.de/2020/04/05/exploiting-python-pickle/
- PentesterLab Glossary: Python Pickle — https://pentesterlab.com/glossary/python-pickle
- Huntr: Pkl Rick'd — How Loading a .pkl File Can Lead to RCE — https://blog.huntr.com/pickle-rickd-how-loading-a-malicious-pickle-can-pwn-your-machine
- arXiv: PickleBall: Secure Deserialization of Pickle-based ML Models（背景理解の1次寄り） — https://arxiv.org/abs/2508.15987
- arXiv: A Large-Scale Exploit Instrumentation Study of AI/ML Supply Chain Attacks in Hugging Face Models（59%が危険形式、実際に14件の悪意モデルを検出） — https://arxiv.org/pdf/2410.04490

**Ruby（ユニバーサルガジェットの系譜）**

- devcraft (William Bowling): Universal Deserialisation Gadget for Ruby 2.x-3.x — https://devcraft.io/2021/01/07/universal-deserialisation-gadget-for-ruby-2-x-3-x.html
- Staaldraad: Universal RCE with Ruby YAML.load (versions > 2.7) — https://staaldraad.github.io/post/2021-01-09-universal-rce-ruby-yaml-load-updated/
- Bishop Fox (Ben Lincoln): Ruby Vulnerabilities: Exploiting Open, Send, and Deserialization — https://bishopfox.com/blog/ruby-vulnerabilities-exploits
- elttam: Ruby 4.0 Universal RCE Deserialization Gadget Chain（Luke Jahnke系譜、年表付き） — https://www.elttam.com/blog/ruby-4-0-universal-rce-deserialization-gadget-chain
- Trail of Bits: Marshal madness — A brief history of Ruby deserialization exploits — https://blog.trailofbits.com/2025/08/20/marshal-madness-a-brief-history-of-ruby-deserialization-exploits/
- nastystereo (Luke Jahnke): Ruby 3.4 Universal RCE Deserialization Gadget Chain — https://nastystereo.com/security/ruby-3.4-deserialization.html
- GitHub Security Lab (Peter Stöckli): Execute commands by sending JSON?（Ruby unsafe deserialization） — https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/
- GitHubSecurityLab: ruby-unsafe-deserialization（PoC集） — https://github.com/GitHubSecurityLab/ruby-unsafe-deserialization
- Behrad's Blog: Hunting for Deserialization Gadgets in the Rails Ecosystem — https://behradtaher.dev/Hunting-for-Deserialization-Gadgets/

**Node.js**

- OpSecX (Ajin Abraham): Exploiting Node.js deserialization bug for RCE（node-serialize, CVE-2017-5941） — https://opsecx.com/index.php/2017/02/08/exploiting-node-js-deserialization-bug-for-remote-code-execution/
- node-serialize（npm） — https://www.npmjs.com/package/node-serialize
- node-serialize IIFE攻撃の原Issue（luin/serialize #4, ajinabrahamによる報告） — https://github.com/luin/serialize/issues/4

---

#### Lv6. デシリアライゼーションの発展・ツール・方法論

**なぜ必要か**：既存チェーンを卒業し、自分でチェーンを発見・検証する方法論を確立する段階。
**習得できること**：ガジェットチェーンの静的/動的探索、自動化ツールの限界と手動検証の勘所。

- GadgetInspector（JackOfMostTrades, Black Hat USA 2018） — https://github.com/JackOfMostTrades/gadgetinspector
- Ian Haken: Automated Discovery of Deserialization Gadget Chains（Black Hat スライドPDF） — https://i.blackhat.com/us-18/Thu-August-9/us-18-Haken-Automated-Discovery-of-Deserialization-Gadget-Chains.pdf
- Ian Haken: 同 白書（wp）PDF — https://data.hackinn.com/ppt/BlackHat-USA-2018/us-18-Haken-Automated-Discovery-of-Deserialization-Gadget-Chains-wp.pdf
- Black Hat USA 2018 講演動画 — https://www.youtube.com/watch?v=fdctNIt8OIw
- arXiv: ODDFUZZ — Discovering Java Deserialization Vulnerabilities via Directed Greybox Fuzzing（自動化ツールの検出力比較） — https://arxiv.org/pdf/2304.04233
- AppSecCali 2015 "Marshalling Pickles"（Frohoff & Lawrence, ysoserialの起点。ysoserial README経由で参照） — https://github.com/frohoff/ysoserial

---

### Part B：サーバサイドテンプレートインジェクション（SSTI）

---

#### Lv7. SSTIの基礎

**なぜ必要か**：XSSと誤認されやすいが、実体はサーバ側コード実行への直行便。検出とエンジン特定の型を先に固める。
**習得できること**：テンプレートエンジンの仕組み、XSSとの違い、`{{7*7}}`等の数式評価による検出、polyglot `${{<%[%'"}}%\`、エンジン特定のdecision tree。

- PortSwigger: Server-side template injection（トピック概要） — https://portswigger.net/web-security/server-side-template-injection
- PortSwigger Research: Server-Side Template Injection（James Kettle, 2015、起点論文） — https://portswigger.net/research/server-side-template-injection
- PortSwigger Research: Template Injection Research ハブ — https://portswigger.net/research/template-injection
- PortSwigger ラボ: Basic server-side template injection（ERB） — https://portswigger.net/web-security/server-side-template-injection/exploiting/lab-server-side-template-injection-basic
- GoSecure: Template Injection in Action（decision treeワークショップ） — https://gosecure.github.io/template-injection-workshop/
- PayloadsAllTheThings: SSTI（README、検出手法） — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Server%20Side%20Template%20Injection
- HackTricks: SSTI（index、全エンジン横断） — https://hacktricks.wiki/en/pentesting-web/ssti-server-side-template-injection/index.html
- 日本語：SSTIという脆弱性に関する紹介（パーソルクロステクノロジー） — https://staff.persol-xtech.co.jp/corporate/security/article.html?id=94
- 日本語：サーバーサイド・テンプレートインジェクション（SSTI）とは？（Classmethod Security） — https://www.classmethod-security.jp/post/_ssti
- SSTIラボ ウォークスルー動画（PortSwigger向け, YouTube playlist） — https://www.youtube.com/playlist?list=PL1GDzLoRwyVCEG_dnWcQDbDXJSBw7lTOT

---

#### Lv8. エンジン別SSTIエクスプロイト ★実践の核・サンドボックス脱出

**なぜ必要か**：`{{7*7}}`が通っても、そこからRCEに持ち込むにはエンジン固有のサンドボックス脱出が必要。ここが人間の実力差。
**習得できること**：Jinja2/Flaskの`__class__`/`__mro__`/`__subclasses__`によるPython実行フロー復帰とフィルタ回避、Twig/Smarty、Freemarker/Velocity/Thymeleaf/SpEL、ERB、Handlebars/Pug/EJS/Nunjucks。

**Python: Jinja2/Flask/Mako/Tornado（最重要）**

- HackTricks: Jinja2 SSTI（サンドボックス脱出詳解） — https://hacktricks.wiki/en/pentesting-web/ssti-server-side-template-injection/jinja2-ssti.html
- OnSecurity: Server Side Template Injection with Jinja2（フィルタ回避 `.`/`_`/`[]`/`|join`） — https://onsecurity.io/article/server-side-template-injection-with-jinja2/
- pequalsnp-team: Cheatsheet - Flask & Jinja2 SSTI — https://pequalsnp-team.github.io/cheatsheet/flask-jinja2-ssti
- R3d Buck3T (Nairuz Abulhul): RCE with Server-Side Template Injection — https://medium.com/r3d-buck3t/rce-with-server-side-template-injection-b9c5959ad31e
- GreHack 2021: Optimizing SSTI payloads for Jinja2（最短ペイロード探索の方法論） — https://www.researchgate.net/publication/378299322_GreHack_2021_-_Optimizing_Server_Side_Template_Injection_payloads_for_Jinja2
- PayloadsAllTheThings: SSTI Python（Mako, Tornado含む） — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/Python.md

**PHP: Twig / Smarty**

- PayloadsAllTheThings: SSTI PHP — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/PHP.md

**Java: Freemarker / Velocity / Thymeleaf / SpEL**

- PayloadsAllTheThings: SSTI Java（EL/SpEL、複数式構文） — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/Java.md
- Armaan Pathan: RCE via SSTI in FreeMarker（CVE-2021-25770周辺、Executeクラス） — https://medium.com/@armaanpathan/breaking-the-barrier-remote-code-execution-via-ssti-in-freemarker-template-engine-9797079752ac
- Synack: Discovering a SSTI Vuln in FreeMarker（バグバウンティ実例） — https://www.synack.com/exploits-explained/exploits-explained-discovering-a-server-side-template-injection-vuln-in-freemarker/

**JavaScript: Handlebars / Pug / EJS / Nunjucks**

- PayloadsAllTheThings: SSTI JavaScript — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**チートシート/ジェネレータ**

- Payloadplayground: SSTI cheatsheet（エンジン別テスト式一覧） — https://payloadplayground.com/cheatsheets/ssti

---

#### Lv9. SSTIツールと実例

**なぜ必要か**：手動検出後の自動化と、実際に受理された報告の型を学ぶ。
**習得できること**：tplmap/SSTImapの使い方、WAF/フィルタ回避、実バグバウンティ報告の読み方。

- **SSTImap**（vladko312, 対話的インターフェース） — https://github.com/vladko312/SSTImap
- **tplmap**（epinna, 15+エンジン対応） — https://github.com/epinna/tplmap
- InfoSec Write-ups: Deep Dive into SSTI（検出→RCEの実践フロー） — https://infosecwriteups.com/deep-dive-into-ssti-finding-and-exploiting-server-side-template-injection-like-a-pro-bd018ee7ab69
- HackerOne #125980: uber.com RCE by Flask Jinja2 Template Injection（Orange Tsai。riders.uber.comのプロフィール名に `{{ '7'*7 }}` を注入しメール本文に「7777777」を確認、Uber報奨 $10,000、2016年4月6日開示。reddelexc集計のTop RCE上位） — https://hackerone.com/reports/125980
- HackerOne #164224: Unikrn — SSTI via Smarty allows RCE（yaworsk） — https://hackerone.com/reports/164224
- Intigriti Bug Bytes #13: Handlebars template injection and RCE in a Shopify app（$10,000, 未知エンジン特定→RCE） — https://blog.intigriti.com/2019/04/09/bug-bytes-13-shopify-rce-0xpatriks-interview-xss-in-google-search/
- Gaurav Narwani: Injecting {{6*200}} to $1200（パスワードリセットのusernameでSSTI） — https://gauravnarwani.com/injecting-6200-to-1200/

---

### Part C：統合・発展

---

#### Lv10. 実例・ライトアップ・CVE（実際に受理された脆弱性を学ぶ）

**なぜ必要か**：バグバウンティで「どこを見て」「どう報告すると受理されるか」は実例からしか学べない。
**習得できること**：著名なチェーン攻撃・報奨事例の読解、報告品質の基準。

- reddelexc/hackerone-reports: Top SSTI reports / Top RCE reports（HackerOne実報告の分類集） — https://github.com/reddelexc/hackerone-reports
- HackerOne #502758: Starbucks RCE and Complete Server Takeover（報告者 Eugene Lim / @spaceraccoon、.NETデシリアライゼーション。Starbucks側トリアージは「有効な攻撃でRCEとターゲットの完全な侵害を実証、脆弱サイトはオフラインにした」と評価。報奨額は黒塗り／非公開） — https://hackerone.com/reports/502758
- Orange Tsai: How I Chained 4 Vulnerabilities on GitHub Enterprise → RCE — https://blog.orange.tw/2017/07/how-i-chained-4-vulnerabilities-on.html
- Orange Tsai: How I Chained 4 Bugs into RCE on Amazon（Seam/XStream/FastJSON） — https://blog.orange.tw/posts/2018-08-how-i-chained-4-bugs-features-into-rce-on-amazon/
- exploit-db: IBM WebSphere RCE Java Deserialization (CVE-2015-7450, Metasploit) — https://www.exploit-db.com/exploits/41613

---

#### Lv11. 発展・方法論・防御の理解（攻撃視点での回避）

**なぜ必要か**：防御を理解することは、防御回避（look-ahead deserialization回避、サンドボックス強化の穴、allowlist回避）という攻撃技術に直結する。
**習得できること**：体系的テスト方法論、許可リスト/look-ahead deserialization/safetensors等の防御とその限界、この分野の最前線。

- Trail of Bits: Marshal madness（防御と回避の歴史、Ruby） — https://blog.trailofbits.com/2025/08/20/marshal-madness-a-brief-history-of-ruby-deserialization-exploits/
- Bishop Fox: Ruby Vulnerabilities（Open/Send/Deserializationの防御バイパス視点） — https://bishopfox.com/blog/ruby-vulnerabilities-exploits
- arXiv: PickleBall（安全なpickleデシリアライズ研究＝防御の最前線） — https://arxiv.org/abs/2508.15987
- GitHub Security Lab: Execute commands by sending JSON?（CodeQLでの検出＝防御自動化） — https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/
- Synacktiv: Finding gadgets like it's 2015: part 2（現代のガジェット探索の実務） — https://www.synacktiv.com/en/publications/finding-gadgets-like-its-2015-part-2.html

## Recommendations

1. **まず手を動かす（1-2週間）**：PortSwiggerのInsecure deserialization全ラボ→SSTI全ラボを完走。PHPラボで人間可読なserialize文字列に慣れ、POPチェーンの直感を得る。ベンチマーク：PortSwiggerのPRACTITIONERラボを解説なしで解ける。
2. **Javaに投資する（3-4週間、最重要）**：K logixのCommonsCollections1逐次解説を写経し、ローカルの脆弱アプリにysoserialのペイロードを撃ち込む→JNDI/Log4Shellまで。ベンチマーク：CommonsCollections1のreflectionフローを図で説明でき、ローカルでRCEを再現できる。
3. **ツールを卒業する（並行）**：phpggc / ysoserial.net / SSTImap / tplmap を実際に走らせ、生成物をpickletools/`javap`/デコーダで中身を読む。GadgetProbe・Java Deserialization Scannerで検出を自動化。ベンチマーク：ツール出力のバイト列を手で解釈できる。
4. **サンドボックス脱出を極める（2週間）**：Jinja2のフィルタ回避（`.`/`_`/`[]`禁止）をOnSecurityとGreHack論文で習得し、自作の最短ペイロードを組めるようにする。ベンチマーク：フィルタ付き環境でも`request`オブジェクト経由でRCEに到達できる。
5. **実戦とAI接続（継続）**：reddelexc/hackerone-reportsのSSTI/RCE分類を読み込み、報告フォーマットを模倣。pickle/MLモデルRCEはHugging Face等のスコープで現役（59%のモデルファイルが危険形式）なので、AIセキュリティの学習と統合する。ベンチマーク：実プログラムで1件、デシリアライゼーションまたはSSTIを発見・報告する。

**判断を変える閾値**：もしJavaの環境構築（Maven/classpath）で3日以上詰まるなら、先にPHP/Pythonで報告実績を作ってからJavaに戻る。逆にPortSwiggerラボが簡単すぎるなら、即座にLv6（GadgetInspector）とLv8（サンドボックス脱出）に飛んで新規チェーン構築に挑戦してよい。

## Caveats

- **合法性**：ysoserial/phpggc/marshalsec等はすべて「許可された対象のみ」で使用すること。各リポジトリのdisclaimerが明記する通り、脆弱性は「デシリアライズする側」にあり、ツール所持自体が攻撃ではない。バグバウンティのスコープと規約を厳守。
- **バージョン依存性が激しい**：Javaのガジェットチェーンはclasspath上のライブラリ版に、RubyのユニバーサルガジェットはRuby/RubyGems版に強く依存する。例えばBowlingのチェーンはRubyGems 3.2.25 / Ruby 3.1.1で一部破壊された。「古い記事のペイロードがそのまま通らない」のは正常。年表（elttam/Trail of Bits）で系譜を追うこと。
- **一部リンクは1次資料/学術寄り**：arXiv論文やBlack Hat白書PDFは要点確認の補助。学習の主軸は解説ブログ・ラボ・動画に置く。
- **foxglovesecurity.com等の古いドメイン**：2015年の古典記事はドメイン失効・移転のリスクがある。表示されない場合はWayback Machineや二次解説（Dark Reading, Tenable, Sijmen Ruwhof）で代替。
- **自動ツールの限界**：GadgetInspectorはCao et al.の評価で誤検知率97.6%、ODDFuzz論文でもysoserial既知34チェーン中3件しか検出できていない。SSTImap/tplmapも検出止まりのことが多く、RCE化には手動のサンドボックス脱出が要る。「ツールは入口、武器は手動」と心得ること。
- **spaceraccoonブログの正確なスラッグ未確認**：HackerOne #502758は確認済みだが、対応する個人ブログ記事の正確なURLは未特定。spaceraccoon.dev（https://spaceraccoon.dev/）から辿ること。