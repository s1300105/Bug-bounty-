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
