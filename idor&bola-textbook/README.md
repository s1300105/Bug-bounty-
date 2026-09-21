# IDOR/BOLA・アクセス制御・ビジネスロジックを極める教科書

IDOR/BOLA・アクセス制御バイパス・ビジネスロジック・レースコンディション・マルチテナンシー・API/GraphQL認可を、URL付き学習ロードマップから生成した**原典に忠実な日本語教科書**です。

## 読む

- 本文は [`docs/`](docs/) にあります。入口は [`docs/index.md`](docs/index.md)。GitHub 上でそのまま読めます。
- ローカルで本UI（サイドバー・章内目次・全文検索・ダーク/ライト・コードコピー）にするには：

  ```bash
  python3 -m pip install --user mkdocs-material
  cd "idor&bola-textbook"
  mkdocs serve
  # → http://127.0.0.1:8000
  ```

## 構成

- `docs/00-introduction.md` … 序章
- `docs/01-` 〜 `docs/10-` … 全10章
- `docs/99-appendix.md` … 付録（全URL一覧・未取得資料・用語集・参考書籍）
- `sections/` … 生成時の節ごとの原稿（章ファイルの素材。再生成時に利用）

## スコープ

本書は防御・検出・安全な検証の理解を目的として記述しています。実在サービス・本番環境への無許可検証や破壊的手順は含みません。学習は公式ラボ・自前の検証環境・許諾されたスコープ内でのみ行ってください。
