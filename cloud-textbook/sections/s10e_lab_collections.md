## ガイド付きラボとCTF集約

クラウドセキュリティは座学だけでは身につきにくい分野である。IAM（Identity and Access Management、アイデンティティとアクセス管理）ポリシーの評価ロジック、メタデータサービスの挙動、権限昇格チェーンの組み立て方は、実際に脆弱な環境へアクセス制御を試し、失敗と成功を繰り返して初めて「仕組みレベル」で理解できる。本節では、防御的な学習目的で安全に使えるガイド付きラボプラットフォームと、無料で公開されているクラウドセキュリティCTF・自習環境の集約リストを紹介する。いずれも許可された学習用環境であり、実在の本番サービスに対する無許可の検証は対象外である。

### なぜハンズオン環境が必要か

クラウドの脆弱性は、Webアプリケーションのそれと異なり「単一のリクエストで再現できるバグ」ではないことが多い。たとえばIAMの権限昇格は、複数の小さな権限（`iam:PassRole`、`lambda:CreateFunction`、`lambda:InvokeFunction`など）が組み合わさって初めて成立する「攻撃パス」として現れる。こうしたパスは、実際にクラウドコンソールやCLI（Command Line Interface、コマンドライン操作用のツール）でAPIを叩き、ポリシー評価の結果を目で確認しないと直感が育たない。ガイド付きラボは、この試行錯誤を安全な使い捨て環境で行わせることで、学習者が「なぜこのポリシーだと昇格できるのか」という因果関係を体得できるようにする仕組みである。

### Pwned Labs — クラウド/AI/K8sのガイド付きラボ

Pwned Labsは、クラウド・AI・Kubernetes・CI/CD・ハイブリッド環境を横断した実践的なハンズオン型セキュリティ学習プラットフォームである。ブラウザベースでラボ環境が提供されるため、学習者自身がAWSアカウントやKubernetesクラスタを構築する必要がなく、参入障壁が低い点が特徴である。

#### 対象範囲と提供形式

対象となる技術スタックは以下の通り広範囲に及ぶ。

- **クラウドプラットフォーム**: AWS、Microsoft Azure、Google Cloud、Oracle Cloud Infrastructure（OCI）
- **SaaS/コラボレーション基盤**: Microsoft 365、Google Workspace
- **コンテナ/オーケストレーション**: Kubernetes
- **開発パイプライン**: CI/CD（継続的インテグレーション/継続的デリバリー）
- **新興領域**: AIシステム、LLM（大規模言語モデル）/チャットボット、AIエージェントに対する攻撃

提供形式は3種類に分かれており、学習の深度に応じて選択できる。

| 形式 | 内容 |
|---|---|
| Academy（アカデミー） | ガイド付きの段階的ラボ。無料プランでも一部利用可能で、初学者が仕組みを順を追って学べる |
| Bootcamps | インストラクター主導の集中講座。修了により認定資格を取得できる有料プログラム |
| Cyber Ranges | 本番環境に近い規模・複雑さを再現した攻防シミュレーション環境 |

#### 学習できる具体的なシナリオ

攻撃側（Red Team視点）のシナリオとしては、フィッシングを起点とした初期アクセス獲得、C2（Command and Control、攻撃者が侵害端末を遠隔操作する通信基盤）の確立とパーシステンス（persistence、再起動やログオフ後も攻撃者のアクセスを維持する手法）、LLMに対するプロンプトインジェクション（AIへの入力に悪意ある指示を混入させ、意図しない出力や権限逸脱を引き起こす攻撃）、認証情報の窃取と横展開（lateral movement、侵害した一台の権限を足がかりに他のリソースへ移動すること）が扱われる。

防御側（Blue Team視点）のシナリオとしては、テレメトリ（クラウド監査ログやメトリクスなどの観測データ）の収集とアラート設計、サイバーキルチェーン（攻撃者が目的達成までに踏む一連の段階モデル）に沿った検知ルールの作成、インシデント対応プレイブックの運用が含まれる。この両輪構成は、攻撃技術を学ぶだけでなく「その痕跡をどう検知し、どう対応するか」まで一貫して学べる設計になっている点が教育的に重要である。なぜなら、攻撃手法の理解と検知ロジックの設計は表裏一体であり、片方だけを学んでも実務の防御力にはつながりにくいからである。

#### 対象読者と認定資格

初心者から上級のセキュリティチームまでを対象とし、特にRed Team・Blue Team・Purple Team（攻守双方の視点を統合するチーム）の実務者を想定している。ACRTP、MCRTPなど7種類の実践的認定資格が用意されており、Ford、Capital One、Vodafoneといった大手企業でも導入実績があるとされる。

#### 学習上の位置づけ

Pwned Labsの強みは、ブラウザ完結型で環境構築コストがゼロに近いことと、攻撃と検知を対にした設計にある。一方で、無料枠で触れられる範囲は限定的であり、体系的に全領域を学ぶには有料プランやBootcampsが必要になる。したがって、まずは無料のAcademyラボでIAM権限昇格やメタデータサービス悪用といった基礎的な攻撃パターンの「感覚」を掴み、より高度なAIエージェント攻撃やCI/CD侵害のシナリオへ進む段階的な使い方が現実的である。

> 出典: Pwned Labs — https://pwnedlabs.io/

### Awesome-CloudSec-Labs — 無料ラボ・CTF集約リスト

Awesome-CloudSec-Labs（GitHub: iknowjason/Awesome-CloudSec-Labs）は、クラウドネイティブセキュリティを無料で学べるハンズオンラボ、CTF、自習用の脆弱環境（intentionally vulnerable environment、意図的に脆弱に作られた学習用環境）をキュレーションしたリストである。個別サービスとは異なり、既存のOSS（オープンソースソフトウェア）プロジェクトやコミュニティ主催CTFへのリンク集という性質を持つため、学習者は自分の興味やクラウドプロバイダに応じて選択的に取り組める。

#### AWS向けラボ

AWSは対応ラボの数が最も多く、IAM権限昇格を中心テーマとするものが目立つ。

**The Big IAM Challenge**（https://bigiamchallenge.com/）は、IAMポリシーの設定ミスを特定・悪用するCTF形式のチャレンジである。難易度は中程度で、実際のAWSアカウント上でIAMポリシーの評価ロジック（明示的Deny優先、リソースベースポリシーとアイデンティティベースポリシーの組み合わせ評価など）を突いて権限昇格経路を発見させる。IAMのポリシー評価がなぜ複雑なのか、どこに設定ミスが生まれやすいのかを実地で学べる代表的教材である。

**flaws.cloud**（http://flaws.cloud）と**flaws2.cloud**（http://flaws2.cloud）は、レベル制のCTFで、各レベルにヒントが用意されている。flaws.cloudはS3バケットの設定ミス、公開スナップショット、脆弱なEC2インスタンスなどAWSの基本的な設定ミスパターンを段階的に学ぶ構成であり、flaws2.cloudは攻撃者ルートと防御者ルートの2つの進路を選べる点が特徴で、防御的な視点の学習にも活用できる。

**CloudGoat**（https://github.com/RhinoSecurityLabs/cloudgoat）はRhino Security Labsが公開する、Terraform（インフラをコードで定義・構築するツール）で構築する「シナリオ型」の脆弱AWS環境である。31種類の権限昇格パターンを収録し、自分のAWSアカウント上にデプロイして自習する形式のため、中〜上級者向けである。

**IAM Vulnerable**（https://github.com/BishopFox/iam-vulnerable）はBishop Foxが公開する、31の権限昇格攻撃パスウェイに特化した教材で、IAMポリシーの組み合わせによる昇格ロジックを網羅的に学べる上級者向け教材である。

**CloudFoxable**（https://github.com/BishopFox/cloudfoxable）は自習用の脆弱AWSペネトレーション環境で、偵察ツール（cloudfox等）を用いた列挙から攻撃パス発見までの一連の流れを体験できる中級者向け教材である。

**The Ultimate Cloud Security Championship**（https://www.cloudsecuritychampionship.com/）はWizが主催する月次CTFチャレンジで、難易度は回によって変動する。継続的に新しいシナリオが供給されるため、最新の設定ミスパターンを追い続けたい学習者に向く。

#### Azure向けラボ

**EntraGoat**（https://github.com/Semperis/EntraGoat）はSemperisが公開する、Microsoft Entra ID（旧Azure AD、Azureのアイデンティティ基盤）を対象にした脆弱インフラで、6つの攻撃シナリオが用意されている。Entra ID特有の条件付きアクセスやロール割り当ての誤設定を学ぶのに適している。

**Broken Azure**（https://www.brokenazure.cloud/）はホスト型のCTFで、Terraformによる自習型デプロイのオプションも提供する。

**XMGoat**（https://github.com/XMCyber/XMGoat）はXM Cyberが公開する教材で、5つのシナリオと解決手順のドキュメントが付属し、独学でも進めやすい構成になっている。

#### GCP向けラボ

**Thunder CTF**（https://thunder-ctf.cloud/）は6レベル構成で、GCP（Google Cloud Platform）上に構築された脆弱なクラウドプロジェクトを攻略する形式である。

**GCP Goat**（Josh Jebaraj氏公開、https://gcpgoat.joshuajebaraj.com/）はガイド付きのMdbook形式ワークブックとして提供され、GCPのIAMやサービスアカウント関連の設定ミスを段階的に学べる。

#### Kubernetes/コンテナ向けラボ

**OWASP EKS Goat**（https://eksgoat.kubernetesvillage.com）はOWASPコミュニティが公開する、AWS EKS（Elastic Kubernetes Service）を対象とした自習型教材で、20以上の攻撃・防御ハンズオンラボを収録する。

**Kubernetes Goat**（https://github.com/madhuakula/kubernetes-goat）はGKE/EKS/AKSいずれのマネージドKubernetesにも対応するマルチクラウド構成の教材で、ガイド付きで進められる。

**Kube Security Lab**（https://github.com/raesene/kube_security_lab）はローカルのDocker環境上に14種類の脆弱なKubernetesクラスタを構築する教材で、クラウド利用料を発生させずに学べる点が特徴である。

#### CI/CD向けラボ

**CI/CD Goat**（https://github.com/cider-security-research/cicd-goat）はCI/CDパイプラインを対象としたCTFで、Docker上で動作する。パイプライン設定の誤りやシークレット漏洩などを学ぶ。

**GitHub Actions Goat**（https://github.com/step-security/github-actions-goat）はGitHub上でホストされる教材で、GitHub Actionsワークフローに対する脅威シナリオがMITRE ATT&CK等のフレームワークにマッピングされている。

#### 主要トピック別の対応表

| トピック | 代表的なラボ |
|---|---|
| IAM/権限管理 | The Big IAM Challenge、IAM Vulnerable |
| S3/オブジェクトストレージの設定ミス | flaws.cloud |
| 権限昇格チェーン | CloudGoat、IAM Vulnerable |
| Entra ID/Azure AD | EntraGoat、XMGoat |
| GCPサービスアカウント/IAM | Thunder CTF、GCP Goat |
| Kubernetesクラスタの侵害 | Kubernetes Goat、OWASP EKS Goat、Kube Security Lab |
| CI/CDパイプライン侵害 | CI/CD Goat、GitHub Actions Goat |
| Infrastructure as Codeの脆弱性 | TerraGoat（Terraformテンプレートの脆弱パターン集） |

#### 料金体系と学習の進め方

このリストに掲載されているラボはほぼすべて無料で利用できる。ただし「無料」であっても、CloudGoatやIAM VulnerableのようにTerraformで自分のクラウドアカウント上にデプロイする形式のものは、実際にはクラウドリソースの利用料金（多くは少額だが、放置すると想定外の課金につながりうる）が別途発生する点に注意が必要である。学習後は必ず`terraform destroy`等でリソースを破棄し、不要な請求を防ぐ運用が望ましい。一方、flaws.cloudやThunder CTF、The Big IAM Challengeのようにホスト型で提供されるラボは、運営側のアカウント上で動作するため学習者側の課金リスクがない。

進め方としては、まずホスト型で無料・低リスクなflaws.cloudやThe Big IAM Challengeでクラウド特有の設定ミスパターンに慣れ、次にCloudGoatやIAM Vulnerableのような自習デプロイ型でより複雑な権限昇格チェーンの構築を体験し、最後にKubernetes GoatやCI/CD Goatで周辺エコシステム（コンテナオーケストレーション、パイプライン）へと学習範囲を広げる段階的アプローチが効率的である。

> 出典: Awesome-CloudSec-Labs (iknowjason) — https://github.com/iknowjason/Awesome-CloudSec-Labs

### まとめ

Pwned LabsはAI/LLM攻撃やハイブリッド環境まで含む幅広い商用プラットフォームであり、攻撃と検知を対にした実践的なカリキュラムが特徴である。一方Awesome-CloudSec-Labsは、AWS・Azure・GCP・Kubernetes・CI/CDにまたがる無料OSS教材を横断的に集約したリファレンスであり、特定プロバイダの特定トピック（IAM権限昇格、S3設定ミス、Entra ID侵害など)に絞って深掘りしたい学習者に向く。両者は競合するものではなく、商用の体系的カリキュラムで基礎から学びたい場合はPwned Labs、無料でプロバイダ・トピックごとにピンポイントで深堀りしたい場合はAwesome-CloudSec-Labsの各リポジトリ、という使い分けが実務上有効である。いずれのラボも学習用に意図的に脆弱化された使い捨て環境であり、実在の本番サービスへの適用や無許可の検証行為は本教科書の対象範囲外である。
