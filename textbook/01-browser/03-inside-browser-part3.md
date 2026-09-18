# レンダラプロセスの内部：パースからコンポジットまでのレンダリングパイプライン

> **この節で分かること**
> - レンダラプロセスが持つ4種類のスレッド（メイン／ワーカ／コンポジタ／ラスタ）の役割を説明できる
> - HTML→DOM のパースが「エラーを投げず寛容に正規化する」仕組みと、それが攻撃面になる理由を説明できる
> - `<script>` がパースを止める理由と、`async`/`defer`/`preload` による回避策を説明できる
> - スタイル計算→レイアウト→ペイントという各段の依存関係と、再計算が高コストになる理由を説明できる
> - コンポジット（レイヤ分割→タイル→ラスタ→draw quads→compositor frame）が「メインスレッドを介さず」滑らかな描画を実現する流れを追える
> - 「どの処理がどのスレッドで動くか」の地図が、DOM-based XSS・mXSS・XS-Leaks の前提としてどう効くかを言える

**元資料**: https://developer.chrome.com/blog/inside-browser-part3 （原典取得済み。ただし本文はレンダリング済みページではなく、サイトのビルド元ソース Markdown `GoogleChrome/developer.chrome.com` の `site/en/blog/inside-browser-part3/index.md` から全文取得。図版18点・動画4点の画像そのものは未取得、キャプション文言は取得済み）
**関連する節**: シリーズ part1（マルチプロセスアーキテクチャ）／ part2（ナビゲーションフロー）／ part4（入力とコンポジタ）

---

## 1. レンダラプロセスとは何を担当するプロセスか

### 1-1. 「タブの中で起きることすべて」を担当する

レンダラプロセス（renderer process）とは、ブラウザの1つのタブの中身、すなわち「そのタブの中で起きることすべて」に責任を持つプロセスのこと。Web 開発者が書いたコードの大半は、このプロセスの中で動く。

このシリーズは全4部構成で、part1 がマルチプロセスアーキテクチャ、part2 がナビゲーションフロー、本稿 part3 がレンダラプロセス内部、part4 が入力（マウス移動・クリック）とコンポジタを扱う。本稿の中核テーマは、レンダラプロセスが **HTML・CSS・JavaScript を、ユーザが操作できる Web ページに変換する**という仕事そのものである。

原典の記事は Google Chrome チームの Mariko Kosaka によるもので、2018-09-20 に公開され、2020-08-18 に更新されている。ブラウザ内部の設計は年月とともに細部が変わり得るため、こうした原典の年代・著者を押さえておくと、記述が「いつの時点の Chrome の話か」を判断しやすくなる。

### 1-2. レンダラプロセスの中には4種類のスレッドがある

レンダラプロセスは単一のスレッドで動くのではなく、内部に複数のスレッドを抱えている。スレッド（thread）とは、1つのプロセスの中で並行して走る処理の流れのこと。ここでは以下の4種類が登場する。

- **メインスレッド（main thread）**: 開発者がユーザに届けるコードのほとんどを処理する中心的なスレッド。
- **ワーカスレッド（worker thread）**: Web Worker や Service Worker を使っている場合、JavaScript の一部がここで処理される。
- **コンポジタスレッド（compositor thread）**: ページを効率よく滑らかに描くために走る。
- **ラスタスレッド（raster thread）**: 同じく描画の効率化のために走る。

原文の図1のキャプションはこう記す。

```text
Figure 1: Renderer process with a main thread, worker threads, a compositor thread, and a raster thread inside
```

つまり、メインスレッド／複数のワーカスレッド／コンポジタスレッド／ラスタスレッドを内部に持つのがレンダラプロセスである。レンダラプロセスは Web パフォーマンスの多くの側面に触れており、この記事はあくまで概観にすぎない。より深く知るには Web Fundamentals の Performance セクション（https://developers.google.com/web/fundamentals/performance/why-performance-matters/ ）が案内されている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Inside look at modern web browser (part 3)（レンダリング済みページ） — https://developer.chrome.com/blog/inside-browser-part3
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress プロキシが 403 を返しアクセス不可。本文は GitHub 上のビルド元 Markdown から取得した）。以下の記述は原本 Markdown の全文と図キャプションにもとづく要約であり、図版・動画の画像そのものは含まない。
> **読みどころ**:
> 1. **図1**（レンダラプロセスの内部構成図）— 「どの処理がどのスレッドか」の地図として最重要。本節を読み進めるうえで手元に開いておくとよい。
> 2. **図2・図5・図9・図16** — DOM ツリー → layout tree → paint records → layer tree の変換の連鎖を1枚ずつ図示したもの。木の形がどう変わるかが視覚的に分かる。
> 3. **図6・図10・図14・図15**（いずれも動画）— レイアウトの動き、パイプラインの生成順、素朴なラスタ vs コンポジットの比較。本文の主張を動きで実感できる。
> **代替手段**: 本文テキストは `GoogleChrome/developer.chrome.com` リポジトリの `site/en/blog/inside-browser-part3/index.md` で全文が読める（無料・公式ミラー）。

〔補足〕クライアントサイド脆弱性ハンティングの観点では、この「1タブ＝1レンダラプロセス（サイト単位の分離）」という前提が Site Isolation（サイト分離）の土台になっている。DOM の構築・JavaScript 実行・パースがすべて同一メインスレッド上の同一オリジン文脈で行われるため、DOM-based XSS や prototype pollution の影響範囲は「そのレンダラ内の当該オリジンの全データ」で決まる。「どの処理がどのスレッドで動くか」の地図は、後の XS-Leaks 章の前提として効いてくる。

---

## 2. パース：HTML から DOM を組み立てる

### 2-1. commit メッセージを受けてパースが始まる

ナビゲーション（別ページへの移動）が確定すると、ブラウザプロセスからレンダラプロセスへ **commit メッセージ**が届く（この commit の詳細は part2 が扱う）。レンダラプロセスがこの commit を受け取り、HTML データを受信し始めると、メインスレッドが HTML というテキスト文字列のパース（構文解析）を開始し、それを **DOM（Document Object Model）**に変換する。

DOM とは次の2つの顔を持つ。

1. ブラウザ内部でのページの表現（internal representation of the page）。
2. Web 開発者が JavaScript を通じて操作できる、データ構造かつ API。

HTML ドキュメントをどう DOM にパースするかは、**HTML Standard（https://html.spec.whatwg.org/）**という仕様で定義されている。原文の図2のキャプションはこうである。

```text
Figure 2: The main thread parsing HTML and building a DOM tree
```

### 2-2. ブラウザに HTML を食わせてもエラーは投げられない

このパースで最も重要な性質は、**壊れた HTML を渡してもブラウザはエラーを投げない**という点である。仕様が、こうしたエラーを優雅に（gracefully）扱うよう設計されているためだ。具体例を見る。

- 例1: 閉じ `</p>` タグが欠けていても、それは妥当な HTML として扱われる。
- 例2: 次の誤ったマークアップ（`<b>` が `<i>` より先に閉じられている）を考える。

```html
Hi! <b>I'm <i>Chrome</b>!</i>
```

これはブラウザによって、あたかも次のように書いたかのように扱われる。

```html
Hi! <b>I'm <i>Chrome</i></b><i>!</i>
```

このように、入れ子の閉じ方が矛盾していても、ブラウザは勝手に「正規化」して整合の取れた木構造にする。この修復の仕組みの詳細は、HTML 仕様の "An introduction to error handling and strange cases in the parser" 節（https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser）に書かれている。

〔補足〕この「エラーを投げず勝手に正規化する」性質は、脆弱性ハンティングにおける**パーサ差異（parser differential）**の源泉である。パーサ差異とは、複数のパーサが同じ入力を別々に解釈すること。サーバ側のサニタイザや WAF が使う HTML パーサと、ブラウザの HTML パーサとで、タグの閉じ方・入れ子の解釈が食い違うと、サニタイザを通過したマークアップがブラウザ側で別の木構造になり、**mXSS（mutation XSS、変異 XSS）**が成立する。`innerHTML` に再代入したときの再シリアライズ／再パースで木が変形する現象も同じ根を持つ。「HTML はエラーにならない」は仕様上の親切さであると同時に攻撃面でもある。

> ### 📌 ここは自分で開いて読んでください
> **資料**: HTML Standard — An introduction to error handling and strange cases in the parser — https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser
> **なぜ**: 本教科書の執筆環境からは本文を取得していない（理由: 原文が参照先として案内しているだけで、本ノートの一次取得対象外）。以下の位置づけは原文の案内文にもとづく。
> **読みどころ**:
> 1. ブラウザが壊れた HTML をどのように修復するかの規範的（normative）記述。mXSS やサニタイザ回避を理解する土台になる。
> 2. 「どんな入力がどう正規化されるか」を規則として押さえると、サニタイザ通過後の変形を予測しやすくなる。
> **代替手段**: 同じく HTML Standard の "overview of the parsing model"（下記）も併読するとよい。

---

## 3. サブリソースの先読み：preload scanner

### 3-1. 画像・CSS・JavaScript は別途読み込む必要がある

Web ページは通常、画像・CSS・JavaScript といった外部リソース（サブリソース）を使う。これらはネットワークまたはキャッシュから読み込む必要がある。

メインスレッドは、DOM を組み立てるためにパースを進める過程で、リソースを見つけた順に1つずつリクエストすることも「できる」。しかしそれでは遅い。そこで高速化のために、**preload scanner（プリロードスキャナ）**と呼ばれる仕組みがパースと並行して（concurrently）走る。

### 3-2. preload scanner はトークンを覗き見て先行リクエストを投げる

HTML ドキュメント内に `<img>` や `<link>` のような要素があると、preload scanner は HTML パーサが生成したトークン（構文解析の途中生成物）を覗き見て（peeks at tokens）、リクエストを送る。

ここで重要なのは、リクエストを実際に発行する主体が「レンダラのメインスレッド」ではなく、**ブラウザプロセス内のネットワークスレッド**である点だ。この構図は part1／part2 で説明されたアーキテクチャと接続する。

〔補足〕preload scanner はパーサがブロックされている間もトークン列を先読みしてリソース取得を始める。このため「`<script>` でパースが止まっている間も、画像や CSS の取得は進む」。診断上は、preload scanner が投げる先行リクエストが CSP・Referrer-Policy・SRI の評価対象になること、また「まだ DOM に入っていない要素の属性からリクエストが飛ぶ」ことが、インジェクション痕跡の観測（たとえば属性インジェクションによる外部通信の発生タイミング）に影響する点を押さえておくとよい。

---

## 4. JavaScript がパースをブロックする理由

### 4-1. `<script>` を見つけるとパースは止まる

HTML パーサが `<script>` タグを見つけると、HTML ドキュメントのパースをいったん停止し、その JavaScript コードをロードし、パースし、実行しなければならない。

```html
<script>
```

なぜパースを止める必要があるのか。それは、**JavaScript が `document.write()` のような方法でドキュメントの形を変えられ、DOM 構造全体を書き換えてしまえる**からである。

```javascript
document.write()
```

もしスクリプト実行を待たずにパースを進めてしまうと、スクリプトが DOM を丸ごと作り替えたときに、それまでの解析結果が無意味になる。そのため HTML パーサは、パースを再開する前に JavaScript の実行が終わるのを待たなければならない。パーサ・スクリプト実行・`document.write()` の関係を示す図は、HTML 仕様の "overview of the parsing model"（https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model）にある。

JavaScript の実行時に内部で何が起きるかに興味があれば、V8 チームの解説（たとえば Shapes と Inline Caches を扱う https://mathiasbynens.be/notes/shapes-ics ）が案内されている。

---

## 5. リソースの読み込み方をブラウザにヒントとして伝える

パースが `<script>` で止まるのは避けたい。そこで開発者は、リソースをうまく読み込ませるためのヒントをブラウザへ送れる。原文が挙げる手段は次の4つである。

| ヒント | 原文の記述内容 |
|---|---|
| `async` 属性（`<script async>`） | JavaScript が `document.write()` を使わないなら `<script>` に付けられる。ブラウザは JavaScript を非同期にロード・実行し、パースをブロックしない。参照: MDN `https://developer.mozilla.org/docs/Web/HTML/Element/script#attr-async` |
| `defer` 属性（`<script defer>`） | 同上。`async` と並んで挙げられている。参照: MDN `https://developer.mozilla.org/docs/Web/HTML/Element/script#attr-defer` |
| JavaScript module | 適する場合は JavaScript モジュールを使ってもよい（参照: Web Fundamentals の modules primer） |
| `<link rel="preload">` | そのリソースが現在のナビゲーションで確実に必要であり、できるだけ早くダウンロードしたいことをブラウザに知らせる方法 |

原文が明記している前提条件が重要である。**`async` / `defer` を付けてよいのは「JavaScript が `document.write()` を使わない」場合に限る**。

```text
async
```

```text
defer
```

```html
<link rel="preload">
```

さらに詳しくは "Resource Prioritization – Getting the Browser to Help You"（https://developers.google.com/web/fundamentals/performance/resource-prioritization）が案内されている。

〔補足〕原文は `async` と `defer` を「どちらもパースをブロックしない」とまとめており、両者の実行タイミングの違いまでは踏み込んでいない。実際には `defer` は DOM 構築完了後に記述順で実行され、`async` はダウンロード完了しだいに順序不定で実行される。セキュリティ的には、`async`/`defer` により**実行順序が保証されない／後になる**ことが、グローバル変数の初期化順に依存した防御コード（たとえばサニタイザやポリシー設定の適用前に攻撃者制御のスクリプトが走ってしまう）を破ることがある。また `<link rel="preload">` は「必ず取得される」ため、属性インジェクションで `rel=preload` を注入できると、強制的な外部通信（情報の持ち出しやスキャン）に悪用され得る。

---

## 6. スタイル計算（computed style）

### 6-1. メインスレッドが CSS をパースして computed style を決める

DOM があるだけでは、ページの見た目はまだ分からない。CSS でページの要素をスタイルできるからだ。そこで**メインスレッドが CSS をパースし、各 DOM ノードの computed style（計算済みスタイル）を決定する**。

computed style とは、「CSS セレクタに基づいて、各要素にどんなスタイルが最終的に適用されているか」という情報のこと。この情報は DevTools の `computed` セクションで確認できる。原文の図3のキャプションはこうである。

```text
Figure 3: The main thread parsing CSS to add computed style
```

### 6-2. CSS を書かなくても computed style はある

CSS を一切提供しなくても、各 DOM ノードは computed style を持つ。`<h1>` タグは `<h2>` タグより大きく表示され、各要素にマージンが定義されている。これは**ブラウザがデフォルトのスタイルシートを持っている**からだ。Chrome のデフォルト CSS のソースは次の場所で見られる。

```text
https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/resources/html.css
```

このファイルこそ「CSS を書かなくても computed style がある」根拠の実物である。

---

## 7. レイアウト（layout tree）：要素の幾何を求める

### 7-1. 構造とスタイルを知っていてもまだ描けない

ここまででレンダラプロセスは「ドキュメントの構造（DOM）」と「各ノードのスタイル（computed style）」を知っている。しかし、これだけではまだページを描けない。

原文はこれを、電話で友人に絵を説明する場面にたとえる。「大きな赤い円と小さな青い四角がある（There is a big red circle and a small blue square）」と言っても、友人にはその絵が正確にどう見えるか分からない。位置や大きさの情報が足りないのだ。

```text
Figure 4: A person standing in front of a painting, phone line connected to the other person
```

この図には原文で "game of human fax machine"（人間ファックス機のゲーム）という alt テキストが付いている。片方が絵を言葉で伝え、もう片方がそれを聞いて絵を再現する伝言ゲーム、という比喩である。言葉だけでは正確な位置や大きさが伝わらない、という点が要点だ。

### 7-2. レイアウトは要素の幾何を求めるプロセス

**レイアウト（layout）とは、要素の幾何（geometry）を求めるプロセス**である。メインスレッドが DOM と computed style を歩き（walks through）、**layout tree（レイアウトツリー）**を作る。layout tree は、各要素の x y 座標や、バウンディングボックス（要素を囲む矩形）のサイズといった情報を持つ。

```text
Figure 5: The main thread going over DOM tree with computed styles and producing layout tree
```

### 7-3. layout tree に含まれるもの・含まれないもの

layout tree は DOM ツリーと似た構造になり得るが、**ページ上で可視のものに関係する情報だけを含む**。この違いは正確に押さえておきたい。

| CSS の指定 | layout tree に含まれるか |
|---|---|
| `display: none` | 含まれない（要素そのものが layout tree の一部にならない） |
| `visibility: hidden` | 含まれる（場所は占めるが見えないだけ） |
| `p::before{content:"Hi!"}` のような擬似要素の content | DOM には無いが layout tree には含まれる |

```css
display: none
```

```css
visibility: hidden
```

```css
p::before{content:"Hi!"}
```

### 7-4. レイアウトは非常に重い仕事

レイアウトの決定は難しいタスクだ。上から下へ流れる最も単純なブロックフローでさえ、**フォントがどれだけ大きいか**と**どこで改行するか**を考慮しなければならない。これらが段落のサイズと形に影響し、それが次の段落をどこに置くかに影響する。

```text
Figure 6: Box layout for a paragraph moving due to line break change
```

さらに CSS は、要素を片側に float させたり、オーバーフロー項目をマスクしたり、書字方向（writing directions）を変えたりできる。レイアウト段階は非常に重い仕事を担い、Chrome ではエンジニアのチーム全体がこれに取り組んでいる。詳細は BlinkOn Conference の講演（録画: https://www.youtube.com/watch?v=Y5Xa4H2wtVA ）が案内されている。

〔補足〕`display:none` は layout tree に入らず、`visibility:hidden` は入る、という差は、スクレイピングや自動診断で「見えているか」を判定するときの落とし穴になる。クリックジャッキングやオーバーレイ系の UI 欺瞞を検証するときにも意味を持つ。また `::before`/`::after` の `content` が DOM に存在しないのに描画されることは、**CSS インジェクションによる情報漏えい**（属性セレクタと `content` や背景画像リクエストを組み合わせ、値を1文字ずつ抜き取る手法）の前提知識になる。

---

## 8. ペイント（paint records）：どの順番で塗るか

### 8-1. 塗る順番を決めないと正しく描けない

DOM・スタイル・レイアウトがそろっても、まだページを描くには足りない。絵を再現するとき、要素のサイズ・形・位置を知っていても、**どの順番で塗るか**を判断しなければならないからだ。

```text
Figure 7: A person in front of a canvas holding paintbrush, wondering if they should draw a circle first or square first
```

たとえば、ある要素に `z-index` が設定されているかもしれない。`z-index` は要素の重なり順を指定するプロパティである。この場合、HTML に書かれた要素の順で単純に塗ると、間違ったレンダリング結果になる。

```css
z-index
```

```text
Figure 8: Page elements appearing in order of an HTML markup, resulting in wrong rendered image because z-index was not taken into account
```

### 8-2. paint records は描画順のメモ

このペイント段階で、**メインスレッドは layout tree を歩いて paint records（ペイントレコード）を作る**。paint record は、「まず背景、次にテキスト、次に矩形」といった描画プロセスのメモである。JavaScript で `<canvas>` 要素に描画した経験があれば、このプロセスは馴染みがあるはずだ。

```html
<canvas>
```

```text
Figure 9: The main thread walking through layout tree and producing paint records
```

---

## 9. レンダリングパイプラインの更新はコストが高い

### 9-1. 各段は前段の結果を入力にする

レンダリングパイプラインで最も重要な理解は、**各ステップが前の操作の結果を使って新しいデータを作る**という点だ。たとえば layout tree で何かが変わると、ドキュメントの影響を受けた部分について、paint order（ペイント順）を再生成する必要が出る。

```text
Figure 10: DOM+Style, Layout, and Paint trees in order it is generated
```

つまり前段が変わると後段の再生成が必要になり、それが高コストにつながる。

### 9-2. アニメーションは毎フレーム全操作を走らせる

要素をアニメーションさせている場合、ブラウザはフレームごとにこれらの操作を走らせなければならない。ほとんどのディスプレイは毎秒60回画面をリフレッシュする（60 fps）。毎フレームで物を動かせば人の目に滑らかに見えるが、**途中のフレームを落とす（misses the frames in between）とページは "janky"（ガタつく）ように見える**。

```text
Figure 11: Animation frames on a timeline
```

さらに厄介なことに、これらの計算はメインスレッド上で走っている。そのため、アプリケーションが JavaScript を実行しているときには、レンダリングがブロックされ得る。

```text
Figure 12: Animation frames on a timeline, but one frame is blocked by JavaScript
```

### 9-3. メインスレッドを詰まらせない2つの対策

原文が挙げる対策は次の2つである。

1. **JavaScript の処理を小さなチャンクに分割し、`requestAnimationFrame()` を使って毎フレーム実行するようスケジュールする。** 詳細は "Optimize JavaScript Execution"（https://developers.google.com/web/fundamentals/performance/rendering/optimize-javascript-execution）。
2. **JavaScript を Web Worker で実行してメインスレッドのブロックを避ける**（参照動画: https://www.youtube.com/watch?v=X57mh8tKkgE ）。

```javascript
requestAnimationFrame()
```

```text
Figure 13: Smaller chunks of JavaScript running on a timeline with animation frame
```

〔補足〕「メインスレッドが JavaScript で詰まるとフレームが落ちる」という性質は、クライアントサイドの DoS（正規表現の破滅的バックトラッキング＝ReDoS、巨大 JSON のパース、深い DOM 生成など）が**UI フリーズとして観測される**理由そのものである。また `requestAnimationFrame` はタイミング副チャネル（レンダリング時間差による情報推測、いわゆる pixel stealing / XS-Leaks の一部）の計測手段としても知られる。

---

## 10. コンポジット（compositing）：滑らかな描画の中核

### 10-1. ラスタライズと「素朴な方法」

ブラウザは今、ドキュメントの構造・各要素のスタイル・ページの幾何・ペイント順を知っている。ではどうやってページを描くのか。**この情報を画面上のピクセルに変えることを「ラスタライズ（rasterizing）」と呼ぶ。**

素朴（naive）な方法は、ビューポート（画面に見えている領域）内部の部分だけをラスタすることだ。ユーザがスクロールしたら、ラスタ済みフレームを移動し、欠けた部分をさらにラスタして埋める。これは Chrome が最初にリリースされたときのやり方だった。しかし現代のブラウザは、より洗練された**コンポジット（compositing）**というプロセスを走らせる。

```text
Figure 14: Animation of naive rastering process
```

### 10-2. コンポジットとは

**コンポジットとは、ページの一部分を「レイヤ（layers）」に分離し、それぞれを個別にラスタライズし、コンポジタスレッドと呼ばれる別スレッドでページとして合成する技法**である。

この方式の利点は、スクロールが起きたときに現れる。レイヤは既にラスタ済みなので、あとは新しいフレームを合成するだけでよい。アニメーションも同じ方法で（レイヤを動かして新しいフレームを合成することで）実現できる。自分のサイトがどうレイヤに分割されているかは、DevTools の Layers パネルで確認できる（参照: LogRocket 記事 https://blog.logrocket.com/eliminate-content-repaints-with-the-new-layers-panel-in-chrome-e2c306d4d752?gi=cd6271834cea ）。

```text
Figure 15: Animation of compositing process
```

### 10-3. レイヤへの分割（layer tree）

どの要素がどのレイヤに入るべきかを調べるため、**メインスレッドが layout tree を歩いて layer tree（レイヤツリー）を作る**。この処理は、DevTools の performance パネルで "Update Layer Tree" と呼ばれる部分にあたる。

```text
Update Layer Tree
```

ページのある部分（たとえばスライドインするサイドメニュー）が別レイヤになるべきなのになっていない場合は、CSS の `will-change` 属性でブラウザにヒントを与えられる。

```css
will-change
```

```text
Figure 16: The main thread walking through layout tree producing layer tree
```

ただし注意がある。すべての要素にレイヤを与えたくなるかもしれないが、**過剰な数のレイヤをまたいでコンポジットすると、毎フレームでページの小さい部分をラスタするより遅くなり得る**。そのため、アプリケーションのレンダリング性能を測ることが極めて重要だ。詳細は "Stick to Compositor-Only Properties and Manage Layer Count"（https://developers.google.com/web/fundamentals/performance/rendering/stick-to-compositor-only-properties-and-manage-layer-count）。

### 10-4. メインスレッドの外でのラスタとコンポジット

layer tree ができてからの流れを、原文の順序どおりに追う。

1. layer tree が作られ、paint order が決まると、メインスレッドはその情報をコンポジタスレッドへ **commit** する。
2. コンポジタスレッドが各レイヤをラスタライズする。
3. レイヤはページ全長のように大きくなり得るため、コンポジタスレッドはレイヤを**タイル（tiles）**に分割し、各タイルをラスタスレッドへ送る。
4. ラスタスレッドが各タイルをラスタライズし、それを **GPU メモリ（GPU memory）**に格納する。
5. コンポジタスレッドは異なるラスタスレッドに優先度を付けられるので、ビューポート内（または近傍）のものを先にラスタできる。
6. 1つのレイヤは、ズームイン動作などに対応するため、異なる解像度向けの複数のタイリング（multiple tilings for different resolutions）を持つ。
7. タイルがラスタされると、コンポジタスレッドは **draw quads** と呼ばれるタイル情報を集めて **compositor frame** を作る。

```text
Figure 17: Raster threads creating the bitmap of tiles and sending to GPU
```

用語は原文の定義を訳出しておく。

| 用語 | 原文の定義（逐語） | 日本語 |
|---|---|---|
| Draw quads | "Contains information such as the tile's location in memory and where in the page to draw the tile taking in consideration of the page compositing." | タイルのメモリ上の位置、およびページのコンポジットを考慮したうえでページ内のどこにそのタイルを描くかといった情報を含む |
| Compositor frame | "A collection of draw quads that represents a frame of a page." | ページの1フレームを表す draw quads の集合 |

8. compositor frame は IPC 経由でブラウザプロセスに提出（submitted）される。
9. この時点で、ブラウザ UI の変更のために UI スレッドから、あるいは拡張機能のために他のレンダラプロセスから、別の compositor frame が追加され得る。
10. これらの compositor frame は GPU に送られ、画面に表示される。
11. スクロールイベントが入ってくると、コンポジタスレッドは GPU に送るための別の compositor frame を作る。

```text
Figure 18: Compositor thread creating compositing frame. Frame is sent to the browser process then to GPU
```

### 10-5. コンポジットの利点：メインスレッドを介さない

コンポジットの利点は、**メインスレッドを関与させずに行われる**ことにある。コンポジタスレッドはスタイル計算や JavaScript 実行を待つ必要がない。だからこそ「**コンポジットのみのアニメーション（compositing only animations）**」が、滑らかな性能のために最良と考えられている（参照: https://www.html5rocks.com/en/tutorials/speed/high-performance-animations/ ）。逆に、レイアウトやペイントを再計算する必要があれば、メインスレッドが関与しなければならない。

〔補足〕「コンポジタスレッドは JavaScript を待たない」という性質は、XS-Leaks／タイミング攻撃の文脈で重要だ。メインスレッドが忙しくてもスクロールやコンポジットが進むため、被害サイトの JS を止めても描画タイミングの差が観測でき得る。逆に、レイアウト/ペイントを強制する API（`getBoundingClientRect()` や `offsetWidth` の読み取りによる強制同期レイアウト）は測定可能な時間差を生み、クロスオリジンの状態推測（要素サイズの差から「ログイン済みか」などを推測する手法）の足場になる。「どの段が誰のスレッドで動くか」の地図が、XS-Leaks 章の前提として効いてくる。

---

## 11. パイプライン全体の地図（まとめ表）

これまでの各段を1枚の表に整理する。「入力→出力」と「どのスレッドで動くか」を対応づけて読むとよい。

| 段 | 実行スレッド | 入力 | 出力 | 補足 |
|---|---|---|---|---|
| HTML パース / DOM 構築 | メインスレッド | HTML バイト列（navigation commit 後に受信開始） | DOM | エラーを投げず寛容に正規化。`<script>` で停止 |
| サブリソース先読み | preload scanner（パースと並行） | HTML パーサのトークン | ネットワークスレッド（ブラウザプロセス）へのリクエスト | `<img>`, `<link>` を先取り |
| JavaScript 実行 | メインスレッド | スクリプト | DOM の変更 | パースをブロック（`document.write()` があり得るため）。`async`/`defer` で回避可 |
| スタイル計算 | メインスレッド | DOM + CSS（著者 CSS + ブラウザ既定スタイルシート） | 各 DOM ノードの computed style | DevTools の `computed` で確認 |
| レイアウト | メインスレッド | DOM + computed style | layout tree（x y 座標、バウンディングボックス） | `display:none` は含まれない / `visibility:hidden` は含まれる / `::before` content は含まれる |
| ペイント | メインスレッド | layout tree | paint records（描画順のメモ） | `z-index` を考慮した順序決定 |
| レイヤ化 | メインスレッド | layout tree | layer tree | DevTools performance の "Update Layer Tree"。`will-change` でヒント |
| commit | メインスレッド → コンポジタスレッド | layer tree + paint order | — | ここでメインスレッドの責務が終わる |
| ラスタライズ | コンポジタスレッド（分割）+ ラスタスレッド（実行） | レイヤ → タイル | ビットマップ（GPU メモリ格納） | ビューポート近傍を優先。複数解像度のタイリングを保持 |
| コンポジット | コンポジタスレッド | タイル情報 = draw quads | compositor frame | IPC でブラウザプロセスへ → GPU で表示。UI スレッドや他レンダラのフレームも合流 |

構造をツリーで示すと、生成の連鎖はこうなる。

```text
HTML バイト列
   │  (メインスレッドがパース)
   ▼
 DOM ── + CSS ──► computed style
   │                 │
   │   (DOM と style を歩く)
   ▼                 ▼
 layout tree（幾何：x y・サイズ）
   │  (layout tree を歩く)
   ├──► paint records（描画順）
   └──► layer tree（レイヤ分割）
             │
========= ここまでメインスレッド =========
             │  commit（layer tree + paint order をコンポジタスレッドへ渡す。ここでメインスレッドの責務が終わる）
             ▼
========= ここからコンポジタ／ラスタスレッド =========
        タイル分割（コンポジタスレッド） ──► ラスタスレッドがラスタ ──► GPU メモリ
             ▼
        draw quads を集約 ──► compositor frame ──(IPC)──► ブラウザプロセス ──► GPU ──► 画面
```

この `commit` が、メインスレッドとコンポジタスレッドの責務の境界線である。commit 以降のタイル分割・ラスタライズ・draw quads の集約・compositor frame の生成は、いずれもメインスレッドの外で進む。だからこそメインスレッドが JavaScript で詰まっていても、スクロールなどのコンポジットは滑らかに進み得る（この非対称性は 10-5 と後の XS-Leaks 章の要点である）。

本稿はパースからコンポジットまでのレンダリングパイプラインを見た。次回（シリーズ最終回 part4）では、コンポジタスレッドをより詳しく見て、`mouse move` や `click` のようなユーザ入力が来たときに何が起きるかを扱う（次回リンク: https://developers.google.com/web/updates/2018/09/inside-browser-part4 、ボタンラベル "Next: Input is coming to the compositor"）。なお原文の著者 Mariko Kosaka の連絡先として、記事末尾には Twitter `@kosamari`（https://twitter.com/kosamari ）が示されている。

〔補足〕原文中の `developers.google.com/web/updates/...` や `www.html5rocks.com` 系の URL は、現在 `web.dev` / `developer.chrome.com` へリダイレクトされることが多い。参照する際は原文の URL をそのまま示しつつ、リンク切れの可能性に留意するとよい。

---

## 手を動かす

1. **レイヤ分割を見る**: Chrome で任意のページを開き、DevTools を起動する。`Ctrl+Shift+P`（Mac は `Cmd+Shift+P`）でコマンドメニューを開き、"Show Layers" と打って Layers パネルを表示する。ページがいくつのレイヤに分かれているかを観察する。
2. **"Update Layer Tree" を確認する**: DevTools の Performance パネルで記録（録画）ボタンを押し、ページをスクロールしてから停止する。タイムラインの中に "Update Layer Tree" の項目があるか探す。これがメインスレッドで layer tree を作っている部分である。
3. **computed style を見る**: 任意の要素を右クリックして「検証」し、Elements パネルの右側にある `Computed` タブを開く。CSS を1行も書いていない要素でも、フォントサイズやマージンに値が入っていることを確かめる。これがブラウザのデフォルトスタイルシートの効果である。
4. **`display:none` と `visibility:hidden` の差を確かめる**: 検証中の要素に、Styles パネルから `visibility: hidden` を追加すると、要素は消えるが「場所」は残る（周囲がずれない）。今度は `display: none` にすると、周囲が詰まる。前者は layout tree に残り、後者は残らないことの現れである。
5. **パースをブロックする様子を見る**: 小さな HTML ファイルを自分で作り、`<body>` の途中に `<script>alert('stop')</script>` を置いて開く。`alert` を閉じるまで、それ以降のコンテンツが描画されないことを確認する（自分で立てた検証環境で行うこと）。
6. **Chrome のデフォルト CSS を眺める**: `https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/resources/html.css` を開き、`h1` や `p` の既定マージン・フォントサイズがどう定義されているかを見る。

## つまずきポイント

- **「HTML がエラーにならない」を親切な仕様としてだけ捉える誤解**。この寛容さはパーサ差異と mXSS の土台でもある。サニタイザを通った文字列が、ブラウザ側で別の木になり得ることを常に疑うこと。
- **preload scanner のリクエストをメインスレッドが投げると思い込む誤解**。実際にリクエストを発行するのはブラウザプロセスのネットワークスレッドである。
- **`async` と `defer` を同じものと思い込む誤解**。原文はどちらも「パースをブロックしない」とだけ言うが、実行タイミング（`defer` は DOM 構築後・記述順、`async` は取得しだい・順序不定）が違う。防御コードの初期化順が崩れる原因になり得る。
- **`display:none` と `visibility:hidden` の混同**。前者は layout tree に入らず、後者は入る。自動診断で「見えているか」を判定するときの落とし穴。
- **レイヤは多いほど速いという誤解**。過剰なレイヤはかえって遅くなり得る。必ず性能を計測する。
- **「メインスレッドが止まればページは完全に固まる」という誤解**。コンポジタスレッドは JavaScript を待たないため、JS を止めてもスクロールやコンポジットは進む。この非対称性が XS-Leaks の足場になる。

## この節のまとめ

- レンダラプロセスは1タブの中身すべてを担当し、内部にメインスレッド・ワーカスレッド・コンポジタスレッド・ラスタスレッドを持つ。
- メインスレッドは navigation commit を受けて HTML をパースし DOM を作る。この中核業務は HTML・CSS・JavaScript を操作可能なページに変えることである。
- HTML パースはエラーを投げず、壊れたマークアップを寛容に正規化する。これがパーサ差異と mXSS の源泉になる。
- preload scanner がパースと並行してトークンを覗き見し、ブラウザプロセスのネットワークスレッドへサブリソースを先行リクエストする。
- `<script>` はパースを止める。`document.write()` で DOM 構造を丸ごと変え得るためで、`async`/`defer`/module/`<link rel="preload">` で回避できる。
- スタイル計算はメインスレッドが CSS をパースし各 DOM ノードの computed style を決める。CSS を書かなくてもデフォルトスタイルシートにより computed style は存在する。
- レイアウトは要素の幾何（x y 座標・サイズ）を求め layout tree を作る。`display:none` は含まれず、`visibility:hidden` と `::before` の content は含まれる。
- ペイントは layout tree を歩いて描画順のメモ（paint records）を作る。`z-index` を考慮しないと誤った描画になる。
- パイプラインの各段は前段の結果を入力にするため、前段が変わると後段の再計算が必要で高コストになる。
- 60fps を維持できずフレームを落とすとページはガタつく。メインスレッドが JS で詰まるとレンダリングがブロックされ、対策は処理のチャンク分割＋`requestAnimationFrame` や Web Worker。
- ラスタライズは情報を画面のピクセルに変えること。現代の Chrome は素朴なビューポートラスタではなくコンポジットを行う。
- コンポジットはレイヤ分割→タイル→ラスタ→GPU メモリ格納→draw quads 集約→compositor frame→IPC→GPU という流れで進む。
- コンポジットはメインスレッドを介さないため、コンポジットのみのアニメーションが最も滑らか。過剰なレイヤはむしろ遅くなり得る。
- 「どの段がどのスレッドで動くか」の地図は、DOM-based XSS・mXSS・CSS インジェクション・クライアント側 DoS・XS-Leaks の前提知識として効く。

## 理解度チェック

1. レンダラプロセスが内部に持つ4種類のスレッドを挙げよ。
   ▶ 答え: メインスレッド、ワーカスレッド、コンポジタスレッド、ラスタスレッド。

2. `Hi! <b>I'm <i>Chrome</b>!</i>` をブラウザはどう扱うか。またこの性質がなぜ攻撃面になるのか。
   ▶ 答え: `Hi! <b>I'm <i>Chrome</i></b><i>!</i>` と書いたかのように正規化する。エラーを投げず勝手に木構造を整えるため、サーバ側サニタイザのパーサとブラウザのパーサで解釈が食い違うと mXSS（変異 XSS）が成立し得る。

3. preload scanner が投げるサブリソースのリクエストは、実際にはどのスレッドが発行するか。
   ▶ 答え: レンダラのメインスレッドではなく、ブラウザプロセス内のネットワークスレッド。

4. `<script>` がパースをブロックするのはなぜか。回避する手段を1つ挙げよ。
   ▶ 答え: JavaScript が `document.write()` などで DOM 構造全体を書き換え得るため、パーサは実行を待つ必要がある。回避策は `async`／`defer`／JavaScript module／`<link rel="preload">` のいずれか。ただし `async`/`defer` は `document.write()` を使わない場合に限る。

5. layout tree に「含まれない」CSS 指定と、「含まれる」CSS 指定を1つずつ挙げよ。
   ▶ 答え: 含まれない例は `display: none`。含まれる例は `visibility: hidden`（や `p::before{content:"Hi!"}` の content）。

6. ペイント段階で作られる paint records とは何か。
   ▶ 答え: layout tree を歩いて作る、「まず背景、次にテキスト、次に矩形」といった描画順のメモ。`z-index` を考慮した塗る順序を記録する。

7. 「レンダリングパイプラインの更新はコストが高い」と言われるのはなぜか。
   ▶ 答え: 各段が前段の結果を入力にするため、layout tree などが変わると影響部分の paint order 等を再生成する必要があり、アニメーションでは毎フレームこれが走るから。

8. draw quads と compositor frame の違いを説明せよ。
   ▶ 答え: draw quads はタイルのメモリ上の位置とページ内の描画位置などの情報。compositor frame はそれら draw quads を集めた、ページ1フレーム分の集合。

9. なぜ「コンポジットのみのアニメーション」が最も滑らかとされるのか。
   ▶ 答え: コンポジットはコンポジタスレッドで行われメインスレッドを介さないため、スタイル計算や JavaScript の実行を待たずに済むから。レイアウトやペイントの再計算が必要になるとメインスレッドが巻き込まれる。

10. コンポジタスレッドが JavaScript を待たない性質は、セキュリティ上どんな意味を持つか。
    ▶ 答え: メインスレッドが忙しくてもスクロール・コンポジットが進むため、被害サイトの JS を止めても描画タイミング差が観測でき、XS-Leaks／タイミング攻撃の足場になり得る。

## 出典

- https://developer.chrome.com/blog/inside-browser-part3
- https://developers.google.com/web/updates/2018/09/inside-browser-part1
- https://developers.google.com/web/updates/2018/09/inside-browser-part2
- https://developers.google.com/web/updates/2018/09/inside-browser-part4
- https://developers.google.com/web/fundamentals/performance/why-performance-matters/
- https://html.spec.whatwg.org/
- https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser
- https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model
- https://mathiasbynens.be/notes/shapes-ics
- https://developer.mozilla.org/docs/Web/HTML/Element/script#attr-async
- https://developer.mozilla.org/docs/Web/HTML/Element/script#attr-defer
- https://developers.google.com/web/fundamentals/primers/modules
- https://developers.google.com/web/fundamentals/performance/resource-prioritization
- https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/resources/html.css
- https://www.youtube.com/watch?v=Y5Xa4H2wtVA
- https://developers.google.com/web/fundamentals/performance/rendering/optimize-javascript-execution
- https://www.youtube.com/watch?v=X57mh8tKkgE
- https://blog.logrocket.com/eliminate-content-repaints-with-the-new-layers-panel-in-chrome-e2c306d4d752?gi=cd6271834cea
- https://developers.google.com/web/fundamentals/performance/rendering/stick-to-compositor-only-properties-and-manage-layer-count
- https://www.html5rocks.com/en/tutorials/speed/high-performance-animations/
- https://twitter.com/kosamari

<!-- sources: https://developer.chrome.com/blog/inside-browser-part3, https://html.spec.whatwg.org/, https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser, https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model, https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/resources/html.css, https://developers.google.com/web/fundamentals/performance/rendering/optimize-javascript-execution, https://www.html5rocks.com/en/tutorials/speed/high-performance-animations/ -->
<!-- terms: レンダラプロセス, メインスレッド, コンポジタスレッド, ラスタスレッド, DOM, preload scanner, computed style, layout tree, paint records, layer tree, ラスタライズ, コンポジット, draw quads, compositor frame, mXSS, パーサ差異, XS-Leaks, requestAnimationFrame, will-change, z-index -->
<!-- self-read: https://developer.chrome.com/blog/inside-browser-part3 | サイト側の egress プロキシが 403 を返し、レンダリング済みページと図版・動画を自動取得できなかった -->
<!-- self-read: https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser | 原文が参照案内するのみで本ノートの一次取得対象外 -->
