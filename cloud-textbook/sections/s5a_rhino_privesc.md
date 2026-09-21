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
