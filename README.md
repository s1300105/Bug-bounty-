# セキュリティ教科書ライブラリ

URL付きの学習ロードマップから生成した、**原典に忠実な日本語教科書**を集めたリポジトリです。各教科書はそのまま GitHub 上で読めます（設定不要）。

## 教科書一覧

- [XSSを極める教科書](./xss-textbook/docs/index.md) ― AI・自動スキャナが苦手なXSS（DOM/mXSS/サニタイザ回避/CSP/prototype pollution/DOM clobbering/script gadgets ほか）全8章＋付録
- [SQLiを極める教科書](./sqli-textbook/docs/index.md) ― SQLインジェクションを初級〜専門家レベルまで（クエリ構文の破壊・UNION/Blind/時間ベース/OOB・WAF回避・自動化・防御ほか）原典に忠実に解説
- [クライアントサイド脆弱性ハンティングの基盤技術を極める教科書](./clientside-textbook/docs/index.md) ― 穴の知識ではなく土台（ブラウザ内部／セキュリティモデル／JS深読解／bundle・難読化解析／DevTools・DOM Invaderでのsource→sink追跡）全9章＋序章＋付録
- [Reconを極める教科書](./recon-textbook/docs/index.md) ― 偵察を「手順」から「武器」へ（資産発見／サブドメイン列挙／Shodan・favicon hash／JS・OSINT・GitHub・クラウド／自動化パイプライン／CT継続監視）全11章＋序章＋付録
- [SSRFを極める教科書](./ssrf-textbook/docs/index.md) ― サーバサイドリクエストフォージェリを初級〜専門家まで（内部到達・ポートスキャン／Blind・OAST／クラウドメタデータ IMDSv1/v2／URLパーサ・フィルタ回避／gopherプロトコルスマグリング→RCE／防御設計）全10章＋序章＋付録
- [OAuthを極める教科書](./oauth-textbook/docs/index.md) ― OAuth 2.0／OpenID Connect の脆弱性を初級〜専門家まで（フローとロール／redirect_uri・state・トークン漏洩・mix-up・JWT／dirty dancing・Salt Labs 等の実例／安全な検証演習と方法論／OAuth 2.1・RFC 9700・DPoP・FAPI・MCP）全5章＋序章＋付録
- （今後追加）XXE, CSRF, SSTI …

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
