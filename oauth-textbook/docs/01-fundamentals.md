# 第1章 基礎理解 — OAuth 2.0 / OpenID Connect のフローとロール

## OAuth 2.0 の全体像（Aaron Parecki と oauth.net）

OAuth 2.0 を脆弱性診断・バグバウンティの視点から理解するには、まず「プロトコルが本来どう動くべきか」を正確に押さえる必要がある。攻撃者はこの「本来の設計」からの逸脱――パラメータの検証漏れ、状態管理の不備、フローの取り違え――を突く。本節では、OAuth 2.0 の生みの親の一人である Aaron Parecki の資料群（oauth.com、oauth-2-simplified）と、公式ハブサイト oauth.net の内容をもとに、ロール・グラントタイプ・各エンドポイントのパラメータを整理する。以降の章（PKCE、redirect_uri検証、state/CSRF、トークン漏洩、OIDC固有の脆弱性など）はすべてここで定義する語彙と仕組みの理解を前提とする。

### OAuth 2.0 とは何か、何ではないか

oauth.net は OAuth 2.0 を次のように位置づける。

> 出典: OAuth 2.0 — https://oauth.net/2/

OAuth 2.0 は「the industry-standard protocol for authorization」、つまり**認可**（何をしてよいかを許可する）のための業界標準プロトコルであり、**認証**（誰であるかを確認する）のプロトコルではない。この区別は極めて重要である。OAuth 2.0 単体には「ユーザーが誰であるか」を示す標準的な仕組みがなく、アクセストークンを持っていることは「あるスコープの操作を許可された」ことしか意味しない。にもかかわらず、多くの実装が「ソーシャルログイン」としてアクセストークンやAPI呼び出し結果（例: `/userinfo` 相当のエンドポイント）を認証代わりに流用してきた歴史があり、これが後述する「OAuthを認証に誤用する」系の脆弱性（第2章以降で扱う）の根本原因になっている。この認証層のギャップを標準化したのが OpenID Connect（OIDC）であり、oauth.net は「Protocols Built on OAuth 2.0」のセクションで OIDC を OAuth 上に構築された代表的プロトコルとして紹介している。OIDC は ID トークン（JWT）という認証専用の成果物を追加することで、この曖昧さを解消する設計になっている（OIDC の詳細は後続の章で扱う）。

### 4つのロール

Aaron Parecki の「OAuth 2 Simplified」は、OAuth 2.0 のエコシステムを4つの主体（ロール）で説明する。

> 出典: OAuth 2 Simplified — https://aaronparecki.com/oauth-2-simplified/

1. **クライアント（The Third-Party Application）** ― 「ユーザーのアカウントにアクセスするために許可を必要とするアプリケーション」。診断対象になることが最も多いのはこのロールで、Webサーバーアプリ、SPA、モバイルアプリ、CLIツールなどが該当する。
2. **リソースオーナー（The User）** ― 「自分のアカウントの一部へのアクセスを付与する人」。同意画面（consent screen）で「はい、許可する」を押す当事者。
3. **認可サーバー（Authorization Server）** ― 「ユーザーがリクエストを承認または拒否するインターフェースを提示するサーバー」。認可コードやアクセストークンを発行する中枢。Google, GitHub, Auth0, Okta などのIdP（Identity Provider）がこれにあたる。
4. **リソースサーバー（The API）** ― 「ユーザーの情報にアクセスするために使用されるAPIサーバー」。アクセストークンを検証し、実際のデータ（プロフィール、ファイル、決済情報など）を返すエンドポイント。

診断者としてこの4分割を意識する理由は、**信頼境界がロールの間にある**ためである。たとえばクライアントは「認可サーバーが返したredirect先」を信頼してよいが、「認可サーバーになりすました第三者からの応答」を信頼してはならない。攻撃はほぼ例外なく、この境界のどこか（クライアント⇔認可サーバー間の通信、ブラウザ⇔クライアント間のリダイレクト、リソースサーバーでのトークン検証など）を狙う。oauth.com はこれを「Separation of Roles（役割分離）」として明示的に強調しており、各ロールの責務が混在した実装（例: クライアントが認可サーバーの検証ロジックを一部代行してしまう）がバグの温床になりやすいと位置づけている。

> 出典: oauth.com（OAuth 2.0 Simplified Web版） — https://www.oauth.com/

### グラントタイプ（認可フロー）の全体像

OAuth 2.0 は「クライアントの種類」と「利用シナリオ」に応じて複数のグラントタイプ（フロー）を用意している。oauth.net はこれらを次のように整理している。

> 出典: OAuth 2.0 — https://oauth.net/2/

- **認可コードフロー（Authorization Code Grant）** ― Webアプリケーション向けの標準フロー。
- **PKCE（Proof Key for Code Exchange）** ― 本来モバイルアプリ向けの拡張だったが、現在はSPAを含むすべてのパブリッククライアント、さらに機密クライアントにも推奨される。
- **クライアント認証情報フロー（Client Credentials Grant）** ― サーバー間通信（ユーザーが介在しない場面）向け。
- **デバイスコードフロー（Device Authorization Grant）** ― キーボードやブラウザを持たないデバイス（スマートTV等）向け。
- **リフレッシュトークンフロー（Refresh Token Grant）** ― 有効期限切れのアクセストークンを再発行するためのフロー。
- **Implicit Grant（レガシー）** ― トークンをリダイレクトURLのフラグメントで直接返す方式。
- **Password Grant（レガシー）** ― ユーザー名とパスワードを直接クライアントに渡す方式。

Aaron Parecki の資料はこれをクライアントの実装形態にマッピングして説明しており、非常に実践的である。

> 出典: OAuth 2 Simplified — https://aaronparecki.com/oauth-2-simplified/

| グラントタイプ | 用途 | 特徴・注意点 |
|---|---|---|
| Authorization Code | サーバーサイドWebアプリ、モバイル、SPA | 「source code of the application is not available to the public」であることを前提にした機密クライアント向けが原型だが、PKCEを組み合わせることでパブリッククライアントにも安全に拡張できる |
| Password（Resource Owner Password Credentials） | ファーストパーティアプリのみ | 「must only be used by apps created by the service itself」――サードパーティには絶対に使わせてはならない |
| Client Credentials | アプリケーション自身の認証 | ユーザーコンテキストが存在しない、バックエンド間の機械対機械通信 |
| Implicit | 廃止予定（deprecated） | 「has been superseded by using the Authorization Code grant with PKCE」――現在はほぼ全てのケースでPKCE付き認可コードフローに置き換えるべき |

**なぜ Implicit と Password が非推奨化されたのか**を仕組みレベルで理解しておくことは、後の脆弱性診断で重要になる。Implicit Grant はアクセストークンを `redirect_uri` のURLフラグメント（`#access_token=...`）に直接載せてブラウザに返す設計だった。URLフラグメントはサーバーには送信されないためログに残りにくいという利点はあったが、裏を返せば①ブラウザ履歴やリファラ経由でトークンが漏洩しうる、②トークンをコード（一度きりの引換券）を介さず直接晒すため、通信経路上の盗聴やブラウザ拡張・XSSによる奪取リスクがそのままトークン漏洩に直結する、という欠陥を抱えていた。認可コードフローでは「コード」という短命かつ一度しか使えない中間トークンを経由し、コードとアクセストークンの引き換え（token exchange）をクライアントとAuthorization Server間のバックチャネル（TLS保護されたサーバー間通信）で行うため、ブラウザ経由の露出面が大幅に減る。Password Grant についても、クライアントがユーザーの生パスワードを直接扱うこと自体が「クライアントを信頼しないと成立しない」設計であり、認可サーバーがクライアントの実装を検証する手段がないため、フィッシングや資格情報の誤用に対して構造的に脆弱である。

### 認可コードフローの詳細（Webサーバーアプリの場合）

Aaron Parecki の資料は、最も基本となる「サーバーサイドWebアプリケーションのフロー」を2段階に分けて具体的なパラメータとともに示している。

> 出典: OAuth 2 Simplified — https://aaronparecki.com/oauth-2-simplified/

**ステップ1：認可リクエスト**

```
GET /authorize?
  response_type=code
  &client_id=xxxxxxxxxx
  &redirect_uri=https://example-app.com/callback
  &scope=photos
  &state=abc123
```

- `response_type=code` ― 認可コードフローを使うことを明示するパラメータ。
- `client_id` ― 認可サーバーに事前登録されたクライアント識別子。
- `redirect_uri` ― 認可完了後にユーザーを戻す先。ここが後続章で扱う「オープンリダイレクト」「redirect_uri検証バイパス」攻撃の主戦場になる。
- `scope` ― 要求する権限範囲（例: `photos`、`email`、`offline_access` など）。
- `state` ― CSRF対策のためのランダム文字列。

ここで oauth.com/Parecki が強調している設計上の重要事実は次の一文である。

> 「The service will only redirect users to a registered URI」

つまり認可サーバーは、`redirect_uri` パラメータの値をそのまま信頼してリダイレクトするのではなく、**事前登録済みのURIと一致（あるいは許可されたパターンに合致）する場合にのみ**リダイレクトを許可しなければならない。この検証が甘い（部分一致・サブドメインワイルドカードの誤用・パス末尾のオープンな比較など）と、攻撃者は自分のドメインに認可コードを横流しさせることができる。これは第2章以降で扱う「redirect_uri検証不備によるコード窃取」の直接の原因になる設計原理である。

**ステップ2：トークン交換（Token Exchange）**

```
POST /token
  grant_type=authorization_code
  &code=xxxxxxxxxx
  &redirect_uri=https://example-app.com/callback
  &client_id=xxxxxxxxxx
  &client_secret=xxxxxxxxxx
```

このリクエストはブラウザを介さず、クライアントのサーバーから認可サーバーへ直接（バックチャネルで）送られる。`client_secret` はこの段階で初めて送信され、「must be kept confidential（機密に保たれなければならない）」とされる。ここで `redirect_uri` を再度送る理由は、認可リクエスト時に指定した値と一致することを認可サーバーに再検証させるためであり、これにより「認可コード発行時のリダイレクト先」と「トークン交換時に主張するリダイレクト先」が食い違う攻撃（コードの横取り＝認可コード注入、Authorization Code Injection）を防いでいる。この一致検証が実装から漏れているケースは実際の診断でしばしば見つかる。

**state パラメータの役割**についても、Parecki は明確に定義している。

> 「A random string generated by your application, which you'll verify later」

`state` はクライアントが生成しセッションに紐付けて保存し、認可サーバーからのコールバックで返ってきた値と一致するかを検証するためのワンタイム値である。これが実装されていない、あるいは検証されていない場合、攻撃者は自分のアカウントで発行させた認可コードを被害者のブラウザに踏ませることで、被害者のアプリセッションに攻撃者のアカウントを紐付けさせる「CSRF（OAuthログインCSRF/アカウント関連付け攻撃）」が可能になる。これは後の章で単独のテーマとして深掘りする。

### PKCE：パブリッククライアントのための拡張

SPA（シングルページアプリケーション）やモバイルアプリのように `client_secret` を安全に保持できない「パブリッククライアント」向けに、PKCE（Proof Key for Code Exchange）という拡張が使われる。Parecki の解説では次の手順が示されている。

> 出典: OAuth 2 Simplified — https://aaronparecki.com/oauth-2-simplified/

1. **コード生成**: 「Create a random string between 43-128 characters long」― これが `code_verifier`。
2. **チャレンジ生成**: `code_verifier` をSHA256でハッシュ化し、base64url エンコードしたものが `code_challenge`。
3. 認可リクエスト時に `code_challenge` と `code_challenge_method=S256` を送信し、認可サーバーはこれをコードに紐付けて保存する。
4. **トークン交換時**にクライアントは元の `code_verifier`（ハッシュ化前の文字列）を送信する。

```
# 概念的な生成手順（Node.js想定の擬似コード）
code_verifier   = random_string(43, 128)
code_challenge  = base64url(sha256(code_verifier))
```

**なぜこれで安全になるのか**という仕組みが核心である。認可コードフローの弱点は、パブリッククライアントには `client_secret` を安全に埋め込む場所がない（アプリのバイナリやJSコードをリバースエンジニアリングすれば誰でも読める）ため、認可コードを盗聴・横取りされた第三者が `client_secret` 抜きでトークン交換できてしまう点にあった。PKCEは、認可リクエスト時にしか分からない「使い捨てのハッシュ値（code_challenge）」を認可サーバーに事前登録させ、トークン交換時に「ハッシュ化前の値（code_verifier）」を提示させることで、**認可コードを発行させたのと同一のクライアントインスタンスだけがトークン交換できる**ことを保証する。攻撃者が認可コードだけを盗んでも、対応する `code_verifier`（ランダムに生成され、どこにも送信されていない値）を知らなければトークンに交換できない。これは「秘密の共有」ではなく「証明（proof）」による安全性であり、事前に共有された秘密（client_secret）が不要という点でパブリッククライアントに適している。Parecki の要約は次の通りである。

> 「利点: 認可サーバーが検証し、秘密がなくても安全に機能」

現在ではPKCEは「モバイル・SPA限定」の位置づけを超え、oauth.net が示す通り機密クライアントを含むすべての認可コードフローに追加すべきベストプラクティスとされている（OAuth 2.1では認可コードフローに対するPKCEの利用が実質必須化される方向で仕様統合が進んでいる）。

### モバイルアプリのフロー：埋め込みWebViewの危険性

モバイルアプリにおける認可には2つのパターンがあるとParecki資料は説明する。

> 出典: OAuth 2 Simplified — https://aaronparecki.com/oauth-2-simplified/

1. **ネイティブアプリの呼び出し**: `fbauth2://authorize?` のようなカスタムURIスキームで認可サーバーからアプリに制御を戻す。
2. **ウェブブラウザの利用**: 認可画面自体はOSの外部ブラウザ（Safari View Controller や Chrome Custom Tabs 等のネイティブブラウザコンポーネント）で開く。

ここで明確に禁止されている実装がある。

> 「You should never use an embedded web view（埋め込みWebViewを絶対に使うべきではない）」

**なぜ埋め込みWebViewが危険なのか。** アプリ内に組み込まれたWebView（例: Android の `WebView` や iOS の `UIWebView`/`WKWebView` をアプリ自身が制御するケース）でログイン画面を表示すると、そのアプリ自身がユーザーの入力するパスワードやCookie、セッション情報にアクセスできる、あるいは悪意あるアプリであればJavaScriptインジェクションによって認証情報を盗聴できてしまう。さらにWebViewはOSレベルのSSO（既にブラウザにログイン済みのセッションを再利用する仕組み）の恩恵を受けられず、ユーザーは毎回パスワードを再入力させられるため、フィッシング耐性も低下する。これに対し、OS標準の外部ブラウザやSFSafariViewController/Custom Tabsを使えば、認可サーバーとの通信はホストアプリから隔離され、ブラウザに保存された既存のログインセッションも利用できる。これはOAuthそのものの脆弱性というより「クライアント実装のアンチパターン」に分類されるが、実務の脆弱性診断・バグバウンティでモバイルアプリを対象にする際に頻出するチェック項目である。

### クライアント認証情報フロー（Client Credentials）とその他のグラント

`Client Credentials Grant` はユーザーが一切介在しない、アプリケーション自身の身元でAPIを呼び出すためのフローである。

> 出典: OAuth 2 Simplified — https://aaronparecki.com/oauth-2-simplified/

用途としては「アプリ自身の情報更新、統計取得など」が挙げられており、`client_secret` の送信が必須になる。ユーザーコンテキストが存在しないため、このフローで発行されたアクセストークンには本来ユーザー個人のデータへのスコープを持たせるべきではない。もし実装上の不備でこのトークンが個人データにアクセスできてしまう場合、それは「過剰スコープ付与（Excessive Scope Grant）」の問題として扱われる。

### 認可後のAPI呼び出しとBearerトークン

トークン取得後の実際のAPI呼び出しは、標準化されたヘッダー形式で行われる。

```
GET /api/resource
Authorization: Bearer <access_token>
```

> 「Make sure you always send requests over HTTPS（必ずHTTPS経由でリクエストを送ること）」

Bearer トークンは「それを提示した者が正当な保持者である」という前提（bearer = 持参人払い）で扱われる、すなわち**追加の証明を必要としない**トークン形式である（oauth.net が言及する RFC 6750 準拠）。この設計上の特性が、Bearerトークンの漏洩＝即座になりすまし成立、という重大なリスクに直結する。TLSを経由しない通信、リファラヘッダへの漏洩、ログへの記録、ブラウザ履歴への残留などは、Bearerトークンの文脈ではすべて致命的な情報漏洩経路になりうる。これに対する高度な対策として、oauth.net はDPoP（Demonstration of Proof-of-Possession、トークン保持者にリクエストごとの署名を要求することでトークンの単純な持ち出しを無効化する仕組み）やMutual TLSといった「トークンバインディング」系の仕様を紹介しているが、これらは広く普及した標準ではなく、高セキュリティ要件のシステムでの採用にとどまる。

### トークンの種別と拡張仕様

oauth.net のハブページは、OAuth 2.0 のエコシステムを支えるトークン関連の概念を整理している。

> 出典: OAuth 2.0 — https://oauth.net/2/

- **アクセストークン** ― APIアクセスに使う本体のトークン。不透明な文字列の場合とJWT形式の場合がある。
- **リフレッシュトークン** ― アクセストークンの有効期限切れ後に、ユーザーの再認可なしで新しいアクセストークンを取得するためのトークン。長寿命かつ機密性が高いため、保管・失効の設計が重要になる。
- **ベアラートークン**（前述）。
- **JWT形式のアクセストークン** ― 自己完結型（self-contained）で、リソースサーバーが認可サーバーに問い合わせずに署名検証だけでトークンの正当性とクレーム（scope, sub, exp等）を確認できる。この設計はスケーラビリティに優れる一方、失効（revocation）がリアルタイムに反映されにくいというトレードオフを持つ。

またクライアントの分類として「機密クライアント（Confidential）」と「パブリッククライアント（Public）」の区別が明示される。機密クライアントは `client_secret` を安全に保持できるサーバーサイドアプリ、パブリッククライアントはSPAやモバイルアプリ、CLIツールのように秘密を安全に保持できない実行環境で動くアプリを指す。この分類こそが「どのグラントタイプ・どの追加保護（PKCE等）を使うべきか」を決定する最も基本的な設計判断であり、診断者がまず確認すべき観点でもある。

### プッシュ型認可リクエスト（PAR）など発展的仕様

oauth.net は、より高いセキュリティが要求される場面向けの拡張仕様として次を挙げている。

> 出典: OAuth 2.0 — https://oauth.net/2/

- **PAR（Pushed Authorization Requests）** ― 認可リクエストのパラメータをブラウザのURLに直接載せず、事前にクライアントから認可サーバーへバックチャネルでプッシュしておく仕組み。URLパラメータの改ざんや、フロントチャネル経由でのパラメータ漏洩・注入を防ぐ。
- **DPoP** ― 前述の通り、Bearerトークンを「所持証明（proof-of-possession）」型に強化する。
- **Mutual TLS（mTLS）** ― クライアント証明書によるクライアント認証・トークンバインディング。
- **Private Key JWT** ― `client_secret` の代わりに秘密鍵で署名したJWTでクライアント認証を行う方式。

これらはいずれも「フロントチャネル（ブラウザ経由）でのパラメータやトークンの露出面をできる限り減らす」という一貫した設計思想の延長線上にある。

### OAuth 2.1 への統合の動き

oauth.net は次のように述べている。

> 「OAuth 2.1は、OAuth 2.0と一般的な拡張仕様を統合することを目指す（to consolidate OAuth 2.0 and many common extensions）」

2026年時点で、OAuth 2.1はドラフト仕様として、Implicit GrantとPassword Grantの廃止、認可コードフローへのPKCE利用の必須化、`redirect_uri` の完全一致（exact match）検証の必須化など、これまで「ベストプラクティス」として個別のセキュリティ勧告（RFC 8252、RFC 6819、BCP該当文書等）に分散していた推奨事項を単一の仕様に統合する作業が進められている。本教科書で扱う脆弱性の多くは、まさにこの「2.0時代には推奨に留まっていたが2.1では必須になる」項目の不備に起因するため、対象システムがどの世代の仕様・実装慣行に基づいているかを意識することが、診断における前提の陳腐化を避ける鍵になる。

### 演習教材について

Aaron Parecki の動画講座「The Nuts and Bolts of OAuth 2.0」はUdemyで提供されており、「3.5時間以上の動画と、Webベースのツールを使ったインタラクティブな演習」を含む講座として案内されている。

> 出典: The Nuts and Bolts of OAuth 2.0（案内ページ） — https://aaronparecki.com/oauth/

この案内ページ自体には詳細なカリキュラムは明示されていないが、同著者の関連資料「OAuth Patterns and Anti-Patterns」で扱われるテーマ（OAuth用語の定義、ブラウザベースアプリのトークンセキュリティ、PKCEの活用、アクセストークンとIDトークンの違い、アクセストークン検証の手法）から、本節で解説したロール・フロー・PKCEの基礎知識をさらに実践的な演習で定着させる構成になっていると推測できる。（以下は未取得資料の補足として一般知識に基づく解説：）動画講座はハンズオン形式が中心であり、座学での「仕様の理解」を、実際にリクエストを発行してレスポンスを観察する「動作の理解」に橋渡しする教材として位置づけられる。診断者にとっても、実際にOAuthフローの正規のHTTPリクエスト・レスポンスを手を動かして観察しておくことは、後続章で扱う異常系（改ざん、パラメータ抜き取り、リプレイ）を見抜く感覚を養う上で有効である。

### 本節のまとめと次章への接続

本節では、OAuth 2.0 を「認可のプロトコルであり認証のプロトコルではない」という原則から出発し、4つのロール（クライアント・リソースオーナー・認可サーバー・リソースサーバー）、主要なグラントタイプ（認可コード、PKCE、クライアント認証情報、デバイスコード、リフレッシュトークン、非推奨のImplicit/Password）、そして認可コードフローの具体的なパラメータ（`response_type`, `client_id`, `redirect_uri`, `scope`, `state`, `code`, `client_secret`）とその設計意図を整理した。特に重要なのは以下の3点である。

1. `redirect_uri` は認可サーバー側で事前登録済みの値と厳密に照合される前提で設計されている――この検証がどこまで厳密か（完全一致かパターンマッチか）が、次章以降で扱う「オープンリダイレクト経由の認可コード窃取」の分岐点になる。
2. `state` パラメータはCSRF対策として設計されており、その欠落・検証漏れがアカウント関連付け攻撃を可能にする。
3. PKCE は「秘密の共有」ではなく「証明」によってパブリッククライアントの認可コード窃取を防ぐ仕組みであり、この原理を理解しておくことが、PKCEバイパス系の脆弱性（`code_challenge_method` のダウングレードなど）を理解する前提になる。

次章以降では、これらの正規フローからの逸脱――redirect_uri検証の不備、state/CSRF、PKCEの実装不備、トークンの漏洩経路、OpenID Connect固有のID トークン検証不備――を、それぞれ独立したテーマとして深掘りしていく。

## Playground でフローを動かし OIDC を理解する

OAuth 2.0 と OpenID Connect（OIDC）は、仕様書を読むだけではロールやトークンの受け渡しが頭の中で線としてつながりにくい。本節では、実際にブラウザから叩ける Playground（動作確認用サンドボックス環境）を使って、代表的な5つのフロー（Authorization Code, PKCE付きAuthorization Code, Implicit, Device Code, OpenID Connect）が「どのHTTPリクエストの連鎖」として実装されているかを、具体的なパラメータ付きで追う。あわせて、OpenID Foundation の公式解説と、初心者向けにOAuthの本質的な設計思想をかみ砕いた記事も参照し、「なぜこの手順でなければならないのか」を機構レベルで理解することを目指す。

### 4つのアクターと「委任」というOAuthの本質

まず前提を揃える。OAuth 2.0 は「認証(authentication：相手が誰であるかの確認)」の仕組みではなく、「認可(authorization：ある権限の委任)」の仕組みとして設計された。Frederik Banke の記事は、この点を次のように整理している。

> OAuth 2 is designed to solve one use case, which is not authentication as the name suggests, but rather the problem where a user has access to a resource and wants to allow a third party to have the same access.

具体的には、以前は「サードパーティにパスワードそのものを渡す」ことでこの問題を解決していたが、この方式には致命的な欠陥があった。パスワードを変更すると、渡していたすべてのサードパーティのアクセスが一斉に失われる（あるいは、パスワードを使い回されたまま気づかない）。OAuth 2.0 はこれを、パスワードの代わりに「範囲(scope)と有効期限が限定された引換券（トークン）」を発行する仕組みに置き換えた。

登場人物（ロール）は4つに整理される。

| ロール | 役割 |
|---|---|
| リソースオーナー (Resource Owner, RO) | データの持ち主。人間のユーザー本人 |
| クライアント (Client) | ROの代わりにリソースへアクセスしたいアプリケーション |
| リソースサーバー (Resource Server, RS) | 実際にデータを保持するAPI |
| 認可サーバー (Authorization Server, AS) | トークンを発行する、OAuthの心臓部 |

> 出典: OAuth and OpenID Connect for dummies — https://medium.com/@frederikbanke/oauth-and-openid-connect-for-dummies-ec18df6a233 （ミラー: https://www.frederikbanke.com/oauth-and-openid-connect-for-dummies/ )

この「委任」という前提を頭に入れておくと、以降の各フローで「なぜstateやnonceやPKCEが必要なのか」がすべて「委任の経路を横取りされないため」という一点に収束することが見えてくる。

### Authorization Code Flow: 最も基本の6段階

OAuth.com Playground（各フローを実際のHTTPリクエストとして体験できるサンドボックス）は、Authorization Code Flow を次のような具体的なリクエスト列として提示する。

**A段階 — 認可リクエスト（ブラウザ経由）**

ユーザーのブラウザ（ユーザーエージェント）を、次のようなURLへリダイレクトさせる。

```
https://oauthserver/authorize?client_id=...&response_type=code&scope=read
```

- `client_id`: 認可サーバーに事前登録済みのクライアント識別子。秘密情報ではなく公開されてよい値。
- `response_type=code`: 「認可コードが欲しい」という宣言。ここが `token` になると後述のImplicit Flowに切り替わる。
- `scope`: クライアントが要求する権限の範囲（例: `read`）。

**B段階 — ユーザー認証と同意**

認可サーバー側の画面でユーザーがログインし、「このアプリに`read`権限を許可しますか」という同意画面が表示される。ここで初めてユーザーの認証情報（パスワード等）が認可サーバーにのみ入力され、クライアント側のアプリはそれを一切見ない。これがOAuthの最大の利点であり、パスワード共有方式との根本的な違いである。

**C段階 — 認可コードのリダイレクト返却**

同意後、あらかじめ登録された `redirect_uri` へ、`code`パラメータを付与してリダイレクトされる。この`code`は「一度きり使える短命の引換券」であり、それ自体はアクセストークンではない。

**D段階 — バックエンドへの引き渡し**

ブラウザ経由で受け取った認可コードは、クライアントのバックエンド（サーバーサイドの機密領域。ブラウザJSからは見えない）に渡される。

**E段階 — トークンエンドポイントでの交換**

バックエンドが、認可コードと`client_secret`（クライアントだけが知る秘密情報）を使って、直接（ブラウザを経由しない、サーバー間の）POSTリクエストでトークンエンドポイントにアクセストークンを要求する。

```
https://oauthserver/token?client_id=...&client_secret=123&grant_type=authorization_code
```

**なぜコードとトークンの交換を2段階に分けるのか**: もし最初のリダイレクト（A〜C段階）でいきなりアクセストークンを返してしまうと、ブラウザ履歴・リファラヘッダ・ブラウザ拡張機能などを経由してトークンが漏洩するリスクが高い（この危険性は後述のImplicit Flowでまさに問題になる）。認可コードは「ブラウザという信頼できない経路」を通す使い捨ての中継券に過ぎず、本物のアクセストークンは「サーバー間通信という比較的安全な経路」でのみやり取りする、という設計上の分離がここに表れている。

**取得したトークンの使い方**

アクセストークンは、以降のAPIリクエストで次のようにHTTPヘッダに付与する。

```
Authorization: Bearer <access_token>
```

リソースサーバーは、このトークンが本物で有効かをどう確かめるのか。Bankeの記事では、伝統的には「イントロスペクション(introspection：トークンの中身や有効性を認可サーバーに問い合わせて確認するプロセス)」という仕組みが使われると説明されている。リソースサーバーは受け取ったトークンをそのまま信用せず、認可サーバーに「このトークンはまだ有効か、どのスコープを持つか」を都度問い合わせる。

> 出典: OAuth 2.0 Playground — https://www.oauth.com/playground/

### Authorization Code with PKCE: なぜ「証明」が追加で必要になるのか

PKCE（Proof Key for Code Exchange、「ピクシー」と読む）は、Authorization Code Flowに追加のステップを挟んだ拡張である。OAuth.com Playgroundの解説を見ると、まずクライアント側で次のような値を生成する。

> a cryptographically random string using characters A-Z, a-z, 0-9, and punctuation (-._~), between 43-128 characters long

これが `code_verifier`（検証用の秘密の乱数文字列）である。そこから次の変換で `code_challenge`（挑戦値、公開してよいハッシュ値）を導出する。

```
code_challenge = base64url(sha256(code_verifier))
```

そして認可リクエストには、生の`code_verifier`ではなく、この`code_challenge`だけを載せる。

```
response_type=code
client_id=[登録済みクライアントID]
redirect_uri=/authorization-code-with-pkce.html
scope=photo+offline_access
state=[CSRF対策のランダム文字列]
code_challenge=[上で生成した値]
code_challenge_method=S256
```

その後、認可コードをトークンに交換する段階（POSTリクエスト）で、今度は元の `code_verifier`（生の値）を一緒に送る。認可サーバー側は、受け取った`code_verifier`を同じ方法でハッシュ化し、最初に受け取っていた`code_challenge`と一致するかを検証する。Playgroundの説明を借りれば、

> the authorization server will check whether the verifier matches the challenge that was used in the authorization request

**このひと手間が防いでいる攻撃は何か**: 通常のAuthorization Code Flowでは、悪意ある別アプリ（同一デバイス上の別プロセスや、公開クライアント環境でカスタムURLスキームを横取りする悪性アプリなど）が、リダイレクト時の認可コードを横から盗み見て、正規クライアントより先にトークンエンドポイントへ送りつけてしまう「認可コード注入(authorization code injection)」が理論上可能である。PKCEがあれば、コードを盗んだ攻撃者は`code_challenge`の元になった`code_verifier`（クライアントのメモリ上にしか存在しない一時的な秘密値）を知らないため、コードを盗んでもトークンに交換できない。

もともとPKCEは、クライアントシークレットを安全に保管できないモバイルアプリやSPA（ネイティブ/公開クライアント）のために設計されたが、Playgroundの解説は次のように述べて、機密クライアント（サーバーサイドで`client_secret`を安全に持てるWebアプリ）を含む「すべてのクライアント種別」に適用すべきだとしている。

> PKCE should be used on every Authorization Code flow ... its protection against authorization code injection makes it valuable for all client types, including confidential web apps.

> 出典: Authorization Code with PKCE Flow - OAuth 2.0 Playground — https://www.oauth.com/playground/authorization-code-with-pkce.html

### Implicit Flow: なぜ非推奨(deprecated)になったのか

Implicit Flowは、Authorization Code Flowから「バックエンドでのトークン交換」の段階を省略し、認可サーバーがブラウザへのリダイレクトの中に直接アクセストークンを埋め込む方式である。`response_type=token` を指定するのがこのフローの入り口になる。

Playgroundの実演では、ユーザーが認可サーバーからクライアントへリダイレクトされてくる際、URLは次のような**フラグメント成分**（`#`以降の部分）にトークンを含む形になる。

```
https://client.example.com/callback#access_token=...&token_type=Bearer&expires_in=3600&scope=read&state=xyz
```

なぜ`?`のクエリ文字列ではなく`#`のフラグメントを使うのか。フラグメントはHTTPリクエストとしてサーバーに送信されない（ブラウザ内部だけで処理される）ため、access_tokenがWebサーバーのアクセスログに記録されてしまうことを避けられる、というのが設計意図である。しかし、Playgroundの警告文はこの方式の根本的な弱点を明確に指摘している。

> 悪意のある行為者があなたのクライアントにアクセストークンを注入することを防ぐ解決策はありません

つまり、ブラウザのURLフラグメントという経路そのものが、ブラウザ履歴・ブラウザ拡張機能・同一オリジン上で動く別スクリプト・リファラ経由の漏洩など、様々な経路でトークンを盗聴・改ざんされうる。Authorization Code Flowであれば「盗まれても交換に失敗する（PKCEがあれば特に）」という防御線を張れるが、Implicit Flowはトークンそのものが最初からブラウザに露出しているため、盗まれた時点でそれが即座に有効なアクセストークンとして使われてしまう。この構造的な脆弱性のため、OAuth 2.0 Security Best Current Practice（IETFの最新ベストプラクティス文書）ではImplicit Flowは非推奨と位置づけられており、Playgroundも「セキュリティBCPで非推奨とされている」と明記している。実務では、SPAであってもPKCE付きAuthorization Code Flowを使うことが2019年以降の標準的な推奨である。

> 出典: OAuth 2.0 Playground（Implicit Flow） — https://www.oauth.com/playground/

### Device Code Flow: 入力手段が乏しい端末のための設計

Device Code Flow（デバイス認可フロー）は、スマートTV・IoT機器・CLIツールなど、ブラウザを直接操作したりURLを入力したりするのが困難な端末向けに設計されている。Playgroundの実演は次の3段階で構成される。

**ステップ1: デバイスコードのリクエスト**

デバイス自身が、認可サーバーの専用エンドポイントにPOSTリクエストを送る。

```
POST https://example.okta.com/device
client_id=https://www.oauth.com/playground/
```

**ステップ2: ユーザーへのコード提示**

サーバーは次のような情報を返す。

- `device_code`: デバイス自身が後でポーリングに使う長い内部コード（例: `NGU5OWFiNjQ5YmQwNGY3YTdmZTEyNzQ3YzQ1YSA`）
- `user_code`: 人間が別のデバイス（スマホやPC）で入力する短いコード（例: `BDWD-HQPK`）
- `verification_uri`: ユーザーがアクセスすべきURL（例: `https://example.okta.com/device`）
- `interval`: ポーリング間隔（例: 5秒）
- `expires_in`: コードの有効期限（例: 1800秒）

デバイスはこの`user_code`と`verification_uri`を画面（あるいは音声）でユーザーに提示する。ユーザーは手元のスマホやPCのブラウザでそのURLにアクセスし、コードを入力してログイン・同意を行う。

**ステップ3: トークンエンドポイントのポーリング**

その間、デバイス自身は次のリクエストを一定間隔で送り続ける（ポーリング＝繰り返し問い合わせる）。

```
grant_type=urn:ietf:params:oauth:grant-type:device_code
&device_code=[取得したdevice_code]
```

ユーザーがまだ承認していない間は、サーバーは`authorization_pending`というエラーを返し続ける。ユーザーの承認が完了した瞬間に、同じポーリングリクエストへの応答としてアクセストークンが返される。

**なぜこの設計が必要か**: デバイス側にはブラウザもキーボードも(まともに)ないため、リダイレクトベースの認可コードフローは物理的に実行できない。そこでデバイスとユーザーの「操作する場所」を完全に分離し、デバイスは受動的にポーリングするだけ、ユーザーは使い慣れた別端末で通常のログインフローを踏む、という役割分担にしている。

> 出典: OAuth 2.0 Playground（Device Code Flow） — https://www.oauth.com/playground/

### OpenID Connect: 「認証」を後付けする仕組み

ここまでのOAuth 2.0の各フローは、あくまで「権限の委任」のためのものであり、「このユーザーが誰であるか」を保証する仕組みは含まれていない。これがしばしば誤用の原因になる（アクセストークンを持っていることを、そのまま「ログイン成功の証」として扱ってしまう設計ミス）。この隙間を埋めるために標準化されたのが OpenID Connect（OIDC）である。

Bankeの記事は次のように端的に説明する。

> OAuth 2は認証機能を提供しないため、OpenID Connectが構築された。初期リクエストに「openid」スコープを追加すると、新しいトークン「id_token」が有効になる。

つまりOIDCは、OAuth 2.0のフローに `scope=openid` を追加するだけで、認可サーバー（この文脈では OpenID Provider, OP と呼ぶ）が `access_token` に加えて `id_token` という新しい種類のトークンを発行してくれる、という「OAuth 2.0の上に薄く被せた拡張仕様」である。

#### OpenID Foundationが定義する7ステップの認証フロー

OpenID Foundation公式の解説ページは、OIDCの基本的な認証の流れを次の7ステップで説明している。

1. End user navigates to a website or web application via a browser（ユーザーがブラウザでアプリにアクセスする）
2. End user clicks sign-in and types their username and password（サインインしてID/パスワードを入力する）
3. The RP (Client) sends a request to the OpenID Provider（RPがOPにリクエストを送る）
4. The OP authenticates the User and obtains authorization（OPがユーザーを認証し、認可を得る）
5. The OP responds with an Identity Token and usually an Access Token（OPがIDトークンと、通常はアクセストークンも返す）
6. The RP can send a request with the Access Token to the User device（RPはアクセストークンを使ってリソースにリクエストできる）
7. The UserInfo Endpoint returns Claims about the End-User（UserInfoエンドポイントがユーザーに関するクレームを返す）

ここで登場する用語を整理しておく。

- **RP (Relying Party)**: 認証の結果を「頼りにする」側、つまりクライアントアプリケーション自身のOIDCにおける呼び名。OpenID Foundationの定義では「A piece of software that requests tokens either for authenticating a user or for accessing a resource」とされる。
- **OP (OpenID Provider)**: OAuth 2.0でいう認可サーバーに相当し、IDプロバイダとも呼ばれる。
- **Identity Token (id_token)**: 「an identifier for the user (called the sub aka subject claim) and information about how and when the user authenticated（ユーザーの識別子である`sub`クレームと、いつ・どうやって認証したかの情報）」を含む、認証結果そのものを表すトークン。

> 出典: How OpenID Connect Works — OpenID Foundation — https://openid.net/developers/how-connect-works/

#### id_tokenの中身: JWTとして検証可能な「認証の証明書」

id_tokenの実体はJWT（JSON Web Token: 署名付きで自己完結的にクレーム情報を運ぶトークン形式）であり、Base64URLエンコードされた3つのパートをピリオドで連結した文字列である。デコードすると次のようなクレーム（主張）が現れる。

```json
{
  "sub": "alice",
  "iss": "https://openid.c2id.com",
  "aud": "client-12345",
  "auth_time": 1311280969,
  "exp": 1311281970
}
```

- `sub` (subject): ユーザーの一意な識別子。
- `iss` (issuer): このトークンを発行したOPのURL。
- `aud` (audience): このトークンの受け取り手として想定されているクライアントID。
- `auth_time`: 実際にユーザーが認証した時刻。
- `exp` (expiration): トークンの有効期限。

**access_tokenとid_tokenの本質的な違い**: access_tokenは「このリソースにアクセスしてよい」という権限の証明書であり、中身の形式はOAuth仕様上定義されていない（不透明な文字列でもよい）。一方id_tokenは、必ずJWT形式で、かつ「誰が・いつ・どうやって認証されたか」というアイデンティティ情報そのものを運ぶ。id_tokenは署名されているため、RP（クライアント）はOPの公開鍵（JWKSエンドポイントなどで配布される）を使ってその場で署名を検証でき、Bankeの記事いわく「これにより『イントロスペクション』の必要性が減り、認可サーバーの負荷が軽減される」。access_tokenの正当性確認にはサーバーへの問い合わせ（イントロスペクション）が必要になりがちなのに対し、id_tokenは自己完結的に検証できる、という設計上の非対称性がここにある。

#### OAuth.com PlaygroundにおけるOIDCフローの実例

OAuth.com Playgroundの OpenID Connect ページでは、Authorization Code Flowとほぼ同じ骨格に、次のパラメータが加わる形で実演される。

```
response_type=code
client_id=...
redirect_uri=/oidc.html
scope=openid+profile+email+photos
state=[CSRF対策のランダム文字列]
nonce=[リプレイ攻撃対策のランダム値]
```

`scope`に`openid`を含めることが、OIDCフローを起動する唯一のスイッチである。`profile`や`email`は、UserInfoエンドポイントやid_tokenに含めてほしい追加のクレームカテゴリを要求するものであり、`openid`スコープと組み合わせて使う。

**nonce（ノンス）とは何か**: これは一度きり使われる乱数値で、認可リクエストの中に含めてOPに送る。OPはこの値をそのままid_tokenのクレームとして埋め込んで返す。RP側は、返ってきたid_token内の`nonce`が自分が最初に送った値と一致するかを検証する。これによって、攻撃者が古い認可レスポンス（あるいは他のセッション用に発行されたid_token）を横取りしてリプレイ（再送）し、なりすましログインを成立させる攻撃を防ぐ。`state`パラメータがOAuth全体でのCSRF対策（このリダイレクトが自分が開始したリクエストへの応答であることの確認）を担うのに対し、`nonce`はOIDC固有の、id_token自体の再利用を防ぐ仕組みである、という役割分担を意識するとよい。

トークンエンドポイントへの交換リクエスト自体はAuthorization Code Flowと同じ形（POST + `code` + `client_id`/`client_secret`）だが、レスポンスに`access_token`だけでなく`id_token`が追加される点が異なる。Playgroundの解説を借りれば、クライアントは最終的に「an "ID Token", which contains information about the user」を手にすることになる。

> 出典: OpenID Connect Authorization Code Flow - OAuth 2.0 Playground — https://www.oauth.com/playground/oidc.html

### ⚠️ 未取得の資料について（openidconnect.net）

> ⚠️ **未取得の資料**: 「OpenID Connect Playground」（https://www.openidconnect.net/）は自動取得できませんでした（理由: ページ本体がJavaScriptによる動的レンダリングのSPAであり、自動取得ツールでは静的HTML内にタイトルのみが確認でき、実際のフォームやフローの説明文を含む本文コンテンツを抽出できませんでした）。以下のURLからご自身で直接ご覧ください: https://www.openidconnect.net/

（以下は未取得資料の補足として一般知識に基づく解説です）openidconnect.net は、OpenID Connect の仕様策定にも関わったNat Sakimura氏らが公開している、ブラウザから直接OIDCの各フロー(Authorization Code Flow, Implicit Flow, Hybrid Flow)を試せるサンドボックスである。事前に用意されたテスト用のOP（OpenID Provider）に対して、`response_type`を`code`・`id_token token`・`code id_token`などに切り替えながら実際にリクエストを飛ばし、返ってきたid_tokenやaccess_tokenの生の値とデコード結果を画面上で確認できる点が特徴で、上記のOAuth.com Playgroundと組み合わせて使うことで、OAuth 2.0の素のフローとOIDCが上乗せする要素(id_token, nonce, UserInfoエンドポイント)の違いを、実際のHTTPトラフィックとして体感的に区別できるようになる。ただし同サイトは長期間更新が止まっている面があり、TLS証明書の期限切れや仕様の細部（例えば新しいセキュリティBCPの反映状況）が最新とは限らない点には注意し、学習目的の参照に留めるのが安全である。

### 本節のまとめ: フロー選択の指針

実務でどのフローを選ぶべきかは、クライアントの性質によってほぼ機械的に決まる。

- サーバーサイドで動く機密クライアント（`client_secret`を安全に保管できる）: Authorization Code Flow（+ PKCE推奨）
- SPA・モバイルアプリなどの公開クライアント（`client_secret`を安全に保管できない）: Authorization Code Flow + PKCE（必須）
- ブラウザもキーボードもまともにない端末: Device Code Flow
- Implicit Flow: 現在は非推奨。新規実装では使用しない
- ログイン（認証）が目的: 上記いずれかのフローに`scope=openid`を足したOIDCフロー

いずれのフローも、Playgroundで実際のHTTPリクエスト・レスポンスを自分の目で追うことで、「なぜstate/nonce/PKCEが必要なのか」「トークンがどの経路をどう流れるのか」という設計意図が、仕様書を読むだけよりもはるかに具体的に理解できるはずである。

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


---

## ナビゲーション

[← 序章](00-introduction.md)  ｜  [📚 目次（ホーム）](index.md)  ｜  [第2章 脆弱性クラスを一つずつ理解する](02-vulnerability-classes.md) →
