## Playground でフローを動かし OIDC を理解する

OAuth 2.0 と OpenID Connect（OIDC）は、仕様書を読むだけではロールやトークンの受け渡しが頭の中で線としてつながりにくい。本節では、実際にブラウザから叩ける Playground（動作確認用サンドボックス環境）を使って、代表的な5つのフロー（Authorization Code, PKCE付きAuthorization Code, Implicit, Device Code, OpenID Connect）が「どのHTTPリクエストの連鎖」として実装されているかを、具体的なパラメータ付きで追う。あわせて、OpenID Foundation の公式解説と、初心者向けにOAuthの本質的な設計思想をかみ砕いた記事も参照し、「なぜこの手順でなければならないのか」を機構レベルで理解することを目指す。

### 4つのアクターと「委任」というOAuthの本質

まず前提を揃える。OAuth 2.0 は「認証(authentication：相手が誰であるかの確認)」の仕組みではなく、「認可(authorization：ある権限の委任)」の仕組みとして設計された。Frederik Banke の記事は、この点を次のように整理している。

> OAuth 2 is designed to solve one use case, which is not authentication as the name suggests, but rather the problem where a user has access to a resource and wants to allow a third party to have the same access.

具体的には、以前は「サードパーティにパスワードそのものを渡す」ことでこの問題を解決していたが、この方式には致命的な欠陥があった。パスワードを変更すると、渡していたすべてのサードパーティのアクセスが一斉に失われる（あるいは、パスワードを使い回されたまま気づかない）。OAuth 2.0 はこれを、パスワードの代わりに「範囲(scope)と有効期限が限定された引換券（トークン）」を発行する仕組みに置き換えた。

登場人物（ロール）は4つに整理される。

| ロール | 役割 |
|---|---|
| リソースオーナー (Resource Owner, RO) | データの持ち主。人間のユーザー本人 |
| クライアント (Client) | ROの代わりにリソースへアクセスしたいアプリケーション |
| リソースサーバー (Resource Server, RS) | 実際にデータを保持するAPI |
| 認可サーバー (Authorization Server, AS) | トークンを発行する、OAuthの心臓部 |

> 出典: OAuth and OpenID Connect for dummies — https://medium.com/@frederikbanke/oauth-and-openid-connect-for-dummies-ec18df6a233 （ミラー: https://www.frederikbanke.com/oauth-and-openid-connect-for-dummies/ )

この「委任」という前提を頭に入れておくと、以降の各フローで「なぜstateやnonceやPKCEが必要なのか」がすべて「委任の経路を横取りされないため」という一点に収束することが見えてくる。

### Authorization Code Flow: 最も基本の6段階

OAuth.com Playground（各フローを実際のHTTPリクエストとして体験できるサンドボックス）は、Authorization Code Flow を次のような具体的なリクエスト列として提示する。

**A段階 — 認可リクエスト（ブラウザ経由）**

ユーザーのブラウザ（ユーザーエージェント）を、次のようなURLへリダイレクトさせる。

```
https://oauthserver/authorize?client_id=...&response_type=code&scope=read
```

- `client_id`: 認可サーバーに事前登録済みのクライアント識別子。秘密情報ではなく公開されてよい値。
- `response_type=code`: 「認可コードが欲しい」という宣言。ここが `token` になると後述のImplicit Flowに切り替わる。
- `scope`: クライアントが要求する権限の範囲（例: `read`）。

**B段階 — ユーザー認証と同意**

認可サーバー側の画面でユーザーがログインし、「このアプリに`read`権限を許可しますか」という同意画面が表示される。ここで初めてユーザーの認証情報（パスワード等）が認可サーバーにのみ入力され、クライアント側のアプリはそれを一切見ない。これがOAuthの最大の利点であり、パスワード共有方式との根本的な違いである。

**C段階 — 認可コードのリダイレクト返却**

同意後、あらかじめ登録された `redirect_uri` へ、`code`パラメータを付与してリダイレクトされる。この`code`は「一度きり使える短命の引換券」であり、それ自体はアクセストークンではない。

**D段階 — バックエンドへの引き渡し**

ブラウザ経由で受け取った認可コードは、クライアントのバックエンド（サーバーサイドの機密領域。ブラウザJSからは見えない）に渡される。

**E段階 — トークンエンドポイントでの交換**

バックエンドが、認可コードと`client_secret`（クライアントだけが知る秘密情報）を使って、直接（ブラウザを経由しない、サーバー間の）POSTリクエストでトークンエンドポイントにアクセストークンを要求する。

```
https://oauthserver/token?client_id=...&client_secret=123&grant_type=authorization_code
```

**なぜコードとトークンの交換を2段階に分けるのか**: もし最初のリダイレクト（A〜C段階）でいきなりアクセストークンを返してしまうと、ブラウザ履歴・リファラヘッダ・ブラウザ拡張機能などを経由してトークンが漏洩するリスクが高い（この危険性は後述のImplicit Flowでまさに問題になる）。認可コードは「ブラウザという信頼できない経路」を通す使い捨ての中継券に過ぎず、本物のアクセストークンは「サーバー間通信という比較的安全な経路」でのみやり取りする、という設計上の分離がここに表れている。

**取得したトークンの使い方**

アクセストークンは、以降のAPIリクエストで次のようにHTTPヘッダに付与する。

```
Authorization: Bearer <access_token>
```

リソースサーバーは、このトークンが本物で有効かをどう確かめるのか。Bankeの記事では、伝統的には「イントロスペクション(introspection：トークンの中身や有効性を認可サーバーに問い合わせて確認するプロセス)」という仕組みが使われると説明されている。リソースサーバーは受け取ったトークンをそのまま信用せず、認可サーバーに「このトークンはまだ有効か、どのスコープを持つか」を都度問い合わせる。

> 出典: OAuth 2.0 Playground — https://www.oauth.com/playground/

### Authorization Code with PKCE: なぜ「証明」が追加で必要になるのか

PKCE（Proof Key for Code Exchange、「ピクシー」と読む）は、Authorization Code Flowに追加のステップを挟んだ拡張である。OAuth.com Playgroundの解説を見ると、まずクライアント側で次のような値を生成する。

> a cryptographically random string using characters A-Z, a-z, 0-9, and punctuation (-._~), between 43-128 characters long

これが `code_verifier`（検証用の秘密の乱数文字列）である。そこから次の変換で `code_challenge`（挑戦値、公開してよいハッシュ値）を導出する。

```
code_challenge = base64url(sha256(code_verifier))
```

そして認可リクエストには、生の`code_verifier`ではなく、この`code_challenge`だけを載せる。

```
response_type=code
client_id=[登録済みクライアントID]
redirect_uri=/authorization-code-with-pkce.html
scope=photo+offline_access
state=[CSRF対策のランダム文字列]
code_challenge=[上で生成した値]
code_challenge_method=S256
```

その後、認可コードをトークンに交換する段階（POSTリクエスト）で、今度は元の `code_verifier`（生の値）を一緒に送る。認可サーバー側は、受け取った`code_verifier`を同じ方法でハッシュ化し、最初に受け取っていた`code_challenge`と一致するかを検証する。Playgroundの説明を借りれば、

> the authorization server will check whether the verifier matches the challenge that was used in the authorization request

**このひと手間が防いでいる攻撃は何か**: 通常のAuthorization Code Flowでは、悪意ある別アプリ（同一デバイス上の別プロセスや、公開クライアント環境でカスタムURLスキームを横取りする悪性アプリなど）が、リダイレクト時の認可コードを横から盗み見て、正規クライアントより先にトークンエンドポイントへ送りつけてしまう「認可コード注入(authorization code injection)」が理論上可能である。PKCEがあれば、コードを盗んだ攻撃者は`code_challenge`の元になった`code_verifier`（クライアントのメモリ上にしか存在しない一時的な秘密値）を知らないため、コードを盗んでもトークンに交換できない。

もともとPKCEは、クライアントシークレットを安全に保管できないモバイルアプリやSPA（ネイティブ/公開クライアント）のために設計されたが、Playgroundの解説は次のように述べて、機密クライアント（サーバーサイドで`client_secret`を安全に持てるWebアプリ）を含む「すべてのクライアント種別」に適用すべきだとしている。

> PKCE should be used on every Authorization Code flow ... its protection against authorization code injection makes it valuable for all client types, including confidential web apps.

> 出典: Authorization Code with PKCE Flow - OAuth 2.0 Playground — https://www.oauth.com/playground/authorization-code-with-pkce.html

### Implicit Flow: なぜ非推奨(deprecated)になったのか

Implicit Flowは、Authorization Code Flowから「バックエンドでのトークン交換」の段階を省略し、認可サーバーがブラウザへのリダイレクトの中に直接アクセストークンを埋め込む方式である。`response_type=token` を指定するのがこのフローの入り口になる。

Playgroundの実演では、ユーザーが認可サーバーからクライアントへリダイレクトされてくる際、URLは次のような**フラグメント成分**（`#`以降の部分）にトークンを含む形になる。

```
https://client.example.com/callback#access_token=...&token_type=Bearer&expires_in=3600&scope=read&state=xyz
```

なぜ`?`のクエリ文字列ではなく`#`のフラグメントを使うのか。フラグメントはHTTPリクエストとしてサーバーに送信されない（ブラウザ内部だけで処理される）ため、access_tokenがWebサーバーのアクセスログに記録されてしまうことを避けられる、というのが設計意図である。しかし、Playgroundの警告文はこの方式の根本的な弱点を明確に指摘している。

> 悪意のある行為者があなたのクライアントにアクセストークンを注入することを防ぐ解決策はありません

つまり、ブラウザのURLフラグメントという経路そのものが、ブラウザ履歴・ブラウザ拡張機能・同一オリジン上で動く別スクリプト・リファラ経由の漏洩など、様々な経路でトークンを盗聴・改ざんされうる。Authorization Code Flowであれば「盗まれても交換に失敗する（PKCEがあれば特に）」という防御線を張れるが、Implicit Flowはトークンそのものが最初からブラウザに露出しているため、盗まれた時点でそれが即座に有効なアクセストークンとして使われてしまう。この構造的な脆弱性のため、OAuth 2.0 Security Best Current Practice（IETFの最新ベストプラクティス文書）ではImplicit Flowは非推奨と位置づけられており、Playgroundも「セキュリティBCPで非推奨とされている」と明記している。実務では、SPAであってもPKCE付きAuthorization Code Flowを使うことが2019年以降の標準的な推奨である。

> 出典: OAuth 2.0 Playground（Implicit Flow） — https://www.oauth.com/playground/

### Device Code Flow: 入力手段が乏しい端末のための設計

Device Code Flow（デバイス認可フロー）は、スマートTV・IoT機器・CLIツールなど、ブラウザを直接操作したりURLを入力したりするのが困難な端末向けに設計されている。Playgroundの実演は次の3段階で構成される。

**ステップ1: デバイスコードのリクエスト**

デバイス自身が、認可サーバーの専用エンドポイントにPOSTリクエストを送る。

```
POST https://example.okta.com/device
client_id=https://www.oauth.com/playground/
```

**ステップ2: ユーザーへのコード提示**

サーバーは次のような情報を返す。

- `device_code`: デバイス自身が後でポーリングに使う長い内部コード（例: `NGU5OWFiNjQ5YmQwNGY3YTdmZTEyNzQ3YzQ1YSA`）
- `user_code`: 人間が別のデバイス（スマホやPC）で入力する短いコード（例: `BDWD-HQPK`）
- `verification_uri`: ユーザーがアクセスすべきURL（例: `https://example.okta.com/device`）
- `interval`: ポーリング間隔（例: 5秒）
- `expires_in`: コードの有効期限（例: 1800秒）

デバイスはこの`user_code`と`verification_uri`を画面（あるいは音声）でユーザーに提示する。ユーザーは手元のスマホやPCのブラウザでそのURLにアクセスし、コードを入力してログイン・同意を行う。

**ステップ3: トークンエンドポイントのポーリング**

その間、デバイス自身は次のリクエストを一定間隔で送り続ける（ポーリング＝繰り返し問い合わせる）。

```
grant_type=urn:ietf:params:oauth:grant-type:device_code
&device_code=[取得したdevice_code]
```

ユーザーがまだ承認していない間は、サーバーは`authorization_pending`というエラーを返し続ける。ユーザーの承認が完了した瞬間に、同じポーリングリクエストへの応答としてアクセストークンが返される。

**なぜこの設計が必要か**: デバイス側にはブラウザもキーボードも(まともに)ないため、リダイレクトベースの認可コードフローは物理的に実行できない。そこでデバイスとユーザーの「操作する場所」を完全に分離し、デバイスは受動的にポーリングするだけ、ユーザーは使い慣れた別端末で通常のログインフローを踏む、という役割分担にしている。

> 出典: OAuth 2.0 Playground（Device Code Flow） — https://www.oauth.com/playground/

### OpenID Connect: 「認証」を後付けする仕組み

ここまでのOAuth 2.0の各フローは、あくまで「権限の委任」のためのものであり、「このユーザーが誰であるか」を保証する仕組みは含まれていない。これがしばしば誤用の原因になる（アクセストークンを持っていることを、そのまま「ログイン成功の証」として扱ってしまう設計ミス）。この隙間を埋めるために標準化されたのが OpenID Connect（OIDC）である。

Bankeの記事は次のように端的に説明する。

> OAuth 2は認証機能を提供しないため、OpenID Connectが構築された。初期リクエストに「openid」スコープを追加すると、新しいトークン「id_token」が有効になる。

つまりOIDCは、OAuth 2.0のフローに `scope=openid` を追加するだけで、認可サーバー（この文脈では OpenID Provider, OP と呼ぶ）が `access_token` に加えて `id_token` という新しい種類のトークンを発行してくれる、という「OAuth 2.0の上に薄く被せた拡張仕様」である。

#### OpenID Foundationが定義する7ステップの認証フロー

OpenID Foundation公式の解説ページは、OIDCの基本的な認証の流れを次の7ステップで説明している。

1. End user navigates to a website or web application via a browser（ユーザーがブラウザでアプリにアクセスする）
2. End user clicks sign-in and types their username and password（サインインしてID/パスワードを入力する）
3. The RP (Client) sends a request to the OpenID Provider（RPがOPにリクエストを送る）
4. The OP authenticates the User and obtains authorization（OPがユーザーを認証し、認可を得る）
5. The OP responds with an Identity Token and usually an Access Token（OPがIDトークンと、通常はアクセストークンも返す）
6. The RP can send a request with the Access Token to the User device（RPはアクセストークンを使ってリソースにリクエストできる）
7. The UserInfo Endpoint returns Claims about the End-User（UserInfoエンドポイントがユーザーに関するクレームを返す）

ここで登場する用語を整理しておく。

- **RP (Relying Party)**: 認証の結果を「頼りにする」側、つまりクライアントアプリケーション自身のOIDCにおける呼び名。OpenID Foundationの定義では「A piece of software that requests tokens either for authenticating a user or for accessing a resource」とされる。
- **OP (OpenID Provider)**: OAuth 2.0でいう認可サーバーに相当し、IDプロバイダとも呼ばれる。
- **Identity Token (id_token)**: 「an identifier for the user (called the sub aka subject claim) and information about how and when the user authenticated（ユーザーの識別子である`sub`クレームと、いつ・どうやって認証したかの情報）」を含む、認証結果そのものを表すトークン。

> 出典: How OpenID Connect Works — OpenID Foundation — https://openid.net/developers/how-connect-works/

#### id_tokenの中身: JWTとして検証可能な「認証の証明書」

id_tokenの実体はJWT（JSON Web Token: 署名付きで自己完結的にクレーム情報を運ぶトークン形式）であり、Base64URLエンコードされた3つのパートをピリオドで連結した文字列である。デコードすると次のようなクレーム（主張）が現れる。

```json
{
  "sub": "alice",
  "iss": "https://openid.c2id.com",
  "aud": "client-12345",
  "auth_time": 1311280969,
  "exp": 1311281970
}
```

- `sub` (subject): ユーザーの一意な識別子。
- `iss` (issuer): このトークンを発行したOPのURL。
- `aud` (audience): このトークンの受け取り手として想定されているクライアントID。
- `auth_time`: 実際にユーザーが認証した時刻。
- `exp` (expiration): トークンの有効期限。

**access_tokenとid_tokenの本質的な違い**: access_tokenは「このリソースにアクセスしてよい」という権限の証明書であり、中身の形式はOAuth仕様上定義されていない（不透明な文字列でもよい）。一方id_tokenは、必ずJWT形式で、かつ「誰が・いつ・どうやって認証されたか」というアイデンティティ情報そのものを運ぶ。id_tokenは署名されているため、RP（クライアント）はOPの公開鍵（JWKSエンドポイントなどで配布される）を使ってその場で署名を検証でき、Bankeの記事いわく「これにより『イントロスペクション』の必要性が減り、認可サーバーの負荷が軽減される」。access_tokenの正当性確認にはサーバーへの問い合わせ（イントロスペクション）が必要になりがちなのに対し、id_tokenは自己完結的に検証できる、という設計上の非対称性がここにある。

#### OAuth.com PlaygroundにおけるOIDCフローの実例

OAuth.com Playgroundの OpenID Connect ページでは、Authorization Code Flowとほぼ同じ骨格に、次のパラメータが加わる形で実演される。

```
response_type=code
client_id=...
redirect_uri=/oidc.html
scope=openid+profile+email+photos
state=[CSRF対策のランダム文字列]
nonce=[リプレイ攻撃対策のランダム値]
```

`scope`に`openid`を含めることが、OIDCフローを起動する唯一のスイッチである。`profile`や`email`は、UserInfoエンドポイントやid_tokenに含めてほしい追加のクレームカテゴリを要求するものであり、`openid`スコープと組み合わせて使う。

**nonce（ノンス）とは何か**: これは一度きり使われる乱数値で、認可リクエストの中に含めてOPに送る。OPはこの値をそのままid_tokenのクレームとして埋め込んで返す。RP側は、返ってきたid_token内の`nonce`が自分が最初に送った値と一致するかを検証する。これによって、攻撃者が古い認可レスポンス（あるいは他のセッション用に発行されたid_token）を横取りしてリプレイ（再送）し、なりすましログインを成立させる攻撃を防ぐ。`state`パラメータがOAuth全体でのCSRF対策（このリダイレクトが自分が開始したリクエストへの応答であることの確認）を担うのに対し、`nonce`はOIDC固有の、id_token自体の再利用を防ぐ仕組みである、という役割分担を意識するとよい。

トークンエンドポイントへの交換リクエスト自体はAuthorization Code Flowと同じ形（POST + `code` + `client_id`/`client_secret`）だが、レスポンスに`access_token`だけでなく`id_token`が追加される点が異なる。Playgroundの解説を借りれば、クライアントは最終的に「an "ID Token", which contains information about the user」を手にすることになる。

> 出典: OpenID Connect Authorization Code Flow - OAuth 2.0 Playground — https://www.oauth.com/playground/oidc.html

### ⚠️ 未取得の資料について（openidconnect.net）

> ⚠️ **未取得の資料**: 「OpenID Connect Playground」（https://www.openidconnect.net/）は自動取得できませんでした（理由: ページ本体がJavaScriptによる動的レンダリングのSPAであり、自動取得ツールでは静的HTML内にタイトルのみが確認でき、実際のフォームやフローの説明文を含む本文コンテンツを抽出できませんでした）。以下のURLからご自身で直接ご覧ください: https://www.openidconnect.net/

（以下は未取得資料の補足として一般知識に基づく解説です）openidconnect.net は、OpenID Connect の仕様策定にも関わったNat Sakimura氏らが公開している、ブラウザから直接OIDCの各フロー(Authorization Code Flow, Implicit Flow, Hybrid Flow)を試せるサンドボックスである。事前に用意されたテスト用のOP（OpenID Provider）に対して、`response_type`を`code`・`id_token token`・`code id_token`などに切り替えながら実際にリクエストを飛ばし、返ってきたid_tokenやaccess_tokenの生の値とデコード結果を画面上で確認できる点が特徴で、上記のOAuth.com Playgroundと組み合わせて使うことで、OAuth 2.0の素のフローとOIDCが上乗せする要素(id_token, nonce, UserInfoエンドポイント)の違いを、実際のHTTPトラフィックとして体感的に区別できるようになる。ただし同サイトは長期間更新が止まっている面があり、TLS証明書の期限切れや仕様の細部（例えば新しいセキュリティBCPの反映状況）が最新とは限らない点には注意し、学習目的の参照に留めるのが安全である。

### 本節のまとめ: フロー選択の指針

実務でどのフローを選ぶべきかは、クライアントの性質によってほぼ機械的に決まる。

- サーバーサイドで動く機密クライアント（`client_secret`を安全に保管できる）: Authorization Code Flow（+ PKCE推奨）
- SPA・モバイルアプリなどの公開クライアント（`client_secret`を安全に保管できない）: Authorization Code Flow + PKCE（必須）
- ブラウザもキーボードもまともにない端末: Device Code Flow
- Implicit Flow: 現在は非推奨。新規実装では使用しない
- ログイン（認証）が目的: 上記いずれかのフローに`scope=openid`を足したOIDCフロー

いずれのフローも、Playgroundで実際のHTTPリクエスト・レスポンスを自分の目で追うことで、「なぜstate/nonce/PKCEが必要なのか」「トークンがどの経路をどう流れるのか」という設計意図が、仕様書を読むだけよりもはるかに具体的に理解できるはずである。
