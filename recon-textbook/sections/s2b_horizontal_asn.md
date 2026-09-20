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
