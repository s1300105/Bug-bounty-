## CSTI補足（HackTricks / Beyond XSS）

前節でCSTI（Client Side Template Injection、クライアントサイド・テンプレートインジェクション）の基本を見た。本節では、HackTricksの技術資料とBeyond XSSの実例をもとに、AngularJSを中心とした攻撃の「仕組み」をもう一段深く掘り下げる。具体的には、なぜテンプレート構文がXSSサニタイズをすり抜けるのか、AngularJSのサンドボックスがどのように作られどのように破られたのか、CSPが張られていてもコード実行できてしまうのはなぜか、という3点を中心に整理する。

### CSTIとSSTI・通常のXSSとの違い

まず用語を整理する。SSTI（Server Side Template Injection）はサーバー側のテンプレートエンジン（Jinja2、Twigなど）にユーザー入力がテンプレート文字列として渡り、サーバー上で任意コード実行に至る脆弱性である。CSTIはその「クライアント版」で、AngularJSやVue.jsのようなフロントエンドのテンプレートエンジンに、データではなく**テンプレートそのもの**としてユーザー入力が渡ってしまうことで、ブラウザ内で任意のJavaScriptが実行される。

ここが通常の「素朴な反射型XSS」との決定的な違いだ。素朴なXSSは `<script>` タグや `onerror` 属性など、ブラウザのHTMLパーサ・DOM APIに直接コードを注入する。一方CSTIは、まずアプリケーションが読み込んでいるテンプレートエンジン（AngularJSなど）にとって「これは評価すべき式である」と認識される構文（`{{ ... }}` など）を注入し、テンプレートエンジン自身の評価器にコードを解釈させる。つまり攻撃者はブラウザのHTMLパーサではなく、**アプリケーションが信頼している別のインタプリタ**を乗っ取っているという点で、mXSS（第4章）とよく似た「二重解釈」の構造を持つ。

HackTricksの記述を借りれば、"Angular templates are considered trusted by default, and should be treated as executable code."（Angularのテンプレートはデフォルトで信頼されるものとして扱われ、実行可能コードとして扱うべきである）という前提がある。つまりAngularJSの設計思想として「テンプレート＝開発者が書くもの＝信頼できるもの」という切り分けがあり、ユーザー入力がテンプレート文字列そのものに混入するケースは想定されていない。この前提が崩れたときにCSTIが発生する。

> 出典: Client Side Template Injection (CSTI) - HackTricks — https://hacktricks.wiki/en/pentesting-web/client-side-template-injection-csti.html

### 脆弱なコードの具体例（AngularJS）

Beyond XSSが示す最小構成の脆弱コードは以下のようなものである。

```html
<!DOCTYPE html>
<html>
<body>
  <div ng-app>
    Hello, <?php echo htmlspecialchars($_GET['name']) ?>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.8.3/angular.min.js"></script>
</body>
</html>
```

一見すると `htmlspecialchars()` でエスケープしているため、`<script>alert(1)</script>` のような入力は `&lt;script&gt;...` に変換され安全に見える。しかし `htmlspecialchars()` が変換対象とするのは `<`, `>`, `&`, `"` などのHTML特殊文字であり、`{`、`}`、`(`、`)` は変換対象外である。したがって `name` パラメータに

```
{{constructor.constructor('alert(1)')()}}
```

を渡すと、HTMLエスケープを通過したままページに出力される。ここが `<div ng-app>` の内部であるため、AngularJSがページをスキャンした際にこの `{{ ... }}` を「評価すべきAngular式」として認識し、内部のJavaScript式を実行してしまう。

**なぜ動くか**: AngularJSは `ng-app` が指定された要素の配下をコンパイルする際、テキストノードやバインディング対象の中から `{{ 式 }}` という区切り文字（デフォルトのinterpolation記号）を探索し、その中身をAngular式パーサに渡して評価・監視（watch）する。これはHTMLエスケープの後工程、つまりDOMに文字列がテキストとして挿入された**後**に、AngularJS自身のフレームワークコードが行う処理である。よって「HTMLタグとして解釈されないようにエスケープする」という通常のXSS対策は、そもそもこの攻撃経路には無関係であり、防御として機能しない。ここがCSTIの本質的な怖さであり、「入力をエンコードしたから安全」という思い込みを裏切る典型例である。

> 出典: Template Injection in Frontend: CSTI | Beyond XSS — https://aszx87410.github.io/beyond-xss/en/ch3/csti/

### `constructor.constructor` はなぜ`alert`を呼び出せるのか

ペイロード `{{constructor.constructor('alert(1)')()}}` の仕組みをJavaScriptの言語仕様レベルで説明する。

- 任意のオブジェクトの `.constructor` はそのオブジェクトを作った関数（多くの場合 `Object` や `Function` の派生）を指す。
- 関数オブジェクト自身の `.constructor` は `Function` コンストラクタそのものである。つまり `x.constructor.constructor` は最終的に `Function` に到達する。
- `Function('alert(1)')` は、文字列 `'alert(1)'` をボディとする新しい関数を動的に生成する。これは `eval` と同様に任意の文字列をコードとして実行できる強力な機能である。
- 生成された関数の末尾に `()` を付けて即座に呼び出すことで `alert(1)` が実行される。

つまりこのペイロードは「どんな値からでもたどり着ける `Function` コンストラクタを使い、文字列を実行可能コードに変える」という、JavaScriptのプロトタイプチェーンを利用したサンドボックスエスケープの定石パターンである。AngularJSの式パーサはこの式全体を通常のJavaScriptプロパティアクセス・関数呼び出しとして解釈し、内部で実質的に `Function('alert(1)')()` を実行してしまう。

### AngularJSサンドボックスの歴史とバージョン依存性

AngularJS 1.2.0〜1.5.xの時代には、上記のような `window` や `Function` への到達を防ぐための「式サンドボックス（expression sandbox）」が実装されていた。PortSwigger Web Security Academyの解説によれば、このサンドボックスは主に3つの防御関数から構成されていた。

- **`ensureSafeObject()`**: 自己参照するオブジェクト（`window` はプロパティの中に自分自身への参照を持つ）を検出してブロックする。
- **`ensureSafeMemberName()`**: `__proto__` や `__lookupGetter__` のような危険なプロパティ名へのアクセスをブロックする。
- **`ensureSafeFunction()`**: `call()`、`apply()`、`bind()`、`constructor()` の呼び出しをブロックする。

しかし、これらは「既知の危険パターンをブロックするブラックリスト方式」であったため、セキュリティ研究者による回避策の発見が続いた。代表的な回避手法の一つが、グローバルな `String.prototype.charAt`（正確には研究例では `'a'.constructor.prototype.charAt`）を書き換える手法である。

```
'a'.constructor.prototype.charAt=[].join
```

**なぜ動くか**: これは `String.prototype.charAt` メソッドを配列の `join` メソッドで上書きしてしまう式である。AngularJSの式パーサ内部では、字句解析の過程で `isIdent()` のような関数が文字列を1文字ずつ `charAt()` で読み取り、識別子（変数名として妥当な文字列）かどうかを判定していた。`charAt` の挙動を `join`（引数を無視してすべての要素を連結して返す）にすり替えることで、本来1文字を返すべき箇所で文字列全体が返るようになり、`isIdent()` の判定ロジックが壊れる。その結果、本来なら危険と判定されるはずの式が「安全な識別子」として通過してしまい、後続で `$eval('x=alert(1)')` のようなコードを注入できるようになる。

さらに引用符がフィルタされている状況では、`String.fromCharCode()` を使って文字コードから文字列を組み立て、`$eval` が使えない文脈では `orderBy` フィルタ（`|` 記法でパイプ処理される、配列の並び替えを行う組み込みフィルタ）を式評価のトリガーとして悪用する手法も報告されている。

```
[123]|orderBy:'Some string'
```

このように、AngularJSサンドボックスとの攻防は「フレームワーク側がブラックリストを強化する→研究者が新しい迂回路を見つける」といういたちごっこが続いた。最終的にAngularJS開発チームは、"the sandbox is not actually a security feature"（このサンドボックスは実際にはセキュリティ機能ではない）という立場を取り、**AngularJS 1.6以降でサンドボックス自体を完全に撤廃**した。1.6以降では最初からサンドボックスによる保護がないため、`{{constructor.constructor('alert(1)')()}}` のような最も単純な形のペイロードがそのまま通る。逆に1.2.x〜1.5.x系の古いAngularJSアプリケーションを診断する場合は、対象バージョンごとに有効なサンドボックス回避ペイロードが異なる点に注意が必要で、バグバウンティやペネトレーションテストの実務では、まずAngularJSのバージョンを特定し、そのバージョンで報告済みの回避策を辞書的に試すというアプローチが取られる。

> 出典: Client-Side Template Injection: AngularJS - PortSwigger Web Security Academy — https://portswigger.net/web-security/cross-site-scripting/contexts/client-side-template-injection

### CSPが有効でもコード実行できてしまう仕組み

CSTIが特に危険視される理由の一つが、CSP（Content Security Policy）による `unsafe-eval` や `unsafe-inline` の禁止が防御にならないケースがある点である。

AngularJSには `ng-csp` という属性があり、これを指定すると「CSPに準拠したモード」で動作する。このモードでは `Function` コンストラクタや `eval` を直接使わずに式を評価するよう内部実装が切り替わる。つまり `ng-csp` モードで動いているAngularJSは、CSPの `script-src` に `unsafe-eval` がなくても、独自のインタプリタ（式パーサ／評価器）でテンプレート式を解釈・実行できてしまう。これはCSPが制限しているのは「ブラウザネイティブの `eval`/`Function` の呼び出し」であって、「JavaScriptで書かれた自作インタプリタが文字列をパースして処理を分岐させること」自体はCSPの制御対象外だからである。第4章で扱ったCSPバイパスの一般原則（「CSPは特定のAPI呼び出し経路を塞ぐものであり、アプリケーションロジックそのものは検閲できない」）がここでも当てはまる。

具体的なCSPバイパスの一つが `$event` オブジェクトを利用する手法である。AngularJSはイベントハンドラ式の中で特殊な `$event` 変数（ブラウザのネイティブイベントオブジェクトへの参照）を提供する。Chromeでは、イベントオブジェクトの `path` プロパティ（バブリングの経路を表す配列）の末尾に `window` オブジェクトが含まれることを利用し、以下のようなペイロードで `window` への参照をサンドボックス検知に引っかからない形で取り出せる。

```html
<input autofocus ng-focus="$event.path|orderBy:'[].constructor.from([1],alert)'">
```

**なぜ動くか**: `$event.path` から `window` を含む配列を取得し、`orderBy` フィルタの引数として `[].constructor.from([1], alert)` を渡している。`[].constructor` は `Array` であり、`Array.from(iterable, mapFn)` は第2引数の関数を各要素に適用しながら配列を生成するAPIである。つまりここでは `Array.from([1], alert)` として `alert` を要素 `1` に適用する形で呼び出し、明示的に `window.alert(...)` や `alert(...)` という危険な字面を式中に書かずに、間接的に `alert` 関数を実行させている。ブラックリスト型のフィルタは「危険な識別子やパターンの字面」を検出しようとするため、このように処理を細かく分解して間接呼び出しにすることで検出をすり抜けられる。

HackTricksが挙げるもう一つのCSP回避例は次のようなものである。

```html
<div ng-app ng-csp><textarea autofocus ng-focus="d=$event.view.document;
d.location.hash.match('x1') ? '' : d.location='//localhost/mH/'">
</textarea></div>
```

これは `$event.view`（イベント発生元のウィンドウオブジェクト）経由で `document` を取得し、`location` を書き換えて外部ホストへリダイレクトさせる、より実戦的な悪用例である。`ng-csp` が指定されていても、これらは通常のJavaScript実行としてではなく、AngularJSの式評価器の中で完結する処理として実行されるため、CSPの `script-src` 制限では止められない。

さらに、CSPの `script-src` に `https://cdnjs.cloudflare.com` のような一般的なCDNドメインがホワイトリスト登録されている場合、そのドメインから配信されているAngularJS自体を読み込むタグ（`<script src="https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.x.x/angular.min.js">`）もCSP的には「許可されたスクリプト」として通ってしまう。つまり攻撃者は、ページに元々AngularJSが使われていなくても、CSPで許可されたCDN経由でAngularJS自体を注入し、その上でCSTIペイロードを実行するという合わせ技が成立し得る。これは第4章で扱った「JSONP/ホワイトリストされたスクリプトホストを踏み台にしたCSPバイパス」と同じ発想であり、CSPの `script-src` にライブラリ配信用CDNを緩く許可することの危険性を示す典型例である。

> 出典: Client Side Template Injection (CSTI) - HackTricks — https://hacktricks.wiki/en/pentesting-web/client-side-template-injection-csti.html

### VueJS・他フレームワークでのCSTI

CSTIはAngularJS特有の問題ではなく、「テンプレート文字列をエンジンに評価させる」設計を持つフレームワーク全般に潜在する。HackTricksはVue.jsについても以下のような等価ペイロードを挙げている。

- Vue 2系: `{{constructor.constructor('alert(1)')()}}`（AngularJSと同じ `Function` コンストラクタ到達パターン）
- Vue 3系: `{{_openBlock.constructor('alert(1)')()}}`（Vue 3の内部APIである `_openBlock` を起点に同様のプロトタイプチェーンをたどる）
- 属性経由: `"><div v-html="''.constructor.constructor('...')()"> aaa</div>`（`v-html` ディレクティブの式評価を悪用する例）

Vue.jsは通常、テンプレートのコンパイルをビルド時（Single File Component）に行うため実運用でのCSTIは限定的だが、`v-html` に生の文字列テンプレートを動的に渡す実装や、ランタイムコンパイラを使う構成（CDN版Vueなど）では同種のリスクが生じる。

また、より小規模なテンプレートライブラリであるMavo（宣言的なデータバインディングを提供するフレームワーク）についても、`[7*7]`（`49` に評価されるかで検出）、`[(1,alert)(1)]`（カンマ演算子を使い `alert(1)` を評価させる）、`[self.alert(1)]`、属性ベースの `<a data-mv-if='1 or self.alert(1)'>test</a>` といったペイロードが報告されている。

> 出典: Client Side Template Injection (CSTI) - HackTricks — https://hacktricks.wiki/en/pentesting-web/client-side-template-injection-csti.html

### 検出方法（診断時のプローブ）

実際の診断では、まず副作用のない算術式を注入し、評価結果が反映されるかを確認する。

```
{{ 7-7 }}
```

脆弱なテンプレートエンジンがこれを処理すると出力に `0` が表示され、安全な実装ではそのまま `{{ 7-7 }}` という文字列がエスケープされて表示される。これはSSTI診断で `${7*7}` のような式を使うのと全く同じ発想であり、まず「テンプレートとして評価されているか」を無害な形で確認し、確認できてから `constructor.constructor(...)` のような実害あるペイロードに進む、という手順を踏む。

### 防御策

HackTricksとBeyond XSS双方が強調する最も重要な防御原則は次の一点に尽きる。

- **ユーザー入力をテンプレート文字列そのものとして扱わない**。テンプレートは開発者が記述する「コード」であり、ユーザー入力は常に「データ」としてバインディング変数経由でテンプレートに渡す。文字列連結でテンプレートHTML自体を組み立てる実装（前述の脆弱コード例のように `Hello, <?php echo ... ?>` をAngularJSのコンパイル対象領域に出力する）を避ける。
- HTMLエスケープ（`htmlspecialchars` など）はCSTIの防御にならない。エスケープ対象外の文字（`{`、`}` など）だけでテンプレート構文が成立してしまうため、XSS対策としてのエスケープとCSTI対策は別軸で考える必要がある。
- フレームワークが提供するテンプレートサンドボックス機能がある場合はそれを有効にする。ただしAngularJSの事例が示す通り、ブラックリスト型のサンドボックスは回避策の発見によって陳腐化するため、根本対策にはならない。
- 可能であればAngularJS 1.x系のような、サンドボックスが撤廃済み・保守が終了したフレームワークからの移行を検討する。

### まとめ

CSTIは「エスケープしたのに実行される」という、通常のXSS対策の常識を裏切る脆弱性クラスである。その本質は、ブラウザのHTMLパーサとは別に、アプリケーションが信頼して読み込んでいるテンプレートエンジン自身の式評価器が第二の攻撃対象になるという点にあり、mXSS（パーサの二重解釈）やDOM Clobbering（信頼された変数名の乗っ取り）と並んで、「一次防御であるHTMLエンコード／サニタイズをすり抜けて、別のレイヤーで信頼が崩れる」パターンの一つとして理解しておくと、他の脆弱性クラスとの位置づけが整理しやすい。AngularJSのサンドボックス撤廃（1.6以降）という歴史的経緯は、ブラックリスト型の緩和策がいずれ限界を迎え、設計自体の変更（信頼境界の見直し）に行き着くという、Webセキュリティ全般に通じる教訓でもある。
