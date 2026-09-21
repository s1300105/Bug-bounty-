## IAM Vulnerable / CloudFoxable / AWSGoat

クラウドセキュリティ、とりわけAWSのIAM（Identity and Access Management、権限管理サービス）まわりの攻撃手法は、座学だけでは身につきにくい分野です。IAMポリシーのJSONを目で読んでも、それがどう権限昇格（privilege escalation、低い権限のプリンシパルがより高い権限を得ること）につながるかは、実際にAWSアカウント上で手を動かして確認しないと直感的に理解できません。本節では、そうした実践演習のために作られた3つのオープンソース環境——**IAM Vulnerable**、**CloudFoxable**、**AWSGoat**——を紹介します。いずれも「防御側の学習」を目的として意図的に脆弱に作られた環境であり、実運用のAWSアカウントとは切り離した専用アカウントで使うことが大前提です。本書では、これらの環境を使った具体的な攻略手順（いわゆる「ラボ攻略」）には立ち入らず、各ツールが何を教えてくれるのか、その設計思想と仕組みを解説します。

### なぜハンズオン環境が必要なのか

IAMの権限昇格は、単一の脆弱な設定だけで成立することは少なく、「あるポリシーが許可しているAPIアクション」と「そのAPIアクションが持つ副作用」の組み合わせで初めて悪用可能になります。たとえば `iam:PassRole` というアクションは一見無害に見えますが、これは「あるIAMロールを他のAWSサービスに引き渡す権限」であり、そのロール自体が強力な権限を持っていて、かつそのロールを引き渡せるサービス（Lambda、EC2、CloudFormationなど）でコードやコマンドを実行できるなら、間接的に管理者権限まで到達できてしまいます。こうした「権限の連鎖」を理解するには、実際にポリシーをアタッチしたIAMユーザーとしてログインし、AWS CLIやPacu（AWS専用の攻撃フレームワーク）を使って列挙・悪用の手順を踏むのが最も効果的です。IAM Vulnerable、CloudFoxable、AWSGoatは、この学習体験を安全かつ再現可能な形で提供するために設計されています。

### IAM Vulnerable（BishopFox、31 privesc経路）

#### 概要と仕組み

IAM Vulnerableは、セキュリティ企業BishopFoxが公開しているTerraform（HashiCorp社のInfrastructure as Codeツール。設定ファイルに書いたインフラ構成をクラウド上に再現できる）構成ファイル集です。`terraform apply` を実行すると、単一のAWSアカウントに250以上のIAMリソース（ユーザー、ロール、ポリシー）がデプロイされ、そのうち31個が、それぞれ異なる仕組みで権限昇格を許してしまう「意図的に脆弱な経路」として設計されています。

```bash
git clone https://github.com/BishopFox/iam-vulnerable
cd iam-vulnerable
terraform init
terraform plan   # 何が作られるか事前確認
terraform apply  # 実際にデプロイ
```

なぜ `terraform plan` を先に実行するかというと、Terraformは宣言的にインフラの「あるべき状態」を記述するツールであり、`apply` は現在のAWSアカウントの状態を書き換える破壊的操作になり得るからです。`plan` はドライラン（実際には変更を加えず、何が変更されるかだけを表示する実行モード）であり、意図しないリソースが作られたり、既存のリソースが上書きされたりしないかを事前に確認できます。BishopFoxのドキュメントは「本番環境やデータを含むアカウントでは絶対に実行しないこと」を強く警告しています。IAMリソースを大量に作成するため、既存のIAM構成と衝突したり、後片付け（`terraform destroy`）に失敗したりするリスクがあるためです。万が一Terraformの状態ファイル（`.tfstate`、作成したリソースの管理台帳）が失われた場合に備え、リポジトリにはPythonとBashの両方でクリーンアップスクリプトが同梱されています。

#### 31個の権限昇格経路の分類

IAM Vulnerableが実装する31経路は、悪用に使われるAPIアクションの性質によって大きく次のように分類できます。

1. **IAM他ユーザーの認証情報を操作する経路（3種）**
   `iam:CreateAccessKey`（他ユーザーの新しいアクセスキーを発行できる）、`iam:CreateLoginProfile` / `iam:UpdateLoginProfile`（他ユーザーのコンソールログイン用パスワードを設定・変更できる）。これらの権限を持つプリンシパルは、より強い権限を持つ別のIAMユーザーになりすませます。なぜなら、アクセスキーやパスワードを新規発行できるということは、そのユーザーの認証情報を事実上乗っ取れることと同義だからです。

2. **サービスへのPassRoleを悪用する経路（13種）**
   CloudFormation、CodeBuild、DataPipeline、EC2、Glue、Lambda（複数バリエーション）、SageMaker（複数バリエーション）といったサービスに対して、`iam:PassRole` と当該サービスの起動系アクション（例: `lambda:CreateFunction` や `ec2:RunInstances`）の両方を持つ場合に成立します。仕組みとしては、AWSの多くのマネージドサービスは「実行時にどのIAMロールを引き受けるか」を呼び出し元が指定できるようになっており、`PassRole` はまさに「このロールをこのサービスに引き渡してよい」という許可です。攻撃者は、強い権限を持つロールをEC2インスタンスやLambda関数に紐付けて起動し、そのインスタンス/関数の中からロールの権限を使ってコードを実行することで、間接的に昇格します。

   ```json
   {
     "Effect": "Allow",
     "Action": ["iam:PassRole", "lambda:CreateFunction", "lambda:InvokeFunction"],
     "Resource": "*"
   }
   ```
   このポリシーを持つユーザーは、管理者権限を持つロールをLambda関数に割り当てて作成し、その関数内で任意のAWS APIを呼び出すコードを実行させることで、管理者権限を事実上獲得できます。

3. **IAMポリシー自体を操作する経路（11種）**
   `iam:AddUserToGroup`、`iam:AttachGroupPolicy`、`iam:AttachRolePolicy`、`iam:AttachUserPolicy`、`iam:CreateNewPolicyVersion`（カスタマー管理ポリシーの新バージョンを作成できる。IAMポリシーはバージョン管理されており、新しいデフォルトバージョンを作ることは実質的にポリシー内容の書き換えと同じ）、`iam:PutGroupPolicy` / `iam:PutRolePolicy` / `iam:PutUserPolicy`（インラインポリシーの追加・上書き）、`iam:SetExistingDefaultPolicyVersion`（既存の別バージョンをデフォルトに戻す。過去に管理者権限を与えていたバージョンが残っていれば、それを再度有効化できる）。これらはいずれも「自分自身、あるいは自分が所属するグループ・ロールに、より強いポリシーを後から付け足せる」という直接的な昇格経路です。

4. **AWSサービス経由での間接的な昇格（8種）**
   EC2 Instance Connect（EC2インスタンスへSSH公開鍵をpushして接続できる機能）、CloudFormationのスタック更新、Glueジョブ、Lambda関数のコード編集、SageMakerのノートブックインスタンス、SSM（Systems Manager、複数種）、STSのAssumeRoleなど。これらは「すでに存在する高権限のリソース（実行中のEC2やLambda）を操作・乗っ取りできる」ことによる昇格です。たとえば `lambda:UpdateFunctionCode` を持つユーザーは、既存の高権限ロールにアタッチされたLambda関数の中身を、任意のコードを実行するものに書き換えられます。

5. **AssumeRoleポリシー自体を書き換える経路（1種）**
   ロールの信頼ポリシー（trust policy、「誰がこのロールをAssumeできるか」を定義するポリシー）を編集できる権限を持てば、信頼ポリシーの `Principal` に自分自身を追加することで、そのロールを自由に引き受けられるようになります。

> 出典: IAM Vulnerable (BishopFox) — https://github.com/BishopFox/iam-vulnerable

#### 検出ツールとの組み合わせ

IAM Vulnerableは「脆弱性を作る」側のツールであり、それ単体では攻撃も検出もしません。BishopFoxはこれを、Cloudsplaining（IAMポリシーを静的解析し、過剰な権限を検出するツール）、PMapper（Principal Mapper、IAMプリンシパル間の権限昇格グラフを可視化するツール）、Pacu（AWS専用のペネトレーションテスト・フレームワークで、権限列挙から昇格モジュールまで揃っている）といった「検出・悪用ツール」を実際に動かして試すための土台として設計しています。この組み合わせにより、「検出ツールが本当に31種類の昇格経路を漏れなく見つけられるか」を評価する、いわばIAM監査ツールのベンチマークとしても使えます。

### CloudFoxable（BishopFox、CTF形式のクラウドペンテスト演習）

#### 概要と設計思想

CloudFoxableもBishopFoxが公開している教育用環境ですが、IAM Vulnerableとは目的が異なります。CloudFoxableは「AWSクラウドペンテストの技法そのものを教える」ことを目的とした、**CTF（Capture The Flag）形式**の演習環境です。CloudGoat（Rhino Security Labsによる先行する脆弱AWS環境）、flaws.cloud（有名な公開型クラウドセキュリティCTF）、Metasploitable（伝統的な脆弱VM）からインスピレーションを受けて設計されており、複数のフラグ（攻略成功の証となる文字列やリソース）を、実際の攻撃経路をたどって発見していく形式を取ります。

現時点でCloudFoxableが対象とするのはAWS環境のみです。これは、姉妹ツールであるCloudFox自体がAWSとGCP（Google Cloud Platform）の両方に対応しているのとは対照的で、演習環境としてはAWSに絞って深さを追求している設計だと理解できます。

#### CloudFoxとの関係

CloudFoxは、クラウド環境に対して大量の列挙コマンド（enumeration commands）を実行し、「攻撃経路を照らし出す（illuminate attack paths）」ことを目的としたオープンソースの偵察ツールです。侵入テスターがクラウド環境に足がかりを得た後、「次にどこを攻めればよいか」を素早く把握するために使われます。CloudFoxableは、このCloudFoxというツールの有用性を、実際に手を動かして体感するための実践プラットフォームという位置づけです。つまり、CloudFoxが「地図を描くツール」だとすれば、CloudFoxableは「その地図を使って実際に探索する迷路」に相当します。

#### 学習方法

CloudFoxableはワークショップ資料、ブログ記事、デモ動画といった学習コンテンツとセットで提供されています。利用者はCloudFoxやAWS CLI、Pacuなどのツールを使いながら、デプロイされた環境内に散りばめられたフラグを見つけていくことで、S3バケットの誤設定、IAMロールの過剰権限、Lambda環境変数への機密情報の混入といった、実際のクラウド環境でよく見られる攻撃経路のパターンを体系的に学べます。

> 出典: CloudFoxable (BishopFox) — https://bishopfox.com/tools/cloudfox-tool

### AWSGoat（INE、OWASP Top 10＋AWS誤設定）

#### 概要と設計思想

AWSGoatは、セキュリティ教育企業INE（Pentester Academyの運営元）が公開している「vulnerable by design（意図的に脆弱に設計された）」AWSインフラストラクチャです。IAM Vulnerableが「IAMの権限昇格」という単一テーマに特化しているのに対し、AWSGoatはより広く、**アプリケーション層の脆弱性（OWASP Top 10）とクラウドインフラの誤設定を組み合わせた、実際のWebアプリケーションを模した環境**を提供する点が特徴です。

#### モジュール構成

AWSGoatは複数の独立したモジュールとして提供されており、それぞれ異なるAWSアーキテクチャパターンを題材にしています。

- **Module 1: サーバーレスブログアプリケーション** — Lambda、S3、API Gateway、DynamoDBを組み合わせたサーバーレス構成。ブラックボックス的なアプローチで、複数の侵害経路（chained vulnerabilities、単発の脆弱性ではなく複数を連鎖させて最終的な侵害に至る設計）が仕込まれています。稼働コストの目安は時間あたり0.0125ドルと案内されています。
- **Module 2: HR給与管理アプリケーション** — AWS ECS（Elastic Container Service、コンテナオーケストレーションサービス）を基盤とした、社内向け業務アプリケーションを模した構成。コンテナ環境特有の攻撃面（コンテナブレイクアウトなど）を学べます。時間あたりの目安コストは0.0505ドルです。

#### 含まれる脆弱性のカテゴリ

AWSGoatが組み込んでいる脆弱性は、OWASP Top 10 2021（Webアプリケーションセキュリティの代表的なリスク分類）に沿ったアプリケーション層の脆弱性と、AWS特有のクラウド設定不備の両方にまたがります。

- アプリケーション層: XSS（クロスサイトスクリプティング）、SQLインジェクション、安全でない直接オブジェクト参照（IDOR）、SSRF（サーバーサイドリクエストフォージェリ。特にLambda関数の実行環境からクラウドのメタデータサービスなどへ到達する経路として悪用されやすい）、機密情報の露出
- クラウド基盤層: S3バケットの設定ミス（パブリック公開や過剰な読み書き権限）、IAMロールの権限昇格経路、ECSコンテナからのブレイクアウト（コンテナの分離が破られ、ホストや他のコンテナ・IAMロールへアクセスできてしまう状態）

このように「入口はWebアプリケーションの脆弱性、出口はクラウドインフラの権限昇格」という一連の流れを体験できるよう設計されており、実際のインシデントでよく見られる「アプリ層の穴からクラウド全体を掌握される」というシナリオの縮図になっています。

#### デプロイ方法

AWSGoatは自動デプロイと手動デプロイの両方をサポートしています。自動デプロイでは、AWS認証情報をGitHub Secretsに登録した上でGitHub Actionsのワークフローを使ってTerraformを実行します。手動デプロイの場合は、他の2ツールと同様にTerraformベースの標準的な手順を踏みます。

```bash
git clone https://github.com/ine-labs/AWSGoat
aws configure
cd AWSGoat/Module-1  # 対象モジュールのディレクトリへ
terraform init
terraform apply
```

デプロイにはAWS管理者権限相当、もしくはそれに準じるカスタムIAMポリシーが必要とされており、AWSフリーティアの範囲内であれば無料枠で試せますが、超過分は前述の時間単価で課金されます。動作環境としてはLinux（`/bin/bash`）とChromeブラウザが推奨されています。

> 出典: AWSGoat (ine-labs) — https://github.com/ine-labs/AWSGoat

### 3ツールの位置づけの違いと選び方

| 観点 | IAM Vulnerable | CloudFoxable | AWSGoat |
|---|---|---|---|
| 学習の焦点 | IAM権限昇格そのもの（31経路を網羅的に） | クラウド偵察・攻撃経路発見のワークフロー（CTF形式） | Webアプリ脆弱性からクラウド侵害へ至る一連の流れ |
| 構成 | IAMリソースのみ（250超） | AWS環境全般、フラグ探索形式 | サーバーレス／コンテナのフルスタックアプリ |
| 主に使うツール | Pacu、Cloudsplaining、PMapperなど検出ツール全般 | CloudFox、AWS CLI | ブラウザ、Burp Suite等のWebツール＋AWS CLI |
| 想定読者 | IAMポリシーの設計・監査を学びたい人 | クラウド侵入テストの実務フローを学びたい人 | クラウドネイティブアプリのセキュリティを一気通貫で学びたい人 |

いずれの環境も、防御側の学習を目的として公開されているオープンソースプロジェクトです。実際に手元で動かす際は、必ず検証専用に分離したAWSアカウントを用意し、組織のポリシーで許可されている範囲内で、かつ使用後は `terraform destroy` 等で確実にリソースを削除することが、コスト面・セキュリティ面の両方から強く推奨されます。本番アカウントや共有アカウントでの実行は、どのプロジェクトのドキュメントでも明確に禁止されています。
