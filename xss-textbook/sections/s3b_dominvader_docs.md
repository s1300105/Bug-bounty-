## DOM Invader実践（Burp公式ドキュメント）

このセクションでは、PortSwigger（Burp Suite の開発元）が提供するブラウザ内蔵ツール **DOM Invader（ドム・インベーダー）** を使って、DOM ベース XSS（クロスサイトスクリプティング）を体系的に発見・検証する方法を、公式ドキュメントに沿って詳しく解説する。DOM ベース XSS の理論（source と sink、データフロー）は本章の前節までで扱った前提知識とし、ここでは「実際にどう見つけるか」という実務に踏み込む。

> ℹ️ **本セクションの資料取得についての注記**
> 執筆にあたり、指定された PortSwigger 公式ドキュメント 3 本を直接取得しようとしたが、実行環境のネットワーク制限（egress プロキシによる `portswigger.net` へのアクセス遮断）により本文の直接取得ができなかった。そのため、手順の指示に従い WebSearch による検索結果のスニペット・二次言及から各ページの技術的内容を復元して記述している。復元により各ページの実質的な内容（機能一覧・手順・ペイロード例）は得られたため「取得不可」扱いにはしていないが、UI の細部（最新版でのボタン名の変更など）は原典と差異が生じる可能性があるため、各小節末尾の出典 URL をご自身でも確認されたい。

---

### DOM Invader が解決する問題 — なぜ専用ツールが要るのか

DOM ベース XSS（クライアント側の JavaScript が、攻撃者の制御可能なデータを危険な代入先へ渡してしまうことで起きる XSS）は、反射型・格納型の XSS と違って「サーバのレスポンス HTML を見ても脆弱性が見えない」という厄介な性質を持つ。攻撃の全過程がブラウザ内の JavaScript 実行中に起きるためだ。

手作業で DOM ベース XSS を探す場合、テスターは次の 2 点を追わなければならない。

- **source（ソース／入力の入口）**: 攻撃者が値を注入できる場所。例: `location.search`（URL のクエリ文字列）、`location.hash`（URL の `#` 以降のフラグメント）、`document.referrer`、`window.name`、`postMessage()` で受け取る web message など。
- **sink（シンク／危険な出口）**: そのユーザー入力が最終的に実行・解釈される危険な代入先。例: `element.innerHTML`（HTML として解釈される）、`eval()`（JavaScript として実行される）、`document.write()`、`location.href`（`javascript:` URL を実行しうる）など。

問題は、source から sink までのデータの流れ（データフロー）が、しばしば**数千行に及ぶ難読化・ミニファイ（minify: 変数名を短縮し空白を除去した圧縮）された JavaScript の中を、複数の関数呼び出しをまたいで**通ることだ。これを人間が目視で追い切るのは現実的でない。

DOM Invader はこの「データフロー追跡」を自動化する。仕組みの核心は **canary（カナリア）** と呼ばれる目印文字列である。canary を source に注入し、ブラウザが実際にコードを実行した結果、その canary が**どの sink に到達したか**を DOM Invader が横取りして一覧表示する。これにより、あたかも反射型 XSS を探すかのように「入れた値がどこに出たか」を直接観察できる。ソースコードを一行ずつ読む必要がなくなる、というのが DOM Invader の中心的価値である。

> 出典: Testing for DOM XSS — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
> 出典: Introducing DOM Invader: DOM XSS just got a whole lot easier to find — https://portswigger.net/blog/introducing-dom-invader

補足として、DOM Invader は **2020 年に公開**された比較的新しいツールであり、当初の DOM XSS 検出に加え、その後のバージョンで **web message 経由の検出**、**クライアント側 prototype pollution（プロトタイプ汚染）** や **DOM clobbering（DOM クロバリング）** の検出機能が順次追加されてきた。バージョンによって利用できる機能・UI が異なる点に注意すること。

---

### DOM Invader とは何か（機能全体像）

DOM Invader は、Burp Suite に**内蔵されたブラウザ（built-in browser、Chromium ベース）専用の拡張機能**として最初からインストールされている、ブラウザ内で動作する DOM XSS テストツールである。外部のブラウザには入れられず、Burp の内蔵ブラウザからのみ利用できる点が特徴だ。DOM Invader は多様な source と sink を対象に DOM XSS を検出し、web message ベクトルと prototype pollution ベクトルの両方にも対応する。

主要な機能は次のとおり。

- **Augmented DOM（拡張 DOM ビュー）**
  ブラウザの開発者ツール（DevTools）に DOM Invader 専用タブを追加し、ターゲット内に存在するすべての source と sink を一覧表示する。通常の DOM ツリー表示に、DOM Invader が検出した「ここは source」「ここは sink」という注釈（augment）を重ねて見せてくれる。興味のある sink を見つけたら、そこに渡された値（Value）と、その値が渡された経路を示す **stack trace（スタックトレース: 関数呼び出しの履歴）** を確認でき、canary をハイライト表示してくれる。反射型 XSS を探すのと同じ感覚で「sink に流れ込んだ値」を検査できる。

- **web message のテスト**
  ページ上で `postMessage()` により送受信される web message をすべてログに記録する。さらに、Burp Repeater で HTTP リクエストを改変・再送するのと同じように、**web message を改変して再送**できる。これにより、web message を source とする DOM XSS を手軽に探索できる。手動での改変・再送に加え、DOM Invader が**自動で web message を改変・送信**して脆弱性を探す機能もある。

- **自動プロービング（自動探索）**
  既定では、通常の DOM XSS の source と sink を自動的に探索する。設定を有効にすると、それに加えて**クライアント側 prototype pollution の source を自動的に特定**しようとする。

- **prototype pollution / DOM clobbering の検出**
  攻撃タイプを追加で有効化することで、`Object.prototype` に任意のプロパティを追加できてしまう prototype pollution の source と、それを悪用できる gadget（ガジェット: 汚染したプロパティを読み取って危険な動作をするコード片）を自動走査したり、DOM clobbering（HTML 要素の `id`/`name` 属性でグローバル変数を上書きし、JavaScript の変数参照を乗っ取る攻撃）を自動検出したりできる。

- **高い設定自由度**
  サイトごと・用途ごとに挙動を細かく調整できる。既定でオフの機能が多いのは、canary 注入やイベント自動発火などがターゲットサイトの通常動作を壊してしまい、他のテストを妨げる場合があるためである。

> 出典: DOM Invader — https://portswigger.net/burp/documentation/desktop/tools/dom-invader
> 出典: Testing for DOM XSS — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss

---

### 有効化と基本設定

#### DOM Invader を有効にする

DOM Invader は内蔵ブラウザにプリインストールされているが、**既定では無効**になっている（前述のとおり、一部機能が他のテストを妨げうるため）。有効化の手順は次のとおり。

1. Burp の **Proxy > Intercept** タブを開き、そこから Burp の**内蔵ブラウザ（Burp's browser）を起動**する。
2. ブラウザウィンドウの**右上にある Burp Suite のロゴ**をクリックする。パネルが開き、「Burp Suite Navigation Recorder」と「DOM Invader」の設定タブが表示される。
3. **DOM Invader タブ**に切り替え、トグルスイッチを **On** にする。
4. **Reload（再読み込み）** をクリックしてブラウザを更新する。設定を反映させるにはこの再読み込みが必須である。

設定メニューへは、いつでも右上の Burp Suite ロゴをクリック → DOM Invader タブ、で戻れる。

> なぜ再読み込みが必要か: DOM Invader はページの JavaScript 実行環境に自身のフック（source/sink になりうる関数を横取りする仕掛け）を仕込む。この仕込みはページが読み込まれる**前**に注入される必要があるため、設定変更後は必ずページを再読み込みして、フックが効いた状態でスクリプトを走らせ直す必要がある。

#### canary の設定

設定メニューの下部に、DOM Invader が現在追跡している canary 文字列（ランダム生成された英数字列）が表示される。この canary は**任意の独自文字列に置き換え可能**であり、自分で決めた覚えやすい・ぶつかりにくい文字列を追跡させることもできる。

> canary を変更したいケース: 既定のランダム文字列がたまたまページ内の別の文字列と衝突して誤検出を招く場合や、複数のパラメータの流れを人間側でも区別したい場合に、独自 canary が役立つ。

#### Misc（その他）設定 — 挙動を左右する重要オプション

Misc セクションでは、テストの精度と副作用に直結する次のようなオプションを制御できる。

- **source への canary 自動注入（Auto inject canary in sources）**
  有効にすると、ページ上で特定された source すべてに canary を自動的に注入する。しかもソースごとに canary の末尾へ**固有の文字列を付け足す**ため、「どの source が、どの sink に流れ込んだか」を一目で対応付けられる。
  > 仕組み上の利点: 単一の canary だと複数の source が同じ sink に合流したときに区別できないが、source ごとに末尾を変えることで sink 側に現れた文字列を見るだけで発生元を逆引きできる。

- **重複スタックトレースの非表示（Hide duplicate stack traces）**
  有効にすると、各エントリのスタックトレースを比較し、コード上の**同じ場所**を指す重複エントリを隠す。ノイズを減らして本質的な sink に集中できる。

- **イベントの自動発火（Auto-fire events）**
  有効にすると、ページ読み込み直後に**すべての要素に対して `click` と `mouseover` イベントを自動発火**する。ユーザー操作を起点に初めて実行される（＝操作しないと現れない）source/sink を炙り出すのに有効。
  > 副作用に注意: 全要素をクリック・マウスオーバーするため、リンク遷移やフォーム送信など望まぬ動作を誘発することがある。テスト対象を壊しうる操作なので、必要なときだけ使う。

- **リダイレクトの防止（Redirection prevention）**
  有効にすると、クライアント側リダイレクト（JavaScript による `location` 変更などのページ遷移）を**ブロックして同じページに留まる**。ただし例外として、`javascript:` URL への遷移や、後述の **Inject URL ボタン**が起こす遷移は通常どおり動く。
  > なぜ必要か: DOM XSS のテスト中に対象コードが別ページへ飛ばしてしまうと、sink の観察が中断される。留まることで腰を据えて検証できる。`javascript:` を例外にしているのは、それ自体が実行される sink の検証に不可欠だからである。

#### 攻撃タイプ（Attack types）の有効化

Attack types セクションで、既定の DOM XSS 検出に加えて追加の攻撃探索を有効化できる。

- **Prototype pollution（プロトタイプ汚染）**: トグルを On にして Reload すると、`Object.prototype` に任意プロパティを追加できる source をページから自動チェックする。DOM Invader は複数の汚染テクニックを使うが、**すべてを同時に使うとサイトによっては攻撃が成立しなくなる**ことがあるため、一部を無効化する・一度に 1 テクニックだけ使う、といった調整が推奨される。
- **DOM clobbering**: トグルを On にすると DOM clobbering 脆弱性を自動特定しようとする。ターゲットサイトの機能を壊す可能性があるため、**既定では無効**になっている。

> 出典: Enabling DOM Invader — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/enabling
> 出典: DOM Invader canary settings — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/canary
> 出典: Miscellaneous DOM Invader settings — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/misc
> 出典: DOM Invader attack types — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/attack-types

---

### DOM ベース XSS の検出手順（source → sink）

ここが DOM Invader の中核機能である。標準的な source（URL パラメータやフォーム入力など）が sink に流れ込んで XSS になるケースを検出する流れを、原理とともに追う。

#### canary の仕組み — なぜ「入れた値がどこに出たか」が分かるのか

DOM Invader は、canary（他とぶつかりにくい、任意の英数字列。「目印」）を source に注入し、ページの JavaScript が実際に実行された結果、その canary が **DOM のどこに・どの sink 関数へ**現れたかを監視する。DOM Invader は DOM を自動的に解析し、あらかじめ定めた canary 文字列の出現箇所を探し出す。

> 原理: DOM Invader は `innerHTML`、`eval`、`document.write`、`location` 代入などの「危険な代入先＝sink になりうる操作」をあらかじめ**フック（横取り）**している。フックされた関数に値が渡されるたびに、その値の中に canary が含まれていれば「source に入れた文字列がここまで到達した」と判定できる。人間がデータフローを追う代わりに、ブラウザの実行そのものに語らせるアプローチである。

#### 基本ワークフロー

1. **canary をコピーする**: DOM Invader タブを選び、**Copy canary（カナリアをコピー）** をクリックする。
2. **canary を source に注入する**: 疑わしい source（URL のクエリパラメータ、`#` フラグメント、フォーム入力欄など）に canary を貼り付ける。
3. **制御可能な sink を特定する**: DOM ビュー（Augmented DOM）に現れる sink の一覧から、canary が到達した sink を探す。
4. **XSS コンテキストを判定する**: sink エントリの **Value 列**を見て、canary が「どんな文脈」で出力されているかを読み取る。属性値の中なのか、タグの外なのか、`<script>` 内なのか、`javascript:` URL としてなのか、で必要なエスケープ・突破手法が変わる。
5. **エクスプロイトを組み立てる**: 判定した XSS コンテキストに合わせた文字列を source に入れ直し、実際に実行できるか（例: `alert()` や `print()` が発火するか）を確認する。

#### sink 詳細ビューで得られる情報

興味深い sink を見つけると、DOM Invader はその sink に入った値と、そこへ至る**スタックトレース**を表示し、canary をハイライトしてくれる。sink の種類に応じて、次のような詳細も確認できる。

- **Outer HTML**: canary を囲んでいる HTML 要素。どのタグ・属性の内側に出力されているかが分かる（＝どこを閉じてブレイクアウトすべきかが分かる）。
- **Frame path**: canary が sink に渡された際の**フレーム（iframe など）のパス**。どのドキュメント内で起きているかを示す。
- **Event**: canary が sink に渡されるきっかけとなった JavaScript の**イベント**（例: クリック時に発火する処理など）。

これらの情報から、XSS コンテキストと、エクスプロイトに必要な文字（`<`, `>`, `"` など）やイベントを容易に判別できる。

#### テストを加速する自動機能

- **Inject URL params（URL パラメータへの自動注入）**: URL のすべてのクエリパラメータに canary を自動注入する。しかも**パラメータごとに別タブ**を使って注入するため、どのパラメータが sink に届くかを個別に確認できる。
- **Inject forms（フォームへの自動注入）**: ページ上で検出された HTML フォームの入力欄すべてに canary を自動注入する。
- **sink に送られた値の検索**: sink へ渡された値の中から特定文字列を検索できる。
- **canary の source 自動注入**（前述の Misc 設定）: source ごとに固有末尾を付けて注入し、発生元を逆引きしやすくする。

#### 実行と PoC 生成（Exploit / Build PoC）

DOM Invader は、確認した脆弱性から**動作するエクスプロイト（概念実証: PoC）をボタン一つで生成**できる。sink の隣にある **Exploit** ボタンや **Build PoC** ボタンを押すと、source・（prototype pollution の場合は）gadget・sink を組み合わせた PoC が生成され、クリップボードにコピーされる。とくに prototype pollution では、DOM Invader が gadget を見つけると、source＋gadget＋sink を自動連結して XSS を確定させる PoC を自動生成できる。

#### 具体例で理解する

たとえば URL に `?search=<canary>` の形で canary を注入したところ、DOM ビューに `innerHTML` sink が現れ、Value 列でその canary が次のように `<div>` 内へそのまま出力されていたとする。

```html
<div id="results">canary文字列</div>
```

これは canary が HTML 要素の**中身（要素コンテンツ）としてそのまま解釈されている**ことを意味する。属性の内側でもスクリプト内でもないため、新しいタグを直接注入できる。そこで source（`search` パラメータ）に次を入れる。

```html
<img src=1 onerror=alert(document.domain)>
```

これが動く理由: `innerHTML` に代入された文字列はブラウザの HTML パーサによって**その場で HTML として再解釈**される。`<img>` の `src=1` は必ず読み込みに失敗するため、失敗時に発火する `onerror` イベントハンドラの JavaScript が実行される。`<script>` タグは `innerHTML` 経由では（仕様上）実行されないため、代わりにイベントハンドラ属性を持つ要素（`img`/`svg` など）を使うのが定石である。

もし Value 列で canary が二重引用符属性の内側（例: `<input value="canary文字列">`）に出ていたなら、まず属性を閉じてタグをブレイクアウトする必要がある。

```html
"><img src=1 onerror=alert(1)>
```

これが動く理由: 先頭の `">` で、開いていた `value="..."` 属性と `<input` タグを閉じ、直後に新しい `<img>` 要素を注入している。属性コンテキストからタグコンテキストへ「脱出（ブレイクアウト）」してから攻撃タグを置く、という XSS の基本手筋である。

> 出典: Testing for DOM XSS — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
> 出典: Testing for DOM XSS with DOM Invader — https://portswigger.net/burp/documentation/desktop/testing-workflow/input-validation/xss/dom-xss
> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader

---

### web message 経由の DOM ベース XSS の検出

DOM Invader の真価がとくに発揮されるのが、**web message（ウェブメッセージ）** を source とする DOM XSS の検出である。これは手作業では非常に見つけにくいため、専用機能の恩恵が大きい。

#### 前提: postMessage と web message の仕組み

`postMessage()` は、**異なるオリジン（プロトコル＋ホスト＋ポートの組。例: `https://a.example` と `https://b.example` は別オリジン）に属するウィンドウ／iframe 同士が、安全に文字列データをやり取りするためのブラウザ API** である。送信側は次のように書く。

```javascript
// 送信側: targetWindow へメッセージを送る
targetWindow.postMessage(data, targetOrigin);
```

受信側は `message` イベントを購読して受け取る。

```javascript
// 受信側: 届いたメッセージを処理する
window.addEventListener('message', function(e) {
  // e.data   … 送られてきたデータ本体
  // e.origin … 送信元のオリジン
  // e.source … 送信元の window オブジェクトへの参照
});
```

受信側イベントオブジェクトの主要プロパティは 3 つ。

- **`e.data`**: メッセージ本体（攻撃者が仕込むペイロードの置き場）。
- **`e.origin`**: メッセージの送信元オリジン。**本来はここを厳密に検証して、信頼できる送信元からのメッセージだけを処理すべき**。
- **`e.source`**: 送信元 window への参照（多くは iframe）。

#### 脆弱性の成立条件

**web message DOM XSS は、受信側（destination origin）が「送信側は悪意あるデータを送ってこない」と信頼してしまい、受け取ったデータを危険な sink へ安全でない形で渡すときに発生する。** 典型的には、`e.origin` を検証せず（あるいは検証が不完全なまま）、`e.data` を `innerHTML` や `eval`、`location.href` などへ流し込むコードが該当する。

最も素朴で危険なパターンはこれだ。

```javascript
window.addEventListener('message', function(e) {
  eval(e.data);   // 送られてきた文字列をそのまま JavaScript として実行
});
```

これが危険な理由: `e.origin` を一切見ずに `e.data` を `eval()` に渡している。攻撃者が任意のページから（あるいは被害者に開かせた iframe から）このウィンドウへ `postMessage('alert(1)', '*')` を送れば、その文字列が JavaScript として実行される。攻撃者は次のような**攻撃ページ**を用意し、被害者に開かせるだけでよい。

```html
<iframe src="https://victim.example/" onload="this.contentWindow.postMessage('print()','*')"></iframe>
```

これが動く理由: iframe に被害サイトを読み込み、`onload`（読み込み完了時）に、その iframe の中身（`contentWindow`）へ向けて web message を送っている。第 2 引数の `'*'`（targetOrigin）は「どのオリジンでも受け取ってよい」の意で、攻撃者側から送るときに送信先を限定しない指定である。受信側が origin を検証していないため、外部から送ったメッセージがそのまま `eval` される。

#### message event のプロパティから脆弱性を読む

DOM Invader の Messages ビューでは、記録された各メッセージについて、**クライアント側 JavaScript が `origin`／`data`／`source` の各プロパティに実際にアクセスしたかどうか**を確認できる。これが強力な手がかりになる。

- **`origin` にアクセスしていない** → 送信元オリジンを検証していない可能性が高い（＝どこからでも送り込める）。
- **`data` にアクセスしていない** → データが一切使われていないので、そのメッセージは**悪用できない**（sink へ渡りようがない）。
- **`source` にアクセスしていない** → 送信元（多くは iframe）を検証していない可能性が高い。

この 3 点を見るだけで、「このメッセージは攻略できるか、どう攻めるか」の当たりを素早く付けられる。

#### DOM Invader の web message 機能

DOM Invader は web message テストのために次を提供する。

- ページ上で `postMessage()` により送られた web message を**すべてログに記録**する（付随情報つき）。
- Burp Repeater のように、web message を**改変して再送**し、手動で DOM XSS を探れる。
- DOM Invader が**自動でメッセージを改変・送信**して、代わりに DOM XSS を探ってくれる。
- 観測された挙動に基づき、DOM Invader は**悪用可能と判断したメッセージに推定 Severity（深刻度）と Confidence（確信度）を表示**して自動フラグ付けする。自動検出しきれない脆弱性を含む可能性を考慮し、ページ上で送られた**すべてのメッセージが少なくとも Information（情報）深刻度で一覧される**。

#### origin 検証の不備を自動で炙り出す仕組み（重要）

多くの実装は origin を検証しているつもりでも、検証ロジックが甘い。DOM Invader はこの甘さを自動で突く。**DOM Invader は、送るメッセージの origin を「本物のオリジンのドメイン名で始まり、かつ同じドメイン名で終わる」偽オリジンに自動で置き換える**。これにより、`indexOf`／`startsWith`／`endsWith` や正規表現による**不完全な origin 検証に依存したイベントハンドラを自動的に特定**できる。

代表的な検証不備と、その突破例を示す。

```javascript
// 不備例1: 部分一致（含まれていればOK）にしてしまっている
window.addEventListener('message', function(e) {
  if (e.origin.indexOf('normal-website.com') !== -1) {
    // 信頼して処理してしまう
  }
});
```

突破される理由: `indexOf` は「文字列のどこかに含まれるか」しか見ない。攻撃者のオリジンが `http://www.normal-website.com.evil.net` であれば、その中に `normal-website.com` という部分文字列が**含まれてしまう**ため、検証を通過する。ドメインは実際には攻撃者の `evil.net` 配下である。

```javascript
// 不備例2: 前方一致だけ／後方一致だけを見ている
if (e.origin.startsWith('https://normal-website.com')) { /* ... */ }  // 前方一致のみ
if (e.origin.endsWith('normal-website.com')) { /* ... */ }           // 後方一致のみ
```

突破される理由: `startsWith` は `https://normal-website.com.evil.net` のような「本物で始まるが別ドメイン」に騙され、`endsWith` は `https://evil-normal-website.com` のような「本物で終わるが別ドメイン」に騙される。DOM Invader が偽オリジンを「本物で始まり本物で終わる」形に作るのは、まさにこの両パターンを同時に検出するためである。正しい検証は**完全一致（`e.origin === 'https://normal-website.com'`）**でなければならない。

#### 手動テストと PoC 生成

Messages ビューから任意のメッセージをクリックすると詳細ダイアログが開く。メッセージ情報を確認して**データが最終的にどの sink に入るか（sink の種類）**を見極め、**Data フィールドを sink の種類に合ったエクスプロイトに書き換えて Send（送信）** する。`<`, `>`, `"` などがエスケープされるかを試し、エスケープされないなら、それらを使って概念実証ペイロードを組み立てて送る。

脆弱なイベントリスナーを見つけ、Data ボックスでエクスプロイトを組み立てられたら、**Build PoC（PoC 生成）ボタン**を押すだけで、レポートに添付できる HTML の概念実証がクリップボードにコピーされる。

#### 具体例1: innerHTML に流し込むリスナー

受信したメッセージ本体をそのまま `innerHTML` へ入れているケース（例: `ads` という ID の `<div>` に広告 HTML として挿入する実装）。

```javascript
window.addEventListener('message', function(e) {
  document.getElementById('ads').innerHTML = e.data;  // origin 検証なし
});
```

攻撃ページ（PoC）:

```html
<iframe src="https://YOUR-LAB-ID.web-security-academy.net/"
        onload="this.contentWindow.postMessage('<img src=1 onerror=print()>','*')"></iframe>
```

動く理由: origin を検証していないため外部から送ったメッセージが処理され、その文字列が `innerHTML` に代入されて HTML として再解釈される。`<img src=1 onerror=print()>` は画像読み込みに失敗して `onerror` が発火し、`print()` が実行される（ラボでは `print()` の実行が解答条件として使われる）。

#### 具体例2: JSON.parse を挟むリスナー

メッセージを JSON として解釈し、`type` プロパティで処理を分岐、`load-channel` の場合に iframe の `src`（あるいは `location.href`）を書き換える実装。

```javascript
window.addEventListener('message', function(e) {
  var data = JSON.parse(e.data);
  switch (data.type) {
    case 'load-channel':
      document.getElementById('ifr').src = data.url;  // url が location/href 系 sink に流れる
      break;
  }
});
```

攻撃ページ（PoC）:

```html
<iframe src=https://YOUR-LAB-ID.web-security-academy.net/
  onload='this.contentWindow.postMessage("{\"type\":\"load-channel\",\"url\":\"javascript:print()\"}","*")'>
</iframe>
```

動く理由: 送るデータを JSON 文字列にして `type` を `load-channel` に合わせ、`url` に `javascript:print()` を指定している。受信側はこれを `src`／`location.href` 系の sink に渡すため、`javascript:` URL が実行される。`location.href = 'javascript:...'` や `iframe.src = 'javascript:...'` は URL を JavaScript として実行しうる、という点が sink たるゆえんである。

#### 具体例3: 不完全な origin/内容検証を突く JavaScript URL

`e.data` の中に `http:` または `https:` が含まれるかを `indexOf` で確認し、含まれていれば安全とみなして `location` に渡してしまう実装。

```javascript
window.addEventListener('message', function(e) {
  if (e.data.indexOf('http:') > -1 || e.data.indexOf('https:') > -1) {
    location.href = e.data;   // http/https が含まれていれば通してしまう
  }
});
```

突破ペイロード（Data に入れて送る値）:

```
javascript:print()//http:
```

動く理由: 検証は「`http:` という文字列が含まれるか」しか見ていない。末尾に `//http:` を付ければこの部分一致チェックを通過する。一方 `//` 以降は JavaScript の行コメントとして無視されるため、実際に実行されるのは先頭の `javascript:print()` だけである。「検証を満たす無害な文字列」と「実行される悪意ある文字列」を 1 行に共存させる、DOM XSS 頻出のテクニックである。

> 出典: Testing for DOM XSS using web messages — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages
> 出典: Testing for web message DOM XSS with DOM Invader — https://portswigger.net/burp/documentation/desktop/testing-workflow/input-validation/xss/web-message-dom-xss
> 出典: Controlling the web message source（Web Security Academy） — https://portswigger.net/web-security/dom-based/controlling-the-web-message-source
> 出典: Web message manipulation（Web Security Academy） — https://portswigger.net/web-security/dom-based/web-message-manipulation

---

### 実践ワークフローのまとめ（チェックリスト）

DOM Invader を使った DOM XSS テストの一連の流れを、実務で使える順序でまとめる。

1. **有効化**: Proxy > Intercept から内蔵ブラウザを起動 → 右上ロゴ → DOM Invader タブでトグル On → Reload。
2. **目的に応じた設定**:
   - 反射型ライクな DOM XSS を広く探すなら、Misc の「source への canary 自動注入」を On。
   - 操作起点の source を炙るなら「Auto-fire events」を On（副作用に注意）。
   - 遷移で観察が中断するなら「Redirection prevention」を On。
   - prototype pollution / DOM clobbering を探すなら Attack types で該当トグルを On（1 テクニックずつが安全）。
3. **標準 source のテスト**: Copy canary → URL パラメータ／フラグメント／フォームへ注入（`Inject URL params`／`Inject forms` で自動化）。
4. **sink の確認**: Augmented DOM の sink 一覧で canary の到達先を確認。Value 列で XSS コンテキストを判定。Outer HTML／Frame path／Event とスタックトレースで文脈を精査。
5. **web message のテスト**: Messages ビューでログを確認。`origin`／`data`／`source` のアクセス有無から攻略可否を判断。Data を書き換えて Send、または自動送信に任せる。origin 検証不備は偽オリジン自動置換が検出。
6. **エクスプロイト確定**: コンテキストに合ったペイロードで `alert`／`print` を発火。
7. **PoC 生成**: Exploit／Build PoC ボタンで PoC をクリップボードへ。レポートに添付。

---

### 防御策（開発者向けの原則）

DOM Invader は攻撃者・テスター側の道具だが、検出される脆弱性を作らないための防御原則も押さえておく。

- **危険な sink を避ける**: ユーザー制御データを `innerHTML`・`document.write`・`eval`・`location`／`href` 代入・`setTimeout(文字列)` などへ渡さない。HTML を組み立てる必要があるなら `textContent` を使う、あるいは `element.setAttribute` で属性値として安全に設定する。動的な HTML 挿入がどうしても必要なら、実績あるサニタイズライブラリ（例: **DOMPurify**）を使う。
  > バージョン注意: サニタイザにも既知のバイパスが定期的に見つかる。たとえば **DOMPurify は 2.0.17 未満**に mXSS（mutation XSS: ブラウザの HTML 再解析でサニタイズ後に危険化する攻撃）のバイパスが存在し修正済みである。ライブラリは必ず最新に保ち、公開年・修正状況を追うこと。
- **web message の origin を完全一致で検証する**: `e.origin === 'https://trusted.example'` のように厳密比較する。`indexOf`／`startsWith`／`endsWith`／緩い正規表現は前掲のとおり突破される。
- **送信側は targetOrigin を明示する**: `postMessage(data, 'https://trusted.example')` のように送信先オリジンを限定し、`'*'` を避ける（機密データが第三者フレームへ漏れるのを防ぐ）。
- **受信データをそのまま実行・挿入しない**: `JSON.parse` で構造化し、期待するスキーマ・値だけを許可（許可リスト方式）してから使う。
- **多層防御として CSP（Content Security Policy）を導入する**: インライン `<script>` やイベントハンドラ属性の実行を禁止し（`script-src` からインラインを排除、`unsafe-inline` を付けない）、`javascript:` の実行も抑止する。CSP はブラウザが**ソース許可リストを評価**して許可されないスクリプト実行をブロックする仕組みで、XSS が混入しても被害を軽減する最後の砦になる。

> 出典: DOM Invader — https://portswigger.net/burp/documentation/desktop/tools/dom-invader
> 出典: Testing for DOM XSS — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
> 出典: Testing for web message DOM XSS with DOM Invader — https://portswigger.net/burp/documentation/desktop/testing-workflow/input-validation/xss/web-message-dom-xss
