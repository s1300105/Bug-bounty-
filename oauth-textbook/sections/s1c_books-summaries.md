## 書籍とペンテスター向けまとめ・日本語の脆弱性概観

OAuth 2.0 / OpenID Connect（OIDC）の「フローとロール」を理解したところで、本節では実務者向けの一次情報を4本たどり、①ペンテスターが実際にチェックする観点、②実装者向けの体系的な教科書2冊が扱う範囲、③日本語で読める脆弱性解説記事の具体例、という3つの角度から知識を補強する。原理（なぜその欠陥が起きるのか）を中心に説明し、単なる用語紹介では終わらせない。

### 1. The Hacker Recipes「OAuth 2.0」— ペンテスターの実務チェックリスト

The Hacker Recipes はペンテスター・バグバウンティハンター向けに攻撃手法を簡潔にまとめたナレッジベースで、OAuth 2.0 のページでは代表的な弱点が凝縮されている。

#### redirect_uri（リダイレクトURI）の検証不備

認可サーバー（Authorization Server, AS）は、クライアントが `redirect_uri` パラメータで指定した値を、事前登録済みの値と照合する。この照合が「前方一致」や「同一ドメインならOK」といった緩いロジックで実装されていると、攻撃者は以下のような細工済みURLをクライアントに使わせることができる。

```
https://as.example.com/authorize
  ?response_type=code
  &client_id=victim-client
  &redirect_uri=https://app.example.com.attacker.com/callback
  &scope=openid%20profile
  &state=xxxx
```

**なぜ危険か**: 認可コード（authorization code）や、Implicit Grant の場合はアクセストークンそのものが、この `redirect_uri` 宛てに送り返される。検証がドメインのサフィックス一致や部分文字列一致で行われていると、`app.example.com.attacker.com` のような「見た目は正規ドメインを含むが実際は攻撃者ドメイン」を通してしまい、コードやトークンが攻撃者サーバーへ届く。対策は**完全一致（exact match）による事前登録済みURIとの照合**であり、ワイルドカードやパス以下の自由入力を許可しないことが RFC 6749 のベストプラクティスとしても推奨されている。

#### Referer ヘッダ経由の情報漏洩

認可レスポンス（特にクエリ文字列やフラグメントに認可コード・`state`・アクセストークンを含む形式）を受け取ったページが、その後に外部リソース（画像、iframe、サードパーティスクリプトなど）を読み込むと、ブラウザは遷移元URL全体（クエリ文字列を含む）を `Referer` ヘッダとして送出してしまうことがある。

**なぜ危険か**: `Referer` ヘッダはブラウザが自動生成するため、開発者が意識しないと機密パラメータが漏れる。攻撃者が用意した広告タグや解析タグを埋め込んだページであれば、閲覧しただけでコードやトークンを収集される。対策は `Referrer-Policy: no-referrer` や `strict-origin-when-cross-origin` の設定、および認可コードを受け取った直後にURLを書き換えて（`history.replaceState` 等）機密情報をURLに残さないことである。

#### 認可コードインジェクション（Authorization Code Injection）

攻撃者が何らかの経路（フィッシング、ログ漏洩、Referer漏洩など）で被害者に発行された認可コードを入手し、それを**自分のセッション**でクライアントのコールバックURLに投げ込むことで、被害者のアカウントに攻撃者自身をログインさせる、あるいは被害者のリソースを攻撃者のクライアントアカウントに紐付けてしまう攻撃である。

**なぜ防げるか（PKCEとnonce）**: この攻撃が成立しない条件として、The Hacker Recipes は PKCE（Proof Key for Code Exchange, RFC 7636）の `code_challenge` 利用と、OpenID Connect の `nonce` 利用を挙げている。PKCE では、認可リクエストを開始したクライアントだけが知っているランダム値 `code_verifier` から `code_challenge` を計算して認可リクエストに含め、トークン交換時に元の `code_verifier` を提示させる。

```
code_verifier  = 高エントロピーなランダム文字列（43〜128文字）
code_challenge = BASE64URL( SHA256(code_verifier) )

# 認可リクエスト
GET /authorize?response_type=code&client_id=...
    &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
    &code_challenge_method=S256

# トークンリクエスト
POST /token
  grant_type=authorization_code
  &code=SplxlOBeZQQYbYS6WxSbIA
  &code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

**仕組みレベルでの理由**: 攻撃者は認可コードを盗めても、そのコードに紐づく `code_challenge` を作った元の `code_verifier` を知らない。AS はトークン交換時に `SHA256(code_verifier)` を再計算し、認可リクエスト時に受け取った `code_challenge` と一致するか検証するため、`code_verifier` を持たない攻撃者はコードを引き換えられない。同様に OIDC の `nonce` は ID トークン内に埋め込まれ、クライアントが自分が発行した値と照合することでリプレイやコード注入で得た他人のIDトークンを再利用されるのを防ぐ。

#### CSRF（state パラメータ未使用）

認可リクエストに `state` パラメータが含まれない、またはクライアント側でコールバック時に検証していない場合、攻撃者は自分のアカウントに対する認可フローを開始し、途中で生成された認可コードを被害者のブラウザに踏ませることで、**被害者のアカウントに攻撃者の外部アカウントを連携させる**（アカウント統合CSRF、いわゆる Login CSRF）を成立させられる。対策は、認可リクエスト開始時にサーバー側セッションに紐づくランダム値を `state` に設定し、コールバック時に一致を検証することである。

> 出典: The Hacker Recipes「OAuth 2.0」— https://www.thehacker.recipes/web/config/identity-and-access-management/oauth-2.0

### 2. 書籍『OAuth 2 in Action』（Justin Richer & Antonio Sanso, Manning, 2017）

> ⚠️ **未取得の資料**: 本書は書籍販売ページのみが取得対象であり、本文（実装コード・詳細な脆弱性解説）そのものはWeb上に公開されていないため、目次・概要レベルの情報のみ取得できました。詳細な実装例や脆弱性の技術的深掘りをご覧になりたい場合は、以下のURLから書籍を直接ご確認ください: https://www.manning.com/books/oauth-2-in-action

（以下は取得できた書籍紹介ページの情報と、著者陣の他の公開資料・IETF活動歴に基づく一般知識を組み合わせた補足です）

著者の Justin Richer は OAuth 2.0 関連の複数のRFC（トークン内省 RFC 7662 など）の編者を務めた人物であり、Antonio Sanso はセキュリティリサーチャーとして OAuth/OIDC の実装脆弱性を多数報告してきた。本書はペンテスト本ではなく**実装者向けの教科書**である点が特徴で、以下の3つの立場からOAuthを説明する構成になっている。

- **クライアント（Client）の実装**: 認可コードグラントの一連のリクエスト/レスポンスをゼロから実装し、なぜ各パラメータ（`redirect_uri`, `state`, `scope` など）が必要かをプロトコルの生成過程から解説する。
- **認可サーバー（Authorization Server）の実装**: トークン発行、有効期限管理、リフレッシュトークンのローテーション、クライアント登録（動的クライアント登録 RFC 7591）を扱う。
- **リソースサーバー（Resource Server）の実装**: Bearer トークンの検証方法（自己完結型JWTか、AS への内省リクエストか）、スコープに基づく認可判定。

さらに JOSE（JSON Object Signing and Encryption： JWT/JWS/JWE の基盤仕様群）、トークン内省（Token Introspection）、トークン失効（Revocation）、UMA（User-Managed Access）といった周辺仕様も扱っており、**「フローを知っている」段階から「なぜそのフローでなければ安全にならないのか」を実装者の視点で理解する**橋渡しになる一冊である。ペンテスターにとっても、AS/RS側の実装がどこで手を抜きやすいか（例: JWT検証で `alg: none` を許容してしまう、`aud` クレームを検証しないなど）を先回りして知るために有用な参考書として位置づけられる。

> 出典: 書籍『OAuth 2 in Action』紹介ページ — https://www.manning.com/books/oauth-2-in-action

### 3. 書籍『OpenID Connect in Action』（Prabath Siriwardena）

Goodreads の書籍ページから取得できた情報によると、著者の Prabath Siriwardena はID・アクセス管理（IAM）分野で10年以上の実務経験を持つ技術者であり、本書は「OAuth 2.0を基盤とした認証レイヤーである OpenID Connect を用いて、アプリケーションへの安全なアクセスを実現するための実践ガイド」と位置づけられている。

本書がカバーする実装領域は幅広く、以下のような多様なクライアント種別ごとにOIDCの適用方法を扱っている。

- サーバーサイドWebアプリケーション（Authorization Code Flow が基本）
- シングルページアプリケーション（SPA） — Implicit Flow は非推奨化が進み、PKCE付き Authorization Code Flow への移行が業界標準になっている（後述の「なぜ危険か」を参照）
- ネイティブモバイルアプリケーション（PKCE必須、カスタムURIスキームやApp Linksによるリダイレクト処理）
- API（Bearer トークンによるリソース保護）
- スマートTVなど入力手段が制限されるデバイス（Device Authorization Grant, RFC 8628）

本書のスタンスは「ログインセキュリティは複雑な問題だが、OpenID Connectで簡潔に解決できる」というものであり、OAuth 2.0が本来「認可（Authorization）」のためのプロトコルであって「認証（Authentication）」の仕組みを持たないという設計上の限界（OAuthのアクセストークンだけでは「誰が」ログインしたかを保証できない）を、IDトークン（署名付きJWT、`iss`/`sub`/`aud`/`nonce`/`exp` などのクレームを持つ）で補完する、という OIDC の存在意義を理解する上で重要な一冊である。読者は Java / JavaScript の実装例を通じて学ぶ設計になっている。

> 出典: 書籍『OpenID Connect in Action』紹介ページ（Goodreads） — https://www.goodreads.com/book/show/59365339-openid-connect-in-action

### 4. atmarkit「図解：OAuth 2.0に潜む『5つの脆弱性』と解決法」（2017年10月掲載、日本語）

この記事は「OAuth Dance」（認可フローの一連のやり取り）の観点から複数ページに分けて脆弱性を解説しており、日本語で読める実践的なリファレンスとして貴重である。掲載から日数が経っている（2017年）ため、記事内で「解決法」として紹介されている仕様（特にPKCE）は現在では**必須実装として業界標準化が進んでいる**点に注意して読む必要がある。

#### CSRF攻撃（Cross-Site Request Forgery）

**仕組み**: 攻撃者が被害者のセッションを悪用し、Protected Resource（保護されたリソース）へのアクセス権限を攻撃者のアカウントに付与させる不正な認可を成立させる。

**具体例**: CSRF対策のないブログサービスで、攻撃者が細工したURL（自分のクライアントIDを埋め込んだ認可リクエストURL）を被害者に送りつける。被害者がクリックすると、被害者のログインセッションを使って認可が進み、結果として攻撃者が保存していたプライベート画像や記事へのアクセス権が、被害者の意図しない形で付与されてしまう。

**対策**: `state` パラメータを使用する。クライアントは認可リクエスト発行時にセッションに紐づくランダムな `state` 値を生成してリクエストに含め、認可レスポンスで返ってきた `state` が同じ値であることを確認する。これにより、攻撃者が自分で開始した認可フローの結果（レスポンス）を被害者のセッションに横流ししようとしても、`state` の不一致で検出できる。

#### Token Replace Attack（トークン差し替え攻撃）

**仕組み**: Implicit Grant Flow（暗黙的グラント）ではアクセストークンが認可レスポンスのURLフラグメントに直接含まれてクライアントのフロントエンドに返る。攻撃者は自分自身のアクセストークンを取得したうえで、それを標的のクライアントのバックエンドに送りつけ、「バックエンドがそのトークンを別のユーザーのものとして扱ってしまう」ことを悪用し、異なるユーザーとしてログインさせる。

**具体例**: SNSのプロフィール更新サービスで、攻撃者が自分のアクセストークンを正規ユーザーへのなりすましに使う細工をしたリクエストをバックエンドに送信し、本来の紐付け処理（トークン→ユーザーIDの対応）の検証不備を突いて被害者としてログインする。

**なぜ起きるか（原理）**: Implicit Grant はブラウザ経由でトークンをやり取りするため、バックエンドが「このトークンは本当にこのクライアント・このユーザーセッション向けに発行されたものか」を検証する手段が薄くなりがちである。トークン自体にはBearerトークンとしての性質しかなく、**誰がそれを提示したか**をトークン単体では保証しない。

**対策**: Authorization Code Flow を使用し、トークンの受け渡しをバックエンド間の直接通信（TLSで保護されたサーバー間通信）に限定する。加えて、受け取ったアクセストークンが本当に想定するクライアント向けに発行されたものかを検証する仕組み（トークン内省エンドポイントでの `client_id`/`aud` 確認等）を設ける。

#### Covert Redirect（隠蔽リダイレクト）

**仕組み**: Implicit Grant Flow では認可レスポンスがURLの**フラグメント識別子**（`#access_token=...`）にトークンを含む形で返る。攻撃者が正規に見えるが実際には悪意のドメインを指す `redirect_uri` を仕込むと、ブラウザはそのドメインへリダイレクトし、URLフラグメントに含まれるアクセストークンがそのまま攻撃者のサーバー（あるいは攻撃者が読み取れるJavaScript）に渡ってしまう。

**対策**: クライアント側で不正なURLへのリダイレクトを許可しないこと、認可サーバー側で `redirect_uri` パラメータを事前登録値と厳密にチェックすること、加えてトークンをURLフラグメントに残さないようクライアント側で速やかに削除する処理を入れることが挙げられている。

#### Authorization Code Interception Attack（認可コード横取り攻撃）とPKCE

**仕組み**: ネイティブモバイルアプリのような、カスタムURIスキーム（例: `myapp://callback`）でリダイレクトを受け取る環境では、OS上で複数のアプリが同じURIスキームを登録できてしまう場合がある。悪意のあるアプリが正規アプリと同じリダイレクトURIスキームを登録していると、正規アプリ宛てに発行されたはずの認可コードを悪意のあるアプリが横取りし、トークンと交換できてしまう。

**対策（原理レベル）**: 記事では「RFC 7636（PKCE）により、認可リクエストとトークンリクエストに新しいパラメータ（`code_challenge` / `code_verifier`）を追加し、同一クライアントのみがトークン取得を可能にする検証を行う」ことが解決策として紹介されている。前述の The Hacker Recipes の解説と同じ仕組みで、コードを横取りしても `code_verifier` を持たない別アプリはトークンに交換できない。**2017年当時はモバイルアプリ向けの追加対策として紹介されていたが、現在ではモバイル・SPAを問わずAuthorization Code Flowを使う全クライアントにPKCEの利用が推奨（OAuth 2.0 Security Best Current Practiceでは事実上必須）されている**点は、記事の年代を踏まえて補足しておく。

> 出典: atmarkit「図解：OAuth 2.0に潜む『5つの脆弱性』と解決法」— https://atmarkit.itmedia.co.jp/ait/articles/1710/24/news011.html

### まとめ

4本の資料を横断すると、OAuth 2.0/OIDCの脆弱性は大きく「①トークン・コードの宛先を誰が制御できるか（`redirect_uri`検証、Referer漏洩、Covert Redirect）」「②フローの開始者と完了者が同一であることをどう保証するか（`state`によるCSRF対策、PKCEによるコード横取り対策）」「③トークン自体が正しい相手・正しいクライアント向けであることをどう検証するか（Token Replace Attack、`aud`/`nonce`検証）」という3つの原理的な観点に整理できる。実装者向けの2冊（`OAuth 2 in Action` / `OpenID Connect in Action`）は、この3つを仕様の内側から解説し、ペンテスター向けのThe Hacker Recipesとatmarkit記事は攻撃者の視点から同じ原理を突く手口を示している。次章以降では、これらの原理を個別の攻撃シナリオとしてより深く掘り下げる。
