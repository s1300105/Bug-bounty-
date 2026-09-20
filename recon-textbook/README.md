# Reconを極める教科書

バグバウンティ／脆弱性リサーチにおける **Recon（偵察）** を、初級者の「手順の丸暗記」から上級者の「Recon自体が武器になる」水準まで引き上げる日本語教科書です。中〜上級者向け。序章＋全11章＋付録で構成し、権威ある一次・二次資料（The Bug Hunter's Methodology、ProjectDiscovery、Assetnote、NahamSec／TomNomNom、Intigriti／YesWeHack、HackTricks、morioka12 氏ほか）の内容を原理レベルで再構成しています。

## 読み方

本文は [`docs/`](docs/) にあります。GitHub上なら [`docs/index.md`](docs/index.md) からそのまま読めます。

サイドバー・章内目次・全文検索・ダーク/ライト切替・コードコピー付きで快適に読むには、MkDocs Material でローカル閲覧してください:

```bash
pip install mkdocs-material
cd recon-textbook
mkdocs serve
# ブラウザで http://127.0.0.1:8000
```

## 構成

- [`docs/index.md`](docs/index.md) — 目次・使い方・本書の限界（サイトのホーム）
- [`docs/00-introduction.md`](docs/00-introduction.md) — 序章：狙いと読み方、Reconのメンタルモデル
- `docs/01-mindset.md` 〜 `docs/11-methodology-cases.md` — 第1〜11章
- [`docs/99-appendix.md`](docs/99-appendix.md) — 付録A（全URL一覧）／付録B（未取得資料）／付録C（用語集）／付録D（参考書籍）
- [`sections/`](sections/) — 章に結合する前の節ごとの原稿（再生成の中間成果物）

## 章立て

1. Reconのマインドセットと全体像（breadth-first思考・スコープ・ノート運用）
2. 資産発見と組織全体マッピング（★武器化の核・ASN・reverse WHOIS・買収）
3. サブドメイン列挙を深く（passive／active／permutation）
4. インターネット規模のデータソース活用（Shodan/Censys/FOFA・favicon hash）
5. コンテンツ・パラメータ・APIエンドポイント発見（ffuf・Arjun・GraphQL）
6. JavaScript Reconとクライアント資産（収集・AST解析・シークレット抽出）
7. OSINT・GitHub・クラウド資産のRecon（dorking・漏洩シークレット・S3）
8. 歴史データ・アーカイブの活用（Wayback・gau・CDXマイニング）
9. Reconの自動化・パイプライン化・スケーリング（★PD連携・Axiom・Unix哲学）
10. 継続的Reconとモニタリング（★CT監視・差分通知）
11. 発展・方法論・実例（Apple 55件・TBHM・AI活用）

## 位置づけと注意

- 教育・防御・**許可された検証**のための教材です。active列挙・ブルートフォース・クラウド資産へのアクセスは、対象プログラムのルールと法令の範囲内でのみ実施してください。発見資産は帰属（reverse DNS・証明書・WHOIS）を確認してから扱ってください。実在サービス・本番への無許可検証や破壊的手順、特定ラボの攻略手順は扱いません。
- ツールのフラグ・クエリ演算子・データソース仕様は時期依存です。使用前に現行バージョンで裏を取ってください。
- 自動取得できなかった資料は [`docs/99-appendix.md`](docs/99-appendix.md) の付録Bに理由つきで一覧化しています。
- 土台のロードマップ: リポジトリ `roadmaps/recon.md`。
