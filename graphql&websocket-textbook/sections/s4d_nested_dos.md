## 深いネスト/循環クエリDoSの原理と対策

GraphQL の可用性(Availability)を脅かす代表的な攻撃が、**深いネストクエリ**と**循環クエリ**によるサービス拒否(DoS: Denial of Service、正規利用者がサービスを使えなくする攻撃)である。REST では「1エンドポイント=1処理」に近く、応答のサイズや計算量がおおむねエンドポイント側で固定されている。ところが GraphQL では、**クライアントが1回のクエリで「どこまで深く」「何を」「いくつ」たどるかを自由に指定できる**。この設計上の柔軟性こそが、少量のリクエストで巨大な計算・メモリ・DB負荷を引き起こす余地を生む。本節では、なぜ深い/循環したクエリがサーバを落としうるのかを**リゾルバ(resolver: 各フィールドの値を取得するためにサーバ側で実行される関数)の呼び出し構造**のレベルで解き明かし、depth limiting・cost analysis・pagination 制限・timeout・循環フラグメント検出といった防御を、実物のコード・設定・具体的な数値とともに整理する。

> 本節はすべて**防御目的**の解説である。攻撃ペイロード例は「なぜ危険か」を理解し、自らのサービスに適切な上限を設定するために示す。実在サービスや本番環境への無許可の負荷試験・破壊的検証は行わないこと。負荷の限界確認は、自分が管理するステージング環境に対してのみ行う。

### なぜ GraphQL は深い/循環クエリに弱いのか — 関係グラフ × リゾルバの構造

GraphQL スキーマは、実質的に**型どうしが参照し合う有向グラフ**である。典型例として、掲示板の `Thread`(スレッド)と `Message`(メッセージ)を考える。

```graphql
type Thread {
  id: ID!
  messages(first: Int): [Message]
}

type Message {
  id: ID!
  thread: Thread          # Message から親の Thread に戻れる
  author: Author
}
```

`Thread` は複数の `Message` を持ち、各 `Message` は自分の親 `Thread` を参照できる。すると `Thread → messages → thread → messages → …` と、**同じ関係を何度でも往復する経路**が生まれる。このような相互参照(あるいは自己参照)する型があると、クエリの入れ子は理論上いくらでも深くできる。

実行時に何が起きるかが核心だ。GraphQL サーバはクエリを木構造として解釈し、**各フィールドについてリゾルバを1回ずつ呼ぶ**。あるフィールドがリストを返すと、その各要素について子フィールドのリゾルバがさらに呼ばれる。つまり、

- あるレベルで `first: 100` 件を取得し、
- その各要素でさらに `first: 100` 件をたどる、

というクエリは、レベルを1つ深めるたびにリゾルバ呼び出し回数と読み込むオブジェクト数が**乗算的(掛け算)に増える**。5階層ネストして各段100件なら、最深部で理論上 100⁵ = 100億件に達する。多くの実装ではフィールド解決ごとに DB クエリが飛ぶ(いわゆる **N+1 問題**: 1件取得のたびに追加クエリが N 回発生する)ため、CPU・メモリ・DB コネクション・ネットワークが一気に枯渇する。**攻撃者はたった1本の小さな HTTP リクエストを送るだけ**で、サーバに天文学的な仕事を強制できる。これが GraphQL 特有の DoS の本質である。

REST の感覚で「レート制限(単位時間あたりのリクエスト数上限)を入れてあるから大丈夫」と考えるのは危険だ。DoS を起こすのに大量のリクエストは要らない。**1リクエストの中身が凶器**なので、リクエスト数ベースの防御をすり抜ける。

### 攻撃パターン1: 相互参照型による深いネストクエリ

Escape.tech の解説記事は、`Group`(グループ)と `User`(ユーザ)が相互に所属し合う関係を例に、次のような悪性クエリを示している。

```graphql
query UnknownQuery {
    searchGroups(name:"", limit: 1000000){
        users{
            groups{
                users{
                    groups{
                        users{
                            id
                        }
                    }
                }
            }
        }
    }
}
```

このクエリの何が危険かを分解する。

- **`limit: 1000000`**: 検索の上限引数が青天井なので、まず巨大な結果集合を要求できる。
- **`users → groups → users → groups → …` の往復**: グループはユーザを含み、ユーザはグループに属するという双方向関係を、ネストで何度も往復している。
- **データ量の爆発**: 記事は「1,000 グループ、各グループ平均20人、各ユーザ平均5グループ所属」という現実的な前提で試算し、**このクエリ1本でおよそ2億件(≈200 million)の識別子**を読み込ませられるとしている。

このクエリの**深さ(depth)は7**である(`searchGroups` を1として、`users`/`groups` を数えていくと最深フィールド `id` が第7レベル)。深さの数え方は「ルートから最も深いフィールドまでの入れ子段数」であり、後述の depth limiting のしきい値設定はこの数え方が基準になる。

> 出典: GraphQL Cyclic Queries and Depth Limiting(Escape.tech) — https://escape.tech/blog/cyclic-queries-and-depth-limit/

### 攻撃パターン2: 循環フラグメントによる DoS(パーサ/検証段階での爆発)

> ⚠️ **未取得の資料**: 「Denial of Service Attacks with GraphQL(IBM PTC Security, Medium)」は自動取得できませんでした(理由: Medium が HTTP 403 を返し、egress 経由の直接取得がブロックされたため。WebSearch 経由で要旨のみ確認)。以下の URL からご自身で直接ご覧ください: https://medium.com/@ibm_ptc_security/denial-of-service-attacks-with-graphql-77189a6ba85b
>
> （以下は未取得資料の補足として、検索で得た要旨と一般知識に基づく解説です)

**フラグメント(fragment)**とは、クエリ内で繰り返し使うフィールドの集合に名前を付けて再利用する仕組みである。IBM PTC Security の記事は、この再利用機能が**循環参照(cyclic reference)**に悪用されうる点を指摘している。フラグメント A がフラグメント B を展開し、B がまた A を展開する、という相互参照を書くと、素朴に展開しようとする実装では**終わらない展開ループ(無限の呼び出しスタック)**に陥り、サーバがクラッシュしうる。

概念を示す(実装によっては後述の検証で拒否される)。

```graphql
query {
  ...FragmentA
}

fragment FragmentA on Query {
  someField {
    ...FragmentB
  }
}

fragment FragmentB on SomeType {
  otherField {
    ...FragmentA   # A に戻る → A↔B が循環
  }
}
```

ここで重要なのは、**GraphQL 仕様(specification)は循環フラグメントを禁止しており**、「Fragment spreads must not form cycles(フラグメントの展開は循環を形成してはならない)」という検証ルールが定められている点だ。仕様準拠のサーバは、クエリ実行前の**検証(validation)フェーズ**でこの循環を検出し、`Cannot spread fragment ... within itself` のようなエラーで拒否する。したがって「循環フラグメントで無限ループ」が成立するのは、**実装が仕様の循環検出から逸脱している場合**に限られる。逆に言えば、独自にクエリを組み立てる中間層(ミドルウェア)やゲートウェイ、あるいは非標準の GraphQL 実装を挟んでいるときは、この検証が抜け落ちていないかを必ず確認すべきである。

防御の観点では、IBM の記事が挙げる対策は本節後半の項目と重なる: **depth 制限・amount 制限・pagination・cost 分析・レート制限・field の重複排除(field-deduplication)・循環フラグメントの明示的な拒否**である。循環フラグメントについては、開発時の静的検査として **GraphQL ESLint の `no-fragment-cycles` ルール**(フラグメント使用に循環がないか検査する)を CI に組み込むこと、そして実行時にはミドルウェア層で循環検出テストを持つことが推奨される。

> 出典(要旨は WebSearch 経由): Denial of Service Attacks with GraphQL(IBM PTC Security) — https://medium.com/@ibm_ptc_security/denial-of-service-attacks-with-graphql-77189a6ba85b

### 攻撃パターン3: フィールド重複(field duplication)とエイリアス増幅

深さを増やさずに負荷を掛ける変種もある。**同じ高コストなフィールドを、エイリアス(alias: `名前: フィールド` で別名を付けて同じフィールドを複数回問い合わせる機能)で何百回も並べる**手口だ。

```graphql
query {
  a1: expensiveField { ... }
  a2: expensiveField { ... }
  a3: expensiveField { ... }
  # ... 数百〜数千個並べる
}
```

深さは浅くても、**幅(1リクエスト内のフィールド数)**が膨れることでリゾルバ呼び出し回数が増える。depth limit だけでは防げないため、後述の**cost/complexity 分析**や**エイリアス数・フィールド重複の制限**が必要になる(この「1リクエストに大量の操作を詰める」発想は、本章の alias/batching による総当りバイパスと地続きである)。

### なぜ「サイズ制限」だけでは無力なのか

素朴な発想として「リクエストの生バイト長に上限を掛ければよい」と考えがちだが、これは有効に機能しない。Apollo の解説はこう指摘する。

> バイト長チェックは、「短いフィールド名を使った悪性クエリを通してしまう一方、長いフィールド名を使った正当なクエリをブロックしてしまう」おそれがある。

短いフィールド名(`a`, `b`, …)を使えば、わずかなバイト数で深く広いクエリを表現できてしまう。**負荷はバイト数ではなく、リゾルバ呼び出しの回数・深さ・返却オブジェクト数で決まる**ためだ。防御は「文字数」ではなく「意味的なコスト」に対して掛ける必要がある。

> 出典: Securing Your GraphQL API from Malicious Queries(Apollo公式Blog) — https://www.apollographql.com/blog/securing-your-graphql-api-from-malicious-queries

### 対策1: 深さ制限(depth limiting)— 最低限の防御

最も手軽で効果的な基礎防御が**depth limiting**である。クエリの最大ネスト段数を超えたら、実行前に検証エラーで拒否する。Node.js/Apollo では `graphql-depth-limit`(Andrew Carlson 作)を validation rule として組み込む。

```javascript
const depthLimit = require('graphql-depth-limit');

app.use('/api', graphqlServer({
  validationRules: [depthLimit(10)]
}));
```

**なぜこれで防げるのか**: depth limit は**実行(resolver 呼び出し)が始まる前の検証フェーズ**で動く。深すぎるクエリはリゾルバを1回も呼ばずに弾かれるので、爆発的な負荷が発生しない。

**しきい値の決め方**が実務の勘所だ。Apollo Blog(Spectrum チームの事例)は、**自分たちの正規クエリで最も深いものが7段**であることを実測したうえで、余裕を見て**最大深度を10**という「かなり寛容な値」に設定した。ポイントは「正規利用の最大値を実測 → それに少し上乗せ」であり、闇雲に小さくしないこと。Escape.tech も「最大深度を2にしたり timeout を1秒にすれば大半のクエリをブロックできてしまう」と警告しており、**セキュリティと可用性のバランス**を段階的に調整する姿勢を勧めている。

Graphene(Python)では検証時に depth limit バリデータを渡す:

```python
from graphql import validate, parse

validation_errors = validate(
    schema=schema.graphql_schema,
    document_ast=parse("THE QUERY"),
    rules=(depth_limit_validator(max_depth=7),)
)
```

Hasura Cloud のようなマネージド製品では、管理画面の **API > Security > API Limits** から depth をノーコードで設定できる。

> 出典: GraphQL Cyclic Queries and Depth Limiting(Escape.tech) — https://escape.tech/blog/cyclic-queries-and-depth-limit/
> 出典: Securing Your GraphQL API from Malicious Queries(Apollo公式Blog) — https://www.apollographql.com/blog/securing-your-graphql-api-from-malicious-queries

### 対策2: 数量制限(amount limiting)/ ページネーション上限

depth を抑えても、1段あたりの取得件数が青天井なら意味がない(前掲 `limit: 1000000`)。そこで、リスト取得の件数引数を**制約付きの独自スカラ型**に置き換え、上限を型レベルで強制する。Apollo Blog は `graphql-input-number` を使う例を示す。

```javascript
const { GraphQLInputInt } = require('graphql-input-number');

const PaginationAmount = GraphQLInputInt({
  name: 'PaginationAmount',
  min: 1,
  max: 100,
});
```

```graphql
type Thread {
  messages(first: PaginationAmount, after: String): [Message]
}
```

**なぜ効くのか**: `first` の型が「1〜100 の整数」に固定されるため、`first: 1000000` のような要求は**検証段階でエラー**になる(Apollo の記述では「100を超える要求はエラーを投げる」)。depth limit と組み合わせることで、「深さ × 1段あたり件数」の両軸に上限が掛かり、乗算的爆発の指数と底の両方を抑えられる。**depth 制限と amount/pagination 制限は、どんな GraphQL API でも普遍的に入れるべき2つの基礎**である。

> 出典: Securing Your GraphQL API from Malicious Queries(Apollo公式Blog) — https://www.apollographql.com/blog/securing-your-graphql-api-from-malicious-queries

### 対策3: クエリコスト/複雑度分析(cost / complexity analysis)

depth と件数だけでは、「浅いが極端に高コストなフィールド」を見逃す。そこで**実行前にクエリの総コストを見積もり、しきい値を超えたら拒否する**のが cost analysis である。Node.js では次のライブラリがある。

- **`graphql-cost-analysis`**: フィールドにコストを宣言する**ディレクティブ方式**。リゾルバのコストが引数で変動する場合に推奨。
- **`graphql-validation-complexity`**: 設定不要で使えるプラグアンドプレイ型の代替。
- `graphql-query-complexity`: Apollo Blog は非推奨としている。

ディレクティブ方式では、各フィールドに「基本コスト」と「件数引数に比例する乗数(multipliers)」を宣言する。

```graphql
type Participant {
  threadConnection(first: PaginationAmount): ThreadConnection
    @cost(complexity: 3, multipliers: ["first"])
}

type Thread {
  author: Author @cost(complexity: 1)
  participants(first: PaginationAmount): [Participant]
    @cost(complexity: 2, multipliers: ["first"])
}
```

**なぜ multipliers が重要か**: `first` で20件取れば `threadConnection` のコストは 3 × 20 = 60、というように、**返却件数に比例して見積もりが増える**。ネストするほどコストは掛け合わされ、深い/広いクエリほど早くしきい値に達して拒否される。これはリゾルバの実際の負荷を近似する。

**しきい値の決め方(実測ベース)**: Spectrum チームは Apollo Studio の **p99 サービス時間**(遅い方から1%を除いた最遅応答時間)を指標にフィールドごとのコスト値を定め、**最も高コストな正規クエリが約500ポイント**だったことから、**最大複雑度を750**に設定した。テストで投げた悪性クエリは**1,010,319ポイント**と算出され、当然拒否された。この「正規の最大コストを実測 → 余裕を持たせた上限」という手順は depth の決め方と同じ思想である。

**過剰実装への戒め**: Apollo Blog は「cost analysis の実装に多大な時間を割く前に、本当に必要かを確かめよ。まずステージング API を意地悪なクエリで落とせるか試せ」と述べる。depth + amount 制限だけで守れるなら、cost 分析は後回しでよい。**必要になるのは、depth/amount 制限をすり抜ける「高コストな非悪性クエリ」がテストで見つかったとき**である。

> 出典: Securing Your GraphQL API from Malicious Queries(Apollo公式Blog) — https://www.apollographql.com/blog/securing-your-graphql-api-from-malicious-queries

### 対策4: タイムアウト・レート制限・許可リスト(persisted queries)

- **クエリタイムアウト**: 実行時間を監視し、一定時間を超えたクエリを打ち切る。depth/cost の見積もりをすり抜けた「想定外に遅いクエリ」に対する最後の安全網。ただし Escape.tech が警告する通り、極端に短い値(例: 1秒)は正規クエリまで巻き添えにするため、実測に基づいて設定する。
- **レート制限**: リクエスト数ベースの制限は DoS 単体には弱いが(1本で落とせるため)、他の防御と併用する多層防御(defense in depth)の一枚として意味を持つ。
- **クエリ許可リスト(allowlisting / persisted queries)**: クライアントのコードから抽出した**承認済みクエリだけ**を実行許可する方式(`persistgraphql` など)。任意のクエリを実行させないので DoS には極めて強い。一方で Apollo Blog は「公開 API には不向き」と明記する: 旧クライアント互換のためクエリを削除しづらく、第三者に開かれた API では成立しない。**社内向け・自社クライアント専用 API では強力な選択肢**、公開 API では depth/amount/cost が主軸になる。
- **サイズ制限は無効**: 前述の通り、バイト長制限は防御として機能しない。

> 出典: Securing Your GraphQL API from Malicious Queries(Apollo公式Blog) — https://www.apollographql.com/blog/securing-your-graphql-api-from-malicious-queries
> 出典: GraphQL Cyclic Queries and Depth Limiting(Escape.tech) — https://escape.tech/blog/cyclic-queries-and-depth-limit/

### 対策5: 循環フラグメントの拒否とフィールド重複対策

- **循環フラグメント**: GraphQL 仕様は循環フラグメントを禁止しているので、**まず自分のサーバが仕様準拠でこれを検証段階で拒否するか**を確認する。標準の `graphql-js` 系実装は拒否するが、独自ゲートウェイやクエリ再構築を挟むと抜けることがある。開発時は GraphQL ESLint の `no-fragment-cycles` を CI に入れ、実行時はミドルウェアで循環検出テストを持つ。
- **フィールド重複 / エイリアス増幅**: 同一フィールドをエイリアスで大量に並べる攻撃には、**フィールドの重複排除(field deduplication)**、**1クエリあたりのエイリアス数・フィールド数の上限**、および cost analysis(同じフィールドを100回並べればコストも100倍に積算される)で対処する。

> 出典(要旨は WebSearch 経由): Denial of Service Attacks with GraphQL(IBM PTC Security) — https://medium.com/@ibm_ptc_security/denial-of-service-attacks-with-graphql-77189a6ba85b

### 未取得資料の扱いと補足

> ⚠️ **未取得の資料**: 「Protecting against deeply-nested GraphQL queries(Jacob Voytko, Medium)」は自動取得できませんでした(理由: Medium が HTTP 403 を返し、egress 経由の直接取得がブロックされたため)。以下の URL からご自身で直接ご覧ください: https://jauntyjake.medium.com/protecting-against-deeply-nested-graphql-queries-9f6db003002e
>
> （以下は未取得資料の補足として一般知識に基づく解説です)
>
> このテーマ(深いネストクエリからの保護)は、本節で詳述した **depth limiting を核とする防御**と内容が大きく重なる。要点は次の3つに集約される: (1) 相互参照/自己参照する型があると入れ子は理論上無限に深くでき、リゾルバ呼び出しが乗算的に増える; (2) `graphql-depth-limit` などで**実行前の検証段階**に最大深度(正規最大 +α)を強制する; (3) depth だけでは幅・件数・コストの攻撃を防げないため、**pagination 上限・cost 分析・timeout との多層防御**が必要である。実装時は、まず自サービスの正規クエリの最大深度・最大件数を計測し、それを基準にしきい値を決めることが陳腐化しにくい運用となる。

### 実務チェックリスト(まとめ)

深いネスト/循環クエリ DoS への防御は、単一の魔法の設定ではなく**多層防御**で成立する。導入優先度は概ね次の順。

1. **depth limit**(必須): 正規クエリの最大深度を実測し、+α で設定(例: 実測7 → 上限10)。
2. **amount / pagination limit**(必須): 件数引数を上限付きスカラ型に。青天井の `limit` を排除。
3. **循環フラグメントの拒否確認**: 仕様準拠実装か検証。CI に `no-fragment-cycles`。
4. **timeout**: 想定外に遅いクエリの最後の砦。実測ベースで設定。
5. **cost / complexity analysis**(必要に応じて): depth/amount をすり抜ける高コストクエリが見つかったら導入。正規最大コストを実測し +α(例: 実測500 → 上限750)。multipliers で件数比例を反映。
6. **field 重複 / エイリアス数の制限**、**レート制限**、(自社クライアント専用なら)**persisted queries 許可リスト**。
7. **サイズ制限に頼らない**: バイト長では負荷を測れない。

いずれのしきい値も「正規利用の実測値 + 余裕」で決めるのが原則であり、対象バージョン(2026年時点で `graphql-js` 系実装は循環フラグメントを仕様通り拒否する)や自サービスの負荷特性が変われば再測定して見直すこと。
