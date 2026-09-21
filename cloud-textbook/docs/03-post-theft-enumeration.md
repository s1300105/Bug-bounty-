# 第3章 窃取クレデンシャル後のenumeration

## IAM権限の非破壊列挙（whoami）

### この節で学ぶこと

侵害したクレデンシャル（漏えいしたAWSアクセスキー、SSRF経由で取得したインスタンスメタデータの一時トークンなど）を手にしたとき、攻撃者・診断者がまず行うのは「このクレデンシャルは一体何ができるのか」を把握する作業である。これはLinux/Windowsの権限昇格調査における `whoami` や `id` に相当する、クラウド版の「己を知る」フェーズであり、実務では **enumeration（列挙）** と呼ばれる。

AWSのIAM（Identity and Access Management）はポリシーベースのアクセス制御であり、`GetCallerIdentity` のようなAPIを呼んでも「このプリンシパル（IAMユーザーやロールなど、AWSに対して操作を行う主体）に何の権限が付与されているか」までは直接教えてくれない。IAMポリシーの評価結果はAPIを実際に呼び出して初めて分かる。そのため、権限を知る方法は大きく2つに分かれる。

1. **能動的listing（対象アカウントに対する認証済みの列挙）**: `iam:GetPolicy` や `iam:ListAttachedUserPolicies` などIAM自体への読み取り権限があれば、ポリシードキュメントを直接読める。しかし多くの侵害クレデンシャルにはIAMへの参照権限すら付与されていない。
2. **受動的brute force（本節の主題）**: IAMへの参照権限がなくても、対象アカウント（=手元のクレデンシャルが属するアカウント）に対して大量の`Get*`/`List*`系APIを実際に叩き、`AccessDenied`にならなかった呼び出しの集合から権限を逆算する。

さらに、侵害クレデンシャルを使わずに「そもそもそのAWSアカウントにどんなIAMユーザー・ロールが存在するか」を、認証なしに外部から探る手法（unauthenticated enumeration）も存在する。これは横展開（lateral movement）やソーシャルエンジニアリングのターゲット選定に使われる偵察技術である。

本節では、この2系統（① 手持ちクレデンシャルの権限を非破壊に総当たりで洗い出す、② 認証なしにアカウント内のプリンシパルの存在を確認する）を、それぞれ仕組みレベルで解説する。いずれも本書のスコープ上、**実在サービス・本番環境への無許可の検証は行わない**という前提のもと、防御側（ブルーチーム、インシデントレスポンダー）が「攻撃者に何が見えているか」を理解するための知識として扱う。

---

### 3-1. なぜ「非破壊」列挙が必要なのか

侵害したクレデンシャルの権限を知りたいとき、最も乱暴な方法は「片っ端からAPIを叩いて試す」ことである。しかしAWSには `TerminateInstances`（EC2インスタンス削除）や `DeleteBucket`（S3バケット削除）のような破壊的APIも大量に存在する。総当たりの過程でこれらを誤って実行してしまえば、フォレンジック調査の証跡を壊し、対象システムに実害を与えかねない。

そこで列挙ツールは、原則として **`Get*` と `List*` から始まるAPI呼び出しのみ**を対象にする。これらは「情報を取得するだけ」で状態変更を伴わない（例外的に副作用のある`List*`系APIも稀に存在するため完全な安全性の保証ではないが、実務上のデフォルトとして広く採用されている規約である）。これが「非破壊列挙（non-destructive enumeration）」と呼ばれる所以であり、本節タイトルの「whoami」という比喩も、権限を変更せず現状を観測するだけという性質を表している。

---

### 3-2. ブルートフォース権限列挙の仕組み

#### 基本原理

IAMポリシー評価は「暗黙の拒否（implicit deny）→ 明示的許可（Allow）→ 明示的拒否（Deny、常に最優先）」という順で行われる。つまりポリシーに明記されていないAPIコールは自動的に拒否される。この性質を逆手に取り、任意のAPIをとにかく呼んでみて、

- `AccessDenied` エラーが返れば「その権限はない」
- 何らかの結果（成功レスポンス、あるいは`AccessDenied`以外のエラー、たとえば「リソースが存在しません」等）が返れば「その呼び出しを行うための権限は少なくとも通過した」

と判定する。これが「ブルートフォースIAM権限列挙」の core mechanism である。Hacking The Cloudの記述を借りれば、本質は次の一文に集約される。

> "trying as many safe API calls as possible, seeing which ones fail and which ones succeed"（安全なAPI呼び出しをできる限り多く試し、どれが失敗しどれが成功するかを観察する）

> 出典: Hacking The Cloud — Brute Force IAM Permissions — https://hackingthe.cloud/aws/enumeration/brute_force_iam_permissions/

なお「成功した」といっても、必ずしも意味のあるデータが返るとは限らない（アカウントにリソースが1つも無ければ空配列が返るだけのこともある）。重要なのは、**その呼び出しに必要な権限が付与されているという事実そのもの**である。攻撃者にとっては「`s3:ListAllMyBuckets` が通った」という事実だけで、次のステップ（バケット列挙、オブジェクト読み取りの試行）へ進む判断材料になる。

#### 代表ツール: enumerate-iam（Andrés Riancho）

`enumerate-iam` は、この総当たり列挙を自動化する代表的なOSSツールである。

```bash
./enumerate-iam.py --access-key $AWS_ACCESS_KEY_ID \
  --secret-key $AWS_SECRET_ACCESS_KEY \
  --session-token $AWS_SESSION_TOKEN
```

セッショントークンはSTS（Security Token Service）が発行する一時クレデンシャル（AssumeRoleやインスタンスメタデータサービス経由で取得したものなど）を扱う場合に必須で、アクセスキー・シークレットキーの恒久クレデンシャルのみの場合は省略できる。

**内部動作**:

- ツールはAWS各サービスのSDKクライアントを生成し、`get*`・`list*`で始まるメソッドのみを機械的に抽出してテスト対象とする。このテスト対象一覧は `enumerate_iam/bruteforce_tests.py` に保持されている。
- 各メソッドを実際に呼び出し、例外（`ClientError`で`AccessDenied`など）が出るか、成功するかを記録する。
- 成功した呼び出しはPythonの辞書（dict）としてまとめられ、後続処理（他ツールへの連携やスクリプトからの利用）がしやすい形で返る。

```python
from enumerate_iam.main import enumerate_iam
enumerate_iam(access_key, secret_key, session_token, region)
```

**出力例**（実行結果のログとして出力される、通った呼び出しの一覧）:

```
codestar.list_projects() worked
sts.get_caller_identity() worked
dynamodb.describe_endpoints() worked
sagemaker.list_models() worked
gamelift.list_builds() worked
sqs.list_queues() worked
```

なぜこの出力から権限が分かるのか。IAMポリシーのAction要素（例: `"Action": "s3:ListAllMyBuckets"`）は、対応するAPIオペレーション名（`ListBuckets`など、SDKメソッド名とAPIオペレーション名は完全一致しない場合もある）に1対1で紐づく。したがって「このメソッドが成功した」＝「対応するActionを許可するポリシーステートメントが、少なくとも1つ、このプリンシパルに適用されている」という推論が成り立つ。逆に`AccessDenied`であれば、明示的Denyか、暗黙的Deny（許可ポリシーが一切ない）のどちらかであり、いずれにせよそのActionは今は使えないと分かる。

**カバレッジの継続的更新**:

AWSは四半期ごとに新サービス・新APIをリリースするため、テスト対象リストが古いままでは新しいAPIの権限を見落とす。`enumerate-iam` はAWS公式のJavaScript SDKリポジトリからAPI定義を取り込み、テストケースを自動生成する仕組みを持つ。

```bash
cd enumerate_iam/
git clone https://github.com/aws/aws-sdk-js.git
python generate_bruteforce_tests.py
```

これは「AWSのAPIサーフェスは静的ではなく、ツールのシグネチャDBも定期更新が要る」という、脆弱性スキャナ全般に共通する保守上の教訓でもある。実務でこの種のツールを使う場合、最終更新日や対応API数を確認し、古いフォークを使い続けないことが重要である。

> 出典: enumerate-iam (Andrés Riancho) — https://github.com/andresriancho/enumerate-iam

#### 非破壊性の限界と運用上の注意

`enumerate-iam`のREADMEは明確に次のように述べている。

> "The calls performed by this tool are all non-destructive (only get* and list* calls are performed)"（このツールが行う呼び出しはすべて非破壊的である。get*とlist*のみを実行する）

とはいえ、これは「安全」を意味しても「無音」を意味しない。すべてのAPI呼び出しはCloudTrail（AWSのAPI監査ログサービス）に記録される。Hacking The Cloudは次のように明記している。

> "very noisy and will generate a ton of CloudTrail logs"（非常にノイジーで、大量のCloudTrailログを生成する）

> 出典: Hacking The Cloud — Brute Force IAM Permissions — https://hackingthe.cloud/aws/enumeration/brute_force_iam_permissions/

これは攻撃者視点では「他の列挙手段（例えば侵害元のログや設定ファイルからロール名・ポリシー構成が読み取れないか調べる、CloudTrailを閲覧できるなら既存の呼び出し履歴からヒントを得るなど）を先に使い切ってから最後の手段として使うべき」というOPSEC（作戦上のセキュリティ、footprintを最小化する考え方）上の指針になる。同時に防御側にとっては、これが検知の最大のチャンスであることを意味する。

**防御・検知の観点（本書の主眼）**

- **CloudTrail + GuardDuty**: 短時間に単一プリンシパル（同一のアクセスキーIDやロールセッション名）から異なる多数のサービス・APIへ`Get*`/`List*`呼び出しが連続する（そのほとんどが`AccessDenied`で終わる）パターンは、ブルートフォース列挙の典型的シグネチャである。Amazon GuardDutyには `Discovery:IAMUser/AnomalousBehavior` や、権限探索的な`AccessDenied`の連続に反応する検出ロジックが存在し、これらのアラートを監視パイプラインに組み込むことが有効である。
- **CloudTrailの`errorCode`フィールド**にフィルタをかけ、`AccessDenied`の発生数が短時間で異常値を示すプリンシパルをSIEM（Security Information and Event Management）上でアラート化する。
- **最小権限の原則（least privilege）**を徹底していれば、たとえ列挙されても攻撃者が得られる情報自体が少なくなる。侵害クレデンシャルの「効くAPI」が最初から狭ければ、次の横展開・権限昇格の選択肢も絞られる。
- 一時クレデンシャル（STS AssumeRoleで発行されるものなど）には有効期限があるため、**セッションの有効期限を短く設定**することで、たとえ列挙されても攻撃者が行動できる時間を制限できる。

---

### 3-3. 認証なしのIAMユーザー・ロール列挙

ブルートフォース権限列挙が「手元のクレデンシャルで何ができるか」を調べる技術であるのに対し、こちらは全く異なる前提に立つ。**対象アカウントの認証情報を一切持たずに**、そのアカウント内にどのIAMユーザーやロールが存在するかを外部から推測する手法である。これは横展開のターゲット選定や、フィッシング（対象組織で実際に使われているロール名・ユーザー名を掴んでおくことで、なりすましメールの説得力を上げるなど）の下調べに使われる。

#### 仕組み: AssumeRoleポリシーのエラーメッセージ差分を利用する

AWSのロールは、「誰がこのロールをAssumeできるか（信頼できるか）」を定義する **信頼ポリシー（trust policy / AssumeRolePolicyDocument）** を持つ。IAMロールにこのポリシーを設定する際、ポリシーのPrincipal要素には他アカウントのIAMユーザーやロールのARN（Amazon Resource Name、AWSリソースの一意識別子）を指定できる。

攻撃者は**自分が管理するAWSアカウント**の中に適当なロールを作り、その信頼ポリシーのPrincipalに「対象アカウントの、存在するかどうか確かめたいARN」（例: `arn:aws:iam::123456789012:role/admin-role`）を指定して更新を試みる。

- 指定したARNが**実在する**場合、AWSはARNの形式チェックのみを行い、ポリシー更新は**成功する**（IAMは、他アカウントのプリンシパルが実在するかどうかをこの時点ではまだ検証せず、後でAssumeRoleが呼ばれた時点で解決する設計のため、更新自体はエラーにならない）。
- 指定したARNが**実在しない**場合、AWSは更新時点でエラーを返す。

この「エラーが出るか出ないか」の差分だけで、対象アカウント内のプリンシパルの存在有無を、対象アカウントに一切ログを残さず（更新イベントは**攻撃者自身のアカウント**のCloudTrailに記録される、対象アカウント側には記録が残らない）確認できてしまう。

> 出典: Hacking The Cloud — Unauthenticated Enumeration of IAM Users and Roles — https://hackingthe.cloud/aws/enumeration/enum_iam_user_role/

#### 仕組み: S3バケットポリシーを使う派生手法

同様の原理はS3バケットポリシーでも成立する。攻撃者は自分が所有するS3バケットに対し、「対象アカウントの特定IAMロールに明示的にDenyする」ポリシーステートメントを追加しようとする。指定したロールARNが実在すればポリシーは受理され、実在しなければAWSはエラーを返す。バケットポリシーもリソースベースポリシーの一種であり、Principal要素に他アカウントのARNを指定できる点でAssumeRoleポリシーの手法と原理は共通している。

#### 仕組み: AWSコンソールのサインイン画面によるルートアカウントのメール確認

さらに、これはIAMユーザー/ロールではなくAWSアカウントのルート（root）に紐づくメールアドレスの実在確認だが、同じ「エラーメッセージの差分」という発想の応用として紹介されている。AWSサインインページに登録済みメールアドレスを入力するとパスワード入力画面に遷移するが、未登録のメールアドレスを入力すると次のエラーが返る。

```
There was an error - An AWS account with that sign-in information does not exist.
```

この応答の違いから、あるメールアドレスがAWSアカウントに紐づいているかどうかを、認証なしで外部から判定できる。

> 出典: Hacking The Cloud — Unauthenticated Enumeration of IAM Users and Roles — https://hackingthe.cloud/aws/enumeration/enum_iam_user_role/

#### この手法が成立する根本原因（仕組みレベルの整理）

共通する原理は、**リソースベースポリシー（バケットポリシーや信頼ポリシーなど、リソース側にPrincipalを書き込む形式のポリシー）を更新するAPIが、ポリシー文法上のARN形式チェックのみを行い、参照先プリンシパルの実在チェックを更新時点では行わない（実在チェックは実際にそのポリシーが評価される瞬間、つまりAssumeRoleが呼ばれた時などに遅延して行われる）**という、AWS IAMの実装上の仕様である。この非同期な検証タイミングのズレが、サイドチャネル（本来意図されていない情報漏えい経路）として悪用される。

このクラスの手法は、サービスによって挙動が異なりうる（後継サービスやAPIのアップデートでエラー文言・タイミングが変わることもある）ため、**2024年前後に公開されたHacking The Cloudの記述時点の挙動**として理解し、実際の防御設計をする際は自社環境のAWSアカウント・IAM設定の現状挙動を必ず確認すべきである。本書はこの手法の実行方法自体を推奨するものではなく、攻撃者がどのような偵察を行いうるかを理解するための解説である。

#### 利点（攻撃者視点・防御設計のために理解しておくべき点）

- **対象アカウントの認証情報が一切不要**: 操作はすべて攻撃者自身のアカウント内で完結する。
- **サービスリンクロール（service-linked role）の存在確認を通じて、対象アカウントが有効化しているAWSサービスまで分かる**: 例えばGuardDutyやOrganizationsを有効化しているアカウントには、それぞれ専用の命名規則を持つサービスリンクロールが自動作成される。これらのロール名の実在を先の手法で確認できれば、「対象組織がGuardDutyを有効化しているか」といった、セキュリティ体制に関する情報まで間接的に推測できてしまう。
- **スケールする**: ワードリスト（想定されるロール名・ユーザー名のリスト）を用意して機械的に繰り返せるため、大量のプリンシパル名を短時間で確認できる。

#### 関連ツール

- **Quiet Riot**: 設定可能なワードリストを用いて、この種の列挙を自動化するツール。
- **Pacu の `iam_enum_roles` モジュール**: AWSペネトレーションテストフレームワークPacuに組み込まれた、ロール列挙専用モジュール。
- **`enumerate_iam_using_bucket_policy`**: バケットポリシーを使った列挙手法を自動化するカスタムスクリプト群の総称として言及される。

#### 検知（対象アカウント側 vs 攻撃者アカウント側の非対称性に注意）

ここで防御側が最も注意すべきは、**この手法の主要な部分（AssumeRoleポリシー更新やバケットポリシー更新のイベント）は攻撃者自身のAWSアカウントのCloudTrailに記録され、標的となった側のアカウントには痕跡が残らない**という非対称性である。つまり、対象組織のセキュリティチームがCloudTrailをいくら監視していても、このフェーズの偵察活動そのものを検知することは原理的にできない。

したがって防御側が取りうる現実的な対策は次のようになる。

- **命名規則の秘匿性に頼らない設計**: ロール名・ユーザー名が推測されること自体を防御の前提にしない。命名規則が漏れても実害が出ないよう、信頼ポリシーの`Condition`要素（`sts:ExternalId`の要求や、`aws:PrincipalOrgID`によるAWS Organizations内への限定など）で実際のAssumeRoleを厳格に制限する。
- ルートアカウントについては、MFA（多要素認証）の強制と、ルートアカウント自体を通常業務で使わない運用（IAM Identity Centerなどのフェデレーションに寄せる）によって、たとえメールアドレスの実在が推測されてもログイン試行自体を無力化する。
- サービスリンクロールの存在から有効化サービスが推測される点は、「セキュリティ体制の詳細を外部に晒さない」という一般的な情報漏えい最小化の観点から、必要以上にセキュリティ関連サービスの有効化状況を公開情報（採用ページの技術スタック紹介など）と結びつけないといった組織的対策で補う。

---

### 3-4. 侵害後のenumerationワークフローまとめ

ここまでの内容を、侵害クレデンシャルを手にした際の典型的な調査順序として整理する（攻撃者の思考をなぞることで、防御側はどこで検知・遮断すべきかを逆算できる）。

1. **`sts:get_caller_identity()`を最初に叩く**: これは多くのIAMポリシーで許可されていることが多く（デフォルトで拒否されないケースがある）、少なくとも「誰として振る舞っているか」（アカウントID・ユーザーARN）が分かる。これがすべての列挙の出発点になる。
2. **IAM自体への参照権限（`iam:List*`/`iam:Get*`）があるか試す**: あれば直接ポリシーを読めるため、以降のブルートフォースは不要になる。これが最も静かで確実な方法である。
3. **IAM参照権限がなければ、`enumerate-iam`のような非破壊ブルートフォースに切り替える**: `Get*`/`List*`のみを対象に総当たりし、通った呼び出しの集合から実効権限を逆算する。ただしこの時点でCloudTrailに大量のログが残ることを攻撃者は許容している。
4. **並行して、対象組織そのものの他のプリンシパルの存在を、認証なしのAssumeRoleポリシー/バケットポリシー手法で探ることもある**: これは侵害クレデンシャルとは独立して、偵察の初期段階から実行可能である。

この一連の流れを理解しておくことは、インシデントレスポンダーが「侵害後どの段階まで進行したか」をCloudTrailのログパターン（`AccessDenied`の急増、`sts:GetCallerIdentity`の呼び出しタイミング、IAM系APIへの参照試行の有無）から推定する上で直接役に立つ。

---

### まとめ

- クラウド版の「whoami」は、IAMポリシーを直接読む権限がない場合、`Get*`/`List*`系APIを実際に叩いて成否を観察する非破壊ブルートフォースによって代替される。`enumerate-iam`はこの代表ツールであり、APIカバレッジをAWS SDKから自動生成して継続更新する設計を持つ。
- この手法は非破壊ではあるがCloudTrailに大量のログを残すため「静かではない」。防御側にとっては、短時間・多サービス・高`AccessDenied`率というパターンがブルートフォース列挙の強いシグナルになる。
- 認証なしのIAMユーザー・ロール列挙は、リソースベースポリシー（AssumeRoleの信頼ポリシーやS3バケットポリシー）の更新APIが、参照先プリンシパルの実在チェックを遅延させる実装仕様を悪用したサイドチャネルであり、対象アカウント側にはログが残らないという非対称性が防御を難しくする。ここでの防御の要点は「検知」ではなく「たとえ存在が推測されても実害に繋がらない設計（Condition要素による厳格な信頼制限、MFA強制）」に置くべきである。

## CloudFoxによる攻撃経路の状況把握

窃取した、あるいは正規の手続きで発行されたクラウド認証情報（アクセスキー、一時トークン、インスタンスロールなど）を手にした直後、攻撃者（および防御側のレッドチーム・侵害シミュレーション担当者）が最初に行うのは「この認証情報で何ができるのか」を体系的に把握する作業である。AWS CLIやAzure CLI、`gcloud`を1コマンドずつ手で叩いて権限やリソースを洗い出すのは非現実的なほど時間がかかる。この「状況認識（situational awareness）」を自動化するために作られたのが、Bishop Fox社が開発するオープンソースのコマンドラインツール **CloudFox** である。

CloudFoxは公式に「Automating situational awareness for cloud penetration tests（クラウドペネトレーションテストにおける状況認識の自動化）」と位置づけられており、侵入した認証情報や割り当てられたテスト用ロールを使って、クラウド環境の全体像を素早く可視化することに特化している。本節では、CloudFoxがどのような問いに答えるために設計されているか、代表的なコマンド群がそれぞれ何を出力するか、そしてその出力を攻撃経路（アタックパス）の発見にどう結びつけるかを、AWSを中心に解説する。

> 出典: BishopFox/cloudfox（GitHubリポジトリ） — https://github.com/BishopFox/cloudfox

### CloudFoxが解決しようとしている問題

クラウド環境のペネトレーションテストや侵害後調査（post-compromise enumeration）では、次のような問いに答える必要がある。

- このアカウントはどのリージョンを使っており、どれくらいの規模のリソースが存在するか
- EC2のユーザーデータやECS/Lambdaの環境変数に、ハードコードされたシークレット（APIキーやパスワードなど）が紛れ込んでいないか
- 管理者権限（Administrator相当）を持つロールがどのワークロード（EC2インスタンス、Lambda関数、ECSタスクなど）にアタッチされているか
- 手元のプリンシパル（IAMユーザーやロール）は、具体的にどのアクションを実行できるのか
- IAMロールの信頼ポリシー（trust policy）が過度に緩く、想定外のアカウントやプリンシパルからassume可能になっていないか
- インターネットから到達可能な、あるいは内部ネットワークから到達可能なエンドポイントはどこにあるか

これらは一つひとつがAWS CLIの個別コマンド（`iam list-roles`、`ec2 describe-instances`、`s3api list-buckets`等）を積み重ねれば手作業でも調べられるが、リソース数が数百〜数千に及ぶ実運用環境ではそれ自体が非現実的な作業量になる。CloudFoxはこれらの調査をコマンド単位で自動化し、CSV/テーブル形式の一覧と、次の調査に使える「loot（戦利品）ファイル」（実行可能なコマンド例をまとめたテキストファイル）を出力することで、攻撃経路の発見を高速化する。

対応クラウドプロバイダーとコマンド規模の目安は次の通りである（バージョンにより増減するが、2024〜2025年時点でAWS向けが最も充実している）。

| プロバイダー | 概算コマンド数 | 成熟度の目安 |
|---|---|---|
| AWS | 30以上 | 最も機能が充実、実運用での利用実績が豊富 |
| GCP | 多数（60前後） | 継続的に拡充中 |
| Azure | 少数（数個） | 発展途上 |

本節ではAWS向けコマンドを中心に扱うが、考え方（列挙→権限確認→信頼関係確認→エンドポイント特定という流れ）はどのプロバイダーでも共通している。

### インストールと前提条件

CloudFoxはGoで書かれたシングルバイナリのツールで、複数の方法でインストールできる。

```bash
# 1. GitHub Releasesからビルド済みバイナリを取得
# 2. Homebrew（macOS/Linux）
brew install bishopfox/tap/cloudfox

# 3. Goのツールチェーンで直接ビルド
go install github.com/BishopFox/cloudfox@latest

# 4. ソースからのビルド（開発者向け）
git clone https://github.com/BishopFox/cloudfox
cd cloudfox && go build
```

AWSに対して実行する場合、事前にAWS CLI用の認証情報（アクセスキー、`~/.aws/credentials`のプロファイル、環境変数、あるいはEC2インスタンスメタデータサービス経由で取得したロール認証情報）が設定されている必要がある。CloudFoxはAWS SDK for Goを内部で利用しており、AWS CLIと同じ認証情報解決の優先順位（環境変数 → 共有設定ファイル → EC2/ECSメタデータ、など）に従う。これはつまり、侵害後に手に入れた一時的なSTSトークン（`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN`）をそのまま環境変数にエクスポートするだけで、CloudFoxをそのセッションの視点から動かせるということである。

読み取り専用の「ホワイトボックス」運用（自分たちの環境を正規の許可の下で評価する場合）では、Bishop Foxが提供するCloudFox用のIAMポリシー（`SecurityAudit`管理ポリシーに、CloudFoxが必要とする追加の読み取り専用アクションを足したもの）をアタッチしたロールで実行することが推奨されている。侵害シナリオを模した「ブラックボックス」運用では、発見した認証情報をそのまま使い、権限不足で失敗したAPI呼び出しは静かにスキップされる。つまり「CloudFoxの出力に現れたリソース＝その認証情報でアクセス可能な範囲」という読み方ができ、出力の量そのものが権限の広さを示す指標になる。

> ⚠️ **スコープ上の注意**: 本教科書は防御目的の解説である。CloudFoxを実際の環境に対して実行する場合は、必ず自分が管理する環境、または書面で許可を得たペネトレーションテストの対象環境に限定すること。無許可の本番環境や第三者のクラウドアカウントに対する列挙は、たとえ「読み取り専用」であっても不正アクセスに該当し得る。

### 基本的な実行方法

最も基本的な使い方は、AWSプロファイルを指定して「すべてのチェック」を一括実行することである。

```bash
cloudfox aws --profile [profile-name] all-checks
```

`all-checks`は、後述する個別コマンド（`outbound-assumed-roles`を除く）をまとめて実行するメタコマンドであり、`inventory`・`principals`・`permissions`・`instances`・`endpoints`・`buckets`・`role-trusts`・`access-keys`・`secrets`・`lambda`・`ecr`など、代表的な列挙を一度に走らせる。結果は既定でカレントディレクトリ配下の`~/.cloudfox/`（または指定した出力先）にアカウントID・リージョンごとに整理されたテーブル形式・CSV形式のファイルとして保存され、加えて実行可能なコマンド例をまとめた「loot」ファイルが生成される。この loot ファイルが重要で、たとえば発見したS3バケットに対する`aws s3 ls`コマンドや、発見したRDSインスタンスへの接続文字列が、コピー＆ペーストしてすぐ使える形で書き出される。これにより「発見（列挙）」から「次の一歩（検証・深掘り）」への移行が非常に速くなる。

> 出典: BishopFox/cloudfox（GitHubリポジトリ、README） — https://github.com/BishopFox/cloudfox

### 状況把握の全体像を掴む: inventory

侵害後に最初に実行すべきコマンドの一つが`inventory`である。

```bash
cloudfox aws --profile [profile-name] inventory
```

これは「このアカウントはどのリージョンを実際に使っているか」「サービスごとにどれくらいの数のリソースが存在するか」を素早く一覧化するためのコマンドで、以降の詳細な列挙をどのリージョンに絞って行うべきかの判断材料になる。AWSはデフォルトで多数のリージョンが有効になっているが、実運用でリソースが存在するのは通常一部のリージョンに限られる。`inventory`の出力を見ることで、無駄なAPI呼び出し（＝ログに残る痕跡や実行時間）を減らしつつ、優先的に調べるべき領域を絞り込める。

### プリンシパルと権限の把握: principals / permissions / access-keys

IAMまわりの列挙は攻撃経路発見の中核である。

**`principals`** はアカウント内のすべてのIAMユーザーとIAMロールを列挙する。

```bash
cloudfox aws --profile [profile-name] principals
```

出力は「35 IAM principals found」のように総数とともに、各プリンシパルのARN、作成日、直近の利用状況などをテーブルにまとめる。これにより、そもそもこのアカウントにどれだけの「乗っ取り候補」（横展開・権限昇格の踏み台になり得るユーザー/ロール）が存在するかを俯瞰できる。

**`permissions`** は、列挙したすべてのプリンシパルにアタッチされたIAMポリシー（マネージドポリシー・インラインポリシー双方）を展開し、プリンシパルごとにどのアクションが許可されているかを一覧化する。

```bash
cloudfox aws --profile [profile-name] permissions
```

AWS マネジメントコンソールでポリシーを1つずつ開いて`Action`フィールドを目視確認するのは、ポリシー数が多い環境では非現実的である。`permissions`コマンドはこれを展開・フラット化し、grepで検索可能な形式（例えば`iam:*`や`sts:AssumeRole`といったアクション名で絞り込める形式）で出力する。実運用では「3889 unique permissions identified」のように、アカウント全体でユニークなパーミッションの総数が報告されることもあり、環境の複雑さを定量的に把握する材料にもなる。攻撃側の視点で言えば、ここで`iam:PassRole`＋`ec2:RunInstances`のような権限昇格につながる組み合わせや、`iam:CreateAccessKey`のような直接的な乗っ取りに使える権限を持つプリンシパルを素早く見つけ出すのが目的である。

**`access-keys`** は、すべてのIAMユーザーが保有するアクセスキーIDをマッピングする。

```bash
cloudfox aws --profile [profile-name] access-keys
```

これは、コードリポジトリやSlack、公開バケットなどで漏洩したアクセスキーIDを見つけた場合に「このキーはどのユーザーに属するものか」を特定するために使える。CloudFoxは実行結果を`access-keys.txt`のようなloot形式でも書き出すため、他の情報源（漏洩調査ツールなど）と突き合わせる際の突合台帳としても機能する。

なぜこの3コマンドの組み合わせが重要かというと、クラウド環境での権限昇格（プリビレッジエスカレーション）の多くは「単一の強力な権限」ではなく「複数の一見無害な権限の組み合わせ」によって成立するためである。`principals`で対象母集団を洗い出し、`permissions`で各プリンシパルの権限セットを可視化し、`access-keys`で認証情報そのものの所在を把握する、という三段構えが、権限昇格パスの発見を体系的に進めるための基盤になる。

### 権限を「実際に試す」: iam-simulator と pmapper 連携

`permissions`コマンドがポリシードキュメントの静的な展開であるのに対し、**`iam-simulator`** はAWSのIAMポリシーシミュレーターAPI（`iam:SimulatePrincipalPolicy`）を利用して、特定のプリンシパルが特定のアクションを実際に実行できるかどうかを動的に検証する。

```bash
cloudfox aws --profile [profile-name] iam-simulator
```

これは、SCP（Service Control Policy）や境界ポリシー（permissions boundary）、リソースベースポリシーなど、単純なIAMポリシーの読み取りだけでは判断できない「実効的な許可・拒否」を確認するために重要である。IAMの評価ロジックは「明示的なDeny＞SCPによる許可範囲の制限＞IAMポリシーによる許可＞暗黙のDeny」という順序で評価されるため、ポリシーのAllow文を読んだだけでは実際にそのアクションが通るかどうか確定できない場合がある。シミュレーターAPIを使うことで、この評価の結果だけを安全に（実際にAPIを叩かずに）確認できる。

さらに、CloudFoxのドキュメントでは**pmapper**（AWS IAM特権昇格経路の探索に特化した別のオープンソースツール、正式名 PMapper／Principal Mapper）とのデータ連携が推奨されている。role-trustsやpermissionsの生データをpmapperに読み込ませることで、「AがBをassumeでき、BがCに対して権限昇格できる」といった複数ホップにまたがる特権昇格グラフを構築できる。CloudFoxは「広く浅く」現状を一覧化するのに向いており、pmapperは「その一覧の中から具体的にどの経路が特権昇格に繋がるか」をグラフ探索で特定するのに向いている、という役割分担になる。

### ロールの信頼関係を洗い出す: role-trusts / resource-trusts

IAMロールにはそれぞれ「信頼ポリシー（trust policy、正式には AssumeRolePolicyDocument）」が付与されており、「誰が（どのプリンシパルが）このロールをassumeできるか」を定義している。**`role-trusts`** はアカウント内の全ロールの信頼ポリシーを収集し、それぞれがどのプリンシパル・サービス・外部アカウントを信頼しているかを一覧化する。

```bash
cloudfox aws --profile [profile-name] role-trusts
```

出力にはユーザー/ロールによる信頼関係、AWSサービス（例: `ec2.amazonaws.com`、`lambda.amazonaws.com`）による信頼関係、そしてSAMLやOIDCなどのフェデレーションによる信頼関係が含まれる。ここで特に注意すべきなのが「クロスアカウント信頼」である。信頼ポリシーのPrincipalに、自分たちが管理していない外部のAWSアカウントIDがワイルドカード的に（あるいは`Condition`による絞り込みなしに）指定されていた場合、その外部アカウントの誰か（あるいはその外部アカウントが侵害された場合の攻撃者）が、このロールをassumeしてアカウント内部に侵入できてしまう。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:root"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

上記のような信頼ポリシーは、外部委託先やSaaSベンダーとの統合のために意図的に設定されることが多いが、`sts:ExternalId`条件が付与されていない場合、「混乱した代理人（confused deputy）」問題（第三者Aのために用意したはずの入り口を、AとなりすませばAでない第三者Bも通過できてしまう問題）につながりやすい。`role-trusts`は、こうした信頼関係を一括で可視化し、特定のアカウントIDやプリンシパルに対する信頼を検索できるようにすることで、この種の設定ミスを効率的に見つけ出すことを目的としている。

信頼ポリシー（誰がこのロールを引き受けられるか）と対になる概念が「リソースベースポリシー」（誰がこのリソースそのものを操作できるか）である。CloudFoxの**`resource-trusts`**（および個別のリソース列挙コマンド群、例えば`buckets`のバケットポリシー確認）は、S3バケットポリシーやKMSキーポリシー、Lambdaのリソースベースポリシーなどを横断的に検査し、過度に許容的な設定（例えば`Principal: "*"`かつ`Condition`なしのAllow）を検出する。これらはいずれも「本来アカウント内部に閉じているはずのアクセス制御が、外部に対して意図せず開いている」パターンを探すという点で共通しており、クラウド環境における最も典型的かつ実害の大きい設定ミスの一つである。

### ワークロードとシークレットの列挙: instances / lambda / env-vars / secrets

信頼関係やIAM権限の分析と並行して重要なのが、「実行中のワークロードに埋め込まれたシークレット」の発見である。

**`instances`** はEC2インスタンスの一覧、アタッチされたIAMインスタンスプロファイル（ロール）、パブリック/プライベートIPアドレスを列挙する。`--userdata`オプションを付けると、各インスタンスに設定されたユーザーデータスクリプト（起動時に実行される初期化スクリプトで、しばしばデータベースの接続文字列やAPIキーがハードコードされている）を取得し、後段の秘密情報探索の材料にする。

```bash
cloudfox aws --profile [profile-name] instances --userdata
```

**`lambda`** はLambda関数の一覧と、それぞれの実行ロール（execution role）を突き合わせ、管理者相当の権限を持つロールがアタッチされた関数を優先的に識別する。関数コードそのものをダウンロードするためのコマンド例もloot出力に含まれる。

**`env-vars`** はLambda、ECS、App Runnerなどのマネージドコンピュートサービスに設定された環境変数を横断的に抽出し、その中にハードコードされたシークレット（APIキー、DBパスワードなど）が含まれていないかをパターンマッチングで検索する。

**`secrets`** はAWS Secrets ManagerとSSM Parameter Store（特にSecureString型ではなく平文で保存されているパラメータ）を列挙する。これらのサービスは本来シークレットを安全に保管するためのものだが、アクセス権限の設定ミスにより、想定より広い範囲のプリンシパルから読み取り可能になっているケースが少なくない。

これらのコマンドが重要である理由は、IAM権限の分析だけでは「その先」に辿り着けないケースが多いためである。たとえば、あるプリンシパルの直接のIAM権限は限定的でも、そのプリンシパルがアクセスできるEC2インスタンスのユーザーデータやLambdaの環境変数に、別の（より強力な）ロールの認証情報やデータベースの管理者パスワードがハードコードされていれば、そこを経由して実質的な権限昇格が成立してしまう。CloudFoxはこの「静的な設定の中に埋め込まれた動的な認証情報」を機械的に洗い出すことで、IAMポリシーグラフだけでは見えない攻撃経路を補完する。

### 外部から見える面を洗い出す: endpoints / network-ports

内部の権限関係と並んで重要なのが、「このアカウントの中で、外部（インターネット）または内部ネットワークから直接到達可能な面はどこか」という観点である。

**`endpoints`** はAPI Gateway、Lambda Function URL、RDS、CloudFront、ELB/ALBなど、複数のAWSサービスにまたがってエンドポイント（アクセス可能なURLやホスト名）を横断的に収集する。

```bash
cloudfox aws --profile [profile-name] endpoints
```

API Gatewayについては専用の**`api-gws`**コマンドもあり、各APIのエンドポイントに対してすぐに投げられる`curl`コマンドの雛形まで生成する。これは「エンドポイントの存在を確認する」だけでなく「実際に到達性を試す最初の一手」までを省力化するCloudFoxの設計思想を象徴する機能である。

**`network-ports`** はセキュリティグループとネットワークACL（NACL）を解析し、どのポートがどの送信元レンジに対して開かれているかを一覧化する。`0.0.0.0/0`のような広いCIDRに対して管理系ポート（22番のSSH、3389番のRDP、データベースの既定ポートなど）が開放されていないかを重点的に確認する材料になる。

**`elastic-network-interfaces`**（ENI）は、EC2だけでなくRDSやEFS、ELBが裏側で使用しているネットワークインターフェースまで含めてIPアドレスの対応関係を洗い出す。AWSのマネージドサービスは内部的にENIを介してVPC内に配置されることが多く、コンソールの通常画面からは見えにくいIP割り当てを可視化する目的で使われる。

これらのコマンドを組み合わせることで、「内部からは到達可能だが外部には閉じている」資産と、「外部から直接到達可能な」資産を切り分けられる。ペネトレーションテストの文脈では、後者が攻撃者にとっての初期アクセス経路の候補になり、前者は初期アクセス後の横展開（ラテラルムーブメント）の経路候補になる。

### クロスアカウントの特権昇格を俯瞰する: cape

複数のAWSアカウントを横断した組織（AWS Organizations配下のマルチアカウント環境）では、単一アカウント内のIAM分析だけでは不十分である。**`cape`**（Cloud Attack Path Enumerator の略に類する位置づけのサブコマンド）は、複数アカウントのプロファイルリストを受け取り、アカウントをまたいだ特権昇格経路（あるアカウントの低権限プリンシパルが、別アカウントの管理者ロールに到達できる経路）を列挙する。

```bash
cloudfox aws -l [profile-list-file] cape --admin-only
```

`--admin-only`オプションを付けることで、最終的に管理者権限に到達する経路だけに絞り込んで表示できる。これは、role-trustsコマンドが単一アカウント内で発見する「過度に緩い信頼関係」を、複数アカウントにまたがるグラフとして繋ぎ合わせ、組織全体としての最弱点（最も少ないホップ数で管理者権限に到達できる経路）を可視化するものである。マルチアカウント構成が一般化した現在のAWS運用において、単一アカウント視点の分析だけでは見落とされがちな経路を補完する重要な機能である。

### CloudFoxの出力をどう読むか: ホワイトボックスとブラックボックスの違い

CloudFoxの結果を解釈する上で重要なのが、実行時にどのような認証情報を使ったかという文脈である。

- **ホワイトボックス運用**: 評価対象の組織自身が、意図的に広い読み取り権限（`SecurityAudit`ポリシー相当）を与えたロールでCloudFoxを実行するケース。この場合、出力は「環境全体の設定状況」を網羅的に示すものであり、見つかった問題点（緩い信頼ポリシー、公開されたシークレットなど）はそのまま是正すべき対象としてリストアップできる。
- **ブラックボックス（侵害シミュレーション）運用**: フィッシングやサプライチェーン侵害などを模して実際に窃取された、あるいは低権限のテスト用認証情報でCloudFoxを実行するケース。この場合、権限不足のAPI呼び出しは静かに失敗し、CloudFoxの最終出力にはその認証情報から「実際に見えている」リソースだけが残る。つまり出力そのものが「この認証情報が漏洩した場合に、攻撃者から現実に見える攻撃対象範囲」を意味する。

防御側にとって重要なのは、後者の視点でCloudFoxを定期的に実行し、「本来最小権限であるべきロールから、想定以上の情報が見えていないか」を継続的に検証することである。これはクラウド環境における最小権限の原則（Principle of Least Privilege）が、ポリシードキュメントの記述上だけでなく、実際の実効権限として維持されているかを確認する実践的な手段になる。

### まとめ: CloudFoxが教えてくれる「次の一手」

CloudFoxの価値は、単に個々のAWS APIをラップして高速化することではなく、「侵害後の状況認識」を一連のワークフローとして体系化した点にある。おおまかな流れをまとめると次のようになる。

1. `inventory`で全体規模とアクティブなリージョンを把握する
2. `principals`・`permissions`・`access-keys`で「誰が」「何を」できるかを可視化する
3. `role-trusts`・`resource-trusts`で「信頼関係の緩み」を探す
4. `instances`・`lambda`・`env-vars`・`secrets`で「埋め込まれたシークレット」を探す
5. `endpoints`・`network-ports`・`eni`で「外部・内部からの到達可能性」を確認する
6. 複数アカウント環境では`cape`でアカウント横断の特権昇格経路を俯瞰する
7. 必要に応じて`iam-simulator`やpmapper連携で、個別の権限を動的に検証する

このワークフローは、窃取したクレデンシャルを手にした攻撃者が最短経路で「管理者権限への到達」「機微データへのアクセス」を模索する際の思考プロセスそのものであり、防御側にとっては、自組織の環境がその思考プロセスに対してどれだけ耐性があるかを事前に検証するための実践的なチェックリストとして活用できる。

> 出典: CloudFox based AWS Enumeration Techniques（ArshadKhanShajahan, Medium） — https://medium.com/@akarshad428/cloudfox-based-aws-enumeration-techniques-125719810556
>
> ⚠️ **一部未取得の資料**: 上記Medium記事は自動取得時にHTTP 403（アクセス拒否）となり、本文全体を直接取得することはできませんでした。検索結果から得られた要約情報（principals・permissions・role-trusts・all-checksの概要）のみを反映しています。詳細な図解やコマンド別のスクリーンショットについては、ご自身で直接記事をご覧ください: https://medium.com/@akarshad428/cloudfox-based-aws-enumeration-techniques-125719810556

## 鍵発見→権限検証のワークフロー

クラウド環境の侵入テスト・バグバウンティにおいて、AWSアクセスキー（`AKIA...` などの Access Key ID と Secret Access Key のペア、あるいは一時的な STS トークンの組）を発見した後の最初の一手は「破壊」ではなく「観測」である。攻撃者・診断者が最初に行うべきは、その鍵がどのアカウントに属し、どんな IAM（Identity and Access Management、AWSのアクセス制御基盤）権限を持っているかを **非破壊的に** 洗い出すことだ。本節では、鍵を発見してから権限を検証するまでの実務的なワークフローを、代表的な2つのOSSツール・記事から具体的なコード例とともに解説する。

このワークフローは大きく2段階に分かれる。

1. **鍵発見（Secret Discovery）**: ソースコード、JSファイル、Gitコミット履歴、公開バケットなどから漏洩したAWS認証情報を見つける。
2. **権限検証（Permission Enumeration / Privilege Enumeration）**: 見つかった鍵が「有効か」「どのサービス・どのAPIコールが許可されているか」をブラックボックスに近い形で洗い出す。鍵の持ち主に問い合わせずとも、AWS APIへの実際の呼び出しが成功するか失敗するかという応答だけを手がかりに権限を推定する。

### なぜ「試して応答を見る」しかないのか

AWSのIAMには「このユーザーは何ができるか」を一覧表示する単一のAPIは存在しない（`iam:GetAccountAuthorizationDetails` は強力な管理者権限がなければ呼べず、そもそも権限がなければこの情報自体を見ることができない）。そのため、攻撃者側の一般的な手法は「各サービスの代表的なAPIコール（多くは `List*` や `Describe*` といった読み取り専用の列挙系API）を総当たりで呼び出し、`AccessDenied` エラーが返るか、正常応答が返るかを見て権限を逆算する」というものになる。これは典型的なブラックボックス列挙で、HTTPステータスコードや例外の型がそのままオラクル（真偽を判定する手がかり）として機能する仕組みだ。

- 呼び出しが成功する → そのAPIアクションに対応するIAMポリシーの `Allow` が存在する（少なくとも明示的な `Deny` はない）。
- `AccessDeniedException` が返る → そのアクションは許可されていない。
- `InvalidClientTokenId` が返る → 鍵自体が無効（削除済み、タイプミス、ローテーション済みなど）。
- `SubscriptionRequiredException` などのエラー → 権限はあるがサービス自体が有効化されていない、あるいはルートキー的な広い権限を持っている兆候。

この「Allow/Deny をAPIレスポンスから逆算する」原理は、Webアプリケーションにおけるブラインド脆弱性の列挙(例えばブラインドSQLi)と同じ発想であり、クラウドのIAMを対象にした偵察でも根本原理は変わらない。

---

### 1. weirdAAL（carnal0wnage、AWS Attack Library）

weirdAAL は carnal0wnage（Brian Fehrman/Rob Fuller界隈で知られるAWSペンテスト系リサーチャー）が公開している Python3 製の AWS 攻撃・偵察ライブラリで、READMEには一貫してプロジェクトの目的がこう明記されている。

> The WeirdAAL project has two goals:
> 1. Answer what can I do with this AWS Keypair [blackbox]?
> 2. Be a repository of useful functions (offensive & defensive) to interact with AWS services.

つまり「このAWSキーペアで何ができるかをブラックボックスで答える」ことと、「AWSサービスと対話する攻守両用の関数群を提供すること」が明確な設計目標であり、まさに本節のテーマである「鍵発見後の権限検証」を専門に扱うツールである。

#### セットアップの流れ

```bash
git clone https://github.com/carnal0wnage/weirdAAL.git
cd weirdAAL
python3 -m venv weirdAAL
source weirdAAL/bin/activate
pip3 install -r requirements.txt

# sqlite3 データベースの初期化（結果の保存先。これをやらないと動作しない）
python3 create_dbs.py
```

weirdAAL は boto3（AWSの公式Python SDK）をラップして動いており、`create_dbs.py` で `AWSKey`・`recon`・`services` という3つのテーブルを作るsqlite3データベースに、列挙結果を保存していく。これにより、複数の鍵を横断して「このキーはどのサービスにアクセスできたか」を後から検索できる、攻撃側の情報管理台帳のような役割を果たす。

#### 鍵の投入方法

```bash
cat env.sample
# [default]
# aws_access_key_id = <insert key id>
# aws_secret_access_key = <insert secret key>

cp env.sample .env
vi .env   # ここに発見したキーペアを書き込む
```

内部的には、weirdAAL は環境変数 `AWS_SHARED_CREDENTIALS_FILE` を `.env` で上書きすることで、boto3 にこの鍵を読み込ませている。boto3 は標準でSTS(Security Token Service)の一時トークンにも対応しているため、漏洩したものが長期キーではなく `aws_session_token` を伴う一時クレデンシャルであっても同じ枠組みで扱える。

#### recon_all: 総当たり列挙の中核モジュール

権限検証の最初の一歩は `recon_all` モジュールの実行である。

```bash
python3 weirdAAL.py -m recon_all -t MyTarget
```

`-t`（target）はターゲット名のラベルであり、実際のAWSアカウントIDやドメイン名ではなく、結果をDBに紐づけるための任意の識別子として使われる。

鍵が無効な場合、`get_accountid()` 関数内の例外ハンドリングが `botocore.exceptions.ClientError` を捕捉し、次のように早期終了する。

```python
def get_accountid():
    try:
        client = boto3.client("sts")
        account_id = client.get_caller_identity()["Account"]
        print("Account Id: {}".format(account_id))
    except botocore.exceptions.ClientError as e:
        if e.response['Error']['Code'] == 'InvalidClientTokenId':
            sys.exit("{} : The AWS KEY IS INVALID. Exiting".format(AWS_ACCESS_KEY_ID))
        ...
```

つまりまず `sts:GetCallerIdentity`（STSが提供する、認証情報の持ち主のアカウントIDとARNを返すだけの軽量API）を叩いて疎通確認をしている。このAPIは特別なIAM権限がなくても（ほぼ常に）呼び出せるため、鍵の有効性チェックに最適な「ノーコストのオラクル」として使われている。この設計判断は覚えておく価値がある。無権限でも呼べるAPIをまず1本通すことで、後続の数百コールを浪費せずに済む。

鍵が有効な場合、`recon_all` は `brute_*_permissions()` という命名規則の関数を、アルファベット順にほぼ全サービスぶん(数百個)呼び出していく。

```python
def module_recon_all():
    get_accountid()
    check_root_account()
    brute_accessanalyzer_permissions()
    brute_acm_permissions()
    brute_acm_pca_permissions()
    brute_alexaforbusiness_permissions()
    ...
    brute_cloudwatch_permissions()
    ...
```

各 `brute_<service>_permissions()` 関数は、その内部で該当サービスの「引数を必要としない読み取り系API」(例: `ec2.describe_instances()`, `s3.list_buckets()`)を `try/except botocore.exceptions.ClientError` で包んで叩き、成功すれば `[+] <service> Actions allowed are [+]` として一覧に追加、`AccessDeniedException` なら `[-] No <service> actions allowed [-]` として握りつぶす、という実装パターンになっている。これは「例外を制御フローとして使う」典型例であり、Pythonの `try/except` がそのままAWS側のポリシー評価結果を可視化するインターフェースとして機能している。

実行結果の例(README/Wikiより):

```
$ python3 weirdAAL.py -m recon_all -t MyTarget
Account Id: 382756349351
AKIAIXXXXXXXXXXXXXXX : Is NOT a root key
### Enumerating ACM Permissions ###
An error occurred (AccessDeniedException) when calling the ListCertificates operation:
User: arn:aws:iam::XXXXXXXXXXXX:user/training is not authorized to perform: acm:ListCertificates

[-] No acm actions allowed [-]
...
[+] ec2 Actions allowed are [+]
['DescribeInstances', 'DescribeInstanceStatus', 'DescribeImages', 'DescribeVolumes', ...]
...
[+] elb Actions allowed are [+]
['DescribeLoadBalancers', 'DescribeAccountLimits']
```

この出力からわかる通り、権限検証の本質は「AccessDeniedExceptionのエラーメッセージに含まれるARN(`arn:aws:iam::...:user/training`)からIAMユーザー名まで判明する」点も含めて、失敗レスポンスそのものが偵察情報の宝庫になっているということだ。エラーメッセージにユーザー名・アカウントIDが平文で含まれるのは、AWS側の仕様上避けられない挙動であり、これ自体が防御側の設計上の留意点になる(後述)。

#### list_services_by_key: 結果の集約表示

```bash
python3 weirdAAL.py -m list_services_by_key -t MyTarget
```

これは `recon_all` の実行結果をsqlite3データベースから読み出し、`<サービス>:<アクション>` の形式(IAMポリシーの `Action` フィールドと同じ表記)でフラットに列挙し直すモジュールである。

```
Services enumerated for AKIAXXXXXXXXXXXXXX
autoscaling:DescribeAccountLimits
...
ec2:DescribeInstances
ec2:DescribeInstanceStatus
...
sts:GetCallerIdentity
```

この一覧そのものが「このキーが持つIAMポリシーの実効的な許可アクション一覧(の下界)」であり、次の攻撃・調査ステップ(例えば `ec2_describe_instances_basic` モジュールで実際にインスタンス一覧を取得する、など)へ橋渡しする成果物になる。README記載のTLDR(要約)は次の4ステップに集約される。

```
1. cp env.sample を .env にコピーしキーペアを設定
2. python3 weirdAAL.py -m recon_all -t MyTarget
3. python3 weirdAAL.py -m list_services_by_key -t MyTarget
4. 利用可能なサービスから足がかりを広げる(ピボット)
```

#### モジュール構成

`modules/aws/` 配下には `iam.py`、`iam_pwn.py`、`s3.py`、`ec2.py`、`rds.py`、`sts.py`、`route53.py` など、サービスごとの攻守両用モジュールが多数収録されている。特に `iam_pwn.py` は「IAM権限そのものを悪用してさらに強い権限を得る(権限昇格)」ための調査に寄っており、鍵発見→権限検証の次段階である「権限昇格の糸口探し」にそのまま接続する設計になっている。ただし権限昇格や実際の悪用手順は本節のスコープ外であり、ここでは「検証(列挙)」までを扱う。

> 出典: WeirdAAL (AWS Attack Library) — https://github.com/carnal0wnage/weirdAAL （README/Wiki: Setup, Usage ページを含む）

---

### 2. Trufflehog + Enumerate-IAM: 鍵発見から権限検証までの実践フロー

#### 取得不可の資料についての注記

> ⚠️ **未取得の資料**: 「DrSecurityGuru氏によるMedium記事 “Unmasking AWS Secrets: My Journey with Trufflehog and Enumerate-IAM for Bug Bounty Hunters”」は自動取得できませんでした（理由: Mediumのbot対策によりHTTP 403 Forbiddenが返り、本文を取得できませんでした）。以下のURLからご自身で直接ご覧ください: https://medium.com/@earth22sky/unmasking-aws-secrets-my-journey-with-trufflehog-and-enumerate-iam-for-bug-bounty-hunters-9e5599df0c5a

代替として、同じ手法(Trufflehog拡張機能によるAWS鍵発見 → enumerate-iamによる検証)を扱う同系統の実在記事(0xKayala氏、HACKLIDO掲載、2023年1月公開)の本文を取得できたため、以下はその実物の内容に基づく解説である。手法・使用ツールが対象記事と一致しており、ワークフローの理解には十分な代表例となる。

#### ステップ1: ブラウザ拡張機能による鍵の発見

Trufflehog にはCLIツール版(Gitリポジトリのコミット履歴を正規表現/エントロピー解析でスキャンするもの)とは別に、ブラウザ拡張機能版が存在する。この拡張機能は、閲覧しているWebページが読み込む全JavaScriptソースをクロールし、AWSアクセスキーのパターン(`AKIA[0-9A-Z]{16}` に代表される固定プレフィックス+Base32的な文字列など)にマッチする文字列を自動検出してポップアップ通知する。

> I got a Pop-up saying that this website contains AWS API keys... Most of the time, it will show the exposed key and the path where it is present. You can also copy the path and leaked key from the Pop-up box.

これは、フロントエンドのJSバンドルに開発者が誤って本番用のAWSキーをハードコードしてしまうケース(例: S3への直接アップロード機能をクライアントサイドで実装する際にSDK初期化コードへ平文で埋め込む、CI/CDの環境変数がバンドルに焼き込まれる、等)を狙った受動的スキャンである。攻撃者は能動的にリポジトリを漁らずとも、通常のブラウジング中に自動で検出できてしまう点が実務上のリスクを高めている。

#### ステップ2: enumerate-iam による権限の検証

発見した鍵ペアの有効性と権限範囲を検証するために使われるのが `enumerate-iam`(andresriancho作)である。このツールはweirdAALと発想は同じだが、より軽量・高速に「総当たりでAPIを試す」ことに特化している。

```bash
git clone git@github.com:andresriancho/enumerate-iam.git
cd enumerate-iam/
pip install -r requirements.txt

./enumerate-iam.py --access-key AKIA... --secret-key StF0q...
```

公式READMEに掲載されている実行例:

```
2019-05-10 15:57:58,447 - [INFO] Starting permission enumeration for access-key-id "AKIA..."
2019-05-10 15:58:01,532 - [INFO] Run for the hills, get_account_authorization_details worked!
2019-05-10 15:58:26,709 - [INFO] -- gamelift.list_builds() worked!
2019-05-10 15:58:26,850 - [INFO] -- cloudformation.list_stack_sets() worked!
2019-05-10 15:58:26,982 - [INFO] -- directconnect.describe_locations() worked!
2019-05-10 15:58:27,311 - [INFO] -- sqs.list_queues() worked!
```

ログ中の "Run for the hills"(直訳: 逃げ出せ)というコメントは、`iam:GetAccountAuthorizationDetails` が成功したことを示している。このAPIはIAMユーザー・グループ・ロール・ポリシーの詳細な割り当て構造を丸ごと返す非常に強力な管理API であり、これが成功する鍵は事実上IAM管理者権限(あるいはそれに準ずる強い権限)を持つ「アタッカーにとっての大当たり」を意味する。ツールの作者が皮肉を込めてこの文言を選んでいる。

##### 実装原理: `bruteforce_tests.py` という「総当たり辞書」

enumerate-iam の核心は `enumerate_iam/bruteforce_tests.py` という、サービス名とその引数不要な列挙系API名を網羅したPythonの辞書(dict)である。README にはこの辞書の生成方法も明記されている。

```bash
cd enumerate_iam/
git clone https://github.com/aws/aws-sdk-js.git
python generate_bruteforce_tests.py
rm -rf aws-sdk-js
```

つまり、AWS公式のJavaScript SDK(`aws-sdk-js`)に含まれるサービス定義(各APIのメタデータ、特に「引数なしで呼べる`List*`/`Describe*`/`Get*`系API」)を機械的に解析し、総当たり対象のAPIコール一覧を自動生成している。AWSは四半期ごとに新サービスをリリースするため、この辞書は定期的に再生成しないと最新のサービスを見落とす、という保守上の注意点もREADMEに明記されている(バージョン依存性の高い設計であることに留意)。

各APIコールは `get*` または `list*` のみに限定されており、README上で明示的に非破壊(non-destructive)であることが強調されている。

> The calls performed by this tool are all non-destructive (only get* and list* calls are performed).

これは本教科書全体のスコープ制約(防御目的・非破壊)とも合致する重要な設計方針である。列挙自体は読み取り専用APIのみで完結し、リソースの作成・変更・削除は一切行わない。

##### ライブラリとしての利用

enumerate-iam はCLIだけでなくPythonライブラリとしても設計されており、他ツールへの組み込みを前提としている。

```python
from enumerate_iam.main import enumerate_iam

enumerate_iam(access_key, secret_key, session_token, region)
```

戻り値はPythonの辞書型で、許可されたAPIコールの一覧をプログラム的に扱えるため、自動化パイプライン(例: 発見した鍵を自動でこの関数に渡し、Slack通知や脆弱性管理システムに結果を投げる、といった仕組み)に組み込みやすい。

##### 記事における結果と限界

参照記事(HACKLIDO版)では、実際に検証した結果について次のように率直な限界が述べられている。

> There is no guarantee that the Leaked keys will be Valid and give more info at all times. I was fortunate to get some basic info which is of no use to increase the impact on the target.

つまり、鍵が「有効」であっても、必ずしも即座に重大な影響(インパクト)につながる情報が得られるとは限らない。IAMポリシーが最小権限の原則(Principle of Least Privilege)に沿って設計されていれば、`sts:GetCallerIdentity` 程度しか通らず、実害に乏しいケースも多い。バグバウンティの文脈では、この「有効性の確認」と「実害の証明(Proof of Impact)」は別工程であり、多くのプログラムでは単に鍵が有効であることを示すだけでは受理されず、実際にアクセスできたデータやリソースを(権限の範囲内で、かつ非破壊的に)示す必要がある点に注意したい。

> 出典: enumerate-iam (andresriancho) 公式README — https://github.com/andresriancho/enumerate-iam
> 出典(代替資料・同一手法の実例記事): "How I Found AWS API Keys using Trufflehog and Validated them using enumerate-iam tool" (0xKayala, HACKLIDO, 2023) — https://hacklido.com/blog/218-how-i-found-aws-api-keys-using-trufflehog-and-validated-them-using-enumerate-iam-tool
> 元々指定されていた資料: DrSecurityGuru「Unmasking AWS Secrets: My Journey with Trufflehog and Enumerate-IAM for Bug Bounty Hunters」 — https://medium.com/@earth22sky/unmasking-aws-secrets-my-journey-with-trufflehog-and-enumerate-iam-for-bug-bounty-hunters-9e5599df0c5a

---

### ワークフローの統合と防御的な示唆

ここまでの2つの資料を統合すると、鍵発見後のenumeration(列挙)ワークフローは次の5段階に整理できる。

1. **発見**: コード・JSバンドル・Git履歴・公開リポジトリから鍵パターンを検出(Trufflehog等の正規表現/エントロピーベースのスキャナ)。
2. **疎通確認**: `sts:GetCallerIdentity` のような無権限でも呼べるAPIで、鍵が有効かどうかだけをまず判定する(weirdAALの `get_accountid()` の設計思想)。
3. **総当たり列挙**: `List*`/`Describe*`/`Get*` 系の読み取り専用APIを辞書化し、`AllowedならOK・AccessDeniedならNG` という二値のオラクルとして大量に試行する(weirdAALの `brute_*_permissions()`、enumerate-iamの `bruteforce_tests.py`)。
4. **集約**: 許可されたアクションを `サービス:アクション` 形式で一覧化し、次のピボット先を判断する(`list_services_by_key`)。
5. **影響評価**: 単に鍵が有効というだけでなく、実際にどんなデータ・リソースへアクセスできるかを最小権限の範囲で確認し、インパクトを説明する。

防御側の観点では、この一連の手口を踏まえて次のような対策が有効である。

- **CloudTrailの異常検知**: 短時間に数百種類の異なるサービスへ `List*`/`Describe*` 系APIが呼ばれる(特に単一のIAMプリンシパルから、普段使わないサービスへ多数のAPIコールが飛ぶ)というパターンは、まさにこのenumerationツール特有の挙動であり、GuardDutyやCloudTrail Insightsでの検知ルールの対象にしやすい。
- **最小権限の徹底**: `iam:GetAccountAuthorizationDetails` のような強力な列挙系APIを一般ユーザーに許可しない。これが許可されていると、上述の "Run for the hills" のケースに直結する。
- **鍵の即時失効フロー**: 漏洩が疑われた時点で、まず該当のアクセスキーを無効化(`Inactive`化)し、その後にCloudTrailログで実際の悪用有無を確認する、という順序を徹底する。
- **JSバンドルへの機密情報混入防止**: フロントエンドのビルドプロセスでシークレットスキャン(gitleaks、trufflehog CLI等)をCI/CDに組み込み、ビルド成果物に鍵が焼き込まれることを未然に防ぐ。

これらのツールはいずれも「読み取り専用APIのみを使い、対象環境を変更しない」という設計上の制約を持つため、防御的な検証(自社環境に対する許可された診断)においても同様の手法で「意図せず広すぎる権限を持つIAMユーザー」を洗い出す監査ツールとして活用できる。実運用にあたっては、必ず対象アカウントの管理者権限を持つ者自身が、事前に許可された範囲内でのみ実施すべきである。


---

[← 第2章 SSRF→メタデータサービス→一時クレデンシャル窃取](02-ssrf-imds-credential-theft.md) ｜ [目次](index.md) ｜ [第4章 S3／ストレージバケットの攻撃 →](04-s3-bucket-attacks.md)
