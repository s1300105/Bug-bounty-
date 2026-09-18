# [28] Chrome DevTools による JavaScript デバッグ — Sources パネル入門チュートリアル＋デバッグ機能リファレンス（ch05）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://developer.chrome.com/docs/devtools/javascript | full | 公式ドキュメントの上流 Markdown ソースを `curl` で取得（`https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/HEAD/site/en/docs/devtools/javascript/index.md`） | WebFetch は `EGRESS_BLOCKED`（`developer.chrome.com` はプロキシで遮断）。`curl` 直叩きも CONNECT 403。`web.archive.org` も遮断。そこで **同一内容を生成している公式リポジトリ GoogleChrome/developer.chrome.com の原稿 Markdown** を取得した。原稿 front matter: `title: "Debug JavaScript"`, `date: 2017-01-04`, `updated: 2023-03-07`。本文・コード・ステップ番号は原文逐語。画像/動画ショートコード（`{% Img %}` 等）のみ省略しキャプション情報は本文に取り込んだ。ライブ版に 2024 年以降の追記があった場合はそれを反映していない可能性がある（後述「読者が自分で開くべき資料」参照） |
| https://developer.chrome.com/docs/devtools/javascript/reference | full | 同上（`.../site/en/docs/devtools/javascript/reference/index.md`） | front matter: `title: "JavaScript debugging reference"`, `date: 2017-01-04`, `updated: 2022-11-29`。全節を逐語取得。**ただしこのスナップショットには「Debug JavaScript with VS Code」に相当する節は存在しない**（担当指示に挙がっていたが原典スナップショットで確認できず、捏造を避けて記載しない） |
| （補助）https://developer.chrome.com/docs/devtools/javascript/breakpoints | full | 同リポジトリ `javascript/breakpoints/index.md` | 対象 URL2 が「breakpoint の種類は別ページ参照」と委譲しているため取得。breakpoint 全種類の一覧表を含む |
| （補助）https://developer.chrome.com/docs/devtools/sources | full | 同リポジトリ `sources/index.md` | Sources パネル全体像 |
| （補助）https://developer.chrome.com/docs/devtools/javascript/snippets | full | 同リポジトリ `javascript/snippets/index.md` | Snippets |
| （補助）https://developer.chrome.com/docs/devtools/overrides | full | 同リポジトリ `overrides/index.md` | Local Overrides（レスポンスヘッダ上書きを含む） |
| （補助）https://developer.chrome.com/docs/devtools/javascript/source-maps | full | 同リポジトリ `javascript/source-maps/index.md` | source maps |
| （補助）https://developer.chrome.com/docs/devtools/developer-resources | full | 同リポジトリ `developer-resources/index.md` | source map の読み込み確認・手動ロード |
| （補助）https://developer.chrome.com/docs/devtools/settings/ignore-list | full | 同リポジトリ `settings/ignore-list/index.md` | Ignore List（旧 blackbox） |
| （補助）https://developer.chrome.com/docs/devtools/javascript/disable | full | 同リポジトリ `javascript/disable/index.md` | JavaScript 無効化 |
| （補助）https://developer.chrome.com/docs/devtools/shortcuts | full | 同リポジトリ `shortcuts/index.md` | Sources パネル／Code Editor のショートカット表（逐語） |
| （補助）https://developer.chrome.com/docs/devtools/console/utilities | full | 同リポジトリ `console/utilities/index.md` | Console Utilities API（`debug()`, `monitor()`, `monitorEvents()`, `getEventListeners()`, `queryObjects()` 等） |
| （補助）https://developer.chrome.com/docs/devtools/settings/preferences | full | 同リポジトリ `settings/preferences/index.md` | Sources / Debugger 設定項目 |

> **取得ルートに関する注意（重要）**: この環境では `developer.chrome.com` への HTTPS が組織の egress ポリシーで遮断されている（WebFetch: `EGRESS_BLOCKED`、curl: `CONNECT tunnel failed, response 403`）。`web.archive.org` も遮断。`api.github.com` / `github.com` の HTML も 403。唯一通った `raw.githubusercontent.com` 経由で**公式ドキュメントのソース原稿（Google 自身が publish しているリポジトリ）**を取得しているため、内容は二次情報ではなく原典そのものである。ただしリポジトリのスナップショットであるため、ライブ版の最新追記との差分が理論上ありうる。

---

## 要約（3〜10行）

- Chrome DevTools の **Sources パネル**は「File Navigator（Page）ペイン / Code Editor ペイン / JavaScript Debugging ペイン」の 3 部構成で、クライアントサイド JS の実行を任意地点で止め、その瞬間の全変数を観測するための中核 UI である。
- 入門チュートリアル（URL1）は「バグ再現 → Sources UI 把握 → Event Listener Breakpoint で停止 → step through → line-of-code breakpoint → 値の確認（Scope / Watch / Console）→ その場で修正（ライブ編集）」の 7 ステップで、`console.log()` 挿入よりブレークポイントが速い理由（コード構造を知らずに止められる／全変数が自動で見える）を明示する。
- リファレンス（URL2）は機能の網羅的カタログ：inline evaluation（停止中に宣言の横へ現在値を表示）、hover でクラス/関数のプロパティプレビュー、Step over / into / out、Continue to here、Resume、**Force script execution（全ブレークポイントを無視して再開）**、Threads（worker 間のコンテキスト切替）、カンマ区切り式のステップ（minify 対策）、Scope（編集可）、Call Stack（Restart frame / ignore-listed frames 表示 / async frames / Copy stack trace）、ファイルツリーの Authored/Deployed グルーピング、Ignore List（script の無視＝旧 blackbox）、Snippets、Watch、Editor（pretty print `{ }`、code folding、編集と保存、**paused 関数のライブ編集**、検索と置換）、JavaScript 無効化。
- ブレークポイントは 9 種類（line-of-code / conditional / logpoint / DOM / XHR-fetch / event listener / exception / function / **Trusted Type**）。最後の Trusted Type / CSP Violation Breakpoints は DOM XSS 調査に直結し、公式ドキュメント自身が「source → sink」という DOM XSS の定義を載せている。
- 攻防・診断の観点では、XHR/fetch breakpoint（URL 部分文字列一致で `send()` 直前に停止）、DOM change breakpoint（`.innerHTML` 等で DOM を書き換えたコードの特定）、`debug(fn)` / `monitorEvents()` / `getEventListeners()` / `queryObjects()`、Local Overrides（レスポンスヘッダや JS 本体をローカルで差し替えて仮説検証）、source maps（配布 bundle から著者コードへ復元）が最重要の道具である。

---

## 詳細ノート

### 1. Debug JavaScript（入門チュートリアル） （出典: https://developer.chrome.com/docs/devtools/javascript）

原稿タイトル `Debug JavaScript`、説明文 `"Learn how to use Chrome DevTools to find and fix JavaScript bugs."`、tags: `get-started`, `javascript`。冒頭に「このチュートリアルは DevTools で任意の JavaScript 問題をデバッグする基本ワークフローを教える」とあり、動画版（YouTube ID `H0XScE08hy8`）へのリンクがある。

#### 1.1 Step 1: Reproduce the bug（バグを再現する） — アンカー `#reproduce`

「**バグを一貫して再現する一連の操作を見つけることが、デバッグの常に最初のステップ**」と明言している。

手順（原文逐語の訳）:

1. [このデモ](https://googlechrome.github.io/devtools-samples/debug-js/get-started) を新しいタブで開く。
2. **Number 1** テキストボックスに `5` を入力する。
3. **Number 2** テキストボックスに `1` を入力する。
4. **Add Number 1 and Number 2** をクリックする。ボタン下のラベルが `5 + 1 = 51` と表示される。結果は `6` であるべき。これが修正対象のバグ。

画像キャプション: “The result of 5 + 1 is 51. It should be 6.”（この例では 5 + 1 の結果が 51 になっている。6 であるべき。）

〔補足（一般知識）〕文字列連結による `"5" + "1" === "51"` という典型的な型バグであり、後段の Watch 式 `typeof sum` で正体が確定する流れになっている。

#### 1.2 Step 2: Get familiar with the Sources panel UI（Sources パネル UI に慣れる） — アンカー `#sources-ui`

原文の説明: DevTools は CSS 変更、ページ読み込みパフォーマンスのプロファイリング、ネットワークリクエストの監視など、タスクごとに多くの異なるツールを提供する。**Sources パネルは JavaScript をデバッグする場所**である。

手順:

1. **Command+Option+J（Mac）** または **Control+Shift+J（Windows, Linux）** を押して DevTools を開く。このショートカットは **Console** パネルを開く。
2. **Sources** タブをクリックする。

**Sources パネル UI は 3 つのパートを持つ**:

1. **File Navigator ペイン**。ページが要求したすべてのファイルがここに列挙される。
2. **Code Editor ペイン**。File Navigator ペインでファイルを選択すると、そのファイルの内容がここに表示される。
3. **JavaScript Debugging ペイン**。ページの JavaScript を検査するための各種ツール。**DevTools ウィンドウが広い場合、このペインは Code Editor ペインの右側に表示される**。

#### 1.3 Step 3: Pause the code with a breakpoint（ブレークポイントでコードを一時停止） — アンカー `#event-breakpoint`

まず「`console.log()` を大量に挿入する」従来手法の例が原文コードで示される。

##### コード/コマンド（原文のまま逐語）

```js
function updateLabel() {
  var addend1 = getNumber1();
  console.log('addend1:', addend1);
  var addend2 = getNumber2();
  console.log('addend2:', addend2);
  var sum = addend1 + addend2;
  console.log('sum:', sum);
  label.textContent = addend1 + ' + ' + addend2 + ' = ' + sum;
}
```

原文の主張（ブレークポイントが `console.log()` に優る理由、逐語訳）:

- `console.log()` では、ソースコードを手で開き、該当コードを探し、`console.log()` 文を挿入し、ページをリロードして Console でメッセージを見る必要がある。**ブレークポイントなら、コードがどう構成されているか知らなくても関連コードで停止できる。**
- `console.log()` 文では検査したい値を明示的に一つずつ指定する必要がある。**ブレークポイントなら、その時点の全変数の値を DevTools が見せてくれる。自分が気付いていない変数がコードに影響していることもある。**
- 要するに、ブレークポイントは `console.log()` 方式よりも速くバグを発見・修正できる。

次に「アプリの動作を一歩引いて考えると、誤った合計（`5 + 1 = 51`）は **Add Number 1 and Number 2** ボタンに紐づく `click` イベントリスナ内で計算されていると推測できる。よって `click` リスナが実行される辺りでコードを停止したい。**Event Listener Breakpoints** がまさにそれを可能にする」という推論の道筋が示される。

Event Listener Breakpoint の設定手順（逐語訳）:

1. **JavaScript Debugging** ペインで **Event Listener Breakpoints** をクリックしてセクションを展開する。DevTools は **Animation** や **Clipboard** のような展開可能なイベントカテゴリの一覧を表示する。
2. **Mouse** イベントカテゴリの隣の **Expand**（展開）をクリックする。DevTools は **click** や **mousedown** のようなマウスイベントの一覧を表示する。各イベントの隣にチェックボックスがある。
3. **click** チェックボックスをチェックする。これで DevTools は **任意の（any）** `click` イベントリスナが実行されたときに自動的に停止するよう設定された。
4. デモに戻り、再度 **Add Number 1 and Number 2** をクリックする。DevTools はデモを一時停止し、**Sources** パネルでコード行をハイライトする。DevTools は次の行で停止するはず:

   ```js
   function onClick() {
   ```

   別の行で停止した場合は、正しい行で停止するまで **Resume Script Execution**（スクリプト実行を再開）を押す。

> **Note（原文の注記）**: 別の行で停止した場合、あなたは訪問するすべてのページで `click` イベントリスナを登録するブラウザ拡張をインストールしている。その拡張の `click` リスナで停止していたのである。すべての拡張を無効化する [シークレットモードでのプライベート閲覧](https://support.google.com/chrome/answer/95464) を使えば、毎回正しいコード行で停止することが確認できる。

締めの一文: 「**Event Listener Breakpoints** は DevTools で利用できる多くのブレークポイント種別のうちの一つに過ぎない。**各種別をすべて覚える価値がある**。どの種別も異なるシナリオを最速でデバッグする助けになる。いつどう使うかは [Pause Your Code With Breakpoints](/docs/devtools/javascript/breakpoints) を参照。」

〔補足（一般知識）〕拡張機能のリスナで止まる現象は、後述の Ignore List（`Add content scripts to ignore list`）でも回避できる。

#### 1.4 Step 4: Step through the code（コードをステップ実行する） — アンカー `#code-stepping`

原文: 「バグのよくある原因の一つは、スクリプトが**間違った順序**で実行されることである。コードをステップ実行すれば、1 行ずつ実行を追い、期待と異なる順序で実行されている箇所を正確に特定できる。」

1. DevTools の **Sources** パネルで **Step into next function call**（次の関数呼び出しにステップイン）をクリックし、`onClick()` 関数の実行を 1 行ずつ進める。DevTools は次の行をハイライトする:

   ```js
   if (inputsAreEmpty()) {
   ```

2. **Step over next function call**（次の関数呼び出しをステップオーバー）をクリックする。DevTools は `inputsAreEmpty()` にステップインせずに実行する。DevTools が数行スキップすることに注目。これは `inputsAreEmpty()` が false に評価されたため `if` 文のブロックが実行されなかったからである。

原文の締め: 「これがステップ実行の基本的な考え方。`get-started.js` のコードを見ると、バグはおそらく `updateLabel()` 関数のどこかにあると分かる。すべての行をステップするのではなく、別の種類のブレークポイントを使ってバグの推定位置により近い場所でコードを停止できる。」

#### 1.5 Step 5: Set a line-of-code breakpoint（行ブレークポイントを設定） — アンカー `#line-breakpoint`

原文: 「**Line-of-code breakpoints はもっとも一般的な種類のブレークポイント**である。停止したい特定の行が分かっているときに使う。」

1. `updateLabel()` の最後の行を見る:

   ```js
   label.textContent = addend1 + ' + ' + addend2 + ' = ' + sum;
   ```

2. コードの左に、この行の行番号 **32** が見える。**32** をクリックする。DevTools は **32** の上に青いアイコンを置く。これはこの行に行ブレークポイントがあることを意味する。**DevTools は以後、常にこのコード行が実行される前に停止する。**
3. **Resume script execution**（スクリプト実行を再開）をクリックする。スクリプトは 32 行目に達するまで実行を続ける。**29 行、30 行、31 行では、DevTools が `addend1`、`addend2`、`sum` の値を宣言の横にインラインで表示する**（リンク先: `/docs/devtools/javascript/reference/#inline-eval`）。

画像キャプション: “DevTools pauses on the line-of-code breakpoint on line 32.”

#### 1.6 Step 6: Check variable values（変数の値を確認する） — アンカー `#check-values`

原文: 「`addend1`、`addend2`、`sum` の値が疑わしい。**引用符で囲まれている**、つまり文字列だ。これはバグ原因を説明する良い仮説である。さらに情報を集める時が来た。DevTools は変数の値を調べるための多くのツールを提供する。」

##### Method 1: The Scope pane（アンカー `#scope`）

コード行で停止しているとき、**Scope** ペインは現在定義されている **local および global** 変数と各変数の値を表示する。該当する場合は **closure** 変数も表示する。**変数の値をダブルクリックすると編集できる。** コード行で停止していないとき、**Scope** ペインは空である。

##### Method 2: Watch Expressions（アンカー `#watch-expressions`）

**Watch Expressions** タブでは変数の値を時間を通して監視できる。名前の通り、Watch Expressions は変数に限らず、**任意の有効な JavaScript 式**を格納できる。

1. **Watch** タブをクリックする。
2. **Add Expression**（式を追加）をクリックする。
3. `typeof sum` と入力する。
4. <kbd>Enter</kbd> を押す。DevTools は `typeof sum: "string"` と表示する。コロンの右側の値が Watch Expression の結果である。

原文の補足: スクリーンショットは `typeof sum` watch expression を作成した後の **Watch Expression** ペイン（右下）を示す。DevTools ウィンドウが大きい場合、**Watch Expression** ペインは右側、**Event Listener Breakpoints** ペインの上にある。

結論: 「疑ったとおり、`sum` は数値であるべきところ文字列として評価されている。これがバグの原因であることを確認できた。」

##### Method 3: The Console（アンカー `#console`）

`console.log()` メッセージを見るだけでなく、Console で**任意の JavaScript 文を評価**できる。デバッグの文脈では、Console でバグの修正候補をテストできる。

1. Console ドロワーが開いていなければ <kbd>Escape</kbd> を押して開く。DevTools ウィンドウの下部に開く。
2. Console に `parseInt(addend1) + parseInt(addend2)` と入力する。**この文が動くのは、`addend1` と `addend2` がスコープ内にあるコード行で停止しているからである。**
3. <kbd>Enter</kbd> を押す。DevTools は文を評価して `6` を出力する。これがデモが生成すべき期待結果である。

##### コード/コマンド（原文のまま逐語）

```js
typeof sum
```

```js
parseInt(addend1) + parseInt(addend2)
```

#### 1.7 Step 7: Apply a fix（修正を適用する） — アンカー `#apply-fix`

原文: 「バグの修正方法が分かった。残りは、コードを編集してデモを再実行し、修正を試すだけ。**修正を適用するために DevTools を離れる必要はない。DevTools の UI 内で直接 JavaScript コードを編集できる。**」

1. **Resume script execution** をクリックする。
2. **Code Editor** で 31 行目 `var sum = addend1 + addend2` を `var sum = parseInt(addend1) + parseInt(addend2)` に置き換える。
3. <kbd>Command</kbd> + <kbd>S</kbd>（Mac）または <kbd>Control</kbd> + <kbd>S</kbd>（Windows, Linux）を押して変更を保存する。
4. **Deactivate breakpoints**（ブレークポイントを無効化）をクリックする。**色が青に変わり、有効であることを示す。これが設定されている間、DevTools は設定済みのブレークポイントをすべて無視する。**
5. 異なる値でデモを試す。デモは正しく計算するようになる。

> **Caution（原文の警告、逐語訳）**: このワークフローは**ブラウザで動いているコードにのみ修正を適用する**。あなたのページを訪れる全ユーザのコードは修正されない。そのためにはサーバ上のコードを修正する必要がある。ただし [Workspaces で DevTools 内のファイルを編集してソースに保存する](/docs/devtools/workspaces/) ことはできる。

> **Gotchas（原文）**: Chrome バージョン 105 以降、[停止中の関数をライブ編集](/docs/devtools/javascript/reference/#live-edit) できる。

##### コード/コマンド（原文のまま逐語）

```js
var sum = addend1 + addend2
```

```js
var sum = parseInt(addend1) + parseInt(addend2)
```

#### 1.8 Next steps（次のステップ） — アンカー `#next-steps`

原文: 「このチュートリアルではブレークポイントの設定方法を 2 つだけ示した。DevTools は他にも多くの方法を提供する:」

- **Conditional breakpoints**（提供した条件が真のときだけ発火する条件付きブレークポイント）
- **Breakpoints on caught or uncaught exceptions**（捕捉された／捕捉されない例外でのブレークポイント）
- **XHR breakpoints**（要求 URL が提供した部分文字列に一致したときに発火する XHR ブレークポイント）

さらに「このチュートリアルで説明していないコードステッピング操作がいくつかある。[Step over line of code](/docs/devtools/javascript/reference#stepping) を参照」と続く。

参照リンク（原文の footnote 定義、逐語）:

```
[2]: https://support.google.com/chrome/answer/95464
[3]: /docs/devtools/javascript/breakpoints
[4]: /docs/devtools/javascript/breakpoints
[5]: /docs/devtools/javascript/reference#stepping
```

---

### 2. JavaScript debugging reference（デバッグ機能リファレンス） （出典: https://developer.chrome.com/docs/devtools/javascript/reference）

原稿タイトル `JavaScript debugging reference`、説明文 `"Discover new debugging workflows in this comprehensive reference of Chrome DevTools debugging features."`、`updated: 2022-11-29`。冒頭で「デバッグの基本は [Get Started With Debugging JavaScript In Chrome DevTools](/docs/devtools/javascript) を参照」と案内する。

以下、原文の見出し構造（アンカー付き）をすべて列挙し、内容を詳細化する。

#### 2.1 Pause code with breakpoints（`#breakpoints`）

「実行の途中でコードを停止できるようにブレークポイントを設定する。設定方法は [Pause Your Code With Breakpoints](/docs/devtools/javascript/breakpoints) を参照。」（種類の詳細は本ノート §3 に転記）

##### 2.1.1 Check values when paused（停止中に値を確認する / `#inline-eval`）

原文逐語訳: 「**実行が停止している間、デバッガは現在の関数内にあるすべての変数・定数・オブジェクトを、ブレークポイントまでの範囲で評価する。デバッガは対応する宣言の横に現在値をインラインで表示する。**」

さらに「[**Console**](/docs/devtools/console/) を使って、評価済みの変数・定数・オブジェクトを照会できる」と記述。

> **Gotchas（原文）**: 実行が停止している間、[現在の関数を再実行（restart）](/docs/devtools/javascript/reference/#restart-frame) することも、[ライブ編集](/docs/devtools/javascript/reference/#live-edit) することもできる。

##### 2.1.2 Preview class/function properties on hover（ホバーでクラス/関数のプロパティをプレビュー / `#properties`）

「実行が停止している間、クラス名または関数名にホバーすると、そのプロパティをプレビューできる。」

#### 2.2 Step through code（コードのステップ実行 / `#stepping`）

「コードが停止したら、1 つの式ずつステップ実行し、制御フローとプロパティ値を途中で調査する。」

##### 2.2.1 Step over line of code（`#step-over`）

「デバッグ対象の問題に関係しない関数を含む行で停止しているとき、**Step over** をクリックすると、その関数にステップインせずに実行する。」

###### コード/コマンド（原文のまま逐語）

```js
function updateHeader() {
  var day = new Date().getDay();
  var name = getName(); // A
  updateName(name); // D
}
function getName() {
  var name = app.first + ' ' + app.last; // B
  return name; // C
}
```

原文の解説: 「`A` で停止している。**Step over** を押すと、DevTools はステップオーバーする関数内のすべてのコード、すなわち `B` と `C` を実行する。そして DevTools は `D` で停止する。」

##### 2.2.2 Step into line of code（`#step-into`）

「デバッグ対象の問題に関係する関数呼び出しを含む行で停止しているとき、**Step into** をクリックしてその関数をさらに調査する。」

###### コード/コマンド（原文のまま逐語）

```js
function updateHeader() {
  var day = new Date().getDay();
  var name = getName(); // A
  updateName(name);
}
function getName() {
  var name = app.first + ' ' + app.last; // B
  return name;
}
```

「`A` で停止している。**Step into** を押すと、DevTools はこの行を実行し、`B` で停止する。」

##### 2.2.3 Step out of line of code（`#step-out`）

「デバッグ対象の問題に関係しない関数の内部で停止しているとき、**Step out** をクリックしてその関数の残りのコードを実行する。」

###### コード/コマンド（原文のまま逐語）

```js
function updateHeader() {
  var day = new Date().getDay();
  var name = getName();
  updateName(name); // C
}
function getName() {
  var name = app.first + ' ' + app.last; // A
  return name; // B
}
```

「`A` で停止している。**Step out** を押すと、DevTools は `getName()` の残りのコード（この例では `B` のみ）を実行し、`C` で停止する。」

##### 2.2.4 Run all code up to a certain line（特定の行まで全コードを実行 / `#continue-to-here`）

原文: 「長い関数をデバッグしているとき、問題に無関係なコードが大量にあることがある。全行をステップすることも*できる*が、退屈である。関心のある行に行ブレークポイントを設定して **Resume Script Execution** を押すことも*できる*が、もっと速い方法がある。」

**関心のあるコード行を右クリックして **Continue to here** を選択する。DevTools はその地点までのすべてのコードを実行し、その行で停止する。**

〔補足（一般知識）〕ショートカット表（§4.10）では「Continue to a certain line of code while paused」= Mac: `Command` を押しながら行をクリック / Win・Linux: `Control` を押しながら行をクリック、と記載されている。

##### 2.2.5 Resume script execution（`#resume`）

「一時停止後にスクリプトの実行を続けるには **Resume Script Execution** をクリックする。DevTools は次のブレークポイントがあればそこまでスクリプトを実行する。」

##### 2.2.6 Force script execution（すべてのブレークポイントを無視して強制再開 / `#force-resume`）

原文逐語訳: 「**すべてのブレークポイントを無視してスクリプトの実行を強制的に再開するには、Resume Script Execution をクリックして長押し（click and hold）し、Force script execution を選択する。**」

〔補足（一般知識）〕これが担当指示にあった「resume with all pauses blocked」に相当する機能である。無限に発火するブレークポイント（例: 毎フレーム走る `click`／`timer` 系ブレークポイントや、アンチデバッグの `debugger` ループ）から抜け出す際に使う。原典スナップショットの表記は **Force script execution** であり、この名称で記録する。

##### 2.2.7 Change thread context（スレッドコンテキストの切り替え / `#threads`）

「web workers や service workers を扱うとき、**Threads** ペインに列挙されたコンテキストをクリックしてそのコンテキストに切り替える。**青い矢印アイコン**が現在選択されているコンテキストを表す。」

原文の例: 「メインスクリプトと service worker スクリプトの両方でブレークポイントに停止しているとする。service worker コンテキストの local / global プロパティを見たいが、Sources パネルはメインスクリプトのコンテキストを表示している。Threads ペインの service worker エントリをクリックすれば、そのコンテキストに切り替えられる。」

##### 2.2.8 Step through comma-separated expressions（カンマ区切り式のステップ実行 / `comma-separated`）

> **Gotchas（原文）**: **Chrome バージョン 108 以降、Debugger はセミコロン区切り（`;`）とカンマ区切り（`,`）の両方の式をステップ実行できる。**

「カンマ区切り式をステップ実行できることで、minify されたコードをデバッグできる。」

###### コード/コマンド（原文のまま逐語）

```js
function foo() {}

function bar() {
  foo();
  foo();
  return 42;
}

bar();
```

minify されると、カンマ区切りの `foo(),foo(),42` 式を含む:

```js
function foo(){}function bar(){return foo(),foo(),42}bar();
```

原文: 「**Debugger** はそうした式も同じようにステップする。したがってステップ挙動は次の場合に同一である:

- minify されたコードと著者が書いたコードの間。
- [source maps](/blog/sourcemaps/) を使って minify コードを元コードの観点でデバッグする場合。言い換えると、**セミコロンが見えているなら、実際にデバッグしているソースが minify されていても常にそこをステップできると期待してよい。**」

#### 2.3 View and edit local, closure, and global properties（local / closure / global プロパティの表示と編集 / `#scope`）

「コード行で停止している間、**Scope** ペインで local、closure、global スコープのプロパティと変数の値を表示・編集する。

- **プロパティ値をダブルクリックすると変更できる。**
- **列挙不可（Non-enumerable）なプロパティはグレー表示される。**」

#### 2.4 View the current call stack（現在のコールスタックを表示 / `#call-stack`）

「コード行で停止している間、**Call Stack** ペインで、この地点に至ったコールスタックを表示する。エントリをクリックすると、その関数が呼ばれたコード行にジャンプする。**青い矢印アイコン**が DevTools が現在ハイライトしている関数を表す。」

> **Note（原文）**: コード行で停止していないとき、**Call Stack** ペインは空である。

##### 2.4.1 Restart a function (frame) in a call stack（コールスタック内の関数フレームを再実行 / `#restart-frame`）

原文逐語訳: 「関数の挙動を観察し、デバッグフロー全体を再開せずに再実行するために、関数が停止しているときにその単一の関数の実行を再開（restart）できる。言い換えると、コールスタック内の関数のフレームを restart できる。」

手順:

1. [ブレークポイントで関数実行を停止する](#breakpoints)。**Call Stack** ペインが関数呼び出しの順序を記録する。
2. **Call Stack** ペインで関数を右クリックし、ドロップダウンメニューから **Restart frame** を選ぶ。

> **Note（原文）**: **Call Stack** 内の任意の関数フレームを restart できる。**ただし WebAssembly、async、generator 関数は除く。**

###### コード/コマンド（原文のまま逐語）

```js
function foo(value) {
    console.log(value);
    bar(value);
}

function bar(value) {
    value++;
    console.log(value);
    debugger;
}

foo(0);
```

原文の解説: 「`foo()` 関数は `0` を引数に取り、ログ出力し、`bar()` を呼ぶ。`bar()` は引数をインクリメントする。」

両関数のフレームを restart する手順（逐語訳）:

1. 上記コードを [新しい snippet](/docs/devtools/javascript/snippets/#createsources) にコピーし [実行する](/docs/devtools/javascript/snippets/#runsources)。実行は `debugger` の [行ブレークポイント](/docs/devtools/javascript/breakpoints/#debugger) で停止する。
   > **Caution（原文）**: 実行が停止しているとき、**プログラム的にコールスタックフレームの順序を変更しないこと。予期しないエラーを引き起こす可能性がある。**
2. デバッガが関数宣言の横に現在値 `value = 1` を表示することに注目。
3. `bar()` フレームを restart する。
4. **`F9`** を押して値インクリメント文をステップする。現在値が増加し `value = 2` になることに注目。
5. 任意で、**Scope** ペインで値をダブルクリックして編集し、任意の値を設定する。
6. `bar()` フレームの restart とインクリメント文のステップを何度か繰り返す。値は増え続ける。

   > **Gotchas（原文）**: なぜ値が `0` にリセットされないのか？ — **フレームの restart は引数をリセットしない。つまり restart は関数呼び出し時の初期状態を復元しない。単に実行ポインタを関数の先頭に移動するだけである。** したがって同じ関数の restart をまたいで現在の引数値がメモリ上に残る。

7. 次に **Call Stack** で `foo()` フレームを restart する。値が再び `0` になることに注目。

   > **Gotchas（原文）**: なぜ値が `0` にリセットされるのか？ — **JavaScript では、引数への変更は関数の外から見えない（反映されない）。ネストされた関数は値を受け取るのであり、メモリ上の位置を受け取るのではない。**

8. **`F8`** でスクリプト実行を再開してチュートリアルを完了する。

##### 2.4.2 Show ignore-listed frames（無視リストのフレームを表示 / `#show-ignore-listed-frames`）

原文: 「既定では **Call Stack** ペインは自分のコードに関連するフレームのみ表示し、[**Settings** > **Ignore List**](/docs/devtools/settings/ignore-list/) に追加されたスクリプトは省略する。サードパーティのフレームを含む完全なコールスタックを見るには、**Call Stack** セクションの下にある **Show ignore-listed frames** を有効にする。」

デモページ https://ng-devtools.netlify.app/ での試行手順:

1. **Sources** パネルで `src` > `app` > `app.component.ts` ファイルを開く。
2. `increment()` 関数にブレークポイントを設定する。
3. **Call Stack** セクションで **Show ignore-listed frames** チェックボックスをチェック／クリアし、コールスタックの関連フレームのみ／完全な一覧を観察する。

##### 2.4.3 View async frames（非同期フレームの表示 / `#async-frames`）

原文逐語訳: 「使用しているフレームワークがサポートしていれば、DevTools は async コードの両方の部分を互いにリンクして非同期処理を追跡できる。この場合、**Call Stack** は **async 呼び出しフレームを含む完全な呼び出し履歴**を表示する。」

> **Gotchas（原文）**: **DevTools はこの "Async Stack Tagging" 機能を `console.createTask()` API メソッドに基づいて実装している。API の実装はフレームワーク側に委ねられている。** 例えば [Angular はこの機能をサポートしている](/blog/devtools-better-angular-debugging/#the-async-stack-tagging-api-in-angular)。

〔補足（一般知識）〕関連設定として **Settings > Debugger** に `Disable async stack traces`（「Call Stack における非同期処理の『全体像』を隠す」）がある（§4.9 参照）。

##### 2.4.4 Copy stack trace（スタックトレースのコピー / `#copy-stack-trace`）

「**Call Stack** ペインの任意の場所を右クリックして **Copy stack trace** を選ぶと、現在のコールスタックをクリップボードにコピーする。」

###### コード/コマンド（原文のまま逐語 — 出力例）

```js
getNumber1 (get-started.js:35)
inputsAreEmpty (get-started.js:22)
onClick (get-started.js:15)
```

#### 2.5 Navigate the file tree（ファイルツリーの操作 / `#file-tree`）

「[**Page** ペイン](/docs/devtools/javascript/sources/#files) を使ってファイルツリーを操作する。」

##### 2.5.1 Group authored and deployed files in the file tree（`#group-authored-and-deployed`）

> **Note（原文）**: これは **Chrome バージョン 104** から利用できる **preview（実験的）機能**である。

原文: 「フレームワーク（例: [React](https://reactjs.org/) や [Angular](https://angular.io/)）で Web アプリを開発していると、ビルドツール（例: [webpack](https://webpack.js.org/) や [Vite](https://vitejs.dev/)）が生成した minify ファイルのためにソースの探索が難しくなる。**Sources** > **Page** ペインはファイルを 2 つのカテゴリにグループ化できる:

- **Authored**（著者コード）。IDE で見るソースファイルに似ている。**DevTools はビルドツールが提供する source maps に基づいてこれらのファイルを生成する。**
- **Deployed**（デプロイ済み）。**ブラウザが実際に読むファイル。通常 minify されている。**

グルーピングを有効にするには、ファイルツリー上部の三点メニューから **Group files by Authored/Deployed**（実験的）オプションを有効にする。」

##### 2.5.2 Hide ignore-listed sources from the file tree（`#hide-ignore-listed`）

> **Note（原文）**: これは **Chrome バージョン 106** から利用できる preview（実験的）機能である。

「自分が作るコードだけに集中できるよう、**Sources** > **Page** ペインは既定で [**Settings** > **Ignore List**](/docs/devtools/settings/ignore-list/) に追加されたすべてのスクリプトまたはディレクトリをグレー表示する。そうしたスクリプトを完全に隠すには **Sources** > **Page** > 三点メニュー > **Hide ignore-listed sources**（実験的）を選ぶ。」

#### 2.6 Ignore a script or pattern of scripts（スクリプトまたはパターンを無視する / `#ignore-list`）

原文逐語訳: 「デバッグ中にスキップするようスクリプトを無視（ignore）する。**無視されたスクリプトは Call Stack ペインで隠され（obscured）、コードをステップしてもそのスクリプトの関数に決してステップインしない。**」

###### コード/コマンド（原文のまま逐語）

```js
function animate() {
  prepare();
  lib.doFancyStuff(); // A
  render();
}
```

「`A` は信頼しているサードパーティライブラリである。デバッグしている問題がそのサードパーティライブラリに関係しないと確信できるなら、そのスクリプトを無視するのが合理的である。」

##### 2.6.1 Ignore a script or a directory from the file tree（`#file-tree-ignore-list`）

個別スクリプトまたはディレクトリ全体を無視する手順:

1. **Sources** > **Page** でディレクトリまたはスクリプトファイルを右クリックする。
2. **Add directory/script to ignore list** を選ぶ。

「[ignore-list されたソースを隠していない](#hide-ignore-listed) 場合、ファイルツリーでそのソースを選択し、**警告バナー**上で **Remove from ignored list** または **Configure** をクリックできる。それ以外の場合は、[**Settings** > **Ignore List**](/docs/devtools/settings/ignore-list/) の一覧から、隠された／無視されたディレクトリやスクリプトを削除できる。」

##### 2.6.2 Ignore a script from the Editor pane（`#editor-ignore-list`）

1. ファイルを開く。
2. 任意の場所を右クリックする。
3. **Add script to ignore list** を選ぶ。

削除は [**Settings** > **Ignore List**](/docs/devtools/settings/ignore-list/) から。

##### 2.6.3 Ignore a script from the Call Stack pane（`#call-stack-ignore-list`）

1. そのスクリプトの関数を右クリックする。
2. **Add script to ignore list** を選ぶ。

削除は [**Settings** > **Ignore List**](/docs/devtools/settings/ignore-list/) から。

##### 2.6.4 Ignore a script from Settings（`#settings-ignore-list`）

[**Settings** > **Ignore List**](/docs/devtools/settings/ignore-list/) を参照（本ノート §4.6 に詳細を転記）。

〔補足（一般知識）〕この機能は歴史的に **blackbox / Blackbox script** と呼ばれていたもので、現行 UI 名は **Ignore List / Add script to ignore list** である。担当指示の「blackbox」はこの機能を指す。

#### 2.7 Run snippets of debug code from any page（任意のページからデバッグコードの snippet を実行 / `#snippets`）

「Console で同じデバッグコードを何度も実行していると気付いたら、Snippets を検討する。**Snippets は自分で作成し、DevTools 内に保存して実行できる実行可能スクリプトである。** 詳細は [Run Snippets of Code From Any Page](/docs/devtools/javascript/snippets) を参照。」（§4.3 に詳細転記）

#### 2.8 Watch the values of custom JavaScript expressions（カスタム JS 式の値を監視 / `#watch`）

「**Watch** ペインでカスタム式の値を監視する。**任意の有効な JavaScript 式**を監視できる。

- **Add Expression** をクリックして新しい watch 式を作る。
- **Refresh** をクリックして既存のすべての式の値を更新する。**コードをステップしている間、値は自動的に更新される。**
- 式にホバーして **Delete Expression** をクリックすると削除する。」

#### 2.9 Inspect and edit scripts（スクリプトの検査と編集 / `#editor`）

「[**Page**](/docs/devtools/javascript/reference/#file-tree) ペインでスクリプトを開くと、DevTools は **Editor** ペインにその内容を表示する。**Editor** ペインでコードを閲覧・編集できる。さらに、内容をローカルに [override](/docs/devtools/overrides/) することも、[workspace](/docs/devtools/workspaces/) を作って DevTools で行った変更をローカルのソースに直接保存することもできる。」

##### 2.9.1 Make a minified file readable（minify ファイルを読めるようにする / `#format`）

原文逐語訳: 「**既定で Sources パネルは minify されたファイルを pretty-print する。** pretty-print されると、**Editor** は 1 本の長いコード行を複数行に分けて表示し、**`-`** で行継続であることを示す。

**minify されたファイルを読み込まれたままの姿で見るには、Editor の左下隅の `{ }` をクリックする。**」

##### 2.9.2 Fold code blocks（コードブロックの折りたたみ / `#fold-code-blocks`）

「コードブロックを折りたたむには、左列の行番号にホバーして **Collapse** をクリックする。展開するには、その横の **`{...}`** をクリックする。この挙動の設定は [**Settings** > **Preferences** > **Sources**](/docs/devtools/settings/preferences/#sources) を参照。」

##### 2.9.3 Edit a script（スクリプトを編集する / `#edit`）

「バグを修正するとき、JavaScript コードにいくつか変更を加えて試したくなることが多い。外部ブラウザで変更してページをリロードする必要はない。DevTools 内でスクリプトを編集できる。」

1. **Sources** パネルの **Editor** ペインでファイルを開く。
2. **Editor** ペインで変更を加える。
3. <kbd>Command</kbd>+<kbd>S</kbd>（Mac）または <kbd>Ctrl</kbd>+<kbd>S</kbd>（Windows, Linux）を押して保存する。**DevTools は JS ファイル全体を Chrome の JavaScript エンジンにパッチする（patches the entire JS file into Chrome's JavaScript engine）。**

##### 2.9.4 Edit a paused function live（停止中の関数をライブ編集 / `#live-edit`）

> **Note（原文）**: この機能は **Chrome バージョン 105** から利用できる。

原文逐語訳: 「実行が停止している間、現在の関数を編集して変更をライブに適用できる。ただし次の制限がある:

- **Call Stack の最上位（top-most）関数のみ編集できる。**
- **スタックのさらに下に同じ関数への再帰呼び出しがあってはならない。**」

> **Gotchas（原文）**: 変更を適用すると、デバッガは [関数を自動的に restart する](/docs/devtools/javascript/reference/#restart-frame)。したがって**関数 restart の制限も適用される。WebAssembly、async、generator 関数は restart できない。**

ライブ編集の手順:

1. [ブレークポイントで実行を停止する](/docs/devtools/javascript/reference/#breakpoints)。
2. 停止中の関数を編集する。
3. <kbd>Command</kbd> / <kbd>Control</kbd> + <kbd>S</kbd> を押して変更を適用する。デバッガは [関数を自動的に restart する](/docs/devtools/javascript/reference/#restart-frame)。
4. 実行を続ける。

原文の例示: 「この例では `addend1` と `addend2` 変数が当初 誤った `string` 型を持つ。そのため数値を加算する代わりに文字列が連結される。修正のため、ライブ編集中に `parseInt()` 関数を追加する。」

##### 2.9.5 Search and replace text in a script（スクリプト内のテキスト検索と置換 / `#search`）

検索手順:

1. **Sources** パネルの **Editor** ペインでファイルを開く。
2. 組み込み検索バーを開くため <kbd>Command</kbd>+<kbd>F</kbd>（Mac）または <kbd>Ctrl</kbd>+<kbd>F</kbd>（Windows, Linux）を押す。
3. バーにクエリを入力する。任意で:
   - **Match Case** をクリックしてクエリを大文字小文字区別にする。
   - **Use Regular Expression** をクリックして **RegEx 式**で検索する。
4. <kbd>Enter</kbd> を押す。前／次の検索結果に移動するには上／下ボタンを押す。

置換手順:

1. 検索バーで **Replace** ボタンをクリックする。
2. 置換後のテキストを入力し、**Replace** または **Replace all** をクリックする。

#### 2.10 Disable JavaScript（JavaScript を無効化 / `#disable`）

「[Disable JavaScript With Chrome DevTools](/docs/devtools/javascript/disable) を参照。」（§4.7 に詳細転記）

#### 2.11 リファレンスページの footnote 定義（原文のまま逐語）

```
[1]: /docs/devtools/javascript
[2]: /docs/devtools/javascript/breakpoints
[3]: /docs/devtools/customize/#settings
[4]: /docs/devtools/javascript/snippets
[5]: /docs/devtools/javascript/disable
```

---

### 3. ブレークポイントの全種類 （出典: https://developer.chrome.com/docs/devtools/javascript/breakpoints — 対象 URL2 が委譲している公式ページ）

原稿タイトル `Pause your code with breakpoints`、`updated: 2023-04-03`、動画 ID `JyHjoaUhAus`。冒頭: 「ブレークポイントで JavaScript コードを一時停止する。このガイドは DevTools で利用できる**各種類のブレークポイント**と、いつ・どのように設定するかを説明する。」

#### 3.1 Overview of when to use each breakpoint type（どの種類をいつ使うか / `#overview`）

原文: 「もっとも知られている種類は line-of-code である。しかし line-of-code ブレークポイントは、どこを見るべきか正確に分からない場合や大規模コードベースを扱う場合、設定が非効率になりうる。**他の種類のブレークポイントをいつどう使うか知ることで、デバッグ時間を節約できる。**」

原文の表（HTML `<table>` を逐語再現。左列＝ブレークポイント種類、右列＝「〜したいときに使う」）:

| Breakpoint Type（種類） | Use this when you want to ...（こうしたいとき） |
| --- | --- |
| Line-of-code（`#loc`） | Pause on an exact region of code.（コードの正確な領域で停止したい） |
| Conditional line-of-code（`#conditional-loc`） | Pause on an exact region of code, but only when some other condition is true.（正確な領域で、かつ他の条件が真のときだけ停止したい） |
| Logpoint（`#log-loc`） | Log a message to the **Console** without pausing the execution.（実行を止めずに Console にメッセージを出したい） |
| DOM（`#dom`） | Pause on the code that changes or removes a specific DOM node, or its children.（特定 DOM ノードまたはその子を変更・削除するコードで停止したい） |
| XHR（`#xhr`） | Pause when an XHR URL contains a string pattern.（XHR の URL が文字列パターンを含むときに停止したい） |
| Event listener（`#event-listeners`） | Pause on the code that runs after an event, such as `click`, is fired.（`click` などのイベント発火後に走るコードで停止したい） |
| Exception（`#exceptions`） | Pause on the line of code that is throwing a caught or uncaught exception.（捕捉/未捕捉の例外を投げている行で停止したい） |
| Function（`#function`） | Pause whenever a specific function is called.（特定の関数が呼ばれるたびに停止したい） |
| Trusted Type（`#trusted-type`） | Pause on [Trusted Type](https://www.w3.org/TR/trusted-types/) violations.（Trusted Type 違反で停止したい） |

#### 3.2 Line-of-code breakpoints（`#loc`）

「調査すべきコード領域が正確に分かっているときに使う。**DevTools は *常に* この行が実行される前に停止する。**」

1. **Sources** タブをクリックする。
2. 停止したい行を含むファイルを開く。
3. その行に移動する。
4. 行の左が行番号列。**それをクリックする。行番号列の上に青いアイコンが現れる。**

画像キャプションは「行 **29** に設定された line-of-code breakpoint」。

##### 3.2.1 Line-of-code breakpoints in your code（コード中の `debugger` / `#debugger`）

「コードから `debugger` を呼ぶと、その行で停止する。**これは行ブレークポイントと等価だが、ブレークポイントが DevTools UI ではなくコード中に設定される点が異なる。**」

###### コード/コマンド（原文のまま逐語）

```js
console.log('a');
console.log('b');
debugger;
console.log('c');
```

##### 3.2.2 Conditional line-of-code breakpoints（条件付き行ブレークポイント / `#conditional-loc`）

「実行を止めたいが、**ある条件が真のときだけ**止めたい場合に使う。**とくにループ内で、自分のケースに無関係な停止を飛ばしたいときに有用。**」

1. **Sources** タブを開く。
2. 停止したい行を含むファイルを開く。
3. その行に移動する。
4. 行の左が行番号列。**それを右クリックする。**
5. **Add conditional breakpoint** を選ぶ。行の下にダイアログが表示される。
6. ダイアログに条件を入力する。
7. <kbd>Enter</kbd> を押してブレークポイントを有効化する。**行番号列の上に、疑問符付きのオレンジ色のアイコンが現れる。**

画像キャプション: 「ループ内で `x` が `10` を超えた反復 `i=6` でのみ発火した条件付き行ブレークポイント」。

##### 3.2.3 Log line-of-code breakpoints（logpoint / `#log-loc`）

原文逐語訳: 「**logpoint** を使うと、実行を止めることなく、また `console.log()` 呼び出しでコードを散らかすことなく、**Console** にメッセージを出力できる。」

1. **Sources** タブを開く。
2. 対象行を含むファイルを開く。
3. その行に移動する。
4. 行番号列を右クリックする。
5. **Add logpoint** を選ぶ。行の下にダイアログが表示される。
6. ダイアログにログメッセージを入力する。[`console.log(message)`](https://developer.mozilla.org/docs/Web/API/Console/log) 呼び出しと同じ構文が使える。

   例（原文のまま逐語）:

   ```js
   "A string " + num, str.length > 1, str.toUpperCase(), obj
   ```

   この場合ログされるメッセージ（原文のまま逐語）:

   ```js
   // str = "test"
   // num = 3
   // obj = {attr: "x"}
   A string 42 true TEST {attr: 'x'}
   ```

7. <kbd>Enter</kbd> を押してブレークポイントを有効化する。**行番号列の上に、2 つのドットを持つピンク色のアイコンが現れる。**

画像キャプション: 「30 行目の logpoint が文字列と変数値を **Console** にログする例」。

##### 3.2.4 Edit line-of-code breakpoints（行ブレークポイントの編集 / `#manage-loc`）

「**Breakpoints** ペインを使って行ブレークポイントを無効化・編集・削除する。」

**Edit groups of breakpoints（グループ操作 / `#manage-groups`）**: 「**Breakpoints** ペインはブレークポイントを**ファイル単位でグループ化**し、**行番号・列番号順に並べる**。グループに対して次ができる:

- グループを折りたたむ／展開するには、その名前をクリックする。
- グループまたは個別のブレークポイントを有効／無効にするには、その隣のチェックボックスをクリックする。
- グループを削除するには、ホバーして閉じるアイコンをクリックする。」

「ブレークポイントを無効化すると、**Sources** パネルは行番号の隣のマーカーを**半透明**にする。」

グループの右クリックコンテキストメニュー（原文の箇条書き逐語訳）:

- Remove all breakpoints in file (group).（ファイル内の全ブレークポイントを削除）
- Disable all breakpoints in file.（ファイル内の全ブレークポイントを無効化）
- Enable all breakpoints in file.（ファイル内の全ブレークポイントを有効化）
- Remove all breakpoints (in all files).（全ファイルの全ブレークポイントを削除）
- Remove other breakpoints (in other groups).（他グループのブレークポイントを削除）

**Edit breakpoints（個別編集 / `#edit-breakpoints`）**:

- ブレークポイントの隣のチェックボックスをクリックして有効／無効を切り替える。無効化するとマーカーが半透明になる。
- ブレークポイントにホバーして編集アイコンで編集、閉じるアイコンで削除する。
- **編集中、インラインエディタのドロップダウンリストから種類（type）を変更できる。**
- ブレークポイントを右クリックしてコンテキストメニューから次を選ぶ:
  - Remove breakpoint.（ブレークポイントを削除）
  - Edit condition or logpoint.（条件または logpoint を編集）
  - Reveal location.（位置を表示）
  - Remove all breakpoints (in all files).（全ファイルの全ブレークポイントを削除）
  - Remove other breakpoints (in other files).（他ファイルのブレークポイントを削除）

#### 3.3 DOM change breakpoints（DOM 変更ブレークポイント / `#dom`）

「DOM ノードまたはその子を変更するコードで停止したいときに使う。」

1. **Elements** タブをクリックする。
2. ブレークポイントを設定したい要素に移動する。
3. 要素を右クリックする。
4. **Break on** にホバーし、**Subtree modifications**、**Attribute modifications**、**Node removal** のいずれかを選ぶ。

DOM 変更ブレークポイントの一覧は次の場所で確認できる:

- **Elements** > **DOM Breakpoints** ペイン。
- **Sources** > **DOM Breakpoints** サイドペイン。

そこでできること:

- チェックボックスで有効／無効にする。
- 右クリック > **Remove** または **Reveal**（DOM 内で表示）。

##### 3.3.1 Types of DOM change breakpoints（種類 / `#dom-types`）

原文逐語訳:

- **Subtree modifications**: **現在選択されているノードの子が削除または追加されたとき、または子の内容が変更されたとき**に発火する。**子ノードの属性変更、および現在選択されているノード自身への任意の変更では発火しない。**
- **Attributes modifications**: **現在選択されているノードで属性が追加・削除されたとき、または属性値が変化したとき**に発火する。
- **Node Removal**: **現在選択されているノードが削除されたとき**に発火する。

#### 3.4 XHR/fetch breakpoints（`#xhr`）

原文逐語訳: 「**XHR の要求 URL が指定した文字列を含むときに停止したい**場合に使う。**DevTools は XHR が `send()` を呼ぶコード行で停止する。**

これが役立つ例の一つは、ページが不正な URL を要求していると分かり、その不正リクエストを引き起こしている AJAX または Fetch のソースコードを素早く見つけたいときである。」

1. **Sources** タブをクリックする。
2. **XHR Breakpoints** ペインを展開する。
3. **Add breakpoint** をクリックする。
4. **停止したい文字列を入力する。DevTools は、この文字列が XHR の要求 URL のどこかに存在するときに停止する。**
5. <kbd>Enter</kbd> を押して確定する。

画像キャプション: 「**XHR/fetch Breakpoints** で、URL に `org` を含む任意のリクエスト用の XHR/fetch ブレークポイントを作る例」。

#### 3.5 Event listener breakpoints（`#event-listeners`）

「**イベント発火後に実行されるイベントリスナのコードで停止したい**ときに使う。`click` のような特定のイベントを選ぶことも、すべてのマウスイベントのような**イベントのカテゴリ**を選ぶこともできる。」

1. **Sources** タブをクリックする。
2. **Event Listener Breakpoints** ペインを展開する。DevTools は **Animation** のようなイベントカテゴリの一覧を表示する。
3. カテゴリのいずれかをチェックすると、そのカテゴリの任意のイベントが発火したときに停止する。またはカテゴリを展開して特定のイベントをチェックする。

画像キャプション: 「`deviceorientation` 用のイベントリスナブレークポイントを作る例」。

追記: 「さらに、**Elements** > **Event Listeners** ペインでイベントリスナの一覧を確認できる。」

#### 3.6 Exception breakpoints（例外ブレークポイント / `#exceptions`）

「**捕捉された（caught）または捕捉されない（uncaught）例外を投げている行で停止したい**ときに使う。[Node.js](https://nodejs.org/) 以外の任意のデバッグセッションでは、これら両方の例外で独立に停止できる。」

> **Gotchas（原文）**: 現在、Node.js のデバッグセッションでは、**uncaught 例外でも停止する設定にしている場合のみ caught 例外で停止できる**。詳細は [Chromium bug #1382762](https://crbug.com/1382762)。

「**Sources** タブの **Breakpoints** ペインで、次のいずれかまたは両方のオプションを有効にしてコードを実行する:

- **Pause on uncaught exceptions** をチェックする。
- **Pause on caught exceptions** をチェックする。」

#### 3.7 Function breakpoints（関数ブレークポイント / `#function`）

原文逐語訳: 「**特定の関数が呼ばれるたびに停止したい**ときは、`debug(functionName)` を呼ぶ（`functionName` はデバッグしたい関数）。`debug()` は（`console.log()` 文のように）コードに挿入することも、**DevTools の Console から呼ぶ**こともできる。**`debug()` は関数の最初の行に行ブレークポイントを設定するのと等価である。**」

###### コード/コマンド（原文のまま逐語）

```js
function sum(a, b) {
  let result = a + b; // DevTools pauses on this line.
  return result;
}
debug(sum); // Pass the function object, not a string.
sum();
```

##### 3.7.1 Make sure the target function is in scope（対象関数がスコープ内にあることを確認 / `#scope`）

「デバッグしたい関数がスコープ内にない場合、DevTools は `ReferenceError` を投げる。」

###### コード/コマンド（原文のまま逐語）

```js
(function () {
  function hey() {
    console.log('hey');
  }
  function yo() {
    console.log('yo');
  }
  debug(yo); // This works.
  yo();
})();
debug(hey); // This doesn't work. hey() is out of scope.
```

「DevTools の Console から `debug()` を呼ぶ場合、対象関数がスコープ内にあることを保証するのは難しい。一つの戦略:

1. 関数がスコープ内にあるどこかに行ブレークポイントを設定する。
2. そのブレークポイントを発火させる。
3. **行ブレークポイントでコードが停止している間に** DevTools Console で `debug()` を呼ぶ。」

#### 3.8 Trusted Type breakpoints（Trusted Type ブレークポイント / `#trusted-type`） ★ DOM XSS 調査に直結

原文逐語訳: 「[Trusted Type API](https://developer.mozilla.org/docs/Web/API/Trusted_Types_API) は、[cross-site scripting](https://owasp.org/www-community/attacks/xss/)（XSS）攻撃として知られるセキュリティ脆弱性からの保護を提供する。」

> **Key term（原文の用語定義、逐語訳 — 教科書に必須）**: **DOM ベースの cross-site scripting は、ユーザが制御できる *source*（ユーザ名や、URL フラグメントから取った redirect URL など）のデータが、*sink*（`eval()` のような関数や `.innerHTML` のようなプロパティ setter で、任意の JavaScript コードを実行できるもの）に到達したときに発生する。**

「**Sources** タブの **Breakpoints** ペインで **CSP Violation Breakpoints** セクションへ行き、次のいずれかまたは両方を有効にしてコードを実行する:

- **Sink Violations** をチェックする。（この例では sink 違反で実行が停止する）
- **Policy Violations** をチェックする。（この例では policy 違反で実行が停止する。Trusted Type ポリシーは [`trustedTypes.createPolicy`](https://developer.mozilla.org/docs/Web/API/TrustedTypePolicyFactory/createPolicy) で設定する）」

API 利用のさらなる情報（原文のリンク）:

- セキュリティ目的をさらに進めるには [Prevent DOM-based cross-site scripting vulnerabilities with Trusted Types](https://web.dev/articles/trusted-types)。
- デバッグについては [Implementing CSP and Trusted Types debugging in Chrome DevTools](/blog/csp-issues/#debugging-trusted-types-problems)。

---

### 4. 対象 URL から直接リンクされている周辺機能（公式ページ）

#### 4.1 Sources panel overview（出典: https://developer.chrome.com/docs/devtools/sources）

Chrome DevTools の **Sources** パネルの用途（原文逐語訳）:

- ファイルを表示する。
- CSS と JavaScript を編集する。
- 任意のページで実行できる **Snippets** を作成・保存する。**Snippets は bookmarklet に似ている。**
- JavaScript をデバッグする。
- **Workspace** を設定して、DevTools での変更をファイルシステム上のコードに保存する。

**View files（`#files`）**: 「**Page** ペインでページが読み込んだすべてのリソースを表示する。**Page** ペインの構成:

- 最上位（例: `top`）は [HTML frame](https://www.w3.org/TR/html401/present/frames.html) を表す。`top` は訪問するあらゆるページに存在し、**メインドキュメントのフレーム**を表す。
- 第 2 レベル（例: `developers.google.com`）は [origin](https://html.spec.whatwg.org/multipage/origin.html#origin) を表す。
- 第 3、第 4 レベル以降は、その origin から読み込まれたディレクトリとリソースを表す。例: リソース `devsite-googler-button` の完全パスは `developers.google.com/_static/19aa27122b/css/devsite-googler-button`。」

「**Page** ペインでファイルをクリックすると **Editor** ペインに内容が表示される。**任意の種類のファイルを表示できる。画像はプレビューが表示される。**」

> **Note（原文）**: **Page** ペインは**読み込まれデプロイされたスタイルシートのみ**を列挙する。

**Edit CSS and JavaScript（`#edit`）**: 「**Editor** ペインで CSS と JavaScript を編集する。DevTools は新しいコードを実行するようページを更新する。**Editor** はデバッグも助ける。例えば、**構文エラーやその他の問題（失敗した CSS `@import` と `url()` 文、無効な URL を持つ HTML `href` 属性など）の隣に下線とインラインのエラーツールチップを表示する。**」

「要素の `background-color` を編集すると、変更は即座に反映される。**JavaScript の変更を反映するには <kbd>Command</kbd>+<kbd>S</kbd>（Mac）または <kbd>Control</kbd>+<kbd>S</kbd>（Windows, Linux）を押す。DevTools はスクリプトを再実行しないので、反映される JavaScript の変更は関数の内部で行ったものだけである。** 例えば、`console.log('A')` は実行されないが `console.log('B')` は実行される、という違いが生じる。」「変更後に DevTools がスクリプト全体を再実行していたなら、テキスト `A` が **Console** にログされていたはずである。」

「**DevTools はページをリロードすると CSS と JavaScript の変更を消去する。** ファイルシステムに変更を保存する方法は [Set up a Workspace](#workspace) を参照。」

**Create, save, and run Snippets（`#snippets`）** の例（原文のまま逐語 — jQuery をページに挿入する Console コード）:

```js
let script = document.createElement('script');
script.src = 'https://code.jquery.com/jquery-3.2.1.min.js';
script.crossOrigin = 'anonymous';
script.integrity = 'sha256-hwg4gsxgFZhOsEEamdOYGBf13FyQuiTwlAQgxVSNgt4=';
document.head.appendChild(script);
```

「代わりにこのコードを **Snippet** に保存し、必要なときにボタン数クリックで実行できる。**DevTools は Snippet をファイルシステムに保存する。**」

Snippet の実行方法:

- **Snippets** ペインでファイルを開き、下部のアクションバーの **Run** をクリックする。
- [**Command Menu**](/docs/devtools/command-menu/) を開き、`>` 文字を削除して `!` を入力し、Snippet の名前を入力して Enter を押す。

**Debug JavaScript（`#debug`）**: 「`console.log()` で JavaScript のどこが間違っているか推測するのではなく、Chrome DevTools のデバッグツールの使用を検討する。**一般的な考え方は、コード中の意図的な停止地点であるブレークポイントを設定し、それからコードの実行を 1 行ずつステップすることである。** ステップしながら、現在定義されているすべてのプロパティと変数の値を表示・変更し、**Console** で JavaScript を実行できる。」

**Focus only on your code（自分のコードだけに集中 / `#focus-on-your-code`）**

> **Note（原文）**: 以下の機能は **Chrome バージョン 106** から利用できる。

「Chrome DevTools は、Web アプリ構築時に活用するフレームワークやビルドツールが生む雑音をフィルタして、自分が書いたコードだけに集中できるようにする。現代的な Web デバッグ体験を提供するため、DevTools は次を行う:

- **著者コードとデプロイコードを分離する。** コードを素早く見つけられるよう、[**Sources** パネルはあなたが作るコードを bundle・minify されたコードから分離する](/docs/devtools/javascript/reference/#group-authored-and-deployed)。
- **既知のサードパーティコードを無視する:**
  - [**Sources** パネルはそうしたソースを **Page** ペインのファイルツリーから隠す](/docs/devtools/javascript/reference/#hide-ignore-listed)。
  - [**Console** はスタックトレースからそうしたフレームを隠す](/docs/devtools/console/reference/#show-third-party)。
  - [**Open File** メニューは検索結果からそうしたファイルを隠す](/docs/devtools/command-menu/#open-ignore-listed-files)。

さらに、フレームワークがサポートしていれば、[デバッガの **Call Stack**](/docs/devtools/javascript/reference/#async-frames) と [**Console** のスタックトレース](/docs/devtools/console/reference/#async-stack-traces) が非同期処理の完全な履歴を表示する。」

参照ブログ: [Modern web debugging in Chrome DevTools](/blog/devtools-modern-web-debugging/)、[Case Study: Better Angular Debugging with DevTools](/blog/devtools-better-angular-debugging/)。

**Set up a Workspace（`#workspace`）**: 「既定では **Sources** パネルでファイルを編集した変更はページをリロードすると失われる。**Workspaces** は DevTools での変更をファイルシステムに保存できるようにする。**要するに DevTools をコードエディタとして使えるようになる。**」

#### 4.2 Sources パネル／Code Editor のキーボードショートカット（出典: https://developer.chrome.com/docs/devtools/shortcuts）

原文の HTML 表を逐語再現（`## Sources panel keyboard shortcuts {: #sources }`）:

| Action | Mac | Windows / Linux |
| --- | --- | --- |
| Pause script execution (if currently running) or resume (if currently paused) | <kbd>F8</kbd> or <kbd>Command</kbd>+<kbd>\</kbd> | <kbd>F8</kbd> or <kbd>Control</kbd>+<kbd>\</kbd> |
| Step over next function call | <kbd>F10</kbd> or <kbd>Command</kbd>+<kbd>'</kbd> | <kbd>F10</kbd> or <kbd>Control</kbd>+<kbd>'</kbd> |
| Step into next function call | <kbd>F11</kbd> or <kbd>Command</kbd>+<kbd>;</kbd> | <kbd>F11</kbd> or <kbd>Control</kbd>+<kbd>;</kbd> |
| Step out of current function | <kbd>Shift</kbd>+<kbd>F11</kbd> or <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>;</kbd> | <kbd>Shift</kbd>+<kbd>F11</kbd> or <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>;</kbd> |
| Continue to a certain line of code while paused | Hold <kbd>Command</kbd> and then click the line of code | Hold <kbd>Control</kbd> and then click the line of code |
| Select the call frame below / above the currently-selected frame | <kbd>Control</kbd>+<kbd>.</kbd> / <kbd>Control</kbd>+<kbd>,</kbd> | <kbd>Control</kbd>+<kbd>.</kbd> / <kbd>Control</kbd>+<kbd>,</kbd> |
| Save changes to local modifications | <kbd>Command</kbd>+<kbd>S</kbd> | <kbd>Control</kbd>+<kbd>S</kbd> |
| Save all changes | <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>S</kbd> | <kbd>Control</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> |
| Go to line | <kbd>Control</kbd>+<kbd>G</kbd> | <kbd>Control</kbd>+<kbd>G</kbd> |
| Jump to a line number of the currently-open file | Press <kbd>Command</kbd>+<kbd>O</kbd> to open the **Command Menu**, type <kbd>:</kbd> followed by the line number, then press <kbd>Enter</kbd> | Press <kbd>Control</kbd>+<kbd>O</kbd> to open the **Command Menu**, type <kbd>:</kbd> followed the line number, then press <kbd>Enter</kbd> |
| Jump to a column of the currently-open file (for example line 5, column 9) | Press <kbd>Command</kbd>+<kbd>O</kbd> to open the **Command Menu**, type <kbd>:</kbd>, then the line number, then another <kbd>:</kbd>, then the column number, then press <kbd>Enter</kbd> | Press <kbd>Control</kbd>+<kbd>O</kbd> to open the **Command Menu**, type <kbd>:</kbd>, then the line number, then another <kbd>:</kbd>, then the column number, then press <kbd>Enter</kbd> |
| Go to a function declaration (if currently-open file is HTML or a script), or a rule set (if currently-open file is a stylesheet) | Press <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>, then type in the name of the declaration / rule set, or select it from the list of options | Press <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>, then type in the name of the declaration / rule set, or select it from the list of options |
| Close the active tab | <kbd>Option</kbd>+<kbd>W</kbd> | <kbd>Alt</kbd>+<kbd>W</kbd> |
| Open next or previous tab | <kbd>Function</kbd>+<kbd>Command</kbd>+<kbd>Up</kbd> or <kbd>Down</kbd> | <kbd>Control</kbd>+<kbd>Page Up</kbd> or <kbd>Page Down</kbd> |
| Toggle the **Navigation** sidebar on the left | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>Y</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>Y</kbd> |
| Toggle the **Debugger** sidebar on the right | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> |

`### Code Editor keyboard shortcuts {: #editor }`（逐語再現）:

| Action | Mac | Windows / Linux |
| --- | --- | --- |
| Delete all characters in the last word, up to the cursor | <kbd>Option</kbd>+<kbd>Delete</kbd> | <kbd>Control</kbd>+<kbd>Delete</kbd> |
| Add or remove a line-of-code breakpoint | Focus your cursor on the line and then press <kbd>Command</kbd>+<kbd>B</kbd> | Focus your cursor on the line and then press <kbd>Control</kbd>+<kbd>B</kbd> |
| Open the breakpoint edit dialog to edit conditional breakpoints or logpoints | Focus your cursor on the line and then press <kbd>Command</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> | Focus your cursor on the line and then press <kbd>Control</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> |
| Go to matching bracket | <kbd>Control</kbd>+<kbd>M</kbd> | <kbd>Control</kbd>+<kbd>M</kbd> |
| Toggle single-line comment. If multiple lines are selected, DevTools adds a comment to the start of each line | <kbd>Command</kbd>+<kbd>/</kbd> | <kbd>Control</kbd>+<kbd>/</kbd> |
| Select / de-select the next occurrence of whatever word the cursor is on. Each occurrence is highlighted simultaneously | <kbd>Command</kbd>+<kbd>D</kbd> / <kbd>Command</kbd>+<kbd>U</kbd> | <kbd>Control</kbd>+<kbd>D</kbd> / <kbd>Control</kbd>+<kbd>U</kbd> |

〔補足（一般知識）〕リファレンス本文中で明示されていたショートカットは `F9`（step、Restart frame チュートリアル中の表記）と `F8`（resume）である。上表では step over が `F10`、step into が `F11` と記載されている（`F9` は歴史的に step の別名として DevTools に残っている）。原文の記述をそのまま両方記録しておく。

#### 4.3 Snippets（出典: https://developer.chrome.com/docs/devtools/javascript/snippets）

原稿 `Run snippets of JavaScript`、`updated: 2022-10-20`、動画 ID `zW9ibQbYJNE`。説明: 「Snippets は Chrome DevTools の Sources パネル内で作成・実行できる小さなスクリプト。任意のページからアクセス・実行できる。**snippet を実行すると、現在開いているページのコンテキストで実行される。**」

「**Console** で同じコードを繰り返し実行しているなら、代わりに snippet として保存することを検討する。**Snippets はページの JavaScript コンテキストにアクセスできる。bookmarklet の代替である。**」「**Sources** パネルで作成し、任意のページおよび**シークレットモード**で実行できる。」

> **Aside（原文）**: **DevTools は snippet をローカルの preferences として保存する。DevTools は設定と一緒に snippet を [同期（sync）](/docs/devtools/customize/#sync) しないし、ファイルシステム経由でアクセスすることもできない。**

（注: §4.1 の Sources パネル概要ページには「DevTools saves the **Snippet** to your file system.」という記述もあり、両ページで表現が食い違う。原文をそのまま両方記録する。）

サンプル snippet（原文のまま逐語）:

```js
console.log('Hello, Snippets!');
document.body.innerHTML = '';
const p = document.createElement('p');
p.textContent = 'Hello, Snippets!';
document.body.appendChild(p);
```

「**Run** ボタンをクリックすると、**Console** ドロワーがポップアップして snippet がログした `Hello, Snippets!` メッセージを表示し、ページの内容が変わる。」

**Open the Snippets pane（`#open`）** — 2 通り:

- **Sources** > **More tabs** > **Snippets** に移動する。
- [**Command Menu**](/docs/devtools/command-menu/) から:
  1. <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Windows/Linux）または <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Mac）で **Command Menu** を開く。
  2. `Snippets` と入力し始め、**Show Snippets** を選び、<kbd>Enter</kbd> を押す。

**Create snippets（`#create`）**: 「**Snippets** ペインは snippet を**アルファベット順**に並べる。」

- **Sources パネルで作る（`#create-sources`）**: ① Snippets ペインを開く ② **New snippet** をクリック ③ 名前を入力し <kbd>Enter</kbd> で保存。
- **Command Menu から作る（`#create-command-menu`）**: ① DevTools 内のどこかにカーソルをフォーカス ② <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Windows/Linux）または <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Mac） ③ `Snippet` と入力し始め **Create new snippet** を選んで <kbd>Enter</kbd>。

**Edit snippets（`#edit`）**: ① Snippets ペインを開く ② 編集したい snippet の名前をクリック（**Sources** パネルが **Code Editor** で開く） ③ **Code Editor** でコードを編集する。**snippet 名の隣のアスタリスクは未保存の変更を意味する。** ④ <kbd>Control</kbd>+<kbd>S</kbd>（Windows/Linux）または <kbd>Command</kbd>+<kbd>S</kbd>（Mac）で保存。

**Run snippets（`#run`）**:

- **Sources パネルで実行（`#run-sources`）**: ① Snippets ペインを開く ② 実行したい snippet 名をクリック ③ エディタ下部のアクションバーの **Run** をクリック、または <kbd>Control</kbd>+<kbd>Enter</kbd>（Windows/Linux）／<kbd>Command</kbd>+<kbd>Enter</kbd>（Mac）を押す。
- **Command Menu から実行（`#run-command-menu`）**: ① DevTools 内にカーソルをフォーカス ② <kbd>Control</kbd>+<kbd>O</kbd>（Windows/Linux）または <kbd>Command</kbd>+<kbd>O</kbd>（Mac）で **Command Menu** を開く ③ **`!` 文字**に続けて実行したい snippet 名を入力 ④ <kbd>Enter</kbd> で実行。

**Rename snippets（`#rename`）**: Snippets ペインで snippet 名を右クリックし **Rename** を選ぶ。
**Delete snippets（`#delete`）**: Snippets ペインで snippet 名を右クリックし **Remove** を選ぶ。

#### 4.4 Local Overrides（出典: https://developer.chrome.com/docs/devtools/overrides）

原稿 `Override web content and HTTP response headers locally`、`date: 2023-04-12`、`updated: 2023-09-20`。

原文逐語訳: 「local overrides を使うと、[HTTP レスポンスヘッダ](#override-headers) と [web コンテンツ](#make-changes)（[XHR と fetch リクエスト](#override-xhr-fetch) を含む）を上書きし、**アクセス権がないリモートリソースでもモックできる**。これによりバックエンドの対応を待たずに変更をプロトタイプできる。**また local overrides は DevTools で行った変更をページ読み込みをまたいで保持する。**

仕組み:

- **DevTools で変更を加えると、DevTools は変更されたファイルのコピーを指定したフォルダに保存する。**
- **ページをリロードすると、DevTools はネットワークリソースではなくローカルの変更済みファイルを提供する。**」

> **Important（原文）**: 変更をソースファイルに直接保存することもできる。[Edit and save files with Workspaces](/docs/devtools/workspaces/) を参照。

**Limitations（`#limitations`）**: 「local overrides はネットワークレスポンスヘッダと、XHR/fetch リクエストを含むほとんどのファイル種別で機能するが、いくつか例外がある:

- **DevTools は [**Elements**](/docs/devtools/dom/) パネルの DOM ツリーで行った変更を保存しない。**
- **Styles ペインで CSS を編集し、その CSS のソースが HTML ファイルである場合、DevTools は変更を保存しない。**

代わりに [**Sources**](/docs/devtools/sources/) パネルで HTML ファイルを編集できる。」

**Set up local overrides（`#set-up`）**: 「**Network** パネルからすぐに web コンテンツやレスポンスヘッダを上書きできる:

1. [DevTools を開き](/docs/devtools/open)、**Network** パネルに移動し、上書きしたいリクエストを右クリックして、ドロップダウンメニューから **Override headers** または **Override content** を選ぶ。
2. local overrides をまだ設定していない場合、上部のアクションバーで DevTools が次を促す:
   1. オーバーライドファイルを保存する **Select a folder**（フォルダを選択）。
   2. **Allow** をクリックして DevTools にアクセス権を付与する。
3. local overrides が設定済みだが無効の場合、DevTools が自動的に有効化する。
4. local overrides が設定され有効になると、上書き対象に応じて DevTools は次へ移動する:
   - web コンテンツを変更する場合は **Sources** パネル。
   - レスポンスヘッダを変更する場合は **Network** > **Headers** > **Response Headers** のエディタ。」

「一時的に local overrides を無効化したり、すべてのオーバーライドファイルを削除するには、**Sources** > **Overrides** に移動して **Enable Local Overrides** チェックボックスをクリアするか、**Clear** をクリックする。」

「単一のオーバーライドファイルまたはフォルダ内の全オーバーライドを削除するには、**Sources** > **Overrides** でファイルまたはフォルダを右クリックし **Delete** を選び、ダイアログで **OK** をクリックする。**この操作は取り消せず、削除したオーバーライドは手動で再作成する必要がある。**」

「すべてのオーバーライドを素早く見るには、**Network** パネルでリクエストを右クリックして **Show all overrides** を選ぶ。DevTools が **Sources** > **Overrides** に移動する。」

**Override web content（`#make-changes`）**: ① local overrides を設定する ② DevTools でファイルを変更して保存する。

> **Note（原文）**: **[source-mapped](/docs/devtools/javascript/source-maps/) されたファイルは上書きできない。** **Network** パネルでリクエストを右クリックして **Override content** を選ぶと、DevTools は元のソースファイルへ案内するダイアログを表示する。

「DevTools は変更ファイルを保存し、**Sources** > **Overrides** に一覧し、関連するパネル・ペイン（**Elements** > **Styles**、**Network**、**Sources** > **Overrides**）で上書きされたファイルの隣に保存アイコンを表示する。」

**Override XHR or fetch requests to mock remote resources（`#override-xhr-fetch`）**:

1. local overrides を設定する。
2. **Network** で [**XHR/fetch** リクエストをフィルタし](/docs/devtools/network/reference/#filter-by-type)、必要なものを見つけて右クリックし **Override content** を選ぶ。
3. 取得データに変更を加えてファイルを保存する。
4. **Refresh** してページをリロードし、変更が適用されたことを確認する。

**Track your local changes（`#track-changes`）**: 「web コンテンツに加えたすべての変更を一箇所で追跡できる — [**Changes**](/docs/devtools/changes/) ドロワータブ。」

**Override HTTP response headers（`#override-headers`）**: 「**Network** パネルから、**Web サーバへのアクセス権なしに** HTTP レスポンスヘッダを上書きできる。レスポンスヘッダのオーバーライドにより、次を含む（がこれに限らない）各種ヘッダの修正をローカルでプロトタイプできる:

- [Cross-Origin Resource Sharing (CORS) Headers](https://developer.mozilla.org/docs/Web/HTTP/CORS)
- [Permissions-Policy Headers](https://developer.mozilla.org/docs/Web/HTTP/Headers/Permissions-Policy)
- [Cross-Origin Isolation Headers](https://web.dev/articles/coop-coep)」

手順:

1. local overrides を設定し、例として [このデモページ](https://cors-demo-devtools.glitch.me/) を調査する。
2. **Network** でリクエストを見つけ、右クリックして **Override headers** を選ぶ。DevTools は **Headers** > **Response Headers** エディタに移動する。
3. レスポンスヘッダの値にホバーしてカーソルを置く。あるいはホバーして編集アイコンをクリックする。
4. ヘッダを修正または新規追加する。

   > **Aside（原文）**: この例では [CORS エラー](https://web.dev/articles/cross-origin-resource-sharing) を解消するために `Access-Control-Allow-Origin: *` ヘッダを追加している。

   - ヘッダ値を編集するにはそれをクリックする。
   - 新しいヘッダを追加するには **Add header** をクリックする。
   - ヘッダのオーバーライドを削除するにはその隣の削除アイコンをクリックする。**これは追加したヘッダを削除するか、修正した値を元の値に戻す。**

   「DevTools は修正したヘッダを**緑**でハイライトし、削除したオーバーライドを**赤の取り消し線**で示す。」
5. ページを **Refresh** して変更を適用する。

##### コード/コマンド（原文のまま逐語 — 追加するヘッダ）

```
Access-Control-Allow-Origin: *
```

**Edit all response header overrides（`#edit-response-header-overrides`）**:

1. **Response Headers** セクションの隣の **Header overrides** をクリックする。DevTools は **Sources** > **Overrides** の対応する **`.headers` ファイル**に移動する。
2. `.headers` ファイルを編集する:
   - 新しいオーバーライドルールを追加するには **Add override rule** をクリックする。**ここでのルールは、ヘッダと値の集合と、それを適用する単一または複数のリクエストである。**

     > **Aside（原文）**: [wildcards](https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#type-RequestPattern) を使って複数のリクエストを一度に指定できる。**複数文字は `*`、単一文字は `?` で指定する。**

   - ルールにヘッダ・値のペアを追加するには、別のペアにホバーして追加アイコンをクリックする。
   - ヘッダ値を戻す、追加したヘッダやルールを削除するには、ホバーして削除アイコンをクリックする。
3. `.headers` ファイルを <kbd>Command</kbd> / <kbd>Control</kbd> + <kbd>S</kbd> で保存する。
4. ページを **Refresh** して変更を適用する。

#### 4.5 Source maps（出典: https://developer.chrome.com/docs/devtools/javascript/source-maps）

原稿 `Debug your original code instead of deployed with source maps`、`updated: 2023-03-29`、動画 ID `SkUcO4ML5U0`。

「結合・minify・コンパイル後もクライアントサイドコードを読みやすくデバッグ可能に保つ。[source maps](https://web.dev/articles/source-maps) を使って **Sources** パネルでソースコードをコンパイル済みコードにマップする。」

**Get started with preprocessors（`#get_started_with_preprocessors`）**: 「プリプロセッサからの source maps は、DevTools に minify 版に加えて**元のファイル**を読み込ませる。**Chrome は実際には minify されたコードを実行するが、Sources パネルはあなたが書いたコードを見せる。** ソースファイルにブレークポイントを設定してステップでき、**すべてのエラー・ログ・ブレークポイントが自動的にマップされる。** これは開発サーバが配信しブラウザが実行するコードではなく、自分が書いたコードをデバッグしているかのような外観を与える。」

「**Sources** パネルで source maps を使うには:

- **source maps を生成できるプリプロセッサのみを使う。**
- **Web サーバが source maps を配信できることを確認する。**」

**Use a supported preprocessor（`#use_a_supported_preprocessor`）** — source maps と組み合わせて使われる一般的なプリプロセッサ（原文逐語、これに限らない）:

| 分類 | ツール（原文表記） |
| --- | --- |
| Transpilers | [Babel](https://babeljs.io/) |
| Compilers | [TypeScript](http://www.typescriptlang.org/), [Dart](https://www.dartlang.org) |
| Minifiers | [terser](https://github.com/terser/terser) |
| Bundlers and development servers | [Webpack](https://webpack.js.org/), [Vite](https://vitejs.dev/), [esbuild](https://esbuild.github.io/), [Parcel](https://parceljs.org/) |

拡張リスト: [Source maps: Languages, tools, and other info](https://github.com/ryanseddon/source-map/wiki/Source-maps:-languages,-tools-and-other-info)。

**Enable source maps in Settings（`#enable_source_maps_in_settings`）**: 「[**Settings** > **Preferences** > **Sources**](/docs/devtools/settings/preferences/#sources) で **Enable JavaScript source maps** をチェックすること。」（**Enable CSS source maps** もチェックしてよい）

**Check if source maps load successfully（`#developer-resources`）**: [Developer Resources: View and load source maps manually](/docs/devtools/developer-resources) を参照（§4.8）。

**Debugging with source maps（`#debugging_with_source_maps`）** — デモ https://github.com/jecfish/parcel-demo を使う:

1. [Web サイトのソースを開く](/docs/devtools/javascript/#sources-ui)（**Sources** パネル）。
2. 自分が書いたコードだけに集中するため、[ファイルツリーで authored と deployed をグループ化する](/docs/devtools/javascript/reference/#group-authored-and-deployed)。**Authored** セクションを展開し、元のソースファイルを **Editor** で開く。
3. [ブレークポイント](/docs/devtools/javascript/breakpoints/)（例えば [logpoint](/docs/devtools/javascript/breakpoints/#log-loc)）を通常どおり設定してコードを実行する。
4. **Editor** が下部のステータスバーに **deployed ファイルへのリンク**を置くことに注目。deployed CSS ファイルについても同様。
5. [**Console** ドロワーを開く](/docs/devtools/console/reference/#drawer)。この例では logpoint のメッセージの隣に、**deployed ではなく元のファイルへのリンク**が表示される。
6. [ブレークポイント種類](/docs/devtools/javascript/breakpoints/#overview) を [通常のもの](/docs/devtools/javascript/breakpoints/#loc) に変更してコードを再実行する。今度は実行が停止する。**Call Stack** ペインが deployed ではなく**元のファイル名**を表示することに注目。
7. **Editor** 下部のステータスバーで deployed ファイルへのリンクをクリックする。**Sources** パネルが対応するファイルに移動する。

「任意の deployed ファイルを開いたとき、DevTools は **`//# sourceMappingURL`** コメントと関連する元ファイルを見つけたかどうかを通知する。**Editor** が deployed ファイルを自動的に pretty-print したことに注目。**実際には `//# sourceMappingURL` コメントを除いて全コードが 1 行に入っている。**」

**Name `eval()` calls with `#sourceURL`（`#sourceurl_and_displayname`）**: 「[`#sourceURL`](/blog/sourcemappingurl-and-sourceurl-syntax-changed/#sourceurl) は `eval()` 呼び出しを扱うときのデバッグを簡単にする。このヘルパーは [`//# sourceMappingURL` プロパティ](/blog/sourcemaps/#how-does-the-source-map-work) と非常に似ている。詳細は [Source Map V3 specification](https://sourcemaps.info/spec.html)。

**`//# sourceURL=/path/to/source.file` コメントは、`eval()` を使うときにブラウザにソースファイルを探すよう指示する。これにより evaluation やインラインスクリプト・スタイルに名前を付けられる。**」

デモ http://www.thecssninja.com/demo/source_mapping/compile.html での手順:

1. [DevTools を開き](/docs/devtools/open) **Sources** パネルに行く。
2. ページの *Name your code:* 入力欄に任意のファイル名を入力する。
3. **Compile** ボタンをクリックする。CoffeeScript ソースから評価された合計を示すアラートが出る。
4. **Page** ペインのファイルツリーで、入力したカスタムファイル名の新しいファイルを開く。**そこには元のソースファイル名を持つ `// #sourceURL` コメント付きのコンパイル済み JavaScript コードが入っている。**
5. ソースファイルを開くには **Editor** のステータスバーのリンクをクリックする。

##### コード/コマンド（原文のまま逐語）

```
//# sourceURL=/path/to/source.file
```

```
//# sourceMappingURL
```

〔補足（一般知識）〕`//# sourceURL` は動的に評価されたスクリプト（`eval`、`new Function`、インジェクトされたインラインスクリプト）に名前を与える仕組みであり、DOM XSS 解析時に「どの eval 由来のコードか」を追跡する手掛かりになる。

#### 4.6 Ignore List（旧 blackbox）設定（出典: https://developer.chrome.com/docs/devtools/settings/ignore-list）

「**Settings** > **Ignore List** は、[デバッガ](/docs/devtools/javascript/) が無視するスクリプトの一覧を設定できる。」

デバッガのすべての ignore listing を有効／無効にする:

1. [Settings を開く](/docs/devtools/settings/#open)。
2. **Ignore List** タブで **Enable Ignore Listing** をチェックまたはクリアする。**これはすべての ignore-listing 機能のメインスイッチである。**

**Ignore Chrome Extensions scripts（`#skip-extensions`）**: 「Chrome DevTools の **Sources** パネルで [コードをステップ](/docs/devtools/javascript#code-stepping) しているとき、見覚えのないコードで停止することがある。おそらくインストールしている Chrome 拡張のコードで停止している。**Settings** > **Ignore List** で 2 つのチェックボックスを有効にする:

- **Enable Ignore Listing**
  - **Add content scripts to ignore list**」

**Ignore known third-party scripts（`#skip-third-party`）**: 「デバッガに既知のサードパーティスクリプトをスキップさせるには、**Settings** > **Ignore List** > **Automatically add known third-party scripts to ignore list** をチェックする。**DevTools は source maps の [ignoreList](/articles/x-google-ignore-list/) プロパティに基づいてサードパーティスクリプトを ignore list に追加する。フレームワークやバンドラがこの情報を供給する必要がある。** 例えば Angular や Nuxt のようなフレームワークはこの機能をサポートする。」

**Ignore a custom list of scripts（`#custom-ignore-pattern`）**:

1. **Settings** > **Ignore List** > **Enable Ignore Listing** をチェックする。
2. **Custom exclusion rules** セクションで **Add pattern** をクリックする。
3. **無視するスクリプト名または スクリプト名の RegEx パターン**を指定する。
4. **Add** をクリックして変更を保存する。

**Manage a custom list of ignored scripts（`#manage-custom-ignore-list`）**: 「特定のスクリプトまたはスクリプト名パターンの無視を有効／無効にするには、**Settings** > **Ignore List** > **Custom exclusion rules** でスクリプトまたはパターンの隣のチェックボックスをチェック／クリアする。編集または削除するには、ホバーで現れる編集または削除ボタンをクリックする。」

#### 4.7 Disable JavaScript（出典: https://developer.chrome.com/docs/devtools/javascript/disable）

「JavaScript が無効なとき Web ページがどう見え、どう振る舞うかを見るには:

1. [Chrome DevTools を開く](/docs/devtools/open)。
2. OS に応じて次のいずれかを押す:
   - Windows または Linux では <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>
   - MacOS では <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>

   **Command Menu** が開く。
3. `javascript` と入力し始め、**Disable JavaScript** を選び、Enter を押してコマンドを実行する。JavaScript が無効になる。」

「無効であることを示すため、Chrome はアドレスバーに対応するアイコンを表示し、DevTools は **Sources** の隣に警告アイコンを表示する。」

「**JavaScript は、DevTools を開いている限りこのタブで無効のまま維持される。**」「ページをリロードして、ページが読み込み時に JavaScript に依存するかどうか・どう依存するかを確認したいかもしれない。」「あるいは [Settings](/docs/devtools/settings/#debugger) で JavaScript を無効化できる。」

再有効化: 「Command Menu をもう一度開いて **Enable JavaScript** コマンドを実行する」または「DevTools を閉じる」。

#### 4.8 Developer Resources — source map の読み込み確認・手動ロード（出典: https://developer.chrome.com/docs/devtools/developer-resources）

「**Developer Resources** タブを使って、DevTools が source maps の読み込みに成功したかを確認する。必要なら手動で読み込める。」

「DevTools を開くと、source maps があれば読み込みを試みる。失敗した場合、**Console** は同様のエラーをログする。」

**Open Developer Resources and check status（`#open-developer-resources`）**:

1. [DevTools を開き](/docs/devtools/open/)、[source maps を有効化し](/docs/devtools/javascript/source-maps/#enable_source_maps_in_settings)、三点メニュー > **More tools** > **Developer Resources** に移動する。
2. テーブルで次の列の値を確認する:
   - **Status** — source map の読み込みが成功か失敗か。
   - **Error** — エラーメッセージ（あれば）。

**Filter resources by URL or Error（`#filter-resources`）**: 「上部のテキストボックスにテキストを入力して、URL やエラーメッセージにそのテキストを含まない source maps を絞り込む。」

**Troubleshoot（`#troubleshoot`）**: 「既定では **DevTools がサイトではなく source maps を要求する。そうしたリクエストは [cross-origin](https://developer.mozilla.org/docs/Web/HTTP/CORS) として扱われ、通らない場合がある。** Web サイト側に source maps を先に要求させるには、**Developer Resources** 右上の **Enable loading through target** をチェックする。」

**Load a source map manually（`#load`）**: 「読み込み失敗に遭遇した場合、または例えば **source maps を持たない本番サイトで元コードをデバッグしたい**場合、手動で読み込める:

1. [source maps をサポートするツールで source maps を生成する](/docs/devtools/javascript/source-maps/#use_a_supported_preprocessor)。
2. source maps をローカルにホストする。
3. 対象ページで [DevTools を開き](/docs/devtools/open/)、[source maps を有効化する](/docs/devtools/javascript/source-maps/#enable_source_maps_in_settings)。
4. **Sources** で deployed（処理済み）ファイルを開き、**Editor** で右クリックしてメニューから **Add source map** を選ぶ。
5. テキストボックスに source map の URL を指定し **Add** をクリックする。
6. **Developer Resources** に source map が現れ、（deployed からマップされた）元ファイルがファイルツリーに現れたか確認する。
7. [元ファイルのデバッグ](/docs/devtools/javascript/source-maps/#debugging_with_source_maps) に進む。」

#### 4.9 Sources / Debugger 設定（出典: https://developer.chrome.com/docs/devtools/settings/preferences）

`## Sources` セクションの設定項目（原文の説明文を逐語訳。表形式で整理）:

| 設定（原文名） | 内容 | 備考 |
| --- | --- | --- |
| **Search in anonymous and content scripts** | **Search** タブを使って、Chrome 拡張内のものを含む、読み込まれたすべての JavaScript ファイルを検索できるようにする | 〔補足（一般知識）〕拡張や匿名スクリプトに埋もれた sink 検索に有用 |
| **Automatically reveal files in sidebar** | **Editor** のタブを切り替えたときに **Sources** > **Page** ペインでファイルを選択する | — |
| **Enable JavaScript source maps** | 生成済み／minify 済み JavaScript ファイルのソースを DevTools が見つけられるようにする | source maps が利用可能な場合のみ機能する。**Sources** パネルはステータスバーに生成／minify ファイルへのリンクも置く |
| **Enable tab moves focus** | <kbd>Tab</kbd> キーが **Editor** に Tab 文字を挿入する代わりに DevTools 内でフォーカスを移動する | DevTools のリロードが必要。**Default indentation** が無効になる |
| **Detect indentation** | **Editor** で開いたソースファイルのインデントに合わせる | DevTools のリロードが必要。**Default indentation** を上書きする |
| **Show whitespace characters** | **Editor** に空白文字を表示する。選択肢: **None** / **All**（`...`、Tab は `—`）/ **Trailing**（行末の空白を薄い赤でハイライト） | DevTools のリロードが必要 |
| **Autocompletion** | **Editor** で補完候補を有効にする | — |
| **Bracket matching** | 対応のない角括弧・波括弧・丸括弧を **Editor** で下線＋薄い赤でハイライトする | — |
| **Code folding** | **Editor** で波括弧内のコードブロックを折りたたみ／展開できるようにする | DevTools のリロードが必要 |
| **Display variable values inline while debugging** | 実行が停止している間、代入文の隣に変数値を表示する | inline evaluation（`#inline-eval`）に対応する設定 |
| **Focus Sources panel when triggering a breakpoint** | 実行を停止させたブレークポイントの行で **Sources** > **Editor** を開く | — |
| **Enable CSS source maps** | 生成済み CSS（例: `.scss`）のソースを DevTools が見つけて表示できるようにする | **Sources** パネルはナビゲーションツリーの **Authored** セクションに `.scss` を表示。**Elements** > **Styles** に CSS ルールの隣にソースへのリンクが出る |
| **Allow scrolling past end of file** | **Editor** で最終行より先までスクロールできるようにする | — |
| **Allow DevTools to load resources, such as source maps, from remote file paths** | **既定で無効（セキュリティ上の理由）** | 原文 Caution: 「[Remote file paths are a security vulnerability](https://bugs.chromium.org/p/chromium/issues/detail?id=1342722)。結果を理解している場合のみこのオプションを使うのが最善」。無効のままだと DevTools は **Console** に同種のメッセージをログする |
| **Default indentation** | <kbd>Tab</kbd> キーが **Editor** に挿入する空白数を選ぶ。選択肢: **2 spaces** / **4 spaces** / **8 spaces** / **Tab character** | **Detect indentation** がこの設定を上書きする（DevTools のリロードが必要）。**Enable tab moves focus** も上書きする |

`## Debugger` セクション（`#debugger`）:

| 設定（原文名） | 内容 |
| --- | --- |
| **Disable JavaScript** | [JavaScript が無効](/docs/devtools/javascript/disable/) のときの Web ページの見え方・振る舞いを確認できる。ページをリロードして読み込み時の JS 依存を確認する。無効時は Chrome がアドレスバーに対応アイコンを、DevTools が **Sources** の隣に警告アイコンを表示する |
| **Disable async stack traces** | **Call Stack** における非同期処理の「全体像（full story）」を隠す。既定では、使用フレームワークが対応していればデバッガは非同期処理を追跡しようとする。詳細は [View async stack traces](/docs/devtools/console/reference/#async-stack-traces) |

#### 4.10 Console Utilities API — デバッガ連携コマンド（出典: https://developer.chrome.com/docs/devtools/console/utilities）

Sources パネルのデバッガと直接連携する Console のユーティリティ関数（原文逐語＋コード）。

**`debug(function)`（`#debug-function`）**: 「指定した関数が呼ばれたとき、デバッガが起動し **Sources** パネルでその関数内部で break するので、ステップ実行してデバッグできる。」

```js
debug(getData);
```

「関数での break を止めるには `undebug(fn)` を使うか、UI ですべてのブレークポイントを無効化する。」

**`undebug(function)`（`#undebug-function`）**: 「指定した関数のデバッグを止め、その関数が呼ばれてもデバッガが起動しないようにする。`debug(fn)` と対で使う。」

```js
undebug(getData);
```

**`monitor(function)`（`#monitor-function`）**: 「指定した関数が呼ばれたとき、関数名と、呼び出し時に渡された引数を示すメッセージが Console にログされる。」

```js
function sum(x, y) {
  return x + y;
}
monitor(sum);
```

停止するには `unmonitor(function)`。

**`unmonitor(function)`（`#unmonitor-function`）**:

```js
unmonitor(getData);
```

**`monitorEvents(object [, events])`（`#monitorEvents-function`）**: 「指定したオブジェクトで指定したイベントのいずれかが発生したとき、Event オブジェクトが Console にログされる。**単一のイベント、イベントの配列、または事前定義されたイベント集合にマップされた汎用イベント "types" のいずれかを指定できる。**」

window オブジェクトのすべての resize イベントを監視:

```js
monitorEvents(window, "resize");
```

window オブジェクトの "resize" と "scroll" の両方を監視する配列:

```js
monitorEvents(window, ["resize", "scroll"])
```

利用可能なイベント "types" と対応するイベントのマッピング（原文の HTML 表を逐語再現）:

| Event type | Corresponding mapped events |
| --- | --- |
| mouse | "mousedown", "mouseup", "click", "dblclick", "mousemove", "mouseover", "mouseout", "mousewheel" |
| key | "keydown", "keyup", "keypress", "textInput" |
| touch | "touchstart", "touchmove", "touchend", "touchcancel" |
| control | "resize", "scroll", "zoom", "focus", "blur", "select", "change", "submit", "reset" |

「例えば次は、**Elements** パネルで現在選択されている入力テキストフィールドに対し、"key" イベントタイプで対応するすべてのキーイベントを使う。」

```js
monitorEvents($0, "key");
```

停止するには `unmonitorEvents(object[, events])`。

**`unmonitorEvents(object [, events])`（`#unmonitorEvents-function`）**: 「指定したオブジェクトとイベントのイベント監視を止める。例えば次は window オブジェクトのすべてのイベント監視を止める。」

```js
unmonitorEvents(window);
```

**`getEventListeners(object)`（`#getEventListeners-function`）**: 「指定したオブジェクトに登録されているイベントリスナを返す。**戻り値は、登録された各イベント種別（例えば `click` や `keydown`）ごとに配列を含むオブジェクトである。各配列のメンバーは、その種別に登録されたリスナを記述するオブジェクトである。** 例えば次は document オブジェクトに登録されたすべてのイベントリスナを列挙する。」

```js
getEventListeners(document);
```

「指定オブジェクトに複数のリスナが登録されている場合、配列にはリスナごとのメンバーが含まれる。」「これらのオブジェクトをさらに展開してプロパティを探索できる。」

**`queryObjects(Constructor)`（`#queryObjects-function`）**: 「Console から `queryObjects(Constructor)` を呼ぶと、指定したコンストラクタで作られたオブジェクトの配列を返す。例:

- `queryObjects(Promise)`。`Promise` のすべてのインスタンスを返す。
- `queryObjects(HTMLElement)`。すべての HTML 要素を返す。
- `queryObjects(foo)`（`foo` はクラス名）。`new foo()` でインスタンス化されたすべてのオブジェクトを返す。

**`queryObjects()` のスコープは、Console で現在選択されている実行コンテキストである。**」

**`inspect(object/function)`（`#inspect-function`）**: 「指定した要素またはオブジェクトを適切なパネルで開いて選択する。DOM 要素なら **Elements** パネル、JavaScript ヒープオブジェクトなら Profiles パネル。」

```js
inspect(document.body);
```

「**関数を inspect に渡すと、その関数は Sources パネルでドキュメントを開いて検査できるようにする。**」

**その他（デバッグ時に併用する主要ユーティリティ）**:

- `$_`（`#recent`）— 「最後に評価された式の値を返す。」
- `$0` - `$4`（`#recent-many`）— Elements で検査した直近 5 要素への参照。
- `$(selector [, startNode])`（`#querySelector-function`）— 「指定 CSS セレクタに一致する最初の DOM 要素への参照を返す。」
- `$$(selector [, startNode])`（`#querySelectorAll-function`）— 「指定 CSS セレクタに一致する要素の配列を返す。」
- `$x(path [, startNode])`（`#xpath-function`）— 「指定 XPath 式に一致する DOM 要素の配列を返す。」
- `copy(object)`（`#copy-function`）— 「指定オブジェクトの文字列表現をクリップボードにコピーする。」

  ```js
  copy($0);
  ```

- `clear()`（`#clear-function`）— Console の履歴をクリアする。
- `dir(object)` / `dirxml(object)` — `console.dir()` / `console.dirxml()` のショートカット。
- `keys(object)` / `values(object)`（`#keys-function`）— 指定オブジェクトのプロパティ名／値の配列を返す。

  ```js
  let player = {
      "name": "Parzival",
      "number": 1,
      "state": "ready",
      "easterEggs": 3
  };
  ```

- `table(data [, columns])`（`#table-function`）— `console.table()` のショートカット。

  ```js
  let names = [
    { firstName: "John", lastName: "Smith" },
    { firstName: "Jane", lastName: "Doe" },
  ];
  table(names);
  ```

- `profile([name])` / `profileEnd([name])`（`#profile-function`）— JS CPU プロファイリングを開始／終了し、結果を **Performance** > **Main** トラックに表示する。`console.profile()` / `console.profileEnd()` のショートカット。プロファイルはネストでき、作成順に閉じる必要はない。

  ```js
  profile("Profile 1")
  ```

  ```js
  profileEnd("Profile 1")
  ```

  ```js
  profile('A');
  profile('B');
  profileEnd('A');
  profileEnd('B');
  ```

---

## 5. クライアントサイド脆弱性ハンティングへの応用（〔補足（一般知識）〕を含む）

以下は原典の機能記述を、許可された診断・バグバウンティ前提の作業手順へ翻訳したもの。**機能名・挙動は原典通り**であり、応用の観点には〔補足（一般知識）〕を付す。

### 5.1 sink に到達するデータフローを追う（原典に基づく）

原典（breakpoints ページ Trusted Type 節）の定義がそのまま方法論になる:「**source（ユーザ制御可能な入力: ユーザ名、URL フラグメント由来の redirect URL など）**のデータが **sink（`eval()` のような関数、`.innerHTML` のようなプロパティ setter で任意 JS を実行できるもの）** に到達したときに DOM XSS が発生する」。

〔補足（一般知識）〕原典の機能を組み合わせた具体的な追跡手順:

1. **CSP Violation Breakpoints > Sink Violations** を有効化すると、Trusted Types を導入したページでは sink への到達点で実行が止まるため、source → sink の到達経路をコールスタックで一気に特定できる。
2. Trusted Types 未導入のページでは、**Event Listener Breakpoints**（`click`、`hashchange`、`message` など）と **DOM change breakpoints（Subtree modifications）** を併用する。`.innerHTML` による書き込みは DOM 変更ブレークポイントで停止し、**Call Stack** が書き込み元のコードを示す。
3. `debug(fn)` を Console から呼び、疑わしいテンプレート展開関数・sanitize 関数の入口で必ず止める（原典どおり、対象関数がスコープ内にある状態で呼ぶ）。
4. `getEventListeners(window)` / `getEventListeners(document)` で `message` / `hashchange` リスナを列挙し、postMessage 経由の source を洗い出す。`monitorEvents(window, "message")` で実際に飛んでくるイベントをログする。

### 5.2 通信境界で止める

- **XHR/fetch breakpoint**: 原典どおり「要求 URL が指定文字列を含むとき `send()` の行で停止」。〔補足（一般知識）〕API パス片（例: `/api/`、`token=`）を指定すれば、トークンを組み立てている箇所やリクエスト署名ロジックの直前で止められる。
- **Local Overrides のレスポンスヘッダ上書き**: 原典どおり `Access-Control-Allow-Origin: *` などを追加できる。〔補足（一般知識）〕CORS・`Permissions-Policy`・COOP/COEP といったヘッダ有無が脆弱性の成立条件になる場合、サーバを触らずに「もしこのヘッダが無かったら／緩かったら何が起きるか」をローカルで安全に検証できる。`.headers` ファイルと wildcard（`*` = 複数文字、`?` = 単一文字）でルール適用範囲を指定する。
- **Local Overrides の XHR/fetch コンテンツ上書き**: 原典どおりレスポンス本体をモックできる。〔補足（一般知識）〕サーバ応答を改変したときのクライアント側の扱い（型混同、`innerHTML` への流し込み、プロトタイプ汚染の起点）を確認できる。

### 5.3 minify・バンドルされたコードを読む

- **source maps**（`Enable JavaScript source maps`、Authored/Deployed グルーピング、`Add source map` による手動ロード、Developer Resources の Status/Error 列）で bundle から著者コードへ復元する。
- source maps が無い場合でも **Editor 左下の `{ }`（pretty print）** と **カンマ区切り式のステップ実行（Chrome 108+）** により、minify コードを行単位で追える。
- `//# sourceURL=/path/to/source.file` により `eval()` 生成コードに名前が付くため、動的生成コードの出自を追える。

### 5.4 ノイズの除去とアンチデバッグ対策

- **Ignore List**（`Enable Ignore Listing` / `Add content scripts to ignore list` / `Automatically add known third-party scripts to ignore list` / `Custom exclusion rules` の RegEx パターン）で拡張・サードパーティのフレームを除外し、**Show ignore-listed frames** で必要なときだけ全スタックを見る。
- **Force script execution**（Resume を長押しして選択）で全ブレークポイントを無視して再開する。〔補足（一般知識）〕`debugger` 文を無限ループで撒くアンチデバッグに対しては、この機能と **Deactivate breakpoints**、および該当スクリプトの ignore list 追加が実務的な対処になる。
- **Deactivate breakpoints**（チュートリアル Step 7）で全ブレークポイントを一括無視する。
- **Conditional breakpoint / logpoint** でループ内の大量停止を避け、**実行を止めずに**値の履歴だけを取る。

### 5.5 再現性・記録

- **Copy stack trace**（出力形式は `関数名 (ファイル:行)` の行連結）で PoC レポートに貼る呼び出し経路を取得する。
- **Snippets** に診断コード（リスナ列挙、prototype 汚染検査、sink の網掛けなど）を保存し、任意ページ・シークレットモードで再利用する。〔補足（一般知識）〕原典は Snippets を bookmarklet の代替と位置付けており、レポート再現手順の共有には向かない（同期されない／ファイルシステム経由でアクセスできないと明記）ので、コードは別途テキストで残すのが安全。
- **Changes ドロワータブ**で DevTools 上の変更差分を一箇所で確認する。
- **Disable JavaScript**（Command Menu の `Disable JavaScript`）で「JS 非依存で何が露出するか」を確認する。

---

## 読者が自分で開くべき資料

この環境では `developer.chrome.com` が egress ポリシーで遮断されていたため、**公式ドキュメントのライブ HTML は取得できず、同じ内容を生成する公式リポジトリの原稿 Markdown を取得**した。以下は読者が自分のブラウザで原典を開いたときの読みどころ。

### (A) https://developer.chrome.com/docs/devtools/javascript （取得は成功。ただしライブ版で追加確認すべき点）

1. **各操作アイコンの実物**: 本ノートでは画像を省略している。Step into / Step over / Resume / Deactivate breakpoints の**アイコン形状**はライブページのスクリーンショットで確認するのが最短。
2. **動画版（YouTube ID `H0XScE08hy8`）**: 7 ステップの実演。UI 位置関係の把握に有効。
3. **デモページ** https://googlechrome.github.io/devtools-samples/debug-js/get-started を実際に開いて `5 + 1 = 51` を再現し、`get-started.js` の 29〜32 行目を自分の Chrome で確認する（行番号は原典の記述に依存するため、実物で確認すること）。
4. **ページ下部の「Next steps」からのリンク先**（breakpoints、reference#stepping）が本ノート §2・§3 の内容に対応する。

### (B) https://developer.chrome.com/docs/devtools/javascript/reference （取得は成功。差分確認が必要な点）

1. **「Debug JavaScript with VS Code」に相当する節の有無**: 担当指示に挙がっていたが、取得できた公式原稿スナップショット（`updated: 2022-11-29`）には**存在しない**。ライブ版に後から追加された可能性があるため、読者はライブページの目次でこの項目を探し、あればそこを直接読むこと（本ノートでは捏造を避けて内容を記載していない）。
2. **Chrome バージョン依存の機能表記**: 本ノートに記録した「Chrome 104（Authored/Deployed グルーピング、実験的）」「Chrome 105（paused 関数のライブ編集）」「Chrome 106（ignore-listed sources を隠す、実験的）」「Chrome 108（カンマ区切り式のステップ）」は原稿時点の記述。実験的フラグが正式機能に昇格している可能性があるので、ライブ版の Note/Aside を確認すること。
3. **Force script execution の現行 UI 名**: 原稿では Resume の長押しメニュー内の **Force script execution**。ライブ版で表記が変わっていないか確認する（担当指示の「resume with all pauses blocked」は DevTools 内部のツールチップ表現に近い）。
4. **Breakpoints ペインの現行レイアウト**: `CSP Violation Breakpoints`（Sink Violations / Policy Violations）、`XHR/fetch Breakpoints`、`Event Listener Breakpoints`、`DOM Breakpoints`、`Global Listeners` などのセクション並びは版により変わるため、実物で確認する。

### (C) その他、原典側で必ず自分で確認すべきページ

1. https://developer.chrome.com/docs/devtools/javascript/breakpoints — **ブレークポイント 9 種の一覧表**と Trusted Type / CSP Violation Breakpoints の節。DOM XSS 調査の起点。
2. https://developer.chrome.com/docs/devtools/settings/ignore-list — `Enable Ignore Listing` を含む 4 種のスイッチと `Custom exclusion rules`（RegEx）。
3. https://developer.chrome.com/docs/devtools/overrides — `.headers` ファイルの書式と wildcard（`*` / `?`）の実例スクリーンショット。
4. https://developer.chrome.com/docs/devtools/javascript/source-maps と https://developer.chrome.com/docs/devtools/developer-resources — `Add source map` の手動ロード手順と `Enable loading through target`。
5. https://developer.chrome.com/docs/devtools/shortcuts#sources — 本ノート §4.2 の表の原典。自分の OS 側で実際のキー割り当てを確認する。
6. https://developer.chrome.com/docs/devtools/console/utilities — `debug()` / `monitor()` / `monitorEvents()` / `getEventListeners()` / `queryObjects()` の完全なリスト（本ノートは主要関数を転記済み）。
7. （原典が参照している外部文書）https://web.dev/articles/trusted-types — Trusted Types による DOM XSS 対策。および `/blog/csp-issues/#debugging-trusted-types-problems`（DevTools での CSP / Trusted Types デバッグ）。

---

## 用語集候補（教科書の用語集へ）

| 用語 | 定義（原典ベース） |
| --- | --- |
| Sources panel | DevTools で JavaScript をデバッグするパネル。File Navigator（Page）/ Code Editor / JavaScript Debugging の 3 ペイン構成 |
| breakpoint | コード実行を意図的に停止させる地点。停止中はその瞬間の全変数値を検査できる |
| line-of-code breakpoint | 行番号列をクリックして設定する最も一般的なブレークポイント。DevTools は常にその行の実行前に停止する |
| conditional breakpoint | 行番号を右クリック > **Add conditional breakpoint**。条件が真のときだけ停止。疑問符付きオレンジアイコン |
| logpoint | 行番号を右クリック > **Add logpoint**。実行を止めずに Console にログ。2 ドットのピンクアイコン |
| `debugger` 文 | コード中に書く行ブレークポイント。UI 設定と等価 |
| DOM change breakpoint | Elements で要素を右クリック > **Break on** > Subtree modifications / Attribute modifications / Node removal |
| XHR/fetch breakpoint | 要求 URL が指定文字列を含むとき `send()` の行で停止 |
| Event Listener Breakpoints | イベント発火後に走るリスナコードで停止。カテゴリ（Mouse, Animation, Clipboard…）または個別イベント単位 |
| exception breakpoint | **Pause on uncaught exceptions** / **Pause on caught exceptions** |
| function breakpoint | Console から `debug(functionName)`。関数の先頭行に行ブレークポイントを置くのと等価。スコープ外だと `ReferenceError` |
| Trusted Type breakpoint / CSP Violation Breakpoints | **Sink Violations** と **Policy Violations**。Trusted Types 違反で停止する |
| source（DOM XSS） | ユーザが制御できる入力（ユーザ名、URL フラグメント由来の redirect URL など） |
| sink（DOM XSS） | `eval()` のような関数や `.innerHTML` のようなプロパティ setter で、任意 JS を実行できるもの |
| Step over | 現在行の関数にステップインせず実行して次の行へ |
| Step into | 現在行の関数の内部へ入る |
| Step out | 現在の関数の残りを実行して呼び出し元へ戻る |
| Continue to here | 行を右クリックして選択。その行までのコードを実行して停止 |
| Resume Script Execution | 次のブレークポイントまで実行を再開（`F8`） |
| Force script execution | Resume を長押しして選択。すべてのブレークポイントを無視して再開 |
| Deactivate breakpoints | 設定済みの全ブレークポイントを DevTools に無視させるトグル |
| Threads pane | web worker / service worker のコンテキストを切り替える。青い矢印が現在のコンテキスト |
| Scope pane | 停止中に local / closure / global のプロパティと変数を表示・編集。値をダブルクリックで変更。非列挙プロパティはグレー |
| Watch pane / Watch Expressions | 任意の有効な JS 式の値を監視。ステップ中は自動更新 |
| Call Stack pane | 停止地点に至る呼び出し履歴。エントリクリックで呼び出し元へジャンプ。青い矢印が現在のフレーム |
| Restart frame | Call Stack で関数を右クリックして選択。実行ポインタを関数先頭に戻す（引数はリセットしない）。WebAssembly / async / generator は不可 |
| Show ignore-listed frames | Call Stack セクションのチェックボックス。サードパーティを含む完全なスタックを表示 |
| async frames / Async Stack Tagging | `console.createTask()` API に基づき非同期処理の完全な呼び出し履歴を Call Stack に表示（フレームワーク側の実装が必要） |
| Copy stack trace | Call Stack 右クリックで現在のスタックをクリップボードへ |
| inline evaluation（`#inline-eval`） | 停止中、現在の関数内の変数・定数・オブジェクトの現在値を宣言の横にインライン表示 |
| Ignore List（旧 blackbox） | デバッガが無視するスクリプトの一覧。`Enable Ignore Listing` がメインスイッチ |
| Authored / Deployed | ファイルツリーのグルーピング。Authored は source maps から生成した著者コード、Deployed はブラウザが読む（通常 minify された）実ファイル |
| pretty print（`{ }`） | Editor 左下のボタン。minify ファイルを整形表示／元の姿に戻す。行継続は `-` で示される |
| live edit（paused 関数のライブ編集） | 停止中に最上位フレームの関数を編集して <kbd>Command</kbd>/<kbd>Ctrl</kbd>+<kbd>S</kbd> で適用。デバッガが関数を自動 restart する（Chrome 105+） |
| Local Overrides | DevTools での変更を指定フォルダに保存し、リロード後もネットワークリソースの代わりにローカルファイルを提供する仕組み。レスポンスヘッダも `.headers` ファイルで上書き可能 |
| Workspaces | DevTools での変更をローカルのソースファイルへ直接保存する仕組み |
| Snippets | Sources パネルで作成・保存し任意ページ／シークレットモードで実行できるスクリプト。bookmarklet の代替 |
| source map | 結合・minify・コンパイル後のコードを元のソースにマップする仕組み。`//# sourceMappingURL` コメントで参照される |
| `//# sourceURL` | `eval()` 等で評価したコードに名前（仮想パス）を与えるコメント |
| Developer Resources | source map の読み込み Status / Error を確認し、`Add source map` で手動ロードできるドロワータブ。`Enable loading through target` オプションあり |
| Changes（ドロワータブ） | DevTools 上で加えた web コンテンツの変更を一箇所で追跡する |
