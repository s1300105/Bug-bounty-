## 変異XSSによるDOMPurify再バイパス

このセクションでは、HTMLサニタイザのデファクトスタンダードである **DOMPurify** に対して、**変異XSS（mutation XSS, mXSS）** を使って繰り返しバイパスが成立してきた歴史を、仕組みのレベルで解説する。特に次の2本の研究を中心に扱う。

1. Gareth Heyes による「Bypassing DOMPurify again with mutation XSS」（PortSwigger Research, 2020年10月7日公開。DOMPurify < 2.1 に対する再バイパス）
2. Daniel Santos（@bananabr）による DOMPurify < 2.2.2 バイパス（GitHub Issue #482, 2020年11月2日報告）

いずれも「一度サニタイズを通過した無害に見えるHTMLが、ブラウザに再解釈された瞬間に危険なHTMLへ**変異（mutation）**する」という、反射型の素朴なXSSとは根本的に発想の異なる攻撃である。ここを理解すると、「なぜ文字列レベルのフィルタや正規表現によるサニタイズが原理的に脆弱なのか」「なぜDOMベースのサニタイザですら破られるのか」が腑に落ちるはずだ。

---

### 前提: このセクションを読む前に押さえておくこと

#### 変異XSS（mXSS）とは何か

**変異XSS（mutation XSS, mXSS）**とは、「サニタイズ処理を行った時点では安全だった文字列が、ブラウザ（正確にはHTMLパーサ）に読み込まれて実際のDOMツリー（ブラウザ内部でHTMLを表現する木構造のデータ）を組み立てる過程で、**別の（危険な）構造へ勝手に書き換わってしまう**」ことを利用する攻撃である。「変異（mutation）」という名前は、まさにこの「入力文字列が解釈の途中で姿を変える」現象に由来する。

素朴な反射型XSSが「`<script>`という文字列をそのまま埋め込めるか？」を問うのに対し、mXSSは「サニタイザが見ているDOMと、最終的にブラウザが作るDOMが**一致しない**」という食い違い（不整合, discrepancy）そのものを突く。したがって、サニタイザがどれほど厳密に「今見えているDOM」を検査しても、検査後に構造が変わってしまえば意味がない。

#### DOMPurifyの動作モデルと「2回パースされる」という宿命

DOMPurifyの典型的な処理フローは次のとおりである。

1. **1回目のパース**: 受け取ったHTML文字列を、ブラウザのパーサ（`DOMParser`や`template`要素などを利用）で一度DOMツリーに変換する。
2. **サニタイズ（危険なノードの除去）**: できあがったDOMツリーを上から下まで走査（トラバース）し、許可リスト（allow-list, 安全と認められたタグ・属性だけを通す方式）に載っていない要素・属性を削除する。
3. **再シリアライズ（serialize, DOMを文字列HTMLへ戻す処理）**: 掃除の終わったDOMツリーを、`innerHTML`などで取り出せるHTML文字列に戻す。
4. **2回目のパース**: そのサニタイズ済み文字列を、開発者が最終的に `element.innerHTML = purified` のようにページへ挿入すると、**ブラウザがもう一度パースして**本物のDOMを作る。

問題の核心はこの構造にある。**DOMPurifyが検査するのは「1回目のパース」で得たDOMなのに、実際にページに現れて動くのは「2回目のパース」で得たDOM**である。もしこの2回のパースが同じ文字列から**異なる木**を作るなら、1回目では無害だったものが2回目で牙をむく。mXSSとは、この「1回目 ≠ 2回目」を意図的に作り出す技術に他ならない。

> sink（ユーザー入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`, `outerHTML`, `document.write`）に、サニタイズ済みの文字列を渡した瞬間が「2回目のパース」に相当する。

#### なぜ `<style>`・コメント・属性値が鍵になるのか（パーサの再解釈）

mXSSペイロードには、`<style>`、HTMLコメント（`<!-- -->`）、CDATAセクション（`<![CDATA[ ]]>`）、そして**属性値**が頻出する。これは偶然ではなく、いずれも「**文脈（コンテキスト）によって中身の扱いが変わる**」HTMLパーサの性質を突いているためである。中でも決定的なのは次の2点だ。

- **`<style>`・`<title>`・`<textarea>`などは「raw text要素」**: HTML名前空間においては、これらのタグの中身は「タグではなくただのテキスト」として扱われる。つまり `<style><img src=x onerror=alert(1)></style>` の `<img>` は、HTML文脈では**要素ではなく文字列**であり、`onerror`は発火しない。DOMPurifyもこれを「無害なテキスト」と見なして削除しない。**ところが同じ`<style>`が外部名前空間（SVG/MathML）に置かれると raw text ではなくなり、中身が通常のマークアップとして解析され、`<img>`が本物の要素になる**。この「同じタグなのに名前空間で挙動が変わる」ギャップが、mXSSの主戦場である。

- **属性値のシリアライズは `<` `>` `/` をエスケープしない**: DOMがHTML文字列へ戻される（シリアライズされる）とき、属性値の中では `&` や `"` はエスケープされるが、`<`・`>`・`/` は**そのまま**出力される。したがって、ある属性の値が文字列として `</style><img onerror=alert(1)>` を含んでいると、シリアライズ後の文字列にはこの `</style>` がそっくりそのまま現れる。次に `<style>` が「raw text要素」として解釈される文脈で再パースされると、パーサは raw text を読み進める途中でこの `</style>` に到達してそこで`<style>`を閉じてしまい、続く `<img onerror=...>` を**本物のタグ**として解析する。これが典型的な変異である。

この2つを組み合わせると、「サニタイザから見れば、危険なコードは属性値の中に閉じ込められた無害な文字列。しかし再パース時には`<style>`が閉じられて属性の外へ飛び出し、実行可能な要素になる」という、まさに文字列が変異する状況を作れる。

---

### 名前空間（namespace）とintegration pointの基礎

DOMPurifyのmXSSバイパスは、ほぼ例外なく**名前空間の切り替え**を悪用する。ここが本セクション最大の山場なので、丁寧に積み上げる。

#### HTML / SVG / MathML の3つの名前空間と foreign content

ブラウザのHTMLパーサは、1つの文書の中に**3種類の名前空間**の要素を作り分ける。

- **HTML名前空間**（`http://www.w3.org/1999/xhtml`）: 普通の`<div>`や`<img>`など。
- **SVG名前空間**（`http://www.w3.org/2000/svg`）: `<svg>`要素以下。
- **MathML名前空間**（`http://www.w3.org/1998/Math/MathML`）: `<math>`要素以下。

パーサは通常HTML名前空間で動いているが、`<svg>` または `<math>` に出会うと、そこから先を **foreign content（外部コンテンツ）** として扱い、それぞれSVG/MathML名前空間へ切り替える。foreign contentの中では、HTMLとは**異なる解析規則**が適用される。前述の「`<style>`が raw text 要素でなくなる」のもこの規則差の一例である。

#### text integration point と HTML integration point

foreign content一色になると、その中にHTMLを書けなくなってしまい不便である。そこで仕様には、**外部名前空間の中に「ここから先はHTMLとして解析してよい」という穴**が用意されている。これが **integration point（統合点）** だ。2種類ある。

- **MathML text integration point**: `<mi>` `<mo>` `<mn>` `<ms>` `<mtext>` の5要素。これらの**中身**は、（一部の例外を除いて）HTMLとして解析される。つまりMathMLの海の中に空いた「HTMLの島」である。
- **HTML integration point**: SVGの `<foreignObject>` `<desc>` `<title>`、および MathMLの `<annotation-xml>`（ただし属性 `encoding` が `text/html` か `application/xhtml+xml` のとき）。これらの中身もHTMLとして解析される。`<foreignObject>`はまさに「SVGの中に非SVG（＝HTML）を埋め込むため」の要素だ。

まとめると、パーサの「現在の名前空間」は `<svg>`/`<math>` で外部へ切り替わり、integration point で再びHTMLへ戻る、というように**入れ子の親子関係に応じて刻々と変化**する。この「親が誰か」で子の名前空間が決まる、という点が後の攻撃で決定的になる。

#### mglyph と malignmark という特別な例外

ここが多くのDOMPurify mXSSの心臓部である。HTML仕様には次の特別ルールがある。

> **`<mglyph>` と `<malignmark>` は、MathML text integration point（`<mtext>`など）の「直接の子」である場合に限り、HTMLではなくMathML名前空間の要素として扱われる。**

言い換えると、`<mtext>`の中は基本HTMLの島なのに、`<mglyph>`と`<malignmark>`という2つのタグだけは「島の中の飛び地」で、MathML名前空間に留まるのである。この例外があるおかげで、攻撃者は次のような細工ができる。

- **1回目のパース**では、`<mglyph>` が `<mtext>` の直接の子に「ならない」ように、間に別の要素（例: `<table>`）を挟んでおく。すると `<mglyph>` はHTML名前空間となり、その下の `<style>` もHTML名前空間の raw text 要素になり、DOMPurifyには無害に見える。
- ところが**DOMPurifyが間の要素を削除**したり、パーサの自動補正でその要素が消えたりすると、**2回目のパース**では `<mglyph>` が `<mtext>` の直接の子に「なってしまい」、MathML名前空間へ移る。すると配下の `<style>` は raw text でなくなり、中に隠しておいた `<img onerror>` が本物の要素として復活する。

これが「**名前空間混同（namespace confusion）**」の典型パターンである。要素が置かれる名前空間が、サニタイズ前後で食い違うことを指す。

#### なぜ名前空間が「混同」されるのか

根本原因は、**DOMPurifyが検査した木の形と、再パース後の木の形が、パーサの自動補正・ノード削除・所有権規則によってズレる**ことにある。DOMPurifyは「今見えているノードの名前空間」を基準に安全性を判断するが、その判断はノードの親子関係に依存し、親子関係はサニタイズによって変わり得る。攻撃者は「サニタイズがこの木をこう変形させ、その結果この要素の名前空間がHTML→MathML（またはその逆）へ切り替わる」という一手先を読んで、変異を仕込むわけである。

---

### 背景となる先行研究: Michał Bentkowski の DOMPurify < 2.0.17 バイパス（2020年）

2本の担当資料はいずれも、Michał Bentkowski（securitum）の先行研究「Mutation XSS via namespace confusion -- DOMPurify < 2.0.17 bypass」を土台にしている。理解の前提として、まずこれを簡潔に押さえる。

Bentkowskiは、次の形のペイロードでDOMPurify **2.0.17未満**をバイパスした。

```html
<svg><p><style><g title="</style><img src=x onerror=alert(1)>">
```

- **なぜ動くのか**: `<svg>`でSVG名前空間に入り、直後の `<p>`（SVGに存在しないHTML要素）によってパーサが名前空間の切り替え・要素の自動補正を行う。1回目のパースでは `<style>` の中身は解析されず、`<g>` の `title` 属性値が文字列 `</style><img src=x onerror=alert(1)>` として格納される。DOMPurifyは「titleという無害な属性を持つ`<g>`」しか見えないので通過させる。ところが**再シリアライズ→再パース**すると、属性値中の `</style>` が `<style>` を閉じ、`<img onerror>` が本物の要素として出現して発火する。属性値のシリアライズが `<` `>` `/` をエスケープしないという前述の性質が土台になっている。

Bentkowskiが提案し採用された対策は、「**要素が正しい名前空間に置かれているかを、親要素の名前空間と照合して検証する**」というもの（DOMPurifyの`_checkValidNamespace`に相当）。これは以後の名前空間混同を防ぐ堅牢な土台となった。ただし後述する2つの研究は、この防御の「隙間」を突いて再びバイパスに成功する。

> 出典: Mutation XSS via namespace confusion -- DOMPurify < 2.0.17 bypass -- https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/

---

### Gareth Heyes「Bypassing DOMPurify again with mutation XSS」（DOMPurify < 2.1 / 2020年10月7日）

#### 攻撃の着想: 「コメントを見落としたパッチ」

Bentkowskiのバイパス（前節）を受けてDOMPurifyは **2.0.17** で対策を入れた。この対策は、**テキストノードの中に潜在的な変異を引き起こしうる怪しいマークアップが潜んでいないか**を検査するものだった。しかしHeyesは決定的な見落としに気づく。Heyes自身の言葉を借りれば、パッチは「**テキストノード内の潜在的な変異は検査していたが、決定的なことに、コメントについては考慮していなかった（looked for potential mutation inside text nodes but crucially didn't take into account comments）**」のである。

foreign content（SVG/MathML）の内側では、コメント（`<!-- -->`）やCDATAセクション（`<![CDATA[ ]]>`）はHTMLとは異なる特殊な扱いを受ける。そこに変異の起爆装置を隠せば、DOMPurifyのテキスト走査をすり抜けられるというわけだ。「同じDOMPurifyをもう一度（again）破る」という論文タイトルはこの再挑戦を指す。

#### Chromeで動くペイロードと逐次解説

HeyesがChrome向けに示したペイロードは次のとおりである。

```html
<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">
```

- **なぜ動くのか（ステップで追う）**:
  1. `<math>` でMathML名前空間へ。`<mtext>` はMathML text integration point（HTMLの島）。
  2. その中に `<table>` を挟むことで、続く `<mglyph>` は `<mtext>` の**直接の子ではなくなる**。前述の特別ルールにより、直接の子でない `<mglyph>` はMathMLの飛び地にならず**HTML名前空間**にとどまる。よって配下の `<style>` もHTML名前空間の raw text 要素となり、中身（コメントや`<img>`）は**ただのテキスト**として扱われ、DOMPurifyには無害に見える。
  3. さらに危険な `<img src=1 onerror=alert(1)>` を **HTMLコメント越しに、しかも `title` 属性の値の中に、`&gt;`/`&lt;`（`>`/`<`のHTMLエンティティ）でエンコードして**隠しておく。DOMPurifyの「テキストノード検査」はコメントの内側を見ないため、この起爆装置を検出できない。
  4. **サニタイズによって `<table>` が処理・除去される**と、再パース時に `<mglyph>` が `<mtext>` の直接の子に昇格し、**MathML名前空間へ変異**する。すると `<style>` はもはや raw text 要素ではなくなり、`</style>` で閉じられた後の内容やコメントの解釈が変わる。属性値に隠されていた `--&gt;` がコメントを終端させ、`&lt;img src=1 onerror=alert(1)&gt;` がデコードされて本物の `<img>` 要素として出現、`onerror` が発火する。

要するに「`<table>`という詰め物で `<mglyph>` の名前空間をHTML側に固定してDOMPurifyを油断させ、サニタイズで詰め物が消えることで名前空間をMathML側へ変異させ、コメントの陰に隠した`<img>`を復活させる」という三段構えである。

#### Firefoxで動くペイロード（CDATA版）

ブラウザによってforeign content内のコメント/CDATAの扱いが微妙に異なるため、HeyesはFirefox向けに **CDATAセクション** を使う変種も提示している。

```html
<math><mtext><table><mglyph><style><![CDATA[</style><img title="]]&gt;&lt;/mglyph&gt;&lt;img&Tab;src=1&Tab;onerror=alert(1)&gt;">
```

- **なぜ動くのか**: 骨格はChrome版と同一で、隠し場所がHTMLコメントから **CDATAセクション**（`<![CDATA[ ... ]]>`）に替わっている。Firefoxのforeign content解析ではCDATAが有効な特殊構文として処理されるため、`]]&gt;`（`]]>`のエンコード）でCDATAを終端させると、続く `&lt;/mglyph&gt;` と `&lt;img&Tab;src=1&Tab;onerror=alert(1)&gt;` がデコードされ、変異後の名前空間で本物の要素になる。

ここで注目すべきは `&Tab;` エンティティの使用である。`&Tab;` はタブ文字（U+0009）を表すHTMLエンティティだが、通常のスペースの代わりに属性区切りとして使える。変異によってこのエンティティがデコードされた後、パーサがタブ文字を属性間のセパレータとして認識し、`src=1` や `onerror=alert(1)` を `<img>` の独立した属性として正しく解析する。つまり **`&Tab;` がデコードされて属性区切りとして機能すること自体が、変異によって実際に新しいDOM要素が生成されたことの証拠**なのである。

#### Firefox代替ペイロード（コメント版）

Heyesは論文公開後のアップデートで、Firefox向けにCDATAではなくHTMLコメントを使う代替ペイロードも追加している。

```html
<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;/mglyph&gt;&lt;img&Tab;src=1&Tab;onerror=alert(1)&gt;">
```

Chrome版と構造は似ているが、`title`属性値の中に `&lt;/mglyph&gt;` が追加されている点が異なる。変異後に `</mglyph>` がデコードされることで `<mglyph>` を明示的に閉じ、続く `<img>` がMathML名前空間から離脱してHTML要素として解析されるよう調整されている。ここでも `&Tab;` が属性区切りとして活用されている。

> 上記のペイロードで `&gt;`・`&lt;` を使うのは、DOMPurifyの1回目の検査時に「山括弧の生テキスト」として見えないようにするためである。エンティティは属性値の中では無害な文字列にすぎないが、名前空間が変異して`<style>`が要素解析される段になると、パーサがデコードして本物の山括弧として扱う。このタイミングのズレこそが変異XSSの本質だ。

#### 修正と教訓

Heyesが報告したこの一連のベクタは Cure53 によって **DOMPurify 2.1** で修正された（2020年）。教訓は明快だ。「テキストノードだけを検査しても、コメント・CDATAという"パーサ的な死角"に起爆装置を隠されると突破される」。サニタイザは、あらゆる文脈（コメント、CDATA、属性値、各名前空間）で一貫して安全でなければならない、ということである。

> 出典: Bypassing DOMPurify again with mutation XSS（Gareth Heyes, PortSwigger Research, 2020年10月7日公開） -- https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss

---

### Daniel Santos（@bananabr）による DOMPurify < 2.2.2 バイパス（2020年11月）

Heyesの修正（2.1）後、Daniel Santos（GitHub: @bananabr）は**新しい変異の引き金**を持ち込んで再びDOMPurifyを破った。この脆弱性はDOMPurifyのGitHub Issue #482として2020年11月2日に報告され、修正コミット `ee33fae`（"fix: Fixed a mXSS bypass reported in #482"）によって対処された。

#### ペイロードと名前空間の四段階横断

Santosが報告したペイロードは次のとおりである。

```html
<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">
```

このペイロードの最も際立った特徴は、**HTML → MathML → SVG → HTML** という4つの名前空間を横断する点にある。Heyesの攻撃がMathML内のコメント/CDATAを死角としたのに対し、Santosは**SVG名前空間混同（SVG namespace confusion）**を新たなガジェットとして導入した。

#### 変異の引き金: `<form>` 所有権変異ガジェット

HTML仕様には「**フォームは入れ子にできない**（a `<form>` cannot contain another `<form>`）」という制約がある。パーサは `<form>` の中でさらに `<form>` に出会うと、**2つ目の `<form>` を無視（ドロップ）**する。Santosはこの「2つ目のformが再パース時に消える」という挙動を、要素の**親を強制的に付け替える（＝所有権を変える）ガジェット**として利用した。

- **なぜ動くのか（ステップで追う）**:
  1. 1回目のパースでは、途中の `</form>` と2つ目の `<form>` があることで、`<mglyph>` は `<mtext>` の**直接の子にならない**構造として組まれる。よって `<mglyph>` はHTML名前空間にとどまる。
  2. `<mglyph>` の下に `<svg>` があり、そこから再びSVG名前空間へ入る。SVG内の `<mtext>` はMathMLではなくSVG要素として扱われ、その下の `<style>` はHTML名前空間の raw text 要素として機能する。危険な `<img onerror=alert(1)>` は `<path>` の `id` 属性値の中の文字列に過ぎず、DOMPurifyには無害に見える。
  3. しかし再パース時、**入れ子のformが許されず2つ目の`<form>`がドロップされる**ことで木の親子関係が変わり、`<mglyph>` が `<mtext>` の直接の子に昇格する。前述の特別ルールで**MathML名前空間へ変異**し、以降の名前空間の連鎖が崩れる。
  4. 名前空間の連鎖が崩れた結果、`<style>` は raw text 要素ではなくなり、`id` 属性値のシリアライズで露出した `</style>` が `<style>` を閉じ、続く `<img onerror=alert(1) src>` が本物の要素として出現して発火する。

「詰め物として何を使えば名前空間を変異させられるか」の答えが、Heyesの `<table>` から Santosの `<form>`（入れ子禁止という別の仕様）に替わった、と捉えると両者の連続性が見える。さらにSantosは `<svg>` を経由することで名前空間の横断回数を増やし、DOMPurify 2.1 で強化された検証の網の目をくぐり抜けている。

#### 修正と公開の時系列

Santosはこの脆弱性を **2020年11月2日**にCure53へ報告し（GitHub Issue #482）、修正コミット `ee33fae` によって対処された。修正では、名前空間検証の抜け穴（form所有権変異によって子の名前空間が事後的に変わるケース、およびSVGを経由した多段階の名前空間横断）を塞ぐよう、名前空間・親子関係のチェックが強化されている。

> 出典: GitHub Issue #482（Daniel Santos / @bananabr, 2020年11月2日） -- https://github.com/cure53/DOMPurify/issues/482 / 修正コミット `ee33fae` -- https://github.com/cure53/DOMPurify

---

### 実務者のためのまとめ: 攻撃の共通構造・防御・最新状況

#### 全バイパスに共通する「型」

ここまでの3研究（Bentkowski / Heyes / Santos）は、細部は違えど**同じ骨格**を共有している。攻撃者の思考モデルとして一般化すると次の4手順になる。

1. **危険な起爆装置を「無害な容れ物」に隠す**: `<style>`のraw text、属性値、コメント、CDATAなど、「1回目のパースでは要素にならない場所」に `onerror`/`onload` などを仕込む。
2. **名前空間を一時的にHTML側へ固定する詰め物を置く**: `<table>`、入れ子`<form>`、integration point要素（`foreignObject`/`annotation-xml`）などで、`<mglyph>`や`<style>`が「安全に見える名前空間」に留まるよう構造を作る。
3. **サニタイズが詰め物を消すことを見越す**: DOMPurifyが詰め物（table/2つ目のform/integration point要素）を除去・補正すると、親子関係が変わって名前空間が変異する。
4. **再パースで起爆装置が要素化して発火**: 名前空間変異により`<style>`が要素解析に切り替わり、隠していた`<img>`/`<iframe>`が本物の要素として蘇る。

#### 防御策

- **DOMPurifyを常に最新に保つ**: 本セクションのバイパスはいずれも既に修正済み（Bentkowski→2.0.17、Heyes→2.1、Santos→2.2.2、いずれも2020年）。これらの既知ベクタは最新版では成立しないが、**mXSSは構造的に新種が生まれ続ける**領域であり、バージョン追随が最重要。
- **サニタイズの結果を再びHTMLとして解釈させる経路を最小化する**: そもそも `innerHTML` などのHTML sinkへ流し込む回数を減らす。可能なら `textContent` で扱う、テンプレートエンジンの自動エスケープに任せる、など「2回目のパース」を発生させない設計にする。
- **CSP（Content Security Policy）による多層防御**: サニタイザ単独に依存せず、`script-src` の厳格化（`'unsafe-inline'` の排除、nonce/hash方式）や `require-trusted-types-for 'script'`（Trusted Types, DOM sinkへの生文字列代入を型で禁じる仕組み）を併用する。mXSSが万一成立しても、インラインスクリプトや`javascript:`の実行段でもう一段止められる。
- **設定の落とし穴に注意**: `ALLOWED_TAGS`/`ADD_TAGS` で `<style>`・`<svg>`・`<math>`・`foreignObject`・`annotation-xml` などを安易に許可すると、名前空間混同の素地を自ら作りかねない。必要最小限の許可リストにとどめる。

#### バージョン依存性についての注意（陳腐化に備えて）

本セクションのペイロードは、いずれも**特定バージョンでのみ有効な歴史的PoC**である（Bentkowski: DOMPurify < 2.0.17、Heyes: < 2.1、Santos: < 2.2.2。すべて2020年の事象）。現行のDOMPurifyでは通用しない。学ぶべきは個々の文字列そのものではなく、**「サニタイザが見た木」と「ブラウザが作る木」の不整合を、名前空間・integration point・所有権規則という仕様の隙間を使って作り出す**という**発想と原理**である。この原理を理解していれば、将来公開される新しいmXSS（別のガジェット、別のブラウザ差分）にも応用的に対処できる。

> 出典（横断的な確認に使用した情報源）:
> - DOMPurify 公式リポジトリおよび回帰テストフィクスチャ -- https://github.com/cure53/DOMPurify
> - Attack Classes & Bypass History（cure53/DOMPurify Wiki） -- https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
> - Mutation XSS via namespace confusion -- DOMPurify < 2.0.17 bypass（Michał Bentkowski, securitum） -- https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/
