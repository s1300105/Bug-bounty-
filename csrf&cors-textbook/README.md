# CSRF & CORSを極める教科書

CSRF（Cross-Site Request Forgery）と CORS（Cross-Origin Resource Sharing）設定不備を、初級者から専門家まで段階的に解説する日本語教科書です。URL 付き学習ロードマップ（`../roadmaps/csrf&cors.md`）の各資料を**原典から取得して**章立てに再構成しました。

- **本文は [`docs/`](./docs/) にあります。** 入口は [`docs/index.md`](./docs/index.md)（目次・使い方・限界）。
- 全11章 + 序章 + 付録（付録A: 全URL / 付録B: 未取得資料 / 付録C: 用語集 / 付録D: 参考書籍）。
- **核心は第3・4・6・8章**（トークンバイパス／SameSite bypass／CORS 設定不備／連鎖）。

## スコープ

防御・脆弱性理解・正当なセキュリティ教育／バグバウンティのための教材です。実在サービス・本番環境への無許可検証や破壊的手順、特定ラボの攻略手順は記載していません。検証は自分が所有または明示的に許可された環境でのみ行ってください。

## ローカルで本 UI（サイドバー＋全文検索）にする

```bash
pip install mkdocs-material
cd csrf\&cors-textbook
mkdocs serve
# → http://127.0.0.1:8000
```

サイドバーは `docs/` の `00- 01- .. 99-` のファイル名順に自動生成されます。GitHub 上では `docs/index.md` からリンクをたどっても読めます。
