# AIセキュリティを極める教科書

AI／LLMを組み込んだアプリケーションのセキュリティ脆弱性を初級者から専門家まで段階的に学ぶ、**原典に忠実な日本語教科書**です。`roadmaps/ai.md`（URL付き学習ロードマップ）の各資料を原典から取得し、全9章＋序章＋付録に再構成しました。

- **本文は [`docs/`](./docs/) にあります。** 入口は [`docs/index.md`](./docs/index.md)。
- 核心は **第2章（プロンプトインジェクション）**・**第3章（LLM起点の従来型Web脆弱性）**・**第6章（サプライチェーン／実CVE）**。

> **スコープ**: 本書は防御・脆弱性理解・正当なセキュリティ教育／バグバウンティのための教材です。攻撃技法は仕組みの理解と防御のために解説しており、実在サービス・本番環境への無許可検証や破壊的手順、特定の演習環境（ラボ・CTF）の攻略手順は記載しません。手を動かす対象は、自分が所有または明示的に許可された環境に限ってください。

## 閲覧方法

GitHub 上では [`docs/index.md`](./docs/index.md) からリンクをたどるだけで読めます。ローカルでサイドバー・全文検索・ダーク/ライト・コードコピー付きの本UIにするには：

```bash
pip install mkdocs-material
cd ai-textbook
mkdocs serve
# → http://127.0.0.1:8000
```

## 構成

| | |
| --- | --- |
| [序章](./docs/00-introduction.md) | 本書の狙いとAI/LLM脆弱性の全体像・スコープ |
| [第1章](./docs/01-fundamentals.md) | 基礎：LLMアプリのアーキテクチャとAIセキュリティ全体像 |
| [第2章](./docs/02-prompt-injection.md) | プロンプトインジェクション（直接／間接）【核心】 |
| [第3章](./docs/03-llm-web-vulns.md) | LLMを起点とした従来型Web脆弱性【本命】 |
| [第4章](./docs/04-agents-mcp.md) | AIエージェント／ツール／MCPの脆弱性 |
| [第5章](./docs/05-rag-data.md) | RAG・データ・埋め込みの脆弱性 |
| [第6章](./docs/06-supply-chain-mlops.md) | AIサプライチェーン／モデルファイル／MLOpsの脆弱性【現実的】 |
| [第7章](./docs/07-case-studies.md) | 実例・ライトアップ・バグバウンティ事例 |
| [第8章](./docs/08-hands-on-tools.md) | ハンズオン環境とツール |
| [第9章](./docs/09-advanced-methodology.md) | 発展・最先端・方法論 |
| [付録](./docs/99-appendix.md) | 全URL一覧・未取得資料・用語集・参考書籍 |

## 生成元

- ロードマップ: [`../roadmaps/ai.md`](../roadmaps/ai.md)
- 生成スキル: `.claude/skills/textbook-builder`（`/textbook-builder` で再生成可能）
- `sections/` には章結合前の節単位の原稿を保持しています（再生成の起点）。
