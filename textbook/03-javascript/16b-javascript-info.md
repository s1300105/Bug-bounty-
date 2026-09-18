# ブラウザの境界とネットワーク層 — 同一オリジンポリシー・CORS・Cookie・クリックジャッキング

> **この節で分かること**
> - スクリプトが生成したイベントと本物のユーザ操作を区別する仕組み（`isTrusted`）を説明できる
> - 同一オリジンポリシー（Same-Origin Policy）が何を許し何を禁じるか、`postMessage` でどう越えるかを説明できる
> - クリックジャッキング攻撃の成立条件と、`X-Frame-Options` / `samesite` Cookie による防御を自分で確認できる
> - Fetch の CORS が「safe / unsafe リクエスト」と preflight でどう働くかを、実際のヘッダを見ながら追える
> - Cookie の各属性（`secure` / `samesite` / `httpOnly` / `domain` / `path`）と XSRF 攻撃の関係を説明できる
> - LocalStorage・モジュール・crossorigin 属性・ReDoS がバグハンティングでどこにつながるかを言える

**元資料**: https://javascript.info/ （原典は取得できず二次情報ベース。ただし全本文は公式リポジトリ `javascript-tutorial/en.javascript.info` の Markdown として逐語取得済み）
**関連する節**: 本ノート前半（JavaScript コア・DOM・イベント伝播・プロトタイプ汚染・イベントループ）を前提とする

---

## 0. この節の位置づけ

前半では JavaScript 言語コア、DOM ノードのプロパティ（`innerHTML` などの XSS シンク）、イベントのバブリング・キャプチャ・デリゲーションまでを扱った。この後半は、そこから先の **「ブラウザという実行環境がオリジン（origin）という境界をどう引き、その境界を越えるデータがどこから入ってくるか」** に集中する。

オリジン（origin）とは、URL の「プロトコル・ドメイン・ポート」の三つ組のこと。たとえば `https://site.com:443` が1つのオリジンである。クライアントサイドのバグバウンティで狙う脆弱性の多く（XSS、CSRF/XSRF、クリックジャッキング、オープンリダイレクト、CORS 設定ミス）は、この境界の「どこがゆるいか」を突くものだ。だからまず境界の正確な仕様を知ることが、攻撃点と防御点の両方を見つける近道になる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: javascript.info（The Modern JavaScript Tutorial）— https://javascript.info/
> **なぜ**: 本教科書の執筆環境からはサイト本体を自動取得できなかった（理由: 組織の egress ポリシーにより `javascript.info:443` への接続が 403 で拒否された）。ただし全記事の本文は公式リポジトリ `javascript-tutorial/en.javascript.info` に同一内容の Markdown として存在するため、以下の記述はその一次ソースの逐語読解にもとづく。失われているのは、サイト上でのみ動く「実行可能なライブデモ」「図版（SVG）」「各記事末尾の課題と解答」だけである。
> **読みどころ**:
> 1. **トップページ `https://javascript.info/` の Part 分けラベルと各章カードの1行要約**。本ノートでは「Part 3（追加記事）」のグルーピングだけがサイト表示上未確認なので、ここは実物で確認する価値がある。
> 2. **各記事末尾の「Tasks（課題）」と `solution.md`**。リポジトリには課題と解答が合計 500 ファイル以上あり本文とは別枠。とくに `/closure`・`/prototype-inheritance`・`/bubbling-and-capturing`・`/event-delegation` の課題は、スコープ解決・プロトタイプ探索・イベント伝播の順序を自力で追う訓練になる（サイト上では解答が折りたたみで、実行可能）。
> 3. **`run` / `autorun` マーカー付きのライブ実行コード例**。`/event-loop` の `setTimeout`/`queueMicrotask` による描画タイミング差、`/regexp-catastrophic-backtracking` のハングするパターン（V8 8.8+ ではハングしない）は、実際に動かさないと体感できない。
> 4. **図版（SVG 一覧）**。プロトタイプ汚染（`object-prototype-2.svg`）、CORS の preflight シーケンス（`xhr-preflight.svg`）、XSRF/サードパーティ Cookie（`cookie-xsrf.svg`、`cookie-third-party.svg`）、イベントフロー・イベントループ図などは、文章より図のほうが速い。
> 5. **`/clickjacking` と `/cross-window-communication` の `codetabs` 埋め込みデモ**。半透明 iframe のクリックジャッキング、`postMessage` の往復、`sandbox` iframe で何が動かないかを、実際に触って体感できる。
> 6. **`/manuals-specifications`（仕様の索引）**。ECMA-262・MDN・compat テーブルなど一次資料の引き方の指針そのものがここにある。
> **代替手段**: サイトがブロックされている環境では、公式リポジトリの Markdown を直接取得できる。
> ```bash
> git clone --depth 1 --filter=blob:none --sparse https://github.com/javascript-tutorial/en.javascript.info.git
> cd en.javascript.info
> git sparse-checkout set --no-cone '/*.md' '/**/*.md'
> ```
> フォルダ名から先頭の `NN-` を除いたものが URL の slug になる（例: `1-js/06-advanced-functions/03-closure/article.md` → `https://javascript.info/closure`）。

---

## 1. 信頼できるイベントと偽イベント — `isTrusted`

### 1.1 なぜ区別が必要か（設計意図）

ブラウザは、ユーザが本当にマウスやキーボードで起こしたイベントと、スクリプトが `dispatchEvent` で人工的に発火させたイベントを区別する。理由は明快で、**「ユーザが実際にクリックした」ことを前提に安全性を判断している機能（ポップアップ許可、権限プロンプトなど）を、スクリプトが勝手に偽装できてはいけない**からだ。

### 1.2 どう動くのか（仕組み）

カスタムイベントは `Event` コンストラクタで作る。

```js
let event = new Event(type[, options]);
```

`options` には2つの任意プロパティがある。

| プロパティ | 意味 |
|---|---|
| `bubbles: true/false` | `true` ならイベントはバブルする |
| `cancelable: true/false` | `true` なら `preventDefault()` でデフォルトアクションを防げる |

デフォルトは両方 `false`（`{bubbles: false, cancelable: false}`）である。`elem.dispatchEvent(event)` を呼ぶと、そのイベントは通常のブラウザイベントと同じようにハンドラを起動する。

ここで重要なのが `event.isTrusted` プロパティである。

> `event.isTrusted` は、実際のユーザアクションから来たイベントでは `true`、スクリプト生成イベントでは `false` である。

### 1.3 攻撃者はどこを突くか

攻撃者が XSS でページにスクリプトを注入できたとしても、`dispatchEvent` で発火させた偽クリックは `isTrusted === false` になる。したがって、機密な操作の前に `event.isTrusted` を確認しておけば、スクリプト由来の自動クリックを弾ける。逆に言うと、**この確認を怠っているアプリは、注入されたスクリプトからの偽イベントで自動操作されうる**。

### 1.4 カスタムイベントの落とし穴

- カスタムイベントには `addEventListener` を使う必要がある。`on<event>`（例: `document.onhello`）は組み込みイベントにしか存在せず動かない。
- バブルさせたいなら `bubbles: true` を明示する。
- UI 系イベント（`click` など）を作るなら汎用の `Event` ではなく専用クラス（`new MouseEvent("click")`）を使う。汎用 `Event` では `clientX` のような標準プロパティを指定できず `undefined` になる。ただし**ブラウザ生成のイベントは常に正しい型を持つ**。
- 独自の情報を運ぶなら `new CustomEvent` を使い、第2引数に `detail` を入れる。ハンドラは `event.detail` で読む。`detail` という特別フィールドがあるのは、他のイベントプロパティとの衝突を避けるためである。

### 1.5 イベント内イベントは同期的（重要な挙動）

通常イベントはキューで処理されるが、**あるイベントハンドラの内部から別のイベントが起きた場合（例: `dispatchEvent`）は即座に処理される**。ネストしたイベントの処理が終わってから外側のコードに戻る。出力順は `1 -> nested -> 2` になる。分離したいなら `dispatchEvent` をゼロ遅延の `setTimeout` で包む（すると `1 -> 2 -> nested`）。

原典は、ハンドラを起動する目的でブラウザイベントを生成することを強く戒めている。

> ハンドラを走らせるためにブラウザイベントを生成すべきではない。それはハッキーな方法であり、ほとんどの場合悪いアーキテクチャである。

### 1.6 デフォルトアクションの防止

多くのイベントには「デフォルトアクション」がある（リンククリック→ナビゲーション、`submit`→フォーム送信など）。

| イベント | デフォルトアクション |
|---|---|
| `mousedown` | 選択を開始する |
| `click`（`<input type="checkbox">`） | チェック/アンチェック |
| `submit` | フォームを送信する |
| `keydown` | キー押下がフィールドへの文字追加や他のアクションにつながる |
| `contextmenu` | ブラウザのコンテキストメニュー表示 |
| リンクのクリック | その URL へのナビゲーション |

- 防止の主手段は `event.preventDefault()`。
- `on<event>` で割り当てたハンドラなら `return false` でも同じ効果。**ただしハンドラの返り値が意味を持つのはこの `on<event>` からの `return false` だけ**で、それ以外の返り値は無視される。
- `event.stopPropagation()`（伝播を止める）と `event.preventDefault()`（デフォルトを止める）は**互いに無関係な別物**である。
- `event.defaultPrevented` でデフォルトが防がれたか確認できる。`stopPropagation()` の乱用は「右クリック情報へのアクセスを、統計カウンタを含むあらゆる外部コードから永久に奪う」ため賢明でないと原典は警告する。

### 1.7 後続イベント（follow-up events）— 因果の連鎖

イベントには、**あるイベントが別のイベントに流れ込む**ものがある。この場合、最初のイベントを `preventDefault()` で防ぐと、後続のイベントも起こらない。

典型例が `<input>` へのマウス操作である。`<input>` 上の `mousedown` は、フォーカスの獲得と `focus` イベントの発火につながっている。したがって:

- `mousedown` を `preventDefault()` で防ぐと、その入力欄は**フォーカスされない**（`focus` イベントも起きない）。
- ただしこれはマウスクリック経由の話で、**`Tab` キーで移動すれば依然フォーカスできる**。

この連鎖を知らないと、「クリックしても入力欄が反応しない」バグの原因を見誤る。逆に防御的には、望まないデフォルト動作を根元のイベントで断てるという意味でもある。

### 1.8 `passive` オプション — スクロールの遅延を避ける

`addEventListener` の任意オプション `passive: true` は、**そのハンドラが `preventDefault()` を呼ばないことをブラウザに前もって知らせる**仕組みである。

なぜ必要かというと、モバイルの `touchmove` などはデフォルトでスクロールを起こすが、ハンドラ内の `preventDefault()` でそれを止められる。そのためブラウザは、イベントを検出したらまず全ハンドラを走らせ、どこでも `preventDefault()` が呼ばれなかったことを確認してからスクロールに進む。これがスクロールの**不要な遅延**と UI の「ジッタ（jitter、がくつき）」を生む。`passive: true` を付けておけば、ブラウザは `preventDefault()` を待たずに即スクロールできる。

- **Firefox・Chrome では、`touchstart` と `touchmove` イベントに対して `passive` はデフォルトで `true`** になっている（明示しなくても passive 扱い）。

---

## 2. Shadow DOM のイベント境界 — retargeting

〔前提〕Shadow DOM とは、Web コンポーネントの内部構造を外から隠すための「影の DOM ツリー」のこと。カプセル化を保つため、ブラウザはイベントを **retarget（再ターゲット）** する。

- Shadow DOM 内で発生したイベントは、コンポーネントの外で捕捉されたとき **host 要素を `target` とする**。内部の `<button>` をクリックしても、外側の `document` ハンドラには `target = <user-card>`（ホスト）として見える。
- ただし light DOM に物理的に存在する slotted 要素（`<span slot="username">`）でイベントが起きた場合は retargeting されず、両側で `target` はその要素のまま。
- 元のイベントターゲットへの完全なパスは `event.composedPath()` で得られる。ただし **`{mode:'open'}` のツリーでのみ内部が見え、`{mode:'closed'}` では host から上しか見えない**。
- 元のイベントターゲットへの完全なパスは `event.composedPath()` で得られる。例として、slotted な `<span slot="username">` をクリックすると `[span, slot, div, shadow-root, user-card, body, html, document, window]` という配列が返る（flattened DOM 上の親チェーンそのもの）。

境界を越えるかどうかは `event.composed` の値で決まる。ハンティングでは「どのイベントが shadow 境界を越えて外から観測できるか」が情報漏洩の判定材料になるので、以下は**代表例ではなく完全な一覧**を挙げる。

**shadow 境界を越える（`composed: true`）イベント**:

| 分類 | イベント |
|---|---|
| フォーカス | `blur`, `focus`, `focusin`, `focusout` |
| マウス | `click`, `dblclick`, `mousedown`, `mouseup`, `mousemove`, `mouseout`, `mouseover` |
| ホイール | `wheel` |
| 入力・キー | `beforeinput`, `input`, `keydown`, `keyup` |
| touch / pointer | **すべての touch イベントと pointer イベント** |

**shadow 境界を越えない（`composed: false`）イベント**（同一 DOM 内でしか捕捉できない）:

| 分類 | イベント |
|---|---|
| マウス（バブルもしない） | `mouseenter`, `mouseleave` |
| リソース系 | `load`, `unload`, `abort`, `error` |
| 選択 | `select` |
| スロット | `slotchange` |

- カスタムイベントをコンポーネント外へ届けたいなら `bubbles` と `composed` の**両方**を `true` にする必要がある。
- ネストしたコンポーネント（shadow DOM の中に別の shadow DOM）では、`composed: true` のイベントは**すべての shadow 境界を越えて**バブルする。直近の囲むコンポーネントだけに届けたいなら、shadow host 上でディスパッチして `composed: false` にすればよい。

この境界は、コンポーネント内部の入力を外から観測できるか（＝情報が漏れるか）を判断する材料になる。closed shadow tree は内部を隠す方向に働く。

---

## 3. 同一オリジンポリシー（Same-Origin Policy）とクロスウィンドウ通信

### 3.1 なぜ存在するか（設計意図）

同一オリジンポリシー（Same-Origin Policy, SOP）とは、あるオリジンのスクリプトが別オリジンのコンテンツへ勝手にアクセスするのを禁じる、ブラウザセキュリティの土台となる規則のこと。これがなければ、`hacker.com` のスクリプトが `gmail.com` のあなたのメール本文を読めてしまう。

### 3.2 same origin の定義（仕組み）

> 2つの URL は、プロトコル・ドメイン・ポートが同じであれば「same origin」であると言われる。

| URL | `http://site.com` と同一オリジンか | 理由 |
|---|---|---|
| `http://site.com/my/page.html` | 同一 | パスは無関係 |
| `http://www.site.com` | 別 | ドメインが違う（`www.`） |
| `http://site.org` | 別 | ドメインが違う（`.org`） |
| `https://site.com` | 別 | プロトコルが違う |
| `http://site.com:8080` | 別 | ポートが違う |

SOP が具体的に何を許すか:

- 別ウィンドウ（`window.open` のポップアップや `<iframe>` 内）への参照があり、それが**同一オリジン**なら、そのウィンドウへ完全なアクセスができる。
- **別オリジン**なら、変数も document も読めない。**唯一の例外が `location`** で、これは**書き込みは可能（＝ユーザをリダイレクトできる）だが読み取りは不可能**（今どこにいるかは見えない）。

### 3.3 window の階層ナビゲーション — `top` / `parent` / `frames`

フレーム（`<iframe>`）はページの中に別のページを埋め込む。埋め込む側・埋め込まれる側の `window` オブジェクトは、次のプロパティで互いを行き来できる。**後述の framebusting コード（節5.2）や covering div（節5.4）に出てくる `top` はこれである**ため、先に定義しておく。

| プロパティ | 指すもの |
|---|---|
| `window.frames[0]` | ドキュメント内の最初のフレームの window（番号指定） |
| `window.frames.iframeName` | `name="iframeName"` のフレームの window（名前指定） |
| `window.parent` | 一つ外側（親）のウィンドウ |
| `window.top` | 最上位（一番外）のウィンドウ |

`window.top` は、何段ネストしていても必ず一番外側のウィンドウを指す。だから「自分は今フレームの中にいるか？」は次で判定できる。

```js
if (window == top) {
  // 自分がトップウィンドウ（フレーム内ではない）
} else {
  // 自分は誰かのフレームの中にいる
}
```

同一オリジンなら親子で自由にアクセスできるが、**別オリジンのフレーム間では 3.2 の SOP がそのまま効く**（`location` の書き込みだけ可、読み取り不可）。

### 3.4 iframe での実際

| 操作（別オリジンの iframe に対して） | 結果 |
|---|---|
| `iframe.contentWindow` の取得 | 許される |
| `iframe.contentDocument` | Security Error |
| `iframe.contentWindow.location.href` の読み取り | Security Error |
| `iframe.contentWindow.location = '/'` の書き込み | OK（別ページをロードできる） |

同一オリジンなら `iframe.contentDocument.body.prepend("...")` のように何でもできる。別オリジンの iframe では `iframe.contentWindow.onload` にアクセスできないので、代わりに `iframe.onload` を使う。

### 3.5 `document.domain` — 非推奨の緩和策

同じ2次レベルドメインを共有する `john.site.com` と `peter.site.com` は、両方で `document.domain = 'site.com';` を実行すればクロスウィンドウ通信の目的で「same origin」扱いになる。ただし原典は明確に警告している。

> 非推奨だがまだ動く。`document.domain` プロパティは仕様から除去される過程にある。クロスウィンドウメッセージング（`postMessage`）が推奨される代替。

### 3.6 iframe の「間違った document」の落とし穴

**iframe は生成時に即座に document を持つが、その document は後からロードされるものとは別物である**。だから生成直後に document へ手を加えると失われる。正しい document が確実にある時点は `iframe.onload` がトリガされたとき（ただし全リソースがロードされたときにのみ発火）。より早く捉えたいなら `setInterval` で `iframe.contentDocument` が新しくなったか監視する。

### 3.7 `sandbox` 属性 — iframe を強制的に「別オリジン」にする

`sandbox` 属性は、信頼できないコードを iframe で走らせるとき、特定のアクションを禁じる仕組みである。**空の `sandbox` が最も厳しく**、緩和したい制限だけをスペース区切りで足す。

| 値 | 意味 |
|---|---|
| `allow-same-origin` | デフォルトの「別オリジン扱い」を解除する（`src` が同じサイトでも別オリジンとして扱う制限を外す） |
| `allow-top-navigation` | `parent.location` の変更を許可 |
| `allow-forms` | フォーム送信を許可 |
| `allow-scripts` | スクリプト実行を許可 |
| `allow-popups` | `window.open` のポップアップを許可 |

原典の注記が防御上とても重要である。

> `sandbox` 属性の目的は制限を追加することのみである。制限を除去することはできない。特に、iframe が別オリジンから来ている場合に same-origin 制限を緩和することはできない。

### 3.8 `postMessage` — 合意の上でオリジンを越える

`postMessage` は、オリジンが違うウィンドウ同士でも、**双方が同意して対応する関数を呼ぶ場合に限り**通信を可能にするインターフェースである。だからユーザにとって安全だとされる。

**送信側**: `win.postMessage(data, targetOrigin)`

| 引数 | 意味 |
|---|---|
| `data` | 送るデータ。任意のオブジェクトでよく、structured serialization algorithm でクローンされる |
| `targetOrigin` | 指定したオリジンのウィンドウだけがメッセージを受け取る |

`targetOrigin` は安全策である。送信側は別オリジンのターゲットの `location` を読めないため、ターゲットが今も意図したサイトを開いているとは確信できない（ユーザが別サイトへ移動したかもしれない）。`targetOrigin` を指定すれば、**そのウィンドウがまだ正しいサイトにある場合にのみデータが届く**。データが機密なときに重要だ。チェック不要なら `*` にできる。

**受信側**:

| イベントプロパティ | 意味 |
|---|---|
| `data` | 送られたデータ |
| `origin` | 送信側のオリジン（例: `http://javascript.info`） |
| `source` | 送信側ウィンドウへの参照。`source.postMessage(...)` で返信できる |

原典のハンドラ例（逐語）:

```js
window.addEventListener("message", function(event) {
  if (event.origin != 'http://javascript.info') {
    // something from an unknown domain, let's ignore it
    return;
  }

  alert( "received: " + event.data );

  // can message back using event.source.postMessage(...)
});
```

**攻撃者はどこを突くか**: 受信側が `event.origin` を検証していないと、任意のオリジンから送られたメッセージを信頼してしまう。これは実際の CSPM（クロスサイト postMessage）バグの典型で、`event.data` をそのまま `innerHTML` や `eval` に流していれば XSS になる。ハンドラの割り当てには `addEventListener` を使う必要があり、短縮構文 `window.onmessage` は動かない点も覚えておく。

---

## 4. ポップアップと window 操作

### 4.1 なぜまだ使われるか

`window.open('https://...')` は新ウィンドウ（多くは新タブ）を開く。OAuth 認可（Google/Facebook ログイン）などで今も使われる理由は、**ポップアップが独立した JavaScript 環境を持つ別ウィンドウであり、信頼できないサイトから開いても安全だから**である。

### 4.2 ポップアップブロッキング

ほとんどのブラウザは、`onclick` のような**ユーザトリガのハンドラ外**から呼ばれたポップアップをブロックする。

```js
// popup blocked
window.open('https://javascript.info');

// popup allowed
button.onclick = () => {
  window.open('https://javascript.info');
};
```

### 4.3 `window.open(url, name, params)` の要点

- `name` は新ウィンドウの名前。**同名のウィンドウが既にあればそこに URL がロードされ、なければ新規に開く**。
- `params` はカンマ区切りの設定文字列で**スペースを含んではならない**（`width=200,height=100`）。

`params` に書ける主な設定は次のとおり。位置・サイズと、ウィンドウ機能の `yes/no` 群に分かれる。

| 設定 | 値 | 意味・注記 |
|---|---|---|
| `left` / `top` | 数値 | 画面上の左上隅の座標。**画面外には配置できない**制限がある |
| `width` / `height` | 数値 | 幅と高さ。**最小サイズに制限があり、不可視ウィンドウは作れない** |
| `menubar` | yes/no | ブラウザメニューの表示/非表示 |
| `toolbar` | yes/no | ナビゲーションバー（戻る・進む・リロード等）の表示/非表示 |
| `location` | yes/no | URL フィールドの表示/非表示。**FF と IE はデフォルトで非表示にすることを許さない** |
| `status` | yes/no | ステータスバーの表示/非表示。**ほとんどのブラウザは強制的に表示する** |
| `resizable` | yes/no | リサイズの可否。**無効化は非推奨** |
| `scrollbars` | yes/no | スクロールバーの可否。**無効化は非推奨** |

省略時の規則:

- 第3引数が無い／空なら、デフォルトのウィンドウパラメータが使われる。
- **`params` 文字列があって一部の `yes/no` 機能を省略すると、省略した機能は `no` とみなされる**。そのため `params` を指定するなら、必要な機能はすべて明示的に `yes` にする。
- `left/top` が無ければ最後に開いたウィンドウの近くに、`width/height` が無ければ最後と同じサイズで開かれる。

### 4.4 opener との双方向性と悪用防止の歴史

- ポップアップ側から opener を指す `window.opener` は、ポップアップ以外の全ウィンドウでは `null`。メインとポップアップは互いへの参照を持つ（双方向）。
- `win.close()` は `window.open` で作られていないウィンドウではほとんど無視される。
- `moveBy`/`resizeTo`/`focus`/`blur` などは、過去に悪意あるページが悪用した（例: `window.onblur = () => window.focus();` でユーザをウィンドウに閉じ込める）ため、ブラウザが強く制限している。JavaScript にはウィンドウを最小化/最大化する手段がない。

---

## 5. クリックジャッキング攻撃

### 5.1 攻撃の考え方（どこを突くか）

クリックジャッキング（clickjacking）とは、悪意あるページが**訪問者の代わりに被害者サイトをクリックさせる**攻撃のこと。原典によれば Twitter・Facebook・Paypal を含む多くのサイトがこの方法でハックされた（すべて修正済み）。

手順:

```
1. 訪問者を悪意あるページに誘い込む
2. ページに無害そうなリンク（"click here, very funny"）を置く
3. そのリンクの真上に、被害者サイトを src とする透明な <iframe> を z-index で重ねる
   （被害者サイトの「Like」ボタンがリンクの真上に来るように）
4. 訪問者はリンクをクリックしたつもりで、実際にはボタンをクリックする
```

原典のデモ（逐語。実運用では `opacity: 0`）:

```html
<style>
iframe { /* iframe from the victim site */
  width: 400px;
  height: 100px;
  position: absolute;
  top:0; left:-20px;
  opacity: 0.5; /* in real opacity:0 */
  z-index: 1;
}
</style>

<div>Click to get rich now:</div>

<!-- The url from the victim site -->
<iframe src="/clickjacking/facebook.html"></iframe>

<button>Click here!</button>

<div>...And you're cool (I'm a cool hacker actually)!</div>
```

訪問者が被害者サイトに認証済み（"remember me" は通常オン）なら、「Like」や「Follow」が実行される。**クリックジャッキングはクリック用であり、キーボード入力のリダイレクトははるかに困難**（隠れた入力欄は文字が見えず、人は入力をやめる）。

### 5.2 弱い防御 — framebusting とその回避

古典的な framebusting:

```js
if (top != window) {
  top.location = window.location;
}
```

ここで `top`（＝`window.top`、節3.3）は**最上位ウィンドウ**を指す。「自分がトップでない＝誰かのフレームに埋め込まれている」なら、トップの `location` を自分の URL に書き換えて、自分をフレームから飛び出させる、という発想である。

これは信頼できない。回避方法が複数ある。

- **回避1（トップナビゲーションのブロック）**: 攻撃者側の外枠ページが `window.onbeforeunload = function() { return false; };` を設定する。iframe が `top.location` を変えようとすると離脱確認が出るが、訪問者は iframe を知らないので「留まる」を選び、`top.location` は変わらない。
- **回避2（sandbox）**: `<iframe sandbox="allow-scripts allow-forms" src="...">` のように `allow-top-navigation` を省けば、iframe 自身が `top.location` を変えられなくなる（＝framebusting スクリプトが無力化される）。

### 5.3 正しい防御① — `X-Frame-Options`

サーバ側の HTTP ヘッダ `X-Frame-Options` は、ページをフレーム内で表示することを許可/禁止する。**HTTP ヘッダとして送られなければならず、`<meta http-equiv="X-Frame-Options">` は無視される**点が重要だ。

| 値 | 意味 |
|---|---|
| `DENY` | 決してフレーム内で表示しない |
| `SAMEORIGIN` | 親が同一オリジンならフレーム内表示を許可 |
| `ALLOW-FROM domain` | 親が指定ドメインならフレーム内表示を許可 |

例として Twitter は `X-Frame-Options: SAMEORIGIN` を使う。

### 5.4 正しい防御② — covering div

`X-Frame-Options` には副作用があり、正当な理由でもページがフレーム内表示できなくなる。表示は許しつつ守るなら、全画面を覆う `<div>` で全クリックをインターセプトし、自分がトップウィンドウだと確認できたら除去する。

```html
<style>
  #protector {
    height: 100%;
    width: 100%;
    position: absolute;
    left: 0;
    top: 0;
    z-index: 99999999;
  }
</style>

<div id="protector">
  <a href="/" target="_blank">Go to the site</a>
</div>

<script>
  // there will be an error if top window is from the different origin
  // but that's ok here
  if (top.document.domain == document.domain) {
    protector.remove();
  }
</script>
```

### 5.5 正しい防御③ — `samesite` Cookie

`samesite` 属性を持つ Cookie は**サイトが直接開かれたときにのみ送られ、フレーム経由などでは送られない**。被害者サイトが認証 Cookie に `samesite` を付けていれば、別サイトからの iframe では Cookie が送られず攻撃は失敗する。

ただし限界がある。原典の逐語:

> `samesite` Cookie 属性は Cookie が使われていない場合には効果がない。…例えば、IP アドレスをチェックして重複投票を防ぐ匿名投票サイトは、Cookie でユーザを認証していないため、依然としてクリックジャッキングに脆弱である。

原典の推奨: フレーム内表示を意図しないページには `X-Frame-Options: SAMEORIGIN`、表示させたいが安全でいたいなら covering div を使う。**「脆弱性はまったく予期しない場所で見つかりうる」**という一文は、ハンターにとって重要なヒントである。

---

## 6. Fetch の基本と body 読み取り

### 6.1 2段階のレスポンス取得

`let promise = fetch(url, [options])` は2段階で結果を返す。

1. `fetch` の返す promise は、サーバがヘッダで応答した時点で `Response` オブジェクトとして解決される。この段階ではステータスとヘッダは読めるが body はまだない。
   - **promise が reject するのはネットワーク的にリクエストできなかった場合だけ**。404 や 500 は reject を引き起こさない（`response.ok` は 200-299 でのみ `true`）。
2. body 取得には追加のメソッド呼び出しが要る。

| メソッド | 動作 |
|---|---|
| `response.text()` | テキストとして返す |
| `response.json()` | JSON としてパース |
| `response.formData()` | `FormData` として返す |
| `response.blob()` | Blob として返す |
| `response.arrayBuffer()` | ArrayBuffer として返す |
| `response.body` | ReadableStream。チャンクごとに読める |

**body 読み取りメソッドは1つしか選べない**。`response.text()` の後に `response.json()` は動かない。

### 6.2 設定できない「禁止ヘッダ」

`fetch` の `headers` で設定**できない** forbidden HTTP headers がある。これらはブラウザが排他的に制御する。

```
Accept-Charset, Accept-Encoding, Access-Control-Request-Headers,
Access-Control-Request-Method, Connection, Content-Length,
Cookie, Cookie2, Date, DNT, Expect, Host, Keep-Alive, Origin,
Referer, TE, Trailer, Transfer-Encoding, Upgrade, Via,
Proxy-*, Sec-*
```

`Cookie` や `Origin` をスクリプトから偽装できないのは、まさにこの制御のおかげである。

### 6.3 POST の body と Content-Type

`body` は文字列・`FormData`・`Blob`/`BufferSource`・`URLSearchParams` が使える。**body が文字列なら `Content-Type` はデフォルトで `text/plain;charset=UTF-8`** になる。`Blob` を送る場合はその型が `Content-Type` の値になる。

---

## 7. CORS — クロスオリジンリクエストの許可の仕組み

### 7.1 なぜ CORS があるか（歴史）

長年、あるサイトのスクリプトは別サイトのコンテンツにアクセスできなかった。この規則がインターネットセキュリティの基礎で、`hacker.com` は `gmail.com` のメールにアクセスできなかった。しかし開発者はより多くの力を求め、回避トリックが生まれた。

- **トリック1（フォーム）**: `<form target="iframe" method="POST" action="http://another.com/…">` でどこへでもデータを送れた。ただし別サイトの iframe の中身は読めないので**レスポンスは読めなかった**。
- **トリック2（JSONP）**: `<script src="http://another.com/weather.json?callback=gotWeather">` を使い、リモートが `gotWeather(...)` を呼ぶスクリプトを返す。双方が同意しているのでハックではない。古いブラウザでも動くため今も残る。

CORS（Cross-Origin Resource Sharing, オリジン間リソース共有）は、この「双方の合意」を正式なヘッダのやり取りに置き換えたものだ。

### 7.2 safe リクエストの定義

リクエストが safe（安全）なのは次の両方を満たすとき:

1. **safe method**: GET, POST, HEAD のいずれか
2. **safe headers**: カスタムヘッダが以下だけ
   - `Accept`, `Accept-Language`, `Content-Language`
   - `Content-Type` の値が `application/x-www-form-urlencoded` / `multipart/form-data` / `text/plain` のいずれか

本質は、**safe リクエストは昔ながらの `<form>` や `<script>` でも作れるリクエストだ**という点にある。`PUT` や `API-Key` ヘッダ付きのような「昔は作れなかった」リクエストは unsafe とされ、古いサーバはそれが特権的なソースから来たと想定するかもしれない。だから CORS はそこに追加の許可を要求する。

### 7.3 safe リクエストの CORS フロー

クロスオリジンなら、ブラウザは常に `Origin` ヘッダ（パスなしの正確なオリジン）を付ける。

```http
GET /request
Host: anywhere.com
Origin: https://javascript.info
```

サーバが同意するなら `Access-Control-Allow-Origin` を返す（許可オリジンまたは `*`）。

```http
200 OK
Content-Type:text/html; charset=UTF-8
Access-Control-Allow-Origin: https://javascript.info
```

ブラウザは信頼された仲介者として、(1) 正しい `Origin` を送り、(2) レスポンスの `Access-Control-Allow-Origin` を確認し、あれば JavaScript にレスポンスを渡す。なければエラーで失敗する。

### 7.4 読めるレスポンスヘッダは限られる

クロスオリジンでは、JavaScript はデフォルトで「safe」なレスポンスヘッダにしかアクセスできない。

```
Cache-Control, Content-Language, Content-Length,
Content-Type, Expires, Last-Modified, Pragma
```

それ以外を読ませるには、サーバが `Access-Control-Expose-Headers` に名前を列挙する。

```http
Access-Control-Expose-Headers: Content-Encoding,API-Key
```

### 7.5 unsafe リクエストと preflight

unsafe リクエストの前に、ブラウザは**同じ URL へ `OPTIONS` メソッドの preflight リクエスト**を送る。body はなく、3つのヘッダを持つ。

- `Access-Control-Request-Method` — 本番リクエストのメソッド
- `Access-Control-Request-Headers` — unsafe ヘッダのカンマ区切りリスト
- `Origin` — リクエスト元

具体例。次のリクエストは `PATCH`・非標準 `Content-Type`・`API-Key` の3点で unsafe である（1点で十分）。

```js
let response = await fetch('https://site.com/service.json', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'API-Key': 'secret'
  }
});
```

**Step 1（preflight）**:

```http
OPTIONS /service.json
Host: site.com
Origin: https://javascript.info
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: Content-Type,API-Key
```

**Step 2（preflight レスポンス）**:

```http
200 OK
Access-Control-Allow-Origin: https://javascript.info
Access-Control-Allow-Methods: PUT,PATCH,DELETE
Access-Control-Allow-Headers: API-Key,Content-Type,If-Modified-Since,Cache-Control
Access-Control-Max-Age: 86400
```

`Access-Control-Max-Age: 86400`（1日）の間は、同じ許可に合致する後続リクエストで preflight が省かれる。

**Step 3（実リクエスト）→ Step 4（実レスポンス）**: 実レスポンスにも `Access-Control-Allow-Origin` を付け忘れてはならない（preflight 成功はそれを免除しない）。**preflight は舞台裏で起き、JavaScript には見えない**。

### 7.6 Credentials（Cookie を伴うクロスオリジン）

- JavaScript が始めたクロスオリジンリクエストは、**デフォルトで Cookie も HTTP 認証も送らない**。`fetch('http://another.com')` は、たとえ `another.com` の Cookie でも送らない。
- 送るには `fetch('http://another.com', { credentials: "include" });`。
- サーバは `Access-Control-Allow-Origin` に加えて `Access-Control-Allow-Credentials: true` を返す必要がある。
- **credential 付きでは `Access-Control-Allow-Origin: *` は禁止**。必ず正確なオリジンを返さねばならない。これは、サーバが本当に信頼する相手を明示させるための安全策である。

**攻撃者はどこを突くか**: CORS 設定ミスは頻出のバグバウンティ対象だ。サーバが `Origin` を無検証で反射（reflect）して `Access-Control-Allow-Origin` に入れ、かつ `Access-Control-Allow-Credentials: true` を返していると、任意のオリジンが認証済みの機密レスポンスを読めてしまう。逆に `*` を返しているだけなら Cookie は付かないので、影響は公開データに限られる。この違いを見分けられることが診断の要になる。

---

## 8. Fetch API の全オプション

原典が挙げるすべての `fetch` オプションとデフォルト値（逐語）:

```js
let promise = fetch(url, {
  method: "GET", // POST, PUT, DELETE, etc.
  headers: {
    "Content-Type": "text/plain;charset=UTF-8"
  },
  body: undefined, // string, FormData, Blob, BufferSource, or URLSearchParams
  referrer: "about:client", // or "" to send no Referer header,
  referrerPolicy: "strict-origin-when-cross-origin",
  mode: "cors", // same-origin, no-cors
  credentials: "same-origin", // omit, include
  cache: "default", // no-store, reload, no-cache, force-cache, or only-if-cached
  redirect: "follow", // manual, error
  integrity: "", // a hash, like "sha256-abcdef1234567890"
  keepalive: false, // true
  signal: undefined, // AbortController to abort request
  window: window // null
});
```

### 8.1 `referrer` と `referrerPolicy`

`referrer` は `Referer` ヘッダを（同一オリジン内の URL で）差し替えるか、`""` で消せる。`referrerPolicy` は送る量を制御する。

| 値 | To same origin | To another origin | HTTPS→HTTP |
|---|---|---|---|
| `"no-referrer"` | - | - | - |
| `"no-referrer-when-downgrade"` | full | full | - |
| `"origin"` | origin | origin | origin |
| `"origin-when-cross-origin"` | full | origin | origin |
| `"same-origin"` | full | - | - |
| `"strict-origin"` | origin | origin | - |
| `"strict-origin-when-cross-origin"`（デフォルト） | full | origin | - |
| `"unsafe-url"` | full | full | full |

デフォルトの `strict-origin-when-cross-origin` は、同一オリジンには完全な URL、クロスオリジンにはオリジンのみ、HTTPS→HTTP では何も送らない。**攻撃者はどこを突くか**: `admin/secret/paths` のような秘密の URL 構造が `Referer` 経由で外部サイトへ漏れることがある。`Referer` の漏れは実際のバグとして報告対象になる。ポリシーは `Referrer-Policy` HTTP ヘッダでページ全体に、`<a rel="noreferrer">` でリンク単位に設定できる。

### 8.2 `mode` — 偶発的クロスオリジンの遮断

| 値 | 意味 |
|---|---|
| `"cors"` | デフォルト。クロスオリジン許可 |
| `"same-origin"` | クロスオリジン禁止 |
| `"no-cors"` | safe なクロスオリジンのみ許可 |

`fetch` の URL がサードパーティ由来のとき、クロスオリジン機能を切る「電源オフスイッチ」として使える。

### 8.3 `credentials` / `cache` / `redirect`

- `credentials`: `"same-origin"`（デフォルト、クロスオリジンには送らない）/ `"include"`（常に送る）/ `"omit"`（同一オリジンにすら送らない）。
- `cache`: `"default"` / `"no-store"` / `"reload"` / `"no-cache"` / `"force-cache"` / `"only-if-cached"`（`only-if-cached` は `mode: "same-origin"` のときのみ動く）。`"no-store"` は HTTP キャッシュを完全に無視するモードで、**`If-Modified-Since` / `If-None-Match` / `If-Unmodified-Since` / `If-Match` / `If-Range` のいずれかのヘッダを自分で設定すると、この `no-store` が自動的にデフォルトになる**（条件付きリクエストとキャッシュの二重管理を避けるため）。
- `redirect`: `"follow"`（デフォルト）/ `"error"` / `"manual"`（`response.type="opaqueredirect"` の特別 response を得る）。

### 8.4 `integrity`（Subresource Integrity）

`integrity` はレスポンスが既知のチェックサムに一致するか検証する。サポートは SHA-256 / SHA-384 / SHA-512。`fetch('http://site.com/file', { integrity: 'sha256-abcdef' });` のように書き、不一致ならエラーになる。CDN 配信のスクリプトが改ざんされていないことを保証する防御に使える。

### 8.5 `keepalive`

`keepalive: true` は、ページを離れた後もバックグラウンドでリクエストを続けさせる（アンロード時の統計送信など）。**全 keepalive リクエスト合計で body は 64KB まで**。アンロード後はレスポンスを処理できない。

```js
window.onunload = function() {
  fetch('/analytics', {
    method: 'POST',
    body: "statistics",
    keepalive: true
  });
};
```

---

## 9. URL オブジェクトとエンコーディング

### 9.1 `URL` の分解

`new URL(url, [base])` は URL を扱いやすいオブジェクトにする。`href`（完全 URL）、`protocol`（末尾に `:`）、`search`（`?` で始まる）、`hash`（`#` で始まる）、`host`、`pathname` を持つ。HTTP 認証があれば `user`/`password` も持ちうる（`http://login:password@site.com`、まれ）。`URL` オブジェクトは `fetch` などへ文字列の代わりに渡せる。

### 9.2 `URLSearchParams`

`append` / `delete` / `get` / `getAll` / `has` / `set` / `sort` を持ち、`Map` と同様に反復できる。パラメータは自動でエンコードされる（`set('q', 'test me!')` → `?q=test+me%21`）。

### 9.3 `encodeURI` と `encodeURIComponent` の違い（重要）

| 関数 | エンコードする対象 |
|---|---|
| `encodeURI` | URL 全体用。URL で完全に禁止された文字のみ |
| `encodeURIComponent` | URL の部品（検索パラメータ・hash など）用。加えて `# $ & + , / : ; = ? @` もエンコード |

比較例:

```js
encodeURIComponent('Rock&Roll'); // Rock%26Roll
encodeURI('Rock&Roll');          // Rock&Roll（& をエンコードしない）
```

原典の警告: 検索パラメータの内部では `&` をエンコードすべきである。さもないと `q=Rock&Roll` が `q=Rock` と曖昧なパラメータ `Roll` に分裂する。**だから各検索パラメータには `encodeURIComponent` を使うべき**。

**攻撃者はどこを突くか**: このエンコード漏れ（パラメータの値をエンコードせずに URL 文字列へ連結する）は、URL 構造の破壊やパラメータ汚染（HTTP Parameter Pollution）、オープンリダイレクトの糸口になる。なお `URL`/`URLSearchParams` は RFC3986 準拠だが `encode*` 関数は旧版 RFC2396 準拠で、IPv6 アドレスの角括弧 `[...]` を `encodeURI` が誤ってエンコードするなどの差がある。

---

## 10. XMLHttpRequest

### 10.1 なぜまだ使うか

`fetch` があってもなお `XMLHttpRequest`（XHR）が使われるのは、(1) 既存スクリプトの保守、(2) 古いブラウザ対応、(3) **`fetch` がまだできないアップロード進捗の追跡**が必要なとき。

`new XMLHttpRequest()` → `xhr.open(method, URL, [async, user, password])` → `xhr.send([body])` の3ステップ。**`open` は名前に反して接続を開かず、ネットワーク活動は `send` で始まる**。

### 10.2 イベントのライフサイクル

| イベント | 意味 |
|---|---|
| `loadstart` | リクエスト開始 |
| `progress` | データパケット到着（現時点の body 全体が `response` にある） |
| `abort` | `xhr.abort()` でキャンセル |
| `error` | 接続エラー（**404 のような HTTP エラーでは起きない**） |
| `load` | 正常完了 |
| `timeout` | タイムアウトでキャンセル |
| `loadend` | 上記の後に発火 |

`error`/`abort`/`timeout`/`load` は互いに排他的で、1つだけ起きる。アップロード追跡は `xhr.upload` で同じイベントを listen する。

〔補足〕古いコードでは進行状況の監視に `readystatechange` イベント（`xhr.readyState` の変化を追う）がよく使われた。これは仕様が固まる前の**歴史的な**仕組みで、上記の `load`/`error`/`progress` がある**今は使う必要がない**。既存コードを読むとき用に名前だけ覚えておけばよい。

### 10.3 同期リクエストとクロスオリジン

`open` の第3引数 `async` を `false` にすると同期リクエストになり、ページ内 JavaScript がブロックされる。**同期では別ドメインへのリクエストやタイムアウト指定などの高度機能は使えない**。クロスオリジンは `fetch` と同じ CORS ポリシーで行い、Cookie を送るには `xhr.withCredentials = true;` を設定する。

---

## 11. Cookie と XSRF

### 11.1 Cookie とは（設計）

Cookie とは、ブラウザに保存される小さなデータ文字列のこと。HTTP プロトコルの一部で RFC 6265 が定義する。サーバがレスポンスの `Set-Cookie` で設定し、ブラウザが同じドメインへの（ほぼ）全リクエストに `Cookie` ヘッダで自動付与する。最大のユースケースは認証で、サインイン時にセッション識別子を `Set-Cookie` で渡し、以後ブラウザが自動送信することで「誰か」をサーバが認識する。

### 11.2 読み書き

- `document.cookie` は `name=value` を `; ` で区切った文字列。
- `document.cookie` はデータではなく**アクセサ（getter/setter）**で、代入は特別扱いされる。**書き込みはそこに記した Cookie だけを更新し、他には触れない**。
- 一度に設定できるのは1つ、`encodeURIComponent` 後の `name=value` は 4KB 以内、ドメインあたり約 20+ 個まで。

### 11.3 Cookie 属性の完全表（防御の核心）

| 属性 | 書式 | 意味 |
|---|---|---|
| `domain` | `domain=site.com` | Cookie がアクセス可能な場所を定義。**別の2次レベルドメインからはアクセスできない**（`other.com` は `site.com` の Cookie を受け取れない）。デフォルトでは設定したドメインのみで、サブドメインとも共有しない。共有には `domain=site.com` を明示する。**レガシー構文**: 歴史的には先頭にドットを付けた `domain=.site.com` が同じ動作をした。**この先頭ドットは現在は無視される**が、一部のブラウザはドット付きの Cookie 設定を拒否しうるので使わない |
| `path` | `path=/mypath` | 絶対パス。`path=/admin` なら `/admin` と `/admin/something` で可視、`/home` や `/` では不可視。通常は `path=/` |
| `expires` | `expires=Tue, 19 Jan 2038 03:14:07 GMT` | 有効期限。GMT でこの形式。過去日で削除。`date.toUTCString` で得られる |
| `max-age` | `max-age=3600` | 現在からの秒数。ゼロ/負で削除。**両方あれば `max-age` 優先** |
| （両方なし） | — | ブラウザ/タブを閉じると消える「セッション Cookie」 |
| `secure` | `secure` | HTTPS 経由でのみ転送。**デフォルトでは Cookie はプロトコルを区別しない**（http で設定すると https にも出る）。この属性で https 専用にできる |
| `samesite` | `samesite=strict` / `samesite=lax` | XSRF 対策。後述 |
| `httpOnly` | （サーバの `Set-Cookie` のみ） | **JavaScript からのアクセスを一切禁じる**。`document.cookie` で見えない |

### 11.4 XSRF 攻撃（原典の説明）

XSRF（Cross-Site Request Forgery、クロスサイトリクエストフォージェリ）とは、被害者のブラウザが持つ Cookie が自動送信される性質を悪用し、被害者になりすまして操作を実行させる攻撃のこと。

> `bank.com` にログインしていると、ブラウザは全リクエストに認証 Cookie を送る。別サイト `evil.com` に `<form action="https://bank.com/pay">` を送信する JavaScript があると、ブラウザは（`evil.com` からの送信でも）`bank.com` の Cookie を送る。だから銀行はあなたを認識し支払いを実行してしまう。

原典の防御説明: 実際の銀行は、生成する全フォームに「XSRF 保護トークン」を埋め込む。邪悪なページはそれを生成も抽出もできない（フォームは送れてもデータを取り戻せない）。サーバは受け取る全フォームでトークンを検証する。ただし実装コストは高い。

### 11.5 `samesite` の2つの値

**`samesite=strict`**: ユーザがサイト外から来た場合、Cookie を一切送らない。メールのリンク・`evil.com` からのフォーム送信など、他ドメイン由来の操作すべてで送られない。認証 Cookie が `samesite=strict` なら XSRF はまず成功しない。ただし正当なリンクからの訪問でもサイトが自分を認識しない不便がある（回避策: 認識用と操作用で Cookie を2つに分ける）。

**`samesite=lax`**（値なしの `samesite` と同じ）: 体験を壊さず守る緩和版。次の**両方**が真のとき送る。

1. HTTP メソッドが safe（例: GET。POST ではない）。リンクを辿るのは常に GET で safe。
2. 操作がトップレベルナビゲーション（アドレスバーの URL を変える）。**`<iframe>` 内のナビゲーションや、ネットワークリクエスト用の JavaScript メソッドはトップレベルでない**。

欠点: **`samesite` は非常に古いブラウザ（2017年頃）では無視される**ため、それだけに依存すると古いブラウザで脆弱になる。XSRF トークンと組み合わせて多層防御にする。

### 11.6 `httpOnly` — XSS 時の Cookie 窃取を防ぐ

`httpOnly` は、ハッカーが JavaScript を注入できたケース（XSS）に備える予防措置である。

> Cookie が `httpOnly` なら、`document.cookie` はそれを見ないので保護される。

つまり XSS があっても、`httpOnly` の認証 Cookie は `document.cookie` 経由で盗めない。**攻撃者はどこを突くか**: 逆に、セッション Cookie に `httpOnly` が付いていなければ、XSS で `document.cookie` を外部へ送信するセッションハイジャックが成立しうる。診断時はここを必ず確認する。

### 11.7 サードパーティ Cookie と GDPR

- Cookie は、ユーザが見ているページ以外のドメインが置いた場合「サードパーティ」と呼ぶ。`<img src="https://ads.com/banner.png">` に伴い `ads.com` が Cookie を設定すると、その Cookie は `ads.com` のもので、サイトをまたいだユーザ追跡に使える。Safari は一切許可せず、Firefox はブラックリストでブロックする。
- **重要な区別**: サードパーティドメインの**スクリプト**（`<script src="https://google-analytics.com/analytics.js">`）が `document.cookie` で設定した Cookie は**サードパーティではない**。スクリプトがどこから来ても、その Cookie は現在のページのドメインに属する。
- GDPR は追跡/識別/認可 Cookie にユーザの明示的同意を要求する（ただ情報を保存するだけで追跡も識別もしない Cookie は自由）。原典が挙げる準拠の2パターン:
  1. **認証済みユーザにだけ追跡 Cookie を置く場合** — 登録フォームに「プライバシーポリシーに同意する」チェックボックスを置き、チェックされたら認証 Cookie を設定する。
  2. **全員に追跡 Cookie を置く場合** — 新規訪問者にモーダルの「スプラッシュスクリーン」を出し、Cookie への同意を得てから設定する。

### 11.8 Cookie ユーティリティ関数（原典の逐語）

```js
// returns the cookie with the given name,
// or undefined if not found
function getCookie(name) {
  let matches = document.cookie.match(new RegExp(
    "(?:^|; )" + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1') + "=([^;]*)"
  ));
  return matches ? decodeURIComponent(matches[1]) : undefined;
}
```

更新・削除は設定時と**まったく同じ `path` と `domain`** を使わねばならない。

---

## 12. Web Storage（LocalStorage / sessionStorage）

### 12.1 Cookie との違い

- **リクエストごとにサーバへ送られない**ので、はるかに多く保存できる（多くのブラウザで最低 5MB 以上）。
- **サーバは HTTP ヘッダで操作できない**。すべて JavaScript で行う。
- **origin（ドメイン/プロトコル/ポートの三つ組）に束縛される**。別プロトコル・別サブドメインは別の storage で、互いのデータにアクセスできない。

API は `setItem` / `getItem` / `removeItem` / `clear` / `key(index)` / `length`。

### 12.2 localStorage と sessionStorage の違い

| `localStorage` | `sessionStorage` |
|---|---|
| 同一オリジンの全タブ・全ウィンドウで共有 | 1つのブラウザタブ内（同一オリジンの iframe 含む）で可視 |
| ブラウザ再起動を生き延びる | ページリフレッシュは生き延びるがタブを閉じると消える |

### 12.3 注意点

- **キーも値も文字列**。他の型は文字列化される（オブジェクトは `[object Object]`）。オブジェクトは `JSON.stringify`/`JSON.parse` を使う。
- オブジェクト風アクセス（`localStorage.test = 2`）は非推奨。キーが `length` などの組み込み名だと失敗し、`storage` イベントも起きない。
- `storage` イベントは `setItem`/`removeItem`/`clear` でトリガされ、**その storage にアクセスできる全ウィンドウで発火する（発生元ウィンドウを除く）**。これで同一オリジンのウィンドウ間通信ができる。

| プロパティ | 意味 |
|---|---|
| `key` | 変更キー（`.clear()` なら `null`） |
| `oldValue` / `newValue` | 変更前後の値 |
| `url` | 更新が起きたドキュメントの url |
| `storageArea` | 対象の storage オブジェクト |

〔補足〕同一オリジンのウィンドウ間通信には、`storage` イベントを使う方法のほかに、専用の **Broadcast Channel API**（同一オリジンのウィンドウ間通信のためだけの API）もモダンブラウザにある。より機能豊富だがサポートは相対的に少なく、**`localStorage` をベースにこの API を polyfill（未対応環境で同等機能を補うライブラリ）する実装があり、どこでも使えるようにできる**。

**攻撃者はどこを突くか**: `localStorage` にセッショントークンを置くと、`httpOnly` Cookie と違い XSS から `localStorage.getItem` で盗める。ここに機密を置くかどうかは診断ポイントになる。

---

## 13. モジュールのセキュリティ特性

言語レベルのモジュールシステムは2015年に標準化された。バグハンティングに直結する挙動は次のとおり。

- **常に strict モード**。未宣言変数への代入がエラーになる。
- **モジュールごとに独立したトップレベルスコープ**。各 `<script type="module">` は互いのトップレベル変数を見ない。明示的に `window.user = "John"` とすればグローバルにできるが「避けるように」と原典は言う。
- **初回 import 時に一度だけ評価**。同じモジュールを複数箇所が import しても実行は1回で、同一のエクスポートオブジェクトが共有される（1箇所の変更が全体に見える＝設定の共有に使える）。
- **モジュール内では `this` は `undefined`**（非モジュールでは `window`）。
- **`import.meta`** は、現在のモジュールについての情報を持つオブジェクトである。内容は実行環境に依存し、**ブラウザではそのスクリプトの URL（HTML 内のインラインモジュールなら現在のウェブページの URL）を含む**。実行中のスクリプト自身の位置を知る手掛かりになる。
- ブラウザでは**モジュールスクリプトは常に deferred**（HTML パースをブロックせず、ページ完成後に順序を保って実行）。副作用として、モジュールスクリプトは常に完全にロード済みの HTML ページ（自分より下の要素も含む）を「見る」。
- **`async` 属性がインラインスクリプトにも効く**。非モジュールでは `async` は外部スクリプトにしか効かないが、モジュールではインラインの `<script type="module" async>` にも効く（何にも依存しないカウンタ・広告・イベントリスナ登録などに向く）。
- **`nomodule` によるフォールバック**。古いブラウザは `type="module"` を理解できず、未知の type のスクリプトを単に無視する。そこで `nomodule` 属性を付けた別スクリプトを併置すれば、モジュール対応ブラウザはそれを無視し、非対応ブラウザだけがフォールバックを実行する。
- **別オリジンから取得する外部モジュールスクリプトは CORS ヘッダを要する**。リモートは `Access-Control-Allow-Origin` を返さねば実行されない。

```html
<!-- another-site.com must supply Access-Control-Allow-Origin -->
<!-- otherwise, the script won't execute -->
<script type="module" src="http://another-site.com/their.js"></script>
```

「これはデフォルトでより良いセキュリティを保証する。」bare モジュール（パスなし）は不可、`file://` では動かない。ビルドツールは tree-shaking や minify に加え、**`console` や `debugger` のような開発専用ステートメントを除去**する。

---

## 14. リソース読み込みと crossorigin — エラー情報の隠蔽

`<script>` などの `onload`/`onerror` はロードの成否だけを追う。**`onerror` は HTTP エラーの詳細（404 か 500 か）を教えない**。スクリプト実行中のエラーは範囲外で、それは `window.onerror` グローバルハンドラで追う。`<img>` は `src` を得たときにロード開始、`<iframe>` の `onload` は成功でもエラーでも発火する。

同一オリジンポリシーはエラー情報にも及ぶ。別ドメインのスクリプトでエラーが起きると、`window.onerror` は詳細を隠す。

```
// 同一サイト:
Uncaught ReferenceError: noSuchFunction is not defined
https://javascript.info/.../error.js, 1:1

// 別ドメイン:
Script error.
, 0:0
```

エラー監視サービスに詳細を届けたいなら、`<script>` に `crossorigin` 属性を付け、リモートがヘッダを返す必要がある。

| レベル | 条件 |
|---|---|
| `crossorigin` 属性なし | アクセス禁止 |
| `crossorigin="anonymous"` | サーバが `Access-Control-Allow-Origin` を返せば許可。**認証情報・Cookie は送らない** |
| `crossorigin="use-credentials"` | 上に加え `Access-Control-Allow-Credentials: true` が必要。**Cookie を送る** |

Cookie を気にしないなら `"anonymous"` を使う。

---

## 15. Catastrophic backtracking（ReDoS）

### 15.1 何が起きるか

一部の正規表現は単純に見えて、特定の入力で「ハング」し CPU を 100% 消費する。ReDoS（Regular expression Denial of Service、正規表現による DoS）とは、この暴走を悪用してサービスを止める攻撃のこと。ブラウザならスクリプトを kill するが、**サーバサイド JavaScript ではサーバプロセスをハングさせうる**ため、より深刻だ。

```js
let regexp = /^(\w+\s?)*$/;
let str = "An input string that takes a long time or even makes this regexp hang!";
alert( regexp.test(str) ); // will take a very long time
```

### 15.2 なぜ遅いか（組み合わせ爆発）

```js
let regexp = /^(\d+)*$/;
let str = "012345678901234567890123456789z";
alert( regexp.test(str) ); // will take a very long time (careful!)
```

貪欲な `\d+` が全桁を消費し、末尾 `$` が `z` に合わず不一致になると、量指定子が1文字ずつ戻して**全ての分割の組み合わせ**を試す。桁列を数値に分ける方法は `2^n - 1` 通りで、`n=9` で 511 通り、`n=20` で約100万通り、`n=30` でその1000倍になる。**lazy モード（`\w+?`）にしても総数は変わらず助けにならない**。エンジン差もあり、V8 8.8 以降（Chrome 88）はハングしないが Firefox はハングする、と原典は述べる。

### 15.3 修正の2アプローチ

**アプローチ1（組み合わせを減らす）**: スペースを必須にして曖昧さを消す。

```js
let regexp = /^(\w+\s)*\w*$/;
```

**アプローチ2（バックトラッキングを防ぐ）**: possessive quantifier（`\d++`）や atomic group が使えるが**JavaScript は未サポート**。lookahead で擬似的に再現する。

```js
alert( "JavaScript".match(/\w+Script/));        // JavaScript
alert( "JavaScript".match(/(?=(\w+))\1Script/)); // null
```

`(?=(\w+))\1` は、lookahead で最長の単語を先に丸ごと掴んで `\1` で取り込むため、後からバックトラックして分割し直す余地がなくなる。名前付きグループで書くと読みやすい。

```js
// parentheses are named ?<word>, referenced as \k<word>
let regexp = /^((?=(?<word>\w+))\k<word>\s?)*$/;
let str = "An input string that takes a long time or even makes this regex hang!";
alert( regexp.test(str) );          // false
alert( regexp.test("A correct string") ); // true
```

**攻撃者はどこを突くか**: ユーザ入力を検証する正規表現（メール・URL・パスワード強度チェックなど）に脆弱なパターンがあると、長い悪意ある文字列を送るだけでサーバを固められる。入力を正規表現に流すエンドポイントは ReDoS の検査対象になる。

---

## 16. source / sink 早見表 — ハンティングの地図

ここまでの内容を「どこからデータが入り（source）、どこへ流れると危険か（sink）」で整理する。すべて原典の記述にもとづく。

### 16.1 HTML として解釈される（危険な）書き込み先 — sink

| API | 原典の補足 |
|---|---|
| `elem.innerHTML = ...` | 挿入された `<script>` は HTML の一部になるが**実行されない**。不正 HTML はブラウザが修正する |
| `elem.outerHTML = ...` | 書き込みは要素自体を変えず、DOM から除去して新 HTML を挿入。書き込んだ変数は古い値を保持 |
| `elem.insertAdjacentHTML(where, html)` | `where` は `beforebegin` / `afterbegin` / `beforeend` / `afterend` |
| `document.write(html)` | ページロード中のみ機能。その後に呼ぶと既存内容が消去される |
| `new Function(functionBody)` | 文字列から関数生成。`[[Environment]]` はグローバル環境を参照 |
| `eval(code)` | 現在のレキシカル環境で実行し外側変数を読み書き。strict では eval 自身の環境 |
| `window.eval(code)` | グローバルスコープで実行 |

### 16.2 テキストとして扱われる（安全な）書き込み先

| API | 原典の記述 |
|---|---|
| `elem.textContent = ...` | テキストを安全な方法で書き込む |
| `node.append/prepend/before/after/replaceWith(...strings)` | `<`, `>` をエスケープしてテキストとして挿入 |
| `elem.insertAdjacentText(where, text)` | テキストとして挿入 |
| `document.createTextNode(text)` | テキストノードを生成 |
| `node.nodeValue` / `node.data` | 非要素ノードの内容 |

### 16.3 オリジン境界を越えるデータの入口 — source

| API / プロパティ | 原典の記述 |
|---|---|
| `message` イベントの `event.data` | **`event.origin` で送信元を検証すべき**。`window.onmessage` の短縮構文は動かない |
| location（BOM） | 別オリジンのウィンドウの `location` は**書き込みのみ可、読み取り不可** |
| `document.cookie` | `httpOnly` の Cookie は見えない |
| `localStorage` / `sessionStorage` | origin に束縛。`storage` イベントは同一オリジンの他ウィンドウで発火 |
| `window.name` | `window.open(url, name, params)` の `name` |
| `window.opener` | ポップアップ以外は `null`。接続は双方向 |
| `event.target.dataset.*` | behavior パターンで `this[action]()` に流れる |
| `getAttribute(name)` / `elem.attributes` | HTML に書かれたままの生文字列 |
| `response.text()` / `response.json()` | Fetch の body |
| `fetch` の `url` 引数 | サードパーティ由来 URL には `mode: "same-origin"` / `"no-cors"` が電源オフスイッチ |

この表の左（source）から右（sink）へ、検証やエスケープを経ずにデータが流れる箇所を探すのが、DOM ベース脆弱性ハンティングの基本動作である。

---

## 手を動かす

1. **オリジンの三つ組を確かめる**: DevTools のコンソールで `location.origin` を実行し、`protocol`・`host`・`port` の組を確認する。異なるサブドメインやポートのタブで同じことを試し、値が変わることを見る。
2. **CORS の preflight を観察する**: 自分で立てたテスト用サーバ（または許可された検証環境）に対し、DevTools のネットワークタブを開いた状態で次を実行する。`PATCH` や独自ヘッダを付けると、本番リクエストの直前に `OPTIONS` リクエストが飛ぶのを確認する。
   ```js
   fetch('https://<自分の検証サーバ>/service.json', {
     method: 'PATCH',
     headers: { 'Content-Type': 'application/json', 'API-Key': 'secret' }
   });
   ```
3. **safe リクエストとの差を見る**: 同じサーバへ `fetch(url)`（GET・追加ヘッダなし）を送り、preflight が飛ばないことを確認する。両者のリクエスト/レスポンスヘッダ（`Origin`、`Access-Control-Allow-Origin`）を見比べる。
4. **Cookie 属性を実験する**: 検証環境で `document.cookie = "a=1"` と `document.cookie = "b=2; samesite=strict"` を設定し、別オリジンの iframe から同サイトを開いたとき、送られる `Cookie` ヘッダがどう変わるかをネットワークタブで比べる。
5. **`httpOnly` を確認する**: サーバが `Set-Cookie: session=...; HttpOnly` を返すとき、コンソールで `document.cookie` にその Cookie が現れないことを確かめる。
6. **postMessage の検証を試す**: 検証用の親ページと iframe を用意し、受信側で `event.origin` を出力する。異なるオリジンから送ったメッセージが `event.origin` にどう表れるかを見て、検証コードの重要性を体感する。
7. **ReDoS を安全に体感する**: 短い入力（`n` を小さく）から始めて `/^(\d+)*$/` の実行時間を計り、入力を1文字ずつ伸ばして急激に遅くなることを確認する。修正版 `/^((?=(?<word>\w+))\k<word>\s?)*$/` が速いことも比べる（長い入力はブラウザを固めるので注意）。

---

## つまずきポイント

- **「404 はエラーになる」は誤り**。`fetch` の promise はネットワーク失敗でのみ reject する。404/500 では reject せず、`response.ok` で自分で確認する必要がある。XHR の `error` イベントも同じで HTTP エラーでは起きない。
- **CORS はサーバ側の許可**。`Access-Control-Allow-Origin` はサーバが返すもので、ブラウザ（クライアント）側で「CORS を有効にする」設定ではない。JavaScript から `Origin` や `Cookie` を偽装できないのは forbidden headers の制御による。
- **`Access-Control-Allow-Origin: *` と credential は両立しない**。Cookie 付きクロスオリジンでは `*` が禁止で、必ず正確なオリジンが必要。ここを混同すると診断を誤る。
- **`<meta http-equiv="X-Frame-Options">` は効かない**。`X-Frame-Options` は HTTP ヘッダとしてのみ有効。
- **`samesite` だけに頼らない**。2017年頃より古いブラウザは無視するため、XSRF トークンとの多層防御が必要。`samesite` は Cookie を使わない匿名機能には効かない。
- **`document.domain` は使わない**。仕様から除去途上の非推奨機能。`postMessage` を使う。
- **`localStorage` は `httpOnly` にできない**。XSS から読めるので、機密トークンの置き場所として Cookie（`httpOnly`）と混同しない。
- **`event.origin` の検証を忘れない**。`postMessage` 受信側で送信元を確認しないと、任意オリジンからのデータを信頼してしまう。
- **エンコードは `encodeURIComponent`**。検索パラメータの値には `encodeURI` ではなく `encodeURIComponent` を使う。`&` がエンコードされないとパラメータが分裂する。

---

## この節のまとめ

- オリジンはプロトコル・ドメイン・ポートの三つ組で、同一オリジンポリシーがブラウザセキュリティの土台である。
- 別オリジンのウィンドウには、`location` の**書き込み**とメッセージ送信しかできない。読み取りはできない。
- `event.isTrusted` は本物のユーザイベント（`true`）とスクリプト生成イベント（`false`）を区別する。
- `postMessage` は双方の合意でオリジンを越える。送信側は `targetOrigin`、受信側は `event.origin` を必ず検証する。
- `sandbox` 属性は制限を追加するだけで、緩和はできない。`allow-same-origin` を外せば強制的に別オリジン扱いになる。
- クリックジャッキングは透明 iframe を重ねてクリックを奪う攻撃。防御は `X-Frame-Options: SAMEORIGIN`、covering div、`samesite` Cookie。framebusting は弱い。
- Fetch は2段階で結果を返し、404/500 では reject しない。`Cookie` や `Origin` は forbidden header で偽装できない。
- CORS の safe リクエスト（GET/POST/HEAD＋限定ヘッダ）は `Access-Control-Allow-Origin` だけで通る。unsafe は `OPTIONS` preflight を伴う。
- credential 付きクロスオリジンは `Access-Control-Allow-Credentials: true` が要り、`*` は使えない。設定ミスは頻出のバグ。
- `referrerPolicy` は `Referer` の漏れ量を制御し、秘密 URL の漏洩を防ぐ。
- Cookie 属性 `secure`/`samesite`/`httpOnly`/`domain`/`path` が防御の核心。`httpOnly` は XSS 時の Cookie 窃取を防ぐ。
- XSRF は Cookie の自動送信を悪用する攻撃で、XSRF トークンと `samesite` で守る。
- Web Storage は origin に束縛され、サーバへ自動送信されないが、`httpOnly` にできず XSS から読める。
- モジュールは strict・独立スコープ・一度だけ評価で、別オリジンの外部モジュールは CORS ヘッダを要する。
- 別ドメインのスクリプトエラーは `Script error.` として詳細が隠される。詳細取得には `crossorigin` 属性とサーバヘッダが要る。
- ReDoS は組み合わせ爆発する正規表現による DoS。lazy では直らず、lookahead で atomic group を擬似再現するか組み合わせ自体を減らす。
- source（`event.data`・`document.cookie`・`location` など）から sink（`innerHTML`・`eval` など）への未検証な流れを探すのが DOM 脆弱性ハンティングの基本。

---

## 理解度チェック

1. 別オリジンの iframe に対して、JavaScript が唯一できる `location` の操作は何か。
   ▶ 答え: `location` への**書き込み**（＝別ページへのリダイレクト）のみ。読み取りはできない。
2. `fetch` が返す promise が reject するのはどんな場合か。404 のとき reject するか。
   ▶ 答え: ネットワーク的にリクエストできなかった場合のみ reject する。404 や 500 では reject せず、`response.ok`（200-299 で `true`）で自分で確認する。
3. CORS で「safe リクエスト」となる条件を2つ挙げよ。
   ▶ 答え: (1) メソッドが GET/POST/HEAD、(2) カスタムヘッダが `Accept`/`Accept-Language`/`Content-Language` と、値が限定された `Content-Type` のみ。これ以外は unsafe で preflight を伴う。
4. credential（Cookie）付きクロスオリジンリクエストで、サーバの `Access-Control-Allow-Origin` に `*` を使えるか。
   ▶ 答え: 使えない。必ず正確なオリジンを返す必要があり、加えて `Access-Control-Allow-Credentials: true` が要る。
5. クリックジャッキングを防ぐサーバ側ヘッダは何か。`<meta>` タグで設定できるか。
   ▶ 答え: `X-Frame-Options`（`DENY`/`SAMEORIGIN`/`ALLOW-FROM`）。HTTP ヘッダとしてのみ有効で、`<meta http-equiv>` では無視される。
6. `httpOnly` Cookie は何を防ぐか。
   ▶ 答え: JavaScript（`document.cookie`）からの読み書きを禁じ、XSS が起きても認証 Cookie を盗まれないようにする。
7. `postMessage` の受信側で必ず確認すべきプロパティは何か。
   ▶ 答え: `event.origin`。送信元オリジンを検証しないと任意オリジンからのデータを信頼してしまう。
8. `samesite=lax` の Cookie が送られる2条件は何か。
   ▶ 答え: (1) HTTP メソッドが safe（GET など、POST でない）、(2) トップレベルナビゲーション（アドレスバーの URL が変わる）である場合。iframe 内や JavaScript のネットワークリクエストでは送られない。
9. `/^(\d+)*$/` のような正規表現が特定入力でハングするのはなぜか。lazy 化すれば直るか。
   ▶ 答え: バックトラッキングで桁列の全分割（`2^n-1` 通り）を試すため。lazy（`+?`）にしても総数は変わらず直らない。組み合わせを減らすか lookahead で atomic group を擬似再現する。
10. 別ドメインのスクリプトで起きたエラーの詳細を `window.onerror` で得るには何が必要か。
    ▶ 答え: `<script>` に `crossorigin`（`anonymous` か `use-credentials`）を付け、リモートサーバが `Access-Control-Allow-Origin` ヘッダを返すこと。

---

## 出典

- https://javascript.info/dispatch-events
- https://javascript.info/default-browser-action
- https://javascript.info/shadow-dom-events
- https://javascript.info/cross-window-communication
- https://javascript.info/popup-windows
- https://javascript.info/clickjacking
- https://javascript.info/fetch
- https://javascript.info/fetch-crossorigin
- https://javascript.info/fetch-api
- https://javascript.info/url
- https://javascript.info/xmlhttprequest
- https://javascript.info/cookie
- https://javascript.info/localstorage
- https://javascript.info/modules-intro
- https://javascript.info/onload-onerror
- https://javascript.info/regexp-catastrophic-backtracking
- https://github.com/javascript-tutorial/en.javascript.info

<!-- sources: https://javascript.info/dispatch-events, https://javascript.info/default-browser-action, https://javascript.info/shadow-dom-events, https://javascript.info/cross-window-communication, https://javascript.info/popup-windows, https://javascript.info/clickjacking, https://javascript.info/fetch, https://javascript.info/fetch-crossorigin, https://javascript.info/fetch-api, https://javascript.info/url, https://javascript.info/xmlhttprequest, https://javascript.info/cookie, https://javascript.info/localstorage, https://javascript.info/modules-intro, https://javascript.info/onload-onerror, https://javascript.info/regexp-catastrophic-backtracking, https://github.com/javascript-tutorial/en.javascript.info -->
<!-- terms: 同一オリジンポリシー（Same-Origin Policy, SOP）, オリジン（origin）, postMessage, targetOrigin, event.origin, event.isTrusted, sandbox属性, allow-same-origin, クリックジャッキング（clickjacking）, X-Frame-Options, framebusting, CORS（Cross-Origin Resource Sharing）, safeリクエスト, preflightリクエスト, Access-Control-Allow-Origin, Access-Control-Allow-Credentials, Access-Control-Expose-Headers, Access-Control-Max-Age, credentials, referrerPolicy, Subresource Integrity, keepalive, encodeURIComponent, XMLHttpRequest, withCredentials, Cookie, Set-Cookie, secure属性, samesite属性, httpOnly属性, XSRF（Cross-Site Request Forgery）, XSRF保護トークン, サードパーティCookie, localStorage, sessionStorage, storageイベント, モジュール（ESモジュール）, crossorigin属性, ReDoS（Catastrophic backtracking）, possessive quantifier, atomic group, source/sink -->
<!-- self-read: https://javascript.info/ | 組織のegressポリシーでjavascript.info:443へのCONNECTが403で拒否されサイト本体を自動取得できず、公式GitHubリポジトリのMarkdownを一次ソースとした。サイト上のライブデモ・図版・課題は未取得 -->
