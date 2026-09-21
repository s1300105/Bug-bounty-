## 大規模事例とMass Assignment実戦

本節では、IDOR/BOLA（Broken Object Level Authorization、オブジェクト単位の認可欠陥）と、その近縁である **Mass Assignment（マスアサインメント）** が現実の大規模システムでどのように悪用されたかを、3つの一次資料から読み解く。単なる「面白い事件紹介」ではなく、**なぜその脆弱性が成立したのか**を仕組みのレベルで理解し、自分の設計・防御に転用できることを目標とする。

最初に用語を1つだけ整理しておく。**Mass Assignment** とは、HTTPリクエストで送られてきたキー・値の組（`role=admin` など）を、フレームワークが**オブジェクトのプロパティやDBのカラムに一括で自動代入してしまう**挙動、およびそれを悪用してユーザーが本来触れないフィールド（権限・所属・残高など）を書き換える攻撃を指す。IDOR/BOLAが「**他人のオブジェクトを参照・操作できてしまう**（オブジェクトの取り違え）」欠陥であるのに対し、Mass Assignmentは「**自分のオブジェクトの、触ってはいけない属性を書き換えられてしまう**（属性レベルの認可欠陥）」欠陥である。OWASP API Security Top 10ではそれぞれ **API1:2023 BOLA** と **API3:2023 Broken Object Property Level Authorization（BOPLA）** に対応し、後者はMass Assignmentを包含する。両者は実戦ではしばしば連鎖する。

---

### 9c.1 Sam Curry「Web Hackers vs. The Auto Industry」— 16社・VIN経由の水平権限昇格

2023年1月3日に公開されたSam Curryらの調査は、自動車業界16社（およびテレマティクス基盤）のWeb/APIに対して行われ、**IDOR/BOLAと認証欠陥の見本市**とも言える内容だった。対象はBMW、Rolls Royce、Mercedes-Benz、Ferrari、Hyundai、Genesis、Honda、Nissan、Infiniti、Acura、Kia、Ford、Porsche、Toyota、Jaguar/Land Rover、SiriusXM、Spireon（OnStar/GoldStar/FleetLocate等）、Reviver（デジタルナンバープレート）に及ぶ。調査は2022年秋、公開は2023年1月で、多くは開示後短期間で修正された（Reviverは24時間以内）。

ここでは本教科書の主題（IDOR/BOLA・Mass Assignment）に直結する事例だけを、原理とともに抜き出す。

#### VINを識別子にした水平権限昇格（Kia/Honda/Infiniti/Nissan/Acura）

これらのブランドでは、**VIN（Vehicle Identification Number、車台番号）だけ**を使って、遠隔操作API（ロック/アンロック、エンジン始動・停止、位置特定、ヘッドライト点滅、クラクション）を呼び出せた。さらにVINから所有者のPII（氏名・電話・メール・住所）が引き出せ、遠隔管理から正規オーナーを締め出したり、所有権を移転したりできた。Kiaでは車両の360度カメラのライブ画像にまでアクセスできたと報告されている。

**なぜ成立するのか（仕組み）**：VINは「秘密」ではない。フロントガラスの下端から誰でも読め、駐車場・中古車サイト・写真からも入手できる、**推測可能で公開された識別子**である。にもかかわらずAPIサーバは「このリクエストを送っているユーザーが、そのVINの車の所有者か」という**オブジェクト単位の認可チェックを行わず**、VINが正しく形式的に存在すれば操作を受け付けた。これがまさにBOLA（水平権限昇格＝同じ権限レベルの他ユーザーのリソースへの横移動）の典型である。「認証（あなたは誰か）」は通っていても「認可（あなたはこの車を操作してよいか）」が抜けている、という構造上の欠陥だ。

```
# 概念図（実物のエンドポイントではなく原理を示す擬似リクエスト）
POST /telematics/v1/vehicles/{VIN}/remote/unlock
Authorization: Bearer <攻撃者自身の正規トークン>

{ "command": "unlock" }
```

トークンは攻撃者自身の正規のもので構わない。サーバが検証すべきは「トークンの所有者 ＝ このVINの車の所有者」という**紐付け**だが、それを検証しないため、任意のVINを差し替えるだけで他人の車を操作できる。Hyundai/Genesisでは識別子が**VINではなく被害者のメールアドレス**だった点だけが異なり、原理は同じ（公開・推測可能な識別子＋オブジェクト認可の欠如）。

**教訓**：識別子が「知られていること」を防御の前提にしてはならない（Security by Obscurityの否定）。認可は「識別子を知っているか」ではなく「そのオブジェクトの正当な所有者/権限者か」で判定する。連番IDでもUUIDでもVINでも、**サーバ側でリクエスト送信者とオブジェクトの所有関係を毎回照合する**のが唯一の正解である。

#### Ferrari — ハードコード資格情報＋ユーザー列挙＋ロール書き換え

Ferrariでは、圧縮（minify）されたフロントエンドJavaScript内に**ハードコードされたAPI資格情報**が残っており、そこからバックエンドAPIの構造が判明した。

- `/cms/dws/back-office/auth/bo-users` が全登録ユーザーを漏らし、かつ**管理者アカウントの追加**まで許した。
- 本番APIで、任意の被害者メールを与えるとフル顧客データが返った：

```
GET /core/api/v1/Users?email=ian@ian.sh HTTP/1.1
Host: fcd.services.ferrari.com

# レスポンス（氏名・生年月日・メール等が返る）
{ "guid":"[UUID]", "email":"ian@ian.sh",
  "firstName":"Ian", "lastName":"Carroll",
  "birthdate":"1963-12-11T00:00:00" }
```

- さらに `POST /core/api/v1/Users/:id/Roles` で**自分のロールを書き換え**、スーパーユーザー権限を付与できた。
- `rest-connectors` エンドポイントは認可ヘッダやAPIシークレットを平文で開示した。

**仕組み**：`?email=` を変えるだけで任意ユーザーのオブジェクトが取れるのはBOLA。`/Users/:id/Roles` へのPOSTで権限が上がるのは、**ロールという保護されるべき属性がユーザー操作で書き換え可能**という点でMass Assignment/BOPLAそのものである。IDOR（列挙・参照）とMass Assignment（属性昇格）が連鎖して完全な乗っ取りに至る典型例だ。

#### Toyota / Jaguar・Land Rover — 古典的IDORによるPII漏洩

- Toyota Financialでは、IDORにより顧客の氏名・電話・メール・ローン状況が漏洩。
- Jaguar/Land Roverでは、ユーザーアカウントのIDORからパスワードハッシュ・氏名・電話・住所・車両情報が漏洩。

いずれも「識別子を差し替えると他人のレコードが返る」という水平移動であり、9c.1冒頭の原理と同一。

#### Reviver（デジタルナンバープレート）— 純粋なMass Assignment

Reviverは、車のナンバープレートをデジタル表示・GPS追跡できる製品を提供していた。ここでの欠陥は本節の主題を最も鮮明に示す。

- ユーザー登録/更新のJSONにある **`type` パラメータ**（本来 `"CONSUMER"`）を書き換え可能だった。
- 研究者はグループの `type` を **`"0"`（Reviverの管理ロール）** に設定し、全顧客のGPS位置追跡、プレート表示の改ざん、フリート管理、ユーザー情報の削除まで行えた。

```json
// 概念図：本来ユーザーが送るべきでない type を混ぜ込む
{
  "email": "attacker@example.com",
  "type": "0"            // CONSUMER のはずが管理ロールに昇格
}
```

**仕組み**：サーバはリクエストJSONを受け取り、`type` を含む全フィールドをそのままユーザーオブジェクト（＝権限判定に使われるレコード）に代入した。`type` は**サーバが決めるべき属性**であり、ユーザー入力から来てはならない。許可フィールドのallowlist（後述）があれば `type` は無視され、この昇格は成立しなかった。

> 出典: Sam Curry — Web Hackers vs. The Auto Industry — https://samcurry.net/web-hackers-vs-the-auto-industry

##### 大規模事例からの横断的教訓

1. **識別子は認可の代わりにならない**：VIN・メール・連番ID・UUIDのいずれも「知っていること」＝「操作してよいこと」ではない。
2. **IDOR（参照）とMass Assignment（属性昇格）は連鎖する**：まず列挙・参照で足がかりを得て、次にロール等の属性を書き換えて権限を奪う、という二段構えが繰り返し現れた。
3. **クライアントに秘密を置かない**：minify済みJSでもハードコードされた資格情報・APIキーは容易に抽出される。難読化は防御ではない。
4. **属性レベルの認可を明示する**：`role`/`type`/`isAdmin` のようなフィールドは、リクエストボディに現れても**サーバが常に無視・上書き**する設計にする。

---

### 9c.2 Cobalt「Mass Assignment exploitation in the wild」— 定義・命名・実装原理

Cobaltの記事は、Mass Assignmentを**フレームワーク横断の一般問題**として整理している。核心の定義はこうだ：許可キーのwhitelist（許可リスト）を持たないMass Assignmentは、**攻撃者が任意の値でリソースを作成・更新できてしまう**。

#### フレームワークごとの「別名」

同じ危険挙動が、技術スタックによって違う名前で呼ばれている点が重要だ。名前が違うと「自分のフレームワークには関係ない」と誤解しがちだからである。

| 呼称 | 主な技術 |
|---|---|
| Mass Assignment | Ruby on Rails, Node.js |
| Autobinding（オートバインディング） | Spring MVC, ASP.NET MVC |
| Object Injection（オブジェクトインジェクション） | PHP |

**仕組み（なぜ便利さが罠になるか）**：これらのフレームワークは「リクエストの入力を、そのままモデル/オブジェクトに一括バインドする」機能を提供する。開発者は `User.new(params)` のように1行書くだけでフォーム項目をDBオブジェクトに写せる。この**開発効率のためのショートカット**が、入力をフィルタしない限りセキュリティホールになる。フレームワークは「どのフィールドが機密か」を知らないので、`isAdmin` だろうと `balance` だろうと来た通りに代入する。

#### 脆弱なコードと攻撃ペイロード

記事が示す最小例（Node.js）：

```javascript
// 脆弱：リクエストボディの isAdmin をそのまま採用してしまう
const newUser = {
  username: req.body.username,
  password: req.body.password,
  isAdmin: req.body.isAdmin   // ← ユーザーが true を送れば管理者になれる
};
```

```json
POST /users HTTP/1.1
{
  "username": "attacker",
  "password": "password",
  "isAdmin": true
}
```

このリクエストが通れば、登録と同時に管理者権限を得る。記事は「**権限昇格はMass Assignmentから生じる最も一般的な脆弱性**」と述べており、これは9c.1のFerrari/Reviverの観察とも一致する。

#### crAPIラボに見る「金銭被害」型

記事は教育用の脆弱アプリ **crAPI** の例も挙げる。ここでは注文（order）の `status` を、PUTリクエストで `"delivered"` から `"returned"` に書き換えることで、**自動返金**を発生させて不正なキャッシュバックを得られた。権限昇格だけでなく、**業務ロジック上の重要属性（注文状態・金額・在庫など）**もMass Assignmentの標的になることを示す。

> ⚠️ **未取得の資料**: crAPIラボの完全な手順・エンドポイント詳細は本記事本文の範囲外です。crAPIはOWASP/OpenAPIの教育用意図的脆弱アプリであり、**自分でホストしたラボ環境**でのみ検証してください（本教科書のスコープ：実在サービス・本番への無許可検証は行わない）。

#### 防御（Cobaltの整理）

1. **自動プロパティマッピングを無効化**し、フィールドを手動で1つずつ代入する。
2. **読み取り専用フィールドの保護**：`isAdmin` などユーザーが変更してはならない属性をサーバ側で固定する。
3. **allowlist（許可リスト）**で、ユーザーが変更してよいフィールドだけを通す。

> 出典: Cobalt — API Security 101: Mass Assignment exploitation in the wild — https://www.cobalt.io/blog/mass-assignment-apis-exploitation-in-the-wild

---

### 9c.3 Snyk Learn「Mass Assignment」— SuperCloudCRMシナリオと防御の設計

Snyk Learnのレッスンは、**フィールド列挙 → 権限昇格**という攻撃の全工程と、フレームワーク別の防御を体系的に見せてくれる。ここが本節の実装面の核心である。

#### 定義と対象フレームワーク

Mass Assignmentは「**権限を確認せずにユーザー提供データでオブジェクトのプロパティを設定する**」ときに起きる。Node.js、Ruby on Rails、Java Spring MVC、ASP.NET MVC、Rustのactix-webなど、**入力を構造体/オブジェクトへデシリアライズ（直列化されたJSON等をメモリ上のオブジェクトに復元）するライブラリ**を使う環境すべてが対象になりうる。

Rust/actix-webの例が原理をよく表す：

```rust
// ハンドラ引数が User そのもの ＝ JSON の全フィールドが User に入る
async fn create(user_data: web::Json<User>) { ... }
```

`web::Json<User>` エクストラクタは、受信JSONを **serde（Rustの直列化ライブラリ）** で `User` 構造体にデシリアライズする。これが「マスアサインメント」の実体だ。`User` に `role: String` や `isAdmin: bool` があれば、**フロントのフォームに項目が無くても**攻撃者はJSONにそれらを足して送れてしまう。

PHPの例も同様に簡潔で危険だ：

```php
$user = new User($request->post());  // POST 全パラメータを User の属性へ一括代入
```

#### SuperCloudCRMシナリオ（攻撃の全工程）

架空のCRM「SuperCloudCRM」は、`/user/create` エンドポイントのMass Assignmentからデータ侵害に至った。正規のUserスキーマは次の通り：

```
{
  username: String,
  password: String,
  email: String,
  organization: String,   // 所属：サーバが決めるべき
  role: String            // 権限：サーバが決めるべき
}
```

サインアップでユーザーが与えてよいのは `username`/`password`/`email` の3つだけ。しかし実装は受信フィールドを無検証で代入していた。

**ステップ1：フィールド列挙**。攻撃者は「隠れたフィールド名」を当てるため、`r` で始まる候補を大量に投げた。アプリが**有効なフィールドだけをレスポンスにエコーバック**したため、スキーマ構造が漏れた。

```json
{
  "username": "H4xx0r",
  "password": "H4xx0rP@$$w0rd",
  "email": "1337357h4xx0r.1244@hax4hire.xyz",
  "roker": "test",
  "roky": "test",
  "roland": "test",
  "role": "test",        // ← これだけがエコーされ、実在が判明
  "roleplay": "test",
  "roleplayer": "test",
  "roles": "test",
  "roll": "test"
}
```

**なぜ列挙が効くのか**：多くのORM/シリアライザは「モデルに存在するフィールド」だけを取り込み、存在しないキー（`roker` 等）は捨てる。取り込まれたフィールドが応答に反映されると、攻撃者は**総当たりでスキーマを復元**できる。エラーメッセージやレスポンス差分が「オラクル（正誤を教える手掛かり）」になる、典型的な情報漏洩パターンだ。

**ステップ2：権限昇格**。`role` と `organization` の存在が判明すると、攻撃者はこう送った：

```json
{
  "username": "H4xx0r",
  "password": "H4xx0rP@$$w0rd",
  "email": "1337357h4xx0r.1244@hax4hire.xyz",
  "role": "administrator",
  "organization": "dozipper.ly"
}
```

`organization` を変えながら繰り返すことで、**複数の顧客テナントに管理者として侵入**できた。付随して、パスワードが平文保存だったこと・代入可能フィールドの検証が皆無だったことも判明している。

#### 影響

- **データ改ざん**：パスワード・残高・機密情報の書き換え。
- **データ窃取**：DB内の機密への不正アクセス。
- **権限昇格**：管理者権限・上位ロールの奪取。
- **不正アクセス**：複数組織・リソースの横断侵害（`organization` 差し替えによるテナント越え）。

#### 防御の設計（Snykの整理）— ここが実装者の要点

##### 1. allowlist（許可リスト）— 推奨・fail-safe

ユーザーが設定してよいフィールドを**明示的に列挙**し、それ以外を捨てる。

```javascript
// Node.js（underscore の _.pick で許可フィールドのみ抽出）
userCreateSafeFields = ['username', 'password', 'email'];
$user = new User(_.pick($request->post(), userCreateSafeFields));
```

```php
// Laravel Eloquent：fillable で代入可能な属性を宣言
protected $fillable = ['username', 'password', 'email'];
```

##### 2. DTO（Data Transfer Object）パターン — 特にRust/型付き言語で有効

**入力専用の別構造体**を用意し、そこには安全なフィールドしか定義しない。機密フィールドは型として存在しないため、デシリアライザが**そもそも取り込めない**。

```rust
// 入力用DTO：role も organization も存在しない
struct CreateUserDto {
    username: String,
    password: String,
    email: String,
}

// ハンドラは User ではなく DTO を受ける
async fn create(user_dto: web::Json<CreateUserDto>) {
    // role / organization はサーバ側の値で安全に構築する
}
```

**なぜ最強に近いか**：serdeは `CreateUserDto` に無いキーを構造体に入れられない。すなわち `role` を送っても**格納先が存在しない**。allowlistは「実行時に弾く」のに対し、DTOは「**型システムのレベルで不可能にする**」。ヒューマンエラーが入りにくい。

##### 3. denylist（拒否リスト）— 非推奨・fail-open

```javascript
// 危険：ブロックすべきフィールドを列挙する方式
userCreateDisallowedFields = ['role', 'organization'];
$user = new User(_.omit($request->post(), userCreateDisallowedFields));
```

**なぜ危険か**：後日スキーマに新しい機密フィールド（例：`isSuperAdmin`）が追加されたとき、**denylistの更新を忘れると再び穴が開く**。allowlistは「知らないものは通さない（fail-safe）」、denylistは「知らないものは通してしまう（fail-open）」。安全側に倒れる設計を選ぶべきである。

##### 4. 静的解析（SAST）

Snyk Codeのようなツールで、本番投入前にMass Assignmentパターンを検出する。設計・レビューと併用する多層防御の一枚。

#### 歴史的先例：2012年 GitHub

Snykは有名な先例にも触れている。2012年、あるユーザーがGitHubの公開鍵更新フォームのMass Assignmentを突き、**Ruby on Rails公式リポジトリに自分の鍵を無断で追加**してみせた。GitHubは即座に修正し、コードベース全体を監査した。Railsの `attr_accessible`（当時の許可属性宣言）を怠ると起きる、Mass Assignmentの古典として今も引用される。

> 出典: Snyk Learn — Mass assignment — https://learn.snyk.io/lesson/mass-assignment/

---

### 9c.4 本節のまとめ — IDOR/BOLAとMass Assignmentをつなぐ視点

3つの資料を貫く原理は次の一文に集約できる。

> **「サーバが決めるべき値（所有関係・権限・所属・状態）を、ユーザー入力に決めさせてはならない。」**

- **IDOR/BOLA** は、ユーザー入力（識別子）にオブジェクトの**選択**を委ね、認可照合を省いたときに起きる。→ VIN/メール/IDによる他人リソースへの水平移動（Kia他、Toyota、Ferrari列挙）。
- **Mass Assignment/BOPLA** は、ユーザー入力にオブジェクトの**属性設定**を委ね、書き込み許可を検証しないときに起きる。→ `role`/`type`/`isAdmin` の書き換えによる権限昇格（Ferrari、Reviver、SuperCloudCRM）。
- 現実の大規模侵害では、**列挙（IDOR）で足場を作り、属性書き換え（Mass Assignment）で権限を奪う**連鎖が繰り返し観測された。

防御の優先順位は明確だ。**(1) オブジェクト単位の認可を毎回サーバ側で照合する（BOLA対策）／(2) 入力バインドはallowlistまたはDTOで機密属性を構造的に排除する（Mass Assignment対策）／(3) denylistや難読化やSecurity by Obscurityに頼らない。** これらは互いに独立した層であり、両方を実装して初めて本節の事例群は防げる。

> ⚠️ 本節はすべて**防御目的**の解説である。掲載したエンドポイント・ペイロードは原理理解のための概念図または一次資料からの引用であり、実在サービスや本番環境への無許可の検証・破壊的操作を推奨するものではない。検証は必ず、自分が管理する、または明示的に許可されたラボ環境でのみ行うこと。
