---
name: textbook-builder
description: URL付きロードマップ（Markdownの表・箇条書き・散文など形式は問わない）から、原典に忠実な日本語教科書を生成する。脆弱性クラスや技術テーマを問わず再利用できる。ユーザーが「このロードマップから教科書/教材を作って」「URL集をまとめて解説書に」などと言ったときに使う。
---

# textbook-builder スキル

URL付きロードマップを入力に、章立てされた日本語教科書（Markdown）を、**原典を直接取得して**生成する。過去の運用で得た注意点（サブエージェントの話題それ防止、モデル自動配分、ネットワーク遮断へのフォールバック、揮発対策）を織り込んである。

## 使う手順

### 1. 入力を確認する（足りなければユーザーに聞く）
- `roadmapPath`: URL付きロードマップのファイル（必須）
- `topic`: 主題（例: CSRF, SSRF, JWT）（必須）
- `outDir`: 出力先フォルダ（省略時 `<topic>-textbook`）
- `scopeRules`: 全節に共通適用する制約（任意。例「防御目的で記述。無許可検証手順は書かない」）

### 2. ネットワークを確認（開放環境推奨）
代表URLを1件 `WebFetch` して `EGRESS_BLOCKED` 等が出ないか確認する。ブロックされていてもワークフローは動く（フォールバックして `⚠️ 未取得` 注記を残す）が、忠実版には開放環境が望ましい。

### 3. ワークフローを実行
このスキルディレクトリに同梱の `build-textbook.workflow.js` を Workflow の scriptPath に渡す。パスは**設置場所に応じて**選ぶ（どちらでも動く）:
- 個人スキル（このマシン限定）: `~/.claude/skills/textbook-builder/build-textbook.workflow.js`
- プロジェクトスキル（リポジトリ同梱・**クラウド/他マシンでも有効**）: `.claude/skills/textbook-builder/build-textbook.workflow.js`

```
Workflow({
  scriptPath: ".claude/skills/textbook-builder/build-textbook.workflow.js",
  args: { roadmapPath, outDir, topic, scopeRules }
})
```

計画フェーズがロードマップを解析して章・節へ構造化し、各節を難所か自動分類。執筆フェーズが節ごとに `outDir/sections/<id>.md` を生成する（難所=Opus、他=Sonnet）。

### 4. 実行後の組み立て（メインループで行う） ― MkDocsサイトになる構成にする
`<outDir>/docs/` に本文を、`<outDir>/mkdocs.yml` に設定を置く（＝そのまま `mkdocs serve` で本らしく読める）。
1. **docsフォルダ作成**: `mkdir -p outDir/docs`。
2. **章ファイルへ結合**: `outDir/sections/s<章>*.md` を章順に連結し `outDir/docs/NN-<slug>.md` を作る（例 `01-basics.md`）。各節は `##` 始まり。章ファイル先頭に `# 第N章 <タイトル>`、末尾に前後章＋目次へのナビ（目次は `index.md` を指す）。
3. **目次・序章**: `outDir/docs/index.md`（目次・使い方・限界。サイトのホーム）と `outDir/docs/00-introduction.md`。
4. **付録**: `outDir/docs/99-appendix.md` に 付録A(全URL) / 付録B(**取得できなかった資料**＝戻り値の `inaccessible` から生成、URL＋理由) / 用語集 / 参考書籍。
5. **サイト設定**: 同梱の `mkdocs.yml.template` を `outDir/mkdocs.yml` にコピーし、`__SITE_NAME__` を主題名（例「SQLiを極める教科書」）に置換する。`nav` は省略しているので `00- 01- .. 99-` のファイル名順に自動でサイドバーが並ぶ。
6. **リポジトリ用README**: `outDir/README.md` に「本文は docs/、`cd outDir && mkdocs serve` で閲覧」を1枚。
7. **コミット**: `outDir/` 全体を `git add`→`commit`→`push`。**sections/ は gitignore しない**（環境揮発でやり直しになるため）。大きい場合は章ごとにコミット。

> 閲覧方法（ユーザーに伝える）: `pip install mkdocs-material` → `cd outDir && mkdocs serve` → `http://127.0.0.1:8000`。サイドバー・章内目次・全文検索・ダーク/ライト・コードコピーが付く。GitHubなら `docs/index.md` からでも読める。

### 5. 検証チェックリスト
- 各章の `未取得の資料` 件数（開放環境なら0に近い。残りは付録Bに反映）
- メタ話題への脱線混入なし: `grep -lE 'computed task|relayed user' outDir/sections/*.md`（ヒット=NG）
- 節数(`grep -c '^## '`)・サイズ・末尾が切れていないか
- `scopeRules` が守られているか
- ロードマップの全URLが本文/付録Aに存在するか

## 注意点（重要）
- **サブエージェントの話題それ防止**ブロックは執筆プロンプトに実装済み（消さない）。
- **モデル配分**は計画フェーズの `hard` 判定で自動。手で変えたい節は該当節だけ後から再生成。
- **出力は相対パス**。必ずリポジトリ/作業ルートで実行する。
- 詳細な背景と経緯は、同梱の `RUNBOOK.md`（あれば）を参照。

（このスキルは課金・認証には関与しない。それらは環境側の設定。）
