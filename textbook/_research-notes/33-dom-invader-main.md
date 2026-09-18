# [33] DOM Invader（Burp内蔵ブラウザ用 DOM脆弱性ハンティング拡張）全体像ノート

想定章: ch06 / 担当ID: 33 (dom-invader-main)

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://portswigger.net/burp/documentation/desktop/tools/dom-invader | partial | 直接取得は全滅 → 公式ドキュメントのオフラインコピー（Burp同梱 `resources/Documentation/burp/documentation/desktop/tools/dom-invader/*.html`）を raw.githubusercontent.com 経由で取得 | **portswigger.net は本セッションの egress プロキシによりブロック（CONNECT に 403）**。WebFetch も `EGRESS_BLOCKED`。web.archive.org も同様にブロック。WebSearch はセッション予算（200回）を使い切りで利用不可。代替として、Burpに同梱されている**公式ドキュメントHTMLそのもの**（同一文面）を入手し、本文を逐語ベースで日本語化した。ただし同梱版はスナップショットであり、ライブ版に後から追加されたページ（例：shadow DOM 関連の記述）が含まれない可能性がある |
| https://portswigger.net/burp/documentation/desktop/tools/dom-invader/enabling.html（サブページ） | full | 同上（同梱ドキュメント） | 有効化手順の原文を確保 |
| https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss.html（サブページ） | full | 同上 | canary注入・sink特定・XSSコンテキスト判定・スタックトレースの原文を確保 |
| https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages.html（サブページ） | full | 同上 | postMessage 機能の原文を確保 |
| https://portswigger.net/burp/documentation/desktop/tools/dom-invader/prototype-pollution.html（サブページ） | full | 同上 | PoC・gadget スキャンの原文を確保 |
| https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-clobbering.html（サブページ） | full | 同上 | DOM clobbering の原文を確保 |
| https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/{index,main,attack-types,web-messages,prototype-pollution,misc,canary}.html | full | 同上（7ページ） | 設定項目の原文を全て確保 |
| https://portswigger.net/blog/introducing-dom-invader（参考・二次） | partial | 中国語翻訳記事（`izj007/wechat` 内のミラー）経由 | **sourcesList / sinkRanking の完全なコード**を逐語で入手（下記に収録） |
| DOM Invader 拡張本体のUIラベル（`burp-chromium-extension` v1.6.9 の `settings/settings.html`, `panels/augmented-dom.html`） | full | raw.githubusercontent.com 経由 | UI上の**実際のトグル文言**を確認。v1.6.9 は古めのため DOM clobbering 等は未搭載 |

> 注意：本ノートの一次情報は「PortSwigger公式ドキュメント（Burp同梱のオフラインHTML）」であり、文面は portswigger.net の当該ページと同一である。ただし版が固定されているため、最新機能（2024〜2025年に追加されたもの）は反映されていない可能性がある。最新版の確認方法は最終節「読者が自分で開くべき資料」を参照。

## 要約（3〜10行）

- DOM Invader は **Burp Suite の内蔵ブラウザ（Burp's browser）専用のブラウザ拡張**で、Professional / Community の両エディションで利用できる。プリインストールされているが**既定では無効**。
- 有効化すると **DevTools に「DOM Invader」タブ**が追加され、ページ上の source / sink を計装（instrumentation）して、入力がどの sink に到達したかを即座に可視化する。
- 中核概念は **canary**（英数字のランダム文字列）。これを source（URLクエリ、フォーム、web message など）に注入し、DOM を解析して canary が現れた sink を「面白い順」に並べて表示する。つまり **DOM XSS を反射型XSSのように扱える**。
- 4本柱：(1) DOM XSS（augmented DOM / DOM view）、(2) web message（`postMessage()` のログ・改変・再送・自動生成・PoC生成）、(3) クライアントサイド prototype pollution（source検出・PoC・gadget スキャン・Exploit生成）、(4) DOM clobbering。
- 設定は **Main / Attack types（配下に Web messages・Prototype pollution）/ Misc / Canary** の4カテゴリ。設定変更は原則 **Reload が必須**。
- 副作用が大きい機能（`eval()` の計装、全 source への canary 注入、CSP/X-Frame-Options 除去など）は既定で無効または限定されており、対象サイトを壊さないよう段階的に有効化するのが実務上の定石。

---

## 詳細ノート

### 1. DOM Invader とは（出典: https://portswigger.net/burp/documentation/desktop/tools/dom-invader）

対応エディション表示：**Professional / Community**（両方で使える）。

原文の定義：

> DOM Invader is a browser-based tool that helps you test for DOM XSS vulnerabilities using a variety of sources and sinks, including both web message and prototype pollution vectors. It is available exclusively via Burp's built-in browser, where it comes preinstalled as an extension.

日本語要旨：DOM Invader は、**さまざまな source と sink（web message ベクタおよび prototype pollution ベクタを含む）を用いて DOM XSS をテストするためのブラウザベースのツール**。**Burp の内蔵ブラウザ経由でのみ利用可能**で、そこに拡張としてプリインストールされている。

〔補足（一般知識）〕通常の Chrome / Firefox に拡張として入れる配布形態は提供されていない（＝内蔵ブラウザを使うしかない）。

#### 1.1 主要機能（Key features）

有効化すると **ブラウザの DevTools パネルに新しいタブが追加**され、以下の主要タスクが行える（原文の4項目を逐条で）。

1. **DOM XSS を反射型XSSのようにテストする。** augmented DOM ビューにより、ページ上の「制御可能な sink」を即座に特定でき、**XSSコンテキスト**と**入力がどうサニタイズされているか**の両方が見える。→ 詳細は「Testing for DOM XSS」。
2. **`postMessage()` メソッドでページ上を流れる web message を、ログ・改変・再送する。** これにより web message 経由の DOM XSS をテストできる。さらに **DOM Invader 自身が特別に細工した web message を送って、代わりに脆弱性を探らせる**こともできる。→ 詳細は「Testing for DOM XSS using web messages」。
3. **クライアントサイド prototype pollution の source を自動特定し、危険な sink に渡される制御可能な gadget をスキャンする。** → 詳細は「Testing for client-side prototype pollution」。
4. **DOM clobbering 脆弱性を自動特定する。**

原文はさらに「DOM Invader is highly configurable, so you can fine-tune its behavior to suit different websites and use cases.（DOM Invader は高度に設定可能なので、サイトやユースケースに合わせて挙動を微調整できる）」と述べ、設定ページへ誘導している。

#### 1.2 ドキュメントのサブページ構成（公式サイト上の階層）

パンくず：Support Center > Documentation > Desktop editions > Tools > DOM Invader

- `/burp/documentation/desktop/tools/dom-invader/index.html` — DOM Invader（本ページ）
- `/burp/documentation/desktop/tools/dom-invader/enabling.html` — Enabling DOM Invader
- `/burp/documentation/desktop/tools/dom-invader/dom-xss.html` — Testing for DOM XSS
- `/burp/documentation/desktop/tools/dom-invader/web-messages.html` — Testing for DOM XSS using web messages
- `/burp/documentation/desktop/tools/dom-invader/prototype-pollution.html` — Testing for client-side prototype pollution
- `/burp/documentation/desktop/tools/dom-invader/dom-clobbering.html` — Testing for DOM clobbering with DOM Invader
- `/burp/documentation/desktop/tools/dom-invader/settings/index.html` — DOM Invader settings
  - `/settings/main.html` — Main settings
  - `/settings/attack-types.html` — Attack types
    - `/settings/web-messages.html` — Web message settings
    - `/settings/prototype-pollution.html` — Prototype pollution settings
  - `/settings/misc.html` — Misc settings
  - `/settings/canary.html` — Canary settings

参照されているスクリーンショット画像（教科書で図を探す際の手がかり）：
`dom-invader-innerHTML-sink.png` / `dom-invader-settings-main.png` / `dom-invader-unescaped-chars.png` / `dom-invader-payload.png` / `dom-invader-messages-overview.png` / `dom-invader-settings-messages.png` / `dom-invader-messages-view.png` / `dom-invader-messages-details.png` / `dom-invader-prototype-pollution-enabling.png` / `dom-invader-prototype-pollution-sources.png` / `dom-invader-prototype-pollution-poc.png` / `dom-invader-prototype-pollution-gadget.png` / `dom-invader-prototype-pollution-settings.png` / `dom-invader-dom-clobbering-enabling.png` / `dom-invader-customize-sources-and-sinks.png` / `dom-invader-settings-misc.png` / `dom-invader-settings-sources.png` / `dom-invader-callback-configuration.png`
（いずれも `https://portswigger.net/burp/documentation/desktop/images/<ファイル名>` に存在する）

---

### 2. 有効化手順（出典: .../dom-invader/enabling.html）

原文の前提：

> DOM Invader is preinstalled in Burp's browser, but is disabled by default as some of its features may interfere with your other testing activities.

＝**Burpのブラウザにプリインストール済みだが既定は無効**。理由は「一部機能が他のテスト作業を妨げうるから」。

**手順（原文の5ステップを逐条で）**

1. **Proxy > Intercept** タブへ行き、**Burp のブラウザを開く**（Open Browser）。
2. ブラウザウィンドウの**右上の Burp Suite ロゴ**をクリックする。ロゴが見えない場合は、まず**ジグソーパズル（拡張機能）アイコン**をクリックする。パネルが開き、**Burp Suite Navigation Recorder** と **DOM Invader 設定メニュー**のタブが表示される。
3. DOM Invader 設定から、**「DOM Invader is on」**になるようトグルスイッチを切り替える。
4. **Reload** をクリックしてブラウザを更新する。**変更を反映させるにはこれが必須**。
5. メインのブラウザウィンドウ上で**右クリック → Inspect** して DevTools パネルを開く。**「DOM Invader」タブ**が追加されていることを確認する。**パネルはブラウザウィンドウの下部にドッキングするのが推奨**（"For the best experience, we recommend docking the panel to the bottom of the browser window."）。

**Note（原文の注記）**

> By default, DOM Invader remembers your previous settings, including whether it was on or off. Keep this in mind if you close Burp's browser while DOM Invader is still enabled. To disable this behavior, go to **Settings > Tools > Burp's browser** and deselect **Store settings and history after closing**.

＝既定で DOM Invader は**前回の設定（オン/オフを含む）を記憶する**。有効のままブラウザを閉じると次回も有効なので注意。この挙動を止めるには **Settings > Tools > Burp's browser** で **「Store settings and history after closing」のチェックを外す**。

---

### 3. DOM XSS のテスト（出典: .../dom-invader/dom-xss.html）

> Testing for DOM XSS can be tedious as it often involves manually tracking the flow of your input through complex JavaScript, which may stretch to thousands of lines of code. DOM Invader greatly simplifies this process by instantly showing you any sinks that your input flows into, along with the surrounding context.

＝DOM XSS のテストは、数千行に及ぶ複雑な JavaScript の中を入力が流れる経路を手作業で追う必要があり退屈。DOM Invader は、**入力が流れ込む sink とその周囲のコンテキストを即座に表示する**ことでこれを大幅に簡素化する。

関連機能の大半は拡張の **DOM ビュー**（**DOM** view）からアクセスする。

#### 3.1 canary の注入（Injecting a canary）

> DOM Invader works by automatically parsing the DOM to look for occurrences of a predefined "canary" string. This is an arbitrary but distinct string of alphanumeric characters that you can inject into different sources to see which sinks they flow into.

＝DOM Invader は、**あらかじめ定義された「canary」文字列の出現箇所を探して DOM を自動的にパースする**ことで動作する。canary は**任意だが識別性の高い英数字列**で、いろいろな source に注入して、それがどの sink へ流れるかを見る。

現在追跡中の canary は **DOM ビューの左上**に表示される。canary は**任意のカスタム文字列に変更可能**（→ canary 設定）。

**canary を手動で source に注入する手順（原文4ステップ）**

1. ブラウザ DevTools の **DOM Invader** タブへ行く。
2. **DOM ビュー**にいることを確認する。
3. **Copy canary** をクリックする。追跡中の canary がクリップボードにコピーされる。
4. テストしたい入力（URLのクエリパラメータ、フォームフィールドなど）に canary を貼り付ける。

公式は「潜在的な source については Web Security Academy の DOM-based vulnerabilities トピックを見よ」と誘導している（`/web-security/dom-based/index.html`）。

#### 3.2 複数の source へ一括注入（Injecting a canary into multiple sources）

手動で複数箇所に貼る以外に、自動化する2つのボタンがある。

| ボタン | 原文の説明 | 日本語 |
| --- | --- | --- |
| **Inject URL params** | "Automatically injects the canary into every query parameter in the URL, using a separate tab for each parameter." | URL 内の**すべてのクエリパラメータ**に canary を自動注入する。**パラメータごとに別タブ**を使う |
| **Inject forms** | "Automatically injects the canary into any HTML form fields detected on the page. Note that you still need to submit the form manually for the injection to take effect." | ページ上で検出された**すべてのHTMLフォームフィールド**に canary を自動注入する。**注入を効かせるにはフォームを手動で送信する必要がある** |

**Note（原文）**

> Injecting the canary into all URL parameters and form fields at once may prevent the site from working properly. For the best results, we recommend testing one source at a time.

＝全URLパラメータ・全フォームフィールドに一度に注入すると**サイトが正常動作しなくなることがある**。最良の結果を得るには**一度に1つの source をテストする**ことを推奨。

#### 3.3 制御可能な sink の特定（Identifying controllable sinks）

canary を注入すると、DOM Invader は自動的に DOM をパースして **canary が現れる sink** を特定し、**「どれだけ面白いか（how interesting they are）」の順にソートして DOM ビューに表示**する。

#### 3.4 XSSコンテキストの判定（Determining the XSS context）

制御可能な sink を見つけたら、次は**注入したペイロードが現れるコンテキストを調べる**。判定すべき情報（原文3項目）：

- **HTML 実行 sink なのか JavaScript 実行 sink なのか。**
- **入力が、脱出しなければならない特殊文字（クォート、タグ、属性など）に囲まれているか。**
- **sink に到達する前にサイトがどんな検証（validation）・サニタイズ（sanitization）・その他の処理を行っているか。**

DOM Invader は **sink の内容（canary と、自分が注入した周囲の文字が DOM 上でどう見えるか）を表示する**。したがって **canary に特殊文字を付け足して、それがエスケープ／エンコードされているかを簡単に確認できる**（画像 `dom-invader-unescaped-chars.png` の例では「さまざまな有用な文字の注入に成功している」）。

sink の種類に応じて、さらに以下が表示される。

| 表示項目 | 原文 | 日本語 |
| --- | --- | --- |
| **Outer HTML** | "The HTML element that surrounds your canary." | canary を囲んでいる HTML 要素 |
| **Frame path** | "The frame in which your canary is passed to the sink." | canary が sink に渡されたフレーム（どの iframe か） |
| **Event** | "The JavaScript event that occurs when your canary is passed to the sink." | canary が sink に渡されたときに発生する JavaScript イベント |

これにより XSS コンテキストが一目で分かり、**どの文字・どのイベントが必要かをテストできる**。原文の例では「二重引用符で囲まれた文字列と、それを囲む `<span>` からのブレイクアウトに成功し、XSS の PoC を注入できた」とある（画像 `dom-invader-payload.png`）。

#### 3.5 クライアントサイドコードの調査（Studying the client-side code）＝ stack trace の見方

> When experimenting with different injections, you might find that your input suddenly stops flowing into the sink. This could be because you can only reach the sink via a specific code path, such as one branch of a conditional statement.

＝いろいろな注入を試していると、**急に入力が sink に流れなくなる**ことがある。これは、**条件分岐の特定のブランチなど、特定のコードパスを通らないと sink に到達しない**ためかもしれない。

DOM Invader は、**入力が sink に渡される「クライアントサイドコード上の地点」へ直接ジャンプ**できる。そこから手前のコードを読めば、**sink に到達するために入力が満たすべき条件**が分かる。

**該当行を表示する手順（原文4ステップ）**

1. **sink に確実に到達すると分かっているペイロードを注入する。**
2. DOM Invader の **DOM ビュー**で、**Stack Trace 列のリンク**をクリックする。これで**ブラウザのコンソールにスタックトレースが出力される**。
3. DevTools パネルで **Console** タブに切り替える。
4. スタックトレースの中の**一番上のリンク**をクリックする（リンクが1つしかない場合もある）。**Sources タブでクライアントサイド JavaScript が開き、入力が sink に渡される行にフォーカス**される。

---

### 4. web message 経由の DOM XSS テスト（出典: .../dom-invader/web-messages.html）

提供機能（原文3項目）：

1. **ページ上で `postMessage()` メソッドにより送信されたすべての web message を、有用な詳細情報つきでログする。** これは Burp Proxy が HTTP リクエスト／レスポンスの履歴を見せるのと同様。
2. **web message を改変して再送し、手動で DOM XSS を探れるようにする。** これは Burp Repeater が改変した HTTP リクエストを再発行するのと同様。
3. **DOM Invader が代わりに web message を自動で改変・送信して DOM XSS を探る。**

これらはすべて DOM Invader の **Messages ビュー**からアクセスする。

利用には **設定メニューで「Postmessage interception」を有効化する必要がある**（→ Main settings）。

公式は Web Security Academy の **"Controlling the web message source"**（`/web-security/dom-based/controlling-the-web-message-source/index.html`）へ誘導している。

#### 4.1 web message 傍受の有効化

対象サイトの機能を妨げないため、**web message 機能は既定で無効**。有効化手順（原文3ステップ）：

1. DOM Invader 設定メニューへ行く。
2. **Postmessage interception** スイッチを選択する。
3. **Reload** をクリックしてブラウザをリロードする（**変更反映に必須**）。

#### 4.2 興味深い web message の特定

有効化すると、**`postMessage()` でページ上を流れる web message が自動ログ**される。さらに**既定で、検出した message event handler に対して DOM Invader 自身が生成したメッセージを送る**。これらは **Messages ビュー**で見える。

#### 4.3 web message の自動解析（Automated web message analysis）

DOM Invader は既定で「興味深いメッセージ」を自動的に特定・フラグ付けする。そのために**メッセージを次の2通りに改変する**。

1. **メッセージの `data` プロパティ経由で canary を注入する。** これにより、DOM ビューでの他の source と同様に、**このデータが流れ込む sink を特定**できる。
2. **メッセージの origin を、期待されるドメイン名で「始まり、かつ終わる」偽の origin に置き換える。** これにより、**受信メッセージの origin 検証に不備のあるロジックや正規表現に依存しているイベントハンドラを自動的に特定**できる。

**Note：** どちらの機能も設定メニューから無効化できる（→ Web message settings）。

観測された挙動に基づき、DOM Invader は**悪用可能と判断したメッセージに「推定される Issue の Severity と Confidence（深刻度と確信度）」を表示してフラグを立てる**。ページ上で送信されたすべてのメッセージは、**少なくとも Information の Severity** で列挙される（自動検出できない脆弱性を含む可能性があるため）。

#### 4.4 メッセージの詳細（Message details）

各メッセージをクリックすると詳細が見られ、**クライアントサイド JavaScript が `origin` / `data` / `source` のどのプロパティにアクセスしたか**が分かる。

| プロパティ | 原文の要点 | 日本語の読み方 |
| --- | --- | --- |
| **origin accessed** | "If the client-side code never accesses the `origin` property of the message, it is likely that the origin is not being validated. As a result, you may be able to send cross-origin messages to the event handler from an arbitrary external domain." / "However, even messages in which the client-side code does access the `origin` property may still be insecure. You may still be able to bypass the validation." | クライアントコードが `origin` に**一度もアクセスしていない**なら、**origin 検証がされていない可能性が高い**＝任意の外部ドメインからクロスオリジンでイベントハンドラにメッセージを送れるかもしれない。逆に `origin` にアクセスしていても**安全とは限らない**（検証をバイパスできる可能性がある）。バイパス方法の手がかりとして DOM Invader は**スタックトレース経由で該当コード行へのリンク**を提供する（→ 「Studying the client-side code」）。参考：Web Security Academy "Bypassing flawed origin validation"（`/web-security/cors/index.html#errors-parsing-origin-headers`） |
| **data accessed** | "The `data` property of the message is where you inject potential payloads. If the JavaScript never accesses this property, it cannot be passed to a sink. In this case, the message is of no interest." | `data` は**ペイロードを注入する場所**。JavaScript がこのプロパティにアクセスしないなら **sink に渡されようがない**＝そのメッセージは**無価値** |
| **source accessed** | "The `source` property of the message is a reference to the `window` object from which it was sent. In practice, this is usually a reference to an iframe. Websites often validate the `source` property instead of the origin as this is a more robust way of ensuring that the message came from a specific, trusted iframe." / "As with the origin, keep in mind that client-side code accessing this property does not guarantee that the source is being validated, or that this validation cannot be bypassed." | `source` は**送信元の `window` オブジェクトへの参照**。実務上はたいてい iframe への参照。サイトは origin の代わりに `source` を検証することが多い（特定の信頼された iframe から来たことを保証する、より堅牢な方法だから）。ただし origin と同様、**アクセスしている＝検証している、とは限らない**し、検証をバイパスできないとも限らない |

#### 4.5 web message の再送（Replaying web messages）

Burp Repeater と同様に、web message を**改変して再送**できる。手順（原文3ステップ）：

1. **Messages** ビューで任意のメッセージをクリックし、メッセージ詳細ダイアログを開く。
2. **Data** フィールドを必要に応じて編集する。
3. **Send** をクリックする。

原文の例：「origin を検証せず data を `element.innerHTML` sink に渡すメッセージを見つけたとする。その場合、`<`, `>`, `"` といった文字がエスケープされるかをテストするメッセージを送り、それらの文字を使って PoC ペイロードを作って送ればよい。」

#### 4.6 PoC の生成（Generating a proof of concept）

web message による悪用可能な脆弱性を特定できたら、**レポートに載せられる HTML の PoC を DOM Invader が生成できる**。手順（原文3ステップ）：

1. 脆弱なメッセージを選択してメッセージ詳細ダイアログを開く。
2. エクスプロイトに必要な値を修正する。
3. **Build PoC** をクリックする。**HTML がクリップボードに保存される。**

---

### 5. クライアントサイド prototype pollution のテスト（出典: .../dom-invader/prototype-pollution.html）

主要タスク（原文3項目）：

1. **URL および web message で送られる JSON オブジェクトの中から、prototype pollution の source を自動検出する。** これには**同じ source を使う代替テクニックの検出**も含まれる。
2. **発見した source を使って `Object.prototype` を汚染し、PoC を生成する。** その後**ブラウザコンソールで手動検証**できる。
3. **エクスプロイト作成に使える gadget 候補をスキャンする。**

#### 5.1 有効化

対象サイトの機能を妨げないため**既定で無効**。手順（原文3ステップ）：

1. DOM Invader 設定メニューへ行く。
2. **Attack types** の下で、**「Prototype pollution is on」**になるようトグルする。
3. **Reload** をクリックしてブラウザを更新する（**変更反映に必須**）。

以後、ブラウジング中に prototype pollution の source をスキャンするようになる。

#### 5.2 source の検出

有効化すると、**`Object.prototype` に任意のプロパティを追加できる source をページ上から自動チェック**する。見つかった source は、有用な情報と追加テスト用の機能とともに **DOM ビュー**に表示される。

原文の例：「この例では、DOM Invader は **`location.hash` source を使って `Object.prototype` を汚染する2つの潜在的テクニック**を特定した。」

#### 5.3 source の手動確認（Test ボタン）

手順（原文5ステップ）：

1. **DOM ビュー**で、該当 source の隣の **Test** ボタンをクリックする。DOM Invader が**新しいタブを開き、選択した source を使って `Object.prototype` に任意のプロパティを追加する**。
2. 新しいタブでブラウザコンソールを開く。**DOM Invader が自動的に `Object.prototype` を出力している**ことを確認する。
3. ノードを展開して、このオブジェクトに PoC の **`testproperty`** が含まれることを確認する。
4. コンソールで新しいオブジェクトを作る。
5. 新しいオブジェクトがプロトタイプチェーン経由で `testproperty` を継承していることを確認する。

##### コード/コマンド（原文のまま逐語）

```
let myObject = {};
```

```
console.log(myObject.testproperty);
// Output: 'DOM_INVADER_PP_POC'
```

＝PoC 値は **`DOM_INVADER_PP_POC`**。

#### 5.4 gadget スキャン（Scanning for prototype pollution gadgets）

> A prototype pollution source is of no use unless you also have access to a "gadget" property. This is any user-controllable property that is passed to a sink without being properly sanitized. Finding such a gadget manually is extremely tedious, but DOM Invader can automate this process.

＝prototype pollution の source は、**「gadget」プロパティにもアクセスできなければ無意味**。gadget とは、**適切にサニタイズされずに sink に渡される、ユーザ制御可能な任意のプロパティ**。手動探索は極めて退屈だが、DOM Invader が自動化できる。

手順（原文2ステップ）：

1. **DOM ビュー**で、DOM Invader が見つけた prototype pollution source の隣の **Scan for gadgets** ボタンをクリックする。**新しいタブが開き、適合する gadget のスキャンが始まる。**
2. **同じタブ**で DevTools の **DOM Invader** タブを開く。スキャンが終わると、**DOM ビューに、特定した gadget 経由でアクセスできた sink が表示**される。原文の例では **`html` という gadget プロパティが `innerHTML` sink に渡された**。

#### 5.5 PoC エクスプロイトの生成

gadget が見つかると、DOM Invader は **source + gadget + sink を組み合わせて XSS を確認する PoC を自動生成**できる。**発見された sink の隣の Exploit ボタンをクリックするだけ**で、DOM Invader が新しいウィンドウを開き、**`alert()` の呼び出しに成功する**。

---

### 6. DOM clobbering のテスト（出典: .../dom-invader/dom-clobbering.html）

> DOM Invader can automatically test for DOM clobbering vulnerabilities on your behalf. DOM clobbering is a technique in which you inject HTML into a page to manipulate the DOM in a way that enables you to change the behavior of JavaScript on the page.

＝DOM clobbering は、**ページに HTML を注入して DOM を操作し、そのページの JavaScript の振る舞いを変えるテクニック**。DOM Invader はこれを自動テストできる。

参考：Web Security Academy の DOM clobbering トピック（`/web-security/dom-based/dom-clobbering/index.html`）に解説と、意図的に脆弱なラボがある。

**有効化手順（原文3ステップ）**：対象サイトの機能を妨げないため**既定で無効**。

1. DOM Invader 設定メニューへ行く。
2. **Attack types** の下で、**DOM clobbering** が on になるようトグルする。
3. **Reload** をクリックしてブラウザを更新する（**変更反映に必須**）。

以後、ブラウジング中に DOM clobbering 脆弱性をスキャンするようになる。

---

### 7. 設定（トップ）（出典: .../dom-invader/settings/index.html）

> Testing for DOM-based vulnerabilities can cause side-effects that prevent the website you're testing from working correctly. DOM Invader is highly configurable, ensuring that you can fine-tune its behavior to achieve the best results.

＝DOM ベース脆弱性のテストは、**対象サイトが正しく動かなくなる副作用**を引き起こしうる。DOM Invader は高度に設定可能で、最良の結果のために挙動を微調整できる。

**設定メニューへのアクセス方法（全設定ページ共通）**：

> To access the DOM Invader settings menu, click the Burp Suite logo in the upper-right corner of the browser, then switch to the **DOM Invader** tab.

＝ブラウザ**右上の Burp Suite ロゴ**をクリックし、**DOM Invader** タブに切り替える。

**設定カテゴリ（4つ）**

| カテゴリ | 内容 |
| --- | --- |
| **Main settings** | Enable DOM Invader / Postmessage interception / sources と sinks のカスタマイズ |
| **Attack types** | Prototype pollution / DOM clobbering（配下に Web message settings、Prototype pollution settings） |
| **Misc settings** | スタックトレースによるメッセージフィルタ、自動イベント発火、リダイレクト防止、リダイレクト前ブレークポイント、全 source への canary 注入、コールバック設定、Permissions-Policy 除去 |
| **Canary settings** | canary のコピー・変更・ランダム化 |

---

### 8. Main settings（出典: .../dom-invader/settings/main.html）

#### 8.1 Enable DOM Invader

> This is the global toggle for enabling DOM Invader. DOM Invader is disabled by default as some of its features may interfere with the target website's functionality in a way that impacts your other testing activities. When enabled, you can access DOM Invader from its tab in the browser's DevTools panel.

＝**DOM Invader 全体のグローバルトグル**。既定で無効（一部機能が対象サイトの機能に干渉して他のテストに影響しうるため）。有効化すると DevTools の DOM Invader タブからアクセスできる。

#### 8.2 Postmessage interception

有効にすると、DevTools の **Messages ビュー**でサイトの web message における DOM XSS をテストできる。さらに細かいサブ設定がある（→ Web message settings）。

#### 8.3 sources と sinks のカスタマイズ（Customizing sources and sinks）

> To open the sources and sink settings, click the cog icon next to the main DOM Invader switch. From here, you can control which sources and sinks DOM Invader instruments. **By default, all sources are hidden and only the most interesting sinks are instrumented.**

＝メインの DOM Invader スイッチの隣の**歯車（cog）アイコン**をクリックすると sources / sinks 設定が開く。ここで**どの source と sink を DOM Invader が計装（instrument）するか**を制御できる。**既定では、すべての source は非表示で、最も興味深い sink のみが計装される。**

> You might want to disable instrumentation of a particular sink if it is preventing the site from working correctly. For example, instrumenting `eval()` can change its behavior and break the related functionality.

＝サイトが正しく動かなくなる場合は、**特定の sink の計装を無効化**するとよい。例えば **`eval()` を計装するとその挙動が変わり、関連機能が壊れることがある。**

〔補足（一般知識・拡張UIの実物から確認）〕拡張 v1.6.9 の設定画面には **Sinks / Sources / Messages の3タブ**があり、Sinks タブには **None / All / Interesting / Reset / Save**、Sources タブには **None / All / Reset / Save** のボタンが存在する。既定の「Interesting」が上記の「最も興味深い sink のみ」に対応する。

---

### 9. Attack types（出典: .../dom-invader/settings/attack-types.html）

> By default, DOM Invader automatically probes for ordinary DOM XSS sources and sinks, but you can optionally configure DOM Invader to attempt other attacks.

＝既定では**通常の DOM XSS の source / sink のみ**を自動で探る。オプションで他の攻撃も試すよう設定できる。

| 設定 | 内容 |
| --- | --- |
| **Prototype pollution** | 有効にすると、通常の DOM XSS source/sink に**加えて**、クライアントサイド prototype pollution の source を自動特定しようとする。隣の**歯車アイコン**から微調整用の追加設定にアクセスできる（→ Prototype pollution settings） |
| **DOM clobbering** | 有効にすると、DOM clobbering 脆弱性を自動特定しようとする |

〔補足（二次情報：JaewoongMoon 氏のブログ）〕**Prototype pollution と DOM clobbering はトグル動作で、一方をチェックするともう一方のチェックが外れる**（同時には使えない）との記述がある。※公式ドキュメントには明記なし。

---

### 10. Web message settings（出典: .../dom-invader/settings/web-messages.html）

**Postmessage interception** の隣の**歯車アイコン**から開く。

| 設定 | 原文の要点 | 日本語 |
| --- | --- | --- |
| **Postmessage origin spoofing** | "DOM Invader automatically replaces the origin of any messages with a fake origin that both starts and ends with the domain name of the true origin." / "For example, some websites use the `startsWith()` or `endsWith()` methods to verify the domain name in the origin. This kind of validation can be easily bypassed using these techniques." | 有効にすると、**メッセージの origin を「本物の origin のドメイン名で始まり、かつ終わる」偽の origin に自動置換**する。これにより、origin 検証に不備のあるロジック／正規表現に依存するハンドラを自動特定できる。例：**`startsWith()` や `endsWith()` でドメイン名を検証**しているサイトは、この種のテクニックで簡単にバイパスできる。**Note:** この設定が無効でも、**メッセージ再送時に「Spoof origin」チェックボックス**を選べば個別に origin を偽装できる。あるいは**提供されたフィールドで origin を手動編集**できる |
| **Canary injection into intercepted messages** | "DOM Invader automatically injects the canary into the `data` property of any messages that are sent on the page. DOM Invader determines whether the expected data is a JSON string, JSON object, or plain string, then injects the canary using the correct format." | 有効にすると、ページ上で送られるメッセージの **`data` プロパティに canary を自動注入**する。**期待されるデータが JSON文字列 / JSONオブジェクト / プレーン文字列のどれかを判定し、正しい形式で注入**する。メッセージ詳細では **Show ドロップダウン**で「ページが実際に送った元データ」と「自動注入を含むデータ」を切り替えられる |
| **Filter messages with duplicate values** | "DOM Invader groups identical messages together to reduce noise." | 有効にすると**同一メッセージをグループ化してノイズを減らす**。「メッセージが実際に送られているか確かめたい」など、1件ずつ見たい場合は無効にする |
| **Generate automated messages** | "DOM Invader generates and sends its own messages to any message event listeners that it identifies on the page." / "DOM Invader attempts to infer information about the structure of the data that each event handler is expecting." / "Based on how the listener handles each message, DOM Invader is able to generate follow-up messages that are tailored to hit additional code paths, which can potentially lead to more dangerous sinks." | 有効にすると、ページ上で特定した**すべての message event listener に対して DOM Invader が自作メッセージを生成・送信**する。**通常のページ操作では message イベントを発火させられない**が脆弱かもしれないハンドラをテストしたいときに有用。各ハンドラが**期待するデータ構造を推測**して適切なメッセージを生成し、**リスナーの処理のされ方に応じて追加のコードパスに到達する追跡メッセージを生成**する（より危険な sink に至る可能性）。**Note:** DOM Invader が生成したメッセージは **Messages ビューで数値 ID を持たない**ことで見分けられる |
| **Detect cross-domain leaks** | "DOM Invader reports when the current page sends a web message containing data from the URL to a different origin. In this case, an attacker can potentially steal sensitive data such as OAuth tokens by embedding the affected page in an `iframe`, along with an event listener that extracts the data." | 有効にすると、**現在のページが URL 由来のデータを含む web message を別オリジンへ送信した場合に報告**する。攻撃者は当該ページを **`iframe` に埋め込み、データを抽出するイベントリスナーを併用**することで、**OAuth トークンなどの機密データを窃取**できる可能性がある |

---

### 11. Prototype pollution settings（出典: .../dom-invader/settings/prototype-pollution.html）

**Prototype pollution** の隣の**歯車アイコン**から開く。

| 設定 | 既定 | 内容（原文要点の日本語化） |
| --- | --- | --- |
| **Scan for gadgets** | on | 有効にすると、**ページロードのたびに gadget を自動スキャン**する。特定の source を使った gadget スキャンとは別に、**source がまだ見つかっていない場合の代替手段**として有用。「将来悪用されうる gadget が自サイトに無いことを確認する」用途にも使える。※この設定を入れると **DOM Invader が残りの prototype pollution 設定を自動調整**する（必要なら手動で上書き可能） |
| **Auto-scale amount of properties per frame** | on | 既定では **gadget スキャン時に1フレームあたりで使うプロパティ数を自動スケール**する。性能は改善するが **gadget を見逃す**ことがある（注入したプロパティが例外を起こし、同じ iframe 内の他の gadget をテストできなくなる＝**偽陰性**）。無効にして**スライダーで固定上限を設定**できる。**上限を下げるとスキャンは遅くなるが見逃しが減り、上げると逆になる** |
| **Scan nested properties** | on | 既定では**他のプロパティに入れ子になったプロパティも再帰的にスキャン**する。無効にすると**各オブジェクトのトップレベルプロパティのみ**をスキャンする |
| **Query string injection** | on | 既定では**クエリ文字列のパラメータ**を使って prototype pollution をテストする。サイトが正常動作しない場合は無効化が必要なことがある |
| **Hash injection** | on | 既定では **URL の hash（フラグメント）部分**を使ってテストする。同上 |
| **JSON injection** | on | 既定では **JSON ベースの web message を注入**してテストする。同上 |
| **Verify onload** | on | 既定では**ページのロード完了を待ってから** prototype pollution を報告する（特定した gadget が最終的な DOM にまだ存在することを保証するため）。無効にすると**見つけ次第すぐ報告**する＝スキャン時間は短縮できるが**偽陽性**が出うる（例：`constructor` や `__proto__` プロパティを使った gadget を特定しても、ロード完了までにサニタイズされているかもしれない） |
| **Remove CSP header** | off | 有効にすると、**すべてのレスポンスから `Content-Security-Policy` ヘッダを除去**する。CSP が XSS ベクタをブロックするのを防ぎ、また **gadget スキャンに必要な iframe** がブロックされるのも防ぐ |
| **Remove X-Frame-Options header** | off | 有効にすると、**すべてのレスポンスから `X-Frame-Options` ヘッダを除去**する。**gadget スキャンに必要な iframe** がブロックされるのを防ぐ |
| **Scan each technique in separate frame** | off | 性能上の理由から、既定では**トップフレーム**で prototype pollution をスキャンする。しかし**複数のテクニックが互いに干渉**して脆弱性を見逃すことがある。原文の例：**「`__proto__` と `constructor` を同時に試すと、`constructor` 単独なら動くサイトでも失敗する」**。有効にすると**テクニックごとに別の iframe**を使う。わずかな性能劣化と引き換えに**各テクニックが独立にテストされ、偽陰性が減る** |

#### 11.1 nested properties の例（原文のまま逐語）

```
const user = {
    id: 1337,
    name: "carlos",
    contactInfo: {
        email: "carlos@ginandjuice.shop",
        phone: 0161133713371
    }
}
```

既定では DOM Invader はこの `user` オブジェクトの**全プロパティ**をテストする。**Scan nested properties を無効にすると、`user.contactInfo.email` と `user.contactInfo.phone` の両方がスキップされる。**

#### 11.2 prototype pollution テクニックの無効化（Disabling prototype pollution techniques）

> DOM Invader uses a number of different techniques for prototype pollution. You may find that using all of these techniques at once prevents the attack from working on certain sites. For this reason, you may prefer to disable some of the techniques or use one technique at a time.

＝DOM Invader は複数のテクニックを使う。**全部を一度に使うと、特定のサイトでは攻撃が成立しない**ことがあるため、**一部を無効化する／一度に1テクニックだけ使う**方がよい場合がある。

**手順（原文4ステップ）**

1. DOM Invader 設定メニューの **Attack types** の下で、**Prototype pollution** スイッチの隣の**歯車アイコン**をクリックする。
2. ダイアログで **Techniques** ボタンをクリックする。
3. スイッチで必要に応じてテクニックを有効／無効にする。
4. **Save** をクリックし、次に **Reload** をクリックしてブラウザを更新する（**変更反映に必須**）。

〔補足（拡張UIの実物から確認）〕設定画面には **"Techniques configuration"** ダイアログがあり、**None / Reset / Save** ボタンを備える。また **"Amount of properties to scan per iframe"** のスライダーには **"Slower more accurate" ←→ "Faster less accurate"** というラベルが付いている。

---

### 12. Misc settings（出典: .../dom-invader/settings/misc.html）

| 設定 | 内容（原文要点の日本語化） |
| --- | --- |
| **Message filtering by stack trace** | 大量のメッセージを発生させるサイトではノイズでテストが困難になる。有効にすると、**各エントリのスタックトレースを比較し、既存エントリと同じコード位置を指すものを隠す** |
| **Auto-fire events** | 有効にすると、**ページロード直後に全要素へ click と mouseover イベントを自動発火**する。注入ペイロードが**これらのイベント発生時にしか sink に到達しない**場合に有用 |
| **Redirection prevention** | クライアントサイドリダイレクトが起きると、**DOM Invader が見つけた source / sink がクリアされ、新しいページのものに更新されてしまう**ためテストの妨げになる。有効にすると**クライアントサイドリダイレクトをブロックして同じページに留まる**。ただし **`javascript:` URL へのリダイレクト**と、**Inject URL ボタンが開始したリダイレクト**は通常どおり動作する |
| **Add breakpoint before redirect** | リダイレクトを丸ごとブロックする代わりに、**リダイレクトを引き起こすコードの直前にブレークポイントを設定**する。**これは Chrome の標準 DevTools では現状不可能**。ブレークポイントにより、**DevTools のコールスタックでリダイレクトがどこで起きているかを確認**でき、デバッグに有用 |
| **Inject canary into all sources** | 有効にすると、**ページ上で特定したすべての source に canary を自動注入**する。**source ごとに固有の文字列を canary に付加**するので、**どの source がどの sink に流れたかを容易に識別**できる。ただし実際には「どこにでも注入する」とサイトが正常動作しなくなりがち。**歯車アイコン**から次の調整ができる：(1) **特定の source を無効化**して DOM Invader にスキップさせる（問題のある source を段階的に排除する、あるいは特定の source に集中する。毎回手でペーストする手間が省ける）、(2) **canary を注入する特定パラメータをカンマ区切りリストで指定**する |
| **Configuring callbacks** | **source / sink / web message を特定したときに実行するカスタムコールバック関数**を設定できる。自作するか、既定のもの（結果をコンソールにログ出力して**エクスポート**できる）を使う。別の有用な例として、**制御可能な sink を特定したときにスクリプト実行を一時停止する `debugger` 文を含むコールバック**を書けば、**コールスタックを調査**できる |
| **Remove Permissions-Policy header** | 有効にすると、レスポンスに **`Permissions-Policy` ヘッダがあれば自動的に除去**する。一部サイトは `Permissions-Policy` ヘッダで **同期XHR（synchronous XHR）** など **DOM Invader の機能に必須の機能をブロックするディレクティブ**を設定している。その場合 **DOM Invader はコンソールで通知し、この設定を有効にするよう促す** |

#### 12.1 既定コールバックの有効化手順（原文7ステップ）

1. DOM Invader 設定メニューで、メインの DOM Invader スイッチの隣の**歯車アイコン**をクリックして sources / sinks 設定を開く。
2. 結果の種類に応じて **Sources** / **Sinks** / **Messages** タブを選ぶ。
3. **Callback configuration** ボタンをクリックして、DOM Invader の既定のコールバック関数を表示する。**初期状態では非アクティブ。**
4. **スクリプトが入っているテキストフィールドをクリックしてアクティブ化**する。
5. スクリプトをそのままにするか、必要な変更を加えて **Save** をクリックする。
6. **Reload** をクリックしてブラウザを更新する（**変更反映に必須**）。
7. 通常どおり DOM Invader を使い、コールバックが期待どおり動作するか確認する。

〔補足（拡張UIの実物から確認）〕コールバック設定ダイアログには **"This is for advanced users only. Please ensure this is valid JavaScript."**（上級者専用。有効な JavaScript であることを確認してください）という警告が表示され、**Sink callback / Source callback / Message callback** の3種がある。各ダイアログに **Close / Reset / Save** ボタンがある。

---

### 13. Canary settings（出典: .../dom-invader/settings/canary.html）

> From the DOM Invader settings menu, you can modify and update the canary string that DOM Invader injects into the target site.

設定メニューの**最下部**に、**現在追跡中の canary 文字列**が表示される。

| 操作 | 内容 |
| --- | --- |
| **Copying the canary** | **Copy** をクリックすると現在の canary 文字列がクリップボードにコピーされる。**手動で各 source に注入する**のに便利 |
| **Changing the canary** | ランダム生成された既定の canary を**いつでも独自のカスタム文字列に置き換え**られる |

**canary 変更手順（原文3ステップ）**

1. 既定の canary に代えて使いたい文字列を入力する。あるいは **Randomize** をクリックして新しいランダム文字列を生成する。
2. **Update canary** をクリックする。
3. **Reload** をクリックしてブラウザを更新する（**変更反映に必須**）。以後 DOM Invader は新しい canary 文字列を追跡する。

**Note（原文）**

> To avoid false positives, make sure that the string you use doesn't occur naturally on the page.

＝**偽陽性を避けるため、ページ上に自然に出現しない文字列**を使うこと。

---

### 14. 拡張機能UIの実物（DOM Invader パネル／設定画面の文言一覧）

出典：Burp 同梱の Chromium 拡張 `burp-chromium-extension`（manifest: `"name": "Burp Suite", "version": "1.6.9", "description": "Burp Suite Chromium Extension which contains DOM Invader and the Burp Suite Navigation recorder."`）。※やや古い版のため、公式ドキュメントに載っている最新項目（DOM clobbering、Detect cross-domain leaks、Remove Permissions-Policy header 等）は含まれない。**教科書では「UI上の実文言の一例」として扱うこと。**

#### 14.1 Augmented DOM パネル（`panels/augmented-dom.html` の可視テキスト）

```
DOM Invader Augmented DOM
Feature disabled.
Use the DOM Invader settings, in the top right, to enable Augmented DOM.
View documentation
In order for changed settings to take effect, you must reload your browser.
DOM Invader
Search
Search for Canary
Inject URL
Inject forms
Copy canary
Clear all
Sinks (0)
Sources (0)
```

要素ID：`featureAlert, initialMsg, reloadMessage, reloadDevToolsLink, keywords, searchBtn, searchCanaryBtn, injectCanaryBtn, injectFormsCanaryBtn, copyCanaryBtn, clearButton, dataDisplay, warningMsg, sinkTree, sourceTree`

→ パネルは **sink ツリーと source ツリーの2本立て**（`sinkTree` / `sourceTree`）で、それぞれ件数が表示される。**Search**（任意キーワード検索）と **Search for Canary**（canary 検索）が分かれている点に注意。〔補足〕公式ドキュメントが「DOM view」と呼ぶものが、この「Augmented DOM」パネルにあたる（**Inject URL params** は旧UIでは **Inject URL**）。

#### 14.2 設定画面（`settings/settings.html` の可視テキスト・トグル文言）

```
Settings
Sinks / Sources / Messages
Show/hide sinks
Show/hide sources
Messages configuration
None / All / Interesting / Reset / Save          （Sinks タブ）
None / All / Reset / Save                        （Sources タブ）
Sinks callback configuration
This is for advanced users only. Please ensure this is valid JavaScript.
Sink callback
Sources callback configuration
Source callback
Messages callback configuration
Message callback

DOMInvader is on
Postmessage interception is off
Postmessage origin spoofing is off
Canary injection into intercepted messages is off
Filter messages with duplicate values is off
Generate automated messages is off
Message filtering by stack trace is off
Auto fire events are off
Redirection prevention is off
Add breakpoint before redirect is off

Techniques configuration
Prototype pollution configuration
Scan for gadgets is on
Amount of properties to scan per iframe
Slower more accurate  <-->  Faster less accurate
Auto scale amount of properties per frame is on
Scan nested properties is on
Query string injection is on
Hash injection is on
JSON injection is on
Verify onload is on
Remove CSP header is off
Remove X-Frame-Options header is off
Scan each technique in separate frame is off
Techniques / Reset / Save
Prototype pollution is off

Inject into sources configuration
Inject canary into all sources is off

Update canary
In order for changed settings to take effect, you must reload your browser.
Reload
Open devtools to use the extension. A DOM Invader tab has been added to devtools.
```

→ **各設定のデフォルト状態（is on / is off）がそのまま読める**点が重要。既定で **on** なのは「DOMInvader（この個体では有効化済み）」「Scan for gadgets」「Auto scale amount of properties per frame」「Scan nested properties」「Query string injection」「Hash injection」「JSON injection」「Verify onload」。既定で **off** なのは「Postmessage interception」「Postmessage origin spoofing」「Canary injection into intercepted messages」「Filter messages with duplicate values」「Generate automated messages」「Message filtering by stack trace」「Auto fire events」「Redirection prevention」「Add breakpoint before redirect」「Remove CSP header」「Remove X-Frame-Options header」「Scan each technique in separate frame」「Prototype pollution」「Inject canary into all sources」。

また、コンテンツスクリプトの構成（manifest より逐語）：

```
"content_scripts": [
    {
      "run_at": "document_start",
      "matches": ["http://*/*", "https://*/*"],        
      "js": [
        "./dom-invader-extension/content-scripts/read-settings.js",
        "./dom-invader-extension/content-scripts/connection.js",
        "./dom-invader-extension/content-scripts/postmessage.js",
        "./dom-invader-extension/content-scripts/augmented-dom.js",
        "./navigation-recorder/content-scripts/classes/Recorder.js"
      ],
      "all_frames": true,
      "match_about_blank": false
    }
],
"devtools_page": "./dom-invader-extension/devtools/devtools.html",
```

→ **`document_start` で、すべてのフレーム（`all_frames: true`）に注入**される。これが「フレーム単位で source/sink が見える（Frame path 列）」仕組みの土台。

---

### 15. DOM Invader が追跡する source / sink の一覧（出典: PortSwigger 公式ブログ "Introducing DOM Invader" の翻訳ミラー）

> 出典の注意：以下は PortSwigger 公式ブログ `https://portswigger.net/blog/introducing-dom-invader` に掲載されたコードを、中国語翻訳記事（`izj007/wechat` リポジトリ内のミラー）経由で入手したもの。**2021年7月時点の内容**であり、現行版では増減している可能性がある。それでも「DOM Invader が何を sink とみなし、どの順で重要度を付けているか」の**一次に近い資料**として価値が高い。

#### 15.1 Sources（原文のまま逐語）

```javascript
const sourcesList = [
    "location",
    "location.href",
    "location.hash",
    "location.search",
    "location.pathname",
    "document.URL",
    "window.name",
    "document.referrer",
    "document.documentURI",
    "document.baseURI",
    "document.cookie"
];
```

#### 15.2 Sinks（ランキング付き・原文のまま逐語）

数値が小さいほど「面白い（＝危険度が高い）」sink として上位に表示される。

```javascript
const sinkRanking = {
    "jQuery.globalEval":1,
    "eval":2,
    "Function":3,
    "execScript":4,
    "setTimeout":5,
    "setInterval":6,
    "setImmediate":7,
    "msSetImmediate":7,
    "script.src":8,
    "script.textContent":9,
    "script.text":10,
    "script.innerText":11,
    "script.innerHTML":12,
    "script.appendChild":13,
    "script.append":14,
    "document.write": 15,
    "document.writeln": 16,
    "jQuery":17,
    "jQuery.$":18,
    "jQuery.constructor":19,
    "jQuery.parseHTML":20,
    "jQuery.has":20,
    "jQuery.init":20,
    "jQuery.index":20,
    "jQuery.add": 20,
    "jQuery.append": 20,
    "jQuery.appendTo": 20,
    "jQuery.after": 20,
    "jQuery.insertAfter": 20,
    "jQuery.before": 20,
    "jQuery.insertBefore": 20,
    "jQuery.html": 20,
    "jQuery.prepend": 20,
    "jQuery.prependTo": 20,
    "jQuery.replaceWith": 20,
    "jQuery.replaceAll": 20,
    "jQuery.wrap": 20,
    "jQuery.wrapAll": 20,
    "jQuery.wrapInner": 20,
    "jQuery.prop.innerHTML": 20,
    "jQuery.prop.outerHTML": 20,
    "element.innerHTML":21,
    "element.outerHTML":22,
    "element.insertAdjacentHTML":23,
    "iframe.srcdoc": 24,
    "location.href":25,
    "location.replace":26,
    "location.assign":27,
    "location":28,
    "window.open":29,
    "iframe.src":30,
    "javascriptURL":31,
    "jQuery.attr.onclick":32,
    "jQuery.attr.onmouseover":32,
    "jQuery.attr.onmousedown":32,
    "jQuery.attr.onmouseup":32,
    "jQuery.attr.onkeydown":32,
    "jQuery.attr.onkeypress":32,
    "jQuery.attr.onkeyup":32,
    "element.setAttribute.onclick":33,
    "element.setAttribute.onmouseover":33,
    "element.setAttribute.onmousedown":33,
    "element.setAttribute.onmouseup":33,
    "element.setAttribute.onkeydown":33,
    "element.setAttribute.onkeypress":33,
    "element.setAttribute.onkeyup":33,
    "createContextualFragment":34,
    "document.implementation.createHTMLDocument": 35,
    "xhr.open":36,
    "xhr.send": 36,
    "fetch": 36,
    "fetch.body": 36,
    "xhr.setRequestHeader.name": 37,
    "xhr.setRequestHeader.value": 38,
    "jQuery.attr.href":39,
    "jQuery.attr.src":40,
    "jQuery.attr.data":41,
    "jQuery.attr.action":42,
    "jQuery.attr.formaction":43,
    "jQuery.prop.href":44,
    "jQuery.prop.src":45,
    "jQuery.prop.data":46,
    "jQuery.prop.action":47,
    "jQuery.prop.formaction":48,
    "form.action":49,
    "input.formaction":50,
    "button.formaction":51,
    "button.value": 52,
    "element.setAttribute.href":53,
    "element.setAttribute.src":54,
    "element.setAttribute.data":55,
    "element.setAttribute.action":56,
    "element.setAttribute.formaction":57,
    "webdatabase.executeSql": 58,
    "document.domain":59,
    "history.pushState":60,
    "history.replaceState":61,
    "xhr.setRequestHeader":62,
    "websocket":63,
    "anchor.href":64,
    "anchor.target": 65,
    "JSON.parse": 66,
    "document.cookie":67,
    "localStorage.setItem.name": 68,
    "localStorage.setItem.value": 69,
    "sessionStorage.setItem.name": 70,
    "sessionStorage.setItem.value": 71,
    "element.outerText": 72,
    "element.innerText": 73,
    "element.textContent": 74,
    "element.style.cssText": 75,
    "RegExp":76,
    "window.name":77,
    "location.pathname": 78,
    "location.protocol": 79,
    "location.host": 80,
    "location.hostname": 81,
    "location.hash": 82,
    "location.search": 83,
    "input.value": 84,
    "input.type": 85,
    "document.evaluate": 86
};
```

#### 15.3 同ブログの Augmented DOM に関する記述（翻訳ミラー経由の要旨）

- Burp の内蔵ブラウザで DevTools を開くと **`Augmented DOM` タブ**が現れ、**canary 値を含む source と sink**、および**利用可能なすべての source / sink のツリービュー**が表示される。
- 興味深い sink を見つけたら、**そこに含まれる値と「スタックトレース」を見られ、canary がハイライト表示**される。Augmented DOM により、**自分のカスタム canary 値が正しくエンコードされているかも検査できる**。
- その他の便利な機能として、**sink に送られた値の検索**と、**URL パラメータ／フォーム要素への canary の自動注入**がある。
- **source** ＝ ユーザ制御可能な入力を許す任意の JavaScript オブジェクト（例：`location.search`）。**sink** ＝ JavaScript/HTML の実行を許す任意の関数やセッター（例：`eval`, `document.write`）。
- DOM Invader は **sink をソートして、最も価値の高い sink を先頭に並べる**。
- **既定ではランダムな canary** を使うが、**任意の値にカスタマイズできる**。
- 必要バージョン：**Burp Suite Professional / Community 2021.7 以降**（ブログ執筆時点）。

---

### 16. 実務運用のコツ（二次情報・明示）

> 以下は公式ドキュメントではなく、第三者のノート（HackTricks、中国語 SecNote、韓国語ブログ）由来。教科書に載せる場合は「コミュニティの慣行」として明示すること。

- **推奨初期設定（SecNote `wjch611/SecNote` より）**：
  1. 「DOM invader is on」を入れる。sink は **Interesting** のままでよい。**source は `window.name` を有効にしない**。
  2. **Misc の「Auto fire events」を on** にする。
  3. **その他は全部 off**。
  - **自動テスト**：「Inject canary into all sources is on」（**既定では入れないこと。ページに影響が出る**）→ リロード → F12 → **Inject URL params**。
  - **手動テスト**：canary をコピーし、注入したい箇所に貼り付け → リロード。
- **韓国語ブログ（JaewoongMoon）より**：「Inject canary into all sources」を on にするとページロードでエラーが出ることがある。その場合は**いったん off でページを読み込み、その後に on にしてから機能を操作する**。
- **HackTricks より（コミュニティの運用ノート）**：
  - **空の canary で検索**すると、悪用可能性に関係なく**すべての sink を洗い出せる**（偵察に有効）。
  - `test` のような**ありふれた文字列を canary にしない**（偽陽性の原因）。
  - ページ機能を壊す場合は **`eval` や `innerHTML` など重い sink の計装を一時的に無効化**する。
  - **source/sink はブラウジングコンテキスト（フレーム）単位で表示**されるため、iframe 内の脆弱性は手動でフォーカスが必要なことがある。
  - Burp Repeater / Proxy と組み合わせ、脆弱な状態を生んだリクエスト／レスポンスを再現して最終的な攻撃URLを組み立てる。

---

## 読者が自分で開くべき資料

本セッションでは **portswigger.net への直接アクセスが egress ポリシーで遮断（CONNECT に 403）** されており、WebFetch も `EGRESS_BLOCKED` を返した。web.archive.org も同様に遮断、WebSearch はセッション予算切れ。そのため本ノートは **Burp に同梱されている公式ドキュメントのオフラインHTML（文面は公式サイトと同一）** を主たる典拠とした。最新版との差分を埋めるため、読者は必ず以下を自分のブラウザで開いて確認してほしい。

**読みどころ（優先順）**

1. **https://portswigger.net/burp/documentation/desktop/tools/dom-invader** — トップページ。**本ノートに載っていない新しいサブページがサイドバー／本文リンクに増えていないか**を最初に確認する（例：shadow DOM 対応、canary を URL/POST/Cookie のどこに入れるかを制御する新設定など、本ノートの典拠スナップショットには存在しなかった項目）。
2. **.../dom-invader/settings/misc.html** と **.../settings/main.html** — 設定項目は Burp のリリースごとに増えやすい。とくに **「Inject canary into all sources」の cog 配下（source 個別の有効/無効、カンマ区切りのパラメータ指定）** と **「Configuring callbacks」** の記述、および **Remove Permissions-Policy header** が現行でも同じかを確認する。
3. **.../dom-invader/settings/prototype-pollution.html** — **Techniques ダイアログに列挙されるテクニック名の実物**（`__proto__` / `constructor` 系の具体名）は本ノートで確認できていない。実機の Techniques 画面と併せて確認すること。
4. **.../dom-invader/dom-xss.html の "Studying the client-side code" 節** — **Stack Trace 列 → Console → 最上位リンク → Sources タブ**という導線は DOM XSS ハンティングの中核。スクリーンショット（`dom-invader-payload.png`, `dom-invader-unescaped-chars.png`）を実際に見ると、XSSコンテキスト判定の勘所が掴みやすい。
5. **https://portswigger.net/blog/introducing-dom-invader** — `sourcesList` / `sinkRanking` の**現行版**を確認する（本ノートのものは2021年7月時点の翻訳ミラー経由）。
6. **Burp のリリースノート（https://portswigger.net/burp/releases）** — 「DOM Invader」でページ内検索すると、**どのバージョンでどの機能が追加されたか**（DOM clobbering、cross-domain leak 検出、canary 設定UIなど）が時系列で分かる。教科書の「対応バージョン」記述の裏取りに必須。
7. **Web Security Academy の関連トピック** — `https://portswigger.net/web-security/dom-based`（DOM-based vulnerabilities）、`https://portswigger.net/web-security/dom-based/controlling-the-web-message-source`、`https://portswigger.net/web-security/dom-based/dom-clobbering`、`https://portswigger.net/web-security/prototype-pollution`。DOM Invader の各機能はこれらのラボとセットで練習するのが最短。

**本ノートで確認できなかった/確証が取れなかった事項（教科書に書く際は要検証）**

- **shadow DOM に関する専用設定・専用ドキュメントページ**：典拠スナップショットには存在しなかった。存在の有無を必ずライブ版で確認すること（存在しない機能を書かないこと）。
- **canary を URL / POST body / Cookie のどこに注入するかを個別に選ぶ設定**：典拠には「Inject URL params」「Inject forms」「Inject canary into all sources（source 個別の有効/無効＋パラメータのカンマ区切り指定）」までしか記載がない。それ以上の粒度の設定は確認できていない。
- **Prototype pollution と DOM clobbering の排他（トグル）挙動**：二次情報にのみ記載。公式ドキュメントには明記されていない。
- **拡張の最新バージョン番号と各機能の追加時期**：本ノートで確認できた拡張は v1.6.9（古い）。

---

## 出典一覧

- PortSwigger 公式ドキュメント（Burp 同梱オフラインコピー経由。公式URLは下記）
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/enabling
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/prototype-pollution
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-clobbering
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/main
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/attack-types
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/web-messages
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/prototype-pollution
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/misc
  - https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/canary
- PortSwigger 公式ブログ（翻訳ミラー経由）: https://portswigger.net/blog/introducing-dom-invader
- 二次情報: HackTricks `pentesting-web/xss-cross-site-scripting/dom-invader.md` / `wjch611/SecNote` `tools/others/Invader.md` / `JaewoongMoon` ブログ `2024-10-18-dom-invader`
- 拡張機能UI実物: Burp 同梱 Chromium 拡張 `burp-chromium-extension` v1.6.9 の `settings/settings.html`, `panels/augmented-dom.html`, `manifest.json`

> 本ノートの内容は、**許可された診断・バグバウンティ等の防御／検証目的**での利用を前提とする。DOM Invader の CSP / X-Frame-Options / Permissions-Policy 除去機能は**自分のブラウザ内のレスポンス処理を変えるもの**であり、対象サイトのセキュリティ設定を恒久的に変えるものではないが、**スコープ外のサイトで有効にしたまま巡回しない**こと。
