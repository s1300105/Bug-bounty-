# HTML5が持ち込んだブラウザAPIを安全に使う — OWASP HTML5 Security Cheat Sheet 精読（通信・ストレージ・iframe・WebSocket）

> **この節で分かること**
> - OWASP HTML5 Security Cheat Sheet が「攻撃手順書」ではなく「安全な実装のためのチェックリスト」であり、その各項目の否定形がそのまま診断項目になることを説明できる。
> - `postMessage`・CORS・Server-Sent Events・WebSocket・Web Storage・IndexedDB・Web Workers・sandbox iframe それぞれで、攻撃者がどこを突き、開発者がどう守るのかを自分で説明できる。
> - オリジン検証を「完全一致（allow-list）」で書くべき理由と、`indexOf`／部分一致がなぜ危険かを実例で説明できる。
> - Reverse Tabnabbing 対策（`rel="noopener noreferrer"` など）と sandbox iframe の制限トークンの基本を自分で書ける。
> - すでに主要ブラウザから削除された機能（Web SQL Database、Application Cache、Flash など）を見分け、現行の代替（IndexedDB、Service Worker + Cache API）へ読み替えられる。
> - 現行版から独立した WebSocket Security Cheat Sheet の推奨事項（WSS 必須、Origin 検証、CSWSH 対策、`JSON.parse()`、`maxPayload` など）を一通り把握できる。

**元資料**: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html （原典は描画版が取得できず、同リポジトリの正典 Markdown `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md` を取得済み。両者は MkDocs のビルド入力と出力の関係で本文は同一）
**関連する節**: DOM based XSS Prevention、Cross Site Scripting Prevention、CSRF Prevention、WebSocket Security Cheat Sheet の各節

---

## 1. この節の位置づけ — HTML5 Security Cheat Sheet とは何か

### 1.1 これは「実装ガイド／チェックリスト」である

OWASP HTML5 Security Cheat Sheet は、HTML5 が持ち込んだブラウザAPI群を「安全な方法で実装するためのガイド」である。原文の導入は非常に短く、「以下のチートシートは HTML 5 を安全な方法で実装するためのガイドとして役立つ（The following cheat sheet serves as a guide for implementing HTML 5 in a secure fashion.）」とだけ述べる。

つまりこの文書は**脆弱性の悪用手順書ではなく、開発者向けのセキュア設計チェックリスト**である。ここでいうチートシート（cheat sheet）とは、要点を1枚にまとめた早見表のこと。攻撃カタログではないので、そのまま読むと「守り方の箇条書き」に見える。

### 1.2 診断側は「各項目の否定形」を探す

バグバウンティ（許可された範囲での脆弱性探索）で使うときは、視点を反転させる。**チートシートが「こうせよ」と書いている各項目の否定形が、そのまま探すべきバグになる**。

たとえば「`targetOrigin` を `*` にするな」と書いてあれば、診断側は「`postMessage(data, "*")` になっている箇所」を探す。「オリジンは完全一致で検証せよ」と書いてあれば、「`indexOf` で部分一致している箇所」を探す。この読み替えがこの節の核心である。

### 1.3 元資料の取得について

本教科書の執筆環境からは、描画版ページ `cheatsheetseries.owasp.org` へは組織のエグレスポリシーにより到達できなかった（後述の 📌 参照）。ただし、このサイトは同じ GitHub リポジトリ上の Markdown を MkDocs というツールでビルドして生成されている。そのため正典ソースの Markdown を取得すれば、本文・箇条書き・コード例は描画版と完全に同一になる。取得時点のファイルは commit `00f27a7`（2026-05-29, PR #2188）で、2026-09-18 に再取得しても md5 まで一致した（＝以降改訂なし）。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP HTML5 Security Cheat Sheet（描画版） — https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側のエグレス制限で `cheatsheetseries.owasp.org` への接続がポリシー拒否された）。以下の本文は、同一内容である正典 Markdown（`raw.githubusercontent.com` 上）にもとづく逐語要約である。
> **読みどころ**:
> 1. 本節より新しい改訂が入っていないかの確認。本節は 2026-05-29 の commit `00f27a7` 時点であり、それ以降の差分はページ下部やリポジトリのコミット履歴で確認できる。これが読者が実際に開く最大の理由である。
> 2. リンクされた兄弟チートシート（DOM based XSS Prevention、CSRF Prevention など）への導線。
> **代替手段**: 正典 Markdown を `curl -sSL "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md"` で取得すると本文が読める。

---

## 2. 全体を貫く3つの原則

個々のAPIを見る前に、チートシート全体を貫く3つの原則を押さえる。どの節も、突きつめればこの3つの言い換えである。

### 2.1 原則1: 受信したものは「データ」として扱い、コードやHTMLとして解釈しない

**なぜ**: 外部から来た文字列をコードとして実行したり HTML として DOM に挿入したりすると、DOM-based XSS（クロスサイトスクリプティング。攻撃者のスクリプトを被害者のブラウザで実行させる脆弱性）が生まれる。

**どう守る**: `eval()` を使わない。`innerHTML` ではなく `textContent` を使う。JSON は `eval()` ではなく `JSON.parse()` でパースする。

### 2.2 原則2: オリジンは完全一致で検証する

オリジン（origin）とは、スキーム（`https`）・ホスト・ポートの3つ組で表される「どこから来たか」の単位のこと。たとえば `https://app.example.com` が1つのオリジンである。

**なぜ**: 部分一致で検証すると、攻撃者が用意した紛らわしいドメインを通してしまう。

**どう守る**: 期待する完全修飾ドメイン名（FQDN）に厳密一致させる。`indexOf`・`startsWith`・雑な正規表現による部分一致は不可。`*` ワイルドカードも不可。許可リスト（allow-list）方式を使う。

### 2.3 原則3: クライアント側の保存領域に機密を置かない

**なぜ**: `localStorage` や IndexedDB は JavaScript から読めるので、XSS が1件あれば全部盗まれる。さらにディスク上のプロファイルからも読める。

**どう守る**: セッショントークン・資格情報・秘密鍵をクライアントストレージに置かない。機密でないデータにだけ使う。

```text
3原則の対応表
┌──────────────────────────┬─────────────────────────────┬────────────────────────────┐
│ 原則                     │ アンチパターン              │ 正しい書き方               │
├──────────────────────────┼─────────────────────────────┼────────────────────────────┤
│ データとして扱う         │ eval() / innerHTML          │ JSON.parse() / textContent │
│ オリジン完全一致         │ origin.indexOf(".x.com")    │ origin === "https://x.com" │
│ 機密を置かない           │ localStorage に JWT         │ httpOnly Cookie にセッション│
└──────────────────────────┴─────────────────────────────┴────────────────────────────┘
```

---

## 3. Web Messaging（`postMessage` / クロスドメインメッセージング）

### 3.1 なぜあるのか（設計意図）

Web Messaging（Cross Domain Messaging とも呼ばれる）は、**異なるオリジンのドキュメント間でメッセージを交換する手段**を提供する。たとえば親ページと、別オリジンから読み込んだ `iframe` の間でデータをやり取りする用途。過去に同じ目的で使われた数々の hack（回避策）よりも一般に安全に作られている。ただし、なお守るべき推奨事項がいくつか残る。

### 3.2 どう動くのか（仕組み）

送信側は `window.postMessage(data, targetOrigin)` を呼ぶ。受信側は `message` イベントを受け取り、`MessageEvent` オブジェクトの `origin`（送信元オリジン）と `data`（本体）を読む。原文はこれらを属性名 `origin` / `data` として参照している。〔補足〕`postMessage` の第2引数は仕様上 `targetOrigin` と呼ばれる。

### 3.3 原文の推奨事項（8項目、全て）

1. **メッセージ送信時は、期待するオリジンを第2引数として明示し、`*` を使わない。** リダイレクト等でターゲットウィンドウのオリジンが変わった後に、未知のオリジンへメッセージを送ってしまうのを防ぐため。
2. **受信側ページは「常に（always）」次の2つを行う。**（原文は always を強調）
   - 送信者の `origin` をチェックし、データが期待した場所から来ていることを検証する。
   - `data` に対して入力検証を行い、想定した形式であることを確認する。
3. **`data` を自分が制御できていると仮定しない。** 送信側ページに XSS の欠陥が1つでもあれば、攻撃者は任意の形式のメッセージを送り込める。
4. **双方のページは、交換されるメッセージを「データ」としてのみ解釈する。** `eval()` で評価したり `innerHTML` で DOM に挿入したりしてはならない（DOM-based XSS になる）。詳細は DOM based XSS Prevention Cheat Sheet を参照。
5. **要素への代入は `element.innerHTML=data;` ではなく、より安全な `element.textContent=data;` を使う。**
6. **オリジンのチェックは期待する FQDN に厳密一致させる。** 次のコードは非常に危険で期待どおり動かない（`owasp.org.attacker.com` がマッチしてしまう）。
7. **外部コンテンツ／信頼できないガジェットを埋め込み、かつユーザー制御のスクリプトを許可する必要がある場合**（これは強く非推奨）、後述の sandboxed frames を参照。

### 3.4 コード（原文のまま逐語）

安全でないオリジン検証の例（原文がアンチパターンとして提示）:

```javascript
if(message.origin.indexOf(".owasp.org")!=-1) { /* ... */ }
```

安全でない代入 / 安全な代入:

```javascript
element.innerHTML=data;   // insecure method（原文: a insecure method like）
element.textContent=data; // the safer option（原文: use the safer option）
```

なぜ 6 のコードが危険かを図で示す。

```text
message.origin.indexOf(".owasp.org") != -1  の落とし穴

  "https://www.owasp.org"        → ".owasp.org" を含む → OK（意図どおり）
  "https://owasp.org.attacker.com" → ".owasp.org" を含む → OK（攻撃者を通す！）
                        ^^^^^^^^^^^ ここに ".owasp.org" が現れてしまう

  正しい書き方:  message.origin === "https://www.owasp.org"
```

### 3.5 攻撃者はどこを突くか（診断観点）

- `postMessage(..., "*")`（第2引数が `*`、変数、あるいは `document.location.origin` 等の動的値）を使っている送信側。定番の探索対象で、しばしばトークンやユーザー情報が漏れる。
- `addEventListener("message", ...)` ハンドラで `event.origin` を一切見ていない、または `indexOf` / `startsWith` / 正規表現の部分一致で見ている（`owasp.org.attacker.com` 型のバイパス）。
- ハンドラ内で `event.data` を `innerHTML` / `document.write` / `eval` / `setTimeout(string)` / jQuery の `$()` 等に渡している。
- `event.data` を JSON として `eval()` でパースしている。
- 送信側の XSS が受信側の postMessage 経路に連鎖する構造（推奨3の脅威モデル）。

---

## 4. Cross Origin Resource Sharing（CORS）

### 4.1 なぜあるのか

CORS（Cross Origin Resource Sharing、オリジン間リソース共有）とは、あるオリジンのページが別オリジンのAPIへ `fetch`/`XMLHttpRequest` でアクセスすることを、サーバ側のヘッダで明示的に許可する仕組みのこと。既定ではブラウザの同一オリジンポリシー（Same-Origin Policy, SOP）がクロスオリジン読み取りをブロックするが、CORS ヘッダでその穴を選択的に開ける。

### 4.2 原文の推奨事項（7項目、全て）

1. **`XMLHttpRequest.open` に渡す URL を検証する。** 現在のブラウザはクロスドメインURLを許容し、これがリモートの攻撃者によるコードインジェクションにつながり得る。**絶対URL（absolute URLs）には特に注意する。**
2. **`Access-Control-Allow-Origin: *` で応答する URL に、機密のコンテンツや情報を含めない。** このヘッダは、クロスドメインでアクセスされる必要がある選ばれた URL にのみ使う。**ドメイン全体に付けない。**
3. **`Access-Control-Allow-Origin` では、選別された信頼できるドメインのみを許可する。** `*` ワイルドカードを使わず、また `Origin` ヘッダの内容を何のチェックもせず盲目的に返さない。
4. **CORS は、要求されたデータが権限のない場所へ行くことを防がない。** サーバ側で通常の CSRF 対策を行うことは依然として重要である。
5. **Fetch Standard は `OPTIONS` によるプリフライトを推奨するが、実装がこれを行わない場合がある。** そのため「通常の」（`GET` / `POST`）リクエストでも必要なアクセス制御を実施する。
6. **HTTPS のオリジンから平文 HTTP 上で受信したリクエストは破棄する**（mixed content のバグを防ぐため）。
7. **アクセス制御のチェックを `Origin` ヘッダのみに依存しない。** ブラウザは CORS リクエストで常にこのヘッダを送るが、ブラウザ外では偽装され得る。機密データ保護にはアプリケーションレベルのプロトコルを使う。

### 4.3 逐語で押さえるヘッダ・語句

| 項目 | 原文の文字列（逐語） | 原文での扱い |
| --- | --- | --- |
| 危険な許可 | `Access-Control-Allow-Origin: *` | 機密情報を含むURLに付けてはならない |
| 対象ヘッダ | `Access-Control-Allow-Origin` | 選別した信頼ドメインのみ。ドメイン全体には付けない |
| 禁止パターン | `*` wildcard / blindly return the `Origin` header content | どちらも禁止（allow-list を使う） |
| プリフライト | `OPTIONS` | Fetch Standard が推奨するが実装が送らないこともある |
| 通常リクエスト | `GET`, `POST` | これ単体でもアクセス制御を実施 |
| 参照仕様 | https://fetch.spec.whatwg.org/#http-cors-protocol | Fetch Standard の HTTP CORS protocol 節 |
| 関連チートシート | Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md | CORS は CSRF 対策の代替にならない |
| 対象API | `XMLHttpRequest.open` | 渡すURLを検証。絶対URLに特に注意 |

### 4.4 攻撃者はどこを突くか（診断観点）

- `Access-Control-Allow-Origin` に `Origin` をそのまま反射し、かつ `Access-Control-Allow-Credentials: true` が付いている構成（推奨3の直接違反）。この2つが揃うと、攻撃者サイトが被害者の Cookie 付きで認証済みレスポンスを読める。
- `Access-Control-Allow-Origin: *` を返す API が、認証不要でも「攻撃者の次の一手を助ける情報」（内部ホスト名、バージョン、ユーザー列挙材料）を返していないか（推奨2）。
- ドメイン全体・全パスに一律で CORS ヘッダが付いていないか（推奨2後段）。
- CORS を「CSRF 対策済み」と誤認している実装（推奨4）。
- プリフライト検証に依存し、単純リクエスト（`GET`/`POST` で simple content-type）でのアクセス制御が抜けていないか（推奨5）。
- HTTPS オリジンからの平文 HTTP リクエストを受け付けていないか（推奨6）。
- `XMLHttpRequest.open` の URL がユーザー入力（`location.hash` など）で組み立てられていないか（推奨1）。

---

## 5. Server-Sent Events（SSE / `EventSource`）

### 5.1 なぜあるのか・どう動くのか

SSE（Server-Sent Events、サーバ送信イベント）とは、サーバからクライアントへの単方向のストリーム配信の仕組みのこと。たとえば通知や株価のような「サーバから一方的に流れてくる更新」に使う。JavaScript 側は `EventSource` オブジェクトで購読し、`event.data`（本体）と `event.origin`（送信元）を読む。〔補足〕SSE は HTTP 上でメディアタイプ `text/event-stream` を用いるが、原文はメディアタイプに言及していない。

### 5.2 原文の推奨事項（3項目、全て）

1. **`EventSource` コンストラクタに渡す URL を検証する。** たとえ same-origin の URL のみが許可されているとしても検証する。
2. **メッセージ（`event.data`）はデータとして処理し、その内容を HTML やスクリプトコードとして評価しない。**
3. **メッセージの `event.origin` を常にチェックし、信頼できるドメインから来ていることを保証する。allow-list 方式を使う。**

postMessage・SSE・WebSocket はいずれも「受信データはデータとして扱う」「オリジンを allow-list で検証する」という同じ骨格を持つ、と覚えるとよい。

---

## 6. WebSockets — 現行版は独立チートシートへ委譲

### 6.1 現行版の本文は1項目だけ

2025年10月の PR #1824 で、WebSocket の詳細記述は HTML5 チートシートから削除され、独立した **WebSocket Security Cheat Sheet** へ移動した。そのため現行版の WebSockets 節はほぼ1行しかない。

> 原文: Check out [WebSocket Security Cheat Sheet](WebSocket_Security_Cheat_Sheet.md) to learn about WebSocket specific protections.

つまり**現行の HTML5 チートシートだけを読むと WebSocket の中身がゼロになる**。委譲先を読まなければならない。以下 6.2 以降に委譲先（WebSocket Security Cheat Sheet）の全項目を収録する。旧版に載っていた WebSocket 推奨事項は本節末の付録に逐語保存した。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP WebSocket Security Cheat Sheet（描画版） — https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
> **なぜ**: 本教科書の執筆環境からは描画版を自動取得できなかった（理由: `cheatsheetseries.owasp.org` へのエグレスがポリシー拒否された）。以下 6.2〜6.10 の本文は、同一内容の正典 Markdown（commit `05dcd35`）にもとづく逐語要約である。
> **読みどころ**:
> 1. CSWSH の4ステップの流れと、実例（Gitpod CSWSH 2023、CVE-2018-1270）のリンク。
> 2. フレームワーク別ベストプラクティス表（Node.js の `verifyClient`/`maxPayload`/`perMessageDeflate`、Go の `CheckOrigin`、Django Channels、Spring）。
> 3. テスト項目とツール（wscat、OWASP ZAP の WebSocket 機能）。
> **代替手段**: 正典 Markdown を `curl -sSL "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/WebSocket_Security_Cheat_Sheet.md"` で取得できる。

### 6.2 WebSocket 特有のセキュリティ課題

WebSocket は、クライアントとサーバ間のリアルタイム双方向通信を可能にし、チャット・ライブ取引・共同編集などを支える。従来の HTTP と違い、**接続は開いたままで継続的にデータを交換する**。この持続性が、通常のWebアプリとは異なる課題を生む。

| 課題 | 説明 |
| --- | --- |
| **Cross-Site WebSocket Hijacking (CSWSH)** | 攻撃者が悪意あるサイトから認証済み接続をハイジャックする |
| **Authentication bypass** | 組み込み認証がないため、アクセス制御を忘れやすい |
| **Injection attacks** | メッセージが XSS・SQLi・その他のペイロードを運べる |
| **Denial-of-service** | 持続接続が接続枯渇のような新しい DoS ベクタを生む |
| **Monitoring gaps** | HTTP ログは最初の upgrade しか捕捉せず、以降のメッセージを取り逃す |

実世界の脆弱性（原文が挙げる2件）:

| 事例 | 内容 | 参照URL |
| --- | --- | --- |
| Gitpod CSWSH (2023) | 不十分な origin 検証により、ハイジャックされた接続経由で完全なアカウント乗っ取りが可能だった | https://github.com/advisories/GHSA-f53g-frr2-jhpf |
| Spring RCE | CVE-2018-1270。細工された STOMP メッセージでコード実行できた | https://spring.io/security/cve-2018-1270 |

### 6.3 トランスポートセキュリティ（WSS 必須）

本番で暗号化されていない `ws://` を決して使わない。`ws://` は盗聴と改ざんを許す。

```javascript
// Secure - always use this
const socket = new WebSocket('wss://app.example.com/socket');

// Insecure - never use in production
// const socket = new WebSocket('ws://app.example.com/socket');
```

- **モダンなプロトコルバージョンを使う**: RFC 6455（現行標準）のみをサポートし、既知の脆弱性がある Hixie-76 や hybi-00 への後方互換を捨てる。
- **圧縮のセキュリティ**: 特に必要でない限り `permessage-deflate` 圧縮を無効化する。圧縮は CRIME/BREACH に似た脆弱性（圧縮と秘密データの組み合わせで情報が漏れる）を持ち込み得る。

```javascript
// Node.js - disable compression for security
const wss = new WebSocket.Server({
  perMessageDeflate: false
});
```

インフラ設定として、リバースプロキシ・ロードバランサ・CDN が HTTP/1.1 の upgrade を扱えるよう `Upgrade` および `Connection: upgrade` ヘッダを正しく通し、長寿命接続向けに read timeout を設定する。WAF が最初のハンドシェイクを越えて WebSocket トラフィックを検査できるかも確認する。

### 6.4 認証・認可と CSWSH

WebSocket には組み込み認証がない。**ブラウザはハンドシェイクに Cookie を自動で含める**ため、CSWSH に脆弱になる。

CSWSH の手順（原文の4ステップ）:

```text
1. ユーザーがアプリにログイン（セッション Cookie が確立）
2. ユーザーが後に悪意あるサイトを訪れる
3. 悪意あるサイトがそのアプリへ WebSocket を開く → ブラウザが自動で Cookie を送る
4. サーバが接続を受け入れる → 攻撃者がライブで認証済み WebSocket アクセスを得る
```

**Origin Header Validation**: すべてのハンドシェイクで `Origin` ヘッダを検証し、信頼できるオリジンの明示的な allowlist を使う。ブラウザはこのヘッダを含め、悪意ある JavaScript はこれを上書きできない。

```javascript
const wss = new WebSocket.Server({
  verifyClient: (info) => {
    const allowedOrigins = ['https://app.example.com'];
    if (!allowedOrigins.includes(info.origin)) {
      console.log(`Rejected unauthorized origin: ${info.origin}`);
      return false;
    }
    return true;
  }
});
```

**重要**: denylist ではなく allowlist を使う。ワイルドカードや部分文字列マッチは誤りやすいので避ける。CSRF 対策を使っているアプリでは、ハンドシェイクに CSRF トークンを含める。

セッション管理（WebSocket 接続は長生きしがちなので特別扱いが必要）:
- `SameSite=Lax` または `Strict` の Cookie でクロスサイト送信を防ぐ。
- セッション期限切れをサーバ側で扱い、期限切れなら接続を閉じる（30分ごとの再検証が一般的）。

```javascript
// Example: Close WebSocket on session expiry
function validateSession(ws, sessionId) {
  if (!isSessionValid(sessionId)) {
    ws.close(1008, 'Session expired');
    return false;
  }
  return true;
}
```

- ログアウト時はそのユーザーの全 WebSocket 接続を直ちに閉じる。
- トークンベース認証を併用する。トークンはクエリ文字列（アクセスログに現れるので redact すべき）か、接続確立後のメッセージで渡す。長寿命接続ではトークンをローテートする。

**Message-Level Authorization**: 接続 = 無制限アクセスと仮定せず、アクションごとに認可をチェックする。

```javascript
ws.on('message', (data) => {
  const message = JSON.parse(data);

  // Check authorization for each action
  if (message.action === 'delete_user' && !user.hasRole('admin')) {
    ws.send(JSON.stringify({type: 'error', message: 'Access denied'}));
    return;
  }

  handleAuthorizedMessage(ws, user, message);
});
```

### 6.5 入力検証（すべて untrusted input）

WebSocket メッセージは SQLi・XSS・コマンドインジェクションのペイロードを運べる。

- JSON スキーマと allow-list で構造と内容を検証し、妥当なサイズ制限（典型的には 64KB 以下）とレートリミットを設ける。
- バイナリは content-type ヘッダを信用せず magic number でファイルタイプを検証する。
- リプレイ攻撃を防ぐため、タイムスタンプまたは nonce を含め、重複を拒否する。
- **JSON 処理には常に `eval()` ではなく `JSON.parse()` を使う。**

```javascript
// Safe
const message = JSON.parse(data);

// Dangerous - enables code execution
// const message = eval('(' + data + ')');
```

### 6.6 サービストンネリングのリスク

WebSocket は TCP サービス（VNC, FTP, SSH）をトンネルできるが、アプリに XSS があれば攻撃者は被害者ブラウザから直接これらにアクセスできる。トンネリングが必要なら WebSocket 層を越えた追加の認証とアクセス制御を実装する。

### 6.7 DoS 対策

- 総接続数を制限し、ユーザー単位（推奨）または IP 単位で制限する。
- メッセージサイズ制限（典型的には 64KB 以下）とレートリミット（毎分100メッセージが出発点）。
- アイドルタイムアウトで非アクティブ接続を閉じ、ping/pong ハートビートで死んだ接続を検出する。
- バックプレッシャー制御を実装する。多くの WebSocket 実装は適切なフロー制御を欠いており、処理より速くメッセージを送られるとメモリを圧倒される。

```javascript
const wss = new WebSocket.Server({
  maxPayload: 64 * 1024
});
```

### 6.8 監視とログ

HTTP アクセスログは最初の upgrade しか捕捉しないため、認証失敗・インジェクション試行・レートリミット違反を取り逃す。接続の確立と終了（ユーザー識別情報・IP・origin を含む）、認証・認可イベント、セキュリティ違反、異常な切断をログする。一方でメッセージ内容全体・認証トークン・セッションID・個人情報はログしない。

### 6.9 テスト項目とツール

| テスト | 内容 |
| --- | --- |
| Origin validation | 認可されていないドメインから接続してみる |
| Authentication bypass | 適切な資格情報なしでの接続を試みる |
| Message injection | XSS・SQLi・コマンドインジェクションのペイロードを送る |
| DoS resistance | 接続数上限・メッセージフラッディング・過大メッセージをテスト |
| Session management | セッション期限切れとログアウト処理をテスト |

ツール（原文の逐語）: 手動テスト用のブラウザ開発者ツール、コマンドラインからの接続に **[wscat](https://github.com/websockets/wscat)**、自動脆弱性テスト用のカスタムスクリプト、**OWASP ZAP**（WebSocket テスト機能を含む）。

### 6.10 フレームワーク別ベストプラクティス

| フレームワーク | 原文の推奨（逐語の要点） |
| --- | --- |
| Node.js | `verifyClient` を origin と認証チェックに使い、`maxPayload` 制限を設定し、`perMessageDeflate` を無効化 |
| Python | Django Channels では認証ミドルウェアと origin 検証。async の例外ハンドリングでクラッシュを防ぐ |
| Java Spring | 許可オリジンを明示設定し、Spring Security を統合。メッセージサイズ制限を設定 |
| Go | Gorilla WebSocket の `CheckOrigin` に検証を実装する — 単に `true` を返してはいけない。read limit・タイムアウト・context cancellation を使う |

ライブラリ（`ws`、Spring STOMP、Python `websockets`）は定期更新する。過去バージョンには DoS や RCE を含む重大脆弱性があった。参照: **CWE-1385: Missing Origin Validation in WebSockets** — https://cwe.mitre.org/data/definitions/1385.html

---

## 7. Local Storage / Web Storage

### 7.1 どう動くのか

Web Storage とは、ブラウザ内にキーと値のペアを保存する仕組みのこと。`localStorage`（永続）と `sessionStorage`（そのタブを閉じるまで）の2種類がある。いずれも JavaScript から自由に読み書きできる。

### 7.2 原文の推奨事項（8項目、全て）

1. **Offline Storage、Web Storage とも呼ばれ、基盤の保存メカニズムはユーザーエージェントごとに異なり得る。** アプリが要求する認証は、データが保存されているマシンにローカル権限を持つユーザーによってバイパスされ得る。機密情報を local storage に保存しない。
2. **認証・認可を前提としないデータには利用が適切**（＝機密でないデータには使ってよい）。
3. **永続保存が不要なら `localStorage` ではなく `sessionStorage` を使う。** `sessionStorage` はそのウィンドウ／タブが閉じられるまで、そのウィンドウ／タブにのみ利用可能。
4. **XSS が1件あれば、これらのオブジェクト内の全データを盗める。** 機密情報を置かない。
5. **XSS が1件あれば、これらに悪意あるデータを読み込ませられる。** 読み出し時に信頼しない。
6. **`localStorage.getItem` と `setItem` の呼び出しには特に注意する。** 機密情報を local storage に置いている箇所を検出する助けになる。
7. **セッション識別子を local storage に保存しない。** データは常に JavaScript からアクセス可能だから。Cookie なら `httpOnly` フラグでこのリスクを軽減できる。
8. **Cookie の `path` 属性のようにパスで可視範囲を制限する方法は無い。** すべてのオブジェクトはオリジン内で共有され SOP で保護される。同一オリジンに複数アプリを相乗りさせず、**異なるサブドメインを使う。**

### 7.3 攻撃者はどこを突くか

- `localStorage` にセッショントークン / JWT / API キー / PII を保存している（推奨1・4・7）。
- 同一オリジンに複数アプリを相乗りさせている → 片方の XSS で他方のストレージも読める（推奨8。対策は別サブドメインに分ける）。
- `localStorage` から読んだ値を検証せず DOM に流している（推奨5。ストレージは untrusted source）。
- 永続不要なのに `localStorage` を使っている（推奨3）。

`httpOnly` フラグとは、その Cookie を JavaScript から読めなくする Cookie の属性のこと。これが付いていれば、XSS が起きてもスクリプトはそのセッション Cookie を盗めない。この保護は `localStorage` には存在しないので、**セッションは httpOnly Cookie に置き、`localStorage` には置かない**のが原則になる。

---

## 8. Client-side databases（IndexedDB / Web SQL の廃止）

### 8.1 この節は大きく書き換えられた

この節は2026年5月の PR #2188 で全面的に書き換えられた。旧版は「Web SQL は2010年に非推奨」「WebDatabase は SQL インジェクションの可能性」だったが、現行版は「Web SQL は使うな、IndexedDB を使え」に置き換わっている（旧文言は本節末の付録参照）。

### 8.2 現行の推奨事項（5項目、全て）

1. **Web SQL Database は 2010年に W3C により非推奨とされ、すべての主要ブラウザから削除されている。** Chromium はバージョン 119（2023年10月）でサポートを打ち切り、Safari / Firefox はサードパーティオリジン向けには一度も出荷しなかった。**Web SQL を使ってはならない。** ブラウザ内で特に SQL インターフェースが必要なら、公式の SQLite WebAssembly ビルド（`sqlite-wasm`）を、IndexedDB または Origin Private File System（OPFS）を永続化層として動かす。参照: https://sqlite.org/wasm/doc/trunk/about.md
2. **クライアント側の構造化ストレージの現行標準は IndexedDB。** トランザクショナルな key-value ストアで、2015年以降 W3C 勧告であり、すべての evergreen ブラウザでサポートされる。参照: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
3. **基盤の保存メカニズムはユーザーエージェントと OS で異なる。** ブラウザのプロファイルディレクトリへのディスク上読み取りアクセスを持つユーザー（あるいはそのユーザー権限で動く任意のプロセス、マルウェアを含む）は保存データを読み書きできる。**クライアント側ストレージが機密性を提供すると仮定してはならない。** セッショントークン・資格情報・秘密を IndexedDB に保存しない — ただし、ブラウザから復元できない鍵で暗号化されている場合は例外（例: 永続化しないユーザー入力パスフレーズから導出した鍵、あるいは extractable でない Web Crypto の `CryptoKey` でラップした場合）。参照: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
4. **XSS が1件あれば IndexedDB 内の任意データを読み書きできる。** 読み出し時、内容は untrusted input として扱う。
5. **IndexedDB から来るデータには、ネットワーク由来データと同じ入力検証・出力エンコーディングのルールを適用する。**

〔補足〕evergreen ブラウザとは、ユーザーが意識せず自動更新され続けるモダンブラウザ（Chrome、Firefox、Edge など）のこと。W3C 勧告（W3C Recommendation）とは、W3C の標準化プロセスで最も安定した段階の仕様を指す。

### 8.3 ポイント

「クライアントストレージに機密を置かない」という原則は Web Storage と IndexedDB で共通だが、**唯一の例外はブラウザから復元不可能な鍵での暗号化**である。診断側は、IndexedDB に平文でトークンや PII を入れている実装、および読み出し値を無検証で DOM に流している実装を探す。

---

## 9. Geolocation と Web Workers

### 9.1 Geolocation（位置情報）

Geolocation API とは、ブラウザから利用者の地理的位置を取得するAPIのこと。原文の推奨事項は1項目。

- Geolocation API は位置を計算する前にユーザーに許可を求めることを要求している。この決定が記憶されるか・どう記憶されるかはブラウザで異なる。一部のブラウザでは、許可を取り消すにはページを再訪する必要がある。そのため**プライバシー上の理由から、`getCurrentPosition` または `watchPosition` を呼ぶ前にユーザーの明示的な操作を要求する**。参照: https://www.w3.org/TR/2021/WD-geolocation-20211124/#security

設計上、ページ読み込み直後に自動で位置情報を要求すると、(a) 意図せず許可してしまう、(b) 取り消しにページ再訪が必要で困難、の2点で問題になる。ユーザーのクリック等をトリガにしてから API を呼ぶ。

### 9.2 Web Workers

Web Worker とは、メインのページとは別スレッドで JavaScript を動かす仕組みのこと。重い計算をUIを止めずに実行できる。原文の推奨事項は3項目。

1. **Web Workers は `XMLHttpRequest` を使って、ドメイン内および CORS のリクエストを行える。** CORS のセキュリティは該当節を参照。
2. **Web Workers は呼び出し元ページの DOM にはアクセスできないが、悪意ある Worker は過剰な CPU で DoS を起こしたり、CORS を悪用してさらなる攻撃を行える。** すべての Worker スクリプトが悪意のないものであることを保証し、**ユーザー提供の入力から Worker スクリプトを作成することを許してはならない。**
3. **Worker とやり取りするメッセージを検証する。** `eval()` で評価するための JS 断片を交換しようとしない（DOM Based XSS を導入し得る）。

診断観点:
- `new Worker(userControlledUrl)` / `new Worker(URL.createObjectURL(new Blob([userInput])))` のように、ユーザー入力から Worker スクリプトを生成している（推奨2違反）。
- Worker と main thread 間の `postMessage` で JS コード文字列を送り、受け側で `eval()` している（推奨3）。
- Worker は「DOM にアクセスできない代わりにネットワークアクセスを持つ実行環境」であることを忘れない（推奨1・2）。

---

## 10. Tabnabbing（リバース・タブナビング）

### 10.1 どういう攻撃か

Tabnabbing（Reverse Tabnabbing、リバース・タブナビング）とは、`target="_blank"` などで開いた新しいタブ側のページから、`window.opener` を経由して**元のタブの中身やURLを書き換えられてしまう**問題のこと。たとえば信頼できるサイト上のリンクを新タブで開くと、そのリンク先ページが元タブを偽のログイン画面に差し替える、といった攻撃が成り立つ。

原文は「新しく開かれたページから、`opener` という JavaScript オブジェクトが露出させる『戻りリンク』経由で、親ページのコンテンツまたはロケーションに対して操作できてしまう能力」と説明する。適用範囲は、`target` 属性や `window.open` で「現在のロケーションを置き換えない読み込み先」を指定し、新ページから現在のウィンドウ／タブを利用可能にしてしまうケース。

### 10.2 どう守るか（原文の推奨）

- **HTML リンクの場合**: リンクを作るタグに `rel="noopener"` を追加する。これは戻りリンクを切るが、ブラウザによっては子ページへのリクエストに referrer 情報が残る。referrer も取り除くには `rel="noopener noreferrer"` を使う。
- **JavaScript の `window.open` の場合**: windowFeatures パラメータに `noopener,noreferrer` を追加する。参照: https://developer.mozilla.org/en-US/docs/Web/API/Window/open
- **クロスブラウザ対応を最大化する設定**: HTML リンクは**すべてのリンクに** `rel="noopener noreferrer"` を追加。JavaScript は下記の関数を使う。加えて、送信するすべての HTTP レスポンスに `Referrer-Policy: no-referrer` を付ける。参照: https://owasp.org/www-project-secure-headers/

referrer（リファラ）とは、リンク元のURLを次のページに伝える情報のこと。`Referrer-Policy` はそれをどこまで送るかを制御するHTTPヘッダである。

### 10.3 コード（原文のまま逐語）

```javascript
function openPopup(url, name, windowFeatures){
  //Open the popup and set the opener and referrer policy instruction
  var newWindow = window.open(url, name, 'noopener,noreferrer,' + windowFeatures);
  //Reset the opener link
  newWindow.opener = null;
}
```

ポイントは (a) windowFeatures 文字列の**先頭**に `'noopener,noreferrer,'` を連結し、(b) その上で `newWindow.opener = null;` で opener を明示的にリセットする二重防御である。

### 10.4 逐語で押さえる文字列

| 用途 | 値（逐語） |
| --- | --- |
| HTML リンク（最小） | `rel="noopener"` |
| HTML リンク（referrer も除去、推奨） | `rel="noopener noreferrer"` |
| `window.open` の windowFeatures | `noopener,noreferrer` |
| opener の明示リセット | `newWindow.opener = null;` |
| HTTP レスポンスヘッダ | `Referrer-Policy: no-referrer` |

〔補足〕原文が示す互換性確認先: noopener は https://caniuse.com/#search=noopener 、noreferrer は https://caniuse.com/#search=noreferrer 、referrer-policy は https://caniuse.com/#feat=referrer-policy 。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP Reverse Tabnabbing（www-community 記事） — https://owasp.org/www-community/attacks/Reverse_Tabnabbing
> **なぜ**: 本教科書の執筆環境からは描画版を自動取得できなかった（理由: `owasp.org` へのエグレスがポリシー拒否された）。本節の記述は HTML5 チートシート本文（原典 Markdown）にもとづく。
> **読みどころ**:
> 1. 攻撃の親子ページ関係を示す図版2枚（戻りリンクあり／なし）は本教科書に取り込めていないため、図で理解したい場合はここで確認する。
> 2. **重要な留保**: モダンな evergreen ブラウザでは `target="_blank"` に暗黙の `rel="noopener"` が付き、この問題は実質的に修正済みという点。診断時の重大度評価に効くので、この記事の Update 2023 を読む価値がある。
> **代替手段**: 正典 Markdown を `curl -sSL "https://raw.githubusercontent.com/OWASP/www-community/master/pages/attacks/Reverse_Tabnabbing.md"` で取得できる。

---

## 11. Sandboxed frames（サンドボックス化されたフレーム）

### 11.1 なぜあるのか

信頼できないコンテンツ（サードパーティ広告やユーザー投稿 HTML）を `iframe` で表示すると、その中のスクリプトが親ページを乗っ取り得る。`sandbox` 属性は、その `iframe` の中でできることを制限し、被害を封じ込めるための仕組みである。

### 11.2 原文の推奨事項

1. **信頼できないコンテンツには `iframe` の `sandbox` 属性を使う。**
2. **`sandbox` が設定されているとき、次の制限が有効になる**（原文の5項目）:
   1. すべてのマークアップは、ユニークなオリジンから来たものとして扱われる。
   2. すべてのフォームとスクリプトが無効化される。
   3. すべてのリンクは、他のブラウジングコンテキストを target にすることを防止される。
   4. 自動的に発火するすべての機能がブロックされる。
   5. すべてのプラグインが無効化される。
3. **`sandbox` の値で `iframe` の能力に対する細かい制御（fine-grained control）ができる。** 参照: https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox
4. **この機能をサポートしない古いブラウザでは属性は無視される。** そのため追加の防御層として使うか、サポートを確認してから信頼できないコンテンツを表示する。
5. **これとは別に、Clickjacking や意図しないフレーミングを防ぐため、`deny` と `same-origin` の値をサポートする `X-Frame-Options` ヘッダの使用が推奨される。** `if(window!==window.top) { window.top.location=location;}` のような framebusting 等の他の解決策は推奨されない。

### 11.3 コード（原文のまま逐語）

推奨されない framebusting の例（原文がアンチパターンとして提示）:

```javascript
if(window!==window.top) { window.top.location=location;}
```

| 項目 | 値（逐語） | 備考 |
| --- | --- | --- |
| 属性 | `sandbox`（`iframe` の属性） | 値を指定して fine-grained control 可能 |
| ヘッダ | `X-Frame-Options` | サポート値として原文は `deny` と `same-origin` を挙げる |
| 非推奨手法 | framebusting `if(window!==window.top) { window.top.location=location;}` | 推奨されない |

〔補足〕原文が挙げる `X-Frame-Options` の値表記は `deny` / `same-origin`（仕様上の正式表記は `DENY` / `SAMEORIGIN`）。現在の標準的代替は CSP（Content Security Policy）の `frame-ancestors` ディレクティブである（これは原文に記載のない補足）。Clickjacking（クリックジャッキング）とは、透明化した iframe などを重ねて、ユーザーに気づかせず別の操作をクリックさせる攻撃のこと。

〔補足〕`sandbox` に指定できる制限解除トークン（`allow-scripts` など全14種）の完全一覧と、`allow-scripts` と `allow-same-origin` を同時指定するとサンドボックスから脱出できてしまう重大な罠については、本教科書の別節（HTTP セキュリティヘッダおよび sandbox トークンの詳細を扱う節）で詳しく解説する。原文の HTML5 チートシート本文にはトークン一覧が載っていない。

---

## 12. 資格情報・PII の入力ヒント

### 12.1 なぜあるのか

公共のコンピュータでは、ブラウザのオートコンプリート（自動補完）機能のせいで、前の利用者が入力したパスワードが次の利用者に補完されてしまう危険がある。原文は「公共のコンピュータから金融口座にアクセスし、ログオフしても、次の人がオートコンプリートでログインできてしまう」というシナリオを挙げる。

### 12.2 どう守るか

PII（Personally Identifiable Information、個人を識別できる情報。氏名・メール・住所・電話番号）とログイン資格情報（ユーザー名・パスワード）の入力欄は、ブラウザに保存されないようにする。次の HTML5 属性を使う。

```html
<input type="text" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"></input>
```

（原文どおり。`</input>` という閉じタグ付きの表記も原文のまま。）

| 属性 | 値 | 目的 |
| --- | --- | --- |
| `spellcheck` | `"false"` | スペルチェック経由の外部送信・保持を防ぐ |
| `autocomplete` | `"off"` | オートコンプリート／オートフィルによる保存・再現を防ぐ |
| `autocorrect` | `"off"` | 自動修正を無効化 |
| `autocapitalize` | `"off"` | 自動大文字化を無効化 |

---

## 13. Offline Applications（Service Worker への移行）

### 13.1 この節も書き換えられた

この節は PR #2188 で全面的に書き換えられた。旧版は appcache の `manifest` とキャッシュポイズニングの話だったが（旧文言は付録参照）、現行版は Application Cache の廃止と Service Worker への移行を扱う。

### 13.2 現行の推奨事項

1. **HTML5 Application Cache（`<html manifest="...">` と `.appcache` ファイル）は、すべての主要ブラウザから削除されている（Firefox 85, Chrome 93）。** 新規アプリでは使わず、残る利用箇所は **Service Workers と Cache API** に移行する。参照: https://developer.mozilla.org/en-US/docs/Web/API/Cache
2. **Service Workers は別のスクリプト可能なスレッドで動作し、登録されたスコープに対するネットワークリクエストを傍受（intercept）する。キャッシュ済みレスポンスを透過的に返せるため、重大なセキュリティ上の影響を持つ。**
   - **自オリジンからのみ Service Worker を登録し、worker スクリプトは HTTPS 上でのみ配信する。** キャッシュバスティングのため長いファイル名を使う（例: `sw.<hash>.js`）。
   - **スコープが制限されていることを検証する**（`scope` オプション、または `Service-Worker-Allowed` レスポンスヘッダ）。侵害された worker が無関係なパスを傍受できないようにする。
   - **悪意ある／侵害された Service Worker は、unregister されるかキャッシュ TTL が切れるまで、そのスコープからのすべてのリクエストを傍受できる。** 文書化されたキルスイッチ（kill-switch、hotfix として配れる unregister フロー）を用意する。
   - **機密データを含むレスポンスをキャッシュしない。** そのようなレスポンスには `Cache-Control: no-store` を送り、Cache API が保持しないようにする。

Service Worker とは、ページとは独立してバックグラウンドで動き、ネットワーク通信を横取りできる特殊なスクリプトのこと。オフライン動作やプッシュ通知の基盤になる。傍受（intercept）とは、通信を途中で捕まえて内容を差し替えたり返したりすること。

### 13.3 攻撃者はどこを突くか

- Service Worker スクリプト（`/sw.js` など）が、ユーザーがアップロードしたファイルを配信できるパスに置ける構成になっていないか（任意ファイルアップロード + `Service-Worker-Allowed` で、スコープを広げた永続的傍受に至る）。
- `scope` が `/` に設定され、必要以上に広いリクエストを傍受していないか。
- 認証済みレスポンスを Cache API に入れていないか（`Cache-Control: no-store` の欠如）。
- Service Worker を止める手段（unregister フロー、キルスイッチ）が用意されているか。

---

## 14. Progressive Enhancement と HTTP セキュリティヘッダ

### 14.1 Progressive Enhancement と段階的劣化のリスク

この節も PR #2188 で書き換えられた（旧版は「`<video>` 非対応なら Flash にフォールバック」だった）。現行の推奨:

- **ブラウザがサポートする能力を判定し、直接サポートされない能力のみ代替手段で補う。廃れたブラウザプラグインにフォールバックしない。** Adobe Flash Player は 2020年12月31日に end-of-life に達し、全ブラウザから削除された。Java アプレット・Silverlight・ActiveX も同様にサポートされていない。ネイティブの HTML5（`<video>`, `<audio>`, `<canvas>`, WebAssembly）がこれらのレガシー用途をカバーする。

診断側の観点としては、レガシーフォールバック経路（古いプラグイン呼び出し、`<object>`/`<embed>` の残骸、条件分岐で読み込まれる外部スクリプト）が**レビューされていないコードパス**として残りやすい点が重要である。

### 14.2 HTTP セキュリティヘッダ（委譲）

原文はこの節で具体的なヘッダを列挙せず、プロジェクトへ委譲している。

- **ブラウザレベルの防御を有効化するために使うべき HTTP セキュリティヘッダの一覧を得るには、OWASP Secure Headers プロジェクトを参照すること。** 参照: https://owasp.org/www-project-secure-headers/

〔補足〕HTML5 チートシート本文中で個別に登場するヘッダは5つだけである: `Access-Control-Allow-Origin`（CORS 節）、`X-Frame-Options`（sandboxed frames 節）、`Referrer-Policy: no-referrer`（Tabnabbing 節）、`Service-Worker-Allowed` と `Cache-Control: no-store`（Service Worker 節）。OWASP Secure Headers プロジェクトが列挙する推奨ヘッダ13件・削除すべきヘッダ90件の具体的な名前と値は、本教科書の別節（HTTP セキュリティヘッダを扱う節）で全件を扱う。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP Secure Headers Project — https://owasp.org/www-project-secure-headers/
> **なぜ**: 本教科書の執筆環境からは描画版を自動取得できなかった（理由: `owasp.org` / `owasp.github.io` へのエグレスがポリシー拒否された）。HTML5 チートシート本文はこのプロジェクトへ委譲しているだけで、ヘッダの実体を列挙していない。
> **読みどころ**:
> 1. 追加すべきヘッダ（推奨値つき）と削除すべきヘッダのリスト。実体を知るためにここを読む。
> 2. 各ヘッダの解説文・非推奨化の経緯・ブラウザ対応状況・言語別の設定サンプル。
> **代替手段**: プロジェクトが機械可読形式で公開する正典リストを `curl -sSL "https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json"` および `.../headers_remove.json` で取得できる。

---

## 15. 付録: 改訂で削除された旧版の記述（Git 履歴から逐語保存）

「昔の HTML5 チートシートに何が書かれていたか」を参照したい場合のために、Git 履歴から削除済みテキストを保存する。**これらは現行版には存在しない**ので、参照するときは必ず「旧版の記述」と明記すること。出典: OWASP/CheatSheetSeries リポジトリ commit `28151e3`（2025-10-01, PR #1824）および `00f27a7`（2026-05-29, PR #2188）の diff。

### 15.1 旧 WebSockets 節（commit 28151e3 で削除、WebSocket Security Cheat Sheet へ移動）

削除された9項目（原文のまま、英語で逐語保存）:

```text
- Drop backward compatibility in implemented client/servers and use only protocol versions above hybi-00. Popular Hixie-76 version (hiby-00) and older are outdated and insecure.
- The recommended version supported in latest versions of all current browsers is [RFC 6455](http://tools.ietf.org/html/rfc6455) (supported by Firefox 11+, Chrome 16+, Safari 6, Opera 12.50, and IE10).
- While it's relatively easy to tunnel TCP services through WebSockets (e.g. VNC, FTP), doing so enables access to these tunneled services for the in-browser attacker in case of a Cross Site Scripting attack. These services might also be called directly from a malicious page or program.
- The protocol doesn't handle authorization and/or authentication. Application-level protocols should handle that separately in case sensitive data is being transferred.
- Process the messages received by the websocket as data. Don't try to assign it directly to the DOM nor evaluate as code. If the response is JSON, never use the insecure `eval()` function; use the safe option JSON.parse() instead.
- Endpoints exposed through the `ws://` protocol are easily reversible to plain text. Only `wss://` (WebSockets over SSL/TLS) should be used for protection against Man-In-The-Middle attacks.
- Spoofing the client is possible outside a browser, so the WebSockets server should be able to handle incorrect/malicious input. Always validate input coming from the remote site, as it might have been altered.
- When implementing servers, check the `Origin:` header in the Websockets handshake. Though it might be spoofed outside a browser, browsers always add the Origin of the page that initiated the Websockets connection.
- As a WebSockets client in a browser is accessible through JavaScript calls, all Websockets communication can be spoofed or hijacked through [Cross Site Scripting](https://owasp.org/www-community/attacks/xss/). Always validate data coming through a WebSockets connection.
```

要点: 古いプロトコル（hybi-00 以下）への後方互換を捨て RFC 6455 のみを使う。プロトコル自体は認可／認証を扱わないのでアプリ層で別途扱う。受信メッセージはデータとして処理し、JSON は `eval()` ではなく `JSON.parse()`。`ws://` は容易に平文に戻せるので `wss://` のみを使う。サーバはハンドシェイクの `Origin:` ヘッダをチェックする。WebSocket 通信は XSS で偽装・ハイジャックされ得る。これらの現行版は 6.2〜6.10 に再構成されている。

### 15.2 旧「WebSocket implementation hints」節（commit 28151e3 で削除、約825行の Java 実装例つき）

削除された大節の冒頭（逐語）:

```text
## WebSocket implementation hints

In addition to the elements mentioned above, this is the list of areas for which caution must be taken during the implementation.

- Access filtering through the "Origin" HTTP request header
- Input / Output validation
- Authentication
- Authorization
- Access token explicit invalidation
- Confidentiality and Integrity

The section below will propose some implementation hints for every area and will go along with an application example showing all the points described.

The complete source code of the example application is available [here](https://github.com/righettod/poc-websocket).
```

旧「Access filtering」節の要点: ハンドシェイク時、ブラウザは発信元ドメインを含む `Origin` HTTP リクエストヘッダを送る。このヘッダは（ブラウザ以外からの）偽造リクエストでは偽装できるが、ブラウザのコンテキストでは上書き・強制ができない。したがって allow-list によるフィルタリングの良い候補になる。このベクタを使った攻撃が Cross-Site WebSocket Hijacking (CSWSH) である。

旧版が載せていた Java 実装例（`ServerEndpointConfig.Configurator` の `checkOrigin` による allow-list 検証。原文のまま逐語）:

```java
import org.owasp.encoder.Encode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.websocket.server.ServerEndpointConfig;
import java.util.Arrays;
import java.util.List;

/**
 * Setup handshake rules applied to all WebSocket endpoints of the application.
 * Use to setup the Access Filtering using "Origin" HTTP header as input information.
 *
 * @see "http://docs.oracle.com/javaee/7/api/index.html?javax/websocket/server/
 * ServerEndpointConfig.Configurator.html"
 * @see "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin"
 */
public class EndpointConfigurator extends ServerEndpointConfig.Configurator {

    /**
     * Logger
     */
    private static final Logger LOG = LoggerFactory.getLogger(EndpointConfigurator.class);

    /**
     * Get the expected source origins from a JVM property in order to allow external configuration
     */
    private static final List<String> EXPECTED_ORIGINS =  Arrays.asList(System.getProperty("source.origins")
                                                          .split(";"));

    /**
     * {@inheritDoc}
     */
    @Override
    public boolean checkOrigin(String originHeaderValue) {
        boolean isAllowed = EXPECTED_ORIGINS.contains(originHeaderValue);
        String safeOriginValue = Encode.forHtmlContent(originHeaderValue);
        if (isAllowed) {
            LOG.info("[EndpointConfigurator] New handshake request received from {} and was accepted.",
                      safeOriginValue);
        } else {
            LOG.warn("[EndpointConfigurator] New handshake request received from {} and was rejected !",
                      safeOriginValue);
        }
        return isAllowed;
    }

}
```

このコードの要点は、`EXPECTED_ORIGINS.contains(originHeaderValue)` という**完全一致の contains**（allow-list への包含判定）で検証している点である。部分一致ではないため、6.4 の allowlist 原則と一致する。サンプルアプリ全体のソースは https://github.com/righettod/poc-websocket にあると原文が示している。残る Java 実装例（Authentication、Authorization、Confidentiality and Integrity の各節、数百行）は分量が大きく現行版に存在しないため、本節では引用していない。必要な場合は `git show 28151e3^:cheatsheets/HTML5_Security_Cheat_Sheet.md` で取り出せる。

### 15.3 旧 Client-side databases 節（commit 00f27a7 で置換）

```text
- On November 2010, the W3C announced Web SQL Database (relational SQL database) as a deprecated specification. A new standard Indexed Database API or IndexedDB (formerly WebSimpleDB) is actively developed, which provides key-value database storage and methods for performing advanced queries.
- Underlying storage mechanisms may vary from one user agent to the next. In other words, any authentication your application requires can be bypassed by a user with local privileges to the machine on which the data is stored. Therefore, it's recommended not to store any sensitive information in local storage.
- If utilized, WebDatabase content on the client side can be vulnerable to SQL injection and needs to have proper validation and parameterization.
- Like Local Storage, a single [Cross Site Scripting](https://owasp.org/www-community/attacks/xss/) can be used to load malicious data into a web database as well. Don't consider data in these to be trusted.
```

要点（旧版）: 2010年11月に W3C が Web SQL Database を非推奨と発表。IndexedDB（旧称 WebSimpleDB）が新標準として開発中。WebDatabase を使うとクライアント側の内容が SQL インジェクションに脆弱になり得るため適切な検証とパラメータ化が必要（＝クライアントサイド SQL インジェクションという攻撃面が存在したという歴史的事実。現行版はこの記述を削除し「Web SQL は使うな」に置き換えた）。

### 15.4 旧 Offline Applications 節（commit 00f27a7 で置換）

```text
- Whether the user agent requests permission from the user to store data for offline browsing and when this cache is deleted, varies from one browser to the next. Cache poisoning is an issue if a user connects through insecure networks, so for privacy reasons it is encouraged to require user input before sending any `manifest` file.
- Users should only cache trusted websites and clean the cache after browsing through open or insecure networks.
```

要点（旧版）: オフラインブラウジング用のデータ保存の許可要求・削除タイミングはブラウザで異なる。安全でないネットワーク経由で接続する場合はキャッシュポイズニングが問題になるため、`manifest` ファイルを送る前にユーザー入力を要求することが推奨される。

### 15.5 旧 Progressive Enhancements 節（commit 00f27a7 で置換）

```text
- The best practice now is to determine the capabilities that a browser supports and augment with some type of substitute for capabilities that are not directly supported. This may mean an onion-like element, e.g. falling through to a Flash Player if the `<video>` tag is unsupported, or it may mean additional scripting code from various sources that should be code reviewed.
```

要点（旧版）: ブラウザがサポートする能力を判定し、直接サポートされない能力を代替で補う。`<video>` 未サポートなら Flash Player にフォールバックする、あるいはさまざまなソースから来る追加のスクリプトコード（コードレビューされるべきもの）を意味することもある。

---

## 手を動かす

以下は、自分で立てた検証環境や、許可されたバグバウンティ対象に対して行うことを前提とする。

1. **正典ソースを取得して本節の逐語引用を検証する。** 次を実行して、本節のコード例・ヘッダ値が原文と一致することを確かめる。

```bash
curl -sSL "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md"
curl -sSL "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/WebSocket_Security_Cheat_Sheet.md"
```

2. **postMessage の受信ハンドラを探す。** 対象ページのブラウザ開発者ツールを開き、コンソールで次を実行して、`message` リスナが登録されているか調べる。

```javascript
getEventListeners(window).message;   // Chrome DevTools のコンソールで
```

見つかったハンドラのソースを読み、`event.origin` を検証しているか、していれば `===`（完全一致）か `indexOf`（部分一致）かを確認する。部分一致なら 3.4 の `owasp.org.attacker.com` 型バイパスの候補。

3. **`localStorage` に機密が入っていないか確認する。** 開発者ツールのコンソールで次を実行する。

```javascript
Object.entries(localStorage);   // 全キーと値を一覧
```

`token`・`jwt`・`session`・`apikey` のようなキーがあれば、7.2 の推奨1・7 違反の候補。

4. **CORS 設定を確認する。** 攻撃者オリジンを装って `Origin` を送り、レスポンスの `Access-Control-Allow-Origin` がそれをそのまま反射するか、かつ `Access-Control-Allow-Credentials: true` が付くかを見る。

```bash
curl -s -I -H "Origin: https://attacker.example" "https://target.example/api/me" | grep -i "access-control"
```

反射 + credentials true なら 4.4 の最重要の候補。

5. **WebSocket の Origin 検証をテストする。** `wscat` で、許可されていないオリジンを詐称して接続を試みる。

```bash
wscat -c "wss://target.example/socket" -o "https://attacker.example"
```

接続が確立してしまえば 6.4 の Origin 検証欠如（CSWSH の前提）。

6. **sandbox iframe を探す。** ページの HTML を検索し、`<iframe` に `sandbox` が付いているか、付いていればどのトークンが並んでいるかを数える。トークンが多いほど制限が緩い。

## つまずきポイント

- **「チートシート＝攻撃手順書」だと思い込む。** これは開発者向けの実装ガイドである。診断で使うときは各項目を否定形に読み替える。
- **オリジン検証を `indexOf`/`startsWith`/正規表現の部分一致で書く。** `owasp.org.attacker.com` のような後方一致・前方一致のバイパスを通す。完全一致（`===`）と allow-list だけが正しい。
- **`*` ワイルドカードで済ませる。** `postMessage(data, "*")` も `Access-Control-Allow-Origin: *`（機密URL・ドメイン全体への付与）も禁止。
- **CORS を CSRF 対策だと誤解する。** CORS は「データが権限のない場所へ行くのを防がない」。CSRF 対策は別途必要。
- **現行の HTML5 チートシートだけ読んで WebSocket が分かった気になる。** 詳細は WebSocket Security Cheat Sheet に移動しており、本節だけを読むと中身がゼロになる。
- **`localStorage` にセッショントークンを置く。** `httpOnly` フラグが効かないので、XSS 1件で盗まれる。セッションは httpOnly Cookie に置く。
- **クライアントストレージ（Web Storage / IndexedDB）が機密性を提供すると思う。** XSS でもディスクアクセスでも読まれる。唯一の例外は「ブラウザから復元不可能な鍵での暗号化」。
- **Web SQL Database や appcache を今から使う。** どちらも主要ブラウザから削除済み（Web SQL は Chromium 119 / 2023-10、appcache は Firefox 85・Chrome 93）。IndexedDB と Service Worker + Cache API へ。
- **`sandbox` を付ければ安全だと思い込む。** トークンの組み合わせ次第で制限は緩む。とくに同一オリジンでの `allow-scripts` + `allow-same-origin` は危険（詳細は別節）。
- **ユーザー入力から Web Worker スクリプトを作る。** `new Worker(URL.createObjectURL(...))` にユーザー入力を流すのは推奨2の直接違反。

## この節のまとめ

- OWASP HTML5 Security Cheat Sheet は安全な実装のためのチェックリストであり、各項目の否定形がそのまま診断項目になる。
- 全体を貫く3原則は「受信物はデータとして扱う」「オリジンは完全一致で検証する」「クライアント側に機密を置かない」。
- `postMessage` は、送信側で `targetOrigin` を明示（`*` 禁止）、受信側で `origin` 検証 + `data` の入力検証、`data` を信頼しない、の三点セット。
- オリジン検証は `indexOf` などの部分一致では `owasp.org.attacker.com` を通してしまう。完全一致 + allow-list で書く。
- CORS では `Access-Control-Allow-Origin: *` を機密URLやドメイン全体に付けず、`Origin` を盲目的に反射しない。CORS は CSRF 対策の代替にならない。
- SSE も「URL 検証」「data をコードとして評価しない」「origin を allow-list で検証」と同じ骨格を持つ。
- WebSocket の推奨は現行版から独立チートシートへ移動した。WSS 必須、RFC 6455 のみ、Origin の allowlist 検証、CSWSH 対策（SameSite Cookie・CSRF トークン・トークン認証）、`JSON.parse()`、`maxPayload`（64KB 目安）、`perMessageDeflate` 無効化が要点。
- CSWSH は「ブラウザが Cookie を自動送信する」ことが原因で、悪意あるサイトが認証済み接続を開ける攻撃。Origin 検証と SameSite Cookie で防ぐ。
- `localStorage` は `httpOnly` が効かず XSS 1件で全部盗まれる。セッション識別子を置かず、機密は httpOnly Cookie へ。同一オリジンに複数アプリを相乗りさせず別サブドメインに分ける。
- Web SQL Database は全主要ブラウザから削除済み（Chromium 119 / 2023-10）。現行標準は IndexedDB。クライアントストレージは機密性を提供しないので秘密を置かない（例外は復元不可能な鍵での暗号化）。
- Geolocation は明示的なユーザー操作の後に呼ぶ。Web Worker はユーザー入力から生成せず、メッセージを `eval()` しない。
- Tabnabbing 対策は `rel="noopener noreferrer"`、`window.open` の windowFeatures に `noopener,noreferrer`、`newWindow.opener = null;`、`Referrer-Policy: no-referrer`。
- `sandbox` iframe は信頼できないコンテンツを封じ込める。Clickjacking 対策には `X-Frame-Options`（`deny`/`same-origin`）を使い、framebusting は使わない。
- 資格情報・PII 入力欄は `spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"` でブラウザ保存を防ぐ。
- Application Cache は削除済み（Firefox 85・Chrome 93）。Service Worker + Cache API へ移行し、スコープを絞り、キルスイッチを用意し、機密レスポンスは `Cache-Control: no-store`。
- 廃れたプラグイン（Flash は 2020-12-31 に EOL、Java アプレット・Silverlight・ActiveX も削除）へフォールバックせず、ネイティブ HTML5 を使う。
- HTTP セキュリティヘッダの一覧は OWASP Secure Headers プロジェクトへ委譲されている。チートシート本文に出るヘッダは `Access-Control-Allow-Origin`、`X-Frame-Options`、`Referrer-Policy`、`Service-Worker-Allowed`、`Cache-Control: no-store` の5つ。

## 理解度チェック

1. `if(message.origin.indexOf(".owasp.org")!=-1)` というオリジン検証はなぜ危険か。
   ▶ 答え: `indexOf` は部分一致なので、`https://owasp.org.attacker.com` のような攻撃者制御ドメインも `.owasp.org` を含むためマッチしてしまう。正しくは期待する FQDN に完全一致（`===`）させ、allow-list で判定する。

2. `postMessage` の送信で `targetOrigin` を `*` にすると何が起きうるか。
   ▶ 答え: リダイレクト等でターゲットウィンドウのオリジンが攻撃者制御のものに変わったタイミングで、メッセージ（トークンやユーザー情報を含み得る）が未知のオリジンへ漏れる。第2引数に期待するオリジンを明示する。

3. `Access-Control-Allow-Origin` に `Origin` をそのまま反射し、かつ `Access-Control-Allow-Credentials: true` を付けると何が問題か。
   ▶ 答え: 任意の攻撃者オリジンが許可され、被害者の Cookie 付きで認証済みレスポンスを読めてしまう。原文の推奨3（Origin を盲目的に返すな）の直接違反。allow-list で信頼ドメインのみを許可する。

4. なぜセッション識別子を `localStorage` に置いてはいけないのか。
   ▶ 答え: `localStorage` のデータは常に JavaScript からアクセス可能で、XSS が1件あれば全部盗まれる。Cookie なら `httpOnly` フラグで JavaScript からの読み取りを防げるが、`localStorage` にはこの保護がない。

5. Web SQL Database は現在どういう扱いか。代替は何か。
   ▶ 答え: 2010年に W3C により非推奨とされ、すべての主要ブラウザから削除されている（Chromium はバージョン 119 / 2023年10月で打ち切り）。使ってはならない。現行標準は IndexedDB で、SQL が必要なら `sqlite-wasm` を IndexedDB または OPFS の上で動かす。

6. Cross-Site WebSocket Hijacking (CSWSH) の根本原因と、主な防御を挙げよ。
   ▶ 答え: ブラウザが WebSocket ハンドシェイクに Cookie を自動で含めるため、悪意あるサイトが被害者の認証済み接続を開けてしまう。防御は、ハンドシェイクの `Origin` ヘッダを allowlist で検証、`SameSite` Cookie、CSRF トークンの併用、トークンベース認証。

7. Reverse Tabnabbing を防ぐために HTML リンクへ付けるべき属性は何か。
   ▶ 答え: `rel="noopener noreferrer"`。`noopener` が `window.opener` 経由の戻りリンクを切り、`noreferrer` が referrer 情報の漏れも防ぐ。`window.open` では windowFeatures に `noopener,noreferrer` を付け、さらに `newWindow.opener = null;` でリセットする。

8. `sandbox` 属性を値なし（`sandbox=""`）で付けると、iframe 内では何が無効化されるか。
   ▶ 答え: すべてのマークアップがユニークオリジン扱いになり、フォームとスクリプトが無効化、リンクは他のブラウジングコンテキストを target にできず、自動発火する機能がブロックされ、すべてのプラグインが無効化される。トークンを追加するたびに制限が緩む。

9. 資格情報・PII の入力欄がブラウザに保存されるのを防ぐ HTML5 属性を4つ挙げよ。
   ▶ 答え: `spellcheck="false"`、`autocomplete="off"`、`autocorrect="off"`、`autocapitalize="off"`。

10. 侵害された Service Worker が特に危険なのはなぜか。運用上の必須対策は何か。
    ▶ 答え: 登録スコープ内のすべてのネットワークリクエストを傍受でき、unregister されるかキャッシュ TTL が切れるまで悪意ある挙動が続く。対策として、自オリジンからのみ HTTPS で登録し、`scope`/`Service-Worker-Allowed` でスコープを絞り、文書化されたキルスイッチ（hotfix で配れる unregister フロー）を用意し、機密レスポンスは `Cache-Control: no-store` でキャッシュさせない。

## 出典

- https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html
- https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md
- https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/WebSocket_Security_Cheat_Sheet.md
- https://fetch.spec.whatwg.org/#http-cors-protocol
- https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox
- https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
- https://developer.mozilla.org/en-US/docs/Web/API/Cache
- https://developer.mozilla.org/en-US/docs/Web/API/Window/open
- https://sqlite.org/wasm/doc/trunk/about.md
- https://www.w3.org/TR/2021/WD-geolocation-20211124/#security
- https://owasp.org/www-project-secure-headers/
- https://owasp.org/www-community/attacks/Reverse_Tabnabbing
- https://github.com/righettod/poc-websocket
- https://github.com/advisories/GHSA-f53g-frr2-jhpf
- https://spring.io/security/cve-2018-1270
- https://cwe.mitre.org/data/definitions/1385.html
- https://github.com/websockets/wscat

<!-- sources: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html, https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md, https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html, https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/WebSocket_Security_Cheat_Sheet.md, https://owasp.org/www-project-secure-headers/, https://owasp.org/www-community/attacks/Reverse_Tabnabbing, https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API, https://cwe.mitre.org/data/definitions/1385.html -->
<!-- terms: HTML5 Security Cheat Sheet, Web Messaging, postMessage, targetOrigin, MessageEvent, オリジン, 同一オリジンポリシー, CORS, Access-Control-Allow-Origin, プリフライト, Server-Sent Events, EventSource, WebSocket, WSS, RFC 6455, CSWSH, Origin検証, permessage-deflate, maxPayload, JSON.parse, Local Storage, sessionStorage, httpOnly, IndexedDB, Web SQL Database, OPFS, sqlite-wasm, Web Crypto CryptoKey, Geolocation, Web Worker, Tabnabnabbing, noopener, noreferrer, Referrer-Policy, opener, sandbox iframe, X-Frame-Options, Clickjacking, framebusting, autocomplete, Service Worker, Cache API, Application Cache, Cache-Control no-store, Service-Worker-Allowed, Progressive Enhancement, OWASP Secure Headers, CWE-1385 -->
<!-- self-read: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html | 描画版がエグレスポリシーで取得不可。同一内容の正典Markdownで代替 -->
<!-- self-read: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html | 描画版がエグレスポリシーで取得不可。同一内容の正典Markdownで代替 -->
<!-- self-read: https://owasp.org/www-community/attacks/Reverse_Tabnabbing | 描画版がエグレスポリシーで取得不可。図版2枚とUpdate 2023の留保は自分で開いて確認 -->
<!-- self-read: https://owasp.org/www-project-secure-headers/ | 描画版がエグレスポリシーで取得不可。ヘッダ実体は機械可読JSONで代替、解説文は自分で開く -->
