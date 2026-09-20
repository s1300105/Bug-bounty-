# 第4章 インターネット規模のデータソース活用


## Shodan/Censys/FOFA/Netlasのクエリ技法

### この節のねらいとスコープ

本節は、インターネット全域を常時スキャンして結果をインデックス化している「スキャンデータベース（インターネット規模の検索エンジン）」——Shodan・Censys・FOFA・Netlas——を、**自組織のアタックサーフェス（攻撃面：外部から到達可能な資産の総体）を棚卸しするため**に使いこなす技法を扱う。

前提として本書のスコープ規約を再掲する。ここに書くクエリはすべて **すでに公開されたスキャン結果を検索するだけ** の操作であり、対象ホストへパケットを送らない。実在サービスへの無許可の検証手順、エクスプロイトの実行手順、特定ラボの攻略は一切書かない。読者が自分の権限下にある資産、あるいは明示的に許可されたスコープに対してのみ適用することを想定する。

---

### 4a.1 原理: なぜ「検索」でホストが見つかるのか

#### スキャンDBのデータモデル

これらのサービスは共通して次のパイプラインを回している。

1. **全IPv4空間（約42.9億アドレス）への継続的ポートスキャン**。ZMap/Masscan系の非同期SYNスキャナが、ステートレスにSYNを撒き、SYN/ACKが返ったものだけをフォローアップする。
2. **プロトコルハンドシェイクとバナー取得**。開いていたポートに対し、HTTPなら`GET /`、TLSならClientHello、SSHならバージョン交換、というようにプロトコル固有の「一言」を投げ、返ってきた生レスポンス（バナー）を保存する。
3. **パース（構造化）**。生バナーからHTTPヘッダ、HTMLの`<title>`、X.509証明書のSubject/SAN、SSHのホスト鍵フィンガープリント等を抽出し、JSONドキュメントに展開する。
4. **全文検索エンジンへのインデックス投入**。Censys・Netlasは Elasticsearch/Lucene 系、Shodanは独自のインデックス、FOFAも独自実装。ここがクエリ構文の差を生む根本原因である。

つまり**クエリ言語の違いは、裏側のドキュメント構造とインデクサの違いの写し鏡**だ。これを理解していないと、あるエンジンで効いたクエリを別エンジンに機械的に移植して空振りする。

#### ドキュメントの粒度が決定的に違う

| エンジン | 1ドキュメント = 何か | 帰結 |
|---|---|---|
| Shodan | **1つのサービス（IP:ポート）のバナー** | 複数フィルタは「同じサービス」に対するANDとして働く |
| Censys | **1つのホスト（IP）**。その中に`services[]`が入れ子 | フィルタ同士は既定で「同じホスト内のどこか」にマッチ。サービス単位でANDしたいなら`services: (...)`で括る必要がある |
| FOFA | **1つのアセット（IP:ポート、またはドメイン:ポート）** | Shodanに近いフラット構造。`&&`が同一アセット内のAND |
| Netlas | **1つのレスポンス（プロトコル応答）** | `datatype`（response / domain / cert / whois）でインデックス自体を切り替える |

この「入れ子かフラットか」の差が、後述するCensysの`services: (...)`記法が必要になる理由そのものである。

> 用語: **バナー**とは、サービスが接続時に自発的に返す識別文字列のこと（例: `SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.4`）。HTTPの場合はレスポンスヘッダ＋本文の冒頭がこれに相当する。

---

### 4a.2 起点1: 組織・ASNから引く

最も素直な入口は「この会社の名前でIPを引く」である。Intigritiのガイドは Shodan と Censys の対応表を提示している。

```text
# 組織名
Shodan : org:"Intigriti"
Censys : autonomous_system.organization:"Intigriti"

# ASN（自律システム番号）
Shodan : asn:AS1234
Censys : autonomous_system.asn: AS1234
```

#### なぜこれは当たるのか、そして**なぜ当たらなくなったのか**

`org:`フィルタの中身は、スキャン結果そのものではなく **IPアドレスから引いた WHOIS / RIR（地域インターネットレジストリ）の登録情報、あるいはBGPで広報されているASNのorganization名** である。つまり「そのIPブロックを誰が所有登録しているか」という**外部データの後付け結合**だ。

ここから2つの重要な帰結が出る。

1. **自社でIPブロックとASNを持つ組織にしか効かない。** クラウド移行済みの組織では、`org:`は`Amazon.com, Inc.`や`Google LLC`になり、対象組織名では1件もヒットしない。2020年代の実務では、`org:`が有効なのは金融・通信・製造・大学・官公庁など自前ASを持つ組織に偏る。
2. **登録情報は陳腐化する。** M&Aで移管されたブロックの登録名が旧社名のまま残ることがあり、逆にこれが「忘れられた資産」を掘り当てる手がかりにもなる。

> **実務上の示唆（防御側）**: 自組織のASNを`asn:`で引き、返ってきたIPレンジを資産管理台帳（CMDB）と突き合わせる。台帳にないIPが出たら、それはシャドーIT（管理外資産）候補である。これがスキャンDB活用の最も基本的で最も価値のある使い方だ。

HTTPステータスと組み合わせて「生きているWebサービス」に絞るのも定番である。

```text
Shodan : http.status:200 org:"Intigriti"
Censys : services.http.response.status_code:200 AND autonomous_system.organization: "Intigriti"
```

> 出典: Complete guide to finding more vulnerabilities with Shodan and Censys — https://www.intigriti.com/researchers/blog/hacking-tools/complete-guide-to-finding-more-vulnerabilities-with-shodan-and-censys

---

### 4a.3 起点2: TLS証明書 — 現代の本命

クラウド化で`org:`が死んだ後、**組織と資産を結びつける最も強い紐帯はTLS証明書**になった。なぜなら証明書は「そのホストがどのドメインを名乗る権利を持つか」をCAが署名して保証したものであり、IPの所有者が誰であろうと（＝どのクラウドに置かれていようと）組織のドメイン名がそこに刻まれているからだ。

#### 証明書のどこを見るか

X.509証明書のうち、検索で効くのは主に2箇所。

- **Subject CN（Common Name）**: 歴史的なホスト名欄。RFC 2818以降は非推奨だが、いまも広く埋まっている。
- **SAN（Subject Alternative Name）**: 現代の正式なホスト名欄。`dNSName`のリストとして複数ドメインを持てる。**マルチドメイン証明書のSANは、組織の資産リストをそのまま漏らしている**に等しい。

各エンジンでの書き方:

```text
Shodan : ssl.cert.subject.CN:"intigriti.com"
Censys : services.tls.certificate.names:"intigriti.com"
FOFA   : cert="intigriti.com"
Netlas : certificate.subject.common_name:"intigriti.com"
```

ここで**Censysの`certificate.names`が実質的に最強**である点に注意したい。このフィールドはCNとSANの**両方を正規化して統合した配列**なので、CN欄が空でSANにしか入っていない現代的な証明書も取りこぼさない。Shodanの`ssl.cert.subject.CN`はCN欄のみなので、Let's Encrypt系の新しめの証明書では漏れが出うる。ShodanでSANを狙うなら`ssl.cert.extensions`系や、後述の全文マッチに逃がす。

#### あいまい一致という抜け道

0x00secの記事は、パース済みフィールドではなく **証明書全体に対する粗い全文マッチ** を使う`ssl:`フィルタを挙げている。

```text
ssl:"Microsoft"
```

これは「証明書のどこか（Subject、Issuer、Organization欄など）に Microsoft という文字列が出る」という意味で、CNが`*.azurewebsites.net`のようにブランド名を含まない場合でも、Organization欄（`O=Microsoft Corporation`）で拾える。**パース済みフィールドで漏れたら、粗いフィルタに落とす**——これが証明書探索の基本動作である。

> 出典: Using search engines for fun and bounties — https://archive.0x00sec.org/t/using-search-engines-for-fun-and-bounties/23832

#### 期限切れ証明書 = 「忘れられたホスト」の指紋

Intigritiのガイドが挙げる中で、防御的価値が最も高いのがこれだ。

```text
Shodan : org:<company> ssl.cert.expired: true
Censys : autonomous_system.organization:"<company>"
         AND services.tls.certificate.parsed.validity_period.not_after: 2024-11-17
```

**なぜ期限切れ証明書が重要な指紋になるのか。** 現代のTLS証明書は Let's Encrypt なら90日、商用CAでも最長398日（2020年9月以降のCA/Browser Forum規定）で失効する。自動更新（ACME）が回っている運用中のホストで証明書が切れることは、まずない。したがって **証明書が期限切れのまま放置されているホストは、更新パイプラインから外れた＝誰も見ていない資産** である確率が非常に高い。そしてそういうホストは、同じ理由でOSパッチもアプリのアップデートも止まっている。

Censys側の`not_after`（有効期限終了日時）は日付型なので、範囲指定が書ける。運用では固定日ではなく範囲で回すほうが実用的だ。

```text
autonomous_system.organization:"<company>"
AND services.tls.certificate.parsed.validity_period.not_after: [* TO 2026-09-21]
```

> ⚠️ 注意（陳腐化対策）: Censysは2023〜2025年にかけてスキーマとクエリ言語を改訂しており（旧IPv4インデックス→Censys Search 2.0、さらに Censys Platform への移行）、`services.tls.certificate.parsed.*`以下のパス名やレガシー構文の可否はプラン・世代によって異なる。**フィールド名は必ず当該時点の公式フィールドリファレンス（検索画面のフィールド補完）で確認すること。** 本書のパスは記事執筆時点（2024年前後）の表記である。

#### JARM: 証明書の「外側」でサーバを指紋化する

証明書の中身ではなく、**TLSサーバがClientHelloにどう応答するかの癖**をハッシュ化したものがJARM（Salesforce, 2020）である。10種類の細工したClientHelloを送り、返ってきたServerHelloの選択暗号スイート・拡張の並びを62文字のハッシュにまとめる。

同一のTLSスタック・同一設定で立てられたサーバは同じJARMを返すため、**証明書を付け替えてもインフラの同一性が追える**。Shodanは`ssl.jarm:`、FOFAは`jarm=`で引ける。脅威インテリジェンス側でC2サーバ追跡に使われる技術だが、防御側では「同一テンプレートから立てられた自社サーバ群の網羅的な洗い出し」に使える。

---

### 4a.4 起点3: Faviconハッシュ — 仕組みを知らないと必ず外す

#### Shodan / FOFA が使うハッシュの正体

`http.favicon.hash:` は、**favicon.ico のバイト列そのもののハッシュではない**。ここを誤解して手元で`md5sum favicon.ico`しても絶対に一致しない。実際の計算手順は次の通り。

```python
import requests, mmh3, base64

res  = requests.get('https://example.com/favicon.ico')
b64  = base64.encodebytes(res.content)   # ← 重要: encodebytes であること
print(mmh3.hash(b64))                    # 符号付き32bit整数が出る
```

**なぜこうなるのか**を分解する。

1. **`base64.encodebytes`（旧`encodestring`）を使う。** これはPython標準の挙動として **76文字ごとに改行(`\n`)を挿入し、末尾にも改行を付ける**。`base64.b64encode`（改行なし）とは出力が違う。Shodanの実装がこの関数を使っていたため、改行入りの文字列がハッシュ対象として事実上の標準になった。ここを`b64encode`にすると値が変わり、一切ヒットしない。
2. **MurmurHash3（mmh3）の32bit版**を使う。暗号学的ハッシュではなく高速な非暗号ハッシュで、Pythonの`mmh3.hash()`は**符号付き32bit**を返す。だから`-247388890`のような**負の値**が普通に出る。Shodan/FOFAに入力する際はこの符号付きの値をそのまま使う。符号なし（`mmh3.hash(b64, signed=False)`）に変換してしまうと別の数値になり、ヒットしない。

```text
Shodan : http.favicon.hash:-247388890
FOFA   : icon_hash="-247388890"
```

#### Censys / Netlas は別のハッシュを使う

ここが移植で最も事故る部分である。

```text
Censys : services.http.response.favicons.md5_hash="<32桁hex>"
         （世代により services.http.response.favicons.hashes に
           "sha256:..." 等のプレフィックス付きで格納される場合もある）
Netlas : http.favicon.hash_sha256:"ebaaed8ab7c21856f888117edaf342f6bc10335106ed907f95787b69878d9d9e"
```

Censysは**MD5**、Netlasは**SHA-256**で、いずれも**生バイト列**に対して計算する（base64も改行も挟まない）。つまり **1つのfaviconに対して、最低3種類の異なるハッシュ値を計算しておく必要がある**。FaviconLocatorのような補助ツールが存在するのは、まさにこの非互換を吸収するためだ。

#### faviconハッシュの本質的な脆さ

mmh3もMD5もSHA-256も、**1バイトでも違えば全く別の値**になる。したがって:

- 製品がバージョンアップでfaviconを差し替えれば、ハッシュは変わる。**ハッシュは事実上「製品×バージョン世代」の指紋であり、製品の指紋ではない。**
- CDN/WAFが画像を再圧縮・最適化すると、同じ見た目でもハッシュがずれる。
- 逆に、**自社ブランドのfaviconを使ったフィッシングサイトの発見**には極めて強い。自社faviconのハッシュで全インターネットを引き、自社管理外のホストが出たらブランド詐称の候補である。これが防御側にとっての主用途だ。

Netlasが持つ`http.favicon.perceptual_hash`（知覚ハッシュ）は、この脆さへの回答である。画像を縮小・グレースケール化して低周波成分を取り出すため、**再圧縮やわずかな色違いを吸収して「見た目が似ている」でマッチする**。ブランド詐称の検出では完全一致ハッシュよりこちらが効く。

---

### 4a.5 起点4: HTTPレスポンスの中身で引く

証明書もfaviconも使えない相手には、レスポンス本文・タイトル・ヘッダを直接引く。

#### HTML本文の「消し忘れ」を鍵にする

```text
Shodan : http.html:"© copyright <company>"
Censys : services.http.response.body:"© copyright <company>"
FOFA   : body="© copyright <company>"
Netlas : http.body:"© copyright <company>"
```

**原理**: コピーライト表記、Google Analytics/GTMのトラッキングID（`UA-XXXXXX`、`G-XXXXXXX`）、共通ヘッダ・フッタのテンプレート文字列は、**組織内で複製されて使い回される**。開発者は証明書やDNSは切り替えても、HTMLのフッターまでは消さない。結果として、これらは**IP所有者にもドメイン名にも依存しない組織の指紋**として機能する。ステージング環境やマーケ部門が勝手に立てたLPが、これで釣れる。

0x00secの記事も同趣旨で`http.html:'unique footer text'`を挙げている。**「ユニークであること」が条件**で、汎用的なフレーズを入れるとノイズで埋まる。

#### タイトルで「入口」を洗い出す

```text
Shodan : org:<company> http.title:Login,Log in,Register,Signin,"Sign in","Sign up"
Censys : autonomous_system.organization:"<company>"
         AND services.http.response.html_title: {"Login", "Log in", "Register", "Signin", "Sign in", "Sign up"}
```

Shodanのカンマ区切りは **OR** として解釈される（`http.title:a,b` = aまたはb）。Censysの`{...}`は集合リテラルで、これもOR。書式は違うが意味は同じだ。

ディレクトリリスティングの検出も定番である。

```text
Shodan : org:<company> http.title:"Index of"
Censys : autonomous_system.organization:"<company>" AND services.http.response.html_title: "Index of *"
Netlas : http.title:"index of"
```

`Index of` は Apache の `mod_autoindex` や nginx の `autoindex on;` が生成する既定ページのタイトルで、**ディレクトリ一覧が意図せず公開されている**ことを意味する。防御側にとっては即座に直すべき設定ミスの発見器である。

#### 非標準ポートに潜むWeb

```text
Shodan : org:<company> http.status:200,404 -port:80 -port:443 -port:8080 -port:8443
Censys : autonomous_system.organization:"<company>"
         AND services: (service_name: HTTP and not port: {80, 443, 8080, 8443})
```

**Shodanの`-`は否定**（除外）。Censysは`not`＋集合リテラル。ここで前述のドキュメント構造の話が効いてくる——Censysで`services.service_name: HTTP and not services.port: 80`と書くと、**「HTTPを喋るサービスがあり、かつ80番でないサービスもどこかにある」ホスト**が全部ヒットしてしまう（ホスト単位のドキュメントなので、2つの条件が別々のサービスで満たされてよい）。これを防ぐのが`services: ( ... )`という**ネストされたスコープ指定**で、括弧内の条件を**同一サービスオブジェクト内で**評価させる。**Censysで複数のサービス条件をANDするときは、必ず`services: (...)`で括る。** これはCensys構文で最も重要な作法である。

なぜ非標準ポートを狙うのか: 管理画面、社内ツール、開発サーバは慣習的に 8000/3000/5000/7001/9090 などに置かれる。そして**WAFやリバースプロキシは 80/443 にしか置かれていないことが多い**。同じアプリが素の状態で別ポートから見えている、という構成事故の発見が目的である。

#### リダイレクトを追う

```text
Shodan : org:<company> http.status:301,302,303
Censys : autonomous_system.organization:"<company>" AND services.http.response.status_code: [300 to 399]
```

Censysの`[300 to 399]`は**範囲クエリ**（Lucene構文由来）。リダイレクト先の`Location:`ヘッダには、**まだ知らない内部ドメイン名**がしばしば書かれている。裸IPにアクセスするとVHost設定によって正規ドメインへ301される——これがIPとドメインの紐付けを与える。

> 出典: Complete guide to finding more vulnerabilities with Shodan and Censys — https://www.intigriti.com/researchers/blog/hacking-tools/complete-guide-to-finding-more-vulnerabilities-with-shodan-and-censys

---

### 4a.6 起点5: 製品・バージョン・CVE

```text
# 製品名
Shodan : org:<company> product:jenkins
Censys : autonomous_system.organization:"<company>" AND services.software.vendor: jenkins

# 技術コンポーネント（Wappalyzer相当の判定結果）
Shodan : org:<company> http.component:php
Censys : autonomous_system.organization:"<company>" AND services.software.product:"PHP"

# バージョンまで指定
Shodan : product:"Apache Tomcat" version:"7.0.82"

# CVE（Shodanでは上位プラン限定）
Shodan : vuln:cve-2010-2730
Netlas : cve.name:CVE-2022-22965
Netlas : cve.severity:CRITICAL AND cve.has_exploit:true
```

**原理と限界**: `product`/`version`は、スキャナが取得したバナー文字列に対して**正規表現ベースの指紋データベース**（nmapのservice probesに相当するもの）を当てた結果である。したがって:

- **バナーが正直な場合にしか当たらない。** `ServerTokens Prod`や`server_tokens off;`でバージョンを隠せば、`version:`では引けなくなる。
- **逆に言えば「バナーに書かれたバージョン」であって「実際に動いているバージョン」ではない。** ディストリビューションのバックポート修正（Debian/RHELが上流の古いバージョン番号を保ったままセキュリティ修正だけ取り込む運用）により、`version:`で古く見えるホストが実は修正済みということが常態的に起きる。**`vuln:`や`cve.name:`のヒットは「脆弱性がある」ではなく「脆弱性がある可能性を示唆するバナーである」と読むのが正しい。** これは防御側のトリアージでも攻撃側の優先度付けでも等しく重要な読み替えだ。

Netlasの`cve.*`は`severity`・`base_score`（CVSS基本値）・`has_exploit`（公開エクスプロイトの有無）まで持つため、**自組織のスコープ内で「重大かつ実証コードが存在する」ものだけを抽出する**という、パッチ優先度付けの実務に直結した使い方ができる。

> 出典: Netlas Responses Field Reference — https://docs.netlas.io/knowledge-base/field-reference/responses/

#### 製品固有ヘッダを指紋にする

0x00secの記事は、Cisco ASA/Firepower のWebVPNが返す固有のSet-Cookieヘッダを指紋に使う例を挙げている。

```text
"Set-Cookie: webvpn;" org:"Target"
ssl:"Target" "Set-Cookie: webvpn;"
```

**原理**: 製品が独自に発行するCookie名、独自ヘッダ（`X-Jenkins:`、`X-Powered-By:`、`X-Drupal-Cache:`など）は、タイトルやfaviconよりも改変されにくい。バージョン番号を隠しても、Cookie名までは変えない。**「変えにくい・消しにくいものを指紋にする」** のが指紋選択の原則である。

なお同記事は続けて当該CVEの検証コマンドを掲載しているが、**本書はスコープ規約に従いエクスプロイト手順を再掲しない。** 防御側の読み方はこうだ——この種のクエリでヒットした自社ホストがあれば、それは「インターネットから素のASA管理面が見えている」という構成情報であり、パッチ適用状況の確認と、管理インターフェースのアクセス制限（送信元IP制限・VPN内への隔離）の対象として起票すべき、ということである。

> 出典: Using search engines for fun and bounties — https://archive.0x00sec.org/t/using-search-engines-for-fun-and-bounties/23832

---

### 4a.7 FOFAとNetlasの固有事情

#### FOFA

FOFA（白帽汇、中国）は、他エンジンと**演算子の記法が根本的に違う**点に注意が必要だ。

```text
# 基本形: field="value"
domain="example.com"
cert="example.com"
title="Index of"
body="© copyright"
header="X-Jenkins"
icon_hash="-247388890"
port="8080"
protocol="https"
org="Example Inc"
asn="12345"
ip="1.2.3.0/24"
is_domain=true
jarm="29d29d15d29d29d..."

# 論理演算子
domain="example.com" && port="8080"
title="admin" || title="login"
domain="example.com" && country!="CN"
```

**記法の要点**:

- 値は**ダブルクォートで囲む**（Shodan/Censysのようにクォート省略が効かない場面がある）。
- `=` は **あいまい一致（部分一致）**、`==` は **完全一致**。`&&`がAND、`||`がOR、`!=`が否定。この`=`と`==`の区別はFOFA固有で、`title=="Login"`は`<title>`が厳密に`Login`のものだけを返す。ノイズ削減に直結する。
- `is_domain=true` のような**アセット属性**を持ち、「ドメイン名で到達できるものだけ」に絞れる。裸IPのノイズを落とせるのはFOFAの強み。
- `icon_hash` は **Shodanと同じ mmh3（符号付き32bit）** を使うため、**Shodanの favicon ハッシュをそのまま移植できる**。これはクロスエンジン運用上の数少ない「そのまま通る」ケースである。

> ⚠️ **部分的に未取得の資料**: FOFA公式のクエリ規則ページ（`https://en.fofa.info/lab/query`）はHTTP 404で取得できませんでした。上記のうちフィールド名・論理演算子の存在はFOFA APIドキュメント（`https://en.fofa.info/api`、取得成功）で確認していますが、個々の挙動の詳細は一般知識に基づく補足を含みます。最新の正確な規則は FOFA のログイン後「查询语法 / Query Syntax」ページでご確認ください。

> 出典: FOFA API Documentation — https://en.fofa.info/api ／ awesome-ip-search-engines — https://github.com/cipher387/awesome-ip-search-engines

#### Netlas

Netlasは **Elasticsearch/Lucene構文をほぼ素で露出している**のが特徴で、他エンジンにない検索表現力を持つ。

```text
# 論理演算子は AND / OR / NOT（大文字）
http.title:netlas NOT port:443

# ワイルドカード（* 複数文字、? 1文字）
domain:google.*
domain:*.github.com OR host:*.github.com

# 範囲
ip:[173.194.222.0 TO 173.194.222.255]
port:<=1000
mysql.server_version:>8.0.30

# あいまい検索（編集距離ベース）
Joseph~

# ソフトウェア判定タグ
tag.name:"adobe_coldfusion"
tag.nginx:*

# 地理・CVEの組み合わせ
geo.country:US
geo.city:London AND cve:*
```

**ここが効く理由**: `port:<=1000`や`mysql.server_version:>8.0.30`のような**不等号による範囲指定**、`domain:google.*`のような**ワイルドカード**、`Joseph~`の**ファジー検索**は、ShodanやFOFAには（少なくとも同じ自然さでは）存在しない。Luceneのインデックス構造——数値型フィールドはBKDツリー、文字列型はterm dictionary——をそのまま使えるからこそ可能な表現である。逆にワイルドカードを先頭に置く`*.github.com`のようなクエリは、内部的に高コストになる（term dictionaryを逆引きする必要がある）ことも理解しておくとよい。

またNetlasは`datatype`で**インデックスそのものを切り替える**設計を取る。

| datatype | 中身 |
|---|---|
| `response` | スキャンしたプロトコル応答（既定） |
| `domain` | DNSレコード |
| `cert` | X.509証明書（SHA-256 / SHA-1 / MD5 フィンガープリントで直接引ける） |
| `domain-whois` | ドメイン登録情報 |
| `ip-whois` | IP割当情報 |

証明書を独立したインデックスとして持つため、**「この証明書を使っているホストを全部出す」**という逆引きが自然に書ける。Certificate Transparency（CT）ログが「発行された証明書」のログであるのに対し、Netlasのcertインデックスは**「実際にインターネット上で提示されている証明書」**である点が違う。CTには載るが実際には使われていない証明書、逆にCTに載らない自己署名証明書——この両方の差分を突き合わせることで、より正確な資産像が得られる。

> 出典: Netlas Cookbook — https://github.com/netlas-io/netlas-cookbook ／ Netlas Responses Field Reference — https://docs.netlas.io/knowledge-base/field-reference/responses/

---

### 4a.8 クロスエンジン対応表（まとめ）

同じ問いを4エンジンで書き分けるための早見表。**移植時は必ずこの表で読み替えること。**

| 意味 | Shodan | Censys | FOFA | Netlas |
|---|---|---|---|---|
| 組織 | `org:"X"` | `autonomous_system.organization:"X"` | `org="X"` | `whois.*` / `isp:"X"` |
| ASN | `asn:AS123` | `autonomous_system.asn:123` | `asn="123"` | `whois.asn` 系 |
| 証明書ホスト名 | `ssl.cert.subject.CN:"x.com"` | `services.tls.certificate.names:"x.com"` | `cert="x.com"` | `certificate.subject.common_name:"x.com"` |
| 証明書 期限切れ | `ssl.cert.expired:true` | `services.tls.certificate.parsed.validity_period.not_after:[* TO <日付>]` | `cert.is_expired=true` | `certificate.validity.end:<...>` |
| favicon | `http.favicon.hash:<mmh3 符号付き>` | `services.http.response.favicons.md5_hash="<md5>"` | `icon_hash="<mmh3 符号付き>"` | `http.favicon.hash_sha256:"<sha256>"` |
| ページタイトル | `http.title:"X"` | `services.http.response.html_title:"X"` | `title="X"` | `http.title:"X"` |
| 本文 | `http.html:"X"` | `services.http.response.body:"X"` | `body="X"` | `http.body:"X"` |
| ステータス | `http.status:200` | `services.http.response.status_code:200` | `status_code="200"` | `http.status_code:200` |
| ポート | `port:8080` | `services.port:8080` | `port="8080"` | `port:8080` |
| 製品 | `product:"Apache Tomcat"` | `services.software.product:"Tomcat"` | `app="Apache-Tomcat"` | `tag.name:"apache_tomcat"` |
| 否定 | `-port:80` | `not services.port:80` | `port!="80"` | `NOT port:80` |
| OR | `http.title:a,b` | `{"a","b"}` / `or` | `\|\|` | `OR` |
| 同一サービス内AND | （既定でそうなる） | **`services: ( ... )` で括る** | （既定でそうなる） | （既定でそうなる） |

> 出典: awesome-ip-search-engines — https://github.com/cipher387/awesome-ip-search-engines ／ Complete guide to finding more vulnerabilities with Shodan and Censys — https://www.intigriti.com/researchers/blog/hacking-tools/complete-guide-to-finding-more-vulnerabilities-with-shodan-and-censys

---

### 4a.9 エコシステム: どのエンジンを、何のために

`awesome-ip-search-engines`（cipher387）は、この分野のツール・資料を網羅的に索引化したリポジトリである。押さえるべき構図は次の通り。

**主要エンジン**: Netlas（app.netlas.io）／ Shodan（shodan.io）／ Censys（search.censys.io）／ ZoomEye（zoomeye.org）／ FOFA（en.fofa.info）／ Onyphe（onyphe.io）／ GreyNoise（viz.greynoise.io）／ Criminal IP（criminalip.io）／ Hunter（hunter.how）／ Quake 360（quake.360.net）／ 0.zone ／ ODIN（search.odin.io）

このうち**GreyNoiseだけは役割が逆向き**である点に注意したい。他が「インターネット上のサーバを探す」のに対し、GreyNoiseは「インターネット上を**スキャンしている側**のIP」をインデックスする。自組織のIDS/WAFログに出たIPをGreyNoiseで引き、「インターネット全体を無差別にスキャンしている既知のノイズ」なのか「自組織だけを狙った通信」なのかを切り分ける——**アラートトリアージの偽陽性削減**がその用途だ。防御運用では必須のピースになる。

**主要リソース**: Netlas Cookbook、Shodan Dojo（Shodan公式の学習コース）、Censys Search Mindmap、Awesome FOFA、Awesome Shodan Queries、Awesome Censys Queries、netlas-dorks、各種チートシート（「50 Netlas filters」など）。書籍としては John Matherly（Shodan創業者）の *Complete Guide to Shodan*（2016）が原典に近い。

**補助ツール**: favicon系（Fav-up、IconHash、FaviHunter、FaviconLocator）、サブドメイン系（Censys Subdomain Finder、Shodomain、Punter）、WAF/CDNの背後のオリジンIP探索（CloudFlair、CloudBunny）、スキャン統合（Smap＝Shodan APIをnmap出力形式で返すもの、IVRE）、可視化（Kamerka、Shomap）、Maltego / Burp Suite / OWASP Amass / Recon-ng 各種プラグイン、Python/Go/Rust等ほぼ全言語のクライアントライブラリ。

> 出典: awesome-ip-search-engines — https://github.com/cipher387/awesome-ip-search-engines

---

### 4a.10 結果の読み方 — 教科書的な注意点

クエリが書けるようになった後に必ずつまずく4点を挙げる。

#### (1) データは「過去のスナップショット」である

Shodanの再スキャン間隔は概ね数日〜1か月、ポートやプロトコルによって大きく異なる。**返ってきたバナーは「いつ」の情報かを必ず確認する**（Shodanは`timestamp`、Netlasは`@timestamp`/`scan_date`を持つ）。数か月前のバナーに基づいて「脆弱だ」と判断するのは誤りで、逆に「今は閉じているのにインデックスに残っている」ケースも常にある。

#### (2) 共有インフラによる偽陽性

クラウドの共有IP、CDNのエッジ、リバースプロキシ——これらの背後では、**1つのIPに無関係な多数の組織のサービスが同居する**。`ssl.cert.subject.CN`で自社ドメインが出たIPが、実はCDNエッジで、そこには他社のサイトも載っている、というのは日常的に起きる。**「IPが自社のものである」ことと「そのIPで自社ドメインが提供されている」ことを混同しない。**

#### (3) ファセット（集計）でスコープを把握してから掘る

個別ホストを見る前に、**まず分布を見る**。Shodanは検索結果ページの左サイドバー、およびAPI/CLIの facet 機能で、ポート・製品・国・組織別の件数を出せる。Censysは Report 機能、Netlasはフィールド別の集計を持つ。

「自社ASNで開いているポートの分布」を最初に取れば、想定外のポート（例: 3389/RDPや5432/PostgreSQLが外向きに開いている）が件数として一目で分かる。**列挙より集計を先に**、が効率の要諦である。

#### (4) フィールド名は必ず「今の」リファレンスで確認する

本節で示したフィールドパスは、記事・ドキュメント取得時点（Intigritiガイドは2024年前後、Netlasドキュメントは2026年時点）の表記である。Censysは Search 2.0 → Censys Platform への移行でスキーマが変わっており、Shodanもフィルタの追加・プラン制限の変更を続けている（`vuln:`は上位プラン限定のまま）。**クエリが0件を返したとき、まず疑うべきは「対象が存在しない」ではなく「フィールド名が現行と違う」である。**

---

### 4a.11 防御側への落とし込み

最後に、本節の技法を防御の運用へ変換する。

1. **継続的な自己監視**: 自組織のASN・ドメイン・証明書CN・faviconハッシュを軸にしたクエリを**保存クエリとして登録し、定期実行してdiffを取る**。新規に出現したホストはすべて「承認済みか否か」を判定する。Shodan Monitor、Censys ASM、Netlas のモニタリング機能はこのために存在する。
2. **優先的に潰すもの**: ①期限切れ証明書のホスト（＝放棄資産）、②`http.title:"Index of"`（＝ディレクトリリスティング）、③非標準ポートで生で見えている管理画面、④デフォルト認証情報を示唆する製品バナー。この4つは発見コストが低く、影響が大きい。
3. **指紋を減らす**: バナーからのバージョン露出を止める（Apache `ServerTokens Prod`、nginx `server_tokens off;`）、不要な独自ヘッダを削る、ステージング環境のHTMLから本番と共通のトラッキングIDやフッターを外す。**「指紋を消す」こと自体は脆弱性の修正ではない**が、攻撃者のターゲティングコストを確実に上げる。
4. **ブランド詐称の監視**: 自社faviconのmmh3/MD5/SHA-256と知覚ハッシュを全エンジンで定期検索し、自社管理外のホストが出たら調査する。

#### この節の要点

- クエリ構文の違いは**インデックスのドキュメント構造の違い**に由来する。特にCensysの「ホスト単位ドキュメント＋`services: (...)`」は最重要の作法。
- クラウド時代の資産紐付けの主軸は`org:`ではなく**TLS証明書**。CensysのSAN統合フィールド`certificate.names`が最も漏れが少ない。
- faviconハッシュは **Shodan/FOFA = mmh3(base64.encodebytes(bytes)) 符号付き32bit、Censys = MD5、Netlas = SHA-256** と非互換。仕組みを知らずに移植すると必ず0件になる。
- バナー由来の`version:`/`vuln:`は**示唆であって断定ではない**（バックポート修正問題）。
- 列挙の前に**ファセットで分布を取る**。フィールド名は毎回現行リファレンスで確認する。

## favicon hash（mmh3）相関による資産クラスタリング

### この節で学ぶこと

「favicon（ファビコン）」とは、ブラウザのタブやブックマークの横に表示される小さなアイコンのことで、多くのサイトが `https://example.com/favicon.ico` から配信している。一見すると単なる装飾だが、Recon（偵察）の観点ではこれが強力な**資産フィンガープリント（asset fingerprint、資産を一意に識別する指紋）**になる。

なぜか。ある組織が独自のブランドアイコンを使っていたり、あるいは Jenkins・GitLab・pfSense のようなソフトウェア製品がデフォルトのアイコンを同梱していたりすると、**同じバイト列のファビコンが複数のホストで配信される**。このバイト列を数値のハッシュ値に変換して索引化しておけば、「同じアイコンを配信しているホストを世界中から検索する」ことが可能になる。この索引を提供しているのが Shodan・Censys・ZoomEye などのインターネット全域スキャナである。

本節では、そのハッシュ値がどう計算されるのか（**mmh3 = MurmurHash3**）を実装レベルで解き明かし、なぜ base64 を挟むのか、そしてそれを使って「散らばった資産を1つの組織のものとしてクラスタリングする」防御的な使い方を扱う。

> **スコープの注意（本書共通）**: 本節はあくまで**防御・自組織の資産棚卸し（アタックサーフェス管理）**を目的とする。実在する第三者サービスや本番環境への無許可の検証、WAF/CDN 回避による攻撃的アクセスなどは扱わない。ここで説明する技術は「攻撃者から自組織がどう見えているか」を理解し、露出を減らすために使う。

---

### なぜ favicon がフィンガープリントになるのか

ファビコンが指紋として機能する理由は3つの性質による。

1. **バイト列がそのまま等値比較できる**: ファビコンは静的ファイルであり、多くの場合ホストをまたいで**1バイトも違わない同一ファイル**が配信される。同一ファイル → 同一ハッシュ、という単純な等値性が成り立つ。
2. **デフォルトアイコンが製品を特定する**: 管理者がブランディングを変更せずにデプロイした製品（社内 Jenkins、GitLab、Confluence、pfSense など）は、その製品のデフォルトファビコンをそのまま配信する。ハッシュを見れば「これは Jenkins だ」と分かる。
3. **CDN/WAF の背後でも露出しやすい**: 後述するように、CDN の背後にあるオリジンサーバも同じファビコンを配信することが多く、オリジンが直接インターネットに露出していればスキャナに拾われる。

Shodan の公式ブログは、この手法を開発した際の設計判断を次のように述べている。

> The key considerations when we developed the technique were speed of the hashing algorithm and size of the resulting hash.
> （この手法を開発する際の主要な検討事項は、ハッシュアルゴリズムの速度と、得られるハッシュのサイズだった。）

> 出典: Deep Dive: http.favicon — https://blog.shodan.io/deep-dive-http-favicon/

つまり暗号学的ハッシュ（SHA-256 など）ではなく、**高速で結果が短い（32ビット整数）非暗号ハッシュ**が選ばれた。これが MurmurHash3（mmh3）である。

---

### mmh3（MurmurHash3）とは何か

**MurmurHash3** は、Austin Appleby が設計した**非暗号学的ハッシュ関数（non-cryptographic hash function）**である。「非暗号学的」とは、衝突耐性（異なる入力から同じ値を意図的に作り出せないこと）や一方向性といったセキュリティ特性を目的としておらず、**ハッシュテーブルの索引付けを高速に行うこと**を目的とする、という意味だ。SHA や MD5 のような暗号ハッシュに比べて桁違いに速く、出力が短い。

Payatu の記事はこの選定理由を端的にまとめている。

> MurmurHash3 は「ハッシュベースの検索を容易にするために明示的に設計されたハッシュ関数であり、伝統的な暗号学的関数ではない」。

> 出典: How to find assets using Favicon Hashes? — https://payatu.com/blog/favicon-hash/

Shodan が採用しているのは MurmurHash3 の 32ビット版で、出力は**符号付き32ビット整数**として扱われる。このため検索クエリで登場するハッシュ値には `-305179312` のように**負の値**が現れることがある。これは 32ビットの領域（約 -21億 〜 +21億）に収まる整数を、符号付きで表示しているからだ。負号を含めて1つのハッシュ値である点に注意する。

#### ハッシュ計算の「意外な一手間」: base64 を挟む

favicon hash の計算で最も間違えやすく、かつ**原理的に最も重要な点**が、「生のバイナリをそのままハッシュするのではなく、いったん base64 エンコードした文字列をハッシュする」ことである。Shodan の実装がそうなっているため、それに合わせなければ検索エンジンと同じ値にならない。

Shodan 公式ブログは、banner（Shodan が各ホストについて保持する観測データ）の中の favicon オブジェクトの構造を次のように示している。

```json
{
    "data": "AAABAAIAEBAAAAAAIABoBAAAJgAAACAgAAAAACAAqBAAAI4EAA...",
    "hash": 516963061,
    "location": "https://about.gitlab.com:443/ico/favicon.ico"
}
```

そして各プロパティの意味を次のように定義している。

- **data**: 画像を**base64 エンコードした文字列**（"contains the image as a base64-encoded string"）
- **hash**: その **data プロパティに対する MurmurHash3**（"the MurmurHash3 of the `data` property"）
- **location**: ファビコンが見つかった場所（URL）

> The favicon hash is calculated by applying the MurmurHash3 algorithm to the `http.favicon.data` property on the banner.
> （favicon hash は、banner の `http.favicon.data` プロパティに MurmurHash3 アルゴリズムを適用して算出される。）

> 出典: Deep Dive: http.favicon — https://blog.shodan.io/deep-dive-http-favicon/

ここが核心である。`http.favicon.data` は**すでに base64 エンコードされた文字列**であり、ハッシュはその文字列に対して計算される。したがって自分で再現するには「生バイナリ → base64 → mmh3」という順序を守る必要がある。

---

### 実装で正確に再現する

SANS ISC のフィッシング調査記事は、最小限のコードでこの手順を示している。

```python
import requests, mmh3, base64
response = requests.get('https://c.s-microsoft.com/favicon.ico')
favicon = base64.encodebytes(response.content)
hash = mmh3.hash(favicon)
print(hash)
```

> 出典: Hunting phishing websites with favicon hashes — https://isc.sans.edu/diary/27326

このコードの各行が「なぜそうなるのか」を分解する。

- `response.content` は favicon の**生バイナリ（bytes 型）**。
- `base64.encodebytes(...)` は、そのバイナリを base64 でエンコードする。ここで重要なのは、Python の `base64.encodebytes()` は **76文字ごとに改行 `\n` を挿入し、末尾にも改行を付ける**という古い MIME 仕様に沿った出力をすることだ。この改行入りの文字列こそが Shodan の `http.favicon.data` と一致する形なので、改行を除去してはならない。改行を消すとハッシュ値が変わり、検索エンジンとマッチしなくなる。
- `mmh3.hash(...)` は MurmurHash3 32ビット版を計算し、符号付き整数を返す。

Payatu の記事も本質的に同じ処理を、`codecs` を使って書いている。

```python
#!/usr/bin/env python3
import mmh3
import sys
import codecs
import requests

if len(sys.argv) != 2:
    print(f"Usage: {sys.argv[0]} [Favicon URL]")
    sys.exit(0)

try:
    response = requests.get(sys.argv[1])
    favicon = codecs.encode(response.content, 'base64')
    hash = mmh3.hash(favicon)
    print(f"Favicon Hash: {hash}")
except Exception as e:
    print(f"Error occured as: {e}", file=sys.stderr)
```

> 出典: How to find assets using Favicon Hashes? — https://payatu.com/blog/favicon-hash/

ここで `codecs.encode(response.content, 'base64')` は `base64.encodebytes()` と**同じく改行入りの base64** を生成する。したがって上の SANS の例と同じ結果になる。この「改行入り base64」の一致こそが、独自実装が Shodan と同じ値を出すための鍵である。

> ⚠️ **実装上の落とし穴**: `base64.b64encode()`（改行なし）を使うと、`base64.encodebytes()`（改行あり）とは**別のハッシュ値**になる。Shodan/Censys/ZoomEye と揃えるには改行入りの `encodebytes` / `codecs 'base64'` を使うこと。また favicon が見つからず HTML のエラーページ（例: 404 ページ）が返ってきた場合、そのページのバイト列をハッシュしてしまうと無意味な値になる。HTTP ステータスコードと Content-Type を必ず確認する。

---

### 検索エンジンでの相関クエリ

計算したハッシュ値を各スキャナのクエリ構文に渡すと、「同じファビコンを配信しているホスト」が返る。

**Shodan**（フィルタ名は `http.favicon.hash`）:

```
http.favicon.hash:1265477436
```

Shodan ブログの例では、GitLab のファビコンハッシュ `1265477436` で検索すると **29,558 件**のインスタンスがヒットしたと報告されている（記事執筆時点の値。件数は時間とともに変動する）。

> 出典: Deep Dive: http.favicon — https://blog.shodan.io/deep-dive-http-favicon/

組織名などの他フィルタと **AND 結合**すると、資産クラスタリングの精度が上がる。Payatu の例:

```
http.favicon.hash:1320981061
org:"expliot.io" http.favicon.hash:-305179312
```

コマンドライン（Shodan CLI）から、必要なフィールドだけ抽出する例:

```
shodan search org:"expliot.io" http.favicon.hash:-305179312 --fields ip_str,port
```

> 出典: How to find assets using Favicon Hashes? — https://payatu.com/blog/favicon-hash/

**ZoomEye**（フィルタ名が異なり `iconhash`。ただし内部は同じ mmh3 なのでハッシュ値は共通に使える）:

```
iconhash:"-305179312"
```

> 出典: How to find assets using Favicon Hashes? — https://payatu.com/blog/favicon-hash/

Censys など他のエンジンも同種の favicon ハッシュ検索を持つが、**エンコード方式やハッシュのバリアント（生バイナリの MD5 系か、base64+mmh3 系か）がエンジンごとに異なる場合がある**点は要注意だ。ZoomEye は Shodan と同じ mmh3 系だが、あるエンジンで得たハッシュを別エンジンにそのまま使えるとは限らない。自分の実装で計算したハッシュと、対象エンジンのハッシュ定義が一致しているかを、既知のサイトで一度検証してから使うのが実務上の鉄則である。

#### AND/NOT で「誤検出」を絞り込む — 防御的フィッシング検知の実例

favicon hash は「同じアイコンを使うすべてのホスト」を返すため、正規サイト・ミラー・CDN・そして**なりすまし（フィッシング）サイト**が混在する。SANS ISC の記事は、Microsoft ログインを模したフィッシングサイトを炙り出すために、正規インフラを除外するクエリを組み立てている。

```
http.favicon.hash:-2057558656
```

まずこの広いクエリでは「結果が非常に多い（the number of results is quite high）」。そこで正規の Microsoft を除外し、フィッシングに使われがちな構成（Apache + サインイン文言）へ絞る。

```
http.favicon.hash:-2057558656 -org:"Microsoft Corporation" -org:"Microsoft Azure" 
product:"Apache httpd" http.html:"Sign in"
```

`-org:"..."` の先頭のマイナスは NOT（除外）を意味する。「Microsoft 系 org 以外」で「Apache httpd を動かし」「HTML に "Sign in" を含む」ホスト、という条件で誤検出を大幅に減らし、実際に Microsoft ログインを模した偽ページを特定できたと報告している。

記事の結論は防御チームへの示唆で締めくくられている。favicon ハッシュ検索は「フィッシングサイトを検出する安価で簡単な方法（a cheap and simple way to detect phishing sites）」であり、**自社ファビコンを使った定期的な自動検索**を運用に組み込むことを推奨している。これはまさに本書のスコープに合致する防御的活用だ。

> 出典: Hunting phishing websites with favicon hashes — https://isc.sans.edu/diary/27326

---

### 製品フィンガープリント辞書と FavFreak

ハッシュ値を「どの製品か」に翻訳するには、**既知ハッシュ → 技術名の対応辞書**が要る。この自動化を代表するのが Devansh Batham の **FavFreak** である。

> ⚠️ **未取得の資料**: 「Weaponizing favicon.ico for BugBounties, OSINT and what not（Devansh Batham）」の Medium 本文は自動取得できませんでした（理由: サーバが HTTP 403 Forbidden を返し、著者ミラー `devansh.xyz` も 404 でした）。以下のURLからご自身で直接ご覧ください: https://medium.com/@Asm0d3us/weaponizing-favicon-ico-for-bugbounties-osint-and-what-not-ace3c214e139
>
> （以下は未取得資料の補足として、FavFreak の GitHub 原本の README・ソース、および二次資料に基づく解説です。）

FavFreak は、URL のリストを標準入力から受け取り、各ホストの `favicon.ico` を取得してハッシュを計算し、**同じハッシュのホストをグループ化**したうえで、内蔵のフィンガープリント辞書と突き合わせて製品名を表示するツールである。README はこう説明している。

> FavFreak takes a list of urls (with https or http protocol) from stdin, then it fetches favicon.ico and calculates its hash value.

FavFreak の中核コードは、本節でこれまで見た「base64 → mmh3」を忠実になぞっている。

```python
# URL 末尾に favicon.ico を付与
for line in sys.stdin:
    if line.strip()[-1] == "/":
        urls.append(line.strip() + "favicon.ico")
    else:
        urls.append(line.strip() + "/favicon.ico")

# ハッシュ計算（20並列で取得）
favicon = codecs.encode(response.read(), "base64")
hash = mmh3.hash(favicon)
```

`codecs.encode(..., "base64")` を使っている点に注目。前述の通りこれは**改行入り base64** であり、Shodan の値と一致する。ツールが吐いたハッシュをそのまま `http.favicon.hash:` で検索できるのはこのためだ。

FavFreak には 400 以上のハッシュ → 技術名の対応が内蔵されている。抜粋:

| favicon hash | 技術・製品 |
|---|---|
| `99395752` | Slack instance |
| `81586312` | Jenkins |
| `743365239` | Atlassian |
| `855273746` | JIRA |
| `1405460984` | pfSense |
| `1278323681` | GitLab |
| `116323821` | Spring Boot アプリケーション |

使い方（防御目的で、自組織の URL 一覧に対して実行する想定）:

```
cat urls.txt | python3 favfreak.py -o output
```

`-o` で結果をファイル出力する。URL は `http://` または `https://` のスキームを必ず付ける必要がある。

> 出典: FavFreak README / favfreak.py — https://github.com/devanshbatham/FavFreak
> 出典（Spring Boot のハッシュ 116323821 など二次情報）: Weaponizing favicon.ico for BugBounties, OSINT and what not — https://medium.com/@Asm0d3us/weaponizing-favicon-ico-for-bugbounties-osint-and-what-not-ace3c214e139

> **注意（辞書の陳腐化）**: これらのハッシュは製品が**デフォルトファビコンを変更しない限り**有効である。メジャーバージョンアップでアイコンが差し替わればハッシュは変わる。したがって「ハッシュ辞書」は特定の年・バージョンのスナップショットにすぎず、定期的な更新が前提になる。FavFreak の辞書も 2020〜2021 年頃の値が中心である。

---

### CDN/WAF 背後のオリジン露出という論点（防御の観点で）

favicon hash 相関が資産管理で重視される最大の理由は、**CDN や WAF で守っているつもりのオリジンサーバが、同じファビコンを配信していると検索で紐づいてしまう**ことにある。

仕組みはこうだ。利用者が `https://example.com/`（Cloudflare 等の背後）にアクセスすると、エッジ経由で favicon が返る。一方、**オリジンサーバ自身のグローバル IP が直接インターネットに露出**していて、そこでも同じ Web アプリ（＝同じ favicon）を配信していると、Shodan はそのオリジン IP を独立に観測し、`http.favicon.hash` を索引化する。すると「エッジで見えるファビコンのハッシュ」と「オリジン IP のファビコンのハッシュ」が一致し、**ドメイン名を経由せずにオリジン IP が特定できてしまう**。Shodan ブログもユースケースとして "Origin IP disclosure"（CDN 設定を確認し、オリジンサーバを見つける）を明示している。

> 出典: Deep Dive: http.favicon — https://blog.shodan.io/deep-dive-http-favicon/

防御側にとってこれは重大なリスクである。オリジン IP が判明すると、CDN/WAF による防御レイヤ（レート制限、DDoS 緩和、シグネチャ検査など）を回避して**オリジンに直接到達**される恐れがある。したがって対策は明快だ。

- **オリジンへの直接アクセスを遮断する**: ファイアウォールやセキュリティグループで、CDN/WAF のエッジ IP レンジからの通信のみを許可し、それ以外の送信元をすべて拒否する。Cloudflare・Akamai などが公開する IP レンジを allowlist にする。
- **相互 TLS / 共有シークレット**: エッジからオリジンへのリクエストにのみ付与されるヘッダやクライアント証明書を必須にし、直接アクセスを弾く。
- **オリジンのファビコンを変える・出さない**: 露出面の低減として、オリジンで配信するアイコンを変更したり、そもそもオリジンをインターネットから隔離する（プライベートネットワーク経由でのみ CDN と接続）。

> ⚠️ **スコープ確認**: 本書では、上記の「オリジン特定」を**攻撃するための手順**としては扱わない。ここでの目的は、自組織のオリジンが favicon 経由で紐づかないよう**防御設計を確認する**ことにある。第三者資産に対して同手法でオリジンを探索し、CDN/WAF を回避してアクセスする行為は、無許可であれば不正アクセスに当たり得る。

---

### 実務フロー: 自組織の資産クラスタリング

防御的な資産棚卸し（アタックサーフェス管理）としての典型的な手順をまとめる。

1. **自組織の既知ファビコンのハッシュを算出する**。ブランドアイコン、社内ツール（Jenkins/GitLab/Confluence 等）のデフォルトアイコンそれぞれについて、前述の「base64 → mmh3」でハッシュを求める。
2. **各スキャナで `http.favicon.hash:` / `iconhash:` を検索**し、ヒットしたホストを一覧化する。`org:` や ASN、証明書の SAN などと AND して自組織由来のものを抽出する。
3. **クラスタリングと差分検出**: 得られたホスト集合を「正規の管理下」「管理外だが自社由来（シャドー IT・退役し忘れ・検証環境）」「なりすまし（他組織・フィッシング）」に分類する。管理外の自社資産は棚卸しに追加し、なりすましは通報・テイクダウン対応へ回す。
4. **オリジン露出の確認**: CDN/WAF 配下のサービスについて、オリジン IP が同一ハッシュで露出していないかを確認し、露出していれば allowlist 化などで直接アクセスを遮断する。
5. **定期実行**: 辞書とハッシュは陳腐化するため、SANS ISC が推奨するように**自社ファビコンでの定期自動検索**を運用に組み込む。新規のなりすましや新たに露出したオリジンを早期に発見できる。

---

### まとめ

- favicon hash は「同一バイト列のアイコン → 同一ハッシュ」という単純な等値性を利用した、極めて低コストで高効率な資産フィンガープリントである。
- Shodan は `http.favicon.data`（**base64 エンコード済み文字列**）に **MurmurHash3（mmh3）32ビット**を適用してハッシュ化する。負値になり得る符号付き整数である。
- 自前で再現するには「生バイナリ → **改行入り** base64（`base64.encodebytes` / `codecs 'base64'`）→ `mmh3.hash`」の順序が必須。改行なしの `b64encode` を使うと値がずれる。
- `http.favicon.hash:`（Shodan）や `iconhash:`（ZoomEye）で相関検索し、`org:` や `-org:` の AND/NOT で資産クラスタリング・フィッシング検知の精度を上げる。
- FavFreak のような辞書型ツールでハッシュを製品名に翻訳できるが、辞書はバージョン・年に依存し陳腐化する。
- 防御上の最重要論点は**CDN/WAF 背後のオリジン露出**。同一ファビコンでオリジン IP が紐づくため、エッジ IP レンジの allowlist 化などで直接アクセスを遮断する。

この手法は「攻撃者から自組織がどう見えるか」を可視化する鏡である。攻撃のためではなく、**露出を減らし、なりすましを検知するため**に使うのが本書の立場だ。

## 検索クエリ・チートシート

インターネット規模のスキャンデータベース（Shodan、Censys など）は、世界中のIPアドレスに対して定期的にポートスキャンとバナー取得を行い、その結果を検索可能なインデックスとして提供するサービスである。攻撃者はこれらを使って「攻撃対象を能動的にスキャンせずに」露出資産を発見できる一方、防御側にとっても「自組織がインターネットからどう見えているか」を継続的に把握するための最重要ツールになる。本節では Shodan と Censys それぞれの検索クエリ構文（フィルタ・演算子）を体系的に整理し、それぞれの「仕組み」と「防御的な読み方」を解説する。

これらのサービスの結果は基本的に**受動的**（自組織が明示的に何かを送信したわけではなく、第三者が事前に収集したデータを検索するだけ）だが、検索対象が実在のインターネット資産である以上、本節で示すクエリは「自分が管理する資産の露出確認」「請負契約や許可を得た偵察業務」の範囲でのみ実行すべきである。他者の資産に対する探索的な走査や、検索結果から得た対象への無許可アクセスは行わない。

### Shodan の検索クエリ構文

Shodan はインターネット全体に対して継続的にポートスキャンを行い、各ホストが返す「バナー」（サービスが接続時に送信する応答データ、例えば HTTP のレスポンスヘッダや SSH のバージョン文字列）を収集・インデックス化している。検索クエリはこのインデックスに対する全文検索＋フィルタとして機能する。基本構文は `filter:value` の形式で、複数のフィルタをスペースで区切ると **AND** 結合になる（Shodan のデフォルト演算子は AND であり、OR を使うには括弧内で `filter:A OR filter:B` のように明示する必要がある）。

#### 主要フィルタ一覧

| フィルタ | 目的 | 例 |
|---|---|---|
| `port:` | 特定ポートで応答するホストを絞り込む | `port:80` |
| `os:` | バナー中のOS判定文字列でフィルタ | `os:"Windows Server 2016"` |
| `product:` | 検出されたソフトウェア製品名で絞り込む | `product:"Apache httpd"` |
| `version:` | 製品バージョンで絞り込む | `version:2.4.41` |
| `vuln:` | 既知のCVE識別子に紐づく資産を検索 | `vuln:CVE-2021-44228` |
| `country:` | 国コード（ISO 3166-1 alpha-2）で絞り込む | `country:US` |
| `city:` | 都市名で絞り込む | `city:"New York"` |
| `org:` | ISP/組織名（WHOIS由来）で絞り込む | `org:"Target Corp"` |
| `hostname:` | 逆引きホスト名の一致 | `hostname:mail.example.com` |
| `http.title:` | HTTPレスポンスの `<title>` タグ内容で検索 | `http.title:"Login"` |
| `ssl.cert.subject.cn:` | TLS証明書のCommon Name（証明書が発行された対象のドメイン名）で検索 | `ssl.cert.subject.cn:example.com` |

> 出典: Shodan Search Queries Cheat Sheet — https://vespersec.net/docs/osint-reconnaissance/shodan-search-queries-cheat-sheet/

**なぜこれで見つかるのか（仕組み）**: Shodan のクローラーは対象ポートに実際にTCP/UDP接続を行い、サービスが最初に送ってくるレスポンス（HTTPであればステータス行とヘッダ、SSHであればプロトコルバージョン文字列、TLSであればハンドシェイク時の証明書）をそのまま保存する。`product:` や `os:` はこの生バナーに対する正規表現ベースのシグネチャマッチングの結果であり、サービス側が名乗った文字列（例: `Server: Apache/2.4.41`）をそのまま信じているに過ぎない。したがって管理者がバナーを意図的に書き換えたり隠したりすれば `product:` フィルタから外れるが、`vuln:` フィルタのように「バージョン文字列からCVEを逆引きする」仕組みは、バナー詐称（サーバー側での `Server` ヘッダ書き換えなど）によって精度が落ちる点も併せて理解しておく必要がある。逆に防御側の視点では、バナーの詳細情報（正確なバージョン番号など）を不必要に外部へ晒さないことが、この種の受動的偵察による資産特定の精度を落とす一つの緩和策になる。

`ssl.cert.subject.cn:` は、TLSハンドシェイクの `ServerHello` に続いて送信される証明書チェーンの内容をShodanが解析・保存していることに基づく。証明書のCN（あるいはSAN: Subject Alternative Name）はドメイン名の一覧そのものであるため、これは「サブドメイン列挙」の代替手段として機能する。組織が使い回している内部向けの証明書（例えば `internal.example.com` のような社内ホスト名をSANに含めた証明書）を外部向けサーバーに誤って使ってしまうと、これが検索経由でそのまま露出する。この点は Certificate Transparency ログ（証明書発行時に公開ログへ記録される仕組み）と同様の露出リスクであり、本教科書の他章で触れる CT ログ調査と組み合わせて理解すると効果的である。

#### ユースケース別のクエリパターン

原典では、目的別に典型的な組み合わせが整理されている。

- **Webサーバー**: ポートフィルタと製品名、地域フィルタを組み合わせる（例: `port:443 product:"nginx" country:JP`）。組織が意図せず公開したステージング環境や、地域限定のはずのサービスが全世界公開になっているケースの発見に使える。
- **データベース**: 既定ポートで直接検索する。代表例は MySQL（3306）、PostgreSQL（5432）、MongoDB（27017）。これらのポートがインターネットから到達可能な状態で見つかること自体が、多くの場合設定ミス（本来は内部ネットワークのみからアクセスさせるべきもの）を示す強いシグナルになる。
- **リモートアクセス**: RDP（3389）、SSH（22）、VNC（5900）。組織の資産インベントリと突き合わせ、意図しない踏み台やレガシー端末の外部公開を洗い出す。
- **IoT／組み込み機器**: 組み込みWebサーバーやWebカメラのバナー・タイトルパターンを検索する。管理コンソールが初期パスワードのまま公開されているケースが典型的なリスクである。
- **産業制御システム（ICS）**: Modbus、EtherNet/IP（ENIP）などの産業用プロトコルや、ベンダー固有のバナーを持つ機器を検索する。これらは通常インターネットに接続すべきでない制御系ネットワークの資産であり、発見された場合は即座にネットワーク分離を確認すべき重大な指摘事項となる。
- **脆弱性チェイン**: `vuln:` フィルタに製品・バージョンフィルタを重ねることで、「特定のCVEに該当しうる資産」を絞り込む。組織側での防御的運用としては、自組織のASN（自律システム番号、組織が保有するIPアドレス範囲の識別子）や `org:` フィルタと組み合わせて定期的に自己スキャンし、パッチ未適用資産の洗い出しに使うのが典型的な使い方である。

> 出典: Shodan Search Queries Cheat Sheet — https://vespersec.net/docs/osint-reconnaissance/shodan-search-queries-cheat-sheet/

#### CLI／APIの利用

Shodan は Web UI に加えて Python 向けの公式ライブラリを提供しており、`pip install shodan` でインストールし、APIキーで認証した上で `shodan search` コマンドや Python API から同じクエリを実行できる。フィールド選択（必要なバナー項目のみを抽出するオプション）を使うことで、大量の検索結果からCSVやJSON形式で必要な列だけを取り出せる。これにより、自組織のASN全体を対象にした定期的な資産インベントリ（社内で「今どの資産が外部に何を晒しているか」を継続的に記録する棚卸し作業）をスクリプト化できる。原典は倫理的要件として「認可された対象のみに使用し、明示的な書面上の許可なくシステムを悪用・アクセスしてはならない」ことを明記している。

> 出典: Shodan Search Queries Cheat Sheet — https://vespersec.net/docs/osint-reconnaissance/shodan-search-queries-cheat-sheet/

### Censys のデバイス検索構文

Censys も Shodan と同様にインターネット全体をスキャンしてバナー・証明書情報をインデックス化するサービスだが、検索構文がより構造化されており、フィールドが `services.port` のようにネストされたJSON構造のパスとして表現される点が特徴である。これはCensysの内部データモデルが「ホスト単位のドキュメントに、複数のサービス（ポートごとの応答）が配列として格納される」設計になっているためで、検索クエリはこのドキュメント構造に対するフィールドクエリとして機能する。

#### 論理演算子とマッチング演算子

| 演算子 | 機能 | 例 |
|---|---|---|
| `AND` | 複数条件の論理積（両方成立するホストのみ） | `services.port: 443 AND location.country: US` |
| `OR` | 複数条件の論理和（いずれか成立するホスト） | `80.http OR 443.https` |
| `NOT` | 条件の除外 | `NOT autonomous_system.name: "Cloudflare"` |
| `=` | 完全一致（値全体が正確に一致するもののみ） | `services.service_name: SSH` |
| `:` | あいまい一致（部分一致・トークン一致を許容） | `labels: "webcam"` |
| `()` | 複雑な条件のグループ化（演算子の優先順位を明示） | `(80.http OR 443.https) AND location.country: US` |

> 出典: Censys Device Search Cheat Sheet — https://vespersec.net/docs/osint-reconnaissance/censys-device-search-cheat-sheet/

**なぜ `:` と `=` を区別するのか（仕組み）**: Censys の検索エンジンは全文検索エンジン（Elasticsearch系）をバックエンドに持つため、`:` はトークナイズ（文字列を単語やパターン単位に分割する処理）されたインデックスに対するあいまい一致になり、`=` は元のフィールド値に対する厳密一致になる。例えば `services.service_name: SSH` は "SSH" というトークンを含むサービス名（大文字小文字を無視した部分一致に近い挙動）にマッチしうるのに対し、完全一致演算子を使うとフィールド値がちょうど一致するものだけに絞られる。あいまい一致は取りこぼしを減らせる反面、意図しない広い範囲がヒットしやすく、逆に完全一致は精度は高いが原文の表記揚れ（大文字小文字・スペースの有無など）に弱い。防御側が自組織の露出資産を洗い出す際は、まずあいまい一致で広く候補を出し、次に完全一致で絞り込むという二段階の使い方が実務的である。

#### 高価値なクエリ例（分野別）

- **Web基盤の把握**: `services.http.response.headers.server: "Apache"` のようにレスポンスヘッダから使用ソフトウェアを検出、`80.http.get.title: "Login"` のようにページタイトルから管理画面やログインページを検出する。
- **リスクの高い露出サービス**: `services.port: 3389 AND os.description: "Windows"` でRDPを稼働させているWindowsホストを特定、`services.service_name: RDP` でサービス名ベースでも同種の資産を検出できる。これらは典型的なランサムウェア初期侵入経路であり、防御側にとっては「本来インターネットに公開してはいけないサービスが公開されていないか」の定期チェック対象である。
- **IoT機器**: `labels: "webcam"` のようにCensys側が付与した分類ラベル（機器の種類を推定してタグ付けした情報）で検索、`services.port: 554 AND services.service_name: RTSP` でストリーミングカメラのRTSP（Real Time Streaming Protocol、映像配信用プロトコル）ポートを特定する。
- **データストア**: `services.port: 27017 AND services.service_name: MONGODB`（MongoDB）、`services.port: 6379 AND services.service_name: REDIS`（Redis）。いずれも認証なしで外部公開されているインスタンスが後を絶たない、設定ミス検出の定番クエリである。
- **TLS証明書ベースの調査**: `services.tls.certificates.leaf_data.subject_dn: "CN=example.com"` で証明書のサブジェクトDN（識別名、証明書に記載された対象の完全な識別情報）を検索し、`services.tls.certificates.leaf_data.issuer_dn: "Let's Encrypt"` のように発行者DNで絞り込むこともできる。これはShodanの `ssl.cert.subject.cn:` と同じ原理（証明書チェーンの解析結果をインデックス化）に基づくが、Censysはleaf（末端）証明書のフィールドを構造化して保持しているため、発行者側からの逆引き（「この認証局が発行した証明書を持つホストを全部見せて」）がしやすい。
- **脆弱ソフトウェアの検出**: `services.software.product: "Apache Struts"` のように、Censysが独自に推定したソフトウェア製品名フィールドでの検索も可能である。

> 出典: Censys Device Search Cheat Sheet — https://vespersec.net/docs/osint-reconnaissance/censys-device-search-cheat-sheet/

#### CLIとレート制限

Censys も `pip install censys && censys config` でCLIをセットアップし、APIキーを設定後に

```
censys search 'QUERY' --index-type hosts --pages COUNT --fields field1,field2
```

の形式でクエリを実行できる。`--index-type hosts` はホスト単位インデックスを指定するオプション、`--fields` は取得するフィールドを限定するオプションで、必要な情報だけを取得することでAPIクォータ（利用回数の上限）の消費を抑えられる。結果は `--output results.json` でファイルへ書き出せる。

原典は無料プランのクォータが月間250クエリであることを明記している（**2024年時点の情報であり、Censysの料金・クォータ体系は変更されることが多いため、実際に利用する際は公式サイトで最新の条件を確認する必要がある**）。有料プランではクォータが拡張される。原典はまた「短時間に大量のAPIコールを行うことを避け、検知シグナルを最小化するために正当なインフラからのアクセスに見えるようフィルタする」ことを推奨事項として挙げている。

> 出典: Censys Device Search Cheat Sheet — https://vespersec.net/docs/osint-reconnaissance/censys-device-search-cheat-sheet/

この「検知回避」に関する記述は、あくまで研究者・脅威インテリジェンス担当者が大規模スキャン対象から自分自身のAPIトラフィックを識別されにくくするための一般的な助言であり、本教科書としては**この記述を無許可の探索的スキャンや偵察活動の推奨として扱わない**。防御目的での正しい読み方は、「自組織のAPI利用ログやWAF側で、Shodan・Censysなど既知のスキャナIPレンジ（両社は公開しているスキャナのIPリストを提供している）からのアクセスをどう識別・分離するか」という観点で応用することである。

### 防御的な活用方法のまとめ

Shodan と Censys のクエリ構文は、攻撃者にとっての「初期の足がかり探索」ツールであると同時に、防御側にとっては最も低コストな**外部攻撃対象領域（Attack Surface）の可視化**手段でもある。実務上は次のような使い方が推奨される。

1. 自組織のASN・IPレンジ・ドメインを対象に `org:`／`autonomous_system.name` フィルタで定期検索し、意図しない公開資産（テスト環境、放置されたVPN機器、デフォルト認証のIoT機器など）を洗い出す。
2. `vuln:` やソフトウェア・バージョンフィルタを使い、パッチ未適用の資産が外部から検出可能な状態にないかを継続監視する。
3. TLS証明書関連のフィルタ（`ssl.cert.subject.cn:` や `subject_dn:`）を使い、内部専用の証明書やサブドメイン名がうっかり外部公開証明書に含まれていないかを確認する（証明書のSANはCTログにも記録されるため、他の受動的偵察手法とも突き合わせて評価する）。
4. データストアや管理系ポート（MongoDB、Redis、RDP、VNCなど）が既定ポートで外部到達可能になっていないかを、既定ポートベースのクエリで棚卸しする。

これらはいずれも「自組織資産に対する受動的な確認」であり、他者の資産探索や無許可の検証行為ではない。検索結果を実際の脆弱性検証や侵入テストに用いる場合は、必ず対象資産の管理者から明示的な許可（スコープが明記された契約や承認書）を得た範囲でのみ実施すること。

---

[← 第3章 サブドメイン列挙を深く](03-subdomain-enumeration.md) ｜ [📖 目次](index.md) ｜ [第5章 コンテンツ・パラメータ・APIエンドポイント発見 →](05-content-discovery.md)
