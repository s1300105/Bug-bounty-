## Kettle のキャッシュポイズニング論文（2018 / 2020）

James Kettle（PortSwigger Research、ハンドル `albinowax`）が発表した2本の研究は、Web キャッシュポイズニング（cache poisoning：攻撃者のリクエストが「有害なレスポンス」をキャッシュに保存させ、それを他ユーザーへ配信させる攻撃）を「理論上ありうる程度の攻撃」から「大規模実サービスを現実に落とせる攻撃」へと引き上げた。本節では、リクエストスマグリングと並ぶ「共有キャッシュを汚す」系統の最重要文献として、この2本を仕組みレベルで解説する。

- **2018年**: *Practical Web Cache Poisoning*（Black Hat USA 2018 / DEF CON 26 でも発表）。「Unkeyed input（キャッシュキーに含まれない入力）」という切り口で、ヘッダを使ったポイズニングを体系化した。
- **2020年**: *Web Cache Entanglement: Novel Pathways to Poisoning*（Black Hat USA 2020）。焦点を「キャッシュキーそのものの扱い方の不一致」へ移し、Fat GET・パラメータクローキング・キャッシュキー正規化・キー注入・内部キャッシュポイズニングなど、より深い攻撃面を開拓した。

> ℹ️ **注記**: 本節では2つの一次資料（記事）を WebFetch で取得できた。Entanglement のホワイトペーパーPDFも取得でき、記事内容を裏付けている。一方、Black Hat 2018 のスライドPDF（`us-18-Kettle-Practical-Web-Cache-Poisoning...pdf`）はファイルサイズ超過で自動取得できなかったが、内容は2018年記事とほぼ同一であるため本文でカバーしている。

> ⚠️ **未取得の資料**: 「Practical Web Cache Poisoning Black Hat スライドPDF」は自動取得できませんでした（理由: レスポンスが取得上限10MBを超過）。以下のURLからご自身で直接ご覧ください: https://i.blackhat.com/us-18/Thu-August-9/us-18-Kettle-Practical-Web-Cache-Poisoning-Redefining-Unexploitable.pdf
> （以下は未取得資料の補足として一般知識に基づく解説です）このスライドは2018年記事の口頭発表版で、記事の各事例（Red Hat、Mozilla SHIELD、Unity、Drupal など）をデモ付きで示す構成です。本文の2018年パートを読めばスライドの技術内容は網羅できます。

---

### 前提：キャッシュとキャッシュキーの基礎（仕組み）

Web キャッシュ（CDN、リバースプロキシ、Varnish、Cloudflare、Fastly、Akamai など）は、ユーザとオリジンサーバの間に立ち、レスポンスのコピーを保持して遅延とサーバ負荷を減らす。キャッシュが「この2つのリクエストは同じリソースを指す＝同じキャッシュ済みレスポンスを返してよい」と判断する仕組みが**キャッシュキー（cache key）**である。

典型的なキャッシュキーは次の要素だけから作られる。

```
キャッシュキー例:
  https | GET | portswigger.net | /research?x=1
  （スキーム・メソッド・ホスト・パス・クエリ文字列）
```

ここで決定的に重要なのは、`User-Agent`、`Cookie`、`Accept-Language`、`X-Forwarded-Host` といった**多くのリクエストヘッダはキャッシュキーに含まれない**という点だ。キャッシュキーに含まれない入力を **unkeyed input（アンキード入力）** と呼ぶ。

Kettle の一貫した洞察は次の一文に集約される。

> **unkeyed input によって引き起こされたレスポンスの差分は、キャッシュに保存され、他のユーザに配信されうる。**

つまり、アプリがキャッシュキーに含まれないヘッダを使ってレスポンスを組み立てていると、攻撃者はそのヘッダで有害なレスポンスを生成させ、それを「通常のパス・クエリ」というキーの下に保存させることができる。以後、同じパスを普通に開いた無関係のユーザ全員が汚染レスポンスを受け取る。これがポイズニングの原理である。

#### 実験を安全にする道具：キャッシュバスター（cache buster）

テスト中に本物のユーザを巻き込まないため、Kettle は**キャッシュバスター**を使う。これはキャッシュキーを一意にするためだけの無害なクエリ（例 `?cb=1` や Param Miner が付ける `?$randomplz`）で、自分専用のキャッシュエントリを作って安全に試験するための必須テクニックだ。

> スコープ注記（本教科書共通）: 本節は防御目的の解説である。実在サービスや本番環境への無許可検証は行わない。以下のペイロードやホスト名は、原典で報告済み・修正済みの事例および原理説明のための最小例であり、読者自身の管理下にある検証環境でのみ再現すること。

---

### 2018年: Practical Web Cache Poisoning

「Redefining 'Unexploitable'（『悪用不能』の再定義）」という副題どおり、この論文の核心的主張は次のとおり。

> **単独では悪用不能とされてきた「ヘッダ経由の XSS/オープンリダイレクト」は、キャッシュポイズニングと組み合わさると現実の大規模攻撃になる。**

なぜなら通常、攻撃者は被害者のブラウザに任意の `X-Forwarded-Host` などのヘッダを送らせることができない。だが**キャッシュを一度汚せば、被害者は普通のリクエストを送るだけで汚染済みレスポンスを受け取る**。ヘッダを届ける必要はキャッシュが肩代わりしてくれる。

#### 方法論（4ステップ）

1. **unkeyed input を特定する** — `Param Miner`（Burp 拡張）でヘッダ名/クッキー名を総当り推測し、レスポンスに反映される「キーに含まれない入力」を発見する。
2. **被害の大きさを評価する** — その入力で XSS・リダイレクト等の有害レスポンスを引き起こせるか確認する。
3. **キャッシュさせる** — レスポンスがキャッシュ条件（`Cache-Control` 等）を満たすようにする。
4. **保存を検証する** — 汚染レスポンスが本当に他ユーザにも配信されるか、`X-Cache: hit` 等で確認する。

#### 定番の unkeyed ヘッダ

多くのフレームワーク/リバースプロキシは、Host を上書きする目的で以下のヘッダを信用してしまう。これらは通常キャッシュキーに含まれないため、格好のポイズニング入力になる。

- `X-Forwarded-Host`（Host の上書き。最頻出）
- `X-Host`
- `X-Forwarded-Scheme`（http/https スキームの上書き）
- `X-Original-URL` / `X-Rewrite-URL`（パスの上書き。Symfony・Zend・Drupal が対応）

#### 事例①：X-Forwarded-Host → XSS（Red Hat）

`X-Forwarded-Host` がページ内の絶対URL生成に使われている例。まずキャッシュバスター `?cb=1` を付けて安全に反映を確認する。

```http
GET /en?cb=1 HTTP/1.1
Host: www.redhat.com
X-Forwarded-Host: canary

HTTP/1.1 200 OK
Cache-Control: public, no-cache
…
<meta property="og:image" content="https://canary/cms/social.png" />
```

**なぜこうなるか**: アプリは Host ではなく `X-Forwarded-Host` の値 `canary` を信用して `og:image` の絶対URLを組み立てている。この値はキャッシュキーに含まれないため、キーは `/en?cb=1` のまま。したがって同じ URL を開いた他ユーザにも `canary` を含むレスポンスが返る。反映位置が属性値なので、値を閉じてスクリプトを挿入すればキャッシュ済み XSS になる。

```http
GET /en HTTP/1.1
Host: www.redhat.com
X-Forwarded-Host: a."><script>alert(1)</script>
```

`X-Host` も同様に script タグに反映される（Unity3D の事例）。

#### 事例②：Mozilla SHIELD の乗っ取り（影響の規模）

Firefox の SHIELD システムは `normandy.cdn.mozilla.net` からレシピ（自動実行される設定JSON）を取得する。この API のレスポンスが `X-Forwarded-Host` を反映していたため、キャッシュを汚染すると**世界中の Firefox（当時、毎日数百万規模）が攻撃者制御のレシピサーバへ誘導される**状況を作れた。

**なぜ深刻か**: SHIELD のレシピはブラウザ内で特権的に処理される。1回のキャッシュポイズニングで、無関係な全ユーザのブラウザが攻撃者のエンドポイントを向く——ヘッダ攻撃が「1人にしか届かない」限界を、キャッシュが「全員に届く」に変える典型例だ。

#### 事例③：X-Forwarded-Scheme でのリダイレクト乗っ取り

スキームを上書きできると、「https でない」と誤認させて外部ドメインへの 301 を発生させられる。

```http
GET /en HTTP/1.1
X-Forwarded-Host: attacker.com
X-Forwarded-Scheme: nothttps

HTTP/1.1 301 Moved Permanently
Location: https://attacker.com/en
```

**なぜこうなるか**: アプリは「スキームが https でなければ正規URLへリダイレクトする」ロジックを持ち、その正規ホストを `X-Forwarded-Host` から取っている。両ヘッダとも unkeyed なので、この 301 がキャッシュされ、以後の全アクセスが `attacker.com` へ飛ぶ。

#### 事例④：Drupal のオープンリダイレクト検証バイパス

```http
GET //?destination=https://evil.net\@unity.com/ HTTP/1.1
Host: unity.com

HTTP/1.1 302 Found
Location: https://evil.net\@unity.com/
```

**なぜこうなるか**: サーバ側の検証は `@unity.com` が付いているので「unity.com 宛」と誤認するが、ブラウザは URL 内の `\` を `/` として解釈するため、実際の遷移先は `evil.net/@unity.com` になる。パーサ差異（サーバとブラウザで `\@` の解釈が違う）を突く古典で、これをキャッシュに載せて恒久化している。

#### 事例⑤：ネスト（多段）キャッシュポイズニング

内部キャッシュ（Drupal 内部）を使って外部キャッシュを汚す2段攻撃。

- **段階1**: 内部キャッシュのエントリ `/redir` を悪性リダイレクトで汚染する。
- **段階2**: 外部キャッシュのエントリ `/download` を、`/redir` を指すように汚染する。
- **結果**: ダウンロードが攻撃者サーバ経由になる。

**要点**: キャッシュは1層とは限らない。多層構成では、片方のキャッシュをガジェットとして使い、もう片方を汚せる。

#### 標的の絞り込みと Vary

- **CloudFlare のロケーション標的化**: `/cdn-cgi/trace` というデバッグ用エンドポイントが `colo=AMS`（アムステルダム）等でキャッシュの所在地を明かす。IPルーティングを工夫すれば特定地域キャッシュだけを狙って汚染できる。
- **`Vary: User-Agent`**: 一部キャッシュはこれを尊重し、汚染レスポンスを特定 UA にだけ配信する。攻撃者から見れば「Firefox ユーザだけを狙う」といった選択的標的化にも使える。

#### DoS への転用

キャッシュポイズニングは XSS/リダイレクトだけでなく、**汚染したエラーレスポンスや壊れたレスポンスを配信させることでサービス不能（DoS）**にもできる。「全員に同じ壊れた応答を返す」ことがキャッシュの本質だからだ。

#### 2018年の防御策

- キャッシュを完全に無効化する（高トラフィックサイトでは非現実的）。
- 純粋に静的なレスポンスだけをキャッシュ対象にする。
- レスポンス生成にヘッダ/クッキーを使わない。
- `Param Miner` で自サイトの unkeyed input を棚卸しする。
- キャッシュ層で unkeyed 入力を除去（strip）する。
- 重要な入力は `Vary` ヘッダやカスタムキー定義で**キャッシュキーに含める**。

> 出典: Practical Web Cache Poisoning — https://portswigger.net/research/practical-web-cache-poisoning

---

### 2020年: Web Cache Entanglement（Novel Pathways to Poisoning）

2018年が「アプリがヘッダを反射することによる汚染」だったのに対し、2020年は視点を変える。核心は「**キャッシュがキーを計算する処理と、オリジンがリクエストを解釈する処理の“ずれ（entanglement＝もつれ）”そのものが脆弱性である**」という発見だ。反射するヘッダが無くても、このずれを突けば汚染できる。

#### キャッシュキー処理の「変換」を洗い出す

キャッシュは生のリクエストからそのままキーを作るとは限らない。多くの実装が独自の**変換**を掛ける。Kettle はこの変換こそ攻撃面だと見た。

- 特定のクエリパラメータをキーから除去する
- クエリ文字列全体をキーから除外する
- Host からポートを除去する
- キーを作る前に**URLデコードする**

攻撃の第一歩は「**キャッシュオラクル**」（`X-Cache`/`CF-Cache-Status` 等でヒット/ミスを教えてくれ、URL やパラメータを反映するキャッシュ可能エンドポイント）を選び、リクエストを少しずつ変えて「このキャッシュはキーをどう変換するか」を突き止めることだ。

#### クエリがキーから除外される場合（Unkeyed Query）

クエリ文字列全体がキーから外れていると、動的ページが「静的ページのように」振る舞い、クエリで注入した内容がキーを変えずにキャッシュされる。

```http
GET //?"><script>alert(1)</script> HTTP/1.1
Host: redacted-newspaper.net

→ キャッシュキー: https://redacted-newspaper.net//
```

**なぜこうなるか**: クエリがキーに含まれないので、キーは `//` だけ。攻撃者が注入した `"><script>...` を含むレスポンスが `//` の名前で保存され、以後 `//` を開く全員に配信される。検出には、`Accept-Encoding`/`Cookie`/`Origin` 等をキャッシュバスターに使う、パス正規化（Apache は `//`、Nginx は `/%2F`、PHP は `/index.php/xyz`）で自分専用キーを作る、`PURGE`/`FASTLYPURGE` でキャッシュを消す、などのテクニックを使う。

#### Fat GET リクエスト

**Fat GET** とは「**ボディ付きの GET リクエスト**」のこと。一部フレームワークはボディ内のパラメータを処理するが、キャッシュはボディをキーに含めない。

```http
GET /contact/report-abuse?report=albinowax HTTP/1.1
Host: github.com
Content-Type: application/x-www-form-urlencoded
Content-Length: 22

report=innocent-victim
```

**なぜこうなるか**: フレームワーク（Rails 等）はクエリの `report=albinowax` よりボディの `report=innocent-victim` を優先採用する一方、キャッシュはキーを `?report=albinowax` のまま作る。結果、「キー上は albinowax、中身は innocent-victim」という汚染レスポンスが保存される。影響を受けた実装は **Varnish（builtin.vcl 無効時）・Cloudflare・Rack::Cache・Ruby on Rails** など。防御は明快で「**GET のボディをサポートしない/無視する**」。

#### パラメータクローキング（Parameter Cloaking）

「特定パラメータだけをキーから除外する」設定を悪用し、**任意のパラメータをキーから隠す**手口。URLパーサの癖を突く。

**Varnish の正規表現バイパス**:

```
元の除外ロジック: regsuball(hash_url, "\?_=[^&]+&", "?")

バイパス: GET /search?q=help?_=payload&!&search=1
```

**なぜこうなるか**: 除外用の正規表現は「`?_=...&` を1個消す」前提だが、余分な `?_=` を注入すると正規表現の想定が崩れ、本来キーに残すべきパラメータをキーから外させたり、その逆を起こせる。

**Akamai のパラメータ汚染**:

```http
GET /en?x=1?akamai-transform=payload HTTP/1.1
```

`?` を2個入れる雑なURL解析を突き、unkeyed パラメータへ改変を継ぎ足す。

**Ruby on Rails のセミコロン区切り**: Rails は `;` も `&` と同じパラメータ区切りとして扱う。

```http
GET /jsonp?callback=legit&utm_content=x;callback=alert(1)// HTTP/1.1

Rails の解釈: callback=legit, utm_content=x, callback=alert(1)
（2つ目の callback を採用。utm_content はキーから除外される）
```

**なぜこうなるか**: キャッシュは `;` を区切りと見ないので `utm_content=x;callback=alert(1)//` を1つの `utm_content` 値（＝キーから除外対象）と見なす。だが Rails は `;` で分割し、2つ目の `callback=alert(1)` を JSONP コールバックとして採用する。「キャッシュにとっては無害な utm_content、Rails にとっては悪性の callback」というずれが汚染を生む。

#### キャッシュキー正規化攻撃（Normalization）

オリジンとキャッシュで**URLの正規化（デコード等）が食い違う**ことを突く。

**Firefox アップデートの汚染（Mozilla）**: Nginx はキャッシュキーにだけ URLデコードを掛け、リクエスト自体は無加工で転送する。

```http
GET /%3fproduct=firefox-73.0.1-complete&os=osx&lang=en-GB HTTP/1.1
Host: download.mozilla.org

キー（デコード後）: /?product=firefox-73.0.1-complete...
バックエンド受信: /%3fproduct...（不正で、エラーリダイレクトを返す）
```

**なぜこうなるか**: `%3f` は `?` のエンコード。Nginx はキー計算時に `%3f`→`?` とデコードするので、キーは正規の更新URL `/?product=...` と衝突する。しかしバックエンドには `%3f` のまま届くのでパスが壊れ、エラーリダイレクトが返る。そのエラーが正規URLのキーで保存され、**その後の正規の Firefox 更新リクエストが全部キャッシュ済みエラーを受け取り、世界規模で更新が壊れる**。

**Cloudflare のリダイレクト反射バイパス**:

```http
GET /login?x=%6cong-string HTTP/1.1
Host: www.cloudflare.com

HTTP/1.1 301 Moved Permanently
Location: /login/?x=long-string
CF-Cache-Status: HIT
```

`%6c` は `l`。URLエンコードで反射制限をすり抜けつつ、デコードされた値をリダイレクト先に載せている。

#### キャッシュキー注入（Key Injection）

キャッシュがキーを**区切り文字を無エスケープで連結**して作ると、別リクエストと同じキーを故意に衝突させられる。

```
リクエスト1:
GET /?x=2 HTTP/1.1
Origin: '-alert(1)-'__

内部キー: /D/000/example.com/ cid=x=2__Origin='-alert(1)-'__

リクエスト2:
GET /?x=2__Origin='-alert(1)-' HTTP/1.1
→ 同じキーになり、2つ目のリクエストが注入スクリプトを実行する
```

**なぜこうなるか（Akamai の例）**: キーが `cid=` や `Origin=` を素の文字列連結で作られているため、攻撃者はクエリ側に `Origin=...` 相当の文字列を書くだけで、ヘッダで作ったキーと衝突するキーを再現できる。攻撃者が1回汚染したエントリを、被害者が普通のクエリで踏む。

#### 内部キャッシュポイズニング（Internal Cache Poisoning）

WP Rocket のようなアプリ内キャッシュは、従来型のキャッシュキーを持たずにレスポンス断片をキャッシュすることがあり、**盲目的（blind）に汚染**できる。

- **DoD イントラネットの例**: 壊れたリダイレクトがエラーページを生み、それがアプリ層でキャッシュされ、外部からは到達不能な内部管理画面にまで影響した。
- **検出の手掛かり**: 1レスポンス内に複数の canary（目印値）が出る、無関係なページに canary が出る、同一アプリに解決される複数ホスト名で挙動が一致する、など。

#### リダイレクト DoS（クエリ長パディング）

```http
GET /login?x=very-long-string-padding HTTP/1.1
Host: www.cloudflare.com

HTTP/1.1 301 Moved Permanently
Location: /login/?x=very-long-string-padding

→ 被害者のブラウザは Location へ再リクエスト:
GET /login/?x=very-long-string-padding HTTP/1.1
（余分な "/" でURIが最大長を超える）

HTTP/1.1 414 Request-URI Too Large
```

**なぜこうなるか**: リダイレクト先にパスの余分な `/` が付き、クエリを限界近くまで水増ししておくと、被害者側の再リクエストURIが上限超過して 414 になる。汚染された 301 がキャッシュされているため、正規ユーザが軒並みログインできなくなる。

#### 「悪用不能」ガジェットの再評価

Kettle は、従来「無害」と切り捨てられてきた反射を、キャッシュと組み合わせれば武器になると強調する。

- **リソースファイル注入**: クエリを反射する CSS/JS。

```http
GET /style.css?x=a);@import... HTTP/1.1
→ @import url(/site/home/index-part1.css?x=a);@import...
```

- **エンコード済み XSS の悪用**: 「ブラウザが URLエンコードするから無害」とされてきた自己XSSを、キャッシュのURLデコード挙動で有効化する。

```
攻撃者リクエスト: GET /?x="/><script>alert(1)</script>
キー（URLデコード後）: /?x="/><script>alert(1)</script>

被害者ブラウザ（自動でURLエンコード）: GET /?x=%22/%3E%3Cscript%3E...
キー（URLデコード後）: /?x="/><script>alert(1)</script>
→ キャッシュヒットし、XSS が発火する
```

**なぜこうなるか**: 被害者のブラウザは危険文字をエンコードして送るが、キャッシュはキー計算前にデコードするため、攻撃者が事前に作った生デコードのキーと一致する。攻撃者版レスポンス（生の `<script>`）が被害者に返り、自己XSSが他者XSS化する。

#### 2020年の防御策

- **キャッシュキーを書き換えるのではなく、実際のリクエストを書き換える**（キーとオリジンの解釈を一致させる）。
- **Fat GET のサポートを無効化する。**
- 自己XSS・エンコード済みXSS・リソース反射などの「悪用不能」を、実在の脆弱性として扱い修正する。
- キャッシュキーを独自ロジックで書き換えること自体を避ける。

> 出典: Web Cache Entanglement: Novel Pathways to Poisoning — https://portswigger.net/research/web-cache-entanglement
>
> 出典（ホワイトペーパーPDF）: Web Cache Entanglement whitepaper — https://portswigger.net/kb/papers/c3wwniai/web-cache-entanglement.pdf

---

### 2本を貫く教訓（リクエストスマグリングとの接続）

両論文の根底にある原理は、本教科書の主題であるリクエストスマグリングと同型だ。すなわち「**同じバイト列を、経路上の2つのコンポーネントが違う意味に解釈する（parser discrepancy）とき、両者の隙間に攻撃が生まれる**」。

- リクエストスマグリング＝フロントエンドとバックエンドで「リクエストの境界」の解釈がずれる。
- キャッシュポイズニング（Entanglement）＝キャッシュとオリジンで「キーの計算/URLの正規化/パラメータの区切り」の解釈がずれる。

さらに実務上、両者は**連結できる**。2018年記事でも触れられるとおり、リクエストスマグリングやレスポンス分割（HTTP Response Splitting）は、unkeyed ヘッダを持たないサイトでもキャッシュを汚染する「別ルート」になる。スマグリングで有害レスポンスをキャッシュに載せれば、被害範囲は1接続から全ユーザへ拡大する。

防御の一般原理も共通している。

1. **解釈を一致させる**: キャッシュ層とオリジンで、正規化・区切り・キー定義を揃える（あるいはキーを書き換えず素通しする）。
2. **曖昧入力を減らす**: Fat GET、二重 `?`、`;` 区切り、エンコード揺れなど、パーサ差を生む入力を拒否・正規化する。
3. **キャッシュ対象を絞る**: 純粋に静的なレスポンスに限定し、ヘッダ/クッキー由来の可変レスポンスはキャッシュしない。
4. **重要入力をキーに含める**: 反射・分岐に使う入力は必ずキャッシュキー（`Vary` やカスタムキー）へ入れる。
5. **「悪用不能」を放置しない**: 単独では無害に見える反射も、キャッシュ/スマグリングと組めば全ユーザ規模の攻撃になりうる、という前提で修正する。

> 出典: Practical Web Cache Poisoning — https://portswigger.net/research/practical-web-cache-poisoning
> 出典: Web Cache Entanglement — https://portswigger.net/research/web-cache-entanglement
