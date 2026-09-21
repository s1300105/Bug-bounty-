# 第5章 ツールと方法論

## InQL: Burp中心のGraphQLワークフロー

GraphQLエンドポイントを手作業でテストするのは非常にコストが高い。REST APIと違い、GraphQLは単一エンドポイント（通常 `/graphql`）に対して、クエリ・ミューテーション・サブスクリプションという多数の操作が定義され、それぞれがネストしたフィールドと引数を持つ。攻撃対象領域（attack surface、実際に外部から到達可能な入力経路の総体）を人手で洗い出すのは非現実的であり、これを自動化するために Doyensec が開発したのが **InQL**（GraphQL Scanner）である。本節では、InQL の設計思想と内部動作、そして2025年末の v6.1.0 で追加された「イントロスペクションが無効化された環境でもスキーマを復元する」ブルートフォース機能を中心に解説する。

### InQL とは何か、なぜ生まれたか

InQL は当初 Python 製のスタンドアロン CLI ツールとして 2020年3月に公開された。Doyensec のブログ記事によれば、開発の動機は「GraphQL のセキュリティテストを高速化するための社内ツールとして作り始めた」ことにある。GraphQL のペネトレーションテストでは、最初のステップとして必ず「そのエンドポイントで何ができるか」を把握する必要がある。これは REST でいう Swagger/OpenAPI 定義を読むことに相当するが、GraphQL には **イントロスペクション（introspection）** という、スキーマ自体をクエリとして問い合わせられる標準機能がある。

> ⚠️ 前提として、イントロスペクションは GraphQL 仕様上の組み込み機能で、`__schema` や `__type` という特殊フィールドを問い合わせることで、サーバーが公開している全ての型・フィールド・引数・deprecated 情報を取得できる。本番環境で無効化されていない場合、これは「攻撃対象領域のドキュメントを自動生成できる」ことを意味する。

InQL はこのイントロスペクションクエリを送信し、その応答（巨大な JSON）を解析して、人間が読めるクエリ・ミューテーションのテンプレート集に変換する。これにより、テスターは「どの型が存在し、どのフィールドにどの引数を渡せるか」を一つ一つ推測する必要がなくなる。

> 出典: Doyensec Blog「InQL Scanner」— https://blog.doyensec.com/2020/03/26/graphql-scanner.html

### 2つの実行形態: スタンドアロン CLI と Burp 拡張

InQL は当初から二つの形態で提供されている。

1. **スタンドアロン Python スクリプト（CLI）**: パイプラインへの組み込みや、Burp を使わない自動スキャンに向く。
2. **Burp Suite 拡張機能**（Professional / Community 両対応）: 手動診断のワークフローに GraphQL 専用のタブを統合する。

CLI のインストールは単純で、次のように行う。

```bash
pip install inql
```

インストール後、対象のエンドポイントに対して次のように実行すると、イントロスペクションを取得し、全クエリ・ミューテーション・サブスクリプションをドキュメント化したファイル群を出力する（Doyensec のブログでは anilist.co を対象にしたサンプル実行が示されている）。

```bash
inql -t https://graphql.anilist.co
```

CLI の主なオプション群は以下のような役割を持つ（対象指定、スキーマファイルの直接入力、認証キー、プロキシ経由での送信、SSL/TLS 検証の緩和、出力形式のカスタマイズ）。特に「スキーマファイルを直接入力できる」点は重要で、イントロスペクションが無効化されていても、別の手段（後述のブルートフォースや、エラーメッセージからのリバースエンジニアリングなど）で得たスキーマ定義（SDL: Schema Definition Language）を渡せば、同じテンプレート生成・攻撃対象分析のパイプラインに載せられる。

> 出典: Doyensec Blog「InQL Scanner」— https://blog.doyensec.com/2020/03/26/graphql-scanner.html

### なぜ Burp 拡張として使うことに意味があるのか

CLI 版は自動化・CI 統合には向くが、実際のバグバウンティやペネトレーションテストの現場では、手動での試行錯誤（パラメータ改変、認可チェックのバイパス試行、リクエストの使い回し）が不可欠である。ここで Burp Suite（プロキシとしてブラウザ/アプリのトラフィックを可視化し、Repeater で個々のリクエストを繰り返し送信・改変できるツール）と統合されていることの価値が生きる。

InQL の Burp 拡張は、GitHub リポジトリの説明によれば以下の機能を持つ。

- **Scanner モジュール**: ターゲットのスキーマから可能な限り全てのクエリ・ミューテーション・サブスクリプションを生成する。生成の深さ（ネストの階層数）やインデントの体裁を設定可能。これは、深いネストを持つクエリが DoS（サービス拒否）の温床になりやすいという GraphQL 特有のリスクとも関係する。深さを制御できることで、テスターは「どこまで掘れば現実的な攻撃対象になるか」を調整できる。
- **Points of Interest（POI）スキャン**: スキーマ定義内の「注目すべきキーワード」（例: `password`, `token`, `admin`, `secret` など）を正規表現でスキャンし、機微なフィールド名を自動的にハイライトする機能。手作業で数百のフィールドを目視確認する必要がなくなる。
- **循環参照（circular reference）検出**: 再帰的にネスト可能なクエリ（例えば `User { friends { friends { friends { ... } } } }` のような自己参照型スキーマ）を検出してフラグを立てる。これは前述のネスト深度 DoS 攻撃の起点となりうるため、防御的観点で優先的に確認すべき箇所を教えてくれる。
- **Burp との直接連携**: キャプチャした GraphQL リクエストからクエリを生成したり、生成したテンプレートを Repeater や Intruder に直接転送できる。
- **Batch Queries タブ**: 複数のクエリをバッチ（一つの HTTP リクエストに複数の GraphQL 操作をまとめて送る仕組み）として同時実行できる。これはレート制限（rate limit）の実装を検証する際に有用である。GraphQL の一部実装では、HTTP リクエスト単位でレート制限をかけているため、1リクエストに大量の操作をバッチ化することでレート制限を回避できてしまう設計上の問題がある。InQL のこの機能は、そうした実装不備を（防御目的で）検証するために使う。
- **専用メッセージエディタ**: Burp のリクエスト/レスポンスビューに「GraphQL (InQL)」タブが追加され、シンタックスハイライト付きでクエリを閲覧・編集できる。
- **GraphiQL / Voyager 連携**: スキーマを視覚化するサーバーを内部で起動し、GraphiQL（対話的なクエリコンソール）や Voyager（スキーマの型関係をグラフ表示するツール）と連携できる。
- **エンジンフィンガープリンティング**と**スキーマブルートフォーサー**: 後述する v6.1.0 の目玉機能。
- **カスタムヘッダー**: 観測したトラフィックからドメインごとのヘッダー設定を自動的に populate する。

> 出典: InQL (Doyensec) — https://github.com/doyensec/inql

### インストールとビルド（v6系: Kotlin 実装）

2025年時点の InQL は v6.0.0 で Jython（Python 実装の Burp 拡張基盤）から Kotlin へと全面書き換えされている。これにより、Burp Suite の最新版のみをサポートし、Java 17 以降（Burp の新しい拡張 API である Montoya API の要件）が必須になった。ソースからビルドする場合は次の手順を踏む。

```bash
# 依存関係のインストール（Debian/Ubuntu系の例）
sudo apt install -y openjdk-17-jdk task

# クローンしてビルド
git clone https://github.com/doyensec/inql
cd inql
task all  # InQL.jar が生成される
```

開発時に変更を即座に反映させたい場合は `task kotlin -w` を実行すると、ファイル変更を監視して自動リビルドされる。現在のメンテナは Bartłomiej Górkiewicz で、ライセンスは Apache 2.0。バージョン依存の注意点として、**v6.0.0以降は Jython版と互換性がなく、Burp の旧バージョンでは動作しない**。古い記事やチュートリアルで「Jython を有効化してから InQL をロードする」という手順を見かけた場合、それは v5系以前の話であり、2025年12月時点の最新版（v6.1.x）には当てはまらない点に注意する。

> 出典: InQL (Doyensec) — https://github.com/doyensec/inql

### v6.1.0 の目玉機能: イントロスペクション無効時のスキーマブルートフォース

2025年12月2日にリリースされた InQL v6.1.0（v6.0.0 の Kotlin 全面書き換えに続くマイナーアップデート）で追加された最も重要な機能が **GraphQL Schema Brute-Forcer**（スキーマブルートフォーサー）である。

実運用の GraphQL API では、セキュリティ対策としてイントロスペクションを無効化しているケースが多い（本番環境でスキーマ全体を外部に公開すると、攻撃対象領域の全貌を渡してしまうため）。しかし、イントロスペクションを無効化しても、GraphQL サーバーの多くはデフォルトで「**Did You Mean（もしかして）**」提案機能を有効にしたままにしている。これは、開発者の利便性のために、存在しないフィールド名や引数名をクエリした際に、スキーマ内の似た名前を提案するエラーメッセージを返す機能である。

このブルートフォーサーの動作原理は次のとおりである。

1. あらかじめ用意されたワードリスト（一般的なフィールド名・引数名の辞書）から推測したフィールド名・引数名を組み合わせたクエリを、複数まとめて**バッチ**送信する。
2. サーバーが返すエラーメッセージのパターンを解析する。例えば `"Argument 'contribution' is required"` のようなメッセージは、そのフィールドが実在し、`contribution` という必須引数を持つことを示す。
3. `"Did you mean 'openPR'?"` のような提案メッセージを解析し、実在するフィールド名・引数名を逆算する。
4. 型ごとに固有のエラーを発生させるクエリを送ることで、フィールドの型（String, Int, オブジェクト型など）を推測する。
5. 上記を繰り返しながら、到達可能なスキーマ全体をマッピングし終えるまで反復する。

```text
# 概念的なイメージ（実際のワードリストベースの試行の一例）
query {
  user(contrbution: "x") { id }
}
# サーバー応答（エラーメッセージ）:
# "Cannot query field 'contrbution' on type 'Query'. Did you mean 'contribution'?"
#
# → 'contribution' という引数名の存在が判明する
```

この設計は、GraphQL のスキーマをエラーメッセージの差分から再構築する CLI ツール「Clairvoyance」に着想を得たと Doyensec のブログで明言されている。Clairvoyance は同様の手法を単体の CLI ツールとして実装していたが、InQL v6.1.0 はこれを Burp 拡張の中に統合し、生成したスキーマをそのまま Scanner の他機能（POI スキャン、テンプレート生成、循環参照検出など）に流し込めるようにした点が新しい。

**注意点（防御目的での理解として重要）**: このブルートフォースの所要時間は、スキーマの複雑さ・レート制限の有無・ワードリストのサイズによって「数分から数時間」まで大きく変動する。つまり、イントロスペクションを無効化するだけでは十分な防御にならない可能性がある。防御側としては、次のような対策の必要性が示唆される。

- 「Did you mean」提案メッセージを本番環境では無効化またはマスクする（エラーメッセージの詳細度を下げる）。
- バッチクエリ自体を制限する、または1リクエストあたりの操作数に上限を設ける。
- フィールド単位・クエリコスト単位でのレート制限を実施し、総当たり的な探索コストを引き上げる。

> 出典: Doyensec Blog「InQL v6.1.0 Just Landed」— https://blog.doyensec.com/2025/12/02/inql-v610.html

### エンジンフィンガープリンティング

同じく v6.1.0 で追加された **GraphQL Server Engine Fingerprinter** は、対象サーバーがどの GraphQL 実装（Apollo Server、GraphQL Ruby、Graphene、HotChocolate など）で動いているかを特定する機能である。仕組みとしては、実装依存のエッジケースを突くクエリを送信し、返ってくるエラーメッセージやレスポンスの微妙な差異を解析する。

例として挙げられているのは次のようなクエリである。

```graphql
query @deprecated {
  __typename
}
```

このクエリは、GraphQL の仕様上「本来 `@deprecated` ディレクティブはクエリ全体ではなくフィールドやENUM値に付与するもの」であるため、多くの実装でエラーになる。しかし、そのエラーメッセージの**文言・フォーマット**が実装ごとに異なるため、これを既知のシグネチャと突き合わせることでエンジンを特定できる。

なぜこれが防御・攻撃双方にとって重要かというと、GraphQL の脆弱性の多くは特定の実装に固有のものだからである。Doyensec のブログでは、フィンガープリンティングの結果を **GraphQL Threat Matrix**（GraphQL 特有の脅威を実装別に整理した公開ナレッジベース）と突き合わせることで、その実装固有の既知の弱点（例えばある実装ではデフォルトでバッチクエリの上限がないなど）を素早く洗い出せると説明されている。防御側の観点では、自組織が使っている GraphQL エンジンのバージョンとその既知の脅威を事前に把握し、フィンガープリンティングされても実害が出ないよう設定を強化しておくことが対策になる。

> 出典: Doyensec Blog「InQL v6.1.0 Just Landed」— https://blog.doyensec.com/2025/12/02/inql-v610.html

### その他の v6.1.0 の改善点

- **変数の自動生成**: リクエストを Repeater や Intruder に転送する際、これまでは引数のプレースホルダーを手動で埋める必要があったが、v6.1.0 では型に応じて自動的に妥当な値を挿入するようになった。具体的には `String → "exampleString"`、`Int → 42`、`Float → 3.14`、`Boolean → true`、`ID → "123"`、ENUM型 → 列挙された最初の値、という対応付けである。これは地味だが実務上のワークフロー効率に直結する改善で、手作業でのテンプレート穴埋めミス（型不一致によるバリデーションエラー）を減らす効果がある。
- **検索機能**: Scanner・Repeater・Intruder の各タブに検索機能が追加され、大規模スキーマ（数百〜数千フィールド）から目的のフィールドを探しやすくなった。
- **POI（注目フィールド）の正規表現マッチングとキャッシュの強化**、および**遅延POI・循環検出**によるスキーマ解析の高速化。
- 各種 UI・バグ修正。

> 出典: Doyensec Blog「InQL v6.1.0 Just Landed」— https://blog.doyensec.com/2025/12/02/inql-v610.html

### 実務でのワークフロー例（防御目的の検証を想定）

自組織が運用する GraphQL API に対して、許可された範囲内で InQL を用いた診断を行う典型的な流れは以下のようになる。

1. Burp Suite に InQL 拡張をロードし、ブラウザ/クライアントのトラフィックを Burp 経由でキャプチャする。
2. GraphQL エンドポイントへのリクエストを見つけたら、InQL の「GraphQL (InQL)」タブから Scanner にクエリを送る。
3. イントロスペクションが有効であれば、そのままスキーマ全体のドキュメントとテンプレート集が生成される。無効であれば、v6.1.0 のスキーマブルートフォーサーを起動し、許可されたワードリストとレート内でスキーマの再構築を試みる（本番稼働中のサービスに対して大量リクエストを送る行為は可用性への影響を及ぼしうるため、事前の合意・レート制限・実施時間帯の調整など、責任あるテストの手順を踏む必要がある）。
4. POI スキャンで機微なフィールド（認証・個人情報・管理系操作など）を洗い出し、優先的にレビューする。
5. 循環参照が検出されたクエリについては、実際にサーバー側でクエリの深さ制限・複雑度制限（query cost limiting）が機能しているかを確認する。
6. エンジンフィンガープリンティングの結果をもとに、その実装固有の既知の弱点がパッチ済みか、設定で無効化されているかを確認する。

この一連の流れが示すように、InQL の価値は「単発のペイロード送信ツール」ではなく、**イントロスペクション取得 → スキーマ理解 → 攻撃対象領域の可視化 → Burp の既存機能（Repeater/Intruder）への橋渡し**という、GraphQL 特有のワークフロー全体を一つの拡張に統合している点にある。特に2025年の v6.1.0 以降は、イントロスペクションが無効化された「一見安全に見える」本番相当の環境に対しても、エラーメッセージの副作用から間接的にスキーマを復元できることを示しており、「イントロスペクションを切っただけでは GraphQL API の攻撃対象領域は隠せない」という防御上の教訓を裏付けている。

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


---

[📖 目次](index.md) ・ [← 第4章 GraphQL特有の攻撃: alias/batching・ネストDoS・injection](04-graphql-specific-attacks.md) ・ [第6章 前提: WebSocketの仕組み →](06-websocket-fundamentals.md)
