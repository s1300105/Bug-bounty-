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
