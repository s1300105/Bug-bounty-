# 付録

## 付録A：全参考URL一覧（段階別）

本書が原典とした `roadmaps/oauth.md` の全 URL を、学習段階ごとに再掲する。各リンクは本文の該当節で引用・解説している。

### 段階1 — 基礎理解（フローとロール）

- Aaron Parecki「OAuth 2 Simplified」: https://aaronparecki.com/oauth-2-simplified/
- oauth.net（OAuth 公式ハブ）: https://oauth.net/2/
- oauth.com（『OAuth 2.0 Simplified』Web版）: https://www.oauth.com/
- OAuth 2.0 Playground: https://www.oauth.com/playground/
- OpenID Connect Playground: https://www.openidconnect.net/
- OpenID Foundation「How OpenID Connect Works」: https://openid.net/developers/how-connect-works/
- 「OAuth and OpenID Connect for dummies」(Frederik Banke): https://medium.com/@frederikbanke/oauth-and-openid-connect-for-dummies-ec18df6a233
- The Hacker Recipes「OAuth 2.0」: https://www.thehacker.recipes/web/config/identity-and-access-management/oauth-2.0
- 書籍『OAuth 2 in Action』(Richer & Sanso): https://www.manning.com/books/oauth-2-in-action
- 書籍『OpenID Connect in Action』(Siriwardena): https://www.goodreads.com/book/show/59365339-openid-connect-in-action
- 動画「The Nuts and Bolts of OAuth 2.0」(Aaron Parecki): https://aaronparecki.com/oauth/
- （日本語）atmarkit「図解：OAuth 2.0に潜む『5つの脆弱性』と解決法」: https://atmarkit.itmedia.co.jp/ait/articles/1710/24/news011.html

### 段階2 — 脆弱性クラス

**包括ガイド**

- Doyensec「Common OAuth Vulnerabilities」: https://blog.doyensec.com/2025/01/30/oauth-common-vulnerabilities.html
- PortSwigger「OAuth 2.0 authentication vulnerabilities」: https://portswigger.net/web-security/oauth
- PortSwigger「OpenID Connect」: https://portswigger.net/web-security/oauth/openid
- PortSwigger「How to prevent OAuth authentication vulnerabilities」: https://portswigger.net/web-security/oauth/preventing
- Security Innovation「Pentester's Guide to Evaluating OAuth 2.0」: https://blog.securityinnovation.com/pentesters-guide-to-evaluating-oauth-2.0
- Cobalt「OAuth Vulnerabilities Pt.1」: https://www.cobalt.io/blog/oauth-vulnerabilites
- COFFSec「10 OAuth Misconfiguration Exploits Every Pentester Must Master」: https://coffsec.medium.com/10-oauth-misconfiguration-exploits-every-pentester-must-master-ef1f71324faf
- 「The Wonderful World of OAuth: Bug Bounty Edition」: https://medium.com/a-bugz-life/the-wondeful-world-of-oauth-bug-bounty-edition-af3073b354c1
- Outpost24「Seven common OAuth vulnerabilities」: https://outpost24.com/blog/common-oauth-vulnerabilities-mitigations/

**redirect_uri / open redirect / トークン漏洩**

- Antonio Sanso「Top 10 OAuth 2 Implementation Vulnerabilities」: http://blog.intothesymmetry.com/2015/12/top-10-oauth-2-implementation.html
- Antonio Sanso「On OAuth token hijacks for fun and profit」Part1: http://blog.intothesymmetry.com/2015/06/on-oauth-token-hijacks-for-fun-and.html
- 同 Part2: http://blog.intothesymmetry.com/2015/10/on-oauth-token-hijacks-for-fun-and.html
- PortSwigger Research「Hidden OAuth attack vectors」: https://portswigger.net/research/hidden-oauth-attack-vectors

**mix-up / code injection（理論）**

- Daniel Fett「Mix-Up, Revisited」: https://danielfett.de/2020/05/04/mix-up-revisited/
- Daniel Fett ほか「A Comprehensive Formal Security Analysis of OAuth 2.0」(arXiv): https://arxiv.org/pdf/1601.01229
- OAuth Security Workshop 2025「Cross-app OAuth Attacks: Mix-up Attacks Reloaded」: https://talks.secworkshop.events/osw2025/talk/WG9TEW/

**JWT / OIDC id_token**

- PortSwigger「JWT attacks」: https://portswigger.net/web-security/jwt
- PortSwigger「Algorithm confusion attacks」: https://portswigger.net/web-security/jwt/algorithm-confusion
- PortSwigger「JWT none algorithm supported」(KB): https://portswigger.net/kb/issues/00200901_jwt-none-algorithm-supported
- 「JWT Vulnerabilities: Common Attacks and How to Prevent Them」(DEV): https://dev.to/roxdavirox/jwt-vulnerabilities-common-attacks-and-how-to-prevent-them-372k

### 段階3 — 実例ライトアップ / バグバウンティ事例

**古典・著名リサーチ**

- Frans Rosén「Account hijacking using "dirty dancing" in sign-in OAuth-flows」(Detectify Labs): https://labs.detectify.com/writeups/account-hijacking-using-dirty-dancing-in-sign-in-oauth-flows/
- 同スライド(Speaker Deck): https://speakerdeck.com/fransrosen/account-hijacking-using-dirty-dancing-in-sign-in-oauth-flows
- Egor Homakov「How we hacked Facebook with OAuth2 and Chrome bugs」: http://homakov.blogspot.com/2013/02/hacking-facebook-with-oauth2-and-chrome.html
- Egor Homakov「OAuth1, OAuth2, OAuth...?」: http://homakov.blogspot.com/2013/03/oauth1-oauth2-oauth.html
- Egor Homakov「OAuth2: One access_token To Rule Them All」: http://homakov.blogspot.com/2012/08/oauth2-one-accesstoken-to-rule-them-all.html
- Bhavuk Jain「Zero-day in Sign in with Apple」($100,000): https://bhavukjain.com/blog/2020/05/30/zeroday-signin-with-apple/
- Youssef Sammouda「Account takeover of Facebook/Oculus accounts via first-party access_token stealing」($44,250): https://ysamm.com/2023/01/29/account-takeover-of-facebook-oculus-accounts-due-to-first-party-access_token-stealing.html

**Salt Labs 社会ログイン 3 部作**

- 第1弾「Traveling with OAuth – Account Takeover on Booking.com」: https://salt.security/blog/traveling-with-oauth-account-takeover-on-booking-com
- 第2弾「A New OAuth Vulnerability Impacts Hundreds of Online Services」(Expo, CVE-2023-28131): https://salt.security/blog/a-new-oauth-vulnerability-that-may-impact-hundreds-of-online-services
- 第3弾「Oh-Auth – Abusing OAuth to take over millions of accounts」: https://salt.security/blog/oh-auth-abusing-oauth-to-take-over-millions-of-accounts

**公開 HackerOne レポート**

- Semrush「OAuth redirect_uri bypass using IDN homograph attack」: https://hackerone.com/reports/861940
- pixiv「Stealing Users OAuth authorization code via path traversal in redirect_uri」: https://hackerone.com/reports/1861974
- Slack「OAuth2 redirect_uri bypass」: https://hackerone.com/reports/2575

**Medium 等のライトアップ**

- 「How I Found a Critical OAuth Misconfiguration That Led to Account Takeover」(Shafayat Ahmed): https://medium.com/@iamshafayat/how-i-found-a-critical-oauth-misconfiguration-that-led-to-account-takeover-abfec43eaea6
- 「How I Found 5 OAuth Misconfigurations Leading to Pre-Account Takeover」(KhaledAhmed107): https://medium.com/@KhaledAhmed107/how-i-found-5-oauth-misconfigurations-leading-to-pre-account-takeover-in-public-bug-bounty-programs-021d4c8c6954
- 「Full Account Takeover via Facebook OAuth Misconfiguration」(Ahmed Tarek): https://medium.com/@0x_xnum/full-account-takeover-via-facebook-oauth-misconfiguration-9e30fe1c1da1
- Bugcrowd「Breaking the Chain: Exploiting OAuth and forgot password for account takeover」: https://www.bugcrowd.com/blog/breaking-the-chain-exploiting-oauth-and-forgot-password-for-account-takeover/
- 「Pre-Account Takeover via OAuth Misconfiguration」(InfoSec Write-ups): https://infosecwriteups.com/pre-account-takeover-via-oauth-misconfiguration-0e393cda1f7e

### 段階4 — 安全な環境での検証演習と方法論

**PortSwigger ラボ（すべて無料）**

- 学習パス + ラボ一覧: https://portswigger.net/web-security/oauth
- Lab: Authentication bypass via OAuth implicit flow: https://portswigger.net/web-security/oauth/lab-oauth-authentication-bypass-via-oauth-implicit-flow
- Lab: Forced OAuth profile linking: https://portswigger.net/web-security/oauth/lab-oauth-forced-oauth-profile-linking
- Lab: OAuth account hijacking via redirect_uri: https://portswigger.net/web-security/oauth/lab-oauth-account-hijacking-via-redirect-uri
- Lab: Stealing OAuth access tokens via an open redirect: https://portswigger.net/web-security/oauth/lab-oauth-stealing-oauth-access-tokens-via-an-open-redirect
- Lab: Stealing OAuth access tokens via a proxy page: https://portswigger.net/web-security/oauth/lab-oauth-stealing-oauth-access-tokens-via-a-proxy-page
- Lab: SSRF via OpenID dynamic client registration: https://portswigger.net/web-security/oauth/openid/lab-oauth-ssrf-via-openid-dynamic-client-registration
- Lab: JWT authentication bypass via algorithm confusion (no exposed key): https://portswigger.net/web-security/jwt/algorithm-confusion/lab-jwt-authentication-bypass-via-algorithm-confusion-with-no-exposed-key

**PentesterLab / その他**

- PentesterLab「OAuth2: Authorization Server OpenRedirect」: https://pentesterlab.com/exercises/oauth2
- six2dez Pentest Book「OAuth」: https://pentestbook.six2dez.com/enumeration/webservices/oauth
- 参考ライトアップ(siunam, JWT algorithm confusion): https://siunam321.github.io/ctf/portswigger-labs/JWT/jwt-7/

**チェックリスト / 方法論**

- Doyensec OAuth Security Cheat Sheet（Doyensec 記事内 PDF）: https://blog.doyensec.com/2025/01/30/oauth-common-vulnerabilities.html
- Binary Brotherhood「OAuth 2.0 Threat Model / Pentest Checklist」: https://binarybrotherhood.io/oauth2_threat_model.html
- aw-junaid「OAuth Exploitation」方法論: https://github.com/aw-junaid/bug-bounty/blob/main/methodologies/web%20technologies/OAuth%20Exploitation.md
- OWASP OAuth2 Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html
- 「11 Pro Tips for OAuth 2.0 Pentesting」(Cristi Vlad): https://cristivlad.medium.com/11-pro-tips-for-oauth-2-0-pentesting-5be06daa8996

### 段階5 — 発展・最先端

- Aaron Parecki「It's Time for OAuth 2.1」: https://aaronparecki.com/2019/12/12/21/its-time-for-oauth-2-dot-1
- oauth.net「OAuth 2.1」概要: https://oauth.net/2.1/
- FusionAuth「Differences between OAuth 2 and OAuth 2.1」: https://fusionauth.io/articles/oauth/differences-between-oauth-2-oauth-2-1
- Auth0「Identity, Unlocked」Episode 4（Security BCP with Daniel Fett）: https://auth0.com/blog/identity-unlocked-explained-episode-4/
- WorkOS「DPoP (RFC 9449) explained」: https://workos.com/blog/dpop-rfc-9449-explained
- Auth0「OAuth 2.0 Security Enhancements（DPoP & Step-up）」: https://auth0.com/blog/oauth2-security-enhancements/
- Takahiko Kawasaki「Illustrated DPoP」: https://darutk.medium.com/illustrated-dpop-oauth-access-token-security-enhancement-801680d761ff
- Curity「What is Financial-Grade Security?」: https://curity.io/resources/learn/what-is-financial-grade/
- Zuplo「FAPI 2.0 Explained」: https://zuplo.com/learning-center/fapi-2-financial-grade-api-security-patterns
- Auth0「FAPI 2.0: The Future of API Security」: https://auth0.com/blog/fapi-2-0-the-future-of-api-security-for-high-stakes-customer-interactions/
- Doyensec「The MCP AuthN/Z Nightmare」: https://blog.doyensec.com/2026/03/05/mcp-nightmare.html
- （日本語）Qiita(task4233)「OAuth 2.0の認可エンドポイントにおける脆弱な実装例と対策」: https://qiita.com/task4233/items/3af1b3d2690b44979659
- （日本語）Zenn(calloc134)「【OAuth】アクセストークンの検証を誤ると成りすまし攻撃ができます」: https://zenn.dev/calloc134/articles/oauth-cross-api-vuln-attack

---

## 付録B：自動取得できなかった資料

以下は生成時に本文への自動取り込みができなかった（またはレンダリング／アクセス制限で一次取得が不完全だった）資料である。本文では該当箇所に `⚠️ 未取得の資料` として注記し、可能な範囲でミラー・二次資料・一般知識で補足している。**必ず原典に直接あたること**を推奨する。

| 節 | URL | 理由（要約） |
| --- | --- | --- |
| 第1章 Playgrounds | https://www.openidconnect.net/ | SPA の動的レンダリングで、WebFetch では本文（フロー解説）を抽出できなかった。 |
| 第2章 pentest guides | https://blog.securityinnovation.com/pentesters-guide-to-evaluating-oauth-2.0 | HTTP 404（削除/移転）。著者ミラーと二次資料から内容を反映。 |
| 第2章 pentest guides | https://outpost24.com/blog/common-oauth-vulnerabilities-mitigations/ | HTTP 403。ミラー/要約記事（7項目の脆弱性と対策の直接引用）から反映。 |
| 第2章 misconfig | https://coffsec.medium.com/10-oauth-misconfiguration-exploits-every-pentester-must-master-ef1f71324faf | HTTP 403。ミラー無し。WebSearch の要約のみ取得。 |
| 第2章 misconfig | https://medium.com/a-bugz-life/the-wondeful-world-of-oauth-bug-bounty-edition-af3073b354c1 | 原本・代替リーダーとも 403/404。WebSearch の要約のみ取得。 |
| 第3章 HackerOne | https://hackerone.com/reports/861940 | クライアントサイドレンダリングで本文が空。研究者本人の投稿要約とミラーのメタデータで裏取り。 |
| 第3章 HackerOne | https://hackerone.com/reports/1861974 | 同上。dev.to 解説記事と GitHub まとめから技術内容を確認。 |
| 第3章 HackerOne | https://hackerone.com/reports/2575 | 同上。検索結果と GitHub ミラーの断片から手法・解決日を確認。 |
| 第3章 misconfig 連鎖 | https://medium.com/@iamshafayat/how-i-found-a-critical-oauth-misconfiguration-that-led-to-account-takeover-abfec43eaea6 | HTTP 403。daily.dev ミラーと検索結果から内容を復元して反映。 |
| 第3章 misconfig 連鎖 | https://medium.com/@KhaledAhmed107/how-i-found-5-oauth-misconfigurations-leading-to-pre-account-takeover-in-public-bug-bounty-programs-021d4c8c6954 | 原文 403、ミラーも取得不可。要約のみ入手、一般知識で補足し注記。 |
| 第3章 misconfig 連鎖 | https://medium.com/@0x_xnum/full-account-takeover-via-facebook-oauth-misconfiguration-9e30fe1c1da1 | 原文・同系ミラー 403。要約のみ入手、一般知識で補足し注記。 |
| 第3章 pre-ATO | https://infosecwriteups.com/pre-account-takeover-via-oauth-misconfiguration-0e393cda1f7e | HTTP 403。WebSearch の要約レベルのみ、原文の完全な例は未取得。 |
| 第4章 JWT ラボ参考 | https://siunam321.github.io/ctf/portswigger-labs/JWT/jwt-7/ | 取得はできたが、対象が別バリアント（公開鍵公開版）の手順で、本節対象（no exposed key）とは異なるため注記のうえ一般知識で補足。 |
| 第4章 PentesterLab | https://pentesterlab.com/exercises/oauth2 | PRO 限定コンテンツ。公開ページには演習概要のみ。 |
| 第4章 チェックリスト | https://binarybrotherhood.io/oauth2_threat_model.html | DNS 解決失敗。ミラーも取得不可。検索結果の要約で代替。 |
| 第4章 チェックリスト | https://cristivlad.medium.com/11-pro-tips-for-oauth-2-0-pentesting-5be06daa8996 | HTTP 403。同著者内容を引用した転載版から 11 項目を取得。 |
| 第5章 DPoP | https://darutk.medium.com/illustrated-dpop-oauth-access-token-security-enhancement-801680d761ff | HTTP 403。WebSearch の要約のみ取得。 |

---

## 付録C：用語集

- **RO（Resource Owner）** … リソースの持ち主（＝エンドユーザー）。
- **Client** … RO の代わりにリソースへアクセスするアプリ。confidential（サーバ側で秘密を守れる）と public（SPA/モバイル等）に分かれる。
- **AS（Authorization Server）** … 認証・同意を受け、認可コードやトークンを発行するサーバ。
- **RS（Resource Server）** … アクセストークンを検証して保護リソースを返す API サーバ。
- **Authorization Code フロー** … コードを一旦発行し、バックエンドでトークンと交換する最も安全な標準フロー。現在は PKCE 併用が必須。
- **Implicit フロー** … トークンを URL フラグメントで直接返す旧式フロー。OAuth 2.1/RFC 9700 で非推奨・廃止方向。
- **PKCE（RFC 7636）** … `code_verifier`/`code_challenge` で認可コード横取りを防ぐ仕組み。全 code flow で必須化された。
- **state** … 認可リクエストとコールバックを紐付け CSRF を防ぐ不透明値。
- **nonce** … OIDC で `id_token` のリプレイを防ぐ値。
- **access token** … RS へのアクセス権を表すトークン（Bearer が一般的）。
- **ID token** … OIDC でユーザーの認証事実を表す署名付き JWT（`iss`/`aud`/`sub`/`exp`/`nonce` を検証する）。
- **refresh token** … access token を再発行するための長命トークン。
- **redirect_uri** … 認可後にコード/トークンを返す戻り先。**exact match** 検証が原則。
- **mix-up 攻撃** … 複数 AS 環境で、レスポンスの発行元を取り違えさせてコード/トークンを別 AS に送らせる攻撃。
- **algorithm confusion** … RS256 想定の検証器を HS256 と誤認させ、公開鍵を HMAC 鍵として悪用する JWT 攻撃。
- **DPoP（RFC 9449）** … トークンを送信元の鍵に束縛（sender-constrained）し、盗んでも使えなくする仕組み。
- **PAR / JARM / mTLS** … FAPI 等で使う、認可リクエスト保護・レスポンス署名・相互 TLS の各機構。
- **FAPI** … Financial-grade API。高リスク API 向けの厳格なプロファイル（1.0/2.0）。
- **RFC 9700（BCP 240）** … OAuth 2.0 Security Best Current Practice。Implicit/Password grant 廃止、PKCE 必須化などを公式化（2025年1月発行）。

---

## 付録D：参考書籍

- Justin Richer & Antonio Sanso『OAuth 2 in Action』(Manning, 2017) — フロー理解と実装観点の土台。
- Prabath Siriwardena『OpenID Connect in Action』 — OIDC を体系的に学ぶ。
- Aaron Parecki『OAuth 2.0 Simplified』（Web版 oauth.com） — 入門から実装まで。

> 書籍は「正しいフロー」を固めるために有効。攻撃面は本書の第2〜4章と各ブログ/ラボで補完すること。

---

## ナビゲーション

[← 第5章 発展と最新動向](05-advanced.md)  ｜  [📚 目次（ホーム）](index.md)
