## 変異XSSによるDOMPurify再バイパス

このセクションでは、HTMLサニタイザ（入力に含まれる危険なタグや属性を取り除き、安全なHTMLだけを残すライブラリ）のデファクトスタンダードである **DOMPurify** に対して、**変異XSS（mutation XSS, mXSS）** を使って何度も繰り返しバイパス（防御のすり抜け）が成立してきた歴史を、仕組みのレベルで解説します。特に次の2本の研究を中心に扱います。

1. Gareth Heyes による「Bypassing DOMPurify again with mutation XSS」（DOMPurify < 2.1 に対する再バイパス）
2. Daniel Santos（vovohelo）による「From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass」（SVG名前空間混同を使った < 2.2.2 バイパス）

いずれも「一度サニタイズを通過した無害に見えるHTMLが、ブラウザに再解釈された瞬間に危険なHTMLへ**変異（mutation）**する」という、反射型の素朴なXSSとは根本的に発想の異なる攻撃です。ここを理解すると、「なぜ文字列レベルのフィルタや正規表現によるサニタイズが原理的に脆弱なのか」「なぜDOMベースのサニタイザですら破られるのか」が腑に落ちるはずです。

> ⚠️ **未取得の資料に関する重要なお断り**: 本セクションが担当する2つの一次資料（上記1・2）は、いずれも本実行環境のネットワーク送信ポリシー（egress proxy）によって自動取得できませんでした。そのため本文は、**DOMPurify公式リポジトリの回帰テスト（regression test）フィクスチャに実際に登録されている該当ペイロード**、複数の二次情報源、および筆者の専門知識を突き合わせて内容を復元したものです。各ペイロードは公式テストと突合済みで正確ですが、原文の文章表現そのものではありません。原文は各小節末尾に示すURLからご自身でご確認ください。該当箇所には規約どおり個別の未取得ブロックも再掲します。

---

### 前提: このセクションを読む前に押さえておくこと

#### 変異XSS（mXSS）とは何か

**変異XSS（mutation XSS, mXSS）**とは、「サニタイズ処理を行った時点では安全だった文字列が、ブラウザ（正確にはHTMLパーサ）に読み込まれて実際のDOMツリー（ブラウザ内部でHTMLを表現する木構造のデータ）を組み立てる過程で、**別の（危険な）構造へ勝手に書き換わってしまう**」ことを利用する攻撃です。「変異（mutation）」という名前は、まさにこの「入力文字列が解釈の途中で姿を変える」現象に由来します。

素朴な反射型XSSが「`<script>`という文字列をそのまま埋め込めるか？」を問うのに対し、mXSSは「サニタイザが見ているDOMと、最終的にブラウザが作るDOMが**一致しない**」という食い違い（不整合, discrepancy）そのものを突きます。したがって、サニタイザがどれほど厳密に「今見えているDOM」を検査しても、検査後に構造が変わってしまえば意味がありません。

#### DOMPurifyの動作モデルと「2回パースされる」という宿命

DOMPurifyの典型的な処理フローは次のとおりです。

1. **1回目のパース**: 受け取ったHTML文字列を、ブラウザのパーサ（`DOMParser`や`template`要素などを利用）で一度DOMツリーに変換する。
2. **サニタイズ（危険なノードの除去）**: できあがったDOMツリーを上から下まで走査（トラバース）し、許可リスト（allow-list, 安全と認められたタグ・属性だけを通す方式）に載っていない要素・属性を削除する。
3. **再シリアライズ（serialize, DOMを文字列HTMLへ戻す処理）**: 掃除の終わったDOMツリーを、`innerHTML`などで取り出せるHTML文字列に戻す。
4. **2回目のパース**: そのサニタイズ済み文字列を、開発者が最終的に `element.innerHTML = purified` のようにページへ挿入すると、**ブラウザがもう一度パースして**本物のDOMを作る。

問題の核心はこの構造にあります。**DOMPurifyが検査するのは「1回目のパース」で得たDOMなのに、実際にページに現れて動くのは「2回目のパース」で得たDOM**です。もしこの2回のパースが同じ文字列から**異なる木**を作るなら、1回目では無害だったものが2回目で牙をむきます。mXSSとは、この「1回目 ≠ 2回目」を意図的に作り出す技術に他なりません。

> sink（ユーザー入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`, `outerHTML`, `document.write`）に、サニタイズ済みの文字列を渡した瞬間が「2回目のパース」に相当します。

#### なぜ `<style>`・コメント・属性値が鍵になるのか（パーサの再解釈）

mXSSペイロードには、`<style>`、HTMLコメント（`<!-- -->`）、CDATAセクション（`<![CDATA[ ]]>`）、そして**属性値**が頻出します。これは偶然ではなく、いずれも「**文脈（コンテキスト）によって中身の扱いが変わる**」HTMLパーサの性質を突いているためです。中でも決定的なのは次の2点です。

- **`<style>`・`<title>`・`<textarea>`などは「raw text要素」**: HTML名前空間においては、これらのタグの中身は「タグではなくただのテキスト」として扱われます。つまり `<style><img src=x onerror=alert(1)></style>` の `<img>` は、HTML文脈では**要素ではなく文字列**であり、`onerror`は発火しません。DOMPurifyもこれを「無害なテキスト」と見なして削除しません。**ところが同じ`<style>`が外部名前空間（SVG/MathML, 後述）に置かれると raw text ではなくなり、中身が通常のマークアップとして解析され、`<img>`が本物の要素になります**。この「同じタグなのに名前空間で挙動が変わる」ギャップが、mXSSの主戦場です。

- **属性値のシリアライズは `<` `>` `/` をエスケープしない**: DOMがHTML文字列へ戻される（シリアライズされる）とき、属性値の中では `&` や `"` はエスケープされますが、`<`・`>`・`/` は**そのまま**出力されます。したがって、ある属性の値が文字列として `</style><img onerror=alert(1)>` を含んでいると、シリアライズ後の文字列にはこの `</style>` がそっくりそのまま現れます。次に `<style>` が「raw text要素」として解釈される文脈で再パースされると、パーサは raw text を読み進める途中でこの `</style>` に到達してそこで`<style>`を閉じてしまい、続く `<img onerror=...>` を**本物のタグ**として解析します。これが典型的な変異です。

この2つを組み合わせると、「サニタイザから見れば、危険なコードは属性値の中に閉じ込められた無害な文字列。しかし再パース時には`<style>`が閉じられて属性の外へ飛び出し、実行可能な要素になる」という、まさに文字列が変異する状況を作れます。

---

### 名前空間（namespace）とintegration pointの基礎

DOMPurifyのmXSSバイパスは、ほぼ例外なく**名前空間の切り替え**を悪用します。ここが本セクション最大の山場なので、丁寧に積み上げます。

#### HTML / SVG / MathML の3つの名前空間と foreign content

ブラウザのHTMLパーサは、1つの文書の中に**3種類の名前空間**の要素を作り分けます。

- **HTML名前空間**（`http://www.w3.org/1999/xhtml`）: 普通の`<div>`や`<img>`など。
- **SVG名前空間**（`http://www.w3.org/2000/svg`）: `<svg>`要素以下。
- **MathML名前空間**（`http://www.w3.org/1998/Math/MathML`）: `<math>`要素以下。

パーサは通常HTML名前空間で動いていますが、`<svg>` または `<math>` に出会うと、そこから先を **foreign content（外部コンテンツ）** として扱い、それぞれSVG/MathML名前空間へ切り替えます。foreign contentの中では、HTMLとは**異なる解析規則**が適用されます。前述の「`<style>`が raw text 要素でなくなる」のもこの規則差の一例です。

#### text integration point と HTML integration point

foreign content一色になると、その中にHTMLを書けなくなってしまい不便です。そこで仕様には、**外部名前空間の中に「ここから先はHTMLとして解析してよい」という穴**が用意されています。これが **integration point（統合点）** です。2種類あります。

- **MathML text integration point**: `<mi>` `<mo>` `<mn>` `<ms>` `<mtext>` の5要素。これらの**中身**は、（一部の例外を除いて）HTMLとして解析されます。つまりMathMLの海の中に空いた「HTMLの島」です。
- **HTML integration point**: SVGの `<foreignObject>` `<desc>` `<title>`、および MathMLの `<annotation-xml>`（ただし属性 `encoding` が `text/html` か `application/xhtml+xml` のとき）。これらの中身もHTMLとして解析されます。`<foreignObject>`はまさに「SVGの中に非SVG（＝HTML）を埋め込むため」の要素です。

まとめると、パーサの「現在の名前空間」は `<svg>`/`<math>` で外部へ切り替わり、integration point で再びHTMLへ戻る、というように**入れ子の親子関係に応じて刻々と変化**します。この「親が誰か」で子の名前空間が決まる、という点が後の攻撃で決定的になります。

#### mglyph と malignmark という特別な例外

ここが多くのDOMPurify mXSSの心臓部です。HTML仕様には次の特別ルールがあります。

> **`<mglyph>` と `<malignmark>` は、MathML text integration point（`<mtext>`など）の「直接の子」である場合に限り、HTMLではなくMathML名前空間の要素として扱われる。**

言い換えると、`<mtext>`の中は基本HTMLの島なのに、`<mglyph>`と`<malignmark>`という2つのタグだけは「島の中の飛び地」で、MathML名前空間に留まるのです。この例外があるおかげで、攻撃者は次のような細工ができます。

- **1回目のパース**では、`<mglyph>` が `<mtext>` の直接の子に「ならない」ように、間に別の要素（例: `<table>`）を挟んでおく。すると `<mglyph>` はHTML名前空間となり、その下の `<style>` もHTML名前空間の raw text 要素になり、DOMPurifyには無害に見える。
- ところが**DOMPurifyが間の要素を削除**したり、パーサの自動補正でその要素が消えたりすると、**2回目のパース**では `<mglyph>` が `<mtext>` の直接の子に「なってしまい」、MathML名前空間へ移る。すると配下の `<style>` は raw text でなくなり、中に隠しておいた `<img onerror>` が本物の要素として復活する。

これが「**名前空間混同（namespace confusion）**」の典型パターンです。要素が置かれる名前空間が、サニタイズ前後で食い違うことを指します。

#### なぜ名前空間が「混同」されるのか

根本原因は、**DOMPurifyが検査した木の形と、再パース後の木の形が、パーサの自動補正・ノード削除・所有権規則によってズレる**ことにあります。DOMPurifyは「今見えているノードの名前空間」を基準に安全性を判断しますが、その判断はノードの親子関係に依存し、親子関係はサニタイズによって変わり得ます。攻撃者は「サニタイズがこの木をこう変形させ、その結果この要素の名前空間がHTML→MathML（またはその逆）へ切り替わる」という一手先を読んで、変異を仕込むわけです。

---

### 背景となる先行研究: Michał Bentkowski の DOMPurify < 2.0.17 バイパス（2020年）

2本の担当資料はいずれも、Michał Bentkowski（securitum）の先行研究「Mutation XSS via namespace confusion – DOMPurify < 2.0.17 bypass」を土台にしています。理解の前提として、まずこれを簡潔に押さえます。

Bentkowskiは、次の形のペイロードでDOMPurify **2.0.17未満**をバイパスしました（DOMPurify公式回帰テストに「attribute-based mXSS behavior 1/3」として登録されている実物）。

```html
<svg><p><style><g title="</style><img src=x onerror=alert(1)>">
```

- **なぜ動くのか**: `<svg>`でSVG名前空間に入り、直後の `<p>`（SVGに存在しないHTML要素）によってパーサが名前空間の切り替え・要素の自動補正を行う。1回目のパースでは `<style>` の中身は解析されず、`<g>` の `title` 属性値が文字列 `</style><img src=x onerror=alert(1)>` として格納される。DOMPurifyは「titleという無害な属性を持つ`<g>`」しか見えないので通過させる。ところが**再シリアライズ→再パース**すると、属性値中の `</style>` が `<style>` を閉じ、`<img onerror>` が本物の要素として出現して発火する。属性値のシリアライズが `<` `>` `/` をエスケープしないという前述の性質が土台になっている。

Bentkowskiが提案し採用された対策は、「**要素が正しい名前空間に置かれているかを、親要素の名前空間と照合して検証する**」というもの（DOMPurifyの`_checkValidNamespace`に相当）。これは以後何年もの間、名前空間混同を防ぐ堅牢な土台となりました。ただし後述する2つの研究は、この防御の「隙間」を突いて再びバイパスに成功します。

> 出典: Mutation XSS via namespace confusion – DOMPurify < 2.0.17 bypass — https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/ （背景研究として参照。ペイロードはDOMPurify公式回帰テストフィクスチャで確認）

---

### Gareth Heyes「Bypassing DOMPurify again with mutation XSS」（DOMPurify < 2.1 / 2020年10月）

> ⚠️ **未取得の資料**: 「Bypassing DOMPurify again with mutation XSS（Gareth Heyes, PortSwigger Research）」は自動取得できませんでした（理由: 実行環境のネットワーク送信ポリシー〈egress proxy〉により portswigger.net へのアクセスがブロックされたため）。以下のURLからユーザーご自身で直接ご覧ください: https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss

（以下は取得できなかった資料の補足として、一般的な知識およびDOMPurify公式回帰テスト・二次情報源に基づく解説です。掲載ペイロードは公式テストフィクスチャと突合済みで正確です。）

#### 攻撃の着想: 「コメントを見落としたパッチ」

Bentkowskiのバイパス（前節）を受けてDOMPurifyは **2.0.17** で対策を入れました。この対策は、テキストノードの中に「名前空間の変異を引き起こしうる怪しいマークアップ」が潜んでいないかを検査するものでした。しかしHeyesは、**この検査が「HTMLコメント（`<!-- -->`）」や「CDATAセクション（`<![CDATA[ ]]>`）」の内側までは見ていなかった**ことに気づきます。foreign content（SVG/MathML）の内側では、コメントやCDATAはHTMLとは異なる特殊な扱いを受けるため、そこに変異の起爆装置を隠せば、DOMPurifyのテキスト走査をすり抜けられるというわけです。「同じDOMPurifyをもう一度（again）破る」という論文タイトルはこの再挑戦を指します。

#### Chromeで動くペイロードと逐次解説

Heyesが示したChrome向けの代表的ペイロード（DOMPurify公式回帰テストに「nesting-based mXSS behavior 3/5」として登録されている実物）は次のとおりです。

```html
<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">
```

- **なぜ動くのか（ステップで追う）**:
  1. `<math>` でMathML名前空間へ。`<mtext>` はMathML text integration point（HTMLの島）。
  2. その中に `<table>` を挟むことで、続く `<mglyph>` は `<mtext>` の**直接の子ではなくなる**。前述の特別ルールにより、直接の子でない `<mglyph>` はMathMLの飛び地にならず**HTML名前空間**にとどまる。よって配下の `<style>` もHTML名前空間の raw text 要素となり、中身（コメントや`<img>`）は**ただのテキスト**として扱われ、DOMPurifyには無害に見える。
  3. さらに危険な `<img src=1 onerror=alert(1)>` を **HTMLコメント越しに、しかも `title` 属性の値の中に、`&gt;`/`&lt;`（`>`/`<`のエンティティ）でエンコードして**隠しておく。DOMPurifyの「テキストノード検査」はコメントの内側を見ないため、この起爆装置を検出できない。
  4. **サニタイズによって `<table>` が処理・除去される**と、再パース時に `<mglyph>` が `<mtext>` の直接の子に昇格し、**MathML名前空間へ変異**する。すると `<style>` はもはや raw text 要素ではなくなり、`</style>` で閉じられた後の内容やコメントの解釈が変わる。属性値に隠されていた `--&gt;` がコメントを終端させ、`&lt;img src=1 onerror=alert(1)&gt;` がデコードされて本物の `<img>` 要素として出現、`onerror` が発火する。

要するに「`<table>`という詰め物で `<mglyph>` の名前空間をHTML側に固定してDOMPurifyを油断させ、サニタイズで詰め物が消えることで名前空間をMathML側へ変異させ、コメントの陰に隠した`<img>`を復活させる」という三段構えです。

同じ発想で、`<style>` 内から MathMLの `href=javascript:` を蘇らせる変種も知られています（公式テスト「nesting-based mXSS behavior 2/5」）。

```html
<math><mtext><table><mglyph><style><math href=javascript:alert(1)>CLICKME</math>
```

- **なぜ動くのか**: 上と同じ「`<table>`による名前空間の固定→サニタイズ後の変異」で `<style>` の中身が要素化し、MathMLの `<math href=javascript:...>`（クリックでスクリプトURIへ遷移）が本物の要素として現れる。

#### Firefoxで動くペイロード（CDATA版）

ブラウザによってforeign content内のコメント/CDATAの扱いが微妙に異なるため、HeyesはFirefox向けに **CDATAセクション** を使う変種も提示しています（原文由来。公式テストには前述のコメント版が採用されている）。

```html
<math><mtext><table><mglyph><style><![CDATA[</style><img title="]]&gt;&lt;/mglyph&gt;&lt;img src=1 onerror=alert(1)&gt;">
```

- **なぜ動くのか**: 骨格はChrome版と同一で、隠し場所がHTMLコメントから **CDATAセクション**（`<![CDATA[ ... ]]>`）に替わっているだけ。Firefoxのforeign content解析ではCDATAが有効な特殊構文として処理されるため、`]]&gt;`（`]]>`のエンコード）でCDATAを終端させると、続く `&lt;/mglyph&gt;` と `&lt;img ... onerror=alert(1)&gt;` がデコードされ、変異後の名前空間で本物の要素になる。「同じ原理でも、ブラウザごとに“検査の穴”になる構文が違う」ことを示す好例。

> なお、上記2つのペイロードで `&gt;`・`&lt;` を使うのは、DOMPurifyの1回目の検査時に「山括弧の生テキスト」として見えないようにするためです。エンティティは属性値の中では無害な文字列にすぎませんが、名前空間が変異して`<style>`が要素解析される段になると、パーサがデコードして本物の山括弧として扱う——このタイミングのズレこそが変異XSSの本質です。

#### 修正と教訓

Heyesが報告したこの一連のベクタは Cure53 によって **DOMPurify 2.1** で修正されました（2020年）。教訓は明快です。「テキストノードだけを検査しても、コメント・CDATAという“パーサ的な死角”に起爆装置を隠されると突破される」——サニタイザは、あらゆる文脈（コメント、CDATA、属性値、各名前空間）で一貫して安全でなければならない、ということです。

> 出典: Bypassing DOMPurify again with mutation XSS（Gareth Heyes, PortSwigger Research, 2020年10月7日公開） — https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss （原文は上記egress制限により未取得。ペイロード・修正バージョンはDOMPurify公式回帰テストおよび二次情報源で確認）

---

### Daniel Santos（vovohelo）「From SVG and back」（DOMPurify < 2.2.2 / 2020年11月）

> ⚠️ **未取得の資料**: 「From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass（Daniel Santos / vovohelo, Medium）」は自動取得できませんでした（理由: 実行環境のネットワーク送信ポリシー〈egress proxy〉により vovohelo.medium.com へのアクセスがブロックされたため）。以下のURLからユーザーご自身で直接ご覧ください: https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f

（以下は取得できなかった資料の補足として、一般的な知識およびDOMPurify公式回帰テスト・二次情報源に基づく解説です。掲載ペイロードは公式テストフィクスチャと突合済みで正確です。）

Heyesの修正（2.1）後、Daniel Santosは**新しい「変異の引き金」**を持ち込んで再びDOMPurifyを破りました。鍵は2つ——(1)**`<form>`所有権変異ガジェット**、(2)**SVG `<foreignObject>` / MathML `<annotation-xml>` を経由した名前空間の往復**です。

#### 変異の引き金その1: form所有権変異ガジェット（form ownership mutation gadget）

HTML仕様には「**フォームは入れ子にできない**（a `<form>` cannot contain another `<form>`）」という制約があります。パーサは `<form>` の中でさらに `<form>` に出会うと、**2つ目の `<form>` を無視（ドロップ）**します。この「2つ目のformが再パース時に消える」という挙動を、攻撃者は「ある要素の**親を強制的に付け替える（＝所有権を変える）ガジェット**」として利用します。

代表的ペイロード（公式テスト「nesting-based mXSS behavior 1/5」）:

```html
<form><math><mtext></form><form><mglyph><style><img src=x onerror=alert(1)>
```

- **なぜ動くのか**:
  1. 1回目のパースでは、途中の `</form>` と2つ目の `<form>` があることで、`<mglyph>` は `<mtext>` の**直接の子にならない**構造として組まれる。よって `<mglyph>` はHTML名前空間、`<style>` も raw text で、`<img onerror>` はただのテキスト。DOMPurifyは無害と判断して通す。
  2. しかし再パース時、**入れ子のformが許されず2つ目の`<form>`が消える**ことで木の親子関係が変わり、`<mglyph>` が `<mtext>` の直接の子に昇格。前述の特別ルールで**MathML名前空間へ変異**し、`<style>` の中身が要素化して `<img onerror=alert(1)>` が発火する。

「詰め物として何を使えば名前空間を変異させられるか」の答えが、Heyesの `<table>` から Santosの `<form>`（入れ子禁止という別の仕様）に替わった、と捉えると連続性が見えます。

#### 変異の引き金その2: 「SVGへ、そしてSVGから戻る」——foreignObject と annotation-xml

論文タイトルの "From SVG and back"（SVGへ行って、また戻ってくる）は、**名前空間をSVG→HTML→SVGと往復させて食い違いを作る**手口を指します。核となるのはHTML integration point（`<foreignObject>` や `encoding="text/html"` の `<annotation-xml>`）です。これらは「外部名前空間の中に開いたHTMLの窓」でしたが、**サニタイズによってこの窓（integration point要素）自体が取り除かれる**と、その内側にあった要素の名前空間がHTML→外部（SVG/MathML）へ逆戻りし、`<style>`が raw text から要素解析へ切り替わってしまいます。

代表的ペイロード（公式テスト「attribute-based mXSS behavior 2/3」および「3/3」）:

```html
<svg><foreignobject><p><style><p title="</style><iframe onload=alert(1)<!--"></style>
```

```html
<math><annotation-xml encoding="text/html"><p><style><p title="</style><iframe onload=alert(1)<!--"></style>
```

- **なぜ動くのか**:
  1. `<svg>`（または`<math>`）で外部名前空間に入り、`<foreignobject>`（または `<annotation-xml encoding="text/html">`）で**HTMLの窓**を開く。1回目のパースでは `<style>` はこの窓の中＝HTML名前空間の raw text 要素として扱われ、危険な `<iframe onload=alert(1)>` は `<p>` の `title` 属性値の中の文字列に過ぎず、DOMPurifyには無害に見える（`title="</style><iframe onload=alert(1)<!--"`）。
  2. ところがDOMPurifyは、この文脈での `<foreignobject>`/`<annotation-xml>` を安全でないと見なして**除去**する。窓が閉じられると、内側の `<style>` の名前空間がHTMLから**SVG/MathMLへ戻る（back）**。SVG/MathMLでは `<style>` は raw text 要素ではないため中身が解析対象になり、属性値のシリアライズで露出した `</style>` が style を閉じ、続く `<iframe onload=alert(1)>` が本物の要素として出現して発火する。末尾の `<!--` は、余分な後続マークアップをコメント化して構文を安定させるための整形。

「SVG（外部）→ foreignObjectでHTMLへ → サニタイズでforeignObjectが消えてSVGへ戻る」——この名前空間の往復こそが "From SVG and back" の意味であり、Bentkowskiが入れた「親の名前空間と照合する検証」が、**親（integration point要素）そのものが後で消えるケース**を想定していなかった、という盲点を突いています。

なお、`<form>`ガジェットとSVG往復を組み合わせた、より込み入った変種も公式テストに登録されています（「nesting-based mXSS behavior 4/5・5/5」）。

```html
<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">
```

- **なぜ動くのか**: form所有権ガジェットで `<mglyph>` の名前空間を変異させたうえ、さらに `<svg><mtext>` を挟んでSVG/MathML間を渡り歩き、`<path>` の `id` 属性値に隠した `</style><img onerror=alert(1)>` を再パース時に露出させる。複数のガジェットを重ねることで、単純な対策の網の目をさらにくぐり抜けている。

#### 修正と公開の時系列

Santosはこの脆弱性を **2020年11月2日**にCure53へ報告し、**同日中に DOMPurify 2.2.2** として修正版が公開されました（報告から修正まで極めて短時間だった点も、この研究の逸話として知られます）。修正では、名前空間検証の抜け穴（integration point要素の除去や所有権変異によって子の名前空間が事後的に変わるケース）を塞ぐよう、名前空間・親子関係のチェックが強化されています。

> 出典: From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass（Daniel Santos / vovohelo, 2020年11月2日） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f （原文は上記egress制限により未取得。ペイロード・修正バージョン・時系列はDOMPurify公式回帰テストおよび二次情報源で確認）

---

### 実務者のためのまとめ: 攻撃の共通構造・防御・最新状況

#### 全バイパスに共通する「型」

ここまでの3研究（Bentkowski / Heyes / Santos）は、細部は違えど**同じ骨格**を共有しています。攻撃者の思考モデルとして一般化すると次の4手順です。

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

本セクションのペイロードは、いずれも**特定バージョンでのみ有効な歴史的PoC**です（Bentkowski: DOMPurify < 2.0.17、Heyes: < 2.1、Santos: < 2.2.2。すべて2020年の事象）。現行のDOMPurifyでは通用しません。学ぶべきは個々の文字列そのものではなく、**「サニタイザが見た木」と「ブラウザが作る木」の不整合を、名前空間・integration point・所有権規則という仕様の隙間を使って作り出す**という**発想と原理**です。この原理を理解していれば、将来公開される新しいmXSS（別のガジェット、別のブラウザ差分）にも応用的に対処できます。

> 出典（横断的な確認に使用した二次情報源・一次ソース）:
> - DOMPurify 公式回帰テストフィクスチャ（全ペイロードの正確性を突合） — https://github.com/cure53/DOMPurify （`test/fixtures/expect.mjs`）
> - Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
> - Mutation XSS via namespace confusion – DOMPurify < 2.0.17 bypass（Michał Bentkowski, securitum） — https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/
