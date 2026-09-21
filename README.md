# セキュリティ教科書ライブラリ

URL付きの学習ロードマップから生成した、**原典に忠実な日本語教科書**を集めたリポジトリです。各教科書はそのまま GitHub 上で読めます（設定不要）。

## 教科書一覧

- [XSSを極める教科書](./xss-textbook/docs/index.md) ― AI・自動スキャナが苦手なXSS（DOM/mXSS/サニタイザ回避/CSP/prototype pollution/DOM clobbering/script gadgets ほか）全8章＋付録
- [SQLiを極める教科書](./sqli-textbook/docs/index.md) ― SQLインジェクションを初級〜専門家レベルまで（クエリ構文の破壊・UNION/Blind/時間ベース/OOB・WAF回避・自動化・防御ほか）原典に忠実に解説
- [クライアントサイド脆弱性ハンティングの基盤技術を極める教科書](./clientside-textbook/docs/index.md) ― 穴の知識ではなく土台（ブラウザ内部／セキュリティモデル／JS深読解／bundle・難読化解析／DevTools・DOM Invaderでのsource→sink追跡）全9章＋序章＋付録
- [Reconを極める教科書](./recon-textbook/docs/index.md) ― 偵察を「手順」から「武器」へ（資産発見／サブドメイン列挙／Shodan・favicon hash／JS・OSINT・GitHub・クラウド／自動化パイプライン／CT継続監視）全11章＋序章＋付録
- [SSRFを極める教科書](./ssrf-textbook/docs/index.md) ― サーバサイドリクエストフォージェリを初級〜専門家まで（内部到達・ポートスキャン／Blind・OAST／クラウドメタデータ IMDSv1/v2／URLパーサ・フィルタ回避／gopherプロトコルスマグリング→RCE／防御設計）全10章＋序章＋付録
- [OAuthを極める教科書](./oauth-textbook/docs/index.md) ― OAuth 2.0／OpenID Connect の脆弱性を初級〜専門家まで（フローとロール／redirect_uri・state・トークン漏洩・mix-up・JWT／dirty dancing・Salt Labs 等の実例／安全な検証演習と方法論／OAuth 2.1・RFC 9700・DPoP・FAPI・MCP）全5章＋序章＋付録
- [AIセキュリティを極める教科書](./ai-textbook/docs/index.md) ― AI／LLMアプリの脆弱性を初級〜専門家まで（LLM起点の従来型Web脆弱性 Insecure Output Handling→XSS/RCE/SSRF／直接・間接プロンプトインジェクション／エージェント・MCP tool poisoning／RAG・埋め込み／pickle RCE・MLOps・LangChain 実CVE・huntr／Bing・Bard・Copilot・ChatGPT 実例／AIレッドチーミング garak・PyRIT・Promptfoo）全9章＋序章＋付録
- [CSRF & CORSを極める教科書](./csrf&cors-textbook/docs/index.md) ― CSRFとCORS設定不備をSameSite時代の武器として（トークン/防御バイパス・JSON CSRF／SameSite bypass 4手法・client-side CSRF／origin反射・null・正規表現バイパス+ACAC:true／CORS→CSRF→ATO連鎖・OAuth state／Casdoor・Owncast・Langflow CVE／Corsy等ツールと防御）全11章＋序章＋付録
- [認証(Authentication)を極める教科書](./authentication-textbook/docs/index.md) ― Web認証の脆弱性を初級〜専門家まで（学習パス・OWASPテスト観点／JWT alg混同・kid/jku/jwk注入／SAML署名ラッピングXSW・XMLコメント・パーサ差異CVE／WebAuthn・パスキー実装ミスと紐付け不備ATO／MFA・2FAバイパス手法とレート制限回避／パスワードリセットポイズニング／バグ連鎖によるATO統合／jwt_tool・SAML Raider・Burp JWT Editor／HackerOne実報告）全10章＋序章＋付録
- [XXE & ファイルアップロードを極める教科書](./xxe&fileupload-textbook/docs/index.md) ― XML外部実体注入とファイルアップロードを武器化の核として（XML/DTD基礎／古典的XXE・SSRF／Blind XXE・外部DTD exfil・ローカルDTD再利用／SVG・OOXML・SAML経由XXE／WAF回避・XXE→RCE・XSLT／アップロード検証バイパス・.htaccess・polyglot／Webシェル・ImageTragick・Zip Slip・Stored XSS／Facebook 2事例・TOPXXE／防御）全11章＋序章＋付録
- [HTTPリクエストスマグリング & Webキャッシュ攻撃を極める教科書](./request-smuggling-textbook/docs/index.md) ― デシンク攻撃を初級〜専門家まで（HTTP前提知識／CL.TE・TE.CL・TE.TE／James Kettle研究系譜 Reborn・HTTP2 Sequel・Browser-Powered・State Machine・HTTP1.1 Must Die／CL.0・クライアントサイドデシンク・single-packet attack／HTTP Request Smuggler・Turbo Intruder／Webキャッシュポイズニング・デセプション／Apple・Slack・ChatGPT ATO 実例・防御）全10章＋序章＋付録
- [安全でないデシリアライゼーション & SSTI → RCEを極める教科書](./insecuredeserialization+SSTI=RCE-textbook/docs/index.md) ― 信頼できない入力がデータからコード実行に化ける2脆弱性を武器化の核（ガジェットチェーン構築／サンドボックス脱出）から（PHP POP・PHAR／Java CommonsCollections1・JNDI/Log4Shell・marshalsec／.NET ViewState・MachineKey・JSON Attacks／Python pickle・AIモデルRCE・Rubyユニバーサルガジェット・Node.js／GadgetInspector・ODDFuzz／Jinja2フィルタ回避・Twig/Smarty・FreeMarker/SpEL／SSTImap・tplmap／Orange Tsai多重チェーン・CVE／safetensors・CodeQL・look-ahead防御）全11章＋序章＋付録
- [IDOR/BOLA・アクセス制御・ビジネスロジックを極める教科書](./idor&bola-textbook/docs/index.md) ― スキャナが最も苦手な認可・ロジック領域を「勘」から「型」へ（認証vs認可・垂直/水平・RBAC/ABAC・OWASP A01/API Top10／IDOR分類学・2アカウント法・バイパスチェックリスト／URL正規化差異・HTTPメソッド改変・401/403突破・X-Original-URL／価格/数量/状態機械の破壊・Coinbase $250k・リセット/2FAバイパス／single-packet attack・limit-overrun・Kettle原論文／cross-tenant IDOR・テナント分離／BOLA/BFLA/BOPLA・GraphQL alias/batch・Mass Assignment／Autorize・AuthMatrix／reddelexc・Top25 IDOR・Sam Curry自動車事例／権限マトリクス→A-B/A-B-Aテスト→総当り→チェーン化）全10章＋序章＋付録

## 読み方

- **他のPC/スマホから**：この目次の各リンクをGitHub上でクリックするだけ（ログインできればOK）。各教科書は `<topic>-textbook/docs/index.md` が入口です。
- **ローカルで本UI（サイドバー＋全文検索）にするなら**：対象フォルダで
  ```
  python3 -m pip install --user mkdocs-material
  cd <topic>-textbook
  mkdocs serve
  ```

## 生成のしくみ（開発者向け）

- `textbook-pipeline/` … 主題非依存の生成パイプライン本体とランブック。
- `.claude/skills/textbook-builder/` … Claude Code のプロジェクトスキル。ロードマップを置いて `/textbook-builder` を呼ぶと教科書ができる。
