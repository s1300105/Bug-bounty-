# Console・Snippets・Performance・Memory と脆弱性ハンティングへの応用（DevTools 実践 後編）

> **この節で分かること**
> - `console.*` と Console ユーティリティ API（`monitorEvents` / `queryObjects` / `getEventListeners` / `debug` など）を使い分けて、実行時のイベント・オブジェクト・リスナを棚卸しできる
> - よく使う調査コードを Snippets に保存し、任意のターゲットページで 2 操作で再実行できる
> - Performance パネルでランタイム性能を記録し、赤い三角や forced reflow の原因行までたどれる
> - Memory パネルで Chrome Task Manager → Heap Snapshot → Allocation Timeline の順にメモリリークを切り分けられる
> - DevTools の各機能を「許可された検証・バグバウンティ」の診断手順にマッピングし、DOM-based XSS の sink 到達検出や postMessage リスナの棚卸しに応用できる

**元資料**: https://developer.chrome.com/docs/devtools/console/api/ ・ https://developer.chrome.com/docs/devtools/console/utilities/ ・ https://developer.chrome.com/docs/devtools/javascript/snippets/ ・ https://developer.chrome.com/docs/devtools/performance/ ・ https://developer.chrome.com/docs/devtools/memory-problems/ ・ https://developer.chrome.com/docs/devtools/shortcuts/（いずれも原典取得済み。担当解説記事 https://devplaybook.cc/... と https://www.browserstack.com/... は原典は取得できず、公式ドキュメントで代替）
**関連する節**: 「Chrome DevTools 実践デバッグ（前編）— Sources・ブレークポイント・source map・Local Overrides・Network」

---

## 1. この後編の位置づけ

前編では Sources パネル、9 種類のブレークポイント、source map、Local Overrides、Network パネルまでを扱った。後編ではその続きとして、**Console から使うプログラム的な調査ツール**（`console.*` と Console ユーティリティ API）、**再利用可能なデバッグコードである Snippets**、そして**性能とメモリを記録・解析する Performance / Memory パネル**を扱う。

最後に、ここまでの全機能を「クライアントサイド脆弱性ハンティング」の診断手順に対応づける一覧表を置く。DevTools はもともとデバッグ用のツールだが、その機能の多くは、許可された診断・バグバウンティ・自分で立てた検証環境において、脆弱性の源（source）と着地点（sink）を実行時に突き止める道具として転用できる。

〔補足〕本節の「脆弱性への応用」部分は、公式ドキュメントの機能説明から導いた運用上の対応づけであり、公式が「脆弱性診断手順」として明記しているものではない（例外として Trusted Type / CSP Violation ブレークポイントは、公式が DOM-based XSS の source/sink を明示している）。攻撃的な操作は必ず、許可された対象・自分の検証環境に限定すること。

## 2. Console API リファレンス（`console.*`）

### 2.1 severity level という考え方

Console API とは、ページの JavaScript から Console にメッセージを出すための関数群のこと。おなじみの `console.log()` もこの一部である。

DevTools はほとんどの `console.*` メソッドに**重大度レベル（severity level）**を割り当てる。重大度レベルとは、そのログが「情報」「警告」「エラー」のどれかを示すラベルのこと。これによって Console 上でログメッセージをレベル別にフィルタできる。たとえばエラーだけを絞り込んで表示する、といった使い方ができる。

### 2.2 メソッド一覧

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

### 2.3 主要メソッドのコード例（原文どおり）

`console.assert()` は第 1 引数の条件が偽のときだけ、第 2 引数を error として出す。「ここは絶対にこうなっているはず」という前提が崩れたときだけ通知したい場面に向く。

```js
const x = 5;
const y = 3;
const reason = 'x is expected to be less than y';
console.assert(x < y, {x, y, reason});
```

`console.count()` は「この行が何回通ったか」を数える。ループやイベントハンドラの発火回数を素早く把握できる。`console.countReset()` でカウントを 0 に戻す。

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

`console.createTask()` は Async Stack Tagging API と呼ばれる仕組みで、非同期処理のスタックトレースをきれいにつなげるためのもの。返ってきた `task` の `run()` に関数を渡して実行する。

```js
// Task creation
const task = console.createTask(name);

// Task execution
task.run(f); // instead of f();
```

原文の説明: 「`task` は生成コンテキストと async 関数のコンテキストの間にリンクを形成する。このリンクによって DevTools は async 操作のスタックトレースをより良く表示できる。」つまり、`setTimeout` や Promise をまたいでも「どこから呼ばれたか」を追いやすくなる。

`console.dir()` はオブジェクトを JSON 的なプロパティ一覧として、`console.dirxml()` は DOM を XML ツリーとして表示する。

```js
console.dir(document.head);
```

```js
console.dirxml(document);
```

`console.group()` は関連するログをネスト（入れ子）してまとめる。大量のログを構造化して読みやすくする。

```js
const label = 'Adolescent Irradiated Espionage Tortoises';
console.group(label);
console.info('Leo');
console.info('Mike');
console.info('Don');
console.info('Raph');
console.groupEnd(label);
```

`console.group()` は入れ子にできる。

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

`console.table()` はオブジェクトの配列を表として描く。生のログより一覧性が高い。

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

原文の説明: 「既定で `console.table()` は全テーブルデータをログする。単一列または列の部分集合を表示するには、2 番目の省略可能なパラメータに列名を文字列または文字列の配列で指定する。」列を絞るとノイズが減る。

```js
console.table(people, ['last', 'birthday']);
```

`console.time()` / `console.timeEnd()` は処理時間の計測に使う。

```js
console.time();
for (var i = 0; i < 100000; i++) {
  let square = i ** 2;
}
console.timeEnd();
```

`console.trace()` は、その呼び出しに至るまでのスタックトレース（呼び出しの連鎖）を出す。「この関数、いったいどこから呼ばれた？」を追うのに便利。

```js
const first = () => { second(); };
const second = () => { third(); };
const third = () => { fourth(); };
const fourth = () => { console.trace(); };
first();
```

## 3. Console ユーティリティ API（Console 専用の便利関数）

### 3.1 何ができるか、そして最大のハマりどころ

Console ユーティリティ API とは、Console から手で打って使う便利関数の集まりのこと。原文いわく「DOM 要素の選択と検査、オブジェクトの問い合わせ、読みやすい形式でのデータ表示、プロファイラの停止と開始、DOM イベントと関数呼び出しの監視、など」に使える。

ここで**最も重要なハマりどころ**を先に押さえておく。

> **これらの関数は Chrome DevTools の Console から呼んだときのみ動作する。自分のスクリプト内で呼んでも動作しない。**

`monitorEvents()` や `queryObjects()` をページの JavaScript に書いても何も起きない。あくまで「調査者が Console から手で打つツール」だと理解すること。

### 3.2 一覧表

| 関数 | 内容 |
|---|---|
| `$_` | 最も最近評価された式の値を返す |
| `$0` - `$4` | **Elements** パネルで検査した直近 5 つの DOM 要素、または Profiles パネルで選択した直近 5 つの JS ヒープオブジェクトへの履歴参照。`$0` が最も最近選択されたもの |
| `$(selector [, startNode])` | 指定 CSS セレクタに一致する最初の DOM 要素への参照を返す。1 引数なら `document.querySelector()` のショートカット |
| `$$(selector [, startNode])` | 指定 CSS セレクタに一致する要素の**配列**を返す。`Array.from(document.querySelectorAll())` と等価 |
| `$x(path [, startNode])` | 指定 XPath 式に一致する DOM 要素の配列を返す |
| `clear()` | Console の履歴をクリアする |
| `copy(object)` | 指定オブジェクトの文字列表現をクリップボードにコピーする |
| `debug(function)` | 指定関数が呼ばれたときデバッガが起動し、**Sources** パネルで関数内にブレークする |
| `dir(object)` | 指定オブジェクトの全プロパティをオブジェクト形式で列挙表示する。`console.dir()` のショートカット |
| `dirxml(object)` | 指定オブジェクトの XML 表現を出力する。`console.dirxml()` と等価 |
| `inspect(object/function)` | 指定要素/オブジェクトを適切なパネルで開いて選択する |
| `getEventListeners(object)` | 指定オブジェクトに登録されたイベントリスナを返す |
| `keys(object)` | 指定オブジェクトのプロパティ名の配列を返す |
| `monitor(function)` | 指定関数が呼ばれたとき、関数名と渡された引数を Console にログする |
| `monitorEvents(object [, events])` | 指定オブジェクトで指定イベントが発生したとき、Event オブジェクトを Console にログする |
| `profile([name])` / `profileEnd([name])` | JS CPU プロファイリングを開始 / 完了し、**Performance > Main** トラックに表示する |
| `queryObjects(Constructor)` | 指定コンストラクタで作られたオブジェクトの配列を返す |
| `table(data [, columns])` | 表形式でオブジェクトデータをログする。`console.table()` のショートカット |
| `undebug(function)` | `debug(fn)` を止める |
| `unmonitor(function)` | `monitor(fn)` を止める |
| `unmonitorEvents(object [, events])` | イベント監視を止める |
| `values(object)` | 指定オブジェクトの全プロパティの値の配列を返す |

### 3.3 要素セレクタ `$()` / `$$()` / `$x()`

`$_` は「直前に評価した式の値」を保持する変数。原文の説明では、`2 + 2` を評価したあと `$_` を評価すると同じ値（4）が入っている。次に別の式（配列）を評価してから `$_.length` を評価すると、`$_` は最新の評価結果（配列の長さ）に更新される。「一つ前の結果」を使い回せる。

`$$()` はページ上の全一致要素を配列で返す。たとえば全画像の URL を列挙する。

```js
let images = $$('img');
for (let each of images) {
  console.log(each.src);
}
```

第 2 引数 `startNode` に起点要素を渡すと、そこを基点に探す。

```js
let images = $$('img', document.querySelector('.devsite-header-background'));
for (let each of images) {
  console.log(each.src);
}
```

> **注**: Console で**スクリプトを実行せずに改行するには <kbd>Shift</kbd>+<kbd>Enter</kbd>** を押す。複数行のコードを組み立てるときに使う。

> **注（`$` のハマりどころ）**: jQuery のように `$` を使うライブラリを使っている場合、この機能は上書きされ、`$` はそのライブラリの実装に対応する。DevTools の `$()` が動かないと感じたらこれを疑う。

`$()` の戻り値を右クリックして **Reveal in Elements Panel** を選ぶと DOM 内で位置を確認でき、**Scroll into View** でページ上に表示できる。第 2 引数 `startNode` の既定値は `document`。

`$x()` は XPath で要素を探す。CSS セレクタでは書きにくい「子孫に特定要素を含む要素」なども取れる。

ページ上の全 `<p>` 要素を返す:

```js
$x("//p")
```

`<a>` 要素を含む全 `<p>` 要素を返す:

```js
$x("//p[a]")
```

### 3.4 `clear()` / `copy()`

```js
clear();
```

```js
copy($0);
```

`copy($0)` は「いま Elements パネルで選択中の要素」をクリップボードにコピーする。取得したペイロードや DOM 断片を外に持ち出すのに使える。

### 3.5 `debug()` / `undebug()` — 関数に入った瞬間で止める

`debug(fn)` は、その関数が次に呼ばれた瞬間に Sources パネルで自動的にブレークする。関数の 1 行目に line-of-code ブレークポイントを置くのと等価だが、Console から一行で仕掛けられる。

```js
debug(getData);
```

```js
undebug(getData);
```

原文: 「関数でのブレークを止めるには `undebug(fn)` を使うか、UI で全ブレークポイントを無効化する。」

### 3.6 `dir()` / `inspect()`

```js
document.body;
dir(document.body);
```

`document.body` を直接評価するとページ上の見え方（HTML 的表現）で出るのに対し、`dir()` はプロパティ一覧のオブジェクト形式で出る、という違いを示す例。

```js
inspect(document.body);
```

`inspect()` は対象を適切なパネルで開いて選択する。DOM 要素なら Elements パネル、関数を渡すと Sources パネルでその定義を開く。

### 3.7 `getEventListeners()` — リスナ棚卸しの中核

`getEventListeners(object)` は、指定オブジェクトに登録されたイベントリスナを返す。

```js
getEventListeners(document);
```

原文の説明: 「**返り値は、登録された各イベント型（例えば `click` や `keydown`）ごとに配列を含むオブジェクト**。各配列のメンバは、その型ごとに登録されたリスナを記述するオブジェクト。」複数リスナがあれば配列に複数メンバが並ぶ。原文の例では document に `click` リスナが 2 つ登録されている。各メンバを展開すればリスナの中身を調べられる。

これは脆弱性ハンティングで特に重要で、たとえば `getEventListeners(window)` の返り値に `message` 型があるかどうかで、そのページが postMessage を受け取っているか（＝オリジン検証不備の攻撃対象になりうるか）が一目で分かる。

### 3.8 `keys()` / `values()`

```js
let player = {
    "name": "Parzival",
    "number": 1,
    "state": "ready",
    "easterEggs": 3
};
```

`player` がグローバルにあると仮定して、Console で `keys(player)` と打つとプロパティ名の配列、`values(player)` と打つと値の配列が得られる。

```js
let player = {
    "name": "Parzival",
    "number": 1,
    "state": "ready",
    "easterEggs": 3
};

values(player);
```

### 3.9 `monitor()` / `unmonitor()` — 関数呼び出しを記録する

`monitor(fn)` は、その関数が呼ばれるたびに関数名と引数を Console にログする。止めずに観測だけしたいときに `debug()` の代わりに使う。

```js
function sum(x, y) {
  return x + y;
}
monitor(sum);
```

```js
unmonitor(getData);
```

### 3.10 `monitorEvents()` — イベント発火を観測する

`monitorEvents(object, events)` は、指定オブジェクトで指定イベントが起きるたびに Event オブジェクトを Console に出す。

```js
monitorEvents(window, "resize");
```

複数イベントは配列で渡す。

```js
monitorEvents(window, ["resize", "scroll"])
```

さらに、あらかじめ定義されたイベント集合を指す「type」文字列も使える。次の表は type 名と実際に監視されるイベントの対応（原文どおり）。

| Event type | Corresponding mapped events |
|---|---|
| mouse | "mousedown", "mouseup", "click", "dblclick", "mousemove", "mouseover", "mouseout", "mousewheel" |
| key | "keydown", "keyup", "keypress", "textInput" |
| touch | "touchstart", "touchmove", "touchend", "touchcancel" |
| control | "resize", "scroll", "zoom", "focus", "blur", "select", "change", "submit", "reset" |

Elements パネルで選択中の入力欄（`$0`）に対し、キー関連イベントをまとめて監視する例:

```js
monitorEvents($0, "key");
```

監視を止めるには `unmonitorEvents(object[, events])` を使う。ノイズを減らすために、いったん広く監視してから一部だけ止めることもできる。

```js
monitorEvents($0, "mouse");
unmonitorEvents($0, "mousemove");
```

window の全イベント監視を止める:

```js
unmonitorEvents(window);
```

### 3.11 `profile()` / `profileEnd()` — 名前付き CPU プロファイル

> **注**: `profile()` と `profileEnd()` は `console.profile()` と `console.profileEnd()` のショートハンド。

```js
profile("Profile 1")
```

```js
profileEnd("Profile 1")
```

停止すると結果は **Performance > Main** トラックに表示される。プロファイルはネストでき、生成順に閉じる必要もない。

```js
profile('A');
profile('B');
profileEnd('A');
profileEnd('B');
```

### 3.12 `queryObjects()` — 生存オブジェクトの棚卸し

`queryObjects(Constructor)` は、指定コンストラクタで作られたオブジェクトのうち今も生きているものを配列で返す。

- `queryObjects(Promise)` — `Promise` の全インスタンスを返す。
- `queryObjects(HTMLElement)` — 全 HTML 要素を返す。
- `queryObjects(foo)`（`foo` はクラス名）— `new foo()` でインスタンス化された全オブジェクトを返す。

原文の重要な注: 「**`queryObjects()` のスコープは Console で現在選択されている実行コンテキスト。**」つまり iframe や worker の中を調べたいときは、Console の実行コンテキストをそのフレーム／ワーカーに切り替えてから呼ぶ必要がある。

### 3.13 `table()`

```js
let names = [
  { firstName: "John", lastName: "Smith" },
  { firstName: "Jane", lastName: "Doe" },
];
table(names);
```

## 4. Snippets — 任意のページで再利用できるデバッグコード

### 4.1 Snippets とは

Snippets（スニペット）とは、DevTools 内に保存しておく小さな JavaScript のことで、あとから任意のページで実行できる。原文いわく「**Console** で同じコードを繰り返し実行していることに気付いたら、代わりにそのコードを snippet として保存することを検討する。**Snippet はページの JavaScript コンテキストにアクセスできる。**これは bookmarklet の代替になる。」

Snippet は **Sources** パネルで書き、**任意のページおよびシークレットモードで実行できる。**

> **Aside**: **DevTools は snippet をローカルの preferences として保存する。DevTools は snippet を設定と一緒に sync せず、ファイルシステム経由でアクセスすることもできない。**

つまり別マシンに自動で同期されず、ディスク上のファイルとしても見えない。バックアップは自分でコードをコピーしておく必要がある。

原文のサンプル:

```js
console.log('Hello, Snippets!');
document.body.innerHTML = '';
const p = document.createElement('p');
p.textContent = 'Hello, Snippets!';
document.body.appendChild(p);
```

**Run** すると Console に `Hello, Snippets!` が出て、ページ内容が置き換わる。

### 4.2 作成・編集・実行・管理

**新規作成（Snippets ペインから）**:

1. Snippets ペインを開く。
2. **New snippet** をクリック。
3. 名前を入力して <kbd>Enter</kbd> で保存。

**新規作成（Command Menu から）**:

1. DevTools 内のどこかにカーソルをフォーカス。
2. <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Windows/Linux）/ <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Mac）で **Command Menu** を開く。
3. `Snippet` と入力して **Create new snippet** を選び、<kbd>Enter</kbd>。

**編集**:

1. Snippets ペインを開く。
2. 編集したい snippet 名をクリック。**Sources** の Code Editor で開く。
3. コードを編集する。**snippet 名の隣のアスタリスクは未保存の変更を意味する。**
4. <kbd>Control</kbd>+<kbd>S</kbd>（Windows/Linux）/ <kbd>Command</kbd>+<kbd>S</kbd>（Mac）で保存。

**実行（Sources パネルから）**:

1. Snippets ペインを開く。
2. 実行したい snippet 名をクリック。
3. エディタ下部の **Run** をクリック、または <kbd>Control</kbd>+<kbd>Enter</kbd>（Windows/Linux）/ <kbd>Command</kbd>+<kbd>Enter</kbd>（Mac）。

**実行（Command Menu から）**:

1. DevTools 内にカーソルをフォーカス。
2. <kbd>Control</kbd>+<kbd>O</kbd>（Windows/Linux）/ <kbd>Command</kbd>+<kbd>O</kbd>（Mac）で Command Menu を開く。
3. **`!` 文字に続けて** snippet 名を入力。
4. <kbd>Enter</kbd> で実行。

**リネーム / 削除**: Snippets ペインで snippet 名を右クリックして **Rename** / **Remove** を選ぶ。

〔補足〕クライアントサイド脆弱性ハンティングでは、「全 `iframe` と `postMessage` リスナを列挙する」「`innerHTML` セッタをフックしてスタックトレースを出す」といった定型調査コードを snippet として保存しておくと、任意のターゲットページで <kbd>Command</kbd>+<kbd>O</kbd> → `!<name>` の 2 操作で再利用できる。snippet はページの JS コンテキストで動くため、ページの関数やグローバル変数にそのままアクセスできる。

## 5. Performance パネルでランタイム性能を解析する

### 5.1 ランタイム性能とは

Performance パネルは、ページが**動いている**ときの性能を記録・解析するツール。原文いわく「ランタイム性能とは、読み込みではなくページが動作しているときの性能。」RAIL モデル（Response・Animation・Idle・Load の 4 フェーズで性能を考える枠組み）の観点では、ここで学ぶスキルは **Response、Animation、Idle** の解析に役立つ。

> **Caution**: このチュートリアルは **Chrome 59** に基づく。別バージョンでは UI と機能が異なる場合がある。`chrome://help` で実行中の Chrome バージョンを確認する。

〔補足〕原文自身が古い版に基づくと明示しているため、現在の実機 UI（Insights や Live metrics など）はこの記述より新しい可能性が高い。

### 5.2 準備と CPU throttling

1. **シークレットモード**で Chrome を開く。拡張機能が測定にノイズを作らないよう、クリーンな状態にするため。
2. デモを読み込む（小さな青い四角が上下に動く）: `https://googlechrome.github.io/devtools-samples/jank/`
3. <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>I</kbd>（Mac）/ <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>（Windows, Linux）で DevTools を開く。

CPU throttling（CPU スロットリング）とは、CPU をわざと遅くしてモバイル端末の性能を模擬する機能のこと。

1. **Performance** タブをクリック。
2. **Screenshots** チェックボックスが有効か確認。
3. **Capture Settings** をクリック。
4. **CPU** に **2x slowdown** を選ぶ（CPU を通常の 2 倍遅くする）。

> **注**: ローエンドのモバイルでの動作を保証したいなら **20x slowdown** に設定する。このデモは 20x では動かないので説明目的で 2x を使っている。

### 5.3 デモのセットアップと記録

1. 青い四角の動きが目に見えて遅くなるまで **Add 10** をクリックし続ける（ハイエンドマシンでは約 20 回）。
2. **Optimize** をクリックすると速く滑らかになる（差が見えないときは **Subtract 10** で四角を減らしてやり直す。増やしすぎると CPU を使い切って差が出ない）。
3. **Un-Optimize** で再びジャンク（カクつき）が出る状態に戻す。

記録:

1. **Record** をクリック。
2. 数秒待つ。
3. **Stop** をクリック。DevTools がデータを処理して結果を表示する。

### 5.4 結果を解析する

**FPS（frames per second, 1 秒あたりのフレーム数）の解析**。原文いわく「ユーザはアニメーションが 60 FPS で動くと満足する。」

1. **FPS** チャートを見る。**FPS の上に赤いバーが見えたら、フレームレートがユーザ体験を害するほど低下したことを意味する。緑のバーが高いほど FPS が高い。**
2. **CPU** チャートの色は下部 **Summary** タブの色に対応する。**CPU チャートが色で埋まっている＝記録中 CPU が使い切られていた。長時間そうなら作業量を減らす合図。**
3. **FPS/CPU/NET** チャートにホバーすると、その時点のスクリーンショットが出る。左右に動かすと記録を再生できる。これを**スクラビング（scrubbing）**と呼ぶ。
4. **Frames** セクションの緑の四角にホバーすると、そのフレームの FPS が出る。

**ボーナス: FPS meter**（実行中の FPS をリアルタイム推定する）:

1. <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Mac）/ <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>（Windows, Linux）で Command Menu を開く。
2. `Rendering` と入力し **Show Rendering** を選ぶ。
3. **Rendering** タブで **FPS Meter** を有効にする（右上にオーバーレイが出る）。
4. 無効に戻し、<kbd>Escape</kbd> で閉じる。

### 5.5 ボトルネックの見つけ方

1. **Summary** タブに注目。何も選択していないときはアクティビティの内訳を出す。**性能は「より少ない作業をする技」なので、目標は rendering 時間を減らすこと。**
2. **Main** セクションを展開すると、メインスレッドのフレームチャートが出る。**x 軸は時間、各バーが 1 イベント、幅が広いほど長くかかった。y 軸はコールスタックで、イベントが積み重なっていれば上が下を引き起こしたことを意味する。**
3. **Overview**（FPS/CPU/NET を含む上部）でクリック・ホールド・ドラッグして単一の **Animation Frame Fired** イベントにズームする。
   > **注**: **Main** 上でイベントにフォーカスして **W、A、S、D キー**でもズームできる。
4. **Animation Frame Fired** の右上の**赤い三角**に注目。**赤い三角＝そのイベントに問題があるかもしれないという警告。**
   > **注**: Animation Frame Fired は `requestAnimationFrame()` コールバックが実行されるたびに発生する。
5. **Animation Frame Fired** をクリックすると **Summary** に情報が出る。**reveal** リンクで「このイベントを開始したイベント」をハイライトし、**app.js:94** のようなリンクでソースの該当行にジャンプできる。
   > **注**: 矢印キーで隣のイベントを選べる。
6. 紫の **Layout** イベントの 1 つをクリックすると、**forced reflows**（レイアウトの別名）についての警告が出る。
7. **Summary** の **Layout Forced** の下の **app.js:70** リンクで、レイアウトを強制したコード行へ飛べる。
   > **注（原因）**: 問題は、各アニメーションフレームで各四角のスタイルを変え、そのあと位置を問い合わせていること。**スタイルが変わったためブラウザは位置が変わったか分からず、再レイアウト（forced synchronous layout）せざるを得ない。**

**最適化版の解析**: デモで **Optimize** を押して再記録すると、フレームレートが改善し **Main** のイベントが減っているのが分かる。

> **注**: この「最適化」版でさえ各四角の `top` を操作しているのであまり良くない。**より良いのは compositing にのみ影響するプロパティ（`transform`、`opacity`）に留まること。**

## 6. Memory パネルでメモリ問題を修正する

### 6.1 全体の流れ（原文の 4 点）

- **Chrome Task Manager** でページが現在どれだけメモリを使っているかを調べる。
- **Timeline recordings**（Performance の記録）でメモリ使用量を時間経過で可視化する。
- **Heap Snapshots** で detached DOM tree（メモリリークのよくある原因）を特定する。
- **Allocation Timeline recordings** で JS ヒープに新しいメモリがいつ割り当てられるかを調べる。

### 6.2 ユーザが知覚する 3 症状

- **性能が時間経過で徐々に悪化する** → **メモリリーク**の可能性。メモリリークとは、ページのバグによってページが時間経過でどんどんメモリを使うようになること。
- **性能が一貫して悪い** → **メモリ膨張（memory bloat）**の可能性。メモリ膨張とは、最適な速度に必要な以上のメモリをページが使っていること。
- **頻繁に一時停止しているように見える** → **頻繁なガベージコレクション**の可能性。ガベージコレクション（GC）とは、ブラウザが不要になったメモリを回収すること。**コレクション中は全スクリプト実行が一時停止する**ため、頻繁だと体感でカクつく。

memory bloat の「どれだけが多すぎか」には**確固たる数値はない**。デバイスとブラウザで能力が違うため。原文は「RAIL モデルを使ってユーザに集中する。自分のユーザに人気のあるデバイスを調べ、それらでテストする」ことを勧めている。

### 6.3 Chrome Task Manager でリアルタイム監視

Chrome Task Manager は、ページが**現在**どれだけメモリを使っているかを教えるリアルタイムモニタ。調査の出発点にする。

1. <kbd>Shift</kbd>+<kbd>Esc</kbd>、または Chrome メインメニューから **More tools > Task manager** を開く。
2. テーブルヘッダを右クリックして **JavaScript memory** 列を有効にする。

2 つの列の意味:

- **Memory** 列は**ネイティブメモリ**を表す。**DOM ノードはネイティブメモリに保存される。この値が増えているなら DOM ノードが生成されている。**
- **JavaScript Memory** 列は **JS ヒープ**を表す。**注目すべきは live number（括弧内の数）。これはページ上の到達可能なオブジェクトが使っているメモリ量。増えているなら新しいオブジェクトが生成されているか、既存オブジェクトが成長している。**

### 6.4 Performance 記録でメモリリークを可視化

1. **Performance** パネルを開く。
2. **Memory** チェックボックスを有効にする。
3. 記録する。

> **Tip**: **記録の開始と終了で強制ガベージコレクションをするのが良い習慣。** 記録中に **collect garbage** ボタンで GC を強制する。

デモ用コード:

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

ボタンを押すたび 1 万個の `div` が body に追加され、100 万文字の文字列が `x` に push される。

UI の見方（原文）: **Overview** ペインの **HEAP** グラフが JS ヒープを表す。その下の **Counter** ペインで **JS heap**、**documents**、**DOM nodes**、**listeners**、**GPU memory** に分けて見える。

解析（原文）: ノードカウンタ（緑）は離散的なステップで増え、各増加が `grow()` の呼び出しに対応する。JS ヒープ（青）はもっと複雑で、最初の落ち込みは強制 GC。**鍵は、JS ヒープが始まり（強制 GC の後）より高く終わっているという事実。実世界でこの増加パターンを見たら潜在的なメモリリークを意味する。**

### 6.5 Heap Snapshots で detached DOM tree を発見する

原文: 「DOM ノードは、ページの DOM ツリーからも JavaScript コードからも参照がないときのみ GC されうる。**DOM ツリーから取り除かれたが一部の JavaScript がまだ参照しているノードを『detached』と言う。detached DOM ノードはメモリリークのよくある原因。**」

単純な例:

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

生成された `ul`（10 個の `li` 付き）はコードから参照されているが DOM ツリーには無いので detached。

Heap snapshot（ヒープスナップショット）とは、ある瞬間の JS オブジェクトと DOM ノードのメモリ分布を撮った「写真」のこと。

1. **Memory** パネルへ行く。
2. **Heap Snapshot** ラジオボタンを選ぶ。
3. **Take Snapshot** を押す。

完了したら左の **HEAP SNAPSHOTS** から選ぶ。**detached DOM tree を検索するには、Class filter に `Detached` と入力する。**

**色の意味（重要）**: 「**黄色でハイライトされたノードは JavaScript コードから直接参照されている。赤でハイライトされたノードは直接の参照を持たない。それらは黄色ノードのツリーの一部であるためだけに生きている。一般に黄色のノードに集中すべき。**」黄色ノードが必要以上に長く生きないようにコードを直せば、その配下の赤ノードも消える。黄色ノードをクリックすると **Objects** ペインで参照元のコード（例: `detachedTree` 変数）が分かる。

### 6.6 Allocation Timeline で JS ヒープのリークを特定する

デモ用コード:

```js
var x = [];

function grow() {
  x.push(new Array(1000000).join('x'));
}

document.getElementById('grow').addEventListener('click', grow);
```

記録手順（原文）: **Profiles** パネルへ行き、**Record Allocation Timeline** を選び、**Start** を押し、リークが疑われる操作を実行し、終わったら **stop recording** を押す。

原文: 「記録中、Allocation Timeline に**青いバー**が現れるかどうかに注目する。**それらの青いバーは新しいメモリ割り当てを表す。それらの新しいメモリ割り当てがメモリリークの候補。**」バーにズームすると **Constructor** ペインをその時間枠に絞れる。オブジェクトを展開して値をクリックすると **Object** ペインで詳細（例: `Window` スコープの `x` 変数に割り当てられた、など）が見える。

### 6.7 関数別の割り当て調査（Allocation Sampling）

Allocation Sampling は、JavaScript の**関数別**にメモリ割り当てを見る機能。

1. **Allocation Sampling** ラジオボタンを選ぶ。**ページに worker があれば、Start ボタンの隣のドロップダウンで対象を選べる。**
2. **Start** を押す。
3. 調べたい操作を実行する。
4. **Stop** を押す。

結果は関数別の内訳で出る。**既定のビューは Heavy (Bottom Up) で、最も多くメモリを割り当てた関数を上に表示する。**

### 6.8 頻繁なガベージコレクションの発見

原文: 「ページが頻繁に一時停止しているように見えるなら、GC の問題かもしれない。」Chrome Task Manager でも Timeline 記録でも発見できる。**Task Manager では Memory または JavaScript Memory の値が頻繁に上下するのが頻繁な GC を表す。Timeline 記録では JS ヒープまたはノード数のグラフが頻繁に上下するのが頻繁な GC を示す。** 特定したら Allocation Timeline でどこが割り当てているかを調べられる。

## 7. キーボードショートカット（抜粋）

DevTools は Command Menu（<kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>）から大半の操作を検索実行できるが、頻用ショートカットを押さえると調査が速くなる。以下は特に脆弱性調査で使うものを抜粋する。

### 7.1 グローバル（検索まわり）

| Action | Mac | Windows / Linux |
|---|---|---|
| Open the **Command Menu** | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> |
| 現在のパネル内テキスト検索（Elements/Console/Sources/Performance/Memory 等のみ） | <kbd>Command</kbd>+<kbd>F</kbd> | <kbd>Control</kbd>+<kbd>F</kbd> |
| ドロワーの **Search** タブ（**読み込まれた全リソースを横断検索**） | <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>F</kbd> | <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> |
| **Sources** でファイルを開く | <kbd>Command</kbd>+<kbd>O</kbd> or <kbd>Command</kbd>+<kbd>P</kbd> | <kbd>Control</kbd>+<kbd>O</kbd> or <kbd>Control</kbd>+<kbd>P</kbd> |
| Run snippet | <kbd>Command</kbd>+<kbd>O</kbd> → `!` + 名 → <kbd>Enter</kbd> | <kbd>Control</kbd>+<kbd>O</kbd> → `!` + 名 → <kbd>Enter</kbd> |

横断検索（<kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>）は、`innerHTML` や `eval(`、`postMessage` などの sink を「読み込まれた全リソース」から一気に洗い出すのに使う。パネル内検索（<kbd>Control</kbd>+<kbd>F</kbd>）は現在のファイル内のみなので混同しないこと。

### 7.2 Sources / Code Editor（ブレークポイント操作）

| Action | Mac | Windows / Linux |
|---|---|---|
| Pause / resume | <kbd>F8</kbd> or <kbd>Command</kbd>+<kbd>\</kbd> | <kbd>F8</kbd> or <kbd>Control</kbd>+<kbd>\</kbd> |
| Step over | <kbd>F10</kbd> | <kbd>F10</kbd> |
| Step into | <kbd>F11</kbd> | <kbd>F11</kbd> |
| Step out | <kbd>Shift</kbd>+<kbd>F11</kbd> | <kbd>Shift</kbd>+<kbd>F11</kbd> |
| line-of-code ブレークポイントの追加/削除 | 行にカーソル → <kbd>Command</kbd>+<kbd>B</kbd> | 行にカーソル → <kbd>Control</kbd>+<kbd>B</kbd> |
| 条件付きブレークポイント/logpoint 編集ダイアログ | 行にカーソル → <kbd>Command</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> | 行にカーソル → <kbd>Control</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> |

### 7.3 Network / Console

| Action | Mac | Windows / Linux |
|---|---|---|
| Network: Start / stop recording | <kbd>Command</kbd>+<kbd>E</kbd> | <kbd>Control</kbd>+<kbd>E</kbd> |
| Network: Replay a selected XHR request | <kbd>R</kbd> | <kbd>R</kbd> |
| Console: 複数行入力を強制 | <kbd>Shift</kbd>+<kbd>Return</kbd> | <kbd>Shift</kbd>+<kbd>Enter</kbd> |
| Console: Clear | <kbd>Command</kbd>+<kbd>K</kbd> | <kbd>Control</kbd>+<kbd>L</kbd> |

## 8. よくあるハマりどころ（後編の範囲）

前編・後編を通じたハマりどころのうち、この後編で扱った機能に関わるものを抜き出す（いずれも公式ドキュメント明記のもの）。

| # | 症状 | 原因と対処 |
|---|---|---|
| 3 | Console で `$` が DevTools の `$()` として動かない | jQuery など `$` を使うライブラリが `$` を上書きしている（console/utilities） |
| 4 | Console ユーティリティ（`monitorEvents` など）をスクリプトに書いても動かない | **これらは DevTools の Console から呼んだときのみ動作する**（console/utilities の gotchas） |
| 17 | `console.clear()` が効かない | **Preserve Log が有効なとき `console.clear()` は無効化される**（console/api） |
| 19 | Performance の計測にノイズが混じる | **シークレットモードで開く。**拡張機能が測定にノイズを作る（performance） |
| 20 | モバイル実機と結果が合わない | **CPU Throttling を使う。ローエンド想定なら 20x slowdown**（performance） |
| 21 | Snippet がファイルシステムに見つからない / 別マシンで見えない | **DevTools は snippet をローカル preferences として保存し、設定と sync せず、ファイルシステム経由でアクセスできない**（snippets の Aside） |
| 22 | Editor 内検索で他ファイルが引っかからない | <kbd>Command</kbd>+<kbd>F</kbd> は現在のファイル内のみ。**横断検索はドロワーの Search タブ**（shortcuts） |

## 9. 脆弱性ハンティング（クライアントサイド）への応用整理

ここまでの機能を、許可された検証・バグバウンティの診断手順にマッピングする。

〔補足〕以下は原文の機能説明から導いた運用上の対応づけであり、公式ドキュメントが「脆弱性診断手順」として明記しているものではない（例外: Trusted Type ブレークポイントの節は公式が DOM-based XSS の source/sink を明示している）。source とは、攻撃者が制御できる入力の入口（例: `location.hash`）のこと。sink とは、その入力が危険な形で使われる出口（例: `innerHTML` への代入）のこと。

| 目的 | 使う DevTools 機能 | 要点 |
|---|---|---|
| DOM-based XSS の sink 到達を実行時に捕まえる | **CSP Violation Breakpoints > Sink Violations / Policy Violations** | Trusted Types 導入済みページなら sink 到達で停止し、Call Stack から source を逆追跡できる |
| sink を書くコードを静的に洗い出す | ドロワーの **Search**（<kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>） | 全リソースを横断して `innerHTML`、`eval(`、`document.write`、`postMessage`、`location.hash` 等を検索 |
| minified バンドルを読む | **pretty print**＋**source map**＋**Authored/Deployed グループ化**＋**手動 source map 読み込み** | production に source map がなくても自前ビルドの map を `Add source map` で当てられる |
| ノイズ（拡張・3rd party）を排除 | **Ignore List**、**Hide extension URLs** | 拡張の content script、既知 3rd party、カスタム RegEx で除外 |
| 特定 API 呼び出しの発生源を特定 | **`debug(fn)` / Function breakpoint**、**`monitor(fn)`**、**Initiator 列のスタックトレース** | `debug()` は関数 1 行目の line-of-code ブレークポイントと等価 |
| イベントリスナの棚卸し | **`getEventListeners(object)`**、**Elements > Event Listeners**、**Event Listener Breakpoints** | `message` イベントのリスナ有無は postMessage 脆弱性の起点確認に使える |
| 生存オブジェクト・インスタンスの列挙 | **`queryObjects(Constructor)`** | スコープは Console で選択中の実行コンテキスト。iframe/worker はコンテキストを切り替える |
| worker / service worker のコードを追う | **Threads ペインでのコンテキスト切替**、**Allocation Sampling の worker 選択** | |
| 特定 API へのリクエストで止める | **XHR/fetch breakpoints** | URL 部分文字列一致で `send()` 行に停止 |
| レスポンスを改変してフロントの処理を単独検証 | **Local Overrides の Override content / XHR・fetch モック** | サーバに攻撃リクエストを送らずにクライアント側パーサを検証できる |
| セキュリティヘッダの効果をローカル検証 | **Override headers / `.headers` ファイル** | CORS、Permissions-Policy、Cross-Origin Isolation。ワイルドカード `*` / `?` で複数リクエストに適用 |
| Cookie 属性・SameSite 問題の確認 | **Blocked response cookies フィルタ**、`set-cookie-*` / `cookie-*` フィルタ、Cookies タブの情報アイコン | ブロック理由は情報アイコンにホバー |
| mixed content / 平文通信の検出 | フィルタ `mixed-content:all`、`scheme:http` | |
| リクエストを改変して再送 | **Copy as fetch** を Console に貼って改変、**Replay XHR** | |
| 依存リソース欠落時の挙動（fail-open）確認 | **Request blocking** | Command Menu → `Show Request Blocking` → Add Pattern |
| 定型調査コードの再利用 | **Snippets** | <kbd>Command</kbd>+<kbd>O</kbd> → `!<name>` で任意ページで実行 |
| 証跡の保全 | **Save all as HAR with content**、**Copy stack trace**、**Changes ドロワー** | HAR は DevTools を開いてからの全リクエストを含む（フィルタ不可）ので機微情報の扱いに注意 |

このうち、後編で扱った機能が直接効くのは主に「イベントリスナの棚卸し（`getEventListeners`）」「生存オブジェクトの列挙（`queryObjects`）」「特定 API の発生源特定（`debug`/`monitor`/`monitorEvents`）」「定型調査コードの再利用（Snippets）」の 4 つである。たとえば postMessage 由来の DOM-based XSS を疑うなら、まず `getEventListeners(window)` で `message` リスナの有無を確認し、リスナ関数を `debug()` で仕掛けて発火時に停止させ、Call Stack で受信データがどの sink に流れるかを追う、という一連の流れが組める。

## 手を動かす

1. 任意のページ（自分の検証環境か、調査が許可された対象）を開き、<kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd>（Windows/Linux）で Console を開く。
2. `getEventListeners(window)` と打つ。返り値のオブジェクトを展開し、`message` 型が存在するか確認する。存在すればそのページは postMessage を受信している。
3. `getEventListeners(document)` も試し、`click` などのリスナ配列を展開して、各リスナの関数本体（`listener` プロパティ）を確認する。
4. 気になった関数名（たとえば `handleMessage`）を控え、`monitor(handleMessage)` を打つ。以降その関数が呼ばれるたびに引数が Console にログされる。止めるときは `unmonitor(handleMessage)`。
5. さらに深追いするなら `debug(handleMessage)` を打つ。次に呼ばれた瞬間 Sources パネルで関数内にブレークする。Call Stack と Scope で受信データの流れを追う。終わったら `undebug(handleMessage)`。
6. `queryObjects(HTMLElement)` を打ち、生きている DOM 要素の数を把握する。iframe 内を調べたいときは Console 上部の実行コンテキスト切替ドロップダウンでそのフレームを選んでから打つ。
7. Command Menu（<kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>）→ `Create new snippet` で新規 snippet を作り、手順 2〜3 のコードを保存する。名前を付けて保存し、別のタブで <kbd>Control</kbd>+<kbd>O</kbd> → `!<名前>` → <kbd>Enter</kbd> で再実行できることを確認する。
8. 性能を試すなら、シークレットモードで `https://googlechrome.github.io/devtools-samples/jank/` を開き、Performance パネルで CPU を 2x slowdown にして記録し、赤い三角の付いた Animation Frame Fired イベントから `app.js:NN` リンクで原因行へ飛ぶ。
9. メモリを試すなら、<kbd>Shift</kbd>+<kbd>Esc</kbd> で Chrome Task Manager を開き、ヘッダ右クリックで JavaScript memory 列を出し、操作を繰り返しながら live number が単調増加するページがないか観察する。

## つまずきポイント

- Console ユーティリティ（`monitorEvents`、`getEventListeners`、`queryObjects` など）は**ページのスクリプトに書いても動かない**。必ず DevTools の Console から手で打つ。これを知らないと「関数が未定義だ」と勘違いする。
- `$` は jQuery など `$` を使うライブラリがあると DevTools の `$()` ではなくそのライブラリの実装になる。`document.querySelector` の短縮として使えないときはこれを疑う。
- `queryObjects()` と `getEventListeners()` の結果は**現在の実行コンテキストに依存**する。iframe や worker を調べるときは、Console 上部のコンテキスト切替を忘れると空振りする。
- `console.clear()` は **Preserve Log 有効時に無効化**される。ログが消えないときは Preserve Log を確認する。
- Snippet は**同期されずファイルとしても見えない**。別マシンで使いたい・バックアップしたいなら自分でコードをコピーしておく。
- Performance チュートリアルは **Chrome 59 基準**なので、実機の UI（ボタン位置やラベル）が異なることがある。手順ではなく「何を見るか（赤い三角、forced reflow、CPU の埋まり具合）」を覚える。
- 性能・メモリの測定は**シークレットモード**で行う。拡張機能がノイズを作る。
- Heap Snapshot で detached を追うときは**黄色ノードに集中**する。赤ノードは黄色ノードのツリーの一部として生きているだけなので、黄色側の参照を切れば連動して消える。
- 応用整理の表の大半は〔補足〕の運用対応づけであり、公式が診断手順として保証しているのは Trusted Type / CSP Violation ブレークポイントの部分だけ、という区別を忘れない。

## この節のまとめ

- `console.*` は severity level 付きでログを出し、`assert`/`count`/`group`/`table`/`trace` など用途別に使い分けると調査ログが読みやすくなる。
- Console ユーティリティ API は「Console からのみ動作する」調査専用関数群で、スクリプトに書いても動かない。
- `$()` / `$$()` / `$x()` は要素選択、`$_` は直前の評価結果、`$0`-`$4` は Elements で選んだ直近要素への参照。
- `getEventListeners(object)` はイベント型ごとの配列でリスナ一覧を返し、`message` リスナの有無確認など postMessage 調査の起点になる。
- `debug(fn)` は関数に入った瞬間で停止（1 行目ブレークポイント相当）、`monitor(fn)` は停止せず呼び出しと引数を記録、`monitorEvents(obj, types)` はイベント発火を観測する。
- `queryObjects(Constructor)` は生存インスタンスを列挙し、そのスコープは Console で選択中の実行コンテキスト。
- Snippets はページの JS コンテキストで動く再利用可能コードで、<kbd>Command</kbd>+<kbd>O</kbd> → `!<name>` で任意ページで実行できるが、同期もファイル化もされない。
- Performance パネルは CPU throttling（2x/20x）付きで記録し、FPS の赤いバー、CPU の埋まり、Main の赤い三角、forced reflow から原因行（`app.js:NN` リンク）へ飛ぶ。
- Memory の調査は Chrome Task Manager（live number の増加）→ Performance の Memory 記録 → Heap Snapshot（`Detached` フィルタ、黄色ノード重視）→ Allocation Timeline（青いバー）/ Allocation Sampling（関数別）の順で切り分ける。
- メモリリーク・メモリ膨張・頻繁な GC は症状が違い、膨張には確固たる閾値がなく実ユーザのデバイスで測るしかない。
- 主要ショートカット: 横断検索 <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>、パネル内検索 <kbd>Control</kbd>+<kbd>F</kbd>、Command Menu <kbd>Control</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>、snippet 実行 <kbd>Control</kbd>+<kbd>O</kbd> → `!`。
- 脆弱性ハンティングでは、`getEventListeners` でリスナを棚卸し → `debug`/`monitor` で発生源を特定 → Call Stack で source から sink への流れを追う、が基本の一連。
- 応用対応づけの多くは運用上の〔補足〕であり、公式が診断機能として明示するのは Trusted Type / CSP Violation ブレークポイントに限られる。

## 理解度チェック

1. `monitorEvents(document)` をページの JavaScript ファイルに書いたが何も起きない。なぜか。
   ▶ 答え: Console ユーティリティ API は Chrome DevTools の Console から呼んだときのみ動作する。スクリプト内に書いても動かない。DevTools の Console から手で打つ必要がある。

2. あるページが postMessage を受信しているか、Console から一発で確認するには何を打つか。
   ▶ 答え: `getEventListeners(window)` を打ち、返り値のオブジェクトに `message` 型のキー（リスナ配列）が存在するか確認する。

3. 特定の関数が呼ばれた瞬間に停止して中を追いたい。Console からどうするか。
   ▶ 答え: `debug(関数名)` を打つ。次にその関数が呼ばれると Sources パネルで関数内に自動的にブレークする。止めるときは `undebug(関数名)`。

4. `debug()` と `monitor()` の違いは何か。
   ▶ 答え: `debug(fn)` は関数呼び出し時に実行を停止する（1 行目の line-of-code ブレークポイント相当）。`monitor(fn)` は停止せず、関数名と引数を Console にログするだけ。観測だけしたいなら `monitor`。

5. Heap Snapshot で detached DOM tree を探すとき、Class filter に何と入力し、どの色のノードに注目すべきか。
   ▶ 答え: `Detached` と入力する。黄色ノード（JavaScript から直接参照されている）に注目する。赤ノードは黄色ノードのツリーの一部として生きているだけなので、黄色側の参照を切れば連動して消える。

6. Performance の記録で、あるイベントの右上に赤い三角が出ている。これは何を意味するか。
   ▶ 答え: そのイベントに関する問題があるかもしれないという警告。たとえば Animation Frame Fired の下に forced reflow（layout）などの問題があることを示す。Summary の該当リンクから原因のコード行へ飛べる。

7. Chrome Task Manager で「JavaScript Memory の live number（括弧内の数）が増え続けている」ことは何を示唆するか。
   ▶ 答え: 到達可能なオブジェクトが使うメモリが増えている、つまり新しいオブジェクトが生成されているか既存オブジェクトが成長していること。実世界でこの単調増加を見たら潜在的なメモリリークを疑う。

8. よく使う調査コードを任意のターゲットページで最短操作で再実行するには、DevTools のどの機能を使い、どう起動するか。
   ▶ 答え: Snippets に保存する。<kbd>Command</kbd>+<kbd>O</kbd>（/<kbd>Control</kbd>+<kbd>O</kbd>）で Command Menu を開き、`!` に続けて snippet 名を入力して <kbd>Enter</kbd>。snippet はページの JS コンテキストで動く。

9. `queryObjects(HTMLElement)` を打ったのに、調べたい iframe 内の要素が結果に出てこない。なぜか。
   ▶ 答え: `queryObjects()` のスコープは Console で現在選択されている実行コンテキストだから。Console 上部の実行コンテキスト切替ドロップダウンで対象の iframe を選んでから打つ必要がある。

10. 応用整理の表のうち、公式ドキュメントが「脆弱性診断」として明示的に裏づけている項目はどれか。
    ▶ 答え: Trusted Type / CSP Violation ブレークポイントによる DOM-based XSS の sink 到達検出。それ以外は原文の機能説明から導いた運用上の対応づけ（〔補足〕）である。

## 出典

- https://developer.chrome.com/docs/devtools/console/api/
- https://developer.chrome.com/docs/devtools/console/utilities/
- https://developer.chrome.com/docs/devtools/javascript/snippets/
- https://developer.chrome.com/docs/devtools/performance/
- https://developer.chrome.com/docs/devtools/memory-problems/
- https://developer.chrome.com/docs/devtools/shortcuts/
- https://developer.chrome.com/docs/devtools/javascript/breakpoints/
- https://googlechrome.github.io/devtools-samples/jank/
- https://www.w3.org/TR/trusted-types/
- https://web.dev/articles/trusted-types
- https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems

> ### 📌 ここは自分で開いて読んでください
> **資料**: Chrome DevTools JavaScript Debugging Guide 2026（devplaybook.cc）— https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 組織のポリシー強制型 egress プロキシの許可リスト外で、WebFetch は `EGRESS_BLOCKED`、curl は CONNECT 時 `403`。web.archive.org も 403 でアーカイブ迂回も不可）。以下の記述は公式 Chrome DevTools ドキュメント（原典）と、記事タイトル・目次にもとづく要約である。
> **読みどころ**:
> 1. タイトルに "2026" とあるため、2026 年時点の DevTools UI 変更点（Performance の Insights / Live metrics、Sources のレイアウト変更、AI assistance パネルなど）。本後編は Chrome 59 基準の公式チュートリアルに依るため、これらの新要素は含まれない。
> 2. 記事独自のワークフロー例・チェックリスト（「実務でどの順番に何を見るか」の判断順序）。
> 3. 本後編の Console ユーティリティ表・Performance 手順・Memory 手順と照合し、新しい機能や非推奨化された機能が書かれていないか。
> **代替手段**: 公式 Chrome DevTools ドキュメント（https://developer.chrome.com/docs/devtools/ ）が同じ題材の原典であり、無料で読める。

> ### 📌 ここは自分で開いて読んでください
> **資料**: How to Debug JavaScript in Chrome（BrowserStack）— https://www.browserstack.com/guide/how-to-debug-js-in-chrome
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: egress プロキシの許可リスト外で WebFetch は `EGRESS_BLOCKED`、curl は CONNECT `403`。web.archive.org も 403）。以下は公式ドキュメント（原典）にもとづく要約である。
> **読みどころ**:
> 1. 初学者向けの段階的手順（DevTools の開き方 → Sources → ブレークポイント → ステップ実行）とスクリーンショットの新しさ。
> 2. BrowserStack 固有のクロスブラウザ / 実機デバッグへの接続部分。「ローカル Chrome では再現しないが実機 Android Chrome では再現する」類の問題の扱い方が書かれている可能性があり、本教科書は扱っていない。
> 3. モバイル Chrome のリモートデバッグ（USB / `chrome://inspect`）への言及。本教科書は扱っていない。
> **代替手段**: 公式 Chrome DevTools ドキュメント（https://developer.chrome.com/docs/devtools/ ）。リモートデバッグは https://developer.chrome.com/docs/devtools/remote-debugging/ が公式の入口。

<!-- self-read: https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/ | egress プロキシのポリシー拒否（403 / EGRESS_BLOCKED）でアーカイブ含め取得不可 -->
<!-- self-read: https://www.browserstack.com/guide/how-to-debug-js-in-chrome | egress プロキシのポリシー拒否（403 / EGRESS_BLOCKED）でアーカイブ含め取得不可 -->

<!-- sources: https://developer.chrome.com/docs/devtools/console/api/, https://developer.chrome.com/docs/devtools/console/utilities/, https://developer.chrome.com/docs/devtools/javascript/snippets/, https://developer.chrome.com/docs/devtools/performance/, https://developer.chrome.com/docs/devtools/memory-problems/, https://developer.chrome.com/docs/devtools/shortcuts/, https://developer.chrome.com/docs/devtools/javascript/breakpoints/, https://googlechrome.github.io/devtools-samples/jank/ -->
<!-- terms: Console API, Console ユーティリティ API, severity level, monitorEvents, queryObjects, getEventListeners, debug, monitor, Snippets, CPU throttling, FPS, forced reflow, RAIL モデル, ガベージコレクション, メモリリーク, メモリ膨張, detached DOM tree, Heap Snapshot, Allocation Timeline, Allocation Sampling, Chrome Task Manager, source, sink, Trusted Type ブレークポイント, DOM-based XSS -->
