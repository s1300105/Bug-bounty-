# Chrome DevTools の Sources パネルで JavaScript を止めて読む

> **この節で分かること**
> - Sources パネルの3ペイン構成と、ブレークポイントが `console.log()` よりも速い理由を説明できる。
> - デモページのバグを再現し、Event Listener Breakpoint と行ブレークポイントで実行を止め、Scope / Watch / Console で変数の値を確認して、その場で修正するまでを自分でできる。
> - Step over / into / out、Continue to here、Resume、Force script execution といったステップ操作を使い分けられる。
> - Call Stack・Threads・Ignore List・ライブ編集など、リファレンスに載る主要機能の役割を説明できる。
> - 9種類のブレークポイント（行・条件付き・logpoint・DOM・XHR/fetch・イベントリスナ・例外・関数・Trusted Type）をいつ使うか選べる。
> - XHR/fetch ブレークポイント、DOM 変更ブレークポイント、Trusted Type ブレークポイントを、クライアントサイド脆弱性（とくに DOM XSS）の調査にどう使うかを説明できる。

**元資料**: https://developer.chrome.com/docs/devtools/javascript , https://developer.chrome.com/docs/devtools/javascript/reference , https://developer.chrome.com/docs/devtools/javascript/breakpoints （原典取得済み。ただし `developer.chrome.com` は執筆環境から遮断されており、同一内容を生成する公式リポジトリ GoogleChrome/developer.chrome.com の原稿 Markdown を取得した）
**関連する節**: ブレークポイント種類の応用・Console Utilities API・Local Overrides・source maps（本ノートの後半パート）

---

## 1. なぜデバッガを使うのか（設計意図）

### 1.1 「バグの場所を知らなくても止められる」道具

クライアントサイドの脆弱性を探すとき、いちばん知りたいのは「その値がどこで作られ、どこで危険な処理（DOM への書き込みや通信）に届くのか」である。ソースコードを上から読むだけでは追いきれない。

Chrome DevTools の **Sources パネル**とは、DevTools のなかで JavaScript をデバッグする画面のこと。実行を任意の地点で止め、その瞬間の全変数を観測できる中核 UI である。

原典（入門チュートリアル）は、従来よく使われる `console.log()` 挿入と比べてブレークポイントが優れる理由を明言している。要点は2つ。

- `console.log()` では、ソースコードを手で開き、該当コードを探し、`console.log()` 文を挿入し、ページをリロードして Console でメッセージを見る必要がある。**ブレークポイントなら、コードがどう構成されているか知らなくても関連コードで停止できる。**
- `console.log()` 文では検査したい値を明示的に一つずつ指定する必要がある。**ブレークポイントなら、その時点の全変数の値を DevTools が見せてくれる。自分が気付いていない変数がコードに影響していることもある。**

要するに、ブレークポイントは `console.log()` 方式よりも速くバグを発見・修正できる。脆弱性ハンティングでは「気付いていない変数」こそが攻撃経路であることが多く、この差は大きい。

### 1.2 ブレークポイント（breakpoint）とは

**ブレークポイント（breakpoint）**とは、コード実行を意図的に停止させる地点のこと。停止している間は、その瞬間の全変数値を検査でき、Console から任意の JavaScript を評価できる。たとえば「このリクエストが送られる直前の状態を見たい」といった観測ができる。

---

## 2. Sources パネルの3ペイン構成（どう動くのか）

DevTools は CSS 変更、ページ読み込みパフォーマンスのプロファイリング、ネットワークリクエストの監視など、タスクごとに多くのツールを提供する。そのなかで **Sources パネルは JavaScript をデバッグする場所**である。

### 2.1 DevTools を開いて Sources を選ぶ

1. **Command+Option+J（Mac）** または **Control+Shift+J（Windows, Linux）** を押して DevTools を開く。このショートカットは **Console** パネルを開く。
2. **Sources** タブをクリックする。

### 2.2 3つのペイン

Sources パネルの UI は3つのパートを持つ。

```
+------------------+---------------------------+--------------------------+
| File Navigator   |  Code Editor              | JavaScript Debugging     |
| (Page ペイン)     |  (選択したファイルの中身)     | (Breakpoints / Scope /   |
| 要求された全ファイル |  ここでコードを読み・編集する   |  Watch / Call Stack など) |
+------------------+---------------------------+--------------------------+
```

| ペイン | 役割 |
| --- | --- |
| File Navigator ペイン | ページが要求したすべてのファイルがここに列挙される |
| Code Editor ペイン | File Navigator でファイルを選ぶと、そのファイルの内容がここに表示される |
| JavaScript Debugging ペイン | ページの JavaScript を検査するための各種ツール群 |

**DevTools ウィンドウが広い場合、JavaScript Debugging ペインは Code Editor ペインの右側に表示される。** 幅が狭いと下や別の位置に折り返される。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Debug JavaScript（入門チュートリアル本体・図・動画）— https://developer.chrome.com/docs/devtools/javascript
> **なぜ**: 本教科書の執筆環境からは `developer.chrome.com` のライブ HTML を自動取得できなかった（理由: サイト側の egress 遮断。同一内容を生成する公式リポジトリの原稿 Markdown から本文・コード・手順を逐語で再構成している）。以下の記述は原稿ソースにもとづく要約であり、アイコン形状・画面配置の画像は含まれない。
> **読みどころ**:
> 1. Step into / Step over / Resume / Deactivate breakpoints の**アイコン形状**をスクリーンショットで確認する。本文だけではボタンの見た目が分からない。
> 2. 動画版（YouTube ID `H0XScE08hy8`）で7ステップの実演を見て、各ペインの位置関係を把握する。
> 3. デモページ https://googlechrome.github.io/devtools-samples/debug-js/get-started を実際に開き、`5 + 1 = 51` を再現して、自分の Chrome で `get-started.js` の行番号を確認する（行番号は版に依存する）。
> **代替手段**: デモページと動画は無料で公開されている。

---

## 3. 入門チュートリアル: バグを再現して直す7ステップ（手を動かす前提の全体像）

原典の入門チュートリアルは、1つのバグを題材に「再現 → UI 把握 → 停止 → ステップ → 行ブレークポイント → 値確認 → 修正」の7ステップを踏む。まず全体を追う。

### 3.1 Step 1: バグを再現する

原典は「**バグを一貫して再現する一連の操作を見つけることが、デバッグの常に最初のステップ**」と明言する。手順は次の通り。

1. デモ https://googlechrome.github.io/devtools-samples/debug-js/get-started を新しいタブで開く。
2. **Number 1** テキストボックスに `5` を入力する。
3. **Number 2** テキストボックスに `1` を入力する。
4. **Add Number 1 and Number 2** をクリックする。ボタン下のラベルが `5 + 1 = 51` と表示される。結果は `6` であるべき。これが修正対象のバグ。

〔補足〕文字列連結による `"5" + "1" === "51"` という典型的な型バグである。後段の Watch 式 `typeof sum` で正体が確定する流れになっている。

### 3.2 Step 2: Sources パネル UI に慣れる

前章の通り DevTools を開き **Sources** タブへ移動する。3ペイン構成をここで実物と照らし合わせておく。

### 3.3 Step 3: Event Listener Breakpoint で止める

まず「アプリの動作を一歩引いて考える」推論が示される。誤った合計（`5 + 1 = 51`）は **Add Number 1 and Number 2** ボタンに紐づく `click` イベントリスナ内で計算されていると推測できる。よって `click` リスナが実行される辺りでコードを停止したい。**Event Listener Breakpoints** がまさにそれを可能にする。

**イベントリスナブレークポイント（Event Listener Breakpoints）**とは、`click` など指定したイベントが発火した後に走るリスナのコードで自動的に止まる仕組みのこと。関数名を知らなくても「イベントの種類」だけで止められる。

設定手順は次の通り。

1. **JavaScript Debugging** ペインで **Event Listener Breakpoints** をクリックして展開する。**Animation** や **Clipboard** のようなカテゴリ一覧が出る。
2. **Mouse** カテゴリの隣の **Expand**（展開）をクリックする。**click** や **mousedown** の一覧が出る。
3. **click** チェックボックスをチェックする。これで**任意の**`click` リスナが実行されたときに停止する。
4. デモに戻り、再度 **Add Number 1 and Number 2** をクリックする。DevTools は次の行で停止する。

```js
function onClick() {
```

別の行で停止した場合は、正しい行で止まるまで **Resume Script Execution** を押す。

> **Note（原文の注記）**: 別の行で停止した場合、訪問する全ページで `click` リスナを登録するブラウザ拡張をインストールしている可能性がある。その拡張のリスナで止まっているのである。すべての拡張を無効化するシークレットモードのプライベート閲覧を使えば、毎回正しい行で止まることを確認できる。

原典は「**Event Listener Breakpoints は多くのブレークポイント種別のうちの一つに過ぎない。各種別をすべて覚える価値がある**」と締める。種類の詳細は本節 §6 で扱う。

〔補足〕拡張機能のリスナで止まる現象は、後述の Ignore List（`Add content scripts to ignore list`）でも回避できる。

### 3.4 Step 4: コードをステップ実行する

原典は「バグのよくある原因の一つは、スクリプトが**間違った順序**で実行されること」だと述べる。ステップ実行なら1行ずつ追える。

1. **Step into next function call**（次の関数呼び出しにステップイン）をクリックし、`onClick()` を1行ずつ進める。次の行がハイライトされる。

   ```js
   if (inputsAreEmpty()) {
   ```

2. **Step over next function call**（次の関数呼び出しをステップオーバー）をクリックする。`inputsAreEmpty()` にステップインせず実行する。数行スキップされるのは、`inputsAreEmpty()` が false に評価され `if` ブロックが実行されなかったからである。

原典は「バグはおそらく `updateLabel()` 関数のどこかにあると分かる。全行をステップせず、別種のブレークポイントで推定位置に近づける」と続ける。

### 3.5 Step 5: 行ブレークポイントを設定する

**行ブレークポイント（line-of-code breakpoint）**とは、行番号をクリックして置く最も一般的なブレークポイント。DevTools は常にその行の実行前に停止する。

1. `updateLabel()` の最後の行を見る。

   ```js
   label.textContent = addend1 + ' + ' + addend2 + ' = ' + sum;
   ```

2. コードの左に、この行の行番号 **32** が見える。**32** をクリックする。青いアイコンが置かれ、行ブレークポイントが有効になったことを示す。
3. **Resume script execution** をクリックする。スクリプトは32行目まで実行を続ける。**29・30・31行では、DevTools が `addend1`・`addend2`・`sum` の値を宣言の横にインライン表示する。**

### 3.6 Step 6: 変数の値を確認する

原典は「`addend1`・`addend2`・`sum` が**引用符で囲まれている**、つまり文字列だ。これがバグ原因の良い仮説」と述べる。値を調べる3つの方法が示される。

#### 3.6.1 Method 1: Scope ペイン

**Scope ペイン**とは、停止中に現在定義されている **local および global** 変数（該当すれば **closure** 変数も）と各値を表示する枠のこと。**値をダブルクリックすると編集できる。** 停止していないとき Scope ペインは空である。

#### 3.6.2 Method 2: Watch Expressions

**Watch Expressions（監視式）**とは、変数に限らず**任意の有効な JavaScript 式**の値を時間を通して監視する仕組みのこと。

1. **Watch** タブをクリックする。
2. **Add Expression**（式を追加）をクリックする。
3. `typeof sum` と入力する。
4. Enter を押す。DevTools は `typeof sum: "string"` と表示する。

```js
typeof sum
```

これで `sum` が数値であるべきところ文字列として評価されていることが確定する。

#### 3.6.3 Method 3: Console

Console では `console.log()` を見るだけでなく、**任意の JavaScript 文を評価**できる。停止中は、その地点でスコープ内にある変数を使って修正候補を試せる。

1. Console ドロワーが開いていなければ Escape で開く。
2. `parseInt(addend1) + parseInt(addend2)` と入力する。**これが動くのは、`addend1`・`addend2` がスコープ内にある行で停止しているからである。**
3. Enter を押す。DevTools は `6` を出力する。これが期待結果である。

```js
parseInt(addend1) + parseInt(addend2)
```

### 3.7 Step 7: 修正を適用する

**DevTools を離れずに UI 内で直接コードを編集できる。**

1. **Resume script execution** をクリックする。
2. **Code Editor** で31行目 `var sum = addend1 + addend2` を `var sum = parseInt(addend1) + parseInt(addend2)` に置き換える。
3. Command+S（Mac）または Control+S（Windows, Linux）で保存する。
4. **Deactivate breakpoints**（ブレークポイントを無効化）をクリックする。色が青に変わり、有効を示す。これが設定されている間、DevTools は設定済みの全ブレークポイントを無視する。
5. 異なる値でデモを試す。正しく計算するようになる。

```js
var sum = addend1 + addend2
```

```js
var sum = parseInt(addend1) + parseInt(addend2)
```

> **Caution（原文の警告）**: このワークフローは**ブラウザで動いているコードにのみ修正を適用する**。ページを訪れる全ユーザのコードは修正されない。そのためにはサーバ上のコードを修正するか、Workspaces でローカルソースに保存する必要がある。

> **Gotchas（原文）**: Chrome バージョン105以降、停止中の関数をライブ編集できる（§5.4）。

### 3.8 Next steps（原典の案内）

チュートリアルはブレークポイント設定方法を2つだけ示した。原典は他の方法として次を挙げる。

- **Conditional breakpoints**（条件が真のときだけ発火する条件付きブレークポイント）
- **Breakpoints on caught or uncaught exceptions**（捕捉／未捕捉の例外でのブレークポイント）
- **XHR breakpoints**（要求 URL が部分文字列に一致したとき発火）

---

## 4. コードのステップ実行（リファレンス）

停止したら、1つの式ずつステップ実行して制御フローとプロパティ値を途中で調査する。ここは DevTools のリファレンスが体系化している。

### 4.1 停止中に値を確認する（inline evaluation）

**実行が停止している間、デバッガは現在の関数内にあるすべての変数・定数・オブジェクトを、ブレークポイントまでの範囲で評価する。デバッガは対応する宣言の横に現在値をインライン表示する。** これを**インライン評価（inline evaluation）**と呼ぶ。加えて Console から評価済みの変数・定数・オブジェクトを照会できる。

> **Gotchas（原文）**: 停止中に現在の関数を再実行（restart）することも、ライブ編集することもできる。

### 4.2 ホバーでプロパティをプレビュー

停止している間、クラス名または関数名にホバーすると、そのプロパティをプレビューできる。

### 4.3 Step over / into / out

3つのステップ操作の違いを、原典のコード例で押さえる。

**Step over（ステップオーバー）**: 問題に関係しない関数を含む行で停止しているとき、その関数にステップインせずに実行する。

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

`A` で停止しているとき **Step over** を押すと、DevTools は `B` と `C` を実行し、`D` で停止する。

**Step into（ステップイン）**: 問題に関係する関数呼び出しを含む行で停止しているとき、その関数の内部へ入る。同じコードで `A` で停止して **Step into** を押すと、DevTools はこの行を実行し `B` で停止する。

**Step out（ステップアウト）**: 問題に関係しない関数の内部で停止しているとき、その関数の残りを実行して呼び出し元へ戻る。`getName()` の `A` で停止して **Step out** を押すと、残りの `B` を実行し、呼び出し元の `C`（`updateName(name)`）で停止する。

### 4.4 Continue to here（特定の行まで一気に実行）

長い関数で全行をステップするのは退屈である。もっと速い方法がある。**関心のあるコード行を右クリックして Continue to here を選ぶと、その地点まで全コードを実行してその行で停止する。**

〔補足〕ショートカットは Mac: `Command` を押しながら行をクリック、Win・Linux: `Control` を押しながら行をクリック。

### 4.5 Resume と Force script execution

**Resume Script Execution（`F8`）**: 一時停止後、次のブレークポイントがあればそこまで実行を再開する。

**Force script execution（強制再開）**: **すべてのブレークポイントを無視してスクリプト実行を強制再開するには、Resume Script Execution をクリックして長押し（click and hold）し、Force script execution を選ぶ。**

〔補足〕これは無限に発火するブレークポイント（毎フレーム走る `click`/`timer` 系や、アンチデバッグの `debugger` ループ）から抜け出す際に使う。原典スナップショットの表記は **Force script execution** である。攻撃対象サイトが `debugger` 文を連発してデバッグを妨害してくる場合、この機能や §6.10 の Ignore List が回避手段になる。

### 4.6 Threads（スレッドコンテキストの切り替え）

**Threads ペイン**とは、web worker / service worker のコンテキストを切り替える枠のこと。**青い矢印アイコン**が現在選択中のコンテキストを表す。メインスクリプトと service worker の両方でブレークポイントに停止しているとき、Threads ペインの service worker エントリをクリックすれば、そのコンテキストの local / global を見られる。

### 4.7 カンマ区切り式のステップ（minify 対策）

> **Gotchas（原文）**: **Chrome バージョン108以降、Debugger はセミコロン区切り（`;`）とカンマ区切り（`,`）の両方の式をステップ実行できる。**

配布コードは圧縮（minify）されており、複数の文がカンマでつながれる。原典の例。

```js
function foo() {}

function bar() {
  foo();
  foo();
  return 42;
}

bar();
```

minify されるとカンマ区切りの `foo(),foo(),42` になる。

```js
function foo(){}function bar(){return foo(),foo(),42}bar();
```

Debugger はこれも同様にステップする。原典いわく「**セミコロンが見えているなら、デバッグしているソースが minify されていても常にそこをステップできると期待してよい。**」実運用のバグバウンティでは対象 JS が必ず minify されているので、この挙動は重要である。

---

## 5. 値・スタック・ファイルツリー・エディタ

### 5.1 Scope ペイン（local / closure / global の表示と編集）

コード行で停止している間、**Scope** ペインで local・closure・global スコープのプロパティと変数を表示・編集できる。

- **プロパティ値をダブルクリックすると変更できる。**
- **列挙不可（Non-enumerable）なプロパティはグレー表示される。**

### 5.2 Call Stack（呼び出し履歴）

**Call Stack ペイン**とは、停止地点に至るまでの関数呼び出し履歴のこと。エントリをクリックすると、その関数が呼ばれたコード行にジャンプする。**青い矢印アイコン**が現在ハイライト中の関数を表す。停止していないとき Call Stack は空である。脆弱性調査では「危険な処理を、誰が、どこから呼んだか」を遡るのに使う。

#### 5.2.1 Restart frame（フレームの再実行）

デバッグフロー全体を再開せずに、コールスタック内の単一関数フレームだけを再実行できる。Call Stack ペインで関数を右クリックし **Restart frame** を選ぶ。

> **Note（原文）**: 任意の関数フレームを restart できる。**ただし WebAssembly、async、generator 関数は除く。**

原典の題材コード。

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

このコードを snippet として実行すると `debugger` の行ブレークポイントで停止する。`bar()` フレームを restart して `F9` で値インクリメント文をステップすると `value` は増え続ける。

> **Gotchas（原文）**: なぜ値が `0` にリセットされないのか？ — **フレームの restart は引数をリセットしない。restart は関数呼び出し時の初期状態を復元せず、単に実行ポインタを関数先頭に移すだけである。**

次に `foo()` フレームを restart すると値は `0` に戻る。

> **Gotchas（原文）**: なぜ `0` に戻るのか？ — **JavaScript では引数への変更は関数の外から見えない。ネストされた関数は値を受け取るのであり、メモリ上の位置を受け取るのではない。**

> **Caution（原文）**: 停止中に**プログラム的にコールスタックフレームの順序を変更しないこと。予期しないエラーを引き起こす。**

#### 5.2.2 Show ignore-listed frames（無視リストのフレームを表示）

既定では Call Stack は自分のコードのフレームのみ表示し、**Settings > Ignore List** に追加したスクリプトは省略する。サードパーティを含む完全なスタックを見るには、Call Stack セクション下の **Show ignore-listed frames** を有効にする。

#### 5.2.3 View async frames（非同期フレーム）

フレームワークが対応していれば、DevTools は async コードの両方の部分をリンクして追跡し、Call Stack に**async 呼び出しフレームを含む完全な呼び出し履歴**を表示する。

> **Gotchas（原文）**: DevTools はこの "Async Stack Tagging" 機能を `console.createTask()` API に基づいて実装している。API の実装はフレームワーク側に委ねられ、たとえば Angular は対応している。

〔補足〕関連設定として **Settings > Debugger** に `Disable async stack traces`（非同期処理の全体像を隠す）がある。

#### 5.2.4 Copy stack trace

Call Stack ペインの任意の場所を右クリックして **Copy stack trace** を選ぶと、現在のスタックをクリップボードにコピーする。出力例。

```js
getNumber1 (get-started.js:35)
inputsAreEmpty (get-started.js:22)
onClick (get-started.js:15)
```

### 5.3 ファイルツリー（Authored / Deployed）

Page ペインでファイルツリーを操作する。フレームワーク（React・Angular 等）とビルドツール（webpack・Vite 等）が生成した minify ファイルは探索が難しい。**Chrome バージョン104**からの実験的機能で、ファイルを2カテゴリにグループ化できる。

| カテゴリ | 意味 |
| --- | --- |
| Authored（著者コード） | IDE で見るソースに近い。**DevTools が source maps に基づいて生成する。** |
| Deployed（デプロイ済み） | **ブラウザが実際に読むファイル。通常 minify されている。** |

ファイルツリー上部の三点メニューから **Group files by Authored/Deployed**（実験的）を有効にする。**Chrome バージョン106**からは、三点メニュー > **Hide ignore-listed sources**（実験的）で無視リストのスクリプトを完全に隠せる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: JavaScript debugging reference（デバッグ機能の網羅的リファレンス）— https://developer.chrome.com/docs/devtools/javascript/reference
> **なぜ**: 本教科書の執筆環境からライブ HTML を自動取得できなかった（理由: サイト側の egress 遮断。取得できた公式原稿は `updated: 2022-11-29` のスナップショットである）。以下の記述はそのスナップショットにもとづく。
> **読みどころ**:
> 1. 目次で「Debug JavaScript with VS Code」に相当する項目を探す。取得できたスナップショットには存在しないが、ライブ版に後から追加された可能性がある（本教科書は捏造を避け内容を記載していない）。
> 2. 「Chrome 104 / 105 / 106 / 108」と紐づく実験的機能が、正式機能へ昇格していないか Note / Aside を確認する。
> 3. **Force script execution** の現行 UI 名・**Breakpoints ペイン**のセクション並び（CSP Violation / XHR-fetch / Event Listener / DOM / Global Listeners）を実物で確認する。版により変わる。
> **代替手段**: なし（公式ドキュメントが一次情報）。

### 5.4 Editor でのライブ編集

Page ペインでスクリプトを開くと **Editor** ペインに内容が表示され、閲覧・編集できる。

**minify ファイルを読めるようにする**: 既定で Sources は minify ファイルを pretty-print する。読み込まれたままの姿を見るには **Editor 左下隅の `{ }`** をクリックする。

**コードブロックの折りたたみ**: 行番号にホバーして **Collapse**、展開は横の **`{...}`**。

**スクリプトを編集する**: Editor で変更して Command/Ctrl+S で保存する。**DevTools は JS ファイル全体を Chrome の JavaScript エンジンにパッチする。**

**停止中の関数をライブ編集（Chrome バージョン105以降）**: 停止中に現在の関数を編集して変更をライブ適用できる。制限は2つ。

- **Call Stack の最上位（top-most）関数のみ編集できる。**
- **スタックのさらに下に同じ関数への再帰呼び出しがあってはならない。**

> **Gotchas（原文）**: 変更を適用するとデバッガは関数を自動 restart する。したがって restart の制限（WebAssembly・async・generator は不可）も適用される。

**検索と置換**: Editor でファイルを開き Command/Ctrl+F で検索バーを開く。**Match Case**（大文字小文字区別）、**Use Regular Expression**（正規表現）を切り替えられる。置換は検索バーの **Replace** ボタンから **Replace** / **Replace all**。

### 5.5 Snippets・Watch・Disable JavaScript

**Snippets**とは、自分で作成し DevTools 内に保存して任意のページで実行できる実行可能スクリプトのこと。Console で同じデバッグコードを何度も実行しているなら Snippets にまとめる。

**Watch** ペインではカスタム式の値を監視する。**Add Expression** で追加、**Refresh** で更新（コードをステップ中は自動更新）、ホバーして **Delete Expression** で削除。

**Disable JavaScript** は、JavaScript を無効化してページの挙動を確認する機能（詳細設定は別ページ）。

---

## 6. ブレークポイント9種類（どれをいつ使うか）

行ブレークポイントは有名だが、どこを見るべきか分からない場合や大規模コードでは非効率になりうる。原典は「他の種類のブレークポイントをいつどう使うか知ることで、デバッグ時間を節約できる」と述べる。まず一覧を押さえる。

| Breakpoint Type（種類） | こうしたいとき |
| --- | --- |
| Line-of-code（行） | コードの正確な領域で停止したい |
| Conditional line-of-code（条件付き行） | 正確な領域で、かつ他の条件が真のときだけ停止したい |
| Logpoint | 実行を止めずに Console にメッセージを出したい |
| DOM | 特定 DOM ノードまたはその子を変更・削除するコードで停止したい |
| XHR | XHR の URL が文字列パターンを含むときに停止したい |
| Event listener | `click` などのイベント発火後に走るコードで停止したい |
| Exception | 捕捉/未捕捉の例外を投げている行で停止したい |
| Function | 特定の関数が呼ばれるたびに停止したい |
| Trusted Type | Trusted Type 違反で停止したい |

### 6.1 行ブレークポイント（line-of-code）

調査すべき領域が正確に分かっているとき使う。**DevTools は常にその行が実行される前に停止する。**

1. **Sources** タブをクリックする。
2. 対象の行を含むファイルを開き、その行に移動する。
3. 行の左の**行番号列をクリックする。青いアイコンが現れる。**

#### 6.1.1 コード中の `debugger` 文

コードから `debugger` を呼ぶと、その行で停止する。**これは行ブレークポイントと等価だが、DevTools UI ではなくコード中に設定される点が異なる。**

```js
console.log('a');
console.log('b');
debugger;
console.log('c');
```

### 6.2 条件付き行ブレークポイント（conditional）

ある条件が真のときだけ止めたい場合に使う。**とくにループ内で、無関係な停止を飛ばしたいとき有用。**

1. **Sources** タブを開き、対象行を含むファイルを開いてその行へ移動する。
2. 行番号列を**右クリック**する。
3. **Add conditional breakpoint** を選ぶ。
4. ダイアログに条件を入力する。
5. Enter を押す。**行番号列の上に、疑問符付きのオレンジ色のアイコンが現れる。**

### 6.3 Logpoint（logpoint）

**logpoint**とは、実行を止めず、また `console.log()` でコードを散らかさずに Console にメッセージを出力する仕組みのこと。

1. **Sources** タブを開き、対象行へ移動する。
2. 行番号列を右クリックし **Add logpoint** を選ぶ。
3. ログメッセージを入力する。`console.log(message)` と同じ構文が使える。

   ```js
   "A string " + num, str.length > 1, str.toUpperCase(), obj
   ```

   ログされる内容の例。

   ```js
   // str = "test"
   // num = 3
   // obj = {attr: "x"}
   A string 42 true TEST {attr: 'x'}
   ```

4. Enter を押す。**行番号列の上に、2つのドットを持つピンク色のアイコンが現れる。**

### 6.4 行ブレークポイントの編集（Breakpoints ペイン）

**Breakpoints ペイン**はブレークポイントを**ファイル単位でグループ化**し、行番号・列番号順に並べる。グループ操作は次の通り。

- 名前クリックで折りたたみ／展開。
- 隣のチェックボックスで有効／無効。
- ホバーして閉じるアイコンで削除。

無効化すると、Sources パネルは行番号隣のマーカーを**半透明**にする。グループの右クリックメニューには「ファイル内の全削除／無効化／有効化」「全ファイルの全削除」「他グループの削除」がある。個別のブレークポイントは、編集中に**インラインエディタのドロップダウンで種類（type）を変更できる**。右クリックメニューには「削除」「条件または logpoint を編集」「位置を表示」などがある。

### 6.5 DOM 変更ブレークポイント（DOM）★脆弱性調査で重要

**DOM 変更ブレークポイント**とは、指定した DOM ノードやその子を変更・削除したコードで止まる仕組みのこと。「どの JS がこの要素を書き換えたのか」を突き止められる。

1. **Elements** タブをクリックする。
2. 対象要素へ移動して右クリックする。
3. **Break on** にホバーし、**Subtree modifications**・**Attribute modifications**・**Node removal** のいずれかを選ぶ。

一覧は **Elements > DOM Breakpoints** または **Sources > DOM Breakpoints** サイドペインで確認でき、チェックボックスで有効/無効、右クリックで **Remove** / **Reveal** できる。

種類の違い。

| 種類 | 発火条件 |
| --- | --- |
| Subtree modifications | **選択ノードの子が追加・削除、または子の内容が変更されたとき**。子ノードの属性変更や、選択ノード自身への変更では発火しない |
| Attributes modifications | **選択ノードで属性が追加・削除、または属性値が変化したとき** |
| Node Removal | **選択ノードが削除されたとき** |

〔攻撃観点〕ある要素に注入した文字列が実際に DOM へ書き込まれるかを追うとき、Subtree modifications を仕掛けておくと `.innerHTML` などで書き換えたコードで停止でき、source から sink までの経路を特定できる。

### 6.6 XHR/fetch ブレークポイント（XHR）★脆弱性調査で重要

**XHR の要求 URL が指定した文字列を含むときに停止したい**場合に使う。**DevTools は XHR が `send()` を呼ぶコード行で停止する。** 役立つ例は「ページが不正な URL を要求していると分かり、その不正リクエストを引き起こす AJAX / Fetch のソースを素早く見つけたいとき」である。

1. **Sources** タブをクリックする。
2. **XHR Breakpoints** ペインを展開する。
3. **Add breakpoint** をクリックする。
4. **停止したい文字列を入力する。DevTools は、その文字列が XHR の要求 URL のどこかにあるとき停止する。**
5. Enter で確定する。

〔攻撃観点〕たとえば URL に `org` を含む任意のリクエストで止められる。SSRF や不正リダイレクトの起点となる URL 組み立て箇所、API キーの送信箇所などを、通信の直前で捕まえられる。

### 6.7 イベントリスナブレークポイント（Event listener）

**イベント発火後に走るリスナのコードで止めたい**ときに使う。`click` のような特定イベントでも、マウスイベント全体のような**カテゴリ**でも指定できる。

1. **Sources** タブをクリックする。
2. **Event Listener Breakpoints** ペインを展開する。
3. カテゴリをチェックするとそのカテゴリの任意イベントで停止する。またはカテゴリを展開して特定イベントをチェックする。

加えて **Elements > Event Listeners** ペインでリスナ一覧を確認できる。

### 6.8 例外ブレークポイント（Exception）

**捕捉された（caught）または捕捉されない（uncaught）例外を投げている行で止めたい**ときに使う。Node.js 以外の任意のセッションでは両方の例外で独立に停止できる。**Sources** の **Breakpoints** ペインで **Pause on uncaught exceptions** / **Pause on caught exceptions** を有効にする。

> **Gotchas（原文）**: 現在 Node.js のセッションでは、**uncaught 例外でも停止する設定にしている場合のみ caught 例外で停止できる**（Chromium bug #1382762）。

### 6.9 関数ブレークポイント（Function）

**特定の関数が呼ばれるたびに止めたい**ときは、Console から `debug(functionName)` を呼ぶ。**`debug()` は関数の最初の行に行ブレークポイントを設定するのと等価。**

```js
function sum(a, b) {
  let result = a + b; // DevTools pauses on this line.
  return result;
}
debug(sum); // Pass the function object, not a string.
sum();
```

対象関数がスコープ内にないと DevTools は `ReferenceError` を投げる。

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

Console から `debug()` を呼ぶ場合、スコープ内であることを保証する戦略は次の通り。

1. 関数がスコープ内にあるどこかに行ブレークポイントを設定する。
2. そのブレークポイントを発火させる。
3. **行ブレークポイントで停止している間に** Console で `debug()` を呼ぶ。

### 6.10 Trusted Type ブレークポイント（Trusted Type）★DOM XSS 調査に直結

**Trusted Type API** は、cross-site scripting（XSS）攻撃からの保護を提供する仕組み。DevTools はその**違反**で実行を止められる。

> **Key term（原文の用語定義）**: **DOM ベースの cross-site scripting は、ユーザが制御できる *source*（ユーザ名や、URL フラグメントから取った redirect URL など）のデータが、*sink*（`eval()` のような関数や `.innerHTML` のようなプロパティ setter で、任意の JavaScript コードを実行できるもの）に到達したときに発生する。**

つまり **DOM XSS** の本質は「source から sink へ、汚染データが検証なしに流れる」ことである。Trusted Type ブレークポイントはこの sink 到達地点で止められる。

**Sources** の **Breakpoints** ペインで **CSP Violation Breakpoints** セクションへ行き、次を有効にする。

| チェック項目 | 止まるタイミング |
| --- | --- |
| Sink Violations | sink 違反で実行が停止する |
| Policy Violations | policy 違反で停止する（Trusted Type ポリシーは `trustedTypes.createPolicy` で設定） |

〔守り方〕Trusted Types を導入すると、`.innerHTML` などの危険な sink へ生文字列を渡せなくなり、DOM XSS の作り込みを構造的に防げる。攻撃者視点では sink で止めて経路を確認し、防御者視点では Trusted Types と CSP で sink を封じる、という表裏の関係になる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Pause your code with breakpoints（ブレークポイント全種の一覧と Trusted Type / CSP Violation Breakpoints）— https://developer.chrome.com/docs/devtools/javascript/breakpoints ／ Trusted Types による DOM XSS 対策 — https://web.dev/articles/trusted-types
> **なぜ**: `developer.chrome.com` は執筆環境から自動取得できず（サイト側の egress 遮断）、公式リポジトリ原稿から再構成した。`web.dev` の記事本体も同様に本文全体は取得していない。以下は原稿と原典が参照する断片にもとづく要約である。
> **読みどころ**:
> 1. breakpoints ページの**種類一覧表**と、Sink Violations / Policy Violations の設定位置を実物で確認する。DOM XSS 調査の起点になる。
> 2. `web.dev/articles/trusted-types` で、source → sink の流れを Trusted Types でどう遮断するか、`trustedTypes.createPolicy` の使い方を読む。
> 3. `/blog/csp-issues/#debugging-trusted-types-problems` で、DevTools 上での CSP / Trusted Types デバッグ手順を読む。
> **代替手段**: OWASP の XSS 解説 https://owasp.org/www-community/attacks/xss/ 、MDN の Trusted Types API https://developer.mozilla.org/docs/Web/API/Trusted_Types_API 。

---

## 手を動かす

1. Chrome でデモ https://googlechrome.github.io/devtools-samples/debug-js/get-started を開く。
2. **Number 1** に `5`、**Number 2** に `1` を入れて **Add Number 1 and Number 2** をクリックし、`5 + 1 = 51` を再現する。
3. Command+Option+J（Mac）／ Control+Shift+J（Win, Linux）で DevTools を開き、**Sources** タブへ移動する。3ペイン（File Navigator / Code Editor / JavaScript Debugging）を目で確認する。
4. **JavaScript Debugging** ペインで **Event Listener Breakpoints > Mouse > click** をチェックする。もう一度ボタンを押すと `function onClick() {` で停止する。別の行で止まったらシークレットモードで拡張を無効化して試す。
5. **Step into**／**Step over** を数回押して制御フローを追う。`updateLabel()` に当たりを付ける。
6. `label.textContent = ...` の行の**行番号をクリック**して行ブレークポイントを置き、**Resume**（`F8`）で再度到達させる。29〜31行の変数がインライン表示されるのを見る。
7. **Scope** で値を見る（引用符付き＝文字列）。**Watch** に `typeof sum` を追加して `"string"` を確認する。**Console** で `parseInt(addend1) + parseInt(addend2)` を評価して `6` を得る。
8. Code Editor で `var sum = addend1 + addend2` を `var sum = parseInt(addend1) + parseInt(addend2)` に書き換え、Command/Ctrl+S で保存し、**Deactivate breakpoints** を押して動作を確認する。
9. 応用: **XHR Breakpoints** に対象サイトが要求する URL の一部（例: `org`）を入れて `send()` の直前で止め、Call Stack でリクエスト組み立て箇所を遡る。
10. 応用: **Elements** で疑わしい要素を右クリック > **Break on > Subtree modifications** を仕掛け、注入文字列が `.innerHTML` に届く sink を特定する。
11. 応用: **Breakpoints ペイン > CSP Violation Breakpoints** で **Sink Violations** を有効にし、Trusted Types 環境で DOM XSS の sink 到達を捕まえる。

---

## つまずきポイント

- **Scope ペインが空**: コード行で停止していないと Scope も Call Stack も空になる。まずブレークポイントで止めること。
- **click で止まるが自分のコードでない**: ブラウザ拡張が全ページに `click` リスナを登録していることがある。シークレットモードか Ignore List（`Add content scripts to ignore list`）で回避する。
- **`debug(fn)` が `ReferenceError`**: 対象関数がスコープ外。関数がスコープ内に入る行で先に止めてから、停止中に Console で `debug()` を呼ぶ。
- **Force script execution と Resume の混同**: Resume（`F8`）は次のブレークポイントで再び止まる。全部無視して抜けたいときは Resume を長押しして **Force script execution**。アンチデバッグの `debugger` ループ対策にも使う。
- **restart frame で値が0に戻らない／戻る**: restart は引数をリセットしない。ただし呼び出し元フレームを restart すると、引数は値渡しなので初期値に戻る。混乱しやすいので原典の Gotchas を確認する。
- **修正が全ユーザに効くと誤解する**: Editor 編集はブラウザ内のコードにのみ効く。恒久修正はサーバ側か Workspaces が必要。
- **minify コードが読めない**: Editor 左下の `{ }` で pretty-print する。ステップ挙動は minify されていてもセミコロン単位で追える（Chrome 108以降はカンマ区切りも）。
- **バージョン依存機能**: Authored/Deployed グルーピング（Chrome 104）、ライブ編集（105）、ignore-listed sources 非表示（106）、カンマ区切りステップ（108）は版に依存する。ライブ版で昇格状況を確認する。

---

## この節のまとめ

- Sources パネルは File Navigator / Code Editor / JavaScript Debugging の3ペインで構成され、JavaScript をデバッグする中核 UI である。
- ブレークポイントは `console.log()` に優る。コード構造を知らなくても止められ、その時点の全変数が自動で見えるからである。
- 入門チュートリアルは「再現 → UI 把握 → Event Listener Breakpoint → ステップ → 行ブレークポイント → 値確認 → 修正」の7ステップを踏む。
- バグ再現は常にデバッグの第一歩である。デモの `5 + 1 = 51` は文字列連結による型バグで、`typeof sum` が `"string"` を返すことで確定する。
- 停止中は inline evaluation で宣言横に現在値が出る。値は Scope（編集可）・Watch（任意式）・Console（任意文の評価）の3方法で確認する。
- ステップ操作は Step over（入らず実行）／Step into（内部へ）／Step out（残りを実行し戻る）／Continue to here（指定行まで一気に）を使い分ける。
- Resume（`F8`）は次のブレークポイントまで、Force script execution は全ブレークポイントを無視して再開する。
- Call Stack は呼び出し履歴を辿る道具で、Restart frame（引数はリセットしない）、Show ignore-listed frames、async frames、Copy stack trace を備える。
- ファイルツリーは Authored（source maps から復元した著者コード）と Deployed（ブラウザが読む minify コード）に分けられる。
- Editor では pretty-print、折りたたみ、編集・保存、停止中関数のライブ編集（最上位関数のみ・再帰不可）、検索置換（正規表現可）ができる。
- ブレークポイントは9種類（行・条件付き・logpoint・DOM・XHR/fetch・イベントリスナ・例外・関数・Trusted Type）ある。
- 脆弱性調査では、XHR/fetch ブレークポイント（`send()` 直前で停止）、DOM 変更ブレークポイント（sink となる DOM 書き換えを特定）、Trusted Type ブレークポイント（sink / policy 違反で停止）が特に重要である。
- DOM XSS は「ユーザ制御の source が、`.innerHTML` や `eval()` のような sink に到達する」ときに起こる。Trusted Types と CSP でこの sink を封じるのが守り方である。

---

## 理解度チェック

1. ブレークポイントが `console.log()` より速い理由を2つ挙げよ。
   ▶ 答え: (1) コードがどう構成されているか知らなくても関連コードで停止できる。(2) その時点の全変数の値を DevTools が自動で見せてくれる（気付いていない変数の影響も分かる）。

2. Sources パネルの3ペインの名前と役割を答えよ。
   ▶ 答え: File Navigator（要求された全ファイルを列挙）、Code Editor（選択ファイルの内容表示・編集）、JavaScript Debugging（Breakpoints / Scope / Watch / Call Stack などの検査ツール群）。

3. Step over と Step into の違いは何か。
   ▶ 答え: Step over は現在行の関数にステップインせずに実行して次の行へ進む。Step into はその関数の内部へ入る。問題に関係しない関数は over、関係する関数は into で調べる。

4. Resume と Force script execution の使い分けを述べよ。
   ▶ 答え: Resume（`F8`）は次のブレークポイントまで実行し、そこで再び止まる。Force script execution は Resume を長押しして選び、全ブレークポイントを無視して再開する。無限に発火するブレークポイントやアンチデバッグの `debugger` ループから抜けるときに使う。

5. `bar()` フレームを restart しても値が0に戻らないのに、`foo()` フレームを restart すると戻るのはなぜか。
   ▶ 答え: restart は引数をリセットせず実行ポインタを関数先頭に移すだけなので、同じフレームの restart では現在の引数値がメモリに残る。一方 JavaScript の引数は値渡しで、内側の変更は呼び出し元に反映されないため、呼び出し元 `foo()` を restart すると初期値0に戻る。

6. XHR/fetch ブレークポイントは何を入力し、どの行で止まるか。脆弱性調査での使いどころは。
   ▶ 答え: 要求 URL に含まれる文字列を入力し、その文字列を URL のどこかに含む XHR が `send()` を呼ぶ行で止まる。不正な URL を組み立てている AJAX / Fetch のソースを素早く見つけるのに使う。

7. DOM ベース XSS における source と sink とは何か。例を挙げよ。
   ▶ 答え: source はユーザが制御できる入力（ユーザ名、URL フラグメント由来の redirect URL など）。sink は `eval()` のような関数や `.innerHTML` のようなプロパティ setter で、任意 JavaScript を実行できるもの。source の汚染データが sink に到達すると DOM XSS が発生する。

8. Trusted Type ブレークポイントを設定する場所と、2つのチェック項目を答えよ。
   ▶ 答え: Sources の Breakpoints ペインの **CSP Violation Breakpoints** セクション。**Sink Violations**（sink 違反で停止）と **Policy Violations**（policy 違反で停止）。

9. 停止中の関数をライブ編集するときの2つの制限は何か。
   ▶ 答え: (1) Call Stack の最上位（top-most）関数のみ編集できる。(2) スタックのさらに下に同じ関数への再帰呼び出しがあってはならない。加えて変更適用時に関数が自動 restart されるため、WebAssembly / async / generator は編集できない。

10. minify されたコードを Editor で読みやすくする方法と、ステップ実行の保証を述べよ。
    ▶ 答え: Editor 左下隅の `{ }` をクリックして pretty-print する。Chrome 108以降はセミコロン・カンマ区切りの両方をステップでき、「セミコロンが見えていればソースが minify されていてもそこをステップできる」と期待してよい。

---

## 出典

- https://developer.chrome.com/docs/devtools/javascript
- https://developer.chrome.com/docs/devtools/javascript/reference
- https://developer.chrome.com/docs/devtools/javascript/breakpoints
- https://googlechrome.github.io/devtools-samples/debug-js/get-started
- https://web.dev/articles/trusted-types
- https://owasp.org/www-community/attacks/xss/
- https://developer.mozilla.org/docs/Web/API/Trusted_Types_API

<!-- sources: https://developer.chrome.com/docs/devtools/javascript, https://developer.chrome.com/docs/devtools/javascript/reference, https://developer.chrome.com/docs/devtools/javascript/breakpoints, https://googlechrome.github.io/devtools-samples/debug-js/get-started, https://web.dev/articles/trusted-types -->
<!-- terms: Sources panel, breakpoint, line-of-code breakpoint, conditional breakpoint, logpoint, DOM change breakpoint, XHR/fetch breakpoint, Event Listener Breakpoints, exception breakpoint, function breakpoint, Trusted Type breakpoint, CSP Violation Breakpoints, source (DOM XSS), sink (DOM XSS), Step over, Step into, Step out, Continue to here, Resume Script Execution, Force script execution, Threads pane, Scope pane, Watch Expressions, Call Stack pane, Restart frame, inline evaluation, Authored/Deployed, live edit, debug() -->
<!-- self-read: https://developer.chrome.com/docs/devtools/javascript | サイト側のegress遮断で自動取得できず原稿ソースから再構成。アイコン形状・図・動画は原典で確認が必要 -->
<!-- self-read: https://developer.chrome.com/docs/devtools/javascript/reference | サイト側のegress遮断。取得スナップショットはupdated 2022-11-29でありバージョン依存機能とVS Code節の有無をライブ版で確認する必要がある -->
<!-- self-read: https://developer.chrome.com/docs/devtools/javascript/breakpoints | サイト側のegress遮断。web.dev/trusted-types本文も未取得。DOM XSS調査の起点となる種類一覧とTrusted Type設定を原典で確認する必要がある -->
