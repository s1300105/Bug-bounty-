## JWT と OIDC id_token の検証不備（alg=none・algorithm confusion）

OAuth 2.0 のアクセストークンは仕様上は「不透明な文字列（opaque token）」でよく、その中身をクライアントが解釈する必要はない。しかし現実の多くの実装、とりわけ OpenID Connect（OIDC。OAuth 2.0 の上に「認証」を載せた拡張）では、ユーザーの身元を表す **id_token** が **JWT（JSON Web Token）** として発行される。さらに、リソースサーバが自前でトークンを検証する構成では、アクセストークンそのものも JWT であることが多い。

JWT は「署名によって改ざんを検知できる」という前提で信頼される。逆に言えば、**署名検証を回避できれば、トークンの中身（＝ユーザー ID や権限）を攻撃者が自由に書き換えられる**。本節では、JWT の署名検証を破る代表的な脆弱性クラスである「`alg=none`」と「algorithm confusion（アルゴリズム混同、別名 key confusion）」を、なぜそれが起きるのかというパーサ・ライブラリ内部の挙動レベルまで掘り下げて解説する。OIDC の文脈では、この攻撃が成功すると「本人になりすます（sub クレームの偽造）」「管理者に昇格する（role/isAdmin の書き換え）」といった深刻な帰結につながる。

> ⚠️ 本節は防御目的の解説である。示すペイロードやコマンドは、自分が管理する検証用環境や、明示的に許可された学習用ラボに対してのみ用いること。実在サービスや本番環境への無許可の検証・改ざんは行わない。

### JWT の構造と署名検証の仕組み

まず土台を固める。JWT は 3 つの部分を「.（ドット）」で連結した文字列である。各部分は **base64url**（URL でも安全に使えるよう `+/=` を排した base64 変種）でエンコードされている。

```
<header(base64url)>.<payload(base64url)>.<signature(base64url)>
```

- **ヘッダー（header）**: トークンのメタデータ。最重要は `alg`（署名アルゴリズム。例 `HS256`, `RS256`, `none`）と、鍵を識別する `kid`（Key ID）。
- **ペイロード（payload）**: クレーム（claim＝主張）の集合。OIDC の id_token なら `sub`（ユーザーの一意識別子）、`iss`（発行者）、`aud`（受信者＝どのクライアント向けか）、`exp`（失効時刻）などが入る。アプリ独自に `role` や `isAdmin` を入れることも多い。
- **署名（signature）**: ヘッダーとペイロードを鍵でハッシュ／署名したもの。ここが「改ざん検知」の核心である。

デコードした例（header と payload）:

```json
// header
{ "alg": "HS256", "typ": "JWT" }
// payload
{ "sub": "carlos", "isAdmin": false, "role": "blog_author" }
```

署名は概念的に次のように作られる。`HS256`（HMAC-SHA256、対称鍵アルゴリズム）の場合:

```
signature = HMAC-SHA256( base64url(header) + "." + base64url(payload), secret )
```

`RS256`（RSA-SHA256、非対称鍵アルゴリズム）の場合は、発行者が持つ**秘密鍵**で署名し、検証側は対応する**公開鍵**で検証する。

ここで押さえるべき原理は、**署名は「ヘッダー＋ペイロード」を入力にして計算される**ため、「ヘッダーやペイロードの 1 バイトでも書き換えると署名が一致しなくなる」という点だ。したがって攻撃者にとっての本丸は、**この署名検証をどう無力化するか**に尽きる。以降で見る攻撃はすべて、この一点を突く。

> 出典: JWT attacks — https://portswigger.net/web-security/jwt

### 攻撃クラス1: `alg=none`（署名なしトークンの受理）

#### 何が起きるのか

JWT 仕様（RFC 7519 / JWS の RFC 7515）は、`alg` に `none` を指定した「**Unsecured JWT（署名なし JWT）**」を認めている。`alg=none` のトークンは署名部分が空になる（末尾のドットの後に何もない）:

```
eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsImlzQWRtaW4iOnRydWV9.
```

サーバがこの `none` を受理してしまうと、**署名検証そのものがスキップされる**。攻撃者はブラウザなどクライアント側で自由にヘッダーを `{"alg":"none"}` に書き換え、ペイロードの `"username":"joe"` を `"username":"admin"` に、`"isAdmin":false` を `true` に変え、署名を消すだけで、任意のユーザーへのなりすましや権限昇格ができる。

PortSwigger のナレッジベースは、この問題を **深刻度: High（高）**、分類 **CWE-345（Insufficient Verification of Data Authenticity＝データの真正性検証が不十分）** としている。修正指針は明快で、「**署名なし JWT はサーバ側で拒否し、暗号学的に強いアルゴリズムのみを受理・検証する**」ことである。重要なのは、「自分のアプリが署名なし JWT を使っていなくても、JWT パースライブラリが `none` を明示的に禁止するよう設定しなければならない」という点だ。使っていないつもりでも、ライブラリのデフォルトが `none` を通してしまえば脆弱になる。

> 出典: JWT none algorithm supported — https://portswigger.net/kb/issues/00200901_jwt-none-algorithm-supported

#### なぜ起きるのか（仕組み）

原因は、多くの JWT ライブラリの検証関数が「トークンのヘッダーに書かれた `alg` を信じて、その通りのアルゴリズムで検証する」という設計になっているためだ。`alg` はトークンの一部であり、**攻撃者が完全に制御できる入力**である。検証に使うアルゴリズムを、検証対象（＝信頼できない入力）自身に決めさせている構図がそもそもの設計欠陥だ。`alg` が `none` なら「検証すべき署名は無い」と解釈され、検証は素通りする。

#### フィルタ回避（大文字小文字・エンコーディング）

素朴な防御として `alg` の値が文字列 `"none"` かどうかを単純比較で弾く実装がある。しかしこれは容易に破られる。JWT ライブラリのなかには `alg` を**大文字小文字を区別せず**に解釈するものがあるため、ブロックリストが `none` だけを弾いていると、`None`・`NONE`・`nonE` などの表記で回避できる。実際、**2019 年に Auth0 の認証が `alg:none` 系のリクエストで回避された事例**では、「`none` はブロックしていたが `nonE` はブロックしていなかった」という、まさにこの大文字小文字の穴が突かれた。

```json
// フィルタ回避の例（値の表記ゆれ）
{ "alg": "nonE" }
{ "alg": "NONE" }
```

このほか「予期しないエンコーディング（unexpected encodings）」による難読化で文字列比較をすり抜ける手口も知られる。教訓は、**ブロックリスト（拒否リスト）ではなくアローリスト（許可リスト）で防御せよ**ということに尽きる。「`none` を弾く」のではなく「`RS256` だけを許可する」と書けば、表記ゆれの穴は原理的に生じない。

> 出典: JWT Vulnerabilities: Common Attacks and How to Prevent Them — https://dev.to/roxdavirox/jwt-vulnerabilities-common-attacks-and-how-to-prevent-them-372k

### 攻撃クラス2: 弱い署名鍵のブルートフォース（HS256 のシークレット総当たり）

`alg=none` を塞いでいても、`HS256` の**シークレット（共有秘密鍵）が弱い**と別の道で破られる。HS256 は任意の文字列を鍵に使えるため、開発者がデフォルト値・ハードコード値・推測容易な値（`secret`, `jwt_secret`, `changeme` など）を使ってしまうことがある。

HMAC 署名はオフラインで検証可能だ。攻撃者は正規の JWT を 1 つ手に入れれば、ネットワークにアクセスせずに手元でシークレットを総当たりできる。`hashcat` を使う例:

```bash
# -m 16500 は JWT(HS256)用のモード
hashcat -a 0 -m 16500 <jwt> <wordlist>
```

これは「JWT のヘッダーとペイロードを、ワードリストの各シークレットで署名し直し、得られた署名を元の署名と突き合わせる」処理である。一致すれば、そのシークレットが正解だ。シークレットが割れれば、攻撃者は正規サーバとまったく同じ鍵で任意のトークンを**正しく署名して**偽造できる。`jwt_tool` など JWT 専用ツールでも同様の辞書攻撃が可能で、短いシークレットは「オフラインで簡単に割れる（trivially crackable offline）」。

防御は、**十分に長くランダムな（高エントロピーの）シークレットを使う**こと。目安として 256 ビット以上のランダム値。人間が覚えられる語句は使わない。

> 出典: JWT attacks — https://portswigger.net/web-security/jwt ／ JWT Vulnerabilities — https://dev.to/roxdavirox/jwt-vulnerabilities-common-attacks-and-how-to-prevent-them-372k

### 攻撃クラス3: algorithm confusion（アルゴリズム混同 / RS256→HS256 ダウングレード）

これは本節でもっとも巧妙で、OIDC 環境で特に重要な攻撃だ。**「非対称鍵 RS256 を使っているのに、公開鍵が公開されているから安全」という思い込みを突く**。

#### 前提となる仕組み（なぜ公開鍵が攻撃に使えるのか）

RS256 は非対称暗号だ。発行者（例: OIDC の認可サーバ）は**秘密鍵**で署名し、検証側は**公開鍵**で検証する。公開鍵はその名の通り公開情報であり、OIDC では通常 `/.well-known/jwks.json` などの **JWKS エンドポイント**（JSON Web Key Set。公開鍵を JWK 形式で列挙した公開文書）で誰でも取得できる。公開鍵が漏れても、秘密鍵が無ければ署名は偽造できない——RS256 が正しく使われている限りは。

問題は、多くの JWT ライブラリの `verify()` が**アルゴリズム非依存（algorithm-agnostic）に作られている**ことだ。開発者は「`verify(token, publicKey)` は RS256 用だ」と思い込んでいるが、実際の `verify()` は `alg` ヘッダーを見て、対称（HS256）・非対称（RS256）の両方を処理してしまう。しかもどちらで検証するかは**信頼できない `alg` ヘッダー**が決める。

- `alg` が `RS256` → 第2引数の鍵を「RSA 公開鍵」として署名検証。
- `alg` が `HS256` → 第2引数の鍵を「HMAC の共有シークレット（バイト列）」として検証。

ここに致命的な混同が生まれる。サーバが「RSA 公開鍵」を汎用 `verify()` に渡していると、攻撃者が `alg` を `HS256` に変えるだけで、**ライブラリはその公開鍵をただのバイト列＝ HMAC シークレットとして扱ってしまう**。公開鍵は攻撃者も知っている。つまり攻撃者は「サーバが HMAC 鍵として使う値」を完全に把握しているので、その公開鍵を HMAC シークレットにして自分で正しい HS256 署名を計算でき、偽造トークンがサーバ側の検証を通ってしまう。

#### 攻撃の要件

1. サーバの**公開鍵を入手できる**こと（`/jwks.json` や `/.well-known/jwks.json` から JWK として取得、あるいは既存トークンから導出）。
2. JWT のクレームを**改ざんできる**こと（`sub`, `role` などを書き換え）。
3. サーバが**固定鍵を使い、かつアルゴリズム非依存な検証**をしていること。

#### 攻撃手順

**手順1: 公開鍵を入手する。** JWKS エンドポイントから JWK オブジェクトを取得する。

**手順2: JWK を PEM 形式（X.509）に変換する。** ここが最重要かつ最も嵌りやすい。HMAC の入力は「バイト列」なので、攻撃者が HMAC シークレットとして使う公開鍵のバイト表現が、**サーバがメモリ上で HMAC 鍵として使うバイト表現と 1 バイトの狂いもなく一致**しなければならない。改行・末尾の改行・PEM のヘッダ／フッタといった「非印字文字（non-printing characters）を含めてバイト単位で完全一致」させる必要がある。

**手順3: ペイロードを改ざんし、ヘッダーの `alg` を `HS256` にする。**

```json
// header（RS256 から HS256 へ書き換え）
{ "alg": "HS256" }
// payload（権限昇格の例）
{ "sub": "carlos", "isAdmin": true }
```

**手順4: 手順2の公開鍵（PEM のバイト列）を HMAC シークレットとして HS256 で署名する。**

概念コード（自分の検証環境での学習用）:

```python
import hmac, hashlib, base64, json

def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

# public_key_pem: サーバのJWKSから得た公開鍵をPEM(X.509)に変換したもの。
# サーバ側の鍵バイト列と完全一致していることが成否を分ける。
public_key_pem = open("server_pubkey.pem", "rb").read()

header  = {"alg": "HS256", "typ": "JWT"}
payload = {"sub": "carlos", "isAdmin": True}

signing_input = f"{b64url(json.dumps(header).encode())}.{b64url(json.dumps(payload).encode())}"
sig = hmac.new(public_key_pem, signing_input.encode(), hashlib.sha256).digest()
token = f"{signing_input}.{b64url(sig)}"
print(token)
```

**なぜこれが通るのか**を改めて言えば、サーバは受け取ったトークンの `alg=HS256` を見て「`HMAC-SHA256(signing_input, 手元の鍵)` を計算して署名と比べる」処理に入る。サーバの「手元の鍵」は RSA 公開鍵（公開情報）だ。攻撃者はまったく同じ計算を同じ鍵バイト列で行ったので、署名は一致する。秘密鍵は一切不要である。

#### 公開鍵が直接公開されていない場合

JWKS が非公開でも諦められない。**2 つ以上の既存トークン**があれば、そこから RSA の**モジュラス `n`（公開鍵を構成する合成数）**の候補を数学的に逆算できる。PortSwigger の `sig2n` ツール（`jwt_forgery.py`）がこれを行う:

```bash
# 2つの正規トークンからRSA公開鍵の候補を算出する（学習用ラボ等で）
docker run --rm -it portswigger/sig2n <token1> <token2>
```

これで得た公開鍵候補を使って、上記の HS256 偽造を試す。原理としては、同一メッセージに対する複数の RSA 署名から公開鍵パラメータを復元する古典的手法に基づく。

#### 防御

根本策は **`alg` を信用しないこと**、すなわち検証時に**期待するアルゴリズムを明示的にアローリストで固定**し、それ以外は一律拒否する。RS256 を使う設計なら、検証は「RS256 のみ・公開鍵での検証のみ」に固定し、HS256 に化けたトークンを構造的に受け付けないようにする。

> 出典: Algorithm confusion attacks — https://portswigger.net/web-security/jwt/algorithm-confusion ／ JWT Vulnerabilities — https://dev.to/roxdavirox/jwt-vulnerabilities-common-attacks-and-how-to-prevent-them-372k

### 攻撃クラス4: 鍵の注入（jwk / jku / kid ヘッダーの悪用）

`alg=none` と algorithm confusion に加え、**「どの鍵で検証するか」を攻撃者が誘導する**ヘッダー系の攻撃群も同じ穴（＝トークン内の値を信じてしまう）から生じる。

#### jwk ヘッダーインジェクション

`jwk` は「この JWT を検証するための公開鍵を、ヘッダーに直接埋め込む」オプションパラメータ。設定を誤ったサーバは、**アローリストと照合せずに `jwk` に埋め込まれた鍵をそのまま使って**検証してしまう。攻撃者は次の手順で偽造する。

1. 自分の RSA 鍵ペアを生成する。
2. JWT のペイロードを改ざんする。
3. 自分の**公開鍵**を `jwk` ヘッダーに埋め込む。
4. 自分の**秘密鍵**で署名する。

サーバは埋め込まれた公開鍵で検証するので、攻撃者の署名は当然通る。**サーバは自分が信頼した鍵ではなく、攻撃者が持ち込んだ鍵で検証している**のが本質だ。

#### jku ヘッダーインジェクション

`jku`（JWK Set URL）は「検証用の鍵集合（JWK Set）を、この URL から取ってこい」と指示するパラメータ。サーバがこの URL を無条件に信頼すると、攻撃者は自分の管理する URL に自作の JWK Set を置き、そこを `jku` に指定して偽造トークンを検証させられる。防御として `jku` の**許可ホストを厳格にアローリスト化**する実装があるが、URL パーサの解釈差（URL parsing discrepancies）を突いてアローリストを回避される場合がある（例: `@` やフラグメント、ホスト名解釈の食い違いを利用した SSRF 的な回避）。

#### kid ヘッダーの悪用（パストラバーサル / SQL インジェクション）

`kid`（Key ID）は鍵集合の中から「どの鍵か」を選ぶ識別子。この値がファイルパスや DB クエリに素通しで使われると、`kid` 自体が攻撃面になる。

- **パストラバーサル**: `kid` を任意ファイルへのパスに向ける。

```json
{ "kid": "../../path/to/file", "alg": "HS256" }
```

- **空ファイル攻撃**: `kid` を `/dev/null`（中身が空のファイル）に向けると、鍵が「空文字列」になる。サーバが空文字列を HMAC シークレットとして使えば、攻撃者も空文字列で署名でき、検証が通る。
- **SQL インジェクション**: `kid` が SQL クエリに埋め込まれる場合、そこから鍵の値を注入したり認証を回避したりできる。

このほか、`cty`（Content-Type）を悪用して署名検証回避後に XXE / デシリアライゼーション攻撃につなげる手口、`x5c`（X.509 証明書チェーン）を使った `jwk` 類似の証明書注入も知られる。

> 出典: JWT attacks — https://portswigger.net/web-security/jwt

### 総合的な防御策（OIDC id_token の正しい検証）

ここまでの攻撃はすべて「トークンの中の値を検証ロジックが信じてしまう」ことに起因する。防御は裏返しで、「**検証パラメータをサーバ側の期待値で固定し、トークンの主張を鵜呑みにしない**」ことに集約される。

**1. アルゴリズムを明示的にピン留めする（最重要）。** 検証時に必ず期待アルゴリズムをアローリストで指定する。これ 1 つで `alg=none` と algorithm confusion の両方を封じられる。Node.js の `jsonwebtoken` の例:

```javascript
// 正しい: 受理するアルゴリズムを明示
jwt.verify(token, publicKey, { algorithms: ['RS256'] });
```

**`algorithms` を省略してはならない。その省略は「中立」ではなく「脆弱性」である**（省略すると `alg` ヘッダーに従って何でも検証しようとし、`none` や HS256 混同を許してしまう）。ブロックリスト（`none` を弾く）ではなく、アローリスト（`RS256` だけ許す）で書くこと。

**2. すべてのクレームを検証する。** 署名が正しくても、クレーム検証を怠ると別の穴になる。

- `exp`（失効）: 無いトークンは「永遠に有効」になる。必ず失効を設ける・検証する。
- `nbf`（not before、有効開始時刻）: 多くの実装で無視されがち。
- `aud`（受信者）: 未検証だと、別サービス向けのトークンが自サービスで通ってしまう。OIDC では**自分のクライアント ID が `aud` に含まれるか**を必ず確認する。
- `iss`（発行者）: 検証しないと、意図した発行者以外のトークンを再利用される。OIDC では信頼する認可サーバの `iss` と厳密一致を確認する。

**3. 分散システムでは RS256（非対称）を選ぶ。** 検証側に配るのは公開鍵だけで済み、共有シークレットを配布・漏洩させるリスクが無い。ただし前述の algorithm confusion 対策（アルゴリズム固定）は必須。

**4. JWKS エンドポイントと `kid` による鍵ローテーションを使う。** ただし `jku`/`jwk`/`kid` は前節の通り攻撃面なので、`jku` は許可ホストを厳格に固定し、`kid` はパストラバーサル・SQLi を想定してサニタイズ・照合する。可能なら `jwk`/`jku` によるヘッダー由来の鍵指定は無効化し、サーバが事前に知っている鍵集合のみで検証する。

**5. 最新の JWT ライブラリを使い、CI/CD で自動スキャンする。** 古いライブラリは `none` 許容などの既知欠陥を抱える。`jwt_tool` や `jwt_scanner` を継続的に走らせる。

**6. トークン失効の仕組みを持つ。** 署名が有効でも失効させられるよう、失効リスト／短命トークン＋リフレッシュの設計を用意する。

要するに、OIDC の id_token を受け取る側は「**署名アルゴリズムを固定して検証し、`iss`/`aud`/`exp` を必ず突き合わせる**」——この 2 点を外さなければ、本節の攻撃群の大半は成立しなくなる。

> 出典: JWT attacks — https://portswigger.net/web-security/jwt ／ Algorithm confusion attacks — https://portswigger.net/web-security/jwt/algorithm-confusion ／ JWT none algorithm supported — https://portswigger.net/kb/issues/00200901_jwt-none-algorithm-supported ／ JWT Vulnerabilities — https://dev.to/roxdavirox/jwt-vulnerabilities-common-attacks-and-how-to-prevent-them-372k
