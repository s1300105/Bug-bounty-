# [31] Burp Suite 入門 — 導入（プロジェクト／ブラウザ／CA証明書）と Burp Proxy 全機能 詳細ノート

想定章: ch06（クライアントサイド脆弱性ハンティングのための Burp Suite 基礎）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://portswigger.net/burp/documentation/desktop/getting-started | partial | WebFetch → EGRESS_BLOCKED / curl → CONNECT 403 / web.archive.org → 403 / WebSearch → 予算切れ。最終的に **Burp Suite 本体にバンドルされているオフライン版ドキュメント（PortSwigger 公式 HTML そのもの）のミラー**を `raw.githubusercontent.com` 経由で取得 | 本文は逐語で取得できたが「ライブページ」ではないため partial。原典パス `resources/Documentation/burp/documentation/desktop/getting-started/index.html`。ミラー元の `META-INF/MANIFEST.MF` は `Implementation-Version: 32146`, `Implementation-Vendor: PortSwigger`。チュートリアル配下の全ページ（download-and-install / intercepting-http-traffic / modifying-http-requests / setting-target-scope / reissuing-http-requests / running-your-first-scan / generate-reports / what-next）＋ system-requirements / mac-installer / activating-burp-license も同様に逐語取得 |
| https://portswigger.net/burp/documentation/desktop/tools/proxy | partial | 同上（`resources/Documentation/burp/documentation/desktop/tools/proxy/index.html`） | 本文は逐語取得。さらに配下・関連の以下も逐語取得: `tools/proxy/intercept-messages.html`, `tools/proxy/invisible.html`, `tools/proxy/manage-certificates.html`, `tools/proxy/http-history/index.html`, `tools/proxy/http-history/filter-settings.html`, `tools/proxy/http-history/bambdas.html`, `tools/proxy/websockets-history/index.html`, `tools/proxy/websockets-history/filter-settings.html`, `tools/proxy/websockets-history/bambdas.html`, `settings/tools/proxy.html`（Proxy 設定の全項目・最重要）, `tools/burps-browser.html`, `external-browser-config/*`（全8ページ）, `external-browser-config/certificate/*`（全8ページ）, `projects/index.html`, `projects/create-project-file.html`, `settings/network/connections.html`, `settings/network/tls.html` |
| （参考・失敗）https://web.archive.org/web/2024/https://portswigger.net/... | failed | WebFetch / curl 両方 403（プロキシポリシー拒否） | archive.org 自体がこの環境からブロック |
| （参考・失敗）WebSearch による二次情報探索 | failed | WebSearch 予算（200/200）を使い切っており実行不可 | セッション全体の制限 |

**重要な注意**: 上記ミラーは Burp Suite インストーラに同梱される PortSwigger 公式ドキュメント HTML（`portswigger.net` で公開されているものと同一文面）である。本ノートの引用はすべてその HTML の逐語である。ただしライブページは随時更新されるため、**教科書に載せる際は「PortSwigger 公式ドキュメント（バンドル版・内部ビルド 32146 相当）に基づく」と明記し、最新の UI 名称・ポート既定値は読者自身に公式サイトで確認させること**を推奨する。

## 要約（3〜10行）

- Burp Suite は Web アプリケーション security testing 用のツール群であり、その中核が **Burp Proxy**（ブラウザと標的アプリの間に立つローカル Web プロキシサーバ）である。双方向のトラフィックを intercept / inspect / modify でき、HTTPS も扱える。
- 導入は「① ダウンロードとインストール → ② プロジェクトファイル選択（Temporary project in memory / New project on disk / Open existing project）と設定選択 → ③ Start Burp」の3段。Pro 版は起動時にライセンスキー入力（オフライン環境向けの Manual activation 手順もある）。
- ブラウザは**既定で Burp 内蔵の Chromium（Burp's browser）を使うのが公式推奨**。`Proxy > Intercept` の **Open Browser** で起動し、proxy listener も CA 証明書も設定済み。外部ブラウザを使う場合のみ「listener 稼働確認 → ブラウザのプロキシ設定 → 設定確認 → CA 証明書インストール」の4ステップが必要。
- CA 証明書は Burp 初回起動時にインストールごとに一意生成され、`http://burpsuite`（または `http://127.0.0.1:8080`）の in-browser interface から `.der` 形式でダウンロードして、各ブラウザ／OS のトラストストアに「Webサイトの識別に信頼する」設定で登録する。
- Proxy の設定面は 9 グループ: Proxy listeners / Request and response interception rules / WebSocket interception rules / Response modification rules / HTTP and WebSocket match and replace rules / TLS pass through / Proxy history logging / Default Proxy interception state / Miscellaneous。既定 listener は loopback の **port 8080**。
- クライアントサイド脆弱性ハンティングの観点で特に効くのは **Response modification rules**（hidden/disabled フォームフィールドの復活、入力長制限除去、JavaScript バリデーション除去、全 JS 除去、`<object>` 除去）と **match and replace**（ヘッダの追加・削除・書き換え、レスポンスボディの正規表現置換）、そして **WebSockets history / WebSocket interception rules**。
- TLS pass through は Burp が復号せず素通しする機能で、性能向上・元のTLSフィンガープリント保持による anti-bot 回避・証明書ピンニング由来の TLS エラー解消に使う。ただし **その接続の内容は Intercept view にも Proxy history にも一切出ない**。
- Invisible proxying は proxy 非対応クライアント（thick client、ブラウザプラグイン等）を直接 listener に繋ぐモード。hosts ファイル／DNS 書き換え＋非プロキシ形式リクエストの `Host` ヘッダ解釈＋CONNECT 無しの直接 TLS ネゴシエーション許容で成立する。

---

## 詳細ノート

### 1. Getting started with Burp Suite（チュートリアル全体の構成）
（出典: https://portswigger.net/burp/documentation/desktop/getting-started ／エディション表記: **Professional**, **Community**）

原文冒頭の定義（逐語）:

> 「Burp Suite is a comprehensive suite of tools for web application security testing.」

> 「This interactive tutorial is designed to get you started with the core features of Burp Suite as quickly as possible. It uses deliberately vulnerable labs from the Web Security Academy to give you practical experience of how Burp Suite works.」

= Burp Suite は Web アプリケーションのセキュリティテスト用の包括的なツール群である。このチュートリアルは Burp Suite のコア機能に最短で慣れることを目的とし、**Web Security Academy の意図的に脆弱な lab** を使って実践的に学ばせる。

ページ内の最初の行動喚起は「**First step -** Downloading and installing Burp Suite」→ **CONTINUE** ボタン。

#### In this tutorial（原文の順序どおり、全7項目）

1. Downloading and installing Burp Suite.
2. Intercepting HTTP traffic with Burp Proxy.
3. Modifying requests in Burp Proxy.
4. Setting the target scope.
5. Manually reissuing requests with Burp Repeater.
6. Running your first scan.
7. What next?

（注: 個別ページ側の「In this tutorial」リストには上記に加えて「Generating a report.」が入り、全8項目になっている。本文ページ間の遷移は Download → Intercept → Modify → Scope → Repeater → First scan (Pro only) → Generate a report → What next の順。）

メタ description（逐語）: 「How to get started with Burp Suite Professional / Burp Suite Community Edition. Step one - installing the software on your machine.」

パンくず構造（ドキュメント階層の把握に有用）: Support Center → Documentation → Desktop editions → Getting started。Proxy 側は Support Center → Documentation → Desktop editions → Tools → Burp Proxy。

---

### 2. Download and install（導入手順・番号付き）
（出典: /burp/documentation/desktop/getting-started/download-and-install.html ／**Professional**, **Community**）

#### Step 1: Download
「Use the links below to download the latest version of Burp Suite Professional or Community Edition.」
**Choose your software**: Professional / Community Edition の2択リンク。

#### Step 2: Install
1. 「Run the installer and launch Burp Suite.」= インストーラを実行して Burp Suite を起動する。
2. 「When asked to select a project file and configuration, just click **Next** and then **Start Burp** to skip this for now.」= プロジェクトファイルと設定の選択を求められたら、いまは **Next** → **Start Burp** で飛ばす。

> **Note**（逐語）: 「If you're using Burp Suite Professional, enter your license key when prompted. If you don't have one already, you can subscribe or request a free trial.」

#### Step 3: Start exploring Burp Suite
「If you're completely new to Burp Suite, follow the rest of this tutorial for an interactive, guided tour of the core features.」
→ **Next step -** Intercepting HTTP traffic with Burp Proxy

---

### 3. Burp Suite system requirements（動作要件・数値は原文どおり）
（出典: /burp/documentation/desktop/getting-started/system-requirements.html ／**Professional**, **Community**）

原文の前提: 「The system requirements for Burp Suite are largely dependent on your intended use for the software. While you can generally perform most tasks on a relatively low-spec machine, some use cases (for example, running multiple scans concurrently) may require significantly more power to run without a noticeable effect on performance.」

#### CPU cores / memory

| 区分 | スペック | 原文の説明 |
| --- | --- | --- |
| **Minimum** | **2x cores, 4GB RAM** | 「This spec is suitable for basic tasks such as proxying web traffic and simple Intruder attacks. While Burp Suite may run on a machine with a lower specification than this, we do not recommend doing so for performance reasons.」 |
| **Recommended** | **2x cores, 16GB RAM** | 「This is a good general-purpose spec.」 |
| **Advanced** | **4x cores, 32GB RAM** | 「This spec is suitable for more intensive tasks, such as complex Intruder attacks or large automated scans.」 |

#### Free disk space

| 対象 | 必要容量 |
| --- | --- |
| Basic installation | **1GB** |
| Per project file | **2GB** |

> **Note:**（逐語）「While 2GB is the recommended minimum free disk space for a project, note that project files can get significantly larger than this (potentially up to many tens of GB), depending on factors such as the amount of proxy history included, the number of scans run, and the number of Repeater tabs open.」

→ プロジェクトファイルは **数十GB** に達し得る。膨張要因は「proxy history の量」「実行したスキャン数」「開いている Repeater タブ数」。

#### Operating system and architecture
「Burp Suite supports the latest versions of the following operating systems:」

- Windows (Intel 64-bit)
- Linux (Intel and ARM 64-bit)
- OS X (Intel 64-bit and Apple M1)

##### Embedded browser（Burp's browser の追加要件）
「Burp's browser has some additional operating system and architecture requirements. It is not compatible with the following:」

- 「Older versions of Windows, including Windows 7, Windows 8/8.1, Windows Server 2012, and Windows Server 2012 R2.」
- 「Instances of Burp Suite that run via the JAR file on Apple Silicon and ARM 64-bit based systems. If you want to use Burp's browser on systems with these chip sets, make sure that you install Burp using the native platform installers.」

→ **Apple Silicon / ARM64 では JAR 起動だと内蔵ブラウザが使えない。ネイティブのプラットフォームインストーラを使うこと。**

> **Note**: 「You can still run multiple instances of Burp simultaneously when using the platform installer versions. This functionality is not limited to instances of Burp run from the JAR file.」

---

### 4. Which Burp Suite Mac installer do you need to download?
（出典: /burp/documentation/desktop/getting-started/mac-installer.html ／**Professional**, **Community**）

- 「In 2020, Apple began introducing a new type of processor for its Mac devices. You need to use a different version of the Burp Suite installer depending on which processor your machine is equipped with.」
- プロセッサ判定手順: 画面左上の Apple ロゴ → **About This Mac** → ダイアログ内の **Chip** または **Processor** の行を見る。Apple / Intel いずれかが判る。
- 適切なインストーラは PortSwigger の **Releases page** からダウンロードする。

---

### 5. Activating your Burp Suite license（Pro 専用・オフライン手動アクティベーションを含む）
（出典: /burp/documentation/desktop/getting-started/activating-burp-license.html ／**Professional** のみ）

前提: 「When launching Burp Suite Professional for the first time, you will be prompted to provide your Burp license key. Your license key is available to download from your account page.」

#### 標準アクティベーション手順（番号付き）
1. ライセンスキー入力を促されたら、キーをテキストウィンドウに貼り付ける、または **Select license key file...** ボタンでファイルから読み込む。→ **Next** をクリック。
2. インターネットアクセスが Web プロキシサーバ経由に限られる場合は、対応フィールドにプロキシ情報を入力する。
3. **Next** をクリックしてライセンスをアクティベートし、startup wizard に進む。

#### Manual activation（手動アクティベーション）
> **Note**（逐語）: 「If you are trying to complete the manual activation process on a computer with no internet connection, you will need to perform this process on another computer before entering the activation response manually on the offline computer.」

標準手順の 3. で **Next** の代わりに **Manual activation** をクリックし、以下:

1. **Copy URL** ボタンをクリック。
2. その URL をブラウザに貼り付け、manual license activation ページを開く。
3. アクティベーションウィザードに戻り **Copy request** ボタンをクリック。
4. ブラウザのライセンスアクティベーションページに戻り、リクエストを **Activation request** フィールドに貼り付け、**Send** をクリック。**Activation response** フィールドにテキストが現れるので選択してクリップボードにコピーする。
5. ウィザードに戻り **Paste response** ボタンで該当フィールドに貼り付ける。オフラインPCで手入力する場合は正確に入力する。
6. **Next** をクリック。成功していれば次の画面で通知される。**Finish** をクリックしてアクティベーションを完了し、Burp startup wizard を読み込む。

---

### 6. Project files / Creating project files（プロジェクト作成 — 導入で最初に決める部分）
（出典: /burp/documentation/desktop/projects/index.html ／**Professional**、および /burp/documentation/desktop/projects/create-project-file.html ／**Professional**）

#### プロジェクトファイルとは
「You can hold all the data and configuration settings for a particular piece of work in a Burp project file. The file saves data incrementally as you work. There is no need to manually save your work.」
→ 作業データと設定を1つの project file に保持し、**インクリメンタルに自動保存**される。手動保存は不要。

> **Note**: 「When you test some applications, it can generate several gigabytes of data. Make sure that you have sufficient free disk space available when you use Burp project files.」

#### startup wizard で選べるプロジェクト種別（エディション別）

| 選択肢 | 対応エディション | 原文の説明 |
| --- | --- | --- |
| **Temporary project in memory** | Professional / Community | 「Select this option for quick tasks where you don't need to save your work. All data is held in memory and is lost when you close Burp.」 |
| **New project on disk** | Professional | 「Create a new project file. This file holds all of the data and configuration for the project.」 |
| **Open existing project** | Professional | 「Reopen a project file. You can choose from a list of recently opened projects.」 |

> **Warning**（逐語）: 「You can import project and configuration files from other users. However, for security reasons, we recommend only importing project and configuration files from trusted sources.」

→ **他人のプロジェクト／設定ファイルは信頼できる出所のものだけ。**

#### 既存プロジェクトを開くときの2つの安全設定
- **Pause Automated Tasks**: 「This setting can protect you from sending requests that could be set to automatically run when you open a Burp project file. We recommend this setting if the project file is from an unknown or untrusted source.」出所不明のプロジェクトファイルでは推奨。**Pause Automated Tasks** を選ぶと、プロジェクトを開いたときに自動タスクが走らない。
  - **Note**: 「If you deselect **Trust this project file**, automated tasks are paused by default.」
- **Trust this project file**: 「This setting can protect you from potentially harmful settings that could be configured within a Burp project file.」**Trust this project** のチェックを外すと、Burp は開く前に潜在的に有害な設定を除去し、プロジェクト内に設定された自動タスクも一時停止する。
  - **Note**: 「We do not recommend proxying traffic through an untrusted project file, even if you deselect **Trust this project**.」= 信頼できないプロジェクトファイルでトラフィックをプロキシすること自体を推奨しない。

#### disk-based プロジェクト作成手順（番号付き・逐語ベース）
1. Burp を起動する。
2. **New project on disk** を選択する。
3. 名前を入力しファイルを選び、**Next** をクリック。
4. 次の configuration から選ぶ:
   - **Use Burp defaults** — 「Open the project using Burp's default settings.」
   - **Use settings saved with project** — 「This is only available when you reopen a project. It opens with the same settings that were selected the last time that you closed the project file.」
   - **Load from configuration file** — 「Use the settings stored in a Burp configuration file. Only the project-level settings are loaded: user-level settings are ignored.」（**project レベル設定のみ読み込まれ、user レベル設定は無視される**）
5. **Start Burp** をクリック。

プロジェクト種別の定義（逐語訳）:
- **Temporary projects**: 保存不要な短時間作業向け。全データはメモリ上、Burp 終了で消える。
- **Disk-based projects**: 作業を保存して後で再開できる。全データはディスク上の project file にある。

> **Note**: 「Due to the way our persistence framework operates, we recommend that you use a local drive to save project files.」= 永続化フレームワークの仕組み上、**ローカルドライブ**に保存することを推奨（ネットワークドライブは避ける）。

#### 既存プロジェクトを開く
startup wizard で **Open existing project** を選ぶか、**command line arguments** を使う。Burp は直近のプロジェクトデータと設定を再読込する。

> **Note**: 「If the project file was created in a different instance of Burp, you are asked if you want to take full ownership of the project.」

別インスタンスで作られたプロジェクトでは「full ownership を取るか」を尋ねられる。他インスタンスで作業が続く可能性があり、かつ **Burp Collaborator identifier** がプロジェクトファイルに保存されている場合、identifier を共有することになるため **full ownership を取らないことを推奨**（identifier 共有はエラーの原因になる）。

---

### 7. Burp Proxy（トップページ — 定義と位置づけ）
（出典: https://portswigger.net/burp/documentation/desktop/tools/proxy ／**Professional**, **Community**）

逐語（最重要の定義2文）:

> 「Burp Proxy operates as a web proxy server between the browser and target applications. It enables you to intercept, inspect, and modify traffic that passes in both directions. You can even use this to test using HTTPS.」

> 「Burp Proxy is an essential component of Burp Suite's user-driven workflow. You can use it to send requests to Burp's other tools.」

→ Burp Proxy は **ブラウザと標的アプリの間に立つ Web プロキシサーバ**。双方向トラフィックの intercept / inspect / modify が可能で、HTTPS でも使える。Burp Suite の **user-driven workflow** の必須要素であり、ここから他ツールへリクエストを送る。

> **Note**（安全上の警告・逐語）: 「Using Burp Proxy may result in unexpected effects in some applications. Until you are fully familiar with its functionality and settings, you should only use Burp Proxy against non-production systems.」

→ 機能と設定に十分慣れるまでは **非本番システムに対してのみ** 使うこと。

Burp's browser との関係（逐語）: 「Burp Proxy works with Burp's browser to access the target application. To launch Burp's browser, go to **Proxy > Intercept** and click **Open Browser**. All traffic for this browser is proxied through Burp automatically.」

#### Related pages（トップページからの公式リンク構成 = Proxy の全体像）

| リンク名 | パス |
| --- | --- |
| Intercepting messages | /burp/documentation/desktop/tools/proxy/intercept-messages.html |
| HTTP history | tools/proxy/http-history/index.html |
| WebSockets history | /burp/documentation/desktop/tools/proxy/websockets-history/index.html |
| Burp Proxy settings | /burp/documentation/desktop/settings/tools/proxy.html |
| Managing certificates | /burp/documentation/desktop/tools/proxy/manage-certificates.html |
| Invisible proxying | /burp/documentation/desktop/tools/proxy/invisible.html |

---

### 8. Burp's browser（内蔵ブラウザ）
（出典: /burp/documentation/desktop/tools/burps-browser.html ／**Professional**, **Community**）

- 「Burp Suite comes with its own browser, which is ready to use for a variety of manual and automated testing purposes.」
- **Manual testing with Burp's browser**: 「Burp's browser is preconfigured to work with the full functionality of Burp Suite right out of the box. All of the necessary proxy listener settings are automatically adjusted for you. This means you can launch Burp for the first time and immediately start testing, even using HTTPS, without performing any additional configuration.」
  → **proxy listener 設定は自動調整済み。初回起動で即、HTTPS でもテスト開始できる。追加設定不要。**
- 起動手順: **Proxy > Intercept** タブ → **Open browser** をクリック。以後は通常のブラウザと同様に閲覧・操作する。「All in-scope traffic is automatically proxied through Burp.」
- 閲覧中は Burp の既定 live tasks が「passively crawl and audit the locations that you visit」し、site map を自動的に埋め、検出した潜在的なセキュリティ問題を報告する。
- **Scanning websites with Burp's browser**: 手動テストに便利なだけでなく、**browser-powered scanning with Burp Scanner** に統合するとさらに強力。
- **Health check for Burp's browser**: 内蔵ブラウザに問題があるときは **Help** メニューから **Health check for Burp's browser** ツールを使う。「The health check runs a series of tests to check whether the browser is working correctly and provides feedback on any issues that arise.」
- 外部ブラウザを使いたい場合は「some additional configuration steps」が必要（→ 第11節）。

---

### 9. Proxy intercept（Intercept タブの全機能）
（出典: /burp/documentation/desktop/tools/proxy/intercept-messages.html ／**Professional**, **Community**）

定義: 「From the **Proxy > Intercept** tab, you can intercept HTTP requests and responses sent between the browser and the target server. This enables you to study how the website behaves when you interact with it.」

intercept で可能な4つのアクション（逐語）:

- 「Intercept requests and modify them before forwarding them to the server.」
- 「Release a selection of requests at once.」
- 「Send interesting requests to Burp's other tools, such as Repeater or Intruder, for further testing.」
- 「Drop one or more requests to prevent them from reaching the server.」

#### Controls（パネルのコントロール一覧）

| コントロール | 原文の説明 |
| --- | --- |
| **Forward** | 「After you review or edit the message, click **Forward** to send all the selected messages to the target.」 |
| **Forward all** | 「Click the **Forward** dropdown menu and select **Forward all** to forward all the intercepted messages.」 |
| **Drop** | 「To cancel the selected requests so that they never reach the target server, click **Drop**.」 |
| **Intercept on/off** | 全 interception のトグル。**Intercept on** 表示中はメッセージが intercept される（HTTP/WebSocket メッセージの interception 設定で自動 forward も構成可）。**Intercept off** 表示中は Burp が全メッセージを自動 forward する。 |

- パネル上部に標的サーバの詳細が表示される。**HTTP リクエストでは標的サーバを手動編集できる**（**Edit target** メニューを選択）。
- メッセージエディタ内、および intercept 済みメッセージ一覧で、右クリックによりそれぞれ別のコンテキストメニューにアクセスできる。

> **Note**（ホットキー・逐語）: 「You can use hotkeys to forward or drop intercepted messages. By default, **Ctrl+F** forwards the selected messages. You can also set a hotkey to forward all intercepted messages.」（詳細は hotkey settings）

#### Intercepted messages table（複数選択の操作）
テーブルはパネル上半分に intercept 済みメッセージを表示。右クリックでコンテキストメニュー（選択が1件のときと複数のときで項目が異なる）。

複数選択の方法:
1. 「Click a message to select it.」
2. 「Hold **Shift** to select a block of messages.」
3. 「Hold **Command** (Mac) or **Ctrl** (Windows or Linux) to select multiple messages one at a time.」

#### Adding annotations（注釈）
- notes と highlights を intercept 済みメッセージに付けられる。目的の記述や、後で調査すべき興味深いメッセージのフラグ立てに使う。
- 「Any annotations that you make also appear against the item in the HTTP history. If you apply an annotation to an HTTP request, the annotation appears again if the corresponding response is also intercepted.」
- ハイライト手順: テーブルでメッセージを右クリック → **Highlight** → 一覧から色を選ぶ。
- ノート追加手順: テーブルでメッセージを右クリック → **Add Notes** → **Notes** パネルにコメントを入力。

#### Message display（メッセージエディタ上の Proxy 固有アクション）
メインパネルのメッセージエディタには直近に選択した intercept 済みメッセージが表示される。右クリックで standard functions にアクセスでき、さらに HTTP メッセージでは:

- **Don't intercept requests/responses** — 「You can add an interception rule so that Burp automatically forwards messages that share a specific feature, such as host, file extension, or HTTP status code. Use this feature if you're seeing a lot of uninteresting requests or responses of a particular type.」（host / file extension / HTTP status code などの特徴を共有するメッセージを自動 forward する interception rule を追加する）
- **Do intercept** — 「Select this function to intercept the response to the currently displayed request. This is only available for requests.」（**いま表示中のリクエストに対するレスポンスを intercept する。リクエストのときだけ使える**）

#### Protocol
「You can use the Inspector to edit the protocol for the request.」（詳細は HTTP/2 のドキュメント）

---

### 10. Getting started チュートリアル: Proxy 実践
（出典: getting-started 配下の各ページ）

#### 10-1. Intercept HTTP traffic with Burp Proxy（**Professional**, **Community**）
「Burp Proxy lets you intercept HTTP requests and responses sent between Burp's browser and the target server. This enables you to study how the website behaves when you perform different actions.」

**Step 1: Launch Burp's browser**
1. **Proxy > Intercept** タブに移動する。
2. intercept トグルを **Intercept on** にする。
3. **Open Browser** をクリック。「This launches Burp's browser, which is preconfigured to work with Burp right out of the box.」
4. Burp と Burp's browser の両方が見えるようにウィンドウを配置する。

**Step 2: Intercept a request**
- Burp's browser で `https://portswigger.net` にアクセスしようとすると、サイトが読み込まれないことを確認する。「Burp Proxy has intercepted the HTTP request that was issued by the browser before it could reach the server.」intercept されたリクエストは **Proxy > Intercept** タブで見える。
- 「The request is held here so that you can study it, and even modify it, before forwarding it to the target server.」

**Step 3: Forward the request**
- **Forward** ボタンをクリックして intercept 済みリクエストを送信する。以降 intercept される後続リクエストについても、ページが Burp's browser で読み込まれるまで **Forward** を繰り返す。「The **Forward** button sends all the selected requests.」

**Step 4: Switch off interception**
- 「Due to the number of requests browsers typically send, you often won't want to intercept every single one of them.」intercept トグルを **Intercept off** にする。
- ブラウザに戻り、通常どおりサイトを操作できることを確認する。

**Step 5: View the HTTP history**
- Burp で **Proxy > HTTP history** タブへ。「Here, you can see the history of all HTTP traffic that has passed through Burp Proxy, **even while intercept was switched off**.」
- 履歴の任意のエントリをクリックすると、生の HTTP リクエストとサーバからの対応するレスポンスが見られる。
- 「This lets you explore the website as normal and study the interactions between Burp's browser and the server afterward, which is more convenient in many cases.」

#### 10-2. Modifying HTTP requests with Burp Proxy（**Professional**, **Community**）
目的（逐語）: 「you'll learn how to modify intercepted requests in Burp Proxy. This enables you to manipulate these requests in ways that the website isn't expecting, in order to see how it responds.」

> **Web Security Academy**: 「To follow along, you'll need an account on `portswigger.net`. If you don't have one already, registration is free and it grants you full access to the Web Security Academy.」

**Step 1: Access the vulnerable website in Burp's browser**
1. **Proxy > Intercept** タブで interception が **off** であることを確認する。
2. Burp's browser で次の URL を開く（逐語）:

```
https://portswigger.net/web-security/logic-flaws/examples/lab-logic-flaws-excessive-trust-in-client-side-controls
```

3. ページが読み込まれたら **Access the lab** をクリック。求められたら portswigger.net アカウントでログイン。数秒後に自分専用の偽ショッピングサイトのインスタンスが表示される。

**Step 2: Log in to your shopping account**
- ショッピングサイトで **My account** をクリックし、以下の資格情報でログイン（逐語）:
  - **Username: ** `wiener`
  - **Password: ** `peter`
- ストアクレジットが **$100** しかないことに気づく。

**Step 3: Find something to buy**
- **Home** をクリックしてホームページに戻り、**Lightweight "l33t" leather jacket** の商品詳細を表示するオプションを選ぶ。

**Step 4: Study the add to cart function**
- Burp で **Proxy > Intercept** タブに移動し interception を on にする。ブラウザでレザージャケットをカートに追加し、結果の `POST /cart` リクエストを intercept する。
- **Note**: 「You may see more than one request on the **Proxy > Intercept** tab if the browser is doing something else in the background. In this case, select the `POST /cart` request.」
- intercept されたリクエストを調べ、ボディに `price` というパラメータがあり、それが **セント単位の商品価格** に一致していることに気づく。

**Step 5: Modify the request**
- `price` パラメータの値を **1** に変更し、**Forward > Forward all** をクリックして、改変済みリクエストと他の intercept 済みリクエストをまとめてサーバへ送る。
- 以後のリクエストが素通りするよう interception を再び off にする。

**Step 6: Exploit the vulnerability**
- Burp's browser で右上のバスケットアイコンをクリックしてカートを見ると、ジャケットが **1セント** で追加されていることに気づく。
- **Note**（クライアントサイド信頼の教訓・逐語）: 「There is no way to modify the price via the web interface. You were only able to make this change thanks to Burp Proxy.」
- **Place order** ボタンをクリックして購入する。→ 最初の Web Security Academy lab（**excessive trust in client-side controls**）が解ける。

〔補足（一般知識）〕この lab はクライアントサイドに置かれた値（価格）をサーバが検証せず信頼している論理欠陥であり、「クライアントサイド脆弱性ハンティング」の出発点として、Proxy による改変が UI では不可能な操作を可能にすることを示す典型例である。

#### 10-3. Set the target scope（**Professional**, **Community**）
目的: 「The target scope tells Burp exactly which URLs and hosts you want to test. This enables you to filter out the noise generated by your browser and other sites, so you can focus on the traffic that you're interested in.」

**Step 1: Launch Burp's browser** — 次の URL を開く（逐語）:

```
https://portswigger.net/web-security/information-disclosure/exploiting/lab-infoleak-in-error-messages
```

**Access the lab** をクリック、必要ならログイン。数秒後に自分専用インスタンスが表示される。

**Step 2: Browse the target site** — 商品ページをいくつかクリックしてサイトを探索する。

**Step 3: Study the HTTP history** — **Proxy > HTTP history** タブへ。「To make this easier to read, keep clicking the header of the leftmost column (**#**) until the requests are sorted in descending order. This way, you can see the most recent requests at the top.」履歴には、興味のないサードパーティ（例: **YouTube**、**Google Analytics**）へのリクエストも含まれていることに気づく。

**Step 4: Set the target scope** — **Target > Site map** へ。左パネルにブラウザが通信したホスト一覧がある。標的サイトのノードを右クリック → **Add to scope**。ポップアップで確認されたら **Yes** をクリックして out-of-scope トラフィックを除外する。

**Step 5: Filter HTTP history** — HTTP history 上部の display filter をクリックし **Show only in-scope items** を選択する。履歴をスクロールし戻ると標的サイトのエントリだけが残り、他は非表示になっている。「If you continue to browse the target site, notice that out-of-scope traffic is no longer logged in the site map or proxy history.」

#### 10-4. Reissue requests with Burp Repeater（**Professional**, **Community**）
目的: 「you'll use Burp Repeater to send an interesting request over and over again. This lets you study the target website's response to different input without having to intercept the request each time.」

**Sending a request to Burp Repeater**
1. **Step 1: Identify an interesting request** — 前チュートリアルの偽ショッピングサイトで、商品ページにアクセスするたびブラウザが `productId` クエリパラメータ付きの `GET /product` リクエストを送っていたことに気づく。
2. **Step 2: Send the request to Burp Repeater** — `GET /product?productId=[...]` のいずれかを右クリックし **Send to Repeater** を選ぶ。**Repeater** タブに移動すると、自分のリクエストが番号付きタブで待っている。
3. **Step 3: Send the request and view the response** — **Send** をクリックしてサーバのレスポンスを見る。「You can resend this request as many times as you like and the response will be updated each time.」

**Testing different input with Burp Repeater**
1. **Step 1: Resend the request with different input** — `productId` の数値を変えて再送する。任意の数値をいくつか（大きめのものも含めて）試す。
2. **Step 2: View the request history** — 矢印で送信済みリクエストと対応レスポンスの履歴を前後に辿れる。各矢印の隣のドロップダウンで履歴内の特定リクエストへジャンプできる。レスポンスを比較すると、ID を入れれば別の商品ページを取得できるが、該当商品がない場合は `Not Found` レスポンスになる。
3. **Step 3: Try sending unexpected input** — 「The server seemingly expects to receive an integer value via this `productId` parameter.」→ `productId` を**文字列**にしたリクエストを送る。
4. **Step 4: Study the response** — 非整数の `productId` が **exception** を引き起こし、サーバが **stack trace を含む verbose error response** を返したことを観察する。レスポンスから、サイトが **Apache Struts** フレームワークを使っており、**そのバージョンまで露出している**ことが判る。「In a real scenario, this kind of information could be useful to an attacker, especially if the named version is known to contain additional vulnerabilities.」
   - lab の **Submit solution** に入力する Struts バージョン（逐語）: **2 2.3.31**

#### 10-5. Run your first scan（**Professional** のみ）
スキャンの2フェーズ（逐語）:

- **Crawling for content and functionality:** 「Burp Scanner first navigates around the target site, closely mirroring the behavior of real users. It catalogs the structure and content of the site, and the paths used to navigate it, in order to build a comprehensive map of the site.」
- **Auditing for vulnerabilities:** 「The audit phase of a scan involves analyzing the website's behavior to identify security vulnerabilities and other issues. Burp Scanner employs a wide range of techniques to deliver a high-coverage, accurate audit of the target.」

> **Note**: 「Burp Scanner is only available in Burp Suite Professional and Burp Suite Enterprise Edition. If you're using Burp Suite Community Edition, then you won't be able to follow this tutorial.」

手順:
1. **Step 1: Open the scan launcher** — **Dashboard** タブ → **New scan**。**Scan launcher** ダイアログが開く。
2. **Step 2: Enter the URL of the target site** — **URLs to scan** フィールドに `ginandjuice.shop` と入力する。必要なら前チュートリアルで target scope に設定したサイトの URL を削除する。他の設定は既定のまま。
   > **Note**（倫理・権限の警告・逐語）: 「Using Burp Scanner may have unexpected effects on some applications. Until you are fully familiar with its functionality and settings, you should only use Burp Scanner against non-production systems. Do not run scans against third-party websites unless you have been authorized to do so by the owner.」
3. **Step 3: Configure the scan** — **Scan configuration** を選択。**Use a preset scan mode** が選ばれていることを確認し **Lightweight** をクリック。「The **Lightweight** scan mode is intended to give a very high-level overview of a target as quickly as possible. Scans using this mode run for a maximum of **15 minutes**.」
4. **Step 4: Launch the scan** — **OK** でスキャン開始。入力 URL からクロールが始まる。**Dashboard** に新しいタスクが追加され、選択すると状態と現在の処理内容が見られる。
5. **Step 5: See the crawl in action** — **Target > Site map** タブに `ginandjuice.shop` の新エントリ。ノードを展開するとクローラが発見したコンテンツが見え、数秒待つとリアルタイムで更新される。
6. **Step 6: View the identified issues** — **Dashboard** でスキャン状態を監視。1〜2分でクロールが終わり、audit が始まる。**Tasks** 一覧からスキャンを選び、メインパネルの **Issues** タブへ。issue を選ぶと **Advisory** タブに「key information about the issue type, including a detailed description and some remediation advice」があり、その隣に Burp Scanner が見つけた証拠のタブ（通常は **Request** と **Response**、issue 種別により異なる）が並ぶ。

#### 10-6. Generating a report（**Professional** のみ）
1. **Step 1: Select the relevant issues** — **Target > Site map** タブ → `https://ginandjuice.shop` のエントリを右クリック → **Issues > Report issues for this host**。
2. **Step 2: Configure the report options** — 「A wizard guides you through the available options, such as how much detail to include.」いまはファイル名と場所を尋ねられるまで **Next** で既定を受け入れる。
3. **Step 3: Generate and save the report** — **Select file** をクリックして保存場所を選び、ファイル名を入力する。
   > **Note**: 「You must include the appropriate file extension, in this case, `.html`.」

   **Save** → **Next** でレポート生成。
4. **Step 4: View and share your report** — Burp's browser でレポートを開いて内容を確認する。「This is useful for reporting the results of your scans to colleagues or clients.」

#### 10-7. What's next?（**Professional**, **Community**）
到達した能力（逐語リスト）:
- 「Intercept and modify HTTP traffic with **Burp Proxy**.」
- 「Set the target scope to focus your work on interesting content.」
- 「Probe for vulnerabilities by reissuing requests with **Burp Repeater**.」
- 「Run automated vulnerability scans and generate reports with **Burp Scanner**.」
- 「Use the **Web Security Academy** to hone your skills.」

続く学習先（Continue your Burp Suite journey）の見出し一覧: **Tools** / **Tutorials** / **Options & Preferences** / **Web Security Academy** / **Troubleshooting** / **Burp Suite extensions** / **Reference documentation**。

---

### 11. 外部ブラウザを Burp と連携させる（4ステップの全体像）
（出典: /burp/documentation/desktop/external-browser-config/index.html ／**Professional**, **Community**）

「If you need to use an external browser with Burp instead of Burp's preconfigured Chromium browser, perform the following configuration steps.」

> **Note**（逐語）: 「For the vast majority of users, this process is not necessary. Simply use Burp's browser instead, which is already configured.」

手順（番号付き・原文の順序）:
1. **Check that the proxy listener is active**（listener が稼働していることを確認）
2. **Configure your external browser to proxy traffic through Burp**:
   - Chrome (Windows)
   - Chrome (MacOS)
   - Firefox
   - Safari
3. **Check your browser proxy configuration**（ブラウザのプロキシ設定を検証）
4. **Install Burp's CA certificate**（Burp の CA 証明書をインストール）

#### 11-1. Check that Burp's proxy listener is active
（出典: external-browser-config/check-listener.html）

定義（逐語）: 「Burp's proxy listener is a local HTTP proxy server that listens for incoming connections from your browser. It allows you to monitor and intercept all HTTP requests and responses sent and received by your browser. This lies at the heart of Burp's user-driven workflow.」

「By default, Burp creates a single listener on **port 8080** of the **loopback interface**. The first time you start Burp, you need to check that this listener is active and running.」

手順:
1. Burp で **Settings** ダイアログの **Tools > Proxy** タブに移動する。
2. **Proxy listeners** パネルで、インターフェース `127.0.0.1:8080` のエントリがあり **Running** チェックボックスが選択されていることを確認する。選択されていれば問題なく、ブラウザ設定に進める。
3. そうでなければ、**Proxy listeners** フィールドのアイコンをクリックし **Restore defaults** を選ぶ。再度 **Running** を確認する。
4. それでも動かない場合、既定ポート **8080** が他アプリに使われていて利用できない可能性がある。`127.0.0.1:8080` のエントリを選択し **Edit** をクリック。**Edit proxy listener** ダイアログが開く。
5. **Bind to port** フィールドに空いていると思われる新しいポート番号を入力し **OK**。
6. **Running** チェックボックスを選択して listener を有効化しようとする。まだ有効化できなければ、選んだ新ポートもおそらく塞がれているので、別のポートで同じ手順を繰り返す。

#### 11-2. Configuring Firefox to work with Burp Suite
（出典: external-browser-config/browser-config-firefox.html）

> **Note**: これらの手順は外部ブラウザで手動テストしたい場合にのみ必要。Burp's browser を使うなら **Proxy > Intercept** タブ → **Open Browser** だけでよい。

手順（番号付き）:
1. Firefox で Firefox Menu を開き **Preferences > Options** を選ぶ。
2. **General** タブを選び **Network Proxy** 設定までスクロール。**Settings** ボタンをクリック。
3. **Manual proxy configuration** オプションを選択する。
4. **HTTP Proxy** フィールドに Burp Proxy listener のアドレスを入れる（既定では `127.0.0.1`）。
5. **Port** フィールドに Burp Proxy listener のポートを入れる（既定では `8080`）。**Use this proxy server for all protocols** ボックスがチェックされていることを確認する。
6. **No proxy for** フィールドにある内容をすべて削除する。**OK** をクリックしてすべてのオプションダイアログを閉じる。

→ **Next step**: Check your browser proxy configuration.

#### 11-3. Configuring Chrome to work with Burp Suite — Windows
（出典: external-browser-config/browser-config-chrome-windows.html）

手順（番号付き）:
1. Chrome を開き **Customize**（ハンバーガー）メニューへ。
2. **Settings** を選び **System** メニューを開く。
3. **Open your computer's proxy settings** をクリック。**Proxy Settings** ウィンドウでプロキシサーバを設定できる。
4. **Automatically detect settings** と **Use setup script** が **Off** であることを確認する。
5. **Use a proxy server** を **On** にする。
6. **Address** フィールドに Burp Proxy listener のアドレスを入力（既定 `127.0.0.1`）。
7. **Port** フィールドに Burp Proxy listener のポートを入力（既定 `8080`）。
8. **Don't use the proxy server for local (intranet) addresses** がチェックされていないことを確認する。
9. **Save** をクリック。

#### 11-4. Configuring Chrome to work with Burp Suite — MacOS
（出典: external-browser-config/browser-config-chrome-macos.html）

手順（番号付き）:
1. Chrome を開き **Customize**（ハンバーガー）メニューへ。
2. **Settings** を選び **System** メニューを開く。
3. **Open your computer's proxy settings** をクリック。
4. **Web Proxy (HTTP)** プロトコルを設定する:
   - **Web Proxy (HTTP)** ボックスをチェックする。
   - **Web Proxy Server** フィールドに Burp Proxy listener のアドレスを入力（この例では `127.0.0.1`）。
   - 隣のフィールドに Burp Proxy listener のポートを入力（この例では `8080`）。
5. **Secure Web Proxy (HTTPS)** チェックボックスについても同じ手順を繰り返す。
6. **Bypass proxy settings for these Hosts & Domains** フィールドが空であることを確認する。
7. **OK** と **Apply** をクリックして開いているダイアログを閉じる。

#### 11-5. Configuring Safari to work with Burp Suite
（出典: external-browser-config/browser-config-safari.html）

手順（番号付き）:
1. Safari で **Safari** メニューから **Preferences** をクリック。
2. **Advanced** タブをクリックし、**Proxies** の下の **Change Settings** ボタンをクリック。「This will open the network configuration settings for your current network adapter.」
3. **Proxies** タブで **Web Proxy (HTTP)** ボックスをチェックし、**Web Proxy Server** フィールドに Burp Proxy listener のアドレス（既定 `127.0.0.1`）、（ラベルのない）ポートフィールドに Burp Proxy listener のポート（既定 `8080`）を入力する。
4. **Secure Web Proxy (HTTPS)** チェックボックスについても同じ手順を繰り返す。
5. **Bypass proxy settings for these Hosts & Domains** ボックスが空であることを確認する。
6. **OK** と **Apply** をクリックして開いているダイアログを閉じる。

#### 11-6. Checking your browser proxy configuration
（出典: external-browser-config/check-browser-configuration.html）

手順（番号付き・逐語ベース）:
1. proxy listener が稼働していることを確認済みで、選んだブラウザを設定済みであることを確認する。
2. Burp Suite で **Proxy > Intercept** タブへ。HTTP interception を有効にするため **Intercept is off** をクリックする。
3. Burp Suite を動かしたまま、設定したブラウザを開き、任意の **HTTP** URL にアクセスする。「Your browser should sit waiting for the request to complete, because Burp Suite has intercepted the HTTP request that your browser is trying to send.」
4. Burp Suite で **Proxy > Intercept** タブへ。**Intercept** タブのメインパネルに intercept された HTTP リクエストが表示される。
5. **Forward** をクリックして Burp Suite からリクエストを解放する。
6. ブラウザに戻る。通常の閲覧と同様に、要求したページが読み込まれるはずである。
7. HTTP interception を無効化するには **Intercept is on** をクリックする。

「These steps enable you to test web applications that use HTTP. **To test HTTPS URLs, you need to install Burp's CA certificate.**」

---

### 12. Installing Burp's CA certificate（CA 証明書インストール — なぜ必要か／どこから取るか）
（出典: /burp/documentation/desktop/external-browser-config/certificate/index.html ／**Professional**, **Community**）

> **Note**: 外部ブラウザを使う場合のみ必要。Burp's browser は設定済み（**Proxy > Intercept** → **Open Browser**）。

ブラウザ別の手順ページ:
- Installing Burp's CA certificate in **Firefox**
- Installing Burp's CA certificate in **Chrome**: **Windows** / **Linux** / **MacOS**
- Installing Burp's CA certificate in **Safari**

インストール完了後の検証（逐語）: 「When you have done this, you can confirm things are working properly by closing all your browser windows, opening a new browser session, and visiting any HTTPS URL. The browser should not display any security warnings, and the page should load in the normal way (you will need to turn off interception again in the **Proxy > Intercept** tab if you have re-enabled this).」

#### モバイル端末への CA 証明書インストール
「Additionally, you may want to install Burp's CA certificate on a mobile device. First, ensure that the mobile device is configured to work with Burp Suite.」
- **iOS device**（/burp/documentation/desktop/mobile/config-ios-device.html）
- **Android device**（/burp/documentation/desktop/mobile/config-android-device.html）

#### Why do I need to install Burp's CA certificate?（原理・逐語）

> 「One of the key functions of TLS is to authenticate the identity of web servers that your browser communicates with. This authentication process helps to prevent a fraudulent website from masquerading as a legitimate one, for example. It also encrypts the transmitted data and implements integrity checks to protect against man-in-the-middle attacks. In order to intercept the traffic between your browser and destination web server, Burp needs to break this TLS connection. As a result, if you try and access an HTTPS URL while Burp is running, your browser will detect that it is not communicating directly with the authentic web server and will show a security warning.」

> 「To prevent this issue, Burp generates its own TLS certificate for each host, signed by its own Certificate Authority (CA). This CA certificate is generated the first time you launch Burp, and stored locally. To use Burp Proxy most effectively with HTTPS websites, you need to install this certificate as a trusted root in your browser's trust store. Burp will then use this CA certificate to create and sign a TLS certificate for each host that you visit, allowing you to browse HTTPS URLs as normal.」

「Although this step isn't strictly mandatory, especially if you only want to work with non-HTTPS URLs, we still recommend completing this step. You only need to do it once, and it is required to get the most out of your experience with Burp Suite when using an external browser.」

> **Note**（セキュリティ上の重大な注意・逐語）: 「If you install a trusted root certificate in your browser, then an attacker who has the private key for that certificate may be able to man-in-the-middle your TLS connections without obvious detection, even when you are not using an intercepting proxy. To protect against this, Burp generates a unique CA certificate for each installation, and the private key for this certificate is stored on your computer, in a user-specific location. If untrusted people can read local data on your computer, you may not wish to install Burp's CA certificate.」

#### In-browser interface（証明書の入手元）
「You can access the Burp Proxy in-browser interface by visiting `http://burpsuite` with the browser, or by entering the URL of your Proxy listener, for example: `http://127.0.0.1:8080`.」
- ここから「a copy of your Burp CA certificate」をダウンロードできる。
- この in-browser interface は Proxy settings で無効化できる（→ Miscellaneous の **Disable web interface at http://burpsuite**）。

#### 12-1. Firefox への CA 証明書インストール
（出典: certificate/ca-cert-firefox.html）

> **Note**: 「If you previously installed a different CA certificate generated by Burp, you should remove it before installing a new one.」= 以前に別の Burp 生成 CA 証明書を入れている場合は、新しいものを入れる前に削除すること。

手順:
1. Burp を動かしたまま、Firefox で `http://burpsuite` にアクセスする。「You should be taken to a page that says "Welcome to Burp Suite Professional".」そうならない場合は proxy troubleshooting ページを参照（自動でそこへ飛ばされることもある）。
2. ページ右上の **CA Certificate** をクリックして、自分固有の Burp CA 証明書をダウンロードする。保存場所をメモする。
3. Firefox でバーガーメニューを開き **Preferences** または **Options** をクリック。
4. 左のナビゲーションバーから **Privacy and Security** 設定を開く。
5. **Certificates** セクションまでスクロールし **View certificates** ボタンをクリック。
6. 開いたダイアログで **Authorities** タブに移動し **Import** をクリック。先ほどダウンロードした Burp CA 証明書を選び **Open**。
7. trust settings の編集を求められたら、**This certificate can identify websites** チェックボックスが選択されていることを確認し **OK**。
8. Firefox を閉じて再起動する。Burp を動かしたまま任意の HTTPS URL にアクセスし、セキュリティ警告なしに閲覧できることを確認する。

**Removing Burp's CA certificate from Firefox**: **View certificates > Authorities** ダイアログに戻り **PortSwigger CA** を選択 → **Delete or Distrust** → **OK** → Firefox を再起動。

#### 12-2. Chrome への CA 証明書インストール（OS 別に分岐）
（出典: certificate/ca-cert-chrome.html）
「The process to install Burp's CA certificate for use with Chrome is different for each operating system.」→ MacOS / Windows / Linux。事前条件は「proxy listener が active であること」「ブラウザが Burp 連携設定済みであること」。

##### 共通: Burp から CA 証明書をエクスポートする手順
1. Burp Suite が動いていることを確認する。
2. Chrome で `http://burpsuite` にアクセスする。
3. 「Welcome to Burp Suite Professional」ページで **CA Certificate** をクリックし、自分固有の Burp CA 証明書をダウンロードする。
4. CA 証明書の保存場所をメモする。

> **Note**: 「If you don't see the "Welcome to Burp Suite Professional" page, please refer to the proxy troubleshooting page. Depending on what went wrong, you may be taken there automatically.」

##### 12-2-a. Chrome — Windows（certificate/ca-cert-chrome-windows.html）
1. Chrome を開き **Customize**（ハンバーガー）メニューへ。
2. **Settings** を選び **Privacy and security** メニューを開く。
3. **Security** メニューから **Manage certificates** を選ぶ。
4. **Trusted Root Certification Authorities** タブを選び **Import** をクリック。
5. **Next** をクリックし、Burp からエクスポートした CA 証明書を参照する。
   > **Note**（重要・逐語）: 「Burp Suite's CA certificate is in `.der` format. You need to set the file filter format to **All Files**.」
6. **Open** をクリック。
7. **Trusted Root Certification Authorities** 証明書ストアが選択されていることを確認し **Next**。
8. **Finish** → **OK**。
9. Chrome を再起動する。

**Removing the CA certificate from Windows**: Chrome → **Customize** → **Settings** → **Privacy and security** → **Security** → **Manage certificates** → 証明書を選択 → **Remove** → **Yes > Yes** で確認 → **Close**。

##### 12-2-b. Chrome — MacOS（certificate/ca-cert-chrome-macos.html）
1. Chrome を開き **Customize**（ハンバーガー）メニューへ。
2. **Settings** を選び **Privacy and security** メニューを開く。
3. **Security** メニューから **Manage certificates** を選ぶ。**Keychain Access** ウィンドウが開く。
4. **System** を選び、次に **Certificates** タブを選ぶ。
5. ダウンロードした証明書を証明書リストにドラッグ＆ドロップし、必要ならパスワードを入力する。
6. **Keychain Access** で `PortSwigger CA` のエントリをダブルクリック。開いたダイアログで **Trust** セクションを展開し **Always trust** オプションを選ぶ。必要ならパスワードを入力する。
7. Chrome を再起動する。
8. Burp を動かしたまま任意の HTTPS URL にアクセスする。うまくいっていればセキュリティ警告なしにページが開く。

**Removing the Burp Suite CA certificate**: 同じ **Manage certificates** → **Keychain Access** → **System** → **Certificates** タブ → 証明書を右クリック → **Delete**（必要ならパスワード入力）。

##### 12-2-c. Chrome — Linux（certificate/ca-cert-chrome-linux.html）
1. Chrome で右上のメニューを開き **Settings** をクリック。
2. Chrome の設定で **Privacy and security > Manage certificates** を選ぶ。
3. **Manage certificates** ダイアログで **Authorities** タブに移動し **Import** ボタンをクリック。
4. **Browse** をクリックし、先ほどダウンロードした `cacert.der` ファイルを選ぶ。次に **Select** をクリック。
5. **Trust this certificate for identifying websites** オプションを選ぶ。
6. **OK** をクリック。「`org-PortSwigger` should now appear on the list of certificate authorities.」
7. Chrome を再起動する。
8. Burp を動かしたまま任意の HTTPS URL にアクセスし、警告なしに開けることを確認する。

**Removing the Burp Suite CA certificate from Linux**: Chrome の **Manage certificates** メニューを開く → **Authorities** タブで `org-PortSwigger` のエントリを探す → 展開して `PortSwigger CA` のハンバーガーメニューをクリック → **Delete** → プロンプトで **OK**。

##### 12-2-d. Safari（certificate/ca-cert-safari.html）
1. Burp を動かしたまま、Safari で `http://burpsuite` にアクセスする（「Welcome to Burp Suite Professional」ページが出るはず）。
2. ページ右上の **CA Certificate** をクリックして自分固有の Burp CA 証明書をダウンロードし、保存場所をメモする。
3. MacOS で **Keychain Access** アプリを開き **Certificates** フォルダに移動する。
4. ダウンロードした証明書をドラッグ＆ドロップで証明書リストにコピーする。
5. **Keychain Access** で **PortSwigger CA** のエントリをダブルクリック。開いたダイアログで **Trust** セクションを展開し **Always trust** オプションを選ぶ。必要ならパスワードを入力する。
6. Safari を再起動する。Burp を動かしたまま任意の HTTPS URL にアクセスし、警告なしに開けることを確認する。

**Removing Burp's CA certificate from Safari**: **Keychain Access** を開く → 左サイドバーで **login** を選択 → 一覧から **PortSwigger CA** のエントリを見つけて右クリック → **Delete PortSwigger CA** → Safari を再起動。

#### 12-3. Having trouble downloading Burp's CA certificate?（トラブルシューティング）
（出典: certificate/proxy-troubleshooting.html）

前提（逐語）: 「In order to access `http://burpsuite` and download the CA certificate, your browser needs to be sending traffic through Burp's proxy listener.」

**Check that Burp is running** — `http://burpsuite` にアクセスするには Burp が動いている必要がある。完全に再起動するか、まだなら起動する。

**Check your proxy listener is active** — Burp で **Settings** ダイアログの **Tools > Proxy** タブへ。**Proxy Listeners** パネルに `127.0.0.1:8080` のエントリがあり **Running** チェックボックスが選択されているべき。そうでなければパネル内のアイコンをクリックし **Restore defaults**。

**Try a different port**（番号付き）:
1. 空いていると判っている別のポートを特定する。
2. Burp で **Settings** ダイアログの **Tools > Proxy** タブへ。
3. **Proxy Listeners** パネルで `127.0.0.1:8080` のエントリを選び **Edit** をクリック。**Edit proxy listener** ダイアログが開く。
4. **Bind to port** フィールドに新しいポート番号を入力し **OK**。
5. **Running** チェックボックスを選択して listener を有効化する。有効化できれば `http://burpsuite` にアクセスできるようになる。
6. チェックボックスで有効化できない場合、入力した新ポートもおそらく塞がれているので別のポートを試す。

**What next?** — 上記すべてを試してもこのページにリダイレクトされる場合は、PortSwigger の technical support team に Support ページから連絡する。

---

### 13. Managing CA certificates（CA 証明書のエクスポート／インポート／再生成／自作）
（出典: /burp/documentation/desktop/tools/proxy/manage-certificates.html ／**Professional**, **Community**）

「Each installation of Burp generates its own CA certificate that Proxy listeners use to negotiate TLS connections.」

> **Note**（逐語）: CA 証明書の管理が必要になるのは次の場合だけ。
> - 「You want to use an external browser, instead of Burp's browser. For the vast majority of users, this isn't necessary.」
> - 「You want to test certain types of network devices or applications.」

#### Exporting and importing the CA certificate（手順）
1. **Proxy** タブから **Proxy Settings** を選ぶ。
2. **Proxy listeners** フィールドに移動し **Import / export CA certificate** ボタンをクリック。
3. **Export** または **Import** の設定を構成する。**Next** をクリック。
4. ファイルの詳細と、必要なら keystore パスワードを入力する。**Next** をクリック。
5. プロンプトで **Close** をクリック。

> **Note**（逐語）: 「You should not disclose the private key for your certificate to any untrusted party. A malicious attacker in possession of your certificate and key may be able to intercept your browser's HTTPS traffic even when you are not using Burp.」

#### CA 証明書の再生成（To regenerate a CA certificate）
1. **Proxy** タブから **Proxy settings** を選ぶ。
2. **Proxy listeners** フィールドに移動し **Regenerate CA certificate** ボタンをクリック。
3. プロンプトで **Yes** をクリック。
4. 変更を有効にするため Burp を再起動する。
5. 新しい証明書をブラウザにインストールする。

#### Creating a custom CA certificate（OpenSSL で自作）
「You can use OpenSSL to create a CA certificate with your own details:」

1. 「Enter the following OpenSSL command to create a self-signed certificate with an unencrypted 2048-bit RSA key, which is valid for 730 days:」

```
openssl req -x509 -days 730 -nodes -newkey rsa:2048 -outform der -keyout server.key -out ca.der
```

2. 「Enter the following OpenSSL command to convert the key from PEM to DER:」

```
openssl rsa -in server.key -inform pem -out server.key.der -outform der
```

3. 「Enter the following OpenSSL command to convert the key to a PKCS8 that contains the key:」

```
openssl pkcs8 -topk8 -in server.key.der -inform der -out server.key.pkcs8.der -outform der -nocrypt
```

4. Burp で **Import / export CA certificate** ボタンをクリックし、**Certificate and private key in DER format** を選ぶ。
5. 証明書ファイルとして `ca.der`、鍵ファイルとして `server.key.pkcs8.der` を選択する。

「Burp loads the custom CA certificate and uses it to generate per-host certificates.」

---

### 14. Proxy settings（Settings > Tools > Proxy の全項目）
（出典: /burp/documentation/desktop/settings/tools/proxy.html ／**Professional**, **Community**）

「The **Proxy** page in the **Settings** dialog contains settings for the following:」

| # | 設定グループ | 保存レベル |
| --- | --- | --- |
| 1 | Proxy listeners | project settings |
| 2 | Request and response interception rules | project settings |
| 3 | WebSocket interception rules | project settings |
| 4 | Response modification rules | project settings |
| 5 | HTTP and WebSocket match and replace rules | project settings |
| 6 | TLS pass through | project settings |
| 7 | Proxy history logging | **user settings**（マシン上の全 Burp インストールに適用） |
| 8 | Default Proxy interception state | **user settings** |
| 9 | Miscellaneous | project settings |

〔補足（一般知識）〕project settings は project file に保存され当該プロジェクトのみに適用、user settings はユーザープロファイル側に保存され全プロジェクトに適用される。教科書では「設定が新プロジェクトに引き継がれないなら project 設定、全プロジェクトに付いてくるなら user 設定」と覚えさせるとよい。

#### 14-1. Proxy listeners

定義（逐語）: 「A proxy listener is a local HTTP proxy server that listens for incoming connections from the browser. It enables you to monitor and intercept all requests and responses.」

「By default, Burp creates a single listener on **port 8080** of the **loopback interface**. The default listener enables you to use Burp's browser to test virtually all browser-based web applications.」

関連ページ: **Penetration testing workflow**、**Configuring Burp to work with an external browser**。

「You may need to create or configure listeners when you test unusual applications, or work with non-browser-based HTTP clients. Use the **Add** and **Edit** buttons to open the **Add a new proxy listener** dialog. You can configure the proxy listener settings in the dialog tabs.」

##### Binding（バインド）
「These settings control how Burp binds the proxy listener to a local network interface:」

| 設定 | 説明（逐語ベース） |
| --- | --- |
| **Bind to port** | 「Specify a port on the local interface. Burp opens the port to listen for incoming connections. Make sure you use a free port that has not been bound by another application.」 |
| **Bind to address** | ローカルインターフェースの IP アドレスを指定。選択肢は ① **The loopback interface only.** ② **All interfaces.** ③ **A specific local IP address.** |

> **Note**（逐語）: 「If the listener is bound to all interfaces or to a specific non-loopback interface, other computers may be able to connect to the listener.」

→ **all interfaces / 非 loopback にバインドすると他のコンピュータから接続され得る**（= 意図しない開放プロキシになる）。

##### Request handling（リクエストの転送先制御）
「These settings control whether Burp redirects the requests received by the listener:」

| 設定 | 説明（逐語ベース） |
| --- | --- |
| **Redirect to host** | ホストを指定。「Burp forwards every request to the host, regardless of the target requested by the browser.」／注記: 「If you redirect requests to a server that expects a different `Host` header to the one sent by the browser, you may need to configure a match and replace rule to rewrite the `Host` header in requests.」 |
| **Redirect to port** | ポートを指定。「Burp forwards every request to the port, regardless of the target requested by the browser.」 |
| **Force use of TLS** | 「Enable this setting to use HTTPS in all outgoing connections, even if the incoming request uses HTTP.」／注記: 「To carry out sslstrip-like attacks, use this option with the TLS-related response modification settings. This type of attack downgrades an application that enforces HTTPS to plain HTTP, for a victim whose traffic is unwittingly being proxied through Burp.」 |
| **Support invisible proxying** | 「This setting enables non-proxy-aware clients to connect directly to the listener.」（詳細は Burp Proxy: invisible proxying） |

「The redirection options can be used individually. For example, you can redirect all requests to a particular host while preserving the request's port and protocol.」

##### Certificate（クライアントに提示するサーバ証明書）
「These settings control the server TLS certificate that is presented to TLS clients. You can use these settings to resolve some TLS issues that arise when you use an intercepting proxy.」

> **Note**（逐語）: 「In Burp's browser, you may notice that HTTPS is struck-through in the address bar as a TLS alert. This alert arises because the browser detects that it is not communicating directly with the authentic web server. This isn't an issue: it's a result of deliberately proxying your traffic through Burp. You can ignore it and continue to use the browser as usual.」

→ アドレスバーの HTTPS 取り消し線は正常。無視してよい。

| オプション | 説明（逐語ベース） |
| --- | --- |
| **Use a self-signed certificate** | 「Burp presents a self-signed certificate to your browser. This always causes a TLS alert.」 |
| **Generate CA-signed per-host certificates** | **既定**。「Burp creates a unique, self-signed Certificate Authority (CA) certificate on installation. The certificate is stored on your computer for use each time Burp is run. When your browser makes a TLS connection, Burp generates a TLS certificate for the host, signed by the CA certificate.」 |
| **Generate a CA-signed certificate with a specific hostname** | ホスト名を指定し、すべての TLS 接続に使う単一のホスト証明書を生成する。「Use this option if you perform invisible proxying, as the client does not send a CONNECT request, so Burp can't identify the required hostname prior to the TLS negotiation.」 |
| **Use a custom certificate** | 提示する特定の証明書を読み込む。「Note that the certificate must be in in PKCS#12 format with a `.p12` file extension; certificates in `.psx` format are not supported.」用途: 「Use this option if the application uses a client that requires a specific server certificate with, for example, a given serial number or certification chain.」 |

関連ページ: **Installing Burp's CA certificate**、**Managing CA certificates**。

##### TLS Protocols
「These settings control the TLS protocols that Burp uses to perform TLS negotiation with the browser.」
- **Use the default protocols of your Java installation**.
- **Use custom protocols**. 「Select the required protocols from the list.」

##### HTTP
「This setting controls whether the proxy listener allows clients to use HTTP/2. It is enabled by default.」
- 「You may want to disable this in certain cases, such as when a client has problems with its HTTP/2 implementation.」
- 「This setting does not change the connection between Burp and the server.」（Burp ↔ サーバ間は **HTTP settings** 側で変更する）

#### 14-2. Request and response interception rules（何を止めるか）

「The **Request interception rules** and **Response interception rules** settings control which messages are stalled for you to view and edit in the **Proxy > Intercept** tab.」

##### Adding an interception rule（手順・番号付き）
1. **Intercept requests / responses based on the following rules** を選択し、どのメッセージを intercept するか決めるルールを構成する。
2. **Add** をクリックして **Add request interception rule** ダイアログを開く。
3. ルールの詳細を指定する:

| 項目 | 説明（逐語ベース） |
| --- | --- |
| **Boolean operator** | 「The operator that Burp uses to combine the rule to the rule above. You can choose from **AND** and **OR**.」 |
| **Match type** | 「The attribute of the message that the rule attempts to match on. For example, the domain name, IP address, or protocol.」 |
| **Match relationship** | 「This can be either Matches or Does not match.」 |
| **Match condition** | 「The value that the rule uses when matching. You can use regular expressions to define complex matching conditions.」 |

4. **OK** をクリックしてルールを作成する。

「Burp applies the enabled rules to the message to determine whether it should be intercepted. **Each rule is combined to the rules above in order, using the selected boolean operator.**」
- 各ルール左のチェックボックスで有効／無効を切り替える。**Edit**、**Remove** も可能で、**Up** / **Down** ボタンで並べ替えられる（**順序が結果に影響する**）。

##### Modifying intercepted messages（改変時の自動補正）
「These settings enable you to avoid invalid requests and responses being issued when you modify an intercepted message.」

| 設定 | 説明（逐語ベース） |
| --- | --- |
| **Automatically update Content-Length header when the request / response is edited** | 「Enable this setting to automatically update the `Content-Length` header with the correct length of the message's HTTP body. This is normally essential when the HTTP body is modified.」 |
| **Automatically fix missing or superfluous new lines at end of request** | 編集時によくある誤りを自動修正する。具体的には ① 「Burp adds a blank line following the headers if there is not one already present.」 ② 「Burp removes any newline characters at the end of a body containing URL-encoded parameters.」 |

#### 14-3. WebSocket interception rules

「These settings control which WebSocket messages Burp holds for viewing and editing in the **Intercept** tab:」

| 設定 | 説明 |
| --- | --- |
| **Intercept client-to-server messages** | クライアント→サーバのメッセージを intercept する |
| **Intercept server-to-client messages** | サーバ→クライアントのメッセージを intercept する |
| **Only intercept in-scope messages** | 「Select this setting if you only want to intercept WebSocket messages where the `upgrade` request is within the target scope of the project. Out-of-scope messages will not be held. Deselect this setting if you want to intercept all WebSocket messages, regardless whether they are within your project's target scope or not.」 |

→ **スコープ判定は「`upgrade` リクエストが target scope 内かどうか」で行われる**点が重要。

#### 14-4. Response modification rules（クライアントサイド制御の無効化 — ch06 の核心）

「These settings control whether Burp automatically rewrites the HTML in application responses.」

##### データに対するクライアントサイド制御を取り除く設定
「You can use the following settings to remove client-side controls over data:」

| 設定 | 補足 |
| --- | --- |
| **Unhide hidden form fields** | 「You can also select **Prominently highlight unhidden fields**, for easy identification on-screen.」 |
| **Enable disabled form fields** | disabled 属性のフォームフィールドを有効化する |
| **Remove input field length limits** | 入力フィールドの長さ制限を除去する |
| **Remove JavaScript form validation** | JavaScript によるフォームバリデーションを除去する |

##### テスト目的でクライアントサイドロジックを無効化する設定
「You can use the following settings to disable client-side logic for testing purposes:」

| 設定 |
| --- |
| **Remove all JavaScript** |
| **Remove `<object>` tags** |

> **Note**（逐語）: 「These features are not designed to be used as a security defense in the manner of, for example, NoScript.」

→ これらは NoScript のようなセキュリティ防御として使う設計ではない。

##### sslstrip 風の攻撃を届けるための設定
「You can use the following settings to deliver sslstrip-like attacks against a victim user whose traffic is unwittingly being proxied via Burp. Use these settings with the listener's **Force use of TLS setting** to effectively strip TLS from the user's connection:」

| 設定 |
| --- |
| **Convert HTTPS links to HTTP** |
| **Remove secure flag from cookies** |

〔補足（一般知識）〕これらは「許可された検証」の枠内でのみ使う機能である。TLS ストリップは被害者の通信を平文化するため、対象と範囲の明示的な許諾（バグバウンティのスコープ／ペネトレーションテスト契約）がない場合に他者のトラフィックへ適用してはならない。診断目的では「HTTPS を強制しているはずのアプリが、リンク書き換えや Secure フラグ除去に耐えるか（HSTS が効いているか）」の確認に使う。

#### 14-5. HTTP and WebSocket match and replace rules

「The **HTTP match and replace rules** and **WebSocket match and replace rules** settings automatically replace parts of messages as they pass through the Proxy.」

- 「The HTTP match and replace rules include various **predefined rules** which you can enable to assist with common tasks. **These are disabled by default.**」
- 「To only apply match and replace rules to items that are in the project scope, select **Only apply to in-scope items**.」（スコープ設定の詳細は **Scope settings - Target scope**）

##### Adding a match and replace rule（手順・番号付き）
「Each match and replace rule specifies a literal string or regex pattern to match, and a string to replace it with.」

1. **Add** をクリックして **Add match/replace rule** ダイアログを開く。
2. ルールの詳細を指定する:

| 項目 | 説明（逐語ベース） |
| --- | --- |
| **Type** | HTTP リクエストの場合、定義したいルールの種類を指定する。例: **Request header** または **Response body**。 |
| **Direction** | WebSocket メッセージの場合、ルールを適用するメッセージの方向を指定する。**Client to server** / **Server to client** / **Both directions** から選ぶ。 |
| **Match** | 「The string or regex pattern you want the rule to match. If you leave this blank for an HTTP rule with the **Request header** or **Response header** type, the replacement string is added as a new header.」 |
| **Replace** | 「The string you want the rule to replace. If you leave this blank for an HTTP rule with the **Request header** or **Response header** type, then any header that matches is removed.」 |
| **Comment** | ルールの任意の説明。 |

3. match パラメータを正規表現として扱わせたい場合は **Regex match** を選択する。
4. **OK** をクリック。「The new rule is automatically enabled.」

「Burp executes the enabled match and replace rules **in turn** for each message, and makes any applicable replacements.」**Edit** / **Remove** / **Up** / **Down** による編集と並べ替えも可能。

→ **ヘッダ操作のイディオム（教科書に必須）**: Match を空にすれば **ヘッダ追加**、Replace を空にすれば **ヘッダ削除**。

##### Matching multi-line regions（複数行マッチ）
「You can use regex syntax to match multi-line regions of a message body. For example, if a response body contains only:」

```
Now is the time for all good men
to come to the aid of the party
```

「then using the regex:」

```
Now.*the
```

「will match:」

```
Now is the time for all good men
to come to the aid of the
```

「If you want to match only within a single line, you can modify the regex to:」

```
Now[^\n]*the
```

「which will match:」

```
Now is the
```

##### Using regex groups in back-references and replacement strings
**Match** 式では:
- 「Define groups using parentheses. Burp assigns groups a **1-indexed** reference number in order from left to right (with **group 0** representing the entire match).」
- 「Back-reference groups. Use a backslash followed by the group's index.」

「For example, to match a pair of opening and closing tags with no other tags between, you could use the regex:」

```
<([^/]\w*)[^>]*>[^>]*?</\1[^>]*>
```

「You can reference groups in the replacement string by using a `$` followed by the group index. For example, the following replacement string would include the name of the tag that matched the above regex:」

```
Replaced: $1
```

#### 14-6. TLS pass through

定義と利点（逐語）: 「TLS passthrough sends traffic through Burp Suite **without decrypting it or altering it in any way**. This has three major benefits:」

1. 「Performance improves dramatically.」
2. 「Servers see the browser's original TLS fingerprint, which enables you to bypass some anti-bot defenses.」
3. 「You can eliminate TLS errors on the client. For example, in mobile applications that perform TLS certificate pinning.」

「If the application accesses multiple domains or uses both HTTP and HTTPS connections, you can pass through TLS connections to specific problematic hosts, and still work on other traffic as normal.」

使い方は2通り:
- 「Add specific TLS passthrough targets.」
- 「Apply TLS passthrough to all out-of-scope items.」

> **Note**（重大な副作用・逐語）: 「The Proxy intercept view and Proxy history do not display any details about requests or responses made via these connections.」

##### Adding TLS passthrough targets（手順）
「To add a new TLS passthrough target, copy the URL and then click **Paste URL** to add the relevant web server to the list.」手動での構成:

1. **Add** をクリックして **Add TLS passthrough target dialog** を表示する。
2. ターゲットの詳細を指定する:
   - **Host or IP range** — 「This can be a regex or an IP range. Leave blank to match any item.」
   - **Port** — 「The port that TLS passthrough should apply on. Leave blank to match any item.」
3. **OK** をクリックしてリストにターゲットを追加する。

「You can **Edit** and **Remove** targets from the list. To upload a **CSV or text list** of targets, click **Load** and select the relevant file from the dialog.」

- **Automatically add entries on client TLS negotiation failure** — 「Select ... to add the relevant server to the TLS pass through list when a client fails a TLS negotiation. A TLS negotiation may fail, for example, if **Burp's CA certificate is not recognized**.」

##### Applying TLS passthrough to out-of-scope items（手順）
「You can apply TLS passthrough for out-of-scope items automatically when you set the target scope:」

1. **Target > Site map** または **Proxy > HTTP history** から、target scope に追加したいホストを選択する。
2. 選択を右クリックし **Add to scope** を選ぶ。**Proxy history logging** ウィンドウが現れる。
3. **Yes** をクリックして out-of-scope items に TLS passthrough を適用する。

これにより **Settings > Proxy** メニューで次の設定が有効になる:
- **Miscellaneous > Don't send items to Proxy history or live tasks, if out of scope**.
- **TLS pass through > Apply to out-of-scope items** — 「this can only be enabled when the setting above is enabled.」（**上の設定が有効なときにのみ有効化できる**）

#### 14-7. Proxy history logging（user settings）

「Use this setting to manage whether Burp Proxy sends out-of-scope items to the history or live tasks when new items are added to the target scope. This enables you to avoid accumulating project data for out-of-scope items.」

3つの選択肢:
- **Stop logging out-of-scope items**.
- **Ask me what to do each time**.
- **Do nothing**.

#### 14-8. Default Proxy interception state（user settings）

「Use this setting to choose whether Burp Proxy interception is enabled by default when you start Burp.」

3つの選択肢:
- **Enable interception**.
- **Disable interception**.
- **Restore the setting that was selected in the Proxy > Intercept tab when Burp closed**.

#### 14-9. Miscellaneous（Proxy の挙動細部・全項目を逐語で）

「These settings control various aspects of Burp Proxy's behavior:」

| 設定 | 説明（逐語ベース） |
| --- | --- |
| **Use HTTP/1.0 in requests to server** | 「Enable this setting to use HTTP version 1.0 in requests to destination servers. This may be useful when working with legacy servers or applications that require version 1.0 to function correctly.」 |
| **Use HTTP/1.0 in responses to client** | 「Enable this setting to use HTTP version 1.0 in responses. All current browsers support both version 1.0 and 1.1 of HTTP, however version 1.0 has a reduced feature set. A reduced feature set can help you to control aspects of a browsers' behavior, for example to prevent attempts to perform HTTP pipelining.」 |
| **Use keep-alive for HTTP/1 if the server supports it** | 「By default, Burp reuses HTTP/1 connections for outbound requests from the proxy. This may improve browser load times.」 |
| **Set response header "Connection: close"** | 「Enable this setting to add or update the response `Connection` header with the value `close`. This can enable you to prevent HTTP pipelining in some situations.」 |
| **Set "Connection: close" on incoming requests** | 「By default, Burp adds or updates the request `Connection` header with the value `close`. This can enable you to prevent HTTP pipelining in some situations.」 |
| **Strip Proxy-\* headers in incoming requests** | 「By default, Burp strips `Proxy-*` headers from incoming requests. This prevents leakage of any information, as browsers sometimes send request headers containing information intended for the proxy server. A malicious website may attempt to induce a browser to include sensitive data within these headers.」 |
| **Remove unsupported encodings from Accept-Encoding headers in incoming requests** | 「By default, Burp removes encodings that cause problems when Burp processes responses. This reduces the chance that they are used. You may need to de-select this setting if a server requires an unsupported encoding.」 |
| **Strip Sec-WebSocket-Extensions headers in incoming requests** | 「By default, Burp removes this header. This reduces the chance that extensions relating to WebSocket connections are used, as some encodings cause problems when processing responses in Burp. You may need to de-select this setting if a server requires a particular extension.」 |
| **Unpack compressed requests** | 「Enable this setting to automatically unpack compressed request bodies, which are often present in applications using custom client components. Burp can unpack requests that have been compressed using **gzip, Deflate, or Brotli**. Note that some applications may experience issues if they expect a compressed body but the compression has been removed.」 |
| **Unpack compressed in responses** | 「Enable this setting to automatically unpack compressed response bodies. Burp can unpack responses that have been compressed using **gzip, Deflate, or Brotli**. Note that you can often prevent servers from compressing responses - use a match and replace rule to remove the `Accept-Encoding` header from requests.」 |
| **Disable web interface at http://burpsuite** | 「This setting may be useful if you need to configure your listener to accept connections on an unprotected interface, and wish to prevent others gaining access to Burp's in-browser interface.」 |
| **Suppress Burp error messages in browser** | 「Enable this setting to suppress the messages that are usually sent to the browser when errors occur. This may be useful if you wish to run Burp in stealth mode in order to perform man-in-the-middle attacks against a victim user.」 |
| **Don't send items to Proxy history or live tasks** | 「If you enable this setting, Burp can't log requests in the Proxy history or send them to live tasks. This enables you to limit the memory and storage overhead. This may be useful, for example, if you are using Burp to authenticate upstream servers or perform match-and-replace operations.」 |
| **Don't send items to Proxy history or live tasks, if out of scope** | 「If you enable this setting, Burp doesn't log any out-of-scope requests in the Proxy history or send them to live tasks. This enables you to avoid accumulating project data for out-of-scope items. This option is selected automatically when you set the target scope, and stop logging the proxy history for out-of-scope items.」 |

---

### 15. HTTP history（列の完全一覧・レイアウト・カスタム列）
（出典: /burp/documentation/desktop/tools/proxy/http-history/index.html ／**Professional**, **Community**）

「You can use the **HTTP history** to see a record of the HTTP traffic that has passed through Burp Proxy. You can also see any modifications that you made to intercepted messages.」

#### HTTP history の列一覧（原文の順序どおり・全19項目）

| 列 | 意味（逐語ベース） |
| --- | --- |
| **#** | 「The request index number.」 |
| **Host** | 「The protocol and server hostname.」 |
| **Method** | 「The HTTP method.」 |
| **URL** | 「The URL file path and query string.」 |
| **Params** | 「Flag whether the request contains any parameters.」 |
| **Edited** | 「Flag whether the request or response were modified by the user.」 |
| **Status code** | 「The HTTP status code of the response.」 |
| **Length** | 「The length of the response in bytes.」 |
| **MIME type** | 「The MIME type of the response.」 |
| **Extension** | 「The URL file extension.」 |
| **Title** | 「The page title (for HTML responses).」 |
| **Notes** | 「Any user-applied note.」 |
| **TLS** | 「Flag whether TLS is used.」 |
| **IP** | 「The IP address of the destination server.」 |
| **Cookies** | 「Any cookies that were set in the response.」 |
| **Time** | 「The time the request was made.」 |
| **Listener port** | 「The listener port on which the request was received.」 |
| **Start response timer** | 「The time in milliseconds from when the request was sent until the first byte of the response is received.」 |
| **End response timer** | 「The time in milliseconds from when the request was sent until the complete response was received.」 |

（**Start/End response timer** はレイテンシ分析・タイミング差の観察に有用。）

重要な性質（逐語）: 「The HTTP history is **always updated, even if Intercept is off**. This enables you to browse without interruption while you monitor key details about application traffic.」
「Right-click any item in the table to access further options, such as sending requests to other Burp tools.」

#### Changing the HTTP history layout（テーブル操作の全手段）

| 操作 | 手順（逐語ベース） |
| --- | --- |
| **Hide columns** | 隠したい列のヘッダを右クリックし **Hide column** を選ぶ。 |
| **Show hidden columns** | options メニュー **> Table layout** をクリックし、表示したい列を選ぶ。 |
| **Move columns** | 移動したい列のヘッダを新しい位置へドラッグ＆ドロップする。 |
| **Add custom columns** | options メニュー **> Add custom column** をクリックして、見たいデータを表示する独自列を作る。 |
| **Sort the table** | ソートしたい列のヘッダをクリック。昇順・降順・ソートなしを切り替えられる。 |
| **Filter the data** | **Filter settings** バーをクリックし、**Settings mode**（定義済みチェックボックスとフィールドで条件指定）または **Bambda mode**（Java ベースの Bambda でカスタムフィルタ）を選ぶ。 |
| **Restore the default layout** | **> Table layout** をクリックし **Restore default table** を選ぶ。 |

#### Viewing a request
「If you select an item from the HTTP history, the lower pane shows the request and response messages for the item. **Any modified messages are shown separately.**」改変の経路は3つ:
- **User interception**（ユーザーによる intercept 時の編集）
- **Automatic response modification**（Response modification rules）
- **Match and replace rules**

さらに可能な操作:
- 「Double-click an item to open it in a pop-up window.」
- 「Right-click a request and select **Show new history window** to open a new history window with its own display filter.」（**独自の display filter を持つ別履歴ウィンドウ**）
- 「Access the Inspector, to easily view and edit interesting items.」
- 「View and edit your notes. To do this, click **Notes**.」

#### Adding a custom column（**Professional** のみ・Bambda）
「You can create your own custom columns using Bambdas. Custom columns enable you to see more detail about the items in your HTTP history for a more focused analysis of what's important to you.」

利用できる Montoya API のオブジェクト2つ（逐語）:
- `ProxyHttpRequestResponse`
- `Utilities`

手順:
1. **Proxy > HTTP history** で options メニュー **> Add custom column** をクリック。**Add custom column** ウィンドウが開く。
2. **Column header** フィールドに独自列の名前を入力する。
3. その列が表示するデータを指定する Bambda を書く。

##### Example Bambda（レスポンスの `Server` ヘッダ値を表示する列・逐語）

```
if (!requestResponse.hasResponse()) {
    return "";
}

var response = requestResponse.response();

return response.hasHeader("Server")
    ? response.headerValue("Server")
    : "";
```

---

### 16. Filtering the HTTP history（Settings mode / Bambda mode）
（出典: /burp/documentation/desktop/tools/proxy/http-history/filter-settings.html ／**Professional**, **Community**）

「The filter bar above the list of interactions describes the current display filter. To configure this, click the filter bar to open the **HTTP history filter** window.」
「The **HTTP history filter** window has two tabs - **Settings mode** and **Bambda mode**.」

> 重要（逐語）: 「The filters **only control what is displayed**. If you hide items, they are not deleted: they reappear if you reset the filter.」

#### Settings mode の全フィルタ項目

| フィルタ | 内容 |
| --- | --- |
| **Filter by request type** | 表示対象を絞る: ① in-scope の項目のみ ② レスポンスがある項目のみ ③ パラメータを持つリクエストのみ |
| **Filter by MIME type** | 「You can show or hide responses containing various different MIME types, such as HTML, CSS, or images.」 |
| **Filter by status code** | 「You can show or hide responses with various HTTP status codes.」 |
| **Filter by search term** | ① 指定した検索語を含むレスポンスをフィルタ ② リテラル文字列または正規表現を使用 ③ 大文字小文字を区別（case-sensitive）にできる ④ **Negative search** を選ぶと検索語に一致しない項目だけを表示 |
| **Filter by file extension** | 「You can show or hide items based on their file extension.」 |
| **Filter by annotation** | 「This enables you to only show items with notes or highlights.」 |
| **Filter by listener** | 「You can show items received on a specific listener port. **This can be useful when testing access controls.**」 |

#### Bambda mode
「Bambda mode enables you to write powerful, custom filters for your HTTP history using Java.」

#### Adding annotations（履歴項目への注釈）
ハイライト手順:
1. **HTTP history** タブで一覧から履歴項目を選択する。
2. 項目を右クリックし **Highlight** を選ぶ。
3. 一覧から色を選ぶ。

ノート追加手順:
1. **HTTP history** タブで一覧から履歴項目を選択する。
2. **Notes** をクリックする。
3. **Notes** パネルにコメントを入力する。

「You can also annotate items as they appear in the Intercept tab. These automatically appear in the HTTP history.」

---

### 17. Filtering the HTTP history with Bambdas
（出典: /burp/documentation/desktop/tools/proxy/http-history/bambdas.html ／**Professional**, **Community**）

「You can write Java-based Bambdas to create custom filters for your HTTP history.」利用可能な Montoya API オブジェクト: `ProxyHttpRequestResponse`、`Utilities`。

手順:
1. **Proxy > HTTP history** タブでフィルタバーをクリックし **HTTP history filter** ウィンドウを開く。「The filter bar only appears when there is one or more messages in your HTTP history.」
2. **HTTP history filter** ウィンドウで **Bambda mode** タブをクリック。
3. Java で Bambda を書く。
4. **Apply** をクリック。

「Burp compiles your Bambda and applies it to **every item already logged** in your HTTP history, and to **any future HTTP traffic** generated in this project.」

> **Warning**（逐語）: 「Using slow running or resource-intensive Bambdas can slow down Burp. Write your Bambda carefully to minimize performance implications.」

#### Example Bambda（条件3つ: レスポンスがある／3XX／`session` クッキーが設定されている）

条件（逐語）:
- 「The request must have a response.」
- 「The response must have a `3XX` status code.」
- 「The response must have a cookie set with the name `session`.」

Bambda（逐語）:

```
if (!requestResponse.hasResponse()) {
    return false;
}

var response = requestResponse.response();
return response.isStatusCodeClass(StatusCodeClass.CLASS_3XX_REDIRECTION) && response.hasCookie("session");
```

#### Converting HTTP history filter settings to Bambdas
> **Note**: 「Converting your filter settings **overwrites any existing Bambda** in your HTTP history.」

手順:
1. **Proxy > HTTP history** タブでフィルタバーをクリックし **HTTP history filter** ウィンドウを開く。
2. 必要ならフィルタ設定を変更する。
3. **HTTP history filter** ウィンドウの下部で **Convert to Bambda** をクリックする。

---

### 18. WebSockets history（列の完全一覧・カスタム列）
（出典: /burp/documentation/desktop/tools/proxy/websockets-history/index.html ／**Professional**, **Community**）

「You can use the **WebSockets history** to see a record of any WebSocket messages Burp's browser exchanges with web servers. You can use it to view, intercept, and modify the communication between Burp's browser and web servers. This enables you to:」
- 「Study the behavior of a target website.」
- 「Look for vulnerabilities in WebSockets handshakes and messages.」
- 「Send interesting messages to other tools in Burp Suite for further testing.」

#### WebSockets history の列一覧（原文の順序どおり・全10項目）

| 列 | 意味（逐語ベース） |
| --- | --- |
| **#** | 「The request index number.」 |
| **URL** | 「The URL of the WebSocket connection.」 |
| **Direction** | 「The direction of the message (outgoing versus incoming).」 |
| **Edited** | 「Flag whether the message was modified by the user.」 |
| **Length** | 「The length of the response in bytes.」 |
| **Notes** | 「Any user-applied note.」 |
| **TLS** | 「Flag whether TLS is used.」 |
| **Time** | 「The time the message was received.」 |
| **Listener port** | 「The listener port on which the message was received.」 |
| **WebSocket ID** | 「Burp's internal ID for the WebSocket that was used for the message.」 |

「The WebSockets history is **always updated, even if Intercept is off**.」

#### Changing the WebSockets history layout
HTTP history と同一の手段: **Hide columns** / **Show hidden columns**（options メニュー **> Table layout**）/ **Move columns**（ドラッグ＆ドロップ）/ **Add custom columns**（options メニュー **> Add custom column**）/ **Sort the table** / **Filter the data**（**Settings mode** または **Bambda mode**）/ **Restore the default layout**（**> Table layout** → **Restore default table**）。

#### Viewing a request
「If you select an item from the WebSockets history, the lower pane shows the relevant message. Any modified messages are shown separately.」改変経路は **User interception** / **Automatic response modification** / **Match and replace rules**。
追加操作: ダブルクリックでポップアップ表示、右クリック **Show new history window**（独自 display filter 付き）、**Inspector** の利用、**Notes** の閲覧・編集。

#### Adding a custom column（**Professional**）
利用できる Montoya API のオブジェクト2つ（逐語）:
- `ProxyWebSocketMessage`
- `Utilities`

手順:
1. **Proxy > WebSockets history** で options メニュー **> Add custom column** をクリック。
2. **Column header** フィールドに名前を入力する。
3. 表示するデータを指定する Bambda を書く。

##### Example Bambda（レスポンスの **session ID** を取り出す列・逐語）

```
Pattern pattern = Pattern.compile("\"sid\":\"(\\w.*)\"");
Matcher matcher = pattern.matcher(message.payload().toString());
matcher.find();

if (matcher.hasMatch())
{
    return matcher.group(1);
}

return "";
```

---

### 19. Filtering the WebSockets history / with Bambdas
（出典: /burp/documentation/desktop/tools/proxy/websockets-history/filter-settings.html および /websockets-history/bambdas.html ／**Professional**, **Community**）

「The **WebSockets history filter** window has two tabs - **Settings mode** and **Bambda mode**.」
> 「The filters only control what is displayed. If you hide items, they are not deleted: they reappear if you reset the filter.」

#### Settings mode の全フィルタ項目

| フィルタ | 内容 |
| --- | --- |
| **Filter by request type** | ① in-scope の項目のみ ② incoming メッセージのみ ③ outgoing メッセージのみ |
| **Filter by search term** | ① 指定検索語を含むレスポンスをフィルタ ② リテラル文字列または正規表現 ③ case-sensitive 化 ④ **Negative search**（一致しない項目のみ表示） |
| **Filter by annotation** | notes や highlights がある項目のみ表示 |
| **Filter by listener** | 特定の listener port で受信した項目を表示。「This can be useful when testing access controls.」 |

#### Bambda mode の手順
1. **Proxy > WebSockets history** タブでフィルタバーをクリックし **WebSockets history filter** ウィンドウを開く（フィルタバーは履歴に1件以上メッセージがあるときにのみ現れる）。
2. **Bambda mode** タブをクリック。
3. Java で Bambda を書く。
4. **Apply** をクリック。

「Burp compiles your Bambda and applies it to every item already logged in your WebSockets history, and to any future WebSockets traffic generated in this project.」
> **Warning**: 「Using slow running or resource-intensive Bambdas can slow down Burp.」

##### Example Bambda（サーバ送信かつ payload 長 > 300）

条件（逐語）: 「The message must be sent from the server.」「The message payload length must be greater than `300` characters.」

```
return message.payload().length() > 300 && message.direction() == Direction.SERVER_TO_CLIENT;
```

#### Converting filter settings to Bambdas
> **Note**: 「Converting your filter settings overwrites any existing Bambda in your WebSockets history.」

手順: **Proxy > WebSockets history** → フィルタバーをクリック → （必要なら設定変更）→ ウィンドウ下部の **Convert to Bambda** をクリック。

---

### 20. Invisible proxying（proxy 非対応クライアントを扱う）
（出典: /burp/documentation/desktop/tools/proxy/invisible.html ／**Professional**, **Community**）

定義（逐語）: 「Burp's support for invisible proxying allows non-proxy-aware clients to connect directly to a Proxy listener. This is useful if the target application uses a thick client component that runs outside of the browser, or a browser plugin that makes HTTP requests outside of the browser's framework. Often, these clients don't support HTTP proxies, or don't provide an easy way to configure them.」

#### Redirecting inbound requests（入り口をこちらに向ける）
「You can force the non-proxy-aware client to connect to Burp. **Modify your DNS resolution** to redirect the relevant hostname, and set up invisible Proxy listeners on the ports used by the application.」

例（逐語）: アプリが `example.org` を使い、HTTP/HTTPS が標準ポートの場合、hosts ファイルに次のエントリを追加する:

```
127.0.0.1 example.org
```

「To receive the redirected requests, create invisible Burp Proxy listeners on `127.0.0.1:80` and `127.0.0.1:443`. The non-proxy-aware client then resolves the domain name to your local IP address, and sends requests directly to your listeners on that interface.」

#### Invisible proxy mode（なぜ専用モードが必要か）
「It's easy to use DNS to redirect client requests to the local listeners, but the need for a special invisible proxy mode arises because the resulting requests will not be in the form that is expected by an HTTP proxy.」

プロキシ形式のリクエスト（plain HTTP・逐語）:

```
GET http://example.org/foo.php HTTP/1.1
Host: example.org
```

対応する非プロキシ形式のリクエスト（逐語）:

```
GET /foo.php HTTP/1.1
Host: example.org
```

「Normally, web proxies use the **full URL in the first line** of the request to determine the destination host. They do not look at the Host header to determine the destination. If you enable invisible proxying, when Burp receives any non-proxy-style requests it parses out the contents of the Host header. It uses the Host header as the destination host for that request.」

HTTPS の場合（逐語）: 「If you use HTTPS with a proxy, clients send a **CONNECT** request that identifies the destination host and then perform TLS negotiation. However, non-proxy-aware clients proceed directly to TLS negotiation, believing they are communicating directly with the destination host. If you enable invisible proxying, Burp tolerates direct negotiation of TLS by the client, and parses out the contents of the Host header from the decrypted request.」

#### Redirecting outbound requests（無限ループの解消）
「In invisible mode, Burp forwards requests to destination hosts based on the Host header parsed out of each request. However, because you have modified the hosts file entry for the relevant domain, Burp resolves the hostname to the local listener address. Unless configured differently **it forwards the request back to itself. This creates an infinite loop.**」

解決方法は2つ:
1. 「In some cases, all the invisibly proxied traffic heads for a single domain. The non-proxy-aware client only ever contacts a single domain. You can use the **Proxy listener's redirection settings** to force the outgoing traffic to go to the correct IP address.」
2. 「In some cases, the proxied traffic heads for multiple domains. You can use **Burp's own hostname resolution settings** to override the hosts file and redirect each domain individually back to its correct original IP address.」

##### Host ヘッダが無いクライアントへの対処
「A related problem arises if the non-proxy-aware client **does not include a Host header** in its requests. If Burp processes non-proxy-style requests without this header, it cannot determine which destination host to forward the requests to.」

- 全リクエストが同じ宛先に行くべき場合: Proxy listener の redirection settings で正しい IP アドレスに強制する。
- リクエストごとに宛先が異なる場合は **複数の Proxy listener** を使う（手順・逐語ベース）:
  1. 「Create a separate virtual network interface for each destination host. Most operating systems let you create additional virtual interfaces with loopback-like properties. Alternatively, this is possible in virtualized environments.」
  2. 「Create a separate Proxy listener for each interface, or two listeners if HTTP and HTTPS are both in use.」
  3. 「Use your hosts file to redirect each destination hostname to a different listener.」
  4. 「Configure the listener on each interface to redirect all traffic to the IP address of the host whose traffic was redirected to it.」

#### Handling TLS certificates（invisible 時の証明書問題）
「You can use various configurations for the server TLS certificates used by Burp Proxy listeners. The default configuration automatically generates a certificate for each destination host. **This may not work with invisible proxying.** Non-proxy-aware clients negotiate TLS directly with the listener, without first sending a CONNECT request to identify the destination host.」

「Many clients, including browsers, support the **"server_name" extension** in the **Client Hello** message. This identifies the destination host that the client wishes to negotiate with. If this extension is present, Burp uses it to generate a certificate for that host in the normal way. **If the extension is not present, Burp fails over to use a static self-signed certificate instead.**」

解決方法は2つ:
1. 「If all HTTPS requests are to the same domain, you can configure the invisible listener to **generate a CA-signed certificate with the specific hostname** used by the application.」
2. 「If HTTPS requests are to different domains, create an invisible Proxy listener with a different virtual network interface for each destination host. Configure each listener to generate a CA-signed certificate with the specific hostname that traffic is being redirected to.」

---

### 21. 補助: Connections settings（invisible proxying と外部プロキシ環境で必要）
（出典: /burp/documentation/desktop/settings/network/connections.html ／**Professional**, **Community**）

「The **Connections** settings enable you to define how Burp handles network traffic.」構成できるもの: **Platform authentication** / **Timeouts** / **Upstream proxy servers** / **Hostname resolution overrides** / **SOCKS proxy**。

#### Platform authentication
「These settings enable Burp to carry out automatic platform authentication to destination web servers.」**Do platform authentication** を選択し **Add** で **Add platform authentication credentials** ダイアログを開く。追加できる情報:
- Destination host.
- Authentication type - 「This can be either **Basic**, **NTLMv1**, or **NTLMv2**.」
- Username. / Password. / Domain. / Domain hostname.

「If you select **Prompt for credentials on platform authentication failure**, then Burp displays an interactive popup whenever it encounters an authentication failure.」
保存レベル: user と project の両方に適用可能。**Override options for this project only** を選ぶと当該プロジェクトのみ。

#### Timeouts（全5項目・単位は秒）

| 設定 | 説明（逐語ベース） |
| --- | --- |
| **Connect** | サーバ接続時に使用。「how long Burp waits for a response after opening a socket, before deciding that the server is unreachable.」 |
| **Normal** | ほとんどのネットワーク通信に使用。「how long Burp waits before abandoning a request and recording a timeout.」 |
| **Open-ended responses** | 「Used where a response that does not contain a `Content-Length` or `Transfer-Encoding` HTTP header is being processed. Burp waits for the specified interval before determining that the transmission is complete.」 |
| **Domain name resolution** | 「how often Burp re-performs successful domain name look-ups. This should be set to a low value if target host addresses change frequently.」 |
| **Failed domain name resolution** | 「how often Burp reattempts unsuccessful domain name look-ups.」 |

「Values are in seconds. **If you set any of these settings to zero or leave them blank, Burp will never time out when performing that function.**」

#### Upstream proxy servers
「These settings control whether Burp sends outgoing requests to an upstream proxy server, rather than sending them directly to the destination web server.」
「Burp uses the **first rule in the table that matches** the destination web server. If it cannot find an applicable upstream proxy rule, Burp uses a direct, non-proxied connection.」

**Add upstream proxy rule** ダイアログで指定できる情報:
- **Destination host** — 「You can use wildcards: `*` matches zero or more characters, and `?` matches any character except a dot.」
- **Proxy host** — 「The address of the proxy host. If this is left blank, Burp connects directly.」
- **Proxy port**.
- **Authentication type** — Basic / NTLMv1 / NTLMv2。
- **Username**. / **Password**.
- **Domain** — NTLM 認証でのみ使用。
- **Domain hostname** — NTLM 認証でのみ使用。

イディオム（逐語）: 「To send all traffic to a single proxy server, create a rule with `*` as the destination host. To create an exception to this rule, create a destination host and leave the proxy host field empty.」

#### Hostname resolution overrides
「These settings enable you to override your computer's DNS resolution by mapping hostnames to IP addresses. **This can help you to make sure that requests are forwarded correctly when the Hosts file has been modified to invisibly proxy traffic from non-proxy-aware thick client components.**」
各マッピングは「a hostname」と「The IP address that should be associated with that hostname」から成る。チェックボックスで個別に有効／無効化、**Edit** / **Remove** 可能。project settings。

#### SOCKS proxy
「You can configure Burp to use a SOCKS proxy for all outgoing communications. This setting is applied at the **TCP level**, and all outbound requests are sent by the configured proxy.」
**Use SOCKS proxy** を選択して入力する情報: SOCKS proxy host / SOCKS proxy port / Username / Password。
- 「If you configure rules for upstream HTTP proxy servers, any requests to upstream proxies are sent via the configured SOCKS proxy.」
- 「If you select **Do DNS lookups over SOCKS proxy**, all domain names are resolved by the proxy. Burp does not perform any local lookups if you select this setting.」

---

### 22. 補助: TLS settings（クライアント証明書・上流 TLS）
（出典: /burp/documentation/desktop/settings/network/tls.html ／**Professional**, **Community**）

構成できるもの: **TLS negotiation** / **Client TLS certificates** / **Server TLS certificates** / **Java TLS settings**。

#### TLS negotiation
「These settings control the TLS protocols and ciphers that Burp uses when negotiating with **upstream servers**.」
**Verify upstream TLS** をクリックして、使用させたいプロトコルと暗号スイートを選ぶ。選択肢:
- 「Use all of the protocols and ciphers that your Java installation supports.」
- 「Use the default protocols and ciphers for your Java installation.」
- 「Use custom protocols and ciphers.」

さらに:
- **Allow unsafe renegotiation** — 「This option may be necessary when using some client TLS certificates or attempting to work around other TLS problems.」
- **Disable TLS session resume** — 「This option controls whether Burp caches and reuses TLS connections between requests. Resuming sessions helps you to work more efficiently, but can cause problems in some situations.」

#### Client TLS certificates
「These settings enable you to configure the client TLS certificates that Burp uses when requested to by a destination host. You can configure multiple certificates, and specify which hosts each certificate is used for.」
「When a host requests a client TLS certificate, Burp uses the **first certificate in the list** for that host.」
**Add** で **Client TLS Certificate** ダイアログを開き、destination host と certificate type を入力する。

- **Destination host**: 「You can use wildcards: `*` matches zero or more characters, and `?` matches any character except a dot. To use a single certificate for all hosts, use `*` as the destination host.」
- **Certificate type**:
  - **File (PKCS#12)** — 「Certificates in this format must have a .p12 file extension. Select the location of the certificate file and the password for the certificate.」
  - **Hardware token or smartcard (PKCS#11)** — 「Select the location of the PKCS#11 library file for your device from the menu. On Windows, Burp can automatically search common locations to find the library files that you have installed. You will also need to enter your PIN code and select the certificate from the available options. If you want to test applications that don't directly trust your intermediate certificate authority, you can also add an intermediate certificate.」

#### Server TLS certificates
「This information-only panel contains details of all X509 certificates received from web servers. Double-click an item in the list to display the certificate details.」

#### Java TLS settings
- **Enable algorithms blocked by Java security policy** — 「As of Java 7, the Java security policy can be used to block certain obsolete algorithms from being used in TLS negotiation. Some of these algorithms (**MD2**, for example) are blocked by default. However, many live web servers have TLS certificates that use these obsolete algorithms. It is not possible to connect to these servers using the default Java security policy. Enable this setting to allow Burp to use the obsolete algorithms when it connects to these servers. Restart Burp for any changes to this setting to take effect.」
- **Disable Java SNI extension** — 「As of Java 7, the TLS Server Name Indication (SNI) extension is implemented and enabled by default. Some misconfigured web servers that have SNI enabled send an "Unrecognized name" warning in the TLS handshake. While browsers ignore this warning, the Java implementation does not, resulting in a failed connection. Use this option to disable the Java SNI extension and connect to the servers. Restart Burp for any changes to this setting to take effect.」

---

## ch06 執筆用の要点整理（クライアントサイド脆弱性ハンティング視点）

1. **クライアントサイド制御は Proxy で消せる**: Response modification rules の 6 項目（Unhide hidden form fields / Enable disabled form fields / Remove input field length limits / Remove JavaScript form validation / Remove all JavaScript / Remove `<object>` tags）が、「クライアント側だけで守っている」箇所を機械的に暴き出す。特に **Remove all JavaScript** は「JS が無くても操作が通るか＝サーバ側検証の有無」を切り分ける診断手法になる。
2. **Match and replace はヘッダ実験の主力**: Match 空欄＝ヘッダ追加、Replace 空欄＝ヘッダ削除。`Accept-Encoding` を削除すれば圧縮レスポンスを平文で観察できる（公式が明記している用法）。応答ヘッダを書き換えて「ヘッダが無い／緩い場合に何が起きるか」を安全に再現できる。
3. **WebSockets も一級市民**: WebSockets history と WebSocket interception rules があり、スコープ判定は `upgrade` リクエストが in-scope かで決まる。Bambda で `message.direction() == Direction.SERVER_TO_CLIENT` のように方向・payload 長で絞れる。
4. **`Strip Proxy-*` の注記は攻撃面の示唆**: 公式が「A malicious website may attempt to induce a browser to include sensitive data within these headers」と書いている。クライアントサイドの視点で「ブラウザがプロキシ向けに出すヘッダが標的に漏れる」という観点を持てる。
5. **listener のバインド先は事故の源**: all interfaces にバインドすると他のマシンから接続できる。診断環境の衛生としてノートに残すべき。
6. **TLS pass through はトレードオフ**: 見えなくなる（Intercept にも history にも出ない）代わりに、性能・元の TLS フィンガープリント・ピンニング回避が得られる。out-of-scope 一括適用は **Miscellaneous > Don't send items to Proxy history or live tasks, if out of scope** を先に有効化しないと使えない。
7. **許諾の前提**: 公式が Scanner の節で明示している通り「Do not run scans against third-party websites unless you have been authorized to do so by the owner.」、Proxy の節で「you should only use Burp Proxy against non-production systems」（機能に十分慣れるまで）。教科書でもこの2文は原文引用で載せるべき。

---

## 読者が自分で開くべき資料

この環境では `portswigger.net`、`web.archive.org` ともにネットワーク egress でブロックされており、担当URLのライブページを直接読めなかった（WebFetch → `EGRESS_BLOCKED`、curl → `CONNECT tunnel failed, response 403`、WebSearch → セッション予算 200/200 消費済み）。本文は Burp Suite 同梱のオフライン公式ドキュメント（PortSwigger 配布 HTML、内部ビルド 32146）のミラーから逐語取得したが、**UI 名称・既定値・新機能はライブページのほうが新しい可能性がある**。読者は次を自分で開いて確認してほしい。

### A. https://portswigger.net/burp/documentation/desktop/getting-started — 読みどころ
1. **「In this tutorial」の7〜8項目のリンク**: Download → Intercept → Modify → Scope → Repeater → First scan → Generate report → What next。この順序自体が公式の推奨学習曲線なので、章立ての骨格として確認する価値がある。
2. **Step 2: Install の「Next → Start Burp で飛ばす」記述**: 初回起動時にプロジェクト選択を後回しにできる、というのが初学者の躓きを外す一文。最新版で文言が変わっていないか確認。
3. **Modifying HTTP requests の lab URL と資格情報**: `lab-logic-flaws-excessive-trust-in-client-side-controls`、`wiener` / `peter`、`price` パラメータ、`$100` のクレジット。lab の内容は改訂されることがあるため、実施前にライブで確認。
4. **Reissuing requests の Struts バージョン（2 2.3.31）**: lab の答えに相当するため、改訂されている可能性がある。
5. **Run your first scan の `ginandjuice.shop` と Lightweight モードの「maximum of 15 minutes」**: 練習用の公式標的サイトと preset の制限時間。最新の preset 名・制限を確認。
6. **system-requirements ページの数値（2/4GB, 2/16GB, 4/32GB, 1GB, 2GB）と Apple Silicon での JAR 制限**: ハードウェア要件は版ごとに更新されるため必ずライブで確認。

### B. https://portswigger.net/burp/documentation/desktop/tools/proxy — 読みどころ
1. **ページ末尾の「Related pages」6リンク**: Intercepting messages / HTTP history / WebSockets history / **Burp Proxy settings** / Managing certificates / Invisible proxying。Proxy の学習は必ずこの6ページを回る。特に **Burp Proxy settings**（`/settings/tools/proxy.html`）が情報量の9割を持つ。
2. **Note の安全条項**: 「you should only use Burp Proxy against non-production systems」— 教科書の倫理節に原文引用する。
3. **Proxy settings ページの「Response modification rules」節**: クライアントサイド制御の除去項目が並ぶ。最新版で項目が増減していないか確認（本ノートでは6項目＋sslstrip系2項目）。
4. **Proxy settings ページの「Miscellaneous」節（14項目）**: `Strip Proxy-*`、`Unpack compressed requests/responses`（gzip / Deflate / Brotli）、`Disable web interface at http://burpsuite` など、実務で必ず触る項目。
5. **Invisible proxying ページの非プロキシ形式リクエストの対比例**: `GET http://example.org/foo.php HTTP/1.1` vs `GET /foo.php HTTP/1.1`。thick client やモバイルを扱うなら必読。
6. **HTTP history / WebSockets history の Bambda 例**: `ProxyHttpRequestResponse` / `ProxyWebSocketMessage` / `Utilities` を使う Java コード。Montoya API は進化が速いため、最新のクラス名・メソッド名はライブで確認すること。

### C. 追加で読むべき周辺ページ（本ノートで逐語取得済みだがライブ確認推奨）
- `/burp/documentation/desktop/external-browser-config/index.html`（外部ブラウザ連携の4ステップ）
- `/burp/documentation/desktop/external-browser-config/certificate/index.html`（CA 証明書を入れる理由と in-browser interface `http://burpsuite`）
- `/burp/documentation/desktop/tools/proxy/manage-certificates.html`（OpenSSL による自作 CA、DER/PKCS8 変換）
- `/burp/documentation/desktop/projects/create-project-file.html`（Temporary / Disk-based、configuration 3択）
- `/burp/documentation/desktop/settings/network/connections.html`（Upstream proxy、Hostname resolution overrides、SOCKS）
- `/burp/documentation/desktop/settings/network/tls.html`（Client TLS certificates: PKCS#12 / PKCS#11）

### D. 本ノートで取得できなかった（failed）関連ページ — 読者が必ず自分で開くべきもの
- `/burp/documentation/desktop/mobile/config-ios-device.html` および `/burp/documentation/desktop/mobile/config-android-device.html`
  - 取得しなかった理由: 担当URLの直接配下ではないため今回の取得対象に含めず、かつライブへのアクセスがブロックされていた。
  - 読みどころ: ① 端末の Wi-Fi プロキシ設定（Burp のマシン IP とポート）② listener を loopback 以外（all interfaces）にバインドする必要性とその危険 ③ 端末上での CA 証明書のダウンロードとトラストストア登録（iOS は「証明書信頼設定」での明示的な有効化が別手順）④ 証明書ピンニングがある場合の TLS pass through との併用。モバイルアプリのクライアントサイド診断をする読者は必読。
- `/burp/documentation/desktop/troubleshooting/troubleshooting.html`
  - 取得しなかった理由: 同上。
  - 読みどころ: ① listener が起動しないときの切り分け ② Burp's browser が起動しないときの Health check ③ プロジェクトファイルの破損・容量問題 ④ 「ブラウザで HTTPS が開けない」ときの CA 証明書再インストール手順。
- `/burp/documentation/desktop/settings/tools/proxy.html` の「predefined match and replace rules」の実際の一覧
  - 取得できなかった理由: 公式ドキュメント本文は「various predefined rules ... These are disabled by default」と述べるだけで、**個々のルール名・正規表現は文書化されていない**。実際の一覧は Burp の UI（Settings > Tools > Proxy > HTTP match and replace rules）でのみ確認できる。
  - 読みどころ: UI 上で各 predefined rule の **Type / Match / Replace / Comment** 列を読み、User-Agent 書き換えや `Accept-Encoding` 除去などの定型がどう表現されているかを写し取ること。教科書の演習素材として最適。
