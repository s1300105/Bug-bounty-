# 第9章 実例・ライトアップ・CVE・報奨事例

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

## WebSocket実CVEとライトアップ集

前節までで、WebSocketハンドシェイクの仕組み、`Origin`検証の欠如がCSWSH（Cross-Site WebSocket Hijacking）を成立させる原理、そしてメッセージ経由のインジェクションと認可欠如を扱ってきた。本節では、その理屈が**実在のプロダクトでどう現実化したか**を、1件の実CVEのパッチ差分レベルと、バグバウンティのライトアップ集という2つの角度から確認する。

扱うのは次の2つである。

- **CVE-2024-51775（Apache Zeppelin）**: `Missing Origin Validation in WebSockets`。OSSの実コードとその修正パッチが公開されており、「なぜ抜けたのか」「どう直したのか」を1行単位で追える、教材として理想的な事例。
- **devanshbatham/Awesome-Bugbounty-Writeups**: カテゴリ別に整理されたバグバウンティ・ライトアップのキュレーション集。WebSocket関連の報告が**どのカテゴリに分類されているか**そのものが、この脆弱性クラスの立ち位置を示している。

いずれも防御・検知の観点から読む。実在サービスへの無許可の再現検証は行わないこと。

---

### CVE-2024-51775: Apache Zeppelin のWebSocket Origin検証欠如

#### 事実関係を先に押さえる

Apache Zeppelinは、ブラウザ上でSpark/SQL/Shellなどのコードを「パラグラフ（paragraph）」単位で実行・可視化するWebノートブックである。JupyterのSpark版と考えればよい。

| 項目 | 内容 |
|---|---|
| CVE ID | CVE-2024-51775 |
| 対象 | Apache Zeppelin（コンポーネント: `org.apache.zeppelin:zeppelin-shell`） |
| 影響バージョン | 0.11.1 以上 0.12.0 未満 |
| 脆弱性種別 | Missing Origin Validation in WebSockets |
| CWE | CWE-1385（Missing Origin Validation in WebSockets） |
| NVD CVSS v3.1 | **5.3 (MEDIUM)** / `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N` |
| 二次評価（CISA-ADP） | **7.5 (HIGH)** / `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N` |
| ASF側の深刻度 | Moderate |
| 公表日 | 2025-08-03（oss-security投稿） |
| 発見者 | Calum Hutton |
| 修正 | **0.12.0 へのアップグレード**（PR apache/zeppelin#4823） |

ASFのアドバイザリ本文は、影響をこう述べている。

> Missing Origin Validation in WebSockets vulnerability in Apache Zeppelin. The attacker could access the Zeppelin server from another origin without any restriction, and get internal information about paragraphs.
> （Apache ZeppelinにおけるWebSocketのOrigin検証欠如。攻撃者は別オリジンから何の制限もなくZeppelinサーバーへアクセスでき、パラグラフに関する内部情報を取得できる。）

「別オリジンから制限なく接続でき、内部情報を取れる」という一文は、前節で学んだCSWSHの定義そのものである。

#### 何が露出していたのか: Terminal Interpreter の構造

脆弱だったのは、Zeppelin本体のノートブック用WebSocketではなく、`zeppelin-shell` モジュールに含まれる **Terminal Interpreter**（ノートのパラグラフ内にブラウザ端末を埋め込む機能）である。構造は次の通りだった。

1. ユーザーが `%sh.terminal` パラグラフを実行すると、`TerminalInterpreter` が**ランダムな空きポート**を選び、そのポートで独立したJetty（Javaのサーブレット/WebSocketサーバー）スレッド `TerminalThread` を起動する。
2. `TerminalThread` は JSR-356（`javax.websocket`、Jakarta WebSocketの旧名）のAPIで `TerminalSocket` エンドポイントを `/` に登録する。
3. ノート画面には `http://<hostIp>:<port>?noteId=...&paragraphId=...` を指すダッシュボード（iframe）が描画され、その中のJavaScriptが上記ポートへWebSocket接続する。
4. クライアントは接続直後に、こんな形のJSONフレームを送って端末セッションを開始する（修正PRのテストコードに実物が残っている）。

```json
{"type":"TERMINAL_READY","noteId":"<noteId>","paragraphId":"<paragraphId>"}
```

ここが要点である。**この端末用WebSocketサーバーは、Zeppelin本体の認証・認可を一切経由しない別プロセス的なリスナー**であり、かつ `Origin` を見ていなかった。したがって、被害者がZeppelinを開いているブラウザで攻撃者のページを踏むと、攻撃者のJavaScriptから同じポートへWebSocketを張り、`TERMINAL_READY` 相当のフレームを送って `noteId` / `paragraphId` に紐づく内部情報を引き出せた。これがアドバイザリの言う "get internal information about paragraphs" の中身である。

なお、端末ポートは**起動のたびにランダム**で、かつ通常はサーバーのLAN IPにバインドされる。攻撃の成否は「そのポートに到達できるか」に依存する。NVDが機密性影響を `C:L`（5.3）と控えめに採点した背景にはこの制約があり、逆にCISA-ADPが `C:H`（7.5）と採点したのは「到達できた場合に読めるのは端末セッションに紐づく内部情報であり、実質的な機密性喪失は大きい」という見方だと解釈できる。**同一CVEでスコアが割れているときは、評価者が前提条件（到達可能性）をどこまで織り込んだかの差**であることが多い。自組織のリスク判断では、自分の配置（Zeppelinをどのネットワークに置き、誰のブラウザがそこに到達できるか）に合わせて再計算するのが正しい。

#### なぜ抜けたのか: JSR-356 の `checkOrigin` はデフォルトで常に true

この脆弱性の核心は、仕様レベルの既定値にある。JSR-356（`javax.websocket`）では、サーバー側エンドポイントの挙動を差し替えるフック点として `ServerEndpointConfig.Configurator` というクラスがあり、その中に `checkOrigin(String originHeaderValue)` というメソッドが用意されている。ハンドシェイク時にコンテナがこれを呼び、`false` が返ればハンドシェイクを拒否する。

問題は、**このメソッドの既定実装が「常に `true` を返す」**ことである。つまり、

```java
// 修正前: エンドポイントをクラス指定でそのまま登録している
container.addEndpoint(TerminalSocket.class);
```

このようにアノテーション付きエンドポイントクラスをそのまま登録すると、コンテナは既定の `Configurator` を使い、`checkOrigin` は無条件に `true` を返す。結果として **`Origin` ヘッダーが何であろうとハンドシェイクは成立する**。開発者が「何も書かなかった」のではなく、「書かなければ全許可になる」というAPIの既定値に従った結果として穴が空いた、というのがこのCVEの構造である。

これは `ws`（Node.js）が既定でOriginを見ない、Django Channelsの `AllowedHostsOriginValidator` を自分で噛ませない限り素通しになる、といった前節のフレームワーク事情とまったく同じ形をしている。**WebSocketのOrigin検証は、どのスタックでも「明示的にオプトインする防御」であって、デフォルトで有効な防御ではない**。この一般則を、CVE-2024-51775は Java/Jetty 系のスタックで実証している。

もう一点、HTTPのCORSと対比しておくと理解が固まる。CORSでは、ブラウザが「レスポンスをJavaScriptに渡してよいか」を `Access-Control-Allow-Origin` で判定し、**ブラウザ側が**遮断する。ところがWebSocketのハンドシェイクにはCORSのプリフライトも、レスポンス読み取り制限も適用されない。`101 Switching Protocols` が返った時点でフレームの送受信は自由になる。したがって**防御の責任は100%サーバー側にある**。`checkOrigin` を実装しないことは、CORSで言えば `Access-Control-Allow-Origin: *` かつ `Allow-Credentials: true` を常時返しているのに近い状態になる。

#### 修正パッチを読む（PR apache/zeppelin#4823）

修正は「許可するOriginを起動時に1つ確定させ、`Configurator` で厳密一致を要求する」という最小構成である。新規追加されたクラスが本体で、実物は39行しかない。

```java
package org.apache.zeppelin.shell.terminal.websocket;

import javax.websocket.server.ServerEndpointConfig.Configurator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class TerminalSessionConfigurator extends Configurator {
  private static final Logger LOGGER =
      LoggerFactory.getLogger(TerminalSessionConfigurator.class);
  private String allowedOrigin;

  public TerminalSessionConfigurator(String allowedOrigin) {
    this.allowedOrigin = allowedOrigin;
  }

  @Override
  public boolean checkOrigin(String originHeaderValue) {
    boolean allowed = allowedOrigin.equals(originHeaderValue);
    LOGGER.info("Checking origin for TerminalSessionConfigurator: " +
        originHeaderValue + " allowed: " + allowed);
    return allowed;
  }
}
```

注目すべきは `allowedOrigin.equals(originHeaderValue)` という**完全一致比較**である。`startsWith` でも `contains` でも正規表現でもない。これは意図的に正しい。`startsWith("https://example.com")` なら `https://example.com.evil.net` が通り、`contains("example.com")` なら `https://evil-example.com.attacker.io` が通ってしまう。Origin検証のバイパスは、ほぼすべてが「部分一致」「サフィックス一致」「正規表現のドット未エスケープ」から生まれる。**ホワイトリストに対する完全一致（またはホワイトリスト集合への `contains` 判定）以外は書かない**、というのがここから持ち帰るべき実装規約である。

そして、この `Configurator` をエンドポイント登録に差し込む側が次の変更である。

```java
// 修正後: Builder経由でConfiguratorを明示的に注入する
container.addEndpoint(
    ServerEndpointConfig.Builder.create(TerminalSocket.class, "/")
        .configurator(new TerminalSessionConfigurator(allwedOrigin))
        .build());
```

`addEndpoint(Class)` から `addEndpoint(ServerEndpointConfig)` へ切り替えることで、はじめて `checkOrigin` の差し替えが効くようになる。許可Originの値そのものは、インタプリタ側が端末サーバーを起動する際に生成している。

```java
terminalPort = RemoteInterpreterUtils.findRandomAvailablePortOnAllLocalInterfaces();
terminalHostIp = RemoteInterpreterUtils.findAvailableHostAddress();
String allowedOrigin = generateOrigin(terminalHostIp, terminalPort);
terminalThread = new TerminalThread(terminalPort, allowedOrigin);

// ...
private String generateOrigin(String hostIp, int port) {
  return "http://" + hostIp + ":" + port;
}
```

つまり許可されるOriginは `http://<hostIp>:<randomPort>` ただ1つで、これはダッシュボードiframeが実際にロードされるURLと同一である。**「正規のクライアントが送ってくるOriginだけを許可する」**という、許可リストの最小化がそのままコードになっている。

回帰テストも同時に追加されており、クライアント側から任意の `Origin` を送って拒否を確認する形になっている。防御実装の検証方法としてそのまま流用できるので引用する。

```java
private static ClientEndpointConfig getOriginRequestHeaderConfig(String origin) {
  Configurator configurator = new Configurator() {
    @Override
    public void beforeRequest(Map<String, List<String>> headers) {
      headers.put("Origin", Arrays.asList(origin));
    }
  };
  return Builder.create().configurator(configurator).build();
}
```

```java
@Test
void testInvalidOrigin() {
  // ...
  String origin = "http://invalid-origin";
  ClientEndpointConfig clientEndpointConfig = getOriginRequestHeaderConfig(origin);
  // ... connectToServer が失敗することを確認
  assertTrue(exception instanceof IOException);
  assertEquals("Connect failure", exception.getMessage());
}
```

ここで押さえておきたいのは、**「不正なOriginでは接続自体が確立しない」ことをテストで固定している**点である。WebSocketの認可テストは「接続後に何ができるか」に目が行きがちだが、Origin検証は**ハンドシェイク段階で落ちること**が仕様であり、そこをアサートしないと退行に気づけない。自プロダクトにOrigin検証を入れるなら、必ずこの形の否定テスト（不正Origin → ハンドシェイク失敗）をCIに置くこと。

#### この事例から一般化できる教訓

1. **「アプリ本体とは別ポートで上がる補助サーバー」は認証・Origin検証の死角になる**。開発用ターミナル、メトリクス、ライブリロード、デバッガ用のWebSocketは、本体の認証ミドルウェアを通らないことが多い。棚卸しの際は「アプリが listen しているポートすべて」を対象にする。
2. **ランダムポート＋LAN限定は緩和であって防御ではない**。ブラウザは被害者のネットワーク内から接続するため、LANバインドは攻撃者のブラウザ経由で越えられる（いわゆるCSWSH／DNSリバインディング系の文脈）。到達性に依存した「事実上の安全」は、CVSSのスコアが割れる原因にもなる。
3. **検証は完全一致で書く**。`equals` 以外のOrigin比較を見たら、それだけでレビュー指摘の対象になる。
4. **バージョンを明記して管理する**。本件は 0.11.1〜0.11.x が影響を受け、**0.12.0 で修正**された。0.11系にバックポートリリースはないため、緩和ではなくアップグレードが唯一の恒久対策である（2026年9月時点）。

> 出典: NVD — CVE-2024-51775 — https://nvd.nist.gov/vuln/detail/CVE-2024-51775
> 出典: oss-security メーリングリスト「CVE-2024-51775: Apache Zeppelin: Missing Origin Validation in WebSockets」(2025-08-03) — http://www.openwall.com/lists/oss-security/2025/08/03/5
> 出典: apache/zeppelin PR #4823（修正パッチ） — https://github.com/apache/zeppelin/pull/4823

---

### ライトアップ集: Awesome-Bugbounty-Writeups から見るWebSocketの位置づけ

`devanshbatham/Awesome-Bugbounty-Writeups` は、バグバウンティのライトアップを**脆弱性タイプ別**に整理したキュレーションリポジトリである（`ngalongc/bug-bounty-reference` に着想を得たもの）。学習リソースとしての価値は個々の記事だけでなく、**「どのカテゴリにどれだけ報告が集まっているか」という分布そのもの**にもある。

#### コレクションの構造

README は16の脆弱性カテゴリで構成されている。2026年9月時点で、各カテゴリのエントリ数を数えると次の通りである。

| カテゴリ | エントリ数 |
|---|---|
| Cross Site Scripting (XSS) | 294 |
| Remote Code Execution (RCE) | 68 |
| Cross Site Request Forgery (CSRF) | 49 |
| SQL Injection (SQLi) | 34 |
| Server Side Request Forgery (SSRF) | 27 |
| Clickjacking / Subdomain Takeover | 各22 |
| CORS related issues | 15 |
| Local File Inclusion (LFI) | 13 |
| Authentication Bypass / Race Condition | 各12 |
| Denial of Service (DOS) | 11 |
| 2FA related issues | 10 |
| Buffer Overflow | 6 |
| Insecure Direct Object Reference (IDOR) | 5 |
| Android Pentesting | 1 |

ここで重要な観察が2つある。

**第一に、「WebSocket」という独立カテゴリは存在しない。** CSWSHもWebSocket経由XSSも、既存カテゴリ（CSRF / XSS / CORS）の中に埋もれている。これは偶然ではなく、**WebSocketの脆弱性が「新種」ではなく既存脆弱性クラスの輸送路違い**であることの反映である。本教科書がCSWSHをCSRFの延長として、メッセージ経由インジェクションをXSS/SQLiの延長として扱ってきたのと同じ構図が、コミュニティの分類実務にも現れている。

**第二に、その帰結として探索方法が決まる。** WebSocket関連の先行事例を探すときは、「websocket」で検索するだけでは取りこぼす。`CSRF`・`CORS`・`XSS` の各カテゴリを、`socket` / `wss://` / `Origin` といった語で横断的に見る必要がある。

#### WebSocket関連エントリ

このコレクション内でWebSocketに直接関係するエントリは次の通りである。

- **Exploiting websocket application wide XSS**（XSSカテゴリ, 39行目）— Osama Avvan
  https://medium.com/@osamaavvan/exploiting-websocket-application-wide-xss-csrf-66e9e2ac8dfa
- **Exploiting websocket application wide XSS and CSRF**（CSRFカテゴリ, 325行目）— 上と同一URL
- **Full account takeover through CORS with connection sockets**（CORSカテゴリ）— saamux
  https://medium.com/@saamux/full-account-takeover-through-cors-with-connection-sockets-179133384815

注目すべきは、**同一の記事がXSSとCSRFの両カテゴリに重複登録されている**ことである。キュレーターの手違いではなく、この報告が実際に両方の性質を併せ持つためだと読める。WebSocket経由の攻撃は、(1) 別オリジンから接続を開ける（＝CSRFの性質）、(2) 開いた接続から注入したメッセージが他ユーザーのDOMに到達する（＝XSSの性質）という**二段構えになりやすい**。前節で見た「CSWSHは双方向であるがゆえにCSRFより強い」という論点が、分類の重複という形で可視化されている。

#### Exploiting WebSocket [Application Wide XSS / CSRF]

> ⚠️ **未取得の資料**: 「Exploiting WebSocket [Application Wide XSS / CSRF]」（Osama Avvan, Medium）は本文を自動取得できませんでした（理由: MediumがWebFetchに対し HTTP 403 Forbidden を返すため。GitHubミラーにも本文は存在しません）。以下のURLからご自身で直接ご覧ください: https://medium.com/@osamaavvan/exploiting-websocket-application-wide-xss-csrf-66e9e2ac8dfa

検索結果から確認できた範囲では、この報告の骨子は次の通りである。WebSocketメッセージがアプリケーション全体で共有される描画経路に流れ込んでいたため、注入されたペイロードが**特定の1ページではなくWebアプリの全ページで実行される（application wide）**状態になっていた。さらに同じ経路を通じて被害者のメールアドレス変更などの状態変更操作も可能で、これがCSRF／コンテンツインジェクションとしてもアプリ全体に及んだ。PoCとしてはWebSocket接続を張り、`document.body` の内容を書き換えるメッセージを送るデモが用いられ、報告は **P1（最重要）** として受理された、とされている。

（以下は未取得資料の補足として一般知識に基づく解説です）

この「アプリケーション全体に及ぶXSS」という性質は、WebSocket特有の**接続の永続性とブロードキャスト構造**から説明できる。従来の反射型XSSは「特定のURLを踏ませる」必要があり、影響範囲は1リクエスト1ページに閉じる。しかしWebSocketの場合、

- 接続はSPAのシェル（全ページ共通のレイアウト）で1本張られ、ページ遷移をまたいで生き続ける
- 受信メッセージは通知バナーやチャットウィジェットなど、**全ページに常駐するコンポーネント**に渡される
- そのコンポーネントが `innerHTML` 相当のsink（入力が最終的に解釈・実行される危険な代入先）を持っていると、1回の注入が全ページ・全滞在時間にわたって発火する

という条件が揃う。つまり「蓄積型XSSの持続性」と「全ページ常駐UIの到達範囲」が掛け算になる。防御側の含意は明確で、**WebSocketの受信ハンドラは、HTTPレスポンスの描画経路と同等以上に厳格な出力エンコーディングを要求される**。具体的には次のような形になる。

```js
// 危険: サーバーから来た文字列をそのままHTMLとして解釈させている
socket.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  notificationBar.innerHTML = msg.text;   // ← sink
};

// 安全: テキストとして扱い、HTMLパーサに渡さない
socket.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  notificationBar.textContent = msg.text; // パースされず文字列のまま表示される
};
```

`innerHTML` は代入された文字列をHTMLパーサに通すため `<img src=x onerror=...>` のようなペイロードがイベントハンドラとして生きるのに対し、`textContent` はDOMテキストノードを作るだけでパースが起こらない。React/Vueであれば `dangerouslySetInnerHTML` / `v-html` が同じ位置のsinkに当たる。**「WebSocketから来たデータは信頼できる内部データである」という暗黙の前提**が、このクラスの報告の根っこにある。

#### 隣接エントリ: CORS と WebSocket の合流点

CORSカテゴリの「Full account takeover through CORS with connection sockets」も同じ文脈で読む価値がある。CORS設定ミス（`Access-Control-Allow-Origin` をリクエストの `Origin` でそのまま反響し、かつ `Allow-Credentials: true` を返す等）と、ソケット接続によるデータ取得が連鎖してアカウント乗っ取りに至る形である。

ここで押さえるべき原理の対比を再掲する。

| | HTTP + CORS | WebSocket |
|---|---|---|
| クロスオリジン要求の送信 | 常に可能（単純リクエスト） | 常に可能 |
| Cookieの自動付与 | `credentials` 指定時 | 常に付与される |
| プリフライト | 条件により発生 | **発生しない** |
| レスポンス読み取りの遮断 | ブラウザがCORSヘッダで判定 | **遮断されない** |
| 防御の所在 | ブラウザ＋サーバーの協調 | **サーバーのOrigin検証のみ** |

CORS設定ミスの調査でエンドポイントを洗うとき、同じホストの `wss://` エンドポイントも同時に確認すべき理由がこの表に尽きている。CORSのミスは「読み取り可能になる」だけだが、WebSocketのOrigin未検証は最初から「双方向に使える」状態であり、しかもブラウザ側の安全網が一枚もない。

#### 防御側としてのライトアップ集の使い方

このリポジトリは攻撃手順のカタログとしてではなく、**自社サービスに対する仮説生成の道具**として使うのが健全である。実務的な読み方を挙げる。

1. **カテゴリ横断で「自社に存在する機能」に当たる記事だけを読む**。チャット、通知、ライブ更新ダッシュボード、協調編集を持つなら WebSocket 関連3本は必読。
2. **記事から「前提条件」だけを抽出してチェックリスト化する**。例: 「Origin未検証か」「Cookieのみでハンドシェイク認証しているか」「受信メッセージが全ページ常駐UIに届くか」「そのUIは `innerHTML` を使うか」。
3. **社内の検証は必ず自社の検証環境で行う**。これらの記事は既に修正済みの実在サービスを対象にしている。同じ手順を第三者のサービスへ向けることは、たとえ報奨金プログラムがあってもスコープ・規約の確認なしには許されない。

> 出典: devanshbatham/Awesome-Bugbounty-Writeups（README） — https://github.com/devanshbatham/Awesome-Bugbounty-Writeups/blob/master/README.md
> 出典: Osama Avvan「Exploiting WebSocket [Application Wide XSS / CSRF]」（本文未取得） — https://medium.com/@osamaavvan/exploiting-websocket-application-wide-xss-csrf-66e9e2ac8dfa

---

### 本節のまとめ

- **CVE-2024-51775 は「デフォルトが全許可」というAPI設計が脆弱性を生む典型例**である。JSR-356 の `ServerEndpointConfig.Configurator#checkOrigin` は既定で常に `true` を返すため、`addEndpoint(TerminalSocket.class)` と書いた瞬間にOrigin検証は消える。影響は 0.11.1〜0.11.x、修正は 0.12.0。
- 修正パッチは **`allowedOrigin.equals(originHeaderValue)` という完全一致**と、**許可Originを正規クライアントのURLただ1つに絞る**という最小構成で実現されている。加えて「不正Originではハンドシェイクが失敗する」ことを否定テストで固定している。この3点はそのまま自プロダクトの実装規約に転用できる。
- **アプリ本体と別ポートで上がる補助WebSocket（ターミナル、デバッガ、ライブリロード）は認証・Origin検証の死角**になりやすい。listenしているポートを網羅的に棚卸しすること。
- ライトアップ集にWebSocket専用カテゴリが存在せず、同じ記事がXSSとCSRFに重複登録されている事実は、**WebSocketの脆弱性が既存クラスの輸送路違いである**ことを示す。探索も防御も、既存のXSS/CSRF/CORSの知見をWebSocketという経路に接続し直す作業になる。
- WebSocket受信データは外部入力である。全ページ常駐UIに届く経路では、`innerHTML` 系sinkを避け `textContent` 等を使うこと。接続の永続性と常駐UIの到達範囲が掛け合わさると、1回の注入が「アプリケーション全体のXSS」へ増幅される。


---

[📖 目次](index.md) ・ [← 第8章 WebSocketの他の脆弱性](08-websocket-other-vulns.md) ・ [第10章 発展・方法論・防御の理解 →](10-defense-methodology.md)
