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
