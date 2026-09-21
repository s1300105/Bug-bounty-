# HTTPリクエストスマグリング & Webキャッシュ攻撃を極める教科書

HTTPリクエストスマグリング（デシンク攻撃）とWebキャッシュポイズニング／デセプションを、**初級から専門家レベルまで**、原典に忠実に日本語で解説する教科書です。James Kettle（PortSwigger Research）の研究系譜を軸に、HTTPプロトコルの深い理解から古典的スマグリング（CL.TE / TE.CL / TE.TE）、HTTP/2ダウングレード、CL.0 / クライアントサイドデシンク、single-packet attack、そしてキャッシュ攻撃の連鎖までを段階的に積み上げます。

> **本書のスコープ（重要）**
> 本書は**防御・検出・安全な検証の理解を目的**として記述しています。実在するサービスや本番環境への無許可のテストは、その国・地域の法律やサービス規約に違反する可能性があり、決して行ってはいけません。スマグリング系の攻撃は**他ユーザーのリクエストに副作用を及ぼしうる**という固有のリスクを持つため、本書では破壊的手順・実運用ペイロードの完成形ではなく、**なぜ脆弱になるのか（原理）・どう検出するのか・どう防ぐのか**を中心に据えています。手を動かす学習は、PortSwigger Web Security Academy などの**公式に用意された演習ラボ**か、自分で構築した検証環境でのみ行ってください。

## 目次

| 章 | タイトル | 内容 |
|----|----------|------|
| [第1章](01-overview.md) | 全体マップと入口 | 分野の地図・根本原理・バグバウンティ観点の俯瞰 |
| [第2章](02-http-fundamentals.md) | 前提知識：HTTPプロトコルの深い理解 | Content-Length / Transfer-Encoding・チャンク・HTTP/1.1〜2の構造 |
| [第3章](03-smuggling-basics.md) | スマグリング基礎クラス：CL.TE / TE.CL / TE.TE | 古典的3分類の仕組みと検出・悪用の型 |
| [第4章](04-kettle-research.md) | James Kettle / PortSwigger Research の系譜 | Reborn(2019)／HTTP/2 Sequel(2021)／Browser-Powered(2022)／State Machine(2023)／HTTP/1.1 Must Die(2025) |
| [第5章](05-advanced-techniques.md) | 発展的スマグリング技法 | RQP・request tunnelling・CSD・h2c・pipelining切り分け |
| [第6章](06-tools.md) | ツールと実践 | HTTP Request Smuggler・Turbo Intruder・smuggler.py |
| [第7章](07-cache-poisoning.md) | Webキャッシュポイズニング | unkeyed input・Kettleのキャッシュ論文・実例 |
| [第8章](08-cache-deception.md) | Webキャッシュデセプション | Omer Gil原典・学術研究・path confusion |
| [第9章](09-real-world-cases.md) | 実例・ライトアップ・CVE | Apple／Slack／ChatGPT ATO／HackerOne実例 |
| [第10章](10-defense-methodology.md) | 発展・方法論・防御 | 最前線マップ・防御が効かない理由・セキュアコーディング |
| [序章](00-introduction.md) | はじめに | 本書の狙い・前提・学び方 |
| [付録](99-appendix.md) | 付録 | 全URL一覧・未取得資料・用語集・参考書籍 |

## 使い方

1. **順番に読む**のが基本です。第2章のHTTP前提知識が土台になり、第3章の古典的分類が以降すべての基礎になります。
2. **原典を必ず開く**：各章は原典（PortSwigger Research・ホワイトペーパー・ラボ・ライトアップ）へのリンクを豊富に含みます。本書は原典への道案内であり、深い理解は原典を読んで初めて得られます。
3. **手を動かすのは公式ラボで**：PortSwigger Web Security Academy には20以上の無料ラボがあります。安全な環境で検出→再現→防御確認のサイクルを回してください。

## 本書の限界

- 本書は**2次資料を含む原典の要約と地図**であり、原典そのものの置き換えではありません。特にJames Kettleのホワイトペーパーや講演動画は、本書を読んだ後に必ず一次資料に当たってください。
- 一部の資料は生成時にネットワーク上で取得できませんでした（Medium/YouTube/一部PDF等）。該当箇所は本文中に `⚠️ 未取得` として明示し、[付録B](99-appendix.md)にURLと理由を一覧化しています。
- 攻撃技法は日々進化します。特にHTTP/2以降・CDN周りは変化が速く、本書の記述は執筆時点の理解に基づきます。

---

[序章 はじめに →](00-introduction.md)
