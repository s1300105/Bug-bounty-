## alias/batching 攻撃の原典とレート制限バイパス

GraphQL の最大の特徴のひとつは「1回の HTTP リクエストに複数の操作をまとめて詰め込める」点にある。この便利さは、しかし裏を返すと「HTTP リクエスト単位で数える防御（レート制限・アカウントロック・WAF のリクエストカウント）を一撃で無効化できる」という深刻な弱点になる。本節では、この構造的欠陥を最初期に実証・体系化した三つの資料（Wallarm・Escape.tech・PentesterLab）を読み解きながら、**なぜ batching / alias 攻撃が成立するのか**をプロトコルと実行モデルのレベルで説明する。

なお本節は防御目的の解説であり、実在サービスや本番環境への無許可の検証、破壊的な手順は一切扱わない。以降の payload 例はすべて「自分が管理する検証環境で、なぜ危険なのかを理解するための最小例」である。

### まず用語を分解する: batching・alias・operation

GraphQL 特有の言葉を最初にかみ砕いておく。

- **operation（オペレーション）**: `query` / `mutation` / `subscription` のいずれか1単位。「ログインを試みる」「OTP を検証する」といった1つの意味ある処理に対応する。防御側が本来「1回」と数えたい単位はここである。
- **HTTP リクエスト**: TCP/HTTP 上でサーバに届く1回の通信。レート制限・WAF・ロードバランサはたいていこの単位でカウントする。**防御が数える単位（HTTP）と、攻撃者が実行したい単位（operation）がズレていること**が、この攻撃群すべての根っこにある。
- **batching（バッチング）**: 複数のクエリ／ミューテーションを1回の GraphQL リクエストにまとめて送り、まとめて実行させること。実装方法は2系統ある（後述の「配列バッチング」と「alias バッチング」）。
- **alias（エイリアス）**: 同じフィールドを1つのクエリ内で何度も呼び出すために、各呼び出しへ別名を付ける GraphQL 標準機能。GraphQL のレスポンスは JSON であり、**JSON のキー（フィールド名）は一意でなければならない**。だから同じ `login` フィールドを3回呼ぶには `login`・`second`・`third` のように別名を付ける必要がある。この「別名を付ければ同一フィールドを何度でも呼べる」仕様が、そのまま攻撃の道具になる。

### 原理: GraphQL の実行モデルが「まとめ処理」を保証している

Wallarm の記事は、この攻撃が単なる実装ミスではなく **GraphQL 仕様が明示的に許可している挙動**であることを指摘する。GraphQL 仕様（June 2018, 6.3.1 節「Normal and Serial Execution」）では、1つの operation 内の複数フィールドは順に解決（resolve）される。エグゼキュータは最初のフィールドを解決してそのサブ選択集合を実行し、次のフィールドへ進む、という具合に逐次的に処理する。

つまり **1つの HTTP リクエストの中で、サーバは選択されたフィールドをすべて律儀に実行する**。攻撃者から見れば「フィールドをたくさん並べれば並べただけ、サーバ側の処理（＝ログイン試行や OTP 検証）が実行される」ことが仕様レベルで保証されている、ということになる。ミューテーションの場合はさらに「直列実行（serial）」が仕様で定められており、`login` を3つ並べれば3回とも確実に評価される。

一方で、Wallarm が強調するもう一つの側面がある。GraphQL における batching は元々パフォーマンス最適化のための正当な機能だという点だ。記事の表現を借りれば「バックエンドへの複数のデータ要求を短時間ためておき、下層のデータベースやマイクロサービスへ1回のリクエストとしてまとめて送る」ための仕組みである。攻撃者はこの善意の最適化機能を、防御回避の道具に転用しているにすぎない。

> 出典: Wallarm「GraphQL Batching Attack」 — https://lab.wallarm.com/graphql-batching-attack/

### バッチングの2系統: 配列バッチングと alias バッチング

PentesterLab の整理が最も明快なので、まずここで2系統を対比しておく。

#### (1) 配列バッチング（array batching）

多くの GraphQL サーバ（Apollo Server など）は、リクエストボディに **operation のオブジェクトを JSON 配列で並べる**形式をサポートする。1つの HTTP POST で複数 operation を送れる。

```json
[
  { "query": "mutation { login(user:\"tom\", pass:\"password\") { token } }" },
  { "query": "mutation { login(user:\"tom\", pass:\"password123\") { token } }" },
  { "query": "mutation { login(user:\"tom\", pass:\"TomTheBest\") { token } }" }
]
```

**なぜ効くのか**: サーバはこの配列を受け取ると、各要素を独立した operation として順に実行し、結果を配列で返す。HTTP リクエストは1回なので、HTTP 単位のレート制限は「+1」しかカウントしない。しかし実際にはログイン試行が3回実行されている。要素数を増やせば、1リクエストで数百〜数千の試行を隠せる。

#### (2) alias バッチング（alias-based batching）

配列バッチングをサーバ側で無効化していても、**1つの operation の中で alias を使えば同じ攻撃ができる**。PentesterLab がとくに注意を促すのはこの点だ。「配列バッチングを止めれば安心」という誤解を突く手法である。

```graphql
mutation {
  a1: login(user: "tom", pass: "password")     { token }
  a2: login(user: "tom", pass: "password123")  { token }
  a3: login(user: "tom", pass: "TomTheBest")   { token }
}
```

**なぜ効くのか**: これは JSON 配列ではなく、文法的には「1つの mutation operation」である。よって「配列バッチを禁止する」対策も、「operation 数を1に制限する」対策もすり抜けてしまう。それでも仕様上、alias で名付けられた3つの `login` フィールドはすべて解決される。防御が operation 数だけを見ていると、これを「1 operation」と数えてしまい、実際には3回の試行が走ることを見逃す。

PentesterLab はこの攻撃の帰結を端的にまとめている。レート制限やアカウントロックが無効化され、認証情報の総当たりが大規模に現実的となり、**OTP の全数列挙（000000〜999999）すら最小限のリクエストで可能になりうる**、と。

> 出典: PentesterLab Glossary「GraphQL Batching Attack」 — https://pentesterlab.com/glossary/graphql-batching-attack

### 実証の原典: Wallarm による OTP / 2FA バイパス

Wallarm の記事は、この攻撃がなぜ「教科書に載る原典」と呼ばれるのかを示す実演を含む。二つのシナリオが説明されている。

**(A) パスワード総当たりの増幅**: 通常、ログイン試行を1回ずつ送るとレート制限に容易に検知される。しかし batching を使えば「一度に複数の email/password ペア」を、極端には数千ペアを1回の HTTP コールに封じ込められる。記事は「3つの異なる email/password ペアを一度に」送る例を挙げ、これが数千規模まで拡張しうると述べる。

**(B) 2FA / OTP バイパス（原典的実演）**: これが最も有名な実演だ。ワンタイムトークン（OTP）の検証を、**取りうる全候補を同時に**送りつける。記事の記述によれば、脆弱なアプリケーションは「3つのワンタイムトークンをすべて同時に処理し、有効なものを1つ見つけてログインさせた」。

ここでの本質は、**時間ベース（有効期限）や試行回数ベースの 2FA 保護が、batching の前では意味をなさない**という点にある。理由をメカニズムで説明する。試行回数制限は「N 回失敗したらロックする」という HTTP リクエスト単位のカウンタで実装されがちだ。ところが batching では、有効期限内の1リクエストに全候補を詰め込めるため、カウンタが増える前に総当たりが完了してしまう。6桁 OTP なら候補は 100 万通りだが、それを少数のリクエストに分割して送れば、期限切れやロックが発動する前に正解にたどり着ける。

Wallarm はこの攻撃が突く「セキュリティのすき間」を三つに整理している。

1. **レート制限の不整合**: 試行回数の上限は、開発者がコード（ビジネスロジック）レベルで手動で実装しなければならない。1回の API コールが数千の悪意ある試行を覆い隠す。
2. **検知回避**: 「各 API リクエストが数千の悪意あるリクエストを内包しうる」ため、WAF や RASP は異常を見分けにくい。
3. **実装のばらつき**: すべての GraphQL 実装が仕様を均一に守っているわけではなく、挙動の差が新たな穴になる。

Wallarm の推奨防御は、(1) ビジネスロジック層でのレート制限を意識したセキュアコーディング、(2) introspection（スキーマ内省）クエリの無効化、(3) GraphQL を理解するクラウドネイティブな API ファイアウォール（WAF/WAAP）の導入、である。

> 出典: Wallarm「GraphQL Batching Attack」 — https://lab.wallarm.com/graphql-batching-attack/

### DoS への発展: Escape.tech による alias/batching と資源枯渇

Escape.tech の記事は、同じ alias/batching の仕組みが **認証バイパスだけでなくサービス拒否（DoS）にも直結する**ことを示す。ここは「なぜ1リクエストがサーバを落とせるのか」を理解する上で重要だ。

まず記事は alias を明快に定義する。alias は「同じフィールドを異なる引数で1リクエスト内に複数回問い合わせる」ための機能であり、その必然性は「JSON のフィールド名は一意でなければならない」という制約から来る。batching は「1つの GraphQL リクエストで複数クエリを送る」技法で、alias によってそれらが1回のネットワーク往復の中で逐次実行される。

記事が挙げる認証情報総当たりの実例は次の通り。

```graphql
mutation {
    login(username: "Tom", password: "password")
    second: login(username: "Tom", password: "password123")
    third: login(username: "Tom", password: "TomTheBest")
}
```

これに対するレスポンスが、どのパスワードが正解だったかを露呈する（`null` は失敗、トークン文字列が返ったものが成功）。

```json
{
    "login": null,
    "second": null,
    "third": "U12hshjy7187GFST67sljsqfyzj19snSHDghjQSzFsj"
}
```

**なぜこれが DoS になるのか**: 記事は「1回の API コールが 10,000 件のデータベースリクエストを生み出しうる」と述べる。alias を大量に並べれば、サーバはそのすべてのフィールドを解決しようとする。各フィールドが DB クエリや外部呼び出しを伴えば、1リクエストが内部で数千〜数万の重い処理へと増幅される。記事の言葉では「攻撃者が膨大な数の alias を使うと、サーバは大量の処理を抱え込み、処理しきれなくなる」。そして**ファイアウォールやレート制限は API コール（HTTP）しか監視しないため、この異常を検知できない**。

同記事は影響を三つにまとめている。(1) 認証情報の総当たり（数百回規模の試行）、(2) 全トークン変種を送りつける 2FA バイパス、(3) alias 大量投入による DoS。

#### Escape.tech が推奨する防御

主たる緩和策は **alias 数の検証**である。「クエリが選んだ上限より多くの alias を含まないことを検証する」プロセスを実装し、**デフォルトで alias を拒否**し、「query と mutation の alias 上限デフォルト値を 1 に設定する」ことを勧める。つまり「明示的に許可した場合だけ複数 alias を認める」ホワイトリスト発想だ。

ツールとしては、Escape が開発したオープンソースの **GraphQL Armor** が挙げられている。これは「セキュリティのベストプラクティスをデフォルトで持ち込む」プラグインで、Apollo Server や Yoga などに組み込んで、alias 数上限・batching 上限・クエリ深さ・コスト制限などをまとめて課すことができる。

> 出典: Escape.tech「Avoid GraphQL DoS attacks through batching and aliasing」 — https://escape.tech/blog/graphql-batch-attacks-cause-dos/

### 三資料を貫く核心: 「何を1と数えるか」の設計ミス

三つの資料は表現こそ違えど、同じ一点を指している。**従来の防御は「HTTP リクエスト」を1と数えるのに、GraphQL の脅威は「operation / フィールド解決」の粒度で発生する**、という数え方のミスマッチである。この視点さえ掴めば、有効な防御は自然と導ける。

#### 防御の設計原則（三資料の統合）

1. **operation / フィールド単位で数える**: レート制限もアカウントロックも、HTTP リクエスト数ではなく「実行された operation 数・alias 数」で数える。PentesterLab の言うとおり、**リゾルバのロジック自身に operation レベルのカウンタを持たせる**のが最も確実だ。ログイン試行のカウンタは「HTTP を受けたとき」ではなく「login リゾルバが呼ばれたとき」に増やす。
2. **alias 数・batch サイズを制限する**: Escape.tech の推奨どおり、機微なフィールド（login・OTP 検証・パスワードリセットなど）では alias をデフォルト拒否し、上限を 1 に設定する。配列バッチングも上限（あるいは無効化）を設ける。
3. **配列バッチと alias バッチは別々に塞ぐ**: 「配列バッチを止めた」だけでは alias バッチが素通りする。両系統を独立に対策する。
4. **バッチサイズ制限とクエリ深さ／複雑度制限を混同しない**: PentesterLab が明記するように、これらは異なる脅威に対応する別の制御である。深さ・複雑度制限は「1クエリが深くネストして重くなる」DoS を防ぐが、「浅いが横に大量の alias が並ぶ」攻撃には効かない。両方を課す必要がある。
5. **introspection の無効化と GraphQL 対応 WAF**: Wallarm の推奨どおり、本番では introspection を無効化し、GraphQL のセマンティクスを理解できる監視を導入する。ただしこれらは補助であり、根本対策はビジネスロジック層のカウンタである点に注意する。

##### 実装イメージ（検証環境向けの最小例）

GraphQL Armor を使う場合の構成イメージは次の通り（Apollo Server 例、防御側の設定）。

```javascript
// 防御側設定の一例（自分の検証環境向け）
import { ApolloArmor } from '@escape.tech/graphql-armor';

const armor = new ApolloArmor({
  maxAliases: { n: 1 },      // alias バッチを実質1に制限（機微フィールド保護）
  maxDepth:   { n: 6 },      // ネスト DoS 対策（別軸）
  costLimit:  { maxCost: 5000 }, // クエリ複雑度の上限
});
```

なぜこの設定が効くのか。`maxAliases: 1` は alias バッチングそのものを封じ、`maxDepth` と `costLimit` はネスト型・複雑度型の DoS を別軸で塞ぐ。三資料が示した通り、これらは互いに代替できない独立した制御なので、重ねて課すことに意味がある。ただし配列バッチング（JSON 配列形式）はまた別で、サーバ側のバッチ有効化設定（Apollo なら `allowBatchedHttpRequests`）を無効化するか件数を制限する必要がある。

> 出典（統合）: Wallarm — https://lab.wallarm.com/graphql-batching-attack/ ／ Escape.tech — https://escape.tech/blog/graphql-batch-attacks-cause-dos/ ／ PentesterLab — https://pentesterlab.com/glossary/graphql-batching-attack

### バージョン・時事性に関する注記

- GraphQL の逐次実行仕様は 2018 年 6 月版仕様 6.3.1 節に基づく記述である。以降の仕様改訂でも「operation 内フィールドの解決」という基本モデルは変わっていない。
- GraphQL Armor は継続的に更新されるオープンソースであり、設定キー名（`maxAliases` 等）やデフォルト値は導入時のバージョンで必ず確認すること。上記コードは原理を示す概念例である。
- Apollo Server では配列バッチングがバージョンによりデフォルト無効の場合がある（近年の Apollo Server 4 系では `allowBatchedHttpRequests` は既定で false）。とはいえ alias バッチングは配列バッチとは独立に成立するため、「バッチが既定でオフだから安全」とは言えない。
