# OAuthを極める教科書

OAuth 2.0 / OpenID Connect（OIDC）の脆弱性を初級者から専門家まで段階的に学ぶ、**原典に忠実な日本語教科書**です。`roadmaps/oauth.md`（URL付き学習ロードマップ）の各資料を原典から取得し、全5章＋序章＋付録に再構成しました。

- **本文は [`docs/`](./docs/) にあります。** 入口は [`docs/index.md`](./docs/index.md)。
- 核心は **第2章（脆弱性クラス）** と **第3章（実例ライトアップ）**。

> **スコープ**: 本書は防御・脆弱性理解・正当なセキュリティ教育／バグバウンティのための教材です。攻撃技法は仕組みの理解と防御のために解説しており、実在サービス・本番環境への無許可検証や破壊的手順、特定の演習環境（ラボ）の攻略手順は記載しません。手を動かす対象は、自分が所有または明示的に許可された環境（PortSwigger 等の無償ラボ、意図的に脆弱なローカル環境、スコープ内のバグバウンティ対象）に限ってください。

## 閲覧方法

GitHub 上では [`docs/index.md`](./docs/index.md) からリンクをたどるだけで読めます。ローカルでサイドバー・全文検索・ダーク/ライト・コードコピー付きの本UIにするには：

```bash
pip install mkdocs-material
cd oauth-textbook
mkdocs serve
# → http://127.0.0.1:8000
```

## 構成

| | |
| --- | --- |
| [序章](./docs/00-introduction.md) | 本書の狙いと OAuth 脆弱性の全体像 |
| [第1章](./docs/01-fundamentals.md) | 基礎理解 — フローとロール（RO/Client/AS/RS・各フロー・OIDC） |
| [第2章](./docs/02-vulnerability-classes.md) | 脆弱性クラス【核心】（redirect_uri/state/token漏洩/mix-up/JWT） |
| [第3章](./docs/03-case-studies.md) | 公開ライトアップと実際のバグバウンティ事例【核心】 |
| [第4章](./docs/04-hands-on-methodology.md) | 安全な環境での検証演習と方法論 |
| [第5章](./docs/05-advanced.md) | 発展と最新動向（OAuth 2.1/RFC 9700/DPoP/FAPI/MCP） |
| [付録](./docs/99-appendix.md) | 全URL一覧・未取得資料・用語集・参考書籍 |

## 生成元

- ロードマップ: [`../roadmaps/oauth.md`](../roadmaps/oauth.md)
- 生成スキル: `.claude/skills/textbook-builder`（`/textbook-builder` で再生成可能）
- `sections/` には章結合前の節単位の原稿を保持しています（再生成の起点）。
