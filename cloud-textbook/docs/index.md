# クラウド／IAM攻撃を極める教科書

SSRF → クラウドメタデータ(IMDS) → 一時クレデンシャル窃取 → IAM権限昇格 → アカウント乗っ取り、という「最高インパクトの連鎖」を軸に、クラウド（主にAWS、一部GCP/Azure）のセキュリティを**攻撃者視点で理解し、防御に活かす**ための日本語教科書。原典ロードマップ `roadmaps/cloud.md` の各URLを直接取得し、忠実にまとめている。

## この本の位置づけと限界

- **防御目的の教材である。** 攻撃の仕組みを正しく理解することは、堅牢な設計・検知・対処の前提になる。本書は実在サービスや他者の本番環境への無許可検証、破壊的操作の手順書ではない。
- 手を動かす練習は、必ず**自分が管理するアカウント**か、flaws.cloud / CloudGoat / IAM Vulnerable などの**学習用に用意された環境**の中だけで行うこと。
- 記載は執筆時点（2026年9月）の情報に基づく。クラウドの仕様・デフォルト（例: IMDSv2の既定化状況）は変化が速い。**実運用の判断は必ず一次ソースと最新の公式ドキュメントで確認**すること。
- 一部の一次資料はボット対策やSPA化で自動取得できず、代替ソースで補完している。該当箇所には注記があり、対象URLは[付録B](99-appendix.md#付録b-取得できなかった資料)にまとめてある。

## 使い方

- 上から順に読めば「基礎 → 連鎖の核 → 列挙 → 各サービス攻撃 → 権限昇格 → ツール → 実例 → 方法論・ラボ」と理解が積み上がる。
- 既にSSRF/Reconを習得済みなら、**第2章（SSRF→IMDS→窃取）**と**第5章（IAM権限昇格）**が核。ここが「受理される脆弱性」の中心。
- 各章末に前後章と目次へのナビゲーションがある。全文検索（右上）で用語からも辿れる。

## 目次

1. [クラウドとIAMの基礎（攻撃者視点）](01-foundations.md) — 責任共有モデル、EC2/S3/Lambda/IAM/STS、ロールと一時クレデンシャルの仕組み
2. [SSRF→メタデータサービス→一時クレデンシャル窃取](02-ssrf-imds-credential-theft.md) ★連鎖の核 — IMDSv1/v2、到達手法、フィルタ回避、GCP/Azure、Capital One事件
3. [窃取クレデンシャル後のenumeration](03-post-theft-enumeration.md) — 非破壊の権限列挙、CloudFox、鍵発見→検証ワークフロー
4. [S3／ストレージバケットの攻撃](04-s3-bucket-attacks.md) — バケット誤設定、列挙ツール、権限昇格連鎖
5. [IAM誤設定と権限昇格](05-iam-privilege-escalation.md) — Rhino 21手法、BishopFox 31経路、グラフ分析ツール
6. [クラウド固有サービスの攻撃（Lambda/コンテナ/Secrets）](06-cloud-native-services.md) — サーバレス、CloudGoatで学ぶ連鎖
7. [露出クレデンシャル・シークレットのRecon](07-secret-recon.md) — GitHub/JS/.envからの鍵漏洩、検出ツール
8. [ツールと自動化](08-tools-automation.md) — PACU、ScoutSuite、Prowler、CloudFox
9. [実例・ライトアップ・報奨事例](09-real-world-cases.md) — HackerOne開示報告、SSRFバイパス、高額事例
10. [発展・方法論・防御理解・ハンズオン環境](10-methodology-labs.md) — テスト方法論、防御理解、flaws.cloud/CloudGoat/IAM Vulnerable

- [序章：この本の狙いと読み方](00-introduction.md)
- [付録（全URL一覧 / 取得できなかった資料 / 用語集 / 参考資料）](99-appendix.md)
