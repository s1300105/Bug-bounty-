# CSRF & CORS設定不備を「武器」にするための段階的学習ロードマップ

## TL;DR

- **CSRFとCORSは「SameSite時代でも死んでいない」。** 刺さる領域はほぼ固定されており、①CSRFトークン/防御ロジックのバイパス、②SameSite bypass（client-side redirect gadget・sibling domain・Lax+GET・method override・cookie refresh）、③CORSのorigin反射/null origin/正規表現バイパス+`Access-Control-Allow-Credentials: true`、④それらのチェーン——の4点に学習資源を集中投下すべき。
- **最良の学習経路は3段構え：** 「PortSwigger Web Security Academy（CSRF **12ラボ** + CORS **4ラボ**）を全ラボ踏破」→「James Kettle・jub0bs のCORS研究とHackTricks/PayloadsAllTheThingsで武器化」→「reddelexc/hackerone-reports 等の実受理レポート・実CVE（Casdoor CVE-2024-41657、Owncast CVE-2024-29026、Langflow CVE-2025-34291）で相場観を得る」の順。
- **自動ツールは入口にすぎない。** Corsy/CORScanner/CorsMe/Burp は検出補助であり、受理される深いバグは「人手のロジック検証」から出る。とりわけ **SameSite=None + CORS の相互作用**の理解が武器化の分水嶺（Langflow CVE-2025-34291 がその実例）。

## Key Findings

- **CSRFはSameSite Laxデフォルト後も残存する。** トークン検証欠陥、method override、GET許容、client-side redirect gadget、sibling domain、OAuth state欠落など「アプリ側ロジック」に起因する経路が主戦場。PortSwiggerは現在CSRF **12本**のラボでこれをほぼ網羅している（かつては11本だったが増補された）。
- **CORS悪用の中核は `Access-Control-Allow-Credentials: true`。** これが無いと認証済みレスポンス窃取は成立しにくい。origin反射・null origin・正規表現バイパス（ドット未エスケープ、サフィックス/プレフィックス一致、`_` 等の特殊文字）が主要パターン。
- **実例が豊富で相場観を掴みやすい。** HackerOneの公開レポート、GitHub Security Lab advisory（Casdoor/Owncast）、Langflow CVE-2025-34291（CORS→ATO→RCE、CISA KEV登録・APT実悪用）など、受理事例・CVEが多数存在。reddelexc集には「Account Takeover using Linked Accounts due to lack of CSRF protection to Rockstar Games - 237 upvotes」「One Click Account takeover using OAuth CSRF bypass by adding Null byte in state parameter on streamlabs.com to Logitech - 98 upvotes, $200」といった実受理相場が並ぶ。
- **チェーンが高額報酬の鍵。** CORSでCSRFトークン窃取→CSRF、XSS on subdomain→CORS悪用、OAuth state欠落→CSRF ATO、といった連鎖が「武器になる」レベル。Bumble/Badoo #127703 は「CSRF対策のrtトークンが `chrome-service-worker.js` に漏洩→OAuth連携CSRF→フルATO」というトークン漏洩型の教科書例。

---

## Details（段階別ロードマップ）

### Part A: CSRF（Cross-Site Request Forgery）

#### Lv1: 前提 — Cookie/オリジン/SameSiteの基礎

**なぜ必要か：** CSRFは「Cookieの自動送信」と「オリジン境界」の帰結。ここを曖昧にすると上位のbypassが理解できない。
**習得できること：** Cookie属性（SameSite Strict/Lax/None, Secure, HttpOnly）、オリジンの定義、SameSite Laxデフォルト化（2020, Chrome 84〜）がCSRF事情に与えた変化。

- MDN: Same-origin policy — https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- MDN: Set-Cookie / SameSite — https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite
- PortSwigger: What is CSRF — https://portswigger.net/web-security/csrf
- Flatt Security: SameSite属性とCSRFとHSTS（日本語・エッジケース詳解）— https://blog.flatt.tech/entry/samesite_csrf_hsts
- Basicinc: 今時のCSRF対策ってなにをすればいいの？（徳丸氏フィードバック入り）— https://tech.basicinc.jp/articles/231
- Zenn(dove): XSS、CSRF、CORS、Same-origin policy、cookieの整理 — https://zenn.dev/dove/articles/3dc0b8603db3fd

#### Lv2: 古典的CSRFのエクスプロイト

**なぜ必要か：** PoC生成の型（自動送信フォーム、GET/POST）を体に入れる。状態変更操作（メール/パスワード変更）→ATOの型を掴む。
**習得できること：** Burp CSRF PoC Generatorの使い方、`enctype`、自動submitスクリプト、img/aタグベースのGET CSRF。

- PortSwigger CSRFラーニングパス — https://portswigger.net/web-security/learning-paths/csrf
- Lab: CSRF with no defenses（Burp PoC生成の手順込み）— https://portswigger.net/web-security/csrf/lab-no-defenses
- PayloadsAllTheThings: CSRF — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Cross-Site Request Forgery
- HackTricks: CSRF — https://hacktricks.wiki/en/pentesting-web/csrf-cross-site-request-forgery.html
- System Weakness: PortSwigger CSRF Lab #1 walkthrough — https://systemweakness.com/portswigger-web-security-academy-csrf-lab-1-9e6772f8f070
- OWASP WSTG: Testing for CSRF — https://owasp.org/www-project-web-security-testing-guide/v41/4-Web_Application_Security_Testing/06-Session_Management_Testing/05-Testing_for_Cross_Site_Request_Forgery

#### Lv3: CSRFトークン/防御のバイパス（★厚め）

**なぜ必要か：** 受理される多くのCSRFは「トークンはあるが検証が甘い」ケース。ここが人間の実力差。
**習得できること：** メソッド変更でトークン検証スキップ、セッション非紐づけトークン、非セッションcookie紐づけトークン、double submit cookieの欠陥、Referer/Origin検証バイパス、Content-Type変更（application/json→text/plainでsimple request化）。

PortSwiggerラボ群：

- Lab: token validation depends on request method — https://portswigger.net/web-security/csrf/bypassing-token-validation/lab-token-validation-depends-on-request-method
- Lab: token tied to non-session cookie — https://portswigger.net/web-security/csrf/bypassing-token-validation/lab-token-tied-to-non-session-cookie
- siunam walkthrough集（CSRF全ラボ）— https://siunam321.github.io/ctf/portswigger-labs/CSRF/

技術解説（トークン/防御バイパス）：

- Cobalt: CSRF & Bypasses — https://www.cobalt.io/learning-center/csrf-bypasses
- Intigriti: CSRF Advanced Exploitation Guide — https://www.intigriti.com/researchers/blog/hacking-tools/csrf-a-complete-guide-to-exploiting-advanced-csrf-vulnerabilities

JSON CSRF（text/plainでsimple request化）：

- DirectDefense: CSRF in the Age of JSON — https://www.directdefense.com/csrf-in-the-age-of-json/
- System Weakness: Ways To Exploit JSON CSRF — https://systemweakness.com/ways-to-exploit-json-csrf-simple-explanation-5e77c403ede6
- PentesterLab Glossary: JSON CSRF — https://pentesterlab.com/glossary/json-csrf
- InfoSec Writeups: Busting CSRF: Hidden Dangers of JSON — https://infosecwriteups.com/busting-csrf-the-hidden-dangers-of-json-exploited-fd4aeb4cf47e

防御=回避対象の理解：

- OWASP CSRF Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

#### Lv4: SameSite時代の高度なCSRF（★武器化の核）

**なぜ必要か：** ここが「自動ツールで見つからない・人間の実力が出る」最重要ゾーン。
**習得できること：** SameSite=Lax bypass（method override, top-level navigation+GET, cookie refreshの2分猶予window）、SameSite=Strict bypass（client-side redirect gadget, sibling domain, 同一サイトのオープンリダイレクト）、client-side CSRF（input-based）。

PortSwigger Research/ラボ：

- Bypassing SameSite cookie restrictions（理論編）— https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions
- Lab: SameSite Lax bypass via method override — https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-lax-bypass-via-method-override
- Lab: SameSite Lax bypass via cookie refresh（2分猶予window/OAuth）— https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-cookie-refresh
- Lab: SameSite Strict bypass via client-side redirect（gadget）— https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-client-side-redirect
- Lab: SameSite Strict bypass via sibling domain（CSWSH連携）— https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-sibling-domain

技術解説（SameSite bypass）：

- hazanasec: Bypassing SameSite with Method Override — https://hazanasec.github.io/2023-07-30-Samesite-bypass-method-override.md/
- Medium(Agarwaldaksh): Breaking SameSite: Advanced CSRF Bypass — https://medium.com/@agarwaldaksh18/day-9-breaking-samesite-advanced-csrf-bypass-techniques-590f46895cae
- The Daily Swig: Chromium SameSite bypass on Android（intent scheme/redirect）— https://portswigger.net/daily-swig/chromium-bug-allowed-samesite-cookie-bypass-on-android-devices
- MBSD: CSRF、この罠いける？いけない？クイズ（日本語・強化型トラッキング防止の30日窓など実践的）— https://www.mbsd.jp/research/20250414/csrf/

client-side CSRF（学術→実務）：

- CISPA: It's all about who's asking（JAWの一般向け解説）— https://cispa.de/en/jaw
- USENIX Sec 2021: JAW paper（Khodayari & Pellegrino, 106アプリ/228M行を解析）— https://www.usenix.org/conference/usenixsecurity21/presentation/khodayari
- JAW GitHub（DOM Clobbering/open redirect/CSRF検出クエリ）— https://github.com/SoheilKhodayari/JAW
- CSPT2CSRF（Client-Side Path Traversal→CSRF、"CSRF is dead, long live CSRF" の新潮流）— https://swisskyrepo.github.io/PayloadsAllTheThings/Client Side Path Traversal/

---

### Part B: CORS（Cross-Origin Resource Sharing）設定不備

#### Lv5: 前提 — SOPとCORSの仕組み

**なぜ必要か：** preflight（OPTIONS）/simple requestの境界を理解しないと「なぜ `Access-Control-Allow-Credentials: true` が致命的か」が分からない。
**習得できること：** ACAO/ACAC等のCORSヘッダ、preflightが飛ぶ条件、simple requestの3つのContent-Type、正しいCORS設定と典型的ミス箇所。

- MDN: CORS — https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- PortSwigger CORSラーニングパス — https://portswigger.net/web-security/learning-paths/cors
- OWASP WSTG: Testing Cross Origin Resource Sharing — https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/11-Client-side_Testing/07-Testing_Cross_Origin_Resource_Sharing
- Detectify: CORS misconfigurations explained（正規表現ドット未エスケープの定番解説）— https://blog.detectify.com/best-practices/cors-misconfigurations-explained/

#### Lv6: CORS設定不備のエクスプロイト（★厚め）

**なぜ必要か：** origin反射・null origin・正規表現バイパスの3型を手に馴染ませる。
**習得できること：** Originそのまま反射+ACAC:true、`Origin: null`許可（sandboxed iframeでnull生成）、サフィックス/プレフィックス/部分文字列マッチの欠陥、ドット未エスケープ、`_`等の特殊文字による回避、信頼サブドメインのXSS起点、認証済みAPIレスポンス窃取。

PortSwiggerラボ walkthrough：

- 基礎origin反射 walkthrough（Frank Leitner）— https://medium.com/@frank.leitner/write-up-cors-vulnerability-with-basic-origin-reflection-portswigger-academy-32db7e9f1ff4
- trusted insecure protocols walkthrough（サブドメインXSS起点）— https://medium.com/@frank.leitner/write-up-cors-vulnerability-with-trusted-insecure-protocols-portswigger-academy-ab04892777cf
- GitHub(frank-leitner) 全CORSラボ解答集 — https://github.com/frank-leitner/portswigger-websecurity-academy

網羅的解説（武器化）：

- James Kettle: Exploiting CORS Misconfigurations for Bitcoins and Bounties（スライドPDF）— https://portswigger.net/kb/papers/exploitingcorsmisconfigurations.pdf
- James Kettle talk動画（AppSec EU 2017）— https://www.youtube.com/watch?v=wgkj4ZgxI4c
- HackTricks: CORS Misconfigurations & Bypass（正規表現バイパス・特殊文字・キャッシュ悪用）— https://book.hacktricks.xyz/pentesting-web/cors-bypass
- PayloadsAllTheThings: CORS Misconfiguration — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/CORS Misconfiguration
- bedefended: The Complete Guide to CORS (In)Security（origin回避の網羅表）— https://www.bedefended.com/papers/cors-security-guide
- Corben Leo: Advanced CORS Exploitation Techniques（`_`特殊文字の発見記事）— https://github.com/lc/lc.github.io/blob/master/_posts/18-6-16-advanced-cors-techniques.md
- VeryLazyTech: CORS Misconfigurations & Bypass — https://www.verylazytech.com/cors-misconfigurations-and-bypass

jub0bs（CORS専門家 Julien Cretel）:

- CORS記事一覧 — https://jub0bs.com/tags/cors/
- Fearless CORS（CORSミドルウェア設計哲学・12原則）— https://jub0bs.com/posts/2023-02-08-fearless-cors/
- Scraping the bottom of the CORS barrel（攻撃視点の続編）— https://jub0bs.com/posts/2022-08-04-scraping-the-bottom-of-the-cors-barrel-part1/
- CVE-2022-21703: cross-origin request forgery against Grafana（実バグの深掘り write-up）— https://jub0bs.com/posts/2022-02-08-cve-2022-21703-writeup/

#### Lv7: CORS攻撃の発展

**なぜ必要か：** キャッシュ連携やHTTPS→HTTP信頼など、単純検出では見えない発展形。
**習得できること：** `Vary: Origin`欠落によるキャッシュ悪用でXSS化、開発用origin（JSFiddle/CodePen）許可、HTTPS→HTTP信頼、CORS経由の内部API/イントラ攻撃。

- HackTricks CORS（キャッシュ/`Vary: Origin`悪用の記述含む）— https://book.hacktricks.xyz/pentesting-web/cors-bypass
- USENIX Sec 2018: We Still Don't Have Secure Cross-Domain Requests（CORS実証研究の決定版, Jianjun Chen et al.）— https://www.usenix.org/conference/usenixsecurity18/presentation/chen-jianjun
- CORStest（developer backdoor/null misconfiguration/origin reflectionの分類が学べる）— https://github.com/RUB-NDS/CORStest

---

### Part C: 統合・実践

#### Lv8: CSRF/CORSの連鎖・他脆弱性との組み合わせ

**なぜ必要か：** 単独では低評価でも、連鎖でCritical（ATO）に化ける。ここが報酬額の分水嶺。

- CORS→CSRFトークン窃取→ATO（2脆弱性の連鎖）— https://wadgamaraldeen.medium.com/from-cors-misconfigration-to-csrf-account-takeover-ce5d85f41eda
- 1-click ATO via CORS Misconfiguration（open redirect→XSS→`/api/auth/session`のトークン窃取）— https://medium.com/@mohammed01550038865/1-click-account-takeover-ato-via-cors-misconfiguration-64dc26d24917
- OAuth state欠落→CSRF ATO（stateパラメータ=CSRFトークンの理解）— https://medium.com/@security.tecno/hacking-your-first-oauth-on-the-web-application-account-takeover-using-redirect-and-state-5e857c7b1d43
- Snyk Labs: OAuth state parameter深掘り part2（static state・予測可能state等、stateがあっても刺さる例）— https://labs.snyk.io/resources/OAuth-mistake-takeover-part-two/

#### Lv9: ツールと方法論

**なぜ必要か：** 大量ターゲットのトリアージを高速化。ただし最終判定は必ず手動。

- Corsy（Python, 軽量CORS誤設定スキャナ）— https://github.com/s0md3v/Corsy
- CORScanner（gevent高速・pip対応・ライブラリ利用可）— https://github.com/chenjj/CORScanner
- CorsMe（Go製・ワイルドカード検出）— https://github.com/Shivangx01b/CorsMe
- CORStest（RUB-NDS, developer backdoor/null等を検出）— https://github.com/RUB-NDS/CORStest
- Burp CSRF PoC Generator（Engagement tools, no-defenses labに使用手順）— https://portswigger.net/web-security/csrf/lab-no-defenses
- CORS検出ツール一覧記事 — https://medium.com/@loyalonlytoday/a-list-of-tools-to-find-cors-cross-origin-resource-sharing-37f4c5ead5a1

#### Lv10: 実例・CVE・報奨事例（★実受理を学ぶ）

**なぜ必要か：** 「何がどれくらいの報酬で受理されたか」の相場観と報告文の型を得る。

HackerOne公開レポート：

- reddelexc/hackerone-reports TOP ATO まとめ（Rockstar 237 upvotes / Logitech OAuth CSRF null byte $200 等）— https://github.com/reddelexc/hackerone-reports/blob/master/tops_by_bug_type/TOPACCOUNTTAKEOVER.md
- Report #1018270 CSRF to ATO（メール変更に防御なし）— https://hackerone.com/reports/1018270
- Bumble/Badoo Report #127703 CSRF full ATO（rtトークンが `chrome-service-worker.js` に漏洩→OAuth連携CSRF→フルATO。Lv3「トークンはあるが漏洩」の教科書例）— https://hackerone.com/reports/127703
- Vercel #542047 CSRF connect GitHub→ATO — https://hackerone.com/reports/542047
- Periscope/X（Twitter）#235642 Full ATO — https://hackerone.com/reports/235642

CVE/advisory：

- **Casdoor CORS CVE-2024-41657**（CVSS 8.8 HIGH, v1.577.0以前, GHSL-2024-035）。beego CorsFilterが**Originのプレフィックスのみ**を検証していたため、`localhost.example.com` 等の任意サブドメインで突破可能。発見=GHSL @Kwstubbs（Kevin Stubbings）— https://securitylab.github.com/advisories/GHSL-2024-035_GHSL-2024-036_casdoor/
- **Owncast CORS CVE-2024-29026**（CVSS 8.2 HIGH, v0.1.2以前, GHSL-2023-261）。管理API `/api/admin/serverconfig` でOriginを反射+ACAC:true。`withCredentials` で管理者パスワードを窃取するPoC付き — https://securitylab.github.com/advisories/GHSL-2023-261_Owncast/
- **Langflow CVE-2025-34291**（CVSS v4.0 9.4, v1.6.9以前）。`allow_origins='*'` + `allow_credentials=True` に **refresh tokenのSameSite=None** が組み合わさりCORS→ATO→RCE。Obsidian Securityが発見、CISA KEV登録、Iranian APT MuddyWaterが実悪用——本ロードマップが説く「SameSite=None+CORS相互作用」の生きた実例 — https://advisories.gitlab.com/pkg/pypi/langflow/CVE-2025-34291/
- CORS→ATO+機密データ窃取 実戦記（Lütfü Mert Ceylan, PUT一発でメール変更+全データJSON窃取）— https://lutfumertceylan.com.tr/posts/ato-and-data-leakage-via-cors-misc/

#### Lv11: 発展・方法論・防御の理解

**なぜ必要か：** 体系的テストのチェックリスト化と、防御メカニズムの理解（＝回避対象の理解）で再現性のあるハンティングへ。

- OWASP CSRF Prevention Cheat Sheet（synchronizer token, double submit, SameSite, client-side CSRF警告）— https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP WSTG（最新版・方法論の全体像）— https://owasp.org/www-project-web-security-testing-guide/latest/
- Bug Bounty Bootcamp（Vickie Li, No Starch Press。CSRF/clickjacking/OAuthを実務寄りに）— https://nostarch.com/bug-bounty-bootcamp
- James Kettle 研究ポートフォリオ（この分野の最前線を追う起点）— https://jameskettle.com/

---

## Recommendations

1. **まずPortSwigger全ラボ踏破（目安2〜3週間）。** CSRF **12本**→CORS **4本**。詰まったらsiunam / frank-leitnerのwalkthroughで答え合わせ。**閾値：** 全ラボをヒントなしで再現できたらLv2〜3卒業。
2. **時間の6割をLv3・Lv4・Lv6に投下。** 受理される深いバグの源泉はここ。特に「トークンはあるが検証/紐づけが甘い」パターンと、SameSite bypassの4手法（method override / cookie refresh / client-side redirect / sibling domain）を手癖にする。
3. **実レポート読み込みを並走。** reddelexc集を毎日数本。報告文の構造（Summary→Steps→Impact→PoC）を写経し、自分のレポートテンプレに落とす。
4. **PoCテンプレを自作。** ①CORS窃取HTML（`fetch(..., {credentials:'include'})`→exfil）、②JSON CSRF（`enctype="text/plain"`で `{"email":"x","ignore":"=` `"}"` を組む）、③SameSite redirect gadget、④null origin用 sandboxed iframe。
5. **武器化の到達目安（ベンチマーク）：** 「SameSite Strict bypass via sibling domain」をBurp Collaboratorなしで自力完走できる／実ターゲットでorigin反射+ACAC:trueを見つけ管理者データ窃取PoCを組めるようになったら「武器化」水準。ここに達したらjub0bsのGrafana CVE write-up・USENIX 2018論文へ進み、研究者レベルへ。
6. **判断を変えるシグナル：** 対象CookieがSameSite=None → CORS credential窃取を最優先で試す。SameSite=Lax/未指定 → Lax bypass（GET経路・method override・redirect gadget）に切り替え。CORS応答が `Vary: Origin` を欠く → キャッシュ悪用でのXSS化を検討。

## Caveats

- 一部walkthroughは個人ブログ/Mediumで、ラボ更新で手順が古くなる可能性がある。必ず一次（PortSwigger）で答え合わせを。
- **SameSite=Lax（Chrome/Firefoxの現行デフォルト）下ではCORSのcredential窃取は成立しにくい。** クロスオリジンのJS発リクエストにCookieが乗らないため。CORSペイロードに時間を割く前に、対象Cookieの属性（特にSameSite=None）を必ず確認すること。
- HackerOne公開レポートの一部は伏字。学ぶべきは「手法・思考プロセス」であり、詳細な対象情報ではない。
- CVE番号やCVSSスコアはadvisory発行元により表記差があり得る（例：Casdoorは修正版バージョンがGHSLとサードパーティDBで微差）。悪用可否は必ず対象環境で再検証を。
- James Kettleの旧トークはInternet Archive等にもミラーがあるが、公式YouTube/PortSwigger PDFを優先推奨。
- jub0bsのGopherCon等のCORS関連トーク動画は正規URLを確定できなかったため本ロードマップには未掲載。ブログ記事群（確認済み）を起点に参照されたい。