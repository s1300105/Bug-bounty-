## FAPI 1.0/2.0 — 金融グレードの API セキュリティ（PAR・mTLS・JARM）

この節では、OAuth 2.0 / OpenID Connect（OIDC）を「銀行の口座情報や送金指示を扱っても大丈夫な強さ」まで締め上げたセキュリティプロファイル **FAPI（Financial-grade API）** を扱います。FAPI は新しいプロトコルではありません。OAuth/OIDC の**選択肢を絞り、危険なオプションを禁止し、拡張仕様（PKCE・PAR・JAR・JARM・mTLS・DPoP など）の採用を義務づけた「使い方の規格」**です。

これまでの章で見てきた OAuth の典型的な脆弱性（認可コードの横取り、`redirect_uri` の検証漏れ、`state` 欠落による CSRF、アクセストークン漏えい、IdP Mix-Up など）が、FAPI ではそれぞれどの仕組みで塞がれているのかを対応づけて読むと、理解が一気に深まります。

> 用語メモ
> - **プロファイル**: 既存仕様の中から「必ずこれを使う／これは使わない」を決めた適用ルール集。
> - **AS（Authorization Server, 認可サーバー）** / **RS（Resource Server, API サーバー）** / **クライアント**（API を呼ぶアプリ）。
> - **送信者制約トークン（sender-constrained token）**: トークンを「持っているだけ」では使えず、発行時に紐づけた鍵を持つ者だけが使えるようにしたトークン。対義語は **Bearer トークン**（持参人払い＝拾った人でも使える）。

---

### 1. FAPI とは何か — 位置づけとバージョン

#### 1.1 誰が作っているか

FAPI は OpenID Foundation の **FAPI Working Group**（旧称 Financial-grade API Working Group）が策定しています。Curity はこれを「データを保護する際に最も強いセキュリティ設計パターンを用いること」と表現しています。当初は金融（オープンバンキング）向けでしたが、現在は医療・行政・保険など「高価値データを扱う API 全般」に対象が広がっており、名称の "Financial-grade" も「金融専用」ではなく「金融レベルの強度」という意味で理解するのが適切です。

#### 1.2 FAPI 1.0 の 2 つのプロファイル

| プロファイル | 想定用途 | 要点 |
|---|---|---|
| **Baseline（Part 1）** | 読み取り（口座残高・明細の参照など） | PKCE、`state`/`nonce`、厳格な `redirect_uri` 照合など、OAuth の基本的な穴埋め |
| **Advanced（Part 2）** | 読み書き（送金指示など） | JAR（署名付きリクエスト）必須、Hybrid Flow（`code id_token`）または JARM による応答の完全性保護、mTLS による送信者制約トークン、`private_key_jwt`/mTLS によるクライアント認証 |

FAPI 1.0 は 2021 年に最終化され、**UK Open Banking、オーストラリアの Consumer Data Right（CDR）、ブラジル Open Banking** など多くの規制エコシステムが「FAPI 1.0 Advanced」を採用しました（Auth0・Zuplo 記事）。

#### 1.3 FAPI 2.0 の構成

FAPI 2.0 は FAPI 1.0 の「足し算」ではなく**作り直し**です。Auth0 の記事は FAPI 2.0 の仕様群を 3 つに分けて説明しています。

1. **Attacker Model（攻撃者モデル）** — どんな攻撃者を想定し、何を守るのかを明文化した文書
2. **Security Profile（セキュリティプロファイル）** — 攻撃者モデルに対するセキュリティ目標を達成するための必須要件（ベースライン）
3. **Message Signing（メッセージ署名プロファイル）** — Security Profile に**否認防止（non-repudiation）**を追加する上位プロファイル

Auth0 記事（2025年8月6日公開）の時点で、Security Profile と Attacker Model は**最終仕様（Final）**として公開済みです。Message Signing の成熟度（Final かどうか）は時期により異なるため、採用時は OpenID Foundation の仕様一覧で最新ステータスを確認してください。

FAPI 1.0 の「Baseline / Advanced」という二段構えに対応させると、FAPI 2.0 では「Security Profile ≒ 攻撃者モデル上の脅威への防御（ベースライン）」「Message Signing ≒ 署名による否認防止を足した上位（アドバンスト）」という関係になります。

> 出典: Curity「What is Financial-Grade Security?」 — https://curity.io/resources/learn/what-is-financial-grade/
> 出典: Auth0「FAPI 2.0: The Future of API Security for High-Stakes Customer Interactions」 — https://auth0.com/blog/fapi-2-0-the-future-of-api-security-for-high-stakes-customer-interactions/

---

### 2. 攻撃者モデルとセキュリティ目標 — 「何から守るか」を先に決める

FAPI 2.0 の最大の思想的変化は、**攻撃者モデルを先に定義し、要件をそこから導く**ことです。FAPI 1.0 までは「過去に見つかった攻撃への対策を積み上げる」性格が強く、要件同士の関係や「なぜこれで十分なのか」が見えにくいという問題がありました。

Curity は攻撃者モデルが定める 4 つのセキュリティ目標を次のように整理しています。

| セキュリティ目標 | 防ぎたいこと |
|---|---|
| **Authorization（認可）** | 盗まれたアクセストークンの利用、権限のないリソースへのアクセス |
| **Authentication（認証）** | 身元の盗用、なりすまし |
| **Session Integrity（セッション完全性）** | CSRF、セッションハイジャック（被害者のブラウザに攻撃者の認可結果を注入する等） |
| **Non-repudiation（否認防止）** | リプレイ攻撃、メッセージ改ざん、「そんな指示は送っていない」という否認 |

攻撃者モデルには、ネットワーク上の攻撃者、攻撃者が用意した悪性の AS（Mix-Up 攻撃の加害側）、ログやブラウザ履歴・Referer から認可リクエスト/レスポンスを読める攻撃者、盗んだアクセストークンを使おうとする攻撃者などが含まれます（詳細は仕様本文）。

Zuplo の記事が強調するとおり、FAPI 2.0 は **University of Stuttgart の研究者による形式検証（formal verification）** で、この攻撃者モデルに対して目標を満たすことが証明されています。形式検証とは、プロトコルを数学的モデルに落とし込み、「想定した攻撃者がどう振る舞っても目標が破られない」ことを機械的・論理的に示す手法です。FAPI 1.0 も同研究グループの分析を受けており、その過程で見つかった問題点が FAPI 2.0 の設計に反映されています。

> 出典: Curity「What is Financial-Grade Security?」 — https://curity.io/resources/learn/what-is-financial-grade/
> 出典: Zuplo「FAPI 2.0 Explained」 — https://zuplo.com/learning-center/fapi-2-financial-grade-api-security-patterns

---

### 3. FAPI が義務づける構成要素 — 何を、なぜ

Curity の記事は、FAPI が要求する標準を「所持証明と紐づけ」「リクエスト/レスポンスの完全性」「クライアント認証」の 3 群に整理しています。ここではそれぞれを「どの攻撃を、どういう仕組みで止めるのか」まで掘り下げます。

#### 3.1 PKCE（RFC 7636）— 認可コードをクライアントに縛る

PKCE（Proof Key for Code Exchange）は、クライアントがランダムな `code_verifier` を作り、そのハッシュ `code_challenge` を認可リクエストに入れ、トークン交換時に元の `code_verifier` を提示する仕組みです。

```http
# 認可リクエスト（PAR 経由で送る内容の一部）
code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
&code_challenge_method=S256

# トークンリクエスト
grant_type=authorization_code
&code=...
&code_verifier=dBjftJeZ4CVP-mJ92K9DUdG9...（元の乱数）
```

**なぜ効くか**: 認可コードがリダイレクト経由で漏れても（ログ、Referer、悪性アプリによるカスタムスキーム横取りなど）、攻撃者は `code_verifier` を知らないためトークンに交換できません。さらに、攻撃者が**自分の認可コードを被害者のセッションに注入する「認可コード注入」**も、被害者側クライアントが持つ `code_verifier` と一致しないため失敗します。FAPI 2.0 では `S256`（SHA-256）方式のみが許され、`plain` は禁止です（`plain` だとチャレンジ自体が秘密値になり、漏れた時点で無意味になるため）。

#### 3.2 PAR（RFC 9126）— 認可リクエストをブラウザから追い出す

**PAR（Pushed Authorization Requests）** は、FAPI 1.0 Advanced では任意でしたが、**FAPI 2.0 Security Profile では必須**です（Auth0）。

通常の OAuth では、`client_id`・`redirect_uri`・`scope`・`code_challenge` などを**ブラウザの URL クエリ**に載せて AS に送ります。つまり、パラメータは

- ユーザー（あるいはブラウザ上のマルウェア・拡張機能）に改ざんされうる
- ブラウザ履歴、プロキシログ、`Referer` ヘッダに残りうる
- 長くなると URL 長制限に引っかかる

という問題を抱えています（Zuplo はこれを「パラメータ改ざん・ブラウザ履歴への記録・Referer 経由の漏えい」の解決として説明しています）。

PAR ではクライアントが**先にバックチャネル（サーバー間通信）で**パラメータを AS に POST し、受け取った参照値 `request_uri` だけをブラウザに渡します。

```http
POST /as/par HTTP/1.1
Host: as.example.com
Content-Type: application/x-www-form-urlencoded

client_id=s6BhdRkqt3
&response_type=code
&redirect_uri=https%3A%2F%2Fclient.example.org%2Fcb
&scope=accounts%3Aread
&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
&code_challenge_method=S256
&client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer
&client_assertion=eyJhbGciOiJQUzI1NiIs...
```

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "request_uri": "urn:ietf:params:oauth:request_uri:6esc_11ACC5bwc014ltc14eY22c",
  "expires_in": 60
}
```

```http
# ブラウザのリダイレクト先（パラメータは参照だけ）
GET /authorize?client_id=s6BhdRkqt3
  &request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3A6esc_11ACC5bwc014ltc14eY22c
```

**なぜ効くか（仕組み）**:

1. **クライアント認証済みの経路で受け付ける**: PAR エンドポイントはトークンエンドポイント同様にクライアント認証（`private_key_jwt` や mTLS）を要求します。つまり AS は「このパラメータは確かに正規クライアント本人が送った」ことを、**ユーザーがブラウザで何かする前に**確認できます。これにより、JAR で署名しなくても実質的な完全性・真正性が得られます。FAPI 2.0 で JAR が必須から外れた（Message Signing 側へ移った）のはこのためです。
2. **ブラウザに機微パラメータが流れない**: `request_uri` は不透明な参照値にすぎず、短い有効期限（FAPI 2.0 では 600 秒未満）で失効し、原則一回限りの利用です。
3. **`redirect_uri` の事前確定**: 攻撃者が URL 上の `redirect_uri` を書き換えて認可コードを自分のサーバーへ流す古典的攻撃が、構造的に成立しにくくなります。

#### 3.3 JAR（RFC 9101）と JARM — リクエストと応答に「署名」を付ける

- **JAR（JWT-Secured Authorization Request）**: 認可リクエストのパラメータを**クライアントが署名した JWT**（Request Object）にまとめて送る仕様。Auth0 は「メッセージレベル署名により、否認防止つきで認可リクエストパラメータの完全性を守る」と説明しています。FAPI 1.0 Advanced では必須、**FAPI 2.0 Security Profile では不要となり Message Signing へ移動**しました。
- **JARM（JWT Secured Authorization Response Mode）**: 認可**レスポンス**（`code` や `state`）を、平文クエリではなく**AS が署名（必要に応じて暗号化）した JWT**として返す仕様。FAPI 2.0 の基本 Security Profile では必須ではなく、**Message Signing プロファイルで必須**です（Zuplo）。

JARM レスポンスはおおむね次のような形になります（`response_mode=jwt` 等を指定）。

```http
HTTP/1.1 302 Found
Location: https://client.example.org/cb?response=eyJraWQiOiJsYWViIiwiYWxnIjoiRVMyNTYifQ...
```

```json
// response JWT のペイロード（デコード後）
{
  "iss": "https://as.example.com",
  "aud": "s6BhdRkqt3",
  "exp": 1311281970,
  "code": "PyyFaux2o7Q0YfXBU32jhw.5FXSQpvr8akv9CeRDSd0QA",
  "state": "S8NJ7uqk5fY4EjNvP_G_FtyJu6pUsvH9jsYni9dMAJw"
}
```

Zuplo はクレームの役割を次のように整理しています。

| クレーム | 防ぐ攻撃 | 仕組み |
|---|---|---|
| `iss` | **Mix-Up 攻撃** | クライアントは「どの AS から来た応答か」を署名つきで確認できるため、悪性 AS が正規 AS のコードを混入させても検知できる |
| `aud` | 別クライアントへのリプレイ | 宛先クライアントが固定されるため、他クライアント向け応答の流用を拒否できる |
| `exp` | リプレイの時間窓 | 応答の有効期限を短く限定 |

**なぜ署名が必要か**: 平文クエリの `code` と `state` は、経路上やブラウザ内で差し替えられても受け手には区別がつきません。署名があれば「AS が、このクライアント宛てに、この時刻に発行した」ことが暗号学的に検証でき、後日の紛争で証拠（否認防止）としても使えます。

> 補足（FAPI 1.0 Advanced の Hybrid Flow）: FAPI 1.0 Advanced では JARM の代わりに `response_type=code id_token` を使い、フロントチャネルで返る ID トークンを「**分離署名（detached signature）**」として使う方式も認められていました。ID トークン内の `c_hash`（コードのハッシュ）と `s_hash`（state のハッシュ）で、同じ応答内の `code` と `state` が改ざんされていないことを検証します。FAPI 2.0 ではこの Hybrid Flow は採用されず、`response_type=code` に一本化されています。

**Mix-Up 対策の補足（RFC 9207）**: Curity が挙げる **RFC 9207（Authorization Server Issuer Identification）** は、JARM を使わない場合でも認可レスポンスに `iss` パラメータを付与させる仕様です。FAPI 2.0 Security Profile ではこれにより、署名なしでも Mix-Up 攻撃を防げるよう設計されています。

```http
HTTP/1.1 302 Found
Location: https://client.example.org/cb?code=x1848ZT64p4IirMPT0R-X3141MFPTuBX-VFL_cvaplMH58&state=ZWVlNDBlYzA1NjdkMDNhYjg3ZjUxZjAyNGQzMTM2NzI&iss=https%3A%2F%2Fas.example.com
```

クライアントは「リクエストを送った AS の issuer」と応答の `iss` を厳密一致で比較し、不一致なら破棄します。

#### 3.4 クライアント認証 — 共有シークレットを捨てる

FAPI（1.0/2.0 共通）で認められるクライアント認証は次の 2 つだけです（Auth0・Zuplo）。`client_secret_basic` / `client_secret_post` のような**共有シークレット方式は使えません**。

1. **`private_key_jwt`**: クライアントが秘密鍵で署名した JWT（client assertion）をトークン/PAR エンドポイントに提示する。

```json
// client_assertion のペイロード例
{
  "iss": "s6BhdRkqt3",
  "sub": "s6BhdRkqt3",
  "aud": "https://as.example.com",
  "jti": "a3f9c2e1-...",
  "iat": 1735689600,
  "exp": 1735689660
}
```

   **なぜ強いか**: AS 側には公開鍵しか置かないため、AS のデータベースが漏れてもクライアントになりすませません。`jti`（一意 ID）と短い `exp` によりアサーション自体のリプレイも防ぎます。`aud` を AS の issuer に限定するのは、別の AS に同じアサーションを流用されるのを防ぐためです。

2. **mTLS（RFC 8705 の Mutual-TLS Client Authentication）**: TLS ハンドシェイクでクライアント証明書を提示させ、AS は事前登録した証明書（または信頼する CA＋サブジェクト DN 等）と照合する。

#### 3.5 送信者制約トークン — mTLS と DPoP

Zuplo の言葉を借りれば FAPI 2.0 では「**Bearer トークンはもはや受け入れられない。すべてのアクセストークンは、それを要求したクライアントに紐づけなければならない**」。その手段が mTLS か DPoP です。

##### (a) 証明書バインド（mTLS, RFC 8705）

AS はトークン発行時、TLS 接続で使われたクライアント証明書の SHA-256 サムプリントをトークンの `cnf`（confirmation）クレームに埋め込みます。Curity の例:

```json
{
    "cnf": {
        "x5t#S256": "FjeHcvJwiHXlr8dgnP7UvLQ7dLLMTe_3SgMYMuEpekc"
    }
}
```

RS（またはゲートウェイ）は、API 呼び出し時の **mTLS 接続で提示された証明書のサムプリント**を計算し、`cnf.x5t#S256` と一致するか確認します。**なぜ効くか**: トークンが漏れても、攻撃者は対応する秘密鍵を持たないため、その証明書で TLS ハンドシェイクを完了できません。所持証明を TLS 層がやってくれるので、アプリ層の追加実装が少なく済む一方、PKI 運用（証明書発行・失効・ローテーション）や、TLS 終端をどこで行うか（ロードバランサで終端すると RS まで証明書情報を安全に中継する必要がある）という運用課題があります。

##### (b) DPoP バインド（RFC 9449）

DPoP（Demonstrating Proof of Possession）はアプリ層で所持証明を行う方式です。Zuplo の説明する流れ:

1. クライアントが公開鍵/秘密鍵ペアを生成する
2. トークンリクエストに公開鍵を含める（DPoP 証明 JWT のヘッダ `jwk` として）
3. AS は公開鍵の **JWK サムプリント**を `cnf.jkt` としてトークンに埋め込む
4. クライアントは **API 呼び出しのたびに**、秘密鍵で署名した短命の DPoP 証明 JWT を作って送る
5. RS/ゲートウェイは証明の署名と、鍵がトークンの `jkt` と一致することを検証する

Curity の例:

```json
{
    "cnf": {
        "jkt": "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I"
    }
}
```

API 呼び出しは次のようになります。

```http
GET /accounts HTTP/1.1
Host: api.bank.example
Authorization: DPoP eyJhbGciOiJFUzI1NiIsImtpZCI6...
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7...
```

```json
// DPoP 証明 JWT（ヘッダ / ペイロード）
{ "typ": "dpop+jwt", "alg": "ES256", "jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." } }
{ "jti": "e1j3V_bKic8-LAEB", "htm": "GET", "htu": "https://api.bank.example/accounts",
  "iat": 1735689600, "ath": "fUHyO2r2Z3DZ53EsNrWBb0xWXoaNy59IiKCAqksmQEo" }
```

**なぜ効くか（各クレームの役割）**:

- `htm`（HTTP メソッド）と `htu`（URL）: 証明を**特定のリクエストに縛る**。盗んだ証明を別エンドポイントや別メソッドに流用できない。
- `iat` と `jti`: 短命＋一意 ID により、同じ証明の再送（リプレイ）を検知できる。
- `ath`: アクセストークンのハッシュ。証明を**特定のトークンに縛る**。
- 署名＋`jwk`: 秘密鍵を持つ者しか有効な証明を作れない。

Curity が指摘するとおり、DPoP を使うとアクセストークンは Bearer ではなく **DPoP トークン**になり（`Authorization: DPoP ...`）、DPoP JWT は短命で API 呼び出しごとに生成されます。Auth0 は、DPoP が mTLS より「**汎用的で取り組みやすい**送信者制約の選択肢」であり、FAPI 2.0 でリプレイ耐性を高める目的で採用されたと説明しています。mTLS と違い PKI や TLS 終端の問題に縛られないため、ブラウザや SPA、ゲートウェイ越しの構成でも導入しやすいのが利点です。

Zuplo はゲートウェイでの DPoP 検証の骨格を TypeScript で示しています（コメント部分が検証すべき項目の要約になっています）。

```typescript
import { ZuploContext, ZuploRequest } from "@zuplo/runtime";

export default async function validateDpopProof(
  request: ZuploRequest,
  context: ZuploContext,
) {
  const dpopHeader = request.headers.get("DPoP");
  if (!dpopHeader) {
    return new Response(JSON.stringify({ error: "missing_dpop_proof" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Verify: JWT signature, 'htm' claim matches HTTP method
  // Verify: 'htu' claim matches request URL
  // Confirm: key thumbprint matches token's 'jkt' claim
  return request;
}
```

これは雛形であり、実運用ではコメントの各項目に加えて **`typ` が `dpop+jwt` であること、`alg` が許可リスト内（`none` や HS 系を拒否）であること、`iat` の許容時間窓、`jti` の再利用検知（キャッシュ）、`ath` とアクセストークンの一致**まで検証しなければ防御になりません。特に「`DPoP` ヘッダの有無しか見ていない」「`jkt` 照合を省略している」実装は、送信者制約を名乗りながら実質 Bearer トークンと同じ強度になってしまう典型的な欠陥です。

> 出典: Curity「What is Financial-Grade Security?」 — https://curity.io/resources/learn/what-is-financial-grade/
> 出典: Zuplo「FAPI 2.0 Explained」 — https://zuplo.com/learning-center/fapi-2-financial-grade-api-security-patterns
> 出典: Auth0「FAPI 2.0: The Future of API Security for High-Stakes Customer Interactions」 — https://auth0.com/blog/fapi-2-0-the-future-of-api-security-for-high-stakes-customer-interactions/

#### 3.6 RAR と JWE（Auth0 の比較から）

- **RAR（Rich Authorization Requests, RFC 9396）**: `scope` という単なる文字列ではなく、`authorization_details` という構造化 JSON で「どの口座から、いくら、誰に送金するか」を表現する仕様。Auth0 は「認証・認可フローの中でユーザーにリッチな文脈を提示できる」と説明し、FAPI 2.0 Security Profile では**任意だが推奨**としています。ユーザーが「何に同意しているか」を正確に理解できることは、同意画面を悪用したソーシャルエンジニアリングへの対策にもなります。

```json
"authorization_details": [{
  "type": "payment_initiation",
  "instructedAmount": { "currency": "EUR", "amount": "123.50" },
  "creditorName": "Merchant A",
  "creditorAccount": { "iban": "DE02100100109307118603" }
}]
```

- **JWE（JSON Web Encryption）**: フロントチャネルのトークン（ID トークン等）に含まれる機微情報の暗号化。FAPI 1.0 Advanced では任意、FAPI 2.0 Security Profile では**不要**（PAR によってフロントチャネルに流れる情報自体が減ったため）。

---

### 4. FAPI 1.0 Advanced と FAPI 2.0 の比較

Auth0・Zuplo・Curity の記述をまとめると次のようになります。

| 項目 | FAPI 1.0 Advanced | FAPI 2.0 Security Profile | FAPI 2.0 Message Signing |
|---|---|---|---|
| 設計方針 | 既知攻撃への対策の積み上げ、選択肢が多い | 攻撃者モデルから導出・形式検証済み、選択肢を削減 | Security Profile＋否認防止 |
| レスポンスタイプ | `code id_token`（Hybrid）または `code`＋JARM | `code` のみ | `code`（＋JARM） |
| PKCE | （Baseline で必須、Advanced は実質併用） | 必須（S256） | 必須 |
| PAR | 任意 | **必須** | 必須 |
| JAR（署名付きリクエスト） | **必須** | 不要 | **必須** |
| JARM（署名付き応答） | Hybrid の代替として利用 | 不要（`iss` パラメータ/RFC 9207 で Mix-Up 対策） | **必須** |
| 送信者制約 | mTLS | **mTLS または DPoP** | 同左 |
| クライアント認証 | `private_key_jwt` または mTLS | 同左 | 同左 |
| パブリッククライアント | 規定あり（Baseline） | **対象外（機密クライアントのみ）** | 同左 |
| RAR | — | 任意・推奨 | 同左 |
| JWE | 任意 | 不要 | — |

読み解きのポイント:

- **「足した」より「減らした」が多い**: Zuplo が言うように、FAPI 1.0 では任意機能が多く、組み合わせごとに相互運用性・安全性の検証が必要でした。FAPI 2.0 は「任意を必須に、あるいは廃止に」して選択肢を減らし、Auth0 の言う**クライアント・AS・RS 間の相互運用性**を高めています。多数の銀行と多数のフィンテックが相互接続するオープンバンキングでは、選択肢の少なさ自体がセキュリティになります。
- **PAR が JAR の役割の多くを吸収**: クライアント認証つきのバックチャネルでパラメータを送れば、署名がなくても改ざん・偽装は防げます。署名が本当に必要なのは「第三者に対して後から証明したい」＝否認防止の場面だけなので、JAR/JARM は Message Signing に分離されました。
- **パブリッククライアントの扱い**: Curity によれば FAPI 2.0 はパブリッククライアント（秘密を保持できないアプリ）の要件を**スコープから外しました**。FAPI 1.0 の時代、モバイルアプリについては「PKCE を必須にしたうえで、Dynamic Client Registration によりアプリのインスタンスごとに機密クライアントを作り、各インスタンスが鍵ペアを生成して `private_key_jwt` で認証する」パターンが示されていました。

#### 4.1 FAPI 2.0 Security Profile の代表的な細則（仕様本文に基づく補足）

（以下は取得資料を補う一般知識に基づく解説です。数値は FAPI 2.0 Security Profile Final 版に基づきますが、採用時は必ず仕様原文を確認してください。）

- 認可コードの有効期間は **60 秒以内**（漏えい時の悪用窓を最小化）
- PAR の `request_uri` の有効期限（`expires_in`）は **600 秒未満**
- `redirect_uri` は**完全一致**で比較（部分一致・ワイルドカードは禁止。オープンリダイレクタ経由のコード窃取を防ぐ）
- 署名アルゴリズムは **PS256・ES256・EdDSA（Ed25519）** に限定（RS256 の PKCS#1 v1.5 や `none` は不可）
- TLS 1.2 以上、TLS 1.2 の場合は仕様指定の安全な暗号スイートのみ
- インプリシットフローや Resource Owner Password Credentials は使用不可
- AS は認可レスポンスで `iss` を返す（RFC 9207）

---

### 5. 認証とユーザー保護 — トークン以外の要素

Curity の記事は、プロトコル要件と並んで次の運用要素を FAPI の実装上の柱として挙げています。

#### 5.1 強力な顧客認証（SCA）

**多要素認証（MFA）は必須**で、次の 3 種類のうち 2 種類を組み合わせます。

- 知識要素（パスワードなど）
- 所持要素（スマートフォン、キーフォブなど）
- 生体要素（指紋・顔など）

EU の PSD2 が定める SCA（Strong Customer Authentication）と同じ考え方です。どれだけトークンを堅牢にしても、入口の本人確認が弱ければ正規の手順で攻撃者にトークンが発行されてしまうためです。

#### 5.2 ペアワイズ仮名識別子（PPID）

アプリに実際の個人データではなく、**アプリごとに異なる生成済みユーザー識別子**（Pairwise Pseudonymous Identifier）を渡します。氏名・メールアドレスなどの機微値は AS 側に保持し、必要な場合だけトークンで返します。**なぜ有効か**: 複数のアプリが同じユーザー ID を共有していると、アプリ同士の情報を突き合わせた名寄せ（トラッキング）が可能になるため、ID をアプリごとに分けることでプライバシーを守ります。

#### 5.3 コンテキストに応じた認証ポリシー

ユーザーの地理的位置、ログイン試行の頻度、現在進行中の脅威などを評価して、追加認証を要求したりブロックしたりします。

#### 5.4 クライアントアテステーション

認証を始める前に、そのクライアントが本物のアプリか（改ざん・エミュレータ・偽アプリでないか）を検証します。Web、iOS、Android それぞれのアテステーション機構が使われます。Curity はこれらを組み合わせた自社ソリューション（HAAPI: Hypermedia Authentication API。アテステーション、認証中の DPoP、多要素ワークフロー、アプリ内ログイン等を提供）を紹介していますが、これはベンダー固有の実装であり FAPI 仕様そのものではない点に注意してください。

> 出典: Curity「What is Financial-Grade Security?」 — https://curity.io/resources/learn/what-is-financial-grade/

---

### 6. API ゲートウェイでの強制 — RS 側でやるべきこと

FAPI の要件の多くは AS 側で満たされますが、**RS（API）側で送信者制約を検証しなければ、すべてが無意味**になります。AS が `cnf` を入れたトークンを発行しても、RS が `cnf` を見ずに署名と期限だけ確認していれば、盗まれたトークンはそのまま使えてしまうからです。

#### 6.1 Curity: ファントムトークンパターン

Curity は次の構成を推奨しています。

- リバースプロキシ（ゲートウェイ）が mTLS を終端し、クライアント証明書を検証する
- ゲートウェイが所持証明（mTLS または DPoP）を検証する
- ゲートウェイが公開鍵（またはそのサムプリント）をバックエンド API に転送する
- API は受け取った公開鍵と `cnf` クレームを**毎リクエスト**照合する
- スコープとクレームも毎回検証する

**ファントムトークンパターン**とは、外部クライアントには中身の読めない不透明（opaque）トークンを渡し、ゲートウェイがそれをイントロスペクションして内部向けの JWT に差し替えて API に渡す方式です。外部にクレーム（個人情報など）を晒さずに済み、失効も AS 側で即座に効かせられます。

**注意点（防御側の観点）**: ゲートウェイが TLS を終端して証明書情報を HTTP ヘッダ（例: `X-Client-Cert`）で内部に転送する構成では、**外部から同名ヘッダを送り込まれても上書き・除去する**設定が必須です。これを怠ると、攻撃者が任意の証明書情報をヘッダに入れて証明書バインドを偽装できてしまいます。

#### 6.2 Zuplo: ポリシーパイプライン

Zuplo は、ゲートウェイが検証すべき項目を「トークンの署名・有効期限・発行者・受信者（audience）・スコープ」に加えて「トークンの鍵に一致する有効な DPoP 証明」または「トークンの `cnf` と一致するクライアント mTLS 証明書のサムプリント」と整理し、次の順序のポリシーパイプラインを示しています。

1. mTLS Auth（クライアント証明書の検証。有効期限・失効チェックを含む）
2. JWT Auth（トークンの検証・デコード）
3. カスタム DPoP 検証（前掲の TypeScript）
4. JWT スコープ検証
5. リクエスト検証（OpenAPI スキーマで body・query・path・header を強制）
6. レート制限（ユーザー、API キー、IP、独自属性ごと）

スコープ検証の設定例:

```json
{
  "name": "fapi-scope-check",
  "policyType": "jwt-scopes-inbound",
  "handler": {
    "export": "JWTScopeValidationInboundPolicy",
    "module": "$import(@zuplo/runtime)",
    "options": {
      "scopes": ["accounts:read", "transactions:read"]
    }
  }
}
```

**なぜこの順序か**: 安価で決定的な検証（TLS 層の証明書）から始め、トークンの正当性 → そのトークンを「この送信者が」使ってよいか（DPoP/mTLS 照合）→ その操作をしてよいか（スコープ）→ リクエストの形が正しいか（スキーマ）→ 量の制御（レート制限）と、**「誰が」「何を」「どのように」**の順で絞り込んでいます。送信者制約の検証をスコープ検証より前に置くことで、盗まれたトークンによるリクエストを早期に落とせます。

> 出典: Zuplo「FAPI 2.0 Explained」 — https://zuplo.com/learning-center/fapi-2-financial-grade-api-security-patterns
> 出典: Curity「What is Financial-Grade Security?」 — https://curity.io/resources/learn/what-is-financial-grade/

---

### 7. 規制と採用の動向（時事情報・2025〜2026年時点）

各資料が挙げる採用状況をまとめます。規制の日付・対象は改定されやすいため、実務では必ず一次情報を確認してください。

| 地域 | 制度 | FAPI との関係（資料時点） |
|---|---|---|
| 英国 | UK Open Banking | FAPI 1.0 Advanced ベースのセキュリティプロファイル。FAPI 2.0 への移行が見込まれる（Zuplo） |
| EU | PSD2 | 2018 年から銀行 API の提供を義務化（Zuplo） |
| オーストラリア | Consumer Data Right（CDR） | 銀行（稼働中）・エネルギー・通信で FAPI 準拠を要求。FAPI 1.0 Advanced を参照し、FAPI 2.0 を「セキュリティ強化」として目標化（Zuplo・Auth0） |
| ブラジル | Open Banking/Open Finance | FAPI 1.0 Advanced を要求（Auth0） |
| コロンビア | Superintendencia Financiera de Colombia 外部通達 004/2024（2024年2月7日） | Open Finance に **FAPI 2.0 を義務化**（Auth0） |
| 米国 | CFPB Section 1033（消費者金融データ権ルール） | 対象機関に API 提供を義務化。最大手は **2026 年**から、小規模機関は **2030 年**まで段階適用（Zuplo。なお同ルールは見直し・訴訟の動きがあり、日程は変動しうる） |
| 北米 | FDX（Financial Data Exchange） | FAPI 要件に整合した相互運用標準を策定（Zuplo） |

Auth0 は「銀行を Web で操作したり、モバイルウォレットを銀行口座と連携したりするとき、利用者は知らないうちに FAPI で保護されたフローを使っている可能性が高い」と述べています。また Auth0 自身も Highly Regulated Identity（HRI）として FAPI 2.0 Security Profile の認証（certification）を取得し、FAPI 1.0 Advanced についても「PAR with Private Key JWT」「PAR with mTLS」の構成で認証を維持していると記しています。

**適合性テスト**: OpenID Foundation は FAPI の**適合性テストツール（conformance suite）**を提供しており、Zuplo はこれによる検証を推奨しています。自組織の AS/RS を検証する場合は、この公式テストスイートを**自分の管理下の環境**に対して実行するのが正攻法です（他者のサービスに対して許可なく実行してはいけません）。

---

### 8. 実装・レビュー時の落とし穴チェックリスト（防御側）

最後に、ここまでの内容を「FAPI を名乗る実装をレビューするときの観点」に落とし込みます。

- [ ] **ライブラリ対応**: Curity が指摘するように、標準的な OAuth ライブラリは DPoP・PAR・JAR・JARM を十分にサポートしていないことが多い。自前実装した部分（特に署名検証・`cnf` 照合）を重点的にレビューしたか
- [ ] **RS 側の `cnf` 照合**: `cnf.x5t#S256` / `cnf.jkt` を毎リクエスト検証しているか。`Authorization: DPoP` のトークンを `Bearer` として送られた場合に拒否しているか（ダウングレード防止）
- [ ] **DPoP 検証の網羅性**: `typ`、`alg` 許可リスト、`htm`/`htu` 一致、`iat` 時間窓、`jti` 再利用検知、`ath` 一致
- [ ] **PAR の強制**: AS が「PAR を経由しない認可リクエスト」を拒否しているか（PAR を"提供しているだけ"では URL 直書きのリクエストで迂回できる）
- [ ] **PKCE**: `S256` 限定、`plain` 拒否、`code_verifier` なしのトークン交換を拒否
- [ ] **`iss` 照合**: RFC 9207 の `iss` または JARM の `iss` を、リクエスト送信先 AS と厳密比較しているか（Mix-Up 対策）
- [ ] **`redirect_uri` 完全一致**
- [ ] **クライアント認証**: 共有シークレットが残っていないか。`private_key_jwt` の `aud`・`exp`・`jti` を検証しているか
- [ ] **署名アルゴリズム**: PS256/ES256/EdDSA に限定され、`none`・HS 系・RS256 が拒否されるか
- [ ] **TLS 終端とヘッダ転送**: ゲートウェイが転送する証明書ヘッダを外部から偽装できないか
- [ ] **有効期限**: 認可コード 60 秒以内、`request_uri` 600 秒未満、アクセストークンは短命

FAPI の本質は「新しい魔法」ではなく、**OAuth の既知の穴を一つずつ仕組みで塞ぎ、その組み合わせが十分であることを攻撃者モデルと形式検証で裏づけた**点にあります。個々の要件を「どの攻撃を、どういう原理で止めているのか」とセットで理解しておけば、FAPI 準拠を謳うシステムでも、どこが省略・誤実装されやすいかを見抜けるようになります。
