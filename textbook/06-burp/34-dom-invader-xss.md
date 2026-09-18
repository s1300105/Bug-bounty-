# DOM Invader — DOM XSS を「反射型 XSS のように」見つける Burp 内蔵ツール

> **この節で分かること**
> - DOM Invader がなぜ生まれ、DOM XSS のハンティングをどう楽にするのかを、設計思想から説明できる。
> - Burp の内蔵ブラウザで DOM Invader を有効化し、カナリア（canary）を注入して DOM ビューでシンクを特定する標準手順を自分で実行できる。
> - シンクのランキング（`sinkRanking`）と 3 分類（`jsSinks` / `htmlSinks` / `urlSinks`）を使って、次に打つべきペイロードの形を判断できる。
> - `Outer HTML` / `Frame path` / `Event` の 3 列と follow-up 文字を使って、XSS のコンテキスト（文脈）を実測できる。
> - web message（postMessage）・クライアントサイド prototype pollution・DOM clobbering の各機能と、それぞれの false positive / false negative の罠を説明できる。
> - AutoVader による自動化と、DOM Invader の設定項目の全体像を把握できる。

**元資料**:
- https://portswigger.net/blog/introducing-dom-invader （原典取得済み。`portswigger.net` は執筆環境のプロキシで遮断されていたため、ブログを丸ごと保存した第三者リポジトリのスクレイプ HTML から本文全文を逐語取得した。`<title>` の一致で同一性を確認済み）
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss （原典取得済み。Burp 製品に同梱されるオフライン版ドキュメントのミラー〔英語・公式日本語版の両方〕からパス構造一致を確認して逐語取得した）

**関連する節**: 反射型 XSS / DOM XSS の基礎、Burp 内蔵ブラウザと Proxy の使い方、クライアントサイド prototype pollution の詳細

---

## 1. DOM Invader とは何か — なぜ「DOM XSS 専用ツール」が要るのか

### DOM XSS が「群を抜いて難しい」という問題設定

DOM XSS（DOM-based Cross-Site Scripting）とは、サーバではなく**ブラウザ内で動く JavaScript が、攻撃者の制御下にあるデータを危険な関数に渡してしまう**ことで起きるクロスサイトスクリプティングのこと。反射型・格納型と違って、悪意あるコードがサーバの応答 HTML に現れないことが多く、ブラウザの中で完結する。

原典ブログの冒頭は、この難しさを次のように述べている（逐語）。

> **Of the three main types of XSS, DOM-based XSS is by far the most difficult to find and exploit.**

つまり XSS の主要 3 分類（反射型・格納型・DOM ベース）のうち、**DOM ベースは発見も悪用も群を抜いて難しい**。理由もブログが明言している。

> Most modern sites use multiple JavaScript libraries - and have many lines of complex, minified code. **This makes testing for DOM XSS a real headache.**

現代のサイトは複数の JavaScript ライブラリを使い、minify（縮小化。改行やスペースを削って 1 行に詰めた状態）された何千行ものコードを抱える。攻撃者の入力がその中をどう流れて危険な関数にたどり着くかを人手で追うのは、まさに「頭痛の種」だ。DOM Invader は、この追跡作業を機械にやらせるために PortSwigger Research が専用に開発したツールである。

### 設計思想 —「DOM XSS を反射型 XSS のように探せるようにする」

DOM Invader の中心にある思想は、ブログの次の一文に集約される（逐語）。

> **"The Augmented DOM allows you to find DOM XSS as if it were reflected XSS."**

反射型 XSS とは、URL などに入れた入力が**そのまま応答 HTML に反射（reflect）して表示される**タイプの XSS のこと。入力した文字列がページに出るかどうかを目で見れば済むので発見が容易だ。DOM Invader は、DOM を instrument（計装。プログラムの動きを横から観測できるように仕込むこと）して JavaScript のソースとシンクを横取りし、DevTools の増設タブに**ツリー表示**することで、「入力した文字列がどの危険な関数に届いたか」を反射型と同じ感覚で目視できるようにする。

> Through its Augmented DOM, DOM Invader will provide you with a convenient tree view of all of your target's sources and sinks.

### DOM Invader の正体と対応エディション

公式ドキュメントの定義は次のとおり。

> a browser-based tool that helps you test for DOM XSS vulnerabilities using a variety of sources and sinks, including both web message and prototype pollution vectors. It is available exclusively via Burp's built-in browser, where it comes preinstalled as an extension.

要点を整理する。

| 項目 | 内容 |
| --- | --- |
| 種別 | Burp Suite 内蔵ブラウザ（embedded browser）に**拡張としてプリインストール**された DOM XSS 専用ツール |
| 対応エディション | **Professional / Community の両方**（ドキュメント各ページに `Professional` `Community` ラベルが付く） |
| 初出 | Burp Suite Professional / Community **2021.7**（Early Adopter チャネル） |
| 作者 | PortSwigger Research の **Gareth Heyes** |
| 公開日 | 2021 年 6 月 30 日 16:47 UTC（タグ: XSS / DOM / Hacking Tools） |
| カバー範囲 | DOM XSS、web message（postMessage）、クライアントサイド prototype pollution、DOM clobbering |

ここで大事なのは、**内蔵ブラウザ専用**であること。DOM Invader は Burp に同梱された Chromium ベースのブラウザの中でしか動かない。手元の普通の Chrome には入らない。

### ツールの系譜 — 無から生まれたわけではない

ブログの謝辞（"Team effort" 節）に、設計の系譜が書かれている。

```
Cure53 の Filedescriptor（@filedescriptor）が作った類似ツール
        │  （着想を与える）
        ▼
James Kettle 「拡張として作る」というアイデアを発案
        │  （実装を託す）
        ▼
Gareth Heyes が実装（一時的に PortSwigger の Scanner チームに参加して開発）
```

DOM Invader は、Cure53 の先行ツールに James Kettle が着想を得て「拡張として作ろう」と発案し、それを Gareth Heyes が実装した、という流れで生まれた。「ツールの歴史」を知っておくと、なぜこの UI・この機能なのかが腑に落ちる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Introducing DOM Invader: DOM XSS just got a whole lot easier to find（PortSwigger Blog, Gareth Heyes, 2021-06-30）— https://portswigger.net/blog/introducing-dom-invader
> **なぜ**: 本教科書の執筆環境からは `portswigger.net` への接続がプロキシで遮断され（`CONNECT` に 403）、本文はミラー経由で全文取得できたが**画像・動画は取得できなかった**。以下の UI 記述は本文の逐語と別ソースの突き合わせにもとづく要約である。
> **読みどころ**:
> 1. **スクリーンショット 4 枚** — 「Augmented DOM のツリービュー」「シンクが面白い順に並んだ一覧」「カナリアが自動ハイライトされた様子」。本節の記述と突き合わせ、どの列が `Value` でどこが `Stack Trace` かを目で確認する。
> 2. **冒頭の YouTube 動画**（Academy ラボを DOM Invader で解くデモ）。「カナリアをコピー → URL に貼る → タブを見る」という操作の流れを 1 回見ておくと、以降の手順書の理解が段違いに速い。
> 3. **"research channel" へのリンク（PayPal DOM XSS の詳細）**。本節では「PayPal の DOM XSS を見つけた」という事実までしか取れていない。実際の攻撃経路・シンク・ペイロードは元記事側にある。
> 4. **リリースノートへのリンク**（2021.7 / Early Adopter チャネル）。
> **代替手段**: 本文の逐語は `https://raw.githubusercontent.com/bosterptr/nthwse/HEAD/scraper/raw/2206.html`（スクレイプ HTML）で再取得できる。ただし画像・動画は含まれない。

---

## 2. 有効化と基本 UI — まず DOM Invader を起動する

### 既定は OFF、その理由

DOM Invader は内蔵ブラウザにプリインストールされているが、**既定では無効**になっている。理由がブログに明記されている（逐語）。

> **By default, DOM Invader is turned off (because it alters site behavior).**

DOM Invader は DOM を instrument して挙動を書き換えるため、**サイトの動作を変えてしまう**。だから普段のテストの邪魔にならないよう既定 OFF なのだ。公式ドキュメントも「some of its features may interfere with your other testing activities（一部の機能は他のテスト活動を妨げうる）」と同趣旨を書く。

### 有効化の正式手順（公式 `enabling` ページより）

```text
1. Proxy > Intercept タブを開き、Burp の内蔵ブラウザを起動する。
2. ブラウザウィンドウの右上隅の Burp Suite ロゴをクリックする。
   （ロゴが見えないときは、先にジグソー〔パズルのピース〕アイコンをクリックする。）
   → Burp Suite Navigation Recorder と DOM Invader の設定メニューを含むパネルが開く。
3. DOM Invader の設定でスイッチをトグルして ON にする。
4. Reload をクリックしてブラウザを更新する。これをしないと変更が反映されない。
5. メインのブラウザウィンドウ内を右クリックし Inspect を選んで DevTools を開く。
   → ここに DOM Invader タブが加わっている。
   （パネルは画面下部にドッキングすると使いやすい。）
```

公式は次の注意も添えている（逐語）。

> By default, DOM Invader **remembers your previous settings, including whether it was on or off**.

DOM Invader は**前回の設定（ON / OFF を含む）を記憶する**。内蔵ブラウザを DOM Invader が ON のまま閉じると、次回もその状態で開く。これを無効にしたいときは `Settings > Tools > Burp's browser` で `Store settings and history after closing` のチェックを外す。

### 最重要の落とし穴 —「設定を変えたら必ず Reload」

手順 4 の `Reload` は DOM Invader のほぼ全設定に共通する。公式ドキュメントは canary 変更・postmessage 有効化・prototype pollution 有効化・DOM clobbering 有効化・callback 設定のすべてで次の一文を繰り返している。

> Click **Reload**... This is necessary for your changes to take effect.

**設定を変えたら必ず Reload**。これを忘れた状態のテスト結果は無効だと考えてよい。本節で以後「Reload」と書いたら、この画面更新を指す。

### タブ名は版によって違う（併記して覚える）

DevTools に増設されるタブの名前は、DOM Invader のバージョンによって呼び方が変わっている。混乱しないよう両方を覚えておく。

| 版 | DevTools のタブ名 | ビューの呼び方 |
| --- | --- | --- |
| 2021 年の初期リリース | **`Augmented DOM`** タブ | （タブ全体が Augmented DOM） |
| 現行版 | **`DOM Invader`** タブ | その中の **`DOM` ビュー**（と `Messages` ビュー） |

公式ドキュメントは "the extension's **DOM** view" と書き、公式日本語訳は「**DOM ビュー**」と訳す。ブログの `Augmented DOM` という語も index ページに説明として残っている。本節では原則「DOM ビュー」と呼び、歴史的文脈では「Augmented DOM」と併記する。

〔補足〕公式日本語訳では source を「ソース」、sink を「シンク」、canary を「カナリア」と訳している。UI 上のボタン名・列名（`Copy canary` / `Inject URL params` / `Inject forms` / `Outer HTML` / `Frame path` / `Event` / `Stack Trace` など）は**日本語版でも英語のまま**であることが確認できている。本節もこれに倣う。

---

## 3. カナリア（canary）— DOM Invader の心臓部

### カナリアとは何か

カナリア（canary）とは、公式定義によれば次のものである（逐語）。

> an arbitrary but distinct string of alphanumeric characters that you can inject into different sources to see which sinks they flow into

すなわち**任意だが他と区別できる英数字の文字列**で、これをさまざまなソースに注入し、その文字列がどのシンクへ流れ込むかを見るための「目印」だ。炭鉱のカナリア（危険を知らせる目印の鳥）から来た命名で、DOM のどこにこの文字列が現れたかを DOM Invader が自動で追跡してくれる。

ブログ版の定義も同じ趣旨。

> **A canary is a unique string that's used to see where your user input is reflected inside a sink.**

### 既定はランダム生成（`burpdomxss` ではない）

カナリアの既定値について、原典は一貫して次のように述べる。

> **By default, DOM Invader uses a random canary, but you can customize this value to whatever you like.**

**既定はランダムに生成された文字列**であって、`burpdomxss` のような固定値ではない。公式の canary 設定ページも "the randomly generated default canary" と書く。カスタム文字列に変えることもできる。

現在追跡中のカナリアは 2 か所で確認できる。

- **DOM ビューの左上**
- **設定メニューの最下部**

### カナリアの選び方 — false positive を避ける

公式 `settings/canary` ページに、実務上きわめて重要な注意がある（逐語）。

> To avoid false positives, make sure that the string you use doesn't occur naturally on the page.

false positive（誤検知。本当は問題ないのに問題ありと出ること）を避けるため、**ページ上に自然発生しない文字列**を使うこと。`test` のような一般的な単語をカナリアにすると、ページに元々あった `test` を拾ってしまい「シンクに届いた」と誤認する。既定のランダム文字列が安全なのはこのためだ。

カナリアの変更手順は次のとおり。

```text
1. 使いたい文字列を入力する（または Randomize を押して新しいランダム文字列を生成する）。
2. Update canary をクリックする。
3. Reload する。
```

`Copy` ボタンで現在のカナリアをクリップボードにコピーできる。

---

## 4. シンクのトリアージ — `sinkRanking` と 3 分類

### なぜランキングが要るのか

DOM Invader はシンクを「**面白い順**」に並べて表示する。ブログの言葉では次のとおり。

> **"Helpfully, DOM Invader orders sinks so that the most interesting ones appear first."**

その並び順の実装上の根拠が `sinkRanking` というオブジェクトだ。PortSwigger はこの一覧を意図的に公開している。

> We use the sink ranking terminology in order to decide which sink is more important than others. **The lower the value, the more important the sink is.**

**値が小さいほど重要なシンク**である。`jQuery.globalEval` の 1 が最重要、`document.evaluate` の 86 が最も軽い。

### `sinkRanking` 完全版（原典ブログ掲載・逐語）

以下は原典ブログ本文のコードブロックそのものである。中国語翻訳版の逐語転載および非公式抽出スクリプトの `sinkRanking` と 1 文字違わず一致することを確認している。

```javascript
const sinkRanking = {
    "jQuery.globalEval":1,
    "eval":2,
    "Function":3,
    "execScript":4,
    "setTimeout":5,
    "setInterval":6,
    "setImmediate":7,
    "msSetImmediate":7,
    "script.src":8,
    "script.textContent":9,
    "script.text":10,
    "script.innerText":11,
    "script.innerHTML":12,
    "script.appendChild":13,
    "script.append":14,
    "document.write": 15,
    "document.writeln": 16,
    "jQuery":17,
    "jQuery.$":18,
    "jQuery.constructor":19,
    "jQuery.parseHTML":20,
    "jQuery.has":20,
    "jQuery.init":20,
    "jQuery.index":20,
    "jQuery.add": 20,
    "jQuery.append": 20,
    "jQuery.appendTo": 20,
    "jQuery.after": 20,
    "jQuery.insertAfter": 20,
    "jQuery.before": 20,
    "jQuery.insertBefore": 20,
    "jQuery.html": 20,
    "jQuery.prepend": 20,
    "jQuery.prependTo": 20,
    "jQuery.replaceWith": 20,
    "jQuery.replaceAll": 20,
    "jQuery.wrap": 20,
    "jQuery.wrapAll": 20,
    "jQuery.wrapInner": 20,
    "jQuery.prop.innerHTML": 20,
    "jQuery.prop.outerHTML": 20,
    "element.innerHTML":21,
    "element.outerHTML":22,
    "element.insertAdjacentHTML":23,
    "iframe.srcdoc": 24,
    "location.href":25,
    "location.replace":26,
    "location.assign":27,
    "location":28,
    "window.open":29,
    "iframe.src":30,
    "javascriptURL":31,
    "jQuery.attr.onclick":32,
    "jQuery.attr.onmouseover":32,
    "jQuery.attr.onmousedown":32,
    "jQuery.attr.onmouseup":32,
    "jQuery.attr.onkeydown":32,
    "jQuery.attr.onkeypress":32,
    "jQuery.attr.onkeyup":32,
    "element.setAttribute.onclick":33,
    "element.setAttribute.onmouseover":33,
    "element.setAttribute.onmousedown":33,
    "element.setAttribute.onmouseup":33,
    "element.setAttribute.onkeydown":33,
    "element.setAttribute.onkeypress":33,
    "element.setAttribute.onkeyup":33,
    "createContextualFragment":34,
    "document.implementation.createHTMLDocument": 35,
    "xhr.open":36,
    "xhr.send": 36,
    "fetch": 36,
    "fetch.body": 36,
    "xhr.setRequestHeader.name": 37,
    "xhr.setRequestHeader.value": 38,
    "jQuery.attr.href":39,
    "jQuery.attr.src":40,
    "jQuery.attr.data":41,
    "jQuery.attr.action":42,
    "jQuery.attr.formaction":43,
    "jQuery.prop.href":44,
    "jQuery.prop.src":45,
    "jQuery.prop.data":46,
    "jQuery.prop.action":47,
    "jQuery.prop.formaction":48,
    "form.action":49,
    "input.formaction":50,
    "button.formaction":51,
    "button.value": 52,
    "element.setAttribute.href":53,
    "element.setAttribute.src":54,
    "element.setAttribute.data":55,
    "element.setAttribute.action":56,
    "element.setAttribute.formaction":57,
    "webdatabase.executeSql": 58,
    "document.domain":59,
    "history.pushState":60,
    "history.replaceState":61,
    "xhr.setRequestHeader":62,
    "websocket":63,
    "anchor.href":64,
    "anchor.target": 65,
    "JSON.parse": 66,
    "document.cookie":67,
    "localStorage.setItem.name": 68,
    "localStorage.setItem.value": 69,
    "sessionStorage.setItem.name": 70,
    "sessionStorage.setItem.value": 71,
    "element.outerText": 72,
    "element.innerText": 73,
    "element.textContent": 74,
    "element.style.cssText": 75,
    "RegExp":76,
    "window.name":77,
    "location.pathname": 78,
    "location.protocol": 79,
    "location.host": 80,
    "location.hostname": 81,
    "location.hash": 82,
    "location.search": 83,
    "input.value": 84,
    "input.type": 85,
    "document.evaluate": 86
};
```

〔補足〕非公式抽出スクリプトにのみ存在する 3 項目（`element.setAttribute.on*:33`, `fetch.url:36`, `fetch.header:36`）は、後のバージョンでの追加とみられる。上のブログ掲載版が最も検証済みの母集団である。

### ランキングの帯別の読み方（トリアージ順序）

86 個を暗記する必要はない。**帯（バンド）で捉える**と、DOM ビューに出たシンクをどう扱うかが即決できる。

| 帯 | ランク | 内容 | ハンターの判断 |
| --- | --- | --- | --- |
| A | 1–7 | `jQuery.globalEval`, `eval`, `Function`, `execScript`, `setTimeout`, `setInterval`, `setImmediate` | **JS 直接実行**。クォート／括弧のブレイクアウトだけで即実行。最優先 |
| B | 8–14 | `script.src` と `script.*`（本体書き込み） | **スクリプトの中身か読み込み元**を握れる。`script.src` は CSP の `script-src` 次第 |
| C | 15–24 | `document.write(ln)`, jQuery の HTML 挿入 API 群, `element.innerHTML/outerHTML/insertAdjacentHTML`, `iframe.srcdoc` | **HTML 挿入**。`document.write` は `<script>` が効くが `innerHTML` 系は効かない |
| D | 25–31 | `location.*`, `window.open`, `iframe.src`, `javascriptURL` | **ナビゲーション**。`javascript:` が通れば XSS、通らなければオープンリダイレクト |
| E | 32–33 | `jQuery.attr.on*`, `element.setAttribute.on*` | **イベントハンドラ属性**。値がそのまま JS として評価される |
| F | 34–35 | `createContextualFragment`, `createHTMLDocument` | HTML パースの別経路 |
| G | 36–38 | `xhr.open/send`, `fetch`, `xhr.setRequestHeader.*` | **リクエスト改竄・ヘッダインジェクション**（SSRF 風） |
| H | 39–57 | `href`/`src`/`data`/`action`/`formaction` 系（jQuery attr/prop, form, input, button, setAttribute） | **リンク・フォーム送信先の改竄**。`formaction` は CSRF / フィッシングに化ける |
| I | 58–71 | `executeSql`, `document.domain`, `history.*`, `websocket`, `anchor.*`, `JSON.parse`, `document.cookie`, `Storage.setItem.*` | **状態汚染系**。単体では XSS になりにくいが連鎖の起点になる |
| J | 72–86 | `element.outerText/innerText/textContent`, `cssText`, `RegExp`, `window.name`, `location.*`（読み取り系）, `input.value/type`, `document.evaluate` | **低危険度**。多くが既定で監視されない（後述） |

### シンクの 3 分類（`jsSinks` / `htmlSinks` / `urlSinks`）

公式ドキュメントは XSS コンテキストの判定で「HTML 実行シンクか JavaScript 実行シンクか」を最初に問う。その「種類」の実体が、DOM Invader 内部の 3 分類である。以下は**非公式に抽出された内部定数**（出典: `wrench1997/Jackdaw` の `dom_xss_zx.js`、対応バージョン不明）だが、公式ドキュメントの記述と論理的に整合する。

**`jsSinks`（JavaScript 実行シンク, 30 個）**
`jQuery.globalEval`, `eval`, `Function`, `execScript`, `setTimeout`, `setInterval`, `setImmediate`, `msSetImmediate`, `script.textContent`, `script.text`, `script.innerText`, `script.innerHTML`, `script.appendChild`, `script.append`, `javascriptURL`, `jQuery.attr.on{click,mouseover,mousedown,mouseup,keydown,keypress,keyup}`, `element.setAttribute.on{click,mouseover,mousedown,mouseup,keydown,keypress,keyup}`, `element.setAttribute.on*`

**`htmlSinks`（HTML 実行シンク, 32 個）**
`document.write`, `document.writeln`, `jQuery`, `jQuery.$`, `jQuery.constructor`, `jQuery.parseHTML`, `jQuery.has`, `jQuery.init`, `jQuery.index`, `jQuery.add`, `jQuery.append`, `jQuery.appendTo`, `jQuery.after`, `jQuery.insertAfter`, `jQuery.before`, `jQuery.insertBefore`, `jQuery.html`, `jQuery.prepend`, `jQuery.prependTo`, `jQuery.replaceWith`, `jQuery.replaceAll`, `jQuery.wrap`, `jQuery.wrapAll`, `jQuery.wrapInner`, `jQuery.prop.innerHTML`, `jQuery.prop.outerHTML`, `element.innerHTML`, `element.outerHTML`, `element.insertAdjacentHTML`, `iframe.srcdoc`, `createContextualFragment`, `document.implementation.createHTMLDocument`

**`urlSinks`（URL シンク, 25 個）**
`location.href`, `location.replace`, `location.assign`, `location`, `window.open`, `iframe.src`, `script.src`, `jQuery.attr.{href,src,data,action,formaction}`, `jQuery.prop.{href,src,data,action,formaction}`, `form.action`, `input.formaction`, `button.formaction`, `element.setAttribute.{href,src,data,action,formaction}`

```javascript
const interestingSinks = [ ...jsSinks, ...htmlSinks, ...urlSinks ];
```

**使い方**: DOM ビューに出たシンク名をこの 3 分類に当てると、次に打つべきペイロードの形がただちに決まる。

| 分類 | 次に考えること |
| --- | --- |
| `jsSinks` | クォート／括弧のブレイクアウトだけ考える（`\` `'` `"` が効くか） |
| `htmlSinks` | タグを作れるか（`<` `>`）。作れるならイベントハンドラ属性へ |
| `urlSinks` | `javascript:` が通るか（`:`）。通らなければオープンリダイレクトとして扱う |

### DOM Invader が追跡するソース（`sourcesList`）

DOM Invader がソースとして扱う一覧（ブログ掲載版・逐語、11 個）。

```javascript
const sourcesList = [
    "location",
    "location.href",
    "location.hash",
    "location.search",
    "location.pathname",
    "document.URL",
    "window.name",
    "document.referrer",
    "document.documentURI",
    "document.baseURI",
    "document.cookie"
];
```

〔補足〕非公式抽出版ではこれに `URLSearchParams` が加わって 12 個になっている。`new URLSearchParams(location.search).get('x')` という現代的な書き方を捕捉するための追加とみられる（Academy の innerHTML ラボの脆弱コードがまさにこの形）。

### 既定で監視されないシンク（false negative の根拠）

ランキングに載っていても、ブラウザ拡張としての DOM Invader では**監視されない**シンクがある。これも非公式抽出定数だが、公式の記述と整合する。

```javascript
const extensionExcludedSinks = [
    "button.value", "webdatabase.executeSql", "anchor.target",
    "element.outerText", "element.innerText", "element.textContent",
    "element.style.cssText", "RegExp", "input.value", "input.type", "document.evaluate"
];
```

この 11 個（ランク 52, 58, 65, 72〜76, 84〜86 のほぼ全部）は既定で対象外だ。公式 `settings/main` も次のように書く。

> By default, all sources are hidden and only the most interesting sinks are instrumented.

つまり**「DOM ビューに出なかった＝そのシンクに届いていない」ではない**。`element.textContent` や `input.value` にカナリアが届いても、既定の DOM ビューには現れない。これが false negative（見逃し）の温床になる。

---

## 5. DOM XSS のテスト手順 — 注入からコンテキスト判定まで

ここからが本節の核心である。公式ドキュメント "Testing for DOM XSS" の手順を、実際に打つ操作の順に並べる。公式の導入は次のとおり。

> **Testing for DOM XSS can be tedious as it often involves manually tracking the flow of your input through complex JavaScript, which may stretch to thousands of lines of code. DOM Invader greatly simplifies this process by instantly showing you any sinks that your input flows into, along with the surrounding context.**

### ステップ 1 — カナリアを注入する（4 手順・逐語）

```text
1. Go to the DOM Invader tab in the browser's DevTools panel.
2. Make sure that you are in the DOM view.
3. Click Copy canary.（追跡中のカナリアがクリップボードにコピーされる）
4. Paste the canary into any inputs that you want to test.
   （URL のクエリパラメータ、フォームフィールドなど、テストしたい入力欄に貼る）
```

注意: この 4 手順は `dom-xss` ページ本体の手順であり、第 2 節で見た「右クリック → Inspect」は**初回セットアップ（`enabling` ページ）の手順**である。混同しないこと。

### ステップ 2 — 複数ソースへの一括注入（Inject URL params / Inject forms）

手で 1 か所ずつ貼る代わりに、DOM Invader に自動注入させることもできる（逐語）。

> - **Inject URL params** - Automatically injects the canary into **every query parameter in the URL, using a separate tab for each parameter**.
> - **Inject forms** - Automatically injects the canary into any HTML form fields detected on the page. **Note that you still need to submit the form manually for the injection to take effect.**

- **`Inject URL params`** … URL のすべてのクエリパラメータにカナリアを注入し、**パラメータごとに別タブ**を使う。
- **`Inject forms`** … ページ上の HTML フォームフィールドにカナリアを注入する。ただし**フォームは手動で送信しないと効果が出ない**。ここを知らないと「Inject forms を押したのに何も出ない」と誤解する。

そして公式は運用上の推奨を明言している。

> **Note**: **Injecting the canary into all URL parameters and form fields at once may prevent the site from working properly. For the best results, we recommend testing one source at a time.**

**全ソースへの一括注入はサイトを壊しうるので、1 回に 1 ソースずつテストすること**を公式が推奨している。

### ステップ 3 — 制御可能なシンクを特定する

カナリアを注入すると、DOM Invader は自動で DOM を解析し、カナリアが現れたシンクを特定して DOM ビューに**面白い順**で並べる（逐語）。

> After you inject a canary, DOM Invader **automatically parses the DOM to identify any sinks in which your canary appears**. It then displays these sinks in the **DOM** view, **sorted in order of how interesting they are**.

ここまでで「入力がどの危険な関数に届いたか」が一覧で見える。反射型 XSS を目で追うのと同じ体験だ。

---

## 6. XSS コンテキストの判定 — 3 列と follow-up 文字

### なぜコンテキスト判定が要るのか

シンクにカナリアが届いても、そのままでは XSS にならない。**その入力がどんな文脈（コンテキスト）に落ちているか**を知らないと、正しいペイロードが組めない。公式は判定すべき 3 点を挙げる（逐語）。

> - Whether you're working with an **HTML or JavaScript execution sink**.
> - Whether your input is **surrounded by any special characters that you need to break out of**. These include quotes, tags, attributes, and so on.
> - What kind of **validation, sanitization, or other processing** the website performs on your input before it reaches the sink.

すなわち ①HTML 実行シンクか JS 実行シンクか（→ 第 4 節の 3 分類）、②入力を囲む特殊文字は何で、そこから**ブレイクアウト**（break out。囲みのクォートやタグを閉じて外に出ること）する必要があるか、③シンクに届く前にサイトがどんな検証・サニタイズをかけているか、である。

### follow-up 文字でエスケープを実測する

DOM Invader はカナリアの中身と、その周囲の文字を DOM に現れたとおりに表示する。だから**カナリアの後ろに特殊文字を足して、それがエスケープ／エンコードされているかを目で見る**ことができる（逐語）。

> **This means you can append special characters to your canary in order to easily see whether they are being escaped or encoded.**

DOM Invader 自身がこの「特殊文字を足して追試する」動きを自動で行う。その文字集合が **follow-up 文字**で、非公式抽出定数では次のように定義されている。

```javascript
const FOLLOW_UP_CHARACTERS = "\\<>'\":";
```

バックスラッシュ `\`、小なり `<`、大なり `>`、シングルクォート `'`、ダブルクォート `"`、コロン `:` の 6 文字だ。手でカナリアに足すときも、**まずこの 6 文字を試すのが公式実装と同じ基準**になる。

| 文字 | 何を確かめるか |
| --- | --- |
| `<` `>` | HTML タグを作れるか |
| `'` `"` | 文字列／属性からブレイクアウトできるか |
| `\` | JS 文字列内でエスケープを崩せるか |
| `:` | `javascript:` スキームを作れるか（`javascriptURL` シンク＝ランク 31 に対応） |

### DOM Invader の自動トリアージの正体

ブログには、DOM Invader が severity（深刻度）と confidence（確信度）をどう決めているかが書かれている（逐語）。

> DOM Invader also **attempts to grade the severity and confidence of messages it sees based on several factors - including if the message data was found in a sink and what type of sink it was**. When messages are manipulated, **DOM Invader will attempt to do a follow up with more interesting characters. If this is successful it will upgrade the severity and confidence based on the follow up characters that were found unencoded in the sink.**

要するに ①データがシンクに届いたか、②そのシンクがどの種類か、で初期グレードを決め、③**follow-up 文字が未エンコードのままシンクに残っていれば severity / confidence を格上げする**、という仕組みだ。ツールが出す深刻度は「follow-up 文字が生で通ったかどうか」を反映している、と理解しておく。

### シンクの種類に応じて出る 3 列（Outer HTML / Frame path / Event）

DOM Invader は、特定したシンクの種類に応じて追加情報を列で見せる（逐語）。

> - **Outer HTML** - The HTML element that surrounds your canary.
> - **Frame path** - The frame in which your canary is passed to the sink.
> - **Event** - The JavaScript event that occurs when your canary is passed to the sink.

公式日本語訳も併記する。

| 列 | 英語 | 日本語訳 | ハンティングでの使い方 |
| --- | --- | --- | --- |
| **Outer HTML** | The HTML element that surrounds your canary | カナリアを囲む HTML 要素 | 「どのタグの中に落ちているか」が一目で分かる。ブレイクアウトに必要な閉じタグが決まる |
| **Frame path** | The frame in which your canary is passed to the sink | カナリアがシンクにたどり着くフレーム | **iframe 内で起きている脆弱性を識別する公式手段**。フレームの所在を特定してから対処する |
| **Event** | The JavaScript event that occurs when your canary is passed to the sink | カナリアがシンクにたどり着いたときに発生する JavaScript イベント | 「click したときだけシンクに届く」ケースを可視化する。後述の `Auto-fire events` 設定と対で読む |

公式は、この情報を使って実際にブレイクアウトした例を示す（逐語）。

> This information enables you to easily see the XSS context and test which characters and events you need to craft an exploit. In the following example, **we've successfully broken out of the double-quoted string and surrounding `<span>` in order to inject our XSS proof-of-concept exploit**.

ダブルクォートで囲まれた文字列と、それを囲む `<span>` からブレイクアウトして PoC を注入できた、という流れだ。`Outer HTML` 列で `<span>` を確認し、`"` でブレイクアウトできると分かってからペイロードを組む、という筋道である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Testing for DOM XSS（Burp Suite Documentation）— https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
> **なぜ**: 本文は Burp 同梱ドキュメントのミラーから全文取得できたが、**3 枚のスクリーンショットは取得できなかった**（`portswigger.net` がプロキシで遮断）。エスケープされているかを「目で判断する感覚」は画像でしか伝わらない。
> **読みどころ**:
> 1. `dom-invader-innerHTML-sink.png` — DOM ビューに `innerHTML` シンクが出た状態。どの列が Value / Stack Trace かを本節の説明と突き合わせる。
> 2. `dom-invader-unescaped-chars.png`（alt: 「反射型 XSS のように DOM XSS をテスト」）— **特殊文字が生のままシンクに届いている様子**。本節で最重要の画面。
> 3. `dom-invader-payload.png` — `<span>` とダブルクォートをブレイクアウトした状態。
> 4. 現行 Burp との差分確認。本文の取得元はミラーなので、UI 名称や設定項目が実機で増減していないか突き合わせる。
> **代替手段**: 英語本文は `https://raw.githubusercontent.com/1tbfree/BurpSuitePro-SourceLeak/HEAD/resources/Documentation/burp/documentation/desktop/tools/dom-invader/dom-xss.html`、公式日本語版は `https://raw.githubusercontent.com/ankokuty/burp-resources-ja/HEAD/Documentation/burp/documentation/desktop/tools/dom-invader/dom-xss.html` で再取得できる（ただし画像なし）。

---

## 7. クライアントサイドコードへジャンプする — Stack Trace の 4 手順

### なぜコードを読む必要があるのか

ペイロードをいろいろ試していると、**急に入力がシンクに流れなくなる**ことがある。公式はその理由を説明する（逐語）。

> This could be because you can only reach the sink via a specific code path, such as one branch of a conditional statement.

条件分岐の一方の枝を通ったときだけシンクに届く、というように**特定のコードパスを経由しないと届かない**ことがあるからだ。そこで DOM Invader は、入力がシンクに渡される**まさにその行**へジャンプさせてくれる。

> DOM Invader enables you to **jump straight to the point in the client-side code where your input is passed to the sink**.

### 正式手順（4 ステップ・逐語）

前工程のノートには「シンクをクリックするとジャンプできる」と曖昧に書かれていたが、正しくは次の 4 手順である。

```text
1. Inject a payload that you know will reach the sink.
   （シンクに届くと分かっているペイロードを注入する）
2. In DOM Invader's DOM view, click the link in the `Stack Trace` column.
   （DOM ビューの Stack Trace 列のリンクをクリックする → コンソールにスタックトレースが出力される）
3. In the DevTools panel, switch to the `Console` tab.
   （DevTools で Console タブに切り替える）
4. In the stack trace, click the uppermost link.
   （スタックトレースの一番上のリンクをクリックする → Sources タブでクライアント JS が開き、
    入力がシンクに渡される行にフォーカスされる）
```

つまり **`Stack Trace` 列のリンク → Console タブ → 一番上のリンク → Sources タブ**という 4 手だ。開いた行の**手前のコード**を読めば、「入力がシンクに届くために満たすべき条件」が分かる。

> You can then study the preceding code to identify **what conditions your input must meet in order to reach the sink**.

### DOM XSS 単体に「Exploit ボタン」は無い

ここは前工程のノートで訂正された重要点である。`dom-xss` ページの全文に **`Exploit` という語は 1 度も出てこない**。ページは `Studying the client-side code` の次に `Read more`（設定への導線）で終わる。ボタンの対応関係を整理する。

| 機能 | 最終段のボタン | 挙動 |
| --- | --- | --- |
| **DOM XSS** | **なし** | ペイロードを自分で組んで実行を確認する |
| **web message** | **`Build PoC`** | HTML PoC をクリップボードにコピー |
| **prototype pollution** | **`Exploit`** | source + gadget + sink を連鎖した PoC を新ウィンドウで自動実行し `alert()` を出す |

**DOM XSS では自分でペイロードを組む必要がある**ことを覚えておく。「カナリアがシンクに届いた」段階で報告せず、必ず `alert()` 等の実行 PoC まで作るのが実務の通例だ。

### innerHTML シンクの落とし穴（出典に注意）

`element.innerHTML`（ランク 21）は最頻出の HTML シンクだが、注意がある。**この注意書きの正しい出典は DOM Invader のドキュメントではなく、Web Security Academy のラボ "DOM XSS in innerHTML sink using source location.search" のラボ説明である**（逐語）。

> The `innerHTML` sink doesn't accept `script` elements on any modern browser, nor will `svg` `onload` events fire. This means you will need to use alternative elements like `img` or `iframe`. Event handlers such as `onload` and `onerror` can be used in conjunction with these elements. For example:
> ```javascript
> element.innerHTML='... <img src=1 onerror=alert(document.domain)> ...'
> ```

現代のブラウザでは `innerHTML` に `<script>` を入れても実行されず、`svg` の `onload` も発火しない。だから `img` や `iframe` に `onerror` / `onload` を組み合わせる。**DOM ビューの Value 列で「`<script>` を入れたのに何も起きない」ときに、脆弱でないと早合点しないこと**。`Outer HTML` 列で囲みの要素を見てから `img onerror` に切り替えるのが正しい手順だ。

---

## 8. web message（postMessage）のテスト — Messages ビュー

### なぜ専用の機能があるのか

web message（web メッセージ）とは、`postMessage()` メソッドで別のウィンドウや iframe との間で送受信されるメッセージのこと。異なるオリジン間でデータをやり取りする正規の仕組みだが、受け手のイベントリスナが送信元（origin）を正しく検証しないと DOM XSS の入口になる。ブログはテストの面倒さを述べる（逐語）。

> When testing sites, we've always found it cumbersome to test for web-message vulnerabilities. Sure, you can add event listeners and breakpoints in Chrome - but there's no easy way to edit them...

DevTools でリスナやブレークポイントを張ることはできても、メッセージを手軽に編集する方法がなかった。そこを DOM Invader が肩代わりする。

### Burp の三段構えのアナロジー

公式ドキュメントは `Messages` ビューの機能を、Burp の他ツールになぞらえて説明している（逐語）。これが最も分かりやすい。

> - **Logging** any web messages that are sent via the `postMessage()` method on the page... **This is similar to how Burp Proxy shows the history of your HTTP requests and responses.**
> - Enabling you to **modify and resend** web messages... **This is similar to how Burp Repeater reissues modified HTTP requests.**
> - **Automatically modifying and sending** web messages to probe for DOM XSS on your behalf.

| Messages ビューの機能 | 対応する Burp ツール |
| --- | --- |
| メッセージの記録（ログ） | Burp **Proxy**（HTTP 履歴） |
| メッセージの改変・再送 | Burp **Repeater**（改変したリクエストの再送） |
| メッセージの自動改変・自動送信 | Burp **Scanner**（自動プローブ） |

### 有効化と自動解析

既定 OFF。設定メニュー → **`Postmessage interception`** スイッチ → **`Reload`** で有効になる。有効にすると DOM Invader は自動でメッセージを改変して脆弱性を探す（逐語）。

> - **Injecting your canary via the message's `data` property.** DOM Invader can use this to identify any sinks that this data flows into...
> - **Replacing the origin of the message with a fake origin that starts and ends with the expected domain name.** This enables DOM Invader to automatically identify event handlers that rely on flawed logic or regular expressions to validate the origin...

つまり ①メッセージの `data` プロパティにカナリアを注入してシンクへの流れを追い、②origin を**「本物のドメイン名で始まり、かつ終わる偽 origin」に置換**して、`startsWith()` / `endsWith()` のような甘い検証を暴く。

### 「全メッセージが最低 Information」の意味

公式は severity の付け方に重要な但し書きを付けている（逐語）。

> All messages sent on the page are listed with at least an `Information` severity rating, **as they may contain vulnerabilities that DOM Invader can't detect automatically.**

**ページ上の全メッセージが最低でも `Information` で出る**。これは「Information の行を見て脆弱性なしと読んではいけない」という警告だ。DOM Invader が自動検出できない脆弱性がそこに潜んでいる可能性を、公式自身が明言している。

### メッセージ詳細 — origin / data / source の読み方

メッセージをクリックすると、`origin` / `data` / `source` の各プロパティがクライアント JS から参照されたかが分かる。

| プロパティ | 参照されていないとき | 補足 |
| --- | --- | --- |
| **origin** | クライアントコードが `origin` を一度も参照していないなら、**origin は検証されていない可能性が高い**。任意の外部ドメインからメッセージを送れるかもしれない | ただし参照していても安全とは限らない（検証をバイパスできることがある） |
| **data** | JS が `data` を一度も参照しないなら、それがシンクに渡ることはない。**そのメッセージは調べる価値がない** | `data` は**ペイロードを注入する場所** |
| **source** | サイトは origin の代わりに `source`（送信元 `window` への参照、実務上はたいてい iframe）を検証することが多い | 参照していても検証済みとは限らず、バイパス不能とも限らない |

### 再送と PoC 生成

**再送（Repeater 相当）**: `Messages` ビューでメッセージをクリック → 詳細ダイアログで **`Data` フィールドを編集** → **`Send`**。公式の例（逐語）。

> ...you could **send messages to test whether characters like `<`, `>`, and `"` are escaped**, then use these characters to create and send a proof-of-concept payload.

`<` `>` `"` がエスケープされるかをメッセージ送信で確かめ、通れば PoC を作って送る、という流れだ。

**PoC 生成**: 脆弱なメッセージを選び、値を編集してから **`Build PoC`** をクリックすると、**HTML がクリップボードに保存される**。レポートにそのまま貼れる HTML PoC だ。origin 偽装は、Postmessage origin spoofing 設定を切っていても再送時に **`Spoof origin` チェックボックス**で個別に指定できる。

### cross-domain leak の検出

Web message 設定には **`Detect cross-domain leaks`** がある。**現在のページが URL 由来のデータを含む web message を別 origin に送った**ことを報告する機能だ。攻撃者は当該ページを iframe に埋め込み、イベントリスナでデータを抜くことで、**OAuth トークンなどの機密を盗める**可能性がある。

---

## 9. クライアントサイド prototype pollution — source からガジェット、Exploit まで

### prototype pollution とは

prototype pollution（プロトタイプ汚染）とは、JavaScript のすべてのオブジェクトが継承する **`Object.prototype` に攻撃者がプロパティを書き込む**ことで、アプリ全体の挙動を狂わせる攻撃のこと。汚染したプロパティが危険な関数（ガジェット）に読み込まれると、XSS などに発展する。

公式ドキュメントは DOM Invader の 3 大機能を挙げる（逐語）。

> - **Automatically detect sources** for prototype pollution **in the URL and any JSON objects sent via web messages**...
> - **Generate a proof of concept by polluting the `Object.prototype`** using any discovered sources...
> - **Scan for potential gadgets** that you can use to craft an exploit.

有効化は設定メニュー → `Attack types` → **`Prototype pollution` を ON** → **`Reload`**。

### ① source の検出と汚染手法 4 種

有効化すると DOM Invader は `Object.prototype` にプロパティを追加できる source を自動チェックし、`DOM` ビューに表示する。汚染の**手法は 4 種**あり、非公式抽出定数では次のように定義されている（`PROTOTYPE_POLLUTION_TECHNIQUES`）。

| # | 手法の表記 |
| --- | --- |
| 1 | `constructor[prototype][property]=value` |
| 2 | `constructor.prototype.property=value` |
| 3 | `__proto__.property=value` |
| 4 | `__proto__[property]=value` |

各手法は `hashIdentifier` / `searchIdentifier` の 2 種の識別子を持つ。これは **URL の hash 経由の汚染と、クエリ文字列経由の汚染を区別するため**だ。公式 `settings/prototype-pollution` の `Disabling prototype pollution techniques`（`Techniques` ボタンで手法を個別 ON/OFF）で操作できるのがこの 4 手法である。

### ② 手動確認（逐語手順）

```text
1. DOM ビューで該当 source 横の Test ボタンをクリック。
   → DOM Invader が新しいタブを開き、その source で Object.prototype に任意プロパティを追加する。
2. 新しいタブでブラウザコンソールへ。DOM Invader が Object.prototype を自動で出力している。
3. ノードを展開し、PoC 用の testproperty が含まれることを確認する。
4. コンソールで新しいオブジェクトを作る。
5. プロトタイプチェーン経由で testproperty を継承していることを確認する。
```

```javascript
let myObject = {};
console.log(myObject.testproperty);
// Output: 'DOM_INVADER_PP_POC'
```

### ③ ガジェットのスキャン

ガジェット（gadget）とは、公式の定義では次のもの（逐語）。

> This is any user-controllable property that is passed to a sink without being properly sanitized.

**適切にサニタイズされずにシンクへ渡される、ユーザ制御可能なプロパティ**のことだ。source があってもガジェットが無ければ悪用できない。手で探すのは極めて骨が折れるが、DOM Invader が自動化する。

```text
1. DOM ビューで prototype pollution source 横の Scan for gadgets ボタンをクリック。
   → 新しいタブが開いてスキャンが始まる。
2. 同じタブで DevTools の DOM Invader タブを開く。
   → スキャン完了後、DOM ビューに「ガジェット経由で到達できたシンク」が並ぶ。
```

公式の例では `html` というガジェットプロパティが `innerHTML` シンクに渡された。

### ④ Exploit で PoC を自動生成

ガジェットが見つかると、DOM Invader は source・gadget・sink を連鎖した PoC を自動生成できる（逐語）。

> Simply click the **`Exploit`** button next to the discovered sink. **DOM Invader opens a new window in which it successfully calls `alert()`.**

発見したシンクの横の **`Exploit`** ボタンを押すと、新しいウィンドウで `alert()` が実行される。前述のとおり、**`Exploit` ボタンはこの prototype pollution の文脈にだけ存在する**。

---

## 10. DOM clobbering

DOM clobbering（DOM クロバリング）とは、公式定義では次のもの（逐語）。

> DOM clobbering is a technique in which you **inject HTML into a page to manipulate the DOM in a way that enables you to change the behavior of JavaScript on the page**.

ページに HTML を注入して DOM を操作し、そのページの JavaScript の挙動を変える技術のことだ。既定 OFF。有効化は設定メニュー → `Attack types` → **`DOM clobbering` を ON** → **`Reload`**。以後、**ブラウジングしている間ずっと DOM clobbering の脆弱性をスキャンし続ける**。

〔補足（HackTricks 由来・公式未確認）〕動的生成された要素の `id` / `name` がグローバル変数やフォームオブジェクトと衝突するのを監視する（例: `<input name="location">` が `window.location` を clobber する）。ユーザ制御のマークアップが変数置換につながるたびにエントリが生成される。

---

## 11. 設定の全体像 — 見落とされがちな Misc 設定

DOM Invader の挙動は設定で大きく変わる。特に `settings/misc` には、知らないと結果を取りこぼす項目がある。

### Main / Attack types 設定

| 設定 | 要点 |
| --- | --- |
| **Enable DOM Invader** | グローバルトグル。既定 OFF の理由は「一部機能が対象サイトを壊し、他のテストに影響しうるから」 |
| **Postmessage interception** | ON で `Messages` ビューが使える。歯車から詳細設定 |
| **Customizing sources and sinks** | 歯車アイコンから instrument する source / sink を制御。既定は「全 source 非表示・最も面白い sink だけ instrument」。サイトが壊れるときは個別に無効化（公式の例: `eval()` を instrument するとその挙動が変わり関連機能が壊れることがある） |
| **Prototype pollution**（Attack types） | 通常の DOM XSS に加えて prototype pollution の source を自動特定 |
| **DOM clobbering**（Attack types） | DOM clobbering の脆弱性を自動特定 |

### Misc 設定（重要 4 項目を含む）

| 設定 | 要点 |
| --- | --- |
| **Message filtering by stack trace** | 各エントリのスタックトレースを比較し、既存と同じコード位置を指すものを隠す。大量メッセージを出すサイト向け |
| **Auto-fire events** | ページ読込と同時に、全要素に対して `click` と `mouseover` を自動発火する。「注入したペイロードがこれらのイベントが起きたときだけシンクに届く」ケースで有用。`Event` 列と対で使う |
| **Redirection prevention** | クライアントサイドリダイレクトが起きると、それまで見つけた source / sink がクリアされて新ページのもので置き換わる。有効にするとリダイレクトをブロックして同じページに留まる。**ただし `javascript:` URL へのリダイレクトと `Inject URL` ボタン由来のリダイレクトは通常どおり動く** |
| **Add breakpoint before redirect** | リダイレクトをブロックする代わりに、リダイレクトを起こすコードの直前にブレークポイントを置く。**「現状これは Chrome の標準 DevTools では不可能」**と公式が明記する機能 |
| **Inject canary into all sources** | 識別された全 source にカナリアを自動注入。source ごとに一意の文字列を付加するので「どの source がどの sink に流れたか」が判別できる。ただし全注入はサイトを壊しやすい。歯車から特定 source の個別無効化や、対象パラメータのカンマ区切り指定ができる |
| **Configuring callbacks** | source / sink / web message を識別するたびにカスタムコールバックを実行できる。既定は結果をコンソールにログ出力するもの。もう 1 つの用途は **`debugger` 文を入れたコールバック**にして、制御可能なシンクを見つけた瞬間にスクリプト実行を止め、コールスタックを調べること |
| **Remove Permissions-Policy header** | 応答から `Permissions-Policy` ヘッダを除去する。一部サイトはこのヘッダで**同期 XHR など DOM Invader に必須の機能をブロック**しており、その場合 DOM Invader はコンソールで通知してこの設定を促す |

Callback の有効化手順は次のとおり。

```text
歯車 → Sources / Sinks / Messages タブを選ぶ
   → Callback configuration ボタン
   → スクリプトのテキストフィールドをクリックして有効化
   → 必要なら編集して Save
   → Reload
```

### Web message 設定（Postmessage interception の歯車）

| 設定 | 要点 |
| --- | --- |
| **Postmessage origin spoofing** | origin を「本物のドメイン名で始まり、かつ終わる偽 origin」に自動置換。`startsWith()` / `endsWith()` 検証を暴く。無効でも再送時に `Spoof origin` で個別偽装できる |
| **Canary injection into intercepted messages** | 全メッセージの `data` にカナリアを自動注入。JSON 文字列 / JSON オブジェクト / プレーン文字列を判定して正しい形式で注入。`Show` ドロップダウンで元データと注入済みデータを切り替えられる |
| **Filter messages with duplicate values** | 同一メッセージをグループ化してノイズを減らす。「実際に送られているか確認したい」ときは無効化する |
| **Generate automated messages** | 検出したイベントリスナに DOM Invader が自前でメッセージを生成して送る。各ハンドラが期待するデータ構造を推測し、反応を見てより危険なシンクを狙う follow-up も送る。`Messages` ビューで数値 ID を持たないものが DOM Invader 生成のメッセージ |
| **Detect cross-domain leaks** | URL 由来データを含む web message が別 origin に送られたことを報告（OAuth トークン窃取につながる） |

### Prototype pollution 設定

| 設定 | 要点 |
| --- | --- |
| **Scan for gadgets** | ページ読込のたびにガジェットを自動スキャン。source が 1 つも無いときの代替手段としても有用 |
| **Auto-scale amount of properties per frame** | 1 フレームあたりプロパティ数を自動調整。速いが、注入プロパティが例外を起こして同一 iframe 内の他ガジェットがテストされず false negative になりうる。無効にしてスライダで固定できる（下げる＝遅いが取りこぼし減、上げる＝速いが取りこぼす） |
| **Scan nested properties** | 既定でネストしたプロパティも再帰スキャン。無効にするとトップレベルのみ |
| **Query string injection / Hash injection / JSON injection** | 汚染の注入経路 3 種（クエリ文字列 / URL フラグメント / JSON web message）。サイトが壊れるなら個別に無効化 |
| **Verify onload** | 既定はページ読込完了を待ってから報告（特定したガジェットが最終 DOM にも残っていることを保証）。無効にすると速いが、`constructor` / `__proto__` が読込完了までにサニタイズされるケースで false positive |
| **Remove CSP header / Remove X-Frame-Options header** | 全応答から `Content-Security-Policy` / `X-Frame-Options` を除去。CSP が XSS ベクタと iframe をブロックするのを防ぐ（iframe はガジェットスキャンに必須） |
| **Scan each technique in separate frame** | 手法同士が干渉して見逃すことがある（公式の例: `__proto__` と `constructor` を同時に試すと失敗するが `constructor` 単独なら通るサイトがある）。有効にすると手法ごとに別 iframe を使う |

---

## 12. false positive / false negative の見分け方

DOM Invader は強力だが、鵜呑みにすると見逃しと誤検知を生む。公式裏取り済みのチェックリストをまとめる。

1. **カナリアはページに自然発生しない文字列にする** — 公式 `settings/canary`: "To avoid false positives, make sure that the string you use doesn't occur naturally on the page."。`test` のような一般語は使わない。
2. **既定では「最も面白いシンクだけ」しか instrument されていない** — 公式 `settings/main`: "By default, all sources are hidden and only the most interesting sinks are instrumented."。加えて `extensionExcludedSinks` の 11 個は常に対象外。**「DOM ビューに出なかった＝届いていない」ではない**。
3. **`Information` severity のメッセージを「安全」と読まない** — 全メッセージが最低 Information で出る。自動検出できない脆弱性がそこにあるかもしれない。
4. **Value 列でコンテキストを実測する** — カナリアに follow-up 文字（`\ < > ' " :`）を足し、`&quot;` や `&lt;` に変わっていないか見る。
5. **シンクが HTML 実行系か JS 実行系かを先に決める** — 3 分類に当てる。`innerHTML` 系は `script` が通らないので「`<script>` が動かない＝脆弱でない」ではない。`Outer HTML` を見て `img onerror` 等に切り替える。
6. **`Frame path` 列でフレームを確認する** — iframe 内のシンクを見落とさないため。
7. **`Event` 列と `Auto-fire events` 設定を対で使う** — 「click / mouseover が起きたときだけシンクに届く」ケースは、`Auto-fire events` を有効にしないと再現しない。
8. **リダイレクトでシンク一覧を失っていないか** — `Redirection prevention` が切れていると遷移で結果が消え、「何も出なかった」と誤認する。原因調査には `Add breakpoint before redirect`（Chrome 標準 DevTools では不可能な機能）。
9. **`Permissions-Policy` に殺されていないか** — 同期 XHR など必須機能がブロックされると正常に動かない。この場合 DOM Invader はコンソールで通知して `Remove Permissions-Policy header` を促すので、コンソールを見る癖をつける。
10. **Stack Trace でコードパスを確認する** — 同じシンク名でも、テンプレートエンジンの内部処理で偶然カナリアが通っただけのことがある。`Message filtering by stack trace` で同じコード位置のエントリを畳める。
11. **prototype pollution の `Verify onload`** — 無効にすると `constructor` / `__proto__` が読込完了までにサニタイズされるケースで false positive。`Auto-scale amount of properties per frame` は例外で残りガジェットが飛んで false negative。
12. **`Inject forms` は手動送信が必要** — 押しただけで待っても何も出ない。
13. **設定を変えたら必ず `Reload`** — Reload を忘れた状態のテスト結果は無効。

---

## 13. AutoVader — DOM Invader を自動運転する

DOM Invader は本来「手でカナリアを入れて DevTools を見る」ツールだが、公式に**自動化ラッパ**が存在する。作者は同じく Gareth Heyes。

**AutoVader** は **DOM Invader と Playwright Java を統合**して DOM ベース脆弱性を自動発見する Burp 拡張だ。BApp Store で "AutoVader" を検索してインストールする。要件は **Burp Suite Professional**（DOM Invader に必要）と **DOM Invader 拡張**（Burp インストールから自動検出）。Target / Proxy history / Repeater のリクエストを右クリックして実行する。

| スキャン種別 | 内容 | 対応する DOM Invader 手動機能 |
| --- | --- | --- |
| **Open DOM Invader** | 手動テスト用に DOM Invader 設定済みブラウザを開く | — |
| **Scan all GET params** | 全クエリパラメータを列挙しカナリアを注入 | Inject URL params |
| **Scan all GET params for gadgets** | HTML タグ・属性にカナリアを注入し URL 由来 DOM ガジェットを検出 | — |
| **Scan all POST params** | 全 POST パラメータにカナリアを注入 | — |
| **Scan web messages** | postMessage をテスト、origin を偽装して安全でないハンドラを特定 | Postmessage interception |
| **Inject into all sources** | 識別された全 source に体系的に注入 | Inject canary into all sources |
| **Inject into all sources & click everything** | 上記に加えて click イベントも発火 | Auto-fire events |
| **Scan for client side prototype pollution** | クエリ文字列・hash・JSON をテストし汚染を検証 | Prototype pollution |
| **Scan for client side prototype pollution gadgets** | 悪用可能なガジェットを発見 | Scan for gadgets |
| **Intercept client side redirect** | クライアントサイドリダイレクトにブレークポイントを設定 | Add breakpoint before redirect |

主な設定項目: **Path to DOM Invader** / **Path to Burp Chromium**（自動検出失敗時の上書き）、**Payload**（カナリアに付加するカスタムペイロード）、**HTML tags to scan** / **Attributes to scan**（ガジェット用）、**Delay**（リクエスト間隔）、**Always open devtools**、**Remove CSP**（既定で有効）、**Headless**、**Auto run from Repeater / Intruder / other extensions**（リクエストに `$canary` プレースホルダが必要）。

動作の要旨（README より）: Playwright で DOM Invader 拡張入りのヘッドレス Chromium を起動 → スキャン種別に応じて DOM Invader を自動構成 → ペイロード付き URL へ遷移 → DOM Invader の検出をコールバックで捕捉して **Burp の issue として報告**（重複排除あり）。**AutoVader のスキャン種別は DOM Invader の手動機能とほぼ 1 対 1 で対応する**ので、上の対応表を頭に入れると手動・自動の両方が一気に理解できる。

---

## 14. 実際の発見例 — ドッグフーディングと報奨金

### 一次情報 — 作者自身が PayPal で DOM XSS を発見

ブログ末尾の "Eating our own dog food" 節で、作者 Gareth Heyes が次のように書いている（逐語）。

> ...we recently **struck gold on a well-known bug bounty program while testing DOM Invader's functionality. Head over to the research channel to read up about the PayPal DOM XSS I found.**

**DOM Invader の機能をテストしている最中に、著名なバグバウンティプログラムで金脈を掘り当てた**、具体的には **PayPal の DOM XSS を見つけた**、というのだ。ツールの開発者自身がそのツールで実案件を発見した、という一次情報である。ただし攻撃経路の詳細記事本体（research channel 側）は本セッションでは取得できていない。

### 二次情報 — 検索フォームからの $500 事例

2023 年の報告記事 "$500 Bounty by Escalating DOM XSS to Stored XSS" には、**対象アプリのメイン検索フィールドに DOM Invader のカナリアを入れたところ DOM Invader が赤くなり**（"whenever it turns red, I investigate"）、シンクを特定してから単純なペイロードを順に試してどの文字がエンコードされるかを確認し、最終的に悪用可能な XSS に到達して報奨金を得た、という流れが記録されている。ここから読み取れる教訓は次の 4 点だ。

1. カナリアを入れる場所として**検索フォームは最優先**。
2. DOM Invader の**色／件数の変化を合図にする**。
3. シンクが分かってから**文字単位のエンコード実験**に移る（＝公式の follow-up 文字と同じ発想）。
4. DOM XSS は保存経路に乗ると **stored XSS に昇格**しうる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: $500 Bounty by Escalating DOM XSS to Stored XSS（Medium, 2023）— https://medium.com/@rodriguezjorgex/escalating-dom-xss-to-stored-xss-eb6f3a669af3
> **なぜ**: `medium.com` は本教科書の執筆環境でも遮断されたままで、**本文を検証できていない**。上の要約は WebSearch 経由の二次情報であり、原典未検証である。断定的な引用として扱わないこと。
> **読みどころ**:
> 1. 「カナリアを検索フィールドに入れて DOM Invader が赤くなる」実際の画面と、その後のシンク特定の流れ。
> 2. どの文字がエンコードされたかを 1 文字ずつ確かめる過程（follow-up 文字の実演）。
> 3. DOM XSS が保存されて stored XSS に昇格する経路。
> **代替手段**: 一次事例としては原典ブログの PayPal DOM XSS（research channel 記事）を優先する。無料の同等資料としては Web Security Academy の DOM XSS ラボ群が最良の練習台。

---

## 15. DOM Invader が読む source / sink の辞書

DOM ビューに現れる名前を読むために、PortSwigger が公式に列挙している source / sink の一覧を辞書として持っておくと便利だ。以下は DOM Invader の内部リストそのものではなく（それは第 4 節）、**PortSwigger の DOM ベース脆弱性レッスンから抽出したもの**である。

PortSwigger の定義（逐語）。

> A source is a JavaScript property that accepts data that is potentially attacker-controlled. An example of a source is the location.search property because it reads input from the query string...

> A sink is a potentially dangerous JavaScript function or DOM object that can cause undesirable effects if attacker-controlled data is passed to it. For example, the eval() function is a sink...

**代表的な source**: `document.URL`, `document.documentURI`, `document.URLUnencoded`, `document.baseURI`, `location`, `document.cookie`, `document.referrer`, `window.name`, `history.pushState`, `history.replaceState`, `localStorage`, `sessionStorage`, `IndexedDB (mozIndexedDB, webkitIndexedDB, msIndexedDB)`, `Database`

**主な sink（種別別）**:

| 種別 | sink |
| --- | --- |
| DOM XSS（ネイティブ） | `document.write()`, `document.writeln()`, `document.domain`, `element.innerHTML`, `element.outerHTML`, `element.insertAdjacentHTML`, `element.onevent` |
| DOM XSS（jQuery） | `add()`, `after()`, `append()`, `animate()`, `insertAfter()`, `insertBefore()`, `before()`, `html()`, `prepend()`, `replaceAll()`, `replaceWith()`, `wrap()`, `wrapInner()`, `wrapAll()`, `has()`, `constructor()`, `init()`, `index()`, `jQuery.parseHTML()`, `$.parseHTML()` |
| JavaScript インジェクション | `eval()`, `Function()`, `setTimeout()`, `setInterval()`, `setImmediate()`, `execCommand()`, `execScript()`, `msSetImmediate()`, `range.createContextualFragment()`, `crypto.generateCRMFRequest()` |
| オープンリダイレクト | `location`, `location.host`, `location.hostname`, `location.href`, `location.pathname`, `location.search`, `location.protocol`, `location.assign()`, `location.replace()`, `open()`, `element.srcdoc`, `XMLHttpRequest.open()`, `XMLHttpRequest.send()`, `jQuery.ajax()`, `$.ajax()` |
| Cookie 操作 | `document.cookie` |
| WebSocket URL 汚染 | `WebSocket` |
| リンク操作 | `element.href`, `element.src`, `element.action` |
| HTML5 ストレージ操作 | `sessionStorage.setItem()`, `localStorage.setItem()` |
| クライアントサイド SQL | `executeSql()` |
| XPath インジェクション | `document.evaluate()`, `element.evaluate()` |
| クライアントサイド JSON | `JSON.parse()`, `jQuery.parseJSON()`, `$.parseJSON()` |

> ### 📌 ここは自分で開いて読んでください
> **資料**: Web Security Academy — DOM-based vulnerabilities / DOM XSS ラボ群 — https://portswigger.net/web-security/dom-based および https://portswigger.net/web-security/cross-site-scripting/dom-based
> **なぜ**: `portswigger.net` がプロキシで遮断され、source / sink の**最新の公式一覧とラボ本体は自動取得できなかった**。上の表は cheatsheet 経由の抽出であり、原典で最新版を確認する必要がある。
> **読みどころ**:
> 1. `web-security/dom-based` — source / sink の公式一覧（最新版で項目が増減していないか確認）。
> 2. `lab-innerhtml-sink`（DOM XSS in innerHTML sink using source location.search）— DOM Invader の練習台として最良。脆弱コードが `URLSearchParams` を使う現代的な形。
> 3. `web-security/dom-based/controlling-the-web-message-source` — web message の DOM XSS 復習。
> 4. `web-security/dom-based/dom-clobbering` — DOM clobbering の Academy トピック。
> **代替手段**: ラボは無料で解ける（要 PortSwigger アカウント）。source/sink 一覧の抽出版は `https://raw.githubusercontent.com/Sivnerof/Sources-And-Sinks-Cheatsheet/HEAD/README.md` で参照できる。

---

## 手を動かす

以下は**自分で立てた検証環境か、許可されたバグバウンティ・診断**でのみ行うこと。DOM Invader は対象サイトの挙動を書き換えるため、無許可のサイトで動かしてはいけない。

1. **Burp を Early Adopter 以降のバージョンにする**。Professional でも Community でも DOM Invader は使える。
2. **内蔵ブラウザを起動する**。`Proxy > Intercept` タブから Burp の内蔵ブラウザを開く。
3. **DOM Invader を有効化する**。ブラウザ右上の Burp Suite ロゴ（見えなければジグソーアイコン）をクリック → 設定メニューでスイッチを ON → **`Reload`**。
4. **DevTools を開く**。メインのブラウザウィンドウ内を右クリック → `Inspect` → `DOM Invader` タブを選び、`DOM` ビューにする。パネルは下部にドッキングすると見やすい。
5. **カナリアをコピーする**。`DOM` ビューの左上で現在のカナリアを確認し、`Copy canary` を押す。ページに自然発生しない文字列であることを確かめる（心配なら `Randomize` → `Update canary` → `Reload`）。
6. **練習台を開く**。Web Security Academy の "DOM XSS in innerHTML sink using source location.search" ラボを内蔵ブラウザで開く。脆弱コードは次の形だ（出典: Academy ラボ writeup）。

   ```javascript
   function doSearchQuery(query) {
       document.getElementById('searchMessage').innerHTML = query;   // sink
   }
   var query = (new URLSearchParams(window.location.search)).get('search');  // source
   if (query) {
       doSearchQuery(query);
   }
   ```

7. **カナリアを注入する**。検索フォームにカナリアを貼って検索する（または URL の `search` パラメータにカナリアを付ける）。DOM ビューに `element.innerHTML`（ランク 21、`htmlSinks`）が現れるはずだ。
8. **コンテキストを判定する**。`Outer HTML` 列で囲みの `div` を確認する。カナリアの後ろに follow-up 文字 `\ < > ' " :` を足して、`<` `>` がエンコードされずに残るか見る。
9. **ペイロードを組む**。`innerHTML` は `<script>` を受け付けないので、`img` に `onerror` を付ける。

   ```javascript
   element.innerHTML='... <img src=1 onerror=alert(document.domain)> ...'
   ```

   検索フォーム／URL パラメータに `<img src=1 onerror=alert(document.domain)>` を入れて実行を確認する。
10. **コードパスを確認する（応用）**。急にシンクに届かなくなったら、DOM ビューの `Stack Trace` 列のリンク → `Console` タブ → 一番上のリンク → `Sources` タブの順でクライアント JS に飛び、手前の条件分岐を読む。
11. **web message を試す（応用）**。設定で `Postmessage interception` を ON → `Reload`。`Messages` ビューでメッセージをクリックし、`data` を編集して `Send`。脆弱なら `Build PoC` で HTML PoC をクリップボードに得る。
12. **prototype pollution を試す（応用）**。設定 → `Attack types` → `Prototype pollution` を ON → `Reload`。DOM ビューの source 横の `Test` で汚染を確認し、`Scan for gadgets` でガジェットを探し、見つかった sink 横の `Exploit` で PoC を自動実行する。

---

## つまずきポイント

- **「Reload を押していない」** — DOM Invader のほぼ全設定は `Reload` しないと反映されない。設定を変えたのに挙動が変わらないときは、まず Reload を疑う。
- **「Inject forms を押したのに何も出ない」** — `Inject forms` はフォームに値を入れるだけで、**送信は手動**。フォームを自分で送信するまで結果は出ない。
- **「`<script>` が動かないから脆弱でない」と早合点** — `innerHTML` 系のシンクは `<script>` も `svg onload` も効かない。`img onerror` などに切り替える。DOM Invader のドキュメントではなく Academy のラボ説明が出典の注意点だ。
- **「DOM ビューに出なかった＝安全」と誤解** — 既定では最も面白いシンクしか instrument されず、`extensionExcludedSinks` の 11 個（`textContent`, `input.value` など）は常に対象外。出ないことは「無い」ことを意味しない。
- **「Information のメッセージを無視」** — web message は全件が最低 Information で出る。自動検出できない脆弱性がそこにある前提で、`origin` / `data` / `source` の参照状況を自分で読む。
- **「Exploit ボタンを DOM XSS で探す」** — DOM XSS 単体に Exploit ボタンは無い。`Exploit` は prototype pollution 専用、`Build PoC` は web message 専用だ。
- **「カナリアに一般語を使う」** — `test` のような語はページに自然発生して false positive を生む。既定のランダム文字列か `Randomize` を使う。
- **「リダイレクトで結果が消えた」** — 遷移でシンク一覧はクリアされる。`Redirection prevention` を有効にして同じページに留まる。
- **「`burpdomxss` が既定値だと思い込む」** — 既定はランダム生成であって固定値ではない。原典に `burpdomxss` は現れない。

---

## この節のまとめ

- DOM Invader は Burp 内蔵ブラウザにプリインストールされた **DOM XSS 専用ツール**で、Professional / Community の両方で使える。初出は 2021.7、作者は Gareth Heyes。
- 設計思想は **「DOM XSS を反射型 XSS のように探せるようにする」**。DOM を instrument して source / sink をツリー表示する。
- 既定は **OFF**（サイトの挙動を変えるから）。有効化したら **必ず `Reload`**。
- 中核は **カナリア**（任意だが区別できる英数字列）。**既定はランダム生成**で、`burpdomxss` ではない。ページに自然発生しない文字列を使う。
- シンクは **面白い順**（`sinkRanking`、値が小さいほど重要、1〜86）に並ぶ。**帯（A〜J）**で捉えると次の一手が決まる。
- シンクは **`jsSinks` / `htmlSinks` / `urlSinks` の 3 分類**で扱う。分類が決まればペイロードの形（ブレイクアウト / タグ生成 / `javascript:`）が決まる。
- 標準手順は **カナリア注入 → シンク特定 → `Outer HTML` / `Frame path` / `Event` でコンテキスト判定 → follow-up 文字（`\ < > ' " :`）でエスケープ実測 → ペイロード作成 → `Stack Trace` からコードパス確認**。
- **DOM XSS 単体に Exploit ボタンは無い**。`Build PoC` は web message、`Exploit` は prototype pollution 専用。
- `innerHTML` は `<script>` / `svg onload` が効かないので `img onerror` を使う。この注意の出典は Academy ラボ。
- **web message** は Proxy（ログ）/ Repeater（改変再送）/ Scanner（自動プローブ）のアナロジーで理解する。全件 Information で出る＝安全ではない。origin 偽装で `startsWith` / `endsWith` 検証を暴く。
- **prototype pollution** は source 検出（4 手法）→ `Test` で確認 → `Scan for gadgets` → `Exploit` で PoC 自動実行、の流れ。ガジェットは「サニタイズされずシンクに渡るユーザ制御プロパティ」。
- **DOM clobbering** はブラウジング中ずっとスキャンする。
- false negative の主因は「既定で instrument されないシンク」「リダイレクトでの一覧消失」「`Permissions-Policy` によるブロック」「手動送信が必要な `Inject forms`」。
- **AutoVader** は DOM Invader を Playwright で自動運転し、検出を Burp の issue にする。スキャン種別は手動機能とほぼ 1 対 1。
- 実績として、作者自身が DOM Invader で **PayPal の DOM XSS** を発見している（一次情報）。

---

## 理解度チェック

1. DOM Invader の設計思想を一言で表すと何か。
   ▶ 答え: 「DOM XSS を反射型 XSS のように探せるようにする」こと。DOM を instrument して source / sink をツリー表示し、入力がどの危険な関数に届いたかを目視できるようにする。

2. カナリアの既定値は `burpdomxss` か。
   ▶ 答え: 違う。既定は**ランダムに生成された文字列**である。原典に `burpdomxss` は一切現れない。ページに自然発生しない文字列を使うことが公式に推奨されている。

3. `sinkRanking` で値が小さいシンクと大きいシンクは、どちらが重要か。
   ▶ 答え: 値が小さいほど重要（"The lower the value, the more important the sink is."）。`jQuery.globalEval`=1 が最重要、`document.evaluate`=86 が最も軽い。

4. DOM ビューにあるシンクが `element.innerHTML` だった。次に打つべきペイロードの方針は。
   ▶ 答え: `htmlSinks` なのでタグを作れるか（`<` `>`）を確かめる。`<script>` は効かないので、`Outer HTML` で囲みを確認したうえで `<img src=1 onerror=alert(document.domain)>` のようにイベントハンドラを使う。

5. XSS コンテキストの判定に使う 3 つの列は何か、それぞれ何が分かるか。
   ▶ 答え: `Outer HTML`（カナリアを囲む HTML 要素＝ブレイクアウトに要る閉じタグが分かる）、`Frame path`（カナリアがシンクに渡るフレーム＝iframe 内の脆弱性を識別）、`Event`（カナリアがシンクに渡るときに起きる JS イベント＝click 等が必要かが分かる）。

6. 「DOM ビューに出なかったから、このシンクには届いていない」と結論してよいか。
   ▶ 答え: よくない。既定では最も面白いシンクだけが instrument され、`extensionExcludedSinks` の 11 個（`textContent`, `input.value` など）は常に対象外。出ないことは「無い」ことを意味しない。

7. web message で「全メッセージが最低 Information で出る」ことの含意は。
   ▶ 答え: Information だからといって安全ではない。DOM Invader が自動検出できない脆弱性がそこにあるかもしれない、という公式の警告。`origin` / `data` / `source` の参照状況を自分で読む必要がある。

8. `Exploit` ボタンと `Build PoC` ボタンは、それぞれどの機能に付くか。DOM XSS 単体には。
   ▶ 答え: `Exploit` は prototype pollution（ガジェット発見後）、`Build PoC` は web message に付く。**DOM XSS 単体にはどちらも無く**、ペイロードを自分で組む必要がある。

9. prototype pollution のガジェットとは何か。
   ▶ 答え: 適切にサニタイズされずにシンクへ渡される、ユーザ制御可能なプロパティのこと。source があってもガジェットが無ければ悪用できない。`Scan for gadgets` で自動探索する。

10. AutoVader の `Inject into all sources & click everything` は、DOM Invader のどの設定に対応するか。
    ▶ 答え: `Auto-fire events` 設定（ページ読込時に全要素へ click / mouseover を自動発火）に対応する。click イベントが起きたときだけシンクに届く脆弱性を捕まえるためのもの。

---

## 出典

- Introducing DOM Invader: DOM XSS just got a whole lot easier to find（PortSwigger Blog, Gareth Heyes, 2021-06-30）: https://portswigger.net/blog/introducing-dom-invader
- Burp Suite Documentation — Testing for DOM XSS: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
- Burp Suite Documentation — DOM Invader（enabling / web-messages / prototype-pollution / dom-clobbering / settings 各ページ）: https://portswigger.net/burp/documentation/desktop/tools/dom-invader
- Web Security Academy — DOM-based vulnerabilities: https://portswigger.net/web-security/dom-based
- Web Security Academy — DOM-based XSS ラボ群（lab-innerhtml-sink 含む）: https://portswigger.net/web-security/cross-site-scripting/dom-based
- PortSwigger/autovader（README, Gareth Heyes）: https://github.com/PortSwigger/autovader
- $500 Bounty by Escalating DOM XSS to Stored XSS（Medium, 2023、原典未検証の二次情報）: https://medium.com/@rodriguezjorgex/escalating-dom-xss-to-stored-xss-eb6f3a669af3

<!-- sources: https://portswigger.net/blog/introducing-dom-invader, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss, https://portswigger.net/burp/documentation/desktop/tools/dom-invader, https://portswigger.net/web-security/dom-based, https://portswigger.net/web-security/cross-site-scripting/dom-based, https://github.com/PortSwigger/autovader, https://medium.com/@rodriguezjorgex/escalating-dom-xss-to-stored-xss-eb6f3a669af3 -->
<!-- terms: DOM Invader, DOM XSS, ソース（source）, シンク（sink）, カナリア（canary）, Augmented DOM, DOM ビュー, プロトタイプ汚染（prototype pollution）, DOM clobbering, web message（postMessage）, ガジェット（gadget）, sinkRanking, follow-up 文字, instrument, 内蔵ブラウザ（embedded browser）, AutoVader, ブレイクアウト, false positive, false negative -->
<!-- self-read: https://portswigger.net/blog/introducing-dom-invader | portswigger.net が egress プロキシで遮断され、画像 4 枚・冒頭 YouTube 動画・research channel の PayPal DOM XSS 記事が取得できない -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss | portswigger.net が遮断され、3 枚のスクリーンショット（特に dom-invader-unescaped-chars.png）が取得できない -->
<!-- self-read: https://medium.com/@rodriguezjorgex/escalating-dom-xss-to-stored-xss-eb6f3a669af3 | medium.com が遮断され本文を検証できない二次情報・未検証 -->
<!-- self-read: https://portswigger.net/web-security/dom-based | portswigger.net が遮断され source/sink の最新公式一覧とラボ本体が取得できない -->
