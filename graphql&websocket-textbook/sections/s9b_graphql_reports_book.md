## H1報告集と書籍 Black Hat GraphQL の開示脆弱性章

本節では、実際に企業へ報告・修正された脆弱性の一次資料を2系統読み解く。1つはHackerOne上の公開レポートを種別ごとに集約した`reddelexc/hackerone-reports`リポジトリ、もう1つはGraphQLセキュリティ専門書『Black Hat GraphQL』第10章「Disclosed Vulnerabilities and Exploits（開示された脆弱性とエクスプロイト）」である。どちらも「教科書的な脆弱性の定義」だけでは見えてこない、実運用のGraphQL/WebSocket APIで実際に何が悪用されたか、企業側がどう修正したかという生きた事例集であり、レポートを読む力（技術的深度の評価、影響範囲の見極め、報奨額の相場観）そのものを鍛える教材になる。

### reddelexc/hackerone-reports ― バグ種別別H1報告まとめ

このリポジトリは、HackerOne上で一般公開された脆弱性レポートを脆弱性クラス（XSS、IDOR、SSRF、GraphQLなど）ごとにアップボート数順で並べたインデックス集である。指定資料の`docs/tops_by_bug_type/TOPACCOUNTTAKEOVER.md`（アカウント乗っ取り種別のトップレポート集）を取得したところ、上位エントリはセッションCookie漏洩、パスワードリセットの不備、HTTPリクエストスマグリングによるセッション奪取、CSRFなど一般的な認証周りの不備が中心で、GraphQLやWebSocketを明示的なトリガーとするレポートは含まれていなかった。ただしこのうち3位の「Slackのslackb.comにおけるHTTPリクエストスマグリングを用いた大量アカウント乗っ取り」は、WebSocketアップグレード前のHTTPハンドシェイク段階をスマグリングで細工しセッションCookieを奪う手口であり、WebSocket接続確立の前段（Upgradeリクエスト）がプロキシ層のパース不整合に弱いという教訓として関連付けられる。

より直接的にGraphQL/WebSocketに関係するのは、同リポジトリが別ファイルとして持つ`docs/tops_by_bug_type/TOPGRAPHQL.md`（GraphQL種別のトップレポート集）である。この一覧から、本教科書の他章と接続する実例をいくつか拾っておく。

- **`GraphQL introspection query works through unauthenticated WebSocket`（Nuriへの報告、17アップボート、報奨$0）** — WebSocketトランスポート経由でGraphQLのintrospection（スキーマ自己開示クエリ）が未認証のまま実行できてしまった事例。これは後述するBlack Hat GraphQL第10章の「Accessing the Introspection Query via WebSocket (Nuri)」と同一のHackerOneレポート（`hackerone.com/reports/862835`）であり、書籍側でより詳細な技術解説がなされている。
- **`Unauthenticated RCE in Taskcluster web-server via GraphQL filter argument (sift $where)`（Mozillaへの報告、331アップボート、報奨$12,000）** — GraphQLのフィルタ引数にMongoDBクエリライブラリ`sift`の`$where`演算子（任意JavaScript式を評価できる危険なオペレータ）がそのまま渡され、サーバーサイドJavaScriptインジェクションからRCEに到達した事例。GraphQLの「柔軟な引数設計」がNoSQLクエリビルダのブラックリスト漏れと組み合わさると致命傷になる典型例。
- **`DOS via Mutation Aliasing in GraphQL Account Recovery Phone Number Verification API`（HackerOneへの報告、180アップボート、報奨$12,500）** — GraphQLのエイリアス機能（1リクエスト内で同一フィールドを複数回呼び出す構文）を悪用し、電話番号確認APIへの検証試行をエイリアスで水増しして大量に送りつけるDoS/ブルートフォース。エイリアスによるフィールド重複は本節後半のMagento事例（Black Hat GraphQL）とも共通する攻撃パターンである。
- **`Bypass GraphQL rate limit by abusing negative cost queries`（Shopifyへの報告、24アップボート、報奨$0）** — クエリコスト計算（フィールドごとにコストを加算してレート制限に使う仕組み）において、負のコストを持つフィールドを混在させることでリクエスト全体のコストを相殺し、レート制限をすり抜けた事例。コストベースのDoS対策自体にロジック不備があると防御が無力化される点を示す。
- **`Insufficient Type Check on GraphQL leading to Maintainer delete repository`（GitLabへの報告、18アップボート、報奨$4,000）** — GraphQLミューテーションの入力型チェック不足により、本来削除権限を持たないロールのユーザーがリポジトリ削除ミューテーションを実行できた認可バイパス。

これらのレポートに共通するのは、GraphQLの「1エンドポイント・柔軟なクエリ言語」という設計そのものが、DoS・認可制御・インジェクションという既存の脆弱性クラスを新しい形で再発させているという点である。個々の技術詳細は次項のBlack Hat GraphQL第10章でさらに深く解説される。

> 出典: reddelexc/hackerone-reports — Top Account Takeover reports / Top GraphQL reports — https://github.com/reddelexc/hackerone-reports/blob/master/tops_by_bug_type/TOPACCOUNTTAKEOVER.md ／ https://github.com/reddelexc/hackerone-reports/blob/master/docs/tops_by_bug_type/TOPGRAPHQL.md

（補足: 指定URLはリポジトリ再編前の旧パス`tops_by_bug_type/TOPACCOUNTTAKEOVER.md`を指していたが、現行リポジトリでは`docs/tops_by_bug_type/`配下に移動している。上記は現行パスから取得した実データである。）

### 書籍 Black Hat GraphQL 第10章「Disclosed Vulnerabilities and Exploits」

『Black Hat GraphQL: Attacking Next Generation APIs』（Nick Aleks、Dolev Farhi著、No Starch Press刊、2023年）は、GraphQL API攻撃をラボ演習形式で体系的に扱う実践書である。全10章構成で、第1〜4章がGraphQLの基礎とラボ構築・攻撃対象領域・偵察、第5〜9章がDoS・情報漏洩・認証認可バイパス・インジェクション・リクエスト偽装（CSRF/SSRF/CSWSH）を扱い、最終第10章「Disclosed Vulnerabilities and Exploits」は、それまでの各章で学んだ攻撃手法が実際の企業でどう発現したかを、公開されたHackerOneレポートやCVEをベースに再構成して解説する章である。著者自身が発見・報告した脆弱性（WPGraphQL、Magento、Agoo）も含まれており、単なるレポートの要約ではなく攻撃コードの動作原理まで踏み込んでいる点が特徴。章は「Denial of Service」「Broken Authorization」「Information Disclosure」「Injection」の4節構成で、各節末に簡潔な学びが添えられる。

#### Denial of Service節

**A Large Payload (HackerOne, 2020年5月)** — HackerOne自身のGraphQL APIに対する報告。ドキュメント上は文字数制限があるはずのクエリ入力が実際には制限されていなかった。攻撃者はPythonスクリプトで15,000文字の文字列を作り、それを`CreateStructuredScope`ミューテーションの`instruction`引数に10回埋め込む（＝1リクエストあたり150,000文字）操作を50回送信した。

```graphql
mutation ($eligible_for_submission: Boolean, $instruction: String) {
  createStructuredScope(input: {eligible_for_submission: $eligible_for_submission,
    instruction: $instruction}) {
    # ...
  }
}
```

なぜ効くのか: GraphQLサーバーは受け取った文字列引数をそのままバリデーション（パース→型検証→リゾルバ実行）のパイプラインに流す。文字数上限のチェックがドキュメントにしか存在せず実装側に無ければ、巨大な文字列がリゾルバ内部の文字列処理・DB書き込みに渡り、CPU/メモリ消費が跳ね上がる。結果としてサーバーが`500`/`502`/`504`を返すようになった。報奨金は$2,500。DoSはサーバーを完全停止させなくても、応答遅延という形の可用性劣化だけで十分にインパクトとして評価される、という教訓が明示されている。

**Regular Expressions ReDoS (CS Money, 2020年10月)** — GraphQLの`search`フィールドが受け取る`q`引数がサーバー内部の正規表現マッチングにそのまま使われていた事例。攻撃者はまずUnicodeヌルバイト（`\u0000`）を送り、エラーメッセージに`(?=.*\u0000) must not contain null bytes`という文字列が含まれることから、入力が`(?=.*...)`という先読み構文を伴う正規表現に組み込まれていることを推測した。さらにレスポンスの`extensions.tracing`（GraphQLサーバーが提供するクエリ実行時間などのデバッグ用メタデータ）から処理時間が読み取れる状態だったため、正規表現の負荷を数値で検証できた。

```graphql
query {
  search(q: "[a-zA-Z0-9]+\\s?)+$|^([a-zA-Z0-9.'\\w\\W]+\\s?)+$\\", lang: "en") {
    # ...
  }
}
```

なぜ効くのか: `(a+)+`のようなネストした量指定子を持つ正規表現は、バックトラッキング型の正規表現エンジン（Perl互換の多くの実装）において、マッチ失敗時に指数関数的な組み合わせを試行してしまう（catastrophic backtracking）。このパターンを100回連続で送るだけでサーバーが完全停止した。GraphQLに限らずREST/SOAPでも起こりうるが、拡張フィールドで処理時間を返す親切設計がサイドチャネルとして悪用された点がGraphQL特有の教訓。報奨金は$250。

**A Circular Introspection Query (GitLab, 2019年7月)** — GraphQLのintrospection（スキーマ自己記述クエリ）が持つ`types`→`fields`→`type`→`fields`…という循環参照可能な構造を悪用したDoS。

```graphql
query {
  __schema {
    types {
      fields {
        type {
          fields {
            type {
              # ネストを再帰的に継続
            }
          }
        }
      }
    }
  }
}
```

なぜ効くのか: GitLabはクエリ複雑度チェック（クエリのネスト段数やフィールド数からコストを見積もり閾値超えを拒否する仕組み）を実装済みだったが、この制御が`__schema`のintrospectionクエリには適用されていなかった。introspectionは型システムの自己参照構造（型がフィールドを持ち、フィールドが型を返す）を持つため、意図的に深くネストさせるだけでスキーマ全体の組み合わせ爆発が起こる。未認証でも実行できたため深刻度が高い。対策はintrospection専用のクエリにも複雑度チェックを適用すること、または本番でintrospectionを無効化すること。

**Aliases for Field Duplication (Magento, 2021年4月)** — GraphQLのエイリアス構文（同一クエリ内で同じフィールドに別名を付けて複数回呼び出す機能）を使い、未認証のまま同一フィールドを数千回重複させてサーバー資源を枯渇させた。著者ら自身が発見。

```graphql
query {
  alias1: countries { full_name_english full_name_english /* 数千回 */ }
  alias2: countries { ... }
  alias3: countries { ... }
}
```

なぜ効くのか: GraphQLの仕様上、エイリアスは同名フィールドの衝突を避けるための正当な機能だが、フィールド数やクエリコストの上限が設定されていないと、この機能がそのままリクエスト水増しの手段になる。Magentoは修正としてクエリ複雑度（`queryComplexity: 300`）とクエリ深さ（`queryDepth: 20`）の上限をデフォルトで導入した。この数値は「1リクエストで許容する処理コストの総量」と「ネストの深さ」という2軸で制御する典型的なGraphQL DoS対策の実装例である。

**Array-Based Batching for Field Duplication (WPGraphQL, 2021年4月)** — WordPress用GraphQLプラグインWPGraphQLに対し、著者らが発見したDoS。バッチクエリ機能（1回のHTTPリクエストに複数のGraphQLクエリを配列で詰め込む仕様）とフィールド重複を組み合わせた。

```python
FORCE_MULTIPLIER = int(sys.argv[2])
CHAINED_REQUESTS = int(sys.argv[3])

payload = 'content \n comments { \n nodes { \n content } }' * FORCE_MULTIPLIER
query = {'query': 'query { \n posts { \n nodes { \n ' + payload + '} } }'}

queries = [query for _ in range(CHAINED_REQUESTS)]
r = requests.post(WORDPRESS_URL, json=queries)
```

なぜ効くのか: `FORCE_MULTIPLIER`でクエリ内のフィールド重複数を、`CHAINED_REQUESTS`でバッチ内のクエリ数を制御する。両者を掛け合わせた分だけサーバー負荷が増幅する。WPGraphQLは当時デフォルトで(1)配列ベースのバッチングを許可、(2)複雑度制限が緩い、(3)未認証アクセス可能なフィールドが多い、という3条件が重なっており、デフォルト設定のまま公開されたWordPressサイトが軒並み危険にさらされていた。

**Circular Fragments (Agoo, CVE-2022-30288, 2022年5月)** — Ruby製GraphQLサーバー実装Agooに著者らが発見した仕様非準拠のDoS。フラグメント（クエリの一部を再利用可能な単位として定義する構文）同士を相互参照させることで無限ループを作る。

```graphql
query CircularFragment {
  __schema {
    ...A
  }
}
fragment A on __Schema {
  directives { name }
  ...B
}
fragment B on __Schema {
  ...A
}
```

なぜ効くのか: フラグメントAがフラグメントBを参照し、フラグメントBがフラグメントAを参照し返す循環定義。GraphQL仕様ではこうした循環フラグメントはバリデーション段階で拒否されるべきだが、Agooはこの検証を実装しておらず仕様非準拠だった。結果としてパーサないし実行エンジンが無限に自己参照を展開しようとしてフリーズし、プロセス再起動以外に復旧手段がなかった。仕様準拠のバリデータを持たない実装は、このように「本来GraphQL仕様がガードしているはずの攻撃」に対して無防備になるという教訓。

#### Broken Authorization節

**Allowing Data Access to Deactivated Users (GitLab, 2021年8月)** — 無効化（deactivate）されたユーザーアカウントのAPIキーが、GraphQL API越しには依然として有効だった認可バイパス。攻撃者（この場合は報告者Joaxcar）は管理者権限でユーザーを作成・無効化した後、そのAPIキーで`labelCreate`ミューテーションを実行できることを確認した。なぜ効くのか: 認証（誰であるか）は通っても、認可（今その権限を持つか）の判定でアカウント状態（有効/無効）を再チェックしていないと、無効化という運用上の“アクセス遮断”操作がAPIレイヤーで反映されない。退職者・休職者のアカウントを無効化する運用ポリシーの実効性そのものを無力化する点で、単純だが実務上の影響が大きい。

**Allowing an Unprivileged Staff Member to Modify a Customer's Email (Shopify, 2021年9月、報奨$1,500)** — 権限を持たないはずのショップスタッフアカウントが`emailSenderConfigurationUpdate`ミューテーションを通じて顧客のメールアドレスを書き換えられた。ミューテーション単位でのフィールドレベル権限チェック漏れの典型例であり、「様々な権限レベルでAPIを評価し、クロスアカウント/クロスユーザーアクセスを試す」ことの重要性を著者は強調している。

**Disclosing the Number of Allowed Hackers Through a Team Object (HackerOne, 2018年4月、報奨$2,500)** — `team`オブジェクトの`whitelisted_hackers.total_count`フィールドが、本来非公開のはずのプログラムの招待ハッカー数を、`handle`引数の文字列探索によって外部から特定可能にしていた。単体では機微度の低い情報漏洩だが、非公開プログラムの存在自体を推測する材料になる点が評価された。

**Reading Private Notes (GitLab, CVE-2019-15576, 2019年6月)** — REST APIでは適切に制限されていたIssueの非公開ノート（プライベートノート）が、GraphQL APIの`notes`フィールド経由では制限なく読めた。同一データに対しREST APIとGraphQL APIとで別々にアクセス制御を実装している場合、片方の実装漏れがもう片方の防御を迂回する経路になるという、複数API面を持つシステム特有のリスクを示す代表例。

**Disclosing Payment Transaction Information (HackerOne, 2019年10月)** — `team`オブジェクトの`payment_transactions.total_count`フィールドが、権限のないセッションから他社の支払い取引件数を漏洩させた。決済関連情報はGraphQLスキーマ設計時に個別のスコープ/権限チェックを必ず持たせるべきという教訓。

#### Information Disclosure節

**Enumerating GraphQL Users (GitLab, CVE-2021-4191)** — Rapid7が発見。ユーザー登録画面を制限していたプライベートGitLabインスタンスでも、`users`フィールドを未認証で叩くことでユーザー名・メール・所属グループ・アカウント状態などが列挙できた。これによりターゲット選定（フィッシング対象の特定）、組織構造の推測（買収・子会社関係の把握）、有効アカウントへのブルートフォース対象の絞り込みが可能になる。

**Accessing the Introspection Query via WebSocket (Nuri, 2020年4月)** — 本節前段のHackerOne一覧にも登場した事例で、書籍側でより詳しい技術背景が語られている。NuriのGraphQL APIはWebSocketをトランスポートに使用しており、HTTP経由のクエリではintrospectionが無効化されていたにもかかわらず、WebSocket経由ではintrospectionクエリがそのまま実行できてしまった。

```json
{"type":"start","payload":{"query":"query Introspection { __schema {...} }"}}
```

なぜ効くのか: `graphql-ws`のようなライブラリは、WebSocket上でsubscription（購読）だけでなくquery/mutationも送信できる設計になっている。開発者がHTTPエンドポイント側だけにintrospection無効化の設定を入れ、WebSocketエンドポイント側の同等設定を見落とすと、トランスポートごとにセキュリティ設定が分裂し、片方だけが抜け道になる。GraphQL実装がトランスポート非依存（HTTPでもWebSocketでも同じリゾルバ・同じスキーマを共有）であるほど、「どの入口から入っても同じ認可・設定が適用されているか」を横断的に確認する必要がある、という本教科書の他章（WebSocketトランスポート編）とも直結する教訓である。

#### Injection節

**SQL Injection in a GET Query Parameter (HackerOne, 2018年11月)** — GraphQL仕様上の標準パラメータ（`query`・`variables`・`operationName`）以外に存在した非標準パラメータ`embedded_submission_form_uuid`がサニタイズなしでSQLに連結されていた。

```ruby
new_parameters = {"embedded_submission_form_uuid": "PAYLOAD"}
new_parameters.each do |key, value|
  safe_query += "SET SESSION #{key} TO #{value};"
end
connection.query(safe_query)
```

攻撃者は時間ベースSQLi（`pg_sleep(10)`を注入し応答時間で真偽を判定する手法）で存在を確認した。

```
time curl -X POST "https://hackerone.com/graphql?embedded_submission_form_uuid=1%27%3BSELECT%201%3BSELECT%20pg_sleep(10)%3B--%27"
# => 10.557 total
```

なぜ効くのか: GraphQLパラメータは「GraphQL仕様が定めた3つの標準パラメータ以外は安全」という思い込みが生まれやすいが、実装側が独自に追加した非標準パラメータは通常のGraphQL入力バリデーション（スキーマの型チェック）の対象外になりやすく、文字列結合でSQLに渡されるとGraphQLかどうかに関係なく古典的なSQLiが成立する。

**SQL Injection in an Object Argument (Apache SkyWalking, CVE-2020-9483, 2020年6月)** — `getLinearIntValues`フィールドの`metric`引数（オブジェクト型、`id`と`name`をキーに持つ）の`id`値がサニタイズなしでSQL文に連結されていた。

```graphql
query SQLi($d: Duration!) {
  getLinearIntValues(
    metric: {name: "all_p99", id: "') UNION SELECT 1,CONCAT('~','9999999999','~')--"},
    duration: $d
  ) { values { value } }
}
```

なぜ効くのか: サーバー側はJavaの`StringBuilder`で`ids`引数の値をシングルクォートで囲んで連結し、そのままSQL文の一部として実行していた。GraphQLの型システムが「文字列引数であること」までは保証しても、その文字列の中身がSQL的に安全であることまでは保証しない。オブジェクト型引数のネストしたフィールドは特にレビュー漏れが起きやすい箇所である。

**Cross-Site Scripting (GraphQL Playground, CVE-2021-41249)** — GraphQL Playground（クエリ送信・スキーマ閲覧用のIDE）に存在した反射型XSS。攻撃者は(1)侵害済みサーバーのスキーマ型名に悪意あるHTML/JSを仕込む、または(2)悪意あるGraphQLサーバーを自前で立て、被害者に`?endpoint=http://attacker.com/graphql`形式のリンクを踏ませてPlaygroundにそのサーバーを読み込ませる、の2通りで悪用できた。

```python
class UserObject(SQLAlchemyObjectType):
    class Meta:
        name = "MyMaliciousTypeName"  # ここに危険な文字列を仕込める
        model = User
```

なぜ効くのか: Playgroundはintrospectionクエリで取得したスキーマの型名やドキュメントコメントをそのままUIにレンダリングする。型名という「サーバー側が自由に決められる文字列」がエスケープなしでHTMLに埋め込まれると、スキーマ自体がXSSペイロードの運び手になる。修正では、HTML文字列の確実なエスケープ、型名がGraphQL仕様に準拠しているかの検証、危険な文字を含むドキュメントのレンダリング回避が行われた。

**Cross-Site Request Forgery (GitLab, 2021年3月)** — GitLabはPOSTベースのGraphQLクエリを`X-CSRF-Token`ヘッダーで保護していたが、GET経由でのクエリ送信も許可していたため、GETリクエストには同じCSRF保護が適用されていなかった。

```html
<form action="https://gitlab.com/api/graphql/" id="csrf-form" method="GET">
  <input name="query" value="mutation CreateSnippet($input: CreateSnippetInput!) ...">
  <input name="variables" value='{"input":{"title":"Test Snippet"}}'>
</form>
<script>document.getElementById("csrf-form").submit()</script>
```

なぜ効くのか: 一般に「GETは読み取り専用、書き込みはPOSTのみ」という前提でCSRF対策がPOSTだけに実装されがちだが、GraphQLはクエリ文字列をURLパラメータとして渡せばミューテーション（書き込み操作）すらGETで送れてしまう。この前提のズレがCSRF保護の穴になった。GraphQL APIを設計・防御する際は、HTTPメソッドではなく「ミューテーションかクエリか」という操作の性質そのものに基づいて保護を適用する必要がある。

#### 章全体の位置づけ

第10章が一貫して示すのは、GraphQL固有の新しい攻撃面（introspection、エイリアス、バッチング、フラグメント、柔軟な型システム）が、DoS・認可・情報漏洩・インジェクション・CSRFという既存の脆弱性クラスを「新しい形で」再発させているという構図である。多くの事例で報奨金は$0〜$12,500と幅広く、単純な設定漏れ（$0、情報開示レベル）から未認証RCE級（$12,000〜）まで、影響度に応じて評価が分かれている。著者らは章末で、これらのレポートを読むこと自体が「新技術を学ぶ際の近道」になると強調しており、本教科書の読者にも、ここで扱われなかった他社のGraphQL/WebSocket関連レポートを継続的に読む習慣を勧める。

> 出典: Nick Aleks, Dolev Farhi, *Black Hat GraphQL: Attacking Next Generation APIs*, Chapter 10 "Disclosed Vulnerabilities and Exploits", No Starch Press, 2023 — https://www.penguinrandomhouse.com/books/719557/black-hat-graphql-by-nick-aleks-and-dolev-farhi/ （目次: https://nostarch.com/black-hat-graphql ／O'Reilly収録版: https://www.oreilly.com/library/view/black-hat-graphql/9781098156831/c10.xhtml ）
