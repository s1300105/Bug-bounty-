## GraphQL脆弱性の全体像と代表的CVE

GraphQLはクライアントが「欲しいデータの形」をクエリとして宣言し、サーバーが単一のエンドポイント（多くは`/graphql`）でそれを解決するクエリ言語兼ランタイムである。REST APIのように「リソースごとに複数のエンドポイントへ複数回リクエストする」のではなく、1回のリクエストで必要なフィールドだけを取得できるため、オーバーフェッチ（不要なデータまで返ってくる無駄）やアンダーフェッチ（必要なデータを得るために何度も往復する無駄）を減らせる。この「単一エンドポイント・柔軟なクエリ」という設計そのものが、REST時代の防御策（URLパスごとのWAFルール、エンドポイント単位のレート制限など）をすり抜けやすい構造的な弱点になっている。本節では、GraphQL特有の脆弱性クラスを俯瞰し、実際に公表されたCVE・GHSA（GitHub Security Advisory）を年表として整理したうえで、なぜそれらが起こるのかという仕組みレベルの理由を解説する。

### GraphQLの基本構造とリスクの土台

GraphQLは以下の要素から成る。

- **スキーマ**: 利用可能な型（Type）・フィールド・引数を定義した設計図
- **クエリ（Query）**: データ取得操作
- **ミューテーション（Mutation）**: データ変更操作
- **サブスクリプション（Subscription）**: WebSocketなどを介したリアルタイム購読（第2部で扱う）
- **リゾルバ（Resolver）**: 各フィールドを実際に解決する関数。ここがDB・外部API・ファイルシステムなどへの「sink（入力が最終的に実行・解釈される危険な代入先）」になりやすい

REST API向けに培われた防御（パスごとのアクセス制御、URLベースのレート制限、境界でのバリデーション）は、GraphQLでは「1つのURL・1つのHTTPメソッド（多くはPOST）の中に無数の操作が畳み込まれる」ため機能しにくい。この非対称性こそが、本節で扱うほぼ全ての脆弱性クラスに共通する根本原因である。

> ⚠️ **未取得の資料**: 「HackTricks - GraphQL」はhacktricks.wiki本体からの直接取得がHTTP 402（Payment Required）でブロックされたため、GitHub原本（HackTricks-wikiリポジトリのraw Markdown）から代替取得した。内容はhacktricks.wikiの正典と同一ソースに基づく。

### 脆弱性クラス1: イントロスペクション（introspection）による情報漏洩

イントロスペクションとは、GraphQLスキーマ自体をGraphQLクエリで問い合わせられる機能である。`__schema`という予約フィールドに対してクエリを投げると、定義済みの全ての型・フィールド・引数・説明文が返ってくる。

```graphql
query {
  __schema {
    types {
      name
      fields {
        name
        args { name description type { name kind ofType { name kind } } }
      }
    }
  }
}
```

多くのGraphQL実装では開発体験を優先してこの機能がデフォルトで有効になっており、本番環境で無効化し忘れると、攻撃者はAPIドキュメントを読まなくても内部構造（隠しフィールド名、管理者専用ミューテーション名など）を丸ごと入手できる。これは「なぜ危険か」が単純で、スキーマは本来「攻撃対象領域の地図」そのものだからである。

イントロスペクションを無効化していても、以下の手法で迂回・再構成が可能である。

- `__schema`の直後に改行・空白・カンマなどの空白文字を挿入し、単純な正規表現ベースのフィルタ（`__schema`という文字列を検出してブロックするWAFルールなど）を回避する
- エラーメッセージの「もしかして: `passwordHash` フィールドですか？」のようなフィールド候補提示（field suggestion）から、存在するフィールド名を1つずつ推測する
- `clairvoyance`のような辞書ブルートフォースツールで、大量の単語リストを総当たりし、エラー応答の有無からスキーマを再構築する

> 出典: HackTricks — GraphQL（GitHub原本, HackTricks-wikiリポジトリ） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md

実際の被害例として、**CVE-2023-47643**（SuiteCRM 8.4.2未満）では、未認証のユーザーが`__schema`クエリを送るだけでスキーマ全体を取得できた。修正版ではイントロスペクションのデフォルト無効化とフィールド候補提示の抑制が行われている。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

**防御**: 本番環境ではイントロスペクションを明示的に無効化する（多くのフレームワークでは`introspection: false`のような設定フラグがある）。さらに、フィールド候補提示（field suggestion）機能自体を切らないとClairvoyance系ツールによる再構成を防げない点に注意する。

### 脆弱性クラス2: バッチング・エイリアス濫用によるレート制限バイパス

GraphQLの仕様上、1つのHTTPリクエストの中に複数の操作（配列形式のバッチクエリ）や、同一フィールドを別名（エイリアス）で複数回呼び出すクエリを詰め込める。これが「1リクエスト=1操作」を前提にしたレート制限・ブルートフォース検知を無効化する。

**バッチングによるブルートフォース（batching brute force）**の例:

```json
[
  {"query":"mutation{login(email:\"a@test.com\",password:\"pass1\"){token}}"},
  {"query":"mutation{login(email:\"b@test.com\",password:\"pass2\"){token}}"},
  {"query":"mutation{login(email:\"c@test.com\",password:\"pass3\"){token}}"}
]
```

外部の監視装置（WAFやレート制限ミドルウェア）はHTTPリクエスト数を基準にカウントするため、これは「1リクエスト」としてしか記録されない。しかし内部では配列内の要素数だけログイン試行が実行される。

**エイリアスオーバーロード（alias overloading）**の例:

```graphql
query isValidDiscount($code: Int) {
  isValidDiscount(code: $code) { valid }
  isValidDiscount2: isValidDiscount(code: $code) { valid }
  isValidDiscount3: isValidDiscount(code: $code) { valid }
}
```

GraphQLの仕様では同一フィールドを複数回問い合わせる際、結果のキーが衝突しないよう「エイリアス」という別名を付けられる。この仕組みを悪用すると、1リクエストの中に数百〜数千のエイリアス付きフィールドを並べることで、実質的に大量の実行を1リクエストに圧縮できる。

> 出典: HackTricks — GraphQL（GitHub原本） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md

実際の脆弱性として**CVE-2024-39895**（Directus, CVSS 6.5, 10.12.0で修正）では、認証済みユーザーがエイリアス／フィールド重複を用いてレート制限を回避し、データベース負荷を線形に増大させられた。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

**防御**: レート制限を「HTTPリクエスト数」ではなく「実行される操作数・フィールド数」単位で計測する。バッチング自体を無効化する、あるいはバッチ内の操作数やクエリ内のエイリアス数に上限を設けるミドルウェア（後述の`graphql-armor`など）を導入する。

### 脆弱性クラス3: クエリ複雑性・パーサDoS

GraphQLはクエリの「深さ」や「複雑さ」に本来上限がない。悪意あるクライアントはこれを使って、サーバー側に指数関数的な処理負荷をかけられる。

**循環フラグメントによる無限再帰**:

```graphql
fragment A on Query { ...B }
fragment B on Query { ...A }
query { ...A }
```

フラグメント同士が互いを参照し合う循環定義を送ると、パーサやバリデータがこれを展開しようとして無限ループ、もしくはスタックオーバーフローを起こす。

**ディレクティブオーバーロード**:

```graphql
query overload {
  __typename @include(if: true) @include(if: true) @include(if: true)
}
```

同一フィールドに`@include`のようなディレクティブを大量に重ねると、実行ノードの数が指数関数的に増え、CPU・メモリを枯渇させる。これは実際に**CVE-2024-47614**（Rust製async-graphql、7.0.10で修正）として報告されており、同種の脆弱性はGo実装の`gqlparser`でも**CVE-2023-49559**（CVSS 5.3、ディレクティブ数の制限漏れ）として確認されている。

**その他の確認済みDoS系CVE**（年表は後述の表にまとめる）として、graphql-java（Java）の**CVE-2023-28867**は深いネストクエリでJVMのスタックオーバーフローを起こし、graphql-js（npm、JavaScript/TypeScript実装）の**CVE-2023-26144**はフィールドマージ検証ルール（`OverlappingFieldsCanBeMergedRule`）の計算量爆発によりリソースを消費した。さらに新しい例として、.NET実装Hot Chocolateの**CVE-2026-40324**（Critical）は約40KBのクエリ文字列だけでパーサのスタックオーバーフローを引き起こし、.NET特有の「キャッチ不能な`StackOverflowException`」によりプロセスごとクラッシュする点が深刻とされる。Apollo Router（Rust製GraphQLゲートウェイ）の**CVE-2025-32032**は再帰的なフラグメント展開でスレッドプールを枯渇させるもので、1.61.2未満／2.1.1未満が対象である。

```bash
# エイリアス大量生成によるDoSの検証例（防御設計の理解のための例示であり、
# 許可されたテスト環境以外で実行してはならない）
curl -X POST -H "Content-Type: application/json" \
  -d '{"query": "{ alias0:__typename alias1:__typename ... alias99:__typename }"}' \
  'https://example.com/graphql'
```

このリクエストは`__typename`という軽量フィールドを数百のエイリアスで並べるだけで、パーサ・バリデータ・実行エンジンのそれぞれに負荷をかける。1フィールドあたりのコストは小さくても、数を線形に増やすだけでサーバー側の処理は比例して重くなり、深いネストと組み合わせるとその負荷は掛け算的に増幅する。

GitLab GraphQL API（v12.4〜18.11.0）でも**CVE-2025-3922**（CWE-770: 無制限リソース消費）が報告されており、GraphQL特有のDoSが特定製品固有の実装バグではなく「仕様上クエリの形を制限しないと防げない」構造的な問題であることを裏付けている。セキュリティ企業Escapeによる2024年の調査では、走査対象エンドポイントの69%がこの種のDoSに脆弱だったと報告されている。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks
> 出典: HackTricks — GraphQL（GitHub原本） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md
> 出典: DeepStrike — GraphQL: How It Works, Why It Beats REST, & Security Risks — https://deepstrike.io/blog/graphql-api-vulnerabilities-and-common-attacks

**防御**: クエリの最大深さ（depth limit）・最大複雑度（complexity score）・最大エイリアス数・最大ディレクティブ数を静的に制限する。`graphql-armor`のようなミドルウェアを使えば、これらの上限をまとめて適用できる。

```typescript
import { protect } from '@escape.tech/graphql-armor';
const protectedSchema = applyMiddleware(schema, ...protect());
```

さらに`@defer`・`@stream`のようなインクリメンタル配信ディレクティブ（レスポンスを複数チャンクに分割して段階的に返す仕組み）も、チャンク数に上限を設けないと同種の増幅攻撃（1回のリクエストで数千のチャンクを生成させ、応答サイズを膨張させると同時にボディサイズベースのWAFルールを迂回する）に使われうる。

### 脆弱性クラス4: 認可バイパス（BOLA / BFLA / BOPLA）

GraphQLでは「認証はできているがリゾルバ単位の認可が漏れている」パターンが極めて多い。OWASP API Security Top 10（2023年版）の分類に沿って整理すると次の3種になる。

- **BOLA（Broken Object-Level Authorization、オブジェクトレベル認可の欠落）**: `user(id: "任意のID")`のように、他人のオブジェクトIDを指定しても所有者チェックが働かず閲覧・操作できてしまう。Shopifyの脆弱性報奨金プログラムで報告された事例（HackerOne #2207248、5,000ドルの報奨）では、`BillingDocumentDownload`や`BillDetails`といったクエリで権限のないユーザーが他社の請求書情報へアクセスできた。
- **BFLA（Broken Function-Level Authorization、機能レベル認可の欠落）**: 一般ユーザーが管理者専用のミューテーションを実行できてしまう。Hasura（**CVE-2022-46792**、v2.10.0〜v2.15.1）では「Update Many」APIがPostgresバックエンド利用時に行レベル認可を正しく適用せず、本来更新・取得できないはずの行を操作できた。
- **BOPLA（Broken Object Property-Level Authorization、プロパティレベル認可の欠落＝マスアサインメント）**: ミューテーションが`role`や`isAdmin`、`balance`のような本来クライアントが指定すべきでないフィールドをそのまま受け付けてしまい、権限昇格や残高改ざんにつながる。

```graphql
# 本来は非公開であるべきフィールドへの認可漏れの例
query {
  user(id: "1") {
    id
    name
    email
    passwordHash  # リゾルバ側でのフィールド単位アクセス制御が漏れている場合に露出する
  }
}
```

GraphQLでこの種の欠陥が起きやすい理由は、REST的な「エンドポイントごとにミドルウェアで認可をかける」発想のままGraphQLサーバーを構築すると、GraphQLは全てのクエリが単一エンドポイントを通るため「エンドポイント単位の認可」が実質機能せず、各リゾルバの中で個別に権限チェックを書き込む必要があるという実装モデルの違いにある。1つでもリゾルバに認可チェックを書き漏らすと、そのフィールド・ミューテーションだけが無防備になる。

また、クエリ内に無関係な操作を連結して認可チェックの単位（操作名のみを見るような雑なチェック）をすり抜ける手法もある。

```graphql
mutation {
  forgotPassword(email: "victim@test.com") { success }
  register(email: "attacker@test.com", password: "pass") { token }
}
```

サーバー側が「このリクエストの操作名は`forgotPassword`だから許可する」のようにトップレベルの操作名だけで判定していると、同時に埋め込んだ別の操作（この例では`register`）が検証をすり抜けて実行されてしまう。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks
> 出典: HackTricks — GraphQL（GitHub原本） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md
> 出典: DeepStrike — GraphQL: How It Works, Why It Beats REST, & Security Risks — https://deepstrike.io/blog/graphql-api-vulnerabilities-and-common-attacks

**防御**: 認可はリゾルバ単位（フィールド単位）で実装し、可能であればスキーマレベルのディレクティブ（`@auth`のようなカスタムディレクティブ）で宣言的に付与して書き漏れを防ぐ。操作名だけでなく、リクエスト内の全ての操作・フィールドに対して認可を適用する。

### 脆弱性クラス5: CSRF（クロスサイトリクエストフォージェリ）

GraphQLは基本的にPOSTリクエスト＋`application/json`ボディで送られる設計が推奨されるが、多くのサーバー実装は後方互換性や利便性のために`application/x-www-form-urlencoded`のような「シンプルなコンテンツタイプ」も受け付けてしまう。シンプルなコンテンツタイプで送られたクロスオリジンリクエストはブラウザのCORSプリフライト（実際のリクエスト前に許可を確認する事前送信）の対象にならないため、攻撃者が用意した外部サイトのHTMLフォームから、被害者のセッションクッキーを使ってGraphQLミューテーションを実行させられる。

```html
<form action="https://target.example/graphql" method="POST"
      enctype="application/x-www-form-urlencoded">
  <input name="query"
         value='mutation{updateProfile(username:"attacker"){id}}'>
</form>
<script>document.forms[0].submit()</script>
```

被害者が上記HTMLを踏むと、ブラウザは被害者のクッキーを自動付与してGraphQLエンドポイントにPOSTし、サーバーはCSRFトークンなどの追加検証がなければ正規のリクエストとして処理してしまう。

実例として、Apollo Server 2系（**GHSA-2p3c-p3qw-69r4**、2022年5月公表）では、ファイルアップロード機能`graphql-upload`が`multipart/form-data`リクエストをCSRF検証なしに受け付けており、バージョン2.0.0〜2.25.3が影響を受けた。これを受けてApollo Server 4以降は`csrfPrevention`をデフォルトで有効にし、単純なコンテンツタイプのリクエストには追加のプリフライト用ヘッダーを要求するよう仕様が変更された。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks
> 出典: HackTricks — GraphQL（GitHub原本） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md

**防御**: `application/json`以外のコンテンツタイプを拒否する、CSRFトークンを実装する、クッキーに`SameSite=Strict`（または`Lax`）を付与する、の三点を組み合わせる。

### 脆弱性クラス6: インジェクション（SQLi/NoSQLi/コマンド/SSRF）とその他の情報漏洩

GraphQLのリゾルバは最終的に何らかのバックエンド（RDB、NoSQL、ファイルシステム、外部HTTP API）へアクセスする。GraphQL自体は型システムを提供するが、リゾルバの実装が文字列連結でSQLを組み立てたり、ユーザー入力をそのままNoSQLのフィルタ演算子（`$where`や`$regex`など）に渡したりすれば、通常のREST APIと同様にSQLインジェクション・NoSQLインジェクションが成立する。同様に、URL引数を検証なしにサーバー内部からのHTTPリクエストに使えば**SSRF（Server-Side Request Forgery、サーバーに内部ネットワークへの不正なリクエストを代行させる攻撃）**が、シェルコマンドに渡せば**OSコマンドインジェクション**が成立する。反射型・保存型XSSも、クエリ結果や保存されたフィールド値をブラウザ側で未エスケープのままレンダリングすれば発生する。

さらにGraphQL固有の情報漏洩経路として、詳細すぎるエラーメッセージ（有効なフィールド名や内部の型情報を示唆する）、`extensions`フィールドでのトレーシング情報（実行時間やリゾルバ内部の処理順）の露出、本番環境に残されたGraphiQL/GraphQL Playgroundのようなデバッグ用IDE、GETリクエストでクエリを送信した場合にブラウザ履歴やプロキシログへPIIが残ることなどが挙げられる。

> 出典: DeepStrike — GraphQL: How It Works, Why It Beats REST, & Security Risks — https://deepstrike.io/blog/graphql-api-vulnerabilities-and-common-attacks
> 出典: Imperva — GraphQL API Vulnerabilities and Common Attacks — https://www.imperva.com/blog/graphql-vulnerabilities-common-attacks/

**防御**: パラメータ化クエリ（プレースホルダを使い、入力値をSQL文の一部として解釈させない実装）を徹底し、NoSQLでは演算子を許可リスト化する。本番ではデバッグIDE・詳細エラー・トレーシングを無効化し、GETでのクエリ送信を禁止してPOST＋JSONのみを受け付ける。

### 代表的CVE年表（2022〜2026年）

各脆弱性クラスの実例を時系列にまとめると、GraphQLの弱点が特定ベンダーに限らず、複数言語・複数実装にまたがって繰り返し現れていることが分かる。

| 時期 | CVE/GHSA | 対象 | 概要 |
|------|----------|------|------|
| 2022年5月 | GHSA-2p3c-p3qw-69r4 | Apollo Server 2（2.0.0〜2.25.3） | `graphql-upload`がmultipart/form-dataをCSRF検証なしに受理 |
| 2022年12月 | CVE-2022-46792 | Hasura v2.10.0〜v2.15.1 | Update ManyでのPostgres行レベル認可漏れ（BFLA） |
| 2023年3月 | CVE-2023-28867 | graphql-java | 深いネストクエリによるスタックオーバーフロー |
| 2023年9月 | CVE-2023-26144 | graphql-js（npm）16.3〜16.8 | フィールドマージ検証のリソース枯渇 |
| 2023年11月 | CVE-2023-47643 | SuiteCRM 8.4.2未満 | 未認証でのイントロスペクション有効 |
| 2023年12月 | CVE-2023-49559 | gqlparser（Go）2.5.14未満 | ディレクティブ数超過によるDoS（CVSS 5.3） |
| 2024年7月 | CVE-2024-39895 | Directus 10.12.0未満 | エイリアス／フィールド重複によるDoS（CVSS 6.5） |
| 2024年9月 | CVE-2024-47614 | async-graphql（Rust）7.0.10未満 | ディレクティブオーバーロードDoS |
| 2025年4月 | CVE-2025-3922 | GitLab GraphQL API v12.4〜18.11.0 | 無制限リソース消費（CWE-770） |
| 2025年4月 | CVE-2025-32032 | Apollo Router 1.61.2未満／2.1.1未満 | 再帰的フラグメント展開によるスレッドプール枯渇 |
| 2026年（Q1） | CVE-2026-40324 | Hot Chocolate（.NET）12.22.7未満、13〜15系 | 約40KBのクエリでパーサがスタックオーバーフロー（Critical） |

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

これらは公表時点でのバージョン・深刻度であり、各ライブラリ・製品を利用する際は必ず最新のアドバイザリを確認し、該当バージョンを使用している場合は速やかにパッチを適用すべきである（例: async-graphqlは7.0.10以降、graphql-javaは19.11以降、Apollo Gatewayは2.10.1以降でそれぞれ既知の脆弱性が修正されている）。

### エンドポイント検出とツール

GraphQLエンドポイントは慣習的なパス名を持つことが多く、次のようなパスがディレクトリブルートフォースの対象になる。

```
/graphql
/graphiql
/graphql.php
/api/graphql
/graphql/console
```

`graphw00f`はGraphQLサーバーの実装エンジン（Apollo Server、graphql-java、Hasuraなど）をフィンガープリントし、既知の脆弱性に対応付けるツールである。InQLはBurp Suite統合のGraphQLテストツール、GraphQL Voyagerはスキーマを図として可視化するツール、Clairvoyanceは前述の通りイントロスペクション無効時の辞書ブルートフォースツールとして使われる。

> 出典: HackTricks — GraphQL（GitHub原本） — https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/network-services-pentesting/pentesting-web/graphql.md
> 出典: DeepStrike — GraphQL: How It Works, Why It Beats REST, & Security Risks — https://deepstrike.io/blog/graphql-api-vulnerabilities-and-common-attacks

### 全体像のまとめ: なぜGraphQLはこれらの脆弱性を生みやすいのか

ここまで見た脆弱性クラスに共通するのは、いずれも「GraphQLという表現力の高いクエリ言語を、単一エンドポイント・単一HTTPリクエストという枠に押し込めたことで生じるミスマッチ」である。

- REST時代の境界防御（URLパスごとのWAF・レート制限）は、全操作が1つのURLに集約されるGraphQLでは粒度が粗すぎて機能しない → バッチング・エイリアス濫用によるレート制限バイパスやブルートフォース
- クエリの「形」を自由に組み立てられる柔軟性が、そのままパーサ・実行エンジンへの負荷を無制限に増幅する手段になる → 深いネスト・循環フラグメント・ディレクティブオーバーロードによるDoS
- 「エンドポイントごとの認可」という発想のままリゾルバ単位の認可実装を怠ると、フィールド単位で穴が生まれる → BOLA/BFLA/BOPLA
- 開発時の利便性（イントロスペクション、詳細エラー、デバッグIDE）が本番に残ると、そのまま攻撃者への地図になる → スキーマ漏洩・情報開示

業界調査では、GraphQLの採用率は2025年時点で組織の約70%（Wallarm 2025調査）、API全体の約33%（Postman 2025 State of API）に達しており、採用の広がりとともに攻撃対象領域も拡大している。Akamaiの集計では2023年1月〜2024年12月の間に約1,500億件のAPI攻撃が観測され、Escapeの2024年調査では公開GraphQLエンドポイント160件のうち13,720件の問題（うち4,527件がクリティカル）が発見されたと報告されている。これらの数字は、GraphQL固有の脆弱性が理論上の懸念ではなく、実運用環境で日常的に悪用されていることを裏付けている。

> 出典: Stingrai — GraphQL API Vulnerabilities, Attacks & CVEs (2026) — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks
> 出典: Imperva — GraphQL API Vulnerabilities and Common Attacks — https://www.imperva.com/blog/graphql-vulnerabilities-common-attacks/

次節以降では、これらの脆弱性クラスをそれぞれ掘り下げ、実際にどのように検出し、どのように防御を実装するかを、許可されたテスト環境を前提とした手順とともに解説していく。
