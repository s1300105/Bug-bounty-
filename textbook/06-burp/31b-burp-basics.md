# Burp Proxy 徹底解説 — 設定・履歴・不可視プロキシとクライアントサイド診断

> **この節で分かること**
> - Burp Proxy の設定 9 グループ（listener／interception／Response modification／match and replace ほか）が何をするのかを説明できる
> - Response modification rules と match and replace で「クライアントサイドだけの防御」を機械的に暴く手順を自分で実行できる
> - HTTP history／WebSockets history の列・フィルタ・Bambda を使ってトラフィックを絞り込み、注目すべき通信を見つけられる
> - TLS pass through と不可視プロキシ（invisible proxying）が必要になる場面と、その副作用・危険を説明できる
> - Connections／TLS 設定で上流プロキシ・ホスト名解決・クライアント証明書を扱えるようになる
> - これらの機能を「許可された診断の範囲でのみ使う」倫理的な前提を説明できる

**元資料**: https://portswigger.net/burp/documentation/desktop/tools/proxy （原典は取得できず二次情報ベース。Burp Suite 同梱のオフライン公式ドキュメント HTML＝PortSwigger 配布・内部ビルド 32146 相当のミラーから逐語取得）
**関連する節**: 「Burp Suite 入門 — 導入とブラウザ／CA 証明書」（本章の前半・パート1）

---

## 1. この節の位置づけ

Burp Suite（バープ・スイート）とは、Web アプリケーションのセキュリティテスト用の包括的なツール群のこと。その中核が **Burp Proxy**（バープ・プロキシ）であり、ブラウザと標的アプリの間に立つローカルな Web プロキシサーバとして、双方向のトラフィックを傍受（intercept）・確認（inspect）・改変（modify）できる。HTTPS も扱える。

本章の前半（パート1）では、ダウンロード・インストール・プロジェクトファイルの選択・CA 証明書の導入までを扱った。この節（パート2）では、いよいよ Burp Proxy の「設定の中身」と「履歴の使い方」に踏み込む。

〔補足〕プロキシとは、通信の中継役として間に入るサーバのこと。たとえば、あなたのブラウザが直接サイトへ行く代わりに、いったん Burp を経由させると、Burp がすべてのリクエスト・レスポンスを覗いたり書き換えたりできる。これがクライアントサイド脆弱性ハンティングの基礎装置になる。

この節で扱う機能は、とくに「クライアント側（ブラウザ側）だけで守っている箇所」を暴くのに強い。読み進めながら、常に「なぜこの設計か → どう動くか → 攻撃者はどこを突くか → どう守るか」の順で理解してほしい。

---

## 2. Proxy 設定の全体像（9 グループ）

Burp のメニュー **Settings > Tools > Proxy** を開くと、Proxy に関する設定がまとまっている。公式ドキュメントは「The **Proxy** page in the **Settings** dialog contains settings for the following:」として、次の 9 グループを挙げている。

| # | 設定グループ | 保存レベル |
| --- | --- | --- |
| 1 | Proxy listeners | project settings |
| 2 | Request and response interception rules | project settings |
| 3 | WebSocket interception rules | project settings |
| 4 | Response modification rules | project settings |
| 5 | HTTP and WebSocket match and replace rules | project settings |
| 6 | TLS pass through | project settings |
| 7 | Proxy history logging | **user settings**（マシン上の全 Burp インストールに適用） |
| 8 | Default Proxy interception state | **user settings** |
| 9 | Miscellaneous | project settings |

### 2-1. project settings と user settings の違い

「保存レベル」の欄には project settings と user settings がある。この区別は初学者がよく混乱するので、先に押さえておく。

〔補足（一般知識）〕project settings は project file（プロジェクトファイル）に保存され、当該プロジェクトのみに適用される。user settings はユーザープロファイル側に保存され、全プロジェクトに適用される。覚え方はこうだ。「設定が新しいプロジェクトに引き継がれないなら project 設定、どのプロジェクトにも付いてくるなら user 設定」。

上表を見ると、**Proxy history logging**（履歴ロギング）と **Default Proxy interception state**（起動時の傍受オン／オフ）だけが user settings で、残りはすべて project settings であることが分かる。つまり傍受ルールやマッチ＆リプレースは「そのプロジェクト固有」であり、案件ごとに独立して持てる。

---

## 3. Proxy listeners（リスナー）

### 3-1. リスナーとは何か（なぜ・どう動く）

**Proxy listener**（プロキシリスナー）とは、ブラウザからの接続を待ち受けるローカルな HTTP プロキシサーバのこと。公式定義（逐語）は次のとおり。

> 「A proxy listener is a local HTTP proxy server that listens for incoming connections from the browser. It enables you to monitor and intercept all requests and responses.」

つまりリスナーは「入ってくる接続を待つ耳」であり、これがあるからこそ全リクエスト・レスポンスを監視・傍受できる。既定の設定はこうだ。

> 「By default, Burp creates a single listener on **port 8080** of the **loopback interface**. The default listener enables you to use Burp's browser to test virtually all browser-based web applications.」

= 既定では、Burp は **loopback インターフェースのポート 8080** に単一のリスナーを作る。loopback（ループバック）とは、自分自身（127.0.0.1）を指す仮想的なネットワーク口のこと。外部からは見えないので安全だ。この既定リスナーだけで、Burp 内蔵ブラウザを使ってほぼすべてのブラウザベースの Web アプリをテストできる。

特殊なアプリや、ブラウザ以外の HTTP クライアントを扱うときにだけ、リスナーを追加・設定する必要が出てくる。**Add** / **Edit** ボタンで **Add a new proxy listener** ダイアログを開き、タブごとに設定する。

### 3-2. Binding（どこにバインドするか）— 事故の源

「These settings control how Burp binds the proxy listener to a local network interface:」

| 設定 | 説明 |
| --- | --- |
| **Bind to port** | ローカルインターフェース上のポートを指定する。「Make sure you use a free port that has not been bound by another application.」＝他のアプリに使われていない空きポートを使うこと。 |
| **Bind to address** | ローカルインターフェースの IP アドレスを指定。選択肢は ① **The loopback interface only.**（loopback のみ）② **All interfaces.**（全インターフェース）③ **A specific local IP address.**（特定の IP） |

ここで最重要の警告（逐語）がある。

> **Note**: 「If the listener is bound to all interfaces or to a specific non-loopback interface, other computers may be able to connect to the listener.」

つまり **all interfaces や非 loopback インターフェースにバインドすると、他のコンピュータからリスナーに接続できてしまう**。これは、意図せず「誰でも使えるオープンプロキシ」を作ってしまう危険を意味する。攻撃者から見れば、診断者のマシンで開きっぱなしのリスナーは格好の踏み台になる。

**どう守るか**: 原則として loopback のみにバインドする。all interfaces が必要になるのはモバイル端末や thick client を実機で通すときだけであり、そのときも診断ネットワークを隔離し、終わったら必ず戻す。診断環境の衛生としてノートに残しておくべき点である。

### 3-3. Request handling（転送先の制御）

「These settings control whether Burp redirects the requests received by the listener:」

| 設定 | 説明 |
| --- | --- |
| **Redirect to host** | 「Burp forwards every request to the host, regardless of the target requested by the browser.」ブラウザが要求した宛先に関係なく、指定ホストへ全リクエストを転送する。注記: 転送先が別の `Host` ヘッダを期待するなら、match and replace で `Host` を書き換える必要がある。 |
| **Redirect to port** | ブラウザの要求ポートに関係なく、指定ポートへ全リクエストを転送する。 |
| **Force use of TLS** | 「Enable this setting to use HTTPS in all outgoing connections, even if the incoming request uses HTTP.」入ってくるリクエストが HTTP でも、出ていく接続はすべて HTTPS にする。 |
| **Support invisible proxying** | 「This setting enables non-proxy-aware clients to connect directly to the listener.」proxy 非対応クライアントが直接つなげるようにする（詳細は後述の不可視プロキシ）。 |

**Force use of TLS** には攻撃的な用途の注記が付いている（逐語）。

> 「To carry out sslstrip-like attacks, use this option with the TLS-related response modification settings. This type of attack downgrades an application that enforces HTTPS to plain HTTP, for a victim whose traffic is unwittingly being proxied through Burp.」

= sslstrip 風の攻撃を仕掛けるには、この設定を TLS 系の Response modification 設定と組み合わせる。これは「HTTPS を強制しているアプリを平文 HTTP に格下げする」攻撃で、被害者の通信が知らぬ間に Burp を経由しているときに成立する。**攻撃者はここを突く**。逆に診断者の視点では、「本当にその強制が破れないか（HSTS が効いているか）」を検証する道具になる（第 5 節で扱う）。

なお、これらの転送オプションは個別に使える。たとえばホストだけリダイレクトしつつ、ポートとプロトコルは元のまま保つこともできる。

### 3-4. Certificate（クライアントに提示するサーバ証明書）

「These settings control the server TLS certificate that is presented to TLS clients.」傍受プロキシを使うと TLS 周りの問題が起きるので、それを解消するための設定である。

まず、初学者が必ず出会う「取り消し線」についての公式注記（逐語）。

> 「In Burp's browser, you may notice that HTTPS is struck-through in the address bar as a TLS alert. This alert arises because the browser detects that it is not communicating directly with the authentic web server. This isn't an issue: it's a result of deliberately proxying your traffic through Burp. You can ignore it and continue to use the browser as usual.」

= アドレスバーで HTTPS に取り消し線が付いても、それは「本物のサーバと直接通信していない」ことをブラウザが検知しただけであり、Burp を意図的に経由させている結果なので **正常**。無視してよい。

証明書の生成方式は 4 択ある。

| オプション | 説明 |
| --- | --- |
| **Use a self-signed certificate** | 自己署名証明書を提示する。「This always causes a TLS alert.」＝常に TLS 警告が出る。 |
| **Generate CA-signed per-host certificates** | **既定**。「Burp creates a unique, self-signed Certificate Authority (CA) certificate on installation.」インストール時に一意の CA 証明書を作り、接続ごとにホスト用の証明書を CA で署名して生成する。 |
| **Generate a CA-signed certificate with a specific hostname** | 指定ホスト名の単一証明書を全 TLS 接続に使う。「Use this option if you perform invisible proxying, as the client does not send a CONNECT request, so Burp can't identify the required hostname prior to the TLS negotiation.」不可視プロキシで使う。 |
| **Use a custom certificate** | 特定の証明書を読み込む。「the certificate must be in PKCS#12 format with a `.p12` file extension」＝PKCS#12 形式（`.p12`）が必須。 |

既定が per-host 生成であることを押さえておこう。これは「ホストごとに、CA が署名した本物らしい証明書をその場で作る」方式で、ブラウザに CA を信頼させておけば警告なく HTTPS を復号できる。

### 3-5. TLS Protocols / HTTP（プロトコル制御）

- **TLS Protocols**: ブラウザとの TLS ネゴシエーションで使うプロトコルを制御する。「Use the default protocols of your Java installation.」（Java 既定）か「Use custom protocols.」（明示選択）を選ぶ。
- **HTTP**: リスナーがクライアントに HTTP/2 を許すかどうか。既定で有効。クライアントの HTTP/2 実装に問題があるときは無効化する。「This setting does not change the connection between Burp and the server.」＝Burp とサーバの間の接続は変わらない（そちらは別の HTTP settings で変える）。

---

## 4. Interception rules（何を止めるか）

### 4-1. Request/Response interception rules

「The **Request interception rules** and **Response interception rules** settings control which messages are stalled for you to view and edit in the **Proxy > Intercept** tab.」＝どのメッセージを **Proxy > Intercept** タブで止めて確認・編集するかを決める。

ルールの追加手順は次のとおり。

1. **Intercept requests / responses based on the following rules** を選ぶ。
2. **Add** で **Add request interception rule** ダイアログを開く。
3. ルールの詳細を指定する。

| 項目 | 説明 |
| --- | --- |
| **Boolean operator** | 上のルールとの結合演算子。**AND** か **OR** を選ぶ。 |
| **Match type** | 一致対象の属性。例: ドメイン名、IP アドレス、プロトコル。 |
| **Match relationship** | **Matches** または **Does not match**。 |
| **Match condition** | 一致に使う値。「You can use regular expressions to define complex matching conditions.」正規表現も使える。 |

4. **OK** でルールを作成する。

重要なのは順序依存であること（逐語）。

> 「Each rule is combined to the rules above in order, using the selected boolean operator.」

各ルールは上のルールと順番に結合される。**Up** / **Down** で並べ替えられ、**順序が結果に影響する**。チェックボックスで有効／無効を切り替えられる。

### 4-2. 改変時の自動補正

傍受メッセージを手で書き換えると、しばしば壊れたリクエスト・レスポンスができてしまう。それを防ぐのが次の設定。

| 設定 | 説明 |
| --- | --- |
| **Automatically update Content-Length header when the request / response is edited** | 本文（body）を書き換えたとき `Content-Length` を正しい長さに自動更新する。「This is normally essential when the HTTP body is modified.」 |
| **Automatically fix missing or superfluous new lines at end of request** | よくある改行ミスを自動修正。① ヘッダの直後に空行が無ければ追加、② URL エンコードされたパラメータで終わる body の末尾の改行を除去。 |

〔補足〕`Content-Length` を手で合わせるのは面倒なので、この自動更新は基本的にオンにしておくとよい。逆に「わざと不整合を起こして挙動を見る」高度な検証をするときだけ外す。

### 4-3. WebSocket interception rules

WebSocket（ウェブソケット）とは、ブラウザとサーバが接続を張りっぱなしにして双方向にメッセージを送り合う通信方式のこと。チャットや通知でよく使われる。Burp はこれも傍受できる。

| 設定 | 説明 |
| --- | --- |
| **Intercept client-to-server messages** | クライアント→サーバのメッセージを傍受する |
| **Intercept server-to-client messages** | サーバ→クライアントのメッセージを傍受する |
| **Only intercept in-scope messages** | 「Select this setting if you only want to intercept WebSocket messages where the `upgrade` request is within the target scope of the project.」`upgrade` リクエストが target scope 内の WebSocket メッセージだけを傍受する。 |

ここで押さえるべきは、**スコープ判定が「`upgrade` リクエストが target scope 内かどうか」で行われる**点。WebSocket は最初に HTTP の `upgrade` リクエストで接続を確立するので、その最初のリクエストがスコープ内かで判定するわけだ。

---

## 5. Response modification rules — クライアントサイド制御の無効化（この章の核心）

「These settings control whether Burp automatically rewrites the HTML in application responses.」＝アプリのレスポンス内の HTML を Burp が自動で書き換えるかどうかを制御する。

**なぜ重要か**: Web アプリの中には、入力チェックや操作制限を「ブラウザ側の HTML／JavaScript だけ」で行っているものがある。これらは通信経路上で消せてしまう。Response modification rules は、その「クライアント側だけの防御」を機械的に暴き出すスイッチ群である。

### 5-1. データに対するクライアントサイド制御を取り除く

「You can use the following settings to remove client-side controls over data:」

| 設定 | 補足 |
| --- | --- |
| **Unhide hidden form fields** | 隠しフォームフィールドを表示する。「You can also select **Prominently highlight unhidden fields**, for easy identification on-screen.」＝画面上で目立たせるオプションもある。 |
| **Enable disabled form fields** | `disabled` 属性のフォームフィールドを有効化する |
| **Remove input field length limits** | 入力フィールドの長さ制限を除去する |
| **Remove JavaScript form validation** | JavaScript によるフォームバリデーションを除去する |

**攻撃者はどこを突くか**: たとえば「hidden な `price` フィールドで金額を持っている」「`maxlength` で入力長を制限している」「送信前に JS で形式チェックしている」——これらはすべてクライアント側の飾りに過ぎない。フィールドを暴き、制限を外し、検証を消せば、サーバ側が本当に検証しているかが試される。

### 5-2. テスト目的でクライアントサイドロジックを無効化する

「You can use the following settings to disable client-side logic for testing purposes:」

| 設定 |
| --- |
| **Remove all JavaScript** |
| **Remove `<object>` tags** |

とくに **Remove all JavaScript** は強力な診断手法である。JavaScript を全部消した状態で操作が通るなら、「その処理はサーバ側で守られておらず、JS の見た目だけで守っていた」ことが切り分けられる。逆に JS を消すと操作できなくなるなら、少なくとも何かがクライアント側に依存している。

公式は釘を刺している（逐語）。

> **Note**: 「These features are not designed to be used as a security defense in the manner of, for example, NoScript.」

= これらは NoScript のようなセキュリティ防御として使う設計ではない。あくまで診断用のスイッチである。

### 5-3. sslstrip 風の攻撃を届けるための設定

「You can use the following settings to deliver sslstrip-like attacks against a victim user whose traffic is unwittingly being proxied via Burp. Use these settings with the listener's **Force use of TLS setting** to effectively strip TLS from the user's connection:」

| 設定 |
| --- |
| **Convert HTTPS links to HTTP** |
| **Remove secure flag from cookies** |

これらはリスナーの **Force use of TLS**（第 3-3 節）と組み合わせて、ユーザーの接続から TLS を実質的に剥ぎ取る。

**どう守るか／倫理**: 〔補足（一般知識）〕これらは「許可された検証」の枠内でのみ使う機能である。TLS ストリップは被害者の通信を平文化するため、対象と範囲の明示的な許諾（バグバウンティのスコープ／ペネトレーションテスト契約）がない場合に他者のトラフィックへ適用してはならない。診断目的では「HTTPS を強制しているはずのアプリが、リンク書き換えや Secure フラグ除去に耐えるか（HSTS が効いているか）」の確認に使う。HSTS（HTTP Strict Transport Security）とは、ブラウザに「このサイトは今後必ず HTTPS で接続せよ」と指示する仕組みで、これが効いていれば sslstrip は失敗する。

---

## 6. HTTP and WebSocket match and replace rules

「The **HTTP match and replace rules** and **WebSocket match and replace rules** settings automatically replace parts of messages as they pass through the Proxy.」＝Proxy を通過するメッセージの一部を自動で置換する。

- HTTP のマッチ＆リプレースには **predefined rules**（定義済みルール）がいくつか含まれ、有効化すると定番作業を助ける。「These are disabled by default.」＝既定では無効。
- 「To only apply match and replace rules to items that are in the project scope, select **Only apply to in-scope items**.」＝スコープ内の項目だけに適用するオプションがある。

### 6-1. ルールの追加手順

「Each match and replace rule specifies a literal string or regex pattern to match, and a string to replace it with.」

1. **Add** で **Add match/replace rule** ダイアログを開く。
2. ルールの詳細を指定する。

| 項目 | 説明 |
| --- | --- |
| **Type** | HTTP なら対象を指定。例: **Request header** や **Response body**。 |
| **Direction** | WebSocket なら方向を指定。**Client to server** / **Server to client** / **Both directions**。 |
| **Match** | マッチさせたい文字列または正規表現。「If you leave this blank for an HTTP rule with the **Request header** or **Response header** type, the replacement string is added as a new header.」＝ヘッダ系で空にすると、置換文字列が新しいヘッダとして追加される。 |
| **Replace** | 置換後の文字列。「If you leave this blank for an HTTP rule with the **Request header** or **Response header** type, then any header that matches is removed.」＝ヘッダ系で空にすると、一致したヘッダが削除される。 |
| **Comment** | 任意の説明。 |

3. Match を正規表現として扱わせたいなら **Regex match** を選ぶ。
4. **OK** をクリック。「The new rule is automatically enabled.」

処理順序（逐語）: 「Burp executes the enabled match and replace rules **in turn** for each message, and makes any applicable replacements.」＝有効なルールを順番に実行する。**Edit** / **Remove** / **Up** / **Down** で編集・並べ替えできる。

### 6-2. ヘッダ操作のイディオム（必須）

上の表から導かれる、実務で毎日使うイディオムがある。

- **Match を空にすると → ヘッダ追加**
- **Replace を空にすると → ヘッダ削除**

たとえば `Accept-Encoding` を削除すれば、サーバが圧縮せずに返すため、レスポンスを平文でそのまま観察できる（公式が明記している用法）。応答ヘッダを書き換えれば、「そのヘッダが無い／緩い場合に何が起きるか」を安全に再現できる。これはクライアントサイド視点での「ヘッダ実験の主力」である。

### 6-3. 複数行にまたがる正規表現

「You can use regex syntax to match multi-line regions of a message body.」レスポンス本文が次の 2 行だけだとする。

```text
Now is the time for all good men
to come to the aid of the party
```

次の正規表現を使うと:

```text
Now.*the
```

次の範囲に一致する（改行をまたいで貪欲にマッチする）。

```text
Now is the time for all good men
to come to the aid of the
```

1 行内だけに限定したいなら、正規表現をこう変える。

```text
Now[^\n]*the
```

すると一致は次だけになる。

```text
Now is the
```

〔補足〕`.` は既定で改行以外の任意文字だが、Burp のこのマッチでは改行もまたいでいる点に注意。`[^\n]`（改行以外）を使えば 1 行に閉じ込められる。

### 6-4. グループの後方参照と置換文字列

**Match** 式では次が使える。

- 「Define groups using parentheses. Burp assigns groups a **1-indexed** reference number in order from left to right (with **group 0** representing the entire match).」＝丸カッコでグループを定義。左から右へ 1 始まりで番号が振られ、**グループ 0** は一致全体を表す。
- 後方参照はバックスラッシュ＋グループ番号。

たとえば「間に他のタグを挟まない開始タグと終了タグのペア」に一致させる正規表現。

```text
<([^/]\w*)[^>]*>[^>]*?</\1[^>]*>
```

**Replace** 側では `$` ＋グループ番号でグループを参照できる。たとえば上の正規表現に一致したタグ名を含める置換文字列。

```text
Replaced: $1
```

---

## 7. TLS pass through — 見えなくする代わりに素通しする

### 7-1. 定義と 3 つの利点

**TLS pass through**（TLS パススルー）とは、Burp が復号も改変も一切せずにトラフィックを通す機能のこと。公式定義（逐語）。

> 「TLS passthrough sends traffic through Burp Suite **without decrypting it or altering it in any way**. This has three major benefits:」

1. 「Performance improves dramatically.」＝性能が劇的に向上する。
2. 「Servers see the browser's original TLS fingerprint, which enables you to bypass some anti-bot defenses.」＝サーバが元の TLS フィンガープリントを見るので、一部の anti-bot 防御を回避できる。
3. 「You can eliminate TLS errors on the client. For example, in mobile applications that perform TLS certificate pinning.」＝クライアント側の TLS エラーを解消できる。たとえば証明書ピンニングをするモバイルアプリ。

〔補足〕TLS フィンガープリントとは、TLS のネゴシエーション（対応する暗号方式やその順序など）から作られる「クライアントの指紋」のこと。Burp が復号すると Burp（Java）の指紋に変わってしまい、bot 検知に引っかかることがある。パススルーなら本物のブラウザの指紋のまま通せる。証明書ピンニングとは、アプリが「この証明書以外は信頼しない」と決め打ちする仕組みで、Burp の CA を差し込めなくなる。

「If the application accesses multiple domains or uses both HTTP and HTTPS connections, you can pass through TLS connections to specific problematic hosts, and still work on other traffic as normal.」＝問題のあるホストだけパススルーし、他はふつうに扱える。

### 7-2. 重大な副作用

利点の裏には決定的な副作用がある（逐語）。

> **Note**: 「The Proxy intercept view and Proxy history do not display any details about requests or responses made via these connections.」

= パススルーした接続の内容は、**Intercept view にも Proxy history にも一切表示されない**。つまり「見えなくなる」。トレードオフを理解して使うこと。

### 7-3. パススルー先の追加手順

「To add a new TLS passthrough target, copy the URL and then click **Paste URL** to add the relevant web server to the list.」手動での構成は次のとおり。

1. **Add** で **Add TLS passthrough target dialog** を表示する。
2. ターゲットの詳細を指定する。
   - **Host or IP range** — 「This can be a regex or an IP range. Leave blank to match any item.」
   - **Port** — 「The port that TLS passthrough should apply on. Leave blank to match any item.」
3. **OK** でリストに追加する。

**Edit** / **Remove** も可能。「To upload a **CSV or text list** of targets, click **Load**」＝CSV やテキスト一覧を **Load** で読み込める。

- **Automatically add entries on client TLS negotiation failure** — クライアントの TLS ネゴシエーションが失敗したとき、そのサーバを自動でパススルー一覧に追加する。「A TLS negotiation may fail, for example, if **Burp's CA certificate is not recognized**.」＝Burp の CA が認識されないと失敗しうる。

### 7-4. スコープ外項目に一括適用する

「You can apply TLS passthrough for out-of-scope items automatically when you set the target scope:」

1. **Target > Site map** または **Proxy > HTTP history** から、target scope に追加したいホストを選ぶ。
2. 右クリックし **Add to scope** を選ぶ。**Proxy history logging** ウィンドウが現れる。
3. **Yes** をクリックすると、out-of-scope items に TLS passthrough が適用される。

これにより **Settings > Proxy** メニューで次が有効になる。

- **Miscellaneous > Don't send items to Proxy history or live tasks, if out of scope**.
- **TLS pass through > Apply to out-of-scope items** — 「this can only be enabled when the setting above is enabled.」＝**上の設定が有効なときにのみ有効化できる**。

つまり順序が決まっている。まず「スコープ外はログしない」を有効にしないと、「スコープ外をパススルー」は使えない。

---

## 8. Proxy history logging と Default interception state（user settings）

### 8-1. Proxy history logging

「Use this setting to manage whether Burp Proxy sends out-of-scope items to the history or live tasks when new items are added to the target scope.」＝スコープに新項目を追加したとき、スコープ外の項目を履歴・ライブタスクに送るかを管理する。プロジェクトデータの肥大を避けられる。3 択。

- **Stop logging out-of-scope items.**（スコープ外はログしない）
- **Ask me what to do each time.**（毎回聞く）
- **Do nothing.**（何もしない）

### 8-2. Default Proxy interception state

「Use this setting to choose whether Burp Proxy interception is enabled by default when you start Burp.」＝起動時に傍受を既定でオンにするか。3 択。

- **Enable interception.**（傍受オン）
- **Disable interception.**（傍受オフ）
- **Restore the setting that was selected in the Proxy > Intercept tab when Burp closed.**（前回終了時の状態を復元）

〔補足〕初学者は Intercept をオンにしたまま忘れ、ページが延々止まって「ブラウザが固まった」と誤解しがち。既定オフにしておくと安全だ。

---

## 9. Miscellaneous（Proxy 挙動の細部・全 14 項目）

「These settings control various aspects of Burp Proxy's behavior:」実務で必ず触るので全項目を挙げる。

| 設定 | 説明 |
| --- | --- |
| **Use HTTP/1.0 in requests to server** | 宛先サーバへのリクエストで HTTP 1.0 を使う。レガシーなサーバ向け。 |
| **Use HTTP/1.0 in responses to client** | レスポンスで HTTP 1.0 を使う。機能が減るので「例えば HTTP パイプラインの試みを防ぐ」などブラウザ挙動の制御に使える。 |
| **Use keep-alive for HTTP/1 if the server supports it** | 既定で HTTP/1 接続を再利用する。ブラウザの読み込みが速くなりうる。 |
| **Set response header "Connection: close"** | レスポンスの `Connection` ヘッダを `close` に設定・更新する。HTTP パイプラインを防げる場合がある。 |
| **Set "Connection: close" on incoming requests** | 既定で、入ってくるリクエストの `Connection` を `close` に設定・更新する。 |
| **Strip Proxy-\* headers in incoming requests** | 既定で `Proxy-*` ヘッダを剥がす。「A malicious website may attempt to induce a browser to include sensitive data within these headers.」 |
| **Remove unsupported encodings from Accept-Encoding headers in incoming requests** | 既定で、Burp のレスポンス処理で問題を起こすエンコーディングを削る。 |
| **Strip Sec-WebSocket-Extensions headers in incoming requests** | 既定でこのヘッダを削除。一部のエンコーディングがレスポンス処理で問題を起こすため。 |
| **Unpack compressed requests** | 圧縮されたリクエスト本文を自動展開。Burp が展開できるのは **gzip, Deflate, or Brotli**。 |
| **Unpack compressed in responses** | 圧縮レスポンス本文を自動展開。同じく **gzip, Deflate, or Brotli**。サーバの圧縮を防ぐには match and replace で `Accept-Encoding` を削るとよい、と明記。 |
| **Disable web interface at http://burpsuite** | `http://burpsuite` の in-browser インターフェースを無効化。「if you need to configure your listener to accept connections on an unprotected interface」＝保護されていないインターフェースで待ち受ける際、他者のアクセスを防ぐのに有用。 |
| **Suppress Burp error messages in browser** | 通常ブラウザに送られるエラーメッセージを抑制。「run Burp in stealth mode in order to perform man-in-the-middle attacks against a victim user」の用途が挙げられている。 |
| **Don't send items to Proxy history or live tasks** | 履歴・ライブタスクにログしない。メモリ・ストレージのオーバーヘッドを抑えられる。 |
| **Don't send items to Proxy history or live tasks, if out of scope** | スコープ外のリクエストをログしない。「This option is selected automatically when you set the target scope, and stop logging the proxy history for out-of-scope items.」 |

### 9-1. クライアントサイド視点での読みどころ

とくに **Strip Proxy-\* headers** の注記は攻撃面の示唆になる。公式が「悪意あるサイトがブラウザを誘導して、これらのヘッダに機微データを含めさせようとするかもしれない」と書いている。つまり「ブラウザがプロキシ向けに出すヘッダが標的に漏れる」という観点を、クライアントサイドの視点として持てる。

`Unpack compressed requests/responses`（gzip / Deflate / Brotli）や `Accept-Encoding` の削除は、圧縮で読みにくいトラフィックを平文で観察するための定番だ。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Burp Proxy settings（`Settings > Tools > Proxy`）の「predefined match and replace rules」の実際の一覧 — https://portswigger.net/burp/documentation/desktop/settings/tools/proxy
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限。加えて公式ドキュメント本文は「various predefined rules ... These are disabled by default」と述べるだけで、個々のルール名・正規表現は文書化されていない）。以下の記述は目次・二次情報にもとづく要約である。
> **読みどころ**:
> 1. 実際の一覧は Burp の UI（`Settings > Tools > Proxy > HTTP match and replace rules`）でのみ確認できる。各 predefined rule の **Type / Match / Replace / Comment** 列を読む。
> 2. User-Agent 書き換えや `Accept-Encoding` 除去などの定型が、Match/Replace としてどう表現されているかを写し取る。教科書の演習素材として最適。
> **代替手段**: Burp を起動して該当設定画面を開けば、ログイン不要で一覧が見られる。

---

## 10. HTTP history — 通過したトラフィックの記録

「You can use the **HTTP history** to see a record of the HTTP traffic that has passed through Burp Proxy. You can also see any modifications that you made to intercepted messages.」＝Burp Proxy を通過した HTTP トラフィックの記録が見られ、傍受メッセージに加えた改変も確認できる。

とりわけ重要な性質（逐語）。

> 「The HTTP history is **always updated, even if Intercept is off**. This enables you to browse without interruption while you monitor key details about application traffic.」

= HTTP history は **Intercept がオフでも常に更新される**。だから、傍受で止めずに普通にブラウズしながら、裏で全トラフィックを記録・観察できる。「Right-click any item in the table to access further options, such as sending requests to other Burp tools.」＝項目を右クリックすれば、他の Burp ツールへ送るなどの操作ができる。

### 10-1. 列の完全一覧（全 19 項目）

| 列 | 意味 |
| --- | --- |
| **#** | リクエストのインデックス番号 |
| **Host** | プロトコルとサーバのホスト名 |
| **Method** | HTTP メソッド |
| **URL** | URL のファイルパスとクエリ文字列 |
| **Params** | リクエストがパラメータを含むかのフラグ |
| **Edited** | リクエスト／レスポンスがユーザーに改変されたかのフラグ |
| **Status code** | レスポンスの HTTP ステータスコード |
| **Length** | レスポンスの長さ（バイト） |
| **MIME type** | レスポンスの MIME タイプ |
| **Extension** | URL のファイル拡張子 |
| **Title** | ページタイトル（HTML レスポンスの場合） |
| **Notes** | ユーザーが付けたノート |
| **TLS** | TLS を使うかのフラグ |
| **IP** | 宛先サーバの IP アドレス |
| **Cookies** | レスポンスで設定されたクッキー |
| **Time** | リクエストが送られた時刻 |
| **Listener port** | リクエストを受けたリスナーのポート |
| **Start response timer** | リクエスト送信から最初のレスポンス 1 バイト目までのミリ秒 |
| **End response timer** | リクエスト送信からレスポンス完了までのミリ秒 |

**Start/End response timer** はレイテンシ分析・タイミング差の観察に有用だ。〔補足〕たとえばログイン成功と失敗で応答時間に差が出ないかを見れば、タイミングでユーザー名の存在を推測できる脆弱性（ユーザー列挙）の手がかりになる。

### 10-2. レイアウト操作の全手段

| 操作 | 手順 |
| --- | --- |
| **Hide columns** | 隠したい列のヘッダを右クリックし **Hide column** を選ぶ |
| **Show hidden columns** | options メニュー **> Table layout** で表示したい列を選ぶ |
| **Move columns** | 列ヘッダを新しい位置へドラッグ＆ドロップ |
| **Add custom columns** | options メニュー **> Add custom column** で独自列を作る |
| **Sort the table** | 列ヘッダをクリックし昇順・降順・ソートなしを切り替え |
| **Filter the data** | **Filter settings** バーで **Settings mode** か **Bambda mode** を選ぶ |
| **Restore the default layout** | **> Table layout** → **Restore default table** |

### 10-3. リクエストの表示と改変経路

「If you select an item from the HTTP history, the lower pane shows the request and response messages for the item. **Any modified messages are shown separately.**」＝項目を選ぶと下ペインにリクエスト・レスポンスが出て、改変されたメッセージは別に表示される。改変の経路は 3 つ。

- **User interception**（傍受時のユーザー編集）
- **Automatic response modification**（Response modification rules による）
- **Match and replace rules**（マッチ＆リプレースによる）

さらに可能な操作: ダブルクリックでポップアップ表示／右クリック **Show new history window**（独自の display filter を持つ別履歴ウィンドウ）／Inspector の利用／**Notes** の閲覧・編集。

### 10-4. カスタム列と Bambda（Professional のみ）

**Bambda**（バンダ）とは、Burp 上で書ける小さな Java コードの断片のこと。フィルタやカスタム列の中身を自分でプログラムできる。

「You can create your own custom columns using Bambdas.」利用できる Montoya API のオブジェクトは 2 つ。

- `ProxyHttpRequestResponse`
- `Utilities`

手順は、**Proxy > HTTP history** の options メニュー **> Add custom column** →**Column header** に名前を入力 →Bambda を書く、の順。

レスポンスの `Server` ヘッダ値を表示する列の例（逐語）。

```java
if (!requestResponse.hasResponse()) {
    return "";
}

var response = requestResponse.response();

return response.hasHeader("Server")
    ? response.headerValue("Server")
    : "";
```

〔補足〕Montoya API（モントーヤ API）とは、Burp の拡張・スクリプトを書くための公式 Java インターフェースのこと。クラス名・メソッド名は進化が速いので、最新版はライブで確認すること。

---

## 11. HTTP history のフィルタ（Settings mode / Bambda mode）

「The filter bar above the list of interactions describes the current display filter.」フィルタバーをクリックすると **HTTP history filter** ウィンドウが開く。「The **HTTP history filter** window has two tabs - **Settings mode** and **Bambda mode**.」

重要な原則（逐語）。

> 「The filters **only control what is displayed**. If you hide items, they are not deleted: they reappear if you reset the filter.」

= フィルタは表示を制御するだけ。隠しても削除されず、フィルタをリセットすれば戻る。安心して絞り込める。

### 11-1. Settings mode の全フィルタ項目

| フィルタ | 内容 |
| --- | --- |
| **Filter by request type** | ① in-scope の項目のみ ② レスポンスがある項目のみ ③ パラメータを持つリクエストのみ |
| **Filter by MIME type** | HTML / CSS / 画像 など MIME タイプで表示・非表示 |
| **Filter by status code** | ステータスコードで表示・非表示 |
| **Filter by search term** | ① 検索語を含むレスポンスをフィルタ ② リテラルか正規表現 ③ case-sensitive にできる ④ **Negative search** で一致しない項目だけ表示 |
| **Filter by file extension** | ファイル拡張子で表示・非表示 |
| **Filter by annotation** | ノートやハイライトがある項目のみ |
| **Filter by listener** | 特定のリスナーポートで受けた項目を表示。「This can be useful when testing access controls.」 |

**Filter by listener** がアクセス制御のテストに有用、という一文は覚えておくとよい。異なるリスナーを異なる権限レベルの入り口に割り当てておけば、ポートで通信を仕分けられる。

### 11-2. 注釈（annotation）の付け方

ハイライト手順: **HTTP history** で項目を選ぶ →右クリック **Highlight** →色を選ぶ。

ノート追加手順: 項目を選ぶ →**Notes** をクリック →**Notes** パネルにコメントを入力。

「You can also annotate items as they appear in the Intercept tab. These automatically appear in the HTTP history.」＝Intercept タブでの注釈も自動で HTTP history に反映される。

---

## 12. Bambda でフィルタを書く

「You can write Java-based Bambdas to create custom filters for your HTTP history.」利用可能なオブジェクトは `ProxyHttpRequestResponse` と `Utilities`。

手順。

1. **Proxy > HTTP history** タブでフィルタバーをクリックし **HTTP history filter** ウィンドウを開く。「The filter bar only appears when there is one or more messages in your HTTP history.」＝履歴に 1 件以上あるときだけ現れる。
2. **Bambda mode** タブをクリック。
3. Java で Bambda を書く。
4. **Apply** をクリック。

「Burp compiles your Bambda and applies it to **every item already logged** in your HTTP history, and to **any future HTTP traffic** generated in this project.」＝既存の全項目にも、今後のトラフィックにも適用される。

> **Warning**: 「Using slow running or resource-intensive Bambdas can slow down Burp. Write your Bambda carefully to minimize performance implications.」＝遅い／重い Bambda は Burp を遅くする。慎重に書くこと。

### 12-1. 例: レスポンスあり／3XX／`session` クッキー設定あり

条件（逐語）は「レスポンスがある」「3XX ステータス」「`session` という名のクッキーが設定されている」の 3 つ。

```java
if (!requestResponse.hasResponse()) {
    return false;
}

var response = requestResponse.response();
return response.isStatusCodeClass(StatusCodeClass.CLASS_3XX_REDIRECTION) && response.hasCookie("session");
```

〔補足〕リダイレクト（3XX）と同時に `session` クッキーを配るレスポンスは、ログイン成功やセッション固定の観察点になる。こうした「興味深いパターン」を Bambda で機械的に拾える。

### 12-2. フィルタ設定を Bambda に変換

> **Note**: 「Converting your filter settings **overwrites any existing Bambda** in your HTTP history.」＝変換すると既存の Bambda を上書きする。

手順: フィルタバーをクリック →（必要なら設定変更）→ウィンドウ下部の **Convert to Bambda** をクリック。GUI で組んだフィルタを Bambda の雛形として書き出せるので、学習にも便利だ。

---

## 13. WebSockets history

「You can use the **WebSockets history** to see a record of any WebSocket messages Burp's browser exchanges with web servers.」これで WebSocket 通信を閲覧・傍受・改変できる。用途（逐語）は次の 3 つ。

- 「Study the behavior of a target website.」
- 「Look for vulnerabilities in WebSockets handshakes and messages.」
- 「Send interesting messages to other tools in Burp Suite for further testing.」

### 13-1. 列の完全一覧（全 10 項目）

| 列 | 意味 |
| --- | --- |
| **#** | リクエストのインデックス番号 |
| **URL** | WebSocket 接続の URL |
| **Direction** | メッセージの方向（送信＝outgoing／受信＝incoming） |
| **Edited** | ユーザーに改変されたかのフラグ |
| **Length** | レスポンスの長さ（バイト） |
| **Notes** | ユーザーが付けたノート |
| **TLS** | TLS を使うかのフラグ |
| **Time** | メッセージを受信した時刻 |
| **Listener port** | メッセージを受けたリスナーのポート |
| **WebSocket ID** | そのメッセージに使われた WebSocket の Burp 内部 ID |

「The WebSockets history is **always updated, even if Intercept is off**.」＝これも Intercept オフで常に更新される。

### 13-2. レイアウトとカスタム列

レイアウト操作は HTTP history と同一（Hide columns / Show hidden columns / Move columns / Add custom columns / Sort / Filter / Restore default）。

カスタム列（**Professional**）で使える Montoya API のオブジェクトは 2 つ。

- `ProxyWebSocketMessage`
- `Utilities`

レスポンスの **session ID** を取り出す列の例（逐語）。

```java
Pattern pattern = Pattern.compile("\"sid\":\"(\\w.*)\"");
Matcher matcher = pattern.matcher(message.payload().toString());
matcher.find();
if (matcher.hasMatch())
{
    return matcher.group(1);
}

return "";
```

### 13-3. WebSockets のフィルタ

「The **WebSockets history filter** window has two tabs - **Settings mode** and **Bambda mode**.」フィルタは表示だけを制御する点も HTTP history と同じ。

Settings mode の全項目。

| フィルタ | 内容 |
| --- | --- |
| **Filter by request type** | ① in-scope のみ ② incoming メッセージのみ ③ outgoing メッセージのみ |
| **Filter by search term** | ① 検索語を含むレスポンス ② リテラルか正規表現 ③ case-sensitive ④ **Negative search** |
| **Filter by annotation** | notes や highlights がある項目のみ |
| **Filter by listener** | 特定のリスナーポートで受けた項目。「This can be useful when testing access controls.」 |

Bambda mode の手順は HTTP history と同様（フィルタバー →**Bambda mode** →Java を書く →**Apply**）。サーバ送信かつ payload 長が 300 超のメッセージを拾う例（逐語）。

```java
return message.payload().length() > 300 && message.direction() == Direction.SERVER_TO_CLIENT;
```

〔補足〕`message.direction() == Direction.SERVER_TO_CLIENT` のように方向で絞れるのが WebSocket ならでは。サーバから届く大きなメッセージ（機微情報を含みやすい）を狙い撃ちできる。フィルタ設定は **Convert to Bambda** で Bambda に変換でき、変換は既存 Bambda を上書きする。

---

## 14. Invisible proxying — proxy 非対応クライアントを扱う

### 14-1. なぜ必要か

**Invisible proxying**（不可視プロキシ／透過プロキシ）とは、プロキシ設定を持てないクライアントを、直接 Proxy リスナーにつなぐモードのこと。公式定義（逐語）。

> 「Burp's support for invisible proxying allows non-proxy-aware clients to connect directly to a Proxy listener. This is useful if the target application uses a thick client component that runs outside of the browser, or a browser plugin that makes HTTP requests outside of the browser's framework. Often, these clients don't support HTTP proxies, or don't provide an easy way to configure them.」

= thick client（ブラウザの外で動く独立アプリ）やブラウザプラグインは、しばしば HTTP プロキシに対応しておらず、設定手段も無い。そういうクライアントを扱うために必要になる。

### 14-2. 入り口をこちらに向ける（DNS 書き換え）

「You can force the non-proxy-aware client to connect to Burp. **Modify your DNS resolution** to redirect the relevant hostname, and set up invisible Proxy listeners on the ports used by the application.」＝DNS 解決を書き換えて対象ホスト名を自分に向け、アプリが使うポートに不可視リスナーを立てる。

例（逐語）: アプリが `example.org` を使い、HTTP/HTTPS が標準ポートなら、hosts ファイルに次を追加する。

```text
127.0.0.1 example.org
```

「To receive the redirected requests, create invisible Burp Proxy listeners on `127.0.0.1:80` and `127.0.0.1:443`.」＝リダイレクトされたリクエストを受けるため、`127.0.0.1:80` と `127.0.0.1:443` に不可視リスナーを作る。クライアントはドメインを自分のローカル IP に解決し、そのインターフェース上のリスナーへ直接送ってくる。

〔補足〕hosts ファイルとは、ドメイン名と IP の対応を手元で上書きできる OS のファイルのこと。ここに `127.0.0.1 example.org` と書くと、そのマシンは `example.org` を自分自身とみなす。

### 14-3. なぜ専用モードが要るのか（リクエスト形式の違い）

「the need for a special invisible proxy mode arises because the resulting requests will not be in the form that is expected by an HTTP proxy.」＝届くリクエストが「プロキシが期待する形」ではないから、専用モードが要る。

プロキシ形式のリクエスト（逐語）。

```http
GET http://example.org/foo.php HTTP/1.1
Host: example.org
```

対応する非プロキシ形式のリクエスト（逐語）。

```http
GET /foo.php HTTP/1.1
Host: example.org
```

違いは 1 行目にある。通常のプロキシは**リクエスト 1 行目のフル URL**で宛先を判断し、`Host` ヘッダは見ない。だが不可視プロキシを有効にすると、Burp は非プロキシ形式のリクエストを受けたとき **`Host` ヘッダの内容を宛先として使う**。

HTTPS の場合（逐語）: 「If you use HTTPS with a proxy, clients send a **CONNECT** request that identifies the destination host and then perform TLS negotiation. However, non-proxy-aware clients proceed directly to TLS negotiation, believing they are communicating directly with the destination host. If you enable invisible proxying, Burp tolerates direct negotiation of TLS by the client, and parses out the contents of the Host header from the decrypted request.」

= 通常は最初に **CONNECT** リクエストで宛先を伝えるが、非対応クライアントはいきなり TLS ネゴシエーションを始める。不可視プロキシは、その直接ネゴシエーションを許容し、復号後のリクエストの `Host` ヘッダから宛先を取り出す。

### 14-4. 出口の無限ループを解消する

「because you have modified the hosts file entry for the relevant domain, Burp resolves the hostname to the local listener address. Unless configured differently **it forwards the request back to itself. This creates an infinite loop.**」＝hosts を書き換えたせいで、Burp が宛先を解決するとまた自分自身になり、**リクエストが自分に返ってきて無限ループになる**。

解決方法は 2 つ。

1. すべての不可視トラフィックが単一ドメイン宛のとき: **Proxy listener の redirection settings**（第 3-3 節の Request handling）で、出ていくトラフィックを正しい IP に強制する。
2. 複数ドメイン宛のとき: **Burp 自身の hostname resolution settings**（後述の Connections 設定）で hosts を上書きし、各ドメインを本来の IP へ個別に戻す。

### 14-5. Host ヘッダが無いクライアントへの対処

「A related problem arises if the non-proxy-aware client **does not include a Host header** in its requests.」＝クライアントが `Host` ヘッダを送らないと、Burp は宛先を決められない。

- 全リクエストが同じ宛先なら: リスナーの redirection settings で正しい IP に強制する。
- 宛先がリクエストごとに違うなら、**複数の Proxy listener** を使う（逐語ベース）。
  1. 宛先ホストごとに仮想ネットワークインターフェースを作る（多くの OS で loopback 的な追加インターフェースを作れる。仮想化環境でも可能）。
  2. 各インターフェースに専用の Proxy listener を作る（HTTP と HTTPS 両方なら 2 つ）。
  3. hosts ファイルで各宛先ホスト名を別々のリスナーへ向ける。
  4. 各インターフェースのリスナーを、そこに来たトラフィックの本来の宛先 IP へ全転送するよう設定する。

### 14-6. 不可視時の証明書問題

「The default configuration automatically generates a certificate for each destination host. **This may not work with invisible proxying.** Non-proxy-aware clients negotiate TLS directly with the listener, without first sending a CONNECT request to identify the destination host.」＝既定の per-host 証明書生成は、不可視プロキシでは動かないことがある。CONNECT が無いので、Burp は事前に宛先を知れない。

救いは SNI である（逐語）。「Many clients, including browsers, support the **"server_name" extension** in the **Client Hello** message. This identifies the destination host ... If this extension is present, Burp uses it to generate a certificate for that host in the normal way. **If the extension is not present, Burp fails over to use a static self-signed certificate instead.**」

= 多くのクライアントは Client Hello の **"server_name"（SNI）拡張**で宛先を伝える。あれば Burp はそれで証明書を生成し、無ければ静的な自己署名証明書にフォールバックする。SNI（Server Name Indication）とは、TLS 接続開始時に「どのホスト向けか」を伝える拡張のこと。

解決方法は 2 つ。

1. 全 HTTPS が同一ドメインなら、不可視リスナーを「そのホスト名の CA 署名証明書を生成」するよう設定する（第 3-4 節の 3 番目のオプション）。
2. 異なるドメイン宛なら、宛先ごとに別の仮想インターフェースで不可視リスナーを作り、それぞれに宛先ホスト名の CA 署名証明書を生成させる。

---

## 15. Connections settings（不可視プロキシと外部プロキシ環境で必要）

「The **Connections** settings enable you to define how Burp handles network traffic.」構成できるのは **Platform authentication** / **Timeouts** / **Upstream proxy servers** / **Hostname resolution overrides** / **SOCKS proxy** の 5 つ。

### 15-1. Platform authentication

宛先サーバへの自動プラットフォーム認証を行う設定。**Do platform authentication** を選び **Add** でダイアログを開く。追加できるのは Destination host、Authentication type（**Basic**, **NTLMv1**, **NTLMv2**）、Username / Password / Domain / Domain hostname。**Prompt for credentials on platform authentication failure** を選ぶと、認証失敗時に対話ポップアップが出る。user と project の両方に適用でき、**Override options for this project only** で当該プロジェクトのみにできる。

### 15-2. Timeouts（全 5 項目・単位は秒）

| 設定 | 説明 |
| --- | --- |
| **Connect** | ソケットを開いてからサーバ応答を待つ時間。超えると「到達不能」と判断する。 |
| **Normal** | ほとんどの通信に使う。超えるとリクエストを諦めタイムアウトを記録する。 |
| **Open-ended responses** | `Content-Length` も `Transfer-Encoding` も無いレスポンスの処理に使う。指定間隔待って送信完了とみなす。 |
| **Domain name resolution** | 成功した DNS 参照を再実行する頻度。宛先アドレスが頻繁に変わるなら小さくする。 |
| **Failed domain name resolution** | 失敗した DNS 参照を再試行する頻度。 |

「Values are in seconds. **If you set any of these settings to zero or leave them blank, Burp will never time out when performing that function.**」＝0 または空にするとタイムアウトしなくなる。

### 15-3. Upstream proxy servers

「These settings control whether Burp sends outgoing requests to an upstream proxy server, rather than sending them directly to the destination web server.」＝出ていくリクエストを、宛先へ直接ではなく上流プロキシへ送るか。「Burp uses the **first rule in the table that matches** the destination web server.」＝最初に一致したルールを使い、無ければ直接接続する。

**Add upstream proxy rule** で指定できるのは Destination host（ワイルドカード可: `*` は 0 文字以上、`?` はドット以外の任意 1 文字）、Proxy host（空なら直接接続）、Proxy port、Authentication type（Basic / NTLMv1 / NTLMv2）、Username / Password、Domain と Domain hostname（NTLM のみ）。

イディオム（逐語）: 「To send all traffic to a single proxy server, create a rule with `*` as the destination host. To create an exception to this rule, create a destination host and leave the proxy host field empty.」＝全トラフィックを 1 つのプロキシへ送るには `*` のルール、例外を作るには宛先を指定して proxy host を空にする。

### 15-4. Hostname resolution overrides

「These settings enable you to override your computer's DNS resolution by mapping hostnames to IP addresses.」＝ホスト名→IP のマッピングで DNS 解決を上書きする。「This can help you to make sure that requests are forwarded correctly when the Hosts file has been modified to invisibly proxy traffic from non-proxy-aware thick client components.」＝まさに第 14-4 節の無限ループ解消に使う。各マッピングはホスト名と IP からなり、個別に有効／無効化でき、Edit / Remove 可能。project settings。

### 15-5. SOCKS proxy

「You can configure Burp to use a SOCKS proxy for all outgoing communications. This setting is applied at the **TCP level**.」＝全通信を SOCKS プロキシ経由にする。TCP レベルで適用される。**Use SOCKS proxy** を選び、SOCKS proxy host / port / Username / Password を入力する。上流 HTTP プロキシのルールがあれば、そこへのリクエストも SOCKS 経由で送られる。「If you select **Do DNS lookups over SOCKS proxy**, all domain names are resolved by the proxy.」＝これを選ぶと DNS 解決も全部プロキシ側で行い、ローカル参照はしない。

---

## 16. TLS settings（クライアント証明書・上流 TLS）

「configure the TLS negotiation, Client TLS certificates, Server TLS certificates, and Java TLS settings.」の 4 領域。

### 16-1. TLS negotiation

上流サーバとの TLS ネゴシエーションで使うプロトコル・暗号を制御する。**Verify upstream TLS** で選ぶ。選択肢は「Java が対応する全プロトコルと暗号を使う」「Java の既定を使う」「カスタムを使う」。さらに **Allow unsafe renegotiation**（一部のクライアント証明書や TLS 問題の回避に必要になることがある）と **Disable TLS session resume**（接続の再利用をキャッシュ・再利用するか。効率化に効くが状況によっては問題を起こす）がある。

### 16-2. Client TLS certificates

「configure the client TLS certificates that Burp uses when requested to by a destination host.」＝宛先が要求したときに使うクライアント証明書を設定する。複数登録でき、どのホストにどの証明書を使うか指定できる。「When a host requests a client TLS certificate, Burp uses the **first certificate in the list** for that host.」

**Add** でダイアログを開き、Destination host（ワイルドカード可。全ホストに 1 枚使うなら `*`）と Certificate type を入力する。

- **File (PKCS#12)** — 「Certificates in this format must have a .p12 file extension.」証明書ファイルの場所とパスワードを指定。
- **Hardware token or smartcard (PKCS#11)** — デバイスの PKCS#11 ライブラリファイルを選ぶ。Windows では一般的な場所を自動探索できる。PIN コードを入力し、証明書を選ぶ。中間証明書を追加することもできる。

〔補足〕クライアント証明書とは、サーバがクライアントを認証するために「あなたが誰か」を証明する証明書のこと（サーバ証明書の逆向き）。相互 TLS（mTLS）を使うアプリを診断するときに必要になる。

### 16-3. Server TLS certificates / Java TLS settings

- **Server TLS certificates** は情報表示のみのパネルで、サーバから受け取った X509 証明書の一覧を持つ。ダブルクリックで詳細を表示。
- **Java TLS settings** には 2 つ。**Enable algorithms blocked by Java security policy** は、Java 7 以降で既定ブロックされる旧アルゴリズム（例: **MD2**）を使うサーバに接続するために有効化する（変更後は Burp 再起動）。**Disable Java SNI extension** は、SNI 有効の一部の設定ミスサーバが「Unrecognized name」警告を返して接続失敗するのを回避する（同じく再起動が必要）。

---

## 17. クライアントサイド脆弱性ハンティングの要点整理

この節の機能を、ハンティングの実務からまとめ直す。

1. **クライアントサイド制御は Proxy で消せる**: Response modification rules の 6 項目（Unhide hidden form fields / Enable disabled form fields / Remove input field length limits / Remove JavaScript form validation / Remove all JavaScript / Remove `<object>` tags）が、「クライアント側だけで守っている」箇所を機械的に暴く。とくに **Remove all JavaScript** は「JS が無くても操作が通るか＝サーバ側検証の有無」を切り分ける診断手法になる。
2. **Match and replace はヘッダ実験の主力**: Match 空欄＝ヘッダ追加、Replace 空欄＝ヘッダ削除。`Accept-Encoding` を削除すれば圧縮レスポンスを平文で観察できる（公式が明記する用法）。応答ヘッダを書き換えて「ヘッダが無い／緩い場合に何が起きるか」を安全に再現できる。
3. **WebSockets も一級市民**: WebSockets history と WebSocket interception rules があり、スコープ判定は `upgrade` リクエストが in-scope かで決まる。Bambda で `message.direction() == Direction.SERVER_TO_CLIENT` のように方向・payload 長で絞れる。
4. **`Strip Proxy-*` の注記は攻撃面の示唆**: 公式が「A malicious website may attempt to induce a browser to include sensitive data within these headers」と書いている。クライアントサイドの視点で「ブラウザがプロキシ向けに出すヘッダが標的に漏れる」という観点を持てる。
5. **listener のバインド先は事故の源**: all interfaces にバインドすると他のマシンから接続できる。診断環境の衛生としてノートに残すべき。
6. **TLS pass through はトレードオフ**: 見えなくなる（Intercept にも history にも出ない）代わりに、性能・元の TLS フィンガープリント・ピンニング回避が得られる。out-of-scope 一括適用は **Miscellaneous > Don't send items to Proxy history or live tasks, if out of scope** を先に有効化しないと使えない。
7. **許諾の前提**: 公式は Scanner の節で「Do not run scans against third-party websites unless you have been authorized to do so by the owner.」、Proxy の節で（機能に十分慣れるまでは）「you should only use Burp Proxy against non-production systems」と明記している。診断は常に許可された対象・範囲でのみ行う。

---

## 手を動かす

環境: 自分で立てた検証用の脆弱な Web アプリ、または Web Security Academy の lab など、**明示的に許可された対象**に対してのみ行うこと。

1. Burp を起動し、内蔵ブラウザ（**Proxy > Intercept > Open Browser**）を開く。まず **Proxy > HTTP history** を開いておく。Intercept はオフでよい（history は常に更新される）。
2. 検証アプリでフォームを 1 回送信し、HTTP history に記録が残ることを確認する。項目を選び、下ペインでリクエストとレスポンスを読む。
3. **Settings > Tools > Proxy** を開き、**Response modification rules** で **Unhide hidden form fields**（＋**Prominently highlight unhidden fields**）と **Enable disabled form fields** を有効にする。ページを再読み込みし、隠しフィールドが画面に現れることを確認する。
4. 同じ設定画面で **Remove all JavaScript** を有効化し、ページを再読み込み。JS に依存した入力チェックが外れた状態で、フォーム送信がサーバに受け付けられるか（＝サーバ側検証の有無）を観察する。終わったら設定を戻す。
5. **HTTP and WebSocket match and replace rules** で **Add** をクリックし、Type を **Request header**、Match を空、Replace に任意のテストヘッダ（例: `X-Test: 1`）を入れて追加する。リクエストにヘッダが追加されるのを HTTP history で確認する。次に Type を **Request header**、Match に `Accept-Encoding`、Replace を空にしたルールを作り、レスポンスが非圧縮で読めることを確認する。
6. **HTTP history** のフィルタバーをクリックし、**Filter by status code** で 3XX だけ表示してみる。次に **Bambda mode** タブへ移り、第 12-1 節のコードを貼って **Apply** し、リダイレクト＋`session` クッキーの項目だけに絞れることを見る。
7. （余裕があれば）**Settings > Tools > Proxy > Proxy listeners** で既定リスナーが loopback:8080 であることを確認する。**Bind to address** を all interfaces に変えると警告の意味を理解できるが、検証後は必ず loopback に戻すこと。

## つまずきポイント

- **Intercept が消えないと勘違いする**: Intercept をオンにしたまま放置すると、ブラウザがずっと止まって「壊れた」と誤解しがち。history は Intercept オフでも更新されるので、普段はオフでよい。
- **HTTPS の取り消し線は正常**: 内蔵ブラウザで HTTPS に取り消し線が出るのは、Burp を経由している証拠。無視してよい（公式明記）。
- **フィルタで消えても削除ではない**: フィルタは表示制御だけ。隠した項目はリセットで戻る。データは消えていない。
- **TLS pass through は「見えなくなる」**: 便利だが、パススルーした接続は Intercept にも history にも一切出ない。うっかり全部パススルーにすると何も観察できなくなる。
- **all interfaces バインドは開放プロキシ**: 他のマシンから接続され得る。検証後は loopback に戻す。
- **predefined match and replace rules は既定で無効**: 定義済みルールは自分で有効化しないと効かない。個々の中身はドキュメントではなく UI でしか読めない。
- **不可視プロキシの無限ループ**: hosts を書き換えると Burp が宛先を自分に解決してループする。listener の redirection か Hostname resolution overrides で本来の IP に戻す。
- **Content-Length を手で直す羽目になる**: 本文を書き換えるなら **Automatically update Content-Length** をオンに。
- **バンドル版ドキュメント準拠**: 本節は内部ビルド 32146 相当のオフライン公式ドキュメントに基づく。UI 名称・既定値・新機能はライブページで最新を確認すること。

## この節のまとめ

- Burp Proxy の設定は **Settings > Tools > Proxy** に 9 グループ。うち Proxy history logging と Default interception state だけが user settings、残りは project settings。
- 既定リスナーは **loopback の port 8080**。all interfaces へのバインドは他マシンからの接続を招く危険がある。
- リスナーの証明書は既定で **Generate CA-signed per-host certificates**。不可視プロキシでは per-host が使えず、SNI が無ければ静的自己署名にフォールバックする。
- Interception rules は Boolean operator / Match type / Match relationship / Match condition で構成し、**順序が結果に影響する**。
- **Response modification rules** はクライアントサイド制御を機械的に暴くこの章の核心。6 つの除去項目＋sslstrip 系 2 項目がある。**Remove all JavaScript** はサーバ側検証の有無を切り分ける。
- **Match and replace** は Match 空欄でヘッダ追加、Replace 空欄でヘッダ削除。`Accept-Encoding` 削除で圧縮を無効化できる。グループは 1 始まり、group 0 は全体、置換は `$1` で参照。
- **TLS pass through** は復号せず素通し。性能・TLS フィンガープリント保持・ピンニング回避が得られるが、Intercept にも history にも出ない。out-of-scope 一括適用は「スコープ外はログしない」を先に有効化する必要がある。
- **HTTP history**（19 列）と **WebSockets history**（10 列）は Intercept オフでも常に更新される。Start/End response timer でタイミングを観察できる。
- フィルタは **Settings mode** と **Bambda mode** の 2 つ。フィルタは表示制御のみで、隠しても削除されない。Bambda は既存項目と今後のトラフィック双方に適用され、重い Bambda は Burp を遅くする。
- カスタム列・Bambda は Professional 機能。Montoya API の `ProxyHttpRequestResponse` / `ProxyWebSocketMessage` / `Utilities` を使う。
- **Invisible proxying** は proxy 非対応クライアント（thick client、プラグイン）向け。DNS/hosts 書き換え＋`Host` ヘッダ解釈＋CONNECT 無しの直接 TLS 許容で成立し、無限ループは redirection または Hostname resolution overrides で解消する。
- **Connections 設定**（Platform authentication / Timeouts / Upstream proxy / Hostname resolution overrides / SOCKS）と **TLS 設定**（Client TLS certificates は PKCS#12 / PKCS#11）で、認証・上流プロキシ・クライアント証明書を扱える。
- すべての機能は「許可された診断・バグバウンティ・自分で立てた検証環境」でのみ使う。sslstrip 系は他者トラフィックへ勝手に適用しない。

## 理解度チェック

1. Burp Proxy の設定 9 グループのうち、user settings に保存されるのはどの 2 つか。
   ▶ 答え: **Proxy history logging** と **Default Proxy interception state**。残り 7 つは project settings。

2. 既定の Proxy listener はどのインターフェースの何番ポートにあるか。all interfaces にバインドすると何が問題か。
   ▶ 答え: **loopback インターフェースの port 8080**。all interfaces にバインドすると他のコンピュータから接続でき、意図しない開放プロキシになる。

3. match and replace で「ヘッダを追加する」「ヘッダを削除する」にはそれぞれどう設定するか。
   ▶ 答え: Request/Response header タイプで **Match を空にすると追加**（置換文字列が新ヘッダになる）、**Replace を空にすると削除**（一致したヘッダが消える）。

4. **Remove all JavaScript** はクライアントサイド診断で何を切り分けられるか。
   ▶ 答え: JS を全部消しても操作が通るか＝**サーバ側で検証しているか**を切り分けられる。通るならクライアント側の JS だけで守っていたことになる。

5. TLS pass through の 3 つの利点と、最大の副作用は何か。
   ▶ 答え: 利点は ① 性能が劇的に向上 ② サーバが元の TLS フィンガープリントを見るので anti-bot 回避 ③ クライアントの TLS エラー（証明書ピンニング等）を解消。副作用は、その接続が **Intercept view にも Proxy history にも一切表示されない**こと。

6. HTTP history と WebSockets history に共通する「Intercept との関係」の性質は何か。
   ▶ 答え: どちらも **Intercept がオフでも常に更新される**。だから止めずにブラウズしながら全トラフィックを記録・観察できる。

7. 不可視プロキシで、通常のプロキシと違って Burp が宛先ホストを判断するのに使うのは何か。HTTPS ではどうか。
   ▶ 答え: 非プロキシ形式リクエストでは 1 行目のフル URL が無いので、**`Host` ヘッダの内容**を宛先に使う。HTTPS では CONNECT が無く、クライアントが直接 TLS ネゴシエーションを始めるのを許容し、復号後のリクエストの `Host` ヘッダから宛先を取り出す。

8. 不可視プロキシで hosts を書き換えると起きる無限ループの原因と、2 つの解決策は何か。
   ▶ 答え: 原因は、Burp が宛先を解決するとまた自分自身（ローカルリスナー）になり、リクエストを自分に転送し続けること。解決策は ① 単一ドメインなら listener の redirection settings で正しい IP に強制 ② 複数ドメインなら Hostname resolution overrides で各ドメインを本来の IP へ戻す。

9. Bambda フィルタを **Apply** すると、どの範囲に適用されるか。注意点は何か。
   ▶ 答え: **既にログ済みの全項目**と、**このプロジェクトで今後生成される全トラフィック**の両方に適用される。遅い／重い Bambda は Burp を遅くするので慎重に書く。

10. Client TLS certificates で使える 2 つの証明書タイプは何か。
    ▶ 答え: **File (PKCS#12)**（`.p12` 拡張子が必須。ファイルとパスワードを指定）と **Hardware token or smartcard (PKCS#11)**（PKCS#11 ライブラリファイルと PIN を指定）。

## 出典

- Burp Proxy（ツール概要）: https://portswigger.net/burp/documentation/desktop/tools/proxy
- Proxy settings（Settings > Tools > Proxy 全項目）: https://portswigger.net/burp/documentation/desktop/settings/tools/proxy
- HTTP history: https://portswigger.net/burp/documentation/desktop/tools/proxy/http-history
- HTTP history filter settings: https://portswigger.net/burp/documentation/desktop/tools/proxy/http-history/filter-settings
- HTTP history Bambdas: https://portswigger.net/burp/documentation/desktop/tools/proxy/http-history/bambdas
- WebSockets history: https://portswigger.net/burp/documentation/desktop/tools/proxy/websockets-history
- Invisible proxying: https://portswigger.net/burp/documentation/desktop/tools/proxy/invisible
- Connections settings: https://portswigger.net/burp/documentation/desktop/settings/network/connections
- TLS settings: https://portswigger.net/burp/documentation/desktop/settings/network/tls

<!-- self-read: https://portswigger.net/burp/documentation/desktop/settings/tools/proxy | サイト側の egress 制限で自動取得できず、predefined match and replace rules の実際の一覧は UI でしか確認できない -->

<!-- sources: https://portswigger.net/burp/documentation/desktop/tools/proxy, https://portswigger.net/burp/documentation/desktop/settings/tools/proxy, https://portswigger.net/burp/documentation/desktop/tools/proxy/http-history, https://portswigger.net/burp/documentation/desktop/tools/proxy/http-history/filter-settings, https://portswigger.net/burp/documentation/desktop/tools/proxy/http-history/bambdas, https://portswigger.net/burp/documentation/desktop/tools/proxy/websockets-history, https://portswigger.net/burp/documentation/desktop/tools/proxy/invisible, https://portswigger.net/burp/documentation/desktop/settings/network/connections, https://portswigger.net/burp/documentation/desktop/settings/network/tls -->
<!-- terms: Burp Proxy, Proxy listener, loopback, project settings, user settings, Response modification rules, match and replace, TLS pass through, TLS フィンガープリント, 証明書ピンニング, HTTP history, WebSockets history, Bambda, Montoya API, Invisible proxying, SNI, Host ヘッダ, sslstrip, HSTS, Upstream proxy, Hostname resolution overrides, SOCKS proxy, PKCS#12, PKCS#11, Interception rules -->
