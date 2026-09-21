## IMDSv2の仕組みとバイパス（フィルタ回避の原理）

本節は防御を目的とした技術解説である。実在サービスや本番環境への無許可の検証、破壊的な操作は扱わない。あくまで「なぜ攻撃が成立するのか」「どう塞ぐか」を仕組みのレベルで理解することが狙いである。

前節までで、SSRF（Server-Side Request Forgery: サーバに任意の宛先へHTTPリクエストを送らせる脆弱性）が EC2 インスタンスのメタデータサービス（IMDS: Instance Metadata Service）に到達すると、そのインスタンスに紐づく IAM ロールの一時クレデンシャルが盗まれ得ることを見てきた。本節では、その対策として登場した **IMDSv2** が「なぜ多くの SSRF を防げるのか」、そして「それでもなお破られる３つの経路」と「SSRFフィルタを回避する各テクニックがなぜ機能するのか」を、パーサやプロトコルの挙動まで掘り下げて解説する。

---

### IMDS とは何か、なぜ狙われるのか

IMDS は、EC2 インスタンスの内部から `169.254.169.254` という **リンクローカルアドレス**（同一リンク内でのみ有効な、ルーティングされない特殊なIPアドレス帯 `169.254.0.0/16`）に対してHTTPでアクセスすると、そのインスタンス自身の情報（インスタンスID、リージョン、ネットワーク設定など）を返してくれるサービスである。

問題は、インスタンスに IAM ロールが割り当てられている場合、`iam/security-credentials/` 配下から **そのロールの一時クレデンシャル（AccessKeyId / SecretAccessKey / Token）が平文で取得できる** 点にある。これは AWS の設計として意図されたもので、SDK や CLI がインスタンス上で自動的に認証情報を得るために使う。しかし、これは「アプリが `169.254.169.254` へHTTPリクエストを送れば認証情報が漏れる」ことも意味する。SSRF はまさにその「任意の宛先へHTTPを送らせる」脆弱性なので、両者は極めて相性が悪い。

> 出典: Datadog Security Labs「Securing the EC2 Instance Metadata Service」 — https://securitylabs.datadoghq.com/articles/misconfiguration-spotlight-imds/

---

### IMDSv1 の攻撃チェーン（前提知識の整理）

まず攻撃者視点で、IMDSv1（旧方式）がどれほど無防備かを確認する。IMDSv1 は認証もトークンも不要な、単純なリクエスト・レスポンス型プロトコルであり、EC2 のデフォルトで有効になっている。SSRF の宛先に metadata IP を指定するだけで、以下の手順で認証情報まで到達できる。

```
# 1. SSRF が metadata に届くか確認
GET http://169.254.169.254/latest/meta-data/

# 2. インスタンスに紐づくロール名を列挙
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/
→ ec2-app-production-role

# 3. ロールの一時クレデンシャルを取得
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/ec2-app-production-role
```

3番目のレスポンスには、次のように生の認証情報が含まれる。

```json
{
  "AccessKeyId": "ASIA3EXAMPLE...",
  "SecretAccessKey": "wJalrXUtnFEMI/K7MDENG/...",
  "Token": "AQoDYXdzEJr...",
  "Expiration": "2026-04-26T18:00:00Z"
}
```

なぜこれで成立するのか。**IMDSv1 は「単純なGETリクエスト一発」で認証情報が返る**ため、SSRF が「攻撃者の指定したURLをGETするだけ」の最小機能しか持たなくても、そのまま悪用できてしまうからである。ヘッダも特殊なHTTPメソッドも要らない。ここが後述の IMDSv2 との決定的な差になる。

> 出典: CyberFortify「SSRF → IMDSv2 → STS」 — https://cyberfortify.co/blog/ssrf-imdsv2-sts-cloud-privilege-escalation

---

### IMDSv2 の仕組み（なぜ多くのSSRFを止められるのか）

IMDSv2 は 2019 年に導入された **セッション指向** の方式で、認証情報を得る前に「セッショントークン」の取得を必須にする。手順は必ず二段階になる。

**ステップ1: PUT リクエストでトークンを取得する**

```
PUT http://169.254.169.254/latest/api/token
X-aws-ec2-metadata-token-ttl-seconds: 21600
```

- `PUT` メソッドで `/latest/api/token` を叩く（`GET` では取得できない）。
- `X-aws-ec2-metadata-token-ttl-seconds`（トークンの有効秒数。最大21600秒＝6時間）を **リクエストヘッダで** 指定する必要がある。
- レスポンスとしてセッショントークン（例: `AQAAANjNkMq...`）が返る。

**ステップ2: 取得したトークンをヘッダに載せてメタデータへアクセスする**

```
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/
X-aws-ec2-metadata-token: AQAAANjNkMq...
```

- 以降のすべてのメタデータ取得で、`X-aws-ec2-metadata-token` **ヘッダ** にトークンを付与しないと `401 Unauthorized` になる。

#### なぜこの設計がSSRFに効くのか（防御原理）

IMDSv2 の効き目は、**「典型的なSSRFにはできないこと」を要求する**点にある。仕組みレベルで３つの障壁がある。

1. **HTTPメソッドの制約（PUTの強制）**: 多くのSSRFは「アプリがサーバ内から指定URLをGETする」機能を悪用する形をとる。IMDSv2 はトークン取得に `PUT` を強制するため、GET しかできないSSRFではトークンそのものを得られない。

2. **カスタムリクエストヘッダの強制**: トークン取得時（TTLヘッダ）とメタデータ取得時（tokenヘッダ）の両方で、**攻撃者が任意のリクエストヘッダを設定できること**が前提になる。Datadog は「敵対者がSSRFを通じてリクエストヘッダを設定できる可能性は低い」と述べている。画像取得やWebhookのような素朴なSSRFは、宛先URLは操作できてもヘッダまでは操作できないことが多い。

3. **ネットワーク層のTTL防御（ホップ制限）**: IMDSv2 はデフォルトで、セッショントークンを含むTCPパケットの **TTL（Time To Live: パケットが通過できるルータ/ホップの残り数）を「1」** に設定する。TTL=1 のパケットは最初のルータを越えられずに破棄される。これにより、**設定を誤ったリバースプロキシやNATが誤ってメタデータのパケットを外部へ転送してしまう事故を防ぐ**。加えて、IMDSv2 はトークン取得リクエストに `X-Forwarded-For` ヘッダが含まれていると拒否する。これは「プロキシ経由で転送されてきたリクエスト」を弾くためで、リバースプロキシ型のSSRFを塞ぐ狙いがある。

> 出典: Datadog Security Labs「Securing the EC2 Instance Metadata Service」 — https://securitylabs.datadoghq.com/articles/misconfiguration-spotlight-imds/

#### 重要な数値: 93%がIMDSv2を「強制」していない

IMDSv2 は「使える」だけでは意味がなく、IMDSv1 を **無効化して強制**（`HttpTokens: required`）しないと防御にならない。ところが Datadog Security Labs の調査では、**2022年9月時点で全EC2インスタンスの最大93%が IMDSv2 の利用を強制していない** とされている。つまり大半の環境では IMDSv1 が今なお併存しており、IMDSv2 という防御は「設定されているが強制されていない」状態に留まっている。これがクラウド侵害で metadata 経由の認証情報窃取が繰り返し起きる構造的な理由である。

> 出典: Datadog Security Labs「Securing the EC2 Instance Metadata Service」 — https://securitylabs.datadoghq.com/articles/misconfiguration-spotlight-imds/

---

### IMDSv2 を破る３つのシナリオ

IMDSv2 は強力だが「単体で完全」ではない。CyberFortify は、IMDSv2 が強制されていても攻撃が成立し得る典型的な３パターンを整理している。

#### シナリオ1: アプリが任意のHTTPメソッド/ヘッダを代行してしまう

SSRFの舞台となる機能が、**PUT/POST や任意ヘッダの送信をサポートしている**場合、攻撃者はアプリ自身を「踏み台」にしてトークンを取得できる。Webhook配信機能や、汎用HTTPクライアントを内蔵したプロキシ機能などが該当する。

> 「脆弱な機能が PUT や POST リクエストを行う（Webhook配信、HTTPクライアントライブラリ）場合、アプリケーション自身が IMDSv2 トークンを取得でき、攻撃者はそれを経由してリクエストを連鎖させられる。」（CyberFortify）

原理: IMDSv2 の障壁は「攻撃者がメソッドとヘッダを制御できないこと」を前提にしている。SSRFのある機能がそもそも豊富なメソッド/ヘッダ操作を許していれば、その前提が崩れ、二段階のトークンフローをそのまま再現できてしまう。

#### シナリオ2: ホップ制限（HttpPutResponseHopLimit）の誤設定

IMDSv2 のTTL防御は `HttpPutResponseHopLimit`（PUTレスポンスのホップ制限）という設定値で調整される。コンテナ／サーバレス系ワークロードでは **デフォルトが1**（つまりメタデータのパケットは同一ホスト内でしか有効でない）。しかし、これを **2以上に引き上げてしまう**と、防御が弱まる。

> 「ホップ制限が1より大きい Lambda 関数や ECS タスクは、IMDSv2 が強制されていてもアプリケーション内部からのSSRFに対して脆弱になる。」（CyberFortify）

原理: コンテナ環境では、アプリのプロセスとメタデータエンドポイントの間に「もう1ホップ」挟まる構成があり得る（例: Podのネットワーク名前空間からノードのメタデータへ）。ホップ制限を2にすると、その追加ホップを越えてパケットが届くようになる。ところが同時に、コンテナ内のアプリからのSSRFパケットも「越えられる」ようになってしまい、防御の意図に反して攻撃面が開く。**ホップ制限はネットワーク距離に応じて必要最小限（可能なら1）に絞るべき**なのは、この「必要な1ホップ」と「攻撃者の1ホップ」が同じ経路を共有するためである。

#### シナリオ3: IMDSv1 がまだ有効なまま（強制されていない）

前述の93%問題そのものである。IMDSv2 が「利用可能」でも、`HttpTokens: required` による強制がされていなければ IMDSv1 は生き続ける。特に2019年より前に作られたAWSアカウントでは、両バージョン併存がデフォルトのまま放置されがちである。攻撃者は難しい IMDSv2 を狙う必要すらなく、**単純なGET一発の IMDSv1 に落として**認証情報を取る。

原理: バージョンの「導入」と「強制」は別物である。旧方式を明示的に閉じない限り、攻撃者は常に最も弱い経路（IMDSv1）を選べる。防御は「最強の方式が使えること」ではなく「最弱の方式を塞ぐこと」で決まる。

> 出典: CyberFortify「SSRF → IMDSv2 → STS」 — https://cyberfortify.co/blog/ssrf-imdsv2-sts-cloud-privilege-escalation

---

### 窃取後: STS を用いた権限昇格の流れ

一時クレデンシャルを得た攻撃者は、それを環境変数に設定して AWS CLI/API を直接叩く。ここからが「メタデータ窃取」から「アカウント侵害」への橋渡しになる。

```bash
export AWS_ACCESS_KEY_ID="ASIA3EXAMPLE..."
export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/..."
export AWS_SESSION_TOKEN="AQoDYXdzEJr..."

# ロールに付与されたポリシーを列挙して権限を把握
aws iam list-attached-role-policies --role-name ec2-app-production-role

# より広い権限を持つロールへ AssumeRole（横展開／昇格）
aws sts assume-role \
  --role-arn arn:aws:iam::123456789:role/DataPlatformAdminRole \
  --role-session-name pen-test-escalation
```

原理: STS（Security Token Service）の `AssumeRole` は「あるロールが別のロールになりすます」正規機能である。CyberFortify は「本番のロールの多くは、クロスアカウント連携・CI/CDパイプライン・特権的なデータ操作のために `sts:AssumeRole` 権限を持つ」と指摘する。つまり、盗んだアプリロールが `AssumeRole` を持っていれば、より強いロールへ一段ずつ昇格でき、最終的に S3 列挙・シークレット取得・インフラ探索まで到達する。**ワイルドカードの `sts:AssumeRole` や `s3:*` を付けた最小権限違反のロールが、被害を「クレデンシャル漏洩」から「アカウント制圧」へ拡大させる**。

> 出典: CyberFortify「SSRF → IMDSv2 → STS」 — https://cyberfortify.co/blog/ssrf-imdsv2-sts-cloud-privilege-escalation

---

### SSRFフィルタ回避が「なぜ」効くのか（パーサ不一致の原理）

多くのアプリは「宛先URLがメタデータIPや内部IPでないか」をフィルタで検査する。しかし、その大半は破られる。IntruderLabs はこの核心を一文で言い切っている。

> 「フィルタとHTTPクライアントの見解が食い違う。バリデータはURLをある読み方で読み、実際にソケットを開く関数は別の読み方で読む。」（IntruderLabs）

つまりSSRFフィルタ回避の本質は **「検証する側（文字列を見るバリデータ）」と「接続する側（実際に名前解決してソケットを開くクライアント）」の解釈のズレを突く**ことにある。以下、代表的な技法とその「なぜ効くか」を、原典の分類に沿って解説する。

#### (1) IPアドレスの別表記

IPv4アドレスは本質的に **32ビット整数** であり、その文字列表現は一通りではない。`inet_aton()` のような変換関数は多様な表記を受理するが、正規表現ベースのブロックリストは想定した形しか見ていない。

| 技法 | ペイロード | 到達先 | なぜ効くか |
|------|-----------|--------|-----------|
| 10進整数 | `http://2130706433/` | 127.0.0.1 | 32ビット整数をそのままアドレスに変換。`127.0.0.1`という文字列を探すブロックリストに一致しない |
| 16進（ドット無し） | `http://0x7f000001/` | 127.0.0.1 | `0x` 接頭辞で16進解釈。`\d+\.\d+\.\d+\.\d+`の正規表現にマッチしない |
| 8進（先頭ゼロ） | `http://0177.0.0.1/` | 127.0.0.1 | 先頭の`0`で8進解釈（`0177`8進=127） |
| オクテット溢れ | `http://127.0.0.257/` | 127.0.0.1 | オクテットごとに256で剰余（`257 % 256 = 1`） |
| 短縮形 | `http://127.1/` | 127.0.0.1 | 末尾を24ビットとして解釈。4オクテット必須のチェックを回避 |

メタデータIPへ応用すると、`169.254.169.254` の10進整数表記や、`http://169.254.169.254.nip.io/`（外部の正規ドメイン名だが内部IPに解決される「ワイルドカードDNS」サービス）で、文字列ベースのドメイン許可リストを迂回できる。

原理: バリデータは「文字列 `169.254.169.254`」を探すが、`inet_aton()` や名前解決は「最終的な32ビットの数値」を見る。両者が別の層で判断しているため、数値としては同じでも文字列としては別物にできる。

#### (2) IPv6埋め込み

```
http://[::ffff:169.254.169.254]/     → 169.254.169.254 に到達
http://[::ffff:7f00:1]/               → 127.0.0.1 に到達
```

原理: `::ffff:` から始まるのは **IPv4射影アドレス**（IPv6の中にIPv4を埋め込む正規表記）。デュアルスタック環境では実際にはIPv4側の `169.254.169.254` へ接続するが、IPv4形式しか検査しないバリデータは角括弧の中身を素通りさせる。

#### (3) 許可リスト（allowlist）回避

ホスト抽出ロジックが「URL文字列の形は信頼できる」と決めつけていることを突く。

| 技法 | ペイロード | なぜ効くか |
|------|-----------|-----------|
| 埋め込み認証情報 | `http://allowed.com@169.254.169.254/` | `@`の前は **userinfo（ユーザ情報）** でありホストではない。`startsWith("allowed.com")` のような素朴な検査は通るが、クライアントは`@`以降のIPへ接続する |
| フラグメント混乱 | `http://169.254.169.254#@allowed.com/` | `#`以降はフラグメント。パーサ間で「どこからがフラグメントか」の解釈が割れる |
| 末尾ドット(FQDN) | `http://169.254.169.254./` | 末尾ドット付きは有効な絶対FQDN。多くのリゾルバは受理するが文字列比較は外れる |
| サフィックス偽装 | `http://allowed.com.evil.com/` | `endswith("allowed.com")` を誤って通す。実際のホストは攻撃者支配下 |
| パーセントエンコード | `http://ALLOWED.com%2f@169.254.169.254/` | `%2f`は`/`。バリデータは未デコードで比較し、クライアントはデコードして別ホストと解釈 |

原理: これらはすべて **URL構文の各要素（userinfo / host / path / fragment）の境界を、バリデータとクライアントが違う位置に引く**ことを利用する。RFC 3986 に厳密なパーサと、ブラウザ流の WHATWG URL 仕様に従うクライアントでは、`\`（バックスラッシュ）や特殊なUnicode文字（例: U+2044の分数斜線 `⁄`）の扱いが異なり、同じ文字列から別のホストを取り出す。防御側は「比較前に必ず正規化（大文字小文字・パーセントデコード・IDNA）せよ」というのがIntruderLabsの結論である。

#### (4) DNSリバインディング（検証と接続の時間差 = TOCTOU）

```
http://rebind.attacker.com/
  1回目の名前解決（検証時）: 公開IP → 許可リストを通過
  2回目の名前解決（接続時）: 127.0.0.1 や 169.254.169.254
```

原理: 攻撃者が権威DNSを支配し、**TTL=0（キャッシュ無効）**で応答を返すと、バリデータが解決した瞬間は「安全な公開IP」、実際に接続する瞬間には「内部IP」に化ける。これは典型的な **TOCTOU（Time-Of-Check to Time-Of-Use: 検査した時点と使用する時点のズレ）** 脆弱性である。IntruderLabsは「DNSを解決して検証した後、名前で再接続すれば（クライアントに再解決させれば）リバインディングが勝つ」と述べる。防御は「検証したまさにそのIPに接続し、二度目の名前解決をしない」こと。

#### (5) リダイレクトによるバイパス（DNS不要のリバインディング）

```
最初のURL: https://attacker.com/r   ← 公開・許可リスト通過
レスポンス: HTTP/1.1 302 Found
           Location: http://169.254.169.254/latest/meta-data/...
```

原理: クライアントが **最初のURLだけを検証し、その後のリダイレクトを盲目的に追う**と、302で内部IPへ誘導される。IntruderLabsはこれを「HTTP層におけるDNSなしのリバインディング」と呼ぶ。防御は「自動リダイレクトを無効化するか、各ホップを再検証する」こと。

> 出典: IntruderLabs「SSRF Bypasses: why each filter-evasion technique works」 — https://intruderlabs.com.br/en/blog/ssrf-bypass-techniques/

#### 補足: 他クラウドのメタデータエンドポイント

回避技法は他クラウドにも適用でき、必要なヘッダも異なる。防御の網羅性のために表を挙げる。

| プロバイダ | エンドポイント | 必須要件 |
|-----------|--------------|---------|
| AWS IMDSv2 | `169.254.169.254` | `PUT`でトークン取得＋`X-aws-ec2-metadata-token`ヘッダ |
| GCP | `169.254.169.254` / `metadata.google.internal` | `Metadata-Flavor: Google` ヘッダ必須（`?recursive=true`で全メタデータ） |
| Azure | `169.254.169.254` | `Metadata: true` ヘッダ＋`api-version`パラメータ |
| Alibaba Cloud | `100.100.100.200` | トークン不要・AWS類似レイアウトだがIPが異なる |

IntruderLabsは、IMDSv2 が「（単体では完全でないが）非常に効果的な防御」である理由を、まさに「素朴なSSRFには供給できないメソッドとヘッダを要求するから」と要約している。GCP の `Metadata-Flavor: Google` ヘッダ要求も同様の狙いだが、ヘッダを付けられるSSRFに対しては弱い防御にとどまる。

> 出典: IntruderLabs「SSRF Bypasses: why each filter-evasion technique works」 — https://intruderlabs.com.br/en/blog/ssrf-bypass-techniques/

---

### presigned URL の悪用（SSRF×IMDSv2 の実践的帰結）

> ⚠️ **未取得の資料**: 「Harsha GV『How SSRF Exploits IMDSv2 Limitations in AWS』」は自動取得できませんでした（理由: 直接のWebFetchがHTTP 403 Forbiddenで拒否。Mediumの反ボット制御によるものと推測）。以下のURLからご自身で直接ご覧ください: https://medium.com/@harshagv/uncovering-cloud-security-flaws-how-ssrf-exploits-imdsv2-limitations-in-aws-75bd4201786b
>
> なお、記事の技術的要旨は Web 検索経由で確認できたため、その範囲で以下にまとめる。

同記事は、Spring Boot 製アプリに `/proxy?url=...` という **任意URLへリクエストを転送する** エンドポイント（＝SSRF）を用意し、これを起点に IMDSv2 環境で認証情報を奪取し、さらに **presigned URL を悪用して VPC エンドポイント制限を回避する** までを示している。要点は次の通り。

- **SSRFの起点**: `/proxy?url=...` は与えられたURLへサーバ側からリクエストを送るため、`169.254.169.254` を宛先にできる。前述シナリオ1（アプリがHTTPクライアントを代行する）に該当し、IMDSv2 のトークンフローもアプリ経由で再現し得る。
- **認証情報の収集**: メタデータから IAM ロールの一時クレデンシャルを取得する。
- **presigned URL の悪用**: 盗んだ認証情報で S3 オブジェクトへの **presigned URL（署名付きURL: 一時的に特定オブジェクトへのアクセスを許可する、署名を埋め込んだURL）** を生成し、これを使って S3 の機密コンテンツを取得できた。記事は、presigned URL が **VPCエンドポイントの制限を回避して** S3 バケットへの不正アクセスを可能にした点を強調している。

（以下は未取得資料の補足として一般知識に基づく解説です）

presigned URL がなぜ「VPCエンドポイント制限を回避」できるのかを原理面で補う。presigned URL は、生成者（ここでは盗まれたロール）の権限と署名を **URL自体に埋め込んだ**もので、そのURLを持つ者は追加の認証なしにオブジェクトへアクセスできる。VPCエンドポイントポリシーは「どのネットワーク経路・どのプリンシパルからS3へアクセスできるか」を制御するが、presigned URL の検証は主として **署名の正当性と有効期限** に基づく。したがって、攻撃者が VPC 内で生成した presigned URL を **VPC外の自分の環境から** 使うと、S3側は「有効な署名を持つ正当なリクエスト」として扱い得る。これは「認証情報そのものを外部へ持ち出せなくても、認証情報で作った署名付きURLなら持ち出せる」という、データ持ち出し（exfiltration）の観点で重要な回避経路である。防御としては、S3バケットポリシーやVPCエンドポイントポリシーで `aws:SourceVpce` / `aws:SourceIp` 等の条件をオブジェクトアクセス自体に厳格に適用し、presigned URL の有効期限を極小化することが挙げられる。

> 出典: Harsha GV「How SSRF Exploits IMDSv2 Limitations in AWS」（本文は未取得、要旨はWeb検索で確認） — https://medium.com/@harshagv/uncovering-cloud-security-flaws-how-ssrf-exploits-imdsv2-limitations-in-aws-75bd4201786b

---

### 防御のまとめ（多層防御の設計）

IMDSv2 は「必要条件だが十分条件ではない」。SSRF回避技法とバイパスシナリオを踏まえると、防御は次の層を重ねる必要がある。

**1. IMDSv2 を「強制」する（IMDSv1を閉じる）**

利用可能にするだけでは93%問題に陥る。組織全体で強制するには SCP（Service Control Policy: 組織単位でアクションを制限するAWS Organizationsのポリシー）が有効である。Datadogは主に３本のSCPを推奨している。

```json
// (a) 起動時に IMDSv2 を必須にする（HttpTokens=required 以外の RunInstances を拒否）
{
  "Sid": "RequireImdsV2",
  "Effect": "Deny",
  "Action": "ec2:RunInstances",
  "Resource": "arn:aws:ec2:*:*:instance/*",
  "Condition": { "StringNotEquals": { "ec2:MetadataHttpTokens": "required" } }
}
```

```json
// (b) IMDSv1 へ戻す変更（ModifyInstanceMetadataOptions）を禁止
{ "Sid": "PreventModifyInstanceMetadata", "Effect": "Deny",
  "Action": "ec2:ModifyInstanceMetadataOptions", "Resource": "*" }
```

```json
// (c) IMDSv1 経由で配布された認証情報の使用自体を拒否（RoleDelivery < 2.0）
{ "Sid": "RequireAllEc2RolesToUseV2", "Effect": "Deny",
  "Action": "*", "Resource": "*",
  "Condition": { "NumericLessThan": { "ec2:RoleDelivery": "2.0" } } }
```

(c) が特に強力なのは、**万一 IMDSv1 で認証情報が漏れても、その認証情報を使ったAPI呼び出しをAWS側で拒否する**ため、漏洩を「実害」に転化させない点である（`ec2:RoleDelivery` は認証情報がv1/v2どちらで配られたかを示す条件キー）。

> 出典: Datadog Security Labs「Securing the EC2 Instance Metadata Service」 — https://securitylabs.datadoghq.com/articles/misconfiguration-spotlight-imds/

**2. ホップ制限を最小化する**: IaC（Infrastructure as Code）で `HttpPutResponseHopLimit: 1` を明示する。コンテナ/サーバレスで必要な場合のみ最小値まで許容する。

**3. ネットワークレベルで metadata IP を遮断する**: メタデータアクセスが不要なワークロードでは `169.254.169.254/32` への egress を塞ぐ。

**4. SSRF側の根本対策（文字列を信頼しない）**: IntruderLabsの結論通り、防御は「文字列を信頼してはならない。サーバがソケットを開くまさにその瞬間に、どのバイナリアドレス・どのネットワークへ接続してよいかを制御しなければならない」。具体的には、(1) スキームとホストの許可リスト（HTTPSのみ、拒否をデフォルト）、(2) DNS解決後に得たIPをプライベート/予約済み範囲（`169.254.0.0/16`, RFC1918 等）と照合し、**検証したそのIPへ接続する（再解決しない）**、(3) 自動リダイレクトの無効化または各ホップ再検証、(4) 比較前の正規化（大文字小文字・パーセントデコード・IDNA・IP正規化）、(5) `file://` `gopher://` `dict://` 等の危険スキームの無効化。

**5. IAMの最小権限**: ワイルドカードの `sts:AssumeRole` や広範な `s3:*` を排し、権限昇格の連鎖を断つ。加えて `aws:EC2InstanceSourceVPC` / `aws:EC2InstanceSourcePrivateIPv4` 条件キーで、認証情報を発行元インスタンス以外から使わせない。

**6. 検知（CloudTrail）**: アプリロールからの想定外の `GetCallerIdentity` / `AssumeRole`、通常見られない `ListBuckets` / `GetSecretValue` を検知ルール化する。

> 出典: CyberFortify「SSRF → IMDSv2 → STS」 — https://cyberfortify.co/blog/ssrf-imdsv2-sts-cloud-privilege-escalation ／ Datadog Security Labs — https://securitylabs.datadoghq.com/articles/misconfiguration-spotlight-imds/

---

### 本節のまとめ

- IMDSv2 は「PUTメソッド＋カスタムヘッダ＋TTL=1」という **素朴なSSRFにはできない条件** を課すことで、多くのSSRFを止める。だが「導入」と「強制」は別物で、2022年9月時点で93%が未強制だった。
- 破られる経路は主に３つ: (1) アプリがメソッド/ヘッダを代行、(2) ホップ制限の誤設定（>1）、(3) IMDSv1 併存。
- SSRFフィルタ回避が効くのは、常に **「文字列を検証する層」と「実際に接続する層」の解釈のズレ**（IP別表記・URLパーサ混乱・DNSリバインディング・リダイレクト）を突くからである。
- 窃取後は STS の `AssumeRole` を軸に権限昇格し、presigned URL 悪用のようにデータ持ち出し経路まで拡大し得る。
- 防御は単層では足りない。IMDSv2強制・ホップ制限最小化・metadata遮断・SSRF根本対策・最小権限・検知を **多層で** 重ねることが要点である。
