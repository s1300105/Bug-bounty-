## アルゴリズム混同（RS256→HS256）

### この節で学ぶこと

JWT（JSON Web Token）は「ヘッダ.ペイロード.署名」の3つを `.` で連結した文字列で、それぞれが Base64URL でエンコードされている。ヘッダの `alg` フィールドは「この署名を検証するときに使うべきアルゴリズム」を宣言する。**アルゴリズム混同（algorithm confusion）攻撃とは、この `alg` の宣言をサーバが鵜呑みにする実装を突き、署名の検証方式を攻撃者にとって都合のよいものへすり替える攻撃**である。

その代表格が **RS256 → HS256 のすり替え**だ。本来 RSA の秘密鍵を持つ者しか署名できないはずの `RS256` を、公開情報だけで偽造できる `HS256` へ変換してしまう。秘密鍵も共有シークレットも一切盗まずに、公開鍵という「誰でも見られる情報」だけで管理者トークンを製造できる点が、この攻撃の恐ろしさの核心である。

本節では、まず署名アルゴリズムの二種類（対称・非対称）の違いを仕組みレベルで押さえ、なぜ公開鍵が HMAC の鍵として流用できてしまうのかを数学と実装の両面から解説する。続いて実際の偽造手順、関連攻撃（`alg:none`、Psychic Signatures、`jku` 注入、`kid` インジェクション）、影響、そして防御を扱う。

> **スコープの前提**：本節は防御目的の解説である。ペイロード例は原理理解のための最小構成にとどめ、実在サービスや本番環境への無許可の検証・破壊的手順は一切記載しない。読者が自組織の実装を安全側に倒せるようになることを目的とする。

---

### 対称鍵と非対称鍵 ―― なぜ混同が成立するのか

アルゴリズム混同を理解する前提として、JWT の署名に使われる2系統のアルゴリズムを整理する。

- **HS256（HMAC-SHA256）＝ 対称鍵（symmetric）方式**
  署名も検証も**同一の秘密鍵（共有シークレット、shared secret）**を使う。`signature = HMAC-SHA256(secret, header + "." + payload)` を計算し、受信側は同じ `secret` で同じ計算をして一致するか比べるだけ。鍵を知っている者は署名も検証もできる。

- **RS256（RSA-SHA256）＝ 非対称鍵（asymmetric）方式**
  署名は**秘密鍵（private key）**でしか作れないが、検証は**公開鍵（public key）**で誰でも行える。公開鍵はその名の通り公開してよい。JWKS エンドポイント（`/.well-known/jwks.json` など）、OpenID Connect の設定、TLS 証明書、クライアント側コードなど、あちこちに露出しているのが普通である。

ここに罠がある。多くの JWT ライブラリは、検証関数に **鍵を1つの変数（`key`）として渡す設計**になっている。そして「どのアルゴリズムで検証するか」を**トークンのヘッダの `alg` から読み取る**実装が古くは主流だった。すると次の破綻が起きる。

- サーバ開発者の意図：「`key` は RSA 公開鍵。`RS256` で署名検証してほしい」
- 実際にコードがやること：`alg` が `HS256` に書き換えられていたら、「`key`（RSA 公開鍵の**バイト列**）を HMAC の共有シークレットとみなして」HMAC-SHA256 検証を実行してしまう

WorkOS の記事はこの本質を次のように述べる。「トークンは、自分がどう検証されるべきかというメタデータを持ち歩いている。もしサーバがそのメタデータを信頼すれば、攻撃者は秘密鍵も共有シークレットも一切手に入れることなく、認証システム全体を転覆できる」。

#### なぜ「公開鍵を HMAC の鍵にする」計算が攻撃者側で再現できるのか

HMAC-SHA256 は**任意のバイト列を鍵として受け付ける**。鍵が RSA 公開鍵か、ランダムなパスワードか、猫の名前かを問わない。鍵の中身の妥当性を検証しない。したがって、次の2条件が揃えば攻撃者とサーバは**まったく同じ HMAC 出力**を計算できる。

1. 同じメッセージ（＝攻撃者が作ったヘッダ＋ペイロード）
2. 同じ鍵（＝サーバの RSA 公開鍵。これは公開情報なので攻撃者も入手できる）

WorkOS の言葉を借りれば「攻撃者とサーバが同じ鍵と同じメッセージを使えば、同じ出力が得られる」。RS256 では検証にしか使えなかった公開鍵が、HS256 の文脈では**署名生成の鍵**に化けてしまうのだ。攻撃者は公開鍵を HMAC 秘密鍵として使い、自作トークンに正しい HMAC 署名を付けられる。サーバは同じ公開鍵で同じ HMAC 検証を行い、一致するので「正規のトークン」と判断する。

> 出典: JWT Algorithm Confusion Attacks — https://workos.com/blog/jwt-algorithm-confusion-attacks

---

### 攻撃の前提条件

RS256→HS256 混同が成立するには、次の3条件が揃う必要がある（DEV / aquilax.ai / jsmon.sh の各記事が共通して挙げる）。

1. **サーバがアルゴリズムをピン留め（algorithm pinning）していない**。すなわち検証時に「RS256 だけを許可する」と明示せず、`alg` ヘッダの宣言に従ってしまう。
2. **RSA 公開鍵が入手可能**。JWKS エンドポイント、OIDC discovery（`/.well-known/openid-configuration`）、CDN 配布、クライアント JS への埋め込みなどから取得できる。
3. **ライブラリが対称・非対称の検証を同じコードパスで処理する**、あるいはピン留めを強制しないバージョンである。

裏を返せば、この3つのどれか一つでも崩せば攻撃は不成立になる。防御の設計はここから逆算できる。

---

### 攻撃手順の全体像

DEV および jsmon.sh の記事に沿って、攻撃者視点の流れを追う（防御者が「どこで検知・遮断できるか」を掴むための解説であり、実サービスへの適用を意図しない）。

#### フェーズ1：偵察 ―― 公開鍵の入手

まず JWKS エンドポイントを探す。典型的なパスは次の通り。

```
/.well-known/jwks.json
/.well-known/openid-configuration
/api/auth/keys
```

JWKS は次のような JSON で、RSA 鍵なら `kty: "RSA"` と、鍵本体を表す `n`（modulus、法）と `e`（exponent、公開指数）を含む。

```json
{
  "keys": [
    {
      "kty": "RSA",
      "alg": "RS256",
      "kid": "prod-2026-01",
      "n": "0vx7agoebGcQSuu...（長いBase64URL）",
      "e": "AQAB"
    }
  ]
}
```

攻撃者は `n` と `e` から RSA 公開鍵を復元し、PEM 形式（`-----BEGIN PUBLIC KEY-----` で始まるテキスト）に変換する。この PEM のバイト列が、次段の HMAC 鍵になる。

> **なぜ PEM のバイト列が鍵になるのか**：ここが実務上の重要な落とし穴である。サーバは検証時、公開鍵を「PEM 文字列そのもの」としてメモリに保持し、それを HMAC 関数へ渡すことが多い。攻撃者は**サーバが保持しているのと寸分違わぬバイト列**（同じ PEM、同じ改行・末尾の有無）を再現する必要がある。改行コードや末尾の `\n` が1バイトでも違えば HMAC 出力が変わり、攻撃は失敗する。実際の攻略で「公開鍵は合っているのに通らない」ときは、たいていこのバイト列の不一致が原因である。

#### フェーズ2：アルゴリズムの探り（negotiation）

DEV の記事が示す判定手順が明快である。同一トークンで `alg` を差し替え、レスポンスを観察する。

- `alg` を `none` にしたトークンを送る
- `alg` を `HS256` にして公開鍵で HMAC 署名したトークンを送る

観測される反応の意味づけ：

| `alg:none` の応答 | `HS256`（公開鍵署名）の応答 | 解釈 |
|---|---|---|
| 401 | 200 | **RS256→HS256 混同が有効**である可能性が高い |
| 200 | 200 | `alg:none` も通る。複数クラスが刺さる（より深刻） |
| 401 | 401 | 少なくともこの2手法は防がれている |

> 出典: RS256 to HS256, Psychic Signatures, and alg:none on Production APIs — https://dev.to/roxdavirox/jwt-algorithm-confusion-rs256-to-hs256-psychic-signatures-and-algnone-on-production-apis-1oh7

#### フェーズ3：偽造と署名

aquilax.ai / jsmon.sh が示す偽造コードの本質は共通で、次の Python が最小例である。

```python
import jwt  # PyJWT

# 公開されている RSA 公開鍵（JWKSから復元したPEM）
rsa_public_key_pem = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
-----END PUBLIC KEY-----"""

# 公開鍵を「HMACの秘密鍵」として使い、HS256で署名する
forged_token = jwt.encode(
    {"sub": "attacker", "role": "admin", "exp": 9999999999},
    rsa_public_key_pem,        # ← 公開鍵をHMAC秘密鍵に流用
    algorithm="HS256"
)
```

**なぜこれで通るのか**：前述の通り HMAC はバイト列を無検証で鍵に採る。攻撃者が使った鍵（公開鍵 PEM）と、脆弱なサーバが検証に使う鍵（同じ公開鍵 PEM）が一致するため、HMAC 出力も一致する。`role: "admin"` や `exp: 9999999999`（遠い未来の失効時刻）といったクレーム（claim、トークンが主張する属性）は攻撃者の思うままだ。

脆弱なサーバ側（Node.js）は次のように書かれている。

```javascript
const decoded = jwt.verify(forgedToken, publicKey);
// ✓ 検証が通ってしまう —— role: "admin"
```

`jwt.verify` の第3引数（オプション）を省略しているため、`jsonwebtoken` は `alg` ヘッダを信用して HS256 検証へ分岐する。`publicKey` を HMAC シークレットとして扱い、攻撃者の署名と一致し、`{ sub:'attacker', role:'admin' }` を「検証済み」として返す。

`jwt_tool`（JWT 攻撃・診断用の定番 OSS）を使う場合、DEV / jsmon.sh は次のコマンドを挙げる。これは自組織のトークン診断に用いる想定の記述である。

```bash
# 公開鍵バイト列をHMAC秘密鍵としてHS256署名し直す
python3 jwt_tool.py TOKEN -X k -pk public.pem
```

`-X k`（key confusion モード）が、公開鍵を HMAC 鍵に流用して署名し直す処理を担う。JWKS エンドポイントから鍵を直接取り込む機能もある。

> 出典: JWT Algorithm Confusion Auth Bypass — https://aquilax.ai/blog/jwt-algorithm-confusion-auth-bypass
> 出典: JWT Algorithm Confusion to Account Takeover (RS256/HS256, jku injection, kid SQLi) — https://blogs.jsmon.sh/jwt-algorithm-confusion-to-account-takeover-rs256-hs256-jku-injection-kid-sqli/

---

### 影響を受けたライブラリと CVE（時事性の明記）

この脆弱性は特定製品の欠陥というより、**「デフォルトで `alg` を信用する」という業界全体の設計傾向**が生んだものだった。各記事が挙げる代表例を年代・修正状況とともに整理する（記載の CVE 番号・CVSS は各記事の主張に基づく。導入時は必ず一次情報で確認すること）。

| ライブラリ / 実装 | 脆弱バージョン / CVE | 状況 |
|---|---|---|
| Node.js `jsonwebtoken` | v4.2.2 より前はヘッダの `alg` を既定で採用 | 以降は `algorithms` 指定を推奨・強制する方向へ |
| Python `PyJWT` | 1.5.0 より前は明示的アルゴリズム指定を欠く。CVE-2022-29217（1.5.0〜2.3.0、CVSS 7.5） | 2.4.0 で `algorithms` 指定必須化などの対策 |
| `python-jose` | 〜3.3.0、CVE-2024-33663（CVSS 7.4） | アルゴリズム混同関連 |
| Auth0 `java-jwt` | 3.x より前で RS256→HS256 混同 | 以降のバージョンで対策 |
| `php-jwt` / `namshi/jose`（2.x 前）/ ruby-jwt | 各実装で同種の既定挙動 | 概ねピン留め強制へ移行 |

共通パターンは「ライブラリが**アルゴリズムのピン留めを要求せず**、トークンヘッダを信用する既定挙動だった」こと。**現在の維持されているメジャー版はいずれもこの既定を改めている**が、古いバージョンに固定された本番系、放置されたフォーク、自作パーサでは今も刺さる。

DEV は実在の報告例として **HackerOne #3800870（8x8、2024年）** を挙げる。`connect.8x8.com` の API が「RSA 公開鍵を HMAC 秘密鍵として署名した HS256 トークンを受理し」、秘密鍵なしで管理者トークンが偽造された、という事例である。

> 出典: RS256 to HS256, Psychic Signatures, and alg:none on Production APIs — https://dev.to/roxdavirox/jwt-algorithm-confusion-rs256-to-hs256-psychic-signatures-and-algnone-on-production-apis-1oh7

---

### 関連する近縁の攻撃

RS256→HS256 と同じく「`alg` やヘッダを信用する」ことから生じる攻撃群を、混同されがちなので機構ごとに区別して押さえる。

#### alg:none ―― 署名そのものを剥ぎ取る

RFC 7519 は `"alg": "none"`（署名なしトークン、unsecured JWT）を許容している。初期のライブラリはこれを**明示的なオプトインなしに受理**したため、攻撃者はヘッダを `none` に書き換え、署名部分を空（`.` の後ろを空文字）にするだけで検証を回避できた。

```json
// ヘッダをこう書き換える
{ "alg": "none", "typ": "JWT" }
```

```
// 署名部が空のトークン（末尾がドットで終わる）
eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhdHRhY2tlciIsInJvbGUiOiJhZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0.
```

aquilax.ai は **大文字小文字を変えた回避**（`"None"` `"NONE"` `"nOnE"`）にも触れる。文字列比較が `alg == "none"` の完全一致だけを弾く実装だと、`None` が素通りしてしまう。

現在の位置づけについて DEV は明快である。「最もよく文書化された JWT 脆弱性だが、本番で生き残る可能性は最も低い」。2015年以降のメジャー版はいずれも既定で `alg:none` を拒否し、`allowInsecureAlgorithm` のような明示フラグがないと通らない。**RFC 8725（JWT Best Current Practices）3.1 節**は「アプリが明示的に必要としない限り、`none` を受理してはならない」と定める。ただしテストコストが「1リクエスト・30秒」と極めて低いため、診断時には必ず一度は試す価値がある、というのが DEV の結論だ。

#### Psychic Signatures（CVE-2022-21449）―― ライブラリ設定では防げない例外

DEV が特に注意を促すのがこれである。**Java（JDK 15〜18、2022年4月パッチ前）の ECDSA 検証における境界チェック漏れ**で、`r=0, s=0` の署名が**メッセージや公開鍵によらず**検証を通ってしまう。

原理はこうだ。ECDSA 検証は概ね次式が成り立つかを見る。

```
(r · s⁻¹ mod n) · G + (hash · s⁻¹ mod n) · Q = R  → その x座標が r と一致するか
```

ところが `r = s = 0` を入れると、本来禁止されるべき値なのに境界チェックがないため、DEV の表現で「すべての中間項がゼロに潰れ、`0 = 0` が成立する。この等式はメッセージや公開鍵に関係なく常に真」。結果、64バイトすべてゼロの署名（`r=0, s=0`）が鍵情報も正しいメッセージもなしに検証を通過する。

- 前提：未パッチの JDK 15〜18、API が ES256/ES384/ES512（ECDSA 系）を使用。**ライブラリの設定やアルゴリズムピン留めとは無関係**に成立する点が RS256→HS256 と決定的に異なる。
- 影響範囲：JWT に限らず、TLS 証明書、OAuth/OIDC トークン、`java.security.Signature.verify()` を ECDSA で呼ぶすべての箇所。
- 影響バージョン例：Oracle JDK 17.0.2 / 18、GraalVM Enterprise 20.3.5 / 21.3.1 / 22.0.0.2。

つまり「正しくライブラリを設定していても、JVM 実装バグゆえに刺さる」。防御は**JDK のパッチ適用**そのものである。

> 出典: RS256 to HS256, Psychic Signatures, and alg:none on Production APIs — https://dev.to/roxdavirox/jwt-algorithm-confusion-rs256-to-hs256-psychic-signatures-and-algnone-on-production-apis-1oh7

#### jku / x5u 注入 ―― 検証鍵の出所を乗っ取る

JWT ヘッダには、検証に使う鍵の在り処を示す `jku`（JWK Set の URL）や `x5u`（証明書の URL）を書ける。サーバが**ドメイン検証なしにこの URL を取得**すると、jsmon.sh の言葉で「攻撃者は URL を攻撃者管理サーバへ向け、任意の JWK Set をホストできる」。

攻撃フロー：

1. 攻撃者が自前の RSA 鍵ペアを生成
2. `"jku": "https://evil.example/.well-known/jwks.json"` を含む JWT を作成
3. サーバが攻撃者の JWKS を取得し、攻撃者の公開鍵を検証鍵として採用
4. 攻撃者は自分の秘密鍵で署名済みなので、検証は当然通る

```python
headers = {
    "alg": "RS256",
    "jku": "https://evil.example/.well-known/jwks.json",
    "kid": "attacker-key-id"
}
payload = {"sub": "admin", "role": "superadmin", "exp": 9999999999}
# 攻撃者の秘密鍵で署名する
```

jsmon.sh は URL 検証の**回避手口**も列挙する。防御側は許可リストをこれらに耐えるよう設計する必要がある。

- ドメイン混同：`https://allowed.com.evil.example/`（`allowed.com` を含むが実体は `evil.example`）
- HTTP パラメータ汚染
- 許可ドメイン上のオープンリダイレクトを経由した SSRF
- メール記法混同：`https://allowed.com@evil.example/`（`@` の前はユーザ情報で、実体は `evil.example`）

診断では `jku`/`x5u` を自分の観測用サーバ（Burp Collaborator 等）へ向け、コールバックの有無で「サーバが URL を取りに来るか」を確かめる。

#### kid インジェクション ―― 鍵探索経路を突く SQLi / パストラバーサル

`kid`（Key ID）ヘッダは「どの署名鍵を使うか」のヒントに過ぎないが、これを**無害化せずに鍵探索に使う**実装が問題を生む。

**SQL インジェクション版**：`kid` をそのまま SQL に埋め込むと、返す鍵値を攻撃者が操作できる。

```sql
-- 脆弱なクエリ
SELECT secret_key FROM signing_keys WHERE kid = '<ヘッダのkid>';
```

```
-- kid にこれを注入
x' UNION SELECT 'attacker_secret'-- -

-- 結果として組み上がるクエリ
SELECT secret_key FROM signing_keys WHERE kid = 'x'
  UNION SELECT 'attacker_secret'-- -';
-- → 'attacker_secret' が「署名鍵」として返る
```

`UNION SELECT` で攻撃者が知っている値（`attacker_secret`）を鍵として返させ、その値で HS256 署名すれば検証が通る。

```python
malicious_kid = "x' UNION SELECT 'pwned_secret'-- -"
forged_token = jwt.encode(
    {"sub": "admin", "role": "admin", "exp": 9999999999},
    "pwned_secret",          # ← SQLiで返させる予定の鍵値
    algorithm="HS256",
    headers={"kid": malicious_kid}
)
```

**パストラバーサル版**：ファイルシステムから `kid` をファイル名として鍵を読む実装なら、`"kid": "../../../../dev/null"` で**空ファイル**を鍵として読ませられる。すると鍵は「空文字列」になり、攻撃者は空の HMAC シークレットで署名すれば通る。同様に `../../etc/passwd` のような既知内容ファイルを鍵に指定する手もある。

```json
{ "alg": "HS256", "typ": "JWT", "kid": "../../../../dev/null" }
```

その他の変種として、時間ベース SQLi 検出（`'; WAITFOR DELAY '0:0:5'-- -`）なども挙げられる。

> 出典: JWT Algorithm Confusion to Account Takeover (RS256/HS256, jku injection, kid SQLi) — https://blogs.jsmon.sh/jwt-algorithm-confusion-to-account-takeover-rs256-hs256-jku-injection-kid-sqli/

---

### 影響

これらの攻撃が刺さると、単一の偽造トークンで次が達成される。

- **認証バイパスと権限昇格**：非特権ユーザから `role: "admin"` へ一気に格上げ。jsmon.sh / aquilax.ai は「単一の偽造トークンによる完全なアカウント乗っ取り（ATO）」と表現する。
- **セッションの永続化**：`exp` を遠い未来に設定でき、偽造トークンは失効まで有効であり続ける。
- **横展開**：Psychic Signatures のように JWT を超えて TLS/OIDC 全般へ波及する場合もある。

WorkOS はこう総括する。「アルゴリズム混同が成立するのは、開発者が想定していることと、コードが実際にやっていることの間にギャップがあるからだ」。**公開情報だけで完全な認証バイパスに至る**点が、他の多くの脆弱性と一線を画す深刻さである。

> 出典: JWT Algorithm Confusion Attacks — https://workos.com/blog/jwt-algorithm-confusion-attacks

---

### 防御

各記事の対策は概ね一致する。優先順位順に、**なぜ効くのか**を添えて整理する。

#### 1. アルゴリズムのピン留め（最重要・非交渉）

検証時に**許可アルゴリズムを明示**し、`alg` ヘッダの宣言を無視する。これ一つで RS256→HS256 と `alg:none` の大半を封じる。

```javascript
// Node.js（jsonwebtoken）
const decoded = jwt.verify(token, publicKey, {
  algorithms: ['RS256']   // HS256 も none も投げる
});
```

```python
# Python（PyJWT）
decoded = jwt.decode(
    token, public_key,
    algorithms=["RS256"],          # 厳格な許可リスト
    options={"verify_exp": True}
)
```

**なぜ効くのか**：検証ルーチンが「RS256 の検証パス（公開鍵での RSA 検証）」に固定され、`alg:HS256` を持つトークンは分岐すら許されず即座に例外になる。攻撃者が公開鍵で HMAC 署名しても、そもそも HMAC 検証パスに到達しない。**対称と非対称を同じ許可リストに混ぜない**ことが鉄則である。

#### 2. 鍵タイプの検証（多層防御）

ピン留めに加え、鍵オブジェクトの型がアルゴリズム要件に合うかを確かめる。WorkOS の例：

```python
from cryptography.hazmat.primitives.asymmetric import rsa

def verify_token(token, key):
    header = jwt.get_unverified_header(token)
    if header["alg"] == "RS256":
        if not isinstance(key, rsa.RSAPublicKey):
            raise ValueError("Key type mismatch for RS256")
    return jwt.decode(token, key, algorithms=["RS256"])
```

**なぜ効くのか**：RSA 公開鍵オブジェクトが HMAC 鍵（ただのバイト列）として使われる経路を、型不一致で塞ぐ。「公開鍵 PEM をバイト列として HMAC に渡す」という混同の根を断てる。

#### 3. jku / x5u / jwk / crit などヘッダ由来の鍵参照を無効化

トークンが指定する URL や埋め込み鍵を**一切信用せず**、鍵は自サーバが管理する固定エンドポイント・厳格な許可リストからのみ解決する。

```javascript
// トークン由来のURLからは決して取得しない。鍵はハードコード/環境変数から。
jwt.verify(token, process.env.JWT_PUBLIC_KEY, { algorithms: ['RS256'] });
```

**なぜ効くのか**：`jku` 注入は「検証鍵の出所をトークンが決められる」ことが根源。出所を固定すれば攻撃者は鍵をすり替えられない。どうしても動的 JWKS が必要なら、取得先ドメインを厳格な許可リスト（前述の混同記法に耐える正規化込み）で縛る。

#### 4. kid はパラメータ化クエリと厳格な形式検証で扱う

```javascript
// パラメータ化クエリで SQLi を防ぐ
const result = await db.query(
  'SELECT secret FROM keys WHERE kid = $1', [kid]
);
```

加えて、`kid` を `^[a-zA-Z0-9_-]{1,64}$` のような**厳格なパターンで検証**し、パス区切り文字（`/`, `..`）を含む値を拒否する。内部で `kid → 鍵` の対応表を保持し、外部入力を鍵探索の生の材料にしない。

**なぜ効くのか**：SQLi もパストラバーサルも「`kid` が信頼できる識別子だ」という誤った前提から生じる。パラメータ化で SQL 構文への混入を、形式検証でファイルパスへの混入を、それぞれ機構的に断てる。

#### 5. alg:none は無条件拒否し、動作を必ず確認する

ライブラリが「防いでいるはず」でも、大文字小文字変種を含めて実際にテストする。aquilax.ai / jsmon.sh はいずれも「明示的に `alg:none` を拒否せよ、そしてテストせよ」と強調する。

#### 6. 依存関係の維持と CVE 監視

古いバージョンほど危険な既定を持つ。ライブラリを最新に保ち、バージョンをピン留めしつつ CVE フィードを監視する。Psychic Signatures のように**ランタイム（JDK）自体のパッチ**が要る例もあるため、言語処理系のセキュリティ更新も対象に含める。

#### 7. トークンの短命化と失効

`exp` を短く（機微な操作では 15 分未満が目安）し、失効・ローテーション機構を用意する。万一偽造されても被害の時間窓を狭められる。

> 出典: JWT Algorithm Confusion Auth Bypass — https://aquilax.ai/blog/jwt-algorithm-confusion-auth-bypass
> 出典: JWT Algorithm Confusion Attacks — https://workos.com/blog/jwt-algorithm-confusion-attacks

---

### 設計上の教訓 ―― なぜこの問題が繰り返されるのか

WorkOS はこれを個別バグではなく**プロトコル設計の一般的失敗の一例**と位置づける。「システムが複数のアルゴリズムをサポートし、かつ受信メッセージがどのアルゴリズムを使うかに影響を及ぼせるとき、それらアルゴリズム間の相互作用が攻撃面を生む」。

JWT の根本的な設計判断ミスは、**アルゴリズム選択を「信頼できないトークンのメタデータ」に埋め込んだ**ことにある。対して COSE（CBOR Object Signing and Encryption）は、アルゴリズムを帯域外（out-of-band）で合意する設計を採り、この種の混同を構造的に避けている。

実装者として持ち帰るべき原則はシンプルだ。**「どう検証するか」を、検証される当のデータに決めさせてはならない**。アルゴリズムも鍵の出所も鍵の識別子も、すべてサーバ側の固定された信頼済み設定から決める。攻撃者が触れるトークンの中身は、あくまで「検証をパスすべき対象」であって、「検証方法の指示書」ではない。この一線を守ることが、アルゴリズム混同の全クラスに対する最も確実な防波堤である。

> 出典: JWT Algorithm Confusion Attacks — https://workos.com/blog/jwt-algorithm-confusion-attacks
