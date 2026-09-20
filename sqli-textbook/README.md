# SQLiを極める教科書

SQLインジェクション（SQLi）を初級者から専門家レベルまで、**原典に忠実に**学ぶための日本語教科書です。バグバウンティ／脆弱性リサーチ／防御実務を志す中〜上級者向け。全10章＋序章＋付録で構成し、権威ある一次・二次資料（PortSwigger、OWASP、HackTricks、PayloadsAllTheThings、IPA・徳丸本、各種ベンダー研究）の内容を原理レベルで再構成しています。

## 読み方

本文は [`docs/`](docs/) にあります。GitHub上なら [`docs/index.md`](docs/index.md) からそのまま読めます。

サイドバー・章内目次・全文検索・ダーク/ライト切替・コードコピー付きで快適に読むには、MkDocs Material でローカル閲覧してください:

```bash
pip install mkdocs-material
cd sqli-textbook
mkdocs serve
# ブラウザで http://127.0.0.1:8000
```

## 構成

- [`docs/index.md`](docs/index.md) — 目次・使い方・本書の限界（サイトのホーム）
- [`docs/00-introduction.md`](docs/00-introduction.md) — 序章：狙いと読み方、SQLiのメンタルモデル
- `docs/01-fundamentals.md` 〜 `docs/10-reference.md` — 第1〜10章
- [`docs/99-appendix.md`](docs/99-appendix.md) — 付録A（全URL一覧）／付録B（未取得資料）／付録C（用語集）／付録D（参考書籍）
- [`sections/`](sections/) — 章に結合する前の節ごとの原稿（再生成の中間成果物）

## 章立て

1. 基礎：SQL・Webデータアクセス・SQLiのメンタルモデル
2. 中核の悪用：in-band（UNION・エラーベース）
3. Blind SQLi：boolean・time-based・OOB/OAST
4. DB別技法（MySQL・PostgreSQL・MSSQL・Oracle・SQLite）
5. WAF回避／フィルタバイパス
6. 応用・現代トピック（second-order・ORM・GraphQL・SQLi→RCE）
7. ツール習熟（sqlmap・Ghauri・手動vs自動）
8. 防御・検出・修正
9. 練習環境・継続学習
10. リファレンス／習熟用の長文教材

## 位置づけと注意

- 教育・防御・**許可された検証**のための教材です。テストは自分が所有する、または明示的に許可されたシステム（バグバウンティのスコープ内、意図的に脆弱なラボ）に対してのみ行ってください。実在サービス・本番への無許可検証や破壊的手順は扱いません。
- 構文・ツール・WAFの挙動はバージョン／時期依存です。使用前に現行バージョンで裏を取ってください。
- 自動取得できなかった資料は [`docs/99-appendix.md`](docs/99-appendix.md) の付録Bに理由つきで一覧化しています。
- 土台のロードマップ: リポジトリ `roadmaps/sqli.md`。
