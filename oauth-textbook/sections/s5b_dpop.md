## DPoP（RFC 9449）による送信者制約トークン

OAuth 2.0 のアクセストークンは、長いあいだ **Bearer トークン**（持っている人なら誰でも使える「持参人払い」のトークン）として運用されてきました。Bearer という名前のとおり、`Authorization: Bearer <token>` を送ってきた相手が「正規のクライアントかどうか」はリソースサーバ（API）側では確認しません。トークンの文字列がそのまま「鍵」なのです。

そのため、次のような経路でトークンが漏れると、攻撃者はそのまま API を呼べてしまいます。

- XSS（クロスサイトスクリプティング）で `localStorage` のトークンを読み出される
- ログ、APM（性能監視）やエラー報告ツールにヘッダごと記録される
- リダイレクト URI やリファラ経由で漏れる（Implicit フローの時代に多かった経路）
- 悪意ある、あるいは侵害されたリソースサーバが、受け取ったトークンを別の API に使い回す（トークンの再送、replay）

この問題に対する答えが **送信者制約トークン（sender-constrained token）** です。トークンを特定の鍵に結びつけておき、「その鍵を持っていることを証明できる送信者」だけが使えるようにします。これを **PoP（Proof-of-Possession、所持証明）** と呼びます。送信者制約の標準的な方式は次の2つです。

| 方式 | 仕様 | 結びつける対象 | 動作する層 |
|---|---|---|---|
| mTLS バインディング | RFC 8705 | クライアントの X.509 証明書 | TLS（トランスポート層） |
| **DPoP** | **RFC 9449（2023年9月）** | クライアントが生成した公開鍵（JWK） | HTTP / アプリケーション層 |

この節では、アプリケーション層で動く DPoP（Demonstrating Proof of Possession、所持証明のデモンストレーション）について、仕組み・メッセージの形・検証手順・実装時の落とし穴を解説します。

---

### 1. DPoP の全体像と基本の流れ

WorkOS の解説は、DPoP を「アクセストークンとリフレッシュトークンを、クライアントが持つ公開鍵/秘密鍵ペアに**バインド（結びつけ）**する、アプリケーション層の仕組み」と定義しています。クライアントは**トークン要求のたびに、そしてリソース要求のたびに**、新しい「証明 JWT（DPoP proof）」を秘密鍵で署名して送ります。トークンが盗まれても、攻撃者は秘密鍵を持っていないので正しい proof を作れず、トークンは使えません。

エンドツーエンドの流れは次の6ステップです。

1. **鍵ペアを作る**: クライアントは非対称鍵ペア（一般的には楕円曲線 P-256）を生成し、保存しておく。
2. **トークン要求に proof を付ける**: 認可コードをトークンに交換するとき、`DPoP` HTTP ヘッダに proof JWT を載せる。
3. **認可サーバが鍵を刻む**: 認可サーバ（AS）は proof を検証し、proof に含まれる公開鍵の **JWK SHA-256 サムプリント**（鍵の指紋。RFC 7638 で定義された、JWK の必須メンバを正規化して SHA-256 したもの）を計算し、発行するトークンの `cnf.jkt` にその値を入れる。
4. **token_type が変わる**: トークンレスポンスの `token_type` は `Bearer` ではなく **`DPoP`** になる。
5. **API 呼び出しにも proof を付ける**: クライアントはアクセストークンと、**新しく作った** proof（アクセストークンのハッシュ `ath` を含む）の両方を送る。
6. **リソースサーバが照合する**: リソースサーバ（RS）は proof の署名を検証し、`htm`/`htu` が実際のリクエストと一致するかを確認し、proof の公開鍵のサムプリントがトークンの `cnf.jkt` と一致するかを確かめる。

図にすると次のようになります。

```text
 Client                         Authorization Server              Resource Server
   |  (0) 鍵ペア生成 (P-256)            |                                  |
   |                                    |                                  |
   |-- POST /token ------------------->|                                  |
   |   DPoP: <proof{htm=POST,htu=/token}>                                 |
   |   grant_type=authorization_code... |                                  |
   |                                    | proof検証 → jkt = SHA256(JWK)     |
   |<-- {access_token(cnf.jkt), -------|                                  |
   |     token_type:"DPoP", refresh_token}                                 |
   |                                                                       |
   |-- GET /resource ---------------------------------------------------->|
   |   Authorization: DPoP <access_token>                                  |
   |   DPoP: <proof{htm=GET,htu=/resource,ath=SHA256(token)}>              |
   |                                           署名検証・htm/htu・ath・     |
   |                                           thumbprint == cnf.jkt ?     |
   |<-- 200 OK ------------------------------------------------------------|
```

**なぜこれで盗難に強くなるのか。** 認可サーバがトークンに刻むのは公開鍵そのものではなく、その「指紋」（`cnf.jkt`）です。リソースサーバは、リクエストに付いてきた proof の公開鍵から指紋を計算し直し、トークン内の指紋と比べます。攻撃者が自分の鍵で proof を作れば、指紋が一致しません。正規クライアントの公開鍵を proof ヘッダに入れることはできても、その公開鍵に対応する**秘密鍵で署名する**ことはできません。つまり「トークン＋秘密鍵」がそろわないと API は通らず、トークン単体の価値はほぼなくなります。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 2. DPoP proof JWT の構造

DPoP proof は普通の JWS（署名付き JWT）ですが、ヘッダと内容に独自の決まりがあります。

#### 2.1 ヘッダ

```json
{
  "typ": "dpop+jwt",
  "alg": "ES256",
  "jwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "...",
    "y": "..."
  }
}
```

- **`typ: "dpop+jwt"` は必須**です。この JWT が DPoP proof であることを明示し、ID トークンや JWT アクセストークン（`at+jwt`）など**別用途の JWT と取り違える攻撃**（token confusion。ある文脈で有効な JWT を別の文脈に持ち込む手口）を防ぎます。検証側は最初に `typ` を確認するべきです。
- **`alg` は非対称アルゴリズムに限られます**。`HS256` のような対称鍵アルゴリズムは**禁止**です。理由は単純で、HMAC は署名と検証に同じ秘密を使うため、「公開鍵をヘッダに載せて誰でも検証できるようにする」という DPoP の設計と両立しないからです。`none` も当然不可です。
- **`jwk` に公開鍵そのものを埋め込みます**。事前のクライアント登録や証明書（PKI）が不要なのはこのためです。検証側は「この JWT が、ヘッダに書かれた鍵で署名されているか」を確かめ、次にその鍵の指紋がトークンの `cnf.jkt` と合うかを見ます。RFC 9449 では、`jwk` に**秘密鍵の成分（EC の `d` など）を含めてはならない**とされています。

#### 2.2 ペイロード（トークンエンドポイント向け）

```json
{
  "jti": "c1d2e3f4-5678-9abc-def0-1234567890ab",
  "htm": "POST",
  "htu": "https://auth.example.com/oauth2/token",
  "iat": 1745107200
}
```

| クレーム | 意味 | なぜ必要か |
|---|---|---|
| `jti` | proof ごとに一意な ID | 同じ proof の使い回し（リプレイ）を検出するため。サーバは一定時間 `jti` を記録する |
| `htm` | HTTP メソッド（`POST`、`GET` など） | 別メソッドへの流用を防ぐ |
| `htu` | HTTP の対象 URI（**クエリ文字列とフラグメントを除く**） | 別エンドポイントへの流用を防ぐ |
| `iat` | 発行時刻 | 古い proof を拒否するため（有効期間を短くする） |

`htm` と `htu` によって、proof は「**この**メソッドで**この** URL に送る**この**1回のリクエスト」に限定されます。仮に proof がトークンと一緒に漏れても、別の API に転用することはできません。

#### 2.3 ペイロード（リソースサーバ向けに追加されるクレーム）

- **`ath`**: アクセストークンの SHA-256 ハッシュを base64url エンコードした値。
- **`nonce`**: サーバが発行した nonce（後述）を求められた場合に入れる。

**`ath` が必要な理由。** `ath` がないと、proof と一緒に送るトークンを入れ替えられてしまいます。たとえば、同じ鍵に紐づく「権限の小さいトークン」と「権限の大きいトークン」がある場合や、何らかの理由で事前に作られた proof が漏れた場合に、proof とトークンの組み合わせを変える余地が生じます。`ath` を入れることで、proof は**特定のアクセストークン1つ**にも結びつきます。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 3. HTTP 上での見え方

Auth0 のブログ（2023年12月22日公開）は、HTTP ヘッダの実例で流れを示しています。

**トークンエンドポイントへの要求**では、クライアントが鍵ペアを生成し、公開鍵・HTTP メソッド・URI を含む proof を作って、認可コードと一緒に送ります。

```http
POST /oauth/token HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded
DPoP: eyJhbGciOiJFUzI1NiIsInR5cCI6ImRwb3Arand0IiwiandrIjp7Imt0eSI6IkVDIiwiY3J2I...

grant_type=authorization_code&code=...&redirect_uri=...&code_verifier=...
```

`DPoP` ヘッダ値の先頭 `eyJhbGciOiJFUzI1NiIsInR5cCI6ImRwb3Arand0Iiwiandr...` を base64url デコードすると `{"alg":"ES256","typ":"dpop+jwt","jwk":{"kty":"EC","crv"...` になります。つまり先ほどのヘッダ構造そのものです。

認可サーバは proof の署名と、リクエスト内容（メソッド・URI）を検証し、**JWK サムプリントを埋め込んだアクセストークン**を返します。

**API 呼び出し**では、2つのヘッダを同時に送ります。

```http
GET /api/orders HTTP/1.1
Host: api.example.com
Authorization: DPoP eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K0pXVCIsImNuZiI6eyJqa3QiOiJybW56aTJvSWNYW...
DPoP: eyJhbGciOiJFUzI1NiIsInR5cCI6ImRwb3Arand0IiwiandrIjp7Imt0eSI6IkVDIiwiY3J2I...
```

ここで注目したい点が2つあります。

1. **認証スキームが `Bearer` ではなく `DPoP`** になっています。リソースサーバは「このトークンは DPoP 束縛されているので、proof の検証が必須」と判断できます。逆に、DPoP 束縛されたトークン（`cnf.jkt` を持つトークン）が `Bearer` スキームで送られてきたら、**拒否しなければなりません**。受け入れてしまうと、攻撃者は proof を付けずに Bearer としてトークンを使えてしまい、ダウングレード（保護の弱い方式への切り替え）が成立します。
2. Auth0 の例では、アクセストークン（JWT）のヘッダ部分をデコードすると `{"alg":"ES256","typ":"at+JWT","cnf":{"jkt":"rmnzi2oIcX...` のように、**`cnf.jkt` がトークン内部に含まれている**ことがわかります（一般的な実装では `cnf` はペイロード側のクレームです）。JWT 形式でないトークン（参照トークン）の場合、リソースサーバは RFC 7662 のイントロスペクション（トークン情報照会）エンドポイントから `cnf.jkt` を取得します。

API は、アクセストークンと proof の両方を検証して、「このリクエストが本来の送信者から来ている」ことを確認します。

> 出典: Auth0「OAuth 2.0 Security Enhancements」（2023-12-22） — https://auth0.com/blog/oauth2-security-enhancements/

---

### 4. 認可サーバとリソースサーバの検証手順

WorkOS の記事は、両サーバが実装すべき検証をまとめています。RFC 9449 の要件と照らし合わせて整理します。

#### 4.1 認可サーバ（トークンエンドポイント）

1. `DPoP` ヘッダがちょうど1つあり、1つの整形式 JWT であることを確認する。
2. **最初に `typ === "dpop+jwt"` を確認する**。
3. `alg` が非対称で、サーバがサポートするものであることを確認する（`none`、対称鍵は拒否）。
4. ヘッダ内の `jwk` を使って署名を検証する。
5. `iat` が許容範囲内かを確認する（**よく使われる窓は60秒程度**。時計のずれを考慮する）。
6. `jti` を記録して**リプレイを検知**する。
7. `htm`/`htu` が実際のリクエストと一致するかを確認する。
8. nonce を要求している場合は、`nonce` が有効かを確認する。
9. JWK の SHA-256 サムプリントを計算し、トークンの `cnf.jkt` に入れる。
10. サーバメタデータの **`dpop_signing_alg_values_supported`** で、サポートする署名アルゴリズムを公開する。

#### 4.2 リソースサーバ

1. `Authorization: DPoP <token>` を探す（`Bearer` ではない）。
2. トークンから `cnf.jkt` を取り出す（JWT なら中身から、そうでなければイントロスペクションで取得）。
3. proof の署名・`typ`・`alg`・`iat`・`jti`・`htm`/`htu` を検証する（手順は AS と同じ）。
4. **`ath` が、提示されたアクセストークンの SHA-256 ハッシュと一致するか**確認する。
5. **proof の JWK サムプリントが `cnf.jkt` と一致するか**確認する。

エラー時、RFC 9449 ではリソースサーバが `WWW-Authenticate: DPoP error="invalid_dpop_proof", algs="ES256 PS256"` のようにチャレンジを返す形が定められています（`algs` はサポートするアルゴリズムの一覧）。

**`htu` の比較についての注意。** `htu` はクエリとフラグメントを**除いた** URI です。リバースプロキシや API ゲートウェイの背後にあるサーバは、自分が受け取った内部 URL（例: `http://10.0.0.5:8080/orders`）ではなく、**クライアントが実際に送った外部 URL**（`https://api.example.com/orders`）と比較する必要があります。ここの比較ミスは、正規の要求が失敗する原因にも、比較を緩めすぎた結果の抜け穴にもなりがちです。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 5. サーバ発行 nonce によるリプレイ対策の強化

`jti` と `iat` だけでは、「**未来の時刻の proof をあらかじめ作っておく**」攻撃に弱いという問題があります。たとえば XSS でクライアント側のコードを一時的に実行できた攻撃者は、秘密鍵そのもの（非抽出の鍵）は持ち出せなくても、**後で使う proof を大量に署名させて持ち出す**ことができます。そこで RFC 9449 は、任意機能として **サーバ発行 nonce** を用意しています。nonce はサーバが決める値なので、クライアントが事前に予測して proof に入れることはできません。

流れは次のとおりです。

1. クライアントが nonce なし（または古い nonce）で要求する。
2. サーバが **`400 invalid_dpop_proof`**（認可サーバの場合は `use_dpop_nonce` エラー）と **`DPoP-Nonce` ヘッダ**を返す。
3. クライアントは、その nonce を `nonce` クレームに入れた proof を作り直して再送する。
4. サーバはその後のレスポンスヘッダで、定期的に新しい nonce を配る（ローテーション）。

```http
HTTP/1.1 400 Bad Request
DPoP-Nonce: eyJ7S_zG.eyJH0-Z.HX4w-7v
Content-Type: application/json

{"error":"use_dpop_nonce","error_description":"Authorization server requires nonce in DPoP proof"}
```

実装上の重要な注意として、**認可サーバの nonce とリソースサーバの nonce は別物**です。クライアントは発行元ごとに別々に管理しなければなりません。一方の nonce をもう一方に送ると失敗します。

nonce を使うとリクエストが1往復増えることがありますが、サーバは nonce を時刻ベースで作るなどして、`jti` のサーバ側保存を軽くすることもできます（有効期間内の nonce に紐づく `jti` だけを記録すればよいため）。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 6. ブラウザでの鍵の保管 — 非抽出鍵と IndexedDB

DPoP の効果は、**秘密鍵が盗まれないこと**に完全に依存します。ブラウザ（SPA）では、Web Crypto API で**非抽出（non-extractable）**の鍵を作るのが定石です。

```javascript
const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  false,              // non-extractable
  ["sign", "verify"]
);
```

- 第2引数 `false` が「抽出不可」の指定です。こうして作った `CryptoKey` は**署名には使えますが、エクスポートはできません**。そのため、XSS が起きても秘密鍵のバイト列そのものは持ち出せません。
- `CryptoKeyPair` は **IndexedDB** に保存します（`CryptoKey` オブジェクトは構造化複製が可能なので、非抽出のまま永続化できます）。**`localStorage` には保存しません**。`localStorage` は文字列しか保存できないので、保存するには鍵をエクスポートする、つまり抽出可能にする必要があり、XSS で読み出せてしまいます。

**限界も理解しておく。** 非抽出鍵は「鍵の持ち出し」を防ぎますが、XSS が有効な間は、攻撃者がページ内で `crypto.subtle.sign` を呼んで**その場で** proof を作り、正規のトークンで API を叩くことは防げません。前節の nonce は、「後で使う proof の事前生成」を難しくして、被害を**XSS が生きている間**に限定するためのものです。DPoP は XSS 対策そのものではなく、**トークン流出の被害を小さくする多層防御**の1つだと位置づけてください。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 7. リフレッシュトークンの束縛

WorkOS は「**リフレッシュトークンも DPoP 束縛される**」点を落とし穴として挙げています。RFC 9449 では次のように整理されています。

- **パブリッククライアント**（SPA やネイティブアプリなど、クライアントシークレットを安全に持てないクライアント）: リフレッシュトークンは DPoP 鍵に束縛されます。リフレッシュ時にも同じ鍵で署名した proof が必要なので、**リフレッシュトークンだけが盗まれても使えません**。パブリッククライアントでは、リフレッシュトークンの盗難がもっとも深刻な被害（長期間のなりすまし）につながるため、ここが DPoP のもっとも大きな価値の1つです。
- **コンフィデンシャルクライアント**: リフレッシュトークンはもともとクライアント認証に結びついているので、DPoP 鍵には束縛されません（鍵のローテーションが可能）。

実装上の帰結として、パブリッククライアントで**鍵ペアを失う**（IndexedDB がクリアされる、再生成してしまう）と、リフレッシュトークンも使えなくなり、再ログインが必要になります。鍵は「アクセストークンの寿命」ではなく「**リフレッシュトークンの寿命**」の間、保持し続ける設計にする必要があります。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 8. DPoP と mTLS（RFC 8705）の比較

| 観点 | mTLS（RFC 8705） | DPoP（RFC 9449） |
|---|---|---|
| 層 | トランスポート（TLS） | アプリケーション（HTTP ヘッダ内の JWT） |
| 束縛対象 | X.509 クライアント証明書 | クライアント生成の公開鍵（JWK） |
| 運用コスト | PKI、証明書のライフサイクル管理、TLS 終端の制御が必要 | PKI 不要、証明書管理不要、TLS 再設定不要 |
| ブラウザ / モバイル | ブラウザや多くのモバイル SDK では実質使えない | どのプラットフォームでも動く |
| 実装負担 | TLS インフラ側 | JWT 処理と `jti` によるリプレイ管理 |

WorkOS は mTLS を「堅牢（robust）」と評価しつつも、PKI の運用と TLS 終端の制御が必要で、ブラウザでは使えないと指摘しています。DPoP は「PKI も証明書ライフサイクルも TLS の再設定も不要」ですが、JWT の処理とリプレイ追跡をアプリケーション側で実装する必要があります。

**なぜ「アプリケーション層」なのか。** かつては TLS 層でトークンを束縛する **Token Binding** が検討されましたが、主要ブラウザでのサポートが進まず失敗しました。TLS 終端がロードバランサや CDN にあると、証明書の情報がアプリケーションまで届かないという実務上の問題もあります。DPoP は HTTP ヘッダに証明を載せるので、TLS 終端の位置に左右されず、ブラウザの JavaScript からも使えます。これが「Token Binding が残した穴を埋める」と言われる理由です。

**FAPI 2.0**（金融グレード API のセキュリティプロファイル）は、送信者制約の方式として **mTLS と DPoP のどちらも認めて**います。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 9. 採用状況（2025年ごろの WorkOS 記事時点）

- **Bluesky / AT Protocol（atproto）の OAuth**: すべての要求で DPoP を**必須**とし、サーバ発行 nonce、PAR（Pushed Authorization Requests）、PKCE も必須にしています。
- **FAPI 2.0**: 金融グレード API 向けに、mTLS と DPoP を同等に認めています。
- **OAuth 2.1 と MCP（Model Context Protocol）**: AI エージェントを含むパブリッククライアントに対して、送信者制約トークンを推奨する方向です。

※ OAuth 2.1 は執筆時点ではまだ IETF ドラフトです。MCP の認可仕様も改訂が続いています。「必須」なのか「推奨」なのかは、参照する版で必ず確認してください。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 10. 補足: Step-up 認証（RFC 9470）との組み合わせ

Auth0 の記事は、DPoP と並ぶ強化策として **OAuth 2.0 Step-Up Authentication Challenge Protocol（RFC 9470）** も紹介しています。DPoP が「**誰が**トークンを使っているか」を強くするのに対し、Step-up は「**どれだけ強く**ユーザーが認証されたか」を API 側で要求する仕組みです。

流れは次のとおりです。

1. クライアントが、重要な操作をする API（例: 送金）をアクセストークン付きで呼ぶ。
2. API はトークンから認証情報を取り出す。
3. 要件を満たしていなければ、必要な認証条件をエラーで返す。
4. クライアントは、その条件を満たす新しいアクセストークンを取得しにいく。

要件には次の2種類があります。

- **ACR（Authentication Context Class Reference、認証の強度クラス）**: 多要素認証などの必要な認証方式。JWT アクセストークンでは `acr` クレームで表されます。
- **最大認証経過時間（max age）**: 最後にユーザーが能動的に認証してからの経過時間。JWT では `auth_time` クレームを使います。

RFC 9470 では、エラーは次のような形になります（Auth0 記事ではなく RFC 本文にもとづく例）。

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="insufficient_user_authentication",
  error_description="A different authentication level is required",
  acr_values="myACR"
```

クライアントは、`acr_values` や `max_age` を付けて認可リクエストをやり直します。DPoP を使っている場合は、スキームが `DPoP` になるだけで考え方は同じです。高リスク操作では「**DPoP で盗難トークンを無力化し、Step-up で認証強度を担保する**」という組み合わせが有効です。

> 出典: Auth0「OAuth 2.0 Security Enhancements」（2023-12-22） — https://auth0.com/blog/oauth2-security-enhancements/

---

### 11. 図解で理解する DPoP（Takahiko Kawasaki）

> ⚠️ **未取得の資料**: 「Illustrated DPoP (OAuth Access Token Security Enhancement)」（Takahiko Kawasaki, Medium）は自動取得できませんでした（理由: Medium が HTTP 403 Forbidden を返したため。Web 検索でも概要しか得られませんでした）。以下のURLからご自身で直接ご覧ください: https://darutk.medium.com/illustrated-dpop-oauth-access-token-security-enhancement-801680d761ff

（以下は未取得資料の補足として一般知識に基づく解説です）

検索結果から確認できた範囲では、この記事は **2020年4月**、つまり RFC 9449 として成立する（2023年9月）前の**ドラフト段階**に書かれた図解記事です。要点は次のとおりです。

- 従来の OAuth では、API は「アクセストークンが有効か」だけを確認する。DPoP では、それに加えて「**トークンを提示したクライアントが、そのトークンの正当な所有者か**」も確認する。
- クライアントは公開鍵をサーバに提示する。認可サーバはその公開鍵をアクセストークンに関連づけ、リソースサーバはトークンがその公開鍵に束縛されていることを検証する。
- クライアントは秘密鍵で署名した DPoP proof JWT を作り、両方のサーバに提示する。

**陳腐化への注意。** 2020年のドラフトと最終版の RFC 9449 には、次のような違いがあります。古い図解を読むときは、以下を最新仕様で補ってください。

- **`ath` クレーム**（アクセストークンのハッシュ）: 初期ドラフトにはなく、後から追加された。
- **サーバ発行 `nonce` と `DPoP-Nonce` ヘッダ**: これも後から追加された。同じ著者の続編「DPoP Nonce」（https://darutk.medium.com/dpop-nonce-9787b9d276d1 ）が、この仕組みを扱っている。
- **認可コードの束縛 `dpop_jkt`**: 最終版では、認可リクエストに `dpop_jkt` パラメータ（使う予定の鍵のサムプリント）を入れることで、**認可コード自体を鍵に束縛できる**。これにより、認可コードが横取りされても別の鍵ではトークンに交換できない。PAR と組み合わせる場合は、PAR のリクエストに `DPoP` ヘッダを付ける方法もある。
- `token_type: "DPoP"`、`Authorization: DPoP` スキーム、`cnf.jkt`、メタデータ `dpop_signing_alg_values_supported` などの名前は、最終版の RFC 9449 に従う。

JWK サムプリント（`jkt`）の計算方法（RFC 7638）も確認しておきます。EC 鍵の場合は、**必須メンバだけ**（`crv`、`kty`、`x`、`y`）を**辞書順**に並べ、**空白なし**の JSON にして SHA-256 を取り、base64url エンコードします。

```text
input  = {"crv":"P-256","kty":"EC","x":"<x>","y":"<y>"}
jkt    = BASE64URL( SHA-256( UTF8(input) ) )
```

メンバを限定し、並び順を固定するのは、`kid` や `use` のような任意メンバの有無、キーの順序、空白の違いによって同じ鍵の指紋が変わらないようにするためです。検証側は必ずこの正規化手順で計算し直して比較します。

> 出典: Takahiko Kawasaki「Illustrated DPoP (OAuth Access Token Security Enhancement)」（Medium, 2020） — https://darutk.medium.com/illustrated-dpop-oauth-access-token-security-enhancement-801680d761ff

---

### 12. 実装チェックリストと防御側の観点

WorkOS が挙げる「よくある実装ミス」に、RFC 9449 の要件を加えて、防御側（設計・レビュー・診断）のチェックリストとして整理します。

| # | 確認項目 | 不備があるとどうなるか |
|---|---|---|
| 1 | `typ` が `dpop+jwt` であることを検証している | 別用途の JWT を proof として受け入れてしまう |
| 2 | `HS256`・`none` などを拒否し、許可リストで `alg` を制限している | 署名検証の迂回や、アルゴリズム混同 |
| 3 | `jwk` に秘密鍵成分がないことを確認している | 仕様違反、鍵の漏えい |
| 4 | `jti` をサーバ側で一定期間記録し、一意性を検証している | 同じ proof のリプレイ |
| 5 | `iat` に許容窓（例: 約60秒）と時計ずれへの配慮がある | 窓が広すぎると古い proof が使える。狭すぎると正規要求が失敗する |
| 6 | `htm`/`htu` を外部から見た実 URL（クエリとフラグメントを除く）と比較している | proof を別エンドポイントへ転用される |
| 7 | RS で `ath` を検証している | proof とトークンの組み合わせを差し替えられる |
| 8 | RS で proof の JWK サムプリントと `cnf.jkt` を比較している | 攻撃者の鍵で作った proof が通る（DPoP の意味がなくなる） |
| 9 | `cnf` 付きトークンの `Bearer` スキームでの提示を拒否している | proof なしで使えるダウングレード |
| 10 | パブリッククライアントのリフレッシュトークンを束縛している | 盗まれたリフレッシュトークンで長期間なりすまされる |
| 11 | ブラウザでは非抽出鍵を IndexedDB に保存している | XSS で秘密鍵を持ち出される |
| 12 | 必要に応じてサーバ発行 nonce を使っている（AS と RS で別管理） | proof を事前に作られて持ち出される |
| 13 | **proof JWT をログや監視基盤に記録しない** | ログから proof やトークンを収集される |

診断やレビューでは、上の各項目について、**自分が管理する検証環境、または許可を得た対象の範囲内で**「検証を省略・緩和した場合に拒否されるか」を確かめるのが基本です（例: `ath` を外す、`htu` を別パスにする、`cnf` 付きトークンを `Bearer` で送る）。実在のサービスで許可なくこうした試行をしてはいけません。

**まとめ。** DPoP は、Bearer トークンの「持っていれば使える」という性質を、「**トークン＋秘密鍵の所持証明**」に変える仕組みです。その強さは次の3点で決まります。

1. サーバ側で**すべての検証項目を省略せずに**実装していること
2. クライアント側で**秘密鍵が持ち出せない**こと
3. **nonce とリフレッシュトークンの束縛**で、事前生成と長期悪用を抑えていること

mTLS が使えないブラウザやモバイル、AI エージェントといったパブリッククライアントにとって、DPoP は現在もっとも現実的な送信者制約の手段であり、FAPI 2.0 や OAuth 2.1 / MCP の流れの中で中心的な位置を占めつつあります。
