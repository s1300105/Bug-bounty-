# 第4章 WebAuthn／パスキー（FIDO2）


## WebAuthn/FIDO2/パスキーの仕組み

### FIDO2という枠組み全体像

FIDO2は単一の技術ではなく、2つの仕様が組み合わさった「枠組み」である。

- **WebAuthn**（Web Authentication API）: W3C標準のブラウザAPI。`navigator.credentials.create()`（登録）と`navigator.credentials.get()`（認証）という2つのJavaScript API経由で、Webアプリケーションが公開鍵認証情報を作成・使用できるようにする
- **CTAP2**（Client to Authenticator Protocol 2）: ブラウザ（クライアント）とAuthenticator（認証器、鍵ペアを保管・署名する物理/論理デバイス）の間の通信プロトコル。USB、NFC、BLE（Bluetooth Low Energy）などのトランスポートに対応する

この2つが組み合わさることで、「認証はAuthenticatorが保持する秘密鍵に紐付いた者だけが完了できる」という保証が成立する。パスキー（Passkey）は、この FIDO2/WebAuthn の認証情報のうち、特に**複数デバイス間で同期可能な形態**を指すマーケティング用語であり、技術的にはWebAuthnの公開鍵クレデンシャルそのものである。

> 出典: Alf Løkken — Understanding FIDO2, WebAuthn, and Passkeys — https://alflokken.github.io/posts/understanding-fido2-passkeys/

### 公開鍵暗号による認証の原理

パスワード認証との本質的な違いは、**サーバーが検証に使う情報（公開鍵）を知っていても、それだけでは攻撃者はログインできない**という非対称性にある。パスワードは「サーバーが持つハッシュと同じ値を入力すれば通る」ため、サーバー側のDB漏洩がそのまま不正ログインに直結する。一方WebAuthnでは以下の原則が成立する。

- Authenticatorがアカウントごとに一意の鍵ペア（公開鍵・秘密鍵）を生成する
- **秘密鍵はAuthenticatorの外に一切出ない**（ハードウェアセキュリティモジュールやSecure Enclave内に留まる、あるいは同期パスキーの場合は暗号化された状態でのみクラウドと往復する）
- サーバー（Relying Party、以下RP）が保管するのは公開鍵のみ
- 認証時、RPが発行した一度限りのチャレンジ（乱数)に対してAuthenticatorが秘密鍵で署名し、RPは保管済みの公開鍵でその署名を検証する

この設計により、RPのデータベースが丸ごと漏洩しても、攻撃者は「公開鍵」しか手に入らず、秘密鍵を要する署名を偽造できない。パスワード認証で常につきまとう「サーバー側の秘密の陳腐化」問題が構造的に消える。

### 登録フロー（Registration Ceremony）

WebAuthnの登録は次の手順で進む。

1. ブラウザがRPのサーバーへ登録開始をリクエストする
2. サーバーは一意のチャレンジ（乱数）と、RP情報・ユーザー情報・許容する署名アルゴリズム（`pubKeyCredParams`）を含むオプションを生成し返す
3. ブラウザが`navigator.credentials.create()`を呼び出し、これらのオプションをAuthenticatorへ渡す
4. Authenticatorがユーザー検証（生体認証・PIN入力など）を行った上で、新しい鍵ペアを生成する
5. Authenticatorは公開鍵・Credential ID（この鍵ペアを識別するID）・Attestation（認証書、Authenticator自身の真正性を証明する署名付きデータ）を含む応答を返す
6. ブラウザはこの応答をRPサーバーへ送信し、サーバーは検証の上、公開鍵とCredential IDをユーザーアカウントに紐付けて保存する

Attestationには**AAGUID**（Authenticator Attestation GUID、Authenticatorのモデルを識別する固有ID）が含まれ、RPはこれをFIDO Metadata Service（FIDO Allianceが公開する、認定済みAuthenticatorモデルの一覧・メタデータ）と照合することで、「本当に認定を受けたハードウェアか」を確認できる。ただし一般消費者向けサービスでは、Attestation検証の実装コストと運用の複雑さ（証明書チェーンの管理、メタデータの更新など）がセキュリティ上の利益を上回りやすいため、登録時に`attestation: "none"`を指定し、Attestation検証自体を省略するのが実務上の標準的な判断とされる。金融機関や高セキュリティ要件を持つエンタープライズ向けサービスでは、この判断は逆転する。

```js
// ブラウザ側: 登録の呼び出し例(概念的な最小構成)
const credential = await navigator.credentials.create({
  publicKey: {
    challenge: serverChallenge,       // サーバーが発行した乱数(Uint8Array)
    rp: { id: "example.com", name: "Example Corp" },
    user: { id: userIdBytes, name: "alice@example.com", displayName: "Alice" },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },   // ES256 (推奨)
      { type: "public-key", alg: -257 }, // RS256 (互換性のため)
    ],
    attestation: "none",
  },
});
```

なぜ`pubKeyCredParams`をサーバーが明示的に列挙するのか。これは「登録時にサーバーが許可していないアルゴリズムでの署名を、検証時に受理してしまう」というアルゴリズム混同の脆弱性を防ぐためである。検証実装は登録時に受理したアルゴリズムのみを検証時にも許可しなければならない。2048ビット未満のRSA鍵や、非推奨の弱いアルゴリズムを受理してしまうと、署名偽造の計算コストが現実的な範囲まで下がる可能性がある。ES256（楕円曲線）またはEdDSAが推奨される。

> 出典: AquilaX — Passkeys and WebAuthn Security Deep Dive — https://aquilax.ai/blog/passkeys-webauthn-security-deep-dive

### 認証フロー（Authentication Ceremony）

登録済みユーザーがログインする際の流れは以下の通りである。

1. サーバーが一度限りのチャレンジを生成し、ブラウザへ送る
2. ブラウザが`navigator.credentials.get()`を呼び出し、チャレンジをAuthenticatorへ渡す
3. Authenticatorがユーザー検証を行った上で、保存済みの秘密鍵でチャレンジおよびクライアントデータのハッシュに署名する
4. ブラウザは署名済みのアサーション（Assertion、認証応答）をサーバーへ送信する
5. サーバーは保存済みの公開鍵でこの署名を検証し、成功すればログインを許可する

サーバー側の検証で確認すべき項目は、実務上のチェックリストとして次のようにまとめられる。

1. 使用されたアルゴリズムが登録時に許可したものと一致するか
2. `origin`が期待するオリジン（例: `https://example.com`）と一致するか
3. `rpId`のハッシュ（SHA-256）が期待するRP IDのハッシュと一致するか
4. チャレンジが自分が発行したものと一致し、かつ一度きりの使用であるか
5. 署名が保存済みの公開鍵で正しく検証できるか
6. 署名カウンター（後述）が前回より増加しているか
7. Credential IDから引いた公開鍵が、まさにログインを試みているそのユーザーに紐付いているか

このうち7番目は見落とされがちだが重要である。Credential IDをユーザーに紐付けず「データベース全体から一致するものを探す」実装だと、**別ユーザーの正当な認証情報のアサーションを、なりすましたいユーザーのものとして誤って受理してしまう**クレデンシャル置換攻撃(credential substitution attack)が成立し得る。Credential IDの検索は必ず「そのユーザーが登録済みのCredential ID一覧」の範囲内で行う必要がある。

> 出典: AquilaX — Passkeys and WebAuthn Security Deep Dive — https://aquilax.ai/blog/passkeys-webauthn-security-deep-dive

### RP ID・オリジン検証とフィッシング耐性の原理

WebAuthnがパスワードやSMS OTP、TOTPなどの従来型多要素認証（tMFA）と決定的に異なるのは、**認証情報が暗号的にドメインへ縛られている**点である。仕組みは次の通りである。

- 登録・認証のいずれの操作でも、ブラウザは現在のページのオリジン（例: `https://example.com`）と、RPが指定した`rpId`（RPのドメイン、例: `example.com`）を検証し、`clientDataJSON`という署名対象データの一部として埋め込む
- Authenticatorは、渡された`rpId`のSHA-256ハッシュを、登録時に記録した`rpId`ハッシュと照合してから署名を行う
- ブラウザ自体も、現在表示中のページのオリジンと不一致な`rpId`が指定された場合、その場でAPI呼び出しを失敗させる

攻撃者が`login-example-corn.com`のような紛らわしいドメインでフィッシングサイトを構築しても、そのページ上で`navigator.credentials.get()`を呼び出した場合、ブラウザが渡す`origin`は`https://login-example-corn.com`になる。Authenticatorが生成する署名はこのオリジンに紐付けられ、正規サーバー（`example.com`）側の検証では`origin`不一致により拒否される。ユーザーが「偽サイトと信じて」操作しても、暗号学的な検証がドメインの真正性を強制するため、**ユーザーの注意力に依存しないフィッシング耐性**が成立する。これはパスワードやTOTPコードのように「値そのものをコピー&ペーストできる」認証情報には原理的に実現できない性質である。

> "A fake login page cannot receive a valid assertion because it has the wrong origin."
> 出典: AquilaX — Passkeys and WebAuthn Security Deep Dive — https://aquilax.ai/blog/passkeys-webauthn-security-deep-dive

ただし、この耐性には明確な限界がある。フィッシング耐性が防ぐのは「認証情報そのものの窃取・リプレイ」であり、**認証成功後に発行されたセッションクッキーやアクセストークンの窃取・再利用（AitM/Adversary-in-the-Middleによるプロキシ型フィッシングなど）は別の脅威**として残る。この点は防御を設計する上で誤解しやすく、「WebAuthnを導入すればアカウント乗っ取りが根絶する」という理解は誤りである。セッション管理・トークンの結合（Token Binding、DPoPなど）は別途対策が必要になる。

> 出典: NCSC — Comparing traditional and FIDO2 credentials for personal use — https://www.ncsc.gov.uk/paper/traditional-user-and-fido2-credentials-personal-use

### Authenticatorの分類

**プラットフォーム型Authenticator**は、OSやデバイスに内蔵される。Windows Hello、macOS/iOSのSecure Enclave経由のTouch ID/Face ID、AndroidのStrongBoxなどが該当する。デバイスのロック解除機構（生体認証・PINなど)を通じてユーザー検証が行われ、鍵はデバイス固有のストレージか、ベンダーが管理するバックアップ機構に保存される。

**ローミング型Authenticator**は、YubiKeyなどの独立したハードウェアセキュリティキーである。USB・NFC・BLEで複数のデバイスに接続でき、CTAP2インターフェース経由で通信する。鍵の生成・保管・署名の全プロセスをAuthenticator自身が完結して制御するため、ホストPCがマルウェアに感染していても秘密鍵は抽出されない。

**User Presence（UP）**と**User Verification（UV）**という2つのフラグの区別も重要である。UPは「（誰であれ）人間が物理的に操作した」ことの確認（ボタンタッチなど）であり、UVは「その人物が正当な所有者であること」の確認（生体認証・PIN照合など）である。指紋スキャンのように両方を同時に満たす操作もあれば、単純なタッチのみでUVを満たさない構成もある。RPがどちらを要求するかによって、認証の強度（単要素相当かMFA相当か）が変わる。

> 出典: Alf Løkken — Understanding FIDO2, WebAuthn, and Passkeys — https://alflokken.github.io/posts/understanding-fido2-passkeys/

### 同期パスキー（Syncable Passkeys）とクロスデバイス認証

近年主流になっているのが、プラットフォームAuthenticatorが生成した秘密鍵を、iCloud KeychainやGoogle Password ManagerなどのクラウドサービスでE2E暗号化した状態で複数デバイス間に同期する**同期パスキー**である。これにより「Authenticatorを紛失したらアカウントに二度とログインできない」という単一デバイス依存のリスクが緩和される。

この方式のセキュリティ上の要点は、**フィッシング耐性の性質は保持されたまま**、全体としてのセキュリティは「その認証情報マネージャー（Appleアカウント、Googleアカウントなど）自体の保護強度に依存する」ようになる点である。つまり同期パスキーを使う場合、そのクラウドアカウント自体を強固な認証（できればそれ自体もFIDO2/パスキー）で保護しておく必要がある。エンタープライズ環境では、この同期による「秘密鍵のクラウド経由の拡散」を許容できないケースがあり、同期を無効化しデバイス固定のAuthenticatorのみを許可する運用が推奨されることがある。

**ハイブリッド転送（クロスデバイス認証）**は、スマートフォンに保存されたパスキーを、ログイン画面が表示されているPC/ラップトップから使う仕組みである。手順は次の通り。

1. PC側でQRコードが表示される
2. スマートフォンでこのQRコードを読み取る
3. BLEを用いて両デバイスの物理的近接性を検証する（同じ部屋にいることの確認であり、遠隔からの中継攻撃を防ぐ意図がある)
4. 近接性確認後、暗号化されたトンネル経由でCTAP2メッセージがスマートフォンとPCブラウザ間で中継される。このトンネルを仲介するクラウドサービス自体は、CTAP2トラフィックの中身を復号できない

> 出典: Alf Løkken — Understanding FIDO2, WebAuthn, and Passkeys — https://alflokken.github.io/posts/understanding-fido2-passkeys/

### 署名カウンターの意味と実装上の落とし穴

WebAuthnのAuthenticatorデータには署名カウンター（signature counter）というフィールドが含まれ、認証のたびに増加することが期待される。RPは「前回保存したカウンター値より、今回の値が大きいか」を検証することで、**Authenticator自体の秘密鍵が複製・クローンされていないか**を検知できる（クローンされた認証器が使われると、カウンターの値が巻き戻ったり同じ値が繰り返されたりする)。

ただしこの検証には注意点がある。Apple Secure EnclaveなどのプラットフォームAuthenticatorの一部実装は、設計上カウンターを常に0のまま返す。これは仕様上正当な挙動であり、「カウンターが増加していない=不正」と機械的に判定するとApple製デバイスの正当な認証を拒否してしまう。実装では「カウンターが0で固定されているAuthenticatorの種別」を区別し、0が継続する場合は検証をスキップまたは別の方式（Authenticatorの種類自体で判断）に切り替える必要がある。

> 出典: AquilaX — Passkeys and WebAuthn Security Deep Dive — https://aquilax.ai/blog/passkeys-webauthn-security-deep-dive

### 従来型MFA（tMFA）との比較

NCSCの分析は、認証情報のライフサイクル（生成・保管・使用・同期・リカバリ）の各段階で、パスワードや従来型多要素認証（SMS OTP、TOTPアプリ、プッシュ通知承認など）とFIDO2クレデンシャルを比較している。結論は明確である。

> "at all stages of a credential's lifecycle, and against all commonly observed attacks, FIDO2 credentials including passkeys are as secure or more secure than all forms of traditional MFA"

攻撃耐性を整理すると次のようになる。

| 攻撃手法 | パスワード単体 | 従来型MFA(SMS/TOTP/プッシュ) | FIDO2/パスキー |
|---|---|---|---|
| AitM(中間者)フィッシング | 常に脆弱 | 常に脆弱(リアルタイムでコード/承認を中継されると突破される) | 原理的に無効化(オリジン結合のため) |
| 認証情報の大量収集(harvesting) | 常に脆弱 | 無効化 | 無効化 |
| MFA疲労攻撃(繰り返しプッシュ通知を送りユーザーに誤承認させる) | 常に脆弱 | 状況により脆弱 | 無効化 |
| デバイス上のマルウェア | 常に脆弱 | 状況により脆弱 | 状況依存(ハードウェアAuthenticatorなら強固) |

この表からもわかるように、SMS OTPやTOTP、プッシュ通知承認といった「値そのものをユーザーが読み上げる・転記する・承認する」形式のMFAは、リアルタイムでの中間者プロキシ攻撃（フィッシングページが正規サイトへのログインをその場で中継し、ユーザーが入力したコードや承認操作をそのまま盗用する手口）に対して脆弱なままである。FIDO2がこれらと構造的に異なるのは、「人間が読み上げて転記できる値」を一切生成せず、暗号署名のやり取りがブラウザとAuthenticator間で完結し、かつその署名がオリジンに縛られている点にある。

> 出典: NCSC — Comparing traditional and FIDO2 credentials for personal use — https://www.ncsc.gov.uk/paper/traditional-user-and-fido2-credentials-personal-use

### RP側の運用上の推奨事項

NCSCとAquilaXの双方が共通して強調するのは、**WebAuthnの暗号学的な強度は、RP側の実装・運用が正しく行われて初めて意味を持つ**という点である。実務上の推奨事項をまとめると以下の通り。

- **XSS対策を徹底する**: WebAuthnの登録・認証フロー自体はJavaScript API経由で行われるため、ページ内にXSS（Cross-Site Scripting、攻撃者が任意のスクリプトを実行できる脆弱性）が存在すると、攻撃者はそのページ上で正規オリジンとして`navigator.credentials.get()`を呼び出せてしまい、オリジン結合による防御が意味をなさなくなる。Content Security PolicyやTrusted Typesの導入が前提となる
- **登録・ログインを同一オリジンに統一する**: サブドメインが分かれている場合、`rpId`の指定を誤ると想定外の範囲でクレデンシャルが有効になったり、逆に正当なリクエストが弾かれたりする
- **公開鍵の削除（クレデンシャルの失効）機能を用意する**: デバイス紛失時にユーザー自身が古いクレデンシャルを無効化できる導線が必要
- **単一デバイスのみのパスキー利用者にはバックアップ手段を推奨する**: 同期しない単一デバイス型パスキーのみに依存すると、デバイス紛失時にアカウントアクセスを完全に失うリスクがある
- **リカバリフローにSMS/メールへのフォールバックを残さない**: リカバリフローが結局SMSやメール、秘密の質問にフォールバックする設計だと、そこがFIDO2で防いだはずのフィッシングやSIMスワップ攻撃の再侵入経路になる。最低2つの認証情報（追加のパスキー、ハードウェアキー、オフラインのリカバリコードなど）を登録させ、それらが揃うまでは従来型リカバリ手段を無効化しないという段階的な移行戦略が推奨される
- **手動実装を避け、検証済みライブラリを使う**: `py_webauthn`（Python/Duo Security）、`@simplewebauthn/server`（Node.js）、`go-webauthn`（Go）、`webauthn-server-core`（Java/Yubico）など、仕様のエッジケース（Attestationフォーマットの差異、カウンター挙動の差異など)を吸収した実装を使うべきであり、署名検証やクライアントデータの照合をゼロから自前実装することは強く非推奨とされる

> 出典: AquilaX — Passkeys and WebAuthn Security Deep Dive — https://aquilax.ai/blog/passkeys-webauthn-security-deep-dive ／ NCSC — Comparing traditional and FIDO2 credentials for personal use — https://www.ncsc.gov.uk/paper/traditional-user-and-fido2-credentials-personal-use

### まとめ

WebAuthn/FIDO2/パスキーの安全性は、「秘密鍵がAuthenticatorの外に出ない」という非対称鍵の原則と、「署名対象データにオリジンが暗号学的に埋め込まれる」というRP ID結合の2点に集約される。この2点が揃って初めて、ユーザーの注意力に依存しないフィッシング耐性が実現する。一方で、この強度はセッション管理やアカウントリカバリフローの設計まで自動的に守ってはくれない。認証後のセッション窃取や、SMS/メールにフォールバックするリカバリ経路は依然として別建てで対策する必要があり、次節以降ではこの「WebAuthn単体では埋まらない部分」を中心とした実装上の落とし穴と防御策を扱う。

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

## パスキーへの攻撃と攻撃対象領域

パスキー（passkey）は「フィッシング耐性のある（phishing-resistant）認証」の代名詞として普及しつつある。その中核である **WebAuthn / FIDO2** は、公開鍵暗号と「オリジン束縛（origin binding）」によって、パスワードやOTPが抱える再利用・中継・フィッシングの問題を原理的に排除する設計になっている。しかし2026年前後の研究は、**暗号そのものは破られていなくても、その周辺の実装（OS・IdP・ブラウザ・パスワードマネージャ）に穴があれば、リプレイ（replay：盗んだ応答の再送）・リレー（relay：中継）・フィッシング類似の攻撃が復活する**ことを繰り返し示した。

本節では、防御者・実装者・ペンテスターの視点から、パスキーの攻撃対象領域（attack surface：攻撃者が触れられる入力・状態・実装の総体）を、プロトコルの挙動レベルで解説する。まず前提として、攻撃を理解するのに不可欠な WebAuthn/FIDO2 のセレモニー（ceremony：登録・認証の一連の手続き）を押さえ、そのうえで3本の資料が示す具体的な攻撃と防御を扱う。

> ⚠️ **一部資料の取得状況**: 本節の主要URLのうち、DSInternals のブログ記事はインデックス（告知）ページで技術的実体が薄く、Dark Reading の記事は自動取得が HTTP 403 でブロックされました。そのため、DSInternals については同ページからリンクされている一次資料（SpecterOps 公開のホワイトペーパー相当の GitHub リポジトリ README・関連報道）を、Dark Reading については同じ研究を扱う一次報道（The Hacker News 等）を併用して内容を再構成しています。各小節末の「出典」を参照してください。該当箇所には未取得の旨を明示します。

---

### 前提知識: WebAuthn/FIDO2 の攻撃対象領域を成す2つのセレモニー

パスキーは2つのセレモニーで動く。**登録（registration＝attestation ceremony）** と **認証（authentication＝assertion ceremony）** である。攻撃はほぼすべて、この2つのどこかで生成される「構造化データ」と「サーバ側検証の抜け」を突く。したがって、まず登場するデータ構造を理解することが、攻撃対象領域の地図になる。

#### clientDataJSON — ブラウザが作る「文脈の証明書」

ブラウザ（正確には WebAuthn クライアント）は、セレモニーごとに `clientDataJSON` というJSONを組み立てる。これが「どのオリジンで、どの種別の、どのチャレンジに対する操作か」を固定する要となる。

```json
{
  "type": "webauthn.create",   // 登録は create、認証は webauthn.get
  "challenge": "b64url(...)",   // サーバが毎回生成する乱数（nonce）
  "origin": "https://webauthn.io",  // 操作を開始した「正確な」オリジン
  "crossOrigin": false
}
```

サーバは受信した `clientDataJSON` を解析し、`SHA256(UTF8(clientDataJSON))` を計算して `clientDataHash` を得る。**なぜこれが効くのか**: `origin` はブラウザが埋める（＝スクリプトが偽装できない値）。攻撃者のフィッシングサイト `attacker.com` 上でセレモニーが走れば `origin` は必ず `https://attacker.com` になり、正規サーバが期待する `https://victim.com` と一致しない。これがオリジン束縛（origin binding）であり、フィッシング耐性の実体である。

#### authenticatorData — 認証器が署名する「事実の申告」

認証器（authenticator：セキュリティキー、Windows Hello、スマホなど）は `authData` を生成する。固定37バイト＋可変部で、次の構造を持つ。

```
rpIdHash (32B) || flags (1B) || signCount (4B) || [attestedCredentialData] || [extensions]
```

- **rpIdHash**: RP ID（例 `example.com`）の SHA-256。どのサイト向けかを固定する。
- **flags（1バイト）**: 認証器が「何をしたか」を主張するビット列。
  - bit0 **UP**（User Presence：ユーザーがそこにいてタッチ等をした）
  - bit2 **UV**（User Verification：PIN/生体で本人確認した）
  - bit6 **AT**（Attested credential data を含む＝登録時）
  - bit7 **ED**（拡張データを含む）
- **signCount**: 署名カウンタ。認証のたびに増える想定の単調増加値。**クローン検出**に使う。
- **attestedCredentialData**（登録時のみ、AT=1）: `AAGUID(16B) || credentialIdLength(2B, big-endian) || credentialId || COSE公開鍵`。**AAGUID** は認証器の機種を表す16バイト識別子。

#### COSE公開鍵とアルゴリズム

公開鍵は COSE（CBOR Object Signing and Encryption）形式のCBORマップで運ばれる。

```
{ 1: kty, 3: alg, -1: crv, -2: x, -3: y }   // EC鍵の例
```

代表的アルゴリズムは **ES256（alg = -7、P-256 ECDSA）** と **EdDSA/Ed25519（alg = -8）**。署名は登録時 `Sign(privKey, authData || clientDataHash)`、認証時も同じく `authData || clientDataHash` を対象に計算される。**この「連結して署名」がセレモニー全体を1つに束ねる**。オリジン（clientDataHash側）とRP・カウンタ（authData側）が同じ署名で保証されるため、片方だけ差し替えると署名が壊れる。

#### 攻撃対象領域の要約

以上から、攻撃者が狙える点は次の4つに集約される。(1) **オリジン検証の抜け**（サーバが `origin` を厳密に照合しない）、(2) **チャレンジの鮮度検証の抜け**（同じ nonce を使い回せる＝リプレイ可能）、(3) **署名カウンタ検証の抜け**（クローン鍵の再利用を検出しない）、(4) **フラグ（UP/UV）の盲信**（アテステーション未検証で認証器の自己申告を信じる）。以降の資料は、この4点が現実の実装でどう破れるかを具体的に示す。

---

### 1. パスキーの偽造 — FIDO2/WebAuthn の攻撃対象領域

Narendar Battula（nArEn）の記事は、**ソフトウェアだけで完全にスクリプト可能な「仮想認証器」を自作**し、FIDO2/WebAuthn のどこがサーバ実装のミスで破れるかを、バイトレベルで実演したものである。原文（Medium）は自動取得が 403 でブロックされたため、同一著者による同一内容のミラー（nullpt.rs）から再構成した。

#### CTAP2 をバイトレベルで再実装する

認証器とブラウザは **CTAP2（Client to Authenticator Protocol 2）** で会話する。USB-HID 上では1フレームが厳密に64バイトで、`CID(4B) || CMD(1B) || DATA(59B)` の形をとる。大きなメッセージは複数フレームに分割され、CMDバイトのbit7で初期フレーム（0x80セット）と継続フレーム（シーケンス0-127）を区別する。

登録は `MakeCredential`（CTAP2 コマンド `0x01`）、認証は `GetAssertion`（`0x02`）で、いずれもCBORマップを送る。例えば `MakeCredential` の要求は概ね次の形になる。

```
{
  1: clientDataHash,                 // ブラウザが計算したハッシュ
  2: { id: "rp.example", name: ... },// RP
  3: { id: user_id, name, displayName },
  4: [pubKeyCredParams（許可アルゴリズム）],
  7: { rk: true, credProtect: 2 }    // rk=常駐鍵, credProtect=2 はUV必須を強制
}
```

**なぜ自作できるのか**: CTAP2 は公開仕様であり、認証器がやることは「鍵で `authData || clientDataHash` に署名して返す」だけ。著者はこの状態機械を純Rustで再実装し、ユーザー提供の PKCS#8 秘密鍵を読み込んで署名を作る。

```rust
let user_key = SigningKey::from_pkcs8_pem(&pem)?;
let signature = user_key.sign(&msg);  // msg = authData || clientDataHash
```

さらに **RFC 6979 の決定的 ECDSA nonce**（`nonce = HMAC_SHA256(key, hash)`）を使うと、同じメッセージに対して署名が**ビット単位で完全に一致**する。これは正規の認証器では起こらない現象で、後述するリプレイ検証の重要性を裏づける（同じチャレンジ＝同じ署名になり得る）。

#### Chrome DevTools Protocol（CDP）による仮想認証器の注入

最も実務的に効くのが、Chrome の内蔵「仮想認証器（Virtual Authenticator）」を **CDP（Chrome DevTools Protocol）** 経由で操る手口である。リモートデバッグを有効にした Chrome に、次の5つのメッセージを送るだけで、物理キーなしに任意の資格情報でサインインできてしまう。

```
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-test
```

```json
// 1) WebAuthn を有効化（UIゲートを緩める）
{ "method": "WebAuthn.enable", "params": { "enableUI": true } }

// 2) 仮想認証器を作成
{ "method": "WebAuthn.addVirtualAuthenticator",
  "params": { "options": { "protocol": "ctap2", "transport": "usb",
                           "hasResidentKey": true, "hasUserVerification": true } } }

// 3) 「タッチ」を自動シミュレート（UP を自動で満たす）
{ "method": "WebAuthn.setAutomaticPresenceSimulation",
  "params": { "authenticatorId": "<id>", "enabled": true } }

// 4) ユーザー検証(UV)を「済んだこと」にする
{ "method": "WebAuthn.setUserVerified",
  "params": { "authenticatorId": "<id>", "isUserVerified": true } }

// 5) 任意の秘密鍵で資格情報を注入
{ "method": "WebAuthn.addCredential",
  "params": { "authenticatorId": "<id>",
    "credential": { "credentialId": "<bytes>", "rpId": "target.com",
                    "privateKey": "<base64 PKCS#8>",
                    "isResidentCredential": true, "signCount": 0 } } }
```

**なぜ通るのか**: これらは本来ブラウザ自動テスト用の機能だが、Chrome の実装は「注入された `privateKey` が `credentialId` に対応するか」を検証しない。UP（存在）と UV（本人確認）は認証器の**自己申告**であり、CDP はそれを丸ごと偽装できる。つまり攻撃者が被害者のセッション内で Chrome を起動できる（あるいはデバッグポートに到達できる）なら、盗んだ・合成した鍵で「本人確認済み・物理タッチ済み」の assertion を量産できる。これは前提節で挙げた「(4) フラグの盲信」を突く典型例である。

#### サーバ側検証の抜け（実装ミスの実例）

著者は、暗号ではなく**RP（Relying Party：サービス側）の検証手順の欠落**こそが本丸だと強調する。

- **署名カウンタ未検証**: **GitHub は `signCount: 0` の assertion を無期限に受け入れる**（記事の指摘）。RP が signCount 単調増加もアテステーション連鎖も検証しなければ、盗んだ応答の再送（リプレイ）が容易になる。防御は「初回以降 `new_count > stored_count` を必須にする」。
- **アテステーション未検証**: `fmt: "none"`（自己アテステーション）を受け入れつつ証明書連鎖も AAGUID も検証しないサイトは、機種の真正性を一切担保しない。任意 AAGUID・任意鍵が通る。
- **決定的リプレイ**: チャレンジ鮮度（nonce freshness）を厳密に検証しないと、同じ challenge が常に同じ署名を生む。**Microsoft は「厳密な nonce 鮮度検証」で緩和**しているが、多くのサイトは未対応。
- **オリジン束縛の欠落**: `clientDataJSON` を自前で再構築して `origin` を照合しない RP は、オリジン束縛という最大の防御を自ら無効化している（WebAuthn実装で最も多いミス）。

#### 防御（RP・ブラウザ・仕様）

- RP: 初回 assertion 以降 `signCount == 0` を拒否／`signCount` の単調増加を強制、`x5c` の証明書連鎖を検証し AAGUID を既知ベンダー（Yubico/Google/Apple 等）と照合、`alg ∈ {-7, -8}` に限定、チャレンジは暗号論的乱数で一度きり、`origin` を厳密照合。
- ブラウザ/仕様（記事の提案）: CDP の WebAuthn 系機能をオリジン別許可制にする、`localhost` 等に限定、`webauthn-testing` フィーチャポリシートークンで常駐鍵注入を禁止する、といった「テスト機能が本番を侵さない」ためのゲート。

> 出典: Forging Passkeys: Exploring the FIDO2/WebAuthn Attack Surface（Narendar Battula） — https://medium.com/@narendarlb123/forging-passkeys-exploring-the-fido2-webauthn-attack-surface-12e44bfb3b74 ／ 同内容ミラー — https://nullpt.rs/forging-passkeys
> （Medium原文は自動取得が403でブロックされたため、同一著者・同一内容のミラー nullpt.rs から再構成しました。）

---

### 2. Pass-the-Passkey — 同期パスキーと Windows/Entra 実装への攻撃（Black Hat USA 2026）

SpecterOps の Michael Grafnetter が Black Hat USA 2026（2026年8月）で発表した「Pass-the-Passkey 攻撃ファミリ」は、その名のとおり **Pass-the-Hash / NTLM Relay の再来**を狙う。Windows 11・Microsoft Entra ID・ブラウザ・パスワードマネージャにまたがる **3つのコア脆弱性と20以上の技法**を体系化したもので、「実装が甘ければ、FIDO2 暗号を破らずともフィッシング耐性MFAを満たせてしまう」ことを示した。

> ⚠️ **未取得の資料**: 主要URL「DSInternals: Upcoming Talk — Pass-the-Passkey Family of Attacks」（https://www.dsinternals.com/en/black-hat-usa-26-pass-the-passkey/ ）は告知（インデックス）ページで、スライド・ホワイトペーパー・ツールへのリンクのみで技術的実体を含みません。ホワイトペーパーPDF（`specterops.io/.../Pass-the-Passkey_A4_v2.pdf`）はサイズ超過で自動取得できませんでした。以下は、同ページからリンクされる一次リポジトリ（SpecterOps/pass-the-passkey の README）と一次報道に基づく再構成です。

#### 3つのコア脆弱性

1. **Windows 11 の WebAuthN イベントログ漏えい（署名リプレイ）**: Windows 11 は passkey サインインのたびに、完全な WebAuthn assertion（challenge・authenticator data・**署名**）を `Microsoft-Windows-WebAuthN/Operational` イベントログに書き込んでいた。このログは**認証済みの一般ユーザー（リモート含む）が読める**。攻撃者は秘密鍵を盗む必要すらなく、**過去に生成された署名（YubiKey の署名がクリアテキストで保存）を抜き出して再送**できた。関連 CVE は **CVE-2026-34348（CVSS 6.5）**。
2. **Microsoft Entra ID の assertion リプレイ許容**: Entra ID は上記の盗んだ assertion を一定時間**再利用可能**として受理してしまう。報道により再利用可能時間の記載に幅があり、**約5分（チャレンジ有効期間）〜最大10分**とされる。根因は、**Entra が WebAuthn のチャレンジに擬似乱数 nonce ではなく JWT（JSON Web Token）を用い、そのチャレンジがセッションクッキー・ユーザー・テナントに束縛されていない**点。束縛が無いため、別コンテキストで取り込んだ署名がそのまま通る。
3. **YubiKey 署名のクリアテキスト保存**: 上記1と重なるが、Windows は過去の YubiKey 署名を平文で保持し、非特権ユーザーが読める状態にあった。物理鍵を持たずに「鍵が署名した事実」を再利用できることが本質的な問題。

**修正状況**: Microsoft の **2026年7月の Windows 更新**により、保存された assertion はリプレイに使えなくなった（＝ログに残っても再利用不可に）。

#### 攻撃ツール群（SpecterOps/pass-the-passkey）

README が公開する道具立ては、上記の抜けを実運用に落とし込む。

- **Passkey Injector**: WebView2 ベースのブラウザで、**WebAuthn の assertion 要求を横取りし、応答をJSON形式で注入**できる。用途は「捕捉した assertion のリプレイ」「攻撃者制御の応答によるフィッシング」「サーバ検証のテスト用に assertion を改変」「盗んだ同期パスキーでチャレンジに署名」。
- **SharpPasskeys**: C2 エージェント向けの .NET Framework 4.8 ペイロード。passkey 認証プロンプトの表示・結果 assertion の取得・Windows Hello 資格情報の列挙・イベントログ内 WebAuthn イベントの監視・**ロック解除済みローカル鍵での Entra チャレンジ直接署名**を行う。
- **WebAuthn Hook**: Microsoft Detours でブラウザプロセスに注入するネイティブDLL。Win32 API `WebAuthNAuthenticatorGetAssertion` をフックし、`\\.\pipe\WebAuthnHook` 名前付きパイプ経由で **assertion の観測・改ざん・差し替えチャレンジ注入・応答の握りつぶし**を行う。
- **Passkey UI / DSInternals モジュール**: Windows WebAuthn API 操作のGUIと PowerShell。Entra ID / Okta への passkey 登録を委任的に行える。

#### 同期パスキーの抽出とチェーン

パスキーは端末間で**同期（synced）**されるものが主流になったが、これが新たな抽出面を生む。README とデモは、**KeePassXC・Bitwarden といったパスワードマネージャの同期ボールトから WebAuthn 秘密鍵を取り出せる**ことを示す。抽出鍵は次のスクリプトで悪用される。

- **`Invoke-EntraPasskeyInjection.ps1`**: Passkey Injector と連携し、**同期ボールトから抽出した WebAuthn 秘密鍵で非対話的に Entra ID へサインイン**し、Microsoft Graph 用の OAuth トークンを取得する。**なぜ成立するか**: 鍵さえ手元にあれば、認証器の物理的存在（UP）や本人確認（UV）はソフトウェア側の申告で満たせ、Entra 側のチャレンジがセッション非束縛なので、対話UIなしにトークンまで到達できる。

関連して、Windows Hello の**エクスポート不可（non-exportable）鍵**でも、既に侵害されたユーザーセッション内の低特権プロセスから、**新たなPIN/生体プロンプトなしに**その鍵を FIDO2 資格情報として Entra に対して使える、という指摘もある（L. Mollema）。鍵を「盗む」のではなく「正規に使う」ため、抽出防御では止まらない。

#### 防御

- **即時**: CVE-2026-34348 を含む Windows 更新（2026年7月以降）を適用し、イベントログへの assertion 平文記録を解消。
- **ログアクセス**: リモートのイベントログ読み取りを制限、特権アクセス用ワークステーション（PAW）を使用、コード実行を制限。
- **IdP 側**: チャレンジを**セッション・ユーザー・テナントに束縛**し、鮮度（一度きり）を厳格化。Windows Hello 認証で**デバイスID クレームを欠く**ものを監視（デバイス束縛の欠落＝Primary Refresh Token 悪用の兆候）。
- **設計思想**: パスキーストアとブラウザのプロセスメモリを「資格情報級のセンシティブ領域」として扱う。

> 出典: Pass-the-Passkey Family of Attacks（DSInternals 告知ページ） — https://www.dsinternals.com/en/black-hat-usa-26-pass-the-passkey/ ／ 一次リポジトリ SpecterOps/pass-the-passkey — https://github.com/SpecterOps/pass-the-passkey ／ 一次報道 The Hacker News — https://thehackernews.com/2026/08/new-passkey-attacks-can-recover-synced.html

---

### 3. 「実装の穴で古い攻撃がなお通用する」 — 3研究の総括（Dark Reading）

Dark Reading（Arielle Waldman）の記事は、2026年夏に相次いだ複数チームの研究を横断し、**「WebAuthn の暗号が健全でも、周辺実装が甘ければ replay・relay・フィッシング類似の経路が復活する」**という結論を提示する。

> ⚠️ **未取得の資料**: 「Dark Reading: Flaws in Passkey Implementation Show Old Attacks Still Work」（https://www.darkreading.com/identity-access-management-security/flaws-passkeys-implementation-old-attacks-work ）は自動取得が **HTTP 403** でブロックされました。ご自身で直接ご覧ください。以下は、同記事の検索スニペットと、同じ3研究を扱う一次報道（The Hacker News）に基づく再構成です。

（以下は未取得資料の補足として、公開報道と一般知識に基づく解説です。）記事が扱う3系統の攻撃は次のとおり整理できる。

- **SpecterOps（イベントログ署名リプレイ）**: 本節2で詳述。Windows 11 が「デジタル鍵の完全なコピー（assertion）」をイベントログに書き、Entra がその再利用を十分に防げなかった。CVE-2026-34348。
- **Unit 42（Golden Pass-ta-key — Google Password Manager の同期パスキー抽出）**: 端末上で動くマルウェア（管理者昇格は不要）を前提に、同期パスキーを保護する **32バイトのマスター鍵「Security Domain Secret」** を狙う。この秘密は**再登録時に一時的に Chrome のプロセスメモリに現れ**、そこから同期パスキーの秘密鍵を復元できる。深刻なのは **Google にこの秘密を回転（rotate）・失効（revoke）する手段が無い**点で、一度漏れれば以後の同期資格情報すべてが持続的に危殆化する。ユーザー検証を要求する eBay に対しても実証された。
- **Mollema（Windows Hello for Business のセッション悪用）**: 既に侵害されたユーザーセッション内の低特権プロセスから、Windows Hello の鍵を**新規のPIN/生体なしに** FIDO2 資格情報として使う。Entra のチャレンジが**5分有効・セッション/ユーザー/テナント非束縛**であることを突き、得たトークンがデバイスID クレームを欠くと **Primary Refresh Token 取得による持続化**につながる。

#### 3攻撃の性質比較

| 攻撃 | 秘密鍵の抽出が必要か | 端末侵害が必要か | 有効セッションが必要か |
|---|---|---|---|
| SpecterOps（署名リプレイ） | 不要（署名を再送） | 不要 | 不要 |
| Unit 42（同期鍵抽出） | 必要（同期鍵を復元） | 必要 | 不要 |
| Mollema（正規鍵の悪用） | 不要（鍵を正規に使用） | 必要 | 必要 |

**記事の総合評価**: これら実装上の欠陥があっても、攻撃経路は従来のパスワード攻撃より依然として複雑であり、**パスキーへの移行は引き続き推奨**される。パスキーはパスワードより大幅に優れるが、「魔法」ではない。組織は Windows 11 のパッチ適用、コード実行の制限、PAW の利用、リモートログアクセスの制限、ユーザー検証要件の強制と検証、想定外のデバイス登録の監視を行うべきである。時事的背景として、**Microsoft は 2026年9月1日から SMS/音声認証ユーザーへ passkey を自動有効化し、SMS/音声認証は 2027年2月1日に廃止**予定であり、passkey 実装の堅牢化は急務となっている。

> 出典: Flaws in Passkey Implementation Show Old Attacks Still Work（Dark Reading, Arielle Waldman） — https://www.darkreading.com/identity-access-management-security/flaws-passkeys-implementation-old-attacks-work ／ 補足に用いた一次報道 The Hacker News — https://thehackernews.com/2026/08/new-passkey-attacks-can-recover-synced.html

---

### まとめ: 攻撃対象領域は「暗号」ではなく「実装の境界」にある

3資料に共通するメッセージは一貫している。**WebAuthn/FIDO2 の暗号（署名・オリジン束縛）は破られていない**。破れているのは、その周りの実装の境界——ブラウザのテスト機能（CDP 仮想認証器）、OS のログ設計（assertion 平文記録）、IdP のチャレンジ束縛（session/user/tenant 非束縛・nonce 鮮度）、パスワードマネージャの同期鍵保護（回転不能なマスター秘密）、そして RP の検証手順（signCount・アテステーション・origin の未検証）——である。

防御者が持つべき点検リストは、前提節で挙げた4点に帰着する。(1) `origin` を厳密照合しているか、(2) チャレンジは一度きり・短命・コンテキスト束縛か、(3) `signCount` 単調増加を強制しているか、(4) UP/UV フラグを盲信せずアテステーションで裏づけているか。これらは新しい脅威に対する対策であると同時に、WebAuthn 仕様が当初から要求していた基本の徹底でもある。パスキーは正しく実装されて初めてフィッシング耐性を発揮する、という原則を再確認したい。

## WebAuthnクレデンシャル紐付け不備によるATO

WebAuthn／パスキー（FIDO2）は「フィッシング耐性のある認証」として広く推奨される。秘密鍵はユーザーの認証器（スマホ・セキュリティキー・OSのパスワードマネージャ）の中に閉じ込められ、サーバには公開鍵しか渡らない。中間者がパスワードを盗んでもログインできない ―― これがパスキーの売り文句だ。

しかし、この安全性は「**どの公開鍵が、どのアカウントに、正しく結び付いているか**」というクレデンシャル紐付け（credential binding）が正しく実装されていることを大前提にしている。ここに穴があると、攻撃者は自分の認証器で生成した公開鍵を**被害者のアカウントに登録**してしまえる。以後、攻撃者は自分の指紋やPINで正規のWebAuthnアサーション（本人性の署名付き証明）を作れるので、サーバ側のログイン検証は完璧に通る。パスワードを一切知らなくても、被害者になりすませる ―― これが「WebAuthnクレデンシャル紐付け不備によるアカウント乗っ取り（ATO: Account Takeover）」だ。

この節では、実際にCVEが採番されたオープンソース製品「OpenReception」の2件の脆弱性（登録セレモニーの検証欠落・エンドポイントの認証欠落）を教材に、**なぜパスキーでもATOが起きるのか**をプロトコルと実装のレベルで解剖する。最後に、クラウドID基盤（Microsoft Entra ID）で同型の問題が「パスキーのプロビジョニング権限の濫用」として現れるケースを扱う。

まず、この節を通じて頻出する用語を最初にかみ砕いておく。

- **RP（Relying Party、依拠当事者）**: パスキーで認証を受けるサービス側。RP IDは通常そのサービスのドメイン名（例 `example.com`）。
- **登録セレモニー（registration ceremony）**: 新しい認証器の公開鍵をアカウントに紐付ける一連の手続き。ブラウザの `navigator.credentials.create()` に対応する。
- **認証セレモニー／アサーション（assertion）**: ログイン時に認証器が秘密鍵で署名を作り、本人性を証明する手続き。`navigator.credentials.get()` に対応する。
- **チャレンジ（challenge）**: サーバが毎回ランダムに発行する使い捨ての値。リプレイ攻撃（過去のやり取りの使い回し）を防ぐために、認証器の署名対象に含める。
- **アテステーション（attestation）**: 認証器が「自分は本物のハードウェアだ」とメーカー署名付きで証明する仕組み。登録時に検証できる。
- **オリジン／RP IDの検証**: 認証器が返す `clientDataJSON` に含まれるオリジン（どのサイトで署名したか）と、`authenticatorData` に含まれるRP IDハッシュを、サーバが期待値と突き合わせること。フィッシング耐性の根幹。

### なぜ「パスキーなのに乗っ取れる」のか ―― 攻撃面の本質

パスキーの暗号は破られていない。破られるのは、その手前と後ろにある**アカウント管理ロジック**だ。攻撃者の狙いは大きく2つに分かれる。

1. **登録の紐付けを乗っ取る**: 攻撃者が自分の認証器で正規の登録セレモニーを実行し、生成された公開鍵を**被害者のユーザーレコード**に書き込ませる。サーバが「この公開鍵は本当にこのログイン中のユーザーのものか」を確認しないと成立する。
2. **登録エンドポイント自体を無認証で叩く**: そもそも公開鍵を追加するAPIが、ログインセッションもチャレンジも検証していない。攻撃者は任意のユーザーIDと任意の公開鍵をPOSTするだけで紐付けを注入できる。

どちらも共通する失敗は「**公開鍵をアカウントに結び付ける瞬間に、そのアカウントの正当な所有者であることを確認していない**」という一点だ。WebAuthnのライブラリは「署名が数学的に正しいか」は検証してくれるが、「その公開鍵をどのアカウント行（row）に入れてよいか」というアプリ固有の認可判断は、アプリ側が書かねばならない。ここが抜けるのがこのクラスの脆弱性の中核である。

以下、OpenReceptionの2件で、この2パターンがそれぞれどう具体化したかを見る。

### 事例1: OpenReception ―― 登録セレモニーの「宛先」検証欠落（CVE-2026-48087）

OpenReceptionは予約管理（appointment booking）のオープンソースソフトウェアで、認証にパスワードではなくWebAuthnパスキーを採用している。この脆弱性は「登録の宛先（どのユーザーに紐付けるか）」を検証しないという、上記パターン1の典型だ。

#### 脆弱なエンドポイントと処理の流れ

問題のエンドポイントは登録セレモニーを完了させる次のハンドラである。

```
POST /api/auth/register/{userId}
```

登録の流れはこうなっている。

1. 攻撃者は**自分のメールアドレス**（例 `attacker@evil.test`）で `POST /api/auth/challenge` を叩く。
2. サーバは応答として2つのクッキー ―― `webauthn-challenge`（使い捨てチャレンジ）と `webauthn-registration-email`（登録対象のメール）―― をセットする。
3. 攻撃者は自分の認証器で、このチャレンジに対する**正規の**WebAuthn登録クレデンシャル（公開鍵＋署名）を生成する。
4. 攻撃者はそのクレデンシャルを `POST /api/auth/register/{VICTIM_USER_ID}` に送る。URLパスの `{userId}` には**被害者のID**を入れ、リクエストボディのメールには**自分のメール**を入れる。
5. サーバのハンドラは「ボディの `email` がクッキー `webauthn-registration-email` と一致するか」と「WebAuthnセレモニーがチャレンジに対して正しいか」だけを検証する。
6. **決定的に欠けている検証**: パスパラメータの `userId`（被害者）が、そのメール（攻撃者）の持ち主かどうかを一切確認していない。
7. 結果、攻撃者の公開鍵が `addPasskey(params.id, credential)` によって**被害者の `user_passkey` テーブル行**に書き込まれる。
8. 攻撃者は以後、**被害者のメールで**ログイン画面を開き、**自分の認証器**でアサーションを作る。サーバは被害者アカウントに紐付いた公開鍵（＝いま注入した攻撃者の鍵）と照合して成功し、**被害者の身元でセッションJWTを発行**する。

#### なぜこうなるのか ―― 「チャレンジ」と「認可」は別物

ここが教科書的に重要なポイントだ。WebAuthnのライブラリ検証は、暗号的には完璧に機能している。チャレンジのリプレイも防げているし、署名も本物だ。だが、それらはすべて「**攻撃者自身のメールアドレス**」の文脈で発行されたチャレンジとクッキーに対して正しいだけである。

サーバが確認したのは「ボディのメール == クッキーのメール」という**攻撃者の閉じた世界の中での整合性**にすぎない。本来必要だったのは、URLの `params.id`（被害者）とメール（攻撃者）が**同一人物を指すか**という、世界をまたいだ突き合わせだ。アドバイザリの原文表現を借りると次の通りである。

> The handler reads `params.id`, validates `body.email === cookies.get("webauthn-registration-email")`, validates the WebAuthn registration response against the cookie's challenge...and then calls `addPasskey(params.id, credential)`. The decisive missing step is...look up the user record by `params.id` and reject the request unless `targetUser.email` matches.

つまり、認証の「セレモニー」（暗号手続き）は完全に正しく回っているのに、「このクレデンシャルを**誰の**アカウントに入れるのか」という**認可（authorization）**の判断が丸ごと抜けている。認証（authentication、本人確認）と認可（authorization、権限確認）は別レイヤーであり、暗号ライブラリは前者しか面倒を見ない ―― という原則を痛烈に示す例だ。

#### 修正の考え方

アドバイザリが示す修正は、登録ハンドラに「宛先ユーザーとメールの結合検証」を足すことだ。

```typescript
// 修正: 被害者IDと登録メールが同一人物を指すか検証する
const targetUser = await UserService.getUserById(params.id);
if (targetUser.email !== body.email) {
  return error(403, 'user/email mismatch');
}
```

このコードの意味は「パスパラメータで指定されたユーザー（`params.id`）を実際にDBから引き、そのメールが登録セレモニーで使われたメールと一致しなければ拒否する」ということ。これで「攻撃者のメールで発行したチャレンジを、被害者のIDに横流しする」経路が塞がれる。

さらにアドバイザリは、根本的な堅牢化として次を推奨している。

- 登録クッキーを**メールだけでなく特定のユーザー識別子にスコープする**（メールは可変・再利用されうるため単独では弱い）。
- あるいは**対象ユーザーに束縛された単回限りの登録ナンス（nonce）**を使う。チャレンジそのものを「このユーザー専用」にすれば、他人のIDへ転用できない。

#### 影響とステルス性

この脆弱性の怖さは、痕跡が残りにくい点にある。攻撃で新規ユーザー行が作られるわけではなく、既存被害者の `user_passkey` テーブルに**行が1つ増えるだけ**だ。監視が「不審な新規アカウント作成」だけを見ていると完全に見逃す。影響は下記の通り。

- **無認証での任意アカウント乗っ取り**: 被害者のメールとユーザーIDさえ分かれば、`GLOBAL_ADMIN` や `TENANT_ADMIN` を含む任意アカウントを乗っ取れる。
- **CVSS 9.8（Critical）**: 攻撃ベクトルはネットワーク越し、必要権限なし、ユーザー操作なし、機密性・完全性・可用性いずれも高影響。
- スタッフ一覧を返す認証済みエンドポイントなどから、被害者IDが漏れうる（＝前提条件が揃いやすい）。

> 出典: GitHub Advisory GHSA-j9rw-x2wv-h5rj (CVE-2026-48087) — WebAuthn passkey injection allows account takeover — https://github.com/open-reception/appointment-booking-software/security/advisories/GHSA-j9rw-x2wv-h5rj

### 事例2: OpenReception ―― 登録エンドポイントの認証欠落（CVE-2026-54460, CWE-306）

事例1の修正（バージョン1.0.x系での対応）で `register/[id]` は堅くなった。ところが、**別の**パスキー追加エンドポイントに、今度はもっと露骨な「認証そのものの欠落」が残っていた。これがCVE-2026-54460であり、上記パターン2 ―― CWE-306（Missing Authentication for Critical Function、重要機能に対する認証の欠落）―― の典型だ。バージョン **1.1.0まで**が影響を受け、**1.1.1で修正**された。CVSSは同じく**9.8（Critical）**。

CWE-306とは、「本来ログイン済みでなければ実行できないはずの重要な操作に、認証チェックがまったく掛かっていない」という設計上の欠陥クラスを指す。「追加の認証パスキーを登録する」は、まさに認証を要すべき重要操作の代表例だ。

#### 脆弱なエンドポイント

```
POST /api/auth/passkeys
```

このハンドラは、リクエストボディに含まれる `userId` と `passkey` データを受け取り、それをそのまま `UserService.addAdditionalPasskey()` に渡してDBに保存する。アドバイザリの表現はこうだ。

> The handler never reads `locals.user` and never verifies a server-issued challenge, an attestation, an origin, or an RP ID.

`locals.user`（SvelteKit系フレームワークで「現在ログイン中のユーザー」を格納する慣習的な場所）を**一度も読んでいない** ―― つまり、リクエストの主が誰なのかをサーバは知ろうともしない。加えて、サーバ発行チャレンジ・アテステーション・オリジン・RP IDの**いずれの検証もしていない**。事例1では「暗号手続きは正しいが宛先確認が抜けていた」のに対し、ここでは**暗号手続きの検証すら丸ごと存在しない**。攻撃者は正規の認証器すら要らず、任意の公開鍵データを直接ねじ込める。

#### 攻撃チェーン

**ステップ1: 被害者のUserIDを入手する**

```
GET /api/tenants/{id}/appointments/staff-public-keys
```

このエンドポイントは、認証なしでスタッフメンバーの身元情報を露出する。アクセスに必要なのは、公開ブートストラップフロー（プルーフ・オブ・ワーク＝計算量チャレンジ）で誰でも取得できる予約トークンのみ。つまり**無認証で被害者のuserIdが手に入る**。事例1で「前提が揃いやすい」と述べた前提が、ここでは公開APIとして提供されてしまっている。

**ステップ2: 悪意あるパスキーを注入する**

攻撃者は `POST /api/auth/passkeys` に、被害者の `userId` と**攻撃者が管理する公開鍵**を送るだけ。エンドポイントはセッション検証なしにそのクレデンシャルを被害者アカウントに保存する。

```http
POST /api/auth/passkeys HTTP/1.1
Host: victim-openreception.example
Content-Type: application/json

{
  "userId": "<被害者のstaff userId>",
  "passkey": { "...攻撃者が生成した公開鍵クレデンシャル..." }
}
```

（注: 上記は防御目的の説明用に構造を示したもので、実在サービスに送るものではない。）

**ステップ3: アカウント乗っ取り**

```
POST /api/auth/login
```

ログイン時、サーバは提示されたWebAuthnアサーションを**保存済み公開鍵**と照合する。攻撃者の鍵はいま被害者アカウントに保存されたので、攻撃者のアサーションは成功し、**被害者アカウントの有効なセッショントークン**が返る。

#### なぜこうなるのか ―― 「重要機能」の認証は自明ではない

パスキー追加は、実装者の頭の中では「認証フローの一部」に見える。だが実際には**すでに認証済みのユーザーが、自分のアカウントに2台目の認証器を足す**操作であり、本質的にはプロフィール変更と同じ「ログイン後の特権操作」だ。ここで `locals.user` を読み、「追加先の `userId == locals.user.id`」を強制しなければならない。それを怠ると、ログイン前の誰でも触れる公開APIに、アカウント改変能力を晒すことになる。

さらにこの実装は、WebAuthn登録セレモニーの検証（チャレンジ・オリジン・RP ID・アテステーション）を一切していないため、攻撃者は本物の認証器を用意する手間すらない。これは「暗号は正しく回っているのに認可が抜けている」事例1より一段深刻な、「そもそも何も検証していない」状態である。

#### 修正の考え方

1.1.1の修正は、以前のCVE-2026-48087（事例1）の `register/[id]` に施した保護と同等のものを、この `passkeys` エンドポイントにも適用した。すなわち、

- **認証済みセッションを必須化**する（`locals.user` を読み、未ログインなら拒否）。
- 追加するクレデンシャルを**ログイン中のユーザーに束縛**する（追加先を他人のIDにできないようにする）。
- **完全なWebAuthn登録セレモニー検証**（サーバ発行チャレンジ・オリジン・RP ID）を実装する。

運用者向けには「登録チャレンジを伴わずに追加されたクレデンシャルがないか `userPasskey` テーブルを監査し、スタッフの再登録とセッション見直しを要請せよ」と勧告している。既に注入済みの鍵は修正コードでは検知されないため、**事後の棚卸し**が必須という点が重要だ。

#### 影響

- **機密性**: 予約メタデータ、スタッフ名簿（氏名・メール・役割・最終ログイン時刻）、クライアント存在確認用テーブルの露出。
- **完全性**: 予約の偽造・改変・恒久的削除、クライアントのPINリセットトークン発行。
- **可用性**: スタッフを削除すると**暗号鍵シェア**（分散保管された鍵の断片）も消え、対応する暗号化済み予約データが**復旧不能に破壊**される。
- **エスカレーション経路**: `STAFF` アカウントを掌握すれば、同じ注入手法で `TENANT_ADMIN` の列挙・乗っ取りへ進め、設定とスタッフ管理を掌握できる。

なお救いとして、予約本文（クライアント名・連絡先・来訪理由）は**クレデンシャルごとの復号鍵によるエンドツーエンド暗号化**で守られており、注入したパスキーからはその復号鍵を導出できない。したがって攻撃者はアカウントを乗っ取れても、暗号化ペイロード本体は読めない。これは「パスキーを乗っ取っても、鍵導出まで乗っ取れるとは限らない」という、暗号設計の防御的分離が効いた好例である（ただしPRF拡張＝Pseudo-Random Function拡張のような、認証器から復号鍵を導く仕組みを併用している場合は、この分離が崩れうる。事例1のアドバイザリも「PRF対応認証器を持つスタッフアカウントはトンネル復号操作を可能にする」と警告している）。

> 出典: Machine Spirits Advisory (CVE-2026-54460) — Unauthenticated Account Takeover in OpenReception (CWE-306) — https://www.machinespirits.com/advisory/cc76da/

#### 2件を並べて見る ―― 修正の「隣」に穴は残る

この2件は同じ製品の同じ攻撃目的（無認証ATO）を、別々のエンドポイントで達成している。事例1（`register/[id]`）を修正しても、事例2（`passkeys`）に同型の穴が残っていた。教訓は明快だ ―― **「クレデンシャルをアカウントに書き込む経路」は1つとは限らない**。1箇所を直したら、公開鍵をユーザーに紐付ける**すべての**コードパス（登録・追加・リカバリ・インポート等）を洗い出し、いずれも「認証済みか」「追加先は本人か」「セレモニーは検証済みか」の3点を満たすかを横断的に点検する必要がある。

### 事例3: クラウドID基盤での同型問題 ―― Entra IDのFIDO2プロビジョニング濫用

同じ「クレデンシャル紐付けの権限が過剰・不備」という構図は、自作アプリだけでなくマネージドなID基盤でも現れる。Microsoft Entra ID（旧Azure AD）では、管理者やアプリケーションが**ユーザーに代わってFIDO2パスキーを事前プロビジョニング（pre-provision）**できる。この便利機能が、権限設計を誤ると「任意ユーザーへのパスキー注入によるATO」に化ける。

> ⚠️ **未取得の資料**: 「Bureau Veritas: Abusing FIDO2 passkeys（Entra ID provisioning悪用）」は自動取得できませんでした（理由: サーバがHTTP 403 Forbiddenを返し、egress側でブロックされたため）。以下のURLからご自身で直接ご覧ください: https://cybersecurity.bureauveritas.com/services/information-technology/pentesting-services/what-can-be-pentested/cloud-pentesting/abusing-fido2-passkeys
>
> （以下は未取得資料の補足として、WebSearchで得られた要点と一般知識に基づく解説です。2026年時点のMicrosoft Graph API仕様を前提とし、時事性のある内容には対象を明記します。）

#### 濫用される権限とAPI

Entra IDでは、ユーザーの認証方法（authentication method）をプログラムから追加・削除できる。FIDO2パスキーの事前プロビジョニングに使うのが、Microsoft Graphの次のリソースだ（2026年時点では beta エンドポイントで提供）。

```http
POST https://graph.microsoft.com/beta/users/{userId}/authentication/fido2Methods
```

このAPIをアプリ単独（app-only、ユーザーの介在なし）で呼ぶには、アプリケーション権限 **`UserAuthenticationMethod.ReadWrite.All`**（または、より細粒度の `UserAuthMethod-Passkey.ReadWrite.All`）が必要になる。人間の管理者が実行する場合は **Authentication Administrator** ロール相当が必要だ。

問題は、この権限の**射程が極端に広い**ことだ。WebSearchで得られた要点を引くと、

> An app registration holding `UserAuthenticationMethod.ReadWrite.All` can add or remove authentication methods for any user in the tenant, including admins, which makes it tier-0 infrastructure by any reasonable definition.

つまり、この権限を持つアプリ登録は**テナント内の任意ユーザー（管理者を含む）の認証方法を追加・削除できる**。これは事実上、ドメインコントローラ級（tier-0）のインフラだ。

#### なぜ権限昇格（ATO）になるのか

攻撃シナリオはこうだ。攻撃者がテナント内のどこか1つのアプリケーション（サービスプリンシパル）に `UserAuthenticationMethod.ReadWrite.All` が付与されている状況を掴んだとする。攻撃者がそのアプリのクライアントシークレット／証明書を奪う、あるいはそのアプリを操れる立場にあると、

1. Graph APIで**Global Administrator のユーザーオブジェクト**に対し、`fido2Methods` として**攻撃者自身の認証器（またはソフトウェアで生成した鍵）**をパスキーとして追加する。
2. 以後、攻撃者はそのパスキーで**Global Administratorとしてサインイン**できる。パスワードもMFAの追加要素も不要 ―― パスキー単体がフィッシング耐性MFAとして通るため、条件付きアクセスもすり抜けやすい。

これは事例1・2とまったく同じ構図だ ―― 「公開鍵をアカウントに紐付ける操作」への**権限管理が甘い**と、その紐付けが乗っ取りに直結する。自作アプリでは「認証チェックの欠落」として、Entra IDでは「過剰なアプリ権限の付与」として、同じ穴が形を変えて現れている。WebSearchの要点いわく、`UserAuthenticationMethod.ReadWrite.All` は「特定条件下でGlobal Administratorロールへの権限昇格を許す」。

#### 防御策

補足資料および一般的なEntra IDのベストプラクティスに基づくと、防御の要点は次の通り。

- **権限をtier-0として扱う**: `UserAuthenticationMethod.ReadWrite.All` を持つアプリ登録には、そのクライアントシークレットをドメインコントローラの資格情報と同格で保管し、同意（consent）を付与できるアカウントを厳しく制限し、他の常設特権アクセスと同じ棚卸しスケジュールに載せる。
- **付与の棚卸し**: どのサービスプリンシパルにこの権限（および `UserAuthMethod-Passkey.ReadWrite.All`）が付いているかを定期監査する。不要なら剥奪する。
- **AAGUIDによる鍵制限**: 管理者は登録可能なFIDO2キーの種類を、認証器モデルを示す **AAGUID（Authenticator Attestation GUID）** で制限できる。許可リストにない認証器（＝攻撃者が任意に用意したソフト鍵など）の登録を弾く追加のハードルになる。
- **プロビジョニング操作の監視**: `fido2Methods` への追加は監査ログに残る。人手の登録セレモニーを伴わない、APIによる突然のパスキー追加（特に管理者アカウントへのもの）をアラート対象にする。事例2でOpenReceptionの運用者に勧告されたのと同じ「登録チャレンジを伴わない紐付けを探せ」という発想が、クラウドでもそのまま通用する。

> 出典: Bureau Veritas Cybersecurity — The keys to the kingdom: how attackers can use FIDO2 passkeys against you（Abusing FIDO2 passkeys） — https://cybersecurity.bureauveritas.com/services/information-technology/pentesting-services/what-can-be-pentested/cloud-pentesting/abusing-fido2-passkeys
>
> 出典（補足）: Microsoft Graph Permissions — UserAuthMethod-Passkey.ReadWrite.All — https://graphpermissions.merill.net/permission/UserAuthMethod-Passkey.ReadWrite.All

### まとめ ―― パスキーの安全は「紐付けの認可」で決まる

この節の3事例は、いずれも暗号としてのWebAuthn／FIDO2を破ってはいない。破られたのは「**どの公開鍵をどのアカウントに結び付けてよいか**」という認可判断だ。

- **事例1（CVE-2026-48087）**: セレモニーは正しく検証したが、**登録の宛先（userId）と本人（email）の結合**を確認せず、他人のIDに鍵を横流しされた。
- **事例2（CVE-2026-54460, CWE-306）**: パスキー追加エンドポイントが**認証・チャレンジ・オリジン・RP IDを一切検証せず**、無認証で任意アカウントに鍵を注入された。
- **事例3（Entra ID）**: パスキーのプロビジョニング権限が過剰で、**その権限を握れば任意ユーザー（管理者含む）に鍵を注入**でき、権限昇格・ATOに至る。

設計者が守るべき鉄則は3つに集約される。

1. **クレデンシャルをアカウントに書き込むあらゆる経路で、書き込む主体が正当な所有者であることを認証・認可する**（`locals.user` を必ず読み、追加先を本人に束縛する）。
2. **登録セレモニーを完全に検証する**（サーバ発行チャレンジ・オリジン・RP ID・必要ならアテステーション）。暗号ライブラリは署名の正しさしか見ない ―― 「誰の行に入れるか」はアプリが決めねばならない。
3. **紐付けを実行できる権限をtier-0として管理し、紐付け操作を監査・監視する**。人手のセレモニーを伴わない鍵追加は、乗っ取りの痕跡かもしれない。

パスキーは正しく実装すれば強力だ。だがその強さは、認証の暗号ではなく、**紐付けの認可**という平凡なアプリロジックが握っている ―― それがこの節の結論である。

---

## ナビゲーション

← [第3章 SAML攻撃](03-saml.md)  ｜  [📚 目次（ホーム）](index.md)  ｜  [第5章 MFA／2FAバイパス](05-mfa-bypass.md) →
