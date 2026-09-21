# 第5章 IAM誤設定と権限昇格

## Rhino Security Labs IAM権限昇格21手法（原典）

AWS環境の侵入テストや防御設計を学ぶうえで避けて通れない一次資料が、Rhino Security Labs の Spencer Gietzen が2018年に公開した「AWS IAM Privilege Escalation – Methods and Mitigation」である。ここでいう **権限昇格（Privilege Escalation）** とは、「限られた権限しか持たないIAMプリンシパル（ユーザーやロールなどAWSの操作主体）を起点に、追加のIAM操作や他サービスの機能を悪用して、より強い権限（最終的には管理者権限）を獲得すること」を指す。

この記事群が画期的だったのは、それまで断片的にしか語られていなかった「どのIAM権限を1つ持っていれば管理者になれてしまうか」を、**必要権限・悪用API・仕組み・緩和策**の4点セットで体系化した点にある。本節では、原典（Part 1の21手法）と Part 2（Lambda Layers / SageMaker）、および中央リポジトリの一覧を統合し、なぜ各手法が成立するのかを仕組みレベルで解説する。

> ⚠️ **スコープ注意**: 本節は防御・検知設計の理解を目的とする。掲載するCLI例は「攻撃者がどのAPIを叩くか」を知り、CloudTrailログやIAMポリシー設計で塞ぐための知識であって、無許可の実環境で実行してよいという意味ではない。プレースホルダ（`[role-name]` など）はそのまま実行できないよう意図的に伏せてある。

### 全体像: 権限昇格は「IAMを直接いじる系」と「PassRole悪用系」に大別できる

原典の手法は数が多く一見バラバラに見えるが、原理で分類すると2つの大きな系統に収束する。この構造を先に押さえると、個別手法が「同じ穴の別バリエーション」だと理解しやすい。

1. **IAM APIを直接悪用してポリシー/認証情報を書き換える系**（手法1〜13）
   - 攻撃者は自分または他プリンシパルの権限定義そのものを書き換える。`iam:*` 権限を1つ持っていることが引き金になる。
2. **`iam:PassRole` を使って高権限ロールを別サービスに「なりすまし実行」させる系**（手法14〜21、Part 2の一部）
   - 攻撃者自身は弱い権限のままだが、EC2やLambdaなど**ロールを引き受けて動くサービス**に高権限ロールを渡し、そのサービス上で任意コードを実行して認証情報を吸い出す。

**PassRole（`iam:PassRole`）** とは、「IAMロールをAWSサービスに『引き渡す』ことを許可する権限」である。EC2にロールをアタッチしたり、Lambdaにロールを設定したりするには、この権限が必ず要る。裏を返せば、PassRoleを緩く付与していると、サービスをコード実行の踏み台にしてロール権限を奪取される。これが後半すべての手法の共通原理である。

### 系統A: IAM APIの直接悪用（手法1〜13）

#### 手法1: 新しいポリシーバージョンの作成 — `iam:CreatePolicyVersion`

AWSのマネージドポリシー（IAMのカスタマー管理ポリシー）は、最大5世代までの**バージョン**を持ち、そのうち1つが「デフォルト（有効）」として評価される。攻撃者は既存ポリシーに管理者権限相当の新バージョンを作り、`--set-as-default` を付けることで、**別権限である `iam:SetDefaultPolicyVersion` を持っていなくても**そのバージョンを即座に有効化できる。

```bash
aws iam create-policy-version \
  --policy-arn [attached-policy-arn] \
  --policy-document file://admin-policy.json \
  --set-as-default
```

**なぜ成立するのか**: `create-policy-version` API は内部的に「バージョン作成」と「デフォルト切替」を1回のAPIコールでまとめて実行できる設計になっている。ポリシー設計者は「バージョン作成」と「デフォルト設定」を別権限（`iam:CreatePolicyVersion` と `iam:SetDefaultPolicyVersion`）だと考えて片方だけ絞りがちだが、`--set-as-default` フラグがその境界を無効化してしまう。`admin-policy.json` に `"Action": "*", "Resource": "*"` を書けば、そのポリシーがアタッチされているすべてのプリンシパルが即座に管理者になる。

**緩和策**: 誰がポリシーバージョンを作れるかを厳格に絞る。特に自分にアタッチされたポリシーを自分で書き換えられる状態を作らない。

#### 手法2: デフォルトポリシーバージョンの切替 — `iam:SetDefaultPolicyVersion`

過去に作られた（今は無効な）ポリシーバージョンに強い権限が残っている場合、デフォルトをそのバージョンに戻すだけで権限を得られる。

```bash
aws iam set-default-policy-version --policy-arn [arn] --version-id v2
```

**なぜ成立するのか**: バージョンは削除しない限り履歴として残る。過去に「一時的に管理者権限を付けたポリシー」を後で絞ったつもりでも、旧バージョンが消えていなければ、デフォルトを差し戻すことで復活する。影響は旧バージョンの中身次第。**緩和策**はポリシーのバージョン履歴を棚卸しし、危険な旧世代を削除すること。

#### 手法3〜4: 他ユーザーの認証情報の乗っ取り — `iam:CreateAccessKey` / `iam:CreateLoginProfile`

```bash
# アクセスキー（プログラム用の永続認証情報）を他ユーザー向けに発行
aws iam create-access-key --user-name [target-user]

# コンソールログイン用パスワードを未設定ユーザーに付与
aws iam create-login-profile --user-name [target-user] \
  --password [complex-password] --no-password-reset-required
```

**なぜ成立するのか**: `iam:CreateAccessKey` は「対象ユーザーのアクセスキーを新規発行する」API で、発行されたキーはそのユーザーの全権限をそのまま引き継ぐ。ユーザーあたり2キーまでという制約はあるが、より権限の強い被害ユーザーを狙えば実質昇格になる。`CreateLoginProfile` は**ログインプロファイル（コンソール用パスワード設定）がまだ無いユーザー**にパスワードを設定できる。既にある場合は次の手法5を使う。

#### 手法5: 既存ログインプロファイルの書き換え — `iam:UpdateLoginProfile`

```bash
aws iam update-login-profile --user-name [target-user] \
  --password [new-password] --no-password-reset-required
```

既にコンソールパスワードを持つユーザーのパスワードを上書きし、コンソールを乗っ取る。手法4との違いは「新規作成か上書きか」だけで、原理は同じ。

**手法3〜5の緩和策**: これらの自己管理系権限には必ず `Resource` 条件を付け、`arn:aws:iam::[account]:user/${aws:username}` のように**自分自身に対してしか実行できない**よう制限する。`${aws:username}` はポリシー評価時に呼び出し元のユーザー名へ展開される組み込み変数。

#### 手法6〜8: マネージドポリシーの付与 — `iam:AttachUserPolicy` / `AttachGroupPolicy` / `AttachRolePolicy`

```bash
# 自分自身に AdministratorAccess を直接アタッチ
aws iam attach-user-policy --user-name [my-username] \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

**なぜ成立するのか**: AWSには `arn:aws:iam::aws:policy/AdministratorAccess`（全許可）というAWS管理ポリシーが最初から存在する。ポリシーの「アタッチ」権限を1つ持っていれば、この既製の管理者ポリシーを自分（手法6）、自分の所属グループ（手法7）、または引き受け可能なロール（手法8）に貼り付けるだけで昇格が完了する。新しいポリシーを書く必要すらない点が危険。

#### 手法9〜11: インラインポリシーの作成/更新 — `iam:PutUserPolicy` / `PutGroupPolicy` / `PutRolePolicy`

```bash
aws iam put-user-policy --user-name [username] \
  --policy-name inline-admin --policy-document file://admin-policy.json
```

**なぜ成立するのか**: **インラインポリシー**は、ユーザー/グループ/ロールに直接埋め込む名前付きポリシーで、マネージドポリシーと違い他リソースから共有されない。`Put*Policy` 系はこのインラインポリシーを丸ごと差し替える（＝任意のJSONを注入できる）ため、`admin-policy.json` に全許可を書けば即昇格になる。手法6〜8がAWS管理ポリシーの再利用なのに対し、こちらは**攻撃者が中身を自由に定義できる**分さらに柔軟。

#### 手法12: グループへの自己追加 — `iam:AddUserToGroup`

```bash
aws iam add-user-to-group --group-name [privileged-group] --user-name [my-username]
```

強い権限を持つ既存グループに自分を追加するだけ。グループ権限は所属ユーザー全員に継承されるため、これで昇格する。

#### 手法13: 信頼ポリシーの書き換え — `iam:UpdateAssumeRolePolicy`（＋ `sts:AssumeRole`）

```bash
aws iam update-assume-role-policy --role-name [role-name] \
  --policy-document file://assume-policy.json
```

**なぜ成立するのか**: IAMロールには2種類のポリシーがある。(1) ロールが**何をできるか**を定める権限ポリシーと、(2) **誰がそのロールを引き受けられるか**を定める**信頼ポリシー（AssumeRolePolicyDocument / trust policy）**である。`UpdateAssumeRolePolicy` は後者を書き換えるAPI。攻撃者は信頼ポリシーを「自分のARNを `Principal` に含める」内容へ書き換え、その後 `sts:AssumeRole` で高権限ロールを正式に引き受ける。ロール本体の権限は一切変えずに、入口の鍵だけをすげ替えるイメージ。

### 系統B: `iam:PassRole` によるサービス踏み台化（手法14〜22）

ここからは「攻撃者自身は弱い権限のまま、高権限ロールを別サービスに実行させる」系統である。共通の前提は **`iam:PassRole`（ロールをサービスに渡す権限）** で、渡した先のサービス上で任意コード or 任意APIを実行し、そのロールの一時認証情報を奪う。

#### 手法14: EC2インスタンス＋既存インスタンスプロファイル — `iam:PassRole`, `ec2:RunInstances`

```bash
aws ec2 run-instances --image-id [ami-id] --instance-type t2.micro \
  --iam-instance-profile Name=[high-priv-profile] \
  --user-data file://payload.sh
```

**なぜ成立するのか**: EC2にIAMロール（正確には**インスタンスプロファイル**：ロールをEC2に紐付ける入れ物）をアタッチすると、そのインスタンス内から**インスタンスメタデータサービス（IMDS, `169.254.169.254`）**経由でロールの一時認証情報を取得できる。攻撃者は高権限プロファイルを付けたインスタンスを起動し、SSH鍵か `user-data`（起動時実行スクリプト）でOS上にアクセスし、`curl http://169.254.169.254/latest/meta-data/iam/security-credentials/` 相当の操作で認証情報を吸い出す。**緩和策**: PassRole先のロールを限定し、IMDSv2（トークン必須方式）を強制、GuardDutyで認証情報の外部利用を検知する。

#### 手法15〜17: Lambda関数の悪用 — `iam:PassRole`, `lambda:CreateFunction` ほか

**手法15（作成＋直接実行）**: `lambda:InvokeFunction` があれば、高権限ロールを付けたLambdaを作り、その中でIAM APIを叩いて即実行できる。

```bash
aws lambda create-function --function-name [name] --runtime python3.6 \
  --role [high-priv-role-arn] --handler lambda_function.lambda_handler \
  --code file://code.py
aws lambda invoke --function-name [name] output.txt
```

```python
import boto3
def lambda_handler(event, context):
    client = boto3.client('iam')
    return client.attach_user_policy(
        UserName='[my-username]',
        PolicyArn='arn:aws:iam::aws:policy/AdministratorAccess')
```

**なぜ成立するのか**: Lambda関数は設定された**実行ロール**の権限でコードを走らせる。攻撃者は自分に管理者ポリシーを貼るコードを仕込み、ロールにその権限があれば成功する。攻撃者自身は `iam:AttachUserPolicy` を持っていなくても、ロールが持っていれば良い点が肝。

**手法16（DynamoDBトリガー経由）**: `lambda:InvokeFunction` が無い場合の回避策。`lambda:CreateEventSourceMapping` でLambdaをDynamoDBストリームに紐付け、`dynamodb:PutItem` でテーブルにアイテムを書き込むとストリームイベントが発火し、間接的にLambdaが起動する。

```bash
aws dynamodb create-table --table-name [t] \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES ...
aws lambda create-event-source-mapping --function-name [name] \
  --event-source-arn [stream-arn] --enabled --starting-position LATEST
aws dynamodb put-item --table-name [t] --item Test={S="trigger"}
```

**手法17（既存Lambdaのコード上書き）**: `lambda:UpdateFunctionCode` だけで、既に高権限ロールが付いた既存関数のコードを悪意あるZIPで差し替えられる。次回呼び出し時にロール権限で攻撃コードが走る。PassRole不要（既存関数のロールを流用するため）。

```bash
aws lambda update-function-code --function-name [target] --zip-file fileb://malicious.zip
```

なお、リポジトリ一覧では手法16の別バリエーションとして**クロスアカウント実行**（`lambda:AddPermission` を使い、別アカウントから呼び出し可能にする）も挙げられている。

#### 手法18〜19: Glue開発エンドポイント — `glue:CreateDevEndpoint` / `glue:UpdateDevEndpoint`

```bash
aws glue create-dev-endpoint --endpoint-name [name] \
  --role-arn [high-priv-role-arn] --public-key file://ssh-key.pub
```

**なぜ成立するのか**: AWS Glueの**開発エンドポイント**は、ETLスクリプトを対話開発するためのマネージドなSparkノードで、指定ロールの権限で動きSSHログインできる。攻撃者は自分のSSH公開鍵を登録した高権限エンドポイントを作り（手法18）、SSHで入ってメタデータからロール認証情報を取得する。手法19は既存エンドポイントのSSH鍵を自分の鍵へ**上書き**する亜種で、PassRole不要。

#### 手法20: CloudFormationスタック — `iam:PassRole`, `cloudformation:CreateStack`

```bash
aws cloudformation create-stack --stack-name [s] \
  --template-url https://example.com/template.json --role-arn [high-priv-role-arn]
```

**なぜ成立するのか**: CloudFormationに `--role-arn` で高権限ロールを渡すと、テンプレート内のリソース作成が**そのロールの権限で**実行される。テンプレートに「管理者ポリシーを自分に付ける」等のIAMリソース定義を書き込めば昇格になる。攻撃者本人はそのIAM操作権限を持たなくてよい。

#### 手法21: Data Pipeline — `iam:PassRole`, `datapipeline:CreatePipeline`, `datapipeline:PutPipelineDefinition`

空のパイプラインを作り、その定義に「任意のAWS CLIコマンドを実行する」ステップを書き込み、高権限ロールで実行させる。原理はCloudFormationと同様で、「ロールを渡せるオーケストレーションサービス」を任意コード実行の踏み台にする。

### Part 2 の追加手法: Lambda Layers と SageMaker

> 出典: AWS IAM Privilege Escalation – Methods and Mitigation — https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/
> 出典: RhinoSecurityLabs/AWS-IAM-Privilege-Escalation（手法の中央リポジトリ） — https://github.com/RhinoSecurityLabs/AWS-IAM-Privilege-Escalation

原典公開後、同社は Part 2 で新サービスを使う手法を追加した。いずれも「PassRole悪用系」の発展形だが、悪用する内部メカニズムが新しい。

#### 追加手法A: Lambda Layers の読み込み優先順位の悪用 — `lambda:UpdateFunctionConfiguration`

**Lambda Layer** とは、複数のLambda関数で共有できる依存ライブラリ等のパッケージ層である。攻撃者は自分のアカウントに**悪意あるLayer**（例えば改ざんした `boto3`）を作り、`add-layer-version-permission` で全公開し、標的関数にそのLayerを付け替える。

```bash
aws lambda add-layer-version-permission --layer-name boto3 --version-number 1 \
  --statement-id public --action lambda:GetLayerVersion --principal '*'
aws lambda update-function-configuration --function-name [target] \
  --layers arn:aws:lambda:[region]:[attacker-account]:layer:boto3:1
```

**なぜ成立するのか（核心）**: この攻撃はPythonの**モジュール検索パスの優先順位**を突く。Lambda実行時、`import boto3` は最初に関数コードの `/var/task` を、次にLayerが展開される `/opt/python/lib/python3.x/site-packages` を、最後にランタイム同梱のboto3を探す。Layerは `/opt` に展開されランタイム標準より**先に**評価されるため、攻撃者のLayerに仕込んだ偽 `boto3` が正規版を上書きしてロードされる。関数が次に呼ばれると、偽boto3内の認証情報窃取コードがそのロール権限で実行される。**緩和策**: Layerは自アカウント内のもののみ許可し、`UpdateFunctionConfiguration` / `CreateFunction` を厳格に絞る。

#### 追加手法B: 新規SageMakerノートブック＋PassRole — `sagemaker:CreateNotebookInstance`, `sagemaker:CreatePresignedNotebookInstanceUrl`, `iam:PassRole`

```bash
aws sagemaker create-notebook-instance --notebook-instance-name [n] \
  --instance-type ml.t2.medium --role-arn [sagemaker-exec-role-arn]
aws sagemaker create-presigned-notebook-instance-url --notebook-instance-name [n]
```

**なぜ成立するのか**: SageMakerのノートブックインスタンスは、指定した実行ロールの権限で動くマネージドなJupyter環境。攻撃者は `sagemaker.amazonaws.com` を信頼する高権限ロールを見つけ、それを付けたノートブックを作成し、`create-presigned-notebook-instance-url` で**署名付きURL**（ブラウザで直接ログインできるURL）を得る。JupyterLabのターミナルを開けばEC2同様にメタデータサービスへアクセスでき、ロールの認証情報を抜ける。

#### 追加手法C: 既存SageMakerノートブックへのアクセス — `sagemaker:CreatePresignedNotebookInstanceUrl`（＋ `ListNotebookInstances`）

既存のノートブックに対して署名付きURLを発行するだけで、**PassRole不要**でそのノートブックのロール認証情報にアクセスできる。`ListNotebookInstances` で標的を列挙し、URLを取得してターミナルから窃取する。手法B との差は「新規作成か既存流用か」で、CreateLoginProfile と UpdateLoginProfile の関係に似た亜種構造である。

> 出典: AWS IAM Privilege Escalation – Methods and Mitigation Part 2（Lambda Layers / SageMaker） — https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation-part-2/

なお中央リポジトリには、上記に加えて **CodeStar** を使う手法群（`codestar:CreateProjectFromTemplate` 単独、`codestar:CreateProject` + `iam:PassRole`、`codestar:CreateProject` + `codestar:AssociateTeamMember`）も収録され、総数は公開後の追記で28手法まで拡張されている。CodeStar系は、プロジェクトテンプレートやチームメンバー関連付けの過程でサービスロールに強い権限が自動付与される挙動を悪用するもので、原理は「サービスに高権限ロールを持たせて踏み台化する」PassRole系と同じ発想に連なる。

### 防御の要点: 「たった1つの危険な権限」を可視化する

この21〜28手法から得られる最大の教訓は、**単一のIAM権限だけで管理者になれる経路が無数にある**という事実である。防御側は次を徹底する。

- **`iam:PassRole` を最重要監視対象にする**: 系統Bのほぼ全てはPassRoleが起点。誰がどのロールをどのサービスに渡せるかを `Resource` と `Condition`（`iam:PassedToService` など）で厳格に限定する。
- **自己管理系権限には `${aws:username}` 条件を必須化する**: 認証情報系（手法3〜5）は自分自身にしか作用しないよう縛る。

```json
{
  "Effect": "Allow",
  "Action": ["iam:CreateAccessKey", "iam:CreateLoginProfile", "iam:UpdateLoginProfile"],
  "Resource": "arn:aws:iam::[account]:user/${aws:username}"
}
```

- **危険権限の棚卸しを定期実行する**: `iam:CreatePolicyVersion` / `iam:Put*Policy` / `iam:Attach*Policy` / `lambda:UpdateFunctionCode` などを誰が持つかを継続監査する。Rhino社は同じ調査から権限昇格経路を自動列挙するツール **Pacu**（AWS攻撃フレームワーク）や **PMapper** の思想へつなげており、防御側もこれらで自環境の経路を先回りして洗い出せる。
- **CloudTrail全記録＋GuardDuty検知**: `RunInstances` / `CreateFunction` / `CreatePresignedNotebookInstanceUrl` などの実行と、取得した一時認証情報の外部IPからの利用を検知する。
- **旧ポリシーバージョンの削除・IMDSv2強制・Layer/コード署名**: 各手法固有の緩和策（手法2の旧バージョン削除、手法14のIMDSv2、追加手法AのLayer出所制限）を漏れなく適用する。

**時事性の注記**: 本手法群は2018年公開のもので、対象APIの仕様は概ね現在も有効だが、AWS側の既定挙動（例: 新規EC2でのIMDSv2デフォルト化の進行、SageMakerの後継たるSageMaker AI/Studioへの移行）は年々変化している。実環境の評価時は、各サービスの最新ドキュメントと、リポジトリ（継続更新中）の最新手法一覧を必ず突き合わせること。

> 出典: RhinoSecurityLabs/AWS-IAM-Privilege-Escalation（手法の中央リポジトリ） — https://github.com/RhinoSecurityLabs/AWS-IAM-Privilege-Escalation

## BishopFox 31権限昇格経路とツール比較

この節では、AWS IAM（Identity and Access Management：AWSの認証・認可基盤）における「権限昇格（privilege escalation、privesc）」——低い権限しか持たないプリンシパル（principal：IAMユーザーやロールなど、権限の主体）が、設定の穴を突いてより高い権限、最終的には管理者相当の権限を手に入れてしまう現象——を体系的に扱う。まず攻撃者視点で「どのIAM権限（Action）が単独で昇格につながるのか」を分類し、次にそれを学習用に再現するBishop Foxの「IAM Vulnerable」、最後に「検出ツールはどこまで見つけられるのか」を比較する。目的はあくまで**防御**、すなわち自組織のIAMポリシーから危険な権限の組み合わせを見つけ出して塞ぐことにある。実在サービスや本番環境への無許可の検証・破壊的操作は行わない前提で読み進めてほしい。

### なぜ「1つのIAM権限」が管理者権限になり得るのか

IAMの認可判定は「そのプリンシパルが、その`Action`を、その`Resource`に対して許可されているか」をポリシー評価エンジンが計算するだけの、一見単純な仕組みである。ところが**一部のIAM `Action`は、他のプリンシパルの権限を書き換えたり、より強い権限を持つロールを間接的に使わせたりできる**。この「メタな権限（権限を操作する権限）」を持っていると、たとえ自分自身のポリシーが最小限でも、そこを起点に権限を膨らませられる。

権限昇格を理解する鍵は次の2つの内部挙動である。

- **ポリシーは後から差し替え・追加できる**：`iam:PutUserPolicy`や`iam:AttachUserPolicy`のような`Action`は、既存プリンシパルにインラインポリシー（そのプリンシパルに直接埋め込むポリシー）を書き込んだり、`AdministratorAccess`のような強力なマネージドポリシーを貼り付けたりできる。ポリシー評価エンジンは「誰がその権限を付与したか」を問わない。付与された結果の権限だけを見る。だから、権限を付与できること自体が管理者への直行便になる。
- **`iam:PassRole`は「ロールをサービスに手渡す」権限**：多くのAWSサービス（EC2、Lambda、CloudFormationなど）は、リソースを作るときにIAMロールを引き受けて（assume）動く。ユーザーがそのロールをサービスに渡すには`iam:PassRole`が必要だ。ここで重要なのは、**サービスがロールを引き受けた後は、そのサービス内で動くコードがロールの一時認証情報を丸ごと使える**という点。つまり「強力なロールをサービスに渡せて、かつそのサービスで任意コードを走らせられる」なら、ロールの権限を実質的に奪える。

この2系統（ポリシー操作系と`PassRole`系）が権限昇格の背骨である。

### AWS IAM権限昇格テクニックの全体像（Hacking The Cloud）

Hacking The Cloudの「AWS IAM Privilege Escalation Techniques」は、Rhino Security LabsのSpencer Gietzenが2018年に体系化した手法を土台に、40以上の昇格経路を分類してまとめている。カテゴリごとに、その`Action`が「なぜ」昇格になるのかを見ていく。

#### 1. ポリシーの直接操作系

自分または攻撃者が制御するプリンシパルに、強い権限を直接くっつける手法群。

```text
iam:AttachUserPolicy / iam:AttachGroupPolicy / iam:AttachRolePolicy
  → AdministratorAccess 等のマネージドポリシーを自分/自グループ/操作可能なロールに貼る
iam:PutUserPolicy / iam:PutGroupPolicy / iam:PutRolePolicy
  → "Effect: Allow, Action: *, Resource: *" のインラインポリシーを書き込む
iam:CreatePolicyVersion
  → 既存の顧客管理ポリシーに「より強い新バージョン」を作成
iam:SetDefaultPolicyVersion
  → ポリシーを過去の（より緩い）バージョンに戻す
```

なぜ効くのか。マネージドポリシーは最大5つの「バージョン」を保持でき、そのうち1つが「デフォルト（実際に評価されるもの）」になる。`iam:CreatePolicyVersion`で`--set-as-default`を付けて新バージョンを作れば、ポリシーの中身を`*:*`に書き換えたのと同じ効果になる。`iam:SetDefaultPolicyVersion`だけを持っている場合でも、**過去に緩いバージョンが1つでも残っていれば**、それをデフォルトに戻すことで昇格できる（新規作成の権限すら要らない）。CLIの例:

```bash
# 既存ポリシーに全許可の新バージョンを作り、即デフォルト化する
aws iam create-policy-version \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/<TargetPolicy> \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]}' \
  --set-as-default
```

このコマンドが通ってしまう理由は、`iam:CreatePolicyVersion`がポリシー**本文の妥当性**しか検証せず、「そのポリシーが誰にアタッチされ、結果として付与者より強い権限を生むか」を一切見ないためだ。IAMには「自分の権限を超えるポリシーは作れない」というガードが（Permissions Boundaryを明示的に付けない限り）存在しない。

#### 2. Permissions Boundary（権限境界）の除去・改変

Permissions Boundaryは「そのプリンシパルが取り得る権限の上限」を定める仕組み。これを外せば上限が消える。

```text
iam:DeleteUserPermissionsBoundary / iam:DeleteRolePermissionsBoundary  → 上限を撤去
iam:PutUserPermissionsBoundary  / iam:PutRolePermissionsBoundary       → 上限を緩いものに差し替え
```

境界は「アイデンティティベースのポリシーで許可され、かつ境界でも許可されている」権限だけを有効にする論理積（AND）として働く。境界を消すと論理積の片方が無条件Allowになり、元のポリシーの許可がそのまま通る。

#### 3. 信頼ポリシー（Trust Policy）の書き換え

```text
iam:UpdateAssumeRolePolicy
  → 強力なロールの「誰が引き受けてよいか」を書き換え、自分を引き受け可能にする
```

ロールには2種類のポリシーがある。「何ができるか（permissions policy）」と「誰が引き受けられるか（trust policy / AssumeRolePolicyDocument）」だ。`iam:UpdateAssumeRolePolicy`は後者を書き換える。管理者ロールの信頼ポリシーに自分のARNを`Principal`として加えれば、その後`sts:AssumeRole`でロールになりすませる。多くの場合、この`Action`と`sts:AssumeRole`の2つが揃うだけで管理者になれる。

#### 4. 認証情報の新規発行

```text
iam:CreateAccessKey        → 他の高権限ユーザーの新しいアクセスキーを発行
iam:CreateLoginProfile     → コンソールパスワードが未設定の高権限ユーザーにパスワードを新設
iam:UpdateLoginProfile     → 既存の高権限ユーザーのパスワードを書き換え
```

`iam:CreateAccessKey`は自分以外のユーザーに対しても実行でき、1ユーザーにつき2本までキーを持てる。管理者ユーザーに対してこれを撃てば、そのユーザーの認証情報を新規に手に入れられる——**元のキーを盗む必要すらない**。

#### 5. グループ・ユーザー操作

```text
iam:AddUserToGroup  → 自分を、管理者権限を持つグループに追加
```

グループにアタッチされたポリシーはメンバー全員に適用される。自分を管理者グループに入れれば即昇格する。

#### 6. `iam:PassRole` ＋ サービス起動系（横断的昇格）

「強いロールをサービスに渡し、そのサービス上で任意コードを走らせて一時認証情報を吸い出す」型。Hacking The Cloudが挙げる代表例:

| サービス | 必要な権限 | 仕組み |
|---|---|---|
| EC2 | `iam:PassRole` + `ec2:RunInstances` | 特権ロールを付けたインスタンスを起動し、メタデータサービス（169.254.169.254）やuser-dataスクリプト経由で一時認証情報を吸い出す |
| Lambda | `iam:PassRole` + `lambda:CreateFunction` + `lambda:InvokeFunction` | 特権ロールを付けた関数を作り、実行して環境変数/SDK経由でロール認証情報を得る |
| ECS | `iam:PassRole` + `ecs:RunTask` | Fargateタスクにロールを付与し、コマンドを上書きして認証情報を送出 |
| CloudFormation | `iam:PassRole` + `cloudformation:CreateStack` | スタックの実行ロールに特権ロールを渡す |
| Glue | `iam:PassRole` + `glue:CreateDevEndpoint`/`CreateJob` | Glueリソースに特権ロールを付与 |
| Data Pipeline | `iam:PassRole` + `datapipeline:CreatePipeline` + `PutPipelineDefinition` | パイプライン定義に特権ロールを組み込む |
| Auto Scaling | `iam:PassRole` + `autoscaling:CreateLaunchConfiguration`/`CreateAutoScalingGroup` | 起動インスタンスにロールを付与 |

EC2の例で仕組みを掘り下げる。EC2インスタンスにインスタンスプロファイル（ロールの入れ物）を付けると、AWSはそのインスタンスのメタデータエンドポイントに**ロールの一時認証情報を自動配信**する。インスタンス内から次のように取れる:

```bash
# IMDSv2 のトークンを取り、ロールの一時認証情報を読む（インスタンス内から）
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
ROLE=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/)
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/$ROLE
# → AccessKeyId / SecretAccessKey / Token が返る＝ロールになりすませる
```

インスタンスを起動する権限があれば、user-dataにこの吸い出し処理を仕込んで結果を外部へ送るだけでよい。防御の要は`iam:PassRole`の`Resource`を必要最小のロールARNに絞ること、そしてIMDSv2の強制である。

#### 7. サービス固有の悪用

```text
lambda:UpdateFunctionCode          → 既存の（特権ロール付き）関数のコードを悪性コードに差し替える
lambda:UpdateFunctionConfiguration → 悪性のLambda Layerを注入し、ライブラリを乗っ取る
glue:UpdateDevEndpoint             → 開発エンドポイントのSSH公開鍵を書き換えて侵入し、ロール認証情報を取得
codestar:CreateProject + AssociateTeamMember → 自分をOwnerとしてプロジェクトに追加し権限を得る
```

`lambda:UpdateFunctionCode`が危険なのは、**新しいロールを渡す（PassRoleする）必要すらない**点だ。既存の特権ロール付き関数のコードだけを差し替え、次に何かがその関数を呼べば、悪性コードがそのロール権限で走る。「既存の実行環境に相乗りする」ため、`iam:PassRole`を監視していても見逃しやすい。

> 出典: AWS IAM Privilege Escalation Techniques（Hacking The Cloud） — https://hackingthe.cloud/aws/exploitation/iam_privilege_escalation/
> 原典: Spencer Gietzen「AWS IAM Privilege Escalation – Methods and Mitigation」（Rhino Security Labs） — https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/

### IAM Vulnerable — 21から31経路への学習環境（Bishop Fox）

> ⚠️ **未取得の資料**: 「BishopFox『IAM Vulnerable』ブログ（labs.bishopfox.com）」は自動取得できませんでした（理由: `getaddrinfo ENOTFOUND labs.bishopfox.com`。当該サブドメインがDNS解決不可で、egress側でブロックされた可能性が高い）。以下のURLからご自身で直接ご覧ください: https://labs.bishopfox.com/tech-blog/iam-vulnerable-an-aws-iam-privilege-escalation-playground （現行の正規URLは https://bishopfox.com/blog/aws-iam-privilege-escalation-playground ）
>
> 以下は、GitHub原本（BishopFox/iam-vulnerable の README）とBishop Fox公開情報から取得できた内容に基づく解説である。

**IAM Vulnerable**は、Bishop FoxのSeth Artが公開した「わざと脆弱に作ったIAM設定」をTerraformで一括デプロイする学習用ツールである。`terraform apply`一発で、専用のAWSアカウントに**250以上のIAMリソース**（ユーザー・ロール・グループ・ポリシー等）を数分で展開し、権限昇格の練習場を作る。学習が終われば`terraform destroy`で撤去でき、状態ファイル（tfstate）を失った場合に備えてPython/Bashの掃除スクリプトも同梱される。

この「Terraformで環境をコード化する」点が本ツールの肝だ。従来、Gerben Kleijnが2019年に書いた手動エクスプロイト解説では、21経路それぞれを再現するのに**何十ものユーザー・ロール・ポリシーを手作業で作る**必要があり、環境構築だけで消耗した。IAM Vulnerableはその構築をInfrastructure as Code（IaC）化し、誰でも同一の脆弱環境を再現・破棄できるようにした。

#### 系譜：Gietzen（21）→ Kleijn（手動実証）→ Art（31・IaC化）

- **Spencer Gietzen（Rhino Security Labs, 2018）**：AWS IAMの権限昇格を**21経路**として初めて体系化した原典。ポリシー操作系・`PassRole`系という分類の基礎を作った。
- **Gerben Kleijn（2019）**：その21経路を1つずつ手で悪用して見せる実証記事を執筆。「机上の分類」を「実際に動く攻撃」へ落とし込んだ。
- **Seth Art / Bishop Fox（2021〜）**：Kleijnの実証を土台にTerraform化し、さらに経路を**31**へ拡張。追加経路の多くは、後述のPrincipal Mapper（PMapper）に含まれていたのを見て取り込んだもの（例: `SSM-SendCommand`、`SSM-StartSession`、`CodeBuild-CreateProjectPassRole`）で、`EC2InstanceConnect-SendSSHPublicKey`などはBishop Fox独自研究として加えられた。

> 補足（陳腐化対策）：31経路は2021年8月時点の数字。AWSの新サービス追加に伴い経路は今後も増え得るため、最新の対応数はGitHubリポジトリのREADMEを確認すること。

#### 31経路のカテゴリ構成

IAM Vulnerableが再現する31経路は、Gietzen/Kleijnの分類を踏襲し、おおむね次の5カテゴリに整理される。

**カテゴリ1: 他ユーザーへのIAM権限（3経路）**
`IAM-CreateAccessKey` / `IAM-CreateLoginProfile` / `IAM-UpdateLoginProfile`
→ 前述「認証情報の新規発行」に対応。他人の認証情報を作れる権限。

**カテゴリ2: サービスへのPassRole（10経路）**
`CloudFormation-PassExistingRoleToCloudFormation` / `CodeBuild-CreateProjectPassRole` / `DataPipeline-PassExistingRoleToNewDataPipeline` / `EC2-CreateInstanceWithExistingProfile` / `Glue-PassExistingRoleToNewGlueDevEndpoint` / `Lambda-PassExistingRoleToNewLambdaThenInvoke` / `Lambda-PassRoleToNewLambdaThenTrigger` / `SageMaker-CreateNotebookPassRole` / `SageMaker-CreateTrainingJobPassRole` / `SageMaker-CreateProcessingJobPassRole`
→ `iam:PassRole`＋サービス起動系。「渡す＋走らせる」で一時認証情報を奪う型。

**カテゴリ3: AWSサービスを使った昇格（10経路）**
`EC2InstanceConnect-SendSSHPublicKey` / `CloudFormation-UpdateStack` / `Glue-UpdateExistingGlueDevEndpoint` / `Lambda-EditExistingLambdaFunctionWithRole` / `SageMakerCreatePresignedNotebookURL` / `SSM-SendCommand` / `SSM-StartSession` / `STS-AssumeRole` ほか
→ 既存の特権リソースに相乗りする型。新規PassRoleを伴わないものが多く（例: `Lambda-EditExistingLambdaFunctionWithRole`）、検出が難しい。

**カテゴリ4: ポリシーへの権限（7経路）**
`IAM-AddUserToGroup` / `IAM-AttachGroupPolicy` / `IAM-AttachRolePolicy` / `IAM-AttachUserPolicy` / `IAM-CreateNewPolicyVersion` / `IAM-PutGroupPolicy` / `IAM-PutRolePolicy` / `IAM-PutUserPolicy` / `IAM-SetExistingDefaultPolicyVersion`
→ 前述「ポリシーの直接操作系」に対応。

**カテゴリ5: AssumeRoleポリシーの更新（1経路）**
`IAM-UpdatingAssumeRolePolicy`
→ 前述「信頼ポリシーの書き換え」。

なお、SSM系やGlue、SageMaker、EC2などの一部モジュールは実リソースを起動するため課金が発生する（Glueの開発エンドポイントは時間課金など）。既定デプロイは無料範囲だが、有料モジュールは意図的に`terraform apply`で選択する設計になっている。**本教科書のスコープでは、こうした環境は自分専用の隔離アカウントでのみ、防御手法（検出・修正）の学習目的に限って扱う**。

> 出典: Bishop Fox「IAM Vulnerable: An AWS IAM Privilege Escalation Playground」（正規URL: https://bishopfox.com/blog/aws-iam-privilege-escalation-playground ）／GitHub原本: https://github.com/BishopFox/iam-vulnerable

### 検出ツール比較 — 「1つで全部は見つからない」（Assessing the AWS Assessment Tools）

同じくSeth Artによる続編ブログ「Assessing the AWS Assessment Tools」（2021年9月）は、IAM Vulnerableで再現した既知経路を、各privesc検出ツールがどれだけ拾えるかを実測した比較研究である。防御側にとっては「どのツールを、どう組み合わせて使うべきか」を決めるための一次資料になる。

#### 評価対象ツール（当時のバージョン）

- **Principal Mapper（PMapper）** v1.1.3 — プリンシパルとポリシーを**グラフ**として構築し、到達可能性を探索する。
- **AWSPX** v1.3.4 — グラフ可視化とポリシーの透明性に強いが、対象はIAM/EC2/Lambdaに限定。
- **Cloudsplaining** v0.4.5 — ポリシー本文をスキャンして危険な権限を洗い出す（ポリシー中心型）。
- **Pacu** v1.1.4 — Rhino Security Labsの攻撃フレームワーク。プリンシパル中心に昇格可否を判定。

#### 検出能力マトリクス（9つの評価軸）

| 能力 | PMapper | AWSPX | Cloudsplaining | Pacu |
|---|---|---|---|---|
| ユーザーとロールの両方を解析 | ✓ | ✓ | ✓ | ✓ |
| プリンシパル中心のアプローチ | ✓ | ✗ | ✗ | ✓ |
| Resource制約を考慮 | ✓ | ✓ | ✗ | ✗ |
| サービスロール権限を考慮 | ✓ | ✓ | ✗ | ✗ |
| 推移的（transitive）な昇格経路 | ✓ | ✓ | ✗ | ✗ |
| 単一ポリシー内のDeny | ✓ | ✗ | ✓ | ✓ |
| 複数ポリシーにまたがるDeny | ✓ | ✗ | ✗ | ✓ |
| NotActionの扱い | ✓ | ✓ | ✓ | ✗ |
| Condition制約の評価 | ✗ | ✗ | ✗ | ✗ |
| Service Control Policy（SCP） | ✓ | ✗ | ✗ | ✗ |

#### 経路検出数（テストした29経路のうち）

- **PMapper**: 22経路
- **Pacu**: 21経路
- **Cloudsplaining**: 19経路
- **AWSPX**: 14経路

#### なぜ差が出るのか——中心思想の違い

検出漏れ・誤検出は、ツールの「世界の見方」の違いから構造的に生じる。

- **ポリシー中心型（Cloudsplaining, AWSPX）の弱点**：ポリシー1枚ずつを見て「危険なActionが入っているか」を判定する。そのため、**権限が複数ポリシーに分散**していると（例: あるポリシーで`iam:PassRole`、別のポリシーで`lambda:CreateFunction`）、単体では無害に見えて昇格の組み合わせを見逃す。また複数ポリシーにまたがる`Deny`（実際には権限を打ち消している）を評価できず、**誤検出（false positive）**も出す。
- **プリンシパル中心型（PMapper, Pacu）の強み**：「このプリンシパルは結局どこまで到達できるか」を、全ポリシーを合成して評価する。PMapperはさらにグラフ探索で**推移的経路**（AがBになれ、BがCになれる、ゆえにAはCになれる）を追え、SCP（AWS Organizations全体にかかる上限ポリシー）まで加味する唯一のツールだった。

**最重要の結論**は次の一文に集約される——「どのツールも、既知の全昇格経路を検出しつつ同時に全ての誤検出を排除することはできない（None of them can identify all known privesc paths while at the same time removing all false positives.）」。そして**全4ツールが共通して`Condition`制約を正しく評価できなかった**。`Condition`（例: 特定のタグやMFA、送信元IPがある時だけAllow）はポリシー評価の結果を大きく変えるため、これを無視すると本来ブロックされる経路を「昇格可能」と誤判定し得る。

#### 防御側への実践的示唆

1. **単一ツールに頼らない**：PMapperを主軸にしつつ（推移経路・SCP・複数ポリシーDenyに強い）、Pacuで攻撃者視点の裏取りをし、Cloudsplainingで手早く「危険Actionを含むポリシー」を棚卸しする、といった多層運用が現実解。
2. **`Condition`は人手で確認**：どのツールも`Condition`を見ないため、MFAやタグ条件で守っているつもりの経路は、ツール結果を鵜呑みにせず自分で読む。
3. **検出できた経路を潰す**：`iam:CreatePolicyVersion`/`iam:PassRole`/`iam:UpdateAssumeRolePolicy`/`iam:PutUserPolicy`等の「メタ権限」を、Permissions Boundaryや`Resource`絞り込み、SCPでの明示Denyによって、本当に必要なプリンシパルだけに限定する。

> 出典: Seth Art「Assessing the AWS Assessment Tools」（Bishop Fox, 2021年9月） — https://bishopfox.com/blog/assessing-the-aws-assessment-tools

### この節のまとめ

- 権限昇格の本質は「**権限を操作できる権限（メタ権限）**」にある。ポリシー差し替え系（`Put*Policy`/`CreatePolicyVersion`/`UpdateAssumeRolePolicy`）と、`iam:PassRole`＋サービス起動系の2系統を押さえれば、40以上の経路の大半は理解できる。
- **IAM Vulnerable**（Seth Art）は、Gietzenの21経路→Kleijnの手動実証→Terraform化・31経路拡張という系譜の到達点であり、防御学習用に脆弱環境をコードで再現・破棄できる。
- **検出ツールに万能はない**。プリンシパル中心型（PMapper/Pacu）は推移経路や複数ポリシーの合成に強く、ポリシー中心型（Cloudsplaining/AWSPX）は手軽だが分散権限を取りこぼす。全ツール共通で`Condition`は未評価——ここは人が読む。
- 実運用では複数ツールを重ね、検出結果を`Condition`込みで検証し、メタ権限を最小権限とSCP/境界で封じることが、権限昇格を塞ぐ最短路である。

## IAM権限昇格の実演ウォークスルー

### この節で学ぶこと

前節までで、IAM権限昇格（privilege escalation）が「本来持つべきでない高い権限を、既存の限定的な権限の組み合わせから獲得する」行為であることは理解できただろう。本節では、その代表的な演習環境である **iam-vulnerable**（意図的に脆弱なIAM構成をTerraformで構築するAWSラボプロジェクト）を題材に、実際に権限昇格が「どのAPI呼び出しの連鎖として」成立するのかを、コマンドレベルで追う。

扱うのは大きく2系統である。

1. **ポリシー自体を書き換えて特権化する経路**（`iam:CreatePolicyVersion` を中心とした手法）
2. **既存のプリンシパル（ユーザー・ロール・グループ）に権限やクレデンシャルを付け替える経路**（`AttachUserPolicy`、`PutUserPolicy`、`CreateAccessKey`、`CreateLoginProfile`/`UpdateLoginProfile`、`AddUserToGroup`、そして `iam:PassRole` を絡めたEC2/Lambda経由の権限奪取）

いずれも本書のスコープ上、実在のAWSアカウントや本番環境への無許可の検証は行わない。ここで示すコマンド例はすべて、iam-vulnerableのような自前で構築した検証用ラボ、または権限を持つ自分自身のサンドボックスアカウントでの実行を前提とした学習目的の記述である。防御側（クラウドセキュリティ担当者）は、これらの手口を知ることで、IAMポリシーレビュー時に「この権限セットは何に化けうるか」を逆算できるようになる。

---

### 5-3-1. iam-vulnerableラボとは何か

iam-vulnerableは、Rhino Security Labsが公開しているオープンソースのTerraformモジュールで、AWSアカウント内に意図的に脆弱なIAMユーザー・ロール・ポリシーの組み合わせを大量に自動構築する。各ユーザー・ロールには `privesc1-...`、`privesc2-...` のように命名規則がついており、それぞれが異なる権限昇格手法（既知のもので20種類前後）に対応する検証環境になっている。

> ⚠️ **部分的に未取得の資料**: 「AWS IAM privilege escalation paths (iam-vulnerable)」（pswalia2u, Medium）は自動取得がHTTP 403（Mediumのボット対策によるアクセス拒否）でブロックされました。同一内容のGitHubミラーは見つからなかったため、WebSearchで得られた記事の要約情報をもとに、以下ではその内容を補って解説します。直接ご覧になりたい場合は次のURLからどうぞ: https://pswalia2u.medium.com/aws-iam-privilege-escalation-paths-cba36be1aa9e
>
> （以下は未取得資料の補足として一般知識に基づく解説です）

この記事は、iam-vulnerableラボを実際にデプロイし、`privesc1`から始まる複数のシナリオ（ポリシーバージョン作成、ログインプロファイル操作、インラインポリシー付与、PassRole経由のEC2起動など）を一つずつAWS CLIで攻略していく実演形式のウォークスルーである。各シナリオの構造は共通していて、「読み取り専用に見える低権限ユーザーの認証情報を渡され、そこからAdministratorAccess相当の権限に到達する」という筋書きになっている。

なぜこの形式のラボが権限昇格学習に適しているかというと、AWSのIAM権限昇格は「単体の脆弱性」ではなく「ポリシー設計上の見落とし」の積み重ねだからである。個々のAPI呼び出し（`CreatePolicyVersion`や`AttachUserPolicy`など）はAWSの正規機能であり、それ自体にバグはない。問題は「その呼び出しを許可する対象が広すぎる」ことにある。この非対称性——「機能としては正しいが、権限のスコープ設計が誤っている」——を体感するには、実際に攻略してみるのが最も理解が早い。

---

### 5-3-2. CreatePolicyVersionによる権限昇格：仕組みと実演

もっとも根深く、かつ実務でも頻出する手法が `iam:CreatePolicyVersion` を悪用する経路である。Mystic0x1の記事は、この手法を非常に具体的な手順で解説している。

#### 前提条件

この攻撃シナリオを成立させるには、以下がすべて揃っている必要がある。

- 攻撃者（あるいは診断者）が、読み取り専用相当の権限を持つIAMユーザーの認証情報（アクセスキー）をすでに保持している
- そのユーザー、または引き継ぎ可能なロール（`privesc1-CreateNewPolicyVersion-role`）に、**カスタマー管理ポリシー**（AWSが管理する`AWS managed policy`ではなく、アカウント内で独自に作成・管理しているポリシー）がアタッチされている
- そのカスタマー管理ポリシーに対して `iam:CreatePolicyVersion` の実行権限が、**そのポリシー自身（あるいは`Resource: "*"`）** に対して許可されている

最後の条件が本質である。「あるポリシーが、自分自身の内容を書き換える権限を、そのポリシーを持つ主体に与えている」——これは自己参照的（self-referential）な権限設計であり、ここに循環構造の脆弱性が生まれる。

#### なぜこれが権限昇格になるのか

IAMのカスタマー管理ポリシーは、単一のドキュメントではなく**バージョン管理**されている。ポリシーには最大5バージョンまで保持でき、そのうち1つが「デフォルトバージョン（default version）」としてアタッチ先のプリンシパルに実際に適用される。`iam:CreatePolicyVersion` は「新しいバージョンのポリシードキュメントを作成する」権限であり、オプションの `--set-as-default` フラグを付けると、作成と同時にそのバージョンをデフォルトに設定できる。

ここが罠になる。多くのIAM設計者は「ポリシーの中身を編集する権限（`CreatePolicyVersion`）」と「どのバージョンを適用するか切り替える権限（`iam:SetDefaultPolicyVersion`）」を別物として捉え、後者だけを厳しく制限すれば安全だと考えがちである。しかし `CreatePolicyVersion` の `--set-as-default` オプションは、`SetDefaultPolicyVersion` 権限を一切要求せずに、事実上同じ効果（新しい内容を即座に有効化する）を達成してしまう。つまり「変更を予約する権限」だと思っていたものが、実質的に「即時反映の権限」と等価だったということであり、権限設計者の意図とAWS APIの実際の挙動との間にギャップが存在する。

#### 実演手順

**ステップ1: 列挙**

まず対象ロールの信頼ポリシー（誰がこのロールをAssumeできるか）と、アタッチされているポリシーを確認する。

```bash
aws iam get-role --role-name privesc1-CreateNewPolicyVersion-role
```

このコマンドの出力にある `AssumeRolePolicyDocument` の `Principal` に自分（現在のIAMユーザー）が含まれていれば、そのロールを `sts:AssumeRole` で引き継げることが分かる。次に、そのロールにアタッチされたポリシーの中身を見る。

```bash
aws iam list-attached-role-policies --role-name privesc1-CreateNewPolicyVersion-role
aws iam get-policy-version \
  --policy-arn arn:aws:iam::xxxxxxxxxxxx:policy/privesc1-CreateNewPolicyVersion \
  --version-id v1
```

ここで確認すべきは、このポリシーが `iam:CreatePolicyVersion` を「自分自身のARN」または `Resource: "*"` に対して許可しているかどうかである。許可されていれば、次のステップに進める。

**ステップ2: 悪意あるポリシードキュメントの作成**

新しく適用したいポリシー内容をローカルにJSONファイルとして用意する。

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowEverything",
            "Effect": "Allow",
            "Action": "*",
            "Resource": "*"
        }
    ]
}
```

この `"Action": "*", "Resource": "*"` は、AWSの全サービス・全リソースに対する無制限のアクセスを意味する、いわば手製の `AdministratorAccess` ポリシーである。

**ステップ3: ポリシーバージョンの作成と即時有効化**

```bash
aws iam create-policy-version \
  --policy-arn arn:aws:iam::xxxxxxxxxxxx:policy/privesc1-CreateNewPolicyVersion \
  --policy-document file:///policies/admin-policy.json \
  --set-as-default \
  --profile privesc1
```

先述の通り、`--set-as-default` を付けることで `iam:SetDefaultPolicyVersion` 権限なしに、この新バージョンが即座にアクティブなポリシー内容として反映される。

**ステップ4: 検証**

```bash
aws iam get-policy-version \
  --policy-arn arn:aws:iam::xxxxxxxxxxxx:policy/privesc1-CreateNewPolicyVersion \
  --version-id v2
```

新バージョン `v2` の内容が、先ほど作成した全権限許可のドキュメントに置き換わっていることが確認できる。以降、このポリシーがアタッチされたロール（あるいはユーザー）は、次にAPIを呼んだ瞬間から管理者相当の権限を持つ。IAMのポリシー評価はリクエストごとにリアルタイムで行われるため、既存のセッション（一時クレデンシャルなど）であっても、次のAPIコールからは新しい権限が反映される点に注意したい。

> 出典: Mystic0x1 — Privilege Escalation in AWS - Part 01 — https://mystic0x1.github.io/posts/AWS-Privilege-Escalation-Part-01/

#### 根本原因のまとめ

この手法の本質は、「ポリシーの変更を許可する権限のスコープが、変更対象となるポリシー自身を含んでしまっている」という循環参照にある。IAMポリシーのステートメントを書くとき、`Resource` フィールドに `*` を安易に指定したり、ARNのワイルドカード（`arn:aws:iam::123456789012:policy/team-*` のような部分一致）を使ったりすると、意図せずこの循環が生まれる。防御側の対策としては、`iam:CreatePolicyVersion` や `iam:SetDefaultPolicyVersion` を許可する場合、`Resource` を必要最小限の特定ポリシーARNに限定し、かつそのポリシー自身の管理権限を持つ主体を厳密に絞ることが必須になる。

---

### 5-3-3. その他の代表的な権限昇格パス

pswalia2uの記事、および一般に知られているiam-vulnerableの各シナリオでは、`CreatePolicyVersion`以外にも複数の経路が検証できる。ここでは代表的なものを、仕組みとともに整理する。いずれも「低権限に見える1〜2個のIAM権限の組み合わせが、実は特権に等価である」という共通構造を持つ。

#### (1) CreateAccessKey：他ユーザーのなりすまし

```bash
aws iam create-access-key --user-name target-admin-user
```

`iam:CreateAccessKey` を他のIAMユーザーに対して実行できると、そのユーザー名義の新しいアクセスキーID・シークレットアクセスキーのペアを、パスワードやMFAを一切介さずに発行できる。発行されたキーでAWS CLIのプロファイルを切り替えれば、そのままターゲットユーザーの権限セット全体を乗っ取れる。これは「なぜ権限昇格なのか」が最も分かりやすいケースで、IAMには「他人の認証情報を新規発行する権限」と「本人確認」の間に紐付けが存在しないため、この権限を持つこと自体が対象ユーザーへの完全ななりすましと等価になる。

#### (2) CreateLoginProfile / UpdateLoginProfile：コンソールパスワードの乗っ取り

```bash
aws iam update-login-profile --user-name target-admin-user --password 'NewP@ssw0rd123!'
```

`iam:UpdateLoginProfile` を対象が `Resource: "*"` の状態で持っていると、任意のIAMユーザーのAWSマネジメントコンソールへのログインパスワードを、既存パスワードを知らなくても強制的に書き換えられる（`CreateLoginProfile`はまだコンソールログインが設定されていないユーザーに新規設定する版で、機序は同一）。これによりMFAが設定されていないアカウントであれば即座にコンソールへのフルアクセスを得られる。

#### (3) AttachUserPolicy / AttachGroupPolicy / AttachRolePolicy：既存の強力なポリシーの付け替え

```bash
aws iam attach-user-policy \
  --user-name my_username \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

`iam:AttachUserPolicy` を自分自身（または昇格対象）に対して持っていれば、AWS管理ポリシーの `AdministratorAccess` のような既製の強力なポリシーを、新規作成することなくそのままアタッチできる。ポリシーの中身を自作する必要がない分、`CreatePolicyVersion`型よりも手数が少ない、最も直接的な昇格経路である。`AttachGroupPolicy`・`AttachRolePolicy`も対象がグループ・ロールに変わるだけで機序は同じであり、自分が所属するグループや引き継げるロールに対して実行できれば同様に昇格する。

#### (4) PutUserPolicy / PutGroupPolicy / PutRolePolicy：インラインポリシーの新規注入

```bash
aws iam put-user-policy \
  --user-name my_username \
  --policy-name backdoor-admin \
  --policy-document file:///policies/admin-policy.json
```

`iam:PutUserPolicy` は、マネージドポリシーのアタッチとは別に、ユーザー・グループ・ロールへ直接埋め込む「インラインポリシー」を新規作成する権限である。既存のマネージドポリシーの有無に関係なく、任意の権限セットを丸ごと新設できるため、`AttachUserPolicy`と同様に強力な昇格経路になる。インラインポリシーはIAMコンソール上でも見落とされやすく、フォレンジック時の痕跡調査でもマネージドポリシーの一覧だけを見ていると発見が遅れる点が実務上の注意点である。

#### (5) AddUserToGroup：強力なグループへの参加

```bash
aws iam add-user-to-group --user-name my_username --group-name admin-group
```

`iam:AddUserToGroup` を持っていれば、すでに強力なポリシーがアタッチされている既存のグループに自分自身を追加するだけで、そのグループのポリシーを丸ごと継承できる。この手法は新しいポリシーやアクセスキーを一切作らないため、CloudTrailのログ上でも「グループメンバーシップの変更」という一見地味なイベントとしてしか残らず、検知ルールの盲点になりやすい。

#### (6) iam:PassRole + ec2:RunInstances：EC2経由のロール窃取

```bash
aws ec2 run-instances \
  --image-id ami-xxxxxxxx \
  --instance-type t2.micro \
  --iam-instance-profile Name=privileged-instance-profile \
  --key-name my-key
```

`iam:PassRole`（あるIAMロールをAWSサービスに「渡す」権限）と `ec2:RunInstances` を同時に持っていると、攻撃者は自分より強力な権限を持つIAMロールをアタッチした状態でEC2インスタンスを起動できる。起動後、そのインスタンスのインスタンスメタデータサービス（IMDS、本書の第2章で扱った仕組み）に対してSSHやSSM経由でアクセスすれば、そのロールの一時クレデンシャルをそのまま取得できる。

なぜこれが権限昇格になるかというと、`PassRole`は「ロールの中身の権限を評価するAPI」ではなく「このロールをこのサービスに渡してよいか」という**渡す側の権限だけ**をチェックする仕組みだからである。つまり `PassRole` を持つ主体は、渡そうとしているロールがどれほど強力であっても、渡す行為自体には制限を受けない（対象ロールのARNを `Resource` で絞っていない限り）。この非対称性——「ロールを使う権限」と「ロールを渡す権限」が別々に評価される——が、EC2やLambdaを踏み台にした権限昇格の根本原理である。

#### (7) Lambda経由の権限昇格（PassRole + lambda:CreateFunction）

`iam:PassRole`、`lambda:CreateFunction`、`lambda:InvokeFunction` の組み合わせがあると、強力なロールを実行ロールとして指定した新しいLambda関数を作成し、任意のコード（例えば強力なロールの一時クレデンシャルを外部に送信するコード）を実行させたうえで、それを自分で呼び出して結果を回収できる。さらに `lambda:CreateEventSourceMapping` があれば、DynamoDBストリームなどのイベントソースに関数を紐付け、レコード挿入をトリガーに自動実行させる、より痕跡の残りにくい非同期の経路も成立する。原理は(6)のEC2型と同じで、「自分の権限では直接呼べないAPIを、より強い権限を持つ実行主体（サービスロール）に肩代わりさせる」という点が共通している。

> 出典: AWS IAM privilege escalation paths (iam-vulnerable) — n00 (pswalia2u), Medium — https://pswalia2u.medium.com/aws-iam-privilege-escalation-paths-cba36be1aa9e （WebSearchによる要約情報を基に本節で再構成）

---

### 5-3-4. これらの手法に共通する原理と防御への示唆

ここまで見た7つの経路には、表面上の手続き（ポリシーバージョンの書き換え、アクセスキー発行、グループ参加、EC2/Lambda経由の踏み台化など）は違っても、共通する一つの構造がある。それは、**「対象を制御するための権限」と「対象そのものへの権限」が、IAMのAPI設計上は別々の粒度で評価されるため、前者を持つだけで後者を実質的に獲得できてしまう**という点である。

- `CreatePolicyVersion`は「ポリシーを制御する権限」だが、それは「ポリシーが表す権限そのもの」へのフルアクセスと等価になりうる
- `PassRole`は「ロールを渡す権限」だが、渡した先のロールが持つ権限そのものを使えるようになる
- `AddUserToGroup`は「メンバーシップを制御する権限」だが、グループの持つ権限そのものを継承する

この非対称性を悪用されないためには、次のような防御的設計が有効である。

1. **`Resource`フィールドをワイルドカードにしない**: `iam:CreatePolicyVersion`や`iam:PassRole`のような「制御系」権限を許可する際は、対象ポリシーARN・対象ロールARNを具体的に列挙し、`*`を避ける。
2. **`iam:PassRole`には`iam:PassedToService`条件キーを併用する**: どのAWSサービス（EC2、Lambdaなど）に対してロールを渡してよいかを条件で絞ることで、想定外のサービスへの踏み台化を防ぐ。
3. **権限境界（Permissions Boundary）を併用する**: IAMユーザー・ロールが自分自身に付与できる権限の上限を、Permissions Boundaryとして別途設定しておけば、`AttachUserPolicy`や`PutUserPolicy`で強力なポリシーを付与しようとしても、境界を超える部分は無効化される。
4. **CloudTrailで昇格系APIコールを監視する**: `CreatePolicyVersion`（`--set-as-default`付き）、`CreateAccessKey`（他ユーザー宛て）、`AttachUserPolicy`、`AddUserToGroup`、`PassRole`を伴う`RunInstances`/`CreateFunction`は、いずれも権限昇格の兆候として検知ルール（GuardDutyのカスタムルールやSIEMの相関ルール）に組み込む価値が高い。

このように、iam-vulnerableのようなラボで実際に手を動かして各経路を追体験することで、単に「この権限は危険」という表層的な知識ではなく、「なぜAWSのAPI設計上この組み合わせが特権に等価になるのか」という仕組みレベルの理解が得られる。これは実際のIAMポリシーレビューや、侵害後のインシデントレスポンスで「攻撃者が次に何をできるか」を先読みする力に直結する。

## IAMグラフ分析・過剰権限検出ツール

IAM（Identity and Access Management、AWSにおけるアクセス制御の中核サービス）の設定は、ポリシー単体を目視で読んでいるだけでは全体像を把握できない。1つのアカウントに数百のIAMユーザー・ロール・ポリシーが存在し、それぞれが「ロールを引き受ける（AssumeRole）」「ポリシーをアタッチする」「インスタンスプロファイルを渡す」といった形で連鎖的に権限を渡し合っているため、ある principal（IAMユーザーやロールなど、権限が紐づく主体）が直接持つ権限だけでなく、間接的に到達できる権限まで含めて評価しないと、真の攻撃対象領域（attack surface）は見えてこない。本節では、この課題に取り組む3つの代表的なオープンソースツール — IAM関係をグラフとして解析するPMapper、ポリシーの過剰権限を静的スキャンするCloudsplaining、そして取得した認証情報をコンソールアクセスに変換するaws_consolerを扱う。いずれも防御側の監査・可視化を主目的として紹介するが、攻撃者が同じロジックで権限昇格経路を探索するため、守る側もその手法を理解しておく必要がある。

### PMapper（Principal Mapper）— IAMをグラフ化し権限昇格経路を発見する

#### 何を解決するツールか

PMapper（Principal Mapper）はNCC Groupが開発した、AWSアカウント（または AWS Organizations 全体）のIAM設定を有向グラフとしてモデル化し、権限昇格や意図しないアクセス経路を検出するためのPython製ツール/ライブラリである。README曰く、PMapperは「アカウント内のIAMユーザーとロールを有向グラフとしてモデル化し、権限昇格のチェックや、攻撃者がリソースへアクセスするために取りうる代替経路のチェックを可能にする」ツールである。

ここで重要なのは、PMapperが単なるポリシードキュメントの文字列解析ではなく、**「ある principal が別の principal を経由して間接的に権限へ到達できるか」**をシミュレートする点である。README中の具体例が分かりやすい。

> 「あるユーザーが S3 オブジェクトを直接読む権限を持っていなくても、その S3 オブジェクトを読む権限を持つ EC2 インスタンスを起動できる場合、PMapperのクエリエンジンはそれを検出する」

つまりPMapperは、IAMポリシーのAllow/Denyを評価するAWSの認可アルゴリズムをローカルでシミュレートし（「local simulation of AWS's authorization behavior」）、そのシミュレーション結果をノード（principal）とエッジ（「AがBの権限を掌握できる」という関係）から成るグラフの上で辿ることで、直接の権限評価では見えない到達可能性を明らかにする。エッジは例えば「`sts:AssumeRole` によるロール引き受け」「EC2インスタンスへのインスタンスプロファイルの付与とそこからのメタデータ窃取」「Lambda関数への実行ロールのアタッチ」のような、AWSの各種サービスが提供する「他の principal の権限を借用できる」機能に対応する（README本体には各エッジ種別の網羅的な一覧は記載されておらず、詳細はプロジェクトwikiのCore Conceptsページに委ねられている。取得を試みたがwikiの当該ページは内容を取得できなかった)。

#### 使い方とクエリ言語

PMapperの利用は大きく「グラフ作成」→「クエリ／可視化」の2段階に分かれる。

```bash
# アカウントの権限グラフを作成する（CLIプロファイル "skywalker" 経由でAPIを呼び出す）
pmapper --profile skywalker graph create

# 「iam:CreateUser を実行できるのは誰か」を問い合わせる
pmapper --profile skywalker query 'who can do iam:CreateUser'

# 条件付きクエリ: 高額なEC2インスタンスを起動できるのは誰か(管理者を除く)
pmapper --account 000000000000 argquery -s --action 'ec2:RunInstances' \
  --condition 'ec2:InstanceType=c6gd.16xlarge'

# 権限昇格のプリセットクエリを実行し、既存の管理者は除外して報告する
pmapper --account 000000000000 query -s 'preset privesc *'

# 管理者/権限昇格経路/principal間アクセスをSVGとして可視化する
pmapper --account 000000000000 visualize --filetype svg
```

`graph create` はboto3/botocoreを通じてIAM関連のAPI（ユーザー・ロール・ポリシー・グループの列挙など）を呼び出し、ローカルにグラフを構築する。以降の `query`／`argquery`／`visualize` はこのローカルグラフに対して動作するため、API呼び出しを繰り返さずに何度でも高速にクエリできるのが特徴であり、これは大規模アカウントや複数アカウントの定期監査に向く設計である。

`query -s 'preset privesc *'` は組み込みの権限昇格検出プリセットで、`-s`（`--skip-admin`のショートオプション）を付けると、すでに事実上の管理者権限を持つprincipalの分析結果を省き、「管理者ではないが権限昇格によって管理者相当になれる」principalだけを抽出できる。これはレポートのノイズを減らし、監査担当者が本当に修正すべき経路にフォーカスするために重要である。可視化コマンド `visualize` はGraphviz（`pydot`経由で利用、事前にOS側へのgraphvizインストールが必要）を用いてグラフをSVG等の画像として出力し、`--only-privesc` を付けると権限昇格に関わるノード・エッジのみを描画した図が得られ、監査レポートに添付するのに適している。

#### 前提条件

PMapperはPython 3.5以降と `botocore`、グラフ生成用の `pydot`／Graphviz本体を必要とする。AWS認証情報はAWS CLIと同様の仕組み（`--profile` オプションまたは環境変数）で渡す。Dockerイメージも提供されており、`docker run` 時に `-e`／`--env-file` で認証情報を渡すか、`~/.aws/` をボリュームマウントして `AWS_CONFIG_FILE` 等の環境変数で参照させる運用ができる。

#### 防御的な使い方

セキュリティチームがPMapperを使う典型的なワークフローは、(1) 定期的に `graph create` でスナップショットを取得し、(2) `query -s 'preset privesc *'` で新たに生まれた昇格経路がないかを差分監視し、(3) `visualize` で可視化した図を用いてIAM設計のレビュー会議で説明する、というものである。CI/CDパイプラインに組み込み、IaC（Infrastructure as Code）の変更がマージされる前に権限昇格経路の増加を検知するゲートとして使う事例も一般的である。

> 出典: Principal Mapper (PMapper) README — https://github.com/nccgroup/PMapper

> ⚠️ **未取得の資料**: PMapperのエッジ種別の網羅的な一覧・権限昇格プリセットの具体的な検出ロジック・クエリ出力の詳細フォーマットについては、プロジェクトwikiの「Core Concepts」「Query Reference」ページに記載されているが、自動取得ではページ内容（JavaScriptで動的に読み込まれる本文）を取得できなかった。詳細は以下から直接ご確認いただきたい: https://github.com/nccgroup/PMapper/wiki
>
> （以下は未取得資料の補足として一般知識に基づく解説です）PMapperが検出する典型的な権限昇格パターンには、`iam:CreatePolicyVersion`（既存の管理ポリシーに新しいデフォルトバージョンとして任意の権限を追加できる）、`iam:AttachUserPolicy` / `iam:AttachRolePolicy`（AdministratorAccessなど強力な管理ポリシーを自分自身にアタッチできる）、`iam:PassRole` と `lambda:CreateFunction` ＋ `lambda:InvokeFunction` の組み合わせ（強力なロールをLambda関数に渡し、そのロールの権限でコードを実行させる）、`ec2:RunInstances` と `iam:PassRole` の組み合わせ（強力なインスタンスプロファイルを付与したEC2インスタンスを起動し、インスタンスメタデータサービス経由で一時認証情報を窃取する）などがある。これらはRhino Security Labsが公開した「AWS IAM Privilege Escalation」の手法リストとおおむね一致し、PMapperのプリセットクエリはこの種の既知パターンをグラフ上のエッジ探索として実装していると考えられる。

### Cloudsplaining — IAMポリシーの過剰権限を静的スキャンで検出する

#### 目的とアプローチ

Cloudsplaining はSalesforceが開発したAWS IAMセキュリティ評価ツールで、「最小権限の原則（least privilege）の違反を特定し、リスクを優先順位付けしたHTMLレポートを生成する」ことを目的とする。PMapperが「principal間の到達可能性」というグラフ構造に着目するのに対し、Cloudsplainingは「個々のIAMポリシーが、リソースを制限せずに危険なアクションを許可していないか」という**ポリシー単体の静的解析**に焦点を当てる、相補的なツールである。

Cloudsplainingの前身であるPolicy Sentryが明らかにしたのは、「リソースARNを制限しないIAMポリシー」を書くのは技術的には容易であり、既存環境にはそのような設計負債が大量に蓄積しているという問題意識である。以下は README が挙げる典型的な「悪い」ポリシーの例である。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "*"
    }
  ]
}
```

`Resource: "*"` により、このポリシーを持つprincipalはアカウント内の**あらゆる**S3バケットへオブジェクトを書き込める。本来は以下のようにARNで対象を絞るべきである。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::my-bucket/*"
    }
  ]
}
```

Cloudsplainingは、こうした「リソース制約を欠くアクション」を自動検出し、そのアクションが引き起こしうるリスクの種類ごとに分類する。分類は以下の5カテゴリである。

1. **データ漏えい（Data Exfiltration）**: `s3:GetObject`、`ssm:GetParameter`、`secretsmanager:GetSecretValue` など、機微データを読み出せるアクションがリソース制約なしに許可されている。
2. **インフラ改変（Infrastructure Modification）**: ECRやS3など、リソースレベルの制限なくインフラを変更できる。
3. **リソース露出（Resource Exposure）**: バケットポリシーやリポジトリポリシー、ACLなど「リソースベースポリシー」自体を書き換えられる（＝他の principal に対して新たなアクセスを付与できてしまう）。
4. **権限昇格（Privilege Escalation）**: ロール引き受けやサービス操作を通じて自身の権限を昇格できる（Pathfinding.cloudの分類に基づく）。
5. **認証情報の露出（Credentials Exposure）**: 認証情報の取得・変更ができる。

さらにCloudsplainingは、EC2・ECS・EKS・Lambdaなどのコンピュートサービスが引き受け可能なIAMロールを高リスクとしてフラグする。README はその理由を次のように説明する。攻撃者が `ssm:SendCommand`（Systems Manager経由でリモートコマンドを実行する権限）を得て、かつSSMエージェントが導入された強力な権限のEC2インスタンスが存在する場合、攻撃者は事実上そのインスタンスのロール権限を乗っ取ったことになる。これは既知の昇格・悪用経路だが、Cloudsplainingはこうしたコンピュートサービスに紐づくロールを機械的に洗い出すことで、監査者がこの種の経路を見落とすリスクを減らす。

#### 動作の仕組みとコマンド

単一ポリシーファイルのスキャン:

```bash
cloudsplaining scan-policy-file --input-file examples/policies/explicit-actions.json
```

出力は次のような形式になる（READMEの実例）。

```console
Issue found: Data Exfiltration
Actions: s3:GetObject

Issue found: Resource Exposure
Actions: ecr:DeleteRepositoryPolicy, ecr:SetRepositoryPolicy, s3:PutBucketPolicy, ...

Issue found: Unrestricted Infrastructure Modification
Actions: ecr:BatchDeleteImage, ecr:CreateRepository, s3:DeleteBucket, s3:PutObject, ...
```

アカウント全体をスキャンする場合は、まずIAMの `GetAccountAuthorizationDetails` API（アカウント内のユーザー・グループ・ロール・カスタマー管理ポリシー・AWS管理ポリシーの情報をまとめて取得する、約100KB相当のJSONを返すAPI）を呼び出してデータを取得する。このAPI呼び出しには `iam:GetAccountAuthorizationDetails` 権限が必要で、AWS管理ポリシー `SecurityAudit` にはこの権限が含まれている。

```bash
# アカウント権限情報のダウンロード
cloudsplaining download --profile myprofile

# 除外設定ファイルの雛形生成
cloudsplaining create-exclusions-file

# ダウンロードしたJSONをスキャンし、HTML/JSONレポートを生成
cloudsplaining scan --exclusions-file exclusions.yml \
  --input-file default.json --output examples/files/
```

これは単一のAPI呼び出しでアカウント全体のIAM構成をローカルに取得し、以降はオフラインで何度でもスキャンできる設計であり、PMapperの「グラフを1回作って繰り返しクエリする」設計思想と共通する。出力はブラウザで閲覧できるインタラクティブなHTMLレポートと、機械可読な `default-iam-results.json` の両方が生成され、後者はCI/CDでの自動判定や他ツールとの連携に利用できる。

#### 除外ファイルによる誤検知の制御

Cloudsplaining自身がREADMEで強調するのは、「AWSインフラの設計背景にある文脈を知っているのはユーザー自身だけである」という点である。例えばユーザー向けポリシーは意図的に緩く設計されていることがある一方、システムロールはより厳格であるべきといった、組織固有の事情がある。そこで除外ファイル（YAML）を使い、対象外にしたいポリシー名・ロール名・アクションをホワイトリスト的に指定できる。

```yaml
policies:
  - "AWSServiceRoleFor*"
  - "AdministratorAccess"
roles:
  - "service-role*"
include-actions:
  - "s3:GetObject"
exclude-actions:
  - ""
```

これにより、AWSのサービスリンクロールや意図的に付与されたAdministratorAccessなど、既知かつ許容されている構成をレポートから除外し、本当にレビューすべき新規の過剰権限だけにチームの注意を集中させられる。

> 出典: Cloudsplaining README — https://github.com/salesforce/cloudsplaining

### aws_consoler — CLI認証情報をAWSマネジメントコンソールへ変換する

#### 目的

aws_consoler はNetSPIが開発したユーティリティで、「AWS CLIの認証情報（アクセスキー・シークレットキー・セッショントークン）をAWSマネジメントコンソールへのアクセスに変換する」ツールである。PMapperやCloudsplainingがIAM設定を「分析」するツールであるのに対し、aws_consolerは取得済みの認証情報の**実効的な影響範囲を確認する**ための実務ツールであり、ペネトレーションテストやインシデント対応における「この認証情報で実際に何ができるか」を素早く可視化する用途で使われる。防御側にとっては、インシデント対応中に侵害された認証情報の実際のコンソール権限を素早く確認し、被害範囲評価（impact assessment）を行う手段として位置づけられる。

#### 仕組み: AWS Federation エンドポイントの悪用ではなく正規利用

aws_consolerが利用するのは、AWSが公式に提供している「フェデレーション（federation）」の仕組みである。これはSAMLなどの外部IDプロバイダ連携でIAMユーザーを持たない者に一時的なコンソールアクセスを発行するために、AWS自身が用意している機能であり、脆弱性の悪用ではない。ソースコード（`aws_consoler/logic.py`）を見ると処理の流れが明確に分かる。

```python
# 一時認証情報を JSON にまとめる
json_creds = json.dumps(
    {"sessionId": creds.access_key,
     "sessionKey": creds.secret_key,
     "sessionToken": creds.token})
token_params = {
    "Action": "getSigninToken",
    "SessionDuration": 43200,
    "Session": json_creds
}
resp = requests.get(url=federation_endpoint, params=token_params)
fed_token = json.loads(resp.text)["SigninToken"]

# サインイントークンを使ってコンソールへのログインURLを組み立てる
login_params = {
    "Action": "login",
    "Issuer": "consoler.local",
    "Destination": console_endpoint + "?" + urllib.parse.urlencode(console_params),
    "SigninToken": fed_token
}
login_url = federation_endpoint + "?" + urllib.parse.urlencode(login_params)
```

処理は2段階のHTTPリクエストで構成される。まず `https://signin.aws.amazon.com/federation`（パーティションごとに異なるエンドポイントを自動選択、後述）に対して `Action=getSigninToken` と一時認証情報のJSONを送り、`SigninToken` を取得する。次にそのトークンと `Action=login`、リダイレクト先の `Destination`（実際のコンソールURL）、任意の `Issuer` 文字列を組み合わせたURLを生成する。このURLをブラウザで開くと、ブラウザのCookieにセッションが確立され、対応するIAM principalとしてコンソールにログインした状態になる。これはAWS公式ドキュメントが定めるフェデレーション用URLの正規の構築手順そのものであり、aws_consolerはこの一連の手順（一時認証情報の用意、`getSigninToken`呼び出し、URL組み立て）を自動化しているに過ぎない。

なお `SessionDuration: 43200`（秒、すなわち12時間）はフェデレーションセッションの最大許容値である。

**重要な分岐点**: 入力された認証情報がすでに一時的なもの（STSが発行したセッショントークン付き）であれば、そのままフェデレーションに使える。しかし恒久的なIAMユーザーのアクセスキー（`AKIA`から始まるプレフィックス）が渡された場合、フェデレーションエンドポイントは恒久キーを直接は受け付けないため、aws_consolerは内部で `sts:GetFederationToken` を呼び出し、一時セッションに変換してから使う。

```python
elif session.get_credentials().get_frozen_credentials() \
        .access_key.startswith("AKIA"):
    sts = session.client("sts", endpoint_url=args.sts_endpoint)
    resp = sts.get_federation_token(
        Name="aws_consoler",
        PolicyArns=[
            {"arn": "arn:aws:iam::aws:policy/AdministratorAccess"}
        ])
```

ここでの `PolicyArns` に `AdministratorAccess` を指定している点は初見だと誤解しやすいが、これは「フェデレーションセッションに管理者権限を付与する」という意味ではない。`sts:GetFederationToken` で得られる実効権限は「元のIAMユーザーが持つ権限」と「ここで指定したポリシー」の**論理積（intersection）**であるとAWSの仕様で定められている。つまり `AdministratorAccess` を指定するのは、元の認証情報が持つ権限を可能な限りそのまま透過させる（上限を広く取っておき、実際の制約は元のIAMユーザー側のポリシーに委ねる）ための実務的なテクニックであり、権限を拡大する抜け道ではない。ソースコード中のコメントも「Effective access is calculated as the union of our permanent creds and the policies supplied here」と説明している（正確には「and」との積であり、和集合ではなく交差点である点に注意。コメント表現はやや簡略化されている)。

#### 主なCLIオプション

```bash
# アクセスキー・シークレット・セッショントークンを直接指定し、ブラウザで開く
aws_consoler -a <ACCESS_KEY_ID> -s <SECRET_ACCESS_KEY> -t <SESSION_TOKEN> -o

# ロールを引き受けてからコンソールに入る
aws_consoler -p <profile> -r arn:aws:iam::123456789012:role/SomeRole -o

# CLIプロファイルを使用
aws_consoler -p myprofile -o
```

`-r/--role-arn` を指定した場合は、`getSigninToken` を呼ぶ前にまず `sts:AssumeRole` でそのロールへスイッチする処理が入る。ソースコード上のコメントには「Stacking AssumeRole sessions together will generate a 400 error here」とあり、すでにAssumeRoleで得たセッション認証情報をさらに `GetFederationToken` に渡すような多重スタックはAWS側でエラーになる制約も明記されている。また `-eS/-eF/-eC`（STS/フェデレーション/コンソールの各エンドポイントを手動指定するオプション)は、社内プロキシ経由や中国リージョン・GovCloudなど特殊なパーティションで動作させる際に使う高度なオプションである。パーティション判定はリージョン名の正規表現マッチ（`^cn-\w+-\d+$` など）によって自動化されている。

#### 防御的な観点での意義

インシデント対応では、漏えいした認証情報がどの範囲のコンソール操作を許すのかを、IAMポリシーを読み解くだけでなく実際の画面で素早く確認したい場面がある。aws_consolerはCLI認証情報からワンコマンドでコンソールセッションURLを生成できるため、対応チームが被害範囲を迅速に把握する助けになる。一方でこのツール自体が「認証情報さえあればコンソールに入れる」ことを再確認させる存在でもあり、防御側としては、漏えいした認証情報の即時失効（アクセスキーの無効化、STSセッションの取り消しが可能な場合は該当ロールの信頼ポリシー変更や `aws:TokenIssueTime` 条件によるセッション無効化）を優先する運用が重要である。

> 出典: aws_consoler README / ソースコード（`aws_consoler/logic.py`, `aws_consoler/cli.py`）— https://github.com/NetSPI/aws_consoler

### 3ツールの位置づけの整理

| ツール | 分析対象 | 手法 | 主な出力 |
|---|---|---|---|
| PMapper | アカウント全体のIAM principal間関係 | グラフ構築＋到達可能性シミュレーション | クエリ結果／SVGグラフ |
| Cloudsplaining | 個々のIAMポリシーのリソース制約有無 | 静的スキャン（`GetAccountAuthorizationDetails`） | HTML/JSONレポート |
| aws_consoler | 保有済み認証情報の実効的なコンソール権限 | AWS Federationエンドポイントの正規利用 | コンソールログインURL |

PMapperは「principal同士の間接的な到達可能性」という構造面のリスクを、Cloudsplainingは「個別ポリシーの記述レベルの緩さ」という設定面のリスクを、それぞれ異なる粒度で可視化する。両者を組み合わせることで、静的なポリシー記述の問題（Cloudsplaining）と、それが実際にどのような昇格チェーンを生むか（PMapper）の両面から監査でき、aws_consolerは監査で見つかったリスクの「実害があるかどうか」を実機のコンソール画面で確認する最終検証ステップとして位置づけられる。定期的な自動スキャンにCloudsplainingとPMapperを組み込み、重大な発見に対してのみaws_consolerで実際の影響を確認する、という段階的な運用が実務では現実的である。


---

[← 第4章 S3／ストレージバケットの攻撃](04-s3-bucket-attacks.md) ｜ [目次](index.md) ｜ [第6章 クラウド固有サービスの攻撃（Lambda/コンテナ/Secrets） →](06-cloud-native-services.md)
