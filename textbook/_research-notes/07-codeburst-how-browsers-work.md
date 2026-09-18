# [07] Notes on “How Browsers Work”（codeburst.io）— 原典が取得不能のため一次資料で代替したブラウザ内部構造ノート

担当ID: 07 / 想定章: ch01（ブラウザの内部構造とレンダリングパイプライン）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://codeburst.io/how-browsers-work-6350a4234634 | **failed** | WebFetch → curl → Wayback → 各種ミラー、すべて失敗 | WebFetch は `EGRESS_BLOCKED`（"Access to codeburst.io is blocked by the network egress proxy"）。curl は `CONNECT tunnel failed, response 403` / `connect_rejected`。本セッションのエグレスは**許可リスト方式**で、実測で到達できたのは `github.com` / `raw.githubusercontent.com` / `api.github.com` / `gist.github.com` のみ。`medium.com`, `codeburst.io`, `web.dev`, `developer.chrome.com`, `developers.google.com`, `web.archive.org`, `archive.org`, `archive.ph`, `freedium.cfd`, `r.jina.ai`, `dev.to`, `scribe.rip`, `taligarsiel.com`, `html5rocks.com` はすべて 403/000。WebSearch もセッション予算（200/200）を使い切っており代替検索不可。**2026-09-18 に補完担当エージェントが再挑戦したが同一結果**（詳細は下の「再挑戦の記録」節）。代替として MDN / Chrome 公式ドキュメントを新規取得し 20〜23 節を追加した。 |
| https://raw.githubusercontent.com/webplatform/docs/HEAD/concepts/Internet_and_Web/how_browsers_work/index.md | **full** | curl（HTTP 200, 75,125 bytes） | **codeburst 記事が要約している原典そのもの**。Tali Garsiel & Paul Irish, “How browsers work: behind the scenes of modern web browsers”（2011-08-05 初出、HTML5Rocks 由来、WebPlatform Docs へ再掲）。全 56 見出しを取得。 |
| https://raw.githubusercontent.com/vasanthk/how-web-works/HEAD/README.md | **full** | curl（HTTP 200, 41,751 bytes） | 二次資料。原典を逐語引用しつつ、Critical Rendering Path（Conversion→Tokenizing→Lexing→DOM construction）、最新のレンダリングエンジン対応表（Blink/Gecko/WebKit/Trident/EdgeHTML）、「なぜ DOM は遅いのか」、レイアウトスラッシングなど**原典にない加筆**を含む。 |
| GitHub コード検索（`"how-browsers-work-6350a4234634"`、`mcp__github__search_code`） | **full** | GitHub MCP | 記事の**正式タイトルが “Notes on “How Browsers Work””** であることを、独立した 2 リポジトリの引用（`tigercosmos/blog` の `source/_posts/browser/browser_series_33.md`、`zhbhun/frontend-learning` の `tutorials/performance/principle/README.md`）で確認。すなわち当該 codeburst 記事は Garsiel & Irish 原典の読解ノートである。他に `dujuncheng/blogs`（中国語のレンダリング原理解説）と `truongnvgcd201597/SummaryOfMeFEKnowledge`（ブラウザ構成要素の説明）が参考文献として引用。 |

> **重要な前提**: codeburst 記事の本文そのものは 1 文字も取得できていない。以下の「詳細ノート」は、**その記事が要約対象としている原典（Garsiel & Irish）の全文**と、**原典を逐語引用した二次資料**から再構成したものである。codeburst 記事固有の言い回し・独自の図・独自の加筆については本ノートは何も主張しない（捏造回避）。

## 要約（3〜10行）

- codeburst.io の当該記事は独立した研究ではなく、Tali Garsiel & Paul Irish の古典 “How Browsers Work: Behind the scenes of modern web browsers”（HTML5Rocks, 2011）の**読解ノート（Notes on “How Browsers Work”）**である。したがって ch01 の素材としては原典を直接読むのが上位互換。
- 原典の骨格は「ブラウザの高レベル構造（7 コンポーネント）→ レンダリングエンジンのメインフロー → パース理論 → HTML パーサ（トークナイザ＋ツリー構築の 2 段ステートマシン）→ エラー耐性 → CSS パース → スクリプト/スタイルシートの処理順序 → レンダーツリー構築とスタイル計算 → レイアウト（reflow）→ ペイント → 動的変更 → スレッドモデル → CSS2 視覚モデル/ポジショニング/レイヤ（z-index）」。
- 中核となる「メインフロー」は **HTML パース → DOM（content tree）構築／CSS パース → レンダーツリー（WebKit: Render Tree/RenderObject、Gecko: Frame tree/Frame）→ レイアウト（Gecko: Reflow）→ ペイント**。これは**段階的（gradual）**に進み、HTML を全部読み終わるまで待たない。ネットワーク層からの取り込みは通常 **8KB チャンク**。
- 二次資料が加える Critical Rendering Path 側の語彙は **Conversion（バイト→文字）→ Tokenizing（トークン化）→ Lexing（トークン→オブジェクト）→ DOM construction（木構築）**、および CSSOM の「カスケードダウン」構造。
- セキュリティ／脆弱性ハンティング的に最重要なのは **HTML パーサのエラー耐性（“Invalid Syntax” エラーは絶対に出ない。不正な HTML を必ず「修復」して解釈する）**、**`document.write` によりパース入力そのものが書き換わる reentrant なパース**、**スクリプトが同期でパースを止めるモデルと speculative parsing**、**DOM と レンダーツリーが 1:1 でないこと（`display:none` は木に載らないが `visibility:hidden` は載る）**、**スタイル情報取得 API が同期レイアウトを強制すること**。これらはすべて mutation XSS / サニタイザ回避 / DOM clobbering / UI redressing の技術的土台になる。
- ブラウザは単一のレンダリングスレッド（メインスレッドは無限イベントループ）で動き、ネットワークのみ並列。並列接続数はホストあたり概ね 2〜6（原典）／6〜13（二次資料の更新値）。

## なぜ codeburst.io が取得できなかったか（経緯の逐語記録）

WebFetch の返り値:

```
{"error_type":"EGRESS_BLOCKED","domain":"codeburst.io","message":"Access to codeburst.io is blocked by the network egress proxy."}
```

curl の返り値:

```
curl: (56) CONNECT tunnel failed, response 403
HTTP:000 SIZE:0 URL:https://codeburst.io/how-browsers-work-6350a4234634
[agent-proxy] codeburst.io:443 — connect_rejected (the egress proxy denied the CONNECT (organization policy) or could not reach the destination)
```

Wayback も同様に拒否（`Host not in allowlist: archive.org.` / `web.archive.org:443 — connect_rejected`）。WebSearch は `this session has used its web search budget (200 of 200 WebSearch calls)`。したがって**Medium の paywall ではなく、実行環境側のエグレス許可リストによる遮断**が原因である（記事自体が Member-only かどうかは本セッションでは判定できない）。

### 再挑戦の記録（補完担当エージェント / 2026-09-18）

本ノート作成後、別エージェントが取得漏れを埋める目的で再挑戦した。結果は**同一（取得不能）**。

- `WebFetch https://codeburst.io/how-browsers-work-6350a4234634` → 再度 `{"error_type":"EGRESS_BLOCKED","domain":"codeburst.io"}`。
- ホスト到達性の再測定（`curl -o /dev/null -w '%{http_code}'`）:
  - **到達可**: `registry.npmjs.org` (200)、`pypi.org` (200)、`raw.githubusercontent.com` (200)、`codeload.github.com` (400=到達後のパス不正)、`objects.githubusercontent.com` (404=到達後のパス不正)
  - **到達不可（000 / プロキシ拒否）**: `cdn.jsdelivr.net`、`unpkg.com`、`en.wikipedia.org`、`developer.mozilla.org`、`developer.chrome.com`、`web.archive.org`、`archive.org`
- `curl -sS "$HTTPS_PROXY/__agentproxy/status"` の `recentRelayFailures` にも、前工程が試した各種テキスト抽出・アーカイブ系ホスト（`urlscan.io` / `corsproxy.io` / `timetravel.mementoweb.org`（Memento TimeTravel）/ `cachedview.nl` / `archive.org` 等）が **`connect_rejected`（"gateway answered 403 to CONNECT (policy denial or upstream failure)"）** として記録されていた。
- WebSearch は本セッション予算を消費済み（`200 of 200 WebSearch calls`）で追加検索は不可。
- GitHub コード検索の再実施（`"how-browsers-work-6350a4234634"` および `"6350a4234634"`）→ **前回と同じ 5 件のみ**（`dujuncheng/blogs` ×2、`tigercosmos/blog`、`zhbhun/frontend-learning`、`truongnvgcd201597/SummaryOfMeFEKnowledge`）。**Medium エクスポート（スラッグを含む HTML ファイル）を GitHub 上に探す試み**（`"Notes-on-How-Browsers-Work"` 検索）も、当該記事の本文ミラーは発見できなかった。**したがって著者名・公開日・本文は本セッションでは依然として不明のままである。**

**結論**: この URL については「取得できなかった」という事実を確定記録とし、内容は原典（Garsiel & Irish）と、以下に追加した**到達可能な公式一次資料（MDN / Chrome 公式ブログ）**で代替する。教科書執筆時は codeburst 記事を典拠として引用してはならない。

### 補完で新たに取得できた資料（すべて `raw.githubusercontent.com` 経由、HTTP 200）

| 資料 | 取得元（実際に取得した raw URL） | 正式な公開 URL（読者向け） |
|---|---|---|
| MDN “Populating the page: how browsers work” | `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/performance/guides/how_browsers_work/index.md` | https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work |
| MDN “Critical rendering path” | `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/performance/guides/critical_rendering_path/index.md` | https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path |
| Chrome “Inside look at modern web browser” part 1〜4（著者: Mariko Kosaka / @kosamari、2018-09-05〜09-21 公開） | `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part{1,2,3,4}/index.md` | https://developer.chrome.com/blog/inside-browser-part1 （part2/3/4 も同形式） |
| kunigami, “Notes on how browsers work”（2015-10-09） | `https://raw.githubusercontent.com/kunigami/kunigami.github.io/master/blog/_posts/2015-10-09-notes-on-how-browsers-work.md` | https://kunigami.github.io/ 上の同記事 |

> **重要な注意（混同防止）**: 最後の kunigami 記事は **codeburst 記事とはタイトルがほぼ同一だが、同一の文章であるという証拠はない**。当該ファイルには Medium / codeburst への言及・canonical リンクが一切なく、転載関係は**未検証**である。本ノートは両者を別物として扱う。ただし「Garsiel & Irish 原典の読解ノート」という性格とスコープ（レンダリングパイプライン中心）が近いため、**到達可能な代替読み物**として有用である。

---

# 詳細ノート

出典表記の凡例:
- **(原典)** = https://raw.githubusercontent.com/webplatform/docs/HEAD/concepts/Internet_and_Web/how_browsers_work/index.md（Tali Garsiel & Paul Irish, 2011-08-05）
- **(二次)** = https://raw.githubusercontent.com/vasanthk/how-web-works/HEAD/README.md
- **〔補足（一般知識）〕** = どちらの出典にも書かれていない筆者補足

## 0. 原典のメタ情報 （出典: 原典）

- タイトル: “How browsers work: behind the scenes of modern web browsers”
- 著者: **By Tali Garsiel & Paul Irish**
- 初出: **Originally published Aug. 5, 2011**
- 由来: HTML5Rocks 記事の再掲（WebPlatform Docs 側の attribution に `Portions of this content come from HTML5Rocks!` と明記）
- Paul Irish（Chrome Developer Relations）による序文の要旨: イスラエルの開発者 Tali Garsiel が数年かけてブラウザ内部の公開資料を精査し、ブラウザのソースコードを読み込んだ研究成果。Garsiel の言葉として次が引用されている。

> In the years of IE 90% dominance there was nothing much to do but regard the browser as a "black box", but now, with open source browsers having more than half of the usage share, it's a good time to take a peek under the engine's hood and see what's inside a web browser. Well, what's inside are millions of C++ lines...

- 序文の主張: **“learning the internals of browser operations helps you make better decisions and know the justifications behind development best practices”**（内部構造を学ぶことがベストプラクティスの根拠を理解させる）。
- 翻訳: コミュニティによる韓国語訳、HTML5Rocks 公式のドイツ語/スペイン語/**日本語**/ポルトガル語/ロシア語/簡体中国語版が存在する旨が記載。Vimeo に Tali Garsiel 本人の講演あり。
- 対象ブラウザ: 執筆当時の 5 大ブラウザ（Internet Explorer, Firefox, Safari, Chrome, Opera）のうち、オープンソースの **Firefox, Chrome, Safari** を例に説明。2011 年 8 月時点で Firefox+Safari+Chrome の合計シェアは約 60%（StatCounter）。

## 1. ブラウザの主機能 （出典: 原典）

- 主機能は「ユーザが選んだ Web リソースをサーバに要求し、ブラウザウィンドウに表示すること」。リソースは通常 HTML 文書だが、PDF・画像など他の型もあり得る。リソース位置は **URI（Uniform Resource Identifier）** でユーザが指定する。
- HTML/CSS の解釈・表示方法の仕様は **W3C（World Wide Web Consortium）** が管理。長年ブラウザは仕様の一部にしか準拠せず独自拡張を作ったため深刻な互換性問題が生じたが、現在はおおむね準拠している。
- ブラウザ UI の共通要素（原文の箇条書きを再現）:
  - Address bar for inserting the URI（URI を入れるアドレスバー）
  - Back and forward buttons（戻る/進む）
  - Bookmarking options（ブックマーク）
  - A refresh and stop buttons（再読込・停止）
  - Home button（ホーム）
- 特筆点: **ブラウザの UI はどの正式仕様にも定義されていない**。長年の慣行と相互模倣で形成されたもの。HTML5 仕様はブラウザが備えるべき UI 要素を定義せず、address bar / status bar / tool bar といった一般的要素を列挙するのみ。Firefox のダウンロードマネージャのような固有機能もある。

## 2. ブラウザの高レベル構造（7 コンポーネント） （出典: 原典、補強: 二次）

原典の “The browser's main components are:” の 7 項目（逐語訳＋原文の要点）:

| # | コンポーネント | 役割 |
|---|---|---|
| 1 | **The user interface** | アドレスバー、戻る/進むボタン、ブックマークメニュー等。**要求したページが表示されるメインウィンドウを除く**ブラウザ表示の全部分。 |
| 2 | **The browser engine** | UI とレンダリングエンジンの間のアクションを仲介（marshalls）する。 |
| 3 | **The rendering engine** | 要求されたコンテンツの表示を担当。HTML なら HTML と CSS をパースして画面に表示する。 |
| 4 | **Networking** | HTTP リクエストなどのネットワーク呼び出し。プラットフォーム非依存のインタフェースと各プラットフォーム向け実装を持つ。 |
| 5 | **UI backend** | コンボボックスやウィンドウなど基本ウィジェットの描画。プラットフォーム非依存の汎用インタフェースを露出し、内部では OS の UI メソッドを使う。 |
| 6 | **JavaScript interpreter** | JavaScript コードのパースと実行。 |
| 7 | **Data storage** | 永続化層。Cookie などをディスクに保存する必要がある。HTML5 仕様は 'web database'（ブラウザ内の軽量だが完全なデータベース）を定義。 |

- 図: **Figure 1: Browser main components.**（`layers.png`）— 7 コンポーネントを積層図で示す。二次資料も同じ `img/layers.png` を使用。
- 重要な注記（原典）: **“Chrome, unlike most browsers, holds multiple instances of the rendering engine - one for each tab. Each tab is a separate process.”**（Chrome はタブごとに 1 つのレンダリングエンジンインスタンスを持ち、各タブが別プロセス）
- 二次資料の Data storage 項は原典より新しく、**localStorage / IndexedDB / FileSystem** を列挙している。
  - 〔補足（一般知識）〕この 7 分割は現代の Chrome（Browser process / Renderer process / GPU process / Network service / Utility process などのマルチプロセス構成）と厳密には一致しないが、「どの機能がどの信頼境界に属するか」を考える骨格としては今も有効。クライアントサイド脆弱性は主に 3（レンダリングエンジン）・6（JS エンジン）・7（データストレージ）の境界で起きる。

## 3. レンダリングエンジン （出典: 原典、表は二次）

- 責務は「要求されたコンテンツをブラウザ画面に表示すること」。既定で HTML・XML 文書と画像を表示でき、プラグイン/拡張を通じて他の型（例: PDF ビューアプラグインによる PDF 表示）も扱える。原典の本章は「CSS で整形された HTML と画像の表示」という主要ユースケースに集中する。
- 原典の対応関係: Firefox は Mozilla 自作の **Gecko**、Safari と Chrome は **WebKit**。WebKit は Linux 向けエンジンとして始まり Apple が Mac/Windows 対応に改変したオープンソースエンジン。

二次資料のエンジン対応表（原文の表をそのまま再現）:

|Browser           |Engine                       |
|----------------- |:---------------------------:|
|Chrome            | Blink (a fork of WebKit)    |
|Firefox           | Gecko                       |
|Safari            | Webkit                      |
|Opera             | Blink (Presto if < v15)     |
|Internet Explorer | Trident                     |
|Edge              | Blink (EdgeHTML if < v79)   |

## 4. メインフロー（critical rendering path の骨格） （出典: 原典）

- レンダリングエンジンはネットワーク層から文書の内容を取得し始める。**“This will usually be done in 8K chunks.”**（通常 8KB チャンク単位）
- 基本フロー（**Figure 2: Rendering engine basic flow.**）:
  1. HTML 文書のパースを開始し、タグを **DOM ノード**に変換して **“content tree”** と呼ばれる木を作る。
  2. 外部 CSS ファイルと `style` 要素の両方のスタイルデータをパースする。
  3. スタイル情報と HTML 内の視覚的指示を合わせて、もう一つの木 = **render tree** を作る。render tree は**色や寸法などの視覚属性を持つ矩形**を含み、**画面に表示される正しい順序**で並ぶ。
  4. render tree 構築後に **“layout”** 処理を通す。各ノードに画面上の正確な座標を与える。
  5. 次の段が **painting**。render tree を走査し、各ノードを **UI backend レイヤ**を使って描画する。
- **段階的（gradual）であることの強調（原典の逐語趣旨）**: より良い UX のため、レンダリングエンジンは可能な限り早く内容を画面に出そうとする。**HTML が全部パースされるのを待ってから render tree の構築とレイアウトを始めるのではない。** 一部の内容をパースして表示しつつ、ネットワークから届く残りの処理を続ける。
- 図: **Figure 3: Webkit main flow**（`webkitflow.png`）、**Figure 4: Mozilla's Gecko rendering engine main flow(3.6)**。原典は「図 3 と図 4 から分かるように、WebKit と Gecko は用語が少し違うだけでフローは基本的に同じ」と述べる。

用語対応（原典の記述を表に再構成）:

| 概念 | WebKit | Gecko |
|---|---|---|
| 視覚整形された要素の木 | **Render Tree**（要素は **Render Object**） | **Frame tree**（要素は **Frame**） |
| 要素の配置処理 | **layout** | **Reflow** |
| DOM ノード＋視覚情報を結合して render tree を作る処理 | **Attachment** | （対応語なし） |
| HTML と DOM の間の追加レイヤ | なし | **content sink**（DOM 要素を作るファクトリ） |

- 二次資料の要約（原典より簡潔で教科書に使いやすい）: サーバがリソース（HTML, CSS, JS, 画像等）を供給した後、ブラウザは
  - Parsing - HTML, CSS, JS
  - Rendering - **Construct DOM Tree → Render Tree → Layout of Render Tree → Painting the render tree**

### 4.1 Critical Rendering Path としての 4 ステップ （出典: 二次）

二次資料は「最も単純なケース（テキストと画像 1 枚のプレーンな HTML ページ）」に対するブラウザの処理を 4 段で説明する（原文の番号付き見出しを逐語訳）:

1. **Conversion**: ブラウザは HTML の生バイトをディスクまたはネットワークから読み、ファイルに指定されたエンコーディング（例: UTF-8）に基づいて個々の文字に変換する。
2. **Tokenizing**: 文字列を W3C HTML5 標準が規定する個別のトークンに変換する — 例えば “`<html>`”、“`<body>`” など「山括弧」内の文字列。各トークンは特別な意味と規則の集合を持つ。
3. **Lexing**: 発行されたトークンを、プロパティと規則を定義する「オブジェクト」に変換する。
4. **DOM construction**: HTML マークアップはタグ間の関係（あるタグが別のタグに包含される）を定義するので、生成されたオブジェクトは元マークアップの親子関係を捉えた木構造にリンクされる。HTML オブジェクトは body オブジェクトの親、body は paragraph オブジェクトの親、等。

- このプロセス全体の最終出力が、そのページの **DOM（Document Object Model）** であり、ブラウザはページのその後のすべての処理でこれを用いる。
- 図: `img/full-process.png`（DOM Construction Process）、`img/dom-timeline.png`（Chrome DevTools で DOM 構築をトレースした図）。
- 計測に関する記述: Chrome DevTools で timeline を記録すると実際の所要時間が見える。**二次資料の例では HTML バイト列のチャンクを DOM ツリーに変換するのに約 5ms（~5ms）**。ページが大きければ大幅に長くなり、大量の HTML を処理する場合これがボトルネックになり得る。
- 〔補足（一般知識）〕現在の Google 系ドキュメントでは、これに CSS 側の **CSSOM 構築**を並べ、DOM + CSSOM → Render Tree → Layout → Paint を「Critical Rendering Path」と呼ぶ。二次資料の CSS パース節（本ノート 8 章）が CSSOM が木構造である理由を説明している。

## 5. パース理論（general） （出典: 原典）

- **パース**とは文書を「意味のある構造」= コードが理解して使える形へ翻訳すること。結果は通常、文書構造を表すノードの木（**parse tree / syntax tree**）。
- 例: 式 `2 + 3 - 1` のパース木（**Figure 5: mathematical expression tree node**）。
- **Grammars**: パースは文書が従う構文規則（書かれた言語・形式）に基づく。パース可能なあらゆる形式は、語彙（vocabulary）と構文規則（syntax rules）からなる**決定的な文法**を持たねばならない。これを **context free grammar（文脈自由文法）** と呼ぶ。人間の言語はそうではないため従来のパース技術では解析できない。
- **Parser - Lexer combination**: パースは 2 つの下位処理に分けられる。
  - **Lexical analysis（字句解析）**: 入力をトークンに分割する処理。トークンは言語の語彙 = 妥当な構成要素の集合。人間の言語ではその言語の辞書に載る全単語に相当。
  - **Syntax analysis（構文解析）**: 言語の構文規則の適用。
  - 実装は通常 2 コンポーネントに分業する: **lexer**（tokenizer とも。入力を妥当なトークンに分割）と **parser**（構文規則に従って文書構造を解析し parse tree を構築）。**lexer は空白や改行のような無関係な文字を除去する方法を知っている。**
  - 図: **Figure 6: from source document to parse trees**（`image011.png`）
- **パースは反復的**: parser は lexer に新しいトークンを求め、構文規則のいずれかに一致させようとする。規則が一致すればトークンに対応するノードを parse tree に追加し、次のトークンを求める。一致する規則がなければトークンを内部に保存し、内部保存した全トークンに一致する規則が見つかるまでトークンを要求し続ける。**規則が見つからなければ parser は例外を投げる。これは文書が妥当でなく構文エラーを含んでいたことを意味する。**
- **Translation**: parse tree が最終成果物でない場合も多い。パースは変換に使われる。例: コンパイラはソースコードをまず parse tree にパースし、その木を機械語文書へ翻訳する（**Figure 7: compilation flow**）。

### 5.1 パース例と形式定義（逐語） （出典: 原典）

語彙: 整数、プラス記号、マイナス記号。構文:

1. The language syntax building blocks are expressions, terms and operations.
2. Our language can include any number of expressions.
3. An expression is defined as a "term" followed by an "operation" followed by another term
4. An operation is a plus token or a minus token
5. A term is an integer token or an expression

入力 `2 + 3 - 1` の解析: 最初に規則に一致する部分文字列は `2`（規則 #5 より term）。2 番目の一致は `2 + 3`（規則 3: term + operation + term）。次の一致は入力末尾で初めて起きる。`2+3` が term であると既に分かっているので `2 + 3 - 1` は expression。**`2 + +` はどの規則にも一致せず不正な入力。**

#### コード/コマンド（原文のまま逐語）

語彙（正規表現による定義）:

```
INTEGER :0|[1-9][0-9]*
PLUS : +
MINUS: -
```

構文（**BNF: Backus–Naur Form** による定義）:

```
expression :=  term  operation  term
operation :=  PLUS | MINUS
term := INTEGER | expression
```

- 原典の定義: 「文法が **context free grammar** ならその言語は通常の parser でパースできる」。context free grammar の直感的定義は **BNF で完全に表現できる文法**。

### 5.2 パーサの種類と shift-reduce （出典: 原典）

- 2 つの基本型: **top down parser** と **bottom up parser**。
  - top down: 構文の高レベル構造を見て、そのいずれかに一致させようとする。例では最初に `2 + 3` を expression と識別し、次に `2 + 3 - 1` を expression と識別する（最高レベル規則が起点）。
  - bottom up: 入力から始めて低レベル規則から高レベル規則へ段階的に構文規則へ変換していく。規則が一致するまで入力を走査し、一致した入力を規則で置き換える。部分一致した式は parser のスタックに置かれる。

原文のスタック遷移表（逐語再現）:

| Stack | Input |
|---|---|
| （空） | `2 + 3 - 1` |
| term | `+ 3 - 1` |
| term operation | `3 - 1` |
| expression | `- 1` |
| expression operation | `1` |
| expression | （空） |

- この型の bottom up parser を **shift-reduce parser** と呼ぶ。入力が右へシフトされ（ポインタが入力先頭から右へ動くイメージ）、段階的に構文規則へ還元（reduce）されるため。
- **Generating parsers automatically**: 文法（語彙と構文規則）を与えると動く parser を生成するツール = **parser generator**。**WebKit は lexer 生成に Flex、parser 生成に Bison を使う**（Lex / Yacc という名でも遭遇しうる）。**Flex の入力はトークンの正規表現定義を含むファイル、Bison の入力は BNF 形式の言語構文規則。**

## 6. HTML パーサ （出典: 原典）

### 6.1 HTML は文脈自由文法ではない

- HTML の語彙と構文は W3C の仕様で定義される。原典執筆時点の現行版は HTML4、HTML5 は作業中。
- **従来のパーサ理論は HTML には適用できない**（CSS と JavaScript のパースには使う）。HTML は parser が必要とする文脈自由文法で簡単に定義できない。
- HTML を定義する形式手段として **DTD（Document Type Definition）** はあるが、**これは文脈自由文法ではない**。
- HTML は XML に近いのに何が違うのか: **HTML のアプローチは「寛容（forgiving）」**で、暗黙に補われるタグの省略、開始/終了タグの省略などを許す。全体として「ソフトな」構文であり、XML の硬く厳格な構文と対照的。
- この一見小さな違いが決定的: 一方では HTML の人気の主因（ミスを許し著者を楽にする）、他方で形式文法を書くのを困難にする。**まとめ: HTML は文脈自由文法でないため従来の parser でも、XML parser でも簡単にはパースできない。**
- **HTML DTD**: SGML ファミリの言語定義に使われる形式。許可される全要素、その属性、階層の定義を含む。厳格モード（strict mode）は仕様のみに準拠し、他のモードは過去にブラウザで使われたマークアップのサポートを含む（後方互換のため）。当時の strict DTD: `http://www.w3.org/TR/html4/strict.dtd`。

### 6.2 DOM

- 出力木（“parse tree”）は **DOM 要素ノードと属性ノードの木**。DOM = Document Object Model。HTML 文書のオブジェクト表現であり、**JavaScript のような外界に対する HTML 要素のインタフェース**。
- **DOM はマークアップとほぼ 1 対 1 の関係**を持つ。
- DOM も W3C 仕様。汎用の文書操作仕様で、HTML 固有要素は専用モジュールが記述（原典は DOM Level 2 HTML の IDL 定義 URL を挙げる）。
- 「木が DOM ノードを含む」とは、**DOM インタフェースのいずれかを実装する要素で木が構成されている**という意味。ブラウザはブラウザ内部で使う他の属性を持つ具象実装を用いる。
- 二次資料の追記: 木の根は **“Document” object**。

#### コード/コマンド（原文のまま逐語）

例のマークアップ（原典）:

```html
 <html>
   <body>
     <p>
        Hello World
     </p>
     <div> <img src="example.png"/></div>
   </body>
 </html>
```

→ **Figure 8: DOM tree of the example markup**（`image015.png`）の DOM ツリーに変換される。

### 6.3 パースアルゴリズム（2 段ステートマシン）

HTML が通常の top down / bottom up parser でパースできない理由（原文の 3 項目、逐語訳）:

1. 言語の寛容な性質（The forgiving nature of the language）。
2. ブラウザには、よく知られた不正 HTML のケースをサポートするための伝統的なエラー耐性があるという事実。
3. **パース処理が reentrant（再入可能）であること。** 通常はパース中にソースが変わらないが、HTML では **`document.write` を含む script タグが余分なトークンを追加できる**ので、**パース処理が入力自体を変更する**。

- そのため、ブラウザは HTML 用のカスタムパーサを作る。アルゴリズムは HTML5 仕様に詳述され、**tokenization（トークン化）と tree construction（ツリー構築）の 2 段**からなる。
- Tokenization は字句解析。HTML のトークンには **start tags, end tags, attribute names, attribute values** がある。tokenizer はトークンを認識して tree constructor に渡し、次のトークン認識のため次の文字を消費する。入力末尾までこれを繰り返す。
- 図: **Figure 9: HTML parsing flow (taken from HTML5 spec)**。

#### 6.3.1 トークン化アルゴリズム（ステートマシンの実例）

- アルゴリズムの出力は HTML トークン。**アルゴリズムはステートマシンとして表現される。** 各状態は入力ストリームの 1 文字以上を消費し、それらの文字に応じて次状態を更新する。**判断は現在のトークン化状態とツリー構築状態の両方に影響される。つまり同じ文字を消費しても、現在の状態によって正しい次状態は異なる結果になる。**
- 例の入力（原文のまま逐語）:

```
 <html>
   <body>
     Hello world
   </body>
 </html>
```

- 遷移の説明（原文の状態名を逐語で保持）:
  - 初期状態は **"Data state"**。
  - `<` 文字に遭遇すると状態が **"Tag open state"** に変わる。
  - `a-z` の文字を消費すると "Start tag token" が生成され、状態が **"Tag name state"** に変わる。`>` 文字を消費するまでこの状態に留まる。各文字は新しいトークン名に追加される。この例で生成されるトークンは `html` トークン。
  - `>` に達すると現在のトークンが発行（emit）され、状態は **"Data state"** に戻る。
  - `<body>` タグも同じ手順で処理される。ここまでで `html` と `body` タグが発行された。再び **"Data state"**。
  - `Hello world` の `H` を消費すると文字トークンが生成・発行され、`</body>` の `<` に達するまで続く。**`Hello world` の各文字ごとに 1 つの文字トークンを発行する。**
  - 再び **"Tag open state"**。次の入力 `/` を消費すると `end tag token` が生成され **"Tag name state"** へ移動。`>` に達するまでこの状態に留まる。新しいタグトークンが発行され **"Data state"** に戻る。
  - `</html>` の入力も前と同様に扱われる。
- 図: **Figure 10: Tokenizing the example input**（`image019.png`）。

#### 6.3.2 ツリー構築アルゴリズム

- **parser が生成されるとき Document オブジェクトが作られる。** ツリー構築段では Document を根とする DOM ツリーが変更され、要素が追加される。tokenizer が発行した各ノードは tree constructor が処理する。**各トークンについて、どの DOM 要素が該当しどれを生成すべきかを仕様が定義している。**
- 要素は DOM ツリーに追加されるだけでなく、**open elements のスタック**にも追加される。**このスタックは入れ子の不整合や未閉鎖タグの修正に使われる。**
- このアルゴリズムもステートマシンとして記述され、**状態は “insertion modes”（挿入モード）と呼ばれる**。
- 例入力（原文のまま逐語）:

```
<html>
  <body>
     Hello world
  </body>
</html>
```

- 挿入モードの遷移（原文の状態名を逐語で保持）:
  - 最初のモードは **"initial mode"**。
  - html トークンを受け取ると **"before html"** モードへ移動し、そのモードでトークンを再処理する。これにより **HTMLHtmlElement** が生成され、ルートの Document オブジェクトに追加される。
  - 状態は **"before head"** に変わる。ここで "body" トークンを受け取る。**"head" トークンがないにもかかわらず HTMLHeadElement が暗黙に生成され、木に追加される。**
  - **"in head"** モード、次に **"after head"** モードへ移動。body トークンが再処理され、**HTMLBodyElement** が生成・挿入され、モードは **"in body"** へ。
  - "Hello world" の文字トークンを受け取る。最初の 1 つで **"Text" ノード**が生成・挿入され、残りの文字はそのノードに追加される。
  - body 終了トークンの受信で **"after body"** モードへ。html 終了タグの受信で **"after after body"** モードへ。**end of file トークンの受信でパースが終了する。**
- 図: **Figure 11: tree construction of example html**。
- **パース完了時の動作（Actions when the parsing is finished）**: この段階でブラウザは文書を **interactive** とマークし、**"deferred" モードのスクリプト**（文書パース後に実行されるべきもの）のパースを開始する。その後 **文書状態が "complete" に設定され、"load" イベントが発火する。**

### 6.4 ブラウザのエラー耐性（Browsers' error tolerance）— セキュリティ上の最重要節

- 原典の断言: **“You never get an "Invalid Syntax" error on an HTML page. Browsers fix any invalid content and go on.”**（HTML ページで「構文エラー」が出ることはない。ブラウザは不正な内容を必ず修復して先へ進む）
- 原典が挙げる不正 HTML の例（逐語）:

```html
 <html>
   <mytag>
   </mytag>
   <div>
   <p>
   </div>
     Really lousy HTML
   </p>
 </html>
```

  「約 100 万個の規則に違反した（"mytag" は標準タグでない、"p" と "div" の入れ子が誤っている、他）にもかかわらず、ブラウザは正しく表示し文句を言わない。**パーサコードの多くは HTML 著者のミスを修復している。**」
- **エラー処理はブラウザ間でかなり一貫しているが、驚くべきことに現行 HTML 仕様の一部ではない。** ブックマークや戻る/進むボタンと同様、長年ブラウザの中で発達したもの。多くのサイトで繰り返される既知の不正 HTML 構文があり、ブラウザは他ブラウザと整合する形でこれを修復しようとする。HTML5 仕様はこれらの要件の一部を定義している。
- WebKit の HTML パーサクラス冒頭コメント（原典が引用、逐語）:

> The parser parses tokenized input into the document, building up the document tree. If the document is well-formed, parsing it is straightforward.
>
> Unfortunately, we have to handle many HTML documents that are not well-formed, so the parser has to be tolerant about errors.
>
> We have to take care of at least the following error conditions:
>
> 1. The element being added is explicitly forbidden inside some outer tag. In this case we should close all tags up to the one, which forbids the element, and add it afterwards.
> 2. We are not allowed to add the element directly. It could be that the person writing the document forgot some tag in between (or that the tag in between is optional). This could be the case with the following tags: HTML HEAD BODY TBODY TR TD LI (did I forget any?).
> 3. We want to add a block element inside to an inline element. Close all inline elements up to the next higher block element.
> 4. If this doesn't help, close elements until we are allowed to add the element or ignore the tag.

#### コード/コマンド（原文のまま逐語）— WebKit のエラー耐性 4 例

**(1) `</br>` instead of `<br>`** — 一部サイトが `<br>` の代わりに `</br>` を使う。IE と Firefox と互換にするため WebKit はこれを `<br>` として扱う。

```
if (t->isCloseTag(brTag) && m_document->inCompatMode()) {
     reportError(MalformedBRError);
     t->beginTag = true;
}

Note - the error handling is internal - it won't be presented to the user.
```

**(2) A stray table** — テーブルのセル内ではなく別のテーブルのコンテンツ内にあるテーブル:

```html
 <table>
     <table>
         <tr><td>inner table</td></tr>
     </table>
     <tr><td>outer table</td></tr>
 </table>
```

WebKit は階層を 2 つの兄弟テーブルに変える:

```html
 <table>
     <tr><td>outer table</td></tr>
 </table>
 <table>
     <tr><td>inner table</td></tr>
 </table>
```

コード:

```
if (m_inStrayTableContent && localName == tableTag)
        popBlock(tableTag);
```

WebKit は現在の要素内容にスタックを使う。内側のテーブルを外側のテーブルのスタックから pop する。結果としてテーブルは兄弟になる。

**(3) Nested form elements** — form の中に form を入れた場合、**2 番目の form は無視される**:

```
if (!m_currentFormElement) {
        m_currentFormElement = new HTMLFormElement(formTag,    m_document);
}
```

**(4) A too deep tag hierarchy** — WebKit のコメント（逐語）:

> www.liceo.edu.mx is an example of a site that achieves a level of nesting of about 1500 tags, all from a bunch of `<b>`s. We will only allow at most 20 nested tags of the same type before just ignoring them all together.

```
bool HTMLParser::allowNestedRedundantTag(const AtomicString& tagName)
{

unsigned i = 0;
for (HTMLStackElem* curr = m_blockStack;
         i < cMaxRedundantTagDepth && curr && curr->tagName == tagName;
     curr = curr->next, i++) { }
return i != cMaxRedundantTagDepth;
}
```

**(5) Misplaced html or body end tags** — WebKit のコメント（逐語）:

> Support for really broken html. We never close the body tag, since some stupid web pages close it before the actual end of the doc. Let's rely on the end() call to close things.

```
if (t->tagName == htmlTag || t->tagName == bodyTag )
        return;
```

原典の締め: 「Web 著者は注意せよ — WebKit のエラー耐性コードのスニペット例に登場したくなければ、well-formed な HTML を書くこと。」

- 〔補足（一般知識）〕この節の内容は、クライアントサイド脆弱性ハンティングにおける **mutation XSS（mXSS）** と **サニタイザ回避** の直接的な理論的基礎である。サニタイザ（サーバ側のライブラリや DOMPurify 等）が想定する構文木と、ブラウザのエラー修復後に実際に構築される DOM が食い違うと、サニタイズ済みの「安全な」文字列が再シリアライズ・再パースの過程で実行可能なマークアップに変異する。上の「stray table を兄弟に移動する」「form の入れ子は無視する」「同種タグ 20 段超は捨てる」「`</br>` を `<br>` として扱う」はいずれも「パーサが入力を書き換える」実例であり、同じ性質を突く手法である。また項目 3 の `document.write` による reentrant なパースは、スクリプト注入がパース対象そのものを変える点で防御側の静的解析を無効化しうる。

## 7. CSS パース （出典: 原典）

- **HTML と違い CSS は文脈自由文法**であり、序論で述べた種類の parser でパースできる。実際 CSS 仕様は CSS の字句文法と構文文法を定義している（`http://www.w3.org/TR/CSS2/grammar.html`）。

#### コード/コマンド（原文のまま逐語）— CSS 字句文法（語彙）

```
comment   \/\*[^*]*\*+([^/*][^*]*\*+)*\/
num   [0-9]+|[0-9]*"."[0-9]+
nonascii  [\200-\377]
nmstart   [_a-z]|{nonascii}|{escape}
nmchar    [_a-z0-9-]|{nonascii}|{escape}
name    {nmchar}+
ident   {nmstart}{nmchar}*
```

原典の説明: **"ident" は identifier の略でクラス名のようなもの。"name" は（"#" で参照される）要素の id。**

#### コード/コマンド（原文のまま逐語）— CSS 構文文法（BNF）

```
ruleset
  : selector [ ',' S* selector ]*
    '{' S* declaration [ ';' S* declaration ]* '}' S*
  ;
selector
  : simple_selector [ combinator selector | S+ [ combinator? selector ]? ]?
  ;
simple_selector
  : element_name [ HASH | class | attrib | pseudo ]*
  | [ HASH | class | attrib | pseudo ]+
  ;
class
  : '.' IDENT
  ;
element_name
  : IDENT | '*'
  ;
attrib
  : '[' S* IDENT S* [ [ '=' | INCLUDES | DASHMATCH ] S*
    [ IDENT | STRING ] S* ] ']'
  ;
pseudo
  : ':' [ IDENT | FUNCTION S* [IDENT S*] ')' ]
  ;
```

ruleset の具体例（逐語）:

```
div.error , a.error {
  color:red;
  font-weight:bold;
}
```

説明: `div.error` と `a.error` がセレクタ。波括弧内がこの ruleset で適用される規則。BNF の意味は「ruleset はセレクタ 1 つ、または任意個のセレクタをカンマと空白（S は white space）で区切ったもの。ruleset は波括弧を含み、その中に宣言 1 つ、または任意個の宣言をセミコロンで区切ったものを含む」。

- **Webkit CSS parser**: WebKit は **Flex と Bison** の parser generator を使い CSS 文法ファイルから parser を自動生成する。**Bison は bottom up の shift-reduce parser を作る。Firefox は手書きの top down parser を使う。** いずれの場合も各 CSS ファイルは **StyleSheet オブジェクト**にパースされ、各オブジェクトは CSS ルールを含む。CSS ルールオブジェクトはセレクタオブジェクトと宣言オブジェクト、および CSS 文法に対応する他のオブジェクトを含む。図: **Figure 12: parsing CSS**。
- 二次資料の追記（重要）: **“CSS Selectors are matched by browser engines from right to left.”**（ブラウザエンジンはセレクタを**右から左**にマッチする）。ブラウザがセレクタマッチングを行うときは、スタイルを決めたい 1 要素と、すべての規則・セレクタを持っており、どの規則がその要素に一致するかを探す必要がある。これは jQuery のように「1 つのセレクタに一致する全要素を探す」のとは逆である。
- 二次資料の CSSOM が木構造である理由: ページ上のあるオブジェクトの最終スタイル集合を計算するとき、ブラウザはそのノードに適用可能な**最も一般的な規則**から始め（例: body 要素の子なら body のスタイルがすべて適用される）、より具体的な規則を再帰的に適用して計算済みスタイルを洗練していく — すなわち規則は「カスケードダウン」する。

## 8. スクリプトとスタイルシートの処理順序 （出典: 原典）

- **Scripts**: **Web のモデルは同期的**である。著者は parser が `<script>` タグに到達した時点でスクリプトが即座にパース・実行されることを期待する。**スクリプトが実行されるまで文書のパースは停止する。** スクリプトが外部なら、まずネットワークからリソースを取得しなければならず、**これも同期的**でリソース取得までパースが停止する。これが長年のモデルで HTML4/HTML5 仕様にも規定されている。著者はスクリプトを **"defer"** とマークでき、その場合は文書のパースを止めず、パース後に実行される。**HTML5 はスクリプトを asynchronous とマークするオプションを追加**し、別スレッドでパース・実行される。
- **Speculative parsing（投機的パース）**: **WebKit と Firefox の両方がこの最適化を行う。** スクリプトを実行している間、**別スレッドが文書の残りをパースし、ネットワークから読み込む必要のある他のリソースを見つけて読み込む。** これによりリソースを並列接続で読み込め、全体の速度が向上する。**注意: 投機的パーサは DOM ツリーを変更しない。それはメインパーサに任せ、外部スクリプト・スタイルシート・画像のような外部リソースへの参照のみをパースする。**
- **Style sheets**: スタイルシートは別のモデル。概念的には DOM ツリーを変えないので待つ理由はなく文書のパースを止める必要はない。**しかし文書パース段でスクリプトがスタイル情報を問い合わせる問題がある。** スタイルが未読込・未パースならスクリプトは誤った答えを得る。これが多くの問題を起こした。エッジケースに見えてかなり一般的。**Firefox は、読み込み・パース中のスタイルシートがある場合すべてのスクリプトをブロックする。WebKit は、未読込のスタイルシートに影響される可能性がある特定のスタイルプロパティにアクセスしようとしたときだけスクリプトをブロックする。**
  - 〔補足（一般知識）〕この「スクリプトは同期でパースを止める」「スタイルシートがスクリプトをブロックする」という挙動は、脆弱性の側面では**タイミング依存の攻撃面**を作る。スタイルシートの読み込み待ちでスクリプト実行が遅延する隙に DOM の状態が変わる、あるいは `document.write` を含む注入がパースキューに割り込む、といった順序依存の挙動が実際の DOM XSS の成立条件になることがある。

## 9. レンダーツリー構築 （出典: 原典）

- DOM ツリーが構築される間、ブラウザは**もう一つの木 = render tree** を構築する。これは**表示される順序に並んだ視覚要素の木**で、文書の視覚的表現。**この木の目的は、内容を正しい順序で描画（paint）できるようにすること。**
- 用語: **Firefox は render tree の要素を "frames" と呼ぶ。WebKit は renderer / render object と呼ぶ。** renderer は自身と子をレイアウト・描画する方法を知っている。

#### コード/コマンド（原文のまま逐語）— WebKit の RenderObject 基底クラス

```
class RenderObject{
  virtual void layout();
  virtual void paint(PaintInfo);
  virtual void rect repaintRect();
  Node* node;  //the DOM node
  RenderStyle* style;  // the computed style
  RenderLayer* containgLayer; //the containing z-index layer
}
```

- 各 renderer は通常ノードの CSS ボックスに対応する矩形領域を表す（CSS2 仕様の記述に従う）。幅・高さ・位置といった幾何情報を含む。**ボックス型はそのノードに適用される "display" スタイル属性に影響される。**

#### コード/コマンド（原文のまま逐語）— display 属性による renderer 生成の分岐

```
RenderObject* RenderObject::createObject(Node* node, RenderStyle* style)
{
    Document* doc = node->document();
    RenderArena* arena = doc->renderArena();
    ...
    RenderObject* o = 0;

    switch (style->display()) {
        case NONE:
            break;
        case INLINE:
            o = new (arena) RenderInline(node);
            break;
        case BLOCK:
            o = new (arena) RenderBlock(node);
            break;
        case INLINE_BLOCK:
            o = new (arena) RenderBlock(node);
            break;
        case LIST_ITEM:
            o = new (arena) RenderListItem(node);
            break;
       ...
    }

    return o;
}
```

- 要素型も考慮される。例えばフォームコントロールやテーブルは特別なフレームを持つ。WebKit では要素が特別な renderer を作りたい場合 **`createRenderer` メソッドをオーバーライド**する。renderer は非幾何情報を含む style オブジェクトを指す。

### 9.1 render tree と DOM tree の関係（1:1 ではない）

原典の記述（重要点を漏らさず列挙）:

- renderer は DOM 要素に対応するが、**関係は 1 対 1 ではない。**
- **非視覚的な DOM 要素は render tree に挿入されない。** 例: `head` 要素。
- **`display` 属性が "none" に設定された要素も木に現れない。**（一方、**`visibility` 属性が "hidden" の要素は木に現れる**）
- **複数の視覚オブジェクトに対応する DOM 要素**がある。通常、単一の矩形で記述できない複雑構造の要素。例: **`select` 要素は 3 つの renderer を持つ — 表示領域用、ドロップダウンリストボックス用、ボタン用。** また幅が 1 行に足りずテキストが複数行に分割される場合、新しい行は追加の renderer として加えられる。
- 複数 renderer の別の例は**壊れた HTML**。CSS 仕様によれば inline 要素はブロック要素のみ、または inline 要素のみを含まなければならない。**混在コンテンツの場合、inline 要素を包む anonymous block renderer が生成される。**
- **一部の render object は DOM ノードに対応するが木の中の同じ場所にはない。** float と absolute 配置要素は **out of flow** で、木の別の場所に置かれ実フレームにマップされる。**本来あるべき場所には placeholder frame が置かれる。**
- 図: **Figure 13: The render tree and the corresponding DOM tree (3.1).**（`image025.png`）
- **"Viewport" は initial containing block**。WebKit では **"RenderView" オブジェクト**になる。
  - 〔補足（一般知識）〕`display:none` は render tree に載らず `visibility:hidden` は載る、という差は、クリックジャッキング/UI redressing や「見えない要素の座標・寸法が取得できるか」を考えるうえで決定的。また `select` が 3 renderer を持つ、混在コンテンツで anonymous block が作られる、といった「DOM と視覚構造のズレ」は、DOM ベースのサニタイズやセレクタベースの防御が視覚的な実体と一致しないことの根拠になる。

### 9.2 木構築のフロー

- **Firefox** では presentation が DOM 更新のリスナとして登録される。presentation はフレーム生成を **`FrameConstructor`** に委譲し、constructor がスタイルを解決してフレームを作る。
- **WebKit** ではスタイル解決と renderer 生成のプロセスを **"attachment"** と呼ぶ。**すべての DOM ノードは "attach" メソッドを持つ。attachment は同期的で、DOM ツリーへのノード挿入が新ノードの "attach" メソッドを呼ぶ。**
- html と body タグの処理により render tree の根が構築される。ルート render object は CSS 仕様が **containing block** と呼ぶもの（他の全ブロックを含む最上位ブロック）に対応する。その寸法は **viewport = ブラウザウィンドウの表示領域の寸法**。**Firefox は `ViewPortFrame`、WebKit は `RenderView` と呼ぶ。** これが document が指す render object。木の残りは DOM ノード挿入として構築される。

## 10. スタイル計算（Style Computation） （出典: 原典）

- render tree 構築には各 render object の視覚プロパティ計算が必要で、それは各要素のスタイルプロパティ計算によって行われる。
- スタイルは**様々な由来のスタイルシート**、**インライン style 要素**、**HTML の視覚属性（"bgcolor" 等）**を含む。後者は対応する CSS スタイルプロパティに翻訳される。
- スタイルシートの由来（origins）: **ブラウザの既定スタイルシート**、**ページ著者が提供するスタイルシート**、**ユーザスタイルシート**（ブラウザ利用者が提供。Firefox では "Firefox Profile" フォルダにスタイルシートを置く）。

### 10.1 スタイル計算の 3 つの困難（原文の番号を保持）

1. **スタイルデータは非常に大きな構造**で、膨大なスタイルプロパティを保持するため**メモリ問題**を引き起こしうる。
2. **各要素に一致する規則を見つける処理は、最適化しなければ性能問題**になる。要素ごとに規則リスト全体を走査して一致を探すのは重い作業。セレクタは複雑な構造を持ち得るため、一見有望に見えて無駄だと判明する経路からマッチングを始め、別の経路を試す必要が生じる。原文の例:

```
     div div div div{
       ...
     }
```

   これは「3 つの div の子孫である `<div>`」に規則が適用されることを意味する。ある `<div>` 要素に規則が適用されるか確認するために木を上へたどる経路を選ぶが、div が 2 つしかなく規則が適用されないと分かるために上へたどる必要があるかもしれない。その後、木の別の経路を試す必要がある。
3. **規則の適用には、規則の階層を定義するかなり複雑なカスケード規則が絡む。**

### 10.2 スタイルデータの共有（WebKit）— 10 条件（逐語訳）

WebKit のノードは style オブジェクト（**RenderStyle**）を参照する。これらは一定条件下でノード間で共有できる。ノードが兄弟または従兄弟（cousins）であって、かつ:

1. 要素は同じマウス状態でなければならない（一方が :hover で他方がそうでない、はだめ）
2. どちらの要素も id を持っていてはならない
3. タグ名が一致しなければならない
4. class 属性が一致しなければならない
5. マップされた属性の集合が同一でなければならない
6. リンク状態が一致しなければならない
7. フォーカス状態が一致しなければならない
8. どちらの要素も属性セレクタの影響を受けてはならない（「影響を受ける」とは、セレクタ内のどの位置であれ属性セレクタを使うセレクタマッチを持つことと定義）
9. 要素にインライン style 属性があってはならない
10. 兄弟セレクタが一切使われていてはならない。**WebCore は兄弟セレクタに遭遇するとグローバルスイッチを投げ、それが存在する場合は文書全体でスタイル共有を無効化する。** これは `+` セレクタおよび `:first-child` / `:last-child` のようなセレクタを含む。

### 10.3 Firefox の rule tree / style context tree

- Firefox はスタイル計算を容易にする**2 つの追加の木 — rule tree と style context tree** を持つ。WebKit も style オブジェクトは持つが、style context tree のような木には格納せず、DOM ノードが関連 style を指すだけ。図: **Figure 14: Firefox style context tree (2.2)**。
- **style contexts は最終値（end values）を含む。** 値は一致するすべての規則を正しい順序で適用し、論理値から具体値へ変換する操作を行って計算される。例: 論理値が画面のパーセンテージなら計算して絶対単位に変換する。**rule tree の考え方は非常に巧妙で、これらの値をノード間で共有して再計算を避けられる。空間も節約する。**
- 一致したすべての規則が木に格納される。**経路の下位ノードほど優先度が高い。** 木は見つかった規則マッチの全経路を含む。**格納は遅延（lazily）して行われる**。最初に全ノード分を計算するのではなく、あるノードのスタイルを計算する必要が生じたときに計算済み経路が木に追加される。
- 「木の経路を辞書の単語と見る」という発想。例: rule tree に既に経路 **A - B - E - I - L** が計算済みで、別の要素の一致規則（正しい順序で）が **B - E - I** と判明した場合、その経路は既に存在するので作業が減る。
- **Division into structs（構造体への分割）**: style contexts は struct に分割される。struct は border や color といった特定カテゴリのスタイル情報を含む。**struct 内の全プロパティは inherited か non inherited のどちらか。** inherited プロパティは、要素が定義しない限り親から継承されるもの。non inherited（**"reset" プロパティ**と呼ばれる）は未定義なら既定値を使う。**木は（計算済み最終値を含む）struct 全体を木にキャッシュすることで役立つ。下位ノードが struct の定義を提供していなければ、上位ノードのキャッシュ済み struct を使える。**
- **rule tree を使った style context の計算手順**:
  - まず rule tree 内の経路を計算するか既存のものを使う。
  - 経路の規則を適用して新しい style context の struct を埋め始める。
  - **経路の最下位ノード（最高優先度、通常は最も具体的なセレクタ）から開始**し、struct が埋まるまで木を上へたどる。
  - その rule ノードに struct の指定がなければ大きく最適化できる: **struct を完全に指定するノードが見つかるまで木を上へ行き、単にそれを指す — これが最良の最適化で struct 全体が共有される。** 最終値の計算とメモリを節約する。部分的な定義が見つかれば、struct が埋まるまで木を上へ続ける。
  - struct の定義が全く見つからず、その struct が "inherited" 型なら、**context tree** 内の親の struct を指す（この場合も struct 共有に成功）。reset struct なら既定値を使う。
  - 最も具体的なノードが値を追加する場合は実際の値へ変換する追加計算が必要。結果を木のノードにキャッシュして子が使えるようにする。
  - **要素に同じ木ノードを指す兄弟がいる場合、style context 全体を共有できる。**

#### コード/コマンド（原文のまま逐語）— rule tree の例

HTML:

```html
 <html>
   <body>
     <div class="err" id="div1">
       <p>
         this is a <span class="big"> big error </span>
         this is also a
         <span class="big"> very  big  error</span> error
       </p>
     </div>
     <div class="err" id="div2">another error</div>
   </body>
 </html>
```

CSS:

```css
div {margin:5px;color:black}
.err {color:red}
.big {margin-top:3px}
div span {margin-bottom:4px}
#div1 {color:blue}
#div2 {color:green}
```

- 簡略化のため color struct（メンバ 1 つ = color）と margin struct（4 辺）の 2 つだけを埋めるとする。結果の rule tree が **Figure 15: The rule tree**、context tree が **Figure 16: The context tree**（ノードは「ノード名: 指す規則番号」で示される）。
- 手順の説明: HTML をパースして 2 番目の `<div>` タグに到達したとする。このノード用の style context を作り style struct を埋める必要がある。規則をマッチさせると `<div>` に一致する規則は **1, 2, 6** と判明する。これは木に既に要素が使える経路が存在し、規則 6 のためのノード（rule tree のノード **F**）を 1 つ追加すればよいことを意味する。style context を作り context tree に置く。新しい style context は rule tree のノード F を指す。
  - margin struct を埋める: 最後の rule ノード（F）は margin struct に何も追加しないので、以前のノード挿入で計算済みのキャッシュ struct が見つかるまで木を上へ行き、それを使う。**margin 規則を指定した最上位ノードである ノード B で見つかる。**
  - color struct は定義があるのでキャッシュ struct を使えない。color は属性が 1 つなので他の属性を埋めるために木を上へ行く必要はない。最終値を計算（文字列を RGB に変換等）してこのノードに計算済み struct をキャッシュする。
  - 2 番目の `<span>` 要素の処理はさらに簡単。規則をマッチさせると前の span と同様に規則 **G** を指すと結論できる。**同じノードを指す兄弟があるので style context 全体を共有し、前の span の context を指すだけでよい。**
- 親から継承される規則を含む struct については、**キャッシュは context tree 上で行われる**（color プロパティは実際には継承されるが、**Firefox は reset として扱い rule tree にキャッシュする**）。例として段落にフォント規則を追加した場合:

```css
p {font-family:Verdana;font size:10px;font-weight:bold}
```

  段落要素は context tree で div の子なので、段落にフォント規則が指定されていなければ親と同じ font struct を共有できる。
- **WebKit（rule tree を持たない）は、一致した宣言を 4 回走査する**: 最初に **non important high priority プロパティ**（他が依存するため先に適用すべきもの — 例えば `display`）、次に **high priority important**、次に **normal priority non important**、次に **normal priority important** 規則を適用する。これにより複数回現れるプロパティが正しいカスケード順で解決される。**最後が勝つ（The last wins）。**
- まとめ（原典）: style オブジェクト（全体または内部の一部 struct）の共有が問題 1 と 3 を解決する。Firefox の rule tree はプロパティを正しい順序で適用するのにも役立つ。

### 10.4 マッチを容易にするための規則の加工（ハッシュマップ化）

スタイル規則のソースは 3 つ（原文の逐語コード付き）:

- CSS 規則（外部スタイルシートまたは style 要素内）

```
p {color:blue}
```

- インライン style 属性

```
<p style="color:blue" />
```

- HTML 視覚属性（対応するスタイル規則にマップされる）

```
<p bgcolor="blue" />
```

- 後ろの 2 つは要素が style 属性を所有し、HTML 属性は要素をキーにマップできるので容易にマッチする。
- CSS 規則マッチは厄介（問題 #2）なので、規則はアクセスしやすいよう加工される。**スタイルシートをパースした後、規則はセレクタに応じて複数のハッシュマップのいずれかに追加される。id 別、クラス名別、タグ名別のマップと、それらに当てはまらないもの用の汎用マップがある。** セレクタが id なら id マップへ、クラスならクラスマップへ、等。
- **この加工により規則マッチがはるかに容易になる。全宣言を見る必要はなく、マップから要素に関連する規則を抽出できる。この最適化は規則の 95% 以上を除去し、マッチング処理で考慮すらされなくなる。**
- 例（逐語）:

```
p.error {color:red}
#messageDiv {height:50px}
div {margin:5px}
```

  1 番目の規則はクラスマップに、2 番目は id マップに、3 番目はタグマップに挿入される。次の HTML 断片に対して:

```html
 <p class="error">an error occurred </p>
 <div id=" messageDiv">this is a message</div>
```

  まず p 要素の規則を探す。クラスマップに "error" キーがあり、その下に "p.error" の規則が見つかる。div 要素は id マップ（キーは id）とタグマップに関連規則を持つ。残る作業は、キーで抽出された規則のうちどれが実際に一致するかを見つけることだけ。例えば div の規則が

```
table div {margin:5px}
```

  であれば、**キーは最右のセレクタ**なのでタグマップから抽出されるが、table の祖先を持たない当該 div には一致しない。
- **WebKit と Firefox の両方がこの加工を行う。**

### 10.5 カスケード順と Specificity

- style オブジェクトはすべての視覚属性に対応するプロパティを持つ（全 CSS 属性＋より汎用的なもの）。一致したどの規則でもプロパティが定義されない場合、一部のプロパティは親要素の style オブジェクトから継承され、他は既定値を持つ。
- **Style sheet cascade order**（CSS2 仕様、低→高。原文の番号を保持）:

| 優先度 | 宣言の種類 |
|---|---|
| 1（最低） | Browser declarations |
| 2 | User normal declarations |
| 3 | Author normal declarations |
| 4 | Author important declarations |
| 5（最高） | User important declarations |

  ブラウザ宣言が最も弱く、**ユーザは important とマークした場合にのみ著者を上書きできる。** 同じ順位の宣言は **specificity** でソートされ、次に指定された順序でソートされる。**HTML 視覚属性は対応する CSS 宣言に翻訳され、低優先度の author 規則として扱われる。**
- **Specificity**（CSS2 仕様の定義、逐語訳）:
  - 宣言がセレクタを持つ規則ではなく 'style' 属性由来なら 1、そうでなければ 0 を数える（= a）
  - セレクタ内の ID 属性の数を数える（= b）
  - セレクタ内のその他の属性と擬似クラスの数を数える（= c）
  - セレクタ内の要素名と擬似要素の数を数える（= d）
  - 4 つの数 **a-b-c-d** を（大きな基数の数体系で）連結すると specificity になる。使う基数はいずれかのカテゴリの最大カウントで決まる。例えば a=14 なら 16 進基数を使える。a=17 のような稀なケースでは 17 桁基数が必要（`html body div div p ...` のように 17 タグのセレクタで起こり得るが、まずない）。

#### コード/コマンド（原文のまま逐語）— specificity 例（CSS2 の 4 値形式・原典）

```
 *             {}  /* a=0 b=0 c=0 d=0 -> specificity = 0,0,0,0 */
 li            {}  /* a=0 b=0 c=0 d=1 -> specificity = 0,0,0,1 */
 li:first-line {}  /* a=0 b=0 c=0 d=2 -> specificity = 0,0,0,2 */
 ul li         {}  /* a=0 b=0 c=0 d=2 -> specificity = 0,0,0,2 */
 ul ol+li      {}  /* a=0 b=0 c=0 d=3 -> specificity = 0,0,0,3 */
 h1 + *[rel=up]{}  /* a=0 b=0 c=1 d=1 -> specificity = 0,0,1,1 */
 ul ol li.red  {}  /* a=0 b=0 c=1 d=3 -> specificity = 0,0,1,3 */
 li.red.level  {}  /* a=0 b=0 c=2 d=1 -> specificity = 0,0,2,1 */
 #x34y         {}  /* a=0 b=1 c=0 d=0 -> specificity = 0,1,0,0 */
 style=""          /* a=1 b=0 c=0 d=0 -> specificity = 1,0,0,0 */
```

#### コード/コマンド（原文のまま逐語）— specificity 例（二次資料の 3 値換算形式）

二次資料は同じ規則を「a-b-c-d を連結した数値」として示す。**（注: 二次資料はコメント中で b/c のラベル付けが原典と 1 つずれているが、数値結果は原典と整合する。逐語のまま記録する。）**

```txt
*               /* a=0 b=0 c=0 -> specificity =   0 */
LI              /* a=0 b=0 c=1 -> specificity =   1 */
UL LI           /* a=0 b=0 c=2 -> specificity =   2 */
UL OL+LI        /* a=0 b=0 c=3 -> specificity =   3 */
H1 + *[REL=up]  /* a=0 b=1 c=1 -> specificity =  11 */
UL OL LI.red    /* a=0 b=1 c=3 -> specificity =  13 */
LI.red.level    /* a=0 b=2 c=1 -> specificity =  21 */
#x34y           /* a=1 b=0 c=0 -> specificity = 100 */
#s12:not(FOO)   /* a=1 b=0 c=1 -> specificity = 101 */
```

- **Sorting the rules**: 規則がマッチした後、カスケード規則に従ってソートされる。**WebKit は小さいリストにはバブルソート、大きいリストにはマージソートを使う。** WebKit は規則の `>` 演算子をオーバーライドしてソートを実装する:

```
static bool operator >(CSSRuleData& r1, CSSRuleData& r2)
{
    int spec1 = r1.selector()->specificity();
    int spec2 = r2.selector()->specificity();
    return (spec1 == spec2) : r1.position() > r2.position() : spec1 > spec2;
}
```

- **Gradual process**: WebKit は「（`@imports` を含む）すべてのトップレベルスタイルシートが読み込まれたか」を示すフラグを使う。**attach 時にスタイルが完全に読み込まれていなければプレースホルダが使われ、文書にマークされ、スタイルシートが読み込まれた後に再計算される。**
  - 〔補足（一般知識）〕原典が触れていないが、この「未読込スタイルシートでのプレースホルダ」の挙動は歴史的に **FOUC（Flash Of Unstyled Content）問題**として知られる（原典の参考文献に David Hyatt, “The FOUC Problem”, webkit.org/blog/66/ が挙げられている）。

## 11. レイアウト（Layout / Reflow） （出典: 原典）

- renderer が生成されて木に追加された時点では**位置とサイズを持たない**。これらの値を計算することを **layout（または reflow）** と呼ぶ。
- **HTML はフローベースのレイアウトモデル**を使う。つまり大半の場合、幾何情報を**単一パス**で計算できる。フローの後方の要素は通常フローの前方の要素の幾何に影響しないので、レイアウトは文書を**左から右、上から下**へ進められる。**例外はある — 例えば HTML の table は複数パスを要することがある。**
- **座標系はルートフレームに対する相対**。**top と left 座標**を使う。
- レイアウトは**再帰的**処理。HTML 文書の `<html>` 要素に対応するルート renderer から始まる。フレーム階層の一部または全体を再帰的に進み、必要な各 renderer の幾何情報を計算する。
- **ルート renderer の位置は 0,0、寸法は viewport（ブラウザウィンドウの可視部分）。**
- すべての renderer は "layout" または "reflow" メソッドを持ち、各 renderer はレイアウトが必要な子の layout メソッドを呼ぶ。

### 11.1 Dirty bit system

- 小さな変更ごとに完全なレイアウトをしないため、ブラウザは **"dirty bit" システム**を使う。変更または追加された renderer は自身と子を **"dirty"**（レイアウトが必要）とマークする。
- **2 つのフラグ**がある: **"dirty"** と **"children are dirty"**。後者は「renderer 自身は問題ないが、レイアウトが必要な子が少なくとも 1 つある」ことを意味する。

### 11.2 Global and incremental layout

- **global layout**: render tree 全体でレイアウトが起動される。原因は
  1. すべての renderer に影響するグローバルなスタイル変更（フォントサイズ変更など）
  2. 画面のリサイズ
- **incremental layout**: dirty な renderer のみをレイアウトする（これは追加のレイアウトを要する損傷を生じ得る）。renderer が dirty になったとき**非同期に**起動される。例: ネットワークから追加コンテンツが届いて DOM ツリーに追加され、新しい renderer が render tree に追加されたとき。
- 図: **Figure 17: Incremental layout - only dirty renderers and their children are layed out (3.6)**（`reflow.png`）

### 11.3 Asynchronous and Synchronous layout

- **incremental layout は非同期に行われる。** Firefox は incremental layout 用の **"reflow commands" をキューに入れ**、スケジューラがこれらのコマンドのバッチ実行を起動する。WebKit にも incremental layout を実行するタイマーがあり、木を走査して "dirty" な renderer をレイアウトする。
- **"offsetHeight" のようなスタイル情報を要求するスクリプトは、incremental layout を同期的に起動できる。**
- **global layout は通常同期的に起動される。** スクロール位置のような属性が変わったため、初回レイアウト後のコールバックとしてレイアウトが起動される場合もある。
  - 〔補足（一般知識）〕二次資料はこの点を強調しており、**同期レイアウトを強制するプロパティ/メソッドとして `getComputedStyleValue()`, `getBoundingClientWidth()`, `.offsetWidth`, `.offsetHeight`** を挙げ、完全な一覧が Paul Irish の gist（`https://gist.github.com/paulirish/5d52fb081b3570c81e3a`）にあるとしている。これは性能問題であると同時に、**副チャネル（timing）による情報漏えい**の観点でも押さえるべき挙動。

### 11.4 Optimizations / layout process / width calculation / line breaking

- **Optimizations**: レイアウトが "resize" または renderer の**位置**（サイズではない）の変更で起動された場合、renderer のサイズは**キャッシュから取られ再計算されない**。場合によっては部分木だけが変更され、レイアウトはルートから始まらない。変更がローカルで周囲に影響しない場合に起こる — テキストフィールドにテキストが挿入される場合など（さもなければキー入力ごとにルートからのレイアウトが起動されてしまう）。
- **The layout process**（原文の番号付き手順、逐語訳）:
  1. 親 renderer が自身の幅を決める。
  2. 親が子を走査し:
     1. 子 renderer を配置する（x と y を設定）。
     2. 必要なら子の layout を呼ぶ（子が dirty、global layout 中、その他の理由）— これが子の**高さ**を計算する。
  3. 親は子の累積高さとマージン・パディングの高さを使って**自身の高さ**を設定する — これは親の親が使う。
  4. 自身の dirty bit を false に設定する。
- Firefox はレイアウト（"reflow"）のパラメータに **"state" オブジェクト（nsHTMLReflowState）** を使う。state は親の幅などを含む。Firefox のレイアウト出力は **"metrics" オブジェクト（nsHTMLReflowMetrics）** で、renderer の計算済み高さを含む。
- **Width calculation**: renderer の幅は、包含ブロックの幅、renderer の "width" スタイルプロパティ、マージン、ボーダーから計算される。例: `<div style="width:30%"/>` の幅を WebKit が計算する手順（class RenderBox の calcWidth メソッド）:
  - 包含幅は container の availableWidth と 0 の最大値。この場合の availableWidth は contentWidth で、次のように計算される（逐語）:

```
clientWidth() - paddingLeft() - paddingRight()
clientWidth and clientHeight represent the interior of an object excluding border and scrollbar.
```

  - 要素の幅は "width" スタイル属性。包含幅のパーセンテージを計算して絶対値として求める。
  - 水平のボーダーとパディングが加算される。
  - ここまでが **"preferred width"** の計算。次に**最小幅と最大幅**が計算される。preferred width が最大幅より大きければ最大幅が使われる。最小幅（**最小の分割不能単位**）より小さければ最小幅が使われる。
  - **値はキャッシュされる**（レイアウトが必要だが幅が変わらない場合のため）。
- **Line Breaking**: レイアウト中の renderer が改行が必要だと判断すると、処理を止めて「分割が必要」と親に伝播する。**親が追加の renderer を生成し、それらに layout を呼ぶ。**
- 二次資料の追記（**layout thrashing**）: レイアウトスラッシングとは、ページが「読み込み完了」になる前にブラウザが何度も reflow / repaint をしなければならない状態。JavaScript が普及する前のサイトは通常 1 回だけ reflow/paint されたが、現在はページ読み込み時に JS が走って DOM を変更し、追加の reflow/repaint を起こすことが増えた。reflow の回数とページの複雑さによっては、特に携帯やタブレットのような低スペック端末で読み込みに大きな遅延を生じ得る。
- 二次資料の「なぜ DOM は遅いのか」（要旨を逐語に忠実に）: **短い答えは「DOM は遅くない」。** DOM ノードの追加・削除はポインタの入れ替えが数回で、JS オブジェクトのプロパティ設定とさほど変わらない。**しかしレイアウトが遅い。** DOM に何らかの形で触ると木全体に dirty bit が立ち、ブラウザに「すべての位置をもう一度求めよ」と伝える。JS がブラウザに制御を返すと、ブラウザはレイアウトアルゴリズム（より技術的には、CSS recalc → layout → repaint → re-compositing）を実行して画面を再描画する。レイアウトアルゴリズムは非常に複雑で（規則の一部を理解するには CSS 仕様を読む必要がある）、しばしば非ローカルな判断をしなければならない。さらに悪いのは、**特定のプロパティにアクセスするとレイアウトが同期的に起動される**こと。二次資料は「2013 年頃に Google Instant を計測したとき、1 クエリで 13 回のレイアウトを引き起こし、モバイル端末で画面が約 2 秒固まった（その後高速化された）」と述べ、React はレイアウト自体を速くしないが「ページ状態を更新するたびに最大 1 回のレイアウトに抑える」ことを保証すると説明している。

## 12. ペイント（Painting） （出典: 原典）

- ペイント段では render tree が走査され、renderer の **"paint" メソッド**が呼ばれて内容を画面に表示する。**ペイントは UI インフラストラクチャコンポーネントを使う。**
- **Global and Incremental**: レイアウト同様、ペイントも global（木全体を描画）または incremental であり得る。incremental painting では、一部の renderer が木全体に影響しない形で変化する。**変化した renderer は画面上の自身の矩形を無効化（invalidate）する。これにより OS がそれを "dirty region" と見なし "paint" イベントを生成する。OS は賢く複数の領域を 1 つに合体（coalesce）する。**
- **Chrome ではこれがより複雑で、renderer がメインプロセスとは別プロセスにある。Chrome は OS の挙動をある程度シミュレートする。** presentation がこれらのイベントを監視してメッセージを render root に委譲する。該当 renderer に到達するまで木が走査され、それが自身（と通常その子）を再描画する。
- **The painting order**: CSS2 がペイント処理の順序を定義する（`http://www.w3.org/TR/CSS21/zindex.html`）。これは実際には **stacking contexts** で要素が積まれる順序である。**この順序はペイントに影響する。スタックは後ろから前へ描画される。** ブロック renderer の stacking order（原文の番号付き、逐語）:

| 順 | 描画対象 |
|---|---|
| 1 | background color |
| 2 | background image |
| 3 | border |
| 4 | children |
| 5 | outline |

- **Firefox display list**: Firefox は render tree を走査し、描画対象矩形のための **display list** を作る。これは矩形に関係する renderer を正しい描画順（renderer の背景、次にボーダー等）で含む。**これにより repaint のために木を（全背景 → 全画像 → 全ボーダー…と何度も走査するのではなく）1 度だけ走査すればよくなる。** Firefox は、不透明な要素に完全に隠れる要素のような、隠される要素を追加しないことで最適化する。
- **Webkit rectangle storage**: **再描画の前に WebKit は古い矩形をビットマップとして保存する。そして新旧の矩形の差分（delta）だけを描画する。**

## 13. 動的変更（Dynamic changes） （出典: 原典）

ブラウザは変更に対して可能な限り最小の動作をしようとする（逐語訳・重要な対応表）:

| 変更 | 引き起こされる処理 |
|---|---|
| 要素の**色**の変更 | その要素の **repaint のみ** |
| 要素の**位置**の変更 | **その要素、その子、場合によっては兄弟の layout と repaint** |
| **DOM ノードの追加** | そのノードの **layout と repaint** |
| **"html" 要素のフォントサイズ増加**のような大きな変更 | **キャッシュの無効化、木全体の relayout と repaint** |

## 14. レンダリングエンジンのスレッドとイベントループ （出典: 原典、更新値は二次）

- **レンダリングエンジンはシングルスレッド。ネットワーク操作以外のほぼすべてが単一スレッドで起こる。** Firefox と Safari ではこれがブラウザのメインスレッド。**Chrome ではタブプロセスのメインスレッド。**
- **ネットワーク操作は複数の並列スレッドで実行できる。並列接続数には上限がある（原典: 通常 2〜6 接続。例えば Firefox 3 は 6 を使う）。**
  - 二次資料の更新値: **ホスト名あたり通常 6〜13 接続**。
- **Event loop**: ブラウザのメインスレッドは**イベントループ**。プロセスを生かし続ける無限ループで、（レイアウトやペイントのような）イベントを待って処理する。Firefox のメインイベントループのコード（逐語）:

```
while (!mExiting)
    NS_ProcessNextEvent(thread);
```

- 二次資料の注記: Chrome のようなブラウザは**レンダリングエンジンのインスタンスをタブごとに複数実行し、各タブは別プロセスで動く。**

## 15. CSS2 視覚モデル （出典: 原典）

- **The canvas**: CSS2 仕様によれば **canvas** は「整形構造（formatting structure）がレンダリングされる空間」を指す — ブラウザが内容を描画する場所。**canvas は空間の各次元について無限だが、ブラウザは viewport の寸法に基づいて初期幅を選ぶ。** `www.w3.org/TR/CSS2/zindex.html` によれば、**canvas は他の canvas に含まれる場合は透明、含まれない場合はブラウザ定義の色が与えられる。**
- **CSS Box model**: CSS ボックスモデルは、文書ツリーの要素に対して生成され視覚整形モデルに従って配置される矩形ボックスを記述する。**各ボックスは content area（テキスト、画像など）と、任意の周囲の padding, border, margin 領域を持つ。** 図: **Figure 18: CSS2 box model**。
- **各ノードは 0..n 個のそのようなボックスを生成する。** すべての要素は生成されるボックス型を決める "display" プロパティを持つ。例（逐語）:

```
block  - generates a block box.
inline - generates one or more inline boxes.
none - no box is generated.
```

  **既定は inline だが、ブラウザのスタイルシートが他の既定を設定する。例えば "div" 要素の既定 display は block。** 既定スタイルシートの例は `www.w3.org/TR/CSS2/sample.html`。
- **Positioning scheme（3 方式）**:
  1. **Normal** — オブジェクトは文書内の位置に従って配置される。render tree 内の位置が DOM ツリー内の位置と同じで、ボックス型と寸法に従ってレイアウトされる。
  2. **Float** — オブジェクトはまず通常フロー通りにレイアウトされ、その後できるだけ左または右へ移動される。
  3. **Absolute** — オブジェクトは DOM ツリー内の位置とは異なる位置に render tree に置かれる。
  - ポジショニング方式は **"position" プロパティと "float" 属性**で設定される。
    - **static と relative は normal flow を引き起こす**
    - **absolute と fixed は absolute positioning を引き起こす**
  - static では位置が定義されず既定のポジショニングが使われる。他の方式では著者が位置（top, bottom, left, right）を指定する。
- **ボックスのレイアウト方法を決めるもの**（逐語）: Box type / Box dimensions / Positioning scheme / External information（画像サイズや画面サイズなど）
- **Box types**:
  - **Block box**: ブロックを形成する — ブラウザウィンドウ上に自身の矩形を持つ（**Figure 19: Block box**）
  - **Inline box**: 自身のブロックを持たず、包含ブロックの内側にある（**Figure 20: Inline boxes**）
  - **ブロックは縦に次々と整形され、インラインは横に整形される**（**Figure 21: Block and Inline formatting**）
  - **inline box は行（"line boxes"）の中に置かれる。** 行は最も高いボックスと少なくとも同じ高さになるが、ボックスが "baseline" で揃えられる場合はより高くなり得る（要素の下端が他のボックスの下端以外の点に揃えられることを意味する）。包含幅が足りない場合、インラインは複数行に分けて置かれる。段落で通常起こること（**Figure 22: Lines**）。

## 16. ポジショニングとレイヤ表現 （出典: 原典）

- **Relative**: 通常通り配置され、その後必要な差分（delta）だけ移動される（**Figure 23: Relative positioning**）。
- **Floats**: float ボックスは行の左または右へずらされる。**興味深い特徴は他のボックスがその周りを回り込んで流れること。** 例（逐語）:

```html
 <p>
   <img style="float:right" src="images/image.gif" width="100" height="100">
   Lorem ipsum dolor sit amet, consectetuer...
 </p>
```

  （**Figure 24: Float**）
- **Absolute and fixed**: レイアウトは通常フローに関係なく正確に定義される。**要素は通常フローに参加しない。寸法は container に対する相対。fixed では container が view port。** **注意 — fixed ボックスは文書がスクロールされても動かない！**（**Figure 25: Fixed positioning**）
- **Layered representation（レイヤ表現）**: **z-index CSS プロパティ**で指定される。ボックスの第 3 次元、"z 軸" に沿った位置を表す。
  - ボックスは**スタック（stacking contexts と呼ばれる）**に分けられる。**各スタックで後ろの要素が先に描画され、前の要素がその上、ユーザに近い側に描画される。重なった場合は最前面の要素が前の要素を隠す。**
  - **スタックは z-index プロパティに従って順序付けられる。"z-index" プロパティを持つボックスはローカルスタックを形成する。viewport が外側のスタックを持つ。**
  - 例（逐語）:

```html

 <style type="text/css">
       div {
         position: absolute;
         left: 2in;
         top: 2in;
       }
 </style>
 <p>
     <div
          style="z-index: 3;background-color:red; width: 1in; height: 1in; ">
     </div>
     <div
          style="z-index: 1;background-color:green;width: 2in; height: 2in;">
     </div>
  </p>
```

  結果（**Figure 26**）: **赤い div はマークアップ上で緑より先にあり、通常フローなら先に描画されるはずだが、z-index プロパティが高いのでルートボックスが保持するスタックの中でより前方にある。**
  - 〔補足（一般知識）〕stacking context と z-index の挙動は**クリックジャッキング / UI redressing** の技術的核心であり、`opacity`, `pointer-events`, `transform` と組み合わせた重ね合わせが、ユーザの意図しないクリック先を作る。ch01 でレンダリングを扱う際にここを押さえると、後段の UI redressing 章の前提が揃う。

## 17. 図解（Figures）の一覧 （出典: 原典）

教科書に図を再作成する際の索引として、原典の全図をここに列挙する（図番号とキャプションは原文のまま）。

| 図 | キャプション（原文） | 画像ファイル名 | 内容 |
|---|---|---|---|
| Figure 1 | Browser main components. | layers.png | UI / Browser engine / Rendering engine / Networking / JS interpreter / UI backend / Data storage の積層図 |
| Figure 2 | Rendering engine basic flow. | （webplatform 上のハッシュ名） | HTML パース → DOM → render tree → layout → paint の 1 本フロー |
| Figure 3 | Webkit main flow | webkitflow.png | HTML → HTML Parser → DOM Tree → Attachment → Render Tree → Layout → Painting、CSS → CSS Parser → Style Rules の合流 |
| Figure 4 | Mozilla's Gecko rendering engine main flow(3.6) | 4b.png | HTML → Content Model(content sink) → Frame Constructor → Frame tree → Reflow → Painting |
| Figure 5 | mathematical expression tree node | image009.png | `2 + 3 - 1` のパース木 |
| Figure 6 | from source document to parse trees | image011.png | source document → lexer（tokens）→ parser → parse tree |
| Figure 7 | compilation flow | image013.png | source code → parse tree → machine code |
| Figure 8 | DOM tree of the example markup | image015.png | html/body/p("Hello World")/div/img の DOM ツリー |
| Figure 9 | HTML parsing flow (taken from HTML5 spec) | NTTDS.jpeg | Network → Byte Stream Decoder → Input Stream Preprocessor → Tokenizer → Tree Construction → DOM（および script 実行と document.write の戻り経路） |
| Figure 10 | Tokenizing the example input | image019.png | Data state → Tag open state → Tag name state の遷移図 |
| Figure 11 | tree construction of example html | 11.png | initial → before html → before head → in head → after head → in body → after body → after after body |
| Figure 12 | parsing CSS | image023.png | CSS file → StyleSheet オブジェクト → CSSRule（selector + declaration） |
| Figure 13 | The render tree and the corresponding DOM tree (3.1). | image025.png | DOM ツリーと render tree の非対称な対応 |
| Figure 14 | Firefox style context tree (2.2) | image035.png | style context tree |
| Figure 15 | The rule tree | image027.png | 規則番号を指すノード A〜G の rule tree |
| Figure 16 | The context tree | image029.png | rule ノードを指す context tree |
| Figure 17 | Incremental layout - only dirty renderers and their children are layed out (3.6) | reflow.png | dirty な部分木だけが再レイアウトされる図 |
| Figure 18 | CSS2 box model | image046.jpg | content / padding / border / margin の 4 領域 |
| Figure 19 | Block box | image057.png | ブロックボックス |
| Figure 20 | Inline boxes | image059.png | インラインボックス |
| Figure 21 | Block and Inline formatting | image061.png | ブロックは縦、インラインは横 |
| Figure 22 | Lines | image063.png | line box への詰め込み |
| Figure 23 | Relative positioning | image065.png | 通常配置後の delta 移動 |
| Figure 24 | Float | image067.png | float:right の画像にテキストが回り込む |
| Figure 25 | Fixed positioning | image25.png | fixed はスクロールしても動かない |
| Figure 26 | （原文は "Fixed positioning" と誤記。実際は z-index の例） | image071.png | z-index:3 の赤 div が z-index:1 の緑 div の前面に来る |

二次資料が追加で持つ図: `img/layers.png`（Figure 1 相当）、`img/full-process.png`（DOM Construction Process）、`img/dom-timeline.png`（DevTools での DOM 構築計測）、`img/flow.png`（rendering engine basic flow）、`img/webkitflow.png`、`img/image011.png`、`img/image017.png`（HTML parsing flow）、`img/image015.png`、`img/image025.png`。

## 18. 原典の参考文献（Resources）一覧（逐語） （出典: 原典）

1. **Browser architecture**
   1. Grosskurth, Alan. *A Reference Architecture for Web Browsers (pdf)* — `http://grosskurth.ca/papers/browser-refarch.pdf`
   2. Gupta, Vineet. *How Browsers Work - Part 1 - Architecture* — `http://www.vineetgupta.com/2010/11/how-browsers-work-part-1-architecture/`
2. **Parsing**
   1. Aho, Sethi, Ullman, *Compilers: Principles, Techniques, and Tools*（通称 "Dragon book"）, Addison-Wesley, 1986
   2. Rick Jelliffe. *The Bold and the Beautiful: two new drafts for HTML 5.*
3. **Firefox**
   1. L. David Baron, *Faster HTML and CSS: Layout Engine Internals for Web Developers.* — `http://dbaron.org/talks/2008-11-12-faster-html-and-css/slide-6.xhtml`
   2. L. David Baron, *Faster HTML and CSS ...（Google tech talk video）* — `http://www.youtube.com/watch?v=a2_6bGNZ7bA`
   3. L. David Baron, *Mozilla's Layout Engine*
   4. L. David Baron, *Mozilla Style System Documentation*
   5. Chris Waterson, *Notes on HTML Reflow*
   6. Chris Waterson, *Gecko Overview*
   7. Alexander Larsson, *The life of an HTML HTTP request*
4. **Webkit**
   1. David Hyatt, *Implementing CSS(part 1)*
   2. David Hyatt, *An Overview of WebCore*
   3. David Hyatt, *WebCore Rendering* — `http://webkit.org/blog/114/`
   4. David Hyatt, *The FOUC Problem* — `http://webkit.org/blog/66/the-fouc-problem/`
5. **W3C Specifications**
   1. HTML 4.01 Specification — `http://www.w3.org/TR/html4/`
   2. W3C HTML5 Specification
   3. Cascading Style Sheets Level 2 Revision 1 (CSS 2.1) Specification — `http://www.w3.org/TR/CSS2/`
6. **Browsers build instructions**
   1. Firefox — `https://developer.mozilla.org/en/Build_Documentation`
   2. Webkit — `http://webkit.org/building/build.html`

## 19. ch01 で使うための「脆弱性ハンティング視点」の整理 〔補足（一般知識）〕

本節はすべて筆者補足であり、原典・二次資料の記述ではない。原典の事実（上記各節）から素直に導ける観点のみを挙げる。

| 原典の事実 | クライアントサイド脆弱性への含意 |
|---|---|
| HTML パーサはエラーを絶対に報告せず必ず「修復」する（6.4 節） | サニタイザの構文モデルとブラウザの修復後 DOM が乖離する → mutation XSS / サニタイザ回避 |
| `document.write` によりパースが reentrant（6.3 節） | 注入がパース入力そのものを書き換えるため、静的な文字列検査では到達性を判定できない |
| tokenizer の次状態は「トークン化状態」と「ツリー構築状態」の両方に依存（6.3.1 節） | 文脈依存の挙動。同一のペイロード文字列が挿入位置によって別のトークンになる（foreign content / template / 属性値の各文脈） |
| open elements スタックで入れ子不整合を修正、同種タグ 20 段超は破棄（6.3.2 / 6.4 節） | 深い入れ子や不整合を使ったパーサ差分の作り込み |
| `display:none` は render tree に載らないが `visibility:hidden` は載る（9.1 節） | 見えない要素の可視性・計測可能性の差 → UI redressing、および CSS を用いた情報漏えい |
| z-index / stacking context は後ろから前へ描画し最前面が隠す（16 節） | クリックジャッキング（UI redressing）の直接の土台 |
| スクリプトは同期でパースを停止、スタイルシートはスクリプトをブロックしうる（8 節） | 順序依存・タイミング依存の DOM XSS 成立条件 |
| 投機的パーサは DOM を変更せず外部リソース参照のみをパースする（8 節） | プリロードスキャナ由来のリクエストが「実行前」に飛ぶ → CSP 検討時やリソース経由の副チャネルで考慮が必要 |
| `offsetHeight` 等のアクセスが同期レイアウトを強制（11.3 節） | レンダリング時間差を測るタイミング副チャネルの前提 |
| CSS セレクタは右から左にマッチし、id/class/tag のハッシュマップで 95% 以上が除去される（7 / 10.4 節） | CSS injection による属性値の 1 文字ずつの抽出（セレクタベースの漏えい）を理解する前提 |
| カスケード順は Browser < User normal < Author normal < Author important < User important（10.5 節） | 注入した CSS がどの優先度で効くか、ユーザスタイルシートによる緩和の限界 |
| Chrome はタブごとに別プロセスでレンダリングエンジンを持つ（2 / 14 節） | サイト分離（Site Isolation）とプロセス境界を越える情報漏えい（Spectre 系、XS-Leaks）の議論の入口 |

## 20. 【補完】MDN「Populating the page: how browsers work」で原典を現代化する

出典: MDN Web Docs, "Populating the page: how browsers work"（取得: `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/performance/guides/how_browsers_work/index.md`、公開 URL: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work ）。以下は同文書の記述の日本語要約であり、原典（2011）にない部分を補う目的で置く。**引用は要約であり逐語訳ではない。**

### 20.1 出発点の整理

- Web 性能の主要な敵は 2 つ、と MDN は整理する: **レイテンシ**と、**ブラウザが大部分でシングルスレッドである**という事実。後者は「1 つのタスクを最後までやってから次に移る」性質を指し、メインスレッドの責務を減らすことがスムーズさの鍵になる、と説明される。
- 原典（2011）の「レンダリングは単一スレッド、ネットワークのみ並列」（本ノート 14 節）に対応する記述だが、MDN は**メインスレッドの占有こそが問題**という現代的な言い方をしている。

### 20.2 Navigation（原典に存在しない層）

原典はネットワーク層を「8KB チャンクで来る」程度しか扱わないが、MDN は**ナビゲーションの内訳**を明示する。

- **DNS lookup** → **TCP ハンドシェイク**（SYN / SYN-ACK / ACK の 3 メッセージ）→ **TLS ネゴシエーション**。MDN は TLS について「実際のコンテンツ要求が送られる前にさらに 5 往復を要する」とし、**合計 8 往復の後にようやくブラウザはリクエストを送れる**と述べる。
- DNS 解決はホスト名ごとに必要。フォント・画像・スクリプト・広告・計測がそれぞれ別ホスト名なら、その数だけ解決が要る。モバイルでは端末→基地局→権威 DNS の距離がそのまま遅延になる。
- **TCP slow start / 輻輳制御**: 輻輳ウィンドウ **CWND** は 1 / 2 / 4 / 10 MSS のいずれかで初期化され（MSS は Ethernet 上で 1500 バイト）、ACK を受ければ倍、受けなければ半分になる。
- **最初のコンテンツチャンクは通常 14KB**（原典の「8K chunks」に相当する現代の数値）。**TTFB** はユーザ操作から最初の HTML パケット受信までの時間。

  - 〔補足（一般知識）〕この 14KB / slow start の話は性能最適化の文脈だが、**「最初の 1 パケットに何が載るか」がタイミング副チャネル（XS-Leaks）で観測されうる粒度**でもある。ch01 ではまず性能の話として提示し、副チャネルの章で再訪すると繋がりがよい。

### 20.3 Parsing — 原典に対する 3 つの重要な追加

1. **プリロードスキャナ（preload scanner）**: メインスレッドが DOM を作っている間、プリロードスキャナが利用可能な内容を先読みし、**CSS / JavaScript / Web フォントといった高優先度リソースを先にリクエストする**。原典の「speculative parsing」（本ノート 8 節）と同じ機構の現代名。MDN も「パーサが外部リソース参照に到達するのを待たずに取得する」と明記する。
2. **CSS はパースを止めないが JavaScript を止める**: MDN は「CSS の取得待ちは HTML のパースやダウンロードをブロックしないが、**JavaScript をブロックする**。JavaScript は CSS プロパティが要素に与える影響を問い合わせるのに使われることが多いから」と説明する。これは原典 8 節（Firefox は全スクリプトをブロック、WebKit は特定プロパティへのアクセス時のみブロック）の**現代版の言い直し**である。
3. **アクセシビリティツリー（AOM）の存在**: ブラウザは DOM・CSSOM に加えて**アクセシビリティツリー**を構築する。DOM の「意味的な版」であり、DOM 更新時に更新され、支援技術の側からは変更できない。**AOM が構築されるまで内容はスクリーンリーダから見えない。** 原典にはこの木は一切登場しない。
   - 〔補足（一般知識）〕「DOM・CSSOM・レイアウトツリー・レイヤツリー・アクセシビリティツリー」と**同じ文書に対して複数の木が並立する**という構図が重要。サニタイズや防御は通常 DOM にしか作用しないが、ユーザが実際に知覚する内容は他の木を経由して決まる。

- JavaScript は AST にパースされ、エンジンによっては AST をコンパイラに渡してバイトコードを出す（JavaScript compilation）。大半はメインスレッドで解釈されるが、Web Worker は例外。
- **CSSOM 構築は非常に高速**で、DevTools には単独では出ない。DevTools の **"Recalculate Style"** は「CSS のパース + CSSOM 構築 + 計算済みスタイルの再帰計算」の合計時間を示す。MDN は「CSSOM 生成の総時間は DNS 解決 1 回より短いことが多い」と述べ、最適化の優先度が低いことを示唆する。

### 20.4 Render — style / layout / paint / compositing

- **Style**: DOM のルートから可視ノードを辿って render tree（computed style tree）を作る。**`<head>` とその子、`display:none` のノードは render tree に入らない**（MDN はユーザエージェントスタイルシートの `script { display: none; }` を例に挙げる）。**`visibility:hidden` のノードは入る（場所を占めるから）。** → 原典 9.1 節と完全に一致する。**2011 年の記述が現代の公式ドキュメントでも同じ**という確認が取れたことは、教科書でこの性質を断言してよい根拠になる。
- **Layout**: render tree のルートから辿って各ノードの幾何（寸法・位置）を決める。**最初の 1 回が layout、以降の再計算が reflow。** 寸法が分からない置換要素（dimension 未指定の画像など）にはプレースホルダの領域が確保され、**画像の寸法が判明した時点で reflow が起きる**。
- **Paint**: レイアウトで計算された各ボックスを実ピクセルに変換（ラスタライズ）。**スムーズなスクロール・アニメーションのためには、スタイル計算・reflow・paint を含むメインスレッド上の全作業が 16.67ms 未満で終わらなければならない。** MDN は iPad（2048×1536）の 3,145,000 ピクセル超という具体例を挙げる。
- **レイヤ化と compositing**: 再ペイントを速くするため描画は複数レイヤに分割される。**レイヤを生成する要素・プロパティ**として `<video>`、`<canvas>`、`opacity`、3D `transform`、`will-change` 等が挙げられている。レイヤは性能を上げるがメモリ管理のコストが高く、多用すべきでない。レイヤが重なる場合、正しい順序で画面に出すために **compositing** が必要。
- **Interactivity / TTI**: **TTI** は最初のリクエストからページが対話可能になるまでの時間。ここでの「対話可能」は **FCP 後、ユーザ操作に 50ms 以内で応答する**時点を指す。MDN は 2MB のスクリプトが 1.5 秒以上メインスレッドを占有し、クリックにもタップにも反応しない WebPageTest の例を挙げる。

## 21. 【補完】MDN「Critical rendering path」— CSSOM がレンダリングをブロックする理由

出典: MDN Web Docs, "Critical rendering path"（取得: `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/performance/guides/critical_rendering_path/index.md`、公開 URL: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path ）

- CRP = **DOM / CSSOM / render tree / layout** の連鎖。最適化の狙いは最初の描画までの時間短縮と、reflow・repaint が 60fps に収まること（= jank の回避）。
- **決定的な非対称性**: **DOM 構築は逐次的（incremental）だが、CSSOM はそうではない。CSS はレンダリングブロッキングであり、ブラウザは CSS をすべて受信・処理し終えるまでページのレンダリングをブロックする。** 理由は「**後続の規則が先行する規則を上書きしうるため**、上書きされる予定のスタイルを画面に出してはいけない」から。CSSOM は CSS のパースに伴って構築されていくが、**完全にパースされるまで render tree の構築には使えない**。
  - これは原典（2011）が明示していない点で、本ノート 4.1 節の「段階的レンダリング」の理解を**CSS 側では成り立たない**と正しく限定する。教科書で「HTML は段階的、CSS は全部揃うまで待つ」と対比させると強い。
- **セレクタ性能**: 具体性の低いセレクタのほうが速い。`.foo {}` は `.bar .foo {}` より速い（後者はブラウザが `.foo` を見つけた後、祖先に `.bar` があるか DOM を上へ辿る必要がある）。ただし MDN は「この差はマイクロ秒単位で、最適化の優先度は低い。まず計測せよ」と明言する。**この「右から左／上へ辿る」挙動は本ノート 7 節の二次資料の記述と一致する。**
- **Layout の発生条件**: **render tree が変更されるたび**にレイアウトが起きる — ノードの追加、内容の変更、ノードのボックスモデル系スタイルの更新。ノード数が多いほどレイアウトは長引く。読み込み時や画面回転時の 20ms は許容できても、アニメーションやスクロール中なら jank になる。対策は**更新のバッチ化**と**ボックスモデル系プロパティをアニメーションさせないこと**。
- **Layout とビューポート**: レイアウトは画面サイズに依存する。ブロックレベル要素の既定幅は親の 100%、`body` は既定でビューポート幅の 100%。`<meta name="viewport" content="width=device-width">` がないと、既定でフルスクリーンのブラウザでは**概ね 960px** の既定ビューポート幅が使われる。端末回転やリサイズのたびにレイアウトが起きる。
- **Paint**: 読み込み時は画面全体をペイントし、以降は**影響を受けた領域だけを再ペイント**する（ブラウザは最小領域の再ペイントに最適化されている）。
- **CRP 最適化の 3 原則**: (1) クリティカルリソースの数を減らす（非クリティカルなものは defer / async / 削除）、(2) リクエスト数と各ファイルサイズを最適化する、(3) クリティカルアセットを優先的にダウンロードして**クリティカルパスの長さを短くする**。

## 22. 【補完】Chrome 公式「Inside look at modern web browser」全 4 部 — 原典から 7 年後のアーキテクチャ

出典: Mariko Kosaka（@kosamari）, "Inside look at modern web browser" part 1〜4、Chrome 公式ブログ（part1 公開 2018-09-05 / part2 09-07 / part3 09-20 / part4 09-21、以後 2019〜2020 に更新）。取得: `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part{1,2,3,4}/index.md`。公開 URL: https://developer.chrome.com/blog/inside-browser-part1 〜 part4。以下は日本語要約。

**この 4 部作は、原典（2011）が持たない「マルチプロセス・マルチスレッド」「ナビゲーションの内部フロー」「コンポジタ」「入力イベント処理」を公式ドキュメントとして補う。ch01 の後半はこれを骨格にするのが妥当。**

### 22.1 part 1: マルチプロセスアーキテクチャ

- **前提**: 「Web ブラウザをどう作るかの標準仕様は存在しない」。プロセス/スレッド構成は実装詳細であり、ブラウザごとに全く違ってよい — と明言されている。原典の 7 コンポーネント図（本ノート 2 節）も**規範ではなく一つの整理**だと理解すべき根拠になる。
- Chrome の構成（同記事の表）:
  - **Browser process**: アドレスバー・ブックマーク・戻る/進むといった「chrome 部分」に加え、**ネットワークリクエストやファイルアクセスといった不可視で特権的な部分**を扱う。
  - **Renderer process**: タブの中で起きることすべて。
  - **Plugin process**: サイトが使うプラグイン（例: flash）。
  - **GPU process**: GPU タスクを他プロセスから隔離して扱う。
  - 加えて拡張機能プロセスやユーティリティプロセスもある。
- **マルチプロセスの利点**: 1 タブが応答しなくなっても他は生き残る。そして**セキュリティとサンドボックス化** — OS がプロセスの権限を制限できるので、**任意のユーザ入力を扱うプロセス（=レンダラ）からの任意ファイルアクセスを Chrome は制限する**。
- **コスト**: プロセスは private なメモリ空間を持つため、V8 のような共通基盤のコピーを各プロセスが抱える。そこで Chrome は**プロセス数に上限**を設け（端末のメモリと CPU に依存）、上限に達すると**同一サイトの複数タブを 1 プロセスにまとめる**。
- **Servicification**: ブラウザプログラムの各部を「サービス」として動かし、強力なハードウェアでは別プロセスに分割（安定性重視）、リソース制約のある端末では 1 プロセスに集約（メモリ節約）できるようにする改修が進行中。
- **Site Isolation（最重要）**: **クロスサイト iframe ごとに別のレンダラプロセスを走らせる**機能。記事は「**Same Origin Policy が Web の中核セキュリティモデルであり、その回避が攻撃の主目的である。サイトを分離する最も効果的な手段がプロセス分離である**」とし、**Meltdown と Spectre によってプロセスでサイトを分離する必要性が一層明白になった**と述べる。**デスクトップでは Chrome 67 から既定で有効。** 実装は単にプロセスを割り当てるだけでなく iframe 間の通信方法を根本的に変えるもので、DevTools やページ内検索（Ctrl+F）もプロセス横断で動くよう作り直された。
  - 〔補足（一般知識）〕原典 2 節の「Chrome はタブごとに別プロセス」は、**2018 年時点で既に「サイトごと（iframe を含む）」へ更新されている**。XS-Leaks・Spectre 系・SOP 回避を論じる章では、この「プロセス境界 = 最後の防衛線」という位置づけを最初に提示すべき。

### 22.2 part 2: ナビゲーションの内部フロー（原典に完全に欠けている層）

1. **入力の処理**: アドレスバーへの入力は browser process の **UI スレッド**が扱い、まず「これは検索クエリか URL か」を判定する。
2. **ナビゲーション開始**: UI スレッドが **network スレッド**にネットワーク呼び出しを開始させる。DNS 解決や TLS 接続はここ。**HTTP 301 等のサーバリダイレクトを受け取ると、network スレッドは UI スレッドに伝え、別の URL リクエストが開始される。**
3. **レスポンスの読み取り（セキュリティ上の要点が集中）**:
   - **MIME タイプスニッフィング**が行われる。理由は「`Content-Type` ヘッダが**欠けていたり間違っていたりしうる**から」。記事は Chromium の `net/base/mime_sniffer.cc` のコメントを「tricky business」と引用している。
   - **SafeBrowsing チェック**（ドメインとレスポンスデータが既知の悪性サイトに一致すれば警告ページを出す）。
   - **CORB（Cross Origin Read Blocking）チェック** — **機微なクロスサイトデータがレンダラプロセスに到達しないことを保証するため**に行われる。
   - HTML ならレンダラへ、zip 等ならダウンロードマネージャへ渡す。
4. **レンダラプロセスの確保**: ネットワーク応答に数百 ms かかりうるので、UI スレッドは**ステップ 2 でネットワークリクエストを出すのと並行して、行き先が分かっている前提でレンダラプロセスを先回りして探す／起動する**。クロスサイトのリダイレクトが起きるとこの待機プロセスは使われない。
5. **コミット**: browser process から renderer process へ IPC でナビゲーションをコミットし、データストリームも渡す。コミット確認後にナビゲーション完了、文書読み込みフェーズ開始。**アドレスバー、セキュリティインジケータ、サイト設定 UI がここで新しいページの情報に更新される。** セッション履歴も更新され、タブ/セッション復元のため**ディスクに保存される**。
6. **初期読み込み完了**: レンダラが（全フレームで `onload` が発火し実行が終わった後に）IPC を返し、タブのスピナーが止まる。ただし記事は「"終わる" と書いたが、クライアント側 JavaScript はこの後もリソースを読み込み新しいビューを描画しうる」と注意する。
- **別サイトへの遷移**: 新しいナビゲーションの前に、**現在のレンダラに `beforeunload` ハンドラがあるか確認しなければならない**（「このサイトを離れますか?」の出所）。記事は「**無条件の `beforeunload` ハンドラを付けるな。ナビゲーション開始前にハンドラを実行しなければならず、レイテンシが増える**」と警告する。レンダラ発（リンククリックや `window.location = ...`）の場合も、まずレンダラが `beforeunload` を確認する。**遷移先が別サイトなら新しいレンダラプロセスが呼ばれ、現在のレンダラは `unload` 等のイベント処理のために残される。**
- **Service Worker**: 「アプリケーションコードでネットワークプロキシを書く」手段。**重要なのは Service Worker が renderer process で動く JavaScript であること。** 登録時にスコープが参照として保持され、ナビゲーション時に **network スレッドがドメインを登録済みスコープと照合**し、一致すれば UI スレッドが SW コードを実行するレンダラプロセスを探す。**Navigation Preload** は SW 起動と並行してリソースを読み込む仕組みで、リクエストにヘッダを付けるのでサーバ側は内容を差し替えられる。
  - 〔補足（一般知識）〕「SW はレンダラで動く JS」「スコープはナビゲーション時に照合される」という 2 点は、**XSS から Service Worker を登録できた場合にスコープ配下の通信を恒久的に掌握できる**という攻撃の前提そのものである。SW スクリプトの配置場所（スコープ制限）と `Service-Worker-Allowed` の扱いは、脆弱性ハンティングで必ず確認する項目。

### 22.3 part 3: レンダラプロセスの内部（原典のメインフローの現代版）

- **スレッド構成**: renderer process は **メインスレッド**（送られたコードの大半を処理）、**ワーカスレッド**（Web Worker / Service Worker）、**コンポジタスレッド**、**ラスタスレッド**を持つ。原典 14 節の「単一のレンダリングスレッド」は**もう正確ではない**。
- **DOM 構築**: HTML → DOM のパースは **WHATWG HTML Standard** が定義する（原典の「HTML5 仕様は作業中」からの更新）。記事は「**ブラウザに HTML を食わせてもエラーが投げられることはない**」とし、`</p>` の閉じ忘れは妥当な HTML であり、`b` タグが `i` タグより先に閉じられた壊れたマークアップも**仕様が優雅にエラーを処理するよう設計されている**ため一定の形に解釈されると説明する。詳細は HTML 仕様の "An introduction to error handling and strange cases in the parser" 節を参照せよ、とある。→ **原典 6.4 節（エラー耐性）が、現在は WHATWG 仕様に取り込まれていることの公式な裏付け**。原典は「驚くべきことに現行 HTML 仕様の一部ではない」と書いていたので、**ここは明確に時代差が出る箇所**。教科書では必ず更新して書くこと。
  - 参照先（仕様の該当節）: https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser
  - パースモデル全体図: https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model
- **サブリソース読み込み**: **プリロードスキャナは HTML パーサが生成したトークンを覗き見し**、`<img>` や `<link>` があれば browser process の network スレッドにリクエストを送る。→ 原典 8 節の speculative parsing の内部動作をより具体的に述べたもの。
- **JavaScript がパースを止める理由**: `document.write()` のように**文書全体の構造を変えうる**から。原典 6.3 節の「reentrant」の説明と同一の理由付け。
- **スタイル計算**: メインスレッドが CSS をパースし、各 DOM ノードの **computed style** を決める。**著者が CSS を一切書かなくても各ノードは computed style を持つ**（ブラウザの既定スタイルシートがあるため）。Chrome の既定 CSS は Blink の `html.css` として公開されている。
- **レイアウト**: メインスレッドが DOM と computed style を歩いて **layout tree** を作る。x/y 座標とバウンディングボックスの寸法を持つ。DOM ツリーと似た構造だが**可視のものに関する情報のみ**を含む。
  - **`display:none` は layout tree に入らない。`visibility:hidden` は入る。** → 原典 9.1 節と一致。
  - **`p::before{content:"Hi!"}` のような content を持つ疑似クラスは、DOM には存在しないのに layout tree には含まれる。** → **原典にない重要な追加**。
  - 〔補足（一般知識）〕この「DOM に存在しないのに描画される内容がある」という事実は、**DOM ベースのサニタイザや DOM を走査する防御が、ユーザが実際に見る内容を完全に把握できない**ことを意味する。CSS injection で `content` / `attr()` を使って情報を可視化・抽出する手法や、`::before` による偽 UI の重畳は、この層で成立する。
- **ペイント**: メインスレッドが layout tree を歩いて **paint record**（「まず背景、次にテキスト、次に矩形」といった描画手順のメモ）を作る。**`z-index` が設定されていれば HTML の記述順に描くと誤った描画になる**ため、この順序決定が必要。→ 原典 16 節（z-index / stacking context）の実装上の対応物。
- **パイプライン更新のコスト**: **各段は前段の結果を使って新しいデータを作る**。レイアウトツリーが変われば影響部分の paint 順序を作り直す必要がある。多くのディスプレイは毎秒 60 回更新（60fps）で、フレームを落とすと jank になる。レンダリング計算はメインスレッド上にあるので、**JavaScript の実行でブロックされうる**。対策として `requestAnimationFrame()` による分割実行や Web Worker。
- **コンポジティング（原典に完全に欠けている段）**:
  - **ラスタライズ** = 情報を画面のピクセルに変える処理。素朴な方法は「ビューポート内だけラスタライズし、スクロールしたら足りない分を追加ラスタライズ」で、**Chrome も最初のリリースではこうしていた**。現代のブラウザは **compositing** というより洗練された処理を行う。
  - **compositing** = ページを複数レイヤに分割し、**別々にラスタライズ**して、**コンポジタスレッドという別スレッドで 1 ページとして合成**する技術。スクロール時はレイヤが既にラスタライズ済みなので新しいフレームを合成するだけでよい。アニメーションも同様にレイヤを動かして合成するだけ。DevTools の **Layers パネル**で確認できる。
  - **レイヤへの分割**: メインスレッドが layout tree を歩いて **layer tree** を作る（DevTools performance パネルの **"Update Layer Tree"**）。分離されるべき部分（スライドインするサイドメニュー等）がレイヤにならない場合は CSS の **`will-change`** でヒントを与えられる。ただし**レイヤが過剰だと毎フレーム小領域をラスタライズするより遅くなりうる**ので計測が必須。
  - **メインスレッド外でのラスタとコンポジット**: layer tree と paint 順序ができたら、メインスレッドがその情報を**コンポジタスレッドにコミット**する。コンポジタスレッドは各レイヤをラスタライズするが、レイヤはページ全長のように巨大になりうるので**タイルに分割して各ラスタスレッドに送る**。ラスタスレッドは各タイルをラスタライズし **GPU メモリに格納**する。コンポジタスレッドはラスタスレッドの優先度を変えられるので、**ビューポート内（や近傍）を先にラスタライズできる**。ズーム対応のためレイヤは**解像度別に複数のタイリング**を持つ。
  - タイルが出来たらコンポジタスレッドは **draw quads**（タイルのメモリ上の位置と、ページ合成を考慮したときの描画先）を集めて **compositor frame**（draw quads の集合 = ページの 1 フレーム）を作る。compositor frame は **IPC で browser process に提出**され、ここで UI スレッド由来（ブラウザ UI の変更）や**他のレンダラプロセス由来（拡張機能）の compositor frame も追加されうる**。これらが GPU に送られて画面に出る。スクロールイベントが来ればコンポジタスレッドが別の compositor frame を作る。
  - **利点はメインスレッドを介さないこと**。コンポジタスレッドはスタイル計算や JavaScript 実行を待つ必要がない。だから**コンポジットのみで済むアニメーションが最もスムーズ**とされる。レイアウトやペイントの再計算が必要になるとメインスレッドが巻き込まれる。

### 22.4 part 4: 入力イベントとコンポジタ（クリックジャッキングの実装的基礎）

- ブラウザから見た「入力」はユーザのあらゆるジェスチャ（ホイールスクロール、タッチ、マウスオーバーも含む）。
- **経路**: ジェスチャは**まず browser process が受け取る**。しかし browser process は**どこで起きたかしか知らない**（タブの中身はレンダラの担当）。そこで**イベント種別（`touchstart` 等）と座標をレンダラに送り、レンダラがイベントターゲットを見つけてリスナを実行する**。
- **Non-Fast Scrollable Region**: JavaScript の実行はメインスレッドの仕事なので、ページを合成するときに**コンポジタスレッドはイベントハンドラが付いている領域に「非高速スクロール領域」の印を付ける**。その領域内でイベントが起きたときだけメインスレッドへ送り、**領域外ならメインスレッドを待たずに新しいフレームを合成し続ける**。
- **イベントデリゲーションの罠**: `document.body` に 1 つのハンドラを付ける一般的なパターンは、**ブラウザから見るとページ全体が非高速スクロール領域になる**ことを意味し、コンポジタのスムーズなスクロール能力が無効化される。緩和は **`{passive: true}`** の指定、**`event.cancelable`** の確認、CSS の **`touch-action`**（例 `pan-x`）でハンドラ自体を不要にすること。
- **ヒットテスト（最重要）**: コンポジタスレッドがメインスレッドに入力イベントを送ると、**最初に走るのはイベントターゲットを見つけるためのヒットテストであり、それは前段のレンダリング過程で生成された paint records のデータを使って、イベントが起きた座標の下に何があるかを調べる**。
  - 〔補足（一般知識）〕**これがクリックジャッキング / UI redressing の実装的な土台である。** ユーザの操作対象は「DOM 上の論理的な意味」ではなく「**その座標に paint records 上で最前面として存在するもの**」で決まる。したがって透明なオーバーレイ、`opacity:0`、`z-index` の操作、`pointer-events` の設定が攻撃と防御の両方の道具になる。原典 16 節（stacking context の描画順序）と本節を繋げて教えるとよい。
- **メインスレッドへのディスパッチ削減**: タッチスクリーンは毎秒 60〜120 回、マウスは毎秒約 100 回イベントを届ける — **画面のリフレッシュより入力の忠実度のほうが高い**。そこで Chrome は**連続イベント（`wheel`, `mousewheel`, `mousemove`, `pointermove`, `touchmove`）を合体（coalesce）させ、次の `requestAnimationFrame` の直前までディスパッチを遅らせる**。一方で**離散イベント（`keydown`, `keyup`, `mouseup`, `mousedown`, `touchstart`, `touchend`）は即座にディスパッチされる**。フレーム間の座標が必要なら `event.getCoalescedEvents()` で取得できる。
  - 〔補足（一般知識）〕「連続イベントは合体され rAF 直前まで遅延、離散イベントは即時」という差は、**入力タイミングを使った計測・自動化・レース条件**を考えるときの前提になる。

## 23. 【補完】原典（2011）と現代（2018〜）の差分マップ

教科書 ch01 で「どこを古典として読み、どこを更新して書くか」を判断するための対応表。左列は本ノート前半（原典）、右列は 20〜22 節（MDN / Chrome 公式）。

| 論点 | 原典（2011, Garsiel & Irish） | 現代の公式ドキュメント | 教科書での扱い |
|---|---|---|---|
| ブラウザの分割 | 7 コンポーネントの積層図 | 「ブラウザの作り方に標準仕様はない」。Chrome は Browser / Renderer / Plugin / GPU + 拡張・ユーティリティのマルチプロセス（Chrome part1） | 7 コンポーネントは**概念整理**として提示し、実体はマルチプロセスだと直後に補正する |
| プロセス境界 | 「Chrome はタブごとに 1 プロセス」 | **Site Isolation**: クロスサイト iframe ごとに別レンダラ。デスクトップは Chrome 67 から既定有効。動機に Same Origin Policy と Meltdown/Spectre（Chrome part1） | **更新必須**。ここを XS-Leaks / Spectre 章への導入にする |
| スレッド | 「単一のレンダリングスレッド + 並列ネットワーク」 | メイン / ワーカ / コンポジタ / ラスタスレッド（Chrome part3）、「ブラウザは概ねシングルスレッド」という言い方は**メインスレッドの話**（MDN） | 「メインスレッドが 1 本」と言い換える |
| 取り込み単位 | 8KB チャンク | 最初のコンテンツチャンクは通常 **14KB**、CWND は 1/2/4/10 MSS で初期化（MDN） | 数値は MDN 側を採用し、原典の 8KB は歴史として併記 |
| 投機的パース | speculative parsing（DOM は変更しない） | **preload scanner**: HTML パーサのトークンを覗き見し network スレッドへ要求（MDN / Chrome part3） | 現代名で書き、原典の名前を括弧で添える |
| HTML のエラー耐性 | 「**驚くべきことに現行 HTML 仕様の一部ではない**」 | **WHATWG HTML Standard が明示的に定義**（"An introduction to error handling and strange cases in the parser"）（Chrome part3） | **更新必須**。仕様化されたと書き、仕様の該当節へリンクする |
| render tree | Render Tree / RenderObject（WebKit）、Frame tree / Frame（Gecko） | **layout tree**（Chrome part3）、**render tree**（MDN）。加えて **layer tree** が層として増える | 用語の歴史を 1 段落で整理し、以降は layout tree / layer tree を使う |
| DOM と描画の非対応 | `head` と `display:none` は載らない / `visibility:hidden` は載る / `select` は 3 renderer / out-of-flow の placeholder | **同じ**（MDN, Chrome part3）。さらに **`::before` の content は DOM にないのに layout tree に載る**（Chrome part3） | 原典の列挙に疑似要素を追加して完全版にする |
| ペイント以降 | painting で終了（レイヤは 16 節の z-index の話まで） | **paint records → layer tree → タイル分割 → ラスタスレッド → GPU メモリ → draw quads → compositor frame → IPC → GPU**（Chrome part3） | **丸ごと追加が必要な層**。2011 年の記述には存在しない |
| 入力処理 | メインスレッドのイベントループの記述のみ | browser process が座標を受け取りレンダラへ。**ヒットテストは paint records を使う**。非高速スクロール領域、イベント合体（Chrome part4） | **丸ごと追加**。クリックジャッキング章の技術的裏付けにする |
| ネットワーク | ホストあたり 2〜6 本の並列接続 | DNS → TCP 3-way → TLS（さらに 5 往復）＝**計 8 往復**、MIME スニッフィング、SafeBrowsing、**CORB**（MDN / Chrome part2） | ナビゲーション節を新設する |
| CSS の扱い | CSS パースは文脈自由文法、スタイルシートがスクリプトをブロックしうる | **CSS はレンダリングブロッキング。CSSOM は逐次的でない**（後続規則が上書きしうるため）（MDN CRP） | 「HTML は段階的 / CSS は全部揃うまで」の対比として提示 |

---

## 読者が自分で開くべき資料

### (a) https://codeburst.io/how-browsers-work-6350a4234634 — 取得失敗（本ノート執筆環境のエグレス許可リストによる遮断）

**なぜ取得できなかったか**: 本作業環境のアウトバウンド HTTPS はホスト許可リスト方式のエージェントプロキシ経由で、`codeburst.io`（および `medium.com`）への CONNECT が組織ポリシーで 403 拒否された（`EGRESS_BLOCKED` / `connect_rejected`）。Wayback Machine（`web.archive.org`, `archive.org`）、`archive.ph`、Medium リーダープロキシ（`freedium.cfd` 等）、テキスト抽出プロキシ（`r.jina.ai`）もすべて同様に遮断。WebSearch はセッション予算（200/200）を消費済み。**記事そのものが Medium の Member-only（paywall）であるかどうかは、本セッションでは確認できていない。** Medium 記事は一般に、ブラウザで開けば無料枠で読めることが多く、読めない場合はシークレットウィンドウか Medium アカウントのログインで解決することが多い。

**読みどころ（読者が自分で開いたとき、この順で読むこと）**:
1. **記事の位置づけを最初に確認する** — この記事の正式タイトルは “**Notes on “How Browsers Work”**” であり、Tali Garsiel & Paul Irish の原典の読解ノートである。したがって「原典のどの節を要約し、どこを著者が独自に補ったか」を意識して読む。原典を先に（または並行して）読むのが最短。
2. **ブラウザの高レベル構造の図（7 コンポーネント）** — UI / Browser engine / Rendering engine / Networking / UI backend / JavaScript interpreter / Data storage。どの機能がどの層に属するかを図として頭に入れる。
3. **メインフローの図（HTML Parser → DOM Tree → Attachment → Render Tree → Layout → Painting、CSS Parser → Style Rules の合流）** — WebKit 版と Gecko 版の用語差（Render Tree/RenderObject/layout/Attachment ↔ Frame tree/Frame/Reflow/content sink）を必ず対応表として押さえる。
4. **HTML パースの 2 段（tokenization と tree construction）とステートマシンの状態名** — "Data state" / "Tag open state" / "Tag name state"、および insertion modes（"initial" → "before html" → "before head" → "in head" → "after head" → "in body" → "after body" → "after after body"）。脆弱性ハンティングで最も使う知識。
5. **エラー耐性の実例（`</br>`、stray table、入れ子 form の無視、20 段超の同種タグ破棄、body 終了タグの無視）** — 「パーサが入力を書き換える」具体例。mXSS とサニタイザ回避の理論的基礎。
6. **レンダーツリーと DOM が 1:1 でない点**（`head` と `display:none` は載らない／`visibility:hidden` は載る／`select` は 3 renderer／out-of-flow の placeholder frame）と **z-index / stacking context の描画順序**。UI redressing と CSS 経由の情報漏えいの前提になる。

**代替手段（この記事が読めないとき / 読む前に押さえるべきもの）**:

1. **最優先の代替 = 原典そのもの**: 下記 (b) の Garsiel & Irish 原典。codeburst 記事はこの原典の読解ノートなので、原典を読めば内容は上位互換で得られる。GitHub 経由なので paywall もエグレス制約も受けにくい。
2. **アーカイブ（読者の環境からなら到達しうる）**: `https://web.archive.org/web/2024/https://codeburst.io/how-browsers-work-6350a4234634` および `https://web.archive.org/web/2023/https://codeburst.io/how-browsers-work-6350a4234634`。**本ノートの執筆環境では `web.archive.org` 自体が遮断されていて検証できていない**ので、スナップショットが存在するかどうかは未確認。存在しない場合は `http://archive.org/wayback/available?url=codeburst.io/how-browsers-work-6350a4234634` で有無を確認できる。
3. **Medium 側の読み方**: codeburst は Medium 上のパブリケーションなので、`https://medium.com/codeburst/how-browsers-work-6350a4234634` でも同じ記事に到達する（Medium の正規化により同一記事）。Member-only だった場合は、Medium の無料枠・シークレットウィンドウ・ログインのいずれかで解決することが多い。
4. **同等の無料資料（これで十分に代替できる）**: 下記 (e) の MDN 2 本と Chrome 公式 4 部作。**本ノートの 20〜22 節がその要約**であり、原典にない現代のアーキテクチャ（マルチプロセス、Site Isolation、コンポジタ、入力処理）まで公式ドキュメントで埋まる。codeburst 記事（2011 年原典の要約）を読む価値より、こちらを読む価値のほうが高い。
5. **同名の別記事（混同注意）**: 下記 (f)。タイトルがほぼ同一だが同一文書という証拠はない。

### (b) 原典（強く推奨・本ノートの主な典拠）

- **https://raw.githubusercontent.com/webplatform/docs/HEAD/concepts/Internet_and_Web/how_browsers_work/index.md** — Tali Garsiel & Paul Irish, “How browsers work: behind the scenes of modern web browsers”（2011-08-05）の全文 Markdown。**本ノートの 0〜18 節はこれに基づく。** GitHub 経由なので paywall もエグレス制約も受けにくい。
  - 読みどころ: 「Browsers' error tolerance」節（WebKit の実コード付き）、「The order of processing scripts and style sheets」節、「Render tree construction」節の DOM/render tree 非対応の列挙、「Style Computation」節の rule tree と 10 条件の style 共有、「Layered representation」節。
- 〔補足（一般知識）〕原典は 2011 年の記述であり、**Blink の登場（2013）、Chrome の Site Isolation、コンポジタスレッド／ラスタライズの分離、`requestAnimationFrame` を含む現代のレンダリングフレームライフサイクル、Stylo（Firefox の並列 CSS エンジン）などは扱っていない**。教科書では「古典として読む部分」と「現代の補足が必要な部分」を明示的に分けること。

### (c) 二次資料（原典の現代化された要約として有用）

- **https://raw.githubusercontent.com/vasanthk/how-web-works/HEAD/README.md** — “How Web Works: What happens behind the scenes when we type google.com in a browser?”
  - 読みどころ: 目次の「Behind the scenes of the Browser」以降（本ノート 4.1 節の Conversion/Tokenizing/Lexing/DOM construction、エンジン対応表、「Why is the DOM slow?」、layout thrashing、同期レイアウトを強制するプロパティ一覧へのリンク）。加えて前半の DNS / TLS / HTTP 部分は ch01 で「ネットワークからレンダリングまで」を一続きに語るときに便利。

### (d) codeburst 記事を参考文献として引用している第三者資料（記事の位置づけ確認用）

- `https://raw.githubusercontent.com/tigercosmos/blog/HEAD/source/_posts/browser/browser_series_33.md` — 繁体中国語のブラウザ自作連載の参考資料一覧。当該記事を “**Notes on “How Browsers Work”**” として引用。
- `https://raw.githubusercontent.com/zhbhun/frontend-learning/HEAD/tutorials/performance/principle/README.md` — 同じタイトルで引用。W3C の CSS2 Box model / Stacking Contexts / Grammar 仕様へのリンクも併記。
- `https://raw.githubusercontent.com/dujuncheng/blogs/HEAD/other/前端性能优化/深入理解浏览器渲染原理.md` — 中国語のレンダリング原理解説。当該記事に加え Stylo（Quantum CSS）と Chromium の “the rendering critical path” を参考文献に挙げている（より新しいレンダリングパイプラインへの橋渡しになる）。

### (e) 現代の公式一次資料（**codeburst 記事の実質的な代替。強く推奨**）

いずれも本ノートの補完作業で全文取得済み（要約は 20〜22 節）。無料・登録不要・エグレス制約に強い（`raw.githubusercontent.com` 経由でも読める）。

1. **MDN “Populating the page: how browsers work”**
   - 公開 URL: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work
   - raw: `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/performance/guides/how_browsers_work/index.md`
   - **何を学ぶために読むか**: 原典（2011）に欠けている **Navigation（DNS → TCP 3-way → TLS で計 8 往復）**、**14KB の最初のチャンクと TCP slow start**、**preload scanner**、**アクセシビリティツリー（AOM）の存在**、**TTI と「50ms 以内の応答」の定義**。加えて `display:none` / `visibility:hidden` の render tree 取り扱いが 2011 年から変わっていないことの確認。
2. **MDN “Critical rendering path”**
   - 公開 URL: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path
   - raw: `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/performance/guides/critical_rendering_path/index.md`
   - **何を学ぶために読むか**: **「DOM 構築は逐次的だが CSSOM はそうではなく、CSS はレンダリングブロッキングである」**という非対称性とその理由（後続規則が上書きしうる）。これは原典が明示しない最重要の補正。あわせてセレクタ性能（右から左／祖先を上へ辿る）とレイアウトが再発生する条件。
3. **Chrome 公式 “Inside look at modern web browser” part 1〜4（Mariko Kosaka, 2018）**
   - 公開 URL: https://developer.chrome.com/blog/inside-browser-part1 / part2 / part3 / part4
   - raw: `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part1/index.md`（part2〜4 も同形式）
   - **何を学ぶために読むか（部ごとに目的が違う）**:
     - **part 1** — マルチプロセス構成と**Site Isolation**（クロスサイト iframe ごとに別レンダラ、Chrome 67 から既定、動機は SOP と Meltdown/Spectre）。**プロセス境界をセキュリティ境界として理解する**ために読む。
     - **part 2** — ナビゲーションの内部フロー。**MIME スニッフィング**、**SafeBrowsing**、**CORB**、`beforeunload` の扱い、**Service Worker がレンダラで動く JS でありスコープがナビゲーション時に照合されること**。**通信経路上のどこでセキュリティ判定が入るか**を知るために読む。
     - **part 3** — レンダリングパイプラインの現代版。**layout tree / paint records / layer tree / タイル / ラスタスレッド / draw quads / compositor frame**。特に**`::before` の content は DOM にないのに layout tree に載る**点（CSS injection を理解する鍵）と、**HTML のエラー処理が現在は WHATWG 仕様で定義されている**という原典からの更新点。
     - **part 4** — 入力イベント処理。**ヒットテストが paint records を使って座標の下にあるものを決める**（= クリックジャッキングの実装的基礎）、非高速スクロール領域、連続イベントの合体と離散イベントの即時ディスパッチ。
4. **WHATWG HTML Standard のパース節（原典の 6 章を現行仕様で読み直すため）**
   - エラー処理入門: https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser
   - パースモデル概観: https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model
   - **何を学ぶために読むか**: 原典 6.4 節が「仕様の一部ではない」と書いたエラー耐性が、**現在は規範として定義されている**ことの確認。mXSS / サニタイザ回避を書くときは、必ずこの現行仕様側を典拠にすること。

### (f) 同名の別記事（**混同注意・関係は未検証**）

- **kunigami, “Notes on how browsers work”（2015-10-09）**
  - raw: `https://raw.githubusercontent.com/kunigami/kunigami.github.io/master/blog/_posts/2015-10-09-notes-on-how-browsers-work.md`
  - **codeburst 記事とタイトルがほぼ同一だが、同一文書である証拠はない。** 当該ファイルに Medium / codeburst への言及も canonical リンクもなく、転載関係は**未検証**。本ノートは両者を別物として扱う。
  - **それでも読む価値がある理由**: 同じ Garsiel & Irish 原典に加え、**HTML5 Rocks の “Accelerated Rendering in Chrome”（layers）** と **Chromium 設計文書 “GPU Accelerated Compositing in Chrome”** を典拠としており、**原典（2011）と Chrome 公式 4 部作（2018）の間を埋める**。
  - **読みどころ**: (1) レイアウトにおける**幅はボトムアップ、高さはトップダウン**で計算されるという説明と、親は直接の子だけを見る（`overflow` の影響）という具体例。(2) **DOM Element > Render Object > Render Layer > Graphics Layer** という 4 段の対応関係。(3) **render layer**（重なり・半透明を正しい順序で合成するために存在、1 つ以上の render object を含む）と **graphics layer**（GPU で描画、自前のレイヤを持つ render layer を *compositing layer* と呼ぶ）の区別。(4) レンダリングを **painting（graphics layer の内容を埋める）** と **compositing/drawing（graphics layer を 1 枚の画像に合成する）** の 2 フェーズに分ける整理。
  - 〔補足（一般知識）〕この (2)〜(4) の語彙は Chrome 公式 part3 の layer tree / タイル / compositor frame の説明と繋がる。教科書では **Chrome 公式 part3 を主典拠**にし、この記事は補助として扱うのが安全（公式ドキュメントのほうが新しく、かつ規範に近い）。

---

## 補完作業のサマリ（2026-09-18）

- **codeburst.io の当該記事は、2 回目の試行でも取得できなかった**（WebFetch は `EGRESS_BLOCKED`、curl は CONNECT 403、アーカイブ系・テキスト抽出プロキシ系は全滅、WebSearch は予算切れ）。**本文は 1 文字も取得できていない。著者名・公開日も不明。** したがって本ノートおよび教科書は、この記事を典拠として引用しない。
- **代わりに、到達可能な公式一次資料を新規に全文取得して 20〜23 節を追加した**: MDN 2 本、Chrome 公式 4 部作、および同名の 2015 年記事 1 本。これにより、原典（2011）が扱わない**ナビゲーション / マルチプロセスと Site Isolation / コンポジティング / 入力イベントとヒットテスト**の 4 領域が公式典拠付きで埋まった。
- **23 節の差分マップ**が、教科書 ch01 を書くときの「原典のまま書ける箇所」と「更新が必須の箇所」の判断表になる。特に **(1) タブ単位プロセス → Site Isolation**、**(2) HTML エラー処理は仕様外 → WHATWG 仕様で定義済み**、**(3) 単一レンダリングスレッド → メイン/コンポジタ/ラスタ/ワーカ**、**(4) painting で終了 → compositing 以降が存在する** の 4 点は原典のまま書くと誤りになる。
