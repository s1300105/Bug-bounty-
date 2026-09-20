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
