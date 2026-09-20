## mXSSの原典（Cure53論文 fp170）

反射型・格納型・DOMベースといった「素朴なXSS」を一通り理解した学習者が、次に足を踏み入れるべき最も重要な領域のひとつが **mXSS（mutation-based XSS、変異型XSS）** です。mXSSは「サニタイザ（入力に含まれる危険な文字列を無害な形に変換・除去する処理）がいったん安全だと判断して通したはずのHTMLが、ブラウザに渡った瞬間に**別の、危険なHTMLへと化ける（=変異する）**」という、直感に反する現象を突く攻撃クラスです。フィルタもWAF（Web Application Firewall、HTTPを検査してXSS等を遮断する防御機構）もサニタイザも、みな「自分が見た文字列が、そのまま実行される文字列だ」と暗黙に信じています。mXSSはその**信頼そのもの**を破壊します。

この攻撃クラスを世界で初めて体系的に定義・命名し、理論的基礎を与えたのが、本節の主資料である **Mario Heiderich（マリオ・ハイデリッヒ）ら Cure53 の論文 "mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations"（通称 fp170）** です。この論文は、それまで単発の「面白いブラウザのバグ」としてしか見られていなかった一連の現象を、「サニタイザのパイプラインに構造的に存在する欠陥」として統一的に説明し、以後10年以上にわたって続くDOMPurifyバイパスの攻防（後述）の起点となりました。本節ではこの原典を精読し、その論理・分類・具体的ペイロード・防御策を、原文を読まなくても完全に理解できるレベルまで分解します。

---

### 書誌情報 — この論文は何者か

- **正式タイトル**: *mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations*
- **著者**: Mario Heiderich、Jörg Schwenk、Tilman Frosch（以上ルール大学ボーフム）、Jonas Magazinius（チャルマース工科大学、スウェーデン）、Edward Z. Yang（スタンフォード大学、米国）
- **発表**: 2013年11月4〜8日、**ACM CCS 2013**（ACM Conference on Computer and Communications Security）、ベルリン（ドイツ）。トップティアのセキュリティ国際会議の査読付き論文です。
- **DOI**: http://dx.doi.org/10.1145/2508859.2516723
- **Cure53の整理番号**: `fp170`（Cure53が公開資料に振る "fingerprint" 番号。URLの `fp170.pdf` はこれに由来）
- **姉妹プレゼン**: 同じ内容を筆頭著者Heiderichが講演した "The innerHTML Apocalypse"（OWASP AppSec Research EU 2013 / Hack in Paris 2013）が存在し、スライドはHeiderich（@x00mario）名義で公開されています。

この論文の歴史的意義は二つあります。第一に、**"mutation-based XSS (mXSS)" という用語と攻撃クラスを初めて定義した**こと。第二に、著者らがこの論文の問題意識から実際の防御ライブラリ **DOMPurify** を生み出し（Cure53製）、それが今日のクライアント側HTMLサニタイズの事実上の標準になったことです。つまりfp170は「攻撃の原典」であると同時に「現代の主要な防御の出発点」でもあります。

> 出典: mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations（原典より） — http://dx.doi.org/10.1145/2508859.2516723

---

### mXSSとは何か — 定義

論文のAbstractは次のように述べています。

> 2007年、長谷川陽介（Hasegawa）が単一のブラウザ実装におけるバッククォート文字の誤処理に基づく新しいXSSベクタを発見した。これは当初、容易に修正できる実装エラーのように見えた。しかし、本論文が示すように、これは**mutation-based XSS (mXSS) ベクタという新しいクラスの最初の例**であり、innerHTMLおよび関連プロパティで発生しうるものであった。mXSSはIE・Firefox・Chromeの**3大ブラウザファミリすべて**に影響する。

この定義を噛み砕くと、mXSS（変異型XSS）とは次のような攻撃です。

> **攻撃者は、サニタイザ・フィルタ・WAFといった防御機構に「安全である」と判定される無害なHTML文字列を用意する。ところがその文字列が、ブラウザによってDOM（Document Object Model、HTMLをブラウザがツリー構造のオブジェクトとして表現したもの）へ取り込まれ、あるいは `innerHTML` を通じて読み書きされる過程で、ブラウザ自身の手によって別のHTML構造へと「変異（mutation）」させられ、その変異後の構造がスクリプトを実行する。**

ポイントは、**攻撃者が注入した文字列そのものにはスクリプト実行の要素が（防御機構から見える形では）含まれていない**という点です。危険なコードは、ブラウザのパーサ（HTMLを解釈してDOMツリーを組み立てる部品）とシリアライザ（DOMツリーをHTML文字列に戻す部品）の**挙動の中から自然発生的に生まれます**。防御機構は「実行されるコード」を一度も見ないまま通してしまう——これがmXSSの本質であり、従来のXSS対策（危険なタグや属性を探して除去する）がまるごと無力化される理由です。

論文の副題にある通り、mXSSが恐ろしいのは「よく守られたアプリ（well-secured web-applications）」をこそ破る点です。素朴なアプリは単純なXSSで落ちますが、mXSSはHTML Purifierのような高品質なサニタイザを**正しく使っていてもなお**成立しました。

> 出典: mXSS Attacks（原典 Abstract より）

---

### 根本原理 — パースの非対称性と「べき等でないサニタイズ」

mXSSを仕組みのレベルで理解する鍵は、**サニタイズ処理のパイプライン**と、そこに潜む**パースの非対称性（parse/serialize asymmetry）**です。ここがこの節で最も重要な部分です。

#### サニタイズ・パイプラインの5段階

サーバ側であれクライアント側であれ、HTMLサニタイザは概念的に次のステップを踏みます。

1. **パース（解析）**: 入力HTML文字列 `D` を、パーサでDOMツリーへ変換する。
2. **サニタイズ**: DOMツリーを走査し、危険な要素（`<script>` など）・属性（`onerror` など）・URL（`javascript:` など）を削除する。
3. **シリアライズ**: サニタイズ済みのDOMツリーを、再びHTML文字列へ書き戻す。
4. **再パース（挿入）**: その文字列が最終的にブラウザに渡り、`element.innerHTML = ...` のような形で**もう一度パースされて**実DOMに挿入される。
5. **描画**: 実DOMがレンダリングされる。

問題は、**ステップ1のパーサとステップ4のパーサ（＝実ブラウザのパーサ）が、同じ文字列を同じDOMに解釈するとは限らない**こと、そして**ステップ3のシリアライザが、ステップ1で読んだのと同じ文字列を出力するとは限らない**ことです。

#### `P(P(D)) ≠ P(D)`：非べき等性がすべての元凶

これを一つの式で表すと、mXSSの本質は **パース処理 `P` が「べき等（idempotent）でない」** ことに帰着します。べき等とは「同じ処理を2回かけても1回と結果が変わらない」性質のことです（例: 絶対値をとる操作はべき等）。理想的なサニタイザは、一度サニタイズした出力をもう一度パースしても構造が変わらない、すなわち

```
P(P(D)) = P(D)     ← 安全（べき等）
```

であってほしい。ところが現実のブラウザでは、

```
P(P(D)) ≠ P(D)     ← 危険（非べき等）＝ mXSS の温床
```

となる場合が存在します。1回目のパース＆シリアライズで得た「安全に見える文字列」を、ブラウザが2回目にパースすると、**別の（実行可能な）DOMツリー**が生まれてしまう。この「1回目と2回目のズレ」こそが変異（mutation）であり、攻撃者はこのズレの中に悪意あるコードを"畳み込んで"おくのです。

#### innerHTML変異のトリガー条件

論文のSection 2.1は、変異が発生する具体的なトリガーを4つ挙げています。

1. **`innerHTML` または `outerHTML` プロパティへのアクセス**（読み取り・書き込み）
2. **コピー（およびその後のペースト）操作**によるHTMLデータの受け渡し
3. **HTMLエディタへのアクセス** — `contenteditable`、`designMode`、`document.execCommand()` を介した操作
4. **印刷プレビュー**やそれに類する中間的なレンダリング処理

特に驚くべきは、変異を引き起こす最小限のコードが論文のListing 3に示されている次のたった1行であることです。

```javascript
window.onload = function() {
    document.body.innerHTML += '';
}
```

空文字列を `innerHTML` に追加するだけ——つまり「何も変えていない」にもかかわらず、ブラウザの内部では `innerHTML` の**読み取り**（シリアライズ）と**書き戻し**（再パース）が発生し、その往復で変異が起きます。

#### なぜ「サーバ側サニタイザ」が特に脆弱なのか

論文が突いた核心は次の一文に集約されます。「**サーバ側フィルタとクライアント側（ブラウザ）は、HTMLの解釈について同一の理解を共有していると暗黙に仮定しているが、それは誤りである**」。

サーバ側サニタイザ（PHPのHTML Purifier、WordPressのkses、htmlLawed など）は、独自のHTMLパーサやDOMライブラリ（あるいはXMLパーサ）で入力を解釈します。しかし最終的にその出力を解釈するのは**ユーザーのブラウザ**であり、両者のパーサは仕様の細部・エラー回復・独自拡張が食い違います。特に致命的なのが次の二つです。

- **`innerHTML` のラウンドトリップ**: JavaScriptで `el.innerHTML` を**読む**と、ブラウザはその要素の子DOMを**シリアライズして文字列を返します**。そしてその文字列を別の要素に `otherEl.innerHTML = str` で**書き戻す**と、再パースされます。この「read→write」の往復（round-trip）で、ブラウザ独自のシリアライズ規則が発動し、元と違う文字列・DOMになります。多くのクライアント側サニタイザ（当時のjQueryプラグイン等）や、DOMを触るWYSIWYGエディタが、この往復を内部で行っていました。
- **RAWTEXT/RCDATA要素のコンテキスト差**: `<style>`, `<xmp>`, `<textarea>`, `<title>`, `<noscript>`, `<iframe>`, `<noembed>`, `<noframes>` などの要素は、その**中身の解釈ルールが特殊**です（後述）。サーバ側パーサとブラウザで、この中身が「ただのテキスト」なのか「生きたHTML」なのかの判定が食い違うと、そこがそっくり実行コードに化けます。

> 出典: mXSS Attacks（原典 Section 2.1 より）

---

### 論文が分類した7つのmXSSサブクラスと具体的ペイロード

論文は、当時知られていた／新たに発見したmXSSベクタを**7つのサブクラス**に整理しました（Table 1）。以下、各サブクラスを、論文のセクション番号・ペイロード・ブラウザ出力とともに、**なぜ動くのか**の原理を添えて解説します。

#### サブクラス1（Section 3.1）: バッククォート文字が属性区切り構文を破壊する

mXSSという概念の**歴史的な出発点**であり、論文が「最初のmXSS」として引用する事例です。2007年に長谷川陽介（Hasegawa）氏が発見した、IEのバッククォート（`` ` ``）処理のバグに由来します。

**ペイロード（原典より）**:
```html
<img src="test.jpg" alt="``onload=xss()" />
```

**ブラウザ出力（原典より）**:
```html
<IMG alt=``onload=xss() src="test.jpg">
```

**なぜ動くのか**: 攻撃者はまず、`alt` 属性の値として `` ``onload=xss() `` という、ダブルクォートで正しく囲まれた**無害な文字列**を仕込みます。サニタイザから見ると `alt` はただのテキスト属性で、危険な要素はどこにもないので通過します。ところがIE（旧バージョン）は、**バッククォートを属性値の正当な区切り文字（クォート）として扱う**という非標準の癖を持っていました。このため、この要素の `innerHTML` を読み出すと、IEのシリアライザはダブルクォートを使わずバッククォートを区切りに使った形で出力します。この文字列を**再パース**すると、IEは先頭の `` `` `` を「空のバッククォート区切りの値」と解釈し、続く `onload=xss()` を**独立した新しい属性**として認識してしまいます。結果、当初はただの `alt` テキストだったものが、`onload` イベントハンドラに変異し、画像読み込み時に `xss()` が実行されます。

**バージョン依存性の注意**: このバッククォート変異は主に **IE8以前（およびそれらの互換モード）** に固有の挙動です。現代のChrome/Firefox/Edge（Chromium版）では再現しません。歴史的重要性は極めて高いものの、実戦で狙う場面は現在ほぼありません。

#### サブクラス2（Section 3.2）: 未知要素中のXML名前空間が構造変異を引き起こす

**ペイロード（原典より）**:
```html
<article xmlns="urn:img src=x onerror=xss()//">123
```

**ブラウザ出力（原典より）**:
```html
<img src=x onerror=xss()//:article xmlns="urn:img src=x onerror=xss()//">123</img src=x onerror=xss()//:article>
```

**なぜ動くのか**: `<article>` はHTML5の標準要素ですが、`xmlns` 属性にXMLの名前空間URIを指定すると、一部のブラウザのシリアライザがこれをXML風の要素として再構成します。その際、名前空間URIの文字列 `urn:img src=x onerror=xss()//` がタグ名の接頭辞として展開され、`<img src=x onerror=xss()//: ...>` という新たなタグ構造に化けます。再パース時にブラウザはこの文字列中の `<img src=x onerror=xss()` 部分を生きた `<img>` 要素として認識し、`onerror` ハンドラが実行されます。名前空間URIがタグ名に「展開」されるという、XMLとHTMLの境界の歪みを突いた変異です。

#### サブクラス3（Section 3.3）: CSSエスケープ中のバックスラッシュが文字列境界を侵犯する

`style` 属性（インラインCSS）を許可しているサニタイザを破る、論文の目玉の一つです。CSSには、任意の文字をバックスラッシュ＋16進コードで表す**CSSエスケープ**（例: `\27` は `'`、`\3b` は `;`）という記法があります。

**ペイロード（原典より）**:
```html
<p style="font-family:'ar\27\3bx\3aexpression\28xss\28\29\29\3bial'">
```

**ブラウザ出力（原典より）**:
```html
<P style="FONT-FAMILY:'ar';x:expression(xss());ial'">
```

**なぜ動くのか**: サニタイザがこの `style` を検査する時点では、値は `font-family:'ar\27\3bx\3aexpression\28xss\28\29\29\3bial'` という**単一の `font-family` プロパティの文字列リテラル**にしか見えません。`\27`（`'`）も `\3b`（`;`）もまだエスケープされたままなので、プロパティの区切りにはならず、危険な `expression()`（IEのCSS拡張で、CSSの値としてJavaScriptを評価・実行してしまう悪名高い機能）も文字列の中に閉じ込められた無害なテキストとして扱われ、フィルタを通過します。ところがIEの `innerHTML` シリアライザは、この `style` を書き戻す際に**CSSエスケープをデコードして生の文字に戻して**しまいます。すると `\27` が `'` に戻り文字列リテラルが `'ar'` で閉じられ、`\3b` が `;` に戻りプロパティが区切られ、`\3a` が `:` に、`\28`/`\29` が `(`/`)` に戻って `x:expression(xss())` という**新しいCSS宣言**が出現します。

特筆すべきは、論文がこのサブクラスについて**再帰的変異（recursive mutation）**を指摘していることです。二重エスケープされた文字（例えば `\\27` のような形）は、1回目の `innerHTML` アクセスで1段デコードされ、2回目のアクセスでさらにもう1段デコードされます。つまり `innerHTML` を複数回往復させるだけで、段階的に変異が進行する場合があります。

**バージョン依存性の注意**: `expression()` は **IEのみ**の機能で、IE8以前で有効、IE9以降の標準モードでは無効化、IE11でほぼ撤廃されました。ただし「CSSエスケープが `innerHTML` 往復でデコードされてプロパティ境界が崩れる」という**変異の原理そのもの**は普遍的です。

#### サブクラス4（Section 3.4）: エンティティ表現中の不適合文字がCSS文字列を破壊する

**ペイロード（原典より）**:
```html
<p style="font-family:'ar&quot;;x=expression(xss())/*ial'">
```

**ブラウザ出力（原典より）**:
```html
<P style="FONT-FAMILY:'ar';x=expression(xss())/*ial'">
```

**なぜ動くのか**: サブクラス3と原理は近いですが、こちらはバックスラッシュのCSSエスケープではなく、**HTMLエンティティ**（`&quot;`、`&#x22;`、`&#34;`、あるいはCSSの `\22`）を利用します。サニタイザが `style` 属性値を検査する時点では、`&quot;` はHTMLエンティティのままなので、CSS文字列の内部にある無害なテキストに見えます。ところが `innerHTML` アクセス時にブラウザがこれらのエンティティをすべて生の `"` に変換してしまい、CSS文字列リテラルの境界が崩壊して `expression(xss())` が新たなCSS宣言として復活します。論文は、`\22`、`&quot;`、`&#x22;`、`&#34;` のいずれの表記でもinnerHTMLアクセス時に `"` へ変換されることを確認しています。

#### サブクラス5（Section 3.5）: CSSプロパティ名中のCSSエスケープがHTML構造全体を侵犯する

このサブクラスでは、CSSの**プロパティ名**（値ではなく）にCSSエスケープを埋め込み、`innerHTML` のシリアライズ時にそれがデコードされることで、CSSの境界を越えてHTML構造そのものが破壊されます。たとえば、CSSプロパティ名に `</style>` 相当のエスケープシーケンスを仕込み、デコード後に `<style>` 要素が早期に閉じられて後続の文字列がHTML要素として脱出する——という、CSSとHTMLの境界を横断する変異です。

#### サブクラス6（Section 3.6）: 非HTMLドキュメントにおけるエンティティ変異

XHTML（`application/xhtml+xml`）やXMLなど、HTML以外のドキュメント型において、エンティティの解釈規則がHTMLと異なることを利用した変異です。XMLではHTMLとは異なるエンティティの集合が定義され、未定義エンティティの扱いも異なります。サニタイザがHTML用の規則でエンティティを処理した結果が、XML/XHTMLパーサで異なるデコードを受けて変異を引き起こします。

#### サブクラス7（Section 3.7）: HTMLドキュメントの非HTMLコンテキストにおけるエンティティ変異

HTMLドキュメントの中にあるが**HTMLとして解釈されないコンテキスト**——具体的には `<style>`, `<xmp>`, `<listing>`, `<title>`, `<textarea>`, `<noscript>`, `<noembed>`, `<noframes>`, `<iframe>` 等のRAWTEXT/RCDATA要素の内部——でのエンティティ変異です。

- **RAWTEXT要素**（`<style>`, `<xmp>`, `<noembed>` 等）: 中身はタグもエンティティも解釈されない「生テキスト」。閉じタグ（例 `</style>`）が来るまで、`<` すら普通の文字として扱われる。
- **RCDATA要素**（`<title>`, `<textarea>`）: 中身のタグは解釈されないが、**HTMLエンティティ（`&lt;` など）はデコードされる**。

mXSSは、この「中身がテキスト扱いか、生きたHTML扱いか」の判定が、サニタイザ側とブラウザ側（あるいは名前空間の違いで）食い違う点、およびエンティティのデコード有無が往復でズレる点を突きます。論文が挙げる典型は「あるコンテキストではエンティティ化されて無害だった文字列が、別コンテキストへ移された瞬間に生のHTMLとして復活する」というものです。このサブクラスは後年の名前空間混同mXSS（SVG/MathML内の `<style>` を利用するもの）の直接の源流となりました。

> 出典: mXSS Attacks（原典 Table 1 および Section 3.1〜3.7 より）

---

### 論文の実証 — 何を、どれだけ破ったのか

fp170が学術論文として説得力を持ったのは、これらのベクタが**現実の一流アプリと一流の防御を実際に破った**ことを示した点にあります。

#### 破られた実アプリ（格納型mXSSを実証）

著者らは、以下の**高知名度アプリケーションに格納型（stored）mXSSベクタを実際に設置**できたと報告しています。多くはHTMLメール本文を扱うWebメールで、送られたHTMLメールが受信者のブラウザで整形される過程を突きます。

- Yahoo! Mail
- Rediff Mail
- OpenExchange（Open-Xchange）
- Zimbra
- Roundcube
- その他複数の商用製品

#### 破られた防御機構

さらに衝撃的なのは、当時「これを使っておけば安全」とされていた**あらゆる層の防御を横断的にバイパス**したことです。**テスト時点で、対象となったサニタイザはすべて脆弱であった**と論文は報告しています。

**サーバ側XSSサニタイザ**:
- HTML Purifier
- kses（WordPress）
- htmlLawed
- Blueprint
- Google Caja（サーバ側）
- OWASP AntiSamy
- jSoup

**クライアント側フィルタ**:
- XSS Auditor（Chrome）
- IE XSS Filter

**ネットワーク層**:
- WAF（Web Application Firewall）各種
- IDS/IPS（侵入検知／防止システム）

#### 影響範囲

mXSSは特定ブラウザの奇癖にとどまらず、**IE・Firefox・Chromeの3大ブラウザファミリすべて**に影響することも示されました。つまり、これは「直せば済むバグ」ではなく、HTMLの解析・シリアライズという**Webの基盤設計に構造的に埋め込まれた欠陥**だ、という強いメッセージになりました。

> 出典: mXSS Attacks（原典 Abstract および評価セクションより）

---

### 論文が提案した防御策

論文は攻撃を示すだけでなく、具体的な防御の方向性を提示しました。

#### サーバ側の防御（Section 5.1）

論文は、サーバ側サニタイザに対して以下の対策を提案しました。

1. **ブラウザが誤処理する特殊文字の禁止**: サーバ側でサニタイズする際、ブラウザのシリアライザが変異を引き起こすことが分かっている文字を、たとえエスケープ済みでも禁止する。
2. **属性値への末尾空白の追加**: 属性値の末尾にホワイトスペースを強制的に挿入することで、ブラウザのシリアライザがクォートを省略する余地を排除する（バッククォート変異への対処）。
3. **CSS特殊文字の完全排除**: CSSプロパティの値においては、エスケープ済みの形でも危険文字を許容してはならない（CSSエスケープ変異への対処）。

著者らはこれらの修正を**HTML Purifier**に実際に実装しました。

#### クライアント側の防御（Section 5.2）— TrueHTML

論文の最も重要な防御提案が、クライアント側で動作する **TrueHTML** プロトタイプです。

- **仕組み**: `innerHTML` のgetterを**インターセプタ（傍受関数）で上書き**し、ブラウザ独自のHTMLシリアライズの代わりに `XMLSerializer.serializeToString()` を使用して変異のないシリアライズ結果を返す。
- **サイズ**: わずか **820バイト**。
- **利点**: 変異のない出力、低パフォーマンス影響、透過的（既存のコードを変更不要）、Webサイト非依存。

#### TrueHTMLの評価データ（Section 6）

著者らはAlexa上位10,000サイトを調査し、約**1/3が `innerHTML` を使用**、約**65%がjQueryを使用**していることを確認しました。これらのサイトに対するTrueHTMLのパフォーマンスオーバーヘッドは以下の通りです。

- **中央値（median）**: 25.73%
- **90パーセンタイル**: 68.37%

評価対象にはDuckDuckGo、メール本文表示、Baidu、Facebook、Google、YouTube、Twitter、Yahoo、Google Mapsが含まれています。

この問題意識の直接の産物が、Cure53が後に開発した **DOMPurify** です。DOMPurifyは「DOM上でサニタイズし、サニタイズ後に**もう一度シリアライズ→再パースして結果を再検査する**」というアプローチで、`P(P(D)) ≠ P(D)` の非べき等性そのものに対処しようとします。fp170は攻撃の原典であると同時に、この現代的防御の思想的な出発点でもあるのです。

> 出典: mXSS Attacks（原典 Section 5 および Section 6 より）

---

### 原典のその後 — 名前空間混同mXSSの系譜（発展的補足）

（以下はfp170原典そのものではなく、その予言がどう的中したかを追う発展的補足です。中〜上級読者が実戦で出会うのはむしろこちらなので、バージョンと年を明記して整理します。）

fp170が「名前空間の混同は続く」と警告した通り、mXSSは**DOMPurifyバイパスの歴史**として現在まで生き続けています。原理はすべてfp170の `P(P(D)) ≠ P(D)` に帰着します。以下、主要な事件を時系列で示します。**いずれも「対象バージョン」「発見年」「修正状況」を明記します**（バージョン依存の攻撃は陳腐化するため、常にこの3点セットで捉えてください）。

#### 2018年 — Gareth Heyes、EdgeのタイトルエンティティによるDOMPurifyバイパス

```html
<title>&lt/title&gt&ltimg&sol;src=&quot&quotonerror&equals;alert(1)&gt
```

**なぜ動くのか**: RCDATA要素 `<title>` の中身のエンティティを、当時のEdge（旧EdgeHTML）が特殊にデコードし、`&lt/title&gt` が `</title>` に化けて早期に閉じ、後続の `<img ... onerror=alert(1)>` が生きた要素として復活します。エンティティ・デコードの食い違い（サブクラス7）の一種です。
- **修正**: DOMPurifyが該当バージョンで対応済み。EdgeHTML自体もその後Chromiumベースへ移行し消滅。

> 出典: MXSS Evolution and Timeline（Gareth "Edge" mXSS 2018、msrkp/MXSS） — https://github.com/msrkp/MXSS

#### 2019年 — SecurityMB、SVGの `</p>` 早期クローズによる変異

```html
<svg></p><style><g title="</style><img src onerror=alert(1)>">
```

**なぜ動くのか**: `<svg></p>` はブラウザによって `<svg><p></p></svg>` に補完され（`</p>` が孤立クローズなので空の `<p>` が生成される）、`<p>` がSVG内に一瞬存在します。この構造の食い違いにより、後段の `<style>`（SVG内）のRAWTEXT境界がズレ、`</style>` で閉じた後の `<img>` が実行コンテキストへ脱出します。
- **修正**: DOMPurifyが対応。

> 出典: MXSS Evolution and Timeline（SecurityMB "SVG </p>" mXSS 2019、msrkp/MXSS） — https://github.com/msrkp/MXSS

#### 2020年 — SecurityMB（Michal Bentkowski）、MathML名前空間切り替えによる **DOMPurify < 2.0.17** バイパス

これは**バージョン依存mXSSの代表例**として必ず押さえるべき事件です。

```html
<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
```

**なぜ動くのか**: 二つの高度なパーサ挙動を組み合わせます。
1. **フォームのネスト禁止**: HTMLパーサは `<form>` の入れ子を許しません。1回目の解析では内側の `<form>` が（一時的に）存在し得る構造になりますが、2回目の解析（再パース）では**内側の `<form>` が削除**され、DOMツリーの親子関係が変化します。
2. **MathMLテキスト統合点（text integration point）の名前空間規則**: `<mtext>` はMathMLの「テキスト統合点」で、その**直接の子はデフォルトでHTML名前空間**として扱われます。ただし例外が二つあり、`<mglyph>` と `<malignmark>` だけは（直接の子である場合に限り）MathML名前空間に留まります。

1回目の解析（サニタイザが見る木）では `<style>` の子孫がHTML名前空間にあり、その中の `<img>` は無害なRAWTEXTの一部に見えます。ところがフォーム削除によって親子関係が変わり、`<mglyph>` が `<mtext>` の直接の子になると、**その子孫（`<style>` とその中身）がMathML名前空間に切り替わり**、`<style>` の中身がもはやRAWTEXTではなくなって、隠れていた `<img src onerror=alert(1)>` がHTML要素として解釈・実行されます。「最終DOMではMathML名前空間、サニタイズ時DOMではHTML名前空間」という食い違い、まさにfp170の名前空間混同（サブクラス2/7）の現代版です。
- **対象**: DOMPurify **2.0.17 未満**
- **発見年**: 2020年、発見者 Michal Bentkowski（@SecurityMB、Securitum）
- **修正**: **DOMPurify 2.0.17** で修正。Bentkowski自身が提案した「**全要素について親の名前空間と照合して検証する**」防御（PR #495）が導入され、これが以後数年間の名前空間混同に対する決定打となりました。

> 出典: Mutation XSS via namespace confusion — DOMPurify < 2.0.17 bypass（Securitum research、Michal Bentkowski、2020） — https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/
> 出典: Harden protection against mutation XSS caused by namespace switching（cure53/DOMPurify PR #495） — https://github.com/cure53/DOMPurify/pull/495

#### 2020年 — Daniel Santos、SVGへ「往復」する名前空間混同による **DOMPurify < 2.2.2** バイパス

```html
<form><math><mtext></form><form><mglyph><svg><mtext><style><x id="&lt;/style><img onerror=alert(1) src>">
```

**なぜ動くのか**: 上記2.0.17バイパスの発展形で、`<svg>` を混同経路に組み込み、「HTML→MathML→SVG→HTML」と名前空間を渡り歩かせます。2番目の `<mtext>` によって、1回目の解析ではペイロードがHTML名前空間に留まり無害に見えますが、フォーム削除後の再パースで `<style>` の子孫の名前空間が切り替わり、`&lt;/style>` がデコード・再解釈されて `<img onerror=alert(1)>` が脱出・実行されます。SVGの `id` 属性を自由記述の「安全な入れ物」として悪用する点が新しい工夫です。
- **対象**: DOMPurify **2.2.2 未満**
- **発見年**: 2020年11月、発見者 Daniel Santos（@bananabr）
- **修正**: **DOMPurify 2.2.2** で修正（Bentkowski提案の親名前空間検証をさらに強化）。

> 出典: From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass（Daniel Santos、2020年11月） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f

#### 参考: テーブルのフォスター親（foster parenting）を絡めたコメント変異（Gareth Heyes ほか）

```html
<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">
```

**なぜ動くのか**: HTMLパーサには「**フォスター親（foster parenting）**」という規則があり、`<table>` の中に置けない要素（`<mglyph>` など）は、テーブルの**外へ自動的に移動**させられます。1回目の解析では `<mglyph>` がテーブル外へ運ばれる一方、2回目の解析ではMathML名前空間内で再解釈され、**HTML名前空間では無視されるはずの `<style>` 内のコメント `<!-- -->` が、MathMLでは無視されなくなる**ため、コメントの中に隠していた `<img ... onerror=alert(1)>` が復活・実行されます。名前空間による「コメントの扱いの違い」を突く、非常に巧妙な変異です。

> 出典: MXSS Evolution and Timeline（foster parenting とコメント操作トリック、msrkp/MXSS） — https://github.com/msrkp/MXSS

#### 2024年 — Kevin Mizu、非デフォルト設定下での **DOMPurify 3.0.8** バイパス

```javascript
DOMPurify.sanitize(`<svg><annotation-xml><foreignobject><style><!--</style><p id="--><img src='x' onerror='alert(1)'>">`, {
    CUSTOM_ELEMENT_HANDLING: { tagNameCheck: /.*/ },
    FORBID_CONTENTS: [""]
});
```

**なぜ動くのか**: これは**設定依存**のバイパスです。`CUSTOM_ELEMENT_HANDLING.tagNameCheck: /.*/`（任意のカスタム要素を許可）と `FORBID_CONTENTS: [""]`（内容削除の無効化）という、安全でない設定を組み合わせると、`<annotation-xml>` や `<foreignobject>` が生き残り、DOMPurifyが後段でこれらを削除する際に `<style>` が再配置されてHTML名前空間へ復帰し、コメントに隠した `<img onerror=alert(1)>` が実行されます。**デフォルト設定のDOMPurifyは安全**で、危険な設定を明示的に有効にした場合にのみ成立する点が重要です。
- **対象**: DOMPurify **3.0.8**（非デフォルト設定時）
- **発見年**: 2024年、発見者 Kevin Mizu
- **教訓**: `CUSTOM_ELEMENT_HANDLING` の緩い正規表現や `FORBID_CONTENTS` の弱体化など、**設定でサニタイザを緩めるとmXSSが再来する**。

> 出典: Exploring the DOMPurify library: Bypasses and Fixes（Kevin Mizu、2024） — https://mizu.re/post/exploring-the-dompurify-library-bypasses-and-fixes
> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

---

### 現代の防御と、この原典から学ぶべきこと

fp170の10年以上にわたる余波を踏まえると、実務者・研究者が持つべき教訓は次の通りです。

1. **「サニタイズした文字列」と「実行される文字列」は別物になり得る**、という前提を常に持つ。防御は「危険物を消す」だけでなく、**サニタイズ後に再シリアライズ・再パースして結果を再検査する**（`P(P(D)) = P(D)` を保証しにいく）べき。DOMPurifyはまさにこの思想で作られている。
2. **名前空間（HTML/SVG/MathML）の切り替えは第一級の攻撃面**である。SVG/MathMLを許可するなら、各ノードを**親の名前空間と照合して検証**する必要がある（Bentkowskiの修正が事実上の標準解）。不要なら許可しないのが最善。
3. **サニタイズはクライアント側（ブラウザと同じパーサ）で行うのが原則**。サーバ側パーサとブラウザのパーサの理解の食い違いこそがfp170の突いた急所であり、DOMPurifyのようにブラウザ自身のDOMを使う設計がこれを構造的に回避する。
4. **属性値中の `<`, `>` を含む危険文字は必ずエスケープ**する。Googleが後年示した通り、属性値内の山括弧エスケープは名前空間混同を含む多くのmXSSを封じる安価で強力な防御になる。
5. **多層防御**: 万一の変異に備え、**CSP**（`script-src` の厳格化、`unsafe-inline` 排除）や、より根本的には **Trusted Types**（危険なsink〈ユーザー入力が最終的に実行・解釈される代入先。例: `innerHTML`〉への文字列代入をブラウザレベルで禁じ、検証済みオブジェクトのみ許す仕組み）を併用する。
6. **バージョンと設定を常に確認する**。mXSSはバージョン依存・設定依存が極端に強い。DOMPurifyを使うなら**最新版を、デフォルトに近い安全な設定で**使い、`ADD_TAGS`/`CUSTOM_ELEMENT_HANDLING`/`FORBID_CONTENTS` などで防御を緩めていないか点検する。

fp170は、単発のブラウザバグの寄せ集めに見えた現象の背後に「パースの非対称性」という統一原理を見出し、それに `mutation-based XSS` という名を与えたことで、Web防御の常識を書き換えました。そして著者ら自身がDOMPurifyという形で「答え」を実装し、以後の攻防のフィールドを用意しました。**mXSSを学ぶことは、Webのセキュリティを『文字列マッチング』から『構造とパーサの理解』へと引き上げる旅の出発点**なのです。

> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
> 出典: DOMPurify 公式リポジトリ — https://github.com/cure53/DOMPurify

---

### この節の主要出典一覧

- mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations（原典、ACM CCS 2013） — http://dx.doi.org/10.1145/2508859.2516723
- MXSS Evolution and Timeline: A primer to MXSS（s1r1us、GitHubミラー） — https://github.com/msrkp/MXSS
- The innerHTML Apocalypse（Mario Heiderich の発表資料） — https://www.slideshare.net/x00mario/the-innerhtml-apocalypse
- Mutation XSS via namespace confusion — DOMPurify < 2.0.17 bypass（Securitum、Michal Bentkowski、2020） — https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/
- From SVG and back — DOMPurify < 2.2.2 bypass（Daniel Santos、2020） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f
- Exploring the DOMPurify library: Bypasses and Fixes（Kevin Mizu、2024） — https://mizu.re/post/exploring-the-dompurify-library-bypasses-and-fixes
- Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
- Escaping '<' and '>' in attributes（Google Bug Hunters） — https://bughunters.google.com/blog/escaping-and-in-attributes-how-it-helps-protect-against-mutation-xss
