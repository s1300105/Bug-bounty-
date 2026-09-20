# クライアントサイド脆弱性ハンティングの「基盤技術」習得ロードマップ

## TL;DR

- クライアントサイド脆弱性を見つける力の核は、個別の穴（XSS/CSRF等）の知識ではなく「ブラウザの動作原理・セキュリティモデルの理解」「JavaScript深読解」「minify/難読化/bundle/source mapの解析」「DevToolsとBurp DOM Invaderによるsource→sinkデータフロー追跡」という4つの土台にある。本ロードマップはこれをLv1〜Lv8に段階化し、各段階に実在確認済みの2次資料URLを多数掲載した。
- 最も投資すべきはLv4（JSリバースエンジニアリング）とLv5〜Lv6（DevTools／Burp DOM Invader）。ここは自動ツールやAIが最も苦手とする「手を動かす実力」であり、非自明な脆弱性発見の差がつく領域。
- 学習は「読む→ラボで手を動かす→実際のJSバンドルで再現」のループで進めること。PortSwigger Web Security AcademyのラボとBurp DOM Invaderを軸に据えるのが最短経路。

## Key Findings

- **土台の4本柱**：(1)ブラウザ内部（プロセスモデル/レンダリング/DOM構築/イベントループ）、(2)ブラウザセキュリティモデル（SOP/CORS/CSP/Cookie/postMessage/Site Isolation）、(3)JS深読解、(4)クライアントサイドコード解析（deobfuscation/source map復元/データフロー追跡）。
- **2次資料は非常に充実している**：web.dev/developer.chrome.comのMariko Kosaka（Googleエンジニア）による「Inside look at modern web browser」全4部（2018年9月にdevelopers.google.com/webで初公開）、PortSwigger（DOM Invader、DOM-based、CORS等）、HackTricks、OWASP Cheat Sheet、Gareth Heyes『JavaScript for hackers』などが揃う。
- **日本語の良質資料もある**：はせがわようすけ監修『フロントエンド開発のためのセキュリティ入門』（翔泳社、2023年2月13日発行、著者：平野昌士）、GMOイエラエ系ブログ、gihyo.jpのDOM-based XSS連載、docswellのはせがわ氏スライド群。
- **手を動かす中核技術**：webcrack（obfuscator.io/webpack解体）、de4js、sourcemapper/unwebpack、LinkFinder/SecretFinder/jsluice（JS recon）、Burp DOM Invader（canaryによるsource→sink自動追跡）、fransr/postMessage-tracker。

---

## Details（段階別ロードマップ）

### Lv1. ブラウザの動作原理とWebプラットフォームの基礎

**なぜ必要か**：DOM-based XSS、DOM clobbering、mutation XSS、レースコンディションなどは「ブラウザがHTMLをどうパースし、DOMをどう構築し、JSをいつ実行するか」を知らないと発見も再現もできない。レンダリングパイプラインとイベントループの理解が、ブレークポイントを置く場所とタイミングの直感を作る。

**習得できること**：プロセスモデル、レンダリング（parse→style→layout→paint→composite）、HTMLパーサとDOM/CSSOM構築、JSエンジン（V8）とイベントループの関係。

**資料**：

- Inside look at modern web browser（Mariko Kosaka／Googleエンジニア、全4部、Chrome for Developers。原文は2018年9月にdevelopers.google.com/webで初公開）: part1 https://developer.chrome.com/blog/inside-browser-part1 / part2 https://developer.chrome.com/blog/inside-browser-part2 / part3 https://developer.chrome.com/blog/inside-browser-part3
- How Browsers Work: Behind the Scenes of Modern Web Browsers（Tali Garsiel & Paul Irish）: https://www.html5rocks.com/tutorials/internals/howbrowserswork/
- Web Browser Engineering（無料オンライン書籍、ブラウザを実装しながら学ぶ）: https://browser.engineering/
- Notes on How Browsers Work（読解ノート、図解つき）: https://codeburst.io/how-browsers-work-6350a4234634

### Lv2. ブラウザのセキュリティモデル（脆弱性検証の前提知識）

**なぜ必要か**：クライアントサイド脆弱性の多くは「オリジンをまたぐ境界」で起きる。SOP/CORS/CSP/Cookie/postMessageの正しい挙動を知らないと、設定ミス（CORSの動的Origin反射、CSPのbypass可能な構成、SameSiteの緩さ）を「異常」として認識できない。

**習得できること**：Origin概念、SOPの制約、CORSヘッダ交換とpreflight、Cookie属性（SameSite/HttpOnly/Secure/__Host-）、CSPディレクティブとstrict CSP、clickjacking前提（X-Frame-Options/frame-ancestors）、postMessageのorigin検証、Site Isolation/Spectre緩和。

**資料**：

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

### Lv3. JavaScriptの深い理解と読解スキル

**なぜ必要か**：クライアントサイド解析の中核は「他人が書いた（しかも変形された）JSを読み切る力」。クロージャ、プロトタイプチェーン、this、Promise/asyncを理解していないと、prototype pollutionのgadget探索やイベントリスナの追跡ができない。

**習得できること**：ES6+、クロージャ、プロトタイプ継承、this束縛、非同期（Promise/async・イベントループ）、ブラウザAPI（DOM/Fetch/XHR/WebSocket/Storage/History/location）、そして「攻撃者目線でのJS読解」。

**資料**：

- The Modern JavaScript Tutorial（javascript.info）: https://javascript.info/
- MDN JavaScript Guide: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide
- Eloquent JavaScript（Marijn Haverbeke, 無料オンライン書籍）: https://eloquentjavascript.net/
- 書籍『JavaScript for hackers』（Gareth Heyes／PortSwigger研究者、XSS Cheat Sheet著者・Hackvertor作者。Leanpub版は2022年12月21日公開、独立出版版105ページ、ISBN 9798371872166）: https://leanpub.com/javascriptforhackers
- Gareth Heyes 個人サイト（研究記事）: https://garethheyes.co.uk/

### Lv4. クライアントサイドコードのリバースエンジニアリング／解析技法（★最重要）

**なぜ必要か**：実運用のフロントエンドはminify＋bundle（webpack等）＋時に難読化されている。ここを読み解けるかどうかが、隠れたエンドポイント・シークレット・危険なsinkの発見を左右する。AIや自動ツールが最も苦手とし、手作業の実力が最も効く領域。

**習得できること**：minify/uglify/bundle済みJSの読解、難読化解読（deobfuscation）、source map回収・復元によるソース再構築、webpackモジュール/chunk構造の追跡、JSからのシークレット・エンドポイント抽出（JS recon）、beautifier/AST解析。

**資料（deobfuscation/bundle）**：

- webcrack（obfuscator.io解除・unminify・webpack/browserify展開, GitHub）: https://github.com/j4k0xb/webcrack
- webcrack Deobfuscationドキュメント: https://webcrack.netlify.app/docs/concepts/deobfuscate.html
- de4js（オンラインdeobfuscator/unpacker）: https://lelinhtinh.github.io/de4js/
- Deobfuscating/Unminifying Obfuscated JavaScript ツール集（0xdevalias gist）: https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581
- 自作deobfuscatorを書く（HackMag）: https://hackmag.com/coding/js-deobfuscation

**資料（source map復元）**：

- SPA source code recovery by un-Webpacking source maps（rarecoil, Medium）: https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d
- sourcemapper（Go製, source tree再構築）: https://deepwiki.com/denandz/sourcemapper
- Abusing Exposed Sourcemaps（Sentry Blog, 実例あり）: https://blog.sentry.security/abusing-exposed-sourcemaps/
- Source Map Exposure解説（Raijuna）: https://www.raijuna.com/knowledge/source-map-exposure

**資料（JS recon）**：

- LinkFinder（JSからエンドポイント抽出, GitHub）: https://github.com/GerbenJavado/LinkFinder
- SecretFinder（JSからAPIキー/トークン検出, GitHub）: https://github.com/m4ll0k/SecretFinder
- jsluice等を含むツール総覧（awesome-bugbounty-tools）: https://github.com/vavkamil/awesome-bugbounty-tools
- JavaScript recon実践（OSINT Team, Medium）: https://osintteam.blog/automate-javascript-js-extraction-for-bug-bounty-recon-6faab744d22e
- 高度なJS内データ漏洩ハンティング（Medium）: https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6

### Lv5. ブラウザDevToolsの徹底活用（★重点）

**なぜ必要か**：DevToolsは動的解析の主戦場。ブレークポイントでJSを止め、call stack/scope/watchでデータの出所と行き先を追う技術が、source→sinkの手動追跡そのもの。DOM/XHR/event listener breakpoint、conditional breakpoint、local overridesを使いこなすと変形済みコードでも挙動を把握できる。

**習得できること**：Sourcesパネルのデバッグ、各種ブレークポイント（line/conditional/DOM/XHR/event listener/CSP violation）、Network/Console/Application（Storage/Cookie/Service Worker）/Performance/Memory、ステップ実行でのデータフロー追跡、ライブ編集/snippet/local overrides、call stack/scope/watchの読み方。

**資料**：

- Debug JavaScript（Chrome DevTools入門）: https://developer.chrome.com/docs/devtools/javascript
- JavaScript debugging reference（Chrome DevTools）: https://developer.chrome.com/docs/devtools/javascript/reference
- Pause your code with breakpoints（Chrome DevTools）: https://developer.chrome.com/docs/devtools/javascript/breakpoints
- Chrome DevTools JavaScript Debugging Complete Guide 2026（DevPlaybook, source map/local overrides含む）: https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/
- How to Debug JavaScript in Chrome（BrowserStack）: https://www.browserstack.com/guide/how-to-debug-js-in-chrome

### Lv6. プロキシと専用ツールによる動的解析（★重点）

**なぜ必要か**：Burp Suiteはトラフィック観察・改変の中心。特にDOM Invaderはcanary文字列を注入してsource→sinkのデータフローを自動追跡する。PortSwigger公式の説明では、DOM InvaderはターゲットのDOMをinstrumentしてJavaScriptのsource/sinkを傍受し、"The Augmented DOM allows you to find DOM XSS as if it were reflected XSS."（反射型XSSのようにDOM XSSを可視化する）。数千行のminifiedコードでもsinkと文脈を即座に把握でき、DOM XSS、web message（postMessage）、prototype pollutionの検出を劇的に効率化する。DOM InvaderはGareth Heyesにより2021年6月30日に発表され（初出はBurp Suite 2021.7 Early Adopter channel、Burp Suite Professional/Community Edition両対応）、client-side prototype pollution検出機能は2022年6月20日の更新で追加された。

**習得できること**：Burp Proxy/Repeater/Intruderの使い方、DOM Invaderによるcanary追跡・web messageの改変再送・prototype pollution検出、client-sideデータフロー（source/sink）方法論。

**資料**：

- Burp Suite getting started（公式）: https://portswigger.net/burp/documentation/desktop/getting-started
- Burp Proxy（公式）: https://portswigger.net/burp/documentation/desktop/tools/proxy
- Burp Repeater（公式）: https://portswigger.net/burp/documentation/desktop/tools/repeater
- Burp Intruder（公式）: https://portswigger.net/burp/documentation/desktop/tools/intruder
- DOM Invader（公式ドキュメント）: https://portswigger.net/burp/documentation/desktop/tools/dom-invader
- Introducing DOM Invader（PortSwigger Blog, Gareth Heyes, 2021-06-30）: https://portswigger.net/blog/introducing-dom-invader
- Testing for DOM XSS（DOM Invader）: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
- Testing for DOM XSS using web messages（DOM Invader）: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages
- postMessage-tracker（Frans Rosén, Chrome拡張）: https://github.com/fransr/postMessage-tracker

### Lv7. クライアントサイドの攻撃面マッピングと方法論

**なぜ必要か**：土台技術を「どこに向けるか」を決めるのが方法論。信頼できない入力の経路（URL/fragment/postMessage/WebSocket/localStorage等）とsink一覧を体系化し、ブレークポイントの置き所とトリアージ手順を持つことで、再現性のあるハントができる。

**習得できること**：DOM-based脆弱性のsource/sink体系、攻撃面の洗い出し、client-side recon（JS収集・エンドポイント抽出・履歴/差分監視）、postMessageハンドラの列挙と検証ロジックのバイパス発見。

**資料**：

- DOM-based vulnerabilities（PortSwigger, sources/sink一覧）: https://portswigger.net/web-security/dom-based
- PostMessage Vulnerabilities（HackTricks）: https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html
- An Introduction to postMessage Vulnerabilities（YesWeHack）: https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
- Exploiting PostMessage Vulnerabilities（Intigriti）: https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities
- PostMessage Vulnerabilities Part I（Jorge Lajara）: https://jlajara.gitlab.io/Dom_XSS_PostMessage
- Attacking "Modern" Web Technologies（Frans Rosén, OWASP AppSecEU 2018スライド）: https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies
- 動画版（YouTube）: https://www.youtube.com/watch?v=vRqcUS4CPFs
- My JavaScript Recon Process（gist）: https://gist.github.com/pikpikcu/b034a7e3b8bf966a6eba95acb1fbfe08
- Comprehensive Recon Guide: https://chs.us/guides/recon/

### Lv8. 発展的なクライアントサイド技術領域（攻撃面として）

**なぜ必要か**：モダンWebの攻撃面はService Worker、WebSocket、iframe連鎖、client-side storage、WASM、ブラウザ拡張へと広がっている。これらは基盤技術の応用先であり、非自明な脆弱性の宝庫。

**習得できること**：Service Worker/Web Worker/Cache API、WebSocket/SSE、iframe/postMessage連鎖・window.opener・reverse tabnabbing、localStorage/sessionStorage/IndexedDB、WASM解析の入口、ブラウザ拡張（content script/isolated world/web_accessible_resources）。

**資料**：

- Abusing Service Workers（HackTricks）: https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers
- Service Worker Security FAQ（Chromium公式）: https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md
- WebSockets（PortSwigger）: https://portswigger.net/web-security/websockets
- Clickjacking（PortSwigger）: https://portswigger.net/web-security/clickjacking
- Browser Extension Pentesting Methodology（HackTricks）: https://hacktricks.wiki/en/pentesting-web/browser-extension-pentesting-methodology/index.html
- OWASP Browser Extension Vulnerabilities Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html
- Understanding the text format (WAT)（MDN, WASM解析の基礎）: https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format
- WABT: The WebAssembly Binary Toolkit（wat2wasm/wasm2wat等, GitHub）: https://github.com/WebAssembly/wabt

### 日本語の優良資料（横断）

- 書籍『フロントエンド開発のためのセキュリティ入門』（著者：平野昌士／サイボウズ、監修：はせがわようすけ・後藤つぐみ／セキュアスカイ・テクノロジー。翔泳社、2023年2月13日発行、ISBN 9784798169477）抜粋記事: https://codezine.jp/article/detail/17342
- DOM based XSSの検出方法を理解する（GMO Developers）: https://developers.gmo.jp/technology/15402/
- JavaScript Security連載 第7回 DOM-based XSS（gihyo.jp, はせがわようすけ）: https://gihyo.jp/dev/serial/01/javascript-security/0007
- はせがわようすけ スライド一覧（docswell）: https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss
- DOMベースXSSとは（Qiita, source/sink解説）: https://qiita.com/nozomi2025/items/909d552cec761c6412f2

### 動画・チャンネル（横断）

- LiveOverflow（YouTube）: https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w
- PwnFunction（YouTube）: https://www.youtube.com/c/PwnFunction/videos

---

## Recommendations（段階的な進め方）

**ステージ1（2〜3週間）: 土台の地図を作る**
Lv1とLv2を通読。Mariko Kosakaの4部作とHow Browsers Workで「ブラウザが何をしているか」の全体像を掴み、SOP/CORS/CSP/Cookie/postMessageの挙動をOWASP Cheat SheetとPortSwiggerで確認。ゴール：DevToolsのNetwork/Applicationで、あるサイトのCORSヘッダ・Cookie属性・CSPを読んで「この設定は緩い/厳しい」を言語化できること。

**ステージ2（3〜4週間）: JS読解とDevToolsを鍛える**
Lv3で言語仕様を固めつつ、Lv5のDevToolsデバッグを毎日実践。実在サイトのJSにブレークポイントを置き、call stack/scopeでデータの出所を追う訓練を反復。ゴール：conditional breakpointとevent listener breakpointを使い、あるDOM更新の原因コードを5分以内に特定できること。

**ステージ3（4週間〜, 最重要）: リバースエンジニアリング＋DOM Invader**
Lv4とLv6を並行。webcrack/de4jsでbundleを解体、sourcemapperでsource map復元、LinkFinder/SecretFinderでエンドポイント/シークレット抽出を手癖にする。同時にBurp DOM Invaderでcanaryを流しsource→sinkを追う。ゴール：任意のSPAのJSバンドルから、隠れAPIエンドポイントと危険なsinkを列挙し、DOM Invaderで実際にsourceからsinkへ到達するデータフローを1本再現できること。

**ステージ4（継続）: 攻撃面マッピングと発展領域**
Lv7の方法論で自分のチェックリスト（source一覧×sink一覧×置くべきbreakpoint）を作り、Lv8のService Worker/WebSocket/拡張/WASMへ拡張。実ターゲット（バグバウンティ）に適用し、JSの差分監視を定常化する。

**判断の閾値（次に進む/戻るの基準）**

- Lv4のラボやbundleで「読めない/追えない」箇所が半分以上ならLv3のJS基礎に戻る。
- DOM Invaderが自動検出したsinkの意味を説明できないならLv2（sink＝なぜ危険か）とLv5（手動追跡）を補強。
- recon自動ツールの出力を鵜呑みにして誤検知を選別できないなら、Lv4の手動解析比率を上げる。

## Caveats

- **1次資料の最小限混在**：MDN（JavaScript Guide、WASM text format）は仕様寄りだが、要点確認用の補助として最小限含めた。PortSwigger/OWASPの各ページは解説とラボを備えた実質2次資料として扱っている。
- **ツールの陳腐化リスク**：deobfuscation/source map/recon系ツール（webcrack, de4js, sourcemapper, LinkFinder, SecretFinder, jsluice等）はメンテ状況が変わりやすい。GitHubのstar数・最終コミット・Issueを都度確認すること。特にLinkFinder等の古いツールはPython環境依存で動かない場合がある。
- **法的・倫理的境界**：source map復元やJS reconは「公開されているクライアントサイド資産の解析」に留め、対象のバグバウンティ規約/スコープを厳守すること。無許可のアクティブスキャンは避ける。
- **一部URLはコミュニティ発の2次資料**：Medium/gist/個人ブログ（rarecoil, HackMag, DevPlaybook, 各種Medium記事）は品質が高いものを選んだが、著者の主張や手順は最新のブラウザ挙動と食い違う可能性があるため、PortSwigger/Chrome公式で裏取りすること。
- **HackTricksのURL移行**：HackTricksはドメイン移行（book.hacktricks.xyz → hacktricks.wiki）が進行中で、一部リンクはミラー/リダイレクトになる場合がある。
- **書籍**：『The Tangled Web』（Michal Zalewski）、『The Web Application Hacker's Handbook』、『Web Application Security』（Andrew Hoffman）は古典/定番として推奨に値するが、本レポートでは公式販売ページのURL確認を優先度から外した。購入時はNo Starch Press/O'Reilly/Wiley等の正規販売元を確認すること。