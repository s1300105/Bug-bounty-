# GraphQL & WebSocket セキュリティを極める教科書

GraphQL と WebSocket/CSWSH のセキュリティを、**初級から専門家レベルまで**、URL付き学習ロードマップの原典に忠実に日本語で解説する教科書です。GraphQL の「introspection → 認可欠落(BOLA/BFLA) → alias/batching によるレート制限・2FA/OTP 総当りバイパス → 深いネスト DoS → injection」という登り方と、WebSocket の「ハンドシェイク理解 → CSWSH → メッセージ経由インジェクション」という登り方を、実 CVE・実 HackerOne 報告で裏取りしながら段階的に積み上げます。全10章＋序章＋付録で構成しています。

> **本書のスコープ（重要）**
> 本書は**防御・検出・安全な検証の理解を目的**として記述しています。実在するサービスや本番環境への無許可のテストは、その国・地域の法律やサービス規約に違反する可能性があり、決して行ってはいけません。とくに **DoS・総当り・バッチング攻撃は他ユーザーや対象システムに実害を及ぼしうる**ため、本書では破壊的手順や実運用ペイロードの完成形ではなく、**なぜ脆弱になるのか（原理）・どう検出するのか・どう防ぐのか**を中心に据えています。手を動かす学習は、PortSwigger Web Security Academy などの**公式に用意された演習ラボ**か、Damn Vulnerable GraphQL Application (DVGA) のように自分で構築した検証環境でのみ行ってください。なお本書はラボの解答手順（攻略）は掲載しません。

## 目次

| 章 | タイトル |
|----|----------|
| [第1章](01-graphql-fundamentals.md) | 前提: GraphQLの仕組みを攻撃者視点で理解する |
| [第2章](02-recon-introspection.md) | Recon と introspection |
| [第3章](03-authorization-bola-bfla.md) | 認可・アクセス制御の脆弱性 (BOLA/BFLA) |
| [第4章](04-graphql-specific-attacks.md) | GraphQL特有の攻撃: alias/batching・ネストDoS・injection |
| [第5章](05-tools-methodology.md) | ツールと方法論 |
| [第6章](06-websocket-fundamentals.md) | 前提: WebSocketの仕組み |
| [第7章](07-cswsh.md) | CSWSH (Cross-Site WebSocket Hijacking) |
| [第8章](08-websocket-other-vulns.md) | WebSocketの他の脆弱性 |
| [第9章](09-case-studies-cve.md) | 実例・ライトアップ・CVE・報奨事例 |
| [第10章](10-defense-methodology.md) | 発展・方法論・防御の理解 |
| [付録](99-appendix.md) | 全URL一覧・未取得資料・用語集・参考書籍 |
| [序章](00-introduction.md) | 本書の位置づけと読み方 |

## この本の使い方

1. **まず[序章](00-introduction.md)** で全体像とロードマップの5段階（基礎→認可→武器化→WebSocket→統合）を掴む。
2. Part A（第1〜5章）で GraphQL を、Part B（第6〜8章）で WebSocket を学び、Part C（第9〜10章）で実例と防御に統合する。
3. **★武器化の核は第4章（alias/batching・ネスト DoS）と第7章（CSWSH）**。ここに最も時間を割く。
4. 各章末に出典 URL を明記しているので、原典にあたって深掘りする。

## 本書の限界

- 二次資料（商用ブログを含む）に基づく箇所があります。CVE 番号・CVSS スコアなどの数値は、必ず [NVD](https://nvd.nist.gov/) 等の一次情報で裏取りしてください（**同一 CVE でも評価者により CVSS が割れる**例が本書中に複数あります）。
- 生成時にネットワーク上の理由で取得できなかった資料は [付録B](99-appendix.md#付録b-取得できなかった資料) に URL と理由を明記しています。該当箇所は本文にも `⚠️ 未取得` 注記があります。
