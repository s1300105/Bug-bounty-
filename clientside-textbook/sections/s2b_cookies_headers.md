## Cookie属性とセキュリティヘッダ

クライアントサイド脆弱性ハンティングにおいて、CookieとHTTPセキュリティヘッダは「ブラウザのセキュリティモデルの設定ファイル」に相当する。XSSが成立しても盗めるものが変わり、CSRFが成立するかどうかが変わり、クリックジャッキングやクロスオリジンの情報漏えいが成立するかどうかが変わる——それを決めているのがこの章で扱う一連の属性・ヘッダである。ここでは「攻撃者がどこを狙うか」ではなく「防御側がどこを固めるべきか」という観点で、各属性・ヘッダの仕組みと推奨値を整理する。

### 1. Set-Cookieの基本構文とセキュリティ属性

Cookieはサーバーが`Set-Cookie`レスポンスヘッダで発行し、ブラウザがCookieストア（cookie jar）に保存する。以降、そのCookieの発行条件に一致するリクエストにブラウザが自動的に付与して送信する。この「自動付与」という性質こそが、CSRF（Cross-Site Request Forgery、攻撃者サイトから被害者のブラウザ経由で正規サイトへ意図しないリクエストを送らせる攻撃）が成立する根本原因であり、同時にセッション管理を成立させている仕組みでもある。

基本的なSet-Cookieの構文は次の通りである。

```
Set-Cookie: session_id=abc123; Domain=example.com; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600; Secure; HttpOnly; SameSite=Lax
```

各フィールドの役割は以下の通り。

- **Domain**: Cookieを送信するホストの範囲を指定する。省略した場合はCookieを発行したホストのみに限定される（ホストオンリークッキー）。`Domain=example.com`のように明示すると、`sub.example.com`のようなサブドメインも含めて送信対象になる。範囲を広げるほど、あるサブドメインが乗っ取られた（サブドメインテイクオーバーされた）場合の影響範囲が広がるため、原則としてDomain属性は省略し、必要な場合のみ最小限のスコープで指定する。
- **Path**: Cookieが送信されるURLパスの範囲を指定する。ただしPathはセキュリティ境界としては信頼できない。同一オリジンの別パスに配置されたスクリプトからは`document.cookie`で読めてしまうことが多く、パスによるアクセス制御は補助的なものに過ぎない。
- **Expires / Max-Age**: Cookieの有効期限。両方省略するとセッションクッキー（ブラウザを閉じると消える）になる。Max-Ageの方が相対時間指定でクロックスキューの影響を受けにくく優先される。
- **Secure**: HTTPS接続でのみCookieを送信する属性。この属性がないと、同じCookieが平文HTTP経由でも送信されてしまい、能動的なネットワーク盗聴者（Man-in-the-Middle）がセッションCookieを平文で取得できてしまう。HTTPページからHTTPSページへの遷移時にも、HTTP側で発行されたCookieがそのまま使われるケースがあるため、Secure属性は「常時HTTPS化」とセットで運用する必要がある。
- **HttpOnly**: JavaScriptの`document.cookie`からの読み取り・書き込みを禁止する属性。これによりXSSが発生してもインラインスクリプト経由で直接Cookie文字列を盗み出すことができなくなる。ただし後述の通り、HttpOnlyは「Cookie窃取」を防ぐだけで、「そのCookieを使った操作」自体は防がない点に注意が必要である。
- **SameSite**: クロスサイトリクエストにCookieを付与するかどうかを制御する属性。詳細は次節で扱う。

> ⚠️ **未取得の資料**: 「Secure/HttpOnly/SameSite と Set-Cookie の解説（Medium, João Manuel Gomes, The Startup）」は自動取得できませんでした（理由: サーバーがHTTP 403 Forbiddenを返し本文を取得できず、WebSearchでも要約スニペットのみで原文全文は得られなかった）。以下のURLからご自身で直接ご覧ください: https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6
>
> （以下は未取得資料の補足として一般知識に基づく解説です）記事の要点は検索結果の要約から、Secure/HttpOnly/SameSiteの3属性がそれぞれ独立した攻撃経路を塞ぐという整理であり、認証用Cookieには`Set-Cookie: session_id=abc123; Secure; HttpOnly; SameSite=Lax`のように3属性すべてを付けることが推奨されている。これは本節で述べる内容と一致する一般的なベストプラクティスである。加えて、HttpOnly付きCookieであっても`fetch()`のような通常のHTTP通信では自動的に送信される（JavaScriptから値を「読む」ことはできないが、ブラウザが「送る」動作自体は止まらない）という点が強調されており、これはCSRF対策としてHttpOnlyだけでは不十分でSameSiteやCSRFトークンが必要になる理由でもある。

#### なぜHttpOnlyだけではCSRFを防げないのか

HttpOnlyはあくまで「JavaScriptからのCookie値の読み取り」を防ぐものであり、「ブラウザがそのCookieをリクエストに自動添付する」動作そのものは止めない。攻撃者サイト上のフォームや`<img>`タグ、`fetch(..., {credentials: 'include'})`などがブラウザに正規サイトへのリクエストを発行させた場合、HttpOnly属性の有無にかかわらずCookieは自動的に付与される。攻撃者はCookieの中身を知る必要すらなく、被害者のブラウザに「代わりにリクエストを送らせる」だけでよい。これがCSRFの本質であり、これを止めるのがSameSite属性とCSRFトークンである。

### 2. SameSite属性: Strict / Lax / Noneの挙動

SameSite属性は、あるリクエストが「サイトをまたぐ（クロスサイト）」ものかどうかを判定し、クロスサイトの場合にCookieを送るかどうかを制御する。ここでいう「サイト」とは、オリジン（スキーム＋ホスト＋ポート）よりも粗い単位で、eTLD+1（実効トップレベルドメイン＋1ラベル、例: `example.com`）を基準に同一サイト判定を行う。つまり`app.example.com`と`shop.example.com`はオリジンとしては別だが、サイトとしては同一サイト（same-site）である。

web.devの記事「SameSite cookies explained」は、3つの値の挙動を次のように説明している。

```
Set-Cookie: promo_shown=1; SameSite=Strict
```

**Strict**は最も制限的な設定である。記事の説明を引用すると、"When the user is on your site, the cookie is sent with the request as expected. However, if the user follows a link into your site from another one, the cookie isn't sent on that initial request."（ユーザーがそのサイト上にいる間はCookieが期待通り送信されるが、他サイトからのリンクをたどってそのサイトに遷移してきた最初のリクエストではCookieが送信されない）。つまり外部サイトからのリンククリックによる初回のトップレベルナビゲーションでもCookieが付かないため、たとえば「他サイトからリンクを踏んでログイン状態のまま遷移したい」ようなユースケースには向かない。銀行の送金操作用Cookieなど、外部からの遷移で自動ログイン状態になる必要が全くない、極めて機微な操作向けの設定である。

```
Set-Cookie: promo_shown=1; SameSite=Lax
```

**Lax**は中間的な設定である。トップレベルナビゲーション（ユーザーがリンクをクリックする、フォームをGETで送信する、ブラウザのアドレスバーに入力するなど、ブラウザのURLバーに表示されるページ遷移）でかつHTTP GETのような「安全な」メソッドの場合にはクロスサイトでもCookieを送信するが、クロスサイトの`<img>`読み込みや`<iframe>`埋め込み、バックグラウンドの`fetch`/`XMLHttpRequest`ではCookieを送信しない。これにより、外部サイトのリンクを踏んで正規サイトに移動した際にはログイン状態が維持されつつ、隠れた画像タグや自動送信フォームによるクロスサイトPOSTのようなCSRF典型パターンではCookieが付かずセッションが機能しない、というバランスを取っている。

```
Set-Cookie: widget_session=abc123; SameSite=None; Secure
```

**None**はすべてのコンテキスト（クロスサイトの`<iframe>`埋め込みウィジェット、サードパーティの決済ボタン、クロスサイトのAjaxリクエストなど）でCookieを送信する。正規のサードパーティ連携（例: 埋め込みチャットウィジェット、シングルサインオン連携、決済プロバイダのiframe）ではこの設定が必要になる場合があるが、CSRF保護は一切効かなくなるため、CSRFトークンなど別の防御機構と必ず併用しなければならない。

#### デフォルト値の変遷: Chrome 80 (2020年2月) 以降

web.devの記事は、"Cookies without a `SameSite` attribute are treated as `SameSite=Lax`"（SameSite属性を指定していないCookieはSameSite=Laxとして扱われる）と述べている。これはChrome 80（2020年2月リリース）で導入された`SameSite=Lax by default`という仕様変更であり、それ以前はSameSite属性を省略すると事実上`None`相当（無制限にクロスサイト送信される）の挙動だった。この変更は業界標準として他のモダンブラウザ（Firefox、Edgeなど）にも順次波及しており、2026年時点では「SameSite省略＝Lax扱い」が主要ブラウザの共通挙動になっている。この変更の狙いは、開発者が明示的に選択しない限り、デフォルトでCSRFに対して安全側に倒すことである。裏を返せば、意図的にクロスサイトでCookieを送りたい場合は`SameSite=None`を明示しなければならなくなった。

#### SameSite=NoneにSecureが必須になった理由

記事は"When you create cross-site cookies using `SameSite=None`, you must also set them to `Secure` for the browser to accept them."（`SameSite=None`でクロスサイトCookieを作る場合、ブラウザに受理させるには`Secure`属性も同時に設定しなければならない）と説明している。これはChromeやFirefoxなどが仕様レベルで強制している挙動で、`SameSite=None`かつ`Secure`が付いていないCookieはブラウザによって拒否・削除される。理由は仕組みレベルで理解しておく価値がある。SameSite=Noneはクロスサイトの任意のコンテキストからCookieが送信されることを許可する設定であり、これはCookieの露出範囲を最大化する。もしこの状態でHTTP平文通信も許容してしまうと、ネットワーク上の盗聴者が中間者攻撃でクロスサイトCookieを平文キャプチャできてしまい、SameSite=Noneの緩さとSecureなしの緩さが掛け合わさって被害が最大化する。そのため、ブラウザベンダーは「クロスサイト送信を許可するなら、最低限通信路は暗号化されていることを保証する」という形で、Secure必須をポリシーとして強制した。

#### 後方互換性の問題

記事では、"Some earlier versions of browsers, including Chrome, Safari, and UC browser, are incompatible with the new `None` attribute, and might ignore or restrict the cookie."（Chrome、Safari、UCブラウザを含む一部の旧バージョンブラウザは新しい`None`属性と互換性がなく、そのCookieを無視または制限する場合がある）と警告している。具体的には、Chrome 51〜66やSafariの一部バージョンは`SameSite=None`を「無効な値」として認識し、Cookie自体を拒否したり、`Strict`相当として扱ったりする既知の不具合（web.devの原記事、および[chromium.org のIncompatible Clients一覧](https://www.chromium.org/updates/same-site/incompatible-clients/)で個別に列挙されている）があった。そのため、サードパーティCookieに依存するサービスを設計する際は、UAスニッフィングによる分岐や、影響を受けるトラフィック割合の事前分析が推奨されている。2026年時点ではこれらの旧ブラウザはシェアが極めて小さくなっているが、レガシー環境をサポート対象に含める場合は依然として考慮が必要な既知の互換性問題である。

> 出典: SameSite cookies explained — https://web.dev/articles/samesite-cookies-explained

#### Schemeful Same-Site（補足）

一般知識として補足すると、同一サイト判定は当初ホスト名（eTLD+1）のみで行われていたが、その後スキーム（`http://`か`https://`か）も判定に含める「Schemeful Same-Site」という拡張がChromeなどに導入されている。この方式では`http://example.com`と`https://example.com`は同一サイトとはみなされず、クロスサイト扱いになる。これは、HTTPページに対する能動的なネットワーク攻撃者がHTTPS版のCookieに影響を与えることを防ぐための、混在コンテンツ・ダウングレード攻撃対策である。常時HTTPS化されたサイトであれば影響は小さいが、HTTPとHTTPSが混在する移行期のサイトでは、同一ドメインでもCookieがsame-site扱いされずSameSite=Laxのnavigationルールなどに影響することがある。

### 3. OWASPが推奨するセキュリティヘッダ一覧

OWASP HTTP Headers Cheat Sheetは、ブラウザに追加のセキュリティ制約を課すレスポンスヘッダ群を整理している。ここではCookie以外の主要ヘッダを、仕組みと推奨値つきで解説する。

#### Strict-Transport-Security (HSTS)

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

HSTSは「このホストへは今後HTTPSでのみ接続せよ」とブラウザに指示するヘッダである。`max-age`（秒単位、上記は約2年）の間、ブラウザはユーザーが`http://`で入力しても自動的に`https://`へ内部的に書き換えてから接続する。これは単なるリダイレクトとは異なり、最初の1回の平文リクエストすら発生させない点が重要である。HTTPリダイレクト（HTTP 301などによるhttps化）だけに頼ると、最初のHTTPリクエスト自体が中間者に平文で観測され、そこでセッションCookieを盗まれたりページ内容を改ざんされたりする「SSL Stripping」攻撃が成立しうる。HSTSはブラウザ側のキャッシュされたポリシーとして機能するため、2回目以降のアクセスではこの脆弱な平文リクエストが発生しなくなる。`includeSubDomains`を付けるとすべてのサブドメインにも同ポリシーが適用され、`preload`はブラウザベンダーが管理するプリロードリストへの登録を意図した指定で、初回アクセス時点から（DNSで名前解決する前から）HTTPS強制を効かせられる。ただし、HSTSはドメインに対して長期間有効になるため、証明書の運用停止やドメイン譲渡時に「もうHTTPSで動いていないのにブラウザがHTTPS接続を強制し続けアクセス不能になる」という運用上のリスクがある点に注意が必要である。

#### X-Frame-Options / frame-ancestors

```
X-Frame-Options: DENY
```

ページが`<iframe>`・`<frame>`・`<embed>`・`<object>`で他ページに埋め込まれることを制御するヘッダである。これがないと、攻撃者が正規サイトを透明な（`opacity:0`などの）iframeでオーバーレイし、ユーザーには別の見た目のボタンを見せながら、実際には正規サイトの重要な操作ボタンをクリックさせるクリックジャッキング（Clickjacking／UI Redressing）攻撃が成立しうる。`DENY`はいかなるフレームからの埋め込みも拒否し、`SAMEORIGIN`は同一オリジンからの埋め込みのみ許可する。なお、X-Frame-Optionsは仕様として単一オリジンしか許可リストに指定できない制約があり、より柔軟な制御にはCSPの`frame-ancestors`ディレクティブ（例: `Content-Security-Policy: frame-ancestors 'self' https://partner.example.com`）が推奨される。両方を併記しておくと、CSP未対応の古いブラウザに対するフォールバックとして機能する。

#### X-Content-Type-Options

```
X-Content-Type-Options: nosniff
```

ブラウザのMIMEタイプスニッフィング（宣言されたContent-Typeを無視して、レスポンスの中身のバイト列から実際のファイル種別を推測する挙動）を無効化するヘッダである。スニッフィングが有効だと、たとえばアップロードされたテキストファイルの中身がHTMLやJavaScriptとして解釈可能な形になっていた場合、サーバーが`Content-Type: text/plain`と宣言していても、ブラウザが中身を見て「これはHTMLだ」と判断し実行してしまうことがある。これは、ユーザーがアップロードした一見無害なファイル（画像やテキスト）をHTMLとして誤解釈させ、格納型XSSを成立させる経路になりうる。`nosniff`はこの推測処理を止め、サーバーが宣言したContent-Typeを厳密に信頼させる。

#### Content-Security-Policy (CSP)

CSPはコンテンツの読み込み元をディレクティブ単位で許可リスト化し、インラインスクリプトの実行を制限するなどしてXSSの被害を大幅に緩和する仕組みである。OWASPのチートシートでは詳細な設計は専用のCSPチートシートに譲っているが、HTTP Headersチートシートの文脈では「インラインJavaScriptを無効化することでDOM操作やイベントハンドラ経由の攻撃を防止する」点が要点として挙げられている。CSPはこの教科書の他章で詳細に扱う前提のため、ここでは「Cookie・ヘッダの防御層の一つとして併用すべきもの」という位置づけに留める。

#### Referrer-Policy

```
Referrer-Policy: strict-origin-when-cross-origin
```

`Referer`ヘッダ（ブラウザがリンク元のURLをリクエスト先に伝えるヘッダ、仕様上のスペル間違いがそのまま定着している）の送信範囲を制御する。`strict-origin-when-cross-origin`は、同一オリジンへの遷移では完全なURL（パスやクエリ文字列含む）を送るが、クロスオリジンへの遷移ではオリジン部分のみ（パスやクエリを含まない）に切り詰め、さらにHTTPSからHTTPへのダウングレードが伴う遷移ではReferer自体を送らないという挙動になる。これが重要なのは、URLのクエリ文字列にセッショントークンやパスワードリセットトークン、個人情報などが含まれるケースがしばしばあり、外部サイトへのリンクを踏んだ際にそれらが第三者のサーバーログに残ってしまう「Referer経由のトークン漏えい」を防ぐためである。

#### Permissions-Policy（旧Feature-Policy）

```
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

カメラ、マイク、位置情報、フルスクリーンなどブラウザの強力な機能に対するオリジン単位のアクセス許可を制御する。空の許可リスト`()`は「どのオリジンにも許可しない」ことを意味する。この防御が効くシナリオとして、たとえページ内にXSSが成立してJavaScriptが自由に実行できたとしても、Permissions-Policyでカメラ・マイクの利用が明示的に禁止されていれば、攻撃者スクリプトが`getUserMedia()`を呼び出してもブラウザ側でブロックされ、盗聴・盗撮のような二次被害には発展しない。多層防御（defense in depth）の一例である。

#### クロスオリジン分離系ヘッダ: COOP / COEP / CORP

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-site
```

この3つは、SpectreのようなCPUの投機的実行を悪用したサイドチャネル攻撃（プロセス間のメモリ境界を越えて秘密データを読み出す攻撃）に対する防御として整備された、比較的新しい世代のヘッダ群である。ブラウザは通常、プロセス分離（サイトごとに別プロセスで描画する、いわゆるSite Isolation）によってオリジンをまたいだメモリアクセスを防いでいるが、Spectre系の攻撃はこの分離を回避しうる。COOP（`same-origin`）はトップレベルウィンドウが他オリジンの`window.opener`経由の参照を持たないようにし、ブラウジングコンテキストグループを分離する。COEPは埋め込むリソースに明示的なクロスオリジン許可（CORPヘッダまたはCORS）を要求し、無許可のクロスオリジンリソース読み込みをブロックする（例外的に、個々のリソースタグに`crossorigin`属性を付与することでCORS経由の読み込みは許可できる）。CORP（`same-site`）は逆に、自分のリソースがどのオリジンから読み込まれてよいかを宣言する側のヘッダであり、他サイトからの無断埋め込み（例: 画像の直リンクや動画の埋め込み）を制限する。COOPとCOEPを両方有効にしてクロスオリジン分離状態（`crossOriginIsolated`）を達成すると、`SharedArrayBuffer`のような高精度タイマーを構成しうる強力なAPIを安全に使えるようになる、という表裏の関係もある。

#### Cache-Control

```
Cache-Control: no-store
```

認証情報や個人情報を含むレスポンスに対しては`no-store`を指定し、ブラウザにも中間キャッシュ（プロキシ、CDNなど）にも一切キャッシュさせない。これがないと、共有端末やブラウザの「戻る」操作、あるいはキャッシュサーバー上に機微な情報を含むレスポンスが残留し、後から別のユーザーやローカルアクセス権を持つ者に閲覧される可能性がある。似た値に`private`（共有キャッシュには保存させないがブラウザローカルキャッシュは許可）、`no-cache`（キャッシュ自体は許可するが再利用前にサーバーへの検証を必須にする、実質的には「無条件キャッシュ禁止」に近い）があり、用途に応じて使い分ける。

#### 情報漏えい系ヘッダの削除

```
Server: webserver
```

`Server`ヘッダや`X-Powered-By`ヘッダは、稼働しているミドルウェアやフレームワークのバージョン情報を露出させ、攻撃者が既知の脆弱性（CVE）を突き合わせて攻撃対象を絞り込む助けになってしまう。OWASPのチートシートでは、これらのヘッダを削除するか、`Server: webserver`のような無意味な値に上書きすることを推奨している。.NET環境における`X-AspNet-Version`ヘッダも同様の理由で、`web.config`の`<httpRuntime enableVersionHeader="false" />`設定や、グローバルの`MvcHandler.DisableMvcResponseHeader = true`によって無効化することが推奨されている。

なお`X-XSS-Protection`ヘッダ（古いブラウザのXSSフィルタを有効化するもの）は`X-XSS-Protection: 0`で明示的に無効化することがOWASPの現在の推奨である。理由は、このフィルタ機構自体がInternet Explorerなど旧世代ブラウザにのみ実装されており、モダンブラウザ（Chrome、Firefoxなど）ではすでに廃止済みである上、フィルタの実装不備がかえって新種のXSS（フィルタ自体の挙動を悪用したもの）を生み出す事例が過去に報告されたためである。現在はCSPによるXSS対策への一本化が推奨されている。

#### サーバー・フレームワーク別の実装例

OWASPのチートシートは、同じヘッダをどう設定するかを主要なサーバー・フレームワークごとに示している。X-Frame-Optionsを例に引用する。

```apache
<IfModule mod_headers.c>
   Header unset X-Frame-Options
   Header always set X-Frame-Options "DENY"
</IfModule>
```

```nginx
add_header "X-Frame-Options" "DENY" always;
```

```javascript
const helmet = require('helmet');
const app = express();
app.use(helmet.frameguard({action: "sameorigin"}));
```

Node.js/ExpressではHelmetのようなミドルウェアライブラリを使うと、この章で挙げたヘッダの多くをまとめて安全なデフォルト値で付与できる。設定を個別に手書きするよりも、こうした実績のあるライブラリのデフォルト設定に乗る方が、指定漏れや値の誤りによる防御の穴を減らせる。

#### 廃止されたヘッダへの注意

`Expect-CT`ヘッダと`Public-Key-Pins`（HPKP）ヘッダは、OWASPのチートシートで明確に「使用しない」ことが推奨されている。HPKPは証明書のピン留めをブラウザに強制する仕組みだったが、運用ミスでピン留めした鍵をすべて紛失するとサイトへのアクセスが完全に不能になるリスクが大きく、Chromiumは2018年に対応を削除し、現在主要ブラウザはいずれも未対応である。証明書の信頼性検証は、現在ではCertificate Transparency（証明書発行の透明性ログ）とCAA DNSレコード（そのドメインに対して証明書を発行してよい認証局を制限する仕組み）による代替策に移行している。バージョン依存の強い分野なので、教科書や記事を読む際は「いつの情報か」を必ず確認する習慣が重要である。

> 出典: OWASP HTTP Headers Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html

### 4. まとめ: Cookie属性とヘッダの防御はどう組み合わさるか

この章で扱った属性・ヘッダは、単独では特定の攻撃ベクトルにしか効かないが、組み合わせることで層になった防御（defense in depth）を構成する。典型的なセッションCookieの安全な発行例をまとめると、次のようになる。

```
Set-Cookie: session_id=<ランダムな高エントロピー値>; Secure; HttpOnly; SameSite=Lax; Path=/
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Content-Security-Policy: frame-ancestors 'self'; script-src 'self'
Referrer-Policy: strict-origin-when-cross-origin
Cross-Origin-Opener-Policy: same-origin
```

Secureは盗聴者による平文窃取を防ぎ、HttpOnlyはXSS成立時のCookie直接窃取を防ぎ、SameSiteはCSRFおよびクロスサイトでの意図しないセッション利用を防ぎ、HSTSはそもそも平文接続自体を発生させないようにし、X-Frame-Options/CSPのframe-ancestorsはクリックジャッキングを防ぎ、COOPはクロスオリジンのウィンドウ参照を断ち切る。クライアントサイド脆弱性のハンティングにおいては、これらの設定の「どれが欠けているか」「どこまで緩められているか」を確認することが、XSSやCSRF、クリックジャッキングといった個別の脆弱性が実際にどこまでの被害に発展しうるかを見積もる第一歩になる。逆に防御側の視点では、ここに挙げたヘッダとCookie属性を漏れなく設定することが、個々のコード脆弱性を潰すのとは独立した、もう一段のセキュリティ境界を作ることになる。
