## OAuth stateパラメータ欠落とCSRF ATO

OAuth 2.0 の認可コードフロー（Authorization Code Flow）は、それ自体が「ブラウザのリダイレクトを介した3者間の橋渡し」であり、構造的に CSRF（Cross-Site Request Forgery、被害者のブラウザを踏み台にして意図しないリクエストを送らせる攻撃）と隣り合わせになっている。この節では、OAuth の `state` パラメータが本質的には CSRF トークンそのものであること、その欠落が「ログイン CSRF」から本格的なアカウント乗っ取り（ATO: Account Takeover）へと直結する仕組み、そして「`state` があっても防げないケース（静的・予測可能・セッション非結合な `state`）」までを、原典に沿って仕組みレベルで解説する。

なぜこれが CSRF/CORS の教科書の一章に入るのか。第7章までで見た古典的な CSRF は「被害者に、被害者自身のセッションで、攻撃者の望む状態変更リクエストを送らせる」ものだった。OAuth の CSRF は方向が逆転することがある。すなわち「被害者に、**攻撃者の**認可コード（credential）を使わせ、被害者のアプリ内アカウントを**攻撃者のアイデンティティに紐付けさせる**」——これが後述する「login CSRF / account linking CSRF」で、結果として攻撃者は自分の SNS ログインで被害者のアプリアカウントに入れてしまう。CSRF の防御思想（リクエストの出所を検証する）が、OAuth では `state` という形で実装されている、という一点で両者は完全につながっている。

### OAuth 認可コードフローと `state` の位置づけ（前提の整理）

まず記号を固定する。登場人物は3者。

- **ユーザー（Resource Owner）**: 被害者になりうるブラウザの持ち主。
- **クライアント（RP: Relying Party）**: 「Google でログイン」ボタンを置いている当のアプリ。脆弱性の主な所在地。
- **認可サーバ（IdP: Identity Provider）**: Google / GitHub など、本人確認とコード発行を担う側。

認可コードフローの標準的な流れは次の通り。

```
(1) ユーザーがRPで「GitHubでログイン」を押す
(2) RP → ブラウザ: IdPの認可エンドポイントへリダイレクト
    https://idp.example/authorize
      ?response_type=code
      &client_id=RP_CLIENT_ID
      &redirect_uri=https://rp.example/callback
      &scope=openid email
      &state=RANDOM_PER_REQUEST_VALUE   ← これがCSRFトークン
(3) ユーザーがIdPでログイン・同意
(4) IdP → ブラウザ: RPのredirect_uriへリダイレクト
    https://rp.example/callback?code=AUTH_CODE&state=RANDOM_PER_REQUEST_VALUE
(5) RPが state を検証 → 一致すればcodeをトークンに交換 → ログイン確立
```

ここで決定的なのは **(2) で送った `state` と、(4) で戻ってきた `state` が同一であることを (5) で検証する**という往復である。RFC 6749（OAuth 2.0）第10.12節は `state` について「a non-guessable value（推測不能な値）」を要求し、これを CSRF 対策として位置づけている。つまり `state` は「この callback は、確かに**このブラウザが**、確かに**さっき自分が**開始したフローの続きである」ことを保証するための、リクエスト単位のワンタイムトークンにほかならない。CSRF トークンと役割が完全に同一である点を、まず腹に落としてほしい。

### 資料1: `state` 欠落による CSRF アカウント乗っ取り（stateパラメータ＝CSRFトークンの理解）

> ⚠️ **未取得の資料**: 「Hacking your first OAuth on the Web application: Account takeover using Redirect and State parameter」(TECNO Security / Medium) は自動取得できませんでした（理由: Medium が HTTP 403 Forbidden を返し、原本ミラー security.tecno.com/SRC/blogdetail/330 も JavaScript レンダリングのため本文テキストを抽出できなかった）。以下のURLからご自身で直接ご覧ください: https://medium.com/@security.tecno/hacking-your-first-oauth-on-the-web-application-account-takeover-using-redirect-and-state-5e857c7b1d43

（以下は未取得資料の補足として、記事タイトル・検索で得られた要旨・および一般知識に基づく解説です。記事の主眼は「`redirect_uri` の甘い検証」と「`state` の未実装/未検証」という2つの古典的欠陥が、いかにしてアカウント乗っ取りに至るかを初学者向けに解説することにある。）

#### `state` が無い／検証されないと何が起きるか

`state` を送らない、または戻り値を検証しない RP を考える。この RP の callback は、要するに次のような「素の GET リクエスト」を受け取ると、その `code` を無条件にトークン交換し、その IdP アイデンティティを**現在のブラウザセッションに結びつける**。

```
GET https://rp.example/callback?code=AUTH_CODE
```

このリクエストには、被害者アプリの Cookie 以外に「出所を証明するもの」が何もない。したがって攻撃者は次の手順で「被害者のアプリ内アカウントを、攻撃者の IdP アイデンティティに乗っ取らせる」ことができる。これが **login CSRF（別名 account linking CSRF）** である。

```
手順（account linking CSRF によるATO）
1. 攻撃者が自分のブラウザでRPのOAuthフローを開始し、
   自分のGitHubアカウントでIdPログイン・同意まで進める。
2. IdPがRPへ返すはずのリダイレクト直前で攻撃者が処理を止め、
   自分あての「code=ATTACKER_CODE」を含むcallback URLを横取りする。
   （実際にはトークン交換前のcallback URLを盗む／作る）
3. 攻撃者はこのURLを罠として仕込む:
   <img src="https://rp.example/callback?code=ATTACKER_CODE">
   あるいは自動送信フォーム・リンクとして被害者に踏ませる。
4. 被害者が自分のRPログイン済みセッションでこのURLを開くと、
   RPは「ATTACKER_CODE」をトークン交換し、
   攻撃者のGitHubアイデンティティを"被害者のRPアカウント"に紐付ける。
5. 以後、攻撃者は自分のGitHubログインでRPにサインインでき、
   被害者のRPアカウント（データ・権限）にアクセスできる。
```

なぜこれが成立するのか。`state` があれば手順4で「戻ってきた `state` が、このブラウザが手順で自分で生成・保存した値と一致するか」を RP が検証する。攻撃者が仕込んだ URL の `state`（あるいは `state` 無し）は、被害者ブラウザが保存している値と一致しないため、RP はフローを中断できる。逆に `state` が無い／検証されなければ、この「出所チェック」が丸ごと欠落し、任意の攻撃者由来 `code` を被害者セッションに流し込めてしまう。CSRF の本質「リクエストの出所を検証しない」が、そのまま OAuth に現れた形である。

#### `redirect_uri` 操作との連鎖

記事のもう一つの柱は `redirect_uri` の検証不備である。IdP が `redirect_uri` を厳密一致（exact match）でなく前方一致・部分一致・サブドメイン許容などで緩く検証していると、攻撃者は次のように**認可コードを攻撃者のサーバへ横取り**できる。

```
攻撃者が誘導する認可リクエスト（redirect_uri改ざん）:
https://idp.example/authorize
  ?response_type=code
  &client_id=RP_CLIENT_ID
  &redirect_uri=https://rp.example.attacker.com/callback   ← 緩い検証を突破
  &scope=openid email
  &state=...

被害者がログイン・同意すると、codeは attacker.com に届く:
GET https://rp.example.attacker.com/callback?code=VICTIM_CODE&state=...
```

`state` 欠落が「攻撃者の code を被害者に使わせる（linking CSRF）」方向の攻撃なのに対し、`redirect_uri` 操作は「被害者の code を攻撃者が奪う（code 窃取）」方向の攻撃である。両者は独立にも成立するが、実務では「`redirect_uri` の緩さで code を盗み、`state` 欠落で検証を回避する」といった形で連鎖し、より確実な ATO になる。防御は次の2点が核心。

- **`state`**: 推測不能・リクエスト単位・セッション結合の値を必ず送り、callback で厳密検証する。
- **`redirect_uri`**: IdP・RP 双方で**完全一致（exact match）**のホワイトリスト検証を行う。ワイルドカードや前方一致は避ける。

#### 実世界の具体例: Jenkins GitHub Auth Plugin（CVE-2019-10315, 2019年4月）

「`state` 未実装 → linking CSRF → 管理者権限 ATO」の教科書的な実例が CVE-2019-10315 である。Jenkins の GitHub OAuth プラグインが `state` を一切使っていなかったため、攻撃者は自分の GitHub での OAuth フローをリダイレクト直前まで進め、その認可 URL を Jenkins 管理者に送りつけた。管理者がクリックすると、**管理者の Jenkins セッションに攻撃者の GitHub アカウントが紐付き**、攻撃者は自分の GitHub 認証情報で Jenkins にログインして管理者権限を得た。上記「account linking CSRF」の理屈がそのまま権限昇格に直結した事例として、修正状況（当該バージョンで `state` 検証を導入）とともに覚えておくとよい。

> 出典: Hacking your first OAuth on the Web application: Account takeover using Redirect and State parameter — TECNO Security (Medium) — https://medium.com/@security.tecno/hacking-your-first-oauth-on-the-web-application-account-takeover-using-redirect-and-state-5e857c7b1d43 （本文は403のため未取得。要旨は検索結果および一般知識で補足。CVE-2019-10315 は補足として付記）

### 資料2: `state` があっても刺さる——静的・予測可能・非結合な `state`（Snyk Labs part 2）

資料1が「`state` の欠落」を扱うのに対し、Snyk Labs のこの記事は一歩踏み込み、「`state` は存在するのに実装が甘くて刺さる」パターンを CVE つきで解剖している。教科書としての価値が高いのはこちらで、`state` を「ただ付ければよい」と誤解しないための必読事項である。

#### `state` が満たすべき3条件

記事の骨子は明快で、RFC 6749 が要求する「推測不能な値」を実装として成立させるには、`state` は次の**3条件すべて**を満たさねばならない、というものである。1つでも欠けると CSRF/ATO が成立する。

1. **Present（存在し検証される）**: `state` が送られ、callback で確かに検証される。
2. **Unpredictable（予測不能）**: リクエストごとに真のエントロピー（毎回異なる乱数）を含む。
3. **Session-bound（セッション結合）**: フローを開始した当のブラウザセッションに紐付けて検証される。

以下の各 CVE は、この3条件のどれかが破れている典型例である。

#### 予測可能な `state`: CVE-2025-68481 (fastapi-users)

`fastapi-users` ライブラリは `state` を JWT（JSON Web Token）で生成していたが、その中身が「ハードコードされた audience クレームと有効期限のみ」で、ユーザー固有・セッション固有の乱数を一切含んでいなかった。

```python
STATE_TOKEN_AUDIENCE = "fastapi-users:oauth-state"  # ← 固定値
state_data: dict[str, str] = {}                     # ← 空。乱数もセッション情報もなし
state = generate_state_token(state_data, state_secret)
```

callback 側の検証は「JWT の署名整合性と有効期限」しか見ておらず、`state` を**開始したブラウザセッションと突き合わせていなかった**（＝条件3の欠落）。しかも中身が実質固定のため、あるユーザー向けに正しく発行された `state` を攻撃者が横取りし、別の被害者に使い回せた（＝条件2の欠落）。JWT は「約1時間、誰に対しても有効」だったため、攻撃者は次のように login CSRF を成立させられた。

```
攻撃機構:
1. 攻撃者がOAuthフローを開始し、正当な state トークンを入手。
2. 攻撃者が自分の資格情報でIdP認証を完了し、attacker_code を得る。
3. 被害者に callback?code=<attacker_code>&state=<captured_state> を開かせる。
4. state のJWTが（ユーザー非依存で）有効なため検証を通過し、
   被害者は攻撃者アカウントでログインさせられる（login CSRF）。
```

**なぜ JWT なのに危険なのか**が要点。JWT は「改ざんされていないこと」は保証するが、「このブラウザが今回のフローで自分で生成した値であること」は保証しない。中身に per-request 乱数を入れ、かつ callback 時に自セッション保存値と照合しない限り、署名の正しい JWT は「誰でも作れる正規の通行証」に堕する。

#### セッション非結合・乱数なし: AI ワークスペースの事例

別の実サービス（記事では AI ワークスペース製品）では、`state` に乱数もセッション相関も無く、リダイレクト先とユーザー参照を JSON で詰めただけだった。

```javascript
state: JSON.stringify({
  redirect: redirectPath,
  user: userRef,
})
```

サーバ側の追跡もセッション結合も無いため、攻撃者は次の手順で被害者を攻撃者アカウントにログインさせられた。

```
1. 攻撃者が /auth/start/<provider> を開始し、認可URLを取得。
2. 攻撃者が自分のプロバイダアカウントでOAuthを完走。
3. 被害者を /auth/callback/<provider>?code=<attacker_code>&state=<attacker_state> へ誘導。
4. セッション検証が無いため、被害者は攻撃者アカウントでログイン状態になる。
```

##### エスカレーション: Cookie Tossing との連鎖

記事はさらに、この linking CSRF を「保存型 XSS ＋ Cookie Tossing」と連鎖させて秘密情報を窃取する高度化を示している。対象アプリの Cookie が `__Host-` プレフィックスを使っていなかったため、攻撃者は path 属性を限定した Cookie を注入できた。

```javascript
document.cookie='_access_cookie=<ATTACKER_SESSION>;
path=/api/mcp-server/new; samesite=lax';
```

**Cookie Tossing の原理**: `__Host-` プレフィックス付き Cookie は「Secure・path=/・Domain 指定なし」が強制され、サブドメインや path を絞った上書きができない。プレフィックスが無いと、攻撃者は `path=/api/mcp-server/new` のように**特定パスにだけ効く Cookie** を後から差し込める。ブラウザは同名 Cookie が複数あるとき、より具体的な path のものを優先して送るため、被害者が該当パス（`/api/ai-provider/new` など）へリクエストするときだけ**攻撃者のセッションが使われ**、被害者は通常のブラウジングを続けたまま、そこで作られる秘密情報が攻撃者アカウントへ流れ込む。CSRF/CORS 章で扱ってきた「Cookie の送出制御」と「プレフィックス Cookie」の知識が、OAuth の文脈でそのまま防御の要になる好例である。

#### 交換可能な `state`: CVE-2025-68158 (Authlib)

`Authlib` では、`state` の検証をキャッシュ（外部ストア）で行う際に**セッション文脈を無視**していた。

```python
def get_state_data(self, session, state):
    key = f"_state_{self.name}_{state}"
    if self.cache:
        value = self._get_cache_data(key)  # session引数を無視してstate値だけで引く
```

トークン認可時の検証も、どのセッションが `state` を提示したかに関係なく成功した。

```python
data = self.framework.get_state_data(session, state)
# どのセッションが state を提示しても成功してしまう
token = self.fetch_access_token(**params)
```

結果、「有効な `state` を持つ攻撃者なら誰でも交換を完了できる」状態となり、キャッシュ由来ストレージを使うアプリで login CSRF が成立した（＝条件3の欠落）。修正は「外部キャッシュを使う場合でも `state` をユーザーセッションに保存し、開始セッションへ結合する」ことを必須化した。**教訓**: `state` の保存先が外部キャッシュ（Redis 等）でも、キーに `state` 値だけを使うと「グローバルに引ける通行証」になる。必ずセッション ID を鍵に混ぜるか、セッション側にも同じ値を持たせて突合する。

#### カスタム/クロスデバイスフローの罠: CLI SSO

ブラウザとターミナルをまたぐ CLI ログイン（SSO）では、そもそもブラウザセッションへの結合が構造的に難しく、`state` 検証が形骸化しやすい。記事の例では次の流れだった。

```
1. ターミナルがリンクを出力:
   /sso/key/generate?source=cli&key=sk-[user_key]
2. サーバが state を生成: "…-session-token:<key>"（エントロピーなし）
3. ユーザーがブラウザでリンクを開きOAuth完走
4. プロバイダのcallback /sso/callback は state が接頭辞で始まるかだけ確認
   （issuer検証もしない）
5. callbackハンドラが認証済みセッションをキャッシュに保存（攻撃者供給のkeyで）
6. ターミナルが /sso/cli/poll/sk-... をポーリングしてJWTを取得
```

`/sso/key/generate` が**ブラウザではなくターミナル由来**のため、そもそもブラウザセッションと結合できない。攻撃者はフィッシングやポップアップで被害者に `/sso/key/generate?key=sk-ATTACKER&...`（攻撃者の key）を叩かせ、被害者が OAuth を完走したあと、攻撃者は自分の key でポーリングエンドポイントから**被害者の JWT を回収**できた。クロスデバイスフロー特有の「開始点と完了点が別デバイス」という性質が、CSRF 対策の前提（同一ブラウザ内の往復）を崩している点が本質である。

#### 防御——多層防御と正しい `state` 実装

記事は「以下は緩和策であって、正しい `state` 実装の代替ではない」と明確に釘を刺したうえで、多層防御を挙げている。

**1. CSP `frame-ancestors`**（iframe 経由のサイレント CSRF を封じる）

```
Content-Security-Policy: frame-ancestors 'none';
Content-Security-Policy: frame-ancestors 'self' https://trusted.example;
```

**2. CHIPS（Cookie Partitioning）**（第三者 Cookie をトップレベルサイト単位で分離し、無関係サイト間の再利用を防ぐ。`Secure`・`SameSite=None` が必須）

```
Set-Cookie: __Host-example=value; SameSite=None; Secure;
Path=/; Partitioned;
```

**3. SameSite Cookie**（「SameSite は助けになるが完全な CSRF 対策ではない。特にトップレベルナビゲーションでは不十分」と記事は注意している）

そして、正しい `state` 実装の要件は次の通り。

```
標準フロー:
- 認可開始時にランダムな state クレームを Cookie に保存する
- 同じランダム値を state パラメータ（またはstate JWT）にも埋める
- callback で「Cookie保存値」と「戻ってきたstate値」を
  定数時間比較（constant-time comparison）で一致検証する
  （定数時間比較 = 比較にかかる時間が値の内容で変わらない実装。
    タイミング差からの推測を防ぐ）

クロスデバイスフロー（CLI/TV等）:
- prompt=consent で毎回新規の同意を強制する
- ターミナル/デバイスに表示したランダムコードの確認ステップを設ける
- トークン発行前に、そのコードをユーザーがブラウザで手入力させる
```

記事の締めくくり（要旨）は「このような重要コンポーネントのミスは高インパクトの脆弱性に直結する。正しい `state` 実装は交渉の余地なく必須である」。

> 出典: 1 Click, Zero Permission: How a Small OAuth Mistake Leads to Total Account Takeover part 2 — Snyk Labs — https://labs.snyk.io/resources/OAuth-mistake-takeover-part-two/

### まとめ——攻撃フローの整理と防御チェックリスト

2つの資料を通じて、OAuth における CSRF/ATO は次の2方向に大別できる。

- **攻撃者 code を被害者に使わせる（login / account linking CSRF）**: `state` の欠落（資料1）、または `state` はあるが予測可能・非結合（資料2の各 CVE）で成立。結果、攻撃者アイデンティティが被害者アカウントに紐付き、攻撃者が被害者アカウントに入れる。
- **被害者 code を攻撃者が奪う（code 窃取）**: `redirect_uri` の緩い検証（資料1）で成立。奪った code をトークン交換して被害者になりすます。

RP 実装者向けの最終チェックリスト。

- `state` を**必ず送る**。値はリクエスト単位の暗号論的乱数（条件2）。
- `state` を**開始ブラウザセッションに結合**して保存し、callback で照合（条件3）。外部キャッシュを使う場合もキーにセッションを混ぜる。
- 照合は**定数時間比較**で行い、不一致・欠落なら即フロー中断（条件1）。
- `state` を JWT で運ぶ場合も、中身に per-request 乱数を入れる。署名検証だけで満足しない。
- `redirect_uri` は IdP・RP 双方で**完全一致ホワイトリスト**。ワイルドカード・前方一致・サブドメイン許容は避ける。
- Cookie は `__Host-` プレフィックス＋`Secure` で Cookie Tossing を封じる。`frame-ancestors` で iframe CSRF を封じる。SameSite は補助に留め、`state` の代替にしない。
- クロスデバイス（CLI/TV）フローでは `prompt=consent` と手入力コード確認で、構造的に欠けるブラウザ結合を補う。

これらはいずれも「リクエストの出所を検証する」という CSRF 防御の原則を OAuth の各所に適用したものである。`state` を「ただ付ける」のではなく「存在・予測不能・セッション結合」の3条件で実装することが、OAuth を CSRF による ATO から守る核心である。
