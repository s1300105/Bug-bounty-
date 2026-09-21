# 第3章 CSRFトークン・防御ロジックのバイパス

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

## トークン・防御バイパスの技術解説

CSRF（Cross-Site Request Forgery、サイト間リクエスト偽造。攻撃者が用意した外部サイトから、被害者のブラウザに保持された認証セッションを流用して、被害者が意図しないリクエストを標的サイトへ送らせる攻撃）に対する防御は、CSRFトークン（サーバーが発行し、正規のフォーム送信でのみ一緒に送られてくることを期待する秘密かつ予測不能な値）、SameSite属性（Cookieがどのサイト間コンテキストで送信されるかを制御するCookie属性）、Referer/Originヘッダ検証など複数存在する。しかし、これらの実装には共通して「検証ロジックの穴」が生まれやすい。本節では、実装上どこに穴が生じやすいのか、なぜその穴が生まれるのかを仕組みレベルで解説する。防御側がこの原理を理解することで、自組織の実装レビュー観点として活用できる。

### 1. トークン検証ロジックそのものの欠陥

CSRFトークンは「送られてきたら正しいか検証する」という発想で実装されることが多いが、これは裏を返せば「送られてこなかった場合の扱い」がしばしば見落とされる、ということを意味する。実際に報告されている典型的な欠陥パターンは次の4つに整理できる。

1. **トークン未送信時のフォールバック欠如**: サーバー側の検証コードが「トークンが存在する場合のみ突き合わせを行う」という条件分岐になっていると、パラメータ自体を削除したリクエストは検証ロジックを一切通過せずに処理されてしまう。これは、多くの検証コードが `if (token_param exists) { compare(token_param, session_token) }` という形で書かれ、「存在しない場合はエラーにする」という else 節が抜け落ちることに起因する。
2. **空値・ダミー値の許容**: トークンパラメータ自体は残しつつ値を空文字にしたり、適当な文字列に置き換えたりしても、比較ロジックが「両者が空文字同士なら一致とみなす」といった意図しない挙動をする、あるいは型変換の過程で緩い比較（例: 言語によっては `"0" == false` のような緩い等価判定）が働き、検証をすり抜けることがある。
3. **セッションに紐付いていないトークン**: トークンがユーザーごと・セッションごとに発行されず、アプリケーション全体で共通の値であったり、生成アルゴリズムに予測可能性が残っていたりする場合、攻撃者は自分のアカウントで正規に取得した有効なトークンをそのままPoC（概念実証コード）に埋め込むだけで攻撃が成立する。この場合「トークンが存在し、かつ形式的に正しい」という検証は通過してしまう。Intigritiのガイドはこの点を強く指摘しており、「セッションに紐付いていないなら、有効なトークンをPoCにハードコードするだけでCSRF防御を回避できる」と説明している。
4. **長さのみを見た検証**: トークンの妥当性判定が「一定の長さの文字列であるか」だけをチェックしている実装では、攻撃者が同じ文字数のランダム文字列を生成して送信するだけで通過してしまう場合がある。

> 出典: Cobalt: CSRF & Bypasses — https://www.cobalt.io/learning-center/csrf-bypasses

これらはいずれも「検証ロジックの分岐網羅性」の問題であり、防御側は次のような設計原則を徹底する必要がある。

- トークンパラメータが存在しない、または空である場合は、比較を試みる前に即座にリクエストを拒否する。
- トークンは必ずサーバー側セッション（またはユーザー単位の秘密鍵から導出した値）に紐付け、リクエストごとにサーバー側の期待値と暗号学的に安全な定数時間比較で照合する。
- トークンの長さやフォーマットのみでなく、値そのものをセッションストアの値と突き合わせる。

### 2. フレームワーク固有のパース挙動を突いたバイパス（Laravel の事例）

Cobaltの記事で紹介されている興味深い事例が、Laravel（PHPのWebアプリケーションフレームワーク）における型ジャグリング（type juggling。動的型付け言語が、比較や演算の際に暗黙のうちに型変換を行うことで、開発者の意図しない等価判定が成立してしまう現象）を突いたバイパスである。

記事は「CSRFトークンの85%は英字またはゼロで始まる」という統計的観察を紹介し、これを踏まえて次のようなJSON形式のリクエストでトークン値に数値の `0` を指定する手法を示している。

```
contentType: 'application/x-www-form-urlencoded; charset=UTF-8; /json',
data: '{"action": "delete", "_token": 0}'
```

**なぜこれが機能しうるのか**: PHPのような緩い型比較を行う言語では、文字列とゼロを比較すると、文字列が数字で始まらない場合や特定のパターンでは `"abc123..." == 0` が `true` と評価されてしまう歴史的経緯がある（PHP 8以降ではこの挙動は大きく是正されているが、レガシーなコードベースや、独自に緩い比較関数を実装しているアプリケーションでは依然としてリスクが残る）。トークン比較部分のコードが `==`（緩い比較演算子）を用いて実装されており、かつサーバーが期待するセッション上のトークン文字列がたまたま数字っぽい先頭文字を持つケース、あるいは比較関数自体が数値変換を経由する実装になっていた場合、攻撃者が送る値を `0` にするだけで比較が真になってしまう。

**なぜ Content-Type を `application/x-www-form-urlencoded; charset=UTF-8; /json` のような一風変わった形式にしているのか**: これはサーバー側・フレームワーク側のContent-Typeパーサが、セミコロン区切りのパラメータ部分を厳密に検証せず、本体の値だけをJSONとしてデコードしてしまう挙動を悪用したものである。ブラウザの単純フォーム送信で許可される定型のContent-Type（後述）以外の値を使うと通常はCORSのプリフライト（実リクエストの前にブラウザが自動送信するOPTIONSリクエストによる事前確認）が必要になるが、フレームワーク側の緩いパースが、こうした亜種のContent-Type文字列でも本体をJSONとして解釈してしまうことで、単純リクエストの制約を実質的に回避してしまう場合がある、という指摘である。

> ⚠️ **未取得の資料補足**: この具体的な組み合わせが機能する正確な条件（対象Laravelバージョン、PHPバージョン、比較関数の実装箇所）は原典記事内でも詳細な検証コードまでは示されていない。（以下は一般知識に基づく補足）type juggling によるトークン比較バイパスは歴史的にPHPアプリケーション全般で報告されてきた問題であり、PHP 8.0でのゆるい比較の仕様変更（数値文字列との比較の扱いが変更された）により多くのケースは解消されているが、`hash_equals()` のような定数時間・厳密比較用の関数を使わずに独自の `==` 比較でトークン検証を書いているコードは依然としてリスクを抱える。防御側は必ず `hash_equals()`（PHP）や、各言語で提供される定数時間文字列比較APIを用い、緩い等価演算子でのトークン比較を排除すべきである。

> 出典: Cobalt: CSRF & Bypasses — https://www.cobalt.io/learning-center/csrf-bypasses

### 3. HTTPメソッド差し替えによるバイパス

CSRF対策がPOSTメソッドのみに実装され、GETメソッドには適用されていないアプリケーションが存在する。この場合、攻撃者はPOSTで送るべきパラメータをGETのクエリ文字列に載せ替えるだけで、トークン検証ロジックを迂回できる。

**なぜこれが起こるのか**: 開発者が「状態を変更する操作はPOSTで実装されるはずだ」という前提のもとにCSRF対策ミドルウェアをPOSTリクエストにのみフックしている場合、同じ処理を実装しているエンドポイントが誤ってGETでも受理可能になっていると、防御ロジックそのものが素通りされる。これはHTTPメソッドの意味論（GETは安全でべき等な操作、POSTは状態変更を伴う操作、というRESTの原則）が実装レベルで徹底されていないことに起因する構造的な欠陥である。

さらに関連する手法として、**HTTPメソッドオーバーライド**（`_method`のようなクエリパラメータや`X-HTTP-Method-Override`ヘッダによって、実際のHTTPメソッドをフレームワーク内部で別のメソッドとして扱わせる仕組み。RESTfulなAPI設計でPUT/DELETEをブラウザのフォームから擬似的に送るために使われる）を悪用する手法がある。

```html
<script>
document.location = "https://target.com/my-account/change-email?email=attacker@x&_method=POST";
</script>
```

**なぜこれが機能するのか**: これは単純ページ遷移によるGETリクエストであるため、ブラウザは通常のトップレベルナビゲーションとして扱い、SameSite=Lax（後述）が設定されたCookieであっても送信対象となる。フレームワーク側が `_method` パラメータを見て内部的にPOSTとして処理する実装になっていると、見た目はGETのナビゲーションでありながら、実質的にPOST相当の状態変更処理が実行されてしまう。これはSameSite=Laxの「トップレベルナビゲーションのGETは許可する」というブラウザ側のポリシーと、「メソッドオーバーライドで実質POSTを実行できる」というサーバー側の実装が組み合わさることで生まれるバイパスである。

> 出典: Cobalt: CSRF & Bypasses — https://www.cobalt.io/learning-center/csrf-bypasses

### 4. Referer / Origin ヘッダ検証のバイパス

Refererヘッダ（リクエスト元のページURLをブラウザが自動付与するヘッダ）やOriginヘッダ（リクエスト元のオリジンのみを付与するヘッダ）による検証は、トークンを使わない簡易なCSRF対策として広く使われているが、以下の理由で回避可能な場合がある。

**(a) Refererヘッダの送信自体を止める**

```html
<meta name="referrer" content="no-referrer">
```

**なぜ機能するのか**: `Referrer-Policy`（この`meta`タグでの指定名は `referrer` だが、意味上はReferrer-Policyの制御である）を`no-referrer`に設定すると、ブラウザはそのページから発生するナビゲーションやリソース取得においてRefererヘッダを一切送信しなくなる。サーバー側の検証ロジックが「Refererヘッダが存在し、かつ許可リストのドメインと一致する場合のみ許可」ではなく、「Refererヘッダが存在しない場合は検証をスキップして許可してしまう」という誤った設計になっていると、ヘッダを消してしまうだけで検証全体を無効化できる。これは「開発者が、ブラウザは常にRefererを送るはずだ、送らないリクエストはあり得ない」という誤った前提を置いてしまうことに起因する典型的な欠陥である。実務上は、プライバシー保護機能やユーザー環境の設定によって正規のユーザーでもRefererが欠落するケースが現実にあるため、開発者は「欠落時は拒否せずスルーする」という妥協をしてしまいがちであり、これがバイパスの温床になる。

**(b) 部分一致・サブドメイン埋め込みによる許可リスト回避**

RefererやOriginの検証が、値に対象ドメイン文字列が「含まれているか」という単純な部分一致（正規表現の書き方の誤り、または `indexOf`/`contains` のような素朴な文字列検索）で実装されている場合、攻撃者は自分の管理するドメインのサブドメイン部分に対象ドメイン名を埋め込むことで検証を通過させられる。例えば `cobalt.io` を許可したい場合に、`cobalt.io.attacker.io` のようなドメインを取得すれば、文字列としては `cobalt.io` を含んでいるため、誤った正規表現（例えば `.*cobalt\.io.*` のように前後を `^`/`$` で固定していない、あるいはドット直前の位置を検証していないパターン）は真を返してしまう。

**なぜこれが原理的に起こるのか**: ドメイン名の構造は右から左に親子関係を持つ（`attacker.io` の管理者は `cobalt.io.attacker.io` という任意のサブドメインを自由に発行できる）。文字列としての部分一致検査はこの構造的な意味論を考慮しないため、「ある文字列を含む」という判定と「そのドメインの所有者が誰か」という判定は全く別物になる。正しい検証は、Originヘッダの値を厳密にパースし、スキーム・ホスト全体が許可リストの値と完全一致するか、あるいは「許可ドメインの直前にドットがあり、かつそれが文字列の末尾（サブドメイン形式）である」ことまで検証する必要がある。

> 出典: Cobalt: CSRF & Bypasses — https://www.cobalt.io/learning-center/csrf-bypasses
> 出典: Intigriti: CSRF Advanced Exploitation Guide — https://www.intigriti.com/researchers/blog/hacking-tools/csrf-a-complete-guide-to-exploiting-advanced-csrf-vulnerabilities

### 5. Content-Type を利用したCORS/CSRF検証の迂回

ブラウザのCORS（Cross-Origin Resource Sharing）仕様には「単純リクエスト（simple request）」という概念があり、以下の条件を満たすリクエストはプリフライト（事前のOPTIONSリクエストによる許可確認）なしに、クロスオリジンでも直接送信されてしまう。

- メソッドが GET / HEAD / POST のいずれかである
- Content-Typeが次のいずれかである
  - `application/x-www-form-urlencoded`
  - `multipart/form-data`
  - `text/plain`
- カスタムヘッダを付与していない

多くのAPIはJSON (`application/json`) でのみリクエストを受け付ける設計になっており、開発者は「JSONでしか受け付けないのだから、通常のフォームからは攻撃できない、CORSのプリフライトで守られている」と誤解しがちである。しかし、バックエンドの実装によっては、Content-Typeが`text/plain`であってもリクエストボディをJSONとしてパースしてしまう、あるいは`application/x-www-form-urlencoded`で送られたキー・バリューをそのまま処理に流用できてしまうケースがある。

Intigritiの記事は、`enctype="text/plain"`を用いてJSONに近い文字列をフォームの`name`/`value`として組み立てる次のようなテクニックを示している。

```html
<form action="https://app.example.com/api/profile/update" method="POST" enctype="text/plain">
  <input type="hidden" name='{"test":"x' value='y","new_email":"attacker@example.com"}'/>
  <input type="submit" value="Submit request"/>
</form>
```

**なぜこれが機能するのか**: HTMLフォームで`enctype="text/plain"`を指定すると、ブラウザは各`input`の`name`と`value`を `name=value` の形式で改行区切りに連結してボディを構築する。この連結ルールを逆手に取り、`name`属性の末尾に不完全なJSONの開き部分を、`value`属性の先頭に残りのJSONを仕込むことで、ブラウザが生成する最終的なボディ全体が正しい構文のJSON文字列になるように細工している。つまり `{"test":"x` (name) と `y","new_email":"attacker@example.com"}` (value) を `=` で連結すると `{"test":"xy","new_email":"attacker@example.com"}` という一つのJSONオブジェクトが出来上がる。ここでのポイントは、Content-Typeは仕様上`text/plain`（単純リクエストの許可対象）であるためプリフライトが発生しないにもかかわらず、サーバー側は本体を見てJSONとしてパースしてしまう、という「宣言されたContent-Typeと実際のパース処理の不一致」を突いている点である。防御側はContent-Typeヘッダを見た目上信用するだけでなく、そのContent-Typeで許可されている形式以外のパースを行わないよう厳密化する必要がある。

同様の考え方で、Cobaltの記事もJSON専用APIに対して`application/x-www-form-urlencoded`や`multipart/form-data`、あるいはこれらとJSONを組み合わせたハイブリッドなContent-Type文字列を試すことを挙げている。

> 出典: Cobalt: CSRF & Bypasses — https://www.cobalt.io/learning-center/csrf-bypasses
> 出典: Intigriti: CSRF Advanced Exploitation Guide — https://www.intigriti.com/researchers/blog/hacking-tools/csrf-a-complete-guide-to-exploiting-advanced-csrf-vulnerabilities

### 6. SameSite Cookie 属性のバイパス

SameSite属性は、Cookieがクロスサイトのコンテキストで送信されるかどうかをブラウザレベルで制御する仕組みであり、`Strict`・`Lax`・`None`の3値を取る。現代のブラウザ（Chromeは2020年以降、`SameSite`未指定のCookieを`Lax`として扱うデフォルト仕様に変更している）では`Lax`が事実上の既定値になっているため、CSRF対策として一定の効果を持つが、以下のように挙動の細部を突いたバイパスが報告されている。

**(a) SameSite=Strict のバイパス（同一サイト内リダイレクトの悪用）**

`Strict`はクロスサイトのナビゲーションであってもCookieを一切送信しない最も厳格な設定である。しかし、アプリケーション自身が持つオープンリダイレクトやパストラバーサル（パス中の`../`のような相対パス表記を悪用して、本来意図されたパス階層から逸脱した別のリソースやエンドポイントへアクセスさせる手法）的な脆弱なリダイレクト機能を悪用すると、攻撃者は「外部サイトから開始されたが、最終的には同一サイト内で完結するリクエスト」を作り出せる。Cobaltの記事は次のような例を示している。

```html
<script>
document.location = "https://target.com/post/comment/confirmation?postId=1/../../my-account/change-email?email=attacker@x";
</script>
```

**なぜこれが機能するのか**: `SameSite=Strict`の判定基準は「リクエストが発生した文脈（トップレベルの遷移元がどのサイトか）」ではなく、実際には「そのHTTPリクエストの送信先が、現在のドキュメントと同一サイトかどうか」というブラウザの実装上の判定に依存する。上記の例では、`document.location`によるページ遷移自体は攻撃者のページ（クロスサイト）から開始されているが、実際にブラウザが送信するリクエストの宛先URLは`target.com`というターゲットサイトそのものである。ブラウザは「このリクエストの送信先がCookieの発行元と同一サイトである」と判定し、`Strict`のCookieであっても同梱して送信してしまう。つまり `SameSite=Strict` は「遷移元がどこか」ではなく「リクエスト送信先がどこか」を基準に動作するため、対象サイト自身のURLパス構造に脆弱なリダイレクトやパス正規化のバグ（`postId=1/../../my-account/change-email`のようにパストラバーサル文字列をURLパスの一部として受理し、サーバー側またはルーティング層で`../`を解決してしまうと、意図しないエンドポイントに到達する）が存在すると、攻撃者はそれを踏み台にして実質的にクロスサイト発生源からのリクエストを「同一サイト行き」の見た目に偽装できる。

**(b) SameSite=Lax のバイパス（トップレベルナビゲーション + メソッドオーバーライド）**

`Lax`は、リンククリックなどのトップレベルナビゲーションで発生するGETリクエストに限りCookie送信を許可する。これは「ページ遷移でログイン状態が急に切れて見えるとユーザー体験を損なう」という理由から設けられた緩和策である。しかし、この「GETのトップレベルナビゲーションは許可する」という条件と、前述の「メソッドオーバーライドによってGETリクエストを実質的にPOSTとしてサーバーに処理させる」という実装上の弱点を組み合わせると、`Lax`は容易に無力化される。

```html
<script>
document.location = "https://target.com/my-account/change-email?email=attacker@x&_method=POST";
</script>
```

これは前述のメソッドオーバーライドの節で説明した通り、GETによるトップレベルナビゲーションとしてブラウザに認識されるためSameSite=LaxのCookieも送信対象となり、かつサーバー側は`_method=POST`パラメータを見て内部的に状態変更処理（本来POSTでのみ許可されるべき処理）を実行してしまう。

**防御側の要点**: SameSite属性は強力だが単独の防御層として過信すべきではない。特に、(1) アプリケーション内のリダイレクト・パス処理にオープンリダイレクトやパストラバーサルの余地を残さないこと、(2) HTTPメソッドオーバーライド機能を状態変更系のエンドポイントでは無効化するか、CSRFトークンによる検証と併用すること、が重要である。SameSiteとトークン方式は排他的な選択肢ではなく、多層防御として併用するのが原則である。

> 出典: Cobalt: CSRF & Bypasses — https://www.cobalt.io/learning-center/csrf-bypasses

### 7. Double Submit Cookie 方式のバイパス

Double Submit Cookie（二重送信Cookieパターン。サーバーがトークンをCookieとレスポンスボディの両方に埋め込み、クライアントはJavaScriptでCookieの値を読み取ってリクエストパラメータにも同じ値を載せる。サーバー側はセッションストアを持たずに、リクエストパラメータとCookieの値が一致するかどうかだけで検証する軽量な実装方式）は、サーバー側にセッション状態を保存せずに済む利点から広く使われるが、次のような弱点がある。

Cobaltの記事は、セッション固定（session fixation。攻撃者が事前に用意したセッションIDを被害者に強制的に使わせることで、被害者がログインした後もそのセッションIDを攻撃者が把握し続けられるようにする攻撃）を組み合わせた手口を紹介している。攻撃者は、あらかじめ自分が把握しているCookie値を被害者のブラウザに設定させ、その後、そのCookie値と同じ値をリクエストパラメータとしても送信するCSRF PoCを作成する。

**なぜこれが機能するのか**: Double Submit Cookie方式の安全性は「攻撃者はCookieの値を読み取れない（同一オリジンポリシーにより、他サイトのJavaScriptから対象サイトのCookieは読み取れない）」という前提の上に成り立っている。しかし、攻撃者があらかじめCookieの値そのものを（セッション固定などの手段で）決定できてしまえば、この前提が崩れ、攻撃者はCookie値とパラメータ値の両方を自分で用意して一致させることができる。これは「値の秘匿性」ではなく「値の由来（誰が最初に生成したか）」が防御の本質であるにもかかわらず、実装が単なる値の一致比較に留まっている場合に生じる設計上の欠陥である。防御側は、Cookieの値をサーバー側で暗号学的に安全な方法で生成し、かつセッション固定攻撃自体を別途防止する（ログイン成功時に必ずセッションIDとトークンを再生成する）ことが必須となる。

> 出典: Cobalt: CSRF & Bypasses — https://www.cobalt.io/learning-center/csrf-bypasses

### 8. その他の間接的なバイパス経路

CSRF単体の防御ロジックを直接破らずとも、他の脆弱性と組み合わせることで実質的にCSRF防御を無効化できる場合がある。

- **XSSを起点としたバイパス**: XSS（クロスサイトスクリプティング）が存在する場合、攻撃者はそのXSSを通じて被害者のブラウザ上で任意のJavaScriptを実行できるため、CSRFトークンをページから直接読み取ってリクエストに含めることができる。これはCSRF対策そのものの欠陥ではないが、「XSSが一つでも存在すれば、その脆弱なページと同一オリジンのCSRFトークンはすべて無意味になる」という重要な原則を示している。同一オリジンポリシーはオリジン単位で防御するため、一つのページのXSSが同一オリジン内の他の機能のCSRFトークンの秘匿性を全て破壊してしまう。
- **クリックジャッキング（Clickjacking）との組み合わせ**: 透明なiframeを重ねて被害者に意図しないクリックをさせる手法。トークンによるCSRF対策が正しく機能していても、被害者自身に正規の操作をワンクリックで実行させてしまうため、CSRF対策の枠組み自体を迂回するのではなく、無効化する形の攻撃となる。`X-Frame-Options`や`Content-Security-Policy`の`frame-ancestors`ディレクティブによるiframe埋め込み制限が別途必要である。
- **Flash（SWFファイル）を利用したJSONリクエストのバイパス**: 歴史的には、Adobe Flash Playerのソケット/HTTPリクエスト機能を悪用し、任意のContent-Typeやメソッドでクロスオリジンリクエストを発生させる手法が存在した。ただし、Flash Playerは主要ブラウザで2020年末までに完全にサポートが終了しており、現代の環境ではこの経路は実質的に無効である。防御設計の歴史的経緯として理解しておく価値はあるが、現行のセキュリティレビューでの優先度は低い。

> 出典: Cobalt: CSRF & Bypasses — https://www.cobalt.io/learning-center/csrf-bypasses

### 9. 体系的なテスト手順（防御レビューの観点として）

Intigritiのガイドは、CSRFトークンの堅牢性を検証する際の体系的な手順を示している。防御側はこれをそのままセキュリティレビューのチェックリストとして活用できる。

1. **トークン省略テスト**: リクエストからトークンパラメータを完全に取り除いて送信し、拒否されることを確認する。
2. **空値送信テスト**: トークンパラメータは残したまま値のみを空にして送信し、拒否されることを確認する。
3. **無作為な値への置換テスト**: 別のランダムな値に置き換えて送信し、拒否されることを確認する。
4. **同一長のランダム値によるテスト**: 元のトークンと同じ文字数のランダムな値を生成して送信し、拒否されることを確認する。
5. **セッション非依存性の確認**: 別セッション（別アカウント、あるいはログアウト後に再度ログインして取得した新しいトークン）で取得した有効なトークンを、元のセッションのリクエストに転用して送信し、拒否されることを確認する。

Intigritiのガイドが強調する核心的な原則は、「トークンの検証が実装されていること」自体は十分条件ではなく、「トークンがセッションに厳密に紐付いていること」が必須条件だという点である。トークンが正しいフォーマットであることしか検証していない実装は、上記5.のテストで容易に破綻する。

> 出典: Intigriti: CSRF Advanced Exploitation Guide — https://www.intigriti.com/researchers/blog/hacking-tools/csrf-a-complete-guide-to-exploiting-advanced-csrf-vulnerabilities

### 10. 参考: 基本的なCSRF PoCの構造

最後に、Intigritiのガイドに示されている最も基本的なCSRF PoC（概念実証）フォームの構造を確認しておく。これは自動送信フォームとして、対象サイトへの状態変更リクエストを被害者のブラウザから発生させるテンプレートである。

```html
<form method="POST" action="https://app.example.com/api/profile/update">
  <input type="hidden" name="new_email" value="user@example.com">
  <input type="submit" value="Submit Request">
</form>
```

実際の悪用ではこのフォームに`<script>document.forms[0].submit()</script>`のような自動送信スクリプトが付加され、被害者のクリックすら不要になる場合が多い。防御側の観点では、この最も単純な形のPoCが通ってしまう時点で、CSRFトークンの実装そのものが存在しない、または上記のいずれかのバイパスパターンに該当していることを意味する。ガイドが示す脆弱性成立の前提条件は次の3点に整理されている。

- 対象エンドポイントが権限を伴う（特権的な）機能を提供している
- 関連CookieのSameSite属性が`None`または`Lax`に設定されている（`Strict`ではない、あるいは前述のバイパス手法が有効な状況にある）
- リクエストに予測不能な値（CSRFトークンなど）が含まれていない、または含まれていても検証されていない

この3条件がすべて満たされて初めてCSRFが成立する、という整理は、防御側が「どの層で1つでも条件を崩せば攻撃を防げるか」を設計する際の指針として有用である。すなわち、トークン検証・SameSite属性・機能自体の権限設計という3つの独立した防御層を重ねることが、単一の実装ミスによる全面的な防御破綻を避ける最も確実な方法である。

> 出典: Intigriti: CSRF Advanced Exploitation Guide — https://www.intigriti.com/researchers/blog/hacking-tools/csrf-a-complete-guide-to-exploiting-advanced-csrf-vulnerabilities

## JSON CSRF（text/plainでsimple request化）

### なぜ「JSON APIはCSRFに強い」と誤解されるのか

多くの開発者は「JSONを受け付けるAPIエンドポイントはCSRFの心配がない」と考えがちです。その根拠は、通常JSONを送信する際にはブラウザの`fetch`や`XMLHttpRequest`（XHR）を使い、`Content-Type: application/json`を明示的に指定するため、ブラウザが「単純ではないリクエスト（non-simple request）」と判断し、実際のリクエストを送る前に**プリフライトリクエスト（preflight request）**――サーバに「このオリジンからのこのメソッド・ヘッダーでのリクエストを許可するか」を`OPTIONS`メソッドで事前に問い合わせる仕組み――を発生させる、という前提にあります。プリフライトでサーバがクロスオリジンを許可しなければ、ブラウザは実リクエストの送信自体を止めてくれます。

しかし、この防御は「攻撃者が`application/json`というContent-Typeを律儀に使う」ことを前提にしています。攻撃者はブラウザの標準的な**HTMLフォーム**を使ってCSRFを仕掛けるため、実際にはブラウザが定義する「simple request（単純リクエスト）」の条件さえ満たせば、プリフライトを一切発生させずにJSON相当のペイロードをサーバへ送り込めてしまいます。これがJSON CSRF、特に「`text/plain`によるsimple request化」と呼ばれる攻撃の核心です。

> 出典: PentesterLab Glossary — JSON CSRF — https://pentesterlab.com/glossary/json-csrf

### CORSのsimple requestとは何か（仕組みレベルの理解）

Fetch/CORS仕様では、以下の条件をすべて満たすリクエストを「simple request」として扱い、プリフライトを省略してよいと定義しています。

- メソッドが `GET` / `HEAD` / `POST` のいずれかである
- 送信するリクエストヘッダーが、`Accept`・`Accept-Language`・`Content-Language`・`Content-Type`（下記の制限付き）など、あらかじめ許可された「CORS-safelisted request-header」の範囲に収まる
- `Content-Type`ヘッダーの値が、`application/x-www-form-urlencoded`・`multipart/form-data`・**`text/plain`**のいずれかである

つまり、`Content-Type: application/json`はこのリストに含まれないため通常はプリフライトが発生しますが、**`Content-Type: text/plain`を指定した瞬間、リクエストは「simple」に分類され、プリフライトなしでサーバへ届いてしまう**のです。ブラウザ自身はJSONかどうかという中身（ボディの内容）を検査しません。CORSの判定はあくまで「メソッド」と「ヘッダー」という外形的な条件だけを見ており、ボディに何を書くかは関知しないという実装上の割り切りが、この抜け穴の根本原因です。

さらに重要なのは、HTMLの`<form>`要素には標準で`enctype="text/plain"`という属性値が用意されている、という事実です。フォームの`enctype`に`text/plain`を指定すると、ブラウザはXHR/fetchを一切使わずに、**通常のフォーム送信（ページ遷移を伴うPOST）**として`Content-Type: text/plain`のリクエストを生成できます。これはCORSの土俵にすら乗らない、古典的なクロスサイトのフォーム送信であり、そもそもプリフライトという概念自体が適用されません。攻撃者にとっては、CORSの穴を突くよりもさらに単純な経路です。

### 攻撃手法1: `enctype="text/plain"`フォームでJSONを偽装する

`enctype="text/plain"`のフォームは、`name=value`の各フィールドを改行区切りで連結してボディを作ります。たとえば以下のフォームを考えます。

```html
<form action="https://victim.example/api/updateUserInfo" method="POST" enctype="text/plain">
  <input type="hidden" name='{"accountName":"attacker-controlled","role":"admin", "ignore_me":"' value='"}'>
</form>
<script>document.forms[0].submit()</script>
```

このフォームが生成する生ボディは次のようになります。

```
{"accountName":"attacker-controlled","role":"admin", "ignore_me":"="}
```

一見奇妙に見えますが、ポイントは**`name`属性そのものにJSONの前半部分（キーの並びとコロン）を押し込み、`value`属性にJSONの後半（末尾の`"}`）を押し込む**ことで、`name=value`という強制フォーマットの中に完全な1行のJSON文字列を成立させている点です。サーバ側のJSONパーサーが多少の余分な空白や末尾のノイズに寛容であれば、このボディはそのまま正規のJSONオブジェクトとして解釈されます。

この手法は、DirectDefenseの記事でも同様の考え方として、`"foo="` のようなキーに`"bar"`のような値を割り当てて等号(`=`)を含む文字列を作り、フォームの`name=value`構造をJSONの構文に無理やり適合させる例として紹介されています。要は「フォームのエンコーディング規則とJSONの構文規則の交差点」を突く攻撃です。

> 出典: DirectDefense — CSRF in the Age of JSON — https://www.directdefense.com/csrf-in-the-age-of-json/

サーバがこの`text/plain`ボディを受け取ったときに何が起きるかは、フレームワークのボディパーサー実装に依存します。多くのWebフレームワーク（Express+body-parser、Djangoのミドルウェア構成、一部のtRPC実装など）は、パフォーマンスや利便性のために「Content-Typeにかかわらずボディの先頭が`{`や`[`ならJSONとしてパースを試みる」という**寛容なcontent-typeスニッフィング（推測処理）**を実装していることがあり、これがJSON CSRFを成立させる直接の技術的原因になります。逆に、Content-Typeを厳密にチェックし`application/json`以外を無条件に拒否するサーバでは、この経路は成立しません。

### 攻撃手法2: CORSの動的Origin反射 + `credentials: true`による「本物の」JSON CSRF

上記のtext/plain偽装は「JSONに見せかけたテキスト」を送る手法でしたが、サーバ側のCORS設定に不備があれば、攻撃者は**正真正銘の`application/json`リクエストを、認証Cookie付きで**クロスオリジンから送信できてしまいます。条件は次の2つです。

1. `Access-Control-Allow-Origin`（ACAO）ヘッダーが固定のホワイトリストではなく、**リクエストの`Origin`ヘッダーをそのまま反射（エコー）**して返している
2. `Access-Control-Allow-Credentials: true` が同時に返っている

CORS仕様では、ワイルドカード`*`とAllow-Credentials: trueの組み合わせはブラウザ側でエラーとして拒否されるため、Cookie付きのクロスオリジンアクセスを許可したいサーバの多くは、代わりに「リクエストの`Origin`をそのまま返す」実装を選びがちです。これは一見ホワイトリスト運用に見えて、実質的にはあらゆるオリジンを許可しているのと同じであり、攻撃者は自分のドメインから次のようなコードを実行するだけで済みます。

```javascript
const xhr = new XMLHttpRequest();
xhr.open("POST", "https://victim.example/api/transfer", true);
xhr.withCredentials = true; // Cookieを含めて送信させる
xhr.setRequestHeader("Content-Type", "application/json");
xhr.onload = () => { /* レスポンスも読み取れてしまう */ };
xhr.send(JSON.stringify({ toAccount: "attacker-account", amount: 100000 }));
```

`withCredentials = true`は「このクロスオリジンXHRにCookie等の資格情報を含めて送信し、レスポンスも読み取りたい」という明示的な指定です。プリフライトは発生しますが、サーバが動的にOriginを反射している限りプリフライトにも通過してしまい、実リクエストが認証Cookie付きで届きます。これは単なるCSRF（送信のみ、レスポンス閲覧は不可）を超えて、**レスポンスの読み取りまで可能になる**点で、通常のCSRFより危険度が高いことにも注意が必要です。銀行の送金APIのように、エンドポイントやパラメータ名が全ユーザーで共通・固定であるほど、攻撃者は値だけを差し替えた汎用ペイロードを用意できます。

> 出典: DirectDefense — CSRF in the Age of JSON — https://www.directdefense.com/csrf-in-the-age-of-json/

### 攻撃手法3: リクエストボディを消してクエリパラメータ化し、simple requestに落とし込む

もう一つの実戦的なバイパスとして、「JSONボディで送るはずのパラメータを、URLのクエリ文字列に移し替えてしまう」手法があります。ある非公開バグバウンティ案件の報告によれば、対象APIは本来`Content-Type: application/json`のボディでメールアドレス変更などの操作を受け付けており、CORSも正しく設定されていたためXHRベースの非simpleリクエストは正しくブロックされていました。しかし調査の結果、**リクエストボディを空にし、本来ボディに入れるはずだったパラメータ（例: `email`）をクエリパラメータとしてURLに付与するだけで、サーバは同じ処理を実行してしまう**ことが判明しました。ボディを使わずクエリパラメータだけで完結する`POST`リクエストは、Content-Typeの指定すら不要な単純リクエストとして成立するため、通常の`<form>`によるGET/POST送信、あるいは`<img>`タグの`src`に相当するテクニックだけでCSRFが成立します。

```html
<form action="https://victim.example/api/updateEmail?email=attacker@evil.example" method="POST"></form>
<script>document.forms[0].submit()</script>
```

これは「JSONのパース経路」ではなく「サーバが同じロジックにたどり着く別入力経路（クエリパラメータ）を残していた」という**入力経路の非対称性**を突くものです。JSON専用のCSRF対策（Content-Type検証やJSONボディ内のトークン確認）を実装していても、サーバ実装のどこかでクエリパラメータからも同じフィールドを読み取れる設計になっていると、対策そのものを迂回されてしまいます。

> 出典: InfoSec Writeups — Busting CSRF: The Hidden Dangers of JSON Exploited — https://infosecwriteups.com/busting-csrf-the-hidden-dangers-of-json-exploited-fd4aeb4cf47e （直接取得は403でブロックされ、検索結果の要約から内容を再構成しています）

### 攻撃手法4: フォーム送信そのものによるContent-Type不問突破、および関連バイパスの分類

System Weaknessの解説記事は、JSON CSRFの成立条件を実装側の防御レベルに応じて次の4パターンに整理しています。

1. **Content-Typeを一切検証しない**場合: 通常のHTMLフォーム（`enctype="text/plain"`や`application/x-www-form-urlencoded`）でそのまま攻撃可能
2. **POSTデータの形式（パース可能性）だけを検証**する場合: `fetch`をフォーム経由の`no-cors`モードやリンクタグと組み合わせ、パース可能な形式に整形したペイロードを送る
3. **Content-Typeを厳密に`application/json`のみに限定**している場合: XHR/`fetch`を使う必要があるため、前述のCORS誤設定（動的Origin反射＋credentials true）が必須条件になる
4. **CORSも正しく設定されている**場合: レガシーな手法（Flashベースのクロスドメインリクエストなど）が使われた歴史があるが、現代の主要ブラウザではFlash自体が廃止・無効化されているため、実務上のリスクはほぼ解消されている

この整理から分かるのは、「JSON CSRFが成立するかどうか」は単一の脆弱性ではなく、**Content-Type検証の厳密さ・ボディパーサーの寛容さ・CORS設定・CSRFトークンの有無という複数の防御層のうち、どれか一つでも欠けると突破される**という多層防御の考え方です。加えて、`X-HTTP-Method-Override`のようなメソッドオーバーライドヘッダーを悪用してフォームのPOSTをPUT/DELETE相当として処理させる、あるいはJSONボディを`multipart/form-data`のFormDataに変換して送るといった派生テクニックも報告されており、いずれも「サーバが期待するContent-Typeを厳密に強制していない」という同根の弱点を突いています。

> 出典: System Weakness — Ways To Exploit JSON CSRF (Simple Explanation) — https://systemweakness.com/ways-to-exploit-json-csrf-simple-explanation-5e77c403ede6 （直接取得は403でブロックされ、検索結果の要約から内容を再構成しています）

### 実例で見るtext/plain偽装の生ペイロード

実際の脆弱性報告（プロフィール更新APIを対象としたペネトレーションテスト）では、次のようなリクエストが有効な攻撃として成立したと報告されています。

```
POST /trpc/users.updateUserInfo?batch=1 HTTP/1.1
Host: victim.example
Content-Type: text/plain
Cookie: session=<被害者のセッションCookie>

{"0":{"accountName":"hacked","name":"tes edf","subscribed":"on","phone":"1099424297","country":"EG"}}
```

このケースでは、セッションCookieに`SameSite=None`が設定されており（クロスサイトでも自動送信される）、かつサーバが`Content-Type: text/plain`のボディも`application/json`同様にパースしていたため、CSRFトークンなしでプロフィール情報の書き換えが成立しました。メールアドレス変更フィールドだけは別途保護されていたため完全なアカウント乗っ取りには至りませんでしたが、氏名・電話番号・国コードなどの個人情報が任意に書き換え可能でした。ここでの技術的な急所は、`?batch=1`というtRPC特有のバッチ処理形式に対しても、`text/plain`という「simple」なContent-Typeで通るリクエストがそのまま同じディスパッチ処理に到達してしまう点です。JSONの中身がどれほど複雑・多層的な構造（配列・ネストしたオブジェクト）であっても、Content-Typeの検証さえ緩ければCSRFの成立条件には影響しません。

（本項の実例は、対象記事が直接取得できなかったため、同種の技術を報告した公開ライトアップの内容を要約したものです。詳細な一次情報は上記URLからご確認ください。）

### 防御策のまとめ

- **Content-Typeの厳密な検証**: `application/json`を要求するエンドポイントでは、`text/plain`や`application/x-www-form-urlencoded`など他のContent-Typeで届いたリクエストを無条件に拒否する。ボディの先頭文字列から推測してパースするような寛容な実装（content-type sniffing）は避ける。
- **CSRFトークンの導入**: JSONボディの中に、予測不可能なノンス（一度きりの推測困難な値）を含め、サーバ側で検証する。DirectDefenseも「最善の対策は依然として、リクエストに含まれる予測不可能なノンスをアプリケーションが検証することだ」と結論づけています。
- **Cookieの`SameSite`属性**: セッションCookieに`SameSite=Strict`（理想）または少なくとも`SameSite=Lax`を設定し、クロスサイトの通常フォーム送信でCookieが自動送信されないようにする。`SameSite=None`はクロスサイトでの利用を明示的に許可するものであり、CSRF対策とは併用が必須である点に注意する。
- **CORSの原点回帰**: `Access-Control-Allow-Origin`をリクエストOriginの単純な反射にせず、事前に定義した信頼できるオリジンのホワイトリストと突き合わせる。`Access-Control-Allow-Credentials: true`を使う場合は特に厳格な検証が求められる。
- **クエリパラメータ経由の迂回経路を塞ぐ**: ボディで受け取るべき機微なパラメータを、同じハンドラがクエリパラメータや別のエンコーディングからも受理してしまわないよう、入力経路を一本化する。
- **Origin/Refererヘッダーの検証**: CSRFトークンやSameSite Cookieを補完する多層防御として、サーバ側でOriginまたはRefererヘッダーが期待するホストと一致するかを確認する。

> 出典: DirectDefense — CSRF in the Age of JSON — https://www.directdefense.com/csrf-in-the-age-of-json/
> 出典: PentesterLab Glossary — JSON CSRF — https://pentesterlab.com/glossary/json-csrf

## 防御=回避対象としてのCSRF Prevention

本節では、実装側が採用する代表的なCSRF対策を「攻撃者はこれをどう回避しようとするか」という視点で読み解く。攻撃者にとって防御ロジックは単なる障害物ではなく、実装ミスや設計上の隙間を探す対象そのものである。ここで扱う各対策のコード例・疑似コードは、OWASP CSRF Prevention Cheat Sheetの記述に基づく。読者は各対策の「仕組み」を理解したうえで、「どこにバイパスの余地が生まれ得るか」を意識しながら読み進めてほしい。

### 1. Synchronizer Token Pattern（同期トークンパターン）

最も古典的で信頼性の高いCSRF対策が、サーバー側で生成したランダムトークンをクライアントに渡し、状態変化を伴うリクエスト（POST/PUT/PATCH/DELETEなど）に必ず付与させて検証する方式である。トークンは以下の性質を満たす必要がある。

- ユーザーセッションごと、またはリクエストごとに一意
- 暗号学的に安全な乱数生成器（CSPRNG）で生成
- サーバー側（セッションストアなど）に秘密として保持
- 第三者から予測不可能

典型的な実装は、隠しフォームフィールドとしてトークンを埋め込む形である。

```html
<form action="/transfer.do" method="post">
  <input type="hidden" name="CSRFToken"
    value="OWY4NmQwODE4ODRjN2Q2NTlhMmZlYWEwYzU1YWQwMTVhM2JmNGYxYjJiMGI4MjJjZDE1ZDZMGYwMGEwOA==">
  <!-- その他フィールド -->
</form>
```

サーバー側の検証ロジックは単純な文字列比較に見えるが、ここに複数のバイパス経路が潜む。

```
受信したトークン = リクエストから抽出
セッション保存トークン = ユーザーセッションから取得

if (受信したトークン == セッション保存トークン) {
  リクエスト承認
} else {
  リクエスト拒否 + ログ記録
}
```

**なぜこの防御が効くのか（仕組みレベル）:** 攻撃者が被害者のブラウザに偽のフォームを踏ませてクロスサイトリクエストを発生させても、攻撃者はそのユーザーのセッションに紐づくCSRFトークンの値を知らない。ブラウザの同一オリジンポリシー（Same-Origin Policy, SOP）により、攻撃者のオリジンからは被害者側ページのDOM内容（トークンを含む隠しフィールド）を読み取れないため、正しいトークンを偽フォームに埋め込むことができない。これがCSRFトークン方式の防御原理の核心である。

**回避対象としての弱点:**
- トークン検証の実装が「値が存在しない場合はスキップする」というフェイルオープン(fail-open、判定不能時に安全側ではなく許可側へ倒れる設計)になっていると、トークンパラメータを丸ごと省略するだけで防御を無効化できる。
- 検証がGET/POSTの区別を誤り、状態変化操作を安全メソッド（GET）で実装している場合、そもそもトークン検証の対象外になっているケースがある。
- セッション全体で1つのトークンを使い回す設計では、XSS(クロスサイトスクリプティング。攻撃者スクリプトを被害者のブラウザ上で実行させる脆弱性)が1つでも存在すればトークンを読み出され、この防御は完全に無力化される。原文でも「XSS脆弱性はすべてのCSRF対策を無効化しうる」と明記されている。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 2. Double Submit Cookie（二重送信クッキー）パターン

サーバー側にセッション状態を持たない（ステートレスな）システム向けの代替策として、二重送信クッキーパターンがある。

#### 素朴な実装（Naive Pattern、非推奨）

クライアントは同一のランダム値をクッキーとリクエストパラメータ（またはカスタムヘッダー）の両方で送信し、サーバーは両者が一致するかだけを確認する。

**なぜこれで防御になるのか:** クロスオリジンの攻撃者ページは、被害者のクッキー値をJavaScriptで読み取れない（`HttpOnly`が付いていなくても、クロスオリジンからの直接的なクッキー読み取りはSOPで制限される）。そのため、攻撃者は正しいクッキー値をリクエストパラメータ側に複製できない。

**なぜ「非推奨」なのか（回避手段）:** この素朴な方式最大の弱点は、**サブドメインからのクッキー注入(cookie injection)**である。攻撃者が`evil.attacker.example.com`のようなサブドメインを何らかの手段（サブドメイン乗っ取り、XSS、あるいはそのサブドメインを支配下に置ける状況)で制御できれば、`Domain=example.com`スコープのクッキーを親ドメイン全体に対して上書き設定できる。攻撃者は自分の知っている値をクッキーとして被害者のブラウザにセットしたうえで、同じ値をパラメータとして送る偽リクエストを作成すればよい。サーバーは「クッキー値とパラメータ値が一致している」ことしか確認していないため、両方が攻撃者の既知の値であっても検証を通過してしまう。

#### 署名付き二重送信クッキー（推奨）

この弱点に対処するため、クッキー値そのものにサーバー側の秘密鍵によるHMAC(Hash-based Message Authentication Code。共有秘密鍵とハッシュ関数を用いてメッセージの完全性と真正性を検証する仕組み)署名を組み込む方式が推奨されている。

```
# トークン生成
secret = getSecretSecurely("CSRF_SECRET")
sessionID = session.sessionID
randomValue = cryptographic.randomValue(64)

message = sessionID.length + "!" + sessionID + "!" +
          randomValue.length + "!" + randomValue.toHex()
hmac = hmac("SHA256", secret, message)

csrfToken = hmac.toHex() + "." + randomValue.toHex()
response.setCookie("csrf_token=" + csrfToken + "; Secure")
```

検証側は、受け取ったトークンからHMAC部分とランダム値部分を分離し、サーバー側でセッションIDと秘密鍵から期待されるHMACを再計算して比較する。

```
csrfToken = request.getParameter("csrf_token")
tokenParts = csrfToken.split(".")
hmacFromRequest = tokenParts[0]
randomValue = tokenParts[1]

secret = getSecretSecurely("CSRF_SECRET")
sessionID = session.sessionID
message = sessionID.length + "!" + sessionID + "!" +
          randomValue.length + "!" + randomValue

expectedHmac = hmac("SHA256", secret, message)

if (!constantTimeEquals(hmacFromRequest, expectedHmac)) {
  response.sendError(403, "Invalid CSRF token")
  return
}
```

**なぜサブドメイン攻撃に強くなるのか:** クッキー値自体がセッションIDと紐づいたHMAC署名を含むため、攻撃者がサブドメインから任意の値をクッキーに注入できても、サーバー側の秘密鍵を知らない限り正しいHMACを偽造できない。攻撃者は「一致する値」を作れなくなる。

**実装上の回避対象となりうる注意点:**
- 比較処理を単純な`==`で実装すると、**タイミング攻撃(timing attack)**でHMAC値を1バイトずつ推測される理論的リスクがある。原文が「定時間比較(constant-time comparison)」を明示的に要求しているのはこのためであり、これを怠った実装はサイドチャネル攻撃の対象になりうる。
- 秘密鍵（`CSRF_SECRET`）の管理がずさんで、ソースコードへのハードコーディングや推測可能な生成方法を用いていると、HMAC自体を攻撃者が計算できてしまい、この防御全体が無効化される。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 3. SameSite Cookie属性 — 「デフォルト防御」の限界

比較的新しい防御レイヤーとして、Cookieの`SameSite`属性がある(主要ブラウザでは2020年前後からLaxがデフォルト挙動化)。

| 値 | 動作 | 想定用途 |
|---|---|---|
| `Strict` | クロスサイトリクエストでは一切送信されない | 金融機関向けなど厳格な用途 |
| `Lax` | トップレベルナビゲーション（GETのみ）でのみ送信 | 一般的なWebサイト（多くのブラウザのデフォルト） |
| `None` | 常に送信（`Secure`属性が必須） | 複数ドメイン間の連携が必要な場合 |

```
Set-Cookie: JSESSIONID=xxxxx; SameSite=Strict; Secure
Set-Cookie: token=xxxxx; SameSite=Lax; Secure
```

**なぜ効くのか:** ブラウザがリクエストを送信する際、リクエスト元のサイト（登録可能ドメイン, registrable domain）とCookieが発行されたサイトを比較し、クロスサイトと判定した場合はCookie自体を送信しない。CSRFはそもそも「被害者のセッションCookieが自動送信されること」に依存する攻撃であるため、Cookieが送信されなければ攻撃は原理的に成立しない。

**回避対象としての限界（本節の核心）:**

1. **`Lax`はトップレベルのGETナビゲーションを許可する。** 状態変化操作（例: アカウント削除、送金）をGETリクエストで実装している設計が残っていれば、`<a href="https://victim.com/delete?id=1">`のようなリンクを踏ませるだけでCSRFが成立する。「安全でない操作は必ずPOST/PUT/PATCH/DELETEで実装する」という原則が守られていない実装は、SameSite=Laxをまるごと迂回される。
2. **登録可能ドメイン内では「同一サイト」とみなされる。** `app.example.com`が発行したCookieは、同じ登録可能ドメイン配下の`subdomain.example.com`からのリクエストでも同一サイト扱いになる。したがって、対象システムと同じ親ドメインを共有するサブドメインが（別チームの管理下などで）侵害・乗っ取りされた場合、そこを踏み台にしたCSRFはSameSiteでは防げない。
3. **`window.open()`などによるナビゲーションも同一サイトリクエストと見なされる**ケースがあり、攻撃者が想定しない経路で状態変化リクエストが飛ぶ余地が残る。
4. **古いブラウザの非対応。** iOS Safari 13.2以前など、SameSite属性を正しく解釈しないブラウザ環境ではこの防御自体が機能しない。
5. **クライアントサイドCSRF(client-side CSRF)には無効。** JavaScriptが不正な入力（URLハッシュなど）を基に「同一オリジンへの」リクエストを組み立ててしまう脆弱性がある場合、そもそもクロスサイトリクエストではなく同一オリジンからのリクエストになるため、SameSiteは何の判定材料にもならない（この論点は後述の11節で扱う）。

原文は「SameSiteのみで十分」となる条件を次のように限定している。登録ドメインを完全に制御していること、すべての状態変化操作がPOST/PUT/PATCH/DELETEで実装されていること、セッションCookieに`__Host-`プレフィックスを付与していること、Origin/Referer検証も併用していること、そして古いブラウザのユーザーを切り捨てられること。これらの条件を単独の防御層として過信せず、必ず多層防御(defense in depth)の一部として扱うべきだという含意である。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 4. Origin / Refererヘッダー検証

トークン方式と組み合わせる補助的な防御として、リクエストの送信元を示す`Origin`ヘッダーおよび`Referer`ヘッダーを検証する方式がある。

```javascript
// ステップ1: 送信元オリジンの確定
sourceOrigin = request.header("Origin")

// Originがなければ Referer から抽出
if (!sourceOrigin) {
  refererUrl = request.header("Referer")
  sourceOrigin = extractOrigin(refererUrl)
}

// 両方なければブロック推奨
if (!sourceOrigin) {
  response.sendError(403)
}

// ステップ2: 送信先オリジンの確定（プロキシ経由時は要注意）
targetOrigin = request.header("X-Forwarded-Host") || request.header("Host")

// ステップ3: 厳密一致で比較
if (sourceOrigin != targetOrigin) {
  response.sendError(403, "Origin mismatch")
}
```

**なぜ効くのか:** `Origin`ヘッダーはブラウザがリクエストに自動付与するもので、JavaScriptから偽装することができない(fetch APIやXHRで明示的に上書きしようとしても、ブラウザは"forbidden header"としてこれを拒否する)。したがって、リクエストが本当に自サイトのページから発生したものかどうかを、ある程度信頼できる形で判定できる。

**実装ミスによる回避対象:**
- **文字列比較が「厳密一致」でなく「前方一致・部分一致」になっている実装は致命的**である。たとえば`sourceOrigin.startsWith("https://example.org")`のような判定は、`https://example.org.attacker.com`という攻撃者の取得したドメインでも一致してしまう(オリジン文字列としての境界を無視した比較のため)。原文が「完全一致検証が必須」と強調しているのはこの典型的な回避手口を防ぐためである。
- **リダイレクトを経由するとOriginヘッダーが省略される場合がある**(プライバシー上の理由により、一部のブラウザ・状況でOriginがomitされる仕様がある)。この挙動を悪用し、リダイレクトを挟んだリクエストでOrigin検証をすり抜けようとする手口が考えられる。
- 実運用データとして「ヘッダーが完全に欠落するケースが1〜2%程度存在する」とされており、多くの実装は運用上の妥協として「ヘッダー欠落時は許可する」フェイルオープンな判定を取りがちである。この妥協点そのものが、Origin/Refererヘッダーを送信しないよう細工したリクエスト（例えば一部の古いブラウザ拡張やプロキシ経由)による回避の糸口になりうる。
- プロキシ環境下で`X-Forwarded-Host`を信頼しつつ、そのヘッダーがクライアントから直接上書き可能な構成になっていると、攻撃者が送信先オリジンの判定自体を偽装できてしまう。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 5. カスタムリクエストヘッダー（Ajax/API向け）

SPA(Single Page Application)やAPIクライアントでは、`X-CSRF-Token`のようなカスタムヘッダーを状態変化リクエストに付与させる方式が広く使われる。

```javascript
fetch('/api/transfer', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': csrfToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(data)
})
```

フレームワークごとの慣例的なヘッダー名は次のとおりである。

- Ruby on Rails, Laravel, Django: `X-CSRF-Token`
- AngularJS: `X-XSRF-Token`
- Express.js: `CSRF-Token`

**なぜ効くのか（CORSプリフライトとの関係）:** ブラウザの仕様上、`Content-Type: application/json`や独自ヘッダーを付けたクロスオリジンリクエストは「単純リクエスト(simple request)」の条件を満たさず、CORS(Cross-Origin Resource Sharing)のプリフライトリクエスト(`OPTIONS`メソッドによる事前確認)を強制的に発生させる。サーバー側のCORS設定が対象オリジンを許可していなければ、プリフライトの時点で本リクエストの送信自体がブロックされる。またHTMLの`<form>`タグは仕様上カスタムヘッダーを付与する手段を持たないため、素朴なHTMLフォームによるCSRF攻撃ではこのヘッダーを再現できない。

**クレデンシャル付きCORS設定の注意:**

```
Access-Control-Allow-Origin: http://www.yoursite.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: POST,PUT,DELETE
```

原文は「`Access-Control-Allow-Origin: *`と`Access-Control-Allow-Credentials: true`は仕様上併用できない」ことを明示している。これはブラウザ側の仕様制約(ワイルドカードとクレデンシャル許可の同時指定はブラウザに拒否される)であり、これを回避しようとして`Origin`ヘッダーの値をそのまま動的に`Access-Control-Allow-Origin`へ反映する実装（すべてのオリジンを事実上許可してしまう典型的な誤設定）が、CORS関連章で扱う重大な脆弱性の温床になる。

**回避対象としての弱点:**
- カスタムヘッダー方式は、あくまで「サーバーがCORSを正しく制限している」ことに依存する防御であり、CORS設定自体に不備があれば意味をなさない。
- SPA側でトークンをlocalStorageに保存していると、XSSによって容易に窃取される（後述6節参照）。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 6. トークンの生成・保存戦略とその弱点

トークンをどこに保存するかは、CSRFトークン方式全体の堅牢性を左右する重要な設計判断である。

| 保存先 | 適否 | 理由 |
|---|---|---|
| サーバーセッション | 適切 | クライアントから改ざん不可能 |
| HTMLメタタグ | 適切 | JavaScriptから読み取り、ヘッダーへ転記できる |
| JavaScript変数 | 適切 | 一時的な保持に向く |
| Cookie（HttpOnlyのみ、対策と紐づけなし） | 不適切 | JavaScriptから読み取れないため、ヘッダー転記方式と組み合わせられない |
| localStorage | 不適切 | XSSが存在すれば任意のスクリプトから読み取り放題になる |

さらに、トークンを「セッションごとに1つ」持つか「リクエストごとに新規発行」するかにもトレードオフがある。

- **セッションごと1トークン:** ブラウザの戻るボタンでも古いページのトークンがまだ有効なままなので、ユーザー体験を損なわない。反面、トークンの生存期間が長いため、何らかの経路（リファラ漏えい、ログ出力、XSSなど）で一度漏えいするとセッション終了までCSRF対策が無力化される。
- **リクエストごと1トークン:** トークンの有効窓が短く、盗用されても悪用可能な時間が限られるため安全性は高い。反面、戻るボタンで古いトークンを再送すると正規ユーザーの操作すら拒否されてしまう「誤検知」が起きやすく、実装・UXの複雑さが増す。

**回避対象としての要点:** どちらの方式でも、トークンの読み取り経路がひとつでも漏れていれば(たとえばエラーページのURLにトークンをクエリパラメータとして含めてしまい、外部サイトへの`Referer`経由で漏えいするなど)、攻撃者はトークンの値そのものを盗み出して正規のトークンとしてリクエストに添付できる。この場合、トークンの検証ロジック自体は正しく動作しているにもかかわらずCSRF攻撃は成立する。防御ロジックのバイパスは、必ずしもロジック自体の欠陥からだけ生まれるわけではなく、周辺のトークン取り扱いの甘さからも生まれるという点を押さえておきたい。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 7. フレームワーク組み込み実装の例と共通する落とし穴

主要フレームワークはCSRF対策を標準機能として提供している。

```ruby
# Ruby on Rails: デフォルトで有効
protect_from_forgery with: :exception
```

```python
# Django
from django.middleware.csrf import csrf_protect

@csrf_protect
def my_view(request):
    pass
# テンプレート内: {% csrf_token %}
```

```csharp
// .NET
services.AddAntiforgery(options => {
    options.HeaderName = "X-CSRF-Token";
});
// Viewで: @Html.AntiForgeryToken()
```

```go
// Go 1.25+ 標準ライブラリ
http.Handle("/", http.AllowQuerySemicolons(
    http.CrossOriginProtection(handler)))
```

これらは基本的に前述のSynchronizer Token Patternの実装であり、原理は共通している。バグバウンティやペネトレーションテストの観点で押さえておくべき「フレームワーク実装特有の回避対象」は次のとおりである。

- **`protect_from_forgery`のような機能は、特定のコントローラ／エンドポイントで明示的に無効化(`skip_before_action`相当)されていることがある。** API向けエンドポイントをJSON専用に作った際、開発者がトークン検証をまるごとスキップする設定を入れたまま、実は同じエンドポイントがフォーム経由でも呼び出し可能だった、という実装ミスは典型例である。
- **フレームワークのCSRF保護がデフォルトでGET以外の全メソッドを対象にしている一方、開発者が独自にGETで状態変化を実装した箇所は保護対象外になる。**
- 自前でJEE（Java Enterプライズ）のようにフィルターを実装する場合、Originヘッダーのチェックとトークンチェックの両方を1つのフィルタに詰め込む構成は読みやすい反面、片方の条件分岐にreturn漏れ・early returnの欠落があると、後続の`chain.doFilter()`が意図せず実行されてしまう典型的な実装バグが起こりうる。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 8. AJAXライブラリにおけるトークン自動付与の実装差

jQuery、Axios、Angularなど各ライブラリはトークンをリクエストに自動付与する仕組みを提供しているが、その実装方法の違いが防御の一貫性に影響する。

```javascript
// jQuery: ajaxSetupのbeforeSendで一括付与
$.ajaxSetup({
  beforeSend: (xhr, settings) => {
    if (!csrfSafeMethod(settings.type) && !settings.crossDomain) {
      xhr.setRequestHeader("X-CSRF-Token", csrf_token);
    }
  }
});
```

```typescript
// Angular: withXsrfConfigurationでCookieから自動読み取り
provideHttpClient(
  withXsrfConfiguration({
    cookieName: 'XSRF-TOKEN',
    headerName: 'X-XSRF-TOKEN'
  })
)
```

**なぜAngularの方式（Cookie読み取り→ヘッダー転記）はDouble Submit Cookieの安全な変種として成立するのか:** Cookieの値をJavaScriptで読み取ってヘッダーに転記する、というAngularの挙動そのものが「クロスオリジンからは読み取れないCookie値を、同一オリジンのJSだけが読み取ってヘッダーに載せ替えられる」という前提に立脚している。攻撃者のオリジンではこのCookie値を読めないため、ヘッダーを正しく偽装できない。

**回避対象としての注意点:** `settings.crossDomain`のような判定条件を伴う実装では、その判定ロジックが「同一サイト」ではなく「同一オリジン」を基準にしていたり、逆に緩すぎる判定になっていたりすると、開発者の意図に反してクロスオリジンリクエストにまでトークンを付与してしまい、トークンの機密性を損なう(サードパーティサイトにトークンが漏えいする)リスクがある。防御ロジックの「対象範囲の判定」自体がバグの温床になりやすい典型例である。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 9. ログイン処理特有のCSRF対策 — セッション固定攻撃との関係

ログインフォーム自体もCSRFの対象になりうる。攻撃者が被害者に「攻撃者が知っているセッションIDでログインさせる」ことに成功すれば、ログイン後もそのセッションIDを使い回して被害者になりすませる(セッション固定攻撃、session fixation)。

```
1. ログイン前: プレセッションを作成し、
   フォームに csrf_token を隠しフィールドとして埋め込む

2. ログイン検証成功後:
   旧セッション(session_id_pre)を破棄
   新セッション(session_id_post)を生成
   新しい csrf_token を生成・保存
```

**なぜこの手順が必要か:** ログイン前にすでにトークンを発行し検証する設計を入れておかないと、攻撃者は被害者に「攻撃者のアカウントへの」ログインを強制するCSRF（ログインCSRF）を仕掛けられる。さらにログイン成功後に必ずセッションID自体を再生成することで、ログイン前の段階で攻撃者が把握していた可能性のあるセッションIDが、ログイン後も有効なまま使い回されることを防ぐ。これによりセッション固定とCSRFトークンの固定という、2つの関連する固定化攻撃を同時に断ち切っている。

**回避対象としての盲点:** ログイン後のセッションID再生成だけを実施し、CSRFトークンの再生成を忘れる実装は少なくない。この場合、ログイン前の段階で攻撃者がすでに把握していたトークン値が、ログイン後も有効なままになってしまう可能性がある。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 10. Fetch Metadata Headers — 軽量な補助防御とそのフォールバック設計

比較的新しい防御機構として、ブラウザが自動付与する`Sec-Fetch-Site`ヘッダー(2020年前後から主要ブラウザに実装)を利用する方式がある。

```javascript
const SAFE_METHODS = new Set(['GET','HEAD','OPTIONS']);

function isCsrfSafe(req) {
  const fetchSite = req.get('Sec-Fetch-Site');

  if (fetchSite) {
    if (fetchSite === 'cross-site' && !SAFE_METHODS.has(req.method)) {
      return false;
    }
  } else {
    // ヘッダーがない古いブラウザ向けフォールバック
    return verifyCSRFToken(req) || verifyOriginHeader(req);
  }

  return true;
}
```

`Sec-Fetch-Site`が取りうる値は`same-origin`（同一オリジン）、`same-site`（同一登録可能ドメイン）、`cross-site`（別オリジン）、`none`（ユーザーが直接開いた場合など）である。

**なぜ効くのか、そしてなぜ「唯一の防御」にできないのか:** このヘッダーもOriginヘッダーと同様にブラウザが強制的に付与しJavaScriptから偽装できないため信頼性が高い。しかし対応していない古いブラウザではヘッダー自体が送られてこないため、**フォールバックとして別の防御（トークン検証やOrigin検証）を必ず用意しておく設計**が要求される。この設計そのものが回避対象になりうる。フォールバック分岐の実装が甘く、「ヘッダーがない場合は安全側に倒す」はずが実際には「ヘッダーがない場合は素通りさせる」実装になっていた場合、Sec-Fetch-Siteヘッダーを送らない任意のクライアント（すでに旧式化した特殊なUser-Agentや一部ツール)経由でこの防御全体が無効化されてしまう。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 11. クライアントサイドCSRF — 従来の防御網が構造的に届かない領域

ここまでの対策(SameSite、Origin検証、Sec-Fetch-Site)はいずれも「リクエストがクロスサイト/クロスオリジンから発生しているかどうか」を判定基準にしている。しかし、次のようなJavaScriptの実装バグが存在すると、この前提そのものが崩れる。

```javascript
// 危険なパターン
window.addEventListener('DOMContentLoaded', () => {
  const hashFragment = window.location.hash.slice(1);

  // ハッシュから抽出したメソッド・エンドポイントで
  // そのまま fetch してしまう
  const [method, endpoint] = hashFragment.split(';');
  fetch(endpoint, { method });
});

// 攻撃者が用意するURL例:
// https://site.com/#post;/api/admin/deleteUser
```

**なぜ従来の防御が効かないのか（仕組みの核心）:** 攻撃者は被害者を`https://site.com/#post;/api/admin/deleteUser`というリンクに誘導するだけでよい。URLのフラグメント(`#`以降)はサーバーに送信されずブラウザ内だけで処理されるため、このリクエストは正規サイト自身のJavaScriptが自分自身のオリジンに対して発行する**正真正銘の同一オリジンリクエスト**になる。SameSite属性もOriginヘッダー検証もSec-Fetch-Siteも、すべて「クロスサイト／クロスオリジンかどうか」を判定基準にしているため、この完全に同一オリジンなリクエストに対しては原理的に無力である。ここが「クライアントサイドCSRF」と呼ばれる所以であり、サーバー側の防御ロジックだけでは対処できない、フロントエンドの実装自体に起因する脆弱性である。

**対策の方向性:**

```javascript
// 1. ホワイトリスト方式でユーザー入力とエンドポイントを分離する
const SAFE_ENDPOINTS = {
  'getProfile': '/api/user/profile',
  'updateSettings': '/api/user/settings'
};
const action = hashFragment;         // ユーザー（攻撃者）が制御可能な入力
const endpoint = SAFE_ENDPOINTS[action]; // 固定的な対応表を経由させる

// 2. 万一動的URLを扱わざるを得ない場合は厳密なフォーマット検証
if (!/^\/api\/[a-z]+\/[a-z]+$/.test(endpoint)) {
  return; // 拒否
}
```

**なぜこれで防げるのか:** ユーザー（＝場合によっては攻撃者）が制御できる入力値を、そのままfetchの引数（メソッドやURL）として使わず、あらかじめ開発者が定義した固定の対応表（ホワイトリスト）を介して間接的にしか使わせないようにする。これにより、入力値がどれだけ悪意ある内容であっても、実際に発行されるリクエストの形は開発者が意図した範囲に限定される。これは典型的な「sink（入力が最終的に実行・解釈される危険な代入先）を直接ユーザー入力にさらさない」という設計原則の応用である。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 12. Cookie Prefix — Cookie自体の出自を保証する補助策

`__Host-`および`__Secure-`というCookie名の接頭辞(prefix)は、ブラウザによって強制されるCookie属性の追加制約であり、SameSiteやトークン方式と組み合わせて使う。

```
Set-Cookie: __Host-csrf_token=xxx; Path=/; Secure; SameSite=Strict
```

`__Host-`を付けたCookieは、`Domain`属性の指定が禁止され、`Path=/`かつ`Secure`が必須になる。これにより、そのCookieが「発行元と完全に一致するホストからのみ、かつHTTPS経由でのみ」設定されたことをブラウザレベルで保証できる。

**なぜこれがサブドメイン由来の回避策への追加防御になるのか:** 前述の二重送信クッキーパターンの弱点は「サブドメインから親ドメインスコープのCookieを上書きできる」ことに起因していた。`__Host-`プレフィックスは`Domain`属性の指定自体を禁止するため、サブドメインが同名のCookieをこのホストに対して注入することを構造的に防げる(ブラウザの仕様として、`__Host-`接頭辞を持つCookie名はDomain属性付きでは設定できない)。緩和版の`__Secure-`はDomain指定やサブドメイン共有を許容する分、この保証は弱い。

> 出典: Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### まとめ — 防御は単体でなく組み合わせで評価する

原文が提示する対策選択フローは、環境ごとに推奨の主防御・補助防御が異なることを示している。

| 環境 | 推奨対策 | 補助対策 |
|---|---|---|
| ステートフルサーバー | Synchronizer Token | SameSite + Origin確認 |
| ステートレス（JWT等） | 署名付きDouble Submit Cookie | Fetch Metadata |
| SPA/AJAX主流 | カスタムヘッダー | メタタグ内トークン |
| ログインページ | プレセッション + トークン | Origin検証 |
| 古いブラウザ対応が必須 | トークン + Origin確認 | Fetch Metadataのフォールバック |

ここまで見てきたように、CSRF防御のバイパスは大きく次のパターンに分類できる。

1. **判定ロジックそのものの実装ミス**(前方一致比較、フェイルオープンな欠落時許可、比較処理のタイミング攻撃耐性欠如)
2. **防御の適用範囲の穴**(特定エンドポイントでの無効化、GETによる状態変化の実装、フォールバック分岐の甘さ)
3. **前提となるブラウザ機構自体の限界**(SameSiteの登録可能ドメイン単位の粒度、古いブラウザの非対応)
4. **周辺要因による無力化**(XSSによるトークン窃取、クライアントサイドCSRFのように同一オリジン性の前提自体が崩れるケース)

読者がCSRF対策を評価・診断する際は、単に「トークンが実装されているか」だけでなく、これら4種のいずれかの角度から「この防御は本当にどんな入力・経路に対しても機能するか」を問い直す視点が重要である。次節以降では、こうした個々のバイパスパターンをより具体的な攻撃手法として掘り下げていく。


---

## ナビゲーション

[← 第2章 古典的CSRFのエクスプロイト](02-classic-csrf.md)　｜　[📚 目次（ホーム）](index.md)　｜　[第4章 SameSite時代の高度なCSRF →](04-samesite-advanced.md)
