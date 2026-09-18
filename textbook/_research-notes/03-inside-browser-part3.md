# [03] Inside look at modern web browser (part 3) — レンダラプロセスの内部（パース → スタイル → レイアウト → ペイント → コンポジット）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://developer.chrome.com/blog/inside-browser-part3 | full | WebFetch / curl は **egress proxy により 403（CONNECT tunnel failed）でブロック** → フォールバックとして原典サイトのソースリポジトリ `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part3/index.md`（HTTP 200 / 19,600 bytes）を取得し、本文全文（Front matter含む）を読了 | developer.chrome.com は当環境のプロキシで直接アクセス不可。web.archive.org も WebFetch 不可・curl 403。ただし取得した Markdown は当該ページの**原本（サイトのビルド元ソース）**であり、本文テキストは 100% 取得できている。取得できていないのは図版18点（PNG）と動画4点（MP4）の**画像そのもの**のみ（キャプション文言は全て取得済み） |

- 記事メタ情報（原文 front matter より逐語）:
  - `title: Inside look at modern web browser (part 3)`
  - `description: Inner workings of a browser rendering engine`
  - `authors: - kosamari`（Mariko Kosaka）
  - `date: 2018-09-20` / `updated: 2020-08-18`
  - `layout: 'layouts/blog-post.njk'`
- シリーズ構成: 全4部。part1 = マルチプロセスアーキテクチャ、part2 = ナビゲーションフロー、**part3（本稿）= レンダラプロセス内部**、part4 = 入力（mouse move / click）とコンポジタ。

## 要約（3〜10行）

- レンダラプロセスは「タブの中で起きることすべて」を担当し、**メインスレッド**（大半のコード）、**ワーカスレッド**（Web Worker / Service Worker）、**コンポジタスレッド**、**ラスタスレッド**を内部に持つ。その中核業務は HTML / CSS / JavaScript をユーザが操作可能な Web ページに変換すること。
- ナビゲーションの **commit メッセージ**を受けて HTML データが届き始めると、メインスレッドが HTML テキストをパースして **DOM** を構築する。HTML 仕様はエラーを寛容に扱う設計なので、壊れたマークアップでもエラーにならず「正規化」される。
- サブリソースは、HTML パーサが生成するトークンを覗き見る **preload scanner** が並行動作して、ブラウザプロセスのネットワークスレッドへ先行リクエストを投げる。
- `<script>` を見つけるとパースは**停止**する。`document.write()` などで DOM 構造が丸ごと変わり得るため。回避策として `async` / `defer` / JavaScript module / `<link rel="preload">` がある。
- 以降パイプラインは **スタイル計算（computed style）→ レイアウト（layout tree、幾何情報）→ ペイント（paint record、描画順）** と進む。各段は前段の結果を入力にするため、前段が変わると後段の再生成が必要で高コスト。
- 画面のピクセル化は **ラスタライズ**。現代の Chrome は素朴なビューポートラスタではなく **コンポジット（compositing）**を行う。メインスレッドが layout tree から **layer tree** を作り（DevTools の "Update Layer Tree"）、コンポジタスレッドへ **commit**。コンポジタスレッドはレイヤを **タイル**に分割してラスタスレッドに配り、結果を GPU メモリへ格納。**draw quads** を集めて **compositor frame** を作り、IPC でブラウザプロセス → GPU へ。
- コンポジットはメインスレッドを介さないので、**コンポジットのみで済むアニメーション**が最も滑らか。レイアウト/ペイントの再計算が必要になるとメインスレッドが巻き込まれる。

## 詳細ノート

### 1. レンダラプロセスが Web コンテンツを扱う （出典: https://developer.chrome.com/blog/inside-browser-part3）

- レンダラプロセスは**タブ内部で起きるすべて**に責任を持つ。
- **メインスレッド**が、開発者がユーザに送るコードのほとんどを処理する。
- Web Worker / Service Worker を使っている場合、JavaScript の一部は**ワーカスレッド**で処理される。
- ページを効率よく滑らかにレンダリングするため、**コンポジタスレッド（compositor thread）**と**ラスタスレッド（raster thread）**もレンダラプロセス内で走る。
- レンダラプロセスの中核的な仕事 = HTML・CSS・JavaScript を、ユーザが操作できる Web ページに変えること。
- 図1のキャプション（逐語・英語）: "Figure 1: Renderer process with a main thread, worker threads, a compositor thread, and a raster thread inside"（＝メインスレッド／複数ワーカスレッド／コンポジタスレッド／ラスタスレッドを内部に持つレンダラプロセス）。
- レンダラプロセスは**Web パフォーマンスの多くの側面に触れる**。記事自体は概観であり、より深く知るには Web Fundamentals の Performance セクションを参照するよう案内している。

〔補足（一般知識）〕クライアントサイド脆弱性ハンティングの観点では、この「1タブ = 1レンダラプロセス（サイト単位の分離）」という前提が Site Isolation の土台になっており、DOM・JavaScript 実行・パースがすべて同一メインスレッド上の同一オリジン文脈で行われることが、DOM-based XSS や prototype pollution の影響範囲（＝そのレンダラ内の当該オリジンの全データ）を決める。

### 2. パース：DOM の構築（Construction of a DOM） （出典: https://developer.chrome.com/blog/inside-browser-part3）

- レンダラプロセスがナビゲーションの **commit メッセージ**を受け取り、HTML データを受信し始めると、メインスレッドがテキスト文字列（HTML）のパースを開始し、それを **D**ocument **O**bject **M**odel（**DOM**）に変換する。
- DOM とは:
  1. ブラウザ内部でのページ表現（internal representation of the page）
  2. Web 開発者が JavaScript を通じて操作できるデータ構造かつ API
- HTML ドキュメントを DOM にパースする方法は **HTML Standard（https://html.spec.whatwg.org/）** で定義されている。
- **重要な性質: ブラウザに HTML を食わせてもエラーは投げられない。**
  - 例1: 閉じ `</p>` タグが欠けていても**妥当な HTML**である。
  - 例2: 誤ったマークアップ `Hi! <b>I'm <i>Chrome</b>!</i>`（b タグが i タグより先に閉じられている）は、あたかも `Hi! <b>I'm <i>Chrome</i></b><i>!</i>` と書いたかのように扱われる。
  - これは HTML 仕様がこうしたエラーを**優雅に（gracefully）扱うよう設計されている**ため。
- 仕組みの詳細は HTML 仕様の "An introduction to error handling and strange cases in the parser" 節（https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser）を読むよう案内。
- 図2キャプション（逐語）: "Figure 2: The main thread parsing HTML and building a DOM tree"

〔補足（一般知識）〕この「エラーを投げずに勝手に正規化する」性質は、脆弱性ハンティングにおける**パーサ差異（parser differential）**の源泉。サーバ側サニタイザ／WAF の HTML パーサとブラウザの HTML パーサでタグの閉じ方・入れ子の解釈が食い違うと、サニタイザを通過したマークアップがブラウザ側で別の木構造になり mXSS（mutation XSS）が成立する。`innerHTML` へ再代入したときの再シリアライズ／再パースで木が変形する現象も同根。したがって「HTML はエラーにならない」は仕様上の親切さであると同時に攻撃面でもある。

#### コード/コマンド（原文のまま逐語）

```
Hi! <b>I'm <i>Chrome</b>!</i>
```

```
Hi! <b>I'm <i>Chrome</i></b><i>!</i>
```

```
</p>
```

### 3. サブリソースの読み込みと preload scanner （出典: https://developer.chrome.com/blog/inside-browser-part3）

- Web サイトは通常、画像・CSS・JavaScript といった外部リソースを使う。これらはネットワークまたはキャッシュから読み込む必要がある。
- メインスレッドは、DOM を組み立てるためにパースしていく過程でリソースを見つけた順に**1つずつリクエストすることも可能**（"could"）だが、高速化のために **"preload scanner"** が**並行して（concurrently）**走る。
- HTML ドキュメント内に `<img>` や `<link>` のようなものがあると、**preload scanner は HTML パーサが生成したトークンを覗き見て（peeks at tokens）、ブラウザプロセス内のネットワークスレッドへリクエストを送る**。
  - ここで重要なのは、リクエスト発行主体が「レンダラのメインスレッド」ではなく、**ブラウザプロセスのネットワークスレッド**である点（part1/part2 のアーキテクチャと接続する）。

〔補足（一般知識）〕preload scanner はパーサがブロックされている間もトークン列を先読みしてリソース取得を始める。このため「`<script>` でパースが止まっている間も画像や CSS の取得は進む」。診断上は、preload scanner が投げる先行リクエストが CSP・Referrer-Policy・SRI の評価対象になること、また「まだ DOM に入っていない要素の属性からリクエストが飛ぶ」ことが、インジェクション痕跡の観測（例: 属性インジェクションによる外部通信の発生タイミング）に影響する点を押さえるとよい。

### 4. JavaScript がパースをブロックする理由（JavaScript can block the parsing） （出典: https://developer.chrome.com/blog/inside-browser-part3）

- HTML パーサが `<script>` タグを見つけると、**HTML ドキュメントのパースを一時停止**し、その JavaScript コードを**ロードし、パースし、実行しなければならない**。
- なぜか: **JavaScript は `document.write()` のようなものでドキュメントの形を変えられ、DOM 構造全体を変えてしまえる**から。
  - HTML 仕様の "overview of the parsing model"（https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model）に良い図がある、と案内。
- したがって HTML パーサは、HTML ドキュメントのパースを再開する前に **JavaScript の実行を待たなければならない**。
- JavaScript 実行時に何が起きるかに興味があれば、V8 チームのトーク・ブログ記事（例として https://mathiasbynens.be/notes/shapes-ics ＝ Shapes と Inline Caches の解説）を参照するよう案内。

#### コード/コマンド（原文のまま逐語）

```
<script>
```

```
document.write()
```

### 5. リソースの読み込み方をブラウザにヒントとして伝える（Hint to browser how you want to load resources） （出典: https://developer.chrome.com/blog/inside-browser-part3）

Web 開発者がリソースをうまく読み込ませるためにブラウザへヒントを送る方法は多数ある。

| ヒント | 原文の記述内容 |
|---|---|
| `async` 属性（`<script async>`） | JavaScript が `document.write()` を使わないなら `<script>` タグに付けられる。ブラウザは JavaScript を**非同期にロード・実行**し、**パースをブロックしない**。参照: MDN `https://developer.mozilla.org/docs/Web/HTML/Element/script#attr-async` |
| `defer` 属性（`<script defer>`） | 同上。`async` と並んで挙げられている。参照: MDN `https://developer.mozilla.org/docs/Web/HTML/Element/script#attr-defer` |
| JavaScript module | 適する場合は JavaScript モジュールを使ってもよい（参照: Web Fundamentals の modules primer） |
| `<link rel="preload">` | そのリソースが**現在のナビゲーションで確実に必要**であり、**できるだけ早くダウンロードしたい**ことをブラウザに知らせる方法 |

- さらに詳しくは "Resource Prioritization – Getting the Browser to Help You"（https://developers.google.com/web/fundamentals/performance/resource-prioritization）を参照。
- 原文が明記している前提条件（重要）: **`async` / `defer` を付けてよいのは「JavaScript が `document.write()` を使わない」場合**。

#### コード/コマンド（原文のまま逐語）

```
async
```

```
defer
```

```
<link rel="preload">
```

〔補足（一般知識）〕原文は `async` と `defer` を「どちらもパースをブロックしない」とまとめており、両者の実行タイミングの違い（`defer` は DOM 構築完了後・記述順、`async` はダウンロード完了次第・順序不定）までは踏み込んでいない。教科書ではこの差異を明示するとよい。セキュリティ的には、`async`/`defer` により**実行順序が保証されない／後になる**ことが、グローバル変数の初期化順に依存した防御コード（例: サニタイザやポリシー設定の適用前に攻撃者制御のスクリプトが走る）を破ることがある。また `<link rel="preload">` は「必ず取得される」ため、属性インジェクションで `rel=preload` を注入できると強制的な外部通信（情報の持ち出し／スキャン）に使われ得る。

### 6. スタイル計算（Style calculation） （出典: https://developer.chrome.com/blog/inside-browser-part3）

- DOM があるだけではページの見た目は分からない。CSS でページ要素をスタイルできるため。
- **メインスレッドが CSS をパースし、各 DOM ノードの computed style（計算済みスタイル）を決定する**。
- computed style とは「**CSS セレクタに基づいて各要素にどんなスタイルが適用されているか**」という情報。
- この情報は **DevTools の `computed` セクション**で確認できる。
- 図3キャプション（逐語）: "Figure 3: The main thread parsing CSS to add computed style"
- **CSS を一切提供しなくても、各 DOM ノードは computed style を持つ。**
  - `<h1>` タグは `<h2>` タグより大きく表示され、各要素にマージンが定義されている。これは**ブラウザがデフォルトのスタイルシートを持っている**から。
  - Chrome のデフォルト CSS のソースは以下で見られる（原文リンク逐語）:
    `https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/resources/html.css`

#### コード/コマンド（原文のまま逐語）

```
computed
```

```
<h1>
```

```
<h2>
```

```
https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/resources/html.css
```

### 7. レイアウト（Layout） （出典: https://developer.chrome.com/blog/inside-browser-part3）

- ここまででレンダラプロセスは「ドキュメントの構造」と「各ノードのスタイル」を知っているが、**ページを描くにはまだ足りない**。
- 原文の比喩: 電話で友人に絵を説明する場面。「大きな赤い円と小さな青い四角がある（"There is a big red circle and a small blue square"）」では、友人はその絵が正確にどう見えるか分からない。
  - 図4キャプション（逐語）: "Figure 4: A person standing in front of a painting, phone line connected to the other person"（原文では "game of human fax machine" という alt が付く）
- **レイアウトは要素の幾何（geometry）を求めるプロセス。**
- メインスレッドが **DOM と computed style を歩き（walks through）**、**layout tree（レイアウトツリー）**を作る。layout tree は **x y 座標**や**バウンディングボックスのサイズ**といった情報を持つ。
- layout tree は DOM ツリーと似た構造になり得るが、**ページ上で可視のものに関係する情報だけを含む**。
  - `display: none` が適用された要素は **layout tree の一部ではない**。
  - 一方 `visibility: hidden` の要素は **layout tree に含まれる**。
  - 同様に、`p::before{content:"Hi!"}` のような content を持つ疑似クラス（原文表記は "pseudo class"）が適用されると、それは **DOM には無いが layout tree には含まれる**。
- 図5キャプション（逐語）: "Figure 5: The main thread going over DOM tree with computed styles and producing layout tree"
- 図6キャプション（逐語・動画）: "Figure 6: Box layout for a paragraph moving due to line break change"
- **レイアウトの決定は難しいタスク**である。
  - 上から下へのブロックフローという最も単純なページレイアウトでさえ、**フォントがどれだけ大きいか**と**どこで改行するか**を考慮しなければならない。これらが段落のサイズと形に影響し、それが**次の段落をどこに置くか**に影響する。
  - CSS は要素を片側に float させ、オーバーフロー項目をマスクし、**書字方向（writing directions）**を変えられる。レイアウト段階は非常に重い仕事を担う。
  - Chrome では**エンジニアのチーム全体がレイアウトに取り組んでいる**。詳細は BlinkOn Conference のいくつかの講演（録画: https://www.youtube.com/watch?v=Y5Xa4H2wtVA）が興味深い。

#### コード/コマンド（原文のまま逐語）

```
display: none
```

```
visibility: hidden
```

```
p::before{content:"Hi!"}
```

〔補足（一般知識）〕`display:none` は layout tree に入らず `visibility:hidden` は入る、という差は、スクレイピング／自動診断で「見えているか」を判定するときの落とし穴であり、クリックジャッキングやオーバーレイ系 UI 欺瞞の検証でも意味を持つ。また `::before`/`::after` の `content` が DOM に存在しないのに描画されることは、CSS インジェクションによる情報漏えい（属性セレクタ + `content` や背景画像リクエストで値を1文字ずつ抜く手法）の前提知識になる。

### 8. ペイント（Paint） （出典: https://developer.chrome.com/blog/inside-browser-part3）

- DOM・スタイル・レイアウトがあっても**まだページを描くには足りない**。
- 原文の比喩: 絵を再現しようとするとき、要素のサイズ・形・位置を知っていても、**どの順番で塗るか**を判断しなければならない。
  - 図7キャプション（逐語）: "Figure 7: A person in front of a canvas holding paintbrush, wondering if they should draw a circle first or square first"
- 例: 特定の要素に `z-index` が設定されているかもしれない。その場合、**HTML に書かれた要素の順で塗ると、間違ったレンダリング結果になる**。
  - 図8キャプション（逐語）: "Figure 8: Page elements appearing in order of an HTML markup, resulting in wrong rendered image because z-index was not taken into account"
- **このペイント段階で、メインスレッドは layout tree を歩いて paint records（ペイントレコード）を作る。**
  - **paint record は「まず背景、次にテキスト、次に矩形」といった描画プロセスのメモ（a note of painting process like "background first, then text, then rectangle"）。**
  - JavaScript で `<canvas>` 要素に描画したことがあれば、このプロセスは馴染みがあるはず。
- 図9キャプション（逐語）: "Figure 9: The main thread walking through layout tree and producing paint records"

#### コード/コマンド（原文のまま逐語）

```
z-index
```

```
<canvas>
```

### 9. レンダリングパイプラインの更新はコストが高い（Updating rendering pipeline is costly） （出典: https://developer.chrome.com/blog/inside-browser-part3）

- **レンダリングパイプラインで最も重要な理解: 各ステップは前の操作の結果を使って新しいデータを作る。**
  - 例: layout tree で何かが変わると、ドキュメントの**影響を受けた部分について paint order（ペイント順）を再生成する必要がある**。
  - 図10キャプション（逐語・動画）: "Figure 10: DOM+Style, Layout, and Paint trees in order it is generated"
- 要素をアニメーションさせている場合、ブラウザは**フレームごとにこれらの操作を走らせなければならない**。
- **ほとんどのディスプレイは毎秒60回画面をリフレッシュする（60 fps）。** 毎フレームで物を画面上を動かせば人の目に滑らかに見える。しかし**途中のフレームを落とす（misses the frames in between）と、ページは "janky"（ガタつく）ように見える**。
  - 図11キャプション（逐語）: "Figure 11: Animation frames on a timeline"
- レンダリング操作が画面リフレッシュに追いついていても、**これらの計算はメインスレッド上で走っている**ため、アプリケーションが JavaScript を実行しているときに**ブロックされ得る**。
  - 図12キャプション（逐語）: "Figure 12: Animation frames on a timeline, but one frame is blocked by JavaScript"
- 対策:
  1. **JavaScript の処理を小さなチャンクに分割し、`requestAnimationFrame()` を使って毎フレーム実行するようスケジュールする。** 詳細は "Optimize JavaScript Execution"（https://developers.google.com/web/fundamentals/performance/rendering/optimize-javascript-execution）。
  2. **JavaScript を Web Worker で実行してメインスレッドのブロックを避ける**（参照動画: https://www.youtube.com/watch?v=X57mh8tKkgE）。
  - 図13キャプション（逐語）: "Figure 13: Smaller chunks of JavaScript running on a timeline with animation frame"

#### コード/コマンド（原文のまま逐語）

```
requestAnimationFrame()
```

〔補足（一般知識）〕「メインスレッドが JavaScript で詰まるとフレームが落ちる」という性質は、クライアントサイドの DoS（正規表現の破滅的バックトラッキング＝ReDoS、巨大 JSON のパース、深い DOM 生成など）が**UI フリーズとして観測される**理由そのもの。また `requestAnimationFrame` はタイミング副チャネル（レンダリング時間差による情報推測、いわゆる pixel stealing / XS-Leaks の一部）の計測手段としても知られる。

### 10. コンポジット（Compositing） （出典: https://developer.chrome.com/blog/inside-browser-part3）

#### 10-1. ページをどう描くか（How would you draw a page?） / ラスタライズ

- ブラウザは今、ドキュメントの構造・各要素のスタイル・ページの幾何・ペイント順を知っている。では**どうやってページを描くのか**。
- **この情報を画面上のピクセルに変えることを「ラスタライズ（rasterizing）」と呼ぶ。**
- 素朴（naive）な方法: **ビューポート内部の部分だけをラスタする**。ユーザがスクロールしたら、ラスタ済みフレームを移動し、欠けた部分をさらにラスタして埋める。
  - **これは Chrome が最初にリリースされたときのラスタライズの扱い方だった。**
  - しかし**現代のブラウザは、より洗練された「コンポジット（compositing）」というプロセスを走らせる。**
  - 図14キャプション（逐語・動画）: "Figure 14: Animation of naive rastering process"

#### 10-2. コンポジットとは（What is compositing）

- **コンポジットとは、ページの一部分を「レイヤ（layers）」に分離し、それぞれを個別にラスタライズし、「コンポジタスレッド（compositor thread）」と呼ばれる別スレッドでページとして合成する技法。**
- **スクロールが起きたとき、レイヤは既にラスタ済みなので、あとは新しいフレームを合成するだけでよい。**
- **アニメーションも同じ方法で実現できる（レイヤを動かして新しいフレームを合成する）。**
- 自分のサイトがどうレイヤに分割されているかは **DevTools の Layers パネル**で確認できる（原文リンク: LogRocket 記事 https://blog.logrocket.com/eliminate-content-repaints-with-the-new-layers-panel-in-chrome-e2c306d4d752?gi=cd6271834cea ）。
- 図15キャプション（逐語・動画）: "Figure 15: Animation of compositing process"

#### 10-3. レイヤへの分割（Dividing into layers）

- **どの要素がどのレイヤに入るべきかを調べるため、メインスレッドが layout tree を歩いて layer tree（レイヤツリー）を作る。**
  - **この処理は DevTools の performance パネルで "Update Layer Tree" と呼ばれる部分。**
- ページのある部分（例: **スライドインするサイドメニュー**）が別レイヤになるべきなのに、なっていない場合は、**CSS の `will-change` 属性でブラウザにヒントを与えられる**（原文表記は "`will-change` attribute in CSS"）。
- 図16キャプション（逐語）: "Figure 16: The main thread walking through layout tree producing layer tree"
- **注意（過剰なレイヤ化の害）**: すべての要素にレイヤを与えたくなるかもしれないが、**過剰な数のレイヤをまたいでコンポジットすると、毎フレームでページの小さい部分をラスタするより遅くなり得る**。したがって**アプリケーションのレンダリング性能を測ることが極めて重要**。
  - 詳細は "Stick to Compositor-Only Properties and Manage Layer Count"（https://developers.google.com/web/fundamentals/performance/rendering/stick-to-compositor-only-properties-and-manage-layer-count）。

##### コード/コマンド（原文のまま逐語）

```
will-change
```

```
Update Layer Tree
```

#### 10-4. メインスレッドの外でのラスタとコンポジット（Raster and composite off of the main thread）

処理の流れ（原文の順序どおり）:

1. **layer tree が作られ、paint order が決まると、メインスレッドはその情報をコンポジタスレッドへ commit する。**
2. **コンポジタスレッドが各レイヤをラスタライズする。**
3. **レイヤはページ全長のように大きくなり得るため、コンポジタスレッドはレイヤを「タイル（tiles）」に分割し、各タイルをラスタスレッド（raster threads）へ送る。**
4. **ラスタスレッドが各タイルをラスタライズし、それを GPU メモリ（GPU memory）に格納する。**
   - 図17キャプション（逐語）: "Figure 17: Raster threads creating the bitmap of tiles and sending to GPU"
5. **コンポジタスレッドは異なるラスタスレッドに優先度を付けられる**ので、**ビューポート内（または近傍）のものを先にラスタできる**。
6. **1つのレイヤは、ズームイン動作などに対応するため、異なる解像度向けの複数のタイリング（multiple tilings for different resolutions）を持つ。**
7. **タイルがラスタされると、コンポジタスレッドは「draw quads」と呼ばれるタイル情報を集めて「compositor frame」を作る。**

##### 用語表（原文の表をそのまま再現・日本語訳併記）

| 用語 | 原文の定義（逐語・英語） | 日本語 |
|---|---|---|
| Draw quads | "Contains information such as the tile's location in memory and where in the page to draw the tile taking in consideration of the page compositing." | タイルの**メモリ上の位置**、および**ページのコンポジットを考慮したうえでページ内のどこにそのタイルを描くか**といった情報を含む |
| Compositor frame | "A collection of draw quads that represents a frame of a page." | ページの1フレームを表す **draw quads の集合** |

8. **compositor frame は IPC 経由でブラウザプロセスに提出（submitted）される。**
9. **この時点で、ブラウザ UI の変更のために UI スレッドから、あるいは拡張機能のために他のレンダラプロセスから、別の compositor frame が追加され得る。**
10. **これらの compositor frame は GPU に送られ、画面に表示される。**
11. **スクロールイベントが入ってくると、コンポジタスレッドは GPU に送るための別の compositor frame を作る。**
    - 図18キャプション（逐語）: "Figure 18: Compositor thread creating compositing frame. Frame is sent to the browser process then to GPU"

- **コンポジットの利点は、メインスレッドを関与させずに行われること。**
  - **コンポジタスレッドはスタイル計算や JavaScript 実行を待つ必要がない。**
  - **だからこそ「コンポジットのみのアニメーション（compositing only animations）」が滑らかな性能のために最良と考えられている**（参照: https://www.html5rocks.com/en/tutorials/speed/high-performance-animations/ ）。
  - **もしレイアウトやペイントを再計算する必要があれば、メインスレッドが関与しなければならない。**

〔補足（一般知識）〕原文が挙げる「コンポジタスレッドは JavaScript を待たない」という性質は、XS-Leaks / タイミング攻撃の文脈で重要。メインスレッドが忙しくてもスクロールやコンポジットが進むため、被害サイトの JS を止めても描画タイミングの差が観測でき得る。逆に、レイアウト/ペイントを強制する API（`getBoundingClientRect()` や `offsetWidth` の読み取りによる強制同期レイアウト）は測定可能な時間差を生み、クロスオリジンの状態推測（要素サイズの差から「ログイン済みか」等を推測する手法）の足場になる。教科書ではこの「どの段が誰のスレッドで動くか」の地図が、XS-Leaks 章の前提として効く。

### 11. まとめと次回（Wrap Up） （出典: https://developer.chrome.com/blog/inside-browser-part3）

- 本稿では**パースからコンポジットまでのレンダリングパイプライン**を見た。これで Web サイトのパフォーマンス最適化についてさらに読み進められるはず、としている。
- **次回（シリーズ最終回 part4）では、コンポジタスレッドをより詳しく見て、`mouse move` や `click` のようなユーザ入力が来たときに何が起きるかを見る。**
  - 次回リンク（逐語）: `https://developers.google.com/web/updates/2018/09/inside-browser-part4`
  - ボタンラベル（逐語）: "Next: Input is coming to the compositor"
- 著者連絡先（逐語）: Twitter `@kosamari`（https://twitter.com/kosamari）

## パイプライン一覧表（本記事の内容を整理）

| 段 | 実行スレッド | 入力 | 出力 | 補足 |
|---|---|---|---|---|
| HTML パース / DOM 構築 | メインスレッド | HTML バイト列（navigation commit 後に受信開始） | DOM | エラーを投げず寛容に正規化。`<script>` で停止 |
| サブリソース先読み | preload scanner（メインスレッドのパースと並行） | HTML パーサのトークン | ネットワークスレッド（ブラウザプロセス）へのリクエスト | `<img>`, `<link>` を先取り |
| JavaScript 実行 | メインスレッド | スクリプト | DOM の変更 | パースをブロック（`document.write()` があり得るため）。`async`/`defer` で回避可 |
| スタイル計算 | メインスレッド | DOM + CSS（著者 CSS + ブラウザ既定スタイルシート） | 各 DOM ノードの computed style | DevTools の `computed` で確認 |
| レイアウト | メインスレッド | DOM + computed style | layout tree（x y 座標、バウンディングボックス） | `display:none` は含まれない / `visibility:hidden` は含まれる / `::before` content は含まれる |
| ペイント | メインスレッド | layout tree | paint records（描画順のメモ） | `z-index` を考慮した順序決定 |
| レイヤ化 | メインスレッド | layout tree | layer tree | DevTools performance の "Update Layer Tree"。`will-change` でヒント |
| commit | メインスレッド → コンポジタスレッド | layer tree + paint order | — | ここでメインスレッドの責務が終わる |
| ラスタライズ | コンポジタスレッド（分割） + ラスタスレッド（実行） | レイヤ → タイル | ビットマップ（GPU メモリ格納） | ビューポート近傍を優先。複数解像度のタイリングを保持 |
| コンポジット | コンポジタスレッド | タイル情報 = draw quads | compositor frame | IPC でブラウザプロセスへ → GPU で表示。UI スレッドや他レンダラのフレームも合流 |

## 原文に登場する外部リンク（逐語）

| リンク先 URL | 文脈 |
|---|---|
| https://developers.google.com/web/updates/2018/09/inside-browser-part1 | シリーズ part1（マルチプロセスアーキテクチャ） |
| https://developers.google.com/web/updates/2018/09/inside-browser-part2 | シリーズ part2（ナビゲーションフロー） |
| https://developers.google.com/web/updates/2018/09/inside-browser-part4 | シリーズ part4（入力とコンポジタ） |
| https://developers.google.com/web/fundamentals/performance/why-performance-matters/ | Web Fundamentals の Performance セクション |
| https://html.spec.whatwg.org/ | HTML Standard |
| https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser | パーサのエラー処理と奇妙なケース |
| https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model | パーシングモデルの概観（図あり） |
| https://mathiasbynens.be/notes/shapes-ics | V8 の Shapes と Inline Caches |
| https://developer.mozilla.org/docs/Web/HTML/Element/script#attr-async | `async` 属性 |
| https://developer.mozilla.org/docs/Web/HTML/Element/script#attr-defer | `defer` 属性 |
| https://developers.google.com/web/fundamentals/primers/modules | JavaScript module |
| https://developers.google.com/web/fundamentals/performance/resource-prioritization | Resource Prioritization – Getting the Browser to Help You |
| https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/resources/html.css | Chrome のデフォルト CSS ソース |
| https://www.youtube.com/watch?v=Y5Xa4H2wtVA | BlinkOn Conference のレイアウト関連講演 |
| https://developers.google.com/web/fundamentals/performance/rendering/optimize-javascript-execution | Optimize JavaScript Execution |
| https://www.youtube.com/watch?v=X57mh8tKkgE | JavaScript in Web Workers |
| https://blog.logrocket.com/eliminate-content-repaints-with-the-new-layers-panel-in-chrome-e2c306d4d752?gi=cd6271834cea | DevTools Layers パネル |
| https://developers.google.com/web/fundamentals/performance/rendering/stick-to-compositor-only-properties-and-manage-layer-count | Stick to Compositor-Only Properties and Manage Layer Count |
| https://www.html5rocks.com/en/tutorials/speed/high-performance-animations/ | コンポジットのみのアニメーション |
| https://twitter.com/kosamari | 著者 |

〔補足（一般知識）〕`developers.google.com/web/updates/...` および `www.html5rocks.com` 系の URL は現在 `web.dev` / `developer.chrome.com` へリダイレクトされることが多い。教科書に転記する際は原文の URL をそのまま示しつつ、リンク切れの可能性に触れるとよい。

## 読者が自分で開くべき資料

本ノートの本文は原典のソース Markdown から**全文取得済み**だが、**当環境からは `developer.chrome.com` にアクセスできなかった（egress proxy が 403 を返す）**ため、以下は取得できていない。読者が自分で開くべき理由と読みどころを挙げる。

### A. https://developer.chrome.com/blog/inside-browser-part3（レンダリング済みページ）
- **取得できなかった理由**: WebFetch が `EGRESS_BLOCKED`、curl が `CONNECT tunnel failed, response 403`。web.archive.org も同様に到達不可。本文は GitHub 上の原本 Markdown（`GoogleChrome/developer.chrome.com` の `site/en/blog/inside-browser-part3/index.md`）から取得した。
- **読みどころ（図版・動画は原文の理解に直結するので必ず見ること）**:
  1. **図1**: レンダラプロセスの内部構成図（メインスレッド／ワーカスレッド／コンポジタスレッド／ラスタスレッドの位置関係）。「どの処理がどのスレッドか」の地図として最重要。
  2. **図2・図5・図9・図16**: DOM ツリー → layout tree → paint records → layer tree の**変換の連鎖**を1枚ずつ図示したもの。木の形がどう変わるかが視覚的に分かる。
  3. **図6（動画）**: 改行位置の変化で段落のボックスレイアウトが動く様子。レイアウトが「フォントサイズと改行に依存する」という本文の主張を実感できる。
  4. **図8**: `z-index` を考慮せず HTML 記述順に塗った場合の誤ったレンダリング結果。
  5. **図10（動画）**: DOM+Style / Layout / Paint の各ツリーが生成される順序のアニメーション。パイプラインの依存関係の理解に直結。
  6. **図11・図12・図13**: 60fps タイムライン上でのフレーム落ち（jank）、JavaScript によるフレームブロック、`requestAnimationFrame` でチャンク分割した場合の比較。
  7. **図14・図15（動画）**: 素朴なラスタ処理 vs コンポジット処理のアニメーション比較。コンポジットの利点が一目で分かる。
  8. **図17・図18**: タイルのビットマップ生成と GPU 送信、compositor frame がブラウザプロセス→GPU へ流れる図。

### B. 併せて読むべき一次資料（原文が挙げているもの）
1. **HTML Standard の "An introduction to error handling and strange cases in the parser"** — ブラウザがどのように壊れた HTML を修復するかの規範的記述。mXSS／サニタイザ回避を理解する土台。
2. **HTML Standard の "overview of the parsing model"** — パーサ・スクリプト実行・`document.write()` の関係を示す図がある。
3. **Chrome のデフォルト CSS（`third_party/blink/renderer/core/html/resources/html.css`）** — 「CSS を書かなくても computed style がある」根拠の実物。
4. **シリーズ part1（マルチプロセス）/ part2（ナビゲーション）/ part4（入力とコンポジタ）** — 本稿は part3 のみを扱うため、`commit` メッセージやネットワークスレッドの詳細は part2、コンポジタへの入力処理は part4 にある。
