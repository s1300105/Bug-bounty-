# postMessage 脆弱性ハンティングの実践手順とツール

> **この節で分かること**
> - `window.postMessage()` がなぜ存在し、どんな仕組みでウィンドウ間通信を成立させるのかを説明できる。
> - 対象サイトの JavaScript から message ハンドラを DevTools やブラウザ拡張で発見する手順を自分でできる。
> - オリジン検証の不備や緩い部分文字列一致など、典型的な脆弱コードのパターンを見分けられる。
> - `event.data` が危険な sink に流れ込む経路を追い、iframe / window.open を使った PoC を組み立てられる。
> - postMessage-tracker・FancyTracker・Posta という3つの主要ツールの役割と使いどころを説明できる。
> - 単なる「オリジン未検証」を実害まで連鎖させ、受理されるレポートに仕上げる考え方を説明できる。

**元資料**:
- https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities （原典は取得できず二次情報ベース）
- https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities （原典は取得できず二次情報ベース）
- https://github.com/fransr/postMessage-tracker （原典取得済み・README 全文）
- https://github.com/Zeetaz/FancyTracker （原典取得済み・README 全文）
- https://github.com/benso-io/posta （原典取得済み・README 全文）

**関連する節**: DOM-based XSS、同一オリジンポリシー、クリックジャッキング、OAuth の各節

> **重要な但し書き**: この節の元になった YesWeHack と Intigriti の2本のガイド記事は、本教科書の執筆環境（ネットワークの外向き通信制限）から HTML 本文を1バイトも取得できなかった。したがって、その2本に対応する記述は検索スニペットと要約から再構成した**二次情報**であり、コードやペイロードの逐語一致は保証できない。逐語で確実なのは GitHub の3つのツール README のみである。攻撃コードを実際に使う前に、必ず読者自身で原典を開いて裏を取ってほしい（節内の📌ブロックと出典を参照）。

---

## 1. postMessage とは何か（なぜ存在するのか）

### 1.1 同一オリジンポリシーの「安全な抜け道」

同一オリジンポリシー（Same-Origin Policy, SOP）とは、あるオリジン（スキーム＋ホスト＋ポートの組）のページが、別オリジンのページの中身やデータへ勝手に触れないようにするブラウザの基本ルールのこと。たとえば `https://a.example` の JavaScript が `https://b.example` の iframe の中身を直接読むことはできない。

しかし現実のアプリでは、親ページと iframe、ポップアップと元ウィンドウのように、**別オリジン同士でどうしても連携したい**場面がある。決済ウィジェット、ソーシャルログイン、埋め込み地図などがその例だ。

`window.postMessage()` は、この「別オリジン同士で安全にメッセージを送りたい」という需要に応えるために用意されたメソッドである。SOP の制約を**安全に回避する手段**を提供する、というのが設計意図だ。

### 1.2 実装を誤ると脆弱性になる

postMessage は「安全に」越境するための仕組みだが、実装が適切でないと（"If postMessage() is not implemented properly"）、次のような脆弱性につながる。

- クロスサイトスクリプティング（Cross-Site Scripting, XSS）
- 機微データの露出（Sensitive Data Exposure）
- 情報の窃取（Information Theft）

これらの検出は単純ではない。JavaScript を読む力が要り、対象アプリのスクリプトを読んで潜在的な攻撃ポイントを特定し、実行フローを追いかけて攻撃を成立させる必要がある。逆に言えば、コードを読める人にとっては宝の山になりやすい領域だ。

### 1.3 通信の典型パターン

〔補足〕どのウィンドウ同士がやり取りするのかを整理しておく。

```
親ページ ──iframe.contentWindow.postMessage(...)──▶ 子iframe
親ページ ◀──window.parent.postMessage(...)──────── 子iframe

opener ──w.postMessage(...)──▶ window.open() で開いた新タブ(openee)
opener ◀──window.opener.postMessage(...)── openee
```

親ページが iframe を埋め込んで `iframe.contentWindow.postMessage(...)` で子へ送り、子は `window.parent.postMessage(...)` で親へ返す。`window.open()` の場合は、その戻り値（開かれた側＝openee）と `window.opener`（開いた側＝親）で双方向にやり取りする。別タブ・別ウィンドウ間や Web Worker との通信でも使われる。

### 1.4 送信側の構文

〔二次情報・逐語不確実〕送信側は次の形でメッセージを送る。

```text
targetWindow.postMessage(message, targetOrigin, [transfer])
```

| 引数 | 意味 |
| --- | --- |
| `targetWindow` | メッセージを受け取る window オブジェクト。例: `iframe.contentWindow`, `window.opener`, `window.open()` の戻り値 |
| `message` | 送るデータ。構造化クローンできる任意の値（文字列・オブジェクトなど） |
| `targetOrigin` | 配送を許可するオリジン。機密性が不要なら `"*"`（ワイルドカード）も指定できるが、`"*"` は機密性を無効化するため非推奨。正しくは期待するオリジンを明示する（例: `"https://trusted.example.com"`） |
| `transfer`（任意） | 所有権を移譲する Transferable オブジェクトの配列 |

ここで覚えておきたいのは、`targetOrigin` は「送信を許可する宛先」を絞る仕組みだという点。`"*"` にすると「誰が受け取ってもよい」となり、中身が機密なら攻撃者のフレームにも届いてしまう。

### 1.5 受信側（メッセージハンドラ）

〔二次情報・逐語不確実〕受信側は `message` イベントを購読する。イベントオブジェクトの主要プロパティは次の3つだ。

| プロパティ | 意味 | 攻撃上の位置づけ |
| --- | --- | --- |
| `event.data` | 送られてきたペイロード本体 | HTML5 の postMessage が導入した新しい taint source（汚染源）。未検証で sink に渡ると DOM XSS |
| `event.origin` | 送信元のオリジン | 送信者の正当性は必ずこの origin で検証する（"Always verify the sender's identity using the origin"） |
| `event.source` | 送ってきた window への参照 | 返信に使える。攻撃時は返信でトークンを盗む経路にもなる |

taint source（汚染源）とは、攻撃者が値を注入できる入り口のこと。`event.data` に何が入ってくるかは送信側次第なので、ここを信用せずに扱うのが鉄則になる。

〔補足〕安全な受信の基本形は次のとおり。

```js
window.addEventListener("message", function (event) {
  // 安全な実装ではここで event.origin を厳密に検証する
  if (event.origin !== "https://trusted.example.com") return;
  // さらに event.data の構造・型・値を検証してから使う
});
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: An Introduction to postMessage Vulnerabilities（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の外向き通信制限で全経路が 403）。以下の構文・ハンドラ・ペイロードの記述は検索スニペットと要約にもとづく二次情報で、逐語やコードの完全一致は未確定である。
> **読みどころ**:
> 1. postMessage の構文と受信ハンドラの**完全なコード例**（本節の構文は逐語未確定なので現物で確認する）。
> 2. ハンドラ発見手順の**スクリーンショット**（DevTools の Global Listeners → messages、グローバル検索キーワード）。
> 3. 緩いオリジン検証（`indexOf`/`includes`）を突く**実際のペイロード**（`javascript:...//http:` 系）。
> 4. PoC HTML の**完全な雛形**（iframe onload / window.open）。
> 5. 記事末尾の**推奨対策（remediation）チェックリスト**。
> **代替手段**: 旧ミラー https://blog.yeswehack.com/yeswerhackers/introduction-postmessage-vulnerabilities/ 、Wayback Machine、archive.today でのスナップショット取得。

---

## 2. message ハンドラを発見する（どこで受けているかを突き止める）

バグハンティングの第一歩は「対象がどこで message を受けているか」を突き止めることだ。ここでは DevTools の機能とブラウザ拡張の両面から発見手法を並べる。

### 2.1 DevTools のグローバル検索

〔二次情報〕最も手軽なのは、DevTools のグローバル検索（複数の JS ファイルを横断して文字列を探す機能）で次のキーワードを検索する方法だ。

```text
postMessage(
addEventListener("message
.on("message
```

ヒットした箇所から、ハンドラ本体・オリジン検証・sink を読んでいく。まず「受信している場所」を洗い出すのが目的である。

### 2.2 DevTools の Event Listener 表示（Global Listeners / messages）

〔二次情報〕DevTools の「Sources」ペインにある **Global Listeners**（グローバルリスナー）機能で `postMessage()` の使用箇所を特定できる。Global Listener を開いて **"messages"** をクリックすると、登録済みの message ハンドラを一覧表示できる。

〔補足〕Chrome では Elements パネル右側の「Event Listeners」タブでも、選択した要素や `window`（Ancestors 表示）に紐づく `message` リスナーを確認できる。`Remove` や `framework listeners` フィルタで表示を整理できる。

### 2.3 コンソールで `getEventListeners(window)`

〔二次情報〕Chrome DevTools のコンソールで次を実行すると、`window` に登録された全イベントリスナーが返る。

```js
getEventListeners(window)
```

返ってきたオブジェクトの `message` キーの配列を見れば、登録済みハンドラ関数と（可能なら）定義位置が分かる。

〔補足〕`getEventListeners()` は DevTools のコマンドライン API 専用関数で、通常のページ JavaScript からは呼べない。iframe 内のリスナーを見るには、DevTools 右上のフレーム選択で対象フレームのコンテキストに切り替えてから実行する。

### 2.4 Event Listener Breakpoints（DOMWindow message ブレークポイント）

〔二次情報〕postMessage が送受信された瞬間で実行を止めたいときは、Event Listener Breakpoints を使う。手順は次のとおり。

1. DevTools を開く（F12、macOS では Option + Cmd + C）。
2. **Sources タブ（Chrome）／ Debugger タブ（Firefox）** に移動する。
3. **DOMWindow の `message` イベント**にブレークポイントを追加する。
4. これで postMessage が送受信されるたびにデバッガが一時停止し、**メッセージデータ・origin・source を検査**できる。
5. **コールスタックを辿って**メッセージがどこで処理されるかを正確に把握し、コードをステップ実行して脆弱性を特定する。

この方法は、サードパーティスクリプトや動的にロードされるコードに**隠れたハンドラ**を見つけるのに特に有用だ。検索では引っかからない、実行時に登録されるリスナーを捕まえられる。

### 2.5 ブラウザ拡張・専用ツール

DevTools だけでなく、専用ツールを併用すると発見効率が上がる。両ガイドとツール本家 README から整理した一覧を示す。

| ツール | 種別 | 主機能 |
| --- | --- | --- |
| postMessage-tracker | Chrome拡張 | 現在ウィンドウのリスナー数をアイコン表示。全サブフレームを追跡。短命リスナーや操作で有効化されるリスナーも捕捉。Log URL で関数と位置をログ。console 上で window 間のやり取りを replay 可能なパス付きで表示。Raven/New Relic/Rollbar/Bugsnag/jQuery ラッパーを "unpack" |
| FancyTracker | Chrome拡張(MV3) | postMessage-tracker の Manifest V3 後継。全フレーム/オリジンのリスナーをソースコードとスタックトレース付きで表示。dedupe（既定ON）、独自ルールで危険語/安全語を色分け、minify コードの整形、code/URL・Regex によるフィルタ/ブロック、JSON import/export、外部ロギング |
| Fransyfox | Firefox拡張 | postMessage-tracker の Firefox 版適応（FancyTracker ベース）。作者/リポジトリ提供者は GangGreenTemperTatum |
| PwnFox | Firefox/Burp拡張 | PostMessage Logger 機能を含む |
| Posta | Chrome拡張＋ツール | Cross-document Messaging の調査ツール（enso.security）。4ペイン構成（Tabs / Messages / Console / Exploit）。改変リプレイと window.open 経由のエクスプロイトに対応 |
| PMHook | スクリプト/フック | ページ読込直後に `EventTarget.addEventListener` をラップし、追加される message ハンドラと受信メッセージをログ |
| MessPostage | ブラウザ拡張 | アプリが postMessage() を使ったことを簡単に検出 |
| DOM Invader | Burp内蔵ブラウザ拡張 | postMessage トラフィックを監視しハンドラを特定。カナリア値をメッセージに注入して XSS を自動テスト。危険 sink をハイライトしフローを可視化 |
| DOMLogger++ | Caido拡張 | クライアントサイド脆弱性ハンティング用（YesWeHack の PimpMyCaido 記事で紹介） |

これらのツールの詳しい使い方は後半の第7章でツールごとに扱う。ここでは「発見のためにこれだけの選択肢がある」ことを押さえてほしい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Exploiting PostMessage Vulnerabilities: Advanced Exploitation Guide（Intigriti） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の外向き通信制限で全経路が 403）。`getEventListeners` や Event Listener Breakpoints、DOM Invader の操作手順は二次情報にもとづく要約である。
> **読みどころ**:
> 1. `getEventListeners(window)` と Event Listener Breakpoints（DOMWindow message）の**具体的操作手順・スクショ**。
> 2. **DOM Invader によるカナリア注入の自動 XSS テスト**の手順と、危険 sink のハイライト表示。
> 3. **エクスプロイト作成の完全な手順**（遅延送信、`event.source` への返信、`"*"` の使い分け）。
> 4. **実バグバウンティ事例のコード付き解説**（Facebook OAuth トークン窃取、DeFi 管理者侵害、OAuth+postMessage+Clickjacking の ATO 連鎖）。
> 5. **DOMPurify の落とし穴**（既定で `data-*` 許可、`FORBID_ATTR` 既定は id/class/style のみ）の詳細。
> **代替手段**: 旧ブログ https://blog.intigriti.com/ 内を "postMessage" で検索、Wayback Machine、archive.today。

---

## 3. 典型的な脆弱コード（どこを突くのか）

message ハンドラを見つけたら、次は「そのハンドラが脆弱かどうか」を判定する。脆弱パターンは大きく3つある。

### 3.1 オリジンを一切検証しない

〔二次情報〕コードが送信者の origin を検証しないと、**任意のオリジンからメッセージを送れる**（"The code doesn't validate the sender's origin ... the message can be sent from any origin"）。攻撃者は自分の支配下のドメインから、標的のポップアップや iframe に悪性メッセージを送れる。

〔補足〕危険な最小例を示す。

```js
window.addEventListener("message", (e) => {
  document.getElementById("out").innerHTML = e.data; // originもdataも未検証 → DOM XSS
});
```

`origin` を見ていないので誰でも送れ、`e.data` をそのまま `innerHTML` に入れているので、送った HTML/スクリプトがそのまま実行される。これが最も分かりやすい脆弱形だ。

### 3.2 緩い部分文字列一致（indexOf / includes / startsWith）

〔二次情報・重要〕やや厄介なのが「検証しているつもりで甘い」パターンだ。ハンドラがオリジンをチェックしてはいるが、その判定が「値のどこかに `http:` や `https:` が現れればよい」程度に緩いケースがある。

この場合、**`javascript:` URL の中にコメントとして `http:` を潜ませる**ことで検証を通過できる。`http:` という部分文字列がフィルタを満たしつつ、実体はコメント内に留まり、`javascript:` URL が標的オリジンで `print()` を実行する、という理屈だ。代表的なペイロードは次の形になる。

```text
javascript:print()//http:
```

前半の `javascript:print()` が実行したいコードで、`//` から後ろは JavaScript のコメント。そこに `http:` を書いておくと、緩いオリジンチェックは「`http:` が含まれるからOK」と誤判定する。

教訓は明確だ。オリジン検証は `indexOf` / `includes` / `startsWith` や正規表現の部分一致ではなく、**`===` による完全一致**（またはホスト名の厳密一致）で行うべきである。

### 3.3 送信側 targetOrigin にワイルドカード `*`

〔二次情報〕機密性が不要ならブラウザは `targetOrigin` に `"*"` を許すが、**`"*"` は機密性を無効化する**。開発者は「Web の動的な性質から具体的な target origin を知るのが難しい」という理由で `"*"` を使いがちだ。

結果として、意図しないオリジン（攻撃者が制御するフレームなど）にメッセージ内容（トークンなど）が漏れうる。3.1・3.2 が「受信側の甘さ」なのに対し、これは「送信側の甘さ」で、情報漏えいの原因になる。

### 3.4 参考統計

〔二次情報〕Alexa Top 10,000 を対象にした調査で、オリジンチェックの欠如や誤りにより**84 ドメインがエクスプロイト可能**だったとする研究が引用されている。postMessage は `event.data` という新しい taint source を生み、それが安全に扱われないと DOM-based XSS になる、という点をこの数字が裏づけている。

---

## 4. 危険な sink（データの流入先）

sink（シンク）とは、汚染された値が最終的に流れ込む「実行や描画を引き起こす場所」のこと。`event.data` が検証・エスケープされずに sink に渡ると、XSS などが発生する。

### 4.1 代表的な sink 一覧

〔二次情報：ガイドで列挙された sink〕

| 分類 | sink |
| --- | --- |
| HTML 挿入 | `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setAttribute` |
| フレーム／スクリプト | `iframe` の `src`・`srcdoc`、`script` の `src`・`text` |
| コード評価 | `eval`, `Function`（`new Function(...)`）, `setTimeout`, `setInterval` |

`setTimeout` / `setInterval` が sink 扱いされるのは、**第1引数に文字列を渡した場合のみ**である。文字列を渡すとその文字列が `eval` 相当でコードとして実行されるため、`event.data` が文字列としてここに流れ込むと XSS になる。逆に第1引数に**関数を渡した場合はコードとして評価されない**ので、この意味では危険にならない。つまり「タイマー関数だから危険」なのではなく、「文字列を第1引数に渡したときだけ」危険になる、という条件を押さえておく。

### 4.2 sink の種類でインパクトが変わる

〔補足〕上記に加え、`document.write`、`location` / `location.href` / `location.assign` / `location.replace`（`javascript:` スキームで XSS、または任意リダイレクト）、`element.src`、jQuery の `$(...)` / `.html()`、`WebSocket` / `fetch` / `XMLHttpRequest` の URL なども sink になりうる。

重要なのは、どの sink に届くかで結果（インパクト）が変わることだ。

- `innerHTML` や `eval` 系 → DOM XSS（任意 JS 実行）
- `location` 系 → オープンリダイレクト、または `javascript:` で XSS
- `fetch` / `XHR` の URL 改ざん → 情報の送信先すり替え（SSRF 的挙動、トークン漏えい）

「`event.data` がどの sink に着地するか」を追い切ることが、インパクトの見積もりに直結する。

---

## 5. エクスプロイト（PoC）HTML の書き方

脆弱なハンドラと sink を特定したら、攻撃者ページから悪性メッセージを送る PoC を組む。基本は「iframe に埋め込む」か「window.open で開く」かの2択だ。

### 5.1 iframe を使うパターン

〔二次情報〕攻撃者ページに標的をロードする `iframe` を置き、`onload` で `contentWindow.postMessage()` に悪性ペイロードを送る。3.2 の `http:` バイパスと組み合わせた代表例は次の形だ。

```html
<iframe src="https://<LAB-ID>.web-security-academy.net/"
        onload="this.contentWindow.postMessage('javascript:print()//http:','*')"></iframe>
```

〔補足〕標的の初期化に時間がかかりハンドラ登録が遅れる場合は、`setTimeout` で送信を遅らせる。

```html
<iframe id="t" src="https://target.example/vuln-page"></iframe>
<script>
  const f = document.getElementById("t");
  f.onload = () => {
    setTimeout(() => {
      f.contentWindow.postMessage("<payload>", "*"); // 攻撃者は '*' で送れる
    }, 1000);
  };
</script>
```

攻撃者は送信側なので `targetOrigin` に `"*"` を自由に使える点に注目してほしい。「`*` を使うと機密が漏れる」のは正規の開発者の話で、攻撃側にとっては単に送りやすいだけである。

### 5.2 window.open を使うパターン

〔二次情報〕`window.open()` で標的ページを開き、背後のリクエスト完了を待つために**遅延後に**悪性データを postMessage で送る。

〔補足〕`iframe` 埋め込みが `X-Frame-Options` や `frame-ancestors` の CSP でブロックされる標的では、`window.open`（ポップアップ）方式が有効になる。

```js
const w = window.open(url);
setTimeout(() => {
  w.postMessage(payload, "*");
}, 1000);
```

ただしポップアップはユーザー操作（クリック）を起点にしないとブラウザにブロックされやすい点に注意する。後述する Posta の "Open as tab" 機能は、まさにこの window.open 方式を UI として提供している。

### 5.3 攻撃成立の条件整理

〔補足〕整理すると、次の両方が満たされたときに刺さる。

1. 標的側の受信ハンドラが origin を検証しない、または検証が緩い。
2. `event.data` を危険な sink に渡している。

逆に、標的が `event.origin` を完全一致で検証していれば、攻撃者オリジンからの直接送信は弾かれる。その場合は、信頼されたフレームを乗っ取る・オープンリダイレクトで信頼オリジンから送らせる、といった別経路が必要になる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: PortSwigger Web Security Academy「Controlling the web message source」 — https://portswigger.net/web-security/dom-based/controlling-the-web-message-source
> **なぜ**: 本教科書の執筆環境から `portswigger.net` は取得できなかった（理由: サイト側の外向き通信制限で 403）。上記 5.1 のペイロードはこのラボ系の代表例にもとづく要約である。
> **読みどころ**:
> 1. `postMessage('javascript:print()//http:','*')` を実際に動かす**ハンズオン・ラボ**。
> 2. iframe `onload` から送信する PoC の**組み立て手順**。
> 3. 緩いオリジンチェックがなぜバイパスされるのかの**仕組み解説**。
> **代替手段**: HackTricks（https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html ）、MDN の `Window.postMessage()` 公式ドキュメント（https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage ）。

---

## 6. 実際のバグバウンティ事例

〔二次情報〕Intigriti の記事と Bug Bytes 連載から、postMessage がどこまで大きな被害につながったかを示す事例を紹介する。いずれも「postMessage 単体」ではなく、実害まで連鎖させている点が共通する。

| 事例 | 概要 |
| --- | --- |
| Facebook OAuth トークン窃取 | postMessage の不備により、Facebook OAuth フローを使う脆弱アプリのユーザーアクセストークンを誰でも盗める可能性があった。堅牢な標的で長期間（最大10年規模）存在したとされる |
| DeFi プラットフォームの管理者侵害 | 制限のない postMessage XSS を突いて管理者アカウントを完全侵害し、**不正送金**まで到達。他のクライアントサイド不備と連鎖して critical になった |
| OAuth CSRF + postMessage + クリックジャッキングの連鎖 | 3つを組み合わせてアカウント乗っ取り（Account Takeover, ATO）に至った。ATO 級インパクトには連鎖が要ることを示す |
| Tumblr / Verizon Media の postMessage XSS | よく書かれた write-up。研究者はコードの該当部分にコメントを付けてバグに至る流れを説明している（Bug Bytes #79 で紹介） |

〔補足〕Intigriti の Bug Bytes 連載は postMessage 系を継続的に取り上げている。Frans Rosén の postMessage-tracker 公開（Bug Bytes #69）、DOM Invader 登場（Bug Bytes #130）、postMessage XSS tips（Bug Bytes #158）などが代表例だ。

---

## 7. インパクトとレポートの書き方

### 7.1 単独では受理されにくい

〔二次情報〕重要な現実として、**単なる「オリジン未検証」「ワイルドカード targetOrigin」だけでは、多くのバグバウンティプログラムで単独脆弱性として受理されにくい**。実際の悪用（DOM-based 脆弱性、情報漏えい、サービス妨害など）まで連鎖させ、**動作する PoC** を付ける必要がある。

### 7.2 レポートに含めるべき要素

レポートには次の5点を含める。

1. **脆弱なハンドラの所在**（ファイル/行、`addEventListener("message")` の場所）。
2. **欠けている/緩いオリジン検証**の具体箇所。
3. **`event.data` が流れる sink**（`innerHTML` など）。
4. **攻撃者ページ**（iframe / window.open の PoC HTML）。
5. **実際に起きる結果**（`print()` / `alert()` 実行、トークン奪取、なりすまし操作など）。

### 7.3 インパクトの説明軸

| インパクト | 説明 |
| --- | --- |
| DOM XSS | 任意 JS 実行 → セッション/トークン窃取、なりすまし操作、UI 改ざん |
| 機微情報の漏えい | `"*"` 送信や `event.source` への返信で、トークン/PII が攻撃者オリジンへ渡る |
| なりすまし操作（forged actions） | オリジン未検証のハンドラが「認証済みユーザーの代理で」取引・設定変更を実行してしまう |
| 連鎖 | OAuth / クリックジャッキング / XS-Leaks と組み合わせて ATO まで引き上げる |

---

## 8. 安全な実装・防御（どう守るのか）

〔二次情報＋補足〕攻撃者視点で読んできたが、レポートの remediation 欄に書く防御策も押さえておく。

### 8.1 受信側の鉄則

- **`event.origin` を厳密な allowlist と完全一致で検証**してから `event.data` を使う。部分一致（`indexOf`/`includes`/`startsWith`/緩い正規表現）は禁止。
- **`event.data` は必ず検証・サニタイズ**する。構造・型・許可値をチェックし、HTML として使うなら DOMPurify などでサニタイズする。

### 8.2 DOMPurify の落とし穴

〔二次情報・重要〕サニタイズに DOMPurify を使っても、設定次第で穴が残る。

- DOMPurify は**既定で `data-*` 属性を許可**する。
- `FORBID_ATTR`（禁止属性）の既定は `id`, `class`, `style` のみ。

したがって独自の `data-*` 属性は制限なく注入され得る。用途に応じて `FORBID_ATTR` / `ALLOWED_ATTR` を適切に設定しないと、多層防御のつもりでも悪用が残る。

### 8.3 送信側と多層防御

- **機微な操作で `"*"` を使わない**。送信側 `targetOrigin` は期待オリジンを明示する。
- **多層防御**として入力検証＋出力エンコーディング＋CSP を併用する。ただし CSP 単体では postMessage 由来の危険 sink を塞ぎきれない場合がある。

〔補足〕さらに実務的には、`event.source` を保持して正しい相手にのみ返信する、メッセージに**型タグ / nonce** を付けてプロトコルを固定する、`JSON.parse` は try/catch で囲む、といった実装が推奨される。

### 8.4 併読したい一次・二次資料

ここまでの仕組みと防御は、次の2本を読むとより正確に裏取りできる。いずれも本教科書の執筆環境からは取得できなかったので、読者は自分のブラウザで開いてほしい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: MDN `Window.postMessage()` 公式ドキュメント — https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage ／ HackTricks「PostMessage Vulnerabilities」 — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html
> **なぜ**: 本教科書の執筆環境から両サイトとも取得できなかった（理由: `developer.mozilla.org`・`hacktricks.wiki` ともに外向き通信制限で 403 を実測）。本節の構文・引数・セキュリティ注意やバイパス手法の記述は、これらを逐語では引用しておらず、二次情報と一般知識にもとづく要約である。
> **読みどころ**:
> 1. MDN では `postMessage()` の**正確な引数仕様**と、公式が明記する**セキュリティ上の注意**（`targetOrigin` を `"*"` にしない、受信側で `origin` を必ず検証する）を確認する。
> 2. HackTricks では、**オリジン検証バイパスの具体パターン**（`indexOf`/`search`/正規表現の甘さ、`e.origin` の書き換え不能性など）と、**実践的な PoC 断片**を確認する。
> 3. 本節で「二次情報」と断った箇所（構文・ペイロード）を、この2本で突き合わせて裏を取る。
> **代替手段**: MDN はローカライズ版（/ja/ パス）や Wayback Machine、HackTricks は GitHub ミラー（github.com/HackTricks-wiki）でも参照できる。

---

## 9. 主要ツール詳解（README 逐語ベース）

ここからは README を逐語取得できた3つのツールを、実務上の使いどころとともに解説する。前半（第2章）の一覧より一段深い内容だ。

### 9.1 postMessage-tracker（Frans Rosén）

Frans Rosén が作った Chrome 拡張で、OWASP AppSec Europe 2018 の講演「Attacking modern web technologies」で発表され、2020年5月に正式公開された。README には講演の録画（YouTube: https://www.youtube.com/watch?v=oJCCOnF25JU ）とスライド（SpeakerDeck: https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies ）へのリンクも記載されており、拡張の背景を知りたければこの2本が一次資料になる。README（逐語取得）から要点を挙げる。

- 現在ウィンドウの message リスナー数を**アイコンで表示**する。
- 全サブフレームのリスナーを追跡する。
- **短命リスナー**や**操作（interaction）で有効化されるリスナー**も捕捉する。iframe 内で一瞬だけ有効になる隠れリスナーを発見できる。
- **Log URL** オプションで、リスナー関数と位置を外部エンドポイントに記録し、後からまとめて精査できる。設定は `chrome://extensions` の Extension Options から行う。
- console 上で window 間のやり取りを表示し、**replay 可能なパス**を提示する。ここで言う `diffwin` とは、console 上で「今見ているウィンドウとは別のウィンドウ」を指し示すためにこの拡張が用意した識別子（キーワード）のことである。送信者または受信者として `diffwin` を指定すると、同一ウィンドウ内だけでなく**異なるウィンドウ間**でやり取りされる通信も追跡・再送（replay）できる。
- Raven / New Relic / Rollbar / Bugsnag / jQuery の**ラッパーを "unpack"** して、ラップ越しに本当のリスナーを表示する。
- 匿名関数は Chrome が stringify できないため `bound` と表示される。

〔補足・既知の問題〕README には、`document.contentType` が `application/xml` のとき（Chrome が XML を描画するとき）はコンテンツスクリプトが DOM に注入されない、という既知の制約が記されている。

### 9.2 FancyTracker（Zeetaz）

postMessage-tracker の **Manifest V3 対応版（後継）**。README は「基本ロジックと機能は踏襲しつつ大幅に近代化・機能追加した」と述べる。危険 sink の色分けなど、ハンティングに直結する機能が増えている。

#### インストール（Unpacked）

README の手順を逐語で示す。

```text
1. Clone or download this repo
2. Go to `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the "chrome" folder
```

Firefox 版は別リポジトリ FancyTracker-FF（https://github.com/Zeetaz/FancyTracker-FF ）にあり、Mozilla の Add-Ons でも配布されている。

#### 主な機能

| 機能 | 内容 |
| --- | --- |
| Listener Detection | 全フレーム/オリジンの postMessage リスナーを監視し、**ソースコードとスタックトレース**を表示 |
| Deduplication（既定ON） | 同一ソースの同一リスナーを1回だけ表示 |
| Code Prettify | minify された JS を整形（キャッシュ付きで大きなコードも処理） |
| Syntax Highlighting | highlight.js に加え、**独自ルールで危険語・安全語を色分け** |
| Filtering & Blocking | コードや URL でリスナーをブロック、"Show Active"/"Show Blocked" 切替、既知拡張（wappalyzer, domlogger）をハードコードでフィルタ |
| Regex Filtering | 正規表現によるリスナーのフィルタにも対応 |
| Import/Export | ブロックリストを JSON で保存・共有 |
| External Logging | 全検出リスナーを自前サーバへ送信 |
| Settings | コードブロックの**フォントサイズ**、および展開トリガー（自動で折りたたむ **max lines / code length** のしきい値）を手動で調整できる |

危険語ハイライトのルールは README に逐語例がある。

```text
[red] innerHTML, eval [green] origin, trusted
```

このように「赤で危険 sink（`innerHTML`, `eval`）、緑で安全側の語（`origin`, `trusted`）」を指定でき、大量のリスナーコードの中から**危険 sink を素早く目視**できる。これは第4章で見た sink 探しを実務で加速する機能だ。

#### 拡張ラッパー展開（Extended Wrapper Detection）

FancyTracker は、元祖が展開しなかった多数のラッパーライブラリも "unwrap" する。

- エラー監視系: LogRocket, Honeybadger, TrackJS, Raygun, Errorception
- フレームワーク系: Angular Zone.js, Vue.js, React
- 汎用パターン: セッションリプレイ、パフォーマンス監視、アナリティクス

ライセンスは MIT（Frans Rosén の原作にもとづく adaptation）。

#### 実務上の制約（To-Do / 既知の不具合）

README の「To-Do」節と補足には、実務で知っておくと役立つ制約がいくつか書かれている。

- **拡張のブロックリストは現状ハードコード**で、UI 設定から編集できるようにするのは今後の予定（To-Do）。
- **カスタムのハイライト適用後に UI が強制リロードされる不具合**が特定の状況で起きる。回避策は「すぐ反映されないときは拡張を一度開き直す」こと（作者は「大した問題ではない」としている）。
- **SPA（Single Page Application）への対応は現状不十分**で、より良い SPA サポートは将来対応するかもしれないが未定、と注記されている。動的に画面が切り替わるアプリを対象にするときは、この制約を念頭に置く。

### 9.3 Posta（enso.security）

**Posta** は Cross-document Messaging（＝postMessage 通信）の**追跡・探索・エクスプロイト**を行う調査ツール。任意の接続ブラウザ内で**ウィンドウ間メッセージのリプレイ**ができる。README（逐語取得）から、4ペインのワークフローを解説する。

#### 前提とインストール

```text
Prerequisites:
* Google Chrome / Chromium
* Node.js (optional)
```

Chrome 拡張として使う手順は README のとおり。`git clone https://github.com/benso-io/posta.git` の後、`chrome://extensions` で Developer mode を有効化し、**Load unpacked** で `chrome-extension` ディレクトリを読み込む。開発環境（`npm install` → `npm start`）ではローカルの検証サイトとエクスプロイトページ（`http://localhost:8080/exploit/`）も立ち上がる。

#### 4ペインのワークフロー

```
[Tabs] ──選ぶ──▶ 対象 Origin と、その iframe 群
   │
[Messages] ── Origin ⇄ iframe の全 postMessage を検査
   │            Listeners 領域に受信ハンドラのコードが出る（コピー可）
   │
[Console] ── 元メッセージを改変してリプレイ（Origin→iframe）
   │            挙動が変われば別オリジンからの悪用へ
   │
[Exploit] ── iframe 化を試す → XFO でダメなら "Open as tab"(window.open)
                で通信参照を得て、右のコンソールでペイロードを送る
```

各ペインの役割を README にもとづいて整理する。

| ペイン | 役割 |
| --- | --- |
| Tabs | メインの Origin と、それがホスト/通信する iframe 群を表示。フレームを選ぶとそのフレームの postMessage だけを観察できる |
| Messages | Origin ↔ iframe 双方向の全トラフィックを検査。**Listeners** 領域に受信ハンドラのコードが表示され、クリックしてコピーし精読できる |
| Console | 元の postMessage を**改変してリプレイ**。値を変えて挙動が変わるか試し、変えられたら別オリジンからの悪用（"Simulate exploit"）へ進む |
| Exploit | "host" ボタンでエクスプロイト画面へ。まず対象を iframe 化しようとするが、多くは **X-Frame-Options** で不可 → **"Open as tab"（`window.open`）** で通信参照を獲得し、右のコンソールで組んだペイロードを **Exploit** ボタンでクロスオリジン送信する |

Posta の実務的な価値は、5.2 節で説明した「iframe 埋め込みが XFO/CSP で不可でも window.open 経由で通信参照を得る」という手順を、UI として組み込んでいる点にある。手で書く PoC の流れがそのままツールになっていると考えるとよい。

作者は Chen Gour Arie / Barak Tawily / Gal Nagli / Omer Yaron（enso.security）。

---

## 手を動かす

以下は、自分で立てた検証環境や、参加中のバグバウンティで許可された対象に対してのみ行うこと。

1. **ハンドラを探す**: 対象ページで DevTools を開き、コンソールで `getEventListeners(window)` を実行する。返ってきた `message` キーに何が入っているかを確認する。空なら、グローバル検索で `addEventListener("message` を検索する。
2. **リスナーの中身を読む**: DevTools の Sources → Global Listeners → "messages" を開き、リスナー関数のソースへ飛ぶ。`event.origin` を検証しているか、していれば `===` か `includes`/`indexOf` かを確認する。
3. **sink を追う**: そのハンドラ内で `event.data` がどこへ渡るかを目で追う。`innerHTML`, `eval`, `location`, `setTimeout` などに着地していれば脆弱性の候補だ。FancyTracker を入れているなら、危険語ハイライトに `[red] innerHTML, eval [green] origin, trusted` を設定して色で探す。
4. **ブレークポイントで止める**: Sources タブの Event Listener Breakpoints で DOMWindow の `message` にチェックを入れ、ページを操作して停止させ、コールスタックで処理経路を確認する。
5. **PoC を書く**: 自分の検証サイトに次のような攻撃者ページを置き、`onload` で悪性メッセージを送る。

```html
<iframe id="t" src="https://target.example/vuln-page"></iframe>
<script>
  const f = document.getElementById("t");
  f.onload = () => {
    setTimeout(() => {
      f.contentWindow.postMessage("javascript:print()//http:", "*");
    }, 1000);
  };
</script>
```

6. **iframe 化できないとき**: 対象が `X-Frame-Options` で iframe 埋め込みを拒否したら、Posta を入れて "Open as tab"（window.open）で通信参照を取り、Console ペインでペイロードを組んで Exploit ボタンから送る。
7. **レポートにまとめる**: 7.2 の5要素（ハンドラの所在／緩い検証／sink／PoC HTML／実際に起きる結果）を揃える。`alert()` 止まりではなく、可能なら情報漏えいやなりすましまで示す。

---

## つまずきポイント

- **「オリジン未検証」を単独で報告して却下される**: 多くのプログラムは実害の PoC を求める。DOM XSS・情報漏えい・なりすましのいずれかまで連鎖させること。
- **`getEventListeners()` がページの JS から呼べない**: これは DevTools コマンドライン API 専用の関数で、通常のスクリプトからは使えない。コンソールで実行する。
- **iframe 内のリスナーが見えない**: DevTools 右上のフレーム選択で対象フレームのコンテキストに切り替えてから `getEventListeners(window)` を実行する。
- **`includes` を「ちゃんと検証している」と誤読する**: `includes`/`indexOf`/`startsWith` は部分一致であって完全一致ではない。`javascript:print()//http:` のようにコメントへ `http:` を潜ませて突破できる。
- **短命リスナーを見逃す**: 一瞬だけ登録されるリスナーは検索やスナップショットでは捕まらない。postMessage-tracker / FancyTracker は短命・操作起点のリスナーも追跡できる。
- **ポップアップがブロックされる**: `window.open` はユーザー操作（クリック）起点でないとブラウザに止められやすい。PoC はボタンクリックから開く形にする。
- **DOMPurify を入れたから安全と思い込む**: 既定で `data-*` 属性を許可し、`FORBID_ATTR` 既定は `id`/`class`/`style` のみ。設定を詰めないと穴が残る。
- **原典コードを逐語だと思い込む**: 本節の YesWeHack / Intigriti 由来のペイロードは二次情報である。攻撃コードは必ず原典と自分の検証で裏を取る。

---

## この節のまとめ

- `window.postMessage()` は SOP を安全に越えてウィンドウ間通信を行うための仕組みで、実装を誤ると XSS・情報漏えい・情報窃取につながる。
- 通信は親子 iframe、opener/openee、別タブ間などで発生し、送信は `targetWindow.postMessage(message, targetOrigin, [transfer])`、受信は `message` イベントで行う。
- 受信ハンドラの3つの鍵は `event.data`（汚染源）、`event.origin`（検証すべき送信元）、`event.source`（返信先）。
- ハンドラ発見手法は、グローバル検索、Global Listeners → messages、`getEventListeners(window)`、Event Listener Breakpoints（DOMWindow message）、専用拡張の5系統。
- 脆弱コードは大別して、(1) オリジン未検証、(2) 緩い部分文字列一致（`includes`/`indexOf`）、(3) 送信側 `targetOrigin` の `"*"` の3つ。
- 緩い検証の代表バイパスは `javascript:print()//http:`。`http:` をコメントに潜ませて部分一致を通す。
- 危険 sink は `innerHTML`/`eval`/`setTimeout`/`location` など。どの sink に着地するかでインパクト（XSS・リダイレクト・情報漏えい）が変わる。
- PoC は iframe の `onload` からの送信が基本で、iframe 化できない標的には window.open 方式を使う。攻撃者は送信側なので `targetOrigin` に `"*"` を自由に使える。
- Alexa Top 10,000 の調査で 84 ドメインがオリジンチェックの不備で悪用可能だったとされる。
- 実害事例には Facebook OAuth トークン窃取、DeFi 管理者侵害、OAuth+postMessage+クリックジャッキングの ATO 連鎖、Tumblr/Verizon Media の XSS がある。
- 単独のオリジン未検証は受理されにくく、実害まで連鎖した動作する PoC が必要。
- 防御は origin の完全一致 allowlist、`event.data` の検証・サニタイズ、`"*"` の回避、多層防御。DOMPurify は `data-*` 許可などの設定に注意。
- ツールは、リスナー発見に postMessage-tracker / FancyTracker（危険語色分け・MV3）、検査から改変リプレイ・エクスプロイトまで通せる Posta が代表的。
- YesWeHack / Intigriti の2本は本教科書環境で取得できず、対応記述は二次情報。攻撃コードは原典で裏取りすること。

---

## 理解度チェック

1. postMessage が「同一オリジンポリシーの安全な抜け道」と呼ばれるのはなぜか。
   ▶ 答え: SOP により別オリジンのページのデータへ直接触れられない中で、決済ウィジェットやソーシャルログインのように別オリジン間で連携したい需要に応え、宛先オリジンを指定して安全にメッセージだけを渡す手段を提供するため。

2. 受信ハンドラで攻撃者が値を注入できる「汚染源」はどのプロパティか。また必ず検証すべきプロパティは何か。
   ▶ 答え: 汚染源は `event.data`。必ず検証すべきは `event.origin`（送信元オリジン）。

3. オリジン検証を `includes("http:")` のような部分一致で書くとなぜ危険か。突破ペイロードの例を挙げよ。
   ▶ 答え: 部分一致は「どこかに `http:` があればOK」と誤判定するため、`javascript:print()//http:` のように `javascript:` URL のコメント内へ `http:` を潜ませると検証を通過し、標的オリジンでコードが実行される。完全一致（`===`）で検証すべき。

4. `event.data` が `innerHTML` に着地する場合と `location.href` に着地する場合で、想定インパクトはどう変わるか。
   ▶ 答え: `innerHTML` は HTML/スクリプト注入による DOM XSS になりやすい。`location.href` は `javascript:` スキームで XSS になるか、任意のオープンリダイレクトになる。sink の種類でインパクトが変わる。

5. iframe 埋め込みが `X-Frame-Options` でブロックされる標的に対して、どんな送信方式が使えるか。
   ▶ 答え: `window.open()`（ポップアップ）で標的を開き、その参照に `postMessage` を送る方式。Posta では "Open as tab" として UI 化されている。ただしポップアップはユーザー操作起点が必要。

6. `getEventListeners(window)` を使うときの制約を2つ挙げよ。
   ▶ 答え: (1) DevTools のコマンドライン API 専用関数で、通常のページ JavaScript からは呼べない。(2) iframe 内のリスナーを見るには、DevTools のフレーム選択で対象フレームのコンテキストへ切り替える必要がある。

7. 「オリジン未検証」だけを報告してもバグバウンティで受理されにくいのはなぜか。何を添えるべきか。
   ▶ 答え: 多くのプログラムは実際の悪用を求めるため。DOM XSS・情報漏えい・なりすましなどの実害まで連鎖させ、動作する PoC を添える必要がある。

8. FancyTracker が postMessage-tracker から強化した点を、危険 sink 探索に関して1つ挙げよ。
   ▶ 答え: `[red] innerHTML, eval [green] origin, trusted` のような独自ルールでリスナーコード中の危険語・安全語を色分けでき、大量のコードから危険 sink を素早く目視できる。

9. DOMPurify を入れても穴が残りうる、README/記事で指摘された設定上の落とし穴は何か。
   ▶ 答え: DOMPurify は既定で `data-*` 属性を許可し、`FORBID_ATTR` の既定が `id`/`class`/`style` のみであるため、独自 `data-*` 属性が制限なく注入されうる。`FORBID_ATTR`/`ALLOWED_ATTR` を適切に設定する必要がある。

10. 攻撃者が PoC で `targetOrigin` に `"*"` を使えるのはなぜか。開発者にとっての `"*"` の危険とどう違うか。
    ▶ 答え: 攻撃者は送信側であり、宛先を絞る必要がない（むしろ届けばよい）ので `"*"` を自由に使える。一方、正規の開発者が機密を含むメッセージに `"*"` を使うと、意図しない攻撃者フレームにも内容が届き情報漏えいになる。同じ `"*"` でも送信側の立場で意味が逆になる。

---

## 出典

- YesWeHack「An Introduction to postMessage Vulnerabilities」: https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities （原典未取得・二次情報。ミラー: https://blog.yeswehack.com/yeswerhackers/introduction-postmessage-vulnerabilities/ ）
- Intigriti「Exploiting PostMessage Vulnerabilities: Advanced Exploitation Guide」: https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities （原典未取得・二次情報）
- postMessage-tracker（Frans Rosén）README: https://github.com/fransr/postMessage-tracker
- FancyTracker（Zeetaz）README: https://github.com/Zeetaz/FancyTracker （Firefox 版: https://github.com/Zeetaz/FancyTracker-FF ）
- Posta（enso.security）README: https://github.com/benso-io/posta
- PortSwigger Web Security Academy「Controlling the web message source」: https://portswigger.net/web-security/dom-based/controlling-the-web-message-source （読者側で参照）
- HackTricks postMessage vulnerabilities: https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html
- MDN `Window.postMessage()`: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage

<!-- sources: https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities, https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities, https://github.com/fransr/postMessage-tracker, https://github.com/Zeetaz/FancyTracker, https://github.com/benso-io/posta, https://portswigger.net/web-security/dom-based/controlling-the-web-message-source, https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html, https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage -->
<!-- terms: postMessage, 同一オリジンポリシー, event.origin, event.data, event.source, targetOrigin, taint source, sink, DOM-based XSS, オリジン検証, 部分文字列一致バイパス, Event Listener Breakpoints, getEventListeners, Global Listeners, postMessage-tracker, FancyTracker, Posta, DOM Invader, PwnFox, DOMPurify, X-Frame-Options, window.open, iframe, Cross-document Messaging, アカウント乗っ取り -->
<!-- self-read: https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities | サイト側の外向き通信制限で全経路が403、二次情報ベース -->
<!-- self-read: https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities | サイト側の外向き通信制限で全経路が403、二次情報ベース -->
<!-- self-read: https://portswigger.net/web-security/dom-based/controlling-the-web-message-source | portswigger.netが403で取得不可、ラボは読者側で実施 -->
<!-- self-read: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage | developer.mozilla.orgが403で取得不可、公式仕様は読者側で参照 -->
<!-- self-read: https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html | hacktricks.wikiが403で取得不可、バイパス手法は読者側で参照 -->
