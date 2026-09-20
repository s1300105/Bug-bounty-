# クライアントサイド脆弱性ハンティングの基盤技術を極める教科書

クライアントサイド脆弱性を「見つけられる」ようになるための**基盤技術**を、原典に忠実に学ぶ日本語教科書です。バグバウンティ／脆弱性リサーチ／フロントエンド防御実務を志す中〜上級者向け。

個別の穴（XSS/CSRF等）のペイロード知識ではなく、**ブラウザの動作原理とセキュリティモデルの理解・JavaScript深読解・変形済みコード（minify/難読化/bundle）の解析・source→sinkのデータフロー追跡**という4つの土台を、全9章＋序章＋付録で積み上げます。権威ある一次・二次資料（Chrome for Developers、PortSwigger、OWASP、HackTricks、MDN、web.dev、各種研究記事）77本を実際に取得し、原理レベルで再構成しました。

## 読み方

本文は [`docs/`](docs/) にあります。GitHub上なら [`docs/index.md`](docs/index.md) からそのまま読めます。

サイドバー・章内目次・全文検索・ダーク/ライト切替・コードコピー付きで快適に読むには、MkDocs Material でローカル閲覧してください:

```bash
pip install mkdocs-material
cd clientside-textbook
mkdocs serve
# ブラウザで http://127.0.0.1:8000
```

## 構成

- [`docs/index.md`](docs/index.md) — 目次・使い方・段階的な進め方・本書の限界（サイトのホーム）
- [`docs/00-introduction.md`](docs/00-introduction.md) — 序章：本書の狙いと読み方、4本柱のメンタルモデル
- `docs/01-browser-internals.md` 〜 `docs/09-japanese-and-video.md` — 第1〜9章
- [`docs/99-appendix.md`](docs/99-appendix.md) — 付録A（全77URL一覧）／付録B（未取得資料15件）／付録C（用語集）／付録D（参考書籍）
- [`sections/`](sections/) — 章に結合する前の節ごとの原稿（全30節・再生成用の中間成果物）

## 章立て

| 章 | タイトル | 対応Lv |
|---|---|---|
| 1 | ブラウザの動作原理とWebプラットフォームの基礎 | Lv1 |
| 2 | ブラウザのセキュリティモデル（SOP/CORS/CSP/Cookie/Site Isolation） | Lv2 |
| 3 | JavaScriptの深い理解と読解スキル | Lv3 |
| 4 ★ | クライアントサイドコードのリバースエンジニアリング（deobfuscation/source map/JS recon） | Lv4 |
| 5 ★ | ブラウザDevToolsの徹底活用 | Lv5 |
| 6 ★ | プロキシと専用ツールによる動的解析（Burp / DOM Invader） | Lv6 |
| 7 | クライアントサイド攻撃面のマッピングと方法論（source/sink体系・postMessage） | Lv7 |
| 8 | 発展的なクライアントサイド技術領域（Service Worker/WebSocket/拡張/WASM） | Lv8 |
| 9 | 日本語資料と動画で学びを補強する | 横断 |

★ = ロードマップが最重点と位置づける章（自動ツールやAIが最も苦手とし、手作業の実力が最も効く領域）。

## 位置づけと注意

- 教育・防御・**許可された検証**のための教材です。解析やテストは、自分が所有する、または明示的に許可されたシステム（バグバウンティのスコープ内、意図的に脆弱なラボ）に対してのみ行ってください。実在サービス・本番への無許可検証や破壊的手順は扱いません。source map復元やJS reconも「公開されているクライアントサイド資産の解析」に留めてください。
- 本書は**ラボの解答（攻略手順）を提供しません**。手を動かして詰まる経験そのものが、ここで扱う技能の訓練だからです。
- ブラウザ挙動・DevToolsのUI・Burp/DOM Invaderの機能・recon系ツールのメンテ状況はバージョン／時期依存です。使用前に現行バージョンで裏を取ってください。
- 自動取得できなかった資料15件（全77件中）は [`docs/99-appendix.md`](docs/99-appendix.md) の付録Bに理由つきで一覧化しています。
- 土台のロードマップ: リポジトリ `roadmaps/clientside.md`。
