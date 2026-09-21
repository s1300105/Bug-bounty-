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
