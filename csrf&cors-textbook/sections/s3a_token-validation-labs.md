## トークン検証欠陥のPortSwiggerラボ

CSRF（Cross-Site Request Forgery、クロスサイト・リクエスト・フォージェリ＝罠サイトに誘導した被害者のブラウザに、本人の意図しない状態変更リクエストを送らせる攻撃）の対策として最も普及しているのが「CSRFトークン」だ。トークンとは、サーバがフォームに埋め込んで発行する予測不能なランダム値で、リクエスト受信時にサーバ側の記憶（通常はセッション）と照合する。攻撃者は罠ページからこの値を読めない（Same-Origin Policyによりクロスオリジンでレスポンス本文を読めない）ため、正しいトークンを添えられず攻撃が失敗する——というのが理屈だ。

しかし実運用で受理される（＝賞金が出る）CSRFの多くは「トークンが**無い**」のではなく「トークンは**あるが検証ロジックが甘い**」ケースである。ツールでは見つけにくく、人手のロジック検証が差を生む領域だ。本節ではその代表格である PortSwigger Web Security Academy の 2 つのラボ——(1) トークン検証がリクエストメソッドに依存するケース、(2) トークンが非セッションcookieに紐づくケース——を、**なぜバイパスが成立するのか**という仕組みのレベルまで分解して解説する。あわせて siunam321 の全ラボ・ウォークスルー集を参照する。

> ⚠️ 本節の内容はすべて、防御側が「自分のコードのどこが壊れているか」を理解するための解説である。PortSwigger の各ラボは学習用に用意された使い捨て環境（`YOUR-LAB-ID.web-security-academy.net`）を対象とする。実在サービスや本番環境への無許可の検証は行わないこと。

---

### 前提：CSRFトークンの検証は「3つの照合」で成り立つ

ラボの欠陥を理解する前に、正しいトークン検証が本来満たすべき性質を明確にしておく。トークン検証は概念的に次の照合の連なりだ。

1. **メソッドに関係なく検証が走ること** — 状態変更を起こしうるエンドポイントは、GET でも POST でも PUT でも、常にトークンを検証しなければならない。理想はそもそも状態変更を GET で許さないこと。
2. **トークンが「その被害者のセッション」に紐づくこと** — 発行したトークンは、発行相手のセッションでしか有効であってはならない。誰のセッションでも通る「共通鍵」になってはいけない。
3. **トークンが攻撃者に操作・注入されないこと** — トークン（やトークンを検証する側の材料）が、攻撃者の制御下にある入力から差し替えられてはいけない。

この 3 点のうち、ラボ 1 は **(1) の欠落**（メソッド依存の検証）、ラボ 2 は **(2) と (3) の複合欠落**（非セッションcookie紐づけ＋cookie注入）を突く。以下、順に見ていく。

> 出典: What is CSRF (PortSwigger Web Security Academy) — https://portswigger.net/web-security/csrf

---

### ラボ1：トークン検証がリクエストメソッドに依存する（token validation depends on request method）

#### ラボの構造と脆弱性

対象は自アカウントのメールアドレス変更機能。エンドポイントは `/my-account/change-email`、送信されるパラメータは `email` と `csrf`（トークン）だ。通常の画面遷移では次のような POST フォームが描画される。

```html
<form class="login-form" name="change-email-form"
      action="/my-account/change-email" method="POST">
    <input type="hidden" name="csrf" value="[トークン]">
    <!-- email 入力欄 -->
</form>
```

Burp の Repeater でこの POST リクエストを送り、`csrf` パラメータの値を書き換える（あるいは削る）と、サーバは「Invalid CSRF token」として**拒否する**。ここまではトークン検証が効いているように見える。

ところが、**同じリクエストのメソッドを POST から GET に変える**と挙動が一変する。GET リクエストにすると `csrf` パラメータの有無・正否にかかわらずメール変更が**成功してしまう**。つまりサーバ側の検証コードは「POST のときだけトークンを見る」実装になっており、GET では検証ロジックそのものが走らない。

#### なぜメソッド変更でバイパスできるのか（仕組み）

多くのフレームワークやCSRFミドルウェアでは、検証を「特定の HTTP メソッドだけ」に適用する設計になっている。RFC 7231 が GET / HEAD を「セーフメソッド（安全＝副作用を持たないことが期待される）」と定義しているため、「セーフメソッドはどうせ状態を変えないのだからトークン検証は不要」という前提でスキップする実装が一般的なのだ。例えば擬似コードで書くとこうなる。

```python
# 悪い実装例（概念）
if request.method in ("POST", "PUT", "DELETE", "PATCH"):
    verify_csrf_token(request)   # セーフメソッドだけ検証から漏れる
# GET はここを素通りする
handle_change_email(request.params["email"])
```

問題は、**検証のスキップと「その操作を GET で受け付けないこと」がセットになっていない**点だ。エンドポイント側が `email` パラメータを GET のクエリ文字列からも素直に読んで処理してしまうため、「検証されないメソッド」と「状態変更が可能なメソッド」が一致してしまう。攻撃者はこの隙間、すなわち「検証されないが副作用は起こせる」経路に状態変更を流し込む。

さらにこのバイパスが罠ページから成立する理由は、GET は HTML だけで極めて簡単に発火できるからだ。`<img src>`、`<a href>`、`<form method=GET>` の自動送信、いずれもクロスオリジンで問題なく飛ぶ。攻撃者は被害者のブラウザに、被害者のセッションcookieを自動付与させた GET を撃たせるだけでよい。

#### エクスプロイト（PoC）

罠ページとしては、フォームのメソッドを GET にし、`csrf` の隠しフィールドを取り除いたものを自動送信させる。

```html
<html>
<body>
  <form action="https://YOUR-LAB-ID.web-security-academy.net/my-account/change-email" method="GET">
    <input type="hidden" name="email" value="attacker@evil.com">
  </form>
  <script>
    document.forms[0].submit();
  </script>
</body>
</html>
```

PortSwigger の Burp「CSRF PoC generator」を使うと同種の HTML を自動生成できるが、生成後に**メソッドを GET に変え、`csrf` フィールドを消す**のが本ラボの肝だ。これを Exploit Server にホストして被害者に配信すると、被害者のブラウザが自身のセッションcookie付きで GET を実行し、トークン検証を経ずにメールアドレスが書き換わる。攻撃者は自分のメールとは異なるアドレスを指定する（アカウント乗っ取りにつなげるなら、パスワードリセットを受け取れる自分の支配下のアドレスにする）。

> ⚠️ 上記はラボの使い捨てホスト（`YOUR-LAB-ID.web-security-academy.net`）を対象とした学習用PoCであり、防御実装の検証以外の目的で使用しないこと。

#### 教訓と防御

このラボが示す本質的なミスは「**許可メソッドを制限せずに、検証だけをメソッド条件で分岐した**」ことだ。防御は次の通り。

- 状態変更エンドポイントは GET を**そもそも受け付けない**（ルーティングで POST 等に限定し、GET は 405 Method Not Allowed で弾く）。
- CSRF 検証をメソッドで分岐させるなら、「検証しないメソッド」が「副作用を起こせないメソッド」と厳密に一致していることを保証する。
- 可能なら SameSite cookie（後続章）と多層で守る。ただし SameSite は method override 等でバイパスされうるため、トークン単独の完全性が前提。

> 出典: Lab: CSRF where token validation depends on request method (PortSwigger) — https://portswigger.net/web-security/csrf/bypassing-token-validation/lab-token-validation-depends-on-request-method
> 出典: CSRF where token validation depends on request method (siunam's Website) — https://siunam321.github.io/ctf/portswigger-labs/CSRF/csrf-2/

---

### ラボ2：トークンが非セッションcookieに紐づく（token tied to non-session cookie）

#### ラボの構造と脆弱性

このラボはより巧妙だ。メール変更機能はトークンを持ち、しかも**トークンはちゃんと検証される**。単純なメソッド変更やトークン削除では通らない。だが、トークンの検証材料がセッションとは別の cookie に紐づいているため、そこに欠陥が生じる。

リクエストには 2 つの cookie が関わる。

- `session` cookie — ログインセッションを表す本来の認証情報。
- `csrfKey` cookie — トークン `csrf` を検証するための「鍵」。サーバは `csrf` パラメータをこの `csrfKey` と照合して有効性を判定する。

Burp Repeater で挙動を観察すると、決定的な差が見える。

- `session` cookie を書き換える → **ログアウト扱いになり拒否される**（セッションは正しく検証されている）。
- `csrfKey` cookie を書き換える → **セッションは無効化されず、トークンが「不一致」として拒否されるだけ**。

つまり `csrfKey` はセッションとは独立して評価されている。ここで 2 つのアカウント（wiener と carlos）でそれぞれログインして比較すると、より深い事実が判明する。**片方のアカウントの `csrfKey` cookie と `csrf` パラメータのペアを、もう片方のアカウントのリクエストにそのまま貼り付けても受理される**。トークンは「発行相手のセッション」に一切紐づいておらず、`csrfKey` と `csrf` が整合するペアでありさえすれば、誰のセッションでも通る「持ち運び可能な合鍵」になっている。

#### なぜこれが致命的なのか（仕組み）

正しい実装では、トークンは検証時にサーバ側のセッション状態と結び付けられる（例：`token == hmac(secret, session_id)` のように、そのセッション固有の値から導出・照合する）。だから攻撃者が自分のトークンを持っていても、被害者のセッションでは通らない。

このラボの実装は代わりに「`csrf` パラメータが `csrfKey` cookie と整合するか」だけを見る。`csrfKey` はセッションと独立しているので、攻撃者は次の 2 段構えを組める。

1. 攻撃者自身が **正当な `csrfKey` と `csrf` の整合ペア**を（自分のアカウントで正規に）入手する。
2. そのペアの `csrfKey` を、何らかの方法で**被害者のブラウザに植え付ける**。すると被害者のリクエストに攻撃者の `csrfKey` が乗り、それと整合する `csrf` を攻撃者がフォームに埋め込んでおけば、検証はパスする。被害者の `session` cookie は本物のまま自動付与されるので、操作は被害者本人として実行される。

残る問題は「攻撃者はどうやって被害者のブラウザに任意の `csrfKey` cookie をセットするか」だ。クロスオリジンでは通常、他ドメインのcookieを直接書き込めない。ここで登場するのがもう一つの欠陥——**検索機能を悪用した cookie 注入**である。

#### cookie注入の経路：検索機能のSet-Cookieヘッダインジェクション（CRLFインジェクション）

このラボの検索機能は、検索語を `LastSearchTerm` cookie に保存するため、レスポンスの `Set-Cookie` ヘッダに検索語を反映する。しかもこの検索機能には CSRF 保護が無い。ここで検索語に **CRLF（キャリッジリターン `%0d` ＋ラインフィード `%0a`＝HTTPヘッダの改行）** を注入すると、`Set-Cookie` ヘッダを分割して**追加の `Set-Cookie` ヘッダを丸ごと挿入**できる。これがヘッダインジェクション（CRLFインジェクション）だ。

```
/?search=test%0d%0aSet-Cookie:%20csrfKey=YOUR-KEY%3b%20SameSite=None
```

このURLをデコードすると、サーバのレスポンスはおおよそ次のように改行が割り込む。

```http
Set-Cookie: LastSearchTerm=test
Set-Cookie: csrfKey=YOUR-KEY; SameSite=None
```

なぜこうなるのか。サーバは検索語をエスケープせずに `Set-Cookie: LastSearchTerm=<検索語>` の位置へ連結する。検索語に含めた `%0d%0a`（生の CR LF）はHTTPパーサにとってヘッダの区切りそのものなので、パーサは「2 行目の `Set-Cookie: csrfKey=...` は別個の正当なヘッダだ」と解釈し、被害者のブラウザは攻撃者指定の `csrfKey` を素直に保存する。`SameSite=None` を付けるのは、この cookie がクロスサイト文脈（罠ページから飛ぶ後続リクエスト）でも送信されるようにするためだ（`SameSite=None` は `Secure` 必須だが、ラボはHTTPS前提）。

#### エクスプロイト（PoC）：cookie注入とフォーム送信の順序制御

最終的な罠ページは「①攻撃者の `csrfKey` を被害者ブラウザへ注入 → ②その注入が完了してから、整合する `csrf` を含むメール変更フォームを送信」という**順序**を守る必要がある。順序が逆だと、フォーム送信時にまだ攻撃者の `csrfKey` が入っておらず失敗する。この順序制御に `<img>` の `onerror` を使うのが定石だ。

```html
<html>
  <body>
    <form action="https://YOUR-LAB-ID.web-security-academy.net/my-account/change-email" method="POST">
      <input type="hidden" name="email" value="attacker@evil.com" />
      <input type="hidden" name="csrf" value="YOUR-CSRF-TOKEN" />
    </form>
    <img src="https://YOUR-LAB-ID.web-security-academy.net/?search=test%0d%0aSet-Cookie:%20csrfKey=YOUR-KEY%3b%20SameSite=None"
         onerror="document.forms[0].submit()">
  </body>
</html>
```

動作を段階で追うと次のようになる。

1. **`<img>` が検索エンドポイントを読み込む** — この GET リクエストのレスポンスに注入した `Set-Cookie: csrfKey=YOUR-KEY` が乗り、被害者のブラウザに攻撃者の `csrfKey` が保存される。
2. **`onerror` が発火する** — 画像URLは画像ではない（HTMLが返る）ため読み込みに失敗し、`onerror` ハンドラが呼ばれる。この「失敗＝後続処理のトリガ」を利用して、cookie 注入**完了後**にフォーム送信へ進む。
3. **フォームが送信される** — POST に、いま注入された攻撃者の `csrfKey`（cookie として自動付与）と、それに整合する `csrf`（隠しフィールド）、そして被害者本物の `session` cookie（ブラウザが自動付与）が揃う。
4. **サーバがトークンを検証する** — `csrf` を `csrfKey` と照合。両者は攻撃者が用意した整合ペアなので**パスする**。セッションとの紐づけは検証されない。
5. **メールアドレスが変更される** — 操作は被害者の `session` の下で実行されるため、被害者本人のアカウントのメールが書き換わる。ここからパスワードリセットを経てアカウント乗っ取りへ発展しうる。

`YOUR-KEY`（攻撃者の `csrfKey`）と `YOUR-CSRF-TOKEN`（それに対応する `csrf`）は、攻撃者が自分のアカウントで正規に取得した整合ペアをそのまま使う。

> ⚠️ 上記はラボ環境専用のPoCである。CRLFインジェクションによるcookie注入や他者アカウントへの操作を実在サービスで無許可に行ってはならない。

#### なぜ「セキュアな実装」は防げるのか

適切に防御されたシステムは、トークンを**セッション識別子に紐づける**。具体的には、トークンをセッション固有の秘密から HMAC で導出する、あるいはサーバ側でセッションに保存したトークンと直接照合する。こうすると (a) 別アカウント（別セッション）のトークンを流用しても不一致で弾かれ、(b) cookie を注入されても、そのトークンが被害者のセッションと結び付かない限り無効になる。つまりラボ 2 の 2 段攻撃はどちらの段でも崩れる。

加えて、根の欠陥である検索機能の CRLF インジェクション自体も塞ぐべきだ。ヘッダに反映する値は改行文字を除去・エスケープし、そもそもユーザ入力を `Set-Cookie` に生で載せない。

> 出典: Lab: CSRF where token is tied to non-session cookie (PortSwigger) — https://portswigger.net/web-security/csrf/bypassing-token-validation/lab-token-tied-to-non-session-cookie
> 出典: CSRF where token is tied to non-session cookie (siunam's Website) — https://siunam321.github.io/ctf/portswigger-labs/CSRF/csrf-5/

---

### siunamウォークスルー集（CSRF全ラボ）の位置づけ

siunam321 のサイトは PortSwigger の CSRF ラボ全 12 本を個別ページで網羅したウォークスルー集だ。本節で扱った 2 本のほか、`csrf` はあるが検証が「トークンの存在有無だけ」を見る欠陥（トークンを丸ごと省くと通る）、トークンがユーザセッションに一切紐づかない欠陥、トークンが cookie に単純二重化されている（double submit cookie の実装ミス）欠陥など、トークン検証系の類題が体系的に並ぶ。各ページのURLは末尾番号で区別される。

- CSRF where token validation depends on request method: `.../CSRF/csrf-2/`
- CSRF where token is tied to non-session cookie: `.../CSRF/csrf-5/`
- （関連）token not tied to user session: `.../CSRF/csrf-4/`、token duplicated in cookie: `.../CSRF/csrf-6/`

> ⚠️ **未取得の資料**: 「siunam walkthrough集（CSRF全ラボ）」の**インデックスページ**（`https://siunam321.github.io/ctf/portswigger-labs/CSRF/`）は自動取得できませんでした（理由: HTTP 404 — 一覧ページのパスが変わっており、個別ラボは `csrf-2`, `csrf-5` のように連番URLで公開されている）。全ラボの一覧としてご覧になる場合は、上記の個別URL（末尾の番号を 1〜12 で変える）から各記事へ直接アクセスしてください。
>
> （以下は未取得資料の補足として一般知識に基づく解説です）siunam321 のウォークスルーは各ラボについて「①脆弱性の観察（Repeater での差分）→②整合ペアや注入経路の特定→③Exploit Server 用 HTML の組み立て」という一貫した手順で書かれており、本節で引用した csrf-2 / csrf-5 の記述もこの型に沿う。トークン検証系ラボを一通り解く際は、まず PortSwigger 公式のラボ説明で「何が守られ、何が守られていないか」を読み、詰まったら siunam321 の該当連番ページで具体的な PoC の組み立て順序（特に本節ラボ 2 のような cookie 注入とフォーム送信の順序制御）を確認する使い方が効率的だ。

> 出典: siunam's Website — PortSwigger CSRF Labs（個別ラボ: csrf-2, csrf-5 ほか）— https://siunam321.github.io/ctf/portswigger-labs/CSRF/csrf-2/

---

### 本節のまとめ：トークン検証を壊す2つの型

| ラボ | 壊れている前提 | バイパスの核心 | 防御 |
|---|---|---|---|
| token validation depends on request method | 「メソッドに関係なく検証」(前提1) | GET に変えると検証が走らない。GET は `<img>`/`<form>` で容易に発火 | 状態変更で GET を受け付けない。検証しないメソッド＝副作用不可を厳守 |
| token tied to non-session cookie | 「トークンはセッションに紐づく」(前提2) ＋「トークン材料は攻撃者に注入されない」(前提3) | 整合ペアが持ち運び可能。検索機能の CRLF インジェクションで被害者に `csrfKey` を注入 | トークンをセッション秘密から導出・照合。ヘッダに生入力を載せない |

いずれも「トークンを実装した」だけでは安全にならず、**検証がどのメソッド・どのセッション・どの入力経路に対して健全か**を問わなければならないことを示している。次節以降で扱う SameSite bypass や CORS 悪用と組み合わさると、これらのトークン欠陥はアカウント乗っ取りまで一直線につながる。
