# 入力イベントとコンポジタスレッド ― ジェスチャがブラウザの中をどう流れるか

> **この節で分かること**
> - ブラウザにとっての「入力（input）」がクリックやタイピングだけでなく、あらゆるユーザージェスチャを含むことを説明できる
> - 入力イベントがブラウザプロセス→レンダラプロセス→コンポジタ／メインスレッドをどう流れるかを図で説明できる
> - 非高速スクロール領域（Non-Fast Scrollable Region）とは何か、なぜイベント委譲がスクロール性能を殺すのかを説明でき、`passive: true` / `touch-action` で緩和できる
> - ヒットテスト（hit test）が paint records を使ってイベントターゲットを決める仕組みを説明でき、それがクリックジャッキングの技術的核心であることを理解できる
> - 連続イベントの合体（coalescing）と `requestAnimationFrame` の関係を説明でき、`getCoalescedEvents()` の使いどころを判断できる
> - これらの知識を UI redressing・イベントの信頼性（`isTrusted`）・クライアントサイド DoS の観点に接続できる

**元資料**: https://developer.chrome.com/blog/inside-browser-part4 （原典は取得できず二次情報ベース。ただし本文は同記事の公開ソースリポジトリ `raw.githubusercontent.com/GoogleChrome/developer.chrome.com` 上の記事原稿 `site/en/blog/inside-browser-part4/index.md` から全文取得しており、内容の欠落はない）
**関連する節**: 「Inside look at modern web browser part 3（レンダリングとコンポジタ）」（本節はその続きにあたる）

---

## 1. この節の位置づけ ― シリーズ最終回で「入力」を扱う理由

本節は、Google Chrome チームの Mariko Kosaka（`kosamari`）による全4部シリーズ「Inside look at modern web browser（モダンなウェブブラウザの内側を覗く）」の第4部（最終回）にもとづく。初出 2018-09-21、更新 2019-01-12 の記事である。

シリーズ全体は「ブラウザが我々の書いたコードをどう扱ってウェブサイトを表示するか」を調べるものだ。〔補足〕大まかな構成は、part 1 が CPU/GPU・プロセス・スレッドの基礎とマルチプロセスアーキテクチャ、part 2 がナビゲーションの内側、part 3 がレンダラプロセスの内側（パース・スタイル・レイアウト・ペイント・コンポジット・ラスタライズ）である。

第3部では「レンダリング処理」と「コンポジタ（compositor）」を学んだ。コンポジタとは、あらかじめ描いておいた画面の各レイヤ（層）を合成して1枚のフレームにまとめる仕組みのこと。本節（第4部）は、そのコンポジタが**ユーザー入力が来たときにどうやってスムーズなインタラクションを保つか**を扱う。

### 1.1 なぜバグハンティングでこの知識が要るのか

一見すると入力イベントの内部処理は純粋な性能の話に見える。しかしバグバウンティ（許可された範囲で脆弱性を探し報奨を得る活動）の視点では、この節の知識は次の3つに直結する。

- **UI redressing（クリックジャッキング）**: イベントがどのスレッドを通り、どこで「ヒットテスト」されるかを知らないと、この攻撃の本質を掴めない。
- **イベントの信頼性**: OS 由来の本物の入力と、スクリプトが合成した偽の入力の区別（`isTrusted`）。
- **DOM ベースの挙動差**: どのイベントが即時配送で、どれが遅延・合体されるかによって、観測できる情報やタイミングが変わる。

この節では、記事の技術説明を追いながら、各トピックの終わりに「攻撃者はどこを突くのか／どう守るのか」を明示していく。

## 2. ブラウザにとっての「入力イベント」とは何か

### 2.1 入力＝あらゆるジェスチャ

「入力イベント（input events）」と聞くと、テキストボックスへのタイピングやマウスクリックだけを思い浮かべるかもしれない。しかし**ブラウザの視点では、input とはユーザーからのあらゆるジェスチャ（any gesture from the user）を意味する**。

- マウスホイールのスクロールも入力イベントである。
- タッチや mouse over（要素の上にマウスが乗る動き）も入力イベントである。

入力イベント（input event）とは、ユーザーが起こしたあらゆる操作の通知のこと。ブラウザはこれらをすべて同じ「入力」という枠組みで扱う。

### 2.2 誰が最初に受け取るのか ― 設計意図

画面へのタッチのようなジェスチャが発生したとき、**最初にそのジェスチャを受け取るのはブラウザプロセス（browser process）**である。ブラウザプロセスとは、タブの外側（ウィンドウの枠、アドレスバー、ネットワークやストレージ）を統括する特権的なプロセスのこと。

ただし、**ブラウザプロセスはそのジェスチャが「どこで」起きたかしか把握していない**。理由は、**タブの中身（content inside of a tab）はレンダラプロセス（renderer process）が扱っている**からだ。レンダラプロセスとは、1つのサイトのページ内容を描画・実行する、サンドボックス化された（権限を絞られた）プロセスのこと。

この分離は偶然ではない。ブラウザプロセスが特権を持ち、レンダラプロセスが権限を絞られているのは、悪意あるページがOSを直接触れないようにするための信頼境界（trust boundary）である。

### 2.3 どう動くのか ― 座標とイベント種別だけを渡す

ブラウザプロセスはレンダラプロセスに対して、次の2つだけを送る。

1. **イベントの種別（event type）**（例: `touchstart`）
2. **その座標（its coordinates）**

レンダラプロセスは、この2つをもとに**イベントターゲットを見つけ（finding the event target）**、**付加されているイベントリスナを実行する（running event listeners that are attached）**ことでイベントを処理する。

```
[ユーザーのタッチ]
      │
      ▼
┌─────────────────┐   種別 (例: touchstart)
│ ブラウザプロセス   │ ── + 座標 (x, y) ──┐
│ (どこで起きたか)   │                    │
└─────────────────┘                    ▼
                              ┌────────────────────┐
                              │ レンダラプロセス       │
                              │ ・イベントターゲット探索 │
                              │ ・リスナ実行           │
                              └────────────────────┘
```

これは記事の図1「Input event routed through the browser process to the renderer process（入力イベントがブラウザプロセスを経てレンダラプロセスへルーティングされる）」が示す流れである。

### 2.4 攻撃者はどこを突くのか ― イベントの出自（trusted / untrusted）

〔補足〕「ブラウザプロセスが座標＋種別だけを渡す」という分離は、イベントの出自を考えるうえで重要だ。実 OS 由来の入力から生成されたイベントは `event.isTrusted === true` になり、`dispatchEvent()` でスクリプトが人工的に発火させたイベントは `isTrusted === false` になる。`isTrusted` とは、そのイベントが本物のユーザー操作由来かどうかを示す真偽値のこと。

ブラウザが「ユーザーアクティベーション（user activation / transient activation）」を要求する API（ポップアップ、クリップボード書き込み、全画面、自動再生など）は、この信頼された入力経路に紐づいている。ユーザーアクティベーションとは、直前に本物のユーザー操作があったという状態のこと。スクリプト由来の合成イベントではこの状態を作れない。

バグハンティングでの典型的な観点は次の2つ。

- 合成イベントでユーザーアクティベーションを要求するゲート（例: クリップボード書き込み）を越えられないか。
- `isTrusted` を検証していないハンドラに、合成イベントを流し込んで副作用を起こせないか。

**守り方**: セキュリティ上重要な操作は `event.isTrusted` を確認し、合成イベントで発火しないようにする。ユーザーアクティベーションを要求するブラウザ標準の仕組みに乗せる。

## 3. コンポジタが入力を受け取る ― 非高速スクロール領域

### 3.1 なぜコンポジタが独立に動けると速いのか

前節（part 3）で見たように、コンポジタはラスタライズ済み（＝ピクセルに変換済み）のレイヤを合成することで、スクロールをスムーズに処理できる。ラスタライズとは、図形やテキストの指示を実際のピクセルの色に変換する処理のこと。

ここで重要な事実がある。

- **ページに入力イベントリスナが1つも付いていなければ、コンポジタスレッドはメインスレッドと完全に独立して（completely independent of the main thread）新しいコンポジットフレームを作成できる。**

メインスレッド（main thread）とは、レンダラプロセスの中で JavaScript の実行やレイアウト計算を担当するスレッドのこと。**JavaScript を走らせるのはメインスレッドの仕事**だ。メインスレッドが重い処理で詰まっていても、コンポジタスレッドが独立していれば、スクロールだけは滑らかに続けられる。これが「メインスレッドを待たない」ことの価値である。

問題は、**いくつかのイベントリスナがページに付いていた場合**だ。コンポジタスレッドは「このイベントは処理される必要があるのか」をどう知るのか。

### 3.2 どう動くのか ― Non-Fast Scrollable Region

答えが**非高速スクロール領域（Non-Fast Scrollable Region）**である。これは、イベントハンドラが付加されているページの領域のこと。

ページがコンポジットされるとき、コンポジタスレッドはイベントハンドラが付いた領域を "Non-Fast Scrollable Region" としてマークする。この情報を持つことで、次のように振る舞い分ける。

| 入力の発生場所 | コンポジタスレッドの振る舞い |
| --- | --- |
| 非高速スクロール領域の**内側** | 入力イベントを**確実にメインスレッドへ送る**（メインスレッドを待つ） |
| 非高速スクロール領域の**外側** | **メインスレッドを待たずに**新しいフレームのコンポジットを続行する |

記事の図3「Diagram of described input to the non-fast scrollable region（記述された入力と非高速スクロール領域の図）」は、一部だけがマークされた状態を示している。

```
┌───────────────────────────────┐
│  ページ全体                      │
│                               │
│   ┌───────────────┐           │  ← この枠の内側 = 非高速スクロール領域
│   │ リスナ付き領域   │           │    入力が来たらメインスレッドを待つ
│   └───────────────┘           │
│                               │  ← 枠の外側 = コンポジタが独立にスクロール
└───────────────────────────────┘
```

### 3.3 実測する方法

〔補足〕Chrome DevTools の **Rendering パネル → "Scrolling performance issues"** を有効にすると、非高速スクロール領域（および「repaints on scroll」などスクロール性能上の問題箇所）がページ上にオーバーレイ表示される。自分のページで実測・診断するときの第一手になる。

Chromium の実装側では、`cc/input/` 配下（例: `cc::InputHandler`、`cc::LayerTreeHostImpl`）や `main_thread_scrolling_reason`（メインスレッドスクロールに落ちた理由）という概念が対応する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Inside look at modern web browser (part 4) — https://developer.chrome.com/blog/inside-browser-part4
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress ポリシーで `developer.chrome.com` への接続が 403 で拒否された。本文は同サイトの公開ソースリポジトリの記事原稿から全文取得済みだが、レンダリング後の図版・動画・現行リンクはブラウザで開かないと見られない）。以下の記述は記事原稿（Markdown 原文）にもとづく要約である。
> **読みどころ**:
> 1. **図3・図4の対比**（一部だけがマークされた図 vs ページ全体がマークされた図）― イベント委譲の代償が一目で分かる。テキストでは伝わらない部分。
> 2. **図2の動画（Viewport hovering over page layers）** ― ビューポートがレイヤ群の上を動く様子。コンポジタが「メインスレッドを待たずにフレームを作れる」状態の直感が得られる。
> 3. **記事末尾のシリーズ・ナビゲーション** ― part 1〜3 への現行リンク。原稿中の旧 `developers.google.com` リンクは現行サイトでは書き換えられている。
> **代替手段**: 本文の内容は公開ソースリポジトリ `raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part4/index.md` から全文読める（図・動画は含まれない）。

## 4. イベント委譲というアンチパターン

### 4.1 なぜ人はイベント委譲を使うのか

ウェブ開発でよく使われる処理パターンが**イベント委譲（event delegation）**である。イベント委譲とは、個々の子要素ではなく、それらをまとめる親要素にハンドラを1つだけ付け、イベントがどの要素で起きたかで処理を振り分けるやり方のこと。

これが成り立つのは**イベントがバブルする（bubble する）**からだ。バブリングとは、ある要素で起きたイベントが、その親、さらに祖先へと順に伝わっていく性質のこと。だから最上位の要素（topmost element）に1つハンドラを付ければ、下の要素のイベントもすべて拾える。

次のようなコードを見たことがあるだろう。

```javascript
document.body.addEventListener('touchstart', event => {
    if (event.target === area) {
        event.preventDefault();
    }
});
```

すべての要素に対して1つのハンドラを書けば済むので、この人間工学（ergonomics、書きやすさ）は魅力的だ。

### 4.2 どう動くのか ― ブラウザ視点で見ると悪夢になる

ところが、このコードをブラウザの視点から見ると、いまや**ページ全体（the entire page）が非高速スクロール領域としてマークされる**。ハンドラを `document.body` に付けたので、ページのどこで入力が起きてもメインスレッドに問い合わせる必要が出るからだ。

これが意味するのは、**たとえアプリがページの特定部分からの入力をまったく気にしていなくても、入力が来るたびにコンポジタスレッドはメインスレッドと通信して待たなければならない**ということ。**したがってコンポジタのスムーズスクロール能力は無効化される（the smooth scrolling ability of the compositor is defeated）**。

これが記事の図4「Diagram of described input to the non-fast scrollable region covering an entire page（非高速スクロール領域がページ全体を覆っている図）」が示す状態である。

```
┌───────────────────────────────┐
│  ページ全体すべてが              │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │  ← 全面が非高速スクロール領域
│  ▓ document.body にリスナ1つ ▓  │    どこで入力が起きても
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │    メインスレッドを待つ
└───────────────────────────────┘
```

### 4.3 どう守る／どう直すのか ― `passive: true`

これを緩和（mitigate）するには、イベントリスナに `passive: true` オプションを渡す。これは、**「そのイベントをメインスレッドで listen したいままにしておくが、コンポジタは先に進んで新しいフレームをコンポジットしてよい」とブラウザにヒントを与える（hints to the browser）**もの。passive とは「受け身」の意味で、リスナがネイティブの挙動を妨げないと約束することを指す。

```javascript
document.body.addEventListener('touchstart', event => {
    if (event.target === area) {
        event.preventDefault()
    }
 }, {passive: true});
```

（注: 原文のコードはこのインデント・セミコロン有無のまま。`event.preventDefault()` に末尾セミコロンが無く、閉じ波括弧の前に半角スペースが1つ入っている。）

〔補足〕`passive: true` を指定したリスナ内で `preventDefault()` を呼んでも**効果はなく**、Chrome はコンソールに「Unable to preventDefault inside passive event listener invocation.」という警告を出す。また Chrome 56 以降、**`document`、`window`、`document.body` に対する `touchstart` / `touchmove`（および後に `wheel` / `mousewheel`）のリスナは、明示指定がなければ既定で passive として扱われる**（"passive by default" と呼ばれる intervention。intervention とはブラウザが性能のために介入して既定挙動を変えること）。非 passive に戻したい場合は明示的に `{passive: false}` を渡す必要がある。

### 4.4 攻撃者・診断者はどこを突くのか

〔補足〕「`preventDefault()` によるネイティブ挙動のブロック」に依存した UI ガード（例: 意図しないスクロールやジェスチャの抑止）は、passive 化（Chrome の既定 passive 介入を含む）で静かに壊れることがある。セキュリティ上の前提を `preventDefault()` に置くべきではない。診断の観点では「この UI 制限は passive 化で破れないか」を疑う。

## 5. イベントがキャンセル可能かを確認する

### 5.1 なぜ確認が要るのか

ページ内に、スクロール方向を横方向のみに制限したいボックスがあると想像してほしい（記事の図5「A web page with part of the page fixed to horizontal scroll」）。

pointer event（マウス・タッチ・ペンを統一的に扱うイベント）に `passive: true` を使うとページスクロールはスムーズになり得る。しかし、スクロール方向を制限するために `preventDefault` したいと思った時点で、**縦スクロールが既に始まっている可能性がある**。passive リスナはネイティブ挙動より先に走らないことがあるからだ。

### 5.2 どう動くのか ― `event.cancelable`

これに対しては `event.cancelable` を使ってチェックできる。`cancelable` とは、そのイベントの既定動作を `preventDefault()` で止められるかどうかを示す真偽値のこと。

```javascript
document.body.addEventListener('pointermove', event => {
    if (event.cancelable) {
        event.preventDefault(); // block the native scroll
        /*
        *  do what you want the application to do here
        */
    }
}, {passive: true});
```

〔補足〕原文は `event.cancelable` を「method（メソッド）」と呼んでいるが、実際には**プロパティ（真偽値）**である。passive リスナに配送されたイベントでは `cancelable` が `false` になる、という仕様上の挙動を利用した判定になっている。つまり「もうキャンセルできない状態」を検出して、無駄な処理を避けている。

### 5.3 もっと良い方法 ― CSS `touch-action`

あるいは、`touch-action` のような CSS ルールを使って、イベントハンドラを完全に不要にする（completely eliminate the event handler）こともできる。`touch-action` とは、要素上でブラウザがどのタッチ操作（スクロールやピンチズーム）を扱うかを宣言的に指定する CSS プロパティのこと。

```css
#area {
  touch-action: pan-x;
}
```

これは「この要素では横方向のパン（スクロール）だけ許す」という指定だ。JS のハンドラを書かずに済むため、メインスレッドを経由せずにジェスチャを制御でき、性能上有利である。

〔補足〕`touch-action` の主な値は `auto` / `none` / `pan-x` / `pan-y` / `pan-left` / `pan-right` / `pan-up` / `pan-down` / `pinch-zoom` / `manipulation` で、値の組み合わせも可能。`touch-action: none` は要素上のブラウザ既定のタッチ操作を完全に無効化する。ロジックを CSS に移すことは、性能面だけでなく「JS 側の分岐を減らす＝バグ面（bug surface）を減らす」意味でも有効だ。

## 6. ヒットテスト ― イベントターゲットの決定とクリックジャッキング

### 6.1 どう動くのか ― paint records を使う

コンポジタスレッドがメインスレッドに入力イベントを送ると、**最初に走るのはイベントターゲットを見つけるためのヒットテスト（hit test）**である。ヒットテストとは、画面上の座標 (x, y) の真下に「どの要素が描かれているか」を突き止める処理のこと。

ヒットテストは、レンダリング処理で生成された **paint records** のデータを使って、イベントが発生した点の座標の下に何があるかを突き止める。paint records（ペイントレコード）とは、描画時に「何を・どの順序で・どこに描いたか」を記録したデータのこと。

これが記事の図6「The main thread looking at the paint records asking what's drawn on x.y point（メインスレッドが paint records を見て、x,y 点には何が描かれているかを問う）」が示す状態だ。

```
入力座標 (x, y)
     │
     ▼
┌──────────────────────────┐
│ メインスレッド              │
│  paint records を参照       │
│  「(x,y) の下に何がある？」   │
│   → イベントターゲット確定    │
└──────────────────────────┘
```

### 6.2 攻撃者はどこを突くのか ― UI redressing の核心

〔補足〕ヒットテストは **UI redressing（UI の見せかけを差し替える攻撃）／クリックジャッキング**の技術的核心である。クリックジャッキングとは、ユーザーに「見えているもの」をクリックさせているつもりで、実は別の（隠された）要素をクリックさせる攻撃のこと。

攻撃側（＝診断側）がやるのは、**座標 (x, y) におけるヒットテストの結果を、ユーザーが見ている要素と一致させないこと**である。具体的な手口としては次のようなものがある。

- `opacity: 0`（見えないが存在する要素を重ねる）
- `pointer-events: none`（ある要素をヒットテストから透過させ、下の要素に当てる）
- `transform` / `clip-path`（見た目と当たり判定の位置をずらす）
- 巨大な `iframe` の位置合わせ（狙ったボタンの上に透明な iframe を重ねる）
- カーソル画像の差し替え（`cursor: url(...)` で実際のポインタ位置を誤認させる）

paint records（＝描画順・重なり順）を根拠にターゲットが決まるため、**スタッキングコンテキストと `z-index` の理解がヒットテスト結果の予測に直結する**。スタッキングコンテキストとは、要素の重なり順を決める入れ子の文脈のこと。

さらに `pointer-events: none` と `opacity: 0` は非対称に効く。前者はヒットテストから要素を透過させ（＝当たらない）、後者は視覚だけを消す（＝見えないが当たる）。この非対称性が「見えないが当たる」「見えるが当たらない」という状態を作り出す。

### 6.3 どう守るのか

クリックジャッキングの防御は次のとおり。

| 手段 | 内容 |
| --- | --- |
| `X-Frame-Options: DENY` / `SAMEORIGIN` | 自サイトを iframe に埋め込ませない（古典的だが有効） |
| CSP `frame-ancestors 'self'` | どのオリジンが自サイトを埋め込めるかを指定。`X-Frame-Options` より推奨 |
| ユーザーアクティベーション要求 | 重要操作の前に本物のユーザー操作を要求する |
| `SameSite` Cookie | クロスサイト経由の副作用（勝手なリクエスト）を抑止する |

〔補足〕CSP（Content Security Policy）とは、ページが読み込める資源や埋め込みを制限する HTTP ヘッダによるポリシーのこと。`frame-ancestors 'self'` は「自分と同じオリジンからしか iframe 埋め込みを許さない」という指定である。

## 7. メインスレッドへのディスパッチを最小化する ― 合体

### 7.1 なぜ合体が要るのか ― 入力は画面より高頻度

part 3 で見たように、典型的なディスプレイは画面を毎秒60回リフレッシュする。スムーズなアニメーションのためには、このケイデンス（cadence、拍子）に追いつく必要がある。

一方、入力側の頻度は次のとおりだ。

| 種類 | 頻度（原文の数値） |
| --- | --- |
| 典型的なディスプレイのリフレッシュ | 毎秒 **60** 回 |
| 典型的なタッチスクリーン端末のタッチイベント配送 | 毎秒 **60〜120** 回 |
| 典型的なマウスのイベント配送 | 毎秒 **100** 回 |

すなわち、**入力イベントは画面がリフレッシュできるよりも高い忠実度を持っている（Input event has higher fidelity than our screen can refresh.）**。忠実度（fidelity）とは、ここでは「どれだけ細かくサンプルを持っているか」のこと。

もし `touchmove` のような連続イベントが毎秒120回メインスレッドへ送られたら、画面のリフレッシュの遅さに比べて過剰な量のヒットテストと JavaScript 実行を引き起こしかねない。これが記事の図7「Events flooding the frame timeline causing page jank（イベントがフレームタイムラインに溢れ、ページのジャンクを引き起こす）」の状態だ。jank（ジャンク）とは、画面の引っかかり・カクつきのこと。

### 7.2 どう動くのか ― 連続イベントは rAF 直前に合体、離散イベントは即時

メインスレッドへの過剰な呼び出しを最小化するため、**Chrome は連続イベントを合体（coalesce）し、次の `requestAnimationFrame` の直前までディスパッチを遅延させる**。`requestAnimationFrame`（rAF）とは、次の画面描画の直前に一度だけコールバックを呼んでもらうためのブラウザ API のこと。合体（coalescing）とは、短時間に大量に来る同種のイベントを、1つ（または少数）にまとめること。

合体される連続イベントと、即座にディスパッチされる離散イベントは、明確に分かれている。

| 分類 | 挙動 | イベント名（原文列挙のまま） |
| --- | --- | --- |
| 連続イベント | 合体して rAF 直前まで遅延 | `wheel`, `mousewheel`, `mousemove`, `pointermove`, `touchmove` |
| 離散イベント | **即座にディスパッチ** | `keydown`, `keyup`, `mouseup`, `mousedown`, `touchstart`, `touchend` |

原文: `Any discrete events like keydown, keyup, mouseup, mousedown, touchstart, and touchend are dispatched immediately.`

これが図8「Same timeline as before but event being coalesced and delayed（先ほどと同じタイムラインだが、イベントが合体され遅延されている）」で、図7のあふれた状態が整理される様子を示す。

```
連続イベント (mousemove など):
  ● ● ● ● ● ● ●      →  [ 合体 ] → ★ (rAF 直前に1回)
  ばらばらに大量到着          まとめて配送

離散イベント (keydown など):
  ●                  →  即座に配送
```

### 7.3 攻撃者・診断者はどこを突くのか ― タイミング観測

〔補足〕この「連続イベントは rAF 直前にまとめて配送、離散イベントは即時配送」という設計は、**タイミング計測系の攻撃／診断**にも影響する。

- 合体によって `mousemove` / `pointermove` のタイムスタンプ解像度は実質フレーム単位に丸められる。そのため、マウス軌跡からのサイドチャネル推定（横取りした動きから何かを推測する手口）は精度が落ちる。
- 一方 `keydown` / `keyup` は即時配送されるため、キーストロークタイミングの観測性は相対的に高い。パスワード入力のリズムなどを観測されるリスクがある。

性能面では「rAF コールバック内で重い同期処理（強制同期レイアウト＝layout thrashing）を行うと、合体で節約したはずの時間をそこで使い潰す」という落とし穴もある。layout thrashing とは、レイアウトの読み書きを交互に繰り返してブラウザに何度も再計算させてしまう非効率のこと。

## 8. `getCoalescedEvents` でフレーム内イベントを取り出す

### 8.1 なぜ必要か

ほとんどのウェブアプリケーションでは、合体されたイベントで十分に良いユーザー体験を提供できる。

しかし、描画アプリケーション（drawing application）のようなものを作っていて、`touchmove` の座標に基づいてパス（線）を引いている場合、スムーズな線を描くための**中間座標（in-between coordinates）を失う可能性がある**。合体で間引かれた点が消えてしまうからだ。これが図9「Smooth touch gesture path on the left, coalesced limited path on the right（左: 滑らかなパス、右: 合体により座標が減った制限的なパス）」の対比である。

### 8.2 どう使うのか

その場合は、pointer event の `getCoalescedEvents` メソッドを使って、合体されたイベントの情報を取得できる。

```javascript
window.addEventListener('pointermove', event => {
    const events = event.getCoalescedEvents();
    for (let event of events) {
        const x = event.pageX;
        const y = event.pageY;
        // draw a line using x and y coordinates.
    }
});
```

`getCoalescedEvents()` は、1回の `pointermove` にまとめ込まれた「合体前の各サンプル」を配列で返す。だから間引かれる前の細かい軌跡を復元できる。

〔補足〕`getCoalescedEvents()` は Pointer Events Level 3 の API で、`PointerEvent` にのみ存在する（`MouseEvent` や `TouchEvent` には無い）。戻り値は `PointerEvent` の配列で、合体前の各サンプルを保持する。対になる API として `getPredictedEvents()`（入力予測による将来位置の推定サンプルを返す）がある。

合体イベントの取得は、指紋採取（fingerprinting、ブラウザや端末を一意に識別する試み）の観点で入力デバイスのサンプリングレートを露出させうる。そのためブラウザによっては取得条件（`isTrusted` なイベント、リスナ内での呼び出しのみ有効など）が制限される。

## 9. ブラウザに優しいコードを書くための入口

記事は最後に、性能改善の学習リソースを3つ挙げている。原文の言葉では「DevTools がなぜイベントハンドラに `{passive: true}` を追加するよう推奨するのか、あるいはなぜ script タグに `async` 属性を書くのかを考えたことがなかった人に、その理由の光を当てられたなら幸いだ」とされている。

### 9.1 Lighthouse で監査する

`Lighthouse` は任意のウェブサイトの監査（audit）を実行し、何が正しく行われていて何が改善を要するかのレポートを返すツールである。監査項目のリストを読み通すこと自体が、ブラウザがどんなことを気にしているかを知る手がかりになる。（原文リンクはサイト内相対の `/docs/lighthouse/overview/`）

### 9.2 性能の測り方を学ぶ

性能チューニングはサイトによって異なるため、自分のサイトの性能を実測し、自サイトに最も適したものを判断することが極めて重要（crucial）である。Chrome DevTools チームがサイト性能の測り方についてのチュートリアルを用意している。原文リンクは `https://developers.google.com/web/tools/chrome-devtools/speed/get-started`。〔補足〕この旧 URL は現在 `https://developer.chrome.com/docs/devtools/performance/` 系のドキュメントに移管・リダイレクトされている。

### 9.3 Feature Policy でガードレールを敷く

さらに一歩進めるなら、**Feature Policy** は「プロジェクトを構築する際のガードレール（guardrail）」になり得るウェブプラットフォーム機能である。Feature Policy とは、ページやその中の iframe が使える機能を制限する仕組みのこと。feature policy を有効にすることで、アプリの特定の振る舞いを保証し、ミスを防げる。

原文の具体例はこうだ。アプリが決してパースをブロックしないことを保証したい場合、synchronous scripts policy 下でアプリを走らせられる。`sync-script: 'none'` が有効なとき、パーサをブロックする JavaScript は実行を阻止される。これによりコードのいずれもパーサをブロックしなくなり、ブラウザはパーサの一時停止を心配しなくてよくなる。

```text
sync-script: 'none'
```

（原文リンク: `https://developers.google.com/web/updates/2018/06/feature-policy`）

〔補足〕Feature Policy はその後 **Permissions Policy** に改称・再編され、HTTP レスポンスヘッダ `Permissions-Policy:`（旧 `Feature-Policy:`）と `iframe` の `allow` 属性で指定する形になった。`sync-script` は実験的な提案で、標準化された Permissions Policy の機能一覧には残っていない。クライアントサイド脆弱性の文脈では、Permissions Policy は `camera`、`microphone`、`geolocation`、`fullscreen`、`clipboard-write` などの強力な機能を、埋め込んだサードパーティ iframe に対して無効化する**攻撃面削減（attack surface reduction）**の手段として重要である。

## 10. クライアントサイド脆弱性ハンティングへの接続（まとめ）

〔補足〕以下は本記事に明示されていないが、part 4 の知識を診断に橋渡しするための整理である。記事本文の主張と混同しないこと。

1. **イベント経路の分離＝信頼境界**: ブラウザプロセス（特権）→レンダラプロセス（サンドボックス）という分離は、Chrome のサイト分離（Site Isolation）と同じ信頼境界に乗る。入力は特権側から非特権側へ「種別＋座標」として渡されるだけなので、レンダラ側の JS が OS 由来の入力を偽造できない（`isTrusted` が守られる）。
2. **ヒットテスト＝クリックジャッキングの本質**: 「ユーザーが見ているもの」と「(x,y) のヒットテスト結果」を乖離させるのが UI redressing。防御は `X-Frame-Options` / CSP `frame-ancestors` / ユーザーアクティベーション要求 / `SameSite` Cookie。
3. **`pointer-events` と `opacity` の非対称性**: 「見えないが当たる」「見えるが当たらない」状態を作れる。
4. **passive リスナと `preventDefault` の無効化**: `preventDefault()` に依存した UI ガードは passive 化で静かに壊れる。セキュリティの前提を `preventDefault()` に置かない。
5. **イベント合体とタイミング観測**: 連続イベントは解像度が落ち、離散イベント（`keydown`/`keyup`）は即時配送で観測されやすい。
6. **入力ジャンクは DoS/UX 劣化の観測点**: `document.body` 全体への非 passive リスナや rAF 内の layout thrashing は、ページ全体を非高速スクロール領域化して応答性を破壊する。ユーザー提供の CSS/HTML を注入できる箇所は、クライアントサイド DoS の報告対象になり得る。
7. **`touch-action` による宣言的制御**: JS ハンドラを消せる＝メインスレッド往復を消せる＝バグ面を減らせる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Chromium `cc/input/`（非高速スクロール領域の実装）— https://chromium.googlesource.com/chromium/src/+/HEAD/cc/input/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限で egress プロキシが接続を拒否した）。以下の記述はソースツリー名と一般知識にもとづく要約である。
> **読みどころ**:
> 1. `non-fast scrollable region` / `main_thread_scrolling_reason` の実装側の定義 ― 記事の概念が実際のコードでどう表現されているか。
> 2. `cc::InputHandler` / `cc::LayerTreeHostImpl` ― コンポジタが入力を捌く中枢。
> **代替手段**: Chrome DevTools の Rendering パネル → "Scrolling performance issues" で、自分のページ上の非高速スクロール領域を実測できる（無料・追加不要）。

## 手を動かす

1. 適当なテストページ（自分で立てた検証環境）を Chrome で開く。バグバウンティ対象や許可のないサイトでは行わない。
2. DevTools を開き（F12 または右クリック→検証）、`Esc` キーで下部の Drawer を出し、`Rendering` タブを表示する。無ければ Drawer 左上のメニューから `Rendering` を追加する。
3. Rendering パネルの **"Scrolling performance issues"** にチェックを入れる。ページ上でイベントハンドラが付いた領域（非高速スクロール領域）がオーバーレイ表示される。
4. コンソールで次を実行し、`document.body` 全体にリスナを付けて、オーバーレイがページ全体に広がることを観察する。

   ```javascript
   document.body.addEventListener('touchstart', e => {}, {passive: false});
   ```

5. 続けて、`passive: true` にした場合との違いを比べる。既定 passive 化の影響を確かめるため、`{passive: false}` を明示した場合と、指定なしの場合の警告有無をコンソールで見る。
6. 合体イベントを観察する。次のコードを貼り、ポインタをゆっくり／速く動かして、1回の `pointermove` に含まれるサンプル数を確認する。

   ```javascript
   window.addEventListener('pointermove', e => {
     console.log(e.getCoalescedEvents().length);
   });
   ```

7. クリックジャッキングの原理を検証環境で確かめる。透明な要素（`opacity: 0`）を重ねた場合と `pointer-events: none` を付けた場合で、クリックがどの要素に「当たる」かを `document.elementFromPoint(x, y)` で確認する。

   ```javascript
   console.log(document.elementFromPoint(100, 100));
   ```

8. 防御を確認する。自分のテストサーバーで `Content-Security-Policy: frame-ancestors 'self'` を返し、別オリジンの HTML から `iframe` で埋め込もうとして、埋め込みがブロックされることを見る。

## つまずきポイント

- **「入力＝クリックとタイピングだけ」ではない**。スクロールや mouse over も入力イベント。ブラウザは全ジェスチャを同じ枠で扱う。
- **`passive: true` は「速くなる魔法」ではない**。リスナ内の `preventDefault()` が効かなくなる副作用があり、コンソール警告が出る。挙動を止めたいなら `{passive: false}` を明示するか、`touch-action` などの宣言的手段を使う。
- **既定 passive 化を忘れる**。Chrome 56 以降、`document` / `window` / `document.body` の `touchstart` / `touchmove` は明示しなければ passive 扱い。昔書いた `preventDefault()` 前提のコードが黙って壊れていることがある。
- **`event.cancelable` はプロパティであってメソッドではない**（原文は「method」と書いているが誤り）。`event.cancelable()` と呼ぶと失敗する。
- **`getCoalescedEvents()` は `PointerEvent` にしか無い**。`MouseEvent` や `TouchEvent` では使えない。
- **合体は「イベントが消える」ことではない**。rAF 直前にまとめて配送されるだけで、`getCoalescedEvents()` で中間サンプルを取り戻せる。
- **セキュリティの前提を `preventDefault()` に置かない**。passive 化で無効化されうるので、それだけを頼りにした UI ガードは信頼できない。

## この節のまとめ

- ブラウザにとっての「入力（input）」は、タイピングやクリックだけでなく、スクロール・タッチ・mouse over などあらゆるユーザージェスチャを指す。
- ジェスチャを最初に受け取るのはブラウザプロセスで、それは「どこで起きたか」しか知らない。ブラウザプロセスはレンダラプロセスへ「イベント種別＋座標」だけを渡す。
- レンダラプロセスはイベントターゲットを探し、付いているリスナを実行する。
- ページにリスナが無ければ、コンポジタスレッドはメインスレッドと独立に新フレームを作れる（＝スムーズ）。
- リスナが付いた領域は非高速スクロール領域（Non-Fast Scrollable Region）としてマークされ、その内側の入力はメインスレッドへ送られ、コンポジタは待たされる。
- イベント委譲（`document.body` に1つのハンドラ）は、ページ全体を非高速スクロール領域にしてコンポジタのスムーズスクロールを無効化する。緩和策が `passive: true`。
- passive リスナ内の `preventDefault()` は効かず警告が出る。Chrome 56 以降は主要ターゲットの touch 系リスナが既定 passive。
- passive で `preventDefault` したいときは `event.cancelable` で判定する。または CSS `touch-action`（例 `pan-x`）でハンドラ自体を不要にできる。
- メインスレッドへ入力が送られると、まずヒットテストが走る。ヒットテストは paint records を使い、座標の下に何が描かれているかを特定する。
- ヒットテストはクリックジャッキング（UI redressing）の技術的核心。`opacity`・`pointer-events`・`transform`・iframe 重ねなどで視覚とヒットテスト結果を乖離させる。防御は `X-Frame-Options` / CSP `frame-ancestors` / ユーザーアクティベーション / `SameSite` Cookie。
- 入力は画面リフレッシュ（毎秒60回）より高頻度（タッチ60〜120回、マウス100回）で、忠実度が高い。
- Chrome は連続イベント（`wheel`, `mousewheel`, `mousemove`, `pointermove`, `touchmove`）を合体し rAF 直前まで遅延、離散イベント（`keydown`, `keyup`, `mouseup`, `mousedown`, `touchstart`, `touchend`）は即時配送する。
- 描画アプリなど中間座標が要る場合は `getCoalescedEvents()` で合体前サンプルを取り出す（`PointerEvent` 限定）。
- 合体はタイミング観測に影響する。マウス軌跡のサイドチャネルは解像度が落ち、`keydown`/`keyup` はキーストロークタイミング観測に使われうる。
- Lighthouse・DevTools 性能計測・Feature Policy（現 Permissions Policy）は、ブラウザに優しく安全なコードへの入口になる。

## 理解度チェック

1. ブラウザプロセスは、レンダラプロセスに入力イベントの何を渡すか。2つ挙げよ。
   ▶ 答え: イベントの種別（例 `touchstart`）と、その座標（x, y）の2つ。ブラウザプロセスは「どこで起きたか」しか知らないため。

2. 非高速スクロール領域（Non-Fast Scrollable Region）とは何か。その内側と外側で入力の扱いはどう変わるか。
   ▶ 答え: イベントハンドラが付加されているページの領域のこと。内側で起きた入力はコンポジタが確実にメインスレッドへ送り（待つ）、外側の入力ではメインスレッドを待たずにコンポジットを続行する。

3. `document.body` に1つのリスナを付けるイベント委譲が、なぜスクロール性能を悪化させるのか。
   ▶ 答え: ページ全体が非高速スクロール領域としてマークされ、入力が来るたびにコンポジタがメインスレッドと通信して待つ必要が生じ、コンポジタのスムーズスクロール能力が無効化されるから。

4. `passive: true` を付けたリスナ内で `preventDefault()` を呼ぶとどうなるか。
   ▶ 答え: 効果がなく、Chrome はコンソールに「Unable to preventDefault inside passive event listener invocation.」という警告を出す。

5. passive リスナでスクロール方向を制限したいとき、既にスクロールが始まっているかどうかはどう判定するか。CSS で代替する方法は。
   ▶ 答え: `event.cancelable`（真偽値のプロパティ）で判定する。CSS では `touch-action`（例 `touch-action: pan-x;`）を使ってハンドラ自体を不要にできる。

6. ヒットテストは何のデータを使い、何を突き止めるか。この処理はどのクライアントサイド脆弱性の核心か。
   ▶ 答え: レンダリングで生成された paint records を使い、イベント座標の下に何が描かれているか（イベントターゲット）を突き止める。UI redressing（クリックジャッキング）の技術的核心。

7. Chrome が合体（coalesce）して rAF 直前まで遅延する連続イベントと、即座にディスパッチする離散イベントを、それぞれ挙げよ。
   ▶ 答え: 連続イベント＝`wheel`, `mousewheel`, `mousemove`, `pointermove`, `touchmove`。離散イベント＝`keydown`, `keyup`, `mouseup`, `mousedown`, `touchstart`, `touchend`。

8. 描画アプリで合体により失われた中間座標を取り戻すには、どの API を使うか。制約は。
   ▶ 答え: pointer event の `getCoalescedEvents()`。合体前の各サンプルを `PointerEvent` の配列で返す。`PointerEvent` にのみ存在し、`MouseEvent` / `TouchEvent` では使えない。

9. クリックジャッキングを防ぐ HTTP ヘッダ／ポリシーを2つ挙げ、より推奨されるのはどちらか答えよ。
   ▶ 答え: `X-Frame-Options: DENY` / `SAMEORIGIN` と、CSP の `frame-ancestors 'self'`。後者（CSP `frame-ancestors`）が推奨。

10. 入力イベントの頻度と画面リフレッシュの頻度は原文でどう示されているか。数値を答えよ。
    ▶ 答え: ディスプレイのリフレッシュは毎秒60回、タッチスクリーンのタッチイベントは毎秒60〜120回、マウスのイベントは毎秒100回。入力は画面リフレッシュより忠実度が高い。

## 出典

- https://developer.chrome.com/blog/inside-browser-part4 （記事本文。原稿は公開ソースリポジトリから全文取得）
- https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part4/index.md （記事の canonical source＝原稿）
- https://developer.chrome.com/blog/inside-browser-part3 （前提となる part 3）
- https://chromium.googlesource.com/chromium/src/+/HEAD/cc/input/ （非高速スクロール領域の実装側。本セッションからは未取得）
- https://www.chromium.org/developers/design-documents/compositor-thread-architecture/ （コンポジタスレッド設計の一次資料。本セッションからは未取得）
- https://developer.chrome.com/docs/lighthouse/overview/ （Lighthouse。原文はサイト内相対リンク）

<!-- sources: https://developer.chrome.com/blog/inside-browser-part4, https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part4/index.md, https://developer.chrome.com/blog/inside-browser-part3, https://chromium.googlesource.com/chromium/src/+/HEAD/cc/input/, https://www.chromium.org/developers/design-documents/compositor-thread-architecture/, https://developer.chrome.com/docs/lighthouse/overview/ -->
<!-- terms: 入力イベント（input events）, ブラウザプロセス（browser process）, レンダラプロセス（renderer process）, コンポジタスレッド（compositor thread）, メインスレッド（main thread）, 非高速スクロール領域（Non-Fast Scrollable Region）, イベント委譲（event delegation）, passive リスナ（passive: true）, event.cancelable, touch-action, ヒットテスト（hit test）, paint records, イベント合体（event coalescing）, requestAnimationFrame, getCoalescedEvents, getPredictedEvents, isTrusted, ユーザーアクティベーション（user activation）, クリックジャッキング（UI redressing）, X-Frame-Options, CSP frame-ancestors, Feature Policy / Permissions Policy, Lighthouse, jank, layout thrashing -->
<!-- self-read: https://developer.chrome.com/blog/inside-browser-part4 | サイト側の egress ポリシーで 403 拒否。図版・動画・現行リンクはブラウザで開かないと見られない -->
<!-- self-read: https://chromium.googlesource.com/chromium/src/+/HEAD/cc/input/ | サイト側の制限で egress プロキシが接続拒否。実装側の定義は未取得 -->
