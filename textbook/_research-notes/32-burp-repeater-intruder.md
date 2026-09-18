# [32] Burp Repeater と Burp Intruder — リクエスト再送・自動化攻撃の詳細ノート

想定章: ch06（クライアントサイド脆弱性ハンティングのための Burp Suite）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://portswigger.net/burp/documentation/desktop/tools/repeater | partial | WebFetch → `EGRESS_BLOCKED` / curl → `CONNECT tunnel failed 403` / web.archive.org → 403 / WebSearch → セッション予算 200/200 消費済み。最終的に **Burp Suite 本体同梱のオフライン公式ドキュメント HTML のミラー**（GitHub `1tbfree/BurpSuitePro-SourceLeak`、パス `resources/Documentation/burp/documentation/desktop/tools/repeater/`）を `raw.githubusercontent.com` 経由で逐語取得 | 本文はライブページと同一文面だが「ライブページそのもの」ではないため partial。Repeater 配下の全7ページ（`index.html` / `groups.html` / `send-group.html` / `tab-settings.html` / `managing-tabs.html` / `http-messages.html` / `websocket-messages.html`）＋ 設定ページ `settings/tools/repeater.html` ＋ Inspector 3ページ ＋ HTTP/2・message-editor・reissuing チュートリアルも逐語取得 |
| https://portswigger.net/burp/documentation/desktop/tools/intruder | partial | 同上（`resources/Documentation/burp/documentation/desktop/tools/intruder/`） | Intruder 配下の全21ページ（index / getting-started / uses×4 / configure-attack×10 / results×6）＋ 設定ページ `settings/tools/intruder.html` ＋ `settings/response-extraction.html` ＋ 2つのチュートリアル（brute-forcing-logins / enumerating-subdomains）を逐語取得 |
| （参考・失敗）https://portswigger.net への直接アクセス | failed | WebFetch=EGRESS_BLOCKED、curl=CONNECT 403 | この実行環境では `portswigger.net`・`web.archive.org` がネットワーク egress プロキシでブロックされている |
| （参考・失敗）WebSearch による二次情報探索 | failed | セッション予算（200/200）消費済みで実行不可 | セッション全体の制限 |

**重要な注意**: 本ノートの引用はすべて上記ミラー HTML（PortSwigger 配布のオフライン公式ドキュメント、姉妹ノート [31] の記録によれば `META-INF/MANIFEST.MF` に `Implementation-Version: 32146`, `Implementation-Vendor: PortSwigger`）の逐語である。文面は `portswigger.net` の公開ドキュメントと同一だが、ライブページは随時更新されるため、**教科書に載せる際は「PortSwigger 公式ドキュメント（バンドル版・内部ビルド 32146 相当）に基づく」と明記し、最新の UI 名称・既定値は読者に公式サイトで確認させること**を推奨する。

---

## 要約（3〜10行）

- **Burp Repeater** は「興味深い HTTP / WebSocket メッセージを、修正しては何度でも送り直す」ためのツール。各メッセージは独立したタブで扱い、修正はタブの履歴に保存される。入力ベースの脆弱性テスト、多段プロセスの検証、Scanner が報告した問題の手動確認に使う。
- Repeater の目玉機能が **Group send options（グループ送信）**。タブをグループ化して複数リクエストを一括送信でき、**Send group in sequence（single connection / separate connections）** と **Send group in parallel** の3方式がある。並列送信は HTTP/1 では last-byte synchronization、**HTTP/2+ では single packet attack（1 TCP パケットで複数リクエスト）** を用い、**レースコンディション**検証の核となる。単一接続の逐次送信は **client-side desync**（ブラウザ由来のリクエストスマグリング）検証に効く。
- **Inspector** は HTTP/WebSocket メッセージのヘッダ・パラメータ・Cookie を name-value ペアで分類表示し、HTML/URL/Base64 を**自動デコード**して見せ、デコード後の値を編集すると**元の符号化列を自動再適用**する。HTTP/2 の疑似ヘッダ（`:` プレフィックス）を HTTP/1 構文から切り離して扱え、改行・NULL 等の非表示文字を注入できる（HTTP/2 排他攻撃・"kettled" リクエスト）。
- **Burp Intruder** は「同じリクエストを、定義した位置（payload positions、`§`マーカー）に異なるペイロードを差し込みながら繰り返し送る」自動化攻撃ツール。fuzzing / brute-force / 識別子列挙 / データ収集に使う。
- Intruder の **attack type** は4種: **Sniper**（単一セットを各位置に順番に）、**Battering ram**（単一セットを全位置に同時）、**Pitchfork**（位置ごとに別セットを同時進行、最小セット長ぶん）、**Cluster bomb**（位置ごとに別セットの全組合せ、積）。
- **payload types** は Simple list / Runtime file / Custom iterator / Character substitution / Case modification / Recursive grep / Illegal Unicode / Character blocks / Numbers / Dates / Brute forcer / Null payloads / Character frobber / Bit flipper / Username generator / ECB block shuffler / Extension-generated / Copy other payload / Collaborator payloads の多数。**payload processing** ルール（prefix/suffix/match-replace/substring/encode/decode/hash/skip 等）と最終 URL エンコードで加工する。
- 結果分析は **Grep - match**（応答内の式を検出）/ **Grep - extract**（応答から情報抽出）/ **Grep - payloads**（ペイロードの反射検出＝XSS 等の検出）と、列ソート・フィルタ・注釈（highlight/comment）で行う。**resource pool** で同時リクエスト数・遅延・自動スロットリングを制御する。
- クライアントサイド視点では、Repeater は DOM/postMessage を起こす HTTP レスポンスや WebSocket メッセージの手動改変検証に、Intruder は Grep-payloads による**リフレクション XSS 検出**、Collaborator payloads による帯域外検出、single packet attack による**レースコンディション**検証に効く。

---

## 詳細ノート

### 1. Burp Repeater — 概要（出典: tools/repeater/index.html）

原文の定義（逐語）:

> 「Burp Repeater is a tool that enables you to modify and send an interesting HTTP or WebSocket message over and over.」

= Burp Repeater は、興味深い HTTP または WebSocket メッセージを修正して何度でも送信できるツール。

用途（原文 "You can use Repeater for all kinds of purposes, for example to:" の逐語リスト）:

- 「Send a request with varying parameter values to test for input-based vulnerabilities.」（パラメータ値を変えたリクエストを送り、入力ベースの脆弱性をテストする）
- 「Send a series of HTTP requests in a specific sequence to test for vulnerabilities in multi-step processes, or vulnerabilities that rely on manipulating the connection state.」（特定の順序で一連の HTTP リクエストを送り、多段プロセスの脆弱性や接続状態の操作に依存する脆弱性をテストする）
- 「Manually verify issues reported by Burp Scanner.」（Burp Scanner が報告した問題を手動で検証する）

> 「Repeater enables you to work on multiple messages simultaneously, each in its own tab. Any modifications you make to a message are saved in the tab's history. You can easily manage large numbers of open tabs with the grouping function.」

= 複数メッセージをそれぞれ独立タブで同時に扱え、加えた修正はタブの履歴に保存される。多数の開いたタブはグループ化機能で管理できる。HTTP リクエストにはタブごとにノートを付けられる。

エディション: **Professional / Community**（両版で利用可）。
パンくず: Support Center → Documentation → Desktop editions → Tools → Repeater。

関連ページ（原文の "Related pages" リンク一覧）:
- Getting started: Reissuing requests with Burp Repeater
- Working with HTTP messages with Burp Repeater
- Sending HTTP requests in sequence
- Working with WebSocket messages with Burp Repeater
- Managing Burp Repeater tabs
- Managing tab groups
- Burp Repeater settings
- Configuring tab-specific settings

---

### 2. HTTP メッセージの扱い（出典: tools/repeater/http-messages.html）

> 「You can use Burp Repeater to manipulate and resend individual HTTP requests, and analyze the application's responses.」

**HTTP リクエストを Repeater で送る手順（逐語訳）:**

1. Burp のどこでも HTTP リクエストを右クリックし **Send to Repeater** をクリック。リクエストを含む新しいタブが Repeater に追加される。
2. Repeater に移動し、新しいタブで HTTP リクエストの詳細を見る。
3. メッセージを修正する。
4. **Send** をクリックしてリクエストを標的サーバに送り、応答の詳細を見る。
5. このプロセスを好きなだけ繰り返し、リクエストを様々に変えると応答がどう変わるかを見る。

**HTTP Repeater タブが含む要素（原文 "each Repeater tab contains the following items" の逐語）:**

- リクエストを含む **HTTP message editor**（message editor の機能でメッセージを解析・編集できる）。
- リクエストの送り先 **target server**（Repeater に送った時点で自動設定）。設定アイコンで target 詳細を構成:
  - Host ヘッダを変えた場合、**Host** と **Port** フィールドでリクエストの実際の送り先を確認できる。
  - **Override SNI** を選ぶと SNI 値を手動設定できる。Burp Scanner が Collaborator ペイロードで検出した external service interaction 問題の再現に使える。
- 受信した応答を表示する HTTP message editor。
- 応答のサイズ（バイト）と応答時間（ミリ秒）。
- **リクエスト履歴のナビゲーション**:
  - `<` と `>` ボタンで履歴を前後に移動。
  - ドロップダウンで履歴項目を番号付きリスト表示し、素早く移動。
  - 履歴の任意の時点で、現在表示中のリクエストを編集し再送できる。

**タブへのノート追加（Adding notes for HTTP Repeater tabs）:**
リクエスト/応答に興味深いものがあればタブにノートを付けられる。手順: タブ選択 → **Notes** クリック → Notes パネルに入力。
補足（原文 Note）: 他の Burp ツールで付けたノートは Repeater にコピーされ、Repeater からノートを使うツールへ送るとコメントもコピーされる。

---

### 3. HTTP リクエストを順序送信（Group send / single packet attack）（出典: tools/repeater/send-group.html）★最重要

> 「Burp Repeater's Group send options feature enables you to send grouped HTTP requests with a single click. You can send requests either in parallel (all at once), or in sequence (one after the other).」

**グループ送信の手順（逐語訳）:**

1. Repeater のタブグループを作成し、関連タブを追加する。
   - 代替として、グループを作りその中でタブを複製できる。**レースコンディション脆弱性のテスト**時、同一リクエストの作成が効率化されるので有用。
2. グループ内のタブの一つを選択する。
3. **Send** ボタン横のドロップダウン矢印をクリックし、以下のいずれかを選ぶ:
   - **Send group in sequence (single connection)**
   - **Send group in sequence (separate connections)**
   - **Send group in parallel**
4. **Send group** をクリック。Repeater がグループ化されたタブの全リクエストを送信する。

送信シーケンスを中止するには、リクエスト送信中にグループのタブの一つで **Cancel** をクリック。

#### 3-1. 順序送信 — 単一接続（Sending over a single connection）

> 「If you select Send group in sequence (single connection), Repeater establishes a connection to the target, sends the requests from all of the tabs in the group, and then closes the connection.」

= Repeater は標的への接続を1本確立し、グループ内の全タブのリクエストを送り、その後接続を閉じる。

用途（逐語訳）:
- **潜在的な client-side desync ベクトル**のテストが可能になる。
- TCP 接続確立時に生じる「jitter（ジッタ）」を減らせる。応答同士のわずかなタイミング差を比較する**タイミングベース攻撃**に有用。

関連: client-side desync のテスト方法と練習用 lab は Web Security Academy の **Browser-powered request smuggling** トピック参照。

#### 3-2. 順序送信 — 別接続（Sending over separate connections）

> 「If you select Send group in sequence (separate connections), Repeater establishes a connection to the target, sends the request from the first tab, and then closes the connection. It repeats this process for all of the other tabs in the order they are arranged in the group.」

= 最初のタブのリクエストを送って接続を閉じ、これをグループ内の順番どおり全タブで繰り返す。**多段プロセスを要する脆弱性**のテストが容易になる。

#### 3-3. 順序送信の前提条件（Send in sequence prerequisites）

グループが満たすべき条件（逐語）:
- 「There must not be any WebSocket message tabs in the group.」（グループに WebSocket メッセージタブがあってはならない）
- 「There must not be any empty tabs in the group.」（空タブがあってはならない）

**単一接続で送る追加条件:**
- 「All tabs must have the same target.」（全タブが同一 target であること）
- 「All tabs must use the same HTTP version (that is, they must either all use HTTP/1 or all use HTTP/2).」（全タブが同一 HTTP バージョンを使うこと＝全部 HTTP/1 か全部 HTTP/2）

#### 3-4. 並列送信（Sending requests in parallel）★single packet attack

> 「If you select Send group in parallel, Repeater sends the requests from all of the group's tabs at once. This is useful as a way to identify and exploit race conditions.」

= グループの全タブのリクエストを一斉に送る。**レースコンディションの発見・悪用**に有用。

Repeater は並列リクエストがすべて同時に完全到着するよう同期する。同期手法は HTTP バージョンで異なる（逐語）:
- 「When sending over HTTP/1, Repeater uses **last-byte synchronization**. This is where multiple requests are sent over concurrent connections, but the last byte of each request in the group is withheld. After a short delay, these last bytes are sent down each connection simultaneously.」
  = HTTP/1 では **last-byte 同期**。複数リクエストを並行接続で送るが、各リクエストの最後の1バイトを保留し、短い遅延の後、各接続の最後のバイトを同時送信する。
- 「When sending over HTTP/2+, Repeater sends the group using a **single packet attack**. This is where multiple requests are sent via a single TCP packet.」
  = **HTTP/2+ では single packet attack**。複数リクエストを**単一 TCP パケット**で送る。

並列リクエストの応答を含むタブを選ぶと、右下のインジケータがグループ内でその応答が受信された順序を表示する（例: 1/3, 2/3）。

補足（原文 Note）: 「You cannot send macro requests in parallel.」（マクロリクエストは並列送信できない。マクロがリクエスト同期を妨げるのを防ぐため）

**並列送信の前提条件（Send in parallel prerequisites）:**
- 「All requests in the group must use the same host, port, and transport layer protocols.」（全リクエストが同一 host・port・トランスポート層プロトコルを使う）
- 「HTTP/1 keep-alive must not be enabled for the project.」（プロジェクトで HTTP/1 keep-alive が有効でない）

関連: レースコンディションのテストは Web Security Academy の **Race conditions** トピック参照。

〔補足（一般知識）〕 single packet attack は PortSwigger の研究者 James Kettle が 2023 年に公表した手法で、ネットワークジッタを排除して 20〜30 のリクエストを実質同時にサーバへ到達させることでレースコンディションの再現性を劇的に高めた。従来の last-byte 同期は接続本数ぶんのジッタが残るが、single packet attack は 1 パケットに複数リクエストを載せることでそれを排除する。

---

### 4. WebSocket メッセージの扱い（出典: tools/repeater/websocket-messages.html）

> 「You can use Burp Repeater to manipulate and resend individual WebSocket messages, and analyze the application's responses.」

**WebSocket リクエストを送る手順（逐語訳）:**

1. **Proxy > WebSockets history** に移動。
2. WebSocket メッセージを右クリックし **Send to Repeater**。メッセージを含む新しいタブが追加される。
3. Repeater でタブの WebSocket メッセージ詳細を見る。
4. メッセージを修正する。
5. メッセージを**サーバ宛かクライアント宛か**選ぶ。
6. **Send** をクリックしてメッセージを標的サーバまたはクライアントへ送り、応答を見る。
7. 再送するには右クリックして **Edit and resend**。修正の仕方を変えて何度でも。

補足（原文 Note）: 「The option to send a message to the client is only available in connections that are still open via Burp Proxy.」（クライアント宛送信は Burp Proxy 経由でまだ開いている接続でのみ可能）

**WebSocket Repeater タブの要素:**
- WebSocket メッセージを含む message editor。
- メッセージを送る **WebSocket connection**（送った時点で自動設定）:
  - WebSocket ID ヘッダのトグルで切断/再接続。
  - 編集アイコンで接続を編集。開いている接続の複製・接続・新規接続・閉じた接続の再接続ができ、WebSocket 作成に使う negotiation request を操作できる。
- 送受信した全メッセージを示す **history table**（手動生成メッセージは表内で示される）。**Select next message received** をチェックすると、履歴表で次に受信するメッセージを自動選択。
- 現在選択中メッセージの message viewer。

---

### 5. タブ管理とタブグループ（出典: tools/repeater/managing-tabs.html, groups.html）

#### 5-1. タブ管理（managing-tabs.html）

Repeater は新しい HTTP/WebSocket メッセージを新タブで開く。タブヘッダのコントロールで操作（逐語訳）:

- **Create a request from scratch** — ボタンをクリックして新タブを開き、HTTP か WebSocket を選ぶ。他所から Repeater にリクエストを送っても新タブができる。
- **Rename tabs** — タブヘッダをダブルクリックして名前入力。
- **Duplicate tabs** — グループ化されたタブを右クリックして **Duplicate tab**。グループ内タブでのみ可能。各タブはシステムリソースを消費するので、大量のタブはパフォーマンスに影響。
- **Switch tab view** — タブを右クリックして **Tab view settings**。2つのビューから選択:
  - **Scrolling view** — タブを単一のスクロール可能な行で表示。検索アイコンで全タブのドロップダウンリスト。
  - **Wrapped view** — タブが複数行に折り返され、すべて画面に表示。
- **Add a tab to a group** — タブを右クリックして **Add tab to group** でグループ選択。
- **Close tabs**:
  - 単一タブを閉じる — タブヘッダの close アイコン。
  - **Close other tabs** — 選択タブ以外を全部閉じる。
  - **Close tabs to the left** / **Close tabs to the right** — 選択タブの片側を全部閉じる。
- **Reopen closed tab** — 任意のタブを右クリックして最後に閉じたタブを再度開く。

補足（原文 Note）: すでに Repeater にあるリクエストから Repeater に送ると、同一リクエストの別インスタンスを持つ新タブができる。

#### 5-2. タブグループ管理（groups.html）

> 「You can organize tabs into groups to manage large numbers of open tabs. This also enables you to send requests from multiple tabs in sequence.」

**新規タブグループの作成（逐語訳）:**
1. add tab ボタンをクリックして **Create tab group** を選び、create group コンテキストメニューを表示。
2. **Group name** を入力。
3. チェックボックスでグループに追加するタブを選択（shift クリックで複数選択）。
4. **group color** を選択。グループのタブがこの色でタブバーにハイライトされる。
5. **Create** をクリックしてグループ設定。タブバーにグループアイコンが追加され、クリックでグループ内の個別タブを表示。

作成したタブグループは Burp Suite を再起動しても開いたまま残る。

**既存グループの編集:**
- **Edit group** — グループを右クリック。作成時と同じフィールド。
- **Add tab to a group** — タブを右クリックし **Add tab to group** メニューからグループ選択。
- **Remove tab from group** — タブを右クリック。グループから最後のタブを削除するとグループは自動的に閉じる。
- **Close other tabs in group** — 選択タブ以外のグループ内タブを閉じる。

---

### 6. タブ固有設定（出典: tools/repeater/tab-settings.html）

> 「You can override the global Repeater settings selected in the Settings dialog for an individual tab.」

**手順（逐語訳）:** 対象タブを選択 → **Send** ボタン横の settings アイコンをクリックしてコンテキストメニュー表示 → 必要な設定を選択。利用可能な設定は Settings ダイアログと同じ。

重要な挙動（逐語）: 「If you select a setting on the tab-specific menu then Repeater ignores all global settings for that tab.」= タブ固有メニューで設定を選ぶと、そのタブについて**すべてのグローバル設定が無視される**。例: グローバルの Repeater メニューで Process cookies in redirections を選び、タブ固有メニューで Enable HTTP/1 connection reuse を選ぶと、グローバルの Process cookies in redirections 設定は無視される。→ 送信前にタブ固有メニューで全設定を正しく構成すること。

設定を変更するとタブの settings アイコンが青くなる。グローバル設定に戻すには settings アイコン → **Restore global default**。プロジェクトファイル使用時、開いているタブのタブ固有設定は Burp 再起動後も保持される。

---

### 7. Repeater 設定（グローバル）（出典: settings/tools/repeater.html）

Settings ダイアログの Repeater ページは以下を含む: Connections / Message modification / Redirects / Default tab group / Tab view。個別タブで上書き可能。それ以外はグローバル設定として全 Repeater タブに適用。

#### 7-1. Connections（TCP 接続と HTTP/2 の制御）★プロジェクト設定

- **HTTP/1 connection reuse** — 有効にすると HTTP/1 リクエストで同一接続を再利用（HTTP 1.1 リクエスト/レスポンスペアごとに新規接続を開かない）。速度が上がりリクエストタイミングに有利。Burp は無操作5秒後に開いている接続を閉じる。
- **HTTP/2 connection reuse** — 既定で Repeater は複数の HTTP/2 リクエストで同一 TCP 接続を再利用。サーバが接続上の最初のリクエストを後続と異なる扱いをする場合は無効化を検討。
- **Allow HTTP/2 ALPN override** — 有効にすると、サーバが HTTP/2 サポートを広告しなくても ALPN を使って HTTP/2 リクエストを送れる。**隠れた HTTP/2 サポート**のテスト、隠れた HTTP/2 攻撃面の探索が可能。

#### 7-2. Message modification（送受信時の挙動）★プロジェクト設定

- **Update Content-Length** — 既定で Burp が自動的にリクエストの Content-Length ヘッダを更新。ボディがある場合に通常必要。
- **Unpack compressed responses** — 既定で応答の gzip / deflate / Brotli 圧縮コンテンツを自動展開。
- **Normalize HTTP/1 line endings** — 既定で HTTP/1 の行末を正規化し、改行文字（`\n`）で終わる行にキャリッジリターン（`\r`）を追加する。CR は改行の直前に追加され、不正なリクエスト送信リスクを減らす。**request smuggling** 等の脆弱性テストで意図的に改行を省く場合はこの設定を無効化できる。
- **Strip Connection header over HTTP/2** — 既定で Burp は HTTP/2 リクエスト送信前に Connection ヘッダを除去。多くの HTTP/2 サーバはこのヘッダを含むリクエストを拒否するため。無効化すると、Connection ヘッダ付き HTTP/2 リクエストにサーバがどう応答するか見られる。

#### 7-3. Redirects（リダイレクト処理）★プロジェクト設定

**Follow redirects** の選択肢:
- **Never** — リダイレクトを追わない。
- **On-site only** — 同一ドメイン宛のリダイレクトを追う。
- **In-scope only** — in-scope 宛のリダイレクトを追う。
- **Always** — 常にリダイレクトを追う。

自動で追わない設定のリダイレクト応答を受けると **Follow redirection** ボタンが表示され、クリックで手動でリダイレクトシーケンスを1つずつ辿れる。

- **Process cookies in redirects** — 有効にすると、リダイレクト応答で設定された Cookie をリダイレクト先追跡時に再送。
- **Use selected protocol for cross-domain redirects** — Inspector の Request Attributes で選んだプロトコルでクロスドメインリダイレクトを追うか制御。既定は無効（通常どおりプロトコルネゴシエート）。**HTTP/2 固有の脆弱性**でクロスドメインリクエストが発生する場合に有効化を検討。

#### 7-4. Default tab group ★プロジェクト設定

Repeater に送る新規リクエストを追加するタブグループを指定。事前に Repeater でタブグループを作成しておく必要がある。補足（Note）: Repeater 内で作る新規リクエストタブには影響しない（作成時にグループに割り当てられない）。

#### 7-5. Tab view ★ユーザ設定（マシン上の全 Burp インストールに適用）

Repeater の既定タブビュー: **Scrolling view** / **Wrapped view**。

---

### 8. Repeater チュートリアル（出典: getting-started/reissuing-http-requests.html）★教材として有用

> 「In this tutorial, you'll use Burp Repeater to send an interesting request over and over again. This lets you study the target website's response to different input without having to intercept the request each time.」

流れ（逐語訳の要点）:
- **Sending a request to Burp Repeater** — 最も一般的な使い方は他の Burp ツールからリクエストを送ること。例では Proxy の HTTP history から送る。
  - Step 1: 興味深いリクエストを特定（商品ページアクセスごとに `GET /product` が `productId` クエリパラメータ付きで送られる）。
  - Step 2: `GET /product?productId=[...]` を右クリックし **Send to Repeater** → Repeater タブに専用番号タブで待機。
  - Step 3: **Send** をクリックして応答を見る。何度でも再送でき応答は毎回更新される。
- **Testing different input with Burp Repeater**:
  - Step 1: `productId` の数値を変えて再送（任意の数値、大きな数値も）。
  - Step 2: 矢印で送信履歴とその応答を前後に辿る。ドロップダウンで特定リクエストへジャンプ。存在する ID なら別の商品ページ、なければ **Not Found**。
  - Step 3: 整数を期待するパラメータに**別のデータ型（文字列）を送る**。
  - Step 4: 非整数 `productId` で例外が発生し、サーバがスタックトレースを含む冗長なエラー応答を返す。応答から Web サイトが **Apache Struts** フレームワークを使っていること、そのバージョンまで判明（情報開示脆弱性）。lab の解答は Struts バージョン `2 2.3.31`。

→ この演習は「Repeater で同じリクエストを異なる入力で再送し、入力ベースの脆弱性（ここでは情報開示）を発見・確認する」典型ワークフローを示す。

---

### 9. Inspector（出典: tools/inspector/index.html, modify-requests.html, getting-started-inspector.html）★Repeater と一体で使う

> 「The Inspector enables you to quickly view and edit interesting features of HTTP and WebSocket messages without having to switch between different tabs.」

Inspector は message editor の隣、side panel からアクセス。用途（逐語訳）:
- パラメータや Cookie、エディタで選択した部分文字列の**完全にデコードされた値**を見る。
- ボタン一つで項目の**追加・削除・並べ替え**（生の HTTP 構文を扱わずに済む）。
- **デコード形式のままデータを編集**（リクエスト更新時にシーケンスが自動再エンコード）。
- 個別リクエストの**プロトコルをトグル**（Burp が新プロトコル用の等価リクエストへ自動変換）。
- **HTTP ヘッダと疑似ヘッダ**を message editor の HTTP/1 構文に縛られずに扱う（HTTP/2 固有テストの高度技法が可能）。

一部機能は編集可能リクエストでのみ利用可（Burp Repeater や Proxy でインターセプトしたリクエストなど）。

補足（Note）: message editor にタブを追加して同じ情報を表示できる（Settings ダイアログの Message editor settings で有効化）。

#### 9-1. Inspector レイアウト構成

- side panel を左/右にドック。
- Inspector ウィジェットを一括展開/折りたたみ（展開ボタンはデータを含むウィジェットのみ展開）。
- 一部ツールでは Inspector と Notes を切替（Notes をクリック）。
- settings アイコンで Settings ダイアログを開き、ウィジェット表示や side panel の既定レイアウトを調整。

#### 9-2. Request attributes

HTTP メソッド・パス・送信に使われたプロトコルを表示。編集可能メッセージでは、送信時に使いたいプロトコルを表示。プロトコル変更時、Burp が新プロトコル用の等価リクエストへ変換（個別リクエストの容易なアップグレード/ダウングレード）。

#### 9-3. HTTP メッセージデータの表示 と 自動デコード（Automatic decoding）

Inspector はリクエスト/応答のヘッダ・パラメータ・Cookie を name-value ペアで、カテゴリごとにグループ化して表示。各カテゴリ横の数字が項目数。

> 「The values shown in the Inspector are automatically decoded from HTML, URL, and Base64.」

= 値は **HTML / URL / Base64** から自動デコードされて表示される。メインビューでは最終デコード結果のみ見える。項目右の矢印をクリックすると Inspector が適用した各デコードステップを見られる。**Decoded from** ドロップダウンでデコードステップの順序を変更、プラス/マイナスアイコンで手動追加/削除。

#### 9-4. HTTP/2 ヘッダと疑似ヘッダ

Inspector は HTTP/2 の**疑似ヘッダ（pseudo-header）**を通常ヘッダと並べて表示。識別のため各疑似ヘッダは**コロン（`:`）で始まる**。これは HTTP/1 構文から完全に切り離した HTTP/2 リクエストの扱い方を提供し、サーバへ実際に送られるリクエストにより近い。message editor 経由では不可能な注入を使い、多くの HTTP/2 固有脆弱性をテストできる。

#### 9-5. 部分文字列の選択（Selecting a substring）

message editor で部分文字列をハイライトすると Inspector で見られる。1文字以上を選ぶと **Selection** ウィジェットが出る:
- 1文字を選ぶと ASCII コードポイントを 10 進または 16 進で表示。
- 複数文字を選ぶと Inspector が自動デコードし、文字数をカテゴリ見出し横に表示。

補足（Note）: Selection ウィジェットは非表示文字も表示する。複数行をハイライトすると各行末の `\r\n` 文字が見える。

#### 9-6. リクエストの修正（modify-requests.html）

- **新項目の追加**（HTTP ヘッダ等）: 該当カテゴリを展開 → 下部の **Add** → 名前と値を入力し **Add**。message editor が更新される。
- **項目の削除**: 項目を選択し下部のゴミ箱アイコン。クリック&ドラッグで複数選択可。
- **項目の並べ替え**: 項目を選択し下部の矢印ボタン。
- **名前/値の編集**: メインパネルで項目をダブルクリック。Inspector が自動デコードしたデータを編集した場合、変更が注入される前に**同じ符号化シーケンスが適用**される。
- **改行の注入（Injecting newlines）**: 項目右の矢印をクリック → Name/Value フィールドの注入位置を選択 → **Shift + Return**。CR/LF が `\r\n` アイコンで注入される。**James Kettle が発見した多数の HTTP/2 排他脆弱性の悪用に不可欠**（whitepaper: HTTP/2: The Sequel Is Always Worse）。
- **その他の非表示文字の注入**: 適切な位置にプレースホルダ文字を追加 → 選択 → Selection ウィジェットでコードポイント変更（例: コードポイントを `00` にして NULL バイトに置換）。プレースホルダ無しで注入するには message editor の Hex タブへ切替。
- **項目のコピー**: Inspector パネルから項目をコピー。名前だけ・値だけもコピー可（Copy name / Copy value）。エンコードされたデータをコピーすると、Inspector に見える**デコード版ではなく元のエンコード値**がクリップボードにコピーされる。

#### 9-7. Inspector チュートリアル（getting-started-inspector.html）— session cookie 改ざん

deserialization lab を使い、`GET /my-account` の Request Cookies を Inspector で展開 → session cookie をドリルダウンすると URL デコード後に Base64 デコードの手順が自動適用される。リクエストを Send to Repeater し、Repeater で **Decoded from Base64** フィールドの `wiener` を `administrator` に変更して **Apply changes** → Inspector が正しい符号化シーケンスを自動再適用して修正値をリクエストに挿入。message editor で session cookie の値を手動ハイライトすると同様に自動デコードされる（部分文字列や非標準データ構造の扱いに有用）。

〔補足（一般知識）〕 クライアントサイド視点では Inspector の自動デコードは、DOM ベース脆弱性で source（`location.hash` / postMessage データ）に至る前に URL/Base64 で多重エンコードされた値を素早く読み解くのに役立つ。Cookie やパラメータに埋め込まれた JSON/Base64 ペイロードを人間可読に展開し、そのまま編集して再送できる。

---

### 10. HTTP/2 の扱い（出典: http2/index.html）★Repeater/Inspector と密接

> 「Burp Suite provides unrivaled support for HTTP/2-based testing.」

2つの働き方（逐語訳）:
- **message editor で HTTP/1 スタイル表現を扱う** — Burp が変更を正規化し、等価な HTTP/2 リクエストをサーバへ送る。プロトコルが重要でない一般テストに最適。
- **Inspector で HTTP/2 ビューを扱う** — サーバへ送られるヘッダ・疑似ヘッダをより正確に表現。HTTP/1 構文に依存しないため、多数の **HTTP/2 排他ベクトル**で攻撃を構築できる。

**既定プロトコル**: Burp は TLS ハンドシェイクの ALPN で HTTP/2 サポートを広告する全サーバに対し既定で HTTP/2 を話す。プロジェクトの既定プロトコルは変更可能（HTTP/1 が必要なテスト時）。個別リクエストは Inspector でプロトコルを切り替えられる。

**プロトコルの確認場所**:
- message editor のリクエスト行/ステータス行にプロトコルバージョン。
- **Burp Repeater では画面右上、target host の横**に現在のプロトコルを表示。
- Inspector の Request Attributes セクションにプロトコルバージョン。編集不可コンテキスト（proxy history 等）ではハイライトされたプロトコルは情報表示のみ。Proxy でインターセプト/Repeater に送ったリクエストは使うプロトコルをトグルできる。

**リクエストのプロトコル変更**: Inspector > Request Attributes のトグルスイッチ。既定ではサーバが ALPN で HTTP/2 を明示的に広告する場合のみアップグレード可。隠れた HTTP/2 サポートを試すには先に Repeater メニューの **Allow HTTP/2 ALPN override** を有効化。

#### 10-1. Kettled requests（HTTP/1 で正確に表現できない HTTP/2 リクエスト）

> 「The Inspector enables you to create HTTP/2 requests that are impossible to accurately represent using HTTP/1 syntax without losing information.」

例: HTTP/2 ではヘッダ値の中に改行文字を入れることが技術的に可能。HTTP/1 では改行がヘッダの終わりを示すため表現できない。リクエストが kettled になると message editor はヘッダの HTTP/1 等価表示を止め、ボディは見えるがヘッダの代わりに kettled 理由の通知を表示。さらなるヘッダ変更には Inspector を使う。

補足（Note）: Burp Proxy, Repeater, Logger, Scanner は kettled リクエストをサポート。サポートしないツール（**Intruder** など）へ送ると、エディタで表示できるよう正規化される。

**kettled になる原因（Inspector での以下の変更、逐語）:**
- ヘッダ名に大文字またはコロンを追加。
- ヘッダ名または値に改行文字を追加。
- `:scheme` 疑似ヘッダの値を変更。
- `:path` または `:method` 疑似ヘッダにスペース文字を追加。
- 疑似ヘッダを重複追加。
- Cookie 値にセミコロン＋スペース文字を追加。

**unkettle する方法**: Ctrl/Cmd + Z で元に戻す / Inspector で原因の変更を手動で逆戻し / HTTP/1 へダウングレード（変更が失われる警告を承知で正規化）。

#### 10-2. Repeater の HTTP/2 オプション（Repeater メニュー）

- **Enforce protocol choice on cross-domain redirections** — 既定はクロスドメインリダイレクトで通常のプロトコルネゴシエート。有効にすると Inspector > Request Attributes で選んだプロトコルでクロスドメインリダイレクトを追う（HTTP/2 固有脆弱性のテストに重要）。
- **Enable HTTP/2 connection reuse** — 既定で複数 HTTP/2 リクエストに同一接続を再利用。サーバが接続上の最初のリクエストを別扱いする、または1リクエストが接続を破壊し後続に影響する場合、無効化して常に接続上の最初のリクエストにする。
- **Strip Connection header over HTTP/2** — 既定で除去（多くの HTTP/2 サーバが拒否するため）。実験的に送るなら無効化。
- **Allow HTTP/2 ALPN override** — サーバが ALPN で広告しなくても Repeater から HTTP/2 リクエストを送れる（隠れた HTTP/2 攻撃面の探索/手動テスト）。

**Proxy listener の HTTP/2 無効化**: Settings > Tools > Proxy でリスナーを選び Edit → HTTP/2 タブで Support HTTP/2 のチェックを外す（クライアント↔Burp 間のみ、Burp↔サーバ間には影響しない）。

補足（Upcoming）: 現状 Intruder 等一部ツールは kettled リクエストを扱えない。将来的に全ツールで対応予定。

---

### 11. Message editor（出典: tools/message-editor/index.html）★Repeater/Intruder 共通基盤

message editor は Burp 全体で HTTP/WebSocket メッセージを見る場所。Repeater/Intruder では編集・再送も可能。主要パネル: text editor（一部ツールで read-only）と side panel（Inspector を含む）。

**画面レイアウト（右上3アイコン）**: Horizontal（左右並べ）/ Vertical（上下重ね）/ Combined（タブ切替）。

**Message analysis toolbar のタブ:**
- **Raw** — 生形式で全メッセージ。syntax analysis / hotkeys / text search、`\n` ボタンで非表示文字表示切替。Repeater 等では直接編集可能。
- **Pretty** — Raw と同機能＋pretty printing（標準化されたインデント・改行で可読性向上）。対応フォーマットを含む場合のみ表示。
- **Hex** — 16進エディタ。16バイト/行、各バイトの hex 値。文字または2桁 hex（00〜FF）で編集。コードポイント表示、非表示文字挿入、個別バイト/文字列の挿入削除に有用。コンテキストメニュー: Insert byte / Insert bytes / Insert string / Delete selected byte(s)。
- **Render** — HTML/画像を含む HTTP 応答をブラウザ表示のように描画。
- **GraphQL** — GraphQL クエリを検出すると出現。クエリ構造（Query パネル）と変数（Variables パネル）を分離表示。
- **Additional tabs**（追加可）: Headers / Query params / Body params / Cookies / Attributes（Inspector ウィジェットと同機能）。

**Actions メニュー / コンテキストメニューの主な操作（逐語訳）:**
- **Scan / send to ...** — メッセージ全体または選択部分を他の Burp ツールへ送る（Burp の user-driven workflow の核）。
- **Show response in browser** — 応答用のユニーク URL を生成し Burp's browser に貼って描画（元 Web サーバへは転送されず、選んだ応答をそのまま返す。相対リンクが正しく扱われる）。
- **Request in browser** — 選択リクエストを Burp's browser で再発行。**In original session**（元リクエストの Cookie ヘッダで発行）/ **In current browser session**（ブラウザ提供の Cookie で発行）。後者は**アクセス制御テスト**に使える（管理者コンテキストで生成したリクエストを一般ユーザでログインし再発行）。
- **Engagement tools**（Pro）。
- **Change request method** — GET/POST を自動切替（パラメータを適切に再配置）。入力フィルタ回避や XSS 攻撃の微調整に。
- **Change body encoding** — ボディを URL-encoded と multipart で切替。
- **Copy URL** / **Copy as curl command** / **Copy to file** / **Paste from file** / **Save item**（XML でリクエスト/応答をメタデータ付き保存）。
- **Convert selection**（Raw ビューのみ）— 選択テキストのエンコード/デコード:
  - **URL** — URL エンコード/デコード（キー HTTP メタ文字のみ / 全文字 / 全文字 2-byte Unicode `%u0041`＝A）。
  - **HTML** — HTML エンコード/デコード（メタ文字のみ / 数値エンティティ `&#65;`＝A / hex エンティティ `&#x41;`＝A）。
  - **Base64** / **Base64 URL**。
  - **Construct string** — 選択文字列を動的構築するコードを各言語で生成（JavaScript、SQL の Microsoft/Oracle/MySQL）。SQL インジェクション等で入力フィルタ回避に有用。
- **URL-encode as you type**（Raw ビューのみ）— `&` や `=` を入力時に自動 URL エンコード。

---

### 12. Burp Intruder — 概要（出典: tools/intruder/index.html, getting-started.html）★最重要

> 「Burp Intruder is a tool for automating customized attacks against web applications. It enables you to configure attacks that send the same HTTP request over and over again, inserting different payloads into predefined positions each time.」

= Burp Intruder は Web アプリへのカスタマイズ攻撃を自動化するツール。同じ HTTP リクエストを、あらかじめ定義した位置に毎回異なるペイロードを差し込みながら繰り返し送る。

主な用途（getting-started の逐語）:
- 「Fuzz for input-based vulnerabilities.」（入力ベースの脆弱性を fuzzing）
- 「Perform brute-force attacks.」（総当たり攻撃）
- 「Enumerate valid identifiers and other inputs.」（有効な識別子等の列挙）
- 「Harvest useful data.」（有用なデータの収集）

#### Intruder チュートリアル（getting-started.html）— ユーザ名列挙

username enumeration lab を使う（逐語訳の要点）:
1. Burp's browser で lab にアクセス。
2. 無効なユーザ名/パスワードでログイン試行 → Proxy > HTTP history で `POST /login` を探す。
3. `username` パラメータ値をハイライトして右クリック → **Send to Intruder**。
4. Intruder タブへ。この `POST /login` を base request として使う。`username` の値が **§ 文字**で payload position としてマークされている。
5. Attack type を **Sniper** に設定（単一ペイロードセットを1つ以上の位置に順番に差し込む）。
6. **Payloads** タブへ。Payload type は **Simple list**。候補ユーザ名リストを **Paste** で追加。Payload count: 101 / Request count: 101。
7. 右上 **Start attack** → 新しい攻撃ウィンドウで各リクエストを確認。
8. 攻撃完了後、**Length** 列の見出しをクリックしてソート。1つの応答だけ長さが異なる。
9. 応答を調べると、多くは `Invalid username` エラー、長さの違う1つだけ `Incorrect password` エラー → **このユーザ名が有効**である可能性が強い。

What next: 有効ユーザ名が得られたら次はパスワードの brute-force。

---

### 13. Intruder の典型的用途（出典: tools/intruder/uses/*）

概要（uses/index.html の逐語リスト）:
- **Enumerating identifiers** — 有効な識別子（ユーザ名/パスワード等）を抽出。
- **Harvesting useful data** — 識別子に関する興味深い情報を抽出。
- **Fuzzing for vulnerabilities** — 入力ベースの脆弱性を特定。
- **Enumerating subdomains** — 追加の攻撃面を発見。
- **Brute-forcing logins** — ユーザ名/パスワードの組合せを推測。

#### 13-1. Fuzzing for vulnerabilities（fuzzing.html）

入力ベースの脆弱性（SQL injection / Cross-site scripting / Directory traversal）をエラーメッセージや例外の分析で特定。手順（逐語訳）:
1. **全リクエストパラメータの値に payload position を設定**。
2. Payload type = simple list、攻撃文字列リストを追加（Pro なら組込みの一般 fuzz 文字列リスト＝Predefined payload lists 使用可）。
3. **Grep - Match** 設定で一般的なエラーメッセージ文字列を含む応答をフラグ（独自の式または既定項目）。
4. Match grep の式で結果をソートし、共通エラー文字列を持つ結果を特定。

補足（Note）: 同じペイロードと Match grep 設定で大量のリクエストをテストするには、タブの設定を保存/コピーできる。

#### 13-2. Harvesting useful data（harvesting.html）

攻撃から興味深いデータを抽出。手順（逐語訳）:
1. 識別子をパラメータに含み、その識別子に関する興味深いデータを応答に持つリクエストを探す。
2. パラメータ値に単一の payload position を設定。
3. 正しい形式/スキームでテスト対象の識別子を生成する適切な payload type を使う。
4. **Grep - extract** 設定で各応答から関連データを取得。
5. extract grep の式で結果をソートし抽出情報を特定。（Pro: ヘッダを control-click でデータをコピー）

ユースケース（逐語訳）:
- **Extract password hint** — 一般ユーザ名リストを忘れたパスワード機能に入れ、各ユーザのパスワードヒントを extract grep で取得。推測容易なものを特定。
- **Identify page title tags** — numbers payload type でページ ID 番号を巡回し、各ページの HTML title タグを extract grep で取得。
- **Identify user roles** — 既知ユーザ名リストをユーザプロフィールページに入れ、各ユーザの role を取得。管理アカウントを特定。

#### 13-3. Enumerating identifiers（enumerating.html）

Web アプリは識別子（ユーザ名/パスワード、Document ID、Account number）でデータやリソースを参照する。手順（逐語訳）:
1. 識別子をパラメータに含むリクエストを探す。
2. パラメータ値に単一 payload position。
3. 適切な payload type で候補識別子を生成し攻撃開始。
4. 各種属性で結果をソートし異常な結果を特定（有効な識別子は異なる HTTP ステータスコードを返すことがある）。

補足（Note）: 有効な識別子が特定の式を含む応答を返すなら、Match grep でその式（"password incorrect" や "login successful" 等）を含む応答を特定できる。

ユースケース（逐語訳）:
- **Enumerate usernames** — username generator payload type で候補ユーザ名リストをログイン失敗メッセージに挿入。
- **Enumerate passwords** — simple list payload type で一般パスワード集合を、既知の有効ユーザ名と合わせて挿入。
- **Enumerate order IDs** — custom iterator payload type で既知形式の注文 ID を巡回。
- **Enumerate session tokens** — bit flipper payload type で CBC 暗号化トークンを系統的に改変。

---

### 14. Intruder 攻撃の構成（出典: tools/intruder/configure-attack/index.html）

リクエストを Intruder に送ると新しい attack タブが開く。構成できる側面（逐語訳のリンク一覧）:
- **Payload positions** — base request 内でペイロードを置く位置。
- **Attack type** — payload positions にペイロードを置くアルゴリズム。
- **Payload type** — 注入するペイロードの種類（simple wordlist または自動生成。Pro は predefined payload lists）。
- **Payload processing** — 各ペイロードを使用前に操作するルール。
- **Resource pool** — 攻撃へのリソース割当。
- **Attack settings** — Intruder 攻撃設定。

top-level Intruder メニューで攻撃構成を保存/読込、任意の開いているタブへコピー可能（各機能で payload positions を含めるか選べる）。構成後 **Start attack** で標的サーバへ送る。

---

### 15. Payload positions（§ マーカー）（出典: configure-attack/positions.html）

**Payload positions field**: Intruder > Positions の Payload positions フィールドの任意の場所に設定可能。Intruder に送ると以下が自動投入される（逐語）:
- URL query string parameters.
- Body parameters.
- Cookies.
- Multipart parameter attributes（ファイルアップロードの filename 等）.
- XML data and element attributes.
- JSON parameters.

**Target field**: payload position を target フィールドにも設定できる。含まれるもの: **Protocol**（HTTP/HTTPS）/ **Host**（IP またはホスト名）/ **Port**。既定で **Update Host header to match target** が選択され、target への変更が base request の host 詳細に自動反映される。これを解除すると target だけ変更でき、固定 target へ任意の Host ヘッダを送れる（**HTTP host header 攻撃**の作成）。

**payload position の構成（逐語訳）:**
各 payload position は **§ マーカーのペア**で囲まれハイライトされる。
- リクエストを Intruder に送る際、message editor で位置の値をハイライトして右クリック → **Send to Intruder** で単一 position を自動設定。
- 複数設定/修正には Intruder > Positions タブのボタンを使う:
  - **Add §** — 単一 payload marker を挿入。テキスト選択して Add § するとその両側にマーカー挿入。
  - **Clear §** — 全 payload marker を削除（テキスト選択時は選択範囲内のみ）。
  - **Auto §** — 自動 payload positions を適用。base パラメータ値を置換するか追加するかは Settings ダイアログで構成。テキスト選択時は選択範囲内のみ（XML/JSON 形式の multipart パラメータ値をハイライトして Auto § でその中に配置）。
  - **Refresh** — syntax colorizing を既定に戻す。
  - **Clear** — リクエストテンプレートをクリア。

攻撃中、payload marker と囲まれたテキストの両方がペイロードで置換される。position にペイロードが割り当てられていない場合、囲まれたテキストは変わらずマーカーだけ除去される。

補足（Note）: payload positions は **Burp Scanner の insertion point** としても使える。positions を構成して Intruder メニュー → **Scan defined insertion points**。

---

### 16. Attack types（4種）（出典: configure-attack/attack-types.html）★頻出

attack type は「ペイロードが payload positions にどう割り当てられるか」を決める。設定は Intruder > Positions の **Choose an attack type** ドロップダウン。ペイロードを単一セットか複数セット（最大20）から取るか、順番に割り当てるか同時か、を構成する。

#### Sniper（スナイパー）
> 「This attack places each payload into each payload position in turn. It uses a single payload set.」

= 各ペイロードを各 position に**順番に1つずつ**置く。**単一ペイロードセット**。総リクエスト数 = **position 数 × ペイロード数**。多数のリクエストパラメータを一般脆弱性で個別に fuzzing するのに有用。

#### Battering ram（破城槌）
> 「This attack places the same payload into all of the defined payload positions simultaneously. It uses a single payload set.」

= **同じペイロード**を定義済みの**全 position に同時**に置く。**単一ペイロードセット**。総リクエスト数 = **ペイロード数**。同じ入力をリクエスト内の複数箇所に入れる必要がある攻撃に有用（例: Cookie とボディパラメータの両方にユーザ名）。

#### Pitchfork（ピッチフォーク）
> 「This attack iterates through a different payload set for each defined position. Payloads are placed into each position simultaneously.」

= **position ごとに別のペイロードセット**を巡回。ペイロードを各 position に**同時**に置く。例（逐語）:
- Request one: Position 1 = Set 1 の1番目、Position 2 = Set 2 の1番目。
- Request two: Position 1 = Set 1 の2番目、Position 2 = Set 2 の2番目。
- Request three: Position 1 = Set 1 の3番目、Position 2 = Set 2 の3番目。

総リクエスト数 = **最小のペイロードセットのペイロード数**。異なるが関連する入力を複数箇所に入れる攻撃に有用（例: あるパラメータにユーザ名、別パラメータにそれに対応する既知の ID 番号）。

#### Cluster bomb（クラスター爆弾）
> 「This attack iterates through a different payload set for each defined position. Payloads are placed from each set in turn, so that all payload combinations are tested.」

= **position ごとに別のペイロードセット**を巡回。各セットのペイロードを順番に置き、**全組合せ**をテスト。例（逐語）:
- Request one: Position 1 = Set 1 の1番目、Position 2 = Set 2 の1番目。
- Request two: Position 1 = Set 1 の1番目、Position 2 = Set 2 の2番目。
- Request three: Position 1 = Set 1 の1番目、Position 2 = Set 2 の3番目。

総リクエスト数 = **全ペイロードセットのペイロード数の積**（極めて大きくなり得る）。無関係または未知の入力を複数箇所に入れる攻撃に有用（例: ユーザ名とパスワードの両方を推測）。チュートリアル: Brute-forcing a login mechanism using Burp Intruder。

---

### 17. Payload types（多数）（出典: configure-attack/payload-types.html）★網羅必須

Intruder > Payloads タブの **Payload Sets** フィールドで payload type を選択。Pro は多くの type で predefined payload lists 使用可。

**Payload settings の基本操作（多くの type 共通、逐語訳）:**
- **Paste** — クリップボードからリスト挿入。
- **Load** — ファイルからリスト読込。
- **Remove** — ハイライト項目を削除。
- **Clear** — リストの全項目を削除。
- **Deduplicate** — 重複エントリを除去（リクエスト数を減らし効率化）。
- **Add** — 新項目を入力。
- **Add from list** — predefined payload list を追加。

#### 17-1. Simple list
文字列の単純なリストをペイロードとして使う。

#### 17-2. Runtime file
実行時にファイルからペイロード文字列を読む。非常に大きなリストが必要でメモリに全体を保持したくない場合に使う。**ファイルの各行から1ペイロード**を読むため、**ペイロードに改行文字を含められない**。

#### 17-3. Custom iterator
テンプレートに従い文字/項目の順列でペイロード生成。テンプレートに**最大8個の position** を定義し各 position にリスト設定、position 間にセパレータ使用可。例: テンプレート `AA/11` で最初の2 position を A–Z、後の2 position を 0–9 で巡回。**Preset schemes**: Directories / file . extensions（URL 生成）/ Two-digit hex（16進数生成）/ Passwords + digit（パスワード推測用拡張ワードリスト）。**Clear all** で全 position の構成をクリア。

#### 17-4. Character substitution
文字列リストの各項目に文字置換を適用。パスワード推測で辞書語の一般的変種生成に。例: 置換 `e > 3` と `t > 7` で項目 "peter" は次を生成:
```
peter
p3ter
pe7er
p37er
pet3r
p3t3r
pe73r
p373r
```

#### 17-5. Case modification
文字列リストの各項目に大文字小文字変更を適用（重複ペイロードは破棄）。選択肢（逐語）:
- **No change** — 変更なし。
- **To lower case** — 全て小文字。
- **To upper case** — 全て大文字。
- **To Propername** — 最初の文字を大文字、後続を小文字。
- **To ProperName** — 最初の文字を大文字、後続は変更なし。

例（全オプション選択時、項目 "Peter Wiener"）:
```
Peter Wiener
peter wiener
PETER WIENER
Peter wiener
```

#### 17-6. Recursive grep
前のリクエストの応答からテキストを抽出し、現在のリクエストのペイロードに使う。再帰的にデータ抽出/エクスプロイト配信する場合に。例: SQL injection でデータベース内容を再帰的に抽出:
```
UNION SELECT name FROM sysobjects WHERE name > 'a'
```
サーバのエラーメッセージが最初のデータベースオブジェクト名を開示:
```
Syntax error converting the varchar value 'accounts' to a column of data type int.
```
次に "accounts" を使ってクエリを繰り返す。設定: **Initial payload for first request** / **Extract grep item**（前応答の興味深い部分を抽出しペイロード導出）/ **Stop if duplicate payload found**。補足（Note）: recursive grep 攻撃は**max concurrent request が 1 の resource pool を使う必要がある**。

#### 17-7. Illegal Unicode
指定文字を別文字の不正な Unicode エンコードで置換してペイロード生成。文字ブロックフィルタ（例: `../` や `..\` の想定エンコードにマッチするパストラバーサル防御）の回避試行に。
- **Overlong UTF-8 encodings** — overlong エンコード使用可、最大長 6 バイトまで。基本 ASCII 文字（0x00–0x7F）を Unicode スキームで表現。
- **Illegal UTF-8 continuation bytes** — **Do illegal UTF-8**: 各 continuation byte につき3つの追加エンコードを生成（binary 形式 `00xxxxxx`, `01xxxxxx`, `11xxxxxx`。通常 continuation byte は `10xxxxxx`）。**Maximize permutations in multi-byte encodings**: 複数 continuation byte を同時に改変。
- **Illegal hex characters** — **Do illegal hex**: hex エンコードを改変（一部デコーダは G を 16、H を 17 と解釈。`0x1G` が 32、`0xG1` が 257→1 に解釈され得る）。各正当な2桁 hex コードには 4〜6 の対応する不正 hex 表現がある。
- **Hex formatting** — **Use lower case alpha characters** / **Add % prefix before each byte**（実質 URL エンコード）。
- **Total encodings** — エンコード数の推定表示と上限指定。
- **Match / replace in list items** — **Match character**（各項目内で置換される文字。ダミー `*` 等を使う）/ **Replace with encodings of**（不正エンコードを導出する文字。ASCII 文字または2桁 hex で指定。非印字 ASCII の指定に有用）。

#### 17-8. Character blocks
指定文字/文字列のブロックでペイロード生成。**バッファオーバーフロー**等の境界条件脆弱性の検出、特定長入力がフィルタを回避/予期しないコードパスを起こすロジック欠陥の悪用に。設定: **Base string** / **Min length**（base string をこの数で乗じて最小ブロック）/ **Max length** / **Step**（各ブロック長の増分）。

#### 17-9. Numbers
指定範囲・形式で数値ペイロード生成。
- **Number range**: **Type**（sequentially / random）/ **From** / **To** / **Step**（負値可＝降順）/ **How many**（ランダム生成数、重複あり得る）。
- 補足（Note）: 総桁数が約12桁超の範囲を巡回するなら、payload markers で大きな数の一部だけをハイライトし桁数の少ない数値ペイロードを生成する方が信頼性が高い（Burp は倍精度浮動小数点を使うため大きな/精密な数で精度が落ちる）。
- **Number format**: **Base**（decimal / hexadecimal）/ **Min integer digits**（少ないと左ゼロパディング）/ **Max integer digits**（多いと最上位桁が切り捨て）/ **Min fraction digits**（decimal のみ、右ゼロパディング）/ **Max fraction digits**（decimal のみ、切り捨て）。空欄で最小/最大を強制しない。

#### 17-10. Dates
指定範囲・形式で日付ペイロード生成。データマイニング（異なる日の注文簿）や brute force（生年月日）に。設定: **From** / **To** / **Step**（days / weeks / months / years、正値）/ **Format**（既定形式選択またはカスタム）。

**カスタム日付形式の構文表（逐語再現）:**

| 記号 | 例 |
| --- | --- |
| E | Sat |
| EEEE | Saturday |
| d | 7 |
| dd | 07 |
| M | 6 |
| MM | 06 |
| MMM | Jun |
| MMMM | June |
| yy | 03 |
| yyyy | 2003 |
| / . : | / . : |

#### 17-11. Brute forcer
指定文字セットの全順列を含む指定長ペイロード生成。設定: **Character set**（ペイロードに使う文字集合。サイズで総数が指数的に増える）/ **Min length** / **Max length**。

#### 17-12. Null payloads
値が空文字列のペイロード生成。base request を無修正で繰り返し発行（payload positions 不要）。用途: sequencing 分析のための Cookie 収集 / アプリ層 DoS（高負荷タスクを繰り返し起動）/ 他の断続テストで使うセッショントークンの維持。指定数または無限に生成可能。

#### 17-13. Character frobber
入力の各文字位置の値を改変。入力は各 payload position の base 値または指定文字列。各項目を1文字ずつ巡回し、その文字の ASCII コードを1増やす。どのパラメータ値/部分がアプリ応答に影響するかのテストに（例: セッショントークンのどの部分がセッション状態を追跡するか）。

#### 17-14. Bit flipper
入力の各ビット位置の値を改変。設定: **Operate on**（base 値か別文字列）/ **Format of original data**（リテラル値か ASCII hex）/ **Select bits to flip**（最下位ビット `0000000X`〜最上位ビット `X0000000`）。

例（base "ab"、リテラル、全ビットフリップ）:
```
`b
cb
eb
ib
qb
Ab
!b
áb
ac
a`
af
aj
ar
aB
a"
aâ
```
例（"ab" を ASCII hex として扱い全ビットフリップ）:
```
aa
a9
af
a3
bb
8b
eb
2b
```
Character frobber と似た状況でより細かい制御が必要な時に。CBC モードのブロック暗号で暗号化された意味のあるデータでは、前の暗号ブロックのビットを改変して復号データの一部を系統的に変えられる可能性がある。

#### 17-15. Username generator
名前/メールアドレスのリストから、一般的なスキームで候補ユーザ名を導出。ユーザ名/メールスキームが不明で特定の人間を標的にする場合に有用。例: "peter wiener" から最大115の候補:
```
peterweiner
peter.wiener
wienerpeter
wiener.peter
peter
wiener
peterw
peter.w
wpeter
w.peter
pwiener
p.wiener
wienerp
wiener.p
...
```
項目ごとの最大生成ペイロード数を構成可能。

#### 17-16. ECB block shuffler
ECB 暗号化データの暗号文ブロックをシャッフルし、復号された平文を改変してアプリロジックに干渉。ECB は各平文ブロックを独立に暗号化するため、同一平文ブロックは同一暗号文ブロックになり、暗号文ブロックのシャッフルは対応する復号平文ブロックのシャッフルになる。設定: **Encrypted data to shuffle** / **Format of original data** / **Block size**（通常 8 または 16 バイト。不明なら各サイズで複数回実行）/ **Additional encrypted strings**（同一 cipher/key の暗号化文字列リストで、シャッフル用の追加ブロックを提供。多数のトークンを集めると成功確率が上がる）。

#### 17-17. Extension-generated
Burp extension を呼んでペイロード生成。**Select generator ...** で extension 提供の payload generator を選ぶ。extension は Intruder payload generator として登録されている必要。

#### 17-18. Copy other payload
現在のペイロードの値を別の payload position にコピー。用途: 2つの異なるパラメータが常に同値でないと目的のコードパスに到達しない場合（例: new password と confirm password）で cluster bomb と併用 / あるパラメータ値が別パラメータ値のチェックサムを含む場合。補足（Note）: リテラル値のコピーだけでなく、payload processing rule で別 position のペイロードから系統的に導出も可能。

#### 17-19. Collaborator payloads
**Burp Collaborator** ペイロードを生成・注入。各 Collaborator ペイロードは Collaborator サーバのドメインのサブドメインとなるユニーク識別子を含む。特定の脆弱性が生じると、標的アプリが注入ペイロードを使って Collaborator サーバと通信する。**Include Collaborator server location** で完全な Collaborator サーバアドレスをペイロードに含める（非選択時は識別子のみ）。Collaborator サーバとのやり取りは攻撃結果ウィンドウで見られる。補足（Note）: **やり取りは Collaborator タブには表示されない**。遅延したやり取りを特定するには攻撃を保存し Dashboard の Event log を監視。

〔補足（一般知識）〕 Collaborator payloads は SSRF・ブラインド XSS・帯域外（OOB）SQL/コマンドインジェクションなど「応答に結果が直接現れない」脆弱性の検出に不可欠。クライアントサイドではブラインド XSS（管理画面など自分が見られない文脈で発火する保存型 XSS）の検出に活用できる。

---

### 18. Predefined payload lists（出典: configure-attack/payload-lists.html）★Pro のみ

> 「Burp Intruder includes a range of built-in payload lists.」

使い方（逐語訳）: Intruder > Payloads で適切な payload type を選び、Payload settings の **Add from list...** をクリック、ドロップダウンからリスト選択。リストにプレースホルダがあれば処理ルールを設定。補足: Settings ダイアログで独自のカスタム payload list ディレクトリを読込可能。

**プレースホルダを含む predefined payload list（表を逐語再現）:**

| Predefined payload list | Placeholders used in the list |
| --- | --- |
| CGI Scripts | {file} |
| Fuzzing - full | {base}, {domain}, foo@{domain} |
| Fuzzing - JSON_XML injection | {base} |
| Fuzzing - out of band | {domain} |
| Fuzzing - path traversal (single file) | {file} |
| Fuzzing - path traversal | {base} |
| Fuzzing - quick | {base} |

**プレースホルダの使い方（表を逐語再現）:**

| Placeholder | Use | Example placeholder replacement |
| --- | --- | --- |
| {file} | Specify a filename. | /etc/passwd |
| {base} | Replaces {base} with value marked as payload. | 1337 |
| {domain} | Specify a web domain. | COLLAB_ID.oastify.com |
| foo@{domain} | Specify a web domain as part of an email address. | example.com |

**攻撃でプレースホルダを処理する手順（逐語訳）:**
1. Intruder > Payloads の **Payload processing** フィールドへ。
2. **Add** → 処理ルールのドロップダウン。
3. **Match/replace** を選択。
4. **Match regex** フィールドにペイロード内のプレースホルダを入力（例: `\{file\}` や `\{domain\}`）。
5. **Replace with** フィールドに置換する項目を入力（例: `\{file\}` の代わりに `application.exe`、`\{domain\}` の代わりに `portswigger.net`）。

---

### 19. Payload processing（ペイロード加工）（出典: configure-attack/processing.html）★Pro

> 「You can configure payload processing rules so that Burp Intruder modifies payloads before it inserts them into the request.」

用途: 変わったペイロード生成 / ペイロードをより広い構造・エンコードスキームで包む / predefined wordlist の各ペイロードに符号化シーケンスを適用。

**処理ルールの構成（逐語訳）:**
1. Intruder > Payloads の **Payload Processing** フィールドへ。
2. **Add** → 処理ルールのドロップダウン。
3. ルール種別を選び、要件を入力。

処理ルールは**順番に実行**される。**Up / Down** で順序変更。各ルールのオン/オフ切替可（構成デバッグに有用）。

**処理ルールの種類（逐語訳）:**
- **Add prefix** — ペイロードの前にリテラル prefix を追加。
- **Add suffix** — ペイロードの後にリテラル suffix を追加。
- **Match / replace** — ペイロードの正規表現マッチ部分をリテラル文字列で置換。
- **Substring** — ペイロードの部分を抽出（指定オフセット〔0 始まり〕から指定長まで）。
- **Reverse substring** — substring と同様だが終了オフセットは末尾から逆算、長さも末尾から逆算。
- **Modify case** — ペイロードの case を変更（case modification payload type と同設定）。
- **Encode** — ペイロードをエンコード: URL / HTML / Base64 / ASCII hex / 各プラットフォーム用の構築文字列。
- **Decode** — ペイロードをデコード: URL / HTML / Base64 / ASCII hex。
- **Hash** — ハッシュ操作。
- **Add raw payload** — 生ペイロード値を現在の処理済み値の前後に追加（同一ペイロードを raw と hash 両形式で送る場合に有用）。
- **Skip if matches regex** — 処理済み値が指定正規表現にマッチしたらペイロードをスキップ（最小長未満の値をスキップ等）。
- **Invoke Burp extension** — Burp extension を呼んで処理（extension が Intruder payload processor を登録済みである必要）。
- **Replace placeholder with base value** — ペイロードの `{base}` マッチ部分を payload position の base 値で置換。
- **Replace placeholder with collaborator payload** — 正規表現マッチ部分を Collaborator ペイロードで置換。

**payload encoding の構成（最終 URL エンコード、逐語訳）:**
HTTP リクエストで安全に送るため選択文字を URL エンコードできる。この設定は**処理ルール実行後に適用**されるため、最終的な URL エンコードに使う（payload grep 設定が反射ペイロードをチェックした後にエンコードを適用できる）。手順: Intruder > Payloads の **Payload encoding** フィールド → **URL-encode these characters** を選び、エンコードする文字を入力。

---

### 20. Attack settings（攻撃設定）（出典: configure-attack/settings.html）★grep 群が核

attack タブの **Settings** で構成。多くは攻撃実行中も変更可（結果ウィンドウのクローン Settings タブで編集）。

#### 20-1. Save attack（Pro）
既定でメモリ保存（Burp 終了で失われる）。**Save attack to project file** で project file に保存。興味深いものを見つけた時だけ保存推奨（保存し過ぎると大きなファイルに）。

#### 20-2. Request headers
- **Update Content-Length header** — 各リクエストに正しいボディ長で Content-Length を追加/更新。可変長ペイロードをボディに入れる攻撃に有用。
- **Set Connection header** — Connection ヘッダを値 `close` で追加/更新。サーバが有効な Content-Length/Transfer-Encoding を返さない場合に攻撃が速くなり得る。

#### 20-3. Error handling
- **Number of retries on network failure** — 失敗時のリトライ回数（断続的ネットワーク失敗はテスト中よくあるので複数回推奨）。
- **Pause before retry** — 失敗リクエストのリトライ前待機時間（ミリ秒）。

#### 20-4. Attack results
- **Store requests / responses** — 個別リクエスト/応答の内容を保存するか。一時ディレクトリのディスクを消費するが、攻撃中の完全表示・個別再送・他ツールへの送信が可能に。
- **Make unmodified baseline request** — 全 payload positions を base 値にしたテンプレートリクエストを追加発行。結果表の **item 0** として表示。攻撃応答と比較する base 応答の提供に有用。
- **Use denial-of-service mode** — サーバからの応答を一切処理しない。各リクエスト発行後すぐ TCP 接続を閉じる。アプリ層 DoS 攻撃に有用（高負荷タスクを起動するリクエストを繰り返し送り、ソケットを開いたままにしない）。
- **Store full payloads** — 各結果の完全ペイロード値を保存。メモリを追加消費するが、実行時に payload grep 設定変更やテンプレート修正での再送に必要。

#### 20-5. Grep - match ★リフレクション/エラー検出
> 「These settings flag result items that contain specified expressions in the response.」

- **Flag result items with responses matching these expressions** — フラグする式のリスト（既定は fuzzing に有用な一般エラー文字列）。
- **Match type** — 式が simple string か regular expression か。
- **Case sensitive match** — 大小区別するか。
- **Exclude HTTP headers** — HTTP 応答ヘッダをチェックから除外するか。

攻撃中、Burp はリスト内の各式に結果列を追加し、応答で式が見つかった回数を記録。列見出しクリックでソート。用途: Fuzzing / Enumerating identifiers。

#### 20-6. Grep - extract ★データ抽出
> 「These settings extract information from responses.」

**Extract the following items from responses** を選び **Add**。新ウィンドウで抽出項目の場所を定義（→ Response extraction rules、第21節）。補足（Note）: 同一項目の複数出現を抽出するには項目を連続で複数回追加（一意の prefix がない HTML 表から情報を取る場合等）。**Maximum capture length** で各項目の最大キャプチャ長を構成。攻撃中、抽出情報の結果列を追加。用途: Harvesting useful data。

#### 20-7. Grep - payloads ★XSS 等のリフレクション検出
> 「These settings can be used to flag result items containing reflections of the submitted payload.」

- **Case sensitive match** — 大小区別するか。
- **Exclude HTTP headers** — HTTP 応答ヘッダを除外するか。
- **Match against pre-URL-encoded payloads** — ペイロードを pre-encoded 形式で応答チェック（Intruder でペイロードを URL エンコードした場合に必要。アプリが通常デコードして元形式で反射するため）。

攻撃中、ペイロードが応答で見つかった回数を記録する結果列を追加（複数ペイロードセット使用時はセットごとに別列）。**cross-site scripting** や他の応答注入脆弱性の検出に使える（ユーザ入力が動的にアプリ応答に挿入される時に生じる）。

#### 20-8. Redirections
攻撃時のリダイレクト処理を制御。パスワード推測で各試行結果がリダイレクト後にのみ表示される、fuzzing で関連フィードバックが初期リダイレクト後のエラーメッセージにのみ現れる、等で必要。補足（Note）: 自動追跡が問題を起こすことも（悪意リクエストへの応答がログアウトページへのリダイレクトだとセッションが終了）。

- **Follow redirections** — Never / On-site only / In-scope only / Always。
- **Process cookies in redirections** — リダイレクト応答で設定された Cookie をリダイレクト先追跡時に再送。

Burp は最大10連鎖のリダイレクトを追う。結果表の列が各結果でリダイレクトを追ったか示す。リダイレクト連鎖の完全なリクエスト/応答が各結果に保存される。処理するリダイレクト種別は suite 全体の redirection 設定（Settings の Proxy 配下）で構成。補足（Note）: リダイレクト追跡時は single-threaded 攻撃のみが必要なことがある（アプリが初期リクエスト結果をセッションに保存しリダイレクト応答配信時に取得する場合）。

#### 20-9. HTTP/1 connection reuse
Intruder が複数 HTTP/1 リクエスト発行に接続を再利用するか制御。攻撃速度が大きく向上。解除すると各リクエストで新規接続を開き応答受信後に閉じる。

#### 20-10. HTTP version
Intruder が現在の攻撃で HTTP/2 か HTTP/1 を使うか制御。**Override the project-level HTTP/2 setting** を有効にすると project レベル設定を無視。**Default to HTTP/2 if the server supports it** で TLS ハンドシェイクで広告する全サーバに HTTP/2 を使用。解除すると HTTP/2 対応サーバでも HTTP/1 を使用。

---

### 21. Response extraction rules（出典: settings/response-extraction.html）★Grep-extract / recursive grep の詳細

応答内の変動項目の位置を定義。Sequencer のカスタムセッショントークン特定、Intruder の extract grep 項目定義、マクロのカスタムパラメータ値位置指定で使う。ダイアログは上部パネルに現在の構成、下部パネルにサンプル応答を表示（未取得なら **Fetch response**）。最も簡単なのは**サンプル応答内で項目を選択**すること（**Update config based on selection** がチェックされていれば Burp が自動構成）。

**Define start and end（開始・終了の定義、逐語訳）:**
- **Start after expression** — 抽出項目の直前のリテラル式を指定。エスケープシーケンス使用可: `\r`=CR、`\n`=LF、`\xNN`=ASCII hex コード NN の文字、`\\`=リテラルのバックスラッシュ。
- **Start at offset** — 項目が始まる応答内の固定オフセット。
- **End at delimiter** — 抽出項目の直後のリテラル式（同じエスケープシーケンス）。
- **End at fixed length** — 項目の開始から抽出する固定長。

**Define from regex group（正規表現グループから定義、逐語訳）:**
グループを含む正規表現を指定するとマッチ時にグループの内容が抽出される。例: HTML title タグの内容を抽出:
```
<title>(.*?)</title>
```
応答に現れる最初の6桁の数を抽出:
```
(\d\d\d\d\d\d)
```

**構成のテスト:** 上部パネルを手動修正すると Burp が抽出される項目を応答内で自動ハイライト。**Refetch response** を数回クリックして構成をテスト。

---

### 22. Resource pool（リソースプール）（出典: configure-attack/resource-pool.html）

> 「A resource pool is a group of tasks that share a quota of resources.」

用途: システムリソース使用の管理・優先順位付け（特に複数攻撃間）/ 異なるレートで自動リクエストを許容するアプリのテスト。

**リソースプールの作成（逐語訳）:** 新規タスクは default resource pool に割り当てられる。攻撃開始前ならいつでもカスタムプール作成可。Intruder > Resource pool → **Create new resource pool** → 名前とプール設定を構成。プールは攻撃開始時に作成される。攻撃開始後に新プールを作るには別タスクか Settings の Project > Tasks で。

**リソースプール設定（各プールの throttling、逐語訳）:**
- **Maximum concurrent requests** — 攻撃が同時送信するリクエスト数を制限（標的サーバの過負荷やレート制限超過を防ぐ）。
- **Delay between requests** — ミリ秒。3種の遅延タイプ: **Fixed** / **With random variations** / **Increase delay in increments**（リクエストを送らない場合のセッション失効時間の判定に使える）。
- **Automatic throttling** — サーバが指定コードで応答した時に自動的に短い遅延を追加（default resource pool で有効化・構成）。

**タスクのプール間移動:** 攻撃開始前は Intruder > Resource pool でプール選択。攻撃中は攻撃ウィンドウの Resource pool タブでプール選択（リアルタイムでシステムリソース使用を管理）。

---

### 23. 攻撃結果の閲覧・分析・ワークフロー（出典: tools/intruder/results/*）

#### 23-1. 結果概要（results/index.html）
攻撃は新しい結果ウィンドウで実行され、攻撃結果と各構成タブのクローンを含む。興味深い応答の見分け方（逐語）:
- 「A different HTTP status code.」（異なる HTTP ステータスコード）
- 「A different length of response.」（異なる応答長）
- 「The presence or absence of certain expressions.」（特定の式の有無）
- 「The occurrence of an error or timeout.」（エラーやタイムアウトの発生）
- 「The time taken to receive or complete the response.」（応答受信/完了までの時間）

#### 23-2. 結果の閲覧（results/viewing-results.html）
Results タブの表に表示される情報（逐語訳）:
- **Request** — リクエストのインデックス番号（baseline 設定時は item 0）。
- **Position** — 現在のペイロードの位置番号（sniper 攻撃用）。
- **Payload** — リクエストに使われたペイロード。
- **Status** — HTTP ステータスコード。
- **Time of day** — リクエストを行った時刻。
- **Response received** — 応答受信開始までの時間（ミリ秒）。
- **Response completed** — 応答完了までの時間（ミリ秒）。
- **Error** — リクエスト発行時にネットワークエラーが起きたか。
- **Timeout** — 応答待機/処理中にタイムアウトが起きたか。
- **Length** — 応答長（バイト）。
- **Cookies** — 応答で受け取った Cookie。
- **Comment** — ユーザが付けたコメント。

適切な設定時に追加される情報: match grep 項目の結果 / extract grep 項目で抽出したデータ / payload grep 構成時にペイロードが応答に反射されたか / **Redirects followed**（追跡したリダイレクト数）/ **Interactions**（Collaborator ペイロード起因の Collaborator サーバとのやり取り数、Collaborator payloads type のみ）。

**リクエストの閲覧:** 表の項目を選ぶとリクエスト/応答を表示。リダイレクト追跡設定時は中間の応答/リクエストも表示。Collaborator やり取り時はやり取り詳細を表示。項目をダブルクリックで新ウィンドウに開く。

#### 23-3. 結果の分析（results/analyzing-results.html）
- **Sorting results** — 任意の列見出しをクリックして昇順/降順/未ソートを巡回。ステータスコードや応答長が他と異なる異常項目を素早く特定。
- **Copying results**（Pro）— 列見出しを control-click で列内容をコピー。
- **Filtering results** — display filter で結果を非表示に。フィルタバーをクリックして Intruder attack results filter ウィンドウを開く:
  - **Filter by search term** — 指定語を含む応答を表示/非表示。**Regex** / **Case sensitive** / **Negative search**。
  - **Filter by status code** — HTTP ステータスコードで表示/非表示。
  - **Filter by annotation** — コメント/ハイライトのある項目のみ表示。
  - フィルタは表示制御のみ（非表示項目は削除されずリセットで再表示）。
- **Adding annotations** — 結果にコメントとハイライトを追加。**Highlight**: 項目を選び右クリック → Highlight → 色選択。**Comment**: 項目を選び Comment 列をダブルクリック → 入力。

#### 23-4. ワークフローツール（results/workflow.html）
結果表の項目を右クリックしてコンテキストメニューでアクション（逐語訳）:
- **Scan**（Pro）— 選択項目を Burp scanner へ。
- **Send to...** — 他の Burp ツールへ（例: 後で調べる HTTP メッセージを Burp Organizer へ）。
- **Show response in browser** — 応答のユニーク URL を生成し Burp's browser で描画（元 Web サーバへは転送されない。相対リンクが正しく扱われる）。
- **Request in browser** — Burp's browser で再送: **In original session**（元リクエストの Cookie ヘッダ）/ **In current session**（ブラウザ提供の Cookie）。
- **Generate CSRF PoC** — 選択リクエストをブラウザ表示時に発行させる HTML を作成。
- **Add to site map** — 選択項目を Target site map に追加。
- **Request item again** — 選択項目を再リクエストキューへ（ネットワークエラーで失敗した、または攻撃中に base request/構成を変えた場合に再リクエスト）。
- **Define extract grep from response** — 応答から新しい extract grep 項目を作成（fuzzing の特定形式エラー、認証情報推測の異なるログインメッセージ等）。
- **Copy as curl command** — 現在のリクエストを生成する curl コマンドをクリップボードへ。
- **Add comment** / **Highlight** / **Copy links**（選択項目のリンクを解析してコピー）。
- **Save item** — 選択項目の詳細を XML 形式で保存（完全なリクエスト/応答、応答長・HTTP ステータス・MIME type 等のメタデータ）。

#### 23-5. 攻撃の編集（results/editing-attacks.html）
実行中の攻撃を結果ウィンドウから制御・修正できる。**Attack** メニュー: Pause / Resume / Restart。結果ウィンドウは構成タブのクローンを含み、攻撃進行中にほとんどの構成を確認・修正できる。ただし**攻撃構造の根幹（attack type / payload positions / payload type）は修正不可**（変えるには元の attack タブで編集し新攻撃を開始）。補足（Note）: 構成修正前に攻撃を一時停止推奨（実行中の変更はキー押下ごとに実行され予期しない影響。例: Numbers type で To フィールドの桁を削ると攻撃が突然完了し得る）。

#### 23-6. 攻撃の保存（results/saving-attacks.html）
既定で保存されない（大きな project file になり得るため）。Pro では結果ウィンドウの **Save** メニューで保存:
- **Results table** — 結果表をテキストファイルで保存（保存する行/列・区切り文字を構成可。単一列を後続攻撃の入力ファイルに）。
- **Server responses** — 全リクエストの完全応答を保存（連番の個別ファイルまたは連結した単一ファイル）。
- **Attack configuration** — 現在の攻撃構成をファイル保存（Intruder メニュー → **Load attack config** で将来使用）。
- **Project file** — 攻撃構成と結果の完全コピーを project file に保存（disk-based プロジェクトのみ、攻撃前/中/後いつでも）。
補足: Intruder 攻撃は state file に保存できなくなった（レガシー state file は **Open saved attack** で読込可）。

**攻撃を閉じる（Closing attacks）:** 進行中に攻撃ウィンドウを閉じると「バックグラウンドで続行」か「破棄」かを問われる。完了後に閉じると project file 保存（Pro の disk-based）かメモリ保持を選べる。既定の応答は Settings ダイアログの **Behavior when closing result windows** で指定。

---

### 24. Intruder 設定（ユーザ設定）（出典: settings/tools/intruder.html）

Settings ダイアログの Intruder ページ（全て user 設定＝マシン上の全 Burp に適用）:
- **Automatic payload placement** — 自動 payload marker の配置: **Replace base parameter value** / **Append to base parameter value**。
- **New tab configuration** — 新タブの攻撃構成: **Use default attack configuration** / **Copy configuration from first tab** / **Copy configuration from last tab**。
- **Behavior when closing result windows** — 進行中攻撃を閉じる時: Continue my attack in the background / Delete my attack / Ask me what to do each time。完了攻撃を閉じる時: Save my attack to the project file / Keep in memory / Delete my attack / Ask me what to do each time。
- **Payload list location** — **Use built-in lists** / **Load custom lists from directory**（Select directory でフォルダ選択）。Burp の全 preconfigured payload list をカスタムディレクトリにコピーするには custom directory を読込み **Copy** を選択。

---

### 25. Intruder のタブ管理（出典: configure-attack/managing-tabs.html）

リクエストを Intruder に送ると新 attack タブが作られリクエスト詳細が自動投入される。タブヘッダのコントロール（逐語訳）:
- **Create an attack tab** — add tab ボタンで新タブ。他所から Intruder に送っても新タブ。新タブの開始構成は Settings で設定。
- **Rename tabs** — タブヘッダをダブルクリックして名前入力。
- **Switch tab view** — 右クリック → Tab view settings: **Scrolling view** / **Wrapped view**。
- **Close tabs** — 単一タブを閉じる / **Close all tabs**（Tabs options メニュー）/ **Close other tabs** / **Close tabs to the left / right** / **Reopen closed tab**。
補足（Note）: すでに Intruder にあるリクエストから Intruder に送ると、同一リクエストの別インスタンスの新タブができる（テストの整理に有用）。

---

### 26. クライアントサイド脆弱性ハンティングでの Repeater / Intruder の使いどころ（統合考察）

（以下は本文の記述に基づく実務的整理。各手法は許可された検証・バグバウンティ前提の防御/診断目的の技術解説である。）

**Repeater（手動再送・検証）:**
- DOM ベース XSS や postMessage 脆弱性の source に至る HTTP レスポンス（HTML/JS）を Repeater で取得し、Inspector で URL/Base64 多重エンコードされた値を人間可読に展開して素早く解析する。
- WebSocket メッセージを Send to Repeater し、サーバ宛/クライアント宛を切り替えて改変再送（DOM ベース WebSocket 脆弱性、message ハンドラの検証）。**クライアント宛送信は Proxy 経由で接続が開いている間のみ可能**。
- **Group send in parallel（single packet attack）** で複数リクエストを実質同時到達させ、**レースコンディション**（多重利用・二重処理・TOCTOU）を検証。
- **Group send in sequence (single connection)** で **client-side desync**（ブラウザ由来リクエストスマグリング）ベクトルを検証。
- Inspector の改行/NULL 注入と HTTP/2 疑似ヘッダ編集で、message editor では作れない **HTTP/2 排他リクエスト（kettled request）** を構築（request smuggling の高度検証）。ただし Intruder は kettled 未対応なので正規化される点に注意。
- message editor の **Change request method**（GET/POST 切替）、**Convert selection**（URL/HTML/Base64 エンコード、Construct string での SQL/JS 文字列生成）で入力フィルタ回避や XSS ペイロード微調整。
- **Request in browser > In current browser session** でアクセス制御（IDOR/権限昇格）を手軽にテスト。

**Intruder（自動化攻撃）:**
- **Grep - payloads** でペイロードの反射を検出し、**リフレクション XSS** や他の応答注入脆弱性の候補を大量リクエストから一括抽出。**Match against pre-URL-encoded payloads** で URL エンコードして送ったペイロードの反射も捕捉。
- **Collaborator payloads** payload type で **ブラインド XSS**・SSRF・OOB インジェクションを検出（結果は Collaborator タブでなく攻撃結果ウィンドウ／Dashboard の Event log で確認）。
- **Sniper** で単一パラメータの fuzzing（XSS/SQLi/traversal のフィルタ挙動確認）、**Cluster bomb** でユーザ名×パスワードの総当たり、**Pitchfork** で関連する2値（ユーザ名と対応 ID）の同時投入。
- **Predefined payload lists**（Fuzzing - full/quick、path traversal、JSON_XML injection、out of band）を Add from list で投入し、`{base}`/`{domain}`/`{file}` プレースホルダを Match/replace 処理ルールで実値に。`{domain}` に Collaborator ドメイン（`COLLAB_ID.oastify.com`）を入れて OOB 検出。
- **Payload processing** の Encode/Decode/Hash/Match-replace を連結し、WAF/入力フィルタ回避のためのエンコードバリエーションを系統生成。**Illegal Unicode** payload type でパストラバーサルフィルタ回避を試す。
- **resource pool** の Maximum concurrent requests と Delay でレート制限を尊重しつつ（過度な負荷や DoS を避け）検証。**Automatic throttling** でサーバ応答コードに応じ自動減速。
- **enumerating subdomains**（ワイルドカード DNS 前提で target フィールドにサブドメイン placeholder を置き Directories リストで攻撃）で攻撃面を発見。

---

## 読者が自分で開くべき資料

この実行環境では担当2 URL（`portswigger.net/.../tools/repeater`、`.../tools/intruder`）のライブページを直接取得できなかった（WebFetch=EGRESS_BLOCKED、curl=CONNECT 403、web.archive.org=403、WebSearch=予算切れ）。本文は Burp Suite 同梱のオフライン公式ドキュメント（PortSwigger 配布 HTML、内部ビルド 32146 相当のミラー）から逐語取得したが、**UI 名称・既定値・新機能・新しい payload type はライブページのほうが新しい可能性がある**。読者は次を自分で開いて確認してほしい。

**Repeater 読みどころ:**
1. `tools/repeater/send-group.html` の **Group send options** — single packet attack と last-byte synchronization の違い、順序送信（single/separate connection）と並列送信の前提条件（レースコンディション/client-side desync 検証の核）。
2. `tools/repeater/http-messages.html` と `tools/inspector/*` — Override SNI、履歴ナビゲーション、Inspector の自動デコード・HTTP/2 疑似ヘッダ・改行/NULL 注入。
3. `settings/tools/repeater.html` の **Connections**（HTTP/1・HTTP/2 connection reuse、Allow HTTP/2 ALPN override）と **Message modification**（Normalize HTTP/1 line endings を切って request smuggling をテスト）。
4. `http2/index.html` の **Kettled requests** の節 — どの操作でリクエストが kettled になるか、Intruder が未対応な点。
5. Web Security Academy の **Race conditions** と **Browser-powered request smuggling**（Repeater から直接リンク）。

**Intruder 読みどころ:**
1. `tools/intruder/configure-attack/attack-types.html` — Sniper / Battering ram / Pitchfork / Cluster bomb のリクエスト数計算式と使い分け。
2. `tools/intruder/configure-attack/payload-types.html` — 全 payload type（特に Recursive grep、Illegal Unicode、Bit flipper、ECB block shuffler、Collaborator payloads の詳細設定）。
3. `tools/intruder/configure-attack/settings.html` の **Grep - match / extract / payloads** — 結果からの脆弱性検出の中核。
4. `tools/intruder/configure-attack/payload-lists.html` と `processing.html` — predefined list のプレースホルダ処理と payload processing ルールの連結。
5. `tools/intruder/configure-attack/resource-pool.html` — 同時リクエスト数・遅延・自動スロットリング（レート制限のあるアプリでの安全な検証）。
6. `tools/intruder/results/*` — 結果のソート/フィルタ/注釈と workflow アクション（Send to、Show response in browser、Request item again）。

**最新情報・注意点:**
- PortSwigger は Intruder の payload 機能やライブラリ（BApp Store の Turbo Intruder など）を継続更新している。姉妹ノート内の画像に `turbo_intruder` が登場する（BApp Store 拡張で Python スクリプトによる高速攻撃・single packet attack を扱う）が、本担当2ページには記載がないため教科書では別途「Turbo Intruder は拡張機能」と明記して扱うこと。
- Community 版は Intruder が**速度制限（throttled）**され、predefined payload lists と一部機能が Pro 限定である点をライブページで確認すること（本ミラー文面ではページ冒頭の Professional/Community バッジで各機能の版を判別）。

---

## 付録: 取得した関連ページ一覧（すべてミラー逐語取得済み）

Repeater 系: `tools/repeater/{index,groups,send-group,tab-settings,managing-tabs,http-messages,websocket-messages}.html`、`settings/tools/repeater.html`、`getting-started/reissuing-http-requests.html`
Inspector 系: `tools/inspector/{index,modify-requests,getting-started-inspector}.html`
HTTP/2・editor: `http2/index.html`、`tools/message-editor/index.html`、`settings/network/http.html`
Intruder 系: `tools/intruder/{index,getting-started}.html`、`tools/intruder/uses/{index,fuzzing,harvesting,enumerating}.html`、`tools/intruder/configure-attack/{index,positions,attack-types,payload-types,payload-lists,processing,settings,managing-tabs,resource-pool}.html`、`tools/intruder/results/{index,viewing-results,analyzing-results,workflow,editing-attacks,saving-attacks}.html`、`settings/tools/intruder.html`、`settings/response-extraction.html`
Intruder チュートリアル: `testing-workflow/authentication-mechanisms/brute-forcing-logins.html`、`testing-workflow/mapping/hidden-content/enumerating-subdomains.html`
