# ブラウザのレンダリング後半：レイアウト・ペイント・合成と現代アーキテクチャ

> **この節で分かること**
> - レンダーツリー（描画用の木）ができたあと、ブラウザがどうやって「位置と大きさ」を決め（レイアウト）、画面のピクセルに変える（ペイント）のかを説明できる
> - なぜ `offsetHeight` などのプロパティを読むだけで画面がカクつくのか、そしてそれがなぜタイミング副チャネルの土台になるのかを説明できる
> - z-index とスタッキングコンテキスト（重なりの文脈）が描画順を決める仕組みを理解し、クリックジャッキングの技術的な根っこを指させる
> - 2011 年の古典的モデル（単一レンダリングスレッド、ペイントで終わり）と、2018 年以降の現代モデル（マルチプロセス、Site Isolation、コンポジタスレッド、ヒットテスト）の違いを対応表として説明できる
> - どの記述を「古典として読む部分」とし、どこを「現代の公式ドキュメントで更新すべき部分」とするかを自分で判断できる

**元資料**: https://codeburst.io/how-browsers-work-6350a4234634 （原典は取得できず二次情報ベース。本文は 1 文字も取得できていないため、この節は codeburst 記事が要約対象とする Garsiel & Irish 原典と、到達可能な公式一次資料〔MDN／Chrome 公式〕にもとづく）
**関連する節**: 「07a ブラウザのレンダリング前半：高レベル構造とパース」（本節はその続きで、レンダーツリーができた以降を扱う）

---

## 0. この節の位置づけ（前提の最小補足）

この節は 1 本の大きなレンダリングパイプライン（描画の流れ）の後半である。前半（07a）で、ブラウザが HTML をパースして **DOM ツリー**（文書の木構造）を作り、CSS と合流させて **レンダーツリー**（画面に出す要素だけを集めた木）を組み立てるところまでを見た。

ここで **レンダーツリーとは、DOM のうち実際に描画されるノードだけを、計算済みスタイルとともに並べた木のこと**。WebKit 系では Render Tree／RenderObject、Gecko（Firefox）系では Frame tree／Frame と呼ぶ。この節では、その木が出来上がった直後から始める。

パイプライン全体を 1 枚の図にすると次のようになる。左半分（〜レンダーツリー）が前半、右半分がこの節である。

```
HTML → パース → DOM ツリー ┐
                          ├→ レンダーツリー → レイアウト → ペイント →（現代）合成 → 画面
CSS  → パース → スタイル規則 ┘   （この節）      （この節）      （この節）
```

なお元記事「Notes on “How Browsers Work”」の本文は執筆環境から取得できなかった（後述）。そのため本節は**原典と公式ドキュメントで裏の取れる事実のみ**を書き、元記事固有の言い回しや独自の図には一切依拠しない。

---

## 1. レイアウト（Layout / Reflow）——「位置と大きさ」を計算する

### 1.1 なぜレイアウトという段階が要るのか（設計意図）

レンダーツリーに新しく追加されたばかりの renderer（描画オブジェクト）は、**位置も大きさも持っていない**。「この段落を左から何 px、上から何 px の場所に、幅何 px で置くか」という幾何情報（geometry、形と位置の情報）は、まだ決まっていない。

この幾何情報を計算する処理を **レイアウト（layout）**、または **リフロー（reflow）** と呼ぶ。WebKit 系は layout、Gecko（Firefox）系は reflow という名前を使うが、指しているものは同じである。

### 1.2 どう動くのか（フローベースの単一パス）

HTML は **フローベースのレイアウトモデル** を使う。フローとは「文書を上から下、左から右へ流していく」という考え方のこと。大半の場合、幾何情報は**単一パス（1 回の走査）**で計算できる。フローの後方にある要素は通常、前方の要素の幾何に影響しないからだ。だからブラウザは文書を左から右、上から下へ一方向に進める。

ただし例外はある。原典は「**HTML の table は複数パスを要することがある**」と明記している。テーブルはセル同士の幅が影響し合うので、一方向 1 回では決まらないのだ。

レイアウトの座標は **ルートフレームに対する相対**で、**top と left**（上端・左端）で表す。処理は**再帰的**で、`<html>` 要素に対応するルート renderer から始まる。

```
ルート renderer（<html>）      ← 位置 0,0 / 寸法は viewport（可視領域）
  └ layout() を呼ぶ
      ├ 子 renderer.layout()
      │   └ さらにその子.layout() …
      └ …
```

- ルート renderer の位置は **0,0**、寸法は **viewport（ビューポート、ブラウザウィンドウの可視部分）**。
- すべての renderer は `layout`（または `reflow`）メソッドを持ち、レイアウトが必要な子の `layout` を順に呼ぶ。

### 1.3 ダーティビットシステム（Dirty bit system）

ここで **ダーティビットとは、「この要素は再レイアウトが必要」という印（フラグ）のこと**。小さな変更のたびに文書全体を計算し直すのは無駄なので、ブラウザはこの印で「触られた部分」だけを追跡する。

フラグは 2 種類ある。

| フラグ | 意味 |
|---|---|
| **dirty** | この renderer 自身のレイアウトが必要 |
| **children are dirty** | 自身は問題ないが、レイアウトが必要な子が少なくとも 1 つある |

変更・追加された renderer は、自身と子を dirty とマークする。

### 1.4 グローバルレイアウトと増分レイアウト

レイアウトの起動され方には 2 種類ある。

| 種類 | 何をレイアウトするか | 起動の原因 |
|---|---|---|
| **グローバルレイアウト（global layout）** | レンダーツリー全体 | すべての renderer に影響する変更（例：フォントサイズ変更）、画面のリサイズ |
| **増分レイアウト（incremental layout）** | dirty な renderer だけ | renderer が dirty になったとき（例：ネットワークから届いた追加コンテンツが DOM に加わり、新しい renderer が増えたとき） |

増分レイアウトは dirty な部分だけを計算するが、その結果さらに周囲の再レイアウトが必要になる（損傷が広がる）こともある。

〔補足〕増分レイアウトが起きる典型例が **寸法未指定の置換要素（replaced element）** である。ここで**置換要素とは、画像（`<img>`）や動画のように、中身がその要素の外（別ファイル）から来る要素のこと**。MDN によれば、**寸法（`width` / `height`）が分からない置換要素には、まずプレースホルダ（仮の場所取り）領域が確保され、画像の寸法が判明した時点で reflow が起きる**。だから画像に寸法を書かないと、読み込み後にレイアウトがずれる（後続の内容が飛ぶ）。これが CLS（レイアウトのガタつき）の一因であり、実務上は `<img width=… height=…>` を必ず付けるべき理由でもある。

### 1.5 非同期レイアウトと同期レイアウト——ここが副チャネルの入口

- **増分レイアウトは通常「非同期」に行われる。** Firefox は増分レイアウト用の **"reflow commands"（リフローコマンド）をキューに貯め**、スケジューラがまとめて実行する。WebKit にもタイマーがあり、木を走査して dirty な renderer をレイアウトする。「非同期」とは、すぐには実行せず、あとでまとめて処理するという意味である。
- **グローバルレイアウトは通常「同期」に起動される。** つまりその場で即座に計算される。

ここが攻撃者・防御者の双方にとって重要になる。原典はこう書いている——**「`offsetHeight` のようなスタイル情報を要求するスクリプトは、増分レイアウトを同期的に起動できる」**。

つまり、本来は貯めておいてまとめて処理するはずのレイアウトが、JavaScript が要素の寸法を「今すぐ教えろ」と要求した瞬間に、**その場で強制実行**されてしまう。二次資料は、この**同期レイアウトを強制するプロパティ／メソッド**として次を挙げている。

```text
getComputedStyleValue()
getBoundingClientWidth()
.offsetWidth
.offsetHeight
```

完全な一覧は Paul Irish の gist にあるとされる。

```text
https://gist.github.com/paulirish/5d52fb081b3570c81e3a
```

これは性能問題（レイアウトスラッシング、後述）であると同時に、**副チャネル（side channel、本来の通信路とは別に情報が漏れる経路）による情報漏えい**の観点でも押さえるべき挙動である。攻撃者は「あるプロパティを読むとレイアウトが強制され、その所要時間が中身に依存する」ことを利用し、**時間差（timing）から秘密を推測**できる。

### 1.6 レイアウト処理の具体手順（幅はボトムアップ、高さはトップダウン）

原典が示すレイアウト最適化の 1 つ：レイアウトが「resize」や renderer の**位置**（大きさではない）の変更で起動された場合、**サイズはキャッシュから取られ再計算されない**。局所的な変更（テキストフィールドへの入力など）では部分木だけが対象になり、ルートからやり直さない。さもなければキー入力 1 回ごとに文書全体のレイアウトが走ってしまう。

原典が挙げるレイアウト処理の番号付き手順（逐語訳）は次のとおり。

```text
1. 親 renderer が自身の幅を決める。
2. 親が子を走査し:
   1. 子 renderer を配置する（x と y を設定）。
   2. 必要なら子の layout を呼ぶ（子が dirty、global layout 中、等）
      — これが子の「高さ」を計算する。
3. 親は子の累積高さ＋マージン・パディングの高さを使って
   「自身の高さ」を設定する — これは親の親が使う。
4. 自身の dirty bit を false に設定する。
```

ポイントは、**幅は上（親）から下（子）へ、高さは下（子）から上（親）へ**伝わることである。親は自分の幅を先に決め、その中で子を並べ、子の高さの合計から自分の高さを決める。

Firefox はレイアウトのパラメータに **`nsHTMLReflowState`**（親の幅などを含む "state" オブジェクト）を使い、出力に **`nsHTMLReflowMetrics`**（計算済み高さを含む "metrics" オブジェクト）を使う。

### 1.7 幅の計算（Width calculation）

renderer の幅は、包含ブロック（その要素を含む箱）の幅、`width` スタイル、マージン、ボーダーから計算される。原典は `<div style="width:30%"/>` の幅を WebKit が計算する手順（`RenderBox` クラスの `calcWidth`）を挙げている。

まず包含幅は container の `availableWidth` と 0 の最大値で、この場合の `availableWidth` は `contentWidth`：

```text
clientWidth() - paddingLeft() - paddingRight()
clientWidth and clientHeight represent the interior of an object excluding border and scrollbar.
```

そのうえで、`width` スタイルのパーセンテージを絶対値に直し、水平ボーダー・パディングを加算する。ここまでが **preferred width（望ましい幅）** で、次に**最小幅**（分割できない最小単位）と**最大幅**を計算し、preferred width をその範囲に収める。値は**キャッシュ**される。

### 1.8 改行（Line Breaking）

レイアウト中の renderer が「もう 1 行に入りきらない、改行が必要」と判断すると、処理を止めて「分割が必要」と親へ伝える。**親が追加の renderer を生成し、それらに layout を呼ぶ。**

### 1.9 攻撃者はどこを突くのか／どう守るのか

- **突く側**：同期レイアウトを強制するプロパティ（`offsetHeight` など）を意図的に読み、その所要時間を測る。中身によって時間が変わるなら、それは**タイミング副チャネル**になる。後の XS-Leaks（クロスサイト情報漏えい）の章で再訪する土台である。
- **守る側**：性能面では、レイアウトを強制するプロパティの読み取りと DOM 変更を交互にやらない（バッチ化する）。セキュリティ面では、秘密の有無で処理時間が変わらないよう設計し、タイミング差を観測されても意味のある情報が漏れないようにする。

### 1.10 レイアウトスラッシングと「DOM は遅いのか」

二次資料は **レイアウトスラッシング（layout thrashing）** を「ページが読み込み完了になる前に、ブラウザが何度も reflow / repaint を強いられる状態」と定義する。JavaScript が普及する前のサイトは通常 1 回の reflow/paint で済んだが、今は読み込み中に JS が DOM を変更し、追加の reflow/repaint を起こすことが増えた。低スペック端末ほど遅延が目立つ。

#### なぜ DOM は遅いのか（短答）

「なぜ DOM は遅いのか」への二次資料の答えは明快だ——**短い答えは「DOM は遅くない」**。DOM ノードの追加・削除はポインタの入れ替えが数回で、JS オブジェクトのプロパティ設定と大差ない。**遅いのは DOM ではなくレイアウトのほうである**。DOM に触ると木全体に dirty bit が立ち、JS が制御をブラウザに返した瞬間に、ブラウザは「CSS recalc → layout → repaint → re-compositing」を実行して再描画する。しかも**特定のプロパティにアクセスするとレイアウトが同期的に起動される**（前述の `offsetHeight` 等）。つまり「DOM 操作が重い」のではなく、「DOM 操作が引き起こすレイアウトが重い」のである。

#### 具体例（Google Instant と React）

二次資料はこの重さを 2 つの実例で示す。1 つは **Google Instant**——「2013 年頃、Google Instant は 1 クエリで 13 回のレイアウトを引き起こし、モバイルで画面が約 2 秒固まった（のちに高速化）」。もう 1 つは **React**——React は「ページ状態を更新するたびに最大 1 回のレイアウトに抑える」ことを保証すると説明する。仮想 DOM でまとめて差分を適用し、レイアウトの回数を減らす設計だ、という対比である。

---

## 2. ペイント（Painting）——レンダーツリーをピクセルにする

### 2.1 どう動くのか

ペイント段では、レンダーツリーを走査して各 renderer の **`paint` メソッド**を呼び、内容を画面に出す。**ペイントは UI インフラストラクチャコンポーネントを使う**（前半で見た UI backend 層のこと）。

ペイントもレイアウトと同様に **グローバル**（木全体を描画）と **増分（incremental）**がある。増分ペイントでは、変化した renderer が**画面上の自分の矩形（長方形の領域）を無効化（invalidate）**する。すると OS がそこを **"dirty region"（汚れた領域）** とみなし **"paint" イベント**を生成する。OS は賢く、**複数の領域を 1 つに合体（coalesce）**する。

Chrome では renderer がメインプロセスと**別プロセス**にあるため、この処理はより複雑になる。Chrome は OS のこの挙動をある程度自前でシミュレートする。presentation がイベントを監視し、メッセージを render root へ委譲、該当 renderer に到達するまで木を走査して再描画する。

### 2.2 ペイントの順序——スタッキングコンテキストと「後ろから前へ」

**CSS2 がペイント処理の順序を定義する**（`http://www.w3.org/TR/CSS21/zindex.html`）。これは実際には **スタッキングコンテキスト（stacking contexts、重なりの文脈）** で要素が積まれる順序である。ここで**スタッキングコンテキストとは、「どの要素がどの要素の手前に描かれるか」を決める、重なりの単位のこと**。

重要な原則は——**スタックは後ろから前へ描画される**。後ろにある要素を先に描き、前にある要素を上に重ねる。だから**最前面の要素が背後の要素を隠す**。

ブロック renderer の描画順（stacking order、原文逐語）は次のとおり。

| 順 | 描画対象 |
|---|---|
| 1 | background color（背景色） |
| 2 | background image（背景画像） |
| 3 | border（ボーダー） |
| 4 | children（子要素） |
| 5 | outline（アウトライン） |

### 2.3 各エンジンの最適化

- **Firefox の display list（ディスプレイリスト）**：レンダーツリーを走査し、対象矩形のための display list を「背景 → ボーダー…」と正しい描画順で作る。これにより repaint のたびに木を「全背景 → 全画像 → 全ボーダー…」と何度も走査せず、**1 度の走査で済む**。不透明な要素に完全に隠れる要素は追加しない最適化もする。
- **WebKit の矩形保存**：再描画の前に**古い矩形をビットマップとして保存**し、**新旧の矩形の差分（delta）だけを描画**する。

### 2.4 攻撃者はどこを突くのか

この「後ろから前へ、最前面が隠す」という順序こそ、**クリックジャッキング（後述）と CSS 経由の視覚的なだましの前提**である。攻撃者は描画順を操作し、ユーザが見ている要素と、実際にクリック対象になる要素をずらす。防御はこの重なりの制御にかかっている（3 章と 6 章で詳述）。

---

## 3. 動的変更（Dynamic changes）——「最小の仕事だけ」の原則

ブラウザは、変更に対して可能な限り最小の処理で済まそうとする。原典の対応表（逐語訳）は、脆弱性ハンティングでも「どの操作がどこまで再計算を波及させるか」を測る目安になる。

| 変更 | 引き起こされる処理 |
|---|---|
| 要素の**色**の変更 | その要素の **repaint のみ** |
| 要素の**位置**の変更 | **その要素・その子・場合により兄弟の layout と repaint** |
| **DOM ノードの追加** | そのノードの **layout と repaint** |
| **`<html>` のフォントサイズ増加**のような大きな変更 | **キャッシュの無効化、木全体の relayout と repaint** |

色だけの変更が repaint だけで済む一方、位置の変更やノード追加は layout を巻き込む。これはタイミング副チャネルを設計する側にとって、「どの操作なら重い同期計算を確実に引き起こせるか」の手がかりになる。

---

## 4. レンダリングエンジンのスレッドとイベントループ

### 4.1 単一スレッドという古典モデル（設計意図）

原典は明快にこう述べる——**レンダリングエンジンはシングルスレッド。ネットワーク操作以外のほぼすべてが単一スレッドで起こる**。ここで**スレッドとは、プログラムの中で同時並行に走る処理の流れの単位のこと**。単一スレッドとは、一度に 1 つのことしかやらない（1 つ終えてから次へ進む）という意味である。

- Firefox と Safari では、これがブラウザの**メインスレッド**。
- **Chrome ではタブプロセスのメインスレッド**（タブごとに別プロセスなので）。

ネットワーク操作だけは複数の並列スレッドで実行できる。ただし**並列接続数には上限**がある。

| 出典 | ホストあたりの並列接続数 |
|---|---|
| 原典（2011） | 通常 2〜6 接続（例：Firefox 3 は 6） |
| 二次資料（更新値） | 通常 6〜13 接続 |

### 4.2 イベントループ（Event loop）

**ブラウザのメインスレッドはイベントループである**。ここで**イベントループとは、プロセスを生かし続ける無限ループで、レイアウトやペイントのようなイベントを待っては処理する仕組みのこと**。Firefox のメインイベントループのコード（逐語）は驚くほど短い。

```cpp
while (!mExiting)
    NS_ProcessNextEvent(thread);
```

二次資料は「Chrome のようなブラウザは、レンダリングエンジンのインスタンスをタブごとに複数実行し、各タブは別プロセスで動く」と注記する。

〔補足〕この「メインスレッドは 1 本のイベントループ」という理解は、なぜ重い JavaScript がページを固まらせるのか、そしてなぜ後述のコンポジタスレッドが別に必要になったのかを理解する鍵である。ただし「単一のレンダリングスレッド」という原典の言い方は現代では正確でなくなっている（後述の 8 章で更新する）。

---

## 5. CSS2 視覚モデル——箱（ボックス）の世界

### 5.1 キャンバスとボックスモデル

- **The canvas（キャンバス）**：CSS2 仕様でキャンバスとは「整形構造（formatting structure）がレンダリングされる空間」、つまりブラウザが内容を描く場所。**各次元について無限だが、ブラウザは viewport の寸法に基づいて初期幅を選ぶ**。`www.w3.org/TR/CSS2/zindex.html` によれば、キャンバスは他のキャンバスに含まれる場合は透明、そうでなければブラウザ定義の色になる。
- **CSS ボックスモデル**：文書ツリーの各要素に対して生成される矩形の箱を、視覚整形モデルに従って配置する。**各ボックスは content area（内容領域：テキスト・画像など）と、任意の padding・border・margin を持つ**（Figure 18）。

```
+-----------------------------+  ← margin（余白）
|  +-----------------------+  |  ← border（枠線）
|  |  +-----------------+  |  |  ← padding（内側の余白）
|  |  |  content area   |  |  |  ← テキスト・画像
|  |  +-----------------+  |  |
|  +-----------------------+  |
+-----------------------------+
```

各ノードは **0〜n 個**のボックスを生成する。すべての要素は `display` プロパティを持ち、生成するボックス型が決まる（逐語）。

```text
block  - generates a block box.
inline - generates one or more inline boxes.
none - no box is generated.
```

既定は inline だが、ブラウザのスタイルシートが上書きする（例：`div` の既定は block）。既定スタイルシートの例は `www.w3.org/TR/CSS2/sample.html`。

### 5.2 ポジショニング方式（3 方式）

ボックスの配置方式は 3 つある。

| 方式 | 意味 | 対応する `position` 値 |
|---|---|---|
| **Normal（通常フロー）** | 文書内の位置どおりに配置。レンダーツリー内の位置が DOM 内の位置と同じ | `static`, `relative` |
| **Float（フロート）** | まず通常フローで配置し、その後できるだけ左右へ寄せる | （`float` 属性で指定） |
| **Absolute（絶対配置）** | DOM 内の位置とは違う場所にレンダーツリーへ置く | `absolute`, `fixed` |

ポジショニングは `position` プロパティと `float` 属性で決まる。`static` では位置を定義せず既定配置になり、他の方式では著者が `top`／`bottom`／`left`／`right` を指定する。

ボックスのレイアウト方法を決めるものは（逐語）：**Box type / Box dimensions / Positioning scheme / External information**（画像サイズや画面サイズなどの外部情報）。

### 5.3 ボックスの種類（Box types）

- **Block box（ブロックボックス）**：自身の矩形を持ち、ブラウザウィンドウ上でブロックを形成する（Figure 19）。
- **Inline box（インラインボックス）**：自身のブロックを持たず、包含ブロックの内側にある（Figure 20）。
- **ブロックは縦に、インラインは横に整形される**（Figure 21）。
- インラインボックスは行（**"line boxes"**）の中に置かれる。行は最も高いボックス以上の高さになり、ベースライン揃えではさらに高くなりうる。幅が足りなければ複数行に分かれる（段落で普通に起きること、Figure 22）。

---

## 6. ポジショニングとレイヤ表現——クリックジャッキングの核心

### 6.1 relative と float

- **Relative（相対配置）**：通常どおり配置したあと、必要な差分（delta）だけずらす（Figure 23）。
- **Floats（フロート）**：ボックスを行の左右へずらす。興味深い特徴は、**他のボックスがその周りを回り込んで流れること**（Figure 24）。原典の例（逐語）：

```html
 <p>
   <img style="float:right" src="images/image.gif" width="100" height="100">
   Lorem ipsum dolor sit amet, consectetuer...
 </p>
```

### 6.2 absolute と fixed

absolute と fixed のレイアウトは通常フローと無関係に正確に定義される。**要素は通常フローに参加せず、寸法は container に対する相対。fixed では container が viewport になる**。原典は太字で注意する——**「fixed ボックスは文書がスクロールされても動かない！」**（Figure 25）。

### 6.3 レイヤ表現（Layered representation）と z-index

3 次元目、すなわち画面の奥行き方向（"z 軸"）の位置は **`z-index` プロパティ**で指定する。

- ボックスは**スタック（スタッキングコンテキスト）**に分けられる。各スタックで**後ろの要素が先に、前の要素がユーザに近い側に描かれ、重なれば最前面が背後を隠す**。
- スタックは `z-index` の順に並ぶ。**`z-index` を持つボックスはローカルなスタックを形成し、viewport が外側のスタックを持つ**。

原典の例（逐語）：

```html
 <style type="text/css">
       div {
         position: absolute;
         left: 2in;
         top: 2in;
       }
 </style>
 <p>
     <div
          style="z-index: 3;background-color:red; width: 1in; height: 1in; ">
     </div>
     <div
          style="z-index: 1;background-color:green;width: 2in; height: 2in;">
     </div>
  </p>
```

結果（Figure 26）：**赤い div はマークアップ上では緑より先にあり、通常フローなら先に（＝下に）描かれるはずだが、`z-index` が高いのでルートボックスのスタックの中でより前方に来て、緑の手前に描かれる**。

### 6.4 攻撃者はどこを突くのか／どう守るのか

〔補足〕スタッキングコンテキストと z-index の挙動は、**クリックジャッキング（clickjacking）／UI redressing（UI の上塗り）の技術的核心**である。ここで**クリックジャッキングとは、ユーザが「あるボタンを押している」と思っている裏で、実際には別の要素をクリックさせる攻撃のこと**。攻撃者は `opacity`（透明度）、`pointer-events`（クリックが通るか）、`transform`（変形・移動）と z-index を組み合わせ、透明な標的要素をユーザの視線の上に重ねる。

守る側は、自サイトが攻撃者のページの中に透明に重ねられないよう、`X-Frame-Options` や CSP の `frame-ancestors` で**フレーム内表示を制限**する。これは後の UI redressing 章で扱うが、その仕組みの根はこの描画順にある。

---

## 7. 図解（Figures）の一覧と原典の参考文献

### 7.1 原典の図の索引

教科書に図を再作成するときの索引として、原典の全図を挙げる（この節の範囲に関わる後半のみ抜粋。図番号とキャプションは原文のまま）。

画像ファイル名の列は、原典のリポジトリで図を再作成・差し替えするときの索引として原典（webplatform docs）のファイル名をそのまま載せている。

| 図 | キャプション（原文） | 画像ファイル名 | 内容 |
|---|---|---|---|
| Figure 17 | Incremental layout - only dirty renderers and their children are layed out (3.6) | `reflow.png` | dirty な部分木だけが再レイアウトされる |
| Figure 18 | CSS2 box model | `image046.jpg` | content / padding / border / margin の 4 領域 |
| Figure 19 | Block box | `image057.png` | ブロックボックス |
| Figure 20 | Inline boxes | `image059.png` | インラインボックス |
| Figure 21 | Block and Inline formatting | `image061.png` | ブロックは縦、インラインは横 |
| Figure 22 | Lines | `image063.png` | line box への詰め込み |
| Figure 23 | Relative positioning | `image065.png` | 通常配置後の delta 移動 |
| Figure 24 | Float | `image067.png` | float:right の画像にテキストが回り込む |
| Figure 25 | Fixed positioning | `image25.png` | fixed はスクロールしても動かない |
| Figure 26 | （原文は "Fixed positioning" と誤記。実際は z-index の例） | `image071.png` | z-index:3 の赤 div が z-index:1 の緑 div の前面に来る |

### 7.2 原典の参考文献（Resources）から押さえるべきもの

原典は Resources 節に多くの一次資料を挙げている。この節（レイアウト以降）に関係が深いのは次の系統である。

- **Firefox のレイアウト内部**：L. David Baron, *Faster HTML and CSS: Layout Engine Internals for Web Developers*（スライド `http://dbaron.org/talks/2008-11-12-faster-html-and-css/slide-6.xhtml`、Google tech talk 動画 `http://www.youtube.com/watch?v=a2_6bGNZ7bA`）、Chris Waterson, *Notes on HTML Reflow*。
- **WebKit の描画内部**：David Hyatt, *WebCore Rendering*（`http://webkit.org/blog/114/`）、*The FOUC Problem*（`http://webkit.org/blog/66/the-fouc-problem/`）。
- **仕様**：CSS 2.1（`http://www.w3.org/TR/CSS2/`）。

これらはいずれも「レイアウトエンジンが具体的にどう幾何を計算するか」を深掘りする一次資料であり、本節の内容をさらに掘りたいときの入口になる。

---

## 8. 【重要】原典（2011）を現代化する——ここは更新して読む

原典は 2011 年の記述であり、そのまま書くと**誤りになる箇所**がある。ここからは、到達可能な公式一次資料（MDN と Chrome 公式ブログ）で原典を更新する。以下はいずれも公式ドキュメントの日本語要約であり、逐語訳ではない。

> ### 📌 ここは自分で開いて読んでください
> **資料**: codeburst.io「How Browsers Work（Notes on “How Browsers Work”）」 — https://codeburst.io/how-browsers-work-6350a4234634
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 実行環境のエグレス（外部接続）許可リストが `codeburst.io` / `medium.com` への接続を組織ポリシーで拒否。Wayback・テキスト抽出プロキシも同様に遮断され、WebSearch 予算も枯渇）。記事本文は 1 文字も取得できておらず、著者名・公開日も不明。以下の記述は、この記事が要約対象とする Garsiel & Irish 原典と、到達できた公式資料にもとづく要約である。
> **読みどころ**:
> 1. まず記事の位置づけを確認する。正式タイトルは “Notes on “How Browsers Work”” で、Garsiel & Irish 原典の読解ノートである。原典を先に（または並行して）読むのが最短。
> 2. レンダーツリーと DOM が 1:1 でない点（`head` と `display:none` は載らない／`visibility:hidden` は載る）と、z-index / スタッキングコンテキストの描画順序。UI redressing と情報漏えいの前提。
> **代替手段**: 原典（GitHub 経由・無料）を読むのが上位互換。加えて下記の MDN 2 本と Chrome 公式 4 部作が実質的な代替になる。読者環境からなら `https://web.archive.org/web/2024/https://codeburst.io/how-browsers-work-6350a4234634` も試せる（本執筆環境からは検証不可）。

### 8.1 ブラウザの分割は「マルチプロセス」で見直す

Chrome 公式「Inside look at modern web browser」（Mariko Kosaka, 2018）part 1 は「**Web ブラウザをどう作るかの標準仕様は存在しない**」と明言する。原典の 7 コンポーネント図は**規範ではなく一つの整理**にすぎない。実体としての Chrome は複数プロセスに分かれている。

| プロセス | 役割 |
|---|---|
| **Browser process** | アドレスバー・ブックマーク・戻る/進む等の「chrome 部分」に加え、**ネットワーク要求やファイルアクセスといった不可視で特権的な部分** |
| **Renderer process** | タブの中で起きることすべて |
| **Plugin process** | サイトが使うプラグイン（例：flash） |
| **GPU process** | GPU タスクを他プロセスから隔離して扱う |

（ほかに拡張機能プロセス、ユーティリティプロセスもある。）

マルチプロセスの利点は 2 つ。1 タブが応答しなくなっても他は生き残ること。そして**セキュリティとサンドボックス化**——OS がプロセスの権限を制限できるので、**任意のユーザ入力を扱うレンダラプロセスからの任意ファイルアクセスを Chrome は制限できる**。コストはメモリで、各プロセスが V8 などの共通基盤のコピーを抱える。そこで Chrome は**プロセス数に上限**を設け、上限に達すると**同一サイトの複数タブを 1 プロセスにまとめる**。

〔補足〕このメモリと安定性のトレードオフに対する Chrome の設計方針が **Servicification（サービス化）** である。ここで**サービス化とは、ブラウザプログラムの各部（ネットワーク、ストレージ等）を独立した「サービス」として作り、環境に応じてプロセス分割の粒度を変えられるようにする改修のこと**。強力なハードウェアでは各サービスを別プロセスに分割して安定性を優先し、リソース制約のある端末では複数サービスを 1 プロセスに集約してメモリを節約する。つまり「プロセスをいくつに割るか」を端末ごとに変えられる、という考え方である。

### 8.2 Site Isolation——プロセス境界をセキュリティ境界にする（最重要）

原典 2 節の「Chrome はタブごとに 1 プロセス」は、2018 年時点で既に**「サイトごと」へ更新**されている。それが **Site Isolation（サイト分離）** である。

- **クロスサイト iframe ごとに別のレンダラプロセスを走らせる**機能。
- Chrome 公式は「**Same-Origin Policy（同一オリジンポリシー、SOP）が Web の中核セキュリティモデルであり、その回避が攻撃の主目的である。サイトを分離する最も効果的な手段がプロセス分離である**」と述べる。
- **Meltdown と Spectre（2018 年に公表された CPU の投機的実行を悪用する脆弱性）によって、プロセスでサイトを分離する必要性が一層明白になった**。
- **デスクトップでは Chrome 67 から既定で有効**。実装は iframe 間の通信方法まで作り直しており、DevTools やページ内検索（Ctrl+F）もプロセス横断で動くようになった。

〔補足〕XS-Leaks・Spectre 系・SOP 回避を論じる章では、この「**プロセス境界＝最後の防衛線**」という位置づけを最初に提示すべきである。

### 8.3 スレッドは 1 本ではない——コンポジタとラスタ

原典 4 章の「単一のレンダリングスレッド」は**もう正確ではない**。Chrome 公式 part 3 によれば、renderer process は次のスレッドを持つ。

| スレッド | 役割 |
|---|---|
| **メインスレッド** | 送られたコードの大半（DOM 構築・スタイル・レイアウト・ペイント記録・JS）を処理 |
| **ワーカスレッド** | Web Worker / Service Worker |
| **コンポジタスレッド（compositor thread）** | ラスタ済みレイヤを 1 ページに合成 |
| **ラスタスレッド（raster thread）** | レイヤ（のタイル）を実ピクセルに変換 |

MDN も「ブラウザは概ねシングルスレッド」という言い方は**メインスレッドの話**だと整理する。だから教科書では「レンダリングは単一スレッド」ではなく「**メインスレッドが 1 本**」と言い換えるのが正しい。

### 8.4 ナビゲーション——原典に完全に欠けている層

原典はネットワークを「8KB チャンクで来る」程度しか扱わない。MDN と Chrome 公式 part 2 は、リクエスト前後の内訳を明示する。

- **接続の確立**：DNS lookup → TCP ハンドシェイク（SYN / SYN-ACK / ACK の 3 メッセージ）→ TLS ネゴシエーション。MDN は TLS に「さらに 5 往復」を要するとし、**合計 8 往復ののちにようやくリクエストを送れる**とする。
- **TCP slow start（スロースタート）**：輻輳ウィンドウ **CWND** は 1 / 2 / 4 / 10 MSS のいずれかで初期化され（MSS は Ethernet 上で 1500 バイト）、ACK を受ければ倍、受けなければ半分になる。
- **最初のコンテンツチャンクは通常 14KB**（原典の「8K chunks」に相当する現代の数値）。**TTFB（Time To First Byte）** は操作から最初の HTML パケット受信までの時間。
- **TTI（Time To Interactive、対話可能になるまでの時間）**：最初のリクエストからページが操作を受け付けられるようになるまでの時間。MDN の言う「対話可能」とは、**FCP（First Contentful Paint、最初の意味あるピクセルが出た時点）より後で、かつユーザ操作に 50ms 以内で応答できる**状態を指す。MDN は、2MB のスクリプトが 1.5 秒以上メインスレッドを占有し、クリックにもタップにも反応しないページの例を挙げる。〔補足〕TTFB が「サーバがどれだけ速く返し始めたか」の指標なのに対し、TTI は「ユーザがいつ触れるようになったか」の指標であり、両者は別物である。

〔補足〕この 14KB / slow start は本来は性能の話だが、「最初の 1 パケットに何が載るか」は**タイミング副チャネル（XS-Leaks）で観測されうる粒度**でもある。まず性能として提示し、副チャネル章で再訪すると繋がる。

#### ナビゲーションを主導するのは browser process

Chrome 公式 part 2 は、ナビゲーションが **browser process 主導**で進むことを、次のステップ列で示す。原典にはこの層が丸ごと欠けている。

1. **入力の処理**：アドレスバーへの入力は browser process の **UI スレッド**が扱い、まず「検索クエリか URL か」を判定する。
2. **ナビゲーション開始**：UI スレッドが **network スレッド**にネットワーク呼び出しを開始させる（DNS 解決・TLS 接続はここ）。サーバリダイレクト（HTTP 301 等）を受け取ると network スレッドが UI スレッドに伝え、別 URL のリクエストが始まる。
3. **レスポンスの読み取り**：後述の MIME スニッフィング・SafeBrowsing・CORB などのセキュリティ判定が集中する（次項）。
4. **レンダラプロセスの先回り確保**：ネットワーク応答には数百 ms かかりうるので、UI スレッドは**ステップ 2 でネットワークリクエストを出すのと並行して、行き先が分かっている前提でレンダラプロセスを先回りして探す／起動する**。ただしクロスサイトのリダイレクトが起きると、この待機プロセスは使われず捨てられる。
5. **コミット**：browser process から renderer process へ **IPC（プロセス間通信）** でナビゲーションをコミットし、データストリームを渡す。**このタイミングでアドレスバー・セキュリティインジケータ（鍵アイコン等）・サイト設定 UI が新しいページの情報に更新される**。あわせて**セッション履歴が更新され、タブ／セッション復元のためディスクに保存される**。
6. **初期読み込み完了**：レンダラは**全フレームで `onload` が発火し実行が終わった後に** IPC を返し、タブのスピナー（読み込み中のくるくる）が止まる。ただし記事は「"終わった" と書いたが、**この後もクライアント側 JavaScript はリソースを読み込み、新しいビューを描画しうる**」と注意する。

〔補足〕(5) で「アドレスバーとセキュリティインジケータがコミット時に更新される」という事実は、**アドレスバーの表示とページ内容のズレ**（URL なりすまし系の UI 詐称）を考えるときの前提になる。表示更新のタイミングを握っているのは、レンダラではなく特権を持つ browser process 側である。

#### ナビゲーション時のセキュリティ判定

Chrome 公式 part 2 は、ナビゲーション時に **セキュリティ判定が集中する**ことを示す。

- **MIME タイプスニッフィング**：`Content-Type` ヘッダが欠けていたり間違っていたりしうるので、中身から型を推測する（Chromium は `net/base/mime_sniffer.cc` のコメントで "tricky business" と書く）。
- **SafeBrowsing チェック**：既知の悪性サイトに一致すれば警告ページを出す。
- **CORB（Cross Origin Read Blocking）**：**機微なクロスサイトデータがレンダラプロセスに到達しないことを保証する**ためのチェック。
- **`beforeunload`**：別サイトへ遷移する前に、現在のレンダラに `beforeunload` ハンドラがあるか確認する（「このサイトを離れますか?」の出所）。Chrome 公式は「無条件の `beforeunload` を付けるな（ナビゲーション前に必ず実行され、レイテンシが増える）」と警告する。遷移先が別サイトなら**新しいレンダラプロセス**が呼ばれる。
- **Service Worker**：ネットワークプロキシをアプリコードで書く手段。**重要なのは Service Worker がレンダラプロセスで動く JavaScript であること**。登録時にスコープが保持され、ナビゲーション時に network スレッドがドメインを登録済みスコープと照合する。一致すれば UI スレッドが SW コードを実行するレンダラプロセスを探す。
  - **Navigation Preload（ナビゲーションプリロード）**：SW の起動には時間がかかるため、**SW を起動するのと並行してリソースを先に読み込む**仕組み。このときのリクエストには専用のヘッダ（`Service-Worker-Navigation-Preload`）が付くので、**サーバ側はこのヘッダを見て内容を差し替えられる**。〔補足〕SW 起動と並行取得が走るという事実は、SW の応答とプリロード応答のどちらが使われるか、というレース的な挙動の理解につながる。

〔補足〕「SW はレンダラで動く JS」「スコープはナビゲーション時に照合される」という 2 点は、**XSS から Service Worker を登録できた場合、スコープ配下の通信を恒久的に掌握できる**という攻撃の前提そのものである。SW スクリプトの配置場所（スコープ制限）と `Service-Worker-Allowed` の扱いは、脆弱性ハンティングで必ず確認する項目である。

### 8.5 HTML のエラー耐性は「仕様化済み」——原典から明確に更新

原典は HTML のエラー耐性（不正な HTML を必ず「修復」して解釈し、"Invalid Syntax" を絶対に出さない性質）について「**驚くべきことに現行 HTML 仕様の一部ではない**」と書いていた。しかし Chrome 公式 part 3 は、**現在はエラー処理が WHATWG HTML Standard で明示的に定義されている**と述べる。「ブラウザに HTML を食わせてもエラーは投げられない」「`</p>` の閉じ忘れも妥当」「`b` が `i` より先に閉じる壊れたマークアップも仕様が優雅に処理する」と説明し、詳細は仕様の該当節を参照せよとする。

```text
エラー処理入門: https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser
パースモデル概観: https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model
```

〔補足〕**mutation XSS（mXSS）やサニタイザ回避を書くときは、必ずこの現行 WHATWG 仕様側を典拠にすること**。原典が「仕様外」と書いた時代とは状況が違う。

### 8.6 プリロードスキャナ／CSS のブロッキング／複数の木

MDN「Populating the page」と「Critical rendering path」は、パースまわりに 3 つの重要な追加をする。

1. **プリロードスキャナ（preload scanner）**：メインスレッドが DOM を作る間に内容を先読みし、CSS / JavaScript / Web フォントといった高優先度リソースを先に要求する。原典の "speculative parsing" の現代名。Chrome 公式 part 3 は「HTML パーサが生成したトークンを覗き見して `<img>`／`<link>` を見つけたら network スレッドへ要求する」と具体化する。
2. **CSS はレンダリングブロッキング**：MDN CRP は「**DOM 構築は逐次的（incremental）だが、CSSOM はそうではない**」と述べる。理由は「**後続の規則が先行の規則を上書きしうるため**、上書きされる予定のスタイルを画面に出してはいけない」から。だから**ブラウザは CSS をすべて処理し終えるまでレンダリングをブロックする**。教科書では「**HTML は段階的、CSS は全部揃うまで待つ**」と対比させると強い。なお CSS は HTML のパースは止めないが **JavaScript は止める**（JS が CSS の計算結果を問い合わせうるため）。

〔補足〕もっとも、**CSSOM の構築そのものは非常に高速**である。MDN によれば **CSSOM 構築は速すぎて DevTools には単独の項目としては現れず**、DevTools の **"Recalculate Style"** は「CSS のパース＋CSSOM 構築＋計算済みスタイルの再帰計算」を合計した時間を表示する。MDN は「**CSSOM 生成の総時間は DNS 解決 1 回より短いことが多い**」とまで述べ、最適化の優先度が低いことを示唆する。つまり「CSS がレンダリングをブロックする」のは処理が遅いからではなく、**途中の（上書きされうる）状態を画面に出さないため**という設計上の理由である。
3. **複数の木が並立する**：ブラウザは DOM・CSSOM に加えて**アクセシビリティツリー（AOM）**を作る。DOM の「意味的な版」で、支援技術からは変更できない。〔補足〕「DOM・CSSOM・レイアウトツリー・レイヤツリー・アクセシビリティツリー」と**同じ文書に複数の木が並ぶ**構図が重要。**サニタイズや防御は普通 DOM にしか作用しないが、ユーザが実際に知覚する内容は他の木を経由して決まる**。

### 8.7 レイアウトツリーと「DOM にないのに描画される内容」

Chrome 公式 part 3 は、原典のレイアウトを **layout tree** という現代名で説明する。DOM と computed style からメインスレッドが layout tree を作り、**可視のものだけ**を含む。

- **`display:none` は layout tree に入らない。`visibility:hidden` は入る**——原典 5〜6 章と一致。MDN も同じ（ユーザエージェント CSS の `script { display: none; }` が例）。**2011 年の記述が現代の公式ドキュメントでも変わらない**ことが確認できたので、教科書でこの性質は断言してよい。
- **`p::before { content: "Hi!" }` のような疑似要素の content は、DOM に存在しないのに layout tree には載る**——原典にない重要な追加。

〔補足〕この「**DOM に存在しないのに描画される内容がある**」という事実は、**DOM ベースのサニタイザや DOM を走査する防御が、ユーザが実際に見る内容を完全には把握できない**ことを意味する。CSS injection で `content` / `attr()` を使って情報を可視化・抽出したり、`::before` で偽の UI を重ねたりする手法は、この層で成立する。

### 8.8 ペイント以降——コンポジティング（原典に丸ごと欠けている層）

原典はペイントで話が終わる（レイヤは z-index の説明まで）。だが現代のブラウザには、その先に**合成（compositing）**という段がある。Chrome 公式 part 3 の流れは次のとおり。

```
layout tree
  → paint records（「まず背景、次にテキスト…」という描画手順のメモ）
  → layer tree（レイヤ＝別々に描いて後で重ねる層への分割。DevTools の "Update Layer Tree"）
  → 各レイヤをタイルに分割（タイル＝レイヤを小さく切った区画）
  → ラスタスレッドがタイルをラスタライズ → GPU メモリに格納
  → コンポジタスレッドが draw quads を集める
       （draw quads＝「どのタイルを画面のどこに描くか」を指す
         1 枚ぶんの描画指示片。タイル 1 つ＝おおよそ 1 quad）
  → compositor frame（draw quads を集めたページ 1 フレームぶんのまとまり）
  → IPC（Inter-Process Communication＝プロセス間通信）で
     browser process へ提出 → GPU → 画面
```

図の後半に出てくる **draw quads**（描画指示片）・**compositor frame**（1 フレームぶんの draw quads の集合）・**IPC**（プロセス間通信）は、いずれもレンダラで作った描画結果を browser process 経由で GPU に渡すための道具立てである。browser process 側では、ここに **UI スレッド由来（ブラウザ UI の変更）や他のレンダラプロセス由来（拡張機能）の compositor frame も合流しうる**。

- **ラスタライズ**は情報を画面のピクセルに変える処理。素朴には「ビューポート内だけラスタライズし、スクロールで足りない分を追加」する（Chrome も初期はこうだった）。
- **compositing** はページを複数レイヤに分け、**別々にラスタライズ**して、**コンポジタスレッドで 1 ページに合成**する技術。スクロールやアニメーションは、既にラスタ済みのレイヤを動かして合成するだけなので速い。
- レイヤ分割のヒントには CSS の **`will-change`** を使えるが、**レイヤが過剰だとかえって遅くなる**ので計測が必須。
- **利点はメインスレッドを介さないこと**。だから**合成だけで済むアニメーションが最もスムーズ**。レイアウトやペイントの再計算が必要になるとメインスレッドが巻き込まれる。

#### なぜ 16.67ms なのか——フレーム予算

多くのディスプレイは毎秒 60 回更新（60fps）である。ここから **1 フレームに使える時間はおよそ 16.67ms（＝1000ms ÷ 60）** と決まる。MDN はこれを **フレーム予算（frame budget）** とし、「**スムーズなスクロールやアニメーションのためには、スタイル計算・reflow・paint を含むメインスレッド上の全作業が 16.67ms 未満で終わらなければならない**」と述べる。この予算を超えるとフレームが落ち（jank）、カクつきとして知覚される。

処理量の規模感として、MDN は **iPad（解像度 2048×1536）で 300 万（3,145,000）ピクセル超**を毎フレーム描き直す例を挙げる。これだけのピクセルを 16.67ms 以内に処理するのは重く、だからこそ前述の compositing（レイヤを別々にラスタ済みにしておき、動かすときは合成だけで済ませる）が効いてくる。

#### 〔補足〕レイヤ語彙の橋渡し（原典と Chrome 公式の間）

原典（2011）は「z-index / レイヤ」までしか語らず、Chrome 公式（2018）は layer tree / タイル / compositor frame を語る。その中間を埋める語彙として、kunigami の記事（下記 📌）は **DOM Element ＞ Render Object ＞ Render Layer ＞ Graphics Layer** という 4 段の対応関係を示す。

- **Render Layer（レンダーレイヤ）**：要素の**重なりや半透明を正しい順序で合成するために存在する**論理的なレイヤ。1 つ以上の render object を含む。
- **Graphics Layer（グラフィックスレイヤ）**：**GPU で実際に描画される**レイヤ。自前の graphics layer を持つ render layer をとくに **compositing layer（合成レイヤ）** と呼ぶ。

この語彙は Chrome 公式 part 3 の layer tree / タイル / compositor frame の説明と地続きである。〔補足〕教科書としては **Chrome 公式 part 3 を主典拠**とし、この 4 段語彙は補助として扱うのが安全（公式ドキュメントのほうが新しく規範に近い）。

> ### 📌 ここは自分で開いて読んでください
> **資料**: kunigami「Notes on how browsers work」（2015-10-09） — https://kunigami.github.io/ 上の同名記事（raw: `https://raw.githubusercontent.com/kunigami/kunigami.github.io/master/blog/_posts/2015-10-09-notes-on-how-browsers-work.md`）
> **なぜ**: タイトルが codeburst 記事とほぼ同一だが、**同一文書である証拠はなく転載関係は未検証**である（別物として扱う）。それでも原典（2011）と Chrome 公式 4 部作（2018）の間を埋めるレイヤ語彙として有用。
> **読みどころ**:
> 1. レイアウトで**幅はボトムアップ（子→親）、高さはトップダウン（親→子）**で計算されるという説明（本節 1.6 と向きが逆の表現に見えるが、依存関係の見方の違い。両方の言い回しに触れておくと混乱しない）。
> 2. **DOM Element ＞ Render Object ＞ Render Layer ＞ Graphics Layer** の 4 段対応と、render layer（重なり・半透明の合成用）／graphics layer（GPU 描画）／compositing layer の区別。
> 3. レンダリングを **painting（graphics layer の中身を埋める）** と **compositing/drawing（graphics layer を 1 枚に合成する）** の 2 フェーズに分ける整理。
> **代替手段**: Chrome 公式 part 3（https://developer.chrome.com/blog/inside-browser-part3 ）。こちらのほうが新しく規範に近いので、食い違うときは公式を優先する。

### 8.9 入力イベントとヒットテスト——クリックジャッキングの実装的基礎

Chrome 公式 part 4 は入力処理を扱う。ブラウザにとって「入力」はホイールスクロール・タッチ・マウスオーバーまで含むあらゆるジェスチャである。

- **経路**：ジェスチャはまず browser process が受け取る。しかし browser process は**どこで起きたかしか知らない**（中身はレンダラの担当）。そこでイベント種別と座標をレンダラに送り、**レンダラがイベントターゲットを見つけてリスナを実行する**。
- **ヒットテスト（最重要）**：コンポジタがメインスレッドに入力を送ると、最初に走るのがヒットテストである。それは**前段で生成した paint records のデータを使って、イベントが起きた座標の下に何があるかを調べる**。

〔補足〕**これがクリックジャッキング／UI redressing の実装的な土台である**。ユーザの操作対象は「DOM 上の論理的な意味」ではなく「**その座標に paint records 上で最前面として存在するもの**」で決まる。だから透明なオーバーレイ、`opacity:0`、`z-index` の操作、`pointer-events` の設定が、攻撃と防御の両方の道具になる。原典 6 章（スタッキングコンテキストの描画順）と本節を繋げて教えるとよい。

- **Non-Fast Scrollable Region（非高速スクロール領域）**：コンポジタは、イベントハンドラが付いた領域に印を付け、その中でイベントが起きたときだけメインスレッドへ送る。`document.body` に 1 つのハンドラを付ける「イベントデリゲーション」は、**ページ全体を非高速スクロール領域にしてしまう**。緩和は `{passive: true}`、`event.cancelable` の確認、CSS の `touch-action`。
- **イベントの合体（coalescing）**：なぜ合体が要るのか。**タッチスクリーンは毎秒 60〜120 回、マウスは毎秒約 100 回イベントを届ける**のに対し、画面のリフレッシュは毎秒 60 回程度である。つまり**入力の忠実度（届く頻度）が画面更新より高い**。そこで Chrome は連続イベント（`wheel` `mousewheel` `mousemove` `pointermove` `touchmove` 等）を合体させ、次の `requestAnimationFrame` 直前までディスパッチをまとめて遅らせる。一方、離散イベント（`keydown` `keyup` `mouseup` `mousedown` `touchstart` `touchend` 等）は**即座にディスパッチ**する。
  - フレーム間で捨てられた中間座標が必要なとき（なめらかな手書き描画など）は、**`event.getCoalescedEvents()`** で合体前の個々のイベント（座標列）を取り出せる。
  - 〔補足〕「連続イベントは合体され rAF 直前まで遅延、離散イベントは即時」という差は、入力タイミングを使った計測・自動化・レース条件を考えるときの前提になる。

---

## 9. 脆弱性ハンティング視点の整理〔補足〕

ここまでの事実が、クライアントサイド脆弱性のどこに効くかを対応表にまとめる。以下は原典・公式の事実から素直に導ける観点である。

| ブラウザ内部の事実 | クライアントサイド脆弱性への含意 |
|---|---|
| `display:none` は木に載らないが `visibility:hidden` は載る | 見えない要素の可視性・計測可能性の差 → UI redressing、CSS 経由の情報漏えい |
| z-index / スタッキングコンテキストは後ろから前へ描画し最前面が隠す | **クリックジャッキング（UI redressing）の直接の土台** |
| ヒットテストは paint records を使い、座標の下の最前面を選ぶ | ユーザの操作先は「見た目」でなく「描画上の最前面」で決まる → 透明オーバーレイ攻撃 |
| `offsetHeight` 等のアクセスが同期レイアウトを強制 | レンダリング時間差を測る**タイミング副チャネル**の前提 |
| `::before` の content は DOM にないのに layout tree に載る | DOM ベースのサニタイザ／防御が実際の表示を把握しきれない → CSS injection |
| HTML のエラー耐性は現在 WHATWG 仕様で規範化 | mXSS／サニタイザ回避は現行仕様を典拠にすべき |
| Chrome はクロスサイト iframe ごとに別プロセス（Site Isolation） | プロセス境界＝最後の防衛線。XS-Leaks / Spectre 系の議論の入口 |
| 最初の 14KB / slow start | 「最初の 1 パケットに何が載るか」がタイミング副チャネルで観測されうる |
| Service Worker はレンダラで動く JS、スコープはナビゲーション時に照合 | XSS から SW を登録できればスコープ配下の通信を恒久掌握しうる |

---

## 10. 原典（2011）と現代（2018〜）の差分マップ

教科書で「どこを古典として読み、どこを更新して書くか」を判断するための対応表。

| 論点 | 原典（2011） | 現代の公式ドキュメント | 教科書での扱い |
|---|---|---|---|
| プロセス境界 | Chrome はタブごとに 1 プロセス | **Site Isolation**：クロスサイト iframe ごとに別レンダラ。Chrome 67 から既定。動機に SOP と Meltdown/Spectre | **更新必須**。XS-Leaks / Spectre 章への導入にする |
| スレッド | 単一のレンダリングスレッド＋並列ネットワーク | メイン / ワーカ / コンポジタ / ラスタスレッド | 「メインスレッドが 1 本」と言い換える |
| 取り込み単位 | 8KB チャンク | 最初のチャンクは通常 **14KB**、CWND は 1/2/4/10 MSS | 数値は 14KB を採用し 8KB は歴史として併記 |
| 投機的パース | speculative parsing | **preload scanner** | 現代名で書き原典名を括弧添え |
| HTML エラー耐性 | 「現行 HTML 仕様の一部ではない」 | **WHATWG HTML Standard が明示的に定義** | **更新必須**。仕様の該当節へリンク |
| render tree | Render Tree / RenderObject（WebKit）、Frame tree / Frame（Gecko） | **layout tree** ＋ **layer tree** が層として増える | 用語の歴史を整理し以降は layout tree / layer tree を使う |
| DOM と描画の非対応 | `display:none` は載らない / `visibility:hidden` は載る | **同じ**＋ **`::before` の content は DOM にないが layout tree に載る** | 疑似要素を追加して完全版に |
| ペイント以降 | painting で終了 | **paint records → layer tree → タイル → ラスタ → GPU → draw quads → compositor frame** | **丸ごと追加が必要な層** |
| 入力処理 | イベントループの記述のみ | browser process が座標を受け取りレンダラへ。**ヒットテストは paint records を使う** | **丸ごと追加**。クリックジャッキング章の裏付け |
| ネットワーク | ホストあたり 2〜6 本 | DNS → TCP → TLS で**計 8 往復**、MIME スニッフィング、SafeBrowsing、**CORB** | ナビゲーション節を新設 |
| CSS の扱い | スタイルシートがスクリプトをブロックしうる | **CSS はレンダリングブロッキング。CSSOM は逐次的でない** | 「HTML は段階的 / CSS は全部揃うまで」の対比で提示 |

---

## 手を動かす

以下は**自分で立てた検証環境や、許可されたバグバウンティ対象・自分のブラウザ**でのみ行うこと。

1. **同期レイアウトを体感する**：Chrome の DevTools を開き（F12）、Performance タブで記録を開始する。次のコードをコンソールで実行し、記録を止めて "Layout"（または "Recalculate Style"）が何回出るか見る。

   ```javascript
   // 悪い例：読み取りと書き込みを交互にやってレイアウトを強制する
   const boxes = document.querySelectorAll('div');
   for (const b of boxes) {
     const w = b.offsetWidth;   // ← ここで同期レイアウトが強制される
     b.style.width = (w + 10) + 'px';
   }
   ```

2. **描画順とヒットテストを観察する**：次の HTML を自分のローカルに保存して開く。緑のボタンの上に透明な赤い div を重ねてある。緑を「クリックしたつもり」で実際に発火するのはどちらかを確かめる。

   ```html
   <button onclick="alert('緑が発火')" style="position:absolute;left:50px;top:50px;">緑ボタン</button>
   <div onclick="alert('透明な赤が発火')"
        style="position:absolute;left:50px;top:50px;width:120px;height:40px;
               background:red;opacity:0;z-index:10;"></div>
   ```

   `z-index:10` の透明な div が最前面にあるので、ヒットテストはこちらを選ぶ。これがクリックジャッキングの最小再現である。

3. **レイヤと合成を見る**：DevTools の「その他のツール」→ **Layers** パネル、または Rendering パネルの "Layer borders" を有効にする。`will-change: transform` を付けた要素が別レイヤに分離される様子を確認する。

4. **Site Isolation を確認する**：`chrome://process-internals` を開き、クロスサイト iframe を含むページで、iframe が別プロセス（別 SiteInstance）に割り当てられているか見る。

5. **エラー耐性を試す**：`<b><i>test</b></i>` のような壊れた HTML をローカルファイルで開き、DevTools の Elements タブで**ブラウザがどう修復したか**を見る。これが mXSS の出発点になる（詳細は後のパース／XSS 章）。

---

## つまずきポイント

- **「レイアウト」と「reflow」は別物ではない**。同じ処理の別名（WebKit は layout、Gecko は reflow）。MDN 流に言えば「最初の 1 回が layout、以降が reflow」。
- **`visibility:hidden` は木に載る／`display:none` は載らない**を逆に覚えやすい。`visibility:hidden` は「場所は取るが見えない」ので載る、と覚える。
- **`::before` の content は DOM に存在しない**。DOM を `querySelectorAll` で走査しても出てこないが、画面には出る。DOM ベースの検査だけでは見落とす。
- **「ブラウザはシングルスレッド」は不正確**。正確には「メインスレッドが 1 本」。コンポジタ・ラスタ・ワーカは別スレッド。
- **原典の「HTML エラー耐性は仕様外」は 2011 年の話**。現在は WHATWG 仕様で規範化済み。古い記述をそのまま引用しないこと。
- **8KB は古い値**。現代の「最初のチャンク」は通常 14KB。
- **クリックジャッキングは「見た目」ではなく「描画上の最前面」で決まる**。透明でも最前面ならクリックはそちらへ行く。

---

## この節のまとめ

- レンダーツリーができたあと、ブラウザは**レイアウト（reflow）**で各要素の位置と大きさを計算する。幅は親から子へ、高さは子から親へ伝わる。
- レイアウトには**ダーティビットシステム**があり、触られた部分（dirty）だけを効率よく再計算する。増分レイアウトは非同期、グローバルレイアウトは同期が基本。
- **`offsetHeight` などを読むと同期レイアウトが強制される**。これは性能問題であり、同時にタイミング副チャネルの土台である。
- **ペイント**はレンダーツリーを走査してピクセルにする。CSS2 が定める描画順は「**後ろから前へ、最前面が背後を隠す**」。
- **z-index とスタッキングコンテキスト**が奥行きの描画順を決める。これがクリックジャッキング／UI redressing の核心。
- ブラウザのメインスレッドは**無限のイベントループ**であり、重い JavaScript がここを占有するとページが固まる。
- 原典（2011）は「単一レンダリングスレッド、ペイントで終わり」というモデルだが、**現代は更新が必要**。
- 現代の Chrome は**マルチプロセス**で、**Site Isolation** によりクロスサイト iframe ごとに別レンダラに分離する（Chrome 67 から既定、動機に SOP と Spectre）。
- スレッドは 1 本でなく、**メイン / ワーカ / コンポジタ / ラスタ**に分かれる。ペイントの先に**合成（compositing）**の段がある。
- **HTML のエラー耐性は現在 WHATWG 仕様で規範化**されている（原典は「仕様外」と書いていた）。mXSS はこの現行仕様を典拠にする。
- **`::before` の content は DOM にないのに描画される**。DOM ベースの防御には死角がある。
- 入力処理では**ヒットテストが paint records を使い、座標の下の最前面を選ぶ**。これがクリックジャッキングの実装的基礎。
- ナビゲーションは **browser process 主導**で進み、応答を待つ間にレンダラを先回り確保し、コミット時にアドレスバー／セキュリティインジケータを更新してセッション履歴をディスクに保存し、全フレーム `onload` 後に IPC を返してスピナーを止める。
- ナビゲーションでは MIME スニッフィング・SafeBrowsing・**CORB**・`beforeunload`・Service Worker の照合が働く。SW はレンダラで動く JS で、**Navigation Preload** は SW 起動と並行取得を行う。
- なめらかな描画には **16.67ms のフレーム予算**（60fps）を守る必要があり、iPad(2048×1536)＝300 万ピクセル超を毎フレーム描き直すのは重い。だから合成（compositing）が効く。
- **TTFB は「サーバが返し始めた速さ」、TTI は「ユーザが触れるようになった時点（FCP 後＋操作に 50ms 以内で応答）」**で、別物である。
- 差分マップを使い、「古典として読む部分」と「現代の公式で更新する部分」を分けて書くこと。

---

## 理解度チェック

1. レイアウト（reflow）で、幅と高さはそれぞれどちら向き（親→子 / 子→親）に伝わるか。
   ▶ 答え：幅は親→子（親が自分の幅を先に決め、その中に子を並べる）。高さは子→親（子の高さの合計から親の高さが決まる）。

2. `display:none` と `visibility:hidden` は、レンダーツリー（layout tree）に載るか載らないか。
   ▶ 答え：`display:none` は載らない（ボックスを生成しない）。`visibility:hidden` は載る（場所を占めるから）。この性質は 2011 年の原典と現代の公式ドキュメントで一致している。

3. `offsetHeight` を読むと何が起きるか。それがセキュリティ上なぜ重要か。
   ▶ 答え：本来は非同期に貯めておくはずの増分レイアウトが**同期的に強制実行**される。所要時間が中身に依存すると、**タイミング副チャネル**による情報漏えいの手がかりになる。

4. CSS2 が定めるブロック要素の描画順と、「後ろから前へ」の原則を説明せよ。
   ▶ 答え：background color → background image → border → children → outline の順。スタックは後ろの要素を先に描き、前の要素を上に重ねるので、最前面が背後を隠す。

5. z-index が高い要素は、マークアップ上で先にあっても後にあっても、描画上どうなるか。原典の例で説明せよ。
   ▶ 答え：赤 div（z-index:3）はマークアップ上で緑 div（z-index:1）より先にあり通常フローなら下に描かれるはずだが、z-index が高いのでスタックの前方に来て緑の手前に描かれる。

6. 「ブラウザはシングルスレッド」という言い方はどう修正すべきか。現代の renderer process のスレッドを挙げよ。
   ▶ 答え：「メインスレッドが 1 本」と言い換える。renderer process はメイン / ワーカ / コンポジタ / ラスタスレッドを持つ。

7. Site Isolation とは何か。動機として挙げられている 2 つの要素は何か。デスクトップでいつから既定か。
   ▶ 答え：クロスサイト iframe ごとに別レンダラプロセスを走らせる機能。動機は Same-Origin Policy（の回避が攻撃目的であること）と Meltdown/Spectre。デスクトップは Chrome 67 から既定。

8. 原典が「HTML 仕様の一部ではない」と書いたエラー耐性は、現在どうなっているか。mXSS を書くときの典拠はどちらか。
   ▶ 答え：現在は WHATWG HTML Standard で明示的に定義（規範化）されている。mXSS／サニタイザ回避は現行 WHATWG 仕様を典拠にする。

9. 入力イベントのヒットテストは何を使って、何を決めるか。それがクリックジャッキングとどう関係するか。
   ▶ 答え：前段で生成した paint records を使い、イベント座標の下にある最前面の要素（＝ターゲット）を決める。操作対象が「見た目の意味」でなく「描画上の最前面」で決まるので、透明なオーバーレイや z-index 操作でクリックを盗める。

10. `p::before { content: "Hi!" }` の content は DOM に存在するか。それは防御上どんな死角を生むか。
    ▶ 答え：DOM には存在しない（`querySelectorAll` 等では見えない）が、layout tree には載り画面に描画される。DOM を走査する防御やサニタイザは、ユーザが実際に見る内容を完全に把握できない。

11. ナビゲーションは browser process 主導で進む。(a) レンダラプロセスはいつ確保されるか、(b) コミット時に何が更新されるか、を答えよ。
    ▶ 答え：(a) ネットワークリクエストを出すのと**並行して先回りで**確保される（クロスサイトのリダイレクトが起きると捨てられる）。(b) アドレスバー・セキュリティインジケータ・サイト設定 UI が新ページの情報に更新され、セッション履歴がディスクに保存される。

12. なめらかなスクロール／アニメーションのためにメインスレッド作業が収まるべき時間は何 ms か。その数字の根拠は何か。
    ▶ 答え：約 16.67ms。多くのディスプレイが 60fps（毎秒 60 回更新）で、1000ms ÷ 60 ≒ 16.67ms が 1 フレームの予算になるため。

13. 連続イベントと離散イベントの扱いはどう違うか。フレーム間の中間座標を取る API は何か。
    ▶ 答え：連続イベント（`mousemove` `touchmove` 等）は合体され次の `requestAnimationFrame` 直前までまとめて遅延、離散イベント（`keydown` `mouseup` 等）は即時ディスパッチ。中間座標は `event.getCoalescedEvents()` で取得できる。

---

## 出典

- Tali Garsiel & Paul Irish, “How browsers work: behind the scenes of modern web browsers”（2011-08-05）: https://raw.githubusercontent.com/webplatform/docs/HEAD/concepts/Internet_and_Web/how_browsers_work/index.md
- vasanthk, “How Web Works”（二次資料）: https://raw.githubusercontent.com/vasanthk/how-web-works/HEAD/README.md
- MDN “Populating the page: how browsers work”: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work
- MDN “Critical rendering path”: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path
- Chrome 公式 “Inside look at modern web browser” part 1〜4（Mariko Kosaka, 2018）: https://developer.chrome.com/blog/inside-browser-part1
- WHATWG HTML Standard「エラー処理入門」: https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser
- WHATWG HTML Standard「パースモデル概観」: https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model
- kunigami, “Notes on how browsers work”（2015-10-09・同名の別記事、関係は未検証）: https://kunigami.github.io/
- 元記事（取得不能）: https://codeburst.io/how-browsers-work-6350a4234634

<!-- self-read: https://codeburst.io/how-browsers-work-6350a4234634 | エグレス許可リストで codeburst.io/medium.com への接続が組織ポリシー拒否され本文を1文字も取得できず。原典と公式資料で代替 -->
<!-- self-read: https://kunigami.github.io/ | codeburst記事と同名だが同一文書か未検証の別記事。原典(2011)とChrome公式(2018)の間を埋めるレイヤ語彙(DOM Element>Render Object>Render Layer>Graphics Layer)として読者に一次確認を促す -->

<!-- sources: https://codeburst.io/how-browsers-work-6350a4234634, https://raw.githubusercontent.com/webplatform/docs/HEAD/concepts/Internet_and_Web/how_browsers_work/index.md, https://raw.githubusercontent.com/vasanthk/how-web-works/HEAD/README.md, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path, https://developer.chrome.com/blog/inside-browser-part1, https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser, https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model, https://kunigami.github.io/ -->
<!-- terms: レイアウト, リフロー, ダーティビット, 増分レイアウト, グローバルレイアウト, 同期レイアウト, レイアウトスラッシング, 置換要素, ペイント, スタッキングコンテキスト, z-index, ボックスモデル, ポジショニング方式, イベントループ, ビューポート, Site Isolation, Servicification, コンポジタスレッド, ラスタスレッド, compositing, フレーム予算, layout tree, layer tree, paint records, draw quads, compositor frame, IPC, Render Layer, Graphics Layer, ヒットテスト, preload scanner, CORB, MIMEスニッフィング, Service Worker, Navigation Preload, getCoalescedEvents, クリックジャッキング, UIredressing, タイミング副チャネル, アクセシビリティツリー, CSSOM, TTFB, TTI, TCPスロースタート, WHATWG HTML Standard -->
