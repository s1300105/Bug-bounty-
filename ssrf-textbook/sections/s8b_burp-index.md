## Burp Suiteと実例インデックス

SSRF（Server-Side Request Forgery: サーバーサイドリクエスト偽造。サーバーがユーザー制御の入力に基づいて意図しない宛先へリクエストを送信してしまう脆弱性）の検証は、レスポンスが画面に直接返ってこない「blind（ブラインド）」なケースが大半を占める。したがって本章では、blind SSRFを検出・確認するための道具であるBurp Suiteの中核機能と、実際の脆弱性がどのような形で見つかってきたかを俯瞰できる索引サイトを扱う。前者は「どうやって検出するか」、後者は「何を探せばよいか」という、SSRF調査の車の両輪にあたる。

### Burp Suiteの全体像と製品ラインナップ

PortSwigger社のBurp Suiteは、Webアプリケーションのセキュリティテストに使われるプロキシ型のツールスイートである。現在のラインナップは次の4系統に整理されている。

- **Burp AT** — 人間主導のペネトレーションテストを拡張するエージェント型AI機能。
- **Burp Suite DAST** — エンタープライズ向けに自動化された動的Web脆弱性スキャナ。
- **Burp Suite Professional** — 手動テストとBurp Scannerによる自動スキャンの両方を備えた、実務者向けの主力製品。
- **Burp Suite Community Edition** — 手動テストツールのみを無料で提供するエディション。

SSRFの検証で実務上よく使われるのは、リクエストを傍受・編集する「Proxy」、リクエストを手動で繰り返し送って応答の違いを比較する「**Repeater**」、パラメータを自動的に差し替えて大量送信する「**Intruder**」、そして本節の核である「**Collaborator**」の4つである。Repeater/IntruderはCommunity Editionでも制限付きで使えるが、後述するCollaboratorのフル機能はProfessional（またはDAST）が前提になる。

> 出典: Burp Suite（製品トップページ） — https://portswigger.net/burp

### Burp Collaboratorとは何か、なぜ必要か

SSRFの被害には大きく2種類ある。1つは「レスポンスがそのまま画面に表示される」タイプ（例: 画像プレビュー機能がフェッチ結果をそのまま埋め込む場合）で、これはRepeaterでリクエストを送るだけで結果が目に見える。もう1つが「blind SSRF」であり、サーバーは内部で確かにリクエストを発行しているが、その結果はアプリケーションのレスポンスに一切反映されない。この場合、単にリクエストを送って画面を眺めるだけでは、脆弱性の有無を判定できない。

ここで使うのがOAST（Out-of-band Application Security Testing: アプリケーションの応答経路とは別の帯域外チャネルを使ってテストする手法）という考え方であり、Burp Collaboratorはその実装である。Collaboratorは「エラーメッセージも、出力の差分も、検知可能な時間遅延も生じない、見えない脆弱性」を特定するために設計されたネットワークサービスだと説明されている。

仕組みは次の2ステップに整理できる。

1. **ペイロードの注入**: Burpは、Collaboratorサーバーのドメインのサブドメインとして生成された一意のペイロード（例: `a1b2c3d4e5f6g7h8.oastify.com` のようなランダム文字列を含むホスト名）を、テスト対象アプリケーションへのリクエストに埋め込む。これは、Burpが持つ外部到達可能なサーバーのアドレスをアプリケーションに「覚えさせる」操作である。
2. **インタラクションのポーリング**: Burpはその後、Collaboratorサーバーに定期的に問い合わせを行い（ポーリング）、注入したペイロードに対してターゲットアプリケーションが何らかの通信（DNS解決やHTTPリクエストなど）を行ったかどうかを確認する。

> 出典: Burp Collaboratorのしくみ — https://portswigger.net/burp/documentation/collaborator

#### なぜこの仕組みでblind SSRFが検出できるのか

ここが本節の核心である。SSRFの本質は「サーバー自身にリクエストを発行させる」ことにあるため、たとえレスポンスが画面に返らなくても、**サーバーが外部の名前解決やTCP接続を試みたという事実そのものが、外側から観測可能な副作用として残る**。

- ユーザーが `url=http://攻撃者が用意したCollaboratorのサブドメイン/` のような値をSSRFの疑いがあるパラメータ（例: Webhook URL、画像取り込みURL、PDF生成に使うURL、URLプレビュー機能など）に注入する。
- サーバー側のコードがこのURLに対して内部的に `fetch`/`curl`/`requests.get` のような処理を行うsink（入力が最終的に実行・解釈される危険な代入先。ここでは「HTTPクライアントに渡されるURL文字列」がsinkにあたる）を持っていれば、そのサーバーはまず**DNS解決**を行い、次に**TCP接続・HTTPリクエスト送信**を試みる。
- DNS解決は多くの環境でファイアウォールのアウトバウンド制限をすり抜けやすい（UDP/53が許可されていることが多い）ため、たとえHTTP自体がブロックされていても、DNSクエリがCollaboratorサーバーに届くだけで「このパラメータはサーバー側で名前解決される=何らかのネットワーク処理に渡っている」という強い証拠になる。
- Collaboratorはこのポーリングの結果として、DNS/HTTP(S)/SMTPいずれかのインタラクションを受信すれば、それを（送信元IP、タイムスタンプ、リクエストの生データとともに）Burp上に通知する。

つまりCollaboratorは、「レスポンスに何も出ない」というSSRF検証最大の壁を、「ネットワークプロトコルの挙動（DNS解決は独立した副作用として観測できる）」という別の経路に置き換えることで突破している。これはSSRF固有の技術というより、OAST全般（Blind SQLiやXXEの帯域外検出にも同じ発想が使われる）に共通する原理だが、SSRFの検出手段としては最も基本かつ実務で多用される手法である。

#### 実務での使い方（概念）

Burp Suite Professionalでは、Repeaterで送るリクエストの任意の位置に「Insert Collaborator payload」でユニークなペイロードを挿入できる。例えば、あるAPIがWebhook登録機能を持っていると仮定する。

```
POST /api/webhooks HTTP/1.1
Host: example-target.internal-test
Content-Type: application/json

{"callback_url": "http://x7f2n9k1.oastify.com/"}
```

このリクエストを送信後、Burp Collaborator clientのタブを開き「Poll now」（手動ポーリング）を実行するか、自動ポーリングの完了を待つ。もし `x7f2n9k1.oastify.com` へのDNSクエリやHTTPリクエストがCollaboratorサーバーに記録されていれば、`callback_url` パラメータがサーバー側で実際にネットワークリクエストの発行に使われている、つまりSSRFの糸口が存在することが確認できる。ここで「なぜPOSTの中身ではなく別チャネルの記録を見るのか」といえば、まさにアプリケーション自身のレスポンスには一切この事実が現れないためであり、これがblind SSRF検証がCollaborator（あるいは自前のDNSロギングサーバー、`interactsh` など同種のOASTツール）を必須とする理由である。

なお本書はSSRFの検出・防御の原理解説を目的としており、実在サービスや権限のない本番環境に対してこうしたペイロードを送信する行為は、必ず許可された検証環境（バグバウンティのスコープ内、自前のラボ環境など）に限定すべきである。無許可の対象への適用は行ってはならない。

#### 防御側の視点

Collaboratorのようなツールで検出される「アウトバウンドDNS/HTTPの発生」は、そのまま防御側の監視ポイントにもなる。具体的には、アプリケーションサーバーからの予期しない外部ドメインへのDNSクエリやHTTP接続をネットワーク層・DNSログで監視することは、SSRFの悪用（あるいは悪用の試み）を検知する有効な手段である。また、サーバー側でURLを扱う処理には許可リスト（allowlist）方式の宛先制限を設け、DNS解決結果に対しても再検証（TOCTOU: Time-of-check to time-of-useのズレを突いたDNS Rebinding対策）を行うことが根本的な緩和策になる。

> 出典: Burp Suite（製品トップページ、および付随のCollaboratorドキュメント） — https://portswigger.net/burp

### AllThingsSSRF: SSRF専門の資料索引

[AllThingsSSRF](https://github.com/jdonsec/AllThingsSSRF)は、@jdonsecがGitHub上で公開しているキュレーション型のリポジトリで、SSRFに関するライトアップ（writeup: 実際に見つけた脆弱性の再現手順や発見経緯を書いた報告記事）、チートシート、動画、ツール、CTF/ラボ環境を一箇所に集約したものである。継続的に更新されるインデックスであり、ブラウザのブックマークに入れておき「SSRFで行き詰まったらまずここを見る」という使い方をするのが実務的である。以下、カテゴリごとに構成と代表的な内容を要約する（個々のリンク先の内容そのものは未検証であり、あくまで索引としての価値を紹介する）。

#### 学習用資料（Learn What is SSRF）

SSRFの基礎から発展的な話題までを扱う記事群。Vickie Liによる入門記事群（「Intro to SSRF」「Exploiting SSRFs」）、Detectify・Netsparker・HackerOneによる解説記事、そして特に重要なのが**Orange Tsaiの「A New Era of SSRF - Exploiting URL Parser in Trending Programming Languages!」**（BlackHat 2017）である。これは、各言語・ライブラリのURLパーサ実装の差異（例: `http://user@host:evil.com`のような紛らわしい構文の解釈のずれ）を突いてSSRFフィルタを回避する手法を体系化した、SSRF研究における画期的な発表として知られる。ほかにも「SSRF bible」というチートシートPDFや、PayloadsAllTheThingsのSSRFセクション、CTF Wikiの解説などが並ぶ。

#### ライトアップ・事例集（Writeups）

実際にバグバウンティやCTFで発見されたSSRFの事例が多数収録されている。代表例:

- **Cracking the Lens**（@albinowax / PortSwigger Research）— HTTPの「隠れた攻撃対象領域」を狙う研究。
- **GitLab SSRFからRCEへの連鎖**（Orange Tsai、LiveOverFlow）— GitLabのWebhook機能に存在したSSRFを起点に、IPv4/IPv6アドレス埋め込みとgit://プロトコルへのCRLFインジェクションを組み合わせてRCE（Remote Code Execution）まで昇格させた事例。
- **Vimeo SSRF with code execution potential**（Harsh Jaiswal）— 動画処理機能のSSRFがコード実行につながった例。
- **AWS metadataの窃取事例**（Coen Goedegebure、Pratik Yadavなど）— クラウド環境特有の「メタデータサービス（`169.254.169.254`）へのSSRF」がクレデンシャル漏洩に直結するパターンを示す複数の記事。
- **Slackでの$1,000バウンティ**（Elber "f0lds" Tavares）— 主要SaaS製品での実例。

これらはいずれも「SSRFは単体では地味に見えても、内部ネットワークの構造（クラウドメタデータ、内部API、他プロトコルの悪用）と組み合わさることで重大な被害に発展する」という、この教科書全体で繰り返し強調すべき教訓を裏付ける一次資料群である。

#### HackerOne報告書（HackerOne Reports）

50件以上の実際の脆弱性報告への直リンクが列挙されている。代表的なものとして、SVGファイルのレンダリング処理を悪用したSSRF（#223203）、FFmpegのHLS処理を悪用したSSRF（#237381など複数件）、`proxy.duckduckgo.com`を踏み台にしたAWSメタデータサーバーへのアクセス（#395521）、Exchangeサーバーのroot権限奪取に至ったSSRF（#341876、André Baptista）、Sentry設定不備によるblind SSRF（#374737）などがある。これらは、実際の報告書のフォーマット（再現手順・影響範囲・修正状況）を読むことで、自分のレポート作成の参考にもなる。

#### 動画・PoC（Videos/POC）

Black HatやDEF CON、Hacker101、Bugcrowd Universityなどでの発表動画がまとめられている。Nahamsecによる「Owning the Clout through SSRF and PDF Generators」（DEF CON 27、Snapchat広告基盤でのSSRF）や、LiveOverFlowによる「PHP include and bypass SSRF protection with two DNS A records」（DNS Rebindingを利用したフィルタ回避のデモ）など、テキストのライトアップだけでは伝わりにくい「実際の操作画面」を見られる点に価値がある。

#### ツール（Tools）

3つのツールが紹介されている。

- **SSRF Proxy**（bcoles）— HTTPプロキシサーバーとして動作し、既存のツール（Burpなど）からのリクエストをSSRFの脆弱なエンドポイント経由でルーティングし直すことで、脆弱なアプリケーションを踏み台にした間接的なスキャンを可能にするツール。
- **SSRFTest**（daeken）— SSRFの検証を支援するテストツール。
- **httprebind**（daeken）— DNS Rebinding攻撃（名前解決の結果を途中で外部IPから内部IPへ切り替えることで、ホスト名ベースの許可リストを回避する手法）を実演・検証するためのツール。

#### CTF・ラボ環境（CTF/Labs）

自分の環境で安全に手を動かして学ぶための場が列挙されている。PortSwigger自身が提供する[Web Security AcademyのSSRFラボ](https://portswigger.net/web-security/ssrf)、Pentester Labの有料演習（Essential: SSRF 01〜04の4段階）、独立系のm6a-UdSによるSSRFラボ環境（GitHubでホストされたDockerベースの練習環境）などが含まれる。これらは全て許可された学習用環境であり、本書のスコープ方針（防御目的・許可なき本番検証の禁止）とも合致する使い方ができる。

> 出典: AllThingsSSRF — https://github.com/jdonsec/AllThingsSSRF

### この2つをどう組み合わせて使うか

実務的なワークフローとしては、まずAllThingsSSRFのようなインデックスで「そのアプリケーションが持つ機能カテゴリ（Webhook、画像/PDF生成、URLプレビュー、SSOのメタデータ取得など）に対応する既知の脆弱パターン」を素早く把握し、次にBurp Suite（RepeaterでペイロードのバリエーションをテストしつつCollaboratorでblindな反応を監視する）で仮説を実際に検証する、という流れになる。索引サイトは「何を疑うべきか」の仮説形成を助け、Collaboratorは「その仮説が正しいかどうか」を、レスポンスに何も現れない状況でも判定可能にする。この2つが揃って初めて、blind SSRFという「見えない脆弱性」を体系的に扱えるようになる。
