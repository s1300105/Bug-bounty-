# 第4章 GraphQL特有の攻撃: alias/batching・ネストDoS・injection

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

## 2FA/OTP総当りバイパスの実務と数値化

この節では、GraphQL の **alias（別名）** と **batching（一括送信）** という 2 つの正当な言語機能が、2FA/OTP（ワンタイムパスワード）の検証フローに対する **総当り攻撃（brute force）** をどのように成立させるのかを、仕組みのレベルで掘り下げる。ポイントは「1 回の HTTP リクエストで数千〜1 万通りの候補を一度に検証できてしまう」という点にある。この現象を漠然と「危ない」で終わらせず、**増幅率（amplification factor）** という数値で表現できるようになることが、防御設計とレポート作成の両方で決定的に重要になる。

> 注: 本節は防御・検知の設計を目的とした解説であり、実在サービスや本番環境への無許可の検証手順は扱わない。掲載するペイロードは仕組みの理解と、自組織の許可された検証環境での再現・対策確認のための最小例である。

### なぜ GraphQL だと「レート制限が効かない」のか

まず前提として、多くの Web API は認証系エンドポイント（ログイン、OTP 検証、パスワードリセット）に **レート制限（rate limiting）** をかけている。「同一 IP から 5 回/分まで」「同一アカウントに 10 回失敗したらロック」といった制御だ。これは総当りを実務的に不可能にする（4 桁 OTP=1 万通りを 5 回/分で試すと約 33 時間、かつ途中でロックされる）ための基本防御である。

問題は、**多くの実装がこのカウントを「HTTP リクエスト単位」で行っている** ことだ。GraphQL はこの前提を静かに破壊する。GraphQL では、1 本の HTTP リクエストの中に **複数の論理的に独立した操作** を詰め込める。したがって「1 リクエスト = 1 アクション」という暗黙の仮定が崩れ、レート制限のカウンタが数える単位（HTTP トランザクション）と、実際にサーバ内で実行される単位（GraphQL 操作）がズレる。**このズレこそがバイパスの本体** である。

> One HTTP request can carry hundreds or thousands of independent operations.（1 本の HTTP リクエストが、数百〜数千の独立した操作を運べる。）
> — Payload Playground

失敗する防御を先に列挙しておくと理解が早い。

- **IP ベースのレート制限**: HTTP リクエスト数を数えるため、1 リクエストに 1 万操作を詰めれば 1 回としかカウントされない。
- **リクエスト単位の CAPTCHA**: 1 リクエストに 1 回解けば、その中の全操作が通る。
- **HTTP レートに基づく WAF ルール**: トランザクションレートを見ているだけで、ボディ内の操作数を見ていない。

いずれも「間違ったレイヤ（HTTP 層）で数えている」ことが共通の敗因だ。GraphQL 操作の意味を理解しない層でカウントすると、バイパスは構造的に不可避になる。

### 手口1: alias（別名）による 1 リクエスト増幅

GraphQL の alias は本来、同じフィールドを複数回、別々の名前で取得するための機能である（例: 同じ `user` フィールドを ID 違いで 2 回取り、`me` と `friend` という別名で受け取る）。この「同じフィールドを、引数を変えて何度でも、ユニークな別名で呼べる」という性質が、そのまま総当りの器になる。

4 桁 OTP を検証する `verifyOtp` というミューテーションがあるとする。alias を使うと、1 回の操作（operation）の中に 1 万個の検証呼び出しを並べられる。

```graphql
{
  a0000: verifyOtp(phone:"+15555550100", code:"0000"){ ok token }
  a0001: verifyOtp(phone:"+15555550100", code:"0001"){ ok token }
  a0002: verifyOtp(phone:"+15555550100", code:"0002"){ ok token }
  # ... 中略 ...
  a9999: verifyOtp(phone:"+15555550100", code:"9999"){ ok token }
}
```

**なぜこれで全空間を 1 リクエストで覆えるのか。** GraphQL の実行エンジンは、1 つの操作に含まれる選択セット（selection set）内の各フィールドを独立に解決（resolve）する。`a0000` から `a9999` までは互いに別名なので衝突せず、エンジンはそれぞれの `verifyOtp` リゾルバを（多くの実装では並列に）呼び出す。サーバから見れば「1 回のリクエストを処理しただけ」だが、内部では OTP 検証ロジックが 1 万回走る。応答は各別名をキーにした JSON オブジェクトで返るため、攻撃者は「どの別名（＝どのコード）が正解だったか」を結果から一目で判定できる。正解が存在すれば、その別名の下だけ `ok: true` あるいは非 null の `token` が返る。

このペイロードは、短いスクリプトで機械的に生成できる（下は生成ロジックの構造を示すもの）。

```python
# 別名付き verifyOtp を 0000〜9999 まで並べたクエリ本体を生成する擬似コード
lines = []
for n in range(10000):
    code = f"{n:04d}"                       # 0000, 0001, ... 9999
    lines.append(f'a{code}: verifyOtp(phone:"+15555550100", code:"{code}"){{ ok token }}')
body = "{\n" + "\n".join(lines) + "\n}"
# この body を単一の GraphQL リクエストとして POST する
```

生成ロジックが単純なのは、攻撃コストが極めて低いことの裏返しである。4 桁 = 1 万通り、6 桁 TOTP = 100 万通りといった鍵空間（keyspace）を、for ループ 1 つで完全に列挙できてしまう。

### 手口2: array batching（配列一括送信）

もう 1 つの経路が array batching だ。多くの GraphQL サーバは、リクエストボディに **JSON 配列** を渡すと、その各要素を独立した操作として実行し、結果を同じ順序の配列で返す。

```json
[
  {"query":"mutation{ verifyOtp(phone:\"+15555550100\", code:\"0000\"){ ok token } }"},
  {"query":"mutation{ verifyOtp(phone:\"+15555550100\", code:\"0001\"){ ok token } }"},
  {"query":"mutation{ verifyOtp(phone:\"+15555550100\", code:\"0002\"){ ok token } }"}
]
```

**alias との違い。** alias は「1 操作の中に多数のフィールド」を並べる方式で、batching は「1 リクエストの中に多数の操作」を並べる方式である。前者は 1 つの selection set に収まり、後者は複数のトップレベル操作になる。重要なのは、この 2 つが **乗算的に合成できる（compound multiplicatively）** ことだ。N 個の操作をバッチにし、各操作の中に M 個の alias を詰めれば、1 リクエストで **N × M** 回の検証を発火できる。

したがって、たとえサーバがバッチ配列の長さを 10 に制限していても、各要素の中で alias を 1000 個使えれば 10 × 1000 = 1 万回になり、4 桁 OTP は依然 1 リクエストで全走査できる。「バッチ長だけ制限」は片手落ちだという設計上の教訓がここにある。

### 認証フローの順序を強制しないと何が起きるか

OTP 総当りが成立するもう 1 つの前提が、**認証フローの状態管理の甘さ** である。2FA は本来「① パスワードでログイン → ② サーバが OTP 発行 → ③ ユーザが OTP を提出 → ④ サーバが検証」という順序を持つ。ところが多くの GraphQL 実装は、この順序をサーバ側で厳密に強制せず、「クライアントは正しい順に呼んでくれるはず」と暗黙に期待している。

この期待が破れると、次のような複合的な問題が生じる。

- `verifyOtp` が、直前の正当なログインセッションやチャレンジ ID に紐づかず、単に `phone` と `code` だけで検証してしまう。攻撃者は正規のログイン状態を持たずとも、任意の電話番号に対して総当りできる。
- OTP の試行回数カウンタが「その OTP チャレンジ 1 件」に紐づいておらず、リクエスト単位でしか数えられない。すると alias/batching でカウンタを完全に回避できる。
- OTP の有効期限や 1 回使い切り（single-use）が甘いと、1 リクエストに全候補を詰める攻撃に十分な時間的猶予を与えてしまう。

> ⚠️ **未取得の資料**: Medium(Medusa)「Bypassing 2FA in GraphQL APIs: A Step-by-Step Guide」は自動取得できませんでした（理由: 直接取得が HTTP 403 Forbidden でブロックされたため）。以下の URL からご自身で直接ご覧ください: https://medusa0xf.medium.com/bypassing-2fa-in-graphql-apis-a-step-by-step-guide-4b73816bd4c3
>
> （以下は未取得資料の補足として、検索結果および一般知識に基づく解説です。）同記事は、GraphQL の batching が「認証・認可のフローが特定の順序に依存しているのに、バックエンドがその順序を厳密に強制していない」場合に現実的なセキュリティリスクになる、という点を強調している。具体的には、ログイン後に OTP を検証する流れで、サーバが「クライアントは行儀よく振る舞う」と仮定してしまう実装が狙われる。alias を使えば 4 桁コードの 1 万通りを 1 万個の別名として 1 リクエストに収められ、`verifyOtp` ミューテーションを OTP 候補違いで大量生成する短い Python スニペットで攻撃ボディを組み立てられる、と手順として示している。防御としては「1 つの電話番号に対する 1 万回の aliased `verifyOtp` 呼び出しを、どうパッケージングされていようと throttle（スロットル＝流量制限）する」こと、そして本番では「サーバ側で許可リスト化した既知のクエリハッシュのみを受け付け、攻撃者が組み立てた任意のバッチや alias 洪水を門前払いする」ことを挙げている。
>
> 出典: Bypassing 2FA in GraphQL APIs: A Step-by-Step Guide（Medusa, Medium） — https://medusa0xf.medium.com/bypassing-2fa-in-graphql-apis-a-step-by-step-guide-4b73816bd4c3

### 数値化: 増幅率（amplification factor）で語る

この攻撃の説得力は、感覚語ではなく **数値** で表れる。レポートでも防御設計でも、次の 4 ステップで定量化するのが実務の型だ。

1. **ベースラインを測る**: 単一操作を 1 つずつ送り、レート制限が発火する閾値を記録する（例: HTTP 429 や GraphQL エラーが出るのが 60 秒あたり 5 リクエスト目）。
2. **受理可能性を確認する**: batching と aliasing の両方が複数結果を返すか、また 1 リクエストに詰められる実務上の上限を探る（通常は JSON ボディサイズ上限で頭打ちになる）。
3. **増幅率を計算する**: 「5 リクエスト/分」しか許されなくても、1 リクエストに 1000 操作を詰められるなら、実効レートは **5000 操作/分**。すなわち **1000 倍のバイパス**。
4. **副作用を実証する**: 総当りなら、既知の正解コードがバッチ結果の中に非 null の `token` として現れることを示す。DoS なら、許可された対象に限定してレイテンシ劣化を計測する。

具体的な数字で締めると効果的だ。あるレート制限が「5 リクエスト/分」で、1 リクエストに 1000 操作を詰められるなら、増幅率は 1000 倍。4 桁 OTP の 1 万通りは、ボディサイズ上限でチャンク分割しても **わずか約 10 リクエスト**（＝典型的なレート制限の枠内）で全走査できてしまう。正解の存在は、バッチ結果に非 null トークンが 1 つ混じることで機械的に確定する。

> Always include the amplification factor—"1,000x bypass" is what makes risk irrefutable.（増幅率を必ず含めること。「1000 倍のバイパス」という一言が、リスクを反論不能にする。）
> — Payload Playground

なお同じ乗算構造は、OTP 総当りだけでなく **breadth-based（幅方向）の DoS** にも使える。高コストなリゾルバ（全文検索、レポート出力、画像変換など）を alias で数百回並べ、リストフィールドの取得件数を大きくすると、深いネストによる depth-based DoS とは別種の資源枯渇を引き起こせる。

```graphql
{
  q0:   searchProducts(query:"a", first: 1000){ id title description reviews { body } }
  q1:   searchProducts(query:"a", first: 1000){ id title description reviews { body } }
  # ... 数百個 ...
  q499: searchProducts(query:"a", first: 1000){ id title description reviews { body } }
}
```

同じ「1 リクエストに大量操作」という増幅が、認証総当りにも過負荷攻撃にも転用できる点を押さえておきたい。

> 出典: GraphQL Batching & Aliasing Attacks（Payload Playground） — https://payloadplayground.com/blog/graphql-batching-and-aliasing-attacks

### 防御: 「正しいレイヤで数える」ための多層設計

対策の核心は、**カウントの単位を HTTP 層から GraphQL 操作・対象 ID 層へ移すこと** と、**攻撃者が任意に組み立てるクエリ形状そのものに上限を課すこと** の 2 本立てである。単独では抜け道が残るため、多層（defense in depth）で組む。

#### 1. クエリコスト分析（最優先の本命）

各フィールドに静的なコストを割り当て、リストフィールドは要求件数を乗じ、合計が予算（budget）を超えたクエリは **実行前に拒否** する。alias も batching も結局は「多数のフィールド／操作」に展開されるため、コストの合計値で見れば増幅が可視化され、頭打ちにできる。これが最も根本的な対策であり、レポートでも第一の是正策として提示する。

- ライブラリ例: `graphql-cost-analysis`、`graphql-query-complexity`、Apollo の operation limits。

#### 2. batching の無効化または上限化

array batching を必要としないなら無効化する。必要なら配列長に上限（例: 10 操作）を設け、かつ **複数配列にまたがる操作の合計** に対してレート制限を適用する。前述のとおり「バッチ長だけ制限」では alias との合成で抜けられるので、コスト分析と併用する。

#### 3. alias 数・総フィールド数の上限

1 操作あたりの alias 数や総フィールド数に上限を設け、超えたクエリを拒否する。4 桁 OTP を 1 万 alias で並べる攻撃は、この上限だけでも実行前に弾ける。

#### 4. 深さ制限（depth limit）

selection set の最大深さを制限し、再帰的ネストを止める。これは主に depth-based DoS 向けだが、コスト分析と組み合わせて網羅性を高める。

#### 5. 機微操作カウンタ（最重要の設計原則）

ログイン、OTP 検証、パスワードリセット、クーポン利用などの機微操作は、**リゾルバ内で、対象アイデンティティ（email・phone・token）ごとに、アカウント単位・対象単位で厳格にカウント** する。ここが今回のバイパスの急所だ。「リクエスト元（requester）」ではなく「攻撃対象の同一性（target identity）」に対して試行回数を数えることで、alias や batching でどうパッケージングされても「1 つの電話番号への OTP 検証は N 回/時まで」という制約が効く。

- 具体例: 同一 `phone` に対する `verifyOtp` は「1 チャレンジあたり最大 5 回、超えたらチャレンジ失効」とし、その OTP チャレンジ ID に紐づけてカウンタを保持する。1 万 alias が来ても、6 回目以降は全て失敗として即座に拒否される。
- 併せて、OTP は single-use・短い有効期限・ログインセッション（またはチャレンジ ID）への束縛を必須とし、フローの順序をサーバ側で強制する。

#### 6. 永続化クエリの許可リスト（本番の決定打）

本番では、サーバ側で **許可リスト化した既知のクエリハッシュ（persisted query allow-listing）** のみを受け付ける。クライアントが送るのはクエリ本文ではなくハッシュだけになるため、攻撃者が任意に組み立てた 1 万 alias のバッチや alias 洪水は、そもそも許可リストに存在せず門前払いされる。これは最も強力な対策の 1 つだが、クライアント側のクエリ管理運用が必要になるため、コスト分析（防御の本命）を土台にしつつ、追加の防御層として位置づけるのが現実的だ。

### 実装状況・時事性に関する注記

- **バッチングの扱いはサーバ実装依存**: Apollo Server は歴史的に array batching をサポートしてきたが、既定の有効/無効やデフォルト値はバージョンや設定で変わる。自分の使うサーバ（Apollo、graphql-yoga、Hasura、Ariadne、graphql-ruby など）で「バッチが既定で有効か」「alias/フィールド数の既定上限があるか」を必ず対象バージョンのドキュメントで確認すること。「デフォルトが安全」を前提にしないのが鉄則である。
- **alias 制限は近年強化傾向**: GraphQL エコシステムでは 2023 年以降、alias 濫用対策として「alias 数の上限」「フィールド重複数の制限」を組み込む動きが進んでいる（例: 一部サーバ／プラグインで導入）。ただし既定で有効とは限らないため、明示的に設定する。
- **数値は目安**: 「1000 倍」「約 10 リクエスト」といった数字は、ボディサイズ上限・並列度・OTP 桁数に依存する。レポートでは自分の測定した実測値（ベースライン閾値、1 リクエストあたり詰め込めた操作数、実効レート）を必ず添えること。

### レポート作成の型

検証結果を報告する際は、次を必ず含めると「反論不能」な報告になる。

1. **リクエスト/レスポンスのペア**: 複数要素の配列（または大量 alias）を含むリクエストと、その結果を並べて示す。
2. **レート制限のベースライン**: 単一操作での閾値（例: 5 リクエスト/60 秒）を対比として示す。
3. **増幅率**: 「1000 倍のバイパス」のように、明確な倍率で影響を数値化する。
4. **是正策の優先順位**: クエリコスト分析を第一の是正策（primary remediation）として提示し、batching/alias の上限化は多層防御（defense in depth）として位置づける。
5. **副作用の実証**: 総当りなら既知の正解が結果に現れること、DoS なら許可対象に限定したレイテンシ劣化を、破壊的でない範囲で示す。

> 出典: GraphQL Batching & Aliasing Attacks（Payload Playground） — https://payloadplayground.com/blog/graphql-batching-and-aliasing-attacks

### この節のまとめ

- GraphQL の alias と batching は、**1 リクエストに数千〜1 万の独立操作を詰め込める**ため、HTTP リクエスト単位で数えるレート制限を構造的にバイパスする。
- 両者は **N × M で乗算合成** でき、「バッチ長だけ制限」では抜けられる。
- 2FA/OTP 総当りが成立する前提は「フロー順序の非強制」と「試行回数を対象 ID ではなくリクエスト単位で数える実装」である。
- 影響は **増幅率（例: 1000 倍）** で数値化するのが実務の要。4 桁 OTP はチャンク分割しても約 10 リクエストで全走査され得る。
- 防御は「正しいレイヤで数える」＝**クエリコスト分析を本命**に、batching/alias 上限、対象 ID 単位の機微操作カウンタ、永続化クエリ許可リストを多層で重ねる。

## 実報告とbatchQL: バルク送信・レート制限バイパス

前節までで「1リクエストに複数の操作を詰め込む」バッチング（batching）と、フィールドに別名を付ける **alias（エイリアス）＝1つのクエリ内で同じフィールドを別々の名前で何度も呼び出すための記法）** の仕組みを見てきた。本節では、それらが「机上の危険」ではなく実際に報奨金の付いた脆弱性として成立した2件の HackerOne 実報告と、この攻撃面を体系的に検出・実証するためのツール **batchQL（Assetnote 製の GraphQL バッチング監査スクリプト）** を扱う。狙いは、GraphQL の言語仕様上「正当な」機能が、既存の「HTTPリクエスト数を数える」タイプの防御をどのように無効化してしまうのか、その **原理と実測値** を押さえることである。

> 本節はすべて防御・診断目的の解説である。実在サービスや本番環境への無許可の検証、破壊的手順（大量送信の実行など）は行わない。掲載する数値・構造は、公開済みの一次報告とツール文書から要点を再構成したものである。

### なぜ「1リクエスト = 1操作」という前提が崩れるのか（原理）

多くのアプリの防御は、暗黙に「1回の攻撃試行 = 1回のHTTPリクエスト」という前提に立っている。ログイン試行回数の上限、OTP（ワンタイムパスワード）入力回数の上限、IPあたりのリクエストレート、WAFの秒間リクエスト閾値、いずれも数えているのは基本的に **HTTPリクエストの回数** である。

GraphQL はこの前提を2通りの正当な仕様で崩す。

- **配列バッチング（array/JSON list batching）**：GraphQL over HTTP の一般的な実装（Apollo Server など）は、リクエストボディに **クエリのJSON配列** を受け付ける。`[{"query":"..."},{"query":"..."},...]` と並べると、サーバは各要素を順に実行し、結果を配列で返す。1回のHTTP POST で N 個の独立した操作が走る。
- **alias バッチング（query-name / alias based batching）**：1つのクエリ本文（単一のオペレーション）の中で、同じフィールドやミューテーションに別名を付けて何度でも並べられる。GraphQL では、レスポンスのキー衝突を避けるために alias を付けることが仕様で認められているためだ。

alias バッチングの骨格を示す（説明用の一般形。実在サービスには向けない）。

```graphql
mutation bruteforce {
  a1: login(input: {user: "victim", otp: "0000"}) { success }
  a2: login(input: {user: "victim", otp: "0001"}) { success }
  a3: login(input: {user: "victim", otp: "0002"}) { success }
  # ... 同じ login を alias を変えて 10000 個並べられる ...
}
```

なぜこれでレート制限が破れるのか。サーバのリゾルバは `a1`〜`aN` の各 `login` を **1つずつ実行する**。しかしフロント側のWAFやIPレート制限、アプリの「試行回数カウンタ」が数えているのは **到達したHTTPリクエストの本数** であって、その内部で走ったリゾルバ呼び出しの回数ではないことが多い。この「数える単位のズレ」こそが本質的な欠陥である。カウンタがリゾルバ層（＝実際の認証試行）ではなくトランスポート層（＝HTTP）に置かれているため、1リクエストの中で試行が1万回起きても、カウンタは「1」としか刻まない。

4桁PIN（0000〜9999 の1万通り）を例にとると、Assetnote は「1万通りのPINを **単一のGraphQLクエリ** で全部試せる」と説明している（後述）。本文サイズ制限に引っかかる場合でも、1,000件ずつ10リクエストに分割すれば、どんな「リクエスト単位のレート制限」も実質的に下回る。**総当りの試行回数を、HTTPリクエスト数から切り離せる** のが GraphQL バッチング攻撃の核心である。

この原理が効くのは、次の条件が重なったときだ。

1. サーバが配列バッチングか alias の多重呼び出しを許している（＝バッチ数の上限や複雑度制限がない）。
2. レート制限・試行回数制限が **HTTPリクエスト数** ベースで、操作（リゾルバ）単位ではない。
3. 認証・OTP・クーポン適用・レポート作成など、**繰り返しに意味がある操作** が mutation として露出している。

### HackerOne #2166697 — query-name batching による報告の一括作成

**位置づけ**：HackerOne プラットフォーム自身に対する報告「Ability to bulk submit reports」。query-name（alias）バッチングを使い、1リクエストで75件超、Turbo Intruder との組み合わせで約6,400件のレポートをバルク作成できた。報奨 $500、37 upvotes。

> ⚠️ **未取得の資料**: 「HackerOne #2166697 — Ability to bulk submit reports」の報告本文は自動取得できませんでした（理由: hackerone.com のレポートページは JavaScript レンダリングで、WebFetch では本文がロードされず "HackerOne" のみが返った）。以下のURLからご自身で直接ご覧ください: https://hackerone.com/reports/2166697
>
> 以下は、WebSearch で得られた要旨と、公開されている二次情報・一般知識に基づく補足解説である。

報告された挙動の要点は次の通り。

- **手口**：レポート作成用の mutation（`createReport` 相当）を、1つのクエリ本文の中に **alias（query-name based batching）で多数並べる**。これにより1回のHTTP POST で **75件超** のレポートが作成された。
- **増幅**：さらに Burp Suite の拡張 **Turbo Intruder（高速に大量のHTTPリクエストを送るツール）** と組み合わせ、バッチ入りリクエストを連射することで **約6,400件** のレポート作成に到達した。
- **本質**：報告者は「6,400 操作 対 1 HTTPリクエスト」という比を示すことで問題を要約した。**HTTP本数を数える防御はこのモデルでは無力** であることが、実測で裏付けられた。

alias バッチによるバルク mutation の一般形（説明用。HackerOne本番には向けない）。

```graphql
mutation bulk {
  r1: createReport(input: { teamId: "X", title: "t1", vulnerabilityInformation: "..." }) { report { id } }
  r2: createReport(input: { teamId: "X", title: "t2", vulnerabilityInformation: "..." }) { report { id } }
  # ... r75, r76 ... と alias を増やしていく ...
}
```

なぜ75件で止まらず6,400件まで伸びたのか。**1リクエストあたりのバッチ件数**（75超）は、おそらくリクエストボディサイズや実行時間の現実的な上限で頭打ちになる。しかし「バッチ入りリクエスト自体を何本も送る」ことにはHTTPレート制限しか歯止めがなく、そのレート制限も **1リクエスト内の操作数を見ていない** ため、Turbo Intruder で数十リクエストを畳みかければ 75 × N ≈ 6,400 に届く。**「1リクエスト内の水平方向の増幅（alias）」と「リクエスト連射の垂直方向の増幅（Turbo Intruder）」を掛け算できる** のがこの報告の教訓である。

影響は、スパム的な大量レポート投下によるトリアージ運用の妨害・内部指標の汚染など。$500 という報奨額は「重大な認証バイパス」ではなく「濫用制御（abuse control）の欠落」に対する評価であることを示唆する。

**防御の含意**：レポート作成のような「回数に意味がある」mutation には、**トランスポート層ではなくリゾルバ層でのレート制限**（＝実際に実行された `createReport` の回数を数える）と、**1リクエストあたりのバッチ数・alias 数の上限** が必要になる。

> 出典: HackerOne #2166697 — Ability to bulk submit reports — https://hackerone.com/reports/2166697

### HackerOne #418767 — 2FA要件・レポートレート制限・内部濫用制限のバイパス

**位置づけ**：「Hacker can bypass 2FA requirement, report rate limit, internal abuse limits」。1つの脆弱性で、プログラムが課す複数の保護（2要素認証の要求、レポートのレート制限、内部の濫用制限）を同時にすり抜けられた、という HackerOne 自身への報告。

> ⚠️ **未取得の資料**: 「HackerOne #418767」の報告本文は自動取得できませんでした（理由: hackerone.com 本体は JavaScript レンダリングで本文が取得できず、ミラーの vulners.com も HTTP 403 でブロックされた）。以下のURLからご自身で直接ご覧ください: https://hackerone.com/reports/418767
>
> （以下は未取得資料の補足として、WebSearch の要旨と一般知識に基づく解説である。）

WebSearch から確認できた事実は、この報告が **「2FA要件・レポートレート制限・内部濫用制限」という3つの保護を同時にバイパスできた** 点である。GraphQL のバッチング／aliasing がこの種のバイパスの典型的な原因であり、本節の文脈（第4章 alias/batching）に位置づけられている。

一般論として、なぜ「1つの穴で複数の保護が同時に落ちる」のかを原理から説明する。2FA要件・レート制限・内部濫用制限は、それぞれ別々の機能に見えて、実装上は **同じ経路（ミューテーションのエンドポイント）に前置きされた同じチェック層** に依存していることが多い。

- **2FA要件のバイパス**：本来「OTP検証を通過してからでないと実行できない」mutation が、バッチの中に紛れ込ませると検証をすり抜ける、あるいは OTP 自体を alias バッチで総当りできてしまう。前者は「バッチ内の各操作に対して認可・前提条件チェックが個別に走っていない（＝リクエスト単位でしかチェックしない）」実装欠陥に起因する。
- **レポートレート制限・内部濫用制限のバイパス**：#2166697 と同型で、カウンタがHTTPリクエスト数を数えているため、1リクエスト内の複数操作でカウンタが回らない。

つまり **「チェックがトランスポート層（リクエスト単位）に置かれ、リゾルバ層（操作単位）に置かれていない」** という単一の設計上の欠陥が、外から見ると「2FAも」「レート制限も」「濫用制限も」複数の保護を同時に無効化するように見える、というのがこの種の報告の共通構造である。実際の #418767 の詳細な手口・ペイロード・タイムライン・報奨額は、上記URLで原文をご確認いただきたい。

> 出典: HackerOne #418767 — Hacker can bypass 2FA requirement, report rate limit, internal abuse limits — https://hackerone.com/reports/418767

### batchQL（Assetnote）— バッチング攻撃面の検出と実証ツール

**位置づけ**：Assetnote が公開した **GraphQL セキュリティ監査スクリプト**。「バッチクエリ／ミューテーションの実行に特化」しており、当時バッチング脆弱性を体系的にテストするツールが不足していた穴を埋める目的で作られた。

batchQL は「その GraphQL エンドポイントがバッチング攻撃に対して脆弱かどうか」を機械的に確かめるための道具である。診断側（防御・許可された範囲のテスト）で使うことを前提に、検出機能と攻撃実証機能を持つ。

#### 検出（enumeration）できること

batchQL は次の5点を判定する。それぞれ「なぜそれがリスクか」を添える。

1. **Introspection query support（イントロスペクション対応）** — スキーマ全体を `__schema` で取得できるか。取れれば攻撃対象のフィールド・mutation の一覧が丸裸になる。
2. **Schema suggestions detection（フィールドサジェスト）** — introspection を切っていても、タイポに対する "Did you mean ...?" 型のエラーが出るか。出ればスキーマを段階的に推測（Clairvoyance 型の復元）できる。
3. **Potential CSRF detection（CSRFの可能性、GET/POSTベース）** — クエリがGETや `application/x-www-form-urlencoded` で通るか。通れば、Cookie認証と組み合わさったときにCSRFが成立し得る（第5章で扱う）。
4. **Query name based batching（alias／クエリ名バッチング対応）** — 1クエリ内に同名フィールドを alias で多重に並べて実行できるか。**これが本節の主題の攻撃面** で、レート制限・OTP・クーポンの総当りバイパスに直結する。
5. **Query JSON list based batching（JSON配列バッチング対応）** — リクエストボディにクエリの配列を渡して一括実行できるか。同じく総当りの増幅に使える。

列挙コマンドの例（`-e` が対象エンドポイント、`-p` が Burp などのプロキシ）。

```bash
python batch.py -e http://re.local:5000/graphiql -p localhost:8080
```

#### 攻撃実証（batching attack）

現状の batchQL は **JSON配列ベースのバッチング** をサポートし、変数をクエリ内に埋め込むか JSON で渡すかを選べる。ワークフローは2段階だ。

- **ステップ1**：クエリ／ミューテーションを1つのファイル（例 `acc-login.txt`）に用意する。
- **ステップ2**：ワードリストの各行を `#VARIABLE#` の位置に差し込み、`--size` 件ずつバッチにまとめて送る。

```bash
python batch.py --query acc-login.txt --wordlist passwords.txt \
  -v '{"loginInput":{"email":"admin@example.com","password":"#VARIABLE#","rememberMe":false}}' \
  --size 100 -e http://re.local:5000/graphiql -p localhost:8080
```

主なパラメータの意味：

| パラメータ | 意味 |
|---|---|
| `--query` | GraphQL 操作を書いたローカルファイル |
| `--wordlist` | 差し込むペイロードのワードリスト |
| `-v` | 変数。`#VARIABLE#` がワードリストの各値に置換される |
| `--size` | 1リクエストにまとめるバッチ件数 |
| `-e` | GraphQL エンドポイント |
| `-p` | 通信を観察するためのHTTPプロキシ |

`--size 100` は「1回のHTTPリクエストに100件の試行を詰める」設定であり、まさに前述の「試行回数をHTTP本数から切り離す」原理をツール化したものだ。

#### batchQL が引用する「4桁PIN」の原理説明

batchQL のドキュメントは、この攻撃の効き目を次の例で説明している。**「4桁のPINを期待するパスワードリセット機能を考えてほしい。実装次第では、1万通りのPIN試行を単一の GraphQL クエリで全部試せてしまい、レート制限やアカウントロックを回避し得る」**。

これがなぜ成立するかは冒頭の原理そのものだ。PINの総数（1万）は固定でも、それを1本のクエリに alias／バッチで畳み込めば、レート制限が数える「HTTPリクエスト数」は1のまま。**総当りの計算量（1万）と、防御が観測する量（1リクエスト）が乖離する** ため、実装が「PIN検証をリゾルバ単位で数えて」いない限り、ロックアウトもレート制限も空振りする。

> 出典: batchQL (Assetnote) — https://github.com/assetnote/batchql

### まとめ：防御側が数えるべきは「操作」であって「リクエスト」ではない

本節の3資料に共通する教訓は一貫している。

- **カウンタをリゾルバ層に置く**：ログイン・OTP・レポート作成・クーポン適用など回数に意味のある操作は、HTTPリクエスト数ではなく **実際に実行された当該フィールド／mutation の回数** でレート制限・ロックアウトを判定する。alias や配列で何個並べられても、リゾルバが1回走れば1回として数える設計にする。
- **バッチ数・alias数・クエリ複雑度に上限を課す**：1リクエストあたりのオペレーション数、同一フィールドの alias 出現回数、クエリの深さ・幅（複雑度スコア）に上限を設ける。多くの GraphQL サーバは複雑度制限・深さ制限・バッチ無効化のオプションを持つ。
- **introspection とサジェストを本番で絞る**：攻撃面の下見を難しくする（ただしこれは緩和であって根本対策ではない）。
- **検出は batchQL のようなツールで自動化しつつ、実証は許可範囲・非破壊で行う**：「query-name batching が通るか」「JSON配列が通るか」の判定までは無害に確認でき、そこが通る時点で上記のカウンタ設計を見直すべきサインになる。

第4章の残りでは、この「増幅」がDoS（深いネスト・循環クエリ）方向にも使えること、そして injection 系の攻撃面へと話を進める。

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

## 実例: 循環クエリDoSの再現と全スペクトラム評価

GraphQLの「深いネスト（入れ子）」がDoS（サービス妨害）につながる原理は抽象的に語られがちですが、本節では**実際に報告・実演された2つの一次資料**を通じて、なぜ・どこまで危険なのか、そしてどう防ぐのかを仕組みレベルで解剖します。1つ目は本番のGitLabに対して報告された循環クエリDoS（HackerOne #638282 / GitLab Issue #30096）、2つ目は学習用の脆弱アプリDVGA（Damn Vulnerable GraphQL Application）を使ったフルスペクトラム評価です。

> ⚠️ **スコープ注意**: 本節は防御目的の解説です。掲載するクエリは「なぜ危険か」を理解するための最小例であり、実在サービスや本番環境への無許可の検証・負荷生成に使ってはいけません。攻撃の再現は、自分で管理する学習用環境（例: DVGA）に限定してください。

### なぜGraphQLの「循環」がDoSの温床になるのか

まず前提を整理します。GraphQLのスキーマは**型（type）同士が相互に参照し合うグラフ構造**です。たとえば「プロジェクト」型が「パイプライン」のリストを持ち、その「パイプライン」型が再び「プロジェクト」を指す、というように、A→B→A→B…と行き来できる関係を**循環関係（circular / bidirectional relationship）**と呼びます。

ここで効いてくるのがGraphQLの実行モデルです。GraphQLサーバは、クエリで指定された各フィールドに対して**リゾルバ（resolver: そのフィールドの値を計算・取得する関数）**を1つずつ呼び出します。ネストが深くなると、上位フィールドが返した各要素についてさらに下位リゾルバが呼ばれるため、**フィールドが返す要素数（分岐数）× ネスト段数**の掛け算で呼び出し回数が増えます。

- あるフィールドが平均 *n* 件のリストを返し、
- それを *d* 段ネストすると、

葉ノードでのリゾルバ呼び出し数はおおむね *n^d* に比例します。これは**指数関数的な増加（exponential blowup）**です。クエリ本文（リクエスト側）は1段増やしても数十バイトしか増えないのに、サーバ側のCPU時間・メモリ・レスポンスサイズは桁違いに膨らむ——この「入力コストと処理コストの非対称性」こそがGraphQL DoSの核心です。HTTPリクエストの本数で殴る従来のボリューメトリックなDDoSと違い、**たった1本の小さなリクエストで**サーバを飽和させられる点が質的に異なります。

さらに厄介なのは、この循環がスキーマの至るところに潜在することです。開発者が明示的に作らなくても、**イントロスペクション（introspection: スキーマ自体を問い合わせるGraphQL標準機能）**のメタ型 `__Type` は `fields → type → fields → type …` と本質的に自己参照するため、循環はほぼ必ず存在します。

### 実報告: GitLab Issue #30096 / HackerOne #638282

2019年7月9日、`freddd` 氏がHackerOne経由でGitLabに報告した脆弱性です（HackerOne report #638282、GitLab Issue #30096）。対象は当時の `https://gitlab.com/api/graphql` エンドポイントで、**認証不要（unauthenticated）**で悪用可能でした。

報告者はイントロスペクションの循環を使い、`__schema` の型情報を `fields → type → fields → type …` と繰り返しネストするクエリを提出しました。骨子は次の通りです。

```graphql
query allSchemaTypes {
  __schema {
    types {
      fields {
        type {
          fields {
            type {
              fields {
                type {
                  fields {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

**なぜこれが効くのか**: `__schema.types` はスキーマ中の全型を返す大きなリストです。各型の `fields` を辿り、その各フィールドの `type` を辿り、さらにその `fields`…と進むたびに、参照される型集合が掛け算的に広がります。イントロスペクションのメタ型は循環しているため、`fields → type → fields` のペアを何段でも積み増せます。リクエスト本文は1段あたり十数バイト増えるだけですが、サーバは全型を再帰的に展開して巨大なJSONを組み立てなければなりません。

報告に記録された**具体的な数値**が、この非対称性を雄弁に物語ります。

| ネスト段数 | レスポンスサイズ | 実行時間 |
|---|---|---|
| ベース（浅い） | 約 93.5 KB | — |
| ＋1段 | 約 139.36 KB | — |
| 最大テスト時 | 約 2.35 MB | 18,341 ms（約18秒） |

- **1段追加しただけ**でレスポンスが 93.5 KB → 139.36 KB へと約1.5倍に膨張しています。クエリ側の増分（数十バイト）に対し、応答は数万バイト単位で増える。
- 最大テストでは**単一リクエストで約18秒間**サーバのスレッドを占有し、2.35 MBを生成しました。並行してこの手のクエリを多数投げれば、CPUとRAMを枯渇させられます。

報告者はさらに、**「ネスト深度にサーバ側の上限がないため、理論上は無限に深くできる」**点を強調しました。そして重要な観察として、**この問題はイントロスペクションに限らない**——スキーマ中のあらゆる循環関係（例: プロジェクト⇄パイプライン⇄プロジェクトのような業務データの相互参照）で同じ増幅が起きる、と指摘しています。悪意あるスクリプトが循環を突く並列クエリを生成すれば、サーバのCPU/RAMを消費させられる、というのが結論です。

推奨された緩和策（報告者はApollo GraphQLの「悪意あるクエリ防止」ブログを参照）は次の3つでした。

- **深度制限（depth limiting）**: ネスト段数に妥当な上限を設ける。
- **複雑度解析（complexity analysis）**: クエリの計算コストを見積もり、閾値超過を拒否する（コストベースのレート制限）。
- **クエリサイズ制限**: リクエスト本文の最大サイズを制限する。

> 出典: GitLab Issue #30096「Nested GraphQL query with circular relationship can cause DoS」（HackerOne #638282） — https://gitlab.com/gitlab-org/gitlab/-/issues/30096

#### GitLabがどう塞いだか（対策の一般解説）

> （以下は、GitLab Issue #30096の公開ページからは個々の実装コメント・確定値・修正バージョンまでは自動取得できなかったため、GraphQL防御の一般知識に基づく補足解説です。導入する際は必ず自プロジェクトの現行ドキュメントで最新の既定値を確認してください。）

GitLabのバックエンドはRuby実装の `graphql-ruby` を採用しており、この種のDoSに対する標準的な打ち手は次の2つです。

- **`max_depth`（最大深度）**: 例えば深度15を超えるネストを拒否する。イントロスペクションのメタ型も含めて再帰の段数に硬い天井を設ける。
- **`max_complexity`（最大複雑度）**: 各フィールドに「コスト点」を割り当て、リストを返すフィールドには接続数（ページサイズ）を掛けた重みを乗せる。合計がしきい値を超えるクエリは実行前に弾く。

`graphql-ruby` ではスキーマ定義に次のように書きます（値は例示）。

```ruby
class GitlabSchema < GraphQL::Schema
  # ネスト段数の上限。循環クエリの「無限に深くできる」問題を直接封じる
  max_depth 15
  # クエリ全体のコスト上限。n^d の指数増加を「点数」で見積もって遮断する
  max_complexity 200

  # リストを返すフィールドは「ページサイズ×子コスト」で重みづけする例
  # （接続数が大きいほど高コストになり、増幅を点数として捕捉できる）
end
```

**なぜ深度制限だけでは不十分で、複雑度も必要か**: 深度制限は「縦の深さ」しか見ません。深さが浅くても、1段の中で巨大なリスト（横方向の分岐 *n*）を大量に要求すれば負荷は跳ね上がります。逆に複雑度解析は縦横両方をコスト点として合算できるため、`n^d` の増幅そのものを見積もって遮断できます。両者は補完関係にあり、併用が定石です。実運用では、これに**クエリ実行タイムアウト**（1クエリあたりの最大実行秒数）と**本番でのイントロスペクション無効化**を重ねます。

### 実演: DVGAでの循環ネストDoS（Kiza「フルスペクトラム評価」）

2つ目の資料は、学習用の意図的脆弱アプリ **DVGA（Damn Vulnerable GraphQL Application）** を対象にした、GraphQLセキュリティの網羅的評価レポートです。DVGAはDolev Farhi氏らによるOSSで、DoS・情報漏えい・コード実行・認証バイパス・SQLインジェクション・認可欠陥などを一通り体験できる練習環境です。

> ⚠️ **未取得の資料**: 「Exploiting GraphQL: A Full-Spectrum Security Assessment（Kiza, Medium）」は本文をWebFetchで自動取得できませんでした（理由: HTTP 403 Forbidden。ミラーサイト経由も名前解決に失敗）。以下のURLからご自身で直接ご覧ください: https://kizerh.medium.com/exploiting-graphql-a-full-spectrum-security-assessment-covering-introspection-injection-and-560f49a44f36
>
> なお、記事の要旨は検索経由で取得できたため、以下ではその要約に基づいて記述し、DVGA固有のクエリ例など細部は一般知識で補います（補足箇所は明示します）。

記事が扱う論点は「フルスペクトラム（全域）」の名の通り3系統です。

#### (1) 循環ネストDoS

記事は、**双方向関係（bidirectional relationship）が再帰的ネストを可能にする**ことを出発点に、循環するオブジェクト関係を繰り返し辿らせる深いネストクエリが**リゾルバの実行コストを劇的に増やす**と説明しています。その帰結は、

- 過剰なCPU消費、
- メモリ使用量の増大、
- レスポンスの長時間化、
- バックエンドのスレッド枯渇（thread exhaustion）、

であり、しかも**従来のボリューメトリックなDDoS対策を回避してしまう**（少数の小さなリクエストで成立するため、リクエスト数ベースの検知に引っかからない）と指摘します。これはGitLabの実報告で観測された非対称性と完全に一致する現象です。

DVGAのスキーマには `Paste`（貼り付けデータ）と、その作者を表す `owner`、さらに `owner` が持つ `pastes` …といった相互参照があり、これを使うと循環ネストを組めます。学習環境での再現イメージは次の通りです（値は例示。DVGAの実物フィールド名はバージョンで異なり得ます）。

```graphql
# （以下はDVGAでの循環ネストDoSの構造を示す一般知識ベースの例）
query CircularNesting {
  pastes {
    owner {
      pastes {
        owner {
          pastes {
            owner {
              pastes { title }   # このペアをさらに積み増すほど n^d で膨張
            }
          }
        }
      }
    }
  }
}
```

**なぜ膨らむのか**: `pastes → owner → pastes → owner …` は循環関係です。各 `pastes` が複数件を返し、各 `owner` がまた複数の `pastes` を返すため、段を重ねるごとに評価対象がネズミ算式に増えます。DVGAには深度・複雑度の制限が（デフォルトでは）ないので、この構造がそのままDoSになります。

#### (2) イントロスペクションと情報漏えい

記事は、**設定不備のGraphQLアプリが詳細なスタックトレースを露出**し、そこからアプリのフレームワーク、ランタイム構成要素、**絶対ファイルパス**などの内部実装詳細が判明する様子を実演しています。GraphQLは既定でイントロスペクションが有効なことが多く、`__schema` / `__type` を問い合わせれば全型・全フィールド・引数・非推奨情報まで機械可読で入手できます。これは攻撃者にとって「地図」を渡すに等しく、DoS対象の循環関係を探す下調べにも直結します。

**なぜ危険か**: エラーメッセージにスタックトレースや内部パスが載ると、使用ライブラリのバージョンや配置が推測でき、既知脆弱性やインジェクション経路の特定が容易になります。本番ではイントロスペクション無効化と**エラー詳細のマスキング**（クライアントには汎用メッセージのみ返す）が必須です。

#### (3) インジェクションとリゾルバの弱点

記事はGraphQLを**高権限インターフェース**として扱うべきだと結論づけ、リゾルバ層での入力サニタイズ・認可チェックの欠如がSQLインジェクションや認可バイパスにつながることを示します。GraphQLは「単なる薄いクエリ層」ではなく、各リゾルバが実データストアに触れる境界であるため、REST同様にサニタイズと認可を各リゾルバで徹底する必要があります。

記事が挙げる防御の要点は次の通りです。

- 本番での**イントロスペクション無効化**
- **クエリ深度制限（depth limiting）**
- **入力サニタイズ（input sanitization）**
- **リゾルバ単位の認可チェック（resolver-level authorization）**
- **堅牢なエラーハンドリング**（内部情報を漏らさない）

> 出典: Kiza「Exploiting GraphQL: A Full-Spectrum Security Assessment Covering Introspection, Injection, and Resolver Weaknesses」（Medium） — https://kizerh.medium.com/exploiting-graphql-a-full-spectrum-security-assessment-covering-introspection-injection-and-560f49a44f36

### 2資料から導く防御チェックリスト

両資料を突き合わせると、循環クエリDoSに対する多層防御（defense in depth）の輪郭がはっきりします。単一の対策に頼らず、以下を重ねるのが実務の答えです。

1. **深度制限（max depth）**: ネスト段数に硬い上限（例: 10〜15）。イントロスペクションの循環も含めて無限ネストを封じる、最も直接的な栓。
2. **複雑度／コスト解析（max complexity, query cost analysis）**: フィールドごとにコスト点を割り当て、リストは「ページサイズ×子コスト」で重みづけ。`n^d` の増幅を点数化して**実行前に**遮断する。深度制限で捕まらない「浅く広い」クエリを補完する。
3. **クエリ実行タイムアウト**: 1クエリあたりの最大実行秒数を設定し、GitLab報告の「18秒占有」のような長時間ブロックを断ち切る。
4. **ページネーションの上限（amount limiting）**: `first` / `last` などの取得件数に上限を設け、単段の分岐数 *n* を抑える。
5. **本番でのイントロスペクション無効化**とエラー詳細のマスキング: スキーマ地図と内部パスの漏えいを防ぎ、DoS用の循環探索を困難にする。
6. **リゾルバ単位の認可・サニタイズ**: DoS以外（認可バイパス・インジェクション）も同じ入口で塞ぐ。
7. **バッチ／エイリアス（alias）乱用への配慮**: 深度・複雑度制限は、同一フィールドをエイリアスで多数並べる横展開や、配列バッチによる増幅とも合わせて評価する（本章の他節と併読）。

**最重要の考え方**は、GitLab報告が示した「入力コストと処理コストの非対称性」を常に念頭に置くことです。リクエストの大きさ・本数で危険度を測る従来の直感はGraphQLでは通用しません。**サーバが実際に何回リゾルバを呼び、どれだけメモリを確保するか**を、実行前に静的解析（深度・複雑度）で見積もって遮断する——これがGraphQL DoS対策の本質です。

> 出典: GitLab Issue #30096 / HackerOne #638282 — https://gitlab.com/gitlab-org/gitlab/-/issues/30096 ／ Kiza「Exploiting GraphQL: A Full-Spectrum Security Assessment」（Medium） — https://kizerh.medium.com/exploiting-graphql-a-full-spectrum-security-assessment-covering-introspection-injection-and-560f49a44f36

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

## 実習: ブルートフォース保護バイパスとGraphQL CSRF

本節では PortSwigger Web Security Academy の2つのラボを題材に、前節までで学んだ「alias/batching によるレート制限バイパス」と「GraphQL 特有の CSRF」がどのような具体的シナリオで成立するかを、原理レベルで解き明かす。ラボそのものの攻略手順（どのペイロードを送れば解けるかという解答）は本書のスコープ外であり、記載しない。あくまで「なぜその脆弱性が起こるのか」という仕組みの理解に絞って解説する。以降の内容は防御目的であり、実在サービスや本番環境への無許可の検証・破壊的な手順は一切扱わない。

### ラボ1: Bypassing GraphQL brute force protections

#### ラボが扱う状況

このラボは、GraphQL API 上に実装されたログイン機能を題材にしている。エンドポイントには「同一オリジンから短時間に大量のリクエストが送られるとエラーを返す」レート制限機構が組み込まれている。表面的には、一般的な Web アプリのログインフォームと同じ発想の防御だ。パスワード試行を1リクエスト=1回とカウントし、一定回数を超えたら遮断する、というものである。

> 出典: PortSwigger「Bypassing GraphQL brute force protections」 — https://portswigger.net/web-security/graphql/lab-graphql-brute-force-protection-bypass

#### なぜこの防御は GraphQL では機能しないのか

レート制限の実装は、大半が HTTP リクエストという通信の単位でカウントする。ロードバランサやリバースプロキシ、WAF、あるいはアプリケーション層のミドルウェアが「送信元 IP ごと・セッションごとに1分間で何リクエスト届いたか」を数え、閾値を超えたら 429 やカスタムエラーを返す構成が一般的だ。この設計は、REST API や従来のフォーム送信のように「1回の操作 = 1回の HTTP リクエスト」という前提が成り立つ限り機能する。

しかし GraphQL はこの前提を崩す。前節(s4a)で扱った通り、GraphQL の実行モデルは1つの operation（`query`/`mutation`/`subscription` のいずれか1単位）の中に複数のフィールド呼び出しを含められ、しかも `alias`（同一フィールドを異なる名前で複数回呼び出す標準機能）を使えば、同じ `login` フィールドを何度でも並べられる。GraphQL 仕様（2018年6月版, 6.3.1節「Normal and Serial Execution」）では、mutation 内の複数フィールドは直列（serial）に、つまり1つずつ確実に解決されると定められている。したがって、次のような1通の GraphQL リクエストを送ると、サーバは律儀に3回すべてのログイン試行を実行する。

```graphql
mutation {
  bruteforce0: login(input: {password: "123456", username: "carlos"}) { token success }
  bruteforce1: login(input: {password: "password", username: "carlos"}) { token success }
  bruteforce2: login(input: {password: "qwerty", username: "carlos"}) { token success }
}
```

このリクエストは HTTP の観点から見れば「POST 1回」でしかない。だからレート制限のカウンタは「+1」としか増えない。ところがアプリケーション内部では `login` リゾルバ（GraphQL のフィールドに対応する実処理関数）が3回呼び出され、3通りのパスワードが実際に検証にかけられている。**防御が数えている単位（HTTP リクエスト）と、攻撃者が実際に稼働させている単位（operation フィールド＝ログイン試行）がずれている**ことが、このバイパスが成立する根本原因である。

alias の数に理論上の上限はない（サーバ側で明示的に制限していない限り）。したがって、辞書攻撃用のパスワードリストが数千語あっても、1通〜数通のリクエストに alias として詰め込めば、HTTP リクエスト数ベースの「1分間に◯回まで」といった防御をほぼ無効化できる。4桁の数値コード(OTP等)であれば候補は10,000通りしかないため、10,000個の alias を1リクエストに収める、あるいはボディサイズの上限に合わせて1,000件ずつ10リクエストに分割しても、どのようなリクエスト単位のレート制限をも実質的に下回ってしまう。

#### なぜ「アカウントロック」も無力化されうるか

同じ理屈は、失敗回数によるアカウントロックにも当てはまる場合がある。ロック処理がリクエストの到達順に1件ずつ「失敗カウンタを+1して閾値判定」する実装であればまだ機能する余地はあるが、**アプリケーション側がリゾルバの実行結果をすべて集めてから最後にまとめて判定する**設計や、バッチ内の各フィールドを並行に評価してロック判定のタイミングがずれる実装では、1回のリクエスト内で許容回数をまとめて超過しても検知が追いつかないケースがある。結局のところ、根本原因は「HTTP リクエスト数」を防御の単位に据えたこと自体にあり、GraphQL の operation 内部で何が起きているかを見ていない限り、この種のバイパスの入口は塞がらない。

#### 防御側の対策

ラボページ自体には具体的な実装まで踏み込んだ記述はないが、前節までの資料(Wallarm・Escape.tech・PentesterLab 等)と合わせて整理すると、有効な対策は次のように層を重ねる形になる。

- **リクエスト単位ではなく operation/フィールド単位でカウントする**：1リクエスト内の alias/バッチ要素数を数え、ログインのような機微な操作フィールドについては「フィールドの呼び出し回数」を集計してレート制限に反映する。
- **alias 数・バッチ要素数そのものに上限を設ける**：1クエリあたりの alias 数、配列バッチングの要素数、ユニークなルートフィールド数に明示的な上限を設定する。
- **クエリの複雑度・コスト分析を導入する**：クエリを実行する前に、フィールド数や深さからコストを見積もり、閾値を超えるリクエストを拒否する。
- **機微な操作（ログイン・OTP検証等）を GraphQL の外に切り出す**：認証のような総当り耐性が特に重要な処理は、別の REST エンドポイントに分離し、そちらで従来型のレート制限・CAPTCHA・段階的遅延を適用するという設計判断も有効である。

### ラボ2: Performing CSRF exploits over GraphQL

#### ラボが扱う状況

このラボのユーザー管理機能は GraphQL エンドポイントで実装されており、そのエンドポイントは `Content-Type: application/x-www-form-urlencoded` のリクエストを受け付けてしまう。この一点が、CSRF（Cross-Site Request Forgery: 被害者のブラウザに正規の認証情報＝Cookie を使わせたまま、攻撃者が用意したページから意図しないリクエストを送らせる攻撃）を成立させる根本原因になっている。

> 出典: PortSwigger「Performing CSRF exploits over GraphQL」 — https://portswigger.net/web-security/graphql/lab-graphql-csrf-via-graphql-api

#### なぜ GraphQL は本来 CSRF に強く、なぜこのラボでは崩れるのか

まず前提として、GraphQL の GraphQL API は多くの場合 `application/json` の POST リクエストとしてクエリ/ミューテーションを送る設計になっている。ここで効いてくるのが、ブラウザの Cross-Origin リクエストに関する仕様上の制約である。

`application/json` を Content-Type に指定した POST リクエストは、ブラウザの仕様上「シンプルリクエスト（simple request）」の条件を満たさない。シンプルリクエストとして扱われる Content-Type は `application/x-www-form-urlencoded`・`multipart/form-data`・`text/plain` の3種類に限られており、それ以外（`application/json` を含む）を指定したクロスオリジンリクエストは、ブラウザが本番リクエストを送る前に**プリフライトリクエスト（OPTIONS メソッドによる事前確認）**を必ず発行する。サーバ側が CORS ヘッダでそのオリジンを許可していなければ、ブラウザは本番リクエストの送信自体を止める。さらに、HTML の `<form>` タグは `enctype` に `application/json` を指定できないため、そもそも素のフォーム送信で JSON ボディを組み立てることができない。

つまり「POST リクエストで、Content-Type が `application/json` であり、かつサーバがその Content-Type を検証している」という条件が揃っている限り、攻撃者の Web ページから通常のフォーム送信や `fetch` の単純呼び出しで偽の GraphQL リクエストを送り込むことは、ブラウザの仕組みそのものによって妨げられる。これが「GraphQL API は（正しく実装されていれば）本質的に CSRF に強い」とされる理由である。

このラボの脆弱性は、この前提が崩れているケースを扱う。エンドポイントが `x-www-form-urlencoded` という**シンプルリクエストの対象 Content-Type**を受け付けてしまう。`x-www-form-urlencoded` は通常の HTML `<form>` からブラウザ標準の機能だけで送信できる形式であり、CORS のプリフライトも発生しない。さらに重要なのは、**ブラウザは Cookie を「そのリクエストがどのオリジンから発行されたか」に関わらず、宛先オリジンに紐づく Cookie を自動的に付与する**という挙動だ（`SameSite` 属性が `Strict`/`Lax` に設定されていない、あるいは `Lax` でも POST のトップレベルナビゲーションでない通常のフォーム送信は送られない設定次第で挙動が変わる)。つまり、被害者が対象サイトにログイン済み（セッション Cookie を保持している）状態で、攻撃者が用意した外部サイトを閲覧すると、そのページ上の自動送信フォームが `x-www-form-urlencoded` 形式で GraphQL エンドポイントへ POST し、ブラウザは律儀に被害者のセッション Cookie を一緒に送ってしまう。サーバ側は「Cookie が正しい＝正規のリクエスト」としか判断できず、リクエストの発生元が悪意あるサイトであることを検出できない。

このラボが題材にしているのは、GraphQL のミューテーションを使ってビューアのメールアドレスを変更する操作である。本来 JSON ボディで送るはずのミューテーションを、URL エンコードされたフォームデータとして送信できてしまう(GraphQL サーバの多くは `query`・`variables`・`operationName` をキーとする単純なキー・バリュー形式でもクエリを受理できるように実装されており、これが `x-www-form-urlencoded` 経由の送信を可能にしてしまう場合がある)。

#### GraphQL 特有の落とし穴: CSRF トークンだけでは不十分な理由

一般的な CSRF 対策として広く使われる「CSRF トークン(ページ内に埋め込まれた推測不能な値をリクエストに含め、サーバ側で検証する仕組み)」は、GraphQL エンドポイントにおいても有効な対策の一つである。しかし GraphQL API は「単一のエンドポイントに、あらゆる操作をクエリ/ミューテーションとしてまとめて受け付ける」という構造的特徴を持つため、次の点に注意が必要になる。

- CSRF トークンの検証を**エンドポイント全体（ミドルウェア層）で一律に行う**必要がある。REST であれば「このパスだけトークン必須」といった個別対応も可能だが、GraphQL では単一の `/graphql` パスの下にあらゆる operation が乗るため、operation の種類ごとに検証の有無が分かれるような実装は漏れの温床になる。
- `query`（読み取り専用）と `mutation`（状態変更を伴う）を区別し、状態を変更する mutation にはトークン検証を必須化するなど、GraphQL の文法を解析した上での防御が必要になる場合がある。

#### 防御側の対策

WebFetch で取得した PortSwigger の解説ページでは、GraphQL の CSRF 対策として次の3点が明示されている。

- **JSON エンコードされた POST リクエストのみを受け入れる**：`application/x-www-form-urlencoded` や `multipart/form-data`、あるいは Content-Type 未指定のリクエストをサーバ側で拒否する。
- **提供された Content-Type ヘッダが実際のボディ形式と一致することを検証する**：Content-Type ヘッダを名乗るだけで中身が伴っていないリクエストを弾く。
- **確実な CSRF トークン機構を導入する**：推測不能なトークンをセッションに紐づけ、状態変更を伴うすべての操作でその値を検証する。

> 出典: PortSwigger「GraphQL API vulnerabilities」 — https://portswigger.net/web-security/graphql

これに加えて、Cookie に `SameSite=Strict` または `SameSite=Lax` を設定することも、多くのケースで有効な多層防御になる。`SameSite=Lax` はトップレベルのナビゲーション（リンククリックによる GET 遷移など）では Cookie を送信するため、状態変更を伴う GraphQL mutation を GET で受け付ける実装が残っていると防御が不完全になる点には注意したい。「GraphQL の mutation を GET で受け付けない」という設計判断自体も、CSRF 対策の一部として機能する。

### 2つのラボが示す共通の教訓

一見別々の脆弱性に見えるこの2つのラボは、実は同じ構造的問題の異なる現れ方である。すなわち、**GraphQL が単一エンドポイント上に多様な操作をまとめて受け付ける柔軟な設計を持つがゆえに、REST API や伝統的な Web フォームを前提に作られた防御機構(HTTP リクエスト単位のレート制限、Content-Type を前提としない CSRF 対策の欠如)が、そのまま素通りしてしまう**という点である。GraphQL API を守るには、「GraphQL は内部で何を実行しているか(operation・フィールド・alias の単位)」まで踏み込んだ防御設計が必要になる。


---

[📖 目次](index.md) ・ [← 第3章 認可・アクセス制御の脆弱性 (BOLA/BFLA)](03-authorization-bola-bfla.md) ・ [第5章 ツールと方法論 →](05-tools-methodology.md)
