## postMessageハンドラの列挙と検証ロジック評価

クライアントサイド攻撃面のマッピングにおいて、`postMessage` の受信ハンドラは見落とされやすく、かつ高インパクトなDOM-based XSS・情報漏えいへ直結しやすい対象である。本節では、防御・診断の観点から「ページ内にどんな `message` 受信ハンドラが存在するか」を体系的に列挙する手法と、そのハンドラが行う**検証ロジック（origin 検証・型検証・値検証）が本当に堅牢か**を評価する方法を、仕組みのレベルで解説する。

> 本節はすべて防御・自己所有環境での診断を目的とする。実在サービスや本番環境への無許可検証、破壊的な手順は扱わない。以降のコード例は、いずれも自分で立てた検証用ページ（`http://localhost` など自己管理下のオリジン）で挙動を確認する前提とする。

### なぜ postMessage が攻撃面になるのか（前提の整理）

まず用語をかみ砕く。**オリジン（origin）**とは「スキーム + ホスト名 + ポート」の組（例: `https://app.example.com:443`）であり、ブラウザのセキュリティ境界の単位である。通常、あるオリジンのスクリプトは別オリジンの `document` や変数へアクセスできない。これが**同一オリジンポリシー（Same-Origin Policy, SOP）**である。

`window.postMessage()` は、この SOP を意図的に「安全に越える」ために用意された API で、あるウィンドウ（親ページ・別タブ・`iframe` など）から別のウィンドウへ、構造化データを非同期に送るための仕組みである。送信側の構文は次の通り。

```javascript
targetWindow.postMessage(message, targetOrigin, [transfer]);
```

- `targetWindow`: 送信先ウィンドウの参照（`iframe.contentWindow`、`window.opener`、`window.parent`、`window.open()` の戻り値など）。
- `message`: 送るデータ本体。構造化クローンアルゴリズムでコピーされるためオブジェクトも送れる。
- `targetOrigin`: 「このオリジンに向けてのみ配送してよい」という宛先指定。`"*"`（ワイルドカード）を指定すると**どのオリジンが受信側にいても送ってしまう**。
- `transfer`: 所有権を移譲する転送可能オブジェクト（`ArrayBuffer` など）。省略可。

受信側は `message` イベントを購読する。

```javascript
window.addEventListener("message", (event) => {
    // event.data   … 送られてきたデータ本体
    // event.origin … 送信元のオリジン（ブラウザが付与する、偽装不能な値）
    // event.source … 送信元ウィンドウの参照
});
```

ここで**攻撃面が生まれる本質的な理由**は2つある。

1. **`event.data` は攻撃者が完全に制御できる入力である。** 攻撃者が用意した任意のページを被害者に開かせ、そのページから被害者オリジンのウィンドウ（`iframe` に読み込んだり `window.open` で開いたり）へ `postMessage` を送れる。受信ハンドラが `event.data` を **sink（入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`・`eval`・`location.href`）** へ渡していれば、攻撃者はその値を操作してコード実行や画面改ざんを引き起こせる。
2. **`event.origin` の検証を書くのは開発者の責任であり、ブラウザは強制しない。** 受信ハンドラが origin を確認しない、あるいは緩い文字列マッチで確認していると、攻撃者オリジンからのメッセージが「信頼済み」として処理されてしまう。

つまり postMessage の脆弱性ハンティングは、突き詰めると「**どのハンドラが存在し（列挙）**」「**そのハンドラの origin 検証と値の扱いが正しいか（検証ロジック評価）**」の2軸に集約される。以降、この2軸を順に扱う。

> 出典: An Introduction to postMessage Vulnerabilities（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities

### 第1軸: message 受信ハンドラの列挙

ハンドラは「静的（ソースコードを読む）」と「動的（実行中のブラウザで観測する）」の両面から洗い出す。片方だけでは、難読化・遅延登録・サードパーティSDK内の登録などを取りこぼす。

#### 静的探索: ソースコード内のパターン検索

読み込まれるすべての JavaScript（インラインスクリプト、外部 `.js`、バンドル済みチャンク、サードパーティSDK）を対象に、次のパターンを検索する。

```text
addEventListener('message',      // 標準的な登録
addEventListener("message",
window.onmessage =                // プロパティ代入形式
.on("message", ...)              // jQuery など一部ライブラリの糖衣
postMessage(                      // 送信側。宛先や送信データの手がかりになる
```

見つけたハンドラでは、`event.data`（あるいは分割代入された `data`・`e.data`）が**どこへ流れるか**、つまりデータフローを追跡する。`event.data → 変数 → 関数引数 → sink` という経路の終端に危険な代入先がないかを確認するのが要点だ。

> 注意: 難読化・minify されたコードでは `addEventListener` の第1引数が変数化されていたり、`n.addEventListener(t,r)` のように短縮されていることがある。静的検索だけに頼らず、必ず動的探索を併用する。

#### 動的探索(1): DevTools の Global Listeners / Event Listener Breakpoints

Chrome/Chromium 系 DevTools では、実行中に登録済みハンドラを直接列挙できる。手順は次の通り（対象は自己管理下の検証ページ）。

1. DevTools を開く（F12）。
2. **Sources**（Debugger）タブを開く。
3. 右側パネルの **Global Listeners**（またはページ選択時の Event Listeners）を展開する。
4. `message` プロパティを展開すると、登録されている `message` ハンドラの一覧と、それぞれの登録元スクリプト位置（ファイル・行）が表示される。
5. さらに、**Event Listener Breakpoints** の中の `Window` → `message`（`DOMWindow.message`）にブレークポイントを設定すると、メッセージ受信のたびに実行が一時停止する。停止時点で `event.data`・`event.origin`・`event.source` の実際の値をスコープ上で確認でき、ハンドラがどの分岐をどう通るかをステップ実行で追える。

この「受信のたびに止めて中身を見る」やり方は、遅延登録される（例: SDK 読み込み後に登録される）ハンドラや、条件分岐で処理が分かれるハンドラの検証ロジックを、実物の値で観察できるため特に有用である。

#### 動的探索(2): addEventListener のモンキーパッチ（フック）

登録の瞬間そのものを捕捉したい場合は、`addEventListener` を自前の関数で包む（**モンキーパッチ**＝実行時に既存関数を差し替えて挙動を観測する手法）。検証ページのコンソールで、対象スクリプトが読み込まれる**前**に次を実行しておく。

```javascript
// 自己管理下の検証ページでのみ実行する観測用スニペット
const _orig = window.addEventListener;
window.addEventListener = function (type, listener, options) {
    if (type === "message") {
        console.log("[message listener registered]", listener.toString());
    }
    return _orig.call(this, type, listener, options);
};
```

これにより、`message` ハンドラが登録されるたびに**そのハンドラ関数のソース**（`listener.toString()`）がコンソールに出力される。難読化されていても関数本体が読めるため、origin 検証の有無や sink への流れを即座に確認できる。

同様に、送信側を観測したい場合は `window.postMessage`（および `iframe.contentWindow.postMessage`）を包み、どんなデータがどの `targetOrigin` へ送られているかを記録する。ワイルドカード `"*"` 送信の検出にはこれが直接役立つ。

#### 補助ツール

手作業の列挙を補助するツール群も知られている。用途を理解した上で使うとよい。

- **Burp Suite の DOM Invader**: ページ内の postMessage トラフィックを監視し、ハンドラを検出、XSS 観点での自動テストも行う。
- **postMessage-Tracker（Chrome 拡張）** / **PMHook（Tampermonkey ベースのロギング）**: すべての postMessage 通信を origin 付きでログする。
- **MessPostage / Posta**: メッセージの列挙・可視化・再送を支援する調査用ツール。
- **Untrusted Types 系拡張**: データが危険な sink まで流れる経路を追跡する。

> ツールはあくまで列挙とデータフロー可視化の補助であり、最終的な「検証ロジックが正しいか」の判断は人間が行う。ツールの検出結果を鵜呑みにせず、必ずハンドラのソースと実際の値で裏取りする。

> 出典: Exploiting PostMessage Vulnerabilities（Intigriti） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities

### 第2軸: 検証ロジックの評価

列挙したハンドラごとに、次の観点で検証ロジックを評価する。核心は「**origin 検証**」と「**`event.data` の扱い（型・値・sink）**」である。

#### パターンA: origin 検証が存在しない

最も基本的かつ危険なパターン。ハンドラが `event.origin` を一切確認せず、`event.data` を sink へ渡す。

```javascript
// 脆弱: origin 検証なし、data を location.href（sink）へ
window.addEventListener("message", function (event) {
    const data = event.data;
    location.href = data.redirect_url;
});
```

なぜ危険か。`location.href` は `javascript:` スキームの URL を代入されると、そのJavaScriptを現在のオリジンのコンテキストで実行し得る sink である。origin 検証がないため、攻撃者は任意ページから被害者ウィンドウへ次のように送るだけで成立する。

```javascript
// 攻撃者ページ側（原理説明用。検証は自己管理下のみ）
const targetFrame = document.getElementById('target');
targetFrame.contentWindow.postMessage({
    type: 'oauth_callback',
    success: true,
    token: 'sample token',
    return_url: 'javascript:alert(document.domain)'
}, '*');
```

同種の最小例として、`href` 属性を組み立てるだけでもXSSになり得る。

```javascript
// 脆弱: 受信側 2.html — origin 検証なしで href を組み立てる
window.addEventListener("message", (event) => {
    document.getElementById("redirection").href = `${event.data.url}`;
});
```

```html
<!-- 攻撃者ページ 3.html（原理説明用）: 脆弱ページを iframe に読み込み、値を注入 -->
<iframe id="frame" src="2.html"></iframe>
<script>
    let msg = { url: "javascript:prompt(1)" };
    var iFrame = document.getElementById("frame");
    iFrame.contentWindow.postMessage(msg, '*');
</script>
```

`event.data.url` が `javascript:prompt(1)` になり、その値が `<a>` の `href` に入る。リンクがクリック（またはプログラム的に発火）されると、`javascript:` URL が被害者オリジンで実行される。ここでの本質は「**origin 検証がないため攻撃者オリジンからの `event.data` を信頼してしまう**」点と、「**`href` という sink が `javascript:` を解釈してしまう**」点の掛け合わせである。評価時は、この2条件が同時に成立していないかを確認する。

> 出典: PostMessage Vulnerabilities Part I（Jorge Lajara） — https://jlajara.gitlab.io/Dom_XSS_PostMessage

#### パターンB: origin 検証が「緩い」文字列マッチ

origin 検証を書いてはいるが、比較方法が甘いケース。ここが**検証ロジック評価で最も差がつく**ポイントである。`indexOf`・`startsWith`・`includes`・アンカーのない正規表現は、いずれもバイパス可能な典型である。

```javascript
// 脆弱: 部分一致（indexOf）による検証 → 偽陽性
if (event.origin.indexOf('example.com') !== -1) {
    location.href = event.data.redirect_url;
}
```

なぜバイパスできるのか。`indexOf('example.com') !== -1` は「文字列 `example.com` を**どこかに含む**か」を見るだけである。したがって攻撃者は次のようなオリジンを用意すれば通過する。

- `https://example.com.attacker.io` … `example.com` を部分文字列として含む（サブドメイン風に見せた**攻撃者所有ドメイン**）。
- `https://attacker-example.com` … 同じく部分一致する。

同様に危険なパターンを整理する。

| 検証コード | バイパス例 | 理由 |
|---|---|---|
| `origin.indexOf('example.com') !== -1` | `https://example.com.attacker.io` | 部分文字列としてどこにでも含めばよい |
| `origin.startsWith('https://example.com')` | `https://example.com.attacker.io` | 先頭一致は「その後に続く任意文字列」を許す |
| `origin.endsWith('example.com')` | `https://attackerexample.com` | 末尾一致は境界（`.`）を見ない |
| `origin.includes('example.com')` | `https://example.com.evil.tld` | `indexOf` と同型 |
| `/^https:\/\/payments\.example\.com/` | `https://payments.example.com.attacker.io` | 末尾を `$` でアンカーしていない正規表現 |

正規表現の例をもう少し掘り下げる。`/^https:\/\/payments\.example\.com/` は「先頭が `https://payments.example.com`」だけを要求し、**末尾を固定していない**。よって `https://payments.example.com.attacker.io` は先頭部分が一致するため通過する。加えて、正規表現内で `.` をエスケープし忘れる（`payments.example.com` を `payments\.example\.com` にしていない）と、`.` が任意1文字にマッチし、`paymentsXexampleXcom` のようなドメインでも通ってしまう。評価時は「**アンカー（`^` と `$`）の有無**」と「**メタ文字のエスケープ**」を必ず確認する。

正しい実装は、部分一致ではなく**完全一致（厳密等価）**である。

```javascript
// 安全: 厳密等価で origin を検証
if (event.origin !== 'https://trusted-origin.com') {
    return; // 期待オリジン以外は即座に破棄
}
// ここから先で event.data を処理する
```

複数オリジンを許可する必要がある場合も、部分一致ではなく**許可リスト（allowlist）への完全一致包含**で判定する。

```javascript
// 安全: 許可リストへの完全一致
const ALLOWED = ["https://app.example.com", "https://admin.example.com"];
if (!ALLOWED.includes(event.origin)) return;
```

> 検証ロジック評価のチェックリスト:（1）`event.origin` を参照しているか、（2）比較は `===`/`!==` あるいは配列 `.includes(origin)` の**完全一致**か、（3）`indexOf`/`startsWith`/`endsWith`/アンカーなし正規表現を使っていないか、（4）`event.origin` ではなく `event.data` 内の自己申告フィールド（例: `data.sender`）で送信元を判断していないか（`event.data` は偽装自在なので送信元判定に使ってはならない）。

> 出典: Exploiting PostMessage Vulnerabilities（Intigriti） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities

#### パターンC: 送信側のワイルドカードによる情報漏えい

これまでは受信側の話だったが、**送信側**にも別種の脆弱性がある。`targetOrigin` に `"*"` を指定すると、送信先ウィンドウがどのオリジンに遷移していても、そのデータが配送される。機密データ（トークン等）を `"*"` で送っていると、盗聴される。

```javascript
// 脆弱: OAuth トークンを任意オリジンへ送信
iframe.contentWindow.postMessage({
    type: 'oauth_callback',
    token: 'sensitive_token_here'
}, '*'); // ワイルドカード = どの受信側でも受け取れる
```

```javascript
// 攻撃者ページ: 自分が受信側になれれば盗聴できる
window.addEventListener("message", function (event) {
    if (event.data.type === 'oauth_callback') {
        console.log('Token:', event.data.token); // 漏えい
    }
});
```

仕様上の警告として「悪意あるサイトが、あなたの知らぬ間にウィンドウの location を変更し、データを傍受し得る」ことが挙げられている。`iframe` に読み込んだページが攻撃者オリジンへ遷移したり、`window.open` した先が別オリジンだったりすると、`"*"` 送信はそのままそこへ届く。評価時は「機密を含む送信で `targetOrigin` が `"*"` になっていないか」を確認し、必ず**具体的な期待オリジン**を指定させる。

```javascript
// 安全: 送信先オリジンを明示
child.postMessage(msg, 'https://target-domain.com');
```

> 出典: An Introduction to postMessage Vulnerabilities（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities ／ PostMessage Vulnerabilities Part I（Jorge Lajara） — https://jlajara.gitlab.io/Dom_XSS_PostMessage

#### 主要な sink の一覧と、なぜ危険か

origin 検証を通過（または不在）した `event.data` が、最終的にどこへ流れるかを評価する。以下は代表的な危険 sink である。

- `innerHTML` / `outerHTML`: HTML 文字列として解釈される。`<img src=x onerror=...>` 等でスクリプト実行に至る（`<script>` 直挿しは実行されないが、イベントハンドラ属性経由で実行される）。
- `eval()` / `Function()`: 文字列をそのままJavaScriptとして実行する。最も直接的。
- `document.write()`: ドキュメントにHTMLを書き込み、解釈させる。
- `location.href` / `location` 代入: `javascript:` スキームでコード実行、または任意リダイレクト。
- `setAttribute()` によるイベントハンドラ属性（`onclick` 等）や `href`/`src` の設定: `javascript:` や `data:` 経由の実行。

評価の原則は、「**信頼できない `event.data` を、これらの sink へ、無害化（サニタイズ・エスケープ・スキーム検証）なしに渡していないか**」である。

### 検証ロジック評価の実践フロー（まとめ）

診断・防御レビューでは、次の順で機械的に確認するとよい。

1. **列挙**: 静的検索（`addEventListener('message'`, `onmessage`）＋ 動的観測（Global Listeners / Event Listener Breakpoints / `addEventListener` フック）で、すべての `message` ハンドラを洗い出す。
2. **origin 検証の有無**: 各ハンドラで `event.origin` を参照しているか。参照なしなら**パターンA**（要修正）。
3. **origin 検証の厳密性**: 参照ありでも、`indexOf`/`startsWith`/`endsWith`/`includes`/アンカーなし正規表現なら**パターンB**（バイパス可）。完全一致・許可リストのみ可とする。
4. **送信元判定の取り違え**: `event.data` 内の自己申告値で送信元を判断していないか（偽装自在なので不可）。
5. **データフローと sink**: `event.data` が `innerHTML`/`eval`/`document.write`/`location.href`/`setAttribute` 等へ、無害化なしに流れていないか。
6. **送信側のワイルドカード**: 機密送信で `targetOrigin` が `"*"` になっていないか（**パターンC**）。

#### 安全な受信ハンドラのリファレンス実装

評価の到達点として、堅牢なハンドラの形を示す。origin の厳密検証 → データ形式の検証 → 安全なAPIの使用、の3段で構成する。

```javascript
window.addEventListener("message", (event) => {
    // 1) origin を厳密に検証（完全一致）
    if (event.origin !== "https://trusted-origin.com") return;

    // 2) データ形式（型・スキーマ）を検証
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    if (data.type !== "expected_type") return;

    // 3) sink へ渡す前に値を検証・無害化
    //    例: URL は許可スキーム（http/https）に限定し、javascript: を排除
    const url = String(data.url || "");
    if (!/^https?:\/\//.test(url)) return;      // javascript:/data: を弾く
    document.getElementById("redirection").href = url;
    //    HTML を扱う場合は innerHTML ではなく textContent、
    //    あるいは DOMPurify 等でサニタイズする
});
```

この形が満たすのは、YesWeHack・Intigriti・Jorge Lajara の各資料が共通して挙げる原則、すなわち「**不要な message リスナーは置かない／期待オリジンを明示する（送受信とも `"*"` を避ける）／処理前に `event.origin` を検証する／受信データの構文・型を検証する／危険な DOM API に信頼できない入力を渡さない**」である。列挙で見つけた各ハンドラを、この基準に照らして一つずつ評価していくのが、postMessage 攻撃面マッピングの実務となる。

> 出典: An Introduction to postMessage Vulnerabilities（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities ／ Exploiting PostMessage Vulnerabilities（Intigriti） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities ／ PostMessage Vulnerabilities Part I（Jorge Lajara） — https://jlajara.gitlab.io/Dom_XSS_PostMessage
