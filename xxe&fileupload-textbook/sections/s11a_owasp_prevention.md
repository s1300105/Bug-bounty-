## OWASP XXE防御チートシート

XXE（XML External Entity injection、XML外部エンティティインジェクション）は、外部からの入力を受け付けるXMLパーサが**弱い設定**のまま動いているときに成立する。攻撃者が細工したXML文書を送り込み、パーサに「外部の実体（エンティティ）」を解決させることで、ローカルファイルの読み取り、SSRF（Server Side Request Forgery、サーバーに攻撃者が指定した先へリクエストを送らせる攻撃）、ポートスキャン、サービス拒否（DoS）などを引き起こす。CWE-611として分類され、かつてはOWASP Top 10 2017のA4項目でもあった。

本節はOWASP CheatSheetSeriesの「XML External Entity Prevention Cheat Sheet」を原典として、言語・パーサ別の具体的な防御設定を整理する。前章までで攻撃手法（DTD、外部/パラメータエンティティ、OOB、SVG/Office経由など）を扱っているので、ここでは「なぜその設定で防げるのか」という**パーサ内部の挙動**に焦点を当てる。

> 出典: XML External Entity Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html
> 出典: OWASP CheatSheetSeries GitHub（原文） — https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.md

### 1. 根本原則:DTDを丸ごと無効化する

チートシートが最初に掲げる原則は極めて明快である。

> **「XXEを防ぐもっとも安全な方法は、常にDTD（外部エンティティ）を完全に無効化することである。」**

```java
factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
```

なぜこれが最善手なのか。XXEもBillion Laughs攻撃（DoSの一種で、入れ子のエンティティ参照が指数関数的に展開されてメモリを食い潰す攻撃）も、根っこは同じ「DOCTYPE宣言によってパーサに実体定義を許してしまうこと」にある。DOCTYPE自体を拒否すれば、`<!ENTITY ...>`を書く余地そのものが消えるので、外部エンティティ経由の攻撃も内部エンティティの再帰展開も同時に塞げる。裏を返せば、個別の「外部エンティティだけ無効化」という設定は、実装によっては漏れが残りやすく、DOCTYPE自体の禁止より一段弱い対策になる。

もしDTDを完全禁止できない事情がある（内部DTDでのバリデーションが業務要件、など）場合は、パーサごとに「外部エンティティ」「外部DTDロード」を個別に無効化する必要がある。

### 2. セキュリティ機能マトリクスと「欠けたときに何が起きるか」

原典は次の7項目を最小限の硬化ルールとして挙げている。

- DOCTYPE宣言の禁止
- 外部エンティティの無効化
- 外部DTDロードの無効化
- secure processingモードの有効化
- パラメータエンティティ(`%entity;`という記法で、外部DTD内で使われる特殊なエンティティ)の無効化
- XInclude(別のXML/ファイルの内容を現在の文書に取り込む仕組み)の無効化
- エンティティ展開回数の制限
- レガシーなXMLパーサを使わない
- 未検証のXMLをデフォルト設定のまま処理しない

これらが「無い」場合に何が起きるかを整理すると次のようになる。

| 欠けている制御 | 結果として生じる脆弱性 |
| --- | --- |
| DOCTYPE無効化なし | 古典的なXXEペイロードがそのまま機能する |
| 外部エンティティ有効 | SSRF、ファイル漏洩、ポートスキャン |
| 外部DTDロード許可 | Blind XXE(レスポンスに結果が直接現れないタイプのXXE)→隠れたSSRF |
| 展開回数の制限なし | Billion Laughs DoS |
| XInclude有効 | `file://`経由のローカルファイル開示とSSRF |
| secure processing無効 | 重要な保護機構がまとめてバイパスされる |
| スキーマ検証が外部URLを取得してしまう | 意図しない外部への通信が発生する |

ここで実務的に重要なのは、「XMLパーサの安全性は単一のフラグでは決まらない」という点である。DOCTYPE、外部エンティティ、外部DTD、XInclude、展開制限は独立した設定項目であり、いずれか一つが漏れていれば攻撃経路は残る。後述のJavaの例で顕著だが、「3つセットで初めて安全」という組み合わせもあるため、チェックリスト的に網羅する必要がある。

### 3. C/C++: libxml2 / libxerces-c

#### libxml2

`xmlParserOption`という列挙型のオプションに以下を**設定しない**ことが条件になる。

- `XML_PARSE_NOENT`: エンティティを展開し、置換テキストに置き換える
- `XML_PARSE_DTDLOAD`: 外部DTDをロードする

これらのフラグを渡すAPI(`xmlCtxtReadDoc`、`xmlReadFile`、`xmlReadMemory`など多数)を使っている箇所を洗い出し、両フラグが立っていないか確認する必要がある。

重要な時期的事実として、**libxml2バージョン2.9以降ではXXEはデフォルトで無効化されている**(2012年10月のパッチによる)。したがって、古いlibxml2(2.9未満)にリンクされたアプリケーションは、明示的な設定なしでも脆弱になりうる。依存ライブラリのバージョンを必ず確認すること。

#### libxerces-c

```cpp
XercesDOMParser *parser = new XercesDOMParser;
parser->setCreateEntityReferenceNodes(true);
parser->setDisableDefaultEntityResolution(true);
```

```cpp
SAXParser* parser = new SAXParser;
parser->setDisableDefaultEntityResolution(true);
```

```cpp
SAX2XMLReader* reader = XMLReaderFactory::createXMLReader();
parser->setFeature(XMLUni::fgXercesDisableDefaultEntityResolution, true);
```

`setDisableDefaultEntityResolution(true)`は、パーサ組み込みのデフォルトエンティティ解決器(未設定時に外部リソースへ実際にアクセスしてしまう解決器)を無効にし、エンティティ解決をアプリケーション側の制御下に置く。設定しなければ、DOMParser/SAXParser/SAX2XMLReaderのいずれも既定の解決器が外部参照を素直に辿ってしまう。

### 4. Java: 構造的に厄介な二つの理由

Javaのxxe対策が他言語より複雑になるのには構造的な理由が二つある。

1. **パーサの実体は実行時(デプロイ時)に決まる。** JAXP(Java API for XML Processing)のファクトリはプラガブルであり、`newInstance()`が実際に返す実装はクラスパス次第である。コード上は同じ`DocumentBuilderFactory.newInstance()`でも、本番環境でApache Xercesが使われるかJDK組み込みパーサが使われるかはコードからはわからない。
2. **ほとんどのセキュリティ設定は「任意」である。** 外部エンティティ解決を無効化する多くのfeatureはオプション扱いであり、パーサがそれを認識しなければ例外を投げるだけで、設定は反映されない。その例外を`catch`して握りつぶすコードが多く見られるが、それは「硬化されないまま未検証XMLを処理する」状態を意味する。一方で、**リゾルバ(resolver)フックだけは全実装が必ずサポートする**という違いがある。

```java
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
final DocumentBuilder builder;
try {
    // 下表のboolean feature
    dbf.setFeature(feature, safeFeatureValue);
    // 下表のString attribute
    dbf.setAttribute(attribute, safeAttributeValue);
    builder = dbf.newDocumentBuilder();
} catch (ParserConfigurationException | IllegalArgumentException e) {
    // パーサが設定を認識しなかった = 硬化が適用されなかった
    // 設定できないファクトリのまま処理を続けず、パースを拒否する
    throw new IllegalStateException("Unable to secure the XML parser", e);
}
```

このコードの要点は「例外を握りつぶさない」ことである。安全側に倒すなら、設定が通らなかった時点でパースそのものを止めるべきという設計思想が示されている。

#### 4.1 リゾルバ(Resolver)方式を優先する

JAXPには外部コンテンツの取得を止める方法が2つある。**リゾルバ**と**フィーチャ**であり、全実装での動作が保証されているのはリゾルバの方だけである。

```java
// nullを返してはいけない。nullはパーサ自身に解決させる意味になる。
EntityResolver denyAll = (publicId, systemId) -> {
    throw new SAXException("External references are not allowed: " + systemId);
};

// どちらのファクトリもリゾルバを保持しないので、生成したオブジェクトごとに設定する
DocumentBuilder builder = ...;
builder.setEntityResolver(denyAll);

XMLReader reader = ...;
reader.setEntityResolver(denyAll);
```

StAX(Streaming API for XML)向けには`XMLResolver`を使う。

```java
XMLResolver denyAll = (publicId, systemId, baseURI, namespace) -> {
    throw new XMLStreamException("External references are not allowed: " + systemId);
};

// DOM/SAXと違い、StAXのファクトリは自身のリゾルバを生成した全readerに引き継ぐ
XMLInputFactory xmlInputFactory = ...;
xmlInputFactory.setProperty(XMLInputFactory.RESOLVER, denyAll);
```

ここに落とし穴がある。`XMLResolver`は決められた型(Javadocが列挙する型)のいずれかを返さなければならず、それ以外は未定義動作として`null`扱いされる可能性がある。「何も返さない」つもりで空文字列を返すと、逆にプロセッサが自分でエンティティを解決してしまう。空を返したいときは`InputStream.nullInputStream()`を使うこと。

**リゾルバはエンティティ展開の回数までは制限しない。** 入れ子の内部エンティティは外部リソースを必要としないため、DOCTYPE宣言を受け付けるパーサはリゾルバを設定していてもBillion Laughs型の展開攻撃には引き続き晒される。展開回数の制限には`FEATURE_SECURE_PROCESSING`を有効にする必要がある。

#### 4.2 DOM: DocumentBuilderFactory

DOMには保守されている実装が複数ある(Apache Xerces、JDK組み込み(Xerces派生)、Android組み込み(kXMLベース)、Oracle XDK)。それぞれ認識する設定が異なる。

| 設定 | 安全な値 | 認識する実装 | 効果 |
| --- | --- | --- | --- |
| `jdk.xml.dtd.support` | `deny`または`ignore` | JDK組み込みパーサ(Java 22+) | DOM/SAX/StAX/検証/変換すべてでDTDを拒否または無視 |
| `disallow-doctype-decl` | `true` | Xercesおよび派生 | DOCTYPEを含む文書を丸ごと拒否 |
| `ACCESS_EXTERNAL_DTD` | `""`(空文字) | JDK組み込みパーサ(7u40+) | 外部DTDと外部エンティティ参照を拒否 |
| `ACCESS_EXTERNAL_SCHEMA` | `""` | JDK組み込みパーサ(7u40+) | `schemaLocation`、`xs:import`、`xs:include`が指すスキーマを拒否 |
| `external-general-entities` | `false` | オプションのSAX2機能 | 外部一般エンティティを無視 |
| `external-parameter-entities` | `false` | オプションのSAX2機能 | 外部パラメータエンティティを無視 |
| `load-external-dtd` | `false` | Xercesおよび派生 | 外部サブセットを無視(非検証時のみ) |
| `FEATURE_SECURE_PROCESSING` | `true` | DOM/SAX(JAXP)必須 | 実装独自の処理上限を有効化 |

推奨の組み立ては次のとおり。

- まずJVM上で`disallow-doctype-decl`を試す(Xerces派生が使われていることが多い)。
- 内部DTD/エンティティを本当に必要とする場合は、`external-general-entities`・`external-parameter-entities`・`load-external-dtd`の**3つすべて**を無効化する。どれか1つでも有効なままだと、そこが攻撃経路として残る。
- `FEATURE_SECURE_PROCESSING`をAPI経由で明示的に有効化すると、JDK組み込みパーサでは`ACCESS_EXTERNAL_DTD`/`ACCESS_EXTERNAL_SCHEMA`の**デフォルト値**が空文字列になる。ただしこれはデフォルトの上書きに過ぎず、プロパティ優先順位ではシステムプロパティや設定ファイルより下位にあるため、運用側が上書きできる点に注意。

逆に安全性を壊す設定もある。`setValidating(true)`を呼ぶと`load-external-dtd`は「検証時は常にON」という扱いになり効かなくなる。`setXIncludeAware(true)`を呼ぶと、DOCTYPEとは別系統の外部取得経路(XInclude)が開き、これはリゾルバでしか閉じられない。

**`setExpandEntityReferences`は「偽物の友人(false friend)」である。** この設定はエンティティ参照ノードをツリー内でどう表現するかを制御するだけで、外部リソースを取得するかどうかには関与しない。名前から誤解しやすいが、これを`false`にしてもXXEは防げない。

#### 4.3 SAX: SAXParserFactoryとXMLReader

DOMと同じ実装系列が使われるが、注意点が2つある。

- `SAXParserFactory`はfeature APIしか公開しないため、property扱いの設定は`SAXParser.getXMLReader()`で得た`XMLReader`に対して設定する必要がある。
- `XMLReaderFactory.createXMLReader()`ではなく`SAXParserFactory`経由でreaderを取得すること(前者はJava 9以降非推奨)。

もっとも実務上見落としやすい落とし穴は次である。**`SAXParser.parse(source, DefaultHandler)`は、そのハンドラを`XMLReader`の`EntityResolver`として上書きしてしまう。** これは、あなたが事前に設定したリゾルバを、`null`を返すリゾルバで黙って置き換えるという意味になる。この置き換えは`SAXParser`自体の実装(特定のパーサ実装ではなく、Java標準API側)で起きるため、どのパーサを使っていても逃れられない。対策は、設定済みの`XMLReader.parse(...)`を直接呼ぶか、ハンドラの`resolveEntity`をオーバーライドして外部参照を拒否することであり、リゾルバ設定後にこの`SAXParser`のオーバーロードを使わないようにする。

#### 4.4 StAX: XMLInputFactory

StAXにはJDK組み込みリーダー、Woodstox、Aaltoなどの実装がある(Android・Oracle XDKには存在しない)。StAX仕様自体はセキュリティ関連プロパティを持つが、既定値は`true`またはunspecifiedである。

| 設定 | 安全な値 | 効果 |
| --- | --- | --- |
| `jdk.xml.dtd.support` | `deny` | DOCTYPEを含む文書を拒否(JDK組み込み、Java 22+) |
| `SUPPORT_DTD` | `false` | DTDを拒否ではなくスキップする。内部サブセットも外部サブセット取得も発生しない |
| `IS_SUPPORTING_EXTERNAL_ENTITIES` | `false` | 外部の解析対象エンティティを解決しない |

```java
XMLInputFactory xif = XMLInputFactory.newInstance();
xif.setProperty(XMLInputFactory.SUPPORT_DTD, false);
xif.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
```

`setProperty`は未知の名前に対して例外を投げるため、この呼び出し自体がすでに「fail closed(失敗時に安全側へ倒れる)」設計になっている。StAXには`FEATURE_SECURE_PROCESSING`に相当するものが無いため、エンティティ展開の上限は実装依存である。

#### 4.5 Oracle XDKと、JAXPパーサをラップするライブラリ

Oracle XML Developer's Kit(`oracle.xml.parser.v2`)は独自実装で、`DOMParser`に対して`setSecureProcessing()`を呼ぶだけでエンティティ解決の無効化と展開数の制限が一括で適用される(引数なし・取り消し不可)。`XMLParser`基底クラスに乗っているためSAXパーサ側も同じ呼び出しで硬化できる。

dom4jやJDOMのように、自分ではパースせずJAXPパーサを内部で使うライブラリは、SAXの節で説明した方法で硬化した`XMLReader`を渡す必要がある。特に**dom4jは渡した`XMLReader`のリゾルバを`read()`のたびに上書きする**ため、`SAXReader.setEntityResolver`にも同じdeny-allリゾルバを別途設定しなければならない。

#### 4.6 パーサを消費するだけのインターフェース

`TransformerFactory`、`SchemaFactory`、`Validator`、`XPath`、JAXBの`Unmarshaller`はそれ自体パーサではなく、パーサを**消費する**側である。硬化したパーサを渡さなければ、内部で独自にパーサを生成してしまう。

```java
// 硬化済みのreaderを作る
XMLReader reader = ...;

// Transformer.transform()もValidator.validate()もSAXSourceを受け取れる
transformer.transform(new SAXSource(reader, new InputSource(inputStream)), result);
```

```java
// 硬化済みのStAX readerを作る
XMLStreamReader xsr = ...;

Object result = jaxbContext.createUnmarshaller().unmarshal(xsr);
```

ここで重要な区別は、「文書自身が持つ参照」と「自分たちのスタイルシート/スキーマが持つ参照」を分けて考えることである。文書側の`xml-stylesheet`処理命令や`xsi:schemaLocation`は攻撃者が制御できるため拒否のまま維持し、逆に自分のXSLTやXSDが使う`xsl:import`/`xs:include`のような正当な分割参照は、閉じるのではなく`CatalogResolver`(既知の識別子だけをローカルファイルへマップし、それ以外は拒否する)などで**許可範囲を絞る**方向で扱う。

### 5. .NET

.NETのパーサ群は「バージョンで安全性が変わる」典型例であり、時系列を押さえることが必須になる。総括すると、**.NET Framework 4.5.2以降**では主要パーサの既定動作が安全側に変わっている。

| パーサ | 4.5.2未満 | 4.5.2以降 |
| --- | --- | --- |
| `XmlDocument` | 危険(既定で`XmlResolver`がnullでない) | 安全(既定で`XmlResolver`がnull) |
| `XmlTextReader` | 危険 | 安全(内部`XmlResolver`が既定でnull) |
| `XPathNavigator` | 危険(`IXPathNavigable`実装に依存) | 安全 |
| `XmlReader` | 条件付き危険 | 安全(`DtdProcessing`が既定`Prohibit`、`XmlResolver`も既定null) |
| `XmlNodeReader` | 安全 | 安全(常にDTDを無視) |
| `XmlDictionaryReader` | 安全 | 安全 |
| `XDocument`/`XElement`(LINQ to XML) | Billion Laughsは不明瞭 | 外部エンティティ・Billion Laughsとも安全 |

危険なバージョンでの典型的な対処は`XmlResolver`を明示的に`null`へ設定することである。

```csharp
static void LoadXML()
{
    string xxePayload = "<!DOCTYPE doc [<!ENTITY win SYSTEM 'file:///C:/Users/testdata2.txt'>]>"
                      + "<doc>&win;</doc>";
    string xml = "<?xml version='1.0' ?>" + xxePayload;

    XmlDocument xmlDoc = new XmlDocument();
    // これをnullにすることでDTDが無効になる。既定ではnullではない点に注意。
    xmlDoc.XmlResolver = null;
    xmlDoc.LoadXml(xml);
    Console.WriteLine(xmlDoc.InnerText);
    Console.ReadLine();
}
```

なぜ`XmlResolver = null`で防げるのか。`XmlResolver`は外部リソース(DTDが指す`SYSTEM`識別子など)を実際に取得しにいくコンポーネントであり、これをnullにすると「取得する手段が存在しない」状態になるため、パーサがDOCTYPE自体は読んでもエンティティの実体解決に失敗する(あるいは無視する)。

`.NET 4.0`から`4.5.2`未満の期間では、旧来の`ProhibitDtd`プロパティが非推奨化され`DtdProcessing`に置き換わったが、**既定値は変更されなかった**ため`XmlTextReader`は引き続き脆弱である。明示的に`Prohibit`を指定する必要がある。

```csharp
XmlTextReader reader = new XmlTextReader(stream);
// 既定値がParseのままなので、明示指定が必要
reader.DtdProcessing = DtdProcessing.Prohibit;  
```

ASP.NETでは`Web.config`の`<httpRuntime targetFramework="..." />`が実質的な安全性判定に絡む。アプリがビルドされた.NETバージョンと`targetFramework`のうち**低い方**が実効バージョンとして扱われるため、コード側だけ新しくしても`Web.config`側の指定を怠ると既定で脆弱になる。よく似た`<compilation targetFramework="..." />`はこの安全性とは無関係なので混同しないこと。

Billion Laughs型のDoSに関する検証は、別テストツール(BounceSecurity製)によって.NET 4.5.2以降の安全性が確認されている。

### 6. iOS: libxml2とNSXMLDocument

iOSはC/C++のlibxml2をそのまま含むため、前述のlibxml2に関する注意がそのまま当てはまる。ただし**iOS6以前に同梱されているlibxml2はバージョン2.9未満**であり、2.9で入った既定無効化の恩恵を受けられない点に注意が必要である。

`NSXMLDocument`はlibxml2の上に構築された独自型で、libxml2単体より追加の保護を持つ。

- iOS4以前: すべての外部エンティティが既定でロードされる(危険)
- iOS5以降: ネットワークアクセスを必要としないエンティティのみロードされる(相対的に安全)

いずれのバージョンでも、`NSXMLDocument`生成時に`NSXMLNodeLoadExternalEntitiesNever`を指定すればXXEを完全に無効化できる。

### 7. PHP

**PHP 8.0以降**は、libxml2ベースの既定パーサでXXEが既定で防止される。PHP 8.0未満では明示的な無効化が必要になる。

```php
libxml_set_external_entity_loader(null);
```

これは、外部エンティティのローダー(実際に外部リソースを取得する関数)そのものをnullに差し替えることで、パーサが外部参照を解決しようとしても呼び出す先が無い状態を作る。原典はこの挙動の悪用例として、Facebookで修正されたXXE脆弱性を扱ったSensePostの記事を挙げている。

### 8. Python

Python公式ドキュメントの「xml脆弱性」節に基づく整理として、Python 3の標準XML関連モジュール(`sax`、`etree`、`minidom`、`pulldom`、`xmlrpc`)は次の傾向を持つ。

| 攻撃種別 | sax | etree | minidom | pulldom | xmlrpc |
| --- | --- | --- | --- | --- | --- |
| Billion Laughs | 脆弱 | 脆弱 | 脆弱 | 脆弱 | 脆弱 |
| Quadratic Blowup(エンティティ長の二乗に比例して負荷が増えるDoS変種) | 脆弱 | 脆弱 | 脆弱 | 脆弱 | 脆弱 |
| 外部エンティティ展開 | 安全 | 安全 | 安全 | 安全 | 安全 |
| DTD取得 | 安全 | 安全 | 安全 | 安全 | 安全 |
| Decompression Bomb | 安全 | 安全 | 安全 | 安全 | 脆弱 |

つまり標準ライブラリは「外部エンティティ・外部DTD取得」については既定で安全だが、**内部エンティティの再帰展開によるDoS(Billion Laughs / Quadratic Blowup)には無防備**という非対称な状態にある。これはXXEそのもの(外部リソースへのアクセス)とDoS(内部の再帰展開)が別の攻撃面であることを裏付けている実例でもある。この隙間を埋めるために、`defusedxml`パッケージ(標準モジュールの安全なドロップイン代替として、DoS系攻撃も含めてブロックする)の利用が推奨されている。

### 9. 静的解析による検知(Semgrepルール)

原典はJavaの3系統のパーサに対応する公式Semgrepルールを紹介している。

- `DocumentBuilderFactory`向け: `documentbuilderfactory-disallow-doctype-decl-missing`
- `SAXParserFactory`向け: `saxparserfactory-disallow-doctype-decl-missing`
- `XMLInputFactory`向け: `xmlinputfactory-possible-xxe`

いずれも「`disallow-doctype-decl`などの安全化フィーチャが設定されていないファクトリ生成」を検出するルールであり、CIパイプラインに組み込むことで、本節で説明した「例外を握りつぶして硬化が効かないまま動いてしまう」パターンをレビュー前に機械的に洗い出せる。

### 10. まとめ:防御設計の優先順位

原典全体を通じて一貫しているのは次の優先順位である。

1. **可能ならDOCTYPE宣言そのものを拒否する。** これが唯一、XXEとBillion Laughs型DoSの両方を一度に塞ぐ設定であり、迷ったらまずこれを試す。
2. **DOCTYPEを完全には拒否できない場合、外部エンティティ・外部パラメータエンティティ・外部DTDロードの3つをセットで無効化する。** 1つでも漏れれば攻撃経路が残る。
3. **リゾルバはフィーチャより信頼性が高い。** フィーチャは実装依存でサイレントに無視されうるが、リゾルバはJAXPの契約上どの実装でも必ず尊重される。
4. **エンティティ展開の上限(secure processing)は、リゾルバとは独立に設定する。** リゾルバは外部アクセスを止めるだけで、内部エンティティの再帰展開までは止めない。
5. **バージョンと年次を必ず確認する。** libxml2の2.9、PHPの8.0、.NET Framework 4.5.2、JDKの22(dtd.support)のように、多くの言語・ライブラリで「ある時点からデフォルトが安全になった」という区切りが存在する。自分のスタックがどちら側にいるかを確認しないまま「最近のバージョンだから安全」と判断するのは危険である。
6. **パーサを直接使わないラッパー(dom4j、TransformerFactory、Validatorなど)にも同じ警戒が必要。** ラッパー自身が内部で未硬化のパーサを生成したり、渡したリゾルバを勝手に上書きしたりするケースがある。

最後に、原典は参考文献としてTimothy Morganの2014年の論文「XML Schema, DTD, and Entity Attacks」を挙げている。これはXXEおよび関連するDTD・スキーマ由来の攻撃手法を体系的にまとめた古典的な研究であり、外部エンティティだけでなくXMLスキーマ経由の攻撃面(スキーマの`xs:import`など)まで含めて整理している点で、本節のようなパーサ設定レベルの防御と併せて読む価値がある。

> 出典: XML External Entity Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html
> 出典: OWASP CheatSheetSeries GitHub（原文, Timothy Morgan論文への参照を含む） — https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.md
