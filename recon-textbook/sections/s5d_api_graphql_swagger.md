## GraphQL introspectionとSwagger/OpenAPI発見

APIエンドポイント発見の偵察（recon）では、「アプリが内部でどんなAPIを持ち、どんな引数を受け取るのか」を、コードを読まずに外側から復元することが目標になる。現代のWeb/モバイルアプリの多くは、その設計図を**アプリ自身が機械可読な形で公開している**ことがある。GraphQLの **introspection（内省）** と、REST APIの **OpenAPI/Swagger仕様** がその代表だ。本節では、この2つの「自己記述機構（self-documentation）」がなぜ存在し、どういう仕組みで内部情報を露出するのか、そして防御側の視点でどう発見・評価するのかを解説する。

> このテキストは防御・自己資産の点検を目的とする。実在サービスや本番環境への無許可の検証、破壊的手順は扱わない。以降で示すクエリやパスは、あくまで「自分が管理するAPIに、設計図がどこまで露出しているか」を点検する観点で読んでほしい。

---

### GraphQLとintrospection：APIが自分の設計図を返す仕組み

#### GraphQLとは何か（前提の整理）

**GraphQL** は、Facebook（現Meta）が2015年にオープンソース化したクエリ言語であり、クライアントが「欲しいデータを1回のクエリで正確に指定して取得する」ことを可能にする。RESTでよく起きる **over-fetching（不要なフィールドまで返ってくる）** や **under-fetching（1つの画面を描くのに何度もAPIを叩く必要がある）** を避けられるのが利点だ。ネストした複雑な取得や、リアルタイムの subscription（サーバからのプッシュ購読）も扱える。

RESTと決定的に違うのは、多くの実装で **エンドポイントが1つ（例: `/graphql`）に集約され、操作の種類はHTTPメソッドやURLではなくリクエストボディ（クエリ本文）で表現される**点だ。このため「URL列挙型」の従来の偵察が効きにくく、代わりに後述するintrospectionが偵察の主役になる。

GraphQLの操作は大きく3種類ある。

- **query**（データの取得。副作用なしが原則）
- **mutation**（データの作成・更新・削除。副作用あり）
- **subscription**（イベント購読。リアルタイム）

#### introspection（内省）とは何か、なぜ危ないのか

**introspection（内省）** とは、GraphQLサーバに対して「あなたが持っている型・フィールド・query・mutationの一覧を教えて」と問い合わせる、**GraphQL仕様に組み込まれた標準機能**である。GraphiQLのような開発者向けIDEが「補完」や「ドキュメント表示」を実現できるのは、この機能で裏側からスキーマ（schema：APIの型定義の全体像）を取得しているからだ。

つまりintrospectionは、本来は開発体験を良くするための正当な機能だが、**防御が不十分だと「APIの完全な設計図」を誰にでも配ってしまう**。攻撃者にとっては偵察の一撃で、隠しフィールド・内部mutation・管理者向け操作までまとめて把握できる強力な情報源になる。

> 「機械可読な自己記述」という点がリスクの本質だ。人間向けドキュメントは要点しか書かないが、introspectionは**実装が実際に受け付ける全フィールドを漏れなく**返す。ドキュメントに載っていない“隠しフィールド”ほど、introspectionで初めて見つかる。

#### introspectionクエリの実物と、そのメカニズム

introspectionは、`__schema` や `__type` という **`__`（アンダースコア2つ）で始まるメタタイプ（meta-type）** に問い合わせることで動く。これらはユーザ定義の型ではなく、GraphQLエンジンが内部的に必ず持つ「スキーマ自身を記述する型」だ。だから開発者が特別な実装をしなくても、エンジンが有効化していれば応答してしまう。

出典記事が示す標準的なintrospectionペイロード（全スキーマを取得するフルクエリ）は次の通り。

```graphql
{__schema{queryType{name}mutationType{name}subscriptionType{name}types{...FullType}directives{name description locations args{...InputValue}}}}fragment FullType on __Type{kind name description fields(includeDeprecated:true){name description args{...InputValue}type{...TypeRef}isDeprecated deprecationReason}inputFields{...InputValue}interfaces{...TypeRef}enumValues(includeDeprecated:true){name description isDeprecated deprecationReason}possibleTypes{...TypeRef}}fragment InputValue on __InputValue{name description type{...TypeRef}defaultValue}fragment TypeRef on __Type{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name}}}}}}}}
```

このクエリの各部が「なぜそう書かれているのか」を分解すると、introspectionの仕組みが見えてくる。

- `__schema{ queryType mutationType subscriptionType }`：まず**入口の型**を尋ねている。ここでmutationTypeが `null` でなければ「このAPIは書き込み系操作を持つ」と分かる。
- `types{...FullType}`：スキーマに存在する**全型**を列挙し、各型の `fields`（フィールド名・引数・型・deprecated情報）を取り出す。`isDeprecated`/`deprecationReason` まで取るのは、**廃止予定だがまだ動くフィールド**（往々にして権限チェックが甘い旧実装）を見つけるためだ。
- `fragment TypeRef ... ofType{ ofType{ ... }}` と入れ子が7段続くのは、GraphQLの型が `[User!]!`（Userの非null配列で全体も非null）のように **ラッパー型（List/NonNull）が多重に入れ子になる**ため。1回のクエリで深いネストまで正確に「素の型名」へ辿り着けるよう、あらかじめ深さ分の `ofType` を展開している。これが「なぜこんなに冗長なフラグメントなのか」の答えだ。

サーバはこれに対し、query・mutation・オブジェクト型・フィールド定義を**JSONで丸ごと**返す。攻撃者はこのJSONを可視化ツールに食わせれば、APIの全体像を一望できる。

#### introspectionが無効でも漏れる：フィールドサジェスト（typo suggestion）

introspectionを production で無効化しても、**もう1つの自己記述経路**が残る。GraphQLエンジンの多くはデフォルトで **field suggestion（フィールド候補提示）** を有効にしている。存在しないフィールド名をわざと少し綴り間違えて送ると、エンジンが `Did you mean "..."?`（「もしかして…？」）と、**実在する近いフィールド名を親切に教えてしまう**のだ。

これはレーベンシュタイン距離（編集距離）などで既知フィールドと照合し、近いものを提示するという実装挙動に由来する。introspectionを塞いでも、この挙動を残していると、辞書的に総当たりして候補を集めることで**スキーマを部分的に再構築**できてしまう。防御としては introspection の無効化とセットで **suggestion の無効化** も検討すべき、という結論になる。

> 出典: Hacking GraphQL endpoints — https://www.yeswehack.com/learn-bug-bounty/hacking-graphql-endpoints

#### GraphQLエンドポイントの発見（recon手順）

GraphQLはURLに操作が現れないため、まず「GraphQLがそこにいる」こと自体を見つける必要がある。出典記事が挙げる代表的なパスは以下。

```text
/graphql
/graphiql
/graph
/graphql/console/
/graphql.php
/graphiql.php
/v1/graphiql
/v1/explorer
```

加えて有効な発見手法として、記事は **JavaScriptファイルの調査** を挙げる。フロントのJSバンドルを取得し、`query` / `mutation` / `graphql` といったキーワードを検索すると、**公式には案内されていない・廃止されたはずのエンドポイント**が露出することがある。SPA（シングルページアプリ）はエンドポイントや一部クエリ文字列をJS内に埋め込むため、JSは「APIの設計図の断片」が落ちている一等地だ。

エンドポイントを見つけたら、introspectionが有効かを確認する（前掲の `__schema` クエリを1回投げ、スキーマJSONが返るかを見る）。返れば設計図は全公開、返らなければ suggestion 経由の復元やスキーマ推定に切り替える、という判断になる。

#### introspectionが露出させる「攻撃面」の具体例

introspectionはあくまで偵察であり、露出したスキーマは次のような弱点の**入口**になる（出典記事の例。いずれも自分の資産の点検観点で読むこと）。

**IDOR（Insecure Direct Object Reference：本来アクセス権のないIDを直接指定して他人のデータを取る）。** GraphQLのqueryはデータ取得だけで**アクセス制御を自動では持たない**。認可はリゾルバ（resolver：各フィールドの値を実際に返す関数）ごとに開発者が書く必要がある。書き忘れると、引数のIDを差し替えるだけで他人の情報が返る。

```graphql
query {
  currentUser(internalId: 1337) {
    role
    name
    email
    token
  }
}
```

`internalId` を変えるだけで別ユーザの `email` や `token` まで返るなら、リゾルバに認可チェックが無い。introspectionで `currentUser` が `internalId` という引数を取ると分かった時点で、この攻撃面が可視化される。

**意図しないデータ露出（over-exposed fields）。** クエリにフィールドを足すだけで、返す想定でなかった情報が付いてくることがある。

```graphql
query {
  listPosts(postId: 13) {
    title
    description
    user {
      username
      email
      firstName
      lastName
    }
  }
}
```

投稿一覧に紐づく `user` を辿って `email` まで取れてしまうのは、リゾルバやスキーマ設計で「返してよいフィールド」を絞れていないため。introspectionが無ければ `user.email` の存在自体に気づきにくいが、設計図が公開されていると即座に狙える。

**マスアサインメント（mass assignment）。** mutationは書き込み操作なので、**本来クライアントが指定できないはずのフィールド**を引数に紛れ込ませられると危険だ。

```graphql
mutation {
    registerAccount(nickname:"hacker", email:"test@example.com", password:"StrongP@ssword!", role:"Admin") {
        token { accessToken }
        user { email nickname role }
    }
}
```

`role:"Admin"` は本来サーバ側で固定すべき（登録時にユーザが自分の権限を決められてはいけない）。mutationの入力型に `role` が含まれているとintrospectionで判明すれば、この不変条件が守られているかが検証ポイントになる。

**バッチング攻撃（batching）。** GraphQLは複数の操作を1リクエストにまとめられる。記事はこれを「レート制限や試行回数制限を回避する手段」と説明する。1回のHTTPリクエストの中に多数のqueryを詰めれば、リクエスト数ベースのブルートフォース防御（例: ログイン試行回数）を素通りできてしまう——という原理だ。防御側は「HTTPリクエスト数」ではなく「操作数・クエリ複雑度」で制限をかける必要がある。

#### スキーマを扱うツール（防御点検にも使える）

- **GraphQL Voyager**：introspection結果を**型の関係グラフ**として可視化する。ネストした型同士のつながりを一目で把握でき、自分のスキーマがどこまで露出しているかの点検にも有用。
- **InQL**：introspectionクエリの実行と、**発見したスキーマからのクエリテンプレート自動生成**を行う。CLIとBurp Suite拡張の両方で使え、introspectionが無効な場合向けの複数のスキーマ探索手法も備える。防御側では「自分のエンドポイントにInQLを向けて、どこまで抜けるか」を確認する用途に使える。
- **GraphiQL**：組み込みのGraphQL IDE。対話的にクエリを試せるが、**本番に露出したままにしないこと自体が点検項目**になる。

#### 防御（production で必ずやること）

出典記事が挙げる防御策とその理由。

- **本番でintrospectionを無効化する。** 「introspectionを無効化するか、認可されたユーザのみに制限すれば、攻撃者によるスキーマのマッピングを防げる」。設計図を配らないのが第一歩。あわせて前述の **suggestion も無効化** し、綴り間違い経由の復元も塞ぐ。
- **全リゾルバで堅牢なアクセス制御を強制する。** GraphQLは自動で認可しないので、フィールド/操作ごとに厳格に権限判定する。IDORやマスアサインメントの根本対策はここ。
- **クエリのホワイトリスト（persisted queries）。** 「事前承認済みの安全なクエリのみ実行を許可する」。任意クエリを受け付けない運用にすれば、introspectionも未知クエリも通らない。
- **安全なエラーハンドリング。** 利用者には汎用的なエラーだけを返し、詳細は内部ログにとどめる。詳細エラーはスキーマ推定のヒントになるため。

> 出典: Hacking GraphQL endpoints — https://www.yeswehack.com/learn-bug-bounty/hacking-graphql-endpoints

---

### Swagger UI / OpenAPI仕様の発見

GraphQLがintrospectionで設計図を返すのと同様に、REST APIの世界では **OpenAPI仕様（旧称Swagger仕様）** が「機械可読な設計図」の役割を果たす。そしてこの設計図が本番に露出していることは珍しくない。ここでは、その発見手法を扱った実践記事を読み解く。

> ⚠️ **未取得の資料**: 「How I Hunt for Swagger UI on Real Targets（Muhammed Asfan）」は自動取得できませんでした（理由: 記事URLへの直接アクセスが HTTP 403 Forbidden で拒否されたため。egress/WAF によるブロックと推定）。以下のURLからご自身で直接ご覧ください: https://medium.com/@MuhammedAsfan/how-i-hunt-for-swagger-ui-on-real-targets-a-practical-guide-for-bug-bounty-hunters-d44b284609aa
>
> 直接取得はできなかったが、Web検索で記事の要点を復元できたため、以下ではその**復元できた内容**を中心にまとめる。復元の裏取りが取れない一般論には「（以下は未取得資料の補足として一般知識に基づく解説です）」と明記する。

#### OpenAPI/SwaggerとSwagger UIの関係（前提の整理）

まず用語を切り分ける。

- **OpenAPI仕様（OpenAPI Specification, OAS）**：REST APIの構造（エンドポイントURL、HTTPメソッド、パラメータ名と型、リクエスト/レスポンスのスキーマ、認証方式など）を **JSONまたはYAMLで機械可読に**記述したファイル。以前は **Swagger仕様** と呼ばれ、2.0までがSwagger、3.0以降がOpenAPIと呼ばれる。ファイル冒頭が `swagger: "2.0"` なら旧2系、`openapi: 3.x.x` なら3系だ。
- **Swagger UI**：そのOpenAPIファイルを読み込み、**ブラウザ上に「全エンドポイント一覧＋パラメータ＋Try it out（その場でAPIを実行）」の画面**として描画するビューア。「見慣れた青いUIで、ブラウザ内のPostmanのように叩ける」もの、というのが記事の表現だ。

recon的に重要なのは、**Swagger UIが露出していれば、すべてのエンドポイントとHTTPメソッド、すべてのパラメータ名が載った“出来合いのAPIマップ”が手に入る**という点。UIが無くても、素の `openapi.json` / `swagger.json` が取れれば十分な収穫だ（記事いわく「openapi または swagger で始まり paths を持つJSON/YAMLを見つけたら、それは価値ある発見」）。

> 出典（要点の復元元）: How I Hunt for Swagger UI on Real Targets — Muhammed Asfan / Medium — https://medium.com/@MuhammedAsfan/how-i-hunt-for-swagger-ui-on-real-targets-a-practical-guide-for-bug-bounty-hunters-d44b284609aa

#### 探すべき代表的なパス

記事および周辺の実務で頻出するパスは次の通り。フレームワークによって置き場所が変わるため、UIとスペック本体（JSON/YAML）の両系統を当たる。

```text
# Swagger UI（描画ページ）
/swagger-ui.html
/swagger-ui/
/swagger/
/api/docs
/api/v1/swagger-ui.html
/redoc                # ReDoc（別デザインのOpenAPIビューア）

# OpenAPI/Swaggerスペック本体（JSON/YAML）
/openapi.json
/swagger.json
/v2/api-docs          # springfox 等（Swagger 2 系）
/v3/api-docs          # springdoc 等（OpenAPI 3 系）
/api-docs
```

**なぜこのパスなのか。** これらは各フレームワークの**デフォルト配置**だからだ。たとえばJavaのSpring系では springfox が `/v2/api-docs`、springdoc が `/v3/api-docs` と `/swagger-ui.html` をデフォルトで生やす。開発者がこの既定値を変えず、かつ本番で無効化し忘れると、そのまま外から取れてしまう。「設計図が既定パスに置かれ、production で消し忘れられる」——これが露出の根本原因である。

#### 発見の実践フロー（記事の手順の復元）

記事が示す実践の流れは、複雑化させず素直に進めるのがコツだとされる。

1. **メインドメインと“いかにもAPIっぽい”ドメインから始める。** 新しい対象を開いたら、まず本体ドメインと `api.` などのサブドメインで上記パスを当たる。
2. **サブドメインが多い場合はGoogle dorkに切り替える。** 手作業が非現実的な規模になったら、Googleの検索演算子（dork）でインデックス済みのSwagger UI/スペックを一括で洗い出す。青いSwagger UIや素のOpenAPIスペックを見つけたら**URLを必ず保存**し、後で戻ってこられるようにする（「戻る価値のある場所」だから）。
3. **UIが無く `/openapi.json` だけ露出している場合は、自前でUIを立てる。** スペック本体さえ手に入れば、手元のマシンでSwagger UIを起動してそのスペックを読み込ませ、同じ“APIマップ”を再構築できる。UIの有無は本質ではなく、**スペックが取れるかどうか**が勝負、という考え方だ。
4. **Wayback Machine（アーカイブ）を使う。** 企業は本番からAPIドキュメントを消しても、**過去バージョンがキャッシュに残っている**ことを忘れがちだ。Wayback の CDX API に対して recon 用ワードリストを流し、アーカイブされた swagger ファイルを掘り出す。「今は無いが昔はあった設計図」を復元する手法である。

> 出典（要点の復元元）: How I Hunt for Swagger UI on Real Targets — Muhammed Asfan / Medium — https://medium.com/@MuhammedAsfan/how-i-hunt-for-swagger-ui-on-real-targets-a-practical-guide-for-bug-bounty-hunters-d44b284609aa

#### Google dorkの考え方

（以下は未取得資料の補足として一般知識に基づく解説です。）Google dorkは、検索エンジンがすでにインデックスした露出物を、URLパターンやページ内テキストで絞り込む手法だ。Swagger/OpenAPI探索では、対象ドメインに限定しつつ、既定パスやUI特有の文字列を手掛かりにする。考え方の例（自分の管理ドメインの露出点検に用いること）:

```text
site:example.com inurl:swagger
site:example.com inurl:api-docs
site:example.com intitle:"Swagger UI"
site:example.com ext:json openapi
```

`inurl:` はURLに特定文字列を含むページ、`intitle:` はページタイトル（Swagger UIは `<title>Swagger UI</title>` を持つ）、`ext:`/`filetype:` はファイル拡張子で絞る演算子だ。**インデックス済みのものしか出ない**という限界があるため、前述のディレクトリ探索やWaybackと組み合わせる。

#### なぜ露出が起きるのか（原理）

（以下は未取得資料の補足として一般知識に基づく解説です。）露出の主因は次の3つに集約される。

1. **フレームワークのデフォルトが「有効」。** 多くのAPIフレームワークで、Swagger UI/スペック生成は開発時の利便性のため既定で有効。本番プロファイルで明示的に無効化しないと残る。
2. **本番/開発の設定分離が甘い。** 「開発環境だけ有効」の想定が、環境変数やプロファイルの設定漏れで本番にも適用される。
3. **アーカイブ・古い版の取り残し。** production から消しても、旧サブドメイン・CDNキャッシュ・Wayback に設計図が残り続ける。

#### 露出したスペックが recon にもたらすもの

Swagger UI/OpenAPIスペックが取れると、偵察上は次が**一括で**手に入る。

- 全**エンドポイントURLとHTTPメソッド**（GET/POST/PUT/DELETE…）
- 各エンドポイントの**パラメータ名・型・必須/任意**、リクエスト/レスポンスのスキーマ
- **認証方式**（APIキー/Bearer/OAuthのどれを要求するか）
- ドキュメント化されていない/内部向けの**隠しエンドポイント**（人間向けドキュメントには載らないもの）

これはGraphQLのintrospectionと**まったく同じ性質のリスク**だ。どちらも「機械可読な完全な設計図」を外部に配ってしまう。検索結果によれば、露出・設定不備のSwaggerは DOM XSS・HTMLインジェクション・オープンリダイレクト等の入口にもなり、複数のバグバウンティで60件超のSwagger UI XSSが報告されたとされる。ただし本節のスコープは「設計図がどこまで露出しているかの発見」であり、そこから先の攻撃実証は扱わない。

#### 防御（自分の資産で確認すべきこと）

（以下は未取得資料の補足として一般知識に基づく解説です。）

- **本番でSwagger UIとスペック配信を無効化する**（または認証の背後に置く）。フレームワークの本番プロファイルで明示的にオフにする。
- **既定パスを塞ぐ。** `/swagger-ui.html`・`/v2/api-docs`・`/v3/api-docs`・`/openapi.json` 等がインターネットから匿名で取れないことを確認する。
- **アーカイブと旧サブドメインを点検する。** Wayback や古い `dev.`/`staging.` サブドメインに設計図が残っていないかを確認し、あれば削除・アクセス制限する。
- **Swagger UI 自体を最新版に保つ。** 露出させる場合でも、既知のXSS等が修正された版を使う。

> 出典（要点の復元元）: How I Hunt for Swagger UI on Real Targets — Muhammed Asfan / Medium — https://medium.com/@MuhammedAsfan/how-i-hunt-for-swagger-ui-on-real-targets-a-practical-guide-for-bug-bounty-hunters-d44b284609aa

---

### まとめ：2つの「自己記述機構」を同じ目で見る

本節の核心は、GraphQL introspection と OpenAPI/Swagger が**同じ問題の裏表**だという点にある。どちらも「開発者の利便性のためにAPIが自分の設計図を機械可読に公開する機能」であり、**本番で無効化・保護し忘れると、偵察者に完全なAPIマップを無償提供する**。

- GraphQLでは `__schema` メタタイプ経由のintrospectionが主経路。無効化してもフィールドサジェスト（`Did you mean`）で部分復元される点に注意。防御は introspection と suggestion の両無効化、全リゾルバでの認可、persisted queries。
- RESTでは `/swagger-ui.html` や `/v2|v3/api-docs`、`/openapi.json` 等の既定パスが主経路。UIが無くてもスペック本体が取れれば設計図は再構築できる。Way.back など**過去の取り残し**も探索対象。防御は本番での無効化、既定パスの遮断、アーカイブ点検。

偵察の観点では「設計図が取れるか」を、防御の観点では「設計図を配っていないか」を確認する——同じチェックを攻守どちらの立場からも行えることが、この2機構を理解する実務的な価値である。
