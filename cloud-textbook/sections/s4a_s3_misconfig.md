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
