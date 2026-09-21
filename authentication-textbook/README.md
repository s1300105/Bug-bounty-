# 認証(Authentication)を極める教科書

Web認証（ログイン・JWT・SAML・WebAuthn/パスキー・MFA・パスワードリセット・アカウント乗っ取り）の脆弱性を初級者から専門家まで段階的に学ぶ、**原典に忠実な日本語教科書**です。`roadmaps/authentication.md`（URL付き学習ロードマップ）の各資料を原典から取得し、全10章＋序章＋付録に再構成しました。

- **本文は [`docs/`](./docs/) にあります。** 入口は [`docs/index.md`](./docs/index.md)。
- 核心は **第2章（JWT）・第3章（SAML）・第5章（MFAバイパス）・第6章（パスワードリセット）・第7章（ATOへの統合）**。

> **スコープ**: 本書は防御・脆弱性理解・正当なセキュリティ教育／バグバウンティのための教材です。攻撃技法は仕組みの理解と防御のために解説しており、実在サービス・本番環境への無許可検証や破壊的手順、特定の演習環境（ラボ）の攻略手順は記載しません。手を動かす対象は、自分が所有または明示的に許可された環境（PortSwigger 等の無償ラボ、意図的に脆弱なローカル環境、スコープ内のバグバウンティ対象）に限ってください。

## 閲覧方法

GitHub 上では [`docs/index.md`](./docs/index.md) からリンクをたどるだけで読めます。ローカルでサイドバー・全文検索・ダーク/ライト・コードコピー付きの本UIにするには：

```bash
pip install mkdocs-material
cd authentication-textbook
mkdocs serve
# → http://127.0.0.1:8000
```

## 構成

| | |
| --- | --- |
| [序章](./docs/00-introduction.md) | 本書の狙いと認証脆弱性の全体像 |
| [第1章](./docs/01-auth-basics.md) | 認証の全体像と基礎（学習パス・OWASPテスト観点・チェックリスト） |
| [第2章](./docs/02-jwt.md) | JWT攻撃【核心】（alg混同・kid/jku/jwk注入・チートシート） |
| [第3章](./docs/03-saml.md) | SAML攻撃【核心】（署名ラッピングXSW・XMLコメント・パーサ差異） |
| [第4章](./docs/04-webauthn-passkeys.md) | WebAuthn／パスキー（FIDO2）（仕組み・実装ミス・紐付け不備ATO） |
| [第5章](./docs/05-mfa-bypass.md) | MFA／2FAバイパス【核心】（手法カタログ・レート制限回避・実事例） |
| [第6章](./docs/06-password-reset.md) | パスワードリセット導線【核心】（リセットポイズニング・トークン設計） |
| [第7章](./docs/07-account-takeover.md) | アカウント乗っ取り（ATO）への統合【核心】 |
| [第8章](./docs/08-tools.md) | ツールと実践（jwt_tool・SAML Raider・Burp JWT Editor） |
| [第9章](./docs/09-real-world-cases.md) | 実例・ライトアップ・報奨事例 |
| [第10章](./docs/10-methodology.md) | 方法論・チェックリスト・発展 |
| [付録](./docs/99-appendix.md) | 全URL一覧・未取得資料・用語集・参考書籍 |

## 生成元

- ロードマップ: [`../roadmaps/authentication.md`](../roadmaps/authentication.md)
- 生成スキル: `.claude/skills/textbook-builder`（`/textbook-builder` で再生成可能）
- `sections/` には章結合前の節単位の原稿を保持しています（再生成の起点）。
