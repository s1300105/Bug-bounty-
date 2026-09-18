# [30] Chrome DevTools 実践デバッグ大全 — ブレークポイント / source map / Local Overrides / Network / Performance / Memory / Console ユーティリティ

担当ID: 30 (devtools-practical) / 想定章: ch05

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/ | **failed** | WebFetch → `EGRESS_BLOCKED`、curl → `CONNECT tunnel failed, response 403` | 組織の egress ポリシーで `devplaybook.cc` が全面ブロック。web.archive.org も同じく 403 でスナップショット取得不可。WebSearch は本セッションの検索予算（200/200）を消費済みで代替検索も不可 |
| https://www.browserstack.com/guide/how-to-debug-js-in-chrome | **failed** | WebFetch → `EGRESS_BLOCKED`、curl → `CONNECT tunnel failed, response 403` | 同上。`www.browserstack.com` もブロック |
| （代替1）https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/docs/devtools/javascript/index.md | full | curl (raw.githubusercontent.com) | 公開先: https://developer.chrome.com/docs/devtools/javascript/ |
| （代替2）.../site/en/docs/devtools/javascript/breakpoints/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/javascript/breakpoints/ |
| （代替3）.../site/en/docs/devtools/javascript/reference/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/javascript/reference/ |
| （代替4）.../site/en/docs/devtools/javascript/source-maps/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/javascript/source-maps/ |
| （代替5）.../site/en/docs/devtools/developer-resources/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/developer-resources |
| （代替6）.../site/en/docs/devtools/overrides/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/overrides/ |
| （代替7）.../site/en/docs/devtools/workspaces/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/workspaces/ |
| （代替8）.../site/en/docs/devtools/console/api/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/console/api/ |
| （代替9）.../site/en/docs/devtools/console/utilities/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/console/utilities/ |
| （代替10）.../site/en/docs/devtools/javascript/snippets/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/javascript/snippets/ |
| （代替11）.../site/en/docs/devtools/network/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/network/ |
| （代替12）.../site/en/docs/devtools/network/reference/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/network/reference/ |
| （代替13）.../site/en/docs/devtools/performance/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/performance/ |
| （代替14）.../site/en/docs/devtools/memory-problems/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/memory-problems/ |
| （代替15）.../site/en/docs/devtools/settings/ignore-list/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/settings/ignore-list/ |
| （代替16）.../site/en/docs/devtools/shortcuts/index.md | full | curl | 公開先: https://developer.chrome.com/docs/devtools/shortcuts/ |

> **担当URLはいずれも取得できなかったため、本ノートの詳細は一次情報（Chrome DevTools 公式ドキュメントのリポジトリ `GoogleChrome/developer.chrome.com` の Markdown ソース）で全面的に補完した。**
> 担当URL 2 本は一般向け解説記事（二次情報）であり、その扱う題材（デバッグ手順、source map、Local Overrides、pretty print、Network 条件付きブレーク、Performance/Memory、Console ユーティリティ）は上記公式ドキュメントが原典にあたる。したがって本ノートは「二次情報の要約」ではなく「原典による代替取得」である。ただし担当URL固有の文章・独自図解・2026年時点の最新UI記述は失われている（→「## 読者が自分で開くべき資料」参照）。

## 要約

- Chrome DevTools の JavaScript デバッグは **Sources パネル**が中心で、UI は「File Navigator ペイン」「Code Editor ペイン」「JavaScript Debugging ペイン」の 3 部構成。
- ブレークポイントは 9 種類（line-of-code / conditional line-of-code / logpoint / DOM / XHR / event listener / exception / function / Trusted Type）。用途別に使い分けることが最短経路。**Trusted Type ブレークポイント（CSP Violation Breakpoints）は DOM-based XSS の sink 到達を実行時に捕まえる機能**で、クライアントサイド脆弱性診断に直結する。
- source map は `Settings > Preferences > Sources > Enable JavaScript source maps` で有効化。読み込み成否は **Developer Resources** ドロワータブの `Status` / `Error` 列で確認し、失敗時は `Add source map` で URL を手動指定できる。CORS で取れない場合は `Enable loading through target` を有効化。
- minified コードは Sources の Editor が**既定で pretty print** する。元の 1 行表示に戻すには Editor 左下の `{ }` をクリック。Chrome 108 以降はカンマ区切り式（`foo(),foo(),42`）もステップ実行できる。
- **Local Overrides** はレスポンス本文と HTTP レスポンスヘッダをローカルの改変版で差し替える機能。Network パネルでリクエストを右クリック → `Override content` / `Override headers`。`.headers` ファイルでワイルドカード（`*` = 複数文字、`?` = 1文字）によるルール適用も可能。**source-mapped ファイルは override できない**。
- Network 側の「条件付きブレーク」に相当するのは **XHR/fetch ブレークポイント**（URL 部分文字列一致で `send()` 行に停止）と **Request blocking**（Command Menu → `Show Request Blocking` → パターン追加）、および `Replay XHR`（<kbd>R</kbd>）。
- Console ユーティリティ API（Console からのみ動作）に `monitorEvents()` / `queryObjects()` / `getEventListeners()` / `debug()` / `table()` / `dir()` / `$x()` / `$$()` / `copy()` など。`queryObjects(HTMLElement)` や `getEventListeners(document)` は「どこからリスナが張られているか」「どのオブジェクトが生きているか」の実行時棚卸しに使える。
- Performance パネルは CPU throttling（2x / 20x slowdown）＋ Screenshots ＋ Memory チェックで記録。FPS / CPU / NET チャート、Main のフレームチャート、赤い三角（警告）、Summary の `reveal` リンクと `app.js:NN` リンクで原因行へ飛ぶ。
- Memory は Chrome Task Manager（<kbd>Shift</kbd>+<kbd>Esc</kbd>、`JavaScript memory` 列）→ Performance の Memory 記録 → Heap Snapshot（`Detached` でクラスフィルタ）→ Allocation Timeline / Allocation Sampling の順で切り分ける。

---

## 詳細ノート

### 1. デバッグの基本ワークフロー（7ステップ） （出典: https://developer.chrome.com/docs/devtools/javascript/ ／取得は raw.githubusercontent.com 経由）

公式チュートリアルは「5 + 1 = 51」になるバグを題材に 7 ステップで進む。動画版は YouTube ID `H0XScE08hy8`。

**Step 1: バグを再現する（Reproduce the bug）**
「バグを一貫して再現できる操作列を見つけること」が常に最初のステップ。デモ手順:

1. デモを新しいタブで開く: `https://googlechrome.github.io/devtools-samples/debug-js/get-started`
2. **Number 1** に `5` を入力
3. **Number 2** に `1` を入力
4. **Add Number 1 and Number 2** をクリック。ボタン下のラベルが `5 + 1 = 51` と表示される。正解は `6`。

**Step 2: Sources パネルの UI を把握する**

- DevTools を開く: <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>J</kbd>（Mac）/ <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd>（Windows, Linux）。このショートカットは **Console パネル**を開く。
- **Sources** タブをクリックする。
- Sources パネル UI は 3 部構成:
  1. **File Navigator ペイン** — ページが要求した全ファイルが列挙される。
  2. **Code Editor ペイン** — File Navigator で選んだファイルの内容が表示される。
  3. **JavaScript Debugging ペイン** — ページの JavaScript を調べる各種ツール。DevTools ウィンドウが広いと Code Editor の右側に配置される。

**Step 3: ブレークポイントでコードを止める**

`console.log()` を大量に挿す代わりにブレークポイントを使う。原文が挙げる `console.log()` 版の例（逐語）:

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

ブレークポイントが `console.log()` に優る理由（原文の 2 点）:

- `console.log()` はソースを開き、該当箇所を探し、文を挿入し、リロードして Console を見る必要がある。ブレークポイントなら**コードの構造を知らなくても**関連コードで停止できる。
- `console.log()` は見たい値を明示指定しないといけない。ブレークポイントならその瞬間の**全変数**の値が見える。自分が気付いていない変数が影響していることもある。

Event Listener Breakpoints の設定手順:

1. JavaScript Debugging ペインで **Event Listener Breakpoints** をクリックして展開。**Animation**、**Clipboard** などのカテゴリが並ぶ。
2. **Mouse** カテゴリ横の **Expand** をクリック。**click**、**mousedown** などが並び、各々にチェックボックスがある。
3. **click** のチェックを入れる。これで *任意の* `click` イベントリスナ実行時に自動停止する。
4. デモで **Add Number 1 and Number 2** を再度クリック。DevTools が停止し、Sources で下の行をハイライトする:

```js
function onClick() {
```

別の行で止まった場合は正しい行になるまで **Resume Script Execution** を押す。

> **注（原文の Note）**: 別の行で止まったなら、訪れた全ページに `click` リスナを登録する拡張機能が入っている。停止したのはその拡張のリスナ内。シークレットモード（全拡張が無効）で試せば毎回正しい行で止まる。

**Step 4: コードをステップ実行する**

1. **Step into next function call** をクリックして `onClick()` を 1 行ずつ進める。次の行がハイライトされる:

```js
if (inputsAreEmpty()) {
```

2. **Step over next function call** をクリック。DevTools は `inputsAreEmpty()` に入らずに実行する。`inputsAreEmpty()` が false に評価されたため `if` ブロックがスキップされ、数行飛ぶ。

**Step 5: line-of-code ブレークポイントを置く**

1. `updateLabel()` の最終行を見る:

```js
label.textContent = addend1 + ' + ' + addend2 + ' = ' + sum;
```

2. 行番号は **32**。`32` をクリックすると青いアイコンが付く = line-of-code ブレークポイント。以後、この行の実行**前**に必ず停止する。
3. **Resume script execution** をクリック。行 32 まで実行される。行 29, 30, 31 では `addend1`、`addend2`、`sum` の値が宣言の隣にインラインで表示される。

**Step 6: 変数の値を確認する（3 手法）**

- **Method 1: Scope ペイン** — 停止中、ローカル/グローバル変数と値、該当すればクロージャ変数も表示。値をダブルクリックで編集可能。停止していないときは空。
- **Method 2: Watch Expressions** — **Watch** タブ → **Add Expression** → `typeof sum` と入力 → <kbd>Enter</kbd>。`typeof sum: "string"` と表示され、`sum` が数値でなく文字列だと確認できる。変数だけでなく**任意の有効な JavaScript 式**を置ける。
- **Method 3: Console** — <kbd>Escape</kbd> で Console ドロワーを開く。停止中で `addend1`/`addend2` がスコープ内なので次を評価できる:

```js
parseInt(addend1) + parseInt(addend2)
```

結果は `6` で、期待値と一致する。

**Step 7: 修正を当てる**

1. **Resume script execution** をクリック。
2. Code Editor で行 31 の `var sum = addend1 + addend2` を `var sum = parseInt(addend1) + parseInt(addend2)` に置換。
3. <kbd>Command</kbd>+<kbd>S</kbd>（Mac）/ <kbd>Control</kbd>+<kbd>S</kbd>（Windows, Linux）で保存。
4. **Deactivate breakpoints** をクリック。色が青に変わり有効であることを示す。これがオンの間、DevTools は設定済みブレークポイントを無視する。
5. 別の値でデモを試す。正しく計算される。

> **注意（原文 caution）**: このワークフローは**ブラウザ内で動いているコードにだけ**修正を当てる。ページを訪れる全ユーザのコードは直らない。そのためにはサーバ上のコードを直す必要がある。ただし **Workspaces** を使えば DevTools 内の編集をソースに保存できる。
>
> **注意（原文 gotchas）**: Chrome 105 以降は「停止中の関数をライブ編集」できる（`#live-edit`）。

**Next steps に挙げられている他のブレークポイント種別（原文逐語の訳）**

- 指定した条件が真のときだけ発火する **Conditional breakpoints**
- **caught / uncaught 例外**でのブレークポイント
- 要求 URL が指定した部分文字列に一致したときに発火する **XHR ブレークポイント**

---

### 2. ブレークポイント全 9 種 （出典: https://developer.chrome.com/docs/devtools/javascript/breakpoints/）

動画 ID `JyHjoaUhAus`。「最も有名なのは line-of-code だが、どこを見ればよいか分からない場合や大規模コードベースでは設定が非効率になりうる。他の種別の使い方と使いどころを知っておくと時間を節約できる。」

#### 種別一覧（原文の表を完全再現）

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
| Trusted Type | Pause on [Trusted Type](https://www.w3.org/TR/trusted-types/) violations. |

#### 2.1 Line-of-code breakpoints

「調べるべきコード領域が正確に分かっているとき」に使う。DevTools は *常に* その行の実行**前**に停止する。

手順:
1. **Sources** タブをクリック。
2. 対象行を含むファイルを開く。
3. 対象行へ移動。
4. 行左の行番号カラムをクリック。行番号の上に青いアイコンが出る。

#### 2.2 コード内からの line-of-code ブレークポイント（`debugger`）

コードから `debugger` を呼ぶとその行で停止する。UI で設定した line-of-code ブレークポイントと等価で、違いは「設定場所がコード内か DevTools UI か」だけ。

```js
console.log('a');
console.log('b');
debugger;
console.log('c');
```

#### 2.3 Conditional line-of-code breakpoints（条件付き）

「実行を止めたいが、ある条件が真のときだけにしたい」場合に使う。**特にループ内で無関係なブレークをスキップしたいときに有用**。

手順:
1. **Sources** タブを開く。
2. 対象行を含むファイルを開く。
3. 対象行へ移動。
4. 行左の行番号カラムを**右クリック**。
5. **Add conditional breakpoint** を選択。行の下にダイアログが出る。
6. ダイアログに条件を入力。
7. <kbd>Enter</kbd> で有効化。行番号カラムの上に**オレンジ色の疑問符付きアイコン**が出る。

原文の例: ループ中で `x` が `10` を超えた反復 `i=6` のときだけ発火した条件付きブレークポイント。

#### 2.4 Logpoint（ログ用 line-of-code ブレークポイント）

実行を止めず、かつコードに `console.log()` を散らさずに Console へメッセージを出す。

手順:
1. **Sources** タブを開く。
2. 対象行を含むファイルを開く。
3. 対象行へ移動。
4. 行左の行番号カラムを右クリック。
5. **Add logpoint** を選択。行の下にダイアログが出る。
6. ダイアログにログメッセージを入力。`console.log(message)` と同じ構文が使える。

ログできるものの例（逐語）:

```js
"A string " + num, str.length > 1, str.toUpperCase(), obj
```

このとき出力されるメッセージ（逐語）:

```js
// str = "test"
// num = 3
// obj = {attr: "x"}
A string 42 true TEST {attr: 'x'}
```

7. <kbd>Enter</kbd> で有効化。行番号カラムの上に**ピンク色の二点アイコン**が出る。

原文の例: 行 30 の logpoint が文字列と変数値を Console に出す。

#### 2.5 line-of-code ブレークポイントの編集（Breakpoints ペイン）

**Breakpoints** ペインは**ファイル単位でグループ化**し、**行番号・列番号順**に並べる。

グループに対してできること:
- グループ名をクリックで折りたたみ/展開。
- グループまたは個別ブレークポイント横のチェックボックスで有効/無効。
- グループにホバーして閉じるアイコンでグループ削除。

無効化すると、Sources パネルは行番号横のマーカーを**半透明**にする。

グループの右クリック（コンテキスト）メニュー:
- Remove all breakpoints in file (group).
- Disable all breakpoints in file.
- Enable all breakpoints in file.
- Remove all breakpoints (in all files).
- Remove other breakpoints (in other groups).

個別ブレークポイントの編集:
- チェックボックスで有効/無効。
- ホバーして編集アイコンで編集、閉じるアイコンで削除。
- 編集中はインラインエディタのドロップダウンで**種別を変更**できる（通常 ↔ 条件付き ↔ logpoint）。
- 右クリックメニュー:
  - Remove breakpoint.
  - Edit condition or logpoint.
  - Reveal location.
  - Remove all breakpoints (in all files).
  - Remove other breakpoints (in other files).

#### 2.6 DOM change breakpoints

「DOM ノードまたはその子を変更するコードで止めたい」ときに使う。

手順:
1. **Elements** タブをクリック。
2. ブレークポイントを置きたい要素へ移動。
3. 要素を右クリック。
4. **Break on** にホバーし、**Subtree modifications** / **Attribute modifications** / **Node removal** を選択。

一覧の確認場所:
- **Elements** > **DOM Breakpoints** ペイン
- **Sources** > **DOM Breakpoints** サイドペイン

そこでチェックボックスによる有効/無効、右クリック → **Remove** / **Reveal**（DOM 上で示す）が可能。

**種別の発火条件（原文逐語の訳）**

- **Subtree modifications** — 現在選択中ノードの子が削除/追加された、または子の内容が変わったときに発火。**子ノードの属性変更**や、**現在選択中ノード自身への変更**では発火しない。
- **Attributes modifications** — 現在選択中ノードに属性が追加/削除された、または属性値が変わったときに発火。
- **Node Removal** — 現在選択中ノードが削除されたときに発火。

#### 2.7 XHR/fetch breakpoints

「XHR のリクエスト URL が指定文字列を含むときに止めたい」ときに使う。DevTools は **XHR が `send()` を呼ぶコード行で停止**する。

有用な場面（原文）: ページが**誤った URL を要求している**のが分かり、その誤リクエストを出している AJAX / Fetch のソースを素早く見つけたいとき。

手順:
1. **Sources** タブをクリック。
2. **XHR Breakpoints** ペインを展開。
3. **Add breakpoint** をクリック。
4. 止めたい文字列を入力。DevTools は XHR のリクエスト URL の**どこかにこの文字列が現れた**ときに停止する。
5. <kbd>Enter</kbd> で確定。

原文の例: URL に `org` を含む任意のリクエストで止める XHR/fetch ブレークポイントを **XHR/fetch Breakpoints** に作る。

#### 2.8 Event listener breakpoints

「イベント発火後に走るリスナのコードで止めたい」ときに使う。`click` のような個別イベントでも、マウスイベント全体のようなカテゴリでも選べる。

1. **Sources** タブをクリック。
2. **Event Listener Breakpoints** ペインを展開。**Animation** などのカテゴリ一覧が出る。
3. カテゴリにチェックを入れるとそのカテゴリの任意イベントで停止。カテゴリを展開して個別イベントにチェックも可。

原文の例: `deviceorientation` の event listener breakpoint。

加えて、リスナ一覧は **Elements** > **Event Listeners** ペインでも確認できる。

#### 2.9 Exception breakpoints

「caught / uncaught 例外を投げている行で止めたい」ときに使う。**Node.js 以外のデバッグセッションでは両者を独立に停止できる**。

> **注意（原文 gotchas）**: 現在、Node.js デバッグセッションでは、uncaught 例外でも止める設定にしない限り caught 例外だけで止めることはできない。詳細は [Chromium bug #1382762](https://crbug.com/1382762)。

**Sources** タブの **Breakpoints** ペインで次のどちらか（または両方）を有効にしてからコードを実行する:
- **Pause on uncaught exceptions**
- **Pause on caught exceptions**

#### 2.10 Function breakpoints（`debug()`）

「特定の関数が呼ばれたら常に止めたい」ときは `debug(functionName)` を呼ぶ。`functionName` はデバッグ対象の関数。`console.log()` のようにコードへ挿してもよいし、DevTools の Console から呼んでもよい。`debug()` は**その関数の 1 行目に line-of-code ブレークポイントを置くのと等価**。

```js
function sum(a, b) {
  let result = a + b; // DevTools pauses on this line.
  return result;
}
debug(sum); // Pass the function object, not a string.
sum();
```

**対象関数がスコープ内にあることを確認する**

デバッグしたい関数がスコープ外だと DevTools は `ReferenceError` を投げる。

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

DevTools Console から `debug()` を呼ぶときにスコープを確保する一つの戦略（原文）:

1. その関数がスコープ内になる場所に line-of-code ブレークポイントを置く。
2. そのブレークポイントを踏ませる。
3. line-of-code ブレークポイントで停止したままの状態で DevTools Console から `debug()` を呼ぶ。

#### 2.11 Trusted Type breakpoints（CSP Violation Breakpoints）— 脆弱性診断に直結

[Trusted Type API](https://developer.mozilla.org/docs/Web/API/Trusted_Types_API) は **cross-site scripting (XSS)** として知られるセキュリティ悪用に対する保護を提供する。

> **重要用語（原文 key-term の逐語訳）**: DOM-based cross-site scripting は、ユーザが制御できる *source*（ユーザ名や URL フラグメントから取った リダイレクト URL など）のデータが、*sink*（`eval()` のような関数、または `.innerHTML` のようなプロパティセッタで、任意の JavaScript コードを実行しうるもの）に到達したときに発生する。

**Sources** タブの **Breakpoints** ペインで **CSP Violation Breakpoints** セクションへ行き、次のどちらか（または両方）を有効にしてコードを実行する:

- **Sink Violations** — sink 違反で停止する。
- **Policy Violations** — ポリシー違反で停止する。Trusted Type ポリシーは [`trustedTypes.createPolicy`](https://developer.mozilla.org/docs/Web/API/TrustedTypePolicyFactory/createPolicy) で設定する。

API 利用の追加情報（原文が挙げるリンク）:
- セキュリティ目的: [Prevent DOM-based cross-site scripting vulnerabilities with Trusted Types](https://web.dev/articles/trusted-types)
- デバッグ目的: [Implementing CSP and Trusted Types debugging in Chrome DevTools](https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems)
---

### 3. ステッピング・Call Stack・Scope・Watch の詳細 （出典: https://developer.chrome.com/docs/devtools/javascript/reference/）

#### 3.1 停止中の値確認（inline evaluation）

実行が停止している間、デバッガは**現在の関数内でブレークポイントまでの**全変数・定数・オブジェクトを評価し、対応する宣言の隣に現在値をインライン表示する。Console から評価済みの変数・定数・オブジェクトを問い合わせることもできる。

> **注意（gotchas）**: 停止中は現在の関数を **restart** することも、**live-edit** することもできる。

#### 3.2 hover でクラス/関数のプロパティをプレビュー

停止中にクラス名や関数名にホバーすると、そのプロパティをプレビューできる。

#### 3.3 Step over（次の関数呼び出しを飛ばす）

デバッグ対象と無関係な関数を含む行で停止しているとき、**Step over** をクリックするとその関数に入らずに実行する。

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

`A` で停止中に **Step over** を押すと、DevTools はステップオーバーする関数内の全コード（`B` と `C`）を実行し、`D` で停止する。

#### 3.4 Step into（行の中に入る）

デバッグ対象に関係する関数呼び出しを含む行で停止しているとき、**Step into** でその関数をさらに調べる。

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

`A` で停止中に **Step into** を押すと、この行を実行してから `B` で停止する。

#### 3.5 Step out（関数から出る）

デバッグ対象と無関係な関数の中で停止しているとき、**Step out** で残りのコードを実行する。

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

`A` で停止中に **Step out** を押すと、`getName()` の残り（この例では `B` のみ）を実行し、`C` で停止する。

#### 3.6 Continue to here（特定行まで一気に実行）

長い関数のデバッグでは無関係なコードが多い。全行をステップすることも、目的行に line-of-code ブレークポイントを置いて **Resume Script Execution** することもできるが、もっと速い方法がある: **目的の行を右クリックして Continue to here を選ぶ**。DevTools はその地点までの全コードを実行し、その行で停止する。

〔補足（一般知識）〕キーボードからは <kbd>Command</kbd>（Mac）/ <kbd>Control</kbd>（Win/Linux）を押しながら該当行をクリックしても同じ動作になる（公式ショートカット表に "Continue to a certain line of code while paused" として記載あり）。

#### 3.7 Resume / Force script execution

- **Resume Script Execution** — 停止後にスクリプト実行を続ける。次のブレークポイントがあればそこまで実行する。
- **Force script execution** — 全ブレークポイントを無視して強制的に再開する。**Resume Script Execution** を**クリックしたまま長押し**し、**Force script execution** を選ぶ。

#### 3.8 Change thread context（Threads ペイン）

web worker / service worker を扱うとき、**Threads** ペインに列挙されたコンテキストをクリックしてそのコンテキストに切り替える。**青い矢印アイコン**が現在選択中のコンテキストを表す。

原文の例: メインスクリプトと service worker スクリプトの両方でブレークポイント停止しているとき、Sources はメインスクリプトのコンテキストを表示している。Threads ペインの service worker エントリをクリックすればそちらに切り替えられる。

#### 3.9 カンマ区切り式のステップ実行（minified コード対応）

> **注意（gotchas）**: Chrome 108 以降、**Debugger** はセミコロン区切り（`;`）とカンマ区切り（`,`）の両方の式をステップできる。

カンマ区切り式をステップできることで minified コードをデバッグできる。例:

```js
function foo() {}

function bar() {
  foo();
  foo();
  return 42;
}

bar();
```

minify すると、カンマ区切りの `foo(),foo(),42` 式を含む:

```js
function foo(){}function bar(){return foo(),foo(),42}bar();
```

**Debugger** はこうした式も同様にステップする。したがってステップの挙動は次の点で同一になる:

- minified コードと authored コードの間で同一。
- source map を使って minified コードを元コードの用語でデバッグするときも同一。言い換えると、**セミコロンが見えているなら、実際にデバッグしているソースが minified であっても常にそれをステップできると期待してよい**。

#### 3.10 Scope ペイン（local / closure / global）

停止中、**Scope** ペインで local / closure / global スコープのプロパティと変数の値を確認・編集できる。

- プロパティ値をダブルクリックで変更。
- **列挙不可（non-enumerable）なプロパティはグレー表示**される。

#### 3.11 Call Stack ペイン

停止中、**Call Stack** ペインでそこに至った呼び出しスタックを確認する。エントリをクリックするとその関数が呼ばれた行へジャンプする。**青い矢印アイコン**が DevTools が現在ハイライトしている関数を示す。

> **注**: 行で停止していないとき、**Call Stack** ペインは空。

#### 3.12 Restart frame（関数フレームの再実行）

関数の挙動を観察するためにデバッグフロー全体を再開せずに済ませたいとき、停止中の関数 1 つだけを再実行できる（= Call Stack 内のフレームを restart する）。

手順:
1. ブレークポイントで関数実行を停止する。**Call Stack** ペインが関数呼び出し順を記録する。
2. **Call Stack** ペインで関数を右クリックし、ドロップダウンから **Restart frame** を選ぶ。

> **注**: **Call Stack** の任意の関数フレームを restart できるが、**WebAssembly、async、generator 関数は除く**。

動作理解のための原文コード:

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

`foo()` は `0` を引数に取りログし、`bar()` を呼ぶ。`bar()` は引数をインクリメントする。

手順（原文逐語の訳）:

1. 上のコードを新しい Snippet にコピーして実行する。`debugger` の line-of-code ブレークポイントで実行が止まる。
   > **注意（caution）**: 実行が停止している間、呼び出しスタックのフレーム順をプログラム的に変更しないこと。予期しないエラーを引き起こす場合がある。
2. デバッガが関数宣言の隣に現在値 `value = 1` を表示していることに注目。
3. `bar()` のフレームを restart する。
4. `F9` を押して value インクリメント文をステップする。現在値が `value = 2` に増えることに注目。
5. 任意で **Scope** ペインの値をダブルクリックして編集し、好きな値にできる。
6. `bar()` フレームの restart とインクリメント文のステップを数回繰り返す。値は増え続ける。
   > **gotchas: なぜ値が `0` にリセットされないのか？** フレーム restart は**引数をリセットしない**。つまり restart は関数呼び出し時の初期状態を復元せず、単に実行ポインタを関数の先頭に移すだけ。したがって同じ関数の restart をまたいで現在の引数値がメモリ上に残る。
7. 次に **Call Stack** で `foo()` のフレームを restart する。値が再び `0` になることに注目。
   > **gotchas: なぜ値が `0` にリセットされるのか？** JavaScript では引数への変更は関数の外側に見えない（反映されない）。ネストした関数は値を受け取り、メモリ上の位置を受け取るわけではない。
8. `F8` でスクリプト実行を再開してチュートリアルを完了する。

#### 3.13 Show ignore-listed frames

既定では **Call Stack** ペインは自分のコードに関係するフレームのみを表示し、**Settings > Ignore List** に追加されたスクリプトを省く。サードパーティのフレームも含む完全なコールスタックを見るには、**Call Stack** セクション配下の **Show ignore-listed frames** を有効にする。

デモページ https://ng-devtools.netlify.app/ での試行手順:
1. **Sources** パネルで `src` > `app` > `app.component.ts` を開く。
2. `increment()` 関数にブレークポイントを置く。
3. **Call Stack** セクションで **Show ignore-listed frames** のチェックを入れる/外して、関連のみ/完全なフレーム一覧を観察する。

#### 3.14 View async frames（Async Stack Tagging）

利用しているフレームワークが対応していれば、DevTools は async 操作を追跡して async コードの両側をリンクできる。この場合 **Call Stack** は async 呼び出しフレームを含む呼び出し履歴全体を表示する。

> **gotchas**: DevTools はこの "Async Stack Tagging" 機能を `console.createTask()` API メソッドに基づいて実装している。API を実装するかはフレームワーク側次第。例えば Angular はこの機能をサポートしている。

#### 3.15 Copy stack trace

**Call Stack** ペインのどこかを右クリックして **Copy stack trace** を選ぶと現在のコールスタックがクリップボードにコピーされる。出力例（逐語）:

```js
getNumber1 (get-started.js:35)
inputsAreEmpty (get-started.js:22)
onClick (get-started.js:15)
```

#### 3.16 Watch ペイン

**Watch** ペインで任意の有効な JavaScript 式の値を監視する。

- **Add Expression** をクリックして新しい watch 式を作る。
- **Refresh** をクリックして既存の全式の値を更新する。**コードをステップしている間は値が自動更新**される。
- 式にホバーして **Delete Expression** をクリックで削除。

---

### 4. source map で「元のコード」をデバッグする （出典: https://developer.chrome.com/docs/devtools/javascript/source-maps/）

動画 ID `SkUcO4ML5U0`。

「結合・minify・コンパイル後でもクライアントサイドコードを読める・デバッグできる状態に保つ。[source maps](https://web.dev/articles/source-maps) を使って Sources パネル上でソースコードをコンパイル後コードにマップする。」

#### 4.1 プリプロセッサの前提

「プリプロセッサ由来の source map によって、DevTools は minify 済みファイルに**加えて**元ファイルをロードする。Chrome は実際には minify 済みコードを実行するが、**Sources** パネルは自分が書いたコードを表示する。ソースファイル上にブレークポイントを置いてステップできるし、全てのエラー・ログ・ブレークポイントが自動的にマップされる。」
「これにより、開発サーバが配信しブラウザが実行するコードではなく、自分が書いたままのコードをデバッグしているかのように見える。」

Sources パネルで source map を使う条件（原文）:
- **source map を生成できるプリプロセッサのみを使う。**
- **Web サーバが source map を配信できることを確認する。**

#### 4.2 サポートされるプリプロセッサ（原文の列挙をそのまま）

- Transpilers: [Babel](https://babeljs.io/)
- Compilers: [TypeScript](http://www.typescriptlang.org/) and [Dart](https://www.dartlang.org)
- Minifiers: [terser](https://github.com/terser/terser)
- Bundlers and development servers: [Webpack](https://webpack.js.org/), [Vite](https://vitejs.dev/), [esbuild](https://esbuild.github.io/), and [Parcel](https://parceljs.org/)

拡張リストは [Source maps: Languages, tools, and other info](https://github.com/ryanseddon/source-map/wiki/Source-maps:-languages,-tools-and-other-info)。

#### 4.3 Settings での有効化（重要な設定手順）

**Settings > Preferences > Sources** で **Enable JavaScript source maps** にチェックが入っていることを必ず確認する。

> **Aside**: **Enable CSS source maps** もチェックしておきたいかもしれない。

#### 4.4 source map が正しく読み込まれたかの確認

→ **Developer Resources: View and load source maps manually**（本ノート §5）。

#### 4.5 source map を使ったデバッグ手順

（原文は https://github.com/jecfish/parcel-demo をデモとして使う）

source map が用意され有効化されていれば、次ができる:

1. **Sources** パネルでサイトのソースを開く。
2. 自分が書いたコードだけに集中するため、**ファイルツリーで authored / deployed をグループ化**する。そして **Authored** セクションを展開し、元のソースファイルを **Editor** で開く。
3. 通常どおり**ブレークポイントを設定**する（例: logpoint）。そしてコードを実行する。
4. **Editor** が下部のステータスバーに **deployed ファイルへのリンク**を置くことに注目する。deployed CSS ファイルについても同様。
5. **Console** ドロワーを開く。この例では logpoint のメッセージの隣に、Console が **deployed ではなく元のファイルへのリンク**を表示する。
6. ブレークポイント種別を通常のものに変えてコードを再実行する。今回は実行が停止する。**Call Stack** ペインが deployed でなく**元のファイル名**を表示することに注目する。
7. **Editor** 下部のステータスバーで deployed ファイルへのリンクをクリックする。Sources パネルが対応ファイルへ連れて行く。

「deployed ファイルを開くと、DevTools は `//# sourceMappingURL` コメントと関連する元ファイルを見つけたかどうかを通知する。」
「**Editor** が deployed ファイルを自動で pretty-print したことに注目。実際には `//# sourceMappingURL` コメントを除き、全コードが 1 行に入っている。」

#### 4.6 `#sourceURL` で `eval()` 呼び出しに名前を付ける

`#sourceURL` は `eval()` 呼び出しを扱うときのデバッグを簡単にする。これは `//# sourceMappingURL` プロパティによく似たヘルパー。詳細は [Source Map V3 specification](https://sourcemaps.info/spec.html)。

**`//# sourceURL=/path/to/source.file` コメントは、`eval()` を使ったときにブラウザにソースファイルを探すよう指示する。これにより eval や インラインスクリプト・スタイルに名前を付けられる。**

デモページ http://www.thecssninja.com/demo/source_mapping/compile.html での手順:

1. DevTools を開いて **Sources** パネルへ行く。
2. ページの *Name your code:* 入力欄に任意のファイル名を入れる。
3. **Compile** ボタンをクリック。CoffeeScript ソースから評価された合計値のアラートが出る。
4. **Page** ペインのファイルツリーで、入力したカスタムファイル名の新しいファイルを開く。そこにはコンパイル済み JavaScript コードが入っており、元のソースファイル名を持つ `// #sourceURL` コメントが含まれる。
5. ソースファイルを開くには **Editor** のステータスバーのリンクをクリックする。

〔補足（一般知識）〕クライアントサイド脆弱性ハンティングでは、`eval()` / `new Function()` / 動的 `import()` で流し込まれたコードは既定で「匿名のスクリプト」として扱われ、Sources のファイルツリー上で追いにくい。対象アプリが `//# sourceURL=` を付けていれば名前付きで現れるため、sink に到達する動的コードの特定が容易になる。付いていない場合は Call Stack と `debug()` / XHR ブレークポイント併用で辿る。

---

### 5. Developer Resources — source map の読み込み確認と手動読み込み （出典: https://developer.chrome.com/docs/devtools/developer-resources）

動画 `SkUcO4ML5U0` の 139 秒地点から。

「**Developer Resources** タブを使って DevTools が source map を正常に読み込めたかを確認する。必要なら手動で読み込める。」

「DevTools を開くと、source map があればその読み込みを試みる。失敗した場合、**Console** は次のようなエラーを記録する。」（原文はスクリーンショットで提示）

#### 5.1 Developer Resources を開いて状態を確認する

1. DevTools を開き、**source map を有効化**していることを確認し、**三点メニュー > More tools > Developer Resources** に移動する。
2. 表で次の列の値を確認する:
   - **Status** — source map の読み込みが成功/失敗したか。
   - **Error** — あればエラーメッセージ。

#### 5.2 URL または Error でフィルタする

上部のテキストボックスにテキストを入れると、URL やエラーメッセージにそのテキストを含まない source map を除外できる。

#### 5.3 トラブルシューティング（重要なハマりどころ）

「既定では、**DevTools が**（Web サイトではなく）source map をリクエストする。そのようなリクエストは [cross-origin](https://developer.mozilla.org/docs/Web/HTTP/CORS) として扱われ、通らないことがある。」

**Web サイト側に先に source map をリクエストさせるには、Developer Resources の右上で `Enable loading through target` にチェックを入れる。**

それでも source map の読み込みに問題がある場合は、次の手動読み込みを試す。

#### 5.4 source map を手動で読み込む（production の解析に有用）

「読み込み失敗に遭遇した場合や、例えば source map を持たない production の Web サイトで元のコードをデバッグしたい場合、手動で読み込める。」

1. source map をサポートするツールで source map を生成する。
2. source map をローカルにホストする。
3. 対象ページで DevTools を開き、source map を有効化していることを確認する。
4. **Sources** で deployed（処理済み）ファイルを開き、**Editor** 内でそれを右クリックし、メニューから **Add source map** を選ぶ。
5. テキストボックスに source map の URL を指定して **Add** をクリック。
6. **Developer Resources** に source map が現れ、（deployed からマップされた）元ファイルがファイルツリーに現れたか確認する。
7. 元ファイルのデバッグへ進む。

---

### 6. minified コードを読む — pretty print / 折りたたみ / 検索置換 / ライブ編集 （出典: https://developer.chrome.com/docs/devtools/javascript/reference/）

#### 6.1 minified ファイルを読めるようにする（pretty print）

「**既定で Sources パネルは minified ファイルを pretty-print する。** pretty-print されると、**Editor** は 1 本の長いコード行を複数行に表示することがあり、行の継続を示すために `-` を使う。」

**minified ファイルを読み込まれたままの姿で見るには、Editor の左下隅の `{ }` をクリックする。**

#### 6.2 コードブロックの折りたたみ

コードブロックを折りたたむには、左カラムの行番号にホバーして **Collapse** をクリック。展開するには隣の `{...}` をクリック。挙動の設定は **Settings > Preferences > Sources**。

#### 6.3 スクリプトを編集する

「バグ修正時、JavaScript コードへの変更を試したいことが多い。外部ブラウザで変更してページをリロードする必要はない。DevTools 内でスクリプトを編集できる。」

1. **Sources** パネルの **Editor** ペインでファイルを開く。
2. **Editor** ペインで変更する。
3. <kbd>Command</kbd>+<kbd>S</kbd>（Mac）/ <kbd>Ctrl</kbd>+<kbd>S</kbd>（Windows, Linux）で保存。**DevTools は JS ファイル全体を Chrome の JavaScript エンジンにパッチする。**

#### 6.4 停止中の関数をライブ編集する（Chrome 105 以降）

> **注**: この機能は Chrome バージョン 105 から利用可能。

実行が停止している間、現在の関数を編集して変更をライブに適用できる。ただし次の制約がある:

- **Call Stack の最上位の関数のみ編集できる。**
- **スタックのさらに下に同じ関数への再帰呼び出しがあってはならない。**

> **gotchas**: 変更を適用すると、デバッガは自動的に関数を restart する。したがって関数 restart の制約も適用される。WebAssembly、async、generator 関数は restart できない。

手順:
1. ブレークポイントで実行を停止する。
2. 停止中の関数を編集する。
3. <kbd>Command</kbd> / <kbd>Control</kbd>+<kbd>S</kbd> で変更を適用する。デバッガが自動的に関数を restart する。
4. 実行を続ける。

原文の例: `addend1` と `addend2` が最初は誤って `string` 型で、数値の加算ではなく文字列連結になっている。修正のためライブ編集中に `parseInt()` を追加する。

#### 6.5 スクリプト内のテキスト検索と置換

検索:
1. **Sources** パネルの **Editor** ペインでファイルを開く。
2. 組み込み検索バーを開く: <kbd>Command</kbd>+<kbd>F</kbd>（Mac）/ <kbd>Ctrl</kbd>+<kbd>F</kbd>（Windows, Linux）。
3. バーにクエリを入れる。任意で:
   - **Match Case** をクリックして大文字小文字を区別する。
   - **Use Regular Expression** をクリックして RegEx で検索する。
4. <kbd>Enter</kbd>。前後の検索結果へは上下ボタン。

置換:
1. 検索バーで **Replace** ボタンをクリック。
2. 置換後テキストを入力し、**Replace** または **Replace all** をクリック。

#### 6.6 ファイルツリーのナビゲーション

**Authored / Deployed グループ化**（Chrome 104 以降のプレビュー機能）

「フレームワーク（React、Angular など）で Web アプリを開発するとき、ビルドツール（webpack、Vite など）が生成する minified ファイルのためにソースのナビゲートが難しい。」

**Sources > Page** ペインは 2 カテゴリにファイルをグループ化できる:

- **Authored** — IDE で見るソースファイルに近い。**DevTools はビルドツールが提供する source map に基づいてこれらのファイルを生成する。**
- **Deployed** — ブラウザが実際に読むファイル。通常 minified されている。

有効化するには、ファイルツリー上部の三点メニュー配下の **Group files by Authored/Deployed** オプションを有効にする。

**ignore-list されたソースをファイルツリーから隠す**（Chrome 106 以降のプレビュー機能）

既定では **Sources > Page** ペインは **Settings > Ignore List** に追加された全スクリプト/ディレクトリをグレーアウトする。完全に隠すには **Sources > Page > 三点メニュー > Hide ignore-listed sources** を選ぶ。

---

### 7. Ignore List（ノイズ排除） （出典: https://developer.chrome.com/docs/devtools/settings/ignore-list/ ・https://developer.chrome.com/docs/devtools/javascript/reference/）

「スクリプトを ignore するとデバッグ中それをスキップする。ignore されたスクリプトは **Call Stack** ペインで隠され、コードをステップするときそのスクリプトの関数に決して入らない。」

```js
function animate() {
  prepare();
  lib.doFancyStuff(); // A
  render();
}
```

`A` は信頼しているサードパーティライブラリ。デバッグ中の問題がサードパーティ由来でないと確信できるなら、そのスクリプトを ignore するのが合理的。

#### 7.1 設定場所と主スイッチ

**Settings > Ignore List** でデバッガが ignore するスクリプト一覧を設定する。

1. Settings を開く。
2. **Ignore List** タブで **Enable Ignore Listing** をチェック/クリアする。**これが全 ignore-listing 機能の主スイッチ。**

#### 7.2 Chrome 拡張のスクリプトを ignore する

「Sources パネルでコードをステップするとき、見覚えのないコードで止まることがある。おそらくインストール済み Chrome 拡張のコードで止まっている。」

**Settings > Ignore List** で 2 つのチェックボックスを有効にする:
- **Enable Ignore Listing**
  - **Add content scripts to ignore list**

#### 7.3 既知のサードパーティスクリプトを ignore する

**Settings > Ignore List > Automatically add known third-party scripts to ignore list** をチェックする。

「DevTools は source map の [`ignoreList`](https://developer.chrome.com/articles/x-google-ignore-list/) プロパティに基づいてサードパーティスクリプトを ignore list に追加する。フレームワークとバンドラがこの情報を提供する必要がある。」
「例えば Angular や Nuxt のようなフレームワークがこの機能をサポートしている。」

#### 7.4 カスタムパターンで ignore する

1. **Settings > Ignore List > Enable Ignore Listing** をチェック。
2. **Custom exclusion rules** セクションで **Add pattern** をクリック。
3. ignore するスクリプト名または**スクリプト名の RegEx パターン**を指定。
4. **Add** で保存。

カスタム一覧の管理: **Custom exclusion rules** の各行のチェックボックスで有効/無効。ホバーで現れる編集/削除ボタンで編集・削除。

#### 7.5 ignore list への追加経路（4 通り）

- **ファイルツリーから**: **Sources > Page** でディレクトリまたはスクリプトファイルを右クリック → **Add directory/script to ignore list**。ignore-listed ソースを隠していない場合、ファイルツリーでそれを選ぶと警告バナーに **Remove from ignored list** / **Configure** ボタンが出る。
- **Editor ペインから**: ファイルを開く → どこかを右クリック → **Add script to ignore list**。
- **Call Stack ペインから**: そのスクリプトの関数を右クリック → **Add script to ignore list**。
- **Settings から**: **Settings > Ignore List**。

---

### 8. Local Overrides — Web コンテンツと HTTP レスポンスヘッダをローカルで上書きする （出典: https://developer.chrome.com/docs/devtools/overrides/）

「local overrides を使えば、**HTTP レスポンスヘッダ**と **Web コンテンツ**（**XHR と fetch リクエスト**を含む）を上書きして、アクセス権がないリモートリソースであってもモックできる。これによりバックエンドの対応を待たずに変更をプロトタイプできる。local overrides は DevTools で加えた変更をページロードをまたいで保持することもできる。」

**仕組み（原文の "How it works"）**

- DevTools で変更を加えると、DevTools は変更済みファイルのコピーを**指定したフォルダ**に保存する。
- ページをリロードすると、DevTools はネットワークリソースではなく**ローカルの変更済みファイルを提供する**。

> **important**: 変更をソースファイルに直接保存することもできる。**Edit and save files with Workspaces** を参照。

#### 8.1 制限事項（Limitations）

local overrides は**ネットワークレスポンスヘッダ**と、**XHR / fetch リクエストを含むほとんどのファイル種別**で動くが、次の例外がある:

- **DevTools は Elements パネルの DOM ツリーで加えた変更を保存しない。**
- **Styles ペインで CSS を編集し、その CSS のソースが HTML ファイルの場合、DevTools は変更を保存しない。**

代わりに **Sources** パネルで HTML ファイルを編集できる。

#### 8.2 セットアップ手順（具体手順）

Network パネルから Web コンテンツまたはレスポンスヘッダをすぐに上書きできる:

1. DevTools を開き、**Network** パネルへ移動、上書きしたいリクエストを**右クリック**し、ドロップダウンメニューから **Override headers** または **Override content** を選ぶ。
2. local overrides をまだセットアップしていない場合、上部のアクションバーで DevTools が次を促す:
   1. override ファイルを保存する**フォルダを選択（Select a folder）**する。
   2. **Allow** をクリックして DevTools にそのフォルダへのアクセス権を与える。
3. local overrides がセットアップ済みだが無効になっている場合、DevTools は自動的に有効化する。
4. セットアップ済みかつ有効になると、何を上書きしようとしているかに応じて DevTools は次へ連れて行く:
   - Web コンテンツを変更する場合 → **Sources** パネル
   - レスポンスヘッダを変更する場合 → **Network > Headers > Response Headers** のエディタ

**一時的な無効化と全削除**: **Sources > Overrides** へ移動し、**Enable Local Overrides** チェックボックスをクリアする（一時無効化）か、**Clear** をクリックする（override ファイル全削除）。

**個別ファイル/フォルダの削除**: **Sources > Overrides** でファイルまたはフォルダを右クリック → **Delete** → ダイアログで **OK**。**この操作は取り消せず、削除した override は手で作り直す必要がある。**

**全 override の素早い確認**: **Network** パネルでリクエストを右クリックして **Show all overrides** を選ぶ。DevTools が **Sources > Overrides** へ連れて行く。

#### 8.3 Web コンテンツを上書きする

1. local overrides をセットアップする。
2. ファイルを変更し、DevTools で保存する。

> **note（重大なハマりどころ）**: **source-mapped なファイルは override できない。** Network パネルでリクエストを右クリックして **Override content** を選ぶと、DevTools は元のソースファイルへ連れて行くダイアログを表示する。

例えば **Sources** でファイルを編集したり、**Elements > Styles** で CSS を編集できる（CSS が HTML ファイル内にある場合を除く）。

DevTools は変更済みファイルを保存し、**Sources > Overrides** に列挙し、関連するパネル・ペイン（**Elements > Styles**、**Network**、**Sources > Overrides**）で override されたファイルの隣に保存済みアイコンを表示する。

#### 8.4 XHR / fetch リクエストを上書きしてリモートリソースをモックする

「local overrides があれば、バックエンドへのアクセスは不要で、変更のサポートを待つ必要もない。その場でモックして実験する。」

1. local overrides をセットアップする。
2. **Network** で **XHR/fetch** リクエストをフィルタし、必要なものを見つけて右クリックし、**Override content** を選ぶ。
3. 取得されたデータに変更を加えてファイルを保存する。
4. ページを **Refresh** して変更が適用されたことを確認する。

〔補足（一般知識）〕診断目的では、この機能は「サーバ側の応答を安全に差し替えて、クライアント側パーサ・レンダラの挙動を単独で検証する」手段として使える。例えば JSON レスポンス内の文字列に `<img src=x onerror=1>` 相当のペイロードを入れて、フロントエンドがそれを `innerHTML` に流すかどうかを、実サーバへ攻撃リクエストを一切送らずに確認できる。許可された検証・バグバウンティの範囲内で、サーバに副作用を出さない検証手段として有効。

#### 8.5 ローカル変更の追跡

Web コンテンツに加えた全ての変更は **Changes** ドロワータブ 1 箇所で追跡できる。

#### 8.6 HTTP レスポンスヘッダを上書きする（CORS / Permissions-Policy / COOP-COEP）

「**Network** パネルから、Web サーバへのアクセス権なしに HTTP レスポンスヘッダを上書きできる。」

レスポンスヘッダ override でローカルに修正をプロトタイプできるヘッダ（原文が挙げるもの、これに限らない）:

- [Cross-Origin Resource Sharing (CORS) Headers](https://developer.mozilla.org/docs/Web/HTTP/CORS)
- [Permissions-Policy Headers](https://developer.mozilla.org/docs/Web/HTTP/Headers/Permissions-Policy)
- [Cross-Origin Isolation Headers](https://web.dev/articles/coop-coep)

手順:

1. local overrides をセットアップし、例としてデモページ https://cors-demo-devtools.glitch.me/ を調べる。
2. **Network** へ行き、リクエストを見つけて右クリックし **Override headers** を選ぶ。DevTools が **Headers > Response Headers** エディタへ連れて行く。
3. レスポンスヘッダ値にホバーしてそこにカーソルを置く。あるいは、レスポンスヘッダ値にホバーして編集アイコンをクリックすると **Response Headers** エディタが有効になる。
4. ヘッダを変更、または新しいヘッダを追加する。
   > この例では [CORS エラー](https://web.dev/articles/cross-origin-resource-sharing) を消すために次のヘッダを追加している（逐語）:
   > `Access-Control-Allow-Origin: *`
   - ヘッダ値を編集するには、それをクリックする。
   - 新しいヘッダを追加するには **Add header** をクリックする。
   - ヘッダ override を削除するには隣の削除アイコンをクリックする。これは追加したヘッダを消し、変更した値を元の値に戻す。

   **DevTools は変更したヘッダを緑、削除した override を赤（取り消し線）でハイライトする。**
5. ページを Refresh して変更を適用する。

#### 8.7 全レスポンスヘッダ override を `.headers` ファイルで一括編集

1. **Response Headers** セクションの隣の **Header overrides** をクリック。DevTools が **Sources > Overrides** の対応する `.headers` ファイルへ連れて行く。
2. `.headers` ファイルを編集する:
   - 新しい override ルールを追加するには **Add override rule** をクリック。**ここでのルールは「ヘッダと値の集合」＋「それを適用する単一または複数のリクエスト」。**
   - > **ワイルドカード**を使って複数リクエストを一度に指定できる（[RequestPattern](https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#type-RequestPattern)）。**複数文字は `*`、1 文字は `?` で指定する。**
   - ルールにヘッダ・値のペアを追加するには、別のペアにホバーして追加アイコンをクリック。
   - ヘッダ値を元に戻す、追加ヘッダやルールを削除するには、それにホバーして削除アイコンをクリック。
3. `.headers` ファイルを <kbd>Command</kbd> / <kbd>Control</kbd>+<kbd>S</kbd> で保存する。
4. ページを Refresh して変更を適用する。

---

### 9. Workspaces（Local Overrides との使い分け） （出典: https://developer.chrome.com/docs/devtools/workspaces/）

動画 ID `Zu9CdbnS5ps`。

「**Goal**: このチュートリアルは workspace のセットアップを実際に練習して自分のプロジェクトで使えるようにする。Workspace は DevTools 内で加えた変更を、**自分のコンピュータに保存されたソースコードに保存**させる。」

前提知識（原文 caution）: HTML/CSS/JS で Web ページを作れること、DevTools で CSS の基本的な変更ができること、ローカル HTTP Web サーバを動かせること。

**Overview**: workspace は DevTools で加えた変更を、同じファイルのローカルコピーに保存する。例:
- 自分のデスクトップにサイトのソースコードがある。
- ソースコードのディレクトリからローカル Web サーバを動かしており、サイトが `localhost:8080` でアクセスできる。
- Chrome で `localhost:8080` を開き、DevTools でサイトの CSS を変更している。

workspace を有効にすると、DevTools 内で加えた CSS の変更がデスクトップのソースコードに保存される。

**Limitations**: 「モダンなフレームワークを使っている場合、それはおそらくソースコードを『保守しやすい形式』から『可能な限り速く動くよう最適化された形式』に変換している。Workspace は通常、**source map の助けを借りて**最適化されたコードを元のソースコードにマップできる。」

**Related feature: Local Overrides** の使い分け（原文逐語の訳）:
「local overrides は workspace に似た別の DevTools 機能である。**バックエンドの変更を待たずに Web コンテンツやリクエストヘッダをモックしたいとき、あるいはページへの変更を実験し、その変更をページロードをまたいで見たいが、変更をページのソースコードにマップすることは気にしないときに local overrides を使う。**」

デモのセットアップ（逐語のコマンド）:

```bash
cd ~/Desktop/devtools-workspace-demo
# If your Python version is 3.X
# On Windows, try "python -m http.server" or "py -3 -m http.server"
python3 -m http.server
```

デモリポジトリ: https://github.com/sofiayem/devtools-workspace-demo
---

### 10. Network パネル — 条件付き観測・ブロック・フィルタ・throttle・エクスポート （出典: https://developer.chrome.com/docs/devtools/network/ ・https://developer.chrome.com/docs/devtools/network/reference/）

#### 10.1 記録の制御と保存

- **Preserve log** チェックボックスをチェックすると、ページロードをまたいでリクエストを保存する。無効化するまで全リクエストを保存する。
- **Capture screenshots**: **Network** パネル内の **Settings** を開き **Capture screenshots** をチェック。**Network** パネルにフォーカスがある状態でページをリロードするとスクリーンショットが撮られる。
  - スクリーンショットにホバー → 撮られた時点が Overview ペインに黄色い線で表示される。
  - サムネイルをクリック → そのスクリーンショット以降に発生したリクエストを除外する。
  - サムネイルをダブルクリック → 拡大する。

#### 10.2 XHR のリプレイ（Replay XHR）

**Requests** テーブルで次のいずれか:
- リクエストを選択して <kbd>R</kbd> を押す。
- リクエストを右クリックして **Replay XHR** を選ぶ。

〔補足（一般知識）〕診断では「同一のリクエストを再送してレース条件・冪等性・トークン再利用を観察する」用途に使える。パラメータを変えて送りたい場合は後述の **Copy as fetch** で Console に貼り付けて改変する方法が確実。

#### 10.3 読み込み挙動の変更

**キャッシュを無効化して初回訪問者をエミュレートする**
**Disable cache** チェックボックスをチェックする。DevTools がブラウザキャッシュを無効化する。再訪時はキャッシュから配信されるため、初回ユーザ体験をより正確にエミュレートできる。
他のパネルで作業中にキャッシュを無効化したい場合は **Network conditions** ドロワーを使う:
1. **Network conditions** アイコンをクリックしてドロワーを開く。
2. **Disable cache** チェックボックスをチェック/アンチェックする。

**キャッシュの手動クリア**: **Requests** テーブルのどこかを右クリック → **Clear browser cache**。

**Cookie の手動クリア**: **Requests** テーブルのどこかを右クリック → **Clear browser cookies**。

**オフラインのエミュレート**: **Disable cache** チェックボックス隣の **Network throttling** ドロップダウンから **Offline** を選ぶ。DevTools は **Network** タブの隣に警告アイコンを表示してオフラインが有効であることを示す。

**低速ネットワークのエミュレート**: slow 3G、fast 3G などは **Throttling** メニューから対応オプションを選ぶ。

**カスタム throttling プロファイルの作成**:
1. **Throttling** メニューを開いて **Custom > Add...** を選ぶ。
2. **Settings > Throttling** の説明に従って新しい throttling プロファイルを設定する。
3. **Network** パネルに戻り、**Throttling** ドロップダウンから新しいプロファイルを選ぶ。

**WebSocket 接続の throttling**（バージョン 99 以降、HTTP リクエストに加えて WebSocket も throttle される）:
1. 新しい接続を開始する（例: テストツール https://www.piesocket.com/websocket-tester を使う）。
2. **Network** パネルで **No throttling** を選び、接続経由でメッセージを送る。
3. **非常に遅いカスタム throttling プロファイル**（例: `10 kbit/s`）を作る。このような遅いプロファイルなら差が分かりやすい。
4. **Network** パネルでそのプロファイルを選び、別のメッセージを送る。
5. **WS** フィルタを切り替え、接続名をクリックし、**Messages** タブを開き、throttling の有無で送信メッセージとエコーメッセージの時間差を確認する。

**User agent の上書き**:
1. **Network conditions** アイコンをクリックしてドロワーを開く。
2. **Select automatically** のチェックを外す。
3. メニューから user agent を選ぶ、またはテキストボックスにカスタムのものを入れる。

#### 10.4 リクエストのフィルタ（プロパティ一覧を完全再現）

**Filter** テキストボックスでドメインやサイズなどのプロパティでフィルタする。フィルタを反転するには隣の **Invert** チェックボックスをチェックする。
**スペース区切りで複数プロパティを同時に使える。** 例: `mime-type:image/gif larger-than:1K` は 1 キロバイトより大きい全 GIF を表示する。**この複数プロパティフィルタは AND 演算と等価。OR 演算は現在サポートされていない。**

サポートされるプロパティの完全一覧:

| プロパティ | 意味（原文の訳） |
|---|---|
| `cookie-domain` | 特定の cookie domain を設定するリソースを表示 |
| `cookie-name` | 特定の cookie name を設定するリソースを表示 |
| `cookie-path` | 特定の cookie path を設定するリソースを表示 |
| `cookie-value` | 特定の cookie value を設定するリソースを表示 |
| `domain` | 指定ドメインのリソースのみ表示。ワイルドカード `*` で複数ドメインを含められる。例: `*.com` は `.com` で終わる全ドメイン名のリソースを表示。DevTools は遭遇した全ドメインでオートコンプリートを埋める |
| `has-overrides` | `content`、`headers`、任意の override（`yes`）、または override なし（`no`）を上書きしたリクエストを表示。対応する **Has overrides** 列をリクエストテーブルに追加できる |
| `has-response-header` | 指定した HTTP レスポンスヘッダを含むリソースを表示。DevTools は遭遇した全レスポンスヘッダでオートコンプリートを埋める |
| `is` | `is:running` で `WebSocket` リソースを探す |
| `larger-than` | 指定サイズ（バイト）より大きいリソースを表示。`1000` の指定は `1k` の指定と等価 |
| `method` | 指定した HTTP メソッド種別で取得されたリソースを表示。DevTools は遭遇した全 HTTP メソッドでオートコンプリートを埋める |
| `mime-type` | 指定した MIME タイプのリソースを表示。DevTools は遭遇した全 MIME タイプでオートコンプリートを埋める |
| `mixed-content` | 全 mixed content リソース（`mixed-content:all`）、または現在表示されているものだけ（`mixed-content:displayed`）を表示 |
| `priority` | 指定値に優先度レベルが一致するリソースを表示 |
| `resource-type` | リソース種別（例: image）のリソースを表示。DevTools は遭遇した全リソース種別でオートコンプリートを埋める |
| `response-header-set-cookie` | 生の Set-Cookie ヘッダを Issues タブに表示。誤った `Set-Cookie` ヘッダを持つ不正な cookie が Network パネルでフラグされる |
| `scheme` | 保護されない HTTP（`scheme:http`）または保護された HTTPS（`scheme:https`）で取得されたリソースを表示 |
| `set-cookie-domain` | 指定値に一致する `Domain` 属性を持つ `Set-Cookie` ヘッダのあるリソースを表示。DevTools は遭遇した全 cookie domain でオートコンプリートを埋める |
| `set-cookie-name` | 指定値に一致する名前を持つ `Set-Cookie` ヘッダのあるリソースを表示。DevTools は遭遇した全 cookie 名でオートコンプリートを埋める |
| `set-cookie-value` | 指定値に一致する値を持つ `Set-Cookie` ヘッダのあるリソースを表示。DevTools は遭遇した全 cookie 値でオートコンプリートを埋める |
| `status-code` | HTTP ステータスコードが指定コードに一致するリソースのみ表示。DevTools は遭遇した全ステータスコードでオートコンプリートを埋める |
| `url` | 指定値に `url` が一致するリソースを表示 |

**種別によるフィルタ**: **All**、**Fetch/XHR**、**JS**、**CSS**、**Img**、**Media**、**Font**、**Doc**、**WS**（WebSocket）、**Wasm**（WebAssembly）、**Manifest**、**Other**（ここに挙げられていない他の種別）ボタンをクリックする。複数の種別フィルタを同時に有効にするには <kbd>Command</kbd>（Mac）/ <kbd>Control</kbd>（Windows, Linux）を押しながらクリックする。

**時間によるフィルタ**: **Overview** ペインを左右にクリック&ドラッグして、その時間枠でアクティブだったリクエストのみ表示する。**このフィルタは包含的**で、ハイライトされた時間中にアクティブだった任意のリクエストが表示される。

**文字列・正規表現・プロパティによるフィルタ（原文の演習手順）**

1. **Filter** テキストボックスに `png` と入力。テキスト `png` を含むファイルのみ表示される。
2. `/.*\.[cj]s+$/` と入力。DevTools はファイル名が `j` または `c` に 1 個以上の `s` が続く形で終わらない全リソースを除外する。
3. `-main.css` と入力。DevTools は `main.css` を除外する。パターンに一致する他のファイルがあればそれも除外される。（= **先頭 `-` で否定フィルタ**）
4. `domain:raw.githubusercontent.com` と入力。DevTools はこのドメインに一致しない URL の全リソースを除外する。
5. **Filter** テキストボックスのテキストをクリアする。

**チェックボックス系フィルタ**
- **Hide data URLs** — `data:` で始まるリクエストを隠す。「Data URL は他のドキュメントに埋め込まれた小さなファイル」。
- **Hide extension URLs** — `chrome-extension://` で始まる拡張機能のリクエストを隠す。
- **Blocked response cookies** — 何らかの理由でレスポンス cookie がブロックされたリクエスト以外を除外する（デモ: https://samesite-sandbox.glitch.me/ ）。**ブロック理由を知るには、リクエストを選び、その Cookies タブを開き、情報アイコンにホバーする。**
- **Blocked requests** — ブロックされたリクエスト以外を除外する。**Requests** テーブルはブロックされたリクエストを**赤**でハイライトする。テストには **Network request blocking** ドロワータブを使う。
- **3rd-party requests** — ページの origin と異なる origin のリクエスト以外を除外する（デモ: https://samesite-sandbox.glitch.me/ ）。

いずれも下部のステータスバーに「全体のうち表示されているリクエスト数」が出る。

#### 10.5 ヘッダとレスポンスの全文検索（Search ペイン）

「全リソースの HTTP ヘッダとレスポンスを、ある文字列または正規表現で検索したいときに **Search** ペインを使う。」

例（キャッシュポリシーが妥当か確認する）:
1. **Search** をクリック。Search ペインが Network ログの左に開く。
2. `Cache-Control` と入力して Enter。Search ペインはリソースのヘッダまたは内容で見つかった `Cache-Control` の全インスタンスを列挙する。
3. 結果をクリックして表示する。**クエリがヘッダで見つかった場合は Headers タブが開き、内容で見つかった場合は Response タブが開く。**
4. Search ペインと Timing タブを閉じる。

ショートカット: <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>F</kbd>（Mac）/ <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>（Win/Linux）で、**読み込まれた全リソースを横断してテキストを検索**する **Search** タブをドロワーに開く。

〔補足（一般知識）〕この横断検索は、クライアントサイド脆弱性ハンティングにおいて `postMessage`、`innerHTML`、`eval(`、`document.write`、`location.hash`、`dangerouslySetInnerHTML`、API キーらしき文字列などを全 JS バンドル横断で洗い出す一次スクリーニングとして使える。Sources パネルの検索（<kbd>Command</kbd>+<kbd>F</kbd>）は開いているファイル内のみなので、横断検索はドロワーの Search を使う。

#### 10.6 Request blocking（リソースを落として挙動を見る）

「ページの一部リソースが利用できないとき、ページはどう見え、どう振る舞うか。完全に失敗するか、まだある程度機能するか。ブロックして確かめる。」

1. <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> または <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Mac）で **Command Menu** を開く。
2. `block` と入力し、**Show Request Blocking** を選んで Enter。
3. **Add Pattern** をクリック。
4. `main.css` と入力。
5. **Add** をクリック。
6. ページをリロードする。予想どおり、メインのスタイルシートがブロックされたためページのスタイルが少し崩れる。Network ログの `main.css` の行に注目。**赤いテキストはリソースがブロックされたことを意味する。**
7. **Enable request blocking** チェックボックスのチェックを外す。

#### 10.7 リクエストの解析（Timing / Initiator / ヘッダ）

**タイミングの内訳（Timing breakdown phases）— 原文の説明の訳**

- **Waiting for server response (TTFB)** — ブラウザがレスポンスデータの最初のバイトを待っている。Time To First Byte の略。このタイミングには 1 往復のレイテンシとサーバがレスポンスを準備した時間が含まれる。
- **Content Download** — ブラウザがネットワークから直接、または service worker からレスポンスを受け取っている。この値はレスポンス本文の読み取りに費やした総時間。**予想より大きい値は、遅いネットワーク、またはブラウザが他の作業で忙しくレスポンスの読み取りが遅れていることを示しうる。**
- **Receiving Push** — ブラウザが HTTP/2 Server Push 経由でこのレスポンスのデータを受け取っている。
- **Reading Push** — ブラウザが以前受け取ったローカルデータを読んでいる。

**initiator と dependency の可視化**: **Requests** テーブルで <kbd>Shift</kbd> を押しながらリクエストにホバーする。**DevTools は initiator を緑、dependency を赤で色付けする。**
「**Requests** テーブルが時系列順のとき、ホバーしているリクエストの上にある最初の緑のリクエストがその dependency の initiator。さらにその上に別の緑のリクエストがあれば、それは initiator の initiator。以下同様。」

**リクエストを引き起こしたスタックトレースの確認**: 「JavaScript 文がリソースの要求を引き起こしたとき、**Initiator** 列にホバーするとリクエストに至るスタックトレースが見られる。」

**load イベント**: DevTools は `DOMContentLoaded` と `load` のタイミングを Network パネルの複数箇所で表示する。**`DOMContentLoaded` は青、`load` は赤。**

**非圧縮サイズの確認**: **Settings > Use large request rows** をチェックして **Size** 列の下側の値を見る。原文の例では `www.google.com` ドキュメントのネットワーク上の圧縮サイズが `43.8 KB`、非圧縮サイズが `136 KB`。

**provisional headers 警告**があるほか、**View HTTP header source**、**View request payload**、**View payload source**、**View URL-decoded arguments of query string parameters**、**View cookies** といったサブ機能が Network reference に存在する。

#### 10.8 エクスポート（HAR / Copy as ...）

**HAR ファイルへの保存**

「HAR (HTTP Archive) は、複数の HTTP セッションツールがキャプチャデータをエクスポートするのに使うファイル形式。形式は特定のフィールド集合を持つ JSON オブジェクト。」

2 通りの方法:
- **Requests** テーブルの任意のリクエストを右クリックして **Save all as HAR with content** を選ぶ。
- **Network** パネル上部のアクションバーで **Export HAR** をクリック。

> **注**: **DevTools は DevTools を開いてから発生した全リクエストを HAR ファイルにエクスポートする。エクスポート対象をフィルタすることはできない。** 単一リクエストを保存したい場合は「クリップボードへのコピー」を使う。

HAR の読み込み（インポート）も 2 通り:
- HAR ファイルを **Requests** テーブルにドラッグ&ドロップする。
- **Network** パネル上部のアクションバーで **Import HAR** をクリック。

> **注**: **Network** パネルは HAR ファイルからインポートされたリクエストの initiator も読み取って表示する。

**Copy メニューの全項目（原文の一覧を完全再現）**

Requests テーブルの **Name** 列でリクエストを右クリックし、**Copy** にホバーして次から選ぶ:

| メニュー項目 | 動作 |
|---|---|
| **Copy link address** | リクエストの URL をクリップボードにコピー |
| **Copy file name** | ファイル名をクリップボードにコピー |
| **Copy response** | レスポンス本文をクリップボードにコピー |
| **Copy as PowerShell** | リクエストを PowerShell コマンドとしてコピー |
| **Copy as fetch** | リクエストを fetch 呼び出しとしてコピー |
| **Copy as Node.js fetch** | リクエストを Node.js fetch 呼び出しとしてコピー |
| **Copy as cURL** | リクエストを cURL コマンドとしてコピー |
| **Copy all as PowerShell** | 全リクエストを PowerShell コマンドの連鎖としてコピー |
| **Copy all as fetch** | 全リクエストを fetch 呼び出しの連鎖としてコピー |
| **Copy all as Node.js fetch** | 全リクエストを Node.js fetch 呼び出しの連鎖としてコピー |
| **Copy all as cURL** | 全リクエストを cURL コマンドの連鎖としてコピー |
| **Copy all as HAR** | 全リクエストを HAR データとしてコピー |

〔補足（一般知識）〕**Copy as fetch** は、認証済みセッションのリクエストをそのままブラウザ Console に貼って改変再送できるため、CSRF 保護の有無・CORS 設定・パラメータ改変の影響を同一 origin 上で検証するのに適する。**Copy as cURL** はターミナル側の検査・自動化に向く（ただし Cookie や認証トークンを含むためログや共有時の取り扱いに注意）。

#### 10.9 Network パネルのレイアウト

**Hide the Filters pane**、**Use large request rows**、**Hide the Overview pane** の 3 つの調整項目がある。**Filters ペインが隠れていると Filter テキストボックスや種別ボタンが見えない**ので、フィルタが使えないと感じたらまずここを疑う。

---

### 11. Console API リファレンス（`console.*`） （出典: https://developer.chrome.com/docs/devtools/console/api/）

動画 ID `76U0gtuV9AY`。

> **gotchas**: DevTools はほとんどの `console.*` メソッドに**重大度レベル（severity level）**を割り当てる。これによりログメッセージをフィルタできる。

`debug(function)` や `monitorEvents(node)` のような Console 専用の便利メソッドは Console Utilities API 側（§12）。

| メソッド | Log level | 内容 |
|---|---|---|
| `console.assert(expression, object)` | `Error` | `expression` が `false` に評価されたとき error を書く |
| `console.clear()` | — | Console をクリアする。**Preserve Log が有効なとき `console.clear()` は無効化される** |
| `console.count([label])` | `Info` | 同じ行かつ同じ `label` で `count()` が呼ばれた回数を書く |
| `console.countReset([label])` | — | カウントをリセットする |
| `console.createTask(name)` | — | Async Stack Tagging API。現在のスタックトレースを生成した `task` オブジェクトに関連付ける `Task` インスタンスを返す |
| `console.debug(object [, object, ...])` | `Verbose` | log level が異なるだけで `console.log()` と同一 |
| `console.dir(object)` | `Info` | 指定オブジェクトの **JSON 表現**を出力する |
| `console.dirxml(node)` | `Info` | `node` の子孫の **XML 表現**を出力する |
| `console.error(object [, object, ...])` | `Error` | Console に出力し、error として整形し、**スタックトレースを含める** |
| `console.group(label)` | — | `console.groupEnd(label)` が呼ばれるまでメッセージを視覚的にグループ化する |
| `console.groupCollapsed(label)` | — | `console.group(label)` と同じだが、最初は折りたたまれた状態でログされる |
| `console.groupEnd(label)` | — | 視覚的グループ化を止める |
| `console.info(object [, object, ...])` | `Info` | `console.log()` と同一 |
| `console.log(object [, object, ...])` | `Info` | Console にメッセージを出力する |
| `console.table(array [, columns])` | `Info` | オブジェクトの配列を表としてログする |
| `console.time([label])` | — | 新しいタイマーを開始する |
| `console.timeEnd([label])` | `Info` | タイマーを停止する |
| `console.trace()` | `Info` | Console に**スタックトレース**を出力する |
| `console.warn(object [, object, ...])` | `Warning` | Console に警告を出力する |

#### コード例（原文逐語）

`console.assert`:

```js
const x = 5;
const y = 3;
const reason = 'x is expected to be less than y';
console.assert(x < y, {x, y, reason});
```

`console.count` / `countReset`:

```js
console.count();
console.count('coffee');
console.count();
console.count();
```

```js
console.countReset();
console.countReset('coffee');
```

`console.createTask`（Async Stack Tagging API）:

```js
// Task creation
const task = console.createTask(name);

// Task execution
task.run(f); // instead of f();
```

「`task` は生成コンテキストと async 関数のコンテキストの間にリンクを形成する。このリンクによって DevTools は async 操作のスタックトレースをより良く表示できる。」

`console.dir` / `console.dirxml`:

```js
console.dir(document.head);
```

```js
console.dirxml(document);
```

`console.group`（ネスト可）:

```js
const label = 'Adolescent Irradiated Espionage Tortoises';
console.group(label);
console.info('Leo');
console.info('Mike');
console.info('Don');
console.info('Raph');
console.groupEnd(label);
```

```js
const timeline1 = 'New York 2012';
const timeline2 = 'Camp Lehigh 1970';
console.group(timeline1);
console.info('Mind');
console.info('Time');
console.group(timeline2);
console.info('Space');
console.info('Extra Pym Particles');
console.groupEnd(timeline2);
console.groupEnd(timeline1);
```

`console.table`（列の絞り込み付き）:

```js
var people = [
  {
    first: 'René',
    last: 'Magritte',
  },
  {
    first: 'Chaim',
    last: 'Soutine',
    birthday: '18930113',
  },
  {
    first: 'Henri',
    last: 'Matisse',
  }
];
console.table(people);
```

「既定で `console.table()` は全テーブルデータをログする。単一列または列の部分集合を表示するには、2 番目の省略可能なパラメータに列名を文字列または文字列の配列で指定する。」

```js
console.table(people, ['last', 'birthday']);
```

`console.time` / `timeEnd`:

```js
console.time();
for (var i = 0; i < 100000; i++) {
  let square = i ** 2;
}
console.timeEnd();
```

`console.trace()`:

```js
const first = () => { second(); };
const second = () => { third(); };
const third = () => { fourth(); };
const fourth = () => { console.trace(); };
first();
```

---

### 12. Console Utilities API リファレンス（Console 専用の便利関数） （出典: https://developer.chrome.com/docs/devtools/console/utilities/）

動画 ID `hdRDTj6ObiE`。

「Console Utilities API は、よくあるタスクのための便利関数の集まりを含む: DOM 要素の選択と検査、オブジェクトの問い合わせ、読みやすい形式でのデータ表示、プロファイラの停止と開始、DOM イベントと関数呼び出しの監視、など。」

> **gotchas（極めて重要なハマりどころ）**: **これらの関数は Chrome DevTools の Console から呼んだときのみ動作する。自分のスクリプト内で呼んでも動作しない。**

#### 12.1 一覧表

| 関数 | 内容（原文の訳） |
|---|---|
| `$_` | 最も最近評価された式の値を返す |
| `$0` - `$4` | **Elements** パネルで検査した直近 5 つの DOM 要素、または Profiles パネルで選択した直近 5 つの JavaScript ヒープオブジェクトへの履歴参照。`$0` が最も最近選択されたもの、`$1` が 2 番目に最近のもの、以下同様 |
| `$(selector [, startNode])` | 指定 CSS セレクタに一致する最初の DOM 要素への参照を返す。1 引数で呼ぶと `document.querySelector()` のショートカット |
| `$$(selector [, startNode])` | 指定 CSS セレクタに一致する要素の**配列**を返す。`Array.from(document.querySelectorAll())` の呼び出しと等価 |
| `$x(path [, startNode])` | 指定 XPath 式に一致する DOM 要素の配列を返す |
| `clear()` | Console の履歴をクリアする |
| `copy(object)` | 指定オブジェクトの文字列表現をクリップボードにコピーする |
| `debug(function)` | 指定関数が呼ばれたときデバッガが起動し、**Sources** パネルで関数内にブレークする |
| `dir(object)` | 指定オブジェクトの全プロパティをオブジェクト形式で列挙表示する。`console.dir()` のショートカット |
| `dirxml(object)` | **Elements** パネルで見るような指定オブジェクトの XML 表現を出力する。`console.dirxml()` と等価 |
| `inspect(object/function)` | 指定要素/オブジェクトを適切なパネルで開いて選択する。DOM 要素なら **Elements** パネル、JavaScript ヒープオブジェクトなら Profiles パネル |
| `getEventListeners(object)` | 指定オブジェクトに登録されたイベントリスナを返す |
| `keys(object)` | 指定オブジェクトに属するプロパティ名の配列を返す |
| `monitor(function)` | 指定関数が呼ばれたとき、関数名と渡された引数を示すメッセージを Console にログする |
| `monitorEvents(object [, events])` | 指定オブジェクトで指定イベントの 1 つが発生したとき、Event オブジェクトを Console にログする |
| `profile([name])` / `profileEnd([name])` | 任意の名前付きで JavaScript CPU プロファイリングセッションを開始 / 完了し、結果を **Performance > Main** トラックに表示する |
| `queryObjects(Constructor)` | 指定コンストラクタで作られたオブジェクトの配列を返す |
| `table(data [, columns])` | 表形式でオブジェクトデータをログする。`console.table()` のショートカット |
| `undebug(function)` | 指定関数のデバッグを止める。`debug(fn)` と対で使う |
| `unmonitor(function)` | 指定関数の監視を止める。`monitor(fn)` と対で使う |
| `unmonitorEvents(object [, events])` | 指定オブジェクトとイベントのイベント監視を止める |
| `values(object)` | 指定オブジェクトに属する全プロパティの値の配列を返す |

#### 12.2 `$_` の挙動

「次の例では単純な式（`2 + 2`）が評価される。次に `$_` プロパティが評価され、同じ値を含む。」
「次の例では、評価された式は最初に名前の配列を含む。配列の長さを求めるために `$_.length` を評価すると、`$_` に格納される値は最新の評価済み式（4）になる。」

#### 12.3 `$$()` の例（逐語）

```js
let images = $$('img');
for (let each of images) {
  console.log(each.src);
}
```

`startNode` 付き:

```js
let images = $$('img', document.querySelector('.devsite-header-background'));
for (let each of images) {
  console.log(each.src);
}
```

> **注**: Console で**スクリプトを実行せずに改行するには <kbd>Shift</kbd>+<kbd>Enter</kbd>** を押す。

> **注（`$` のハマりどころ）**: jQuery のように `$` を使うライブラリを使っている場合、この機能は上書きされ、`$` はそのライブラリの実装に対応する。

`$()` について: 返り値を右クリックして **Reveal in Elements Panel** を選ぶと DOM 内でそれを見つけられ、**Scroll in to View** でページ上に表示できる。第 2 引数 `startNode` は検索の起点となる 'element' または Node を指定し、既定値は `document`。

#### 12.4 `$x()` の例（逐語）

ページ上の全 `<p>` 要素を返す:

```js
$x("//p")
```

`<a>` 要素を含む全 `<p>` 要素を返す:

```js
$x("//p[a]")
```

#### 12.5 `clear()` / `copy()`（逐語）

```js
clear();
```

```js
copy($0);
```

#### 12.6 `debug()` / `undebug()`（逐語）

```js
debug(getData);
```

```js
undebug(getData);
```

「関数でのブレークを止めるには `undebug(fn)` を使うか、UI で全ブレークポイントを無効化する。」

#### 12.7 `dir()`（逐語）

```js
document.body;
dir(document.body);
```

コマンドラインで `document.body` を直接評価した場合と、`dir()` で同じ要素を表示した場合の違いを示す例。

#### 12.8 `inspect()`（逐語）

```js
inspect(document.body);
```

「関数を inspect に渡すと、その関数は **Sources** パネルでドキュメントを開いて検査できるようにする。」

#### 12.9 `getEventListeners()`（逐語）— リスナ棚卸しに有用

```js
getEventListeners(document);
```

「`getEventListeners(object)` は指定オブジェクトに登録されたイベントリスナを返す。**返り値は、登録された各イベント型（例えば `click` や `keydown`）ごとに配列を含むオブジェクト**。各配列のメンバは、その型ごとに登録されたリスナを記述するオブジェクト。」
「指定オブジェクトに複数のリスナが登録されていれば、配列は各リスナ 1 メンバを含む。」原文の例では document 要素に `click` イベントのリスナが 2 つ登録されている。各オブジェクトはさらに展開してプロパティを調べられる。

#### 12.10 `keys()` / `values()`（逐語）

```js
let player = {
    "name": "Parzival",
    "number": 1,
    "state": "ready",
    "easterEggs": 3
};
```

`player` がグローバル名前空間で定義されていると仮定して、Console で `keys(player)` と `values(player)` を打つと結果が得られる。

```js
let player = {
    "name": "Parzival",
    "number": 1,
    "state": "ready",
    "easterEggs": 3
};

values(player);
```

#### 12.11 `monitor()` / `unmonitor()`（逐語）

```js
function sum(x, y) {
  return x + y;
}
monitor(sum);
```

```js
unmonitor(getData);
```

#### 12.12 `monitorEvents()` — イベント型マッピング表（完全再現）

```js
monitorEvents(window, "resize");
```

"resize" と "scroll" の両方を監視する配列を定義する:

```js
monitorEvents(window, ["resize", "scroll"])
```

「利用可能なイベント "types"（あらかじめ定義されたイベント集合にマップされる文字列）の 1 つを指定することもできる。」

| Event type | Corresponding mapped events |
|---|---|
| mouse | "mousedown", "mouseup", "click", "dblclick", "mousemove", "mouseover", "mouseout", "mousewheel" |
| key | "keydown", "keyup", "keypress", "textInput" |
| touch | "touchstart", "touchmove", "touchend", "touchcancel" |
| control | "resize", "scroll", "zoom", "focus", "blur", "select", "change", "submit", "reset" |

**Elements** パネルで現在選択中の入力テキストフィールドに対し "key" イベント型の全対応キーイベントを使う例:

```js
monitorEvents($0, "key");
```

監視を止めるには `unmonitorEvents(object[, events])` を使う。

#### 12.13 `unmonitorEvents()`（逐語）

window オブジェクトの全イベント監視を止める:

```js
unmonitorEvents(window);
```

選択的に止める例（現在選択中の要素の全マウスイベント監視を始め、Console 出力のノイズを減らすために "mousemove" の監視だけを止める）:

```js
monitorEvents($0, "mouse");
unmonitorEvents($0, "mousemove");
```

#### 12.14 `profile()` / `profileEnd()`（逐語）

> **注**: `profile()` と `profileEnd()` は [`console.profile()`](https://developer.mozilla.org/docs/Web/API/console/profile) と [`console.profileEnd()`](https://developer.mozilla.org/docs/Web/API/console/profileEnd) のショートハンド。

プロファイリング開始:

```js
profile("Profile 1")
```

プロファイリング停止と **Performance > Main** トラックでの結果確認:

```js
profileEnd("Profile 1")
```

プロファイルはネストできる。次はどの順序でも動く:

```js
profile('A');
profile('B');
profileEnd('A');
profileEnd('B');
```

> **注**: 複数の CPU プロファイルを同時に動かせるし、生成順に閉じる必要はない。

#### 12.15 `queryObjects()` — 生存オブジェクトの棚卸し

「Console から `queryObjects(Constructor)` を呼ぶと、指定コンストラクタで作られたオブジェクトの配列が返る。」

- `queryObjects(Promise)` — `Promise` の全インスタンスを返す。
- `queryObjects(HTMLElement)` — 全 HTML 要素を返す。
- `queryObjects(foo)`（`foo` はクラス名）— `new foo()` でインスタンス化された全オブジェクトを返す。

「**`queryObjects()` のスコープは Console で現在選択されている実行コンテキスト。**」

#### 12.16 `table()`（逐語）

```js
let names = [
  { firstName: "John", lastName: "Smith" },
  { firstName: "Jane", lastName: "Doe" },
];
table(names);
```

---

### 13. Snippets — 任意のページで再利用できるデバッグコード （出典: https://developer.chrome.com/docs/devtools/javascript/snippets/）

動画 ID `zW9ibQbYJNE`。

「**Console** で同じコードを繰り返し実行していることに気付いたら、代わりにそのコードを snippet として保存することを検討する。**Snippet はページの JavaScript コンテキストにアクセスできる。**これは bookmarklet の代替になる。」
「Snippet は **Sources** パネルで書き、**任意のページおよびシークレットモードで実行できる。**」

> **Aside**: **DevTools は snippet をローカルの preferences として保存する。DevTools は snippet を設定と一緒に sync せず、ファイルシステム経由でアクセスすることもできない。**

原文のサンプル snippet（逐語）:

```js
console.log('Hello, Snippets!');
document.body.innerHTML = '';
const p = document.createElement('p');
p.textContent = 'Hello, Snippets!';
document.body.appendChild(p);
```

**Run** ボタンをクリックすると Console ドロワーがポップアップして `Hello, Snippets!` メッセージを表示し、ページ内容が変わる。

#### 13.1 Snippets ペインを開く

- **Sources** > **More tabs** > **Snippets**
- **Command Menu** から: <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Windows/Linux）/ <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Mac）→ `Snippets` と入力 → **Show Snippets** を選び <kbd>Enter</kbd>。

**Snippets ペインは snippet をアルファベット順に並べる。**

#### 13.2 作成

**Sources パネルから**:
1. Snippets ペインを開く。
2. **New snippet** をクリック。
3. 名前を入力して <kbd>Enter</kbd> で保存。

**Command Menu から**:
1. DevTools 内のどこかにカーソルをフォーカス。
2. <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Windows/Linux）/ <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Mac）で **Command Menu** を開く。
3. `Snippet` と入力して **Create new snippet** を選び、<kbd>Enter</kbd> でコマンドを実行。

#### 13.3 編集

1. Snippets ペインを開く。
2. 編集したい snippet の名前をクリック。**Sources** が Code Editor で開く。
3. Code Editor でコードを編集する。**snippet 名の隣のアスタリスクは変更が未保存であることを意味する。**
4. <kbd>Control</kbd>+<kbd>S</kbd>（Windows/Linux）/ <kbd>Command</kbd>+<kbd>S</kbd>（Mac）で保存。

#### 13.4 実行

**Sources パネルから**:
1. Snippets ペインを開く。
2. 実行したい snippet の名前をクリック。
3. エディタ下部のアクションバーの **Run** をクリック、または <kbd>Control</kbd>+<kbd>Enter</kbd>（Windows/Linux）/ <kbd>Command</kbd>+<kbd>Enter</kbd>（Mac）を押す。

**Command Menu から**:
1. DevTools 内のどこかにカーソルをフォーカス。
2. <kbd>Control</kbd>+<kbd>O</kbd>（Windows/Linux）/ <kbd>Command</kbd>+<kbd>O</kbd>（Mac）で **Command Menu** を開く。
3. **`!` 文字に続けて**実行したい snippet 名を入力。
4. <kbd>Enter</kbd> で実行。

#### 13.5 リネーム / 削除

- リネーム: Snippets ペインで snippet 名を右クリックして **Rename** を選ぶ。
- 削除: Snippets ペインで snippet 名を右クリックして **Remove** を選ぶ。

〔補足（一般知識）〕クライアントサイド脆弱性ハンティングでは、「全 `iframe` と `postMessage` リスナを列挙する」「`innerHTML` セッタをフックしてスタックトレースを出す」といった定型調査コードを snippet として保存しておくと、任意のターゲットページで <kbd>Command</kbd>+<kbd>O</kbd> → `!<name>` の 2 操作で再利用できる。snippet はページの JS コンテキストで動くため、ページの関数やグローバルにそのままアクセスできる。
---

### 14. Performance パネルでランタイム性能を解析する （出典: https://developer.chrome.com/docs/devtools/performance/）

> **Note**: ページの読み込みを速くする方法は **Optimize Website Speed** を参照。

「ランタイム性能とは、読み込みではなくページが**動作している**ときの性能。」RAIL モデルの観点では、このチュートリアルで学ぶスキルは **Response、Animation、Idle** フェーズの解析に有用。

> **Caution**: このチュートリアルは **Chrome 59** に基づく。別のバージョンの Chrome では DevTools の UI と機能が異なる場合がある。`chrome://help` で実行中の Chrome バージョンを確認する。

#### 14.1 準備

1. **シークレットモード**で Google Chrome を開く。シークレットモードは Chrome がクリーンな状態で動くことを保証する。例えば拡張機能が多く入っていると、それらが性能測定にノイズを作る可能性がある。
2. シークレットウィンドウで次のページを読み込む。小さな青い四角が上下に動くデモ:
   `https://googlechrome.github.io/devtools-samples/jank/`
3. <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>I</kbd>（Mac）/ <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>（Windows, Linux）で DevTools を開く。

#### 14.2 モバイル CPU をシミュレートする（CPU Throttling）

「モバイルデバイスはデスクトップやラップトップよりずっと CPU パワーが低い。ページをプロファイルするときは常に CPU Throttling を使ってモバイルデバイスでの挙動をシミュレートする。」

1. DevTools で **Performance** タブをクリック。
2. **Screenshots** チェックボックスが有効であることを確認。
3. **Capture Settings** をクリック。性能メトリクスの取得方法に関する設定が現れる。
4. **CPU** に **2x slowdown** を選ぶ。DevTools が CPU を通常の 2 倍遅くなるよう throttle する。

> **注**: 他のページをテストするとき、**ローエンドのモバイルデバイスでうまく動くことを保証したいなら CPU Throttling を 20x slowdown に設定する。** このデモは 20x slowdown ではうまく動かないので、説明目的で 2x slowdown を使っている。

#### 14.3 デモのセットアップ

1. 青い四角の動きが目に見えて遅くなるまで **Add 10** をクリックし続ける。**ハイエンドマシンでは約 20 回のクリックが必要かもしれない。**
2. **Optimize** をクリック。青い四角がより速く滑らかに動くはず。
   > **注**: 最適化版と非最適化版で目に見える差がない場合、**Subtract 10** を数回クリックしてやり直す。青い四角を増やしすぎると CPU を使い切るだけで 2 つのバージョンの結果に大差が出なくなる。
3. **Un-Optimize** をクリック。青い四角が再び遅く、よりジャンクのある動きになる。

#### 14.4 記録する

1. DevTools で **Record** をクリック。DevTools がページ実行中の性能メトリクスをキャプチャする。
2. 数秒待つ。
3. **Stop** をクリック。DevTools が記録を止め、データを処理して結果を Performance パネルに表示する。

#### 14.5 結果を解析する

**FPS の解析**

「あらゆるアニメーションの性能を測る主要メトリクスは frames per second (FPS)。**ユーザはアニメーションが 60 FPS で動くと満足する。**」

1. **FPS** チャートを見る。**FPS の上に赤いバーが見えたら、フレームレートがユーザ体験を害するほど低下したことを意味する。一般に緑のバーが高いほど FPS が高い。**
2. **FPS** チャートの下に **CPU** チャートがある。**CPU** チャートの色は Performance パネル下部の **Summary** タブの色に対応する。**CPU チャートが色で埋まっているということは、記録中 CPU が使い切られていたことを意味する。CPU が長時間使い切られているのを見たら、作業量を減らす方法を探す合図。**
3. **FPS**、**CPU**、**NET** チャートにマウスをホバーする。DevTools がその時点のページのスクリーンショットを表示する。マウスを左右に動かすと記録を再生できる。**これはスクラビング（scrubbing）と呼ばれ、アニメーションの進行を手で解析するのに有用。**
4. **Frames** セクションで緑の四角の 1 つにホバーする。DevTools がそのフレームの FPS を表示する。各フレームはおそらく目標の 60 FPS をかなり下回っている。

**ボーナス: FPS meter を開く**

「もう 1 つの便利なツールが FPS meter で、ページ実行中の FPS のリアルタイム推定を提供する。」

1. <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Mac）/ <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Windows, Linux）で **Command Menu** を開く。
2. Command Menu で `Rendering` と入力し始め、**Show Rendering** を選ぶ。
3. **Rendering** タブで **FPS Meter** を有効にする。ビューポート右上に新しいオーバーレイが現れる。
4. **FPS Meter** を無効にし、<kbd>Escape</kbd> で **Rendering** タブを閉じる。

**ボトルネックを見つける**

1. Summary タブに注目。イベントが何も選択されていないとき、このタブはアクティビティの内訳を表示する。ページはほとんどの時間を rendering に費やしていた。**性能は「より少ない作業をする技」なので、目標は rendering 作業に費やす時間を減らすこと。**
2. **Main** セクションを展開。DevTools がメインスレッドのアクティビティのフレームチャートを時間軸で表示する。**x 軸は時間経過に沿った記録を表す。各バーが 1 イベント。幅が広いバーはそのイベントが長くかかったことを意味する。y 軸はコールスタックを表す。イベントが積み重なって見えるとき、上のイベントが下のイベントを引き起こしたことを意味する。**
3. 記録には大量のデータがある。**Overview**（FPS、CPU、NET チャートを含むセクション）上でクリック・ホールド・ドラッグして単一の **Animation Frame Fired** イベントにズームインする。**Main** セクションと **Summary** タブは記録の選択部分の情報のみを表示する。
   > **注**: もう 1 つのズーム方法は、**Main** セクションの背景をクリックするかイベントを選択してフォーカスし、**W、A、S、D キー**を押すこと。
4. **Animation Frame Fired** イベントの右上の**赤い三角**に注目。**赤い三角が見えたら、そのイベントに関する問題があるかもしれないという警告。**
   > **注**: **Animation Frame Fired** イベントは [`requestAnimationFrame()`](https://developer.mozilla.org/docs/Web/API/window/requestAnimationFrame) コールバックが実行されるたびに発生する。
5. **Animation Frame Fired** イベントをクリックする。**Summary** タブがそのイベントの情報を表示する。**reveal** リンクに注目。それをクリックすると DevTools が **Animation Frame Fired** イベントを開始したイベントをハイライトする。また **app.js:94** リンクに注目。それをクリックするとソースコードの該当行にジャンプする。
   > **注**: イベントを選択した後は**矢印キー**で隣のイベントを選択できる。
6. **app.update** イベントの下に紫のイベントが多数ある。もっと幅が広ければ、各々に赤い三角が付いているように見える。紫の **Layout** イベントの 1 つをクリックする。DevTools が **Summary** タブでそのイベントの詳細情報を提供する。実際に **forced reflows**（layout の別名）についての警告がある。
7. **Summary** タブで **Layout Forced** の下の **app.js:70** リンクをクリックする。DevTools が layout を強制したコード行へ連れて行く。
   > **注（原因の説明）**: このコードの問題は、各アニメーションフレームで各四角のスタイルを変え、そのあとページ上の各四角の位置を問い合わせていること。**スタイルが変わったため、ブラウザは各四角の位置が変わったかどうか分からず、位置を計算するために四角を再レイアウトしなければならない。** 詳しくは [Avoid forced synchronous layouts](https://web.dev/avoid-large-complex-layouts-and-layout-thrashing/#avoid-forced-synchronous-layouts)。

**ボーナス: 最適化版の解析**
デモで **Optimize** をクリックして最適化コードを有効にし、もう一度性能記録を取って結果を解析する。フレームレートの改善と **Main** セクションのフレームチャートのイベント減少から、最適化版のアプリがずっと少ない作業をして性能が良くなっていることが分かる。

> **注**: この「最適化」版でさえ、各四角の `top` プロパティをまだ操作しているのであまり良くない。**より良いアプローチは compositing にのみ影響するプロパティに留まること。** 詳しくは [Use transform and opacity changes for animations](https://web.dev/stick-to-compositor-only-properties-and-manage-layer-count/#use-transform-and-opacity-changes-for-animations)。

---

### 15. Memory パネルでメモリ問題を修正する （出典: https://developer.chrome.com/docs/devtools/memory-problems/）

#### 15.1 Summary（原文の 4 点）

- **Chrome Task Manager** でページが現在どれだけメモリを使っているかを調べる。
- **Timeline recordings** でメモリ使用量を時間経過で可視化する。
- **Heap Snapshots** で detached DOM tree（メモリリークのよくある原因）を特定する。
- **Allocation Timeline recordings** で JS ヒープに新しいメモリがいつ割り当てられるかを調べる。

#### 15.2 Overview — ユーザが知覚する 3 つの症状

- **ページの性能が時間経過で徐々に悪化する。** — メモリリークの症状の可能性。**メモリリークとは、ページのバグによってページが時間経過でどんどんメモリを使うようになること。**
- **ページの性能が一貫して悪い。** — メモリ膨張（memory bloat）の症状の可能性。**メモリ膨張とは、最適なページ速度に必要な以上のメモリをページが使っていること。**
- **ページの性能が遅延する、または頻繁に一時停止しているように見える。** — 頻繁なガベージコレクションの症状の可能性。**ガベージコレクションはブラウザがメモリを回収すること。いつ起こるかはブラウザが決める。コレクション中は全てのスクリプト実行が一時停止する。** したがってブラウザが頻繁に GC しているとスクリプト実行が頻繁に止まる。

**memory bloat: どれだけが「多すぎ」か**
「メモリリークは定義しやすい。サイトが徐々にどんどんメモリを使っていればリークがある。しかし memory bloat は特定しにくい。何が『メモリを使いすぎ』に当たるのか。」
「**ここに確固たる数値はない。** デバイスとブラウザによって能力が違うため。ハイエンドスマートフォンで滑らかに動く同じページがローエンドスマートフォンではクラッシュするかもしれない。」
「鍵は RAIL モデルを使ってユーザに集中すること。**自分のユーザに人気のあるデバイスを調べ、それらのデバイスでページをテストする。**体験が一貫して悪いなら、ページはそれらのデバイスのメモリ能力を超えているかもしれない。」

#### 15.3 Chrome Task Manager でリアルタイム監視

「メモリ問題の調査の出発点として Chrome Task Manager を使う。Task Manager は**ページが現在どれだけメモリを使っているか**を教えるリアルタイムモニタ。」

1. <kbd>Shift</kbd>+<kbd>Esc</kbd> を押す、または Chrome のメインメニューから **More tools > Task manager** を選んで Task Manager を開く。
2. Task Manager のテーブルヘッダを右クリックして **JavaScript memory** を有効にする。

2 つの列が示すもの:

- **Memory** 列は**ネイティブメモリ**を表す。**DOM ノードはネイティブメモリに保存される。この値が増えているなら DOM ノードが生成されている。**
- **JavaScript Memory** 列は **JS ヒープ**を表す。**この列には 2 つの値が含まれる。注目すべきは live number（括弧内の数）。live number はページ上の到達可能なオブジェクトが使っているメモリ量を表す。この数が増えているなら、新しいオブジェクトが生成されているか、既存オブジェクトが成長している。**

#### 15.4 Performance 記録でメモリリークを可視化

1. DevTools で **Performance** パネルを開く。
2. **Memory** チェックボックスを有効にする。
3. 記録を取る。

> **Tip**: **記録の開始と終了で強制ガベージコレクションをするのが良い習慣。** 記録中に **collect garbage** ボタンをクリックして GC を強制する。

デモ用コード（逐語）:

```js
var x = [];

function grow() {
  for (var i = 0; i < 10000; i++) {
    document.body.appendChild(document.createElement('div'));
  }
  x.push(new Array(1000000).join('x'));
}

document.getElementById('grow').addEventListener('click', grow);
```

「コード中で参照されているボタンを押すたび、1 万個の `div` ノードが document body に追加され、100 万個の `x` 文字の文字列が `x` 配列に push される。」

UI の説明（原文）:
「**Overview** ペイン（**NET** の下）の **HEAP** グラフが JS ヒープを表す。**Overview** ペインの下が **Counter** ペイン。ここでは **JS heap**（Overview の HEAP グラフと同じ）、**documents**、**DOM nodes**、**listeners**、**GPU memory** に分けたメモリ使用量が見える。チェックボックスを無効にするとグラフから隠れる。」

解析（原文）:
「ノードカウンタ（緑のグラフ）を見るとコードときれいに対応している。**ノード数が離散的なステップで増える。ノード数の各増加が `grow()` の呼び出しだと推定できる。** JS ヒープグラフ（青のグラフ）はそれほど単純でない。ベストプラクティスに従い、最初の落ち込みは実際には強制ガベージコレクション（**collect garbage** ボタンを押して達成）。記録が進むにつれ JS ヒープサイズがスパイクするのが見える。これは自然で予想どおり: JavaScript コードがボタンクリックごとに DOM ノードを生成し、100 万文字の文字列を生成するのに多くの作業をしている。**ここで鍵となるのは、JS ヒープが始まったときより高く終わっているという事実（ここでの「始まり」は強制 GC の後の時点）。実世界でこの JS ヒープサイズやノードサイズの増加パターンを見たら、それは潜在的にメモリリークを意味する。**」

#### 15.5 Heap Snapshots で detached DOM tree を発見する

「DOM ノードは、ページの DOM ツリーからも JavaScript コードからも参照がないときのみガベージコレクトされうる。**DOM ツリーから取り除かれたが一部の JavaScript がまだ参照しているノードを「detached」と言う。detached DOM ノードはメモリリークのよくある原因。**」

detached DOM ノードの単純な例（逐語）:

```js
var detachedTree;

function create() {
  var ul = document.createElement('ul');
  for (var i = 0; i < 10; i++) {
    var li = document.createElement('li');
    ul.appendChild(li);
  }
  detachedTree = ul;
}

document.getElementById('create').addEventListener('click', create);
```

「コード中で参照されているボタンをクリックすると 10 個の `li` 子を持つ `ul` ノードが生成される。これらのノードはコードから参照されているが DOM ツリーには存在しないので detached である。」

「Heap snapshot は detached ノードを特定する一つの方法。名前が示すように、heap snapshot は**スナップショット時点で**ページの JS オブジェクトと DOM ノードの間でメモリがどう分布しているかを示す。」

スナップショットの作成:
1. DevTools を開いて **Memory** パネルへ行く。
2. **Heap Snapshot** ラジオボタンを選択。
3. **Take Snapshot** ボタンを押す。

「スナップショットは処理と読み込みに時間がかかることがある。終わったら左側のパネル（**HEAP SNAPSHOTS** という名前）から選択する。」

**detached DOM tree を検索するには、Class filter テキストボックスに `Detached` と入力する。**

「キャレットを展開して detached ツリーを調べる。」

**色の意味（重要）**:
「**黄色でハイライトされたノードは JavaScript コードから直接参照されている。赤でハイライトされたノードは直接の参照を持たない。それらは黄色ノードのツリーの一部であるためだけに生きている。一般に黄色のノードに集中すべき。黄色ノードが必要以上に長く生きないようにコードを直せば、黄色ノードのツリーの一部である赤ノードも消える。**」

「黄色ノードをクリックしてさらに調べる。**Objects** ペインで、それを参照しているコードについての情報が見られる。例えば `detachedTree` 変数がノードを参照していることが分かる。この特定のメモリリークを直すには、`detachedTree` を使うコードを調べ、ノードが不要になったときに参照を取り除くようにする。」

#### 15.6 Allocation Timeline で JS ヒープのリークを特定する

デモ用コード（逐語）:

```js
var x = [];

function grow() {
  x.push(new Array(1000000).join('x'));
}

document.getElementById('grow').addEventListener('click', grow);
```

記録手順（原文）: DevTools を開き、**Profiles** パネルへ行き、**Record Allocation Timeline** ラジオボタンを選択し、**Start** ボタンを押し、メモリリークを起こしていると疑う操作を実行し、終わったら **stop recording** ボタンを押す。

「記録中、Allocation Timeline に**青いバー**が現れるかどうかに注目する。」
「**それらの青いバーは新しいメモリ割り当てを表す。それらの新しいメモリ割り当てがメモリリークの候補。** バーにズームすると **Constructor** ペインを、指定時間枠に割り当てられたオブジェクトのみ表示するようフィルタできる。」
「オブジェクトを展開してその値をクリックすると **Object** ペインで詳細が見られる。例えば新しく割り当てられたオブジェクトの詳細を見ると、それが `Window` スコープの `x` 変数に割り当てられたことが分かる。」

#### 15.7 関数別のメモリ割り当て調査（Allocation Sampling）

「**Memory** パネルの **Allocation Sampling** 種別を使って JavaScript 関数別のメモリ割り当てを見る。」

1. **Allocation Sampling** ラジオボタンを選択。**ページに worker があれば、Start ボタンの隣のドロップダウンでそれをプロファイリング対象として選べる。**
2. **Start** ボタンを押す。
3. 調べたい操作をページで実行する。
4. 全操作を終えたら **Stop** ボタンを押す。

「DevTools が関数別のメモリ割り当ての内訳を表示する。**既定のビューは Heavy (Bottom Up) で、最も多くメモリを割り当てた関数を上に表示する。**」

#### 15.8 頻繁なガベージコレクションの発見

「ページが頻繁に一時停止しているように見えるなら、ガベージコレクションの問題があるかもしれない。」
「Chrome Task Manager または Timeline のメモリ記録のどちらでも頻繁な GC を発見できる。**Task Manager では Memory または JavaScript Memory の値が頻繁に上下するのが頻繁な GC を表す。Timeline 記録では JS ヒープまたはノード数のグラフが頻繁に上下するのが頻繁な GC を示す。**」
「問題を特定したら、Allocation Timeline 記録を使ってどこでメモリが割り当てられ、どの関数が割り当てを起こしているかを調べられる。」

---

### 16. キーボードショートカット完全表 （出典: https://developer.chrome.com/docs/devtools/shortcuts/）

#### 16.1 DevTools を開く

| Action | Mac | Windows / Linux |
|---|---|---|
| Open whatever panel you used last | <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>I</kbd> | <kbd>F12</kbd> or <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> |
| Open the **Console** panel | <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>J</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd> |
| Open the **Elements** panel | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> or <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>C</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> |

#### 16.2 グローバル（ほぼ全パネルで有効）

| Action | Mac | Windows / Linux |
|---|---|---|
| Show **Settings** | <kbd>?</kbd> or <kbd>Function</kbd>+<kbd>F1</kbd> | <kbd>?</kbd> or <kbd>F1</kbd> |
| Focus the next panel | <kbd>Command</kbd>+<kbd>]</kbd> | <kbd>Control</kbd>+<kbd>]</kbd> |
| Focus the previous panel | <kbd>Command</kbd>+<kbd>[</kbd> | <kbd>Control</kbd>+<kbd>[</kbd> |
| Switch back to last docking position（セッション中ずっと既定位置なら別ウィンドウへ undock） | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> |
| Toggle **Device Mode** | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> |
| Toggle **Inspect Element Mode** | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> |
| Open the **Command Menu** | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> |
| Toggle the **Drawer** | <kbd>Escape</kbd> | <kbd>Escape</kbd> |
| Normal reload | <kbd>Command</kbd>+<kbd>R</kbd> | <kbd>F5</kbd> or <kbd>Control</kbd>+<kbd>R</kbd> |
| Hard reload | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> | <kbd>Control</kbd>+<kbd>F5</kbd> or <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> |
| 現在のパネル内テキスト検索（Elements, Console, Sources, Performance, Memory, JavaScript Profiler, Quick Source のみ対応） | <kbd>Command</kbd>+<kbd>F</kbd> | <kbd>Control</kbd>+<kbd>F</kbd> |
| ドロワーの **Search** タブを開く（**読み込まれた全リソースを横断検索**） | <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>F</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> |
| **Sources** パネルでファイルを開く | <kbd>Command</kbd>+<kbd>O</kbd> or <kbd>Command</kbd>+<kbd>P</kbd> | <kbd>Control</kbd>+<kbd>O</kbd> or <kbd>Control</kbd>+<kbd>P</kbd> |
| Zoom in | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>+</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>+</kbd> |
| Zoom out | <kbd>Command</kbd>+<kbd>-</kbd> | <kbd>Control</kbd>+<kbd>-</kbd> |
| Restore default zoom level | <kbd>Command</kbd>+<kbd>0</kbd> | <kbd>Control</kbd>+<kbd>0</kbd> |
| Run snippet | <kbd>Command</kbd>+<kbd>O</kbd> → `!` + スクリプト名 → <kbd>Enter</kbd> | <kbd>Control</kbd>+<kbd>O</kbd> → `!` + スクリプト名 → <kbd>Enter</kbd> |

#### 16.3 Sources パネル

| Action | Mac | Windows / Linux |
|---|---|---|
| Pause script execution (if currently running) or resume (if currently paused) | <kbd>F8</kbd> or <kbd>Command</kbd>+<kbd>\</kbd> | <kbd>F8</kbd> or <kbd>Control</kbd>+<kbd>\</kbd> |
| Step over next function call | <kbd>F10</kbd> or <kbd>Command</kbd>+<kbd>'</kbd> | <kbd>F10</kbd> or <kbd>Control</kbd>+<kbd>'</kbd> |
| Step into next function call | <kbd>F11</kbd> or <kbd>Command</kbd>+<kbd>;</kbd> | <kbd>F11</kbd> or <kbd>Control</kbd>+<kbd>;</kbd> |
| Step out of current function | <kbd>Shift</kbd>+<kbd>F11</kbd> or <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>;</kbd> | <kbd>Shift</kbd>+<kbd>F11</kbd> or <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>;</kbd> |
| Continue to a certain line of code while paused | Hold <kbd>Command</kbd> and then click the line of code | Hold <kbd>Control</kbd> and then click the line of code |
| Select the call frame below / above the currently-selected frame | <kbd>Control</kbd>+<kbd>.</kbd> / <kbd>Control</kbd>+<kbd>,</kbd> | <kbd>Control</kbd>+<kbd>.</kbd> / <kbd>Control</kbd>+<kbd>,</kbd> |
| Save changes to local modifications | <kbd>Command</kbd>+<kbd>S</kbd> | <kbd>Control</kbd>+<kbd>S</kbd> |
| Save all changes | <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>S</kbd> | <kbd>Control</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> |
| Go to line | <kbd>Control</kbd>+<kbd>G</kbd> | <kbd>Control</kbd>+<kbd>G</kbd> |
| 現在開いているファイルの行番号へジャンプ | <kbd>Command</kbd>+<kbd>O</kbd> → `:` + 行番号 → <kbd>Enter</kbd> | <kbd>Control</kbd>+<kbd>O</kbd> → `:` + 行番号 → <kbd>Enter</kbd> |
| 列へジャンプ（例: 5 行 9 列） | <kbd>Command</kbd>+<kbd>O</kbd> → `:` 行番号 `:` 列番号 → <kbd>Enter</kbd> | <kbd>Control</kbd>+<kbd>O</kbd> → `:` 行番号 `:` 列番号 → <kbd>Enter</kbd> |
| 関数宣言（HTML/スクリプト）またはルールセット（スタイルシート）へジャンプ | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> → 名前を入力または一覧から選択 | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> → 名前を入力または一覧から選択 |
| Close the active tab | <kbd>Option</kbd>+<kbd>W</kbd> | <kbd>Alt</kbd>+<kbd>W</kbd> |
| Open next or previous tab | <kbd>Function</kbd>+<kbd>Command</kbd>+<kbd>Up</kbd> or <kbd>Down</kbd> | <kbd>Control</kbd>+<kbd>Page Up</kbd> or <kbd>Page Down</kbd> |
| Toggle the **Navigation** sidebar on the left | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>Y</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>Y</kbd> |
| Toggle the **Debugger** sidebar on the right | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> |

#### 16.4 Code Editor

| Action | Mac | Windows / Linux |
|---|---|---|
| Delete all characters in the last word, up to the cursor | <kbd>Option</kbd>+<kbd>Delete</kbd> | <kbd>Control</kbd>+<kbd>Delete</kbd> |
| line-of-code ブレークポイントの追加/削除 | カーソルを行に置いて <kbd>Command</kbd>+<kbd>B</kbd> | カーソルを行に置いて <kbd>Control</kbd>+<kbd>B</kbd> |
| **条件付きブレークポイントや logpoint を編集するダイアログを開く** | カーソルを行に置いて <kbd>Command</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> | カーソルを行に置いて <kbd>Control</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> |
| Go to matching bracket | <kbd>Control</kbd>+<kbd>M</kbd> | <kbd>Control</kbd>+<kbd>M</kbd> |
| 単一行コメントのトグル（複数行選択時は各行先頭にコメント追加） | <kbd>Command</kbd>+<kbd>/</kbd> | <kbd>Control</kbd>+<kbd>/</kbd> |
| カーソル位置の単語の次の出現を選択/選択解除（同時ハイライト） | <kbd>Command</kbd>+<kbd>D</kbd> / <kbd>Command</kbd>+<kbd>U</kbd> | <kbd>Control</kbd>+<kbd>D</kbd> / <kbd>Control</kbd>+<kbd>U</kbd> |

#### 16.5 Network パネル

| Action | Mac | Windows / Linux |
|---|---|---|
| Start / stop recording | <kbd>Command</kbd>+<kbd>E</kbd> | <kbd>Control</kbd>+<kbd>E</kbd> |
| Record a reload | <kbd>Command</kbd>+<kbd>R</kbd> | <kbd>Control</kbd>+<kbd>R</kbd> |
| Replay a selected XHR request | <kbd>R</kbd> | <kbd>R</kbd> |
| Hide the details of a selected request | <kbd>Escape</kbd> | <kbd>Escape</kbd> |

#### 16.6 Performance / Memory パネル

| Action | Mac | Windows / Linux |
|---|---|---|
| Performance: Start / stop recording | <kbd>Command</kbd>+<kbd>E</kbd> | <kbd>Control</kbd>+<kbd>E</kbd> |
| Performance: Save recording | <kbd>Command</kbd>+<kbd>S</kbd> | <kbd>Control</kbd>+<kbd>S</kbd> |
| Performance: Load recording | <kbd>Command</kbd>+<kbd>O</kbd> | <kbd>Control</kbd>+<kbd>O</kbd> |
| Memory: Start / stop recording | <kbd>Command</kbd>+<kbd>E</kbd> | <kbd>Control</kbd>+<kbd>E</kbd> |

#### 16.7 Console パネル

| Action | Mac | Windows / Linux |
|---|---|---|
| Accept autocomplete suggestion | <kbd>Right Arrow</kbd> or <kbd>Tab</kbd> | <kbd>Right Arrow</kbd> or <kbd>Tab</kbd> |
| Reject autocomplete suggestion | <kbd>Escape</kbd> | <kbd>Escape</kbd> |
| Navigate the autocomplete list up or down | <kbd>Up</kbd> / <kbd>Down</kbd> or <kbd>Control</kbd>+<kbd>P</kbd> / <kbd>N</kbd> | 同左 |
| Get previous statement | <kbd>Up Arrow</kbd> | <kbd>Up Arrow</kbd> |
| Get next statement | <kbd>Down Arrow</kbd> | <kbd>Down Arrow</kbd> |
| Focus the **Console** | <kbd>Control</kbd>+<kbd>`</kbd> | <kbd>Control</kbd>+<kbd>`</kbd> |
| Clear the **Console** | <kbd>Command</kbd>+<kbd>K</kbd> or <kbd>Option</kbd>+<kbd>L</kbd> | <kbd>Control</kbd>+<kbd>L</kbd> |
| 複数行入力を強制（既定で複数行シナリオを検出するため通常は不要） | <kbd>Shift</kbd>+<kbd>Return</kbd> | <kbd>Shift</kbd>+<kbd>Enter</kbd> |
| Execute | <kbd>Return</kbd> | <kbd>Enter</kbd> |
| ログ済みオブジェクトの全サブプロパティを展開 | <kbd>Alt</kbd> を押しながら **Expand** **>** をクリック | 同左 |

#### 16.8 Search タブ

| Action | Mac | Windows / Linux |
|---|---|---|
| Expand/collapse all search results | <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>{</kbd> or <kbd>}</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>{</kbd> or <kbd>}</kbd> |

---

### 17. よくあるハマりどころ（原文に明記されているものだけを整理）

| # | 症状 | 原因と対処（出典） |
|---|---|---|
| 1 | Event listener breakpoint で「知らない行」に止まる | ブラウザ拡張が全ページに `click` リスナを登録している。**シークレットモード**（拡張が全て無効）で試す、または **Settings > Ignore List > Add content scripts to ignore list** を有効にする（javascript/index.md、settings/ignore-list） |
| 2 | Console から `debug(fn)` が `ReferenceError` になる | その関数がスコープ外。**スコープ内になる場所に line-of-code ブレークポイントを置き、停止中に `debug()` を呼ぶ**（breakpoints.md） |
| 3 | Console で `$` が DevTools の `$()` として動かない | jQuery など `$` を使うライブラリが `$` を上書きしている（console/utilities） |
| 4 | Console ユーティリティ（`monitorEvents` など）をスクリプトに書いても動かない | **これらは Chrome DevTools の Console から呼んだときのみ動作する**（console/utilities の gotchas） |
| 5 | source map が読み込まれない | ①**Settings > Preferences > Sources > Enable JavaScript source maps** が未チェック ②DevTools 自身が source map を取得しに行くため **cross-origin 扱いで通らない** → **Developer Resources の `Enable loading through target` をチェック** ③それでも駄目なら `Add source map` で手動指定（source-maps.md、developer-resources.md） |
| 6 | Network で **Override content** を選んだら元ソースへのダイアログが出る | **source-mapped ファイルは override できない**（overrides.md の note） |
| 7 | Elements パネルの DOM ツリー編集が override に保存されない | **DevTools は Elements パネルの DOM ツリーで加えた変更を保存しない**（overrides.md の Limitations） |
| 8 | Styles ペインの CSS 編集が override に保存されない | **その CSS のソースが HTML ファイルの場合は保存されない。代わりに Sources パネルで HTML を編集する**（overrides.md の Limitations） |
| 9 | Network パネルで Filter テキストボックスや種別ボタンが見えない | **Filters ペインが隠れている**（network/reference の filter 節） |
| 10 | Network の総リクエスト数・総サイズが実際と合わない | **DevTools を開いてから記録されたリクエストのみカウントする。DevTools を開く前のリクエストは数えない**（network/reference の caution） |
| 11 | HAR エクスポートで一部だけ出したい | **エクスポート対象をフィルタできない。** DevTools を開いてからの全リクエストが出る。単一リクエストは Copy メニューを使う（network/reference の note） |
| 12 | Restart frame で引数値が `0` に戻らない | **フレーム restart は引数をリセットしない。** 実行ポインタを関数先頭に移すだけで、引数値はメモリ上に残る（javascript/reference の gotchas） |
| 13 | Restart frame ができない関数がある | **WebAssembly、async、generator 関数は restart できない**（javascript/reference の note） |
| 14 | live edit が適用できない | **Call Stack 最上位の関数のみ編集可。スタック下方に同じ関数の再帰呼び出しがあると不可。** 適用時に自動 restart されるため restart の制約も適用される（javascript/reference の live-edit） |
| 15 | 停止中に呼び出しスタックの順序をプログラム的に変えた | **予期しないエラーを引き起こす場合がある**（javascript/reference の caution） |
| 16 | Node.js セッションで caught 例外だけで止められない | **uncaught でも止める設定にしないと caught だけでは止められない**（[crbug 1382762](https://crbug.com/1382762)、breakpoints.md の gotchas） |
| 17 | `console.clear()` が効かない | **Preserve Log が有効なとき `console.clear()` は無効化される**（console/api） |
| 18 | Subtree modifications DOM ブレークポイントが発火しない | **子ノードの属性変更、および現在選択中ノード自身への変更では発火しない**（breakpoints.md の DOM types） |
| 19 | Performance の計測にノイズが混じる | **シークレットモードで開く。** 拡張機能が性能測定にノイズを作る（performance.md） |
| 20 | モバイル実機と結果が合わない | **CPU Throttling を使う。ローエンドモバイル想定なら 20x slowdown**（performance.md） |
| 21 | Snippet がファイルシステムに見つからない / 別マシンで見えない | **DevTools は snippet をローカル preferences として保存し、設定と sync せず、ファイルシステム経由でアクセスできない**（snippets.md の Aside） |
| 22 | Sources の Editor 内検索で他ファイルが引っかからない | <kbd>Command</kbd>+<kbd>F</kbd> は現在のパネル/ファイル内のみ。**横断検索はドロワーの Search タブ（<kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>F</kbd> / <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>）**（shortcuts.md） |
| 23 | DevTools で修正したのに他ユーザには直っていない | **このワークフローはブラウザ内で動いているコードにだけ修正を当てる。サーバ上のコードを直す必要がある**（javascript/index.md の caution） |
| 24 | minified ファイルが勝手に整形されて元の姿が見たい | **既定で pretty-print されている。Editor 左下の `{ }` をクリックすると読み込まれたままの姿になる**（javascript/reference の format） |

---

## 脆弱性ハンティング（クライアントサイド）への応用整理

本節は、上記の公式機能記述を「許可された検証・バグバウンティ」の診断手順にマッピングしたもの。〔補足（一般知識）〕を含む。

〔補足（一般知識）〕以下は原文の機能説明から導いた運用上の対応づけであり、公式ドキュメントが「脆弱性診断手順」として明記しているものではない（例外: Trusted Type breakpoints の節は公式が DOM-based XSS の source/sink を明示している）。

| 目的 | 使う DevTools 機能（本ノートの節） | 要点 |
|---|---|---|
| DOM-based XSS の sink 到達を実行時に捕まえる | **CSP Violation Breakpoints > Sink Violations / Policy Violations**（§2.11） | Trusted Types 導入済みページなら sink 到達で停止し、Call Stack から source を逆追跡できる |
| sink を書くコードを静的に洗い出す | ドロワーの **Search**（§10.5、<kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>） | 読み込まれた全リソースを横断して `innerHTML`、`eval(`、`document.write`、`postMessage`、`location.hash` 等を検索 |
| minified バンドルを読む | **pretty print**（§6.1）＋ **source map**（§4）＋ **Authored/Deployed グループ化**（§6.6）＋ **手動 source map 読み込み**（§5.4） | production に source map がなくても自前でビルドした map を `Add source map` で当てられる |
| ノイズ（拡張・3rd party）を排除 | **Ignore List**（§7）、**Hide extension URLs**（§10.4） | 拡張の content script、既知 3rd party（source map の `ignoreList`）、カスタム RegEx で除外 |
| 特定 API 呼び出しの発生源を特定 | **`debug(fn)` / Function breakpoint**（§2.10）、**`monitor(fn)`**（§12.11）、**Initiator 列のスタックトレース**（§10.7） | `debug()` は関数 1 行目の line-of-code ブレークポイントと等価 |
| イベントリスナの棚卸し | **`getEventListeners(object)`**（§12.9）、**Elements > Event Listeners**、**Event Listener Breakpoints**（§2.8） | `message` イベントのリスナ有無は postMessage 脆弱性の起点確認に使える |
| 生存オブジェクト・インスタンスの列挙 | **`queryObjects(Constructor)`**（§12.15） | スコープは Console で選択中の実行コンテキスト。iframe / worker を調べるときはコンテキストを切り替える |
| worker / service worker のコードを追う | **Threads ペインでのコンテキスト切替**（§3.8）、**Allocation Sampling の worker 選択**（§15.7） | |
| 特定 API へのリクエストで止める | **XHR/fetch breakpoints**（§2.7） | URL 部分文字列一致で `send()` 行に停止 |
| レスポンスを改変してフロントの処理を単独検証 | **Local Overrides の Override content / XHR・fetch モック**（§8.3、§8.4） | サーバに攻撃リクエストを送らずにクライアント側パーサを検証できる |
| セキュリティヘッダの効果をローカル検証 | **Override headers / `.headers` ファイル**（§8.6、§8.7） | CORS、Permissions-Policy、Cross-Origin Isolation。ワイルドカード `*` / `?` で複数リクエストに適用 |
| Cookie 属性・SameSite 問題の確認 | **Blocked response cookies フィルタ**（§10.4）、`set-cookie-*` / `cookie-*` フィルタ、Cookies タブの情報アイコン | ブロック理由は Cookies タブの情報アイコンにホバー |
| mixed content / 平文通信の検出 | フィルタ `mixed-content:all`、`scheme:http`（§10.4） | |
| リクエストを改変して再送 | **Copy as fetch**（§10.8）を Console に貼って改変、**Replay XHR**（§10.2） | |
| 依存リソース欠落時の挙動（fail-open）確認 | **Request blocking**（§10.6） | Command Menu → `Show Request Blocking` → Add Pattern |
| 定型調査コードの再利用 | **Snippets**（§13） | <kbd>Command</kbd>+<kbd>O</kbd> → `!<name>` で任意ページで実行。ページの JS コンテキストにアクセスできる |
| 証跡の保全 | **Save all as HAR with content**（§10.8）、**Copy stack trace**（§3.15）、**Changes ドロワー**（§8.5） | HAR は DevTools を開いてからの全リクエストを含む（フィルタ不可）ので、機微情報の取り扱いに注意 |

---

## 読者が自分で開くべき資料

### A. 取得できなかった担当URL（必読の読みどころ付き）

#### A-1. https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/

**なぜ取得できなかったか**: 本作業環境の外向き HTTPS は組織のポリシー強制型 egress プロキシを通っており、`devplaybook.cc` はそのプロキシの許可リストに入っていない。WebFetch は `EGRESS_BLOCKED`、curl は CONNECT 時に `403` を返した（プロキシ側の記録は `gateway answered 403 to CONNECT (policy denial or upstream failure)`）。`web.archive.org` も同様に 403 で、アーカイブ経由の迂回もできない。WebSearch による二次情報での代替も、本セッションの検索予算（200/200 回）を使い切っていたため実行できなかった。**組織のポリシー拒否は迂回を試みるべきものではないため、これ以上の再試行は行っていない。**

**読者が自分で開いたときに読むべきところ（読みどころ）**:
1. **タイトルに "2026" とあるため、2026 年時点の DevTools UI 変更点**を最優先で読む。本ノートの基礎は公式ドキュメントの 2022〜2023 年更新版に基づいており、**Performance パネルの Insights / Live metrics、Sources パネルのレイアウト変更、AI assistance パネル**などの新しい要素は本ノートに含まれていない。
2. **記事独自のワークフロー例・チェックリスト**（公式ドキュメントはリファレンス中心なので、実務での「どの順番で何を見るか」の判断順序）。
3. **公式ドキュメントとの差分**: 本ノートの §2 の 9 種ブレークポイント表、§8 の Local Overrides 手順、§10.4 の Network フィルタプロパティ表と照合し、記事に**新しいフィルタ・新しいブレークポイント種別・非推奨化された機能**が書かれていないか確認する。
4. **記事が示す具体的なコードスニペット/正規表現**。本ノートの逐語コードは公式ドキュメント由来なので、記事独自のものは取り込まれていない。
5. **Local Overrides の 2026 年時点の UI 差**（フォルダ選択ダイアログ、`.headers` エディタの見た目、Overrides の有効/無効トグルの位置）。
6. **パフォーマンス/メモリ節の記述**が本ノート §14（Chrome 59 ベースの公式チュートリアル）よりどれだけ新しいか。**特に Performance パネルは公式チュートリアル自身が「Chrome 59 に基づく」と caution しているため、この記事のほうが実機 UI に近い可能性が高い。**

#### A-2. https://www.browserstack.com/guide/how-to-debug-js-in-chrome

**なぜ取得できなかったか**: 同上。`www.browserstack.com` も egress プロキシの許可リスト外で、WebFetch は `EGRESS_BLOCKED`、curl は CONNECT `403`。web.archive.org も 403。

**読者が自分で開いたときに読むべきところ（読みどころ）**:
1. **初学者向けの段階的な手順**（DevTools の開き方 → Sources → ブレークポイント → ステップ実行）。本ノート §1 と重複するが、**スクリーンショットの新しさ**を確認する価値がある。
2. **BrowserStack 固有のクロスブラウザ/実機デバッグへの接続部分**。公式 Chrome ドキュメントには存在しない観点で、「ローカル Chrome では再現しないが実機 Android Chrome では再現する」類の問題の扱い方が書かれている可能性がある。これは本ノートに一切含まれていない情報。
3. **モバイル Chrome のリモートデバッグ（USB / `chrome://inspect`）への言及**。本ノートは扱っていない。
4. **記事中の「よくあるエラーと対処」表**（もしあれば）。本ノート §17 は公式ドキュメント明記のハマりどころだけなので、記事側の一覧と突き合わせる。
5. **記事が示すデバッグ対象のサンプルコード**。本ノートのサンプルは公式デモ（`devtools-samples/debug-js/get-started`、`devtools-samples/jank`）のみ。

### B. 本ノートが代替として使った一次資料（原典として読むべきもの）

公開版 URL（読者はこちらを開くとよい）:

1. **Debug JavaScript**（基本 7 ステップ）— https://developer.chrome.com/docs/devtools/javascript/
2. **Pause your code with breakpoints**（9 種のブレークポイント。**Trusted Type / CSP Violation Breakpoints の節は DOM-based XSS 診断に直結**）— https://developer.chrome.com/docs/devtools/javascript/breakpoints/
3. **JavaScript debugging reference**（ステッピング、Call Stack、Restart frame、live edit、pretty print、Ignore List、Authored/Deployed）— https://developer.chrome.com/docs/devtools/javascript/reference/
4. **Debug your original code instead of deployed with source maps** — https://developer.chrome.com/docs/devtools/javascript/source-maps/
5. **Developer Resources: View and manually load source maps**（`Enable loading through target`、`Add source map`）— https://developer.chrome.com/docs/devtools/developer-resources
6. **Override web content and HTTP response headers locally**（Local Overrides の全手順）— https://developer.chrome.com/docs/devtools/overrides/
7. **Edit and save files in a workspace** — https://developer.chrome.com/docs/devtools/workspaces/
8. **Console API reference** — https://developer.chrome.com/docs/devtools/console/api/
9. **Console Utilities API reference**（`monitorEvents` / `queryObjects` / `getEventListeners` / `debug` など）— https://developer.chrome.com/docs/devtools/console/utilities/
10. **Run snippets of JavaScript** — https://developer.chrome.com/docs/devtools/javascript/snippets/
11. **Inspect network activity**（Search、Request blocking）— https://developer.chrome.com/docs/devtools/network/
12. **Network features reference**（フィルタプロパティ全一覧、Timing 内訳、Copy as fetch/cURL、HAR）— https://developer.chrome.com/docs/devtools/network/reference/
13. **Analyze runtime performance** — https://developer.chrome.com/docs/devtools/performance/
14. **Fix memory problems** — https://developer.chrome.com/docs/devtools/memory-problems/
15. **Ignore List** — https://developer.chrome.com/docs/devtools/settings/ignore-list/
16. **Keyboard shortcuts** — https://developer.chrome.com/docs/devtools/shortcuts/

原文で参照されている外部資料（本ノートが引用しているもの）:
- Trusted Types 仕様: https://www.w3.org/TR/trusted-types/
- Prevent DOM-based cross-site scripting vulnerabilities with Trusted Types: https://web.dev/articles/trusted-types
- Implementing CSP and Trusted Types debugging in Chrome DevTools: https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems
- source maps 解説: https://web.dev/articles/source-maps
- Source Map V3 仕様: https://sourcemaps.info/spec.html
- Source maps: languages, tools and other info: https://github.com/ryanseddon/source-map/wiki/Source-maps:-languages,-tools-and-other-info
- DevTools Protocol の `Fetch.RequestPattern`（Local Overrides のワイルドカード仕様）: https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#type-RequestPattern
- `x-google-ignoreList`: https://developer.chrome.com/articles/x-google-ignore-list/
- RAIL モデル: https://web.dev/rail/
- Avoid forced synchronous layouts: https://web.dev/avoid-large-complex-layouts-and-layout-thrashing/#avoid-forced-synchronous-layouts

公式デモページ（原文が指定しているもの、実習に使える）:
- デバッグ入門デモ: https://googlechrome.github.io/devtools-samples/debug-js/get-started
- ランタイム性能（jank）デモ: https://googlechrome.github.io/devtools-samples/jank/
- Parcel + source map デモ: https://github.com/jecfish/parcel-demo
- `#sourceURL` デモ: http://www.thecssninja.com/demo/source_mapping/compile.html
- CORS ヘッダ override デモ: https://cors-demo-devtools.glitch.me/
- SameSite / blocked cookies デモ: https://samesite-sandbox.glitch.me/
- ignore-listed frames デモ（Angular）: https://ng-devtools.netlify.app/
- Workspaces デモリポジトリ: https://github.com/sofiayem/devtools-workspace-demo
- WebSocket throttling テスト: https://www.piesocket.com/websocket-tester

公式動画 ID（原文が埋め込んでいるもの）:
- Debug JavaScript: `H0XScE08hy8`
- Pause your code with breakpoints: `JyHjoaUhAus`
- source maps / Developer Resources: `SkUcO4ML5U0`（Developer Resources は 139 秒地点から）
- Console Utilities API: `hdRDTj6ObiE`
- Console API: `76U0gtuV9AY`
- Snippets: `zW9ibQbYJNE`
- Workspaces: `Zu9CdbnS5ps`
