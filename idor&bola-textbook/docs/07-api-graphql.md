# 第7章 API/GraphQL特有のアクセス制御

## PortSwigger GraphQL と Mass Assignment

本節では、API特有のアクセス制御崩壊のうち特に代表的な2つのパターンを扱う。ひとつは GraphQL という単一エンドポイント型のクエリ言語が生む固有のIDOR/BOLA（Broken Object Level Authorization、オブジェクトレベルの認可欠如）攻撃面、もうひとつは REST/JSON APIで頻出する Mass Assignment（マスアサインメント、大量代入）と呼ばれる、リクエストボディのフィールドがそのままサーバー側オブジェクトの属性に自動的に束縛（バインド）されてしまう脆弱性である。両者に共通するのは、「クライアントが送ってきたデータ構造をサーバーが無批判に信頼してしまう」という設計上の欠陥であり、これはIDOR/BOLAの本質——「アクセス制御チェックをオブジェクト単位で行っていない」——と地続きの問題である。

### GraphQLの基本構造と、なぜIDORが起きやすいのか

GraphQLはRESTと異なり、リソースごとにURLを分けるのではなく、通常 `/graphql` のような単一のエンドポイントに対してクエリ（query、読み取り）、ミューテーション（mutation、書き込み）、サブスクリプション（subscription、リアルタイム購読）をPOSTボディとして送信する。クライアントは必要なフィールドだけを指定して取得できる柔軟性を持つ一方、この柔軟性こそが攻撃面を広げる。

GraphQLエンドポイントには予約フィールド `__typename` が必ず存在し、クエリされたオブジェクトの型名を文字列で返す。これを利用すると、対象エンドポイントがGraphQLかどうかを機械的に判定できる。

```graphql
query{__typename}
```

このクエリを `/graphql`、`/api`、`/api/graphql`、`/graphql/api` といった典型的なパスに送り、`{"data": {"__typename": "query"}}` のようなレスポンスが返れば、そのエンドポイントはGraphQLを話している。テストの際は `application/json` でのPOSTだけでなく、GETリクエストや `x-www-form-urlencoded` でのPOSTも試す価値がある。後述するCSRFの脆弱性はまさにこの受理範囲の広さに起因する。

> 出典: GraphQL API vulnerabilities — https://portswigger.net/web-security/graphql

#### 引数の入力検証不足によるIDOR

GraphQLの各フィールドは引数（argument）を取れる。典型例が「IDを引数にオブジェクトを取得する」クエリである。

```graphql
query { 
  product(id: 3) { 
    id 
    name 
    listed 
  } 
}
```

ここで `id` に対する所有者チェックや、`listed`（公開/非公開フラグ）に応じたアクセス制御がサーバー側resolver（リゾルバ、GraphQLの各フィールドの値を実際に計算・取得するバックエンド関数）で行われていなければ、`id` を1から順に変えていくだけで非公開・削除済み・他ユーザー所有の商品情報を横断的に閲覧できてしまう。これは古典的なIDOR/BOLAと全く同じ構造であり、REST APIの `GET /products/3` を `GET /products/4` に書き換える攻撃のGraphQL版に過ぎない。攻撃者にとっての利点は、単一エンドポイントでスキーマさえ分かればどのオブジェクトタイプに対しても同様の総当たりが機械的に行えることである。

#### イントロスペクションによるスキーマ全体の暴露

GraphQLはスキーマ（利用可能な型・クエリ・ミューテーション・フィールド・引数の完全な定義）を自己記述する「イントロスペクション（introspection、内省）」というメタクエリ機能を標準搭載している。これは開発時のツール連携（IDE補完やドキュメント自動生成）のために極めて有用だが、本番環境で無効化されていないと攻撃者にAPI全体の「設計図」を渡すことになる。

最小のプローブは以下である。

```json
{"query": "{__schema{queryType{name}}}"}
```

実際の攻撃では `FullType`、`InputValue`、`TypeRef` といったフラグメント（fragment、再利用可能なフィールド選択の断片）を組み合わせた、ネストの深い完全イントロスペクションクエリが使われ、これにより全ての型・全てのミューテーション・全てのサブスクリプション・各フィールドの非推奨状況・description（説明文）フィールドまで抽出できる。descriptionフィールドには開発者が残したデバッグ用の注記が含まれ、機密情報の手がかりになることもある。互換性の都合で `onOperation`、`onFragment`、`onField` といった古いディレクティブを除去する必要がある場合もある。

得られるスキーマ情報のうち特に攻撃者にとって価値が高いのは、「認可チェックの対象になっていない可能性が高い、管理者向けやデバッグ用のクエリ/ミューテーション名」である。これらは通常UIから到達できないため見落とされやすく、権限昇格やBOLAの直接的な足がかりになる。

> 出典: GraphQL API vulnerabilities — https://portswigger.net/web-security/graphql

#### イントロスペクション対策の回避

開発者が `__schema` という文字列を正規表現でブロックするだけの対策を施している場合、以下のような回避が可能である。

**空白挿入によるパターン回避**

```graphql
query{__schema 
{queryType{name}}}
```

文字列 `__schema{` の間に改行やスペースを挟むことで、単純な文字列マッチング型のフィルタを迂回できる。これはWAF回避の基本原理——「パーサは空白を無視するが、正規表現ベースのフィルタは文字列の並びに厳密である」——をGraphQLパーサに適用したものである。

**HTTPメソッドの変更**

```
GET /graphql?query=query%7B__schema%0A%7BqueryType%7Bname%7D%7D%7D
```

POSTボディのみを検査するWAFやミドルウェアが存在する場合、同じクエリをURLエンコードしてGETのクエリ文字列に載せることで検査をすり抜けられることがある。これはGraphQLエンドポイントがGET経由でも動作を受理してしまう実装が少なくないために成立する。

**イントロスペクションが無効でもスキーマを推測する: Clairvoyanceの原理**

イントロスペクション自体を完全に無効化していても、Apollo Serverなどの一部の実装は、存在しないフィールド名をクエリした際のエラーメッセージに「Did you mean 'productInformation'?」のような**サジェスト（typo修正候補）**を含めてしまう。この挙動を悪用し、辞書的にフィールド名を総当たりしてエラーメッセージからサジェストを収集し続けることで、イントロスペクションなしにスキーマ全体を再構築するツールが `Clairvoyance` である。これは「エラーメッセージの過剰な親切さが情報漏洩になる」という典型例であり、SQLエラーメッセージの詳細出力が攻撃者に有利に働くのと同じ原理である。

> 出典: GraphQL API vulnerabilities — https://portswigger.net/web-security/graphql

#### エイリアスを利用したレートリミット回避

GraphQLには**エイリアス（alias）**という機能があり、同一フィールドを1回のHTTPリクエスト内で複数回、異なる引数で呼び出せる。

```graphql
query isValidDiscount($code: Int) { 
  isValidDiscount(code:$code){ valid } 
  isValidDiscount2:isValidDiscount(code:$code){ valid } 
  isValidDiscount3:isValidDiscount(code:$code){ valid } 
}
```

上記は同じ `isValidDiscount` フィールドを3つの異なるエイリアス（無印、`isValidDiscount2`、`isValidDiscount3`）で呼び分けている。多くのレートリミッターは「HTTPリクエスト数」を数えるが、GraphQLでは1つのHTTPリクエストの中に何百・何千もの論理的な操作（operation）を詰め込めるため、リクエスト数ベースのレート制限は実質的に無力化される。これを使えば、割引コードやワンタイムパスワードのようなブルートフォース可能な値を、1回のHTTPリクエストで数千パターン検証できてしまう。

この攻撃はアクセス制御そのものを破るIDORではないが、「レート制限による総当たり対策」という防御層を丸ごと迂回するため、結果的に他の脆弱性(たとえばBOLAで発見した推測可能なIDの総当たり)を大規模に自動化する足がかりになる。

> 出典: GraphQL API vulnerabilities — https://portswigger.net/web-security/graphql

#### GraphQLにおけるCSRF

GraphQLエンドポイントは本来JSONボディでのPOSTのみを想定して設計されるべきだが、実装によっては以下の受理範囲の緩さがCSRF（Cross-Site Request Forgery、クロスサイトリクエストフォージェリ）を成立させてしまう。

- GETリクエストを受理する
- `x-www-form-urlencoded` のContent-TypeでのPOSTを受理する
- CSRFトークンによる検証が実装されていない
- Content-Typeの検証自体が行われていない

`application/json` のみを受理するエンドポイントであれば、通常のHTMLフォームやシンプルなクロスオリジンリクエストではJSONボディを組み立てて送信できない（ブラウザの単純フォーム送信は `application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain` しか生成できない、いわゆる「シンプルリクエスト」の制約がある）ため、これは実質的なCSRF対策として機能する。しかし、GETやform-urlencodedを許容している場合、悪意あるサイトが被害者のブラウザを介して認証済みセッションのままGraphQLミューテーション（データの変更を伴う操作）を発行させることができる。これはミューテーションが実質的に「状態を変更するAPI呼び出し」であるにもかかわらず、GET経由での副作用のあるリクエストを許してしまう、いわゆる冪等性違反とも関連する設計ミスである。

> 出典: GraphQL API vulnerabilities — https://portswigger.net/web-security/graphql

#### 防御策のまとめ

PortSwiggerが挙げる本番環境向けの対策は以下の通りである。

- **イントロスペクションの無効化**(公開APIでない場合): スキーマ偵察そのものを封じる。
- **公開スキーマのレビュー**(公開APIの場合): 未認証ユーザーが到達できるフィールドを棚卸しする。
- **サジェスト機能の無効化**: Apollo Server v4以降では `hideSchemaDetailsFromClientErrors` オプションでエラーメッセージからのスキーマ推測材料の漏洩を防げる。
- **機密フィールドの非公開化**: メールアドレスやユーザーIDなど、スキーマ上で直接返す必要のない機密フィールドを除去する。
- **ブルートフォース対策**: クエリの深さ(ネストの階層数)制限、ユニークフィールド数・エイリアス数・ルートフィールド数の上限設定、クエリの最大バイトサイズ制限、そしてクエリごとの計算コストを見積もる「コスト分析」の導入。
- **CSRF対策**: JSONエンコードされたPOSTのみを受理し、Content-Typeを厳密に検証し、確実なCSRFトークン機構を実装する。

これらの対策のいずれも「クライアントが送る側」ではなく「サーバーが検証する側」の責務であり、IDOR/BOLA対策の一般原則——「アクセス制御はサーバー側で、オブジェクト単位・操作単位で必ず行う」——をGraphQLという通信方式に合わせて具体化したものと理解できる。

> 出典: GraphQL API vulnerabilities — https://portswigger.net/web-security/graphql

### Mass Assignment(マスアサインメント)とBOLA: 「隠しフィールド」が武器になる仕組み

Mass Assignment(大量代入、オートバインディングとも呼ばれる)は、多くのWebフレームワークが提供する便利機能——リクエストボディのJSONやフォームデータを、コードを書かずに自動的にサーバー側オブジェクトのプロパティへマッピングする機能——が生む脆弱性である。開発者が「このフィールドは外部から変更されてはいけない」と意識してホワイトリスト化していない限り、リクエストボディに含めたキーはそのままオブジェクトの属性として上書きされてしまう。

これがIDOR/BOLAと関係が深いのは、Mass Assignmentが結果として「本来はサーバー側だけが決定すべき属性(価格、割引率、ロール、所有者ID等)を、クライアントが直接指定できてしまう」状態を作り出すためである。BOLAが「他人のオブジェクトIDを指定してアクセスする」ことで認可を破るのに対し、Mass Assignmentは「自分の(あるいは操作対象の)オブジェクトに対して、UIが想定していない属性を注入する」ことで認可・ビジネスロジックを破る。両者は「サーバーが本来チェックすべき境界をクライアント入力に委ねてしまっている」という同根の欠陥である。

#### PortSwiggerのラボ「Exploiting a mass assignment vulnerability」の構造

このラボは、資金が不足しているにもかかわらず「Lightweight l33t Leather Jacket」という商品を購入することがゴールである。攻撃の流れは以下の通りである。

1. `wiener:peter` の認証情報でログインする。
2. 対象のジャケットをバスケットに追加する。
3. 購入を試みると、残高不足でエラーになる(これが正規のビジネスロジックによる制御)。
4. `/api/checkout` へのリクエストをHTTP履歴(Burp Suiteのproxy historyなど)で確認する。
5. **GETレスポンスとPOSTリクエストを比較する**というのが本ラボの核心のテクニックである。GETで返ってくるオブジェクトの中に、POSTのリクエストボディには含まれていない隠しフィールドが存在することに気づく。
6. その隠しフィールドをPOSTリクエストボディに追加して送信する。

**なぜGETレスポンスとPOSTリクエストを比較するのか**——これは、多くのMass Assignment脆弱性を発見する際の定石的な手法である。多くのAPIは、同一のオブジェクト(この場合はチェックアウト情報)をシリアライズ(直列化、オブジェクトをJSON等のテキスト形式に変換すること)する際、GETで「読み取り用に返す」フィールドの集合と、POSTで「書き込み用に受理する想定の」フィールドの集合を、バックエンドでは同じクラス/構造体を使い回していることが多い。フロントエンドのUIはPOST時に一部のフィールドしか送らないよう作られているが、サーバー側のデシリアライズ(逆直列化)処理は、そのクラスが持つ全プロパティを無条件にバインドしてしまう実装になっていると、GETで見えているが通常のUIフローでは送信されないフィールドを、攻撃者が任意にPOSTへ追加注入できてしまう。

**発見されたペイロード**は `chosen_discount` というパラメータである。初期状態(割引なし)は以下のような構造でリクエストに現れる。

```json
{
  "chosen_discount": {
    "percentage": 0
  },
  "chosen_products": [
    {
      "product_id": "1",
      "quantity": 1
    }
  ]
}
```

ここで `percentage` の値をクライアント側で `100` に書き換えて送信すると、サーバーは100%割引が適用された注文として処理してしまう。

```json
{
  "chosen_discount": {
    "percentage": 100
  },
  "chosen_products": [
    {
      "product_id": "1",
      "quantity": 1
    }
  ]
}
```

この結果、商品は実質無料で購入可能になり、残高不足のチェックを完全に迂回する。

> 出典: Lab: Exploiting a mass assignment vulnerability — https://portswigger.net/web-security/api-testing/lab-exploiting-mass-assignment-vulnerability

#### メカニズムの仕組みレベルでの理解

このラボが示す構造を一般化すると、次のようになる。

1. サーバー側では「注文(Order)」というドメインオブジェクトが存在し、その中に `chosen_discount.percentage` というフィールドが定義されている。これは本来、クーポンコードの検証など、サーバー側の別のロジックが正当性を確認した上でセットされるべき値である。
2. `/api/checkout` のリクエストハンドラは、受け取ったJSONボディを、多くのフレームワークで一般的な「リクエストDTO(Data Transfer Object)を直接ドメインオブジェクトにマッピングする」実装、あるいは「JSONを直接ドメインオブジェクトへデシリアライズする」実装になっている。このとき、フレームワークの自動バインディング(たとえばJacksonやSystem.Text.Json、あるいは動的言語でのハッシュ→オブジェクトの単純代入)が、リクエストボディに存在するキーをオブジェクトの対応プロパティへ**無条件に**書き込む。
3. 正規のUIフローで生成されるリクエストは `chosen_discount.percentage` を含めない(常に0扱い、あるいは別のクーポン適用ロジックを経由する)ため、開発者は「このフィールドが外部入力として悪用される」ことを想定していなかった可能性が高い。
4. しかし、GETレスポンス(チェックアウト画面の初期状態を返すAPI)では、同じOrderオブジェクトをシリアライズして返すため、`chosen_discount` フィールドがクライアントに「見えて」しまっている。攻撃者はこの構造的な非対称性——「読み取り時に見える内部フィールド」と「書き込み時に意図されているフィールド」のズレ——を突いて、本来サーバーだけが決定すべき値を注入する。

このように、Mass Assignmentの根本原因は「入力側のホワイトリスト化(許可されたフィールドだけを明示的に取り込む)を行わず、オブジェクトの全プロパティを暗黙的に信頼してバインドしてしまう」実装パターンにある。これはSQLインジェクションにおける「クエリ文字列の組み立てにユーザー入力をそのまま混ぜる」ことや、XXEにおける「XMLパーサの外部エンティティ解決をデフォルトで許可したままにする」こととも共通する、「安全側のデフォルトを取らない実装」の一種である。

#### 防御策

- **明示的なホワイトリスト化(許可リスト方式)**: DTOやフォームオブジェクトを、実際にクライアントから受理すべきフィールドだけに限定して定義し、それ以外のフィールドが存在してもドメインオブジェクトへ反映されないようにする。多くのフレームワークは `@JsonIgnore`、`omitempty` 相当の除外指定、または専用のバインディング設定用クラスを提供している。
- **読み取り用モデルと書き込み用モデルの分離**: GETで返すレスポンス用のオブジェクト(View Model)と、POST/PUTで受理する入力用のオブジェクト(Input Model)を明確に別のクラスとして定義し、同一オブジェクトを両方向に使い回さない。これにより「GETで見えるがPOSTでは書き込めるべきでないフィールド」という非対称性の露呈自体を防げる。
- **サーバー側での再検証**: 割引率・価格・権限のような機密性の高い値は、クライアントから送られてきた値をそのまま信用するのではなく、サーバー側で独立に計算・検証してから確定する(たとえばクーポンコードが実在し有効であることをサーバー側のDBルックアップで確認してから割引率を決定する、など)。
- **オブジェクトレベルのアクセス制御の一環として扱う**: Mass Assignmentは最終的に「本来変更できないはずの属性が変更される」という結果をもたらすため、OWASP API Security Top 10における「Broken Object Property Level Authorization(BOPLA、オブジェクトのプロパティ単位でのアクセス制御欠如)」として、BOLAと並ぶAPI特有のアクセス制御崩壊のカテゴリに位置づけて対策を検討するべきである。

> 出典: Lab: Exploiting a mass assignment vulnerability — https://portswigger.net/web-security/api-testing/lab-exploiting-mass-assignment-vulnerability

### 本節のまとめ

GraphQLとMass Assignmentは、一見すると別々の技術トピックに見えるが、どちらも「APIがクライアント入力の形状や内容をどこまで信頼するか」という一点に帰着する。GraphQLでは、単一エンドポイントであるがゆえにスキーマ(=攻撃対象の全体像)そのものがイントロスペクションという形で漏洩しやすく、さらにresolverレベルでの引数検証やアクセス制御の実装漏れがそのままBOLAに直結する。Mass Assignmentでは、フレームワークの自動バインディング機能が「クライアントが送ってよいフィールド」と「サーバーだけが決定すべきフィールド」の境界を曖昧にし、GETとPOSTのオブジェクト構造の非対称性を突かれることで、価格や権限といったビジネスクリティカルな属性が書き換えられてしまう。いずれも、対策の核心は「サーバー側で、リクエストされた操作とオブジェクトの単位ごとに、明示的かつホワイトリスト方式でアクセス・変更可能な範囲を検証する」という、IDOR/BOLA対策全般に通底する原則に行き着く。

## GraphQL攻撃面とCVE集

REST APIでは「1つのURL = 1つのリソース」という素朴な対応関係があるため、アクセス制御の検査ポイントも比較的わかりやすい。ところがGraphQLは「1つのエンドポイント（多くは`/graphql`）に対して、クライアントがクエリ言語で必要なフィールドを自由に組み立てて要求する」というモデルを採る。この柔軟さが、IDOR/BOLA（オブジェクト単位の認可欠落）やBFLA（機能単位の認可欠落）にとって独特の攻撃面を生む。本節では、GraphQL特有の攻撃面を仕組みレベルで整理し、実際に修正された3件のCVE/報奨金事例（Shopify IDOR、Hasura CVE-2022-46792、Directus CVE-2024-39895）を通じて、なぜ認可が壊れるのか・どう多層で守るのかを解説する。

> 本節は防御目的の解説である。実在サービスや本番環境への無許可検証、破壊的な操作は行わない。示すペイロードは、あなた自身が管理する検証環境や、意図的に脆弱に作られた学習用アプリでの理解のためのものである。

まず用語を確認する。**resolver（リゾルバ）** とは、GraphQLスキーマの各フィールドに紐づく「そのフィールドの値を実際に計算・取得する関数」である。たとえば`user(id: 2){ email }`というクエリなら、`user`フィールドのリゾルバがIDを受け取ってDBを引き、`email`フィールドのリゾルバがそのユーザオブジェクトからメールを返す。**認可（authorization）が正しく効くかどうかは、このリゾルバの中でチェックしているか否かにかかっている**。GraphQLフレームワークは「認証されているか（誰であるか）」は面倒を見てくれても、「このユーザがこのオブジェクトを見てよいか」までは自動では守ってくれない。ここがGraphQLにおけるIDOR/BOLAの根本原因である。

### GraphQLの攻撃面を体系的に理解する

#### エンドポイント列挙と発見（Discovery）

攻撃の起点は「そもそもGraphQLエンドポイントがどこにあるか」の特定である。GraphQLは規約上どのパスに置いてもよいため、防御側は「意図せず公開されている管理用・旧版エンドポイント」を把握しておく必要がある。よく試されるパスは次の通り。

```
/graphql, /api/graphql, /v1/graphql, /v2/graphql
/graphiql, /playground, /console, /explorer, /altair
/graphql.php, /query
```

SecListsの`Discovery/Web-Content/graphql.txt`や、Escape Technologiesの`graphql-wordlist`がワードリストとして知られる。防御の観点で重要なのは、**旧バージョンの`/v1/graphql`だけ認可が甘い、`/graphql/system`のような内部管理スキーマが外部から叩ける、といった「複数エンドポイントの認可レベル不揃い」を作らないこと**である（後述のDirectus CVEはまさに`/graphql`と`/graphql/system`の両方が対象だった）。

エンドポイントがGraphQLを処理しているかの「万能プローブ」は次の1行である。

```graphql
query { __typename }
```

`__typename`は任意の型に必ず存在するメタフィールドで、正常なGraphQLサーバなら`{"data":{"__typename":"Query"}}`のように応答する。これで「ここはGraphQLだ」と確定できる。

さらに、フィルタやWAFを回避する目的で、次のような**トランスポート（送信方法）のバリエーション**が試される。防御側はこれらすべての経路で同じ認可・入力検証が効くことを確認すべきである。

- `GET /graphql?query=...`（GETパラメータ経由。CSRF可能性やキャッシュ汚染の温床）
- `Content-Type: application/x-www-form-urlencoded`のPOSTボディ
- `Content-Type: application/graphql`（生のクエリ本文）
- WebSocket接続（サブプロトコル`graphql-ws`。Subscription用）

> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

#### イントロスペクションとスキーマ復元

**イントロスペクション（introspection）** は、GraphQL自身が持つ「スキーマ（どんなクエリ・ミューテーション・型・フィールドがあるか）を問い合わせる仕組み」である。開発には便利だが、有効なままだとAPIの全構造を攻撃者に開示してしまう。全スキーマ抽出クエリの例。

```graphql
{ __schema { types { name fields { name args { name type { name kind } } } } } }
```

問題は、イントロスペクションを「ブロックしたつもり」でも回避されうる点である。多くの実装は`__schema`という文字列をナイーブにフィルタしているだけなので、次のような回避が効く。

- 空白・改行の挿入: `__schema\n{...}`（トークナイズ後は同一だが、素朴な文字列マッチをすり抜ける）
- コメント挿入: `__schema #comment\n{...}`
- POSTを禁じられていてもGETで送る、あるいはWebSocketで送る
- バッチ配列でラップする

イントロスペクションを完全に無効化しても、スキーマは**間接的に**漏れる。ここが重要な原理である。

- **フィールドサジェスト（Did you mean）**: 綴りを間違えると「Did you mean 'email'?」のようなエラーが返り、正しいフィールド名・型名が漏れる。
- **エラーオラクル**: 型不一致エラーが引数のシグネチャを露出する。
- **Clairvoyance**: サジェスト機能をワードリストで総当たりし、スキーマを再構成する手法。
- **パッシブ観測**: GraphQuailのような拡張が、正規クライアントの通信からスキーマを学習する。

したがって防御は「イントロスペクション無効化」だけでは不十分で、**本番ではフィールドサジェストとエラー詳細（error masking）も抑制する**必要がある。エンジンの指紋採取には`graphw00f`やInQL v6.1+が使われ、エラー署名や不正クエリへの応答からバックエンド実装を推定する。

> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

#### 影響の連続スペクトラム（Impact Spectrum）

chs.usのガイドは、GraphQLの被害が単独ではなく連鎖的に深刻化する「スペクトラム」として整理している。本節のテーマであるアクセス制御欠落は、この連鎖の入口に位置する。

> 情報漏洩（スキーマ・PII）→ 認可バイパス（IDOR/BOLA/BFLA）→ 認証回避 → インジェクション（SQL/NoSQL/OS）→ SSRF → サービス妨害（DoS）→ RCE

つまり、まずイントロスペクション等で構造を知り、次に認可欠落で他人のデータへ横移動し、さらにインジェクションやSSRFで深部へ進む、という段階的な悪化が典型である。

> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

### GraphQL特有の認可欠落: BOLA と BFLA

Impervaの解説は、GraphQLの壊れた認可を2種類に分けている。この区別はOWASP API Security Top 10に対応しており、IDOR/BOLAの本質を捉えるうえで重要である。

**BOLA（Broken Object Level Authorization、オブジェクト単位の認可欠落）** は、リソース（オブジェクト）単位の認可検証が欠けている状態。IDを差し替えるだけで他人のオブジェクトが読める、いわゆるIDORそのものである。

```graphql
{
  user(id: "2") {
    name
    email
    ssn
  }
}
```

このクエリで、ログイン中のユーザが自分（例: id=1）以外の`id: "2"`を指定しても機微情報（SSN）が返るなら、`user`リゾルバが「呼び出し元がこのオブジェクトの所有者か」を検証していない。原理としては、リゾルバがIDを受け取ってそのままDBの主キー検索に渡し、**行の所有者チェックを挟んでいない**ことが原因である。

**BFLA（Broken Function Level Authorization、機能単位の認可欠落）** は、操作（クエリ/ミューテーション）そのものを実行してよい権限があるかの検証が欠けている状態。特定のロールしか使えないはずの操作を、非特権ユーザが呼べてしまう。

```graphql
{
  allUsers {
    id
    name
    salary
  }
}
```

`allUsers`のような「管理者向けの全件取得」を一般ユーザが実行できてしまえばBFLAである。GraphQLでは1つのエンドポイントに管理用フィールドと一般用フィールドが同居しがちで、「フィールド単位で誰が呼べるか」を宣言的に管理しないと、権限の穴が生まれやすい。

Impervaが挙げる防御は次の通り。BOLAには「業務ロジック内で適切な認可チェックを行い、リソースアクセス前に権限を検証する」。BFLAには「フィールド単位のきめ細かなアクセス制御」「最小権限の原則」「認可検証のためのスキーマディレクティブ利用」。

> 出典: Imperva — GraphQL Vulnerabilities and Common Attacks — https://www.imperva.com/blog/graphql-vulnerabilities-common-attacks/

#### マスアサインメント（Mass Assignment）による権限昇格

認可欠落と隣接する重要な問題がマスアサインメントである。ミューテーションが、クライアントが指定すべきでない特権フィールド（`role`など）を無検証で受け入れると、自己昇格が起きる。

```graphql
mutation {
  registerAccount(role:"ADMIN", email:"x@x", password:"x") {
    token { accessToken }
  }
}
```

`role`はサーバ側で固定すべきなのに入力として受理されるため、一般登録フローで管理者アカウントが作れてしまう。防御は「入力型を明示的に定義し、権限に関わるフィールドをクライアント入力から排除する（サーバ側で強制設定する）」ことである。

> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

### エイリアスとバッチングによる増幅攻撃

GraphQL特有で、かつIDOR/認証攻撃を実務レベルで危険にするのが**エイリアス濫用**と**バッチング**である。両者は「1回のHTTPリクエストで多数の操作を実行させる」ことでレート制限を回避する。

#### エイリアス濫用（Alias Overloading / Amplification）

**エイリアス（alias）** は、同じフィールドを異なる名前・異なる引数で1クエリ内に複数書ける機能である。本来は「同じ`user`を複数ID分まとめて取る」ような正当用途だが、認証ブルートフォースに悪用できる。

```graphql
mutation {
  a1:login(u:"bob",p:"0000"){token}
  a2:login(u:"bob",p:"0001"){token}
  a3:login(u:"bob",p:"0002"){token}
  # ... N件
}
```

なぜ危険か。多くのレート制限は「HTTPリクエスト数」で数える。ところがこの1リクエストの中に何千ものログイン試行を詰め込めるため、**HTTP単位のレート制限を丸ごと回避してパスワード総当たりができる**。同様に、`getUser(id:"1")`を数千個のエイリアスで並べればDoSにもなる。

```graphql
{
  alias1: getUser(id: "1") { name }
  alias2: getUser(id: "1") { name }
  alias3: getUser(id: "1") { name }
}
```

防御は「エイリアス数の上限（例: 1クエリあたり5〜10）」「リクエストボディ長の制限」「操作名＋トークン単位のレート制限（HTTP単位ではなく）」。

#### JSON配列バッチング

もう一つの増幅がバッチングである。多くのGraphQLサーバは**JSON配列で複数クエリを1リクエストにまとめる**ことを許す。バックエンドはそれらを順次（あるいは並行して）処理する。

```json
[
  {"query":"mutation{login(u:\"bob\",p:\"0000\"){token}}"},
  {"query":"mutation{login(u:\"bob\",p:\"0001\"){token}}"}
]
```

エイリアスと同様、1つのネットワーク呼び出しが大量のクエリ実行に化けるため、CPU/メモリを枯渇させ、レート制限を回避し、認証ブルートフォースを可能にする。防御は「バッチングを無効化するか、リクエストあたりのクエリ数に妥当な上限を設ける」。

> 出典: Imperva — GraphQL Vulnerabilities and Common Attacks — https://www.imperva.com/blog/graphql-vulnerabilities-common-attacks/ ／ 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

#### その他のDoSベクタ（原理を押さえる）

- **フィールド重複**: `{ user(id:"1"){ name name email email } }`。レスポンスでは重複排除されても、サーバ側で再計算が走る実装がある。
- **ディレクティブ濫用**: `{ email @foo @bar @baz @custom1 @custom2 }`。存在しないディレクティブでもパース・処理コストがかかる（後述CVE-2024-47614の類型）。
- **循環クエリ**: `user → friends → friends → ...`と相互参照する型を深くたどると、計算量が指数的に増える。GraphQL Voyagerでスキーマの相互参照を可視化し、**深さ制限（depth limiting、目安で最大10程度）** を入れるのが定石。
- **循環フラグメント**: `fragment X{...Y} fragment Y{...X}`のように互いを参照させると無限ループになりうる。健全な実装は再帰フラグメントを拒否する。
- **ページネーション濫用**: `friends(first: 10000)`のように上限を無視した大量取得。`first/last/before/after`を検証し厳格な上限を課す。

### CSRFとWebSocketのリスク

GraphQLが`application/x-www-form-urlencoded`やGETパラメータを受理する構成だと、**カスタムヘッダを必須としていない限り、クロスサイトからミューテーションを実行するCSRFが成立**する。REST同様、GraphQLでもCookieセッションに依存し、かつCSRF対策ヘッダや`SameSite`が無いと、他サイトから状態変更操作を誘発できる。

Subscription（WebSocket）には**CSWSH（Cross-Site WebSocket Hijacking）** がある。WebSocketハンドシェイクはCookieを自動送信するが、Originの検証を怠ると、攻撃者ページが被害者のSubscriptionストリーム（リアルタイムに流れる機微データ）を受信できてしまう。防御は「WebSocketのOrigin検証」「CSRF対策ヘッダの必須化」。

> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

### 実例CVE/報奨金: 3つの柱

以下の3件は、GraphQL攻撃の3本柱――**認可の穴（Shopify）／権限の不整合（Hasura）／リソース枯渇のレート制限回避（Directus）** ――をそれぞれ体現する。いずれも共通する重要な教訓があり、**3件ともイントロスペクション不要で、いずれも「既定で有効」または「正規クライアントが依存する」機能を悪用した**。つまり、機能を無効化するのではなく、多層で制御を重ねることが解決策である。

#### Shopify — HackerOne #2207248（BOLA/IDOR、報奨金 $5,000、2024年5月）

- **脆弱性クラス**: Broken Object-Level Authorization（OWASP API1:2023、いわゆるIDOR）
- **内容**: あるShopifyショップで限定的な権限しか持たないスタッフが、`BillingInvoice`のIDパラメータを差し替えることで、**別のショップの請求書（billing document）** を取得できた。
- **対象クエリ**: `BillingDocumentDownload`、`BillDetails`
- **仕組み**: GraphQLリゾルバは`id`引数を受け取るが、**機微な請求データを返す前に「所有権（ownership）」を検証していなかった**。権限を絞られたスタッフトークンでも、ID値を列挙すれば認可されていない財務記録にアクセスできた。
- **影響**: 「あるショップの限定権限スタッフが、IDパラメータを変えるだけで他ショップの請求書をクエリできた」。テナント（店舗）境界を越えた機微データ漏洩。
- **防御**: リゾルバ内でフィールド単位の認可チェックを行い、**データを返す前に「クエリしたオブジェクトを本当にそのユーザが所有・アクセス可能か」を検証する**。

この事例の教訓は明快で、GraphQLだからといって特別なことは要らない一方、「エンドポイントが1つ・フィールドが多数」ゆえに**各リゾルバで所有権チェックを漏らさない規律**が決定的だ、という点である。

> 出典: GraphQL API Vulnerabilities and Common Attacks（stingrai.io） — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

#### Hasura — CVE-2022-46792（BFLA / 行レベル認可バイパス）

- **識別子**: CVE-2022-46792 ／ GHSA-g7mj-g7f4-hgrg
- **脆弱性クラス**: Broken Function-Level Authorization（OWASP API5:2023）
- **対象コンポーネント**: Hasura GraphQL Engine の **Update Many API**（複数行一括更新、Postgresバックエンド）
- **影響バージョン**: v2.10.0 〜 v2.15.1
- **修正バージョン**: v2.15.2（およびv2.10〜v2.14系へのバックポート）
- **仕組み**: Update Many APIが**行レベル認可（row-level authorization）のチェックを取り違えていた**。原典の記述によれば「ユーザは、対象テーブル内の任意の行に対し、自分が更新権限を持つ任意のカラムを更新でき、その結果、影響を受けた行から自分がselect権限を持つ任意のカラムを取得できた」。
- **原理**: 一括更新の際に、update権限とselect権限の**認可境界（authorization boundary）が破綻**した。本来は「更新してよい行の範囲」と「読んでよい行の範囲」を各行で一貫して評価すべきところ、bulk update中にこの一貫性が崩れ、更新をトリガーにして本来読めない行の値まで返してしまった。
- **影響**: マルチテナントでのテナント越えデータ露出、カラム改変による権限昇格。PostgresバックエンドのSaaS運用でクリティカル。
- **防御**: 直ちにパッチ適用。Hasura設定の行レベルセキュリティ（RLS）ポリシー監査。**updateとselectの認可境界を別々にテストする**。ミューテーションと行の両レベルで認可を重ねる。

この事例は、「認証はしている・権限テーブルもある」のに、**複合操作（更新→取得）で権限評価が食い違うと認可が崩れる**というBFLAの厄介さを示す。単純なIDORより検出が難しく、権限の交差（update×select）をテストで潰す必要がある。

> 出典: GraphQL API Vulnerabilities and Common Attacks（stingrai.io） — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

#### Directus — CVE-2024-39895（エイリアス濫用によるバッチングDoS）

- **識別子**: CVE-2024-39895
- **脆弱性クラス**: クエリバッチングによるレート制限バイパス（OWASP API4:2023、Unrestricted Resource Consumption）
- **深刻度**: CVSS 6.5（Medium）
- **影響バージョン**: 10.12.0より前
- **対象エンドポイント**: `/graphql`、`/graphql/system`
- **内容**: 「Directusのアリアス機能で、単一リクエスト内のリゾルバ呼び出しを重複排除しなかったため、認証済み攻撃者はエイリアスを通じて高コストのリレーショナルクエリを1リクエスト内で何度も繰り返せた」。
- **攻撃ペイロード例**:

```graphql
query BatchRead {
  alias1: users(id: "1") { posts { author { name } } }
  alias2: users(id: "1") { posts { author { name } } }
  alias3: users(id: "1") { posts { author { name } } }
  # ... N件繰り返し
}
```

- **仕組み**: エイリアスで書いた各フィールドが、**バッチングや重複排除なしに独立したDBクエリを発火**した。1つのHTTPリクエストが数百の並行クエリを生む。
- **影響**: 「読み取り専用の最小権限しか持たない認証ユーザでも本条件を引き起こせた。サーバは多数の独立した複雑DBクエリを並行実行させられ、エイリアス数に**線形**にDB負荷が増大した」。
- **防御**: 10.12.0以降へ更新。サーバ側でエイリアス数上限（1クエリあたり5〜10）。**DataLoader**を導入して繰り返しフィールド解決を1回のDB呼び出しにまとめる。HTTP単位ではなく「操作名＋トークン」でレート制限。エイリアス数とDBコネクションプールの異常監視。

ここで登場する**DataLoader（データローダ）** とは、同一リクエスト内で発生する重複・類似のDB取得をまとめて（バッチして）1回のクエリにし、結果をキャッシュする仕組みである。N+1問題の緩和策として知られるが、本CVEのようなエイリアス増幅の緩和にも効く。ただしDataLoaderは「重複排除」の性質上、認可チェックを飛ばす実装にならないよう注意が必要である（キャッシュヒットでも所有権チェックは各呼び出しで効かせる）。

> 出典: GraphQL API Vulnerabilities and Common Attacks（stingrai.io） — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks

> なお、ディレクティブ濫用系のDoSとして **CVE-2024-47614**（ディレクティブの繰り返しによる資源枯渇）も同時期に知られる。エイリアス／バッチング／ディレクティブは「1リクエストで処理量を増幅する」同系統の攻撃面である。
>
> 出典: 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

### 多層防御（Layered Defense）: どこで何を止めるか

3件のCVEが示す通り、GraphQLの防御は単一の対策では足りず、**パーサ → バリデータ → リゾルバ → データストア → 監視**の各層に制御を重ねるのが要諦である。stingrai.ioの整理を軸にまとめる。

| 層 | 制御 | 具体例 |
|---|---|---|
| **パーサ（Parser）** | エイリアス数上限・トークン数上限・再帰深さ | 実行前にエイリアスを5〜10に制限（Directus対策） |
| **バリデータ（Validator）** | クエリ複雑度分析・永続化クエリ許可リスト | コスト予算を超えるクエリを拒否 |
| **リゾルバ（Resolver）** | DataLoderバッチング・所有権チェック | 重複読取を集約しつつ、各呼び出しで所有権を検証（Shopify/Hasura対策） |
| **データストア（Datastore）** | 行レベルセキュリティ・クエリタイムアウト | テナント単位フィルタをDBで強制（Hasura対策） |
| **監視（Observability）** | エイリアス数メトリクス・スロークエリ警報 | エイリアス100超のリクエストを要調査としてフラグ |

設計時（design-time）の原則としては、**リゾルバ単位の認可チェックを無条件で入れる／自由形式JSONより型付きスカラ・enumを使う（マスアサインメント防止）／内部スキーマと外部スキーマを分離する**。運用時（runtime）は、**本番でイントロスペクションとフィールドサジェストを無効化／深さ・複雑度・リスト件数に上限／ユーザ単位のコスト予算／操作単位のレート制限／機微ミューテーションではバッチングとエイリアスを制限／CSRFヘッダ必須化とWebSocket Origin検証／エラーマスキング**。

検知シグナルとしては、「大きなリクエストボディ」「繰り返されるエラー」「`__schema`アクセス試行」「5個超のバッチ配列」「高いエイリアス数」「認可のないSubscription」が挙げられる。

> 出典: GraphQL API Vulnerabilities and Common Attacks（stingrai.io） — https://www.stingrai.io/blog/graphql-api-vulnerabilities-and-common-attacks ／ 包括GraphQLセキュリティガイド（chs.us） — https://chs.us/guides/graphql/

### まとめ

GraphQLにおけるIDOR/BOLA・BFLAの本質は、「単一エンドポイントに多数のフィールドが同居し、認可はフレームワーク任せにできず各リゾルバで明示的に守るしかない」という構造にある。Shopifyの事例は所有権チェックの欠落（BOLA/IDOR）、Hasura CVE-2022-46792はupdateとselectの認可境界の破綻（BFLA/行レベル）、Directus CVE-2024-39895はエイリアスによる処理増幅でレート制限を回避するリソース枯渇を、それぞれ具体的に示した。3件に共通するのは、いずれもイントロスペクション不要・既定機能の悪用という点であり、対策は機能の全面停止ではなく、パーサからデータストア・監視まで**多層で認可と資源消費を制御する**ことである。次章以降で扱う一般的なIDOR対策（所有権検証・不可推測な識別子・集中認可）は、GraphQLでも各リゾルバに落とし込む形でそのまま活きる。

## GraphQLペンテストと複数技法の統合

RESTでは「1エンドポイント＝1リソース」という素朴な対応関係があり、アクセス制御もエンドポイント単位で語りやすい。ところがGraphQLでは、クライアントが**1つのエンドポイント（通常 `/graphql`）に対して任意の形のクエリを送り、必要なフィールドだけを自由に取り出す**。この「クライアントがクエリの形を決める」という性質こそが、GraphQL特有のIDOR/BOLA（後述）やDoS（サービス妨害）を生む温床になる。本節では、これまでの章で学んだアクセス制御の欠陥が、GraphQLという実行モデルの上でどう姿を変えるのか、そしてそれを防御目的でどう検証・修正するのかを、3つの一次資料を軸に仕組みレベルで解説する。

> 用語の確認：**IDOR**（Insecure Direct Object Reference＝直接オブジェクト参照の不備）と**BOLA**（Broken Object Level Authorization＝オブジェクトレベル認可の破れ）は、実質的に同じ欠陥を別の呼び名で指す。「リクエストで指定したID（オブジェクトの参照）に対して、そのユーザーがアクセスしてよいかを検査していない」欠陥である。GraphQLではこれが **resolver（リゾルバ）** の実装漏れとして現れる。

### GraphQLの実行モデルとresolverという「危険な急所」

まず前提となる仕組みを押さえる。GraphQLサーバは、受け取ったクエリを**フィールドごとに分解し、各フィールドに紐づく resolver（リゾルバ）関数を呼び出して値を埋めていく**。resolverとは「そのフィールドの値をどこから・どうやって取ってくるかを定義した関数」であり、多くの場合その中でデータベースへの問い合わせが走る。

```graphql
query {
  post(id: 1) {          # Query.post リゾルバが1件取得
    comments {           # Post.comments リゾルバが子を取得
      author {           # Comment.author リゾルバが更に子を取得
        email            # ここでも User.email リゾルバが走りうる
      }
    }
  }
}
```

重要なのは、**ネスト（入れ子）した各段でそれぞれ独立にresolverが呼ばれる**という点だ。上の例では `post` → `comments` → `author` → `email` と、階層を降りるたびに別のresolverが動く。認可（アクセス制御）の検査が「トップレベルの `post` を取る所」だけに書かれていて、`author` の解決時に「このユーザーはこの著者の情報を見てよいか」を検査していなければ、**ゲートウェイの入口検査をすり抜けて内側のオブジェクトへ横移動できてしまう**。これがGraphQLにおけるIDOR/BOLAの核心である。

### nested resolverのIDOR/BOLA — 「入口だけ守って中を守らない」欠陥

secra.esの記事は、この欠陥を「**最も頻度が高く、影響も最大のバグ**」と明言している。仕組みは次の通りだ。

> 認可がゲートウェイ（API入口）や認証ラッパーで検査されているのに、**ネストした型のresolverが、参照先オブジェクトへのアクセス権を検証していない**。`updateOrder(id: 12345)` のようなmutationが、resolverが入力フィールドを鵜呑みにするために任意のidを受け付けてしまう。
>
> 出典: GraphQL Pentesting: Vulnerabilities and Defense — https://secra.es/en/blog/graphql-pentesting-vulnerabilities-defense

なぜ「入口だけ」の検査が破れるのか。多くの実装では、認証ミドルウェア（JWT検証など）が「ログインしているか」だけを見て通し、実際の**オブジェクト単位の所有権チェック（この注文はこのユーザーのものか）を各resolverに委ねている**。ところが開発者は往々にして、目立つトップレベルのquery/mutationにだけ認可を書き、`Comment.author` のような「内側の」resolverでは検査を省く。結果として、直接 `user(id: 2)` を叩くと弾かれるのに、**別のオブジェクトを経由した間接パスからは同じデータに到達できる**という非対称が生まれる。payloadplaygroundはこの「間接パス」を端的に示している。

```graphql
# 直接アクセスはブロックされるのに、リレーション経由だと露出する例
{
  post(id: 1) {
    comments {
      author { email password }   # 投稿→コメント→著者、と辿ると認可漏れ
    }
  }
}
```

> 直接クエリはブロックされる一方、リレーションを通した間接パスが同じデータを露出させることがある。
>
> 出典: The Complete Guide to GraphQL Security — https://payloadplayground.com/blog/graphql-security-complete-guide

dark-moon.orgは、この検証を「防御目的でどう確実に確認するか」という観点から具体化している。ポイントは**証拠主義**だ。

```
# 検証リクエスト（防御的な確認。自分が管理するテスト環境・許可範囲でのみ実施）
POST /graphql
{"query":"query { user(id: \"1002\") { id email role apiKey } }"}

# 脆弱な応答
-> 200 OK
{"data":{"user":{"id":"1002","email":"<別ユーザー>",
  "role":"admin","apiKey":"<露出>"}}}
```

> 確認の基準：応答が **別のprincipal（主体＝別ユーザー）の非公開フィールド**を含んでいること。200ステータスやIDのエコー（送ったidが返ってきただけ）では確認にならない。
>
> 出典: GraphQL Penetration Testing: Beyond Introspection — https://dark-moon.org/blog/graphql-penetration-testing-beyond-introspection/

この「200が返っただけでは脆弱性と断定しない」という規律は重要だ。GraphQLは仕様上、部分的な失敗でもHTTP 200を返し、`errors` 配列にエラーを詰めることが多い。だから**ステータスコードは判定材料にならず、「他人の秘密フィールドが実際に取れたか」というデータの中身だけが証拠になる**。

#### 防御：resolverレベルでの認可

secra.esとdark-moon.orgの結論は一致している。

> **すべてのresolverの内側で認可を強制する**。トップレベルのフィールドだけでなく。各型のresolverが「認証された主体が、その特定のオブジェクトにアクセスできるか」を検証しなければならない。ゲートウェイの検査だけを信用してはならない。
>
> 出典: secra.es / dark-moon.org（前掲URL）

実装上のイメージ（TypeScript/Apollo系の擬似コード。原理を示すための概念例）：

```javascript
// 悪い例：入力のidを鵜呑みにして返す（BOLA）
const resolvers = {
  Query: {
    order: (_, { id }) => db.orders.findById(id),   // 所有者チェック無し
  },
};

// 良い例：認証済み主体(context.user)と対象オブジェクトの所有権を照合
const resolvers = {
  Query: {
    order: async (_, { id }, context) => {
      const order = await db.orders.findById(id);
      if (!order) return null;
      // ★オブジェクト単位の認可をresolver内で強制
      if (order.ownerId !== context.user.id && !context.user.isAdmin) {
        throw new ForbiddenError("not authorized");
      }
      return order;
    },
  },
  // ネストした型のresolverでも同様に検査する（ここを省くと間接パスで抜ける）
  Comment: {
    author: async (comment, _args, context) => {
      const author = await db.users.findById(comment.authorId);
      return context.canView(author) ? author : null;
    },
  },
};
```

なぜこうするのか。GraphQLの実行モデル上、**認可を「フィールド解決の実行点」に置かない限り、クエリの形（どのパスを辿るか）を攻撃者が自由に組み替えられる**以上、入口の一箇所では守りきれないからだ。防御は「クエリの形」ではなく「オブジェクトの解決」に紐づけるのが原則である。

### mass assignment（マスアサインメント）— mutationが受け取りすぎる欠陥

IDORが「読み取り」の横移動なら、mass assignmentは「書き込み」の権限昇格だ。dark-moon.orgはmutationの入力オブジェクトが、**クライアントが本来制御してはならないフィールドまで受け付けてしまう**欠陥を挙げる。

```
mutation {
  updateProfile(input: { displayName: "test", role: "admin" }) {
    user { id role }
  }
}

-> {"data":{"updateProfile":{"user":{"id":"1001","role":"admin"}}}}
```

> 確認の基準：返却オブジェクトが**昇格した権限を反映している**こと（`role: "admin"` が実際に効いている）。「フィールドが黙って無視された」だけでは脆弱性ではない。
>
> 出典: dark-moon.org（前掲URL）

なぜ起きるか。多くのフレームワークでは、入力型（`input`）のフィールドをそのままORMのモデル更新に流し込む（`Object.assign(user, input)` のような）実装が書かれがちだ。すると `role` や `isAdmin` のような**本来サーバ側でしか触ってはいけない属性**が、クライアントの入力で上書きされる。防御は「**未知の／許可されていないmutationフィールドを明示的に拒否する**」こと、すなわち更新可能フィールドの許可リスト（allowlist）を作り、それ以外は入力型に含めない・受け取らない設計にすることだ。

### depth（深さ）ベースのDoS — 相互参照が生む指数爆発

ここからはアクセス制御からDoSへ視点を移す。GraphQLのスキーマは型同士が相互に参照し合える。`User` が `posts` を持ち、`Post` が `author`（＝`User`）を持つ、という**循環（サイクル）**があると、クライアントはそれを何十段でも辿れる。

```graphql
query {
  user(id: "1") {
    posts { author {
      posts { author {
        posts { author { posts { author { id } } } }
      } }
    } }
  }
}
```

secra.esは仕組みをこう説明する。

> `User` と `Post` が相互参照するなら、**50段の深さにネストしたクエリは指数的なSQLクエリを誘発するか、プロセスメモリを枯渇させる**。`user { posts { author { posts { author { ... } } } } }` のように深さ50段を交互に要求できる。
>
> 出典: secra.es（前掲URL）

なぜ「指数的」になり得るのか。各段のresolverが子コレクションを取得し、その各要素についてさらに子resolverが走る、という**扇形の展開（fan-out）**が階層ごとに掛け算されるためだ。1ユーザーが10投稿を持ち、各投稿が10コメントを持ち…と展開すると、深さに対して取得件数が指数的に膨らむ。加えて、resolverごとに素朴なDB問い合わせが走る実装（いわゆるN+1問題）だと、SQLの発行回数そのものが爆発する。

#### 防御：depth limit（深さ制限）

> **クエリ深さ制限**を実装する。グラフに対して妥当な最大ネスト深さでキャップする（**典型的には5〜10段**）。
>
> 出典: secra.es（前掲URL）

`graphql-depth-limit` のようなバリデーションミドルウェアで、実行前にクエリのASTを走査し、閾値を超える深さを持つクエリを弾く。検証側（防御確認）のアプローチとして、dark-moon.orgは「**基準となる応答時間を測り、深さを段階的に増やして、応答時間が跳ね上がる地点を記録する**」という測定法を推奨している。どの深さで防御が働く／破れるかを数値で押さえる、という発想だ。

### alias（エイリアス）ベースのDoSとブルートフォース — 1リクエストの中の並列多重化

**alias（エイリアス）** とは、GraphQLで「同じフィールドを別名で複数回要求する」機能である。本来はUI都合で同じ型を別名で並べるための機能だが、攻撃的に使うと**1回のHTTPリクエストの中で同じ高コストresolverをN回呼ばせる**ことができる。

```graphql
{
  a: login(email: "test@example.com", password: "attempt1") { token }
  b: login(email: "test@example.com", password: "attempt2") { token }
  c: login(email: "test@example.com", password: "attempt3") { token }
}
```

secra.esは影響をこう述べる。

> エイリアスは同じフィールドを1オペレーション内でN回、別名で要求させる。**同一の高コストresolverを200個エイリアスしたオペレーションは、リクエスト単位のレート制限を発動させずにコストを200倍にする**。
>
> 出典: secra.es（前掲URL）

ここが「アクセス制御 × DoS」の統合ポイントだ。ログイン試行回数の制限は普通「HTTPリクエスト回数」で数える。ところがエイリアスを使うと**1リクエスト＝数百回の `login` 試行**になるため、レート制限が回数を数え損ねる。dark-moon.orgのクーポン総当たり例が、この「レート制限バイパスによるブルートフォース」を明快に示す。

```
POST /graphql
{"query":"query {
  a0: checkCoupon(code: \"AAAA\") { valid }
  a1: checkCoupon(code: \"AAAB\") { valid }
  ...
  a999: checkCoupon(code: \"ZZZZ\") { valid }
}"}
```

> 証拠の要件：**単一の応答の中に差分の結果があること**（多数の `false` の中に1つだけ `valid: true`、あるいは1つだけ成功トークン）。
>
> 出典: dark-moon.org（前掲URL）

「差分が1つの応答に同居する」という点が、この技法の効率の源泉であり、同時に検出の手掛かりでもある。

### batching（配列バッチング）— オペレーション単位の多重化

aliasが「1オペレーション内でフィールドを多重化」するのに対し、**batching（配列バッチング）** は「1つのHTTPリクエストで複数のオペレーションを配列として送る」機能だ。JSON配列でクエリ／mutationを並べる。

```graphql
[
  {"query": "mutation { login(email: \"user@test.com\", password: \"pass1\") { token } }"},
  {"query": "mutation { login(email: \"user@test.com\", password: \"pass2\") { token } }"}
]
```

secra.esは、この配列バッチングが「エイリアスと深さと組み合わさると、**1リクエストで負荷爆弾（load bomb）を組み立てられる**」と警告する。3つの多重化軸——深さ（縦）、エイリアス（横）、バッチング（オペレーション数）——を掛け合わせると、単一リクエストのコストが桁違いに膨らむ、という理解が要点だ。

> 配列バッチングをサポートする実装は、1つのHTTPリクエストで複数オペレーションを受け付ける。エイリアスや深さと組み合わせることで、1リクエストで負荷爆弾を組める。
>
> 出典: secra.es（前掲URL）

### 複数技法の統合防御 — 最小限のベースライン

secra.esは「公開GraphQL APIの**最低限のベースライン**」を4点セットとして明示する。

> **introspectionの無効化、クエリ複雑度リミッタ、persisted queries、resolver単位の認可**が、あらゆる公開GraphQL APIの最小ベースラインである。
>
> 出典: secra.es（前掲URL）

- **query complexity analysis（クエリ複雑度分析）**：各フィールドにコスト（重み）を割り当て、クエリ全体の合計コストが予算を超えたら実行前に拒否する。深さ制限が「縦」を、複雑度が「縦×横（件数）」を抑える。ライブラリ例は `graphql-query-complexity`。
- **persisted queries（永続化クエリ、APQ）**：クライアントから任意のクエリを受け付けず、**サーバ側でハッシュ登録済みのクエリだけを許可リスト化**し、クライアントはハッシュだけを送る。secra.esはこれを「**アドホックなエイリアス／深さ／バッチング濫用を完全にブロックする**」と評価する。原理は明快で、攻撃者が任意形状のクエリを組めない以上、上記のDoS技法はそもそも投入できない。
- **per-field / per-resolver rate limiting**：HTTPリクエスト単位ではなくフィールド単位でコストを数えることで、alias/batchによる回数の水増しを無効化する。

なぜ「4点セット」で語るのか。ここまで見た通り、GraphQLの欠陥は**単一の対策で塞げない**からだ。認可（BOLA対策）はresolverに、DoS対策は深さ／複雑度／永続化クエリに、情報漏えい対策はintrospection無効化に、それぞれ別レイヤで置く必要がある。1つ欠けると、そこが単一障害点になる。

### introspection無効化「後」に残る欠陥 — 過信への警告

**introspection（内省）** とは、`__schema` を問い合わせるとサーバがスキーマ全体（型・フィールド・引数・ディレクティブ）を返す機能で、開発には便利だが本番で有効なままだと「管理者向けフィールド、内部mutation、レガシー型」まで露出する。標準的な内省クエリは次の形だ。

```graphql
{
  __schema {
    queryType { name }
    mutationType { name }
    types {
      name
      kind
      fields {
        name
        type { name kind }
        args { name type { name kind } }
      }
    }
  }
}
```

ゆえに「本番ではintrospectionを無効化せよ」が定石だが、**dark-moon.orgの最重要メッセージは「無効化は最小限の防御にしかならない」**という点だ。

> introspectionの無効化が提供するセキュリティは最小限である。**クライアントのトラフィックがすでにフィールド名やスキーマ構造を露出している**。
>
> 出典: dark-moon.org（前掲URL）

理由は単純で、実際に動いているアプリのフロントエンドが送るクエリを観察すれば、フィールド名も型構造もかなりの部分が判明する。さらにGraphQLサーバの多くは**「もしかして」提案（field suggestion）**を返す。存在しないフィールド名を送ると、`Did you mean "email"?` のようにサーバがエラーメッセージで近い名前を教えてしまうのだ。これを機械的に悪用すれば、introspectionが無効でもスキーマを復元できる。だからdark-moon.orgとdark系一次資料は「introspectionの無効化に**加えて**、エラーのfield suggestionも無効化せよ」と説く。要するに**introspectionを切っただけで安心してはならず、認可・リソース制限・mutation検証は introspection の有無と独立に必要**だという結論である。

### 検証ツールと防御的テスト手順

payloadplaygroundは、防御確認（自組織のAPIに対する許可された検証）で使われる代表的ツールを整理している。いずれも「自分が管理する／明示的に許可された対象にのみ」用いるべきものだ。

- **InQL**：Burp Suite拡張。introspectionの取得とスキーマ解析を自動化する。
- **GraphQL Voyager**：スキーマを対話的に可視化し、型の相互参照（DoSの温床となるサイクル）を目で追える。
- **Clairvoyance**：**introspectionが無効化されていても**、前述のエラーのfield suggestionを手掛かりにスキーマを推定・列挙するツール。「無効化＝安全」ではないことを実証する道具でもある。
- **Altair GraphQL Client**：クエリ構築用のフル機能IDE。
- **BatchQL**：バッチング攻撃（前述のalias/配列バッチング）の可否とレート制限バイパスを自動確認する。

> 出典: The Complete Guide to GraphQL Security — https://payloadplayground.com/blog/graphql-security-complete-guide

payloadplaygroundが挙げるテスト観点（防御確認の網羅チェックリスト）は次の通り：introspectionの有効性確認、field suggestionによる列挙可否、バッチングサポートの確認、レート制限バイパスの試行、複数アカウント間でのIDOR確認、認可パスのマッピング（どのパスから何に到達できるか）、引数インジェクション、subscription（購読）のセキュリティ検証、そしてエラーメッセージ経由の保護フィールド名の発見。これらは本節でみた「resolver認可 × DoS × 情報露出」の三領域に対応しており、**GraphQLペンテストとは、この複数技法を統合的に組み合わせて一つのAPIの防御を多面的に確認する営み**だと言える。

### 本節のまとめ

- GraphQLのIDOR/BOLAは、**ネストしたresolverの認可漏れ**として現れる。入口（ゲートウェイ）だけでなく、**各resolverの内側でオブジェクト単位の認可を強制する**のが唯一の確実な防御。
- DoSは**深さ（縦）・エイリアス（横）・バッチング（オペレーション数）**の3軸で多重化される。防御は深さ制限（5〜10段）、複雑度予算、そして**persisted queries**（任意クエリを排し、これら濫用を根本から遮断）。
- alias/batchは**HTTPリクエスト回数ベースのレート制限を無効化**するため、認証・クーポン等のブルートフォースと直結する。フィールド単位のコスト計上が必要。
- mutationの**mass assignment**は許可リスト設計で、未知フィールドを明示的に拒否して防ぐ。
- **introspectionの無効化は最小限の防御**にすぎない。field suggestionの無効化を併用しつつ、認可・リソース制限・mutation検証を独立して備えること。
- 検証は**証拠主義**で。HTTP 200ではなく「他人の秘密フィールドが実際に取れたか／権限が実際に昇格したか」というデータの中身だけが確証になる。

> 本節の記述はすべて**防御目的**であり、検証は自組織が管理する環境または明示的に許可された範囲でのみ行うこと。実在サービスや本番環境への無許可の検証、破壊的な負荷試験は行ってはならない。

## API Hacking の書籍・コース

IDOR/BOLA を体系的に学ぶ上で、単発のブログ記事よりも「一冊の書籍」「一つの通しコース」で全体像を押さえておくことには大きな価値がある。個々のペイロードやツールの使い方は断片的な記事からも学べるが、**なぜその手順を踏むのか（方法論）**、**API特有の認可モデルがどう壊れるのか（原理）**は、体系だった教材でないと身につきにくい。本節では、IDOR/BOLA分野で最も参照される書籍とコース、およびその著者について解説する。

### Corey Ball『Hacking APIs: Breaking Web Application Programming Interfaces』（No Starch Press）

本書はAPIペネトレーションテストの実践書として広く読まれており、REST・SOAP・GraphQLといった主要なAPI形式への攻撃手法を、初学者でも実行可能な粒度まで落とし込んで解説している。著者のCorey Ballは監査法人（Big Four）出身のセキュリティコンサルタントで、OSCP・CISSP・CISMなどの資格を持ち、APIセキュリティの教育・コンサルティングを専門としている。

#### 全体構成

書籍は大きく3部構成になっており、「準備」→「攻撃手法」→「実践・キャリア」という段階を踏む。目次は次の通り（No Starch Pressおよび検索で確認できた版に基づく）。

```
第0章  Preparing for Your Security Tests（テスト準備・スコープ設定・法的留意点）
第1章  How Web Applications Work（Web動作の基礎）
第2章  The Anatomy of Web APIs（API解剖学：REST/SOAP/GraphQLの構造）
第3章  Common API Vulnerabilities（OWASP API Top 10 概観）
第4章  Your API Hacking System（Burp Suite等のツールチェーン構築）
第5章  Setting Up Vulnerable API Targets（crAPI等の脆弱API環境構築）
第6章  Discovery（エンドポイント列挙）
第7章  Endpoint Analysis（Postmanでの過剰データ公開検出）
第8章  Attacking Authentication（JWT攻撃など）
第9章  Fuzzing
第10章 Exploiting Authorization（BOLA/BFLAの実践的攻略）
第11章 Mass Assignment
第12章 Injection
第13章 Applying Evasive Techniques and Rate Limit Testing
第14章 Attacking GraphQL
第15章 Data Breaches and Bug Bounties
```

IDOR/BOLA読者が特に押さえるべきは第10章「Exploiting Authorization」、第11章「Mass Assignment」、第14章「Attacking GraphQL」の3つである。

#### 第10章: A-B テストと A-B-A テスト — BOLA判定の中核メソドロジー

第10章の核心は、BOLA/BFLAを**再現性のある手順**として体系化している点にある。著者は「多くのAPI提供者は認証（authentication：あなたが誰か）の実装には注意を払うが、認可（authorization：あなたが何にアクセスできるか）のチェックを見落としやすい」と指摘し、ユーザーAがユーザーBのリソースにアクセス・改変できてしまわないかを確認する具体的な手法として **A-B テスト** と **A-B-A テスト** を提示している。

**A-Bテストの手順:**

1. テスト用アカウントを最低2つ（User A、User B）用意する。
2. User Aでログインし、自分のリソース（例: 注文、プロフィール、請求書など）を作成・取得し、そのリソースID（`order_id=1001`など）とレスポンス内容、User Aの認証トークン（セッションCookieやBearerトークン）を記録する。
3. User Bでログインし、User BのトークンをHTTPリクエストの`Authorization`ヘッダーに使いながら、リクエストのパス/ボディ中のリソースIDだけを**User Aのもの**（`order_id=1001`）に書き換えて送信する。
4. レスポンスがUser Aのデータを返してしまえば、そのエンドポイントはオブジェクトレベルの認可（誰のリソースかのチェック）が欠落しており、**BOLA（Broken Object Level Authorization）**が成立する。

```http
# User Bのトークンで、User Aが所有するリソースIDを指定する
GET /api/v2/orders/1001 HTTP/1.1
Host: api.example.com
Authorization: Bearer <User_B_token>
```

このリクエストが200 OKでUser Aの注文情報を返せば脆弱、403/404であれば所有権チェックが機能していると判断できる。

**なぜこの手順が有効なのか（原理）**: APIサーバーの典型的な実装ミスは、「トークンが正当かどうか（認証）」だけを検証し、「トークンの持ち主が、リクエスト中で指定されたIDのオブジェクトを所有しているか（認可）」を検証しないことにある。多くのフレームワークはミドルウェアで認証を一括処理するため実装漏れが起きにくいが、認可はエンドポイントごとに個別のロジック（`if resource.owner_id == current_user.id`のような比較）を書く必要があり、これを書き忘れる、あるいはIDOR対策をリスト画面だけに入れて詳細取得APIに入れ忘れる、といったミスが非常に多い。A-Bテストはこの「実装され忘れた比較」を直接突く手法である。

**A-B-Aテストとは**: A-Bテストで単純GETが通っても、書き込み系（更新・削除）は別途チェックが入っている実装がある。そこでA-B-Aテストでは、User Bのトークンで**User Aのリソースを変更（PUT/PATCH/DELETE）した後**、再びUser Aでログインしてそのリソースを取得し、**実際に改変が反映されているか**を確認する。読み取り（GET）では403を返すのに書き込み（PUT）では通ってしまう、逆に単発リクエストのレスポンスコードだけでは検出できない「サイレントな書き込み成功」（レスポンスは200だが実際にはDBが更新されていない、あるいはその逆でレスポンスはエラーだが実は更新されてしまっている）を洗い出すために、最終状態をAアカウント側から検証するのがA-B-Aテストの狙いである。これはHTTPレスポンスコードだけを信頼した脆弱性判定が誤検知・見逃しを生みやすいことへの実務上の対処法であり、本書がBOLA検証を「レスポンスの見た目」ではなく「実際のデータ状態の変化」で判定する姿勢を貫いている点は、テスターが身につけるべき重要な習慣である。

#### 第11章: Mass Assignment

独立した章としてMass Assignment（一括代入脆弱性、リクエストボディ中の想定外フィールドがサーバー側のオブジェクトにそのまま代入されてしまう問題）を扱っている。例えばユーザー登録APIが`{"username":"...","password":"..."}`のみを想定していても、内部的にリクエストボディをオブジェクトへ丸ごとマッピングする実装（ORMのモデルへの直接バインドなど）であれば、攻撃者が`{"username":"...","password":"...","role":"admin"}`のように未公開フィールドを追加送信するだけで権限昇格できてしまう。これはBFLA（Broken Function Level Authorization）や垂直方向の権限昇格と密接に関連する脆弱性であり、IDOR/BOLAと合わせて理解しておくべきテーマである。

#### 第14章: Attacking GraphQL

GraphQLは単一エンドポイント（多くの場合`/graphql`）にクエリを投げる設計上、REST的なURLパスベースの認可チェックが機能しにくく、フィールド単位・リゾルバ単位で認可を実装し忘れるとBOLA/BFLAが発生しやすい。本書はイントロスペクションクエリによるスキーマ列挙、ネストしたクエリでの過剰データ取得、ミューテーションを通じた不正な更新など、GraphQL特有の攻撃面を扱っている。

> 出典: Hacking APIs — https://nostarch.com/hacking-apis

---

### InsiderPhD（Katie Paxton-Fear）『API Hacking』コース（justhacking.com）

Dr. Katie Paxton-Fear（オンラインハンドル名 InsiderPhD）が提供する動画コースで、**50本超・合計5時間以上の動画**にクイズと**クラウドホスト型の専用ラボ環境**が付属する、実践重視の教材である。価格は100ドル。前提知識について公式には「事前知識は不要だが、基本的なネットワーキング・Linux・VM操作の経験があると望ましい」とされている。

#### カリキュラムの特徴

コースはOWASP API Security Top 10全体をカバーする設計になっており、以下の内容を含む。

- **API基礎**: REST・GraphQL・gRPCといった主要プロトコルの違いと構造
- **専用ツールチェーン**: API特化のハッキングツール一式の使い方
- **API Discovery**: 隠れたエンドポイントを発見する手法
- **脆弱性分析**: APIに影響する主要な脆弱性クラス（BOLA・Mass Assignmentなど）
- **再現可能な方法論**: 場当たり的な手順ではなく、繰り返し使える体系立てたテスト手順
- **ハンズオン演習**: クラウドラボでの実践

Hacking APIs書籍が「書いて読んで手を動かす」教材であるのに対し、本コースは動画講義＋実ラボという形式で、視覚的・実践的に学びたい読者や、体系だった手順を反復練習したい読者に向いている。BOLA・Mass Assignmentを含むOWASP API Top 10全体を扱うため、IDOR/BOLAだけでなくAPIセキュリティ全般の理解を固めたい場合に適した教材である。

> 出典: API Hacking Course — https://www.justhacking.com/course/api-hacking/

---

### InsiderPhD 本人サイト（insiderphd.dev）

⚠️ **未取得の資料**: 「insiderphd.dev」は自動取得できませんでした（理由: SSL証明書エラー "certificate has expired"）。以下のURLからご自身で直接ご覧ください: https://insiderphd.dev/

（以下は未取得資料の補足として一般知識に基づく解説です。Web検索で確認できた公開情報に基づく）

Katie Paxton-Fearは、データサイエンティストからセキュリティ研究者・バグバウンティハンターへ転身した経歴を持つ。学術的にはNLP（自然言語処理）を用いたインサイダー脅威分析で博士号を取得しており、その後2019年頃からバグバウンティ・API脆弱性研究に軸足を移した。YouTubeチャンネル「InsiderPhD」は登録者7万人超（本稼働当時）を抱え、API脆弱性診断・バグバウンティ手法をわかりやすく解説する動画で知られる。Verizon Media（現Yahoo）や米国防総省（DoD）向けの脆弱性報告実績を持ち、現在はTraceable by Harness（旧Traceable AI、API/アプリケーションセキュリティ企業）でPrincipal Security Researcherを務めている（旧Bugcrowdのトリアージャー経験もある）。

InsiderPhDのYouTube動画・ブログは、IDOR/BOLAをはじめとするAPI脆弱性の「発見手順」を短い実演形式で示すことが多く、書籍・有料コースで学んだ方法論を無料コンテンツで反復・補強する目的で併用するのに適している。本人サイトはプロフィール・実績・リンク集（YouTube、Twitter/X、コース案内等）のハブとして機能しており、最新の登壇情報や公開資料へのリンクもここから辿れる。

> 出典: InsiderPhD 本人サイト（取得不可） — https://insiderphd.dev/ ／ 補足情報の出典: Infosec Institute Podcast（https://www.infosecinstitute.com/podcast/katie-paxton-fear/）、HackerOne Hacker Spotlight（https://www.hackerone.com/blog/hacker-spotlight-interview-insiderphd）、Cybersecurity Insiders（https://www.cybersecurity-insiders.com/from-accidental-hacker-to-cybersecurity-champion-the-story-of-dr-katie-paxton-fear-bug-bounty-hunter-with-hackerone/）

---

### まとめ: 3つの教材の使い分け

| 教材 | 形式 | 強み | 向いている読者 |
|---|---|---|---|
| Hacking APIs（書籍） | 読み物＋演習環境 | A-B/A-B-AテストなどBOLA判定の方法論を体系立てて明文化 | 手順を文章でじっくり理解したい人 |
| API Hacking（コース） | 動画＋クラウドラボ | OWASP API Top 10全体を反復演習で習得 | 手を動かしながら学びたい人 |
| InsiderPhD（YouTube/サイト） | 無料動画・記事 | 短時間で最新の実演を見られる | 補強・最新情報のキャッチアップ |

いずれも「防御側の視点」で読むと、A-Bテストの手順はそのまま**内部の脆弱性診断・自動テストのチェックリスト**として転用できる。認可チェックのユニットテストを書く際にも、「別ユーザーのトークンで自分のリソースIDを指定したときに拒否されるか」を機械的に検証するテストケースを用意することが、本節で紹介した方法論の最も直接的な防御応用である。

---

[← 第6章 マルチテナンシーと組織境界の脆弱性](06-multi-tenancy.md) ｜ [目次](index.md) ｜ [第8章 ツールと認可テストの半自動化 →](08-tooling-automation.md)
