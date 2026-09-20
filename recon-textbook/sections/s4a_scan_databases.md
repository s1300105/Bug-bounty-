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
