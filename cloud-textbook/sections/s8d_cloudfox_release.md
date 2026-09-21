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
