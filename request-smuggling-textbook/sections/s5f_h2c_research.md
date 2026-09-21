## h2c / 上位HTTPバージョン経由スマグリングの研究

古典的なリクエストスマグリング（HTTP Request Smuggling、以下 HRS）は、`Content-Length` と `Transfer-Encoding` の解釈差という「HTTP/1.1 パーサ同士のズレ」を突く攻撃だった。しかし攻撃対象のプロトコルが HTTP/2・HTTP/3 へ移り、さらに TLS を張らずに HTTP/2 を話す **h2c（HTTP/2 Cleartext）** という仕組みが内部通信で使われ始めたことで、スマグリングの舞台は「バージョン境界」そのものへと広がった。

本節では、発展的スマグリング技法のうち次の2つを研究レベルで扱う。

1. **h2c スマグリング** — フロントプロキシに HTTP/1.1 の Upgrade 機構を悪用させ、プロキシを「素通しトンネル」に変え、バックエンドへ直接 HTTP/2 で話しかけてアクセス制御を回避する技法（Bishop Fox / Jake Miller）。
2. **上位 HTTP バージョン経由のスマグリング** — HTTP/2・HTTP/3 を HTTP/1.1 へ「ダウングレード変換」する際に生まれるパース差を突く技法（Emil Lerner）。

どちらも「境界にいる中間装置（プロキシ・ロードバランサ・キャッシュ）が、上位プロトコルを完全には理解できないまま転送してしまう」という共通構造を持つ。ここが本節の核心である。

> ⚠️ **スコープの明示**: 本節は防御・検知の理解を目的とする。手法の原理と、影響を測るための「自分が管理・許可を得た検証環境での考え方」を説明する。実在サービスや本番環境への無許可検証、破壊的な手順は記述しない。

---

### 1. 前提知識: h2c（HTTP/2 Cleartext）とは何か

#### HTTP/2 の3つの起動方法

HTTP/2 は「バイナリのフレーム」でやり取りするプロトコルだが、その通信を**どう開始するか**には歴史的に複数の道がある。

| 方式 | 略称 | 起動の合図 | 典型的な用途 |
|------|------|------------|--------------|
| TLS-ALPN ネゴシエーション | h2 | TLS ハンドシェイク中に ALPN 拡張で `h2` を選ぶ | ブラウザ↔公開 Web サーバ（暗号化必須） |
| Upgrade 機構（平文） | h2c | HTTP/1.1 リクエストに `Upgrade: h2c` を付ける | サーバ間・マイクロサービスの平文内部通信 |
| Prior Knowledge（事前合意） | h2c | 最初からクライアントが HTTP/2 の接続プリフェイス（`PRI * HTTP/2.0\r\n...`）を送る | 相手が h2c 対応と分かっている内部通信 |

ここで重要なのは、**ブラウザは h2c を一切使わない**という点だ。ブラウザの HTTP/2 は必ず TLS 上の h2（ALPN）である。h2c は主に「データセンター内部で、低レイテンシのために TLS を省いてサーバ同士が HTTP/2 で話す」ために存在する。つまり h2c 対応バックエンドは「外からは直接触られない前提」で置かれていることが多く、これが攻撃価値を生む。

> sink（入力が最終的に解釈・実行される危険な到達先）の観点で言えば、h2c 対応バックエンドは「本来フロントプロキシのアクセス制御でしか到達できないはずの sink」であり、h2c スマグリングはそこへ**制御を素通しして届かせる**攻撃だ、と捉えると分かりやすい。

#### Upgrade 機構による h2c 起動（RFC 7540 §3.2）

平文で HTTP/2 に切り替える正規の手順は、HTTP/1.1 の汎用アップグレード機構（`Upgrade` ヘッダ、WebSocket と同じ仕組み）を使う。Bishop Fox の解説にある具体例は次のとおり。

```http
GET / HTTP/1.1
Host: www.example.com
Upgrade: h2c
HTTP2-Settings: AAMAAABkAARAAAAAAAIAAAAA
Connection: Upgrade, HTTP2-Settings
```

各ヘッダの意味と「なぜそう書くか」は以下の通り。

- **`Upgrade: h2c`** — 「この接続を h2c（平文 HTTP/2）に切り替えたい」という要求。切り替えるトークンを指定する。
- **`Connection: Upgrade, HTTP2-Settings`** — `Connection` はホップバイホップ（hop-by-hop、隣接する1区間だけで有効）ヘッダを列挙するためのもの。ここに `Upgrade` と `HTTP2-Settings` を並べることで「この2つは今の接続限りの制御ヘッダだ」と宣言する。**本来、中間プロキシはここに挙がったヘッダを消費して次段へは転送しないのが正しい挙動**である。この「本来消すべきものを消さずに転送する」実装バグこそが攻撃の入口になる。
- **`HTTP2-Settings: AAM...`** — HTTP/2 の初期 SETTINGS フレーム（最大同時ストリーム数などの接続パラメータ）を Base64URL でエンコードしたもの（RFC 7540 §3.2.1）。サーバが即座に HTTP/2 設定を知るために添える。

サーバが受理すると `101 Switching Protocols` を返し、以降その TCP 接続は HTTP/2 のバイナリフレームで会話するトンネルに変わる。

---

### 2. h2c スマグリングの原理（Bishop Fox）

> ⚠️ **未取得の資料**: 「h2c Smuggling: Request Smuggling Via HTTP/2 Cleartext (h2c)」（Bishop Fox 技術ブログ、labs.bishopfox.com の元 URL）は、egress 側の名前解決失敗（`getaddrinfo ENOTFOUND` / archive.org もフェッチ不可）により自動取得できませんでした。以下から直接ご覧ください:
> - 記事: https://bishopfox.com/blog/h2c-smuggling-request
> - 旧 URL: https://labs.bishopfox.com/tech-blog/h2c-smuggling-request-smuggling-via-http/2-cleartext-h2c
> - ツール/README: https://github.com/BishopFox/h2csmuggler
>
> 以下は、同一内容の Bishop Fox ブログ現行版と公式 README を自動取得できた分に基づく解説である。技術的な結論・コマンド例は原典から抽出している。

#### 攻撃の中核: 「トンネル化でプロキシが盲目になる」

エッジプロキシ（リバースプロキシ）は通常、パス単位のアクセス制御を持つ。たとえば NGINX で次のように「`/flag` への外部アクセスは全拒否」しているとする。

```nginx
location /flag {
    deny all;
}
```

ところがプロキシが h2c の Upgrade 要求を**そのままバックエンドへ転送**してしまうと、次の連鎖が起きる。

1. クライアントがエッジプロキシ宛に `Upgrade: h2c` 付きリクエストを送る。
2. 脆弱なプロキシは `Upgrade` / `Connection` ヘッダを消費せずバックエンドへ転送する。
3. h2c 対応バックエンドが `101 Switching Protocols` を返す。
4. **101 を見たプロキシは「もうこの接続は自分の管理外の生の TCP トンネルだ」と判断し、以降の中身を解釈しなくなる（content-unaware になる）。**
5. その結果、プロキシは「HTTP/2 トンネルの中を流れる個々のリクエスト」を検査できない。`/flag` 拒否ルールも、認証も、WAF も、全部トンネルの外側の話になり効かなくなる。

Bishop Fox の表現を借りれば、プロキシは接続を *"an unmanaged TCP tunnel"（管理されない TCP トンネル）* に「アップグレード」してしまい、もはや制限を強制できない。**これが h2c スマグリングの本質**である。古典的 HRS が「1本のリクエストを2つに割る」パース差の攻撃だったのに対し、h2c スマグリングは「接続そのものを制御外のパイプに変える」構造差の攻撃だ、と対比すると理解しやすい。

一度トンネルが張られれば、HTTP/2 の**多重化（multiplexing、1接続で複数ストリームを並行送信）**により、その1本のトンネル内で任意の複数リクエストをバックエンドへ直接送り込める。

#### なぜプロキシは「消すべきヘッダ」を転送してしまうのか

RFC 上、`Connection` に列挙されたホップバイホップヘッダ（`Upgrade` 含む）は各中間装置が消費すべきものだ。にもかかわらず転送が起きるのは、実装が「知らない Upgrade トークンはとりあえずそのまま後ろへ流す」設計だったり、`proxy_pass` 系の素朴な設定が Upgrade/Connection を明示的に落としていなかったりするためである。特にプロキシ自身が h2c をサポートしていない場合、「自分では処理できない Upgrade をバックエンドに委ねる」形で素通しさせやすい。**プロキシが h2c を自前で終端（サポート）していない平文経路ほど、この攻撃が成立しやすい**、という直感が成り立つ。

#### 影響を受けやすいプロキシ構成

公式ブログと README がまとめる分類は次のとおり（発表当時 2020 年の調査。各製品はその後の版で設定既定値や挙動が変わり得るため、常に対象バージョンで再確認すること）。

- **既定構成で脆弱になり得る:** HAProxy、Traefik、Nuster
- **設定次第で脆弱:** AWS ALB/CLB、NGINX、Apache、Squid、Varnish、Kong、Envoy

素朴な（フィルタリングを入れていない）構成では、既定で `Upgrade` ヘッダをそのまま転送してしまうものがある、という点が要注意である。

#### 攻撃で可能になること（影響）

トンネルが張られた後にできることは、実質「バックエンドと生で会話できる」ことなので広い。

- **アクセス制御バイパス** — 前述の `/flag deny all` のように、エッジで守っていた管理用エンドポイントへ到達する。
- **内部ヘッダの偽造** — `X-Forwarded-For: 127.0.0.1` のような「内部からのアクセスだけ許可」判定を偽装し、内部ダッシュボード等へ入る。
- **Host ヘッダ SSRF / 内部横移動** — バックエンドが Host に基づいて別の内部ホストへプロキシする構成だと、そこを踏み台に内部ネットワークへ。
- **長寿命・無制限のバックエンド直結通信** — 一度張ったトンネルを使い回せる。

#### 検証ツール h2csmuggler の使い方（原典コマンド）

Bishop Fox 公開の `h2csmuggler`（Python3 + `h2` ライブラリ）は、この脆弱性の検出と実証に使う。README から抽出した実コマンド例を、**許可を得た自分の検証環境でのみ使う前提で**引用する。

まず「そのエッジが h2c 素通しするか」の検査:

```bash
# 単一ホストの脆弱性チェック
./h2csmuggler.py -x https://www.example.com/api/ --test

# URL リストを並列スキャン
./h2csmuggler.py --scan-list urls.txt --threads 5
```

`--test`（`-t`）は、プロキシが h2c Upgrade を誤ってバックエンドへ転送するかどうかを判定する。ツールは RFC 的には変則的に「TLS 上で h2c Upgrade を投げる」ことで、非準拠プロキシに対して機能させている（**なぜそうするか**: 対象はしばしば TLS 終端の背後に居るため、TLS の内側から Upgrade を送り込む必要があるからだ）。

トンネル成立後にバックエンドへ直接リクエストを送る例:

```bash
# 内部専用 API を POST で叩く（本来エッジで弾かれるはずのパス）
./h2csmuggler.py -x https://edgeserver -X POST \
  -d '{"user":128457 "role": "admin"}' \
  -H "Content-Type: application/json" \
  http://backend/api/internal/user/permissions

# HTTP/2 多重化を使ったパス総当たり（ワードリストを並行送信）
./h2csmuggler.py -x https://edgeserver -i dirs.txt http://localhost/

# 内部判定を偽装して内部ダッシュボードへ
./h2csmuggler.py -x https://edgeserver \
  -H "X-Forwarded-For: 127.0.0.1" \
  http://backend/system/dashboard
```

`-i`（ワードリスト）指定時は HTTP/2 多重化のおかげで**1本のトンネル内で多数のパスを並行探索**でき高速だ、という点が h2c ならではの効率性である。主なオプションは以下。

| オプション | 意味 |
|-----------|------|
| `-x, --proxy` | 対象プロキシ（トンネルを張る相手） |
| `-X, --request` | メソッド（GET/POST/PUT…） |
| `-d, --data` | ボディ |
| `-H, --header` | 追加ヘッダ（複数可） |
| `-i, --wordlist` | パス総当たり用のリスト |
| `-t, --test` | 単一ホストの脆弱性判定 |
| `-m, --max-time` | ソケットタイムアウト（既定10秒） |
| `--upgrade-only` | `HTTP2-Settings` を外して Upgrade だけ送る |

> 破壊的・無許可の利用は本書のスコープ外である。上記はあくまで「検知ロジック・影響範囲を理解し、自組織の設定監査に活かす」ための引用である。

#### 防御（h2c スマグリング）

原則はただ一つ、**「ユーザ由来の `Upgrade` / `Connection` の値をバックエンドへ転送しない」**。原典が挙げる具体策:

```haproxy
# HAProxy: WebSocket だけ許すなら Upgrade を websocket に正規化
http-request replace-value Upgrade (.*) websocket

# アップグレード自体を使わないなら Upgrade ヘッダを削除
http-request del-header Upgrade
```

```yaml
# Traefik: ミドルウェアで Upgrade を空にする
middlewares:
  testHeader:
    headers:
      customRequestHeaders:
        Upgrade: ""
```

- **設計方針**: 正当なアップグレード（実際に使うなら `websocket` など）だけをホワイトリストで許可し、それ以外は削除する。h2c を内部で使わないなら `Upgrade` を無条件に落とすのが最も堅い。
- **監査観点**: `proxy_pass` 系の素朴な設定が Upgrade/Connection を素通ししていないか、エッジで確認する。プロキシ自身が h2c を終端（サポート）するのか、それとも後段へ委ねるのかを把握する。

> 出典: Research on h2c Smuggling: Request Smuggling Via HTTP/2 Cleartext — https://bishopfox.com/blog/h2c-smuggling-request ／ BishopFox/h2csmuggler README — https://github.com/BishopFox/h2csmuggler

---

### 3. 上位 HTTP バージョン経由のスマグリング（Emil Lerner）

h2c スマグリングが「接続を丸ごとトンネル化する」攻撃だったのに対し、Emil Lerner の研究（`http2smugl` 作者、2021 年発表）は、**HTTP/2 / HTTP/3 を受けたフロントが、それを HTTP/1.1 へ「ダウングレード変換」してバックエンドへ渡す**構成を狙う。多くの実運用では、外向きは HTTP/2 対応でも、内部のバックエンドは今なお HTTP/1.1 を話す。この**翻訳の境界**で古典的スマグリングが再生する。

#### なぜ HTTP/2→1.1 変換で新たなスマグリングが生まれるか

HTTP/2 は**バイナリプロトコル**で、ヘッダ名・値の長さがフレーム構造で決まる。そのため HTTP/1.1 では禁止されている文字（改行 CR/LF など）が、HTTP/2 のヘッダ値には**構造上入り込めてしまう**。フロントが HTTP/2 リクエストを HTTP/1.1 のテキストへ「文字列として」書き戻すとき、この禁止文字がそのまま HTTP/1.1 の**リクエスト境界を割る道具**に化ける。加えて HTTP/2 では:

- `Transfer-Encoding: chunked` は本来ボディ転送に効果を持たない（HTTP/2 は独自のフレームで長さを管理するため）。
- しかし宣言された `Content-Length` と実データ長がズレることがある。

これらが「フロントとバックエンドで境界解釈が食い違う」古典的 desync の材料になる。要点を Lerner はこう述べる — *「結局は Content-Length / Transfer-Encoding の話。Transfer-Encoding が優先される。だから TE をフロントに処理させずバックエンドへ密輸する」*。

#### 6つのバグカテゴリ

スライドが整理する HTTP/2 固有の6分類は、そのまま「変換のどこがズレるか」の地図になる。

- **Bug #1 — Content-Length と実ボディ長の不一致**: 宣言長より実データが多い/少ないと、余剰分が次リクエストとして解釈され得る。
- **Bug #2 — Content-Length 無しの転送**: フロントが CL を付けずに後段へ渡すと、バックエンドが境界を誤認する。
- **Bug #3 — CL と TE の競合**: 変換時に両方が残り、優先解釈の食い違いで desync。
- **Bug #4 — ヘッダ中の改行**: HTTP/2 はヘッダ値に CR/LF を許容してしまう実装があり、`x:⏎⏎GET /internal HTTP/1.1` のように書くと、HTTP/1.1 化した瞬間に**新しいリクエスト行**が生まれる。もっとも直接的な注入経路。
- **Bug #5 — 緩い検証**: `transfer_encoding`（アンダースコア）や `chunKed`（大小混在）のような変種を通す実装があり、片側だけがそれを TE と認識して解釈差を生む。
- **Bug #6 — RFC 8441 の WebSocket/CONNECT**: HTTP/2 の拡張 CONNECT（`:protocol websocket`）が HTTP/1.1 の `Upgrade` ヘッダへ翻訳される過程を悪用し、プロトコルスマグリングにつなげる。

Bug #4 の注入イメージを、原理が分かる形で示す（**概念図**であり、実在サービスへ向けるものではない）。

```text
# 攻撃者が送る HTTP/2 リクエストの、あるヘッダ値（バイナリなので改行が入る）
foo:  bar\r\n\r\nGET /admin HTTP/1.1\r\nHost: internal

# フロントがこれを HTTP/1.1 テキストへ素朴に書き戻すと…
GET / HTTP/1.1
Host: victim
foo: bar

GET /admin HTTP/1.1          ← 改行のせいで“2本目のリクエスト”が出現
Host: internal
```

**なぜ成立するか**: HTTP/2 側では `foo` は単なる1つのヘッダ値にすぎず、改行はデータの一部だった。ところが HTTP/1.1 は改行を**メッセージ構造の区切り**と解釈する。フロントが「値の中の改行」を無害化（拒否・エスケープ・除去）せずにテキスト化した瞬間、バックエンドから見れば独立した2本目のリクエストが密輸される。

#### 実在した脆弱な実装（当時）

スライドが挙げる代表例（いずれも発表当時のバージョンの話。修正済みのものが多いので、必ず対象版で確認すること）。

- **Varnish**: `content-length: 0` を受理しながらボディを転送し、バックエンドを desync させた。
- **HAProxy + nghttp2**: WebSocket プロトコル付き CONNECT の翻訳が不適切で、追加リクエストが注入され得た（Bug #6 系）。
- **H2O（HTTP/3・QUIC）**: CL と TE の競合＋ヘッダ改行の複合。HTTP/3 でも同じ「上位→1.1 変換」の病理が現れることを示した。

#### 悪用シナリオ

- **リクエスト窃取（Request Stealing）**: chunked を密輸して「後続の被害者リクエストを自分のボディの続きとして取り込む」。認証済みリクエストの Cookie などが攻撃者側のレスポンスに露出する。
  ```http
  POST /save HTTP/1.1
  Transfer-Encoding: chunked
  ...
  data=GET / HTTP/1.1
  Cookie: secret        ← 被害者の後続リクエストが“ボディ”として吸い込まれる
  ```
- **内部エンドポイントへの到達**: 密輸した GET でフロント制限を回避しバックエンド専用パスへ。
- **キャッシュ汚染（Cache Poisoning）**: 細工リクエストで共有キャッシュを毒し、他ユーザへ影響を波及させる。

#### 検知手法（研究由来）

無許可の攻撃ではなく「自分の系が脆弱かを安全に測る」ための検知ロジックとして重要。

- **手法#1 — バックエンドに“もっとデータを待たせる”**: フロントは送信完了と見なすがバックエンドは続きを待ちタイムアウトする、という時間差で検出。HTTP/1.1 向けには Burp Suite プラグインが実装。
- **手法#2 — chunked 反応の観察**: HTTP/2 のバックエンドは本来 chunked を解釈しないはず。chunked の妥当性でレスポンスが変わるなら脆弱の疑い（誤検知あり）。
- **手法#3 — Content-Length パースの異常**: `x:x⏎content-length:1000` のように「本来レスポンス挙動に影響しないはずのヘッダ」で応答が変わるかを見る。

#### 自動化ツール http2smugl

Lerner は `http2smugl` を公開し、上記カテゴリの自動検出と、任意 HTTP/2 リクエストの手組みを可能にした。原典 URL に置かれたスライド本文（下記 ⚠️ 参照）でツールの位置づけが詳述されている。

#### 未解決の研究領域

スライドは open problem も挙げる。特に **「片方向のサイズ不一致（one-way size discrepancy）」** — バックエンドがフロントより*少なく*読む場合、攻撃は成立するのに、検知手法#1（バックエンドが*多く*待つことを前提）は反応しない、という検知の盲点。ほかに HTTP/1 特有ヘッダ、HPACK（HTTP/2 のヘッダ圧縮）操作、40 以上の実装差が未研究として残る、とされる。

> ⚠️ **未取得の資料**: 「HTTP Request Smuggling via higher HTTP versions」（Emil Lerner、SlideShare）は SlideShare のスライド画像形式のため一部の図版・数値は自動抽出に限界があった。原典スライドを直接ご確認ください: https://www.slideshare.net/neexemil/http-request-smuggling-via-higher-http-versions （本文の技術要素は WebFetch により抽出済み。図版で補う場合は原典参照）

> 出典: HTTP Request Smuggling via higher HTTP versions（Emil Lerner）— https://www.slideshare.net/neexemil/http-request-smuggling-via-higher-http-versions

---

### 4. 2つの技法の対比と、統一的な防御指針

| 観点 | h2c スマグリング | 上位バージョン経由スマグリング |
|------|------------------|-------------------------------|
| 攻撃対象 | 平文で Upgrade を素通しするプロキシ | HTTP/2・3 を 1.1 へ変換するフロント |
| ズレの正体 | 接続がトンネル化し、プロキシが盲目に | ヘッダ/長さの変換パース差（desync） |
| 主武器 | `Upgrade: h2c` / `Connection` の転送 | ヘッダ内改行・CL/TE 競合・緩い検証 |
| 結果 | プロキシ制御の完全バイパス、直結 | リクエスト割り・窃取・キャッシュ汚染 |
| 代表ツール | h2csmuggler | http2smugl |

両者に共通する教訓は明快だ。

1. **「中間装置が理解しきれないプロトコル要素を、そのまま後段へ転送しない」** — h2c では `Upgrade`/`Connection` を、変換系ではヘッダ値中の禁止文字・重複する長さヘッダを、境界で正規化・拒否・削除する。
2. **境界での再検証**: フロントとバックエンドで「リクエストの境界と長さ」の解釈を一致させる。CL と TE が両方あれば拒否、TE 変種（大小・アンダースコア）は拒否、ヘッダ値の CR/LF は拒否。
3. **バージョン依存性を常に意識**: ここで挙げた脆弱実装（Varnish / HAProxy+nghttp2 / H2O / 各プロキシの既定）は 2020〜2021 年時点の調査であり、多くは修正されている。自組織の**対象バージョンで再現・確認**し、陳腐化した前提で判断しないこと。
4. **h2c を内部で使わないなら、平文 Upgrade 経路そのものを塞ぐ**のが最短の防御である。

古典的 HRS が「1台のパーサ実装の甘さ」を突いたのに対し、本節の2技法は「**プロトコル境界での翻訳・トンネル化という設計そのもの**」を突く。上位プロトコルへの移行が進むほど、この「境界の防御」が HRS 対策の主戦場になっていく。
