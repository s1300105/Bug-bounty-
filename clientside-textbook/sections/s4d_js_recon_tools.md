## JSからのエンドポイント・シークレット抽出ツール

クライアントサイド脆弱性のハンティングにおいて、配信されているJavaScriptファイル自体は最も情報密度の高い偵察対象の一つである。ビルド時にminify・bundleされていても、フロントエンドは最終的にブラウザ上で平文として実行されなければならないため、APIのエンドポイントURL、内部パス、デバッグ用フラグ、そして場合によっては本来サーバーサイドに留めるべきAPIキーやトークンまでもがJSファイルの中にそのまま埋め込まれてしまうことがある。これらは攻撃対象領域（attack surface）を広げるための「隠れた入口」であり、XSSのsink（ユーザー入力が最終的に実行・解釈される危険な代入先、例えば`innerHTML`への代入や`eval()`呼び出し）を探す前段階として、まずどのエンドポイントが存在し、どのようなパラメータを受け取るのかを機械的に洗い出す作業が欠かせない。本節では、この「JS静的解析による情報抽出」を自動化する代表的な2つのツール（LinkFinder、SecretFinder）と、周辺ツールの見つけ方について解説する。

なお、本節で扱う内容はすべて防御目的、すなわち自組織が保有する資産や許可を得た対象に対する脆弱性診断・セキュリティレビューを想定している。実在の第三者サービスや本番環境に対する無許可の走査・検証は行ってはならない。

### なぜJSファイルにエンドポイントやシークレットが漏れるのか（仕組みの原理）

現代のSPA（Single Page Application）は、React/Vue/Angularなどのフレームワークでビルドされ、Webpack・Vite・Rollupといったバンドラによって複数のソースファイルが1つ、あるいは少数の`.js`ファイルに結合される。このビルドプロセスは「難読化（obfuscation）」ではなく「圧縮（minification）」に過ぎない場合が多く、変数名は`a`や`t`のように短縮されても、文字列リテラル――すなわちAPIのベースURL、パスパターン、環境変数から埋め込まれたキーなど――はほぼそのまま残る。これは、JavaScriptエンジン（V8など）が実行時にreflectionや文字列連結でURLやキーを組み立てるコードを解釈する必要があるためであり、コンパイル型言語のように定数をバイナリのシンボルテーブルへ隠すことができない、という言語仕様上の制約に起因する。

さらに、`.env`ファイルの内容をビルド時にバンドルへインライン化するツール（`dotenv-webpack`や`create-react-app`の`REACT_APP_`プレフィックス変数など）を誤って設定すると、本来サーバーサイドのみに存在すべき秘密鍵がクライアントバンドルへ焼き込まれてしまう事故が起きる。これはツールの脆弱性ではなく設定ミスだが、攻撃者（および防御側の診断者）から見れば「JSファイルをテキストとして正規表現でスキャンするだけで機密情報が取れる」という非常にコストの低い偵察手段になる。LinkFinderやSecretFinderはこの原理を利用し、正規表現とJavaScript構文の軽量な整形（beautify）を組み合わせて、人間が目視するには非現実的な量のミニファイ済みコードから機械的にパターンを抽出する。

### LinkFinderによるエンドポイント抽出

#### 目的と位置づけ

LinkFinder（GerbenJavado作）は、JavaScriptファイルの中に隠れているエンドポイントとそのパラメータを発見するために設計されたPython製スクリプトである。ペネトレーションテスターやバグバウンティハンターが、対象アプリケーションの「まだ見つかっていない」APIエンドポイントを洗い出す目的で広く使われてきた、この分野の草分け的ツールである。

> 出典: LinkFinder README — https://github.com/GerbenJavado/LinkFinder

#### 仕組み

LinkFinderは`jsbeautifier`ライブラリでミニファイされたJSを整形しつつ、大規模な正規表現（複数の小さなパターンを`|`で結合したもの）でURLやパスらしき文字列リテラルを走査する。抽出対象は次の4パターンに大別される。

1. 完全な絶対URL（`https://example.com/api/...`のようにスキームを含むもの）
2. ドット表記を含む絶対/相対URL（`/api/v1/...`や`../assets/...`）
3. 少なくとも1つのスラッシュを含む相対パス（`text/test.php`）
4. スラッシュを含まない単純な相対パス（`test.php`）

この段階的なパターン分割が重要な理由は、単一の巨大な正規表現でURLらしきものを一括りに拾おうとすると、CSSのクラス名や単なる文字列比較（例：`if (a === "error")`）まで大量に誤検出（false positive）してしまうためである。パターンを「スキームあり／ドット付きパス／スラッシュ付き相対パス／単純ファイル名」の階層で分けることで、後段のフィルタリング（`-r`オプションによる正規表現絞り込み）と組み合わせてノイズを抑えられる設計になっている。

#### インストール

```bash
git clone https://github.com/GerbenJavado/LinkFinder.git
cd LinkFinder
python setup.py install
pip3 install -r requirements.txt
```

Python 3系での動作を前提としており、依存モジュールは`argparse`と`jsbeautifier`のみと軽量だが、READMEの記述時点（Python 3系サポート明記）以降にリリースされたPythonのマイナーバージョンでは、`setup.py install`を使う古いインストール手順自体がPython 3.12以降で非推奨（`distutils`廃止の影響）となっているため、環境によっては`pip install .`や仮想環境（`venv`）を使った代替インストールが必要になる点に注意が必要である。これはツール自体の欠陥ではなく、Pythonエコシステムの世代交代によって古いツールほどセットアップで詰まりやすい、という一般的な傾向の一例である。

#### 使い方

```bash
# 単一のJSファイルをHTMLレポートに出力
python linkfinder.py -i https://example.com/1.js -o results.html

# CLI（標準出力）にそのまま出す
python linkfinder.py -i https://example.com/1.js -o cli

# ドメイン全体をクロールして参照されているJSをまとめて解析
python linkfinder.py -i https://example.com -d

# Burp Suiteでエクスポートしたトラフィックファイルを入力にする
python linkfinder.py -i burpfile -b

# ローカルのJSファイル群から /api/ で始まるパスだけ抽出
python linkfinder.py -i 'Desktop/*.js' -r ^/api/ -o results.html
```

主なオプションは以下の通り。

| オプション | 説明 |
|---|---|
| `-i` / `--input` | 入力（単一URL、ローカルファイル、ワイルドカード付きフォルダ、Burpファイル） |
| `-o` / `--output` | 出力先。省略時は`output.html`、`cli`指定で標準出力 |
| `-r` / `--regex` | 抽出結果をさらに絞り込むための正規表現フィルタ |
| `-d` / `--domain` | 指定ドメイン配下を丸ごと解析する再帰モード |
| `-b` / `--burp` | Burp Suiteのエクスポートファイルを入力として扱う |
| `-c` / `--cookies` | 認証が必要なJS取得のためにクッキーを付与 |

> 出典: LinkFinder README — https://github.com/GerbenJavado/LinkFinder

#### 防御的な観点での使いどころ

診断者側の立場では、自組織のフロントエンドバンドルに対してLinkFinderを走らせ、「意図せず露出しているinternal API」「デバッグ用/テスト用に残されたエンドポイント（`/admin/debug`など）」を洗い出し、アクセス制御や認可（authorization）の観点で本当に公開してよい設計になっているかをレビューする、という使い方が中心になる。抽出結果はあくまで「候補」であり、実在性や到達可能性は許可を得た環境で個別に確認する必要がある。

### SecretFinderによるシークレット検出

#### 目的と仕組み

SecretFinder（m4ll0k作）はLinkFinderをベースに派生した、JavaScriptファイル中の機密情報――APIキー、アクセストークン、認可ヘッダ、JWT（JSON Web Token）など――を発見するために書かれたPythonスクリプトである。LinkFinderと同じく`jsbeautifier`による整形と正規表現マッチングを組み合わせているが、URLパターンではなく「機密情報らしい文字列の形」を検出するための、サービスごとに個別化された正規表現群を持つ点が異なる。

> 出典: SecretFinder README — https://github.com/m4ll0k/SecretFinder

対応するシークレットの種類は多岐にわたり、代表的なものは次の通りである。

- Google API キー / Google Captcha キー / Google OAuth トークン
- Amazon AWS アクセスキー、AWS MWS（Marketplace Web Service）認証トークン
- Facebook アクセストークン
- Mailgun API キー、Twilio API キー
- PayPal Braintree、Square、Stripe の認証情報
- GitHub アクセストークン
- RSA / DSA / EC 秘密鍵、PGP秘密鍵ブロック（`-----BEGIN ... PRIVATE KEY-----`のようなPEM形式のヘッダ文字列を検出の起点にする）
- JWT（`eyJ`で始まるBase64URLエンコードされた3パート構造を検出）

これらの多くは「サービス固有のプレフィックス＋固定長の英数字」という形式的特徴を持つため、正規表現による検出と非常に相性が良い。例えばAWSのアクセスキーIDは`AKIA`で始まる20文字の英数字という固定フォーマットを持ち、Google APIキーは`AIza`で始まる39文字という具合に、各ベンダーがキー発行時に埋め込む識別用プレフィックスが、皮肉にも検出側にとっての強力なシグネチャになっている。JWTについても、ヘッダ部（`{"alg":"HS256","typ":"JWT"}`など）をBase64URLエンコードすると必ず`eyJ`という3文字から始まるという構造的な性質を利用している。

#### インストールと使い方

```bash
git clone https://github.com/m4ll0k/SecretFinder.git secretfinder
cd secretfinder
python -m pip install -r requirements.txt
```

```bash
# 単一ファイルを解析してHTMLレポートに出力
python3 SecretFinder.py -i https://example.com/1.js -o results.html

# 標準出力にそのまま結果を出す
python3 SecretFinder.py -i https://example.com/1.js -o cli

# ページ内で参照されているJSリンクを自動抽出して丸ごと解析（-eオプション）
python3 SecretFinder.py -i https://example.com/ -e

# 独自の正規表現を追加して特定パターンだけ拾う
python3 SecretFinder.py -i https://example.com/1.js -r 'apikey=my.api.key[a-zA-Z]+'
```

主なオプション一覧。

| オプション | 説明 |
|---|---|
| `-i INPUT` | 入力URL・ファイル・フォルダ |
| `-e` | ページ内のJavaScriptリンクを抽出して連鎖的に処理する |
| `-o OUTPUT` | 出力先（デフォルト`output.html`、`cli`で標準出力） |
| `-r REGEX` | 抽出をカスタム正規表現で絞り込み |
| `-b` | Burp Suiteエクスポートファイルへの対応 |
| `-c COOKIE` | 認証用クッキーの付与 |
| `-g IGNORE` | 指定文字列を含むJSファイルを除外 |
| `-n ONLY` | 指定文字列を含むJSファイルのみ処理 |
| `-H HEADERS` | カスタムHTTPヘッダーの付与 |
| `-p PROXY` | プロキシ経由でのリクエスト（Burp等での中継確認に有用） |

> 出典: SecretFinder README — https://github.com/m4ll0k/SecretFinder

#### 検出後の扱いに関する注意（防御目的の運用）

SecretFinderが「シークレットらしき文字列」を検出しても、それが本当に有効な（revokeされていない）認証情報かどうかは別問題である。自組織の診断であっても、検出したキーをそのまま外部APIに投げて有効性を確認する行為は、対象サービスの利用規約や倫理的な境界を踏み越える可能性があるため、まずは「このキーがクライアントに露出していること自体が設計上の問題である」という観点で報告し、キーのローテーション（無効化・再発行）を担当チームに促す、という防御的な運用が基本になる。またクライアントサイドに秘密鍵を置く設計そのものが誤りであり、根本対策は「サーバーサイドプロキシ経由でAPIを呼び出す」「公開しても問題のないスコープに制限されたキーのみをクライアントに渡す」というアーキテクチャ変更である。

### 周辺ツールの探し方：awesome-bugbounty-toolsとメンテナンス状況の確認

LinkFinderとSecretFinderはいずれも開発が比較的落ち着いている（≒更新頻度が低い）プロジェクトであり、Python 2系時代の設計を引きずっている部分もあるため、実運用では後継・類似ツールもあわせて把握しておく価値がある。vavkamil氏がまとめているキュレーションリスト「awesome-bugbounty-tools」には、JS解析・エンドポイント抽出・シークレット検出のカテゴリに複数のツールが列挙されている。

- **jsluice**（Go製）: 「JavaScriptファイルからURL、パス、シークレット、その他の興味深い情報を抽出する」ツールとして紹介されており、Goで書かれているためPythonのような依存関係地獄（`jsbeautifier`のバージョン不整合など）が起きにくく、近年の後継候補として言及されることが多い。
- **jsleak**: JavaScriptやソースコードからシークレット・パス・リンクを検出する類似ツール。
- **jsfinder**: HTMLソースコード中にリンクされたJavaScriptファイルのURLをスキャンする、収集フェーズに特化したツール。
- **gitleaks / truffleHog**: JS内ではなくGitリポジトリのコミット履歴に対してシークレットを検出するツールであり、対象がクライアントJSではなくソース管理システムである点でLinkFinder/SecretFinderと役割が異なるが、「シークレットの偶発的なコミット」という同根の問題に対応する。

> 出典: awesome-bugbounty-tools — https://github.com/vavkamil/awesome-bugbounty-tools

このリスト自体からは、各ツールの明示的な「メンテナンス状況（最終更新日やアーカイブ有無）を確認する方法」についての直接的な記述は得られなかった。実務上は、リストに掲載されたGitHubリンクを開き、各リポジトリの「最終コミット日時」「Issuesの放置状況」「Archivedバッジの有無」を確認することが、ツールを選定する際の標準的なチェック方法になる。LinkFinder・SecretFinderのようにPython 2系文化を引きずったツールを2026年時点で使う場合は、事前に`venv`で隔離した環境を用意し、`requirements.txt`のバージョン固定が古いことによる依存関係エラー（特に`jsbeautifier`や`chardet`まわり）に備えておくとよい。

### まとめ：JS偵察ツールを使う際の実務フロー

1. 対象アプリケーション（許可を得た範囲）のHTMLから参照されている全JSファイル（インライン・外部の両方、`.map`ソースマップの有無も含む）を列挙する。
2. LinkFinderで隠れたエンドポイント候補を抽出し、`-r`オプションで社内APIらしきパス（`/internal/`、`/admin/`、`/v2/`など）を優先的にフィルタする。
3. SecretFinderで同じJS群を走査し、APIキー・トークンらしき文字列を検出する。検出結果は「有効性の検証」ではなく「そもそもクライアントに露出していること」自体を問題として扱う。
4. 抽出したエンドポイントは、認可制御（IDOR、権限昇格の可能性）やXSSのsinkとの接続関係（例：URLパラメータがそのままDOMに書き込まれていないか）を調べる次工程への入力として使う。
5. ツール自体がPython 2系由来で環境依存が強い場合は、Go製の後継（jsluiceなど）や、`node`ベースの静的解析（AST解析によるsink検出）と併用し、正規表現ベースの手法だけに依存しない多層的な偵察を行う。

このように、LinkFinder・SecretFinderは「JSを文字列としてスキャンする」という単純だが強力な原理に基づいており、ビルドツールの仕組みとJavaScriptの言語特性（文字列リテラルが実行時までそのまま残る）を理解していれば、なぜこの手法が有効なのかが腑に落ちるはずである。
