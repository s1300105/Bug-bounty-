# Burp Suite 入門（導入・プロジェクト・ブラウザ・CA証明書・Proxy 基本操作）

> **この節で分かること**
> - Burp Suite と Burp Proxy が「何であって、なぜ必要か」を説明できる
> - Burp をダウンロード・インストールし、プロジェクトファイルを選んで起動できる
> - 内蔵ブラウザ（Burp's browser）と外部ブラウザのどちらを使うべきか判断し、外部ブラウザなら4ステップで連携できる
> - HTTPS 通信を復号するために CA 証明書をインストールする理由と手順を説明できる
> - Intercept・HTTP history・Repeater・Scope を使って、リクエストを傍受・改変・再送し、対象を絞り込める
> - クライアントサイド制御への「過信」がなぜ脆弱性になるのかを、価格改ざん lab を通じて体験できる

**元資料**: https://portswigger.net/burp/documentation/desktop/getting-started ／ https://portswigger.net/burp/documentation/desktop/tools/proxy （原典は取得できず、Burp Suite 同梱のオフライン公式ドキュメント〈PortSwigger 配布 HTML、内部ビルド 32146 相当〉のミラーから逐語取得したものを基にした二次情報ベース）
**関連する節**: 「Burp Proxy 全機能（Response modification / match and replace / WebSocket / TLS pass through / Invisible proxy）」（本ノートのパート2）

---

## 1. Burp Suite と Burp Proxy とは何か

### 1-1. まず全体像

Burp Suite（バープ・スイート）とは、Web アプリケーションのセキュリティテスト用の包括的なツール群のこと。公式ドキュメントは冒頭でこう定義している。

> 「Burp Suite is a comprehensive suite of tools for web application security testing.」

その中核が **Burp Proxy**（バープ・プロキシ）である。Burp Proxy とは、ブラウザと標的アプリの間に立つローカル Web プロキシサーバのこと。プロキシ（proxy）とは「代理人」を意味し、ここではブラウザが送る通信をいったん自分の手元で受け取り、中身を見たり書き換えたりしてから相手のサーバへ転送する中継役を指す。たとえば郵便物を出す前に全部開封して読み、必要なら書き換えてから封をし直して投函する係、と考えるとよい。

公式ドキュメントの最重要な定義2文（逐語）はこうである。

> 「Burp Proxy operates as a web proxy server between the browser and target applications. It enables you to intercept, inspect, and modify traffic that passes in both directions. You can even use this to test using HTTPS.」

> 「Burp Proxy is an essential component of Burp Suite's user-driven workflow. You can use it to send requests to Burp's other tools.」

つまり Burp Proxy はブラウザと標的アプリの間に立ち、双方向のトラフィックを **intercept（傍受）／ inspect（精査）／ modify（改変）** できる。HTTPS でも使える。そして Burp Suite の **user-driven workflow（利用者主導のワークフロー）** の必須要素であり、ここから Repeater や Intruder といった他ツールへリクエストを送る起点になる。

### 1-2. なぜ「間に立つ」設計なのか（設計意図）

Web の脆弱性は、ブラウザの画面（UI）だけを操作していては見つからないことが多い。UI は「利用者にやらせてよい操作」しか用意していないからである。攻撃者が突くのはまさにその外側、つまり「UI では不可能だが、HTTP リクエストとしては送れてしまう操作」である。

Burp Proxy が通信の途中に割り込むことで、UI という制約を外して生の HTTP リクエストを直接いじれるようになる。これがクライアントサイド脆弱性ハンティングの出発点になる。後述する価格改ざん lab がその典型例である。

### 1-3. Burp's browser との関係

Burp Proxy はブラウザと組み合わせて標的にアクセスする。公式の推奨は Burp 内蔵の Chromium ブラウザ（Burp's browser）を使うことである（逐語）。

> 「Burp Proxy works with Burp's browser to access the target application. To launch Burp's browser, go to **Proxy > Intercept** and click **Open Browser**. All traffic for this browser is proxied through Burp automatically.」

`Proxy > Intercept` タブの **Open Browser** を押すだけで、プロキシ設定も CA 証明書も済んだブラウザが立ち上がり、そのブラウザの全トラフィックが自動的に Burp を経由する。

### 1-4. 使う前の安全上の警告

Burp Proxy を使うと、アプリによっては予期しない副作用が出る。公式ドキュメントは強い調子でこう釘を刺している（逐語）。

> 「Using Burp Proxy may result in unexpected effects in some applications. Until you are fully familiar with its functionality and settings, you should only use Burp Proxy against non-production systems.」

機能と設定に十分慣れるまでは **非本番システムに対してのみ** 使うこと。この教科書で扱う攻撃手法はすべて「許可された診断・バグバウンティ・自分で立てた検証環境」を前提とする。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Burp Proxy トップページ（Related pages 6リンクを含む） — https://portswigger.net/burp/documentation/desktop/tools/proxy
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress ブロックにより live ページへ到達できず、Burp 同梱のオフライン版 HTML ミラーから逐語取得したため）。以下の記述はそのミラー本文にもとづく要約である。
> **読みどころ**:
> 1. ページ末尾の「Related pages」6リンク（Intercepting messages / HTTP history / WebSockets history / Burp Proxy settings / Managing certificates / Invisible proxying）。Proxy 学習は必ずこの6ページを回る。特に **Burp Proxy settings** が情報量の9割を持つ。
> 2. Note の安全条項「you should only use Burp Proxy against non-production systems」を原文で確認する。
> 3. UI 名称や既定値が最新版で変わっていないか（本ノートはビルド 32146 相当）。
> **代替手段**: Burp 本体を起動し `Help` メニューから同梱ドキュメントを開けば同一文面が読める。

---

## 2. ダウンロードとインストール

### 2-1. エディションの違い

Burp Suite には **Professional**（有料・Pro）と **Community Edition**（無料）がある。この節の操作の多くは両方で使えるが、**Burp Scanner（自動スキャン）は Professional / Enterprise 版だけ** の機能である（後述の「初めてのスキャン」参照）。

### 2-2. 3ステップの導入手順

公式チュートリアルは導入を3段で説明する。

**Step 1: Download**
「Choose your software」で Professional か Community Edition を選んでダウンロードする。

**Step 2: Install**
1. インストーラを実行して Burp Suite を起動する。
2. プロジェクトファイルと設定の選択を求められたら、いまは **Next** → **Start Burp** で飛ばす（逐語: 「just click **Next** and then **Start Burp** to skip this for now.」）。

> **Note**（逐語）: 「If you're using Burp Suite Professional, enter your license key when prompted. If you don't have one already, you can subscribe or request a free trial.」

Pro 版は起動時にライセンスキーを求められる。持っていなければ購読するか無料トライアルを申請する。

**Step 3: Start exploring Burp Suite**
まったく初めてなら、この後のチュートリアル（Intercept → Modify → Scope → Repeater → Scan → What next）を順に進めるとよい。

### 2-3. Mac のプロセッサ判定

2020年以降、Apple は Mac に新しいプロセッサ（Apple Silicon）を導入した。プロセッサ次第でインストーラが変わるため、次の手順で確認する。

1. 画面左上の Apple ロゴをクリック。
2. **About This Mac** を選ぶ。
3. ダイアログ内の **Chip** または **Processor** の行を見て、Apple か Intel かを判別する。

適切なインストーラは PortSwigger の **Releases page** からダウンロードする。

---

## 3. システム要件（動作環境）

「システム要件は用途に大きく依存する」というのが公式の前提である。低スペックのマシンでも大半の作業はできるが、複数スキャンの同時実行のような重い用途では相応のパワーが要る。

### 3-1. CPU コアとメモリ

| 区分 | スペック | 想定用途 |
| --- | --- | --- |
| **Minimum** | 2コア / 4GB RAM | Web トラフィックのプロキシや単純な Intruder 攻撃などの基本作業。これ未満は性能上非推奨 |
| **Recommended** | 2コア / 16GB RAM | 汎用的に良いスペック |
| **Advanced** | 4コア / 32GB RAM | 複雑な Intruder 攻撃や大規模な自動スキャンなど重い作業向け |

### 3-2. ディスク空き容量

| 対象 | 必要容量 |
| --- | --- |
| 基本インストール | 1GB |
| プロジェクトファイル1つあたり | 2GB |

> **Note**（逐語）: 「While 2GB is the recommended minimum free disk space for a project, note that project files can get significantly larger than this (potentially up to many tens of GB) ...」

プロジェクトファイルは **数十GB** に達し得る。膨張要因は「proxy history の量」「実行したスキャン数」「開いている Repeater タブ数」の3つである。

### 3-3. OS とアーキテクチャ

Burp は次の OS の最新版をサポートする。

- Windows（Intel 64-bit）
- Linux（Intel および ARM 64-bit）
- OS X（Intel 64-bit および Apple M1）

内蔵ブラウザ（Burp's browser）には追加要件がある。次では動かない。

- 古い Windows（Windows 7 / 8 / 8.1 / Server 2012 / Server 2012 R2）
- **Apple Silicon / ARM64 環境で JAR ファイルから起動した Burp**

つまり **Apple Silicon / ARM64 では JAR 起動だと内蔵ブラウザが使えない**。内蔵ブラウザを使いたければ、ネイティブのプラットフォームインストーラで入れること。なお、プラットフォームインストーラ版なら複数の Burp を同時起動でき、これは JAR 版に限られた機能ではない。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Burp Suite getting started（system requirements 含む） — https://portswigger.net/burp/documentation/desktop/getting-started
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress ブロック）。以下はオフライン版 HTML ミラー（ビルド 32146 相当）にもとづく要約である。
> **読みどころ**:
> 1. 「In this tutorial」の7〜8項目のリンク順序（Download → Intercept → Modify → Scope → Repeater → First scan → Generate report → What next）。これ自体が公式の推奨学習曲線である。
> 2. Step 2: Install の「Next → Start Burp で飛ばす」記述が最新版でも変わっていないか。
> 3. system-requirements ページの数値（2/4GB, 2/16GB, 4/32GB, 1GB, 2GB）と Apple Silicon での JAR 制限。ハードウェア要件は版ごとに更新されるため必ず live で確認する。
> **代替手段**: Burp 本体同梱のドキュメント（Help メニュー）で同一文面を確認できる。

---

## 4. ライセンスのアクティベーション（Pro 専用・オフライン対応）

Professional を初回起動するとライセンスキーの入力を求められる。キーはアカウントページからダウンロードできる。

### 4-1. 標準アクティベーション

1. ライセンスキーをテキストウィンドウに貼り付ける、または **Select license key file...** でファイルから読み込み、**Next** をクリック。
2. インターネットアクセスが Web プロキシ経由に限られる場合は、対応フィールドにプロキシ情報を入力する。
3. **Next** をクリックしてアクティベートし、startup wizard に進む。

### 4-2. Manual activation（インターネットに繋がらない PC 向け）

> **Note**（逐語）: 「If you are trying to complete the manual activation process on a computer with no internet connection, you will need to perform this process on another computer before entering the activation response manually on the offline computer.」

オフライン PC では、別のネット接続 PC で応答を取得してから手入力する。手順は標準手順の3で **Next** の代わりに **Manual activation** を押して進める。

1. **Copy URL** ボタンをクリック。
2. その URL をブラウザに貼り付け、manual license activation ページを開く。
3. ウィザードに戻り **Copy request** ボタンをクリック。
4. ブラウザのページで **Activation request** フィールドに貼り付け **Send**。現れた **Activation response** を選択してコピーする。
5. ウィザードに戻り **Paste response** で貼り付ける（オフライン PC なら正確に手入力）。
6. **Next** をクリック。成功なら通知が出るので **Finish** でアクティベーション完了。Burp startup wizard が読み込まれる。

---

## 5. プロジェクトファイル（起動時に最初に決めること）

### 5-1. プロジェクトファイルとは

プロジェクトファイルとは、ある1件の作業に関する全データと設定を保持するファイルのこと。公式の説明（逐語）はこうである。

> 「You can hold all the data and configuration settings for a particular piece of work in a Burp project file. The file saves data incrementally as you work. There is no need to manually save your work.」

作業しながら **インクリメンタルに（少しずつ）自動保存** されるので、手動保存は不要である。テストによっては数GBのデータが出るため、空きディスクを十分確保しておくこと。

### 5-2. startup wizard で選ぶプロジェクト種別

| 選択肢 | 対応エディション | 説明 |
| --- | --- | --- |
| **Temporary project in memory** | Pro / Community | 保存不要な短時間作業向け。全データはメモリ上で、Burp 終了時に消える |
| **New project on disk** | Pro | 新しいプロジェクトファイルを作る。全データと設定をこのファイルが保持する |
| **Open existing project** | Pro | 既存プロジェクトを再度開く。最近開いたものから選べる |

用語を整理すると次のようになる。

- **Temporary projects（一時プロジェクト）**: 全データはメモリ上、Burp 終了で消える。
- **Disk-based projects（ディスク型プロジェクト）**: 全データはディスク上の project file にあり、後で作業を再開できる。

### 5-3. 他人のファイルは信用しない（攻撃者はここを突く）

> **Warning**（逐語）: 「You can import project and configuration files from other users. However, for security reasons, we recommend only importing project and configuration files from trusted sources.」

プロジェクト／設定ファイルは他人からインポートできるが、**信頼できる出所のものだけ** にすること。悪意ある設定や自動タスクが仕込まれていると、開いた瞬間に意図しないリクエストが飛ぶ危険がある。既存プロジェクトを開くときには2つの安全設定がある。

- **Pause Automated Tasks**: プロジェクトを開いたときに自動タスクが走らないようにする。出所不明のファイルでは推奨。なお **Trust this project file** のチェックを外すと、自動タスクは既定で一時停止される。
- **Trust this project file**: チェックを外すと、Burp は開く前に潜在的に有害な設定を除去し、プロジェクト内の自動タスクも一時停止する。ただし公式は「信頼できないプロジェクトファイルでトラフィックをプロキシすること自体を推奨しない」と述べている。

### 5-4. ディスク型プロジェクトの作成手順

1. Burp を起動する。
2. **New project on disk** を選ぶ。
3. 名前を入力しファイルを選び **Next**。
4. configuration を選ぶ。
   - **Use Burp defaults** — Burp の既定設定で開く。
   - **Use settings saved with project** — 再オープン時のみ選べる。前回閉じたときの設定で開く。
   - **Load from configuration file** — 設定ファイルの設定を使う。**project レベル設定のみ読み込まれ、user レベル設定は無視される**。
5. **Start Burp** をクリック。

> **Note**（逐語）: 「Due to the way our persistence framework operates, we recommend that you use a local drive to save project files.」

永続化の仕組み上、プロジェクトファイルは **ローカルドライブ** に保存すること（ネットワークドライブは避ける）。

### 5-5. 既存プロジェクトを開くときの注意

startup wizard で **Open existing project** を選ぶか、コマンドライン引数で開く。別インスタンスで作られたプロジェクトでは「full ownership（完全な所有権）を取るか」を尋ねられる。他インスタンスで作業が続く可能性があり、かつ **Burp Collaborator identifier** がプロジェクトファイルに保存されている場合、その identifier を共有してしまうため、**full ownership を取らないことが推奨** される（identifier の共有はエラーの原因になる）。

〔補足〕Burp Collaborator identifier とは、Burp Collaborator（帯域外〈out-of-band〉の検知に使う PortSwigger のサーバ機能）が発行する一意の ID のこと。攻撃が直接のレスポンスに現れず、別経路の通信で初めて検知できるタイプの脆弱性を見つけるために使う。ここでは「ひとつのプロジェクトに紐づく一意の ID で、複数インスタンスで共有すると衝突する」という点だけ押さえればよい。Collaborator 自体は本ノートの範囲外なので、詳細は別途学ぶこと。

---

## 6. ブラウザの準備 — 内蔵か外部か

### 6-1. まずは内蔵ブラウザ（Burp's browser）

Burp Suite には専用ブラウザが同梱されており、手動・自動の各種テストに即使える。公式（逐語）はこう説明する。

> 「Burp's browser is preconfigured to work with the full functionality of Burp Suite right out of the box. All of the necessary proxy listener settings are automatically adjusted for you. This means you can launch Burp for the first time and immediately start testing, even using HTTPS, without performing any additional configuration.」

つまり **proxy listener 設定は自動調整済みで、初回起動から即、HTTPS でもテストを開始でき、追加設定は不要** である。起動は **Proxy > Intercept** タブの **Open Browser** を押すだけ。以後は通常のブラウザ同様に操作でき、in-scope（対象範囲内）のトラフィックは自動的に Burp を経由する。

閲覧中は Burp の既定 live task が訪れた場所を **passively crawl and audit** する。passive（受動的）とは、能動スキャンのように Burp のほうから追加のリクエストを送り込むのではなく、こちらが閲覧した通信を眺めるだけで、余計なリクエストは一切送らない、という意味である。この受動監査によって site map（サイトの構造マップ）が自動で埋まり、潜在的な問題が報告される。

#### browser-powered scanning（Burp Scanner との統合）

内蔵ブラウザは手動テストに便利なだけではない。**browser-powered scanning**（ブラウザ駆動スキャン）として Burp Scanner に統合すると、実際のブラウザで JavaScript を実行しながらクロールできるため、通常の HTTP レベルのスキャンより深くサイトを解析できる。手動テストと自動スキャンの両方で内蔵ブラウザが土台になる、と押さえておくとよい（Burp Scanner は後述のとおり Professional / Enterprise 専用）。

内蔵ブラウザに不具合があるときは、**Help** メニューの **Health check for Burp's browser** を使う。一連のテストを走らせて、ブラウザが正しく動いているかを診断してくれる。

### 6-2. 外部ブラウザを使うのはどんなときか

公式は明確にこう述べている（逐語）。

> 「For the vast majority of users, this process is not necessary. Simply use Burp's browser instead, which is already configured.」

ほとんどの利用者に外部ブラウザ連携は不要である。それでも外部ブラウザを使う場合は、次の4ステップを行う。

```
外部ブラウザ連携の4ステップ
1. proxy listener が稼働しているか確認
2. ブラウザのプロキシ設定を Burp に向ける（Chrome/Firefox/Safari）
3. ブラウザのプロキシ設定を検証する
4. Burp の CA 証明書をインストールする
```

---

## 7. 外部ブラウザ連携（4ステップの詳細）

### 7-1. Step 1: proxy listener が稼働しているか確認

proxy listener（プロキシリスナー）とは、ブラウザからの接続を待ち受けるローカル HTTP プロキシサーバのこと。公式（逐語）はこう定義する。

> 「Burp's proxy listener is a local HTTP proxy server that listens for incoming connections from your browser. ... This lies at the heart of Burp's user-driven workflow.」

既定では、Burp は **loopback インターフェース（127.0.0.1）の port 8080** に単一のリスナーを作る。loopback とは「自分自身」を指すアドレスで、外部からは繋がらない安全な内向きのアドレスである。

確認手順は次のとおり。

1. **Settings** ダイアログの **Tools > Proxy** タブへ移動する。
2. **Proxy listeners** パネルで `127.0.0.1:8080` のエントリがあり **Running** にチェックが入っていることを確認する。入っていれば OK。
3. 動いていなければ、パネルのアイコンから **Restore defaults** を選び、再度 **Running** を確認する。
4. それでも動かないなら、既定ポート **8080** が他アプリに使われている可能性がある。`127.0.0.1:8080` を選び **Edit** をクリック。
5. **Bind to port** に空いていそうな別ポート番号を入れて **OK**。
6. **Running** にチェックして有効化する。まだなら別ポートで再挑戦する。

### 7-2. Step 2: ブラウザのプロキシ設定

いずれのブラウザでも、Burp Proxy listener のアドレス（既定 `127.0.0.1`）とポート（既定 `8080`）を指定するのが要点である。

**Firefox**
1. Firefox Menu → **Preferences / Options**。
2. **General** タブ → **Network Proxy** → **Settings**。
3. **Manual proxy configuration** を選ぶ。
4. **HTTP Proxy** に `127.0.0.1`、**Port** に `8080` を入力。**Use this proxy server for all protocols** をチェック。
5. **No proxy for** の内容をすべて削除して **OK**。

**Chrome（Windows）**
1. Chrome の **Customize**（ハンバーガー）メニュー → **Settings** → **System**。
2. **Open your computer's proxy settings** をクリック。
3. **Automatically detect settings** と **Use setup script** が **Off** であることを確認。
4. **Use a proxy server** を **On** にし、**Address** に `127.0.0.1`、**Port** に `8080`。
5. **Don't use the proxy server for local (intranet) addresses** はチェックしない。**Save**。

**Chrome（MacOS）**
1. **Settings** → **System** → **Open your computer's proxy settings**。
2. **Web Proxy (HTTP)** をチェックし、サーバに `127.0.0.1`、隣にポート `8080`。
3. **Secure Web Proxy (HTTPS)** も同様に設定。
4. **Bypass proxy settings for these Hosts & Domains** を空にして **OK** → **Apply**。

**Safari**
1. **Safari** メニュー → **Preferences** → **Advanced** → **Proxies** の **Change Settings**。
2. **Web Proxy (HTTP)** をチェックし `127.0.0.1` とポート `8080`。
3. **Secure Web Proxy (HTTPS)** も同様に。
4. **Bypass proxy settings for these Hosts & Domains** を空にして **OK** → **Apply**。

### 7-3. Step 3: ブラウザのプロキシ設定を検証

1. listener が稼働していること、ブラウザを設定済みであることを確認する。
2. Burp の **Proxy > Intercept** タブで **Intercept is off** をクリックして interception を有効にする。
3. 設定したブラウザで任意の **HTTP** URL にアクセスする。ブラウザは応答待ちのまま止まるはず（Burp が傍受したため）。
4. **Proxy > Intercept** タブに傍受されたリクエストが表示される。
5. **Forward** をクリックしてリクエストを解放する。
6. ブラウザに戻ると、要求したページが通常どおり読み込まれる。
7. interception を止めるには **Intercept is on** をクリックする。

公式はこう補足する（逐語）。「These steps enable you to test web applications that use HTTP. **To test HTTPS URLs, you need to install Burp's CA certificate.**」HTTP はこれで扱えるが、**HTTPS を扱うには CA 証明書のインストールが必要** である。

---

## 8. CA 証明書 — なぜ必要で、どこから取るか

### 8-0. この作業は必須か（初学者の不安を先に解く）

CA 証明書のインストールは、外部ブラウザを使う人向けの作業である。公式はこう補足している（逐語）。

> 「Although this step isn't strictly mandatory, especially if you only want to work with non-HTTPS URLs, we still recommend completing this step. You only need to do it once, and it is required to get the most out of your experience with Burp Suite when using an external browser.」

つまり、**HTTP（非 HTTPS）の URL だけを扱うなら厳密には必須ではない**。ただし外部ブラウザで Burp を最大限使うには必要であり、**一度やれば済む**（インストールごとに一度きり）。内蔵ブラウザを使うなら最初から設定済みなので、この作業自体が不要である。

### 8-1. なぜ CA 証明書を入れるのか（原理）

TLS（Transport Layer Security）とは、通信を暗号化し、相手のサーバが本物であることを確認するための仕組みのこと。公式の原理説明（逐語）を読もう。

> 「One of the key functions of TLS is to authenticate the identity of web servers that your browser communicates with. ... In order to intercept the traffic between your browser and destination web server, Burp needs to break this TLS connection. As a result, if you try and access an HTTPS URL while Burp is running, your browser will detect that it is not communicating directly with the authentic web server and will show a security warning.」

要するに、Burp が通信を傍受するには TLS 接続をいったん割る必要がある。すると「本物のサーバと直接話していない」とブラウザが気づき、セキュリティ警告を出す。これを解決するのが Burp の CA 証明書である。

> 「To prevent this issue, Burp generates its own TLS certificate for each host, signed by its own Certificate Authority (CA). This CA certificate is generated the first time you launch Burp, and stored locally. ... you need to install this certificate as a trusted root in your browser's trust store.」

CA（Certificate Authority, 認証局）とは、証明書に署名して「この証明書は本物だ」と保証する発行元のこと。Burp は自前の CA を持ち、訪問先ホストごとに TLS 証明書をその場で作って署名する。この CA 証明書を **信頼されたルート（trusted root）** としてブラウザのトラストストア（信頼できる証明書の保管庫）に入れると、警告なしに HTTPS を閲覧できるようになる。CA 証明書は Burp 初回起動時に **インストールごとに一意生成** され、ローカルに保存される。

### 8-2. 攻撃者はここを突く（重大な注意）

信頼されたルート証明書を入れるという操作は、実は諸刃の剣である。公式の警告（逐語）を必ず読むこと。

> 「If you install a trusted root certificate in your browser, then an attacker who has the private key for that certificate may be able to man-in-the-middle your TLS connections without obvious detection, even when you are not using an intercepting proxy. To protect against this, Burp generates a unique CA certificate for each installation, and the private key ... is stored on your computer, in a user-specific location. If untrusted people can read local data on your computer, you may not wish to install Burp's CA certificate.」

信頼したルート証明書の **秘密鍵を握った攻撃者は、あなたの TLS 通信を気づかれずに中間者攻撃（man-in-the-middle, MITM）できる**。中間者攻撃とは、通信の間に割り込んで盗聴・改竄する攻撃のこと（まさに Burp がやっていることでもある）。だから Burp はインストールごとに一意の CA を生成し、秘密鍵は利用者固有の場所に保存する。それでも、共用 PC など「信頼できない他人がローカルデータを読める環境」では、Burp の CA 証明書を入れないほうがよい。

### 8-3. 証明書の入手元（in-browser interface）

証明書は Burp の in-browser interface から入手する（逐語）。

> 「You can access the Burp Proxy in-browser interface by visiting `http://burpsuite` with the browser, or by entering the URL of your Proxy listener, for example: `http://127.0.0.1:8080`.」

ブラウザで `http://burpsuite`（または `http://127.0.0.1:8080`）を開き、そこから Burp CA 証明書のコピーをダウンロードする。この in-browser interface は Proxy settings の Miscellaneous にある **Disable web interface at http://burpsuite** で無効化もできる。なお、Burp の CA 証明書は **`.der` 形式** である点は後の Windows / Linux 手順で効いてくる。

---

## 9. CA 証明書のインストール（ブラウザ別）

CA 証明書の各手順に共通する入口はどれも「Burp を動かしたまま `http://burpsuite` を開き、右上の **CA Certificate** をクリックしてダウンロードし、保存場所をメモする」である。「Welcome to Burp Suite Professional」ページが出ない場合は proxy troubleshooting を参照する。

### 9-1. Firefox

> **Note**（逐語）: 「If you previously installed a different CA certificate generated by Burp, you should remove it before installing a new one.」以前に別の Burp 生成 CA を入れている場合は、先に削除すること。

1. Firefox で `http://burpsuite` を開く。
2. 右上の **CA Certificate** をクリックしてダウンロードする。
3. バーガーメニュー → **Preferences / Options**。
4. **Privacy and Security** を開く。
5. **Certificates** まで下げ **View certificates** をクリック。
6. **Authorities** タブ → **Import** → ダウンロードした証明書を選び **Open**。
7. trust settings で **This certificate can identify websites** にチェックが入っていることを確認して **OK**。
8. Firefox を再起動し、Burp 稼働のまま任意の HTTPS URL に警告なしでアクセスできることを確認する。

削除は **View certificates > Authorities** で **PortSwigger CA** を選び **Delete or Distrust** → **OK** → 再起動。

Chrome での証明書インストール手順は OS ごとに異なる（逐語: 「The process to install Burp's CA certificate for use with Chrome is different for each operating system.」）。以下の Chrome 手順（Windows / MacOS / Linux）に共通する **事前条件** は次の2つである。

- **proxy listener が active であること**（`127.0.0.1:8080` などが **Running**）。
- **ブラウザが Burp と連携するプロキシ設定済みであること**（7-2 の手順を済ませている）。

この2つが満たされていないと `http://burpsuite` から証明書をダウンロードできないので、先に確認しておくこと。

### 9-2. Chrome — Windows

1. **Customize** メニュー → **Settings** → **Privacy and security**。
2. **Security** → **Manage certificates**。
3. **Trusted Root Certification Authorities** タブ → **Import** → **Next**。
4. Burp からエクスポートした CA 証明書を参照する。

> **Note**（逐語）: 「Burp Suite's CA certificate is in `.der` format. You need to set the file filter format to **All Files**.」

証明書は `.der` 形式なので、ファイル選択のフィルタを **All Files** にしないと見えない。ここが最頻出のつまずきである。

5. **Open** → 証明書ストアが **Trusted Root Certification Authorities** であることを確認 → **Next** → **Finish** → **OK**。
6. Chrome を再起動する。

削除は次のとおり（Windows）。Chrome → **Customize** → **Settings** → **Privacy and security** → **Security** → **Manage certificates** → 対象の証明書を選択 → **Remove** → 確認ダイアログで **Yes > Yes** → **Close**。他のブラウザ（Firefox / Chrome-Mac / Linux / Safari）と同じく、Windows でも古い CA を削除できる。新しい CA を入れ直す前や、テストを終えて信頼登録を戻したいときに使う。

### 9-3. Chrome — MacOS

1. **Settings** → **Privacy and security** → **Security** → **Manage certificates**。**Keychain Access** が開く。
2. **System** → **Certificates** タブ。
3. ダウンロードした証明書をリストにドラッグ＆ドロップ（必要ならパスワード入力）。
4. `PortSwigger CA` をダブルクリックし、**Trust** セクションを展開して **Always trust** を選ぶ。
5. Chrome を再起動し、HTTPS URL に警告なしでアクセスできることを確認する。

削除は同じ **Keychain Access** → **System** → **Certificates** で証明書を右クリック → **Delete**。

### 9-4. Chrome — Linux

1. Chrome の **Settings** → **Privacy and security > Manage certificates**。
2. **Authorities** タブ → **Import**。
3. **Browse** で `cacert.der` を選び **Select**。
4. **Trust this certificate for identifying websites** を選ぶ。
5. **OK**。証明書一覧に `org-PortSwigger` が現れる。
6. Chrome を再起動し、HTTPS を警告なしで開けることを確認する。

削除は **Manage certificates** → **Authorities** で `org-PortSwigger` を展開 → `PortSwigger CA` のメニュー → **Delete** → **OK**。

### 9-5. Safari

1. Safari で `http://burpsuite` を開き **CA Certificate** をダウンロード。
2. **Keychain Access** を開き **Certificates** フォルダへ。
3. 証明書をドラッグ＆ドロップでコピー。
4. `PortSwigger CA` をダブルクリック → **Trust** を展開 → **Always trust**。
5. Safari を再起動し、HTTPS を警告なしで開けることを確認する。

削除は **Keychain Access** の左サイドバーで **login** を選び、**PortSwigger CA** を右クリック → **Delete PortSwigger CA** → 再起動。

### 9-6. 入れた後の検証と、モバイル

インストール後の検証は次のとおり（逐語要約）。すべてのブラウザ窓を閉じ、新しいセッションを開いて任意の HTTPS URL を訪れる。警告が出ず通常どおりページが読み込まれれば成功である（interception を再有効化していたら **Proxy > Intercept** で off に戻す）。

モバイル端末にも CA を入れられるが、まず端末を Burp と連携させる必要がある（iOS / Android の設定ページ）。

> ### 📌 ここは自分で開いて読んでください
> **資料**: モバイル端末の設定（iOS / Android） — https://portswigger.net/burp/documentation/desktop/mobile/config-ios-device.html および https://portswigger.net/burp/documentation/desktop/mobile/config-android-device.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 担当URLの直接配下でなく、かつ live へのアクセスがブロックされていた）。以下は目次・関連ページからの要約である。
> **読みどころ**:
> 1. 端末の Wi-Fi プロキシ設定（Burp マシンの IP とポート）。
> 2. listener を loopback 以外（all interfaces）にバインドする必要性と、その危険性。
> 3. 端末上での CA 証明書のダウンロードとトラストストア登録（iOS は「証明書信頼設定」での明示的な有効化が別手順）。
> 4. 証明書ピンニングがある場合の TLS pass through との併用。
> **代替手段**: なし（モバイルのクライアントサイド診断をする読者は必ず live で確認する）。

### 9-7. 証明書のトラブルシューティング

`http://burpsuite` を開いて証明書をダウンロードするには、ブラウザのトラフィックが Burp の proxy listener を通っている必要がある。

- **Check that Burp is running** — Burp が動いていないと `http://burpsuite` には行けない。完全に再起動する。
- **Check your proxy listener is active** — **Settings > Tools > Proxy** で `127.0.0.1:8080` が **Running** か確認。だめなら **Restore defaults**。
- **Try a different port** — `127.0.0.1:8080` を **Edit** し、**Bind to port** に別ポートを入れて **OK** → **Running**。有効化できれば `http://burpsuite` に行ける。だめならさらに別ポートを試す。
- **What next?** — すべて試してもこのページに戻される場合は、Support ページから PortSwigger の technical support に連絡する。

---

## 10. 管理: CA 証明書のエクスポート／再生成／自作

各インストールが独自の CA 証明書を生成し、Proxy listener がそれを使って TLS 接続をネゴシエートする。CA 管理が必要になるのは「外部ブラウザを使う」「特定のネットワーク機器やアプリをテストする」場合だけである。

### 10-1. エクスポート／インポート

1. **Proxy** タブ → **Proxy Settings**。
2. **Proxy listeners** で **Import / export CA certificate** をクリック。
3. **Export** か **Import** を構成し **Next**。
4. ファイルの詳細（必要なら keystore パスワード）を入力し **Next**。
5. プロンプトで **Close**。

> **Note**（逐語）: 「You should not disclose the private key for your certificate to any untrusted party. A malicious attacker in possession of your certificate and key may be able to intercept your browser's HTTPS traffic even when you are not using Burp.」

証明書の **秘密鍵を信頼できない相手に渡してはならない**。鍵を握られると、Burp を使っていないときでも HTTPS 通信を傍受され得る。

### 10-2. CA 証明書の再生成

1. **Proxy > Proxy settings**。
2. **Proxy listeners** で **Regenerate CA certificate**。
3. プロンプトで **Yes**。
4. Burp を再起動する。
5. 新しい証明書をブラウザに入れ直す。

### 10-3. OpenSSL で自作 CA を作る

自分の情報を持つ CA 証明書を OpenSSL で作れる。まず、有効期間730日・暗号化なし・2048ビット RSA 鍵の自己署名証明書を作る。

```bash
openssl req -x509 -days 730 -nodes -newkey rsa:2048 -outform der -keyout server.key -out ca.der
```

次に、鍵を PEM から DER へ変換する。

```bash
openssl rsa -in server.key -inform pem -out server.key.der -outform der
```

さらに、鍵を PKCS8 形式に変換する。

```bash
openssl pkcs8 -topk8 -in server.key.der -inform der -out server.key.pkcs8.der -outform der -nocrypt
```

最後に Burp の **Import / export CA certificate** で **Certificate and private key in DER format** を選び、証明書ファイルに `ca.der`、鍵ファイルに `server.key.pkcs8.der` を指定する。すると Burp はこの CA を読み込み、ホストごとの証明書生成に使う。

---

## 11. Intercept タブの全機能

### 11-1. Intercept とは

**Proxy > Intercept** タブでは、ブラウザと標的サーバの間の HTTP リクエスト／レスポンスを傍受できる（逐語）。

> 「From the **Proxy > Intercept** tab, you can intercept HTTP requests and responses sent between the browser and the target server. This enables you to study how the website behaves when you interact with it.」

intercept でできる4つのアクション（逐語）は次のとおり。

- リクエストを傍受し、サーバへ転送する前に改変する。
- 複数のリクエストをまとめて解放する。
- 興味深いリクエストを Repeater や Intruder など他ツールへ送る。
- 1つ以上のリクエストを drop してサーバへ届かないようにする。

### 11-2. コントロール

| コントロール | 説明 |
| --- | --- |
| **Forward** | 選択したメッセージをすべて標的へ送る |
| **Forward all** | **Forward** のドロップダウンから選ぶと、傍受済みメッセージを全部転送する |
| **Drop** | 選択したリクレストを取り消し、標的サーバへ届かせない |
| **Intercept on/off** | 全 interception のトグル。**Intercept on** の間は傍受され、**Intercept off** の間は全メッセージが自動転送される |

パネル上部には標的サーバの詳細が出る。HTTP リクエストでは **Edit target** メニューから標的サーバを手動編集できる。ホットキーも使え、既定では **Ctrl+F** が選択メッセージの forward である。

### 11-3. 複数選択と注釈

傍受済みメッセージのテーブルはパネル上半分にある。複数選択は次のとおり。

1. メッセージをクリックで1件選択。
2. **Shift** を押しながらでブロック選択。
3. **Command**（Mac）／ **Ctrl**（Windows/Linux）を押しながらで1件ずつ複数選択。

注釈（annotation）として notes と highlights を付けられる。付けた注釈は HTTP history 側の項目にも現れ、リクエストに付けた注釈は、対応するレスポンスも傍受した場合に再度表示される。ハイライトは右クリック → **Highlight** → 色を選ぶ。ノートは右クリック → **Add Notes** → **Notes** パネルに入力する。

### 11-4. メッセージエディタ上の Proxy 固有アクション

メッセージエディタでは、右クリックで標準機能に加え次が使える。

- **Don't intercept requests/responses** — host、ファイル拡張子、HTTP status code などの特徴を共有するメッセージを自動転送する interception rule を追加する。同種の退屈なメッセージが多いときに使う。
- **Do intercept** — いま表示中のリクエストに対する **レスポンス** を傍受する。**リクエストを表示しているときだけ** 使える。

なお、リクエストのプロトコルは Inspector で編集できる（HTTP/2 の詳細は別ドキュメント）。

---

## 12. チュートリアルで身につける基本ワークフロー

以下は公式チュートリアル（Web Security Academy の脆弱な lab を使う）の流れである。lab は改訂されることがあるので、実施前に live で確認するとよい。

### 12-1. HTTP トラフィックを傍受する

**Step 1: 内蔵ブラウザを起動** — **Proxy > Intercept** で intercept を on にし、**Open Browser** をクリック。Burp と内蔵ブラウザの両方が見えるようウィンドウを並べる。

**Step 2: リクエストを傍受** — 内蔵ブラウザで `https://portswigger.net` を開こうとすると、ページが読み込まれないことを確認する。「Burp Proxy has intercepted the HTTP request ... before it could reach the server.」傍受されたリクエストは **Proxy > Intercept** で見える。

**Step 3: リクエストを転送** — **Forward** をクリックして送る。後続リクエストも、ページが読み込まれるまで **Forward** を繰り返す。

**Step 4: interception を切る** — ブラウザは大量のリクエストを送るため、毎回傍受したくはない。intercept を off にすると、通常どおりサイトを操作できる。

**Step 5: HTTP history を見る** — **Proxy > HTTP history** タブへ。ここには Burp Proxy を通った全 HTTP トラフィックの履歴があり、**intercept が off のときの通信も含まれる**。任意のエントリをクリックすると生のリクエストと対応レスポンスが見られる。普通に閲覧してから後でやり取りを研究できる、という点が実務では便利である。

### 12-2. リクエストを改変する（クライアントサイド制御への過信 lab）

この lab は「クライアントサイドに置いた値をサーバが検証せず信頼している」論理欠陥を体験するものである。

> **Web Security Academy**: 「To follow along, you'll need an account on `portswigger.net`. If you don't have one already, registration is free ...」

**Step 1: 脆弱なサイトへアクセス** — intercept が off であることを確認し、内蔵ブラウザで次を開く。

```
https://portswigger.net/web-security/logic-flaws/examples/lab-logic-flaws-excessive-trust-in-client-side-controls
```

**Access the lab** をクリックし、必要ならログインする。自分専用の偽ショッピングサイトが表示される。

**Step 2: ショッピングアカウントにログイン** — **My account** から次の資格情報でログインする。

```
Username: wiener
Password: peter
```

ストアクレジットが **$100** しかないことに気づく。

**Step 3: 買うものを探す** — **Home** → **Lightweight "l33t" leather jacket** の商品詳細を開く。

**Step 4: add to cart を調べる** — **Proxy > Intercept** で intercept を on にし、ジャケットをカートに追加して `POST /cart` リクエストを傍受する。ボディに `price` パラメータがあり、それが **セント単位の商品価格** と一致していることに気づく（背景の通信で複数リクエストが出たら `POST /cart` を選ぶ）。

**Step 5: リクエストを改変** — `price` の値を **1** に変え、**Forward > Forward all** で送る。以降のリクエストが素通りするよう intercept を off に戻す。

**Step 6: 悪用** — 内蔵ブラウザで右上のバスケットを見ると、ジャケットが **1セント** で入っている。

> **Note**（逐語）: 「There is no way to modify the price via the web interface. You were only able to make this change thanks to Burp Proxy.」

**Place order** で購入すれば lab クリアである。ここが核心である。UI では絶対に不可能な操作（価格の書き換え）が、HTTP リクエストの改変では通ってしまう。サーバが価格をクライアントから受け取った値で信頼していたからである。これがクライアントサイド脆弱性の典型形である。

### 12-3. 対象スコープを設定する

target scope（対象範囲）とは、テストしたい URL とホストを Burp に伝える設定のこと。ブラウザや他サイトが出すノイズを除外して、興味のあるトラフィックに集中できる。

**Step 1〜3** — 内蔵ブラウザで次を開き、サイトを探索してから **Proxy > HTTP history** を見る。

```
https://portswigger.net/web-security/information-disclosure/exploiting/lab-infoleak-in-error-messages
```

履歴を読みやすくするには、左端の **#** 列のヘッダを繰り返しクリックして降順に並べ、最新を上に出す。履歴には興味のないサードパーティ（例: YouTube、Google Analytics）も混じっている。

**Step 4: スコープを設定** — **Target > Site map** で標的サイトのノードを右クリック → **Add to scope** → 確認で **Yes**。

**Step 5: HTTP history を絞り込む** — HTTP history 上部の display filter で **Show only in-scope items** を選ぶ。以後、out-of-scope のトラフィックは site map にも proxy history にも記録されなくなる。

### 12-4. Repeater でリクエストを再送する

Burp Repeater は、興味深いリクエストを何度も送り直し、毎回傍受せずに入力を変えて応答を比べるためのツールである。

**Step 1〜3: Repeater に送って送信** — 商品ページにアクセスするたびブラウザが `productId` 付きの `GET /product` を送っていたことに気づく。そのリクエストを右クリック → **Send to Repeater**。**Repeater** タブで **Send** を押すと応答が見られ、何度でも送り直せる。

**Testing different input**
1. `productId` の数値を変えて再送する（大きめの値も試す）。
2. 送信履歴は矢印で前後に辿れ、隣のドロップダウンで特定リクエストへジャンプできる。存在しない商品は `Not Found` になる。
3. サーバは `productId` に整数を期待している。そこで **文字列** を送ってみる。
4. 非整数の `productId` が **例外（exception）** を起こし、サーバが **stack trace を含む冗長なエラー応答** を返す。応答から、サイトが **Apache Struts** を使っており、そのバージョンまで露出していることが判る。lab の解答に入れる Struts バージョンは **2 2.3.31** である。

公式は「In a real scenario, this kind of information could be useful to an attacker, especially if the named version is known to contain additional vulnerabilities.」と述べる。露出したバージョン情報は、既知の脆弱性が結びつくと攻撃者に有用になる。

### 12-5. 初めてのスキャン（Professional 専用）

Burp Scanner は Professional と Enterprise Edition のみで、Community では使えない。スキャンは2フェーズから成る。

- **Crawling**: 実ユーザーの挙動を真似てサイトを巡回し、構造・コンテンツ・遷移経路の網羅的なマップを作る。
- **Auditing**: サイトの挙動を分析して脆弱性その他の問題を特定する。

手順の要点は次のとおり。

1. **Dashboard > New scan** で Scan launcher を開く。
2. **URLs to scan** に `ginandjuice.shop` を入力する。

> **Note**（倫理・逐語）: 「Do not run scans against third-party websites unless you have been authorized to do so by the owner.」

3. **Scan configuration** で **Use a preset scan mode** の **Lightweight** を選ぶ。「Scans using this mode run for a maximum of **15 minutes**.」
4. **OK** でスキャン開始。**Target > Site map** にクロール結果がリアルタイムで増える。
5. **Dashboard** でスキャンの状態を監視する。目安として **1〜2分ほどでクロール（Crawling）が終わり、続いて監査（Auditing）が始まる**。この crawl → audit のフェーズ遷移が進んでいれば正常である。
6. **Dashboard** の **Tasks** からスキャンを選び **Issues** タブへ。issue を選ぶと **Advisory** タブに詳細な説明と修正助言があり、隣に証拠の **Request** / **Response** タブが並ぶ。

### 12-6. レポート生成（Professional 専用）

1. **Target > Site map** で `https://ginandjuice.shop` を右クリック → **Issues > Report issues for this host**。
2. ウィザードで詳細度などを選び、ファイル名と場所を尋ねられるまで **Next**。
3. **Select file** で保存場所とファイル名を指定する。「You must include the appropriate file extension, in this case, `.html`.」→ **Save** → **Next** で生成。
4. 内蔵ブラウザでレポートを開いて確認する。同僚や顧客への報告に使える。

### 12-7. ここまでで身についた能力

チュートリアル修了時点の到達点（逐語リスト）はこうである。

- Burp Proxy で HTTP トラフィックを傍受・改変する。
- target scope を設定して興味あるコンテンツに集中する。
- Burp Repeater でリクエストを再送して脆弱性を探る。
- Burp Scanner で自動スキャンとレポート生成をする。
- Web Security Academy で技を磨く。

### 12-8. 次に学ぶべきこと（Continue your Burp Suite journey）

公式チュートリアルの末尾（What next?）は、ここから先の学習先として次の見出しを挙げている。初学者が「この後どこを読めばよいか」の地図になるので、対応表として押さえておく。

| 学習先の見出し | 何のためか |
| --- | --- |
| **Tools** | Repeater / Intruder / Scanner など各ツールの詳細を個別に学ぶ |
| **Tutorials** | テーマ別の実践ガイド（このチュートリアルの続き）を進める |
| **Options & Preferences** | 設定項目を体系的に理解し、自分の使い方に合わせて調整する |
| **Web Security Academy** | 無料の脆弱な lab で攻撃手法そのものを鍛える |
| **Troubleshooting** | listener・ブラウザ・証明書などが動かないときの切り分けを調べる |
| **Burp Suite extensions** | 拡張（BApp）で機能を追加し、独自の自動化を組む |
| **Reference documentation** | 各機能・設定の網羅的なリファレンスを引く |

---

## 手を動かす

1. Burp Suite Community Edition（無料）を公式 Releases page からダウンロードし、インストールする。Mac の場合は Apple ロゴ → **About This Mac** → **Chip / Processor** でプロセッサを確認し、対応インストーラを選ぶ。
2. 初回起動で「project file と configuration」を聞かれたら、**Next → Start Burp** で飛ばす。慣れたら **Temporary project in memory** を選んで練習用に使う。
3. **Proxy > Intercept** タブで **Open Browser** をクリックして内蔵ブラウザを起動する（外部ブラウザ設定も CA 証明書も不要）。
4. intercept を on にして `https://portswigger.net` を開き、リクエストが止まることを確認する。**Forward** で送り、読み込まれたら intercept を off にする。
5. **Proxy > HTTP history** を開き、いま通った通信を1件クリックして、生のリクエストとレスポンスのペアを読む。
6. Web Security Academy の「excessive trust in client-side controls」lab を開き、`wiener` / `peter` でログインする。ジャケットをカートに入れる `POST /cart` を傍受し、`price` を `1` に変えて **Forward all**。カートに1セントで入ることを確認し **Place order** で lab を解く。
7. 別の lab で `GET /product?productId=...` を **Send to Repeater** し、`productId` を文字列に変えて **Send**。stack trace に露出した Apache Struts のバージョン `2 2.3.31` を読み取る。
8.（外部ブラウザを試したい人だけ）**Settings > Tools > Proxy** で `127.0.0.1:8080` が **Running** か確認し、ブラウザのプロキシを `127.0.0.1:8080` に向け、`http://burpsuite` から CA 証明書（`.der`）をダウンロードしてトラストストアに「Webサイトの識別に信頼する」で登録する。

## つまずきポイント

- **HTTPS が警告なしに開けない**: 外部ブラウザでは CA 証明書を入れないと HTTPS を復号できない。内蔵ブラウザなら最初から設定済みなので、まずは内蔵ブラウザを使うのが確実。
- **Chrome/Windows で証明書ファイルが見えない**: Burp の CA は `.der` 形式。インポート画面のファイルフィルタを **All Files** にしないと表示されない。
- **`http://burpsuite` が開けない**: ブラウザのトラフィックが Burp の listener を通っていないと開けない。Burp が起動しているか、`127.0.0.1:8080` が **Running** か、ポートが他アプリに塞がれていないかを順に確認する。
- **傍受でブラウザが固まる**: intercept が on のままだと全リクエストが止まる。閲覧するときは off にし、必要なときだけ on にする。
- **`POST /cart` が複数出る**: 背景で他の通信が走ると Intercept に複数のリクエストが並ぶ。目的の `POST /cart` を選ぶこと。
- **Apple Silicon で内蔵ブラウザが起動しない**: JAR 版だと ARM64 では内蔵ブラウザが使えない。ネイティブのプラットフォームインストーラで入れ直す。
- **他人のプロジェクト／設定ファイルを軽率に開く**: 悪意ある自動タスクが仕込まれていることがある。信頼できる出所のものだけ、必要なら **Trust this project file** を外して開く。
- **本番システムに向けて練習する**: 慣れるまでは非本番のみ。lab や自分の検証環境、許可されたバグバウンティ対象だけに使う。

## この節のまとめ

- Burp Suite は Web アプリのセキュリティテスト用ツール群で、中核が Burp Proxy（ブラウザと標的の間に立つローカル Web プロキシ）である。
- Burp Proxy は双方向トラフィックを intercept / inspect / modify でき、HTTPS も扱える。UI では不可能な操作を生の HTTP リクエストで可能にするのが強みである。
- 導入は「ダウンロード → プロジェクト選択 → Start Burp」の3段。初回は Next → Start Burp で飛ばせる。
- システム要件は Minimum 2コア/4GB、Recommended 2コア/16GB、Advanced 4コア/32GB。プロジェクトファイルは数十GBに膨らみ得る。
- Apple Silicon / ARM64 で内蔵ブラウザを使うにはネイティブインストーラが必要（JAR 版は不可）。
- プロジェクトは Temporary（メモリ・消える）と Disk-based（保存・再開可）があり、他人のファイルは信頼できる出所のみ開く。
- ブラウザは内蔵の Burp's browser が公式推奨。**Proxy > Intercept > Open Browser** で即使える。外部ブラウザは4ステップ（listener 確認 → プロキシ設定 → 検証 → CA 証明書）が要る。
- 既定の proxy listener は loopback（127.0.0.1）の port 8080。
- HTTPS を復号するには Burp が TLS 接続を割る必要があり、そのため CA 証明書をトラストストアに入れる。CA はインストールごとに一意生成され、秘密鍵の漏洩は中間者攻撃を許すため厳重に扱う。
- CA 証明書は `http://burpsuite`（または `http://127.0.0.1:8080`）から `.der` 形式でダウンロードする。Windows でのインポートはファイルフィルタを All Files にする。
- CA はエクスポート／インポート／再生成でき、OpenSSL で自作 CA（RSA2048・730日・DER/PKCS8）も作れる。
- Intercept タブで forward / drop / 他ツール送信ができ、HTTP history には intercept off の通信も記録される。
- 価格改ざん lab は、サーバがクライアント側の値（price）を検証せず信頼する論理欠陥の典型で、クライアントサイド脆弱性ハンティングの原点である。
- Repeater で入力を変えて再送すると、非整数 `productId` が stack trace を露出し、Apache Struts のバージョンが漏れる（情報漏洩）。
- Scope 設定でサードパーティ（YouTube、Google Analytics 等）のノイズを除外し、in-scope に集中できる。
- Burp Scanner（Pro/Enterprise 専用）は Crawl → Audit の2フェーズで、レポートは `.html` 拡張子付きで保存する。

## 理解度チェック

1. Burp Proxy が「ブラウザと標的の間に立つ」設計になっているのは、攻撃者にとって何を可能にするためか。
   ▶ 答え: UI が許す操作の外側、つまり「UI では不可能だが HTTP リクエストとしては送れてしまう操作」を、生の HTTP リクエストを直接改変することで可能にするため。価格改ざん lab がその典型である。

2. HTTPS 通信を Burp で見るために CA 証明書のインストールが必要なのはなぜか。
   ▶ 答え: Burp が通信を傍受するには TLS 接続をいったん割る必要があり、そのままではブラウザが「本物のサーバと直接話していない」と検知して警告を出す。Burp の CA をトラストストアに信頼登録すると、Burp がホストごとに生成・署名する証明書を信頼でき、警告なしに HTTPS を閲覧できる。

3. Burp の CA 証明書がインストールごとに一意生成されるのはなぜか。
   ▶ 答え: 信頼したルート証明書の秘密鍵を攻撃者が握ると、Burp を使っていないときでも TLS 通信を気づかれずに中間者攻撃できてしまうため。個別化とローカル保存でその危険を抑える。共用 PC では入れないほうがよい。

4. 既定の proxy listener のアドレスとポートは何か。
   ▶ 答え: loopback インターフェース（127.0.0.1）の port 8080。

5. 外部ブラウザ連携の4ステップを順に挙げよ。
   ▶ 答え: (1) proxy listener が稼働しているか確認、(2) ブラウザのプロキシ設定を Burp に向ける、(3) その設定を検証、(4) Burp の CA 証明書をインストール。

6. Chrome（Windows）で CA 証明書をインポートするとき、ファイルが一覧に見えない最頻出の原因は何か。
   ▶ 答え: Burp の CA は `.der` 形式なので、ファイル選択のフィルタを **All Files** にしないと表示されない。

7. 価格改ざん lab で `price` を 1 に変えて注文できてしまうのは、どんな設計上の欠陥か。
   ▶ 答え: サーバが商品の価格をクライアント（HTTP リクエスト）から受け取った値で検証せず信頼していたため。クライアントサイド制御への過信（excessive trust in client-side controls）という論理欠陥である。

8. HTTP history は intercept が off のときの通信も記録するか。
   ▶ 答え: する。intercept off の間に Burp Proxy を通った全 HTTP トラフィックが履歴に残るので、普通に閲覧してから後でやり取りを研究できる。

9. Burp Scanner はどのエディションで使えるか。
   ▶ 答え: Burp Suite Professional と Burp Suite Enterprise Edition のみ。Community Edition では使えない。

10. 他人から受け取ったプロジェクトファイルを開くとき、なぜ注意が必要か。どんな安全設定があるか。
    ▶ 答え: 悪意ある設定や自動タスクが仕込まれていると、開いた瞬間に意図しないリクエストが飛ぶ危険があるため。**Pause Automated Tasks** と **Trust this project file** の2設定があり、信頼できないファイルではこれらで自動タスクの停止や有害設定の除去ができる。ただし公式は信頼できないファイルでのプロキシ自体を非推奨としている。

## 出典

- https://portswigger.net/burp/documentation/desktop/getting-started
- https://portswigger.net/burp/documentation/desktop/getting-started/download-and-install.html
- https://portswigger.net/burp/documentation/desktop/getting-started/system-requirements.html
- https://portswigger.net/burp/documentation/desktop/getting-started/mac-installer.html
- https://portswigger.net/burp/documentation/desktop/getting-started/activating-burp-license.html
- https://portswigger.net/burp/documentation/desktop/projects/index.html
- https://portswigger.net/burp/documentation/desktop/projects/create-project-file.html
- https://portswigger.net/burp/documentation/desktop/tools/proxy
- https://portswigger.net/burp/documentation/desktop/tools/burps-browser.html
- https://portswigger.net/burp/documentation/desktop/tools/proxy/intercept-messages.html
- https://portswigger.net/burp/documentation/desktop/external-browser-config/index.html
- https://portswigger.net/burp/documentation/desktop/external-browser-config/certificate/index.html
- https://portswigger.net/burp/documentation/desktop/tools/proxy/manage-certificates.html
- https://portswigger.net/burp/documentation/desktop/mobile/config-ios-device.html
- https://portswigger.net/burp/documentation/desktop/mobile/config-android-device.html

<!-- sources: https://portswigger.net/burp/documentation/desktop/getting-started, https://portswigger.net/burp/documentation/desktop/tools/proxy, https://portswigger.net/burp/documentation/desktop/getting-started/system-requirements.html, https://portswigger.net/burp/documentation/desktop/projects/create-project-file.html, https://portswigger.net/burp/documentation/desktop/external-browser-config/certificate/index.html, https://portswigger.net/burp/documentation/desktop/tools/proxy/manage-certificates.html, https://portswigger.net/burp/documentation/desktop/tools/proxy/intercept-messages.html -->
<!-- terms: Burp Suite, Burp Proxy, proxy listener, intercept, HTTP history, Repeater, target scope, CA証明書, TLS, 中間者攻撃, trust store, Burp's browser, プロジェクトファイル, Burp Scanner, クライアントサイド制御への過信, Apache Struts, invisible proxying, loopback, DER形式, browser-powered scanning, Burp Collaborator, passive crawl -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/proxy | サイト側 egress ブロックにより live ページ取得不可、オフライン版 HTML ミラーから逐語取得 -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/getting-started | サイト側 egress ブロックにより live ページ取得不可、オフライン版 HTML ミラーから逐語取得 -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/mobile/config-ios-device.html | 担当URL配下でなく live アクセスもブロックされ未取得、目次・関連ページからの要約 -->
