## GraphQL injection (SQLi/NoSQLi/SSRF) とWebSocket複合

### この節で扱うこと

GraphQLは「クエリ言語」であって、それ自体はデータストアではない。実際にデータを取り出したり書き込んだりするのは、各フィールドの背後にある **リゾルバ（resolver: GraphQLのフィールドを実データに解決する関数。SQLやMongoDBへの問い合わせ、外部HTTP呼び出しなどを行う実装本体）** である。したがって「GraphQL特有の脆弱性」と「昔ながらのインジェクション」は別物ではなく、**GraphQLは古典的インジェクションの新しい入口（エントリポイント）にすぎない**、という視点が本節の核心になる。

ここでは次の3系統を、なぜ成立するのか（メカニズム）まで掘り下げて解説する。

- GraphQL引数経由の **SQLインジェクション（SQLi）**
- GraphQL引数経由の **NoSQLインジェクション（NoSQLi、主にMongoDB演算子注入）**
- リゾルバがサーバ側でHTTP要求を出すことによる **SSRF（Server-Side Request Forgery）**

さらに、これらが **WebSocketトランスポート（`graphql-ws` / `graphql-transport-ws`）** 上で起きたときに何が変わるのか、実例（IDOR→エラーベースPostgreSQLインジェクション→PII・文書漏えい）をもとに複合ケースとして扱う。

> ⚠️ 本節はすべて防御・検知の理解を目的とする。ペイロード例は「なぜ危険か」を仕組みで説明するために示すもので、実在サービスや本番環境への無許可の検証・破壊的操作を行ってはならない。

---

### なぜGraphQLでインジェクションが起きるのか（原理）

REST APIでは「1エンドポイント＝1ハンドラ」に近く、入力の検証箇所も比較的追いやすい。対してGraphQLは、1つの `/graphql` エンドポイントに対して **クライアントが任意の形状のクエリを送り、各フィールドのリゾルバが個別にデータソースへ問い合わせる**。この構造が次のような油断を生む。

- **「GraphQLスキーマが型を持つから安全」という誤解**：GraphQLの型システム（`String`, `Int`, カスタムスカラなど）は「引数がその型として受理できるか」を検証するだけで、**その文字列がSQL/NoSQL/URLとして安全か**は一切保証しない。`id: String` に `1' OR '1'='1` を入れても、それは正しい `String` である。
- **リゾルバでの文字列連結**：`db.query("SELECT * FROM users WHERE id = '" + args.id + "'")` のように、引数を **sink（入力が最終的に実行・解釈される危険な代入先。ここではSQL文の組み立て箇所）** へ直接連結してしまうと、そのまま古典的SQLiになる。
- **1入力が複数コンテキストで再利用される**：同じ引数がSQLにもログにも外部API呼び出しにも渡ることがあり、どこか1箇所でも検証を漏らすとインジェクションが成立する。

まとめると、**GraphQLの型検査は「構文的な受理」しか行わず、リゾルバ内の文字列組み立て・外部呼び出しの安全性は開発者責任のまま**という点が、あらゆるGraphQLインジェクションの根本原因である。

---

### 攻撃対象の発見（列挙とスキーマ把握）

インジェクションの前提として、攻撃者はどのフィールド・引数が存在するかを知りたがる。GraphQLには **イントロスペクション（introspection: サーバが自身のスキーマ定義をクエリで返す機能）** があり、`__schema` / `__type` という予約フィールドで型・フィールド・引数を丸ごと取得できる。

最小のイントロスペクションクエリ（型名一覧）:

```json
{ "query": "{ __schema { types { name } } }" }
```

なぜ危険か：これはデバッグ用の便利機能だが、本番で有効なままだと **攻撃者にデータベース構造に近い設計図を渡す** ことになる。どの引数が `id` や `filter`、`url` を受け取るかが分かれば、SQLi/NoSQLi/SSRFの狙い所が一気に絞られる。

イントロスペクションが無効化されていても、以下のような **エラー・サジェスト（suggestion）ベースの列挙** が残る場合がある。

```
?query={__schema}
?query={}
?query={thisdefinitelydoesnotexist}
```

多くの実装は、未知のフィールド名を送ると「もしかして `email` ですか？」のような **サジェストエラー** を返す。これを辞書と組み合わせて総当たりすると、イントロスペクション無効下でもスキーマを復元できる（`clairvoyancex` 等のツールが自動化する）。よってイントロスペクション無効化は必要条件だが十分条件ではなく、エラーメッセージの抑制も併せて必要になる。

よく狙われるエンドポイント: `/graphql`, `/graphiql`, `/graphql/console/`, `/v1/graphiql`, `/graph`。WebSocket購読では後述の `/graphql-ws` も要注意である。

> 出典: PayloadsAllTheThings「GraphQL Injection」 — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/GraphQL%20Injection

---

### 1. GraphQL引数経由のSQLインジェクション

#### 検知：エラーベースと時間ベース

最も基本的な検出は、引数へシングルクォートを一つ混ぜて **SQL構文エラーを誘発** することである。

```graphql
{
  bacon(id: "1'") {
    id
    type
    price
  }
}
```

なぜこうなるか：リゾルバが `... WHERE id = '1''` のような不正なSQLを組み立てると、DBが構文エラーを返す。そのエラー文言がGraphQLレスポンスの `errors` に漏れ出れば、**入力がSQL文にそのまま到達していること（injectableであること）** の強い証拠になる。これが「エラーベース（error-based）」の入口である。

エラーが表に出ない場合は **時間ベース（time-based blind）** に切り替える。

```graphql
query {
  user(name: "patt';SELECT 1;SELECT pg_sleep(30);--'") {
    id
    email
  }
}
```

なぜこうなるか：`pg_sleep(30)` はPostgreSQLで30秒スリープする関数。応答が明確に30秒遅延すれば、注入したSQLが実行されたと判定できる。`--` 以降はコメント化して後続の元SQLを無効化する。レスポンス本文にヒントが出ないブラインド環境でも、**応答時間という副チャネル**で真偽を判定できる、という原理である。

UNIONベース（`UNION SELECT ...`）を引数内に注入してスキーマやデータを引き出す手法も、通常のSQLiと同様に成立する。

> 出典: PayloadsAllTheThings「GraphQL Injection」 — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/GraphQL%20Injection

#### なぜGraphQLだと見逃されやすいか

WAFや検知ルールは `?id=1'` のようなURLクエリ文字列やフォーム値を監視することが多い。GraphQLでは悪意ある文字列が **JSONボディ内のクエリ文字列の、さらにフィールド引数の中** に入れ子で埋め込まれるため、単純なパターンマッチをすり抜けやすい。加えてPOSTボディ全体が「1つのGraphQLクエリ」に見えるため、フィールド単位の異常が埋もれる。これが「GraphQLはSQLiの温床になりうる」と言われる実務上の理由である。

---

### 2. GraphQL引数経由のNoSQLインジェクション

バックエンドがMongoDBなどの場合、引数として渡されたJSON文字列を **そのまま `find()` のフィルタオブジェクトへ流し込む** 実装が危険になる。攻撃者はMongoDBの演算子（`$regex`, `$gt`, `$where` など）を注入できる。

正規表現演算子で条件を骨抜きにする例:

```graphql
{
  doctors(
    options: "{\"limit\": 1, \"patients.ssn\" :1}",
    search: "{ \"patients.ssn\": { \"$regex\": \".*\"}, \"lastName\":\"Admin\" }")
    {
      firstName lastName id patients{ssn}
    }
}
```

なぜこうなるか：`"$regex": ".*"` は「任意の文字列にマッチ」を意味する。本来は特定条件で絞るはずのフィルタが「すべてに一致」へ書き換わり、`Admin` に紐づく患者のSSN（社会保障番号）まで抜き出せてしまう。`options` で射影（返却フィールド）を指定し、機微フィールドを狙い撃ちしている点も悪質である。

比較演算子で認証・照合を回避する例（一般的なパターン）:

```json
{"query":"{ users(filter: \"{\\\"password\\\": {\\\"$gt\\\": \\\"\\\"}}\") { email password } }"}
```

なぜこうなるか：`{"$gt": ""}` は「空文字より大きい＝ほぼ全パスワードにマッチ」となり、`password == 入力値` の等価比較が「常に真に近い」条件へ化ける。`$where: "this.isAdmin === true"` のようにサーバ側JavaScript評価を注入できる実装ではさらに危険度が上がる。

根本原因は **「JSON文字列を検証せずクエリオブジェクトへ昇格させる（型を持つ演算子として解釈させる）」** ことにある。文字列として受けた値がキー付きオブジェクト＝演算子に化ける瞬間が sink である。

> 出典: PayloadsAllTheThings「GraphQL Injection」 — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/GraphQL%20Injection

---

### 3. リゾルバ経由のSSRF

リゾルバは「サーバ側で外部データを取りに行く」ことがある。ミューテーションやクエリの引数として **URLを受け取り、その先へサーバがHTTP要求を出す** 設計だと、SSRFが成立する。

- ファイルインポート・Webhook登録・画像取得・OGP取得などのミューテーション引数に `url` が存在する
- ファイルアップロード系ミューテーション、購読（subscription）でコールバックURLを扱う実装

攻撃者は内部専用アドレスやクラウドメタデータエンドポイントを注入する。

```
http://169.254.169.254/latest/meta-data/
```

なぜ危険か：`169.254.169.254` はAWS等のクラウドで **インスタンスメタデータサービス（IMDS）** が待ち受けるリンクローカルアドレス。リゾルバが検証なしにここへ要求を出すと、IAMの一時認証情報などが窃取されうる。VPC内部ホストや `localhost` の管理ポートにも到達しうる。

原理は通常のSSRFと同一で、**「ユーザ入力のURLを、宛先の妥当性を確認せずサーバが叩く」** ことが sink になる。GraphQL固有の難しさは、URLがクエリの深い階層の引数として渡ることで検知・監査が難しくなる点にある。

> 出典: PayloadsAllTheThings「GraphQL Injection」 — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/GraphQL%20Injection

---

### Uprootsecurity ガイドの要点（攻撃分類と防御）

> ⚠️ **未取得の資料**: 「GraphQL Injection: Attacks, Exploitation & Prevention Guide（Uprootsecurity）」は自動取得できませんでした（理由: 元URL `https://resources.uprootsecurity.com/GraphQL_Injection` が `https://www.uprootsecurity.com/404` へ301リダイレクトし本文が取得不能。Wayback Machineもこの環境からは取得不可）。以下のURLからご自身で直接ご覧ください: https://resources.uprootsecurity.com/GraphQL_Injection

（以下は未取得資料の補足として、検索結果の要約および一般知識に基づく解説です。）

同ガイドが整理している論点は、本節の分類とよく一致する。

- **攻撃の起点**：イントロスペクションでスキーマ全体をダンプし、DB構造を推測する。実装によってはユーザ詳細（トークンを含む）をクエリでき、認証回避に悪用される。
- **入力検証の不在が本質**：GraphQLは入力型を適切に検証しないことがあり、**同じ入力がHTTP・SQL・その他のリクエストで再利用される**ため、1箇所の検証漏れがインジェクションに直結する。
- **リソース枯渇**：深くネストしたクエリで過剰なリソース消費（DoS）を招く（本章の別節「ネストDoS」とも接続する）。
- **防御の柱**：
  - 本番でイントロスペクションとGraphiQL等の開発ツールを無効化する。
  - エラーメッセージは開発時に有益でも外部には不透明にする（ミドルウェアで機微情報を除去）。DB構文エラーの漏えいはエラーベースSQLiの生命線なので、ここを塞ぐ効果は大きい。
  - すべてのユーザ入力を厳格に検証し、パラメータ化クエリ（プレースホルダ）を使う。文字列連結を排除すれば、SQLi/NoSQLiの sink が消える。

> 出典: Uprootsecurity「GraphQL Injection: Attacks, Exploitation & Prevention Guide」 — https://resources.uprootsecurity.com/GraphQL_Injection

---

### 4. 複合ケース：IDOR → GraphQL WebSocket上のエラーベースPostgreSQLインジェクション → PII・文書漏えい

> ⚠️ **未取得の資料**: 「From IDOR to SQL Injection in GraphQL WebSocket → PII & Document Leak（$2,000）」（Medium / Ahmed Ghadban, 2026年4月）は自動取得できませんでした（理由: Medium本文が HTTP 403 Forbidden。freedium等のミラーおよびWayback Machineもこの環境から到達不可）。以下のURLからご自身で直接ご覧ください: https://medium.com/@DarkyOS/sql-injection-in-graphql-websocket-escalated-to-pii-document-leak-09ba7ad2800a

（以下は未取得資料の補足として、検索結果の要約および一般知識に基づく解説です。原典の実物ペイロードは確認できていないため、コード例は仕組み説明のための再構成であることに留意すること。）

#### 事案の骨子

対象は法務テンプレート（法的文書）を管理するアプリケーション。要点は次の連鎖である。

1. **持続的なWebSocket接続**が `/graphql-ws` エンドポイントと通信していた。
2. このWebSocketには、**文書IDを渡して「文書の読み取り」「文書のロック」を行う隠れた機能**があった。
3. テストの結果、**バックエンドで所有権（オーナーシップ）検証がなく IDOR（Insecure Direct Object Reference: 他人のオブジェクトIDを指定すると認可チェックなしにアクセスできてしまう欠陥）** が成立した。
4. ただし文書IDは **25桁の数値文字列で高エントロピー**に生成されており、総当たりは実質不可能だった（＝IDORはあるが「他人のIDを当てられない」ため単体では活かしにくい）。
5. そこで、この文書ID引数が **エラーベースのPostgreSQLインジェクション** に脆弱であることを利用し、**高エントロピーIDという保護を回避**して、PII（個人識別情報）と非公開の法的文書へ不正アクセスした。
6. 報奨金は **$2,000**。

#### なぜ「IDORだけでは足りない」のに刺さったのか（原理）

IDOR単体の前提は「他人のオブジェクトIDを推測・列挙できること」。ここでは25桁・高エントロピーのため列挙が不可能で、通常ならIDORは低評価に留まる。しかし **同じID引数がSQLに文字列連結される sink** でもあったため、攻撃者はIDを「当てにいく」のではなく、**SQL側から中身を吐かせる**方向へ切り替えた。

- エラーベースSQLiでは、注入した部分式（サブクエリ）を **わざと型変換エラーや構文エラーに巻き込み、その値をエラーメッセージへ載せて漏らす**。PostgreSQLでは、たとえば文字列を数値へキャストしようとして失敗させ、`invalid input syntax for type ... : "<漏らしたい値>"` の形でデータをエラー文言に混入させる古典手法がよく使われる。
- こうすると **他人の文書IDを推測する必要がなくなる**。「所有権チェックがない（IDOR）」＋「SQLで任意データを引ける（SQLi）」の合わせ技で、高エントロピーIDというランダム性の壁を無意味化できる。ここが「IDOR→SQLiエスカレーション」の勘所である。

再構成した概念例（実物ではなく仕組み説明用）:

```
// WebSocket上のGraphQL操作として送られるイメージ
subscription {
  document(id: "1' AND 1=CAST((SELECT string_agg(email, ',') FROM users) AS int)-- ") {
    id
    status
  }
}
```

なぜこうなるか：`CAST(... AS int)` に文字列（メールアドレス連結）を渡すと型変換に失敗し、PostgreSQLのエラーにその文字列が現れる。所有権チェックが無いのでこの操作自体は拒否されず、エラー本文が購読応答として返れば、そこからPIIを読み取れる。

#### WebSocketトランスポートが絡むと何が変わるのか

GraphQLの購読（subscription）は多くの場合HTTPではなく **WebSocket** で運ばれ、`graphql-ws`（サブプロトコル名 `graphql-transport-ws`）や旧 `subscriptions-transport-ws`（サブプロトコル名 `graphql-ws`）が用いられる。攻撃・防御の観点で重要な差分は次のとおり。

- **接続確立と操作が分離する**：WebSocketはまず `ConnectionInit` でハンドシェイクし、以後は同一コネクション上で複数の `Subscribe`（操作）メッセージをやり取りする。**認証がハンドシェイク時に一度だけ行われ、その後の各操作で認可が再評価されない**設計だと、1本の接続を掴んだまま多数の悪性操作を送り込める。事案の「隠れた読み取り/ロック機能」もこの持続接続上で叩かれた。
- **HTTPミドルウェアの監視が効きにくい**：WAFやログはHTTPリクエスト単位で見ることが多いが、WebSocketは**アップグレード後は同一コネクション内のフレームがHTTPログに1件ずつ現れない**ため、フィールド単位の異常（SQLメタ文字、`CAST`、`pg_sleep` など）が見落とされやすい。SQLi/NoSQLiの検知網をすり抜ける「配管（transport）」として機能してしまう。
- **エラーの返り方**：購読メッセージに対するサーバ応答（`Next` / `Error` メッセージ）にDBエラーが載れば、それがエラーベースSQLiの漏えいチャネルになる。HTTPと同様、**エラー詳細の露出**が致命傷になる点は変わらない。

つまりWebSocketは新種の脆弱性を生むというより、**既存のIDOR・SQLiを「監視の薄い経路」「認可が甘くなりがちな持続接続」の上に載せることで、検知と防御を難しくする増幅装置**として働く。

#### この事案からの防御教訓

- **WebSocket上でも操作ごとに認可を再評価する**：接続時の認証だけで信用しない。各 `Subscribe`／各文書アクセスで所有権チェックを行う（IDORを塞ぐ）。
- **リゾルバでパラメータ化クエリを徹底**：ID引数を文字列連結しない。これで「IDOR→SQLi」のエスカレーション経路が断たれる。
- **エラーメッセージの抑制**：DB例外・型変換エラーをクライアントへ返さない。エラーベースSQLiの漏えいチャネルを閉じる。
- **WebSocketフレームの監査**：HTTPと同等の入力検証・ロギング・異常検知をWebSocketフレームにも適用する。

> 出典: Medium（Ahmed Ghadban）「From IDOR to SQL Injection in GraphQL WebSocket → PII & Document Leak ($2,000)」 — https://medium.com/@DarkyOS/sql-injection-in-graphql-websocket-escalated-to-pii-document-leak-09ba7ad2800a

---

### バッチング／エイリアスとの合わせ技（補足）

インジェクションはしばしば **バッチング（batching）／エイリアス（alias）** と併用される。1リクエストに多数の操作を詰めると、レート制限やブルートフォース対策を回避しつつ試行を増幅できる。

配列バッチング:

```json
[
  {"query":"..."},
  {"query":"..."},
  {"query":"..."}
]
```

エイリアスバッチング（1操作内で同一フィールドを別名で多重呼び出し）:

```graphql
mutation {
  login(pass: 1111, username: "bob")
  second: login(pass: 2222, username: "bob")
  third: login(pass: 3333, username: "bob")
  fourth: login(pass: 4444, username: "bob")
}
```

なぜ効くか：多くのレート制限は **HTTPリクエスト単位** で数える。1リクエスト内に数百の `login` エイリアスを並べれば、リクエスト数を増やさずに大量試行できる。ブラインドSQLiの真偽判定を1リクエストにまとめて高速化する、といった攻撃効率化にも使われる。防御は **HTTPではなく操作（オペレーション）単位でのレート制限** と、エイリアス数・バッチ数の上限設定である。

> 出典: PayloadsAllTheThings「GraphQL Injection」 — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/GraphQL%20Injection

---

### 防御まとめ（チェックリスト）

| 対策 | 効く攻撃 | 仕組み上の理由 |
| --- | --- | --- |
| パラメータ化クエリ／プレースホルダ | SQLi・NoSQLi | 引数がコードとして解釈されず「値」に固定され、sink が消える |
| 入力の厳格な検証・型/長さ/許可リスト | SQLi・NoSQLi・SSRF | GraphQL型検査で足りない「意味的な安全性」を補う |
| NoSQLフィルタをオブジェクトへ昇格させない | NoSQLi | 文字列が `$regex` 等の演算子に化ける瞬間を防ぐ |
| URLはスキーム/ホスト許可リスト＋名前解決後のアドレス検査 | SSRF | `169.254.169.254` や内部ホストへの到達を遮断 |
| 本番でイントロスペクション・GraphiQL無効化 | 全般（偵察） | スキーマ露出＝攻撃対象の設計図を渡さない |
| エラーメッセージの抑制・汎化 | エラーベースSQLi | DB例外の漏えいチャネルを閉じる |
| WebSocketでも操作ごとに認可再評価 | IDOR・複合 | 持続接続上での認可バイパスを防ぐ |
| 操作単位のレート制限・エイリアス/バッチ上限 | ブルートフォース増幅 | HTTP単位計測の抜け穴を塞ぐ |
| WebSocketフレームの監査・入力検証 | 複合全般 | HTTP監視の死角をなくす |

対策ツール（監査・検証用途）: `graphw00f`（サーバ指紋）、`graphql-cop`（セキュリティ監査）、`inQL`（Burp拡張）、`GQLSpection`／`GraphQLmap`（スキーマ解析・クエリ生成）、`clairvoyancex`（イントロスペクション無効下のスキーマ復元）、`CrackQL`（ブルートフォース/ファジング）、`graphql-path-enum`（型到達経路の可視化）。

> 出典: PayloadsAllTheThings「GraphQL Injection」 — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/GraphQL%20Injection

---

### 本節のまとめ

- GraphQLの型システムは**構文的受理**しか行わず、SQL/NoSQL/URLとしての安全性は保証しない。インジェクションの sink はリゾルバ内の**文字列連結**と**未検証の外部呼び出し**にある。
- SQLiはエラーベース（`'` で構文崩し）／時間ベース（`pg_sleep`）で検知、NoSQLiは`$regex`/`$gt`/`$where`等の**演算子昇格**で成立、SSRFは**未検証URLをサーバが叩く**ことで成立する。
- WebSocket（`graphql-ws`）は新種の穴というより、**IDORやSQLiを認可の甘い持続接続・監視の薄い経路に載せる増幅装置**。実例では高エントロピーIDでIDORが活きない状況を、**エラーベースPostgreSQLインジェクションで回避**してPIIと法的文書を漏えいさせた（$2,000）。
- 防御は「パラメータ化クエリ・入力検証・イントロスペクション無効化・エラー抑制・操作単位のレート制限・WebSocketでの認可再評価と監査」を層状に重ねること。
