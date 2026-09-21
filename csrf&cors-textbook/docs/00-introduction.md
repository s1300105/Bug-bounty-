# 序章：本書の狙いと CSRF / CORS の全体像

## なぜ今さら CSRF / CORS を「極める」のか

「CSRF は SameSite=Lax がデフォルトになった時代に死んだ」——この誤解こそが、いま CSRF / CORS を学ぶ最大の理由です。実際には、刺さる領域が**固定化・高度化**しただけで、受理される脆弱性は今も出続けています。2025年には Langflow の **CVE-2025-34291**（CVSS 9.4、`allow_origins='*'` + `allow_credentials=True` + refresh token の `SameSite=None` の合わせ技で CORS→ATO→RCE、CISA KEV 登録・APT による実悪用）が示したように、CSRF と CORS の**相互作用**の理解は、むしろ以前より価値が上がっています。

本書は、URL 付き学習ロードマップ（`roadmaps/csrf&cors.md`）の各資料を**原典から取得して**章立てに再構成した日本語教科書です。単なる用語集ではなく、「なぜ SameSite 時代でも成立するのか」「防御のどこが崩れるのか」を仕組みのレベルで結び付けて理解し、**防御設計と正当なバグバウンティ**に耐える密度を目標にしています。

> **本書のスコープ（重要）**
> 本書は**防御・脆弱性理解・正当なセキュリティ教育／バグバウンティ**のための教材です。攻撃技法は「なぜ成立するのか」という仕組みの理解と、それを踏まえた防御設計のために解説しています。**実在サービス・本番環境への無許可の検証や、破壊的な手順は記載しません**。また、特定の演習環境（ラボ）を解くための攻略手順そのものも本書の目的ではありません。手を動かす際は、必ず自分が所有する、または明示的に許可された環境（PortSwigger 等の無償ラボ、意図的に脆弱なローカル環境、スコープ内のバグバウンティ対象）でのみ行ってください。

## 刺さる4領域（学習の投資先）

ロードマップの核心は、学習資源を次の4点に集中投下することです。本書もこの構造に沿っています。

1. **CSRFトークン／防御ロジックのバイパス** — トークンは「ある」が検証が甘いケース（メソッド依存検証、非セッション紐づけ、double submit の欠陥、Referer/Origin 検証の甘さ、Content-Type 偽装による simple request 化）。→ 第3章
2. **SameSite bypass** — client-side redirect gadget、sibling domain、Lax+GET、method override、cookie refresh の2分猶予 window。ここが「自動ツールで見つからない・人間の実力が出る」最重要ゾーン。→ 第4章
3. **CORS の origin 反射／null origin／正規表現バイパス** + `Access-Control-Allow-Credentials: true` による認証済みレスポンス窃取。→ 第6章・第7章
4. **①〜③のチェーン** — CORS→CSRFトークン窃取→CSRF、XSS on subdomain→CORS、OAuth state 欠落→CSRF ATO。単独では低評価でも連鎖で Critical に化ける。→ 第8章

## 本書の構成（全11章 + 序章 + 付録）

ロードマップの3部構成（Part A: CSRF / Part B: CORS / Part C: 統合・実践）に対応します。

- **第1章 前提 — Cookie・オリジン・SameSite の基礎** … Cookie 属性、オリジンの定義、SameSite Lax デフォルト化がもたらした変化。上位のバイパスを理解する土台。
- **第2章 古典的 CSRF のエクスプロイト** … PoC 生成の型（自動送信フォーム、GET/POST、`enctype`）、状態変更→ATO の型。
- **第3章 CSRFトークン・防御ロジックのバイパス【核心】** … 受理される多くの CSRF の源泉。JSON CSRF を含む。
- **第4章 SameSite 時代の高度な CSRF【核心】** … 武器化の核。SameSite bypass の4手法と client-side CSRF（JAW / CSPT2CSRF）。
- **第5章 前提 — SOP と CORS の仕組み** … preflight / simple request の境界、なぜ ACAC:true が致命的か。
- **第6章 CORS 設定不備のエクスプロイト【核心】** … origin 反射・null origin・正規表現バイパスの3型。James Kettle・jub0bs の研究。
- **第7章 CORS 攻撃の発展** … `Vary: Origin` 欠落によるキャッシュ悪用、開発用 origin 許可、HTTPS→HTTP 信頼。
- **第8章 CSRF/CORS の連鎖【核心】** … 報酬額の分水嶺。OAuth state 欠落を含む。
- **第9章 ツールと方法論** … Corsy / CORScanner / CorsMe / CORStest / Burp。検出はあくまで入口、最終判定は手動。
- **第10章 実例・CVE・報奨事例** … HackerOne 公開レポート、Casdoor / Owncast / Langflow の CVE で相場観と報告文の型を得る。
- **第11章 発展・方法論・防御の理解** … 体系的テストのチェックリスト化と、防御メカニズム（＝回避対象）の理解。
- **付録** … 付録A（全URL）／付録B（未取得資料）／付録C（用語集）／付録D（参考書籍）。

## 前提知識

- HTTP（メソッド・ステータス・ヘッダ・Cookie・リダイレクト）とブラウザのセキュリティモデル（同一オリジンポリシー）。
- URL の構造とパーサの挙動（スキーム・ホスト・ポート・パス・クエリ・フラグメント）。
- HTML フォームと基本的な JavaScript（`fetch` / `XMLHttpRequest`、`credentials` オプション）。

これらに不安があれば、本リポジトリの「クライアントサイド脆弱性ハンティングの基盤技術を極める教科書」を先に読むと土台が固まります。

## 読み進め方のコツ

- **判断を変えるシグナルを最優先で覚える**：対象 Cookie が `SameSite=None` → CORS credential 窃取を最優先。`SameSite=Lax`/未指定 → Lax bypass（GET 経路・method override・redirect gadget）へ切り替え。CORS 応答が `Vary: Origin` を欠く → キャッシュ悪用での XSS 化を検討。
- **`SameSite=Lax`（現行デフォルト）下では CORS の credential 窃取は成立しにくい**（クロスオリジンの JS 発リクエストに Cookie が乗らないため）。CORS ペイロードに時間を割く前に、対象 Cookie の属性（特に `SameSite=None`）を必ず確認してください。この一点が CSRF と CORS をつなぐ最重要の勘所です。
- 各節の末尾には `> 出典: 記事名 — URL` を明記しています。原典に当たる習慣をつけてください。取得できなかった資料は本文中に `⚠️ 未取得の資料` として明示し、**付録B**に一覧化しています。

---

## ナビゲーション

[← 📚 目次（ホーム）](index.md)　｜　[第1章 前提 — Cookie・オリジン・SameSiteの基礎 →](01-fundamentals.md)
