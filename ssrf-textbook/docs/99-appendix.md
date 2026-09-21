# 付録

## 付録A：全参考URL一覧（段階別）

本書のもとになった学習ロードマップ `roadmaps/ssrf.md` に収録された全リソースを、段階（章）別に整理する。各章本文の「出典」と対応する。

### 段階1 — 基礎
- PortSwigger — What is SSRF: https://portswigger.net/web-security/ssrf
- OWASP SSRF（コミュニティページ）: https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
- OWASP WSTG — Testing for SSRF (WSTG-INPV-19): https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/19-Testing_for_Server-Side_Request_Forgery
- Intigriti — SSRF: A Complete Guide: https://www.intigriti.com/researchers/blog/hacking-tools/ssrf-a-complete-guide-to-exploiting-advanced-ssrf-vulnerabilities
- （日本語）MDN — SSRF: https://developer.mozilla.org/ja/docs/Web/Security/Attacks/SSRF
- （日本語）Securify — SSRFとは？: https://www.securify.jp/blog/server-side-request-forgery/

### 段階2 — 基本の悪用
- PortSwigger — Basic SSRF against localhost（ラボ）: https://portswigger.net/web-security/ssrf/lab-basic-ssrf-against-localhost
- PortSwigger — Basic SSRF against a back-end system（ラボ）: https://portswigger.net/web-security/ssrf/lab-basic-ssrf-against-backend-system
- HackTricks — SSRF: https://book.hacktricks.xyz/pentesting-web/ssrf-server-side-request-forgery
- PayloadsAllTheThings — SSRF README: https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/README.md
- （日本語）Zenn（chot）— SSRF攻撃について知ってもらう: https://zenn.dev/chot/articles/88ea57e3108978

### 段階3 — Blind SSRF と OAST/OOB 検出
- PortSwigger — Blind SSRF: https://portswigger.net/web-security/ssrf/blind
- PortSwigger — Blind SSRF with out-of-band detection（ラボ）: https://portswigger.net/web-security/ssrf/blind/lab-out-of-band-detection
- interactsh（OAST ツール）: https://github.com/projectdiscovery/interactsh
- Just Gopher It — Blind SSRF→RCE ($15k): https://sirleeroyjenkins.medium.com/just-gopher-it-escalating-a-blind-ssrf-to-rce-for-15k-f5329a974530

### 段階4 — クラウドメタデータの悪用
- Hacking the Cloud — Steal EC2 Metadata Credentials via SSRF: https://hackingthe.cloud/aws/exploitation/ec2-metadata-ssrf/
- HackTricks — Cloud SSRF: https://hacktricks.wiki/en/pentesting-web/ssrf-server-side-request-forgery/cloud-ssrf.html
- Yassine Aboukir — Exploitation of an SSRF against EC2 IMDSv2: https://www.yassineaboukir.com/blog/exploitation-of-an-SSRF-vulnerability-against-EC2-IMDSv2/
- F5 Labs — Campaign Targets Amazon EC2 Instance Metadata via SSRF: https://www.f5.com/labs/articles/campaign-targets-amazon-ec2-instance-metadata-via-ssrf
- Resecurity — SSRF to AWS Metadata Exposure: https://www.resecurity.com/blog/article/ssrf-to-aws-metadata-exposure-how-attackers-steal-cloud-credentials

### 段階5 — URLパーサ／フィルタ回避【核心】
- PortSwigger — SSRF with blacklist-based input filter（ラボ）: https://portswigger.net/web-security/ssrf/lab-ssrf-with-blacklist-filter
- PortSwigger — SSRF with whitelist-based input filter（ラボ）: https://portswigger.net/web-security/ssrf/lab-ssrf-with-whitelist-filter
- PortSwigger — SSRF filter bypass via open redirection（ラボ）: https://portswigger.net/web-security/ssrf/lab-ssrf-filter-bypass-via-open-redirection
- Orange Tsai — A New Era of SSRF（Black Hat スライド, 原典 PDF）: https://www.blackhat.com/docs/us-17/thursday/us-17-Tsai-A-New-Era-Of-SSRF-Exploiting-URL-Parser-In-Trending-Programming-Languages.pdf
- Orange Tsai スライド集（本人リポジトリ）: https://github.com/orangetw/My-Presentation-Slides
- PayloadsAllTheThings — SSRF（Bypassing Filters 含む）: https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Server%20Side%20Request%20Forgery
- Intigriti — SSRF 完全ガイド（フィルタ回避の章）: https://www.intigriti.com/researchers/blog/hacking-tools/ssrf-a-complete-guide-to-exploiting-advanced-ssrf-vulnerabilities

### 段階6 — プロトコルスマグリング と SSRF→RCE
- Gopherus（gopher ペイロード生成ツール）: https://github.com/tarunkant/Gopherus
- SSRF to RCE via Redis using Gopher（解説）: https://medium.com/@zoningxtr/ssrf-to-rce-via-redis-using-gopher-protocol-7409b1d97dcd
- HackTricks — SSRF（gopher の節）: https://book.hacktricks.xyz/pentesting-web/ssrf-server-side-request-forgery
- Just Gopher It ($15k): https://sirleeroyjenkins.medium.com/just-gopher-it-escalating-a-blind-ssrf-to-rce-for-15k-f5329a974530

### 段階7 — 応用・現代トピック
- AllThingsSSRF（応用ライトアップ集）: https://github.com/jdonsec/AllThingsSSRF
- PortSwigger — XXE: https://portswigger.net/web-security/xxe
- PortSwigger — SSRF via Referer header（ラボ）: https://portswigger.net/web-security/ssrf/lab-ssrf-via-referer-header

### 段階8 — ツール習熟
- SSRFmap（自動 SSRF ファジング＆悪用）: https://github.com/swisskyrepo/SSRFmap
- Gopherus（再掲）: https://github.com/tarunkant/Gopherus
- interactsh: https://github.com/projectdiscovery/interactsh
- Burp Suite（Collaborator / Repeater）: https://portswigger.net/burp
- AllThingsSSRF（索引）: https://github.com/jdonsec/AllThingsSSRF

### 段階9 — 防御・検出・修正
- OWASP — SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- （日本語）MDN — SSRF の対策セクション: https://developer.mozilla.org/ja/docs/Web/Security/Attacks/SSRF
- （日本語）IPA「安全なウェブサイトの作り方」: https://www.ipa.go.jp/security/vuln/websecurity/about.html

### 段階10 — 練習環境・継続学習
- PortSwigger — SSRF ラボ一覧（無償）: https://portswigger.net/web-security/ssrf
- Root-Me — Web-Server チャレンジ: https://www.root-me.org/en/Challenges/Web-Server/
- PentesterLab — 演習: https://pentesterlab.com/exercises
- HackTheBox Academy — Server-side Attacks モジュール: https://academy.hackthebox.com/
- PortSwigger Research: https://portswigger.net/research
- HackerOne 公開レポート（hacktivity）: https://hackerone.com/hacktivity
- AllThingsSSRF（長文・研究の集約）: https://github.com/jdonsec/AllThingsSSRF

---

## 付録B：自動取得できなかった資料

本書の自動生成時に、egress プロキシ・ボット対策・課金ゲート・SPA レンダリング等の理由で全文を自動取得できなかった資料の一覧。**内容が存在しない／信用できないという意味ではなく、自動フェッチができなかった**という意味である。各資料は本文中に `⚠️ 未取得の資料` 注記を入れたうえで、GitHub 原本ミラー・WebSearch・一般知識で補足している。**下記URLからご自身で直接ご覧になることを推奨する。**

| 資料 | URL | 未取得の理由 | 本書での補い方 |
| --- | --- | --- | --- |
| HackTricks — Cloud SSRF | https://hacktricks.wiki/en/pentesting-web/ssrf-server-side-request-forgery/cloud-ssrf.html | `tollbit.hacktricks.wiki` へ302リダイレクトし HTTP 402（課金要求） | GitHub raw ミラー（`HackTricks-wiki/hacktricks` の `cloud-ssrf.md`）から内容取得。第4章に反映 |
| HackTricks — SSRF | https://book.hacktricks.xyz/pentesting-web/ssrf-server-side-request-forgery | 同上（302→402 課金要求） | 一般知識および他資料で補足。第6章に反映 |
| SSRF to RCE via Redis using Gopher | https://medium.com/@zoningxtr/ssrf-to-rce-via-redis-using-gopher-protocol-7409b1d97dcd | Medium が HTTP 403 | WebSearch で要旨を取得し補足。第6章に反映 |
| Just Gopher It — Blind SSRF→RCE ($15k) | https://sirleeroyjenkins.medium.com/just-gopher-it-escalating-a-blind-ssrf-to-rce-for-15k-f5329a974530 | Medium が HTTP 403 | WebSearch で要旨（302リダイレクト×blind SSRF、Redis検出、$15k）を取得。第3章・第6章に反映 |
| PortSwigger — SSRF via Referer header（ラボ） | https://portswigger.net/web-security/ssrf/lab-ssrf-via-referer-header | WebFetch で HTTP 404（ラボURL構造の変更/統合の可能性） | ⚠️注記を挿入し、WebSearch で得た複数の攻略記述を突き合わせて再構成。第7章に反映 |
| PortSwigger — SSRF ラボ一覧（アンカー） | https://portswigger.net/web-security/all-labs#server-side-request-forgery-ssrf | 構造化リストを抽出できず（SPA的レンダリング） | WebSearch と GitHub 上の攻略記録で代替。第10章に反映 |
| Root-Me — Web-Server チャレンジ | https://www.root-me.org/en/Challenges/Web-Server/ | Anubis（ボット対策）によりアクセス拒否 | WebSearch で代替情報を収集。第10章に反映 |
| PentesterLab — 演習 | https://pentesterlab.com/exercises | 演習の完全一覧までは取得できず（カテゴリのみ） | WebSearch で個別演習名を補完。第10章に反映 |
| HackTheBox Academy | https://academy.hackthebox.com/ | トップページにモジュール詳細テキストなし | WebSearch で Server-side Attacks モジュールを補完。第10章に反映 |
| HackerOne — hacktivity | https://hackerone.com/hacktivity | 動的レンダリングの SPA でヘッダーのみ取得 | WebSearch で具体的な公開レポート例を補完。第10章に反映 |
| HackerOne — Report #508459 | https://hackerone.com/reports/508459 | 同様に SPA で本文取得不可 | WebSearch 結果の要約で代替。第10章に反映 |

---

## 付録C：用語集

| 用語 | 説明 |
| --- | --- |
| **SSRF** | Server-Side Request Forgery。攻撃者が指定した宛先へ、サーバ自身にリクエストを送らせる脆弱性。 |
| **Blind SSRF** | バックエンドリクエストのレスポンスが攻撃者に返らないタイプの SSRF。存在確認に OAST を使う。 |
| **sink（シンク）** | 攻撃者入力が最終的に危険な操作（ここでは任意URLへのネットワークリクエスト）に落ちる箇所。 |
| **OAST / OOB** | Out-of-band Application Security Testing。攻撃者が制御する外部ホストへのDNS/HTTPコールバックで脆弱性を検出する手法。 |
| **Burp Collaborator / interactsh** | OAST 用の相互作用サーバ。一意のサブドメインへの到達を観測する。 |
| **IMDS** | Instance Metadata Service。クラウドVMが自身のメタデータ（IAM一時資格情報等）を取得する `169.254.169.254` のエンドポイント。 |
| **IMDSv1 / IMDSv2** | v1は単純なGETで取得可。v2はPUTでトークンを取得しヘッダで送る方式で、ヘッダを制御できない通常のSSRFを無力化する。 |
| **リンクローカルアドレス** | `169.254.0.0/16`（IPv4）等。同一リンク内でのみ有効。メタデータエンドポイントもここに属す。 |
| **DNS リバインディング** | 検証時と接続時でDNS応答を切り替え、TOCTOUで許可リストを回避する手法。 |
| **TOCTOU** | Time-Of-Check to Time-Of-Use。検証した時点と実際に使う時点のズレを突く脆弱性クラス。 |
| **parser confusion** | URLパーサとリクエスタ（HTTPクライアント）のURL解釈のズレを突く回避技法。Orange Tsai の研究が原点。 |
| **プロトコルスマグリング** | `gopher://`等で生のTCPペイロードを内部サービスに流し込み、意図しないコマンドを実行させる技法。 |
| **gopher://** | URL内に任意バイト列を埋め込み、宛先ソケットへそのまま送れる古いスキーム。Redis等のテキストプロトコル悪用に使われる。 |
| **エグレスフィルタリング** | サーバからの外部送信（outbound）を制御・遮断すること。SSRF防御の要の一つ。 |
| **allowlist / denylist** | 許可リスト方式／拒否リスト方式。SSRF防御では denylist は回避されやすく allowlist が推奨される。 |
| **IPピン留め** | 名前解決した実IPを検証し、そのIPに対して接続する（DNSリバインディング対策）。 |

---

## 付録D：参考書籍

- 徳丸浩『体系的に学ぶ 安全なWebアプリケーションの作り方 第2版』SBクリエイティブ, 2018年6月, ISBN 9784797393163。SSRF 単独章は薄いが、URL・外部リクエストの取り扱いと防御思想の土台として。

---

## ナビゲーション

← [第10章 練習環境・継続学習・長文リファレンス](10-practice-continuous.md)  ｜  [📚 目次（ホーム）](index.md)
