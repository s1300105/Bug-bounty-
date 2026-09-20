# セキュリティ教科書ライブラリ

URL付きの学習ロードマップから生成した、**原典に忠実な日本語教科書**を集めたリポジトリです。各教科書はそのまま GitHub 上で読めます（設定不要）。

## 教科書一覧

- [XSSを極める教科書](./xss-textbook/docs/index.md) ― AI・自動スキャナが苦手なXSS（DOM/mXSS/サニタイザ回避/CSP/prototype pollution/DOM clobbering/script gadgets ほか）全8章＋付録
- （今後追加）SQLi, SSRF, XXE, CSRF, SSTI …

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
