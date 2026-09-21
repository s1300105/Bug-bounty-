# 付録

## 付録A：全参考URL一覧（段階別）

本書が原典とした `roadmaps/csrf&cors.md` の全URLを、ロードマップの段階（Lv）ごとに再掲する。各リンクは本文の該当章・節で引用・解説している。

### Lv1: 前提 — Cookie/オリジン/SameSiteの基礎

- MDN: Same-origin policy: https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- MDN: Set-Cookie / SameSite: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite
- PortSwigger: What is CSRF: https://portswigger.net/web-security/csrf
- Flatt Security: SameSite属性とCSRFとHSTS（日本語・エッジケース詳解）: https://blog.flatt.tech/entry/samesite_csrf_hsts
- Basicinc: 今時のCSRF対策ってなにをすればいいの？（徳丸氏フィードバック入り）: https://tech.basicinc.jp/articles/231
- Zenn(dove): XSS、CSRF、CORS、Same-origin policy、cookieの整理: https://zenn.dev/dove/articles/3dc0b8603db3fd

### Lv2: 古典的CSRFのエクスプロイト

- PortSwigger CSRFラーニングパス: https://portswigger.net/web-security/learning-paths/csrf
- Lab: CSRF with no defenses（Burp PoC生成の手順込み）: https://portswigger.net/web-security/csrf/lab-no-defenses
- PayloadsAllTheThings: CSRF: https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Cross-Site
- HackTricks: CSRF: https://hacktricks.wiki/en/pentesting-web/csrf-cross-site-request-forgery.html
- System Weakness: PortSwigger CSRF Lab #1 walkthrough: https://systemweakness.com/portswigger-web-security-academy-csrf-lab-1-9e6772f8f070
- OWASP WSTG: Testing for CSRF: https://owasp.org/www-project-web-security-testing-guide/v41/4-Web_Application_Security_Testing/06-Session_Management_Testing/05-Testing_for_Cross_Site_Request_Forgery

### Lv3: CSRFトークン/防御のバイパス（★厚め）

- Lab: token validation depends on request method: https://portswigger.net/web-security/csrf/bypassing-token-validation/lab-token-validation-depends-on-request-method
- Lab: token tied to non-session cookie: https://portswigger.net/web-security/csrf/bypassing-token-validation/lab-token-tied-to-non-session-cookie
- siunam walkthrough集（CSRF全ラボ）: https://siunam321.github.io/ctf/portswigger-labs/CSRF/
- Cobalt: CSRF & Bypasses: https://www.cobalt.io/learning-center/csrf-bypasses
- Intigriti: CSRF Advanced Exploitation Guide: https://www.intigriti.com/researchers/blog/hacking-tools/csrf-a-complete-guide-to-exploiting-advanced-csrf-vulnerabilities
- DirectDefense: CSRF in the Age of JSON: https://www.directdefense.com/csrf-in-the-age-of-json/
- System Weakness: Ways To Exploit JSON CSRF: https://systemweakness.com/ways-to-exploit-json-csrf-simple-explanation-5e77c403ede6
- PentesterLab Glossary: JSON CSRF: https://pentesterlab.com/glossary/json-csrf
- InfoSec Writeups: Busting CSRF: Hidden Dangers of JSON: https://infosecwriteups.com/busting-csrf-the-hidden-dangers-of-json-exploited-fd4aeb4cf47e
- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### Lv4: SameSite時代の高度なCSRF（★武器化の核）

- Bypassing SameSite cookie restrictions（理論編）: https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions
- Lab: SameSite Lax bypass via method override: https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-lax-bypass-via-method-override
- Lab: SameSite Lax bypass via cookie refresh（2分猶予window/OAuth）: https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-cookie-refresh
- Lab: SameSite Strict bypass via client-side redirect（gadget）: https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-client-side-redirect
- Lab: SameSite Strict bypass via sibling domain（CSWSH連携）: https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-sibling-domain
- hazanasec: Bypassing SameSite with Method Override: https://hazanasec.github.io/2023-07-30-Samesite-bypass-method-override.md/
- Medium(Agarwaldaksh): Breaking SameSite: Advanced CSRF Bypass: https://medium.com/@agarwaldaksh18/day-9-breaking-samesite-advanced-csrf-bypass-techniques-590f46895cae
- The Daily Swig: Chromium SameSite bypass on Android（intent scheme/redirect）: https://portswigger.net/daily-swig/chromium-bug-allowed-samesite-cookie-bypass-on-android-devices
- MBSD: CSRF、この罠いける？いけない？クイズ（日本語・強化型トラッキング防止の30日窓など実践的）: https://www.mbsd.jp/research/20250414/csrf/
- CISPA: It's all about who's asking（JAWの一般向け解説）: https://cispa.de/en/jaw
- USENIX Sec 2021: JAW paper（Khodayari & Pellegrino, 106アプリ/228M行を解析）: https://www.usenix.org/conference/usenixsecurity21/presentation/khodayari
- JAW GitHub（DOM Clobbering/open redirect/CSRF検出クエリ）: https://github.com/SoheilKhodayari/JAW
- CSPT2CSRF（Client-Side Path Traversal→CSRF、"CSRF is dead, long live CSRF" の新潮流）: https://swisskyrepo.github.io/PayloadsAllTheThings/Client

### Lv5: 前提 — SOPとCORSの仕組み

- MDN: CORS: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- PortSwigger CORSラーニングパス: https://portswigger.net/web-security/learning-paths/cors
- OWASP WSTG: Testing Cross Origin Resource Sharing: https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/11-Client-side_Testing/07-Testing_Cross_Origin_Resource_Sharing
- Detectify: CORS misconfigurations explained（正規表現ドット未エスケープの定番解説）: https://blog.detectify.com/best-practices/cors-misconfigurations-explained/

### Lv6: CORS設定不備のエクスプロイト（★厚め）

- 基礎origin反射 walkthrough（Frank Leitner）: https://medium.com/@frank.leitner/write-up-cors-vulnerability-with-basic-origin-reflection-portswigger-academy-32db7e9f1ff4
- trusted insecure protocols walkthrough（サブドメインXSS起点）: https://medium.com/@frank.leitner/write-up-cors-vulnerability-with-trusted-insecure-protocols-portswigger-academy-ab04892777cf
- GitHub(frank-leitner) 全CORSラボ解答集: https://github.com/frank-leitner/portswigger-websecurity-academy
- James Kettle: Exploiting CORS Misconfigurations for Bitcoins and Bounties（スライドPDF）: https://portswigger.net/kb/papers/exploitingcorsmisconfigurations.pdf
- James Kettle talk動画（AppSec EU 2017）: https://www.youtube.com/watch?v=wgkj4ZgxI4c
- HackTricks: CORS Misconfigurations & Bypass（正規表現バイパス・特殊文字・キャッシュ悪用）: https://book.hacktricks.xyz/pentesting-web/cors-bypass
- PayloadsAllTheThings: CORS Misconfiguration: https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/CORS
- bedefended: The Complete Guide to CORS (In)Security（origin回避の網羅表）: https://www.bedefended.com/papers/cors-security-guide
- Corben Leo: Advanced CORS Exploitation Techniques（`_`特殊文字の発見記事）: https://github.com/lc/lc.github.io/blob/master/_posts/18-6-16-advanced-cors-techniques.md
- VeryLazyTech: CORS Misconfigurations & Bypass: https://www.verylazytech.com/cors-misconfigurations-and-bypass
- CORS記事一覧: https://jub0bs.com/tags/cors/
- Fearless CORS（CORSミドルウェア設計哲学・12原則）: https://jub0bs.com/posts/2023-02-08-fearless-cors/
- Scraping the bottom of the CORS barrel（攻撃視点の続編）: https://jub0bs.com/posts/2022-08-04-scraping-the-bottom-of-the-cors-barrel-part1/
- CVE-2022-21703: cross-origin request forgery against Grafana（実バグの深掘り write-up）: https://jub0bs.com/posts/2022-02-08-cve-2022-21703-writeup/

### Lv7: CORS攻撃の発展

- HackTricks CORS（キャッシュ/`Vary: Origin`悪用の記述含む）: https://book.hacktricks.xyz/pentesting-web/cors-bypass
- USENIX Sec 2018: We Still Don't Have Secure Cross-Domain Requests（CORS実証研究の決定版, Jianjun Chen et al.）: https://www.usenix.org/conference/usenixsecurity18/presentation/chen-jianjun
- CORStest（developer backdoor/null misconfiguration/origin reflectionの分類が学べる）: https://github.com/RUB-NDS/CORStest

### Lv8: CSRF/CORSの連鎖・他脆弱性との組み合わせ

- CORS→CSRFトークン窃取→ATO（2脆弱性の連鎖）: https://wadgamaraldeen.medium.com/from-cors-misconfigration-to-csrf-account-takeover-ce5d85f41eda
- 1-click ATO via CORS Misconfiguration（open redirect→XSS→`/api/auth/session`のトークン窃取）: https://medium.com/@mohammed01550038865/1-click-account-takeover-ato-via-cors-misconfiguration-64dc26d24917
- OAuth state欠落→CSRF ATO（stateパラメータ=CSRFトークンの理解）: https://medium.com/@security.tecno/hacking-your-first-oauth-on-the-web-application-account-takeover-using-redirect-and-state-5e857c7b1d43
- Snyk Labs: OAuth state parameter深掘り part2（static state・予測可能state等、stateがあっても刺さる例）: https://labs.snyk.io/resources/OAuth-mistake-takeover-part-two/

### Lv9: ツールと方法論

- Corsy（Python, 軽量CORS誤設定スキャナ）: https://github.com/s0md3v/Corsy
- CORScanner（gevent高速・pip対応・ライブラリ利用可）: https://github.com/chenjj/CORScanner
- CorsMe（Go製・ワイルドカード検出）: https://github.com/Shivangx01b/CorsMe
- CORStest（RUB-NDS, developer backdoor/null等を検出）: https://github.com/RUB-NDS/CORStest
- Burp CSRF PoC Generator（Engagement tools, no-defenses labに使用手順）: https://portswigger.net/web-security/csrf/lab-no-defenses
- CORS検出ツール一覧記事: https://medium.com/@loyalonlytoday/a-list-of-tools-to-find-cors-cross-origin-resource-sharing-37f4c5ead5a1

### Lv10: 実例・CVE・報奨事例（★実受理を学ぶ）

- reddelexc/hackerone-reports TOP ATO まとめ（Rockstar 237 upvotes / Logitech OAuth CSRF null byte $200 等）: https://github.com/reddelexc/hackerone-reports/blob/master/tops_by_bug_type/TOPACCOUNTTAKEOVER.md
- Report #1018270 CSRF to ATO（メール変更に防御なし）: https://hackerone.com/reports/1018270
- Bumble/Badoo Report #127703 CSRF full ATO（rtトークンが `chrome-service-worker.js` に漏洩→OAuth連携CSRF→フルATO。Lv3「トークンはあるが漏洩」の教科書例）: https://hackerone.com/reports/127703
- Vercel #542047 CSRF connect GitHub→ATO: https://hackerone.com/reports/542047
- Periscope/X（Twitter）#235642 Full ATO: https://hackerone.com/reports/235642
- Casdoor CORS CVE-2024-41657（CVSS 8.8 HIGH, v1.577.0以前, GHSL-2024-035）。beego CorsFilterがOriginのプレフィックスのみを検証していたため、`localhost.example.com` 等の任意サブドメインで突破可能。発見=GHSL @Kwstubbs（Kevin Stubbings）: https://securitylab.github.com/advisories/GHSL-2024-035_GHSL-2024-036_casdoor/
- Owncast CORS CVE-2024-29026（CVSS 8.2 HIGH, v0.1.2以前, GHSL-2023-261）。管理API `/api/admin/serverconfig` でOriginを反射+ACAC:true。`withCredentials` で管理者パスワードを窃取するPoC付き: https://securitylab.github.com/advisories/GHSL-2023-261_Owncast/
- Langflow CVE-2025-34291（CVSS v4.0 9.4, v1.6.9以前）。`allow_origins='*'` + `allow_credentials=True` に refresh tokenのSameSite=None が組み合わさりCORS→ATO→RCE。Obsidian Securityが発見、CISA KEV登録、Iranian APT MuddyWaterが実悪用——本ロードマップが説く「SameSite=None+CORS相互作用」の生きた実例: https://advisories.gitlab.com/pkg/pypi/langflow/CVE-2025-34291/
- CORS→ATO+機密データ窃取 実戦記（Lütfü Mert Ceylan, PUT一発でメール変更+全データJSON窃取）: https://lutfumertceylan.com.tr/posts/ato-and-data-leakage-via-cors-misc/

### Lv11: 発展・方法論・防御の理解

- OWASP CSRF Prevention Cheat Sheet（synchronizer token, double submit, SameSite, client-side CSRF警告）: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP WSTG（最新版・方法論の全体像）: https://owasp.org/www-project-web-security-testing-guide/latest/
- Bug Bounty Bootcamp（Vickie Li, No Starch Press。CSRF/clickjacking/OAuthを実務寄りに）: https://nostarch.com/bug-bounty-bootcamp
- James Kettle 研究ポートフォリオ（この分野の最前線を追う起点）: https://jameskettle.com/


## 付録B：取得できなかった資料（未取得一覧）

以下は生成時に**原典を直接取得できなかった**資料である（HTTP 403/404、動的レンダリング、PDF容量超過、動画字幕抽出不可など）。いずれも本文では WebSearch の要約・同一著者の公式記事・ミラー・一般知識で内容を補完し、該当箇所に `⚠️ 未取得の資料` として明記している。一次情報が必要な場合は、各自の環境で直接あたること。

| # | 資料URL | 関連節 | 未取得の理由（要約） |
| --- | --- | --- | --- |
| 1 | https://systemweakness.com/portswigger-web-security-academy-csrf-lab-1-9e6772f8f070 | s2a_csrf-poc-basics | WebFetch returned HTTP 403 Forbidden; WebSearch fallback used instead to find equivalent public walkthrough… |
| 2 | https://siunam321.github.io/ctf/portswigger-labs/CSRF/ | s3a_token-validation-labs | HTTP 404 Not Found — 一覧インデックスのパスが変更されており、個別ラボはcsrf-2, csrf-5等の連番URLで公開。WebSearchで正しい連番URLを特定し、csrf-2およびcsrf… |
| 3 | https://systemweakness.com/ways-to-exploit-json-csrf-simple-explanation-5e77c403ede6 | s3c_json-csrf | WebFetchでHTTP 403 Forbidden（Medium系ドメインのbot対策と思われる）。代替としてWebSearchで得た要約（JSON CSRFの4分類、Content-Typeバイパス手法）を用… |
| 4 | https://infosecwriteups.com/busting-csrf-the-hidden-dangers-of-json-exploited-fd4aeb4cf47e | s3c_json-csrf | WebFetchでHTTP 403 Forbidden（Medium系ドメインのbot対策と思われる）。代替としてWebSearchの要約（ボディを空にしクエリパラメータへ移すバイパス手法）を用いて内容を再構成した。 |
| 5 | https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-cookie-refresh | s4a_samesite-bypass-labs | WebFetchが動的ラボ本文を展開できず、繰り返し親記事(SameSite解説記事)の内容へフォールバックした。WebSearchと公開Writeup(siunam321)で内容を再構成し、本文に⚠️未取得資料の… |
| 6 | https://portswigger.net/daily-swig/chromium-bug-allowed-samesite-cookie-bypass-on-android-devices | s4b_samesite-sibling-writeups | WebFetchがPortSwiggerのトップページ(マーケティング用ホームページ)を返し、記事本文に到達できなかった。技術詳細は同記事の検索スニペット、Mozilla Bugzilla(CVE-2022-454… |
| 7 | https://medium.com/@agarwaldaksh18/day-9-breaking-samesite-advanced-csrf-bypass-techniques-590f46895cae | s4c_samesite-writeups-jp | WebFetchでHTTP 403 Forbidden。GitHubミラー等の代替原本は見つからず。WebSearchを2回実行して要点（サブドメイン判定の粗さ、クライアントサイドリダイレクトガジェット、メソッドオ… |
| 8 | https://blog.doyensec.com/2024/07/02/cspt2csrf.html | s4d_client-side-csrf | 担当4URLには含まれないが本節で参照したDoyensec一次解説。直接WebFetchはせず、PayloadsAllTheThings経由の内容とWebSearch結果で要約（本文に未取得資料の警告を明記）。 |
| 9 | https://www.doyensec.com/resources/Doyensec_CSPT2CSRF_Whitepaper.pdf | s4d_client-side-csrf | 同じくDoyensecの一次ホワイトペーパー。直接取得せず検索結果で補完（本文に未取得資料の警告を明記）。 |
| 10 | https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/11-Client-side_Testing/07-Testing_Cross_Origin_Resource_Sharing | s5a_cors-fundamentals | 初回WebFetchはHTTP 404を返した。WebSearchで代替取得し、null origin/wildcard検証などの主要技術内容(sandboxed iframeでのnullオリジン生成、無条件リフレ… |
| 11 | https://portswigger.net/kb/papers/exploitingcorsmisconfigurations.pdf | s6b_kettle-cors | PDFファイルサイズがWebFetchの上限10MBを超過し取得不可。同一著者・同一研究のPortSwigger公式記事を一次相当ソースとして使用。 |
| 12 | https://www.youtube.com/watch?v=wgkj4ZgxI4c | s6b_kettle-cors | YouTubeページから字幕・トランスクリプトが抽出できず、ナビゲーション要素のみ返却。同一研究の公式記事で内容を補完。 |
| 13 | https://www.verylazytech.com/cors-misconfigurations-and-bypass | s6c_cors-weaponization | WebFetchで404 Not Found、Medium転載記事も403 Forbiddenのため直接原文は取得できず、WebSearchで得られた要旨(ドメイン許可リストのバイパス手法、Access-Contr… |
| 14 | https://wadgamaraldeen.medium.com/from-cors-misconfigration-to-csrf-account-takeover-ce5d85f41eda | s8a_cors-csrf-chains | WebFetchがHTTP 403 Forbidden（Mediumのボット遮断）。freedium.cfdミラーもDNS解決不可(ENOTFOUND)。WebSearch経由の要約スニペットと一般知識で内容を再構… |
| 15 | https://medium.com/@mohammed01550038865/1-click-account-takeover-ato-via-cors-misconfiguration-64dc26d24917 | s8a_cors-csrf-chains | WebFetchがHTTP 403 Forbidden（Mediumのボット遮断）。freedium.cfdミラーもDNS解決不可(ENOTFOUND)。WebSearch経由の要約スニペット（/api/auth/… |
| 16 | https://medium.com/@security.tecno/hacking-your-first-oauth-on-the-web-application-account-takeover-using-redirect-and-state-5e857c7b1d43 | s8b_oauth-state-csrf | MediumがHTTP 403 Forbiddenを返却。原本ミラー security.tecno.com/SRC/blogdetail/330 もJavaScriptレンダリングのため本文テキスト抽出不可。Web… |
| 17 | https://medium.com/@loyalonlytoday/a-list-of-tools-to-find-cors-cross-origin-resource-sharing-37f4c5ead5a1 | s9b_csrf-poc-tools | WebFetchでHTTP 403 Forbiddenが返却され本文取得不可。WebSearchを2回試行したが記事本文の全文までは取得できず、断片的な関連情報(GitHubリポジトリ名など)のみ得られたため、本文… |
| 18 | https://hackerone.com/reports/542047 | s10b_hackerone-oauth-ato | Direct WebFetch returned HTTP 403 Forbidden; only partial metadata (title, upvotes, bounty=$0) recovered vi… |
| 19 | https://hackerone.com/reports/235642 | s10b_hackerone-oauth-ato | Direct WebFetch returned only an unrendered 'HackerOne' placeholder (JS-rendered page); the .json endpoint … |
| 20 | https://advisories.gitlab.com/pkg/pypi/langflow/CVE-2025-34291/ | s10c_cors-cves | WebFetchで複数回試行するも本文が空扱い（JavaScript描画ページで小型モデルが内容抽出不可）。代替としてWebSearch経由でVulnCheckアドバイザリおよびObsidian Security解… |
| 21 | https://nostarch.com/bug-bounty-bootcamp | s11b_further-reading | 出版社の書籍紹介ページのため、章本文・具体的なコード例までは公開されておらず取得不可。目次と概要はWebFetchで取得できた。 |
| 22 | https://jameskettle.com/ | s11b_further-reading | 個人ポートフォリオのトップページで、研究タイトル一覧とプロフィールはWebFetchで取得できたが、各講演・論文本体(スライドPDFや詳細ペイロード)は別ページ/別ドメインにあり本節の範囲では未取得。 |


## 付録C：用語集

| 用語 | 説明 |
| --- | --- |
| **CSRF** (Cross-Site Request Forgery) | 被害者のブラウザに自動送信されるCookie等を利用し、意図しない状態変更操作を「本人の正規リクエスト」として実行させる攻撃。 |
| **CORS** (Cross-Origin Resource Sharing) | 同一オリジンポリシー(SOP)を緩和し、別オリジンからのリソースアクセスを制御する仕組み。設定不備が認証済みレスポンスの窃取につながる。 |
| **SOP** (Same-Origin Policy) | スキーム・ホスト・ポートの3つ組が一致するオリジンのみが相互にDOM/レスポンスへアクセスできるとするブラウザの基本境界。 |
| **SameSite** (Cookie属性) | Cookieをクロスサイトのリクエストにどこまで載せるかを制御する属性。`Strict` / `Lax`（現行既定）/ `None`。 |
| **ACAO** (`Access-Control-Allow-Origin`) | レスポンスの読み取りを許可するオリジンを示すCORSヘッダ。リクエストのOriginを無検証で反射すると危険。 |
| **ACAC** (`Access-Control-Allow-Credentials`) | `true` のとき、Cookie等の資格情報付きクロスオリジン読み取りを許可する。CORS悪用による認証済みデータ窃取の必要条件。 |
| **preflight** | 単純リクエストでないクロスオリジン要求の前に飛ぶ `OPTIONS` の事前確認リクエスト。 |
| **simple request** | preflightを伴わないリクエスト。`GET`/`HEAD`/`POST` かつ限られたヘッダ・3つの`Content-Type`(`text/plain`等)のみ。JSON CSRFはこれを悪用する。 |
| **null origin** | サンドボックス化iframe・`data:`スキーム等で生成される特殊なOrigin値。`null`許可設定を突く。 |
| **double submit cookie** | CSRFトークンをCookieとリクエストパラメータの両方に入れて一致を検証する防御。Cookieを別経路で注入できると崩れる。 |
| **method override** | `_method=POST` 等でHTTPメソッドを偽装する仕組み。GETでのSameSite Lax bypassやトークン検証スキップに悪用される。 |
| **client-side redirect gadget** | アプリ内のクライアントサイドリダイレクト機構を踏み台にSameSite Strictを回避する手口。 |
| **sibling domain** | 同一サイト(同一登録可能ドメイン)の別サブドメイン。XSSやCSWSHを起点にSameSite Strictを回避する。 |
| **CSWSH** (Cross-Site WebSocket Hijacking) | WebSocketハンドシェイクにOrigin検証が無いことを突く攻撃。 |
| **CSPT2CSRF** | Client-Side Path Traversal を起点に、アプリ内APIへ任意リクエストを飛ばしCSRFへ発展させる新潮流。 |
| **client-side CSRF** | サーバではなくクライアントJS内の入力(URL片等)を汚染してリクエスト先を操作するCSRF。JAW研究が体系化。 |
| **ATO** (Account Takeover) | アカウント乗っ取り。メール/パスワード変更やOAuth連携の悪用で到達する最上級の影響。 |
| **`Vary: Origin`** | Originごとにレスポンスをキャッシュ分離させるヘッダ。欠落するとCORS応答のキャッシュ悪用でXSS化しうる。 |

## 付録D：参考書籍・継続学習

- **Bug Bounty Bootcamp**（Vickie Li, No Starch Press）— CSRF/clickjacking/OAuthを実務寄りに解説。https://nostarch.com/bug-bounty-bootcamp
- **OWASP CSRF Prevention Cheat Sheet** — 防御（＝回避対象）の一次リファレンス。https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- **OWASP WSTG（最新版）** — 体系的テスト方法論の全体像。https://owasp.org/www-project-web-security-testing-guide/latest/
- **PortSwigger Web Security Academy** — CSRF 12ラボ + CORS 4ラボ。まず全ラボ踏破が最短経路。https://portswigger.net/web-security
- **James Kettle 研究ポートフォリオ** — この分野の最前線。https://jameskettle.com/
- **jub0bs（Julien Cretel）CORS記事一覧** — CORS設計・攻撃の専門家。https://jub0bs.com/tags/cors/

---

## ナビゲーション

[← 第11章 発展・方法論・防御の理解](11-methodology-defense.md)　｜　[📚 目次（ホーム）](index.md)
