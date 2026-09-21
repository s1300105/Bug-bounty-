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
