# 第10章 練習環境・継続学習・長文リファレンス

## 練習環境（PortSwigger/Root-Me/PentesterLab/HTB）

SSRF（Server-Side Request Forgery。サーバー自身にユーザーが指定した宛先へリクエストを発行させ、本来到達できないはずの内部リソースへアクセスさせる脆弱性クラス）は、他の脆弱性クラスと違って「対象ネットワークのトポロジー」や「内部サービスの構成」が攻撃の成否を大きく左右する。つまり座学だけでは、フィルタ回避やクラウドメタデータ搾取の「勘所」が身につきにくい。本節では、無許可の実環境への検証を一切行わずにSSRFを安全に反復練習できる、代表的な学習プラットフォーム4つを紹介する。いずれも合法的に用意されたサンドボックス環境であり、実在サービスへの無許可アクセスにはあたらない。

以降で紹介する各サービスの仕様（ラボ名、料金体系、バッジ構成など）は執筆時点（2026年9月）の情報である。学習プラットフォームはコンテンツの追加・再編が頻繁に起こるため、実際に着手する際は各サイトの最新の一覧で内容を確認してほしい。

### PortSwigger Web Security Academy — SSRFラボ（無償）

PortSwigger社（Burp Suiteの開発元）が無償で提供する「Web Security Academy」には、SSRF専用の学習パスとラボ群が用意されている。最大の特徴は、**すべてのラボが無料で、かつBurp Suite Community Edition（無償版）だけで完結する**ことだ。ラボごとに使い捨ての疑似脆弱アプリケーションが払い出され、攻撃者に許可された「自分専用のサンドボックス」内で検証するため、無許可の実環境検証という問題が生じない。

ラボは難易度別に「Apprentice（見習い）」「Practitioner（実務者）」「Expert（熟練者）」の3段階に分かれており、SSRFセクションでは概ね以下のような構成になっている。

- **Apprentice（基礎）**
  - *Basic SSRF against the local server* — アプリケーションの「在庫確認」機能が叩くURLを `http://localhost/admin` に差し替え、サーバー自身に管理画面へリクエストさせて権限を奪う、最も基本的なSSRFパターン。
  - *Basic SSRF against another back-end system* — `192.168.0.X` 帯のプライベートIPをスキャンし、外部から直接到達できない内部の管理インターフェースを発見・悪用する。SSRFが「本来到達できないネットワークセグメントへの踏み台」として機能することを体感できる。
- **Practitioner（実務レベル）**
  - *Blind SSRF with out-of-band detection*（ブラインドSSRF） — レスポンスがアプリケーション側に返らず、攻撃者が直接結果を見られないケース。Burp CollaboratorのようなOOB（out-of-band、帯域外）検知基盤にDNS/HTTPコールバックを送らせ、リクエストが実際に発生したことを外部から証明する手法を学ぶ。
  - *SSRF with blacklist-based input filter*（ブラックリスト型フィルタの回避） — `localhost` のような既知の危険な文字列を弾くだけの防御を、`127.1`（IPv4の省略表記）や大文字化、二重URLエンコードなど、パーサの実装差を突いて回避する。
  - *SSRF with filter bypass via open redirection vulnerability*（オープンリダイレクト経由のフィルタ回避） — アプリケーションが「許可ドメインへのリクエストのみ許す」ホワイトリスト風のチェックをしていても、許可ドメイン側に存在するオープンリダイレクト脆弱性を踏み台にして、リダイレクト先の任意ホストへ実質的に到達する。HTTPクライアントがリダイレクトを自動追跡する挙動を悪用する典型例。
- **Expert（発展）**として、ホワイトリスト型フィルタのバイパスや、Shellshock（Bash の環境変数解釈の脆弱性、CVE-2014-6271）と組み合わせたブラインドSSRFの悪用など、より高度な複合ラボも用意されている。

各ラボはブラウザ上の専用インスタンスで完結し、Burp Proxyでリクエストを傍受・改変しながら攻略する設計になっている。「なぜ効くのか」の解説（Web Security Academyの解説記事）とラボが一対一で対応しているため、本教科書で解説した原理（IPアドレス表記の正規化、DNSリバインディング、パーサ間の解釈差など）をそのまま手元で再現・検証できる点が最大の価値である。全ラボの一覧は `/web-security/all-labs#server-side-request-forgery-ssrf` から確認できる。

> ⚠️ **未取得の資料**: ラボ本文および `all-labs` の完全な一覧ページはボット対策により自動取得できず、上記のラボ名・構成はGitHub上の攻略記録・学習チェックリスト（`ricardojoserf/Portswigger-Labs` 等の第三者リポジトリ）とWeb検索結果を突き合わせて再構成したものである。ラボの正式名称・最新の追加分は下記URLからご自身で直接ご確認いただきたい: https://portswigger.net/web-security/ssrf 、 https://portswigger.net/web-security/all-labs#server-side-request-forgery-ssrf

> 出典: Server-side request forgery (SSRF) — PortSwigger Web Security Academy — https://portswigger.net/web-security/ssrf

### Root-Me — Web-Serverカテゴリ

Root-Me（フランス発の老舗CTF/学習プラットフォーム）は「Web-Server」カテゴリに、SSRFを含む多様なサーバーサイドWeb脆弱性のチャレンジを収録している。個々のチャレンジをクリアするとポイントが加算され、累積ポイントでランキングに反映される、ゲーミフィケーション型の学習形式が特徴だ。無料でアカウント登録するだけで多くのチャレンジに挑戦できる（一部の高度なチャレンジには追加の条件がある場合がある）。

SSRF関連では、ネーミングから内容が推測できるチャレンジがいくつか公開されている。

- **Server-Side Request Forgery** — SSRFの基本パターンを扱う、カテゴリ名そのものを冠したチャレンジ。
- **Nginx — SSRF Misconfiguration** — リバースプロキシとして広く使われるNginxの設定不備（内部専用として想定していたエンドポイントへのリクエストが、プロキシの `proxy_pass` 設定や正規表現マッチングの誤りにより外部から到達可能になる等）に起因するSSRFを扱う。これはWebアプリケーション自体のコードではなく、**インフラ設定側の不備がSSRFを生む**という、本教科書で扱った「WAF/プロキシ層の誤設定」パターンの実例として学習価値が高い。

Root-Meはこの他にも、SSRFから内部ネットワークを経由して最終的にRCE（Remote Code Execution、リモートコード実行）に到達する、より実践的な複合チャレンジ（「box」と呼ばれる仮想マシン形式の演習）を不定期に公開している。2024年6月にはリヨンで開催された「Ethical Hacking Club」イベントで、SSRF専用の限定チャレンジ8問が公開された実績もあり、SSRFはRoot-Meが継続的にコンテンツを拡充している分野の一つである。

Web-Serverカテゴリ全体では、SSRF以外にもLFI（Local File Inclusion）、SQLi、認証不備など多様な脆弱性クラスの課題が並んでおり、SSRFを他の脆弱性と組み合わせて悪用する（例: SSRFで到達した内部APIに対してさらにSQLiを仕掛ける）実践的な思考訓練にも向いている。

> ⚠️ **未取得の資料**: Root-Meの `Challenges/Web-Server/` 一覧ページはBot対策システム（Anubis）により自動取得がブロックされた（アクセス拒否）。代替としてGitHub上の攻略記録（`El-Palomo/Server-Side-Request-Forgery---RootMe`）やWeb検索結果から、SSRF関連チャレンジの存在と名称のみ確認できた。チャレンジの総数・難易度・ポイント配分など詳細は下記URLからご自身で直接ご確認いただきたい: https://www.root-me.org/en/Challenges/Web-Server/
>
> （以下は未取得資料の補足として一般知識に基づく解説です）Root-Meは各チャレンジに難易度（Very Easy〜Hard相当）とポイント値が個別に設定されており、ポイントはチャレンジの解答の見つけにくさ・要求される前提知識量におおむね比例する。多くのWeb-Serverチャレンジは、ブラウザから直接、あるいは`curl`等のHTTPクライアントから到達できる専用インスタンス上で完結し、Burp SuiteなどのプロキシツールでHTTPリクエストを観察・改変しながら攻略する点はPortSwiggerと共通している。

> 出典: Web-Server Challenges — Root-Me — https://www.root-me.org/en/Challenges/Web-Server/

### PentesterLab — SSRF系Exercise（バッジ制）

PentesterLabは、実際の脆弱なコード・設定を模したハンズオン演習（Exercise）を、テーマ別の「バッジ」にまとめて提供するプラットフォームである。演習には難易度アイコン（Easy/Medium/Hard）が付き、SSRFタグで絞り込むと専用の演習群が表示される。無料（Free）演習と、有料会員（PRO）限定演習が混在しており、代表的なSSRF演習には次のようなものが確認できる。

- **Server Side Request Forgery 01〜04** — 基礎から段階的に難易度が上がる連番シリーズ。特に *SSRF 04* は「`assets.pentesterlab.com` にマッチさせるための正規表現が甘く、細工したホスト名で回避できる」という、ホスト名検証の正規表現不備を題材にしている。本教科書で扱った「ホワイトリスト検証を文字列パターンマッチで実装する際のありがちな落とし穴（部分一致・アンカー漏れ・サブドメイン許可の誤り）」を、実際の脆弱な正規表現を通じて体感できる好例である。
- **SSRF in PDF generation** — HTML/CSSをPDFに変換するライブラリ「WeasyPrint」を題材に、PDF生成機能がユーザー入力のURL・HTMLを取り込んでレンダリングする際に発生するSSRFを扱う。帳票・請求書生成機能など、実務でも頻出するSSRF発生源（HTML-to-PDF変換）の典型例。
- **SSRF via FFMPEG** — 動画処理ライブラリFFmpegが対応する一部の入力フォーマット（HLSプレイリスト等、URLを内部に含められる形式）を悪用し、動画アップロード・変換機能を通じてサーバーにファイルシステム上の内容を読み取らせる（ローカルファイルの内容をSSRF経由で外部に漏らす）高度な演習。メディア処理パイプラインがSSRFの温床になりうることを示す実例である。

これらのSSRF演習は「Essential Badge」など、Web初級者向けの幅広い脆弱性を扱うバッジに含まれている場合が多い。バッジは複数の演習をまとめたコースのような単位で、一定数の演習をクリアするとバッジ取得としてプロフィールに記録される仕組みになっている。無料演習は月替りで一部無料公開される「Free Labs of the Month」制度もあるため、まず無料範囲でSSRF演習に触れ、興味が持てればPRO会員登録を検討するとよい。

> ⚠️ **未取得の資料**: PentesterLabのSSRF演習の完全な一覧（全件数・最新の演習名・PRO/Free区分の詳細）は自動取得できたページ内容だけでは網羅できなかった。個別演習ページ（例: `ssrf_04`, `pdf_ssrf`, `ffmpeg_ssrf`）はWeb検索結果のタイトルから存在を確認したのみで、本文までは取得していない。最新の一覧・料金体系はご自身で直接ご確認いただきたい: https://pentesterlab.com/exercises （SSRFタグで絞り込み: `https://pentesterlab.com/exercises?filters=ssrf`）

> 出典: Penetration Testing, Security Code Review and Web App Security Exercises — PentesterLab — https://pentesterlab.com/exercises

### HackTheBox Academy — Server-side Attacksモジュール

HackTheBox（HTB）が提供する教育プラットフォーム「HTB Academy」には、SSRF・SSTI（Server-Side Template Injection、テンプレートエンジンへのコード注入）・SSI Injection（Server-Side Includes注入）・XSLT Injectionなど、**サーバー側で発生する多様なインジェクション系脆弱性を横断的に扱う「Server-side Attacks」モジュール**が用意されている（難易度: Medium、全19セクション構成）。

このモジュールの構成は、単発のラボを解くPortSwigger/Root-Me/PentesterLabとは毛色が異なり、「講義パート（原理・コード例の解説）」と「ハンズオン演習パート（実際に動く疑似脆弱環境での攻略）」が交互に配置された、**体系立ったコースウェア**になっている点が特徴である。SSRFについては「ユーザー入力に基づいてサーバーが外部HTTPリクエストを発行する際の危険性、内部システムへの到達、ファイアウォール回避、機密情報の窃取」という基本原理から解説が始まり、実践演習を通じて段階的に攻略していく構成になっている。モジュール末尾には、それまでの内容を横断的に問う「Skills Assessment（総合演習）」が用意されており、単一の脆弱性パターンの暗記ではなく、複数の攻撃面を組み合わせて自力で脆弱性を発見・悪用する応用力を試される。

なお、SSRFのフィルタ回避に関するさらに発展的な内容（DNSリバインディング、すなわちDNSの名前解決結果を初回検証後に書き換えて、検証時と攻撃時で異なるIPアドレスを指させる手法など）は、より難易度の高い「Modern Web Exploitation Techniques」モジュール（Hard、全18セクション）で扱われている。SSRFの基礎を固めたら、次のステップとしてこちらに進むとよい。

HTB Academyは無料アカウントでも一部モジュールの冒頭セクションに触れられる「Free tier」があり、モジュール全体やSkills Assessmentを含む完全な学習には、Silver/Gold等の有料サブスクリプション、または各種HTB認定資格（例: CBBH = Certified Bug Bounty Hunter）のバンドル購入が必要になる場合がある。料金体系はしばしば改定されるため、着手前に最新のプラン内容を確認することを推奨する。

> ⚠️ **未取得の資料**: HTB AcademyトップページはSPA（Single Page Application）的な構成のためモジュール一覧の詳細テキストを自動取得できず、「Server-side Attacks」モジュール本体のページ本文（各セクションの見出し、Free/Paid区分の正確な境界）も取得できなかった。Web検索結果（モジュール概要・受講者の攻略記録）から構成を再構成しているため、最新の正確な内容・料金は下記からご自身で直接ご確認いただきたい: https://academy.hackthebox.com/ （モジュール直接リンク: `https://academy.hackthebox.com/course/preview/server-side-attacks`）

> 出典: HackTheBox Academy — https://academy.hackthebox.com/

### 学習プラットフォームの使い分け方針

4つのプラットフォームはそれぞれ強みが異なるため、本教科書のここまでの章（SSRFの原理・フィルタ回避・クラウドメタデータ悪用など）を読了した読者には、以下の順序での学習を推奨する。

1. **PortSwigger Web Security Academy**（無料・Burp Community版で完結）で、Apprentice→Practitionerを一通り攻略し、ブラックリスト回避・オープンリダイレクト経由の回避・ブラインドSSRFのOOB検知という3つの核心パターンを手を動かして体得する。
2. **PentesterLab**のSSRFシリーズで、正規表現の実装不備やPDF生成・メディア処理パイプラインなど、「アプリケーションのどの機能がSSRFの発生源になりうるか」という実務目線の引き出しを増やす。
3. **Root-Me**のWeb-Serverカテゴリで、インフラ設定不備（Nginx誤設定）起因のSSRFや、SSRFを起点とした複合的な攻撃チェーンに挑戦し、単体の脆弱性ではなくチェーン全体を組み立てる訓練を行う。
4. **HTB Academy**の「Server-side Attacks」および「Modern Web Exploitation Techniques」で、SSRFを他のサーバーサイド脆弱性（SSTI等）と横断的に扱う体系だった学習を仕上げとして行う。

いずれのプラットフォームも、演習用に払い出される専用インスタンス・サンドボックス内で完結する設計になっている。本教科書で解説した技法を、これらの許可された環境の外——すなわち実在の本番サービスや、自分が明示的な許可を得ていない対象——に対して試みることは、法令上・利用規約上の重大な問題を引き起こしうるため、決して行ってはならない。

---

## 継続学習：最新研究と公開レポート

SSRF（Server-Side Request Forgery。サーバがクライアントの代わりにリクエストを発行する機能を悪用し、攻撃者が本来到達できない内部リソースへ間接的にアクセスさせる脆弱性クラス）は、WAF（Web Application Firewall）やアプリケーション側の防御が進化するたびに、それを回避する新しい研究が発表されてきた分野です。本節では、最新の研究動向を追い続けるための3つの情報源――PortSwigger Research、HackerOneのHacktivity（公開脆弱性レポート集）、AllThingsSSRF（研究・実例の集約リポジトリ）――を、それぞれの使い方と重要な技術的知見とともに紹介します。

### 1. PortSwigger Research — 最先端のWeb研究

> 出典: PortSwigger Research（トップページ） — https://portswigger.net/research

PortSwigger Researchは、James Kettle（ハンドル名 albinowax）率いるPortSwigger社の研究チームが、HTTP Request Smuggling（リクエストスマグリング）やSSRFに隣接する「サーバ間の解釈の不一致」を突く研究を継続的に公開しているハブです。2026年8月時点で公開されている最新論文には以下が含まれます。

- **"CRLF-Powered Desync Attacks: Beheading HTTP Streams"**（2026年8月5日）
- **"Can AI do novel security research? Meet the HTTP Terminator"**（2026年8月5日）
- **"What's in a tag name? JavaScript, apparently"**（2026年8月25日）
- **"CSS: the bomb inside your inbox"**（2026年8月6日）
- **"The Fragile Lock: Novel Bypasses For SAML Authentication"**（2025年12月10日）

このうちSSRF学習者が特に押さえておくべきは **"CRLF-Powered Desync Attacks: Beheading HTTP Streams"**（Tobia Righi氏との共著）です。

> ⚠️ **未取得の資料の補足**: 本論文の全文はPortSwigger Researchのページ内リンクからのみ到達でき、自動取得ではヘッダーとナビゲーションのみが取得できました。以下は検索結果に基づく要約であり、詳細は原文（https://portswigger.net/research/crlf-powered-desync-attacks ）をご自身でご確認ください。（以下は未取得資料の補足として一般知識に基づく解説です）

**なぜSSRFの教科書でHTTPデシンク研究を学ぶ必要があるのか**。SSRFは「アプリケーションが到達すべきでない宛先へリクエストを送らせる」脆弱性ですが、HTTPリクエストスマグリング／デシンクは「同じTCPコネクション上で、フロントエンド（リバースプロキシ・CDN・ロードバランサ）とバックエンドが“どこまでが1つのHTTPリクエストか”について異なる解釈をする」ことに起因します。この解釈のズレは、SSRFの根本原因である「URLパーサ・プロトコルパーサの実装差異」と同じ構造を持ちます。すなわち、**同じ入力に対して複数のパーサが異なる結果を返すとき、そのギャップが攻撃面になる**という原則です。

CRLF-Powered Desync Attacksの核心は、HTTPヘッダインジェクション（CRLF = Carriage Return + Line Feed、`\r\n`をヘッダ値に注入してヘッダ境界を偽装する攻撃）を軽視すべきでないという指摘です。従来「ヘッダインジェクションはCookie固定化程度の影響」と見なされがちでしたが、この研究は単純なヘッダインジェクションのプリミティブ（悪用可能な最小単位の脆弱性）を、フロントエンド・バックエンド間のコネクションを丸ごと乗っ取る「デシンクワーム」に発展させる手法を示しました。さらに、IPロックやコネクションロックが施された環境でも、デシンクの実行位置を**被害者のブラウザ側にシフトさせる**ことで、ブラウザ経由でXSS（クロスサイトスクリプティング）を誘発し、HTTPOnly属性の付いたCookie（JavaScriptから読み取れないよう保護されたCookie）を窃取する新手法も報告されています。研究チームはこれを検出するための「CRLF-Powered Desync Scanner」（Burp Suite用拡張）も公開しました。

SSRFとの接点として重要なのは、SSRFの防御でよく使われる「送信元IPやDNS解決結果に基づくリバースプロキシでのフィルタリング」が、フロントエンドとバックエンドの間のプロトコル解釈が食い違っている場合、**フィルタを迂回してバックエンドに直接届く別のリクエストを密輸できてしまう**点です。SSRF対策を「サーバサイドのアウトバウンドリクエストだけ」に限定して考えるのではなく、インバウンド側のプロトコル解析の一貫性も含めて設計する必要があるという教訓が得られます。

もう一つの注目トピック **"Can AI do novel security research? Meet the HTTP Terminator"** は、AI支援（LLMを使ったファジングやパターン発見）によって新規のHTTPデシンク手法とApacheのゼロデイ脆弱性が発見された事例です。これは、SSRFやリクエストスマグリングのような「パーサの実装差異」に起因する脆弱性クラスが、今後は人手による発見だけでなく、AIを用いた大規模な差分ファジング（複数実装に同じ入力を与えて出力の差異を探す手法）によって継続的に発見されていくことを示唆しています。防御側としては、自組織のプロキシ／アプリケーションの構成についても、こうした自動化ツールでの継続的な差分テストを検討する価値があります。

**学び方の実践的アドバイス**: PortSwigger Researchは論文単位で完結度が高いため、新しい論文が出るたびに「①どのパーサ・プロトコルの解釈差異を突いているか」「②その差異がなぜ生まれるか（実装のどの層で発生するか）」「③どう防御するか」の3点を自分の言葉でメモに残す習慣をつけると、SSRF・デシンク系の脆弱性を横断的に理解する力が育ちます。

### 2. HackerOne Hacktivity — 公開レポートで学ぶ実例

> 出典: HackerOne Hacktivity — https://hackerone.com/hacktivity

> ⚠️ **未取得の資料**: HackerOneのHacktivityページおよび個別レポートページはJavaScriptで動的にレンダリングされるSPA（Single Page Application）であり、自動取得（WebFetch）ではヘッダー情報のみが返され、レポート本文を直接抽出できませんでした。フィルタ操作や個別レポートの全文は、以下のURLからご自身で直接ご覧ください: https://hackerone.com/hacktivity （検索ボックスに `SSRF` と入力し、Severity・Disclosed日付でソートすると学習効率が上がります）

Hacktivityは、HackerOne上でプログラム（企業側）が開示（disclose）に同意した脆弱性レポートを一覧できる公開データベースです。SSRFで絞り込むと、実際にどのような機能（Webhook、画像URL取り込み、PDF生成、URLプレビュー機能など）が悪用されたか、発見からエスカレーション、トリアージまでの流れを生の一次情報として追体験できます。（以下は未取得資料の補足として、検索により確認できた公開レポートの概要に基づく一般知識の解説です）

代表的なパターンを3つ紹介します。

**(1) Webhook機能を悪用したSSRF（Omise社の事例）**
> 出典: Omise disclosed on HackerOne: SSRF in webhooks leads to AWS private... — https://hackerone.com/reports/508459

決済サービスを提供するOmise社では、ユーザが登録できる「Webhook URL」（イベント発生時にアプリケーションがPOSTリクエストを送る通知先URL）の検証が不十分で、任意のURLを指定できました。これにより攻撃者はサーバに `http://169.254.169.254/latest/meta-data/` （AWS/GCP/Azureなどクラウド環境で、インスタンスにIAMロールの一時認証情報や内部設定を提供する**メタデータエンドポイント**。169.254.169.254は「リンクローカルアドレス」と呼ばれる特殊な予約IPで、外部ネットワークからはルーティングされずインスタンス自身からのみ到達可能）へのリクエストを送らせ、AWSの一時的なIAMクレデンシャル（アクセスキー・シークレットキー・セッショントークン）を窃取できる状態でした。

**なぜこれが成立するか**: Webhook機能は「ユーザが指定した任意のURLに、サーバがHTTPリクエストを送る」という、SSRFの定義そのものを製品機能として実装したものです。多くの開発者は「Webhook先は外部の一般サイトだろう」という前提でURL検証を軽視しがちですが、検証をしなければサーバ自身のクラウドメタデータエンドポイントも「送信先URL」として受け付けてしまいます。防御としては、送信先URLに対して①スキームの許可リスト化（`http`/`httpsのみ`）、②DNS解決後のIPアドレスに対するプライベート・リンクローカルアドレス帯（`127.0.0.0/8`、`10.0.0.0/8`、`169.254.0.0/16`など）の拒否、③リダイレクトを追跡する際も同じ検証を毎回適用する、という多層防御が必須です。

**(2) 政府機関プログラムにおけるAWSメタデータへのフルリードSSRF**
> 出典: U.S. Dept Of Defense disclosed on HackerOne: SSRF ACCESS AWS... / SSRF to read AWS... / Full read SSRF at... — https://hackerone.com/reports/1623685 , https://hackerone.com/reports/1624140 , https://hackerone.com/reports/1628102

米国防総省（DoD）の脆弱性開示プログラムでは、URLパラメータ経由でアプリケーションサーバに任意のURLを取得させる機能（画像取り込みやプロキシ的な処理など)に対し、AWSメタデータエンドポイントのパスを指定することでIAMロールの認証情報や内部設定情報を読み取れる「フルリード（full read）」SSRFが複数件報告されています。

**トリアージ・エスカレーションの学びどころ**: これらのレポートは、単に「メタデータが読めた」ことを示すだけでなく、盗んだ一時クレデンシャルを使って実際にAWS API（例: `aws sts get-caller-identity` でクレデンシャルの権限範囲を確認する、`aws s3 ls` でアクセス可能なS3バケットを列挙する）を叩き、**実際にどこまで影響が及ぶか（Blast Radius）を実証する**ところまでを報告に含めるのが高評価レポートの定石です。IAMロールが過剰な権限（例: 全S3バケットへのフルアクセス）を持っていた場合、SSRF単体のCVSSスコアより遥かに高いCriticalレーティングでトリアージされる根拠になります。防御側の教訓としては、**インスタンスに付与するIAMロールは最小権限の原則に従うこと**、そしてIMDSv2（AWSのメタデータサービスv2。トークンベースの認証を要求し、単純なGETリクエストだけでは取得できないようにする対策）への移行が極めて有効な緩和策であることが分かります。

**(3) HackerOne自身のプラットフォームにおける$25,000のSSRF**
> 出典: $25,000 SSRF in HackerOne's Analytics Reports (OSINT Team, Medium) — https://osintteam.blog/25-000-ssrf-in-hackerones-analytics-reports-b9a5b3aa3d6e

HackerOne自身が運用するAnalytics（分析レポート）機能において、ユーザ入力に含まれる`<iframe>`タグがサーバサイドでレンダリングされる過程を悪用し、`iframe`の`src`属性経由でサーバにリクエストを発行させ、AWSの一時認証情報を窃取できた事例です。

**なぜこれが成立するか**: PDF生成やスクリーンショット生成機能では、サーバ側でHeadless Chrome（画面表示なしで動作するブラウザエンジン）などを使ってHTMLをレンダリングすることが一般的です。この「サーバ側でHTMLをレンダリングする」という処理自体が、ブラウザに任意のURLへリクエストを発行させる機能そのものであり、ユーザ制御下のHTML/CSS/SVGが許可されている場合、`<img src="http://169.254.169.254/...">` や `<iframe>` のようなタグ経由で間接的にSSRFが成立します。これは「Blind SSRF（レスポンスが直接返らないSSRF）」の典型例でもあり、レンダリング結果のスクリーンショットやPDFにメタデータの内容が写り込むことで攻撃者が情報を取得できる、という間接的なデータ持ち出し経路（exfiltration channel）を理解する好例です。

### 3. AllThingsSSRF — 研究・実例の集約リポジトリ

> 出典: AllThingsSSRF (jdonsec) — https://github.com/jdonsec/AllThingsSSRF

AllThingsSSRFは、SSRFに関する教育資料・高度な攻撃手法・実世界の脆弱性事例・実践ツールを一箇所に集約したキュレーションリポジトリです。教科書的な体系立てはされていませんが、「SSRF研究の索引」として非常に有用です。主な構成は以下の通りです。

**教育資料**: Vickie Li氏やDetectify、Netsparker（現Invicti）といったセキュリティ研究者・ベンダーによる基礎解説、URLパーサの悪用に特化した技術深掘り記事、SSRF対策のチートシート類がまとめられています。

**高度な攻撃手法（バイパス技術）**: 以下のような手法へのリンクが集約されています。

- **URLパーサの実装差異**を突く手法。前述のOrange Tsai氏の研究（後述）に代表される、プログラミング言語間でのURL解釈の不一致を利用したものです。
- **IPv4アドレス表記のゆらぎを利用したバイパス**。例えば `127.0.0.1` を10進整数表記の `2130706433`、8進表記の `0177.0.0.1`、または短縮表記の `127.1` に変換すると、単純な文字列一致による拒否リスト（denylist）を回避できることがあります。これは、多くのHTTPクライアントライブラリの内部で使われるIPパース関数（例: C言語の`inet_aton`系関数）が、正規のドット区切り10進表記以外の形式も「正しいIPアドレス」として受理してしまう歴史的経緯に起因します。
- **DNSピニング／DNSリバインディング攻撃**。アプリケーションが「ドメイン名を検証した後、実際に接続する際に再度DNS解決する」設計になっている場合、検証時と接続時でDNSの応答を異なる値に切り替える（TTLを極端に短く設定し、最初は許可されたIP、2回目は内部IPを返す）ことで、URL検証をすり抜けて内部ネットワークへ到達できます。これはTOCTOU（Time-Of-Check to Time-Of-Use。検証した時点と実際に使う時点の間に状態が変化してしまう競合状態の脆弱性クラス）の一種です。
- **CRLFインジェクションとプロトコル悪用の組み合わせ**（例: `git://` スキームとの組み合わせ）。URLの一部にCRLFを注入し、`gopher://` や `git://` のような生のTCPプロトコルをエミュレートできるスキームと組み合わせることで、HTTP以外のプロトコル（Redis、Memcached、SMTPなど）に対して任意のコマンドを注入する「プロトコルスマグリング」が可能になります。
- **クラウドメタデータサーバへのアクセス**、**権限昇格チェーンの構築**。

**Orange Tsai氏の貢献**: 2つの重要な研究がハイライトされています。

1. **"A New Era of SSRF"**（Black Hat USA 2017 / Black Hat Asia 2018）
   > 出典: A New Era of SSRF - Exploiting URL Parser in Trending Programming Languages!（Black Hat公式資料） — https://blackhat.com/docs/us-17/thursday/us-17-Tsai-A-New-Era-Of-SSRF-Exploiting-URL-Parser-In-Trending-Programming-Languages.pdf

   この研究は、Python・PHP・Perl・Ruby・Java・JavaScript・Wget・cURLといった主要言語・ツールのURLパーサに対して差分ファジング（同一の入力を複数の実装に与え、出力結果の違いを機械的に洗い出す手法）を行い、複数のゼロデイ脆弱性を発見したものです。

   **技術的な核心**: 多くのアプリケーションは「URLを検証するパーサ（バリデータ）」と「実際にリクエストを送信するHTTPクライアント」が**別々の実装**であることが多く、両者が同じRFC（URLの仕様）を実装していても、エッジケースの解釈が異なることがあります。例えば検索過程で確認された具体例として、Pythonの`urllib.parse.urlparse`と`requests`/`aiohttp`ライブラリの間では、URL中にバックスラッシュ（`\`）・タブ（`\t`）・CR（`\r`）・LF（`\n`)が含まれる場合の扱いが食い違うケースがあります。`urlparse`はバックスラッシュを userinfo（`user:password@`部分）の一部として扱う一方、`requests`側はそれをパスの開始位置として解釈する、といった不一致です。

   ```
   例（概念図・原理説明目的。実サービスへの適用は禁止）:
   検証コード:  urlparse("http://trusted.example.com\\@evil.internal/") 
                → ホストは "trusted.example.com" と判定（許可リストを通過）
   実際の送信:  requests.get("http://trusted.example.com\\@evil.internal/")
                → 実際の接続先ホストは "evil.internal" と解釈される
   ```

   **なぜこれが起きるのか（仕組みレベル）**: URLの標準仕様には歴史的にWHATWG URL Living Standard（ブラウザベンダが主導する「実装に追従する」仕様）とRFC 3986（IETFが定めた「規範的」仕様）という2系統が存在し、細部の解釈が異なります。さらに個々のライブラリはどちらの仕様にも完全準拠していないことが多く、実装ごとに独自の妥協や歴史的な互換性維持コードが残っています。その結果、「バリデータが見ているホスト名」と「実際に接続されるホスト名」が乖離する余地が生まれます。これは本教科書の他章で解説したURL構文解析の原理（スキーム・authority・userinfo・host・port・path の境界判定）が、実装によって揺らぐことの具体例です。防御としては、**検証と送信を同一のパーサ実装で行う**、**URLを分解して得たホスト・スキームの値をそのまま許可リスト判定に使い、文字列全体でのマッチングに頼らない**、**送信直前に解決済みIPアドレスに対しても再検証する**ことが挙げられます。

2. **GitHub Enterprise脆弱性チェーン（SSRFからRCEへ）**

   Orange Tsai氏は、GitHub Enterprise（オンプレミス版GitHub）に対し、4つの脆弱性を連鎖させてSSRFからRCE（Remote Code Execution。リモートからの任意コード実行）まで到達するチェーンを実証しました。これは「SSRF単体のリスクは低く見えても、内部ネットワークの別サービス（管理画面、内部API、デシリアライズ処理を持つサービスなど）へ到達できれば、それらのサービス固有の脆弱性と組み合わさって致命的な影響に発展する」という、SSRFのリスク評価における最重要原則を示す事例です。SSRFの深刻度を評価する際は「どこに到達できるか」だけでなく「到達先で何が起きるか」まで連鎖的に検討する必要があります。

**実世界の事例集**: Slack・GitHub・GitLab・AWS関連サービスなど、60件以上のプラットフォームにおける実例が集約されています。特に画像・動画処理系（FFmpeg、ImageMagick）における「ファイル処理中にURLを内部的にフェッチする」経路や、Jira連携によるAWS情報漏えいなど、**ユーザから見えにくい内部処理がSSRFの温床になりやすい**という傾向が読み取れます。

**ツール**: SSRF Proxy（Daeken氏によるプロキシ経由の防御テストフレームワーク）、SSRFTest（自動化テストスイート）、httprebind（DNSリバインディングを実演するためのツール）などが紹介されています。これらは自組織の防御機構（許可リスト、プロキシ設定）が実際にDNSリバインディングやIP表記ゆらぎに耐性があるかを、許可された環境下で検証する目的にのみ使用してください。

**演習リソース**: PortSwiggerのWeb Security Academyのハンズオンラボ、PentesterLabの4部構成SSRFコース、CTF形式の演習（Bugbounty Notes、HackerOne主催CTFなど）へのリンクも含まれており、本教科書と併用することで実践的な理解を深められます（本教科書自体はラボの具体的な攻略手順を扱いません。各プラットフォームの利用規約に従い、許可された環境でのみ演習してください）。

### まとめ：継続学習の進め方

SSRFという脆弱性クラスは、単一の「決定版」対策が存在するわけではなく、①URL・プロトコルパーサの実装差異、②DNS解決のタイミング差、③クラウド環境特有のメタデータ経路、④HTTP以外のプロトコルへのスマグリングという複数の切り口から、研究者が継続的に新しい迂回路を発見し続けています。本節で紹介した3つの情報源は役割が異なります。

- **PortSwigger Research**は「根本原理（パーサ・プロトコル解釈の不一致）の最先端」を追うのに向いています。
- **HackerOne Hacktivity**は「実際のプロダクトでその原理がどう具体的な脆弱性として現れるか」という実例を学ぶのに向いています。
- **AllThingsSSRF**は「体系的な索引」として、両者を橋渡しし、過去の重要研究への到達点を提供します。

これら3つを定期的に巡回し、新しい論文・レポートが出るたびに「どのパーサ／プロトコルの解釈差異が突かれたか」「自組織の実装は同じ差異を持っていないか」を自問する習慣が、SSRF対策を継続的に最新化する最も確実な方法です。

---

## ナビゲーション

← [第9章 防御・検出・修正](09-defense.md)  ｜  [📚 目次（ホーム）](index.md)
