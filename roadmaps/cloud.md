# クラウド／IAM攻撃 段階的学習ロードマップ ― SSRF→メタデータ→クレデンシャル窃取→IAM権限昇格→アカウント乗っ取りを「武器」にする

## TL;DR

- **SSRF→クラウドメタデータ(IMDS)→一時クレデンシャル窃取→IAM権限昇格→アカウント乗っ取り**という連鎖は、Capital One事件（約1億600万人分の顧客・クレジット申込情報が流出、700超のS3バケットにアクセス、$80M OCC制裁金＋$190M集団訴訟和解）で実証された最高インパクトの王道であり、これを軸に10段階で学習するのが最短ルート。
- 既にSSRF/Reconを習得済みなら、次の最優先は**Lv2**（IMDSv1/v2の違いとSSRFからの到達・バイパス）と**Lv3**（窃取クレデンシャルのenumerationとaws cli悪用）、そして**Lv5**（Spencer Gietzenの21手法→BishopFoxが31経路に拡張したIAM権限昇格カタログ）。ここが「受理される脆弱性」の核。
- 実践環境は **flaws.cloud/flaws2.cloud → CloudGoat → IAM Vulnerable/CloudFoxable → Pwned Labs** の順で手を動かし、PACU/CloudFox/ScoutSuite/Prowlerをツールとして併用する。

## Key Findings

- クラウドSSRFはオンプレSSRFと桁違いに危険。理由は169.254.169.254のメタデータサービスが「認証なしで一時クレデンシャルを配る」ため。AWSのIMDSv1はGET一発で認証情報が取れる。
- IMDSv2はPUTでトークン取得→ヘッダ付与という2段階＋hop-limit=1で大半のSSRFを防ぐが、(1)IMDSv1が併存（HttpTokens=optional）、(2)リダイレクト追従、(3)アプリ層SSRFでPUT可能、(4)ECS/Lambdaでhop-limit>1、といった条件で今も破れる。Datadogの「State of AWS Security」（Dash 2022、600超の組織を調査）では**EC2インスタンスの93%がIMDSv2を強制しておらず、EC2利用組織の95%が最低1台の脆弱なインスタンスを持つ**とされた（同社2025年版では「2台に1台がIMDSv2を強制」まで改善）。
- GCPは`metadata.google.internal`＋`Metadata-Flavor: Google`ヘッダ必須、Azureは`169.254.169.254/metadata/...`＋`Metadata: true`ヘッダ必須。ヘッダ要求が最小限の防御になるが、gopher://によるヘッダ密輸やヘッダ注入で回避例あり。
- IAM権限昇格は**Rhino Security LabsのSpencer Gietzen（2018年11月19日公開）による21手法**が体系の原点（`iam:CreatePolicyVersion --set-as-default`、`iam:PassRole`+`ec2:RunInstances`、`AttachUserPolicy`等）。**BishopFoxのSeth ArtがGerben Kleijnの2019年攻撃ガイドを基にIAM Vulnerable（2021）を作り、10経路を追加して31経路（Terraformで250超のIAMリソースを展開）へ拡張**した。
- 実際のバグバウンティで受理例が豊富（HackerOne #508459 Omise、#247680 HelloSign/Dropbox、#341876 Shopify $25,000等）。Sayaan Alamの記事によればDropboxのSSRF報告は**$4,913**（本人の最高額）。
- 攻撃は現在も進行形。**CVE-2025-53767（Azure OpenAIのSSRF、2025年8月7日公開、CWE-918、CVSS 10.0、未認証・遠隔で悪用可能）** のように新しい重大SSRF→クラウド権限昇格が継続して出ている。

---

## Lv1. クラウドとIAMの基礎（攻撃者視点）

**なぜ必要か**: 責任共有モデル、EC2/S3/Lambda/IAM/STS、ロール・信頼ポリシー・AssumeRole・一時クレデンシャルの仕組みを攻撃者視点で理解しないと、後段の「何が窃取でき、何に悪用できるか」が読めない。

- HackTricks Cloud（AWS/GCP/Azure攻撃の総本山、まず全体像）: https://cloud.hacktricks.wiki/en/index.html
- HackTricks Cloud AWS Pentesting（AWSの前提知識・IAM・組織構造）: https://cloud.hacktricks.wiki/en/pentesting-cloud/aws-security/index.html
- HackTricks Pentesting Cloud Methodology: https://cloud.hacktricks.xyz/pentesting-cloud/pentesting-cloud-methodology
- Hacking The Cloud（Nick Frichette、攻撃百科事典・トップ）: https://hackingthe.cloud/
- Hack The Box: AWS penetration testing step-by-step guide: https://www.hackthebox.com/blog/aws-pentesting-guide
- Cloud Pentesting: AWS common test cases（ro0taddict、実務チェックリスト）: https://rodelllemit.medium.com/cloud-pentesting-aws-common-test-cases-in-an-aws-pentest-engagement-86c74983418d
- redskycyber/Cloud-Security（AWSセキュリティ学習リソース集）: https://github.com/redskycyber/Cloud-Security/blob/main/AWS-Security-Pentesting-Resources.md
- 【日本語】GMO Flatt Security「クラウドセキュリティはじめの一歩」（責任共有・観点整理・SSRF→IMDS）: https://flatt.tech/articles/cloud_security_first_step/

## Lv2. ★SSRF→クラウドメタデータサービス→一時クレデンシャル窃取（連鎖の核・最重要）

**なぜ必要か**: これがユーザーの既存SSRFスキルをクラウド最高インパクトに接続する中核。IMDSv1/v2の差、169.254.169.254への到達手法、フィルタ回避、窃取後のaws cli設定までを手が覚えるまで反復する。
**習得できること**: IMDSエンドポイントの正確なパス、AccessKeyId/SecretAccessKey/Tokenの取得、環境変数への設定とAPI実行、IMDSv2の限界条件の見極め。

AWS IMDSの基礎と窃取:

- Hacking The Cloud「Steal EC2 Metadata Credentials via SSRF」（決定版・IMDSv1/v2の手順）: https://hackingthe.cloud/aws/exploitation/ec2-metadata-ssrf/
- Resecurity「SSRF to AWS Metadata Exposure」: https://www.resecurity.com/blog/article/ssrf-to-aws-metadata-exposure-how-attackers-steal-cloud-credentials
- Hacking Articles「AWS EC2 Credentials Theft via SSRF Abuse」（攻撃連鎖を図解）: https://www.hackingarticles.in/aws-ec2-credentials-theft-via-ssrf-abuse/
- AquilaX「SSRF to AWS Credential Theft via IMDSv1」（curl手順・ECS/Lambda例）: https://aquilax.ai/blog/ssrf-cloud-metadata-credential-theft
- RKON「Exploit SSRF to gain AWS Credentials」: https://www.rkon.com/articles/exploit-ssrf-to-gain-aws-credentials/
- HackIndex「SSRF to IMDS Credential Theft」: https://hackindex.io/platforms/aws/exploitation/ec2/ec2-ssrf-imds-credential-theft

ペイロード・チートシート（AWS/GCP/Azureエンドポイント一覧）:

- PayloadsAllTheThings SSRF Cloud Instances（各社メタデータURL網羅）: https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/SSRF-Cloud-Instances.md
- 同 GitHub Pages版: https://swisskyrepo.github.io/PayloadsAllTheThings/Server%20Side%20Request%20Forgery/SSRF-Cloud-Instances/
- PayloadsAllTheThings SSRF README: https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/README.md
- Vulnsy SSRF Cheat Sheet（検出シグナル付き）: https://www.vulnsy.com/cheat-sheets/ssrf

IMDSv2の仕組みとバイパス（フィルタ回避）:

- Datadog Security Labs「Securing the EC2 Instance Metadata Service」（93%がIMDSv2未強制という調査を含む）: https://securitylabs.datadoghq.com/articles/misconfiguration-spotlight-imds/
- CyberFortify「SSRF → IMDSv2 → STS」（3つのバイパスシナリオ）: https://cyberfortify.co/blog/ssrf-imdsv2-sts-cloud-privilege-escalation
- IntruderLabs「SSRF Bypasses: why each filter-evasion technique works」: https://intruderlabs.com.br/en/blog/ssrf-bypass-techniques/
- Harsha GV「How SSRF Exploits IMDSv2 Limitations in AWS」（presigned URL悪用の実例）: https://medium.com/@harshagv/uncovering-cloud-security-flaws-how-ssrf-exploits-imdsv2-limitations-in-aws-75bd4201786b
- Wiz Academy「Server-Side Request Forgery」（AWS/GCP/Azure対比）: https://www.wiz.io/academy/application-security/server-side-request-forgery
- 【日本語】classmethod DevelopersIO「IMDSv2でセキュリティを強化しましょう」（SSRF攻撃の実演）: https://dev.classmethod.jp/articles/use-ec2-imdsv2/
- 【日本語】classmethod DevelopersIO「IMDSv2がEC2デフォルトに」: https://dev.classmethod.jp/articles/ec2-imdsv2-by-default/
- 【日本語】徳丸浩「IMDSv2の効果と破り方」: https://www.slideshare.net/ockeghem/introduction-to-imdsv2

GCP/Azureのメタデータ:

- dxa4481「Attacking and Defending the GCP Metadata API」: https://github.com/dxa4481/AttackingAndDefendingTheGCPMetadataAPI
- dark-moon「SSRF to GCP Metadata: gopher://でトークン窃取」: https://dark-moon.org/blog/ssrf-gcp-metadata-token-theft/
- Guardz「Exploiting Azure Managed Identity Tokens from IMDS」: https://guardz.com/blog/exploiting-azure-managed-identity-tokens-from-imds/
- Redfox「Azure Key Vault & Managed Identity Exploitation Guide」: https://www.redfoxsec.com/blog/azure-key-vault-and-managed-identity-exploitation
- CyberCX「Azure SSRF Metadata」: https://cybercx.com.au/blog/azure-ssrf-metadata/
- Orca Security「SSRF Vulnerabilities in Four Azure Services」: https://orca.security/resources/blog/ssrf-vulnerabilities-in-four-azure-services/

Capital One事件（この連鎖の象徴的実例、必読）:

- Appsecco「An SSRF, privileged AWS keys and the Capital One breach」（技術解説の定番）: https://blog.appsecco.com/an-ssrf-privileged-aws-keys-and-the-capital-one-breach-4c3c2cded3af
- Wiz Cloud Threat Landscape「Capital One incident (March 2019)」: https://threats.wiz.io/all-incidents/capital-one-incident-march-2019
- shayrm/CapitalOne-SSRF-demo（Terraformで再現する演習）: https://github.com/shayrm/CapitalOne-SSRF-demo
- hackaws.cloud「The Capital One Breach, Seven Years Later」（blast radius論）: https://hackaws.cloud/blog/capital-one-ssrf-imds-blast-radius

## Lv3. 窃取クレデンシャル後のexploitation（enumeration & whoami）

**なぜ必要か**: 取れた鍵で「自分が誰で何ができるか」を素早く把握できなければインパクト立証ができない。ここが報告の質を決める。

- Hacking The Cloud「Brute Force IAM Permissions」（enumerate-iamの実務）: https://hackingthe.cloud/aws/enumeration/brute_force_iam_permissions/
- Hacking The Cloud「Unauthenticated Enumeration of IAM Users and Roles」: https://hackingthe.cloud/aws/enumeration/enum_iam_user_role/
- enumerate-iam（Andrés Riancho、鍵の権限を非破壊列挙）: https://github.com/andresriancho/enumerate-iam
- CloudFox（BishopFox、攻撃経路の状況把握）: https://github.com/BishopFox/cloudfox
- CloudFox AWS Commands Wiki: https://github.com/BishopFox/cloudfox/wiki/AWS-Commands
- CloudFox解説（ArshadKhan、コマンド別に図解）: https://medium.com/@akarshad428/cloudfox-based-aws-enumeration-techniques-125719810556
- weirdAAL（carnal0wnage、AWS攻撃ライブラリ）: https://github.com/carnal0wnage/weirdAAL
- DrSecurityGuru「Trufflehog + Enumerate-IAM for Bug Bounty」（鍵発見→権限検証の流れ）: https://medium.com/@earth22sky/unmasking-aws-secrets-my-journey-with-trufflehog-and-enumerate-iam-for-bug-bounty-hunters-9e5599df0c5a

## Lv4. S3/ストレージバケットの攻撃

**なぜ必要か**: 公開バケット・書き込み可能ACL・バケットテイクオーバーは今も受理される定番。窃取クレデンシャル有無どちらのシナリオでも刺さる。

- Intigriti「Hacking misconfigured AWS S3 buckets: complete guide」: https://www.intigriti.com/researchers/blog/hacking-tools/hacking-misconfigured-aws-s3-buckets-a-complete-guide
- Cobalt「AWS Bucket Misconfiguration」（Pentest Vulnerability Wiki）: https://www.cobalt.io/vulnerability-wiki/v4-access-control/aws-bucket-misconfig
- Sahil Shah「AWS S3 Bucket Hacking 101: Enumeration to Exploitation」: https://sahil3276.medium.com/aws-s3-bucket-hacking-101-from-enumeration-to-exploitation-e3e2a2948eba
- Xpl0itZ3r0X「Exploiting Misconfigured AWS S3 Buckets: A Practical Guide」: https://anubhavdhakal.medium.com/exploiting-misconfigured-aws-s3-buckets-a-practical-guide-54255265994e
- S3Scanner（sa7mon、公開バケット探索）: https://github.com/sa7mon/S3Scanner
- cloud_enum（initstring、AWS/Azure/GCP公開資産列挙）: https://github.com/initstring/cloud_enum
- From Bucket to Breach（Pwned Labs S3列挙→権限昇格の実演）: https://medium.com/@tareshsharma17/from-bucket-to-breach-s3-enumeration-and-credential-escalation-in-aws-9f63f14ed5f0

## Lv5. ★IAM誤設定と権限昇格（手法カタログを深く）

**なぜ必要か**: 一時クレデンシャルを取っても権限が限定的なことは多い。そこからadminへ昇格する手法カタログこそ「武器」の中核。前提条件付きで各手法を暗記・実演する。

- Rhino Security Labs「AWS IAM Privilege Escalation – Methods and Mitigation」（Spencer Gietzen、2018年公開の21手法の原典）: https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/
- 同 Part 2（Lambda Layers / SageMakerで手法追加）: https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation-part-2/
- RhinoSecurityLabs/AWS-IAM-Privilege-Escalation（手法の中央リポジトリ）: https://github.com/RhinoSecurityLabs/AWS-IAM-Privilege-Escalation
- Hacking The Cloud「AWS IAM Privilege Escalation Techniques」: https://hackingthe.cloud/aws/exploitation/iam_privilege_escalation/
- BishopFox「IAM Vulnerable - An AWS IAM Privilege Escalation Playground」（Seth Artが21→31経路へ、Gietzen/Kleijnの系譜）: https://labs.bishopfox.com/tech-blog/iam-vulnerable-an-aws-iam-privilege-escalation-playground
- BishopFox「Assessing the AWS Assessment Tools」（各privescツールの検出精度比較）: https://bishopfox.com/blog/assessing-the-aws-assessment-tools
- n00「AWS IAM privilege escalation paths (iam-vulnerable)」（実演ウォークスルー）: https://pswalia2u.medium.com/aws-iam-privilege-escalation-paths-cba36be1aa9e
- Mystic0x1「Privilege Escalation in AWS - Part 01」（CreatePolicyVersion実演）: https://mystic0x1.github.io/posts/AWS-Privilege-Escalation-Part-01/
- PMapper / Principal Mapper（NCC Group、IAMをグラフ化しprivesc経路発見）: https://github.com/nccgroup/PMapper
- Cloudsplaining（Salesforce、IAMポリシーの過剰権限検出）: https://github.com/salesforce/cloudsplaining
- aws_consoler（NetSPI、CLIクレデンシャル→コンソールアクセス）: https://github.com/NetSPI/aws_consoler

## Lv6. クラウド固有サービスの攻撃（Lambda / コンテナ / Secrets等）

**なぜ必要か**: EC2以外のメタデータ・環境変数・シークレット管理を突く攻撃はモダンな標的で頻出。ECS/EKSのメタデータやCognito誤設定も要点。

- Rhino「CloudGoat goes Serverless: Vulnerable Lambda Functions」: https://rhinosecuritylabs.com/cloud-security/cloudgoat-vulnerable-lambda-functions/
- Rhino「CloudGoat sns_secrets walkthrough」（SNS/API Gateway/Pacu enumeration）: https://rhinosecuritylabs.com/research/cloudgoat-sns_secrets/
- Rhino「CloudGoat glue_privesc walkthrough」（SQLi→クレデンシャル窃取→reverse shell）: https://rhinosecuritylabs.com/cloud-security/cloudgoat-walkthrough-glue_privesc/
- flaws2.cloud（Lambda/ECS Fargateのサーバレス攻撃・攻守両パス）: http://flaws2.cloud/
- ro0taddict「CloudGoat vulnerable_cognito walkthrough」: https://rodelllemit.medium.com/aws-pentesting-cloudgoat-vulnerable-cognito-0d6e3809dada
- 【日本語】GMO Flatt Security「サーバーレスのセキュリティリスク - AWS Lambda」: https://blog.flatt.tech/entry/lambda_and_serverless_security
- 【日本語】GMO Flatt Security Blog AWSカテゴリ（IAMポリシー評価等）: https://blog.flatt.tech/archive/category/AWS

## Lv7. 露出クレデンシャル・シークレットのRecon（既存Reconと接続）

**なぜ必要か**: SSRF不要で最初の鍵を得る近道。GitHub/JS/.envのAWSキー漏洩発見はReconスキルの直接応用。

- Appsecco「Finding Treasures in Github and Exploiting AWS」（GitHub dork→AWS悪用）: https://blog.appsecco.com/finding-treasures-in-github-and-exploiting-aws-for-fun-and-profit-part-1-be5cfadf942
- PayloadsAllTheThings「API Key and Token Leaks」（keyhacks/検証法）: https://swisskyrepo.github.io/PayloadsAllTheThings/API%20Key%20Leaks/
- TruffleHog（漏洩シークレット検出・検証）: https://github.com/trufflesecurity/trufflehog
- InfoSec Write-ups「GitHub Recon: high-impact leaks in bug bounty」: https://infosecwriteups.com/github-recon-the-underrated-technique-to-discover-high-impact-leaks-in-bug-bounty-c4069894389a
- Snyk「State of Secrets 2025」（漏洩ツール比較・blast radius）: https://snyk.io/articles/state-of-secrets/
- Cyber-note「Full Bug Bounty Hunting Methodology 2026」（recon自動化）: https://github.com/Cyber-note/Full-Bug-Bounty-Hunting-Methodology-2026

## Lv8. ツールと自動化

**なぜ必要か**: 大規模アカウントの状況把握と権限昇格発見を高速化。各ツールの守備範囲を理解し使い分ける。

- PACU（Rhino、AWS post-exploitationフレームワーク・Metasploit相当）: https://github.com/RhinoSecurityLabs/pacu
- PACU Wiki: https://github.com/rhinosecuritylabs/pacu/wiki
- Rhino「Pacu: The Open Source AWS Exploitation Framework」（設計思想）: https://rhinosecuritylabs.com/aws/pacu-open-source-aws-exploitation-framework/
- GoLinuxCloud「Pacu AWS Tutorial: IAM Enumeration, PrivEsc Scan & CloudGoat」: https://www.golinuxcloud.com/pacu-aws-exploitation/
- Pwned Labs「Beginner's Guide: AWS IAM Privilege Escalation with Pacu」: https://pwnedlabs.io/blog/beginners-guide-to-hunting-for-aws-iam-privilege-escalations-with-pacu
- ScoutSuite（NCC Group、マルチクラウド監査・HTMLレポート）: https://github.com/nccgroup/ScoutSuite
- Prowler（マルチクラウドのセキュリティ/コンプラ評価）: https://github.com/prowler-cloud/prowler
- Prowler公式ドキュメント: https://docs.prowler.com/
- BishopFox「CloudFox tool」ページ（GCP対応・CloudFoxable）: https://bishopfox.com/tools/cloudfox-tool
- Dark Reading「Bishop Fox Releases Cloud Enumeration Tool CloudFox」: https://www.darkreading.com/cloud-security/bishopfox-releases-cloud-enumeration-tool-cloudfox

## Lv9. ★実例・ライトアップ・報奨事例（受理された脆弱性で学ぶ）

**なぜ必要か**: 実際のバグバウンティ報告とCVEを読むことで「どう見つけ、どう影響を示し、どう書くか」を模倣できる。

HackerOne実報告（開示済み）:

- Omise「SSRF in webhooks leads to AWS private keys disclosure」（#508459）: https://hackerone.com/reports/508459
- HelloSign/Dropbox「SSRF leads to AWS private keys disclosure」（#247680、303リダイレクトでIMDS読取。Sayaan Alamの解説によれば$4,913）: https://hackerone.com/reports/247680
- Logitech/Streamlabs「SSRF allows reading AWS EC2 metadata」（#1108418）: https://hackerone.com/reports/1108418
- Shopify「SSRF in Exchange leads to ROOT access」（#341876、$25,000）: https://hackerone.com/reports/341876
- Lab45「SSRF to AWS file read」（#978823、ECSメタデータ）: https://hackerone.com/reports/978823
- AWS VDP「Sensitive API Key Leakage」（#3017105、GitHub鍵漏洩）: https://hackerone.com/reports/3017105

ライトアップ:

- SirLeeroyJenkins「Bypassing SSRF Protection to Exfiltrate AWS Metadata from LarkSuite」: https://sirleeroyjenkins.medium.com/bypassing-ssrf-protection-to-exfiltrate-aws-metadata-from-larksuite-bf99a3599462
- Zonduu「SSRF to fetch AWS credentials with full access」: https://zonduu.medium.com/ssrf-to-fetch-aws-credentials-with-full-access-to-various-services-18cd08194e91
- Sayaan Alam「SSRF worth $4,913 (Dropbox)」: https://medium.com/techfenix/ssrf-server-side-request-forgery-worth-4913-my-highest-bounty-ever-7d733bb368cb
- OSINT Team「$25,000 SSRF in HackerOne's Analytics Reports」（PDF生成→IMDS）: https://osintteam.blog/25-000-ssrf-in-hackerones-analytics-reports-b9a5b3aa3d6e
- squidhacker「Mastering SSRF Exploitation in 2025」（2020年以降の開示報告分析）: https://squidhacker.com/2025/05/mastering-server-side-request-forgery-ssrf-exploitation-in-2025/

補足: MandiantのUNC2903は既知の脆弱性 **CVE-2021-21311**（Adminer SSRF）を悪用してIMDSからIAMクレデンシャルを窃取した事例が、上記Datadog記事内で参照されている。

## Lv10. 発展・方法論・防御理解・ハンズオン環境

**なぜ必要か**: 体系的テスト方法論と防御（IMDSv2強制/最小権限/SCP/GuardDuty）を攻撃視点で理解し、常設ラボで反復することで再現性ある「武器」になる。

方法論・防御:

- BishopFox「CloudFox Workshop: Cloud Enumeration for Pentesting」: https://bishopfox.com/resources/cloudfox-cloud-enumeration-penetration-testing
- Rhino「CloudGoat detection_evasion」（GuardDuty/CloudTrail回避）: https://rhinosecuritylabs.com/cloud-security/cloudgoat-detection_evasion-walkthrough/
- AppSecure「SSRF in Cloud Environments: Hidden Paths」（AssumeRoleチェーン/クロスアカウント）: https://www.appsecure.security/blog/ssrf-cloud-environments

ハンズオン環境（この順で推奨）:

- flaws.cloud（Scott Piper、S3・IAM・Lv5でSSRF→メタデータ）: http://flaws.cloud/ ／ 攻略: https://kishoreramk.medium.com/hacking-aws-flaws-cloud-walkthrough-2f13083b0b4d
- flaws2.cloud（サーバレス・攻守両パス）: http://flaws2.cloud/ ／ 攻略: https://kishoreramk.medium.com/flaws2-cloud-walkthrough-aws-cloud-security-5540360e512f
- CloudGoat（Rhino、意図的脆弱AWS）: https://github.com/RhinoSecurityLabs/cloudgoat ／ CloudGoat 2解説: https://rhinosecuritylabs.com/aws/introducing-cloudgoat-2/
- Rhino「CloudGoat rce_web_app walkthrough」（Web→クラウドの連鎖）: https://rhinosecuritylabs.com/aws/cloudgoat-walkthrough-rce_web_app/
- Infosec Institute「CloudGoat complete walkthrough series」: https://www.infosecinstitute.com/resources/cloud/working-with-cloudgoat-the-vulnerable-by-design-aws-environment/
- IAM Vulnerable（BishopFox、31 privesc経路）: https://github.com/BishopFox/iam-vulnerable
- CloudFoxable（BishopFox、CTF形式のクラウドペンテスト演習）: https://bishopfox.com/tools/cloudfox-tool
- AWSGoat（INE、OWASP Top 10＋AWS誤設定）: https://github.com/ine-labs/AWSGoat
- Pwned Labs（クラウド/AI/K8sのガイド付きラボ）: https://pwnedlabs.io/
- Awesome-CloudSec-Labs（無料ラボ・CTF集約。The Big IAM Challenge / Ultimate Cloud Security Championship等へのリンク集）: https://github.com/iknowjason/Awesome-CloudSec-Labs

## Recommendations

1. **最初の2週間（Lv1→Lv2）**: flaws.cloud全レベル（特にLv5のSSRF→メタデータ）を完走し、Hacking The Cloudの「Steal EC2 Metadata Credentials via SSRF」を手で再現。IMDSv1/v2の差とhop-limitを説明できる状態にする。**ベンチマーク**: curlでIMDSv2トークン取得→クレデンシャル取得→`aws sts get-caller-identity`が通ること。
2. **次の2週間（Lv3→Lv5）**: CloudGoat（rce_web_app, iam_privesc系）とIAM Vulnerableを立てて、enumerate-iam/CloudFox/PACUで権限列挙→21+手法から昇格を実演。**ベンチマーク**: `iam:CreatePolicyVersion --set-as-default`等で低権限→admin昇格を1本通す。
3. **その後（Lv6→Lv9）**: flaws2.cloud、CloudFoxable、Pwned Labsでサーバレス/コンテナ/Secretsを攻略。並行してHackerOne開示報告（#508459/#247680/#341876）を毎日1本精読し、報告テンプレを自分用に整備。**ベンチマーク**: 実際のバグバウンティ対象でSSRFパラメータを見つけIMDS到達可否を判定できること。
4. **GCP/Azureへ横展開**: AWSで武器化できたらGCP（metadata.google.internal＋Metadata-Flavor）とAzure（Metadata:true、Managed Identity）へ。gopher://ヘッダ密輸やCVE-2025-53767のようなヘッダ注入バイパスを理解する。
5. **判断を変える閾値**: バグバウンティで実際にSSRF→メタデータ or IAM privescを1件受理されたら、Lv10の方法論・検出回避・クロスアカウントへ深掘り。逆に権限列挙で詰まるならLv3に戻る。SSRFがIMDSv2で塞がれているターゲットが増えたら、Lv7（露出クレデンシャルRecon）を主軸に切り替える。

## Caveats

- **法的・倫理的境界**: 権限列挙ツール（enumerate-iam/PACU等）はノイズが大きくGuardDutyで検知される。必ずスコープ内・許可された環境（自分のAWSアカウント/ラボ）でのみ実行すること。実際のバグバウンティでは「メタデータ読取の証明」までに留め、破壊的操作やデータ持ち出しはしない。
- **IMDSv2の普及で難度上昇**: AWSは2023年11月にコンソールのクイックスタート起動をIMDSv2オンリー化し、2024年3月にはアカウント/リージョン単位で新規インスタンスをIMDSv2デフォルト化できる設定を追加、2024年半ば以降の新インスタンスタイプはIMDSv2のみを使用する方針。単純なGET一発は減少傾向で、今後はリダイレクト追従・アプリ層SSRF・ECS/Lambdaのhop-limit・GCP/Azureのヘッダ回避など高度な条件が中心になる。
- **一部ソースは商用・二次情報**: 個人ブログ/ベンダーブログには宣伝や誇張が混じる。手順の正確性はHacking The Cloud、PayloadsAllTheThings、公式ドキュメント、Datadog/Wiz等の一次寄り情報で必ず裏取りすること。
- **enumerate-iam/weirdAALは更新が停滞気味**: 最新API網羅はCloudFoxやPACUで補完する。PMapperのPyPI/importパッケージ名は`principalmapper`（リポジトリはnccgroup/PMapper）。
- **CVE-2025-53767（Azure OpenAI SSRF, CVSS10.0, 2025年8月7日公開）等の新しい記述**: 悪用可能性や詳細はMSRC等の公式アドバイザリで確認すること。Capital One事件の被害規模・制裁金（$80M OCC制裁金、$190M和解、約1億600万人、700超のS3バケット）は起訴状・和解文書に基づくが、報道により細部の数値表現が揺れる点に留意。