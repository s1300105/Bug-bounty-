# 第10章 継続的Reconとモニタリング


## Certificate Transparency監視による新資産検知

継続的Recon（偵察）の中で、Certificate Transparency（CT、証明書の透明性）ログの監視は「もっとも費用対効果が高い一次情報源」と言ってよい。理由は単純で、**組織が新しいホストを公開する前に、証明書が先に世界中へ公開されてしまう**からである。DNSレコードを引く、ポートを叩く、クロールする——そうした能動的な行為を一切せずに、「昨日までなかった資産」が今日発生したことを知れる。本節では、この性質がなぜ成立するのかをプロトコルの内部から説明し、そのうえでポーリング型（Sublert）とストリーム型（CertEagle/certstream）という2つの実装様式を、原典の実コードを読みながら比較する。最後に、自組織の資産管理・シャドーIT検出・不正発行検知という防御側の運用設計に落とし込む。

> **本節のスコープ**: 記述はすべて**防御目的**（自組織・自身が明示的に権限を持つ資産の可視化と監視）を前提とする。第三者の資産を無断で監視・検証する行為、破壊的な手順、特定サービスへの攻略手順は扱わない。これは原典の著者自身も明記している姿勢であり、CertEagleのREADMEにも *"Strict Warning: Do not monitor assets of any organisation without prior consent"*（組織の資産を事前の同意なく監視してはならない）と書かれている。

---

### 1. なぜCTログに「まだ存在しない資産」が載るのか

#### 1.1 CTの基本構造：追記専用のMerkle木

CTはRFC 6962（2013年）で定義され、RFC 9162（2021年）で改訂された仕組みで、公的CA（認証局）が発行したTLS証明書を**公開の追記専用ログ**へ記録させる。ここで重要な用語を先に噛み砕いておく。

- **CTログ**: 証明書を時系列に追記していく公開サーバ。運用者はGoogle（Argon/Xenon系列）、Cloudflare（Nimbus）、DigiCert、Sectigo、Let's Encrypt（Oak、およびSunlight実装のWillow/Sycamore）、TrustAsiaなど複数。
- **Merkle木（マークルツリー）**: 各エントリのハッシュを二分木状に畳み込み、根（root hash）1個で全体を代表させるデータ構造。あるエントリが含まれることの証明（inclusion proof）も、ログが過去を書き換えていないことの証明（consistency proof）も、O(log n)個のハッシュだけで検証できる。**したがってログ運用者は「後から消す・差し替える」ことが暗号学的にできない**。CTログが「消せるデータベース」ではなく「消せない台帳」であるのはこの構造ゆえである。
- **SCT（Signed Certificate Timestamp、署名付き証明書タイムスタンプ）**: ログが「この証明書を受理し、一定時間（MMD: Maximum Merge Delay、通常24時間）以内に木へ併合する」と約束する署名付きの受領証。
- **プレ証明書（precertificate）**: 本番の証明書とほぼ同内容だが「毒（poison）拡張」が付いていてTLSでは使えない、SCT取得専用の証明書。SCTを本証明書の拡張フィールドに埋め込むには、埋め込む前にログへ提出しなければならないという鶏と卵の問題があるため、先にプレ証明書を提出してSCTを得る。**この結果、同一ホスト名が「プレ証明書」と「本証明書」の2エントリとしてログに現れる**（後述の重複排除で効いてくる）。

#### 1.2 「公開前に漏れる」の原理

ブラウザ側の強制が効いている。Chromeは2018年4月以降に発行された公的に信頼される証明書に対し、接続時にSCTの提示を要求する（提示がなければ証明書エラー）。Appleも同様のポリシーを持つ。つまり**CAは、顧客が使える証明書を作るためには、必ず事前にログへ載せるしかない**。

そして実運用のタイムラインはこうなる。

```
[1] 証明書発行（CA → CTログ提出）      ← ここでホスト名が全世界に公開される
[2] 証明書をロードバランサ/サーバへ配備
[3] DNSに A / CNAME を登録
[4] ファイアウォール開放・一般公開
```

`[1]` と `[3]` の間は、数分のこともあれば数週間のこともある。ステージング環境や社内向けサービスでは `[3]` が公開DNSに出ないことすらある。**にもかかわらず `[1]` は消せない**。ここに、「パケットを1つも送らずに新資産を知る」という非対称性が生まれる。

#### 1.3 CTで見えないもの（限界を先に押さえる）

教科書として重要なのは、万能ではないことを最初に明示することである。

- **ワイルドカード証明書**: `*.example.com` としか書かれていなければ、個々のサブドメイン名は出ない。攻撃者視点では「隠蔽策」、防御側の可視性から見れば「盲点」。
- **プライベートCA / 内部PKI**: 社内CAが発行した証明書はCTに載らない（載せる義務がない）。
- **証明書を使わないサービス**: 平文HTTP、非TLSの独自プロトコル。
- **IPアドレスのみのエンドポイント**: SANにIPを入れる証明書は稀。

---

### 2. 資料1: Sublert — 差分ベースのポーリング型監視

> ⚠️ **未取得の資料**: 「Automated monitoring of subdomains for fun and profit — Release of Sublert」（Yassine Aboukir）は自動取得できませんでした（理由: Mediumが HTTP 403 Forbidden を返却）。以下のURLからご自身で直接ご覧ください: https://medium.com/@yassineaboukir/automated-monitoring-of-subdomains-for-fun-and-profit-release-of-sublert-634cfc5d7708
>
> （以下は、著者本人の公式リポジトリ `github.com/yassineaboukir/sublert` の README および `sublert.py` 実装から取得した一次情報と、一般知識に基づく補足解説です。コード断片は同リポジトリ master ブランチ、バージョン1.4.7時点のものです。）

#### 2.1 設計思想

Sublertの自己紹介はこうである——「*leverages certificate transparency for the sole purpose of monitoring new subdomains deployed by specific organizations and issued TLS/SSL certificate*（CTを、特定組織が新たに配備しTLS/SSL証明書を発行したサブドメインの監視という一点のために活用する）」。

要件は驚くほど軽い。

- Unix系のVPS（著者はDigitalOceanを例示）
- Python 2.x / 3.x
- 無料のSlackワークスペース

設計の要点は3つに集約される。**(a) 定期的にCTを問い合わせ、(b) 前回の結果とdiffを取り、(c) 増分だけをSlackへ通知する**。地味だが、これは「継続的Recon」の原型そのものである。

#### 2.2 CTへの問い合わせ：crt.shの2経路

`sublert.py` は crt.sh を2通りで叩く。第一がPostgreSQLへの直接接続である。

```python
conn = psycopg2.connect("dbname={0} user={1} host={2}".format(DB_NAME, DB_USER, DB_HOST))
cursor.execute("SELECT ci.NAME_VALUE FROM certificate_identity ci "
               "WHERE ci.NAME_TYPE = 'dNSName' "
               "AND reverse(lower(ci.NAME_VALUE)) LIKE reverse(lower('%{}'));".format(domain))
```

crt.sh（Sectigoが運用するCTログの横断インデックス）は、Webの検索UIだけでなく **公開のPostgreSQLエンドポイント（ホスト `crt.sh`、DB `certwatch`、ユーザ `guest`、ポート5432）** を提供している。ここを直接叩くのは、HTTP API経由よりも表現力が高く、かつ大量取得に向くためだ。

ここで**なぜ `reverse(lower(...)) LIKE reverse(lower('%...'))` なのか**が、この節の技術的な肝である。

- SQLの `LIKE '%foo'`（前方にワイルドカード）は、B-treeインデックスを使えない。文字列の先頭が固定されていないため、インデックスの探索範囲を絞れず、**フルスキャン**になる。
- しかしドメイン名の検索は本質的に**サフィックス（末尾）一致**である（`api.example.com` は `example.com` で終わる）。
- そこで文字列を反転させると、サフィックス一致が**プレフィックス一致**に変わる。`reverse('api.example.com')` = `'moc.elpmaxe.ipa'` は `reverse('example.com')` = `'moc.elpmaxe'` で**始まる**。
- crt.shのスキーマには `reverse(lower(name_value))` に対する関数インデックスが張られているため、この書き換えによって前方一致（`LIKE 'moc.elpmaxe%'` 相当）としてインデックスが効き、クエリが実用的な時間で返る。

つまりこの一行は、「ドメインのサフィックス検索を、インデックスの効くプレフィックス検索に変換する」という古典的テクニックの実例である。CTを自前で扱うなら真っ先に覚えるべきイディオムだ。

第二の経路が、DB接続が失敗したときのHTTPフォールバックである。

```python
base_url = "https://crt.sh/?q={}&output=json"
domain = "%25.{}".format(domain)          # "%25" は "%" のURLエンコード → "%.example.com"
req = requests.get(url, headers={'User-Agent': user_agent}, timeout=30, verify=False)
data = json.loads(content)
for subdomain in data:
    subdomains.add(subdomain["name_value"].lower())
```

`%25.{domain}` は、URLエンコードを戻すと `%.example.com`、すなわちSQLのワイルドカードを含む検索語である。crt.shのHTTP APIは `q` パラメータの `%` をそのままLIKEパターンとして解釈するため、これでサブドメイン網羅検索になる。`name_value` は証明書のSAN（Subject Alternative Name、証明書が名乗ってよいホスト名の一覧）に含まれる1エントリで、**改行区切りで複数ホスト名が入ることがある**点に注意が必要だ（後述の正規化で扱う）。

また、対象ドメインの正規化には `tld` ライブラリが使われる。

```python
domain = get_fld(domain, fix_protocol=True)     # First-Level Domain（登録可能なドメイン）を取得
matches = re.findall(r"\'(.+?)\'", str(result))
```

`get_fld()` は Public Suffix List（`co.uk` や `s3.amazonaws.com` のような「登録可能な境界」の一覧）に基づき、`https://dev.api.example.co.uk/` のような入力から登録単位のドメイン `example.co.uk` を取り出す。**単純に「最後のドット2つ」で切ると `co.uk` になってしまう**——この誤りを避けるためにPSLが要る、という点は自作ツールでも必ず踏む落とし穴である。

#### 2.3 差分検出：なぜdiffなのか

```python
diff = difflib.ndiff(file1.readlines(), file2.readlines())
changes = [l for l in diff if l.startswith('+ ')]
```

保存済みのベースライン（前回取得したサブドメイン一覧のファイル）と、今回取得した一覧を `difflib.ndiff` で比較し、**追加行（`'+ '` 始まり）だけ**を変更点として取り出す。

素朴に見えるが、ここには設計上の意味がある。CTの全量は放っておけば単調増加し、毎回全件を通知すると即座にアラート疲れ（alert fatigue）を起こす。**「状態」ではなく「状態の差分」を通知単位にする**ことで、ツールは初めて日次運用に耐える。なお `ndiff` は行の並びに依存するため、両ファイルが同じ規則（小文字化＋ソート＋重複排除）で正規化されていることが前提になる。実務で自作する場合は、順序非依存の集合差分（`set(new) - set(old)`、あるいはUnixの `comm -13`、ProjectDiscoveryの `anew` 等）のほうが堅牢である。

#### 2.4 生存確認：DNS解決

```python
for qtype in ['A', 'CNAME']:
    dns_output = dns.resolver.query(domain, qtype, raise_on_no_answer=False)
    if dns_output.rdtype == 1:      # A レコード
        a_records = [str(i) for i in dns_output.rrset]
    elif dns_output.rdtype == 5:    # CNAME レコード
        cname_records = [str(i) for i in dns_output.rrset]
```

`rdtype == 1` が A、`5` が CNAME というのはDNSのリソースレコード種別番号（IANA登録値）そのままである。CTで見つかった名前の多くは**まだ、あるいはもう解決しない**ため、この段階で「実在する資産」と「紙の上だけの名前」を分離する。CNAMEを取るのは、`asset.example.com → something.cloudfront.net` のように**第三者SaaSへ委譲されている**ことを見抜くためで、防御側にとってはサプライチェーン把握とダングリングCNAME（参照先が失効した委譲）の検出に直結する。

なお、DNS解決は**能動的な通信**である。CT問い合わせまでが完全パッシブ、ここから先はアクティブ、という境界を意識しておくこと。自組織の資産に対してのみ行うのが原則である。

#### 2.5 通知と運用

```python
webhook_url = posting_webhook
slack_data = {'text': data}
requests.post(webhook_url, data=json.dumps(slack_data),
              headers={'Content-Type': 'application/json'})
```

Slack Incoming Webhookへ素のJSONをPOSTするだけである。セットアップ手順としては、Slackワークスペースに**サブドメイン通知用**と**エラーログ用**の2チャンネルを作り、`api.slack.com/apps` でアプリを作成してそれぞれにIncoming Webhookを紐づけ、得られたURLを `config.yaml` に記載する。エラー用を分けるのは、CTの取得失敗やDB接続断を「通知の沈黙」と区別するためで、監視ツール自身の監視（dead man's switch的発想）として正しい。

主なフラグは以下のとおり。

| フラグ | 用途 |
|---|---|
| `-u` / `--url` | 監視対象ドメインを追加 |
| `-d` / `--delete` | 監視対象から削除 |
| `-a` / `--list` | 監視中ドメインの一覧表示 |
| `-t` / `--threads` | 並列スレッド数（既定20） |
| `-r` / `--resolve` | DNS解決を有効化 |
| `-l` / `--logging` | Slackへのエラーログ送出を有効化 |
| `-m` / `--reset` | 全設定・データの初期化 |
| `-q` / `--question` | 対話プロンプトの有無を切替（自動実行時は無効化する） |

定期実行はcronで行う（READMEは「理想的には毎日」と述べている）。自動実行では対話プロンプトを切る必要がある点に注意。

```cron
# 毎日 03:00 に監視を実行し、DNS解決とエラーログを有効化、対話プロンプトは無効化
0 3 * * * cd /opt/sublert && /usr/bin/python3 sublert.py -r -l -q no >> /var/log/sublert.log 2>&1
```

#### 2.6 ポーリング型の構造的な遅延

ここが次節への橋渡しになる。ポーリング型の検知遅延は、次の3つの和になる。

```
検知遅延 = (CAがログへ提出するまで) + (crt.shがそのログを取り込みインデックスするまで) + (cron間隔の残り時間)
```

crt.shは全ログを常時取り込んでいるが、取り込みは即時ではなくラグがある。加えてcronが日次なら最悪24時間近い待ちが入る。したがって**「発行から数分以内に知りたい」用途には、原理的に届かない**。

> 出典: Automated monitoring of subdomains for fun and profit — Release of Sublert — https://medium.com/@yassineaboukir/automated-monitoring-of-subdomains-for-fun-and-profit-release-of-sublert-634cfc5d7708 （本文は403で取得できず、記述は著者公式リポジトリ https://github.com/yassineaboukir/sublert の README / `sublert.py` に基づく）

---

### 3. 資料2: CertEagle — ライブCTログのストリーム監視

> ⚠️ **未取得の資料**: 「Weaponizing Live CT logs for automated monitoring of assets」（Devansh Batham / Asm0d3us、2021年9月）は自動取得できませんでした（理由: Mediumが HTTP 403 Forbidden を返却）。以下のURLからご自身で直接ご覧ください: https://medium.com/@Asm0d3us/weaponizing-live-ct-logs-for-automated-monitoring-of-assets-39c6973177c7
>
> （以下は、著者本人の公式リポジトリ `github.com/devanshbatham/CertEagle` の README および `certeagle.py` から取得した一次情報と、一般知識に基づく補足解説です。）

#### 3.1 発想の転換：問い合わせるのをやめ、流れてくるものを見る

CertEagleの立脚点は明快である。**「定期的にcrt.shへ問い合わせる」のではなく、「CTログの流れそのものに接続し続ける」**。原典の言葉を借りれば、バグバウンティでも資産管理でも、新資産をいち早く把握できることが差になる——ただしこれは自組織資産・許諾済みスコープに限った話である（READMEの警告のとおり）。

実装の中心は **certstream** である。certstreamはCalidog Securityが提供する仕組みで、Chrome/Appleが信頼する各CTログを購読し、新規エントリを正規化してWebSocketで配信する。

```
接続先: wss://certstream.calidog.io/
```

メッセージは大きく2種類で、`message_type` が `heartbeat`（接続維持）か `certificate_update`（新規証明書）。後者の `data.leaf_cert.all_domains` に、CN（Common Name）とSANを統合したホスト名の配列が入る。**「leaf」はチェーンの末端＝サーバ証明書**の意。

最小の購読コードは次のようになる。

```python
import certstream

def print_callback(message, context):
    if message['message_type'] == 'certificate_update':
        domains = message['data']['leaf_cert']['all_domains']
        for domain in domains:
            if 'target.com' in domain:
                print(domain)

certstream.listen_for_updates(print_callback)
```

これが機能する理由は、CTログが**追記された瞬間にpublicly readable**であることにある。ログAPI（RFC 6962の `get-sth` で木の頭を見て、`get-entries` で範囲取得する）をcertstream側が高頻度でポーリングし、差分をWebSocketへ押し出している。つまり利用者から見れば「プッシュ」だが、内部ではログAPIの高頻度ポーリングである——この理解があると、certstreamが落ちたときに自前でどう代替するかが分かる。

#### 3.2 CertEagleの構成

```
CertEagle/
├── certeagle.py          # 本体
├── config.yaml           # Slack webhook 設定
├── domains.yaml          # 監視するドメイン／キーワード
├── requirements.txt
├── already-seen.log      # 重複通知防止ログ
└── output/
    └── found-domains.log # 検出結果
```

設定は2ファイル。

```yaml
# config.yaml
slack_webhook_url: "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

```yaml
# domains.yaml
# 先頭にドットを付けるとサブドメイン監視
domains:
  - .example.com          # 自社の登録ドメインのみを列挙すること
keywords:
  - example-internal      # 社名・プロダクト名などのキーワード監視
```

実行は依存関係を入れて常駐させるだけである。

```bash
pip3 install -r requirements.txt
python3 certeagle.py
```

動作フローは、(1) YAMLから照合ルールとWebhookを読み込み、(2) certstreamへ永続接続、(3) `all_domains` を走査してルールに一致するものを抽出、(4) `list(set(...))` で当該メッセージ内の重複を除去、(5) `output/found-domains.log` へ日付（`YYYY-MM-DD`）付きで追記、(6) `already-seen.log` を参照して**未通知のものだけ**Slackへ送る、というもの。ワイルドカード証明書の `*.` 接頭辞は照合前に剥がされる。

`already-seen.log` が効く理由は、CTの構造に根ざしている。前述のとおり**同じホスト名がプレ証明書と本証明書で2回流れてくる**うえ、CAは複数のログへ同じ証明書を提出する（Chromeのポリシーが複数ログへの掲載を要求するため）。さらに証明書更新（Let's Encryptなら従来60日ごと）でも同じ名前が再出現する。重複排除層がなければ、通知は実質的に無意味なノイズになる。

#### 3.3 部分一致（substring match）の危険性 — ここが最重要の落とし穴

CertEagleのREADMEは自ら正直に注記している。`.facebook.com` というルールは `test.facebook.company` のような名前にも一致しうる、と。

これは**ドメイン名の照合をラベル境界ではなく単なる部分文字列で行っている**ことに起因する、CT監視ツール全般の古典的バグである。攻撃者視点で言えば、`login-example.com.attacker.tld` のようなフィッシング用名称は `example.com` を部分文字列として含むため「自社資産」と誤検知され、逆に `example.com.evil.tld` を見落とす設定にもなりうる。防御運用では、**「自社資産の新規出現」と「自社ブランドを騙る第三者ドメイン」は別アラートに分けるべき**であり、そのためには照合を厳密化する必要がある。

安全な照合の考え方をコードで示す。

```python
import re

def make_suffix_matcher(apex: str):
    """apex ドメイン自身、または '.' 区切りのサブドメインだけに一致する照合器を返す。
       ラベル境界を明示するので 'example.com.evil.tld' や
       'notexample.com' には一致しない。"""
    esc = re.escape(apex.lower().strip('.'))
    # 先頭は行頭か「ラベル+ドット」、末尾は行末で固定する
    return re.compile(r'^(?:[a-z0-9_\-\*]+\.)*' + esc + r'$')

def normalize(name: str) -> str:
    name = name.strip().lower().rstrip('.')      # 末尾ルートドットを除去
    if name.startswith('*.'):
        name = name[2:]                          # ワイルドカードは apex 相当として扱う
    return name

OWNED = make_suffix_matcher('example.com')       # 自社資産
BRAND = re.compile(r'(?<![a-z0-9])example(?![a-z0-9])')   # ブランド語の混入（別系統のアラート）

def classify(domain: str):
    d = normalize(domain)
    if OWNED.match(d):
        return 'owned-asset'        # 資産インベントリと突合すべき対象
    if BRAND.search(d):
        return 'brand-lookalike'    # 便乗ドメインの疑い。別チャンネルへ
    return None
```

- `^...$` でアンカーすることが本質である。アンカーのない部分一致は、**接尾も接頭も自由**になってしまい、両方向に誤る。
- `rstrip('.')` は、DNSの完全修飾名が末尾ドットを持ちうるための正規化。
- `*.` の除去は、ワイルドカード証明書を「そのapexの資産」として扱うための割り切り。
- ブランド類似判定を別系統にするのは、**アラートの意味が違う**から（前者は資産管理、後者はブランド保護・フィッシング対応）。

#### 3.4 時事性の注意（2021年の記事を2026年に読むために）

- **公開certstreamサーバの可用性**: `certstream.calidog.io` の公開エンドポイントは、記事執筆当時（2021年）から現在までの間に、断続的な停止や大幅な遅延が報告されてきた。常時監視を業務で回すなら、**`certstream-server-go` 等で自前ホストする**、あるいはCTログAPI（`get-sth` / `get-entries`）を直接ポーリングする自作コンシューマへ切り替えるのが安全である。単一の無料公開サービスに検知パイプラインを依存させないこと。
- **Static CT API（tile方式）への移行**: 2024〜2025年にかけて、RFC 6962の従来型ログに加えて「Static CT API」（Sunlight / Tessera 等の実装による、静的ファイル配信ベースのログ）が実運用に入り始めた。従来の `get-entries` を前提としたコンシューマは、これらのログに対しては**タイル取得方式への対応が別途必要**になる。自作する場合は、監視対象ログの一覧（Chromeのlog list JSON）と、各ログがどちらのAPIかを確認すること。
- **証明書有効期間の短縮**: CA/Browser Forumで2025年に可決された方針により、公的証明書の最大有効期間は段階的に短縮されていく（200日→100日→47日）。これは**更新頻度の増加＝CTストリームのノイズ増加**を意味する。重複排除と「初出のみ通知」の設計は、今後さらに重要になる。

> 出典: Weaponizing Live CT logs for automated monitoring of assets — https://medium.com/@Asm0d3us/weaponizing-live-ct-logs-for-automated-monitoring-of-assets-39c6973177c7 （本文は403で取得できず、記述は著者公式リポジトリ https://github.com/devanshbatham/CertEagle の README / `certeagle.py` に基づく）

---

### 4. 資料3: CT Logs for OSINT — パケットを1つも送らずに地図化する

3つ目の資料は、CTを「ツール」ではなく「情報源」として扱い、どこまでパッシブに組織のインフラ像を描けるかを整理している。冒頭の主張が本節の要約になっている——「*Every TLS certificate issued by a public CA gets recorded in Certificate Transparency logs before it ever reaches a server*（公的CAが発行するすべてのTLS証明書は、サーバに届く前にCTログへ記録される）」。

#### 4.1 基本の一行

```bash
curl -s 'https://crt.sh/?q=%.target.com&output=json' | jq -r '.[].name_value' | sort -u
```

`%.target.com` の `%` はSQLのワイルドカード（crt.shはこれをLIKEパターンとして解釈する）。`name_value` にはSANの各エントリが入るが、**マルチドメイン証明書では1エントリに100を超えるホスト名が改行区切りで入ることがある**。したがって実務では改行分割を挟むべきである。

```bash
curl -s 'https://crt.sh/?q=%.example.com&output=json' \
  | jq -r '.[].name_value' \
  | tr 'A-Z' 'a-z' | sed 's/^\*\.//' \
  | grep -E '(^|\.)example\.com$' \
  | sort -u
```

`jq -r`（raw出力）は文字列中の `\n` を実際の改行として書き出すため、1つの `name_value` に複数ホスト名が詰まっていても自動的に1行1名へ展開される。そのうえで追加した処理の意味は、順に「小文字化」「ワイルドカード接頭辞 `*.` の除去」「**ラベル境界でアンカーした厳密フィルタ**」である。最後のgrepが3.3で述べた誤検知対策にあたり、`(^|\.)example\.com$` は `example.com` 自身と `*.example.com` のみに一致し、`example.com.evil.tld` や `notexample.com` を弾く。

#### 4.2 発行者（issuer）の変遷を見る

```bash
curl 'https://crt.sh/?q=company.com&output=json' | jq '[.[] | {date: .entry_timestamp, issuer: .issuer_name}] | unique_by(.issuer)'
```

原典はこれを「組織的な変化のシグナル」と位置づける。集中管理されたCAから Let's Encrypt のような自動化前提の発行者へ移ったタイミングは、**自動化やコスト削減の導入時期**を示す一方、防御側にとっては「証明書発行がチーム単位に分散し、中央のレビューを通らなくなった時期」を示すこともある。`entry_timestamp` はCTログへの登録時刻であって証明書の `not_before` とは別物である点に注意。

#### 4.3 リアルタイム側と、その後段のパイプライン

原典はcertstreamを「Chrome/Apple信頼ソースのCTログを集約し、月間およそ250TBを処理する」ストリームと説明し、3.1と同型のPythonコールバック例を挙げたうえで、戦術的な意味をこう述べる——「*Any new certificate for \*.target.com triggers an alert before DNS propagates*（新しい証明書は、DNSが伝播する前にアラートを発火させる）」。

そのうえで、4段階のパイプラインが示される。**重要なのは、1と2はパケットを一切送らないが、3と4は送るという区別である。**

```bash
# [1][2] CT取得 → 既知資産との差分（anew は「新規行だけを出力しつつファイルへ追記」するツール）
curl -s 'https://crt.sh/?q=%.target.com&output=json' | \
  jq -r '.[].name_value' | \
  sort -u | \
  anew subs.txt

# [3] DNS解決（ここから能動的。自組織／許諾済み資産に限る）
dnsx -l subs.txt -o resolved.txt

# [4] HTTP応答のフィンガープリント（同上）
httpx -l resolved.txt -status-code -title -tech-detect
```

`anew` が差分検出の役割を担う（Sublertの `difflib` に相当するが、順序非依存で追記も同時に行うため堅牢）。この「CT → 差分 → 解決 → プローブ」という形は、継続的Reconの標準形として覚えてよい。

#### 4.4 証明書メタデータから読めるもの

原典が挙げる指標は、防御側の自己点検リストとしてそのまま使える。

- **発行の集中（バースト）**: ある時期に `*.internal.company.com` 系が一気に増えていれば、インフラ拡張や移行の痕跡。
- **SANの接頭辞**: `api-dev-`、`stage-`、`uat-` といった命名は、**環境の分類体系そのものを外部へ公開している**ことになる。
- **発行者の変化**: チームの自律性の高まりと、セキュリティレビューの空白を同時に示唆する。
- **過去の名前が消えない**: すでにDNSから消えたホスト名もログには残る。放置された「忘れられたシステム」が、既定認証情報のまま生きている可能性を示す。

そして本節にとって決定的な数値が引かれている——**CT経由で発見されるサブドメインのおよそ1/3は、通常のDNSクエリや一般的なクロールでは見えない**。逆に言えば、DNSとクロールだけで資産管理をしている組織は、自社資産の約3分の1を見落としうる。

さらに応用として、CTの結果を API ゲートウェイの宣言済みエンドポイント一覧と突き合わせ、**証明書のSANには存在するがゲートウェイ設定に無い＝シャドーAPI候補**を洗い出す手法、そして発見したホストのIPブロックについて RIPEstat（`stat.ripe.net`）で RPKI の ROA（Route Origin Authorization、経路広告の正当性を示す署名済み宣言）の有無を確認し、**ROAが無いブロック＝正式なレビュー外のレガシーインフラ**を推定する相関手法が紹介されている。

最後の一文が、防御側にとっての本質である——「*The organization that never queried does not know what it exposed*（一度も問い合わせたことのない組織は、自分が何を露出させたかを知らない）」。CTは公開かつ不可逆であり、この非対称性は構造的なものだ。

> 出典: CT Logs for OSINT: Map Subdomains and Infrastructure Without Sending a Single Packet — https://dev.to/roxdavirox/ct-logs-for-osint-map-subdomains-and-infrastructure-without-sending-a-single-packet-2eif

---

### 5. 3方式の比較と使い分け

| 観点 | ポーリング型（Sublert / crt.sh + cron） | ストリーム型（CertEagle / certstream） | 併用（推奨） |
|---|---|---|---|
| 検知遅延 | crt.shの取込ラグ + cron間隔（数十分〜24時間） | 数秒〜数分 | ストリームで即時、ポーリングで取りこぼし回収 |
| 取りこぼし | 少ない（インデックス済み全量を毎回再取得） | 接続断の間は欠落する | 相互補完 |
| 運用コスト | cronのみ。停止に強い | 常駐プロセス。再接続・監視が必要 | — |
| 依存先 | crt.sh（単一障害点） | certstream公開サーバ（単一障害点） | 依存先が分散する |
| 過去分の調査 | 可能（履歴全体を検索） | 不可（接続以降のみ） | ポーリング側が担う |

実務的な結論は明快で、**ストリーム型を一次検知、ポーリング型を日次の整合チェック（reconciliation）として併用する**。ストリームは速いが欠落し、ポーリングは遅いが網羅的だからである。

### 6. 防御側の運用設計

CT監視を「面白い発見器」から「資産管理プロセス」へ変えるには、検知の後段が要る。

1. **資産インベントリとの突合を必須にする**: CTで出た名前は、CMDB/資産台帳に存在するか否かで2分される。存在しないものは**シャドーIT／未登録資産**として、通知ではなくチケットを起票する。CT監視の価値は「知ること」ではなく「台帳に載せること」にある。
2. **アラートを3系統に分ける**: (a) 自社apex配下の新規ホスト（資産管理）、(b) ブランド類似の第三者ドメイン（フィッシング対応）、(c) **自社ドメインに対する想定外のCAからの発行**（不正発行・誤発行の検知）。(c) はCTの本来の設計目的そのものであり、CAAレコード（`example.com. CAA 0 issue "letsencrypt.org"` のように発行を許可するCAを宣言するDNSレコード）と組み合わせると、「CAAで許可していないCAが発行した」という強いシグナルになる。
3. **通知は初出のみ、保管は全件**: `already-seen.log` 相当の重複排除は通知層に置き、生データは全件保存しておく。後から「いつから存在したか」を遡及調査するために必要になる。
4. **監視自体の死活監視**: certstreamの切断やcrt.shの障害を、エラー専用チャンネルへ出す（Sublertの `-l` の発想）。通知が来ないことが「異常がない」なのか「監視が死んでいる」なのかを区別できない運用は、監視していないのと同じである。
5. **露出を減らす側の対策**: 内部用ホストの命名に環境や技術スタックを書かない（`uat-payments-oracle.` のような名前は設計図を配っているに等しい）、内部専用資産はプライベートCAまたはワイルドカード証明書でホスト名の列挙を避ける、退役時はDNSレコードと委譲先を同時に片付けてダングリングCNAMEを残さない。**CTから消すことはできない以上、「載せる名前を選ぶ」ことが唯一の設計変数である**。

### 7. まとめ

- CTはブラウザのポリシーによって事実上**強制された公開台帳**であり、Merkle木ゆえに**消去も改竄もできない**。その結果、証明書発行はDNS公開やサービス開始に**先行して**資産の存在を外部へ知らせる。
- ポーリング型（Sublert）は、crt.shへのサフィックス検索（`reverse(lower())` によるインデックス活用が要）＋差分＋Slack通知という最小構成で、日次の資産棚卸しに向く。
- ストリーム型（CertEagle/certstream）は、WebSocketで流れるCTエントリを照合して数秒〜数分で検知する。ただし**部分一致による誤検知**と**重複（プレ証明書・複数ログ・更新）**の処理を誤ると、実用にならない。ラベル境界でアンカーした照合と初出のみ通知が必須である。
- CT由来のサブドメインの約1/3はDNSやクロールから見えない。したがってCT監視は「あると便利」ではなく、**資産インベントリの完全性を担保するための必須入力**である。
- 検知はゴールではない。台帳への登録、シャドーIT判定、CAAと突き合わせた不正発行検知、そして監視自身の死活監視までを含めて、はじめて継続的Reconのループが閉じる。

## 差分通知と継続監視の運用設計

Reconは一度実行して終わりの作業ではない。攻撃対象領域（attack surface、組織が公開しているドメイン・サブドメイン・IP・サービスの集合）は日々変化する。新しいサブドメインが立ち上がり、証明書が発行され、JSファイルが更新され、ポートが開く。これらの「差分（前回との変化点）」を検知し、必要な人に必要なタイミングで届ける仕組みがなければ、Reconは静止した一枚のスナップショットに終わってしまう。

本節では、継続監視（Continuous Recon）の中核である「証明書発行イベントの監視」と「差分検知→通知」の運用設計を、実在するツール2種と運用ガイド1本を通じて解説する。あくまで防御目的（自組織の資産監視、誤発行の早期検知、シャドーIT発見）の文脈として扱う。実在サービスへの無許可な検証や、監視対象システムへの侵入的操作は本節の範囲外である。

### 1. なぜ Certificate Transparency（CT）が継続監視の起点になるのか

CT（Certificate Transparency）は、認証局（CA）が発行したTLS証明書をすべて公開の追記専用ログ（append-only log、後から削除・改変できないログ）に記録する仕組みである。2021年以降、主要ブラウザ（Chrome/Safari）はCTログに記録されていない証明書を信頼しないため、実質的に「公開の証明書はすべてCTログに載る」という状態が定着した。この特性により、CTログを監視すれば「対象組織向けにいつどんなドメイン名の証明書が発行されたか」をほぼリアルタイムに知ることができる。これは、DNS的な観測（zone walkingやパッシブDNS）では拾えない、まだ公開されていない・DNSが引かれていない新規サブドメインの「予告」を掴める点で、Reconにおいて特別な価値を持つ。

CTログの実体は複数のログサーバー（Google、Cloudflare、Sectigoなど各社が運営）に分散しており、それぞれがMerkle tree（追記のたびにハッシュ木を再計算し、過去のエントリを改変不可能にするデータ構造）で証明書エントリを管理している。証明書には多くの場合SAN（Subject Alternative Name）フィールドに複数のホスト名が列記されるため、1件の証明書発行から複数のサブドメインが一度に露出することもある。

継続監視の実務では、このCTログを「生ログとして自前でパースする」のではなく、既に集約・配信してくれるサービスやAPIを経由するのが定石である。次節で扱う2つのツールは、まさにこの「集約レイヤー」の使い方が異なる2つの方式（push型のストリーミングと、pull型のポーリング）を示している。

### 2. certstream-slack ── push型（WebSocketストリーミング）モデル

`certstream-slack`（Go言語実装、Apache-2.0ライセンス）は、CTログの変化を待ち受けてSlackに通知するデーモンである。

> ⚠️ **未取得の資料の可能性についての補足**: WebFetchで取得したREADME要約では、実行コマンド例に `go install -v github.com/heptiolabs/certstream-slack` という記述が見えたが、指定URLは `github.com/mattmoyer/certstream-slack` であり、リポジトリ間でフォーク・改名の経緯があると考えられる。以下は取得できた技術的仕組みの説明であり、正確な最新のインストールパスはリンク先で直接確認することを推奨する: https://github.com/mattmoyer/certstream-slack

**仕組み**: このツール自体はCTログサーバーと直接通信しない。代わりに、CTログを集約して1本のリアルタイムフィード（WebSocket経由のJSONストリーム）として配信する外部サービス（Cali Dog Securityが提供するcertstreamアグリゲータ）に接続し、そこから流れてくる証明書発行イベントを1件ずつ受信する。これは「push型」のアーキテクチャで、サーバー側がイベント発生ごとにクライアントへデータを送り込む。クライアント（certstream-slack）はコネクションを張って待つだけで、能動的にポーリング（一定間隔での問い合わせ）をする必要がない。

**フィルタリング**: 受信した証明書のドメイン名に対して、Go言語の正規表現（`regexp`パッケージ）でマッチングを行い、`DOMAIN_PATTERN` にマッチしたものだけを通知対象とする。

```
SLACK_WEBHOOK_URL='https://hooks.slack.com/services/XXX/YYY/ZZZ' \
DOMAIN_PATTERN='(mycompany)|(myproduct1)|(myproduct2)' \
certstream-slack
```

なぜ正規表現によるOR結合（`|`）で複数パターンを1つの環境変数にまとめる設計になっているのか。これは、CTストリームが「全世界の全証明書発行」という極めて高頻度・高ボリュームのイベント列であるため、クライアント側でできるだけ早い段階（受信直後）に絞り込みをかけないと、無関係な通知でSlackチャネルが埋まってしまう（アラート疲れ、alert fatigue）ためである。正規表現1本で複数の監視対象文字列を表現できるようにすることで、環境変数1個・プロセス1個のシンプルな構成を保ちながら、複数ブランド・複数プロダクト名を横断的に監視できる。

**通知**: マッチした証明書情報はSlackの Incoming Webhook（Slack側で発行される、認証情報を含んだPOST先URL。このURLにJSONをPOSTするだけでそのWebhookに紐づくチャネルに投稿できる）に対して1件ずつPOSTされる。Webhook URL自体がSlack上のチャネル・投稿者名の紐付けを内包しているため、アプリケーション側で「どのチャネルに」というルーティングロジックを持つ必要がない。

> 出典: certstream-slack — https://github.com/mattmoyer/certstream-slack

### 3. Certificate-Transparency-to-Slack ── pull型（APIポーリング）モデル

`Certificate-Transparency-to-Slack`（Python実装、GPL-3.0ライセンス、AWS Lambdaでの実行を想定）は、同じ「CT監視→Slack通知」という目的を、push型ではなくpull型（クライアントが能動的に定期問い合わせを行う方式）で実現している。

**仕組み**: このツールは Cert Spotter（SSLMate社が提供するCT監視API。無料プランでは1時間あたり100クエリまで）というAPIサービスに対して、監視対象ドメインごとに「最新の証明書ID」を問い合わせる。処理フローは次の通り。

1. 監視対象ドメインが初回実行かどうかを、ローカルディスクまたはS3バケットに保存された「マーカーファイル（そのドメインについて最後に確認した証明書IDを記録したファイル）」の有無で判定する。
2. 初回であれば、Cert Spotter APIから現在の最新証明書IDを取得し、それをマーカーファイルに保存するだけで終える（過去分をすべて通知すると初回だけ大量の通知が発生してしまうため）。
3. 既知ドメインであれば、保存済みIDと最新の問い合わせ結果を比較し、差分（新規に発行された証明書）があればそれをSlackに通知し、マーカーファイルを更新する。

なぜ「マーカーファイルによる状態管理」が必須なのか。CT監視は本質的に「無限に続くログに対して、前回どこまで見たかを記憶し続ける」ジョブである。状態を持たなければ、実行するたびに「最初から全部」を通知してしまい重複通知の嵐になるか、逆に前回の実行との継続性が切れて新規発行を取り逃す。この「状態をどこに永続化するか」という設計判断（ローカルディスク vs. S3）は、実行環境の選択（常駐プロセス vs. サーバーレス関数）と密接に結びついている。AWS Lambdaのようなサーバーレス実行環境は実行ごとにファイルシステムが揮発する（実行完了後にローカルディスクの内容は保証されない）ため、S3のような外部の永続ストレージに状態を退避する設計が必要になる。

**設定項目**（環境変数）は次のように整理されている。

| 変数 | 役割 |
|---|---|
| `SLACK_WEBHOOK` | 通知先Webhook URL |
| `MONITOR_DOMAINS` | カンマ区切りの監視対象ドメインリスト |
| `CERTSPOTTER_API_TOKEN` | Cert Spotter APIの認証トークン |
| `FILESYSTEM_PATH` | 状態（マーカーファイル）の保存先パス |
| `SLEEP_DELAY` | API呼び出し間隔（レート制限対策） |
| `LOG_FORMAT` | `json` または `syslog` |
| `DEBUG` | ログ詳細度の切り替え |

`SLEEP_DELAY` の存在は、Cert Spotterの無料枠が「1時間100クエリ」という明確な上限を持つことと対応している。監視対象ドメイン数が増えるほど1回の巡回で消費するクエリ数が増えるため、ドメインごとの問い合わせ間に一定の遅延を挟むことでレート制限超過（HTTPステータス429など）を避ける設計になっている。これはpull型監視に共通する制約で、push型（certstream-slack）にはこの種のクエリ回数上限は存在しない代わりに、フィルタなしでは受信データ量そのものが膨大になるというトレードオフがある。

> 出典: Certificate-Transparency-to-Slack — https://github.com/emtunc/Certificate-Transparency-to-Slack

### 4. push型 vs. pull型 ── どちらを選ぶべきか

両ツールを対比すると、継続監視システムを設計する際の基本的な意思決定軸が見えてくる。

| 観点 | push型（certstream-slack） | pull型（Cert Spotter経由） |
|---|---|---|
| データ源 | 全世界のCTログのリアルタイム集約ストリーム | ドメイン単位のAPIクエリ |
| 検知速度 | 証明書発行から数秒〜数十秒程度（ストリームが継続していれば） | ポーリング間隔に依存（例: 1時間ごとなら最大1時間の遅延） |
| インフラ要件 | 常時接続を維持するプロセス（Lambdaのような短命実行には不向き） | 短命の実行でも成立する（cronやLambdaの定期実行と相性が良い） |
| スケール制約 | 受信量そのものは無限だが、正規表現フィルタで絞る必要 | APIのクエリ数上限（レート制限）が明確な天井になる |
| 障害時の挙動 | 接続断中のイベントを取り逃す可能性（再接続時の巻き戻し機能次第） | 次回ポーリング時に前回との差分として自然に回収できる |

この比較から言えるのは、「検知速度を最優先するなら常時接続のストリーミング型、運用の単純さ・サーバーレスとの親和性を優先するならポーリング型」という単純な二択ではなく、多くの実運用では両方を組み合わせる、または後述する「汎用的な差分パイプライン」に両方を統合するという発想が有効だという点である。ポーリング型は取り逃しに強い（次回に必ず差分として現れる）一方、ストリーム断絶時の再接続処理を持たないpush型は、監視の「取り逃しがないことの保証」という点で弱い場合がある。防御目的の運用では、この「取り逃しへの耐性」を評価軸に加えて設計することが重要である。

### 5. 汎用的な差分検知パイプライン ── CTに限らない設計原則

Comprehensive Recon Guideは、CT監視を含むより広い「継続的Recon」の運用思想を提示している。ここでの核心は、**「累積結果」ではなく「増分（差分）だけを処理対象にする」**という設計原則である。

監視対象として挙げられている信号は以下の4種で、いずれも「変化そのもの」が攻撃者・防御者双方にとって重要な意味を持つ。

| 信号 | 変化が意味すること |
|---|---|
| 新規サブドメイン | 新しいデプロイやサービスが公開された可能性。設定ミスや未認可の資産である可能性もある |
| 既知ホストの新規ポート開放 | 新しいサービスが稠働開始した可能性。意図しない公開であれば早期対処が必要 |
| JSファイル/バンドルのハッシュ変更 | フロントエンドのコードが更新された。新しいAPIエンドポイントやパラメータが露出する可能性 |
| Nucleiでの新規検出 | 既知の脆弱性テンプレートに合致する状態が新たに現れた |

差分検知の最も基本的な実装は、Unix標準コマンドの `comm` を使った集合演算である。

```bash
# 前日のサブドメイン一覧と本日の一覧を比較し、
# 「本日にのみ存在する行（新規のみ）」を抽出する
comm -13 前日のサブドメイン.txt 本日のサブドメイン.txt > 新規.txt
```

`comm` はソート済みの2つのファイルを行単位で比較する三列出力コマンドで、`-1`は「1列目（ファイル1のみに存在する行）を非表示」、`-3`は「両方に存在する行（3列目）を非表示」を意味する。`-13` を組み合わせることで、結果として「ファイル2（本日）にのみ存在する行」だけが残る。これは、フルスキャンの結果を毎回全件通知するのではなく、**前回状態とのdiff**だけを人間に見せるという発想であり、certstream-slackの正規表現フィルタや、Cert Spotter版のマーカーファイル比較と、原理的に同じ目的（無関係・既知の情報でアラートを埋めない）を果たしている。

より実務的なパイプラインでは `comm` の代わりに `anew`（ProjectDiscovery系のツールで、入力行のうち「これまでに見たことのない行」だけを標準出力に流し、既知の行は記録済みファイルに追記して次回以降は出力しない、履歴管理付きのフィルタ）を使うことが多い。`anew` は内部的に「既知集合ファイル」を1つ持ち続けるため、`comm` のように「前日ファイル」を明示的に用意し続ける手間を減らせる。

```bash
# subfinderで再列挙し、anewで「新規のみ」を抽出し、
# 新規があればSlackへ通知する疑似コード
TODAY_SUBS=$(subfinder -d example.com -silent)
NEW_SUBS=$(echo "$TODAY_SUBS" | anew known_subs.txt)

if [ -n "$NEW_SUBS" ]; then
  curl -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"新規subs for example.com:\n${NEW_SUBS}\"}" \
    "$SLACK_WEBHOOK_URL"
fi
```

ここで重要な仕組みレベルの理由は、`anew` が「今回の入力を毎回全件標準出力する」のではなく「差分のみ返す」ことで、後続処理（この場合はSlack通知）の条件分岐が単純になる、という点である。`NEW_SUBS` が空文字であれば通知を送らない、という1行のif文だけで「変化がない日は静かなままにする」を実現できる。これがなければ、通知ロジック側で毎回「今回の結果と前回の結果を比較する」処理を自前で書く必要があり、複雑化とバグの温床になる。

**通知のルーティング**については、`notify`（ProジェクトDiscovery製で、Slack・Discord・カスタムWebhookなど複数の出力先に同じイベントを配信できるツール）のような、通知先を抽象化するレイヤーを挟むことが推奨されている。これにより、「検知ロジック」と「どこに知らせるか」を分離でき、後からPagerDutyやTeamsなど別の通知先を追加する際にパイプラインの検知部分を変更する必要がなくなる。

**監視頻度**は対象の性質に応じて調整すべきだとガイドは述べている。バグバウンティで活発に開発が進んでいるプログラムであれば時間単位、変化の少ない対象であれば日単位というように、頻度と検知コストのバランスを取る。実装上は `cron`（Linux/Unix系のジョブスケジューラ）や GitHub Actions のスケジュールトリガー（`schedule:` イベント、cron式で指定）でこのループ全体を定期実行する形が一般的である。

```yaml
# GitHub Actionsでの定期実行例（概念的な骨格）
on:
  schedule:
    - cron: '0 * * * *'   # 1時間ごと
jobs:
  recon-diff:
    runs-on: ubuntu-latest
    steps:
      - run: subfinder -d example.com -silent | anew known_subs.txt > new.txt
      - run: |
          if [ -s new.txt ]; then
            curl -X POST -H 'Content-type: application/json' \
              --data "{\"text\":\"$(cat new.txt)\"}" "${{ secrets.SLACK_WEBHOOK_URL }}"
          fi
```

なぜ `known_subs.txt` のような状態ファイルをリポジトリ内やアクション間で永続化する工夫（例: actions/cacheやリポジトリへのコミット）が必要になるのか。GitHub Actionsのジョブは実行ごとに使い捨ての仮想マシンで動くため、Lambdaと同様に「前回の状態」をジョブの外部（キャッシュ、アーティファクト、あるいはS3のような外部ストレージ）に明示的に保存しなければ、`anew` の「既知集合」が毎回リセットされてしまい、実行するたびに全件が「新規」として通知される。これはCert Spotter版がS3にマーカーファイルを置いていたのと同じ課題であり、「短命な実行環境で継続的な差分検知を行う」ための一般解が「外部への状態永続化」であることを示している。

**ツールチェーンの全体像**として、ガイドは `subfinder`（サブドメイン再列挙）、`certstream`（本節で見たCTのリアルタイムフィード）、`axiom`（クラウド上に一時的なワーカー群を立てて並列実行する基盤）、`interlace`（複数対象・複数ツールをCLIレベルで並列実行するラッパー）を組み合わせた構成を挙げている。監視対象が数百〜数千ドメインに及ぶ場合、単一マシンでの逐次実行では1サイクルの完了に監視間隔より長い時間がかかってしまうことがあり、`axiom`のような分散実行基盤で並列化することが実務上の要件になる。

> 出典: Comprehensive Recon Guide — https://chs.us/guides/recon/

### 6. 運用設計上の共通の注意点（防御目的の観点から）

以上3件の資料を通じて共通する、継続監視システムの設計原則を整理する。

- **状態の永続化と冪等性**: マーカーファイル・既知集合ファイルなど「前回の状態」をどこに置くかが、通知の正確さ（重複なし・取り逃しなし）を左右する。実行環境が揮発性（サーバーレス、CI/CDジョブ）であるほど、外部ストレージへの明示的な保存が必須になる。
- **レート制限への配慮**: 外部APIやサービス（Cert Spotter、DNSリゾルバなど)には利用上限がある。`SLEEP_DELAY` のような調整パラメータを用意し、監視対象数の増加に応じてスケールするようにする。
- **アラート疲れの防止**: フィルタ（正規表現、差分抽出）を通知ロジックの手前にできるだけ早く配置し、「本当に意味のある変化」だけを人に届ける。無関係な通知が増えるほど、重要な通知が見逃されるリスクが上がる。
- **Webhook URLやAPIトークンの秘匿**: Slack Incoming Webhook URLやCert Spotterのトークンはそれ自体が認証情報であり、露出すれば第三者が任意の内容を該当チャネルに投稿できてしまう。GitHub Actionsの `secrets` や、Lambdaの環境変数暗号化のような仕組みで管理し、リポジトリやログに平文で残さないようにする。
- **対象範囲の明確化**: 本節で扱った仕組みはいずれも「自組織が管理するドメイン・資産」を対象とすることを前提とする。監視対象のスコープ定義（どのドメイン・サブドメインを監視するか）を明文化し、無関係な第三者のドメインを不必要に監視対象へ含めないことが、防御目的の運用として重要である。

これらの原則を踏まえると、「証明書発行イベントの監視」も「サブドメイン一覧の差分監視」も、本質的には同じ1つのパターン、すなわち「状態を保存する → 新しい観測結果と比較する → 差分だけを抜き出す → フィルタする → 通知する」という5段のパイプラインのバリエーションであることが分かる。ツールを選ぶ際は、この5段のうちどこを自動化・省力化してくれるツールなのかを意識すると、複数ツールを組み合わせた際の役割分担が明確になる。

---

[← 第9章 Reconの自動化・パイプライン化・スケーリング](09-automation-pipeline.md) ｜ [📖 目次](index.md) ｜ [第11章 発展・方法論・実例 →](11-methodology-cases.md)
