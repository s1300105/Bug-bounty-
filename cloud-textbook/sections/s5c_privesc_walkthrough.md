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
