# DOM-based XSS を「sink 別」に潰す —— 危険な JavaScript API とその安全な書き換え

> **この節で分かること**
> - DOM-based XSS（DOM ベースのクロスサイトスクリプティング）が、サーバ側で起きる XSS と何が根本的に違うのかを説明できる。
> - `document.write` / `eval` / `setTimeout` / `Function` / jQuery という代表的な「危険な sink（シンク）」を、それぞれなぜ危険なのか説明できる。
> - HTML エスケープの5文字の変換表を書き、なぜエスケープだけでは守り切れないのかを説明できる。
> - 「エスケープを頑張る」のではなく「危険な sink そのものを使わない」という現代の対策方針を、自分のコードで実践できる。
> - 2016年の記事には無い現代の対策（DOMPurify によるサニタイズ、Trusted Types による強制）を理解し、バグバウンティで sink を探す観点を持てる。

**元資料**: はせがわようすけ「JavaScriptセキュリティの基礎知識」第7回「DOM-based XSS その2」 https://gihyo.jp/dev/serial/01/javascript-security/0007 （原典は取得できず二次情報ベース。技術的裏付けは OWASP 公式チートシートの原典取得済みで補完）
**関連する節**: 同連載 第6回「DOM-based XSS その1」／第8回「DOM-based XSS その3」

---

## 1. この節の位置づけ —— 2016年の日本語圏に空いていた穴

### 1-1. 元になった連載

この節の骨格は、はせがわようすけ氏による gihyo.jp の連載「JavaScriptセキュリティの基礎知識」の**第7回「DOM-based XSS その2」（2016年公開）**にもとづく。全8回の連載で、第6回・第7回・第8回の3回が DOM-based XSS を扱う「3部作」になっており、第7回はその中核である。

連載の全体像は次のとおり。DOM-based XSS を理解するうえで、前後の回が前提知識になる。

| 回 | タイトル | URL |
| --- | --- | --- |
| 第1回 | Webセキュリティのおさらい その1 | https://gihyo.jp/dev/serial/01/javascript-security/0001 |
| 第2回 | Webセキュリティのおさらい その2 XSS | https://gihyo.jp/dev/serial/01/javascript-security/0002 |
| 第3回 | Webセキュリティのおさらい その3 CSRF・オープンリダイレクト・クリックジャッキング | https://gihyo.jp/dev/serial/01/javascript-security/0003 |
| 第4回 | URLとオリジン | https://gihyo.jp/dev/serial/01/javascript-security/0004 |
| 第5回 | 問題を発生させにくくするURLの扱い方 | https://gihyo.jp/dev/serial/01/javascript-security/0005 |
| 第6回 | DOM-based XSS その1 | https://gihyo.jp/dev/serial/01/javascript-security/0006 |
| **第7回（本節）** | **DOM-based XSS その2** | **https://gihyo.jp/dev/serial/01/javascript-security/0007** |
| 第8回（最終回） | DOM-based XSS その3 | https://gihyo.jp/dev/serial/01/javascript-security/0008 |

### 1-2. なぜ「歴史」から入るのか

第7回が書かれた2016年当時、DOM-based XSS のまとまった日本語解説はほとんど存在しなかった。日本語の JavaScript 入門書「js-primer」を書いていたチームが、同時期（2016年7月29日）のミーティング議事録で次のように記録している。

> 「- @laco: エスケープの話をajaxで出している
> - DOM-based XSSの話をどこまでするか、どうするかの件 せめてリンクは出してあげたいが参考リンクがない
> - @azu: 海外だとOWASP
> - MDNも簡単な解説しかない
> - hasegawaさんが最近連載してる
> - [JavaScriptセキュリティの基礎知識：連載｜gihyo.jp … 技術評論社](http://gihyo.jp/dev/serial/01/javascript-security)
> - hasegawaさんが本とか書いてくれると…
> …
> ### 結論
> - いいリンクを募集中」
> （出典: js-primer リポジトリ `meetings/2016-07-29/README.md`）

つまり当時、「DOM-based XSS の日本語の参考リンクが無い」「海外の OWASP を読むしかない」という状況で、その空白を埋める資料として、はせがわ氏の連載が挙げられていた。

さらに、日本のプロの脆弱性診断士向けガイドライン（OWASP Japan × JNSA 共同ワーキンググループの「Webアプリケーション脆弱性診断ガイドライン」）は、この連載を「開発系」の推薦資料の第1項目に挙げ、次のように評している。

> 「はせがわようすけさんがJavaScriptに関連するセキュリティ上の問題について解説されている記事です。… また、本連載の後半ではDOM-based XSSに関して深い解説をされており、脆弱性を生まないための実装方法などについても記載されています。」
> （出典: `WebAppPentestGuidelines/WebAppPentestGuidelines` リポジトリの `README.md`）

本節では、この第7回の**構成と問題意識**を骨格にしつつ、技術的な裏付けとコードは OWASP の公式チートシート（原典を取得済み）から取る。加えて、2016年当時には未普及だった現代の対策（サニタイズ、Trusted Types）を〔補足〕として補う。

> ### 📌 ここは自分で開いて読んでください
> **資料**: はせがわようすけ「JavaScriptセキュリティの基礎知識」第7回「DOM-based XSS その2」 — https://gihyo.jp/dev/serial/01/javascript-security/0007
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で gihyo.jp ドメイン全体が遮断された）。ただし gihyo.jp は無料公開・ログイン不要のページなので、通常のブラウザなら問題なく読める。以下の記述は検索結果の引用断片と OWASP 公式チートシートにもとづく再構成である。
> **読みどころ**:
> 1. HTML エスケープ関数の原文コード（置換の順序、`'` を `&#x27;` にしている点、テキストノード用と属性値用を同一関数で兼ねているか）。
> 2. `document.write` の脆弱例と安全例の完全なビフォー／アフター。「1か所でも漏れると DOM-based XSS になる」という主張の根拠部分。
> 3. `eval` 節（`eval("(" + json + ")")` → `JSON.parse`）と、`setTimeout` 節のクロージャ書き換え例、IE9 に関する注記。
> 4. jQuery 節で `$()` が引数を HTML と解釈する条件。ここは jQuery のバージョンで挙動が変わる最重要ポイント。
> 5. 記事は複数ページ構成なので、必ず `?page=2`・`?page=3` も確認する。第6回・第8回も併読する（3部作で1つの解説）。
> **代替手段**: Wayback Machine（`https://web.archive.org/web/2017/https://gihyo.jp/dev/serial/01/javascript-security/0007`、年を 2017/2019/2024 と変える）、archive.today（`https://archive.ph/…`）、連載トップ https://gihyo.jp/dev/serial/01/javascript-security から辿る。

## 2. DOM-based XSS とは何か —— サーバ側 XSS との決定的な違い

### 2-1. まず用語をそろえる

**XSS（Cross-Site Scripting, クロスサイトスクリプティング）**とは、攻撃者が用意した JavaScript を被害者のブラウザ上で実行させてしまう脆弱性のこと。たとえば掲示板に `<script>` を書き込めてしまい、それを見た他の利用者のブラウザでスクリプトが動く、といったものである。

XSS は伝統的に3種類に分けられる。

| 種類 | どこで注入されるか |
| --- | --- |
| 反射型（Reflected） | サーバがリクエストを処理する際、入力をそのまま HTML に埋め込んで返す |
| 格納型（Stored） | サーバがデータベースなどに保存した入力を、後で HTML に埋め込んで返す |
| DOM ベース（DOM-based） | サーバではなく、ブラウザ上で動く JavaScript が入力を DOM に書き込む |

**DOM（Document Object Model）**とは、ブラウザがページの HTML をメモリ上で木構造として表現したもの。JavaScript はこの DOM を書き換えることでページを動的に変える。

### 2-2. なぜ DOM-based XSS だけ検出が難しいのか（設計意図から見る）

OWASP の「DOM based XSS Prevention Cheat Sheet」は、この違いを次のように述べている（原文取得済み）。

> "Reflected and Stored XSS are server side injection issues while DOM based XSS is a client (browser) side injection issue."
> （反射型・格納型 XSS はサーバ側の注入問題だが、DOM ベース XSS はクライアント（ブラウザ）側の注入問題である）
>
> "For DOM XSS, the attack is injected into the application during runtime in the client directly."
> （DOM XSS では、攻撃はクライアント上の実行時にアプリケーションへ直接注入される）
> （出典: OWASP DOM based XSS Prevention Cheat Sheet, Introduction）

gihyo 第6回は同じことを「**DOM-based XSS ではクライアント上で JavaScript が動作するまで XSS が発生しない**」と表現していた。つまりサーバが返す HTML を見ただけでは脆弱性が見つからない。攻撃は、ブラウザ上で JavaScript が入力を DOM に書き込んだ瞬間に初めて成立する。

これはバグハンターにとって重要な意味を持つ。サーバのレスポンスを grep するだけでは DOM-based XSS は見つからず、**ブラウザ上で JavaScript が入力をどう扱うかを追う**必要がある。

### 2-3. source と sink というモデル

DOM-based XSS を追う道具立てが **source（ソース）** と **sink（シンク）** である。

- **source** とは、攻撃者が制御しうる入力が JavaScript に入ってくる入り口のこと。たとえば URL の `#` 以降（`location.hash`）は、攻撃者がリンクを送りつければ自由に決められる。
- **sink** とは、その値が「危険な形で」出力・実行される出口のこと。たとえば `innerHTML` に文字列を代入すると、それが HTML として解釈される。

OWASP はこれを川にたとえている（原文取得済み）。

> "Security professionals often talk in terms of sources and sinks. If you pollute a river, it'll flow downstream somewhere. It's the same with computer security."
> （川を汚せば、その汚れは下流のどこかへ流れる。コンピュータセキュリティも同じだ）
> （出典: OWASP Cross Site Scripting Prevention Cheat Sheet, Safe Sinks）

source から出た「汚れ」が、エスケープ（浄化）されないまま sink に到達すると XSS になる。gihyo 第6回の典型例は「`location.hash.substring(1)` で取った値を `div.innerHTML` に代入し、攻撃 URL `http://example.jp/#<img src=1 onerror=alert(1)>` で発火する」というもので、対策は `innerHTML` ではなく `textContent` を使うことだった。

第7回は、この「sink」を1つずつ取り上げていく。

### 2-4. source と sink の早見表

〔補足〕バグバウンティで DOM-based XSS を探すときの実務チェックリストとして、代表的な source と sink を一覧にしておく。原文（第6/7/8回）由来のものには回番号を付す。それ以外は一般知識である。

| 区分 | 該当する API / プロパティ |
| --- | --- |
| source（攻撃者が制御しうる入力） | `location.hash`(第6/8回), `location.search`, `location.href`, `document.URL`, `document.referrer`, `window.name`, `postMessage` の `event.data`, `localStorage` / `sessionStorage`, Cookie, `XMLHttpRequest` / `fetch` のレスポンス(第8回) |
| sink（HTML 生成系） | `innerHTML`(第6回), `outerHTML`, `insertAdjacentHTML`, `document.write` / `document.writeln`(第7回), `iframe.srcdoc` |
| sink（コード実行系） | `eval`(第7回), `Function` コンストラクタ(第7回), `setTimeout` / `setInterval` の文字列引数(第7回) |
| sink（URL 系） | `location` への代入(第6回), `a.href`, `iframe.src`, `script.src`, `window.open`（`javascript:` / `data:` スキームに注意） |
| sink（jQuery） | `$()` / `jQuery()` の引数(第7回), `.html()`(第7回), `.append()`(第7回) |
| 安全側の API | `textContent`(第6回), `createTextNode()`(第6回), `setAttribute`（属性名に注意）, jQuery `.text()`, `JSON.parse`(第7回) |

## 3. HTML エスケープの基本 —— サーバ側の対策を JavaScript で再現する

### 3-1. 考え方（なぜそうするのか）

第7回の対策の出発点は「**従来サーバ側で行っていた XSS 対策と同じことを、ブラウザ上の JavaScript でも実装する**」という思想である。サーバでテンプレートに値を埋めるとき HTML エスケープするのと同じことを、JavaScript が DOM に文字列を書き込むときにもやればよい、という素直な発想だ。

**HTML エスケープ**とは、HTML において特別な意味を持つ文字（メタキャラクタ）を、そのまま「文字」として表示されるよう文字参照に変換すること。これにより、攻撃者の入力に含まれる `<script>` などがタグとして解釈されず、ただの文字列として表示される。

### 3-2. 変換表（OWASP 公式と完全一致）

変換すべき5文字とその変換先は次のとおり。この表は OWASP「Cross Site Scripting Prevention Cheat Sheet」に公式に載っており、原文取得済みである（逐語）。

```text
&    &amp;
<    &lt;
>    &gt;
"    &quot;
'    &#x27;
```

> "Encoding Mechanism: Convert `&` to `&amp;`, Convert `<` to `&lt;`, Convert `>` to `&gt;`, Convert `"` to `&quot;`, Convert `'` to `&#x27`"
> （出典: OWASP Cross Site Scripting Prevention Cheat Sheet, Output Encoding Rules Summary）

`'`（シングルクォート）を `&apos;` ではなく `&#x27;` に変換している点が実務上のポイントである（`&apos;` は一部の古い環境で正しく解釈されないため、数値文字参照の `&#x27;` が推奨される）。

### 3-3. 実装（教科書独自のコード）

上の変換表にもとづくエスケープ関数は次のように書ける。これは OWASP の変換表を典拠にした本教科書独自の実装である。

```javascript
function htmlEscape(s) {
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;');
}
```

〔補足〕置換の順序が重要である。`&` を**最初に**置換しなければならない。後回しにすると、`<` を `&lt;` に変換して生まれた `&` が、後の `&` 置換でさらに `&amp;lt;` に二重変換されてしまう。また、属性値を HTML に埋め込む場合は必ず引用符で囲み、`"` と `'` の両方をエスケープする。片方だけだと、囲みに使っていない方の引用符で属性値から脱出（ブレイクアウト）されてしまう。

### 3-4. しかしエスケープには限界がある（どこを突かれるか）

第7回は「`document.write` の呼び出し中で**1か所でもエスケープの漏れがあれば** DOM-based XSS が発生する」と述べている。人間が手でエスケープを徹底し続けるのは難しく、1箇所の抜けが命取りになる。

さらに深刻なのは、**エスケープしても守れない場所（dangerous contexts）が存在する**ことだ。OWASP はこう警告している（原文取得済み）。

> "Output encoding is not perfect. It will not always prevent XSS. These locations are known as **dangerous contexts**."
> （出力エンコードは完全ではない。常に XSS を防げるわけではない。こうした場所を「危険なコンテキスト」と呼ぶ）

危険なコンテキストの例（逐語）。

```html
<script>Directly in a script</script>
<!-- Inside an HTML comment -->
<style>Directly in CSS</style>
<div ToDefineAnAttribute=test />
<ToDefineATag href="/test" />
```

そして OWASP は、危険なコンテキストのひとつとして次を明示している（逐語）。

> "Unsafe JS functions like `eval()`, `setInterval()`, `setTimeout()`"
> （`eval()`・`setInterval()`・`setTimeout()` のような危険な JS 関数）
> （出典: OWASP Cross Site Scripting Prevention Cheat Sheet, Dangerous Contexts）

つまり `eval` や `setTimeout` の中に値を入れる場合、HTML エスケープしても意味がない。これらの sink には「そもそも攻撃者制御の文字列を渡さない」しかない。これが第7回が各 sink で「渡さない」を結論にする根拠である。

## 4. 危険な sink（1）—— `document.write` / `document.writeln`

### 4-1. どう動くのか

`document.write` は、引数の文字列を**そのまま HTML として** document に書き込む。文字列から HTML を生成する典型的な sink であり、OWASP も危険な HTML メソッドの筆頭に挙げている（逐語）。

```javascript
document.write("<HTML> Tags and markup");
document.writeln("<HTML> Tags and markup");
```

### 4-2. どこを突かれるか（本物の脆弱コード）

source から取った値を `document.write` に渡すと DOM-based XSS になる。OWASP のチートシートに載っている、`location.hash` を source、`document.write` を sink とする脆弱コード（逐語・OWASP 出典）を示す。

```javascript
var x = location.hash.split("#")[1];
document.write(x);
```

`location.hash` は攻撃者がリンクの `#` 以降で自由に決められる。ここに `<img src=1 onerror=alert(1)>` のような値を仕込めば、`document.write` がそれを HTML として書き込み、スクリプトが実行される。これは gihyo 第7回の `document.write` 節が扱う脆弱パターンそのものである。

### 4-3. どう守るのか

第7回の第一の対策は「エスケープ関数を用意し、テキストノード部分・属性値部分の両方をエスケープしてから HTML を組み立てる」。だが前述のとおり、1か所の漏れで破綻する。

そこで第7回の**結論**は「DOM に文字列や要素を追加するなら、`document.write` を使わず **DOM 操作 API を使う**」である。OWASP も同じ結論を GUIDELINE #3 で公式に述べている（逐語）。

> "`document.createElement("...")`, `element.setAttribute("...","value")`, `element.appendChild(...)` and similar are safe ways to build dynamic interfaces."

教科書独自の安全な書き換え例。

```javascript
// document.write の代わりに DOM 操作 API を使う
var el = document.createElement('div');
el.textContent = value;   // innerHTML ではなく textContent
document.getElementById('target').appendChild(el);
```

〔補足・重要な落とし穴〕`setAttribute` は「どんな属性でも安全」ではない。OWASP は「`element.setAttribute` は限られた属性についてのみ安全」と明記し（GUIDELINE #3）、`onclick` や `onblur` のようなイベントハンドラ属性は危険だとしている。安全な属性名として `align`, `alt`, `class`, `height`, `href`（※後述の URL 系は別途注意）, `title`, `width` などが公式に列挙されている。「DOM API なら無条件に安全」と単純化してはいけない。

## 5. 危険な sink（2）—— `eval`

### 5-1. どう動くのか、どこを突かれるか

`eval` は、渡された**文字列を JavaScript コードとして実行**する。第7回が危険な古い手法として挙げるのは、JSON 文字列をオブジェクトに変換する目的で `eval` を使うパターンである。

```javascript
// 危険：攻撃者が json を制御できると任意コードが実行される
var obj = eval("(" + json + ")");
```

`json` に `alert(document.cookie)` のようなコードが混じっていれば、それがそのまま実行されてしまう。

### 5-2. どう守るのか

第7回の結論は「現在のブラウザなら **`JSON.parse` を使う**」。OWASP も GUIDELINE #10 で同じことを公式に述べている（逐語）。

> "Don't `eval()` JSON to convert it to native JavaScript objects. Use the built-in `JSON.parse()` ... `JSON.parse()` rejects anything that is not valid JSON, so it cannot execute attacker-supplied code the way `eval()` can."
> （JSON をネイティブオブジェクトに変換するのに `eval()` を使うな。組み込みの `JSON.parse()` を使え。`JSON.parse()` は正しい JSON 以外をすべて拒否するので、`eval()` のように攻撃者のコードを実行することはない）

```javascript
var obj = JSON.parse(json);   // eval("(" + json + ")") は使わない
```

〔補足・逆方向の罠〕「`eval` の代わりに `JSON.parse`」だけを覚えると、逆方向（オブジェクトをページに埋め込む）で `JSON.stringify` を安全だと誤解しやすい。OWASP は明確に警告している（逐語）。

> "`JSON.stringify()` is **not** an output-encoding function. Its output is valid JSON but is not safe to embed directly in an HTML, HTML-attribute, or inline `<script>` context"
> （`JSON.stringify()` は出力エンコード関数ではない。出力は正しい JSON だが、HTML・HTML属性・インライン `<script>` コンテキストに直接埋め込むのは安全ではない）

`JSON.stringify` の結果には `<` `>` `&` `"` `'` がそのまま残るため、`<script>` 内に直接書くとブレイクアウトされる。埋め込む場合は別レスポンスとして返して `JSON.parse` するか、埋め込み先に応じて HTML エンコード／JavaScript 文字列エンコードする。これは2016年の記事には無い論点である。

## 6. 危険な sink（3）—— `setTimeout` / `setInterval`

### 6-1. どこを突かれるか

`setTimeout` と `setInterval` は、第1引数に**文字列**を渡すと、その文字列をコードとして実行する（暗黙の `eval`）。OWASP は「文字列としてコードを受け取る他の JS メソッドも同じ問題を持つ」として `setTimeout`・`setInterval`・`new Function` を名指ししている（逐語）。

> "Other JavaScript methods which take code as a string types will have a similar problem as outline above (`setTimeout`, `setInterval`, new Function, etc.)."

### 6-2. どう守るのか

第7回の結論は「**引数には文字列ではなく関数（関数オブジェクト）を渡す**」。教科書独自の例。

```javascript
// 安全：関数を渡す
setTimeout(function () { doSomething(value); }, 1000);

// 危険：文字列を渡す（暗黙の eval が起きる）
// setTimeout("doSomething('" + value + "')", 1000);
```

第7回は「コールバックへ引数を渡す機能（`setTimeout(fn, ms, arg)`）は IE9 では使えなかったため、IE9 互換が必要ならクロージャを使う」と補足していた。**クロージャ**とは、関数が定義されたときの周囲の変数を、その関数の中に閉じ込めて持ち運ぶ仕組みのこと。上の例の `function () { doSomething(value); }` がまさにクロージャで、`value` を外から閉じ込めている。

〔補足・なぜ文字列渡しはダメなのか〕OWASP は「文字列＋多段エンコード」方式がいかに破綻しやすいかを詳しく書いている。文字列で渡すと、シングルクォートの層と暗黙 `eval` の層でエンコードが二重に「はがれる」ため、二重・三重にエンコードした値を用意せねばならず、しかもその値は `if` の文字列比較で一致しなくなる、といった落とし穴が積み重なる。OWASP は代わりにクロージャで包む方式を推奨コードとして示している（逐語）。

```javascript
setTimeout((function(param) { return function() {
         customFunction(param);
       }
})("<%=ESAPI.encoder().encodeForJavascript(untrustedData)%>"), y);
```

つまり第7回の「IE9 互換ならクロージャ」という助言は、OWASP でも「クロージャこそ推奨、文字列＋多段エンコードは破綻しやすい」という形で裏付けられている。

## 7. 危険な sink（4）—— `Function` コンストラクタ

`Function`（Function コンストラクタ）は、文字列から動的に関数（＝コード）を生成する。`new Function("return " + userInput)` のように攻撃者制御の文字列を渡すと、`eval` と同様に任意コードが実行される。

第7回の結論はシンプルで、「**Function コンストラクタの引数に攻撃者が制御可能な文字列を渡さない**」。前節までと同じく、これは「エスケープでなんとかする」対象ではなく、コード実行系 sink なので「渡さない」しかない。OWASP も `new Function` を `eval`・`setTimeout` と同列の危険 sink として列挙している（前掲の逐語）。

## 8. 危険な sink（5）—— jQuery

### 8-1. なぜ jQuery が特別扱いされるのか

jQuery は当時（2016年）最も普及していた JavaScript ライブラリで、DOM 操作を短く書けるのが売りだった。だが、その「短く書ける」API 自体が sink になりうる。第7回は「jQuery の API は、直接コードを書く場合に比べて**挙動が見えにくい（表に出にくい）**ため、とくに注意が必要」と述べている。

### 8-2. どこを突かれるか

第7回が挙げる脆弱例（教科書独自に整理）。

```javascript
// (1) .html() に攻撃者制御の text を渡すと HTML として解釈される
$("#element").html(text);

// (2) $() の引数が HTML 文字列とみなされると要素が生成される
//     text が "<img src=# onerror='alert(1)'>" だとスクリプトが実行される
$(text).append("<div>news</div>");
```

`$()`（`jQuery()`）は、引数が HTML 文字列とみなされると DOM 要素を生成してしまう。`.html()` は `innerHTML` 相当で、渡された文字列を HTML として解釈する。どちらも source から来た値を渡すと XSS になる。

### 8-3. どう守るのか

第7回の結論は「**jQuery の引数に攻撃者が制御可能な文字列を渡さない**」。HTML として解釈させない API（`.text()` など）を使う。

```javascript
$('#element').text(value);   // .html(value) は使わない
```

〔補足〕OWASP のチートシートは jQuery 固有の API には触れていない。そのため jQuery に関する具体的な挙動（どのバージョンで `$(text)` がセレクタと HTML のどちらに解釈されるか等）は、jQuery 公式ドキュメントで別途確認する必要がある。バージョンによって挙動が変わる最重要ポイントなので、実際に診断するときは対象サイトの jQuery バージョンを確認すること。

## 9. 「安全」に見えて安全でない API に注意

### 9-1. `textContent` / `innerText` の罠

gihyo 第6回は「`innerHTML` ではなく `textContent`」を推奨した。これは基本的に正しいが、**無条件に安全ではない**。OWASP は `innerText` について次の反例を挙げている（逐語）。

> "One example of an attribute which is thought to be safe is `innerText`. … However, depending on the tag which `innerText` is applied, code can be executed."

```html
<script>
 var tag = document.createElement("script");
 tag.innerText = "<%=untrustedData%>";  //executes code
</script>
```

つまり、`<script>` 要素に対して `innerText` を使うと、その中身はスクリプトとして実行されてしまう。「テキスト系プロパティは要素が `<script>` でない限り安全」であって、`<script>` を動的に作ってそこにテキストを入れる、という使い方は危険である。

### 9-2. 安全な sink の公式リスト

OWASP が「安全な sink」として挙げているもの（逐語コード）。

```javascript
elem.textContent = dangerVariable;
elem.insertAdjacentText(dangerVariable);
elem.className = dangerVariable;
elem.setAttribute(safeName, dangerVariable);
formfield.value = dangerVariable;
document.createTextNode(dangerVariable);
document.createElement(dangerVariable);
elem.innerHTML = DOMPurify.sanitize(dangerVar);
```

いちばん下の行に注目してほしい。`innerHTML` に値を入れたいなら、生の値ではなく `DOMPurify.sanitize()` を通した値を入れる、という第三の道が示されている。これが次の節の話である。

## 10. 2016年に無かった対策 —— サニタイズと Trusted Types

### 10-1. ユーザに HTML を書かせたいとき（サニタイズ）

第7回は「エスケープするか、DOM API を使う」の二択で終わっている。だが、ブログの本文編集やリッチテキストエディタのように「**ユーザに HTML を書かせたい**」ケースでは、エスケープすると意図した装飾まで消えてしまう。

このときの答えが**サニタイズ**である。OWASP は次のように述べる（逐語）。

> "HTML Sanitization will strip dangerous HTML from a variable and return a safe string of HTML. **OWASP recommends DOMPurify for HTML Sanitization.**"

```javascript
let clean = DOMPurify.sanitize(dirty);
```

DOMPurify は Cure53（DOM-based XSS 研究で知られるドイツのセキュリティ企業）が開発する HTML サニタイザで、危険な HTML を取り除いて安全な HTML 文字列を返す。使うときの注意（OWASP 逐語）。

> "- If you sanitize content and then modify it afterwards, you can easily void your security efforts.
> - You must regularly patch DOMPurify or other HTML Sanitization libraries that you use."

サニタイズ後に文字列をいじると無効化されうること、ブラウザの挙動変化でバイパスが見つかるため定期的に更新することが必要である。

〔補足・なぜ2016年の記事はサニタイズに触れないのか〕DOMPurify 公式 README によると、DOMPurify は Internet Explorer では「何もしない（渡された文字列をそのまま返す）」。2016年当時は IE 対応が必須の案件が多く、DOMPurify がそこで機能しなかったため、サニタイズは現実的な選択肢になりにくかった。これは推測ではなく DOMPurify 公式の仕様として説明できる。

### 10-2. 規律を「ブラウザに強制させる」—— Trusted Types

第7回の結論を一言でいえば「エスケープ漏れが1か所でもあれば破綻するから、そもそも危険な sink を使うな」という**人間の規律**による対策だった。問題は、人間はミスをすることである。

**Trusted Types（W3C）**は、まさにこの規律を**ブラウザに強制させる**仕組みである。危険な sink（`innerHTML` など）に生の文字列を代入した時点で、ブラウザが例外を投げる。値を sink に渡すには、いったん「ポリシー」を通して `TrustedHTML` という特別な型にしなければならない。

CSP（Content Security Policy）で強制する書き方（公式 README 逐語）。

```html
<script src="https://w3c.github.io/trusted-types/dist/es5/trustedtypes.build.js" data-csp="trusted-types foo bar; require-trusted-types-for 'script'"></script>
<script>
    trustedTypes.createPolicy('foo', ...);
    trustedTypes.createPolicy('unknown', ...); // throws
    document.body.innerHTML = 'foo'; // throws
</script>
```

`require-trusted-types-for 'script'` を CSP で指定すると、`document.body.innerHTML = 'foo'`（生文字列の代入）がその場で例外になる。DOMPurify は Trusted Types と連携でき、`RETURN_TRUSTED_TYPE: true` を指定すると `TrustedHTML` を返す。

対応状況（公式 README 逐語）。

> "The API is available natively in browsers based on Chromium version 83 and up."

Chromium 83 以降でネイティブ対応、それ以前や他ブラウザではポリフィルを使う。**「2016年に人間の規律として書かれた提言が、2020年代にプラットフォームの機能として実装された」**——これが DOM-based XSS 対策のたどった道である。

## 手を動かす

以下は「許可された診断・バグバウンティ・自分で立てた検証環境」でのみ行うこと。他人のサイトを無断で攻撃してはならない。

1. **PortSwigger の無料ラボで `document.write` sink を体験する。** ブラウザで次を開き、無料アカウントを作ってラボを起動する。source が `location.search`、sink が `document.write` という、第7回そのままの構成である。
   - ラボ: https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-document-write-sink
2. ラボの検索フォームに適当な文字を入れて検索し、ページのソースを見る。入力が `document.write` でどこに書き込まれているかを DevTools（デベロッパーツール）の Elements タブで確認する。
3. 画像の `src` から抜け出すペイロード（ラボの解説に沿ったもの）を入力し、`alert` が出ることを確認する。これで「source→sink の到達」を自分の目で見たことになる。
4. **自分の検証用 HTML で sink の違いを比べる。** 次のファイルをローカルに作り、URL の後ろに `#<img src=1 onerror=alert(1)>` を付けて開く。
   ```html
   <!doctype html>
   <div id="a"></div>
   <div id="b"></div>
   <script>
     var payload = location.hash.substring(1);
     document.getElementById('a').innerHTML = payload;    // 発火する（危険）
     document.getElementById('b').textContent = payload;  // 発火しない（安全）
   </script>
   ```
5. `innerHTML` の方だけ `alert` が出て、`textContent` の方は文字列がそのまま表示されることを確認する。これが「危険な sink」と「安全な sink」の差である。
6. **DevTools でコードを追う習慣をつける。** Sources タブでブレークポイントを置き、`location`／`document.URL`／`postMessage` などの source が、どの変数を経て `innerHTML`／`document.write`／`eval` などの sink に届くかをステップ実行で追う。DOM-based XSS はこの「追跡」がすべてである。

> ### 📌 ここは自分で開いて読んでください
> **資料**: PortSwigger Web Security Academy「DOM XSS in document.write sink using source location.search」（無料ラボ） — https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-document-write-sink
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で portswigger.net が遮断された）。以下の記述は検索結果とラボの構成情報にもとづく要約である。
> **読みどころ**:
> 1. source が `location.search`、sink が `document.write` という、第7回の `document.write` 節に完全対応する実習を、実際に手を動かして再現する。
> 2. ラボ一覧の親ページ https://portswigger.net/web-security/cross-site-scripting/dom-based で、他の sink（`innerHTML`、`eval`、jQuery `.html()` など）のラボも順に試す。
> **代替手段**: 上の手順4のローカル HTML で `document.write` 版を自作する（`document.write(location.hash.substring(1))`）。

## つまずきポイント

- **「サーバのレスポンスを見れば XSS が分かる」は DOM-based XSS には通用しない。** DOM-based XSS はブラウザ上で JavaScript が動いて初めて発生する。レスポンスの grep ではなく、DevTools で JavaScript の挙動を追う必要がある。
- **エスケープすれば安全、ではない。** `eval`・`setTimeout`・`setInterval`・`<script>` 内・HTML コメント内・`<style>` 内などの「危険なコンテキスト」では、HTML エスケープは効かない。これらには「そもそも値を渡さない」しかない。
- **`textContent` / `innerText` は無条件安全ではない。** `<script>` 要素に対して使うとコードが実行される。「テキスト系だから安全」と丸暗記しない。
- **`setAttribute` はどんな属性でも安全、ではない。** `onclick` などのイベントハンドラ属性は危険。OWASP が列挙する安全な属性名の範囲で使う。
- **「`eval` の代わりに `JSON.parse`」だけ覚えると `JSON.stringify` で事故る。** `JSON.stringify` は出力エンコード関数ではない。ページに埋め込むなら別途エンコードが要る。
- **jQuery は「短く書ける」せいで sink が見えにくい。** `$()`・`.html()`・`.append()` に source の値を渡していないか、コードを丁寧に追う。
- **この記事は2016年のもの。** IE9 やjQuery中心の記述は当時の事情。現代は DOMPurify・Trusted Types・CSP という選択肢がある。

## この節のまとめ

- DOM-based XSS は、サーバ側 XSS と違い「ブラウザ上で JavaScript が動くまで発生しない」ため、レスポンス検査では見つからない。
- 追跡の道具立ては source（攻撃者が制御する入力の入口）と sink（危険な形で出力・実行される出口）である。
- 第7回は危険な sink を `document.write`／`eval`／`setTimeout`・`setInterval`／`Function`／jQuery の5系統に分けて解説した。
- HTML エスケープは `&`→`&amp;`、`<`→`&lt;`、`>`→`&gt;`、`"`→`&quot;`、`'`→`&#x27;` の5文字を変換する。`&` を最初に置換する。
- だがエスケープは万能ではなく、1か所の漏れで破綻し、危険なコンテキストでは効かない。
- そのため第7回の結論は「エスケープを頑張るのではなく、危険な sink そのものを使わない」。`document.write` をやめて DOM 操作 API、`eval` をやめて `JSON.parse`、`setTimeout` には関数を渡す、`Function`・jQuery に攻撃者制御文字列を渡さない。
- OWASP も同じ結論を RULE #6／#7 で公式に述べている（"use the right output method (sink)"）。
- `textContent`／`innerText` は `<script>` 要素では安全でなく、`setAttribute` も属性名を選ばないと安全でない。
- `JSON.stringify` は出力エンコード関数ではないため、ページ埋め込み時は別途エンコードが必要。
- ユーザに HTML を書かせたいときはサニタイズ（DOMPurify）を使う。第7回はこのケースの答えを持っていない。
- DOMPurify は IE では何もしないため、2016年当時はサニタイズが選択肢になりにくかった。
- Trusted Types は「危険な sink を使うな」という人間の規律をブラウザに強制させる仕組みで、CSP `require-trusted-types-for 'script'` で有効化する（Chromium 83+ ネイティブ対応）。
- バグハンターは DevTools で source から sink への到達を追うのが基本動作である。

## 理解度チェック

1. DOM-based XSS が反射型・格納型 XSS と根本的に違う点は何か。
   ▶ 答え: 反射型・格納型はサーバ側の注入問題だが、DOM-based はクライアント（ブラウザ）側の注入問題で、ブラウザ上で JavaScript が入力を DOM に書き込んだ実行時に初めて発生する。サーバのレスポンスを見ても検出できない。

2. source と sink とは何か。1つずつ例を挙げよ。
   ▶ 答え: source は攻撃者が制御しうる入力の入口（例: `location.hash`）。sink は値が危険な形で出力・実行される出口（例: `innerHTML`、`document.write`、`eval`）。

3. HTML エスケープで変換する5文字と変換先を書け。また、なぜ `&` を最初に置換するのか。
   ▶ 答え: `&`→`&amp;`、`<`→`&lt;`、`>`→`&gt;`、`"`→`&quot;`、`'`→`&#x27;`。`&` を後回しにすると、他の変換で生まれた `&`（例: `&lt;` の `&`）が二重に変換されてしまうため。

4. `eval("(" + json + ")")` の安全な代替は何か。なぜそれが安全なのか。
   ▶ 答え: `JSON.parse(json)`。`JSON.parse` は正しい JSON 以外を拒否するので、`eval` のように攻撃者のコードを実行できない。

5. `setTimeout` に文字列を渡してはいけない理由と、正しい渡し方を述べよ。
   ▶ 答え: 第1引数に文字列を渡すと暗黙の `eval` でコードとして実行されるため。関数（関数オブジェクト、必要ならクロージャ）を渡す。

6. HTML エスケープをしても XSS を防げない場所（危険なコンテキスト）を2つ挙げよ。
   ▶ 答え: `<script>` 内、HTML コメント内、`<style>`（CSS）内、属性名の位置、タグ名の位置、`eval`／`setTimeout`／`setInterval` の引数、などから2つ。

7. `textContent` は「常に安全」と言えるか。
   ▶ 答え: 言えない。`<script>` 要素に対して `innerText`/`textContent` 相当の代入をすると中身がコードとして実行されうる。テキスト系だから無条件安全ではない。

8. ユーザに HTML を書かせたい機能では、エスケープでも DOM API でもなく何を使うべきか。
   ▶ 答え: サニタイズ。OWASP は DOMPurify を推奨し、`DOMPurify.sanitize(dirty)` で危険な HTML を除去した安全な文字列を得る。

9. Trusted Types は第7回の対策方針とどう関係するか。
   ▶ 答え: 第7回の「危険な sink を使うな」という人間の規律を、ブラウザに強制させる仕組み。CSP `require-trusted-types-for 'script'` を指定すると、生文字列を `innerHTML` 等に代入した時点で例外になる。

10. バグバウンティで DOM-based XSS を探すとき、最も基本になる作業は何か。
    ▶ 答え: DevTools（Sources タブ等）で、source から取った値がどの変数を経てどの sink に到達するかを追跡すること。レスポンスの静的な検査だけでは見つからない。

## 出典

- はせがわようすけ「JavaScriptセキュリティの基礎知識」第7回「DOM-based XSS その2」 https://gihyo.jp/dev/serial/01/javascript-security/0007 （原典は取得できず、二次情報と OWASP 公式で再構成）
- 連載トップ https://gihyo.jp/dev/serial/01/javascript-security
- 第6回 https://gihyo.jp/dev/serial/01/javascript-security/0006 ／第8回 https://gihyo.jp/dev/serial/01/javascript-security/0008
- OWASP「DOM based XSS Prevention Cheat Sheet」 https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
- OWASP「Cross Site Scripting Prevention Cheat Sheet」 https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP「DOM ベース XSS 対策チートシート」（JPCERT/CC 日本語訳） https://jpcertcc.github.io/OWASPdocuments/CheatSheets/DOMbasedXSSPrevention.html
- DOMPurify https://github.com/cure53/DOMPurify
- Trusted Types（W3C） https://github.com/w3c/trusted-types ／ https://web.dev/trusted-types/ ／ https://caniuse.com/trusted-types
- Webアプリケーション脆弱性診断ガイドライン（脆弱性診断士スキルマッププロジェクト） https://github.com/WebAppPentestGuidelines/WebAppPentestGuidelines
- js-primer 2016-07-29 ミーティング議事録 https://github.com/js-primer/js-primer
- PortSwigger Web Security Academy「DOM-based XSS」 https://portswigger.net/web-security/cross-site-scripting/dom-based
- CodeZine https://codezine.jp/article/detail/17342 ／ CodeGrid https://www.codegrid.net/articles/2018-xss-1/

<!-- sources: https://gihyo.jp/dev/serial/01/javascript-security/0007, https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html, https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html, https://jpcertcc.github.io/OWASPdocuments/CheatSheets/DOMbasedXSSPrevention.html, https://github.com/cure53/DOMPurify, https://github.com/w3c/trusted-types, https://github.com/WebAppPentestGuidelines/WebAppPentestGuidelines, https://github.com/js-primer/js-primer, https://portswigger.net/web-security/cross-site-scripting/dom-based -->
<!-- terms: DOM-based XSS, source, sink, HTMLエスケープ, document.write, eval, JSON.parse, setTimeout, Functionコンストラクタ, jQuery, textContent, innerHTML, dangerous contexts, サニタイズ, DOMPurify, Trusted Types, CSP, 同一オリジン, クロージャ, setAttribute -->
<!-- self-read: https://gihyo.jp/dev/serial/01/javascript-security/0007 | gihyo.jp が実行環境の egress プロキシで遮断され原典を自動取得できず -->
<!-- self-read: https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-document-write-sink | portswigger.net が遮断され自動取得できず、無料ラボは読者が手を動かす必要がある -->
