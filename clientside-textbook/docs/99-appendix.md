# 付録

## 付録A: 全URL一覧

本書の土台となったロードマップ（`roadmaps/clientside.md`）に掲載された全77URLを、対応する章ごとに一覧化する。各資料の内容は本文の該当節で解説しているので、そちらを起点に原典へ当たってほしい。

### 第1章 ブラウザの動作原理とWebプラットフォームの基礎（4件）

> [章を開く](01-browser-internals.md)

- Inside look at modern web browser（Mariko Kosaka／Googleエンジニア、全4部、Chrome for Developers。原文は2018年9月にdevelopers.google.com/webで初公開）: part1 https://developer.chrome.com/blog/inside-browser-part1 / part2 https://developer.chrome.com/blog/inside-browser-part2 / part3 https://developer.chrome.com/blog/inside-browser-part3
- How Browsers Work: Behind the Scenes of Modern Web Browsers（Tali Garsiel & Paul Irish）: https://www.html5rocks.com/tutorials/internals/howbrowserswork/
- Web Browser Engineering（無料オンライン書籍、ブラウザを実装しながら学ぶ）: https://browser.engineering/
- Notes on How Browsers Work（読解ノート、図解つき）: https://codeburst.io/how-browsers-work-6350a4234634

### 第2章 ブラウザのセキュリティモデル（14件）

> [章を開く](02-browser-security-model.md)

- SOP/CORS総合解説（Medium, Emrebener）: https://emrebener.medium.com/a-comprehensive-guide-to-the-same-origin-policy-and-the-cors-policy-4ca7535b0145
- PortSwigger: What is CORS?: https://portswigger.net/web-security/cors
- OWASP HTML5 Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html
- OWASP HTTP Headers Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
- SameSite cookies explained（web.dev）: https://web.dev/articles/samesite-cookies-explained
- Secure/HttpOnly/SameSite解説（Medium）: https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6
- Content security policy（web.dev）: https://web.dev/articles/csp
- OWASP CSP Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- CSP Bypass技法集（GitHub, bhaveshk90）: https://github.com/bhaveshk90/Content-Security-Policy-CSP-Bypass-Techniques/blob/main/README.md
- CSP Bypass（HackTricks）: https://hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html
- OWASP Clickjacking Defense Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html
- Site Isolation for web developers（Chrome for Developers）: https://developer.chrome.com/blog/site-isolation
- Meltdown/Spectre（Chrome for Developers）: https://developer.chrome.com/blog/meltdown-spectre
- Site Isolation（Chromium公式）: https://www.chromium.org/Home/chromium-security/site-isolation/

### 第3章 JavaScriptの深い理解と読解スキル（5件）

> [章を開く](03-javascript-deep-reading.md)

- The Modern JavaScript Tutorial（javascript.info）: https://javascript.info/
- MDN JavaScript Guide: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide
- Eloquent JavaScript（Marijn Haverbeke, 無料オンライン書籍）: https://eloquentjavascript.net/
- 書籍『JavaScript for hackers』（Gareth Heyes／PortSwigger研究者、XSS Cheat Sheet著者・Hackvertor作者。Leanpub版は2022年12月21日公開、独立出版版105ページ、ISBN 9798371872166）: https://leanpub.com/javascriptforhackers
- Gareth Heyes 個人サイト（研究記事）: https://garethheyes.co.uk/

### 第4章 クライアントサイドコードのリバースエンジニアリング（14件）

> [章を開く](04-client-side-reversing.md)

- webcrack（obfuscator.io解除・unminify・webpack/browserify展開, GitHub）: https://github.com/j4k0xb/webcrack
- webcrack Deobfuscationドキュメント: https://webcrack.netlify.app/docs/concepts/deobfuscate.html
- de4js（オンラインdeobfuscator/unpacker）: https://lelinhtinh.github.io/de4js/
- Deobfuscating/Unminifying Obfuscated JavaScript ツール集（0xdevalias gist）: https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581
- 自作deobfuscatorを書く（HackMag）: https://hackmag.com/coding/js-deobfuscation
- SPA source code recovery by un-Webpacking source maps（rarecoil, Medium）: https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d
- sourcemapper（Go製, source tree再構築）: https://deepwiki.com/denandz/sourcemapper
- Abusing Exposed Sourcemaps（Sentry Blog, 実例あり）: https://blog.sentry.security/abusing-exposed-sourcemaps/
- Source Map Exposure解説（Raijuna）: https://www.raijuna.com/knowledge/source-map-exposure
- LinkFinder（JSからエンドポイント抽出, GitHub）: https://github.com/GerbenJavado/LinkFinder
- SecretFinder（JSからAPIキー/トークン検出, GitHub）: https://github.com/m4ll0k/SecretFinder
- jsluice等を含むツール総覧（awesome-bugbounty-tools）: https://github.com/vavkamil/awesome-bugbounty-tools
- JavaScript recon実践（OSINT Team, Medium）: https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e
- 高度なJS内データ漏洩ハンティング（Medium）: https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6

### 第5章 ブラウザDevToolsの徹底活用（5件）

> [章を開く](05-devtools-mastery.md)

- Debug JavaScript（Chrome DevTools入門）: https://developer.chrome.com/docs/devtools/javascript
- JavaScript debugging reference（Chrome DevTools）: https://developer.chrome.com/docs/devtools/javascript/reference
- Pause your code with breakpoints（Chrome DevTools）: https://developer.chrome.com/docs/devtools/javascript/breakpoints
- Chrome DevTools JavaScript Debugging Complete Guide 2026（DevPlaybook, source map/local overrides含む）: https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/
- How to Debug JavaScript in Chrome（BrowserStack）: https://www.browserstack.com/guide/how-to-debug-js-in-chrome

### 第6章 プロキシと専用ツールによる動的解析（9件）

> [章を開く](06-proxy-and-dom-invader.md)

- Burp Suite getting started（公式）: https://portswigger.net/burp/documentation/desktop/getting-started
- Burp Proxy（公式）: https://portswigger.net/burp/documentation/desktop/tools/proxy
- Burp Repeater（公式）: https://portswigger.net/burp/documentation/desktop/tools/repeater
- Burp Intruder（公式）: https://portswigger.net/burp/documentation/desktop/tools/intruder
- DOM Invader（公式ドキュメント）: https://portswigger.net/burp/documentation/desktop/tools/dom-invader
- Introducing DOM Invader（PortSwigger Blog, Gareth Heyes, 2021-06-30）: https://portswigger.net/blog/introducing-dom-invader
- Testing for DOM XSS（DOM Invader）: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
- Testing for DOM XSS using web messages（DOM Invader）: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages
- postMessage-tracker（Frans Rosén, Chrome拡張）: https://github.com/fransr/postMessage-tracker

### 第7章 クライアントサイド攻撃面のマッピングと方法論（9件）

> [章を開く](07-attack-surface-methodology.md)

- DOM-based vulnerabilities（PortSwigger, sources/sink一覧）: https://portswigger.net/web-security/dom-based
- PostMessage Vulnerabilities（HackTricks）: https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html
- An Introduction to postMessage Vulnerabilities（YesWeHack）: https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
- Exploiting PostMessage Vulnerabilities（Intigriti）: https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities
- PostMessage Vulnerabilities Part I（Jorge Lajara）: https://jlajara.gitlab.io/Dom_XSS_PostMessage
- Attacking "Modern" Web Technologies（Frans Rosén, OWASP AppSecEU 2018スライド）: https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies
- 動画版（YouTube）: https://www.youtube.com/watch?v=vRqcUS4CPFs
- My JavaScript Recon Process（gist）: https://gist.github.com/pikpikcu/b034a7e3b8bf966a6eba95acb1fbfe08
- Comprehensive Recon Guide: https://chs.us/guides/recon/

### 第8章 発展的なクライアントサイド技術領域（8件）

> [章を開く](08-advanced-client-side.md)

- Abusing Service Workers（HackTricks）: https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers
- Service Worker Security FAQ（Chromium公式）: https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md
- WebSockets（PortSwigger）: https://portswigger.net/web-security/websockets
- Clickjacking（PortSwigger）: https://portswigger.net/web-security/clickjacking
- Browser Extension Pentesting Methodology（HackTricks）: https://hacktricks.wiki/en/pentesting-web/browser-extension-pentesting-methodology/index.html
- OWASP Browser Extension Vulnerabilities Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html
- Understanding the text format (WAT)（MDN, WASM解析の基礎）: https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format
- WABT: The WebAssembly Binary Toolkit（wat2wasm/wasm2wat等, GitHub）: https://github.com/WebAssembly/wabt

### 第9章 日本語資料と動画で学びを補強する（7件）

> [章を開く](09-japanese-and-video.md)

**日本語の優良資料（横断）**

- 書籍『フロントエンド開発のためのセキュリティ入門』（著者：平野昌士／サイボウズ、監修：はせがわようすけ・後藤つぐみ／セキュアスカイ・テクノロジー。翔泳社、2023年2月13日発行、ISBN 9784798169477）抜粋記事: https://codezine.jp/article/detail/17342
- DOM based XSSの検出方法を理解する（GMO Developers）: https://developers.gmo.jp/technology/15402/
- JavaScript Security連載 第7回 DOM-based XSS（gihyo.jp, はせがわようすけ）: https://gihyo.jp/dev/serial/01/javascript-security/0007
- はせがわようすけ スライド一覧（docswell）: https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss
- DOMベースXSSとは（Qiita, source/sink解説）: https://qiita.com/nozomi2025/items/909d552cec761c6412f2

**動画・チャンネル（横断）**

- LiveOverflow（YouTube）: https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w
- PwnFunction（YouTube）: https://www.youtube.com/c/PwnFunction/videos

---

## 付録B: 未取得の資料

本書の執筆では各URLを実際に取得して内容を再構成しているが、以下の15件（全77件中）はログイン必須・Bot対策・ペイウォール・JS依存レンダリング等により、原典の本文を自動取得できなかった。該当箇所は本文中にも警告を挿入し、一般知識に基づく補足であることを明示している。**これらについては、必ずご自身で直接URLを開いて確認してほしい。**

なお、うち2件（HackTricksのService Worker／postMessageページ）は公式GitHub rawミラーから同等内容を取得できたため、本文の技術内容は原典相当でカバーされている。

### B-1. Medium系（403 Forbidden / Bot対策）

| 資料 | URL | 理由と代替 |
|---|---|---|
| A Comprehensive Guide to the Same-Origin Policy and the CORS Policy（Emrebener） | https://emrebener.medium.com/a-comprehensive-guide-to-the-same-origin-policy-and-the-cors-policy-4ca7535b0145 | HTTP 403。GitHubミラーも存在せず、WebSearchの要約レベルの情報＋一般知識で補足（第2章） |
| Secure/HttpOnly/SameSite HTTP Cookies Attributes and Set-Cookie Explained | https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6 | HTTP 403。タイトルと要約スニペットのみ取得し、一般知識で補足（第2章） |
| SPA source code recovery by un-Webpacking source maps（rarecoil） | https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d | HTTP 403。**代替**として著者自身の公開リポジトリ `rarecoil/unwebpack-sourcemap`（README・ソースコード）から等価の技術内容を復元済み（第4章） |
| Automate JavaScript (JS) Extraction for Bug Bounty Recon（OSINT Team） | https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e | HTTP 403。代替ミラー（freedium.cfd）もDNS解決不可。WebSearchの要約のみ（第4章） |
| Hunting Sensitive Data Leaks in JavaScript: An Advanced Recon Guide | https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6 | 同上。WebSearchの要約のみ（第4章） |
| Notes on How Browsers Work（codeburst） | https://codeburst.io/how-browsers-work-6350a4234634 | HTTP 403。WebSearchでも本文を取得できず。ただし本節の主資料である "How Browsers Work" 原典（web.dev）は取得済みのため、内容的な欠落は小さい（第1章） |

### B-2. ペイウォール／購入者限定

| 資料 | URL | 理由と代替 |
|---|---|---|
| 書籍『JavaScript for hackers』（Gareth Heyes） | https://leanpub.com/javascriptforhackers | 販売ページのみ取得可能で本文は購入者限定。目次・章題・書誌メタデータのみ取得。**代替**として具体的な技法は著者自身の公開研究記事（PortSwigger Research / garethheyes.co.uk）を一次情報として引用（第3章） |
| CSP Bypass（HackTricks） | https://hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html | `tollbit.hacktricks.wiki` への302リダイレクト先で HTTP 402 Payment Required（Tollbitペイウォール）。WebSearchで代替情報を収集し補足（第2章） |
| Abusing Service Workers（HackTricks） | https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers | 同じくTollbitペイウォールで402。**ただし公式GitHub rawミラー（`HackTricks-wiki/hacktricks`）から同内容を取得できたため、本文の技術内容・コード引用は原典相当でカバー済み**（第8章） |
| PostMessage Vulnerabilities（HackTricks） | https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html | 同じく402。**GitHub raw原本から同等内容を取得して本文に反映済み**（第7章） |

### B-3. 日本語メディア（403 Forbidden）

| 資料 | URL | 理由と代替 |
|---|---|---|
| 『フロントエンド開発のためのセキュリティ入門』抜粋記事（CodeZine） | https://codezine.jp/article/detail/17342 | HTTP 403（Retry-After: 600）。ミラーも存在せず、WebSearchの要約情報で代替し、本文に警告と補足を挿入（第9章） |

### B-4. 動的レンダリング依存（YouTube）

YouTubeのページはJavaScriptによる動的レンダリングに依存しており、自動取得では空のHTMLシェル（フッターナビゲーションのみ）しか得られない。以下3件は本文をWebSearchおよび公開スライド等で補完している。

| 資料 | URL | 理由と代替 |
|---|---|---|
| Attacking "Modern" Web Technologies 講演動画（Frans Rosén） | https://www.youtube.com/watch?v=vRqcUS4CPFs | 別アップロードも同様に失敗。**代替**としてSpeakerDeck／SlideShare版スライドで内容を補完（第7章） |
| LiveOverflow（チャンネル） | https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w | チャンネル説明・動画一覧を取得できず。WebSearchで代替調査（第9章） |
| PwnFunction（チャンネル） | https://www.youtube.com/c/PwnFunction/videos | 同上（第9章） |

### B-5. 部分取得

| 資料 | URL | 理由 |
|---|---|---|
| DOM Invader 公式ドキュメント（PortSwigger） | https://portswigger.net/burp/documentation/desktop/tools/dom-invader | トップページがリンク集構成のため、"Enabling DOM Invader" や "Canary settings" など各サブページの詳細な**UI操作手順**を自動取得できなかった。概要・対応脆弱性クラス・機能一覧・設定カテゴリ名は本文に反映済み。**サブページ（dom-xss / web-messages）は個別に取得できているため、実運用上の欠落は限定的**（第6章） |

### リダイレクトにより別URLで取得した資料

以下は「未取得」ではないが、ロードマップ記載のURLと実際に取得したURLが異なるため記録しておく。

| ロードマップ記載URL | 実際に取得したURL |
|---|---|
| https://www.html5rocks.com/tutorials/internals/howbrowserswork/ | https://web.dev/howbrowserswork （html5rocks.com から web.dev へ移設・リダイレクト） |

---

## 付録C: 用語集

本書に頻出する用語を、初出章とともにまとめる。

### データフロー解析

| 用語 | 説明 |
|---|---|
| **source（ソース）** | 攻撃者が値を制御できる入力の入り口。`location.href` / `location.hash` / `document.referrer` / `window.name` / `document.cookie` / `postMessage` の `event.data` / `localStorage`・`sessionStorage`・IndexedDB の読み出しなど。（第7章） |
| **sink（シンク）** | 入力が最終的に実行・解釈される危険な代入先。`eval()` / `innerHTML` / `document.write()` / `element.src` / `setTimeout(文字列)` / `Function()` / `location` への代入など。sourceからsinkへ未検証の値が到達することが、DOM-based脆弱性の成立条件。（第7章） |
| **データフロー追跡（source→sink）** | ある入力値が、どのコードパスを経てどのsinkに到達するかを追うこと。本書の中核スキル。手動ではDevToolsのブレークポイントとcall stack / scope、自動ではDOM Invaderのcanaryを用いる。（第5・6章） |
| **canary（カナリア）** | DOM Invaderが注入する目印となるランダム文字列。この文字列がどのsinkに現れるかを監視することで、source→sinkの経路を自動的に炙り出す。（第6章） |
| **Augmented DOM** | DOM Invaderが提供する、sinkの位置と文脈を注釈付きで可視化したDOM表示。PortSwiggerの表現では「反射型XSSを見るのと同じ感覚でDOM XSSを見つけられる」ようにするもの。（第6章） |
| **gadget（ガジェット）** | 単独では無害だが、攻撃者が制御する条件下で危険な動作に繋がるコード片。prototype pollutionでは、汚染されたプロパティを読んでsinkに渡すライブラリ内のコードを指す。（第3・6章） |

### ブラウザ内部

| 用語 | 説明 |
|---|---|
| **レンダリングパイプライン** | parse → style → layout → paint → composite の一連の処理。どの段階でDOMが確定し、いつJSが割り込むかを知ることが、ブレークポイントの置き所の直感を作る。（第1章） |
| **イベントループ** | タスクキューとマイクロタスクキューを処理する実行モデル。非同期コードの実行順序とレースコンディションの成立条件を規定する。（第1・3章） |
| **DOM構築 / CSSOM構築** | HTMLパーサがトークンからDOMツリーを、CSSパーサがCSSOMを構築する過程。不正な形式のHTMLに対する「open elements stack」による寛容な補正が、mutation XSSの温床になる。（第1章） |
| **Site Isolation** | 異なるサイトを別レンダラプロセスに分離するChromiumの仕組み。Spectre系のサイドチャネル攻撃への緩和策として導入された。（第2章） |

### セキュリティモデル

| 用語 | 説明 |
|---|---|
| **Origin（オリジン）** | scheme + host + port の三つ組。SOPが「同一」と判定する単位。site（eTLD+1）とは粒度が異なる点に注意。（第2章） |
| **SOP（Same-Origin Policy）** | 異なるオリジンのドキュメント／スクリプト間のアクセスを制限する、ブラウザの基礎的な分離原則。（第2章） |
| **CORS** | SOPの制約を、サーバ側が明示的に緩和するための仕組み。`Access-Control-Allow-Origin` にリクエストの `Origin` をそのまま反射する構成や、`Allow-Credentials: true` との組み合わせが典型的な設定ミス。（第2章） |
| **preflight** | 単純リクエストに該当しないクロスオリジン要求の前に送られる `OPTIONS` 要求。許可されたメソッド／ヘッダをサーバに確認する。（第2章） |
| **CSP（Content Security Policy）** | 読み込み可能なリソースと実行可能なスクリプトを制限するヘッダ。`unsafe-inline` の残存、緩いホワイトリスト、JSONP エンドポイントの許可などがbypassの糸口になる。（第2章） |
| **strict CSP** | nonceまたはhashと `strict-dynamic` を組み合わせた、ホスト名ホワイトリストに依存しないCSP設計。（第2章） |
| **SameSite** | Cookieをクロスサイト要求に添付するかを制御する属性（`Strict` / `Lax` / `None`）。CSRFの前提条件に直結する。（第2章） |
| **`__Host-` プレフィックス** | Cookie名に付けると、`Secure` 必須・`Domain` 指定禁止・`Path=/` 必須が強制される。サブドメインからの上書き（cookie tossing）を防ぐ。（第2章） |
| **postMessage** | ウィンドウ／iframe間のクロスオリジン通信API。受信側での `event.origin` 検証の欠落や不十分な検証（前方一致・`indexOf` など）が典型的な脆弱性。（第2・7章） |
| **clickjacking** | 透明なiframeで標的サイトを重ね、利用者の意図しないクリックを誘導する攻撃。`X-Frame-Options` / CSP `frame-ancestors` で防ぐ。（第2・8章） |
| **reverse tabnabbing** | `target="_blank"` で開いた先から `window.opener` 経由で元タブを書き換える攻撃。`rel="noopener"` で防ぐ。（第8章） |

### コード解析

| 用語 | 説明 |
|---|---|
| **minify / uglify** | 空白・改行の除去と識別子の短縮によるファイルサイズ削減。可逆ではないが、beautifierで構造は復元できる。（第4章） |
| **bundle** | webpack等が複数モジュールを1ファイル（またはchunk群）にまとめたもの。モジュールIDとランタイムの構造を知ると、元のモジュール境界を追える。（第4章） |
| **obfuscation（難読化）** | 制御フロー平坦化、文字列配列化、デッドコード挿入などによる意図的な難読化。webcrack や de4js が代表的な解除ツール。（第4章） |
| **source map** | 変形後のコードと元ソースの対応表（`.map` ファイル）。`sourcesContent` を含む場合、元のソースツリーをほぼ完全に復元できる。公開されていること自体が情報漏えいになりうる。（第4章） |
| **AST（抽象構文木）** | ソースコードの構文構造を木で表現したもの。正規表現では扱えない難読化の解除は、ASTを変形することで行う。（第4章） |
| **JS recon** | 収集したJSファイルから、隠れたAPIエンドポイント・パラメータ・シークレットを抽出する調査手法。LinkFinder / SecretFinder / jsluice などを使う。誤検知の選別が実力の差になる。（第4章） |

### DevTools / Burp

| 用語 | 説明 |
|---|---|
| **conditional breakpoint** | 指定した式が真のときだけ止まるブレークポイント。ループ内や高頻度に呼ばれる関数で、目的の値のときだけ止めるのに必須。（第5章） |
| **DOM / XHR / event listener breakpoint** | それぞれDOM変更時、特定URLを含むXHR発行時、特定イベント発火時に実行を止める仕組み。「原因コードがどこか分からない」状況で出発点を作る。（第5章） |
| **local overrides** | DevToolsでリモートのファイルをローカルの編集版に差し替えて読み込ませる機能。変形済みコードにログを仕込んで挙動を観察できる。（第5章） |
| **call stack / scope / watch** | 停止時に、どこから呼ばれたか（call stack）、その時点で見えている変数（scope）、任意の式の評価結果（watch）を確認するパネル群。データの出所を遡る主要な道具。（第5章） |

### 発展領域

| 用語 | 説明 |
|---|---|
| **Service Worker** | オリジン単位で登録され、ネットワーク要求を傍受できるバックグラウンドスクリプト。登録できてしまうと持続的な侵害に繋がるため、スコープと登録経路が重要。（第8章） |
| **isolated world** | ブラウザ拡張のcontent scriptが実行される、ページのJSと変数空間を共有しない隔離環境。DOMは共有する。（第8章） |
| **web_accessible_resources** | ブラウザ拡張が、Webページからアクセス可能にするリソースの宣言。広く公開しすぎると拡張の内部機能が外部から悪用されうる。（第8章） |
| **WAT / WASM** | WebAssemblyのテキスト形式（WAT）とバイナリ形式（WASM）。`wat2wasm` / `wasm2wat`（WABT）で相互変換し、解析の入口にする。（第8章） |

---

## 付録D: 参考書籍

| 書籍 | 著者・出版 | 位置づけ |
|---|---|---|
| **『フロントエンド開発のためのセキュリティ入門』** | 著: 平野昌士（サイボウズ）／監修: はせがわようすけ・後藤つぐみ（セキュアスカイ・テクノロジー）。翔泳社、2023年2月13日発行、ISBN 9784798169477 | 日本語で書かれたフロントエンドセキュリティの定番入門書。本書の第2章（セキュリティモデル）と第9章の内容に対応する。抜粋記事: https://codezine.jp/article/detail/17342 |
| **『JavaScript for hackers』** | Gareth Heyes（PortSwigger研究者、XSS Cheat Sheet著者・Hackvertor作者）。Leanpub版2022年12月21日公開、独立出版版105ページ、ISBN 9798371872166 | 攻撃者目線のJS読解・技法に特化した薄く濃い一冊。第3章の主資料。https://leanpub.com/javascriptforhackers |
| **『Web Browser Engineering』**（無料オンライン書籍） | Pavel Panchekha & Chris Harrelson | ブラウザを自分で実装しながらレンダリングの原理を学ぶ。第1章の理解を実装レベルまで深めたい場合に。https://browser.engineering/ |
| **『Eloquent JavaScript』**（無料オンライン書籍） | Marijn Haverbeke | JavaScript言語の基礎を体系的に固めるための定番。第3章の前提。https://eloquentjavascript.net/ |

---

[← 第9章 日本語資料と動画で学びを補強する](09-japanese-and-video.md) ｜ [📖 目次](index.md)
