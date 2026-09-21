## GitHub/JS/.envからのAWSキー漏洩Recon

クラウド環境への侵入経路として最も再現性が高く、かつ検知が難しいのが「コード自体に埋め込まれた認証情報」の漏洩である。攻撃者はポートスキャンや脆弱性診断を一切行わずに、GitHub上の公開リポジトリ、npmパッケージ、公開JavaScriptバンドル、`.env`ファイルの取り残しといった「人為的ミス」だけを起点にAWSアカウントを乗っ取ることができる。本節では、GitHub dork（検索演算子を組み合わせた特定条件の高度検索クエリ）を使った偵察から、発見した鍵の正当性検証、そして実際にAWS APIで権限を確認するまでの一連の流れを、原典の具体例に沿って解説する。目的はあくまで防御側の視点であり、実在サービスへの無許可の鍵検証や破壊的操作は行わない前提で読み進めてほしい。

### なぜGitHubがクラウド侵害の起点になるのか

AWSのアクセスキーは `Access Key ID`（公開識別子、`AKIA`または`ASIA`で始まる20文字の英数字）と `Secret Access Key`（40文字のBase64相当文字列）のペアで構成される。これらは本来、環境変数やIAMロール、Secrets Manager等の安全な仕組みで管理されるべきだが、開発者が動作確認や社内共有のためにソースコードへ直書きし、そのままGitにコミットしてしまうケースが後を絶たない。Gitは変更履歴を保持する仕組みであるため、たとえ後から`git rm`や`.gitignore`への追加で鍵を「削除」しても、コミット履歴（`git log`やpackfile内）にはそのまま残り続ける。これはGitの内部実装が「差分」ではなく「各コミット時点のスナップショット」をオブジェクトとして保存するためで、あるコミットで追加された文字列は、そのオブジェクトが履歴から完全に削除（BFG Repo-CleanerやGit filter-repoでの書き換え、かつ全フォーク・全クローンへの反映）されない限り、`git log -p`やGitHubの検索インデックスから発見可能なままである。ここが「なぜGitHub reconが刺さるのか」という原理の核心であり、単に最新のファイルを見るだけでは不十分な理由でもある。

### GitHub Dorkによる能動的探索

Appsecco「Finding Treasures in Github and Exploiting AWS for Fun and Profit」は、GitHubの検索構文（`filename:`、`extension:`、`org:`、`user:`などの修飾子）を組み合わせて、認証情報が含まれていそうなファイルやキーワードを直接検索する手法を実演している。代表的なクエリは次の通りである。

```
filename:credentials aws_access_key_id
"token" "AQoDY"
"rds.amazonaws.com"
filename:credentials AWS_ACCESS_KEY_ID
```

1つ目は、AWS CLIの認証情報ファイル（`~/.aws/credentials`）がそのままコミットされているケースを狙うもので、`filename:credentials`でファイル名を絞り込み、`aws_access_key_id`というキー名そのものをキーワードにすることでヒット率を上げている。2つ目の`"AQoDY"`は、AWSのSTS（Security Token Service：一時的な認証情報を発行するサービス）が発行するセッショントークンの先頭に現れる典型的なパターンで、一時クレデンシャルの漏洩を狙う。3つ目の`"rds.amazonaws.com"`はRDS（マネージドデータベース）のエンドポイントを直接検索し、接続文字列ごとDB認証情報が漏れているケースを発見する狙いである。これらのdorkに共通するのは、「サービス固有の命名規則やエンドポイントのドメインサフィックス」を手がかりにする点で、汎用的な"password"のようなキーワードよりもノイズが少なく高精度に絞り込める。

コミュニティ側の関連記事（InfoSec Write-ups系「GitHub Recon: The Underrated Technique」、原典が403で直接取得できなかったため同内容を扱うミラー記事から要点を補足。詳細は後述の注記を参照）でも同様の考え方で、次のような組織単位のdorkが紹介されている。

```
org:examplecorp filename:.env
org:examplecorp filename:config extension:json
org:examplecorp "password"
org:examplecorp "api_key"
user:devjohn filename:config
filename:.env org:examplecorp
filename:docker-compose.yml password
site:gist.github.com "AWS_SECRET"
```

`org:`修飾子で対象組織のリポジトリ群に絞り込み、`.env`（環境変数定義ファイル）や`docker-compose.yml`（コンテナのポート・環境変数定義）のようにクレデンシャルが書かれやすいファイル種別と組み合わせることで、探索範囲を対象企業に限定しながら効率よく走査できる。さらに、`site:gist.github.com`はGitHub本体の検索から漏れがちなGist（個人が手軽に共有する短いコードスニペット）を対象にしており、開発者が「ちょっとしたメモ」のつもりで貼り付けたトークンが発見される典型的な経路である。また、削除されたはずの機密情報がフォークや非mainブランチには残り続ける点も指摘されており、`main`ブランチだけでなく全ブランチ・全フォークを横断的に確認する重要性が強調されている。

> ⚠️ **未取得の資料**: 「GitHub Recon: The Underrated Technique to Discover High-Impact Leaks in Bug Bounty」（infosecwriteups.com）は直接取得を試みましたが、サーバーからHTTP 403 Forbiddenが返され自動取得できませんでした。代替として同内容を扱う派生記事（codelivly.com）から要点を補足抽出しましたが、正確な原文表現や著者の意図を完全に反映していない可能性があります。以下のURLからご自身で直接ご覧ください: https://infosecwriteups.com/github-recon-the-underrated-technique-to-discover-high-impact-leaks-in-bug-bounty-c4069894389a
>
> （以下は未取得資料の補足として一般知識に基づく解説です）実務では、GitHubのWeb UI検索に加えて`gh api`やGitHub Code Search APIを使ったスクリプト化、GitHub Actionsのワークフローログ（環境変数がマスクされずにログに出力されるケース）の確認、npmやPyPIに公開されたパッケージ内の`.env.example`が実は本物の値になっているミスなども、実務上の高頻度パターンとして知られている。

> 出典: Appsecco「Finding Treasures in Github and Exploiting AWS for Fun and Profit — Part 1」— https://appsecco.com/blog/finding-treasures-in-github-and-exploiting-aws-for-fun-and-profit-part-1（元URL: https://blog.appsecco.com/finding-treasures-in-github-and-exploiting-aws-for-fun-and-profit-part-1-be5cfadf942 は301リダイレクト）
> 出典: InfoSec Write-ups「GitHub Recon: The Underrated Technique to Discover High-Impact Leaks in Bug Bounty」— https://infosecwriteups.com/github-recon-the-underrated-technique-to-discover-high-impact-leaks-in-bug-bounty-c4069894389a （直接取得不可、上記注記の派生記事経由で補足）

### 自動スキャンツールによる網羅的検出

手動dorkは特定の想定パターンにしか対応できないため、実務ではリポジトリ全体（コミット履歴含む）を機械的に走査するツールが併用される。代表的なのが **TruffleHog** で、Appsecco記事では次のように単純なリポジトリ指定でスキャンできることが示されている。

```
./trufflehog git https://github.com/NAME/REPO
```

TruffleHogは正規表現ベースの既知シークレットパターンに加え、初期バージョンでは文字列のシャノンエントロピー（情報のランダム性を数値化した指標）を計算し、ランダム性の高い文字列＝鍵やトークンらしき文字列を検出するアプローチを採っていた。これは「意味のある英単語」よりも「ランダムな英数字列」の方がエントロピーが高くなるという情報理論上の性質を利用したもので、パターンが未知の秘密情報でも検出できる利点がある一方、Base64エンコードされた通常データなどを誤検知しやすい欠点もある。現行のTruffleHog（v3系）は組織単位・Docker イメージ単位のスキャンにも対応しており、次のような呼び出し例が確認できる。

```
docker run --rm -it -v "$PWD:/pwd" trufflesecurity/trufflehog:latest github --org=trufflesecurity
docker run --rm -it -v "$PWD:/pwd" trufflesecurity/trufflehog:latest docker --image trufflesecurity/secrets
```

PayloadsAllTheThings「API Key and Token Leaks」ページでは、他にも次のツールが紹介されている。

- **Gitleaks**: コミット履歴を対象に正規表現ベースでシークレットを検出するツール。CIパイプラインへの組み込みや、後述するpre-commitフックとしての利用が一般的。
- **Trivy**（Aqua Security製）: 元々はコンテナイメージの脆弱性スキャナだが、シークレット検出機能も統合されている。
- **KeyFinder**: ブラウザ上で動作する鍵探索ツールで、Webページやスクリプトから直接シークレットを探す用途に向く。
- **BadSecrets**: 既知の弱い・デフォルトのシークレット（フレームワークのサンプル鍵など）をデータベース化したライブラリ。

これらのツールは検出対象・検出方式（正規表現／エントロピー／既知値データベース）がそれぞれ異なるため、実務のレッドチームやバグバウンティハンターは複数ツールを組み合わせて相互補完的に運用することが多い。

### 見つかった鍵の形式判定と正当性検証（keyhacks）

GitHub上で文字列を見つけただけでは、それが「本物の有効な鍵」なのか「サンプルコードやテスト用のダミー値」なのかは判別できない。PayloadsAllTheThingsはAWSアクセスキーの識別パターンとして次の正規表現を示している。

```
AKIA[0-9A-Z]{16}
```

`AKIA`という4文字のプレフィックスは、長期利用を前提とするIAMユーザーの永続アクセスキーであることを示す識別子であり、これに続く16文字の英数字と合わせて計20文字のフォーマットになる（なお、STSが発行する一時的なアクセスキーは`ASIA`から始まり、これはセッショントークンとセットでしか機能しないため単独で漏洩しても有効期限内でのみ悪用可能という違いがある）。この固定プレフィックス構造のおかげで、単純な正規表現マッチだけで高い確度の一次スクリーニングが可能になる。

見つかった鍵が実際に有効かどうかを確認する際、PayloadsAllTheThingsは`streaak/keyhacks`リポジトリを「バグバウンティプログラムで漏洩したAPIキーが有効かどうかを手早く確認する方法集」として参照している。例えばTelegram Botトークンであれば次のように確認できるとされる。

```
curl https://api.telegram.org/bot<TOKEN>/getMe
```

このように、各サービスが提供する「読み取り専用かつ副作用のないエンドポイント」（自分自身の情報を返すだけのAPI）を使って検証するのが基本原則であり、AWSの文脈では後述する`sts get-caller-identity`が同じ役割を担う。防御目的で鍵の有効性を検証する場合でも、対象が自組織の管理下にあるものに限定し、書き込み系・削除系のAPIには決して触れないことが鉄則である。

### AWS APIによる権限確認（防御・検知の観点から）

Appsecco記事では、漏洩したクレデンシャルをAWS CLIのプロファイルとして登録し、権限範囲を確認する流れが示されている。

```
aws configure --profile stolencreds
```

このコマンドはAccess Key ID・Secret Access Key・デフォルトリージョン・出力形式を対話的に入力させ、`~/.aws/credentials`に名前付きプロファイルとして保存する。以降、`--profile stolencreds`を付けて各種AWS CLIコマンドを実行すれば、そのクレデンシャルの権限内で操作できる。記事では、権限の全体像を効率よく把握するためのツールとして`weirdAAL`（AWS Attack Libraryの略で、多数のAPI呼び出しを自動実行して「どのサービスにどこまでアクセスできるか」を棚卸しするツール）を用い、まず読み取り系（Get/Describe系）のAPI呼び出しから始めることが紹介されている。読み取り系から始める理由は、書き込み・削除系APIより検知されにくく、かつIAMポリシー次第では読み取りだけでも機密情報（バックアップの中身、ネットワーク構成、他アカウントとの共有関係）にアクセスできてしまうためである。

具体例としてEBSスナップショット（EC2インスタンスのディスクイメージのバックアップ）の列挙が挙げられている。

```
aws ec2 describe-snapshots --region <REGION> --profile stolencreds
aws ec2 describe-snapshots --region <REGION> --owner-id <ACCOUNT_ID>
aws ec2 describe-snapshots --snapshot-ids <snapshot-id-here>
```

スナップショットは、作成者が誤って「Public」に共有設定してしまうことがあり、`--owner-id`で対象アカウントを指定して一覧を取得したうえで、各スナップショットの共有属性（`describe-snapshot-attribute`）を確認することで、意図せず公開されているバックアップを発見できる。これが公開されていれば、攻撃者は自分のアカウントに当該スナップショットをコピーし、そこからボリュームを復元してディスク内のデータ（設定ファイル、DBファイル、さらなる認証情報）を直接読み取ることが可能になる。記事はこの一連の権限列挙について「Get系・Describe系のAPI呼び出しはノイズが多くなりがちである（"permission enumeration are bound to be noisy"）」と述べており、これは裏を返せば防御側にとって「異常なDescribe/List系APIの連続呼び出しはCloudTrailで検知しうる」という重要な示唆でもある。実際、GuardDutyやCloudTrail Insightsは、見慣れないIPアドレスやリージョンからの短時間・大量のAPI列挙をアノマリとして検知する仕組みを持っている。

なお、これらのコマンド例はあくまで「攻撃者がどのような手順を踏むか」を理解し、自組織のクレデンシャル管理・監視体制を点検するための知識として引用しており、本教科書では第三者の環境や実在サービスに対してこれらを無許可で実行することは一切推奨しない。

### JS/.envファイルからの漏洩とフロントエンド特有の注意点

Webフロントエンドのビルド成果物（バンドルされたJavaScript）は、ブラウザに配信される都合上「誰でも閲覧可能」という性質を持つ。ここに環境変数やAPIキーが埋め込まれるのは、多くの場合、開発者が`.env`ファイルに定義した値をビルドツール（webpack、Vite、Create React Appなど）が`process.env.XXX`のような形でソースコードへ静的に埋め込んでしまうためである。この仕組みの本質は、サーバーサイドの環境変数とクライアントサイドに公開してよい設定値の区別がビルド設定上曖昧になりやすい点にある。例えばCreate React Appでは`REACT_APP_`というプレフィックスが付いた環境変数だけがバンドルに含まれる設計になっているが、この命名規則を誤解し、本来サーバー側だけで使うべきAWSのシークレットキーにまで同じプレフィックスを付けてしまうミスが実際に発生する。

`.env`ファイル自体がリポジトリに誤ってコミットされるケースに加え、`.env.production`や`.env.local`といったバリエーションファイルが`.gitignore`の記述漏れですり抜けるケースも典型的である。防御側の対策としては、`.gitignore`にワイルドカード（`.env*`）で環境変数ファイル全般を除外設定すること、ビルド成果物中のシークレット混入をCI上でgitleaksやtruffleHogのようなスキャナで検査すること、そしてそもそもクライアントに配信されるコードには「漏れても実害のない」公開可能な値（公開APIキーやCDNのエンドポイントなど）のみを含め、秘密情報はサーバーサイドのプロキシ経由でのみ利用する設計にすることが挙げられる。

### 防御策のまとめ

原典3資料を踏まえた実務上の防御策は次の通りである。第一に、コミット前にシークレット検出フックを組み込むことが最も費用対効果が高い。PayloadsAllTheThingsは`.pre-commit-config.yaml`（pre-commitフレームワークの設定ファイル、バージョン3.2.0時点のフック定義を例示）を使い、AWSクレデンシアルや秘密鍵のパターンをコミット直前に検査する運用を推奨している。第二に、リポジトリ全体・全ブランチ・全フォークに対する定期的なgitleaks/TruffleHogスキャンをCIに組み込み、過去に混入した秘密情報も含めて継続的に監査する。第三に、万一鍵が漏洩した場合に備え、IAMユーザーの長期アクセスキーそのものの発行を極力避け、IAMロールとSTSによる一時クレデンシャル、またはOIDC連携（GitHub ActionsからAWSへのフェデレーション認証など）に置き換えることで、「漏れても長期間悪用され続けるリスク」自体を構造的に減らすことができる。第四に、CloudTrailとGuardDutyを有効化し、見慣れないIPやリージョンからのDescribe/List系APIの急増、およびIAMユーザーの初回利用（初めて使われたアクセスキー）をアラート対象に設定しておくことで、たとえ鍵が漏洩しても悪用を早期に検知できる体制を整えることが望ましい。
