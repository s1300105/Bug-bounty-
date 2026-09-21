## GraphQL recon の定番手法とintrospection無効時の復元

このセクションでは、GraphQL エンドポイントを対象にした偵察（recon）の定番手順を、原理レベルで整理する。GraphQL は REST と違い「1 本のエンドポイントに対して、クライアントが取得したい構造をクエリで宣言する」設計であるため、攻撃者・防御者の双方にとって最初に必要なのは「そのサーバがどんな型（type）・フィールド（field）・ミューテーション（状態を変える操作）を公開しているか」という **スキーマ（schema, API の全体構造の定義）** の把握である。スキーマが分かれば攻撃対象領域（attack surface）が丸見えになる。したがって偵察の勝負どころは「(1) GraphQL エンドポイントを見つける」「(2) スキーマを introspection で取り出す」「(3) introspection が無効なときにスキーマを復元する」の 3 段階に集約される。

> 本セクションは防御・診断の理解を目的とする。実在サービスや本番環境への無許可の検証、破壊的な手順は扱わない。以降のクエリ例はすべて、自分が管理する検証環境や明示的に許可された対象に限定して用いること。

### 1. GraphQL エンドポイントの発見

#### よくあるパス

GraphQL は Apollo をはじめとする各種フレームワークで実装されるが、公開されるパスには強い定番がある。YesWeHack の記事は、フレームワークが使いがちな標準パスとして次を挙げている。

```
/graphql
/graphiql
/graphiql.php
/graphql.php
/graphql/console/
/graph
/v1/graphiql
/v1/explorer
```

`/graphql` が実行用エンドポイント、`/graphiql`（IDE 名は「GraphiQL」）や `/v1/explorer` は **ブラウザ上でクエリを試せる IDE（統合開発環境）** に対応する。IDE が本番で生きていると、そこから introspection もクエリ実行も一気にできてしまうため、それ自体が重要な発見となる。網羅的なパス辞書は SecLists（著名な単語リスト集）に収録されている、と YesWeHack は述べている。

> 出典: Hacking GraphQL endpoints in Bug Bounty Programs — https://www.yeswehack.com/learn-bug-bounty/hacking-graphql-endpoints

#### JavaScript からの発見

パス総当たりだけでは、公式ドキュメントに載らない「非公式・廃止予定のエンドポイント」を取りこぼす。YesWeHack は、フロントエンドの JavaScript ファイルを収集し、`query` / `mutation` / `graphql` といったキーワードで grep することを推奨している。SPA（シングルページアプリ）は GraphQL クエリ文字列をバンドル JS に埋め込むことが多く、そこから実在のフィールド名・エンドポイント URL・場合によっては未公開の管理系操作まで露出することがある。これは introspection とは独立した情報源であり、後述の「introspection 無効時の復元」でも初期の当たり（既知フィールド）を与えてくれる点で価値が高い。

> 出典: Hacking GraphQL endpoints in Bug Bounty Programs — https://www.yeswehack.com/learn-bug-bounty/hacking-graphql-endpoints

#### `__typename` による存在確認

候補 URL が本当に GraphQL かを最小コストで判定する定番が、Intigriti の挙げる「ユニバーサルクエリ」である。

```graphql
{__typename}
```

`__typename` は GraphQL 仕様が全オブジェクト型に自動で持たせる **メタフィールド（meta field, スキーマ側が予約している特別なフィールド）** で、現在解決中の型名を文字列で返す。したがって任意の正しい GraphQL サーバは、追加のスキーマ知識なしに `{"data":{"__typename":"Query"}}` のような応答を返す。逆に 400/404 や別形式のエラーになれば GraphQL ではない、あるいはパスが違うと判断できる。「なぜ確実か」というと、`__typename` はビジネス上のスキーマ定義に依存せず、GraphQL の型システムが必ず提供する予約フィールドだからである。ルート型の名前は慣例的に `Query` だが、実装により異なることもある点は覚えておきたい。

> 出典: Five easy ways to hack GraphQL targets — https://www.intigriti.com/researchers/blog/hacking-tools/five-easy-ways-to-hack-graphql-targets

#### エンジンのフィンガープリンティング（graphw00f）

Intigriti・YesWeHack の両記事が挙げる **graphw00f** は、「どの GraphQL エンジン実装か」を推定するツールである。Apollo（JS）、graphql-js、graphene（Python）、Ruby graphql、HyperGraphQL など、実装ごとにエラーメッセージの文言・特定の不正クエリへの応答・サポートするバッチ形式などが微妙に異なる。graphw00f はこうした挙動差（判別用の細工クエリを投げ、応答の指紋を照合する）からエンジンを言い当てる。エンジンが分かる意味は大きい。なぜなら「introspection がデフォルトで有効か」「フィールドサジェスト（後述）を返すか」「バッチをどう受けるか」がエンジンごとに決まっているため、以降の偵察方針をエンジンに合わせて最適化できるからである。たとえば後述のフィールドサジェストは Apollo / graphql-js 系で特に顕著に効く。

> 出典: Five easy ways to hack GraphQL targets — https://www.intigriti.com/researchers/blog/hacking-tools/five-easy-ways-to-hack-graphql-targets ／ Hacking GraphQL endpoints in Bug Bounty Programs — https://www.yeswehack.com/learn-bug-bounty/hacking-graphql-endpoints

### 2. Introspection によるスキーマ取得

#### introspection とは何か

**introspection（内省）** は、GraphQL 仕様が定める「スキーマ自身を問い合わせるための仕組み」である。`__schema` や `__type` という予約クエリを通じて、型・フィールド・引数・enum 値・説明文（description）まで機械可読な形で取得できる。GraphiQL などの IDE がドキュメントを自動表示できるのは、この introspection を裏で叩いているからだ。Intigriti は「introspection はデフォルトで有効だが、本番では返す情報を絞るため無効化するのがベストプラクティス」と明記している。つまり「有効なら攻撃対象領域が全部読める」という強力な機能であり、防御側は本番で無効化すべき対象、という位置づけになる。

最小の確認クエリはこれで足りる。

```graphql
{__schema{types{name}}}
```

これはスキーマ内の全型名だけを列挙する軽量クエリで、introspection が有効かどうかの判定に使える。

> 出典: Five easy ways to hack GraphQL targets — https://www.intigriti.com/researchers/blog/hacking-tools/five-easy-ways-to-hack-graphql-targets

#### フルスキーマ取得クエリ

introspection が有効なら、スキーマ全体を一発で吸い出す標準クエリを使う。YesWeHack が掲載している「フル introspection クエリ」は次の通り（改行なしの実物）。

```graphql
{__schema{queryType{name}mutationType{name}subscriptionType{name}types{...FullType}directives{name description locations args{...InputValue}}}}fragment FullType on __Type{kind name description fields(includeDeprecated:true){name description args{...InputValue}type{...TypeRef}isDeprecated deprecationReason}inputFields{...InputValue}interfaces{...TypeRef}enumValues(includeDeprecated:true){name description isDeprecated deprecationReason}possibleTypes{...TypeRef}}fragment InputValue on __InputValue{name description type{...TypeRef}defaultValue}fragment TypeRef on __Type{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name}}}}}}}}
```

このクエリの構造を分解すると、教科書的に重要な点が見える。

- `queryType` / `mutationType` / `subscriptionType`：3 種類の **ルート操作型**（読み取り／状態変更／購読）の入口。ミューテーション型の有無で「状態変更操作が存在するか」がまず分かる。
- `types{...FullType}`：全型を `FullType` フラグメントで展開し、各型の `fields`（引数 `args`・戻り型 `type`・非推奨フラグ `isDeprecated` 込み）、`inputFields`（入力型のフィールド）、`interfaces`、`enumValues`、`possibleTypes`（ユニオン/インターフェースの実体型）まで取る。
- `includeDeprecated:true`：**非推奨（deprecated）フィールドも含めて取得**する指定。これが偵察上とても重要で、廃止予定として隠したつもりのフィールドが露出する。
- `fragment TypeRef` の入れ子（`ofType` を 7 段）：GraphQL の型は `[User!]!`（非 null のリストの非 null 要素…）のように **ラッパ型（NonNull / List）が入れ子**になる。`ofType` を辿らないと本当の型名にたどり着けないため、想定される最大ネスト分だけ再帰的に展開している。ここを浅くすると深い型の名前が `null` になって取りこぼす、という「なぜ 7 段も書くのか」の答えがこれである。

取得した JSON スキーマは、**GraphQL Voyager**（スキーマを型の関係グラフとして可視化する UI）に読み込ませると、型同士の参照関係が一目で把握できる。Intigriti・YesWeHack ともに Voyager を推している。また **InQL**（CLI 版と Burp Suite 拡張版がある）は introspection の実行、スキーマからのクエリ／ミューテーションのテンプレート自動生成まで行い、複数の探索手法を備える。

> 出典: Hacking GraphQL endpoints in Bug Bounty Programs — https://www.yeswehack.com/learn-bug-bounty/hacking-graphql-endpoints ／ Five easy ways to hack GraphQL targets — https://www.intigriti.com/researchers/blog/hacking-tools/five-easy-ways-to-hack-graphql-targets

### 3. Introspection 無効時のスキーマ復元

本セクションの核心。多くの本番環境は introspection を無効化しているが、それでも「フィールドサジェスト」という別の情報漏れ経路が残っていることが多い。

> ⚠️ **未取得の資料**: 「Exploiting GraphQL」（Assetnote／現 SearchLight Cyber。旧 URL は www.assetnote.io で、現在は www.slcyber.io/research/exploiting-graphql へ 301 リダイレクトする）は、リダイレクト先を取得できたものの、記事本文の一部（特にコード例やスキーマ復元の詳細）は要約レベルまでしか抽出できませんでした（理由: 動的レンダリング／要約経由の取得で原文コードが省略された可能性）。正確な原文は次からご自身で直接ご覧ください: https://www.slcyber.io/research/exploiting-graphql

以下、取得できた要点と、原理の補足を述べる。

#### フィールドサジェスト（did-you-mean）の仕組み

3 記事すべてが「introspection が無効でも **フィールドサジェスト（field suggestion）機能** が使える」と指摘する。YesWeHack の説明を引くと、「フィールドをわざと打ち間違えて（typo を含めて）クエリすると、GraphQL は意図に近いフィールドを提案してくれる」。たとえば存在しない `usr` を問い合わせると、`Cannot query field "usr" on type "Query". Did you mean "user"?` のようなエラーが返る。

「なぜスキーマを隠したはずなのに漏れるのか」を仕組みレベルで説明する。これはリファレンス実装 **graphql-js** に組み込まれた **バリデーション時の親切機能**である。クエリを実行する前に、GraphQL エンジンはフィールド名がスキーマに存在するか検証する。存在しないとき、graphql-js は候補生成のために**スキーマ上の実在フィールド名と、送られてきた名前との字句的な近さ（Levenshtein 距離に基づく「did-you-mean」ロジック）**を計算し、近いものをエラーメッセージに列挙する。つまりエラーメッセージ生成のためにサーバは内部で実在フィールド名にアクセスしており、introspection という「正規の窓口」を閉じても、この**エラー経由の裏口（サイドチャネル）**から実在名が一文字ずつ確認できてしまう。Intigriti は「Apollo GraphQL のフィールド自動提案が名前列挙に使える」と、エンジン依存である点も明記している。

> 出典: Hacking GraphQL endpoints in Bug Bounty Programs — https://www.yeswehack.com/learn-bug-bounty/hacking-graphql-endpoints ／ Five easy ways to hack GraphQL targets — https://www.intigriti.com/researchers/blog/hacking-tools/five-easy-ways-to-hack-graphql-targets

#### Clairvoyance によるスキーマ復元

Assetnote/SLCyber の記事が挙げる **Clairvoyance** は、このフィールドサジェストを自動化して「introspection 無効環境でもスキーマを機械的に復元する」ツールである。SLCyber の要約は Clairvoyance を「schema suggestions（＝エラーの提案）に基づいて GraphQL スキーマを自動復元し、さらに列挙を進める」ツールと説明し、HTTP プロキシ対応（デバッグ用途）を加えた **Clairvoyancex** というフォークにも触れている。

動作原理は次の通り（一般知識に基づく補足）。

1. 候補となるフィールド名のワードリストを用意する（一般的な API 語彙や、前述の JS 解析で得た既知名を種にする）。
2. ある型のコンテキストで、候補名を含む不正クエリを投げ、`Did you mean ...` の提案や「このフィールドは存在しない」エラーの差から、実在フィールドを判定する。
3. 実在が確定したフィールドの戻り型に対して、同じ手順を再帰的に適用し、型グラフを一段ずつ広げる。
4. 得られた断片を結合し、introspection なしで擬似スキーマ（SDL）を再構築する。

「なぜ完全復元でなく“近似”なのか」も重要だ。エラーメッセージは実在名を教えてくれても、その型・引数・非推奨情報まで全部は返さないことが多い。したがって Clairvoyance が復元するのはあくまでワードリストと提案の範囲での近似スキーマであり、ワードリストに無い独自命名のフィールドは取りこぼす。ここが introspection 有効時の「完全なスキーマ」との決定的な差になる。

YesWeHack はフィールドサジェストを突く手段として、Clairvoyance に加え、専用ファジングツールの **GraphQLmap**、汎用の **Burp Suite Intruder**（要設定）も挙げている。

> 出典: Exploiting GraphQL — https://www.slcyber.io/research/exploiting-graphql ／ Hacking GraphQL endpoints in Bug Bounty Programs — https://www.yeswehack.com/learn-bug-bounty/hacking-graphql-endpoints

#### 防御側の含意：サジェストも塞ぐ

以上から、防御側が introspection を無効化するだけでは不十分であることが分かる。フィールドサジェスト（did-you-mean）を本番で無効化し、詳細なパースエラー・バリデーションエラーをクライアントに返さない（一般化したエラーに丸める）ことまでやって、初めて「スキーマの裏口」を閉じられる。graphql-js 系では、エラーマスキングやプロダクション用のバリデーションルールでサジェストを抑止する構成が該当する。

### 4. バッチング（batching）と偵察・レート制限回避

偵察と隣接する重要トピックとして、3 記事が共通で扱う **バッチング** を押さえる。GraphQL は 1 リクエストに複数の操作を詰め込める。方式は 2 つある。

**(A) JSON 配列バッチ**：Assetnote/SLCyber が示すように、サーバがクエリの配列を受け付ける実装がある。

```json
[
  {"query":"query { field1 }"},
  {"query":"query { field2 }"}
]
```

配列で結果が返ってくれば「バッチ対応」と判定できる。SLCyber は、これが「4 桁 PIN を期待するパスワードリセット」のような機能で悪用され得る点を挙げる。理屈はこうだ。レート制限が **HTTP リクエスト単位** でカウントされている場合、1 リクエストの中に多数の試行を詰め込めば、リクエスト数を増やさずに大量試行が通ってしまう。4 桁 PIN なら理論上 10,000 通りを（実装が許せば）少数リクエストに圧縮できる、という話である。

**(B) エイリアスバッチ**：Intigriti・SLCyber が示すように、1 つのクエリ内で **エイリアス（alias, 同じフィールドを別名で複数回呼ぶ機能）** を使えば、単一クエリ本文の中で同じ操作を何度も実行できる。

```graphql
{
  a1: query { field }
  a2: query { field }
  a3: query { field }
}
```

「なぜレート制限を抜けるのか」は (A) と同根で、多くのレート制限が「1 HTTP リクエスト＝1 カウント」で数えており、リクエスト本文の中の**操作数**を見ていないためである。Intigriti はこれを明確に「レート制限回避」の文脈で挙げている。さらに、資源を食う重いクエリを大量にバッチすると、クエリ数制限を持たないサーバでは **DoS（サービス妨害）** に至り得る、と Intigriti は指摘する。関連ツールとして SLCyber は **BatchQL**（バッチクエリ／ミューテーションに焦点を当てた監査スクリプト）を、Intigriti は **BatchQL / GraphQL Cop（10 種以上のセキュリティテスト）/ Misconfig Mapper** を挙げている。

> 出典: Exploiting GraphQL — https://www.slcyber.io/research/exploiting-graphql ／ Five easy ways to hack GraphQL targets — https://www.intigriti.com/researchers/blog/hacking-tools/five-easy-ways-to-hack-graphql-targets

#### 偵察としての意味

バッチは攻撃手段であると同時に **偵察のシグナル** でもある。配列バッチやエイリアスの多重化に素直に応じるサーバは、「クエリ深度制限・複雑度制限・バッチ制限が未設定」である可能性が高い。防御側の観点では、introspection 無効化・サジェスト無効化に加えて、クエリ深度／複雑度（cost）制限、バッチ数の上限、操作単位のレート制限を導入することが、ここまでの偵察経路をまとめて塞ぐ対策になる。

### まとめ

- 偵察は「エンドポイント発見 → introspection 取得 → 無効時はサジェストで復元」の 3 段。`{__typename}` で存在確認、`{__schema{types{name}}}` で introspection 可否を判定し、フル introspection クエリでスキーマを吸い出す。
- introspection を無効化しても、graphql-js 系の **did-you-mean（Levenshtein 距離ベースのフィールドサジェスト）** がスキーマの裏口になる。**Clairvoyance / Clairvoyancex** がこれを自動化して近似スキーマを復元する。復元は「ワードリストと提案の範囲」に限られる点が、introspection 有効時との差。
- **バッチング**（JSON 配列・エイリアス）はレート制限や PIN 総当たり対策を回避し得る。多くのレート制限が HTTP リクエスト単位で操作数を見ないことが根本原因。
- 防御は多層で：本番で introspection とフィールドサジェストの両方を無効化し、詳細エラーを一般化し、クエリ深度／複雑度／バッチ数を制限する。

> 本セクションの記述は防御・診断の理解のためのものであり、許可された検証環境以外での実行を意図しない。
