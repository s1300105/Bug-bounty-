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
