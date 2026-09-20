## OWASP XSS防御チートシート（出力エンコーディングの原理）

反射型XSS（Reflected XSS: 攻撃者が仕込んだスクリプトが、サーバの応答にそのまま反射されて実行される最も素朴な型）の「攻撃」を知っている読者が、次に体系立てて学ぶべきは「防御」の側の原理です。攻撃を防ぐには、なぜXSSが起きるのかという仕組みを、ブラウザのパーサ（HTMLやJavaScriptなどの文字列を解釈して実行可能な構造に変換する処理系）のレベルまで降りて理解する必要があります。このセクションでは、Webセキュリティの世界で事実上の標準的な防御基準として参照されている **OWASP Cross-Site Scripting Prevention Cheat Sheet** を精読し、その中核である「出力エンコーディング（Output Encoding: 危険な文字を、ブラウザに“データ”として扱わせる無害な表現へ変換する処理）」の原理を、なぜそうなるのかまで含めて解説します。

> このセクションの資料（`https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html`）は、自動取得の際にネットワーク側のエグレス制限で直接アクセスがブロックされました。ただし、この資料は OWASP が GitHub 上で公開している原本（Markdown）と同一内容であり、そちらを精読して内容を完全に復元しています。したがって本セクションは「取得済み」の資料として記述しています。

---

### 0. まず結論：XSS防御に「銀の弾丸」は存在しない

チートシートは冒頭で、XSS（Cross-Site Scripting: 攻撃者のスクリプトを被害者のブラウザ上で実行させる脆弱性）という名称そのものが「実態を正しく表していない誤称（misnomer）」だと述べます。攻撃の本質は「サイトをまたぐ（cross-site）」ことではなく、「本来データであるべき文字列が、ブラウザによってコード（スクリプト）として解釈・実行されてしまう」点にあるからです。その影響は深刻で、以下が挙げられています。

- アカウントのなりすまし（account impersonation）
- ユーザーの行動の監視（observing user behavior）
- 外部コンテンツの読み込み（loading external content）
- 機微データの窃取（stealing sensitive data）

そのうえでチートシートが最初に強調する結論はこうです。

> 「単一の技術ではXSSは解決できない。適切な防御技術の“組み合わせ”が必要になる（Since no single technique will solve XSS, using the right combination of defensive techniques will be necessary）。」

この「組み合わせ」の柱が、次の3つです。本セクションはこの3本柱を軸に構成します。

1. **フレームワークセキュリティ（Framework Security）** — モダンなWebフレームワークの自動エスケープを正しく使う
2. **出力エンコーディング（Output Encoding）** — フレームワークの保護外で、コンテキストごとに手動でエンコードする
3. **HTMLサニタイズ（HTML Sanitization）** — ユーザーにHTML自体を書かせる場合に、危険なHTMLだけを除去する

さらに、これらを補強する「多層防御（defense-in-depth: 一つの防御が破られても被害を抑えるための、独立した複数の防御層）」として、CSP・Cookie属性・Trusted Types などが位置づけられます。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 1. 最重要の原理：なぜ「コンテキストごと」にエンコードが違うのか

このチートシート全体を貫く最も重要な原理を、先に仕組みのレベルで説明します。ここを理解すれば、以降のルールはすべて「当然の帰結」として腹落ちします。

#### 1.1 ブラウザは1枚のHTMLを「複数の異なるパーサ」で解釈している

ブラウザは、受け取ったHTML文書を単一の解釈規則で読んでいるわけではありません。文書の中の「どの位置か」に応じて、内部で別々のサブパーサ（部分解釈器）へ制御を切り替えます。おおまかに言うと、

- タグとタグの間の本文 → **HTMLパーサ** が読む
- 属性値の中 → **HTML属性パーサ** が読む（読み終えたあと、属性値はさらにその属性の意味に応じて再解釈される）
- `<script>` の中や `on*` イベントハンドラ属性の中 → **JavaScriptパーサ** が読む
- `<style>` の中や `style` 属性の中 → **CSSパーサ** が読む
- `href` / `src` などの値 → **URLパーサ** が読む

つまり、同じ1文字（たとえば `"` や `<` や `'`）でも、それがどのパーサに渡されるかによって「区切り文字（構文的に特別な意味を持つ文字）」になったり、ただのデータ文字になったりします。XSSは、この「特別な意味を持つ文字」を攻撃者が注入し、パーサに“ここからはコードだ”と誤認させることで成立します。

#### 1.2 「HTMLエンコードさえすれば安全」は誤り

ここから、チートシートの最も重要な警告が導かれます。

> 「HTMLエンティティエンコーディングは、`<script>`タグの中、`onmouseover`のようなイベントハンドラ属性の中、CSSの中、URLの中に信頼できないデータを置く場合には“効かない”。したがって、どこでもHTMLエンティティエンコードを使っていたとしても、依然としてXSSに対して脆弱である可能性が非常に高い。」

なぜでしょうか。HTMLエンティティエンコード（`<` を `&lt;` にする等）は「HTMLパーサ」に対してだけ有効な無害化です。しかし `<script>` の中身は、HTMLパーサではなく**JavaScriptパーサ**に渡ります。JavaScriptパーサから見れば `&lt;` はただの文字列であり、そこに注入された `';alert(1);//` のようなJavaScriptの区切り文字（`'` やセミコロン）はまったく無害化されていません。つまり「そのデータが最終的にどのパーサに解釈されるか」に合わせてエンコード方式を選ばなければ、防御は空振りします。

チートシートはこれを次の一文に凝縮しています。

> 「信頼できないデータを置くHTML文書の“その部分”に対応したエンコード構文を、必ず使わなければならない（You MUST use the encode syntax for the part of the HTML document you're putting untrusted data into）。」

これが「コンテキスト別エンコーディング（context-specific output encoding）」という考え方であり、以降の各節はすべて「どのコンテキストなら、どのパーサに合わせて、何をエンコードするか」を定めたものです。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 2. 第一の柱：フレームワークセキュリティ（Framework Security）

チートシートは、開発者が最初に頼るべきはフレームワークだと述べます。モダンなWebフレームワーク（React、Angular、Vue、Lit など）は、テンプレート機能と自動エスケープ機能によって、既定でXSSバグを大幅に減らします。テンプレートに変数を差し込むと、フレームワークが自動的にコンテキストに応じたエスケープを施してくれるためです。

> 「モダンなWebフレームワークで作られたアプリケーションはXSSバグが少ない。しかし、フレームワークが“安全でない使い方”をされると問題が起こりうることを、開発者は知っておく必要がある。」

#### 2.1 各フレームワークの「抜け穴（escape hatch）」

自動エスケープは万能ではなく、各フレームワークには開発者が意図的に自動エスケープを回避できる「抜け穴」が用意されています。ここが典型的なXSSの入口になります。チートシートが挙げる代表例は以下です。

- **React**: `dangerouslySetInnerHTML`（サニタイズせずにHTMLをそのまま挿入する）。また `href` などに `javascript:` / `data:` スキームのURLを渡す処理の不備。
- **Angular**: `bypassSecurityTrustAs*`（`bypassSecurityTrustHtml` など。Angularの組み込みサニタイズを明示的に迂回する関数群）。
- **Lit**: `unsafeHTML`（名前のとおり“安全でないHTML”を挿入するディレクティブ）。
- **Polymer**: `inner-h-t-m-l` 属性、および `htmlLiteral` 関数。
- **テンプレートインジェクション（Template Injection）**: ユーザー入力をテンプレート“文字列そのもの”に混ぜてしまい、テンプレートエンジンにコードとして評価させてしまう問題。

これらの関数・属性の名前に `dangerously` / `unsafe` / `bypass` が含まれていること自体が、「ここを使うなら自分で無害化の責任を負え」という設計上のシグナルです。

#### 2.2 目標は「完全な注入耐性（Perfect Injection Resistance）」

チートシートが理想として掲げるのは「完全な注入耐性」、すなわち**すべての変数が、出力の前に検証（validation）され、かつエスケープまたはサニタイズされている**状態です。フレームワークの自動エスケープが届かない範囲（＝上記の抜け穴を使う箇所や、フレームワークを使わない箇所）では、次章の「出力エンコーディング」と「HTMLサニタイズ」を人間が補わなければなりません。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 3. 第二の柱：出力エンコーディング（Output Encoding）― コンテキスト別ルール

ここが本セクションの中心です。前述のとおり、ブラウザは位置ごとに別のパーサで解釈するため、コンテキストごとにエンコード方式を変える必要があります。以下、チートシートが定める主要な5コンテキストを、原文のコード例とともに解説します。

以降、`$varUnsafe` は「攻撃者が制御できる可能性のある信頼できない変数」を表します。

#### 3.1 HTMLコンテキスト（HTML本文の中）

タグとタグの間に変数を置く、最も基本的なケースです。

```html
<div> $varUnsafe </div>
```

ここに何も加工せず攻撃者の入力が入ると、次のようになります。

```html
<div> <script>alert`1`</script> </div>
```

**なぜ動くのか**: `<div>` の内側はHTMLパーサが読んでいます。攻撃者が `<script>` という文字列を入れると、HTMLパーサはこれを「新しい要素の開始タグ」として解釈し、その中身をJavaScriptとして実行します。`alert`1`` はテンプレートリテラル（バッククォート）を使った呼び出しで、`alert(1)` と同義です。関数呼び出しにカッコではなくバッククォートを使うのは、`(` や `)` を除去・フィルタするような素朴な対策を回避するための定番テクニックです。

**防御**: HTMLエンティティエンコーディング（HTML Entity Encoding）。HTMLパーサにとって特別な意味を持つ文字を、エンティティ（`&名前;` や `&#番号;` の形式の“文字の別表現”）に変換します。チートシートが挙げる変換対象は次のとおりです。

```
&  →  &amp;
<  →  &lt;
>  →  &gt;
"  →  &quot;
'  →  &#x27;
```

これにより攻撃者の `<script>` は `&lt;script&gt;` となり、HTMLパーサは「小なり記号という“文字データ”」として画面に表示するだけで、タグとしては解釈しません。

**JavaScriptで安全に行う方法（Safe Sink）**:

```javascript
elem.textContent = dangerVariable;  // 安全
```

`textContent` は、代入された文字列を常に「テキスト（データ）」として扱い、HTMLとして解釈しません。ブラウザがエンコードを肩代わりしてくれるため、開発者が手でエンティティ変換する必要がありません。これが「安全なシンク（Safe Sink）」の典型例です（シンクについては第5章で詳述）。

#### 3.2 HTML属性コンテキスト（属性値の中）

変数を属性値として置くケースです。

```html
<div attr="$varUnsafe">
```

無防備だと、次のように属性の境界を破られます。

```html
<div attr="x" onblur="alert(1)">
```

**なぜ動くのか**: 攻撃者が入力に `"` を含めると、属性値を囲むダブルクォートが早期に閉じられ、そこから先が「新しい属性」としてHTMLパーサに解釈されます。攻撃者は続けて `onblur="alert(1)"` のようなイベントハンドラ属性（要素がフォーカスを失ったときにJavaScriptを実行する属性）を注入できます。属性の“区切り”である `"` が、防御の要になっていることがわかります。

**防御その1：属性値を必ずクォートで囲む**。チートシートは、なぜクォートが決定的に重要かを次のように説明します。

> 「変数を囲むのに `"` や `'` のような引用符を使うことが極めて重要である。クォーティングは変数が動作するコンテキストを変更することを困難にし、XSS防止に役立つ。またクォーティングは、エンコードすべき文字集合を大幅に減らす（Quoting also significantly reduces the characterset that you need to encode）。」

もしクォートで囲まないと（例: `<div attr=$varUnsafe>`）、攻撃者は `"` を注入する必要すらなく、単なる**スペース1文字**で属性を区切って新しいイベントハンドラを追加できてしまいます。クォートで囲むことで「攻撃者はまずそのクォート文字を注入しないと境界を破れない」状態になり、無害化すべき文字が実質的にそのクォート文字（と `&`）に絞り込まれます。

**防御その2：HTML属性エンコーディング**。チートシートは、属性コンテキストでは非常に強いエンコード（aggressive encoding）を推奨します。すなわち「英数字（アルファベットと数字）を除くすべての文字を `&#xHH;` 形式（HHはその文字のUnicodeコードポイントを16進で表したもの）でエンコードする」というものです。

```
例:  A  →  &#x41;
```

英数字だけを素通しにして、記号類をすべてエンティティ化することで、攻撃者がどんな区切り文字（`"`, `'`, スペース, `>` など）を送り込んでも、それらは無害な文字データに変換されます。

**安全なHTML属性の一覧（Safe HTML Attributes）**: チートシートは、上記のエンコードを施したうえで、変数を入れてよい「安全な属性」を明示的に列挙しています。逆に言えば、この一覧に**ない**属性（とりわけ `onclick` などの `on*` イベントハンドラ、`href`/`src` などのURL属性、`style` 属性）に変数を入れるのは、属性エンコードだけでは不十分で危険です。

```
align, alink, alt, bgcolor, border, cellpadding, cellspacing, class,
color, cols, colspan, coords, dir, face, height, hspace, ismap, lang,
marginheight, marginwidth, multiple, nohref, noresize, noshade, nowrap,
ref, rel, rev, rows, rowspan, scrolling, shape, span, summary, tabindex,
title, usemap, valign, value, vlink, vspace, width
```

**JavaScriptで安全に行う方法（Safe Sink）**:

```javascript
elem.setAttribute(safeName, dangerVariable);  // 安全（safeNameが安全な属性名であること）
elem[attribute] = dangerVariable;             // 安全
```

`setAttribute` は値をデータとして設定するため、DOM経由で属性を設定する限りは属性値インジェクションが起きません。ただし属性名（`safeName`）自体が攻撃者制御でないことが前提です（属性名に `onerror` などを指定できてしまえば意味がありません）。

#### 3.3 JavaScriptコンテキスト（インラインJavaScriptの中）

`<script>` 内やイベントハンドラ内など、JavaScriptとして解釈される場所に変数を置くケースです。チートシートはここで非常に厳しい制限を課します。

> 「JavaScript内で変数を置いてよい“唯一の安全な位置”は、“クォートで囲まれたデータ値（quoted data value）”の内部だけである。それ以外のコンテキストはすべて安全ではない（All other contexts are unsafe）。」

安全とされるのは、次のように文字列リテラルの中に置く形だけです。

```html
<script>alert('$varUnsafe')</script>
<script>x='$varUnsafe'</script>
<div onmouseover="'$varUnsafe'"></div>
```

**なぜ“クォートで囲まれたデータ値”だけが安全なのか**: JavaScriptパーサから見ると、`'...'` の中は「文字列リテラル（データ）」として扱われ、コードとしては実行されません。したがって攻撃者の狙いは「この文字列リテラルを途中で閉じて、そこからコードを書き始める」ことに絞られます。たとえば `$varUnsafe` に `';alert(1);//` が入れば、`x='';alert(1);//'` となり、文字列を閉じた後の `alert(1)` が実行されてしまいます。逆に言えば、文字列を閉じさせる文字さえ無害化すれば守れる、という見通しの良い状況になります。だからこそ「クォートで囲まれたデータ値」以外（＝スクリプト直下に裸で置く、イベントハンドラの式部分に置く、など）は、閉じるべき境界が存在しないため、そもそも安全化のしようがなく「unsafe」と断じられるのです。

**防御：JavaScriptエンコーディング**。英数字以外のすべての文字を16進エスケープします。ここでチートシート原文には**表記のゆれ**があり、本文の解説箇所では `\xHH` 形式（例: `\x27`）、末尾の「Output Encoding Rules Summary（出力エンコーディングルール要約）」表では Unicode の `\uXXXX` 形式（例: `'`）が示されています。実務上はどちらも「JavaScriptの文字列リテラル内で、その文字を安全なエスケープ表現に置き換える」ことを意味し、`\uXXXX` 形式のほうがコードポイントを6桁で明示できるため曖昧さが少なく堅牢です。

**バックスラッシュエスケープを使ってはいけない**。チートシートは明確に警告します。

> 「バックスラッシュによるエスケープ（`\"` や `\'` や `\\`）は避けよ（avoid backslash encoding）。」

**なぜバックスラッシュエスケープが危険なのか**: `"` を `\"` に変換するだけの素朴な対策は、攻撃者がまず `\` を送り込むことで破れます。たとえば入力を `\` にすると、防御側は `\` を `\\`… ではなく、`"` だけをエスケープする実装だと、攻撃者の `\` はそのまま残り、直後に防御側が付けた `\"` と結合して `\\"` となり、結局クォートが「エスケープされていない状態」で復活してしまう、といった取りこぼしが起きます。区切り文字だけをバックスラッシュで守るのではなく、上記の16進エスケープで“文字集合ごと”無害化するのが確実だ、というのがチートシートの立場です。

**JSONを扱う場合の注意**: サーバがJSONを返すなら、レスポンスの `Content-Type` を必ず `application/json` にすること（`text/html` にしない）。`text/html` のままだと、ブラウザがJSON応答をHTMLとして解釈し、中に含まれる `<script>` などが実行されてしまう危険があるためです。また、JSON文字列をJavaScriptに埋め込む際は、HTMLの区切り文字（`<`, `>`, `&` など）もエスケープしておくと、`</script>` によるスクリプトブロックの早期終了を防げます。

#### 3.4 CSSコンテキスト（インラインCSSの中）

`<style>` 内や `style` 属性内の**プロパティ値**に変数を置くケースです。

```html
<style> selector { property : $varUnsafe; } </style>
<span style="property : $varUnsafe">Oh no</span>
```

**防御：CSS Hexエンコーディング（CSS 16進エンコード）**。CSSパーサ用の16進エスケープには短形式 `\XX` と長形式 `\XXXXXX`（6桁ゼロ埋め）があります。

```
例:  A  →  \41   または   \000041
```

**なぜ長形式（ゼロ埋め6桁）が推奨されるのか**: これはCSSパーサの16進エスケープの構文規則に起因します。CSSでは、16進エスケープは「1〜6桁の16進数字」を取り、次のように終端が判定されます — (a) 6桁に達したら終了、または (b) 6桁未満でも直後に空白文字が来たら終了。したがって短形式 `\41` の直後にたまたま `2`（16進数字とみなせる文字）が続くと、パーサは `\412` を1つのエスケープとして読み、意図した文字とずれてしまいます。チートシートはこの曖昧さを避けるため、次の2択を挙げます。

> (a) CSSエンコードの後にスペースを1つ足す（このスペースはCSSパーサに無視される）／ (b) 値をゼロ埋めして6桁の完全形式で書く。

長形式なら「必ず6桁で確定」するため、後続文字に左右されず一意に解釈されます。これが推奨される理由です。

**JavaScriptで安全に行う方法（Safe Sink）**:

```javascript
style.property = x;  // 安全（プロパティ値へのDOM経由の代入は自動でCSSエンコードされる）
```

**CSSコンテキストの危険な使い方**: プロパティ**値**なら上記で守れますが、次は守れません。

- セレクタ部分に変数を入れる
- URLを扱うプロパティに変数を入れる。チートシートは具体例として次を挙げます。

```css
{ background-url : "javascript:alert(xss)"; }
```

**なぜ動くのか**: 一部のプロパティ（背景画像URLなど）は値としてURLを取り、そのURLスキームが `javascript:` の場合、URLパーサ経由でスクリプトが実行され得ます。CSS 16進エンコードは「文字」を無害化しますが、「`javascript:` というスキームを許してしまう」設計上の穴には対処できません。したがってURLを含むプロパティは、CSSエンコードとは別に、スキームの検証（`http`/`https` のみ許可等）が必要です。

#### 3.5 URLコンテキスト（URLパラメータの中）

リンクのクエリパラメータなどに変数を置くケースです。

```html
<a href="http://www.owasp.org?test=$varUnsafe">link</a>
```

**防御：URLエンコーディング（パーセントエンコーディング）**。W3C標準のパーセントエンコード（`%HH` 形式）で、**パラメータ“値”だけ**をエンコードします。URL全体をまとめてエンコードしてはいけません（`http://` の `:` や `/` までエンコードするとURLが壊れます）。

**JavaScriptで安全に行う方法（Safe Sink）**:

```javascript
window.encodeURIComponent(x);  // 安全（パラメータ値のエンコードに使う）
```

`encodeURIComponent` は「URLの1コンポーネント（値1個分）」用のエンコード関数で、`&` や `=`、`?` など区切り文字も含めてエスケープするため、値の中に区切り文字を注入されてパラメータ構造を改変される攻撃を防げます。

**重要な落とし穴：URL属性内のURLは“二重エンコード”が必要**。URLをHTML属性の値として出力する場合、パーサが2段階（まずHTML属性パーサ、次にURLパーサ）で解釈するため、エンコードも2段階必要です。チートシートの例：

```
url = "https://site.com?data=" + urlencode(parameter)
<a href='attributeEncode(url)'>link</a>
```

**なぜ順序が重要か**: 最初に `urlencode()`（URLエンコード）でパラメータ値のURL区切り文字を無害化し、次にその出来上がったURL文字列全体を `attributeEncode()`（HTML属性エンコード）でHTML属性の区切り文字（`"` など）に対して無害化します。この「内側のパーサ用エンコード → 外側のパーサ用エンコード」という順序は、1.1で述べた「ブラウザが外側から内側へパーサを切り替えて解釈する」構造の裏返しであり、複合コンテキスト一般に通用する原則です。

さらにURL属性（`href`/`src`）では、値そのものが `javascript:` のような危険スキームでないことの検証も必須です（エンコードだけでは `javascript:alert(1)` を止められないため。詳細は3.4と同じ理屈です）。

#### 3.6 出力エンコーディングルール要約表

チートシートの要約を、教科書用に再構成した対応表です。

| データ種別 | コンテキスト | コード例 | 採るべき防御 |
|---|---|---|---|
| 文字列 | HTML本文 | `<span>信頼できないデータ</span>` | HTMLエンティティエンコード |
| 文字列 | 安全なHTML属性 | `<input value="信頼できないデータ">` | 強いHTML属性エンコード + 安全属性リストに限定 + 厳密な入力検証 |
| 文字列 | GETパラメータ | `<a href="/search?q=信頼できないデータ">` | URL（パーセント）エンコード |
| 文字列 | `href`/`src` のURL | `<a href="信頼できないURL">` | 入力の正規化・URL検証・スキームのホワイトリスト（`http`/`https`）+ 属性エンコード |
| 文字列 | CSSプロパティ値 | `<div style="width: 信頼できないデータ;">` | 厳密な構造検証 + CSS 16進エンコード |
| 文字列 | JavaScript変数 | `<script>var x='信頼できないデータ';</script>` | 変数はクォートで囲む + JS 16進/Unicodeエンコード + バックスラッシュエスケープは使わない |
| HTML | HTML本文 | `<div>信頼できないHTML</div>` | HTMLサニタイズ（後述。DOMPurify等） |
| 文字列 | DOM XSS | `<script>document.write(document.location.hash)</script>` | 「DOM based XSS Prevention Cheat Sheet」を参照 |

各エンコード方式の対象と形式のまとめ：

| エンコード方式 | 何をどう変換するか |
|---|---|
| HTMLエンティティ | `&`→`&amp;` / `<`→`&lt;` / `>`→`&gt;` / `"`→`&quot;` / `'`→`&#x27;` |
| HTML属性 | 英数字以外を `&#xHH;`（16進Unicode）に。例: `A`→`&#x41;` |
| JavaScript | 英数字以外を `\xHH` もしくは `\uXXXX` に。例: `A`→`A` |
| CSS Hex | `\XX`（短）または `\XXXXXX`（長・ゼロ埋め6桁）。例: `A`→`\41` / `\000041` |
| URL | W3C標準パーセントエンコード `%HH`。値部分のみ |

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 4. 危険なコンテキスト（Dangerous Contexts）― エンコードでは守れない場所

チートシートは、「そもそも変数を置いてはいけない場所」を明示します。これらの位置は、出力エンコードを施しても安全にならないため、設計として変数の挿入を避けるべきです。

```html
<script>ここに直接（Directly in a script）</script>
<!-- HTMLコメントの中（Inside an HTML comment） -->
<style>ここに直接（Directly in CSS）</style>
<div ここに属性名を定義=test />
<ここにタグ名を定義 href="/test" />
```

**なぜエンコードでは守れないのか**: これらは「区切りで囲まれたデータ値」ではなく、構文構造そのものを変数が担ってしまう位置だからです。たとえばタグ名や属性名を変数で作ると、閉じるべき境界が存在せず、どんなエンコードをしても攻撃者は新しい構文要素を作れてしまいます。HTMLコメント内も、`-->` によるコメント終了や、ブラウザによってはコメント内スクリプトの扱いが不安定で、安全性を保証できません。

そのほか、チートシートが危険領域として挙げるもの：

- コールバック関数（callback functions）
- CSS内でのURL処理: `{ background-url : "javascript:alert(xss)"; }`
- JavaScriptのイベントハンドラ全般: `onclick()`, `onerror()`, `onmouseover()` など
- 危険なJavaScript関数: `eval()`, `setInterval()`, `setTimeout()`（いずれも文字列をコードとして評価しうる）

これらの関数は「文字列を受け取ってコードとして実行する」性質を持つため、渡された文字列がどれだけエンコードされていても、実行時にコードとして解釈されればXSSになります。原則は「これらのシンクに信頼できないデータを渡さない」ことです。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 5. 安全なシンク（Safe Sinks）と「ソース／シンク」モデル

XSSを構造的に理解する枠組みとして、チートシートは「ソース（source）／シンク（sink）」モデルを用います。

- **ソース（source）**: 信頼できないデータが入ってくる入口（URL、フォーム入力、`location.hash`、外部APIの応答など）。
- **シンク（sink）**: そのデータが最終的に代入・解釈される危険な出力先（`innerHTML`、`document.write`、`eval` など）。

XSSは「汚染されたソースのデータが、無害化されないままシンクに到達する」ときに起こります。ここで重要なのが「安全なシンク（Safe Sink）」という概念です。

> 「シンクの中には、変数を“テキスト”として扱い実行しないものがある。それが安全なシンクである。」

安全なシンクは、代入された値を常にデータとして扱うため、そこへ書き込む限りXSSが発生しません。チートシートが挙げる代表例：

```javascript
elem.textContent = dangerVariable;
elem.insertAdjacentText(dangerVariable);
elem.className = dangerVariable;
elem.setAttribute(safeName, dangerVariable);
formfield.value = dangerVariable;
document.createTextNode(dangerVariable);
document.createElement(dangerVariable);
elem.innerHTML = DOMPurify.sanitize(dangerVar);  // ※サニタイズと併用して初めて安全
```

逆に、次は**安全でないシンク**であり、信頼できないデータを直接渡してはいけません。

- `innerHTML`（`DOMPurify.sanitize()` 併用時を除く）
- `outerHTML`
- `document.write()`
- `script.src`
- 各種の評価関数（`eval` 等）

実務のコツは、「どうしてもHTMLとして挿入する必要がないなら、`innerHTML` ではなく `textContent` を使う」ことです。安全なシンクを選ぶだけで、手動エンコードすら不要になり、ミスの余地が消えます。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 6. 第三の柱：HTMLサニタイズ（HTML Sanitization）

出力エンコードは「HTMLをすべて無害な文字に変える」ため、ユーザーに**リッチテキスト（太字・箇条書きなど、HTML自体を含む入力）**を許したい場面では使えません。エンコードすると、ユーザーが書いた `<b>` までもが `&lt;b&gt;` になって画面に文字として出てしまい、意図した装飾が壊れるからです。WYSIWYGエディタ（見たままを編集できるリッチテキストエディタ）のように「HTMLを保持しつつ、危険な部分だけ除去したい」場合に必要なのが、HTMLサニタイズです。

サニタイズ（sanitize: 入力に含まれる危険な要素・属性・スキームを除去または無害化し、安全なHTMLだけを残す処理）は、`<b>` や `<a>` のような無害なタグは残し、`<script>` や `onerror=` や `javascript:` のような危険な構造だけを取り除きます。

**OWASP推奨のライブラリ：DOMPurify**。

```javascript
let clean = DOMPurify.sanitize(dirty);
```

チートシートが挙げる運用上の注意点：

1. **サニタイズ後に結果の文字列を加工しない**。サニタイズ済みHTMLに後から文字列操作を加えると、安全性が崩れる（無害化した構造を再び壊してしまう）可能性がある。
2. **サニタイズ後に別のライブラリへ渡さない**。渡した先のライブラリが文字列を変形し、危険な構造を復活させることがある。サニタイズは「DOMに挿入する直前」に行う。
3. **サニタイズライブラリは定期的にパッチを適用する（keep it patched）**。これはブラウザの挙動が更新され、新しいバイパス手法（サニタイザをすり抜ける新技法）が継続的に発見されるためです。

3点目は特に重要で、サニタイザのバージョン依存性を意識する必要があります。歴史的に、DOMPurify には既知の回避（mutation XSS: ブラウザがHTMLを再パースする際に構造が“変異”して、サニタイズ後に危険なタグが復活する攻撃）に対する修正が複数リリースされてきました。たとえば DOMPurify 2.0.17（2020年公開）や、それ以前の各バージョンでは、当時知られたバイパスへの修正が順次取り込まれています。要点は「サニタイザは一度入れれば終わりではなく、常に最新版へ更新し続ける前提の防御である」ということです。（バージョンごとの具体的な脆弱性・修正状況は、DOMPurifyのリリースノートおよびCHANGELOGで確認するのが確実です。）

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 7. 多層防御（Defense-in-Depth）の各層

以上の3本柱が「主防御」ですが、チートシートはそれを補強する追加の防御層も挙げます。いずれも「主防御の代わりにはならない」点が繰り返し強調されます。

#### 7.1 Cookie属性（HttpOnly など）

Cookieに `HttpOnly` 属性を付けると、そのCookieはJavaScriptの `document.cookie` から読めなくなります。これによりXSSが成立してもセッションCookieの窃取を防ぎ、被害を軽減できます。ただしチートシートは、これはあくまで「影響の軽減（limit the impact）」であって、XSSそのものを防ぐわけではないと明記しています。

#### 7.2 Content Security Policy（CSP）

CSP（Content Security Policy: ブラウザに対し「どこから読み込んだスクリプトなら実行してよいか」等をHTTPヘッダで指示する仕組み）は、許可リスト（allowlist）方式で、許可していないソースのスクリプト実行やインラインスクリプトの実行をブラウザにブロックさせます。

チートシートの立場は明確です。

> 「CSPは多層防御（defense-in-depth）の追加層であり、主防御メカニズムではない。実装を誤りやすい（easy to get wrong）。」

つまり「CSPを入れたから出力エンコードは不要」という考えは誤りで、CSPは「万一エンコードを漏らしたときの保険」として位置づけるべきものです。詳細は別資料「Content Security Policy Cheat Sheet」に委ねられています。

#### 7.3 Trusted Types

Trusted Types は、Chromium系ブラウザで利用できる、DOM系XSSを構造的に封じる比較的新しい仕組みです。次のCSPヘッダで有効化します。

```
Content-Security-Policy: require-trusted-types-for 'script'
```

これを有効にすると、`innerHTML` / `outerHTML` / `document.write` / `script.src` といったDOM XSSシンクが、**素の文字列（plain string）を受け付けなくなり**、必ず「検証済みポリシーを通した型付きの値（Trusted Type）」経由でしか代入できなくなります。チートシートはこれを「DOM系XSSのクラス全体（an entire class）を排除しうる数少ない制御の一つ」と高く評価しています。

**なぜ強力なのか**: これまでの防御は「開発者が正しくエンコード／サニタイズすること」に依存していました。Trusted Types は、危険なシンクへの代入を言語レベル（ブラウザのランタイム）で強制的にゲートするため、「うっかり生文字列を `innerHTML` に渡す」ミス自体が実行時エラーになり、そもそも起こせなくなります。

#### 7.4 WAF（Web Application Firewall）― 推奨されない

WAF（Web Application Firewall: 既知の攻撃パターンに合致するリクエストを検出・遮断する仕組み）でXSSペイロードをブロックする方法もありますが、チートシートはこれを主防御として**推奨しません**。理由：

- 信頼性が低い（既知パターンのマッチに頼るため）
- 新しいバイパス手法が継続的に発見される
- 根本原因（無害化されていないデータがコードとして解釈されること）に対処していない
- **DOMベースXSSを見落とす**（DOM系XSSはサーバのレスポンスに攻撃文字列が現れず、ブラウザ内で完結するため、サーバ前段のWAFでは検知できない）

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 8. アンチパターン（やってはいけない防御設計）

チートシートは、実務でありがちな「一見よさそうだが破綻する」防御設計を、理由とともに列挙しています。中〜上級者ほど陥りやすい罠なので、原理とともに押さえておきましょう。

#### 8.1 CSPだけに依存する

**問題1：ブラウザ互換性の前提が崩れる**。全ブラウザがCSP Level 2/3に対応していると仮定すると、レガシーブラウザで防御が効かない。

**問題2：レガシーアプリを壊す**。組織全体に一律のCSPを適用すると既存アプリが動かなくなり、結局あちこちに「例外・除外」を作る羽目になる。その例外が防御の“ひび（cracks）”になる。

要するにCSPは「主防御」にはできず、あくまで補助である、という8.2節と同じ結論です。

#### 8.2 HTTPインターセプタ（一元的なフィルタ）に依存する

サーブレットフィルタや Spring のインターセプタ（`org.springframework.web.servlet.HandlerInterceptor` など。全リクエスト／レスポンスを横断的に処理する仕組み）で、入力／出力をまとめて検証・エンコードしようとする設計です。一見すると「一箇所で全部守れて効率的」に見えますが、チートシートは次の致命的問題を指摘します。

**問題1：コンテキストを認識できず、不適切なエンコードになる**。これは第1章で述べた原理の直接の帰結です。同じ `lastname` という値が、あるページではHTMLコンテキスト、別のページではJavaScriptコンテキストで使われることがある。インターセプタは「その値が最終的にどのコンテキストで使われるか」を知らないため、単一のエンコード方式しか適用できず、両方には正しく対応できません。

**問題2：二重エンコードと表示崩れ**。コンテキストを無視して一律エンコードすると、`O'Hara` が `O&#39;Hara` のように壊れて表示される（さらに別の場所でもう一度エンコードされると二重エンコードになる）。これを嫌ってビジネス要件で例外を作ると、その例外がXSS防御の穴になります。

**問題3：DOMベースXSSに無効**。レスポンス中の全JavaScriptを走査して汚染データを検出するのは非現実的であり、DOM系XSS（サーバのレスポンス文字列には現れず、ブラウザ内でソース→シンクが完結する型）はインターセプタでは捕捉できません。

**問題4：外部ソース由来のデータに対応できない**。インターセプタは通常「HTTPの入力パラメータ」だけを“汚染”とみなします。しかし実際には、内部のREST API応答や社内データベースの値も汚染されている可能性があります。チートシートの具体例：あるアプリが顧客の住所欄にXSSペイロードを保存し、別のアプリ（顧客請求画面）がそのDBの住所を「信頼できる内部データ」とみなして無害化せず表示すると、カスタマーサポート担当者がその画面を開いた瞬間にスクリプトが発火する――というストアド／二次注入型の被害です。インターセプタは「入力パラメータだけ」を汚染源と決めつけるため、この経路を守れません。

**総括**: これらのアンチパターンの根っこは、いずれも「コンテキストという情報を無視して防御を一箇所に集約しようとした」ことにあります。第1章の原理――防御は“そのデータが最終的にどのパーサに解釈されるか”に合わせて行う――を守れない設計は、規模が大きくなるほど破綻するのです。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 9. このセクションのまとめ

- XSSの本質は「本来データであるべき文字列が、ブラウザによってコードとして解釈・実行されてしまう」こと。防御の核心は、**そのデータが最終的にどのパーサ（HTML／属性／JavaScript／CSS／URL）に解釈されるかに合わせて無害化する**「コンテキスト別出力エンコーディング」である。
- 「HTMLエンコードさえすれば安全」は誤り。`<script>`・イベントハンドラ・CSS・URLの中ではHTMLエンティティエンコードは効かない。
- 防御は3本柱の組み合わせ：**フレームワークの自動エスケープを正しく使い（抜け穴 `dangerouslySetInnerHTML` 等に注意）**、その外側は**コンテキスト別に出力エンコードし**、HTML自体を許す箇所は**DOMPurifyでサニタイズ（かつ更新し続ける）**。
- 迷ったら「安全なシンク（`textContent`, `setAttribute`, `encodeURIComponent` 等）」を選ぶ。安全なシンクなら手動エンコードすら要らず、ミスの余地が消える。
- CSP・HttpOnly・Trusted Types は多層防御の追加層。とくに Trusted Types はDOM系XSSをクラスごと封じうる強力な制御。ただしCSP単独依存やWAF依存、コンテキスト非依存のインターセプタ一括処理は、原理的に破綻するアンチパターンである。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
>
> 関連資料（本チートシートが参照するもの）: DOM based XSS Prevention Cheat Sheet / Content Security Policy Cheat Sheet / XSS Filter Evasion Cheat Sheet
