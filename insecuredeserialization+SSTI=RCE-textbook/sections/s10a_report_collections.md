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
