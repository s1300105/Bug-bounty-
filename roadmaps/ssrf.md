# SSRF（サーバサイドリクエストフォージェリ）習得ロードマップ：初級者から専門家へ

バグバウンティ／脆弱性リサーチ向けに、SSRF を深く極めるための段階別学習パス。英日両方の資料を収録。各段階で「読む＋手を動かす」をセットにすること — これはリンク集ではなくカリキュラムです。二次資料（解説記事・ラボ・チートシート・研究ライトアップ）を主軸にしています。

## 要点（TL;DR）

- SSRF の習得は10段階で進める：基礎 → 基本悪用（内部到達・ポートスキャン）→ Blind/OAST → クラウドメタデータ奪取 → **URLパーサ/フィルタ回避（核心）** → プロトコルスマグリング→RCE → 応用・現代トピック → ツール → 防御 → 練習・継続。無償で最良の背骨は **PortSwigger Web Security Academy**。
- SSRF の「浅い」と「深い」を分けるのは、①**URLパーサ差異を突くフィルタ回避**（Orange Tsai の研究が原点）と、②**gopher によるプロトコルスマグリングで内部サービス（Redis 等）を叩いて RCE に持ち込む**技術。この2つに時間を投資する。
- **クラウドメタデータ（IMDS）** を独立した段として厚めに扱う。ただし現代は **IMDSv2** が既定で、単純な GET だけの SSRF では資格情報を抜けないことが多い — この前提を最初に押さえる。
- 攻撃技法の深掘りは圧倒的に英語（HackTricks、PayloadsAllTheThings、PortSwigger、Orange Tsai）。日本語は基礎・防御（IPA、徳丸本、Securify、MDN JP）が強い。攻撃系は英語で読む前提で計画する。

## 主要な所見

- 無償・体系的なカリキュラムとして最良なのは PortSwigger の Web Security Academy。SSRF 専用トピックに理論＋インタラクティブなラボがある。段階1〜3・5の背骨として使う。
- 不可欠なチートシート／収集リポジトリは **PayloadsAllTheThings（SSRF）**、**HackTricks（SSRF / Cloud SSRF）**、そして SSRF 専門の資料集 **AllThingsSSRF**。
- URLパーサ回避の原典は Orange Tsai「A New Era of SSRF」（Black Hat USA 2017 / Asia 2018）。パーサとリクエスタの解釈のズレを突くという、今も通用する一般手法。二次的な読みやすい解説（Intigriti、PayloadsAllTheThings）と併読する。
- クラウドの現実：IMDSv2 は PUT でトークンを取得し HTTP ヘッダで送る方式のため、ヘッダを制御できない通常の SSRF では悪用が難しい。**IMDSv1 が有効か**が、資格情報奪取ルートを追う価値があるかの分岐点になる。
- ツールは **SSRFmap**（自動ファジング／悪用）と **Gopherus**（gopher ペイロード生成で Redis/MySQL/FastCGI/Memcached 等を叩き RCE）が定番。**interactsh** / **Burp Collaborator** で OAST 検出。

## 詳細

### 段階1 — 基礎：SSRFとは、メンタルモデル、影響の分類

目標：サーバが「攻撃者が指定した宛先へリクエストを送る」構図と、なぜそれが危険か（内部サービス到達、クラウドメタデータ、ポートスキャン、file:// でのローカル読み取り）を理解する。まず読み、簡単なラボで具体化してから次へ。

- PortSwigger — What is SSRF: https://portswigger.net/web-security/ssrf — 平易な英語の定番入門。ここから始める。
- OWASP SSRF（コミュニティページ）: https://owasp.org/www-community/attacks/Server_Side_Request_Forgery — 簡潔な定義＋影響の分類。
- OWASP WSTG — Testing for SSRF: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/19-Testing_for_Server-Side_Request_Forgery — プロのテスト方法論の枠組み（WSTG-INPV-19）。
- Intigriti — SSRF: A Complete Guide: https://www.intigriti.com/researchers/blog/hacking-tools/ssrf-a-complete-guide-to-exploiting-advanced-ssrf-vulnerabilities — 入門から応用まで一気通貫の良質な二次解説。段階1・5で戻ってくる。
- （日本語）MDN — サーバーサイドリクエストフォージェリー（SSRF）: https://developer.mozilla.org/ja/docs/Web/Security/Attacks/SSRF — 日本語で定義・仕組み・対策を簡潔に。
- （日本語）Securify — SSRFとは？（実演動画あり）: https://www.securify.jp/blog/server-side-request-forgery/ — 混入しやすいパターンと回避手口を日本語で。

### 段階2 — 基本の悪用：内部/localhost 到達、内部ポートスキャン、file:// ローカル読み取り

目標：URL を差し替えて内部専用のサービス（localhost の管理画面など）に到達する、レスポンス時間差で内部ポートをスキャンする、file:// でローカルファイルを読む。しっかり反復する。

- PortSwigger — Basic SSRF against localhost（ラボ）: https://portswigger.net/web-security/ssrf/lab-basic-ssrf-against-localhost — 最初の一歩。
- PortSwigger — Basic SSRF against a back-end system（ラボ）: https://portswigger.net/web-security/ssrf/lab-basic-ssrf-against-backend-system — 内部 IP レンジへの到達。
- HackTricks — SSRF: https://book.hacktricks.xyz/pentesting-web/ssrf-server-side-request-forgery — 到達技法・スキーム・ポートスキャンの網羅リファレンス。
- PayloadsAllTheThings — SSRF README: https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/README.md — localhost 到達、フィルタ回避、スキーム別のペイロード集。
- （日本語）Zenn（chot）— SSRF攻撃について知ってもらう: https://zenn.dev/chot/articles/88ea57e3108978 — 脆弱なサンプルサイトで挙動を追う日本語ハンズオン解説。

### 段階3 — Blind SSRF と OAST/OOB 検出

目標：直接のレスポンスが返らない場所で SSRF を見つける。OAST（Burp Collaborator / interactsh）で DNS・HTTP のコールバックを観測し、盲目状態でも存在を確認・影響評価する。

- PortSwigger — Blind SSRF: https://portswigger.net/web-security/ssrf/blind — blind SSRF の定義と影響。
- PortSwigger — Blind SSRF with out-of-band detection（ラボ）: https://portswigger.net/web-security/ssrf/blind/lab-out-of-band-detection — Collaborator でのコールバック検出。
- interactsh（OAST ツール）: https://github.com/projectdiscovery/interactsh — Collaborator 代替の OOB 相互作用サーバ。
- （実例）Just Gopher It — Blind SSRF を RCE に上げて $15k（Yahoo Mail）: https://sirleeroyjenkins.medium.com/just-gopher-it-escalating-a-blind-ssrf-to-rce-for-15k-f5329a974530 — 302 リダイレクト＋レスポンス時間差での内部ポートスキャンから gopher 悪用までの実戦記。

### 段階4 — クラウドメタデータの悪用（IMDSv1/v2、GCP、Azure、コンテナ/K8s）

目標：`169.254.169.254`（AWS IMDS）などのリンクローカルなメタデータエンドポイントに SSRF で到達し、IAM 一時資格情報を奪う。IMDSv1 と IMDSv2 の差、盗んだ資格情報の使い方、コンテナ/ECS/K8s のメタデータまで理解する。

- Hacking the Cloud — Steal EC2 Metadata Credentials via SSRF: https://hackingthe.cloud/aws/exploitation/ec2-metadata-ssrf/ — IAM ロールの確認〜資格情報取得の手順を丁寧に。
- HackTricks — Cloud SSRF: https://hacktricks.wiki/en/pentesting-web/ssrf-server-side-request-forgery/cloud-ssrf.html — AWS/GCP/Azure/ECS の各エンドポイントとスクリプト集。IMDSv2 のトークン方式も解説。
- Yassine Aboukir — Exploitation of an SSRF against EC2 IMDSv2: https://www.yassineaboukir.com/blog/exploitation-of-an-SSRF-vulnerability-against-EC2-IMDSv2/ — IMDSv2 環境での実悪用の二次ライトアップ。user-data からの資格情報漏洩例も。
- F5 Labs — Campaign Targets Amazon EC2 Instance Metadata via SSRF: https://www.f5.com/labs/articles/campaign-targets-amazon-ec2-instance-metadata-via-ssrf — 実際の攻撃キャンペーンと、IMDSv2 移行が効く理由。
- Resecurity — SSRF to AWS Metadata Exposure: https://www.resecurity.com/blog/article/ssrf-to-aws-metadata-exposure-how-attackers-steal-cloud-credentials — 影響（S3 データ取得・EC2 列挙・横展開）の全体像。
- 背景：2019年の Capital One 侵害（1億人超）は SSRF で AWS メタデータに到達し資格情報を奪取した代表例。なぜ SSRF がクラウドで致命的かの原点として押さえる（上記各記事で言及）。

### 段階5 — URLパーサ／フィルタ・allowlist 回避【核心】

目標：SSRF 対策（denylist / allowlist / スキーム制限）を潜り抜ける。DNS rebinding（TOCTOU）、代替 IP 表記（10進/8進/16進、IPv6、IPv4-mapped、`0.0.0.0`、`[::]`）、302 リダイレクト誘導、`@`（userinfo）トリック、**パーサとリクエスタの解釈差（parser confusion）**、URL 中の CRLF 注入。ここが SSRF 習熟の中核。

- PortSwigger — SSRF with blacklist-based input filter（ラボ）: https://portswigger.net/web-security/ssrf/lab-ssrf-with-blacklist-filter — 大文字小文字・二重エンコード等での denylist 回避。
- PortSwigger — SSRF with whitelist-based input filter（ラボ）: https://portswigger.net/web-security/ssrf/lab-ssrf-with-whitelist-filter — `@` / `#` / サブドメインを使った allowlist 回避。
- PortSwigger — SSRF filter bypass via open redirection（ラボ）: https://portswigger.net/web-security/ssrf/lab-ssrf-filter-bypass-via-open-redirection — オープンリダイレクトを踏み台にした回避。
- Orange Tsai — A New Era of SSRF: Exploiting URL Parser（Black Hat スライド, 原典）: https://www.blackhat.com/docs/us-17/thursday/us-17-Tsai-A-New-Era-Of-SSRF-Exploiting-URL-Parser-In-Trending-Programming-Languages.pdf — パーサ差を突く一般手法の原点。`http://127.0.0.1:11211#@google.com:80/` のような差分の実例が並ぶ。
- Orange Tsai スライド集（本人リポジトリ）: https://github.com/orangetw/My-Presentation-Slides — 上記の講演素材や関連研究のまとめ。
- PayloadsAllTheThings — Bypassing Filters セクション: https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Server%20Side%20Request%20Forgery — IPv6/CIDR/エンコード/DNS rebinding/parser discrepancy/`filter_var()` 回避などの実ペイロード。
- Intigriti — SSRF 完全ガイド（フィルタ回避の章）: https://www.intigriti.com/researchers/blog/hacking-tools/ssrf-a-complete-guide-to-exploiting-advanced-ssrf-vulnerabilities — canary トークンを使った回避手順の二次解説。

### 段階6 — プロトコルスマグリング と SSRF→RCE

目標：`gopher://` / `dict://` / `file://` などで生の TCP を流し込み、内部の Redis / Memcached / MySQL / FastCGI / SMTP / 内部 HTTP を叩いて RCE に持ち込む。まず gopher の仕組みを手で理解し、その後ツールで加速する。

- Gopherus（gopher ペイロード生成ツール）: https://github.com/tarunkant/Gopherus — Redis / MySQL / PostgreSQL / FastCGI / Memcached / SMTP / Zabbix 用の gopher リンクを生成し RCE/リバースシェルへ。
- SSRF to RCE via Redis using Gopher（解説）: https://medium.com/@zoningxtr/ssrf-to-rce-via-redis-using-gopher-protocol-7409b1d97dcd — Redis に cron を書き込んでリバースシェルを取るまでの手順を図解。
- HackTricks — SSRF（gopher / スキーム悪用の節）: https://book.hacktricks.xyz/pentesting-web/ssrf-server-side-request-forgery — 各プロトコルスマグリングのリファレンス。
- （実例）Just Gopher It（$15k）: https://sirleeroyjenkins.medium.com/just-gopher-it-escalating-a-blind-ssrf-to-rce-for-15k-f5329a974530 — 302 リダイレクトで gopher を通し、フィルタ済みの内部 IP に到達→RCE の一連の流れ（段階3と再読）。

### 段階7 — 応用・現代トピック

目標：教科書的な SSRF を超える。XXE→SSRF、PDF ジェネレータ／ヘッドレスブラウザのスクショ機能、webhook、URL プレビュー／画像フェッチャ、オープンリダイレクト連鎖、GraphQL/API 経由の SSRF。

- NahamSec/Daeken — Owning the Clout through SSRF and PDF Generators（DEF CON 27）: 資料集 https://github.com/jdonsec/AllThingsSSRF 内からたどれる。PDF 生成・ヘッドレスブラウザ機能を SSRF 面として突く定番トーク。
- PortSwigger — XXE（Blind XXE / SSRF の節）: https://portswigger.net/web-security/xxe — XML パーサ経由で SSRF に至る筋。
- PortSwigger — SSRF via Referer header（ラボ）: https://portswigger.net/web-security/ssrf/lab-ssrf-via-referer-header — アプリが受け取る各種ヘッダ由来の URL も攻撃面になる。
- AllThingsSSRF（応用ライトアップ集）: https://github.com/jdonsec/AllThingsSSRF — 動画変換（FFmpeg）・PDF・画像プレビュー・各社の実 SSRF レポートを集約。パターン学習に最適。

### 段階8 — ツール習熟

目標：手動で原理を掴んだ上で、自動化で速度を出す。SSRF シンクの発見（パラメータマイニング）から悪用までを効率化する。

- SSRFmap（自動 SSRF ファジング＆悪用）: https://github.com/swisskyrepo/SSRFmap — 多数のモジュール（メタデータ、ポートスキャン、Redis 等）を備えた自動化フレームワーク。
- Gopherus（再掲）: https://github.com/tarunkant/Gopherus — SSRF→RCE の gopher ペイロード生成。
- interactsh: https://github.com/projectdiscovery/interactsh — OOB/OAST 検出。Burp Collaborator の無償代替。
- Burp Suite（Collaborator / Repeater）: https://portswigger.net/burp — blind SSRF の検出とペイロード反復の中心。
- AllThingsSSRF（ツール・ライトアップの索引）: https://github.com/jdonsec/AllThingsSSRF — ツールと実例の入口として常設ブックマークに。

### 段階9 — 防御・検出・修正

目標：なぜ「denylist ではなく allowlist」「未使用スキームの無効化」「メタデータ/リンクローカルへの遮断」「DNS rebinding 耐性のある検証（名前解決してから接続、IP をピン留め）」「ネットワーク分離」「IMDSv2 強制」が効くのかを理解する。診断キャリアと強いレポートに直結。

- OWASP — SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html — アプリ層・ネットワーク層の両輪の防御を体系的に。
- （日本語）MDN — SSRF の対策セクション: https://developer.mozilla.org/ja/docs/Web/Security/Attacks/SSRF — allowlist・スキーム制限・リダイレクトの扱いを日本語で。
- （日本語）IPA「安全なウェブサイトの作り方」: https://www.ipa.go.jp/security/vuln/websecurity/about.html — URL 入力の取り扱いを含むセキュアコーディングの基盤リファレンス。
- クラウド側の要：IMDSv2 の強制（PUT トークン方式）。ヘッダを制御できない通常の SSRF を無力化する。F5 Labs / Hacking the Cloud（段階4）の緩和策の項が実務的。
- （日本語・基礎）徳丸浩『体系的に学ぶ 安全なWebアプリケーションの作り方 第2版』（SBクリエイティブ, 2018年6月, ISBN 9784797393163）— SSRF 単独章は薄いが、URL・外部リクエストの取り扱いと防御思想の土台として。

### 段階10 — 練習環境・継続学習・長文リファレンス

目標：実戦の反復を積み、最新研究に追随し、深いメンタルモデルに落とし込む。

- PortSwigger — SSRF ラボ一覧（無償）: https://portswigger.net/web-security/ssrf — 無償で最高品質。Apprentice→Practitioner を全消化。
- Root-Me — Web-Server チャレンジ: https://www.root-me.org/en/Challenges/Web-Server/ — SSRF を含む多様な Web 課題。
- PentesterLab — 演習: https://pentesterlab.com/exercises — SSRF 関連の実習バッジ。
- HackTheBox Academy —「Server-side Attacks」モジュール: https://academy.hackthebox.com/ — SSRF/SSTI 等のサーバサイド攻撃をハンズオンで（モジュール名で検索）。
- PortSwigger Research（最新の攻撃クラスに追随）: https://portswigger.net/research — albinowax（James Kettle）らの最先端 Web 研究。
- HackerOne 公開レポート（実 SSRF ライトアップ）: https://hackerone.com/hacktivity — SSRF で絞り込み、発見〜エスカレーション〜トリアージを学ぶ。
- AllThingsSSRF（長文・研究の集約）: https://github.com/jdonsec/AllThingsSSRF — Orange Tsai の研究や各社の実例を一括で参照。
- Orange Tsai「A New Era of SSRF」（段階5・再掲、通読推奨）＋ Intigriti 完全ガイドを、SSRF の定番「長文リファレンス」として手元に。

## 推奨される進め方（8週間プラン）

1. 第1〜2週（基礎＋基本悪用）：段階1〜2を読み、PortSwigger の basic SSRF ラボ2つを解く。file:// でのローカル読み取りと、時間差での内部ポートスキャンを手で試す。**到達目標：** 与えられた URL パラメータから、内部専用エンドポイント（管理画面等）へメモなしで到達できる。
2. 第3〜4週（Blind/OAST＋クラウド）：PortSwigger の OOB 検出ラボを完了。interactsh か Collaborator でコールバックを観測する。IMDSv1/v2 の差を理解し、メタデータ取得スクリプト（段階4の各記事）を読み解く。**到達目標：** blind SSRF を OAST で確認でき、IMDSv1 環境なら IAM 一時資格情報を取得する手順を説明できる。
3. 第5〜6週（フィルタ回避【核心】＋プロトコルスマグリング）：段階5のラボ3つ（blacklist / whitelist / open redirect）を全消化。Orange Tsai を通読し、パーサ差の実例を自分で再現する。Gopherus で Redis 向け gopher ペイロードを生成し、ローカルの脆弱環境で SSRF→RCE を通す。**到達目標：** allowlist を `@`/リダイレクト/パーサ差のいずれかで手動回避でき、gopher で内部 Redis にコマンドを流せる。
4. 第7〜8週（応用＋防御）：XXE→SSRF、PDF/ヘッドレスブラウザ、webhook の各筋を学ぶ。次に視点を反転し、脆弱なコードを allowlist ＋名前解決後の IP ピン留め＋スキーム制限で修正する。**到達目標：** 自分の最良の回避ペイロードを、なぜ「解決してから接続」＋allowlist が無効化するのかを開発者に説明できる。
5. 継続：PortSwigger Research を購読。週2〜3件の HackerOne 公開 SSRF レポートを読む。AllThingsSSRF の実例を潰し、より難しい Root-Me/HTB に挑む。**「専門家」と名乗れる閾値：** 未知のアプリで、フィルタ回避を要する SSRF を発見し、クラウドメタデータ奪取またはプロトコルスマグリングで意味ある影響まで上げ、明確で実行可能な修正案を書ける。

## 注意点（Caveats）

- Blog/Medium の質はばらつく。無名のチュートリアルより、PortSwigger、OWASP、HackTricks、PayloadsAllTheThings、名の知れた研究（Orange Tsai、Intigriti、F5 Labs、Resecurity）を優先する。
- クラウドの現実：**IMDSv2 が既定・強制**の環境では、ヘッダを制御できない通常の SSRF で資格情報を抜くのは難しい。まず **IMDSv1 が有効か**を確認し、そのルートを追う価値があるかを判断する。
- SSRF→RCE は内部サービスの構成・権限に依存する（Redis に認証が無い、内部 HTTP が緩い等）。普遍ではなく前提依存として扱う。
- Orange Tsai の講演スライドは二次解説ではなく原典研究。同等に読みやすい二次版が乏しいため収録している。Intigriti / PayloadsAllTheThings の解説と併読すると理解が早い。
- 攻撃の深掘りは圧倒的に英語。日本語資料（IPA、徳丸本、Securify、MDN JP、Zenn）は基礎・防御で最も強い。TOEIC 800／英日バイリンガルはここで実際の強みになる。攻撃技法は英語に寄せて読む。
- テストは自分が所有する、または明示的に許可されたシステムに対してのみ（バグバウンティのスコープ、意図的に脆弱なラボ）。特に SSRF はスコープ外の内部/第三者システムへ到達しやすいので、許可範囲の確認を徹底すること。以上はすべて正当なセキュリティ教育・バグバウンティ・脆弱性リサーチ／防御のためのもの。