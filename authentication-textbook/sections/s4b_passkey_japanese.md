## パスキー実装ミスとCVE-2025-26788（日本語）

パスキー（Passkey）は「フィッシングに強い、パスワード不要の認証」として急速に普及しました。暗号の部分（公開鍵署名）は確かに強固です。しかし、**Relying Party（RP: パスキーでログインさせる側のWebサービス／サーバ）** が署名の結果を「どのユーザーのログインとして扱うか」を決めるロジックはアプリ側の実装です。ここを間違えると、暗号がいくら強くてもアカウント乗っ取りが起こります。

本節では、GMO Flatt Security が公開した2本の日本語記事を軸に、次の2点を学びます。

1. RP実装で起こりがちな9つのリスク項目（どの値を、何と突き合わせるべきか）
2. その典型例である実在のCVE、**CVE-2025-26788（StrongKey FIDO Server 4.10.0〜4.15.0、4.15.1で修正）** のコードレベルの原因

どちらも「検証の抜け」の話です。攻撃手法を覚えるより、**サーバが信じてよい値と信じてはいけない値を区別する**という設計の視点で読み進めてください。

---

### 前提知識: 登録と認証で何が行き来するか

記事は W3C WebAuthn Level 3（2025年5月時点の Working Draft）を参照しています。まず用語を整理します。

| 用語 | 意味 |
|---|---|
| 認証器（Authenticator） | 秘密鍵を保持し署名する装置・ソフトウェア。スマホやOSのパスワードマネージャ、セキュリティキーなど |
| Credential ID | 認証器が鍵ペアごとに付ける識別子。RPはこれで「どの公開鍵で検証するか」を引く |
| challenge | RPが毎回発行する使い捨ての乱数。リプレイ（使い回し）防止用 |
| clientDataJSON | ブラウザが作るJSON。`type`、`challenge`、`origin`（実際にアクセスしているサイト）などが入る |
| authenticatorData | 認証器が作るバイナリ。`rpIdHash`（RP IDのSHA-256）、フラグ（UP/UV）、署名カウンタなどが入る |
| userHandle | 登録時にRPが渡したユーザーID。Discoverable Credential（下記）の認証で返ってくる |
| Discoverable Credential | 認証器側にユーザー情報が保存され、**ユーザー名を入力せずに**アカウントを選べる資格情報。いわゆる「パスキー」 |
| Non Discoverable Credential | 先にユーザー名を入力させ、RPがそのユーザーのCredential ID一覧（`allowCredentials`）を返して認証器に使わせる従来型の方式 |

**登録（Registration）の流れ**

1. RPバックエンドがchallengeを含む登録オプションを生成する
2. クライアント（ブラウザ）が認証器にchallengeを渡す
3. 認証器が鍵ペアを生成し、ユーザーは生体認証などで本人確認をする
4. Credential IDと公開鍵がRPに送られる
5. RPがchallenge等を検証し、**「このCredential ID／公開鍵はこのユーザーのもの」**としてDBに保存する

**認証（Authentication）の流れ**

1. RPバックエンドがchallengeを含む認証オプションを生成する
2. クライアントが認証器にchallengeを渡す
3. ユーザーがパスキーを選び、本人確認をする
4. 認証器が `authenticatorData ‖ SHA-256(clientDataJSON)` に秘密鍵で署名した**アサーション**（認証応答）を返す
5. RPはCredential IDから公開鍵を引いて署名を検証し、**ユーザーを特定して**セッションを発行する

大事なのは手順5です。「署名が正しい」ことは「このCredential IDの秘密鍵を持つ者が今このchallengeに署名した」ことしか意味しません。**それが誰のアカウントへのログインなのか**は、RPがDB上の紐付けで判断する必要があります。後半のリスク（Credential ID重複、userHandle検証、フロー混在）は、どれもここの判断ミスです。

---

### 9つのリスク項目（Passkey認証の実装ミス）

#### 1. 署名の検証不備

**何が問題か**: アサーションの `signature` を検証していない、または検証方法が間違っている。

**仕組み**: 認証器は `authenticatorData` と `clientDataJSON` のハッシュを連結したバイト列に、Credential IDに対応する秘密鍵で署名します。RPは同じバイト列を組み立て、登録時に保存した公開鍵で検証しなければなりません。記事では SimpleWebAuthn（TypeScript）の内部実装が例として示されています。

```javascript
const signatureBase = isoUint8Array.concat([authDataBuffer, clientDataHash]);
const signature = isoBase64URL.toBuffer(assertionResponse.signature);
const verified = await verifySignature({
  signature,
  data: signatureBase,
  credentialPublicKey: credential.publicKey,
});
```

**なぜ連結するのか**: `authenticatorData` だけに署名させると、`clientDataJSON` に入っているchallengeやoriginを差し替えられてしまいます。`clientDataHash` を署名対象に含めることで、「どのサイトで、どのchallengeに対する応答か」まで改ざんできなくなります。署名検証をしない、あるいはスキップできる分岐がある実装では、攻撃者が作った偽のアサーションがそのまま通り、不正ログインにつながります。

**対策**: `signature` を、**DBに保存したCredential IDに紐づく公開鍵**で必ず検証する。クライアントから送られてきた公開鍵を使ってはいけません。

#### 2. チャレンジの検証不備

**何が問題か**: RPが発行したchallengeと、`clientDataJSON` 内のchallengeが厳密に一致するかを確かめていない。

**仕組み**: challengeはリプレイ攻撃を防ぐための一意でランダムな値です。RPはこれをセッションに紐づけて保存し、応答を受け取ったときに照合します。記事の例（SimpleWebAuthnを使うサンプル）は次のとおりです。

```javascript
const expectedChallenge = req.session.currentChallenge;
const opts = {
  response: body,
  expectedChallenge: `${expectedChallenge}`,
  expectedOrigin,
  expectedRPID: rpID,
  requireUserVerification: false,
};
verification = await verifyRegistrationResponse(opts);
```

`expectedChallenge` を**クライアントから送られた値ではなく、サーバ側セッションの値**から取っている点が要点です。クライアントが送ってきた値と比較しても、攻撃者は両方をそろえて送れるので意味がありません。

**影響**: challengeを照合しないと、過去に盗聴・取得したアサーションを再送するだけでログインできてしまいます（リプレイ攻撃）。

**対策**: challengeはセッションに保存し、検証が終わったら**すぐ無効化する**（1回しか使えないようにする）。

> 補足: サンプル中の `requireUserVerification: false` は「生体認証やPINによる本人確認（UVフラグ）を必須にしない」設定です。パスキーを単独の認証要素として使うなら、通常は `true` にしてUVを必須にすることを検討してください（筆者による一般的な補足）。

#### 3. チャレンジの安全性

**何が問題か**: challengeが予測できる、または使い回されている。

**仕組み**: 予測できるchallengeだと、攻撃者は被害者の認証器に事前に署名させておいた応答を後で使えます。仕様では**最低16バイト**のランダム値が推奨されています。記事では go-webauthn/webauthn（Go）の実装が紹介されています。

```go
const ChallengeLength = 32
func CreateChallenge() (challenge URLEncodedBase64, err error) {
    challenge = make([]byte, ChallengeLength)
    if _, err = rand.Read(challenge); err != nil {
        return nil, err
    }
    return challenge, nil
}
```

ここでの `rand` は `crypto/rand`（暗号論的擬似乱数生成器、CSPRNG）で、長さは32バイトと推奨値より余裕があります。`math/rand` や時刻・連番から作った値は使ってはいけません。

#### 4. Credential IDの重複検証不備

**何が問題か**: 登録時に、新しいCredential IDがすでに別のユーザーに登録されていないかを確かめていない。

**攻撃の流れ**（記事の説明に基づく）:

1. 攻撃者が被害者のCredential IDと公開鍵を何らかの方法で入手する（Credential IDや公開鍵は秘密情報ではない）
2. 攻撃者は自分のアカウントの登録リクエストに、そのCredential IDと公開鍵を入れて送る。重複チェックがないので登録が通る
3. 被害者がいつも通りパスキーでログインする。認証器は正しい署名を返す
4. RPがCredential IDでDBを引くと、攻撃者アカウントに紐づくレコードが当たる
5. **被害者が攻撃者のアカウントにログインさせられる**

「ログインさせられるだけなら被害はない」と思うかもしれませんが、被害者が気づかずに住所やカード情報、機密ファイルなどを入力・アップロードすれば、それは攻撃者のアカウントに保存されます。アカウント乗っ取りや個人情報の漏えいにつながる、いわゆる**ログインCSRF**型の被害です。

**なぜ起きるか**: 攻撃者は被害者の秘密鍵を持っていないので、本来は正しい署名付きの登録応答を作れないように見えます。しかし、登録時のアテステーション（認証器の出自証明）を検証しない（`none`）RPが多いため、登録リクエストの中身を攻撃者が自由に組み立てられるのが実情です。

**対策**: 登録時にCredential IDの重複をDBで厳密に確認し、重複していれば拒否する。DBの一意制約（UNIQUE）も併用すると確実です（WebAuthn仕様の登録手順にも「Credential IDが他ユーザーに登録済みなら登録を失敗させるべき」という旨の手順があります）。

#### 5. オリジン・RP IDの検証不備／関連オリジンの設定不備

**何が問題か**: 許可していないオリジンやRP IDからの応答を受け入れてしまう。または「関連オリジンリクエスト」の設定が広すぎる。

**仕組み**: RP IDはドメイン名で、通常はオリジンのeTLD+1（`example.co.jp` のような登録可能ドメイン）かそのサブドメインです。パスキーはRP IDに紐づくので、別ドメインのフィッシングサイトでは使えません。これがパスキーのフィッシング耐性の根拠です。ただし、ブラウザの制約を回避できる環境（ネイティブアプリ、細工されたクライアントなど）もあるため、**サーバ側でも**次の2点を確認する必要があります。

- `clientDataJSON.origin` が許可リストに含まれているか
- `authenticatorData.rpIdHash` が、自社のRP IDのSHA-256と一致するか

**関連オリジンリクエスト（Related Origin Requests）**: 記事では `amazon.co.jp` と `amazon.com` のように、別ドメインで同じサービスを運用する例が挙げられています。この仕組みを使うと、別ドメイン間で同じパスキーを使えます。設定を誤ると、自社が管理していないオリジンにパスキーの利用を許してしまいます。

（以下は一般知識に基づく補足です）関連オリジンは、RP IDのドメインの `https://<RP ID>/.well-known/webauthn` に、許可するオリジンの一覧をJSONで置く方式です。

```json
{
  "origins": [
    "https://example.co.jp",
    "https://example.de"
  ]
}
```

このリストに入れたオリジンは、RP IDのパスキーを使えます。第三者のドメインや、期限切れで取られる可能性のあるドメイン、ユーザーがコンテンツを置けるドメインは入れないでください。

**対策**: origin検証とrpIdHash検証を両方行う。関連オリジンは自社が確実に管理するリソースだけに限定する。

#### 6. 安全でないフォールバック処理

**何が問題か**: パスキーを紛失したときのアカウント復旧フローで、本人確認が弱い。

**なぜ重要か**: 攻撃者は強固なパスキー認証そのものを破る必要はありません。**最も弱い入口**を使えばよいのです。たとえば「ユーザー名を入力するだけでパスキーを再登録できる」「SMS一本で復旧できる」ようなフローがあれば、パスキーの安全性はそこまで下がります。

**対策**: 復旧対象のアカウントに紐づくメールアドレスへリカバリーコードを送って検証するなど、確実に本人確認をする。復旧後に既存パスキーの一覧を表示して通知する、なども有効です。

#### 7. ユーザーの検証不備（userHandleとCredential IDの紐付け）

**何が問題か**: アサーションの `userHandle` で特定したユーザーが、署名検証に使ったCredential IDを**本当に持っているか**を確かめていない。

**仕組み**: Discoverable Credentialの認証では、認証器が `userHandle`（登録時のユーザーID）を返します。RPがこの `userHandle` だけでユーザーを決め、Credential IDとの関係を確かめないと、次の攻撃が成立します。

1. 攻撃者は**自分の**パスキーで正しく署名したアサーションを作る
2. その中の `userHandle` を被害者のユーザーIDに書き換える（`userHandle` は署名対象外。`authenticatorData` にも `clientDataJSON` にも含まれないため、書き換えても署名は壊れない）
3. RPは攻撃者のCredential IDで署名を検証する（正しいので成功）
4. RPは `userHandle` から被害者を特定し、Credential IDとの関係を確かめない
5. **被害者のセッションが発行される**

**なぜ起きるか**: 「署名が正しい＝その人だ」という思い込みです。署名が証明するのは「Credential IDの持ち主」だけで、`userHandle` は単なる自己申告です。

**対策（3段階の検証）**:

1. Credential IDに紐づく公開鍵で署名を検証する
2. `userHandle` が含まれていることを確認する（Discoverableフローの場合）
3. `userHandle` で特定したユーザーが、そのCredential IDを保有していることを確認する

（以下は筆者による実装例のイメージです）

```javascript
// credentialId からDBの資格情報レコードを引く
const cred = await db.credentials.findByCredentialId(assertion.id);
if (!cred) throw new Error('unknown credential');

// 署名検証（公開鍵は必ずDBの値を使う）
const { verified } = await verifyAuthenticationResponse({
  response: assertion,
  expectedChallenge: req.session.currentChallenge,
  expectedOrigin,
  expectedRPID: rpID,
  credential: { id: cred.id, publicKey: cred.publicKey, counter: cred.counter },
  requireUserVerification: true,
});
if (!verified) throw new Error('bad signature');

// userHandle と Credential の所有者が一致するか
const userHandle = assertion.response.userHandle;
if (!userHandle || userHandle !== cred.userId) throw new Error('user mismatch');

// ログインさせるのは「cred.userId」＝DB上の所有者
req.session.userId = cred.userId;
```

最後の行が要点です。**ログインさせるユーザーは、DB上でCredential IDを所有しているユーザー**にします。クライアントから来た識別子を採用してはいけません。

#### 8. Non Discoverable Credentialのフローとの混在（→ CVE-2025-26788）

**何が問題か**: 「ユーザー名を入力するフロー（Non Discoverable）」と「ユーザー名を入力しないフロー（Discoverable＝パスキー）」の両方を持つRPで、**署名検証に使ったCredential ID**と、**最初にユーザー名で指定されたユーザー**の関係を確かめていない。

**攻撃の流れ**:

```
攻撃者が被害者のユーザー名で認証を開始
→ RPが被害者に紐づくCredential ID（allowCredentials）を返す
→ 攻撃者がそれを自分のCredential IDに書き換える
→ RPは攻撃者のCredential IDの公開鍵で署名を検証する（成功）
→ RPは最初に指定されたユーザー名（被害者）でセッションを発行する
```

リスク7の「別の入口」版です。リスク7では `userHandle` が偽の識別子でしたが、ここでは**最初に入力したユーザー名**が偽の識別子になります。実例がCVE-2025-26788で、後半で詳しく見ます。

**対策**: ユーザー名を指定するフローでは、署名検証に使ったCredential IDを、指定されたユーザーが保有しているかを必ず確認する。

#### 9. アカウント登録状態の漏洩

**何が問題か**: Non Discoverable Credentialフローで、あるユーザーがパスキーを登録しているかどうか（あるいはユーザーが存在するかどうか）が外から分かってしまう。

**具体例**: ユーザー名を入れて認証オプションを要求したときの応答が、登録の有無で変わります。

```json
// UserAがPasskey登録済みの応答
{
  "publicKey": {
    "challenge": "...",
    "allowCredentials": [{"type": "public-key", "id": "..."}]
  }
}

// UserBがPasskey未登録の応答
{
  "publicKey": {
    "challenge": "...",
    "allowCredentials": []
  }
}
```

`allowCredentials` が空かどうかで、ユーザーの存在やパスキー登録状況を推測できます（ユーザー列挙: アカウントの有無を外部から調べられる状態）。パスキー未登録のユーザーはパスワードなど弱い方式を使っていると推測できるため、攻撃対象の絞り込みに使われます。

**対策**: ユーザーが存在しない場合やパスキー未登録の場合でも、**ランダムでもっともらしいCredential ID**を `allowCredentials` に入れて応答する。

（以下は一般知識に基づく補足です）ダミーIDを毎回ランダムに作ると、同じユーザー名で2回問い合わせたときに値が変わるので、やはり「偽物」と見分けられてしまいます。**サーバ秘密鍵を使ったHMAC（ユーザー名）** のように、ユーザー名ごとに一定の値を返す方法が一般的です。長さや件数も、実際の登録済みユーザーの応答と区別できないようにそろえてください。

---

> 出典: Passkey認証の実装ミスに起因する脆弱性・セキュリティリスク（GMO Flatt Security Blog、2025年6月24日公開） — https://blog.flatt.tech/entry/passkey_security

---

### CVE-2025-26788: StrongKey FIDO Serverにおけるアカウント乗っ取り

#### 概要

| 項目 | 内容 |
|---|---|
| 製品 | StrongKey FIDO Server（オープンソースのFIDO2サーバ） |
| 影響バージョン | 4.10.0 〜 4.15.0 |
| 修正バージョン | 4.15.1 |
| 種類 | 認証フロー混在による認証バイパス／アカウント乗っ取り |
| 記事公開 | 2025年8月5日（GMO Flatt Security） |

上のリスク8（Non Discoverableフローとの混在）の実例です。攻撃者は**被害者のユーザー名を知っていて、自分のパスキーを持っていれば**、被害者としてログインできました。被害者の秘密鍵は不要です。

#### 根本原因の3要素

1. **認証器とユーザーの紐付け不備**: Credential IDだけで公開鍵を検索し、そのCredentialを当該ユーザーが持っているかを確認していなかった
2. **フロー判定をクライアント入力で行っている**: `username` パラメータの有無で「Discoverableか否か」を決め、その結果をセッションに保存していた
3. **署名検証と「誰としてログインさせるか」が分離している**: 署名は攻撃者のCredentialで検証しているのに、ログインには最初の `username` を使っていた

それぞれをコードで見ます。

#### ステップ1: 認証フローの判定

```java
Boolean discoverableCred = Boolean.FALSE;
if (preauthpayload.containsKey("username")) {
    if (!preauthpayload.isNull("username")) {
        if (preauthpayload.getString("username").trim().isEmpty()) {
            discoverableCred = Boolean.TRUE;
        } else {
            pauthreq.setUsername(preauthpayload.getString("username"));
        }
    } else {
        discoverableCred = Boolean.TRUE;
    }
}
```

**読み方**: 事前認証（preauthenticate）リクエストに空でない `username` があれば、`discoverableCred` は `FALSE`（Non Discoverableフロー）のままで、そのユーザー名がリクエストに設定されます。`username` が空または `null` なら `TRUE`（Discoverableフロー）です。

攻撃者が**被害者のユーザー名**を送ると、`discoverableCred = FALSE` と被害者の `username` がセッション側に保存されます。この時点では「被害者のCredential ID一覧を返す」だけなので、まだ問題はありません。

#### ステップ2: 公開鍵の取得と署名検証

脆弱なバージョン（4.15.0）では、アサーションに含まれるCredential ID（コード上は `kh` = key handle）だけで公開鍵を引いていました。

```java
key = getkeybean.getByKH(ID, did, kh);
```

内部のクエリは次のとおりです。

```java
// 脆弱な実装（4.15.0）
Query q = em.createNamedQuery("FidoKeys.findBydidKeyhandle");
q.setParameter("did", did);
q.setParameter("keyhandle", KH);  // Credential IDのみ
```

`did`（ドメインID）とCredential IDだけが検索条件で、**ユーザー名は条件に含まれていません**。そのため、攻撃者がブラウザとサーバの間で `allowCredentials` を自分のCredential IDに書き換えて（あるいは自分のCredential IDを使うようクライアントを細工して）署名させると、次のことが起きます。

- サーバは攻撃者のCredential IDで検索する → 攻撃者の公開鍵が取れる
- アサーションは攻撃者の秘密鍵で署名されている → **検証は成功する**

暗号的には完全に正しい処理です。問題は「その公開鍵が誰のものか」を確認していないことです。

#### ステップ3: ログイン処理

```java
if (!discoverableCred) {
    username = user.getUsername();  // 被害者のusernameが使用される
}
```

Non Discoverableフロー（`discoverableCred = FALSE`）では、**セッションに保存されたユーザー名（被害者）**を使って、被害者としてのJWT（ログイントークン）が発行されます。ステップ2で検証したCredentialの持ち主（攻撃者）は、ここでは使われません。

#### 攻撃の全体像

| ステップ | 内容 |
|---|---|
| 1 | 攻撃者が被害者のユーザー名でログインを開始する |
| 2 | サーバが被害者のCredential IDを返す |
| 3 | 攻撃者がレスポンスを書き換え、自分のCredential IDを指定する |
| 4 | 認証器が攻撃者のCredential IDで署名を作る |
| 5 | サーバが攻撃者のCredential IDから公開鍵を取り、署名を検証する（成功） |
| 6 | サーバが被害者のユーザー名でセッション／JWTを発行する |
| 7 | 攻撃者が被害者アカウントとしてログインした状態になる |

影響は、アカウント乗っ取り、被害者の権限での操作、個人情報へのアクセスです。

#### 修正内容（4.15.1）

```java
// 修正版（4.15.1）
if (!discoverableCred) {
    key = getkeybean.getByUsernameCredentialId(ID, did, username, credentialId);
}

// 新しいメソッド
Query q = em.createNamedQuery("FidoKeys.findByUsernameKH");
q.setParameter("username", username);  // ユーザー名を追加条件に
q.setParameter("did", did);
q.setParameter("keyhandle", CredentialId);
```

**なぜこれで直るのか**: Non Discoverableフローでは、**ユーザー名とCredential IDの両方が一致するレコード**しか公開鍵として取得されなくなりました。攻撃者のCredential IDは被害者のユーザー名では見つからないので、公開鍵が取れず、認証は失敗します。つまり、「署名を検証する鍵」と「ログインさせるユーザー」が同じDBレコードに縛られたことになります。

#### 記事が示す対策

1. StrongKey FIDO Serverを **4.15.1以上**に上げる
2. パスキー認証を実装・診断するときは、次を確認する
   - Credential IDとユーザーの紐付けを必ず検証する
   - Non Discoverable Credentialでは、`username` と `credentialId` の両方を検索条件に入れる
   - 署名検証後のユーザー特定は、認証器から来た情報ではなく、**サーバ側のセッション情報**（とDB上の所有関係）を使う

> 出典: Passkey認証におけるアカウント乗っ取り脆弱性 CVE-2025-26788 の解説（GMO Flatt Security Blog、2025年8月5日公開） — https://blog.flatt.tech/entry/passkey_security_2

---

### まとめ: 「署名が通った」の先を設計する

2本の記事に共通する教訓は、**署名検証は認証の半分でしかない**ということです。残りの半分は「その署名を誰のログインとして扱うか」を決めることで、それはRPのDBとセッションの問題です。

| 確認すべき紐付け | 抜けると起きること | 該当リスク |
|---|---|---|
| challenge ↔ セッション | リプレイ | 2, 3 |
| origin / rpIdHash ↔ 自社のRP | 他サイトでのアサーション悪用 | 5 |
| Credential ID ↔ 所有ユーザー（一意） | 被害者を攻撃者アカウントにログインさせる | 4 |
| userHandle ↔ Credential IDの所有者 | userHandle書き換えでなりすまし | 7 |
| 入力ユーザー名 ↔ Credential IDの所有者 | CVE-2025-26788型の乗っ取り | 8 |
| 復旧フローの本人確認 | 弱い入口からの乗っ取り | 6 |
| 応答の均一性 | ユーザー列挙 | 9 |

防御側のチェックリストとしては、次の1行に集約できます。

> **ログインさせるユーザーは、「署名検証に使った公開鍵を、DB上で所有しているユーザー」だけにする。クライアントから来るユーザー名・userHandle・フロー種別は、その結果と一致するかを確かめる材料にとどめる。**

自前でWebAuthnを実装するより、SimpleWebAuthn（TypeScript）や go-webauthn/webauthn（Go）のような実績のあるライブラリを使うのが基本です。ただし、ライブラリが面倒を見るのは主に署名・challenge・origin・rpIdHashの検証です。**Credential IDとユーザーの紐付け（リスク4・7・8）は、アプリ側のDB設計とログイン処理の責任**として残ることを忘れないでください。検証は自分が管理するテスト環境で行い、許可のない実在サービスには試さないでください。
