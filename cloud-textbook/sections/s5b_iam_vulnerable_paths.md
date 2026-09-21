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
