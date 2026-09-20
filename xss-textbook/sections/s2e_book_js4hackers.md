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
