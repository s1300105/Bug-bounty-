## WebSocketハンドシェイクとフレームの基礎

### この節で学ぶこと

WebSocketは、GraphQL Subscriptionsを含む多くのリアルタイムWeb機能の下層で使われている双方向通信プロトコルである。後続の章でWebSocketを狙った攻撃（Cross-Site WebSocket Hijacking、メッセージインジェクションなど）を扱う前提として、まず「WebSocketがどう確立され、どう動くのか」というプロトコルレベルの仕組みを理解しておく必要がある。攻撃・防御いずれの観点でも、ハンドシェイクの構造とオリジン検証の欠如がなぜ問題になるのかを、パケットレベルで説明できることが本章の目標である。

### WebSocketとは何か

WebSocketは、HTTPの一往復リクエスト・レスポンスモデルとは異なり、1本のTCP接続上でクライアントとサーバーが非同期かつ双方向にメッセージを送り合える持続的な通信路（long-lived connection）である。PortSwigger Web Security Academyは、WebSocketを「HTTP上で開始され、双方向の非同期通信を伴う長寿命の接続を提供する」ものと説明している。

> 出典: Testing for WebSockets security vulnerabilities — https://portswigger.net/web-security/websockets

チャットアプリケーション、株価のリアルタイム更新、GraphQL Subscriptions、オンラインゲームの状態同期など、サーバーからクライアントへ能動的にデータをプッシュする必要がある用途で使われる。HTTPのポーリング（クライアントが定期的にリクエストを送り更新の有無を確認する方式）と比べ、コネクションを維持したままサーバーから即座にプッシュできるため、レイテンシとオーバーヘッドの両方で有利である。

MDNのWebSocket APIドキュメントでは、これを「ユーザーのブラウザとサーバー間の双方向インタラクティブ通信を可能にし、サーバーへのポーリングなしにメッセージを送受信できる」機能と位置づけている。

> 出典: The WebSocket API (WebSockets) — https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API

### ハンドシェイク: HTTPからWebSocketへの「アップグレード」

WebSocketの最大の設計上の特徴は、独自のTCPポートやレイヤーを新設するのではなく、**既存のHTTP接続をアップグレードする形で確立される**点である。これにより、既存のHTTPインフラ（プロキシ、ロードバランサ、ファイアウォール、80/443番ポート）をそのまま流用できる。

ハンドシェイクの流れは次の通りである。

1. クライアントが通常のHTTP GETリクエストを送信するが、`Upgrade: websocket` ヘッダーなど特別なヘッダー群を付与する。
2. サーバーがそのリクエストを検証し、WebSocketへの切り替えに同意する場合は **HTTPステータス101 (Switching Protocols)** を返す。
3. 以降、同じTCPコネクション上のプロトコルはHTTPからWebSocketフレーム形式に切り替わり、双方が任意のタイミでメッセージを送信できるようになる。

PortSwigger Academyはこの流れを次のように要約している——クライアントがHTTPリクエストを開始し、サーバーがHTTP 101ステータスで応答し、その後接続は永続的な双方向メッセージングを行うWebSocketプロトコルへ遷移する。

> 出典: Testing for WebSockets security vulnerabilities — https://portswigger.net/web-security/websockets

実際のハンドシェイクリクエストは次のような形になる（HackTricksより引用）。

```http
GET /chat HTTP/1.1
Host: normal-website.com
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: wDqumtseNBJdhkihL6PW7w==
Connection: keep-alive, Upgrade
Upgrade: websocket
```

> 出典: WebSocket Attacks — https://hacktricks.wiki/en/pentesting-web/websocket-attacks.html（自動取得はEGRESS/402エラーによりブロックされたため、同内容のミラーページ https://angelica.gitbook.io/hacktricks/pentesting-web/websocket-attacks から取得した）

これに対し、サーバーは以下のようなレスポンスを返す（一般的な構造。RFC 6455準拠）。

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

このリクエスト/レスポンスの実際のCookieやAuthorizationヘッダーは、通常のHTTPリクエストと同様に付与される点が重要である。ブラウザの `WebSocket` コンストラクタでは、開発者が任意のカスタムヘッダーを追加することはできないが、**同一オリジンに対して送信されるCookieは自動的にハンドシェイクリクエストに付与される**。これが後述するCross-Site WebSocket Hijacking（CSWSH）の根本的な原因になる。

### ハンドシェイクの主要ヘッダーと役割

MDNは、WebSocketハンドシェイクで使われる `Sec-WebSocket-*` 系ヘッダーを次のように整理している。

| ヘッダー | 種別 | 役割 |
|---|---|---|
| `Sec-WebSocket-Key` | リクエスト | クライアントが生成するナンス（一度限りのランダム値）を含み、クライアントが明示的にWebSocketを開こうとしていることを確認するために使う（ブラウザが自動付与） |
| `Sec-WebSocket-Accept` | レスポンス | サーバーがアップグレードに同意する意思を示す。値は `Sec-WebSocket-Key` から計算される |
| `Sec-WebSocket-Version` | リクエスト/レスポンス | 使用するWebSocketプロトコルのバージョンを示す。バージョンが一致しない場合、レスポンスにサーバーが対応するバージョン一覧が返る |
| `Sec-WebSocket-Protocol` | リクエスト/レスポンス | クライアントが対応するサブプロトコルの一覧（優先順）。レスポンスでは選択されたサブプロトコルを示す |
| `Sec-WebSocket-Extensions` | リクエスト/レスポンス | クライアントが対応する拡張機能の一覧。レスポンスでは選択された拡張を示す |

> 出典: The WebSocket API (WebSockets) — https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API

ここで重要なのは、**`Sec-WebSocket-Key`は認証やセッション管理のための値ではない**という点である。HackTricksが明記している通り、この値は「Base64エンコードされたランダム値」であり、目的は「認証のためではなく、レスポンスが誤設定されたキャッシュサーバーからのものではないことを確認するため」である。つまり、この値は中間者のキャッシュプロキシが古いレスポンスを誤って返してしまう事故を防ぐための仕組みであり、CSRFトークンのような改ざん防止・なりすまし防止の役割は持たない。

> 出典: WebSocket Attacks — https://hacktricks.wiki/en/pentesting-web/websocket-attacks.html（ミラー経由で取得）

サーバー側は、受け取った `Sec-WebSocket-Key` に固定のGUID文字列（`258EAFA5-E914-47DA-95CA-C5AB0DC85B11`、RFC 6455で規定）を連結してSHA-1ハッシュを取り、Base64エンコードした値を `Sec-WebSocket-Accept` として返す。これによりクライアントは、応答が（単なるキャッシュされた古いレスポンスではなく）今回のリクエストに対して生成された正規の応答であることを機械的に検証できる。**この計算はサーバーの実装が正しいことの確認であり、リクエストの送信元（オリジン）やユーザーの身元を保証するものではない**——この区別を理解していないと、次章以降で扱うCSWSHの本質的な脆弱性ポイントを見誤ることになる。

### なぜオリジン検証の欠如が問題になるのか(仕組みレベル)

WebSocketの `WebSocket` コンストラクタ（JavaScript API）には、通常のブラウザの同一オリジンポリシー（SOP: Same-Origin Policy、あるスクリプトが自分と異なるオリジンのリソースに自由にアクセスすることを制限する仕組み）に相当する制約が、fetchやXHRほど厳格には組み込まれていない。具体的には、あるオリジン（例: `https://evil.example`）で動くJavaScriptから、別オリジン（例: `wss://victim.example/chat`）へ向けてWebSocket接続を開始すること自体はブラウザによってブロックされない。

このときブラウザは、HTTPリクエストと同様に、接続先ドメインに紐づくCookieを自動的にハンドシェイクリクエストへ添付する。つまり、被害者が事前に `victim.example` へログイン済みでセッションCookieを保持していれば、`evil.example` 上の悪意あるページが開いたWebSocket接続にも、そのCookieが自動的に乗ってしまう。サーバー側がハンドシェイク時に `Origin` ヘッダー（そのリクエストを発行したページのオリジンをブラウザが自動付与するヘッダー）を検証していない場合、サーバーは「正規のユーザーが正規のページから接続してきた」のか「攻撃者のページ経由でCookieだけが流用されている」のかを区別できない。

これはCSRF（Cross-Site Request Forgery、被害者のブラウザに意図しないリクエストを強制的に送らせる攻撃）と同じ構造の脆弱性であり、WebSocket版のCSRFとして **Cross-Site WebSocket Hijacking (CSWSH)** と呼ばれる。検索結果として得られた複数の技術解説は共通して、この脆弱性が「WebSocketハンドシェイクがHTTP CookieのみによってCSRFトークン等の追加防御なしに認証されている場合に発生する」ものであり、攻撃者は悪意あるページをホストして被害者のブラウザからクロスオリジンのWebSocket接続を発生させ、それが被害者のアプリケーションとのセッションの一部として扱われることを悪用する、と説明している。

> 出典: WebSocket Attacks（HackTricksの検索結果に基づく要約。原文ページは自動取得できなかったため、Web検索結果から該当箇所を引用） — https://hacktricks.wiki/en/pentesting-web/websocket-attacks.html

CSWSHの攻撃・防御の詳細（悪意あるHTMLページの構造、実際の情報窃取手口、SameSite Cookieやトークンベースの防御策の具体的な実装方法など）は、本テキストの別章（Cross-Site WebSocket Hijackingを扱う章）で詳しく扱う。本節ではあくまで、「なぜこの脆弱性が成立するのか」をハンドシェイクの仕組みレベルで理解することが目的である。

なお、防御の要点だけをここで一言でまとめておくと、次の2点に集約される。

- サーバー側はハンドシェイク時に `Origin` ヘッダーを検証し、許可したオリジン一覧に含まれないリクエストは101レスポンスを返さず拒否する。
- Cookieのみに依存した認証ではなく、CSRFトークンに相当する予測不可能なper-userトークンをハンドシェイクの一部として要求する、またはCookieに `SameSite=Lax`/`Strict` 属性を付与し、クロスオリジンページからの自動送信を防ぐ。

> 出典: WebSocket Attacks（HackTricks、Web検索結果より引用） — https://hacktricks.wiki/en/pentesting-web/websocket-attacks.html

### WebSocketフレームの基礎構造

ハンドシェイクが完了し101レスポンスが返った後、通信はHTTPのテキストベースのリクエスト/レスポンス形式から、**フレーム（frame）**という単位でやり取りされるバイナリプロトコルに切り替わる。フレームはRFC 6455で規定されるバイナリ形式のメッセージ単位であり、大きく分けて次のようなタイプがある。

- **テキストフレーム**: UTF-8エンコードされた文字列データを運ぶ（JSONメッセージなど、GraphQL Subscriptionsのペイロードもここに含まれる）。
- **バイナリフレーム**: 任意のバイナリデータを運ぶ。
- **制御フレーム**: 接続の生存確認を行う `Ping`/`Pong` フレームや、接続終了を通知する `Close` フレームなど。

重要な設計上の特徴として、**クライアントからサーバーへ送られるフレームは必ずマスキング(XORベースの単純な難読化)されなければならない**とRFC 6455で規定されている。これは、プロキシキャッシュポイズニング等、悪意あるプロキシがフレームの内容を予測してキャッシュを汚染する攻撃を防ぐための仕様であり、暗号学的な秘匿性を提供するものではない（マスクキーはフレーム内に平文で含まれるため、通信を観測できる攻撃者は容易に復元できる）。この点は、「マスキングされているから安全」と誤解しないよう注意が必要である。機密性が必要な通信は、TLS（`wss://`）によって別途保護しなければならない。

### JavaScript側のAPI: WebSocketコンストラクタの基本

ブラウザ上でWebSocket接続を確立する最小のコードは以下の通りである。

```javascript
const socket = new WebSocket('wss://example.com/chat');

socket.onopen = (event) => {
  socket.send('Hello Server!');
};

socket.onmessage = (event) => {
  console.log('受信:', event.data);
};

socket.onclose = (event) => {
  console.log('接続がクローズされました', event.code, event.reason);
};

socket.onerror = (event) => {
  console.error('WebSocketエラー', event);
};
```

`WebSocket` コンストラクタにURLを渡すと、ブラウザは自動的に上述のハンドシェイクリクエストを生成し、Upgradeヘッダー群を付与する。開発者がこのハンドシェイクリクエストへ任意のカスタムヘッダー（例: `Authorization: Bearer <token>`）を追加することはできない——これがWebSocketのAPI仕様上の制約であり、実務では多くの実装がCookieセッションに頼らざるを得ない理由の一つになっている（これもCSWSHが多くのアプリケーションで現実的な脅威になる背景である）。

MDNのWebSocket APIドキュメントは、2つの実装系統を区別している。

- **`WebSocket`**: 安定していて広くサポートされているが、バックプレッシャー（受信速度が処理速度を上回った場合の流量制御）に対応していない。メッセージの受信速度が処理速度を上回ると、メモリのバッファリング増加やアプリケーションの応答性低下を招く可能性がある。
- **`WebSocketStream`**: Streams APIを使ったPromiseベースの代替インターフェースで、自動的なバックプレッシャー制御に対応する。ただし現時点（2026年）では非標準であり、対応しているレンダリングエンジンは1つのみで、実務での利用はまだ限定的である。

> 出典: The WebSocket API (WebSockets) — https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API

また、開いたWebSocket接続はページのbfcache（Back-Forward Cache、ブラウザの戻る/進む操作を高速化するためにページ状態をメモリ上に保持する仕組み）への格納を妨げるため、MDNはページ利用終了時に明示的に接続をクローズすることを推奨している。これはセキュリティというより性能上の注意点だが、長時間張りっぱなしのWebSocket接続を放置する実装が珍しくない点は、後述するセッション管理やリソース枯渇系の問題にも関係してくる。

### 入力バリデーションの観点: WebSocketは「新しい攻撃面」ではなく「同じ脆弱性の新しい経路」

PortSwigger Academyが強調している通り、WebSocket経由でやり取りされるメッセージも、最終的にはサーバー側またはクライアント側でパース・処理される点で、HTTPリクエストと本質的に変わらない。したがって、SQLインジェクション、XSS（クロスサイトスクリプティング）、パストラバーサルなど、通常のHTTPベースのWebアプリケーションで見られるほぼすべての脆弱性クラスが、WebSocketメッセージ経由でも同様に成立しうる。

例えば、チャットアプリケーションでユーザーが送信したメッセージをそのままクライアント側でDOMに挿入するような実装があれば、次のようなペイロードを含むメッセージによって、受信側ブラウザで任意のJavaScriptが実行される可能性がある。

```json
{"message":"<img src=1 onerror='alert(1)'>"}
```

> 出典: Testing for WebSockets security vulnerabilities — https://portswigger.net/web-security/websockets

このペイロードが機能する理由は通常のDOM-based XSSとまったく同じで、`<img>` タグの `src` 属性に存在しないリソース（`1`）を指定すると `onerror` イベントが発火し、そこに埋め込まれたJavaScriptコード（`alert(1)`）が実行される、というブラウザのレンダリング挙動を悪用している。WebSocketが特別なのは、この危険なペイロードがHTTPリクエストボディやクエリパラメータではなく、フレームという別の経路で運ばれてくる点だけであり、**受信側での出力エンコーディングやサニタイズが必要である**という対策の本質は変わらない。

WebSocketの通信内容をテストする際、PortSwigger Academyは、HTTPリクエストと同様にBurp Suiteのようなインターセプトプロキシを使う手法を紹介している。

- **Burp Proxy**: クライアント→サーバー、サーバー→クライアント双方のメッセージをインターセプトし、検査・改変できる。
- **Burp Repeater**: 個々のメッセージを繰り返し送信したり、双方向いずれの方向でも新規メッセージを作成したり、メッセージ履歴全体を閲覧したり、過去のメッセージを編集して再送信したりできる。
- **ハンドシェイクの改変**: ハンドシェイクリクエスト自体をクローンし、再接続前に内容を修正することも可能。

> 出典: Testing for WebSockets security vulnerabilities — https://portswigger.net/web-security/websockets

また、Web検索で得られた関連情報によれば、HackTricksはさらに専門的なツールとして次を挙げている。

- **Burp Suite + socketsleuth拡張**: WebSocket通信のMitM（Man-in-the-Middle）インターセプトを強化する拡張機能。
- **WSSiP**: Socket.IOやWebSocket通信のキャプチャ・インターセプトに特化したツール。
- **wsrepl**: WebSocketをテストするためのインタラクティブなREPL(Read-Eval-Print Loop、対話的にコマンドを入力し即座に結果を確認できる実行環境)。
- **websocat**: 生のWebSocket接続をコマンドラインから扱うためのCLIツール。

> 出典: WebSocket Attacks（HackTricksミラーページより取得） — https://hacktricks.wiki/en/pentesting-web/websocket-attacks.html

これらのツールは、本テキストの以降の章でCSWSHやメッセージインジェクションといった具体的な攻撃パターンを検証・防御設計する際の共通基盤として登場する。

### まとめ

- WebSocketは、HTTPのハンドシェイク（GETリクエスト＋`Upgrade: websocket`ヘッダー群）から始まり、サーバーがHTTP 101を返すことでプロトコルが切り替わる、持続的な双方向通信路である。
- `Sec-WebSocket-Key`/`Sec-WebSocket-Accept` は、プロキシキャッシュの誤動作防止のための仕組みであり、認証やオリジン検証の役割は持たない。
- ハンドシェイク時、ブラウザは通常のHTTPリクエストと同様にCookieを自動付与するが、`WebSocket`コンストラクタは同一オリジンポリシーによる発信元制限を厳格には課さない。この非対称性が、サーバー側で `Origin` ヘッダーの検証を怠った場合にCSWSHという深刻な脆弱性を生む根本原因である。
- 接続確立後のフレームはRFC 6455で規定されたバイナリ形式であり、クライアント発フレームは必ずマスキングされるが、これは秘匿性のためではなくキャッシュ汚染防止のための仕様である。機密性確保には必ず `wss://`(TLS)を使う。
- WebSocketメッセージも最終的にはアプリケーションによってパースされるデータであるため、XSSやインジェクション系の脆弱性がHTTPと同様に成立しうる。受信データは常に「信頼できない入力」として扱い、検証・エンコーディングを行う必要がある。
