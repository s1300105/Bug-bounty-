# 第10章 実例・ライトアップ・CVEによる統合

## HackerOne実報告の分類集と.NET RCE事例

本節では、実在のバグバウンティ報告（HackerOneディスクロージャー）をもとに、SSTI（Server-Side Template Injection、サーバー側でテンプレートエンジンにユーザー入力が渡り、テンプレート構文として解釈・実行されてしまう脆弱性）とRCE（Remote Code Execution、リモートからの任意コード実行）がどのような文脈・技術で実際に発生してきたかを俯瞰する。個別のペイロードを丸暗記するより、「どのコンポーネントが」「どういう入力経路で」「どの内部処理を経て」危険なsink（入力が最終的に実行・解釈される危険な代入先）に到達したのかという分類軸を持つことが、未知の実装を評価する際の再現性ある思考の助けになる。

なお本節は防御・学習目的の分類整理であり、実在サービスへの再現手順や攻撃ペイロードの実行手順（いわゆる「ラボ攻略」）は記載しない。あくまで公開レポートの技術的分類と、そこから得られる設計上の教訓を扱う。

### reddelexc/hackerone-reportsの位置づけ

[reddelexc/hackerone-reports](https://github.com/reddelexc/hackerone-reports) は、HackerOne上で公開設定（disclosed）になっている報告書を脆弱性クラス別に整理し直したキュレーションリポジトリである。生の報告は数万件規模で存在し、タイトル検索だけでは「本当に技術的に読む価値がある報告」を見つけにくい。このリポジトリは `docs/tops_by_bug_type/` 配下に `TOPSSTI.md`（SSTI関連のトップ報告）や `TOPRCE.md`（RCE関連のトップ報告）といったファイルを用意し、報奨金額や支持（upvote）数を手がかりに「読む価値の高い」報告へのリンク集を提供している。

> 出典: reddelexc/hackerone-reports (TOPSSTI.md) — https://raw.githubusercontent.com/reddelexc/hackerone-reports/master/docs/tops_by_bug_type/TOPSSTI.md
> 出典: reddelexc/hackerone-reports (TOPRCE.md) — https://raw.githubusercontent.com/reddelexc/hackerone-reports/master/docs/tops_by_bug_type/TOPRCE.md

#### Top SSTIレポート一覧から読み取れる傾向

取得できたTOPSSTI.mdの全12件は以下の通りである（タイトル・リンク・報奨金）。

1. "Server Side Template Injection in Return Magic email templates?" — https://hackerone.com/reports/423541 — $0
2. "Path traversal, SSTI and RCE on a MailRu acquisition" — https://hackerone.com/reports/536130 — $2,000
3. "Urgent: Server side template injection via Smarty template allows for RCE" — https://hackerone.com/reports/164224 — $0
4. "Reflected XSS and Server Side Template Injection in all HubSpot CMSes" — https://hackerone.com/reports/399462 — $0
5. "Python : Add query to detect Server Side Template Injection" — https://hackerone.com/reports/944359 — $0
6. "Server Side Template Injection on Name parameter during Sign Up process" — https://hackerone.com/reports/1104349 — $0
7. "SSTI leads to Command injection" — https://hackerone.com/reports/3584149 — $0
8. "[Ruby]: Server Side Template Injection" — https://hackerone.com/reports/1928279 — $2,300
9. "CodeQL query to detect Server-Side Template Injections (JavaScript)" — https://hackerone.com/reports/894872 — $0
10. "Server-side Template Injection in lodash.js" — https://hackerone.com/reports/904672 — $0
11. "Server-side template injection at ujs test server" — https://hackerone.com/reports/942103 — $0
12. "Java : Add query to detect Server Side Template Injection (SSTI)" — https://hackerone.com/reports/1490372 — $0

この一覧には、本教科書の他章で扱った理論をそのまま裏付ける2つの重要な傾向が見える。

第一に、**「テンプレートエンジンそのものへの侵入」と「テンプレートエンジンに『見せかけた』注入」の混在**である。3番（Smarty）や2番（MailRuのケース）は、いわゆる古典的SSTI——テンプレート構文（`{{ }}` や `{% %}` など、テンプレートエンジンが解釈する特殊記法）にユーザー入力がそのまま連結され、テンプレートのコンパイル・レンダリング時にサーバー側のコード実行にまでつながるパターンである。Smarty（PHP製テンプレートエンジン）は `{php}` タグや `{if}` の式評価など、テンプレート言語自体がPHPコードに近い表現力を持っていたため、初期のバージョンではテンプレート文字列注入がほぼそのままRCEに直結した。

一方で9番・10番・12番のように「CodeQLクエリの追加」「lodash.jsでの検出」といったタイトルは、実際のプロダクション侵害報告ではなく、**静的解析ルール自体の提出**である。これはHackerOneのバグバウンティ運営組織（GitHubのCodeQL、あるいはOSSプロジェクト自体）が「この脆弱性パターンを検出するクエリを書いてほしい」という形で報奨金を出しているケースであり、実環境のPoC（概念実証）ではなく検出ロジックの貢献に対する評価である。lodash.jsの `template()` 関数は、テンプレート文字列内に埋め込まれたJavaScript式をそのまま `Function` コンストラクタでコンパイルする実装だったため、ユーザー制御下の文字列がテンプレートとして渡されると任意のJavaScript実行につながりうる、という設計上の脆弱性クラスが存在し、それを機械的に発見するための静的解析ルールが求められた、という文脈である。

第二に、**報奨金$0の報告が大半を占める**という点は初学者ほど誤解しやすい。バグバウンティにおける報奨金額は「深刻度」だけでなく、「対象組織のポリシー」「重複報告の有無」「その組織における当該資産の重要度スコープ」など複数の要因で決まる。SSTI自体は多くの場合RCEへの前段として極めて高い深刻度に分類されるにもかかわらず、公開報告のうち報奨金がついているのはごく一部である。これは、報告の技術的価値（教材としての価値）と報奨金額が必ずしも比例しないことを示しており、金額の大小だけで「学ぶ価値」を判断すべきではないという実務上の教訓になる。

7番「SSTI leads to Command injection」というタイトルは、SSTIからOSコマンド実行に至る典型的な連鎖を端的に示している。多くのテンプレートエンジン（Jinja2、Twig、Freemarker、Velocityなど）は、テンプレート内で参照可能なオブジェクトからPythonやJavaの標準ライブラリ、あるいはOSプロセス起動APIへとメソッドチェーンでたどり着ける「サンドボックス脱出」の系譜を持つ。これはテンプレートエンジンの表現力（変数のメソッド呼び出しを許すこと自体）と安全なサンドボックス化の両立が本質的に難しいという、SSTIというクラス全体を貫く構造的問題を示している。

#### Top RCEレポート一覧から見えるスケールと傾向

TOPRCE.mdは336件という大規模なリストであり、全件をここに転記することは本節の目的（分類の理解）に対して冗長なので、報奨金上位・支持数上位、および本章のテーマ（デシリアライゼーション由来RCE）に関連する代表例を抜粋する。

**報奨金上位の代表例:**

- $33,510 — Report #1609965（GitLab）: "RCE via the DecompressedArchiveSizeValidator and Project BulkImports"
- $30,000 — Report #925585（PayPal）: "RCE via npm misconfig -- installing internal libraries from the public registry"
- $20,160 — Report #591295（X/旧Twitter）: "Potential pre-auth RCE on Twitter VPN"
- $20,000 — Report #1154542、#1125425（GitLab）: ExifTool metadata removal / Kramdown Wiki renderingに起因する脆弱性

**支持（upvote）数上位の代表例:**

- Report #470520（Valve, $0）: "Steam Client buffer overflow" — 1,288 upvotes
- Report #591295（X/xAI, $20,160）: Twitter VPN脆弱性 — 1,243 upvotes
- Report #925585（PayPal, $30,000）: npm設定不備 — 941 upvotes

**Starbucksに関連する報告（本章と直結する系譜）:**

- Report #502758: "RCE and Complete Server Takeover of http://www.█████.starbucks.com.sg/" — 571 upvotes, $0（本節後半で扱う対象）
- Report #1027822: "Unrestricted File Upload Leads to RCE on mobile.starbucks.com.sg" — 247 upvotes, $0
- Report #592400: "Blind SQLi leading to RCE, from Unauthenticated access to a test API Webservice" — 236 upvotes, $0
- Report #536134: "Store Development Resource Center was vulnerable to a Remote Code Execution" — 57 upvotes, $0
- Report #221294: "Java Deserialization RCE via JBoss on card.starbucks.in" — 48 upvotes, $0
- Report #153026: "Java Deserialization RCE via JBoss JMXInvokerServlet/EJBInvokerServlet on card.starbucks.in" — 42 upvotes, $0

ここで注目すべきは、**同一組織（Starbucks）に対して、時期の異なる複数の研究者が、異なるサブドメイン・異なる技術スタック（JBoss上のJavaデシリアライゼーション、.NET環境でのRCE、ファイルアップロード起因RCE、SQLi経由のRCEなど）で繰り返しRCEを報告している**という事実である。これは単発の「運が悪かった」事例ではなく、大規模組織では買収・レガシー化・サブドメインの管理境界の曖昧さによって、同種のクラスの脆弱性が組織内の異なる資産に何度も再発しうることを示している。攻撃対象領域（アタックサーフェス）管理の観点からは、一つの脆弱性クラスが是正されても、組織内の別資産に同種の設定ミスや古いミドルウェアが温存されていれば、脅威は消えないという教訓が読み取れる。

> 出典: reddelexc/hackerone-reports (TOPRCE.md) — https://raw.githubusercontent.com/reddelexc/hackerone-reports/master/docs/tops_by_bug_type/TOPRCE.md

### HackerOne #502758: Starbucks RCE and Complete Server Takeover（.NETデシリアライゼーション）

> ⚠️ **未取得の資料**: 「HackerOne Report #502758（Starbucks RCE and Complete Server Takeover、報告者 Eugene Lim / spaceraccoon）」の本文詳細は自動取得できませんでした（理由: `hackerone.com/reports/502758` への直接アクセスがブロックされ、ページ本文がクライアント側レンダリングのプレースホルダのみを返し、また archive.org 等の代替ミラーへのアクセスも本環境からは許可されていないため、報告本文中の具体的なリクエスト/レスポンス、使用ペイロード、修正確認のやり取りを確認できませんでした）。以下のURLからご自身で直接ご覧ください: https://hackerone.com/reports/502758

上記の理由により、報告文そのものの一次情報（具体的なHTTPリクエスト、使用したガジェットチェーンの正確な種類、Starbucks側の修正パッチの詳細）は本節では引用できない。ただし、reddelexc/hackerone-reportsのTOPRCEリストおよび複数の検索結果から、以下は事実として確認できた。

- 報告タイトルは「RCE and Complete Server Takeover of http://www.[マスク済].starbucks.com.sg/」であり、Starbucksのシンガポール向けサブドメインが対象だった。
- 報告者はEugene Lim（ハンドル名 spaceraccoon）。同氏はHackerOneグローバルランキング上位、H1-Elite Hall of Fameに名を連ねる著名な研究者で、Starbucksに対しては本件以外にもSQLインジェクション（Microsoft Dynamics AXバックエンド経由、報奨金$4,000）など複数の報告履歴がある。
- 本件はHackerOne上で571 upvotes（コミュニティからの支持）を獲得しており、TOPRCEリスト中でも上位に位置する、技術的に高く評価された報告である。
- 報奨金額は$0として記録されている（前述の通り、深刻度と報奨金額は必ずしも比例しない）。
- 対象システムはその後オフラインになったと言及されており、報告を契機に当該資産自体が廃止・移行された可能性が示唆される。

（以下は未取得資料の補足として一般知識に基づく解説です）本報告のタイトルと位置づけ（「.NETデシリアライゼーション」による完全なサーバー奪取）から、これは.NET環境で典型的に見られるデシリアライゼーションRCEの系譜に属する事例だと推測できる。ここでは特定報告の詳細を断定する代わりに、.NETデシリアライゼーションRCEがどのような仕組みで成立するかという、業界で広く確認されている一般的なメカニズムを、防御目的の知識として整理する。

#### .NETデシリアライゼーションRCEが成立する仕組み

.NET環境における代表的なデシリアライゼーションRCEの経路は、大きく分けて次の2系統がある。

**(1) BinaryFormatter / NetDataContractSerializer 系のガジェットチェーン**

.NET Framework には、オブジェクトをバイナリ形式でシリアライズ・デシリアライズする `BinaryFormatter` というAPIが存在する（.NET Framework全般で長く既定のまま提供され、.NET 5以降のフレームワークでは段階的に非推奨化・削除が進んでいる）。このAPIの本質的な危険性は、デシリアライズ対象の**型情報がシリアライズされたデータ自身に埋め込まれており、デシリアライズ処理系が呼び出し元の意図とは無関係に、データが指定した任意の型のコンストラクタやプロパティセッタを実行してしまう**点にある。これは「型の安全性」の話ではなく、「デシリアライズ処理が、データの言うとおりに任意のコードパス（コンストラクタ、`ISerializable.GetObjectData`、プロパティのsetterなど）を呼び出してしまう」という、パーサ設計上の信頼境界の誤りである。

ここで使われるのが `ObjectDataProvider` ガジェット（.NET Frameworkの `System.Windows.Data.ObjectDataProvider` クラスを悪用する手法）である。`ObjectDataProvider` は本来、WPF（Windows Presentation Foundation）のデータバインディングのために「指定した型の指定したメソッドを呼び出し、その戻り値をUIにバインドする」という機能を提供するクラスである。攻撃者は、シリアライズされたXMLやJSONの中に「`ObjectDataProvider` を使って `System.Diagnostics.Process.Start` を呼び出す」という指定を埋め込むことで、デシリアライズが完了した瞬間（プロパティのsetterが呼ばれた瞬間）に任意コマンドが実行される。

ysoserial.net（.NET向けの既知ガジェットチェーン生成ツール、Java版ysoserialの.NET移植）はこの手法を次のようなコマンドで自動生成できることで広く知られている（本教科書はこれを実行手順として推奨するものではなく、防御側が「どのような文字列パターンを検知すべきか」を理解するための引用である）。

```
ysoserial.exe -g ObjectDataProvider -f Json.Net \
  -c "cmd /c calc.exe" -o base64
```

このコマンドが生成するペイロードの骨格は、JSON.NET（Newtonsoft.Json）でシリアライズされた次のような構造に近い。

```json
{
  "$type": "System.Windows.Data.ObjectDataProvider, PresentationFramework",
  "MethodName": "Start",
  "ObjectInstance": {
    "$type": "System.Diagnostics.Process, System",
    "StartInfo": {
      "$type": "System.Diagnostics.ProcessStartInfo, System",
      "FileName": "cmd",
      "Arguments": "/c calc.exe"
    }
  }
}
```

なぜこれが危険なのか。JSON.NETには `TypeNameHandling` という設定項目があり、これを `Auto`、`All`、`Objects`、`Arrays` のいずれかに設定すると、デシリアライズ時にJSON内の `$type` フィールドを信頼し、**そこに書かれた任意の.NET型を実際にインスタンス化する**ようになる。既定値である `TypeNameHandling.None` であればこの経路は成立しないため、この脆弱性クラスは「開発者が意図的に、あるいは相互運用性のために `TypeNameHandling` を緩めた場合にのみ」成立する、設定依存の脆弱性である。攻撃者が信頼境界の外側（クライアントからのリクエストボディなど）から渡ってくるJSONをこの設定でデシリアライズしている場合、`$type` に `ObjectDataProvider` を指定し、その `MethodName` に `Process.Start` を指すことで、デシリアライズ処理系自身にプロセス起動を代行させることができる。

**(2) 特定ミドルウェア（Telerik UI for ASP.NET AJAX等）が抱えるデシリアライゼーション経路**

もう一つの著名な系統は、サードパーティ製UIコンポーネントライブラリ（Telerik UI for ASP.NET AJAXなど）が提供するファイルアップロード機能やステート管理機能が、内部的に暗号化・デシリアライズされた状態情報をクライアントとやり取りする際に、暗号鍵の管理不備（既定鍵のハードコード、鍵の推測可能性）や暗号化スキームの実装不備（パディングオラクルなど）と組み合わさることで、最終的に任意型のデシリアライズに帰着し、RCEへ至るというものである。この系統の脆弱性は年を追って新しい亜種（暗号スキームの差し替えや検証ロジックの追加によって過去の修正が回避される、いわゆるバイパス）が報告され続けており、対象バージョンと修正状況を都度確認することが実務上不可欠である。ライブラリ提供元のセキュリティ情報を必ず参照し、「このバージョン以降で修正済み」という一次情報を確認する姿勢が、教科書的な知識をそのまま適用してしまう誤りを避ける。

#### この事例から得るべき教訓

特定報告の一次情報が確認できなかった以上、断定的な技術的詳細（本件が具体的にどのガジェットチェーンをどう使ったか）を教科書として提示することは避けるべきである。しかし、TOPRCEリストに残るタイトルと、業界で広く確認されている.NETデシリアライゼーションRCEの一般的成立条件を突き合わせることで、次の防御的教訓は確度高く導ける。

1. **デシリアライズ対象の型を、シリアライズされたデータ自身に決めさせない**こと。`TypeNameHandling` を必要最小限（`None`、あるいはホワイトリスト化された `SerializationBinder` との併用）に留める、`BinaryFormatter` のような型自己申告型のシリアライザを新規実装で採用しない、という設計判断が根本対策になる。
2. **サードパーティUIコンポーネントの「見えない」内部通信**（ステート情報、アップロードメタデータなど）も、暗号化されているからといって安全な設計とは限らない。暗号鍵のハードコードや弱い検証ロジックがあれば、暗号化は攻撃者にとっての「不透明化」に過ぎず、防御にはならない。
3. **報奨金や公開の有無に関わらず、同一クラスの脆弱性が組織内の異なる資産で再発しうる**。単一の修正で終わらせず、同種の技術スタックを使う他の資産への横展開的な点検（同じミドルウェア、同じシリアライザ設定を使っている他システムがないかの棚卸し）が組織的な再発防止として重要である。

## Orange Tsaiによる多重脆弱性チェーンでのRCE

この節では、台湾の著名なセキュリティ研究者 **Orange Tsai（黃泓瑞）** による2本の代表的な調査報告を教材として読み解く。いずれも「単体では致命的とは言えない小さな穴」を複数つなぎ合わせて（**チェーン**して）最終的にRCE（Remote Code Execution、遠隔コード実行）へ到達した実例であり、本書の主題である **「安全でないデシリアライゼーション（insecure deserialization）」** と **「SSTI/式言語インジェクション」** の双方が、現実の巨大サービスでどのように牙をむくかを示している。

- 記事1（2017年）は、**SSRF（Server-Side Request Forgery、サーバ側リクエスト偽造）→ プロトコルスマグリング → Ruby の `Marshal.load` による安全でないデシリアライゼーション**という流れで、GitHub Enterprise を root 権限で乗っ取った。これは本書の「デシリアライゼーション」側の集大成である。
- 記事2（2018年）は、**JBoss Seam フレームワークの式言語（EL, Expression Language）インジェクション**をチェーンし、Amazon の社内コラボレーションシステム（Nuxeo 製品）を認証なしで RCE に持ち込んだ。これは本書の「SSTI（サーバサイドテンプレート/式インジェクション）」側の代表例である。

> **本書のスコープに関する注意**：以下はすべて**防御・学習目的**の解説である。掲載する概念やペイロード断片は、脆弱性の原理と検知・防御ポイントを理解するためのものであり、実在サービスや本番環境への無許可の検証・攻撃に用いてはならない。既に修正済みの過去事例として、設計上の教訓を抽出する視点で読んでほしい。

---

### 記事1：GitHub Enterprise を SSRF チェーンから RCE へ（2017年）

#### 全体像 ― なぜ「チェーン」が必要だったのか

GitHub Enterprise（GHE）は、GitHub.com のオンプレミス版であり、暗号化された仮想アプライアンスとして顧客に配布される。Orange はこのアプライアンスのディスクを復号し、内部で動く **Ruby on Rails** 製アプリのソースコードを解析した。そのうえで、外部から到達できる入口（webhook 機能）を起点に、内部サービスへと段階的に潜り込んでいった。

到達したゴールは、Ruby の組み込みシリアライズ機構である **`Marshal.load`** に攻撃者が制御するバイト列を食わせること、である。`Marshal.load` は Java の `readObject()` や Python の `pickle.loads()` と同じく、**信頼できないデータを渡すと任意コード実行につながりうる**危険な「シンク（sink：入力が最終的に実行・解釈される到達点）」である。問題は、その `Marshal.load` へ至る入口が**外部から直接は触れない内部キャッシュ（Memcached）**だったことだ。そこで「外から内部キャッシュにデータを書き込む」ための道を、SSRF の多段チェーンで切り拓いた。

チェーンは大きく4段である。

1. **入口の SSRF**（IP 制限のバイパス）
2. **内部サービス Graphite での二段目 SSRF**
3. **Python `httplib` の CRLF インジェクション**によるプロトコルスマグリング
4. **Ruby `Marshal.load` の安全でないデシリアライゼーション**によるコード実行

#### 段①：webhook の IP 制限を `http://0/` でバイパス

GHE の webhook 機能（`https://<host>/<user>/<repo>/settings/hooks/new`）は、ユーザーが指定した URL へサーバがリクエストを送る典型的な SSRF 温床である。GHE は Ruby Gem **`faraday-restrict-ip-addresses`** を使い、内部 IP（127.0.0.1 など）宛のリクエストを**ブラックリスト方式**で弾いていた。

しかしブラックリスト方式は、IP 表記の多様性を突かれると容易に破れる。Orange が使ったバイパスは次の一行である。

```
http://0/
```

**なぜ通るのか**：Linux（正確には多くの POSIX ネットワークスタック）では、IPv4 アドレス `0.0.0.0`、そしてそれを短縮した数値 `0` が、名前解決や接続時に **localhost（127.0.0.1 相当）** として扱われる。ブラックリストは `127.0.0.1` や `localhost` という「見た目」を弾いていたが、`0` という数値表記を想定していなかった。RFC 3986 が許容する数珠繋ぎの IP 表記（10進数値、8進、16進など）は、パーサによって解釈が食い違うため、**ブラックリストでの SSRF 対策が本質的に脆い**ことを示す好例である。

> ここから得る防御教訓：**SSRF 対策はブラックリストではなくアローリスト（許可する宛先の明示）で行う**。さらに、名前解決後の実 IP をチェックし、`0.0.0.0/8`・`127.0.0.0/8`・`169.254.0.0/16`（リンクローカル、クラウドのメタデータ 169.254.169.254 を含む）・プライベートアドレス帯をすべて拒否する。表記正規化をパーサ任せにしない。

#### 段②：内部 Graphite サービスでの二段目 SSRF

段①で「内部 localhost に到達できる」状態になったが、webhook が送れるのは素朴な HTTP GET だけで、これ単体では大したことはできない。そこで Orange は、GHE が内部ポート **8000** で動かしていた統計可視化ツール **Graphite**（Python 製）に着目した。Graphite の `send_email` 機能は、URL パラメータを検証せずにサーバ側でリクエストを発行する、もう一つの SSRF ポイントだった。

```python
# webapps/graphite/composer/views.py（抜粋）
def send_email(request):
    recipients = request.GET['to'].split(',')
    url = request.GET['url']
    proto, server, path, query, frag = urlsplit(url)
    if query: path += '?' + query
    conn = HTTPConnection(server)
    conn.request('GET', path)
    # ...
```

`url` パラメータの `server` と `path` がそのまま `HTTPConnection` に渡る。段①の SSRF で `http://0:8000/composer/send_email?...` を叩けば、この二段目 SSRF を**内部から**起動できる。SSRF を SSRF で踏み台にする「二段ジャンプ」である。

#### 段③：Python `httplib` の CRLF インジェクションでプロトコルを密輸する

ここが技術的な核心である。二段目 SSRF を得ても、なお送れるのは「HTTP GET」だけに見える。しかし Orange は、Python 2 系の `httplib`（`HTTPConnection`）が **リクエストパスに含まれる CRLF（`\r\n`, `%0D%0A`）をエスケープせずそのまま送出する**欠陥を利用した。

```
http://0:8000/composer/send_email?to=orange@nogg&url=http://127.0.0.1:12345/%0D%0Ai_am_payload%0D%0AFoo:
```

**なぜ危険か**：多くのネットワークプロトコル（HTTP・Memcached・Redis・SMTP など）は **改行（CRLF）で命令やヘッダを区切る行指向プロトコル**である。パスに `%0D%0A`（改行）を注入できると、TCP ストリーム上に**攻撃者が任意の追加行を書き込める**。つまり、`HTTPConnection` は「HTTP を喋っているつもり」でも、接続先が **Memcached（ポート 11211）** や **Redis（ポート 6379）** なら、注入した行がそのままそれらのコマンドとして解釈される。これが**プロトコルスマグリング（protocol smuggling）**、あるいは CRLF injection による SSRF の武器化である。

これにより、外部の攻撃者は「内部の Memcached に任意のキーと値を SET する」能力を手に入れた。

> 防御教訓：**ユーザ入力をネットワーク層のパス・ホスト・ポートに素通しさせない**。URL パーサやHTTPクライアントが CRLF をどう扱うかを検証し、パスに制御文字が混入したら拒否する。内部サービス（Memcached/Redis）は**認証を有効化**し、ネットワークセグメンテーションで隔離する。

#### 段④：`Marshal.load` の安全でないデシリアライゼーションで root を取る

最後の一段が、本書の主題そのものである。GHE は Ruby Gem **`memcached`** を使ってオブジェクトをキャッシュしていた。この gem は、キャッシュから値を取り出すとき **`Marshal.load`（Ruby のバイナリデシリアライズ）で自動的にオブジェクトへ復元する**。段③で Memcached に任意バイト列を書き込めるようになった今、そこに**悪意あるシリアライズ済み Ruby オブジェクト**を仕込み、GHE が次にそのキャッシュを読んだ瞬間にデシリアライズを発火させれば、コード実行に至る。

Orange が用いたガジェット（デシリアライズ時に副作用として処理を実行させる既存クラスの連鎖）は、Rails/ActiveSupport に存在する定番の一つである。

```ruby
# ペイロードの骨子（Marshalバイナリを手組みしたもの）
# ActiveSupport::Deprecation::DeprecatedInstanceVariableProxy と ERB を悪用
payload = "\x04\x08" \
  + "o" + ":\x40ActiveSupport::Deprecation::DeprecatedInstanceVariableProxy" + "\x07" \
  + ":\x0e@instance" \
  + "o" + ":\x08ERB" + "\x07" \
  + ":\t@src" + Marshal.dump(code)[2..-1] \
  + ":\x0c@lineno" + "i\x00" \
  + ":\x0c@method" + ":\x0bresult"
```

**なぜ RCE になるのか（ガジェットチェーンの原理）**：

- `Marshal.load` は、シリアライズ列に記されたクラス名を見て**任意のクラスのインスタンスを（そのクラスがロード済みなら）復元**する。ここで復元されるのは攻撃者が選んだ `DeprecatedInstanceVariableProxy` である。
- `DeprecatedInstanceVariableProxy` は「非推奨のインスタンス変数へアクセスされたら警告を出しつつ、内部に保持した本来のオブジェクト（`@instance`）へ処理を委譲する」ためのプロキシである。この委譲の過程で、保持オブジェクトの `@method`（ここでは `result`）が**メソッド呼び出しとして起動される**。
- `@instance` に仕込まれているのは **`ERB`（Embedded Ruby）テンプレート**オブジェクトで、その `@src`（テンプレートのソース＝コンパイル済み Ruby コード）に攻撃者のコードが埋め込まれている。`ERB#result` が呼ばれると `@src` が**そのまま Ruby として評価**される。

つまり、「デシリアライズ → プロキシの委譲 → ERB のテンプレート評価」という**既存クラスだけを組み合わせた無害な部品の連鎖**が、最終的に任意 Ruby コード実行という凶器に変わる。これがガジェットチェーンの本質であり、`Marshal.load`／`readObject`／`pickle.loads` に信頼できないデータを渡してはならない根本理由である。

GHE の該当プロセスは root で動いていたため、最終的に `uid=0(root) gid=0(root)` でのコード実行が成立した。

> **この記事から抽出すべき教訓（防御視点）**
> 1. **信頼できないデータを `Marshal.load` へ渡さない**。キャッシュ・セッション・クッキーなど「内部だから安全」と思われがちな経路も、SSRF や注入で外部から汚染されうる。
> 2. **SSRF はブラックリストではなくアローリストで防ぐ**。IP 表記の正規化・CRLF 混入検査・内部サービスの認証を徹底する。
> 3. **多層防御**：どれか1つの穴が塞がっていれば、このチェーンは成立しなかった。SSRF・プロトコルスマグリング・デシリアライゼーションのいずれかを断てば全体が止まる。

> 出典: How I Chained 4 vulnerabilities on GitHub Enterprise, From SSRF Execution Chain to RCE! — https://blog.orange.tw/2017/07/how-i-chained-4-vulnerabilities-on.html

---

### 記事2：Amazon コラボレーションシステムを EL インジェクションで RCE（2018年）

> **注記**：本節の題として当初「Seam/XStream/FastJSON」と示されていたが、原典で実際にチェーンされたのは **JBoss Seam フレームワークの式言語（EL）インジェクション**である（XStream/FastJSON のガジェットは本記事の主役ではない）。以下は原典の内容に忠実に、Seam の EL インジェクションを軸に解説する。これは本書の主題のうち **「SSTI（式言語/テンプレートのインジェクション）」** 側を体現する事例である。

#### 全体像 ― Seam の EL とは何か、なぜ SSTI と同類なのか

対象は `collaborate-corp.amazon.com` で動く **Nuxeo 8.10**（エンタープライズ向けコンテンツ管理製品）で、内部で **JBoss Seam 2.3.1.Final** を用いていた。Seam は JSF（JavaServer Faces）ベースの Web フレームワークで、画面のあちこちで **EL（式言語）**、たとえば `#{someBean.someMethod()}` のような式を評価する。

EL は本来「テンプレート内で Bean のプロパティやメソッドを呼ぶ」ための便利機能だが、**攻撃者が EL 式の中身を制御できてしまうと、それは実質的にサーバ側での任意式評価＝SSTI（Server-Side Template Injection）／式言語インジェクション**になる。EL からは Java のリフレクション API に手が届くため、`java.lang.Runtime.exec()` まで到達できれば OS コマンド実行に至る。Orange はこの EL を攻撃者制御下に置くため、4つのバグ／仕様を積み重ねた。

#### バグ①：セミコロン（パスパラメータ）による認証 ACL バイパス

Nuxeo の認証フィルタ `NuxeoAuthenticationFilter` は、`getRequestedPage()` の返り値をホワイトリスト（`login.jsp` など認証不要ページの一覧）と突き合わせてアクセス制御していた。その `getRequestedPage()` は、URL のセミコロン以降（パスパラメータ）を切り捨てる。

```java
// Nuxeo の getRequestedPage() 抜粋
int i = requestedPage.indexOf(';');
return i == -1 ? requestedPage : requestedPage.substring(0, i);
```

ここで、次のような URL を送る。

```
/nuxeo/login.jsp;/..;/[本来は認証が必要な領域]
```

**なぜ通るのか（パーサ差異の悪用）**：認証フィルタは `;` 以降を切って `login.jsp` だけを見るので「認証不要ページ」と判定する。ところが**サーブレットコンテナ（Tomcat）はセミコロンを「パスパラメータ」区切りとして別扱い**し、実際のルーティングでは `..` によるディレクトリ遡上を経て、本来保護されるべき領域へ到達する。**「認証を判断するコンポーネント」と「実際にリクエストをディスパッチするコンポーネント」でパスの解釈が食い違う**という、パーサ差異（parser confusion）による認可バイパスの典型である。これは本書で繰り返し登場するテーマ（同じ入力を複数のパーサが違う意味に解釈することで生じる欠陥）そのものである。

#### バグ②③：`actionMethod` による EL インジェクションと「二重評価」

Seam には `actionMethod` というリクエストパラメータがあり、`FILENAME:EL_CODE` という形式で「あるビュー（.xhtml ファイル）の文脈でこの EL を実行せよ」と指示できる（本来はボタン押下時のアクションを呼ぶための仕組み）。Orange は、既存のビューファイルを**ガジェット**として悪用した。

```
widgets/suggest_add_new_directory_entry_iframe.xhtml
```

このファイルは内部で `request.getParameter('directoryNameForPopup')` を評価する。ここに Seam の **二重評価（double evaluation）** という危険な挙動が絡む。

```
actionMethod=widgets/suggest_add_new_directory_entry_iframe.xhtml:request.getParameter('directoryNameForPopup')
&directoryNameForPopup=/?#{PAYLOAD}
```

**なぜ RCE の入口になるのか**：`actionMethod` で指定したビューを評価すると、その中で `directoryNameForPopup` パラメータの値が取り出される。Seam は「**EL を評価した結果の文字列が、さらに EL 構文（`#{...}`）を含んでいたら、それをもう一度 EL として評価する**」。この二重評価のせいで、攻撃者が `directoryNameForPopup=/?#{PAYLOAD}` と与えれば、`#{PAYLOAD}` が**サーバ側で任意 EL 式として評価**される。これで EL の中身を完全に攻撃者が握った ―― すなわち SSTI（式言語インジェクション）が成立した。

> 防御教訓：**ユーザ入力を式言語の評価対象へ二次的にでも流し込まない**。テンプレートエンジンの「評価結果を再評価する」系の機能は、入力汚染があると即 SSTI 化する。フレームワークのバージョンと既知の EL 評価挙動を把握し、危険な機能（`actionMethod` の直接受理など）を無効化・制限する。

#### バグ④：EL ブラックリストのバイパス（ブラケット記法）

Seam の新しめのバージョン（2.2.2 以降）は、EL からの危険なメソッド呼び出しを**文字列マッチのブラックリスト**（`blacklist.properties`）で弾こうとしていた。ブロック対象には次のようなパターンが含まれる。

```
.getClass(
.class.
.getPassword(
```

つまり `foo.getClass()` のような**ドット記法での `getClass` 呼び出し**を、文字列 `.getClass(` の存在で検出して拒否していた。Orange はこれを **ブラケット（配列風）記法**で回避した。

```
# ブロックされる書き方（ドット記法）
"".getClass()

# バイパス（ブラケット記法。文字列 ".getClass(" が現れない）
""["class"]
```

**なぜ回避できるのか**：EL では `obj.property` と `obj["property"]` は等価であり、`""["class"]` は `"".getClass()` と同じく `String` の `Class` オブジェクトを返す。しかしブラックリストは `.getClass(` という**リテラル文字列**を探しているだけなので、`["class"]` という表記には一致しない。**「危険な操作の意味」ではなく「特定の文字列の見た目」でしか防いでいない**という、ブラックリスト防御の根本的な弱さがここでも露呈する。

#### 最終ペイロード：EL リフレクションから `Runtime.exec()` へ

ブラケット記法で `getClass` 相当を得られれば、あとは Java のリフレクション API をたどって `java.lang.Runtime` に到達し、`exec()` を呼ぶだけである。

```
""["class"].forName("java.lang.Runtime")
   .getMethods()[15].invoke(null, new String[]{"command"})
```

**なぜ動くのか（原理）**：

- `""["class"]` で `String` の `Class` を得て、その `forName("java.lang.Runtime")` で `Runtime` クラスの `Class` オブジェクトを取得する。
- `getMethods()` はそのクラスの public メソッド配列を返す。Orange は環境上の並び順から、`getRuntime()` がインデックス 7、`exec(String)` がインデックス 15 に来ることを利用し、リフレクションでこれらを順に呼び出した（`invoke(null, ...)` は静的メソッド呼び出し）。
- こうして EL 式だけで `Runtime.getRuntime().exec("command")` 相当を組み立て、**認証なしで OS コマンド実行**に到達した。

> **バージョン依存への注意**：`getMethods()` が返すメソッドの順序は JVM 実装・バージョンに依存し、インデックス（7 や 15）は環境ごとに変わりうる。これは「その環境でたまたま成立した具体値」であり、恒久的な定数ではない。バージョン依存の脆弱性を語るときは、対象バージョン（ここでは Nuxeo 8.10 / Seam 2.3.1.Final、2018年時点）を必ず明記して陳腐化を避けるべきである。

#### タイムラインと修正状況

- 2018年3月10日：AWS セキュリティへ報告。
- 2018年3月15日：Nuxeo が修正版を公開。
- 同月：Amazon から報奨。

現行の Nuxeo / Seam では、`actionMethod` の受理や EL 評価まわりの挙動が見直され、当時のチェーンはそのままでは成立しない。

> **この記事から抽出すべき教訓（防御視点）**
> 1. **EL/テンプレートの評価対象に外部入力を混ぜない**。二重評価・`actionMethod` のような「文字列を式として再解釈する」機能は SSTI の温床。
> 2. **ブラックリストは信用しない**。`.getClass(` のような文字列一致は `["class"]` で容易に破れる。**サンドボックス化・機能そのものの無効化・アローリスト**で守る。
> 3. **パーサ差異（セミコロン/`..`）を認可の抜け道にしない**。認可判定とルーティングで**同一の正規化済みパス**を使う。

> 出典: How I Chained 4 Bugs (Features?) into RCE on Amazon Collaboration System — https://blog.orange.tw/posts/2018-08-how-i-chained-4-bugs-features-into-rce-on-amazon/

---

### 2つの事例から学ぶ共通原理 ― 「小さな穴の掛け算」

本書の題名 **「insecure deserialization + SSTI = RCE」** を、この2事例はきれいに体現している。

| 観点 | GitHub Enterprise（2017） | Amazon/Nuxeo（2018） |
|---|---|---|
| 最終シンク | Ruby `Marshal.load`（デシリアライゼーション） | Seam EL 評価（SSTI／式言語インジェクション） |
| 入口 | webhook の SSRF（`http://0/`） | セミコロンによる認証 ACL バイパス |
| 中間の武器化 | 二段 SSRF＋CRLF プロトコルスマグリング | `actionMethod` の EL 二重評価 |
| 防御回避 | IP ブラックリストのバイパス | EL ブラックリストのブラケット記法バイパス |
| 権限 | root（uid=0） | 認証なしの OS コマンド実行 |

共通する設計上の教訓は次の通り。

1. **どのチェーンも「デシリアライズ or 式評価」という強力なシンクに、外部入力を到達させたこと」で決まった。** シンクを塞ぐ（信頼できないデータを `Marshal.load`/EL に渡さない）ことが最優先。
2. **ブラックリスト防御は繰り返し破られる。** IP 表記（`0`）でも EL 表記（`["class"]`）でも、「意味」ではなく「文字列の見た目」で弾く防御は回避される。**アローリスト・サンドボックス・機能の無効化**へ切り替える。
3. **パーサ差異／プロトコル差異が接着剤になる。** 認可コンポーネントとルーティング、HTTP クライアントと下位プロトコルなど、**同じ入力を異なる主体が違う意味に解釈**する箇所は、攻撃者の格好の連結点になる。正規化を一元化し、境界での再解釈を排除する。
4. **多層防御が効く。** 各チェーンは4段すべてが成立して初めて RCE に至った。1段でも断てば全体が止まる。個々の穴を「単体では軽微」と過小評価しないことが、チェーン攻撃への最良の対抗策である。

> ⚠️ **未取得の資料はありません**：本節の2記事は自動取得に成功した（記事1は正規化後の URL `https://blog.orange.tw/posts/2017-07-how-i-chained-4-vulnerabilities-on/` から取得。掲載時の URL は `https://blog.orange.tw/2017/07/how-i-chained-4-vulnerabilities-on.html`）。より詳細な図解やスライドは、Black Hat USA 2017 / DEF CON 25 での同氏の発表資料も参照されたい。

## CVE実装エクスプロイトと報告者ブログ

本節では、これまで学んできたデシリアライゼーション攻撃・SSTI攻撃の理論を、実際のCVE実装（Metasploitモジュール)とバグバウンティ報告者の実戦ブログという2つの一次資料を通じて統合する。前者は「エンタープライズJavaミドルウェアにおけるガジェットチェーンの現実的な武器化」、後者は「本番環境で見つかる設定ミスの連鎖がどのようにRCEへ発展するか」という、章を通じて学んできた抽象論の着地点を示す。

### CVE-2015-7450: IBM WebSphere Application Server の Java デシリアライゼーションRCE

#### 脆弱性の背景

CVE-2015-7450 は、IBM WebSphere Application Server（対象バージョン: 7.0.0.0 系、後続バージョンにも波及）の管理系SOAPインターフェースに存在した、認証不要のリモートコード実行脆弱性である。原因は、SOAP経由で受け取ったパラメータの中に含まれるJavaシリアライズ済みオブジェクトを、アプリケーション側が型やクラスを検証せずに `readObject()` で復元していたことにある。

この脆弱性が公表された2015年当時、根本原因は WebSphere 自体のコードではなく、WebSphere が依存関係として同梱していた **Apache Commons Collections** ライブラリだった。Commons Collections には、`InvokerTransformer` のようにリフレクション（実行時に任意のクラスの任意メソッドを呼び出す機能）を使うクラスが含まれており、これらを連鎖させる（＝ガジェットチェーンを組む）ことで、単なるオブジェクト復元だったはずの処理から任意のシェルコマンド実行に到達できる。これは本教科書の第3章で扱った「CommonsCollections1」系ガジェットチェーンと同一の系譜であり、CVE-2015-7450 はそのチェーンをWebSphereという具体的なsink（入力が最終的に実行・解釈される危険な代入先）に適用した実例である。

> 出典: IBM WebSphere - RCE Java Deserialization (Metasploit) — https://www.exploit-db.com/exploits/41613

#### 攻撃対象インターフェースと通信経路

このMetasploitモジュール（EDB-ID: 41613、Platform: Windows、公開日: 2017年3月15日）が突くのは、WebSphereの管理コンソールが公開しているSOAP経由の管理エンドポイントである。デフォルトではポート8880（SSL有効）で待ち受けており、認証を経由せずにSOAPリクエストを送信できる設計上のギャップが悪用の起点になっている。

WebSphereの管理APIはJMX(Java Management Extensions、Java仮想マシン内の管理対象オブジェクトを外部から操作するための標準機構)ベースで設計されており、SOAP経由でリクエストされたパラメータの一部（`ObjectName` など)がJavaオブジェクトとしてシリアライズされた状態でやり取りされる。攻撃者はこの `ObjectName` パラメータに、本来期待される管理オブジェクトの参照ではなく、悪意あるガジェットチェーンを埋め込んだシリアライズ済みバイト列を差し込む。サーバ側がこれを検証なくデシリアライズすることで、埋め込まれたコマンドが実行される。

#### エクスプロイトの内部構造

Metasploitモジュールは `Msf::Exploit::Remote` を継承し、HTTPクライアント機能とPowerShellペイロード生成機能を組み合わせている。処理の流れは次の3段階に整理できる。

1. **ガジェットチェーンの構築** — `set_payload()` 相当の処理で、CommonsCollections1チェーンを用いた直列化バイト列を組み立てる。ここでの「直列化バイト列」とは、Javaの `ObjectOutputStream` が出力する、クラス情報とフィールド値をバイナリ表現した塊であり、受信側は `ObjectInputStream.readObject()` でこれを逆変換してオブジェクトグラフを復元する。この復元処理自体がコード実行のトリガーになる点が、デシリアライゼーション脆弱性の本質である。
2. **ペイロードのステージング** — `gen_payload()` 相当の処理で、実際にターゲットのWindows上で実行させるネイティブ実行ファイル(Meterpreterなど)を、PowerShellのダウンロード＆実行コマンドとして生成する。ガジェットチェーンが呼び出すのは「あるコマンドラインを起動する」という単純な操作であるため、複雑なペイロードそのものをシリアライズデータに埋め込む必要はなく、PowerShellワンライナーを起動させて外部から本体を取得させる二段構成にしている。
3. **SOAPエンベロープへの注入と送信** — `soap_request()` 相当の処理で、上記のシリアライズ済みバイト列（多くの場合Base64エンコードされる）をXML SOAPエンベロープの該当フィールドに埋め込み、対象のSOAPエンドポイントへPOSTする。

```xml
<!-- 概念図: SOAPエンベロープ内にBase64エンコードされた
     悪意あるシリアライズオブジェクトを注入するイメージ -->
<soapenv:Envelope ...>
  <soapenv:Body>
    <ns1:someAdminOperation>
      <ObjectName>BASE64_ENCODED_MALICIOUS_SERIALIZED_OBJECT</ObjectName>
    </ns1:someAdminOperation>
  </soapenv:Body>
</soapenv:Envelope>
```

なぜこれで動くのか、という点を仕組みレベルで整理すると、鍵は「アプリケーション層のスキーマ検証と、Javaシリアライゼーションのバイナリプロトコルの間に検証の空白がある」ことに尽きる。SOAP/XMLの層ではXMLスキーマに従っていれば通過してしまい、その中身がBase64デコードされシリアライズドオブジェクトとして復元される段階では、WebSphere側が「復元して良いクラスの許可リスト」を持っていなかった。この「デシリアライズ前にクラスを検証しない」という設計上の欠落は、本教科書で繰り返し登場する共通パターンであり、Javaの `readObject()` がオーバーライド可能で、かつ標準ライブラリやサードパーティ製ライブラリの中に「復元されるだけで危険な副作用を持つクラス」（ガジェット）が存在する限り、根本的な対策はホワイトリスト方式のデシリアライズフィルタ（`ObjectInputFilter`、JEP 290以降で標準搭載）か、シリアライズそのものを使わない設計に置き換えることしかない。

#### 影響と教訓

このエクスプロイトが成立すると、**認証を一切要求せず**、WebSphereアプリケーションのプロセス権限でリモートコード実行が可能になる。管理系インターフェースは多くの場合サーバ内部の高い権限（システムサービスアカウントなど）で稼働しているため、被害範囲はアプリケーション単体にとどまらず、ホスト全体、さらにはそのホストが接続する内部ネットワークにまで及び得る。

防御側の観点で重要な教訓は次の3点である。

- **サードパーティ依存関係の脆弱性は自社コードの脆弱性である**: Commons Collectionsは自社が書いたコードではないが、依存として組み込んだ以上、その中の危険なクラスの組み合わせは攻撃対象になる。SBOM(Software Bill of Materials、依存ライブラリの一覧)管理と定期的な脆弱性スキャンが不可欠。
- **管理インターフェースの露出面を最小化する**: SOAP管理エンドポイントのように強力な操作が可能なインターフェースは、外部からアクセス不能な管理専用ネットワークに隔離し、認証・IP制限を必須にする。
- **デシリアライズ処理そのものに境界防御を設ける**: アプリケーションレベルでの入力検証だけでなく、JVMレベルでのデシリアライズフィルタ導入や、危険なクラス（`InvokerTransformer` 等）をクラスパスから除去・バージョンアップすることが根本対策になる。

> 出典: IBM WebSphere - RCE Java Deserialization (Metasploit) — https://www.exploit-db.com/exploits/41613

### 報告者ブログに学ぶ実戦: 露出したActuatorとH2データベースエイリアスの連鎖

#### 概要と位置づけ

もう一つの一次資料である spaceraccoon.dev は、バグバウンティハンター Eugene Lim（ハンドル名: spaceraccoon）が運営する技術ブログである。トップページ自体には最新の別テーマの記事（IoT機器のリバースエンジニアリングなど)が並んでいるが、本節が着目するのは、このブログを起点として公開された、HackerOne上のStarbucksプログラムへの報告（Report #502758、"RCE and Complete Server Takeover"として公開、報奨金4,000ドル）に関連する実戦的な技術記事「Remote Code Execution in Three Acts: Chaining Exposed Actuators and H2 Database Aliases in Spring Boot 2」である。

> ⚠️ **未取得の資料**: HackerOneレポート本文（https://hackerone.com/reports/502758）は、認証や動的レンダリングの影響でWebFetchによる本文抽出ができませんでした（取得結果がヘッダー情報のみで、本文の再現エクスプロイト手順・タイムライン詳細が得られませんでした）。詳細な再現手順・タイムラインをご覧になりたい場合は、上記URLからご自身で直接ご確認ください。代替として、同じ脆弱性チェーンを一般公開している同著者の記事本文とGitHub実装検証用リポジトリ（spaceraccoon/spring-boot-actuator-h2-rce）を取得し、以下で技術的に解説する。

（以下は未取得資料の補足として一般知識に基づく解説です）公開情報によれば、このHackerOneレポートはSpring Boot製アプリケーションの管理系エンドポイント(Actuator)が本番環境に露出していたことを起点に、内部で使われていたH2データベースエンジンの機能を悪用してRCEへ到達し、サーバの完全掌握（Complete Server Takeover）に至ったと報告されている。報告の質の高さ（再現性の高い手順・スクリーンショット・影響範囲の説明）がトリアージを容易にしたことが公開情報から読み取れる。

> 出典: Starbucks disclosed on HackerOne: RCE and Complete Server Takeover (Report #502758) — https://hackerone.com/reports/502758

#### 第一幕: 露出したSpring Boot Actuatorエンドポイント

Spring Boot Actuatorは、稼働中のアプリケーションの状態を監視・管理するための機能群で、`/actuator/env`（環境変数・設定プロパティの一覧取得および変更）や `/actuator/restart`（アプリケーションの再起動)といったエンドポイントを提供する。

開発者が設定ファイルに `management.endpoints.web.exposure.include=env` のような設定、あるいはより危険な `include=*`（ワイルドカードで全エンドポイントを公開）を指定してしまうと、これらの管理機能が**認証なしで外部からアクセス可能**になる。これは本教科書がこれまで扱ってきたデシリアライゼーションやSSTIのような「入力パーサの脆弱性」とは性質が異なり、「本来は内部運用者専用のはずの強力な機能が、設定ミスによって外部に露出する」という、設定不備型の攻撃対象領域(attack surface)の典型である。しかし、露出後にその機能を使ってコードを実行させる後段の手口は、まさにこの章で学んできた「信頼されるべきでない入力を、実行可能なコンテキストに注入する」という共通パターンに帰着する。

#### 第二幕: HikariCPの `connection-test-query` を書き換える

Spring Boot 2.x系はデフォルトのデータベース接続プール実装として HikariCP を採用している。HikariCPには、新しい接続を確立する際にその接続が正常かを確認するために実行する任意のSQL文を指定できる設定項目 `spring.datasource.hikari.connection-test-query` が存在する。

`/actuator/env` エンドポイントがPOSTで環境変数の書き換えを許可している場合、攻撃者はこのプロパティ値を外部から自由に上書きできる。つまり「接続確認のために実行されるSQL文」という、通常は無害な用途のフィールドが、攻撃者の望む任意のSQL文の実行フックに変わる。この時点ではまだSQLインジェクションに過ぎないが、後段でH2データベースエンジンの機能と組み合わさることで、単なるSQL実行がOSコマンド実行へと昇格する。

#### 第三幕: H2データベースの `CREATE ALIAS` によるコード実行

H2 Database Engineは主に開発・テスト用途で使われる軽量なJavaデータベースだが、SQL文からJavaコードを直接定義・呼び出せる `CREATE ALIAS` という強力な機能を持つ。これは、SQL関数の実体としてJavaのメソッド定義そのものをインラインで登録できる機能であり、事実上「SQL経由で任意のJavaコードを実行する公式な入口」を提供してしまう。

report記事で示されている概念的なペイロードは次の形である。

```sql
CREATE ALIAS EXEC AS CONCAT('String shellexec(String cmd) throws java.io.IOException 
{ java.util.Scanner s = new java.util.Scanner(Runtime.getRuntime().exec(cmd)
.getInputStream()); if (s.hasNext()) {return s.next();} throw new 
IllegalArgumentException(); }')
```

この一文が実行されると、H2エンジンは渡された文字列をJavaソースコードとしてその場でコンパイルし、`EXEC` という名前のSQL関数（エイリアス）として登録する。この関数の実体は `Runtime.getRuntime().exec(cmd)` — つまりOSレベルで任意のコマンドを起動する呼び出しをラップしたものである。これ以降、攻撃者は `CALL EXEC('id')` のような通常のSQLクエリを発行するだけで、任意のシェルコマンドを実行できるようになる。

なぜこれが成立するのか、仕組みを整理すると次のようになる。

1. `connection-test-query` に上記の `CREATE ALIAS` 文を仕込む(第二幕の悪用)。
2. `/actuator/restart` を呼び出すか、あるいはコネクションプールが新規接続を要求するタイミング（例えばアイドルタイムアウトによる接続の張り直し)を待つことで、HikariCPが新しいデータベース接続を確立しようとする。
3. HikariCPは新規接続確立時に必ず `connection-test-query` に設定されたSQLを実行する仕様になっているため、攻撃者が仕込んだ `CREATE ALIAS` 文がここでH2エンジンに送られ、実行される。
4. H2は `CONCAT(...)` で組み立てられた文字列をJavaメソッド定義として解釈し、コンパイル・登録する。この時点で任意のJavaコード実行が可能なエイリアス関数が生成される。

つまりこの攻撃連鎖の本質は、「接続ヘルスチェックという運用上のユーティリティ機能」と「開発用データベースエンジンがSQL文からJavaコードを直接実行できる機能」という、それぞれ単体では正当な設計判断であった2つの機能が、認証なしで外部から設定変更可能というギャップを介して連結された点にある。これは典型的な「単体では脆弱性ではない機能の連鎖(chained vulnerability)」の実例であり、単一のCVEやCWEには収まりきらない、実務でのバグ発見において非常に重要な思考様式である。

#### ブラインドRCEの工夫

直接のレスポンス出力が得られない状況(ブラインド)でも、記事はコマンド実行結果の有無をアプリケーションの成功/失敗という間接的なシグナルにエンコードするテクニックを示している。上記のペイロードで `Scanner` が出力を取得できなかった場合に例外(`IllegalArgumentException`)を投げる設計にしているのはそのためで、SQL実行が失敗すればHikariCPはその接続を不健全と判断してプールから除外する（あるいはアプリケーション側のエラーとして観測できる)。これにより、コマンド出力の有無や内容の断片を、真偽値のオラクル(oracle、外部から観測可能な二値の応答)として少しずつ抽出できる。これは第5章・第7章で扱ったブラインドSQLインジェクションやブラインドSSTIの検出手法と同じ発想であり、「直接出力が見えない場合でも、アプリケーションの挙動差(応答時間・エラー有無・ステータスコード)を観測点として使う」という汎用的な攻撃者側の思考パターンの再登場である。

#### 対策

この連鎖に対する防御は、各段階を個別に断ち切ることができる。

- **Actuatorエンドポイントの露出制限**: 本番環境では `management.endpoints.web.exposure.include` に必要なエンドポイントのみを明示的に列挙し、ワイルドカード指定を避ける。書き込み系操作(`env` への POST、`restart` の呼び出し)は特に、Spring Securityによる認証・認可を必須にするか、管理用ネットワークセグメントに限定する。
- **本番環境でのH2データベース使用を避ける**: H2は開発・テスト用途にとどめ、本番ではPostgreSQLやMySQLなど、SQL文からのコード実行機能を持たない、あるいは厳格に制限されたデータベースエンジンを使う。
- **多層防御としての最小権限原則**: アプリケーションを実行するOSユーザーの権限を必要最小限に絞ることで、たとえコード実行が成立しても被害を局所化できる。

> 出典: Remote Code Execution in Three Acts: Chaining Exposed Actuators and H2 Database Aliases in Spring Boot 2 (spaceraccoon.dev) — https://spaceraccoon.dev/remote-code-execution-in-three-acts-chaining-exposed-actuators-and-h2-database/

### 二つの事例からの統合的な学び

CVE-2015-7450とspaceraccoonのActuator/H2連鎖は、対象ミドルウェア(WebSphere対Spring Boot)、脆弱性の起点(サードパーティガジェットチェーン対設定不備の連鎖)、悪用される技術層(Javaシリアライゼーションのバイナリプロトコル対SQL/Javaコード生成機能)がまったく異なる。しかし両者に共通するのは、「本来は正当な目的を持つ機能(管理用リフレクション呼び出し、接続ヘルスチェック)が、入力の出所を検証しないまま実行可能なコンテキストに接続されている」という構造である。この構造的類似性を見抜く力こそが、個別のCVE番号を覚えることよりも重要な、デシリアライゼーション・SSTI系脆弱性のハンティングにおける核心的なスキルである。


---

### ナビゲーション

- ← 前の章: [第9章 SSTIツールと実バグバウンティ報告](09-ssti-tools-reports.md)
- 🏠 [目次（ホーム）](index.md)
- → 次の章: [第11章 防御の理解と回避技術の最前線](11-defense-and-evasion.md)
