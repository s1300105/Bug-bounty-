# Web認証（Authentication）脆弱性を「極める」段階的学習ロードマップ

## TL;DR

- OAuth（認可）を学び終えた実務家が、その隣接領域である「認証」の脆弱性（JWT・SAML・WebAuthn/パスキー・MFAバイパス・パスワードリセット導線）を武器レベルまで引き上げるための10段階ロードマップ。各段階に「なぜ学ぶか」「何を習得するか」と実在URLを多数掲載。
- 学習の核はJWT・SAML・MFAバイパス・パスワードリセット導線の4領域。PortSwigger Web Security Academyのハンズオンラボを軸に、HackTricks/PayloadsAllTheThings/実バグバウンティ報告・CVEで実戦感覚を養うのが最短ルート。
- 2次資料（解説記事・ライトアップ・チートシート・ツールWiki・動画）を主軸に、要点確認のためのRFC/仕様は最小限。日本語の優良資料（GMO Flatt Security、morioka12氏）も活用可能。

## Key Findings

- **JWTは実務で最も費用対効果が高い認証バグ**。特にRS256→HS256のアルゴリズム混同はJWKS公開鍵が設計上公開されているため実運用APIで頻出。alg:none・kid injection（path traversal/SQLi）・jku/jwk/x5uヘッダ悪用まで体系化すればアカウント乗っ取り（ATO）に直結する。
- **SAMLは「壊れかけの鍵」**。XML署名ラッピング（XSW1〜8）、署名除去、XMLコメント/canonicalizationの解釈差が20年間繰り返し発見されている。これは2017-2018年のDuo/CERT VU#475445から2025年のruby-saml・xml-crypto系CVEまで続く「署名検証とXML解釈の乖離（parser differential）」という同一パターンの再来である。SAML Raiderが必須ツール。
- **MFAバイパスとパスワードリセット導線はロジック欠陥の宝庫**。レスポンス操作・OTPブルートフォース・フロースキップ・パスワードリセット経由の2FA無効化、ホストヘッダポイズニング・トークン漏洩（Referer/レスポンス）・パラメータ汚染などがカタログ化されており、実際の高額報奨（例：レートリミット回避で3桁OTPを総当たり突破し$12,000を得た事例）につながる。
- **WebAuthn/パスキーは「実装ミス」と「リカバリー経路」が狙い目**。プロトコル自体は堅牢だが、challenge/origin/rpId検証不備、credential-IDとユーザーの紐付け不備（StrongKey FIDO Server の CVE-2025-26788、CVSS 8.4）、フォールバック認証への攻撃が現実の脆弱性として存在する。

## Details

### Lv1. 認証の全体像と基礎

**なぜ学ぶか**：認証と認可の違い、セッション管理、各認証方式（パスワード/トークン/SSO/フェデレーション/MFA）を整理し、なぜ認証に脆弱性が生まれるかの「攻撃対象領域（attack surface）」の地図を頭に作る。OAuth（認可）で得た知識と対比しながら「誰であるかの証明」に焦点を当てる。
**習得できること**：認証フローのマッピング、OWASPでの位置づけ（A07:2021）、テスト観点の全体像。

- PortSwigger: Authentication vulnerabilities ラーニングパス — https://portswigger.net/web-security/learning-paths/authentication-vulnerabilities
- PortSwigger: 全ラーニングパス一覧 — https://portswigger.net/web-security/learning-paths
- OWASP Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Cheat Sheet Index (Top 10対応) — https://cheatsheetseries.owasp.org/IndexTopTen.html
- OWASP WSTG: Authentication Testing 章 — https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/README
- OWASP WSTG: Weak Lock Out Mechanism テスト — https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/04-Authentication_Testing/03-Testing_for_Weak_Lock_Out_Mechanism.html
- Aptive: OWASP WSTG Authentication Testing Checklist — https://www.aptive.co.uk/blog/owasp-wstg/authentication-testing-checklist/
- ライトアップ例（14ラボ通し）: Yash's CyberSec blog — https://yashfren.github.io/posts/AuthVuln_PortswiggerLabs_Walkthrough/
- ライトアップ例: Odunayo Balogun (Medium) — https://medium.com/@bodunayo312/portswigger-authentication-vulnerabilities-62209c49f900

### Lv2. JWT（★厚め）

**なぜ学ぶか**：JWTはモダンWeb/APIの認証・セッションの中核で、実装ミスが多くバグバウンティで最も受理されやすい認証バグの一つ。header.payload.signatureの構造と署名アルゴリズムの理解が全ての攻撃の前提。
**習得できること**：署名未検証、alg:none、弱鍵ブルートフォース、RS256→HS256混同、kid injection（path traversal/SQLi）、jwk/jku/x5uヘッダ悪用、jwt_toolによる自動化。

基礎理解・入門：

- PortSwigger: JWT attacks（概要） — https://portswigger.net/web-security/jwt
- PortSwigger: Algorithm confusion attacks — https://portswigger.net/web-security/jwt/algorithm-confusion
- PortSwigger: JWT none algorithm supported（KB） — https://portswigger.net/kb/issues/00200901_jwt-none-algorithm-supported
- PentesterLab: The Ultimate Guide to JWT Vulnerabilities and Attacks — https://pentesterlab.com/blog/jwt-vulnerabilities-attacks-guide
- 日本語: セキュリティ視点からの JWT 入門（morioka12） — https://scgajge12.hatenablog.com/entry/jwt_security
- 日本語: JWTセキュリティ入門（Speaker Deck / melonattacker） — https://speakerdeck.com/melonattacker/jwtsekiyuriteiru-men
- 日本語: ユーザー認証の不備がJWTに与える脅威の分析（Akamai） — https://www.akamai.com/blog/security-research/owasp-authentication-threats-for-json-web-token

alg混同・kid/jku深掘り：

- WorkOS: JWT algorithm confusion attacks — https://workos.com/blog/jwt-algorithm-confusion-attacks
- DEV: JWT Algorithm Confusion: RS256 to HS256, Psychic Signatures, alg:none — https://dev.to/roxdavirox/jwt-algorithm-confusion-rs256-to-hs256-psychic-signatures-and-algnone-on-production-apis-1oh7
- jsmon.sh: JWT Algorithm Confusion to ATO: RS256→HS256, JKU Injection & kid SQLi — https://blogs.jsmon.sh/jwt-algorithm-confusion-to-account-takeover-rs256-hs256-jku-injection-kid-sqli/
- DEV: JWT kid Parameter Attacks: SQL Injection and Path Traversal — https://dev.to/roxdavirox/jwt-kid-parameter-attacks-sql-injection-and-path-traversal-via-key-id-5607
- DEV: JWT Key Reference Injection（kid/jku/jwk/x5u/x5c 統合手法） — https://dev.to/roxdavirox/jwt-key-reference-injection-the-attack-class-that-wins-bounties-while-guides-miss-it-421
- aquilax.ai: JWT algorithm confusion: alg:none, RS256→HS256, kid injection — https://aquilax.ai/blog/jwt-algorithm-confusion-auth-bypass

PortSwiggerラボ（ハンズオン）：

- kid header path traversal — https://portswigger.net/web-security/jwt/lab-jwt-authentication-bypass-via-kid-header-path-traversal
- jku header injection — https://portswigger.net/web-security/jwt/lab-jwt-authentication-bypass-via-jku-header-injection
- jwk header injection — https://portswigger.net/web-security/jwt/lab-jwt-authentication-bypass-via-jwk-header-injection
- ラボ攻略ライトアップ: siunam（alg confusion） — https://siunam321.github.io/ctf/portswigger-labs/JWT/jwt-7/
- ラボ攻略ライトアップ: siunam（no exposed key） — https://siunam321.github.io/ctf/portswigger-labs/JWT/jwt-8/
- ラボ攻略ライトアップ: Arash Shahbazi（Medium） — https://rootast.medium.com/jwt-authentication-bypass-a-practical-guide-through-portswigger-labs-b695eb5a8ed5

チートシート・リファレンス：

- PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md
- HackTricks: JWT Vulnerabilities — https://book.hacktricks.xyz/pentesting-web/hacking-jwt-json-web-tokens
- HowToHunt: JWT — https://kathan19.gitbook.io/howtohunt/jwt-attack/jwt

（注：alg混同の実運用インパクトについて、DEV Communityの解説は「RS256→HS256 confusion persists in production because it requires explicit algorithm pinning on the server, a configuration many applications skip」と述べており、これがalg:noneより実戦で刺さりやすい理由。関連CVEとしてCVE-2015-9235 (jsonwebtoken)、CVE-2022-21449 (Java "Psychic Signatures")、CVE-2022-23529 (jsonwebtoken) を押さえておくとよい。）

### Lv3. SAML（★厚め）

**なぜ学ぶか**：SAMLはエンタープライズSSOの中核で、XML署名の複雑さゆえ実装脆弱性が20年間繰り返し発見されている。「署名検証とXML解釈の乖離（parser differential）」というパターンが、2017-2018年のDuo/CERT VU#475445から2025年のruby-saml・xml-crypto系CVEまで一貫して再来している。SP側の署名検証不備は一発でアカウント乗っ取り・認証バイパスに至る高インパクト領域。
**習得できること**：IdP/SP/Assertion/署名の仕組み、XSW1〜8、署名除去、XMLコメント/canonicalization解釈差、XXE via SAML、SAML Raiderの実操作。

仕組みと攻撃の基礎：

- HackTricks: SAML Attacks — https://angelica.gitbook.io/hacktricks/pentesting-web/saml-attacks
- Red Siege: Attacking SAML implementations — https://redsiege.com/tools-techniques/2021/11/attacking-saml-implementations/
- Medium: Exploiting SAML implementation weaknesses（Snehal J） — https://medium.com/@snehal_j/exploiting-saml-implementation-weaknesses-aa5c432f8a8f
- RITVN: Burp SuiteでSAML署名ラッピングを検証 — https://ritvn.com/how-to-use-burp-suite-to-verify-saml-signature-wrapping-attack/

方法論（必読シリーズ）：

- epi052: How to Hunt Bugs in SAML - Part I — https://epi052.gitlab.io/notes-to-self/blog/2019-03-07-how-to-test-saml-a-methodology/
- epi052: Part II（SAML Raider/XSW） — https://epi052.gitlab.io/notes-to-self/blog/2019-03-13-how-to-test-saml-a-methodology-part-two/
- epi052: Part III（XXE/XSLT/Recipient Confusion） — https://epi052.gitlab.io/notes-to-self/blog/2019-03-16-how-to-test-saml-a-methodology-part-three/

ツール：

- SAML Raider（Burp拡張） — https://github.com/CompassSecurity/SAMLRaider
- YouTube: SAML From A Hackers Perspective Part 4 - XSW — https://www.youtube.com/watch?v=ALakvKDsZLo

実例・CVE・研究（★重要）：

- **Duo/Okta: A Breakdown of the New SAML Authentication Bypass Vulnerability**（2018年のXMLコメント脆弱性）— https://developer.okta.com/blog/2018/02/27/a-breakdown-of-the-new-saml-authentication-bypass-vulnerability
    - 背景：Duo SecurityのKelby Ludwig氏が2017年12月に発見（CVE-2017-11428等、CERT VU#475445）。同氏はeWEEKに「The exploitation of the issue we discovered is fairly easy and in most cases it just requires the insertion of seven characters to a request being passed through a web browser」とコメント。OneLogin・Clever・OmniAuth・Shibboleth等が影響を受けた。
- Duo Security PSA-2017-003（python-saml, CVE-2017-11427） — https://duo.com/learn/psa/duo-psa-2017-003
- CERT VU#475445（複数SAMLライブラリのcanonicalization/DOM traversal） — https://www.kb.cert.org/vuls/id/475445
- **GitHub Blog: Sign in as anyone（ruby-saml parser differential）** — https://github.blog/security/sign-in-as-anyone-bypassing-saml-sso-authentication-with-parser-differentials/
    - 詳細：CVE-2025-25291/25292、ruby-saml 1.17.0以前が対象（1.12.4/1.18.0系で修正）、CVSS 8.8。GitHub Security Lab（2025年3月12日）は「Attackers who are in possession of a single valid signature that was created with the key used to validate SAML responses or assertions of the targeted organization can use it to construct SAML assertions themselves and are in turn able to log in as any user」と説明。REXMLとNokogiriのparser differentialによる署名ラッピングで、GitLab CE/EE 17.9.2等で対処された。
- **WorkOS: SAMLStorm（xml-crypto, CVE-2025-29774/29775）** — https://workos.com/blog/samlstorm
    - 詳細：xml-crypto v6.0.0以前、CVSS v4.0 9.3（CRITICAL）、2025年3月14日開示。WorkOSは「an external threat actor could forge arbitrary assertions for a SAML IdP, potentially leading to full account takeovers」と警告。DigestValue内のXMLコメント悪用で、node-saml等（500k+/週DL規模）の実装に影響。v6.0.1/3.2.1/2.1.6で修正され、WorkOSは24時間以内に全顧客へ修正を配備した。
- PortSwigger Research: The Fragile Lock（新種XSW） — https://portswigger.net/research/the-fragile-lock
- 概説: SSO Security Vulnerabilities（SAML/OAuth/OIDC/JWT） — https://guptadeepak.com/security-vulnerabilities-in-saml-oauth-2-0-openid-connect-and-jwt/
- PayloadsAllTheThings: SAML Injection — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/SAML%20Injection

### Lv4. WebAuthn/パスキー（FIDO2）

**なぜ学ぶか**：パスキー普及に伴い、RP（サービス側）の実装不備が新たな攻撃対象に。プロトコルは堅牢でも、challenge/origin検証やcredential紐付け、リカバリー経路の不備でATOが起こる。診断で希少価値の高いスキル。
**習得できること**：WebAuthn/FIDO2/CTAPの仕組み、実装不備（challenge再利用、origin/rpId検証、UVバイパス、credential-ID confusion）、フォールバック/リカバリー経路への攻撃。

仕組みの理解：

- Alf Løkken: Understanding FIDO2, WebAuthn, and Passkeys — https://alflokken.github.io/posts/understanding-fido2-passkeys/
- AquilaX: Passkeys and WebAuthn Security: A Deep Dive for Developers — https://aquilax.ai/blog/passkeys-webauthn-security-deep-dive
- NCSC: Comparing traditional credentials and FIDO2 credentials — https://www.ncsc.gov.uk/paper/traditional-user-and-fido2-credentials-personal-use

攻撃・実装不備・実例（★重要）：

- 日本語: Passkey認証の実装ミスに起因する脆弱性・セキュリティリスク（GMO Flatt Security） — https://blog.flatt.tech/entry/passkey_security
- **日本語: Passkey認証におけるアカウント乗っ取り CVE-2025-26788 解説（GMO Flatt Security）** — https://blog.flatt.tech/entry/passkey_security_2
    - 詳細：StrongKey FIDO Server（4.15.1未満）の脆弱性、CVSS 8.4（HIGH）。「認証器とユーザーの紐付けが不適切なため、攻撃者が用意した認証器で生成されたアサーションを使用し、被害者のアカウント乗っ取りが可能」。Non Discoverable CredentialとPasskey（Discoverable Credential）のフロー混在が根本原因という、credential-ID/ユーザー紐付け不備の典型例。
- DSInternals: Pass-the-Passkey（Black Hat USA 2026、Michael Grafnetter） — https://www.dsinternals.com/en/black-hat-usa-26-pass-the-passkey/
- Dark Reading: Flaws in Passkey Implementation Show Old Attacks Still Work — https://www.darkreading.com/identity-access-management-security/flaws-passkeys-implementation-old-attacks-work
- Machine Spirits: Unauthenticated Account Takeover in OpenReception（WebAuthn credential injection、CWE-306） — https://www.machinespirits.com/advisory/cc76da/
- GitHub Advisory: WebAuthn passkey injection allows account takeover — https://github.com/open-reception/appointment-booking-software/security/advisories/GHSA-j9rw-x2wv-h5rj
- Bureau Veritas: Abusing FIDO2 passkeys（Entra ID provisioning悪用） — https://cybersecurity.bureauveritas.com/services/information-technology/pentesting-services/what-can-be-pentested/cloud-pentesting/abusing-fido2-passkeys
- Medium: Forging Passkeys: Exploring the FIDO2/WebAuthn Attack Surface — https://medium.com/@narendarlb123/forging-passkeys-exploring-the-fido2-webauthn-attack-surface-12e44bfb3b74

### Lv5. MFA/2FAバイパス（★厚め）

**なぜ学ぶか**：MFAは「あるだけ」で安心されがちだが、実装の細部にロジック欠陥が集中する。手法カタログを暗記レベルで持つことが、実戦での発見速度を決める。
**習得できること**：レスポンス操作（success/ステータスコード）、OTPブルートフォース（レートリミット欠如/再送によるリセット）、フロースキップ/force browsing、Referer偽装、トークン再利用/転用、backup code悪用、パスワードリセット/OAuth経由バイパス、null/配列/パラメータ汚染、レースコンディション。

手法カタログ：

- HackTricks: 2FA/MFA/OTP Bypass — https://book.hacktricks.wiki/en/pentesting-web/2fa-bypass.html
- PayloadsAllTheThings: MFA Bypass — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Account%20Takeover/mfa-bypass.md
- Security Cipher: 2FA Bypass — https://securitycipher.com/docs/security/penetration-testing-tricks/2fa-bypass/
- Bug Hunter Handbook: Rate Limit Bypass / 2FA / OTP Bypass — https://gowthams.gitbook.io/bughunter-handbook/list-of-vulnerabilities-bugs/rate-limit-bypass
- tuhin1729: Bug-Bounty-Methodology 2FA.md — https://github.com/tuhin1729/Bug-Bounty-Methodology/blob/main/2FA.md
- 0xSs0rZ: 2FA / OTP — https://0xss0rz.gitbook.io/0xss0rz/pentest/web-attacks/2fa-otp
- Cobalt: Bypassing the Protections — MFA Bypass Techniques for the Win — https://www.cobalt.io/blog/bypassing-the-protections-mfa-bypass-techniques-for-the-win

実バグバウンティ事例：

- **Medium: The $12,000 2FA Bypass — So Simple, Yet So Critical（Rahul Gairola、2025年2月25日）** — https://medium.com/@rahulgairola/the-12-000-2fa-bypass-so-simple-yet-so-critical-e3f7d7e5751c
    - 「I earned a $12,000 bounty by bypassing a rate limit to brute force a 2FA code — a vulnerability that was surprisingly simple yet critical」。3桁OTPをレートリミット制御用パラメータの操作で総当たり突破した事例。
- Medium: MFA Bypass Techniques from Real Bug Bounty Cases（Hassan Jawaid） — https://hassanjawaid.medium.com/all-about-multi-factor-authentication-a131d6c20bf5
- Medium: 2F/OTP Bypass on Registration via Response manipulation（NoorHomaid） — https://noorhomaid.medium.com/bug-bounty-writeup-2f-otp-bypass-on-registeration-via-response-manipulation-2e53573ffa4c
- HackerOne: Hacker can bypass 2FA requirement（report #418767） — https://hackerone.com/reports/418767

PortSwiggerラボ（MFAは Authentication ラーニングパス内）：

- PortSwigger: Authentication vulnerabilities（多要素ラボ含む） — https://portswigger.net/web-security/authentication

### Lv6. パスワードリセット導線（★厚め）

**なぜ学ぶか**：リセット導線はメール送信・トークン生成・検証・セッション処理という複数コンポーネントが絡み、ロジック欠陥とATOが最も直結しやすい。ホストヘッダポイズニングは定番かつ高威力。
**習得できること**：トークンの脆弱性（予測可能/漏洩/期限なし/再利用/他人のトークン）、ホストヘッダ/X-Forwarded-Hostによるリセットポイズニング、Referer漏洩、パラメータ汚染/IDOR、レスポンスからのトークン漏洩、セッション固定。

理論・防御観点：

- OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- OWASP WSTG: Authentication Testing（Weak Password Change/Reset を含む） — https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/README

手法カタログ：

- HackTricks: Reset/Forgotten Password Bypass — https://hacktricks.wiki/en/pentesting-web/reset-password.html
- PayloadsAllTheThings: Account Takeover（リセット手法網羅） — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Account%20Takeover/README.md

PortSwiggerラボ（ホストヘッダ攻撃）：

- Lab: Basic password reset poisoning — https://portswigger.net/web-security/host-header/exploiting/password-reset-poisoning/lab-host-header-basic-password-reset-poisoning
- Lab: Password reset poisoning via dangling markup — https://portswigger.net/web-security/host-header/exploiting/password-reset-poisoning/lab-host-header-password-reset-poisoning-via-dangling-markup
- 攻略ライトアップ: CyberiumX（basic） — https://cyberiumx.com/write-ups/portswigger-basic-password-reset-poisoning/
- 攻略ライトアップ: CyberiumX（via middleware） — https://cyberiumx.com/write-ups/portswigger-password-reset-poisoning-via-middleware/
- 攻略ライトアップ: learnhacking.io — https://learnhacking.io/portswiggers-basic-password-reset-poisoning-walkthrough/

### Lv7. アカウント乗っ取り（ATO）への統合

**なぜ学ぶか**：各認証バグは単体でなく「ATOへの経路」として価値が最大化する。登録フロー・メール検証・リカバリー全般を横断的に見る目を養う。
**習得できること**：pre-account takeover、登録フロー脆弱性、メール検証バイパス、認証バグの連鎖でのATO構築。

- HackTricks: Reset/Forgotten Password Bypass（ATO観点） — https://hacktricks.wiki/en/pentesting-web/reset-password.html
- PayloadsAllTheThings: Account Takeover（トップ） — https://swisskyrepo.github.io/PayloadsAllTheThings/Account%20Takeover/
- reddelexc/hackerone-reports: TOP Account Takeover — https://github.com/reddelexc/hackerone-reports/blob/master/tops_by_bug_type/TOPACCOUNTTAKEOVER.md
- HackTricks: OAuth to Account takeover（既習OAuthとの接続） — https://book.hacktricks.xyz/pentesting-web/oauth-to-account-takeover

### Lv8. ツールと実践

**なぜ学ぶか**：手法を知っても、ツールを高速に扱えなければ実戦で武器にならない。jwt_tool・SAML Raider・Burp拡張の習熟が発見速度を決める。
**習得できること**：jwt_toolによるJWT総当たりテスト、hashcatでの弱鍵クラック、SAML RaiderでのXSW/署名操作、Burp JWT Editor拡張。

- jwt_tool（本体） — https://github.com/ticarpi/jwt_tool
- jwt_tool Wiki（ホーム/方法論） — https://github.com/ticarpi/jwt_tool/wiki
- jwt_tool Wiki: Attack Methodology — https://github.com/ticarpi/jwt_tool/wiki/Attack-Methodology
- jwt_tool Wiki: Known Exploits and Attacks — https://github.com/ticarpi/jwt_tool/wiki/Known-Exploits-and-Attacks
- ticarpi: Introducing JWT Tool — https://www.ticarpi.com/introducing-jwt-tool/
- SAML Raider — https://github.com/CompassSecurity/SAMLRaider
- Burp JWT Editor拡張（BApp Store） — https://portswigger.net/bappstore/26aaa5ded2f74beea19e2ed8345a93dd

（補足：JWT秘密鍵のブルートフォースにはhashcat（モード16500 = JWT）が定番。弱鍵ワードリストとしてwallarm/jwt-secretsが有名。alg混同で公開鍵を導出する場合はPortSwiggerのsig2n / rsa_sign2n（`docker run --rm -it portswigger/sig2n <token1> <token2>`）を使う。）

### Lv9. 実例・ライトアップ・報奨事例

**なぜ学ぶか**：実際に受理された脆弱性を読むことで「現実に何が刺さるか」の相場観と報告の書き方を学ぶ。
**習得できること**：実CVE・実報告の読解、インパクト記述、再現手順の組み立て。

- reddelexc/hackerone-reports: TOP Authentication — https://github.com/reddelexc/hackerone-reports/blob/master/tops_by_bug_type/TOPAUTH.md
- reddelexc/hackerone-reports: TOP OpenID/SSO — https://github.com/reddelexc/hackerone-reports/blob/master/tops_by_bug_type/TOPOPENID.md
- reddelexc/hackerone-reports: TOP Account Takeover — https://github.com/reddelexc/hackerone-reports/blob/master/tops_by_bug_type/TOPACCOUNTTAKEOVER.md
- Intigriti Bug Bytes（認証系まとめ多数） — https://www.intigriti.com/researchers/blog/bug-bytes
- GitHub Blog: Sign in as anyone（ruby-saml、CVE-2025-25291/25292） — https://github.blog/security/sign-in-as-anyone-bypassing-saml-sso-authentication-with-parser-differentials/
- 日本語: セキュリティ視点からの JWT 入門（Sign in with Apple事例含む） — https://scgajge12.hatenablog.com/entry/jwt_security

（参考として、reddelexcのSSO/ATO集には「SAML Signature verification bypass allows logging into any user (GitHub)」「SAML Authentication Bypass on uchat.uberinternal.com to Uber - $8,500」「Account takeover - improper validation of jwt signature to Linktree」「Account Takeover via Authentication Bypass in TikTok Account Recovery - $12,000」等、認証系の実報告が多数収録されている。）

### Lv10. 方法論・チェックリスト・発展

**なぜ学ぶか**：属人的な勘ではなく、再現可能な方法論とチェックリストを持つことで抜け漏れなく認証面をテストできる。防御ベストプラクティスの裏返しが攻撃観点になる。
**習得できること**：認証テストの体系的手法、防御策（署名検証/MFA/リセットのベストプラクティス）とその回避視点、この分野の最前線。

- OWASP WSTG: Authentication Testing 全体 — https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/README
- OWASP Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- jwt_tool Attack Methodology — https://github.com/ticarpi/jwt_tool/wiki/Attack-Methodology
- epi052: SAML methodology（Part I〜III、Lv3参照）
- PortSwigger Research: The Fragile Lock（SAMLの最前線） — https://portswigger.net/research/the-fragile-lock
- 日本語: 仕様起因の脆弱性を防ぐ 開発者向けセキュリティチェックシート（GMO Flatt Security） — https://blog.flatt.tech/entry/spec_security_summary

## Recommendations

1. **まずJWTから着手**（2〜3週間）：PortSwiggerのJWTラボ全問→jwt_tool習熟→alg混同/kid/jkuの実運用テスト観点を固める。既習OAuthの知識と直結し、最短で「刺さる」バグに到達できる。実運用で最も頻出なのはRS256→HS256混同（JWKS公開鍵が設計上公開されているため）なので、`/.well-known/jwks.json`の確認をルーチン化すること。
2. **次にパスワードリセット導線とMFAバイパス**（並行2〜3週間）：ホストヘッダポイズニングのPortSwiggerラボ+HackTricks/PayloadsAllTheThingsの手法カタログを暗記レベルに。実バグバウンティ報告を10件以上読む。
3. **SAMLは腰を据えて**（3〜4週間）：epi052の3部作を通読しSAML Raiderで手を動かす。Duo（CVE-2017-11428系）→ruby-saml（CVE-2025-25291/25292）→xml-crypto（CVE-2025-29774/29775 "SAMLStorm"）→PortSwigger "The Fragile Lock"のCVE解説で「なぜ壊れるか（parser differential）」を時系列で理解する。
4. **WebAuthn/パスキーは差別化スキルとして**（2週間）：GMO Flatt Securityの2記事でRP実装不備のパターン（特にCVE-2025-26788のcredential-ID紐付け不備）を把握、リカバリー/フォールバック経路の攻撃観点を持つ。診断案件で希少価値が高い。
5. **統合フェーズ**：reddelexcのHackerOne報告集で「認証バグ→ATO」の連鎖パターンを学び、自分のチェックリストを作成。
- **進捗の指標（次段階への閾値）**：各領域でPortSwiggerラボを全完了→実プログラムで最低1件の認証系バグを報告できたら「武器化」達成の目安。ラボが物足りなくなったら実CVE（ruby-saml/xml-crypto/StrongKey）のPoC再現に進む。alg混同やXSWをツールなしで手動再現できるようになったら「極めた」レベル。

## Caveats

- 一部のツール系解説記事（DEV Community等）はベンダー製品（MAGO Intel、CerberAuth等）の宣伝を含む。技術内容は正確でPortSwiggerラボと整合するが、ツール推奨部分は割り引いて読むこと。一次の権威はPortSwiggerラボ。
- CVE番号や新しい研究（PortSwigger "The Fragile Lock"、DSInternals "Pass-the-Passkey"（Black Hat USA 2026）、2026年のJWTライブラリCVE群）は比較的新しく、詳細が更新される可能性がある。実際に検証する際は最新のライブラリ版・公式アドバイザリ（NVD等）を確認すること。DSInternalsの記事は2026年6月付でBlack Hat USA 2026の講演を扱っており、現時点（2026年9月）では過去/現在の事象であって予測ではない。
- GMO Flatt Securityの記事は日本語。WebAuthnのW3C仕様（Level 3 Working Draft）を読み解く高品質な解説だが、英語話者と共有する場合は翻訳が必要。
- Machine Spirits/GitHub AdvisoryのOpenReception事例はバグバウンティプラットフォーム報告ではなくベンダー/GitHubのセキュリティアドバイザリだが、公開されているWebAuthnのcredential紐付け不備によるATOの最良の具体例として採用した。
- 実際の攻撃検証は必ず認可された環境（自分のラボ、明示的な許可のあるバグバウンティ対象）でのみ行うこと。