# OAuthを極める教科書

OAuth 2.0 / OpenID Connect（OIDC）の脆弱性を、**初級者から専門家まで**段階的に深掘りするための日本語教科書です。バグバウンティ・脆弱性リサーチ・防御設計の実務に耐える密度を目標に、`roadmaps/oauth.md`（URL付き学習ロードマップ）の各資料を**原典から取得して**章立てに再構成しました。

> **本書のスコープ（重要）**
> 本書は**防御・脆弱性理解・正当なセキュリティ教育／バグバウンティ**のための教材です。攻撃技法は「なぜ成立するのか」という仕組みの理解と、それを踏まえた防御設計のために解説しています。**実在サービス・本番環境への無許可の検証や、破壊的な手順は記載しません**。特定の演習環境（ラボ）を解くための攻略手順も本書の目的ではありません。手を動かす際は、必ず自分が所有する、または明示的に許可された環境（PortSwigger 等の無償ラボ、意図的に脆弱なローカル環境、スコープ内のバグバウンティ対象）でのみ行ってください。

---

## この本の使い方

- OAuth の脆弱性は「プロトコルの欠陥」ではなく「仕様が柔軟すぎて実装者が細部を誤る」ことに起因します。学習は **「正しいフロー」と「実装がどこで崩れるか」を対で覚える**のが効率的です。第1章でフローを正確に押さえてから、第2章の脆弱性クラスに進んでください。
- **核心は第2章（脆弱性クラス）と第3章（実例ライトアップ）**です。IDOR/Web ハントの経験を活かすなら、`redirect_uri` 検証不備・`state` 欠如（CSRF）・トークン/コード漏洩・アクセストークン検証不備（ソーシャルログイン）が投資対効果の高い最頻出クラスです。
- 各節の末尾には `> 出典: 記事名 — URL` を明記しています。原典に当たる習慣をつけてください。
- 取得できなかった資料は本文中に `⚠️ 未取得の資料` として明示し、**付録B**に一覧化しています。

### 閲覧方法（MkDocs）

```bash
pip install mkdocs-material
cd oauth-textbook
mkdocs serve
# → http://127.0.0.1:8000 でサイドバー・全文検索・ダーク/ライト・コードコピー付きで読めます
```

GitHub 上では、この `docs/index.md` から各章のリンクをたどっても読めます。

---

## 目次

| 章 | タイトル | 位置づけ |
| --- | --- | --- |
| — | [序章：本書の狙いと OAuth 脆弱性の全体像](00-introduction.md) | 学習マップと前提 |
| 第1章 | [基礎理解 — フローとロール](01-fundamentals.md) | RO/Client/AS/RS・各フロー・OIDC |
| 第2章 | [脆弱性クラスを一つずつ理解する](02-vulnerability-classes.md) | redirect_uri/state/token漏洩/mix-up/JWT【核心】 |
| 第3章 | [公開ライトアップと実際のバグバウンティ事例](03-case-studies.md) | dirty dancing/Homakov/Salt Labs/ATO連鎖【核心】 |
| 第4章 | [安全な環境での検証演習と方法論](04-hands-on-methodology.md) | ラボの論点・SSRF・algorithm confusion・チェックリスト |
| 第5章 | [発展と最新動向](05-advanced.md) | OAuth 2.1/RFC 9700/DPoP/FAPI/MCP |
| 付録 | [付録A/B・用語集・参考書籍](99-appendix.md) | 全URL・未取得資料・用語 |

---

## 推奨学習パス（8週間）

1. **第1〜2週（基礎）**: 第1章。4ロール（RO/Client/AS/RS）と各フロー（Authorization Code / Implicit / Client Credentials / Device / PKCE）、access/ID/refresh トークンの違い、OIDC の `id_token` 検証（`iss`/`aud`/`nonce`/署名）を、Playground を動かしながら体に入れる。
2. **第3〜4週（脆弱性クラス【核心】）**: 第2章。redirect_uri 検証不備・state 欠如・コード横取り・PKCE downgrade・JWT（`alg=none`/algorithm confusion）・id_token 検証不備を、発生条件・検出・悪用・対策の 4 点セットで覚える。
3. **第5〜6週（実例で思考を学ぶ【核心】）**: 第3章。dirty dancing、Homakov の古典、Salt Labs の access token 未検証 3 部作、ATO 連鎖を読み、攻撃者の当たりの付け方を内面化する。
4. **第7週（安全な演習）**: 第4章。許可されたラボで論点を再現し、脅威モデル／チェックリストで漏れなく回す方法論を身につける。
5. **第8週＋継続（最先端）**: 第5章。RFC 9700（BCP 240）で公式化された Implicit/Password grant 廃止・全 code flow への PKCE 必須化、DPoP、FAPI、MCP の認可課題まで押さえる。

> **「専門家」と名乗れる閾値**: 未知のアプリで OAuth フローの崩れ（redirect_uri・state・token/コード漏洩・id_token/access_token 検証不備）を発見し、（許可された環境で）アカウント乗っ取り等の意味ある影響まで実証でき、RFC 9700 / OIDC 仕様に基づく明確で実行可能な修正案を書ける。

---
