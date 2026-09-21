## GraphQLmap・方法論・演習環境DVGA

これまでの章で見てきたイントロスペクション濫用、認可バイパス、バッチング/DoS、CSRFといった個々の攻撃手法は、実務では単発の`curl`コマンドの積み重ねではなく、専用ツールと体系立った方法論のもとで実行される。本節では、GraphQL版sqlmapとも呼べる対話型ツール「GraphQLmap」、GraphQLハンティングの調査・ツール一覧をまとめた「HowToHunt」リポジトリ、そして安全に手を動かして学ぶための意図的脆弱アプリケーション「DVGA (Damn Vulnerable GraphQL Application)」を取り上げる。いずれも防御側がペネトレーションテストや脆弱性診断の実務を理解し、自組織のAPIをどう検証されうるかを把握するために有用な資料である。

### GraphQLmap — 対話型GraphQL攻撃スクリプティングエンジン

**GraphQLmap**（swisskyrepo作、MITライセンス）は、GraphQLエンドポイントに対するペネトレーションテスト専用の対話型シェル（REPL: Read-Eval-Print Loop、コマンドを1行ずつ読み取り評価して結果を返すインタラクティブな実行環境）である。「GraphQL版のsqlmap」という位置づけで、スキーマ自動ダンプ、フィールドの総当たり（ブルートフォース）、NoSQL/SQLインジェクションの補助、バッチングを用いたレート制限回避などをワンストップで行える。

#### インストールと起動

```bash
git clone https://github.com/swisskyrepo/GraphQLmap
python setup.py install
graphqlmap
```

開発版（editable install）でのセットアップと起動例:

```bash
python -m venv .venv
source .venv/bin/activate
pip install --editable .
pip install -r requirements.txt
./bin/graphqlmap -u http://127.0.0.1:5013/graphql
```

> 出典: GraphQLmap — https://github.com/swisskyrepo/GraphQLmap

主なコマンドラインオプションは以下の通り。

| オプション | 説明 |
|---|---|
| `-u URL` | 対象のGraphQLエンドポイントURL |
| `-v [VERBOSITY]` | 詳細出力レベル |
| `--method [METHOD]` | 使用するHTTPメソッド（GET/POST等） |
| `--headers [HEADERS]` | JSON形式で追加HTTPヘッダーを指定 |
| `--json [USE_JSON]` | リクエストボディをJSONエンコードするか |
| `--proxy [PROXY]` | Burp SuiteなどへのHTTPプロキシ転送 |

認証が必要なAPIへの接続例（Bearerトークンをヘッダーに載せる）:

```bash
graphqlmap -u https://yourhostname.com/graphql -v --method POST \
  --headers '{"Authorization" : "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."}'
```

`--headers`でトークンを渡せる設計は、GraphQLの認可がミドルウェアではなくリゾルバ内部のロジックに散在しがちであることを踏まえ、テスターが「認証済みユーザーとしてスキーマ全体をどう見せるか」を検証しやすくするためである（前章で扱った認可バイパスの検証に直結する）。

#### スキーマの自動ダンプと補完

```
GraphQLmap > dump_new
```

このコマンドは対象エンドポイントに対してイントロスペクションクエリ（`__schema`を起点にフィールド・型・引数を再帰的に問い合わせる標準のメタクエリ）を発行し、取得したスキーマ情報を使って以降の対話シェルでのオートコンプリート（タブ補完）を有効化する。**なぜこれが成立するのか**——GraphQLはRESTと異なり、単一のエンドポイント（通常`/graphql`）に対してPOSTされたクエリ文字列をサーバー側パーサーが解析し、リゾルバへディスパッチする。イントロスペクションが有効な実装では、この解析に使われるスキーマ定義そのものを`__schema`クエリで丸ごと問い合わせ可能なため、攻撃者はソースコードを見ずに「クエリ可能な全フィールド・型・引数」を機械的に列挙できる。GraphQLmapはこれを自動化し、以降のクエリ入力を支援する。

#### クエリ・ミューテーション実行

対話シェルはGraphQLクエリ/ミューテーションをそのまま貼り付けて実行できる、いわば「GraphQL版のインタラクティブSQLクライアント」である。

```
GraphQLmap > {doctors(options: 1, search: "{ \"lastName\": { \"$regex\": \"Admin\"} }"){firstName lastName id}}
```

```
GraphQLmap > mutation { importPaste(host:"localhost", port:80, path:"/ ; id", scheme:"http"){ result }}
```

2つ目の例は、ミューテーションの引数（`path`）にシェルメタ文字`;`を注入し、サーバー側で外部コマンド（`host`/`port`/`path`を使って何らかのリクエストや処理を行う機能）がOSコマンドとして`path`文字列を後段で結合・実行してしまう場合にコマンドインジェクションへつながる例である。GraphQLのミューテーション引数はREST APIのフォームフィールドと同様に「ただの文字列」としてサーバーに渡るため、バリデーションなしにシェルやSQL文へ結合されれば、GraphQLだからといって古典的なインジェクション脆弱性から自由になるわけではないことを示している。

#### フィールドファジング（ブルートフォース）

GraphQLmapはプレースホルダ文字列を使ったファジングをサポートする。

文字単位のブルートフォース（`GRAPHQL_CHARSET`を1文字ずつ展開）:

```
GraphQLmap > {doctors(options: 1, search: "{ \"lastName\": { \"$regex\": \"AdmiGRAPHQL_CHARSET\"} }"){firstName lastName id}}
```

数値イテレーション（`GRAPHQL_INCREMENT_10`を0から順に10刻みなどで展開し、IDOR探索に使う）:

```
GraphQLmap > { paste(pId: "GRAPHQL_INCREMENT_10") {id,title,content,public,userAgent} }
```

後者は、連番の数値IDをそのまま`pId`引数として受け付け、所有者チェックをせずにレコードを返す実装があれば、他ユーザーの`paste`（メモ／共有テキスト）を総当たりで列挙できてしまうというIDOR（Insecure Direct Object Reference）検証の自動化である。REST APIの`/paste/123`を`/paste/124`に書き換えるのと原理は同じだが、GraphQLでは引数がURLパスに現れずリクエストボディの中に隠れるため、プロキシのURLフィルタや簡易なWAFルールでは見落とされやすい、という点が防御上の重要な示唆になる。

#### バッチングによるレート制限回避

```
GraphQLmap > BATCHING_3 {__schema{ types{namea}}}
```

これは1回のHTTPリクエストに同一（または類似）クエリを配列として複数個（ここでは3個）詰め込み、まとめてサーバーに送るバッチクエリ機能を悪用する。**仕組みレベルでの理由**——多くのGraphQLサーバー実装やAPIゲートウェイのレート制限は「HTTPリクエスト数」を単位にカウントするため、1リクエストの中にクエリを複数個含めてしまえば、実質的なクエリ実行回数に対してリクエスト数ベースのカウンタが追いつかず、ブルートフォースやスキャンの検知・抑制をすり抜けられる。これは本教科書の別章で扱ったバッチング型DoS攻撃と表裏一体の脆弱性であり、防御側は「クエリの複雑度・実行回数」で制限をかける必要がある理由がここにある。

#### NoSQLインジェクション支援モード

```
GraphQLmap > nosqli
Query > {doctors(options: "{\"patients.ssn\":1}", search: "{ \"patients.ssn\": { \"$regex\": \"^BLIND_PLACEHOLDER\"}, \"lastName\":\"Admin\" , \"firstName\":\"Admin\" }"){id, firstName}}
```

`BLIND_PLACEHOLDER`を1文字ずつ総当たりしつつレスポンスの真偽（ブラインド）差分を観測することで、MongoDBなどの`$regex`演算子を悪用したブラインドNoSQLインジェクションを自動化する。これは、GraphQLの引数値がバリデーションなしにNoSQLクエリのオペレータとして解釈される実装（引数がJSON文字列としてそのままDBクエリに渡ってしまうsink、すなわち「入力が最終的に実行・解釈される危険な代入先」）で成立する。

#### SQLインジェクション支援モード

```
GraphQLmap > postgresqli
GraphQLmap > mysqli
GraphQLmap > mssqli
```

対象DBの種類ごとに専用のペイロードテンプレートを切り替え、GraphQL引数を経由したSQLi検証を支援する。GraphQLのリゾルバがバックエンドでSQLを組み立てる際、パラメータ化クエリ（プリペアドステートメント）を使わず文字列結合していれば、トランスポート層がGraphQLであってもSQLインジェクションのリスクは変わらない、という原則を体現している。

GraphQLmapは2018年前後から開発が続くツールであり、対象実装（Apollo Server、Graphene、Hasuraなど）のバージョンやAPIの仕様変化によってはコマンドがそのまま通らないこともある。診断・防御双方において「どのフィールドがどんなバックエンドに直結しているか」を把握した上で、ツールの出力を鵜呑みにせず個別に検証する姿勢が重要である。

### HowToHunt「GraphQL」— 方法論とツールの見取り図

KathanP19が公開しているバグバウンティ向けメモ集「HowToHunt」の`GraphQL/GraphQL.md`は、個々の技術解説ではなく、GraphQLセキュリティを学ぶ・ハントする際に参照すべき外部資料とツールのキュレーション（厳選リンク集）である。実際の内容は以下の通り。

**動画教材**
- InsiderPhdによるGraphQL解説動画
- "REST in Peace: Abusing GraphQL to Attack Underlying Infrastructure"（LevelUp 0x05カンファレンス講演）— GraphQLの誤設定がREST時代とは異なる角度でインフラ攻撃の足がかりになることを扱う

**主要ブログ記事**
- Yeswehack Blog「How to exploit a GraphQL endpoint」— バグバウンティ視点での実践的な攻略手順
- Infosecwriteups「Hacking GraphQL for fun and profit」Part 1（基礎理解）・Part 2（方法論と実例）— 初学者から実務レベルへの橋渡し
- Doyensec「That single GraphQL issue that you keep missing」— GraphQL特有のCSRF（前章で詳説した、GETベースのクエリ実行やcontent-typeチェック不備を突くCSRF）を扱った代表的な記事
- Assetnote「Exploiting GraphQL」— バグバウンティハンターの実戦知見をまとめた解説
- GraphQL Test Cases（anmolksachan）— テストケース集

**紹介されているツール群**

| ツール | 役割 |
|---|---|
| GraphQL Voyager | スキーマをグラフとして可視化し、型・フィールドの関係を俯瞰する |
| GraphQL Cheatsheet (devhints.io) | クエリ構文の早見表 |
| AutoGraphQL | ダッシュボード形式でクエリ生成・実行を自動化するツール |
| graphw00f | GraphQLサーバーのエンジン（Apollo/Hasura/Graphene等）をレスポンスの特徴から指紋認証（フィンガープリンティング）するユーティリティ。dolevf（DVGAの作者と同一人物）による |
| InQL | Burp Suite拡張機能。イントロスペクションスキャナーとして、スキーマ取得からクエリ雛形の自動生成、監査用のレポート化までを支援する、GraphQL診断の事実上の標準ツールの一つ |
| Graphicator | GraphQLエンドポイントからデータを収集する簡易スクレイパー/エクストラクタ |

> 出典: KathanP19/HowToHunt「GraphQL」— https://github.com/KathanP19/HowToHunt/blob/master/GraphQL/GraphQL.md

このファイル自体はリンク集であり、個別の攻撃コードは含まれていない。しかし実務上の価値は高い。GraphQL診断の典型的なワークフローは、①`graphw00f`でバックエンド実装を特定し実装固有の癖（デフォルトで`__typename`ベースのエラーメッセージを出す、特定のディレクティブをサポートするなど）を把握する、②イントロスペクションが有効ならInQLやブラウザ拡張でスキーマを取得・可視化してAPIサーフェス全体を把握する、③GraphQL Voyagerなどで型の関係を俯瞰して機微なフィールド（内部ID、他ユーザーの個人情報、管理者専用ミューテーションなど）に当たりをつける、④GraphQLmapのような対話ツールやBurp Repeaterで個々のフィールド・ミューテーションを深掘りする、という順序をたどる。この見取り図を知っておくことは、防御側が「攻撃者はまずどこから手をつけるか」を逆算してログ監視や検知ルールを設計するうえでも有用である。

### DVGA (Damn Vulnerable GraphQL Application) — 演習環境

**DVGA**（dolevf作）は、Facebook発祥のGraphQL技術を対象に、意図的に脆弱性を仕込んだ学習用Webアプリケーションである。REST時代の「DVWA (Damn Vulnerable Web Application)」のGraphQL版に相当し、開発者・セキュリティ専門家が安全な自己完結環境でGraphQL特有の脆弱性を実際に手を動かして体験できるように設計されている。

#### セットアップ方法

Dockerでビルドして起動する場合:

```bash
git clone https://github.com/dolevf/Damn-Vulnerable-GraphQL-Application.git
docker build -t dvga .
docker run -d -t -p 5013:5013 -e WEB_HOST=0.0.0.0 --name dvga dvga
```

Docker Hubの公開イメージを直接使う場合:

```bash
docker pull dolevf/dvga
docker run -t -p 5013:5013 -e WEB_HOST=0.0.0.0 dolevf/dvga
```

Pythonで直接動かす場合:

```bash
git clone git@github.com:dolevf/Damn-Vulnerable-GraphQL-Application.git
pip3 install -r requirements.txt
python3 app.py
```

いずれの方法でも起動後は`http://localhost:5013`（またはDockerでマップしたポート）にブラウザでアクセスし、GraphiQL風のインターフェースまたは付属のWebアプリからクエリを試行する。

> 出典: Damn Vulnerable GraphQL Application (DVGA) — https://github.com/dolevf/Damn-Vulnerable-GraphQL-Application

#### 収録されている脆弱性カテゴリ

DVGAは学習しやすいよう脆弱性をカテゴリ別に整理している。

- **偵察（Reconnaissance）**: GraphQLエンドポイントの発見手法、実装のフィンガープリンティング
- **Denial of Service**: バッチクエリを使った過負荷、深いネスト（再帰的）クエリによるリソース枯渇——本教科書のDoS章で扱った原理そのものを、実際に手元で発火させて観察できる
- **情報開示**: イントロスペクションの濫用、本番環境で有効化されたままのGraphiQLインターフェースからの内部情報漏えい
- **コード実行**: OSコマンドインジェクション（GraphQLmapの`importPaste`のような、引数がシェルコマンドに結合されるsinkを模した実装）
- **インジェクション系**: XSS（クロスサイトスクリプティング）、SQLインジェクション、HTMLインジェクション
- **認可回避**: JWT（JSON Web Token）の偽造・改ざん、GraphQLインターフェース自体の保護不備（本番では無効化すべきGraphiQL/Playgroundが有効なまま公開されるケース）を悪用したバイパス
- **その他**: パストラバーサル、弱いパスワードポリシー

DVGAは初心者から上級者まで対応する「ゲームモード」を備え、正解手順そのものはPostmanコレクションとして別途提供される形になっている（本教科書ではスコープ制約上、個々のラボ攻略手順・フラグ取得手順は扱わない）。OWASPの「Vulnerable Web Applications Directory」に掲載されているほか、『Black Hat GraphQL』『Hacking APIs』といった専門書籍でも参照される、GraphQLセキュリティ学習における定番の実習環境である。

#### 学習上の位置づけと注意点

DVGAのような意図的脆弱アプリケーションは、その名の通り「意図的に」安全策を無効化している。本節で紹介したGraphQLmapのようなツールや、前章までで解説したイントロスペクション濫用・バッチングDoS・認可バイパス・CSRFといった攻撃手法を、**自分が管理する隔離環境の中でのみ**実際に動かして体感することで、本文の説明を「読んで理解した」から「なぜそのコードでその挙動になるのか腹落ちした」へ引き上げることができる。実サービスや本番環境、他者が管理するインフラに対してこれらの手法を無許可で試すことは、法的にもスコープ上も許されない。診断・研究目的の演習は必ずDVGAのような専用のローカル環境、または許可を得たバグバウンティ/ペネトレーションテストの範囲内でのみ行うべきである。

### まとめ

- GraphQLmapは、スキーマダンプ・フィールドファジング・バッチングによるレート制限回避・NoSQL/SQLインジェクション支援を一体化した対話型ツールであり、「GraphQLだからといってインジェクション系脆弱性から自由ではない」ことを実証する道具立てになっている。
- HowToHuntの「GraphQL」ページはリンク集であり、graphw00f（指紋認証）→InQL/Voyager（スキーマ把握）→GraphQLmap等（深掘り）という診断の典型的な順序を裏付ける資料として位置づけられる。
- DVGAは、これまでの章で学んだ攻撃原理（イントロスペクション、DoS、認可回避、CSRF、インジェクション）を隔離環境で安全に体験するための定番の演習アプリケーションであり、防御側もこれを使って自組織のGraphQL API実装がどのカテゴリの脆弱性に該当しうるかをセルフチェックする材料として活用できる。
