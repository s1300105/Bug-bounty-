# CSRF & CORSを極める教科書

CSRF（Cross-Site Request Forgery）と CORS（Cross-Origin Resource Sharing）設定不備を、**初級者から専門家まで**段階的に深掘りするための日本語教科書です。バグバウンティ・脆弱性リサーチ・防御設計の実務に耐える密度を目標に、`roadmaps/csrf&cors.md`（URL 付き学習ロードマップ）の各資料を**原典から取得して**章立てに再構成しました。

> **本書のスコープ（重要）**
> 本書は**防御・脆弱性理解・正当なセキュリティ教育／バグバウンティ**のための教材です。攻撃技法は「なぜ成立するのか」という仕組みの理解と、それを踏まえた防御設計のために解説しています。**実在サービス・本番環境への無許可の検証や、破壊的な手順は記載しません**。特定の演習環境（ラボ）を解くための攻略手順も本書の目的ではありません。手を動かす際は、必ず自分が所有する、または明示的に許可された環境（PortSwigger 等の無償ラボ、意図的に脆弱なローカル環境、スコープ内のバグバウンティ対象）でのみ行ってください。

---

## この本の使い方

- CSRF / CORS は「SameSite 時代でも死んでいない」。刺さる領域はほぼ固定されています。学習は **「正しい仕組み」と「実装／防御がどこで崩れるか」を対で覚える**のが効率的です。第1章（Cookie/SameSite）と第5章（SOP/CORS）でそれぞれの土台を押さえてから、核心章に進んでください。
- **核心は第3章・第4章・第6章、そして連鎖を扱う第8章**です。受理される深いバグの源泉はここに集中します。とりわけ「トークンはあるが検証／紐づけが甘い」パターンと、SameSite bypass の4手法（method override / cookie refresh / client-side redirect / sibling domain）を手癖にすることが目標です。
- **`SameSite=None` を見たら CORS credential 窃取、`Lax`/未指定を見たら Lax bypass** ——この分岐が CSRF と CORS をつなぐ最重要の勘所です（序章参照）。
- 各節の末尾には `> 出典: 記事名 — URL` を明記しています。原典に当たる習慣をつけてください。取得できなかった資料は本文中に `⚠️ 未取得の資料` として明示し、**付録B**に一覧化しています。

### 閲覧方法（MkDocs）

```bash
pip install mkdocs-material
cd csrf\&cors-textbook
mkdocs serve
# → http://127.0.0.1:8000 でサイドバー・全文検索・ダーク/ライト・コードコピー付きで読めます
```

GitHub 上では、この `docs/index.md` から各章のリンクをたどっても読めます。

---

## 目次

| 章 | タイトル | 位置づけ |
| --- | --- | --- |
| — | [序章：本書の狙いと CSRF / CORS の全体像](00-introduction.md) | 学習マップ・4領域・判断シグナル |
| 第1章 | [前提 — Cookie・オリジン・SameSite の基礎](01-fundamentals.md) | Cookie属性/オリジン/Laxデフォルト化 |
| 第2章 | [古典的 CSRF のエクスプロイト](02-classic-csrf.md) | PoC生成の型・状態変更→ATO |
| 第3章 | [CSRFトークン・防御ロジックのバイパス](03-token-bypass.md) | 検証欠陥・JSON CSRF【核心】 |
| 第4章 | [SameSite 時代の高度な CSRF](04-samesite-advanced.md) | SameSite bypass 4手法・client-side CSRF【核心】 |
| 第5章 | [前提 — SOP と CORS の仕組み](05-cors-fundamentals.md) | preflight/simple request/ACAC:true |
| 第6章 | [CORS 設定不備のエクスプロイト](06-cors-exploitation.md) | origin反射/null/正規表現バイパス【核心】 |
| 第7章 | [CORS 攻撃の発展](07-cors-advanced.md) | Vary:Origin欠落・キャッシュ悪用 |
| 第8章 | [CSRF/CORS の連鎖と他脆弱性との組み合わせ](08-chaining.md) | CORS→CSRF→ATO・OAuth state【核心】 |
| 第9章 | [ツールと方法論](09-tooling.md) | Corsy/CORScanner/CorsMe/Burp |
| 第10章 | [実例・CVE・報奨事例](10-real-cases-cve.md) | HackerOne・Casdoor/Owncast/Langflow |
| 第11章 | [発展・方法論・防御の理解](11-methodology-defense.md) | チェックリスト・防御メカニズム |
| 付録 | [付録A/B・用語集・参考書籍](99-appendix.md) | 全URL・未取得資料・用語 |

---

## 本書の限界

- 一部の walkthrough は個人ブログ / Medium 由来で、ラボ更新により手順が古くなる可能性があります。必ず一次（PortSwigger）で答え合わせを。
- 生成時に原典を直接取得できなかった資料が **22件** あります（HTTP 403/404・動的レンダリング・PDF 容量超過など）。該当箇所は本文に `⚠️ 未取得の資料` として明示し、WebSearch の要約・同一著者の公式記事・ミラー等で補完しています。詳細は[付録B](99-appendix.md)。
- CVE 番号や CVSS スコアは advisory 発行元により表記差があり得ます。悪用可否は必ず自分が許可された環境で再検証してください。
- 本書は「手法・思考プロセス」を学ぶための教材です。HackerOne 公開レポートの一部は伏字であり、学ぶべきは対象情報ではなく**再現可能な原理**です。
