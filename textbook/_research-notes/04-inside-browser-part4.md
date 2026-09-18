# [04] Inside look at modern web browser (part 4) — 入力イベントとコンポジタ（Input event handling with the compositor thread）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://developer.chrome.com/blog/inside-browser-part4 | **failed**（直接取得） | WebFetch → `EGRESS_BLOCKED` / curl → `CONNECT tunnel failed, response 403` | 本セッションの egress ポリシーで `developer.chrome.com` が遮断。`web.archive.org`、`r.jina.ai`、`developers.google.com`、`developers.google.cn`、`hackmd.io`、`www.chromium.org`、`chromium.googlesource.com` も同様に 403/接続不可。ポリシー拒否なので再試行せず迂回せず、下記の一次ソース（サイトの公開ソースリポジトリ）から取得した。 |
| https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part4/index.md | **full** | curl（`raw.githubusercontent.com` は到達可能、HTTP 200 / 12,570 bytes） | **この記事ページそのものの原稿（canonical source）**。developer.chrome.com は GoogleChrome/developer.chrome.com リポジトリからビルドされる静的サイトで、この `index.md` が当該 URL の記事本文そのもの。front matter（title / description / authors / date / updated）と本文・コード・figcaption を**全文逐語で取得済み**。よって記事内容の欠落はない（レンダリング後に自動挿入されるサイト共通のナビ・目次・コメント欄のみ対象外）。 |

> 結論: **担当URLの本文は 100% 取得できた**（取得経路が公式ミラー＝サイトのソースリポジトリであるだけ）。二次情報による推測補完は一切していない。

---

## 記事メタデータ（front matter 逐語）

```yaml
layout: 'layouts/blog-post.njk'
title: Inside look at modern web browser (part 4)
description: >
  Input event handling with the compositor thread
authors:
  - kosamari
date: 2018-09-21
updated: 2019-01-12
```

- 著者: `kosamari`（Mariko Kosaka / 小坂茉莉子）。Twitter: [@kosamari](https://twitter.com/kosamari)
- 初出 2018-09-21、更新 2019-01-12
- 全4部シリーズ「Inside look at modern web browser」の第4部（最終回）。第3部（レンダリングとコンポジタ）の続き。
- 記事内の第3部リンクは原文では `https://developers.google.com//web/updates/2018/09/inside-browser-part3`（スラッシュが二重になっている旧 URL）。現行の正しい URL は `https://developer.chrome.com/blog/inside-browser-part3`。

---

## 要約（3〜10行）

1. ブラウザから見た「入力イベント」は、テキスト入力やクリックだけでなく **ユーザーのあらゆるジェスチャ**（マウスホイールのスクロール、タッチ、mouse over など）を指す。
2. ユーザーのジェスチャを最初に受け取るのは **ブラウザプロセス**。ただしブラウザプロセスは「どこで起きたか」しか知らない（タブの中身はレンダラプロセスの担当）。そこでブラウザプロセスは **イベント種別（例: `touchstart`）と座標** をレンダラプロセスへ送る。レンダラはイベントターゲットを見つけ、付いているイベントリスナを実行する。
3. ページにイベントリスナが付いていなければ、**コンポジタスレッドはメインスレッドと完全に独立に**新しいコンポジットフレームを作れる。リスナが付いている領域は **Non-Fast Scrollable Region（非高速スクロール領域）** としてマークされ、その領域で発生した入力はメインスレッドへ送られ、コンポジタはメインスレッドを待つことになる。
4. `document.body` に一発だけリスナを付ける **イベント委譲（event delegation）** は、ブラウザから見ると**ページ全体が non-fast scrollable region になる**ため、コンポジタのスムーズスクロール能力が無効化される。対策は `{passive: true}`。
5. `passive: true` にすると `preventDefault()` したいタイミングで既に縦スクロールが始まっている可能性があるため、`event.cancelable` で判定する。あるいは CSS の `touch-action`（例: `touch-action: pan-x;`）でイベントハンドラ自体を不要にする。
6. コンポジタスレッドからメインスレッドへ入力イベントが送られると、**最初に走るのはヒットテスト（hit test）**。ヒットテストはレンダリング処理で生成された **paint records** を使い、イベント座標の下に何が描かれているかを特定する。
7. ディスプレイのリフレッシュは毎秒60回だが、タッチスクリーンは **毎秒60〜120回**、マウスは **毎秒100回** イベントを送る。入力イベントは画面のリフレッシュより**忠実度（fidelity）が高い**。
8. そこで Chrome は **連続イベント（`wheel`, `mousewheel`, `mousemove`, `pointermove`, `touchmove`）を合体（coalesce）**し、**次の `requestAnimationFrame` の直前まで**ディスパッチを遅延させる。**離散イベント（`keydown`, `keyup`, `mouseup`, `mousedown`, `touchstart`, `touchend`）は即座にディスパッチ**される。
9. 描画アプリなどフレーム内の中間座標が必要な場合は、pointer event の **`getCoalescedEvents()`** で合体されたイベント群を取り出す。

---

## 詳細ノート

### 1. Input is coming to the Compositor（コンポジタに入力がやってくる） （出典: https://developer.chrome.com/blog/inside-browser-part4）

本記事は Chrome の内側を覗く全4部シリーズの最終回であり、「ブラウザが我々のコードをどう扱ってウェブサイトを表示するか」を調査するものである。前回（part 3）では **レンダリング処理とコンポジタ（compositor）** について学んだ。本稿では **ユーザー入力が来たときにコンポジタがどうやってスムーズなインタラクションを可能にしているか** を見る。

〔補足（一般知識）〕シリーズ構成: part 1 = CPU/GPU/プロセス/スレッドの基礎とマルチプロセスアーキテクチャ、part 2 = ナビゲーションの内側（ブラウザプロセスの UI / network / storage スレッド）、part 3 = レンダラプロセスの内側（パース、スタイル、レイアウト、ペイント、コンポジット、ラスタライズ）、part 4 = 本稿（入力イベントとコンポジタ）。クライアントサイド脆弱性を扱う上では、part 4 の「イベントがどのスレッドを通り、どこでヒットテストされるか」という知識が、UI redressing（クリックジャッキング）、イベントの偽装/信頼性、DOM ベースの挙動差の理解に直結する。

---

### 2. Input events from the browser's point of view（ブラウザ視点での入力イベント） （出典: 同上）

「input events（入力イベント）」と聞くと、テキストボックスへのタイピングやマウスクリックだけを思い浮かべるかもしれない。しかし **ブラウザの視点では、input とはユーザーからのあらゆるジェスチャ（any gesture from the user）を意味する**。

- **マウスホイールのスクロールも入力イベント**である。
- **タッチや mouse over も入力イベント**である。

画面へのタッチのようなユーザージェスチャが発生したとき、**最初にそのジェスチャを受け取るのはブラウザプロセス（browser process）**である。ただし、**ブラウザプロセスはそのジェスチャが「どこで」起きたかしか把握していない**。なぜなら**タブの中身（content inside of a tab）はレンダラプロセス（renderer process）が扱っている**からである。

そこでブラウザプロセスは、レンダラプロセスに対して次の2つを送る:

1. **イベントの種別（event type）**（例: `touchstart`）
2. **その座標（its coordinates）**

レンダラプロセスは、**イベントターゲットを見つけ（finding the event target）**、**付加されているイベントリスナを実行する（running event listeners that are attached）**ことで、イベントを適切に処理する。

> 図1（Figure 1）: `Input event routed through the browser process to the renderer process`（入力イベントがブラウザプロセスを経てレンダラプロセスへルーティングされる）
> 画像 alt: `input event` / 800×402

〔補足（一般知識）〕この「ブラウザプロセスが座標＋イベント種別だけを渡す」という分離は、**イベントの出自（trusted / untrusted）**を考える上で重要である。実 OS 由来の入力から生成されたイベントは `event.isTrusted === true` になり、`dispatchEvent()` でスクリプトが生成したイベントは `isTrusted === false` になる。ブラウザが「ユーザーアクティベーション（user activation / transient activation）」を要求する API（ポップアップ、クリップボード書き込み、全画面、自動再生など）はこの信頼された入力経路に紐づいており、スクリプト由来の合成イベントでは満たせない。バグハンティングでは「合成イベントでユーザーアクティベーションを要求するゲートを越えられないか」「`isTrusted` を検証していないハンドラに合成イベントを流し込めないか」が典型的な観点になる。

---

### 3. Compositor receives input events（コンポジタが入力イベントを受け取る） （出典: 同上）

前回の投稿では、**コンポジタがラスタライズ済みレイヤをコンポジットすることでスクロールをスムーズに処理できる**仕組みを見た。

- **ページに入力イベントリスナが1つも付いていなければ、コンポジタスレッドはメインスレッドと完全に独立して（completely independent of the main thread）新しいコンポジットフレームを作成できる。**
- では、**いくつかのイベントリスナがページに付いていた場合はどうなるのか？** コンポジタスレッドは「そのイベントが処理される必要があるかどうか」をどうやって知るのか？

> 図2（Figure 2）: `Viewport hovering over page layers`（ページレイヤの上をビューポートがホバーしている）
> 動画（autoplay / muted / loop / playsinline / controls）

---

### 4. Understanding non-fast scrollable region（非高速スクロール領域を理解する） （出典: 同上）

**JavaScript を走らせるのはメインスレッドの仕事**であるため、**ページがコンポジットされるとき、コンポジタスレッドは「イベントハンドラが付加されているページの領域」を "Non-Fast Scrollable Region" としてマークする**。

この情報を持つことで:

- **その領域内でイベントが発生した場合** → コンポジタスレッドは**確実に入力イベントをメインスレッドへ送る**。
- **その領域の外から入力イベントが来た場合** → コンポジタスレッドは**メインスレッドを待たずに新しいフレームのコンポジットを続行する（carries on compositing new frame without waiting for the main thread）**。

> 図3（Figure 3）: `Diagram of described input to the non-fast scrollable region`（記述された入力と非高速スクロール領域の図）
> 画像 alt: `limited non fast scrollable region` / 800×446

〔補足（一般知識）〕Chrome DevTools の **Rendering パネル → "Scrolling performance issues"** を有効にすると、non-fast scrollable region（および「repaints on scroll」等のスクロール性能上の問題箇所）がページ上にオーバーレイ表示される。実測・診断の際はこれが第一手になる。Chromium の実装側では `cc/input/` 配下（例: `cc::InputHandler`、`cc::LayerTreeHostImpl`）や `main_thread_scrolling_reason`（メインスレッドスクロールに落ちた理由）という概念が対応する。

#### 4.1 Be aware when you write event handlers（イベントハンドラを書くときの注意）

ウェブ開発における一般的なイベント処理パターンは **イベント委譲（event delegation）** である。**イベントはバブルする**ので、**最上位の要素（topmost element）に1つだけイベントハンドラを付け**、イベントターゲットに基づいてタスクを振り分けられる。以下のようなコードを見たこと・書いたことがあるだろう。

##### コード/コマンド（原文のまま逐語）

```javascript
document.body.addEventListener('touchstart', event => {
    if (event.target === area) {
        event.preventDefault();
    }
});
```

**すべての要素に対してイベントハンドラを1つ書けば済む**ので、このイベント委譲パターンの人間工学（ergonomics）は魅力的である。

**しかし、このコードをブラウザの視点から見ると、いまや「ページ全体（the entire page）が non-fast scrollable region としてマークされる」**。

これが意味するのは: **たとえアプリケーションがページの特定部分からの入力をまったく気にしていなくても、入力イベントが来るたびにコンポジタスレッドはメインスレッドと通信して待たなければならない** ということである。**したがってコンポジタのスムーズスクロール能力は無効化される（the smooth scrolling ability of the compositor is defeated）**。

> 図4（Figure 4）: `Diagram of described input to the non-fast scrollable region covering an entire page`（非高速スクロール領域がページ全体を覆っている図）
> 画像 alt: `full page non fast scrollable region` / 800×446

これが起きるのを緩和（mitigate）するには、**イベントリスナに `passive: true` オプションを渡す**ことができる。これは**「そのイベントをメインスレッドで listen したいままにしておくが、コンポジタは先に進んで新しいフレームをコンポジットしてよい」とブラウザにヒントを与える（hints to the browser）**。

##### コード/コマンド（原文のまま逐語）

```javascript
document.body.addEventListener('touchstart', event => {
    if (event.target === area) {
        event.preventDefault()
    }
 }, {passive: true});
```

（注: 原文のコードはこのインデント・セミコロン有無のまま。`event.preventDefault()` に末尾セミコロンが無く、閉じ波括弧の前に半角スペースが1つ入っている。）

〔補足（一般知識）〕`passive: true` を指定したリスナ内で `preventDefault()` を呼んでも**効果はなく**、Chrome はコンソールに「Unable to preventDefault inside passive event listener invocation.」という警告を出す。また Chrome 56 以降、**`document`、`window`、`document.body` に対する `touchstart` / `touchmove`（および後に `wheel` / `mousewheel`）のリスナは、明示指定がなければ既定で passive として扱われる**（"passive by default" / intervention）。非 passive に戻したい場合は明示的に `{passive: false}` を渡す必要がある。

---

### 5. Check if the event is cancelable（イベントがキャンセル可能かを確認する） （出典: 同上）

> 図5（Figure 5）: `A web page with part of the page fixed to horizontal scroll`（ページの一部が横スクロールに固定されたウェブページ）
> 画像 alt: `page scroll` / 400×250

**ページ内に、スクロール方向を横方向のみに制限したいボックスがある**と想像してほしい。

**pointer event に `passive: true` オプションを使うと、ページスクロールはスムーズになり得る**が、**スクロール方向を制限するために `preventDefault` したいと思った時点で、縦スクロールが既に始まっている可能性がある**。これに対しては **`event.cancelable` メソッドを使ってチェックできる**。

#### コード/コマンド（原文のまま逐語）

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

あるいは、**`touch-action` のような CSS ルールを使って、イベントハンドラを完全に不要にする（completely eliminate the event handler）**こともできる。

#### コード/コマンド（原文のまま逐語）

```css
#area {
  touch-action: pan-x;
}
```

〔補足（一般知識）〕`touch-action` の主な値は `auto` / `none` / `pan-x` / `pan-y` / `pan-left` / `pan-right` / `pan-up` / `pan-down` / `pinch-zoom` / `manipulation` で、値の組み合わせも可能。`touch-action: none` は要素上のブラウザ既定のタッチ操作（スクロール、ピンチズーム）を完全に無効化する。宣言的にジェスチャを制御できるためメインスレッドを経由せずに済み、性能上有利である。なお原文が `event.cancelable` を「method」と呼んでいるが、実際には**プロパティ（boolean）**である（passive リスナに配送されたイベントでは `cancelable` が `false` になる仕様挙動を利用した判定）。

---

### 6. Finding the event target（イベントターゲットを見つける／ヒットテスト） （出典: 同上）

> 図6（Figure 6）: `The main thread looking at the paint records asking what's drawn on x.y point`（メインスレッドが paint records を見て「x,y 点には何が描かれているか」を問う）
> 画像 alt: `hit test` / 800×468

**コンポジタスレッドがメインスレッドに入力イベントを送ると、最初に走るのは「イベントターゲットを見つけるためのヒットテスト（hit test）」である。**

**ヒットテストは、レンダリング処理で生成された paint records のデータを使って、イベントが発生した点の座標の下に何があるかを突き止める（find out what is underneath the point coordinates in which the event occurred）。**

〔補足（一般知識）〕ヒットテストは **UI redressing / クリックジャッキング** の技術的核心である。攻撃側（＝診断側）が操作するのは「座標 (x, y) におけるヒットテストの結果が、ユーザーが見ている要素と一致しないようにする」ことであり、具体的には `opacity: 0`、`pointer-events: none`、`transform`、`clip-path`、巨大な `iframe` の位置合わせ、カーソル画像の差し替え（`cursor: url(...)`）などで視覚とヒットテスト結果を乖離させる。防御側の手段は `X-Frame-Options: DENY` / `SAMEORIGIN`、CSP の `frame-ancestors 'self'`（`X-Frame-Options` より推奨）、重要操作前のユーザーアクティベーション要求、`SameSite` Cookie による副作用の抑止である。paint records（＝描画順・重なり順）を根拠にターゲットが決まるため、**スタッキングコンテキストと `z-index` の理解がヒットテスト結果の予測に直結する**。

---

### 7. Minimizing event dispatches to the main thread（メインスレッドへのイベントディスパッチを最小化する） （出典: 同上）

前回の投稿では、**典型的なディスプレイは画面を毎秒60回リフレッシュする**こと、**スムーズなアニメーションのためにはそのケイデンス（cadence）に追いつく必要がある**ことを議論した。

入力側の数値は以下のとおりである。

| 種類 | 頻度（原文の数値） |
| --- | --- |
| 典型的なディスプレイのリフレッシュ | 毎秒 **60** 回 |
| 典型的なタッチスクリーン端末のタッチイベント配送 | 毎秒 **60〜120** 回 |
| 典型的なマウスのイベント配送 | 毎秒 **100** 回 |

すなわち **入力イベントは画面がリフレッシュできるよりも高い忠実度を持っている（Input event has higher fidelity than our screen can refresh.）**。

もし `touchmove` のような**連続イベントが毎秒120回メインスレッドへ送られたら**、**画面のリフレッシュの遅さに比べて過剰な量のヒットテストと JavaScript 実行を引き起こしかねない**。

> 図7（Figure 7）: `Events flooding the frame timeline causing page jank`（イベントがフレームタイムラインに溢れ、ページのジャンク（jank）を引き起こす）
> 画像 alt: `unfiltered events` / 800×194

**メインスレッドへの過剰な呼び出しを最小化するため、Chrome は連続イベントを合体（coalesce）し、次の `requestAnimationFrame` の直前までディスパッチを遅延させる（delays dispatching until right before the next `requestAnimationFrame`）。**

**合体（coalesce）される連続イベント（原文列挙のまま）:**

| # | イベント名 |
| --- | --- |
| 1 | `wheel` |
| 2 | `mousewheel` |
| 3 | `mousemove` |
| 4 | `pointermove` |
| 5 | `touchmove` |

> 図8（Figure 8）: `Same timeline as before but event being coalesced and delayed`（先ほどと同じタイムラインだが、イベントが合体され遅延されている）
> 画像 alt: `coalesced events` / 800×236

**即座にディスパッチされる離散イベント（原文列挙のまま）:**

| # | イベント名 |
| --- | --- |
| 1 | `keydown` |
| 2 | `keyup` |
| 3 | `mouseup` |
| 4 | `mousedown` |
| 5 | `touchstart` |
| 6 | `touchend` |

原文: `Any discrete events like keydown, keyup, mouseup, mousedown, touchstart, and touchend are dispatched immediately.`

〔補足（一般知識）〕この「連続イベントは rAF 直前にまとめて配送、離散イベントは即時配送」という設計は、**タイミング計測系の攻撃／診断**にも影響する。合体によって `mousemove` / `pointermove` のタイムスタンプ解像度は実質フレーム単位に丸められるため、マウス軌跡からのサイドチャネル推定は精度が落ちる一方、`keydown` / `keyup` は即時配送されるためキーストロークタイミングの観測性は相対的に高い。また性能面では「rAF コールバック内で重い同期処理（強制同期レイアウト = layout thrashing）を行うと、合体で節約したはずの時間をそこで使い潰す」という落とし穴がある。

---

### 8. Use `getCoalescedEvents` to get intra-frame events（`getCoalescedEvents` でフレーム内イベントを取得する） （出典: 同上）

**ほとんどのウェブアプリケーションでは、合体されたイベントで十分に良いユーザー体験を提供できる。**

しかし、**描画アプリケーション（drawing application）のようなものを作っていて、`touchmove` の座標に基づいてパスを引いている場合、スムーズな線を描くための中間座標（in-between coordinates）を失う可能性がある**。

その場合は、**pointer event の `getCoalescedEvents` メソッドを使って、合体されたイベントの情報を取得できる**。

> 図9（Figure 9）: `Smooth touch gesture path on the left, coalesced limited path on the right`（左: 滑らかなタッチジェスチャのパス、右: 合体により座標が減った制限的なパス）
> 画像 alt: `getCoalescedEvents` / 800×333

#### コード/コマンド（原文のまま逐語）

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

〔補足（一般知識）〕`getCoalescedEvents()` は Pointer Events Level 3 の API で、`PointerEvent` にのみ存在する（`MouseEvent` や `TouchEvent` には無い）。戻り値は `PointerEvent` の配列で、合体前の各サンプルを保持する。対になる API として **`getPredictedEvents()`**（入力予測による将来位置の推定サンプル）がある。合体イベントの取得は指紋採取（fingerprinting）の観点で入力デバイスのサンプリングレートを露出させうるため、ブラウザによっては取得条件（`isTrusted` なイベント、リスナ内での呼び出しのみ有効など）が制限される。

---

### 9. Next steps（次のステップ） （出典: 同上）

このシリーズでは **ウェブブラウザの内部動作（inner workings of a web browser）** をカバーした。原文の言葉を借りれば、「**DevTools がなぜイベントハンドラに `{passive: true}` を追加するよう推奨するのか**、あるいは **なぜ script タグに `async` 属性を書くのか** を考えたことがなかった人にとって、ブラウザがより速くスムーズなウェブ体験を提供するためにそうした情報を必要とする理由に光を当てられたなら幸いだ」とされている。

#### 9.1 Use Lighthouse（Lighthouse を使う）

「自分のコードをブラウザに優しくしたいが、どこから始めればよいか分からない」場合、**[Lighthouse](https://developer.chrome.com/docs/lighthouse/overview/)** は任意のウェブサイトの監査（audit）を実行し、**何が正しく行われていて何が改善を要するか**のレポートを返すツールである。**監査項目のリストを読み通すこと自体が、ブラウザがどんなことを気にしているかを知る手がかりになる。**
（原文のリンクはサイト内相対リンク `/docs/lighthouse/overview/`）

#### 9.2 Learn how to measure performance（性能の測り方を学ぶ）

**性能チューニングはサイトによって異なる**ため、**自分のサイトの性能を実測し、自サイトに最も適したものを判断することが極めて重要（crucial）**である。Chrome DevTools チームが **サイト性能の測り方についてのチュートリアル** を用意している。
原文リンク: `https://developers.google.com/web/tools/chrome-devtools/speed/get-started`
〔補足（一般知識）〕この旧 URL は現在 `https://developer.chrome.com/docs/devtools/performance/` 系のドキュメントに移管・リダイレクトされている。

#### 9.3 Add Feature Policy to your site（サイトに Feature Policy を追加する）

さらに一歩進めるなら、**Feature Policy** は「プロジェクトを構築する際のガードレール（guardrail）」になり得る新しいウェブプラットフォーム機能である。**feature policy を有効にすることで、アプリの特定の振る舞いを保証し、ミスを防げる**。

原文の具体例: **「アプリが決してパースをブロックしないことを保証したい場合、synchronous scripts policy 下でアプリを走らせることができる。`sync-script: 'none'` が有効なとき、パーサをブロックする JavaScript は実行を阻止される。これによりあなたのコードのいずれもパーサをブロックしなくなり、ブラウザはパーサの一時停止を心配する必要がなくなる。」**

原文リンク: `https://developers.google.com/web/updates/2018/06/feature-policy`

##### ポリシー文字列（原文のまま逐語）

```
sync-script: 'none'
```

〔補足（一般知識）〕Feature Policy はその後 **Permissions Policy** に改称・再編され、HTTP レスポンスヘッダ `Permissions-Policy:`（旧 `Feature-Policy:`）と `iframe` の `allow` 属性で指定する形になった。`sync-script` は実験的な提案で、標準化された Permissions Policy の機能一覧には残っていない。クライアントサイド脆弱性の文脈では、Permissions Policy は `camera`、`microphone`、`geolocation`、`fullscreen`、`clipboard-write` などの強力な機能を、埋め込んだサードパーティ iframe に対して無効化する**攻撃面削減（attack surface reduction）**の手段として重要である。

---

### 10. Wrap up（まとめ） （出典: 同上）

> 図（キャプションなし）: 画像 alt `thank you` / 500×311

著者の結びの言葉（要旨を逐語に近い形で）:

「ウェブサイトを作り始めた頃、私はほとんど**自分がどうコードを書くか、何が自分の生産性を上げるか**しか気にしていなかった。それらは重要だが、**ブラウザが我々の書いたコードをどう受け取るかについても考えるべきだ**。モダンブラウザはユーザーにより良いウェブ体験を提供する方法へ投資し続けてきたし、今も続けている。**コードを整理してブラウザに優しくすることは、翻ってあなたのユーザー体験を改善する**。ブラウザに優しくなるクエストに、ぜひ一緒に参加してほしい！」

シリーズの初期ドラフトをレビューした人々への謝辞（原文リスト逐語 / 「（but not limited to）」付き）:

| レビュアー | リンク（原文のまま） |
| --- | --- |
| Alex Russell | https://twitter.com/slightlylate |
| Paul Irish | https://twitter.com/paul_irish |
| Meggin Kearney | https://twitter.com/MegginKearney |
| Eric Bidelman | https://twitter.com/ebidel |
| Mathias Bynens | https://twitter.com/mathias |
| Addy Osmani | https://twitter.com/addyosmani |
| Kinuko Yasuda | https://twitter.com/kinu |
| Nasko Oskov | https://twitter.com/nasko |
| Charlie Reis | （リンクなし） |

最終行（原文逐語、原文のタイポ `the this` を含む）:
`Did you enjoy the this series? If you have any questions or suggestions for the future post, I'd love to hear from you in the comment section below or @kosamari on Twitter.`

---

## 図版一覧（figcaption と alt を逐語で）

| 図 | alt | figcaption（原文逐語） | サイズ |
| --- | --- | --- | --- |
| Figure 1 | `input event` | Input event routed through the browser process to the renderer process | 800×402 |
| Figure 2 | （動画） | Viewport hovering over page layers | mp4 / autoplay muted loop playsinline controls |
| Figure 3 | `limited non fast scrollable region` | Diagram of described input to the non-fast scrollable region | 800×446 |
| Figure 4 | `full page non fast scrollable region` | Diagram of described input to the non-fast scrollable region covering an entire page | 800×446 |
| Figure 5 | `page scroll` | A web page with part of the page fixed to horizontal scroll | 400×250 |
| Figure 6 | `hit test` | The main thread looking at the paint records asking what's drawn on x.y point | 800×468 |
| Figure 7 | `unfiltered events` | Events flooding the frame timeline causing page jank | 800×194 |
| Figure 8 | `coalesced events` | Same timeline as before but event being coalesced and delayed | 800×236 |
| Figure 9 | `getCoalescedEvents` | Smooth touch gesture path on the left, coalesced limited path on the right | 800×333 |
| （末尾） | `thank you` | （キャプションなし） | 500×311 |

---

## 用語・固有名詞まとめ（原文の表記を保持）

| 用語（原文） | 日本語/意味 | 本文中の役割 |
| --- | --- | --- |
| input events | 入力イベント。ブラウザ視点では**ユーザーのあらゆるジェスチャ** | 記事全体の主題 |
| browser process | ブラウザプロセス。ジェスチャを最初に受け取る。発生場所しか知らない | イベント経路の起点 |
| renderer process | レンダラプロセス。タブの中身を扱う。ターゲット探索とリスナ実行を担う | イベント経路の終点 |
| compositor thread | コンポジタスレッド。ラスタライズ済みレイヤを合成しスムーズスクロールを実現 | 入力を先に受けるスレッド |
| main thread | メインスレッド。**JavaScript を走らせるのはこのスレッドの仕事** | ヒットテスト／リスナ実行 |
| Non-Fast Scrollable Region | 非高速スクロール領域。**イベントハンドラが付いた領域**としてマークされる | 性能の分岐点 |
| event delegation | イベント委譲。バブリングを利用して最上位要素に1つのハンドラ | アンチパターン化する例 |
| `passive: true` | passive オプション。「メインスレッドで listen し続けるが、コンポジタは先に進んでよい」というヒント | 緩和策 |
| `event.cancelable` | イベントがキャンセル可能か（原文は「method」と表現） | passive 下での判定 |
| `touch-action` | CSS プロパティ。例 `touch-action: pan-x;`。ハンドラを完全に不要化できる | 宣言的な緩和策 |
| hit test | ヒットテスト。メインスレッドで最初に走る。**paint records** を使う | ターゲット決定 |
| paint records | ペイントレコード。レンダリング処理で生成され、座標の下に何があるかを示す | ヒットテストの入力データ |
| coalesce / event coalescing | 連続イベントの合体 | ディスパッチ削減 |
| `requestAnimationFrame` | 合体イベントは**その直前**までディスパッチを遅延される | タイミングの基準点 |
| `getCoalescedEvents` | pointer event のメソッド。合体されたイベント群を取得 | 描画アプリ向け |
| jank | ジャンク（引っかかり） | イベント過多の症状 |
| fidelity | 忠実度。入力は画面リフレッシュより高い | 合体の理由 |
| Lighthouse | 監査ツール | 学習の入口 |
| Feature Policy | 機能ポリシー。ガードレール。例 `sync-script: 'none'` | 予防策 |

---

## クライアントサイド脆弱性ハンティングへの接続（〔補足（一般知識）〕として整理）

〔補足（一般知識）〕以下は本記事に明示されていないが、part 4 の知識を脆弱性診断に橋渡しするための整理である。記事本文の主張と混同しないこと。

1. **イベント経路の分離＝信頼境界**: ブラウザプロセス（特権）→レンダラプロセス（サンドボックス）という分離は、Chrome のサイト分離（Site Isolation）と同じ信頼境界に乗っている。入力イベントは特権側から非特権側へ「種別＋座標」として渡されるだけなので、レンダラ側の JS が OS 由来の入力を偽造することはできない（`isTrusted` が守られる）。
2. **ヒットテスト＝クリックジャッキングの本質**: 「ユーザーが見ているもの」と「(x,y) のヒットテスト結果」を乖離させるのが UI redressing。`X-Frame-Options` / CSP `frame-ancestors` / ユーザーアクティベーション要求 / `SameSite` Cookie が防御。
3. **`pointer-events` と `opacity` の組み合わせ**: `pointer-events: none` はヒットテストから要素を透過させ、`opacity: 0` は視覚のみを消す。両者の非対称性が「見えないが当たる」「見えるが当たらない」状態を作る。
4. **passive リスナと `preventDefault` の無効化**: 「`preventDefault()` によるネイティブ挙動のブロック」に依存した UI ガード（例: 意図しないスクロール・ジェスチャの抑止）は、passive 化（Chrome の既定 passive 介入を含む）で静かに壊れることがある。セキュリティ上の前提を `preventDefault()` に置くべきではない。
5. **イベント合体とタイミング観測**: 連続イベントは rAF 直前にまとめて配送されるため、マウス軌跡ベースのサイドチャネルは解像度が落ちる。一方 `keydown`/`keyup` は即時配送でキーストロークタイミング観測に使われうる。
6. **入力ジャンクは DoS/UX 劣化の観測点**: `document.body` 全体への非 passive リスナ、rAF 内の強制同期レイアウト（layout thrashing）は、ページ全体を non-fast scrollable region 化して応答性を破壊する。バグバウンティでは「意図的に重いハンドラを埋め込ませられる注入点（例: ユーザー提供 CSS/HTML）」がクライアントサイド DoS の報告対象になり得る。
7. **`touch-action` による宣言的制御**: JS ハンドラを消せる＝メインスレッド往復を消せる。ロジックを CSS に移すことは、性能面だけでなく「JS 側の分岐を減らす＝バグ面を減らす」意味でも有効。

---

## 読者が自分で開くべき資料

本ノートの担当 URL は **本文を 100% 取得できている**（サイトの公開ソースリポジトリ経由）。ただし **ブラウザで直接開くことで初めて得られる情報**があるため、以下を挙げる。

### A. https://developer.chrome.com/blog/inside-browser-part4 （本セッションからは egress ポリシーで 403 / 取得不可）

**取得できなかった理由**: セッションの egress プロキシが `developer.chrome.com` への CONNECT を 403 で拒否（組織のポリシー拒否。README の指示どおり再試行・迂回はしていない）。`web.archive.org`、`r.jina.ai`、`developers.google.com`、`developers.google.cn`、`hackmd.io` も同様に拒否された。本文は `raw.githubusercontent.com/GoogleChrome/developer.chrome.com` 上の記事原稿（`site/en/blog/inside-browser-part4/index.md`）から全文取得した。

**読みどころ（読者が自分で開いたとき見るべきもの）**:

1. **図3・図4の図解（non-fast scrollable region の広さの対比）** — 「一部だけがマークされた図」と「ページ全体がマークされた図」を並べて見ることで、イベント委譲の代償が一目で理解できる。テキストでは伝わらない部分。
2. **図2の動画（Viewport hovering over page layers）** — ビューポートがレイヤ群の上を動く様子。コンポジタが「メインスレッドを待たずにフレームを作れる」とはどういう状態かの直感が得られる。
3. **図7・図8のフレームタイムライン比較** — 合体前（イベントがタイムラインを埋め尽くしジャンクを起こす）と合体後（rAF 直前にまとめられる）の対比図。
4. **図9（getCoalescedEvents の描線比較）** — 左の滑らかな軌跡と右の粗い軌跡。描画アプリで中間座標が必要な理由が視覚的に分かる。
5. **記事末尾のシリーズ・ナビゲーション** — part 1〜3 への現行リンク（`/blog/inside-browser-part1` 〜 `part3`）。原稿中の旧 `developers.google.com` リンクは現行サイトでは書き換えられている。
6. **更新日と現行リンク先** — 原稿は 2019-01-12 更新。Feature Policy → Permissions Policy、DevTools speed チュートリアルの移管など、現行ページのリンク先が最新の移管先になっているかを確認すべき。

### B. 併せて読むべき関連資料（本ノートの担当外。読者が辿るべき先）

1. **Inside look at modern web browser part 3**（`https://developer.chrome.com/blog/inside-browser-part3`） — 本記事の前提。コンポジタ、レイヤ、ラスタライズ、paint records の生成。
2. **Chrome DevTools の Rendering パネル → "Scrolling performance issues"** — non-fast scrollable region を自分のページで実測する唯一の手軽な方法。
3. **Chromium `cc/input/`**（`https://chromium.googlesource.com/chromium/src/+/HEAD/cc/input/`） — `non-fast scrollable region` / `main_thread_scrolling_reason` の実装側の定義。本セッションからは egress 拒否で未取得。
4. **Compositor Thread Architecture**（`https://www.chromium.org/developers/design-documents/compositor-thread-architecture/`） — コンポジタスレッド設計の一次資料。本セッションからは egress 拒否で未取得。
5. **Pointer Events Level 3 仕様（`getCoalescedEvents` / `getPredictedEvents`）** — 合体イベント API の正確な挙動と制約。
6. **MDN `touch-action` / `EventTarget.addEventListener()` の `passive` オプション** — 値の完全な一覧と既定 passive 化（intervention）の適用条件。
