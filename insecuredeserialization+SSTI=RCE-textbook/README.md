# 安全でないデシリアライゼーション & SSTI → RCE を極める教科書

信頼できない入力が「データ」から「コード実行（RCE）」へ化ける2つの脆弱性クラス —— **安全でないデシリアライゼーション**と**サーバサイドテンプレートインジェクション（SSTI）** —— を、原典に忠実に日本語で体系化した教科書です（全11章＋序章＋付録）。

- 本文は [`docs/`](docs/) にあります。まずは [`docs/index.md`](docs/index.md)（目次・使い方・限界）から。
- 各章は PortSwigger / OWASP / Black Hat・DEF CON 白書 / 研究者ブログ / HackerOne実報告 / arXiv 論文などの原典に対応。全URLは [`docs/99-appendix.md`](docs/99-appendix.md) に集約。

## 閲覧方法（MkDocs Material）

```bash
pip install mkdocs-material
cd insecuredeserialization+SSTI=RCE-textbook
mkdocs serve
# ブラウザで http://127.0.0.1:8000
```

サイドバー・章内目次・全文検索・ダーク/ライト・コードコピーが付きます。GitHub上でも `docs/index.md` から読めます。

## 注意（防御目的の教材）

本書は防御・検知・安全な設計の理解を目的とした教材です。実在サービス・本番環境への無許可検証や破壊的手順は扱いません。ツール・技術は必ず自分の検証環境または許可されたラボ・バグバウンティスコープ内でのみ利用してください。
