# XSSを極める教科書

AI・自動スキャナが苦手なXSSを見つけるための日本語教科書です。反射型 `alert(1)` の先にある、DOMデータフロー・mXSS・サニタイザ/CSP回避・プロトタイプ汚染・DOM clobbering・script gadgets・フレームワーク固有sink を、基礎から最先端まで8章で扱います。

## 見る方法

### かんたん（そのまま読む）
- **GitHub**：`docs/index.md` を開くと目次から各章へ飛べます。
- **VS Code**：`docs/` の `.md` を開き `Cmd+Shift+V` でプレビュー。

### 本らしく読む（おすすめ・サイドバー＋全文検索）
[MkDocs Material](https://squidfunk.github.io/mkdocs-material/) で静的サイトとして閲覧できます。

```bash
pip install mkdocs-material
cd xss-textbook
mkdocs serve      # http://127.0.0.1:8000 をブラウザで開く
# 公開用HTMLを書き出すなら:
mkdocs build      # site/ に出力
```

左サイドバーに全章、右に章内目次、上部に全文検索、ダーク/ライト切替、コードのコピーボタンが付きます。

## 構成

| パス | 内容 |
|------|------|
| `docs/` | 教科書本体（`mkdocs.yml` の対象）。`index.md`＝目次、`00`〜`08`＝各章、`99-appendix.md`＝付録 |
| `mkdocs.yml` | サイト表示設定（MkDocs Material） |
| `sections/` | 各節の生成元ファイル（ビルド中間物。章ファイルの材料） |
| `regen/` | 再生成用ワークフロー・スクリプト |
| `REGENERATION.md` | 原典忠実版への再生成手順（開発向け） |

## 作られ方・限界

本書は、URL付き学習ロードマップの各資料を取得・精読して日本語で書き起こしたものです。第1段階（ネットワーク制限環境）では一部資料が取得できず復元しましたが、第2段階でネットワーク開放環境から**全章を原典直接取得で再生成**しました。取得できなかった資料は本文に注記し、`docs/99-appendix.md` の付録Bに一覧化しています。詳細は `docs/index.md` の「本教科書の作られ方と残る限界」を参照してください。
