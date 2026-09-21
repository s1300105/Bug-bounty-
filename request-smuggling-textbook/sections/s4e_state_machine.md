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
