# 第2章 Recon と introspection

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

## エンドポイント発見とスキーマ列挙

GraphQL APIへの攻撃（防御側から見れば「侵入テスト・脆弱性診断」）は、まず「そのエンドポイントが本当にGraphQLか」「どんなスキーマ（クエリ・ミューテーション・型の定義）を持つか」を突き止める偵察フェーズから始まる。REST APIと違い、GraphQLは単一のエンドポイント（多くは `/graphql`）に対してPOSTでクエリ本文を送る形式を取るため、URLパスだけでは中身が分からない。逆に言えば、この「発見」と「列挙（enumeration）」を防御的に理解しておくことは、本番環境で何が外部から見えているかを把握するうえで欠かせない。本節では、ASECの「GraphQL Hacking 101: Reconnaissance」と、DEVコミュニティの「GraphQL as Attack Surface」という2つの記事を軸に、エンドポイント発見からスキーマ列挙までの手法・原理・防御策を整理する。

### エンドポイントの発見（パッシブ／アクティブ偵察）

GraphQLサービスは、複数のポートやサブドメイン、ステージング環境に分散してデプロイされることが多い。ASECの記事は、まずポートスキャン（`nmap`）によって稼働中の全インスタンスを洗い出し、GraphiQLやGraphQL Playgroundといった開発用UIが有効なままのエンドポイントを探すことを推奨している。開発用UIはスキーマの自己文書化（ドキュメント生成）機能を持つため、見つかれば偵察はほぼ終わったに等しい。

一方DEVの記事は、能動的スキャンの前段としてパッシブOSINT（Open Source Intelligence、対象に直接アクセスせず公開情報から情報収集する手法）を強調する。ShodanやCensysのようなインターネット全体をスキャンして結果をインデックス化するサービスを使えば、GraphQLエンドポイントは能動的に叩く前から間接的に索引化されていることが多い。

```
http.body:"{\"data\":" http.body:"graphql" port:443
product:"GraphQL" http.status:200
```

このようなShodanクエリは、レスポンスボディに `{"data":` というGraphQL特有の応答形式や `graphql` という文字列が含まれるホストを横断的に検索する。なぜこれが機能するのかというと、GraphQLサーバーはエラー時であっても標準化されたJSON構造（`data` / `errors` フィールドを持つオブジェクト）を返すため、応答の「形」そのものがフィンガープリント（指紋、識別特徴）になるからである。intel.mago.teamやGoctopusといったツールは、この相関検索を自動化してエンドポイントの一覧を生成する。

パッシブ収集で候補が挙がったら、アクティブ確認に移る。DEVの記事は `httpx`（高速HTTP探索ツール）を使い、共通パスに対して最小限のクエリを投げる方法を示している。

```bash
httpx -path /graphql -mc 200 \
  -H "Content-Type: application/json" \
  -d '{"query":"{__typename}"}'
```

`__typename` は、GraphQLの全ての型に自動的に付与される特殊フィールドで、そのオブジェクトの型名を文字列として返す。仕様上ほぼ無効化できない（クライアントがUnion型やInterface型のレスポンスを判別するために必須の機構であるため）性質を持つため、「これはGraphQLサーバーか」を判定するための最も軽量かつ確実なカナリアクエリ（無害な信号弾のようなプローブ）として使われる。ASECの記事も同様に、認証層を判定するために `query { __typename }` を送り、返ってくるエラーメッセージ（OAuth2.0やJWT関連のエラー、GraphQL Shieldの警告、認証要求メッセージなど）からアクセス制御の有無を推測する手法を紹介している。これは、レスポンスの成否だけでなく「エラーメッセージの文面」自体が偵察材料になるという、GraphQL特有の情報漏えい経路を示す好例である。

> 出典: ASEC「GraphQL Hacking 101: Reconnaissance」— https://www.asec.io/blog/graphql-hacking-101-reconnaissance
> 出典: DEV「GraphQL as Attack Surface: Introspection, Batching, and Schema Enumeration」— https://dev.to/roxdavirox/graphql-as-attack-surface-introspection-batching-and-schema-enumeration-4f2h

### エンジン・フィンガープリンティング

エンドポイントがGraphQLだと確認できたら、次にどの実装（Apollo Server、GraphQL Yoga、Hasura、WPGraphQLなど）を使っているかを特定する。ASECとDEVの両記事が挙げる **graphw00f** はこの目的に特化したツールで、35種類以上のGraphQLエンジンをエラーメッセージの微妙な差異から識別する。

```bash
# 検出モード（対象がGraphQLかどうかを判定）
python3 main.py -d -t https://example.com

# 指紋認識モード（エンジン種別を特定）
python3 main.py -f -t https://example.com/graphql
```

なぜこれが可能かというと、GraphQL仕様自体はエラーレスポンスの正確な文言や形式まで厳密には規定していないため、各実装（サーバーライブラリ）が独自のエラーメッセージ生成ロジックを持つからである。例えば不正なクエリを送ったときのメッセージ文言、フィールド未定義時のヒント文、バリデーションエラーのコード体系などが実装ごとに異なり、これらの差分パターンをデータベース化して照合するのがフィンガープリンティングの原理である。graphw00fはこの結果をGraphQL Threat Matrix（GraphQLの既知の脅威と実装ごとのデフォルト防御状況をまとめた一覧）と突き合わせ、「そのエンジンがデフォルトで何を防御しているか」を即座に把握できるようにする。これにより、無駄な攻撃ベクトルの試行を省き、効率的な診断が可能になる。

### Introspectionによるスキーマ完全露出

GraphQLの核心的な脅威モデルは **introspection（イントロスペクション、内省）** と呼ばれる標準機能に起因する。これはGraphQL仕様が定める、クライアントがAPI自身に対して「あなたのスキーマはどうなっていますか」と問い合わせできるメタクエリ機構であり、`__schema` という予約フィールドを経由して全ての型・フィールド・引数・ディレクティブ・説明文（description）を取得できる。

```graphql
query {
  __schema {
    types {
      name
    }
  }
}
```

JSON形式のリクエストボディとしては次のようになる。

```json
{"query":"{__schema{types{name}}}"}
```

これが機能する理由は、GraphQLが「自己文書化API」を設計哲学として掲げているためである。開発者はこの機能を使ってGraphiQLのようなインタラクティブなクエリエディタを構築し、型定義を自動補完・自動生成できる。しかし本番環境でintrospectionが有効なまま公開されると、攻撃者はAPI仕様書を一切持たずとも、スキーマ全体（内部実装の詳細、管理者専用フィールド、非推奨だが残っているフィールド、内部データモデルの関係性など）を機械的に総取りできてしまう。

DEVの記事は、この問題が現在も現実の脆弱性として繰り返し発生している事実を具体的なCVE番号とともに示している。CVE-2024-50312（OpenShift Console）とCVE-2025-53364（Parse Server）は、いずれも未認証でのスキーマ露出を扱った脆弱性で、CVSSスコアは5.3〜6.5とされる。さらに重要な指摘として、Apollo Server v3以前は本番環境でもintrospectionがデフォルトで有効になっていたが、Apollo Server v4ではこの挙動が変更され、デフォルトで無効化されるようになった。一方でMercuriusなどApollo以外のラッパー実装では、依然として明示的な設定が必要である。この「バージョン・実装ごとにデフォルトが異なる」という事実は、防御側が「うちはGraphQLだから安全/危険」と一括りに判断してはならないことを意味する。実際に使っているライブラリのバージョンとデフォルト設定を必ず確認する必要がある。

> ⚠️ 実務上の注意（防御目的の補足）: introspectionを無効化する設定は各実装によって呼び方が異なる（例: `introspection: false` のようなオプション）。設定を無効化しても、後述するフィールド候補（field suggestion）漏えいや、バッチ/エイリアスを使った総当たりなど、別経路でスキーマが再構築されうる点に注意が必要である。

### フィールド候補（Field Suggestions）によるスキーマ復元

Introspectionを無効化しても安心はできない。多くのGraphQL実装は、開発体験向上のために「タイプミスした可能性のあるフィールド名を提案する」機能を持つ。例えば、存在しない `user` というフィールドを問い合わせると、次のようなエラーメッセージが返ることがある。

```
Cannot query field "user". Did you mean "userProfile"?
```

この「Did you mean」ヒントは開発中は便利だが、本番で有効なままだと、攻撃者は辞書に載っている単語（例えば一般的なAPIでよく使われるフィールド名のリスト）を片っ端から問い合わせるだけで、正しいフィールド名を一つずつ「エラーメッセージが教えてくれる」形でスキーマを再構築できてしまう。これは古典的なブルートフォース攻撃の変種であり、レスポンスの真偽（成功/失敗）ではなく、エラーメッセージのテキスト内容そのものがオラクル（攻撃者に情報を漏らす応答窓口）として機能する点が特徴的である。

この手法を自動化するツールとして、ASEC・DEV両記事が **clairvoyance** を挙げている。DEVの記事によれば、clairvoyanceはEscape Technologies社が公開したGraphQL特有の単語リスト（約5万語）を用いてフィールド名を総当たりし、エラーメッセージの提案文言を手掛かりに実際のスキーマ構造を再構成する。

さらに深刻な事例として、DEVの記事はCVE-2024-37155（OpenCTI 6.1.9未満）を紹介している。この脆弱性では、開発者側が `__schema` という文字列パターンを正規表現でブロックするフィルタを実装していたが、クエリ文字列中に改行文字（`\r\n`）を挿入することでこの正規表現マッチングを回避できてしまった（CVSSスコア6.5）。これは、パーサ（構文解析器）レベルでは改行やホワイトスペースを許容する構文であっても、防御側の文字列フィルタがそれを考慮していなかったために生じたバイパスである。ここから得られる教訓は、「文字列パターンマッチによる場当たり的なフィルタリングは、パーサの柔軟性の前では容易に突破される」という、Webセキュリティ全般に通じる原則である。防御としては、`hideSchemaDetailsFromClientErrors` のような、実装が公式に提供するオプション（Apollo Server v4に存在）を使ってエラーメッセージ自体からスキーマ情報を除去する方が、独自の文字列フィルタより堅牢である。ただしこのオプションも明示的な有効化が必要であり、多くの本番デプロイでは見落とされているとDEVの記事は指摘している。

### バッチングとエイリアスによる列挙・レート制限回避

GraphQLの仕様には、1回のHTTPリクエストで複数のクエリ／ミューテーションをまとめて送信できる「バッチング」という機能がある。加えて、同一フィールドに対して異なる引数で複数回問い合わせる際に用いる「エイリアス（別名）」という構文機能もある。この2つを組み合わせると、単一のHTTPリクエストの中に多数の独立した操作を詰め込むことができる。

```graphql
mutation {
  a1: login(username: "admin", password: "password1") { token }
  a2: login(username: "admin", password: "password2") { token }
  a3: login(username: "admin", password: "password3") { token }
}
```

この例では `a1`、`a2`、`a3` というエイリアスを使い、同じ `login` ミューテーションに異なるパスワードを渡して1リクエストの中で並列実行させている。なぜこれが問題になるかというと、多くのレート制限機構（不正アクセス対策としてのアクセス頻度制限）は「HTTPリクエスト数」を数える設計になっているためである。1リクエストの中に何百もの操作を詰め込めるバッチング/エイリアス機構を使えば、見かけ上のリクエスト数を増やさずに、実質的なオペレーション数（ログイン試行回数など）だけを膨大に増やすことができ、ブルートフォース攻撃やDoS（サービス拒否）攻撃の検知をすり抜けてしまう。

DEVの記事はこの脅威に関連する実例として、CVE-2024-39895（Directus）を挙げている。これは認証済みユーザーがエイリアスの多重化によってDoSを引き起こせた脆弱性で、CVSSスコアは6.5とされる。またHackerOneに報告された事例（#2207248、Shopify）では、単一のバッチクエリの中で課金ID（billing ID）をIDOR（Insecure Direct Object Reference、認可チェック漏れによる他者データへの不正参照）的に列挙できたことが報告されている。

ASECの記事も同様の懸念をバッチ処理制限の検証項目として挙げ、配列ベースのバッチ（`[{"query":"query {user}"}, ...]` のように複数のクエリオブジェクトを配列で並べる形式）とエイリアスベースのバッチ（`alias1:user alias2:user` のように1つのクエリ文字列内でエイリアスを使う形式）の両方を検証すべきだとしている。検証・悪用のためのツールとしては **BatchQL** や **CrackQL** が挙げられている。

防御としてDEVの記事が強調するのは、「ゲートウェイ側でのレート制限設定だけでは不十分で、コード（アプリケーション層）レベルでのクエリ複雑度制限が必要」という点である。具体的には `graphql-depth-limit` のようなライブラリを使い、クエリの深さ（ネストの深さ）やコスト（フィールドごとに重みを付けて合計する計算量見積もり）を静的・動的に評価し、閾値を超えるクエリ自体を実行前に拒否する仕組みを組み込む必要がある。ASECの記事も同様に、クエリ深度制限（再帰的なネストによるDoS防止）、コスト分析（静的なフィールドコスト設定、クレジット制、動的計算方式）、タイムアウト設定(長時間実行されるクエリの遮断)を、GraphQLサーバーが備えるべき基本的なセキュリティ制御として列挙している。なお、深くネストしたクエリによる負荷の可視化には、スキーマをグラフとして描画する **Voyager** のようなツールが役立つとされる。

### 実践的な偵察フロー（5ステップ）とセキュリティ制御の検証

DEVの記事は、これまでの技法を統合した実務的な5段階の偵察フロー（防御側から見れば「攻撃者が辿る経路を理解し、同じ経路で自組織の露出を点検する」ためのチェックリスト）を提示している。

1. **パッシブ収集**: Shodan、Censys、証明書透明性ログ（Certificate Transparency Log。SSL/TLS証明書発行記録の公開台帳で、サブドメインの存在を間接的に暴露することがある）からサブドメインとエンドポイント候補を洗い出す。
2. **プローブ（存在確認）**: `httpx` などで候補パスに `{__typename}` を送り、GraphQLサーバーであることを確認する。
3. **フィンガープリント**: `graphw00f` でエンジン種別を特定し、既知の防御プロファイルを把握する。
4. **Introspection試行**: 標準的な `__schema` クエリを直接試行し、失敗する場合は改行やホワイトスペースの変則（CVE-2024-37155のような正規表現バイパスの類型）も試す。
5. **列挙（フォールバック）**: Introspectionがブロックされている場合、`clairvoyance` のようなツールでフィールド候補漏えいを突いてスキーマを再構築する。

また、ASECの記事は認証層の検証手順として、`query { __typename }` のような無害なカナリアクエリをまず送り、返ってくるHTTPステータスやエラーメッセージの文面から認証・認可の有無を判定する方法や、デバッグモードが有効なままになっていないか、WAF（Web Application Firewall、Webアプリケーションファイアウォール）がGraphQL特有の攻撃パターンを認識できているかを確認する重要性にも触れている。加えて、GraphQL特有の実装バグとしてフラグメントサイクル（クエリ内でフラグメント同士が循環参照する構造）を悪用したDoSの実例（CVE-2022-30288）にも言及しており、スキーマ構造そのものだけでなく、クエリパーサの実装堅牢性も検証対象に含めるべきだとしている。

### まとめ:「隠しても消えない」攻撃面としてのGraphQLスキーマ

DEVの記事が明確に結論づけているように、「introspectionを無効化するだけで、フィールド候補漏えい・バッチング・フィンガープリンティングへの対処を怠るのは、セキュリティ・バイ・オブスキュリティ（隠すことだけに頼った見せかけの安全対策）に過ぎない」。Introspectionを閉じても、スキーマはフィールド候補の総当たりや、エラーメッセージの微細な差異、公開されたクライアントアプリのバンドルコード（フロントエンドのJavaScriptに埋め込まれたクエリ文字列)など、複数の経路から再構成されうる。ASECの記事もツール実行だけでは「包括的なセキュリティ評価にはならない」と明言しており、専門知識に基づく手動検査を併用する必要性を強調している。

防御側の実務としては、次の多層的な対策が必須となる。

- **Introspectionの無効化**: 本番環境では原則として無効化する（使用しているライブラリのバージョンとデフォルト挙動を必ず確認する）。
- **エラーメッセージの抑制**: フィールド候補提案（field suggestion）やスタックトレースなど、スキーマ情報を暗に漏らすエラー文言を本番では出力しない設定（例: `hideSchemaDetailsFromClientErrors` 相当のオプション）を明示的に有効化する。
- **クエリ複雑度・深度・コストの制限**: `graphql-depth-limit` 等のライブラリでアプリケーション層に組み込み、ゲートウェイのレート制限だけに頼らない。
- **バッチング/エイリアス数の制限**: 1リクエストあたりの操作数に上限を設け、認証系ミューテーション（ログインなど)に対しては特に厳格に制限する。
- **監視とログ**: パッシブ偵察（Shodan等でのインデックス化)を前提に、自組織のエンドポイントが外部からどう見えているかを定期的に自己点検する。

これらの対策はいずれも単体では万能ではなく、組み合わせて初めて「隠しても消えない」GraphQLのスキーマ露出リスクを現実的なレベルまで抑え込むことができる。

## Recon ツール: Clairvoyance / graphw00f / Threat Matrix

GraphQL の偵察（recon）フェーズでは、大きく分けて2つの情報を集める必要がある。1つ目は「どんなスキーマ（クエリ・ミューテーション・型の構造）が存在するか」、2つ目は「サーバー側でどの GraphQL 実装（エンジン）が動いているか」である。前者が分かればどんな攻撃対象（フィールド、引数、リレーション）があるかが見え、後者が分かればその実装固有の既知の弱点や設定漏れ（イントロスペクション有効化、デバッグモード、バッチリクエスト制限の有無など）を絞り込める。本節では、この2つの情報収集を自動化する代表的なオープンソースツールと、両者を体系的に整理した脅威マトリックスを扱う。いずれも防御側の視点からは「自組織の GraphQL エンドポイントがどこまで情報を漏らしているか」を点検するための診断ツールとして読み替えられる。

### Clairvoyance: イントロスペクション無効時のスキーマ復元

#### 何が問題なのか

GraphQL には `__schema` や `__type` といった特殊なメタフィールド（イントロスペクションクエリ）があり、これに問い合わせると API が公開しているクエリ・ミューテーション・サブスクリプション・型・フィールド・引数の全体構造を JSON で丸ごと取得できる。開発時には便利だが、本番環境でこれが有効なままだと、攻撃者は API のドキュメントを読むのと同じ感覚で攻撃対象の全体像を把握できてしまう。そのため Apollo Server をはじめ多くのフレームワークは、本番相当の設定（`NODE_ENV=production` など）ではイントロスペクションをデフォルトで無効化するようになっている。

しかし、イントロスペクションを無効化しても GraphQL エンドポイント自体は依然として稼働しており、クエリを受け付ける。ここで悪用されるのが GraphQL の**フィールド提案（field suggestions）**という機能である。存在しないフィールド名を問い合わせると、多くの実装は「これのことですか？」という形で、レーベンシュタイン距離（編集距離）が近い実在のフィールド名候補をエラーメッセージに含めて返す。たとえば以下のようなクエリを送ると、

```graphql
{
  usr {
    id
  }
}
```

実装によっては次のようなエラーが返る。

```json
{
  "errors": [
    {
      "message": "Cannot query field \"usr\" on type \"Query\". Did you mean \"user\" or \"users\"?"
    }
  ]
}
```

この「Did you mean」ヒントを使えば、イントロスペクションが閉じていても、辞書（ワードリスト）に載っている単語を総当たり的に投げつけることで、実在するフィールド名・型名・引数名を1つずつ「発見」していける。これがフィールド提案を悪用したスキーマ復元（schema introspection bypass / field suggestion abuse）の基本原理である。

#### Clairvoyance の仕組みと使い方

Clairvoyance（Nikita Stupin 作、Python 製）は、この総当たり型のスキーマ復元作業を自動化するツールである。README によれば、ワードリストの各単語を順にクエリのフィールド名部分に差し込み、返ってきたエラーメッセージのフィールド提案から実在のフィールド名を確定し、確定したフィールドについてはさらにそのサブフィールド・引数・返り値の型を再帰的に探索していく、という手続きを繰り返して GraphQL スキーマ相当の情報を段階的に組み立てていく。開発者自身の講演（"GraphQL APIs from bug hunter's perspective"）で内部アルゴリズムのより詳しい解説がされているが、要点は「フィールド提案というエラーメッセージの副作用（サイドチャネル）を、スキーマという構造化情報の復元に転用している」という点にある。

インストールと実行は次のように行う。

```bash
pip install clairvoyance
clairvoyance https://example.com/graphql -o schema.json
```

Docker イメージも提供されている。

```bash
docker run --rm nikitastupin/clairvoyance --help
```

動作にはワードリストが必須であり、README では以下の3種類が候補として挙げられている。

- Escape Technologies が公開している GraphQL 用ワードリスト
- 一般的な英単語辞書
- 対象アプリケーションが生成する HTTP トラフィック（実際の通信ログ）から抽出した、対象固有の語彙

3つ目の「対象アプリケーション自身の通信から辞書を作る」というアプローチが特に効果的である。フロントエンドの JavaScript バンドルや実際のリクエスト・レスポンスに出現する識別子（`userId`、`orderStatus` など）はそのアプリケーションのドメイン語彙を反映しており、汎用英単語辞書よりヒット率が高くなりやすい。

出力は JSON 形式で、GraphQL Voyager（スキーマの可視化ツール）、InQL（Burp Suite 拡張）、graphql-path-enum といった下流ツールにそのまま読み込ませて連携できるよう設計されている。処理時間の目安として README では公開デモ API（`rickandmortyapi.com/graphql`）に対して約2分としている。

#### 環境変数によるオプション

Clairvoyance はコマンドラインオプションではなく主に環境変数で動作を調整する設計になっている。

```bash
LOG_LEVEL=DEBUG LOG_FMT=json clairvoyance https://example.com/graphql -o schema.json
```

- `LOG_FMT`: ログ出力のフォーマット
- `LOG_DATEFMT`: ログの日付形式
- `LOG_LEVEL`: ログレベル（デフォルトは `INFO`）。大規模なワードリストを回すと実行時間が長くなるため、`DEBUG` にして進捗を追いながら止まっていないかを確認する運用がしやすい。

#### 防御側の観点

この手法が成立する根本原因は「イントロスペクションだけを塞いでも、フィールド提案という別の情報漏洩経路が残っている」ことにある。したがって本番運用での対策は、イントロスペクションの無効化に加えて、フィールド提案（field suggestions／did-you-mean ヒント）自体を無効化する、または汎用的なエラーメッセージに丸めることが望ましい。GraphQL Threat Matrix（後述）の比較表でも「Field Suggestions」は独立した評価項目として扱われており、実装によっては明示的に無効化するオプションが用意されている。加えて、想定外のクエリ・存在しないフィールドへの問い合わせが大量に発生した場合はレート制限や異常検知の対象とすることで、総当たり型のスキーマ復元そのものを検知・遅延させることができる。

> 出典: nikitastupin/clairvoyance README — https://github.com/nikitastupin/clairvoyance

### graphw00f: GraphQL エンジンのフィンガープリンティング

#### 目的と背景

GraphQL は仕様（スペック）であり、その実装は Apollo Server、Hasura、Ariadne、graphql-java、Juniper（Rust）、Dgraph、AWS AppSync、WPGraphQL など数十種類存在する。同じ「GraphQL API」であっても、実装が違えばエラーハンドリングの細部、デバッグモードの挙動、バッチリクエストの扱い、独自拡張フィールドの有無などが異なり、そこから生じるセキュリティ上の弱点も実装ごとに変わってくる。攻撃者・診断者にとっては、まず「相手がどの実装か」を特定できれば、その実装固有の既知の設定ミスパターンや対応する脅威マトリックスのエントリにすぐ当たりを付けられる。これを自動化するのが Dolev Farhi 作の graphw00f（Python 製）である。

#### フィンガープリンティングの仕組み

graphw00f の README（プロジェクト概要）は、この手法を CWE-200（Exposure of Sensitive Information / 意図しない情報の露出）に分類している。仕組みは Web サーバーのバナーグラビングや `Server` ヘッダ判定に近い発想で、**意図的に不正な形式のクエリ（malformed query）や境界値を突くクエリを送り、返ってくるエラーメッセージやレスポンスの構造的な差異を実装ごとの指紋（フィンガープリント）として比較する**、というものである。README は「Specially crafted queries cause different GraphQL server implementations to respond uniquely」（特別に作られたクエリは、GraphQL サーバー実装ごとに固有の応答を引き起こす）と説明している。

具体的には、たとえば以下のような観点の差異が指紋として利用され得る。

- 構文エラー時のエラーメッセージの文言・フォーマット（JSON のキー構成、スタックトレースの有無）
- 存在しない演算子・ディレクティブを送った際の挙動
- GET リクエストでの GraphQL 受付可否（実装によっては POST のみ対応）
- HTTP ステータスコードの使い分け（常に 200 を返すか、エラー時に 4xx/5xx を返すか）
- 特定の実装だけが持つ独自エラーコードやデバッグ拡張フィールド（`extensions` 内の実装固有情報）

これらの差分をあらかじめ40以上の実装ごとに収集したシグネチャデータベースと突き合わせることで、相手のエンジンを高い精度で特定する。対応エンジンには Graphene、Ariadne、Apollo Server、graphql-go、gqlgen、WPGraphQL、graphql-ruby、Hasura、HyperGraphQL、graphql-java、Juniper、Sangria、Strawberry、Tartiflette、Dgraph、Directus、AWS AppSync、GraphQL Yoga、Lighthouse、Mercurius、GraphQL.NET、Hot Chocolate、Inigo、ballerina-graphql など多数が含まれる。

#### 使い方

```bash
# フィンガープリント（エンジン特定）モード
python3 main.py -f -t https://demo.hypergraphql.org:8484/graphql

# 検出モード（-d）とローカル環境への実行例
python3 main.py -f -d -t http://localhost:5000
```

主なオプションは次の通り。

| オプション | 説明 |
|---|---|
| `-f` | フィンガープリント実行モード |
| `-d` | 検出モード（対象がそもそも GraphQL エンドポイントかどうかの判定など） |
| `-t URL` | ターゲット URL の指定 |
| `-p PROXY` | HTTP(S) プロキシの指定（Burp Suite 等の中継ツールと連携させる際に使う） |
| `-T TIMEOUT` | タイムアウト秒数 |
| `-o OUTPUT_FILE` | 結果を CSV に出力 |
| `-H HEADER` | カスタム HTTP ヘッダの付与（認証トークンなどを含める場合） |

クエリの送信は GET と POST の両方式に対応しており、対象がどちらの方式を受け付けるかも判定材料の一つになる。正常にエンジンが特定できた場合、graphw00f は特定したエンジン名に加えて、そのエンジンに対応する実装ドキュメントや脅威マトリックスのリンク（後述の graphql-threat-matrix の該当ページ）を出力する設計になっており、「エンジン特定 → その実装固有の既知の脅威一覧を即座に参照する」というワークフローを意図してつくられている。

#### 防御側の観点

フィンガープリンティングを難しくする決定的な方法は存在しないが、エラーレスポンスの正規化（実装依存のスタックトレースや内部エラーコードを含めない共通フォーマットへの変換）、不要な HTTP メソッド（例: GET 経由の GraphQL 実行）の無効化、リバースプロキシ層でのエラーメッセージの一律サニタイズなどが、指紋として利用可能な情報量を減らすうえで有効である。また、本番環境でデバッグモード関連の拡張情報（スタックトレース、内部例外クラス名など）が `extensions` フィールドに漏れていないかは、実装を問わず必ず確認すべき項目である。

> 出典: dolevf/graphw00f README — https://github.com/dolevf/graphw00f

### GraphQL Threat Matrix: 実装間のセキュリティ設定を横断比較する

#### 位置づけ

GraphQL Threat Matrix（Nicholas Aleks 作）は、個別の攻撃ツールではなく、**GraphQL の主要な実装（Apollo、graphql-php、graphql-ruby、Graphene、Hasura など20種類以上）が、セキュリティに関わる代表的な項目についてデフォルトでどう振る舞うかを横並びで比較した参照表（マトリックス）**である。README は次のように目的を説明している。

> "graphql-threat-matrix was built for bug bounty hunters, security researchers and hackers to assist with uncovering vulnerabilities across multiple GraphQL implementations."

GraphQL は仕様レベルでは共通でも、各実装がその仕様をどう解釈し、どこまでセキュリティ関連の機能をデフォルトで提供するかにはばらつきがある。その差異こそが実装固有の脆弱性や設定ミスの温床になる、という問題意識に基づいて作られたプロジェクトである。

#### 比較されている8つの評価軸

READMEのトップページに掲載されている比較表は、各実装について以下の8項目を評価している（実装ごとの詳細解説は `implementations/` 配下の個別ファイル、例えば `apollo.md`、`graphene.md`、`graphql-java.md`、`juniper.md`、`gqlgen.md` などに分かれて記載されている）。

1. **Request Validations（リクエストバリデーション）** — 実装が内蔵している検証ルールの数（実装によって1個から38個までと大きく幅がある）。ルール数が少ない実装ほど、不正な形式のクエリや仕様違反のクエリを弾かずに処理してしまう可能性が高い。
2. **Field Suggestions（フィールド提案）** — 前述の Clairvoyance が悪用する「Did you mean」ヒントの有効/無効/非対応の別。有効なままだとイントロスペクション無効化の効果が実質的に無効化される。
3. **Query Depth Limit（クエリ深度制限）** — 自己参照する型（例: `user { friends { friends { friends { ... } } } }`）に対する深いネストクエリを拒否する仕組みの有無。無ければリソース枯渇型 DoS の起点になる。
4. **Query Cost Analysis（クエリコスト分析）** — クエリの複雑度・実行コストをスコアリングし、閾値を超えるクエリを拒否する仕組みの有無。深さ制限だけでは防げない「横に広い」高コストクエリ（多数のエイリアスを使ったバッチ的な攻撃など）への対策になる。
5. **Automatic Persisted Queries（自動永続化クエリ, APQ）** — クエリ文字列そのものではなくハッシュ値だけをやり取りするキャッシュ機構の対応状況。帯域削減に有効な一方、実装によってはハッシュの事前登録なしに任意クエリを実行できてしまう設定ミスにつながることがある。
6. **Introspection（イントロスペクション）** — デフォルトで有効か無効か。
7. **Debug Mode（デバッグモード）** — 本番相当設定でスタックトレースや内部エラー詳細を返してしまうかどうか。
8. **Batch Requests（バッチリクエスト）** — 1回の HTTP リクエストで複数の GraphQL 操作をまとめて送れる機能の対応有無。対応している場合、レート制限を単純な「リクエスト数」でしか見ていないと、1リクエストに数百のクエリを詰め込むことでレート制限を実質的に回避されたり、ブルートフォース攻撃（ログイン試行の一括投入など）に悪用されたりする。

これらの項目はいずれも、本節で扱った Clairvoyance（フィールド提案・イントロスペクション）や graphw00f（デバッグモード・実装固有のエラー挙動）が悪用する情報漏洩経路と直接対応しており、「recon ツールで何が分かるか」と「実装ごとに何がデフォルトで危険か」を接続する索引として機能する。README 自体には各項目に対する具体的な緩和策の実装手順までは書かれておらず、"safer deployment decisions"（より安全な導入判断）と "advance the security maturity"（セキュリティ成熟度の向上）を目的として掲げるにとどまる。実務上は、この比較表を使って自組織が採用している実装のデフォルト設定を確認し、上記8項目のうち無効・非対応になっている項目を個別に（クエリ深度制限ミドルウェアの追加、APQ の許可リスト化、デバッグモードの明示的無効化など）補強していく、という使い方になる。

> ⚠️ **未取得の資料（部分）**: `implementations/` 配下の各実装ごとの詳細ページ（例: `apollo.md` や `graphene.md` に記載されている、実装固有の脅威シナリオや脆弱性の具体例）は自動取得の対象外としました（トップページの比較表のみを取得し、個別ページは未取得）。詳細は以下からご自身で直接ご覧ください: https://github.com/nicholasaleks/graphql-threat-matrix/tree/master/implementations
>
> （以下は未取得資料の補足として一般知識に基づく解説です）個別の実装ページは、上記8項目それぞれについて「その実装ではどう挙動するか」「デフォルト値はどうか」「有効化・無効化するための設定パラメータ名」を実装固有のコード例つきで解説する形式になっていることが多い。たとえば Apollo Server であればイントロスペクションの無効化は `ApolloServer` の初期化オプション（`introspection: false` に相当する設定）で行い、クエリ深度制限やコスト解析は `graphql-depth-limit` や `graphql-cost-analysis` のようなミドルウェアライブラリを別途組み込む必要がある、といった実装依存の具体的な差異が中心的な内容になる。自組織の実装が比較表で「非対応」「デフォルト無効」となっている項目については、該当実装のドキュメントで明示的な有効化手順を確認することが推奨される。

> 出典: nicholasaleks/graphql-threat-matrix README — https://github.com/nicholasaleks/graphql-threat-matrix

### recon ツールの組み合わせ方（防御側の点検フロー）

3つのツールは単体でも使えるが、防御側の自己点検（脅威モデリング／設定監査）という文脈では次の順序で組み合わせると全体像を把握しやすい。

1. **graphw00f でエンジンを特定する。** どの実装が動いているかを確認し、GraphQL Threat Matrix の該当実装ページを参照して、その実装がデフォルトでどこまでの防御機能を持つかを把握する。
2. **イントロスペクションの状態を確認する。** 有効であれば、それ自体が情報漏洩であり、まず無効化を検討する。
3. **イントロスペクションを無効化した後も、Clairvoyance 相当の手法（フィールド提案の悪用）でスキーマが復元可能でないかを確認する。** 可能であれば、フィールド提案自体の無効化や、想定外フィールドへの大量アクセスに対するレート制限・異常検知を導入する。
4. **GraphQL Threat Matrix の8項目チェックリストに沿って、クエリ深度制限・コスト分析・バッチリクエスト制限・デバッグモードの無効化状況を一つずつ確認し、欠けている項目を補強する。**

この一連の流れは、次章以降で扱う DoS（クエリ深度・コストを利用した攻撃）や認可バイパス、バッチリクエストを利用したブルートフォースといった具体的な攻撃手法の前提となる「攻撃対象の把握」フェーズに相当する。

## 実習: 隠しエンドポイント発見とVoyager可視化

GraphQL診断の第一関門は「そもそもGraphQLエンドポイントがどこにあるか分からない」という状況である。REST APIと違い、GraphQLは単一のエンドポイント（多くは`POST /graphql`）にすべてのクエリを集約する設計思想を持つため、URLパスの一覧性からは実体が見えにくい。さらに実務では、開発者が意図的に`/graphql`という「いかにも」なパスを避け、`/api`や独自のパスにマウントしていることも珍しくない。本節では、PortSwiggerの実習ラボ「Finding a hidden GraphQL endpoint」を題材に**隠しエンドポイントの発見手法**を仕組みレベルで解説し、続けて発見後のスキーマ理解を助ける可視化ツール**GraphQL Voyager**の使い方を扱う。

本節で扱う内容はあくまで**防御・検証設計を理解するための学習目的**であり、実在サービスや本番環境への無許可の探索・攻撃は行わない前提で読み進めてほしい。ラボの具体的な解答手順（何を何回クリックしてフラグを取るか）には立ち入らず、探索の「原理」と「なぜそれで見つかるのか」を中心に扱う。

### なぜGraphQLエンドポイントは「隠れる」のか

REST APIは通常、リソースごとにURLパスが分かれる（`/users/1`、`/orders/5`など）ため、クローリングやパス推測で構造がある程度見えてくる。これに対しGraphQLは、**単一のエンドポイントに対してリクエストボディ（またはGETのクエリパラメータ）としてクエリ文字列を送る**アーキテクチャを取る。つまり、HTTPメソッドとパスだけを外形的に観察しても、それが「GraphQL専用のエンドポイントである」という情報はほとんど得られない。多くの実装では`/graphql`という規約的なパスがデフォルトだが、以下のような理由で変えられていることがある。

- リバースプロキシやAPI Gatewayの命名規則に合わせて`/api`配下にまとめている。
- フロントエンド資産のパスと衝突を避けるため独自のパスを採用している。
- 「隠せばセキュリティが上がる」という誤った発想（security through obscurity、隠蔽によるセキュリティ）に基づき、あえて`/graphql`を避けている。

最後の理由は特に重要である。単にパスを非標準にしただけでは真の防御にはならない。なぜなら、GraphQLサーバーは**そのエンドポイントに届いた有効なクエリには必ず応答する**という性質を持つため、パスさえ当てられれば隠蔽の意味は失われるからである。

### 探索の基本戦略 — 「ユニバーサルクエリ」による存在確認

隠しエンドポイントを探す実務的な手法は、大きく2段階に分かれる。

#### 1. パスのリスト探索（ワードリストベース）

`/graphql`、`/graphql/console`、`/api`、`/api/graphql`、`/query`、`/v1/graphql`のような、GraphQL実装で頻出する命名パターンのワードリストを用意し、各候補に対してリクエストを送る。この段階ではまだ「GraphQLサーバーかどうか」は分からないため、次のステップと組み合わせる。

#### 2. 「ユニバーサルクエリ」で応答を確認する

候補となったパスに対し、**構文的に常に有効で、かつ実装依存の型定義に依存しない最小クエリ**を送ることで、そのエンドポイントがGraphQLを話すかどうかを判定できる。代表例が次のクエリである。

```graphql
query{__typename}
```

`__typename`はGraphQLの仕様（イントロスペクション機構の一部）で**すべてのオブジェクト型に暗黙的に存在するメタフィールド**であり、どのスキーマ設計であっても必ず解決可能である。つまりこのクエリは「スキーマの中身を一切知らなくても投げられる」という点で、探索用のプローブとして極めて都合がよい。応答が`{"data":{"__typename":"Query"}}`のようなJSONで返ってくれば、そのエンドポイントはGraphQLサーバーとして機能していると確認できる。逆に404や通常のHTMLページが返れば、そのパスはGraphQLエンドポイントではない可能性が高い。

なぜ`__typename`が仕組み上「常に効く」のかを補足する。GraphQLの実行エンジンは、クエリ内のフィールドをスキーマの型定義と突き合わせて解決するリゾルバ（フィールドの値を実際に計算・取得する関数）を呼び出すが、`__typename`は**言語仕様レベルで予約されたメタフィールド**であり、個々のアプリケーションがリゾルバを実装しなくても、GraphQLライブラリ自身が自動的に処理する。したがってスキーマの詳細を何も知らない攻撃者・診断者でも、このクエリ1本で「相手がGraphQL実装であること」を検出できる。

### GETリクエストでの探索とURLエンコード

多くのGraphQL実装はクエリをHTTP POSTのボディ（`application/json`で`{"query": "..."}`）として受け取ることを前提にしているが、一部の実装（特にキャッシュ可搬性やCDN経由の配信を意図したもの）は**GETメソッドでもクエリを受け付ける**。この場合、クエリ文字列はURLの`?query=`パラメータとしてURLエンコードして送信する必要がある。

```
GET /api?query=query%7B__typename%7D HTTP/1.1
Host: vulnerable-website.com
```

ここで`query{__typename}`をそのままURLに埋め込むと、`{`や`}`はURLの予約文字と衝突するため、パーセントエンコード（`{`→`%7B`、`}`→`%7D`など）が必須になる。PortSwiggerのラボ「Finding a hidden GraphQL endpoint」は、まさにこの「GETリクエストに応答する`/api`エンドポイント」を題材にしており、通常のブラウジングやページ内リンクの探索だけでは発見できない設計になっている点が学習ポイントである。ブラウザの開発者ツールでネットワークタブを確認しても、フロントエンドがXHR/fetchで叩いている先が`/graphql`という分かりやすい名前でない限り、目視だけでは見落としやすい。

> ⚠️ **未取得の資料**: 「Lab: Finding a hidden GraphQL endpoint」（PortSwigger Web Security Academy）は、自動取得したページから解答手順そのものは意図的に抽出していません（本教科書は防御目的でラボ攻略を書かない方針のため）。技術背景（エンドポイント推測、ユニバーサルクエリ、GET+URLエンコードでの応答確認、イントロスペクションのブロックとその回避に関する一般的な考え方）はご自身で下記URLから直接ご確認いただくことを推奨する: https://portswigger.net/web-security/graphql/lab-graphql-find-the-endpoint
>
> （以下は未取得資料の補足として一般知識に基づく解説です）このラボの学習上のねらいは、GraphQLエンドポイントの発見が「単純なURLパス推測」だけでなく、「HTTPメソッドとエンコーディングの理解」を要求する点にある。加えてラボ後半では、イントロスペクションクエリが文字列パターン（`"__schema{"`のような）でサーバ側フィルタによりブロックされているケースを扱っており、これは第2章で別途詳しく扱う「WAF・フィルタ回避」の話題（改行やホワイトスペースの挿入によるパターンマッチ回避、GETとPOSTの扱いの違いを突く手法など）と接続している。本節ではエンドポイント発見の原理までにとどめ、フィルタ回避の詳細は別節に譲る。

### ツールを使った発見の効率化（防御目的での言及）

実務・診断の現場では、上記のプローブを手作業で1件ずつ試すのは非効率であるため、以下のようなアプローチが一般的に使われる（いずれも「自組織のアプリケーションを検証する」「許可されたスコープ内で診断する」場面を前提とする）。

- **Burp SuiteのGraphQL関連拡張**: リクエスト内のGraphQLクエリを自動検出し、生のJSONペイロードを構造化して見やすく表示する拡張（例: "GraphQL Raw" のような拡張）が存在する。これらはクエリの手動編集や再送を容易にする。
- **クローラー＋ワードリストの組み合わせ**: 一般的なパスのワードリストと`__typename`プローブを自動化したスクリプトで、複数候補パスを一括検査する。
- **JSファイル・ソースマップの静的解析**: フロントエンドのバンドルされたJavaScript内に、GraphQLクライアント（Apollo ClientやRelayなど）の初期化コードとしてエンドポイントURLがハードコードされていることが多い。`grep`等で`graphql`や`/api`のような文字列を検索するだけで見つかる場合もある。

これらの手法はいずれも「新しい脆弱性」を突くものではなく、**すでに存在するエンドポイントを、対象アプリケーションの許可された範囲内で特定する**という偵察（recon）行為である点を強調しておく。

### 発見後の次のステップ — スキーマ全体像の把握とVoyager

エンドポイントを特定し、イントロスペクション（第2章前半で扱った、スキーマ定義そのものをクエリで取得できるGraphQLの標準機能）が有効であることを確認できたら、次の課題は「取得した巨大なJSON形式のスキーマ定義を、人間がどう理解するか」である。イントロスペクションクエリの結果は、型・フィールド・引数・型同士の関連をすべて含む詳細なJSONだが、数十〜数百の型を持つ実サービスのスキーマでは、生のJSONやテキストの一覧だけでは全体構造（どの型がどの型を参照しているか）を把握しづらい。ここで役立つのが**GraphQL Voyager**である。

#### GraphQL Voyagerとは何か

GraphQL Voyagerは、任意のGraphQL APIのスキーマを**インタラクティブなグラフ（ノードとエッジで型同士の関連を視覚的に表現した図）として可視化するオープンソースツール**である。README上の説明では「Represent any GraphQL API as an interactive graph（任意のGraphQL APIをインタラクティブなグラフとして表現する）」ツールと位置づけられている。

> 出典: GraphQL Voyager (graphql-kit.com) — https://graphql-kit.com/graphql-voyager/
> 出典: graphql-kit/graphql-voyager README — https://github.com/graphql-kit/graphql-voyager/blob/main/README.md

主な機能は次の通りである。

- **グラフ上での素早いナビゲーション**: ノード（型）をクリックすると、その型が参照する他の型へグラフ上でジャンプでき、関連の深いスキーマでも視覚的に追いやすい。
- **左パネルでの型の詳細表示**: 選択した型のフィールド一覧、各フィールドの型、引数、説明文（スキーマにドキュメントコメントがあれば）をパネルに表示する。
- **Skip Relayオプション（デフォルト有効）**: Relay（Facebook製のGraphQLクライアントライブラリ）の仕様に基づく`Connection`/`Edge`のようなラッパー型を可視化上で省略し、実質的なデータ構造だけをすっきり表示する。
- **任意の型をルートに指定可能（`rootType`）**: デフォルトでは`Query`型がグラフの起点になるが、`Mutation`型や特定のドメイン型を起点に切り替えて探索できる。
- **その他の表示オプション**: `skipDeprecated`（非推奨フィールドの省略、デフォルト有効）、`sortByAlphabet`（型やフィールドのアルファベット順ソート）、`showLeafFields`（スカラー型・enum型の末端フィールドも表示するか、デフォルト有効）などがあり、スキーマの規模や見たい粒度に応じて調整できる。

#### 使い方 — イントロスペクション結果を入力として渡す

Voyagerの中核となる入力は、**サーバーのイントロスペクションクエリの実行結果（JSON）**である。使い方は大きく3通りある。

1. **CDN経由でのスタンドアロン利用**: `graphql-voyager/dist/voyager.standalone.js`をHTMLに読み込み、`GraphQLVoyager.init(element, options)`のようなAPIでページに埋め込む。手早く1回だけ可視化したい場合に向く。
2. **npmパッケージとしてバンドラーに統合**: WebpackなどでReactコンポーネントとして`<Voyager introspection={...} />`のように組み込み、既存の管理画面や社内ツールに恒常的に組み込む。
3. **ミドルウェアとしてExpress/Hapi/Koaなどに統合**: サーバー側のフレームワークにVoyagerのUIをそのままマウントし、開発者向けのスキーマ閲覧画面として提供する。

いずれの場合も、コンポーネントの`introspection`プロパティに**イントロスペクションクエリの実行結果そのもの（JSON）**、または**イントロスペクションクエリを実行して結果のPromiseを返す関数**を渡す。関数を渡した場合、Voyagerは内部で標準のイントロスペクションクエリ（`__schema`をルートに、全型・全フィールド・全引数を再帰的に取得する定型クエリ）を組み立てて実行し、その結果を描画に使う。つまり実務上のワークフローは次のようになる。

```
1. 対象エンドポイントに対してイントロスペクションクエリを実行し、JSON結果を取得する
2. その結果をVoyagerのUI（公式サイトの入力欄、または自前でホストしたVoyager）に貼り付ける・渡す
3. Voyagerがノード・エッジグラフとしてスキーマ全体を描画する
4. 型をクリックしながら、Query/Mutationのルートフィールドから辿れるデータ構造を視覚的に把握する
```

公式サイト（graphql-kit.com/graphql-voyager、旧apis.guru配下）では、任意のGraphQLエンドポイントのURLを入力するか、取得済みのイントロスペクションJSONを直接貼り付けることで、ブラウザ上だけで可視化を試せるようになっている。README側の注記として、**ある程度大きな画面サイズでの利用が推奨**されている点にも触れておく。型数の多いスキーマではグラフが横に大きく広がるため、狭い画面では視認性が落ちる。

#### なぜ可視化が「診断」にも「防御設計」にも有効なのか

Voyagerのようなグラフ表現が有用な理由は、GraphQLスキーマの構造的な性質に根ざしている。GraphQLの型システムは、オブジェクト型同士が互いにフィールドとして参照し合う**有向グラフ**そのものである（例: `User`型が`orders: [Order!]!`フィールドを持ち、`Order`型が`items: [OrderItem!]!`を持つ、といった連鎖）。この構造をテキストのSDL（Schema Definition Language、GraphQLのスキーマを記述するための専用構文）や生のJSONで追う場合、読み手は頭の中で参照関係を再構築しなければならない。一方Voyagerは、この参照関係をそのままノード間のエッジとして描画するため、**「この型からどこまで辿れるか」「意図せず公開範囲が広い型がないか」を一目で確認できる**。

これは攻撃者の偵察を効率化する側面もあるが、同時に**防御側にとっても強力な棚卸しツール**である。開発チームが自分たちのスキーマをVoyagerで可視化すれば、以下のような設計上の問題を発見しやすくなる。

- 本来公開する必要のない内部向けの型やフィールドが、意図せず`Query`のルートから到達可能になっていないか。
- 機微情報を持つ型（例: 管理者専用の`AdminSettings`型など）が、権限チェックなしに一般ユーザーのグラフ経路から辿れる位置にないか。
- スキーマの肥大化により、意図しない深いネストのクエリ（第2章で別途扱うクエリの深さ制限・複雑度制限の話題）が可能な構造になっていないか。

つまりVoyagerは攻撃ツールではなく**スキーマ理解のための可視化レンズ**であり、診断者・防御者の双方が同じ図を見て会話できる点に価値がある。

### まとめ

- GraphQLは単一エンドポイントにクエリを集約する設計のため、REST的なパス探索だけでは発見しづらい。`__typename`のような**言語仕様で常に解決可能なメタフィールド**を使ったユニバーサルクエリが、パス候補の存在確認に有効である。
- 一部の実装はGETリクエストにも応答し、その場合クエリ文字列は`?query=`パラメータとしてURLエンコードして渡す必要がある。PortSwiggerの実習ラボはこの挙動を体験させる設計になっている。
- エンドポイントとイントロスペクションが確認できたら、生のJSON/SDLを直接読むのではなく、**GraphQL Voyager**でノード・エッジのグラフとして可視化すると、型同士の参照関係や公開範囲の全体像を効率よく把握できる。
- Voyagerの入力は**イントロスペクションクエリの実行結果**であり、`skipRelay`・`rootType`・`skipDeprecated`などの表示オプションで、見たい粒度に応じて調整できる。
- この可視化は攻撃者の偵察を助ける面もあるが、本質的には**スキーマの棚卸し・設計レビューのための防御的ツール**として活用すべきものである。

> 出典: Lab: Finding a hidden GraphQL endpoint (PortSwigger Web Security Academy) — https://portswigger.net/web-security/graphql/lab-graphql-find-the-endpoint
> 出典: GraphQL Voyager (graphql-kit.com) — https://graphql-kit.com/graphql-voyager/
> 出典: graphql-kit/graphql-voyager README — https://github.com/graphql-kit/graphql-voyager/blob/main/README.md


---

[📖 目次](index.md) ・ [← 第1章 前提: GraphQLの仕組みを攻撃者視点で理解する](01-graphql-fundamentals.md) ・ [第3章 認可・アクセス制御の脆弱性 (BOLA/BFLA) →](03-authorization-bola-bfla.md)
