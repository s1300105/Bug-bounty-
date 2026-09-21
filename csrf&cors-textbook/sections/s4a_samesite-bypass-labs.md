## SameSite bypass理論とPortSwiggerラボ

SameSite Cookie属性は、2020年代のCSRF（Cross-Site Request Forgery: 被害者のブラウザに保存された認証情報を悪用し、意図しない状態変更リクエストを送らせる攻撃）対策の主役になりました。多くのフレームワークが「トークンを付けなくてもSameSite=Laxがデフォルトだから安全」と暗黙に前提するようになった結果、逆に「SameSiteをどう回避するか」という一段深い攻防が生まれています。本節では、SameSiteの内部挙動を仕組みレベルで押さえたうえで、PortSwigger Web Security Academyの3つのラボ（method override / cookie refresh / client-side redirect）を通じて、実際にどこで境界が崩れるのかを解説します。

> 本節は防御目的の解説です。ここで扱うペイロードは、いずれもPortSwiggerが公式に提供する学習用ラボ環境（`web-security-academy.net`）内でのみ実行するものであり、実在のサービスや本番環境に対する無許可の検証には使わないでください。

---

### SameSiteの三段階を仕組みから理解する

SameSiteは「あるサイトが発行したCookieを、別サイト（cross-site）を起点とするリクエストに含めるかどうか」を制御するブラウザ側のセキュリティ機構です。値は3つあります。

- **`Strict`**: あらゆるクロスサイトリクエストでCookieを送らない。アドレスバーに表示されているサイトと、リクエスト先サイトが一致しなければ、Cookieは付与されません。最も強力だが、外部リンクから遷移してきた直後にログイン状態が失われる（未ログインに見える）などUXの副作用があります。
- **`Lax`**: クロスサイトでも、次の**両方**の条件を満たすときだけCookieを送ります。
  1. リクエストのメソッドが**GET**であること
  2. ユーザーによる**トップレベルナビゲーション**（アドレスバーのURLそのものが変わる遷移。例: リンクのクリック）の結果であること
- **`None`**: SameSite制限を事実上無効化し、発行元サイトへの全リクエストでCookieを送る。ただし`Secure`属性（HTTPS必須）が併せて必要です。

```
Set-Cookie: trackingId=0F8tgdOhi9ynR1M9wa3ODa; SameSite=None; Secure
Set-Cookie: session=0F8tgdOhi9ynR1M9wa3ODa; SameSite=Strict
```

#### なぜ「Laxがデフォルト」なのかと、その落とし穴

2021年以降、**Chromeは、発行時にSameSite属性を明示していないCookieに対して、デフォルトで`Lax`相当の制限を適用**します。これがCSRF対策の土台になった一方で、二つの重要な副作用があります。

第一に、`Lax`は「GET かつ トップレベルナビゲーション」なら通してしまうため、**状態変更をGETで受け付けるエンドポイントがあると、それだけでLaxを突破できる**（後述のmethod overrideラボ）。

第二に、Chromeには「**Lax+POST 2分間の猶予ウィンドウ**」と呼ばれる互換性のための例外があります。SameSite属性を**明示していない**Cookieに限り、**発行（Set-Cookie）から約120秒（2分）以内**であれば、トップレベルナビゲーションによるクロスサイトの**POST**リクエストでもCookieを送ります。これは、OAuthのシングルサインオンのようにクロスサイトPOSTでセッションを確立する古い実装を壊さないための緩和策です。**この120秒の窓こそがcookie refreshラボの攻撃面**になります。逆に言えば、開発者が明示的に`SameSite=Lax`（や`Strict`）を設定していれば、この猶予は適用されません。属性の「明示 vs 未指定（デフォルト）」で挙動が変わる点が核心です。

#### 「site」と「origin」は違う — ここが多くの誤解の元

SameSiteの判定は**origin（オリジン）ではなくsite（サイト）**を単位にします。両者は似て非なるものです。

- **origin**: スキーム・ドメイン名・ポートが**完全一致**するもの同士。
- **site**: **TLD+1**（実効トップレベルドメイン + その1つ下のラベル）。加えてスキームも考慮されます。

たとえば `app.example.com` と `intranet.example.com` は**オリジンは異なる（cross-origin）が、サイトは同じ（same-site）**です。ここから導かれる決定的な結論が次です。

> **クロスオリジンのリクエストでも、same-siteであり得る。しかし逆は成り立たない。**

つまり `example.com` 配下のいずれかのサブドメイン（兄弟ドメイン、sibling domain）にXSSなどの「任意の二次リクエストを発生させる隙」があれば、それはsame-site扱いとなり、`SameSite=Strict`のCookieすらリクエストにできてしまうためStrict防御が丸ごと崩れます。なお、スキームも判定に入るため、`http://app.example.com` から `https://app.example.com` への遷移は**cross-site**と扱われます。

> 出典: Bypassing SameSite cookie restrictions — https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions

---

### ラボ1: SameSite Lax bypass via method override

#### 状況と正常時の防御

対象は `POST /my-account/change-email`（メールアドレス変更）。このエンドポイントは以下の状態にあります。

- 予測不能なCSRFトークンが**ない**
- Cookieに明示的なSameSite指定が**ない**（=Chromeデフォルトの`Lax`が効く）

`Lax`のもとでは、クロスサイトからの**POST**リクエストにはセッションCookieが付かないため、素朴なCSRF（自動送信フォームでPOST）は失敗します。ここまでは意図通りの防御です。

#### なぜ突破できるのか — メソッドオーバーライドという裏口

多くのWebフレームワーク（Symfony、Laravel、Rails等）は、HTMLフォームがGET/POSTしか送れない歴史的制約を補うため、**リクエストの見かけ上のメソッドを、ボディやクエリの特殊パラメータで上書きする**機能を備えています。代表例が `_method` パラメータです。サーバはルーティング時にこの値を「本当のメソッド」として採用します。

この挙動を悪用すると、**ブラウザから見れば安全なGETリクエスト**でありながら、**サーバから見ればPOST（状態変更）**という二枚舌のリクエストが作れます。GETかつトップレベルナビゲーションなので`Lax`の2条件を満たし、セッションCookieが同送される。しかしサーバは`_method=POST`を見てメール変更処理を実行してしまう、というわけです。

#### エクスプロイト

```html
<script>
document.location = "https://YOUR-LAB-ID.web-security-academy.net/my-account/change-email?email=pwned@web-security-academy.net&_method=POST";
</script>
```

なぜこれで成立するのか、を分解します。

1. `document.location` への代入は**トップレベルナビゲーション**を発生させる（アドレスバーのURLそのものが変わる）。これで`Lax`条件2を満たす。
2. 遷移はHTTP **GET**として飛ぶので、`Lax`条件1も満たす。→ セッションCookieが付与される。
3. サーバはクエリの `_method=POST` を優先し、この要求を`POST /my-account/change-email`として処理する。→ `email`が書き換わる。

被害者はエクスプロイトサーバ上のリンク（またはページ）にアクセスするだけで、リダイレクト先で自分のセッションが使われてメールが変更されます。攻撃者はメールを掌握できれば、パスワードリセット経由でアカウントを乗っ取れます。

#### 防御

- 状態変更エンドポイントで**メソッドオーバーライドを無効化**する（`_method`等を受理しない）。少なくとも認証済み・状態変更系ではGETでの実行経路を塞ぐ。
- 状態変更に**CSRFトークン**を必須にする（SameSiteは多層防御の一層であって単独の解ではない）。
- Cookieに**明示的な`SameSite`**を設定し、可能なら`Strict`にする。

> 出典: Lab: SameSite Lax bypass via method override — https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-lax-bypass-via-method-override

---

### ラボ2: SameSite Lax bypass via cookie refresh（2分猶予ウィンドウ / OAuth）

> ⚠️ **未取得の資料**: 「Lab: SameSite Strict bypass via cookie refresh」の公式ラボページは、自動取得時に親記事（SameSite解説記事）の内容へフォールバックしてしまい、ラボ固有本文を直接取得できませんでした（理由: 動的ページのため本文が展開されず、上位記事へ丸められた）。以下のURLからご自身で直接ご覧ください: https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-cookie-refresh
> 以下は、公式ラボ説明・コミュニティWriteup（siunam321氏の解説等）・PortSwigger本文で公開されている情報に基づく再構成です。

（補足として一般知識および公開Writeupに基づく解説です）

#### 状況

- 対象は同じく `POST /my-account/change-email`。CSRFトークンは**ない**。
- サイトは**OAuthによるソーシャルログイン**をサポートする（ラボの資格情報は `wiener:peter`）。
- 名前は「Strict bypass」だが、鍵になるのは「Set-Cookie時に**SameSiteを明示していない**」点で、実効的にはChromeデフォルトの`Lax`と、その**2分猶予ウィンドウ**が舞台になります。

#### なぜ突破できるのか — OAuthコールバックが「属性なしCookie」を焼き直す

このサイトでは、OAuthフローの最後の `GET /oauth-callback` に対するレスポンスで**セッションCookieを再発行する際、SameSite制限を一切指定していません**。属性未指定なのでブラウザはデフォルトの`Lax`を適用します。前述のとおり、**属性未指定Cookieには「発行から約120秒以内なら、トップレベルのクロスサイトPOSTでも送る」猶予**が働きます。

したがって攻撃の骨子は「**まず被害者のブラウザにOAuthのcookie refreshを踏ませてタイマーをリセットし、その直後（2分以内）にクロスサイトPOSTのCSRFを撃ち込む**」となります。cookie refreshを起こす入口が `/social-login`（OAuthの開始点）で、被害者が既にIdP側でログイン済みなら、フローは自動的に進んで `/oauth-callback` に到達し、新鮮なセッションCookieが焼き直されます。

#### エクスプロイト

ポイントは二つ。(1) cookie refreshは**別タブ/別ウィンドウ**で起こし、攻撃ページ自身が遷移して離脱しないようにする。(2) `window.open()` はユーザー操作なしだとポップアップブロックされるため、`onclick`（クリック）を起点にする。

```html
<form method="POST" action="https://YOUR-LAB-ID.web-security-academy.net/my-account/change-email">
    <input type="hidden" name="email" value="pwned@web-security-academy.net">
</form>
<script>
    window.onclick = () => {
        // 1) 別ウィンドウでOAuthのcookie refreshを起動 → session Cookieが焼き直され、120秒タイマーがリセットされる
        window.open('https://YOUR-LAB-ID.web-security-academy.net/social-login');
        // 2) 数秒待ってOAuthフローが /oauth-callback まで完了するのを待ってから、CSRFのPOSTを送る
        setTimeout(changeEmail, 5000);
    };
    function changeEmail() {
        document.forms[0].submit();
    }
</script>
```

なぜこの順序と待機が必要か。

- `window.open('/social-login')`: 別ウィンドウでOAuth開始点へ飛ばす。被害者はIdPで認証済みなので、リダイレクトが連鎖して `/oauth-callback` に到達し、そこでSameSite属性なしのセッションCookieが**再発行**される。この瞬間が2分ウィンドウの始点。
- `setTimeout(..., 5000)`: OAuthのリダイレクト連鎖が完了しCookieが焼き直されるまでの時間を確保する。早すぎるとまだ古いCookie（または未確立）で撃ってしまう。
- `document.forms[0].submit()`: メインウィンドウの隠しフォームを送信。これはクロスサイトの**POST**だが、直前のrefreshにより「属性なしCookie・発行後120秒以内」の条件を満たすため、セッションCookieが同送されメール変更が成立する。
- なぜ**別ウィンドウ**か: refreshを同一ウィンドウで行うと攻撃ページから離脱してしまい、最後のフォーム送信ができなくなる。別ウィンドウに逃がすことで攻撃ページを保持する。

#### 防御

- セッションCookieには**明示的に`SameSite=Strict`（最低でもLax）を設定**する。属性を明示すれば、Chromeの「属性なし限定・120秒猶予」の対象から外れる。
- OAuthコールバックを含む**すべてのSet-Cookieでポリシーを一貫**させる（一箇所でも属性を落とすと全体が緩む）。
- 状態変更にCSRFトークンを併用する。

> 出典: Lab: SameSite Lax bypass via cookie refresh — https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-cookie-refresh
> 参考（Writeup）: siunam's Website — https://siunam321.github.io/ctf/portswigger-labs/CSRF/csrf-10/

---

### ラボ3: SameSite Strict bypass via client-side redirect（ガジェット）

#### 状況と正常時の防御

- 対象は `/my-account/change-email`。CSRFトークンは**なし**だが、今回はセッションCookieに**明示的な`SameSite=Strict`**が設定されている。
- `Strict`はGET/POSTを問わず、あらゆるクロスサイトリクエストでCookieを落とすため、method overrideも2分猶予（属性明示済みなので不適用）も効かない。素直には手が出ません。

#### なぜ突破できるのか — クライアントサイドリダイレクトは「リダイレクトではない」

鍵は「**同一サイト内で二次リクエストを起こせるガジェット（gadget: それ自体は脆弱性でなくても、攻撃を成立させる部品となる正規機能）**」を見つけることです。ここでのガジェットは**クライアントサイド（DOMベース）リダイレクト**、つまりJavaScriptが `location` を書き換えて別URLへ飛ばす仕掛けです。

決定的な原理は次の一文に集約されます。

> クライアントサイドリダイレクトは、そもそも「リダイレクト」ではない。結果として飛ぶリクエストは、独立した通常のリクエストとして扱われる。そしてそれは**same-siteリクエスト**なので、SameSite制限に関わらずサイトの全Cookieを含む。

サーバサイドリダイレクト（HTTP 3xx + `Location`）では、ブラウザは「最初のリクエストがクロスサイト起点だった」ことを覚えており、リダイレクト追従先にもcross-site扱いを引き継ぐため、Cookieは落ちます。ところがJavaScriptによる遷移はブラウザにとって「そのサイト上のページが自発的に起こした新しいトップレベルナビゲーション」でしかなく、**アドレスバーが対象サイトになっている状態からの遷移＝same-site**と判定されます。ここに`Strict`の盲点があります。

#### 脆弱なエンドポイントとペイロード構築

このラボのガジェットはコメント投稿後の確認ページ `GET /post/comment/confirmation?postId=<...>` です。ここは `/resources/js/commentConfirmationRedirect.js` を読み込み、**`postId`パラメータの値を使ってクライアントサイドで遷移先パスを組み立てます**。この`postId`が**パストラバーサル（`../`）を通してしまう**ため、任意の同一サイト内エンドポイントへ遷移先を捻じ曲げられます。

```
/post/comment/confirmation?postId=1/../../my-account/change-email?email=pwned%40web-security-academy.net%26submit=1
```

構築上の注意点。

- `1/../../my-account/change-email` : `postId`の値の中で`../`を使い、JS側が組み立てるパスを `/my-account/change-email` に化けさせる。
- `%40` : `@` のURLエンコード。
- `%26` : `&` のURLエンコード。**ここが要点**で、`&`を生のまま書くと、その時点でURLのクエリ区切りとして解釈され、`email`や`submit`が「`postId`の続き」ではなく「確認ページ自身のクエリ」になってしまう。`%26`とすることで、いったん`postId`の値の一部として運ばれ、JSがリダイレクト先URLを組み立て直したときに初めて`&`として展開され、`email=...&submit=1`という2パラメータになる。
- `submit=1` : 変更処理を実行させるためのパラメータ。`change-email`エンドポイントがGETでも`email`と`submit`を受理するため、GET遷移だけで変更が完了する。

#### エクスプロイト

```html
<script>
document.location = "https://YOUR-LAB-ID.web-security-academy.net/post/comment/confirmation?postId=1/../../my-account/change-email?email=pwned%40web-security-academy.net%26submit=1";
</script>
```

流れを追うと、

1. 攻撃ページの`document.location`代入で、被害者のブラウザが**クロスサイトで**確認ページ `GET /post/comment/confirmation?...` に飛ぶ。この最初のリクエストは`Strict`なのでセッションCookieは**付かない**が、確認ページ自体は認証不要なので表示される。
2. 読み込まれた `commentConfirmationRedirect.js` が`postId`の値からリダイレクト先を組み立て、`../`によって `/my-account/change-email?email=...&submit=1` へ**JavaScriptで遷移**する。
3. この二次遷移は、ブラウザから見れば「対象サイト上のページ（アドレスバーは既に対象サイト）が起こしたsame-siteナビゲーション」。よって`SameSite=Strict`のセッションCookieが**同送**され、メール変更が実行される。

つまり、直接クロスサイトで`change-email`を叩くのではなく、いったん同一サイトのページに着地してから、そのページのJSに二次リクエストを踏ませる「ワンクッション」で`Strict`を回避しているわけです。

#### 防御

- クライアントサイドリダイレクトの遷移先を**ユーザー入力から組み立てない**。どうしても必要なら、許可リスト（allowlist）で遷移先を厳格に制限し、`../`等のパストラバーサルを正規化・拒否する。
- 状態変更にCSRFトークンを必須化する（same-site二次リクエストでもトークンが無ければ弾ける）。
- 状態変更をGETで実行可能にしない。

> 出典: Lab: SameSite Strict bypass via client-side redirect — https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-client-side-redirect

---

### まとめ — SameSiteは「単独の解」ではない

本節の3ラボは、いずれも「SameSiteがあるから安全」という思い込みの隙を突いています。攻防の要点を整理します。

- **method override**: `Lax`は「GET+トップレベルナビゲーション」を通す。状態変更をGET（`_method`等の裏口含む）で実行できると、そのままLaxを越えられる。
- **cookie refresh**: SameSite**属性を明示していない**Cookieには、Chromeの**約120秒（2分）猶予**でクロスサイトPOSTが通る。OAuthコールバックがこの「属性なしCookie」を焼き直すため、refresh→即CSRFで突破できる。属性を明示すれば猶予対象から外れる。
- **client-side redirect**: `Strict`でも、同一サイト内のJSベース遷移ガジェットに二次リクエストを起こさせれば、それはsame-site扱いになりCookieが乗る。ユーザー入力由来のリダイレクト先が導火線。
- 通底する原理として、**site≠origin**（兄弟ドメインのXSS等でStrictも崩れる）と、**属性の明示 vs 未指定でブラウザ挙動が変わる**点を必ず押さえること。

防御側の結論はシンプルです。**SameSiteは多層防御の一層に過ぎず、状態変更には必ずCSRFトークンを併用し、状態変更をGETで受け付けず、Cookieには明示的にSameSite（可能なら`Strict`）を設定し、全Set-Cookieでポリシーを一貫させる**こと。ここまで揃えて初めて、本節の各バイパスは成立しなくなります。

> 出典: Bypassing SameSite cookie restrictions — https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions
