## GraphQL実CVE: introspection露出とfield duplication DoS

本節では、GraphQL特有の弱点が実際のプロダクトでどうCVE化したかを2件の実例で追う。1件目のCVE-2023-47643（SuiteCRM）は「イントロスペクション（introspection、スキーマ自身をGraphQLクエリで問い合わせる機能）が未認証で公開されていた」情報漏洩型。2件目のCVE-2024-39895（Directus）は「同じフィールドを1クエリ内で大量に重複させる」ことでサービスを数分間応答不能にできたDoS型である。どちらも「難しいエクスプロイトの連鎖」ではなく、GraphQLの仕様上ごく普通の機能が、デフォルト設定のまま本番に出たことで成立している。ここが実務上いちばん重要な学びであり、両者の**修正パッチが実装レベルで何を変えたか**まで踏み込んで読むことで、自分のサービスに何を入れるべきかが具体化する。

なお本節は防御・検知の設計を目的とした解説であり、実在サービスへの無許可検証手順は扱わない。挙動の確認は必ず自分が管理する検証環境で行うこと。

---

### CVE-2023-47643: SuiteCRM の未認証イントロスペクション露出

#### 事実関係（バージョン・スコア・分類）

| 項目 | 内容 |
|---|---|
| CVE ID | CVE-2023-47643 |
| 製品 | SuiteCRM（SuiteCRM-Core、PHP/Symfony + API Platform ベースのCRM） |
| 影響バージョン | 8.4.2 未満（報告は 8.4.1 で確認） |
| 修正バージョン | 8.4.2 |
| CWE | CWE-200（Exposure of Sensitive Information to an Unauthorized Actor＝認可されていない相手への機微情報の露出） |
| CVSS v3.1（NVD） | 5.3 MEDIUM / `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N` |
| CVSS v3.1（GitHub二次評価） | 3.1 LOW / `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N` |
| 公開日 | 2023-11-21（NVD最終更新 2026-06-17） |
| アドバイザリ | GHSA-fxww-jqfv-9rrr（報告者: @x3419） |
| 修正コミット | `117dd8172793a239f71c91222606bf00677eeb33` |

NVDとGitHubでスコアが割れている点に注目してほしい。NVDは「PR:N（権限不要）・AC:L（攻撃条件が単純）」と評価し5.3、ベンダー側（GitHub）は「PR:L（何らかの権限が必要）・AC:H」と評価して3.1としている。これはイントロスペクション露出という脆弱性クラスの評価が、**そのエンドポイントに到達するのに認証が要るか**という配備条件に強く依存するためである。CVSSスコアの数字そのものより、「自社の配備では未認証で到達できるのか」を自分で判定する姿勢が実務では重要になる。

#### 何が起きていたのか

SuiteCRM 8系はGraphQLエンドポイントを `/api/graphql` に露出しており、そこに対する標準的なイントロスペクションクエリ（`__schema` メタフィールドを使うもの）が、認証なしのPOSTで通ってしまっていた。アドバイザリはこの点を「GraphQL Introspection is enabled without authentication, exposing the scheme defining all object types, arguments, and functions.（イントロスペクションが未認証で有効になっており、全オブジェクト型・引数・関数を定義したスキーマが露出する）」と記述している。

イントロスペクションは GraphQL 仕様が定める正規の機能で、`__schema` / `__type` という予約フィールドを通じて、型・フィールド・引数・デフォルト値・ディレクティブ・説明文をすべて機械可読な形で返す。GraphiQL や Apollo Sandbox のような開発者向けIDEが補完やドキュメント表示を実現できるのは、この機能があるからである。裏を返せば、有効なまま本番に出れば**APIの完全な設計図を誰でもダウンロードできる**ということになる。

```graphql
# イントロスペクションの最小形。__schema は仕様で定義された予約メタフィールドで、
# 通常の型定義とは別に、どの GraphQL 実装でも必ずクエリルートに存在する。
query {
  __schema {
    types {
      name
      fields { name args { name type { name kind } } }
    }
  }
}
```

なぜこれが単なる「ドキュメント公開」で済まないのか。アドバイザリが具体名を挙げているのが `UserHash` フィールドである。CRMの内部スキーマには、外部向けドキュメントには決して載らないフィールド（パスワードハッシュ、内部フラグ、管理者専用ミューテーションなど）が含まれうる。攻撃者にとってイントロスペクションの価値は「読める情報そのもの」より、**次の攻撃で試すべきフィールド名と引数の正確な綴りが手に入ること**にある。GraphQLは存在しないフィールド名を投げると即座にバリデーションエラーになる（＝当て推量が効きにくい）ため、スキーマの入手は認可不備（BOLA/IDOR）やインジェクションの探索コストを桁違いに下げる。CWE-200に分類されつつ、実質は「後続攻撃の前提条件を与える」情報漏洩である。

#### 修正が実装レベルで何を変えたか

8.4.2 のパッチは15ファイルに及ぶが、本質は次の3点に集約される。

**1) 環境変数 `GRAPHQL_SHOW_DOCS` の新設とデフォルトの反転**

新規ファイル `config/services/graphql/graphql_allow_introspection.yaml` が追加され、パラメータとして環境変数が束縛された。

```yaml
parameters:
  graphql.graphql_show_docs: '%env(default::bool:GRAPHQL_SHOW_DOCS)%'
```

そして `config/packages/security.php` 側では、値が未設定の場合の既定を**実行環境に従わせる**ロジックが入った。

```php
$showDocs = $env['GRAPHQL_SHOW_DOCS'] ?? ($appEnv === 'dev');
```

つまり `APP_ENV=dev` のときだけ暗黙で有効、`prod` では明示的に `GRAPHQL_SHOW_DOCS=true` と書かない限り無効になる。これは「セキュアバイデフォルト」の教科書的な適用で、*開発者の利便性はdev環境に閉じ込め、本番は黙っていれば閉じる*という設計である。

**2) バリデーションルールとしての恒久的な遮断**

`core/backend/Kernel.php` に `configureGraphqlIntrospection()` が追加され、実体は `App\Security\GraphqlIntrospectionManager` に委譲される。このマネージャは、`$showDocs` が偽のとき graphql-php のバリデータへルールを1つ追加する。

```php
// 概略: showDocs が false のとき、イントロスペクション禁止ルールを全クエリ検証に追加する
DocumentValidator::addRule(new DisableIntrospection());
```

ここが仕組み上の要点である。GraphQLサーバはリクエストを「**パース（構文解析）→ バリデーション（スキーマに照らした検証）→ 実行**」の順に処理する。`DisableIntrospection` は2段目のバリデーションルールとして動き、クエリのAST（抽象構文木）を走査して `__schema` / `__type` フィールドの出現を見つけた時点でエラーにする。**実行フェーズに入る前に落とす**ため、リゾルバ（各フィールドを解決する関数）の実装を一切変えずに全経路を塞げる。逆に言えば、「IDEのURLだけをリバースプロキシでブロックする」といったパス単位の対策では、同じエンドポイントに直接POSTされれば素通りするため不十分だった、ということでもある。

**3) ドキュメントUIの整理**

`config/packages/api_platform.yaml` で GraphiQL を無効化し GraphQL Playground へ切り替え、`config/routes/api_platform.yaml` のコントローラも `graphql.action.graphiql` から `graphql.action.graphql_playground` に変更。さらにセキュリティ設定で、イントロスペクション無効時は `/docs` 系パスへのアクセス制御ルールを追加している。UI遮断（3）とバリデーションルール（2）の**二重化**になっている点が実装として正しい。片方だけでは前述のとおり迂回される。

なお、このアドバイザリには「回避策（workaround）なし、アップグレード必須」と明記されている。自前で `DisableIntrospection` 相当を入れられない構成だったためである。

> 出典: NVD — CVE-2023-47643 — https://nvd.nist.gov/vuln/detail/CVE-2023-47643
> 出典: GitHub Security Advisory GHSA-fxww-jqfv-9rrr（SuiteCRM-Core） — https://github.com/salesagility/SuiteCRM-Core/security/advisories/GHSA-fxww-jqfv-9rrr

---

### CVE-2024-39895: Directus の field duplication / aliasing による DoS

#### 事実関係（バージョン・スコア・分類）

| 項目 | 内容 |
|---|---|
| CVE ID | CVE-2024-39895 |
| 製品 | Directus（Node.js製のヘッドレスCMS / データプラットフォーム、npmパッケージ `directus`） |
| 影響バージョン | 10.12.0 未満（併せて `@directus/env` < 1.1.6 が影響パッケージとして登録） |
| 修正バージョン | 10.12.0 |
| CWE | CWE-400（Uncontrolled Resource Consumption＝制御されていない資源消費） |
| CVSS v3.1 | 6.5 MEDIUM / `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H` |
| CVSS v4.0 | 7.1 HIGH / `CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N` |
| 公開日 | 2024-07-08（NVD最終更新 2026-06-17） |
| アドバイザリ | GHSA-7hmh-pfrp-vcx4（報告者: @asantof） |
| 修正コミット | `543b345695071c1de61a35004bd063fe59dba0c8` |

CVSS v3.1 で 6.5（MEDIUM）、v4.0 で 7.1（HIGH）と評価が上がっている。v4.0 は「攻撃要件（AT）」を独立項目として持ち、追加の前提条件がない攻撃を相対的に重く評価する設計のため、このように**同じ脆弱性でもv4.0の方が高く出る**ケースは珍しくない。両方併記された場合はどちらの尺度で議論しているかを明示する習慣をつけたい。

#### なぜ「同じフィールドの重複」が攻撃になるのか

GraphQLの仕様では、1つの選択セット（selection set＝`{ ... }` の中身）に同じフィールドを何度書いても構文エラーにならない。仕様上の "Field Selection Merging"（フィールド選択のマージ）規則により、同名・同引数のフィールドはレスポンス生成時にマージされるため、**返ってくるJSONは1つ**になる。「結果が同じなら無害だろう」と思えるところが、この脆弱性の落とし穴である。

問題は、マージが効くのは**レスポンスのキー空間**に対してであって、その手前のパース処理やサーバ実装側のフィールド走査は重複分だけ素直に回ってしまう場合がある、という点にある。さらにエイリアス（`a1: max`, `a2: max` のように別名を付ける記法）を使えばマージ規則そのものを合法的に回避でき、同じ計算を任意回数繰り返させられる。

Directus の場合、標的となったのは `/graphql` エンドポイント、とりわけ**集約クエリ（aggregation query）**である。アドバイザリが示す悪性クエリの構造は次の形をとる。

```graphql
# アドバイザリに示された構造の骨子（実行を意図したものではなく、形を理解するための引用）
query {
  query_name: collection_aggregated {
    max { id id id id ... }   # ← id を多数重複
    max { id id id id ... }   # ← max ブロック自体も多数重複
    ...
  }
}
```

公開されたPoCは `max` ブロックを200回、その各々に `id` を200回繰り返すものを生成する。単純計算で 200 × 200 = 40,000 個のフィールド選択となり、アドバイザリによれば**サービスは数分間応答不能**になる。攻撃者から見れば、送信するリクエストはせいぜい数百KBのテキスト1本であり、コストは極端に非対称である。

ここで、この種の攻撃が効く原理を graphql-js のパーサ側から理解しておきたい。graphql-js のメンテナ Ivan Goncharov 氏がトークン上限機能を提案したPR（#3684）では、根拠がこう説明されている。「Parser CPU and memory usage are linear to the number of tokens in a document however, in extreme cases, it becomes quadratic due to memory exhaustion.（パーサのCPUとメモリ使用量は文書中のトークン数に線形だが、極端な場合にはメモリ枯渇により二次的になる）」。同PRでは、**同じ2,000トークンでも**、短いフィールドを繰り返した文書は741ms、長い文字列で嵩を稼いだ文書は17msと、**43倍の差**が出たと報告されている。つまり「リクエストのバイト数」では危険度を測れない。1トークンはわずか2バイトで作れるため、バイト数制限は緩すぎると無意味で、厳しくすると長い文字列やコメントを含む正当なクエリを壊す。測るべき単位は**トークン数**である、というのがこのPRの結論だった。

Directus のケースはこの原理の実例にあたる。膨大な重複フィールドはパース段階でトークン数に比例したコスト（かつ最悪ケースでは二次的なコスト）を発生させ、さらにその先の集約処理でも重複分の走査が走る。CVSSの `PR:L`（低い権限が必要）が示すとおり完全な未認証攻撃ではないが、一般ユーザートークンひとつあれば実行できる以上、SaaS型の配備では実質的に「誰でも」に近い。

#### 修正が実装レベルで何を変えたか

パッチは驚くほど小さい。核心は graphql-js のパースオプション `maxTokens` を有効にしたことである。

- `api/src/middleware/graphql.ts`: `useEnv()`（`@directus/env`）を取り込み、GraphQLパーサへ `maxTokens` オプションを渡すよう変更
- `packages/env/src/constants/defaults.ts`: 既定値として `GRAPHQL_QUERY_TOKEN_LIMIT: 5000` を追加
- `packages/env/src/constants/directus-variables.ts`: `GRAPHQL_QUERY_TOKEN_LIMIT` を正式な環境変数として登録
- `docs/self-hosted/config-options.md`: 「How many GraphQL query tokens will be parsed（GraphQLクエリのトークンをいくつまでパースするか）」として文書化

```ts
// 概念コード: パースの入口でトークン上限を課す
import { parse } from 'graphql';

const document = parse(query, {
  maxTokens: Number(env['GRAPHQL_QUERY_TOKEN_LIMIT']), // 既定 5000
});
// 上限を超えると parse がシンタックスエラーを投げ、
// バリデーションにも実行にも一切到達しない
```

この修正がなぜ効くかを、処理段階に沿って確認しよう。GraphQLサーバの処理は前述のとおり「パース → バリデーション → 実行」だが、クエリ深さ制限やコスト計算といった一般的なDoS対策は**バリデーション段階**で動く。ところが今回の攻撃はパース自体が重い。パース後でなければASTを走査できないバリデーションルールでは、**最も重い処理がすでに終わってから**判定することになり、手遅れになりうる。`maxTokens` は字句解析（レキサ）がトークンを読み進める最中にカウントし、上限を超えた瞬間にシンタックスエラーを投げる。つまり**最も早い段階で、かつ攻撃コストに比例する単位で**打ち切る。これが「深さ制限だけでは足りない」理由である。

もう一点、graphql-js 側の設計判断も押さえておきたい。`maxTokens` には**既定の上限がない**。PRでの説明は「The idea is to leave the default limit to the more high-level libraries.（既定の上限は、より高レベルなライブラリに委ねるという考え方）」であり、`parse` はSDLファイルの読み込みにも使われるため単一の値では全用途に適さない、という理由である。またトークンを数える理由も明示されており、ASTノード数は「graphql-js の実装詳細であって他実装で再現できない」ため、仕様に近いトークン単位を採ったという。

したがって、**graphql-js を使っているだけでは自動的には守られない**。Directus のように上位のサーバ実装が明示的に `maxTokens` を渡して初めて防御になる。自作のGraphQLサーバを運用しているなら、この一行が入っているかを今すぐ確認する価値がある。

> 出典: NVD — CVE-2024-39895 — https://nvd.nist.gov/vuln/detail/CVE-2024-39895
> 出典: GitHub Security Advisory GHSA-7hmh-pfrp-vcx4（Directus） — https://github.com/directus/directus/security/advisories/GHSA-7hmh-pfrp-vcx4
> 出典: graphql/graphql-js PR #3684「parser: limit maximum number of tokens」 — https://github.com/graphql/graphql-js/pull/3684

---

### 2件を並べて読む: 設計上の共通構造

一見まったく別種の2件だが、根は同じである。

**共通点1: 「仕様上の正規機能」がそのまま脆弱性になっている。** イントロスペクションも、フィールドの重複記述も、GraphQL仕様が認める合法な挙動である。攻撃者は不正な入力を作っていない。したがって「異常なリクエストを弾く」型のWAFルールは効きにくく、**アプリ側で意図的に機能を絞る**しか手がない。

**共通点2: デフォルトが開発者体験に最適化されている。** イントロスペクションは既定で有効（IDEの補完のため）、パーサのトークン上限は既定で無制限（SDL読み込みのため）。どちらも上位レイヤが明示的に締めなければ、本番でそのまま開く。SuiteCRM の修正が `APP_ENV` による既定反転だったこと、Directus の修正が「既定値5000を新設して環境変数化」だったことは、まさに**既定値を安全側に置き直す作業**だった。

**共通点3: 単一エンドポイントゆえにパス単位の防御が効かない。** `/api/graphql` や `/graphql` というひとつのURLに、読み取りも書き込みも偵察も詰め込まれる。RESTで機能していた「エンドポイントごとのアクセス制御とレート制限」は、GraphQLでは**操作の中身を解釈しないと成立しない**。SuiteCRM が `/docs` のブロックだけでなくバリデーションルールを併用したのは、この事実への正しい対応である。

### 防御チェックリスト（自組織での適用）

以下は上記2件の修正から一般化できる、実装・運用の確認項目である。

1. **本番でイントロスペクションを無効化する。** 実装依存で手段が異なる（graphql-php なら `DisableIntrospection` バリデーションルール、graphql-js 系なら `NoSchemaIntrospectionCustomRule`、Apollo Server なら `introspection: false`）。UIの遮断だけで終えず、**バリデーション段階で落とす**こと。開発環境だけ明示フラグで有効化する。
2. **パース段階のトークン上限を設ける。** graphql-js 系なら `parse` に `maxTokens` を渡す（Directus の既定は5000）。既定で無制限である点を前提に、自分で必ず指定する。
3. **深さ制限・複雑度（コスト）制限を併用する。** トークン上限はパース段階、深さ・複雑度はバリデーション段階と、**効く層が違う**ため両方要る。
4. **エイリアスの数に上限をかける。** フィールドマージを回避する `a1: field`, `a2: field` 形式は、重複攻撃だけでなくバッチ化ブルートフォースにも使われる（第4章参照）。
5. **バッチクエリ（配列形式のリクエスト）を必要がなければ無効化する。** 1リクエスト内の操作数上限も設ける。
6. **タイムアウトと同時実行数の上限を設ける。** Directus の事例が示すとおり、被害の実体は「1本のリクエストがワーカーを数分占有する」ことである。実行時間の上限は最後の砦になる。
7. **依存バージョンを追跡する。** 今回の2件はいずれも**アップグレードが正規の修正**であり、SuiteCRM に至っては回避策が存在しなかった。SCA（依存関係スキャン）でGHSAを監視する体制が、結局いちばん効く。

これら7項目は、どれか1つで完結するものではない。パース層（2）、バリデーション層（1・3・4・5）、実行・運用層（6）、供給網（7）という**別々のレイヤに配置された防御**であり、本節の2つのCVEは、そのうち1層が欠けただけで成立した事例として読むのが正しい。
