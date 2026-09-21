# クラウド／IAM攻撃を極める教科書

SSRF → クラウドメタデータ(IMDS) → 一時クレデンシャル窃取 → IAM権限昇格 → アカウント乗っ取り、という連鎖を軸に、クラウド（主にAWS）のセキュリティを**攻撃者視点で理解し防御に活かす**ための日本語教科書。原典ロードマップ [`roadmaps/cloud.md`](../roadmaps/cloud.md) の各URLを直接取得して忠実にまとめている。

- 本文は [`docs/`](docs/) にある。まずは [`docs/index.md`](docs/index.md)（目次）から。
- 全10章 + 序章 + 付録。防御目的の教材であり、無許可検証や破壊的手順の手順書ではない。

## 閲覧方法（MkDocs）

```bash
pip install mkdocs-material
cd cloud-textbook
mkdocs serve
# http://127.0.0.1:8000 を開く
```

サイドバー・章内目次・全文検索・ダーク/ライト切替・コードコピーが付く。GitHub上でも [`docs/index.md`](docs/index.md) から読める。

## 構成

- `docs/index.md` — 目次・使い方・限界
- `docs/00-introduction.md` — 序章
- `docs/01`〜`10-*.md` — 各章
- `docs/99-appendix.md` — 付録A(全URL) / 付録B(取得できなかった資料) / 用語集 / 参考資料
- `sections/` — 章に結合する前の節ごとの原稿（再生成・差分確認用）
- `mkdocs.yml` — サイト設定
