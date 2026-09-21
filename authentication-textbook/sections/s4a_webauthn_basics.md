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
