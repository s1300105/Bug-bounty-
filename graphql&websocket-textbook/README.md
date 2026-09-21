# GraphQL & WebSocket セキュリティを極める教科書

GraphQL API と WebSocket/CSWSH のセキュリティを、初級から専門家レベルまで、URL付き学習ロードマップの原典に忠実に解説した日本語教科書です。GraphQL の「introspection→認可欠落(BOLA/BFLA)→alias/batchingによる総当りバイパス→深いネストDoS→injection」と、WebSocket の「ハンドシェイク→CSWSH→メッセージ経由インジェクション」を、実CVE・実HackerOne報告で裏取りしながら、全10章＋序章＋付録で構成しています。

## 読み方

- **GitHub上でそのまま読む**：[docs/index.md](docs/index.md) が入口（目次）です。各章へはそこからリンクしています。
- **本UI（サイドバー＋全文検索＋ダーク/ライト＋コードコピー）で読む**：

  ```
  python3 -m pip install --user mkdocs-material
  cd graphql\&websocket-textbook
  mkdocs serve
  # http://127.0.0.1:8000 を開く
  ```

## 構成

- `docs/index.md` … 目次・使い方・本書の限界（サイトのホーム）
- `docs/00-introduction.md` … 序章
- `docs/01-*.md` 〜 `docs/10-*.md` … 各章本文（Part A: GraphQL 1〜5章 / Part B: WebSocket 6〜8章 / Part C: 統合 9〜10章）
- `docs/99-appendix.md` … 付録（全URL一覧・未取得資料・用語集・参考書籍）
- `sections/` … 生成時の節単位の中間ファイル（再生成用に保持）
- `mkdocs.yml` … MkDocs Material 設定

## スコープ

本書は**防御・検出・安全な検証の理解を目的**として記述しています。実在サービスや本番環境への無許可検証・破壊的手順は扱いません。とくに DoS・総当り・バッチング攻撃は他ユーザーや対象システムに実害を及ぼしうるため、原理・検出・防御を中心に据えています。ラボの解答手順（攻略）は掲載しません。手を動かす学習は PortSwigger Web Security Academy 等の公式演習ラボか、DVGA など自分で構築した検証環境で行ってください。
