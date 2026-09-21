# 付録

## 付録A：全URL一覧（ロードマップ原典）

ロードマップに掲載された全参照 URL を、レベル別に整理して再掲する。各章末の出典と合わせて、原典にあたる際の索引として使うこと。

### Part A — Lv1 前提: GraphQLの仕組み

- PortSwigger「What is GraphQL?」 — <https://portswigger.net/web-security/graphql/what-is-graphql>
- PortSwigger「GraphQL API vulnerabilities」(トピック概説) — <https://portswigger.net/web-security/graphql>
- HackTricks「GraphQL」 — <https://hacktricks.wiki/en/network-services-pentesting/pentesting-web/graphql.html>
- Stingrai「GraphQL API Vulnerabilities, Attacks & CVEs (2026)」 — <https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks>
- DeepStrike「GraphQL: How It Works, Why It Beats REST, & Security Risks」 — <https://deepstrike.io/blog/graphql-api-vulnerabilities-and-common-attacks>
- Imperva「GraphQL API Vulnerabilities and Common Attacks」 — <https://www.imperva.com/blog/graphql-vulnerabilities-common-attacks/>
- (1次) GraphQL公式「Introspection」 — <https://graphql.org/learn/introspection/>

### Part A — Lv2 Recon と introspection

- Assetnote「Exploiting GraphQL」 — <https://www.assetnote.io/resources/research/exploiting-graphql>
- Intigriti「Five easy ways to hack GraphQL targets」 — <https://www.intigriti.com/researchers/blog/hacking-tools/five-easy-ways-to-hack-graphql-targets>
- YesWeHack「Hacking GraphQL endpoints in Bug Bounty Programs」 — <https://www.yeswehack.com/learn-bug-bounty/hacking-graphql-endpoints>
- ASEC「GraphQL Hacking 101: Reconnaissance」 — <https://www.asec.io/blog/graphql-hacking-101-reconnaissance>
- DEV「GraphQL as Attack Surface: Introspection, Batching, and Schema Enumeration」 — <https://dev.to/roxdavirox/graphql-as-attack-surface-introspection-batching-and-schema-enumeration-4f2h>
- Clairvoyance (GitHub, Nikita Stupin) — <https://github.com/nikitastupin/clairvoyance>
- graphw00f (GitHub, Dolev Farhi) — <https://github.com/dolevf/graphw00f>
- GraphQL Threat Matrix (GitHub) — <https://github.com/nicholasaleks/graphql-threat-matrix>
- ラボ: PortSwigger「Finding a hidden GraphQL endpoint」 — <https://portswigger.net/web-security/graphql/lab-graphql-find-the-endpoint>
- (1次) GraphQL Voyager — <https://graphql-kit.com/graphql-voyager/>

### Part A — Lv3 認可・アクセス制御 (BOLA/BFLA)

- HackerOne Blog「How a GraphQL Bug Resulted in Authentication Bypass」 — <https://www.hackerone.com/blog/how-graphql-bug-resulted-authentication-bypass>
- Axeploit「GraphQL's Blind Spots」 — <https://axeploit.com/blog/graphql-s-blind-spots-why-introspection-batching-and-nested-queries-are-an-attacker-s-playground>
- OWASP GraphQL Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html>
- 実報告: HackerOne #291531 — <https://hackerone.com/reports/291531>
- 実報告: HackerOne #1618347 — <https://hackerone.com/reports/1618347>
- 実報告: HackerOne #3452015 (Enjin) — <https://hackerone.com/reports/3452015>
- ラボ: PortSwigger「Accessing private GraphQL posts」 — <https://portswigger.net/web-security/graphql/lab-graphql-reading-private-posts>
- ラボ: PortSwigger「Accidental exposure of private GraphQL fields」 — <https://portswigger.net/web-security/graphql/lab-graphql-accidental-field-exposure>

### Part A — Lv4 GraphQL特有の攻撃（武器化の核）

- Wallarm「GraphQL Batching Attack」(OTPバイパス原典) — <https://lab.wallarm.com/graphql-batching-attack/>
- Escape.tech「Avoid GraphQL DoS through batching and aliasing」 — <https://escape.tech/blog/graphql-batch-attacks-cause-dos/>
- Medium(Medusa)「Bypassing 2FA in GraphQL APIs」 — <https://medusa0xf.medium.com/bypassing-2fa-in-graphql-apis-a-step-by-step-guide-4b73816bd4c3>
- PentesterLab Glossary「GraphQL Batching Attack」 — <https://pentesterlab.com/glossary/graphql-batching-attack>
- Payload Playground「GraphQL Batching & Aliasing Attacks」 — <https://payloadplayground.com/blog/graphql-batching-and-aliasing-attacks>
- 実報告: HackerOne #2166697「Ability to bulk submit reports」 — <https://hackerone.com/reports/2166697>
- 実報告: HackerOne #418767「bypass 2FA / rate limit」 — <https://hackerone.com/reports/418767>
- batchQL (GitHub, Assetnote) — <https://github.com/assetnote/batchql>
- Apollo公式Blog「Securing Your GraphQL API from Malicious Queries」 — <https://www.apollographql.com/blog/securing-your-graphql-api-from-malicious-queries>
- Medium(Jacob Voytko)「Protecting against deeply-nested GraphQL queries」 — <https://jauntyjake.medium.com/protecting-against-deeply-nested-graphql-queries-9f6db003002e>
- Medium(IBM PTC Security)「Denial of Service Attacks with GraphQL」 — <https://medium.com/@ibm_ptc_security/denial-of-service-attacks-with-graphql-77189a6ba85b>
- 実報告: GitLab Issue #30096 / HackerOne #638282 — <https://gitlab.com/gitlab-org/gitlab/-/issues/30096>
- Medium(Kiza)「Exploiting GraphQL: A Full-Spectrum Security Assessment」 — <https://kizerh.medium.com/exploiting-graphql-a-full-spectrum-security-assessment-covering-introspection-injection-and-560f49a44f36>
- PayloadsAllTheThings「GraphQL Injection」 — <https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/GraphQL%20Injection>
- Uprootsecurity「GraphQL Injection: Attacks, Exploitation & Prevention Guide」 — <https://resources.uprootsecurity.com/GraphQL_Injection>
- Medium(Ahmed Ghadban)「From IDOR to SQLi in GraphQL WebSocket」 — <https://medium.com/@DarkyOS/sql-injection-in-graphql-websocket-escalated-to-pii-document-leak-09ba7ad2800a>
- ラボ: PortSwigger「Bypassing GraphQL brute force protections」 — <https://portswigger.net/web-security/graphql/lab-graphql-brute-force-protection-bypass>
- ラボ: PortSwigger「Performing CSRF exploits over GraphQL」 — <https://portswigger.net/web-security/graphql/lab-graphql-csrf>

### Part A — Lv5 ツールと方法論

- Doyensec Blog「InQL Scanner」 — <https://blog.doyensec.com/2020/03/26/graphql-scanner.html>
- Doyensec Blog「InQL v6.1.0 Just Landed」 — <https://blog.doyensec.com/2025/12/02/inql-v610.html>
- InQL (GitHub, Doyensec) — <https://github.com/doyensec/inql>
- GraphQLmap (GitHub) — <https://github.com/swisskyrepo/GraphQLmap>
- KathanP19/HowToHunt「GraphQL」 — <https://github.com/KathanP19/HowToHunt/blob/master/GraphQL/GraphQL.md>
- 演習環境: DVGA (GitHub, dolevf) — <https://github.com/dolevf/Damn-Vulnerable-GraphQL-Application>

### Part B — Lv6 前提: WebSocketの仕組み

- PortSwigger「Testing for WebSockets security vulnerabilities」 — <https://portswigger.net/web-security/websockets>
- HackTricks「WebSocket Attacks」 — <https://hacktricks.wiki/en/pentesting-web/websocket-attacks.html>
- Ably「WebSocket security: How to prevent 9 common vulnerabilities」 — <https://ably.com/topic/websocket-security>
- Cobalt「Web Socket Vulnerabilities」 — <https://www.cobalt.io/blog/web-socket-vulnerabilites>
- (1次) MDN WebSockets API — <https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API>
- ラボ: PortSwigger「Manipulating WebSocket messages」 — <https://portswigger.net/web-security/websockets/lab-manipulating-messages-to-exploit-vulnerabilities>

### Part B — Lv7 CSWSH

- Christian Schneider「Cross-Site WebSocket Hijacking (CSWSH)」(2013年原典) — <https://christian-schneider.net/blog/cross-site-websocket-hijacking/>
- PortSwigger「Cross-site WebSocket hijacking」 — <https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking>
- Black Hills InfoSec「Can't Stop, Won't Stop Hijacking WebSockets」 — <https://www.blackhillsinfosec.com/cant-stop-wont-stop-hijacking-websockets/>
- Pentest-Tools「Cross-site WebSocket hijacking: understanding and exploiting CSWSH」 — <https://pentest-tools.com/blog/cross-site-websocket-hijacking-cswsh>
- HackMag「Cross-Site WebSocket Hijacking Explained」 — <https://hackmag.com/security/websocket-csrf>
- HackTricks CSWSH — <https://hacktricks.boitatech.com.br/pentesting-web/cross-site-websocket-hijacking-cswsh>
- 実例(Medium)「Account Takeover Using CSWSH」 — <https://sharan-panegav.medium.com/account-takeover-using-cross-site-websocket-hijacking-cswh-99cf9cea6c50>
- DEV「CSWSH: Four Major WebSocket Frameworks Default to Vulnerable」 — <https://dev.to/roxdavirox/cswsh-four-major-websocket-frameworks-default-to-vulnerable-while-attackers-get-a-bidirectional-hj8>
- ラボ: PortSwigger「Cross-site WebSocket hijacking」 — <https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking/lab>
- 実CVE: CVE-2023-0957 (Gitpod) — <https://nvd.nist.gov/vuln/detail/CVE-2023-0957>

### Part B — Lv8 WebSocketの他の脆弱性

- ラボ: PortSwigger「Manipulating the WebSocket handshake」 — <https://portswigger.net/web-security/websockets/lab-manipulating-handshake-to-exploit-vulnerabilities>
- OWASP WSTG「Testing WebSockets」 — <https://owasp.org/www-project-web-security-testing-guide/v41/4-Web_Application_Security_Testing/11-Client_Side_Testing/10-Testing_WebSockets>
- aw-junaid/bug-bounty「Web Sockets」チートシート — <https://github.com/aw-junaid/bug-bounty/blob/main/resources/cheatsheets/Web%20Sockets.md>
- arXiv「Exploring the Attack Surface of WebSocket」 — <https://arxiv.org/pdf/2104.05324>
- 実例(Medium)「WebSockets, Protobuf, and a Hidden SQL Injection」 — <https://medium.com/@momenrezkk90/websockets-protobuf-and-a-hidden-sql-injection-my-unexpected-bug-hunting-journey-c22e935cca72>
- 実CVE: CVE-2020-25095 / CVE-2020-25094 (LogRhythm) — <https://nvd.nist.gov/vuln/detail/CVE-2020-25094>

### Part C — Lv9 実例・ライトアップ・CVE・報奨事例

- reddelexc/hackerone-reports (ATOまとめ) — <https://github.com/reddelexc/hackerone-reports/blob/master/tops_by_bug_type/TOPACCOUNTTAKEOVER.md>
- CVE-2023-47643 (SuiteCRM) — <https://nvd.nist.gov/vuln/detail/CVE-2023-47643>
- CVE-2024-39895 (Directus, field duplication DoS) — <https://nvd.nist.gov/vuln/detail/CVE-2024-39895>
- Book: "Black Hat GraphQL" (Penguin Random House) — <https://www.penguinrandomhouse.com/books/719557/black-hat-graphql-by-nick-aleks-and-dolev-farhi/>
- CVE-2024-51775 (Apache Zeppelin, Missing Origin Validation) — <https://nvd.nist.gov/vuln/detail/CVE-2024-51775>
- devanshbatham/Awesome-Bugbounty-Writeups — <https://github.com/devanshbatham/Awesome-Bugbounty-Writeups/blob/master/README.md>

### Part C — Lv10 発展・方法論・防御の理解

- OWASP GraphQL Cheat Sheet(防御の決定版) — <https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html>
- Book: "Black Hat GraphQL" (No Starch Press) — <https://nostarch.com/black-hat-graphql>
- Venedy Knowledge「GraphQL Security」 — <https://venedy.io/en/knowledge/graphql-security.html>
- Escape.tech (GraphQLセキュリティ研究ブログ) — <https://escape.tech/blog/>
- 日本語: GMO Flatt Security「GraphQL診断」 — <https://flatt.tech/assessment/graphql/>
- 日本語: Flatt Security eラーニング紹介記事 — <https://scan.netsecurity.ne.jp/article/2020/09/17/44574.html>

## <a id="付録b-取得できなかった資料"></a>付録B：取得できなかった資料

生成時に、ネットワーク／サイト側の理由（HTTP 402/403、JavaScript レンダリングの SPA、リダイレクト先の消失、TLS 不一致など）で**一次取得できなかった資料**を、URL と理由とともに列挙する。多くはミラー・GitHub 原本・公式 API・WebSearch 要約などで内容を補完し、該当本文には `⚠️ 未取得` の注記を残している。**本書の記述の裏取りには、可能な限り下記の原典に直接あたること。**

| # | 節 | URL | 未取得の理由（要約） |
|---|----|-----|------|
| 1 | `s1b_overview_cve` | <https://hacktricks.wiki/en/network-services-pentesting/pentesting-web/graphql.html> | 本体サイトはHTTP 402 Payment Requiredでブロック。GitHub原本(raw.githubusercontent.com)からの代替取得に成功し、内容は本文に反映済み。 |
| 2 | `s2a_recon_articles` | <https://www.assetnote.io/resources/research/exploiting-graphql> | 301リダイレクトでwww.slcyber.io/research/exploiting-graphqlへ移動。リダイレクト先は取得できたが要約経由のため原文のコード例・スキーマ復元詳細は一部のみ抽出。該当箇所に未取得資料の注記を挿入済み。 |
| 3 | `s2c_recon_tools` | <https://github.com/nicholasaleks/graphql-threat-matrix/tree/master/implementations> | WebFetchでトップページの比較表のみ取得でき、個別実装ごとの詳細ページ(apollo.md等)は取得できなかったため、本文中に未取得資料の注記と一般知識による補足を挿入した |
| 4 | `s2d_recon_lab_voyager` | <https://portswigger.net/web-security/graphql/lab-graphql-find-the-endpoint> | WebFetchで技術背景の要約は取得できたが、ラボの解答手順(イントロスペクション回避のフィルタ迂回の詳細クエリなど)は本教科書の「ラボ攻略は書かない」方針により意図的に本文へ転記していない。本文中に未取得注記と一般知識による補足を明記した。 |
| 5 | `s3b_authz_reports` | <https://hackerone.com/reports/291531> | HackerOne report detail pages are JS-rendered SPAs; WebFetch returned only the page header text 'HackerOne' with no report body. WebSearch snippets confirmed title ("In… |
| 6 | `s3b_authz_reports` | <https://hackerone.com/reports/1618347> | Same dynamic-rendering issue as above; a GitHub mirror listing (reddelexc/hackerone-reports TOPHACKERONE.md) confirmed title, $25,000 bounty, 291 upvotes, reporter hand… |
| 7 | `s3b_authz_reports` | <https://hackerone.com/reports/3452015> | Same dynamic-rendering issue; WebSearch confirmed title, target (Enjin Platform), reporter handle pwnie, and approximate submission date (~Dec 2025), but not the full r… |
| 8 | `s4b_batching_bruteforce` | <https://medusa0xf.medium.com/bypassing-2fa-in-graphql-apis-a-step-by-step-guide-4b73816bd4c3> | WebFetch直接取得がHTTP 403 Forbiddenでブロックされた。代替としてWebSearchを実施し、記事の技術的要点(batchingがフロー順序非強制時にリスク化、alias 1万件で4桁OTP全空間を1リクエスト網羅、Pythonスニペットで生成、対象ID単位throttleと永続化クエリ許可リストによる防御)を… |
| 9 | `s4c_batching_reports_tool` | <https://hackerone.com/reports/2166697> | hackerone.comのレポートページはJavaScriptレンダリングのため、WebFetchでは本文がロードされず'HackerOne'のみが返った。WebSearchで要旨(75件超/リクエスト、約6,400件、$500、37 upvotes、query-name batching)を取得し本文に反映。 |
| 10 | `s4c_batching_reports_tool` | <https://hackerone.com/reports/418767> | hackerone.com本体はJSレンダリングで本文取得不可、ミラーのvulners.com(H1:418767)もHTTP 403でブロック。WebSearchで要旨(2FA要件・レポートレート制限・内部濫用制限の同時バイパス)のみ取得でき、一般知識で原理を補足。 |
| 11 | `s4d_nested_dos` | <https://medium.com/@ibm_ptc_security/denial-of-service-attacks-with-graphql-77189a6ba85b> | Medium が HTTP 403 Forbidden を返し egress 経由の直接取得がブロックされた。WebSearch 経由で要旨を取得し、循環フラグメント・field deduplication・OWASP系対策の記述を補完。freedium ミラーも DNS 解決不可（ENOTFOUND）で不可。 |
| 12 | `s4d_nested_dos` | <https://jauntyjake.medium.com/protecting-against-deeply-nested-graphql-queries-9f6db003002e> | Medium が HTTP 403 Forbidden を返し直接取得がブロックされた。内容は Apollo 公式 Blog（Spectrum チーム事例）および escape.tech 記事と大きく重複するため、それらの取得済み内容と一般知識で補完し警告ボックスを明記。 |
| 13 | `s4e_dos_reports` | <https://kizerh.medium.com/exploiting-graphql-a-full-spectrum-security-assessment-covering-introspection-injection-and-560f49a44f36> | WebFetchがHTTP 403 Forbiddenで拒否。freedium.cfdミラー経由も名前解決失敗(ENOTFOUND)。WebSearchで取得できた記事要約に基づき本文を執筆し、細部は一般知識で補足した旨を本文に明記。 |
| 14 | `s4f_injection` | <https://resources.uprootsecurity.com/GraphQL_Injection> | 301リダイレクトで https://www.uprootsecurity.com/404 へ転送され本文取得不可。Wayback Machineもこの環境から到達不可。WebSearch要約と一般知識で補足し警告ボックスを挿入。 |
| 15 | `s4f_injection` | <https://medium.com/@DarkyOS/sql-injection-in-graphql-websocket-escalated-to-pii-document-leak-09ba7ad2800a> | HTTP 403 Forbidden。freedium系ミラー(ENOTFOUND)およびWayback Machineも到達不可。WebSearch要約と一般知識で技術的骨子を再構成し警告ボックスを挿入。 |
| 16 | `s6a_ws_basics` | <https://hacktricks.wiki/en/pentesting-web/websocket-attacks.html> | 302リダイレクト先(tollbit.hacktricks.wiki)がHTTP 402 Payment Requiredを返しWebFetchで取得不可。代替としてGitHubミラー(angelica.gitbook.io/hacktricks)とWeb検索結果から同内容を取得し本文に反映した。 |
| 17 | `s7a_cswsh_origin` | <https://hacktricks.boitatech.com.br/pentesting-web/cross-site-websocket-hijacking-cswsh> | TLS証明書のホスト名不一致(cert altnames が agencia4ever.com.br で一致せず)により接続不可 |
| 18 | `s7a_cswsh_origin` | <https://book.hacktricks.wiki/en/pentesting-web/cross-site-websocket-hijacking-cswsh.html> | 代替の正規サイト。Tollbit(tollbit.hacktricks.wiki)へ302リダイレクト後、HTTP 402 Payment Requiredで本文取得がブロックされた |
| 19 | `s7c_cswsh_cases` | <https://sharan-panegav.medium.com/account-takeover-using-cross-site-websocket-hijacking-cswh-99cf9cea6c50> | MediumがWebFetchに対しHTTP 403 Forbiddenを返した。GitHubミラー(noblevk21/websocket-attack)にもリンクのみで本文なし。WebSearchの検索結果スニペットから確認手順と乗っ取り連鎖の要点を再構成し、未取得警告と一般知識ベースのPoC解説を挿入。 |
| 20 | `s7c_cswsh_cases` | <https://nvd.nist.gov/vuln/detail/CVE-2023-0957> | NVDはSPAで脆弱性本文を静的HTMLに含めず、WebFetchには'NVD - Home'ヘッダのみ返った。WebSearch（strix.ai/cyberstrike/snyk等）とSnyk Labs解析、Gitpodアドバイザリを突き合わせてCVSS(8.2〜9.6)・影響・修正版release-2022.11.2.16・攻撃… |
| 21 | `s8a_ws_vulns` | <https://portswigger.net/web-security/websockets/lab-manipulating-handshake-to-exploit-vulnerabilities> | WebFetchでの取得はできたが、ページ内容がラボの攻略手順(本プロジェクトのスコープ外)中心で、ハンドシェイク検証の仕組みに関する一般的な技術解説がほぼ含まれていなかったため、本文中に未取得資料の注記を挿入し一般知識で補足した。 |
| 22 | `s8b_ws_advanced` | <https://medium.com/@momenrezkk90/websockets-protobuf-and-a-hidden-sql-injection-my-unexpected-bug-hunting-journey-c22e935cca72> | MediumがHTTP 403 Forbiddenを返し、freedium.cfd(DNS解決不可)・scribe.rip(404)のミラーも失敗。WebSearchで公開要旨を取得し、記事が用いたツールblackbox-protobufの一次docsで補完。本文に⚠️未取得警告ボックスを明記。 |
| 23 | `s9c_ws_cve_writeups` | <https://nvd.nist.gov/vuln/detail/CVE-2024-51775> | NVD詳細ページはJavaScriptレンダリングのためWebFetchでは本文が空（タイトルのみ）。代替として services.nvd.nist.gov の REST API 2.0 から同一CVEの完全なデータ（説明・CVSS全評価・CWE・CPE範囲・参照）を取得済みで、内容の欠落はなし。 |
| 24 | `s9c_ws_cve_writeups` | <https://medium.com/@osamaavvan/exploiting-websocket-application-wide-xss-csrf-66e9e2ac8dfa> | Medium が HTTP 403 Forbidden を返し本文取得不可。GitHubミラーにも本文なし。WebSearch で得られた要点のみ記載し、本文中に指定形式の未取得警告ブロックを挿入。 |

## 付録C：用語集

- **GraphQL**：クライアントが必要なデータ構造を指定して取得する API クエリ言語。単一エンドポイントに query/mutation/subscription を POST する。
- **introspection**：スキーマ自体を問い合わせる GraphQL の組み込み機能（`__schema`/`__type`）。本番では無効化が推奨される。
- **field suggestion**：タイプミス時にサーバが「もしかして」と候補フィールドを返す挙動。introspection 無効時のスキーマ推測に悪用されうる。
- **Clairvoyance**：field suggestion を利用して introspection 無効環境でもスキーマを復元するツール。
- **graphw00f**：GraphQL の実装エンジン（Apollo, graphql-ruby 等）をフィンガープリントするツール。
- **alias**：同一フィールドを別名で複数回要求する GraphQL 機能。1リクエストに多数の操作を詰める総当りに転用されうる。
- **batching (array batching)**：1つの HTTP リクエストに複数の operation を配列で送る仕組み。リクエスト単位のレート制限を実効的に無効化しうる。
- **BOLA / IDOR**：Broken Object Level Authorization。他ユーザーのオブジェクトを ID 指定で参照できてしまう認可欠落（OWASP API1）。
- **BFLA**：Broken Function Level Authorization。本来許可されない機能（mutation 等）を実行できてしまう認可欠落（OWASP API5）。
- **nested query DoS**：循環参照や深いネストで指数的に負荷を増やすリソース枯渇攻撃。depth/complexity 制限で防ぐ。
- **field duplication DoS**：同一フィールド／エイリアスの重複でリゾルバを多重実行させる DoS（例: CVE-2024-39895）。
- **WebSocket**：HTTP Upgrade で確立する双方向・全二重の通信チャネル。ws:// と wss://（TLS）がある。
- **ハンドシェイク**：WebSocket 確立時の HTTP リクエスト（101 Switching Protocols）。認証は多くの場合ここでしか行われない。
- **CSWSH**：Cross-Site WebSocket Hijacking。Origin 検証欠如＋Cookie 認証が揃うと、攻撃者ページから被害者の認証済み WebSocket を開ける。CSRF の双方向版。
- **Origin 検証**：ハンドシェイクの `Origin` ヘッダを許可リストで検証する防御。欠如が CSWSH の必要条件（CWE-1385）。
- **subprotocol**：`Sec-WebSocket-Protocol` で交渉されるアプリ層プロトコル。認可やメッセージ形式の前提になる。

## 付録D：参考書籍・主要リソース

- **書籍『Black Hat GraphQL』**（Nick Aleks & Dolev Farhi, No Starch Press）— 体系学習の背骨。付録の GraphQL API Testing Checklist / Security Resources が実務のチェックリストになる。<https://nostarch.com/black-hat-graphql>
- **OWASP GraphQL Cheat Sheet** — 防御の決定版。<https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html>
- **OWASP Web Security Testing Guide（WSTG）Testing WebSockets** — WebSocket テストの標準観点。
- **PortSwigger Web Security Academy** — GraphQL 5ラボ・WebSocket 3ラボ。公式の演習環境。
- **Damn Vulnerable GraphQL Application (DVGA)** — ローカルで動かせる GraphQL 演習環境。<https://github.com/dolevf/Damn-Vulnerable-GraphQL-Application>
- **NVD（National Vulnerability Database）** — CVE/CVSS の一次情報。数値の裏取りに必須。<https://nvd.nist.gov/>

---

[📖 目次](index.md) ・ [← 第10章 発展・方法論・防御の理解](10-defense-methodology.md)