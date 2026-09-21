## API Hacking の書籍・コース

IDOR/BOLA を体系的に学ぶ上で、単発のブログ記事よりも「一冊の書籍」「一つの通しコース」で全体像を押さえておくことには大きな価値がある。個々のペイロードやツールの使い方は断片的な記事からも学べるが、**なぜその手順を踏むのか（方法論）**、**API特有の認可モデルがどう壊れるのか（原理）**は、体系だった教材でないと身につきにくい。本節では、IDOR/BOLA分野で最も参照される書籍とコース、およびその著者について解説する。

### Corey Ball『Hacking APIs: Breaking Web Application Programming Interfaces』（No Starch Press）

本書はAPIペネトレーションテストの実践書として広く読まれており、REST・SOAP・GraphQLといった主要なAPI形式への攻撃手法を、初学者でも実行可能な粒度まで落とし込んで解説している。著者のCorey Ballは監査法人（Big Four）出身のセキュリティコンサルタントで、OSCP・CISSP・CISMなどの資格を持ち、APIセキュリティの教育・コンサルティングを専門としている。

#### 全体構成

書籍は大きく3部構成になっており、「準備」→「攻撃手法」→「実践・キャリア」という段階を踏む。目次は次の通り（No Starch Pressおよび検索で確認できた版に基づく）。

```
第0章  Preparing for Your Security Tests（テスト準備・スコープ設定・法的留意点）
第1章  How Web Applications Work（Web動作の基礎）
第2章  The Anatomy of Web APIs（API解剖学：REST/SOAP/GraphQLの構造）
第3章  Common API Vulnerabilities（OWASP API Top 10 概観）
第4章  Your API Hacking System（Burp Suite等のツールチェーン構築）
第5章  Setting Up Vulnerable API Targets（crAPI等の脆弱API環境構築）
第6章  Discovery（エンドポイント列挙）
第7章  Endpoint Analysis（Postmanでの過剰データ公開検出）
第8章  Attacking Authentication（JWT攻撃など）
第9章  Fuzzing
第10章 Exploiting Authorization（BOLA/BFLAの実践的攻略）
第11章 Mass Assignment
第12章 Injection
第13章 Applying Evasive Techniques and Rate Limit Testing
第14章 Attacking GraphQL
第15章 Data Breaches and Bug Bounties
```

IDOR/BOLA読者が特に押さえるべきは第10章「Exploiting Authorization」、第11章「Mass Assignment」、第14章「Attacking GraphQL」の3つである。

#### 第10章: A-B テストと A-B-A テスト — BOLA判定の中核メソドロジー

第10章の核心は、BOLA/BFLAを**再現性のある手順**として体系化している点にある。著者は「多くのAPI提供者は認証（authentication：あなたが誰か）の実装には注意を払うが、認可（authorization：あなたが何にアクセスできるか）のチェックを見落としやすい」と指摘し、ユーザーAがユーザーBのリソースにアクセス・改変できてしまわないかを確認する具体的な手法として **A-B テスト** と **A-B-A テスト** を提示している。

**A-Bテストの手順:**

1. テスト用アカウントを最低2つ（User A、User B）用意する。
2. User Aでログインし、自分のリソース（例: 注文、プロフィール、請求書など）を作成・取得し、そのリソースID（`order_id=1001`など）とレスポンス内容、User Aの認証トークン（セッションCookieやBearerトークン）を記録する。
3. User Bでログインし、User BのトークンをHTTPリクエストの`Authorization`ヘッダーに使いながら、リクエストのパス/ボディ中のリソースIDだけを**User Aのもの**（`order_id=1001`）に書き換えて送信する。
4. レスポンスがUser Aのデータを返してしまえば、そのエンドポイントはオブジェクトレベルの認可（誰のリソースかのチェック）が欠落しており、**BOLA（Broken Object Level Authorization）**が成立する。

```http
# User Bのトークンで、User Aが所有するリソースIDを指定する
GET /api/v2/orders/1001 HTTP/1.1
Host: api.example.com
Authorization: Bearer <User_B_token>
```

このリクエストが200 OKでUser Aの注文情報を返せば脆弱、403/404であれば所有権チェックが機能していると判断できる。

**なぜこの手順が有効なのか（原理）**: APIサーバーの典型的な実装ミスは、「トークンが正当かどうか（認証）」だけを検証し、「トークンの持ち主が、リクエスト中で指定されたIDのオブジェクトを所有しているか（認可）」を検証しないことにある。多くのフレームワークはミドルウェアで認証を一括処理するため実装漏れが起きにくいが、認可はエンドポイントごとに個別のロジック（`if resource.owner_id == current_user.id`のような比較）を書く必要があり、これを書き忘れる、あるいはIDOR対策をリスト画面だけに入れて詳細取得APIに入れ忘れる、といったミスが非常に多い。A-Bテストはこの「実装され忘れた比較」を直接突く手法である。

**A-B-Aテストとは**: A-Bテストで単純GETが通っても、書き込み系（更新・削除）は別途チェックが入っている実装がある。そこでA-B-Aテストでは、User Bのトークンで**User Aのリソースを変更（PUT/PATCH/DELETE）した後**、再びUser Aでログインしてそのリソースを取得し、**実際に改変が反映されているか**を確認する。読み取り（GET）では403を返すのに書き込み（PUT）では通ってしまう、逆に単発リクエストのレスポンスコードだけでは検出できない「サイレントな書き込み成功」（レスポンスは200だが実際にはDBが更新されていない、あるいはその逆でレスポンスはエラーだが実は更新されてしまっている）を洗い出すために、最終状態をAアカウント側から検証するのがA-B-Aテストの狙いである。これはHTTPレスポンスコードだけを信頼した脆弱性判定が誤検知・見逃しを生みやすいことへの実務上の対処法であり、本書がBOLA検証を「レスポンスの見た目」ではなく「実際のデータ状態の変化」で判定する姿勢を貫いている点は、テスターが身につけるべき重要な習慣である。

#### 第11章: Mass Assignment

独立した章としてMass Assignment（一括代入脆弱性、リクエストボディ中の想定外フィールドがサーバー側のオブジェクトにそのまま代入されてしまう問題）を扱っている。例えばユーザー登録APIが`{"username":"...","password":"..."}`のみを想定していても、内部的にリクエストボディをオブジェクトへ丸ごとマッピングする実装（ORMのモデルへの直接バインドなど）であれば、攻撃者が`{"username":"...","password":"...","role":"admin"}`のように未公開フィールドを追加送信するだけで権限昇格できてしまう。これはBFLA（Broken Function Level Authorization）や垂直方向の権限昇格と密接に関連する脆弱性であり、IDOR/BOLAと合わせて理解しておくべきテーマである。

#### 第14章: Attacking GraphQL

GraphQLは単一エンドポイント（多くの場合`/graphql`）にクエリを投げる設計上、REST的なURLパスベースの認可チェックが機能しにくく、フィールド単位・リゾルバ単位で認可を実装し忘れるとBOLA/BFLAが発生しやすい。本書はイントロスペクションクエリによるスキーマ列挙、ネストしたクエリでの過剰データ取得、ミューテーションを通じた不正な更新など、GraphQL特有の攻撃面を扱っている。

> 出典: Hacking APIs — https://nostarch.com/hacking-apis

---

### InsiderPhD（Katie Paxton-Fear）『API Hacking』コース（justhacking.com）

Dr. Katie Paxton-Fear（オンラインハンドル名 InsiderPhD）が提供する動画コースで、**50本超・合計5時間以上の動画**にクイズと**クラウドホスト型の専用ラボ環境**が付属する、実践重視の教材である。価格は100ドル。前提知識について公式には「事前知識は不要だが、基本的なネットワーキング・Linux・VM操作の経験があると望ましい」とされている。

#### カリキュラムの特徴

コースはOWASP API Security Top 10全体をカバーする設計になっており、以下の内容を含む。

- **API基礎**: REST・GraphQL・gRPCといった主要プロトコルの違いと構造
- **専用ツールチェーン**: API特化のハッキングツール一式の使い方
- **API Discovery**: 隠れたエンドポイントを発見する手法
- **脆弱性分析**: APIに影響する主要な脆弱性クラス（BOLA・Mass Assignmentなど）
- **再現可能な方法論**: 場当たり的な手順ではなく、繰り返し使える体系立てたテスト手順
- **ハンズオン演習**: クラウドラボでの実践

Hacking APIs書籍が「書いて読んで手を動かす」教材であるのに対し、本コースは動画講義＋実ラボという形式で、視覚的・実践的に学びたい読者や、体系だった手順を反復練習したい読者に向いている。BOLA・Mass Assignmentを含むOWASP API Top 10全体を扱うため、IDOR/BOLAだけでなくAPIセキュリティ全般の理解を固めたい場合に適した教材である。

> 出典: API Hacking Course — https://www.justhacking.com/course/api-hacking/

---

### InsiderPhD 本人サイト（insiderphd.dev）

⚠️ **未取得の資料**: 「insiderphd.dev」は自動取得できませんでした（理由: SSL証明書エラー "certificate has expired"）。以下のURLからご自身で直接ご覧ください: https://insiderphd.dev/

（以下は未取得資料の補足として一般知識に基づく解説です。Web検索で確認できた公開情報に基づく）

Katie Paxton-Fearは、データサイエンティストからセキュリティ研究者・バグバウンティハンターへ転身した経歴を持つ。学術的にはNLP（自然言語処理）を用いたインサイダー脅威分析で博士号を取得しており、その後2019年頃からバグバウンティ・API脆弱性研究に軸足を移した。YouTubeチャンネル「InsiderPhD」は登録者7万人超（本稼働当時）を抱え、API脆弱性診断・バグバウンティ手法をわかりやすく解説する動画で知られる。Verizon Media（現Yahoo）や米国防総省（DoD）向けの脆弱性報告実績を持ち、現在はTraceable by Harness（旧Traceable AI、API/アプリケーションセキュリティ企業）でPrincipal Security Researcherを務めている（旧Bugcrowdのトリアージャー経験もある）。

InsiderPhDのYouTube動画・ブログは、IDOR/BOLAをはじめとするAPI脆弱性の「発見手順」を短い実演形式で示すことが多く、書籍・有料コースで学んだ方法論を無料コンテンツで反復・補強する目的で併用するのに適している。本人サイトはプロフィール・実績・リンク集（YouTube、Twitter/X、コース案内等）のハブとして機能しており、最新の登壇情報や公開資料へのリンクもここから辿れる。

> 出典: InsiderPhD 本人サイト（取得不可） — https://insiderphd.dev/ ／ 補足情報の出典: Infosec Institute Podcast（https://www.infosecinstitute.com/podcast/katie-paxton-fear/）、HackerOne Hacker Spotlight（https://www.hackerone.com/blog/hacker-spotlight-interview-insiderphd）、Cybersecurity Insiders（https://www.cybersecurity-insiders.com/from-accidental-hacker-to-cybersecurity-champion-the-story-of-dr-katie-paxton-fear-bug-bounty-hunter-with-hackerone/）

---

### まとめ: 3つの教材の使い分け

| 教材 | 形式 | 強み | 向いている読者 |
|---|---|---|---|
| Hacking APIs（書籍） | 読み物＋演習環境 | A-B/A-B-AテストなどBOLA判定の方法論を体系立てて明文化 | 手順を文章でじっくり理解したい人 |
| API Hacking（コース） | 動画＋クラウドラボ | OWASP API Top 10全体を反復演習で習得 | 手を動かしながら学びたい人 |
| InsiderPhD（YouTube/サイト） | 無料動画・記事 | 短時間で最新の実演を見られる | 補強・最新情報のキャッチアップ |

いずれも「防御側の視点」で読むと、A-Bテストの手順はそのまま**内部の脆弱性診断・自動テストのチェックリスト**として転用できる。認可チェックのユニットテストを書く際にも、「別ユーザーのトークンで自分のリソースIDを指定したときに拒否されるか」を機械的に検証するテストケースを用意することが、本節で紹介した方法論の最も直接的な防御応用である。
