# Chrome DevTools 実践デバッグ（前編）— ブレークポイント / source map / Local Overrides / Network

> **この節で分かること**
> - Sources パネルを使った 7 ステップのデバッグワークフローを自分で実行できる
> - 9 種類のブレークポイントを用途別に使い分けられる（特に脆弱性診断に直結する Trusted Type / CSP Violation ブレークポイントを説明できる）
> - source map を有効化・確認・手動読み込みして「minify される前の元コード」をデバッグできる
> - minified コードを pretty print で読み、Ignore List でノイズを排除できる
> - Local Overrides でレスポンス本文やヘッダを安全に差し替え、クライアント側パーサの挙動を単独で検証できる
> - Network パネルで XHR ブレーク・Request blocking・横断検索・Copy as fetch を使い、クライアントサイド脆弱性の一次スクリーニングができる

**元資料**: https://developer.chrome.com/docs/devtools/javascript/ ほか Chrome DevTools 公式ドキュメント（原典取得済み。担当の解説記事 2 本 https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/ と https://www.browserstack.com/guide/how-to-debug-js-in-chrome は取得できず、公式ドキュメントで全面的に代替）
**関連する節**: 30b「Chrome DevTools 実践デバッグ（後編）— Snippets / Console ユーティリティ / Performance / Memory」

---

## 0. この節の位置づけ

Chrome DevTools（デベロッパーツール）とは、Chrome に標準搭載されたブラウザ内の開発・調査ツールのこと。ページが読み込んだ JavaScript を止めて中を覗いたり、ネットワーク通信を観察したり、レスポンスを差し替えたりできる。

クライアントサイド脆弱性ハンティングでは、DevTools は「攻撃者が制御できるデータ（source）が、危険な処理（sink）にどう流れ着くか」を実行時に追いかける主力の道具になる。この前編では、その土台となる Sources パネルと Network パネルの操作を、公式チュートリアルの手順どおりに固める。

担当した 2 本の解説記事は本教科書の執筆環境から取得できなかったが、それらが扱う題材（デバッグ手順、source map、Local Overrides、pretty print、Network、Console ユーティリティ）は、いずれも Chrome DevTools 公式ドキュメントが原典にあたる。そのため本節は「二次情報の要約」ではなく、原典による記述である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Chrome DevTools JavaScript Debugging Guide 2026（devplaybook.cc） — https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 組織のポリシー強制型 egress プロキシがこのドメインを許可リストに入れておらず、CONNECT で 403 拒否。web.archive.org 経由も 403 で不可）。以下の記述は公式ドキュメントにもとづく要約であり、この記事固有の 2026 年時点の記述は含まれない。
> **読みどころ**:
> 1. タイトルに "2026" とあるため、2026 年時点の DevTools UI 変更点を最優先で読む。本節の基礎は公式ドキュメントの 2022〜2023 年更新版に基づいており、Performance パネルの Insights / Live metrics、Sources パネルのレイアウト変更、AI assistance パネルなどの新要素は含まれていない
> 2. 記事独自のワークフロー例・チェックリスト（実務で「どの順番で何を見るか」の判断順序）
> 3. 本節の 9 種ブレークポイント表・Local Overrides 手順・Network フィルタ表と照合し、新しいフィルタ・新しいブレークポイント種別・非推奨化された機能が書かれていないか
> **代替手段**: なし（同題材の一次資料として本節が使った公式ドキュメント https://developer.chrome.com/docs/devtools/javascript/ を開くとよい）

---

## 1. デバッグの基本ワークフロー（7 ステップ）

公式チュートリアルは「`5 + 1` の答えが `51` になってしまう」という足し算のバグを題材に、7 ステップで進む。動画版は YouTube の動画 ID `H0XScE08hy8`。まずこの流れを体で覚えると、他のすべての機能が「この流れのどこを速くするか」として整理できる。

### 1.1 Step 1: バグを再現する

デバッグの最初のステップは常に「バグを一貫して再現できる操作列を見つけること」である。再現できないバグは直しようがない。デモの手順は次のとおり。

1. デモを新しいタブで開く: `https://googlechrome.github.io/devtools-samples/debug-js/get-started`
2. **Number 1** に `5` を入力する
3. **Number 2** に `1` を入力する
4. **Add Number 1 and Number 2** をクリックする。ボタン下のラベルが `5 + 1 = 51` と表示される。正解は `6` である

### 1.2 Step 2: Sources パネルの UI を把握する

Sources パネルとは、ページが読み込んだファイルを表示し、JavaScript を止めて調べる場所のこと。まず DevTools を開く。

- ショートカット: Mac は <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>J</kbd>、Windows / Linux は <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd>。このショートカットは **Console パネル**を開く
- 続けて **Sources** タブをクリックする

Sources パネルは 3 つのペイン（区画）で構成される。

```
+----------------+---------------------------+------------------------+
| File Navigator | Code Editor               | JavaScript Debugging   |
| ペイン         | ペイン                    | ペイン                 |
| （読み込んだ   | （選んだファイルの中身が  | （ブレークポイント、   |
|  全ファイル）  |  ここに開く）             |  Scope、Call Stack 等）|
+----------------+---------------------------+------------------------+
```

| ペイン名 | 役割 |
|---|---|
| File Navigator ペイン | ページが要求した全ファイルが列挙される |
| Code Editor ペイン | File Navigator で選んだファイルの内容が表示される |
| JavaScript Debugging ペイン | ページの JavaScript を調べる各種ツール。ウィンドウが広いと Code Editor の右側に配置される |

### 1.3 Step 3: ブレークポイントでコードを止める

ブレークポイント（breakpoint）とは、指定した箇所で JavaScript の実行を一時停止させる印のこと。停止した瞬間の変数の値をすべて見られる。

多くの初心者は `console.log()`（値を Console に出力する文）をコードに挿しまくって調べるが、公式は次の理由でブレークポイントを勧める。

- `console.log()` は、ソースを開き、該当箇所を探し、文を挿入し、リロードして Console を見る必要がある。ブレークポイントなら**コードの構造を知らなくても**関連コードで停止できる
- `console.log()` は見たい値を**明示指定**しないといけない。ブレークポイントならその瞬間の**全変数**の値が見える。自分が気付いていない変数が影響していることもある

参考までに、`console.log()` で同じことをやろうとするとこうなる（原文の例）。

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

このデモでは「クリックしたときに走るコード」で止めたいので、Event Listener Breakpoints（イベントリスナ・ブレークポイント。特定のイベントが起きた瞬間に止める）を使う。

1. JavaScript Debugging ペインで **Event Listener Breakpoints** をクリックして展開する。**Animation**、**Clipboard** などのカテゴリが並ぶ
2. **Mouse** カテゴリ横の **Expand** をクリックする。**click**、**mousedown** などが並び、各々にチェックボックスがある
3. **click** のチェックを入れる。これで*任意の* `click` イベントリスナ実行時に自動停止する
4. デモで **Add Number 1 and Number 2** を再度クリックする。DevTools が停止し、Sources で次の行をハイライトする

```js
function onClick() {
```

別の行で止まった場合は、正しい行になるまで **Resume Script Execution**（スクリプト実行を再開）を押す。

> **注**: 別の行で止まったなら、訪れた全ページに `click` リスナを登録する拡張機能が入っている可能性が高い。停止したのはその拡張のリスナ内である。シークレットモード（全拡張が無効）で試せば毎回正しい行で止まる。

### 1.4 Step 4: コードをステップ実行する

ステップ実行とは、止まった地点から 1 行ずつ手動で進めること。

1. **Step into next function call**（次の関数呼び出しに入る）をクリックして `onClick()` を 1 行ずつ進める。次の行がハイライトされる

```js
if (inputsAreEmpty()) {
```

2. **Step over next function call**（次の関数呼び出しを飛ばす）をクリックする。DevTools は `inputsAreEmpty()` の中に入らずに実行する。`inputsAreEmpty()` が false に評価されたため `if` ブロックがスキップされ、数行飛ぶ

### 1.5 Step 5: line-of-code ブレークポイントを置く

line-of-code ブレークポイント（行に対するブレークポイント）は、最も基本的な種類。特定の行の実行**前**に必ず止まる。

1. `updateLabel()` の最終行を見る

```js
label.textContent = addend1 + ' + ' + addend2 + ' = ' + sum;
```

2. 行番号は **32**。`32` をクリックすると青いアイコンが付く。これが line-of-code ブレークポイント
3. **Resume script execution** をクリックすると行 32 まで実行される。行 29, 30, 31 では `addend1`、`addend2`、`sum` の値が宣言の隣にインラインで表示される

### 1.6 Step 6: 変数の値を確認する（3 手法）

| 手法 | やり方 | 分かること |
|---|---|---|
| Method 1: Scope ペイン | 停止中、ローカル / グローバル変数と値が並ぶ。クロージャ変数も表示される。値をダブルクリックで編集可能。停止していないときは空 | 今この瞬間の全変数 |
| Method 2: Watch Expressions | **Watch** タブ → **Add Expression** → `typeof sum` と入力 → <kbd>Enter</kbd> | `typeof sum: "string"` と出て、`sum` が数値でなく文字列だと分かる。任意の有効な JS 式を置ける |
| Method 3: Console | <kbd>Escape</kbd> で Console ドロワーを開き式を評価 | 下記のとおり `6` が出る |

Console で次を評価すると、期待値 `6` が得られる。

```js
parseInt(addend1) + parseInt(addend2)
```

`parseInt()` は文字列を整数に変換する関数。つまりバグの原因は「`5` と `1` が文字列のまま `+` で連結され `"51"` になっていた」ことだと分かる。

### 1.7 Step 7: 修正を当てる

1. **Resume script execution** をクリックする
2. Code Editor で行 31 の `var sum = addend1 + addend2` を `var sum = parseInt(addend1) + parseInt(addend2)` に書き換える
3. Mac は <kbd>Command</kbd>+<kbd>S</kbd>、Windows / Linux は <kbd>Control</kbd>+<kbd>S</kbd> で保存する
4. **Deactivate breakpoints**（ブレークポイントの無効化）をクリックする。これがオンの間、DevTools は設定済みブレークポイントを無視する
5. 別の値でデモを試すと正しく計算される

> **注意**: このワークフローはブラウザ内で動いているコードにだけ修正を当てる。ページを訪れる全ユーザのコードは直らない。恒久的に直すにはサーバ上のコードを修正する必要がある。ただし後述の **Workspaces**（§9）を使えば DevTools 内の編集をソースに保存できる。Chrome 105 以降は「停止中の関数をライブ編集」もできる。

診断の観点では、この Step 7 の「ブラウザ内のコードだけを書き換える」性質が重要である。攻撃者が制御する値を実行時に差し込んで sink の反応を見る、といった検証がサーバに手を触れずにできる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: How to Debug JavaScript in Chrome（BrowserStack Guide） — https://www.browserstack.com/guide/how-to-debug-js-in-chrome
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: egress プロキシの許可リスト外で CONNECT 403。web.archive.org も 403）。以下の記述は公式ドキュメントにもとづく要約である。
> **読みどころ**:
> 1. 初学者向けの段階的な手順（DevTools の開き方 → Sources → ブレークポイント → ステップ実行）。本節 §1 と重複するが、スクリーンショットの新しさを確認する価値がある
> 2. BrowserStack 固有のクロスブラウザ / 実機デバッグへの接続部分。「ローカル Chrome では再現しないが実機 Android Chrome では再現する」類の問題の扱いは本節に一切含まれていない
> 3. モバイル Chrome のリモートデバッグ（USB / `chrome://inspect`）への言及。本節は扱っていない
> 4. 記事中の「よくあるエラーと対処」表（もしあれば）
> **代替手段**: なし

---

## 2. ブレークポイント全 9 種

line-of-code だけを知っていると、「どこを見ればよいか分からない場合」や「大規模コードベース」では設定が非効率になる。目的別に 9 種類を使い分けると時間を大きく節約できる。動画 ID は `JyHjoaUhAus`。

### 2.1 種別一覧（公式の表）

| Breakpoint Type | Use this when you want to ... |
|---|---|
| Line-of-code | Pause on an exact region of code. |
| Conditional line-of-code | Pause on an exact region of code, but only when some other condition is true. |
| Logpoint | Log a message to the **Console** without pausing the execution. |
| DOM | Pause on the code that changes or removes a specific DOM node, or its children. |
| XHR | Pause when an XHR URL contains a string pattern. |
| Event listener | Pause on the code that runs after an event, such as `click`, is fired. |
| Exception | Pause on the line of code that is throwing a caught or uncaught exception. |
| Function | Pause whenever a specific function is called. |
| Trusted Type | Pause on Trusted Type violations. |

以下、脆弱性ハンティングで特に重要なものを中心に見る。

### 2.2 Line-of-code（行）とコード内 `debugger`

「調べるべきコード領域が正確に分かっているとき」に使う。DevTools は常にその行の実行**前**に停止する。

1. **Sources** タブをクリックする
2. 対象行を含むファイルを開く
3. 対象行へ移動する
4. 行左の行番号カラムをクリックする。青いアイコンが出る

コードの中に `debugger;` と書くと、UI で置いたのと等価のブレークポイントになる。違いは「設定場所がコード内か DevTools UI か」だけである。

```js
console.log('a');
console.log('b');
debugger;
console.log('c');
```

### 2.3 Conditional line-of-code（条件付き）

「実行を止めたいが、ある条件が真のときだけにしたい」場合に使う。特に**ループ内で無関係なブレークをスキップ**したいときに有用。

1. **Sources** タブを開く
2. 対象行を含むファイルを開き、対象行へ移動する
3. 行番号カラムを**右クリック**する
4. **Add conditional breakpoint** を選択する
5. ダイアログに条件を入力し <kbd>Enter</kbd>。行番号の上に**オレンジ色の疑問符付きアイコン**が出る

例として、ループ中で `x` が `10` を超えた反復 `i=6` のときだけ発火させる、といった使い方ができる。診断では「`location.hash` に特定文字列が含まれるときだけ止める」など、条件で攻撃入力を絞り込める。

### 2.4 Logpoint（止めずにログを出す）

実行を止めず、かつコードに `console.log()` を散らさずに Console へメッセージを出す。

1. 行番号カラムを右クリックする
2. **Add logpoint** を選択する
3. `console.log(message)` と同じ構文でメッセージを入力する

ログできるものの例と、その出力例（原文逐語）。

```js
"A string " + num, str.length > 1, str.toUpperCase(), obj
```

```js
// str = "test"
// num = 3
// obj = {attr: "x"}
A string 42 true TEST {attr: 'x'}
```

<kbd>Enter</kbd> で有効化すると、行番号の上に**ピンク色の二点アイコン**が出る。

### 2.5 Breakpoints ペインでの管理

**Breakpoints** ペインは、ブレークポイントを**ファイル単位でグループ化**し、**行番号・列番号順**に並べる。

グループ（ファイル）に対してできること。

- グループ名クリックで折りたたみ / 展開
- チェックボックスで有効 / 無効（無効化すると Sources のマーカーが**半透明**になる）
- ホバーして閉じるアイコンでグループ削除

グループの右クリックメニューには次がある。

- Remove all breakpoints in file
- Disable all breakpoints in file
- Enable all breakpoints in file
- Remove all breakpoints（全ファイル）
- Remove other breakpoints（他グループ）

個別ブレークポイントは、編集中にインラインエディタのドロップダウンで**種別を変更**できる（通常 ↔ 条件付き ↔ logpoint）。右クリックメニューには Remove breakpoint / Edit condition or logpoint / Reveal location などがある。

### 2.6 DOM change breakpoints

「特定の DOM ノードやその子を変更するコードで止めたい」ときに使う。DOM（Document Object Model）とは、HTML をプログラムから操作できる木構造として表したもの。

1. **Elements** タブをクリックする
2. 対象要素へ移動して右クリックする
3. **Break on** にホバーし、**Subtree modifications** / **Attribute modifications** / **Node removal** を選ぶ

| 種別 | 発火条件 |
|---|---|
| Subtree modifications | 選択中ノードの子が削除 / 追加された、または子の内容が変わったとき。**子ノードの属性変更**や、**選択中ノード自身への変更**では発火しない |
| Attributes modifications | 選択中ノードに属性が追加 / 削除された、または属性値が変わったとき |
| Node Removal | 選択中ノードが削除されたとき |

一覧は **Elements > DOM Breakpoints** ペイン、または **Sources > DOM Breakpoints** サイドペインで確認・有効無効化できる。

診断上は、「攻撃入力を含む要素がどのコードから書き換えられているか」を突き止めるのに使える。たとえば `innerHTML` で挿入された要素の Subtree modifications に止めて、その呼び出し元コードを Call Stack で辿る。

### 2.7 XHR/fetch breakpoints

「XHR のリクエスト URL が指定文字列を含むときに止めたい」ときに使う。XHR（XMLHttpRequest）／fetch はブラウザからサーバへ非同期通信する仕組み。DevTools は **XHR が `send()` を呼ぶコード行で停止**する。

「ページが**誤った URL を要求している**のは分かるが、その誤リクエストを出しているコードがどこか分からない」ときに強力。

1. **Sources** タブをクリックする
2. **XHR Breakpoints** ペインを展開する
3. **Add breakpoint** をクリックする
4. 止めたい文字列を入力する（URL の**どこかにこの文字列が現れた**ときに停止）
5. <kbd>Enter</kbd> で確定する

例として、URL に `org` を含む任意のリクエストで止める、といった指定ができる。

### 2.8 Event listener breakpoints

「イベント発火後に走るリスナのコードで止めたい」ときに使う。`click` のような個別イベントでも、Mouse などカテゴリ全体でも選べる。

1. **Sources** タブをクリックする
2. **Event Listener Breakpoints** ペインを展開する
3. カテゴリにチェックを入れるとそのカテゴリの任意イベントで停止する。展開して個別イベントにチェックも可

例: `deviceorientation` のリスナで止める。なお、どの要素にどんなリスナが張られているかは **Elements > Event Listeners** ペインでも確認できる。

### 2.9 Exception breakpoints（例外）

「caught / uncaught 例外を投げている行で止めたい」ときに使う。caught 例外は `try...catch` で捕まえられる例外、uncaught 例外は捕まえられずに落ちる例外のこと。Node.js 以外のデバッグセッションでは両者を独立に停止できる。

**Sources** の **Breakpoints** ペインで次のどちらか（または両方）を有効にしてから実行する。

- **Pause on uncaught exceptions**
- **Pause on caught exceptions**

> **注意**: 現在、Node.js デバッグセッションでは、uncaught 例外でも止める設定にしない限り caught 例外だけで止めることはできない（Chromium bug #1382762 参照）。

### 2.10 Function breakpoints（`debug()`）

「特定の関数が呼ばれたら常に止めたい」ときは、Console から `debug(functionName)` を呼ぶ。これはその関数の 1 行目に line-of-code ブレークポイントを置くのと等価。**関数名の文字列ではなく関数オブジェクトを渡す**点に注意。

```js
function sum(a, b) {
  let result = a + b; // DevTools pauses on this line.
  return result;
}
debug(sum); // Pass the function object, not a string.
sum();
```

対象関数がスコープ外だと `ReferenceError` になる。

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

スコープを確保する戦略は次のとおり。

1. その関数がスコープ内になる場所に line-of-code ブレークポイントを置く
2. そのブレークポイントを踏ませる
3. 停止したままの状態で Console から `debug()` を呼ぶ

### 2.11 Trusted Type breakpoints（CSP Violation Breakpoints）— 脆弱性診断に直結

これが本章でもっとも重要なブレークポイントである。Trusted Types API は、cross-site scripting（クロスサイトスクリプティング, XSS）と呼ばれるセキュリティ悪用に対する保護を提供する仕組み。

> **重要用語（原文の逐語訳）**: DOM-based cross-site scripting は、ユーザが制御できる *source*（ユーザ名や URL フラグメントから取ったリダイレクト URL など）のデータが、*sink*（`eval()` のような関数、または `.innerHTML` のようなプロパティセッタで、任意の JavaScript コードを実行しうるもの）に到達したときに発生する。

つまり「攻撃者が触れる入力（source）」→「危険な出力先（sink）」という流れが DOM-based XSS の本質であり、Trusted Type ブレークポイントは**その sink 到達を実行時に捕まえる**機能である。

**Sources** の **Breakpoints** ペインで **CSP Violation Breakpoints** セクションへ行き、次を有効にして実行する。

| 設定 | 止まるタイミング |
|---|---|
| Sink Violations | sink 違反で停止する |
| Policy Violations | ポリシー違反で停止する。Trusted Type ポリシーは `trustedTypes.createPolicy` で設定する |

さらに学ぶための公式リンクは次のとおり。

- セキュリティ目的: Prevent DOM-based cross-site scripting vulnerabilities with Trusted Types — https://web.dev/articles/trusted-types
- デバッグ目的: Implementing CSP and Trusted Types debugging in Chrome DevTools — https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems
- 仕様: Trusted Types — https://www.w3.org/TR/trusted-types/

診断の使い方は、対象アプリが Trusted Types を導入している前提で、Sink Violations を有効にしてから疑わしい入力（URL のフラグメント、フォーム値など）を流し、**どのコードが sink へ到達したか**を Call Stack で辿る、というもの。許可された診断・バグバウンティ・自分で立てた検証環境の範囲で行うこと。

---

## 3. ステッピング・Call Stack・Scope・Watch の詳細

出典: https://developer.chrome.com/docs/devtools/javascript/reference/ 。ここは §1 のステップ実行を精密に扱う。

### 3.1 停止中の値確認とホバー

停止している間、デバッガは現在の関数内でブレークポイントまでの全変数・定数・オブジェクトを評価し、宣言の隣に現在値をインライン表示する。Console から評価済みの値を問い合わせることもできる。停止中はクラス名や関数名に**ホバー**すると、そのプロパティをプレビューできる。停止中は現在の関数を restart することも live-edit することもできる。

### 3.2 Step over / into / out

3 つのステップ操作の違いを、同じ形の例で整理する。

```js
function updateHeader() {
  var day = new Date().getDay();
  var name = getName(); // A
  updateName(name);     // D
}
function getName() {
  var name = app.first + ' ' + app.last; // B
  return name;                            // C
}
```

| 操作 | `A` で停止中に押すと | 使いどころ |
|---|---|---|
| Step over | `getName()` 内（`B`・`C`）を実行し、`D` で止まる（中に入らない） | その関数がデバッグ対象と無関係なとき |
| Step into | この行を実行して `B` で止まる（中に入る） | その関数呼び出しがデバッグ対象に関係するとき |
| Step out | 現在の関数の残りを実行し、呼び出し元の次の行で止まる | 無関係な関数の中に入ってしまったとき、そこから抜ける |

### 3.3 Continue to here / Resume / Force

- **Continue to here**: 目的の行を右クリックして選ぶと、その地点まで一気に実行して止まる。長い関数で無関係な行を飛ばすのに速い。〔補足〕キーボードからは <kbd>Command</kbd>（Mac）/ <kbd>Control</kbd>（Win/Linux）を押しながら該当行をクリックしても同じ動作になる
- **Resume Script Execution**: 停止後に実行を続け、次のブレークポイントで止まる
- **Force script execution**: 全ブレークポイントを無視して強制再開する。**Resume Script Execution** を長押しして選ぶ

### 3.4 カンマ区切り式のステップ（minified 対応）

Chrome 108 以降、Debugger はセミコロン区切り（`;`）とカンマ区切り（`,`）の両方の式をステップできる。これにより minified コードもステップできる。次の元コードを minify すると、

```js
function foo() {}

function bar() {
  foo();
  foo();
  return 42;
}

bar();
```

カンマ区切りの `foo(),foo(),42` を含む形になる。

```js
function foo(){}function bar(){return foo(),foo(),42}bar();
```

Debugger はこれも同様にステップする。したがって「セミコロンが見えているなら、実際にデバッグしているソースが minified であっても常にそれをステップできると期待してよい」。

### 3.5 Scope / Call Stack / Threads

- **Scope ペイン**: 停止中に local / closure / global スコープの値を確認・編集できる。値のダブルクリックで変更。**列挙不可（non-enumerable）なプロパティはグレー表示**される
- **Call Stack ペイン**: そこに至った呼び出しスタック（どの関数がどの関数を呼んだか）を表示する。エントリをクリックするとその関数が呼ばれた行へジャンプする。**青い矢印アイコン**が現在ハイライト中の関数を示す。行で停止していないときは空
- **Threads ペイン**: web worker / service worker を扱うとき、列挙されたコンテキストをクリックして切り替える。青い矢印が現在のコンテキストを示す

Call Stack は、攻撃入力が sink に到達したときに「どこから呼ばれたか」を根本まで遡る主力の道具になる。

### 3.6 Restart frame（フレームの再実行）

デバッグフロー全体を再開せずに、停止中の関数 1 つだけを再実行できる。**Call Stack** ペインで関数を右クリックし、**Restart frame** を選ぶ。ただし WebAssembly、async、generator 関数は除く。

理解のための原文コードと注意点。

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

`bar()` のフレームを restart して value をインクリメントし続けると、値は `0` にリセットされず増え続ける。これはフレーム restart が**引数をリセットしない**（実行ポインタを関数先頭に戻すだけ）ため。一方 `foo()` のフレームを restart すると値は再び `0` になる。これは JavaScript では引数への変更が関数の外側に反映されないためである。

### 3.7 Async frames と stack trace のコピー

フレームワークが対応していれば、DevTools は `console.createTask()` API に基づく "Async Stack Tagging" で非同期呼び出しの両側をリンクし、Call Stack に async 呼び出し履歴を含めて表示する（例: Angular が対応）。

Call Stack ペインを右クリックして **Copy stack trace** を選ぶと、現在のコールスタックがクリップボードにコピーされる。出力例。

```js
getNumber1 (get-started.js:35)
inputsAreEmpty (get-started.js:22)
onClick (get-started.js:15)
```

### 3.8 Watch ペイン

**Watch** ペインで任意の JavaScript 式の値を監視する。**Add Expression** で式を追加し、**Refresh** で更新する。コードをステップしている間は値が自動更新される。

---

## 4. source map で「元のコード」をデバッグする

出典: https://developer.chrome.com/docs/devtools/javascript/source-maps/ 。動画 ID `SkUcO4ML5U0`。

### 4.1 なぜ必要か（設計意図）

本番の JavaScript は結合・minify（縮小）・コンパイルされて配信される。人間には読めない `a,b,c` のような 1 行の塊になっていることが多い。source map（ソースマップ）とは、その minify 後コードと**元のコード**の対応関係を記録したファイルのこと。

source map があると、DevTools は minify 済みファイルに**加えて**元ファイルもロードする。Chrome は実際には minify 済みコードを実行するが、Sources パネルは自分が書いたコードを表示する。ブレークポイントもエラーもログも自動でマップされ、「自分が書いたままのコードをデバッグしているかのように」見える。

Sources で source map を使う条件は 2 つ。

- source map を生成できるプリプロセッサのみを使う
- Web サーバが source map を配信できることを確認する

### 4.2 サポートされるプリプロセッサ

| 分類 | 例 |
|---|---|
| Transpilers | Babel |
| Compilers | TypeScript, Dart |
| Minifiers | terser |
| Bundlers / dev servers | Webpack, Vite, esbuild, Parcel |

拡張リストは Source maps: Languages, tools, and other info（https://github.com/ryanseddon/source-map/wiki/Source-maps:-languages,-tools-and-other-info）にある。

### 4.3 有効化と使い方

まず **Settings > Preferences > Sources** で **Enable JavaScript source maps** にチェックが入っていることを必ず確認する（CSS 用の **Enable CSS source maps** も入れておくとよい）。

有効化した状態でのデバッグの流れ。

1. **Sources** でサイトのソースを開く
2. ファイルツリーで Authored / Deployed をグループ化し、**Authored** セクションの元ソースを Editor で開く
3. 通常どおりブレークポイント（例: logpoint）を設定して実行する
4. Editor 下部のステータスバーに **deployed ファイルへのリンク**が出る
5. Console ドロワーを開くと、logpoint のメッセージ横に **deployed ではなく元ファイルへのリンク**が表示される
6. ブレークポイント種別を通常のものに変えて再実行すると停止する。Call Stack が**元のファイル名**を表示する
7. ステータスバーの deployed リンクをクリックすると対応ファイルへ移動する

deployed ファイルを開くと、DevTools は `//# sourceMappingURL` コメントと元ファイルを見つけたか通知する。deployed ファイルは自動で pretty-print される。

### 4.4 `#sourceURL` で `eval()` に名前を付ける

`//# sourceURL=/path/to/source.file` というコメントは、`eval()` を使ったときにブラウザにソースファイルを探すよう指示し、eval やインラインスクリプト・スタイルに名前を付けられる。詳細は Source Map V3 仕様（https://sourcemaps.info/spec.html）。

デモ http://www.thecssninja.com/demo/source_mapping/compile.html の手順。

1. **Sources** パネルへ行く
2. ページの *Name your code:* 入力欄に任意のファイル名を入れる
3. **Compile** ボタンをクリックする
4. **Page** ペインのファイルツリーで、入力名の新しいファイルを開く。`// #sourceURL` コメント付きのコンパイル済みコードが入っている
5. Editor のステータスバーのリンクからソースファイルを開く

〔補足〕クライアントサイド脆弱性ハンティングでは、`eval()` / `new Function()` / 動的 `import()` で流し込まれたコードは既定で「匿名のスクリプト」として扱われ、ファイルツリーで追いにくい。対象アプリが `//# sourceURL=` を付けていれば名前付きで現れ、sink に到達する動的コードの特定が容易になる。付いていない場合は Call Stack と `debug()` / XHR ブレークポイントを併用して辿る。

---

## 5. Developer Resources — source map の確認と手動読み込み

出典: https://developer.chrome.com/docs/devtools/developer-resources 。source map が正しく読み込めたかを確認し、必要なら手動でロードするタブ。production サイトの解析で効いてくる。

### 5.1 状態を確認する

1. DevTools を開き、source map を有効化していることを確認する
2. **三点メニュー > More tools > Developer Resources** に移動する
3. 表で次の列を見る

| 列 | 意味 |
|---|---|
| Status | source map の読み込みが成功 / 失敗したか |
| Error | あればエラーメッセージ |

上部のテキストボックスで URL やエラーメッセージによるフィルタもできる。

### 5.2 トラブルシューティング（CORS のハマりどころ）

既定では、Web サイトではなく**DevTools が**source map をリクエストする。そのリクエストは cross-origin（クロスオリジン、異なるサイト間の通信）として扱われ、通らないことがある。CORS（Cross-Origin Resource Sharing）とは、あるサイトのリソースを別サイトから読み込む可否をサーバが制御する仕組み。

Web サイト側に先に source map をリクエストさせるには、Developer Resources の右上で **Enable loading through target** にチェックを入れる。

### 5.3 source map を手動で読み込む

読み込みに失敗した場合や、**source map を持たない production サイトで元コードをデバッグしたい**場合、手動で読み込める。

1. source map をサポートするツールで source map を生成する
2. source map をローカルにホストする
3. 対象ページで DevTools を開き、source map を有効化していることを確認する
4. **Sources** で deployed（処理済み）ファイルを開き、Editor 内で右クリックして **Add source map** を選ぶ
5. テキストボックスに source map の URL を指定し **Add** をクリックする
6. **Developer Resources** に source map が現れ、元ファイルがファイルツリーに現れたか確認する
7. 元ファイルのデバッグへ進む

---

## 6. minified コードを読む — pretty print / 折りたたみ / 検索置換 / ライブ編集

出典: https://developer.chrome.com/docs/devtools/javascript/reference/ 。source map が無い相手でも、最低限読める形にする技術。

### 6.1 pretty print

**既定で Sources パネルは minified ファイルを pretty-print する**。pretty print（プリティプリント）とは、1 行に詰め込まれたコードを人間が読める複数行に整形すること。整形時、Editor は 1 本の長い行を複数行に表示し、行の継続を示すために `-` を使うことがある。

**minified ファイルを読み込まれたままの姿で見たいときは、Editor 左下隅の `{ }` をクリックする**（整形の切り替え）。

### 6.2 折りたたみ・編集・ライブ編集

- **折りたたみ**: 左カラムの行番号にホバーして **Collapse** をクリック。展開は隣の `{...}`
- **編集**: Editor でファイルを開いて変更し、<kbd>Command</kbd>/<kbd>Ctrl</kbd>+<kbd>S</kbd> で保存する。**DevTools は JS ファイル全体を Chrome の JavaScript エンジンにパッチする**
- **停止中のライブ編集**（Chrome 105 以降）: 停止中に現在の関数を編集して保存すると、その場で反映される。制約として、**Call Stack 最上位の関数のみ**、かつ**スタック下方に同じ関数への再帰呼び出しが無いこと**。適用時にデバッガが自動で関数を restart するため、restart の制約（WebAssembly / async / generator 不可）も効く

原文の例では、`addend1` と `addend2` が誤って `string` 型で文字列連結になっているのを、ライブ編集中に `parseInt()` を足して直している。

### 6.3 検索と置換、Authored / Deployed グループ化

- **検索**: Editor で <kbd>Command</kbd>/<kbd>Ctrl</kbd>+<kbd>F</kbd>。**Match Case**（大文字小文字区別）、**Use Regular Expression**（正規表現）を切り替えられる
- **置換**: 検索バーの **Replace** から **Replace** / **Replace all**
- **ファイルツリーのグループ化**（Chrome 104 以降）: 三点メニューの **Group files by Authored/Deployed** を有効にすると、**Authored**（IDE で見るソースに近い。source map から生成）と **Deployed**（ブラウザが実際に読む、通常 minified）の 2 カテゴリに分かれる
- ignore-list されたソースを完全に隠すには **Sources > Page > 三点メニュー > Hide ignore-listed sources**（Chrome 106 以降）

---

## 7. Ignore List（ノイズ排除）

出典: https://developer.chrome.com/docs/devtools/settings/ignore-list/ ほか。Ignore List（無視リスト）とは、デバッグ中にスキップしたいスクリプトを登録する仕組み。ignore したスクリプトは Call Stack で隠され、ステップ実行でその関数に入らない。

```js
function animate() {
  prepare();
  lib.doFancyStuff(); // A
  render();
}
```

`A` は信頼しているサードパーティライブラリ。問題がそこ由来でないと確信できるなら ignore するのが合理的。自分のコードだけを追えるので、脆弱性の source→sink 追跡が格段に読みやすくなる。

### 7.1 設定

**Settings > Ignore List** で設定する。**Enable Ignore Listing** が全機能の主スイッチ。

| やりたいこと | 設定 |
|---|---|
| 拡張機能のコードを無視 | **Enable Ignore Listing** に加え **Add content scripts to ignore list** |
| 既知のサードパーティを無視 | **Automatically add known third-party scripts to ignore list**（source map の `ignoreList` プロパティに基づく。Angular や Nuxt が対応） |
| 自分でパターン指定 | **Custom exclusion rules** で **Add pattern** → スクリプト名または RegEx を入力 → **Add** |

`ignoreList` の詳細は x-google-ignoreList（https://developer.chrome.com/articles/x-google-ignore-list/）。

---

## 8. Local Overrides — レスポンス本文とヘッダをローカルで上書きする

出典: https://developer.chrome.com/docs/devtools/overrides/ 。脆弱性検証で非常に強力な機能なので詳しく扱う。

### 8.1 何ができるか（設計意図）

Local Overrides（ローカルオーバーライド）を使うと、**HTTP レスポンスヘッダ**と **Web コンテンツ**（XHR / fetch リクエストを含む）を上書きして、アクセス権が無いリモートリソースでもモック（模擬）できる。バックエンドの対応を待たずに変更をプロトタイプでき、変更はページロードをまたいで保持できる。

仕組みは次のとおり。

```
[通常]  ブラウザ ──リクエスト──> サーバ ──本物のレスポンス──> ブラウザ

[Override 有効時]
  変更を加えると DevTools が指定フォルダに改変版ファイルを保存
  リロードすると DevTools がネットワークではなく「ローカルの改変版」を返す
```

### 8.2 制限事項

Local Overrides はネットワークレスポンスヘッダと、XHR / fetch を含むほとんどのファイル種別で動くが例外がある。

- Elements パネルの DOM ツリーで加えた変更は保存されない
- Styles ペインで CSS を編集し、その CSS のソースが HTML ファイルの場合は保存されない（代わりに Sources で HTML ファイルを編集する）
- source-mapped ファイルは override できない

### 8.3 セットアップ手順

1. DevTools を開き、**Network** パネルで上書きしたいリクエストを**右クリック**し、**Override headers** または **Override content** を選ぶ
2. 未セットアップなら、上部のアクションバーで DevTools が促す。override ファイルを保存する**フォルダを選択（Select a folder）**し、**Allow** をクリックしてアクセス権を与える
3. セットアップ済みだが無効なら DevTools が自動で有効化する
4. 有効になると、Web コンテンツ変更なら **Sources** パネルへ、レスポンスヘッダ変更なら **Network > Headers > Response Headers** エディタへ連れて行かれる

一時無効化と削除は **Sources > Overrides** で行う。**Enable Local Overrides** をクリアで一時無効化、**Clear** で全削除。個別ファイル / フォルダは右クリック → **Delete**（この操作は取り消せず、手で作り直す必要がある）。全 override の確認は Network でリクエストを右クリック → **Show all overrides**。加えた変更は **Changes** ドロワータブ 1 箇所で追跡できる。

### 8.4 診断での使い方

〔補足〕診断目的では、この機能は「サーバ側の応答を安全に差し替えて、クライアント側パーサ・レンダラの挙動を単独で検証する」手段として使える。たとえば JSON レスポンス内の文字列に `<img src=x onerror=1>` 相当のペイロードを入れて、フロントエンドがそれを `innerHTML` に流すか（＝ DOM-based XSS が成立するか）を、実サーバへ攻撃リクエストを一切送らずに確認できる。許可された検証・バグバウンティの範囲内で、サーバに副作用を出さない安全な検証手段として有効である。

### 8.5 HTTP レスポンスヘッダの上書き（CORS / Permissions-Policy / COOP-COEP）

Web サーバへのアクセス権なしにレスポンスヘッダを上書きできる。対象になりうるヘッダの例。

- Cross-Origin Resource Sharing (CORS) Headers
- Permissions-Policy Headers
- Cross-Origin Isolation Headers

手順（デモ: https://cors-demo-devtools.glitch.me/ ）。

1. **Network** でリクエストを右クリックして **Override headers** を選ぶ。**Headers > Response Headers** エディタへ移動する
2. レスポンスヘッダ値にホバーし、編集アイコンをクリックしてエディタを有効化する
3. ヘッダを変更、または **Add header** で追加する。この例では CORS エラーを消すために次を追加している

```http
Access-Control-Allow-Origin: *
```

DevTools は変更したヘッダを**緑**、削除した override を**赤（取り消し線）**でハイライトする。最後にページを Refresh して適用する。

### 8.6 `.headers` ファイルで一括ルール適用

1. **Response Headers** セクション隣の **Header overrides** をクリックすると、**Sources > Overrides** の `.headers` ファイルへ移動する
2. **Add override rule** で新しいルールを追加する。ルールは「ヘッダと値の集合」＋「それを適用する単一 / 複数のリクエスト」
3. **ワイルドカード**で複数リクエストを一度に指定できる。**複数文字は `*`、1 文字は `?`**（DevTools Protocol の RequestPattern に基づく）
4. `.headers` ファイルを保存し、ページを Refresh する

---

## 9. Workspaces（Local Overrides との使い分け）

出典: https://developer.chrome.com/docs/devtools/workspaces/ 。動画 ID `Zu9CdbnS5ps`。

Workspace（ワークスペース）とは、DevTools 内で加えた変更を、**自分のコンピュータに保存されたソースコード**に保存させる機能。Local Overrides が「本物のソースにマップせず一時的に上書きする」のに対し、Workspace は「本物のソースファイルに書き戻す」点が違う。

たとえばデスクトップにサイトのソースがあり、そのディレクトリからローカル Web サーバを動かして `localhost:8080` でアクセスしているとき、DevTools で加えた CSS の変更がデスクトップのソースに保存される。モダンなフレームワークを使っている場合でも、通常は source map の助けを借りて最適化コードを元コードにマップできる。

**使い分けの指針（原文）**: バックエンドの変更を待たずに Web コンテンツやリクエストヘッダをモックしたいとき、またはページへの変更を実験してロードをまたいで見たいが、変更をソースにマップすることは気にしないときは **Local Overrides** を使う。

デモのローカルサーバ起動コマンド（デモ: https://github.com/sofiayem/devtools-workspace-demo ）。

```bash
cd ~/Desktop/devtools-workspace-demo
# If your Python version is 3.X
# On Windows, try "python -m http.server" or "py -3 -m http.server"
python3 -m http.server
```

---

## 10. Network パネル — 観測・ブロック・フィルタ・エクスポート

出典: https://developer.chrome.com/docs/devtools/network/ および https://developer.chrome.com/docs/devtools/network/reference/ 。ここは「サーバとの通信」を扱う。クライアントサイド脆弱性でも、どこへ何が送られ何が返るかを押さえるのは必須。

### 10.1 記録の制御

- **Preserve log**: チェックするとページロードをまたいでリクエストを保存する。無効化するまで全リクエストを保存する
- **Capture screenshots**: Network 内 **Settings** でチェックし、Network にフォーカスがある状態でリロードするとスクリーンショットが撮られる。サムネイルをクリックするとそれ以降に発生したリクエストを除外する

### 10.2 Replay XHR（XHR のリプレイ）

**Requests** テーブルでリクエストを選んで <kbd>R</kbd> を押す、または右クリックして **Replay XHR** を選ぶと、同じリクエストを再送できる。

〔補足〕診断では「同一リクエストを再送してレース条件・冪等性・トークン再利用を観察する」用途に使える。パラメータを変えて送りたい場合は、後述の **Copy as fetch** で Console に貼り付けて改変するほうが確実。

### 10.3 読み込み挙動の変更

- **Disable cache**: チェックするとブラウザキャッシュを無効化し、初回訪問者をエミュレートする。他パネル作業中は **Network conditions** ドロワーからも切り替えられる
- **Clear browser cache / cookies**: Requests テーブルを右クリックして選ぶ
- **オフライン / 低速のエミュレート**: **Network throttling** ドロップダウンから **Offline**、slow 3G、fast 3G などを選ぶ。カスタムプロファイルは **Custom > Add...** から作れる
- **WebSocket の throttling**（バージョン 99 以降）: 非常に遅いカスタムプロファイル（例: `10 kbit/s`）を作り、**WS** フィルタで **Messages** タブの送受信時間差を見る
- **User agent の上書き**: **Network conditions** で **Select automatically** を外してメニューやテキストボックスから指定する

### 10.4 リクエストのフィルタ

**Filter** テキストボックスにプロパティを入れると絞り込める。**スペース区切りで複数プロパティを同時に使える**（これは AND 演算と等価。OR は未サポート）。例: `mime-type:image/gif larger-than:1K` は 1KB より大きい全 GIF を表示する。

サポートされるプロパティの完全一覧。

| プロパティ | 意味 |
|---|---|
| `cookie-domain` | 特定の cookie domain を設定するリソースを表示 |
| `cookie-name` | 特定の cookie name を設定するリソースを表示 |
| `cookie-path` | 特定の cookie path を設定するリソースを表示 |
| `cookie-value` | 特定の cookie value を設定するリソースを表示 |
| `domain` | 指定ドメインのみ表示。ワイルドカード `*` 可（例: `*.com`）。遭遇した全ドメインでオートコンプリート |
| `has-overrides` | override したリクエストを表示（`content` / `headers` / `yes` / `no`） |
| `has-response-header` | 指定した HTTP レスポンスヘッダを含むリソースを表示 |
| `is` | `is:running` で `WebSocket` リソースを探す |
| `larger-than` | 指定サイズ（バイト）より大きいリソースを表示。`1000` は `1k` と等価 |
| `method` | 指定した HTTP メソッドで取得されたリソースを表示 |
| `mime-type` | 指定した MIME タイプのリソースを表示 |
| `mixed-content` | `mixed-content:all` / `mixed-content:displayed` |
| `priority` | 優先度レベルが一致するリソースを表示 |
| `resource-type` | リソース種別（例: image）のリソースを表示 |
| `response-header-set-cookie` | 生の Set-Cookie ヘッダを Issues タブに表示。不正な cookie がフラグされる |
| `scheme` | `scheme:http` / `scheme:https` |
| `set-cookie-domain` | 指定値に一致する `Domain` 属性の `Set-Cookie` を持つリソースを表示 |
| `set-cookie-name` | 指定値に一致する名前の `Set-Cookie` を持つリソースを表示 |
| `set-cookie-value` | 指定値に一致する値の `Set-Cookie` を持つリソースを表示 |
| `status-code` | HTTP ステータスコードが一致するリソースのみ表示 |
| `url` | `url` が指定値に一致するリソースを表示 |

**種別ボタン**（**All / Fetch/XHR / JS / CSS / Img / Media / Font / Doc / WS / Wasm / Manifest / Other**）でも絞れる。複数同時有効化は <kbd>Command</kbd>/<kbd>Control</kbd> を押しながらクリックする。**Overview** ペインを左右にドラッグすると時間で絞れる（包含的フィルタ）。

文字列・正規表現の例。

1. `png` → テキスト `png` を含むファイルのみ表示
2. `/.*\.[cj]s+$/` → 正規表現でフィルタ
3. `-main.css` → 先頭 `-` で否定フィルタ（`main.css` を除外）
4. `domain:raw.githubusercontent.com` → このドメイン以外を除外

チェックボックス系フィルタ。

| フィルタ | 効果 |
|---|---|
| Hide data URLs | `data:` で始まるリクエストを隠す |
| Hide extension URLs | `chrome-extension://` で始まるリクエストを隠す |
| Blocked response cookies | レスポンス cookie がブロックされたリクエスト以外を除外（デモ: https://samesite-sandbox.glitch.me/ ） |
| Blocked requests | ブロックされたリクエスト以外を除外（テーブルで**赤**表示） |
| 3rd-party requests | ページの origin と異なる origin のリクエスト以外を除外 |

### 10.5 ヘッダとレスポンスの横断検索（Search ペイン）

全リソースの HTTP ヘッダとレスポンスを、文字列または正規表現で検索できる。

1. **Search** をクリックすると Search ペインが開く
2. `Cache-Control` などを入力して Enter する。ヘッダ / 内容で見つかった全インスタンスが並ぶ
3. 結果をクリックする。ヘッダで見つかれば Headers タブ、内容で見つかれば Response タブが開く

ショートカット: Mac は <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>F</kbd>、Win/Linux は <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> で、**読み込まれた全リソースを横断してテキストを検索**する Search タブがドロワーに開く。

〔補足〕この横断検索は、クライアントサイド脆弱性ハンティングの一次スクリーニングに直結する。`postMessage`、`innerHTML`、`eval(`、`document.write`、`location.hash`、`dangerouslySetInnerHTML`、API キーらしき文字列などを全 JS バンドル横断で洗い出せる。Sources の <kbd>Command</kbd>+<kbd>F</kbd> は開いているファイル内のみなので、横断にはドロワーの Search を使う。

### 10.6 Request blocking（リソースを落として挙動を見る）

「一部リソースが利用できないとき、ページはどう振る舞うか」を確かめる。

1. Mac は <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>、その他は <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> で **Command Menu** を開く
2. `block` と入力し **Show Request Blocking** を選んで Enter する
3. **Add Pattern** をクリックし、`main.css` などを入力して **Add** する
4. ページをリロードする。ブロックされたリソースは Network ログで**赤いテキスト**になる
5. 終わったら **Enable request blocking** のチェックを外す

### 10.7 リクエストの解析（Timing / Initiator）

タイミングの内訳（主なもの）。

| フェーズ | 意味 |
|---|---|
| Waiting for server response (TTFB) | レスポンスの最初のバイトを待っている時間。1 往復のレイテンシ＋サーバ準備時間を含む |
| Content Download | レスポンス本文の読み取りに費やした総時間。予想より大きいと遅いネットワークやブラウザの多忙を示しうる |
| Receiving Push | HTTP/2 Server Push 経由でデータを受け取っている |
| Reading Push | 以前受け取ったローカルデータを読んでいる |

- **initiator と dependency の可視化**: Requests テーブルで <kbd>Shift</kbd> を押しながらホバーすると、initiator を**緑**、dependency を**赤**で色付けする
- **リクエストを引き起こしたスタックトレース**: **Initiator** 列にホバーするとリクエストに至るスタックトレースが見られる
- **load イベント**: `DOMContentLoaded` は**青**、`load` は**赤**で表示される
- **非圧縮サイズ**: **Settings > Use large request rows** をチェックして **Size** 列の下側の値を見る（例: 圧縮 `43.8 KB` / 非圧縮 `136 KB`）

### 10.8 エクスポート（HAR / Copy as ...）

HAR（HTTP Archive）は、HTTP セッションのキャプチャデータをエクスポートする JSON 形式。**Save all as HAR with content** または **Export HAR** で保存する。

> **注**: DevTools を開いてから発生した全リクエストが対象で、エクスポート対象をフィルタできない。単一リクエストが欲しいときはクリップボードへのコピーを使う。

Requests テーブルの **Name** 列で右クリックし **Copy** から選べる項目。

| メニュー項目 | 動作 |
|---|---|
| Copy link address | URL をコピー |
| Copy file name | ファイル名をコピー |
| Copy response | レスポンス本文をコピー |
| Copy as PowerShell | PowerShell コマンドとしてコピー |
| Copy as fetch | fetch 呼び出しとしてコピー |
| Copy as Node.js fetch | Node.js fetch 呼び出しとしてコピー |
| Copy as cURL | cURL コマンドとしてコピー |
| Copy all as PowerShell / fetch / Node.js fetch / cURL | 全リクエストを各形式の連鎖でコピー |
| Copy all as HAR | 全リクエストを HAR データとしてコピー |

〔補足〕**Copy as fetch** は、認証済みセッションのリクエストをそのままブラウザ Console に貼って改変再送できるため、CSRF 保護の有無・CORS 設定・パラメータ改変の影響を同一 origin 上で検証するのに適する。**Copy as cURL** はターミナル側の検査・自動化に向く（ただし Cookie や認証トークンを含むため、ログや共有時の取り扱いに注意）。

### 10.9 レイアウトの注意

**Hide the Filters pane** / **Use large request rows** / **Hide the Overview pane** の 3 調整項目がある。Filters ペインが隠れていると Filter テキストボックスや種別ボタンが見えないので、フィルタが使えないと感じたらまずここを疑う。

---

## 手を動かす

以下は、自分で立てた検証環境か、公式デモページ・許可された対象でのみ実施すること。

1. `https://googlechrome.github.io/devtools-samples/debug-js/get-started` を開き、<kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd>（Mac は <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>J</kbd>）で DevTools を開いて **Sources** タブへ行く
2. §1 の 7 ステップをそのままなぞる。Event Listener Breakpoints の Mouse > click にチェックを入れ、ボタンをクリックして `onClick()` で止め、Step into / Step over を押して挙動を観察する
3. 行 32 に line-of-code ブレークポイントを置き、Scope ペイン・Watch（`typeof sum`）・Console（`parseInt(addend1) + parseInt(addend2)`）の 3 手法で値を確認する
4. 新しい Snippet に §3.6 の `foo(0)` コードを貼って実行し、Call Stack で `bar()` フレームを **Restart frame** して値が増え続けること、`foo()` を restart すると `0` に戻ることを確かめる
5. 任意のサイトで **Settings > Preferences > Sources > Enable JavaScript source maps** を確認し、**三点メニュー > More tools > Developer Resources** で source map の Status / Error 列を見る
6. Network パネルを開き、ドロワーの Search（<kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>）で `innerHTML` や `location.hash` を全リソース横断検索してみる
7. **Command Menu**（<kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>）で `block` → **Show Request Blocking** を開き、`main.css` をブロックしてリロードし、赤表示とスタイル崩れを観察する
8. 自分の検証環境で、Network のリクエストを右クリック → **Override content** を選び、Local Overrides のフォルダを設定して、レスポンス本文にテスト文字列を差し込んでリロードし、ローカル版が返ることを確かめる

## つまずきポイント

- **click で止めたら知らない行だった**: 全ページに `click` リスナを張る拡張機能のコード内で止まっている。シークレットモードで試すと毎回正しい行で止まる
- **Deactivate breakpoints の色**: 有効であることを示す色が青。オンの間は設定済みブレークポイントが無視される点を混同しやすい
- **フレーム restart で値がリセットされない**: restart は引数をリセットせず実行ポインタを先頭に戻すだけ。同じ関数の restart をまたいで引数値がメモリに残る。呼び出し元フレームを restart すると初期値に戻る
- **source map が読めない**: 既定では DevTools がリクエストするため cross-origin で弾かれる。Developer Resources の **Enable loading through target** で Web サイト側にリクエストさせる。それでもだめなら **Add source map** で手動指定する
- **source-mapped ファイルは Override できない**: Local Overrides の対象外
- **HAR はフィルタできない**: DevTools を開いてから発生した全リクエストが入る。単一なら Copy を使う
- **Network フィルタは AND のみ**: スペース区切りは AND。OR は未サポート。先頭 `-` で否定
- **Filter テキストボックスが見当たらない**: Filters ペインが隠れている。レイアウト設定を疑う
- **Copy as cURL / fetch の共有**: Cookie や認証トークンを含む。ログや他人への共有時は必ず秘匿情報を除く

## この節のまとめ

- Chrome DevTools の JavaScript デバッグは Sources パネルが中心で、UI は File Navigator / Code Editor / JavaScript Debugging の 3 ペイン構成
- 公式の 7 ステップは「再現 → UI 把握 → ブレークポイントで停止 → ステップ → line-of-code → 値確認 → 修正」
- ブレークポイントは 9 種類あり、用途別に使い分けるのが最短経路
- Trusted Type（CSP Violation）ブレークポイントは、source が sink に到達する DOM-based XSS を実行時に捕まえる機能で、クライアントサイド脆弱性診断に直結する
- `debug(fn)` は関数呼び出しで止める Function breakpoint。関数オブジェクトを渡し、スコープ内で呼ぶ
- ステップは over（入らない）/ into（入る）/ out（抜ける）、加えて Continue to here で目的行まで一気に進める
- Call Stack は source→sink の呼び出し元を根本まで遡る主力。Ignore List で自分のコード以外を隠すと追跡が読みやすくなる
- source map は minify 後コードと元コードを対応づけ、`Enable JavaScript source maps` で有効化。読み込み状況は Developer Resources の Status / Error で確認し、失敗時は `Add source map` で手動指定、CORS で取れないときは `Enable loading through target`
- minified コードは既定で pretty print される。元の 1 行に戻すのは Editor 左下の `{ }`。Chrome 108 以降はカンマ区切り式もステップできる
- Local Overrides はレスポンス本文とヘッダをローカルの改変版に差し替える。サーバに副作用を出さずクライアント側パーサの挙動を単独検証できる（ただし source-mapped ファイルは不可）
- `.headers` ファイルではワイルドカード（`*`＝複数文字、`?`＝1文字）でルールを複数リクエストに適用できる
- Workspaces は DevTools の編集を本物のソースに書き戻す機能で、Local Overrides とは目的が異なる
- Network パネルの横断検索（ドロワー Search）で `innerHTML`・`eval(`・`postMessage` などを全バンドル横断で洗い出せる（一次スクリーニング）
- XHR/fetch ブレークポイント（URL 部分文字列一致で `send()` に停止）、Request blocking、Replay XHR、Copy as fetch がネットワーク側の主要武器
- 攻撃検証はすべて許可された診断・バグバウンティ・自分の検証環境に限り、防御・検出とセットで行う

## 理解度チェック

1. line-of-code ブレークポイントと `debugger;` の関係は？
   ▶ 答え: 等価。違いは「設定場所がコード内か DevTools UI か」だけ。`debugger;` を書いた行は UI で置いたブレークポイントと同じように実行前に停止する。

2. DOM-based XSS における source と sink とは何か、それを実行時に捕まえる DevTools の機能は？
   ▶ 答え: source はユーザが制御できるデータ（ユーザ名や URL フラグメント由来の値など）、sink は `eval()` や `.innerHTML` のように任意 JavaScript を実行しうる関数・プロパティセッタ。source が sink に到達すると DOM-based XSS が起きる。Trusted Type（CSP Violation）ブレークポイントの Sink Violations / Policy Violations で実行時に捕まえる。

3. `debug()` を Console から呼ぶとき `ReferenceError` になるのはどんなときか、対処は？
   ▶ 答え: 対象関数がスコープ外のとき。対象がスコープ内になる場所に line-of-code ブレークポイントを置いて停止させ、その状態で Console から `debug()` を呼べばよい。

4. フレームを Restart frame しても引数の値がリセットされないのはなぜか？
   ▶ 答え: フレーム restart は引数をリセットせず、実行ポインタを関数の先頭に戻すだけだから。呼び出し時の初期状態は復元されず、現在の引数値がメモリ上に残る。呼び出し元フレームを restart すると初期値に戻る。

5. source map が DevTools から取れず失敗する典型原因と、2 つの回避策は？
   ▶ 答え: 既定では DevTools 自身がリクエストするため cross-origin 扱いで弾かれるのが典型。回避策は (1) Developer Resources で `Enable loading through target` を有効にして Web サイト側にリクエストさせる、(2) `Add source map` で URL を手動指定する。

6. minified コードを元の 1 行表示に戻すにはどこを操作するか？
   ▶ 答え: Editor 左下隅の `{ }` をクリックする（pretty print の切り替え）。既定では minified ファイルは自動で pretty print される。

7. Local Overrides で `<img src=x onerror=1>` 相当をレスポンスに仕込む検証の利点は？
   ▶ 答え: 実サーバへ攻撃リクエストを一切送らずに、フロントエンドがその文字列を `innerHTML` などに流すか（DOM-based XSS が成立するか）をローカルで検証できる。サーバに副作用を出さない安全な確認手段。ただし source-mapped ファイルは override できない。

8. Network の横断検索で脆弱性ハンティングの一次スクリーニングをするとき、Sources の <kbd>Command</kbd>+<kbd>F</kbd> と何が違うか？
   ▶ 答え: Sources の <kbd>Command</kbd>+<kbd>F</kbd> は開いているファイル内のみ検索する。ドロワーの Search（<kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> / Mac は <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>F</kbd>）は読み込まれた全リソースを横断検索するので、`innerHTML` や `eval(` などを全 JS バンドルにまたがって洗い出せる。

9. Network フィルタ `mime-type:image/gif larger-than:1K` は何を表示し、この結合は AND か OR か？
   ▶ 答え: 1 キロバイトより大きい全 GIF を表示する。スペース区切りの複数プロパティは AND 演算と等価で、OR は現在サポートされていない。

10. `Copy as fetch` を診断で使う利点と注意点は？
    ▶ 答え: 認証済みセッションのリクエストをそのままブラウザ Console に貼って改変再送でき、CSRF 保護・CORS・パラメータ改変の影響を同一 origin 上で検証できる。注意点は Cookie や認証トークンを含むため、ログ出力や共有時に秘匿情報を漏らさないこと。

## 出典

- Debug JavaScript（基本 7 ステップ）— https://developer.chrome.com/docs/devtools/javascript/
- Pause your code with breakpoints（9 種のブレークポイント、Trusted Type / CSP Violation）— https://developer.chrome.com/docs/devtools/javascript/breakpoints/
- JavaScript debugging reference（ステッピング、Call Stack、Restart frame、pretty print）— https://developer.chrome.com/docs/devtools/javascript/reference/
- Debug your original code instead of deployed with source maps — https://developer.chrome.com/docs/devtools/javascript/source-maps/
- Developer Resources: View and manually load source maps — https://developer.chrome.com/docs/devtools/developer-resources
- Override web content and HTTP response headers locally — https://developer.chrome.com/docs/devtools/overrides/
- Edit and save files in a workspace — https://developer.chrome.com/docs/devtools/workspaces/
- Inspect network activity — https://developer.chrome.com/docs/devtools/network/
- Network features reference — https://developer.chrome.com/docs/devtools/network/reference/
- Ignore List — https://developer.chrome.com/docs/devtools/settings/ignore-list/
- Prevent DOM-based XSS with Trusted Types — https://web.dev/articles/trusted-types
- Implementing CSP and Trusted Types debugging in Chrome DevTools — https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems
- Trusted Types 仕様 — https://www.w3.org/TR/trusted-types/
- Source Map V3 仕様 — https://sourcemaps.info/spec.html
- x-google-ignoreList — https://developer.chrome.com/articles/x-google-ignore-list/
- DevTools Protocol RequestPattern（Local Overrides のワイルドカード）— https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#type-RequestPattern
- （取得できなかった担当記事）Chrome DevTools JavaScript Debugging Guide 2026 — https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/
- （取得できなかった担当記事）How to Debug JavaScript in Chrome（BrowserStack）— https://www.browserstack.com/guide/how-to-debug-js-in-chrome

<!-- sources: https://developer.chrome.com/docs/devtools/javascript/, https://developer.chrome.com/docs/devtools/javascript/breakpoints/, https://developer.chrome.com/docs/devtools/javascript/reference/, https://developer.chrome.com/docs/devtools/javascript/source-maps/, https://developer.chrome.com/docs/devtools/developer-resources, https://developer.chrome.com/docs/devtools/overrides/, https://developer.chrome.com/docs/devtools/workspaces/, https://developer.chrome.com/docs/devtools/network/, https://developer.chrome.com/docs/devtools/network/reference/, https://developer.chrome.com/docs/devtools/settings/ignore-list/, https://web.dev/articles/trusted-types, https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems, https://www.w3.org/TR/trusted-types/, https://sourcemaps.info/spec.html, https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#type-RequestPattern, https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/, https://www.browserstack.com/guide/how-to-debug-js-in-chrome -->
<!-- terms: Chrome DevTools, Sources パネル, ブレークポイント, Line-of-code ブレークポイント, Conditional ブレークポイント, Logpoint, DOM change ブレークポイント, XHR/fetch ブレークポイント, Event listener ブレークポイント, Exception ブレークポイント, Function ブレークポイント, debug(), Trusted Type ブレークポイント, CSP Violation Breakpoints, DOM-based XSS, source, sink, Trusted Types, Step over, Step into, Step out, Continue to here, Call Stack, Scope ペイン, Watch, Restart frame, Async Stack Tagging, source map, Developer Resources, Enable loading through target, Add source map, pretty print, Ignore List, Local Overrides, .headers ファイル, RequestPattern, Workspaces, Network パネル, Replay XHR, Request blocking, HAR, Copy as fetch, Copy as cURL, Preserve log, Disable cache, TTFB, initiator, CORS -->
<!-- self-read: https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/ | egress プロキシのポリシー拒否（CONNECT 403、web.archive.org も 403）で自動取得不可 -->
<!-- self-read: https://www.browserstack.com/guide/how-to-debug-js-in-chrome | egress プロキシのポリシー拒否（CONNECT 403、web.archive.org も 403）で自動取得不可 -->
