# 第1章 前提: GraphQLの仕組みを攻撃者視点で理解する

## GraphQLの基本構造とattack surface

### この章で押さえること

GraphQLはREST APIとは根本的に異なるリクエスト処理モデルを持つクエリ言語であり、その差異こそが独自の攻撃対象領域（attack surface、攻撃者が悪用可能な入力・機能の総体）を生み出している。本節では、GraphQLがどのような構造を持ち、なぜその構造が攻撃者にとって有用な情報源・侵入経路になるのかを、防御側の視点で整理する。

### GraphQLとは何か——REST APIとの構造的な違い

GraphQLは「クライアントとサーバー間の効率的な通信を目的として設計されたAPIクエリ言語」である。REST APIでは `/users/1`、`/users/1/posts` のように、リソースやアクションごとに個別のエンドポイント（URLパス）が用意されるのが一般的だが、GraphQLではこの構造が完全に異なる。

> 出典: What is GraphQL? — https://portswigger.net/web-security/graphql/what-is-graphql

#### 単一エンドポイントという設計

GraphQLの最大の特徴は、**すべての操作が単一のエンドポイント（通常は `/graphql` のようなパス）に対して送られる**ことである。クエリ（query）、ミューテーション（mutation）、サブスクリプション（subscription）という3種類の操作は、いずれも一般的には同一のエンドポイントへの `POST` リクエストとして送信され、リクエストボディに含まれる操作の種類（キーワード）によってサーバー側の処理内容が決まる。

この設計は攻撃者視点で見ると重要な意味を持つ。REST APIであればURLパスの一覧（`/admin`, `/internal/*` など）をクロールしたりWAFでパスごとにルールを設定したりできるが、GraphQLでは**エンドポイントが1つしかないため、URLパスベースのアクセス制御やWAFルールが機能しにくい**。すべての操作（データ参照・更新・削除を問わず）が同一パスに集約されるので、防御側は「どのパスにアクセスされたか」ではなく「リクエストボディの中身に何が書かれているか」を検査しなければならない。これはリクエストの可視化・ロギング・レート制限の設計に直接影響する構造的な特徴である。

#### 3種類の操作とそれぞれの意味

GraphQLの操作は以下の3種類に大別される。

**クエリ（query）**: データを取得する操作で、RESTにおける `GET` に相当する。操作の種類、任意の操作名、取得したいデータ構造（フィールドの指定）、そして任意の引数（argument）から構成される。

**ミューテーション（mutation）**: データの追加・削除・編集を行う操作で、RESTにおける `POST`・`PUT`・`DELETE` に相当する。ミューテーションは常に入力パラメータ（input）を必要とする。攻撃者視点では、ミューテーションは「状態変更を伴うエンドポイント」に該当するため、認可制御（authorization、ある操作の実行が許可されているかの検証）の不備が最も深刻な影響（データ改ざん・権限昇格）に直結しやすい箇所である。

**サブスクリプション（subscription）**: サーバーとの長期接続（long-lived connection）を確立し、サーバー側からクライアントへリアルタイムに更新をプッシュする仕組みである。チャットのようなリアルタイム機能の実現に使われることが多く、典型的にはWebSocketを介して実装される。この長期接続という性質は、通常のリクエスト単位の認証・レート制限モデルとは異なる考慮が必要になる（この点は本教科書の後続章、WebSocketセキュリティの章で詳しく扱う）。

> 出典: What is GraphQL? — https://portswigger.net/web-security/graphql/what-is-graphql

#### スキーマ——攻撃者にとっての「地図」

GraphQL APIは**スキーマ（schema）**によって定義される。スキーマは「フロントエンドとバックエンドの間の契約」であり、利用可能な型（type）、フィールド（field）、およびそれらの関係性を、人間が読めるスキーマ定義言語（SDL: Schema Definition Language）で記述したものである。例えば次のような形で定義される。

```graphql
type Product {
  id: ID!
  name: String!
  price: Float!
  internalCost: Float
}
```

ここで `!` は非null（non-nullable、値が必ず存在しなければならないフィールド）を示す演算子である。この宣言により、クライアントは `Product` 型に `id`・`name`・`price`・`internalCost` というフィールドが存在することを知ることができる。

このスキーマこそが、GraphQL特有の攻撃対象領域の核心にある。REST APIでは「どのようなデータが取得できるか」はドキュメントを読むかレスポンスを観察するまで分からないことが多いが、GraphQLでは**スキーマ自体が「このAPIで何ができるか」の完全な設計図**になっている。攻撃者がこの設計図を入手できれば、`internalCost` のような本来クライアントに見せるべきでないフィールドの存在や、管理者専用の可能性があるミューテーション名などを、推測ではなく確実な情報として把握できる。この設計図を取得する仕組みが、次に説明する**イントロスペクション**である。

### イントロスペクション——スキーマを問い合わせる機能

イントロスペクション（introspection、内省）とは、GraphQLの仕様に組み込まれた機能で、クライアントがGraphQLスキーマの構造・型・機能についてクエリを実行して問い合わせることができる仕組みである。もともとは開発ツール（IDEのオートコンプリートやAPIエクスプローラーなど）のために設計された、正規の機能である。

> 出典: Introspection — https://graphql.org/learn/introspection/

#### `__schema` と `__type`——スキーマ全体を引き出すメタフィールド

イントロスペクションは `__` で始まる特殊な**メタフィールド（meta-field）**を通じて行われる。これらはユーザー定義のスキーマとは別に、GraphQL実装が標準で提供するものである。

- **`__schema`**: ルートの `query` 操作型に対して常に利用可能であり、スキーマに含まれるすべての型（type）の一覧を返す。スキーマ構造全体へのエントリーポイントとなる。
- **`__type`**: 特定の型を名前で指定して、その型のメタデータ（種別・フィールド・説明文など）を問い合わせる。
- **`__typename`**: 問い合わせている対象の型名を文字列で返す。Object・Interface・Union型で利用可能であり、GraphQL実装によって自動的に提供される。Union型（複数の型のいずれかを返しうるフィールド）でどの具体型が返されたかを判別する際に特に有用である。

以下は公式ドキュメントに示されている、スキーマ全体を列挙するイントロスペクションクエリの例である。

```graphql
query {
  __schema {
    types {
      name
      kind
      description
    }
    queryType { name }
  }
}
```

そして特定の型（ここでは `Droid`）のフィールド情報を詳細に取得する例は次の通りである。

```graphql
query {
  __type(name: "Droid") {
    name
    kind
    fields {
      name
      type {
        name
        kind
        ofType {
          name
          kind
        }
      }
      description
    }
  }
}
```

**なぜこのクエリが機能するのか**——GraphQLサーバーの実装（graphql-jsなど）は、GraphQL仕様に準拠する限り、ユーザー定義のスキーマとは独立に、`__schema` や `__type` をルートクエリの特殊フィールドとして常に解決（resolve）できるようになっている。つまりこれは開発者が明示的に実装したAPIではなく、**仕様に準拠したGraphQLエンジンであれば標準で備わっている機能**である。そのため、開発者が「このAPIは公開しない」と考えていたとしても、イントロスペクションを明示的に無効化しない限り、スキーマ全体が誰でも問い合わせ可能な状態のまま公開されてしまう。

#### イントロスペクションで取得できる情報の粒度

イントロスペクションは単なる型名の一覧にとどまらず、非常に詳細な情報を返す。

- **型の種別（Type Kind）**: `__TypeKind` という列挙型（enum）で表され、`OBJECT`・`INTERFACE`・`ENUM`・`SCALAR`・`UNION`・`LIST`・`NON_NULL` などの値を取る。
- **フィールド情報**: 各フィールドの名前・型・必須かどうか（`NON_NULL` ラッパー）・説明文。
- **ラッパー型**: `LIST`（配列）や `NON_NULL`（必須）といった型修飾を、`ofType` フィールドで再帰的にたどることで、複雑な型定義を完全に復元できる。
- **高度なメタデータ**: あるObject型がどのInterfaceを実装しているか、Enum型の取りうる値、Input型の引数一覧、ディレクティブ（`@deprecated` など）の情報とその適用可能位置。

型はさらに3つのカテゴリに分類される。ユーザー定義型（`Query`・`Mutation`・アプリケーション固有のObject/Interface/Enumなど）、組み込みスカラー型（`Boolean`・`Float`・`ID`・`Int`・`String`）、そしてイントロスペクション自体の型（`__Schema`・`__Type`・`__TypeKind`・`__Field`・`__InputValue`・`__EnumValue`・`__Directive`・`__DirectiveLocation` など、いずれも `__` で始まる）である。

**攻撃者視点での意味**——この粒度の情報が得られるということは、攻撃者は本番環境に対して一切のブルートフォースや推測を行うことなく、**そのAPIが持つすべてのクエリ・ミューテーション・型・フィールド・引数の完全なリストを、たった1回か数回のリクエストで取得できる**ということである。これはREST APIにおいて「エンドポイントを総当たりで探索する」偵察フェーズに相当する作業を、実質的に一瞬で完了させてしまう。特に、`internalCost`・`isAdmin`・`debugToken` のような、UIでは使われていないがスキーマ上には残っているフィールドや、`deletePaymentMethod`・`impersonateUser` のような強力なミューテーションの存在を、攻撃者は正確な名前とシグネチャ（引数の型と要否）付きで把握できてしまう。

#### 本番運用における位置づけ

公開ドキュメント側でも明確に述べられているように、公開を意図していないAPIについては、イントロスペクションは**本番環境では無効化するのが一般的なベストプラクティス**とされている。理由は次の3点に整理できる。

1. APIの攻撃対象領域を縮小できる（攻撃者に設計図を渡さずに済む）。
2. 権限のないスキーマ探索を防止できる。
3. 実運用で必要なクエリ・ミューテーションは通常、コンパイル時（ビルド時）にクライアントアプリケーションへ組み込まれるため、実行時のイントロスペクションは開発時ほど必要とされない。

このベストプラクティスは、より広範なセキュリティ戦略の一部として位置づけられる。具体的には、認証・認可の徹底に加えて、許可された操作のみを受け付けるオペレーションのセーフリスト化（safe-listing）、クエリの深さ・幅の制限、クエリのコスト解析とタイムアウト設定、循環参照の拒否、エイリアス数の制限などが挙げられている。これらの防御手法（特にクエリの深さ制限やコスト解析）については、本教科書の後続章でDoS対策として詳しく扱う。

> 出典: Introspection — https://graphql.org/learn/introspection/

### GraphQL API脆弱性の全体像

ここまでの構造（単一エンドポイント、3種類の操作、スキーマ、イントロスペクション）を踏まえたうえで、GraphQL API特有の脆弱性カテゴリの全体像を概観する。以降の章では、これらをそれぞれ深掘りしていく。

#### イントロスペクションが残存するリスク

先述の通り、「イントロスペクション機能が本番環境で有効なまま残されることがあり、攻撃者がAPIに問い合わせてスキーマに関する情報を得ることを可能にしてしまう」という問題がある。防御側はイントロスペクションを本番で無効化するか、正規表現ベースのフィルタで `__schema` などの文字列を含むリクエストを遮断する対策を取ることがあるが、こうしたフィルタは特殊文字の挿入や大文字小文字の変則的な混在などのエンコーディング上の工夫によって回避されうる点に注意が必要である。

#### 引数の未検証によるIDOR

GraphQLのクエリ引数（argument）が適切に検証・認可チェックされていない場合、**IDOR（Insecure Direct Object Reference、直接オブジェクト参照の不備）**につながる。典型例として、商品一覧のクエリでは表示されない「非公開（delisted）」商品であっても、その商品IDを直接指定してクエリを実行すれば取得できてしまうケースが挙げられる。これはREST APIにおける「連番IDをURLに直接指定してアクセスする」IDORと本質的に同じ問題であり、GraphQLの柔軟な引数指定の仕組みがそのまま攻撃経路になりうることを示している。この種の脆弱性については、本教科書のIDOR/BOLA（Broken Object Level Authorization）を扱う章でさらに詳しく解説する。

#### CSRF（クロスサイトリクエストフォージェリ）

GraphQLエンドポイントがリクエストのContent-Typeを検証せず、かつCSRFトークンも実装していない場合、CSRF脆弱性が発生しうる。特に、GraphQLエンドポイントが `GET` リクエストや `application/x-www-form-urlencoded` 形式でエンコードされた `POST` リクエストを受け付ける設定になっている場合、これらは単純なHTMLフォームやリンクから発生させることができるため、CSRF攻撃に対して脆弱なままとなる。GraphQLは本来 `POST` かつ `application/json` を前提として設計されることが多いが、実装の柔軟性ゆえにこうした代替リクエスト形式を許容してしまうサーバーが存在する点が問題の根本にある。

#### エイリアスを悪用したレート制限の回避

GraphQLの**エイリアス（alias）**は、同じフィールド・型に対する複数のクエリ結果を、1回のリクエスト内でそれぞれ別名を付けて取得できる機能である。本来は「同じミューテーションを異なる引数で複数回呼び出す」といった正規の用途のための機能だが、この仕組みを悪用すると、**1回のHTTPリクエストの中に大量のログイン試行やパスワードリセット試行などを詰め込むことができ**、リクエスト単位（1リクエスト＝1試行という前提）で設計されたレート制限機構をすり抜けてしまう可能性がある。これは「単一エンドポイントに複数の操作をバッチ的に詰め込める」というGraphQLの表現力の高さが、そのまま防御側の想定を裏切る攻撃手法に転化する典型例である。

#### イントロスペクション無効時のスキーマ推測

イントロスペクションが無効化されていても、攻撃者がスキーマ情報を完全に得られなくなるわけではない。例えばApollo Server系の実装が持つ「フィールド名の提案（suggestion）」機能は、存在しないフィールド名を含むクエリを送信した際に「もしかして `xxx` ですか？」といった形でエラーメッセージ中に正しいフィールド名のヒントを返すことがある。攻撃者はこの挙動を利用し、総当たり的にクエリを送ってエラーメッセージから正しいフィールド名を1つずつ推測・復元していくことで、イントロスペクションを使わずともスキーマを部分的に再構築できてしまう。

#### サービス拒否（DoS）

GraphQLはクライアントが任意にネストした（入れ子になった）クエリを構築できるため、計算量的に非常にコストの高いクエリをサーバーに送りつけることが可能になる。例えば、関連オブジェクトを再帰的に何段も辿るクエリは、サーバー側のデータベースアクセスや計算量を指数関数的に増大させうる。対策として、クエリの深さ（depth）や操作の複雑度（complexity）を制限することが推奨されている。

> 出典: GraphQL API vulnerabilities — https://portswigger.net/web-security/graphql

### まとめ——この章の要点

GraphQLの攻撃対象領域は、その設計思想そのものから生まれている。単一エンドポイントはURLベースの防御を無力化し、スキーマとイントロスペクションはAPI全体の「設計図」を攻撃者に無償で提供しうる機能であり、エイリアスや任意のネストといった表現力の高さは、レート制限やリソース制限といった従来型の防御機構の前提を崩す。防御側にとって重要なのは、「GraphQLは便利なクエリ言語である」という理解にとどまらず、**その柔軟性・表現力の高さ自体が攻撃者にとっての柔軟性でもある**という視点を持つことである。次章以降では、この章で概観した各脆弱性カテゴリ（イントロスペクション悪用、IDOR、CSRF、レート制限回避、DoS、そしてWebSocketを介したサブスクリプションのセキュリティ）を、それぞれ仕組みレベルで深掘りしていく。

## GraphQL脆弱性の全体像と代表的CVE

GraphQLはクライアントが「欲しいデータの形」をクエリとして宣言し、サーバーが単一のエンドポイント（多くは`/graphql`）でそれを解決するクエリ言語兼ランタイムである。REST APIのように「リソースごとに複数のエンドポイントへ複数回リクエストする」のではなく、1回のリクエストで必要なフィールドだけを取得できるため、オーバーフェッチ（不要なデータまで返ってくる無駄）やアンダーフェッチ（必要なデータを得るために何度も往復する無駄）を減らせる。この「単一エンドポイント・柔軟なクエリ」という設計そのものが、REST時代の防御策（URLパスごとのWAFルール、エンドポイント単位のレート制限など）をすり抜けやすい構造的な弱点になっている。本節では、GraphQL特有の脆弱性クラスを俯瞰し、実際に公表されたCVE・GHSA（GitHub Security Advisory）を年表として整理したうえで、なぜそれらが起こるのかという仕組みレベルの理由を解説する。

### GraphQLの基本構造とリスクの土台

GraphQLは以下の要素から成る。

- **スキーマ**: 利用可能な型（Type）・フィールド・引数を定義した設計図
- **クエリ（Query）**: データ取得操作
- **ミューテーション（Mutation）**: データ変更操作
- **サブスクリプション（Subscription）**: WebSocketなどを介したリアルタイム購読（第2部で扱う）
- **リゾルバ（Resolver）**: 各フィールドを実際に解決する関数。ここがDB・外部API・ファイルシステムなどへの「sink（入力が最終的に実行・解釈される危険な代入先）」になりやすい

REST API向けに培われた防御（パスごとのアクセス制御、URLベースのレート制限、境界でのバリデーション）は、GraphQLでは「1つのURL・1つのHTTPメソッド（多くはPOST）の中に無数の操作が畳み込まれる」ため機能しにくい。この非対称性こそが、本節で扱うほぼ全ての脆弱性クラスに共通する根本原因である。

> ⚠️ **未取得の資料**: 「HackTricks - GraphQL」はhacktricks.wiki本体からの直接取得がHTTP 402（Payment Required）でブロックされたため、GitHub原本（HackTricks-wikiリポジトリのraw Markdown）から代替取得した。内容はhacktricks.wikiの正典と同一ソースに基づく。

### 脆弱性クラス1: イントロスペクション（introspection）による情報漏洩

イントロスペクションとは、GraphQLスキーマ自体をGraphQLクエリで問い合わせられる機能である。`__schema`という予約フィールドに対してクエリを投げると、定義済みの全ての型・フィールド・引数・説明文が返ってくる。

```graphql
query {
  __schema {
    types {
      name
      fields {
        name
        args { name description type { name kind ofType { name kind } } }
      }
    }
  }
}
```

多くのGraphQL実装では開発体験を優先してこの機能がデフォルトで有効になっており、本番環境で無効化し忘れると、攻撃者はAPIドキュメントを読まなくても内部構造（隠しフィールド名、管理者専用ミューテーション名など）を丸ごと入手できる。これは「なぜ危険か」が単純で、スキーマは本来「攻撃対象領域の地図」そのものだからである。

イントロスペクションを無効化していても、以下の手法で迂回・再構成が可能である。

- `__schema`の直後に改行・空白・カンマなどの空白文字を挿入し、単純な正規表現ベースのフィルタ（`__schema`という文字列を検出してブロックするWAFルールなど）を回避する
- エラーメッセージの「もしかして: `passwordHash` フィールドですか？」のようなフィールド候補提示（field suggestion）から、存在するフィールド名を1つずつ推測する
- `clairvoyance`のような辞書ブルートフォースツールで、大量の単語リストを総当たりし、エラー応答の有無からスキーマを再構築する

> 出典: HackTricks — GraphQL（GitHub原本, HackTricks-wikiリポジトリ） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md

実際の被害例として、**CVE-2023-47643**（SuiteCRM 8.4.2未満）では、未認証のユーザーが`__schema`クエリを送るだけでスキーマ全体を取得できた。修正版ではイントロスペクションのデフォルト無効化とフィールド候補提示の抑制が行われている。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

**防御**: 本番環境ではイントロスペクションを明示的に無効化する（多くのフレームワークでは`introspection: false`のような設定フラグがある）。さらに、フィールド候補提示（field suggestion）機能自体を切らないとClairvoyance系ツールによる再構成を防げない点に注意する。

### 脆弱性クラス2: バッチング・エイリアス濫用によるレート制限バイパス

GraphQLの仕様上、1つのHTTPリクエストの中に複数の操作（配列形式のバッチクエリ）や、同一フィールドを別名（エイリアス）で複数回呼び出すクエリを詰め込める。これが「1リクエスト=1操作」を前提にしたレート制限・ブルートフォース検知を無効化する。

**バッチングによるブルートフォース（batching brute force）**の例:

```json
[
  {"query":"mutation{login(email:\"a@test.com\",password:\"pass1\"){token}}"},
  {"query":"mutation{login(email:\"b@test.com\",password:\"pass2\"){token}}"},
  {"query":"mutation{login(email:\"c@test.com\",password:\"pass3\"){token}}"}
]
```

外部の監視装置（WAFやレート制限ミドルウェア）はHTTPリクエスト数を基準にカウントするため、これは「1リクエスト」としてしか記録されない。しかし内部では配列内の要素数だけログイン試行が実行される。

**エイリアスオーバーロード（alias overloading）**の例:

```graphql
query isValidDiscount($code: Int) {
  isValidDiscount(code: $code) { valid }
  isValidDiscount2: isValidDiscount(code: $code) { valid }
  isValidDiscount3: isValidDiscount(code: $code) { valid }
}
```

GraphQLの仕様では同一フィールドを複数回問い合わせる際、結果のキーが衝突しないよう「エイリアス」という別名を付けられる。この仕組みを悪用すると、1リクエストの中に数百〜数千のエイリアス付きフィールドを並べることで、実質的に大量の実行を1リクエストに圧縮できる。

> 出典: HackTricks — GraphQL（GitHub原本） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md

実際の脆弱性として**CVE-2024-39895**（Directus, CVSS 6.5, 10.12.0で修正）では、認証済みユーザーがエイリアス／フィールド重複を用いてレート制限を回避し、データベース負荷を線形に増大させられた。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

**防御**: レート制限を「HTTPリクエスト数」ではなく「実行される操作数・フィールド数」単位で計測する。バッチング自体を無効化する、あるいはバッチ内の操作数やクエリ内のエイリアス数に上限を設けるミドルウェア（後述の`graphql-armor`など）を導入する。

### 脆弱性クラス3: クエリ複雑性・パーサDoS

GraphQLはクエリの「深さ」や「複雑さ」に本来上限がない。悪意あるクライアントはこれを使って、サーバー側に指数関数的な処理負荷をかけられる。

**循環フラグメントによる無限再帰**:

```graphql
fragment A on Query { ...B }
fragment B on Query { ...A }
query { ...A }
```

フラグメント同士が互いを参照し合う循環定義を送ると、パーサやバリデータがこれを展開しようとして無限ループ、もしくはスタックオーバーフローを起こす。

**ディレクティブオーバーロード**:

```graphql
query overload {
  __typename @include(if: true) @include(if: true) @include(if: true)
}
```

同一フィールドに`@include`のようなディレクティブを大量に重ねると、実行ノードの数が指数関数的に増え、CPU・メモリを枯渇させる。これは実際に**CVE-2024-47614**（Rust製async-graphql、7.0.10で修正）として報告されており、同種の脆弱性はGo実装の`gqlparser`でも**CVE-2023-49559**（CVSS 5.3、ディレクティブ数の制限漏れ）として確認されている。

**その他の確認済みDoS系CVE**（年表は後述の表にまとめる）として、graphql-java（Java）の**CVE-2023-28867**は深いネストクエリでJVMのスタックオーバーフローを起こし、graphql-js（npm、JavaScript/TypeScript実装）の**CVE-2023-26144**はフィールドマージ検証ルール（`OverlappingFieldsCanBeMergedRule`）の計算量爆発によりリソースを消費した。さらに新しい例として、.NET実装Hot Chocolateの**CVE-2026-40324**（Critical）は約40KBのクエリ文字列だけでパーサのスタックオーバーフローを引き起こし、.NET特有の「キャッチ不能な`StackOverflowException`」によりプロセスごとクラッシュする点が深刻とされる。Apollo Router（Rust製GraphQLゲートウェイ）の**CVE-2025-32032**は再帰的なフラグメント展開でスレッドプールを枯渇させるもので、1.61.2未満／2.1.1未満が対象である。

```bash
# エイリアス大量生成によるDoSの検証例（防御設計の理解のための例示であり、
# 許可されたテスト環境以外で実行してはならない）
curl -X POST -H "Content-Type: application/json" \
  -d '{"query": "{ alias0:__typename alias1:__typename ... alias99:__typename }"}' \
  'https://example.com/graphql'
```

このリクエストは`__typename`という軽量フィールドを数百のエイリアスで並べるだけで、パーサ・バリデータ・実行エンジンのそれぞれに負荷をかける。1フィールドあたりのコストは小さくても、数を線形に増やすだけでサーバー側の処理は比例して重くなり、深いネストと組み合わせるとその負荷は掛け算的に増幅する。

GitLab GraphQL API（v12.4〜18.11.0）でも**CVE-2025-3922**（CWE-770: 無制限リソース消費）が報告されており、GraphQL特有のDoSが特定製品固有の実装バグではなく「仕様上クエリの形を制限しないと防げない」構造的な問題であることを裏付けている。セキュリティ企業Escapeによる2024年の調査では、走査対象エンドポイントの69%がこの種のDoSに脆弱だったと報告されている。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks
> 出典: HackTricks — GraphQL（GitHub原本） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md
> 出典: DeepStrike — GraphQL: How It Works, Why It Beats REST, & Security Risks — https://deepstrike.io/blog/graphql-api-vulnerabilities-and-common-attacks

**防御**: クエリの最大深さ（depth limit）・最大複雑度（complexity score）・最大エイリアス数・最大ディレクティブ数を静的に制限する。`graphql-armor`のようなミドルウェアを使えば、これらの上限をまとめて適用できる。

```typescript
import { protect } from '@escape.tech/graphql-armor';
const protectedSchema = applyMiddleware(schema, ...protect());
```

さらに`@defer`・`@stream`のようなインクリメンタル配信ディレクティブ（レスポンスを複数チャンクに分割して段階的に返す仕組み）も、チャンク数に上限を設けないと同種の増幅攻撃（1回のリクエストで数千のチャンクを生成させ、応答サイズを膨張させると同時にボディサイズベースのWAFルールを迂回する）に使われうる。

### 脆弱性クラス4: 認可バイパス（BOLA / BFLA / BOPLA）

GraphQLでは「認証はできているがリゾルバ単位の認可が漏れている」パターンが極めて多い。OWASP API Security Top 10（2023年版）の分類に沿って整理すると次の3種になる。

- **BOLA（Broken Object-Level Authorization、オブジェクトレベル認可の欠落）**: `user(id: "任意のID")`のように、他人のオブジェクトIDを指定しても所有者チェックが働かず閲覧・操作できてしまう。Shopifyの脆弱性報奨金プログラムで報告された事例（HackerOne #2207248、5,000ドルの報奨）では、`BillingDocumentDownload`や`BillDetails`といったクエリで権限のないユーザーが他社の請求書情報へアクセスできた。
- **BFLA（Broken Function-Level Authorization、機能レベル認可の欠落）**: 一般ユーザーが管理者専用のミューテーションを実行できてしまう。Hasura（**CVE-2022-46792**、v2.10.0〜v2.15.1）では「Update Many」APIがPostgresバックエンド利用時に行レベル認可を正しく適用せず、本来更新・取得できないはずの行を操作できた。
- **BOPLA（Broken Object Property-Level Authorization、プロパティレベル認可の欠落＝マスアサインメント）**: ミューテーションが`role`や`isAdmin`、`balance`のような本来クライアントが指定すべきでないフィールドをそのまま受け付けてしまい、権限昇格や残高改ざんにつながる。

```graphql
# 本来は非公開であるべきフィールドへの認可漏れの例
query {
  user(id: "1") {
    id
    name
    email
    passwordHash  # リゾルバ側でのフィールド単位アクセス制御が漏れている場合に露出する
  }
}
```

GraphQLでこの種の欠陥が起きやすい理由は、REST的な「エンドポイントごとにミドルウェアで認可をかける」発想のままGraphQLサーバーを構築すると、GraphQLは全てのクエリが単一エンドポイントを通るため「エンドポイント単位の認可」が実質機能せず、各リゾルバの中で個別に権限チェックを書き込む必要があるという実装モデルの違いにある。1つでもリゾルバに認可チェックを書き漏らすと、そのフィールド・ミューテーションだけが無防備になる。

また、クエリ内に無関係な操作を連結して認可チェックの単位（操作名のみを見るような雑なチェック）をすり抜ける手法もある。

```graphql
mutation {
  forgotPassword(email: "victim@test.com") { success }
  register(email: "attacker@test.com", password: "pass") { token }
}
```

サーバー側が「このリクエストの操作名は`forgotPassword`だから許可する」のようにトップレベルの操作名だけで判定していると、同時に埋め込んだ別の操作（この例では`register`）が検証をすり抜けて実行されてしまう。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks
> 出典: HackTricks — GraphQL（GitHub原本） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md
> 出典: DeepStrike — GraphQL: How It Works, Why It Beats REST, & Security Risks — https://deepstrike.io/blog/graphql-api-vulnerabilities-and-common-attacks

**防御**: 認可はリゾルバ単位（フィールド単位）で実装し、可能であればスキーマレベルのディレクティブ（`@auth`のようなカスタムディレクティブ）で宣言的に付与して書き漏れを防ぐ。操作名だけでなく、リクエスト内の全ての操作・フィールドに対して認可を適用する。

### 脆弱性クラス5: CSRF（クロスサイトリクエストフォージェリ）

GraphQLは基本的にPOSTリクエスト＋`application/json`ボディで送られる設計が推奨されるが、多くのサーバー実装は後方互換性や利便性のために`application/x-www-form-urlencoded`のような「シンプルなコンテンツタイプ」も受け付けてしまう。シンプルなコンテンツタイプで送られたクロスオリジンリクエストはブラウザのCORSプリフライト（実際のリクエスト前に許可を確認する事前送信）の対象にならないため、攻撃者が用意した外部サイトのHTMLフォームから、被害者のセッションクッキーを使ってGraphQLミューテーションを実行させられる。

```html
<form action="https://target.example/graphql" method="POST"
      enctype="application/x-www-form-urlencoded">
  <input name="query"
         value='mutation{updateProfile(username:"attacker"){id}}'>
</form>
<script>document.forms[0].submit()</script>
```

被害者が上記HTMLを踏むと、ブラウザは被害者のクッキーを自動付与してGraphQLエンドポイントにPOSTし、サーバーはCSRFトークンなどの追加検証がなければ正規のリクエストとして処理してしまう。

実例として、Apollo Server 2系（**GHSA-2p3c-p3qw-69r4**、2022年5月公表）では、ファイルアップロード機能`graphql-upload`が`multipart/form-data`リクエストをCSRF検証なしに受け付けており、バージョン2.0.0〜2.25.3が影響を受けた。これを受けてApollo Server 4以降は`csrfPrevention`をデフォルトで有効にし、単純なコンテンツタイプのリクエストには追加のプリフライト用ヘッダーを要求するよう仕様が変更された。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks
> 出典: HackTricks — GraphQL（GitHub原本） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md

**防御**: `application/json`以外のコンテンツタイプを拒否する、CSRFトークンを実装する、クッキーに`SameSite=Strict`（または`Lax`）を付与する、の三点を組み合わせる。

### 脆弱性クラス6: インジェクション（SQLi/NoSQLi/コマンド/SSRF）とその他の情報漏洩

GraphQLのリゾルバは最終的に何らかのバックエンド（RDB、NoSQL、ファイルシステム、外部HTTP API）へアクセスする。GraphQL自体は型システムを提供するが、リゾルバの実装が文字列連結でSQLを組み立てたり、ユーザー入力をそのままNoSQLのフィルタ演算子（`$where`や`$regex`など）に渡したりすれば、通常のREST APIと同様にSQLインジェクション・NoSQLインジェクションが成立する。同様に、URL引数を検証なしにサーバー内部からのHTTPリクエストに使えば**SSRF（Server-Side Request Forgery、サーバーに内部ネットワークへの不正なリクエストを代行させる攻撃）**が、シェルコマンドに渡せば**OSコマンドインジェクション**が成立する。反射型・保存型XSSも、クエリ結果や保存されたフィールド値をブラウザ側で未エスケープのままレンダリングすれば発生する。

さらにGraphQL固有の情報漏洩経路として、詳細すぎるエラーメッセージ（有効なフィールド名や内部の型情報を示唆する）、`extensions`フィールドでのトレーシング情報（実行時間やリゾルバ内部の処理順）の露出、本番環境に残されたGraphiQL/GraphQL Playgroundのようなデバッグ用IDE、GETリクエストでクエリを送信した場合にブラウザ履歴やプロキシログへPIIが残ることなどが挙げられる。

> 出典: DeepStrike — GraphQL: How It Works, Why It Beats REST, & Security Risks — https://deepstrike.io/blog/graphql-api-vulnerabilities-and-common-attacks
> 出典: Imperva — GraphQL API Vulnerabilities and Common Attacks — https://www.imperva.com/blog/graphql-vulnerabilities-common-attacks/

**防御**: パラメータ化クエリ（プレースホルダを使い、入力値をSQL文の一部として解釈させない実装）を徹底し、NoSQLでは演算子を許可リスト化する。本番ではデバッグIDE・詳細エラー・トレーシングを無効化し、GETでのクエリ送信を禁止してPOST＋JSONのみを受け付ける。

### 代表的CVE年表（2022〜2026年）

各脆弱性クラスの実例を時系列にまとめると、GraphQLの弱点が特定ベンダーに限らず、複数言語・複数実装にまたがって繰り返し現れていることが分かる。

| 時期 | CVE/GHSA | 対象 | 概要 |
|------|----------|------|------|
| 2022年5月 | GHSA-2p3c-p3qw-69r4 | Apollo Server 2（2.0.0〜2.25.3） | `graphql-upload`がmultipart/form-dataをCSRF検証なしに受理 |
| 2022年12月 | CVE-2022-46792 | Hasura v2.10.0〜v2.15.1 | Update ManyでのPostgres行レベル認可漏れ（BFLA） |
| 2023年3月 | CVE-2023-28867 | graphql-java | 深いネストクエリによるスタックオーバーフロー |
| 2023年9月 | CVE-2023-26144 | graphql-js（npm）16.3〜16.8 | フィールドマージ検証のリソース枯渇 |
| 2023年11月 | CVE-2023-47643 | SuiteCRM 8.4.2未満 | 未認証でのイントロスペクション有効 |
| 2023年12月 | CVE-2023-49559 | gqlparser（Go）2.5.14未満 | ディレクティブ数超過によるDoS（CVSS 5.3） |
| 2024年7月 | CVE-2024-39895 | Directus 10.12.0未満 | エイリアス／フィールド重複によるDoS（CVSS 6.5） |
| 2024年9月 | CVE-2024-47614 | async-graphql（Rust）7.0.10未満 | ディレクティブオーバーロードDoS |
| 2025年4月 | CVE-2025-3922 | GitLab GraphQL API v12.4〜18.11.0 | 無制限リソース消費（CWE-770） |
| 2025年4月 | CVE-2025-32032 | Apollo Router 1.61.2未満／2.1.1未満 | 再帰的フラグメント展開によるスレッドプール枯渇 |
| 2026年（Q1） | CVE-2026-40324 | Hot Chocolate（.NET）12.22.7未満、13〜15系 | 約40KBのクエリでパーサがスタックオーバーフロー（Critical） |

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

これらは公表時点でのバージョン・深刻度であり、各ライブラリ・製品を利用する際は必ず最新のアドバイザリを確認し、該当バージョンを使用している場合は速やかにパッチを適用すべきである（例: async-graphqlは7.0.10以降、graphql-javaは19.11以降、Apollo Gatewayは2.10.1以降でそれぞれ既知の脆弱性が修正されている）。

### エンドポイント検出とツール

GraphQLエンドポイントは慣習的なパス名を持つことが多く、次のようなパスがディレクトリブルートフォースの対象になる。

```
/graphql
/graphiql
/graphql.php
/api/graphql
/graphql/console
```

`graphw00f`はGraphQLサーバーの実装エンジン（Apollo Server、graphql-java、Hasuraなど）をフィンガープリントし、既知の脆弱性に対応付けるツールである。InQLはBurp Suite統合のGraphQLテストツール、GraphQL Voyagerはスキーマを図として可視化するツール、Clairvoyanceは前述の通りイントロスペクション無効時の辞書ブルートフォースツールとして使われる。

> 出典: HackTricks — GraphQL（GitHub原本） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md
> 出典: DeepStrike — GraphQL: How It Works, Why It Beats REST, & Security Risks — https://deepstrike.io/blog/graphql-api-vulnerabilities-and-common-attacks

### 全体像のまとめ: なぜGraphQLはこれらの脆弱性を生みやすいのか

ここまで見た脆弱性クラスに共通するのは、いずれも「GraphQLという表現力の高いクエリ言語を、単一エンドポイント・単一HTTPリクエストという枠に押し込めたことで生じるミスマッチ」である。

- REST時代の境界防御（URLパスごとのWAF・レート制限）は、全操作が1つのURLに集約されるGraphQLでは粒度が粗すぎて機能しない → バッチング・エイリアス濫用によるレート制限バイパスやブルートフォース
- クエリの「形」を自由に組み立てられる柔軟性が、そのままパーサ・実行エンジンへの負荷を無制限に増幅する手段になる → 深いネスト・循環フラグメント・ディレクティブオーバーロードによるDoS
- 「エンドポイントごとの認可」という発想のままリゾルバ単位の認可実装を怠ると、フィールド単位で穴が生まれる → BOLA/BFLA/BOPLA
- 開発時の利便性（イントロスペクション、詳細エラー、デバッグIDE）が本番に残ると、そのまま攻撃者への地図になる → スキーマ漏洩・情報開示

業界調査では、GraphQLの採用率は2025年時点で組織の約70%（Wallarm 2025調査）、API全体の約33%（Postman 2025 State of API）に達しており、採用の広がりとともに攻撃対象領域も拡大している。Akamaiの集計では2023年1月〜2024年12月の間に約1,500億件のAPI攻撃が観測され、Escapeの2024年調査では公開GraphQLエンドポイント160件のうち13,720件の問題（うち4,527件がクリティカル）が発見されたと報告されている。これらの数字は、GraphQL固有の脆弱性が理論上の懸念ではなく、実運用環境で日常的に悪用されていることを裏付けている。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks
> 出典: Imperva — GraphQL API Vulnerabilities and Common Attacks — https://www.imperva.com/blog/graphql-vulnerabilities-common-attacks/

次節以降では、これらの脆弱性クラスをそれぞれ掘り下げ、実際にどのように検出し、どのように防御を実装するかを、許可されたテスト環境を前提とした手順とともに解説していく。


---

[📖 目次](index.md) ・ [第2章 Recon と introspection →](02-recon-introspection.md)
