# 第4章 高度なXSS（本丸）― mXSS・サニタイザ回避・prototype pollution・DOM clobbering・CSP回避・script gadgets

> ⚠️ **本章は執筆途中です。** 現在、mXSS／サニタイザ回避の前半（Cure53論文、Bentkowskiの名前空間混同、DOMPurify再バイパス、Sonar mXSS）まで完成しています。残り（プロトタイプ汚染、DOM clobbering、CSP回避・script gadgets の各節）は未生成です。理由は本章生成中にアカウントのセッション利用上限に達したためです。続きの生成方針はチャットでの相談後に再開します。

## mXSSの原典（Cure53論文 fp170）

反射型・格納型・DOMベースといった「素朴なXSS」を一通り理解した学習者が、次に足を踏み入れるべき最も重要な領域のひとつが **mXSS（mutation-based XSS、変異型XSS）** です。mXSSは「サニタイザ（入力に含まれる危険な文字列を無害な形に変換・除去する処理）がいったん安全だと判断して通したはずのHTMLが、ブラウザに渡った瞬間に**別の、危険なHTMLへと化ける（=変異する）**」という、直感に反する現象を突く攻撃クラスです。フィルタもWAF（Web Application Firewall、HTTPを検査してXSS等を遮断する防御機構）もサニタイザも、みな「自分が見た文字列が、そのまま実行される文字列だ」と暗黙に信じています。mXSSはその**信頼そのもの**を破壊します。

この攻撃クラスを世界で初めて体系的に定義・命名し、理論的基礎を与えたのが、本節の主資料である **Mario Heiderich（マリオ・ハイデリッヒ）ら Cure53 の論文 "mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations"（通称 fp170）** です。この論文は、それまで単発の「面白いブラウザのバグ」としてしか見られていなかった一連の現象を、「サニタイザのパイプラインに構造的に存在する欠陥」として統一的に説明し、以後10年以上にわたって続くDOMPurifyバイパスの攻防（後述）の起点となりました。本節ではこの原典を精読し、その論理・分類・具体的ペイロード・防御策を、原文を読まなくても完全に理解できるレベルまで分解します。

> ⚠️ **未取得の資料**: 本節の主資料である「mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations（Cure53 fp170）」のPDF本体（https://cure53.de/fp170.pdf）は、実行環境のネットワーク送信プロキシ（egress proxy）によりドメイン `cure53.de` への直接アクセスがブロックされ（理由: EGRESS_BLOCKED）、自動取得できませんでした。ミラー（`xss-payloads.paracyberbellum.io/papers/mXSSattacks.pdf`）や関連ドメインも同様にブロックまたは名前解決不可でした。以下の本文は、**GitHub上で参照可能な一次・二次資料**（Cure53自身が管理する DOMPurify wiki、著者らの発表資料に基づく `msrkp/MXSS`＝s1r1us まとめ、Securitum の後続研究記事の検索スニペット等）と、複数の検索結果・専門知識から**原典の内容を実質的に再構成**したものです。正確な原文・図表・完全な評価データは、以下のURLからユーザーご自身で直接ご覧ください:
> - mXSS原典（PDF）: https://cure53.de/fp170.pdf
> - ミラー（PDF）: https://xss-payloads.paracyberbellum.io/papers/mXSSattacks.pdf
> - ACM CCS 2013 収録ページ: https://dl.acm.org/doi/abs/10.1145/2508859.2516723

（以下は、直接取得できなかった上記PDFの内容を、GitHub上のミラー・二次資料・一般的な専門知識に基づいて再構成・補足した解説です。ペイロード等のコードは各資料に記載の形をできる限りそのまま引用していますが、原文の一字一句の完全な再現ではない点にご留意ください。個々の記述には根拠となる出典を併記します。）

---

### 書誌情報 — この論文は何者か

- **正式タイトル**: *mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations*
- **著者**: Mario Heiderich、Jörg Schwenk、Tilman Frosch、Jonas Magazinius、Edward Z. Yang（ハイデリッヒらはドイツのセキュリティ企業 Cure53／ルール大学ボーフム、Magazinius はチャルマース工科大学、Yang はスタンフォード大学）
- **発表**: 2013年11月、**ACM CCS 2013**（ACM SIGSAC Conference on Computer and Communications Security）。トップティアのセキュリティ国際会議の査読付き論文です。
- **Cure53の整理番号**: `fp170`（Cure53が公開資料に振る "fingerprint" 番号。URLの `fp170.pdf` はこれに由来）
- **姉妹プレゼン**: 同じ内容を筆頭著者Heiderichが講演した "The innerHTML Apocalypse"（OWASP AppSec Research EU 2013 / Hack in Paris 2013）が存在し、スライドはHeiderich（@x00mario）名義で公開されています。

この論文の歴史的意義は二つあります。第一に、**"mutation-based XSS (mXSS)" という用語と攻撃クラスを初めて定義した**こと。第二に、著者らがこの論文の問題意識から実際の防御ライブラリ **DOMPurify** を生み出し（Cure53製）、それが今日のクライアント側HTMLサニタイズの事実上の標準になったことです。つまりfp170は「攻撃の原典」であると同時に「現代の主要な防御の出発点」でもあります。

> 出典: mXSS attacks: Attacking well-secured web-applications by using innerHTML mutations（ACM CCS 2013 収録） — https://dl.acm.org/doi/abs/10.1145/2508859.2516723
> 出典: MXSS Evolution and Timeline: A primer to MXSS（s1r1us、GitHubミラー msrkp/MXSS 経由で参照） — https://github.com/msrkp/MXSS

---

### mXSSとは何か — 定義

論文の定義を噛み砕くと、mXSS（変異型XSS）とは次のような攻撃です。

> **攻撃者は、サニタイザ・フィルタ・WAFといった防御機構に「安全である」と判定される無害なHTML文字列を用意する。ところがその文字列が、ブラウザによってDOM（Document Object Model、HTMLをブラウザがツリー構造のオブジェクトとして表現したもの）へ取り込まれ、あるいは `innerHTML` を通じて読み書きされる過程で、ブラウザ自身の手によって別のHTML構造へと「変異（mutation）」させられ、その変異後の構造がスクリプトを実行する。**

ポイントは、**攻撃者が注入した文字列そのものにはスクリプト実行の要素が（防御機構から見える形では）含まれていない**という点です。危険なコードは、ブラウザのパーサ（HTMLを解釈してDOMツリーを組み立てる部品）とシリアライザ（DOMツリーをHTML文字列に戻す部品）の**挙動の中から自然発生的に生まれます**。防御機構は「実行されるコード」を一度も見ないまま通してしまう——これがmXSSの本質であり、従来のXSS対策（危険なタグや属性を探して除去する）がまるごと無力化される理由です。

論文の副題にある通り、mXSSが恐ろしいのは「よく守られたアプリ（well-secured web-applications）」をこそ破る点です。素朴なアプリは単純なXSSで落ちますが、mXSSはHTMLPurifierのような高品質なサニタイザを**正しく使っていてもなお**成立しました。

> 出典: mXSS attacks: attacking well-secured web-applications by using innerHTML mutations（Semantic Scholar 抄録） — https://www.semanticscholar.org/paper/mXSS-attacks%3A-attacking-well-secured-by-using-Heiderich-Schwenk/168bd0913645d95f655cde86bc87090ac096db39

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

> 出典: MXSS Evolution and Timeline: A primer to MXSS（msrkp/MXSS README） — https://github.com/msrkp/MXSS

#### なぜ「サーバ側サニタイザ」が特に脆弱なのか

論文が突いた核心は次の一文に集約されます。「**サーバ側フィルタとクライアント側（ブラウザ）は、HTMLの解釈について同一の理解を共有していると暗黙に仮定しているが、それは誤りである**」。

サーバ側サニタイザ（PHPのHTMLPurifier、WordPressのkses、htmlLawed など）は、独自のHTMLパーサやDOMライブラリ（あるいはXMLパーサ）で入力を解釈します。しかし最終的にその出力を解釈するのは**ユーザーのブラウザ**であり、両者のパーサは仕様の細部・エラー回復・独自拡張が食い違います。特に致命的なのが次の二つです。

- **`innerHTML` のラウンドトリップ**: JavaScriptで `el.innerHTML` を**読む**と、ブラウザはその要素の子DOMを**シリアライズして文字列を返します**。そしてその文字列を別の要素に `otherEl.innerHTML = str` で**書き戻す**と、再パースされます。この「read→write」の往復（round-trip）で、ブラウザ独自のシリアライズ規則が発動し、元と違う文字列・DOMになります。多くのクライアント側サニタイザ（当時のjQueryプラグイン等）や、DOMを触るWYSIWYGエディタが、この往復を内部で行っていました。
- **RAWTEXT/RCDATA要素のコンテキスト差**: `<style>`, `<xmp>`, `<textarea>`, `<title>`, `<noscript>`, `<iframe>`, `<noembed>`, `<noframes>` などの要素は、その**中身の解釈ルールが特殊**です（後述）。サーバ側パーサとブラウザで、この中身が「ただのテキスト」なのか「生きたHTML」なのかの判定が食い違うと、そこがそっくり実行コードに化けます。

> 出典: MXSS Evolution and Timeline: A primer to MXSS（msrkp/MXSS README、サニタイザ5段階と「サーバではRAWTEXT・ブラウザではアクティブHTML」の食い違いの記述） — https://github.com/msrkp/MXSS

---

### 論文が分類したmXSSのカテゴリと具体的ペイロード

論文は、当時知られていた／新たに発見したmXSSベクタを複数のカテゴリに整理しました（著者らは「7つのmXSSベクタ」を分類したと紹介されています）。以下、代表的なカテゴリを、**なぜ動くのか**の原理とともに、具体的ペイロードで解説します。各ペイロードには「なぜこれが動くのか」を必ず添えます。

#### カテゴリ1: バッククォート変異（backtick mutation）

mXSSという概念の**歴史的な出発点**であり、論文が「最初のmXSS」として引用する事例です。2007年に長谷川陽介（Yosuke Hasegawa）氏が発見した、Internet Explorer（IE）のバッククォート（`` ` ``）処理のバグに由来します。

```html
<img src="x" alt="``onerror=alert(1)" />
```

**なぜ動くのか**: 攻撃者はまず、`alt` 属性の値として `` ``onerror=alert(1) `` という、ダブルクォートで正しく囲まれた**無害な文字列**を仕込みます。サニタイザから見ると `alt` はただのテキスト属性で、危険な要素はどこにもないので通過します。ところがIE（旧バージョン）は、**バッククォートを属性値の正当な区切り文字（クォート）として扱う**という非標準の癖を持っていました。このため、この要素の `innerHTML` を読み出すと、IEのシリアライザは `alt` の値をダブルクォートで囲み直さず、バッククォートを使った形——概念的には

```html
<IMG alt=``onerror=alert(1) src="x">
```

——のような文字列を吐き出します。この文字列を**再パース**すると、IEは先頭の `` `` `` を「空のバッククォート区切りの値」と解釈し、続く `onerror=alert(1)` を**独立した新しい属性**として認識してしまいます。結果、当初はただの `alt` テキストだったものが、`onerror` イベントハンドラに変異し、画像読み込み失敗時に `alert(1)` が実行されます。「防御機構が見た文字列」と「最終的に実行された文字列」が、ブラウザのシリアライズ／再パースだけで別物になった——これがmXSSの原型です。

> 出典: MXSS Evolution and Timeline（Hasegawa 2007 のバッククォート事例、msrkp/MXSS） — https://github.com/msrkp/MXSS
> 出典: The innerHTML Apocalypse（Heiderich、"IE8はバッククォートを属性と値の正当な区切りとして扱う" の記述の検索スニペット） — https://www.slideshare.net/x00mario/the-innerhtml-apocalypse

**バージョン依存性の注意**: このバッククォート変異は主に **IE8以前（およびそれらの互換モード）** に固有の挙動です。現代のChrome/Firefox/Edge（Chromium版）では再現しません。歴史的重要性は極めて高いものの、実戦で狙う場面は現在ほぼありません。バージョン依存の攻撃を扱う際は、常に「どのブラウザ・どのバージョンで成立するか」を確認する習慣をつけてください。

#### カテゴリ2: CSSエスケープ変異（CSS escape mutation）

`style` 属性（インラインCSS）を許可しているサニタイザを破る、論文の目玉の一つです。CSSには、任意の文字をバックスラッシュ＋16進コードで表す**CSSエスケープ**（例: `\27` は `'`、`\3b` は `;`）という記法があります。

```html
<p style="font-family:'foo\27\3bx:expression(alert(1))'">
```

（サニタイザに渡す段階では、バックスラッシュ自体をHTMLエンティティ `&#x5c;` などでさらに包んで `<p style="font-family:'foo&#x5c;27&#x5c;3bx:expression(alert(1))'">` の形にして送ることもあります。）

**なぜ動くのか**: サニタイザがこの `style` を検査する時点では、値は `font-family:'foo\27\3bx:expression(alert(1))'` という**単一の `font-family` プロパティの文字列リテラル**にしか見えません。`\27`（`'`）も `\3b`（`;`）もまだエスケープされたままなので、プロパティの区切りにはならず、危険な `expression()`（後述）も文字列の中に閉じ込められた無害なテキストとして扱われ、フィルタを通過します。ところがIEの `innerHTML` シリアライザは、この `style` を書き戻す際に**CSSエスケープをデコードして生の文字に戻して**しまいます。すると値は

```css
font-family:'foo';x:expression(alert(1))'
```

に変異します。`\27` が `'` に戻ったことで文字列リテラルが `'foo'` で閉じられ、`\3b` が `;` に戻ったことでプロパティが区切られ、`x:expression(alert(1))` という**新しいCSS宣言**が出現します。`expression()` はIE独自のCSS拡張で、CSSの値としてJavaScriptを評価・実行してしまう悪名高い機能です。再パース時にこれが評価され、`alert(1)` が動きます。エスケープされた安全な形と、デコードされた危険な形の間の「変異」を突いた典型例です。

> 出典: The innerHTML Apocalypse / mXSS CSSエスケープの記述（検索スニペット。`<p style="font-family:'foo&#x5c;27&#x5c;3bx:expression(alert(1))'">` の例と「innerHTMLを2回アクセスすると再帰的にトリガーされる」旨） — https://www.slideshare.net/slideshow/the-innerhtml-apocalypse/19935120

**バージョン依存性の注意**: `expression()` は **IEのみ**の機能で、IE8以前で有効、IE9以降の標準モードでは無効化、IE11でほぼ撤廃されました。したがってこの `expression()` 版ペイロードもIE時代の遺物です。ただし「CSSエスケープが `innerHTML` 往復でデコードされてプロパティ境界が崩れる」という**変異の原理そのもの**は普遍的で、後年の別のCSS由来mXSS（後述のGoogle CTF 2024の `@keyframes`/`cssText` シリアライズ不備など）にも受け継がれています。論文はこの原理から「**ユーザー由来のCSSは、たとえエスケープされていても危険文字を許してはならない**」という教訓を導きました。

#### カテゴリ3: エンティティ変異とRAWTEXT/RCDATA要素の再解釈

`<style>`, `<xmp>`, `<listing>`, `<title>`, `<textarea>`, `<noscript>`, `<noembed>`, `<noframes>`, `<iframe>` といった要素は、HTML仕様上、中身の扱いが特殊です。ざっくり言うと、

- **RAWTEXT要素**（`<style>`, `<xmp>`, `<noembed>` 等）: 中身はタグもエンティティも解釈されない「生テキスト」。閉じタグ（例 `</style>`）が来るまで、`<` すら普通の文字として扱われる。
- **RCDATA要素**（`<title>`, `<textarea>`）: 中身のタグは解釈されないが、**HTMLエンティティ（`&lt;` など）はデコードされる**。

mXSSは、この「中身がテキスト扱いか、生きたHTML扱いか」の判定が、サニタイザ側とブラウザ側（あるいは名前空間の違いで）食い違う点、およびエンティティのデコード有無が往復でズレる点を突きます。論文が挙げる典型は「あるコンテキストではエンティティ化されて無害だった文字列が、別コンテキストへ移された瞬間に生のHTMLとして復活する」というものです。

代表例として、後年に整理された `<noscript>` を用いたものを示します（同じ原理で論文当時の `<xmp>`/`<listing>` 版も存在します）。

```html
<noscript><p title="</noscript><img src=x onerror=alert(1)>">
```

**なぜ動くのか**: `<noscript>` の中身は、**スクリプトが有効な環境ではRAWTEXT（生テキスト）**として扱われ、**スクリプトが無効な環境（あるいはDOMParser API）ではHTMLとして**扱われます。この二面性が鍵です。サニタイザが `DOMParser`（スクリプト無効相当）で解析すると、`<noscript>` の中は生きたHTMLとみなされ、`<p title="...">` の属性値の内側に `</noscript><img ...>` が閉じ込められた「無害な」ツリーになります。ところがこの結果を実ブラウザ（スクリプト有効）の `innerHTML` に挿入すると、今度は `<noscript>` の中身がRAWTEXTになり、`</noscript>` で早期に閉じられて、その後ろの `<img src=x onerror=alert(1)>` が**独立した生きた要素**として出現・実行されます。まさに「解析コンテキストの食い違い」による変異です。

> 出典: MXSS Evolution and Timeline（Masato による noscript/noembed mXSS、`<noscript><p title="</noscript><img src=x onerror=alert(1)>">` の例と「DOMParserではスクリプト無効とみなされる」旨、msrkp/MXSS） — https://github.com/msrkp/MXSS

補足として、`<noembed>` におけるエンティティ・デコードの食い違いを直接観察できる例も知られています。

```javascript
new DOMParser().parseFromString('A <noembed> B &lt;/noembed&gt; C &lt;img src=x onerror=alert(1)&gt; D </noembed> E','text/html').body.innerHTML
```

**なぜ動くのか**: `<noembed>` はRAWTEXT要素なので、本来その中の `&lt;` はデコードされないはず。ところが一部ブラウザ（当時のChrome）は `DOMParser` 経由でこの中身のエンティティをデコードしてしまい、`&lt;/noembed&gt;` が `</noembed>` に、`&lt;img ...&gt;` が `<img ...>` に化けます。結果、`<noembed>` が途中で閉じられ、`<img>` が生きた要素として分離・実行されます。これも「エンティティのデコード有無が食い違う」タイプの変異です。

#### カテゴリ4: 未知要素・不明な要素（unknown/foreign element）の変異

HTMLに存在しない独自タグ（例 `<x>`）や、パーサが「foreign content（外来コンテンツ）」として扱う要素が絡むと、ブラウザはエラー回復や名前空間の切り替え（次項）を行い、そのシリアライズ結果が予期せぬ形になります。論文は、標準外・未知の要素をサニタイザが素通しし、ブラウザがそれを独自ルールで整形し直すことでツリーが崩れ、隣接する安全な文字列が実行コンテキストへ押し出される事例を扱いました。この「未知要素の整形」は、次のカテゴリ5（名前空間の混同）と深く結びついています。

#### カテゴリ5: 名前空間の混同（namespace confusion — SVG / MathML）

**mXSSの中で最も影響が長く続き、最も重要**なカテゴリです。論文の筆頭著者Heiderich自身が2011年にMozillaのバグ（Bug 650001）として発見した、SVG由来のmXSSがその源流です。

まず前提知識。HTMLドキュメントの中には、実は**3つの名前空間（namespace、要素がどの文法体系に属するかを定める区分）**が同居できます。

- **HTML名前空間**: 通常のHTML要素。`<style>` の中身はRAWTEXT（生テキスト）で、HTMLコメント `<!-- -->` は特殊扱い。
- **SVG名前空間**: `<svg>` の子孫。ここでは要素はXML的に扱われ、`<style>` の中身も**要素として解析され得る**など、HTMLとは規則が異なる。
- **MathML名前空間**: `<math>`（数式マークアップ言語）の子孫。同じくXML的な規則。

ブラウザのHTMLパーサは、`<svg>` や `<math>` に遭遇すると、その子孫を**SVG/MathMLの規則で解析するモードに切り替え**、閉じると再びHTMLモードに戻ります。この「名前空間の切り替え」の境界判定が、サニタイズ時と再パース時でズレると、ある名前空間では無害だった `<style>` の中身が、別の名前空間では生きた `<img>` になって実行される——これが名前空間混同mXSSです。

Heiderichが原典で示したSVGベースの原型ペイロードは次の形です。

```html
<!doctype html><svg><style>&lt;img src=x onerror=alert(1)&gt;<p>
```

**なぜ動くのか**: SVG名前空間の中の `<style>` は、HTMLの `<style>`（RAWTEXT）とは中身の扱いが異なります。サニタイザがこの文字列を解析した時点では、`<style>` の中身は `&lt;img src=x onerror=alert(1)&gt;` という**エンティティ化された無害なテキスト**に見え、危険な `<img>` タグはどこにもありません。ところが `innerHTML` 往復やコンテキストの切り替えを経ると、このエンティティがデコードされて生の `<img src=x onerror=alert(1)>` が復活し、しかも名前空間の切り替わりによってそれがHTMLの生きた要素として解釈され、実行されます。「SVG内のstyleはHTMLのstyleと違う」「エンティティのデコードがコンテキストで変わる」という二つの食い違いが重なった、mXSSの本丸です。

> 出典: MXSS Evolution and Timeline（Heiderich 2011 の SVG/innerHTML mutation、`<!doctype html><svg><style>&lt;img src=x onerror=alert(1)&gt;<p>` の例、Mozilla bug 650001、msrkp/MXSS） — https://github.com/msrkp/MXSS
> 出典: 974208 - (mXSS) [meta] innerHTML=innerHTML should not introduce XSS holes（Mozilla Bugzilla のmXSSメタバグ） — https://bugzilla.mozilla.org/show_bug.cgi?id=974208

論文は「**SVGやMathMLを許可すること自体が、名前空間の切り替えという新たな攻撃面を開いてしまう**」と警告し、この予言は後述の通り10年以上にわたって的中し続けます。

---

### 論文の実証 — 何を、どれだけ破ったのか

fp170が学術論文として説得力を持ったのは、これらのベクタが**現実の一流アプリと一流の防御を実際に破った**ことを示した点にあります。

#### 破られた実アプリ（格納型mXSSを実証）

著者らは、以下のような**高知名度アプリケーションに格納型（stored）mXSSベクタを実際に設置**できたと報告しています。多くはHTMLメール本文を扱うWebメールで、送られたHTMLメールが受信者のブラウザで整形される過程を突きます。

- Yahoo! Mail
- Rediff Mail
- Open-Xchange（OpenExchange）
- Zimbra
- Roundcube
- その他複数の商用製品

#### 破られた防御機構

さらに衝撃的なのは、当時「これを使っておけば安全」とされていた**あらゆる層の防御を横断的にバイパス**したことです。

- **サーバ側XSSサニタイザ**: HTML Purifier、kses（WordPress）、htmlLawed、Blueprint、Google Caja
- **クライアント側フィルタ**: XSS Auditor（Chrome）、IE XSS Filter
- **ネットワーク層**: WAF（Web Application Firewall）各種、IDS/IPS（侵入検知／防止システム）

#### 影響範囲

mXSSは特定ブラウザの奇癖にとどまらず、**IE・Firefox・Chromeの3大ブラウザファミリすべて**に影響することも示されました。つまり、これは「直せば済むバグ」ではなく、HTMLの解析・シリアライズという**Webの基盤設計に構造的に埋め込まれた欠陥**だ、という強いメッセージになりました。

> 出典: mXSS attacks（Request PDF 抄録、Yahoo! Mail・Rediff・OpenExchange・Zimbra・Roundcube 等への設置と HTML Purifier/kses/htmlLawed/Blueprint/Google Caja・XSS Auditor/IE XSS Filter・WAF/IDS/IPS のバイパス、3大ブラウザ全滅の記述） — https://www.researchgate.net/publication/266654651_mXSS_attacks_Attacking_well-secured_web-applications_by_using_innerHTML_mutations

---

### 論文が提案した防御策

論文は攻撃を示すだけでなく、防御の方向性も提示しました。中心的なアイデアは次の通りです。

1. **`innerHTML` アクセスの傍受（interception）**: `innerHTML` の getter/setter をフックし、代入される（あるいは読み出される）マークアップを安全な形に強制する。危険な往復変異が起きる前に介入する発想です。
2. **XML形式でのシリアライズ**: DOMを書き戻す際に、緩いHTMLシリアライズではなく、より厳密なXML形式でシリアライズすることで、多くの変異ベクタを封じられる（属性値のクォート強制、エンティティの一貫したエスケープ等）。
3. **SVG・MathMLを許可しない**: 名前空間切り替えという攻撃面をそもそも開かない。
4. **標準モード（standards mode）の強制**: 互換モード（quirks mode）でのIE独自挙動（バッククォート、`expression()`）を避ける。
5. **CSP（Content Security Policy、実行可能なスクリプトの出所をブラウザに宣言・制限する仕組み）の併用**: 万一注入されても `inline` スクリプトや外部スクリプトの実行を抑止する多層防御。
6. **厳格なホワイトリスト**: 許可する要素・属性・値を「許可リスト」で最小限に絞る（ブラックリストで危険物を数え上げるのは原理的に破綻する）。
7. **属性値中の危険文字（`<`, `>`, `` ` ``, バックスラッシュ, クォート等）の徹底エスケープ**、および**ユーザー由来CSSに対する極端な警戒**（エスケープ済みでも危険文字は許さない）。

この問題意識の直接の産物が、Cure53が開発した **DOMPurify** です。DOMPurifyは「DOM上でサニタイズし、サニタイズ後に**もう一度シリアライズ→再パースして結果を再検査する**」というアプローチで、`P(P(D)) ≠ P(D)` の非べき等性そのものに対処しようとします。fp170は攻撃の原典であると同時に、この現代的防御の思想的な出発点でもあるのです。

> 出典: The innerHTML Apocalypse（Heiderich。防御策として "avoid SVG and MathML"、"enforce standards mode"、"use CSP"、"strict white-lists"、"innerHTMLアクセスの傍受とXML形式シリアライズ" を提案する検索スニペット） — https://www.slideshare.net/slideshow/the-innerhtml-apocalypse/19935120
> 出典: Escaping '<' and '>' in attributes – how it helps protect against mutation XSS（Google Bug Hunters。属性値中の山括弧エスケープがmXSS防御に効く理由） — https://bughunters.google.com/blog/escaping-and-in-attributes-how-it-helps-protect-against-mutation-xss

---

### 原典のその後 — 名前空間混同mXSSの系譜（発展的補足）

（以下はfp170原典そのものではなく、その予言がどう的中したかを追う発展的補足です。中〜上級読者が実戦で出会うのはむしろこちらなので、バージョンと年を明記して整理します。）

fp170が「名前空間の混同は続く」と警告した通り、mXSSは**DOMPurifyバイパスの歴史**として現在まで生き続けています。原理はすべてfp170の `P(P(D)) ≠ P(D)` に帰着します。以下、主要な事件を時系列で示します。**いずれも「対象バージョン」「発見年」「修正状況」を明記します**（バージョン依存の攻撃は陳腐化するため、常にこの3点セットで捉えてください）。

#### 2018年 — Gareth Heyes、EdgeのタイトルエンティティによるDOMPurifyバイパス

```html
<title>&lt/title&gt&ltimg&sol;src=&quot&quotonerror&equals;alert(1)&gt
```

**なぜ動くのか**: RCDATA要素 `<title>` の中身のエンティティを、当時のEdge（旧EdgeHTML）が特殊にデコードし、`&lt/title&gt` が `</title>` に化けて早期に閉じ、後続の `<img ... onerror=alert(1)>` が生きた要素として復活します。エンティティ・デコードの食い違い（カテゴリ3）の一種です。
- **修正**: DOMPurifyが該当バージョンで対応済み。EdgeHTML自体もその後Chromiumベースへ移行し消滅。

> 出典: MXSS Evolution and Timeline（Gareth "Edge" mXSS 2018、msrkp/MXSS） — https://github.com/msrkp/MXSS

#### 2019年 — SecurityMB、SVGの `</p>` 早期クローズによる変異

```html
<svg></p><style><g title="</style><img src onerror=alert(1)>">
```

**なぜ動くのか**: `<svg></p>` はブラウザによって `<svg><p></p></svg>` に補完され（`</p>` が孤立クローズなので空の `<p>` が生成される）、`<p>` がSVG内に一瞬存在します。この構造の食い違いにより、後段の `<style>`（SVG内）のRAWTEXT境界がズレ、`</style>` で閉じた後の `<img>` が実行コンテキストへ脱出します。
- **修正**: DOMPurifyが対応。

> 出典: MXSS Evolution and Timeline（SecurityMB "SVG </p>" mXSS 2019、msrkp/MXSS） — https://github.com/msrkp/MXSS

#### 2020年 — SecurityMB（Michał Bentkowski）、MathML名前空間切り替えによる **DOMPurify < 2.0.17** バイパス

これは**バージョン依存mXSSの代表例**として必ず押さえるべき事件です。

```html
<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
```

**なぜ動くのか**: 二つの高度なパーサ挙動を組み合わせます。
1. **フォームのネスト禁止**: HTMLパーサは `<form>` の入れ子を許しません。1回目の解析では内側の `<form>` が（一時的に）存在し得る構造になりますが、2回目の解析（再パース）では**内側の `<form>` が削除**され、DOMツリーの親子関係が変化します。
2. **MathMLテキスト統合点（text integration point）の名前空間規則**: `<mtext>` はMathMLの「テキスト統合点」で、その**直接の子はデフォルトでHTML名前空間**として扱われます。ただし例外が二つあり、`<mglyph>` と `<malignmark>` だけは（直接の子である場合に限り）MathML名前空間に留まります。

1回目の解析（サニタイザが見る木）では `<style>` の子孫がHTML名前空間にあり、その中の `<img>` は無害なRAWTEXTの一部に見えます。ところがフォーム削除によって親子関係が変わり、`<mglyph>` が `<mtext>` の直接の子になると、**その子孫（`<style>` とその中身）がMathML名前空間に切り替わり**、`<style>` の中身がもはやRAWTEXTではなくなって、隠れていた `<img src onerror=alert(1)>` がHTML要素として解釈・実行されます。「最終DOMではMathML名前空間、サニタイズ時DOMではHTML名前空間」という食い違い、まさにfp170の名前空間混同（カテゴリ5）の現代版です。
- **対象**: DOMPurify **2.0.17 未満**
- **発見年**: 2020年、発見者 Michał Bentkowski（@SecurityMB、Securitum）
- **修正**: **DOMPurify 2.0.17** で修正。Bentkowski自身が提案した「**全要素について親の名前空間と照合して検証する**」防御（PR #495）が導入され、これが以後数年間の名前空間混同に対する決定打となりました。

> 出典: Mutation XSS via namespace confusion – DOMPurify < 2.0.17 bypass（Securitum research、Michał Bentkowski、2020。`<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>` とMathMLテキスト統合点・mglyph例外・親名前空間検証による修正の記述） — https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/
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

> 出典: Exploring the DOMPurify library: Bypasses and Fixes（Kevin Mizu、2024。DOMPurify 3.0.8 の制限回避、annotation-xml/foreignobject と CUSTOM_ELEMENT_HANDLING の記述） — https://mizu.re/post/exploring-the-dompurify-library-bypasses-and-fixes
> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki。mutation XSS・namespace混同・rawtext breakout・nesting-based mXSS 等の攻撃クラス分類と、FORBID_CONTENTS 一覧・親名前空間検証・serialize→re-parse→re-check 防御の記述） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

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

> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki。serialize→re-parse→re-check、親名前空間検証、Trusted Types/CSP を含む現行防御の記述） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
> 出典: DOMPurify 公式リポジトリ（"parser mutation, namespace confusion, DOM clobbering, template tricks" 等の攻撃クラスへの対応と「サニタイズ後にHTMLを変更すると効果が無効化され得る」旨の記述） — https://github.com/cure53/DOMPurify

---

### この節の主要出典一覧

- mXSS attacks（ACM CCS 2013 収録ページ） — https://dl.acm.org/doi/abs/10.1145/2508859.2516723
- mXSS attacks（Request PDF 抄録、実アプリ・破られた防御の一覧） — https://www.researchgate.net/publication/266654651_mXSS_attacks_Attacking_well-secured_web-applications_by_using_innerHTML_mutations
- mXSS attacks（Semantic Scholar） — https://www.semanticscholar.org/paper/mXSS-attacks%3A-attacking-well-secured-by-using-Heiderich-Schwenk/168bd0913645d95f655cde86bc87090ac096db39
- MXSS Evolution and Timeline: A primer to MXSS（s1r1us、GitHubミラー） — https://github.com/msrkp/MXSS
- The innerHTML Apocalypse（Mario Heiderich の発表資料） — https://www.slideshare.net/x00mario/the-innerhtml-apocalypse
- Mutation XSS via namespace confusion – DOMPurify < 2.0.17 bypass（Securitum、Michał Bentkowski、2020） — https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/
- From SVG and back – DOMPurify < 2.2.2 bypass（Daniel Santos、2020） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f
- Exploring the DOMPurify library: Bypasses and Fixes（Kevin Mizu、2024） — https://mizu.re/post/exploring-the-dompurify-library-bypasses-and-fixes
- Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
- Escaping '<' and '>' in attributes（Google Bug Hunters） — https://bughunters.google.com/blog/escaping-and-in-attributes-how-it-helps-protect-against-mutation-xss
- 未取得の原典PDF（要ユーザー直接確認） — https://cure53.de/fp170.pdf

---

## DOMPurifyバイパス：MathML名前空間混同（CVE-2020-26870）

このセクションでは、HTMLサニタイザー（入力HTMLから危険な要素・属性を除去して安全なHTMLに変換するライブラリ）のデファクトスタンダードである **DOMPurify** を、Michał Bentkowski（Securitum所属のセキュリティ研究者、Twitter/Xでは @SecurityMB）が2020年に破った手法を、原理のレベルまで掘り下げて解説する。この脆弱性は **CVE-2020-26870** として登録され、DOMPurify **2.0.17未満**の全バージョンが影響を受けた。

キーワードは3つある。**mutation XSS（mXSS）**、**名前空間混同（namespace confusion）**、そして **MathML**。これらが組み合わさると、「サニタイザーが検査した時点では完全に無害だったHTML」が、ブラウザに再びパース（構文解析）された瞬間に「実行可能なJavaScriptを含む危険なHTML」へと化ける。サニタイザーは自分が安全だと判定したものしか出力しないのに、その出力が後から勝手に変異（mutate）してしまうのだ。これがこの攻撃クラスの怖さであり、面白さでもある。

> ⚠️ **資料取得に関する注記**: 本セクションの主資料である以下の3つのURLは、本実行環境のネットワーク egress プロキシによって直接取得（WebFetch）できませんでした。
> 1. 「Mutation XSS via namespace confusion – DOMPurify < 2.0.17 bypass」 — https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/
> 2. 「Michał Bentkowski 研究インデックス」 — https://www.bentkowski.info/research/
> 3. 「Securitum上のBentkowski記事群」 — https://research.securitum.com/authors/michal-bentkowski/
>
> そのため本セクションの技術的内容は、**DOMPurify公式Wiki（Attack Classes & Bypass History）**、**修正コミットである Pull Request #495**、**CVE-2020-26870の登録情報**、および同種の後続研究（Daniel Santos によるDOMPurify < 2.2.2バイパスなど）と、上記記事の検索スニペットから**再構成・相互検証**したものです。中核となるペイロードや攻撃機序は原文と一致することを複数の権威ある二次情報源で確認済みですが、原文の一次資料を直接確認されたい場合は上記URLを参照してください。（以下は、これら再構成した内容を、一般的なブラウザパーサ知識で補強した詳細解説です。）

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

> 出典: CVE-2020-26870 公式説明（NVD / CVE Details） — https://www.cvedetails.com/cve/CVE-2020-26870/ （direct fetchは環境制約により不可、検索結果および複数DBの記載で確認）

### 前提知識2：DOMPurifyはなぜ「2回パース」するのか

なぜ「往復」が起きるのかを理解するには、DOMPurifyの動作原理を知る必要がある。DOMPurifyは概ね次の手順で動く。

1. アプリケーションから、信頼できないHTML文字列（例: ユーザーが投稿したコメント）を受け取る。
2. その文字列を **一度パースしてDOMツリーを作る**（内部的には `DOMParser` や、`<template>`要素の `innerHTML` などを利用）。—— これが **1回目のパース**。
3. できたDOMツリーを走査し、許可リスト（allow-list）に載っていない要素（例: `<script>`）や属性（例: `onerror`）を **削除**する。残った要素は「安全」とみなす。
4. サニタイズ済みのDOMツリーを再び **HTML文字列にシリアライズ**して呼び出し元に返す（`innerHTML` を読み出す等）。
5. アプリケーションはその文字列を、たとえば `element.innerHTML = purified` のように **DOMへ挿入する**。—— ここでブラウザによる **2回目のパース**が発生する。

つまりDOMPurifyが「安全だ」と判断するのはステップ3の**1回目のパース結果**に対してだが、実際に画面に反映されるのはステップ5の**2回目のパース結果**である。この2つが食い違えば、mXSSが成立する。攻撃者のゴールは、「1回目のパースでは無害に見えるが、2回目のパースで危険物が出現する」ような入力を作り込むことだ。

DOMPurifyの後の修正では、この「文書パースモード（document parsing）とフラグメントパースモード（fragment parsing）の差異」による再パースの揺れをさらに減らすため、`insertAdjacentHTML` を完全に廃止し、可能な限りDOMノードを直接操作するように変更されている（詳細は後述の修正パート）。

> 出典: Harden protection against mutation XSS caused by namespace switching (PR #495, securityMB) — https://github.com/cure53/DOMPurify/pull/495

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
               └─ "（テキスト）</math><img src onerror=alert(1)>"
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
            └─ （中身は「テキスト」ではなく「マークアップ」としてパースされる）
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
| 修正リリース日 | 2020年9月20日ごろ（2.0.17リリース） |
| CVE公開日 | 2020年10月7日 |
| CVSS 3.1 基本値 | **6.1（MEDIUM）** |
| 発見・報告者 | **Michał Bentkowski**（Securitum） |
| 攻撃前提 | サニタイズ結果が `innerHTML` 等でDOMに挿入され、MathML/SVGを含む外来コンテンツがサニタイズ対象に含まれること（DOMPurifyの既定はHTML/MathML/SVGを全てサニタイズ対象とする） |

CVSSが「6.1 / MEDIUM」なのは、XSS一般と同様に「利用者の操作（被害者が細工されたコンテンツを含むページを閲覧すること、UI:R）」を要し、また影響が機密性・完全性への部分的影響（C:L/I:L）にとどまる評価がなされているためである。ただし実際にはセッション乗っ取りやアカウント侵害に直結しうるので、実務上のインパクトは軽視できない。

> 出典（バージョン・日付）: DOMPurify Releases（cure53/DOMPurify）、CVE-2020-26870（NVD/CVE Details）、および 2.0.17 への更新を示す各種依存関係更新記録。

**重要な陳腐化の注意**: この個別のペイロード（form/math/mglyph/style）は 2.0.17（2020年）で修正済みであり、現行のDOMPurify（3.x系）では動作しない。学習の目的は「このペイロードを撃つこと」ではなく、**名前空間混同という攻撃クラスの原理を理解すること**にある。実際、同じ原理の別バリアントがその後も繰り返し発見されており（後述）、この攻撃クラス自体は今も生きている。

### 修正：`_checkValidNamespace` と Pull Request #495

Bentkowskiは脆弱性を報告するだけでなく、修正案そのものも提示した。それが DOMPurify の **Pull Request #495「Harden protection against mutation XSS caused by namespace switching」**（作者 securityMB＝Bentkowski本人）である。中核は新設された **`_checkValidNamespace`** 関数で、**各ノードを「親の名前空間」に照らして検証し、仕様上ありえない名前空間の切り替えを検出したらそのノードを削除する**というものだ。

`_checkValidNamespace` が強制する「正当な名前空間切り替え」ルールの要点（PR #495 の記述より再構成）：

1. **HTML → SVG／MathML** に切り替えられるのは、そのタグが **`<svg>`／`<math>`** である場合のみ。
2. **SVG → HTML** に戻れるのは、親が **HTML統合ポイント**（`foreignObject` など）である場合のみ。
3. **MathML → HTML** に戻れるのは、そのタグが **`<math>`** の場合、または親が統合ポイントである場合のみ。
4. **HTMLから他名前空間の要素**が現れてよいのは、親が **MathMLテキスト統合ポイントまたはHTML統合ポイント**である場合のみ。
5. **SVG／MathML固有の要素名**を持つ要素は、対応する名前空間にしか存在してはならない。
6. 逆に、**HTML要素**がSVG/MathML固有の要素名（例: `mglyph`）を持っていたら**削除**する。

このルール6こそが、まさに本攻撃を無力化する。初回パースで生まれた「**HTML名前空間の `mglyph`**」は、ルール6に照らすと「HTML要素のくせにMathML固有名を持つ不正な要素」なので、DOMPurifyがサニタイズ段階で**削除**する。危険物を"解凍"するための足場（mglyph→style）がそもそも取り除かれるため、再パースしても何も起きない。

PR #495はさらに、mXSSの温床を減らすための周辺強化も行った。

- **`insertAdjacentHTML` の完全廃止**: 文書パースモードとフラグメントパースモードの差に起因する再パースの揺れを避けるため、DOMノードを直接扱う方式に変更。
- **DOM clobbering（DOMクロバリング：`id`/`name`属性でDOMプロパティを上書きしてスクリプトの前提を崩す攻撃）対策**の強化。

> 出典: Harden protection against mutation XSS caused by namespace switching (PR #495) — https://github.com/cure53/DOMPurify/pull/495
> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

### 防御策：アプリ側・ライブラリ側でできること

実務者として押さえるべき防御を整理する。

1. **DOMPurifyを最新に保つ**。名前空間混同は一度きりの脆弱性ではなく、次々と新種が見つかる「クラス」である。2.0.17（本CVE）、2.2.2（後述のSVG版）など、修正のたびにバージョンを上げること。バージョン固定（ピン留め）したまま放置するのが最も危険。
2. **不要な外来コンテンツを許可しない**。多くのWebアプリはユーザー入力にMathMLやSVGを本当に必要とはしていない。DOMPurifyの設定で `USE_PROFILES: { html: true }` のようにHTMLのみを許可し、MathML/SVGを対象から外せば、名前空間混同の攻撃面（attack surface）を根本から縮小できる。
3. **可能なら「サニタイズしてから即挿入」以外の設計を検討する**。信頼できないHTMLをそもそもレンダリングしない、テキストとして扱う（`textContent` を使う）、あるいはサーバ側での厳格な検証と組み合わせる、など多層防御にする。
4. **CSP（Content Security Policy）を併用する**。万一サニタイズをすり抜けても、`script-src` を厳格にし、インラインイベントハンドラ（`onerror` 等）を禁止していれば、`onerror=alert(1)` の発火自体をブロックできる可能性がある。ただしCSPはサニタイザーの代替ではなく、最後の砦としての併用が原則。
5. **サニタイザーを自作しない**。名前空間混同やmXSSは、HTMLパーサの深い挙動を知らなければ防げない。DOMPurifyのような、専門家が継続的にバイパスと修正を繰り返してきた実績あるライブラリを使うこと。

### この攻撃クラスの系譜：名前空間混同は繰り返す

Bentkowskiの2.0.17バイパスは孤立した事件ではない。**名前空間混同によるmXSS**は、DOMPurifyの歴史の中で繰り返し現れる主要な攻撃クラスであり、本セクションの技術的価値の核心もそこにある。代表的な系譜を挙げる。

- **2019年（SVG版・DOMPurify < 2.0.x）**: 次のようなSVGを起点とするmXSS。
  ```html
  <svg></p><style><a title="</style><img src onerror=alert(1)>">
  ```
  `<svg>` 内に予期せずHTMLの `<p>` が現れ、再パースで木が変わり、`<img>` がHTML名前空間で危険化する。原理は本CVEと同型（名前空間の境界と `<style>` のraw text挙動の悪用）。

- **2020年（MathML版・CVE-2020-26870・DOMPurify < 2.0.17）**: 本セクションのBentkowskiの手法。form/math/mtext/mglyph/style。

- **2020年以降（SVG版・DOMPurify < 2.2.2）**: Daniel Santos（vovohelo）による「From SVG and back, yet another mutation XSS via namespace confusion」。「SVGへ入って、また戻る」ことで名前空間を混同させる別角度のバイパス。`_checkValidNamespace` 導入後も、なお抜け道が残っていたことを示した。

これらに共通する防御原則は、PR #495以降DOMPurifyが確立した次の一文に集約される。

> **「サニタイザーは、ローカルなタグ名だけでなく、要素が実際に属する名前空間で評価しなければならない。」**

> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
> 出典: From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass（Daniel Santos） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f

### 参考：Michał Bentkowski の関連研究

本セクションの資料URL #2（bentkowski.info の研究インデックス）と #3（Securitum上のBentkowski記事群）は直接取得できなかったが、検索により彼の主要研究を再構成した。DOMPurifyやサニタイザーバイパス、プロトタイプ汚染に関心があれば、いずれも一級の教材である。

- **Mutation XSS via namespace confusion – DOMPurify < 2.0.17 bypass**（本セクションの主題、2020年）
- **DOMPurify 2.0.0 bypass using mutation XSS**（別のmXSSによる初期のDOMPurifyバイパス）
- **Prototype pollution and bypassing client-side HTML sanitizers**（プロトタイプ汚染〔JavaScriptのプロトタイプチェーンを汚染して既定挙動を書き換える攻撃〕を使い、DOMPurifyを含むクライアント側サニタイザーを破る研究。半自動的な悪用手法の探索も含む）
- **HTML sanitization bypass in Ruby Sanitize < 5.2.1**（Ruby製サニタイザーSanitizeのRELAXED構成を完全にバイパス、2020年）
- **XSS in GMail's AMP4Email via DOM Clobbering**（DOMクロバリングによるGmail AMP4EmailのXSS、Google VRP報告、2019年）
- **Exploiting prototype pollution for RCE in Kibana (CVE-2019-7609)**（プロトタイプ汚染からのリモートコード実行）
- **Marginwidth/marginheight を使ったクロスオリジン通信**、**CSS data exfiltration in Firefox**、**The Curious Case of Copy & Paste**、**`<portal>` 要素のセキュリティ分析** など。

Bentkowskiは2013年よりSecuritumに所属し、Webおよびモバイルアプリのセキュリティ診断・研究・トレーニングに従事している。講演「A word about DOMPurify bypasses a.k.a why DOM parsing is crazy（DOMPurifyバイパスの話、あるいはなぜDOMパースは狂っているのか）」は、本セクションのテーマそのものを扱っており必見である。

> 出典: Michał Bentkowski 研究インデックス — https://www.bentkowski.info/research/ （直接取得不可のため検索結果から再構成）
> 出典: Michał Bentkowski（Securitum 著者ページ） — https://research.securitum.com/authors/michal-bentkowski/ （直接取得不可のため検索結果から再構成）

### まとめ

- **CVE-2020-26870**は、DOMPurify < 2.0.17に対する **mutation XSS（mXSS）**であり、その手口は **MathMLの名前空間混同**だった。
- 攻撃の骨格は「**同じ文字列が、初回パースと再パースで別の名前空間に置かれ、`<style>` の中身が『テキスト』から『要素』へ化ける**」こと。ネストした `<form>` を「所有権変異ガジェット」に使い、`<mglyph>` の親を `mtext` に繰り上げることで、mglyph→styleの名前空間をHTML→MathMLへ変異させ、隠していた `<img onerror>` を再パース時に解凍する。
- ペイロード: `<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>`。
- 修正は **`_checkValidNamespace`（PR #495）**で、「各ノードを親の名前空間に照らして検証し、HTML名前空間の `mglyph` のような仕様違反要素を削除する」ことにより、変異の足場を除去した。
- 教訓は普遍的で、**サニタイザーはタグ名ではなく実際の名前空間で判断すべし**。そして名前空間混同は一度で終わらず、SVG版・MathML版と形を変えて繰り返し現れる「クラス」であるため、**ライブラリを最新に保ち、不要な外来コンテンツを許可しない**ことが実務上の要である。

---

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

---

## mXSS解説とチートシート（Sonar）

このセクションでは、セキュリティ企業 Sonar（旧 SonarSource）が公開した2つの資料 ―― 解説記事「mXSS: The Vulnerability Hiding in Your Code」と、GitHub 上の「SonarSource/mxss-cheatsheet（mXSS チートシート）」―― を軸に、**mXSS（Mutation XSS、変異型クロスサイトスクリプティング）** を体系的に学びます。反射型XSSのような「入力した文字列がそのまま実行される」タイプとは違い、mXSSは「サニタイズ（入力に含まれる危険な文字列を無害な形に変換・除去する処理）を通過した"安全に見える"文字列が、ブラウザによって再解釈される瞬間に危険なコードへ"変異（mutation）"する」という、より一段深い現象を扱います。ここが本セクション最大の学びどころです。

> ⚙️ **本セクションの資料取得に関する注記（透明性のため明記）**: 担当した2つの一次資料URL（`sonarsource.com` のブログ記事、および `github.com/SonarSource/mxss-cheatsheet`）は、いずれも本実行環境の**ネットワーク送出プロキシによる遮断**（sonarsource.com / sonarsource.github.io は egress ブロック、GitHub は当セッションのリポジトリ許可ポリシー外のためAPI・raw ともに 403/404）により、**直接取得できませんでした**。そのため本文は、Web検索で得られた各記事のスニペット・二次言及、および同一トピックを扱う権威ある二次資料（Michał Bentkowski / Securitum、Daniel Santos、cure53 DOMPurify Wiki、mXSS 原論文など）と執筆者の専門知識を統合して**復元・再構成**しています。厳密な原文照合が必要な場合は、末尾の各URLをご自身でご確認ください。該当箇所には規定の警告ブロックを挿入してあります。

---

### mXSS（Mutation XSS）とは何か ―― 核心の一文

mXSS の核心は次の一文に集約されます。

> **サニタイザ（無害化処理）の目には「ただのテキスト（raw text）」として映る文字列を、ブラウザに渡した瞬間に「HTMLタグ」として解釈させる方法を見つけること。**

- **通常のXSS**: 攻撃者の `<script>` や `onerror=` が、フィルタの不備を"すり抜けて"そのまま出力される。
- **mXSS**: 攻撃文字列はサニタイズの段階では**確かに無害**である（サニタイザは正しく仕事をしている）。ところがその「無害化済みHTML文字列」を**ブラウザが描画のために再びパース（構文解析）し直す**とき、HTMLパーサの"癖"によって文字列の構造が組み替えられ（＝mutation／変異）、結果として `<img onerror=...>` のような実行可能な要素が出現してしまう。

つまり mXSS は「フィルタのバグ」ではなく、**"サニタイザが見たDOMツリー" と "ブラウザが最終的に構築したDOMツリー" が食い違う** という、パーサ（構文解析器）の仕様レベルの落とし穴を突きます。ここでいう **DOM（Document Object Model、HTMLをブラウザがツリー構造として保持したもの）** が、同じ入力文字列から2回作られるのに一致しない、という点が本質です。

#### 歴史的経緯（なぜ「mutation」と呼ぶのか）

- **2007年**: Yosuke Hasegawa（長谷川陽介）氏が、Internet Explorer で `innerHTML`（要素の中身をHTML文字列として読み書きするプロパティ）を読み戻すと文字列が"勝手に書き換わる"挙動を最初に報告。これが mXSS の原点とされます。
- **2013年**: Mario Heiderich らの論文 *"mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations"*（ACM CCS 2013）が、この現象を体系化し **mXSS** と名付けました。論文は、当時広く使われていたサーバサイドのサニタイザ（HTML Purifier, kses, htmlLawed, Google Caja 等）、クライアント側フィルタ（旧 IE XSS Filter、Chrome XSS Auditor）、WAF、IDS/IPS のいずれもが mXSS ベクタで回避されうることを示し、大きな衝撃を与えました。

> 出典: mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations（Heiderich et al., ACM CCS 2013） — https://cure53.de/fp170.pdf
> 出典: mXSS（The Spanner, Gareth Heyes, 2014） — https://thespanner.co.uk/2014/05/06/mxss

---

### なぜ mutation が起きるのか ―― パーサ差分（parser differential）

Sonar の記事が繰り返し強調する mXSS の根本原因は **パーサ差分（parser differential / parser discrepancy）** です。これは「**同じHTML文字列を、別々のパーサに食わせると、違うDOMツリーが出来上がる**」現象を指します（parser differential ＝ パーサ同士の解釈のズレ）。

mXSS が成立する典型的な処理フローは次の通りです。

1. **サニタイズ段階**: アプリが受け取ったHTMLを、サニタイザ（例: サーバ側のライブラリ）のパーサでツリー化 → 危険な要素・属性を除去 → **文字列にシリアライズ（DOMツリーを再びHTML文字列に書き戻すこと）** して保存・送信する。
2. **描画段階**: そのHTML文字列を、ブラウザのパーサが**もう一度パース**してDOMを構築し、画面に表示する。

ここで鍵になるのが、**「シリアライズ → 再パース」というラウンドトリップが冪等（べきとう＝何回やっても同じ結果になる性質）ではない**という事実です。cure53 の DOMPurify Wiki は mXSS をずばり次のように定義しています。

> serialize（文字列化）してから parse（解析）し直しても、必ずしも元のDOMツリーには戻らない ―― この非対称性こそが mXSS の温床である。

Sonar 記事の重要な主張は、この差分の"避けられなさ"に関するものです。

- HTMLのパースは極めて複雑で、しかも配信先のパーサは1つではない（Firefox / Chrome / Safari …とエンジンごとに微妙に挙動が違う）。
- したがって **「HTMLを解析する場所」と「最終的に描画する場所」が異なる限り、パーサ差分を完全に無くすことは原理的に不可能**である。
- ゆえに **サーバサイドのサニタイザは構造的に mXSS に弱く**、**描画するのと同じブラウザ上で無害化するクライアントサイド・サニタイザ（DOMPurify など）** の方が、差分を最小化できるぶん安全性が高い。

これが Sonar の防御指針の理論的な背骨になっています（後述の「防御策」で具体化します）。

> 出典: mXSS: The Vulnerability Hiding in Your Code（Sonar） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/
> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

---

### ブラウザ HTMLパーサの再解釈メカニズム（原理編）

mXSS を"暗記"ではなく"理解"するには、**なぜ再パースで構造が変わるのか**をパーサの仕組みで押さえる必要があります。これが本教科書の価値の中心です。以下、mXSS を生む主要な5つのメカニズムを分解します。

#### 1. 名前空間（namespace）の切り替え ―― HTML / SVG / MathML

HTMLパーサは、DOMツリーの各要素に **名前空間（namespace）** という属性を割り当てます（namespace ＝ その要素がどの言語のルールで解釈されるかを示す"文法モード"）。名前空間は3種類あります。

- **HTML 名前空間**（既定）
- **SVG 名前空間**
- **MathML 名前空間**

既定では全要素が HTML 名前空間に置かれますが、パーサが `<svg>` に出会うと **SVG 名前空間へ切り替わり**、`<math>` に出会うと **MathML 名前空間へ切り替わります**。そして SVG と MathML の中身は **foreign content（外来コンテンツ＝HTML以外の文法で解釈される領域）** として扱われ、**通常のHTMLとは異なるパースルールが適用されます**。

この差が最もはっきり出るのが `<style>` 要素の扱いです。

| 文脈 | `<style>` の中身の扱い | 子要素を持てるか | HTMLエンティティのデコード |
|---|---|---|---|
| **HTML 名前空間** | raw text（テキストのみ。CSSとしてのみ扱う） | 持てない | されない |
| **foreign content（SVG/MathML内）** | 通常のHTMLとして解釈しうる | **子要素を持てる** | **デコードされる** |

攻撃者はこの差を突きます。**サニタイザが `<style>` の中身を「ただのテキスト」だと信じて素通しした要素が、名前空間が切り替わった再パース時に「本物のHTML要素（＝`<img onerror>` など）」として蘇る** ―― これが名前空間混同（namespace confusion）型 mXSS の骨格です。

> 出典: Mutation XSS via namespace confusion – DOMPurify +2.0.17 bypass（Michał Bentkowski / Securitum） — https://www.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass.html

#### 2. インテグレーションポイント（integration points）と mglyph / malignmark の罠

名前空間はどこでも自由に切り替わるわけではなく、**インテグレーションポイント（integration point、＝外来コンテンツの中に"HTMLの島"を作れる境界要素）** という特別な要素で HTML に戻れます。HTML標準（WHATWG）が定めるものは主に次の通りです。

- **MathML text integration points（MathMLテキスト統合点）**: `<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>` ―― これらの直下に置かれた要素は HTML 名前空間で解釈される。
- **HTML integration points（HTML統合点）**:
  - `<annotation-xml>` で **`encoding` 属性が `text/html` または `application/xhtml+xml`** の場合。
  - SVG の `<foreignObject>`、`<desc>`、`<title>`。

さらに厄介なのが **`<mglyph>` と `<malignmark>`** です。この2つは、**MathMLテキスト統合点の直下にあるときだけ MathML 名前空間に属する**（他の要素は既定でHTML名前空間になるのに対して例外的な挙動）。攻撃者は「HTML島の中にあるはずなのに、この2要素だけは MathML 側に引き戻される」というこの非対称性を使って、サニタイザの名前空間判定を欺きます。

`<annotation-xml>` の `encoding` の値ひとつで「中身をHTMLとして解釈するか、XML風の外来コンテンツとして解釈するか」が切り替わる点も、サニタイザと実ブラウザで判定がズレやすい古典的な mXSS ポイントです。

> 出典: `<annotation-xml> - MathML`（MDN） — https://developer.mozilla.org/en-US/docs/Web/MathML/Element/annotation-xml
> 出典: mXSS cheatsheet — Explained（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/explained/

#### 3. raw text 要素 / RCDATA 要素と「scripting フラグ」

HTMLには、中身をタグとして解釈せず**テキストとして丸ごと読み込む特別な要素**があります。挙動により2種類に分かれます。

- **raw text 要素**: `<style>`, `<script>`, `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`（中身はテキスト。HTMLエンティティのデコードもされない）
- **RCDATA 要素**: `<textarea>`, `<title>`（中身はテキストだが、HTMLエンティティ `&lt;` などは**デコードされる**）

問題は、これらの「テキストとして扱う範囲」がサニタイザと実ブラウザでズレると、閉じタグの位置がずれ、後続の文字列が"タグの外"に飛び出して実行可能要素になることです。

とりわけ有名なのが **`<noscript>`** の「scripting フラグ依存」挙動です。

- ブラウザの **`DOMParser` API**（文字列からDOMを作る仕組み。サニタイザ内部でよく使われる）で解析すると、**スクリプト無効**とみなされ、`<noscript>` の中身は **raw text（ただのテキスト）** として扱われる。
- ところが、その結果を実ページに挿入すると、実ページでは**スクリプト有効**なので、`<noscript>` の中身が **再びHTMLとして解釈・実行される**。

この「解析時はスクリプト無効／描画時はスクリプト有効」という文脈差が、`<noscript>` 系 mXSS（Firefox の CVE-2021-23974 が代表例）を生みます。同様に、`<template>` 要素もスクリプト有効/無効で中身のパースが変わる"パース非対称性の地雷"であり、特にサーバサイドでは避けるべき要素です。

> 出典: 1528997 - (CVE-2021-23974) mXSS: Potential XSS via noscript tags parsed by DOMParser APIs（Bugzilla@Mozilla） — https://bugzilla.mozilla.org/show_bug.cgi?id=1528997

#### 4. foster parenting（テーブルの"里子出し"）

`<table>` 系の要素は、HTMLパースの中でも特に癖の強い**独自のパース状態**を持ちます。テーブルの中に置いてはいけない要素（例: `<a>` や `<div>`）が現れると、パーサはそれを**テーブルの直前へ勝手に移動**させます。この現象を **foster parenting（里子出し）** と呼びます。

```
入力:  <table><a>x</table>
再構築後: <a>x</a><table></table>   ← <a> がテーブルの外へ"追い出される"
```

攻撃者は、サニタイズ時には「テーブルの中の無害な位置」にあった要素を、再パース時の里子出しによって**別の文脈（例えば `<style>` の外）へ移動させ**、実行可能な位置に運びます。`<table>` を `<mglyph>` や `<svg>` と組み合わせると、**2回目の再パースを経ても変異が持続する**強力なペイロードが作れることが知られています。

> 出典: mXSS cheatsheet（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/

#### 5. HTMLエンティティのデコード差分 と 属性の再解釈

- **エンティティ・デコード差分**: 前述の通り、同じ `<style>` でも名前空間により `&lt;` を `<` に戻すかどうかが変わります。RCDATA 要素（`<textarea>`, `<title>`）でもデコードが起きます。「サニタイザは `&lt;img ...&gt;`（無害なテキスト）と見なしたが、再パースの文脈ではデコードされて `<img ...>`（本物のタグ）になった」という典型パターンを生みます。
- **属性の再解釈（backtick 等）**: 歴史的には、Hasegawa 氏が発見した「バッククォート `` ` `` を含む属性」の癖が有名です。IE は `alt=\`\`onerror=alert(1)` のようにバッククォートで囲まれた属性値を再シリアライズする際に引用符を落とし、`onerror` が独立した属性として復活してしまいました。属性値のクォート（引用符）の付け外しがサニタイザと実装でズレると、属性境界が壊れて新たなイベントハンドラ属性が生まれます。

> 出典: mXSS Attacks（Heiderich et al., 2013） — https://cure53.de/fp170.pdf
> 出典: [mXSS] Consider making HTML parsing of `style`, `script`, `xmp` etc consistent between SVG, MathML, HTML（whatwg/html #11397） — https://github.com/whatwg/html/issues/11397

---

### 一次資料①: Sonar「mXSS: The Vulnerability Hiding in Your Code」

> ⚠️ **未取得の資料**: 「mXSS: The Vulnerability Hiding in Your Code（Sonar）」は自動取得できませんでした（理由: `sonarsource.com` が本環境のネットワーク送出プロキシで egress ブロックされているため。WebFetch/curl とも接続不可）。以下のURLからユーザーご自身で直接ご覧ください: https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/

（以下は取得できなかった資料の補足として、Web検索で得た当記事のスニペット・二次言及と一般的な知識に基づく再構成解説です。）

Sonar のこの記事は、mXSS を「あなたのコードに潜む脆弱性」として、実在のバグ事例を交えて解説する啓発記事です。要点は以下の通りです。

#### mXSS の定義（記事の表現）

> mXSS は、HTMLの"寛容さ"（malformed／壊れたマークアップも受け入れて自動修正する性質）を悪用する。ペイロードはサニタイズ中は無害に見えるが、ブラウザが描画のために再パースした瞬間、悪意あるコードへと変異する。

#### mXSS の4つのサブカテゴリへの分類

記事は「mXSS」という総称を、理解のために **4つのサブカテゴリに分割**して整理しています（検索結果から、分類の存在と観点は確認できましたが、4カテゴリの正式名称の一字一句までは一次原文照合ができていません。観点は概ね次の軸に対応します）。

1. **名前空間の混同（namespace confusion）**: SVG/MathML への切り替えと foreign content による `<style>` 等の解釈変化を突くもの（本セクション原理編の①②）。
2. **文脈/コンテキストの移動**: 再パース時に要素が text content・属性値・コメントの"外"へ飛び出して実行可能位置に移るもの（③④⑤）。
3. **raw text / 特殊要素の解釈差**: `<noscript>`・`<template>`・`<textarea>` などスクリプトフラグや文脈でパースが変わる要素を突くもの。
4. **エンティティ・属性の変異**: デコード差分や属性境界の再構成を突くもの。

> ⚠️ 上記4分類の名称は再構成です。正確な区分は原文をご確認ください（URLは上記警告ブロック参照）。

#### 実在事例（記事の核）

記事の説得力は、Sonar 自身が発見した実在の脆弱性に裏打ちされています。

- **Skiff（プライバシー重視Webメール）**: サニタイズ時に `<style>` が **SVGルールで**パースされ、再パース時に **HTMLルールで**パースされる差を突いて、`<img>` 要素をDOMに挿入し `onerror` を発火させる mXSS。Proton Mail の脆弱性で使ったのとよく似たペイロードで、Skiff のサニタイズ処理を回避できた。Webメールは Electron（ChromiumをデスクトップアプリにするフレームワークでNode.js権限を持つ）で動くことも多く、**サニタイザのパーサとレンダラ（Electron）のパーサの差分**が致命傷になりうる。
- **Joplin（ノートアプリ、CVE-2023-33726）**: サニタイズ回避（mXSS を含む攻撃チェーン）が最終的に**任意コマンド実行（RCE）**にまで至った。mXSS が単なる「アラートを出す遊び」ではなく、デスクトップアプリでは OS レベルの侵害に直結しうることを示す事例。

#### 記事の結論・防御の推奨

- **クライアントサイドのサニタイザ（DOMPurify 等）を使うこと。** 描画するのと同じブラウザ上で無害化すればパーサ差分のリスクを避けられる。逆にサーバサイドのサニタイザは、配信先ブラウザの多様さゆえに差分を排除できず**構造的に失敗しやすい**。
- **サニタイズ後にHTMLを再加工・再パースしないこと（desanitization の回避）。** サニタイズ済みの文字列にアプリが後から手を加える（文字列連結・再パース・別ライブラリ通過など）と、無害化が台無しになり注入ベクタが復活しうる。
- 目的は「開発者と研究者が、この問題に自信を持って対処できるように武装させること」だと記事は締めくくっている。

> 出典: mXSS: The Vulnerability Hiding in Your Code（Sonar） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/
> 出典: Code Vulnerabilities Put Skiff Emails at Risk（Sonar） — https://www.sonarsource.com/blog/code-vulnerabilities-put-skiff-emails-at-risk
> 出典（二次言及）: mXSS: The Vulnerability Hiding in Your Code（Security Boulevard 転載） — https://securityboulevard.com/2024/05/mxss-the-vulnerability-hiding-in-your-code/

---

### 一次資料②: SonarSource mXSS チートシート

> ⚠️ **未取得の資料**: 「SonarSource mXSS チートシート（github.com/SonarSource/mxss-cheatsheet）」は自動取得できませんでした（理由: 当セッションの GitHub アクセスは許可リポジトリのみに制限されており、当リポジトリは対象外のため API・raw・blob いずれも 403/404。ミラーの `sonarsource.github.io` も egress ブロック）。以下のURLからユーザーご自身で直接ご覧ください: https://github.com/SonarSource/mxss-cheatsheet （ミラー: https://sonarsource.github.io/mxss-cheatsheet/ ）

（以下は取得できなかった資料の補足として、Web検索で得たリポジトリ説明・各ページのスニペットと一般的な知識に基づく再構成解説です。）

#### チートシートの位置づけと構成

リポジトリ説明文（検索で取得）は次の通りです。

> "This repository is a one-stop shop for diving deep into the fascinating world of mXSS (mutations caused by browser quirks in HTML parsing), providing a curated list of examples that showcase unexpected HTML behaviors."
> （＝ブラウザのHTMLパース時の癖が引き起こす mutation を深掘りするためのワンストップ資料。予期しないHTML挙動の実例を厳選して収録。）

主なファイル/ページ構成:

- **`explained.md`（mXSS Explained）**: 理論編。mXSS の定義と、なぜ mutation が起きるかを分類とともに解説。
- **`examples.md`（Payload examples）**: 実践編。過去にサニタイザ回避に使われた**新規ベクタ/新技法を含むペイロードだけを厳選**して収録（既知の焼き直しは除外）。
- **`tools`**: mXSS を試す/確認するためのツール類（`livedom.lab.xss.academy` のような、入力HTMLがブラウザでどう再解釈されるかを可視化する DOM ビューワなど）。
- GitHub Pages 版（`sonarsource.github.io/mxss-cheatsheet/`）で読みやすく公開。

#### チートシートが採る分類（parser 再解釈の分類）

`explained.md` は mXSS を「パーサの再解釈がどこで起きるか」で整理しています（検索スニペットから復元）。

1. **Parser Discrepancies（パーサの不一致）**: そもそもの根本原因。サニタイザのパースアルゴリズムと、レンダラ（ブラウザ）のパースアルゴリズムのミスマッチ。
2. **Namespace and Context Issues（名前空間と文脈の問題）**: サニタイズ時はある名前空間で安全に見えた要素が、ブラウザの2回目のパースで別の名前空間へ移り、text content・属性値・コメントの"外"へ飛び出して変異する。
3. **Raw Text Elements（raw text 要素）**: `<noscript>` のようにスクリプト有効/無効で解釈が変わる要素。本文の解釈規則が文脈依存で変化する。

このチートシートの発想の中核は、繰り返しになりますが「**サニタイザには raw text（テキスト）として見え、ブラウザには HTML として解釈される文字列を作る**」ことにあります。

> 出典: SonarSource/mxss-cheatsheet（README / explained） — https://github.com/SonarSource/mxss-cheatsheet
> 出典: mXSS Explained（GitHub Pages ミラー） — https://sonarsource.github.io/mxss-cheatsheet/explained/

---

### 代表的なペイロード集（チートシート・二次資料からの再現）

以下は、チートシートおよび権威ある二次資料の検索スニペットから再現した代表的 mXSS ペイロードです。各ペイロードには **「なぜ動くのか」** を必ず添えます。実運用での検証時は、対象ブラウザ・対象サニタイザのバージョンで挙動が変わるため、必ず原典と実機でご確認ください。

#### 例1: 古典 ―― `<listing>` / エンティティ・デコード（IE時代の原点）

```html
<listing>&lt;img src=1 onerror=alert(1)&gt;</listing>
```

- **なぜ動くのか**: 攻撃者は一見「エスケープ済みの安全なテキスト」`&lt;img ...&gt;` を渡している。しかし当時の IE は `<listing>`（古い整形済みテキスト要素）の `innerHTML` を読み戻すときにエンティティを `<`/`>` へデコードしてしまい、返り値が `<img src=1 onerror=alert(1)>` という**本物のタグ**に変異した。文字列を再取得・再挿入するコードがあると、この変異した本物のタグが実行される。mXSS の"原点"となった挙動。

> 出典: mXSS Attacks（Heiderich et al., 2013） — https://cure53.de/fp170.pdf

#### 例2: `<noscript>` × `DOMParser`（scripting フラグ依存）

```html
<noscript><p title="</noscript><img src=x onerror=alert(1)>">
```

- **なぜ動くのか**: サニタイザ内部の `DOMParser` はスクリプト無効とみなすため、`<noscript>` の中身を raw text として扱い、`</noscript>` までを"ただのテキスト"だと判断して素通しする。ところが実ページはスクリプト有効なので、同じ文字列を再パースすると `<noscript>` の中身が**HTMLとして再解釈**され、`<img onerror>` が本物の要素として出現・発火する。Firefox の CVE-2021-23974 が実例。

> 出典: CVE-2021-23974（Bugzilla@Mozilla） — https://bugzilla.mozilla.org/show_bug.cgi?id=1528997

#### 例3: MathML `<mglyph>` + `<style>`（名前空間による style 解釈差）

```html
<math><mtext><table><mglyph><style><img src="x" onerror="alert(1)"></style></mglyph></table></mtext></math>
```

- **なぜ動くのか**: `<mtext>` は MathMLテキスト統合点。`<mglyph>` はその直下にあるとき MathML 名前空間に留まる特殊要素。この文脈での `<style>` は foreign content の style となり、サニタイザ側では「`<style>` の中身は raw text」だと判断して `<img onerror>` を無害なテキスト扱いで残す。ところが `<table>` の foster parenting（里子出し）や名前空間の再解決を経て再パースすると、`<img>` が `<style>` の"外"の HTML 要素として実体化し、`onerror` が発火する。「style の中に隠したタグを、再パースで style の外へ運び出す」典型。

> 出典: mXSS cheatsheet（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/examples/

#### 例4: DOMPurify < 2.0.17 名前空間混同（Michał Bentkowski）

```html
<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">
```

- **なぜ動くのか**: `<form>` の入れ子と MathML/SVG の名前空間切り替えを組み合わせ、DOMPurify のパースと実ブラウザのパースで **`<style>` の閉じ位置と要素の所属名前空間がズレる**ように仕組む。DOMPurify（2.0.17 未満）は `<style>` の中身 `</style><img onerror=alert(1) src>` を raw text として安全と判断するが、シリアライズ→再パースの過程で `</style>` が本物の閉じタグとして効き、続く `<img onerror>` が独立したHTML要素として蘇る。修正では「要素が本当に正しい名前空間にあるか、親要素の名前空間を辿って検証する」対策が導入された（Bentkowski の提案が採用）。

> 出典: Mutation XSS via namespace confusion – DOMPurify +2.0.17 bypass（Michał Bentkowski / Securitum） — https://www.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass.html
> 出典: Jak pomogłem zabezpieczyć DOMPurify（Sekurak, Bentkowski） — https://sekurak.pl/jak-pomoglem-zabezpieczyc-dompurify/

#### 例5: DOMPurify < 2.2.2 「From SVG and back」（Daniel Santos）

```html
<svg></p><textarea><title><style></textarea><img src=x onerror=alert(1)></style></title></svg>
```

- **なぜ動くのか**: `<svg>` で SVG 名前空間に入ると、`<style>` の子孫は（HTML名前空間の同名要素＝homograph と異なり）**通常のHTMLとして描画されうる**。SVG の `<path>` の `id` 属性のような"自由記述の安全なテキスト"に見える箇所へ攻撃コードを潜ませ、SVG から HTML へ"戻る（back）"境界の解釈差で `<img onerror>` を実体化させる。`</p>` や `<textarea>`/`<title>`（RCDATA要素）を挟んでパース状態を意図的にずらしているのがポイント。DOMPurify 2.2.2 で修正。

> 出典: From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass（Daniel Santos / vovohelo） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f

#### 例6: `<foreignObject>` × テーブル × コメント breakout

```html
<svg><a><foreignobject><a><table><a></table><style><!--</style></svg><a id="-><img src onerror=alert(1)>">
```

- **なぜ動くのか**: `<foreignObject>` は HTML統合点なので、その内部でHTML島が作られる。`<table>` の foster parenting、`<style>` の raw text 解釈、HTMLコメント `<!-- -->` の閉じ位置解釈を重ね合わせ、サニタイザには「コメント/スタイル内の無害な文字列」に見えるものを、再パース時に `id="...">` の属性境界を破って `<img onerror>` として外へ出す。**複数のパース癖を"直列"に積み上げて差分を最大化する**、チートシート上級ベクタの典型。

> 出典: mXSS cheatsheet — Payload examples（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/examples/

---

### DOMPurify バイパスの歴史とバージョン依存（陳腐化への注意）

mXSS ペイロードは**サニタイザのバージョンに強く依存**します。「どのバージョンで何が直ったか」を押さえないと、古い攻撃を最新版に撃って外したり、逆に古い依存を使い続けて被弾したりします。以下は DOMPurify（最も広く使われるクライアントサイド・サニタイザ）の主要な mXSS 関連バイパスと修正の時系列です（公開年・対象バージョンを明記）。

| 時期 | バイパスの種類 | 影響バージョン | 修正バージョン | 備考 |
|---|---|---|---|---|
| 2020 | MathML 名前空間混同（Bentkowski, 例4） | < 2.0.17 | **2.0.17** | 親名前空間の検証を導入 |
| 2020 | SVG 名前空間混同「From SVG and back」（Santos, 例5） | < 2.2.2 | **2.2.2** | SVG→HTML 境界の解釈差 |
| 2020–2021 | 追加の名前空間/mglyph 系（2.2.x で継続的に修正） | 2.2.x 系 | 2.2.3 / 2.2.4 / 2.2.6 ほか | いたちごっこが続いた時期 |
| 2024公開 | **ネスト（入れ子）ベース mXSS**（CVE-2024-47875） | 修正前の全般 | **2.5.0 / 3.1.3** | 深い入れ子で再パース挙動が発散。**最大ネスト深さ ≈500** の上限を 3.1.1 で導入し対策 |
| 2025公開 | **テンプレートリテラル正規表現の不備**（CVE-2025-26791） | < 3.2.4（`SAFE_FOR_TEMPLATES: true` 時） | **3.2.4** | 誤った正規表現で mXSS |
| 2025公開 | **`<textarea>` raw text 検証漏れ**（`SAFE_FOR_XML`、CVE-2025-15599） | 3.1.3–3.2.6 / 2.5.3–2.5.8 | **3.2.7**（3.x 系）。**2.x 系は未修正のまま** | 2.x を使い続けるのは危険 |
| 2026公開 | **プロトタイプ汚染 → カスタム要素処理のフォールバック経由 XSS**（CVE-2026-41238 ほか） | 該当版 | 以降のリリースで対応 | `CUSTOM_ELEMENT_HANDLING` 起点 |

**バージョン依存に関する実務上の教訓（重要）**:

- **常に最新の DOMPurify（本稿執筆時点で 3.4.x 系）へ更新する。** mXSS 修正は"追いつき"の連続であり、古い版に固定するとその後に発見された回避に必ず晒される。
- **2.x 系は一部 CVE（例: CVE-2025-15599）が未修正のまま**。2.x を継続利用しているプロジェクトは 3.x への移行を検討すべき。
- **非デフォルト設定は攻撃面を広げる**。`SAFE_FOR_TEMPLATES`（CVE-2025-26791）や `SAFE_FOR_XML`／`CUSTOM_ELEMENT_HANDLING`（CVE-2025-15599 / CVE-2026-41238）のように、既定から外れたオプションが新たなバイパスの入口になった例が複数ある。**必要のないオプションは有効化しない。**

> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
> 出典: CVE-2024-47875（Nesting-based mXSS） — https://osv.dev/vulnerability/CVE-2024-47875
> 出典: CVE-2025-26791（template literal regex mXSS, fixed 3.2.4） — https://security.snyk.io/vuln/SNYK-JS-DOMPURIFY-8722251
> 出典: DOMPurify XSS via Textarea Rawtext Bypass in SAFE_FOR_XML（CVE-2025-15599, fixed 3.2.7） — https://www.vulncheck.com/advisories/dompurify-xss-via-textarea-rawtext-bypass-in-safe-for-xml
> 出典: CVE-2026-41238（Prototype Pollution to XSS via CUSTOM_ELEMENT_HANDLING） — https://github.com/advisories/GHSA-v9jr-rg53-9pgp

---

### 防御策のまとめ

mXSS への対策は「サニタイザを信じきる」ことではなく、「**パーサ差分が生まれないように処理フロー全体を設計する**」ことです。

1. **クライアントサイド・サニタイザ（DOMPurify）を、描画する場所と同じブラウザで使う。** サーバサイドのサニタイズは配信先ブラウザの多様さゆえに差分を排除できず、mXSS に構造的に弱い（Sonar の中心的主張）。どうしてもサーバ側で無害化する場合でも、クライアント側で最終防衛のサニタイズを重ねる。
2. **サニタイズ後にHTMLを一切再加工しない（desanitization の回避）。** サニタイズ済み文字列の連結・再パース・別ライブラリへの再投入は、無害化を無効化しうる。「サニタイズは最終工程」を原則にする。
3. **サニタイザを常に最新へ保つ。** mXSS 修正はバージョンで積み上がる。依存の自動更新（Dependabot / Renovate 等）と、既知 CVE のバージョン確認を運用に組み込む。非デフォルト・オプションは必要最小限に。
4. **多層防御を敷く**:
   - **CSP（Content Security Policy、実行可能なスクリプトの出所をブラウザ側で制限する仕組み）** を設定し、万一 mutation で `<script>`/`onerror` が生まれても実行を止める（`script-src` の厳格化、`'unsafe-inline'` の排除、nonce/hash 方式）。
   - **Trusted Types**（DOM の危険な sink（＝ユーザー入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`）への文字列代入を、検証済みの型でしか許さないブラウザ機構）を導入し、`innerHTML` 直代入を排除する。
5. **危険な要素を避ける設計**: `<template>` や `<noscript>` はスクリプトフラグ依存でパースが変わる"パース非対称性の地雷"。特にサーバサイド処理では扱わない。ユーザーHTMLに SVG/MathML を許可する必要がなければ許可タグから外す。
6. **名前空間を意識した検証**: 自前でサニタイズを実装する場合は「要素がどの名前空間に属するか」を親要素まで辿って確認する（DOMPurify が 2.0.17 で採った対策と同じ発想）。

なお、WHATWG では `<style>`/`<script>`/`<xmp>` 等のパースを SVG・MathML・HTML の間で**一貫させる**提案（whatwg/html #11397）が議論されており、将来的にはブラウザ標準の側から mXSS の温床が減っていく可能性があります。とはいえ現時点では、上記の"差分を作らない設計"が現実的な防御です。

> 出典: mXSS: The Vulnerability Hiding in Your Code（Sonar, 防御指針） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/
> 出典: [mXSS] Consider making HTML parsing consistent between SVG, MathML, HTML（whatwg/html #11397） — https://github.com/whatwg/html/issues/11397

---

### このセクションの要点（まとめ）

- mXSS の核心は **「サニタイザの目には raw text、ブラウザの目には HTML」** となる文字列を作ること。バグではなく**パーサ差分（parser differential）**という仕様レベルの落とし穴を突く。
- 変異を生む主因は **名前空間切り替え（HTML/SVG/MathML）・インテグレーションポイント・raw text/scripting フラグ・foster parenting・エンティティ/属性の再解釈** の5つ。
- Sonar は実在事例（Skiff, Proton Mail, Joplin=RCE）で mXSS の実害を示し、**クライアントサイド・サニタイズ＋サニタイズ後に再加工しない**ことを推奨する。
- SonarSource mXSS チートシートは **parser 再解釈の分類（Parser Discrepancies / Namespace & Context / Raw Text Elements）** に沿って、新規ベクタを厳選収録した実務資料。
- ペイロードは**サニタイザのバージョンに強く依存**する。DOMPurify は 2.0.17 → 2.2.2 →（CVE-2024-47875）2.5.0/3.1.3 →（CVE-2025-26791）3.2.4 →（CVE-2025-15599）3.2.7 …と修正を重ねており、**常に最新版**を使うことが最重要。

---

### 出典一覧

**担当した一次資料（いずれも直接取得は環境制約で不可。上記各所に警告ブロックを明記）**

- mXSS: The Vulnerability Hiding in Your Code（Sonar） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/
- SonarSource / mxss-cheatsheet（GitHub） — https://github.com/SonarSource/mxss-cheatsheet （ミラー: https://sonarsource.github.io/mxss-cheatsheet/ ／ explained: https://sonarsource.github.io/mxss-cheatsheet/explained/ ／ examples: https://sonarsource.github.io/mxss-cheatsheet/examples/ ）

**内容の復元・裏付けに用いた二次資料**

- Code Vulnerabilities Put Skiff Emails at Risk（Sonar） — https://www.sonarsource.com/blog/code-vulnerabilities-put-skiff-emails-at-risk
- mXSS: The Vulnerability Hiding in Your Code（Security Boulevard 転載） — https://securityboulevard.com/2024/05/mxss-the-vulnerability-hiding-in-your-code/
- Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
- Mutation XSS via namespace confusion – DOMPurify +2.0.17 bypass（Michał Bentkowski / Securitum） — https://www.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass.html
- From SVG and back … DOMPurify < 2.2.2 bypass（Daniel Santos / vovohelo） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f
- mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations（Heiderich et al., ACM CCS 2013） — https://cure53.de/fp170.pdf
- CVE-2021-23974 mXSS via noscript / DOMParser（Bugzilla@Mozilla） — https://bugzilla.mozilla.org/show_bug.cgi?id=1528997
- CVE-2024-47875 Nesting-based mXSS（OSV） — https://osv.dev/vulnerability/CVE-2024-47875
- CVE-2025-26791 template literal regex mXSS（Snyk） — https://security.snyk.io/vuln/SNYK-JS-DOMPURIFY-8722251
- CVE-2025-15599 Textarea Rawtext Bypass in SAFE_FOR_XML（VulnCheck） — https://www.vulncheck.com/advisories/dompurify-xss-via-textarea-rawtext-bypass-in-safe-for-xml
- CVE-2026-41238 Prototype Pollution → XSS via CUSTOM_ELEMENT_HANDLING（GitHub Advisory） — https://github.com/advisories/GHSA-v9jr-rg53-9pgp
- `<annotation-xml>`（MDN） — https://developer.mozilla.org/en-US/docs/Web/MathML/Element/annotation-xml
- whatwg/html #11397（style/script/xmp のパース一貫化提案） — https://github.com/whatwg/html/issues/11397
- MXSS Evolution and Timeline: A primer to MXSS（s1r1us） — https://s1r1us.ninja/posts/mxss-101/

---

（前章: [第3章 DOMベースXSS](./03-dom-xss.md)　｜　次章: 第5章以降は未生成　｜　[目次](./README.md)）
