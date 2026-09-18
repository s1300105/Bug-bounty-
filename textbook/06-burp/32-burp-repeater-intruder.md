# Burp Repeater と Burp Intruder — リクエストを手で送り直し、攻撃を自動化する

> **この節で分かること**
> - Burp Repeater で興味深いリクエストを何度も送り直し、応答の変化から脆弱性の手がかりを読む方法を説明できる。
> - グループ送信（並列＝single packet attack、逐次＝単一/別接続）を使い分け、レースコンディションや client-side desync を検証できる。
> - Inspector で値を自動デコード・再エンコードし、HTTP/2 疑似ヘッダや改行・NULL を注入できる。
> - Burp Intruder の4つの攻撃タイプ（Sniper / Battering ram / Pitchfork / Cluster bomb）と主要な payload type を使い分けられる。
> - Grep - match / extract / payloads で結果から脆弱性の兆候を検出し、resource pool でレートを制御できる。
> - クライアントサイド脆弱性ハンティングで Repeater と Intruder をどこに使うか説明できる。

**元資料**: https://portswigger.net/burp/documentation/desktop/tools/repeater ・ https://portswigger.net/burp/documentation/desktop/tools/intruder （原典は取得できず、Burp Suite 同梱のオフライン公式ドキュメント〔PortSwigger 配布 HTML、内部ビルド 32146 相当のミラー〕から逐語取得した二次情報ベース）
**関連する節**: Burp Proxy と HTTP history、Burp Collaborator、Web Security Academy（レースコンディション、Browser-powered request smuggling）

---

## 0. この節の位置づけ

Burp Suite は「プロキシとして観測する」だけの道具ではない。観測して見つけた怪しいリクエストを、**手で少しずつ変えて送り直す（Repeater）**、あるいは**同じリクエストに大量のペイロードを差し込んで自動で送りまくる（Intruder）**——この2つが、実際に脆弱性を確定させる作業の中心になる。

Repeater は「1本のリクエストをじっくり調べる顕微鏡」、Intruder は「同じ操作を機械的に何千回も繰り返す自動機」だと考えるとよい。両方とも Burp のどこからでもリクエストを右クリックして送り込める。

〔注意〕本節の引用は PortSwigger が配布するオフライン公式ドキュメント（バンドル版・内部ビルド 32146 相当のミラー）の逐語である。文面は公開ドキュメントと同一だが、ライブページは随時更新される。**UI 名称・既定値・新しい payload type は公式サイトで最新を確認すること**を勧める。

---

## 1. Burp Repeater とは何か（なぜ手で送り直すのか）

### 1-1. 定義と用途

Repeater とは、興味深い HTTP / WebSocket メッセージを修正して何度でも送り直すためのツールのこと。原文の定義は次のとおり。

> 「Burp Repeater is a tool that enables you to modify and send an interesting HTTP or WebSocket message over and over.」
> （Burp Repeater は、興味深い HTTP または WebSocket メッセージを修正して何度でも送信できるツールである）

なぜ「送り直す」ことが重要なのか。脆弱性のテストとは、要するに「入力を少し変えると応答がどう変わるか」を観察する作業である。プロキシでリクエストを1回捕まえただけでは、その応答が「たまたま」なのか「入力に反応している」のかは分からない。同じリクエストを少しずつ変えて何度も送れば、アプリの内部挙動が透けて見えてくる。

公式が挙げる用途（逐語リスト）は次の3つ。

- 「Send a request with varying parameter values to test for input-based vulnerabilities.」（パラメータ値を変えたリクエストを送り、入力ベースの脆弱性をテストする）
- 「Send a series of HTTP requests in a specific sequence to test for vulnerabilities in multi-step processes, or vulnerabilities that rely on manipulating the connection state.」（特定の順序で一連のリクエストを送り、多段プロセスの脆弱性や、接続状態の操作に依存する脆弱性をテストする）
- 「Manually verify issues reported by Burp Scanner.」（Burp Scanner が報告した問題を手動で検証する）

### 1-2. タブと履歴

Repeater は複数メッセージをそれぞれ独立したタブで同時に扱える。加えた修正はタブの履歴に保存されるため、後から「あのとき送ったリクエスト」に戻れる。多数の開いたタブはグループ化機能で管理する。エディションは **Professional / Community の両版**で使える。

---

## 2. HTTP メッセージを Repeater で扱う

### 2-1. 基本の手順

Repeater で HTTP リクエストを送る手順は次のとおり。

1. Burp のどこでも HTTP リクエストを右クリックし **Send to Repeater** をクリックする。リクエストを含む新しいタブが Repeater に追加される。
2. Repeater に移動し、新しいタブでリクエストの詳細を見る。
3. メッセージを修正する。
4. **Send** をクリックしてリクエストを標的サーバへ送り、応答の詳細を見る。
5. このプロセスを好きなだけ繰り返し、リクエストを様々に変えると応答がどう変わるかを見る。

### 2-2. Repeater タブに含まれる要素

各 Repeater タブは次の要素を持つ。

| 要素 | 説明 |
| --- | --- |
| HTTP message editor（リクエスト側） | リクエストを解析・編集する |
| target server | 送り先。Repeater に送った時点で自動設定される |
| HTTP message editor（応答側） | 受信した応答を表示する |
| 応答サイズ・応答時間 | バイト数とミリ秒 |
| リクエスト履歴のナビゲーション | `<` `>` ボタンとドロップダウンで前後移動 |

target の設定アイコンでは、Host ヘッダを変えた場合に **Host** と **Port** フィールドで実際の送り先を確認できる。**Override SNI** を選ぶと SNI 値を手動設定でき、Burp Scanner が Collaborator ペイロードで検出した external service interaction 問題の再現に使える。

〔用語〕SNI（Server Name Indication）とは、TLS 接続の最初に「どのホスト名に繋ぎたいか」を平文で伝える拡張のこと。1つの IP で複数サイトをホストするサーバがどの証明書を返すかを決めるのに使う。

### 2-3. 履歴ナビゲーション

- `<` と `>` ボタンで履歴を前後に移動する。
- ドロップダウンで履歴項目を番号付きリスト表示し、素早く移動する。
- 履歴の任意の時点で、現在表示中のリクエストを編集し再送できる。

### 2-4. タブにノートを付ける

リクエスト/応答に興味深いものがあればタブにノートを付けられる。手順は、タブを選択 → **Notes** をクリック → Notes パネルに入力。他の Burp ツールで付けたノートは Repeater にコピーされ、Repeater から他ツールへ送るとコメントもコピーされる。

---

## 3. グループ送信 — レースコンディションと desync の核心

ここが Repeater の目玉機能である。**タブをグループ化して複数リクエストを一括送信できる**。この仕組みがレースコンディションや client-side desync の検証を可能にする。

> 「Burp Repeater's Group send options feature enables you to send grouped HTTP requests with a single click. You can send requests either in parallel (all at once), or in sequence (one after the other).」
> （グループ化した HTTP リクエストをワンクリックで送信できる。並列＝一斉に、または逐次＝1つずつ、のどちらでも送れる）

### 3-1. グループ送信の手順

1. Repeater のタブグループを作成し、関連タブを追加する。
   - 代替として、グループを作りその中でタブを複製できる。**レースコンディション脆弱性のテスト**時、同一リクエストの作成が効率化されるので有用。
2. グループ内のタブの一つを選択する。
3. **Send** ボタン横のドロップダウン矢印をクリックし、次のいずれかを選ぶ。
   - **Send group in sequence (single connection)**
   - **Send group in sequence (separate connections)**
   - **Send group in parallel**
4. **Send group** をクリックする。全リクエストが送信される。

送信を中止するには、リクエスト送信中にグループのタブの一つで **Cancel** をクリックする。

### 3-2. 逐次送信 — 単一接続（single connection）

> 「If you select Send group in sequence (single connection), Repeater establishes a connection to the target, sends the requests from all of the tabs in the group, and then closes the connection.」

つまり、標的への接続を**1本だけ**確立し、グループ内の全タブのリクエストをその1本で送り、最後に接続を閉じる。用途は次のとおり。

- **潜在的な client-side desync ベクトル**のテストが可能になる。
- TCP 接続確立時に生じる「jitter（ジッタ、タイミングのばらつき）」を減らせる。応答同士のわずかなタイミング差を比較する**タイミングベース攻撃**に有用。

〔用語〕client-side desync とは、ブラウザ由来のリクエストで発生させるリクエストスマグリング（HTTP request smuggling）の一種のこと。フロントとバックエンドがリクエストの境界を解釈しずれる（desync=同期がずれる）ことを、被害者のブラウザから送らせて悪用する。

### 3-3. 逐次送信 — 別接続（separate connections）

> 「If you select Send group in sequence (separate connections), Repeater establishes a connection to the target, sends the request from the first tab, and then closes the connection. It repeats this process for all of the other tabs...」

最初のタブのリクエストを送って接続を閉じ、これをグループ内の順番どおり全タブで繰り返す。**多段プロセスを要する脆弱性**（ステップ1→ステップ2の順に処理される機能）のテストが容易になる。

### 3-4. 並列送信 — single packet attack

> 「If you select Send group in parallel, Repeater sends the requests from all of the group's tabs at once. This is useful as a way to identify and exploit race conditions.」

グループの全タブのリクエストを一斉に送る。**レースコンディションの発見・悪用**に有用。Repeater は並列リクエストがすべて同時に完全到着するよう同期する。同期手法は HTTP バージョンで異なる。

- **HTTP/1 では last-byte synchronization（最終バイト同期）**：複数リクエストを並行接続で送るが、各リクエストの**最後の1バイトを保留**する。短い遅延の後、各接続の最後のバイトを同時に送信する。
- **HTTP/2+ では single packet attack**：複数リクエストを**単一 TCP パケット**で送る。

並列リクエストの応答を含むタブを選ぶと、右下のインジケータがグループ内でその応答が受信された順序を表示する（例: 1/3, 2/3）。

補足（原文 Note）: 「You cannot send macro requests in parallel.」（マクロリクエストは並列送信できない。マクロがリクエスト同期を妨げるのを防ぐため）

〔補足〕single packet attack は PortSwigger の研究者 James Kettle が 2023 年に公表した手法で、ネットワークジッタを排除して 20〜30 のリクエストを実質同時にサーバへ到達させ、レースコンディションの再現性を劇的に高めた。従来の last-byte 同期は接続本数ぶんのジッタが残るが、single packet attack は 1 パケットに複数リクエストを載せることでそれを排除する。

### 3-5. 前提条件のまとめ

| 送信方式 | 満たすべき前提条件 |
| --- | --- |
| 逐次（共通） | WebSocket メッセージタブが無い／空タブが無い |
| 逐次・単一接続（追加） | 全タブが同一 target／全タブが同一 HTTP バージョン（全部 HTTP/1 か全部 HTTP/2） |
| 並列 | 全リクエストが同一 host・port・トランスポート層プロトコル／プロジェクトで HTTP/1 keep-alive が無効 |

client-side desync のテスト方法と練習用 lab は Web Security Academy の **Browser-powered request smuggling** トピック、レースコンディションのテストは **Race conditions** トピックを参照する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Web Security Academy — Race conditions / Browser-powered request smuggling（Repeater ドキュメントから直接リンク）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で portswigger.net へ直接アクセスできず、本文はバンドル版オフラインドキュメントのミラーにもとづく要約である）。
> **読みどころ**:
> 1. single packet attack と last-byte synchronization の違い、並列送信でどんなレースコンディション（多重利用・二重処理・TOCTOU）を再現できるか。
> 2. Send group in sequence (single connection) を使った client-side desync の練習 lab を実際に解き、Repeater のグループ送信を手で体験する。
> **代替手段**: Web Security Academy は無料で lab を提供している。バンドル版 Burp のオフラインドキュメント（`tools/repeater/send-group.html`）も同等の説明を含む。

---

## 4. WebSocket メッセージを Repeater で扱う

Repeater は WebSocket メッセージも個別に改変・再送でき、応答を分析できる。

〔用語〕WebSocket とは、いったん接続を張ると双方向にメッセージをやり取りし続けられる通信方式のこと。チャットやリアルタイム更新に使われ、通常の HTTP と違い「サーバからクライアントへ」も送られる。

**手順:**

1. **Proxy > WebSockets history** に移動する。
2. WebSocket メッセージを右クリックし **Send to Repeater**。新しいタブが追加される。
3. Repeater でタブの WebSocket メッセージ詳細を見る。
4. メッセージを修正する。
5. メッセージを**サーバ宛かクライアント宛か**選ぶ。
6. **Send** をクリックし、標的サーバまたはクライアントへ送って応答を見る。
7. 再送するには右クリックして **Edit and resend**。修正の仕方を変えて何度でも送れる。

補足（原文 Note）: 「The option to send a message to the client is only available in connections that are still open via Burp Proxy.」（クライアント宛送信は、Burp Proxy 経由でまだ開いている接続でのみ可能）——これは DOM ベースの WebSocket 脆弱性やクライアント側メッセージハンドラの検証で重要になる。

WebSocket タブには message editor、WebSocket connection（切断/再接続トグル、接続の複製・編集）、送受信した全メッセージを示す **history table**（**Select next message received** で次に受信するメッセージを自動選択）、message viewer が含まれる。

---

## 5. タブとタブグループの管理

### 5-1. タブ管理

Repeater は新しいメッセージを新タブで開く。主な操作は次のとおり。

- **Create a request from scratch** — 新タブを開き HTTP か WebSocket を選ぶ。
- **Rename tabs** — タブヘッダをダブルクリックして名前入力。
- **Duplicate tabs** — グループ化されたタブを右クリックして **Duplicate tab**（グループ内タブでのみ可能）。各タブはリソースを消費するので大量のタブはパフォーマンスに影響する。
- **Switch tab view** — 右クリック → **Tab view settings**。**Scrolling view**（単一のスクロール行）か **Wrapped view**（複数行に折り返し全表示）を選ぶ。
- **Add a tab to a group** / **Close tabs**（Close other / to the left / to the right）/ **Reopen closed tab**。

### 5-2. タブグループの作成

> 「You can organize tabs into groups to manage large numbers of open tabs. This also enables you to send requests from multiple tabs in sequence.」

手順は、add tab ボタン → **Create tab group** → **Group name** 入力 → チェックボックスで追加タブを選択（shift クリックで複数選択）→ **group color** 選択 → **Create**。作成したグループは Burp Suite を再起動しても開いたまま残る。グループから最後のタブを削除するとグループは自動的に閉じる。

---

## 6. タブ固有設定とグローバル設定

### 6-1. タブ固有設定

個別タブについてグローバル設定を上書きできる。手順は、対象タブを選択 → **Send** 横の settings アイコン → 必要な設定を選ぶ。重要な挙動は次のとおり。

> 「If you select a setting on the tab-specific menu then Repeater ignores all global settings for that tab.」
> （タブ固有メニューで設定を1つ選ぶと、そのタブについてすべてのグローバル設定が無視される）

たとえばグローバルで Process cookies in redirections を選び、タブ固有メニューで Enable HTTP/1 connection reuse を選ぶと、グローバルの Process cookies 設定は無視される。**送信前にタブ固有メニューで全設定を正しく構成すること**。設定を変更するとタブの settings アイコンが青くなる。戻すには settings アイコン → **Restore global default**。

### 6-2. グローバル設定（Settings ダイアログの Repeater ページ）

#### Connections（TCP 接続と HTTP/2）

| 設定 | 意味 |
| --- | --- |
| HTTP/1 connection reuse | 有効で同一接続を再利用。速度が上がりタイミングに有利。無操作5秒後に接続を閉じる |
| HTTP/2 connection reuse | 既定で有効。サーバが最初のリクエストを別扱いする場合は無効化を検討 |
| Allow HTTP/2 ALPN override | サーバが HTTP/2 を広告しなくても ALPN で HTTP/2 を送れる。**隠れた HTTP/2 攻撃面**の探索に |

#### Message modification（送受信時の挙動）

| 設定 | 意味 |
| --- | --- |
| Update Content-Length | 既定でボディに応じ Content-Length を自動更新 |
| Unpack compressed responses | 既定で gzip / deflate / Brotli を自動展開 |
| Normalize HTTP/1 line endings | 既定で行末の `\n` に `\r` を追加し不正リクエストを防ぐ。**request smuggling テストで意図的に改行を省く場合は無効化できる** |
| Strip Connection header over HTTP/2 | 既定で HTTP/2 送信前に Connection ヘッダを除去。無効化するとサーバの反応を見られる |

#### Redirects（リダイレクト処理）

**Follow redirects** は **Never / On-site only / In-scope only / Always** から選ぶ。自動追跡しない設定では **Follow redirection** ボタンで手動で1つずつ辿れる。**Process cookies in redirects** はリダイレクト先追跡時に Cookie を再送する。**Use selected protocol for cross-domain redirects** は HTTP/2 固有脆弱性のクロスドメインリクエストで有効化を検討する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Burp Repeater settings — `settings/tools/repeater.html`（portswigger.net/burp/documentation/desktop/settings/tools/repeater）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限。本文はバンドル版オフラインドキュメントのミラーにもとづく要約である）。
> **読みどころ**:
> 1. **Connections**（HTTP/1・HTTP/2 connection reuse、Allow HTTP/2 ALPN override）で接続再利用がタイミング攻撃に与える影響。
> 2. **Message modification** の Normalize HTTP/1 line endings を切って request smuggling をテストする手順。
> **代替手段**: バンドル版 Burp 同梱のオフラインドキュメントに同一文面が含まれる。

---

## 7. Repeater チュートリアル — 情報開示を見つける

公式チュートリアル（reissuing-http-requests）は Repeater の典型ワークフローを示す。

> 「In this tutorial, you'll use Burp Repeater to send an interesting request over and over again. This lets you study the target website's response to different input without having to intercept the request each time.」

流れは次のとおり。

1. Proxy の HTTP history で `GET /product?productId=[...]` を特定し、右クリック → **Send to Repeater**。
2. **Send** で応答を見る。何度でも再送でき応答は毎回更新される。
3. `productId` の数値を変えて再送する。存在する ID なら別の商品ページ、なければ **Not Found**。
4. 整数を期待するパラメータに**別のデータ型（文字列）を送る**。
5. 非整数 `productId` で例外が発生し、サーバがスタックトレースを含む冗長なエラー応答を返す。応答から Web サイトが **Apache Struts** フレームワークを使っていること、そのバージョンまで判明する（情報開示脆弱性）。lab の解答は Struts バージョン `2 2.3.31`。

これが「同じリクエストを異なる入力で再送し、入力ベースの脆弱性を発見・確認する」典型パターンである。

---

## 8. Inspector — 値を読み解き、注入する

Inspector は Repeater と一体で使う道具である。

> 「The Inspector enables you to quickly view and edit interesting features of HTTP and WebSocket messages without having to switch between different tabs.」

message editor の隣、side panel からアクセスする。用途は、パラメータ・Cookie・選択部分文字列の**完全にデコードされた値**を見る／ボタン一つで項目を追加・削除・並べ替え／**デコード形式のままデータを編集**（更新時に自動再エンコード）／プロトコルをトグル／**HTTP ヘッダと疑似ヘッダ**を HTTP/1 構文に縛られず扱う、である。一部機能は編集可能リクエスト（Repeater や Proxy でインターセプトしたもの）でのみ使える。

### 8-1. 自動デコード

> 「The values shown in the Inspector are automatically decoded from HTML, URL, and Base64.」
> （Inspector に表示される値は HTML・URL・Base64 から自動デコードされる）

メインビューでは最終デコード結果のみ見える。項目右の矢印をクリックすると各デコードステップが見られる。**Decoded from** ドロップダウンで順序を変更、プラス/マイナスアイコンで手動追加/削除できる。**エンコードされたデータをコピーすると、デコード版ではなく元のエンコード値**がクリップボードに入る。

### 8-2. HTTP/2 疑似ヘッダ

Inspector は HTTP/2 の**疑似ヘッダ（pseudo-header）**を通常ヘッダと並べて表示する。識別のため各疑似ヘッダは**コロン（`:`）で始まる**。これは HTTP/1 構文から完全に切り離した扱い方を提供し、サーバへ実際に送られるリクエストにより近い。message editor 経由では不可能な注入で、多くの HTTP/2 固有脆弱性をテストできる。

〔用語〕疑似ヘッダとは、HTTP/2 でメソッドやパスなどを表すために `:method` `:path` `:scheme` `:authority` のようにコロンで始めて表現する特別なヘッダのこと。HTTP/1 のリクエスト行に相当する情報を、通常のヘッダと同じ形式で運ぶ。

### 8-3. 改行・NULL の注入

- **改行の注入**: 項目右の矢印 → Name/Value フィールドの注入位置を選択 → **Shift + Return**。CR/LF が `\r\n` アイコンで注入される。これは **James Kettle が発見した多数の HTTP/2 排他脆弱性の悪用に不可欠**（whitepaper: HTTP/2: The Sequel Is Always Worse）。
- **NULL 等の非表示文字**: プレースホルダ文字を追加 → 選択 → Selection ウィジェットでコードポイント変更（例: コードポイントを `00` にして NULL バイトに）。プレースホルダ無しなら message editor の Hex タブへ切り替える。

### 8-4. Inspector チュートリアル — session cookie 改ざん

deserialization lab で `GET /my-account` の Request Cookies を Inspector で展開すると、session cookie は URL デコード後に Base64 デコードの手順が自動適用される。Send to Repeater し、**Decoded from Base64** フィールドの `wiener` を `administrator` に変更して **Apply changes** すると、Inspector が正しい符号化シーケンスを自動再適用してリクエストに挿入する。

〔補足〕クライアントサイド視点では、Inspector の自動デコードは、DOM ベース脆弱性で source（`location.hash` / postMessage データ）に至る前に URL/Base64 で多重エンコードされた値を素早く読み解くのに役立つ。Cookie やパラメータに埋め込まれた JSON/Base64 ペイロードを人間可読に展開し、そのまま編集して再送できる。

---

## 9. HTTP/2 の扱いと kettled requests

Burp は HTTP/2 テストを2つの働き方で支える。**message editor で HTTP/1 スタイル表現を扱う**（Burp が正規化して等価な HTTP/2 を送る。一般テスト向き）と、**Inspector で HTTP/2 ビューを扱う**（サーバへ送られるヘッダ・疑似ヘッダをより正確に表現。HTTP/2 排他ベクトル向き）である。

プロトコルは message editor のリクエスト行、**Burp Repeater では画面右上の target host の横**、Inspector の Request Attributes で確認できる。既定では Burp は ALPN で HTTP/2 を広告する全サーバに HTTP/2 を話す。

### 9-1. kettled requests

> 「The Inspector enables you to create HTTP/2 requests that are impossible to accurately represent using HTTP/1 syntax without losing information.」

たとえば HTTP/2 ではヘッダ値の中に改行を入れられるが、HTTP/1 では改行がヘッダの終わりを示すため表現できない。リクエストが kettled になると message editor はヘッダの HTTP/1 表示を止め、kettled 理由の通知を表示する。

**kettled になる原因（Inspector での変更）:**

- ヘッダ名に大文字またはコロンを追加。
- ヘッダ名または値に改行文字を追加。
- `:scheme` 疑似ヘッダの値を変更。
- `:path` または `:method` 疑似ヘッダにスペースを追加。
- 疑似ヘッダを重複追加。
- Cookie 値にセミコロン＋スペースを追加。

**unkettle する方法**は、Ctrl/Cmd + Z で元に戻す／原因の変更を手動で逆戻し／HTTP/1 へダウングレード（変更が失われる警告あり）。

補足（原文 Note）: Burp Proxy, Repeater, Logger, Scanner は kettled リクエストをサポートするが、**Intruder などサポートしないツールへ送ると正規化される**。この非対称性はクライアントサイドの高度な request smuggling 検証で覚えておくべき制約である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: HTTP/2 — Kettled requests の節（`http2/index.html`）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限。本文はバンドル版オフラインドキュメントのミラーにもとづく要約である）。
> **読みどころ**:
> 1. どの操作でリクエストが kettled になるか、Intruder が未対応な点。
> 2. Inspector で HTTP/2 排他リクエストを組み立て、James Kettle の whitepaper「HTTP/2: The Sequel Is Always Worse」と突き合わせる。
> **代替手段**: バンドル版 Burp 同梱のオフラインドキュメント、および PortSwigger Research の HTTP/2 whitepaper（無料公開）。

---

## 10. Message editor — Repeater / Intruder 共通の基盤

message editor は Burp 全体で HTTP/WebSocket メッセージを見る場所で、Repeater/Intruder では編集・再送もできる。画面レイアウトは右上3アイコンで **Horizontal / Vertical / Combined** を切り替える。

**主なタブ:**

| タブ | 内容 |
| --- | --- |
| Raw | 生形式で全メッセージ。`\n` ボタンで非表示文字表示切替 |
| Pretty | Raw の機能＋整形表示（読みやすいインデント・改行） |
| Hex | 16進エディタ。16バイト/行、byte 単位で編集・非表示文字挿入 |
| Render | HTML/画像を含む応答をブラウザ表示のように描画 |
| GraphQL | GraphQL クエリを検出すると出現。Query と Variables を分離表示 |

**Hex タブのコンテキストメニュー**（右クリック）では、バイト単位の細かい編集ができる。

- **Insert byte** — 1バイト挿入する。
- **Insert bytes** — 複数バイトをまとめて挿入する。
- **Insert string** — 文字列を挿入する。
- **Delete selected byte(s)** — 選択したバイトを削除する。

**追加タブ（Additional tabs）**: message editor には Inspector と同じウィジェットをタブとして追加できる。**Headers / Query params / Body params / Cookies / Attributes** の5種で、ヘッダやパラメータを name-value の一覧として編集できる（Inspector の側パネルと同じ機能をタブ側に出したもの）。

**Actions / コンテキストメニューの主な操作:**

- **Scan / send to ...** — メッセージ全体または選択部分を他ツールへ送る。
- **Show response in browser** — 応答用のユニーク URL を生成し Burp's browser で描画（元サーバへは転送されず、選んだ応答をそのまま返す。相対リンクが正しく扱われる）。
- **Request in browser** — 選択リクエストを Burp's browser で再発行。**In original session**（元リクエストの Cookie で発行）/ **In current browser session**（ブラウザ提供の Cookie で発行）。後者は**アクセス制御テスト**に使える（管理者コンテキストで作ったリクエストを一般ユーザで再発行し、IDOR や権限昇格を確認する）。
- **Change request method** — GET/POST を自動切替（入力フィルタ回避や XSS 攻撃の微調整に）。
- **Change body encoding** — URL-encoded と multipart を切替。
- **Convert selection**（Raw のみ）— 選択テキストをエンコード/デコード。URL（メタ文字のみ／全文字／全文字 2-byte Unicode `%u0041`＝A）、HTML（数値エンティティ `&#65;`＝A、hex エンティティ `&#x41;`＝A）、Base64、**Construct string**（選択文字列を動的構築するコードを JavaScript・SQL 各方言で生成。入力フィルタ回避に）。
- **Copy as curl command** / **Copy URL** / **Copy to file** / **Paste from file** / **Save item**（XML 保存）。**Copy to file** は選択部分をファイルへ書き出し、**Paste from file** はファイルの内容をカーソル位置へ貼り付ける。
- **URL-encode as you type**（Raw ビューのみ）— これを有効にすると、`&` や `=` のような文字を打ち込んだそばから自動で URL エンコードしてくれる。パラメータ値の中に区切り文字を含めたいときに、手で `%26` などと書かずに済む。

---

## 11. Burp Intruder とは何か（なぜ自動化するのか）

### 11-1. 定義と用途

> 「Burp Intruder is a tool for automating customized attacks against web applications. It enables you to configure attacks that send the same HTTP request over and over again, inserting different payloads into predefined positions each time.」
> （Burp Intruder は Web アプリへのカスタマイズ攻撃を自動化するツールである。同じ HTTP リクエストを、あらかじめ定義した位置に毎回異なるペイロードを差し込みながら繰り返し送る）

Repeater が「1本を手で送り直す」なら、Intruder は「1本を土台に、位置（payload position）へ何千通りものペイロードを機械的に差し込む」道具である。主な用途は次の4つ。

- 「Fuzz for input-based vulnerabilities.」（入力ベースの脆弱性を fuzzing）
- 「Perform brute-force attacks.」（総当たり攻撃）
- 「Enumerate valid identifiers and other inputs.」（有効な識別子等の列挙）
- 「Harvest useful data.」（有用なデータの収集）

〔用語〕fuzzing（ファジング）とは、大量の変わった入力を送り込み、エラーや異常な応答から脆弱性の入口を探す手法のこと。たとえば `'` や `<script>` や `../` を次々に送り、どれでアプリが壊れるかを見る。

### 11-2. Intruder チュートリアル — ユーザ名列挙

username enumeration lab を使う流れは次のとおり。

1. Burp's browser で lab にアクセスし、無効なユーザ名/パスワードでログイン試行する。
2. Proxy > HTTP history で `POST /login` を探す。
3. `username` パラメータ値をハイライトして右クリック → **Send to Intruder**。
4. Intruder タブで、この `POST /login` を base request とする。`username` の値が **§ 文字**で payload position としてマークされている。
5. Attack type を **Sniper** にする。
6. **Payloads** タブへ。Payload type は **Simple list**。候補ユーザ名リストを **Paste** で追加（Payload count: 101 / Request count: 101）。
7. 右上 **Start attack**。
8. 攻撃完了後、**Length** 列の見出しをクリックしてソート。1つの応答だけ長さが異なる。
9. その応答は多数の `Invalid username` エラーと違い `Incorrect password` エラー → **このユーザ名が有効**である可能性が強い。

---

## 12. Intruder の典型的用途

公式は次の用途を挙げる。

| 用途 | 内容 |
| --- | --- |
| Enumerating identifiers | 有効な識別子（ユーザ名/パスワード等）を抽出 |
| Harvesting useful data | 識別子に関する興味深い情報を抽出 |
| Fuzzing for vulnerabilities | 入力ベースの脆弱性（SQLi/XSS/traversal）を特定 |
| Enumerating subdomains | 追加の攻撃面を発見 |
| Brute-forcing logins | ユーザ名/パスワードの組合せを推測 |

**Fuzzing** の手順は、全リクエストパラメータの値に payload position を設定 → simple list で攻撃文字列リスト（Pro なら Predefined payload lists）→ **Grep - Match** で一般的なエラー文字列を含む応答をフラグ → match grep の式でソート、である。

**Harvesting** は、識別子をパラメータに含み興味深いデータを応答に持つリクエストで、単一 position に適切な payload type を使い、**Grep - extract** で各応答から関連データを取る。ユースケースは、忘れたパスワード機能から各ユーザの**パスワードヒントを抽出**、numbers type でページ ID を巡回し **title タグを抽出**、既知ユーザ名で **role を抽出**して管理アカウントを特定、など。

**Enumerating identifiers** では、有効な識別子が異なる HTTP ステータスコードや特定の式（"password incorrect" / "login successful"）を返すことを利用する。**session tokens** を **bit flipper** で系統的に改変して CBC 暗号化トークンを探る、といった応用もある。

---

## 13. Payload positions（§ マーカー）

Intruder に送ると、次の場所に payload position が自動投入される。

- URL query string parameters
- Body parameters
- Cookies
- Multipart parameter attributes（ファイルアップロードの filename 等）
- XML data and element attributes
- JSON parameters

各 payload position は **§ マーカーのペア**で囲まれる。Positions タブのボタンは次のとおり。

- **Add §** — 単一マーカーを挿入。テキスト選択してから押すと両側にマーカー挿入。
- **Clear §** — 全マーカーを削除（選択時は範囲内のみ）。
- **Auto §** — 自動 payload positions を適用。
- **Refresh** — syntax colorizing を既定に戻す。
- **Clear** — テンプレートをクリア。

攻撃中、マーカーと囲まれたテキストの両方がペイロードで置換される。ペイロードが割り当てられない position では、囲まれたテキストは変わらずマーカーだけ除去される。

**Target field** にも position を置ける。target フィールド（リクエストの宛先）は次の3要素で構成される。

- **Protocol** — HTTP か HTTPS。
- **Host** — IP アドレスまたはホスト名。
- **Port** — ポート番号。

既定では **Update Host header to match target** が選択されており、target への変更が base request の Host 詳細に自動で反映される。これを解除すると target だけを変更でき、固定した target へ任意の Host ヘッダを送れる（**HTTP host header 攻撃**の作成に使う）。補足（Note）: payload positions は Burp Scanner の insertion point としても使える（Intruder メニュー → **Scan defined insertion points**）。

---

## 14. Attack types（4種）— どこが最重要か

attack type は「ペイロードが payload positions にどう割り当てられるか」を決める。設定は Positions の **Choose an attack type** ドロップダウン。ここは Intruder 理解の核なので、リクエスト数の計算式まで押さえる。

### 14-1. Sniper（スナイパー）

> 「This attack places each payload into each payload position in turn. It uses a single payload set.」

各ペイロードを各 position に**順番に1つずつ**置く。**単一ペイロードセット**。総リクエスト数 = **position 数 × ペイロード数**。多数のパラメータを一般脆弱性で個別に fuzzing するのに有用。

### 14-2. Battering ram（破城槌）

> 「This attack places the same payload into all of the defined payload positions simultaneously. It uses a single payload set.」

**同じペイロード**を**全 position に同時**に置く。**単一ペイロードセット**。総リクエスト数 = **ペイロード数**。同じ入力を複数箇所に入れる必要がある攻撃（Cookie とボディの両方にユーザ名）に有用。

### 14-3. Pitchfork（ピッチフォーク）

> 「This attack iterates through a different payload set for each defined position. Payloads are placed into each position simultaneously.」

**position ごとに別のペイロードセット**を巡回し、各 position に**同時**に置く。

```
Request 1: Position 1 = Set 1 の1番目, Position 2 = Set 2 の1番目
Request 2: Position 1 = Set 1 の2番目, Position 2 = Set 2 の2番目
Request 3: Position 1 = Set 1 の3番目, Position 2 = Set 2 の3番目
```

総リクエスト数 = **最小のペイロードセットのペイロード数**。異なるが関連する入力を複数箇所に入れる攻撃（あるパラメータにユーザ名、別パラメータに対応する既知 ID）に有用。

### 14-4. Cluster bomb（クラスター爆弾）

> 「This attack iterates through a different payload set for each defined position. Payloads are placed from each set in turn, so that all payload combinations are tested.」

**position ごとに別のセット**を巡回し、**全組合せ**をテストする。

```
Request 1: Position 1 = Set 1 の1番目, Position 2 = Set 2 の1番目
Request 2: Position 1 = Set 1 の1番目, Position 2 = Set 2 の2番目
Request 3: Position 1 = Set 1 の1番目, Position 2 = Set 2 の3番目
```

総リクエスト数 = **全ペイロードセットのペイロード数の積**（極めて大きくなり得る）。無関係または未知の入力を複数箇所に入れる攻撃（ユーザ名とパスワードの両方を推測）に有用。

### 14-5. まとめ表

| Attack type | セット数 | 配置 | リクエスト数 | 代表用途 |
| --- | --- | --- | --- | --- |
| Sniper | 1 | 各 position に順番 | position 数 × ペイロード数 | 単一パラメータの fuzzing |
| Battering ram | 1 | 全 position に同時同値 | ペイロード数 | 同じ値を複数箇所へ |
| Pitchfork | 複数 | position ごと同時進行 | 最小セットの数 | 関連する2値の同時投入 |
| Cluster bomb | 複数 | 全組合せ | 各セットの積 | ユーザ名×パスワード総当たり |

> ### 📌 ここは自分で開いて読んでください
> **資料**: Intruder attack types — `tools/intruder/configure-attack/attack-types.html`
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限。本文はバンドル版オフラインドキュメントのミラーにもとづく要約である）。
> **読みどころ**:
> 1. 4タイプのリクエスト数計算式を、自分の base request で数えて確かめる。
> 2. Cluster bomb のチュートリアル「Brute-forcing a login mechanism using Burp Intruder」を実際に解く。
> **代替手段**: バンドル版 Burp 同梱のオフラインドキュメントに同一文面が含まれる。

---

## 15. Payload types — 何を差し込むか

Payloads タブの **Payload Sets** で payload type を選ぶ。共通操作は **Paste / Load / Remove / Clear / Deduplicate / Add / Add from list**。主要な type を用途とともに挙げる。

| Payload type | 何をするか |
| --- | --- |
| Simple list | 文字列の単純なリストをそのまま使う |
| Runtime file | 実行時にファイルの各行から1ペイロードを読む（巨大リスト向き、改行を含められない） |
| Custom iterator | テンプレートに従い最大8 position で順列生成。Preset: Directories / file.extensions / Two-digit hex / Passwords + digit |
| Character substitution | 文字置換で辞書語の変種を生成 |
| Case modification | 大文字小文字を変えて生成（重複は破棄） |
| Recursive grep | 前の応答から抽出したテキストを次のペイロードに使う |
| Illegal Unicode | 文字を不正な Unicode エンコードで置換（フィルタ回避） |
| Character blocks | 指定文字ブロックで生成（バッファオーバーフロー等） |
| Numbers | 範囲・形式指定で数値生成 |
| Dates | 範囲・形式指定で日付生成 |
| Brute forcer | 文字セットの全順列を生成 |
| Null payloads | 空文字列を繰り返す（position 不要） |
| Character frobber | 各文字位置の ASCII コードを1増やす |
| Bit flipper | 各ビットを反転 |
| Username generator | 名前/メールから候補ユーザ名を導出 |
| ECB block shuffler | ECB 暗号文ブロックをシャッフル |
| Extension-generated | Burp 拡張が生成 |
| Copy other payload | 別 position のペイロードをコピー |
| Collaborator payloads | Burp Collaborator ペイロードを生成・注入 |

以下、クライアントサイドのバグハンティングで特に効くものを掘り下げる。

### 15-1. Character substitution

置換ルール（例: `e > 3`, `t > 7`）を辞書語に適用してパスワード変種を生成する。項目 "peter" は次を生成する。

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

### 15-2. Case modification

選択肢は **No change / To lower case / To upper case / To Propername（先頭大文字・後続小文字）/ To ProperName（先頭大文字・後続そのまま）**。項目 "Peter Wiener" は次のように展開される。

```
Peter Wiener
peter wiener
PETER WIENER
Peter wiener
```

### 15-3. Recursive grep

前のリクエストの応答からテキストを抽出し、次のペイロードに使う。SQL injection でデータベース内容を再帰的に抽出する例。

```
UNION SELECT name FROM sysobjects WHERE name > 'a'
```

サーバのエラーメッセージが最初のオブジェクト名を開示する。

```
Syntax error converting the varchar value 'accounts' to a column of data type int.
```

次に "accounts" を使ってクエリを繰り返す。設定は **Initial payload for first request** / **Extract grep item** / **Stop if duplicate payload found**。補足（Note）: recursive grep は **max concurrent request が 1 の resource pool を使う必要がある**。

### 15-4. Illegal Unicode（フィルタ回避）

文字を不正な Unicode エンコードで置換し、`../` や `..\` の想定エンコードにマッチするパストラバーサル防御の回避を試す。主なオプションは次のとおり。

- **Overlong UTF-8 encodings** — overlong エンコード使用（最大6バイト）。
- **Illegal UTF-8 continuation bytes**（Do illegal UTF-8）— 通常 `10xxxxxx` の continuation byte を `00xxxxxx` `01xxxxxx` `11xxxxxx` に改変。
- **Illegal hex characters**（Do illegal hex）— hex エンコードをわざと崩す。一部のデコーダは `G` を 16、`H` を 17 と解釈してしまうため、たとえば `0x1G` が 32 と読まれたり、`0xG1` が 257（あふれて 1）と読まれたりする。1つの正当な2桁 hex コードに対して 4〜6 通りの不正 hex 表現が作られる。
- **Hex formatting** — Use lower case alpha characters（小文字を使う）/ Add % prefix before each byte（各バイトの前に `%` を付ける＝実質 URL エンコード）。
- **Total encodings** — 生成されるエンコード数の推定を表示し、その上限を指定できる。組合せが膨大になりすぎないよう歯止めをかけるためのもの。
- **Match / replace in list items** — Match character（各項目内で置換される文字。ダミーの `*` 等を使う）と Replace with encodings of（不正エンコードを導出する文字。ASCII 文字または2桁 hex で指定でき、非印字の ASCII を指定するのに便利）。

### 15-5. Numbers

指定した範囲・形式で数値のペイロードを生成する。設定は大きく「範囲（Number range）」と「形式（Number format）」の2つに分かれる。

**Number range（どの数値を作るか）:**

| 項目 | 意味 |
| --- | --- |
| Type | `sequentially`（連番）か `random`（ランダム）か |
| From / To | 生成範囲の下限・上限 |
| Step | 増分。**負値**にすると降順で生成する |
| How many | ランダム生成する個数（重複が出ることがある） |

**Number format（どんな見た目にするか）:**

| 項目 | 意味 |
| --- | --- |
| Base | `decimal`（10進）か `hexadecimal`（16進） |
| Min integer digits | 整数部の最小桁数。桁が足りないと**左をゼロで埋める**（例: `5` → `005`） |
| Max integer digits | 整数部の最大桁数。多いと**最上位の桁が切り捨てられる** |
| Min fraction digits | 小数部の最小桁数（**decimal のみ**）。足りないと右をゼロで埋める |
| Max fraction digits | 小数部の最大桁数（**decimal のみ**）。多いと切り捨てる |

各桁数フィールドは空欄にすると最小・最大を強制しない。補足（Note）: 総桁数が約12桁を超える範囲を巡回するなら、payload markers で大きな数の一部だけをハイライトして、桁数の少ない数値ペイロードを生成する方が信頼性が高い（Burp は倍精度浮動小数点を使うため、大きな/精密な数では精度が落ちる）。

### 15-5b. Dates

指定した範囲・形式で日付のペイロードを生成する。異なる日付の注文簿を収集するデータマイニングや、生年月日の総当たりに使う。

| 項目 | 意味 |
| --- | --- |
| From / To | 生成範囲の開始日・終了日 |
| Step | 増分。単位は **days / weeks / months / years** から選び、**正の値**を指定する |
| Format | 既定の形式を選ぶか、カスタム形式を組む |

カスタム形式は次の記号を組み合わせて作る（`/ . :` などのリテラル文字はそのまま出力される）。

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

### 15-6. Bit flipper（暗号トークン改変）

各ビット位置を改変する。設定は **Operate on**（base 値か別文字列）/ **Format of original data**（リテラルか ASCII hex）/ **Select bits to flip**。base "ab" をリテラルで全ビットフリップした例（各文字のビットを1つずつ反転させる）。

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

同じ "ab" を **ASCII hex として扱い**（Format of original data で hex を選んだ場合）、全ビットフリップした例。この場合は各バイトの hex 表現に対してビット反転が働く。

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

**CBC モードのブロック暗号**で暗号化された意味のあるデータでは、前の暗号ブロックのビットを改変して復号データの一部を系統的に変えられる可能性がある。

### 15-7. ECB block shuffler

ECB は各平文ブロックを独立に暗号化するため、同一平文ブロックは同一暗号文ブロックになる。暗号文ブロックをシャッフルすると復号平文もシャッフルされ、アプリロジックに干渉できる。設定は **Encrypted data to shuffle** / **Block size**（通常 8 または 16 バイト。不明なら各サイズで試す）/ **Additional encrypted strings**（同一 cipher/key の追加ブロック）。

### 15-8. Username generator

名前/メールリストから一般的スキームで候補ユーザ名を導出する。"peter wiener" から最大115候補。

```
peterweiner
peter.wiener
wienerpeter
wiener.peter
peter
wiener
peterw
peter.w
...
```

### 15-9. Collaborator payloads（帯域外検出）

**Burp Collaborator** ペイロードを生成・注入する。各ペイロードは Collaborator サーバのサブドメインとなるユニーク識別子を含み、脆弱性が生じると標的アプリが Collaborator と通信する。**Include Collaborator server location** で完全アドレスを含める。やり取りは攻撃結果ウィンドウで見られる。補足（Note）: **やり取りは Collaborator タブには表示されない**。遅延したやり取りは攻撃を保存し Dashboard の Event log を監視する。

〔補足〕Collaborator payloads は SSRF・ブラインド XSS・帯域外（OOB）SQL/コマンドインジェクションなど「応答に結果が直接現れない」脆弱性の検出に不可欠。クライアントサイドでは、管理画面など自分が見られない文脈で発火する保存型 XSS（ブラインド XSS）の検出に活用できる。

### 15-10. その他

**Character frobber** は各文字の ASCII コードを1増やし、どのパラメータ部分が応答に影響するかを調べる。**Null payloads** は position 不要で base request を繰り返し、Cookie 収集やアプリ層 DoS に使う。**Copy other payload** は new password と confirm password のように「2値が常に同じ」制約を満たすのに使う。

### 15-11. Character blocks と Brute forcer（設定の詳細）

概観表では1行にまとめたが、この2つは長さを制御する設定項目を持つので、ここで補う。

**Character blocks** は、指定した文字/文字列のブロックを長さを変えながら生成する。**バッファオーバーフロー**などの境界条件の脆弱性を探ったり、特定の長さの入力がフィルタを回避する/予期しないコードパスを踏むロジック欠陥を突いたりするのに使う。

| 項目 | 意味 |
| --- | --- |
| Base string | 繰り返しの元にする文字列 |
| Min length | base string をこの数だけ乗じた長さが最小ブロック |
| Max length | 生成するブロックの最大長 |
| Step | 各ブロック長の増分 |

**Brute forcer** は、指定した文字セットの全順列を、指定した長さの範囲で生成する（真の総当たり）。文字数が増えると組合せは指数的に爆発するので、範囲は慎重に決める。

| 項目 | 意味 |
| --- | --- |
| Character set | ペイロードに使う文字の集合。サイズで総数が指数的に増える |
| Min length | 生成する文字列の最小長 |
| Max length | 生成する文字列の最大長 |

> ### 📌 ここは自分で開いて読んでください
> **資料**: Intruder payload types — `tools/intruder/configure-attack/payload-types.html`
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限。本文はバンドル版オフラインドキュメントのミラーにもとづく要約である）。
> **読みどころ**:
> 1. 全 payload type、特に Recursive grep・Illegal Unicode・Bit flipper・ECB block shuffler・Collaborator payloads の詳細設定。
> 2. Community 版で throttle される機能、Pro 限定の predefined list を版バッジで確認する。
> **代替手段**: バンドル版 Burp 同梱のオフラインドキュメントに同一文面が含まれる。

---

## 16. Predefined payload lists と Payload processing

### 16-1. Predefined payload lists（Pro のみ）

Burp は組込みの payload リストを備える。使い方は、payload type を選び **Add from list...** → リスト選択。リストにプレースホルダがあれば処理ルールを設定する。

| Predefined payload list | 使うプレースホルダ |
| --- | --- |
| CGI Scripts | {file} |
| Fuzzing - full | {base}, {domain}, foo@{domain} |
| Fuzzing - JSON_XML injection | {base} |
| Fuzzing - out of band | {domain} |
| Fuzzing - path traversal (single file) | {file} |
| Fuzzing - path traversal | {base} |
| Fuzzing - quick | {base} |

| Placeholder | 用途 | 置換例 |
| --- | --- | --- |
| {file} | ファイル名を指定 | /etc/passwd |
| {base} | payload マーク値で置換 | 1337 |
| {domain} | Web ドメインを指定 | COLLAB_ID.oastify.com |
| foo@{domain} | メールアドレスの一部としてドメイン | example.com |

プレースホルダを実値にするには、**Payload processing** → **Add** → **Match/replace** → **Match regex** に `\{file\}` や `\{domain\}` → **Replace with** に `application.exe` や `portswigger.net` を入れる。`{domain}` に Collaborator ドメイン（`COLLAB_ID.oastify.com`）を入れれば OOB 検出になる。

### 16-2. Payload processing（ペイロード加工）

> 「You can configure payload processing rules so that Burp Intruder modifies payloads before it inserts them into the request.」

処理ルールは**順番に実行**され、**Up / Down** で順序変更、各ルールのオン/オフ切替ができる。主なルールは次のとおり。

| ルール | 内容 |
| --- | --- |
| Add prefix / Add suffix | 前後にリテラルを追加 |
| Match / replace | 正規表現マッチ部分をリテラルで置換 |
| Substring / Reverse substring | 指定オフセット・長さで抽出（Reverse は末尾から逆算） |
| Modify case | case を変更 |
| Encode | URL / HTML / Base64 / ASCII hex / 構築文字列でエンコード |
| Decode | URL / HTML / Base64 / ASCII hex でデコード |
| Hash | ハッシュ操作 |
| Add raw payload | 生値を処理済み値の前後に追加（raw と hash 両形式を送る） |
| Skip if matches regex | マッチしたらペイロードをスキップ（最小長未満を捨てる等） |
| Invoke Burp extension | 拡張で処理 |
| Replace placeholder with base value | `{base}` を position の base 値で置換 |
| Replace placeholder with collaborator payload | マッチ部分を Collaborator ペイロードで置換 |

**最終 URL エンコード**（Payload encoding の **URL-encode these characters**）は**処理ルール実行後に適用**される。これにより payload grep が反射ペイロードをチェックした後にエンコードをかけられる。

### 16-3. Intruder のユーザ設定（Settings ダイアログの Intruder ページ）

個々の攻撃タブの設定とは別に、Intruder 全体の振る舞いを決めるページが Settings ダイアログにある。**Settings → Tools → Intruder** から開き、ここの項目はすべて **user 設定**（＝そのマシン上のすべての Burp インストールに適用される）である。§13 で「Auto § がパラメータ値を置換するか追加するかは Settings で構成する」と触れたが、その本体がこのページである。

**Automatic payload placement** — Auto § などで payload marker を自動配置するときの入れ方を決める。

- **Replace base parameter value** — もとのパラメータ値を**置き換える**位置にマーカーを置く。
- **Append to base parameter value** — もとのパラメータ値の**後ろに追加**する位置にマーカーを置く。

**New tab configuration** — 新しい attack タブを開いたときの初期構成をどこから持ってくるか。

- **Use default attack configuration** — 既定の攻撃構成を使う。
- **Copy configuration from first tab** — 最初のタブの構成を複製する。
- **Copy configuration from last tab** — 最後のタブの構成を複製する。

**Behavior when closing result windows** — 攻撃結果ウィンドウを閉じたときの既定の応答（§20-5 の「Closing attacks」で問われるダイアログの既定値）。

- 進行中の攻撃を閉じるとき: **Continue my attack in the background**（背後で続行）/ **Delete my attack**（破棄）/ **Ask me what to do each time**（毎回尋ねる）。
- 完了した攻撃を閉じるとき: **Save my attack to the project file**（project file に保存）/ **Keep in memory**（メモリに保持）/ **Delete my attack**（破棄）/ **Ask me what to do each time**（毎回尋ねる）。

**Payload list location** — payload list をどこから読むか。

- **Use built-in lists** — Burp 内蔵のリストを使う。
- **Load custom lists from directory** — 指定フォルダから独自リストを読み込む（**Select directory** でフォルダを選ぶ）。Burp の preconfigured payload list をすべてこのカスタムディレクトリへ書き出したいときは、カスタムディレクトリを読み込んだうえで **Copy** を選ぶ。

---

## 17. Attack settings — Grep が脆弱性検出の核

Settings タブで攻撃を構成する。多くは実行中も変更できる。ここでは検出に直結する Grep 群を中心に見る。

### 17-1. Grep - match（リフレクション/エラー検出）

> 「These settings flag result items that contain specified expressions in the response.」

- **Flag result items with responses matching these expressions** — フラグする式のリスト（既定は fuzzing 向けの一般エラー文字列）。
- **Match type** — simple string か regular expression か。
- **Case sensitive match** / **Exclude HTTP headers**。

攻撃中、各式に結果列が追加され、式が見つかった回数を記録する。列見出しクリックでソートし、共通エラー文字列を持つ結果を素早く特定できる。

### 17-2. Grep - extract（データ抽出）

> 「These settings extract information from responses.」

**Extract the following items from responses** → **Add** で抽出項目の場所を定義する（Response extraction rules、次項）。**Maximum capture length** で各項目の最大長を決める。Harvesting useful data の中核。補足（Note）: 同一の項目が応答内に複数回現れるとき、それらをまとめて抽出するには、同じ項目を**連続して複数回 Add する**。一意の prefix を持たない HTML の表から複数セルの値を取り出すような場合に使う。

### 17-3. Grep - payloads（XSS 等のリフレクション検出）★

> 「These settings can be used to flag result items containing reflections of the submitted payload.」

- **Case sensitive match** / **Exclude HTTP headers**。
- **Match against pre-URL-encoded payloads** — ペイロードを pre-encoded 形式で応答チェック（Intruder で URL エンコードした場合に必要。アプリが通常デコードして元形式で反射するため）。

攻撃中、ペイロードが応答で見つかった回数を記録する結果列を追加する。**cross-site scripting** や他の応答注入脆弱性の検出に使える。ユーザ入力が動的にアプリ応答へ挿入されると反射が起きるからである。

### 17-4. その他の設定

| 設定群 | 主な項目 |
| --- | --- |
| Request headers | Update Content-Length / Set Connection: close |
| Error handling | Number of retries / Pause before retry |
| Attack results | Store requests/responses / **Make unmodified baseline request**（item 0）/ Use denial-of-service mode / Store full payloads |
| Redirections | Follow redirections（Never / On-site / In-scope / Always）/ Process cookies。最大10連鎖 |
| HTTP/1 connection reuse | 接続再利用で高速化 |
| HTTP version | Override project-level HTTP/2 setting / Default to HTTP/2 if supported |

**Make unmodified baseline request** は、全 position を base 値にしたリクエストを **item 0** として発行し、攻撃応答と比較する基準を提供する。異常検出の出発点になる。

---

## 18. Response extraction rules

Grep-extract と recursive grep で使う「応答内の変動項目の位置」を定義する。最も簡単なのは**サンプル応答内で項目を選択**すること（**Update config based on selection** がオンなら Burp が自動構成）。

**開始・終了の定義:**

- **Start after expression** — 抽出項目直前のリテラル式。エスケープ: `\r`=CR、`\n`=LF、`\xNN`=ASCII hex コード NN、`\\`=バックスラッシュ。
- **Start at offset** — 固定オフセット。
- **End at delimiter** — 直後のリテラル式（同じエスケープ）。
- **End at fixed length** — 開始から固定長。

**正規表現グループから定義:** グループを含む正規表現でマッチ時にグループ内容を抽出する。HTML title を抽出する例。

```
<title>(.*?)</title>
```

最初の6桁の数を抽出する例。

```
(\d\d\d\d\d\d)
```

上部パネルを修正すると Burp が抽出項目を自動ハイライトする。**Refetch response** で構成をテストできる。

---

## 19. Resource pool — レートを制御して安全に検証する

> 「A resource pool is a group of tasks that share a quota of resources.」

resource pool とは、複数のタスクがリソース枠（同時リクエスト数など）を共有するグループのこと。標的サーバへの過負荷やレート制限超過を避けるために使う。バグバウンティでは**サービスを落とさない**ことが必須なので、ここは必ず設定する。

**各プールの throttling 設定:**

- **Maximum concurrent requests** — 同時送信するリクエスト数を制限する。
- **Delay between requests** — ミリ秒単位。**Fixed** / **With random variations** / **Increase delay in increments**（セッション失効時間の判定にも使える）。
- **Automatic throttling** — サーバが指定コードで応答したとき自動的に短い遅延を追加する。

新規タスクは default resource pool に割り当てられる。攻撃開始前なら Intruder > Resource pool → **Create new resource pool** でカスタムプールを作れる。攻撃中は攻撃ウィンドウの Resource pool タブでプールを切り替え、リアルタイムでリソースを管理できる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Intruder resource pool / attack settings — `tools/intruder/configure-attack/resource-pool.html`, `settings.html`
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限。本文はバンドル版オフラインドキュメントのミラーにもとづく要約である）。
> **読みどころ**:
> 1. Maximum concurrent requests と Delay を、レート制限のあるアプリに合わせて設定する手順。
> 2. Grep - match / extract / payloads を組み合わせて結果から脆弱性を検出する実例。
> **代替手段**: バンドル版 Burp 同梱のオフラインドキュメントに同一文面が含まれる。

---

## 20. 攻撃結果の閲覧・分析・ワークフロー

### 20-1. 興味深い応答の見分け方

攻撃は新しい結果ウィンドウで実行される。次のような差が手がかりになる。

- 異なる HTTP ステータスコード。
- 異なる応答長。
- 特定の式の有無。
- エラーやタイムアウトの発生。
- 応答受信/完了までの時間。

### 20-2. 結果表の列

Results タブの表には **Request / Position / Payload / Status / Time of day / Response received / Response completed / Error / Timeout / Length / Cookies / Comment** が並ぶ。適切な設定時には match grep 結果、extract grep 抽出データ、payload 反射の有無、**Redirects followed**、**Interactions**（Collaborator やり取り数）が追加される。

### 20-3. 分析

- **Sorting** — 列見出しクリックで昇順/降順/未ソートを巡回し、異常項目を特定する。
- **Filtering** — display filter で **search term**（Regex / Case sensitive / Negative search）、**status code**、**annotation**（コメント/ハイライトのある項目のみ）で絞る。フィルタは表示制御のみで、非表示項目は削除されずリセットで戻る。
- **Annotations** — 右クリック → Highlight で色付け、Comment 列ダブルクリックでコメント。

### 20-4. ワークフローツール（右クリックメニュー）

- **Send to...** / **Scan**（Pro）。
- **Show response in browser** / **Request in browser**（In original session / In current session）。
- **Generate CSRF PoC** — 選択リクエストを発行させる HTML を作る。
- **Add to site map** / **Request item again**（ネットワークエラーで失敗した項目の再送）。
- **Define extract grep from response** — 応答から新しい extract grep 項目を作る。
- **Copy as curl command** / **Save item**（XML）。

### 20-5. 攻撃の編集・保存

実行中の攻撃は **Attack** メニューで Pause / Resume / Restart できる。ただし**攻撃構造の根幹（attack type / payload positions / payload type）は修正不可**で、変えるには元の attack タブで新攻撃を開始する。補足（Note）: 構成修正前に一時停止を推奨する（実行中の変更はキー押下ごとに反映され、Numbers の To 桁を削ると攻撃が突然完了することがある）。

保存は既定でされない。Pro では **Save** メニューで Results table / Server responses / Attack configuration / Project file に保存できる。**Load attack config** で構成を再利用できる。

**攻撃ウィンドウを閉じるとき（Closing attacks）の挙動:**

- **進行中**の攻撃ウィンドウを閉じると、「バックグラウンドで続行するか、破棄するか」を問われる。
- **完了後**の攻撃を閉じると、「project file に保存するか（Pro の disk-based プロジェクトのみ）、メモリに保持するか」を選べる。
- どちらの既定の応答も、Settings ダイアログの **Behavior when closing result windows** で指定する（後述の Intruder 設定を参照）。

### 20-6. Intruder のタブ管理

リクエストを Intruder に送ると、新しい attack タブが作られてリクエスト詳細が自動投入される。タブヘッダのコントロールは次のとおり。

- **Create an attack tab** — add tab ボタンで新タブを作る。新タブの開始構成は Settings で決める（後述）。
- **Rename tabs** — タブヘッダをダブルクリックして名前を入力する。
- **Switch tab view** — 右クリック → Tab view settings で **Scrolling view** / **Wrapped view** を切り替える。
- **Close tabs** — 単一タブを閉じるほか、**Close all tabs** / **Close other tabs** / **Close tabs to the left / right** / **Reopen closed tab**（Tabs options メニュー）が使える。

補足（Note）: すでに Intruder にあるリクエストから、さらに Intruder に送ると、同一リクエストの別インスタンスが新タブとして作られる（テストの整理に便利）。

---

## 21. クライアントサイド脆弱性ハンティングでの使いどころ

ここまでの機能を、クライアントサイドのバグハンティングの視点で統合する。以下はすべて**許可された診断・バグバウンティ・自分で立てた検証環境**を前提とした、防御/検出と対の技術解説である。

### 21-1. Repeater（手動再送・検証）

- DOM ベース XSS や postMessage 脆弱性の source に至る HTTP レスポンス（HTML/JS）を Repeater で取得し、Inspector で URL/Base64 多重エンコード値を人間可読に展開して解析する。
- WebSocket メッセージを Send to Repeater し、サーバ宛/クライアント宛を切り替えて改変再送する（**クライアント宛送信は Proxy 経由で接続が開いている間のみ可能**）。
- **Group send in parallel（single packet attack）** で複数リクエストを実質同時到達させ、**レースコンディション**（多重利用・二重処理・TOCTOU）を検証する。
- **Group send in sequence (single connection)** で **client-side desync** を検証する。
- Inspector の改行/NULL 注入と HTTP/2 疑似ヘッダ編集で **kettled request** を構築する（Intruder は kettled 未対応で正規化される点に注意）。
- message editor の **Change request method**、**Convert selection**（Construct string での SQL/JS 文字列生成）で入力フィルタ回避や XSS ペイロード微調整を行う。
- **Request in browser > In current browser session** でアクセス制御（IDOR/権限昇格）を手軽にテストする。

### 21-2. Intruder（自動化攻撃）

- **Grep - payloads** でペイロード反射を検出し、**リフレクション XSS** 候補を大量リクエストから一括抽出する。**Match against pre-URL-encoded payloads** で URL エンコードして送ったペイロードの反射も捕捉する。
- **Collaborator payloads** で **ブラインド XSS**・SSRF・OOB インジェクションを検出する（結果は攻撃結果ウィンドウ／Dashboard の Event log で確認）。
- **Sniper** で単一パラメータの fuzzing、**Cluster bomb** でユーザ名×パスワード総当たり、**Pitchfork** で関連2値の同時投入。
- **Predefined payload lists** を Add from list で投入し、`{base}`/`{domain}`/`{file}` を Match/replace で実値にする。
- **Payload processing** の Encode/Decode/Hash/Match-replace を連結して WAF/フィルタ回避のエンコードバリエーションを系統生成し、**Illegal Unicode** でパストラバーサルフィルタ回避を試す。
- **resource pool** の Maximum concurrent requests と Delay でレート制限を尊重し、過度な負荷や DoS を避けて検証する。

### 21-3. 防御・検出の視点

これらの攻撃面を守る側の対策は次のとおり。反射 XSS には出力エンコードと Content-Security-Policy、レースコンディションには一意制約とアトミックな処理・ロック、request smuggling / desync にはフロントとバックエンドの HTTP パーサ整合とコネクション再利用の制御、識別子列挙にはランダムで推測困難な ID とレート制限・アカウントロック、ブラインド XSS には保存値のサニタイズと管理画面での CSP、が基本となる。攻撃者が Intruder/Repeater で突く場所は、そのまま守る側が固めるべき場所である。

〔補足〕Turbo Intruder は本ドキュメントには載っていない **BApp Store 拡張**で、Python スクリプトによる高速攻撃や single packet attack を扱う。標準の Intruder とは別物なので混同しないこと。Community 版では Intruder が**速度制限（throttled）**され、predefined payload lists や一部機能が Pro 限定である点も公式サイトで確認するとよい。

---

## 手を動かす

1. 練習用の Web Security Academy lab（無料）にログインし、Burp's browser でアクセスして通信を Proxy > HTTP history に貯める。
2. `GET /product?productId=1` のようなリクエストを右クリックし **Send to Repeater**。Repeater で **Send** を押し、`productId` を `2`、`999999`、`abc` と変えて再送する。応答の Status と Length の変化、エラー応答に含まれるフレームワーク名を観察する。
3. Repeater で `POST /login` を開き、タブグループを作って同じタブを複製する。**Send** 横の矢印から **Send group in parallel** を選び **Send group**。右下のインジケータで応答受信順を確認する（レースコンディションの体験）。
4. Inspector を開き、session cookie を展開する。自動デコードされた **Decoded from Base64** の値を確認し、`wiener` を `administrator` に書き換えて **Apply changes** → **Send**。応答の変化を見る。
5. `POST /login` を右クリック → **Send to Intruder**。`username` の値を選び **Add §**。Attack type を **Sniper** にし、Payloads タブで Simple list に候補ユーザ名を **Paste**。
6. Settings タブで **Grep - Match** に `Incorrect password` を追加し、**Start attack**。結果ウィンドウで **Length** 列と Grep 列をソートし、他と違う1件（有効ユーザ名）を特定する。
7. Resource pool タブで **Maximum concurrent requests** を小さく（例: 5〜10）、**Delay between requests** を数百ミリ秒に設定し、サーバに優しい攻撃を心がける。
8. 有効ユーザ名が得られたら、**Cluster bomb** に切り替えて username×password の総当たりを構成し、リクエスト数（積）が現実的な範囲に収まるようリストを **Deduplicate** する。

## つまずきポイント

- **タブ固有設定を1つ選ぶとグローバル設定が全部無視される**。Repeater で「なぜかこの設定が効かない」ときは、タブの settings アイコンが青くないか（＝タブ固有モードか）を確認する。
- **並列送信の前提**を満たさないと single packet attack にならない。全リクエストが同一 host・port・プロトコルで、HTTP/1 keep-alive が無効であること。
- **Intruder は kettled request（HTTP/2 排他リクエスト）を扱えず正規化する**。高度な HTTP/2 攻撃は Repeater で行う。
- **Cluster bomb のリクエスト数は積**なので、リストが大きいと爆発的に増える。Deduplicate と現実的なリスト長で抑える。
- **Grep - payloads で URL エンコードして送ったのに反射が検出されない**ときは、**Match against pre-URL-encoded payloads** を有効にする（アプリがデコードして元形式で反射するため）。
- **Collaborator payloads のやり取りは Collaborator タブに出ない**。攻撃結果ウィンドウの Interactions 列、または Dashboard の Event log を見る。
- **Numbers で大きな数を巡回すると精度が落ちる**（倍精度浮動小数点のため）。markers で数の一部だけをハイライトする。
- **recursive grep は max concurrent request 1 の resource pool が必須**。並列だと前応答からの抽出が成立しない。
- **攻撃実行中に構成を変えるとキー押下ごとに反映される**。Numbers の To 桁を消すと攻撃が突然完了することがあるので、修正前に一時停止する。
- **本文の値はバンドル版（ビルド 32146 相当）ミラー由来**。新しい payload type や既定値はライブページで確認する。

## この節のまとめ

- Burp Repeater は「興味深い HTTP/WebSocket メッセージを修正して何度でも送り直す」ツールで、各メッセージは独立タブで扱い、修正は履歴に残る。
- 入力ベース脆弱性のテスト、多段プロセスや接続状態依存の脆弱性のテスト、Scanner 報告の手動検証に使う。
- グループ送信は3方式ある。**並列**（HTTP/1=last-byte synchronization、HTTP/2+=single packet attack）はレースコンディション検証、**逐次・単一接続**は client-side desync 検証、**逐次・別接続**は多段プロセス検証に効く。
- Inspector はヘッダ・パラメータ・Cookie を name-value で表示し、HTML/URL/Base64 を自動デコード、編集後は元の符号化を自動再適用する。HTTP/2 疑似ヘッダ（`:` 始まり）や改行・NULL 注入で kettled request を作れる。
- kettled request は Proxy/Repeater/Logger/Scanner が対応し、**Intruder は非対応で正規化**される。
- message editor は Repeater/Intruder 共通基盤で、Change request method、Convert selection、Show/Request in browser などの workflow アクションを提供する。
- Burp Intruder は「同じリクエストの定義位置（§）へ異なるペイロードを差し込み繰り返し送る」自動化ツール。fuzzing / brute-force / 識別子列挙 / データ収集に使う。
- Attack type は Sniper（position 数×ペイロード数）、Battering ram（ペイロード数）、Pitchfork（最小セット数）、Cluster bomb（積）の4種。
- Payload type は Simple list から Recursive grep、Illegal Unicode、Bit flipper、ECB block shuffler、Collaborator payloads まで多数あり、Payload processing ルールと最終 URL エンコードで加工する。
- 結果分析は Grep - match（式検出）、Grep - extract（情報抽出）、Grep - payloads（反射＝XSS 検出）と、列ソート・フィルタ・注釈で行う。
- resource pool で Maximum concurrent requests・Delay・Automatic throttling を設定し、サーバへの過負荷やレート制限超過を避ける。
- クライアントサイドでは、Repeater は DOM/postMessage/WebSocket の手動検証と HTTP/2・desync・レースの検証に、Intruder は Grep-payloads による反射 XSS 検出、Collaborator payloads によるブラインド XSS/OOB 検出に効く。
- 攻撃者が突く場所（反射・レース・desync・列挙・ブラインド XSS）は、守る側が出力エンコード・一意制約・パーサ整合・レート制限・CSP で固める場所と一致する。

## 理解度チェック

1. Repeater の「Send group in parallel」で HTTP/2+ を使うとき、内部で使われる同期手法は何か。
   ▶ 答え: single packet attack（複数リクエストを単一 TCP パケットで送る）。HTTP/1 では last-byte synchronization が使われる。

2. client-side desync を検証したいとき、グループ送信のどの方式を選ぶか。
   ▶ 答え: Send group in sequence (single connection)。1本の接続で全タブのリクエストを送り、接続を閉じる。

3. Inspector で HTTP/2 の疑似ヘッダはどう識別されるか。
   ▶ 答え: 名前が**コロン（`:`）で始まる**（例: `:method` `:path` `:scheme`）。

4. Intruder の Cluster bomb で、position 1 に 10 個、position 2 に 20 個のペイロードセットを使うと総リクエスト数はいくつか。
   ▶ 答え: 積なので 10 × 20 = 200。Pitchfork なら最小セット数の 10、Sniper（単一セット）や Battering ram は積にならない。

5. リフレクション XSS を Intruder で検出するにはどの Grep 設定を使うか。URL エンコードして送ったペイロードの反射も捕まえるには何を有効にするか。
   ▶ 答え: Grep - payloads。**Match against pre-URL-encoded payloads** を有効にする（アプリがデコードして元形式で反射するため）。

6. Repeater でタブ固有設定を1つ選ぶと、そのタブのグローバル設定はどうなるか。
   ▶ 答え: すべて無視される。送信前にタブ固有メニューで全設定を正しく構成する必要がある。

7. Collaborator payloads を使った攻撃で、標的とのやり取りはどこで確認するか。
   ▶ 答え: 攻撃結果ウィンドウ（Interactions 列）。Collaborator タブには表示されない。遅延したやり取りは攻撃を保存し Dashboard の Event log を監視する。

8. request smuggling をテストするため、Repeater で意図的に改行（`\r`）を省きたい。どのグローバル設定を無効化するか。
   ▶ 答え: Message modification の **Normalize HTTP/1 line endings**。既定では `\n` の前に `\r` を自動追加してしまう。

9. recursive grep payload type を使うとき、resource pool にどんな制約があるか。
   ▶ 答え: max concurrent request が 1 のプールを使う必要がある（前の応答から抽出した値を次のペイロードに使うため）。

10. 攻撃応答を比較する基準となる、全 position を base 値にしたリクエストを発行する設定は何か。結果表では何番の item になるか。
    ▶ 答え: Attack results の **Make unmodified baseline request**。結果表では **item 0** として表示される。

## 出典

- https://portswigger.net/burp/documentation/desktop/tools/repeater （Burp Repeater 公式ドキュメント。原典は取得できず、バンドル版オフラインドキュメント〔内部ビルド 32146 相当〕のミラーから逐語取得）
- https://portswigger.net/burp/documentation/desktop/tools/intruder （Burp Intruder 公式ドキュメント。同上）

<!-- sources: https://portswigger.net/burp/documentation/desktop/tools/repeater, https://portswigger.net/burp/documentation/desktop/tools/intruder -->
<!-- terms: Burp Repeater, Burp Intruder, single packet attack, last-byte synchronization, client-side desync, Inspector, 疑似ヘッダ, kettled request, payload position, Sniper, Battering ram, Pitchfork, Cluster bomb, Recursive grep, Illegal Unicode, Bit flipper, ECB block shuffler, Collaborator payloads, Grep - match, Grep - extract, Grep - payloads, resource pool, payload processing, Override SNI, SNI, WebSocket -->
<!-- self-read: https://portswigger.net/web-security/race-conditions | サイト側の egress 制限で portswigger.net へ直接アクセス不可、バンドル版ミラーにもとづく要約 -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/settings/tools/repeater | サイト側の egress 制限で直接取得不可、バンドル版ミラーにもとづく要約 -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/http2 | サイト側の egress 制限で直接取得不可、バンドル版ミラーにもとづく要約 -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/intruder/configure-attack/attack-types | サイト側の egress 制限で直接取得不可、バンドル版ミラーにもとづく要約 -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/intruder/configure-attack/payload-types | サイト側の egress 制限で直接取得不可、バンドル版ミラーにもとづく要約 -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/intruder/configure-attack/resource-pool | サイト側の egress 制限で直接取得不可、バンドル版ミラーにもとづく要約 -->
