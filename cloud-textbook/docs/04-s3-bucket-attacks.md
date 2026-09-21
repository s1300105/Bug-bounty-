# 第4章 S3／ストレージバケットの攻撃

## S3バケット誤設定の攻撃ガイド

Amazon S3（Simple Storage Service）は、オブジェクトストレージとしてほぼ全てのAWS利用組織が使う基盤サービスであり、それゆえに「誤設定バケット」はクラウド領域で最も報告数の多い脆弱性カテゴリの一つになっている。本節では、S3バケットがどのように公開状態になってしまうのか、その発見（列挙）から実際の悪用手順、そして防御側が押さえるべき設定までを、原典4本の技術内容に基づいて解説する。

### S3のアクセス制御モデルを理解する

S3のアクセス制御は大きく分けて2つの仕組みが重なって成立している。

1. **バケットポリシー（Bucket Policy）**: バケット単位でIAMポリシー言語（JSON）により許可/拒否を定義する。
2. **ACL（Access Control List、アクセス制御リスト）**: バケットやオブジェクト単位で「誰に」「どの操作を」許可するかを定義する、より古い仕組み。Cobalt.ioの解説では、ACLは「バケットまたはバケット内のオブジェクトに対するアクセス制御を管理するための事前定義されたスキーム」と説明されている。

> 出典: Cobalt「AWS Bucket Misconfiguration」（Pentest Vulnerability Wiki） — https://www.cobalt.io/vulnerability-wiki/v4-access-control/aws-bucket-misconfig

この2つのどちらか、あるいは両方が過度に緩い（Overly Permissive）状態になっていると、認証されていない第三者（`--no-sign-request`、つまりAWS認証情報を一切提示しないリクエスト）がバケットを操作できてしまう。

重要な時系列上の注意点として、Intigritiの記事は次のように述べている。

> 「以前は、AWS S3バケットは一覧表示（list）権限がデフォルトで有効になっていた」

現在の新規バケットではパブリックアクセスはデフォルトでブロックされる設計に変わっているが、①古い時期に作られたバケットがそのまま残っている、②開発者が意図的にブロック設定を解除してしまう、といったケースは依然として多く、これが「誤設定」の主要因になっている。

> 出典: Intigriti「Hacking misconfigured AWS S3 buckets: complete guide」 — https://www.intigriti.com/researchers/blog/hacking-tools/hacking-misconfigured-aws-s3-buckets-a-complete-guide

**なぜこの仕組みが危険になりうるか（原理）**: S3はバケット名がグローバルに一意（世界中で重複しない）であり、かつ`https://<bucket>.s3.amazonaws.com/`または`https://s3.amazonaws.com/<bucket>/`というパスベース/バーチャルホスト形式のURLで直接アクセスできる。つまりバケット名さえ推測・発見できれば、認証を挟まずにHTTPリクエスト（あるいはAWS CLIの匿名リクエスト）を投げるだけで中身にアクセスを試行できるという、他のクラウドストレージにも共通する構造的リスクがある。

### 発見（列挙）フェーズ

攻撃者・診断者がまず行うのは「対象組織に紐づくS3バケットを見つけること」である。原典に共通して登場する手法は以下の通り。

#### 1. HTTPレスポンスからの兆候検出

対象アプリケーションが画像やファイルをS3から配信している場合、HTMLソースやネットワークタブに`.s3.amazonaws.com/`というパターンが現れることが多い。また、レスポンスヘッダーにS3特有のフィールドが含まれる。

```
Server: AmazonS3
x-amz-request-id: ...
x-amz-id-2: ...
x-amz-bucket-region: ap-northeast-1
```

Sahil Shahの記事、Intigritiの記事のいずれも、これらのヘッダーの存在を「このリソースがS3から配信されている」ことの決め手として挙げている。

> 出典: Sahil Shah「AWS S3 Bucket Hacking 101: Enumeration to Exploitation」 — https://sahil3276.medium.com/aws-s3-bucket-hacking-101-from-enumeration-to-exploitation-e3e2a2948eba

**なぜこれが手掛かりになるか**: S3はオブジェクトを返すHTTPレスポンスに、リクエストのトラブルシュート用として`x-amz-request-id`や`x-amz-id-2`を自動的に付与する。これはS3のオブジェクトストアとしての内部実装（リクエストごとの一意なトレースID発行）に由来するものであり、アプリケーション側でヘッダーを隠蔽しない限り必ず漏れる。

#### 2. 検索エンジンドーキング

Google等の検索エンジンで、公開されたS3 URLを直接発見する手法。

```
site:.s3.amazonaws.com "company-name"
site:amazonaws.com inurl:".s3.amazonaws.com/"
inurl:s3.amazonaws.com/uploads/
inurl:s3.amazonaws.com/backup/
```

`uploads/`や`backup/`といったパス名を狙い撃ちするのは、バックアップファイルやユーザーアップロードのディレクトリが誤って公開され、機密性の高いファイル（設定ファイル、DBダンプ、個人情報等）を含むことが経験的に多いためである。

> 出典: Sahil Shah「AWS S3 Bucket Hacking 101: Enumeration to Exploitation」 — https://sahil3276.medium.com/aws-s3-bucket-hacking-101-from-enumeration-to-exploitation-e3e2a2948eba

#### 3. サブドメイン列挙を経由した自動偵察

バケット名が対象組織のドメイン名やサブドメイン名に由来して命名される慣習（例: `company-assets`, `company-backup`, `static.company.com`）を逆手に取り、サブドメイン列挙ツールの出力をS3検出ツールにパイプする手法。

```bash
subfinder -d example.com -all -silent | httpx -silent -web-server | grep AmazonS3
```

**仕組み**: `subfinder`で列挙した大量のホスト名を`httpx`で実際にHTTPリクエストし、レスポンスの`Server`ヘッダーが`AmazonS3`であるものだけを`grep`で抽出する。これにより、手動では発見しづらい"社内向けCNAME"や"忘れられたサブドメイン"がS3に直結しているケースを効率的に洗い出せる。

> 出典: Sahil Shah「AWS S3 Bucket Hacking 101: Enumeration to Exploitation」 — https://sahil3276.medium.com/aws-s3-bucket-hacking-101-from-enumeration-to-exploitation-e3e2a2948eba

#### 4. 専用ツール・データベース

原典で言及される代表的ツール群は次の通り。

| ツール | 概要 |
|---|---|
| S3enum | Go製のS3バケット名総当たり・列挙ツール |
| cloud_enum | AWS/Azure/GCPに対応するマルチクラウドOSINTツール |
| LazyS3 | バケット名候補を高速に特定するRubyスクリプト |
| S3Scanner / s3-buckets-finder / AWSBucketDump | バケットを直接スキャンし公開設定を判定するツール群 |
| AWS Extender（Burp Suite Professional拡張） | Burp上でリクエスト中のS3参照を自動検出 |
| Nuclei | S3向けカスタムテンプレートで誤設定を自動検出するスキャナ |
| GrayHatWarfare | 公開バケットを検索できるオンラインデータベース |

> 出典: Intigriti「Hacking misconfigured AWS S3 buckets: complete guide」 — https://www.intigriti.com/researchers/blog/hacking-tools/hacking-misconfigured-aws-s3-buckets-a-complete-guide ／ Sahil Shah「AWS S3 Bucket Hacking 101」 — https://sahil3276.medium.com/aws-s3-bucket-hacking-101-from-enumeration-to-exploitation-e3e2a2948eba

### 悪用（検証）フェーズ：AWS CLIによる体系的チェック

バケット候補を発見したら、AWS CLIの`--no-sign-request`オプション（AWS認証情報を一切使わず匿名リクエストとして送る指定）を使い、権限を一つずつ検証する。Intigritiの記事はこれを段階的なチェックリストとして提示しており、以下はその代表的なコマンド群である。

#### ① 一覧表示（List）権限の確認

```bash
aws s3 ls s3://{BUCKET_NAME} --no-sign-request
```

これが成功する場合、バケット内のオブジェクト名・ディレクトリ構造が第三者に丸見えになっている。ファイル名自体が機密情報（顧客名、内部プロジェクト名など)を含むこともある。

#### ② オブジェクトの読み取り・ダウンロード

```bash
aws s3api get-object --bucket {BUCKET_NAME} --key archive.zip ./output.zip --no-sign-request
aws s3 cp s3://{BUCKET_NAME}/secret.txt ./ --no-sign-request
```

一覧表示は禁止されていても、オブジェクトキー（ファイルパス）さえ推測・入手できれば個別に読み取れるケースがある（"security by obscurity"の失敗例）。

#### ③ 書き込み権限の確認

```bash
aws s3 cp intigriti.txt s3://{BUCKET_NAME}/intigriti-ac5765a7-1337-4543-ab45-1d3c8b468ad3.txt --no-sign-request
```

ここでファイル名にランダムなUUIDのような文字列を使うのは、既存ファイルを誤って上書き・破壊しないための配慮である（本プロジェクトの方針としても、本番環境や実サービスへの破壊的な検証・上書きは行ってはならない）。書き込みが可能な場合、攻撃者は次のようなことが可能になる。

- 静的サイトホスティングに使われているバケットであれば、HTMLやJSファイルを差し替えてWebサイト改ざん・マルウェア配布・フィッシングページ設置を行う
- SVGファイルなど、拡張子検証だけに依存しているアップロード先であれば、SVG内に埋め込んだスクリプトによる**保存型XSS**（ユーザーがそのファイルを閲覧した際にスクリプトが実行される）を仕込む

> 出典: Intigriti「Hacking misconfigured AWS S3 buckets: complete guide」 — https://www.intigriti.com/researchers/blog/hacking-tools/hacking-misconfigured-aws-s3-buckets-a-complete-guide

Cobalt.ioの記事でも同様の悪用例として、公開書き込み権限を突いたアップロードが示されている。

```
aws s3 mv test.txt s3://<bucket name> --acl public-read
```

**なぜ`--acl public-read`が意味を持つか**: PUT/COPY系のS3操作には、オブジェクト作成と同時にそのオブジェクトのACLを指定できるパラメータがある。書き込み権限自体が緩い場合、攻撃者はアップロードと同時に「誰でも読み取り可能」というACLを付与でき、アップロードしたファイル（例えばマルウェアやフィッシングHTML）を即座に一般公開できてしまう。

> 出典: Cobalt「AWS Bucket Misconfiguration」（Pentest Vulnerability Wiki） — https://www.cobalt.io/vulnerability-wiki/v4-access-control/aws-bucket-misconfig

#### ④ ACL自体の読み取り・書き換え確認

```bash
aws s3api get-bucket-acl --bucket {BUCKET_NAME} --no-sign-request
aws s3api get-object-acl --bucket {BUCKET_NAME} --key index.html --no-sign-request
aws s3api put-bucket-acl --bucket {BUCKET_NAME} --grant-full-control emailaddress={EMAIL} --no-sign-request
```

`put-bucket-acl`が匿名で成功してしまう場合、これは最も深刻な部類の誤設定である。攻撃者は自分のメールアドレス（AWSアカウント）に対して`FULL_CONTROL`権限を付与でき、以後はバケットの所有者と同等の操作（他の全アクセス権限の変更、全オブジェクトの削除等）が可能になる。つまり、単なる情報漏えいから「バケットの実効的な乗っ取り」に発展する。

#### ⑤ バージョニング設定の確認

```bash
aws s3api get-bucket-versioning --bucket {BUCKET_NAME} --no-sign-request
```

バージョニング（オブジェクトの変更履歴を保持する機能）が無効な場合、書き込み権限を突かれてファイルが上書き・削除されると、**元のファイルを復旧する手段がない**。逆にバージョニングが有効であれば、悪意ある上書きが行われても旧バージョンから復元できるため、被害の可逆性という観点で重要な防御層になる。

> 出典: Intigriti「Hacking misconfigured AWS S3 buckets: complete guide」 — https://www.intigriti.com/researchers/blog/hacking-tools/hacking-misconfigured-aws-s3-buckets-a-complete-guide

### バケットサブドメインテイクオーバーとの関連

Sahil Shahの記事では、S3特有の追加リスクとして「サブドメインテイクオーバー」にも言及がある。組織がCNAMEで`assets.example.com`を`example-assets.s3.amazonaws.com`のようなS3バケットに向けていたが、後にそのS3バケット自体を削除・未使用にした場合、S3側のバケット名は空くため、**攻撃者がその名前で新しいバケットを作成し直す**ことでCNAMEの参照先を乗っ取れる。

```
NoSuchBucket エラーが返るが、CNAMEレコードは残っている
→ 攻撃者が同名のバケットを新規作成
→ そのサブドメインの実質的な所有権を奪取
```

**なぜこれが起きるか（仕組み）**: S3のバケット名はグローバルに一意であるが、削除されたバケット名は基本的に再利用可能（早い者勝ち）になる。DNS側のCNAMEレコードが削除されずに残っていると、DNSは名前解決の責任のみを負い、参照先の実体が誰の所有かまでは検証しないため、名前空間の"空き"を先に取った側が実質的にそのサブドメインのコンテンツを制御できてしまう。

> 出典: Sahil Shah「AWS S3 Bucket Hacking 101: Enumeration to Exploitation」 — https://sahil3276.medium.com/aws-s3-bucket-hacking-101-from-enumeration-to-exploitation-e3e2a2948eba

> ⚠️ **未取得の資料の補足について**: Xpl0itZ3r0X「Exploiting Misconfigured AWS S3 Buckets: A Practical Guide」は直接アクセスが403で拒否されたため、リーダープロキシ経由での取得を行った。取得できた内容は本節の「悪用フェーズ」チェックリスト（List／Read／Download／Write／ACL読み取り／ACL書き込み／ファイルタイプ制限／バージョニング）と、S3enum・cloud_enum・LazyS3・AWS Extender・Nucleiというツール一覧に反映済みである。より詳細な文脈（具体的な被害事例の記述など）が必要な場合は、以下のURLからご自身で直接ご覧いただきたい: https://anubhavdhakal.medium.com/exploiting-misconfigured-aws-s3-buckets-a-practical-guide-54255265994e
> （以下は未取得資料の補足として一般知識に基づく解説です）一般的にこの種の実践ガイドでは、上記のチェックリストに加えて、バケットポリシーの`Principal: "*"`指定や`aws:SourceIp`条件の欠落といった、ポリシーJSON単位での誤設定パターンも扱われることが多い。特に`"Principal": {"AWS": "*"}`と`"Effect": "Allow"`の組み合わせで`Condition`句が存在しない場合、事実上全世界に権限を開放していることになる点は、診断時に必ず確認すべき典型パターンである。

### 影響評価の考え方

Cobalt.ioの評価基準では、S3バケット誤設定は次のように格付けされている。

- **発生可能性（Likelihood）**: High（高い） — バケット名の推測・列挙が比較的容易であるため
- **影響度（Impact）**: Medium〜High — 漏えいするデータの機密度、書き込み可否、ACL変更可否によって変動する

> 出典: Cobalt「AWS Bucket Misconfiguration」（Pentest Vulnerability Wiki） — https://www.cobalt.io/vulnerability-wiki/v4-access-control/aws-bucket-misconfig

Intigritiの記事は、診断・報告を行う立場に向けて重要な注意を促している。

> 「脆弱性の潜在的な誤設定を報告する前に、必ず影響を検証すること。一部のAWS S3バケットは意図的に公開設計されている」

これは、静的サイトホスティングやパブリックダウンロード用として意図的に`public-read`が設定されているバケットも多数存在するため、単に「アクセスできた」だけで脆弱性と断定せず、機密情報の露出や意図しない書き込み可否など、実質的なリスクの有無を確認する必要があるという実務上の教訓である。

> 出典: Intigriti「Hacking misconfigured AWS S3 buckets: complete guide」 — https://www.intigriti.com/researchers/blog/hacking-tools/hacking-misconfigured-aws-s3-buckets-a-complete-guide

### 防御策（まとめ）

原典を横断すると、S3誤設定への対策は以下の層に整理できる。

1. **最小権限の原則でバケットポリシー・ACLを設計する**: `Principal: "*"`を安易に使わず、必要な範囲（特定IAMロール、特定VPCエンドポイント等）だけに許可を限定する。
2. **S3 Block Public Access（パブリックアクセスブロック）設定を有効化する**: アカウントレベル・バケットレベルの両方で、意図しないパブリック化を構造的に防止する。
3. **バージョニングを有効にする**: 書き込み/削除権限が万一突かれても、データを復旧できる状態を保つ。
4. **アップロードされるファイルのタイプ・内容を検証する**: 特にSVGなどスクリプト実行が可能な形式は、Content-Typeの強制やサニタイズを行い、保存型XSSを防ぐ。
5. **CloudTrail等でアクセスログを監視し、定期的にACL・ポリシーを監査する**: 誰が・いつ・どの権限を変更したかを追跡可能にし、異常な公開設定を早期検知する。
6. **不要になったバケットとそれに紐づくDNSレコード（CNAME）は同時に削除する**: サブドメインテイクオーバーを防ぐため、バケット削除とDNS参照の解除は必ずセットで行う。

> 出典: Cobalt「AWS Bucket Misconfiguration」（Pentest Vulnerability Wiki） — https://www.cobalt.io/vulnerability-wiki/v4-access-control/aws-bucket-misconfig ／ Intigriti「Hacking misconfigured AWS S3 buckets: complete guide」 — https://www.intigriti.com/researchers/blog/hacking-tools/hacking-misconfigured-aws-s3-buckets-a-complete-guide

本節で扱った手順はいずれも、防御・監査目的での自組織バケットに対する検証を想定している。実在の第三者サービスや本番環境に対して、許可を得ずに列挙・書き込み・ACL変更などを行うことは、法的責任を伴う不正アクセス行為になりうるため行ってはならない。

## バケット列挙ツールと権限昇格の実演

前節までで、S3バケットがなぜ「パブリックに読み書きできる」設定になり得るのか（バケットポリシー・ACL・ブロックパブリックアクセス設定の関係）を学んだ。本節では、その誤設定バケットを実際にどう見つけるか（列挙ツール）、そして見つかった先で何が起こり得るか（クレデンシャル漏洩からの権限昇格）を、公開ツールと実際のインシデント型ウォークスルーに基づいて具体的に見ていく。

いずれも本節の目的は**防御側の理解**である。自分が管理していない実在バケットへの列挙・アクセス試行は、対象組織の利用規約やCFAA等の法令に抵触し得る。実務では自社アセットの棚卸し、許可されたペネトレーションテスト、あるいはPwned LabsのようなサンドボックスCTF環境の範囲内でのみツールを使うこと。

### なぜバケット名の「推測」が成立するのか

S3やそれに類するオブジェクトストレージのバケット名は、多くの場合グローバルに一意な名前空間を共有し、かつ命名規則がある程度予測可能である（会社名、`-dev`／`-prod`／`-backup`などのサフィックス、リージョン名の組み合わせ）。さらに、バケットの存在有無やアクセス可否は、認証情報なしのHTTPリクエスト（`GET`/`HEAD`）に対するレスポンスコードやXMLエラーメッセージの違いから判別できることが多い。たとえば：

- 存在しない・アクセス不可のバケット → `NoSuchBucket`（404）
- 存在するがアクセス権がない → `AccessDenied`（403）
- 存在し一覧参照可能 → `200 OK` とオブジェクト一覧のXML

この「レスポンスの違いから存在とアクセス可否を推測できる」という性質こそが、バケット名の辞書攻撃（ブルートフォース／単語変異によるOSINT）を成立させる根本原理である。攻撃者はこの性質を使い、大量の候補名に対して機械的にHTTPリクエストを送るだけで、認証情報を一切使わずに「開いているバケット」を発見できる。

### S3Scanner（sa7mon）――パブリックバケットの権限を横断的に判定する

S3Scannerは、AWSおよびS3互換API（後述）に対して、指定したバケット名リストが「存在するか」「どのような権限で開いているか」を高速に判定するGo製CLIツールである。

#### 基本的な使い方

```bash
# バケット名リストファイルを指定してスキャン
s3scanner scan --bucket-file names.txt

# 単一バケットを指定し、オブジェクト一覧も列挙（時間がかかる場合あり）
s3scanner scan --bucket my-target-bucket --enumerate

# 結果をJSONで標準出力し、jqで後処理
s3scanner scan --bucket-file names.txt --json | jq '.[]'

# S3互換のカスタムエンドポイント（DigitalOcean Spaces等）を対象にする
s3scanner scan --provider digitalocean --bucket-file names.txt
```

`--bucket-file`にはよくある命名パターン（`<company>`, `<company>-dev`, `<company>-backup`, `<company>-assets`など）を大量に含めたワードリストを渡すのが実践的な運用である。なぜこの方式が効くかと言えば、前述のとおりレスポンスの差分だけでバケットの存在とパブリックアクセス可否が判定できるため、正規の認証情報が一切不要だからである。

#### 権限判定のロジック――なぜ複数の権限区分をチェックするのか

S3Scannerは単に「アクセスできるか／できないか」の二値判定ではなく、以下の権限をユーザーグループごとに個別にチェックする。

| 権限 | 意味 |
|---|---|
| Read | オブジェクトの一覧取得・ダウンロード |
| Write | 新規オブジェクトのアップロード |
| Read ACP | バケットのアクセス制御ポリシー（ACL）の読み取り |
| Write ACP | ACLの書き換え |
| Full Control | 上記すべて |

これを「認証済みユーザー（AuthenticatedUsers＝AWSアカウントを持つ全員）」と「全員（AllUsers＝完全匿名）」の2グループそれぞれに対して評価する。この設計になっている理由は、AWS S3のACLモデルが「誰が」「何を」できるかを別々の軸として持つためである。たとえば「AllUsersにWrite ACPが付与されている」バケットは、匿名の第三者が自分自身に「Full Control」を付け直せてしまうため、表面上はRead不可に見えても実質的には完全掌握可能という、一見の権限チェックだけでは見逃す致命的な誤設定になる。S3Scannerがこの組み合わせを網羅的に洗い出すのは、こうした「間接的にFull Controlへ到達できる経路」を検出するためである。

#### 対応プロバイダとその意味

S3ScannerはAWSに加えて、GCP（Cloud Storageの互換API）、DigitalOcean Spaces、DreamHost DreamObjects、Linode Object Storage、Scaleway Object Storageなど、S3互換APIを実装する複数のプロバイダに対応する。これは、S3のオブジェクトAPI（`GET`/`PUT`/バケット一覧のXMLレスポンス形式など）が事実上の業界標準として他社サービスにも採用されているためであり、「S3固有の脆弱性」ではなく「S3互換APIを実装するあらゆるストレージサービスに共通する設計上のリスク」であることを示している。ただし非AWSプロバイダでは多くの場合パブリック権限のみの判定に限定される、という制約がある点は運用上覚えておく必要がある。

#### 既知の制限

- オブジェクト列挙モード（`--enumerate`）では、1バケットあたり5,000ページを超える一覧はスキップされる（巨大バケットの完全列挙には別途ページネーション処理が必要）。
- 列挙処理はバケットごとにシングルスレッドで行われるため、`--enumerate`を大量バケットに対して使うと時間がかかる。

> 出典: S3Scanner — https://github.com/sa7mon/S3Scanner

### cloud_enum（initstring）――マルチクラウド横断のOSINT列挙

cloud_enumは、単一のキーワード（会社名やプロジェクト名）から、AWS・Azure・GCPの3大クラウドにまたがる公開資産を横断的に探索するPython製OSINTツールである。S3Scannerが「バケット名リストが既にある前提での権限判定」に特化しているのに対し、cloud_enumは「そもそも対象組織がどのクラウド資産を持っているかを名前から推測して発見する」フェーズを担う、より上流の偵察ツールという位置づけになる。

#### 探索対象

- **AWS**: S3バケット（オープン/保護状態の判別）、awsapps系サービス（WorkMail、WorkDocs、Connectなど）
- **Azure**: ストレージアカウント、公開Blobコンテナ、ホスト型データベース、仮想マシン、Webアプリ
- **GCP**: GCPバケット、Firebase Realtime Database、App Engine、Cloud Functions、Firebaseアプリ

#### 動作原理――DNSとHTTPの二段構え

cloud_enumはキーワードを起点に、`fuzz.txt`に定義されたミューテーションパターン（`-dev`, `-backup`, `-prod-2024`等のよくある接尾辞・接頭辞の組み合わせ）で候補名を大量生成し、それぞれに対して以下の2種類の手法を組み合わせて存在確認を行う。

1. **DNSルックアップ**: クラウドサービス特有のFQDNパターン（例: `<name>.s3.amazonaws.com`, `<name>.blob.core.windows.net`）へ名前解決を試みる。多くのマネージドサービスは専用サブドメインを自動的に割り当てるため、DNSが解決できる＝そのサービス名が「予約」されている（＝存在している可能性が高い）ことの強いシグナルになる。
2. **HTTPスクレイピング**: DNSで存在が示唆された候補、あるいは直接HTTPアクセス可能なエンドポイントに対してリクエストを送り、レスポンス内容（ステータスコードやエラー文言）から実際に公開されているかどうかを判定する。

```bash
# 基本的な使い方: 会社名やドメインを複数キーワードとして渡す
uv run cloud_enum -k somecompany -k somecompany.io -k blockchaindoohickey

# スレッド数を増やして高速化(レート制限に注意)
uv run cloud_enum -k targetcorp -t 10

# 特定クラウドを除外し、結果をJSONで保存
uv run cloud_enum -k targetcorp --disable-azure -f json -l results.json
```

Azureのコンテナ探索やGCP Cloud Functionsの探索は、クラウド側がリージョンごとに別々のエンドポイント（例: `<name>.<region>.cloudfunctions.net`）を持つ設計になっているため、デフォルトでは1リージョンのみのスキャンにとどまる。全リージョンを網羅するには追加のオプション指定が必要であり、これは「網羅性とスキャン時間・APIレート制限のトレードオフ」を反映した設計判断である。

#### 開発状況に関する重要な注記（陳腐化対策）

作者のinitstringは本ツールについて「積極的なメンテナンスは行っていない」と明言しており、同種の機能はより活発に保守されているプロジェクト（Nucleiなど）への統合を推奨している。したがって実務でクラウド資産のOSINT列挙を継続的に行う場合は、cloud_enumを出発点としつつも、最新のfuzzワードリストやサービスエンドポイントパターンを別途補完する、あるいはNucleiのcloud-enum系テンプレートと併用する運用が望ましい。

> 出典: cloud_enum — https://github.com/initstring/cloud_enum

### From Bucket to Breach――公開バケットからAWS管理者権限への実演

Pwned Labsの「S3 Enumeration Basics」相当のシナリオを題材にしたウォークスルー記事では、単一の公開S3バケットの発見がどのようにしてAWSアカウント全体の管理者権限奪取にまで連鎖し得るかが、実際の攻撃チェーンとして示されている。

> ⚠️ **一部未取得の情報**: 元記事（Medium: tareshsharma17「From Bucket to Breach」）は直接取得時にHTTP 403（アクセス制限）で本文取得がブロックされました。以下はWebSearch経由で得られた複数の関連ウォークスルー（同一のPwned Labs「huge-logistics」シナリオを扱う他の技術者による記述）を突き合わせて再構成した攻撃チェーンの要約です。正確な記述・スクリーンショットは元記事を直接ご覧ください: https://medium.com/@tareshsharma17/from-bucket-to-breach-s3-enumeration-and-credential-escalation-in-aws-9f63f14ed5f0

（以下は未取得資料の補足として、複数のWebSearch結果および一般知識に基づく解説です）

#### 攻撃チェーンの流れ

1. **初期偵察**: ターゲット組織のサブドメイン（例: `dev.huge-logistics.com`）へアクセスすると、S3バックエンドに由来するとみられるエラーメッセージが返る。これはCloudFrontやS3静的ウェブサイトホスティングでよくある挙動で、バックエンドがS3であることの手がかりになる。
2. **バケットの匿名列挙**: バケットに`AllUsers`グループへの`ListBucket`権限（パブリック一覧参照）が付与されていたため、認証情報なしでオブジェクト一覧を取得できた。ここに`hl_migration_project.zip`のような移行用アーカイブが置かれていた。
3. **クレデンシャルの発見**: アーカイブを展開すると、PowerShellスクリプトやコンフィグファイルの中にハードコードされたAWSアクセスキー（`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`）が平文で含まれていた。これは「秘密情報をコードやアーカイブに直接埋め込む」というアンチパターンが、S3の誤設定と組み合わさることで即座に悪用可能なクレデンシャル漏洩に転化する典型例である。
4. **限定的な初期アクセス**: 発見した認証情報でAWS CLIから認証すると、一部のバケットは見えるものの、機密ファイル（`flag.txt`など）へのアクセスは`403 Forbidden`で拒否された。これは、IAMポリシーがプリンシパル単位できめ細かく（最小権限に近い形で）設定されていたことを示す。
5. **クレデンシャルの連鎖発見**: 権限のある範囲内を調査していくと、さらに複数（記事内の記述では6組程度）の別のIAMユーザーの認証情報が別のオブジェクトから発見され、それぞれの権限を`aws iam get-user`や`aws sts get-caller-identity`、`aws iam list-attached-user-policies`等で確認しながら、より強い権限を持つユーザーへ横展開していった。
6. **IAMポリシーバージョンを悪用した権限昇格**: 最終的に到達したユーザーには`iam:SetDefaultPolicyVersion`権限が付与されていた。IAMのカスタマー管理ポリシーは複数のバージョン（最大5つ）を保持でき、そのうち1つだけが「デフォルト（有効）」として適用される。過去に一度でも広い権限を許可するバージョンが作成され、その後より制限的なバージョンに切り替えられていた場合、`iam:SetDefaultPolicyVersion`さえあれば、削除されずに残っている古い「広い権限」バージョンをデフォルトに戻すだけで、追加の権限を新規作成することなく実質的な権限昇格が完了する。これは、IAMが「ポリシーの変更＝新バージョン作成＋デフォルト切替」という2段階のモデルを取っており、かつ過去バージョンを明示的に削除しない限り残り続ける、という仕様上の性質を突いた昇格手法である。

```bash
# 攻撃者視点の典型的なコマンド列(概念例)
aws s3 ls s3://target-bucket --no-sign-request        # 匿名でのバケット一覧参照
aws s3 cp s3://target-bucket/hl_migration_project.zip . --no-sign-request
unzip hl_migration_project.zip                        # ハードコード済み認証情報を発見

aws configure set aws_access_key_id <発見したキー>
aws configure set aws_secret_access_key <発見したシークレット>
aws sts get-caller-identity                            # 現在の権限を確認

aws iam list-policy-versions --policy-arn <対象ポリシーARN>
aws iam set-default-policy-version \
    --policy-arn <対象ポリシーARN> \
    --version-id v1                                    # 古い広い権限バージョンへロールバック
```

#### この記事が示す構造的な教訓

この攻撃チェーンの本質は、個々のステップが単体では「軽微な誤設定」に見えても、連結することで「匿名アクセス→管理者権限」という致命的な結果に至る点にある。バケットのパブリック一覧参照だけなら情報漏洩リスク止まりだが、そこにクレデンシャルの平文埋め込みが重なり、さらにIAM側の権限設計（ポリシーバージョン管理の不備）が重なることで、被害が指数関数的に拡大した。防御側にとっての要点は以下の3点に集約される。

- **バケットポリシーで明示的にパブリックアクセスを拒否する**（S3のBlock Public Access設定をアカウント／バケット両方のレベルで有効化する）。
- **平文の認証情報を決してオブジェクトストレージやコード内に置かない**。発見された場合は即座にローテーション・無効化する。IAMアクセスキーはSecrets ManagerやSSM Parameter Store（SecureString）等の専用シークレット管理サービスに移行する。
- **IAMポリシーの過去バージョンを定期的に棚卸しし、不要な広い権限バージョンは削除する**。加えて`iam:SetDefaultPolicyVersion`や`iam:CreatePolicyVersion`のような「ポリシー自体を操作できる」権限は、それ自体が強力な昇格経路になり得るため、一般ユーザーには付与しない（最小権限の原則をIAM管理権限そのものにも適用する）。

> 出典: From Bucket to Breach — S3 Enumeration and Credential Escalation in AWS — https://medium.com/@tareshsharma17/from-bucket-to-breach-s3-enumeration-and-credential-escalation-in-aws-9f63f14ed5f0

### まとめ――ツールが明らかにする「誤設定の連鎖」という構図

S3Scannerとcloud_enumは役割が異なる。cloud_enumは「対象組織がどのクラウド資産を持っているか」を発見する上流の偵察ツールであり、S3Scannerは「発見したバケット候補が実際にどの権限で開いているか」を精密に判定する下流のツールである。両者を組み合わせることで、匿名の第三者でも組織のクラウド資産の全体像と、その中の弱点を機械的に特定できてしまう。

そして「From Bucket to Breach」のケースが示すように、単一バケットのパブリック一覧参照という一見軽微な誤設定が、平文クレデンシャルの放置やIAMポリシーバージョン管理の不備と結びつくことで、AWSアカウント全体の管理者権限奪取にまで連鎖し得る。防御側は個々の設定項目（バケットポリシー、ACL、IAMポリシー）を単独で監査するのではなく、「もしこの一箇所が破られたら、次に何が到達可能になるか」という攻撃チェーン全体の視点で継続的に棚卸しすることが不可欠である。


---

[← 第3章 窃取クレデンシャル後のenumeration](03-post-theft-enumeration.md) ｜ [目次](index.md) ｜ [第5章 IAM誤設定と権限昇格 →](05-iam-privilege-escalation.md)
