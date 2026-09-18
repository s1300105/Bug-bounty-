# 付録C 資料インデックス（元になった全URL・一言解説つき）

> **この付録の意味**
> この教科書の元になった、ロードマップの全資料URLを、章（Lv）ごとに一言解説つきで一覧にした。「あの話はどの資料が元だったか」を逆引きしたいとき、次に深掘りする資料を探すときに使う。
> 取得可否は付録D（自分で開くべき資料リスト）を参照。研究ノート本体は `textbook/_research-notes/NN-*.md` にある（NNが資料番号）。

凡例: 📗＝内容を原典/GitHubミラーから取得できた資料　📙＝内容が二次情報ベースで、自分で開く価値が高い資料（付録D参照）

---

## Lv1 ブラウザの動作原理（→ 第1章）

| # | 資料 | URL | 一言 |
| --- | --- | --- | --- |
| 01 | 📗 Inside look at modern web browser part1（Mariko Kosaka/Google） | `https://developer.chrome.com/blog/inside-browser-part1` | CPU/GPU/メモリとマルチプロセス構成 |
| 02 | 📗 同 part2 | `https://developer.chrome.com/blog/inside-browser-part2` | ナビゲーションの全工程、MIME sniffing、CORB |
| 03 | 📗 同 part3 | `https://developer.chrome.com/blog/inside-browser-part3` | レンダラ内部：パース→DOM→style→layout→paint→composite |
| 04 | 📗 同 part4 | `https://developer.chrome.com/blog/inside-browser-part4` | 入力イベントとコンポジタスレッド |
| 05 | 📗 How Browsers Work（Garsiel & Irish） | `https://www.html5rocks.com/tutorials/internals/howbrowserswork/` | ブラウザ内部の古典的大解説。HTMLパーサの寛容性 |
| 06 | 📗 Web Browser Engineering | `https://browser.engineering/` | ブラウザを自作して学ぶ無料書籍 |
| 07 | 📙 Notes on How Browsers Work（codeburst） | `https://codeburst.io/how-browsers-work-6350a4234634` | How Browsers Workの図解読解ノート |

## Lv2 ブラウザのセキュリティモデル（→ 第2章）

| # | 資料 | URL | 一言 |
| --- | --- | --- | --- |
| 08 | 📙 SOP/CORS総合解説（Emrebener）＋📙 What is CORS?（PortSwigger） | `https://emrebener.medium.com/...` / `https://portswigger.net/web-security/cors` | オリジン、SOP、CORSヘッダ交換、設定ミスの悪用 |
| 09 | 📗 OWASP HTML5 Security Cheat Sheet | `https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html` | postMessage/WebSocket/Storage等の安全な使い方 |
| 10 | 📗 OWASP HTTP Headers Cheat Sheet | `https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html` | セキュリティヘッダの推奨値一覧 |
| 11 | 📗 SameSite cookies explained（web.dev）＋📙 Cookie属性解説（Medium） | `https://web.dev/articles/samesite-cookies-explained` | Cookie属性、SameSite、__Host-/__Secure- |
| 12 | 📗 Content security policy（web.dev）＋📗 OWASP CSP Cheat Sheet | `https://web.dev/articles/csp` / `.../Content_Security_Policy_Cheat_Sheet.html` | CSPの基礎、strict CSP、Trusted Types |
| 13 | 📗 CSP Bypass技法集（bhaveshk90）＋📗 CSP Bypass（HackTricks） | `https://github.com/bhaveshk90/...` / `https://hacktricks.wiki/.../content-security-policy-csp-bypass/...` | CSPバイパスの網羅 |
| 14 | 📗 OWASP Clickjacking Defense Cheat Sheet＋📙 Clickjacking（PortSwigger） | `.../Clickjacking_Defense_Cheat_Sheet.html` / `https://portswigger.net/web-security/clickjacking` | クリックジャッキングの原理と防御 |
| 15 | 📗 Site Isolation / Meltdown-Spectre（Chrome）＋Site Isolation（Chromium） | `https://developer.chrome.com/blog/site-isolation` ほか | プロセス分離、投機実行、COOP/COEP |

## Lv3 JavaScriptの深い理解（→ 第3章）

| # | 資料 | URL | 一言 |
| --- | --- | --- | --- |
| 16 | 📗 The Modern JavaScript Tutorial | `https://javascript.info/` | JSの体系的チュートリアル（学習地図） |
| 17 | 📗 MDN JavaScript Guide | `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide` | JS言語仕様の解説 |
| 18 | 📗 Eloquent JavaScript | `https://eloquentjavascript.net/` | 無料書籍。高階関数、オブジェクト、DOM、セキュリティ節 |
| 19 | 📙 JavaScript for hackers（Gareth Heyes）＋個人サイト | `https://leanpub.com/javascriptforhackers` / `https://garethheyes.co.uk/` | 攻撃者目線のJS読解（有料書籍） |

## Lv4 リバースエンジニアリング／コード解析（→ 第4章）

| # | 資料 | URL | 一言 |
| --- | --- | --- | --- |
| 20 | 📗 webcrack（+ docs） | `https://github.com/j4k0xb/webcrack` | obfuscator.io解除・unminify・bundle展開の主力ツール |
| 21 | 📙 de4js＋📙 難読化解除ツール総覧（0xdevalias gist） | `https://lelinhtinh.github.io/de4js/` / `https://gist.github.com/0xdevalias/...` | オンラインdeobfuscatorとツール横断リスト |
| 22 | 📙 自作deobfuscatorを書く（HackMag） | `https://hackmag.com/coding/js-deobfuscation` | ASTで難読化を解く実装（完全遮断・要自読） |
| 23 | 📙 SPA source code recovery（rarecoil）＋📗 sourcemapper | `https://medium.com/@rarecoil/...` / `https://deepwiki.com/denandz/sourcemapper` | source mapからソースツリーを復元 |
| 24 | 📙 Abusing Exposed Sourcemaps（Sentry）＋📙 Source Map Exposure（Raijuna） | `https://blog.sentry.security/abusing-exposed-sourcemaps/` ほか | 公開source mapから何が漏れるか |
| 25 | 📗 LinkFinder＋📗 SecretFinder | `https://github.com/GerbenJavado/LinkFinder` / `https://github.com/m4ll0k/SecretFinder` | JSからエンドポイント/秘密情報を抽出 |
| 26 | 📗 awesome-bugbounty-tools | `https://github.com/vavkamil/awesome-bugbounty-tools` | バグバウンティツール総覧（JS/recon含む） |
| 27 | 📙 JS recon実践（OSINT Team / samael0x4） | `https://osintteam.blog/...` / `https://samael0x4.medium.com/...` | JS収集〜解析のパイプライン |

## Lv5 DevTools（→ 第5章）

| # | 資料 | URL | 一言 |
| --- | --- | --- | --- |
| 28 | 📗 Debug JavaScript / JS debugging reference（Chrome） | `https://developer.chrome.com/docs/devtools/javascript`（+ `/reference`） | Sourcesパネルとデバッグ機能全般 |
| 29 | 📗 Pause your code with breakpoints（Chrome） | `https://developer.chrome.com/docs/devtools/javascript/breakpoints` | ブレークポイント全種の設定手順 |
| 30 | 📙 DevTools Debugging Guide 2026（DevPlaybook）＋📙 How to Debug JS in Chrome（BrowserStack） | `https://devplaybook.cc/...` / `https://www.browserstack.com/guide/...` | 実践的デバッグ手順、Local Overrides |

## Lv6 Burp / DOM Invader（→ 第6章）

| # | 資料 | URL | 一言 |
| --- | --- | --- | --- |
| 31 | 📙 Burp getting started＋Proxy | `https://portswigger.net/burp/documentation/desktop/getting-started`（+ `/tools/proxy`） | Burp導入とProxyの使い方 |
| 32 | 📙 Burp Repeater＋Intruder | `.../tools/repeater` / `.../tools/intruder` | リクエスト改変・自動化 |
| 33 | 📙 DOM Invader（公式ドキュメント） | `.../tools/dom-invader` | canaryによるsource→sink自動追跡 |
| 34 | 📙 Introducing DOM Invader（Blog）＋Testing for DOM XSS | `https://portswigger.net/blog/introducing-dom-invader` ほか | DOM Invaderの設計思想とDOM XSSテスト |
| 35 | 📙 DOM Invader web messages＋📗 postMessage-tracker（Frans Rosén） | `.../dom-invader/web-messages` / `https://github.com/fransr/postMessage-tracker` | postMessageの傍受・追跡 |

## Lv7 攻撃面マッピングと方法論（→ 第7章）

| # | 資料 | URL | 一言 |
| --- | --- | --- | --- |
| 36 | 📙 DOM-based vulnerabilities（PortSwigger） | `https://portswigger.net/web-security/dom-based` | source/sink一覧の本家（付録Bの元） |
| 37 | 📗 PostMessage Vulnerabilities（HackTricks） | `https://hacktricks.wiki/.../postmessage-vulnerabilities/...` | postMessage攻撃の全パターン |
| 38 | 📙 postMessage入門（YesWeHack）＋📙 Exploiting postMessage（Intigriti） | `https://www.yeswehack.com/...` / `https://www.intigriti.com/...` | postMessageの基礎から実践 |
| 39 | 📙 PostMessage Vulnerabilities（Jorge Lajara） | `https://jlajara.gitlab.io/Dom_XSS_PostMessage` | postMessage DOM XSSの解説とexploit |
| 40 | 📙 Attacking Modern Web Technologies（Frans Rosén, スライド+動画） | `https://speakerdeck.com/fransrosen/...` / `https://www.youtube.com/watch?v=vRqcUS4CPFs` | postMessage/SW/クラウド設定ミスの実戦 |
| 41 | 📙 JavaScript Recon Process（gist）＋Recon Guide（chs.us） | `https://gist.github.com/pikpikcu/...` / `https://chs.us/guides/recon/` | reconの手順 |

## Lv8 発展的な攻撃面（→ 第8章）

| # | 資料 | URL | 一言 |
| --- | --- | --- | --- |
| 42 | 📗 Abusing Service Workers（HackTricks）＋Service Worker Security FAQ（Chromium） | `https://book.hacktricks.xyz/.../abusing-service-workers` / `https://chromium.googlesource.com/.../service-worker-security-faq.md` | Service Workerの悪用と防御 |
| 43 | 📙 WebSockets（PortSwigger） | `https://portswigger.net/web-security/websockets` | WebSocketの観察・改変、CSWSH |
| 44 | 📗 Browser Extension Pentesting（HackTricks）＋OWASP Browser Extension Cheat Sheet | `https://hacktricks.wiki/.../browser-extension-pentesting-methodology/...` ほか | ブラウザ拡張の攻撃面と防御 |
| 45 | 📗 WAT text format（MDN）＋📗 WABT | `https://developer.mozilla.org/.../Understanding_the_text_format` / `https://github.com/WebAssembly/wabt` | WebAssembly解析の入口 |

## 日本語資料（→ 第9章）

| # | 資料 | URL | 一言 |
| --- | --- | --- | --- |
| 46 | 📙 『フロントエンド開発のためのセキュリティ入門』抜粋（CodeZine） | `https://codezine.jp/article/detail/17342` | XSSとDOM-based XSSの解説（書籍ISBN 978-4-7981-6947-7） |
| 47 | 📙 DOM based XSSの検出方法を理解する（GMO Developers） | `https://developers.gmo.jp/technology/15402/` | source/sink追跡の具体手順 |
| 48 | 📙 JavaScript Security連載 第7回（gihyo.jp, はせがわようすけ） | `https://gihyo.jp/dev/serial/01/javascript-security/0007` | DOM-based XSSの日本語解説 |
| 49 | 📙 はせがわようすけ スライド（docswell） | `https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss` | XSSのショートトーク |
| 50 | 📙 DOMベースXSSとは（Qiita） | `https://qiita.com/nozomi2025/items/909d552cec761c6412f2` | source/sinkの日本語入門 |

## 動画・チャンネル（→ 第10章）

| # | 資料 | URL | 一言 |
| --- | --- | --- | --- |
| 51 | 📙 LiveOverflow＋📙 PwnFunction | `https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w` / `https://www.youtube.com/c/PwnFunction/videos` | 原理を掘る動画／アニメーション解説 |

---

## 書籍（本教科書では内容未確認・推奨）

- 『フロントエンド開発のためのセキュリティ入門』平野昌士 著／はせがわようすけ・後藤つぐみ 監修（翔泳社、2023年2月13日、ISBN 978-4-7981-6947-7）
- 『The Tangled Web』Michal Zalewski（No Starch Press）
- 『The Web Application Hacker's Handbook』（Wiley）
- 『Web Application Security』Andrew Hoffman（O'Reilly）

## この付録のまとめ

- 元資料は51グループ（約80URL）。Lv1〜Lv8＋日本語＋動画に対応する。
- 📗は内容取得済み、📙は二次情報ベースで自分で開く価値が高い（付録D参照）。
- 各資料の詳細な研究ノートは `textbook/_research-notes/NN-*.md` にある。

<!-- sources: roadmap本体 -->
<!-- terms: 資料インデックス -->
