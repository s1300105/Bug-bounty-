## DOMPurifyバイパス：MathML名前空間混同（CVE-2020-26870）

このセクションでは、HTMLサニタイザー（入力HTMLから危険な要素・属性を除去して安全なHTMLに変換するライブラリ）のデファクトスタンダードである **DOMPurify** を、Michał Bentkowski（Securitum所属のセキュリティ研究者、Twitter/Xでは @SecurityMB）が2020年に破った手法を、原理のレベルまで掘り下げて解説する。この脆弱性は **CVE-2020-26870** として登録され、DOMPurify **2.0.17未満**の全バージョンが影響を受けた。

キーワードは3つある。**mutation XSS（mXSS）**、**名前空間混同（namespace confusion）**、そして **MathML**。これらが組み合わさると、「サニタイザーが検査した時点では完全に無害だったHTML」が、ブラウザに再びパース（構文解析）された瞬間に「実行可能なJavaScriptを含む危険なHTML」へと化ける。サニタイザーは自分が安全だと判定したものしか出力しないのに、その出力が後から勝手に変異（mutate）してしまうのだ。これがこの攻撃クラスの怖さであり、面白さでもある。

### 前提知識1：mutation XSS（mXSS）とは何か

**mutation XSS（変異型XSS、mXSS）**とは、「一度は安全と判定された（あるいは無害な形に整形された）HTML文字列が、ブラウザによって再解釈された際にDOMツリー（HTML要素の親子関係を表す木構造）が変化し、その結果として危険なコードが出現する」タイプのXSSである。2013年にMario Heiderichらの論文「mXSS attacks: attacking well-secured web-applications by using innerHTML mutations」で体系化された。

mXSSを理解する鍵は、次の事実である。

> **HTML文字列 → DOMツリー → HTML文字列、という往復（serialize-parse roundtrip、シリアライズ／再パースの往復）は、必ずしも元の文字列を返さない。**

普通に考えれば、「あるDOMツリーをHTML文字列に書き出し（シリアライズ、serialize：DOMを文字列表現に変換すること）、それをもう一度パースすれば、同じDOMツリーに戻る」はずである。しかしHTMLのパース規則は非常に複雑で、この往復が **べき等（idempotent、何度やっても結果が変わらない性質）ではない**ケースが多数存在する。サニタイザーが「DOMツリーAは安全だ」と判定してAを文字列に書き出しても、アプリケーションがその文字列を `innerHTML` に代入したときにブラウザが作るのは「別のDOMツリーB」かもしれない。Bに危険な要素が含まれていれば、サニタイズは実質的に無意味になる。

CVE-2020-26870のCVE公式説明文も、まさにこの点を突いている。

```
Cure53 DOMPurify before 2.0.17 allows mutation XSS. This occurs because
a serialize-parse roundtrip does not necessarily return the original DOM
tree, and a namespace can change from HTML to MathML, as demonstrated by
nesting of FORM elements.
```

（訳：DOMPurify 2.0.17未満はmutation XSSを許す。これは、シリアライズ／再パースの往復が必ずしも元のDOMツリーを返さず、FORM要素のネストによって実証されるように、名前空間がHTMLからMathMLへ変化しうるために起こる。）

> 出典: CVE-2020-26870（NVD）、CVSS 3.1: 6.1（MEDIUM）、公開日: 2020年10月7日

### 前提知識2：DOMPurifyはなぜ「2回パース」するのか

なぜ「往復」が起きるのかを理解するには、DOMPurifyの動作原理を知る必要がある。DOMPurifyは概ね次の手順で動く。

1. アプリケーションから、信頼できないHTML文字列（例: ユーザーが投稿したコメント）を受け取る。
2. その文字列を **一度パースしてDOMツリーを作る**（内部的には `DOMParser` や、`<template>`要素の `innerHTML` などを利用）。—— これが **1回目のパース**。
3. できたDOMツリーを走査し、許可リスト（allow-list）に載っていない要素（例: `<script>`）や属性（例: `onerror`）を **削除**する。残った要素は「安全」とみなす。
4. サニタイズ済みのDOMツリーを再び **HTML文字列にシリアライズ**して呼び出し元に返す（`innerHTML` を読み出す等）。
5. アプリケーションはその文字列を、たとえば `element.innerHTML = purified` のように **DOMへ挿入する**。—— ここでブラウザによる **2回目のパース**が発生する。

つまりDOMPurifyが「安全だ」と判断するのはステップ3の**1回目のパース結果**に対してだが、実際に画面に反映されるのはステップ5の**2回目のパース結果**である。この2つが食い違えば、mXSSが成立する。攻撃者のゴールは、「1回目のパースでは無害に見えるが、2回目のパースで危険物が出現する」ような入力を作り込むことだ。

なお、DOMPurifyの後の修正（PR #495）では、この「文書パースモード（document parsing）とフラグメントパースモード（fragment parsing）の差異」による再パースの揺れをさらに減らすため、`insertAdjacentHTML` への依存を完全に廃止し、可能な限りDOMノードを直接操作するように変更されている（詳細は後述の修正パート）。

### 前提知識3：HTMLの3つの名前空間と「統合ポイント」

この攻撃の心臓部が **名前空間（namespace）**である。モダンなHTMLパーサは、1つのHTML文書の中で3種類の言語を扱い分けている。

- **HTML名前空間**（`http://www.w3.org/1999/xhtml`）: 通常のHTML要素。
- **SVG名前空間**（`http://www.w3.org/2000/svg`）: ベクタ画像用の要素。`<svg>` 要素をトリガーに切り替わる。
- **MathML名前空間**（`http://www.w3.org/1998/Math/MathML`）: 数式表現用の要素。`<math>` 要素をトリガーに切り替わる。

同じ要素名でも、**どの名前空間に属するかによってパース規則も振る舞いも変わる**。特に重要なのが `<style>` 要素の挙動の違いである。

- **HTML名前空間の `<style>`**: 「raw text要素（生テキスト要素）」として扱われ、`</style>` が現れるまでの中身は**すべてただのテキスト（CSS）として読まれる**。つまり `<style><img src=x onerror=alert(1)></style>` と書いても、この `<img>` は要素ではなく**文字列**であり、何も起きない。
- **SVG／MathML名前空間の `<style>`**: 外来（foreign）要素として扱われ、中身は **通常のマークアップとしてパースされる**。つまり同じ `<style><img ...></style>` でも、内側の `<img>` は**本物の要素**として木に組み込まれる。

この「`<style>`の中身がテキストなのか要素なのか」という差が、後で決定打になる。

#### 統合ポイント（integration point）とmglyph/malignmarkの特殊性

MathMLやSVGの領域の中に、「ここから先はまたHTMLとして解釈してよい」という橋渡し地点がある。これを **統合ポイント（integration point）**と呼ぶ。

- **MathMLテキスト統合ポイント（MathML text integration point）**: `<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>` の5要素。これらの**子として現れるタグは、原則HTML名前空間として解釈される**（＝MathMLの世界からHTMLの世界へ抜け出せる）。
- **HTML統合ポイント（HTML integration point）**: MathMLの `<annotation-xml>`（一定の条件下）や、SVGの `<foreignObject>`, `<desc>`, `<title>` など。

ところが、この「MathMLテキスト統合ポイントの子はHTMLになる」というルールには **2つの例外**がある。それが本脆弱性の主役、**`<mglyph>` と `<malignmark>`** である。

> HTML仕様の外来コンテンツ（foreign content）に関する規則では、`<mglyph>` と `<malignmark>` は、**MathMLテキスト統合ポイントの「直接の子」である場合に限り、HTMLではなくMathML名前空間のまま**留まる。他のすべてのタグはHTMLに抜け出すのに、この2つだけはMathMLに残る。

「直接の子であるかどうか」で名前空間が変わる—— この一文が攻撃の全てを決める。もし攻撃者が「初回パースでは `<mglyph>` を統合ポイントの**直接の子ではない**位置に、再パースでは**直接の子**になる位置に」動かせれば、`<mglyph>` の名前空間をHTML→MathMLへ「変異」させられる。

> 出典: HTML Standard（tree construction / foreign content の規則）、および DOMPurify Wiki: Attack Classes & Bypass History — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

### 前提知識4：ネストした`<form>`という「所有権変異ガジェット」

最後の部品が **`<form>`要素のネスト（入れ子）に関するHTMLパーサの癖**である。

HTMLパーサは内部に **form element pointer（フォーム要素ポインタ）**という状態を持つ。`<form>` の開始タグを見つけると、パーサは「今このフォームの中にいる」という印としてこのポインタをセットする。そして**すでにフォームが開いている状態で新たな `<form>` に出会うと、2つ目の `<form>` は無視され、要素として作られない**（HTMLではフォームを入れ子にできないため）。

ところが——この「フォームは入れ子にできない」ルールの適用のされ方が、**通常のHTMLコンテキストと、MathML/SVGの外来コンテンツの中とで異なる**。外来コンテンツのパース中には、form element pointerのチェックが通常どおり働かず、**一時的にネストした`<form>`が作られてしまう**瞬間がある。これが本攻撃の「所有権変異ガジェット（ownership mutation gadget）」——ある要素の「親（＝所有者）」を初回パースと再パースの間ですり替える仕掛け——として機能する。

要するに：**初回パースでは幻の2つ目の `<form>` が存在し、`<mglyph>` の親になる。しかし再パースでは、DOMPurifyがシリアライズし直した文字列を素直にパースする過程でその2つ目の `<form>` が消え、`<mglyph>` の親が `<mtext>` に繰り上がる。** 親が変われば、前述の「mglyphは統合ポイントの直接の子ならMathMLに残る」ルールが発動し、名前空間が切り替わる。

### 攻撃の全体像：ペイロードとステップバイステップ

これらの部品が揃ったところで、Bentkowskiのペイロード本体を見よう。

```html
<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
```

一見すると、`<form>` が2つあり、閉じタグの位置がめちゃくちゃで、`<img>` はどう見ても `<style>` の内側にある「壊れたHTML」である。だが、この「壊れ方」こそが計算され尽くしている。なぜこれが動くのか。**初回パース（DOMPurifyが見る木）**と**再パース（ブラウザが最終的に作る木）**を分けて追う。

#### ステップA：初回パース（DOMPurifyが検査する、無害に見える木）

DOMPurifyがこの文字列を最初にパースすると、外来コンテンツ内のネスト`<form>`の癖により、おおよそ次のような構造ができる。

```
form (HTML名前空間)
└─ math (MathML名前空間)
   └─ mtext (MathMLテキスト統合ポイント)
      └─ form (2つ目の form ← 外来コンテンツの癖で「一時的に」出現)
         └─ mglyph (★HTML名前空間★ ← 統合ポイントの「直接の子」ではなく、間にformが挟まっているため)
            └─ style (HTML名前空間 ← 親のmglyphがHTMLなので)
               └─ "(テキスト)</math><img src onerror=alert(1)>"
```

ここでの決定的なポイントは2つ。

1. **`<mglyph>` はHTML名前空間にいる。** なぜなら、`<mtext>`（統合ポイント）の**直接の子ではなく**、間に2つ目の `<form>` が挟まっているからだ。「直接の子でなければ例外は発動しない」ので、mglyphはごく普通のHTML要素扱いになる。
2. **`<style>` もHTML名前空間にいる。** 親のmglyphがHTMLだから。前述のとおりHTMLの `<style>` は raw text要素なので、その後ろに続く `</math><img src onerror=alert(1)>` は**すべて「styleの中身のテキスト文字列」として飲み込まれる**。この文字列内には `</style>` が無いので、`<img>` が独立した要素になることは決してない。

結果、DOMPurifyの目に映るのは「form / math / mtext / form / mglyph / style（中身はただのテキスト）」という、**すべて許可リストに載った無害な要素だけの木**である。`<img>` という要素も、`onerror` という属性も、DOMツリー上には**存在しない**（テキストの一部でしかない）。だからDOMPurifyは何も削除するものを見つけられず、この木をそのまま「安全」と判定してシリアライズし、呼び出し元に返す。

> **なぜ動くのか（ステップAの一文解説）**: `onerror` を含む文字列が、独立した `<img>` 要素の属性ではなく `<style>` の生テキストの一部になっているため、サニタイザーには「除去すべき危険な属性」が一切見えない。危険物は「テキストに変装」して検問を通過する。

#### ステップB：再パース（ブラウザが実際に作る、危険な木）

DOMPurifyが返した文字列を、アプリケーションが `innerHTML` に代入すると、ブラウザが**2回目のパース**を行う。ここで木が「変異」する。DOMPurify Wiki の記述を借りれば、変化は次のとおり。

> On reparsing, the second HTML form is not created and mglyph becomes a direct child of mtext, placing it in the MathML namespace. Because of that, style is also in MathML namespace, hence its content is not treated as text. The `</math>` tag closes the math element, and now the img element is created in HTML namespace, leading to XSS.
>
> （再パース時には2つ目のHTML formは作られず、mglyphがmtextの直接の子になり、MathML名前空間に置かれる。そのためstyleもMathML名前空間になり、その中身はテキストとして扱われない。`</math>` タグがmath要素を閉じ、img要素がHTML名前空間で作られ、XSSに至る。）

再パース後の木は概ねこうなる。

```
form (HTML名前空間)
└─ math (MathML名前空間)
   └─ mtext (MathMLテキスト統合ポイント)
      └─ mglyph (★今度はMathML名前空間★ ← mtextの「直接の子」になったので例外が発動)
         └─ style (★MathML名前空間★ ← 親がMathMLになったので外来要素扱い)
            └─ (中身は「テキスト」ではなく「マークアップ」としてパースされる)
img (HTML名前空間・onerror付き) ← </math> でmathを閉じた後、HTMLに戻って本物のimg要素に!
```

連鎖を分解すると：

1. 2つ目の `<form>` が**消える**（form element pointerのルールで、素直なパースでは入れ子formが作られない）。
2. その結果 `<mglyph>` の親が `<mtext>` に繰り上がり、**統合ポイントの直接の子**になる。
3. mglyph/malignmark例外が発動し、`<mglyph>` は **MathML名前空間**に入る。
4. 子の `<style>` も**MathML名前空間**になる。MathMLの `<style>` は外来要素なので、中身は**マークアップとしてパースされる**（もう「テキスト」ではない）。
5. その中身にある `</math>` が、いま**本当にmath要素を閉じる**。パーサはMathMLの世界から抜け、**HTML名前空間に戻る**。
6. 続く `<img src onerror=alert(1)>` が、**HTML名前空間の本物の `<img>` 要素**として生成される。`onerror` は生きたイベントハンドラだ。
7. `src` が空（または不正）なので画像読み込みが失敗し、`onerror` が発火して `alert(1)` が実行される —— **XSS成立**。

> **なぜ動くのか（ステップBの一文解説）**: `<style>` の名前空間がHTML→MathMLへ「変異」した瞬間に、その内側が「テキスト」から「要素」へと解釈が切り替わり、テキストに変装していた `<img onerror>` が本物の要素として"解凍"される。DOMPurifyは変異前の木しか見ていないので、この解凍を防げない。

同じバイト列 `<img src onerror=alert(1)>` が、初回パースでは「styleの生テキスト」、再パースでは「実行可能なimg要素」——文脈（名前空間）が違えば同じ文字列が別物になる、という**名前空間混同（namespace confusion）**の本質がここに凝縮されている。

なお `src` の書き方には流派があり、`<img src onerror=alert(1)>`（src空）でも `<img src=x onerror=alert(1)>`（存在しないパス）でもよい。いずれも「画像の読み込みに失敗させて `onerror` を発火させる」という同じ目的で、XSSの定番テクニックである。

### この攻撃が示す一般原理：なぜサニタイザーは名前空間に弱いのか

この一件から学ぶべき最重要の教訓は次の点だ。

> **「タグ名（ローカル名）だけを見て安全性を判断してはいけない。要素が実際にどの名前空間にいるかを見なければならない。」**

DOMPurify 2.0.17以前は、要素を「タグ名」ベースの許可リストで判定していた。`mglyph` は許可リストに入っている（MathMLの正当な要素だから）。しかし、**HTML名前空間にいる `mglyph`** は、本来この世に存在してはいけない異常な要素である（mglyphはMathML専用の名前だから）。初回パースでたまたまHTML名前空間の `mglyph` が生まれても、旧DOMPurifyは「mglyphは許可リストにあるからOK」と通してしまった。この「名前空間の取り違え」を見逃したことが、変異の余地を残した。

より一般化すると、mXSSの温床は次の3条件が揃うときだ。

1. サニタイザーが **serialize→parse の往復**を（明示的または暗黙に）行う。
2. HTMLパースに **往復でべき等でない**箇所がある（名前空間の切り替え、`<style>`/`<textarea>`/`<title>`等のraw text要素、コメント、属性のエスケープ差など）。
3. サニタイザーが **1回目のパース結果**を検査し、実行されるのは**2回目のパース結果**である。

名前空間混同は、この(2)の中でも特に強力なガジェットである。なぜなら、要素の名前空間はDOMツリー上の**親子関係**から動的に決まり、その親子関係は「ネストformの癖」のようなパーサの細かな挙動で往復のたびに変わりうるからだ。

### CVE-2020-26870：バージョン・タイムライン・影響

バージョン依存の攻撃なので、対象と修正状況を明記しておく（陳腐化への注意）。

| 項目 | 内容 |
|---|---|
| CVE番号 | **CVE-2020-26870** |
| 対象製品 | Cure53 **DOMPurify** |
| 影響バージョン | **2.0.17 未満**のすべて |
| 修正バージョン | **2.0.17** |
| CVE公開日 | 2020年10月7日 |
| CVSS 3.1 基本値 | **6.1（MEDIUM）** |
| 発見・報告者 | **Michał Bentkowski**（Securitum） |
| 攻撃前提 | サニタイズ結果が `innerHTML` 等でDOMに挿入され、MathML/SVGを含む外来コンテンツがサニタイズ対象に含まれること（DOMPurifyの既定はHTML/MathML/SVGを全てサニタイズ対象とする） |

CVSSが「6.1 / MEDIUM」なのは、XSS一般と同様に「利用者の操作（被害者が細工されたコンテンツを含むページを閲覧すること、UI:R）」を要し、また影響が機密性・完全性への部分的影響（C:L/I:L）にとどまる評価がなされているためである。ただし実際にはセッション乗っ取りやアカウント侵害に直結しうるので、実務上のインパクトは軽視できない。

**重要な陳腐化の注意**: この個別のペイロード（form/math/mglyph/style）は 2.0.17（2020年）で修正済みであり、現行のDOMPurify（3.x系）では動作しない。学習の目的は「このペイロードを撃つこと」ではなく、**名前空間混同という攻撃クラスの原理を理解すること**にある。実際、同じ原理の別バリアントがその後も繰り返し発見されており（後述）、この攻撃クラス自体は今も生きている。

### 修正：`_checkValidNamespace` と Pull Request #495

Bentkowskiは脆弱性を報告するだけでなく、修正案そのものも提示した。それが DOMPurify の **Pull Request #495「Harden protection against mutation XSS caused by namespace switching」**（作者 securityMB＝Bentkowski本人、2020年12月17日マージ）である。中核は新設された **`_checkValidNamespace`** 関数で、**各ノードを「親の名前空間」に照らして検証し、仕様上ありえない名前空間の切り替えを検出したらそのノードを削除する**というものだ。

`_checkValidNamespace` が強制する5つの検証ルール（PR #495より）：

1. **SVGからHTMLへの名前空間切り替え**は、`<svg>` タグを経由する場合にのみ許可される。
2. **MathMLからHTMLへの名前空間切り替え**は、`<math>` タグを経由する場合にのみ許可される。
3. **HTMLから外来コンテンツへの切り替え**は、指定された統合ポイント（MathMLテキスト統合ポイントやHTML統合ポイント）においてのみ許可される。
4. **SVG／MathML固有の要素**が、HTML名前空間に出現することは許可されない。誤配置された要素は**削除**される。
5. 逆に、**SVG/MathML名前空間にのみ属すべきHTML要素**が誤った名前空間に配置されている場合も**削除**される。

このルール4こそが、まさに本攻撃を無力化する。初回パースで生まれた「**HTML名前空間の `mglyph`**」は、ルール4に照らすと「HTML名前空間に存在するMathML固有要素」という不正な状態なので、DOMPurifyがサニタイズ段階で**削除**する。危険物を"解凍"するための足場（mglyph→style）がそもそも取り除かれるため、再パースしても何も起きない。

PR #495はさらに、mXSSの温床を減らすための周辺強化も行った。

- **`insertAdjacentHTML` への依存の廃止**: 文書パースモード（document parsing）とフラグメントパースモード（fragment parsing）の差に起因する再パースの揺れを防ぐため、DOMノードを直接扱う方式に変更。これによりserialize-reparseの不一致が生じる余地を削減した。
- **DOM clobbering（DOMクロバリング：`id`/`name`属性でDOMプロパティを上書きしてスクリプトの前提を崩す攻撃）対策**の強化。キャッシュされた、realm安全なアクセサを用いてDOMクロバリングを防止。

> 出典: Harden protection against mutation XSS caused by namespace switching (PR #495) — https://github.com/cure53/DOMPurify/pull/495

なお、DOMPurify Wikiではセキュリティゴールとして、`RETURN_DOM_FRAGMENT: true` を使えばserialize-reparseの過程自体をスキップできるため、mXSSの懸念を根本から回避できることも明記されている。

### 防御策：アプリ側・ライブラリ側でできること

実務者として押さえるべき防御を整理する。

1. **DOMPurifyを最新に保つ**。名前空間混同は一度きりの脆弱性ではなく、次々と新種が見つかる「クラス」である。2.0.17（本CVE）、2.2.2（後述のSVG版）など、修正のたびにバージョンを上げること。バージョン固定（ピン留め）したまま放置するのが最も危険。
2. **不要な外来コンテンツを許可しない**。多くのWebアプリはユーザー入力にMathMLやSVGを本当に必要とはしていない。DOMPurifyの設定で `USE_PROFILES: { html: true }` のようにHTMLのみを許可し、MathML/SVGを対象から外せば、名前空間混同の攻撃面（attack surface）を根本から縮小できる。
3. **可能なら「サニタイズしてから即挿入」以外の設計を検討する**。信頼できないHTMLをそもそもレンダリングしない、テキストとして扱う（`textContent` を使う）、あるいはサーバ側での厳格な検証と組み合わせる、など多層防御にする。
4. **CSP（Content Security Policy）を併用する**。万一サニタイズをすり抜けても、`script-src` を厳格にし、インラインイベントハンドラ（`onerror` 等）を禁止していれば、`onerror=alert(1)` の発火自体をブロックできる可能性がある。ただしCSPはサニタイザーの代替ではなく、最後の砦としての併用が原則。
5. **サニタイザーを自作しない**。名前空間混同やmXSSは、HTMLパーサの深い挙動を知らなければ防げない。DOMPurifyのような、専門家が継続的にバイパスと修正を繰り返してきた実績あるライブラリを使うこと。

### この攻撃クラスの系譜：名前空間混同は繰り返す

Bentkowskiの2.0.17バイパスは孤立した事件ではない。**名前空間混同によるmXSS**は、DOMPurifyの歴史の中で繰り返し現れる主要な攻撃クラスであり、本セクションの技術的価値の核心もそこにある。代表的な系譜を挙げる。

- **2019年（SVG版・DOMPurify < 2.0.x）**: PR #495にも記録されている、SVGを起点とするmXSS。
  ```html
  <svg></p><style><a title="</style><img src onerror=alert(1)>">
  ```
  HTMLの `<p>` がSVG要素の子として出現（仕様違反）。シリアライズ後に再パースされると、外来コンテンツの規則により要素の名前空間が変化し、`<img>` がHTML名前空間で実体化する。原理は本CVEと同型（名前空間の境界と `<style>` のraw text挙動の悪用）。

- **2020年（MathML版・CVE-2020-26870・DOMPurify < 2.0.17）**: 本セクションのBentkowskiの手法。form/math/mtext/mglyph/style。MathMLテキスト統合ポイントを悪用し、HTML `<mglyph>` が不正にHTML名前空間に出現、再パースでMathML名前空間にシフトしてXSSに至る。

- **2020年以降（SVG版・DOMPurify < 2.2.2）**: Daniel Santos（vovohelo）による「From SVG and back, yet another mutation XSS via namespace confusion」。「SVGへ入って、また戻る」ことで名前空間を混同させる別角度のバイパス。`_checkValidNamespace` 導入後も、なお抜け道が残っていたことを示した。

これらに共通する防御原則は、PR #495以降DOMPurifyが確立した次の一文に集約される。

> **「サニタイザーは、ローカルなタグ名だけでなく、要素が実際に属する名前空間で評価しなければならない。」**

> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
> 出典: From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass（Daniel Santos） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f

### 参考：Michał Bentkowski の関連研究

Bentkowskiは2013年よりSecuritumに所属し、Webおよびモバイルアプリのセキュリティ診断・研究・トレーニングに従事している。DOMPurifyやサニタイザーバイパス、プロトタイプ汚染に関心があれば、いずれも一級の教材である。

- **Mutation XSS via namespace confusion -- DOMPurify < 2.0.17 bypass**（本セクションの主題、2020年） — https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/
- **DOMPurify 2.0.0 bypass using mutation XSS**（別のmXSSによる初期のDOMPurifyバイパス）
- **Prototype pollution and bypassing client-side HTML sanitizers**（プロトタイプ汚染〔JavaScriptのプロトタイプチェーンを汚染して既定挙動を書き換える攻撃〕を使い、DOMPurifyを含むクライアント側サニタイザーを破る研究。半自動的な悪用手法の探索も含む）
- **HTML sanitization bypass in Ruby Sanitize < 5.2.1**（Ruby製サニタイザーSanitizeのRELAXED構成を完全にバイパス、2020年）
- **XSS in GMail's AMP4Email via DOM Clobbering**（DOMクロバリングによるGmail AMP4EmailのXSS、Google VRP報告、2019年）
- **Exploiting prototype pollution for RCE in Kibana (CVE-2019-7609)**（プロトタイプ汚染からのリモートコード実行）

講演「A word about DOMPurify bypasses a.k.a why DOM parsing is crazy（DOMPurifyバイパスの話、あるいはなぜDOMパースは狂っているのか）」は、本セクションのテーマそのものを扱っており必見である。

> 出典: Michał Bentkowski 研究インデックス — https://www.bentkowski.info/research/
> 出典: Michał Bentkowski（Securitum 著者ページ） — https://research.securitum.com/authors/michal-bentkowski/

### まとめ

- **CVE-2020-26870**は、DOMPurify < 2.0.17に対する **mutation XSS（mXSS）**であり、その手口は **MathMLの名前空間混同**だった。
- 攻撃の骨格は「**同じ文字列が、初回パースと再パースで別の名前空間に置かれ、`<style>` の中身が『テキスト』から『要素』へ化ける**」こと。ネストした `<form>` を「所有権変異ガジェット」に使い、`<mglyph>` の親を `mtext` に繰り上げることで、mglyph→styleの名前空間をHTML→MathMLへ変異させ、隠していた `<img onerror>` を再パース時に解凍する。
- ペイロード: `<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>`。
- 修正は **`_checkValidNamespace`（PR #495、2020年12月17日マージ）**で、「各ノードを親の名前空間に照らして検証し、HTML名前空間の `mglyph` のような仕様違反要素を削除する」ことにより、変異の足場を除去した。`insertAdjacentHTML` への依存廃止も同時に行われ、serialize-reparseの不一致リスクを低減した。
- 教訓は普遍的で、**サニタイザーはタグ名ではなく実際の名前空間で判断すべし**。そして名前空間混同は一度で終わらず、SVG版・MathML版と形を変えて繰り返し現れる「クラス」であるため、**ライブラリを最新に保ち、不要な外来コンテンツを許可しない**ことが実務上の要である。
