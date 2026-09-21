## パスワードリセットの理論・防御観点

パスワードリセット（「パスワードをお忘れですか」）機能は、通常ログインより攻撃対象として狙われやすい。理由は単純で、ログインフローが強固な認証（多要素認証、レート制限、強力なパスワードポリシー）で守られていても、リセットフローが別実装であることが多く、そこに設計上の抜け穴が生まれやすいからである。攻撃者にとってリセット導線は「ログインを迂回してアカウントを乗っ取る近道」になり得る。本節では、OWASP Forgot Password Cheat SheetとOWASP WSTG（Web Security Testing Guide）のAuthentication Testingセクション（WSTG-ATHN-09）を柱に、リセット機能を安全に設計・実装・テストするための理論を整理する。

### なぜリセット機能が特別な脅威モデルを持つのか

通常のログインでは、攻撃者は「パスワードを知っている」ことを証明しなければならない。しかしリセットフローでは、証明すべきものが「そのメールアドレス／電話番号／秘密の質問の答えにアクセスできること」にすり替わる。つまりリセット機能は、パスワードという第一の認証要素を、メールやSMSという**別のチャネル（側身元確認: side-channel）**に一時的に委譲する仕組みである。

この委譲がある限り、次の3種類の弱点が生まれやすい。

1. **委譲先チャネルの検証が甘い**（例: トークンを推測可能、有効期限が長すぎる、使い回しができる）
2. **委譲の事実そのものが情報漏洩を起こす**（ユーザー列挙: アカウントの存在有無がレスポンスの違いから分かってしまう）
3. **委譲後の後処理が甘い**（パスワードを変更しても、攻撃者が乗っ取った既存セッションが生き続ける）

OWASP WSTG-ATHN-09は、テスト対象を次の3点に整理している。

> "1. if users, other than administrators, can change or reset passwords for accounts other than their own. 2. if users can manipulate or subvert the password change or reset process to change or reset the password of another user or administrator. 3. if the password change or reset process is vulnerable to CSRF."

> 出典: OWASP WSTG - Testing for Weak Password Change or Reset Functionalities (WSTG-ATHN-09) — https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/09-Testing_for_Weak_Password_Change_or_Reset_Functionalities.html

つまり防御側は「リセット機能は自分のアカウントの範囲だけで完結しているか」「途中に他人の情報を注入・改変できる余地はないか」「CSRFのような受動的攻撃で第三者に強制実行させられないか」の3軸で設計をレビューする必要がある。

### ユーザー列挙（Account Enumeration）とその防ぎ方

最初の関門は「パスワードをお忘れですか」フォームそのものである。ユーザーがメールアドレスやユーザー名を入力した直後のレスポンスが、存在するアカウントと存在しないアカウントで異なると、攻撃者はそのレスポンスの違いを使って有効なアカウント一覧を効率的に洗い出せる（ユーザー列挙攻撃）。これは後続のパスワードスプレー攻撃（少数の弱いパスワードを大量アカウントに試す攻撃）やフィッシングの前段階偵察として悪用される。

OWASP Forgot Password Cheat Sheetは明確にこう述べる。

```
- Return a consistent message for both existent and non-existent accounts.
- Ensure that the time taken for the user response message is uniform.
```

> 出典: OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html

**なぜ「メッセージの一貫性」だけでなく「応答時間の一貫性」まで求められるのか。** これはタイミング攻撃（timing attack、処理にかかる時間の差から内部状態を推測する攻撃）への対策である。仮に画面上の文言を「登録されていればメールを送信しました」で統一しても、内部実装が

```
if user_exists(email):
    generate_token()
    send_email()   # DB書き込み + SMTP送信 + トークン生成コストがかかる
return "登録されていればメールを送信しました"
```

のように「存在する場合だけ重い処理を実行してから返す」書き方だと、存在するアカウントの方がレスポンスが数十〜数百ミリ秒遅くなる。攻撃者はこの時間差を統計的に測定し、大量のメールアドレスに対して機械的にアカウントの有無を判定できてしまう。したがって、Cheat Sheetが推奨するように非同期処理（レスポンスを即座に返し、実際のメール送信はバックグラウンドキューで行う）にするか、存在しない場合でも「存在する場合と同じ処理コスト」をダミーで踏ませる実装が必要になる。

さらにCheat Sheetは、単純な文言統一だけでなく、リセット申請自体への**レート制限**も要求している。

```
Implement protections against excessive automated submissions such as
rate-limiting on a per-account basis, requiring a CAPTCHA, or other
controls. Otherwise an attacker could make thousands of password reset
requests per hour for a given account, flooding the user's intake
system (e.g., email inbox or SMS) with useless requests.
```

これは「同じメールアドレスに対して大量のリセットメールを送りつけ、正規ユーザーの受信箱を埋め尽くす」攻撃（メール爆撃／MFA疲労攻撃の亜種）への対策である。アカウント単位のレート制限（例: 同一アカウントへのリセット要求は1時間に3回まで）に加え、送信元IP単位のレート制限も併用しないと、攻撃者は複数アカウントに対して横断的に大量送信を行える点に注意する。

### アカウントロックアウトを「リセット拒否の武器」にしてはいけない

意外に見落とされがちな点として、Cheat Sheetは次のように明記している。

```
Do not make a change to the account until a valid token is presented,
such as locking out the account.
```

そしてAccount Lockoutの節では、

```
Accounts should not be locked out in response to a forgotten password
attack, as this can be used to deny access to users with known
usernames.
```

> 出典: OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html

**これがなぜ重要か。** もし「パスワードリセットを複数回要求したアカウントは一時ロックする」という実装にすると、攻撃者はユーザー名さえ知っていれば、そのユーザー名に対して繰り返しリセット要求を送るだけで正規ユーザーをロックアウトできてしまう（サービス拒否攻撃、DoS）。つまりロックアウトという「一見安全に見える防御策」が、逆に可用性攻撃の踏み台になる。防御すべきはロックアウトではなく、前述のレート制限（要求頻度を減衰・遅延させる）であり、両者は似て非なるものだと理解する必要がある。

### リセットトークン設計の原理

トークンはリセットフローの心臓部であり、以下の性質を満たす必要がある。Cheat Sheetの要求を引用する。

```
All tokens and codes should be:
- Generated using a cryptographically secure random number generator.
- Long enough to protect against brute-force attacks.
- Linked to an individual user in the database.
- Invalidated after they have been used.
- Stored in a secure manner, as discussed in the Password Storage Cheat Sheet.
```

それぞれの理由を仕組みレベルで見ていく。

**暗号学的に安全な乱数生成器（CSPRNG）を使う理由**: `Math.random()`（JavaScript）や多くの言語の標準乱数関数は、内部でメルセンヌ・ツイスタのような予測可能なアルゴリズムを使っている。これらは統計的品質は高いが「暗号学的な予測不可能性」は保証しない。つまり過去に出力された値の一部が分かれば、内部状態を復元して将来の出力を予測できる場合がある。トークン生成には`secrets.token_urlsafe()`（Python）や`crypto.randomBytes()`（Node.js）のようなCSPRNGを使う必要がある。

```python
# 悪い例: 予測可能な乱数源
import random
token = str(random.randint(100000, 999999))

# 良い例: CSPRNG
import secrets
token = secrets.token_urlsafe(32)  # URLセーフな32バイト(256bit)相当のトークン
```

**十分な長さが必要な理由**: トークンはブルートフォース（総当たり）攻撃の対象になる。6桁の数値PIN（100万通り）は、レート制限がなければ数分〜数時間で全数探索可能である。一方、256ビット相当のランダムトークンは事実上探索不可能な空間になる。ここで「トークンの長さ」と「試行回数を制限するレート制限」は補完関係にある点が重要で、どちらか一方だけでは不十分である——短いPINでもレート制限が強ければ実用上安全になり得るし（SMSのPINはこの設計）、逆に長いトークンでもレート制限がなければ理論上は探索され得る余地が生まれる（実運用上は非現実的な時間がかかるため通常は問題にならないが、防御の層は重ねるべきという原則）。

**個々のユーザーとひも付ける理由**: トークン単体を検証するのではなく「このトークンはこのユーザーIDに対して発行されたものか」を照合する必要がある。これを怠ると、トークンとユーザーIDをリクエストパラメータとして別々に受け取る実装で、攻撃者が自分に発行された有効なトークンと、被害者のユーザーID（あるいはメールアドレス）を組み合わせて送信し、被害者のパスワードを変更できてしまう危険がある（WSTG-ATHN-09が指摘する「User ID Validation」の欠如）。

**使用後は無効化する理由**: ワンタイムであるべきトークンが再利用可能だと、メールがどこかに残っている限り（共有PC、転送履歴、漏洩したメールボックスなど）何度でもパスワードを変更できてしまう。トークンは「発行→1回だけ使用可→即座に無効化」というライフサイクルで管理する。

**安全に保管する理由**: トークンをデータベースに平文で保存すると、DBが漏洩した際にすべての未使用トークンがそのまま悪用可能になる。パスワードと同様にハッシュ化して保存し、検証時に入力されたトークンをハッシュ化して比較する設計が望ましい（Password Storage Cheat Sheetの手法を準用）。

### URLトークン方式とHost Headerインジェクション

最も一般的な実装は、メールでリセットURLを送る方式である。Cheat Sheetは手順を次のように示す。

```
1. Generate a token for the user and attach it in the URL query string.
2. Send this token to the user via email.
   - Don't rely on the Host header while creating the reset URLs to
     avoid Host Header Injection attacks. The URL should either be
     hard-coded, or validated against a list of trusted domains.
   - Ensure that the URL is using HTTPS.
3. The user receives the email, and browses to the URL with the
   attached token.
   - Ensure that the reset password page adds the Referrer Policy tag
   with the noreferrer value in order to avoid referrer leakage.
   - Implement appropriate protection to prevent users from
     brute-forcing tokens in the URL, such as rate limiting.
```

> 出典: OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html

**Host Headerインジェクションがなぜ起こるか、仕組みレベルで説明する。** 多くのWebフレームワークは、絶対URLを組み立てる際にリクエストの`Host`ヘッダーをそのまま信頼して使う機能を持つ（例: Djangoの`request.build_absolute_uri()`、PHPの`$_SERVER['HTTP_HOST']`）。しかし`Host`ヘッダーはクライアントが自由に書き換えられるリクエストヘッダーの一つに過ぎない。攻撃者が次のようなリクエストを送るとする。

```
POST /forgot-password HTTP/1.1
Host: attacker-controlled.example
Content-Type: application/x-www-form-urlencoded

email=victim@example.com
```

サーバー側が「パスワードリセットURLを組み立てる際にHostヘッダーを使う」実装だった場合、被害者に送られるメール本文のリンクが

```
https://attacker-controlled.example/reset?token=<有効なトークン>
```

のように、攻撃者のドメインを指すURLになってしまう。被害者がこのリンクをクリックすると、有効なトークンが攻撃者のサーバーへのリクエストとしてログに残る（Refererヘッダー経由、あるいはURL自体がアクセスされることで）。攻撃者はそのトークンを盗み取り、正規のリセットページで使ってアカウントを乗っ取れる。

対策は「メール本文に埋め込むURLのドメイン部分は、リクエストのHostヘッダーから動的に組み立てず、サーバー設定にハードコードするか、許可リストに照合してから使う」ことである。

```python
# 悪い例: Hostヘッダーを信頼
reset_url = f"https://{request.headers['Host']}/reset?token={token}"

# 良い例: 設定値を使う（Hostヘッダーは一切参照しない）
ALLOWED_BASE_URL = "https://app.example.com"
reset_url = f"{ALLOWED_BASE_URL}/reset?token={token}"
```

**Referrer Policyがなぜ必要か。** リセットページを開いてから「新しいパスワードを設定する」ボタンを押すまでの間に、ページ内に外部リソース（画像、広告、外部フォント、トラッキングスクリプトなど）への参照があると、ブラウザはデフォルトでRefererヘッダーに遷移元の完全なURLを含めて送信する。もしリセットページのURL自体にトークンがクエリ文字列として含まれていた場合（`https://app.example.com/reset?token=abcdef123...`）、このRefererヘッダーを通じてトークンが外部の第三者サーバーに漏洩してしまう。`Referrer-Policy: no-referrer`をリセットページのレスポンスヘッダーに設定することで、この漏洩経路を遮断できる。

```
Referrer-Policy: no-referrer
```

なお、根本的な設計としては「トークンをURLのクエリ文字列に置かず、リンククリック後にPOSTボディで送らせる（=リセットページはトークン入りURLを表示せず、確認後にサーバー側セッションと紐付けたPOSTで消費する）」設計や、「メールリンクのクリックで即座にトークンを消費し、以降は別途発行した短命セッションIDでフォームを完結させる」設計も広く使われる。Cheat Sheetはこの発想を次のように補足している。

```
Note: URL tokens can follow on the same behavior of the PINs by
creating a restricted session from the token.
```

つまり、URLトークンをクリックした瞬間に「パスワード変更のみ許可する制限付きセッション」を発行し、以降のやり取りはそのセッションで行う、という多層防御が推奨されている。

### PIN方式とその特有の留意点

SMSなどのチャネルでは、URLの代わりに数字PINを送る実装も一般的である。

```
1. Generate a PIN.
2. Send it to the user via SMS or another mechanism.
   - Breaking the PIN up with spaces makes it easier for the user to
     read and enter.
3. The user then enters the PIN along with their username on the
   password reset page.
4. Create a limited session from that PIN that only permits the user
   to reset their password.
5. Let the user create a new password and confirm it.
```

> 出典: OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html

PIN方式はURLトークンよりも桁数が少ない（6〜12桁）分、ブルートフォース耐性は本質的に低い。この弱点を補うのが手順4の「制限付きセッション」で、PINを入力させるフォーム自体に強いレート制限（例: 5回誤入力でロック、指数バックオフ）とCAPTCHAを組み合わせることが実質的な防御になる。**なぜ「トークンを長くする」のではなく「レート制限で補う」設計が許容されるのか**——SMSはユーザー体験上、長い文字列を手入力させるのに適さないチャネルだからである。ここは「エントロピー（推測困難性）を運用制御（試行回数制限）で補う」というトレードオフの典型例であり、脅威モデル次第でどちらの比重を高めるか判断する。

### 秘密の質問（Security Questions）はなぜ単独の認証手段にできないのか

Cheat SheetとWSTG-ATHN-09は共に、秘密の質問を単独のリセット手段として使うことを明確に否定している。

```
Security questions should not be used as the sole mechanism for
resetting passwords due to their answers frequently being easily
guessable or obtainable by attackers.
```

> 出典: OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html

WSTG側も同様に、メールへの依存とのトレードオフを含めて論じている。

```
The first step is to check whether secret questions are required.
Sending the password (or a password reset link) to the user email
address without first asking for a secret question means relying
100% on the security of that email address, which is not suitable if
the application needs a high level of security.
```

> 出典: OWASP WSTG - Testing for Weak Password Change or Reset Functionalities (WSTG-ATHN-09) — https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/09-Testing_for_Weak_Password_Change_or_Reset_Functionalities.html

**なぜ「母親の旧姓」「初めて飼ったペットの名前」のような質問が弱いのか。** これらの答えは、SNSの公開プロフィールや過去の投稿、公的記録、あるいはソーシャルエンジニアリング（電話や対面で聞き出す手口）によって、パスワードよりもはるかに容易に第三者へ漏れる性質を持つ。つまり秘密の質問は「知識ベース認証」ではあるものの、その知識のエントロピー（=推測される確率の低さ）が著しく低く、パスワード相当の強度を持たない。結論として、秘密の質問を使う場合でも、必ずメールやSMSといった所有物ベースの確認（そのメールボックス／電話を物理的に所持していること）と併用し、単独では成立しないフローに設計すべきである。

### リセット完了後の後処理: セッション無効化と通知

パスワードが変更された後の処理を怠ると、せっかくトークンやレート制限で守ったフローの効果が無に帰す。Cheat Sheetの指摘を見る。

```
- Send the user an email informing them that their password has been
  reset (do not send the password in the email!).
- Once they have set their new password, the user should then login
  through the usual mechanism. Don't automatically log the user in, as
  this introduces additional complexity to the authentication and
  session handling code, and increases the likelihood of introducing
  vulnerabilities.
- Ask the user if they want to invalidate all of their existing
  sessions, or invalidate the sessions automatically.
```

> 出典: OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html

**「リセット後に自動ログインさせない」ことがなぜ推奨されるのか。** 一見ユーザー体験としては「リセットしたらそのままログインできた方が親切」に思える。しかしOWASPが指摘する通り、これは認証・セッション管理コードに新しい分岐（=通常ログインとは別のセッション発行経路）を追加することを意味し、その分岐にだけ存在するバグ（例: MFAチェックをスキップしてしまう、セッション固定化対策を経由し忘れる）が生まれるリスクが増す。攻撃対象領域（アタックサーフェス）を増やさないために、リセット後は「通常のログインフローに一本化して、そこを改めて通過させる」方が安全側に倒せる。

**既存セッションの無効化がなぜ必須か。** 攻撃者が何らかの方法で既にセッションを乗っ取っていた場合（セッションハイジャック、XSSによるCookie窃取など）、被害者がパスワードをリセットしても、攻撃者側の既存セッションがそのまま有効であれば意味がない。パスワード変更をトリガーに、サーバー側に保存されているセッションストアから該当ユーザーの全セッション（あるいは変更元のセッション以外の全セッション）を無効化する処理を必ず組み込む。これは「パスワードを変更した」というイベントを、単なるDBのフィールド更新で終わらせず、認可の再評価ポイントとして扱う設計思想である。

```python
def complete_password_reset(user_id, new_password, current_session_id):
    update_password_hash(user_id, hash_password(new_password))
    # 変更操作を行った現在のセッション以外、全て無効化
    invalidate_all_sessions(user_id, except_session=current_session_id)
    send_notification_email(user_id, "パスワードが変更されました")
```

**通知メールになぜパスワード自体を書いてはいけないか。** これはWSTG-ATHN-09が「Summary」で指摘する問題意識とも重なる。

```
When passwords are reset they are either rendered within the
application or emailed to the user. This may indicate that the
passwords are stored in plain text or in a decryptable format.
```

パスワードを平文でメール本文に書けるということは、サーバー側がそのパスワードを平文または復号可能な形で保持している証拠であり、それ自体が設計上の重大な欠陥（本来はハッシュ化して一方向にしか変換できない状態で保存すべき）を意味する。仮にメール自体が盗聴・傍受されなくても、「メールサーバーのログや転送履歴にパスワード平文が残る」というだけで攻撃対象領域が拡大する。したがって通知メールは「変更されたという事実」だけを伝え、パスワードそのものを含めてはならない。

### 変更の確認とトークンの取り消し猶予（DoS耐性）

WSTG-ATHN-09は、パスワードリセットが「即座に確定」する設計自体がサービス拒否（DoS）攻撃に使われうる点を強調している。

```
Is the reset password functionality requesting confirmation before
changing the password?

To limit denial-of-service attacks the application should email a
link to the user with a random token, and only if the user visits the
link then the reset procedure is completed. This ensures that the
current password will still be valid until the reset has been
confirmed.
```

> 出典: OWASP WSTG - Testing for Weak Password Change or Reset Functionalities (WSTG-ATHN-09) — https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/09-Testing_for_Weak_Password_Change_or_Reset_Functionalities.html

**仕組みを噛み砕くと**: もし「リセット申請フォームを送信した時点」で即座にパスワードが変更されてしまう（あるいは旧パスワードが即座に無効化される）実装だと、攻撃者は被害者のメールアドレスやユーザー名を知っているだけで、被害者のログインを妨害し続けられる。何度でもリセット申請を送りつければ、正規ユーザーが自分の(旧)パスワードでログインしようとしても常に失敗する状態を作れてしまう。これを防ぐのが「確認ステップの分離」で、リセット申請とパスワード変更の確定を2段階に分け、確定操作（メール内のリンクへのアクセス、あるいはトークンの提出）が行われるまでは旧パスワードを有効なまま維持する。これにより、攻撃者がリセットを何度申請しても、被害者本人がリンクをクリックしない限り実害が発生しない。

### パスワード変更（Change Password）機能との違いと共通する脅威

ここまでは「パスワードを忘れた場合のリセット」（未認証状態からの回復）を扱ってきたが、ログイン済みユーザーが能動的にパスワードを変更する「パスワード変更」機能にも共通する脅威がある。WSTG-ATHN-09は次のように述べる。

```
Is the old password requested to complete the change?

The most insecure scenario here is if the application permits the
change of the password without requesting the current password.
Indeed if an attacker is able to take control of a valid session they
could easily change the victim's password.
```

> 出典: OWASP WSTG - Testing for Weak Password Change or Reset Functionalities (WSTG-ATHN-09) — https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/09-Testing_for_Weak_Password_Change_or_Reset_Functionalities.html

**なぜ現在のパスワードの再入力を要求するのか。** セッションCookieやトークンを何らかの手段（XSS、共有端末での放置、CSRF）で窃取・悪用された場合でも、「現在のパスワード」という追加の知識要素を要求することで、攻撃者がセッションだけを持っていても完全な乗っ取り（=パスワード変更によって正規ユーザーを締め出す）まではできないようにする、という多層防御である。これは「センシティブな操作の前に再認証を求める」パターン（re-authentication for sensitive actions）の一種であり、WSTGのRemediationでも次のように総括されている。

```
The password change or reset function is a sensitive function and
requires some form of protection, such as requiring users to
re-authenticate or presenting the user with confirmation screens
during the process.
```

さらにWSTGは、CSRFへの耐性もこの文脈で明示的に求めている。パスワード変更フォームにCSRFトークンによる保護がない場合、攻撃者は被害者を悪意あるページへ誘導し、被害者のブラウザに(被害者が既にログイン中のセッションCookieを使って)「パスワードを攻撃者が指定した値に変更する」リクエストを自動送信させることができる。現在のパスワードの再入力要求は、実質的にCSRF対策としても機能する（攻撃者は被害者の現在のパスワードを知らないため、CSRFで強制送信しても成功しない）が、これはあくまで副次的効果であり、CSRFトークンによる保護を代替するものではない点に注意する。

### 多要素認証(MFA)とリセットフローの関係

MFAを導入していても、リセットフローがMFAを迂回できる設計になっていれば、MFAは意味を成さない。WSTG-ATHN-09の指摘を一般化すると、「パスワード変更・リセットのフローは、通常のログインと少なくとも同等の強度を持ち、MFAをバイパスしてはならない」という原則が導かれる。具体的には、MFAを有効化しているユーザーがパスワードリセットを行った直後に、MFAの再設定なしにログインできてしまう実装や、リセット完了と同時にMFA登録済みデバイスの検証をスキップしてセッションを発行してしまう実装は危険である。MFAのリセット自体を扱う手順は、OWASP Multifactor Authentication Cheat Sheetの「Resetting MFA」で別途詳細に扱われており、パスワードリセットとMFAリセットは異なる強度の本人確認を要求すべきという設計思想が背景にある。

### まとめ: 防御チェックリスト

本節で扱った内容を、実装レビュー時に確認すべき観点として整理する。

- リセット申請フォームのレスポンス（メッセージ・応答時間）は、アカウントの存在有無で差が出ないか
- リセット申請・トークン検証の双方に、アカウント単位／IP単位のレート制限があるか
- リセット申請の繰り返しでアカウントがロックされる実装になっていないか（DoSの温床）
- トークンはCSPRNGで生成され、十分な長さを持ち、ユーザーIDに紐付き、使用後は無効化され、保存時はハッシュ化されているか
- リセットURLのドメイン部分をHostヘッダーから動的に組み立てていないか(ハードコードまたは許可リスト照合)
- リセットページにReferrer-Policy: no-referrerが設定されているか
- 秘密の質問を単独のリセット手段にしていないか
- リセット確定は2段階(申請→リンク/トークン提出による確定)になっており、確定まで旧パスワードが有効か
- リセット完了後、既存セッションを無効化しているか(自動または選択式)
- 通知メールにパスワード自体を含めていないか
- リセット完了後、自動ログインさせず通常のログインフローに一本化しているか
- パスワード変更機能(ログイン済み状態)は現在のパスワードの再入力とCSRF対策を備えているか
- リセット・変更フローがMFAをバイパスしない設計になっているか

これらはいずれも単独の「バグ」ではなく、リセット機能が持つ「認証チャネルの一時的な委譲」という本質的な脅威モデルから導かれる系統的な要件である。実装レビューやペネトレーションテストの際は、個々のチェック項目を機械的に確認するだけでなく、「このフローはどの認証チャネルに何を委ねているか、そのチャネルの信頼性はどう担保されているか」という視点で全体を俯瞰することが、抜け漏れのない防御設計につながる。
