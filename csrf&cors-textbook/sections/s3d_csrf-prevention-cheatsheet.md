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
