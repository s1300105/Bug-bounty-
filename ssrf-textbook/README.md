# SSRFを極める教科書

サーバサイドリクエストフォージェリ（SSRF）を初級者から専門家まで段階的に学ぶ、**原典に忠実な日本語教科書**です。`roadmaps/ssrf.md`（URL付き学習ロードマップ）の各資料を原典から取得し、全10章＋序章＋付録に再構成しました。

- **本文は [`docs/`](./docs/) にあります。** 入口は [`docs/index.md`](./docs/index.md)。
- 核心は **第5章（URLパーサ／フィルタ回避）** と **第6章（プロトコルスマグリング→RCE）**。

> **スコープ**: 本書は防御・脆弱性理解・正当なセキュリティ教育／バグバウンティのための教材です。攻撃技法は仕組みの理解と防御のために解説しており、実在サービス・本番環境への無許可検証や破壊的手順は記載しません。手を動かす対象は、自分が所有または明示的に許可された環境（PortSwigger等の無償ラボ、意図的に脆弱なローカル環境、スコープ内のバグバウンティ対象）に限ってください。

## 閲覧方法

GitHub 上では [`docs/index.md`](./docs/index.md) からリンクをたどるだけで読めます。ローカルでサイドバー・全文検索・ダーク/ライト・コードコピー付きの本UIにするには：

```bash
pip install mkdocs-material
cd ssrf-textbook
mkdocs serve
# → http://127.0.0.1:8000
```

## 構成

| | |
| --- | --- |
| [序章](./docs/00-introduction.md) | 本書の狙いと SSRF の全体像 |
| [第1章](./docs/01-basics.md) | 基礎：SSRFとは・メンタルモデル・影響分類 |
| [第2章](./docs/02-basic-exploitation.md) | 基本の悪用：内部到達・ポートスキャン・file:// |
| [第3章](./docs/03-blind-oast.md) | Blind SSRF と OAST/OOB 検出 |
| [第4章](./docs/04-cloud-metadata.md) | クラウドメタデータの悪用（IMDS/GCP/Azure） |
| [第5章](./docs/05-filter-bypass.md) | URLパーサ／フィルタ回避【核心】 |
| [第6章](./docs/06-protocol-smuggling-rce.md) | プロトコルスマグリングとSSRF→RCE |
| [第7章](./docs/07-advanced-topics.md) | 応用・現代トピック |
| [第8章](./docs/08-tooling.md) | ツール習熟 |
| [第9章](./docs/09-defense.md) | 防御・検出・修正 |
| [第10章](./docs/10-practice-continuous.md) | 練習環境・継続学習・長文リファレンス |
| [付録](./docs/99-appendix.md) | 全URL一覧・未取得資料・用語集・参考書籍 |

## 生成元

- ロードマップ: [`../roadmaps/ssrf.md`](../roadmaps/ssrf.md)
- 生成スキル: `.claude/skills/textbook-builder`（`/textbook-builder` で再生成可能）
- `sections/` には章結合前の節単位の原稿を保持しています（再生成の起点）。
