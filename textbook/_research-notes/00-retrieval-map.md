# 取得経路マップ（このセッションで実測・検証済み / 2026-09-18）

## この環境のネットワーク実態（実測）
- **egressプロキシがほぼ全ドメインを遮断**している。WebFetch は `EGRESS_BLOCKED`、curl は `CONNECT tunnel failed, response 403`（curl終了コード上は `000`）。
- **到達可能（200を実測）**:
  - `https://raw.githubusercontent.com/...`（公開リポジトリの生ファイル）
  - `https://gist.github.com/...`
  - `git clone https://github.com/<owner>/<repo>`（HTTPS経由のgitは通る。`--depth 1` 推奨）
  - `WebSearch` ツール（Anthropic側で検索・本文抽出するため、遮断ドメインの内容も**引用断片として**取れる）
- **到達不可（403を実測）**: `github.com` のHTMLページ、`api.github.com`、`web.archive.org`、`developer.chrome.com`、`web.dev`、`portswigger.net`、`cheatsheetseries.owasp.org`、`hacktricks.wiki`、`book.hacktricks.xyz`、`developer.mozilla.org`、`javascript.info`、`eloquentjavascript.net`、`browser.engineering`、`medium.com` 系、`gihyo.jp`、`qiita.com`、`codezine.jp`、`developers.gmo.jp`、`docswell.com`、`leanpub.com`、`garethheyes.co.uk`、`hackmag.com`、`deepwiki.com`、`chromium.googlesource.com`、`www.chromium.org`、`speakerdeck.com`、`youtube.com`、その他個人ブログ全般。

## 原典がGitHubで取れる資料（**パス実測済み・200確認**）
| 元URL | GitHub raw パス（`https://raw.githubusercontent.com/` に続く） |
| --- | --- |
| developer.chrome.com/blog/inside-browser-part1〜4 | `GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part{1,2,3,4}/index.md` |
| developer.chrome.com/blog/site-isolation | `GoogleChrome/developer.chrome.com/main/site/en/blog/site-isolation/index.md` |
| developer.chrome.com/blog/meltdown-spectre | `GoogleChrome/developer.chrome.com/main/site/en/blog/meltdown-spectre/index.md` |
| developer.chrome.com/docs/devtools/javascript | `GoogleChrome/developer.chrome.com/main/site/en/docs/devtools/javascript/index.md` |
| 同 /javascript/reference | `GoogleChrome/developer.chrome.com/main/site/en/docs/devtools/javascript/reference/index.md` |
| 同 /javascript/breakpoints | `GoogleChrome/developer.chrome.com/main/site/en/docs/devtools/javascript/breakpoints/index.md` |
| （関連）DevTools Overrides | `GoogleChrome/developer.chrome.com/main/site/en/docs/devtools/overrides/index.md` |
| （関連）Console utilities | `GoogleChrome/developer.chrome.com/main/site/en/docs/devtools/console/utilities/index.md` |
| web.dev/articles/csp | `GoogleChrome/web.dev/main/src/site/content/en/blog/csp/index.md` |
| web.dev/articles/samesite-cookies-explained | `GoogleChrome/web.dev/main/src/site/content/en/blog/samesite-cookies-explained/index.md` |
| html5rocks How Browsers Work（= web.dev/articles/howbrowserswork） | `GoogleChrome/web.dev/main/src/site/content/en/blog/howbrowserswork/index.md` |
| MDN JavaScript Guide | `mdn/content/main/files/en-us/web/javascript/guide/index.md`（配下の各章も同ツリー） |
| MDN WebAssembly WAT | `mdn/content/main/files/en-us/webassembly/guides/understanding_the_text_format/index.md` |
| OWASP CSP Cheat Sheet | `OWASP/CheatSheetSeries/master/cheatsheets/Content_Security_Policy_Cheat_Sheet.md` |
| OWASP HTML5 Cheat Sheet | `OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md` |
| OWASP HTTP Headers Cheat Sheet | `OWASP/CheatSheetSeries/master/cheatsheets/HTTP_Headers_Cheat_Sheet.md` |
| OWASP Clickjacking Defense Cheat Sheet | `OWASP/CheatSheetSeries/master/cheatsheets/Clickjacking_Defense_Cheat_Sheet.md` |
| OWASP Browser Extension Vulnerabilities Cheat Sheet | `OWASP/CheatSheetSeries/master/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.md` |
| HackTricks CSP bypass | `HackTricks-wiki/hacktricks/master/src/pentesting-web/content-security-policy-csp-bypass/README.md` |
| HackTricks postMessage vulnerabilities | `HackTricks-wiki/hacktricks/master/src/pentesting-web/postmessage-vulnerabilities/README.md` |
| HackTricks browser extension methodology | `HackTricks-wiki/hacktricks/master/src/pentesting-web/browser-extension-pentesting-methodology/README.md` |
| HackTricks abusing service workers | `HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/abusing-service-workers.md` |
| （関連）HackTricks DOM Invader | `HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/dom-invader.md` |
| Chromium Service Worker Security FAQ | `chromium/chromium/main/docs/security/service-worker-security-faq.md` |
| Eloquent JavaScript（各章） | `marijnh/Eloquent-JavaScript/master/01_values.md` など連番 `NN_*.md` |
| browser.engineering（各章） | `browserengineering/book/main/book/*.md`（例 `http.md`） |
| javascript.info（各記事） | `javascript-tutorial/en.javascript.info/master/<番号ディレクトリ>/.../article.md` |
| webcrack ドキュメント | `j4k0xb/webcrack/HEAD/apps/docs/src/concepts/deobfuscate.md`（他 `unpack.md` `unminify.md` `jsx.md` `transpile.md`、`apps/docs/src/guide/{cli,api,introduction,web,common-errors}.md`） |
| de4js | `lelinhtinh/de4js/master/README.md` |
| sourcemapper（deepwikiの実体） | `denandz/sourcemapper/master/README.md` |
| LinkFinder | `GerbenJavado/LinkFinder/master/README.md` |
| SecretFinder | `m4ll0k/SecretFinder/master/README.md` |
| awesome-bugbounty-tools | `vavkamil/awesome-bugbounty-tools/main/README.md` |
| postMessage-tracker | `fransr/postMessage-tracker/master/README.md`（+ `chrome/` 配下のソース一式） |
| WABT | `WebAssembly/wabt/main/README.md` |
| CSP Bypass Techniques | `bhaveshk90/Content-Security-Policy-CSP-Bypass-Techniques/main/README.md` |

## パスが不明なときの探し方（実測で有効）
```bash
# ツリーだけ落とす（軽量）。blobは必要なものだけ後で取る
git clone --depth 1 --filter=blob:none https://github.com/<owner>/<repo> /tmp/r
find /tmp/r -name '*.md' | grep -i <キーワード>
# 通常の浅いクローン（小さいリポジトリなら十分速い。webcrackは2.6MB）
git clone --depth 1 https://github.com/<owner>/<repo> /tmp/r
```

## GitHubに原典が無い（＝読者自身がアクセスすべき）資料
- PortSwigger 全ページ（Web Security Academy、Burp Suite ドキュメント、Blog、DOM Invader ドキュメント）… オープンソース公開されていない。WebSearch の引用断片で内容を再構成するしかない。
- Medium 系（rarecoil / emrebener / swlh / samael0x4 / osintteam）
- 日本語記事（CodeZine、gihyo.jp、Qiita、GMO Developers、docswell スライド）
- 書籍・商用ページ（Leanpub『JavaScript for hackers』、翔泳社の書籍ページ）
- 個人ブログ（garethheyes.co.uk、hackmag.com、jlajara.gitlab.io、blog.sentry.security、raijuna.com、devplaybook.cc、chs.us）
- ベンダーブログ（BrowserStack、YesWeHack、Intigriti）
- スライド/動画（SpeakerDeck、YouTube）
- www.chromium.org（Site Isolation ページ。ただし内容の大半は developer.chrome.com/blog/site-isolation と Chromium の docs/ で代替可能）

→ これらは教科書内の該当箇所に「📌 ここは自分で開いて読んでください」ブロックを置き、読みどころを示すこと。
