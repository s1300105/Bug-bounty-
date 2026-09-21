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
