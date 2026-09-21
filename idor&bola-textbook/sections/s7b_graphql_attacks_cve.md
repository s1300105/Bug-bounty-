## GraphQL攻撃面とCVE集

REST APIでは「1つのURL = 1つのリソース」という素朴な対応関係があるため、アクセス制御の検査ポイントも比較的わかりやすい。ところがGraphQLは「1つのエンドポイント（多くは`/graphql`）に対して、クライアントがクエリ言語で必要なフィールドを自由に組み立てて要求する」というモデルを採る。この柔軟さが、IDOR/BOLA（オブジェクト単位の認可欠落）やBFLA（機能単位の認可欠落）にとって独特の攻撃面を生む。本節では、GraphQL特有の攻撃面を仕組みレベルで整理し、実際に修正された3件のCVE/報奨金事例（Shopify IDOR、Hasura CVE-2022-46792、Directus CVE-2024-39895）を通じて、なぜ認可が壊れるのか・どう多層で守るのかを解説する。

> 本節は防御目的の解説である。実在サービスや本番環境への無許可検証、破壊的な操作は行わない。示すペイロードは、あなた自身が管理する検証環境や、意図的に脆弱に作られた学習用アプリでの理解のためのものである。

まず用語を確認する。**resolver（リゾルバ）** とは、GraphQLスキーマの各フィールドに紐づく「そのフィールドの値を実際に計算・取得する関数」である。たとえば`user(id: 2){ email }`というクエリなら、`user`フィールドのリゾルバがIDを受け取ってDBを引き、`email`フィールドのリゾルバがそのユーザオブジェクトからメールを返す。**認可（authorization）が正しく効くかどうかは、このリゾルバの中でチェックしているか否かにかかっている**。GraphQLフレームワークは「認証されているか（誰であるか）」は面倒を見てくれても、「このユーザがこのオブジェクトを見てよいか」までは自動では守ってくれない。ここがGraphQLにおけるIDOR/BOLAの根本原因である。

### GraphQLの攻撃面を体系的に理解する

#### エンドポイント列挙と発見（Discovery）

攻撃の起点は「そもそもGraphQLエンドポイントがどこにあるか」の特定である。GraphQLは規約上どのパスに置いてもよいため、防御側は「意図せず公開されている管理用・旧版エンドポイント」を把握しておく必要がある。よく試されるパスは次の通り。

```
/graphql, /api/graphql, /v1/graphql, /v2/graphql
/graphiql, /playground, /console, /explorer, /altair
/graphql.php, /query
```

SecListsの`Discovery/Web-Content/graphql.txt`や、Escape Technologiesの`graphql-wordlist`がワードリストとして知られる。防御の観点で重要なのは、**旧バージョンの`/v1/graphql`だけ認可が甘い、`/graphql/system`のような内部管理スキーマが外部から叩ける、といった「複数エンドポイントの認可レベル不揃い」を作らないこと**である（後述のDirectus CVEはまさに`/graphql`と`/graphql/system`の両方が対象だった）。

エンドポイントがGraphQLを処理しているかの「万能プローブ」は次の1行である。

```graphql
query { __typename }
```

`__typename`は任意の型に必ず存在するメタフィールドで、正常なGraphQLサーバなら`{"data":{"__typename":"Query"}}`のように応答する。これで「ここはGraphQLだ」と確定できる。

さらに、フィルタやWAFを回避する目的で、次のような**トランスポート（送信方法）のバリエーション**が試される。防御側はこれらすべての経路で同じ認可・入力検証が効くことを確認すべきである。

- `GET /graphql?query=...`（GETパラメータ経由。CSRF可能性やキャッシュ汚染の温床）
- `Content-Type: application/x-www-form-urlencoded`のPOSTボディ
- `Content-Type: application/graphql`（生のクエリ本文）
- WebSocket接続（サブプロトコル`graphql-ws`。Subscription用）

> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

#### イントロスペクションとスキーマ復元

**イントロスペクション（introspection）** は、GraphQL自身が持つ「スキーマ（どんなクエリ・ミューテーション・型・フィールドがあるか）を問い合わせる仕組み」である。開発には便利だが、有効なままだとAPIの全構造を攻撃者に開示してしまう。全スキーマ抽出クエリの例。

```graphql
{ __schema { types { name fields { name args { name type { name kind } } } } } }
```

問題は、イントロスペクションを「ブロックしたつもり」でも回避されうる点である。多くの実装は`__schema`という文字列をナイーブにフィルタしているだけなので、次のような回避が効く。

- 空白・改行の挿入: `__schema\n{...}`（トークナイズ後は同一だが、素朴な文字列マッチをすり抜ける）
- コメント挿入: `__schema #comment\n{...}`
- POSTを禁じられていてもGETで送る、あるいはWebSocketで送る
- バッチ配列でラップする

イントロスペクションを完全に無効化しても、スキーマは**間接的に**漏れる。ここが重要な原理である。

- **フィールドサジェスト（Did you mean）**: 綴りを間違えると「Did you mean 'email'?」のようなエラーが返り、正しいフィールド名・型名が漏れる。
- **エラーオラクル**: 型不一致エラーが引数のシグネチャを露出する。
- **Clairvoyance**: サジェスト機能をワードリストで総当たりし、スキーマを再構成する手法。
- **パッシブ観測**: GraphQuailのような拡張が、正規クライアントの通信からスキーマを学習する。

したがって防御は「イントロスペクション無効化」だけでは不十分で、**本番ではフィールドサジェストとエラー詳細（error masking）も抑制する**必要がある。エンジンの指紋採取には`graphw00f`やInQL v6.1+が使われ、エラー署名や不正クエリへの応答からバックエンド実装を推定する。

> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

#### 影響の連続スペクトラム（Impact Spectrum）

chs.usのガイドは、GraphQLの被害が単独ではなく連鎖的に深刻化する「スペクトラム」として整理している。本節のテーマであるアクセス制御欠落は、この連鎖の入口に位置する。

> 情報漏洩（スキーマ・PII）→ 認可バイパス（IDOR/BOLA/BFLA）→ 認証回避 → インジェクション（SQL/NoSQL/OS）→ SSRF → サービス妨害（DoS）→ RCE

つまり、まずイントロスペクション等で構造を知り、次に認可欠落で他人のデータへ横移動し、さらにインジェクションやSSRFで深部へ進む、という段階的な悪化が典型である。

> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

### GraphQL特有の認可欠落: BOLA と BFLA

Impervaの解説は、GraphQLの壊れた認可を2種類に分けている。この区別はOWASP API Security Top 10に対応しており、IDOR/BOLAの本質を捉えるうえで重要である。

**BOLA（Broken Object Level Authorization、オブジェクト単位の認可欠落）** は、リソース（オブジェクト）単位の認可検証が欠けている状態。IDを差し替えるだけで他人のオブジェクトが読める、いわゆるIDORそのものである。

```graphql
{
  user(id: "2") {
    name
    email
    ssn
  }
}
```

このクエリで、ログイン中のユーザが自分（例: id=1）以外の`id: "2"`を指定しても機微情報（SSN）が返るなら、`user`リゾルバが「呼び出し元がこのオブジェクトの所有者か」を検証していない。原理としては、リゾルバがIDを受け取ってそのままDBの主キー検索に渡し、**行の所有者チェックを挟んでいない**ことが原因である。

**BFLA（Broken Function Level Authorization、機能単位の認可欠落）** は、操作（クエリ/ミューテーション）そのものを実行してよい権限があるかの検証が欠けている状態。特定のロールしか使えないはずの操作を、非特権ユーザが呼べてしまう。

```graphql
{
  allUsers {
    id
    name
    salary
  }
}
```

`allUsers`のような「管理者向けの全件取得」を一般ユーザが実行できてしまえばBFLAである。GraphQLでは1つのエンドポイントに管理用フィールドと一般用フィールドが同居しがちで、「フィールド単位で誰が呼べるか」を宣言的に管理しないと、権限の穴が生まれやすい。

Impervaが挙げる防御は次の通り。BOLAには「業務ロジック内で適切な認可チェックを行い、リソースアクセス前に権限を検証する」。BFLAには「フィールド単位のきめ細かなアクセス制御」「最小権限の原則」「認可検証のためのスキーマディレクティブ利用」。

> 出典: Imperva — GraphQL Vulnerabilities and Common Attacks — https://www.imperva.com/blog/graphql-vulnerabilities-common-attacks/

#### マスアサインメント（Mass Assignment）による権限昇格

認可欠落と隣接する重要な問題がマスアサインメントである。ミューテーションが、クライアントが指定すべきでない特権フィールド（`role`など）を無検証で受け入れると、自己昇格が起きる。

```graphql
mutation {
  registerAccount(role:"ADMIN", email:"x@x", password:"x") {
    token { accessToken }
  }
}
```

`role`はサーバ側で固定すべきなのに入力として受理されるため、一般登録フローで管理者アカウントが作れてしまう。防御は「入力型を明示的に定義し、権限に関わるフィールドをクライアント入力から排除する（サーバ側で強制設定する）」ことである。

> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

### エイリアスとバッチングによる増幅攻撃

GraphQL特有で、かつIDOR/認証攻撃を実務レベルで危険にするのが**エイリアス濫用**と**バッチング**である。両者は「1回のHTTPリクエストで多数の操作を実行させる」ことでレート制限を回避する。

#### エイリアス濫用（Alias Overloading / Amplification）

**エイリアス（alias）** は、同じフィールドを異なる名前・異なる引数で1クエリ内に複数書ける機能である。本来は「同じ`user`を複数ID分まとめて取る」ような正当用途だが、認証ブルートフォースに悪用できる。

```graphql
mutation {
  a1:login(u:"bob",p:"0000"){token}
  a2:login(u:"bob",p:"0001"){token}
  a3:login(u:"bob",p:"0002"){token}
  # ... N件
}
```

なぜ危険か。多くのレート制限は「HTTPリクエスト数」で数える。ところがこの1リクエストの中に何千ものログイン試行を詰め込めるため、**HTTP単位のレート制限を丸ごと回避してパスワード総当たりができる**。同様に、`getUser(id:"1")`を数千個のエイリアスで並べればDoSにもなる。

```graphql
{
  alias1: getUser(id: "1") { name }
  alias2: getUser(id: "1") { name }
  alias3: getUser(id: "1") { name }
}
```

防御は「エイリアス数の上限（例: 1クエリあたり5〜10）」「リクエストボディ長の制限」「操作名＋トークン単位のレート制限（HTTP単位ではなく）」。

#### JSON配列バッチング

もう一つの増幅がバッチングである。多くのGraphQLサーバは**JSON配列で複数クエリを1リクエストにまとめる**ことを許す。バックエンドはそれらを順次（あるいは並行して）処理する。

```json
[
  {"query":"mutation{login(u:\"bob\",p:\"0000\"){token}}"},
  {"query":"mutation{login(u:\"bob\",p:\"0001\"){token}}"}
]
```

エイリアスと同様、1つのネットワーク呼び出しが大量のクエリ実行に化けるため、CPU/メモリを枯渇させ、レート制限を回避し、認証ブルートフォースを可能にする。防御は「バッチングを無効化するか、リクエストあたりのクエリ数に妥当な上限を設ける」。

> 出典: Imperva — GraphQL Vulnerabilities and Common Attacks — https://www.imperva.com/blog/graphql-vulnerabilities-common-attacks/ ／ 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

#### その他のDoSベクタ（原理を押さえる）

- **フィールド重複**: `{ user(id:"1"){ name name email email } }`。レスポンスでは重複排除されても、サーバ側で再計算が走る実装がある。
- **ディレクティブ濫用**: `{ email @foo @bar @baz @custom1 @custom2 }`。存在しないディレクティブでもパース・処理コストがかかる（後述CVE-2024-47614の類型）。
- **循環クエリ**: `user → friends → friends → ...`と相互参照する型を深くたどると、計算量が指数的に増える。GraphQL Voyagerでスキーマの相互参照を可視化し、**深さ制限（depth limiting、目安で最大10程度）** を入れるのが定石。
- **循環フラグメント**: `fragment X{...Y} fragment Y{...X}`のように互いを参照させると無限ループになりうる。健全な実装は再帰フラグメントを拒否する。
- **ページネーション濫用**: `friends(first: 10000)`のように上限を無視した大量取得。`first/last/before/after`を検証し厳格な上限を課す。

### CSRFとWebSocketのリスク

GraphQLが`application/x-www-form-urlencoded`やGETパラメータを受理する構成だと、**カスタムヘッダを必須としていない限り、クロスサイトからミューテーションを実行するCSRFが成立**する。REST同様、GraphQLでもCookieセッションに依存し、かつCSRF対策ヘッダや`SameSite`が無いと、他サイトから状態変更操作を誘発できる。

Subscription（WebSocket）には**CSWSH（Cross-Site WebSocket Hijacking）** がある。WebSocketハンドシェイクはCookieを自動送信するが、Originの検証を怠ると、攻撃者ページが被害者のSubscriptionストリーム（リアルタイムに流れる機微データ）を受信できてしまう。防御は「WebSocketのOrigin検証」「CSRF対策ヘッダの必須化」。

> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

### 実例CVE/報奨金: 3つの柱

以下の3件は、GraphQL攻撃の3本柱――**認可の穴（Shopify）／権限の不整合（Hasura）／リソース枯渇のレート制限回避（Directus）** ――をそれぞれ体現する。いずれも共通する重要な教訓があり、**3件ともイントロスペクション不要で、いずれも「既定で有効」または「正規クライアントが依存する」機能を悪用した**。つまり、機能を無効化するのではなく、多層で制御を重ねることが解決策である。

#### Shopify — HackerOne #2207248（BOLA/IDOR、報奨金 $5,000、2024年5月）

- **脆弱性クラス**: Broken Object-Level Authorization（OWASP API1:2023、いわゆるIDOR）
- **内容**: あるShopifyショップで限定的な権限しか持たないスタッフが、`BillingInvoice`のIDパラメータを差し替えることで、**別のショップの請求書（billing document）** を取得できた。
- **対象クエリ**: `BillingDocumentDownload`、`BillDetails`
- **仕組み**: GraphQLリゾルバは`id`引数を受け取るが、**機微な請求データを返す前に「所有権（ownership）」を検証していなかった**。権限を絞られたスタッフトークンでも、ID値を列挙すれば認可されていない財務記録にアクセスできた。
- **影響**: 「あるショップの限定権限スタッフが、IDパラメータを変えるだけで他ショップの請求書をクエリできた」。テナント（店舗）境界を越えた機微データ漏洩。
- **防御**: リゾルバ内でフィールド単位の認可チェックを行い、**データを返す前に「クエリしたオブジェクトを本当にそのユーザが所有・アクセス可能か」を検証する**。

この事例の教訓は明快で、GraphQLだからといって特別なことは要らない一方、「エンドポイントが1つ・フィールドが多数」ゆえに**各リゾルバで所有権チェックを漏らさない規律**が決定的だ、という点である。

> 出典: GraphQL API Vulnerabilities and Common Attacks（stingrai.io） — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

#### Hasura — CVE-2022-46792（BFLA / 行レベル認可バイパス）

- **識別子**: CVE-2022-46792 ／ GHSA-g7mj-g7f4-hgrg
- **脆弱性クラス**: Broken Function-Level Authorization（OWASP API5:2023）
- **対象コンポーネント**: Hasura GraphQL Engine の **Update Many API**（複数行一括更新、Postgresバックエンド）
- **影響バージョン**: v2.10.0 〜 v2.15.1
- **修正バージョン**: v2.15.2（およびv2.10〜v2.14系へのバックポート）
- **仕組み**: Update Many APIが**行レベル認可（row-level authorization）のチェックを取り違えていた**。原典の記述によれば「ユーザは、対象テーブル内の任意の行に対し、自分が更新権限を持つ任意のカラムを更新でき、その結果、影響を受けた行から自分がselect権限を持つ任意のカラムを取得できた」。
- **原理**: 一括更新の際に、update権限とselect権限の**認可境界（authorization boundary）が破綻**した。本来は「更新してよい行の範囲」と「読んでよい行の範囲」を各行で一貫して評価すべきところ、bulk update中にこの一貫性が崩れ、更新をトリガーにして本来読めない行の値まで返してしまった。
- **影響**: マルチテナントでのテナント越えデータ露出、カラム改変による権限昇格。PostgresバックエンドのSaaS運用でクリティカル。
- **防御**: 直ちにパッチ適用。Hasura設定の行レベルセキュリティ（RLS）ポリシー監査。**updateとselectの認可境界を別々にテストする**。ミューテーションと行の両レベルで認可を重ねる。

この事例は、「認証はしている・権限テーブルもある」のに、**複合操作（更新→取得）で権限評価が食い違うと認可が崩れる**というBFLAの厄介さを示す。単純なIDORより検出が難しく、権限の交差（update×select）をテストで潰す必要がある。

> 出典: GraphQL API Vulnerabilities and Common Attacks（stingrai.io） — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

#### Directus — CVE-2024-39895（エイリアス濫用によるバッチングDoS）

- **識別子**: CVE-2024-39895
- **脆弱性クラス**: クエリバッチングによるレート制限バイパス（OWASP API4:2023、Unrestricted Resource Consumption）
- **深刻度**: CVSS 6.5（Medium）
- **影響バージョン**: 10.12.0より前
- **対象エンドポイント**: `/graphql`、`/graphql/system`
- **内容**: 「Directusのアリアス機能で、単一リクエスト内のリゾルバ呼び出しを重複排除しなかったため、認証済み攻撃者はエイリアスを通じて高コストのリレーショナルクエリを1リクエスト内で何度も繰り返せた」。
- **攻撃ペイロード例**:

```graphql
query BatchRead {
  alias1: users(id: "1") { posts { author { name } } }
  alias2: users(id: "1") { posts { author { name } } }
  alias3: users(id: "1") { posts { author { name } } }
  # ... N件繰り返し
}
```

- **仕組み**: エイリアスで書いた各フィールドが、**バッチングや重複排除なしに独立したDBクエリを発火**した。1つのHTTPリクエストが数百の並行クエリを生む。
- **影響**: 「読み取り専用の最小権限しか持たない認証ユーザでも本条件を引き起こせた。サーバは多数の独立した複雑DBクエリを並行実行させられ、エイリアス数に**線形**にDB負荷が増大した」。
- **防御**: 10.12.0以降へ更新。サーバ側でエイリアス数上限（1クエリあたり5〜10）。**DataLoader**を導入して繰り返しフィールド解決を1回のDB呼び出しにまとめる。HTTP単位ではなく「操作名＋トークン」でレート制限。エイリアス数とDBコネクションプールの異常監視。

ここで登場する**DataLoader（データローダ）** とは、同一リクエスト内で発生する重複・類似のDB取得をまとめて（バッチして）1回のクエリにし、結果をキャッシュする仕組みである。N+1問題の緩和策として知られるが、本CVEのようなエイリアス増幅の緩和にも効く。ただしDataLoaderは「重複排除」の性質上、認可チェックを飛ばす実装にならないよう注意が必要である（キャッシュヒットでも所有権チェックは各呼び出しで効かせる）。

> 出典: GraphQL API Vulnerabilities and Common Attacks（stingrai.io） — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

> なお、ディレクティブ濫用系のDoSとして **CVE-2024-47614**（ディレクティブの繰り返しによる資源枯渇）も同時期に知られる。エイリアス／バッチング／ディレクティブは「1リクエストで処理量を増幅する」同系統の攻撃面である。
>
> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

### 多層防御（Layered Defense）: どこで何を止めるか

3件のCVEが示す通り、GraphQLの防御は単一の対策では足りず、**パーサ → バリデータ → リゾルバ → データストア → 監視**の各層に制御を重ねるのが要諦である。stingrai.ioの整理を軸にまとめる。

| 層 | 制御 | 具体例 |
|---|---|---|
| **パーサ（Parser）** | エイリアス数上限・トークン数上限・再帰深さ | 実行前にエイリアスを5〜10に制限（Directus対策） |
| **バリデータ（Validator）** | クエリ複雑度分析・永続化クエリ許可リスト | コスト予算を超えるクエリを拒否 |
| **リゾルバ（Resolver）** | DataLoderバッチング・所有権チェック | 重複読取を集約しつつ、各呼び出しで所有権を検証（Shopify/Hasura対策） |
| **データストア（Datastore）** | 行レベルセキュリティ・クエリタイムアウト | テナント単位フィルタをDBで強制（Hasura対策） |
| **監視（Observability）** | エイリアス数メトリクス・スロークエリ警報 | エイリアス100超のリクエストを要調査としてフラグ |

設計時（design-time）の原則としては、**リゾルバ単位の認可チェックを無条件で入れる／自由形式JSONより型付きスカラ・enumを使う（マスアサインメント防止）／内部スキーマと外部スキーマを分離する**。運用時（runtime）は、**本番でイントロスペクションとフィールドサジェストを無効化／深さ・複雑度・リスト件数に上限／ユーザ単位のコスト予算／操作単位のレート制限／機微ミューテーションではバッチングとエイリアスを制限／CSRFヘッダ必須化とWebSocket Origin検証／エラーマスキング**。

検知シグナルとしては、「大きなリクエストボディ」「繰り返されるエラー」「`__schema`アクセス試行」「5個超のバッチ配列」「高いエイリアス数」「認可のないSubscription」が挙げられる。

> 出典: GraphQL API Vulnerabilities and Common Attacks（stingrai.io） — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks ／ 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

### まとめ

GraphQLにおけるIDOR/BOLA・BFLAの本質は、「単一エンドポイントに多数のフィールドが同居し、認可はフレームワーク任せにできず各リゾルバで明示的に守るしかない」という構造にある。Shopifyの事例は所有権チェックの欠落（BOLA/IDOR）、Hasura CVE-2022-46792はupdateとselectの認可境界の破綻（BFLA/行レベル）、Directus CVE-2024-39895はエイリアスによる処理増幅でレート制限を回避するリソース枯渇を、それぞれ具体的に示した。3件に共通するのは、いずれもイントロスペクション不要・既定機能の悪用という点であり、対策は機能の全面停止ではなく、パーサからデータストア・監視まで**多層で認可と資源消費を制御する**ことである。次章以降で扱う一般的なIDOR対策（所有権検証・不可推測な識別子・集中認可）は、GraphQLでも各リゾルバに落とし込む形でそのまま活きる。
