## RubyのJSON経由デシリアライゼーションとPoC集

### 導入: なぜ「JSONを送るだけ」でコマンド実行が起きるのか

Ruby系のWebアプリケーションでは、JSONやYAMLといった一見無害なデータ形式を「デシリアライズ（直列化されたバイト列やテキストを、元のオブジェクト構造に復元する処理）」する際に、単なるデータではなく**任意のクラスのインスタンス**を復元してしまうライブラリが存在する。攻撃者はこの仕組みを悪用し、正規のJSON入力欄（フォーム、API、Cookie、キャッシュ等）に細工したペイロードを送るだけで、サーバー上で任意のシェルコマンドを実行できる。

この章では、GitHub Security Labが公開した実証研究、実際に動作するPoC（Proof of Concept）リポジトリ、そしてRailsエコシステム全体をCodeQL的な手法（コード中のパターンマッチによる危険なsink探索）でスキャンした個人研究者のブログを軸に、「なぜ動くのか」という仕組みのレベルから解説する。

---

### 1. Rubyのデシリアライズが危険になる根本原因

まず前提として、Rubyのデシリアライザ（`Marshal.load`、`YAML.unsafe_load`、`Oj.load` など）は、JSONやYAMLのテキストから**任意のクラスのオブジェクトを、`initialize`メソッドを呼ばずに直接生成する**という共通の特徴を持つ。

> （以下は未取得資料の補足を含む、取得できた記事群の内容に基づく一般的な解説です）

通常Rubyでは `SomeClass.new(args)` のように、コンストラクタである `initialize` を経由してインスタンスを生成する。ここでは開発者が書いたバリデーション（型チェック、範囲チェックなど）が必ず通る。ところがデシリアライザは、シリアライズされたバイト列やハッシュ構造から「このインスタンス変数（`@foo` のような、オブジェクトが内部的に保持する値）にはこの値を入れる」という復元を行うために、`allocate()`（メモリ上に空のオブジェクトを確保するだけの低レベルAPI）でオブジェクトの箱だけを作り、そこへ**直接インスタンス変数を注入する**。これはRuby自身のブログ記事群が明言している通り、「`initialize`とそれが本来行うはずのバリデーションを一切通らない」ということを意味する。

つまり攻撃者は、アプリケーションの正規のコンストラクタでは絶対に作れないはずの「矛盾した」「攻撃用に汚染された」内部状態を持つオブジェクトを、デシリアライズ経由でサーバー内に直接作り込める。これが「デシリアライゼーション・ガジェットチェーン（gadget chain: 攻撃者が制御できないコードの断片を繋ぎ合わせ、意図しない挙動を連鎖的に引き起こす攻撃手法）」の出発点である。

#### 主要ライブラリごとの危険なsink

GitHub Security Labの記事は、Rubyプロジェクトで見つかる代表的な危険なデシリアライズ経路を次のように整理している。

| ライブラリ | 危険な呼び出し（sink） | 備考 |
|---|---|---|
| Marshal | `Marshal.load(untrusted_data)` | `_load` というマジックメソッドを呼び出して復元する。信頼できない入力に対しては本質的に危険とされる |
| Psych（YAML） | `YAML.load`（旧版）／`YAML.unsafe_load`（現行） | Ruby 3.1以降ではPsych 4.0が同梱され、無印の`YAML.load`はデフォルトで安全なクラスのみに制限されるようになった。任意クラスを許すには明示的に`unsafe_load`を呼ぶ必要がある |
| Oj（JSONライブラリ） | `Oj.load(untrusted_data)`（safe modeを指定しない場合） | デフォルトで任意クラスのインスタンス化に対応。`"^o": "ClassName"` という特殊キーでクラス指定を行う独自拡張構文を持つ |
| 標準JSON gem | `JSON.load` を `json_create` 対応クラスとともに使う場合 | 対応できるクラスが `json_create` クラスメソッドを実装しているものに限定されるため、Oj/Marshal/YAMLに比べてガジェットの選択肢は大きく狭まる |

> 出典: GitHub Security Lab: Execute commands by sending JSON? — https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/

ここで重要なのは、「JSON経由」といっても実体は複数ある点だ。標準ライブラリの `JSON` gemが提供する `JSON.load` は `json_create` という規約に従ったクラスしか復元できないため攻撃面が狭い。一方で人気の高速JSONライブラリ **Oj** は、独自の拡張記法（`^o`でオブジェクト指定、`^c`でクラスそのものを指定）を使い、`safe_load`を明示的に呼ばない限り**任意のRubyクラス**をインスタンス化できてしまう。実務では「JSONだから安全」という思い込みでOjやMarshalベースの内部キャッシュ形式が使われているケースが多く、これが本章の主題である「JSON経由デシリアライゼーション」の核心的な攻撃面になる。

---

### 2. キック起点（kick-off）の仕組み: なぜ「読み込むだけ」でメソッドが呼ばれるのか

デシリアライズされたペイロードがただちにRCEに直結するわけではない。攻撃者が制御できるのは「復元されるオブジェクトの型とインスタンス変数の中身」だけであり、そこから実際にコードが実行されるところまで、複数の正規メソッド呼び出しを**連鎖**させる必要がある。この連鎖の起点を「kick-off（蹴り出し）」と呼ぶ。

GitHub Security Labの記事は、ライブラリごとのkick-offメソッドを次のように整理している。

| ライブラリ | トリガーとなるメソッド | 呼び出される契機 |
|---|---|---|
| Marshal | `_load` | デシリアライズ処理自体のマジックメソッド |
| Oj | `hash` | 復元されたオブジェクトがHashのキーとして使われたとき |
| Ox（XML） | `hash` | 同上 |
| Psych（YAML） | `hash` または `init_with` | 同上、または独自の復元フック |

> 出典: GitHub Security Lab: Execute commands by sending JSON? — https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/

「オブジェクトがHashのキーとして使われたとき `hash` メソッドが呼ばれる」という点が仕組み上の核心である。Rubyの `Hash` は内部的にキーの**同値性判定と再配置**のためにキーオブジェクトの `hash` メソッドを呼ぶ。デシリアライザがJSON/YAMLのハッシュ表現を復元する過程で、攻撃者が「キー位置」に任意クラスのインスタンスを置けると、そのクラスの `.hash` メソッドが**アプリケーションコードが一切介在しない場所で自動的に呼ばれる**。Behrad Taherのブログはこれを「デシリアライザがHashを再構築する際、キーに対して `.hash()` を呼ぶ。配列をキーとして挿入すると `Array#hash` が強制的に発動し、配列の各要素に対して `.hash` を呼び出す ── これはデシリアライズ結果が呼び出し元に返る前に起きる」と説明している。

つまり `.hash` は「攻撃者が直接呼べないが、データ構造の設計上ほぼ確実に呼ばれる」汎用的な踏み台（トランポリン）として機能する。ここから、`.hash` を実装しているクラスの中に「何か危険な処理につながる」ものを探す、というのがガジェットチェーン探索の第一歩になる。

---

### 3. 実例1: 検出専用ガジェットチェーン（RCEなしでの脆弱性証明）

GitHub Security Labの記事では、まずコード実行を伴わない「検出用（detection）」ガジェットチェーンを示している。これは、脆弱性が存在することを外部コールバック（Burp Collaboratorのような、外部からのHTTPリクエストを観測できるサービス）へのHTTPリクエストという形で証明するもので、実運用でのペネトレーションテストにおいて「本番環境を破壊せずに脆弱性の有無を確認する」目的にも使える手法である。

連鎖の流れは次の通りである。

1. **キック起点**: `Gem::Requirement` のインスタンスをHashのキーとして配置する。
2. **橋渡し**: `Gem::Requirement#hash` は内部で、`["~>", INNER_GADGET]` のような形の配列要素に対して `to_s` を呼ぶ。
3. **エスカレーション**: `Gem::RequestSet::Lockfile#to_s` → `spec_groups` を経由して `requests` を列挙する。
4. **URL構築**: `URI::HTTP` に不正な `scheme: "s3"` パラメータを与えることで、URLのパス部分にインジェクションを行う。
5. **実行**: `Gem::RemoteFetcher#fetch_path` が、攻撃者が指定したURLへHTTPリクエストを送信する。

> 出典: GitHub Security Lab: Execute commands by sending JSON? — https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/

この連鎖が示す教訓は、「RubyGemsのパッケージ管理関連クラス（`Gem::Requirement`、`Gem::RequestSet::Lockfile`、`Gem::RemoteFetcher` など）は、標準ライブラリの一部としてほぼ全てのRuby実行環境にロードされているため、application固有のgemに依存せず**普遍的に使えるガジェット源**になる」という点だ。これは後述するPoCリポジトリで「universal gadget chain（普遍的ガジェットチェーン）」と呼ばれる理由でもある。

---

### 4. 実例2: RCEガジェットチェーンと`zip`コマンドを使った回避策

もともとセキュリティ研究者william bowling（vakzz）が発見した `Gem::Source::Git` を使うRuby 2.x/3.x向けの普遍的ガジェットチェーンは、後にRuby 3.2以降で `UTF-8` エンコーディングエラーが原因で動作しなくなった。GitHub Security Labの記事は、この回避策として**zipコマンドの引数注入**を利用した新しいRCE手法を示している。

元のガジェットチェーンは、最終的に外部コマンドを次のような形式で実行する。

```
<binary> rev-parse <second-argument>
```

ここで `<binary>` と `<second-argument>` の両方をある程度攻撃者が制御できるが、「必ず `rev-parse` という固定引数が先頭に来てしまう」という制約がある。通常のgitコマンドではこの制約下で任意コマンド実行に持ち込むのは難しい。そこで記事が示す解法は次の通りである。

1. `rev-parse` という名前の**zipファイル自体**を作成する（これで「第一引数がrev-parseである」という制約を満たしたことになる ── zipコマンドにとって、それは実行するサブコマンド名ではなくファイル名として解釈される）。
2. 実行させたいコマンドを、zipのオプション経由の引数インジェクションとして仕込む:

```
zip rev-parse -TmTT="$(id>/tmp/output)"
```

3. `-TmTT=` というzipのオプション（unzip側のテスト用コマンド実行機能を悪用するもの）に、シェルコマンド `$(id>/tmp/output)` をダブルクォートで包んで渡す。zipはこのファイル名部分をあたかも通常の引数のように処理する過程で、シェル経由でコマンドを実行してしまう。

このテクニックの構造をJSON（Oj向けの`^o`拡張構文）で表現すると、記事は次のようなペイロード構造を示している。

```json
{
  "^o": "Gem::Resolver::SpecSpecification",
  "spec": {
    "^o": "Gem::Resolver::GitSpecification",
    "source": {
      "^o": "Gem::Source::Git",
      "git": "zip",
      "reference": "-TmTT=\"$(COMMAND)\"",
      "root_dir": "/tmp",
      "repository": "anyrepo",
      "name": "anyname"
    }
  }
}
```

なぜこれで任意コマンドが実行できるのかを整理すると、以下の3つの独立した仕組みが重なっている。

- **Ojの`^o`記法**は「このJSONオブジェクトを指定クラスのインスタンスとしてデシリアライズせよ」という命令であり、`initialize`を経由せずにインスタンス変数（`@git`、`@reference`、`@root_dir` 等）へ直接値を注入する（前述の「初期化バリデーション回避」の具体例）。
- **`Gem::Source::Git`**は本来、gitリポジトリをローカルにチェックアウトするために内部で `<git実行ファイル> rev-parse <reference>` のような形式のコマンドを組み立てる。`git`フィールドを`"zip"`に差し替えることで、実行されるバイナリそのものを乗っ取っている。
- **zipコマンドの`-TmTT`オプション**（アーカイブのテスト・整合性検証機能の一種）が、渡された文字列をシェル経由で評価する挙動を持つため、`reference`フィールドに仕込んだシェルコマンドがそのまま実行される。

`{CALLBACK_URL}` や `{ZIP_PARAM}` といったプレースホルダーを実際の値に置換して使う実装は、次節で紹介するPoCリポジトリに収録されている。

> 出典: GitHub Security Lab: Execute commands by sending JSON? — https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/

#### バージョン依存性（陳腐化対策として明記）

- Oj/Ox/Psychを使ったガジェットチェーンは **Ruby 3.3.3（2024年6月時点）** まで動作確認されている。
- Marshalを使ったガジェットチェーンは **Ruby 3.2.4（2024年4月時点）** まで動作確認されているが、Ruby 3.3以降では前述のUTF-8エンコーディングの扱いが変わったため元のvakzzチェーンは崩れる（本記事のzip回避策はその対策として書かれたものである）。
- YAMLについては、Ruby 3.1以降で標準搭載されるPsych 4.0により、無印の `YAML.load` はデフォルトで安全側（許可されたプリミティブ型のみ）に倒されるようになった。ただし `YAML.unsafe_load` を明示的に呼んでいるコードは従来通り無防備である。

このように「どのRubyバージョン・どのgemバージョンで通用する話か」を必ず確認した上で、対象システムの実際のバージョンに当てはめて評価する必要がある。

---

### 5. PoCリポジトリ: `ruby-unsafe-deserialization`

GitHub Security Labは上記の研究成果を、再利用可能なPoC集としてリポジトリに公開している。このリポジトリは「学術研究および効果的な防御技術の開発」を目的として明記されている。

収録されている対象ライブラリと形式は次の4種類である。

1. **Oj**（JSON形式のライブラリ）
2. **Ox**（XML形式のライブラリ）
3. **Psych**（YAML形式のライブラリ）
4. **Marshal**（Ruby独自のバイナリシリアライズ形式）

ディレクトリ構成はライブラリ・対応バージョンごとに分かれている。

```
/marshal
/oj/3.3
/ox/3.3
/yaml/3.3
```

各ディレクトリには前述の「検出用（URLコールバックを発生させるだけ）」と「RCE用（zipコマンドを使う）」の2種類のガジェットチェーンが用意されており、利用者は以下のようなプレースホルダーを実際の値に置き換えるだけで動作を試すことができる（防御目的の検証として、自組織が管理する隔離環境でのみ利用すること）。

- 検出用: `{CALLBACK_URL}` を自分が監視できるコールバック先URLに置換
- RCE用: `{ZIP_PARAM}` を例えば `-TmTT=\"$(id>/tmp/deser-poc)\"any.zip` のような値に置換

これらのガジェットチェーンは、William Bowling氏がRuby 2.x/3.x向けに開発した「普遍的ガジェットチェーン（universal gadget chain）」を土台としている。「普遍的」と呼ばれる理由は、標的アプリケーション固有のgemではなく、Bundlerやパッケージ管理まわりの標準ライブラリ（RubyGems関連クラス群）だけで完結する点にある。つまり、ほぼどのRubyアプリケーションにも共通して仕込める攻撃手法だということだ。

> 出典: GitHubSecurityLab: ruby-unsafe-deserialization — https://github.com/GitHubSecurityLab/ruby-unsafe-deserialization

防御側にとっての実務的な意味は、「自分のアプリケーションが `Oj.load`、`YAML.unsafe_load`、`Marshal.load` のいずれかを、外部から到達可能な入力（JSON API、Cookie、キャッシュシリアライズ、セッションストア等）に対して呼んでいないかを棚卸しし、該当箇所があれば即座にこのPoCで（自組織管理下の検証環境に限り）実証すべき」ということである。

---

### 6. Railsエコシステム全体からガジェットを狩る: CodeQL的アプローチの実践例

前節までのガジェットは主にRubyGems標準クラスを起点にしていたが、Behrad Taherのブログは視点を変え、「Railsを使う実務アプリケーションに実在するgem群の中から、新しいガジェットを発掘する」方法論を示している。この手法は静的解析（コードを実行せずソースコードのパターンを機械的に走査すること）の考え方を、専用ツール（CodeQL）を使わずに素朴なテキスト検索（ripgrep）で近似したものだが、考え方自体はCodeQLのようなデータフロー解析ツールにも通じる汎用的なものである。

#### 手法の骨子

1. **母集団の構築**: Rails本体に加え、Sidekiq、Puma、Devise、Nokogiriなど、実務でよく使われる**131個のgem**をDockerコンテナ内にインストールし、合計**6,921個のRubyソースファイル**を対象母集団とした。
2. **危険パターンの機械的検索**: `ripgrep`（高速な正規表現検索ツール）を使い、「インスタンス変数（`@変数名`。攻撃者がデシリアライズ時に直接注入できる値）が、危険な関数呼び出しの引数にそのまま渡されているコード」を正規表現でパターンマッチした。具体的には次のような検索パターンが例示されている。

```
Open3\.capture3\(@\w+\)
\.send\(@\w+\)
```

なぜこの検索パターンが有効かというと、前述の通りデシリアライザは `initialize` を経由せず**インスタンス変数へ直接値を注入する**ため、「メソッドの引数が定数やローカル変数ではなく、インスタンス変数そのものである」箇所こそが、攻撃者が値を完全制御できる「sink候補」だからである。逆に言えば、通常のバリデーション付きコンストラクタを経由するコードでは、インスタンス変数は常に検証済みの値しか入らないため安全だが、デシリアライズ経路では検証をすべて迂回できてしまう。

#### 発見されたガジェットクラスの内訳

**`ActiveSupport::Deprecation::DeprecatedInstanceVariableProxy`**: このクラスは、自身のインスタンスメソッドをほぼ全て消去（undef）しており、その結果ほとんど全てのメソッド呼び出し（`.hash` を含む）が `method_missing`（Rubyで、存在しないメソッドが呼ばれたときに代わりに実行されるフォールバック処理）にフォールスルーする。この `method_missing` は最終的に `target().__send__(...)` という形で、攻撃者が制御する「送信先オブジェクト」に対して「送信するメソッド名」を動的に呼び出す。これは前節の「`.hash`から始まる連鎖」の起点として理想的な性質を持つ ── なぜなら「メソッド名も送信先も両方攻撃者が指定できる汎用ディスパッチャ」になっているからである。

**`Puma::MiniSSL::Context#key_password`**: 引数を取らないメソッドだが、内部でインスタンス変数 `@key_password_command` を読み取り、それをそのまま `Open3.capture3`（シェルコマンドを実行してその標準出力・標準エラー出力・終了ステータスを取得する標準ライブラリのAPI）に渡す。つまりこのメソッドが呼ばれた時点で、攻撃者が設定した `@key_password_command` の中身がシェルコマンドとして実行される。

#### 連鎖全体の構造

1. **トリガー**: 配列をHashのキーとして挿入する（前節で説明した「配列キーは`Array#hash`経由で各要素の`.hash`を呼ぶ」性質を利用）。
2. **入口**: `DeprecatedInstanceVariableProxy#hash` が呼ばれ、実装が消去されているため `method_missing` に落ちる。
3. **ディスパッチ**: `method_missing` 内部の `target()` メソッドが `@instance.__send__(@method)` を実行する。
4. **シンク**: `@method` として `"key_password"` を、`@instance` として攻撃者が用意した `Puma::MiniSSL::Context` インスタンス（`@key_password_command` に任意コマンドを仕込んだもの）を指定しておくことで、最終的に `Open3.capture3` 経由でシェルコマンドが実行される。

このガジェットチェーンをOjペイロードとして構築する場合、Ojの `^c`（クラス自体を指すディレクティブ）と `^o`（オブジェクト指定）を組み合わせ、`DeprecatedInstanceVariableProxy`インスタンスの `@instance` フィールドが `Puma::MiniSSL::Context` オブジェクトを指し、その `Context` オブジェクトの `@key_password_command` に任意コマンド文字列を持たせるという、入れ子構造で表現される。

#### 探索の過程で「行き止まり」と判断されたパターン

このブログはまた、有望に見えて実際には使えなかった候補についても記録しており、これはガジェット探索の再現性・効率を高める上で有用な知見である。

- **`ERB#result`**: Ruby 3.x系で `singleton class` に対する検証が追加され、テンプレートインジェクション経由の悪用が塞がれた。
- **DRb（分散Rubyオブジェクト）関連パターン**: 通常の本番Rails環境ではロードされないため、実務上の攻撃面としては現実的でない。
- **Proc（無名関数オブジェクト）を用いるsink**: そもそもデシリアライザ経由ではProcオブジェクトを構築できないため対象外。
- **`public_send` パターン**: 呼び出し先オブジェクトと引数の両方がインスタンス変数由来という条件を満たす実装が実際には見つからなかった。

> 出典: Behrad's Blog: Hunting for Deserialization Gadgets in the Rails Ecosystem — https://behradtaher.dev/Hunting-for-Deserialization-Gadgets/

---

### 7. 防御側の実務チェックリスト

以上の3資料を踏まえ、防御側が確認すべき点を整理する。

1. **危険なsinkの棚卸し**: コードベース全体（自社コードだけでなく依存gemも含む）から `Marshal.load`、`YAML.load` / `YAML.unsafe_load`、`Oj.load`（safe modeなし）、`JSON.load`（`json_create`対応クラス併用時）を機械的に検索する。GitHubのコードスキャン機能は「信頼できないデータのデシリアライズ（Deserialization of user-controlled data）」というクエリでこれを検出できる。
2. **入力の出所を確認**: 見つかったsinkに渡されるデータが、外部（HTTPリクエストボディ、Cookie、キャッシュストア、メッセージキュー等）に由来していないかを追跡する。
3. **安全なAPIへの置換**:
   - Marshal: 信頼できない入力には使わない。
   - YAML: `YAML.safe_load`（Psych 4.0では無印の`YAML.load`が実質これに相当）を使う。
   - Oj: `Oj.safe_load` または `Oj.load(data, mode: :strict)` を使う。
   - JSON: `JSON.parse`（プレーンなハッシュ/配列のみを復元し、任意クラスの復元を行わない）を優先する。
4. **バージョン管理**: 使用しているRuby本体・Oj・Psych・RubyGemsのバージョンを把握し、本章で示したガジェットチェーンの動作確認バージョン（Ruby 3.3.3時点でOj/Ox/Psych系、Ruby 3.2.4時点でMarshal系）と照らし合わせて、自環境が該当する場合は特に優先度を上げて対処する。ただし新しいバージョンでガジェットが動かなくなったとしても、それは特定の連鎖が壊れただけであり、危険なsink自体（`Oj.load`の無制限モードなど）が残っている限り、新しいガジェットチェーンが発見され得るという前提を忘れないこと。
5. **自組織管理下での実証にとどめる**: 本章で紹介したPoC類は、あくまで自分が権限を持つ検証環境・自社アプリケーションに対する脆弱性の実証にのみ用いること。実在の第三者サービスや本番環境への無許可の実行は行わない。
