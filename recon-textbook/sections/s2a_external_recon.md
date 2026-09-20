## External Recon Methodologyの全体像

### この節の位置づけ

「資産発見（asset discovery）」は、Reconの中で最も *差がつく* 工程である。理由は単純で、後続のすべての工程——サブドメイン列挙、コンテンツ探索、脆弱性検証——は、**入力として与えられた資産リストの上でしか動かない**からだ。入口の集合が他人と同じなら、いくら深掘りしても見つかるものは他人と同じになる。逆に言えば、「その組織が所有しているのに、誰も攻撃面として数えていないホスト」を1つ見つけた時点で、競合のいない領域に立てる。

この節では、HackTricksの「External Recon Methodology」を骨格として、外部から見える組織全体をマッピングする方法論を、**なぜその手法が成立するのか（プロトコル・レジストリ・ログの仕組み）**まで掘り下げて整理する。個別ツールの使い方は後続の節に譲り、ここでは「全体像と各手法の原理」に集中する。

> ⚠️ **スコープに関する前提（本書共通）**：本節は防御・自組織の攻撃面把握・許可されたプログラム範囲内での調査を目的とする。以降に示すコマンドは**手法の説明のための例示**であり、権限のない実在サービスに対して実行してはならない。原典（HackTricks）は実例として実在企業のドメインを使っているが、本節ではターゲット名を `example.com` 等のプレースホルダに置き換えて引用する（コマンドの構造・フラグは原典のまま）。また、ドメイン乗っ取り（takeover）等の「実際に取得してしまう」操作は、許可範囲内かつ報告目的でのみ行うこと。

---

### 1. 骨格：資産発見は4ステップのループである

HackTricksは、「ある企業に属するものはすべてスコープ内」と言われたときに何をするか、という問いから始まり、次の4段階を定義している。

> 1. Find the acquisitions of the main company, this will give us the companies inside the scope.
> 2. Find the ASN (if any) of each company, this will give us the IP ranges owned by each company
> 3. Use reverse whois lookups to search for other entries (organisation names, domains...) related to the first one (this can be done recursively)
> 4. Use other techniques like shodan `org` and `ssl` filters to search for other assets (the `ssl` trick can be done recursively).

ここで決定的に重要なのは、3と4に付いている **「recursively（再帰的に）」** という語である。資産発見は「1回通して終わり」の手順ではなく、**不動点（fixed point）に達するまで回すループ**だ。新しいドメインが1つ出たら、そのドメインのWHOIS・証明書・faviconを再びピボット（軸）にして、また新しい資産を探す。HackTricksが "Repeat the applicable discovery pivots whenever you find a new domain" と繰り返し書いているのはこのためである。

用語を先に整理しておく。

- **horizontal enumeration（水平列挙）**：同じ組織が持つ *別の* ルートドメイン・別会社を広げる方向。買収調査・reverse WHOIS・favicon相関・トラッカー相関がここに属する。
- **vertical enumeration（垂直列挙）**：1つのルートドメインの *下* を掘る方向。サブドメイン列挙・VHost探索がここに属する。
- **seed（シード）**：ループの初期入力になる既知資産（ルートドメイン、企業名、既知IPなど）。
- **pivot（ピボット）**：ある資産から別の資産へ飛ぶための共通識別子。ASN、WHOISのメールアドレス、Google Analytics ID、favicon hash、TLS証明書のOrganisation名などが該当する。

資産発見とは要するに、**「同一組織であることを示す識別子を見つけ、その識別子で横断検索できるデータベースを叩く」**作業の反復である。以降の各手法は、この「識別子×データベース」の組み合わせのカタログだと思って読むとよい。

---

### 2. ステップ1：企業体そのものを列挙する（Acquisitions）

最初にやるのはツールの実行ではなく、**法人の系図を描くこと**である。バグバウンティのスコープに「company X and its subsidiaries」と書いてあるなら、子会社・被買収企業のドメインは全部スコープ内だが、その一覧はプログラムページには書かれていないことが多い。

HackTricksが挙げる情報源は以下の通り。

- **Crunchbase**（[https://www.crunchbase.com/](https://www.crunchbase.com/)）で企業を検索し "acquisitions" タブを見る
- 対象企業の **Wikipedia** ページの買収セクション
- 上場企業なら **SEC/EDGAR のファイリング**、**IR（investor relations）ページ**、各国の法人登記（英国の **Companies House** など）
- グローバルな企業グループ構造には **OpenCorporates**（[https://opencorporates.com/](https://opencorporates.com/)）と **GLEIF LEIデータベース**（[https://www.gleif.org/](https://www.gleif.org/)）

**なぜ法人登記が効くのか**：SECの10-K（年次報告書）には "Subsidiaries of the Registrant"（Exhibit 21）という附属書類があり、連結対象子会社が法的名称と設立地つきで列挙される。これは*企業が法的義務として公開している一次情報*なので、Crunchbaseのような二次情報より網羅性・正確性が高い。GLEIFのLEI（Legal Entity Identifier）データは親子関係（direct/ultimate parent）を構造化データで持っており、機械的に系図を辿れる。

この段階のアウトプットは「企業名のリスト」であり、これが次のASN検索とreverse WHOISの**検索キー**になる。

---

### 3. ステップ2：ASNからIPレンジへ（vertical / ネットワーク層）

#### ASNとは何か

HackTricksの定義を引く。

> An autonomous system number (**ASN**) is a **unique number** assigned to an **autonomous system** (AS) by the **Internet Assigned Numbers Authority (IANA)**. An **AS** consists of **blocks** of **IP addresses** which have a distinctly defined policy for accessing external networks and are administered by a single organisation but may be made up of several operators.

仕組みレベルで補足すると、**AS（自律システム）はBGP（Border Gateway Protocol）における経路広告の単位**である。ある組織が自前のIPアドレス空間をインターネットに接続する場合、その組織はRIR（地域インターネットレジストリ）からASNとIPプレフィックスの割り当てを受け、BGPで「このプレフィックスはAS xxxxx 経由で到達できる」と広告する。つまり、

1. **RIRのWHOISデータベース**には「組織名 → ASN / IPプレフィックス」の対応が*公開情報として*登録されている
2. **グローバルBGPテーブル**（DFZ）には「ASN → 現在広告中のプレフィックス」がリアルタイムで載っている

という二重の公開台帳が存在する。bgp.he.net などはこのBGPテーブルとRIRデータを常時収集してインデックスしているため、企業名で検索すれば、その企業が自社運用しているIP空間が丸ごと出てくる。**DNS列挙では絶対に出てこない、名前のついていないホスト**に到達できるのがこの経路の価値である。

検索に使えるサービス（原典記載）：

- [https://bgp.he.net/](https://bgp.he.net/) — 会社名・IP・ドメインのいずれでも検索可能
- [https://bgpview.io/](https://bgpview.io/)、[https://ipinfo.io/](https://ipinfo.io/)
- 地域別RIR：[AFRINIC](https://www.afrinic.net)（アフリカ）/ [ARIN](https://www.arin.net/about/welcome/region/)（北米）/ [APNIC](https://www.apnic.net)（アジア）/ [LACNIC](https://www.lacnic.net)（中南米）/ [RIPE NCC](https://www.ripe.net)（欧州）
- [http://asnlookup.com/](http://asnlookup.com/)（無料APIあり）、[http://ipv4info.com/](http://ipv4info.com/)

自動化の例。原典はamassについて「あまり推奨しない」と明記している点に注意。

```bash
# You can try "automate" this with amass, but it's not very recommended
amass intel -org example
amass intel -asn 8911,50313,394161
```

**なぜ推奨されないのか**：`amass intel -org` はRIRのWHOISレコードの組織名フィールドを文字列マッチするだけなので、同名・類似名の無関係な組織を大量に拾い、逆に登記名が通称と異なる場合は取りこぼす。ASN列挙は「機械的に全自動化する」より、**bgp.he.netで目視確認しながらASN番号を確定し、確定したASNを `-asn` に渡す**という半手動の運用が精度が高い。

BBOTはスキャン終了時にASNを自動集計する。原典の出力例（重要な示唆を含むので引用する）：

```text
[INFO] bbot.modules.asn: | AS394161 | 8.244.131.0/24      | 5  | TESLA     | Tesla Motors, Inc.   | US |
[INFO] bbot.modules.asn: | AS16509  | 54.148.0.0/15       | 4  | AMAZON-02 | Amazon.com, Inc.     | US |
[INFO] bbot.modules.asn: | AS3356   | 8.32.0.0/12         | 1  | LEVEL3    | Level 3 Parent, LLC  | US |
```

この出力が教えてくれる**最重要の落とし穴**は、`AS16509 AMAZON-02` や `AS3356 LEVEL3` が混ざっていることだ。これらはAWSやトランジットプロバイダのASNであり、**そのプレフィックス全体は対象組織の所有物ではない**。ASNベースの列挙では「自社ASN（この例では AS394161 TESLA）のプレフィックスだけがスコープ」であり、クラウド/CDNのASNに乗っているIPは*そのIP単体*がスコープに入るだけである。ここを取り違えると、無関係な第三者のホストをスキャンすることになる——技術的な誤りであると同時に、法的・倫理的な事故そのものだ。HackTricksも別項で "sometimes the domain is hosted inside an IP that is not controlled by the client, so it's not in the scope, be careful." と警告している。

コマンド実行例（BBOT）：

```bash
bbot -t example.com -f subdomain-enum
```

---

### 4. ステップ3：ドメインの水平展開（horizontal correlation）

ここからが「識別子でピボットする」技術のカタログである。

#### 4.1 Reverse DNS（PTR）

IPレンジが分かったら、そのレンジに対して逆引きをかける。

```bash
dnsrecon -r <DNS Range> -n <IP_DNS>          # DNS reverse of all of the addresses
dnsrecon -r 203.0.113.0/24 -n 1.1.1.1        # Using cloudflares dns
dnsrecon -r 203.0.113.0/24 -n 8.8.8.8        # Using google dns
```

**原理と限界**：逆引きは `in-addr.arpa`（IPv6は `ip6.arpa`）ゾーンに登録されたPTRレコードを引く。このゾーンはIPブロックの割当先にRIR/ISPから委任されるため、**PTRは管理者が明示的に設定しない限り存在しない**（原典：*"For this to work, the administrator has to enable manually the PTR."*）。したがって網羅性は期待できないが、**存在する場合は社内の命名規約がそのまま露出する**（例：`prd-app-03.internal.example.com`）ため、後段のサブドメイン・ブルートフォース用ワードリストの質を劇的に上げる。歴史的PTRは [http://ptrarchive.com/](http://ptrarchive.com/) で参照でき、大規模レンジの逆引きには [massdns](https://github.com/blechschmidt/massdns) や [dnsx](https://github.com/projectdiscovery/dnsx) が使われる。

#### 4.2 Reverse WHOIS（ループ）

WHOISレコードには組織名・住所・メールアドレス・電話番号が入る。**reverse WHOIS** は、これらのフィールドを逆引き検索し「同じ登録者メールで登録された他のドメイン」を列挙する手法である。原典は "Note that you can use this technique to discover more domain names every time you find a new domain." と明記しており、これこそが前述の再帰ループの中核をなす。

原典が挙げるサービス（無料/有料の区別も原典のまま）：

| サービス | 料金 |
|---|---|
| [ip.thc.org](https://ip.thc.org/) | Free（Web and API） |
| [viewdns.info/reversewhois](https://viewdns.info/reversewhois/) | Free |
| [domaineye.com/reverse-whois](https://domaineye.com/reverse-whois) | Free |
| [reversewhois.io](https://www.reversewhois.io) | Free |
| [whoxy.com](https://www.whoxy.com) | Web無料、API有料 |
| [reversewhois.domaintools.com](http://reversewhois.domaintools.com) | 有料 |
| [drs.whoisxmlapi.com](https://drs.whoisxmlapi.com/reverse-whois-search) | 有料（無料100件） |
| [domainiq.com](https://www.domainiq.com) / [securitytrails.com](https://securitytrails.com/) / [whoisfreaks.com](https://whoisfreaks.com/) | 有料 |

自動化には [DomLink](https://github.com/vysecurity/DomLink)（whoxy APIキーが必要）や amass が使える。

```bash
amass intel -d example.com -whois
```

**時事性の注意（重要）**：2018年5月のGDPR施行以降、gTLDのWHOISは登録者の個人情報がほぼ全面的にredact（黒塗り）されるようになった。したがって、

- **現在のWHOIS**でピボットできるのは主に、法人が意図的に公開している `Registrant Organization` フィールドや、法人用の管理メール（`hostmaster@example.com` 等）に限られる。
- 一方 **ヒストリカルWHOIS**（2018年以前のスナップショット）は黒塗り前の情報を保持しているため、WhoisXML API や DomainTools のような履歴データベースのほうが遥かに実りが多い。「古いドメインほどヒットする」という非対称性を意識して使うこと。
- 国別ccTLD（.jp の JPRS WHOIS など）はポリシーが異なり、組織名が公開されているケースが今も多い。

#### 4.3 トラッカー相関

> If find the **same ID of the same tracker** in 2 different pages you can suppose that **both pages** are **managed by the same team**.

Google Analytics の測定ID（`UA-xxxxxxx-n` / `G-XXXXXXX`）や AdSense のpublisher IDは、**同一の管理アカウントが発行する一意な文字列**であり、HTMLソースに平文で埋め込まれる。したがって「このIDを含むページ」を全文検索インデックスに問い合わせれば、同じチームが運用する別サイトが芋づる式に出る。GA IDのサフィックス（`-1`, `-2` …）はプロパティ番号なので、同一アカウント配下の別プロパティを示唆する点も手がかりになる。

原典が挙げるサービス：[Udon](https://github.com/dhn/udon)、[BuiltWith](https://builtwith.com)、[Sitesleuth](https://www.sitesleuth.io)、[Publicwww](https://publicwww.com)、[SpyOnWeb](http://spyonweb.com)、[Webscout](https://github.com/straightblast/Sc0ut)、[StackScan](https://www.stackscan.com)。

StackScanについて原典は、トラッカーIDに限らず「配信されている任意のアセット」——スクリプトのパス、セルフホストしたバンドル名、アセットのロード元ホスト——でピボットできると説明しており、ドメイン単位の技術スタック確認APIの例を載せている。

```bash
curl -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $WORKSPACE" \
  "https://api.stackscan.com/v1/tech-lookup/domains/lookup?domain=example.com"
```

これは「候補として見つけた資産が本当に同じ企業体のものか」を裏取りする用途に向く。資産発見では**偽陽性の排除**が精度を決めるので、こうした確認手段を1つ持っておくこと自体が重要である。

#### 4.4 Favicon hash（mmh3）

同じfaviconを配信しているホストは、同じテンプレート／同じ組織である可能性が高い——という発想。[favihash.py](https://github.com/m4ll0k/Bug-Bounty-Toolz/blob/master/favihash.py)（@m4ll0k2作）の使い方を原典はこう示す。

```bash
cat my_targets.txt | xargs -I %% bash -c 'echo "http://%%/favicon.ico"' > targets.txt
python3 favihash.py -f https://target/favicon.ico -t targets.txt -s
```

既知のハッシュはそのままShodan/FOFAのピボットにできる。

```bash
shodan search org:"Target" http.favicon.hash:116323821 --fields ip_str,port --separator " " | awk '{print $1":"$2}'
# FOFA
icon_hash="116323821"
```

ハッシュの計算方法（原典のコード）：

```python
import mmh3
import requests
import codecs

def fav_hash(url):
    response = requests.get(url, timeout=10)
    favicon = codecs.encode(response.content, "base64")
    fhash = mmh3.hash(favicon)
    print(f"{url} : {fhash}")
    return fhash
```

**なぜこの実装でなければならないのか**。ここが初学者が最も躓く点である。

1. ハッシュ対象は**画像のバイナリそのものではなく、base64エンコードした文字列**である。Shodanはバナー内の `http.favicon.data` プロパティ（= base64表現）に対してMurmurHash3を適用しており、原典の `codecs.encode(..., "base64")` はその表現を再現するための処理である。
2. Pythonの `codecs.encode(b, "base64")` は **76文字ごとに改行（`\n`）を挿入し、末尾にも改行を付ける**（MIME base64）。この改行を含むか否かでハッシュ値は完全に変わる。`base64.b64encode()`（改行なし）を使うと値が一致せず、「Shodanで検索しても何もヒットしない」という典型的な失敗になる。
3. **MurmurHash3は暗号学的ハッシュではなく、32bit符号付き整数**を返す（負値もありうる）。高速な非暗号ハッシュなので、衝突は原理的に起こりうる。

大規模に取得したい場合は [httpx](https://github.com/projectdiscovery/httpx) の `httpx -l targets.txt -favicon` でハッシュを一括算出し、Shodan/Censysでピボットする、というのが現代的な運用である。

原典はさらに、favicon指紋を**証拠ではなく手がかり（indicator, not proof）**として扱えと繰り返し注意している。要点を整理する。

- **衝突・アイコン使い回し・意図的な偽装がありうる**。MMH3は32bitなので空間が狭い。
- **`/favicon.ico` 以外も見る**：フレームワークのビルド出力パス、`site.webmanifest`、`browserconfig.xml`、`apple-touch-icon*`、インラインの `data:` URL、HTMLの `<link rel="icon">`。
- **WAF/SSO/IdPの背後でも静的アセットだけは到達できることがある**。アイコンを直接リクエストして `ETag` / `Last-Modified` / リダイレクト / キャッシュヘッダを見る。ETagが一致すれば同一ファイルである強い証拠になる。
- **周辺シグナルで裏を取る**：タイトル、HTML/bodyハッシュ、ヘッダ、TLS証明書のsubject/SAN、検出プロダクト、開放ポート。
- **bodyハッシュでクラスタリング**する。テンプレートが揃っていれば指紋として強く、バラバラなら汎用アイコンを共有しているだけの可能性が高い。
- **無関係なシグネチャ・ポート・プロダクトにまたがって同じハッシュが出る場合は、ハニーポットやプレースホルダを疑う。**
- **曖昧な対象では、実在ページと存在しないパス（例：`/_favicon_probe_<8-hex>`）の応答を比較する**。同じホスティング／パーキング応答が返るなら、アイコン共有の理由はそれで説明がつく。
- **Nucleiの検出ルールや公開データセット**（faviconハッシュ→製品/CPEの対応表）からトリアージを始めるとよい。
- **IP中心データセットのカバレッジギャップを忘れない**：CDN前段、SNIルーティング、Anycast、ドメインしか存在しない面は、Shodan系のデータに載らないことがある。

#### 4.5 Copyright / ユニーク文字列

フッターの著作権表記のような「組織内で共有されがちな文字列」を全文検索エンジンに投げる。

```bash
shodan search http.html:"Copyright string"
```

原理は4.3と同じ（一意な文字列 × 全文インデックス）だが、**トラッカーIDを持たない社内向けアプリやAPIポータルにも効く**点が異なる。独自のCSSクラス名、エラーページの定型文、社内共通のJSバンドル名なども同様に使える。

#### 4.6 CRT Time correlation（証明書の時間相関）

原典はこういうcronが「よくある」ことを指摘する。

```bash
# /etc/crontab
37 13 */10 * * certbot renew --post-hook "systemctl reload nginx"
```

**なぜこれが資産発見に効くのか**：同一サーバ／同一運用チームが管理する証明書は、こうした自動更新ジョブによって**ほぼ同時刻に発行される**。証明書の `notBefore` タイムスタンプがミリ秒レベルで近接し、さらにCertificate Transparencyログ上の**エントリのインデックス位置が隣接する**。この時間・位置の相関を使えば、証明書のSANに直接書かれていなくても「同じ運用主体のドメイン」をクラスタリングできる（出典として原典はPT SWARMのArseniy Sharoglazovの研究を挙げている）。とくに**ワイルドカード証明書でホスト名を隠している組織**に対して有効な迂回路になる。

CTログ自体の参照先：[crt.sh](https://crt.sh/)、[certspotter.com](https://certspotter.com/)、[search.censys.io](https://search.censys.io/)、[chaos.projectdiscovery.io](https://chaos.projectdiscovery.io/)（+ [chaos-client](https://github.com/projectdiscovery/chaos-client)）。

**CTの仕組み（前提知識）**：RFC 6962で定義されたCertificate Transparencyは、CAが証明書（正確にはprecertificate）を**追記専用のMerkle treeログ**に提出し、SCT（Signed Certificate Timestamp）を受け取る仕組み。Chromeは2018年4月以降、公的に信頼される証明書にSCTを必須化した。結果として、**パブリックCAが発行した証明書のホスト名は事実上すべて公開される**。`dev.`, `staging.`, `vpn.` といった内部向けホスト名がCTログ経由で漏れるのはこの帰結であり、防御側から見れば「証明書を取る＝ホスト名を全世界に公表する」と等価である（対策はワイルドカード証明書か、内部PKIの利用）。

#### 4.7 DMARCによる関連ドメイン発見

`_dmarc.<domain>` のTXTレコードには、DMARCポリシーと**集計レポート送付先（`rua=mailto:...`）**が書かれている。組織が独自のレポート受信アドレスやDMARCベンダー固有のタグを使っている場合、**同じrua値を共有するドメイン群＝同じ組織のメールドメイン**という強い相関が得られる。買収した会社のドメインや、メール送信専用の別ドメインがここで出てくることがある。

原典が挙げる手段：[https://dmarc.live/info/google.com](https://dmarc.live/info/google.com)、[dmarc-subdomains](https://github.com/Tedixx/dmarc-subdomains)、[spoofcheck](https://github.com/BishopFox/spoofcheck)、[dmarcian](https://dmarcian.com/)。

同じ発想は SPF レコードにも適用できる（`include:` で参照される自社ドメインやメール基盤が芋づるになる）。

#### 4.8 Shodanの `org:` / `ssl:` 再帰

```text
org:"Example, Inc."
ssl:"Example Motors"
```

**なぜ `ssl:` が再帰的に効くのか**：Shodanは各ホストのTLSハンドシェイクを収集し、証明書のsubject（`O=` 組織名、`CN=`、SAN）をインデックスしている。したがって、対象のメインサイトの証明書から `Organisation` 名を読み取り、その名前でShodanの証明書インデックスを検索すれば、**DNS上は無関係に見えるがTLS証明書に同じ組織名が入っているホスト**が出る。そこで見つかったホストの証明書には、また別の未知ドメインがSANに入っていることがある——これを繰り返すのが「ssl trick を recursively」の意味である。ツールとしては [sslsearch](https://github.com/HarshVaragiya/sslsearch) がある。

関連ドメイン列挙の軽量ツールとして [assetfinder](https://github.com/tomnomnom/assetfinder) も原典に挙がっている。

#### 4.9 Passive DNS / ヒストリカルDNS

> Passive DNS data is great to find **old and forgotten records** that still resolve or that can be taken over.

パッシブDNSは、リゾルバやセンサーが観測した**実際のDNS応答の履歴**を蓄積したもの。現在のゾーンには存在しないレコードや、過去に解決していたIPが残る。用途は二つ。(1) 廃止されたはずのホストが今も生きているケースの発見、(2) **CloudFlare等のCDN導入前のorigin IP**の特定（原典はIP節で "might allow you to find CloudFlare bypasses" と述べている）。参照先：[SecurityTrails](https://securitytrails.com/)、[PassiveTotal](https://community.riskiq.com/)、[DomainTools Iris](https://www.domaintools.com/products/iris/)、[Farsight DNSDB](https://www.farsightsecurity.com/solutions/dnsdb/)。

#### 4.10 Passive Takeover（原典の注意喚起つき項目）

放置されたAレコードは、クラウド事業者が同じIPを別の顧客に再割当てした瞬間に「他人のもの」になる。原典はこの現象を扱った研究（kmsec.uk）を引きつつ、インスタンスを立ててそのアドレスをパッシブDNSデータと突き合わせるワークフローを紹介し、**"test takeover scenarios only within the authorized scope"** と明示的に釘を刺している。本書も同じ立場を取る。**防御側の教訓は明快で、クラウド資源を解放する前に必ずDNSレコードを削除すること（DNSを先に消す）**である。

> 出典: HackTricks — External Recon Methodology — https://book.hacktricks.wiki/en/generic-methodologies-and-resources/external-recon-methodology/index.html

---

### 5. ステップ4：ドメインからサブドメインへ（本章の後続節への接続）

ドメイン集合が固まったら垂直方向に掘る。HackTricksは以下の層構造で整理している。詳細は本章の後続節で扱うため、ここでは**各層が何を解決しているか**だけ押さえる。

| 層 | 手段 | 何を解決するか |
|---|---|---|
| DNSレコード直取り | `dnsrecon -a -d example.com`（ゾーン転送試行を含む） | 設定ミス（AXFR許可）があれば一撃で全ゾーンが取れる |
| OSINT（passive） | BBOT / Amass / subfinder / findomain / OneForAll / assetfinder / Sudomy / vita / theHarvester、crt.sh・RapidDNS・JLDC・gau等のAPI | 既に世界のどこかに記録済みの名前を回収。**ターゲットに1パケットも送らずに済む**のが最大の利点 |
| DNSブルートフォース（active） | massdns / shuffledns / puredns / gobuster / aiodnsbrute + ワードリスト + 信頼できるリゾルバ | 記録が残っていない名前を推測で当てる |
| Permutation（2巡目） | dnsgen / goaltdns / gotator / altdns / dmut / alterx | 発見済みの名前から `dev-`, `-stg`, `2` 等の派生を生成 |
| Smart permutation | [regulator](https://github.com/cramppet/regulator)（発見済み名から正規表現的パターンを学習）/ [subzuf](https://github.com/elceef/subzuf)（DNS応答をフィードバックに探索を拡張） | 組織固有の命名規約を自動学習し、当たりやすい候補に絞る |
| VHost探索 | `Host` ヘッダのファジング | DNSに存在しない／未公開のバーチャルホストを掘る |

CTベースのpassive列挙用のワンライナー（原典そのまま）：

```bash
# Get Domains from crt free API
crt(){
 curl -s "https://crt.sh/?q=%25.$1" \
  | grep -oE "[\.a-zA-Z0-9-]+\.$1" \
  | sort -u
}
crt example.com
```

ブルートフォース時に効いてくる**原理上の注意点**を2つだけ先出ししておく。

1. **リゾルバの品質が結果の品質**：massdnsは生のUDPを高レートで撃つため、レート制限やDNSハイジャックをするリゾルバを混ぜると偽陽性・取りこぼしが大量発生する。原典が [dnsvalidator](https://github.com/vortexau/dnsvalidator) や [trickest/resolvers](https://raw.githubusercontent.com/trickest/resolvers/main/resolvers-trusted.txt) を挙げるのはこのため。原典自身も massdns を "very fast however it's prone to false positives" と評している。
2. **ワイルドカードDNS**：`*.example.com` が設定されていると、存在しない名前もすべて解決してしまい、ブルートフォース結果が全件ヒットになる。`puredns` / `shuffledns` はランダムな名前を先に解決して応答パターンを学習し、それと同じ応答を返す結果を除外する（wildcard handling）。この処理を挟まないパイプラインは実質的に機能しない。

VHostファジングの例（原典より、ffufの自動キャリブレーション付き）：

```bash
ffuf -u http://198.51.100.10 -H "Host: FUZZ.example.com" \
  -w /opt/SecLists/Discovery/DNS/subdomains-top1million-20000.txt -ac
```

**なぜ `Host` ヘッダで別サイトが出るのか**：HTTP/1.1では1つのIP/ポート上で複数のサイトを名前ベースで多重化しており、nginxの `server_name` やApacheの `ServerName` がリクエストの `Host` ヘッダと突き合わされて配信先が決まる。DNSに登録されていない名前でも、サーバ側の設定に `server_name internal.example.com;` が残っていれば、その名前を `Host` に入れるだけで内部向けサイトが応答する。`-ac`（auto-calibration）は、まずランダムな値でリクエストしてデフォルトvhostの応答を学習し、それと同じ応答を自動的に除外するオプション。これがないと全リクエストが「ヒット」になって使い物にならない。

同じ「サーバ側の設定が漏らす」系の手法として、**CORSブルートフォース**がある。

```bash
ffuf -w subdomains-top1million-5000.txt -u http://198.51.100.208 -H 'Origin: http://FUZZ.example.com' -mr "Access-Control-Allow-Origin" -ignore-body
```

**原理**：サーバが `Origin` ヘッダを許可リストと突き合わせ、**許可された場合にだけ** `Access-Control-Allow-Origin` を返す実装になっていると、そのレスポンスヘッダの有無が「その名前が許可リストに載っているか」を判定するオラクル（真偽を教えてくれる装置）になる。つまり、アプリの設定ファイルに書かれた社内サブドメイン名を、外部から総当たりで抽出できてしまう。防御側の観点では、**CORS許可リストを名前の存在判定に使わせない**（許可されない場合も同一の応答形状にする、そもそも動的な反射をしない）ことが対策になる。

---

### 6. 資産の外周：IP・Webサーバ・クラウド・漏洩情報

資産発見の最後の環は、収集したIP／ドメインを「実際に触れるWebサーバの集合」に落とし込む工程である。

- **IP**：見つけたレンジとDNS解決結果からIPを集約。`hakip2host`（[https://github.com/hakluke/hakip2host](https://github.com/hakluke/hakip2host)）で「そのIPを指すドメイン」を逆に引ける。**CDNに属するIPはポートスキャンしても無意味**（CDN事業者の設備であり、対象組織の資産ではない）なので除外する。
- **Webサーバ検出**：`httprobe` / `fprobe` / `httpx` にドメインリストを流し、80/443（および追加ポート）に接続できるものを抽出。

```bash
cat /tmp/domains.txt | httprobe                             # 80 と 443 をテスト
cat /tmp/domains.txt | httprobe -p http:8080 -p https:8443  # 追加ポート
```

- **スクリーンショット**：数百〜数千ホストを人間が順に見るのは不可能なので、EyeWitness / Aquatone / Gowitness / webscreenshot で一括撮影し、視覚的に「怪しいもの」を先に拾う。[eyeballer](https://github.com/BishopFox/eyeballer) はスクリーンショット群を機械学習で分類し、脆弱性を含みやすいものを推薦する。
- **パブリッククラウド資産**：企業を識別するキーワード（事業領域の語、ドメイン名、サブドメイン名）を種にpermutationを生成し、`cloud_enum` / `CloudScraper` / `cloudlist` / `S3Scanner` でバケット等を探索。原典は **"look for more than just buckets in AWS"**（S3以外・AWS以外も見ろ）と念を押している。
- **メール・認証情報漏洩・シークレット漏洩**：theHarvester や hunter.io でメールアドレスを収集し、漏洩DB（leak-lookup、dehashed）やGitHub（[Leakos](https://github.com/carlospolop/Leakos) + [gitleaks](https://github.com/zricethezav/gitleaks)）、ペーストサイト（[Pastos](https://github.com/carlospolop/Pastos)）、Google Dorks（[Gorks](https://github.com/carlospolop/Gorks)）を横断して探す。**防御側の観点では、ここが「攻撃面」の中で最も見落とされる領域**である：自社の従業員個人のGitHubアカウントに社内トークンが混入する事故は、組織のリポジトリだけ監視していても検知できない（Leakosが「組織とその開発者のリポジトリ」の両方を対象にするのはこのため）。

**継続監視**：原典は、CTログを監視して新規サブドメインの出現を検知する例として [sublert](https://github.com/yassineaboukir/sublert/blob/master/sublert.py) を挙げている。資産発見は一度きりの作業ではなく、**新規発行証明書・新規DNSレコード・新規ASN広告の差分を取り続ける運用**に載せて初めて武器になる（本書の自動化・継続監視の章で詳述する）。

---

### 7. チェックリスト（原典のRecapitulation）

この段階を終えたとき、手元にあるべきものは次の9点である。

1. スコープ内の**全企業**
2. 各企業に属する**全資産**（許可があれば脆弱性スキャンも実施済み）
3. 各企業の**全ドメイン**
4. 各ドメインの**全サブドメイン**（takeover可能なものはないか）
5. **全IP**（CDN由来か否かを区別済み）
6. **全Webサーバ**とそのスクリーンショット
7. **パブリッククラウド資産**の候補
8. **メール／認証情報漏洩／シークレット漏洩**
9. 発見したWebアプリのペネトレーションテスト

これらを一括で回す統合ツールとして、原典は [reNgine](https://github.com/yogeshojha/rengine)、[Osmedeus](https://github.com/j3ssie/Osmedeus)、[reconFTW](https://github.com/six2dez/reconftw) を挙げている（EchoPwn は "a little old and not updated" と注記）。ただし、**自動化ツールは本節で説明した各手法の「実装」に過ぎない**。原理を理解せずに回すと、ワイルドカードで汚染された結果やスコープ外のクラウドIPをそのまま信じることになる。自動化は理解の代替ではなく、理解の増幅器である。

> 出典: HackTricks — External Recon Methodology — https://book.hacktricks.wiki/en/generic-methodologies-and-resources/external-recon-methodology/index.html

---

### 8. もうひとつの体系：Ahmad Halabi の Ultimate Reconnaissance RoadMap

> ⚠️ **未取得の資料**: 「Ultimate Reconnaissance RoadMap for Bug Bounty Hunters & Pentesters」（Ahmad Halabi）は自動取得できませんでした（理由: Medium が自動取得リクエストに対して HTTP 403 Forbidden を返すため。代替として GitHub 上の [ahmad0x1/ARWAD](https://github.com/ahmad0x1/ARWAD) リポジトリの取得も試みましたが、README には概要文のみで方法論本文は含まれていませんでした）。以下のURLからご自身で直接ご覧ください: https://ahmdhalabi.medium.com/ultimate-reconnaissance-roadmap-for-bug-bounty-hunters-pentesters-507c9a5374d

検索経由で確認できた範囲の事実は以下の通り（本文そのものは未取得）。著者のAhmad Halabiは HackerOne の歴代上位ランカーで、この方法論に **ARWAD（Advanced Recon and Web Application Discovery）** という名を与えている。彼自身の言葉として繰り返し紹介されるのは、**「ツールよりもメソドロジーとマインドセットが先。考え方さえ身につけばツールを使うのは簡単だ」**という主張と、**「詳細なReconは攻撃面を広げるためだけでなく、*focus area を絞る*ために行う」**という点である。方法論の図（フローチャート）は上記GitHubリポジトリで公開されている。

（以下は未取得資料の補足として一般知識に基づく解説です）

HackTricksのExternal Recon Methodologyと、Halabi系の「ロードマップ」型資料は、扱う技術要素は大きく重なるが**編成の軸が異なる**。この違いを理解しておくと、両者を補完的に使える。

- **HackTricks型＝「データソース中心」の編成**。「どの公開台帳に、どの識別子で問い合わせるか」のカタログとして構成されている。網羅性が高く、リファレンスとして強い。一方、*どの順番で、いつ打ち切るか*は読者に委ねられている。
- **ロードマップ／フローチャート型＝「意思決定中心」の編成**。「ドメインを1つ与えられたとき、次に何をするか」を分岐つきの手順として描く。実行順序と分岐条件（例：ワイルドカード証明書だったらCT以外の経路に切り替える、WAFを検知したらorigin IP探索に回る）が明示されるので、実務で手が止まりにくい。

WHOISに関してHalabi系の資料が強調するとされる点も実務的に重要である。**単発のWHOIS照会は「ある一時点のスナップショット」に過ぎず、価値があるのは履歴である**。4.2で述べたGDPR以降の黒塗り問題とあわせると、次のような運用指針になる。

1. 現在のWHOISで得られる情報（`Registrant Organization`、ネームサーバ、レジストラ、作成日）をまず取る。
2. **ネームサーバとレジストラの組み合わせ**自体をピボットに使う。大企業はブランド保護レジストラ（MarkMonitor、CSC Global等）を使うことが多く、「同じブランド保護レジストラ＋同じ社内DNSサーバ」のドメイン群は、ほぼ確実に同一組織である。
3. 履歴WHOIS（有料DB）で黒塗り前のレコードを引き、当時の登録者メール／組織名でreverse WHOISを回す。
4. 得られた新ドメインを種に、1に戻る（再帰）。

つまり、HackTricksが示した「4ステップの再帰ループ」に、**「識別子の選択」という層を1枚追加する**のがロードマップ型の実務的貢献だと理解すればよい。どの識別子が当該組織にとって最も判別力が高いか（メールか、ネームサーバか、favicon か、GA ID か）は組織ごとに違い、それを見極めるのが「マインドセット」と呼ばれているものの実体である。

> 出典: Ultimate Reconnaissance RoadMap for Bug Bounty Hunters & Pentesters — Ahmad Halabi — https://ahmdhalabi.medium.com/ultimate-reconnaissance-roadmap-for-bug-bounty-hunters-pentesters-507c9a5374d （本文は取得不可。上記は検索で確認できた記述および一般知識に基づく補足）
> 参考: ARWAD リポジトリ — https://github.com/ahmad0x1/ARWAD

---

### 9. この節のまとめ

| ピボット（識別子） | 問い合わせ先 | 原理 | 主な限界 |
|---|---|---|---|
| 企業名 | SEC/EDGAR, GLEIF, OpenCorporates, Crunchbase | 法的開示義務による一次情報 | 買収直後は反映が遅い |
| 企業名 | bgp.he.net, RIR WHOIS | ASN/プレフィックスはBGPとRIRの公開台帳 | クラウド/トランジットのASNはスコープ外 |
| 登録者メール・組織名 | reverse WHOIS | レジストリの登録者フィールドの逆引き索引 | GDPR（2018〜）で現在値は黒塗り。履歴が本命 |
| GA/AdSense ID、独自文字列 | Publicwww, BuiltWith, Shodan `http.html:` | 全文インデックスに一意な文字列が載る | 共通テンプレート使用時は偽陽性 |
| favicon hash (mmh3) | Shodan `http.favicon.hash:`, FOFA `icon_hash=` | base64表現に対するMMH3、32bit | 衝突・アイコン使い回し・CDN配下の不可視性 |
| TLS証明書の組織名 | Shodan `ssl:`, Censys | 収集済み証明書のsubject/SANの索引 | 共用証明書、ワイルドカード |
| 証明書の発行時刻 | CTログ（crt.sh, Censys） | 自動更新cronによる同時発行の時間相関 | 手動更新・分散更新の環境では効かない |
| DMARC `rua` | `_dmarc.<domain>` TXT | レポート送付先が組織固有 | 共用ベンダーアドレスの場合は判別力が落ちる |
| PTR | `in-addr.arpa` | IPブロック保有者に委任された逆引きゾーン | 管理者が明示設定しない限り存在しない |

**防御側への含意**を最後に置く。ここまでの手法はすべて**組織が自ら公開した台帳・ログ・レスポンス**の上に成り立っている。したがって防御は「隠す」ことではなく、**(a) 攻撃者と同じ手順で自組織の外部攻撃面を定期的に棚卸しすること**、**(b) 露出する情報を意図的に設計すること**（ワイルドカード証明書や内部PKIの利用、CORS許可リストをオラクルにしない実装、DMARC rua の設計）、**(c) 資産のライフサイクルを閉じること**（クラウド資源の解放前にDNSレコードを削除する、退役サービスのCNAMEを残さない）に尽きる。External Reconの全体像を知ることは、そのまま自組織のASM（Attack Surface Management）の設計図を知ることである。
