# レンダリングの後半戦 ― レイアウト・描画・視覚モデルと、古典記事を現代の実装で読み直す

> **この節で分かること**
> - レイアウト（reflow）が「フローベースの再帰的プロセス」としてどう動くか、なぜ dirty bit で差分化するのかを説明できる
> - `offsetHeight` のようなスクリプト読み取りがなぜ同期レイアウトを強制するのか、それがレンダリング時間ベースのサイドチャネルの土台になる理由を説明できる
> - 描画順序（背景色→背景画像→ボーダー→子→アウトライン）と stacking context / z-index の仕組みを理解し、クリックジャッキングの診断に結びつけられる
> - CSS2 の視覚モデル（canvas・ボックスモデル・配置スキーム・ボックス型）を自分の言葉で説明できる
> - この古典記事（2011/2013）のどこが今でも有効で、どこが古びているかを見分け、MDN・Chrome の現行公式資料で補える
> - 記事の各記述が、mXSS・DOM clobbering・クリックジャッキング・サイドチャネルといったクライアントサイド脆弱性のどこに接続するかを言える

**元資料**: https://www.html5rocks.com/tutorials/internals/howbrowserswork/ （現行版 https://web.dev/articles/howbrowserswork ）（原典取得済み ― GitHubミラー経由で本文・コード・図キャプションを全文取得。ただし記事本体URL・図の画像・現代版の公式ホストは当執筆環境からは直接取得できず、二次的に確認した）
**関連する節**: 05a（本記事の前半 ― ブラウザ構造・HTMLパース・DOM・CSSパース・スタイル計算）。本節はその続きで、レンダリングパイプラインの後半（レイアウト以降）と、記事全体を現代の実装で読み直す視点を扱う。

---

## 0. この節の位置づけ

この記事「How Browsers Work」は、レンダリングエンジンの動作を「HTMLパース → DOM → スタイルデータのパース → render tree 構築 → layout（位置決め） → painting（描画）」という段階的（gradual）な流れとして説明する古典である。前半（05a）でパースとスタイル計算までを追った。

本節（05b）は、その続きである **layout（レイアウト）→ painting（描画）→ CSS2 の視覚モデル** を扱う。そのうえで、この記事が **2011年に書かれ2013年頃に更新された古典**であることをふまえ、今の実装とどこが違うのかを、MDN と Chrome の現行公式資料で補う。

〔補足〕本記事は著者 Tali Garsiel（イスラエルの開発者）が自分のサイトで公開した研究を、html5rocks 編集部（Paul Irish ら）が整理して再掲したものである。html5rocks.com はすでに閉鎖され、現在の正本は web.dev 側にある。

Tali Garsiel は 2000年に Web 開発を始め、Netscape の "evil"（悪名高い）レイヤモデルに出会ったのがきっかけだったという。物理学者 Richard Feynmann と同じく「物事の仕組みを解明すること」に魅せられ、公開されている全データをレビューしブラウザのソースコードを大量に読んで、ブラウザ内部を掘り下げた（原文の著者略歴による）。この研究はもともと著者個人サイト `http://taligarsiel.com/` で公開され、html5rocks / web.dev 版はそれを編集して再掲した二次掲載である（Preface に "Tali published her research on her site … we've cleaned it up and republished it here." と明記）。原初の出典は著者サイトであり、注記番号や出典URLをたどるときはこの出自を念頭に置くとよい。

〔補足〕Preface で Tali は「IE が 90% を支配していた年月にはブラウザを『ブラックボックス』とみなすしかなかったが、今やオープンソースブラウザが利用シェアの半分以上を持つようになった」と述べ、この「半分以上」という主張には原文でリンクが張られている。リンク先は `http://techcrunch.com/2011/08/01/open-web-browsers/`（TechCrunch, 2011-08-01）で、これが「オープンソースブラウザがシェア半分超」という数字の根拠である。ただし 2011年時点のスナップショットなので、現在のシェアとしては引用してはならない。

---

## 1. レイアウト（layout / reflow）

### 1.1 なぜレイアウトという段階があるのか

render tree（描画対象のツリー）に renderer（描画されるノード）が作られてツリーに追加されたとき、**その renderer はまだ位置とサイズを持っていない**。画面のどこに、どれだけの大きさで置くかは、まだ決まっていない。

この位置とサイズを計算する処理を **レイアウト（layout）**、Firefox（Gecko）の用語では **リフロー（reflow）** と呼ぶ。DOM とスタイルが揃っただけでは画面は描けない。「どこに何を置くか」を決めるこの段階が、描画の直前に必要になる。

### 1.2 どう動くのか ― フローベースの再帰プロセス

HTML は **フローベースのレイアウトモデル（flow based layout model）** を使う。フローベースとは、要素が文書の流れに沿って上から下・左から右へ並ぶモデルのこと。ほとんどの場合、幾何情報を **1パス（一度の走査）** で計算できる。

なぜ1パスで済むかというと、「フローの後方」の要素は典型的に「フローの前方」の要素の幾何に影響しないからである。だからレイアウトは文書を左から右、上から下へと一方向に進められる。例外もある。たとえば HTML の `table` は複数パスを必要とすることがある（この一文には原典で注記 (3.5)＝Chris Waterson "Notes on HTML Reflow" が付いている ― 「table が複数パスを要する」という主張の一次文献）。

レイアウトは **再帰的なプロセス**である。座標系はルート frame に対する相対で、`top` と `left` の座標が使われる。

```text
Layout の再帰
  ルート renderer（<html> に対応, 位置 0,0, 寸法 = viewport）
    └─ layout() を呼ぶ
         └─ 各子 renderer の layout() を呼ぶ
              └─ さらにその子の layout() を呼ぶ …
```

- ルート renderer の位置は 0,0、その寸法は **viewport**（ブラウザウィンドウの可視部分）である。
- すべての renderer は "layout"（または "reflow"）メソッドを持ち、各 renderer は「レイアウトを必要とする子」の layout メソッドを呼ぶ。

### 1.3 dirty bit 方式 ― 変更を差分で扱う

**設計意図**: 小さな変更のたびにツリー全体を再レイアウトしていたら遅すぎる。そこでブラウザは **dirty bit 方式**を使う。dirty bit とは、「ここは計算し直す必要がある」という印を立てるフラグのこと。変更・追加された renderer は、自分自身と自分の子を "dirty"（レイアウトが必要）とマークする。

フラグは2種類ある。

| フラグ | 意味 |
| --- | --- |
| **"dirty"** | この renderer 自身がレイアウトを必要とする |
| **"children are dirty"** | renderer 自身は問題ないかもしれないが、レイアウトを必要とする子が少なくとも1つある |

この2フラグで、「自分を直す必要がある」ノードと「子孫のどこかを直す必要があるので通り道になる」ノードを区別し、無関係な枝の再計算を避ける。

### 1.4 グローバルレイアウトと増分レイアウト

レイアウトは render tree 全体に対してトリガされることがある。これを **グローバルレイアウト（global layout）**と呼ぶ。起こる典型例は次の2つ。

1. すべての renderer に影響するグローバルなスタイル変更（フォントサイズの変更など）の結果として
2. 画面がリサイズされた結果として

一方、レイアウトは **増分（incremental）**にもなりうる。dirty な renderer だけがレイアウトされる（ただしこれは「damage（波及）」を引き起こし、追加のレイアウトが必要になることがある）。

増分レイアウトは renderer が dirty になったときに **非同期に** トリガされる。たとえば、ネットワークから追加コンテンツが届いて DOM ツリーに追加され、新しい renderer が render tree に加わったときである。

```text
Incremental layout
  変更なしの枝 ── そのまま（再計算されない）
  dirty な renderer ──┐
      └─ その子だけがレイアウトされる（注記 (3.6)）
```

### 1.5 非同期レイアウトと同期レイアウト ★重要

ここは診断で最も効く箇所である。

- **増分レイアウトは非同期に行われる。** Firefox は増分レイアウトのための "reflow commands" をキューに入れ、スケジューラがこれらのコマンドのバッチ実行をトリガする。WebKit も増分レイアウトを実行するタイマを持ち、ツリーを走査して dirty な renderer をレイアウトする。
- **`offsetHeight` のようにスタイル情報を要求するスクリプトは、増分レイアウトを同期的にトリガできる。** つまり、本来はまとめて後で処理されるはずのレイアウトが、スクリプトがサイズを問い合わせた瞬間に「今すぐ計算しろ」と強制される。
- グローバルレイアウトは通常同期的にトリガされる。
- スクロール位置のような一部の属性が変わったため、初期レイアウトの後にコールバックとしてレイアウトがトリガされることもある。

**攻撃者はどこを突くのか**: この「スクリプトによる同期レイアウト強制」は、パフォーマンスの世界では **layout thrashing（強制同期レイアウト）** と呼ばれ、Web性能診断の中心概念である。同時に、レイアウトや描画にかかる **計測時間の差**を利用したクライアントサイドの **サイドチャネル**（レンダリングにかかる時間の違いから、直接は読めないはずの状態を推測する手法）の技術的土台にもなる。原典はパフォーマンスの文脈でしか述べていないが、「特定の要素をレイアウトさせると時間がかかる／かからない」という差が観測できるなら、それが情報の漏れ口になりうる、という発想につながる。

〔補足〕具体的に何が観測でき、何が推測されるのかを一例で示す。攻撃者のページに、状態によってレイアウトコストが変わる要素を置く。`requestAnimationFrame` の間隔や `performance.now()` で「1フレーム描くのにかかった時間」を測ると、**攻撃者が測れるのは所要ミリ秒だけ**だが、その大小から**本来は直接読めないはずの状態**を推測できる。

- **`:visited`（訪問履歴の漏洩）**: リンクが訪問済みだと `:visited` のスタイルが適用され、大量のリンクを一斉に再スタイル・再レイアウトさせると、訪問済みリンクが多いほど処理時間が延びる。時間差から「そのユーザがそのURLを訪れたか」を推測する。ブラウザは `getComputedStyle` で `:visited` の色を読めなくする対策を入れたが、レンダリング時間という間接ルートが残った、という歴史がある。
- **XS-Leaks（クロスサイト漏洩）**: 別オリジンのページを `<iframe>` で埋め込み、その中身の量やレイアウトの重さの差を描画時間として観測し、「検索結果が0件か1件以上か」「ログイン済みか否か」といった1ビットを推測する手法群。

いずれも「レイアウト／描画にかかる時間の差＝情報の漏れ口」という、この節の `offsetHeight` 同期レイアウトと地続きの発想である。後方参照として後の章で詳しく扱う。原典はパフォーマンスの文脈しか書いていない。

### 1.6 レイアウトプロセスの手順

レイアウトは通常、次のパターンで進む。

1. 親 renderer が自分自身の幅を決定する。
2. 親が子を順に処理し、
   1. 子 renderer を配置する（x と y を設定する）。
   2. 必要なら子の layout を呼ぶ（子が dirty、グローバルレイアウト中、その他の理由のとき）。これが子の高さを計算する。
3. 親は子の累積高さと margin・padding の高さを使って自分自身の高さを設定する。これが親 renderer のさらに親によって使われる。
4. 自分の dirty bit を false に設定する。

Firefox はレイアウト（reflow）のパラメータとして "state" オブジェクト（`nsHTMLReflowState`）を使い、この state は親の幅などを含む。レイアウトの出力は "metrics" オブジェクト（`nsHTMLReflowMetrics`）で、renderer の計算された高さを含む。

### 1.7 幅の計算 ★重要

renderer の幅は、コンテナブロックの幅、renderer のスタイル `width` プロパティ、margin、border を使って計算される。たとえば次の div の幅（原文のまま）:

```html
<div style="width: 30%"/>
```

WebKit では次のように計算される（`RenderBox` クラスのメソッド `calcWidth`）。

- コンテナ幅は、コンテナの `availableWidth` と 0 の最大値。この場合の `availableWidth` は `contentWidth` で、次のように計算される（原文のまま）:

```text
clientWidth() - paddingLeft() - paddingRight()
```

`clientWidth` と `clientHeight` はオブジェクトの内側（border とスクロールバーを除く）を表す。

- 要素の幅は `width` スタイル属性。これはコンテナ幅のパーセンテージを計算することで絶対値になる。
- 次に水平の border と padding が加算される。

ここまでが **preferred width（優先幅）** の計算。その後、最小幅と最大幅が計算される。

- preferred width が maximum width より大きければ maximum width が使われる。
- minimum width（最小の分割不可能な単位, the smallest unbreakable unit）より小さければ minimum width が使われる。

レイアウトが必要だが幅が変わらない場合のために、値はキャッシュされる。

### 1.8 改行

レイアウトの途中で renderer が「改行が必要だ」と判断したとき、その renderer は停止し、改行が必要であることをレイアウトの親に伝播する。親が余分な renderer を作り、それらに対してレイアウトを呼ぶ。

### 1.9 最適化

- レイアウトが "resize" または renderer の位置（サイズではなく）の変更でトリガされた場合、renderer のサイズはキャッシュから取られ、再計算されない。
- 一部のケースではサブツリーだけが変更され、レイアウトはルートから始まらない。変更がローカルで周囲に影響しない場合（テキストフィールドに挿入されたテキストのように）に起こる。そうでなければキーストロークごとにルートからレイアウトがトリガされてしまう。

---

## 2. 描画（painting）

### 2.1 描画とは何をするのか

描画（painting）段階では、render tree が走査され、各 renderer の `paint()` メソッドが呼ばれてコンテンツを画面に表示する。描画は UI インフラストラクチャコンポーネント（OS が提供する描画基盤）を使う。

レイアウトと同様、描画も **グローバル**（ツリー全体が描画される）または **増分的**になりうる。

増分描画では、一部の renderer がツリー全体に影響しない形で変更される。変更された renderer は画面上の自分の矩形を **無効化（invalidate）**する。これにより OS はそこを "dirty region" と見なし、"paint" イベントを生成する。OS は賢くやり、複数の領域を1つに合体（coalesce）させる。

Chrome ではもっと複雑で、renderer がメインプロセスとは別のプロセスにあるため、Chrome はある程度 OS の振る舞いをシミュレートする。presentation はこれらのイベントをリッスンし、メッセージを render root に委譲する。ツリーは該当の renderer に到達するまで走査され、その renderer が自分自身（と通常はその子）を再描画する。

### 2.2 描画順序 ★重要

CSS2 が描画プロセスの順序を定義している（`http://www.w3.org/TR/CSS21/zindex.html`）。これは実際には、要素が stacking context 内で積まれる順序である。この順序が描画に影響する。なぜなら、スタックは **奥から手前へ（from back to front）** 描画されるからである。

ブロック renderer の描画順（積み順）は次のとおり。

| 順序 | 描画対象 |
| --- | --- |
| 1 | background color（背景色） |
| 2 | background image（背景画像） |
| 3 | border（ボーダー） |
| 4 | children（子） |
| 5 | outline（アウトライン） |

つまり、まず背景色を塗り、その上に背景画像、ボーダー、子要素、最後にアウトラインの順で重ねていく。

### 2.3 実装ごとの最適化

- **Firefox の display list**: Firefox は render tree を走査し、描画される矩形のための display list を構築する。これは、その矩形に関連する renderer を正しい描画順（renderer の背景、次にボーダー等）で含む。こうすると、再描画のためにツリーを1回だけ走査すればよくなる。すべての背景を描画し、次にすべての画像、次にすべてのボーダー…と何度も走査する代わりに、である。さらに Firefox は、隠れる要素（不透明な要素の完全に下にある要素など）を追加しないことで最適化する。
- **WebKit の矩形保存**: 再描画の前に、WebKit は古い矩形をビットマップとして保存する。そして新しい矩形と古い矩形の差分（delta）だけを描画する。

### 2.4 動的変更への応答 ★重要

ブラウザは変更に応じて、可能な限り最小の動作をしようとする。何を変えると何が起きるかを整理すると次のようになる。

| 変更 | 引き起こされる処理 |
| --- | --- |
| 要素の色の変更 | その要素の repaint（再描画）のみ |
| 要素の位置の変更 | その要素、その子、そしておそらく兄弟の layout と repaint |
| DOMノードの追加 | そのノードの layout と repaint |
| 大きな変更（`html` 要素のフォントサイズを大きくする等） | キャッシュの無効化、ツリー全体の relayout と repaint |

色を変えるだけなら再描画1回で済むが、位置を動かすと周囲まで巻き込む、という違いは、性能診断でも攻撃の時間差観測でも意味を持つ。

### 2.5 スレッドとイベントループ ★重要

**レンダリングエンジンはシングルスレッド**である。ネットワーク操作を除いて、ほとんどすべてが単一スレッドで起こる。Firefox と Safari ではこれはブラウザのメインスレッド、Chrome ではタブプロセスのメインスレッドである。

ネットワーク操作は複数の並列スレッドで実行できるが、並列コネクション数は制限される（通常 2〜6 コネクション）。

ブラウザのメインスレッドは **イベントループ**である。イベントループとは、プロセスを生かし続ける無限ループのこと。レイアウトや paint のイベントを待って処理し続ける。これがメインイベントループの Firefox コード（原文のまま）:

```js
while (!mExiting)
    NS_ProcessNextEvent(thread);
```

〔重要な注意〕この「シングルスレッド」という記述は 2011/2013 年時点のものであり、現代の Chromium ではもはや正確ではない。詳しくは第6節で補う。

---

## 3. CSS2 の視覚モデル

ここまでのレイアウト・描画は、CSS2 が定義する「視覚整形モデル」の上に成り立っている。その骨組みを押さえる。

### 3.1 canvas（キャンバス）

CSS2 仕様（`http://www.w3.org/TR/CSS21/intro.html#processing-model`）によれば、**canvas** という用語は「整形構造がレンダリングされる空間（the space where the formatting structure is rendered）」、つまりブラウザがコンテンツを描画する場所を指す。

canvas は空間の各次元で無限だが、ブラウザは viewport の寸法に基づいて初期幅を選ぶ。`www.w3.org/TR/CSS2/zindex.html` によれば、canvas は他の canvas に含まれる場合は透明であり、含まれない場合はブラウザが定義した色が与えられる。

〔補足〕ここでいう canvas は CSS の描画空間の概念であり、HTML の `<canvas>` 要素とは別物である。

### 3.2 CSS ボックスモデル

CSS ボックスモデル（`http://www.w3.org/TR/CSS2/box.html`）は、文書ツリー内の要素に対して生成され、視覚整形モデルに従ってレイアウトされる矩形ボックスを記述する。

各ボックスは **content area（コンテンツ領域。テキスト、画像等）** と、任意の周囲の **padding、border、margin** の領域を持つ。

各ノードは 0〜n 個のそのようなボックスを生成する。すべての要素は `display` プロパティを持ち、生成されるボックスの型を決める。例（原文のまま）:

```text
block: generates a block box.
inline: generates one or more inline boxes.
none: no box is generated.
```

デフォルトは inline だが、ブラウザのスタイルシートが他のデフォルトを設定することがある。たとえば `div` 要素のデフォルト display は block である（デフォルトスタイルシートの例: `www.w3.org/TR/CSS2/sample.html`）。

〔補足〕`display: none` はボックスを生成しないので render tree に載らない。これは前半（05a）で扱った「render tree に載る／載らない要素」の話とつながる。「存在するのに描かれない要素」は隠しフィールドやオフスクリーン要素の調査で意味を持つ。

### 3.3 配置スキーム ★重要

要素の置き方には3つのスキーム（方式）がある。

| # | スキーム | 内容 |
| --- | --- | --- |
| 1 | Normal | オブジェクトは文書内の位置に従って配置される。render tree 内の位置が DOM tree 内の位置と同じで、ボックス型と寸法に従ってレイアウトされる |
| 2 | Float | オブジェクトはまず通常フローのようにレイアウトされ、その後できるだけ左または右に移動される |
| 3 | Absolute | オブジェクトは DOM tree とは異なる場所に render tree に置かれる |

配置スキームは `position` プロパティと `float` 属性で設定される。

- `static` と `relative` は normal flow を引き起こす
- `absolute` と `fixed` は absolute positioning を引き起こす

`static` 配置では位置が定義されず、デフォルトの配置が使われる。他のスキームでは著者が位置（`top`, `bottom`, `left`, `right`）を指定する。

ボックスがレイアウトされる方法は次の4つで決まる。

- Box type（ボックス型）
- Box dimensions（ボックス寸法）
- Positioning scheme（配置スキーム）
- 画像サイズや画面サイズのような外部情報（External information such as image size and the size of the screen）

### 3.4 ボックスの型

- **Block box（ブロックボックス）**: ブロックを形成する。ブラウザウィンドウ内に自分自身の矩形を持つ。
- **Inline box（インラインボックス）**: 自分自身のブロックを持たないが、containing block（内包ブロック）の内側にある。

ブロックは垂直に次々と整形され、インラインは水平に整形される。インラインボックスは行（lines / "line boxes"）の内側に置かれる。行は少なくとも最も高いボックスと同じ高さだが、ボックスが "baseline"（ベースライン）で揃えられる場合はもっと高くなりうる。

ここで **baseline 揃え（baseline alignment）** とは、原文の定義によれば「ある要素の下部（bottom）が、別のボックスの下部**以外**の点に揃えられること」を指す。たとえば大きい文字と小さい文字が並ぶとき、両者は文字の「足元のライン」で揃うのであって、行の底で揃うわけではない。揃える基準線がボックスの底とずれるため、行はいちばん高いボックスの高さより余白の分だけ高くなりうる、というわけである。これが「行がもっと高くなりうる」理由である。

コンテナ幅が足りなければインラインは複数行に配置される（段落で通常起こること）。

### 3.5 具体的な配置 ― relative / float / absolute・fixed

**Relative（相対配置）**: 通常通りに配置され、その後必要なデルタ（差分）だけ移動される。

**Floats（フロート）**: float ボックスは行の左または右にシフトされる。興味深い特徴は、他のボックスがその周りを流れる（flow around）こと。例（原文のまま。web.dev版）:

```html
<p>
  <img style="float: right" src="images/image.gif" width="100" height="100">
  Lorem ipsum dolor sit amet, consectetuer...
</p>
```

（原典 html5rocks 版では `style="float:right"` と空白なしで書かれている。）

**Absolute and fixed（絶対配置と固定配置）**: レイアウトは normal flow に関係なく正確に定義される。要素は normal flow に参加しない。寸法はコンテナに対する相対で、`fixed` ではコンテナは viewport になる。**注意 ― fixed ボックスは文書がスクロールされても動かない！**

### 3.6 レイヤ表現（スタッキング）と z-index ★重要

これは z-index CSS プロパティで指定される。ボックスの第3の次元、すなわち "z軸" に沿った位置を表す。

ボックスは **stack（stacking context と呼ばれる）** に分割される。各 stack 内では、奥の要素が先に描画され、手前の要素が上に、ユーザに近い側に描画される。重なった場合、最も手前の要素が前の要素を隠す。

stack は z-index プロパティに従って順序付けられる。z-index プロパティを持つボックスはローカルな stack を形成する。viewport は最も外側の stack を持つ。例（原文のまま）:

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

赤い div はマークアップ上で緑より前にあり、通常のフローでは先に描画された（＝下に来る）はずだが、z-index がより高いので、ルートボックスが保持する stack の中でより手前に来る。

**攻撃者はどこを突くのか**: stacking context と z-index の挙動は、**クリックジャッキング**（透明な要素を上に重ね、ユーザに気づかせず別の操作をさせる攻撃。`opacity` や `pointer-events` を組み合わせる）や **UI redressing（UIの上塗り）** の診断で直接使う知識である。「z-index を持つボックスがローカル stack を形成する」「奥から手前へ描画される」という本文の記述が、なぜ親の stacking context を越えて手前に出られないケースがあるのか、逆にどう重ねれば透明オーバーレイが最前面に来るのかの説明根拠になる。原典はセキュリティ的含意には触れていない。

---

## 4. 攻撃者はどこを突くのか ― 記述と脆弱性の接続表

この記事の各記述は、クライアントサイド脆弱性ハンティングの具体的なテーマに接続する。以下は原典に書かれていない、教科書側での接続案である（本節の記述のうち、この表だけが原典の外にある「接続の提案」で、それ以外は原典の事実）。防御・診断目的で、許可された検証・バグバウンティを前提に読むこと。

| 本記事の記述 | クライアントサイド脆弱性ハンティングへの接続 |
| --- | --- |
| HTMLは文脈自由文法でない／エラー寛容 | サニタイザ・WAF・テンプレートのHTMLパースとブラウザのパースの差異（parser differential）→ mXSS、フィルタバイパス |
| tokenizer が状態機械で、同じ文字が状態次第で意味を変える | RCDATA/RAWTEXT/コメント/foreign content ごとにエスケープ要件が違う理由。文脈を跨いだ再パースの危険 |
| tree construction の stack of open elements / insertion modes / 暗黙の要素生成 | 「入力したHTMLと最終DOMが一致しない」ことの一般原理。stray table の兄弟化、form のネスト無視など構造正規化 |
| `document.write()` によるパースの再入性 | パース中のDOM注入、スクリプト実行タイミングの操作 |
| DOM は「JavaScriptに対するHTML要素のインタフェース」 | DOM clobbering（HTML要素が JS のグローバル／プロパティを上書きする）の前提 |
| スクリプトが同期的にパースを止める／speculative parser が外部リソースだけ先読み | リソース読み込み順の操作、レース条件、プリロードスキャナ由来の副作用 |
| Layout の dirty bit と同期layout強制 | レンダリング時間差を使うサイドチャネル、`:visited` 等の状態推測手法の土台 |
| painting order と stacking context / z-index | クリックジャッキング、UI redressing、透明オーバーレイの診断 |
| render tree に載らない要素（`display:none`）と載る要素（`visibility:hidden`） | 「見えないが存在する」要素の扱い。隠しフィールド・オフスクリーン要素の調査 |
| タブごとの別プロセス | プロセス／サイト分離の前提。同一プロセスに載るオリジンの組み合わせを考える出発点 |

---

## 5. この記事を「古典として」読む ― 時代的注意

本記事は 2011年執筆・2013年頃更新であり、いくつかの記述は現在の実装と乖離している。教科書では「古典として読む」ことを明示するのが誠実である。以下は現在の事実としては引用してはならない、あるいは単純化しすぎている箇所である。

- **レンダリングエンジンの種類**: Chrome / Opera（バージョン15以降）は本記事の WebKit 記述からさらに分岐した **Blink**（WebKit の fork）を使う。IE の Trident は後継が Edge（現在は Chromium ベース）。
- **HTML仕様**: 本文の「HTML5仕様」「W3C HTML5」への参照は、現在は **WHATWG HTML Standard** が単一の正本（本文中にも `whatwg.org` のパースアルゴリズムURLが出てくる）。
- **Data storage**: 記事が挙げる **WebSQL は廃止方向**。
- **スレッドモデル**: 「レンダリングエンジンはシングルスレッド」は、compositor スレッドやワーカーの存在を考えると現在は単純化しすぎ。現代のパイプラインには本記事にない段階（compositing / GPUラスタライズ、Chromium の LayoutNG、Blink の style recalc 再設計など）がある。
- **ネットワーク**: 「並列コネクション数は通常2〜6」は HTTP/1.1 前提。HTTP/2 以降は多重化される。

逆に、**パースアルゴリズム・エラー寛容性・カスケード／詳細度・stacking context・描画順序**の記述は今も有効であり、後述の MDN 現行版が同内容を追認している。安心して引用してよい。

---

## 6. 現代の実装で補う ― MDN と Chrome の公式資料

原典が古びている箇所を、一次に近い公式資料で埋める。以下はすべて **原典には無い**内容であり、原典の記述とは区別して扱うこと。出典URLは各所に併記する。

### 6.1 MDN「Populating the page: how browsers work」

原典と同名テーマの現行版・公式ドキュメント。公開URL: `https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work`。原典が扱っていないネットワーク段階・compositing・アクセシビリティツリー・計測指標をカバーしている。

**ネットワーク段階の分解**: 原典が「8kB チャンクで取得する」の一言で済ませたところを、MDN は Navigation を **DNS lookup / TCP handshake / TLS negotiation** に分ける。さらに **TCP slow start（輻輳制御）** を説明する。送出セグメント数は輻輳ウィンドウ CWND で制御され、CWND の初期値は 1, 2, 4, または 10 MSS（Ethernet では MSS = 1500 bytes）。ACK を受け取れば CWND は倍に、受け取れなければ半分になる。

**preload scanner（プリロードスキャナ）**: 原典が言う speculative parsing（WebKit/Firefox が別スレッドで先読みし、外部リソース参照だけパースし、DOM は触らない）と同じ機構を、MDN は "preload scanner" と呼ぶ。「メインスレッドが DOM ツリーを構築している間、preload scanner が利用可能なコンテンツをパースし、CSS・JavaScript・Web フォントのような高優先度リソースを先行要求する」。

**なぜ JavaScript がブロックするのか**: 現代的な言い換えとして「CSSの取得待ちは HTML のパースやダウンロードをブロックしないが、JavaScript はブロックする。JavaScript はしばしば要素に対する CSS プロパティの影響を問い合わせるからである」。

**JavaScript のコンパイル**: スクリプトは抽象構文木（AST）にパースされ、一部のエンジンは AST をコンパイラに渡して bytecode を出力する。大半はメインスレッドで解釈されるが、Web Workers のような例外がある。

**アクセシビリティツリー / AOM**: ブラウザは支援技術がコンテンツを解釈するためのアクセシビリティツリーも構築する。AOM は DOM の意味的（semantic）バージョンであり、DOM が更新されるとブラウザがアクセシビリティツリーを更新する。支援技術側からは変更できない。AOM が構築されるまでコンテンツはスクリーンリーダーからアクセスできない。

**render tree に載る／載らない要素の追認**: `<head>` とその子、`display: none` のノードは render tree に含まれない。`visibility: hidden` のノードは場所を占めるので含まれる。これは原典の記述を現行の公式ドキュメントが追認している箇所であり、教科書で安心して断言してよい。

**描画と compositing の分離、フレーム予算**: 「スムーズなスクロールとアニメーションのためには、スタイル計算・reflow・paint を含むメインスレッドの処理を **16.67ms 未満**で終える必要がある」「2048×1536 の iPad では **3,145,000 ピクセル超**を描画する必要がある」。`<video>`・`<canvas>`、および `opacity`・3D `transform`・`will-change` などを持つ要素は自分自身のレイヤに描画される（子孫も一緒に）。「レイヤは性能を改善するがメモリ管理の観点では高コストなので、乱用すべきでない」。

**compositing と reflow の因果**: MDN は compositing を「文書の各部が別レイヤに描かれて重なるとき、正しい順序で画面に合成する処理」と位置づけたうえで、**reflow（レイアウトのやり直し）は repaint（再描画）と re-composite（再合成）を引き起こす**、と因果を明示する。つまりレイアウトが一度崩れると、その先の描画も合成も連鎖してやり直しになる。MDN が挙げる典型例が **「画像の寸法（width/height）を指定していれば、その reflow は不要だった」** というものである。`<img>` に寸法を書かずに読み込むと、画像が届いた瞬間に占有面積が確定して周囲が押しやられ reflow が走るが、あらかじめ寸法を指定しておけば場所が最初から確保され、この reflow → repaint → re-composite の連鎖を丸ごと避けられる、という教訓である。

**Interactivity / TTI**: Time to Interactive は、最初のリクエスト（DNS lookup と TCP接続）からページがインタラクティブになるまでの計測。インタラクティブとは First Contentful Paint 以降で、ユーザ操作に 50ms 以内で応答する時点。メインスレッドが JavaScript のパース・コンパイル・実行で占有されているとこの応答ができない。

> ### 📌 ここは自分で開いて読んでください
> **資料**: MDN「Populating the page: how browsers work」 — https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で 403。内容は GitHub 上のソースリポジトリ `raw.githubusercontent.com/mdn/content/HEAD/files/en-us/web/performance/guides/how_browsers_work/index.md` の全文にもとづく要約である）。
> **読みどころ**:
> 1. Navigation 段階（DNS / TCP / TLS / slow start）― 原典が「8kBチャンク」で済ませたネットワークの実像を知るため
> 2. preload scanner と「なぜ JavaScript がブロックするか」の現代的説明 ― リソース読み込み順の操作を理解するため
> 3. Render の Style / Layout / Paint / Compositing の分離 ― 原典の描画段階が今どう発展したかを見るため
> **代替手段**: 上記の `raw.githubusercontent.com/mdn/content/...` のソース Markdown が無料で全文読める（本ノートはそこから取得）。

### 6.2 Chrome「Inside look at modern web browser」（全4部）

著者 Mariko Kosaka、公開日 2018-09-05。原典の「ブラウザの高レベル構造」「レンダリングエンジン」の Chromium 現代版に相当する公式解説。公開URL: `https://developer.chrome.com/blog/inside-browser-part1` 〜 `part4`。

**part 1 ― プロセスモデルと Site Isolation**。Chrome の主要プロセスと責務:

| プロセス | 制御するもの |
| --- | --- |
| Browser | アドレスバー・ブックマーク・戻る／進むボタンなどアプリの "chrome" 部分。加えて、ネットワークリクエストやファイルアクセスといった目に見えない特権的な部分 |
| Renderer | Webサイトが表示されるタブの中身すべて |
| Plugin | サイトが使うプラグイン（例: flash） |
| GPU | GPUタスクを他プロセスから隔離して扱う |

〔補足〕この表は主要4プロセスだが、実際にはこれ以外に **Extension プロセス**や **utility プロセス**なども動く。実物は Chrome のタスク マネージャー（後述の「手を動かす」の手順4）で一覧できる。

- **マルチプロセスの利点**: ①1つのタブが応答しなくなっても他のタブは生きている、②セキュリティとサンドボックス化。「OS がプロセスの権限を制限する手段を提供しているので、ブラウザは特定のプロセスを特定の機能からサンドボックスできる。たとえば Chrome は、レンダラプロセスのように任意のユーザ入力を扱うプロセスに対して、任意のファイルアクセスを制限している」。
- **コスト**: プロセスは各自のプライベートメモリ空間を持つため、V8 のような共通インフラのコピーを各プロセスが持つ。そのため Chrome は起動できるプロセス数に上限を設けており、上限に達すると同一サイトの複数タブを1つのプロセスにまとめる。
- **Servicification（サービス化）**: Chrome はブラウザプロセスの各部を「サービス」として動かす設計を採る。これにより、**強力なハードウェアでは機能ごとにプロセスを分割して安定性を高め、逆にリソース制約のあるデバイス（メモリの少ない端末など）では複数のサービスを1プロセスに統合してメモリを節約する**、という切り替えができる。同じ Chrome でも動く端末によってプロセスの分かれ方が違うのはこのためである。
- **Site Isolation**: 「クロスサイトの iframe ごとに別のレンダラプロセスを走らせる機能」。公式資料は次のように述べる。「**Same Origin Policy はWebの中核的セキュリティモデルであり、あるサイトが同意なく他サイトのデータにアクセスできないことを保証する。このポリシーのバイパスはセキュリティ攻撃の主要な目標である。プロセス分離はサイトを分離する最も効果的な方法である。**」「Meltdown と Spectre によって、プロセスを使ってサイトを分離する必要性がいっそう明白になった。」「デスクトップでは Chrome 67 以降、Site Isolation がデフォルトで有効。タブ内の各クロスサイト iframe が別のレンダラプロセスを得る。」
  - 公式資料はさらに、Site Isolation の実現が**複数年にわたるエンジニアリング努力**だったと述べる。これは単にプロセスを増やすだけの話ではなく、**iframe 同士の通信方法を根本的に変える**ものであり、DevTools も、ページ内を Ctrl+F で検索することさえ、**異なるレンダラプロセスを跨いで**行えるように作り直す必要があった。「オリジンごとにプロセスを分ける」という一見単純な方針が、ブラウザ内部の連携を広範に作り替える大工事だった、という点は、なぜプロセス分離がすぐには普及しなかったのかを理解する助けになる。

**part 3 ― レンダリングパイプライン（原典の「レンダリングエンジン」章の現代版）**。ここが原典の「シングルスレッド」記述を最も明確に更新する。

- **レンダラプロセスの内部スレッド構成**: main thread（メインスレッド）／ worker threads（web worker・service worker）／ compositor thread（コンポジタスレッド）／ raster thread（ラスタスレッド）。原典の「レンダリングエンジンはシングルスレッド」がもはや成り立たない具体的中身がこれである。
- **preload scanner の実装**: 「`<img>` や `<link>` のようなものが HTML 文書にあると、preload scanner は HTML パーサが生成したトークンを覗き見し（peeks at tokens generated by HTML parser）、ブラウザプロセス内の network thread にリクエストを送る」。
- **なぜ JavaScript がパースをブロックするのか**: 「JavaScript は `document.write()` のようなもので文書の形を変えられるから」。原典の「再入可能性（reentrant）」と同じ理由を、HTML仕様の `https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model` へのリンク付きで説明している。
- **ブラウザのデフォルトスタイルシートの実体**: 原典が「ブラウザのデフォルトスタイルシート」と抽象的に呼ぶものの実体は、Chromium では **`third_party/blink/renderer/core/html/resources/html.css`** というソースファイルである（part 3 に Chromium ソースへのリンクつきで示されている）。`div` のデフォルト display が block である、といった「著者が何も書かなくても効くスタイル」は、この実在のファイルに書かれている、と具体的に知っておくと、スタイルのカスケードを追うときに迷いにくい。
- **レイヤツリーの構築**: 「どの要素がどのレイヤに入るべきかを決めるため、**メインスレッドが layout tree を歩いて layer tree を作る**」。DevTools の Performance パネルではこの処理が **"Update Layer Tree"** と表示される。別レイヤになるべき部分がレイヤを得ていない場合は CSS の `will-change` でヒントを与えられる。
- **ラスタライズと合成**: 「layer tree が作られ描画順が決まると、メインスレッドはその情報を compositor thread にコミットする。compositor thread は各レイヤをラスタライズする。レイヤはページ全長のように大きいことがあるので、compositor thread はそれらを tile（タイル）に分割し、各タイルを raster thread に送る。raster thread が各タイルをラスタライズし、GPUメモリに格納する。」
- **パイプラインの依存関係**: part 3 は「各ステップで前の処理の結果が次の処理の入力になる」と明言する。**layout tree で何かが変われば、その影響を受ける範囲について Paint の順序（描画順）を作り直す必要がある**。つまり Style → Layout → Paint → Composite は一方向の依存で連なっており、上流（レイアウト）が動くと下流（描画順・合成）まで再生成が波及する。この依存関係が、前掲 6.1 の「reflow が repaint と re-composite を引き起こす」という MDN の記述と表裏一体である。
- **Compositing の定義**: 「ページの各部をレイヤに分離し、それぞれを個別にラスタライズし、compositor thread という別スレッドでページとして合成する技法。」スクロールやアニメーションはレイヤを動かして新フレームを合成するだけで済む。
- **フレーム予算**: 「ほとんどのディスプレイは毎秒60回（60fps）画面を更新する。フレーム間でアニメーションが取りこぼされるとページは "janky"（カクつく）に見える。」対策として `requestAnimationFrame()` による分割、Web Workers。

**part 2 / part 4（別章で効く内容、見出しのみ）**: part 2「What happens in navigation」はナビゲーションの全工程（Find a renderer process / Commit navigation、Service Worker、Navigation Preload）。part 4「Input is coming to the Compositor」は入力イベントと compositor（non-fast scrollable region、イベントターゲットの探索、`getCoalescedEvents()` など）。

〔補足〕part 4 の「non-fast scrollable region」と「イベントターゲットの探索」は、`pointer-events` やオーバーレイを使う UI 攻撃（クリックジャッキング）・入力横取りの技術的前提として、後の章から参照する価値が高い。ただしその接続自体は原典にもこの記事にも書かれていない、本ノートの提案である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Chrome「Inside look at modern web browser」part 1〜4（Mariko Kosaka, 2018） — https://developer.chrome.com/blog/inside-browser-part1
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `developer.chrome.com` が egress 制限で 403。内容は GitHub 上のソースリポジトリ `raw.githubusercontent.com/GoogleChrome/developer.chrome.com/HEAD/site/en/blog/inside-browser-partN/index.md` の全文にもとづく要約である。公開URLはリポジトリのディレクトリ構成から導いたもので、当環境では実際に開いて確認できていない）。
> **読みどころ**:
> 1. part 1 の Site Isolation（Chrome 67 以降デフォルト、Meltdown/Spectre との関係）― Same-Origin Policy をプロセスで守る現代の仕組みを知るため
> 2. part 3 のレンダラ4スレッド構成と compositing ― 原典の「シングルスレッド」がどう更新されたかを見るため
> 3. part 4 の入力イベントと compositor ― クリックジャッキング・入力横取りの前提として
> **代替手段**: 上記 `raw.githubusercontent.com/GoogleChrome/developer.chrome.com/...` のソース Markdown が4部とも無料で全文読める（本ノートはそこから取得）。

---

## 7. 元資料と図

### 7.1 記事本体と図が直接読めなかった事情

本教科書の執筆環境では、記事本体URL（`https://www.html5rocks.com/tutorials/internals/howbrowserswork/`）とその公式リダイレクト先 `https://web.dev/articles/howbrowserswork` の双方が egress プロキシの組織ポリシーにより 403 で拒否された。`web.archive.org`・`developer.chrome.com`・`developer.mozilla.org` も同様である。

そこで本文・コード・図キャプションは、原典 html5rocks のコンテンツリポジトリのミラーと web.dev のソースリポジトリのミラー（いずれも `raw.githubusercontent.com`、HTTP 200）から全文取得し、両版の見出し集合が完全一致することを確認したうえで作成している。**内容の欠落はないが、記事内の図（Figure）は画像であり、本ノートには図のキャプションと説明文しか収録できていない**（画像 CDN は 403、テキストミラーには画像が含まれず全点 404 だった）。

### 7.2 図（Figure）の一覧 ― 読者が自分で図を特定するために

図の画像そのものは本環境では取得できないが、読者が記事を開いたとき各図を一意に特定できるよう、両版のソースから確定したインベントリを示す（本節に関係する後半の図を中心に抜粋）。web.dev の画像URLは `https://web-dev.imgix.net/image/T4FyVKpzu4WKF1kBNvXepbi08t52/<画像ID>` の形（リポジトリのソースコードから導いたもので、当環境では未検証）。

| キャプション / alt | 寸法 | html5rocks ファイル名 | web.dev 画像ID | 対応する節 |
| --- | --- | --- | --- | --- |
| Incremental layout - only dirty renderers and their children are layed out (3.6)（原文の typo `layed` のまま） | 326×341 | `reflow.png` | `pjIcQqbVvJPryLtHpefc.png` | Global and incremental layout |
| CSS2 box model | 509×348 | `image046.jpg` | `KbqHxGe3HMLM5BbXMcP8.jpg` | CSS Box model |
| Block box | 150×127 | `image057.png` | `fvhwoy1W1Se7IY4XyiXp.png` | Box types |
| Inline boxes | 300×233 | `image059.png` | `srPz5klZnpr6j5edpV45.png` | Box types |
| Block and Inline formatting | 350×324 | `image061.png` | `8i6bZtuslRR3kJdsST6p.png` | Box types |
| Lines | 400×277 | `image063.png` | `xChsrrYLPU7MfekdR7zS.png` | Box types |
| Relative positioning | 500×261 | `image065.png` | `C1rUmDaOa8kGRx1PSdUu.png` | Relative |
| Float | 444×203 | `image067.png` | `ozqqfqboQ0IJJWlv5xXx.png` | Floats |
| Fixed positioning | 500×343 | `image069.png` | `0xwOrAiWm2kpuCecsRv1.png` | Absolute and fixed |
| Fixed positioning（原文のキャプション誤り。位置的には z-index の図） | 254×227 | `image071.png` | `EXneyo5lwaJ6g09BuCo6.png` | Layered representation |

〔注意〕記事全体では27図＋著者写真1点の計28点があり、両版で寸法が全点1対1で一致することを確認済み。教科書で特に再現価値が高いのは、前半（05a）側の HTML5仕様由来のパースフロー図・トークナイザ状態遷移・tree construction のアニメーションなどである。

### 7.3 参考文献（Resources）と注記番号

原典は本文・図キャプションに注記番号 `(1.1)` `(2.2)` `(3.1)` `(3.5)` `(3.6)` `(4.1)` を埋め込み、末尾の Resources リストへアンカーリンクしている。これらは原典HTMLの `id` 属性（`id="1_1"` など）で確定しており、推測ではない。**web.dev 版ではこの注記番号がすべて削除されている**ため、「どの記述がどの一次文献に由来するか」を追うには html5rocks 版（またはそのソース）を見る必要がある。

**版差分の細部**（教科書で版を語るとき用）:

- **注記番号の削除**: web.dev 版は本文・図キャプションから `(3.6)` `(3.1)` `(2.2)` `(3.5)` などをすべて除去している。Resources リスト自体は残るが、本文のどの記述がどの文献に由来するかは追えなくなっている。
- **目次（TOC）**: html5rocks 版は記事冒頭に3階層の `<ol class="toc">` による Table of Contents を持ち、**本文には存在しない章見出し「Parsing and DOM tree construction」**で HTML パーサ群をまとめている。web.dev 版に TOC はない。
- **注記・補足の表現**: html5rocks 版は通常の段落と `<blockquote>` で書くが、web.dev 版は Eleventy のショートコード **`{% Aside %}`（計6箇所）** と `{% Blockquote %}` に整理している。`{% Aside %}` が使われる6箇所は、①Preface の Tali の引用、②Parsing example の key-term（"Our language can include integers, plus signs and minus signs."）、③"A too deep tag hierarchy" の WebKit コメント（liceo.edu.mx / 20タグ）、④"Misplaced html or body end tags" の WebKit コメント、⑤"Absolute and fixed" の「fixed ボックスは文書がスクロールされても動かない！」、⑥末尾の著者略歴、である。同じ内容が版によって「素の段落」か「Aside の囲み」かで見え方が変わるので、2つの版を読み比べるときの目印になる。

本節に関係する注記は次の一次文献を指す。

| 注記 | 指す文献 | 本文中の位置 |
| --- | --- | --- |
| (3.5) | Chris Waterson, *Notes on HTML Reflow* | 「HTML tables may require more than one pass (3.5)」 |
| (3.6) | Chris Waterson, *Gecko Overview* | 図「Gecko main flow」／「Incremental layout …」 |
| (4.1) | David Hyatt, *Implementing CSS(part 1)* | 「95%以上の規則を除外する」最適化（05a側） |

原典末尾の Resources リストは6つのグループから成る。この見出しは「完全再現」を掲げているので、**群構成をそのまま再掲する**（レイアウト・描画をさらに深掘りする次の一歩でもある）。

| 番号 | グループ | 文献 |
| --- | --- | --- |
| 1 | **Browser architecture（ブラウザアーキテクチャ）** | |
| 1.1 | | Grosskurth, Alan. *A Reference Architecture for Web Browsers (pdf)* `http://grosskurth.ca/papers/browser-refarch.pdf` ― 本文注記 (1.1)「主要コンポーネントは…」が指す一次文献 |
| 1.2 | | Gupta, Vineet. *How Browsers Work - Part 1 - Architecture* `http://www.vineetgupta.com/2010/11/how-browsers-work-part-1-architecture/` |
| 2 | **Parsing（パース）** | |
| 2.1 | | Aho, Sethi, Ullman, *Compilers: Principles, Techniques, and Tools*（通称 "Dragon book"）, Addison-Wesley, 1986 ― コンパイラ理論の古典 |
| 2.2 | | Rick Jelliffe. *The Bold and the Beautiful: two new drafts for HTML 5.* `http://broadcast.oreilly.com/2009/05/the-bold-and-the-beautiful-two.html` ― 本文注記 (2.2) が指す |
| 3 | **Firefox** | |
| 3.1 | | L. David Baron, *Faster HTML and CSS: Layout Engine Internals for Web Developers.*（スライド） `http://dbaron.org/talks/2008-11-12-faster-html-and-css/slide-6.xhtml` ― 本文注記 (3.1) が指す |
| 3.2 | | 同上（Google tech talk 動画） `https://www.youtube.com/watch?v=a2_6bGNZ7bA` |
| 3.3 | | L. David Baron, *Mozilla's Layout Engine* `http://www.mozilla.org/newlayout/doc/layout-2006-07-12/slide-6.xhtml` |
| 3.4 | | L. David Baron, *Mozilla Style System Documentation* `http://www.mozilla.org/newlayout/doc/style-system.html` |
| 3.5 | | Chris Waterson, *Notes on HTML Reflow* `http://www.mozilla.org/newlayout/doc/reflow.html` ― 本文注記 (3.5)「table は複数パスを要する」が指す |
| 3.6 | | Chris Waterson, *Gecko Overview* `http://www.mozilla.org/newlayout/doc/gecko-overview.htm` ― 本文注記 (3.6)「Gecko main flow」「Incremental layout」が指す |
| 3.7 | | Alexander Larsson, *The life of an HTML HTTP request* `https://developer.mozilla.org/en/The_life_of_an_HTML_HTTP_request` |
| 4 | **WebKit** | |
| 4.1 | | David Hyatt, *Implementing CSS(part 1)* `http://weblogs.mozillazine.org/hyatt/archives/cat_safari.html` ― 本文注記 (4.1)「95%以上の規則を除外」が指す（05a側） |
| 4.2 | | David Hyatt, *An Overview of WebCore* `http://weblogs.mozillazine.org/hyatt/WebCore/chapter2.html` |
| 4.3 | | David Hyatt, *WebCore Rendering* `http://webkit.org/blog/114/` |
| 4.4 | | David Hyatt, *The FOUC Problem* `http://webkit.org/blog/66/the-fouc-problem/` |
| 5 | **W3C Specifications（W3C 仕様）** | |
| 5.1 | | *HTML 4.01 Specification* `http://www.w3.org/TR/html4/` |
| 5.2 | | *W3C HTML5 Specification* `http://dev.w3.org/html5/spec/Overview.html`（現在は WHATWG HTML Standard が正本） |
| 5.3 | | *CSS Level 2 Revision 1 (CSS 2.1) Specification* `http://www.w3.org/TR/CSS2/` |
| 6 | **Browsers build instructions（ブラウザのビルド手順）** | |
| 6.1 | | Firefox `https://developer.mozilla.org/Build_Documentation` |
| 6.2 | | WebKit `http://webkit.org/building/build.html` |

〔補足〕原典HTMLでは「The FOUC Problem」のアンカーが `4_5` で `4_4` が欠番になっている（表示上は4番目）。本文からは参照されていないため実害はないが、原典を精査すると混乱しうる点として記録しておく。3.x / 4.x のリンクは 2006〜2010年頃のもので、リンク切れの可能性が高い。

#### 本文中で参照される仕様・外部URL（原文のまま、抜粋）

Resources リストとは別に、本文の各所は仕様や解説へ直接リンクしている。本節に関係する近傍のものを抜粋する。

| 用途 | URL（原文のまま） |
| --- | --- |
| CSS2 描画順序・z-index | `http://www.w3.org/TR/CSS21/zindex.html` / `http://www.w3.org/TR/CSS2/zindex.html` |
| CSS ボックスモデル | `http://www.w3.org/TR/CSS2/box.html` |
| CSS2 processing model（containing block） | `http://www.w3.org/TR/CSS21/intro.html#processing-model` |
| デフォルトスタイルシートの例 | `http://www.w3.org/TR/CSS2/sample.html` |
| 正規表現の解説（CSSの字句を説明する箇所で参照） | `http://www.regular-expressions.info/` |
| ブラウザ利用シェアの統計 | StatCounter `http://gs.statcounter.com/` |
| **深すぎるタグのネストの実例サイト**（error tolerance の節で「A too deep tag hierarchy」の実例として名指しされる、本記事固有のURL） | `www.liceo.edu.mx` |

〔補足〕`www.liceo.edu.mx` は、原典が「タグのネストが深すぎる壊れた HTML」の実例として本文中で名指ししているサイトである。WebKit のソースには `cMaxRedundantTagDepth = 20`（同じタグを最大20段までしか入れ子にしない）という定数があり、この実例はその上限が実在の壊れたページを念頭に置いていることを示す、本記事に固有の一次的なディテールである（詳細は前半 05a のエラー寛容性の節）。

> ### 📌 ここは自分で開いて読んでください
> **資料**: How Browsers Work（記事本体・図つき） — https://web.dev/articles/howbrowserswork
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 記事本体URL・web.dev・web.archive.org がいずれも egress 制限で 403。図の画像 CDN も 403、テキストミラーには画像が含まれず 404。本節の本文は GitHub 上のソースミラーの全文にもとづく要約で、図はキャプションのみ収録している）。
> **読みどころ**:
> 1. 図を必ず見ること。本文は図に強く依存しており、特に render tree と DOM tree の対応図、box model 図、z-index の図は、文章だけでは伝わりにくい
> 2. 「dirty bit」「Asynchronous and Synchronous layout」節 ― `offsetHeight` が同期レイアウトを強制する記述はサイドチャネルの土台
> 3. 「The painting order」と「Layered representation」節 ― クリックジャッキング診断で直接使う
> **代替手段**: 原典 html5rocks 版のソースHTML（注記番号・TOC入り）が `https://raw.githubusercontent.com/hungdt138/html5rocks/HEAD/www.html5rocks.com/content/tutorials/internals/howbrowserswork/en/index.html` で、現行版のソース Markdown が `https://raw.githubusercontent.com/Youssef1313/web.dev/HEAD/src/site/content/en/blog/howbrowserswork/index.md` で無料全文読める（いずれも本環境で HTTP 200 を確認。ただし図は含まれない）。

### 7.4 日本語・多言語で読む ― 翻訳という代替経路

英語の原典が読みづらい場合、原典の Translations 節は**日本語訳を2種類**挙げている。日本語話者にとってはこれが最短の入口になりうるので、代替経路として明示しておく。

| 言語 | 訳者 | URL |
| --- | --- | --- |
| 日本語（その1） | @_kosei_ 訳 | `http://cou929.nu/docs/how-browsers-work/` |
| 日本語（その2） | @ikeike443 / @kiyoto01 訳「ブラウザってどうやって動いてるの？」 | `http://shanon-tech.blogspot.com/2011/09/web.html` |
| 韓国語 | ― | `http://helloworld.naver.com/helloworld/59361` |
| トルコ語 | ― | `http://sonsuzdongu.com/blog/tarayicilar-nasil-calisir-...` |

**〔重要な注意〕これらの翻訳はいずれも 2011年版（html5rocks 版）の翻訳である。** 本節の随所で述べた web.dev 版の更新 ― Blink への言及、モバイルブラウザ、`localStorage` / `IndexedDB` などのストレージ機構、シェアの数字（2013年6月版）など ― は反映されていない。翻訳で全体像をつかんだうえで、更新点は本節（05b）や英語の現行版 `https://web.dev/articles/howbrowserswork` で補うのがよい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: How Browsers Work 日本語訳（@_kosei_ 訳） — http://cou929.nu/docs/how-browsers-work/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 当セッションの egress 制限で 403）。上の表と本注記は原典 Translations 節の記載にもとづく。
> **読みどころ**:
> 1. 英語が負担なら、まず日本語訳で「HTMLパース → DOM → スタイル → render tree → layout → painting」の全体の流れをつかむ
> 2. そのうえで本節（05b）の「古典として読む」注意（Blink・WHATWG・WebSQL 廃止・マルチスレッド・compositing）と照合し、翻訳が 2011年版で止まっている点を意識する
> **代替手段**: 同じ内容の英語現行版が `https://web.dev/articles/howbrowserswork`。英語のソース Markdown なら `https://raw.githubusercontent.com/Youssef1313/web.dev/HEAD/src/site/content/en/blog/howbrowserswork/index.md` で無料全文（本環境で HTTP 200 確認済み）。もう1つの日本語訳が `http://shanon-tech.blogspot.com/2011/09/web.html`。

---

## 手を動かす

以下は自分で立てた検証環境・許可された対象でのみ行うこと。ここでの目的はあくまで「ブラウザの動きを自分の目で確認する」ことである。

1. **同期レイアウト強制（layout thrashing）を観察する。** 適当なローカルHTMLに大量の要素を置き、ループ内で「スタイルを変更 → `element.offsetHeight` を読む」を交互に繰り返すコードと、「全部変更してから最後に一度だけ読む」コードの2種を書く。Chrome の DevTools の Performance パネルで記録し、前者に大量の "Layout" が挟まること、後者ではまとまることを見る。原典の「`offsetHeight` は増分レイアウトを同期的にトリガする」を体感できる。

2. **描画順序と z-index を確認する。** 3.6 のサンプル（赤 z-index:3、緑 z-index:1）をそのままローカルHTMLに保存して開き、マークアップ順とは逆に赤が手前に来ることを確認する。次に赤の z-index を 0 にすると、マークアップで後の緑が手前に来る。「奥から手前へ描画」を目で追う。

3. **レイヤとスレッドを DevTools で見る。** DevTools の More tools → Layers パネルを開き、`will-change: transform` や `transform: translateZ(0)` を付けた要素が独立レイヤに昇格することを確認する。Performance パネルの "Update Layer Tree" 表示（Chrome part 3 の記述）も探す。原典の「シングルスレッド」が現代では compositor / raster スレッドに分かれている実像を確認できる。

4. **プロセス分離を確認する。** Chrome の右上メニュー → その他のツール → タスク マネージャーを開き、複数のクロスサイト iframe を含むページでレンダラプロセスが複数に分かれること（Site Isolation, Chrome 67 以降）を見る。

5. **原典と現行版を読み比べる。** 手順は本節の 📌 ブロックにある `raw.githubusercontent.com` の2つのURLを開き、html5rocks 版（注記番号あり）と web.dev 版（注記番号なし）で、Layout 節の「table は複数パスを要する」に (3.5) が付くかどうかを比べる。注記が「定量的・断定的な主張には一次文献が紐づく」印であることを確認する。

---

## つまずきポイント

- **「レイアウト」と「描画」を混同する。** レイアウトは位置とサイズを決める計算、描画は実際にピクセルを塗る処理。色だけの変更は描画のみ、位置の変更はレイアウト＋描画を引き起こす（2.4 の表）。
- **「シングルスレッド」を現代の Chrome にそのまま当てはめる。** 原典の記述は 2011/2013 年時点。現代のレンダラは main / worker / compositor / raster の複数スレッドを持つ（Chrome part 3）。古典として読むこと。
- **z-index を「大きいほど必ず手前」と思い込む。** stacking context はローカルに形成されるため、親の stacking context を越えて手前に出られないことがある。クリックジャッキング診断ではこの「ローカル stack」の理解が要になる。
- **`display:none` と `visibility:hidden` を同じと思う。** 前者は render tree に載らない（ボックスを生成しない）、後者は場所を占めるので載る。原典と MDN 現行版の双方が明言している。
- **speculative parsing / preload scanner が DOM を組み立てると誤解する。** これらは外部リソースを先読み要求するだけで、DOM は触らない。
- **記事本体URLが開けないのを「情報が欠けている」と誤解する。** 本環境の egress 制限による直接取得の失敗であり、本文はソースミラーから全文確保済み。欠けているのは図の画像のみ。

---

## この節のまとめ

- レイアウト（reflow）は、render tree の renderer に位置とサイズを与える計算である。HTML はフローベースのレイアウトモデルを使い、多くの場合1パスで幾何を計算できる。
- レイアウトはルート renderer（位置 0,0、寸法 = viewport）から始まる再帰的プロセスで、各 renderer が「レイアウトを必要とする子」の layout を呼ぶ。
- dirty bit 方式（"dirty" と "children are dirty" の2フラグ）で変更を差分化し、無関係な枝の再計算を避ける。
- レイアウトはグローバル（フォントサイズ変更・リサイズ等）にも増分（dirty な renderer だけ、非同期）にもなる。
- `offsetHeight` など、スタイル情報を要求するスクリプトは増分レイアウトを同期的に強制する。これが layout thrashing であり、レンダリング時間差サイドチャネルの土台になる。
- 幅の計算は preferred width → min/max の順で、WebKit の `RenderBox::calcWidth` は `clientWidth() - paddingLeft() - paddingRight()` を使う。
- 描画は render tree を走査して `paint()` を呼ぶ。描画順は背景色→背景画像→ボーダー→子→アウトラインで、stacking context を奥から手前へ描く。
- 動的変更に対しブラウザは最小の処理をする。色変更は再描画のみ、位置変更は周囲まで巻き込む。
- レンダリングエンジンはネットワーク以外シングルスレッドで、メインスレッドはイベントループ（`while (!mExiting) NS_ProcessNextEvent(thread);`）。この記述は現代では単純化しすぎである。
- CSS2 の視覚モデルは canvas・ボックスモデル（content + padding + border + margin）・3つの配置スキーム（Normal / Float / Absolute）・2つのボックス型（block / inline）で構成される。
- z-index は z軸方向の位置を表し、z-index を持つボックスはローカル stack を形成する。これがクリックジャッキング・UI redressing の診断の基礎知識になる。
- 本記事は 2011/2013 年の古典であり、Blink・WHATWG HTML・WebSQL 廃止・マルチスレッド・compositing・HTTP/2 などは現代の実装で読み直す必要がある。
- 一方、パースアルゴリズム・エラー寛容性・カスケード／詳細度・stacking context・描画順序は今も有効で、MDN 現行版が追認している。
- MDN 現行版はネットワーク段階（DNS/TCP/TLS/slow start）・preload scanner・AOM・compositing・TTI を補う。
- Chrome「Inside look at modern web browser」はプロセスモデル・サンドボックス・Site Isolation（Chrome 67 以降、Same-Origin Policy をプロセスで守る）・レンダラ4スレッド・タイル分割ラスタを補う。
- 記事本体URLと図は本環境では 403 で直接取得できず、本文はソースミラーから全文確保、図はキャプションのみ。読者は 📌 ブロックの手順で自分で開くこと。

## 理解度チェック

1. レイアウト（reflow）とは何を計算する段階か。
   ▶ 答え: render tree に追加された renderer の位置とサイズ（幾何情報）を計算する段階。DOM とスタイルが揃っただけでは決まらない「どこに何を置くか」を決める。

2. dirty bit の2つのフラグは何で、それぞれ何を意味するか。
   ▶ 答え: "dirty"（この renderer 自身がレイアウトを必要とする）と "children are dirty"（自身は問題ないかもしれないが、レイアウトを必要とする子が少なくとも1つある）。無関係な枝の再計算を避けるために使う。

3. `offsetHeight` の読み取りがなぜ問題になりうるのか、性能と脆弱性の両面で答えよ。
   ▶ 答え: スタイル情報を要求するので増分レイアウトを同期的に強制する（layout thrashing）。性能面では処理がまとまらず遅くなり、脆弱性面ではレイアウト時間の差を観測するサイドチャネル（時間差から状態を推測する手法）の土台になる。

4. ブロック renderer の描画順を1から5まで挙げよ。
   ▶ 答え: ①背景色 ②背景画像 ③ボーダー ④子 ⑤アウトライン。スタックは奥から手前へ描かれる。

5. z-index が高いボックスが必ず最前面に来るとは限らないのはなぜか。クリックジャッキングとどうつながるか。
   ▶ 答え: z-index を持つボックスはローカルな stacking context を形成し、その順序は親の stack の中でのもの。親の stacking context を越えて手前には出られない。クリックジャッキングでは透明オーバーレイを最前面に置く必要があるため、どの要素がローカル stack を作りどう重なるかの理解が診断の要になる。

6. 「レンダリングエンジンはシングルスレッド」という原典の記述は、現代の Chromium ではどう更新されているか。
   ▶ 答え: レンダラプロセスは main / worker（web/service worker）/ compositor / raster の複数スレッドを持つ。ラスタライズと合成はメインスレッドの外（compositor / raster thread）で行われる（Chrome part 3）。

7. `display:none` と `visibility:hidden` の render tree 上の扱いの違いは。
   ▶ 答え: `display:none` はボックスを生成せず render tree に載らない。`visibility:hidden` は場所を占めるので render tree に載る（描かれないが存在する）。原典と MDN 現行版の双方が明言。

8. Site Isolation とは何で、なぜ導入されたか。公式資料の言葉に沿って答えよ。
   ▶ 答え: クロスサイトの iframe ごとに別のレンダラプロセスを走らせる機能。Same-Origin Policy のバイパスが攻撃の主要目標であり、プロセス分離がサイトを分離する最も効果的な方法だから。Meltdown と Spectre がその必要性を明白にした。Chrome 67 以降デスクトップでデフォルト有効。

9. 記事本体URLが本執筆環境で直接読めなかった理由と、それでも本文が確保できた経路は。
   ▶ 答え: 記事本体・web.dev・web.archive.org が egress プロキシの組織ポリシーで 403 だったため。本文・コード・図キャプションは GitHub 上のソースミラー（`raw.githubusercontent.com`、HTTP 200）から全文取得し、両版の見出し一致を確認して確保した。欠けているのは図の画像のみ。

10. 原典を「そのまま引用してはいけない」箇所を3つ挙げよ。
    ▶ 答え: レンダリングエンジンの種類（現在は Blink 等）、対象ブラウザのシェア（2013年6月のスナップショット）、Data storage の WebSQL（廃止方向）。「シングルスレッド」「並列コネクション2〜6（HTTP/1.1 前提）」も単純化しすぎ。

## 出典

- https://www.html5rocks.com/tutorials/internals/howbrowserswork/ （原典 html5rocks 版。ソースミラー `https://raw.githubusercontent.com/hungdt138/html5rocks/HEAD/www.html5rocks.com/content/tutorials/internals/howbrowserswork/en/index.html` から全文取得）
- https://web.dev/articles/howbrowserswork （現行版。ソースミラー `https://raw.githubusercontent.com/Youssef1313/web.dev/HEAD/src/site/content/en/blog/howbrowserswork/index.md` から全文取得）
- https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work （MD, ソース `https://raw.githubusercontent.com/mdn/content/HEAD/files/en-us/web/performance/guides/how_browsers_work/index.md` から取得）
- https://developer.chrome.com/blog/inside-browser-part1 〜 part4 （ソース `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/HEAD/site/en/blog/inside-browser-partN/index.md` から取得）
- http://www.w3.org/TR/CSS21/zindex.html / http://www.w3.org/TR/CSS2/box.html / http://www.w3.org/TR/CSS21/intro.html#processing-model （CSS2 仕様。記事本文が参照）
- https://html.spec.whatwg.org/multipage/parsing.html （WHATWG HTML Standard。パースアルゴリズムの現行正本）

<!-- sources: https://www.html5rocks.com/tutorials/internals/howbrowserswork/, https://web.dev/articles/howbrowserswork, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work, https://developer.chrome.com/blog/inside-browser-part1, http://www.w3.org/TR/CSS21/zindex.html, https://html.spec.whatwg.org/multipage/parsing.html -->
<!-- terms: レイアウト（layout / reflow）, dirty bit, 増分レイアウト（incremental layout）, グローバルレイアウト（global layout）, 同期レイアウト強制（layout thrashing）, フローベースレイアウトモデル（flow based layout model）, viewport, 描画（painting）, 描画順序（painting order）, stacking context, z-index, canvas, CSSボックスモデル, 配置スキーム（positioning scheme）, block box, inline box, イベントループ（event loop）, preload scanner（speculative parsing）, アクセシビリティツリー（AOM）, compositing, raster thread, compositor thread, Site Isolation, サンドボックス, Same-Origin Policy, TCP slow start, Time to Interactive（TTI）, クリックジャッキング, サイドチャネル -->
<!-- self-read: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work | サイト側 egress 制限で 403、内容は GitHub ソースミラーの全文にもとづく要約 -->
<!-- self-read: https://developer.chrome.com/blog/inside-browser-part1 | developer.chrome.com が egress 制限で 403、内容は GitHub ソースミラーの全文にもとづく要約、公開URLはリポジトリ構成から導出 -->
<!-- self-read: https://web.dev/articles/howbrowserswork | 記事本体・web.dev・web.archive.org が egress 制限で 403、図の画像CDNも 403、本文はソースミラーから確保し図はキャプションのみ -->
