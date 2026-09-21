## CloudGoat（意図的脆弱AWS環境）

### この節で学ぶこと

CloudGoatは、Rhino Security Labsが公開している「意図的に脆弱な設計（vulnerable-by-design）」のAWS学習環境構築ツールです。本物のAWSアカウント上にTerraformで実際のリソース（EC2、IAM、S3、RDS、Lambda、ECSなど）を展開し、実際のクラウドAPIやメタデータサービスを相手にした攻撃演習ができる点が、静的なCTF問題との最大の違いです。防御側の視点で見れば、CloudGoatは「攻撃者がクラウド環境に対して実際にどのような順序で偵察・権限昇格・データ窃取を行うか」を安全な自分専用アカウント内で体験し、検知ルールやIAM設計のレビューに活かすための教材と位置づけられます。

> 出典: CloudGoat — Rhino Security Labs — https://github.com/RhinoSecurityLabs/cloudgoat

### アーキテクチャとインストール

CloudGoatはPython製のCLIツールで、内部でTerraformを呼び出してクラウドリソースをプロビジョニングします。現行版（CloudGoat 2系）は次のような要件を持ちます。

- Python 3.9以上
- Terraform 1.5.0以上（`$PATH`上に配置されている必要がある）
- AWS CLI（AWSシナリオ用）／Azure CLI（Azureシナリオ用）
- `jq`（JSON整形用）

インストールは`pipx`経由が推奨されています。

```bash
pipx install cloudgoat
cloudgoat config aws        # AWSプロファイル設定
cloudgoat config whitelist --auto  # 自分のグローバルIPを自動検出してホワイトリスト登録
```

「なぜホワイトリストが必要か」という点が重要です。CloudGoatが展開するEC2インスタンスのセキュリティグループやRDSのアクセス制御は、実習者自身のIPアドレスからのみ許可されるよう設計されています。これは、意図的に脆弱なAWS環境をインターネット全体に公開してしまい、第三者に悪用される事故を防ぐための安全弁です。`config.yml`にAWS/Azureの認証情報が、`whitelist.txt`に許可IPが保存され、シナリオ展開時にTerraformの変数として注入されます。

Dockerイメージも提供されており、ローカル環境を汚さずに試すことができます。

```bash
docker run -it -v ~/.aws:/root/.aws/ rhinosecuritylabs/cloudgoat:latest
```

自分のAWS認証情報ディレクトリ（`~/.aws`）をコンテナにマウントすることで、コンテナ内のCloudGoat CLIがホストの認証情報を使ってTerraformを実行できます。

> 出典: CloudGoat — Rhino Security Labs — https://github.com/RhinoSecurityLabs/cloudgoat

### コマンド体系

CloudGoatのコマンドは `cloudgoat [command] [sub-command] [--arg-name] [arg-value]` という統一構造を持ちます。中心となるのは次の5つです。

| コマンド | 役割 |
|---|---|
| `create` | 指定したシナリオのリソースをクラウド上に実際にデプロイする |
| `list` | シナリオ一覧を表示（`all`/`undeployed`/`deployed`でフィルタ、クラウド別フィルタも可） |
| `destroy` | デプロイ済みシナリオのリソースを削除し、シナリオフォルダを`./trash`へ退避 |
| `config` | IPホワイトリスト、AWS/Azureプロファイル、シェル補完の設定 |
| `help` | 文脈に応じたヘルプ（例: `cloudgoat create help`） |

```bash
cloudgoat create rce_web_app --profile my-aws-profile
# ...演習後...
cloudgoat destroy rce_web_app
```

ここで押さえるべき設計思想は、**`create`が既存の同名シナリオを検出すると自動的に破棄してから再構築する**という挙動です。これにより「前回の状態が中途半端に残っていて攻撃が再現できない」という事故を防ぎつつ、常にクリーンな状態から演習を始められます。ただし、シナリオ実行中に受講者自身が作成したリソース（例: SSHキーペアをAWS上に登録した、S3に追加オブジェクトをアップロードしたなど）はCloudGoat管理外のため`destroy`では削除されず、手動での後始末が必要な点は運用上の注意点です。

> 出典: CloudGoat — Rhino Security Labs — https://github.com/RhinoSecurityLabs/cloudgoat

### CloudGoat 2 で刷新された設計思想

初代CloudGoatは単一の大きな脆弱環境を提供する形でしたが、CloudGoat 2では「シナリオ単位で独立したTerraformモジュールを持つ」設計に全面刷新されました。各シナリオはそれぞれ専用のディレクトリに`main.tf`などのTerraform定義、`start.txt`（開始時のヒント）、`cleanup.sh`（追加リソースの後始末補助）、READMEを持ち、他のシナリオと状態を共有しません。

この刷新が防御学習の観点で重要なのは、**1つのシナリオが1つの明確な攻撃ストーリー（多くは「初期アクセス→権限列挙→権限昇格→機密データ到達」という連鎖）を体現する**ように設計されている点です。難易度はEasy／Medium／Hardに分類されており、たとえば以下のような構成です。

- Easy: `iam_enum_basics`（IAM列挙の基礎）、`iam_privesc_by_rollback`（IAMポリシーバージョンのロールバックを悪用した昇格）、`iam_privesc_by_key_rotation`（キーローテーション権限の悪用）
- Medium: `ec2_ssrf`（EC2上のWebアプリのSSRFからインスタンスメタデータ経由でIAM認証情報を窃取）、`codebuild_secrets`（CodeBuild/SSMパラメータストアからのシークレット窃取）
- Hard: `rce_web_app`（Webアプリのコマンド実行からクラウド全体への侵入）など、複数の昇格経路を持つ複合シナリオ

各シナリオは「攻撃者が実際の侵入テストで遭遇した設定ミスのパターン」をモデルにしており、Rhino Security Labsは新規シナリオの提案・実装をコミュニティにも呼びかけています。

> 出典: CloudGoat 2: The New & Improved "Vulnerable by Design" AWS Deployment Tool — Rhino Security Labs — https://rhinosecuritylabs.com/aws/introducing-cloudgoat-2/

### ウォークスルー: `rce_web_app` シナリオに見る「Web侵害からクラウド侵害への連鎖」

`rce_web_app`は、Webアプリケーションの脆弱性がどのようにクラウド基盤全体の侵害に発展するかを示す代表的なシナリオです。このシナリオは2つの独立した攻撃経路（"Lara"パスと"McDuck"パス）が用意されており、最終的に同じゴールへ収束する構成になっています。防御側として重要なのは、**入口となる脆弱性の種類が違っても、着地点（IAMロールの権限昇格とデータ窃取）が同じになる**という点です。これはクラウド環境では「境界防御を1つ破られただけで、内部のIAM設計次第では致命傷になる」ことを示しています。

**Laraパス（Webアプリ経由）**

まず偵察として、公開されているロードバランサーのアクセスログをS3バケットから取得します。

```bash
aws s3 cp s3://<lb-logs-bucket>/... .
```

ログを解析すると、ロードバランサー配下に隠しパス（秘密のURL）を持つWebアプリケーションが存在することが分かり、そこにアクセスするとコマンドインジェクションに脆弱な機能が見つかります。

```bash
whoami       # root として実行されていることを確認
curl ifconfig.co
```

「なぜrootで動くWebアプリが危険か」を仕組みレベルで説明すると、コマンドインジェクション脆弱性はアプリケーションプロセスの実行ユーザーの権限をそのまま攻撃者に付与します。rootで動いていれば、任意のシステムファイルの読み書き、他ユーザーの認証設定の改ざんが可能になります。実際にこのシナリオでは、RCEを使って自分のSSH公開鍵をOSユーザー（ubuntu）の`authorized_keys`に追記し、パスワードなしでSSHログインできる永続的な足場を作ります。

```bash
echo "<公開鍵>" >> /home/ubuntu/.ssh/authorized_keys
```

これは典型的な「RCEを一時的な処刑コンテキストから永続的なシェルアクセスへ昇格させる」手口で、`authorized_keys`ファイルへの書き込み権限があれば、公開鍵認証の仕組み上、対応する秘密鍵を持つ攻撃者はいつでも正規のSSHセッションとして接続できてしまいます。

**McDuckパス（認証情報の直接露出）**

もう一方の経路では、S3バケットに置かれたSSH秘密鍵ファイルをそのままダウンロードします。

```bash
aws s3 cp s3://cg-keystore-s3-bucket/cloudgoat .
```

これはWebアプリの脆弱性すら不要な、シンプルな「バケットの権限設定ミスによる鍵の露出」であり、クラウド環境でしばしば実際に発生するミスです。

**収束点: インスタンスメタデータサービス経由のIAM認証情報窃取**

どちらの経路でも、最終的にはEC2インスタンスへSSHログインします。

```bash
ssh -i <private_key> ubuntu@<public_ip>
```

ここが本シナリオの核心です。EC2インスタンスにIAMロールがアタッチされている場合、インスタンス内部からはAWS CLIの追加設定なしにインスタンスメタデータサービス（IMDS、`169.254.169.254`）経由で一時的なIAM認証情報を取得できます。これはEC2の設計上の機能であり、インスタンス上で動くアプリケーションがAWS APIを呼び出せるようにするための仕組みですが、**インスタンス上で任意コード実行を獲得した攻撃者にとっては、そのままIAMロールの権限を丸ごと乗っ取る手段**になります。AWS CLIやSDKはEC2上で実行されると自動的にこのメタデータ経由の認証情報を利用するため、攻撃者は追加の認証情報入力なしにIAMロールの権限で操作を続行できます。

```bash
aws s3 ls s3://cg-secret-s3-bucket/ --recursive
aws s3 cp s3://cg-secret-s3-bucket/db.txt .
```

取得した`db.txt`にはRDSデータベースの接続情報が記載されており、最終的にデータベースへ直接接続してフラグ（機密情報）を取得します。

```bash
psql postgresql://cgadmin:Purplepwny2029@<rds-instance>:5432/cloudgoat
select * from sensitive_information;
```

このウォークスルー全体が示す教訓は、**「Webアプリのコマンドインジェクション」→「SSH永続化」→「IAMロールの窃取」→「RDSの機密データ到達」という、レイヤーをまたいだ攻撃チェーン**です。防御側はこれを踏まえ、(1) Webアプリのroot実行を避ける最小権限化、(2) EC2にアタッチするIAMロールの権限を必要最小限にするIAMポリシー設計、(3) IMDSv2（トークン必須化）の強制によるSSRF経由でのメタデータ窃取対策、(4) RDS認証情報をプレーンテキストでS3やテキストファイルに置かない（Secrets Managerの利用）、といった多層的な対策の必要性を学べます。

> 出典: CloudGoat Official Walkthrough Series: "rce_web_app" — Rhino Security Labs — https://rhinosecuritylabs.com/aws/cloudgoat-walkthrough-rce_web_app/

### 学習効果を高める使い方（防御目線）

CloudGoatのシナリオは攻撃技術の習得だけでなく、**検知ルールやアラートの有効性検証**にも使えます。たとえば`rce_web_app`のような環境を自分専用のAWSアカウントに展開した状態で、CloudTrailやGuardDutyのログを観察すれば、「IAMロールの認証情報がEC2以外の場所（攻撃者の端末）から使われた」という異常検知が実際にどう記録されるかを確認できます。これは、座学だけでは得にくい「実際のログの形」を理解する上で非常に有効です。

なお、CloudGoatは本番環境やAWS Organizationsの共有アカウントでの実行を強く禁止しています。展開されるリソースは意図的に脆弱であり、ホワイトリスト機能を使っても完全に閉じられるわけではないため、必ず専用の使い捨てAWSアカウント（学習用サンドボックスアカウント）で実行し、演習後は`destroy`と手動確認の両方でリソースを完全に削除することが安全な運用の前提になります。

> 出典: CloudGoat — Rhino Security Labs — https://github.com/RhinoSecurityLabs/cloudgoat

### 未取得の資料について

> ⚠️ **未取得の資料**: 「Working with CloudGoat: The "vulnerable by design" AWS environment」（Infosec Institute）は自動取得できませんでした（理由: アクセス先サーバーがHTTP 403を返却、代替ドメインもDNS解決に失敗し取得不可）。以下のURLからご自身で直接ご覧ください: https://www.infosecinstitute.com/resources/cloud/working-with-cloudgoat-the-vulnerable-by-design-aws-environment/

（以下は未取得資料の補足として一般知識に基づく解説です）Infosec Instituteのこの記事は、CloudGoatの導入からシナリオ実行までの一連の流れを初学者向けに整理したチュートリアル記事シリーズの入口にあたるものです。一般に、このようなハンズオン系記事では、AWS CLIのプロファイル作成（`aws configure --profile cloudgoat`）、IAMユーザーへの一時的な管理者権限付与、CloudGoatの`create`コマンドによるシナリオ展開、AWSマネジメントコンソールでの作成済みリソースの確認、シナリオごとの攻撃ステップの実演、そして最後に`destroy`コマンドによる後片付けという流れで構成されることが多く、本節で解説したRhino Security Labs公式のウォークスルーと内容的に重なる部分が大きいと考えられます。実際の学習では、公式リポジトリのREADMEおよび各シナリオのSTART/SOLUTIONドキュメントを一次情報として参照することを推奨します。

### まとめ

CloudGoatは、静的な学習教材では得にくい「実際のAWS API・IAMロール・メタデータサービスの挙動」を安全に体験できる、防御側の理解を深める上でも価値の高いハンズオン環境です。シナリオ単位でTerraform管理された独立環境、`create`/`destroy`による再現性の高いライフサイクル管理、そして`rce_web_app`に見られるような「Web層の脆弱性がクラウドのIAM権限昇格へ連鎖する」設計は、実務におけるクラウドセキュリティレビューやインシデント対応シミュレーションの土台として活用できます。演習は必ず専用のサンドボックスAWSアカウントで行い、実サービスや本番環境に対しては一切適用しないことが大前提です。
