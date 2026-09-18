# 付録D 自分で開いて読むべき資料リスト

> **この付録の意味**
> この教科書は、クラウド上のサンドボックス環境で、ロードマップの約80本の資料を読み込んで作られた。しかしその環境は**多くのサイトへのアクセスが制限されていた**（egressプロキシが多数のドメインを遮断）。
> 本文の記述は、可能な限り一次情報（原典）に基づいているが、一部の資料は**原典を直接取得できず、二次情報（検索結果の引用断片、GitHub上のミラー、著者本人が別途公開したデータ）で内容を再構成**している。
> このリストは、そうした資料を**あなた自身が別のネットワークから開いて読むべき理由と読みどころ**をまとめたものだ。特に「グループ2」は、本教科書の記述が要約にとどまるため、**必ず原典を読むこと**。

---

## この環境で何が取得でき、何ができなかったか（要約）

- **到達できた経路**: `raw.githubusercontent.com`（公開リポジトリの生ファイル）、`gist.github.com`、`git clone`（HTTPS）、`WebSearch`ツール。
- **遮断されていた**: `developer.chrome.com`、`web.dev`、`developer.mozilla.org`、`portswigger.net`、`cheatsheetseries.owasp.org`、`hacktricks.wiki`、`javascript.info`、`eloquentjavascript.net`、`browser.engineering`、`medium.com`系、`gihyo.jp`、`qiita.com`、`codezine.jp`、`developers.gmo.jp`、`docswell.com`、`leanpub.com`、`youtube.com`、`web.archive.org`、その他個人ブログ全般。

このため資料を2グループに分けた。

- **グループ1（内容は原典から取得できた）**: 公式サイトは遮断されていたが、**その原稿ソースがGitHubで公開されている**資料。内容は原典レベルで取得できているので、本文の記述は信頼してよい。ただし「レンダリングされた公式ページ」「図・アニメーション」「最新の改訂」を見たい人は、下記URLを自分で開くとよい。
- **グループ2（内容が二次情報ベース）**: 原典もGitHubミラーも取得できず、検索結果の引用断片や著者が別途公開したデータで再構成した資料。**本教科書の記述は要約にとどまる可能性がある。必ず自分で原典を開いて読むこと。**

---

## グループ1: 内容は取得済み。原典（公式ページ）を見たい人向け

これらは本文の裏取りができている。図やアニメーション、公式の最新版を見たいときに開く。

| 資料 | 公式URL | GitHub原稿（環境から取得した経路） |
| --- | --- | --- |
| Inside look at modern web browser part 1〜4（Mariko Kosaka／Google） | `https://developer.chrome.com/blog/inside-browser-part1`〜`part4` | `GoogleChrome/developer.chrome.com` の `site/en/blog/inside-browser-partN/index.md` |
| Site Isolation for web developers | `https://developer.chrome.com/blog/site-isolation` | 同リポジトリ `.../blog/site-isolation/index.md` |
| Meltdown/Spectre | `https://developer.chrome.com/blog/meltdown-spectre` | 同 `.../blog/meltdown-spectre/index.md` |
| How Browsers Work（Tali Garsiel & Paul Irish） | `https://www.html5rocks.com/tutorials/internals/howbrowserswork/` | web.dev版 `GoogleChrome/web.dev` の `.../blog/howbrowserswork/index.md` |
| Debug JavaScript / JS debugging reference / breakpoints（Chrome DevTools） | `https://developer.chrome.com/docs/devtools/javascript`（と `/reference`, `/breakpoints`） | `GoogleChrome/developer.chrome.com` の `site/en/docs/devtools/javascript/...` |
| Content security policy（web.dev） | `https://web.dev/articles/csp` | `GoogleChrome/web.dev` の `.../blog/csp/index.md` |
| SameSite cookies explained（web.dev） | `https://web.dev/articles/samesite-cookies-explained` | 同 `.../blog/samesite-cookies-explained/index.md` |
| MDN JavaScript Guide | `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide` | `mdn/content` の `files/en-us/web/javascript/guide/...` |
| MDN WebAssembly text format（WAT） | `https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format` | `mdn/content` の `.../webassembly/guides/understanding_the_text_format/index.md` |
| OWASP CSP / HTML5 / HTTP Headers / Clickjacking / Browser Extension Cheat Sheet | `https://cheatsheetseries.owasp.org/cheatsheets/...` | `OWASP/CheatSheetSeries` の `cheatsheets/*.md` |
| HackTricks CSP bypass / postMessage / browser extension / service workers | `https://hacktricks.wiki/...`（旧 `book.hacktricks.xyz`） | `HackTricks-wiki/hacktricks` の `src/pentesting-web/...` |
| Service Worker Security FAQ（Chromium） | `https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md` | `chromium/chromium` の `docs/security/service-worker-security-faq.md` |
| Eloquent JavaScript | `https://eloquentjavascript.net/` | `marijnh/Eloquent-JavaScript` の各章 `NN_*.md` |
| Web Browser Engineering | `https://browser.engineering/` | `browserengineering/book` の `book/*.md` |
| The Modern JavaScript Tutorial | `https://javascript.info/` | `javascript-tutorial/en.javascript.info` の各記事 |
| webcrack / de4js / sourcemapper / LinkFinder / SecretFinder / awesome-bugbounty-tools / postMessage-tracker / WABT / CSP Bypass Techniques | 各GitHub / netlify | 各リポジトリのREADME・docsを `raw.githubusercontent.com` から取得 |
| WABT（WebAssembly Binary Toolkit） | `https://github.com/WebAssembly/wabt` | `WebAssembly/wabt` の README |

> ### 📌 グループ1について
> **なぜ自分でも開くとよいか**: Chrome公式ブログのpart1〜4には、プロセスやIPC、タブのクラッシュを表す**アニメーションSVG**があり、静止した文章では動きの情報が落ちる。図で理解したい人は公式ページを開くこと。またGitHub原稿は取得時点のもので、公式が後から改訂している可能性がある。

---

## グループ2: 内容が二次情報ベース。必ず自分で原典を読むこと

以下は原典もミラーも取得できず、本教科書の記述が**要約・再構成にとどまる**資料。読みどころを添えたので、自分で開いて確認してほしい。

### 第2章・第6章・第7章 ― PortSwigger（Web Security Academy / Burp / DOM Invader）

PortSwiggerのページはオープンソース公開されておらず、環境から直接取得できなかった。内容はGitHub上の逐語ミラーやWebSearchの引用断片で再構成している。**PortSwiggerは無料アカウントでラボを実際に解けるのが最大の価値なので、必ず自分で開くこと。**

- **DOM-based vulnerabilities（source/sink一覧の本家）** — `https://portswigger.net/web-security/dom-based`
  - 読みどころ: source/sinkの定義原文、各DOMベース脆弱性カテゴリ（16種）の完全なsink一覧、各ラボ。付録Bはこのページのミラーから作った。
- **What is CORS?** — `https://portswigger.net/web-security/cors`
  - 読みどころ: CORS設定ミスのラボ群（Origin反射、null origin、信頼できるサブドメイン経由）を実際に解く。
- **Clickjacking** — `https://portswigger.net/web-security/clickjacking`
  - 読みどころ: frame busting回避、prefilled form、multistepのPoC HTMLテンプレートとラボ。
- **WebSockets** — `https://portswigger.net/web-security/websockets`
  - 読みどころ: CSWSH（cross-site WebSocket hijacking）の原理とラボ。
- **Burp Suite documentation**（getting-started / Proxy / Repeater / Intruder / DOM Invader） — `https://portswigger.net/burp/documentation/desktop/...`
  - 読みどころ: 実際のUIスクリーンショット付き手順。DOM Invaderの有効化、canary設定、Augmented DOMの読み方、prototype pollution検出は、手を動かしながら公式手順で確認するのが最短。
- **Introducing DOM Invader（PortSwigger Blog, Gareth Heyes, 2021-06-30）** — `https://portswigger.net/blog/introducing-dom-invader`
  - 読みどころ: DOM Invader誕生の背景、"find DOM XSS as if it were reflected XSS" の設計思想、開発者自身がPayPalのDOM XSSを見つけた実例。

### 第3章 ― JavaScript for hackers（Gareth Heyes）

- **『JavaScript for hackers』（Leanpub）** — `https://leanpub.com/javascriptforhackers`
  - なぜ: 有料書籍。本教科書は目次・二次情報での紹介にとどまる。
  - 読みどころ: JSの短縮記法、コメント/正規表現を使った難読化、DOM clobbering、mutation XSS、prototype pollutionのgadget、CSPバイパスに使えるJS技法。攻撃者目線のJS読解の実践。
- **Gareth Heyes 個人サイト** — `https://garethheyes.co.uk/`
  - 読みどころ: 上記書籍の元になった研究記事群。無料で読めるものが多い。

### 第4章 ― 難読化解除・source map・recon（個人ブログ／Medium）

- **自作deobfuscatorを書く（HackMag）** — `https://hackmag.com/coding/js-deobfuscation`
  - なぜ: 完全に遮断（アーカイブも不可）。本教科書は一次リポジトリ（webcrack, restringer等）で内容を補完しているが、**この記事固有のサンプルと逐語コードは取得できていない**。
  - 読みどころ: (1)記事固有の難読化サンプルと逆変換手順、(2)@babel/parser・traverse・generatorで作る自作deobfuscatorの完全ソース、(3)文字列デコーダの抽出・部分評価の実装、(4)制御フロー平坦化の復元コード。
  - 代替: `steakenthusiast.github.io` の「Deobfuscating Javascript via AST」連載、`trickster.dev` のBabel記事群、`github.com/j4k0xb/webcrack` と `github.com/PerimeterX/restringer` のtransforms。
- **SPA source code recovery by un-Webpacking source maps（rarecoil, Medium）** — `https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d`
  - 読みどころ: source mapからwebpackのソースツリーを復元する実践手順。unwebpack-sourcemapの使い方。
- **Abusing Exposed Sourcemaps（Sentry Blog）** — `https://blog.sentry.security/abusing-exposed-sourcemaps/`
  - 読みどころ: 公開source mapから何が漏れるかの実例、検出手法、報告時の扱い。
- **Source Map Exposure解説（Raijuna）** — `https://www.raijuna.com/knowledge/source-map-exposure`
- **sourcemapper（deepwiki版の解説）** — `https://deepwiki.com/denandz/sourcemapper`
  - 代替: 実体は `github.com/denandz/sourcemapper` のREADME（取得済み）。
- **de4js（オンラインdeobfuscator本体）** — `https://lelinhtinh.github.io/de4js/`
  - なぜ: インタラクティブUIは遮断。機能・対応形式はREADMEから取得済み。
  - 読みどころ: 左ペインに難読化コードを貼り、アンパッカー種別（Eval/Array/Packer/Obfuscator.IO/JSFuck等）を総当たりで試す。
- **難読化解除ツール総覧（0xdevalias gist）** — `https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581`
  - 読みどころ: 継続更新される最新ツール推奨、著者本人のLLM実プロンプト。
- **JS recon実践（OSINT Team / samael0x4, Medium）** — `https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e`、`https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6`
  - 読みどころ: JS収集→解析のワンライナー群、grep正規表現、差分監視の組み方。
- **awesome-bugbounty-tools（GitHub）** — `https://github.com/vavkamil/awesome-bugbounty-tools`
  - 代替: READMEは `raw.githubusercontent.com/vavkamil/awesome-bugbounty-tools/main/README.md` で取得済み。最新版の確認に。

### 第5章 ― DevTools実践（個人ブログ／ベンダー）

- **Chrome DevTools JS Debugging Complete Guide 2026（DevPlaybook）** — `https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/`
  - 読みどころ: source map読み込み設定、Local Overridesの具体手順、minifiedコードのpretty print。
- **How to Debug JavaScript in Chrome（BrowserStack）** — `https://www.browserstack.com/guide/how-to-debug-js-in-chrome`

### 第7章 ― postMessage / 攻撃面（ベンダー・個人ブログ・スライド・動画）

- **An Introduction to postMessage Vulnerabilities（YesWeHack）** — `https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities`
- **Exploiting PostMessage Vulnerabilities（Intigriti）** — `https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities`
  - 読みどころ: ハンドラの見つけ方、検証不備の典型コード、exploit HTMLの書き方、実際のバグバウンティ事例、レポートの書き方。
- **PostMessage Vulnerabilities Part I / II（Jorge Lajara）** — `https://jlajara.gitlab.io/Dom_XSS_PostMessage`（Part II: `.../Dom_XSS_PostMessage_2`）
  - 読みどころ: 脆弱コード例とexploitコード、ブラウザ挙動の注意点。
- **Attacking "Modern" Web Technologies（Frans Rosén, OWASP AppSecEU 2018）** — スライド `https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies`、動画 `https://www.youtube.com/watch?v=vRqcUS4CPFs`
  - なぜ: スライドは画像、動画はYouTube（ともに遮断）。
  - 読みどころ: postMessage、Service Worker、クラウド設定ミス、client-side storage、WebSocketの実戦事例（Slack, Zendesk等）。「概念より、実際の報告に至る思考プロセス」を学ぶために観る。
- **My JavaScript Recon Process（gist pikpikcu）** — `https://gist.github.com/pikpikcu/b034a7e3b8bf966a6eba95acb1fbfe08`
- **Comprehensive Recon Guide（chs.us）** — `https://chs.us/guides/recon/`
  - 読みどころ: サブドメイン列挙〜JS解析〜通知までの総合reconの構成。

### 第8章 ― SOP/CORS補足

- **SOP/CORS総合解説（Emrebener, Medium）** — `https://emrebener.medium.com/a-comprehensive-guide-to-the-same-origin-policy-and-the-cors-policy-4ca7535b0145`
  - 読みどころ: SOPとCORSの図解つき総合解説。第2章の補強に。
- **Secure/HttpOnly/SameSite解説（swlh, Medium）** — `https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6`

### 第9章 ― 日本語資料（CodeZine / gihyo / Qiita / GMO / docswell）

日本語の良質資料はいずれも遮断されていた。本教科書は検索結果の引用断片と、著者が公開したハンズオン用GitHubリポジトリで内容を補っている。**日本語で腰を据えて学ぶなら、これらは必ず自分で開くこと。**

- **『フロントエンド開発のためのセキュリティ入門』抜粋（CodeZine）** — `https://codezine.jp/article/detail/17342`
  - 読みどころ: XSSの3分類、DOM-based XSSのsource/sink、対策（textContent/DOMPurify/URLスキーム検証/CSP/Trusted Types）。書籍本体（翔泳社、ISBN 978-4-7981-6947-7）の購入も推奨。
  - 代替: 著者のハンズオンコード `github.com/shisama/security-handson`（取得済み）。
- **DOM based XSSの検出方法を理解する（GMO Developers）** — `https://developers.gmo.jp/technology/15402/`
  - 読みどころ: source/sinkの追跡手順、DevToolsでの具体操作、実例コード。
- **JavaScript Security連載 第7回 DOM-based XSS（gihyo.jp, はせがわようすけ）** — `https://gihyo.jp/dev/serial/01/javascript-security/0007`
  - 読みどころ: DOM-based XSSの定義、location.hashやdocument.writeの実例、対策コード。連載の他回も。
- **はせがわようすけ スライド（docswell）** — `https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss`
  - なぜ: スライドは画像でテキスト抽出困難。
  - 読みどころ: XSSの短いトーク。同氏の他スライドも一覧から辿る。
- **DOMベースXSSとは（Qiita, nozomi2025）** — `https://qiita.com/nozomi2025/items/909d552cec761c6412f2`
  - 読みどころ: 日本語でのsource/sink解説、サンプルコード、対策。

### 第10章 ― 動画チャンネル（YouTube）

YouTubeは環境から取得できなかった。本教科書は、チャンネル所有者本人がGitHubで公開している動画メタデータ・トランスクリプトで内容を補っているが、**映像・アニメーションそのものは観る価値があるので、必ず自分で開くこと。**

- **LiveOverflow** — `https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w`
  - 読みどころ: `web 0x00`〜`web 0x05`（HTML/CSS/JS入門〜Same-Origin Policy）、AngularJSサンドボックス脱出XSS、DOM Clobbering、Script Gadgets、Google CTF Web、`browser 0x00`〜（ブラウザエンジンexploit）。「答えより思考プロセス」を学ぶ。
  - 代替: `github.com/LiveOverflow/yt_statistics`（全動画のトランスクリプト同梱）。
- **PwnFunction** — `https://www.youtube.com/c/PwnFunction/videos`
  - 読みどころ: アニメーションでWeb脆弱性クラス（Open Redirect / HPP / IDOR / XXE / CSRF / XSS / SSTI / Insecure Deserialization / Electron RCE）を短く解説。初学者のクラス学習に最適。
  - 代替: DOM XSSゲーム `xss.pwnfunction.com`（Warmups 8問＋Challenges 6問。実際のsink・フィルタ・DOM Clobberingを手を動かして学べる）。

---

## この付録のまとめ

- 本教科書は多くのサイトが遮断された環境で作られたため、資料を「内容取得済み（グループ1）」と「二次情報ベース（グループ2）」に分けた。
- グループ1（Chrome/web.dev/MDN/OWASP/HackTricz等）は内容を信頼してよいが、図・アニメーション・最新版は公式ページで。
- グループ2（PortSwigger全般、Medium、日本語記事、書籍、スライド、YouTube、個人ブログ）は**本教科書の記述が要約にとどまるので、必ず自分で原典を開いて読むこと**。特にPortSwiggerのラボと日本語書籍・記事は、手を動かす・腰を据えて読む価値が高い。

<!-- sources: roadmap本体, textbook/_research-notes/00-retrieval-map.md, 各ノートの取得状況表 -->
<!-- terms: egressプロキシ, 一次情報, 二次情報, ミラー -->
