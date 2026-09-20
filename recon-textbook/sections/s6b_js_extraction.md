## AST解析とシークレット/エンドポイント抽出

前節までで「どのJSファイルが存在するか」を集めるところまで来た。本節はその先、**集めたJavaScriptから何を、どういう原理で取り出すか**を扱う。ここが JavaScript Recon の心臓部であり、同時に「正規表現でgrepするだけ」の素朴なやり方が最も大きく負ける領域でもある。

本節は防御側（自組織の資産を棚卸しし、漏れているものを見つけて塞ぐ側）の視点で書く。対象は必ず自分が管理権限を持つ資産か、明示的にスコープ内と定められた資産に限る。

---

### 1. なぜ正規表現では足りないのか

#### 1.1 バンドラが「文字列としてのURL」を破壊する

現代のフロントエンドは、ソースコードのまま配信されることはほとんどない。webpack / Vite / esbuild / Rollup といったバンドラが、次のような変換を行った後の成果物が配信される。

- **minify**: 変数名が `a`, `b`, `Xn` などに短縮される
- **文字列連結の残存**: ベースURLとパスが別々の変数として残り、実行時に `+` で連結される
- **チャンク分割**: 1つのアプリが数十〜数百の `.chunk.js` に分割される
- **テンプレートリテラル化**: `` `${base}/api/v2/users/${id}` `` の形になる

この結果、ソースコード上に `https://api.example.com/internal/v2/users` という**連続した文字列は一度も出現しない**。正規表現 `https?://[^\s"']+` は `https://api.example.com/` という断片しか拾えず、その後ろに何が連結されるのかを知る術がない。

#### 1.2 数値で見た差

starlog.is の解説記事は、この差を具体的な数字で示している。

> When security researchers analyzed a Fortune 500's JavaScript bundles with regex-based tools, they found 47 API endpoints. When they ran jsluice on the same code, they found 312.

正規表現ベースのツールで 47 本、jsluice（AST解析）で 312 本。約 6.6 倍である。差分の大半は「連結で組み立てられていたため、断片としてしか見えていなかったエンドポイント」だ。防御側から見れば、**自分たちが公開していると思っていた API の 6 倍以上が、実際にはクライアントバンドルから推測可能だった**ということになる。

> 出典: bishopfox/jsluice の AST 解析解説 — https://starlog.is/articles/cybersecurity/bishopfox-jsluice

---

### 2. AST解析の原理 — tree-sitter が何をしているか

#### 2.1 用語の整理

- **AST（Abstract Syntax Tree / 抽象構文木）**: ソースコードを「文字の並び」ではなく「文法的な入れ子構造」として表現した木。`a + b` は `binary_expression` というノードになり、その子として `a`（identifier）と `b`（identifier）がぶら下がる。
- **CST（Concrete Syntax Tree / 具象構文木）**: ASTに加えて、カッコやセミコロンなどの記号ノードや、元ソースでの位置（バイトオフセット）まで保持する木。tree-sitter が作るのはこちら寄りで、だから**抽出した文字列が元ファイルの何行目にあったか**を正確に言える。
- **tree-sitter**: GitHub が開発したインクリメンタル構文解析器生成ライブラリ。jsluice はその Go バインディングである `go-tree-sitter` を使う。

jsluice の基盤について、記事は次のように述べている。テキストスキャンではなく「complete syntax tree representing the code's structure」を構築する、と。

#### 2.2 tree-sitter を使う実装上の理由

JavaScript のパーサは世の中に多数あるが、Recon 用途で tree-sitter が選ばれるのには理由がある。

1. **エラー回復（error recovery）**: 壊れた JS、途中で切れた JS、JSX や TypeScript 構文が混ざった JS でも、パース不能な部分を `ERROR` ノードとして隔離し、残りの木を作り続ける。収集した JS が常に構文的に完全である保証はないので、これは実務上とても効く。
2. **クエリ言語**: S式（Lisp風の括弧記法）で木のパターンを書ける。後述するカスタムマッチャがこれで書ける。
3. **速度**: C実装で、数MBの巨大バンドルでもミリ秒〜数十ミリ秒台でパースできる。

#### 2.3 `EXPR` プレースホルダ — jsluice の中核アイデア

AST を手に入れただけでは、まだ URL は復元できない。`'https://api.example.com/' + endpoint + '?key=' + apiKey` の `endpoint` と `apiKey` の値は、実行してみないと分からないからだ。

jsluice はここで**「分からないものは分からないまま、構造だけ残す」**という割り切りをする。実行時に決まる部分を `EXPR` という固定文字列で置換するのだ。

```js
// 解析対象（バンドル内の典型的な形）
fetch('https://api.example.com/' + endpoint + '?key=' + apiKey)
```

```
# jsluice の出力（概念）
https://api.example.com/EXPR?key=EXPR
```

なぜこれが価値を持つのか。この 1 行から、次の 3 つが確定情報として得られる。

- **ベースドメイン**: `api.example.com` が API のホストである
- **パス構造**: ホスト直下に可変セグメントが 1 つ来る設計である
- **パラメータ名**: `key` というクエリパラメータを受け取る

値は不明でも、**パラメータ名の一覧**は攻撃面の棚卸しに直結する。正規表現ではこの `key=` は「文字列 `'?key='` という断片」でしかなく、URL の一部として認識されない。ここが決定的な差である。

#### 2.4 文脈（context）から HTTP メソッドを推定する

AST を持っていると、「その文字列がどこに置かれているか」が分かる。jsluice はこれを使ってメソッドまで推定する。

- `fetch()` の第1引数に渡された URL で、第2引数に `method` 指定がなければ **GET**
- `XMLHttpRequest.open('POST', url)` の第2引数なら **POST**（第1引数がメソッド）
- `document.location` / `window.open()` への代入・引数ならナビゲーション

さらに `new URLSearchParams({userId: someId, token: t})` のようなオブジェクトリテラルからは、**キー名だけ**を抜き出して `{userId: EXPR, token: EXPR}` としてパラメータ集合を構成する。記事は React Router / Vue Router のルート定義や、動的 `import()` ステートメントにも対応していると述べている。

> 出典: bishopfox/jsluice の AST 解析解説 — https://starlog.is/articles/cybersecurity/bishopfox-jsluice

---

### 3. jsluice の使い方とアーキテクチャ

jsluice は Bishop Fox が 2023年8月に公開した Go 製のツール兼ライブラリである（MIT ライセンス）。CLI とパッケージの両方の顔を持つ。

#### 3.1 インストールと基本サブコマンド

```bash
# CLI として
go install github.com/BishopFox/jsluice/cmd/jsluice@latest

# Go パッケージとして
go get github.com/BishopFox/jsluice
```

主なサブコマンドは次の通り。細かいフラグはバージョンで変わるので、必ず `jsluice -h` / `jsluice urls -h` で現物を確認すること。

| サブコマンド | 役割 |
|---|---|
| `urls` | URL・パス・パラメータを抽出し、1行1JSON（JSONL）で出力 |
| `secrets` | 組み込みマッチャで API キー等を検出し、JSONL で出力 |
| `tree` | パースした構文木をそのまま表示する（クエリを書くときの下調べ用） |
| `query` | tree-sitter クエリを直接投げて、マッチしたノードを取り出す |
| `format` | JS を整形する（minify されたものを読むため） |

`urls` の出力 JSON には典型的に `url` / `queryParams` / `bodyParams` / `method` / `headers` / `contentType` / `type` / `source` といったフィールドが含まれる。`type` は「どの文脈で見つかったか」（`fetch` なのか `location` なのか）を示し、`source` は元のコード片そのものだ。**`source` を必ず見る癖をつけること。** `EXPR` の中身が実は定数だった、というケースは `source` を読めば一目で分かる。

`secrets` の出力は、記事の記述どおり `kind`（`"bearer"`, `"jwt"`, `"aws-key"` など）と `severity`（`"low"` / `"medium"` / `"high"`）を持つ。

```bash
# 整形してから木を眺め、狙いを定めてクエリを書く、という流れ
jsluice format main.chunk.js > main.pretty.js
jsluice tree main.pretty.js | head -50
jsluice query -q '(call_expression) @matches' main.pretty.js
```

`tree` → `query` → 必要ならカスタムマッチャ、という順序が実務的に一番早い。木を見ずにクエリを書くと、ノード名（`call_expression` なのか `new_expression` なのか）を外して延々空振りする。

#### 3.2 Go パッケージとしての利用

記事が挙げている最小形はこうだ。

```go
analyzer := jsluice.NewAnalyzer(jsCode)

urls := analyzer.GetURLs()
// 各要素から URL、Context(fetch / location.href など)、HTTPメソッド、Parameters が取れる

secrets := analyzer.GetSecrets()
// Kind("bearer", "jwt", "aws-key") と Severity("low"/"medium"/"high") を返す
```

`NewAnalyzer` はバイト列を受け取り、内部で tree-sitter パースを 1 回だけ行う。`GetURLs()` と `GetSecrets()` は同じ木を再利用するので、両方呼んでもパースコストは 1 回分である。

#### 3.3 マッチャ拡張 — ここが「自社仕様」を入れる場所

jsluice の URL 抽出もシークレット抽出も、**マッチャ（matcher）ベースのアーキテクチャ**になっている。README の記述によれば、拡張手順は次の 3 ステップだ。

1. `URLMatcher` または `SecretMatcher` の構造体を作る
2. tree-sitter クエリ、または文字列マッチ関数を与える
3. `AddURLMatcher()` / `AddSecretMatcher()` で登録する

登録したマッチャには、マッチしたノードだけでなく**親オブジェクトや兄弟ノードを含む完全な文脈**が渡される。これが「孤立したマッチ（isolated match）」しか返さない正規表現との構造的な違いである。

たとえば「オブジェクトリテラルのキーが `internalApiToken` であるペア」を自社固有のシークレットとして拾いたいなら、`(pair)` ノードにマッチするクエリを書き、コールバック内でキー名を検査し、値ノードのテキストを取り出す、という形になる。キーと値は AST 上で親ノード（`pair`）を共有しているので、**「キー名で絞り込んで値を取る」が自然に書ける**。正規表現でこれを安全にやるのは（値の中にクォートやエスケープが入る可能性を考えると）かなり厳しい。

具体的な実装例はリポジトリの `/examples` ディレクトリに揃っている。自分で書く前に必ずそこを読むこと。

#### 3.4 jsluice の限界（ここを理解していないと誤った安心を得る）

記事は限界を 3 つ明示している。防御側にとってはこれが最重要である。**「jsluice で出なかった＝漏れていない」ではない。**

1. **ノイズの増加**: 複雑なアプリでは `https://cdn.example.com/EXPR/EXPR/EXPR/EXPR/file.js` のような、可変部だらけで使いどころのない結果が大量に出る。`EXPR` の個数でソートして、少ないものから見るのが実用的なトリアージになる。
2. **難読化への脆弱性**: 「If you're analyzing heavily obfuscated code...you'll need to deobfuscate first」。構文解析は **all-or-nothing** である。制御フラット化や文字列配列難読化がかかっていると、AST は取れてもそこに意味のある文字列は載っていない。先に de-obfuscate が必要になる。
3. **ランタイムの盲点**: 「If an application fetches a configuration JSON that contains API endpoints, or uses eval()...jsluice won't see those」。設定 JSON を実行時に取得してエンドポイントを組み立てるアプリ、`eval()` や `new Function()` で動的にコードを生成するアプリは、静的解析の射程外である。ここは動的解析（ブラウザを実際に動かして通信を観測する）で補うしかない。

また記事は、**tree-sitter クエリの学習曲線が急峻**であることを指摘し、カスタムマッチャを大量に書きたい場合は Semgrep が代替になり得るとしている。Semgrep も内部で構文木を扱うが、パターンを JavaScript っぽい擬似コードで書けるぶん敷居が低い。

**使いどころの整理**（記事の推奨/非推奨をそのまま要約）:

- 向く: 文字列連結やテンプレートリテラルを多用するモダン JavaScript の解析、バンドル成果物の棚卸し
- 向かない: 非 JavaScript ファイル、未 de-obfuscate の難読化コード、実行時動的ロード、そして「LinkFinder 相当の単純な抽出で十分な場面」

最後の点は重要だ。ツールは重い方が偉いわけではない。素の `.js` ソースが読める状態なら、単純なツールの方が速くて結果も読みやすい。

> 出典: bishopfox/jsluice の AST 解析解説 — https://starlog.is/articles/cybersecurity/bishopfox-jsluice
> 出典: BishopFox/jsluice README — https://github.com/BishopFox/jsluice

---

### 4. シークレット漏洩ハンティングのワークフロー

> ⚠️ **未取得の資料**: 「Hunting Sensitive Data Leaks in JavaScript — An Advanced Recon Guide」（samael0x4, Medium, 2025年8月13日公開）は自動取得できませんでした（理由: Medium 側が HTTP 403 Forbidden を返し、本文の取得がブロックされたため）。以下のURLからご自身で直接ご覧ください: https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6

検索経由で確認できた範囲では、同記事は以下の骨子を持つ。着目する漏洩カテゴリは (1) 露出したシークレット（API キー・トークン・資格情報）、(2) 隠れたエンドポイント（未公開 API・管理画面）、(3) 忘れられたパラメータ（認可バイパス・XSS・SSRF の起点になりうるもの）、(4) クラウドストレージの漏洩（設定ミスの S3 / Firebase / GCP バケット）、(5) アーカイブされた古い JS に残る過去の脆弱性。推奨ツールは、JS 発見に katana・subjs・gauplus・waybackurls・hakrawler、シークレット検出に SecretFinder・Mantra・nuclei、エンドポイント抽出に jsluice・LinkFinder、補助に ripgrep・js-beautify・Burp 拡張。手順としては、ライブクロールとアーカイブの両方から JS を収集し、**HTTP 200 のものだけに絞ってから**ローカルへダウンロードして解析する、という流れを取る。

（以下は未取得資料の補足として、一般知識に基づく解説です。）

#### 4.1 なぜ「ライブ判定してから落とす」のか

アーカイブ（Wayback Machine など）由来の URL リストは、数千〜数万件規模になることが珍しくない。そのうち現在も 200 を返すのは一部である。にもかかわらず全件を解析対象にすると、

- 既に削除済みのエンドポイントに対する誤検知レポートが大量に出る
- 解析時間が線形に膨らむ

という二重の損をする。一方で、**アーカイブにしか存在しない古い JS は「過去に漏れていた証拠」としての価値がある**ので、捨てるのではなく別トラックに置く。現行資産（200 のもの）＝いま塞ぐべきもの、アーカイブのみ＝ローテーション済みか確認すべきもの、という仕分けをするのが防御側の正しい使い方だ。

#### 4.2 source map — 最も「効く」一手

バンドルの末尾にある次の 1 行が、実務上いちばん大きな差を生む。

```js
//# sourceMappingURL=main.8f3a2b1c.js.map
```

`.map` ファイルは JSON で、次のフィールドを持つ。

| フィールド | 内容 |
|---|---|
| `version` | ソースマップ仕様のバージョン（通常 3） |
| `sources` | 元ファイルのパス一覧（例: `webpack:///./src/api/admin.ts`） |
| `sourcesContent` | **元ファイルの中身そのもの**（オプショナルだが、既定で入ることが多い） |
| `names` | minify 前の識別子名一覧 |
| `mappings` | 生成位置↔元位置の対応を VLQ Base64 で符号化したもの |

`sourcesContent` が入っていれば、**minify 前の TypeScript / JSX ソースが丸ごと復元できる**。この状態なら AST 解析すら不要で、単純な grep が最高の精度で効く。`sources` だけでもディレクトリ構造（`src/admin/`, `src/internal/` の存在）が露出する。

なぜこうなるのかというと、source map は本来「本番でエラーが出たときにスタックトレースを元ソース行に戻すため」の開発者向け機構であり、**配信を止めても機能自体は壊れない**（ブラウザは 404 を黙って無視する）。つまり安全側に倒す変更のコストがきわめて低い。

**防御策**:

- webpack なら `devtool: 'hidden-source-map'`（map を生成するが参照コメントを埋め込まない）にして、map は Sentry などのエラー追跡基盤にだけアップロードし、公開ディレクトリからは削除する
- CDN / リバースプロキシで `*.map` へのアクセスを拒否する（ただし生成物がオリジンに残っていれば直参照される可能性があるので、削除が本命）
- CI で「ビルド成果物に `.map` と `sourceMappingURL` が残っていないか」を検査する

#### 4.3 webpack チャンクの列挙

SPA は初回ロードで全チャンクを読まない。ルート遷移時に遅延ロードされるチャンク（＝管理画面など、普段見えない機能のコード）を取りこぼすと、Recon としては片手落ちになる。

webpack のランタイムには、チャンク ID からファイル名を組み立てる関数が必ず埋め込まれている。形はバージョンで変わるが、概念的には次のようになっている。

```js
// webpack 5 のランタイム（概念形）
__webpack_require__.u = (chunkId) =>
  "static/js/" + chunkId + "." + {"216":"a1b2c3d4","489":"9f8e7d6c"}[chunkId] + ".chunk.js";
```

ここで重要なのは、**チャンク ID → ハッシュの対応表がオブジェクトリテラルとして静的に埋め込まれている**という点だ。だからこの表を読めば、まだ一度もロードされていないチャンクの URL まで機械的に列挙できる。

そして、この表の抽出こそ AST 解析が光る場面である。正規表現でオブジェクトリテラルを抜こうとすると、入れ子・エスケープ・minify による改行削除に悩まされる。AST なら `object` ノードの子である `pair` ノードを列挙するだけで、キーと値が正確なペアとして取れる。`jsluice query` でクエリを書くか、`jsluice tree` で形を確認してからカスタムマッチャを書くのが定石になる。

**防御策**: チャンクの存在自体は隠せない（それが SPA の設計だから）。したがって「管理画面のコードがクライアントに配信されること」を前提に、**認可は必ずサーバ側で行う**。フロントのルーティングで管理画面を隠すことはセキュリティ制御ではない。

#### 4.4 検出した「シークレット」のトリアージ

シークレットスキャナは誤検知（false positive）を大量に出す。とくに**「公開されて当然の鍵」を高 severity で報告してくる**ことが多いので、以下の分類を頭に入れておく。

| 検出物 | 本当に秘密か | 理由 |
|---|---|---|
| Firebase `apiKey` | **秘密ではない** | プロジェクト識別子。保護は Firebase Security Rules で行う設計。ただしルールが緩ければ別問題 |
| Stripe `pk_live_...` | 秘密ではない | publishable key。`sk_live_...` が出たら**即座にローテーション対象** |
| Google Maps API key | 条件付き | HTTP リファラ制限・API 制限が掛かっていなければ課金被害につながる |
| `AKIA...` (AWS Access Key ID) | ID 部分は秘密ではない | ただし同じファイル内に 40 文字の Secret Access Key があれば重大 |
| JWT | 内容による | 期限切れのデモトークンか、長寿命のサービストークンかで天地の差 |

つまり **severity は「鍵の種類」ではなく「その鍵で何ができるか」で決まる**。jsluice の `severity` フィールドはあくまで一次トリアージの目安として扱い、最終判断は「権限スコープ・有効期限・ローテーション可能性」で行う。

なお、検出したキーの有効性を確認するために当該サービスへ実際にリクエストを送る行為は、自組織のキーであっても課金や監査ログに影響する。組織内の正規の手続き（キー管理者への照会、自社のクラウドコンソールでの確認）で判定するのが筋であり、第三者サービスへ無許可でリクエストを投げてはならない。

#### 4.5 恒久的な防御

クライアントに配信されるコードは**定義上すべて公開情報**である。この原則から、対策は自動的に導かれる。

1. **そもそも入れない**: サードパーティ API の呼び出しは自前バックエンドをプロキシにし、シークレットはサーバ側の環境変数に置く。Next.js の `NEXT_PUBLIC_` のような「公開されることが明示される接頭辞」の規約を徹底する。
2. **CI で検出する**: gitleaks / trufflehog をコミット時と**ビルド成果物**の両方に掛ける。ソースに無くても、ビルド時に環境変数が埋め込まれて成果物に入るケースがあるため、成果物側の検査が重要。
3. **前提を変える**: 鍵は必ず短命にし、スコープを最小化し、ローテーション手順を用意しておく。「漏れない」前提ではなく「漏れても被害が有限」な設計にする。
4. **定期的に自分でスキャンする**: 本節のツール群を自社ドメインに対して定期実行し、差分を監視する。攻撃者と同じ視点で自分を見ることが、いちばん確実な検出手段である。

---

### 5. JSFScan.sh — JS Recon の自動化パイプライン

KathanP19 による `JSFScan.sh` は、ここまで述べた「収集 → 生存確認 → エンドポイント抽出 → シークレット抽出 → 付随解析 → レポート」を 1 本の bash スクリプトに束ねたものである。作者自身の言葉では "Script made for all your javascript recon automation in bugbounty."

#### 5.1 機能とオプション

README が挙げる 9 つの機能と、対応するフラグは次の通り。

| フラグ | README の記述 | 実際の中身 |
|---|---|---|
| `-l` | Gather Js Files Links | `gau` と `subjs` で JS リンクを収集 |
| `-f` | Import File Containing JS Urls | 既存の JS URL リストを取り込み |
| `-e` | Gather Endpoints For JSFiles | LinkFinder でエンドポイント抽出 |
| `-s` | Find Secrets For JSFiles | SecretFinder でシークレット抽出 |
| `-m` | Fetch Js Files for manual testing | JS を整形してローカル保存 |
| `-o` | Make an Output Directory | 出力ディレクトリ指定 |
| `-w` | Make a wordlist using words from jsfiles | JS 内の語からワードリスト生成 |
| `-v` | Extract Vairables from the jsfiles | 変数名抽出（XSS 調査用） |
| `-d` | Scan for Possible DomXSS | DOM XSS 候補のスキャン |
| `-r` | Generate Scan Report in html | HTML レポート生成 |
| `--all` | Scan Everything! | 全部実行 |

#### 5.2 内部で実際に呼んでいるコマンド

スクリプト本体を読むと、各機能が何をしているかが分かる。ここが「ツールを信用するかどうか」を判断する材料になるので、必ず自分で読むこと。

```bash
# gather_js: 収集
cat "$target" | gau | grep -iE "\.js$"
cat "$target" | subjs
#   → jsfile_links.txt / live_jsfile_links.txt

# open_jsurlfile: 生存確認
cat "$target" | httpx -follow-redirects -silent -status-code
#   → live_jsfile_links.txt

# endpoint_js: エンドポイント抽出
interlace -tL live_jsfile_links.txt -threads 5 \
  -c "python3 ./tools/LinkFinder/linkfinder.py -d -i '_target_' -o cli"
#   → endpoints.txt

# secret_js: シークレット抽出
python3 ./tools/SecretFinder/SecretFinder.py -i '_target_' -o cli
#   → jslinksecret.txt
```

その他、`getjsbeautify.sh`（`jsfiles/` へ整形保存）、`getjswords.py`（`jswordlist.txt`）、`jsvar.sh`（`js_var.txt`）、`findomxss.sh`（`domxss_scan.txt`）、`report.sh`（`report.html`）が呼ばれる。

ここから読み取るべき設計上のポイント:

- **`gau` は grep で `\.js$` に絞っている**。つまり `?v=123` のようなクエリ付き JS や、拡張子なしで JS を返すエンドポイントは取りこぼす。ここは自分で補う必要がある。
- **生存確認に `httpx -follow-redirects` を使っている**。リダイレクト先が HTML のエラーページでも 200 になるため、Content-Type の確認は別途必要。
- **抽出エンジンは LinkFinder / SecretFinder（どちらも正規表現ベース）**。つまり JSFScan.sh は本節前半で述べた「正規表現の限界」をそのまま継承する。連結で組まれたエンドポイントは落ちる。
- **`interlace` で並列化している**。`-threads 5` は控えめな既定値だが、それでも対象サーバへ同時接続が発生する。自組織の本番へ流す場合でも、負荷とレート制限を事前に確認すること。

#### 5.3 導入と運用上の注意

```bash
# ローカル（Go が事前に必要）
sudo chmod +x install.sh
./install.sh

# Docker
docker build . -t jsfscan
docker run -it jsfscan "/bin/bash"
```

README が明記している注意点は 2 つ。

1. ターゲットリストは `https://` または `http://` を含む形式で与える（`httpx` / `httprobe` で事前に整形することが推奨されている）。
2. 処理を速くしたい場合は「hakrawler line at 23」をコメントアウトできるが、**JS リンクの検出量が減る可能性がある**。

運用上の追加の注意として、このツールは 2020〜2021 年頃に書かれたもので（執筆時点で star 約 1.1k / fork 188）、依存している LinkFinder・SecretFinder・gau・interlace などの外部ツールは、それぞれ独立に API やオプションが変わる。`install.sh` が正しく通らない、あるいは通っても内部コマンドがエラーになるケースは起こりうる。**Docker イメージを使うか、各ステップを自分のパイプラインに分解して取り込む**のが現実的である。

> 出典: JSFScan.sh — https://github.com/KathanP19/JSFScan.sh

---

### 6. 組み合わせ方 — 実務的なパイプライン設計

3 つの資料はそれぞれ別のレイヤを担当している。整理するとこうなる。

| レイヤ | 担当 | 代表ツール | 特性 |
|---|---|---|---|
| 収集 | JS URL を集める | gau / waybackurls / katana / subjs / hakrawler | 網羅性が命。アーカイブと現行の両方 |
| 選別 | 生きているものに絞る | httpx | Content-Type と本文サイズまで見る |
| 復元 | 読める形に戻す | source map 取得 / `jsluice format` / js-beautify | **ここで復元できれば以降が劇的に楽になる** |
| 抽出（広く浅く） | 正規表現ベース | LinkFinder / SecretFinder / nuclei | 速い。素のソースには十分 |
| 抽出（深く） | AST ベース | jsluice / Semgrep | 連結・テンプレートリテラルに強い |
| 束ね | 全部回す | JSFScan.sh | 初動の広域スキャン向け |

推奨する順序は次の通りで、理由も明確である。

1. **まず source map を探す**。見つかれば `sourcesContent` から元ソースが復元でき、AST 解析すら不要になる。最もコスト対効果が高い。
2. **次に jsluice の `urls` / `secrets` を掛ける**。バンドル成果物に対しては、ここが最も取りこぼしが少ない。
3. **並行して正規表現ベースのツールも回す**。AST 解析は構文的に壊れたファイルや難読化コードで all-or-nothing に失敗するが、正規表現はそういう場面でも断片を拾える。**両者は代替関係ではなく相補関係**である。
4. **結果を突き合わせて差分を見る**。片方にしか出ないものが、たいてい一番面白い。
5. **静的解析で出ない領域は動的解析で埋める**。実行時に設定 JSON を取りに行くアプリ、`eval()` を使うアプリは、ブラウザを動かして通信を観測しない限り見えない。

---

### 7. まとめ

- 正規表現による JS 抽出は、**バンドラが文字列を分割する**という構造的理由で取りこぼす。記事の事例では 47 本 対 312 本という差が出た。
- **AST（tree-sitter）解析**は、コードを木として理解するので「連結された URL 全体」「オブジェクトのキーと値のペア」「呼び出し文脈から推定される HTTP メソッド」を扱える。
- jsluice の中核は **`EXPR` プレースホルダ**。実行時不明の部分を潰しつつ、ホスト・パス構造・パラメータ名という確定情報を残す割り切りが効いている。
- jsluice の限界は **ノイズ・難読化・ランタイム動的ロード**の 3 つ。「出なかった＝安全」ではない。
- 実務では **source map の有無を最初に確認する**。`sourcesContent` が生きていれば元ソースが丸ごと復元でき、以降の解析難度が桁違いに下がる。裏を返せば、防御側が真っ先に塞ぐべき箇所でもある。
- **JSFScan.sh** は収集から HTML レポートまでを束ねる自動化スクリプトだが、抽出エンジンは正規表現ベース（LinkFinder / SecretFinder）である。初動の広域スキャンに使い、深掘りは jsluice に渡す、という役割分担が妥当。
- 防御の原則はただ一つ、**クライアントに配信されるコードはすべて公開情報である**。シークレットを置かない、置かざるを得ないものは短命・最小スコープにする、CI でビルド成果物を検査する、そして定期的に自分でスキャンして差分を監視する。

> 出典: bishopfox/jsluice の AST 解析解説 — https://starlog.is/articles/cybersecurity/bishopfox-jsluice
> 出典: Hunting Sensitive Data Leaks in JavaScript — An Advanced Recon Guide — https://samael0x4.medium.com/hunting-sensitive-data-leaks-in-javascript-an-advanced-recon-guide-bf989aa228e6 （※本文は自動取得不可。上記 4 章の記述は検索経由で確認できた骨子と一般知識に基づく補足）
> 出典: JSFScan.sh — https://github.com/KathanP19/JSFScan.sh
