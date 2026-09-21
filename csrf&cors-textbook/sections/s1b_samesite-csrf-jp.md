## SameSiteとCSRF事情の日本語解説

本節では、SameSite属性の仕組みとCSRF対策としての実効性、そしてその限界を、日本語圏のセキュリティエンジニアによる一次情報をもとに深掘りする。SameSiteは「Cookieのクロスサイト送信を制御する属性」であり、単体の魔法の弾丸ではなく、ブラウザ実装差・スキーム・サブドメインといったエッジケースを理解して初めて防御として機能する。ここではその実像を仕組みレベルで解説する。

### SameSite属性の基本と「サイト」の定義

SameSite属性を理解する前提として、まず「サイト(site)」という単位を正確に押さえる必要がある。ブラウザが言う「サイト」は、いわゆる`origin`(スキーム+ホスト+ポート)よりも粗い単位で、**Public Suffix(いわゆるeTLD: `.com`や`.co.jp`など、ブラウザが「これ以上は個人が取得できない公開されたドメイン接尾辞」として管理しているリスト由来の単位)とその直前の1ラベルを合わせたeTLD+1**で決まる。たとえば`https://foo.website.example`のサイトは`website.example`である。

この「サイト」という単位はorigin判定より緩いため、次のような分類が生まれる。

- `www.website.example` と `sandbox.website.example` → 同一サイト(eTLD+1が同じ)
- `website.example` と `foo.example` → 異なるサイト(eTLD+1が異なる)

SameSite属性は、Cookieがセットされたサイトと、リクエスト送信先のサイトが「同一サイト(same-site)」か「クロスサイト(cross-site)」かによって送信可否を切り替える仕組みである。値は3種類ある。

- **Strict**: 送信元ページと送信先が完全に同一サイトの場合のみCookieを送信する。他サイトが起点となるいかなるリクエスト(トップレベルナビゲーションを含む)でも送信されない。
- **Lax**: 「GETかつトップレベルナビゲーション」に限りクロスサイトでも送信を許可する。すなわち、他サイトのリンクをクリックして遷移してきた場合(GETナビゲーション)ではCookieが送られるが、`fetch()`や`XMLHttpRequest`、`<img>`のようなサブリソース読み込み、あるいはクロスサイトからのPOSTでは送信されない。
- **None**: クロスサイトでも常に送信を許可する。ただし、**Secure属性(HTTPS接続でのみ送信される属性)の付与が必須**であり、これを欠くとブラウザによっては拒否・無視される。

> 出典: Flatt Security: SameSite属性とCSRFとHSTS — https://blog.flatt.tech/entry/samesite_csrf_hsts

### なぜSameSiteでCSRFが防げるのか(仕組みレベル)

CSRF(Cross-Site Request Forgery)は、攻撃者が用意した罠ページから、被害者の意図しないリクエストを別サイト(標的サイト)に送信させる攻撃である。典型例として、攻撃者サイトに「クーポン獲得」ボタンを置き、クリックすると標的サイトへの「メールアドレス変更フォーム」が自動送信される、というシナリオがある。

```html
<!-- 攻撃者が用意した罠ページ(概念例) -->
<form action="https://bank.example/change-email" method="POST">
  <input type="hidden" name="email" value="attacker@evil.example">
</form>
<script>document.forms[0].submit()</script>
```

このリクエストは`bank.example`のサーバから見ると「正規ユーザーのブラウザから来たPOSTリクエスト」にしか見えない。なぜなら、ブラウザはCookieを**リクエスト先のドメインに紐づけて自動送信**するからであり、リクエストの発生元(どのページが送信を指示したか)をCookie自体は関知しないためだ。ユーザーが`bank.example`に既にログイン済みで認証Cookieを保持していれば、そのCookieはクロスサイトの罠ページ発のリクエストにも自動的に添付されてしまう。

ここでSameSite=Strictが効く理由は単純である。**Cookieがそもそもリクエストに乗らない**からだ。罠ページ(`evil.example`)から`bank.example`へのリクエストは、送信元サイトと送信先サイトが異なるクロスサイトリクエストにあたる。SameSite=Strictな認証Cookieはこの場合送信されないため、`bank.example`のサーバは未認証のリクエストとして扱い、変更処理は失敗する。これは「トークンを検証する」といった能動的な防御ではなく、「Cookieという認証情報自体をブラウザ側で物理的に届けない」という構造的な防御であり、実装ミスの入り込む余地が小さい点が強みである。

> 出典: Flatt Security: SameSite属性とCSRFとHSTS — https://blog.flatt.tech/entry/samesite_csrf_hsts

### ブラウザのデフォルト挙動の差異(2020年以降の潮流)

2020年2月リリースのChrome 80以降、`SameSite`属性を指定しないCookieは実質的に`Lax`として扱われるようになった(いわゆる"Lax by default")。これは「安全側に倒す」というブラウザベンダーの方針転換であり、Cookie発行者が明示的に`SameSite=None; Secure`を指定しない限り、クロスサイトPOSTなどでCookieが漏れ出さないようにするための施策である。

ただし、各ブラウザの実装には差異がある。

- **Chrome**: デフォルトでLax扱いになるが、後方互換性のため「Cookieがセットされてから2分間はクロスサイトPOSTでも送信を許可する」という緩和措置(Lax + POST猶予)を持つ。これは、既存Webサービスが暗黙のLax化で突然壊れることを防ぐための移行措置である。
- **Firefox**: デフォルトはNoneのままだが、Total Cookie Protection(包括的Cookie保護)という別機構により、Cookieの保存領域自体をサイトごとに分離してトラッキングを防止している。
- **Safari**: デフォルトはNoneだが、Intelligent Tracking Prevention(サイト越えトラッキング防止)が有効な状態では、JavaScript経由のクロスサイトリクエストでCookie送信を制限する。

この差異が示すのは、「SameSite属性の既定値やブラウザ側の補助機構に依存した設計は、ブラウザや設定によって効き方が変わる」という事実であり、アプリケーション側で明示的に`SameSite`を指定することの重要性を裏付けている。

> 出典: Flatt Security: SameSite属性とCSRFとHSTS — https://blog.flatt.tech/entry/samesite_csrf_hsts

### エッジケース1: スキームの違い(Schemeful SameSite)

SameSiteの「サイト」判定は本来ホスト名(eTLD+1)だけで決まり、スキーム(http/https)の違いは無視される、というのが伝統的な仕様だった。この仕様の隙を突く攻撃シナリオが以下である。

1. ユーザーが正規サイト`https://website.example`にアクセスし、SameSite=Strictな認証Cookieを取得する。
2. ユーザーが同一ドメインの改ざんされたHTTPページ`http://website.example`を(中間者攻撃や混在コンテンツ経由で)開いてしまう。
3. このHTTPページに埋め込まれたJavaScriptが`https://website.example`へリクエストを送る。

ここで問題になるのが、ブラウザ間の実装差である。

- **Chrome**: スキームの違いを別サイトとして扱う(Schemeful SameSiteを実装)ため、Cookieは送信されない。
- **Firefox / Safari**: スキームが異なっても同一ホスト名であれば同一サイト扱いとするため、Cookieが送信されてしまう。

この差は、HTTPページを経由した中間者的な攻撃(ネットワーク盗聴者がHTTP通信に不正なスクリプトを注入するなど)と組み合わさったとき、Firefox/Safariユーザーに実害を及ぼしうる。記事はこれを「Schemeful SameSiteが未統一な仕様上の曖昧さ」として指摘している。

**防御策**: HSTS(HTTP Strict Transport Security、後述)を有効化し、そもそもHTTP経由でのアクセスが成立しない状態を作ることで、この攻撃経路自体を封じることができる。

> 出典: Flatt Security: SameSite属性とCSRFとHSTS — https://blog.flatt.tech/entry/samesite_csrf_hsts

### エッジケース2: サブドメイン問題

前述のとおり、「サイト」はeTLD+1で決まるため、`sandbox.website.example`と`www.website.example`は同一サイトとみなされる。これは、ユーザーコードを実行するサンドボックス環境がサブドメインで運用されている場合に問題となる。

たとえば、あるサービスが`sandbox.website.example`でユーザー投稿のスクリプトを実行できる機能(コード実行環境、プレビュー機能など)を提供している場合、そのサブドメインから本体`website.example`へのリクエストはSameSite判定上「同一サイト」となり、Strict設定であってもCookieが送信されてしまう。攻撃者はこのサンドボックスに悪意あるコードを送り込み、そこから本体サービスへのリクエストを発行させることで、SameSite属性による防御を迂回できる可能性がある。

**防御策**: SameSite属性だけに依存せず、アプリケーション層でリクエストの正当性を検証する(後述のCSRFトークンやOriginヘッダ確認)ことが必要になる。サブドメインを信頼境界の外に置く設計(例: 完全に別のeTLD+1を採番する)も有効な緩和策である。

> 出典: Flatt Security: SameSite属性とCSRFとHSTS — https://blog.flatt.tech/entry/samesite_csrf_hsts

### HSTSとの関係

HSTS(HTTP Strict Transport Security)は、サーバがレスポンスヘッダ`Strict-Transport-Security`でブラウザに「以後このドメインへはHTTPSでのみアクセスせよ」と指示する仕組みである。

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

`includeSubDomains`を付けることで、サブドメインを含めた全体にHSTSの強制を及ぼせる。これにより、前述の「スキーム違いを悪用した攻撃」の入口となるHTTPアクセス自体をブラウザが拒否するようになり、Schemeful SameSiteの実装差異に起因するリスクを構造的に低減できる。ただし、HSTSはユーザーが一度もそのドメインにHTTPSでアクセスしたことがない状態(Trust On First Use)では効果がない点に留意が必要で、これを補うのがHSTS preloadリスト(ブラウザにあらかじめ組み込まれたHSTS対象ドメインの一覧)である。

> 出典: Flatt Security: SameSite属性とCSRFとHSTS — https://blog.flatt.tech/entry/samesite_csrf_hsts

### 「今どきのCSRF対策」への実務的な結論

Basicinc社の記事は、開発現場での実務的な結論として次を強調している。**「モダンなフレームワークを使い、そのCSRF対策機能を理解せずにオフにしないこと」**が最も費用対効果の高い対策である。以下、記事が整理する6つの代表的手法を仕組みとともに紹介する。

1. **トークン確認方式(Synchronizer Token Pattern)**: サーバがランダムなCSRFトークンを発行してセッションに保持し、フォームのhiddenフィールドとしてブラウザに埋め込む。送信されたトークンとセッション側のトークンを比較検証する。仕組みとしては「攻撃者は罠ページからこのトークン値を読み取れない(Same-origin Policyによりレスポンスの中身はクロスオリジンから閲覧不可)」という前提に立っている。実装コストは高いが手堅い。

2. **カスタムリクエストヘッダ確認**: `fetch()`でカスタムヘッダ(例: `X-Requested-With`)を付与すると、ブラウザは単純リクエストの条件を満たさなくなるためCORSのプリフライトリクエスト(`OPTIONS`メソッドでの事前確認)が飛ぶ。サーバはこのヘッダの有無を見て、通常のHTMLフォーム送信(`<form>`タグ)由来ではないAjaxリクエストであることを確認できる。欠点は、`<form>`タグによる素朴なPOSTはそもそもこのヘッダを持てず、保護対象にならない点である。

3. **SameSite Cookie(Lax/Strict)**: 前述のとおり2020年のChrome 84以降デフォルトLax化された。ただし単独では、GETリクエストで状態変更を行う設計(本来は避けるべきだが現実には存在する)や、認証を伴わないCSRF(投票フォームの多重送信など)には無力であり、「限界がある」ことが徳丸氏のフィードバックとして明記されている。

4. **Double Submit Cookie**: サーバ側にトークンを保存せず、トークンをCookieとしてブラウザに持たせ、リクエストボディ(またはヘッダ)にも同じ値を含めさせて、両者の一致を検証する。サーバ側のセッションストレージが不要という利点がある一方、Cookie自体を攻撃者が書き換えられる状況(サブドメインの脆弱性など)では突破されうるため、`Secure`属性・HTTPS化・`__Host-`プレフィックス(Cookie名の先頭に`__Host-`をつけることで、Secure属性必須・Domain属性指定禁止・Path=/必須という制約をブラウザに強制させ、他のCookieによる上書き=Cookie tossingを防ぐ仕組み)の併用が推奨される。

5. **Originヘッダ確認**: ブラウザが自動付与する`Origin`ヘッダとサーバ側のホスト名を比較する、実装が最も簡単な方式。ただし`Origin`ヘッダはCORSリクエストやPOSTなど一部の場合にのみ付与され、素朴なGETリクエストでは送られないため、GETでの状態変更保護には使えない制約がある。

6. **Sec-Fetch-Siteヘッダ確認**: ブラウザが自動的に付与する`Sec-Fetch-*`系ヘッダ群のうち、`Sec-Fetch-Site: same-origin`を検証することで、リクエストが同一オリジンから発行されたことを保証する。Originヘッダ確認よりも取りこぼしが少ないが、記事執筆時点(2022年8月)では**Safariが未対応**であり、ブラウザ対応状況を踏まえた採用判断が必要である(本節執筆時点でも対応状況は変わりうるため、実装前に最新のブラウザ互換表を確認すること)。

徳丸氏のフィードバックとして特に重要なのは次の3点である。

- 認証必須のサービスと非認証のサービスとでは、そもそも守るべき対象が異なるため対策方針を分けて考える必要がある。
- クロスドメインの脅威以上に、Cookie自体が書き換えられる(改ざんされる)リスクを軽視してはならない。
- SameSiteの限界事例として、GETでの状態変更、認証なしの機能、レガシーブラウザ対応の3つが明示的に挙げられている。

また、Ruby on Railsの`skip_forgery_protection`のように、エラー解決のために仕組みを理解しないままCSRF対策を無効化してしまう事例が実務でしばしば見られる、という警鐘も記事にある。これは典型的な「セキュリティ機構を邪魔者として消してしまう」アンチパターンであり、本来はエラーの原因(トークンの受け渡し不備など)を特定して解消すべきである。

> 出典: Basicinc: 今時のCSRF対策ってなにをすればいいの？ — https://tech.basicinc.jp/articles/231

### XSS・CSRF・CORS・Same-origin Policy・Cookieの関係の整理

最後に、これらの概念が互いにどう絡み合うのかを俯瞰しておく。Zenn記事は学習順序として「XSS → Cookieの挙動 → Same-origin Policy → CORS → CSRF/SameSite → セッション管理手段の比較」を提案しており、この順序には理由がある。CSRFを理解するには、その前提であるCookieの自動送信の仕組みとSame-origin Policyの守備範囲を先に理解する必要があるからだ。

**Same-origin Policyの実像**: 「異なるオリジンへのリクエストを全部ブロックする」という理解は不正確である。実際には、`<form>`タグによるPOST送信のような「単純リクエスト」はブラウザによって普通に送信され、**レスポンスをJavaScriptから読み取れないだけ**である。CSRFはまさにこの隙、すなわち「レスポンスの中身は見えなくても、リクエストが実行され副作用(送金、メール変更など)が発生してしまえば攻撃者の目的は達成される」という性質を突く攻撃である。

**CORSの役割の誤解に注意**: CORSは「サーバが特定のオリジンからのリクエストを許可するための仕組み」であり、`Access-Control-Allow-Origin`ヘッダで許可先を指定する。これはあくまで**ブラウザに対する許可のシグナル**であり、認証や認可の代替にはならない。単純リクエストの条件を満たすリクエスト(前述のカスタムヘッダなしのフォームPOSTなど)はプリフライト(`OPTIONS`)が飛ばないため、CORS設定の有無に関わらず送信自体は成立してしまう点が、CSRFとの関連で重要である。

**セッション管理方式の比較**は、CSRF対策を考えるうえでも意味を持つ。

| 手段 | 強み | 弱み |
|---|---|---|
| Cookie(HttpOnly付き) | XSSでJSから直接読み取られない、有効期限管理が容易 | 自動送信されるためCSRFの対象になりやすい |
| LocalStorage | JavaScriptから扱いやすい | XSS成功時にトークンを丸ごと窃取されうる、有効期限管理を自前実装する必要 |
| インメモリ(JS変数) | 永続化されないため盗まれにくい | ページリロードで消える、UXとのトレードオフ |

この比較から導かれる結論は、「XSS対策とCSRF対策は独立した課題であり、片方の対策(例: トークンをLocalStorageに置いてCSRFを回避する設計)がもう片方(XSS耐性)を犠牲にするトレードオフになりうる」という点である。したがって、セッション管理方式を選ぶ際は、CSRF対策とXSS対策の両方を同時に満たす設計(HttpOnly+Secure+SameSiteを揃えたCookie運用とCSRFトークンの併用など)を検討する必要がある。

> 出典: Zenn(dove): XSS・CSRF・CORS・Same-origin policy・cookieの整理 — https://zenn.dev/dove/articles/3dc0b8603db3fd

### 本節のまとめ

SameSite属性は、Cookieの自動送信という長年のCSRFの根本原因に対する構造的な防御であり、2020年以降のブラウザのデフォルトLax化によって実質的に「多くのCSRFシナリオを標準で防ぐ」状態が実現した。しかし、その効力は次の条件に依存する。

- ブラウザの実装差(Chrome/Firefox/Safariでの既定挙動・Schemeful SameSite対応の有無)
- スキーム(HTTP/HTTPS)混在時の脆弱性(HSTSでの緩和が必要)
- サブドメイン構成(eTLD+1が同じ範囲は「同一サイト」として扱われる)
- GETでの状態変更や非認証機能など、SameSiteの保護範囲外のケース

したがって実務上の結論は、**SameSite属性を「最初の防御層」として明示的に設定しつつ(指定なしに頼らない)、トークン確認やOrigin/Sec-Fetch-Siteヘッダ確認などのアプリケーション層の検証を組み合わせる多層防御**が現実的な解である。特にモダンなWebフレームワークは既にこれらを組み合わせて実装しているため、「機能を理解せずに無効化しない」ことが最も基本的かつ費用対効果の高い対策である。
