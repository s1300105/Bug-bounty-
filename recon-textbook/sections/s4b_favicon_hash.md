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
