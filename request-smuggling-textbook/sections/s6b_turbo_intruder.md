## Turbo Intruder と single-packet attack スクリプト

リクエストスマグリングは「タイミング」に敏感な脆弱性クラスである。バックエンドと接続を共有している他クライアントのリクエストに自分のペイロードを割り込ませる（デスヨンク: desynchronization、フロントエンドとバックエンドでリクエストの区切り方の解釈がズレること）ため、攻撃リクエストが**まとまった1パケットとして、他の通信に割り込まれずに届く**ことが成功率を大きく左右する。Burp Repeater のように1リクエストずつTCP接続を張って送る方法では、フロントエンド（リバースプロキシ・ロードバランサ・CDNなど）の背後にバックエンドサーバーが複数台ある場合、狙った1台に連続してリクエストが当たる保証がない。この節では、この問題を解決するために PortSwigger が開発した Burp 拡張「Turbo Intruder」と、その中核技術である single-packet attack（単一パケット攻撃）スクリプトの仕組みを解説する。

### Turbo Intruder とは何か

Turbo Intruder は Burp Suite の拡張機能で、大量の HTTP リクエストを高速に送信し、レスポンスを解析するためのツールである。標準搭載の Burp Intruder を補完する位置づけで、「極端な速度・長時間実行・複雑なロジック」を要求される攻撃に使う。

> 出典: Turbo Intruder（BApp Store） — https://portswigger.net/bappstore/9abaa233088242e8be252cd4ff534988

BApp Store の説明によれば、Turbo Intruder の強みは次の5点に整理されている。

- **速度（Speed）**: ゼロから書き起こされた独自の HTTP スタックを持ち、非同期実装（Go など）を上回る速度を出せる場合がある。
- **柔軟性（Flexibility）**: 攻撃ロジックを Python（Jythonベース）で記述できるため、署名付きリクエストや多段階シーケンスのような複雑な要件にも対応できる。
- **スケーラビリティ（Scalability）**: メモリ使用量がフラット（増え続けない）に保たれる設計のため、数日間に及ぶ攻撃も可能。ヘッドレス（GUIなしのコマンドライン）実行にも対応する。
- **利便性（Convenience）**: Backslash Powered Scanner から移植された高度な差分（diffing）アルゴリズムにより、大量のレスポンスから「興味深い」結果だけを自動抽出できる。
- **AI連携**: 近年のバージョン（2026年8月5日更新のv1.70時点）では、AIエージェントから操作するための組み込みMCPサーバーも追加されている（設定で手動有効化が必要）。

導入は Burp の BApp Store から行うか、オフライン環境向けに拡張ファイルを直接ダウンロードして手動インストールする。

> 出典: Turbo Intruder（BApp Store） — https://portswigger.net/bappstore/9abaa233088242e8be252cd4ff534988

### アーキテクチャ: なぜ「自作HTTPスタック」が必要なのか

README（GitHubリポジトリ）では、Turbo Intruderの位置づけを次のように説明している。「Burp Intruderを補完し、極端な速度・期間・複雑さを要求されるタスクを扱う」ツールであり、Python設定によって署名付きリクエストや多段階リクエストのような複雑な要件を処理できる。加えて、多くのHTTPライブラリでは送信できないような**不正な形式（malformed）のリクエスト**も送信できる点が明記されている。

> 出典: Turbo Intruder README — https://github.com/PortSwigger/turbo-intruder/blob/master/readme.md

この「不正な形式のリクエストを送れる」という特性は、リクエストスマグリングの検証において決定的に重要である。CL.TEやTE.CLといったデスヨンクの検証では、`Content-Length` と `Transfer-Encoding` を意図的に矛盾させたり、チャンクの終端を微妙にずらしたりと、標準のHTTPクライアントライブラリでは弾かれる・自動補正されてしまうような「壊れた」リクエストを、バイト単位で正確に送出する必要がある。既製のHTTPクライアント（`requests` や `curl` など）は多くの場合、内部でリクエストを正規化・検証してしまうため、こうした異常な入力をそのまま送れない。Turbo Intruderはネットワークスタックをゼロから実装することで、この制約を回避している。

代償として、README・解説記事の双方が「独自ネットワークスタックはBurpのコアほど実戦で鍛えられていない（battle-tested）」ことを明記しており、上級者向けツールである点が繰り返し強調されている。

> 出典: Turbo Intruder README — https://github.com/PortSwigger/turbo-intruder/blob/master/readme.md
> 出典: Turbo Intruder解説「Embracing the billion-request attack」 — https://portswigger.net/research/turbo-intruder-embracing-the-billion-request-attack

### リクエストエンジン(Engine)の種類

Turbo Intruderは複数の「エンジン」（ネットワークスタックの実装）を切り替えて使える設計になっている。解説記事「Embracing the billion-request attack」によれば、性能順に次のように整理される。

| エンジン | 特徴 |
|---|---|
| `Engine.HTTP2` | 独自実装のHTTP/2スタック。最速。 |
| `Engine.THREADED` | デフォルトのスレッドベース実装。チューニングが行き届いている。 |
| `Engine.BURP2` | Burp本体のHTTP/2スタックを利用。 |
| `Engine.BURP` | 安定性重視。上流プロキシ（Upstream Proxy）経由の通信にも対応。 |

> 出典: Turbo Intruder解説「Embracing the billion-request attack」 — https://portswigger.net/research/turbo-intruder-embracing-the-billion-request-attack

リクエストスマグリングの検証文脈で重要なのは `Engine.BURP2`（HTTP/2対応）である。後述するように、single-packet attackはHTTP/2の多重化（multiplexing、1本のTCP/QUIC接続上で複数のリクエスト/レスポンスストリームを並行してやり取りする仕組み）を利用しており、HTTP/2をサポートしないターゲットに対しては `Engine.THREADED` または `Engine.BURP` を使う。

### パフォーマンスチューニングの要点

「Embracing the billion-request attack」では、実測で「リモートサーバーに対して最大30,000 RPS（1秒あたりリクエスト数）」を達成したと報告している。この数値を出すための主なチューニングパラメータは以下の通り。

- `concurrentConnections`: 同時に張るTCPコネクション数。
- `pipeline`: HTTP/1のパイプライン化（1つのコネクション上で応答を待たずに複数リクエストを連続送信すること）の有効/無効。
- `requestsPerConnection`: 1コネクションあたりに送るリクエスト数。
- レスポンス/リクエストのサイズを `Range` ヘッダーなどで小さく保ち、転送量を減らす。
- ワードリストは全件をメモリに読み込まず、1行ずつストリーム処理する。
- `handleResponse` 側でテーブルに追加する前にフィルタリングし、CPU負荷を下げる。

> 出典: Turbo Intruder解説「Embracing the billion-request attack」 — https://portswigger.net/research/turbo-intruder-embracing-the-billion-request-attack

またヘッドレス（コマンドライン）実行にも対応しており、以下のように起動できる。

```
java -jar turbo.jar <scriptFile> <baseRequestFile> <endpoint> <baseInput>
```

これにより「ターゲットに近いサーバーを借りて実行する」といった、ネットワークレイテンシを最小化する運用が可能になる。

> 出典: Turbo Intruder解説「Embracing the billion-request attack」 — https://portswigger.net/research/turbo-intruder-embracing-the-billion-request-attack

### レスポンス処理: `handleResponse` とフィルタリング

Turbo Intruderのスクリプトは `queueRequests` と `handleResponse` の2つの関数で構成される。前者は送信するリクエストをキューに積む処理、後者は受信したレスポンスをどう扱うかを定義する。最も単純な形は次の通り。

```python
def handleResponse(req, interesting):
    if '200 OK' in req.response:
        table.add(req)
```

より宣言的に書く場合はデコレータを使う。

```python
@MatchStatus(200,204)
@MatchSizeRange(100,1000)
def handleResponse(req, interesting):
    table.add(req)
```

`table.add(req)` は結果テーブルにその1件を表示する指示であり、これを条件分岐の中でしか呼ばなければ、大量のレスポンスの中から「興味深い」ものだけを絞り込める。ベースラインとなる応答を自動学習して差分を検出する機能もあり、これがBackslash Powered Scannerから移植された「diffingアルゴリズム」の実体である。

> 出典: Turbo Intruder解説「Embracing the billion-request attack」 — https://portswigger.net/research/turbo-intruder-embracing-the-billion-request-attack

数百万リクエスト規模の長時間攻撃を成立させる原則として、記事は「(1) 応答は選択的にしか保存しない、(2) データは一括読み込みせずストリーム処理する」の2点を挙げている。これがフラットなメモリ使用量を実現する仕組みである。

### なぜ「複数リクエストをバラバラに送る」と検証に失敗するのか

ここからが本節の核心である。race condition（競合状態）やHTTP request smugglingの検証では、複数のリクエストが**サーバー側でほぼ同時に処理される**ことが前提になる。しかし通常のHTTPクライアントで複数リクエストを送ると、次の理由でタイミングがずれる。

1. **接続確立のオーバーヘッド**: TCPの3ウェイハンドシェイク、TLSのハンドシェイクにそれぞれ数ミリ秒〜数十ミリ秒かかる。複数コネクションを順番に張ると、その分だけリクエスト到達タイミングがずれる。
2. **ロードバランサによる振り分け**: フロントエンドの背後に複数のバックエンドサーバーがいる構成（多くの本番環境がこれに該当する）では、コネクションごとに別のバックエンドに振り分けられる可能性がある。1台のバックエンド内部の状態（キャッシュ、レースコンディションの脆弱なコードパスなど）を突きたい場合、別々のサーバーにリクエストが分散してしまうと再現性がなくなる。
3. **OS・ネットワークスタックのジッター**: 同じマシンから送っても、送信キューやカーネルのスケジューリングにより、送信順序と到達順序が厳密には一致しないことがある。

Turbo Intruderの「gate（ゲート）」機構は、この問題を解決するための仕組みである。各リクエストを完全には送信し切らず、末尾のわずかなバイト（典型的には最後の改行や最後の数バイト）を保留した状態で複数リクエストを同時に「並べて」おき、最後に保留分を一斉に送出することで、複数の完全なリクエストが**ほぼ同一のタイミングでバックエンドに到達する**ようにする。これがsingle-packet attack（単一パケット攻撃）の基本発想である。

### single-packet attack の仕組み: HTTP/2 の多重化を悪用する

「純粋な意味での」single-packet attackは、HTTP/2の**ストリーム多重化**を利用して、複数の論理的なリクエストを**物理的に1つのTCPパケットに収めて送信する**手法である。HTTP/2ではストリームIDによって複数のリクエスト/レスポンスを1本のコネクション上で並行してやり取りできるため、複数のHEADERSフレーム+DATAフレームを1つのTCPセグメントにまとめてから送出すれば、サーバー側のTCP/IPスタックはそれらを**まさに同時に**受信する。これにより、上述した「接続確立のジッター」「ロードバランサでの分散」の問題が原理的に排除される。1パケットである以上、宛先は必ず単一の接続であり、単一のバックエンドに（少なくともTCP到達の時点では）同時に届く。

この技術的背景は、PortSwiggerのHTTP Request Smuggling研究者James KettleらによるHTTP/2ダウングレード・デスヨンクの研究（"Smashing the State Machine"、race-single-packet-attack.pyのコメント内で参照されている）とも直結する。フロントエンドがHTTP/2でクライアントと通信し、バックエンドへはHTTP/1.1にダウングレードして中継する構成（多くのCDN・リバースプロキシで一般的）では、HTTP/2上でのリクエスト分割・ヘッダーの扱いの解釈差が、ダウングレード後のHTTP/1.1リクエストの境界を狂わせる余地を生む。single-packet attackは、このようなHTTP/2ベースのデスヨンクや、レースコンディションを伴うリクエストスマグリングの検証を、再現性高く行うための実行基盤として使われる。

### サンプルスクリプト `race-single-packet-attack.py` の解読

PortSwigger公式リポジトリの実例スクリプトは次の通りである。

```python
def queueRequests(target, wordlists):

    # if the target supports HTTP/2, use engine=Engine.BURP2 to trigger the single-packet attack
    # if they only support HTTP/1, use Engine.THREADED or Engine.BURP instead
    # for more information, check out https://portswigger.net/research/smashing-the-state-machine
    engine = RequestEngine(endpoint=target.endpoint,
                           concurrentConnections=1,
                           engine=Engine.BURP2
                           )

    # the 'gate' argument withholds part of each request until openGate is invoked
    # if you see a negative timestamp, the server responded before the request was complete
    for i in xrange(20):
        engine.queue(target.req, gate='race1')

    # once every 'race1' tagged request has been queued
    # invoke engine.openGate() to send them in sync
    engine.openGate('race1')


def handleResponse(req, interesting):
    table.add(req)
```

> 出典: single-packet attackサンプルスクリプト — https://github.com/PortSwigger/turbo-intruder/blob/master/resources/examples/race-single-packet-attack.py

各行の意味と、それが「なぜそう書かれているか」を分解する。

- **`concurrentConnections=1`**: あえてコネクションを1本に固定している。single-packet attackは「1つの物理パケット」に複数リクエストを詰め込む手法なので、そもそもコネクションを複数張る必要がない。むしろ複数コネクションに分散させると、パケット単位での同時到達が保証できなくなり技術の前提が崩れる。
- **`engine=Engine.BURP2`**: コメントにある通り、ターゲットがHTTP/2に対応しているなら`Engine.BURP2`（BurpのHTTP/2スタックを利用するエンジン）を指定することでsingle-packet attackが有効になる。HTTP/1のみのターゲットに対しては`Engine.THREADED`や`Engine.BURP`を使うようコメントされており、その場合はHTTP/1のパイプライン化やラストバイト同期送信など、別の近似手法（後述）にフォールバックする。
- **`engine.queue(target.req, gate='race1')`**: `gate`引数に文字列タグ（ここでは`'race1'`）を渡すことで、そのリクエストを「即送信せず、ゲートが開くまで保留する」対象として登録する。具体的には各リクエストの末尾の一部（最終バイト）を送信せずに留め、TCP/HTTP2レベルで「あとはこの一撃を送ればリクエストが完成する」という状態を人為的に作り出す。
- **`for i in xrange(20)`**: 同一リクエストを20回、同じゲートタグでキューに積む。これにより20本の「完成寸前」のリクエストが並行して待機状態になる。
- **`engine.openGate('race1')`**: `race1`タグの付いた保留中リクエスト全ての残りバイトを一斉に送出する。HTTP/2の場合はこれらが同一TCPパケットにまとめられることで、サーバー側にほぼ同時に到達する。
- **コメント「if you see a negative timestamp, the server responded before the request was complete」**: これは検証結果の読み方に関する重要な指摘である。Turbo Intruderは各リクエストについて「ゲートを開いてから完全なレスポンスを受け取るまでの時間」を計測するが、もしサーバーが**リクエストの終端バイトを受け取る前に**レスポンスを返し始めた場合、計測上の時刻が負になり得る。これは典型的に「サーバー側の処理が先行するリクエストの内容に引きずられている」＝レースコンディションやリクエストスマグリングによる割り込みが発生している兆候として利用できる。
- **`handleResponse`**: すべてのレスポンスを無条件に`table.add(req)`でテーブルに表示する。件数が少ない（20件程度）レースコンディション検証では、フィルタリングよりも全件を目視確認する方が実用的なためである。

### この手法を防御目的でどう活かすか

本書はあくまで防御目的の教科書であるため、single-packet attackそのものを実運用の第三者システムに対して用いることは想定しない。しかし、この技術が明らかにする原理は、自組織のシステムを守る上で以下のように活用できる。

- **自分が管理するステージング/テスト環境**に対して、CL.TE/TE.CLの矛盾ヘッダーを含むリクエストをsingle-packet attack的に送り、フロントエンドとバックエンドの間でリクエスト境界の解釈が一致しているかを、許可された検証手順の範囲で確認する。
- HTTP/2からHTTP/1.1へのダウングレードを行うリバースプロキシ／CDN／ロードバランサを導入する際は、ベンダーが「Smashing the State Machine」系の既知の脆弱パターンに対してパッチ済みかを確認する。
- レースコンディション対策（在庫消費、クーポン利用、口座残高操作などの処理）を実装する際は、「複数リクエストがミリ秒未満の差で到達する」ことを前提に、DBレベルのロックやアトミックな更新処理を設計する。ツールがなくても「実質的に同時に届き得る」という脅威モデルを前提にすることが重要である。
- 自社のWAFやリバースプロキシのログで、同一コネクション上に異常に詰め込まれたHTTP/2ストリームや、末尾が不自然に遅延して到着するリクエストパターンを検知ルールに加える。

### バージョン・時期に関する注記

本節執筆時点（2026年9月）でBApp Storeが示すTurbo Intruderの最新バージョンは **v1.70（2026年8月5日更新）** であり、AIエージェント向けのMCPサーバー統合が新たに追加されている。ライセンスはv1.62以降 GNU AGPLv3、それ以前はApache License 2.0である。エンジン名（`Engine.HTTP2` / `Engine.THREADED` / `Engine.BURP2` / `Engine.BURP`）やパラメータ名（`concurrentConnections`, `pipeline`, `requestsPerConnection`, `gate`, `openGate`）はAPIとして比較的安定しているが、拡張のバージョンによって新しいエンジンやパラメータが追加される可能性があるため、実際に利用する際は手元のTurbo Intruderに同梱されたREADMEやサンプル（`resources/examples/`配下）を必ず確認すること。

> 出典: Turbo Intruder（BApp Store） — https://portswigger.net/bappstore/9abaa233088242e8be252cd4ff534988
> 出典: Turbo Intruder README — https://github.com/PortSwigger/turbo-intruder/blob/master/readme.md
