## 認可欠落の解説とnested authz bypass

GraphQL の実害の大半は「認可（authorization、認証済みの主体が特定の操作やデータにアクセスしてよいかの判定）」の欠落から生まれる。認証（authentication、そもそも誰であるかの確認）は通ったのに、その先で「あなたはこの注文を見てよいか」「この管理者ミューテーションを実行してよいか」という判定が抜け落ちる。これは REST でもおなじみの BOLA（Broken Object Level Authorization＝オブジェクトレベル認可の破れ、いわゆる IDOR）や BFLA（Broken Function Level Authorization＝機能レベル認可の破れ）だが、GraphQL では「単一エンドポイント・自己文書化・任意のネスト（入れ子）でのグラフ探索」という固有の性質によって、この欠落が桁違いに露出しやすくなる。

本節では、HackerOne Blog の実例「How a GraphQL Bug Resulted in Authentication Bypass」、Axeploit の「GraphQL's Blind Spots」による nested authz bypass（ネストしたクエリ経由の認可バイパス）の解説、そして OWASP GraphQL Cheat Sheet の防御指針を軸に、「なぜ GraphQL では認可がすり抜けるのか」を仕組みレベルで解剖する。すべて防御目的の理解であり、実在サービスへの無許可検証や破壊的手順は扱わない。

### なぜ GraphQL で認可が抜けやすいのか（原理）

REST では `/orders/123` のように、URL パスとメソッドの組み合わせがそのままアクセス制御の単位になる。認可ミドルウェアはルーティング層で「このパスにはこのロールが必要」と一括で判定できる。ところが GraphQL は次の三点で前提が崩れる。

- **単一エンドポイント**: すべてのクエリ・ミューテーションが `/graphql` 一点に POST される。URL パスに認可を紐づける従来のやり方（パスごとの WAF ルールやルーティング層のガード）が機能しない。判定すべき単位は「URL」ではなく「スキーマの中のどのフィールド・型を要求したか」に移る。
- **リゾルバ（resolver）単位の実行**: GraphQL サーバーは、クライアントが要求した各フィールドに対応する **リゾルバ関数** を1つずつ呼び出してデータを組み立てる。認可は本来この「フィールドごとのリゾルバ」で行うべきだが、開発者はしばしばトップレベルのクエリ入口（例: `me` や `viewer`）にだけガードを置き、その下にぶら下がる子フィールドのリゾルバには何のチェックも書かない。
- **任意のネストとグラフ探索**: GraphQL の型はグラフ状に相互参照する（User→Organization→Settings のように）。同じ機微データに「複数の経路」で到達できてしまうため、正面玄関だけ施錠しても裏口（別の型からのリレーション）が開いていることが起きる。これが後述する nested authz bypass の根本原因である。

つまり GraphQL の認可は、「入口で一度だけ」ではなく「グラフのすべてのノード（型）とエッジ（リレーション）で」行われなければならない。OWASP GraphQL Cheat Sheet が「認可は edges（エッジ）と nodes（ノード）の両方で強制されなければならない」と明言するのはこのためである。

### 実例: introspection と認可欠落が結びついた認証バイパス（HackerOne Blog）

HackerOne Blog の「How a GraphQL Bug Resulted in Authentication Bypass」は、あるEコマースプラットフォームのサードパーティ製「プロモーションバナー」アプリが公開していた GraphQL エンドポイントの事例である。この事例が示す教訓は、「introspection（内省、スキーマ自己開示機能）の有効化」と「フィールドレベル認可の欠落」が組み合わさると、未認証の第三者が管理者アカウントを作れてしまう、という点にある。

#### 何が起きたか

このエンドポイントは二つの問題を同時に抱えていた。

1. **introspection が本番で有効**: introspection とは、`__schema` / `__type` という特殊なメタフィールドを使ってスキーマ全体（すべての型・フィールド・引数・ミューテーション名）を機械可読な形で取得できる GraphQL 標準機能である。これが有効だと、攻撃者はドキュメント化されていない隠しミューテーションまで一覧できてしまう。
2. **フィールド／型ごとの認可が不均一**: 記事中で研究者が指摘した核心が次の一文である。

> 「クライアントは単一のクエリの中で、特定のデータフィールドやネストしたデータを GraphQL に要求できる。そうした状況では、すべてのフィールドや型が等しく認証チェックを受けているわけではない。」
> （原文: "not all fields and types undergo equal authentication checks."）

introspection でスキーマを覗いた結果、二つの危険なミューテーションが露出していた。

- `Register`（一般ユーザーアカウントの作成）
- `CreateAdminUser`（**管理者**アカウントの作成）

`CreateAdminUser` は本来、保護されたバックエンド内部からのみ呼ばれるべきものだった。しかしフィールドレベルの認可が実装されていなかったため、未認証のクライアントが直接このミューテーションを呼び出せた。攻撃者は管理者アカウントを自作し、その認証情報でプロモーションバナーの内容や商品情報を改ざんできる状態になった。

#### なぜこれが成立したのか（仕組み）

ポイントは「認証（ログイン）を突破した」のではなく、「本来認証・認可が必須のはずの機能に、そもそも認可判定が実装されていなかった」点である。GraphQL では、スキーマにミューテーションを1つ定義すると、それは単一エンドポイントの入口から等しく呼び出せる状態になる。開発者が「これは内部専用だから外からは呼ばれないはず」と暗黙に想定していても、GraphQL のランタイムはその想定を知らない。リゾルバの中に `if (!ctx.user.isAdmin) throw new ForbiddenError()` のような明示的なガードを書かない限り、そのミューテーションは全世界に開かれている。これは BFLA（機能レベル認可の破れ、OWASP API Security の API5:2023）の教科書的な発現である。

introspection はこの脆弱性を「発見可能」にした増幅要因であって、根本原因ではない。仮に introspection を無効化しても、フィールド提案（field suggestion）やスキーマ推測（Clairvoyance などによる復元）で `CreateAdminUser` の存在が漏れれば同じ攻撃が成立する。したがって防御の本質は「introspection を切ること」ではなく「すべてのミューテーション・フィールドに明示的な認可を書くこと」にある。

#### 防御

記事が挙げる対策は次の通り。

- **クエリ・ミューテーションごとに認可を明示する**: 各操作に対して必要な権限レベルを定義し、リゾルバ（またはその手前のミドルウェア）で強制する。「デフォルト拒否（deny by default）」を基本姿勢にする。
- **不要な機能を削る**: `CreateAdminUser` のように外部公開が不要なミューテーションはスキーマから除去し、攻撃面（attack surface）そのものを減らす。
- **本番で introspection を無効化する**: 偵察を難しくする補助的な対策。ただし上述の通り単独では不十分で、認可の実装が前提。

> 出典: HackerOne Blog「How a GraphQL Bug Resulted in Authentication Bypass」— https://www.hackerone.com/blog/how-graphql-bug-resulted-authentication-bypass

### nested authz bypass: ネストしたクエリで認可をすり抜ける（Axeploit）

Axeploit の「GraphQL's Blind Spots」は、introspection・batching（バッチング）・nested queries（ネストしたクエリ）を「攻撃者の遊び場」と表現し、とりわけ **nested authz bypass** を掘り下げている。ここが本節の核心である。

#### 攻撃の型: 「正面玄関は施錠、裏口は開錠」

多くのアプリは、機微データへの「わかりやすい入口」にだけ認可を置く。たとえば `adminSettings`（管理設定）というトップレベルクエリには「管理者のみ」というガードがある。しかし、同じ設定オブジェクトに **別の経路** で到達できるとしたらどうか。記事の例を引く。

```graphql
# ブロックされる（トップレベルの adminSettings には認可ガードがある）
query {
  adminSettings { ... }
}

# 通ってしまう（トップレベルの保護を回避）
query {
  user(id: "1") {
    organization {
      settings { ... }   # adminSettings より弱い認可、あるいは無認可
    }
  }
}
```

なぜ2番目が通るのか。GraphQL サーバーは、`user` → `organization` → `settings` という各エッジ（フィールド）を **それぞれのリゾルバ** で辿る。`user` の入口には認可があっても、`organization.settings` のリゾルバに認可判定が書かれていなければ、そのフィールドは「たまたまこの経路で到達した人」に対して無防備にデータを返す。記事はこの原理を次のように要約する。

> 「あるフィールドのすべてのリゾルバは、そのクエリがどの経路でそこに到達したかにかかわらず、認可ルールを強制しなければならない。」
> （原文: "Every resolver for a field must enforce authorization rules regardless of which path the query took to reach it."）

つまり、認可が「入口（entry point）だけ」に適用されていると、ネストした探索がそのチェックを迂回する。これが nested authz bypass の機序である。REST に喩えるなら、`/admin/settings` は認証必須にしたのに、`/users/1/org/settings` という別ルートを無防備に生やしてしまった状態に近い。GraphQL ではこの「別ルート」がスキーマのリレーションとして自動的に大量発生する点が厄介なのだ。

#### 偵察の起点としての introspection

記事は、この攻撃の前提として introspection の威力を強調する。単一の introspection クエリが、`AdminUser` / `InternalAuditLog` / `PaymentMethod` のような内部型、ドキュメント化されていないミューテーション、権限昇格に使えそうな引数まで、すべて機械可読な形で開示する。記事の印象的な一節が次である。

> 「introspection の応答と10分あれば、熟練した攻撃者は、そのAPIに携わるほとんどの開発者よりも完全なAPIの地図を手にする。」

InQL や GraphQL Voyager といったツールは、この introspection 応答から攻撃用クエリを自動生成し、機微な型に到達する「すべての経路」を列挙できる。nested authz bypass は、こうして得たスキーマの地図の上で「機微な型に至る全パスを洗い出し、それぞれを低権限アカウントで叩く」という体系的な手順に落とし込める。

#### batching による増幅（認可とは別軸だが同居する脅威）

同記事は batching（別名: alias-based batching / array batching）による総当りバイパスも扱う。認可の話とは軸が違うが、認可欠落を突いた列挙攻撃を「1リクエストに大量に詰める」ことで加速するため、ここで押さえておく。GraphQL では **エイリアス（alias）** を使えば同じフィールドを1クエリ内で何度も別名で呼べる。

```graphql
query {
  attempt1:   login(email: "user@example.com", password: "pass1")    { token }
  attempt2:   login(email: "user@example.com", password: "pass2")    { token }
  # ...
  attempt1000: login(email: "user@example.com", password: "pass1000") { token }
}
```

これが1つの **HTTP リクエスト** に収まる。記事によれば、10リクエスト/分というリクエスト単位のレート制限があっても、この手法なら実質10,000試行/分が可能になり、6桁のOTP（ワンタイムパスコード）総当りも「数リクエストで枯渇する」。array batching（リクエストボディを操作の配列にする変種）も同じ増幅効果を持つ。なぜ効くのかは仕組みが明快で、レート制限が「HTTP リクエストの数」を数えているのに対し、GraphQL は「1リクエスト内の操作の数」を無制限にできるからだ。カウントの単位がずれている。防御は「HTTP リクエスト単位ではなく操作単位でレート制限する」「不要なら array batching を無効化する」「login/OTP/パスワードリセットのような機微ミューテーションに個別の試行制限を課す」ことである（この総当り・レート制限バイパスの詳細は第4章で扱う）。

#### ネストによる DoS（認可の隣にある同根の問題）

nested queries は認可バイパスだけでなく、DoS（サービス拒否）にも使われる。User→Post→Comment→User… のような循環参照を8階層も辿ると、N+1問題（1件の親取得ごとにN件の子クエリが発生する非効率）が掛け算的に膨らみ、「単一のHTTPリクエストで数百万のデータベースクエリを発生させ得る」と記事は述べる。計算量はおおむね O(n^depth)（深さに対して指数的）になる。防御は「最大クエリ深度の制限（10程度が一般的）」「実行前のクエリ複雑度スコアリングによる拒否」「DataLoader によるリゾルバ呼び出しのバッチ化」「実行タイムアウト」。これも認可と同様、「単一エンドポイント＋任意ネスト」という GraphQL の性質が根にある。

#### テスト（防御的診断）の方法論

記事は、GraphQL では「URLルートではなくスキーマそのものが攻撃面である」と整理し、防御的な診断手順を4点にまとめている。

1. **introspection テスト**: 機微な型名・未文書化ミューテーションの有無を確認する。
2. **alias batching テスト**: レート制限された操作に対し、100〜1,000件のエイリアス操作を送って増幅が起きないか確認する。
3. **深度テスト**: 循環参照クエリを深さ5〜20で構成し、応答の劣化（DoS耐性）を測る。
4. **認可パス列挙**: 機微な型に到達するスキーマ上の全経路を特定し、それぞれを低権限アカウントで検証する（nested authz bypass の検出）。

自組織の GraphQL に対してこれらを実施することが、本番リリース前の防御的検証になる。

> 出典: Axeploit「GraphQL's Blind Spots: Why Introspection, Batching, and Nested Queries Are an Attacker's Playground」— https://axeploit.com/blog/graphql-s-blind-spots-why-introspection-batching-and-nested-queries-are-an-attacker-s-playground

### 防御の設計指針: 認可はビジネスロジック層で（OWASP GraphQL Cheat Sheet）

OWASP GraphQL Cheat Sheet は、上記の攻撃をまとめて防ぐための設計原則を提示している。核心は「認可は GraphQL 層の飾りではなく、ビジネスロジック層で、すべてのノードとエッジについて強制する」という点である。

#### エッジとノードの両方で認可する

チートシートは「認可チェックは GraphQL スキーマ内の edges（エッジ＝フィールド／リレーション）と nodes（ノード＝型／オブジェクト）の両方で強制されなければならない」と述べる。これは nested authz bypass への直接の処方箋である。参照されているバグ報告では、エッジレベルの保護はあったのにノードレベルの認可が欠けていた、という組み合わせで脆弱性が生じていた。「入口のエッジだけ守る」のではなく「到達しうるすべてのノードで、要求者がそのオブジェクトを見てよいかを確認する」ことが求められる。

具体的には次のような姿勢になる。

> 「要求されているデータの閲覧・変更を、その要求者が本当に許可されているかを常に検証する。」

このとき、RBAC（Role-Based Access Control、ロールに基づくアクセス制御）などのアクセス制御フレームワークを使う。

#### リゾルバでの強制と RBAC ミドルウェア

チートシートは「Query と Mutation のリゾルバがアクセス制御の検証を行える。RBAC ミドルウェアを併用してもよい」とする。つまり認可判定は、GraphQL がフィールド・ミューテーションを解決する「ビジネスロジック層」に置くのが正しい。ネットワーク層やAPIゲートウェイでの粗い制御ではなく、個々のリゾルバ（あるいはその直前のミドルウェア）で「この主体はこのオブジェクトにアクセスできるか」を判定する。

擬似コードで示すと、各リゾルバは次のような形を取る（一般的な実装パターンの例）。

```javascript
// organization.settings リゾルバ — 経路によらず必ず認可する
settings: (organization, args, ctx) => {
  // 「どの経路でここに来たか」に依存せず、必ずこのノードで判定する
  if (!ctx.user || !canViewOrgSettings(ctx.user, organization.id)) {
    throw new ForbiddenError("Not authorized to view organization settings");
  }
  return loadSettings(organization.id);
}
```

ここで重要なのは、`organization.settings` のリゾルバが「呼び出し元が `adminSettings` だろうと `user.organization` 経由だろうと」同じ判定を行う点である。これで nested authz bypass の裏口が塞がる。

#### BOLA / BFLA の直接的対策

チートシートは OWASP API Security（BOLA=API1、BFLA=API5）を参照しつつ、実務的な緩和策を挙げる。

- **BOLA（オブジェクトレベル認可の破れ、IDOR）対策**: 「要求者が、要求しているオブジェクトへのアクセス権を持っているかを検証する」。GraphQL では「ある画像を取得するリクエストに、実はデータベースの主キーそのものである ID が含まれる」ことがあり、その ID に対して所有者・権限の確認を怠ると IDOR になる。ID を受け取ったら必ず「この主体はこの ID のオブジェクトを見てよいか」を確認する。
- **BFLA（機能レベル認可の破れ）対策**: 前述の `CreateAdminUser` のように、機能（ミューテーション）ごとに必要な権限を定義して強制する。消費者ごとに異なる権限を持たせるなら、フィールドレベルのアクセス制御を実装する。
- **構造的アプローチ**: GraphQL の Interface（インターフェース）と Union（ユニオン）を使い、要求者の権限に応じて「より多い／より少ないオブジェクトプロパティ」を返す階層的な型を設計する。権限の低い利用者には、そもそも機微フィールドを含まない型を返すという設計上の分離である。

#### 本番環境の安全策

- 本番で introspection を無効化し、スキーマ偵察を制限する（補助策）。
- 不要なら Relay 由来の汎用取得フィールド `node` / `nodes` への直接アクセスを塞ぐ。`node(id: ...)` は任意の型のオブジェクトをグローバル ID 一発で引ける強力な入口であり、ここに認可がないと BOLA の温床になる。
- 消費者ごとに権限を分けるなら、フィールドレベルのアクセス制御を実装する。

> 出典: OWASP GraphQL Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html

### まとめ: 3資料が指し示す一つの結論

3つの資料は角度こそ違え、同じ結論に収束する。

- **HackerOne の実例**は「機能（ミューテーション）に認可を書き忘れると、単一エンドポイント越しに未認証の第三者へ全開放される（BFLA）」ことを示した。
- **Axeploit** は「機微な型に至る経路は複数あり、入口だけ守っても nested authz bypass で裏口から抜かれる。認可はすべてのリゾルバで、経路に依存せず強制せよ」と原理を明示した。
- **OWASP Cheat Sheet** は「認可はエッジとノードの両方、ビジネスロジック層（リゾルバ）で、デフォルト拒否・RBAC で強制する」という設計指針で両者を包摂した。

覚えるべき一文は「GraphQL の認可は、URL でもエンドポイントでもなく、スキーマ上のすべてのノードとエッジで、リゾルバごとに、経路に依存せず行う」である。introspection の無効化・レート制限・深度制限はいずれも補助であって、この原則の代替にはならない。次章では、ここで触れた alias/batching による総当り・レート制限バイパスと、深いネストによる DoS を、GraphQL 固有の武器化テクニックとしてさらに詳しく掘り下げる。
