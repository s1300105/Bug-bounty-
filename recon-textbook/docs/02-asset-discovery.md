# 第2章 資産発見と組織全体マッピング


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

## horizontal/vertical列挙とASN・CIDR

### この節で扱うこと

資産発見（asset discovery）の工程は、大きく二つの方向に分解できる。組織が持つ**ルートドメイン（apex domain）の集合そのものを横に広げる**作業と、**確定したルートドメインの下にぶら下がるホストを縦に掘る**作業である。前者を horizontal enumeration（水平列挙）、後者を vertical enumeration（垂直列挙）と呼ぶ。

多くのハンターが `subfinder -d example.com` から始めてしまうが、それは「`example.com` という1本のルートドメインが所与である」という前提に立っている。実際の企業は買収・子会社・地域法人・キャンペーン用ドメイン・レガシー資産を抱えており、ルートドメインは1本ではない。**horizontal列挙が弱いと、そもそも列挙の入力集合（seed）が貧弱なまま、その後の全工程がスケールしない。** ここが「Recon自体が武器になる」かどうかの最初の分岐点であり、本節の主題である ASN（自律システム番号）と CIDR（IPアドレス範囲の表記）は、その horizontal列挙を DNS 以外の軸で駆動するための道具立てである。

> **本節のスコープ**: 以下で扱うのは、組織が自らの攻撃面（attack surface）を把握するための**受動的な情報収集（passive OSINT）と、その原理の理解**である。実在サービスに対する無許可のスキャン・ブルートフォース・その他の能動的検証は一切扱わない。後述するコマンド例のうち能動的通信を伴うもの（逆引きDNS問い合わせ等）についても、自組織の資産、または書面で許可された範囲に限って実行されるべきものとして記述する。

---

### 1. horizontal と vertical の定義を厳密にする

#### 1.1 horizontal enumeration（水平列挙）

sidxparab の Subdomain Enumeration Guide は、horizontal enumeration を「**単一の組織体（entity）が所有するすべてのルートドメインを列挙すること**」と定義し、その目的を「その組織のインターネットに露出した全資産のインベントリ（inventory＝台帳）を作ること」と述べている。

つまり horizontal列挙の出力は「サブドメインのリスト」ではなく「**apexドメインのリスト**」である。

```
入力: "Example Corporation"（組織名）
出力: example.com, example.co.jp, example-cdn.net, acquired-startup.io,
      example-labs.dev, exmpl.sh, ...
```

この出力が、次の vertical列挙の入力になる。

#### 1.2 vertical enumeration（垂直列挙）

確定した1本のapexドメインに対して、その配下のサブドメイン（`api.example.com`, `staging.internal.example.com` など）を掘る作業。CT（Certificate Transparency）ログ、パッシブDNS、DNSブルートフォース、permutation生成などが該当し、これは本書の第3章で扱う。

#### 1.3 なぜ順番が重要か

horizontal → vertical の順序には情報理論的な理由がある。vertical列挙のコストは apexドメイン1本あたりほぼ一定（ワードリスト長 × リゾルバ処理能力）で、**apexを1本追加するたびに新規資産の発見期待値は線形に増える**。一方、同じ apex に対してワードリストを10倍に増やしても、発見数は対数的にしか伸びない（よく使われる名前は既に見つかっているため）。したがって「広げてから掘る」ほうが単位時間あたりの発見効率が高い。

さらに実務上の非対称性として、**買収されたばかりの子会社ドメインは、親会社のセキュリティ基準がまだ適用されていないことが多い**。ここが防御側にとっての最大の盲点であり、だからこそ資産インベントリの作成が防御の起点になる。

---

### 2. ASN と BGP ──「なぜIPアドレス範囲から組織を逆引きできるのか」

ASN を「組織に割り当てられた番号」と暗記している人は多いが、**なぜその番号から IP レンジが引けるのか**を仕組みレベルで理解していないと、後述する誤検知（false positive）の判断ができない。ここは原理から押さえる。

#### 2.1 AS（Autonomous System）とは何か

AS（自律システム）とは、**単一の管理主体のもとで統一されたルーティングポリシーを持つ、IPネットワークの集合**である。インターネットは「ASの集合体」として構成され、AS同士は BGP（Border Gateway Protocol）でお互いに「自分はこの IPレンジ（prefix）に到達できる」と広告（advertise）し合う。

ASN はその AS に付与された識別番号で、IANA → RIR（地域インターネットレジストリ：ARIN, RIPE NCC, APNIC, LACNIC, AFRINIC）→ 組織、という階層で割り当てられる。16bit の番号空間（0〜65535）が枯渇したため、現在は 32bit ASN（4-byte ASN, 最大4294967295）も広く使われている。

#### 2.2 BGPの「経路広告」が公開情報である、という決定的な事実

ここが核心である。BGP は**到達性を広告するプロトコル**なので、「AS714 が 17.0.0.0/8 を origin（発信元）として広告している」という事実は、インターネット全体のルータが知っていなければ通信が成立しない。つまり **BGP の経路情報は本質的に公開情報**であり、世界中のルートコレクタ（RouteViews, RIPE RIS など）がこれを収集・アーカイブしている。

bgp.he.net をはじめとする BGP Toolkit は、このグローバルな経路表を逆向きに索引したものである。だから「組織名 → ASN → その AS が広告している CIDR の一覧」という連鎖が、対象に一切パケットを送らずに成立する。**これは攻撃でもスキャンでもなく、公開されたルーティング情報の参照である。**

#### 2.3 ASNから CIDR を引く3つのデータソース（性質が違う）

| ソース | 中身 | 更新性 | 注意点 |
|---|---|---|---|
| **BGPグローバル経路表**（bgp.he.net等） | 実際に「今」広告されている prefix | ほぼリアルタイム | 広告されていない未使用レンジは出ない |
| **IRR**（Internet Routing Registry, RADb等） | 運用者が登録した `route` オブジェクト | 手動登録・陳腐化しやすい | 古い・重複登録が残る。逆に広告前のレンジが見えることも |
| **RIR WHOIS / RDAP** | 割り当て（allocation）の台帳 | 割当変更時 | 組織名で検索できる（ARINの Org search 等）。ASNを持たない組織の割当も見える |

この3つは一致しない。**「広告されている ≠ 登録されている ≠ 割り当てられている」** ので、網羅性を求めるなら3つとも当たる必要がある。

#### 2.4 定番コマンドの原理

horizontal列挙で最も引用されるワンライナーがこれである。

```bash
whois -h whois.radb.net -- '-i origin ASXXX' | grep -Eo "([0-9.]+){4}/[0-9]+" | uniq -u
```

> 出典: Horizontal Enumeration — Subdomain Enumeration Guide — https://sidxparab.gitbook.io/subdomain-enumeration-guide/types/horizontal-enumeration

**なぜこれが動くのか**を分解する。

- `whois -h whois.radb.net` … 通常の WHOIS（ドメイン登録情報）ではなく、**RADb（Routing Assets Database）という IRR サーバ**に問い合わせている。IRR は「どの AS がどの prefix を origin として広告してよいか」を運用者が宣言するデータベースで、ISP が経路フィルタを自動生成するために使う。
- `--` … これ以降を `whois` コマンド自身のオプションではなく、**サーバへ渡すクエリ文字列**として扱わせる POSIX の区切り。`-i` で始まる文字列をローカルのオプション解釈から守るために必須。
- `-i origin ASXXX` … RIPE/IRR のクエリ構文で「**inverse lookup（逆引き）**：属性 `origin` の値が `ASXXX` であるオブジェクトを返せ」という意味。`route:` オブジェクトは `route: 17.0.0.0/8` と `origin: AS714` の組で登録されているため、origin から route を逆に引ける。
- `grep -Eo "([0-9.]+){4}/[0-9]+"` … 出力テキストから CIDR 形式だけを抜き出す。なお `([0-9.]+){4}` は厳密な IPv4 正規表現ではなく（`1.2.3.4.5.6` のような文字列も拾う）、実運用では精度より簡便さを優先した書き方である点は理解しておくべきである。
- `uniq -u` … **ここは要注意。`uniq -u` は「重複しない行だけ」を出力する**ため、同じ CIDR が2回以上現れた場合、その CIDR は消える。さらに `uniq` はソート済み入力を前提とするので、本来の意図（重複除去）を達成したいなら `sort -u` を使うべきである。原典のワンライナーをそのまま貼るのではなく、こうした細部を理解して使うのが教科書的な態度である。

IPv6 も同様に `-i origin` で引けるが、上の `grep` は IPv4 しか拾わない。IPv6 prefix を取りこぼす典型的な原因になる。

#### 2.5 ASN を持たない組織のほうが多い、という前提

重要な注意として、**ASN を保有しているのは、自前で IP 空間を運用する大企業・ISP・クラウド事業者に限られる**。中堅企業やスタートアップは、AWS・GCP・Cloudflare・Akamai などの ASN 配下の IP を使う。したがって：

- **ASN経路は「大企業・レガシー資産」に対して極めて有効**（例：Apple の 17.0.0.0/8 のような legacy /8 割り当て）
- **クラウドに載っている組織に対してはほぼ無力**。AWS の ASN を引いても出てくるのは AWS の全顧客の IP であり、対象組織の資産ではない

この線引きを誤ると、スコープ外のホストを対象と誤認する事故につながる。

---

### 3. bgp.he.net（Hurricane Electric BGP Toolkit）の読み方

ロードマップ本文で ASN→CIDR 列挙の定番として指定されているのが Hurricane Electric の BGP Toolkit である。

#### 3.1 何が引けるのか

BGP Toolkit は ASN・IPアドレス・prefix・DNS・企業ネットワークの情報を横断的に検索できるプラットフォームで、検索窓に**組織名・ドメイン名・IPアドレス・AS番号のいずれを入れても**対応する AS/prefix ページに到達できる。提供されている機能群は以下のカテゴリに整理される。

- **BGPデータ**: Prefix レポート（IPv4/IPv6）、ピア関係、multi-origin routes（複数 AS から広告されている prefix ＝ 経路ハイジャックや設定ミスの兆候）
- **インフラ**: IX（インターネットエクスチェンジ）、bogon routes、RPKI & ASPA の検証状況
- **診断**: Super Traceroute、Looking Glass、Super Looking Glass
- **統計**: DNSレポート、ホストランキング、IPv6 進捗

> 出典: Hurricane Electric BGP Toolkit — https://bgp.he.net/

#### 3.2 ASNページのタブ構成（実例）

実際の ASN ページ（例として `https://bgp.he.net/AS714`、Apple Inc.）は以下のタブを持つ（2026年9月時点）。

```
AS Info / Graph v4 / Graph v6 / Prefixes v4 / Prefixes v6 /
Bogon / Peers v4 / Peers v6 / Whois / RDAP / IRR / IX / Traceroute
```

この AS は IPv4 prefix を 1,581 本、IPv6 prefix を 445 本、合計 2,026 本を「announced（広告中）」として掲載している（originated（全体）では IPv4 1,589 / IPv6 447、計 2,036）。**announced と originated の差**は、広告が停止している／一部のコレクタからしか見えない prefix の存在を示しており、こうした差分自体が「棚卸しから漏れているレガシー資産」の手がかりになる。

> 出典: AS714 Apple Inc. — Hurricane Electric BGP Toolkit — https://bgp.he.net/AS714

#### 3.3 各タブの実務的な使い分け

- **Prefixes v4 / v6** … horizontal列挙の主収穫。CIDR一覧をここから取る。IPv6 タブを必ず見ること（IPv4 だけを見る癖がついている人が非常に多い）。
- **Whois** / **RDAP** … RIR 台帳側の記載。組織名・住所・担当者メールが取れ、これが後述する reverse WHOIS の検索キーになる。RDAP は WHOIS の後継で、**JSON で構造化されて返る**ため自動化に向く。
- **IRR** … 前述の RADb 等の route オブジェクト。BGP に出ていないが登録だけされているレンジが見える。
- **Peers** … 上流 ISP・ピアの一覧。**子会社が親会社の AS とピアしている**、あるいは同一グループの複数 AS が同じ上流を持つ、といった相関から関連 AS を辿れる。
- **Bogon** … 本来ルーティングされるべきでないアドレス（未割当、プライベート等）の広告。設定ミスの兆候であり、防御側の是正対象。

#### 3.4 組織名検索の落とし穴

検索窓に社名を入れると AS の登録名（AS-NAME / org name）で一致するものが返るが、これは**登録上の表記に完全に依存する**。以下の理由で取りこぼしが起きる。

1. **買収後に AS の登録名が旧社名のまま**（これはむしろ好機：旧社名でも検索する）
2. **持株会社名・法人格の表記ゆれ**（"Example Inc." / "Example, Inc." / "Example Holdings K.K."）
3. **地域法人が別 ASN を保有**（"Example Europe B.V." など）
4. **国別の表記**（現地語での登録）

したがって、社名・旧社名・持株会社名・地域法人名を**列挙して総当たりする**のが正しい使い方である。ここは Crunchbase 等の買収データベースと組み合わせる工程（第2章の別節）と密接に連動する。

---

### 4. CIDR を仕組みレベルで理解する

CIDR（Classless Inter-Domain Routing）記法 `A.B.C.D/n` の `n` は**プレフィックス長**、すなわち「ネットワーク部として固定されるビット数」である。

```
17.0.0.0/8
 → 上位 8bit（00010001）が固定、下位 24bit が可変
 → ホスト数 = 2^(32-8) = 2^24 = 16,777,216 個

192.0.2.0/24
 → 上位 24bit 固定、下位 8bit 可変
 → 2^8 = 256 個（うちネットワークアドレスとブロードキャストを除けば 254 が利用可能）
```

ルータの転送処理は、宛先 IP とルーティングテーブル各エントリのプレフィックスをマスク（AND演算）して比較し、**最長一致（longest prefix match）**で次ホップを決める。`/24` と `/16` が両方マッチするなら `/24` が勝つ。この「長いほうが優先」という性質があるため、組織が `/16` を持っていてもその一部の `/24` を別組織にリースしている、というケースが成立する。**CIDR から組織への帰属を1対1で決めつけてはいけない**理由はここにある。

#### 4.1 CIDR展開と逆引きの連結

CIDR を個々の IP に展開し、PTR レコード（逆引きDNS）を引いて所有組織の手がかりを得るのが、horizontal列挙における IP 軸の定石である。

```bash
echo 17.0.0.0/16 | mapcidr -silent | dnsx -ptr -resp-only -o output.txt
```

> 出典: Horizontal Enumeration — Subdomain Enumeration Guide — https://sidxparab.gitbook.io/subdomain-enumeration-guide/types/horizontal-enumeration

**なぜ動くのか（パイプラインの原理）**:

1. `mapcidr` は標準入力から受け取った CIDR を**展開**し、範囲内の各 IP アドレスを1行ずつ標準出力に吐く。`/16` なら 65,536 行になる。
2. `dnsx` は標準入力の各 IP を受け取り、`-ptr` で**逆引き（PTR レコード）問い合わせ**を行う。IPv4 の逆引きは `17.253.144.10` → `10.144.253.17.in-addr.arpa` のようにオクテットを反転した特殊ドメインへの問い合わせとして実装されており、このゾーンは RIR から IP 割当先組織へ**委任（delegation）**されている。つまり PTR を返すのは対象組織（または委託先）自身の DNS サーバである。
3. `-resp-only` は応答（ホスト名）だけを出力する。

**この逆引きが「所有者の手がかり」になる理由**は、ゾーンが割当先に委任されているからである。`*.apple.com` のような PTR が返れば、その IP はほぼ確実に当該組織の管理下にある。

**逆に効かないケース**も明確である：

- **クラウド上の IP** … PTR はプロバイダの既定名（`ec2-203-0-113-10.compute-1.amazonaws.com` 等）になり、顧客が誰かは分からない
- **PTR 未設定** … 企業は逆引きを設定していないことも多く、その場合は空振り
- **CDN 背後** … PTR は CDN 事業者のもの

#### 4.2 展開してよい範囲の見極め（重要）

`/8` を `mapcidr` に渡すと 1,677万件が展開される。これを全件 DNS 問い合わせすれば、**対象組織の DNS サーバに対する実質的な負荷試験**になりかねず、パブリックリゾルバの利用規約にも抵触しうる。本書の方針としては：

- 大きなレンジは、まず **`/24` 単位の代表 IP を数点引いて当たりをつける**（スパースサンプリング）
- 全件展開は、自組織の資産、または明示的な許可がある範囲に限る
- レート制限（`dnsx` の `-rl`）と自前リゾルバの使用を前提にする

ポートスキャン（nmap/masscan）を CIDR レンジに対して行う手順は、**明確な書面の許可がない限り本書では扱わない**。ASN から導いた CIDR には、対象組織以外のホストが含まれている可能性が常にあるためである。

---

### 5. reverse WHOIS ── ドメイン軸の horizontal列挙

IP 軸（ASN/CIDR）と並ぶもう一方の軸が、WHOIS 登録情報からの相関である。ドメイン登録時の**登録者組織名・登録者メールアドレス・登録者名**は、同じ組織が登録した複数ドメインで共通することが多い。これを逆引きするのが reverse WHOIS である。

#### 5.1 主要サービス

**WhoisXMLAPI**（`tools.whoisxmlapi.com/reverse-whois-search`）
- WHOIS レコードを基に関連ドメイン・買収先を提示する
- **無料枠は月 500 クレジット**
- **偽陽性（false positive）を含む**ことが明記されている

**Whoxy**（有料）
- 企業名・登録者メールアドレス・所有者名といったパラメータで reverse WHOIS が可能
- データベース規模は **約 455M（4億5500万）件の WHOIS レコード**（なお同系統の記事では約 329M と記載されているものもあり、時点によって数字が異なる。2026年時点の公称値は 4.5億件規模）
- CLI ラッパー `whoxyrm` が使える

```bash
whoxyrm -company-name "Organization Name"
```

**Crunchbase**（買収履歴）や生成AIへの問い合わせも、買収先の当たりをつける補助として挙げられている。

> 出典: Horizontal Enumeration — Subdomain Enumeration Guide — https://sidxparab.gitbook.io/subdomain-enumeration-guide/types/horizontal-enumeration
> 出典: Bug Bounty Methodology — Horizontal Enumeration（apex） — https://apexvicky.medium.com/bug-bounty-methodology-horizontal-enumeration-89f7cd172e6e

> ⚠️ **未取得の資料**: 「Bug Bounty Methodology — Horizontal Enumeration（apex）」は自動取得できませんでした（理由: Medium が HTTP 403 を返し、本文を取得不可）。以下のURLからご自身で直接ご覧ください: https://apexvicky.medium.com/bug-bounty-methodology-horizontal-enumeration-89f7cd172e6e
>
> 検索インデックス経由で確認できた範囲では、同記事は「単一の組織が所有する全ドメインを特定する」という目的のもと、①ASN による IP 空間の特定（例として Apple の AS714 と 17.0.0.0/8 を挙げる）、②WhoisXMLAPI / Whoxy による reverse WHOIS（Whoxy は約 3.29 億件の WHOIS レコードと記載）、③`mapcidr` + `dnsx` による逆引き、④favicon ハッシュ相関、という構成を取っており、本節で引用している sidxparab の Subdomain Enumeration Guide と実質的に同一の方法論を扱っている。本節の記述はそちらの一次的な記述に基づいている。

#### 5.2 reverse WHOIS が効かなくなっている構造的理由（★時事性）

ここは年次で状況が変わるため、**2026年時点の前提**として明記しておく。

1. **GDPR（2018年5月適用）以降、gTLD の WHOIS は登録者情報がほぼ全面的に墨消し（redacted）されている**。`Registrant Organization: REDACTED FOR PRIVACY` が標準である。
2. したがって reverse WHOIS が有効なのは主に **GDPR 以前に登録・更新された履歴レコード**、および **WHOIS プライバシーを適用していない法人登録**である。Whoxy 等の価値は「現在の値」ではなく「**履歴アーカイブ**」にある。
3. **企業ドメインは意図的にプライバシー保護を外していることがある**（ブランド保護・商標紛争対応のため）。大企業ほど `Registrant Organization` が実名で残っている確率は高い。
4. RDAP への移行により、アクセス制御された階層（認証済み照会者のみフル情報）が整備されつつある。

**結論として、reverse WHOIS は「当たれば強いが、外れることも多い補助軸」であり、ASN/CIDR・証明書・favicon 等の複数軸と組み合わせて使う。**

---

### 6. favicon ハッシュによる相関

#### 6.1 原理

favicon.ico はブラウザのタブ左側に表示されるアイコンで、この画像は**別のエンドポイント・別ホスト・CDN 上にホストされていることもある**。組織が全社共通のファビコンを使っていれば、**同じバイト列のファビコンを配っているホストは同じ組織の資産である可能性が高い**。

Shodan は約10年前にこの発想を検索フィルタとして実装した。仕組みは以下の通り。

1. Shodan のクローラが HTTP バナー取得時に favicon を取得し、**base64 エンコードした文字列**を `http.favicon.data` として保持する
2. その文字列に **MurmurHash3（mmh3）** を適用したものが `http.favicon.hash`
3. 検索側は `http.favicon.hash:<hash>` で一致するホストを列挙できる

Shodan 公式は「The favicon hash is calculated by applying the MurmurHash3 algorithm to the http.favicon.data property on the banner.」と説明している。

**実装上の最大の落とし穴**は、ハッシュ対象が生バイナリではなく**base64 文字列**である点である。自前でハッシュを計算するときは、

```python
import mmh3, base64, requests

r = requests.get("https://example.com/favicon.ico")
b64 = base64.encodebytes(r.content)   # ← 改行を含む base64（重要）
print(mmh3.hash(b64))
```

のように、`base64.encodebytes()`（76文字ごとに改行を入れる形式）を使う必要がある。`base64.b64encode()`（改行なし）でハッシュ化すると Shodan の値と一致しない。これは Shodan が Python の古い `base64.encodestring()` 相当の出力をハッシュしているためで、**「なぜか自分の計算値で検索しても何も出ない」の原因の9割がこれ**である。

なお MurmurHash3 は暗号学的ハッシュではなく**非暗号学的な高速ハッシュ**であり、`mmh3.hash()` は**符号付き32bit整数**を返す。負の値がそのままフィルタ値になる（例: `http.favicon.hash:-1234567890`）。

#### 6.2 ツール

sidxparab のガイドでは `Fav-UP` が紹介されている。動作は、①ページのソースから favicon の URL を抽出、②その favicon の MurmurHash を生成、③`http.favicon.hash:<hash>` で Shodan 検索、という3段構成。

```bash
python3 favUp.py -w domain.com -sc -o output.json
```

> 出典: Horizontal Enumeration — Subdomain Enumeration Guide — https://sidxparab.gitbook.io/subdomain-enumeration-guide/types/horizontal-enumeration

#### 6.3 偽陽性の性質

favicon 相関の偽陽性は**質が悪い**ことを理解しておく。

- **フレームワーク既定のファビコン**（Django, Laravel, Jenkins, GitLab 等の初期アイコン）は世界中で数万ホストが一致する。組織の特定には全く使えない
- **CDN/SaaS のテナント**が共通アイコンを配っている場合も同様
- 有効なのは「**その組織のロゴをファビコンにしている**」ケースに限られる

したがって「ヒット数が数十〜数百件」の範囲に収まるハッシュだけが実用的な相関シグナルであり、数万件返るハッシュは捨てる、という判断基準を持つとよい。

---

### 7. CIDR/ASN 軸とスコープの関係 ──「backfire」の警告

sidxparab のガイドは、これらの手法について明確に「**can go out of scope and backfire you（スコープ外に出て、あなたに跳ね返ってくることがある）**」と警告している。この警告の技術的な中身を分解すると、以下の3種類のリスクになる。

1. **ASN 配下の他組織ホスト**
   ホスティング事業者・ISP・グループ外顧客のホストが同じ ASN/CIDR に同居している。ASN から得た CIDR は「対象組織の資産の集合」ではなく「**対象 AS が経路を広告しているアドレスの集合**」にすぎない。

2. **共有 IP / CDN のフロントエンド**
   CDN やクラウドロードバランサの IP は、数千のテナントで共有される。この IP に対する能動的検証は、**無関係の第三者に対する検証**になる。

3. **買収先の扱いがスコープ上未定義**
   バグバウンティのスコープに「`*.example.com`」とだけ書かれている場合、買収先の `acquired-startup.io` は**明示的に対象外**である。horizontal列挙で見つけたものをそのまま検証対象にするのは、プログラムのルール違反であり、法的リスクでもある。

**本書の立場は一貫している**: horizontal列挙で得た資産リストは、まず**帰属の確証（attribution）を取る**工程に回す。帰属の確証とは、逆引き PTR・TLS 証明書の Subject/SAN・RDAP の組織名・公開されている会社情報といった**複数の独立したシグナルの一致**を指す。1つのシグナルしか一致しないものは「候補」であり、「資産」ではない。そして検証対象にするかどうかは、**スコープ定義および明示的な許可**が単独で決める。

---

### 8. 多軸相関の設計 ── 実務パイプラインの骨格

以上を踏まえると、horizontal列挙は「ツールの列」ではなく「**独立した証拠軸を交差させる設計**」として組むべきものだと分かる。

```
[Seed] 組織名 / 既知 apexドメイン / 旧社名 / 持株会社名 / 地域法人名
   |
   +-- 軸A: ASN → CIDR
   |      bgp.he.net（組織名・ドメイン・IP検索）
   |      whois -h whois.radb.net -- '-i origin ASxxx'（IRR route オブジェクト）
   |      RIR RDAP（構造化 JSON、org 名一致）
   |         ↓
   |      CIDR 群 → mapcidr 展開 → dnsx -ptr → ホスト名
   |
   +-- 軸B: reverse WHOIS
   |      whoxyrm -company-name "..." / WhoisXMLAPI（月500無料）
   |      ※GDPR 以降は履歴レコード頼み
   |
   +-- 軸C: TLS 証明書
   |      証明書の Subject O= / SAN に別 apex が同居するケース
   |      CT ログ横断（第3章）
   |
   +-- 軸D: favicon hash（mmh3, base64）
   |      favUp → http.favicon.hash:<hash>
   |
   +-- 軸E: 静的識別子
          copyright 文字列、アナリティクス ID、
          広告タグ ID、エラーページ固有文言
   |
   ↓
[候補 apex 群] → 帰属の確証（2軸以上の一致） → [確定 apex 群]
   ↓
vertical列挙（第3章）へ
```

軸 A〜E は**互いに独立**であることが重要である。独立した軸が2つ一致すれば偽陽性の確率は大きく下がる。逆に、「ASN が同じ」と「同じ CIDR にいる」は同じ軸の言い換えなので、2軸の一致としてカウントしてはならない。

> ⚠️ **未取得の資料**: 「Bug Bounty Recon: CIDR, ASN & Subdomain Enumeration Guide（Amrit Sinha）」は自動取得できませんでした（理由: Medium が HTTP 403 を返し、本文を取得不可）。以下のURLからご自身で直接ご覧ください: https://sinhaamrit.medium.com/bug-bounty-recon-cidr-asn-subdomain-enumeration-guide-25c447af9c40
>
> （以下は未取得資料の補足として一般知識に基づく解説です）検索インデックスから確認できる範囲では、同記事は CIDR 記法と ASN の基礎を導入したうえで、`amass intel`（ASN・CIDR を入力にした組織資産の収集）、`mapcidr` による CIDR 展開、`httpx` による生存確認・タイトル/ステータスコード/技術スタックの取得、`subfinder`/`amass` によるサブドメイン列挙、という順で vertical と horizontal の両方を通す構成を取っている。この流れ自体は本節で示したパイプラインと同じ発想であり、`amass intel` は具体的には次の形で使われる。
>
> ```bash
> # ASN を起点に組織のドメインを収集
> amass intel -asn 714
>
> # CIDR を起点に（証明書の CN/SAN から）ドメインを収集
> amass intel -cidr 17.0.0.0/16
>
> # 組織名から ASN を探す
> amass intel -org "Example Corporation"
> ```
>
> `amass intel -cidr` が機能する原理は、**レンジ内の各 IP に TLS 接続して提示された証明書の CN / SAN を読む**点にある。つまり PTR が設定されていなくても、HTTPS を提供していれば証明書からドメイン名が判明する。これは前節の軸C（TLS 証明書）と軸A（CIDR）を直結させる手法であり、逆引き DNS より発見率が高い場合が多い。ただし**レンジ内の各ホストへ実際に TCP/TLS 接続を行う能動的な動作**であるため、自組織の資産または明示的に許可された範囲に限って実行すること。
>
> なお `mapcidr` はレンジ展開のほか、`-aggregate`（多数の IP を最小の CIDR 群にまとめる）や `-slice` 機能も持ち、逆方向（IP リスト → CIDR 推定）にも使える。散在する発見 IP を集約して「未知のレンジ全体」を推定する用途で有用である。

---

### 9. 防御側の視点 ── 同じ手法が ASM になる

ここまでの手法は、そのまま**自組織の外部攻撃面管理（EASM: External Attack Surface Management）**の手順である。攻撃者が使える公開情報は防御側も使える、というより**防御側が先に使っていなければならない**。

具体的な是正アクションに翻訳すると以下になる。

- **ASN/CIDR の棚卸し**: bgp.he.net で自社 ASN の announced prefix を一覧し、IPアドレス管理台帳（IPAM）と突き合わせる。**台帳にない広告 prefix は、放置資産か設定ミスか経路ハイジャックのいずれか**である。
- **bogon / multi-origin の監視**: 自社 prefix が他 AS からも広告されていれば、経路ハイジャックの可能性。RPKI ROA（Route Origin Authorization）を発行し、正当な origin AS を暗号学的に宣言することが根本対策である。
- **PTR レコードの棚卸し**: 逆引きに社内向けホスト名（`jenkins-prod-01.corp.example.com` 等）が露出していないか確認する。**逆引きは意図せず内部命名規則を漏らす**。
- **WHOIS / RDAP の登録情報**: 登録者メールが個人アドレスになっていないか、退職者のアドレスが残っていないか（**ドメイン乗っ取りの起点になる**）。
- **買収時のセキュリティ統合プロセス**: 買収完了から資産インベントリ統合までの期間が、最も攻撃面が広がるタイミングである。デューデリジェンスの段階で horizontal列挙相当の棚卸しを行う運用にする。
- **ファビコン**: 組織ロゴのファビコンは、意図しない環境（ステージング・旧システム）を外部から名寄せさせる。これは「隠せ」という話ではなく、**外部から名寄せ可能であることを前提に、全環境を同じ基準で守る**という話である。

---

### 10. まとめとチェックリスト

**概念の整理**

- horizontal列挙の出力は **apexドメインの集合**、vertical列挙の出力は**サブドメインの集合**。順序は horizontal → vertical。
- ASN から CIDR が引けるのは、**BGP の経路広告が本質的に公開情報だから**。対象への通信は不要。
- 「BGP で広告されている」「IRR に登録されている」「RIR で割り当てられている」は**三者三様で一致しない**。網羅性を求めるなら3つとも当たる。
- CIDR の帰属は 1対1 ではない。**最長一致の原理上、大きなレンジの一部が別組織に渡っていることがある**。
- ASN 軸が有効なのは自前 IP 空間を持つ組織に限る。**クラウド上の組織には効かない**。
- reverse WHOIS は **GDPR（2018年）以降、履歴アーカイブ頼み**の補助軸。
- favicon ハッシュは **base64 文字列に mmh3** を適用した値。`base64.encodebytes()` を使うこと。フレームワーク既定アイコンは無価値。

**作業チェックリスト**

- [ ] 社名・旧社名・持株会社名・地域法人名をすべて列挙してから bgp.he.net を検索したか
- [ ] Prefixes **v6** タブを確認したか（IPv4 だけ見ていないか）
- [ ] announced と originated の差分を確認したか
- [ ] IRR（RADb）と RIR RDAP も当たり、BGP 経路表との差分を取ったか
- [ ] 取得した CIDR について、**対象組織以外のホストが含まれる可能性**を評価したか
- [ ] 逆引き・TLS 証明書・RDAP 組織名のうち **2軸以上が一致**するものだけを「資産」と扱っているか
- [ ] 大きなレンジの全件展開を避け、レート制限と自前リゾルバを設定したか
- [ ] 発見した apex がプログラムのスコープ定義に含まれるか、**検証前に**確認したか
- [ ] 能動的な検証は、自組織の資産または明示的な許可のある範囲に限定されているか

> 出典: Horizontal Enumeration — Subdomain Enumeration Guide — https://sidxparab.gitbook.io/subdomain-enumeration-guide/types/horizontal-enumeration
> 出典: Bug Bounty Methodology — Horizontal Enumeration（apex, Medium） — https://apexvicky.medium.com/bug-bounty-methodology-horizontal-enumeration-89f7cd172e6e
> 出典: Bug Bounty Recon: CIDR, ASN & Subdomain Enumeration Guide（Amrit Sinha, Medium） — https://sinhaamrit.medium.com/bug-bounty-recon-cidr-asn-subdomain-enumeration-guide-25c447af9c40
> 出典: Hurricane Electric BGP Toolkit — https://bgp.he.net/ / https://bgp.he.net/AS714

## 買収・子会社マッピングとreverse WHOIS

企業のアタックサーフェス（攻撃対象領域）は、企業自身が公開しているドメインだけでは捉えきれない。M&A（買収・合併）によって取り込まれた子会社のインフラは、多くの場合、親会社のセキュリティ基準やモニタリング体制が完全には適用されないまま残存し、レガシーなCMS、古いWordPressプラグイン、放置されたステージング環境などが温存されやすい。これは偵察（recon）における「シード拡張」（最初に把握しているごく少数のドメイン/組織名から、関連する資産の集合を広げていく作業）の中でも特に見返りの大きい工程である。本節では、（1）Amassの`intel`サブコマンドを用いたASN・組織名からのドメイン拡張と、（2）reverse WHOISおよび買収データベースを用いた組織相関の2つの技法を、原理面から解説する。

### なぜ「買収」がスコープ拡張の鍵になるのか

バグバウンティプログラムの多くは「対象組織が所有または実質的に管理するすべてのドメイン」をスコープに含める。ここで問題になるのが、企業のブランドサイト（例: `target.com`）と、買収した子会社のドメイン（例: `acquired-startup.io`）は見た目も命名規則も全く異なることが多い、という点である。買収から数年経っていても、子会社のドメインが独自のレジストラ・独自のネームサーバー・独自の運用チームのまま存在し続けるケースは非常に多い。これは以下の理由による。

- 買収統合（インフラ統合）は組織的にもコストが高く、ドメイン移行は最後に手を付けられる作業になりがち
- 子会社の開発チームがそのまま存続し、独自のCI/CDやクラウドアカウントを使い続ける
- ブランド維持のため、あえてドメインをそのまま残す経営判断がある

したがって、攻撃者（およびバグバウンティハンター）にとって、「買収履歴を辿る」ことは、企業の公式ドメイン一覧よりもはるかに広く、かつセキュリティ的に手薄な資産群を発見する近道になる。

### Amass intelによるシード拡張

[dev.to記事](https://dev.to/trumpiter/selecting-the-right-bug-bounty-targets-reconnaissance-276)および[realm3ter氏のMedium記事](https://medium.com/@realm3ter/my-recon-methodology-ep-1-bc9e6fd660ad)は共に、OWASP Amassの`intel`サブコマンドを組織名からのドメイン発見の起点として紹介している。

```bash
amass intel -org "Target Corp"
```

このコマンドの仕組みを理解するには、Amassが内部で何をしているかを把握する必要がある。`intel`サブコマンドは、単純なサブドメインブルートフォースではなく、**受動的インテリジェンス（passive intelligence）**、つまり第三者のデータソース（WHOISのメタデータ、証明書ログ、ASN登録情報など）を突き合わせて、組織に紐づく「ルートドメイン」を推定する処理を行う。具体的には次のようなデータソースを内部で問い合わせる。

1. WHOISレコードの`Registrant Organization`（登録組織名）フィールドが指定した組織名に一致するドメインを検索する（reverse WHOISに相当）
2. 組織名からASN（Autonomous System Number、後述）を検索し、そのASNに紐づくIPプレフィックス（CIDR表記のIPアドレス範囲）を取得する
3. 取得したIPプレフィックスに対してリバースDNS（PTRレコード）を解決し、ホスト名を回収する

つまり`amass intel -org`は、単一のクエリでありながら「WHOISベースの組織相関」と「ASN/CIDRベースのネットワーク相関」の2系統の発見を同時に走らせている。これが、単純なcrt.sh検索（証明書ログからのサブドメイン発見）だけでは見つからない、独立した命名規則を持つ買収先ドメインを発見できる理由である。

Amassが返す結果には、組織名で直接ヒットしたドメインに加え、それらのドメインが使っているネームサーバーやWHOISのメールアドレスも含まれる。これらの値は、次に説明するreverse WHOISのクエリに再利用する「シード」（探索の起点となる断片情報）になる。realm3ter氏の記事では、この最初の`amass intel`の結果で得られたIPレンジをメモに残し、そこから追加のルートドメインを探すための準備をする、というワークフローが紹介されている。

> 出典: My Recon Methodology ep1 — https://medium.com/@realm3ter/my-recon-methodology-ep-1-bc9e6fd660ad

### ASNとCIDRからのドメイン逆引き

ASN（Autonomous System Number）は、インターネット上で経路制御の単位となる「自律システム」を識別する番号であり、1つのASNには通常、企業や組織が保有する複数のIPアドレス範囲（プレフィックス、CIDR表記）が紐づいている。企業が自社のデータセンターやクラウド上の専有IPブロックを持っている場合、そのASNを特定できれば、DNSに登録されていない（つまり通常のサブドメイン列挙では見えない）ホストまで発見できる可能性がある。

```bash
amass intel -asn <ASN番号>
```

このコマンドは、指定したASNに属するCIDRブロック（例: `192.0.2.0/24`）の一覧を返す。ここからさらに、CIDRブロック内の各IPアドレスに対してリバースDNS問い合わせ（PTRレコード検索）を行うツール、たとえば`hakrevdns`のようなリバースDNSバルク処理ツールを使うことで、IPアドレスからホスト名を回収できる。

```bash
# CIDRブロックを1行ずつIPアドレスに展開し、リバースDNSを一括処理する典型パターン
prips 192.0.2.0/24 | hakrevdns
```

（`prips`はCIDR表記からIPアドレスを列挙するユーティリティ、`hakrevdns`は大量のIPに対して並行にPTRレコードを問い合わせるツールである。上記はdev.to記事で紹介されているASN/CIDR分析の流れを一般的なコマンド形式に落とし込んだものであり、原文はツール名の列挙にとどまるため、この具体的なパイプラインは筆者の専門知識に基づく補足である。）

なぜこれが有効なのか。DNSのAレコードやCNAMEは資産の「表向きの入口」を示すが、PTRレコード（逆引き）は「そのIPアドレスの持ち主が誰であると宣言しているか」を示す。買収された子会社が独自のIPブロックを保持している場合、そのIPブロックのPTRレコードには、買収前の社名や旧サービス名がそのまま残っていることが少なくない。ここから、公式には案内されていない旧ブランドのインフラを掘り出せる。

Hurricane Electricが提供するBGP Toolkit（`bgp.he.net`）や、Project Discovery製の`asnmap`も同様に、組織名からASNとCIDRプレフィックスを検索する用途で紹介されている。これらはAmassの`intel`が内部で行っている処理を、GUIやコマンドラインから単独で実行できるようにしたものと考えてよい。

> 出典: Selecting the Right Bug Bounty Targets & Reconnaissance — https://dev.to/trumpiter/selecting-the-right-bug-bounty-targets-reconnaissance-276

### Reverse WHOISの仕組みと限界

WHOISは本来、ドメインの登録者情報（登録者名、組織名、連絡先メールアドレス、ネームサーバーなど）を公開データベースとして提供する仕組みである。通常のWHOIS検索は「ドメイン名 → 登録情報」という方向で行うが、**reverse WHOIS**はこれを逆にし、「登録情報の断片（組織名・メールアドレス・登録者名など） → その情報を持つすべてのドメイン」という方向で検索する。

dev.to記事では、Whoxy.comのようなreverse WHOISサービスや、単純なGoogle検索の活用が紹介されている。realm3ter氏の記事では、whoisxmlapi.comの「Build current reverse whois report」機能が具体的に挙げられている。これらのサービスは、WHOISレコードを大量に収集・インデックス化したデータベースを保持しており、特定のフィールド値（たとえば`Registrant Organization: Target Corp`や`Registrant Email: admin@target.com`）を検索キーとして、一致する全ドメインを一覧で返す。

reverse WHOISが機能する原理は単純だが、いくつかの前提と限界を理解しておく必要がある。

1. **WHOISプライバシー保護（WHOIS Privacy/Proxy）の存在**：多くのレジストラは個人情報保護のため、登録者情報をプロキシサービスの情報に置き換えている。この場合、reverse WHOISで有効なのは、組織が意図的に本名・本社情報で登録している法人ドメイン（特にコーポレートドメインや、買収時にそのまま移管されていない古いドメイン）に限られる。
2. **GDPR施行後のWHOIS情報制限（2018年5月以降）**：EU圏のレジストラを含む多くのレジストリが、個人データにあたるWHOISフィールド（氏名・メールアドレス等）を一般公開しないよう変更した。したがって、現在有効なreverse WHOISのシグナルは、法人名や共通のネームサーバー、共通のメールアドレス（特に法人の技術担当メール）に絞られることが多い。
3. **登録者情報の使い回し**：同じ担当者や同じ代理店が複数の子会社ドメインを登録・管理している場合、共通のメールアドレスやネームサーバーがreverse WHOISの強力な相関シグナルになる。ネームサーバーの一致（例: 複数のドメインが同じ`ns1.target-corp.com`を使っている）は、WHOISプライバシー保護下でも観測可能なため、実務上は登録者フィールドよりもネームサーバー一致の方が有効なシグナルになることが多い。

これらの限界があるため、reverse WHOISは単体では「疑わしい候補」を提示するに留まり、最終的には候補ドメインが実際に対象組織のインフラであることを裏付ける追加確認（証明書のSAN、リバースDNSの命名パターン、ログイン画面のブランド表示など）が必要になる。

### 買収データベースを使った組織相関

WHOISやASNといった技術的なデータソースに加え、dev.to記事はCrunchbase、Tracxn、Owlerといった企業情報データベースの活用を挙げている。これらは本来ビジネス・投資分析向けのサービスだが、次の情報を持っているため偵察に有用である。

- 買収された企業名とその買収日
- 被買収企業が過去に使っていたブランド名・プロダクト名
- 資金調達ラウンドの履行企業リスト（同じ投資家グループが関与する関連企業の発見にも使える）

これらのデータベースで対象企業の「acquisitions（買収履歴）」タブを確認し、被買収企業名を得たら、その企業名を起点に、前述の`amass intel -org "<被買収企業名>"`やreverse WHOISを再度実行する。つまり、買収データベースは「探索すべき組織名のシード」を人間の調査で補完する役割を果たし、Amassやreverse WHOISは、そのシードから技術的な資産（ドメイン・IPレンジ）へと変換する役割を担う。この2つを反復的に組み合わせることが、実務上のワークフローの核になる。

```
1. Crunchbase等で「Target Corp」の買収履歴を確認
   → 被買収企業「Acquired Startup Inc」を発見
2. amass intel -org "Acquired Startup Inc"
   → 関連ルートドメインとIPプレフィックスを取得
3. 取得したドメインのWHOIS登録者メール/ネームサーバーでreverse WHOIS検索
   → さらに関連する未知のドメインを発見
4. 発見した新規ドメインについて再度1〜3を繰り返す
```

このループは理論上無限に続けられるが、実務では「対象組織が実質的にコントロールしていることを裏付けられるか」（例: 証明書、ログイン画面のブランディング、robots.txtやセキュリティ.txtでの言及）を都度確認し、確度の低い推測を積み重ねないよう注意する必要がある。証拠のない推測だけで到達したドメインをスコープ内と断定し、無許可の検証を行うことは絶対に避けるべきである。プログラムのスコープ外である可能性が高いドメインへの実際の通信・検証は行わず、公開情報の相関づけ（本節で述べた技法）にとどめ、スコープの確定はプログラムのポリシーおよび運営側への確認を優先する。

### まとめ

本節で取り上げた技法を整理すると次の通りである。

| 手法 | 入力 | 出力 | 原理 |
|---|---|---|---|
| `amass intel -org` | 組織名 | ルートドメイン | WHOIS登録組織名の一致検索（reverse WHOIS相当） |
| `amass intel -asn` | ASN番号 | CIDRブロック | ASN登録情報（RIRデータベース）の参照 |
| リバースDNS一括処理 | CIDRブロック | ホスト名 | PTRレコードの逆引き |
| Reverse WHOISサービス | メール/組織名/ネームサーバー | 関連ドメイン一覧 | WHOISレコードの転置インデックス検索 |
| 買収データベース | 企業名 | 被買収企業名 | 人間が編集した企業関係データ |

いずれも単体では確度が低い「候補」を提示するに過ぎないが、複数の手法を交差させることで、企業の公式サイトの外側に存在する、監視が行き届いていない資産群を高い確度で絞り込むことができる。これが、次章以降で扱うサブドメイン列挙やライブホスト確認の前段として、組織全体マッピングの出発点になる。

## Amassによる資産発見と継続的ASM

前節では「買収」という文脈から組織の資産を広げる考え方を扱った。本節では、その中心的なツールである**OWASP Amass**（DNS列挙とネットワークマッピングを専門とするオープンソースの偵察ツール）の内部構造を、サブコマンド単位で解説する。さらに、Amassのような「単発の資産発見」を運用として繰り返し行う**継続的ASM（Attack Surface Management、攻撃対象領域管理）**という考え方に橋渡しし、資産発見が「1回のスキャン」ではなく「継続的な監視パイプライン」として機能する理由を説明する。

Amassは単一のコマンドではなく、`amass intel`（組織・ASNからのシード発見）、`amass enum`（サブドメイン列挙とネットワークマッピング）、`amass viz`（発見結果の可視化）、`amass track`（差分検知）、`amass db`（結果データベースの操作）という5つのサブコマンド群からなる。これらは内部で共通の**グラフデータベース**（ドメイン・IP・ASN・ネームサーバーなどをノードとし、DNSレコードや所属関係をエッジとして保持するデータ構造）に結果を蓄積する点が重要である。1回のスキャン結果を捨てずにグラフとして積み上げることで、あとから「前回と今回の差分」を取ったり、「あるIPに紐づく全ドメイン」を横断的に検索したりできる。これが、単なるサブドメイン列挙ツールとASM思想を持つツールの違いである。

### `amass intel`：組織・ASNからのシード発見の仕組み

`amass intel`は、前節で紹介したreverse WHOISとASN相関の実装そのものである。Dionachのチュートリアル（対象バージョンはAmass v3系、記事公開時点のインストール手順は`go get`ベース。現行のAmass（v4系、2024年以降にOWASPからOWASP傘下のプロジェクトとしてリニューアルされ、設定ファイル形式やデータソース数が変化している）ではコマンド構文の一部・データソース数が異なる可能性があるため、実行前に`amass intel -h`で最新のフラグを確認すべきである)は、`intel`の使い方を次のように示している。

```bash
amass intel -d owasp.org -whois
```

このコマンドは、`owasp.org`のWHOIS登録情報（レジストラント組織名など）に一致する他のドメインを検索し、`appseceu.com`・`owasp.com`・`appsecasiapac.com`のような関連ドメインを返す。**なぜこれが機能するのか**という点は、reverse WHOISデータベース（多くのWHOISレコードを収集し、登録者名・メールアドレス・組織名で逆引き検索できるようにしたサービス、既定ではIPv4Infoなどが利用される）に対して、指定ドメインのWHOISレコードから抽出した組織名を投げているだけである。つまりAmass自身がWHOISデータベースを持っているわけではなく、外部データソースへの問い合わせを自動化・統合しているという点を理解しておくと、結果の網羅性がそのデータソースの品質に依存することが分かる。

組織名から直接検索する場合は次のようになる。

```bash
amass intel -org 'Example Ltd'
```

これは`111111, MAIN_PRODUCT – Example Ltd.`のようなASN（Autonomous System Number、経路制御の単位となる自律システムを識別する番号）のリストを返す。ASNが分かれば、そこに紐づくIPプレフィックス（CIDR表記のIPレンジ）へと相関を伸ばせる。

```bash
amass intel -active -asn 222222 -ip
```

`-active`フラグは、パッシブなデータソース参照だけでなく、実際にDNS解決やリバースDNS問い合わせを行うことを意味する。ここで**能動的偵察と受動的偵察の境界**を明確にしておく必要がある。パッシブ（受動的）な処理は対象ホストに一切パケットを送らず、第三者のデータベース（証明書ログ、WHOIS、パッシブDNSアーカイブなど）だけを参照するため、対象組織のログには何も残らない。一方`-active`を付けると、Amassは対象のIPやドメインに対して実際にDNS問い合わせ（および場合によってはSSL証明書の取得）を行うため、対象環境に通信の痕跡が残る可能性がある。バグバウンティのスコープ規定やプログラムポリシーで能動的スキャンが制限されている場合は、`-active`系のオプションを使う前に必ずスコープ規約を確認する必要がある。本書は防御目的の教材であり、許可されたスコープ内、かつ自組織の資産マッピングやASM運用を前提とした利用を想定する。

> ⚠️ **未取得の資料に関する補足**: Dionachの記事本文は取得できたが、記事中で言及されている一部の内部リンク（IPv4Infoの仕様詳細など）は未確認である。（以下は未取得資料の補足として一般知識に基づく解説です）reverse WHOISサービスの多くは、WHOISプロトコルの応答をクロールして独自データベース化しているため、GDPR等によるWHOIS情報のredaction（登録者情報の匿名化）が進んだ2018年以降、個人登録ドメインでは組織名フィールドが取得できないケースが増えている。この場合、reverse WHOIS単体でのシード拡張は精度が落ちるため、後述するASN相関や証明書ログ相関と組み合わせる必要がある。

> 出典: How to use OWASP Amass: An extensive tutorial — https://dionach.com/how-to-use-owasp-amass-an-extensive-tutorial/

### `amass enum`：サブドメイン列挙の3層構造

`amass enum`は、Amassの中で最も頻繁に使われるサブコマンドであり、パッシブ・アクティブ・ブルートフォースの複数の技法を1つのコマンドに統合している。

**パッシブモード（高速・対象に痕跡を残さない）**

```bash
amass enum -passive -d owasp.org -src
```

`-passive`は、DNS解決による検証を一切行わず、証明書ログ（Certificate Transparency、CT）・パッシブDNSアーカイブ・検索エンジンキャッシュなど、既に他者が観測した記録からサブドメイン名の候補を収集するだけの動作をする。`-src`フラグを付けると、各サブドメインを「どのデータソースが発見したか」（ThreatCrowd、BufferOver、Crtshなど）が表示される。**なぜ`-src`が実務上重要か**というと、データソースごとに鮮度・精度が異なるため、あるデータソースだけが返した孤立した結果は誤検知（すでに存在しないサブドメインなど）の可能性が高く、複数のデータソースが一致して返した結果ほど信頼度が高いと判断できるからである。Amassは内部で55種類以上のデータソース（記事執筆時点でAlienVault、ArchiveIt、ArchiveToday、Arquivo、Ask、Baidu、BinaryEdge、Bing、BufferOver、Censys、CertSpotter、CIRCL、CommonCrawl、Crtshから、ViewDNS、VirusTotal、Wayback、WhoisXMLまで）を並行して問い合わせ、結果をグラフに統合する。データソースの数と種類はAmassのバージョンやAPIキー設定によって変動するため、教科書的な数値としてではなく「複数の独立したデータソースを束ねる」という設計思想の方を覚えておくべきである。

**アクティブモード（DNS解決による検証を含む、包括的な列挙）**

```bash
amass enum -active -d owasp.org -public-dns -brute \
  -w /root/dns_lists/deepmagic.com-top50kprefixes.txt \
  -src -ip -dir amass4owasp -config /root/amass/config.ini \
  -o amass_results_owasp.txt
```

各フラグの意味と、それが「なぜ結果の質を変えるか」を分解する。

- `-active`：発見した候補ドメインに対して実際にDNS解決を行い、存在しないドメイン（NXDOMAIN）を除外する。パッシブモードは候補の「可能性」を返すだけなので、実在確認にはこのステップが必須になる。
- `-public-dns`：`public-dns.info`が公開している公開DNSリゾルバのリストを取得し、それらを問い合わせ先として利用する。単一のリゾルバに大量の問い合わせを送ると、レート制限やブラックリスト化を招くため、多数のリゾルバに問い合わせを分散させることで、実効的なスループットを上げつつ検知されにくくする。これは後述するmassdns/purednsのような専用ブルートフォースツールと共通する設計思想である。
- `-brute`：DNSブルートフォース（ワードリストの各単語を`<単語>.<対象ドメイン>`という形でDNS問い合わせし、応答があれば実在するサブドメインとみなす手法）を有効化する。
- `-w <path>`：ブルートフォースに使うカスタムワードリストを指定する。ワードリストの質（頻出するサブドメイン名を収録しているか）が、ブルートフォースで発見できる資産数を直接左右する。
- `-src` / `-ip`：それぞれ発見元データソースと、解決されたIPアドレスを結果に含める。IPアドレスまで表示させることで、後段のASN相関やクラウドプロバイダ判定（IPレンジからAWS/GCP/Azure等を推定する）に使う入力データを得られる。
- `-dir amass4owasp`：結果を保存するグラフデータベースのディレクトリを指定する。このディレクトリを指定し続けることで、後述の`amass track`による差分比較が可能になる。
- `-config`：APIキーなどを含む設定ファイル（`config.ini`または`config.yaml`）を指定する。多くのデータソース（Censys、BinaryEdge、VirusTotalなど）は無料利用枠に制限があり、APIキーを設定することでレート制限が緩和され、より多くの結果を取得できる。設定ファイルを使わない場合、無料枠のデータソースのみが動作し、結果が大きく制限される点に注意が必要である。
- `-o`：結果をテキストファイルに書き出す。

さらに、Amassは正規表現的な「マスク」を使ったパターンベースのブルートフォースも提供する。

```bash
amass enum -d owasp.org -norecursive -noalts -wm "zzz-?l?l?l" -dir amass4owasp
```

`-wm`のマスク記法はHashcatのマスク攻撃（パスワード解析でよく使われる、文字クラスをプレースホルダーで指定する記法。`?l`は英小文字1文字を表す）を借用しており、この例は`zzz-[a-z][a-z][a-z].owasp.org`という形式（例: `zzz-abc.owasp.org`）に一致する候補を総当たりする。**なぜ単語ワードリストだけでなくマスクが有効か**というと、命名規則が分かっている環境（例: 環境ごとに`env-XXX`のような3文字コードを付与する社内規約がある場合）では、汎用ワードリストより遥かに的を絞った、かつ網羅的な探索が可能になるためである。`-norecursive`（サブドメインのサブドメインをさらに探索しない）と`-noalts`（permutation/alteration、つまり既知のサブドメイン名を変形して新しい候補を作る処理を無効化する）を付けることで、探索範囲をこのマスクパターンのみに絞り、無駄な問い合わせを減らしている。

> 出典: How to use OWASP Amass: An extensive tutorial — https://dionach.com/how-to-use-owasp-amass-an-extensive-tutorial/

### Intigritiの視点：実務でのAmass運用の要点

Intigritiのブログ記事は、バグバウンティハンター向けにAmassの実践的な使い方をより簡潔にまとめている。インストール手順としては、GitHubリリースページから対象OS向けのバイナリをダウンロードし、チェックサム検証（`shasum -c amass_checksums.txt | grep amass_linux_amd64.zip`のような形で、ダウンロードしたzipのSHA-256ハッシュが公開されている値と一致するか確認するコマンド）を行った上で展開するという、改ざんされたバイナリを実行しないための基本的なセキュリティ手順が紹介されている。**なぜチェックサム検証が重要か**というと、サードパーティのミラーや古いバイナリ配布サイトから偵察ツールを入手すると、マルウェアが混入したバイナリを実行してしまうリスクがあるためであり、これはツール自体の技術解説というより、偵察ツール運用における衛生管理の基本として押さえておきたい点である。

Intigritiの記事は`intel`モジュールについて、Dionach記事とほぼ同じ機能（reverse whois相当のドメイン発見、`-org`によるASN検出）を紹介しつつ、SSL証明書からのドメイン抽出（いわゆる"SSL grabbing"）にも触れている。

```bash
amass intel -active -addr 8.8.8.8
```

これは、指定したIPアドレスに対して実際にTLSハンドシェイクを行い、返されたSSL/TLS証明書のSubject Alternative Name（SAN、証明書が有効な複数のホスト名を列挙するフィールド）からドメイン名を抽出する処理である。**仕組みレベルで見ると**、これはある1つのIPアドレスに複数のサービスがホストされている（共有ホスティングやリバースプロキシ配下にある）ケースで特に有効である。DNSのAレコードは「ドメイン名からIPへ」の一方向の対応しか示さないが、実際にそのIPに接続してTLS証明書を取得すれば、そのIPが実際にどの複数のホスト名向けに証明書を発行されているかが分かる。これは、DNSレコードには表れないが、証明書には表れる関連性を掘り出す手法であり、前述のPTRレコード相関と並ぶ「IPアドレスを起点にした逆引き」の一種と位置づけられる。

`enum`モジュールについては、`-aw <PATH>`（追加ワードリストの指定）や`-df`（複数のルートドメインをファイルから一括入力する）といった、大量ドメインを対象にする際の運用オプションが紹介されている。バグバウンティでは、1つのプログラムが数十〜数百のドメインをスコープに含めることも多く、これらのオプションはドメインを1つずつ手動で指定する手間を省く実務上の工夫である。

> ⚠️ **未取得の資料の可能性**: 本節執筆時点でIntigritiの記事本文は取得できたが、記事内で紹介されているツール比較表やスクリーンショットの細部（UIの見た目など）は文字情報として抽出できなかったため、必要であれば原文を直接参照してほしい: https://www.intigriti.com/researchers/blog/hacking-tools/hacker-tools-amass-hunting-for-subdomains

> 出典: Hacker tools: Amass – hunting for subdomains — https://www.intigriti.com/researchers/blog/hacking-tools/hacker-tools-amass-hunting-for-subdomains

### `amass track`と`amass db`：差分検知とデータの再利用

単発の`amass enum`だけでは、「発見した資産のリスト」しか手に入らない。しかし攻撃対象領域は静的ではなく、企業が新しいサービスをデプロイしたり、開発者が一時的なステージング環境を公開したりすることで日々変化する。ここで重要になるのが、Amassが結果をグラフデータベースとして`-dir`で指定したディレクトリに蓄積している、という設計である。

```bash
amass track -config /root/amass/config.ini -dir amass4owasp -d owasp.org -last 2
```

このコマンドは、同じ`-dir`ディレクトリに保存された直近2回分（`-last 2`）のenum結果を比較し、新規に出現したサブドメイン（出力中で`Found`という接頭辞で示される行）と、消滅したサブドメインを差分表示する。**なぜ差分検知が資産発見における「武器」になるのか**を仕組みから説明すると、新しく出現したサブドメインは、多くの場合デプロイ直後でまだ十分にセキュリティレビューされていない、あるいは一時的な検証用途で放置される可能性が高い。攻撃者・バグバウンティハンターにとって、こうした「生まれたばかりの資産」は最も脆弱性が残っている確率が高い対象であり、定期的に`track`を実行し続けることで、この短い時間窓を捉えられる。

`amass db`は、このグラフデータベースを直接操作するためのサブコマンドである。

```bash
amass db -dir amass4owasp -list
amass db -dir amass4owasp -d owasp.org -enum 1 -show
```

前者はディレクトリ内に保存されている過去の全enum実行の一覧を表示し、後者は特定の実行番号（`-enum 1`）の結果を再表示する。これにより、APIキーのレート制限を消費する再スキャンをせずに、過去の結果を何度でも参照・加工できる。さらに`amass viz -d3 -dir amass4owasp`のように、グラフをD3.js（ブラウザ上でインタラクティブなデータ可視化を描画するJavaScriptライブラリ）のフォースダイレクテッドグラフ（ノード間の関係性をばねモデルのようにシミュレートして配置する可視化手法）として書き出すこともできる。大量のサブドメインとその依存関係を視覚的に俯瞰することで、命名規則のパターンや、特定のインフラ（同一のネームサーバー群など)にクラスタリングしている資産群を発見しやすくなる。

Dionachの記事では、これらを組み合わせた簡易な自動化例として、cronで定期的に`amass enum`を実行し、その結果を`amass track`で比較して新規サブドメインが見つかった場合にPushover API（プッシュ通知サービス）経由でアラートを送るbashスクリプトが紹介されている。これは、次に述べる「継続的ASM」という考え方を、個人・小規模チームのレベルで簡易に再現した実装例だと理解するとよい。

> 出典: How to use OWASP Amass: An extensive tutorial — https://dionach.com/how-to-use-owasp-amass-an-extensive-tutorial/

### 継続的ASM（Attack Surface Management）という考え方

ここまで見たAmassの`intel`/`enum`/`track`/`db`の連携は、「1個人が手動で組み立てる継続的資産発見パイプライン」の縮図である。これを商用のASM（Attack Surface Management、攻撃対象領域管理）プラットフォームがどのように「サービス」としてスケールさせているかを見ることで、資産発見という作業の本質的な目的がより明確になる。

Assetnote（現Searchlight Cyber傘下のSearchlight Exposure）のプラットフォーム説明では、ASMの目的を「攻撃者が組織を標的にする前に、露出（exposure）を特定・検証すること」と位置づけている。対象範囲は「Webアプリケーション、API、クラウド基盤、DNS、証明書、サブドメインなど、外部攻撃対象領域全体にわたって発見・検証される」資産であるとされ、これはAmassの`intel`（組織・ASN起点の発見）と`enum`（DNS/サブドメイン起点の発見）を合わせた範囲とほぼ一致する。つまり、商用ASMがカバーする発見対象の種類は、Amassのようなオープンソースツールが実装している技法の延長線上にあり、規模とデータソースの網羅性、そして自動化の度合いが異なるだけだと理解できる。

Assetnoteの説明で技術的に重要なのは、**発見だけでなく検証（validation）**を明確に分離している点である。プラットフォームは「稼働中のバージョンを含めて資産をクロスリファレンスし、露出が実際に成立しているかどうかを検証する」と説明されている。**なぜこの分離が重要か**を仕組みレベルで考えると、Amassの`enum`が返すのは「このサブドメインが存在し、このIPに解決される」という事実だけであり、それが実際に脆弱であるかどうかは別の話である。ASMプラットフォームは、発見した資産に対してさらにバージョン検出（HTTPレスポンスヘッダやフィンガープリンティングによるソフトウェアバージョンの推定）やCVEデータベースとの突き合わせを行い、「単に存在する」資産と「実際に悪用可能な露出を持つ」資産を区別することで、通知の誤検知（false positive）を減らしている。

もう一つの重要な設計要素は、スキャン頻度である。Assetnoteの説明では「環境全体を1時間ごとにスキャンする」とされ、これによって最大露出時間（脆弱な資産が公開された状態から検知されるまでの時間）を「24時間から1時間に短縮する」という効果が述べられている。**この数値が意味することを仕組みから解釈すると**、Amassのようなツールを手動または日次cronで実行する運用では、新規資産のデプロイから検知までに最大24時間程度のタイムラグが生じる。攻撃者が新規デプロイされたばかりの脆弱なステージング環境を発見してから実際に悪用するまでの時間は、しばしばこれより短い。したがって、継続的ASMという発想の本質は「発見のロジック自体」ではなく「発見をどれだけ高頻度・自動で繰り返せるか」という運用面のスケールにある。個人のバグバウンティハンターであっても、`amass enum`と`amass track`をcronで日次〜時間単位で回し、差分が出た瞬間に通知を受け取る仕組みを組めば、同じ設計思想を小規模に再現できる。

さらにAssetnoteの説明では、修復後の即時再検証（次回の定期スキャンを待たず、修正が入った直後にすぐ元の悪用手法を再実行して修正が有効かを確認する仕組み）にも触れられている。これは資産発見・ASMの範囲を超えた脆弱性管理の話ではあるが、「発見→検証→通知」のループを継続的に回し続けるというASMの設計思想が、資産発見だけでなく修復確認にも適用されていることを示す好例である。

> 出典: Assetnote（Searchlight Cyber）— Continuous Asset Discovery — https://slcyber.io/assetnote （元URL https://www.assetnote.io/platform/asset-discovery は本ページへリダイレクトされる）

### まとめ：Amassの技法とASM思想の対応関係

本節で見た内容を整理すると、次のような対応関係になる。

| Amassの機能 | 仕組み | ASMにおける位置づけ |
|---|---|---|
| `amass intel -whois` / `-org` | reverse WHOIS・ASN相関によるシード拡張 | 資産インベントリの初期構築 |
| `amass enum -passive` | CT/パッシブDNS等の受動的データソース集約 | 低コスト・低検知リスクな継続監視の土台 |
| `amass enum -active -brute` | DNS解決検証＋ワードリスト/マスクブルートフォース | 資産の実在確認（validation）の一部 |
| `amass track` | グラフDBの差分比較 | 継続的モニタリングの中核（新規露出の検知） |
| 商用ASM（Assetnoteなど） | 上記を高頻度・大規模・脆弱性検証込みで自動化 | 発見から検証・通知までのループの完全自動化 |

個人のバグバウンティハンターにとっての実務的な教訓は、「Amassを1回実行して終わり」にせず、`-dir`で結果を蓄積し、`track`で差分を取り、通知の仕組みと組み合わせることで、商用ASMプラットフォームと同じ設計思想（継続的な発見と検知）を、無償かつ小規模な環境でも再現できるという点にある。次節以降では、この資産発見の基盤の上に、サブドメイン列挙そのものをさらに深掘りする技法（passive/active/permutationの3層構造）を扱う。

---

[← 第1章 Reconのマインドセットと全体像](01-mindset.md) ｜ [📖 目次](index.md) ｜ [第3章 サブドメイン列挙を深く →](03-subdomain-enumeration.md)
