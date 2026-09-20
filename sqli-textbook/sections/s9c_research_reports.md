## 研究追随と公開レポート

SQLインジェクション（SQLi）を学ぶうえで、書籍や公式ドキュメントだけを読んで終わりにするのはもったいない。攻撃手法もWAF（Web Application Firewall、悪意あるリクエストを検知・遮断する境界防御製品）のバイパス手法も、日々第一線の研究者と実務のバグハンターによって更新され続けている。本節では、その「最先端を追いかける」ための代表的な2つの情報源――研究者が手法そのものを発表する PortSwigger Research と、実際の脆弱性報告書が読める HackerOne Hacktivity――の使い方と、そこから何を学べるかを具体的に解説する。

### PortSwigger Research: 攻撃手法そのものが生まれる現場

#### 何が公開されているか

PortSwigger Research は、Web脆弱性スキャナ・プロキシツールとして著名な Burp Suite を開発する PortSwigger社の研究部門が運営するサイトである。2026年9月時点で公開されているプロフィールによれば、中心メンバーは以下の4名である。

- **James Kettle**（ハンドル名 albinowax） — Director of Research。HTTP Desync Attacks（HTTPリクエストスマグリングを一般に広めた研究）、Web Cache Poisoning（キャッシュポイズニング）、Single-Packet Attack、Server-Side Template Injection（SSTI）、Password Reset Poisoningなど、Webセキュリティ史に残る手法を多数発表してきた人物。
- **Gareth Heyes** — XSS（クロスサイトスクリプティング）やパーサの実装差異を突く研究で知られる。
- **Zakhar Fedotkin**、**Tom Stacey** — 比較的新しいメンバーで、継続的に個別テーマの深掘り記事を発表している。

サイトのトップページでは「Core Topics（主要テーマ）」として Black Hat（カンファレンス発表）、XSS、Request Smuggling、Template Injection、そして毎年恒例の**Top 10 Web Hacking Techniques**（その年に発表されたWebハッキング手法の中から、コミュニティ投票と専門家パネルの審査で年間ベスト10を選出する企画）が掲げられている。コンテンツは記事（Articles）、カンファレンス講演（Talks）、購読用のRSSフィードという形式で提供されている。

2026年8月時点の最新記事としては「CSS: the bomb inside your inbox」（CSSを使ったメールクライアント経由の攻撃）、「CRLF-Powered Desync Attacks」（改行文字挿入を起点にしたデシンク攻撃の発展形）、「Can AI do novel security research?」（AIが未知の攻撃手法を発見できるかを検証した研究）が並んでいる。この最後の記事は、James Kettleが構築した自律システム「HTTP Terminator」による研究で、AIエージェントにHTTPデシンク攻撃の亜種を大規模に自動探索させ、実在するサイトへの攻撃に至った過程を扱っている。研究の主戦場がHTTPリクエストスマグリング/デシンク系に大きく寄っていることが分かる。

> ⚠️ **補足（一般知識に基づく解説）**: PortSwigger Researchのトップページ自体にはSQLインジェクションに特化した記事は現時点で目立って掲載されていない。これは同チームの近年の研究がHTTPプロトコルレベルの挙動差異（デシンク、キャッシュ、リクエストの解釈違い）やXSS/テンプレートインジェクションに重心を置いているためであり、SQLiが「枯れた」分野と見なされているわけではない。SQLiはWeb Security Academy（同社が提供する無料の実習ラボ、これはresearchページとは別セクション）でカリキュラム化されており、研究サイトの方は「まだ体系化されていない新しい攻撃面」を追いかける場という役割分担になっている。

#### なぜこのサイトを定点観測すべきか

SQLiに限らず、Webの脆弱性研究は「パーサ（構文解析器）の実装差異」を起点にすることが極めて多い。例えばHTTPリクエストスマグリングは、フロントエンドのプロキシとバックエンドのサーバが `Content-Length` ヘッダと `Transfer-Encoding` ヘッダの優先順位を異なる方法で解釈することから生まれる。これはSQLiにおける「WAFとDBMS（データベース管理システム）のSQL方言解釈の差異を突くバイパス」と構造的に同じ発想である。つまりPortSwigger Researchで発表される手法は、直接SQLiの記事でなくても「境界防御の解釈差を突く」という思考の型そのものが横展開できる教材になる。研究者がどうやって「ここに解釈の揺らぎがあるはずだ」と仮説を立て、それを再現可能な実験で検証していくか、その手続き自体を読むことに価値がある。

また同社の年次企画「Top 10 Web Hacking Techniques」は、投票制で選ばれるため、その年にコミュニティが実際に注目した手法の温度感を把握するのに向いている。SQLiが再びランクインする年があれば、それは既存の対策（プリペアドステートメント、WAFのシグネチャ）を突破する新しい切り口が見つかったことを意味するので、優先的に読む価値がある。

> 出典: Researcher – James Kettle — https://portswigger.net/research/james-kettle （PortSwigger Research トップページ本文と合わせて参照）
> 出典: PortSwigger Research — https://portswigger.net/research

### HackerOne Hacktivity: 実戦のSQLiを読む

#### Hacktivityとは何か

Hacktivity は、HackerOne上でバグバウンティプログラム運営企業が「公開（disclosed）」を許可した脆弱性報告書を一覧・検索できる機能である。各レポートには、発見者、対象プログラム、脆弱性タイプ、重要度（CVSSベースのSeverity）、支払われた報奨金額、コミュニティからの「upvote（いいね）」数が付与され、脆弱性タイプ（SQL injectionなど）やプログラムで絞り込める。UIはクライアントサイドレンダリングのSPA（Single Page Application）で構築されているため、自動取得ツールでは一覧のHTML本体が取得できないことが多い点は運用上の注意点である。

> ⚠️ **未取得の資料**: Hacktivityの一覧画面そのもの（フィルタUIの動的な挙動、リアルタイムのランキング表示）は、JavaScriptによる動的レンダリングのため自動取得できませんでした（理由: クライアントサイドレンダリングのSPAで、静的取得では骨組みのHTMLしか得られない）。実際の絞り込み操作は以下のURLからご自身で直接ご覧ください: https://hackerone.com/hacktivity
> 以下は、個別に取得できた公開レポートページおよびHackerOne公式ブログ、コミュニティが編纂した公開レポート集計（GitHub: reddelexc/hackerone-reports）から再構成した、実際にHacktivity経由で読めるSQLi報告の具体例と、そこから学べるトリアージ・エスカレーションの実際である。

#### 具体例1: User-Agentヘッダーを起点にしたブラインドSQLi（GSA、2017年）

米国政府の一般調達局（GSA）が運用するbug bountyプログラムに対して、`https://labs.data.gov/dashboard/datagov/csv_to_json` というエンドポイントで、HTTPリクエストの `User-Agent` ヘッダーを経由したSQLインジェクションが報告された（Report #297478、2017年12月13日公開、報奨金2,000ドル、コミュニティから699 upvote）。

```
User-Agent: Mozilla/5.0' AND (SELECT 1 FROM (SELECT SLEEP(5))A)-- -
```

このような「スリープベース」のペイロードが有効な理由は、アプリケーションが応答本文にSQLエラーやクエリ結果を一切表示しない（＝ブラインド）状況でも、DBMSに時間のかかるSLEEP関数を実行させ、レスポンスが返ってくるまでの時間を測定することで、注入したSQL文が実際にDBMS側で評価されたかどうかを外部から判定できるためである。`SLEEP(5)` の代わりに `SLEEP(0)` を送って応答時間が短ければ、条件分岐にSQL文が影響していることが分かり、これを1ビットずつ繰り返すことでデータベースの内容を文字単位で抽出できる（ブラインドSQLi、特に時間ベースの手法）。

この事例が教材として重要なのは、**「入力欄」だけがSQLiの侵入経路ではない**という点である。User-Agent、Referer、X-Forwarded-Forといった、フォーム入力とは無関係に見えるHTTPヘッダーの値が、ログ記録・解析用にサーバ側でSQL文に文字列連結されることは珍しくない。攻撃対象を洗い出す際は、URLパラメータやフォームだけでなく、リクエスト全体（ヘッダーを含む）をSQLiの候補として扱う視点が要る。

> 出典: GSA Bounty disclosed on HackerOne: SQL injection in https://labs.data.gov/dashboard/datagov/csv_to_json via User-agent — https://hackerone.com/reports/297478

#### 具体例2: Starbucksの企業内データベースに到達したSQLi（2019年）

研究者 spaceraccoon（Eugene Lim）による報告（Report #531051、2019年8月6日公開、699ではなく800 upvote、CVSS 9.3のクリティカル評価、報奨金4,000ドル＝Starbucksのクリティカル案件の上限額）は、単発の脆弱性探索ではなく、2019年2月から4月にかけての継続的な調査から生まれた点が特徴的である。

発見の流れは次の通りである。

1. サブドメイン列挙で、一見単純なHTML形式のファイルアップロードフォームを見つける。
2. まずPHPシェルのアップロードによる任意コード実行を試すが失敗。しかし返ってきた詳細なエラーメッセージから、アップロードされたファイルが実はXMLとして処理されていることに気づく。
3. エラーメッセージ中に `MainAccount`、`Credit`、`Debit`、`Invoice` といったノード名が含まれており、これがMicrosoft Dynamics AX（企業向け会計・ERPシステム）のバックエンドであると推測できる。
4. XML内の数値IDフィールド（MainAccountノードなど）に対して時間ベースのSQLインジェクションを試み、成功。

このケースの核心は「**エラーメッセージは攻撃対象の設計図になる**」という原則である。詳細すぎるエラーメッセージ（スタックトレース、内部のノード名、使用ミドルウェア名など）は、攻撃者に対して「このパラメータはどう処理されているか」「バックエンドに何が使われているか」を教えてしまう。防御側の観点では、本番環境で詳細なエラーを出力しないこと（エラーハンドリングの一般化、ログとユーザー向け表示の分離）が重要な対策になる。また攻撃者側の視点では、「一見無関係な失敗（ファイルアップロードの拒否）」が次の攻撃面（XML経由のSQLi）へのヒントを与えてくれることがある、という執拗な深掘りの姿勢が学べる。HackerOneの公式ブログでもこの事例が「高インパクトなバグの好例」として取り上げられ、報告からトリアージ（一次審査・重要度判定）完了までがわずか翌日、修正までが2日というスピード対応だった点が強調されている。

> 出典: Starbucks disclosed on HackerOne: SQL Injection Extracts Starbucks Enterprise Accounting, Financial, Payroll Database — https://hackerone.com/reports/531051
> 出典: 8 High-impact Bugs and How HackerOne Customers Avoided a Breach: SQL Injection — https://www.hackerone.com/blog/8-high-impact-bugs-and-how-hackerone-customers-avoided-breach-sql-injection

#### 具体例3: デフォルト認証情報からブラインドSQLiへのエスカレーション（米国防総省、2018年）

研究者 alyssa_herrera による報告は、まず `admin/admin` というデフォルト認証情報が残った管理パネルを発見し、そこから検索エンジンを使って関連エンドポイントを洗い出し、ブラインドSQLiが存在する箇所を特定、最終的に `sqlmap`（SQLインジェクションの検出・悪用を自動化するオープンソースツール）で実際にデータ抽出まで行った事例である。報告日は2018年2月3日、トリアージは2日で完了している。

この事例から読み取れる実務上のパターンは、**単一の脆弱性で終わらせず、複数の弱点を連鎖させる**という発想である。デフォルト認証情報という初歩的な弱点から得られた管理画面の情報をもとに攻撃対象エンドポイントの候補を絞り込み、そこでSQLiを検証するという流れは、単発のパラメータ総当たりよりもはるかに効率的に「本当に危険な脆弱性」へたどり着く。SQLMapのような自動化ツールは、手作業でのブラインドSQLi検証（ペイロードを送ってレスポンス差分やタイミング差分を見る作業）を高速化するが、そもそも「どのパラメータを狙うべきか」という当たりをつける部分は、この事例のように偵察（reconnaissance）の丁寧さに依存する。

> 出典: 8 High-impact Bugs and How HackerOne Customers Avoided a Breach: SQL Injection — https://www.hackerone.com/blog/8-high-impact-bugs-and-how-hackerone-customers-avoided-breach-sql-injection

#### Hacktivityの活用法: SQLiで絞り込んで学ぶ

Hacktivity上で脆弱性タイプを「SQL Injection」に絞り込むと、上記のような公開レポートが upvote 数順・新着順などで一覧できる。実務での学習手順としては以下が効果的である。

1. **タイトルと対象プログラムから技術スタックを推測する**（例: `graphql`、`.php`、Androidアプリのエンドポイントなど）。Razer社（Razer Gold決済基盤）に対する報告が多数上位に入っているのは、決済系エンドポイントは複雑なパラメータ処理を伴いやすく、SQLiが潜みやすいことを示唆している。
2. **報奨金額とupvote数の乖離に注目する**。例えばStarbucksのUser-Agent経由の一件は699〜800台のupvoteを集める一方、報奨金自体は上限額（4,000ドル）にとどまっている。これは「技術的な鮮やかさ・実害の大きさ」と「プログラムが定める支払い上限」が必ずしも比例しないことを意味し、報奨金だけでなく実際の攻撃チェーンの中身を読むことが重要だと分かる。
3. **タイムライン（報告日・トリアージ完了日・修正日）を確認し、対応の速さを比較する**。トリアージが翌日で完了する組織もあれば、数週間かかる組織もある。これは組織のセキュリティ運用成熟度の指標になり、将来どのプログラムに時間を投資すべきかの判断材料になる。

なお、個々のレポートページはJavaScriptで描画されるSPAであり、レポート本文全体（詳細なリクエスト/レスポンスのやり取り）を効率よく読むには、ブラウザで直接開くか、コミュニティが公開している集計リポジトリ（例: GitHub上の `reddelexc/hackerone-reports`、upvote順にSQLi報告のタイトルとURLを整理した `TOPSQLI.md` など）を入口にして興味のあるレポートへジャンプする使い方が実用的である。ただしこうした第三者の集計はあくまで索引であり、技術的な一次情報は必ずHackerOne本体のレポートページを直接開いて確認すべきである。

> 出典: HackerOne Hacktivity — https://hackerone.com/hacktivity

### 定点観測を習慣にする意味

PortSwigger Researchは「まだ名前の付いていない攻撃手法がどう発見されるか」という**手法発明のプロセス**を学ぶ場であり、HackerOne Hacktivityは「発明済みの手法が実際のシステムでどう機能し、どう報告・査定・修正されるか」という**運用の現実**を学ぶ場である。前者からは新しい攻撃の「型」を、後者からはその型を実在のアプリケーションに当てはめる際の泥臭い偵察・再現・報告のプロセスを吸収できる。両者は補完関係にあり、SQLiのような成熟した脆弱性クラスであっても、この2つを定期的に読み続けることで「教科書止まりの知識」から「実戦で通用する嗅覚」へと理解を引き上げることができる。
