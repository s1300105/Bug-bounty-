# 再生成ガイド ― ネットワーク制限のない環境で「原典に忠実」な版へ更新する

このファイルは、**制限のない（外部サイトへ自由にアクセスできる）環境**でこの教科書を作り直すための手順書です。制限のあるサンドボックスで作った初版は、対象資料89件のうち**61件が egress プロキシでブロックされ**、WebSearch要約＋専門知識で復元しています（→ [付録B](./99-appendix.md#付録b自動取得できなかった資料のまとめ)）。開放環境で原典を直接読み込めば、以下が改善します。

## なぜ作り直すのか（メリット）

- **正確性が上がり、ハルシネーション（もっともらしい誤り）が減る**：著者が実際に書いたペイロード・コード・図・手順を原典どおり引用できる。
- **事実の裏取り**：バージョン番号・修正コミット/PR・CVE番号・公開日を原典で確定できる（この分野は陳腐化が速く、ここが重要）。
- **未取得61件がほぼ解消**：PDF論文（Cure53 fp170、Black Hat script gadgets、CCS'17 code-reuse）、speakerdeck/docswell スライド、Medium記事、各ブログ（Bentkowski/Sonar/Flatt/徳丸）等が直接読める。
- **一次ソースの深掘り**：GitHub上の DOMPurify ソース・回帰テスト・PR、ガジェット集を読んでコードレベルで解説できる。
- **Burp公式ドキュメントを正確に反映**：DOM Invader の説明（第3章・第7章）を、記憶ではなく公式ドキュメントの記述で書ける。

## スコープ（ユーザー指定）

- ✅ **原典を直接取得して、第4〜8章を中心に忠実化**する（第1〜3章は微修正でよい）。
- ✅ **Burp（DOM Invader 等）の「説明」は含める・充実させる**。PortSwigger公式ドキュメントを直接読んで正確にする。
- ❌ **Burpのラボ攻略（実際に解いたライトアップ／ステップバイステップの解答）は含めない。** 第7章は「どんなラボがあるか・学習プラットフォームの使い方・チェックリスト」という**オリエンテーション（案内）**にとどめる。

## 前提

- 外部サイトへ自由にアクセスできる環境で **Claude Code** を起動し、このリポジトリ（`s1300105/bug-bounty-`）上で作業する。
- ブランチは `claude/xss-mastery-roadmap-ja-d6esce`（このガイドと同じブランチ）を使う。
- まず `WebFetch` で `https://portswigger.net/burp/documentation/desktop/tools/dom-invader` などを1件試し、`EGRESS_BLOCKED` が出ないこと（＝本当に開放されていること）を確認してから始める。

## 手順（推奨）

1. **セクション単位で作り直す**：初版と同じく、1資料クラスタ＝1エージェントで `xss-textbook/sections/<id>.md` を書き、あとで章ファイルへ結合する。対象IDと担当URLは、リポジトリ内の参照スクリプト [`regen/workflow-reference.js`](./regen/workflow-reference.js) の `SPECS` 配列と、[付録A](./99-appendix.md#付録a全資料一覧章別) を見る。
2. **開放環境向けにスクリプトを調整**してから実行する（`regen/workflow-reference.js` を土台に）。変更点：
   - `BLOCKED_HINT` とツール上限の記述を**緩める／削除**する（直接fetchできるので無駄打ち対策は不要）。各URLは `WebFetch` を1回、失敗時のみ WebSearch。
   - PDF論文は `WebFetch` でテキスト抽出できることが多い。抽出が不十分なら、著者の一次記事や公式リポジトリで補う。
   - 第7章（`s7a_labs`, `s7b_writeups`）のプロンプトに「**ラボの解答・攻略手順は書かない**。ラボの目的・分類・学習プラットフォームの使い方・チェックリストの紹介にとどめる」と明記する。
   - 第3章の DOM Invader 節（`s3a`〜`s3c`）と Burp 関連は、**PortSwigger公式ドキュメントを直接読み込んで説明を正確化**する。
   - **メタ質問への脱線を防ぐ指示**（参照スクリプト冒頭の「★このサブタスクの絶対的な最優先ルール★」ブロック）は**必ず残す**。これが無いと、サブエージェントが直前の会話（例：コスト相談）を優先して執筆を放棄することがある。
   - モデルは **Sonnet** を基本に（安価）。第4章の最難関節（CSP/gadgets/mXSS/PP）だけ Opus にすると質と費用のバランスが良い。
3. **中間成果は都度コミットする**：`xss-textbook/sections/` は **gitignore しない**（このリポジトリでは既にコミット対象）。コンテナは揮発するため、生成できたセクションはこまめに `git add`＋`commit`＋`push` する。
4. **章ファイルへ結合**：`sections/sXX.md` を各章（`01`〜`08`）へ結合する。初版の結合ロジック（各セクションは `##` 始まり、章ファイル先頭に `# 第N章 …`、末尾にナビ）を踏襲する。
5. **付録Bを更新**：新たに取得できた資料は付録Bの一覧から外し、なお取得できなかったものだけ残す。
6. **README の限界説明を更新**：忠実化できた章については「復元中心」の注記を緩める／外す。

## 優先順位（効果の大きい順）

1. **第4章（本丸）**：mXSS・サニタイザ回避・prototype pollution・DOM clobbering・CSP/gadgets。原典の実ペイロード・実コードで最も精度が上がる。
2. **第6章・第8章・第5章**：実例ライトアップ、Trusted Types/Markdown/blind XSS、CSTI/React。
3. **第3章の DOM Invader/Burp 説明**：公式ドキュメントで正確化。
4. **第1〜2章**：初版でも比較的忠実（一部はGitHub原本から復元済み）なので、事実チェック中心の微修正で可。

## 再取得すべき主要資料（原典）

完全な一覧は [付録B](./99-appendix.md#付録b自動取得できなかった資料のまとめ) を参照（61件）。特に効果が大きいのは以下。

- Cure53 mXSS 原典論文（PDF）: https://cure53.de/fp170.pdf
- Bentkowski: MathML名前空間混同 DOMPurify<2.0.17 (CVE-2020-26870): https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/
- PortSwigger: Bypassing DOMPurify again with mutation XSS: https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss
- CSP Is Dead 論文（Google Research）: https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/
- Black Hat: Bypassing XSS Mitigations via Script Gadgets（PDF）: https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf
- Code-Reuse Attacks for the Web（CCS'17 PDF）: https://acmccs.github.io/papers/p1709-lekiesA.pdf
- Bentkowski: AMP4Email DOM Clobbering: https://research.securitum.com/xss-in-amp4email-dom-clobbering/
- Sonar: Mailspring mXSS→RCE: https://www.sonarsource.com/blog/reply-to-calc-the-attack-chain-to-compromise-mailspring/
- Kinugawa: Teams Pwn2Own スライド: https://speakerdeck.com/masatokinugawa
- PortSwigger DOM Invader 公式ドキュメント: https://portswigger.net/burp/documentation/desktop/tools/dom-invader
- web.dev / Chrome: Trusted Types: https://web.dev/articles/trusted-types , https://developer.chrome.com/docs/lighthouse/best-practices/trusted-types-xss
- 徳丸: 画像XSS: https://blog.tokumaru.org/2007/12/image-xss-summary.html

## この環境（開放環境）での起動例（Claude Codeに伝える指示の例）

> 「`xss-textbook/REGENERATION.md` に従って、この教科書を原典に忠実な版へ更新して。`regen/workflow-reference.js` を土台に、開放ネットワーク向けに調整（ブロック対策の記述を外す、Burpラボ攻略は書かない・Burp説明は公式ドキュメントで正確化、メタ質問脱線防止ブロックは残す）したワークフローで、まず第4章から再生成し、都度コミットして。」

---

（目次へ: [README.md](./README.md)）

---

## 一括再生成スクリプト（難所だけ Opus 5）

`regen/workflow-full.js` は、残り全セクションを**一気に**忠実版へ再生成するワークフローです。**難所（`s4g, s4h, s4i, s4j, s4k, s4m, s5a`）だけ Opus 5**、それ以外は Sonnet を、セクション単位で割り当ててあります（`s4a`〜`s4e` は再生成済みのため対象外）。

ローカルの Claude Code（開放ネットワーク・サブスク認証）で：

```
Workflow({ scriptPath: "xss-textbook/regen/workflow-full.js" })
```

完了後、章ファイル（03〜08）を再結合し、付録B/READMEを更新して、コミット＆プッシュする。モデルのエイリアス `opus`/`sonnet` が解決されない場合は、スクリプト内の定数を `claude-opus-5`/`claude-sonnet-5` に置き換える。
