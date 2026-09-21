# HTTPリクエストスマグリング & Webキャッシュ攻撃を極める教科書

HTTPリクエストスマグリング（デシンク攻撃）とWebキャッシュポイズニング／デセプションを、初級から専門家レベルまで原典に忠実に解説した日本語教科書です。James Kettle（PortSwigger Research）の研究系譜を軸に、全10章＋序章＋付録で構成しています。

## 読み方

- **GitHub上でそのまま読む**：[docs/index.md](docs/index.md) が入口（目次）です。各章へはそこからリンクしています。
- **本UI（サイドバー＋全文検索＋ダーク/ライト＋コードコピー）で読む**：

  ```
  python3 -m pip install --user mkdocs-material
  cd request-smuggling-textbook
  mkdocs serve
  # http://127.0.0.1:8000 を開く
  ```

## 構成

- `docs/index.md` … 目次・使い方・本書の限界（サイトのホーム）
- `docs/00-introduction.md` … 序章
- `docs/01-*.md` 〜 `docs/10-*.md` … 各章本文
- `docs/99-appendix.md` … 付録（全URL一覧・未取得資料・用語集・参考書籍）
- `sections/` … 生成時の節単位の中間ファイル（再生成用に保持）
- `mkdocs.yml` … MkDocs Material 設定

## スコープ

本書は**防御・検出・安全な検証の理解を目的**として記述しています。実在サービスや本番環境への無許可検証・破壊的手順は扱いません。手を動かす学習は公式の演習ラボ（PortSwigger Web Security Academy 等）または自分で構築した検証環境で行ってください。
