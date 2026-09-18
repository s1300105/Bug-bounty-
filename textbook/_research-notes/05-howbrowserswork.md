# [05] How Browsers Work: Behind the Scenes of Modern Web Browsers（Tali Garsiel / Paul Irish）

担当ID: 05 (howbrowserswork) / 想定章: ch01

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://www.html5rocks.com/tutorials/internals/howbrowserswork/ | full（内容） / 直接アクセスは failed | GitHubミラー `raw.githubusercontent.com/hungdt138/html5rocks/HEAD/www.html5rocks.com/content/tutorials/internals/howbrowserswork/en/index.html`（HTTP 200、93,653 bytes） | 担当URLそのものは egress プロキシのポリシーで **403（EGRESS_BLOCKED）**。WebFetch も curl も CONNECT 403。html5rocks 全体がサイト閉鎖済みのため、原典のソースHTMLをミラーから取得して全文復元した。見出し集合を後述の web.dev 版と突き合わせ、全79見出しが一致することを確認済み |
| https://web.dev/articles/howbrowserswork （html5rocksからの公式リダイレクト先） | full（内容） / 直接アクセスは failed | GitHubミラー `raw.githubusercontent.com/Youssef1313/web.dev/HEAD/src/site/content/en/blog/howbrowserswork/index.md`（HTTP 200、77,534 bytes、1,545行） | `web.dev` も egress ポリシーで 403。web.dev サイトのソースリポジトリ（`src/site/content/en/blog/howbrowserswork/index.md`）のミラーから Markdown 原文を全文取得。これが現行版の正本 |
| https://web.archive.org/web/2024/https://www.html5rocks.com/... | failed（補完パスでも解消せず） | curl | web.archive.org も egress ポリシーで 403。プロキシ status の `recentRelayFailures` に記録あり。**補完パスでは再試行していない** ― `/root/.ccr/README.md` が「403/407 は組織のegressポリシー拒否であり再試行・迂回をせず報告せよ」と定めているため。代替として GitHub ミラー経由で原典・現行版の全文を確保済み（末尾の補完パス追記節を参照） |
| https://developer.chrome.com/ (関連記事探索) | failed | curl | 同じく 403 |

**取得の結論: 原典（html5rocks版）と現行版（web.dev版）の両方を全文・逐語で入手できたため、内容としては欠落なし。** 担当URLへの直接HTTPアクセスのみが組織のegressポリシーで拒否された（プロキシの指示に従い迂回・TLS検証無効化は行っていない）。

> **【補完パス追記あり】** 本ノートには末尾に「**# 【補完パス追記】取得漏れの補完（2回目の取得試行）**」節がある。そこでは (A) 原典HTMLの `id` 属性から**注記 (1.1)(2.2)(3.1)(3.5)(3.6)(4.1) の対応を確定**し（初回パスの推測を裏付け）、初回パスが落としていた注記 (3.5) と Preface の記述を追記、(B) **全28点の図の完全インベントリ**（両版のファイル名・画像ID・寸法・対応節）を新設、(C) MDN と Chrome 公式の現行資料を全文取得して**原典が古びた箇所（ネットワーク段階・スレッドモデル・compositing・Site Isolation）を出典付きで補完**、(D)「読者が自分で開くべき資料」の代替手段を実測ベースで具体化した。**この節の記述を優先して参照すること。**

〔補足（一般知識）〕この記事は原典が html5rocks.com（2011-08-05公開）、その後 html5rocks のコンテンツが web.dev に移管され、現在は web.dev 側が正本。著者は Tali Garsiel（イスラエルの開発者、2000年からWeb開発、Netscapeの "evil" layer model に出会ったのが発端）と Paul Irish（Chrome Developer Relations）。

### 原典（html5rocks版, 2011年8月時点）と web.dev版（2013年6月以降に更新）の差分（教科書で年代を書く際に重要）

| 項目 | html5rocks版（原典） | web.dev版（現行） |
| --- | --- | --- |
| 対象ブラウザ | 「主要5ブラウザ = IE, Firefox, Safari, Chrome, Opera」。StatCounter で「現在（2011年8月）Firefox+Safari+Chrome の利用シェアは約60%」 | デスクトップ主要5 = Chrome, IE, Firefox, Safari, Opera。モバイルは Android Browser, iPhone, Opera Mini, Opera Mobile, UC Browser, Nokia S40/S60, Chrome（Opera系以外はすべてWebKitベース）。StatCounter（2013年6月時点）でデスクトップは Chrome+Firefox+Safari が約**71%**、モバイルは Android Browser+iPhone+Chrome が約**54%** |
| レンダリングエンジン | 「参照ブラウザ Firefox/Chrome/Safari は2つのエンジンの上に構築。Firefox は Gecko（Mozilla自製）、Safari と Chrome はどちらも Webkit」 | 「IE は Trident、Firefox は Gecko、Safari は WebKit。**Chrome と Opera（バージョン15以降）は Blink（WebKitのfork）**」 |
| Data storage | 「ブラウザはクッキーなど各種データをハードディスクに保存する必要がある。新しいHTML仕様（HTML5）は 'web database'（ブラウザ内の完全な（軽量だが）データベース）を定義している」 | 「localStorage, IndexedDB, WebSQL, FileSystem といったストレージ機構もサポート」 |
| マルチプロセス | 「**Chrome は他の多くのブラウザと違って**レンダリングエンジンのインスタンスを複数持つ ― タブごとに1つ。各タブは別プロセス」 | 「Chrome **のような**ブラウザはレンダリングエンジンのインスタンスを複数実行する ― タブごとに1つ。各タブは別プロセスで動く」 |
| ネットワーク取得単位 | 「通常 **8K** チャンク」 | 「通常 **8kB** チャンク」 |
| 目次 | 記事内に「Table of Contents」があり、JSで「Chapter N」「N.M」と自動採番。目次上は HTMLパーサ群を **"Parsing and DOM tree construction"** という章でまとめている | Table of Contents なし（見出しのみ） |
| 翻訳・付随情報 | Preface に「この記事はコミュニティにより韓国語訳あり。HTML5 Rocks は German / Spanish / Japanese / Portugese / Russian / Simplified Chinese 版をホスト」「Tali Garsiel 本人のこのトピックの講演を **Vimeo** で視聴できる」 | 末尾の Translations 節に日本語2種・韓国語・トルコ語のリンクのみ |

---

## 要約（3〜10行）

- ブラウザの主要コンポーネントは UI / ブラウザエンジン / レンダリングエンジン / ネットワーキング / UIバックエンド / JavaScriptインタプリタ / データストレージの7つ。Chrome はレンダリングエンジンをタブごとに別プロセスで持つ。
- レンダリングエンジンの基本フローは「HTMLパース → DOM（content tree） → スタイルデータのパース → render tree 構築 → layout（位置決め） → painting（描画）」で、これは**段階的（gradual）**に進む。全HTMLを待たずに一部を表示する。
- **HTMLは文脈自由文法（context free grammar）ではない**。タグ省略を許す「寛容な（forgiving）」構文、既知の不正HTMLへのエラー寛容性、そして `document.write()` によりパース中に入力自体が書き換わる**再入可能（reentrant）**性 ― この3点により通常のtop-down/bottom-upパーサが使えず、ブラウザは専用パーサを実装する。アルゴリズムは**tokenization（状態機械）**と**tree construction（insertion modes という状態機械）**の2段。
- CSSは対照的に文脈自由文法で、WebKit は Flex+Bison で自動生成した bottom-up shift-reduce パーサ、Firefox は手書きの top-down パーサを使う。
- スクリプトは同期モデル（`<script>` でパースが停止）。`defer`/`async` で緩和。WebKit/Firefox は **speculative parsing**（別スレッドで先読みし外部リソースだけ取得。DOMは触らない）で高速化。スタイルシートは Firefox は読み込み中に全スクリプトをブロック、WebKit は影響を受けるスタイルプロパティにアクセスしたときだけブロック。
- スタイル計算は「データ量が巨大」「マッチングが重い」「カスケードが複雑」の3課題を、RenderStyle の共有（WebKitの10条件）、Firefox の rule tree + style context tree（structs単位のキャッシュ共有）、セレクタ最右辺をキーにした id/class/tag ハッシュマップ（**ルールの95%以上を候補から除外**）で解く。
- Layout（Gecko では reflow）は dirty bit 方式（`dirty` と `children are dirty` の2フラグ）で差分化。incremental layout は非同期、global layout は通常同期。`offsetHeight` 等のスクリプト読み取りは同期 layout を強制する。
- Painting は CSS2 の z-index 仕様が定める順序（背景色→背景画像→ボーダー→子→outline）で、stacking context を奥から手前へ描く。レンダリングエンジンは**単一スレッド**（ネットワーク以外すべて）で、メインスレッドはイベントループ。

---

## 詳細ノート

以下すべて出典: https://www.html5rocks.com/tutorials/internals/howbrowserswork/ （= 現行版 https://web.dev/articles/howbrowserswork ）。差分がある箇所は上の差分表のとおり明示する。

### Preface（序文）（出典: 同上）

WebKit と Gecko の内部動作についての包括的な入門記事。イスラエルの開発者 Tali Garsiel が数年かけて、ブラウザ内部について公開されている全データをレビューし、ブラウザのソースコードを大量に読んで行った研究の成果。

Tali の言葉（引用）:

> IEが90%を支配していた年月には、ブラウザを「ブラックボックス」と見なすしかやることがなかった。しかし今、オープンソースブラウザが利用シェアの半分以上を持つようになり、エンジンのフードの下を覗いてWebブラウザの中身を見るのに良い時期だ。中にあるのは、まあ、数百万行のC++である。

Paul Irish（Chrome Developer Relations）の言葉（引用）:

> Web開発者として、**ブラウザ内部の動作を学ぶことは、より良い判断を下し、開発のベストプラクティスの根拠を知る助けになる**。これはかなり長い文書だが、時間をかけて掘り下げることを推奨する。読んで良かったと思えることを保証する。

### Introduction（はじめに）（出典: 同上）

Webブラウザは最も広く使われているソフトウェア。この入門では裏側の動作を説明する。アドレスバーに `google.com` とタイプしてから、ブラウザ画面にGoogleのページが見えるまでに何が起きるかを見る。

### The browsers we will talk about（対象とするブラウザ）（出典: 同上）

現行版の記述: デスクトップで今日使われている主要ブラウザは5つ ― Chrome, Internet Explorer, Firefox, Safari, Opera。モバイルの主要ブラウザは Android Browser, iPhone, Opera Mini, Opera Mobile, UC Browser, Nokia S40/S60 ブラウザ, Chrome で、**Opera系を除くすべてがWebKitベース**。例はオープンソースの Firefox と Chrome、および（部分的にオープンソースの）Safari から取る。StatCounter統計（2013年6月時点）によれば、デスクトップでは Chrome+Firefox+Safari が世界のブラウザ利用の約71%、モバイルでは Android Browser+iPhone+Chrome が約54%を占める。

（原典2011年版: 主要5ブラウザは IE, Firefox, Safari, Chrome, Opera。StatCounterで2011年8月時点 Firefox+Safari+Chrome が約60%。「今日ではオープンソースブラウザがブラウザビジネスの相当な部分を占める」）

### The browser's main functionality（ブラウザの主機能）（出典: 同上）

ブラウザの主機能は、選ばれたWebリソースをサーバに要求し、ブラウザウィンドウに表示して提示すること。リソースは通常HTML文書だが、PDF、画像、その他の種類のコンテンツでもよい。リソースの場所はユーザが **URI（Uniform Resource Identifier）** で指定する。

ブラウザがHTMLファイルをどう解釈・表示するかは HTML および CSS の仕様で規定される。これらの仕様は Webの標準化団体である **W3C（World Wide Web Consortium）** が保守している。長年ブラウザは仕様の一部にしか準拠せず独自拡張を開発したため、Web著者に深刻な互換性問題を引き起こした。今日ではほとんどのブラウザが多かれ少なかれ仕様に準拠している。

ブラウザのUIは互いに多くの共通点を持つ。共通UI要素は:

1. URIを入力するアドレスバー
2. 戻る／進むボタン
3. ブックマーク機能
4. 現在の文書の読み込みを更新・停止するリフレッシュ／ストップボタン
5. ホームページへ移動するホームボタン

**奇妙なことに、ブラウザのUIはいかなる公式仕様でも規定されていない。**長年の経験で形成されたグッドプラクティスと、ブラウザ同士の模倣から生まれたものにすぎない。HTML5仕様はブラウザが持つべきUI要素を定義していないが、いくつかの共通要素（アドレスバー、ステータスバー、ツールバーなど）を列挙している。もちろん Firefox のダウンロードマネージャのように特定ブラウザ固有の機能もある。

### The browser's high level structure（ブラウザの高レベル構造）（出典: 同上）

ブラウザの主要コンポーネント（原典ではここに出典注記 **(1.1)** = Resources 1.1 = Grosskurth, Alan「A Reference Architecture for Web Browsers」）:

| # | コンポーネント | 責務 |
| --- | --- | --- |
| 1 | **The user interface（ユーザインタフェース）** | アドレスバー、戻る／進むボタン、ブックマークメニュー等。**要求されたページが見えるウィンドウを除く、ブラウザ表示のすべての部分** |
| 2 | **The browser engine（ブラウザエンジン）** | UIとレンダリングエンジンの間でアクションを取り次ぐ（marshal する） |
| 3 | **The rendering engine（レンダリングエンジン）** | 要求されたコンテンツの表示に責任を持つ。たとえば要求されたコンテンツがHTMLなら、HTMLとCSSをパースし、パース済みコンテンツを画面に表示する |
| 4 | **Networking（ネットワーキング）** | HTTPリクエスト等のネットワーク呼び出し。プラットフォーム非依存のインタフェースの背後に、プラットフォームごとに異なる実装を持つ |
| 5 | **UI backend（UIバックエンド）** | コンボボックスやウィンドウなどの基本ウィジェットの描画に使う。プラットフォーム非依存の汎用インタフェースを公開し、内部ではOSのユーザインタフェースメソッドを使う |
| 6 | **JavaScript interpreter（JavaScriptインタプリタ）** | JavaScriptコードのパースと実行に使う |
| 7 | **Data storage（データストレージ）** | 永続化層。ブラウザはクッキーなど各種データをローカルに保存する必要がある。localStorage, IndexedDB, WebSQL, FileSystem といったストレージ機構もサポートする |

（図: Figure : Browser components / 原典 "Browser main components"）

**重要な注記:** Chrome のようなブラウザは**レンダリングエンジンのインスタンスを複数実行する ― タブごとに1つ。各タブは別プロセスで動く。**（原典では「Chrome は他の多くのブラウザと違って」と Chrome 固有の特徴として書かれている）

〔補足（一般知識）〕この「タブごとに別プロセス」がのちの Site Isolation（サイト単位のプロセス分離）の土台になり、クライアントサイドの攻撃面（同一プロセスに載るオリジンの組み合わせ）を考える際の前提になる。原典にはSite Isolationの記述はない。

### The rendering engine（レンダリングエンジン）（出典: 同上）

レンダリングエンジンの責務は、まあ…レンダリング、すなわち要求されたコンテンツをブラウザ画面に表示すること。

デフォルトでレンダリングエンジンは **HTML文書、XML文書、画像**を表示できる。プラグインや拡張を介して他の種類のデータも表示できる（例: PDFビューアプラグインでPDF文書を表示）。ただし本章では主要ユースケース、すなわち **CSSで整形されたHTMLと画像の表示**に焦点を当てる。

### Rendering engines（各ブラウザのレンダリングエンジン）（出典: 同上）

現行版: ブラウザによって使うレンダリングエンジンが異なる。**Internet Explorer は Trident、Firefox は Gecko、Safari は WebKit。Chrome と Opera（バージョン15以降）は Blink（WebKitのfork）を使う。**

WebKit はオープンソースのレンダリングエンジンで、Linuxプラットフォーム用のエンジンとして始まり、Apple が Mac と Windows をサポートするよう改変した。詳細は [webkit.org](http://webkit.org/)。

（原典2011年版: 「参照ブラウザである Firefox, Chrome, Safari は2つのレンダリングエンジンの上に構築されている。Firefox は Gecko ― Mozilla の "home made"（自家製）レンダリングエンジンを使う。Safari と Chrome はどちらも Webkit を使う」）

### The main flow（メインフロー）（出典: 同上）

レンダリングエンジンは、要求された文書のコンテンツをネットワーキング層から取得し始める。これは通常 **8kB チャンク**（原典では 8K チャンク）で行われる。

その後の基本フロー（Figure : Rendering engine basic flow）:

1. レンダリングエンジンは**HTML文書のパース**を開始し、要素を **DOMノード**に変換して **"content tree"** と呼ばれるツリーを作る。
2. エンジンは**スタイルデータをパース**する。外部CSSファイル内のものと style 要素内のものの両方。
3. スタイル情報と、HTML内の視覚的指示（visual instructions）を合わせて、**もう1つのツリー ― render tree** を作る。
4. render tree は**色や寸法といった視覚属性を持つ矩形**を含む。矩形は画面に表示される正しい順序で並んでいる。
5. render tree 構築後、**"layout" プロセス**を通る。これは各ノードに、画面上に現れるべき正確な座標を与えることを意味する。
6. 次の段階が **painting** ― render tree を走査し、各ノードを **UIバックエンド層**を使って描画する。

**これが段階的（gradual）プロセスであることを理解するのが重要。**より良いユーザ体験のために、レンダリングエンジンはできるだけ早くコンテンツを画面に表示しようとする。**render tree の構築とレイアウトを始める前に全HTMLがパースされるのを待たない。**コンテンツの一部がパース・表示され、その間もネットワークから届き続ける残りのコンテンツの処理が進む。

#### Main flow examples（WebKit と Gecko のフロー用語対応）（出典: 同上）

図3（WebKit main flow）と図4（Mozilla's Gecko rendering engine main flow）からわかるように、WebKit と Gecko はやや異なる用語を使うが、**フローは基本的に同じ**。

| 概念 | WebKit | Gecko (Firefox) |
| --- | --- | --- |
| 視覚整形された要素のツリー | **Render Tree** | **Frame tree** |
| ツリーの構成要素 | **Render Objects**（renderer / render object） | **frame**（各要素が1つのframe） |
| 要素の配置処理 | **layout** | **Reflow** |
| DOMノードと視覚情報を結びつけて render tree を作る処理 | **Attachment**（attach） | （FrameConstructor によるframe生成） |
| HTMLとDOMツリーの間の追加レイヤ | なし | **"content sink"**（DOM要素を作るファクトリ。非意味的な小さな差異） |

### Parsing - general（パース ― 一般論）（出典: 同上）

パースはレンダリングエンジン内で非常に重要なプロセスなので、少し深く立ち入る。

**文書をパースするとは、コードが使える構造に翻訳することを意味する。**パースの結果は通常、文書の構造を表すノードのツリーで、これを **parse tree（パースツリー）** または **syntax tree（構文木）** と呼ぶ。

たとえば式 `2 + 3 - 1` をパースすると、（図5のような）ツリーが返る。

#### Grammars（文法）（出典: 同上）

パースは、文書が従う構文規則 ― 書かれている言語やフォーマット ― に基づく。**パースできるすべてのフォーマットは、語彙（vocabulary）と構文規則（syntax rules）からなる決定的な文法を持たなければならない。これを文脈自由文法（context free grammar）と呼ぶ。人間の言語はそのような言語ではないので、従来のパース技法ではパースできない。**

#### Parser - Lexer combination（パーサとレクサの組み合わせ）（出典: 同上）

パースは2つのサブプロセスに分けられる: **字句解析（lexical analysis）** と **構文解析（syntax analysis）**。

- **字句解析**は入力を**トークン**に分割するプロセス。トークンは言語の語彙 ― 有効な構成要素の集合。人間の言語ならその言語の辞書に載っている全単語に相当する。
- **構文解析**は言語の構文規則を適用すること。

パーサは通常、仕事を2つのコンポーネントに分ける:

- **lexer（レクサ、tokenizer とも呼ばれる）**: 入力を有効なトークンに分割する責任を持つ。
- **parser（パーサ）**: 言語の構文規則に従って文書構造を解析し、パースツリーを構築する責任を持つ。

**レクサは空白や改行のような無関係な文字を取り除く方法を知っている。**

（図: from source document to parse trees ― source document → lexer → parser → parse tree）

パースのプロセスは**反復的（iterative）**。パーサは通常レクサに新しいトークンを要求し、そのトークンを構文規則のどれかにマッチさせようとする。規則がマッチしたら、トークンに対応するノードがパースツリーに追加され、パーサは次のトークンを要求する。

規則がマッチしない場合、パーサはトークンを内部に保存し、内部に保存した全トークンにマッチする規則が見つかるまでトークンを要求し続ける。規則が見つからなければ**パーサは例外を投げる**。これは文書が妥当でなく構文エラーを含んでいたことを意味する。

#### Translation（翻訳）（出典: 同上）

多くの場合パースツリーは最終成果物ではない。パースはしばしば**翻訳（translation）** ― 入力文書を別のフォーマットに変換すること ― に使われる。例はコンパイル。ソースコードを機械語にコンパイルするコンパイラは、まずソースをパースツリーにパースし、次にそのツリーを機械語文書に翻訳する。

（図: compilation flow ― source code → parsing → parse tree → translation → machine code）

#### Parsing example（パースの例 ― 玩具の数式言語）（出典: 同上）

図5では数式からパースツリーを作った。単純な数式言語を定義してパース過程を見る。

キーターム: **この言語は整数、プラス記号、マイナス記号を含むことができる。**

構文（Syntax）:

1. この言語の構文の構成要素は **expression（式）、term（項）、operation（演算）**。
2. この言語は任意個の expression を含むことができる。
3. **expression** は「term の後に operation が続き、その後にもう1つの term が続く」ものとして定義される。
4. **operation** はプラストークンまたはマイナストークン。
5. **term** は整数トークンまたは expression。

入力 `2 + 3 - 1` を解析する:

- 規則にマッチする最初の部分文字列は `2`。規則#5により、これは term。
- 2番目のマッチは `2 + 3`。これは3番目の規則にマッチする（term の後に operation、その後にもう1つの term）。
- 次のマッチは入力の末尾でしかヒットしない。`2 + 3 - 1` は expression である。なぜなら `2 + 3` が term であることを既に知っているので、term + operation + term になっている。
- `2 + +` はどの規則にもマッチしないので**不正な入力**。

#### Formal definitions for vocabulary and syntax（語彙と構文の形式的定義）（出典: 同上）

語彙は通常**正規表現**で表現される。

##### コード/コマンド（原文のまま逐語）

```js
INTEGER: 0|[1-9][0-9]*
PLUS: +
MINUS: -
```

見てのとおり整数は正規表現で定義されている。

構文は通常 **BNF（Backus–Naur Form）** というフォーマットで定義される。この言語は次のように定義される。

```js
expression :=  term  operation  term
operation :=  PLUS | MINUS
term := INTEGER | expression
```

文法が文脈自由文法であれば通常のパーサでパースできると述べた。**文脈自由文法の直感的な定義は「BNFで完全に表現できる文法」である。**形式的定義は Wikipedia の Context-free grammar の記事を参照。

#### Types of parsers（パーサの種類）（出典: 同上）

パーサには2種類ある: **top down parser（下降型）** と **bottom up parser（上昇型）**。

- 直感的な説明: **top down パーサ**は構文の高レベル構造を調べ、規則のマッチを見つけようとする。
- **bottom up パーサ**は入力から始めて、低レベルの規則から高レベルの規則に到達するまで、段階的に構文規則へ変換していく。

例に対する動作:

- **top down パーサ**はより高レベルな規則から始める。`2 + 3` を expression と識別し、次に `2 + 3 - 1` を expression と識別する（expression を識別するプロセスは他の規則をマッチさせながら進化するが、**出発点は最高レベルの規則**）。
- **bottom up パーサ**は規則がマッチするまで入力をスキャンし、マッチした入力を規則で置き換える。これを入力の末尾まで続ける。部分的にマッチした expression は**パーサのスタック**に置かれる。

##### 表（原文のまま逐語）: bottom up パーサのスタック遷移

| Stack | Input |
| --- | --- |
| （空） | 2 + 3 - 1 |
| term | + 3 - 1 |
| term operation | 3 - 1 |
| expression | - 1 |
| expression operation | 1 |
| expression | - |

この種の bottom up パーサは **shift-reduce parser（シフト還元パーサ）** と呼ばれる。入力が右へシフトされ（ポインタが入力の先頭を指し、右へ動いていくイメージ）、段階的に構文規則へ還元（reduce）されるため。

#### Generating parsers automatically（パーサの自動生成）（出典: 同上）

パーサを生成できるツールがある。言語の文法 ― 語彙と構文規則 ― を与えると、動作するパーサを生成してくれる。パーサを作るにはパースの深い理解が必要で、最適化されたパーサを手で作るのは容易でないため、**パーサジェネレータ**は非常に有用。

**WebKit は2つのよく知られたパーサジェネレータを使う: レクサ生成に [Flex](http://en.wikipedia.org/wiki/Flex_lexical_analyser)、パーサ生成に [Bison](http://www.gnu.org/software/bison/)**（Lex と Yacc という名前で出会うこともある）。

- **Flex の入力**は、トークンの正規表現定義を含むファイル。
- **Bison の入力**は、BNF形式の言語構文規則。

---

### HTML Parser（HTMLパーサ）（出典: 同上）

HTMLパーサの仕事は、HTMLマークアップをパースツリーにパースすること。

#### The HTML grammar definition（HTML文法の定義）（出典: 同上）

HTMLの語彙と構文は W3C が作成した仕様で定義されている。

#### Not a context free grammar（文脈自由文法ではない）★重要（出典: 同上）

パース入門で見たように、文法の構文は BNF のようなフォーマットで形式的に定義できる。

**残念ながら従来のパーサの話題はHTMLには当てはまらない**（面白半分で持ち出したのではない ― CSS と JavaScript のパースで使う）。**HTMLは、パーサが必要とする文脈自由文法では簡単に定義できない。**

HTMLを定義する形式的フォーマットは存在する ― **DTD（Document Type Definition）** ― が、**これは文脈自由文法ではない**。

一見奇妙に思える。HTMLはXMLにかなり近い。利用可能なXMLパーサはたくさんある。HTMLのXML版 ― **XHTML** ― もある。では大きな違いは何か。

**違いはHTMLのアプローチがより「寛容（forgiving）」なこと**: 特定のタグの省略を許し（省略されたタグは暗黙に追加される）、開始タグや終了タグの省略を許すことがある、等。全体として、XMLの硬直的で要求の厳しい構文に対して、HTMLは「柔らかい（soft）」構文である。

**この一見小さな差異が世界ほどの違いを生む。**一方でこれがHTMLがこれほど普及した主な理由 ― あなたのミスを許し、Web著者の人生を楽にする。他方で形式的文法を書くことを困難にする。**まとめると、HTMLはその文法が文脈自由でないため従来のパーサでは簡単にパースできない。HTMLはXMLパーサではパースできない。**

〔補足（一般知識）〕この「エラー寛容性」と「形式文法で書けない」という性質は、クライアントサイド脆弱性ハンティングにおいて決定的に重要。**サニタイザ／WAF／テンプレートエンジンが持つHTMLパース実装と、ブラウザの実装との差（パーサ差異, parser differential）**が、mutation XSS（mXSS）やフィルタバイパスの根本原因になる。原典はこの含意を述べていないが、教科書では ch01 の技術的土台としてここに接続するとよい。

#### HTML DTD（出典: 同上）

HTMLの定義はDTDフォーマットで書かれている。このフォーマットは **SGML** ファミリの言語を定義するために使われる。フォーマットは**許容される全要素、その属性、階層**の定義を含む。既に見たように、HTML DTD は文脈自由文法を形成しない。

DTDにはいくつかのバリエーションがある。**strict モード**は仕様にのみ準拠するが、他のモードは過去にブラウザで使われたマークアップのサポートを含む。目的は古いコンテンツとの後方互換性。

現行の strict DTD: [www.w3.org/TR/html4/strict.dtd](http://www.w3.org/TR/html4/strict.dtd)

#### DOM（出典: 同上）

出力ツリー（"parse tree"）は **DOM要素ノードと属性ノードのツリー**。DOM は **Document Object Model** の略。HTML文書のオブジェクト表現であり、**JavaScript のような外部世界に対するHTML要素のインタフェース**。

ツリーのルートは **"Document"** オブジェクト。

**DOMはマークアップとほぼ1対1の関係を持つ。**例:

##### コード/コマンド（原文のまま逐語）

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

このマークアップは（図: DOM tree of the example markup のような）DOMツリーに変換される。

HTMLと同様、DOMもW3Cが規定している。[www.w3.org/DOM/DOMTR](http://www.w3.org/DOM/DOMTR) を参照。**これは文書を操作するための汎用仕様**であり、特定のモジュールがHTML固有の要素を記述する。HTMLの定義は [www.w3.org/TR/2003/REC-DOM-Level-2-HTML-20030109/idl-definitions.html](http://www.w3.org/TR/2003/REC-DOM-Level-2-HTML-20030109/idl-definitions.html) にある。

「ツリーがDOMノードを含む」と言うとき、意味しているのは**ツリーがDOMインタフェースの1つを実装する要素で構成されている**ということ。**ブラウザはブラウザが内部的に使う他の属性を持つ具体的な実装を使う。**

#### The parsing algorithm（パースアルゴリズム）★重要（出典: 同上）

前節で見たように、**HTMLは通常の top down パーサや bottom up パーサではパースできない。**

理由は:

1. **言語の寛容な性質（The forgiving nature of the language）。**
2. **ブラウザが、よく知られた不正HTMLのケースをサポートするための伝統的なエラー寛容性を持っていること。**
3. **パースプロセスが再入可能（reentrant）であること。**他の言語ではパース中にソースは変わらないが、HTMLでは動的コード（`document.write()` 呼び出しを含む script 要素など）が余分なトークンを追加できるため、**パースプロセスが実際に入力を書き換える**。

通常のパース技法が使えないため、**ブラウザはHTMLをパースするためのカスタムパーサを作る**。

パースアルゴリズムは HTML5 仕様で詳細に記述されている（`http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html`）。**アルゴリズムは2つの段階からなる: tokenization（トークン化）と tree construction（ツリー構築）。**

- **Tokenization は字句解析**で、入力をトークンにパースする。HTMLトークンには **開始タグ（start tags）、終了タグ（end tags）、属性名（attribute names）、属性値（attribute values）** がある。
- **tokenizer はトークンを認識し、それを tree constructor に渡し、次のトークンを認識するために次の文字を消費する**。これを入力の末尾まで続ける。

（図: HTML parsing flow (taken from HTML5 spec) ― Network → Byte stream → Tokeniser → Tree construction → DOM、および script execution / document.write によるフィードバックループ）

#### The tokenization algorithm（トークン化アルゴリズム）★重要（出典: 同上）

アルゴリズムの出力はHTMLトークン。**アルゴリズムは状態機械（state machine）として表現される。各状態は入力ストリームの1文字以上を消費し、その文字に応じて次の状態を更新する。**

**判断は「現在のトークン化状態」と「tree construction の状態」の両方に影響される。**これは、**同じ消費文字が、現在の状態によって、正しい次の状態として異なる結果をもたらす**ことを意味する。

アルゴリズムは完全に記述するには複雑すぎるので、原理を理解する助けとなる単純な例を見る。

基本例 ― 次のHTMLをトークン化する:

##### コード/コマンド（原文のまま逐語）

```html
<html>
  <body>
    Hello world
  </body>
</html>
```

状態遷移の逐語的な流れ:

1. 初期状態は **"Data state"**。
2. `<` 文字に遭遇すると、状態は **"Tag open state"** に変わる。
3. `a-z` の文字を消費すると **"Start tag token"** が作られ、状態は **"Tag name state"** に変わる。
4. `>` 文字が消費されるまでこの状態に留まる。**各文字は新しいトークンの名前に追加される。**この例で作られるトークンは `html` トークン。
5. `>` タグに達すると**現在のトークンが emit（発行）され、状態は "Data state" に戻る**。
6. `<body>` タグも同じ手順で扱われる。ここまでで `html` と `body` タグが emit された。今は **"Data state"** に戻っている。
7. `Hello world` の `H` 文字を消費すると**文字トークン（character token）が作られて emit** され、これが `</body>` の `<` に達するまで続く。**`Hello world` の各文字に対して文字トークンを1つ emit する。**
8. 今また **"Tag open state"** に戻っている。次の入力 `/` を消費すると **`end tag token`** が作られ、**"Tag name state"** に移る。再び `>` に達するまでこの状態に留まる。その後、新しいタグトークンが emit され、**"Data state"** に戻る。
9. `</html>` 入力も前のケースと同様に扱われる。

（図: Tokenizing the example input）

〔補足（一般知識）〕教科書では、この「状態機械であり、同じ文字が状態によって違う意味になる」という性質が、なぜ `<textarea>`／`<title>`（RCDATA）、`<script>`／`<style>`（RAWTEXT）、コメント、foreign content（SVG/MathML）の各文脈でエスケープ規則が違うのか、そしてなぜ「文脈を跨いだ再パース」が mXSS を生むのかの説明根拠になる。原典は個々のstate名をこの例の範囲（Data state / Tag open state / Tag name state）しか列挙していない。

#### Tree construction algorithm（ツリー構築アルゴリズム）★重要（出典: 同上）

**パーサが作られたとき Document オブジェクトが作られる。**tree construction 段階では、**ルートに Document を持つDOMツリーが変更され、要素が追加されていく。**

- **tokenizer が emit した各ノードは tree constructor によって処理される。**
- **各トークンについて、仕様がそれに関連するDOM要素を定義しており、そのトークンのためにその要素が作られる。**
- 要素はDOMツリーに追加され、**同時に「open elements のスタック（stack of open elements）」にも追加される。**
- **このスタックは、ネストの不一致（nesting mismatches）と閉じられていないタグ（unclosed tags）を修正するために使われる。**
- **アルゴリズムもまた状態機械として記述される。状態は "insertion modes"（挿入モード）と呼ばれる。**

例の入力に対する tree construction プロセス:

##### コード/コマンド（原文のまま逐語）

```html
<html>
  <body>
    Hello world
  </body>
</html>
```

insertion mode の遷移（逐語的な流れ）:

1. tree construction 段階への入力は、tokenization 段階からのトークン列。
2. 最初のモードは **"initial mode"**。"html" トークンを受け取ると **"before html"** モードへ移り、**そのモードでトークンを再処理（reprocessing）** する。これにより **HTMLHtmlElement** 要素が作られ、ルートの Document オブジェクトに追加される。
3. 状態は **"before head"** に変わる。次に "body" トークンを受け取る。**"head" トークンが無いにもかかわらず HTMLHeadElement が暗黙に作られ**、ツリーに追加される。
4. ここで **"in head"** モードへ移り、次に **"after head"** へ移る。body トークンが再処理され、**HTMLBodyElement** が作られて挿入され、モードは **"in body"** へ移る。
5. "Hello world" 文字列の文字トークンが受け取られる。**最初の1つが "Text" ノードの作成と挿入を引き起こし、残りの文字はそのノードに追加される。**
6. body 終了トークンの受信により **"after body"** モードへ移る。
7. 次に html 終了タグを受け取り、**"after after body"** モードへ移る。
8. **end of file トークンの受信でパースが終了する。**

（図: tree construction of example html）

**insertion mode 一覧（この記事が本文で明示的に挙げているもの）:** initial mode / before html / before head / in head / after head / in body / after body / after after body

#### Actions when the parsing is finished（パース完了時の動作）（出典: 同上）

この段階でブラウザは:

1. **文書を "interactive" とマークする**。
2. **"deferred" モードのスクリプト（文書のパース後に実行されるべきもの）のパースを開始する。**
3. その後**文書の状態が "complete" に設定され**、
4. **"load" イベントが発火する。**

tokenization と tree construction の完全なアルゴリズムは HTML5 仕様（`http://www.w3.org/TR/html5/syntax.html#html-parser`）で見られる。

#### Browsers' error tolerance（ブラウザのエラー寛容性）★重要（出典: 同上）

**HTMLページで "Invalid Syntax" エラーを受け取ることは絶対にない。ブラウザは不正なコンテンツをすべて修正して先へ進む。**

例:

##### コード/コマンド（原文のまま逐語）

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

「私は100万個くらいの規則に違反したはずだ（"mytag" は標準タグでない、"p" と "div" 要素のネストが間違っている、他にも）。それでもブラウザは正しく表示し、文句を言わない。**つまりパーサのコードの多くは、HTML著者のミスを修正することに費たされている。**」

**エラー処理はブラウザ間でかなり一貫しているが、驚くべきことにHTML仕様の一部になってこなかった。**ブックマークや戻る／進むボタンと同様、長年にわたってブラウザで発達したものにすぎない。**多くのサイトで繰り返される既知の不正HTML構文があり、ブラウザは他のブラウザと整合する形でそれらを修正しようとする。**

HTML5仕様はこれらの要件の一部を定義している。（**WebKit はこれをHTMLパーサクラスの冒頭のコメントで見事に要約している。**）

WebKitのコメント（引用、逐語的内容）:

> パーサはトークン化された入力を document にパースし、document tree を構築していく。文書が well-formed なら、パースは素直である。
>
> 残念ながら、well-formed でないHTML文書を多数扱わなければならないので、パーサはエラーに対して寛容でなければならない。
>
> 少なくとも以下のエラー条件に対処しなければならない:
>
> 1. 追加される要素が、ある外側のタグの内部で明示的に禁止されている。この場合、**その要素を禁止しているタグまですべてのタグを閉じ、その後に要素を追加する**。
> 2. その要素を直接追加することが許されていない。文書を書いた人が間にあるタグを忘れた（あるいは間のタグが省略可能）のかもしれない。次のタグでこれが起こりうる: **HTML HEAD BODY TBODY TR TD LI**（他に忘れたものは?）。
> 3. **インライン要素の内部にブロック要素を追加したい。次の上位のブロック要素まですべてのインライン要素を閉じる。**
> 4. **それでも解決しない場合、要素を追加できるようになるまで要素を閉じる ― あるいはタグを無視する。**

WebKit のエラー寛容性の実例:

##### `</br>` instead of `<br>`（`<br>` の代わりの `</br>`）（出典: 同上）

一部のサイトは `<br>` の代わりに `</br>` を使う。**IE と Firefox と互換にするため、WebKit はこれを `<br>` のように扱う。**

コード（原文のまま逐語）:

```js
if (t->isCloseTag(brTag) && m_document->inCompatMode()) {
     reportError(MalformedBRError);
     t->beginTag = true;
}
```

**注意: このエラー処理は内部的なもので、ユーザには提示されない。**

##### A stray table（はぐれテーブル）（出典: 同上）

stray table とは、**テーブルセルの内部ではなく、別のテーブルの内部にあるテーブル**。

例（原文のまま逐語）:

```html
<table>
  <table>
    <tr><td>inner table</td></tr>
  </table>
  <tr><td>outer table</td></tr>
</table>
```

**WebKit は階層を2つの兄弟テーブルに変更する**（原文のまま逐語）:

```html
<table>
  <tr><td>outer table</td></tr>
</table>
<table>
  <tr><td>inner table</td></tr>
</table>
```

コード（原文のまま逐語）:

```js
if (m_inStrayTableContent && localName == tableTag)
        popBlock(tableTag);
```

**WebKit は現在の要素コンテンツ用のスタックを使う。**内側のテーブルを外側のテーブルのスタックから pop する。これでテーブル同士は兄弟になる。

〔補足（一般知識）〕この「階層が入れ替わる」種類の正規化（foster parenting 的挙動）は、サニタイザがHTMLをパース→直列化→ブラウザが再パースする際に構造が変化する典型例であり、mXSSの主要な発生経路の1つとして教科書で扱う価値がある。原典は互換性の文脈のみで述べている。

##### Nested form elements（入れ子の form 要素）（出典: 同上）

ユーザが form の中に別の form を置いた場合、**2番目の form は無視される。**

コード（原文のまま逐語）:

```js
if (!m_currentFormElement) {
        m_currentFormElement = new HTMLFormElement(formTag,    m_document);
}
```

〔補足（一般知識）〕「内側の form が無視される」という挙動は、フォーム構造を前提にした防御（CSRFトークンの配置など）の解析時に重要になる。原典はセキュリティ的含意を述べていない。

##### A too deep tag hierarchy（深すぎるタグ階層）（出典: 同上）

「コメントが自ら語っている」(The comment speaks for itself.)

WebKitのコメント（引用、逐語的内容）:

> `www.liceo.edu.mx` は、大量の `<b>` だけで約 **1500 タグ**のネストレベルを達成しているサイトの例である。
> **同じ型のネストしたタグは最大 20 個までしか許さず**、それを超えたら全部まとめて無視する。

コード（原文のまま逐語）:

```js
bool HTMLParser::allowNestedRedundantTag(const AtomicString& tagName)
{

unsigned i = 0;
for (HTMLStackElem* curr = m_blockStack;
         i < cMaxRedundantTagDepth && curr && curr->tagName == tagName;
     curr = curr->next, i++) { }
return i != cMaxRedundantTagDepth;
}
```

**数値: ネストレベル約1500（実例サイト）、同型タグの許容ネスト上限 20（`cMaxRedundantTagDepth`）。**

##### Misplaced html or body end tags（誤った位置の html / body 終了タグ）（出典: 同上）

「再び ― コメントが自ら語っている」

WebKitのコメント（引用、逐語的内容）:

> 本当に壊れたHTMLのサポート。
> **body タグは決して閉じない。**一部の愚かなWebページが、文書の実際の終わりより前に body を閉じてしまうからだ。
> 物事を閉じるのは `end()` 呼び出しに任せよう。

コード（原文のまま逐語）:

```js
if (t->tagName == htmlTag || t->tagName == bodyTag )
        return;
```

締めの一文: 「**だからWeb著者は気をつけて ― WebKitのエラー寛容性コードのスニペットに実例として登場したくないなら、well-formed なHTMLを書こう。**」

---

### CSS parsing（CSSのパース）（出典: 同上）

序論のパースの概念を思い出してほしい。**HTMLと違い、CSSは文脈自由文法であり、序論で説明した種類のパーサでパースできる。**実際、CSS仕様はCSSの字句文法と構文文法を定義している（`http://www.w3.org/TR/CSS2/grammar.html`）。

字句文法（語彙）は各トークンの正規表現で定義される。

##### コード/コマンド（原文のまま逐語）: CSS字句文法

```markup
comment   \/\*[^*]*\*+([^/*][^*]*\*+)*\/
num       [0-9]+|[0-9]*"."[0-9]+
nonascii  [\200-\377]
nmstart   [_a-z]|{nonascii}|{escape}
nmchar    [_a-z0-9-]|{nonascii}|{escape}
name      {nmchar}+
ident     {nmstart}{nmchar}*
```

- **"ident" は identifier の略で、クラス名のようなもの。**
- **"name" は要素の id（"#" で参照されるもの）。**

構文文法はBNFで記述される。

##### コード/コマンド（原文のまま逐語）: CSS構文文法（BNF）

```css
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

説明: ruleset は次の構造。

```css
div.error, a.error {
  color:red;
  font-weight:bold;
}
```

`div.error` と `a.error` はセレクタ。波括弧の内側は、この ruleset によって適用される規則を含む。この構造は次の定義で形式化される。

```css
ruleset
  : selector [ ',' S* selector ]*
    '{' S* declaration [ ';' S* declaration ]* '}' S*
  ;
```

これは「**ruleset は1つのセレクタ、または任意でカンマと空白で区切られた複数のセレクタである（S は空白を表す）。ruleset は波括弧を含み、その内側に1つの declaration、または任意でセミコロンで区切られた複数の declaration を含む**」ことを意味する。"declaration" と "selector" は続くBNF定義で定義される。

#### WebKit CSS parser（出典: 同上）

- **WebKit は Flex と Bison のパーサジェネレータを使い、CSS文法ファイルからパーサを自動生成する。**パーサ入門で思い出したように、**Bison は bottom up の shift-reduce パーサを作る。**
- **Firefox は手書きの top down パーサを使う。**
- **どちらの場合も、各CSSファイルは StyleSheet オブジェクトにパースされる。**各オブジェクトはCSS rule を含む。**CSS rule オブジェクトはセレクタオブジェクトと declaration オブジェクト、およびCSS文法に対応する他のオブジェクトを含む。**

（図: parsing CSS）

---

### The order of processing scripts and style sheets（スクリプトとスタイルシートの処理順序）★重要（出典: 同上）

#### Scripts（スクリプト）（出典: 同上）

- **Webのモデルは同期的（synchronous）。**著者はパーサが `<script>` タグに達したとき、スクリプトが即座にパース・実行されることを期待する。
- **スクリプトが実行されるまで文書のパースは停止（halt）する。**
- **スクリプトが外部にある場合、まずリソースをネットワークから取得しなければならない。これも同期的に行われ、リソースが取得されるまでパースは停止する。**
- これは長年のモデルであり、**HTML4 と HTML5 の仕様でも規定されている。**
- 著者はスクリプトに **"defer" 属性**を追加できる。その場合、文書のパースを停止せず、**文書がパースされた後に実行される。**
- **HTML5 はスクリプトを非同期（asynchronous）としてマークするオプションを追加し、別スレッドでパース・実行されるようにする。**

#### Speculative parsing（投機的パース）（出典: 同上）

**WebKit と Firefox の両方がこの最適化を行う。スクリプトを実行している間、別スレッドが文書の残りをパースし、ネットワークから読み込む必要がある他のリソースを見つけて読み込む。**こうしてリソースが並列コネクションで読み込まれ、全体の速度が向上する。

**注意: 投機的パーサは外部スクリプト・スタイルシート・画像といった外部リソースへの参照だけをパースする。DOMツリーは変更しない ― それはメインパーサに任される。**

#### Style sheets（スタイルシート）（出典: 同上）

スタイルシートは異なるモデルを持つ。概念的には、スタイルシートはDOMツリーを変えないので、それを待って文書のパースを止める理由はないように見える。**しかし、文書のパース段階中にスクリプトがスタイル情報を要求するという問題がある。スタイルがまだ読み込み・パースされていなければ、スクリプトは間違った答えを得ることになり、これが多くの問題を引き起こしたようだ。エッジケースのように見えるが、かなり一般的である。**

- **Firefox は、まだ読み込み・パース中のスタイルシートがあるとき、すべてのスクリプトをブロックする。**
- **WebKit は、スクリプトが未読み込みのスタイルシートに影響される可能性のある特定のスタイルプロパティにアクセスしようとしたときにだけブロックする。**

〔補足（一般知識）〕この「スクリプト実行がパースを止める／スタイルがスクリプトを止める」という同期関係は、レースを利用した攻撃（読み込み順の操作）や、パフォーマンス計測を使ったサイドチャネルの前提知識になる。原典はセキュリティ的含意を述べていない。

---

### Render tree construction（render tree の構築）★重要（出典: 同上）

**DOMツリーが構築されている間、ブラウザは別のツリー ― render tree を構築する。このツリーは、表示される順序に並んだ視覚要素のツリーであり、文書の視覚的表現である。このツリーの目的は、コンテンツを正しい順序で描画できるようにすること。**

- **Firefox は render tree の要素を "frames" と呼ぶ。WebKit は renderer または render object という用語を使う。**
- **renderer は自分自身と自分の子をレイアウトし描画する方法を知っている。**

WebKit の RenderObject クラス（renderer たちの基底クラス）の定義。

##### コード/コマンド（原文のまま逐語）

```js
class RenderObject{
  virtual void layout();
  virtual void paint(PaintInfo);
  virtual void rect repaintRect();
  Node* node;  //the DOM node
  RenderStyle* style;  // the computed style
  RenderLayer* containgLayer; //the containing z-index layer
}
```

（注: 原文のスペルのまま `containgLayer`。コメントも原文のまま ― `//the DOM node`, `// the computed style`, `//the containing z-index layer`）

**各 renderer は、通常はノードのCSSボックス（CSS2仕様が記述するもの）に対応する矩形領域を表す。幅・高さ・位置といった幾何情報を含む。**

**ボックスの型は、そのノードに関連する style 属性の "display" 値に影響される。**DOMノードに対してどの型の renderer を作るべきかを決める WebKit のコード。

##### コード/コマンド（原文のまま逐語）

```js
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

**要素の型も考慮される**: たとえばフォームコントロールやテーブルは特別な frame を持つ。

**WebKit では、ある要素が特別な renderer を作りたい場合、`createRenderer()` メソッドをオーバーライドする。renderer は非幾何的情報を含む style オブジェクトを指す。**

#### The render tree relation to the DOM tree（render tree と DOM tree の関係）★重要（出典: 同上）

**renderer は DOM 要素に対応するが、関係は1対1ではない。**

| 関係のパターン | 内容 |
| --- | --- |
| render tree に入らない | **非視覚的なDOM要素は render tree に挿入されない。**例は "head" 要素。また **display 値が "none" に割り当てられた要素もツリーに現れない**（一方 **visibility が "hidden" の要素はツリーに現れる**） |
| 1つのDOM要素 → 複数の視覚オブジェクト | 単一の矩形で記述できない複雑な構造を持つ要素。例: **"select" 要素は3つの renderer を持つ ― 表示領域用、ドロップダウンリストボックス用、ボタン用。**また**幅が1行に足りずテキストが複数行に分割されると、新しい行が余分な renderer として追加される** |
| 壊れたHTMLによる複数 renderer | **CSS仕様によれば、インライン要素はブロック要素のみ、またはインライン要素のみを含まなければならない。混在コンテンツの場合、インライン要素を包むために anonymous block renderer（無名ブロックレンダラ）が作られる。**（原文の記述は "an inline element must contain either only block elements or only inline elements"） |
| ツリー上の位置がDOMと違う | **一部の render object はDOMノードに対応するが、ツリー内の同じ場所にはない。float と絶対配置された要素は out of flow（フローの外）で、ツリーの別の部分に置かれ、実際のframeにマップされる。本来あるべき場所には placeholder frame（プレースホルダフレーム）が置かれる** |

（図の説明: The render tree and the corresponding DOM tree. **"Viewport" は initial containing block。WebKit では "RenderView" オブジェクトになる**）

#### The flow of constructing the tree（ツリー構築の流れ）（出典: 同上）

- **Firefox では、presentation が DOM 更新のリスナとして登録される。presentation は frame 生成を `FrameConstructor` に委譲し、constructor がスタイルを解決して frame を作る。**
- **WebKit では、スタイルを解決して renderer を作るプロセスを "attachment"（アタッチメント）と呼ぶ。すべてのDOMノードが "attach" メソッドを持つ。Attachment は同期的で、DOMツリーへのノード挿入が新しいノードの "attach" メソッドを呼ぶ。**

**html と body タグの処理により render tree のルートが構築される。ルートの render object は、CSS仕様が containing block と呼ぶもの ― 他のすべてのブロックを含む最上位のブロック ― に対応する。その寸法は viewport、すなわちブラウザウィンドウの表示領域の寸法。Firefox はこれを `ViewPortFrame`、WebKit は `RenderView` と呼ぶ。これが document が指す render object である。ツリーの残りはDOMノードの挿入として構築される。**

参照: CSS2 仕様の processing model（`http://www.w3.org/TR/CSS21/intro.html#processing-model`）

#### Style Computation（スタイル計算）★重要（出典: 同上）

**render tree の構築には、各 render object の視覚プロパティを計算する必要がある。これは各要素のスタイルプロパティを計算することで行われる。**

**スタイルには、さまざまな出自（origins）のスタイルシート、インラインstyle要素、HTML内の視覚プロパティ（"bgcolor" プロパティのようなもの）が含まれる。後者は対応するCSSスタイルプロパティに変換される。**

**スタイルシートの出自（origins）は:**

1. **ブラウザのデフォルトスタイルシート**
2. **ページ著者が提供するスタイルシート**
3. **ユーザスタイルシート** ― ブラウザのユーザが提供するスタイルシート（ブラウザは好みのスタイルを定義させてくれる。たとえばFirefoxでは "Firefox Profile" フォルダにスタイルシートを置くことで行う）

**スタイル計算は以下の困難をもたらす:**

1. **スタイルデータは非常に大きな構造で、多数のスタイルプロパティを保持するため、メモリの問題を引き起こしうる。**
2. **各要素にマッチする規則を見つけることは、最適化しないとパフォーマンス問題を引き起こしうる。**各要素について規則リスト全体を走査してマッチを探すのは重い作業。**セレクタは複雑な構造を持ちうるため、一見有望に見えたパスが無駄だと判明し、別のパスを試さなければならないことがある。**

   例 ― この複合セレクタ:

   ```css
   div div div div{
   ...
   }
   ```

   これは「3つのdivの子孫である `<div>`」に規則が適用されることを意味する。ある `<div>` 要素についてこの規則が適用されるか調べたいとする。チェックのためツリーを上に辿る特定のパスを選ぶ。**divが2つしかなく規則が適用されないと判明するためだけに、ノードツリーを上に辿る必要があるかもしれない。そうしたらツリーの別のパスを試す必要がある。**
3. **規則の適用には、規則の階層を定義するかなり複雑なカスケード規則が関わる。**

#### Sharing style data（スタイルデータの共有）★重要（出典: 同上）

**WebKit のノードは style オブジェクト（RenderStyle）を参照する。これらのオブジェクトは一定条件下でノード間で共有できる。ノードが兄弟（siblings）または「いとこ（cousins）」であり、かつ以下の条件をすべて満たす場合:**

| # | 共有条件（原文の10条件） |
| --- | --- |
| 1 | 要素は**同じマウス状態**でなければならない（例: 一方が `:hover` で他方がそうでない、は不可） |
| 2 | **どちらの要素も id を持たない**こと |
| 3 | **タグ名が一致する**こと |
| 4 | **class 属性が一致する**こと |
| 5 | **マップされた属性の集合が同一**であること |
| 6 | **リンク状態（link states）が一致する**こと |
| 7 | **フォーカス状態（focus states）が一致する**こと |
| 8 | **どちらの要素も属性セレクタの影響を受けない**こと。ここで「影響を受ける」とは「セレクタ内の任意の位置で属性セレクタを使うセレクタマッチを持つこと」と定義される |
| 9 | 要素に**インライン style 属性が存在しない**こと |
| 10 | **兄弟セレクタ（sibling selectors）が一切使われていない**こと。**WebCore は兄弟セレクタに遭遇すると単純にグローバルスイッチを投げ、それらが存在する間は文書全体でスタイル共有を無効化する。**これには `+` セレクタ、`:first-child` や `:last-child` のようなセレクタが含まれる |

#### Firefox rule tree（Firefoxのルールツリー）★重要（出典: 同上）

**Firefox はスタイル計算を容易にするため2つの追加ツリーを持つ: rule tree（ルールツリー）と style context tree（スタイルコンテキストツリー）。WebKit も style オブジェクトを持つが、style context tree のようなツリーには格納せず、DOMノードが関連するスタイルを指すだけ。**

（図: Firefox style context tree.）

**style context は end values（最終値）を含む。値は、マッチするすべての規則を正しい順序で適用し、論理値から具体値へ変換する操作を行って計算される。たとえば論理値が画面のパーセンテージなら、それが計算され絶対単位に変換される。**

**rule tree のアイデアは実に巧妙。これらの値をノード間で共有して再計算を避けられるようにする。これは空間も節約する。**

- **マッチしたすべての規則はツリーに格納される。パス上の下の方のノードがより高い優先度を持つ。**
- **ツリーは、見つかった規則マッチのすべてのパスを含む。**
- **規則の格納は遅延的（lazily）に行われる。ツリーは最初に全ノードについて計算されるのではなく、あるノードのスタイルを計算する必要が生じたときに、計算されたパスがツリーに追加される。**

**アイデアはツリーのパスを辞書（lexicon）の単語のように見ること。**すでにある rule tree（図: Computed rule tree ― A-B-E-I-L のパスを含む）を計算済みだとする。content tree の別の要素について規則をマッチさせる必要があり、マッチした規則（正しい順序で）が **B-E-I** だと判明したとする。**A-B-E-I-L のパスを既に計算済みなので、このパスはツリーに既に存在する。これで作業が減る。**

#### Division into structs（structs への分割）★重要（出典: 同上）

**style context は structs（構造体）に分割される。これらの structs は、border や color といった特定のカテゴリのスタイル情報を含む。1つの struct 内のすべてのプロパティは、継承される（inherited）か継承されない（non inherited）かのどちらかに揃っている。**

- **継承プロパティ（Inherited properties）**は、要素で定義されていなければ親から継承されるプロパティ。
- **非継承プロパティ（"reset" プロパティと呼ばれる）**は、定義されていなければデフォルト値を使う。

**ツリーは、（計算済みの end values を含む）struct 全体をツリー内にキャッシュすることで役立つ。アイデアは、下のノードが struct の定義を提供しなかった場合、上のノードのキャッシュされた struct を使えるということ。**

#### Computing the style contexts using the rule tree（rule tree を使った style context の計算）★重要（出典: 同上）

ある要素の style context を計算するとき:

1. **まず rule tree 内のパスを計算するか、既存のものを使う。**
2. **次にパス上の規則を適用して、新しい style context の structs を埋め始める。パスの最下ノード ― 最も優先度が高いもの（通常は最も詳細度の高いセレクタ） ― から始め、struct が埋まるまでツリーを上へ辿る。**
3. **その rule node に struct の指定がなければ、大きく最適化できる ― struct を完全に指定するノードが見つかるまでツリーを上へ行き、単にそれを指す。これが最良の最適化 ― struct 全体が共有される。これは end values の計算とメモリを節約する。**
4. **部分的な定義が見つかった場合は、struct が埋まるまでツリーを上へ行く。**
5. **struct の定義が全く見つからなかった場合、struct が "inherited" 型なら、context tree の親の struct を指す。この場合も struct の共有に成功したことになる。reset struct ならデフォルト値が使われる。**
6. **最も詳細なノードが値を追加する場合は、実際の値に変換するための追加計算が必要。その結果をツリーノードにキャッシュして子が使えるようにする。**
7. **ある要素が同じツリーノードを指す兄弟（sibling / brother）を持つ場合、style context 全体を両者で共有できる。**

##### 例（原文のまま逐語）: HTML

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

##### 例（原文のまま逐語）: CSS規則

```css
div {margin: 5px; color:black}
.err {color:red}
.big {margin-top:3px}
div span {margin-bottom:4px}
#div1 {color:blue}
#div2 {color:green}
```

**話を単純にするため、埋める必要があるのは2つの structs だけとする ― color struct と margin struct。color struct はメンバが1つ（color）だけ。margin struct は4辺を含む。**

結果の rule tree（図: The rule tree ― ノードは「参照する規則の番号」で名付けられる）と context tree（図: The context tree ― 「参照する rule node」で名付けられる）が示される。

**HTMLをパースして2番目の `<div>` タグに到達したとする。**

1. このノード用の style context を作り、その style structs を埋める必要がある。
2. **規則をマッチさせ、`<div>` にマッチする規則が 1, 2, 6 だと判明する。**これは、この要素が使えるパスがツリーに既に存在し、**規則6のためのノードを1つ追加するだけでよい（rule tree のノードF）**ことを意味する。
3. **style context を作り context tree に置く。新しい style context は rule tree のノードFを指す。**
4. **style structs を埋める。まず margin struct を埋める。最後の rule node（F）は margin struct に何も追加しないので、以前のノード挿入で計算されたキャッシュ済み struct が見つかるまでツリーを上へ辿れる。margin 規則を指定した最上位のノードであるノードBで見つかる。**
5. **color struct については定義があるので、キャッシュ済み struct は使えない。color は属性が1つなので、他の属性を埋めるためにツリーを上へ行く必要はない。end value を計算し（文字列をRGBに変換するなど）、計算済み struct をこのノードにキャッシュする。**
6. **2番目の `<span>` 要素の作業はさらに簡単。規則をマッチさせ、前の span と同様に規則G を指すという結論に達する。同じノードを指す兄弟があるので、style context 全体を共有し、前の span の context を指すだけでよい。**

**親から継承される規則を含む structs については、キャッシュは context tree 上で行われる（color プロパティは実際には継承されるが、Firefox は reset として扱い rule tree にキャッシュする）。**

たとえば段落にフォントの規則を追加したとする（原文のまま逐語）:

```css
p {font-family: Verdana; font size: 10px; font-weight: bold}
```

（注: 原文のまま `font size` と誤記されている ― 正しくは `font-size`）

**そうすると、context tree で div の子である段落要素は、親と同じ font struct を共有できたはずである。これは段落に font 規則が指定されていない場合の話。**

**rule tree を持たない WebKit では、マッチした declarations が4回走査される。**

| 順序 | 走査内容（原文のまま逐語的順序） |
| --- | --- |
| 1回目 | **non-important high priority properties**（他がそれに依存するため最初に適用すべきプロパティ。たとえば `display`） |
| 2回目 | **high priority important** |
| 3回目 | **normal priority non-important** |
| 4回目 | **normal priority important** |

**これは、複数回現れるプロパティが正しいカスケード順序に従って解決されることを意味する。最後が勝つ（The last wins）。**

**まとめ: style オブジェクトの共有（全体または内部のいくつかの structs）は課題1と課題3を解決する。Firefox の rule tree はプロパティを正しい順序で適用することにも役立つ。**

#### Manipulating the rules for an easy match（マッチを容易にするための規則の加工）★重要（出典: 同上）

スタイル規則の出所は複数ある:

| # | 出所 | 例（原文のまま逐語） |
| --- | --- | --- |
| 1 | **CSS rules**（外部スタイルシート内、または style 要素内） | ```p {color: blue}``` |
| 2 | **Inline style attributes** | ```<p style="color: blue" />``` |
| 3 | **HTML visual attributes**（関連するスタイル規則にマップされる） | ```<p bgcolor="blue" />``` |

**後の2つは要素に容易にマッチする。要素自身が style 属性を所有しており、HTML属性は要素をキーにしてマップできるため。**

**前述の課題#2にあるとおり、CSS規則のマッチングはより厄介。この困難を解決するため、規則はアクセスしやすいように加工される。**

**スタイルシートをパースした後、規則はセレクタに応じて複数のハッシュマップのいずれかに追加される。id によるマップ、class name によるマップ、tag name によるマップ、そしてそれらのカテゴリに収まらないもののための汎用マップがある。セレクタが id なら規則は id マップに追加され、class なら class マップに追加される、等。**

**この加工により規則のマッチが大幅に容易になる。すべての declaration を見る必要はなく、マップから要素に関連する規則を抽出できる。この最適化は規則の 95% 以上を除去し、マッチングプロセスで考慮する必要さえなくす（注記 (4.1)）。**

（〔補足（一般知識）〕原典の注記 `(4.1)` は記事末尾 Resources の 4. Webkit グループの 1番目、すなわち **David Hyatt「Implementing CSS (part 1)」** を指す。原典のTOC採番JSと Resources の入れ子リスト構造から導いた対応。）

例のスタイル規則（原文のまま逐語）:

```css
p.error {color: red}
#messageDiv {height: 50px}
div {margin: 5px}
```

**1番目の規則は class マップへ、2番目は id マップへ、3番目は tag マップへ挿入される。**

次のHTML断片（原文のまま逐語。原文の `id=" messageDiv"` の先頭空白もそのまま）:

```html
<p class="error">an error occurred</p>
<div id=" messageDiv">this is a message</div>
```

**まず p 要素の規則を探す。class マップは "error" キーを含み、その下に "p.error" の規則が見つかる。div 要素は id マップ（キーは id）と tag マップに関連する規則を持つ。だから残る作業は、キーで抽出された規則のうちどれが本当にマッチするかを見つけるだけ。**

たとえば div の規則が次だったとする（原文のまま逐語）:

```css
table div {margin: 5px}
```

**これは tag マップから依然として抽出される（キーは最右のセレクタ（the rightmost selector）だから）が、table の祖先を持たない我々の div にはマッチしない。**

**WebKit と Firefox の両方がこの加工を行う。**

#### Applying the rules in the correct cascade order（正しいカスケード順序での規則適用）（出典: 同上）

**style オブジェクトは、すべての視覚属性に対応するプロパティを持つ（全CSS属性だがより汎用的）。プロパティがマッチした規則のいずれによっても定義されていない場合、一部のプロパティは親要素の style オブジェクトから継承できる。他のプロパティはデフォルト値を持つ。**

**問題は定義が複数あるときに始まる ― ここでカスケード順序が問題を解決する。**

#### Style sheet cascade order（スタイルシートのカスケード順序）★重要（出典: 同上）

**あるスタイルプロパティの declaration は、複数のスタイルシートに現れることがあり、1つのスタイルシート内で複数回現れることもある。これは規則を適用する順序が非常に重要であることを意味する。これを "cascade" 順序と呼ぶ。**

**CSS2仕様によれば、カスケード順序は（低→高）:**

| 優先度 | declaration の種類 |
| --- | --- |
| 1（最低） | **Browser declarations**（ブラウザ宣言） |
| 2 | **User normal declarations**（ユーザの通常宣言） |
| 3 | **Author normal declarations**（著者の通常宣言） |
| 4 | **Author important declarations**（著者の important 宣言） |
| 5（最高） | **User important declarations**（ユーザの important 宣言） |

**ブラウザ宣言が最も重要度が低く、ユーザが著者を上書きできるのは宣言が important とマークされている場合だけ。**

**同じ順位の宣言は specificity（詳細度）でソートされ、その後に指定された順序でソートされる。**

**HTML の視覚属性は対応するCSS宣言に変換される。これらは低優先度の著者規則（author rules with low priority）として扱われる。**

#### Specificity（詳細度）★重要（出典: 同上）

セレクタの詳細度は CSS2仕様（`http://www.w3.org/TR/CSS2/cascade.html#specificity`）で以下のように定義される（原文のまま逐語的内容）:

1. **宣言がセレクタを持つ規則ではなく 'style' 属性由来なら 1 を数える。そうでなければ 0（= a）**
2. **セレクタ内の ID 属性の数を数える（= b）**
3. **セレクタ内の他の属性および擬似クラスの数を数える（= c）**
4. **セレクタ内の要素名および擬似要素の数を数える（= d）**

**4つの数 a-b-c-d を（大きな基数の数体系で）連結すると詳細度が得られる。**

**使うべき基数は、いずれかのカテゴリで持つ最大のカウントで決まる。**たとえば **a=14** なら16進基数を使える。**a=17** というありそうもないケースでは17桁の基数が必要になる。後者の状況は `html body div div p…`（セレクタに17個のタグ… あまりありそうにない）のようなセレクタで起こりうる。

##### コード/コマンド（原文のまま逐語）: 詳細度の例

```css
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

#### Sorting the rules（規則のソート）（出典: 同上）

**規則がマッチした後、カスケード規則に従ってソートされる。WebKit は小さいリストにはバブルソート、大きいリストにはマージソートを使う。WebKit は規則の ">" 演算子をオーバーライドしてソートを実装する。**

##### コード/コマンド（原文のまま逐語）

```css
static bool operator >(CSSRuleData& r1, CSSRuleData& r2)
{
    int spec1 = r1.selector()->specificity();
    int spec2 = r2.selector()->specificity();
    return (spec1 == spec2) : r1.position() > r2.position() : spec1 > spec2;
}
```

（注: 原文のまま。三項演算子の `?` が抜けている原文の誤植を含む。原文は ```css``` のコードフェンスでC++コードを囲んでいる）

#### Gradual process（段階的プロセス / FOUC対策）（出典: 同上）

**WebKit は、すべてのトップレベルのスタイルシート（`@imports` を含む）が読み込まれたかどうかをマークするフラグを使う。attach 時にスタイルが完全に読み込まれていない場合、プレースホルダが使われ、文書にそれがマークされる。スタイルシートが読み込まれたら再計算される。**

〔補足（一般知識）〕記事末尾の Resources 4.4 に David Hyatt「The FOUC Problem」(`http://webkit.org/blog/66/the-fouc-problem/`) が挙げられており、この節は FOUC（Flash Of Unstyled Content）対策の実装に対応する。

---

### Layout（レイアウト）★重要（出典: 同上）

**renderer が作られてツリーに追加されたとき、それは位置とサイズを持たない。これらの値を計算することを layout または reflow と呼ぶ。**

**HTML はフローベースのレイアウトモデル（flow based layout model）を使う。これは、ほとんどの場合、幾何情報を1パスで計算できることを意味する。「フローの後方」の要素は典型的に「フローの前方」の要素の幾何に影響しないので、レイアウトは文書を左から右、上から下へ進められる。例外はある: たとえば HTML の table は複数パスを必要とすることがある。**

**座標系はルートframeに対する相対。top と left の座標が使われる。**

**Layout は再帰的プロセス。HTML文書の `<html>` 要素に対応するルート renderer から始まる。Layout は frame 階層の一部または全部を再帰的に進み、必要とする各 renderer の幾何情報を計算する。**

**ルート renderer の位置は 0,0 で、その寸法は viewport ― ブラウザウィンドウの可視部分。**

**すべての renderer は "layout" または "reflow" メソッドを持ち、各 renderer は layout を必要とする子の layout メソッドを呼ぶ。**

#### Dirty bit system（ダーティビット方式）★重要（出典: 同上）

**小さな変更ごとに完全な layout を行わないために、ブラウザは "dirty bit" 方式を使う。変更された、あるいは追加された renderer は、自分自身と自分の子を "dirty"（layout が必要）とマークする。**

**2つのフラグがある:**

| フラグ | 意味 |
| --- | --- |
| **"dirty"** | この renderer 自身が layout を必要とする |
| **"children are dirty"** | renderer 自身は問題ないかもしれないが、**layout を必要とする子が少なくとも1つある** |

#### Global and incremental layout（グローバルレイアウトと増分レイアウト）★重要（出典: 同上）

**Layout は render tree 全体に対してトリガされうる ― これが "global" layout。**これが起こりうるのは:

1. **すべての renderer に影響するグローバルなスタイル変更（フォントサイズの変更など）の結果として**
2. **画面がリサイズされた結果として**

**Layout は incremental（増分的）にもなりうる。dirty な renderer だけが layout される（これは「damage」を引き起こし、追加の layout が必要になることがある）。**

**Incremental layout は renderer が dirty になったときに（非同期に）トリガされる。**たとえば、ネットワークから追加コンテンツが届いてDOMツリーに追加され、新しい renderer が render tree に追加されたとき。

（図の説明: Incremental layout - **dirty な renderer とその子だけが layout される**（注記 (3.6)））

（〔補足（一般知識）〕原典の注記 `(3.6)` は記事末尾 Resources の 3. Firefox グループの 6番目、すなわち **Chris Waterson「Gecko Overview」** を指す。原典の Resources 入れ子リスト構造から導いた対応。）

#### Asynchronous and Synchronous layout（非同期／同期レイアウト）★重要（出典: 同上）

- **Incremental layout は非同期に行われる。Firefox は incremental layout のための "reflow commands" をキューに入れ、スケジューラがこれらのコマンドのバッチ実行をトリガする。WebKit も incremental layout を実行するタイマを持つ ― ツリーが走査され "dirty" な renderer が layout される。**
- **`offsetHeight` のようにスタイル情報を要求するスクリプトは、incremental layout を同期的にトリガできる。**
- **Global layout は通常同期的にトリガされる。**
- **スクロール位置のような一部の属性が変わったため、初期 layout の後にコールバックとして layout がトリガされることもある。**

〔補足（一般知識）〕この「スクリプトによる同期 layout 強制」は、いわゆる layout thrashing（強制同期レイアウト）としてパフォーマンス診断の中心概念であり、計測時間差を利用したクライアントサイドのサイドチャネル（レンダリング時間の差から状態を推測する手法）の技術的土台にもなる。原典はパフォーマンスの文脈のみで述べている。

#### Optimizations（最適化）（出典: 同上）

- **layout が "resize" または renderer の位置（サイズではなく）の変更によってトリガされた場合、renderer のサイズはキャッシュから取られ、再計算されない。**
- **一部のケースではサブツリーだけが変更され、layout はルートから始まらない。これは変更がローカルで周囲に影響しない場合に起こりうる ― テキストフィールドに挿入されたテキストのように（そうでなければキーストロークごとにルートから layout がトリガされてしまう）。**

#### The layout process（レイアウトプロセス）★重要（出典: 同上）

**layout は通常、次のパターンを持つ:**

1. **親 renderer が自分自身の幅を決定する。**
2. **親が子を順に処理し:**
   1. **子 renderer を配置する（x と y を設定する）。**
   2. **必要なら子の layout を呼ぶ（子が dirty である、global layout 中である、その他の理由のとき） ― これが子の高さを計算する。**
3. **親は子の累積高さと margin・padding の高さを使って自分自身の高さを設定する ― これが親 renderer の親によって使われる。**
4. **自分の dirty bit を false に設定する。**

**Firefox は layout（"reflow" と呼ばれる）のパラメータとして "state" オブジェクト（`nsHTMLReflowState`）を使う。とりわけ、この state は親の幅を含む。**

**Firefox の layout の出力は "metrics" オブジェクト（`nsHTMLReflowMetrics`）。これは renderer の計算された高さを含む。**

#### Width calculation（幅の計算）★重要（出典: 同上）

**renderer の幅は、コンテナブロックの幅、renderer のスタイル "width" プロパティ、margin、border を使って計算される。**

たとえば次の div の幅（原文のまま逐語）:

```html
<div style="width: 30%"/>
```

**WebKit では次のように計算される（class RenderBox のメソッド `calcWidth`）:**

- **コンテナ幅は、コンテナの `availableWidth` と 0 の最大値。この場合の `availableWidth` は `contentWidth` で、次のように計算される**（原文のまま逐語）:

```css
clientWidth() - paddingLeft() - paddingRight()
```

**`clientWidth` と `clientHeight` はオブジェクトの内側（border とスクロールバーを除く）を表す。**

- **要素の幅は "width" スタイル属性。これはコンテナ幅のパーセンテージを計算することで絶対値として計算される。**
- **次に水平の border と padding が加算される。**

**ここまでが "preferred width"（優先幅）の計算。次に最小幅と最大幅が計算される。**

- **preferred width が maximum width より大きければ maximum width が使われる。**
- **minimum width（最小の分割不可能な単位, the smallest unbreakable unit）より小さければ minimum width が使われる。**

**layout が必要だが幅が変わらない場合のために、値はキャッシュされる。**

#### Line Breaking（改行）（出典: 同上）

**layout の途中で renderer が改行が必要だと判断したとき、renderer は停止し、改行が必要であることを layout の親に伝播する。親が余分な renderer を作り、それらに対して layout を呼ぶ。**

---

### Painting（描画）★重要（出典: 同上）

**painting 段階では render tree が走査され、renderer の "paint()" メソッドが呼ばれてコンテンツを画面に表示する。painting は UI インフラストラクチャコンポーネントを使う。**

#### Global and Incremental（グローバル／増分描画）（出典: 同上）

**layout と同様、painting もグローバル ― ツリー全体が描画される ― または増分的になりうる。**

**増分描画では、一部の renderer がツリー全体に影響しない形で変更される。変更された renderer は画面上の自分の矩形を無効化（invalidate）する。これにより OS はそれを "dirty region" と見なし、"paint" イベントを生成する。OS は賢くやり、複数の領域を1つに合体（coalesce）させる。**

**Chrome ではもっと複雑で、renderer がメインプロセスとは別のプロセスにあるため、Chrome はある程度 OS の振る舞いをシミュレートする。**

**presentation はこれらのイベントをリスンし、メッセージを render root に委譲する。ツリーは該当の renderer に到達するまで走査される。その renderer は自分自身（そして通常はその子）を再描画する。**

#### The painting order（描画順序）★重要（出典: 同上）

**CSS2 が painting プロセスの順序を定義している（`http://www.w3.org/TR/CSS21/zindex.html`）。これは実際には要素が stacking contexts 内で積まれる順序である。この順序は painting に影響する。なぜなら stack は奥から手前へ（from back to front）描画されるから。**

**ブロック renderer の stacking order（積み順）は:**

| 順序 | 描画対象 |
| --- | --- |
| 1 | **background color（背景色）** |
| 2 | **background image（背景画像）** |
| 3 | **border（ボーダー）** |
| 4 | **children（子）** |
| 5 | **outline（アウトライン）** |

#### Firefox display list（Firefoxのディスプレイリスト）（出典: 同上）

**Firefox は render tree を走査し、描画される矩形のための display list を構築する。これは、その矩形に関連する renderer を正しい描画順序（renderer の背景、次にボーダー等）で含む。**

**こうすることで、再描画のためにツリーを1回だけ走査すればよくなる ― すべての背景を描画し、次にすべての画像、次にすべてのボーダー、というように何度も走査する代わりに。**

**Firefox は、隠れる要素 ― 不透明な要素の完全に下にある要素など ― を追加しないことでプロセスを最適化する。**

#### WebKit rectangle storage（WebKitの矩形保存）（出典: 同上）

**再描画の前に、WebKit は古い矩形をビットマップとして保存する。そして新しい矩形と古い矩形の差分（delta）だけを描画する。**

#### Dynamic changes（動的変更への応答）★重要（出典: 同上）

**ブラウザは変更に応じて可能な限り最小の動作をしようとする。**

| 変更 | 引き起こされる処理 |
| --- | --- |
| **要素の色の変更** | **その要素の repaint のみ** |
| **要素の位置の変更** | **その要素、その子、そしておそらく兄弟の layout と repaint** |
| **DOMノードの追加** | **そのノードの layout と repaint** |
| **大きな変更（"html" 要素のフォントサイズを大きくする等）** | **キャッシュの無効化、ツリー全体の relayout と repaint** |

#### The rendering engine's threads（レンダリングエンジンのスレッド）★重要（出典: 同上）

**レンダリングエンジンはシングルスレッド。ネットワーク操作を除いて、ほとんどすべてが単一スレッドで起こる。Firefox と Safari ではこれはブラウザのメインスレッド。Chrome ではタブプロセスのメインスレッド。**

**ネットワーク操作は複数の並列スレッドで実行できる。並列コネクション数は制限される（通常 2〜6 コネクション）。**

#### Event loop（イベントループ）（出典: 同上）

**ブラウザのメインスレッドはイベントループ。プロセスを生かし続ける無限ループであり、（layout や paint イベントのような）イベントを待って処理する。**

これがメインイベントループの Firefox コード（原文のまま逐語）:

```js
while (!mExiting)
    NS_ProcessNextEvent(thread);
```

---

### CSS2 visual model（CSS2 の視覚モデル）（出典: 同上）

#### The canvas（キャンバス）（出典: 同上）

**CSS2仕様（`http://www.w3.org/TR/CSS21/intro.html#processing-model`）によれば、canvas という用語は「整形構造がレンダリングされる空間（the space where the formatting structure is rendered）」 ― ブラウザがコンテンツを描画する場所 ― を記述する。**

**canvas は空間の各次元で無限だが、ブラウザは viewport の寸法に基づいて初期幅を選ぶ。**

**`www.w3.org/TR/CSS2/zindex.html` によれば、canvas は他の canvas に含まれる場合は透明であり、含まれない場合はブラウザが定義した色が与えられる。**

#### CSS Box model（CSSボックスモデル）（出典: 同上）

**CSSボックスモデル（`http://www.w3.org/TR/CSS2/box.html`）は、文書ツリー内の要素に対して生成され、視覚整形モデルに従ってレイアウトされる矩形ボックスを記述する。**

**各ボックスは content area（コンテンツ領域。テキスト、画像等）と、任意の周囲の padding、border、margin の領域を持つ。**

（図: CSS2 box model）

**各ノードは 0…n 個のそのようなボックスを生成する。**

**すべての要素は "display" プロパティを持ち、生成されるボックスの型を決定する。**

例（原文のまま逐語）:

```markup
block: generates a block box.
inline: generates one or more inline boxes.
none: no box is generated.
```

**デフォルトは inline だが、ブラウザのスタイルシートが他のデフォルトを設定することがある。**たとえば **"div" 要素のデフォルト display は block**。

デフォルトスタイルシートの例: `www.w3.org/TR/CSS2/sample.html`

#### Positioning scheme（配置スキーム）★重要（出典: 同上）

**3つのスキームがある:**

| # | スキーム | 内容 |
| --- | --- | --- |
| 1 | **Normal** | **オブジェクトは文書内の位置に従って配置される。つまり render tree 内の位置が DOM tree 内の位置と同じで、ボックス型と寸法に従ってレイアウトされる** |
| 2 | **Float** | **オブジェクトはまず通常フローのようにレイアウトされ、その後できるだけ左または右に移動される** |
| 3 | **Absolute** | **オブジェクトは DOM tree とは異なる場所に render tree に置かれる** |

**配置スキームは "position" プロパティと "float" 属性で設定される。**

- **static と relative は normal flow を引き起こす**
- **absolute と fixed は absolute positioning を引き起こす**

**static 配置では位置が定義されず、デフォルトの配置が使われる。他のスキームでは著者が位置（top, bottom, left, right）を指定する。**

**ボックスがレイアウトされる方法は次によって決まる:**

- **Box type（ボックス型）**
- **Box dimensions（ボックス寸法）**
- **Positioning scheme（配置スキーム）**
- **External information such as image size and the size of the screen（画像サイズや画面サイズのような外部情報）**

#### Box types（ボックスの型）（出典: 同上）

- **Block box: ブロックを形成する ― ブラウザウィンドウ内に自分自身の矩形を持つ。**
- **Inline box: 自分自身のブロックを持たないが、containing block の内側にある。**

**ブロックは垂直に次々と整形される。インラインは水平に整形される。**

**インラインボックスは行（lines）または "line boxes" の内側に置かれる。行は少なくとも最も高いボックスと同じ高さだが、ボックスが "baseline" で揃えられる場合はもっと高くなりうる ― baseline 揃えとは、ある要素の下部が、別のボックスの下部以外の点に揃えられることを意味する。コンテナ幅が足りなければインラインは複数行に配置される。これは段落で通常起こること。**

#### Positioning（配置）（出典: 同上）

##### Relative（相対配置）

**Relative positioning ― 通常通りに配置され、その後必要なデルタだけ移動される。**

##### Floats（フロート）

**float ボックスは行の左または右にシフトされる。興味深い特徴は、他のボックスがその周りを流れる（flow around）こと。**

HTML（原文のまま逐語。web.dev版）:

```html
<p>
  <img style="float: right" src="images/image.gif" width="100" height="100">
  Lorem ipsum dolor sit amet, consectetuer...
</p>
```

（原典html5rocks版では `style="float:right"` と空白なしで書かれている）

##### Absolute and fixed（絶対配置と固定配置）

**レイアウトは normal flow に関係なく正確に定義される。要素は normal flow に参加しない。寸法はコンテナに対する相対。fixed では、コンテナは viewport。**

**注意 ― fixed ボックスは文書がスクロールされても動かない！**

#### Layered representation（レイヤ表現 / スタッキング）★重要（出典: 同上）

**これは z-index CSS プロパティで指定される。ボックスの第3の次元、すなわち "z軸" に沿った位置を表す。**

**ボックスは stacks（stacking contexts と呼ばれる）に分割される。各 stack 内では、奥の要素が先に描画され、手前の要素が上に、ユーザに近い側に描画される。重なった場合、最も手前の要素が前の要素を隠す。**

**stack は z-index プロパティに従って順序付けられる。"z-index" プロパティを持つボックスはローカルな stack を形成する。viewport は最も外側の stack を持つ。**

例（原文のまま逐語）:

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

**赤い div はマークアップ上で緑より前にあり、通常のフローでは先に描画されたはずだが、z-index プロパティがより高いので、ルートボックスが保持する stack の中でより手前にある。**

〔補足（一般知識）〕stacking context と z-index の挙動は、クリックジャッキング（透明な要素を上に重ねる、`opacity`・`pointer-events` の組み合わせ）や UI redressing の診断で直接使う知識。「ローカル stack を形成する条件」と「奥から手前へ描画される」という本文の記述が、なぜ親の stacking context を越えて手前に出られないケースがあるかの説明根拠になる。原典はセキュリティ的含意を述べていない。

---

## Resources（原文の参考文献リスト ― 完全再現）

原典の注記番号 `(1.1)`, `(3.6)`, `(4.1)` はこのリストの「グループ番号.項番号」を指す。

| 番号 | グループ | 文献 |
| --- | --- | --- |
| 1 | **Browser architecture** | |
| 1.1 | | Grosskurth, Alan. [A Reference Architecture for Web Browsers (pdf)](http://grosskurth.ca/papers/browser-refarch.pdf) |
| 1.2 | | Gupta, Vineet. [How Browsers Work - Part 1 - Architecture](http://www.vineetgupta.com/2010/11/how-browsers-work-part-1-architecture/) |
| 2 | **Parsing** | |
| 2.1 | | Aho, Sethi, Ullman, *Compilers: Principles, Techniques, and Tools*（通称 "Dragon book"）, Addison-Wesley, 1986 |
| 2.2 | | Rick Jelliffe. [The Bold and the Beautiful: two new drafts for HTML 5.](http://broadcast.oreilly.com/2009/05/the-bold-and-the-beautiful-two.html) |
| 3 | **Firefox** | |
| 3.1 | | L. David Baron, [Faster HTML and CSS: Layout Engine Internals for Web Developers.](http://dbaron.org/talks/2008-11-12-faster-html-and-css/slide-6.xhtml) |
| 3.2 | | L. David Baron, [Faster HTML and CSS: Layout Engine Internals for Web Developers (Google tech talk video)](https://www.youtube.com/watch?v=a2_6bGNZ7bA) |
| 3.3 | | L. David Baron, [Mozilla's Layout Engine](http://www.mozilla.org/newlayout/doc/layout-2006-07-12/slide-6.xhtml) |
| 3.4 | | L. David Baron, [Mozilla Style System Documentation](http://www.mozilla.org/newlayout/doc/style-system.html) |
| 3.5 | | Chris Waterson, [Notes on HTML Reflow](http://www.mozilla.org/newlayout/doc/reflow.html) |
| 3.6 | | Chris Waterson, [Gecko Overview](http://www.mozilla.org/newlayout/doc/gecko-overview.htm) |
| 3.7 | | Alexander Larsson, [The life of an HTML HTTP request](https://developer.mozilla.org/en/The_life_of_an_HTML_HTTP_request) |
| 4 | **WebKit** | |
| 4.1 | | David Hyatt, [Implementing CSS(part 1)](http://weblogs.mozillazine.org/hyatt/archives/cat_safari.html) |
| 4.2 | | David Hyatt, [An Overview of WebCore](http://weblogs.mozillazine.org/hyatt/WebCore/chapter2.html) |
| 4.3 | | David Hyatt, [WebCore Rendering](http://webkit.org/blog/114/) |
| 4.4 | | David Hyatt, [The FOUC Problem](http://webkit.org/blog/66/the-fouc-problem/) |
| 5 | **W3C Specifications** | |
| 5.1 | | [HTML 4.01 Specification](http://www.w3.org/TR/html4/) |
| 5.2 | | [W3C HTML5 Specification](http://dev.w3.org/html5/spec/Overview.html) |
| 5.3 | | [Cascading Style Sheets Level 2 Revision 1 (CSS 2.1) Specification](http://www.w3.org/TR/CSS2/) |
| 6 | **Browsers build instructions** | |
| 6.1 | | Firefox. https://developer.mozilla.org/Build_Documentation （原典版は `https://developer.mozilla.org/en/Build_Documentation`） |
| 6.2 | | WebKit. http://webkit.org/building/build.html |

### 本文中で参照される仕様・外部URL（原文のまま）

| 用途 | URL（原文のまま） |
| --- | --- |
| HTML5 パースアルゴリズム | http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html |
| tokenization と tree construction の完全アルゴリズム | http://www.w3.org/TR/html5/syntax.html#html-parser |
| 現行 strict DTD | http://www.w3.org/TR/html4/strict.dtd |
| DOM 仕様（W3C DOM TR一覧） | http://www.w3.org/DOM/DOMTR |
| DOM Level 1 Core の Document インタフェース | http://www.w3.org/TR/1998/REC-DOM-Level-1-19981001/level-one-core.html#i-Document |
| DOM Level 2 HTML の IDL 定義 | http://www.w3.org/TR/2003/REC-DOM-Level-2-HTML-20030109/idl-definitions.html |
| CSS 字句・構文文法 | http://www.w3.org/TR/CSS2/grammar.html |
| CSS2 processing model（containing block） | http://www.w3.org/TR/CSS21/intro.html#processing-model |
| CSS2 specificity（詳細度） | http://www.w3.org/TR/CSS2/cascade.html#specificity |
| CSS2 描画順序・z-index | http://www.w3.org/TR/CSS21/zindex.html / http://www.w3.org/TR/CSS2/zindex.html |
| CSS ボックスモデル | http://www.w3.org/TR/CSS2/box.html |
| デフォルトスタイルシートの例 | http://www.w3.org/TR/CSS2/sample.html |
| 正規表現の解説 | http://www.regular-expressions.info/ |
| BNF | http://en.wikipedia.org/wiki/Backus%E2%80%93Naur_Form |
| 文脈自由文法 | http://en.wikipedia.org/wiki/Context-free_grammar |
| SGML | http://en.wikipedia.org/wiki/Standard_Generalized_Markup_Language |
| Flex（字句解析器生成） | http://en.wikipedia.org/wiki/Flex_lexical_analyser |
| Bison（パーサ生成） | http://www.gnu.org/software/bison/ |
| WebKit | http://webkit.org/ |
| StatCounter 統計 | http://gs.statcounter.com/ |
| 著者サイト | http://taligarsiel.com/ |
| 著者のクライアントサイド性能ガイド | http://taligarsiel.com/ClientSidePerformance.html |
| 深すぎるネストの実例サイト | www.liceo.edu.mx |

### Translations（原文の翻訳リスト）

- 日本語訳が**2つ**ある: [How Browsers Work - Behind the Scenes of Modern Web Browsers (ja)](http://cou929.nu/docs/how-browsers-work/) by [@_kosei_](https://twitter.com/#!/_kosei_)、および [ブラウザってどうやって動いてるの？（モダンWEBブラウザシーンの裏側](http://shanon-tech.blogspot.com/2011/09/web.html) by [@ikeike443](https://twitter.com/#!/ikeike443) と [@kiyoto01](https://twitter.com/#!/kiyoto01)
- 外部ホストの翻訳: [韓国語](http://helloworld.naver.com/helloworld/59361)、[トルコ語](http://sonsuzdongu.com/blog/tarayicilar-nasil-calisir-modern-web-tarayicilarin-perde-arkasi-cevirisi)
- （原典html5rocks版のみ）HTML5 Rocks がホストする German / Spanish / Japanese / Portugese / Russian / Simplified Chinese 版があり、Tali Garsiel 本人の講演が Vimeo にある

### 著者略歴（原文の記述）

Tali Garsiel はイスラエルの開発者。2000年にWeb開発者としてスタートし、Netscape の "evil" layer model に出会った。Richard Feynmann と同様、物事の仕組みを解明することに魅せられ、ブラウザ内部を掘り下げ、見つけたことを文書化し始めた。クライアントサイド性能についての短いガイドも公開している（http://taligarsiel.com/ClientSidePerformance.html）。

---

## 読者が自分で開くべき資料

### 担当URL（https://www.html5rocks.com/tutorials/internals/howbrowserswork/）が直接読めなかった理由

- このセッションの **egress プロキシが `www.html5rocks.com` へのCONNECTを403で拒否**（`EGRESS_BLOCKED`）。組織のegressポリシーによる拒否であり、プロキシのREADMEの指示どおり迂回もTLS検証無効化も行っていない。
- 公式リダイレクト先の **`web.dev`** も同様に403。**`web.archive.org`** と **`developer.chrome.com`** も403。
- 〔補足（一般知識）〕なお html5rocks.com 自体は既にサイトとして閉鎖され、コンテンツは web.dev に移管されている。したがって読者が今この記事を読む場合の**正しい入口は https://web.dev/articles/howbrowserswork**。
- 本ノートは、原典のソースHTML（html5rocks のコンテンツリポジトリのミラー）と web.dev のソースMarkdown（web.dev のコンテンツリポジトリのミラー）の**両方を全文取得し、見出し集合が完全一致することを確認**したうえで作成しており、内容の欠落はない。ただし**記事内の全図（Figure）は画像であり、ノートには図のキャプションと説明文のみを収録している。**

### 読者が自分で開いたときの読みどころ（優先順）

1. **図（Figure）を必ず見ること。**本文は図に強く依存している。特に (a)「Browser components」（7コンポーネントの配置図）、(b)「Rendering engine basic flow」、(c)「WebKit main flow」と「Gecko main flow」の**2枚の対比**、(d)「HTML parsing flow (taken from HTML5 spec)」、(e)「Tokenizing the example input」（状態遷移）、(f)「tree construction of example html」（GIFアニメーション。insertion mode の遷移が動いて見える）、(g)「The rule tree」と「The context tree」の対比、(h)「The render tree and the corresponding DOM tree」。ノートでは文章化したが、図そのものが最良の教材。
2. **"Not a context free grammar" と "The parsing algorithm" の3つの理由**（寛容な構文／伝統的エラー寛容性／`document.write()` による再入性）。ここがHTMLパーサ実装差異の根本であり、mXSS・サニタイザバイパスを理解する起点。
3. **"Browsers' error tolerance" のWebKitソースコメントと5つの実例**（`</br>`、stray table、nested form、cMaxRedundantTagDepth=20、body終了タグを閉じない）。実際のブラウザが「壊れたHTMLをどう書き換えるか」の一次資料的なスニペットが載っている唯一の箇所。
4. **"Sharing style data" の10条件**と **"Manipulating the rules for an easy match" のハッシュマップ最適化（95%以上を除去、キーは最右セレクタ）**。セレクタパフォーマンスとスタイル再計算の実務判断の根拠。
5. **"Layout" の dirty bit 方式と "Asynchronous and Synchronous layout"**。`offsetHeight` 等が同期layoutを強制するという記述は、レイアウトスラッシング診断とレンダリング時間ベースのサイドチャネルの土台。
6. **"The painting order"（背景色→背景画像→border→children→outline）と "Layered representation"（stacking context, z-index）**。クリックジャッキング・UI redressing の診断で直接使う。
7. **末尾 Resources の 3.x（L. David Baron の Faster HTML and CSS スライドと Google tech talk 動画、Mozilla Style System Documentation）と 4.x（David Hyatt の Implementing CSS / An Overview of WebCore / WebCore Rendering / The FOUC Problem）**。本文の注記 (1.1)(3.6)(4.1) が指す一次資料であり、さらに深く掘る場合の次の一歩。ただしこれらは2006〜2010年頃のリンクで、リンク切れの可能性が高い。

### この記事の内容を読むときの時代的注意（教科書に明記すべき）

〔補足（一般知識）〕本文は 2011年執筆・2013年頃更新であり、以下は現在の実装と乖離している。教科書では「古典として読む」ことを明示するのが誠実。

- Chrome/Opera の Blink は本文のWebKit記述からさらに分岐している。IE の Trident は後継が Edge（現在はChromiumベース）。
- 本文の「HTML5仕様」「W3C HTML5」への参照は、現在は **WHATWG HTML Standard** が単一の正本（本文中にも `whatwg.org` のパースアルゴリズムURLが出てくる）。
- 「Data storage」に挙がる **WebSQL は廃止方向**。
- 現代のレンダリングパイプラインには本文にない段階（compositing / GPUラスタライズ、Chromium の LayoutNG、Blink の style recalc の再設計など）がある。本文の「レンダリングエンジンはシングルスレッド」も、compositor スレッドやワーカーの存在を考えると現在は単純化しすぎ。
- 「並列コネクション数は通常2〜6」は HTTP/1.1 前提。HTTP/2 以降は多重化される。

---

## 教科書（ch01）へ渡すときの接続点メモ

〔補足（一般知識）〕以下は原典に書かれていない、教科書側での接続案。原典の記述だけがこの節の外に書かれた事実である。

| 本記事の記述 | クライアントサイド脆弱性ハンティングへの接続 |
| --- | --- |
| HTMLは文脈自由文法でない／エラー寛容 | サニタイザ・WAF・テンプレートのHTMLパースとブラウザのパースの差異（parser differential）→ mXSS、フィルタバイパス |
| tokenizer が状態機械で、同じ文字が状態次第で意味を変える | RCDATA/RAWTEXT/コメント/foreign content ごとにエスケープ要件が違う理由。文脈を跨いだ再パースの危険 |
| tree construction の stack of open elements / insertion modes / 暗黙の要素生成 | 「入力したHTMLと最終DOMが一致しない」ことの一般原理。stray table の兄弟化、form のネスト無視など構造正規化 |
| `document.write()` によるパースの再入性 | パース中のDOM注入、スクリプト実行タイミングの操作 |
| DOM は「JavaScriptに対するHTML要素のインタフェース」 | DOM clobbering（HTML要素が JS のグローバル／プロパティを上書きする）の前提 |
| スクリプトが同期的にパースを止める／speculative parser が外部リソースだけ先読み | リソース読み込み順の操作、レース条件、プリロードスキャナ由来の副作用 |
| Layout の dirty bit と同期layout強制 | レンダリング時間差を使うサイドチャネル、`:visited` 等の状態推測手法の土台 |
| painting order と stacking context / z-index | クリックジャッキング、UI redressing、透明オーバーレイの診断 |
| render tree に載らない要素（`display:none`）と載る要素（`visibility:hidden`） | 「見えないが存在する」要素の扱い。隠しフィールド・オフスクリーン要素の調査 |
| タブごとの別プロセス | プロセス／サイト分離の前提。同一プロセスに載るオリジンの組み合わせを考える出発点 |

（上記は防御・診断目的の技術解説として、許可された検証およびバグバウンティの前提で記述している。）

---

# 【補完パス追記】取得漏れの補完（2回目の取得試行）

この節は、初回パスの取得漏れを埋めるための2回目の試行で追加したものである。**初回パスの記述は一切削除・改変していない。**この節で新たに判明した事実のうち、初回パスの推測を**確定**または**訂正**するものは、その旨を明示する。

## 補完パスでの到達可否（実測）

| ホスト / URL | 結果 | 手段 | 備考 |
| --- | --- | --- | --- |
| `raw.githubusercontent.com` | **到達可（HTTP 200）** | curl `-L --compressed` | 本補完パスの取得はすべてこれ経由 |
| `api.github.com`（GitHub code search） | 到達可 | GitHub MCP | 検索自体は成功（該当0件の場合あり） |
| `https://web.archive.org/web/2024/...` / `/web/2023/...` | **failed（再試行せず）** | ― | 初回パスで CONNECT 403（組織egressポリシー）。環境の `/root/.ccr/README.md` は「**403/407 は組織のegressポリシー拒否であり、再試行も迂回もせず報告せよ**」と明示しているため、本パスでは再試行していない。迂回・TLS検証無効化も行っていない |
| `html.spec.whatwg.org` | failed | curl（実測 `000`） | CONNECT 段階で失敗 |
| `developer.mozilla.org` | failed | curl（実測 `000`） | 同上 |
| `www.chromium.org` | failed | curl（実測 `000`） | 同上 |
| `taligarsiel.com`（著者サイト） | failed | curl（実測 `000`） | 同上 |
| `cou929.nu`（日本語訳） | failed | curl（実測 **HTTP 403**） | 同上 |
| `wd.imgix.net` / `web-dev.imgix.net`（web.dev 画像CDN） | failed | ― | 初回パスで 403 記録済み。図の**画像そのもの**はこのセッションでは取得できない |
| html5rocks ミラーの画像ファイル（`layers.png` 等） | failed（HTTP 404） | curl | ミラーリポジトリは**テキストのみ**で画像を含まない（実測: `layers.png` / `flow.png` / `webkitflow.png` / `image022.gif` すべて 404） |

**補完パスで新たに全文取得できた資料（すべて `raw.githubusercontent.com` 経由、HTTP 200）:**

| 資料 | 取得元（実際に叩いたURL） | サイズ |
| --- | --- | --- |
| 原典 html5rocks 版ソースHTML（再取得・検証用） | `https://raw.githubusercontent.com/hungdt138/html5rocks/HEAD/www.html5rocks.com/content/tutorials/internals/howbrowserswork/en/index.html` | 93,653 bytes |
| web.dev 版ソースMarkdown（再取得・検証用） | `https://raw.githubusercontent.com/Youssef1313/web.dev/HEAD/src/site/content/en/blog/howbrowserswork/index.md` | 26,581 bytes |
| web.dev の `Img` ショートコード定義 | `https://raw.githubusercontent.com/Youssef1313/web.dev/HEAD/src/site/_includes/components/Img.js` | ― |
| web.dev のサイト設定（画像CDNドメイン） | `https://raw.githubusercontent.com/Youssef1313/web.dev/HEAD/src/site/_data/site.js` | ― |
| **MDN「Populating the page: how browsers work」** | `https://raw.githubusercontent.com/mdn/content/HEAD/files/en-us/web/performance/guides/how_browsers_work/index.md` | 22,350 bytes |
| **Chrome「Inside look at modern web browser」part 1** | `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/HEAD/site/en/blog/inside-browser-part1/index.md` | 14,314 bytes |
| 同 part 2 | `.../site/en/blog/inside-browser-part2/index.md` | 15,119 bytes |
| 同 part 3 | `.../site/en/blog/inside-browser-part3/index.md` | 19,600 bytes |
| 同 part 4 | `.../site/en/blog/inside-browser-part4/index.md` | 12,570 bytes |

---

## A. 原典ソースHTMLから新たに確定した事実（初回ノートの補強・訂正）

出典: 原典 html5rocks 版ソースHTML（上記ミラー）を直接検査した結果。

### A-1. 脚注アンカーは「推測」ではなく原文のHTML `id` で確定している ★初回ノートの推測を確定に格上げ

初回ノートは注記 `(1.1)` `(3.6)` `(4.1)` の対応をTOC採番とリスト構造から**推測**していたが、原典HTMLには参考文献の各項目に明示的な `id` が振られており、本文側から `href="#1_1"` のようにリンクされている。**推測ではなく原文が明示している対応である。**

原文に存在する `<li id="...">` と、本文からの参照箇所（実測）:

| 本文の注記 | 原文アンカー | 指す文献 | 本文中のどこに付いているか |
| --- | --- | --- | --- |
| **(1.1)** | `id="1_1"` | Grosskurth, Alan. *A Reference Architecture for Web Browsers* | "The browser's main components are (1.1):" — 7コンポーネントの列挙の直前 |
| **(2.2)** | `id="2_2"` | Rick Jelliffe. *The Bold and the Beautiful: two new drafts for HTML 5.* | 図「Firefox style context tree(2.2)」のキャプション |
| **(3.1)** | `id="3_1"` | L. David Baron, *Faster HTML and CSS: Layout Engine Internals for Web Developers.* | 図「The render tree and the corresponding DOM tree (3.1)」のキャプション |
| **(3.5)** | `id="3_5"` | Chris Waterson, *Notes on HTML Reflow* | Layout 節「HTML tables may require more than one pass (3.5)」 |
| **(3.6)** | `id="3_6"` | Chris Waterson, *Gecko Overview* | 図「Mozilla's Gecko rendering engine main flow(3.6)」／図「Incremental layout …(3.6)」の2箇所 |
| **(4.1)** | `id="4_1"` | David Hyatt, *Implementing CSS(part 1)* | 「This optimization eliminates 95+% of the rules …(4.1)」 |

**本文から参照されている注記は全部で7箇所、種類は6種**（`#1_1`, `#3_6`×2, `#3_1`, `#2_2`, `#4_1`, `#3_5`）。

### A-2. 初回ノートが落としていた注記: Layout 節の (3.5) ★追記

初回ノートの Layout 節は「例外はある: たとえば HTML の table は複数パスを必要とすることがある」と書いているが、**原典ではこの一文に注記 (3.5)（Chris Waterson, "Notes on HTML Reflow"）が付いている。**教科書で「tableが複数パスを要する」根拠を示すときの一次参照はこれ。

原文（逐語）:

> There are exceptions - for example, HTML tables may require more than one pass (3.5).

なお原典HTMLはこの箇所で TeX 風の引用符 ` ``in the flow'' ` を使っている（web.dev版では通常の `"in the flow"` に直されている）。

### A-3. 「The FOUC Problem」の原文アンカーは `4_5` であって `4_4` ではない ★原文側の不整合

初回ノートの Resources 表は WebKit グループを 4.1〜4.4 と採番している（リスト上の表示位置としては正しい）。しかし**原典HTMLの実際の `id` は `4_1`, `4_2`, `4_3`, `4_5` であり、`4_4` が欠番になっている。**

```
<li id="4_1">David Hyatt,  <a href="...cat_safari.html">Implementing CSS(part 1)</a>
<li id="4_2">David Hyatt,  <a href="...WebCore/chapter2.html">An Overview of WebCore</a>
<li id="4_3">David Hyatt,  <a href="http://webkit.org/blog/114/">WebCore Rendering</a>
<li id="4_5">David Hyatt,  <a href="http://webkit.org/blog/66/the-fouc-problem/">The FOUC Problem</a>
```

つまり「The FOUC Problem」は**表示上は4番目（4.4）だがアンカーは `4_5`**。本文からは `#4_4` も `#4_5` も参照されていないため実害はないが、原典を精査する読者が混乱しうる点なので記録しておく。（編集の過程で `4_4` の項目が削除された痕跡と推測されるが、**それは推測であり原典には書かれていない。**）

### A-4. Preface に、初回ノートが収録していなかった記述がある ★追記

web.dev 版 Preface の逐語（出典: web.dev版ソースMarkdown）:

> In the years of IE 90% dominance there was nothing much to do but regard the browser as a "black box", but now, with open source browsers having [**more than half of the usage share**](http://techcrunch.com/2011/08/01/open-web-browsers/), it's a good time to take a peek under the engine's hood and see what's inside a web browser. Well, what's inside are millions of C++ lines…

- 「オープンソースブラウザが利用シェアの半分以上」という主張には**リンクが張られており、リンク先は `http://techcrunch.com/2011/08/01/open-web-browsers/`**（TechCrunch, 2011年8月1日）。初回ノートはこのURLを収録していなかった。
- また Preface には次の一文がある（初回ノート未収録）:

> Tali published her research on [her site](http://taligarsiel.com/), but we knew it deserved a larger audience, so we've cleaned it up and republished it here.

（= Tali は元々自分のサイト `taligarsiel.com` で研究を公開しており、html5rocks / web.dev 版は**それを編集して再掲したもの**。つまり本記事は二次掲載であり、原初の出典は著者個人サイトである。）

### A-5. 版差分の追加: web.dev 版は本文中の注記番号をすべて削除している ★差分表への追記

初回ノートの差分表に以下を追加する。

| 項目 | html5rocks版（原典） | web.dev版（現行） |
| --- | --- | --- |
| **本文中の参考文献注記** | `(1.1)` `(2.2)` `(3.1)` `(3.5)` `(3.6)` `(4.1)` が本文・図キャプションに埋め込まれ、末尾 Resources の対応項目へアンカーリンクされている | **注記番号がすべて除去されている。**図キャプションからも `(3.6)` `(3.1)` `(2.2)` が消え、Layout 節の `(3.5)` も消えている。Resources リストは残るが、本文のどの記述がどの文献に由来するかは追えなくなっている |
| **構造** | 記事冒頭に3階層の `<ol class="toc">` による Table of Contents（「Parsing and DOM tree construction」という、本文には存在しない章見出しでHTMLパーサ群をまとめている） | TOCなし |
| **注記・補足の表現** | 通常の段落／`<blockquote>` | Eleventy のショートコード `{% Aside %}`（**計6箇所**。うち5箇所が素の `{% Aside %}`、1箇所が `{% Aside 'key-term' %}`＝「Our language can include integers, plus signs and minus signs.」）、`{% Blockquote 'Paul Irish, Chrome Developer Relations' %}` に整理されている |

**`{% Aside %}` が使われている6箇所**（web.dev版、実測）: ①Preface の Tali の引用、②Parsing example の key-term、③"A too deep tag hierarchy" の WebKit コメント（liceo.edu.mx / 20タグ）、④"Misplaced html or body end tags" の WebKit コメント、⑤"Absolute and fixed" の「fixed ボックスは文書がスクロールされても動かない！」、⑥末尾の著者略歴。

---

## B. 図（Figure）完全一覧 ★新規

初回ノートは「図はキャプションのみ収録」としていたが、**両版のソースを突き合わせて全図のインベントリを確定した。**図の画像ファイル自体はこのセッションでは取得できない（html5rocksミラーは画像を含まず404、web.dev の画像CDNは403）が、**読者が自分で図を特定・参照するための情報はすべて揃えた。**

- 原典側のファイル名は html5rocks ソースHTMLの `<img src=...>` から。
- web.dev 側の画像IDと `alt` は web.dev ソースMarkdownの `{% Img src="image/T4FyVKpzu4WKF1kBNvXepbi08t52/<ID>", alt="..." %}` から。
- **画像URLの組み立て方**: web.dev リポジトリの `src/site/_data/site.js` に `imgixDomain: 'web-dev.imgix.net'`、`bucket: 'web-dev-uploads'` とあり、`src/site/_includes/components/Img.js` がこのドメインで imgix の `Img` ショートコードを生成している。したがって図の画像URLは **`https://web-dev.imgix.net/image/T4FyVKpzu4WKF1kBNvXepbi08t52/<ID>`** の形になる。〔注意〕**このURL形式はリポジトリのソースコードから導いたものであり、当セッションでは当該ホストが403のため実際に開いて確認できていない。**確実なのは記事本体（`https://web.dev/articles/howbrowserswork`）を開くこと。
- 両版の画像は**寸法が全点1対1で一致**しており、同じ図の移植であることを確認した（27図＋著者写真1点＝計28点）。

| # | 図のキャプション / alt | 寸法 | html5rocks のファイル名 | web.dev の画像ID | 対応する節 |
| --- | --- | --- | --- | --- | --- |
| 1 | Browser main components. / Browser components | 500×339 | `layers.png` | `PgPX6ZMyKSwF6kB8zIhB.png` | The browser's high level structure |
| 2 | Rendering engine basic flow. | 600×66 | `flow.png` | `bPlYx9xODQH4X1KuUNpc.png` | The main flow |
| 3 | Webkit main flow | 624×289 | `webkitflow.png` | `S9TJhnMX1cu1vrYuQRqM.png` | Main flow examples |
| 4 | Mozilla's Gecko rendering engine main flow **(3.6)** | 624×290 | `image008.jpg` | `Tbif2mUJCUVyPdyXntZk.jpg` | Main flow examples |
| 5 | mathematical expression tree node | 400×155 | `image009.png` | `xNQUG9emGd8FzuOpumP7.png` | Parsing - general |
| 6 | from source document to parse trees | 101×300 | `image011.png` | `TfY1qPDNbZS8iBnlAO4b.png` | Parser - Lexer combination |
| 7 | compilation flow | 104×400 | `image013.png` | `VhoUBTyHWNnnZJiIfRAo.png` | Translation |
| 8 | DOM tree of the example markup | 400×219 | `image015.png` | `DNtfwOq9UaC3TrEj3D9h.png` | DOM |
| 9 | **HTML parsing flow (taken from HTML5 spec)** | 308×400 | `image017.png` | `YYYp1GgcD0riUliWJdiX.png` | The parsing algorithm |
| 10 | **Tokenizing the example input** | 627×387 | `image019.png` | `52SA8fqorIKP6h22JHUR.png` | The tokenization algorithm |
| 11 | **tree construction of example html**（**GIFアニメーション**） | 532×769 | `image022.gif` | `Q8vtwKMnnvYf48eeY95Y.gif` | Tree construction algorithm |
| 12 | parsing CSS | 500×393 | `image023.png` | `vBMlouM57RHDG29Ukzhi.png` | WebKit CSS parser |
| 13 | **The render tree and the corresponding DOM tree (3.1).** The "Viewport" is the initial containing block. In Webkit it will be the "RenderView" object. | 731×396 | `image025.png` | `937hKTBHU2FAEyMRdi5z.png` | Render tree construction |
| 14 | Firefox style context tree **(2.2)** | 640×407 | `image035.png` | `qnms42muTKM1KVUarpVH.png` | Firefox rule tree |
| 15 | （html5rocks版は**キャプションなし**）/ web.dev alt: Computed rule tree | 400×261 | `tree.png` | `RwZNIJLCLZqbH2c9eXXg.png` | Firefox rule tree（A-B-E-I-L の例） |
| 16 | The rule tree | 500×294 | `image027.png` | `zJM11a5O0t2C91bXl8wS.png` | Computing the style contexts using the rule tree |
| 17 | The context tree | 400×305 | `image029.png` | `3QoZ4kD7dDBR6HYobs4w.png` | 同上 |
| 18 | **Incremental layout - only dirty renderers and their children are layed out (3.6).**（原文のtypo `layed` そのまま） | 326×341 | `reflow.png` | `pjIcQqbVvJPryLtHpefc.png` | Global and incremental layout |
| 19 | CSS2 box model | 509×348 | `image046.jpg` | `KbqHxGe3HMLM5BbXMcP8.jpg` | CSS Box model |
| 20 | Block box | 150×127 | `image057.png` | `fvhwoy1W1Se7IY4XyiXp.png` | Box types |
| 21 | Inline boxes | 300×233 | `image059.png` | `srPz5klZnpr6j5edpV45.png` | Box types |
| 22 | Block and Inline formatting | 350×324 | `image061.png` | `8i6bZtuslRR3kJdsST6p.png` | Box types |
| 23 | Lines | 400×277 | `image063.png` | `xChsrrYLPU7MfekdR7zS.png` | Box types |
| 24 | Relative positioning | 500×261 | `image065.png` | `C1rUmDaOa8kGRx1PSdUu.png` | Positioning / Relative |
| 25 | Float | 444×203 | `image067.png` | `ozqqfqboQ0IJJWlv5xXx.png` | Floats |
| 26 | Fixed positioning | 500×343 | `image069.png` | `0xwOrAiWm2kpuCecsRv1.png` | Absolute and fixed |
| 27 | Fixed positioning（**原文のキャプション誤り**。位置的には **Layered representation / z-index の図**） | 254×227 | `image071.png` | `EXneyo5lwaJ6g09BuCo6.png` | Layered representation |
| 28 | Tali Garsiel（著者写真） | 200×200 | `/static/images/profiles/taligarsiel.png` | `4qf836sZm1a8OOEUeUdK.png` | 著者略歴 |

**教科書で図を再現／差し替えるべき優先度の高いもの**: #9（HTML5仕様由来のパースフロー図）、#10（トークナイザの状態遷移）、#11（tree construction のアニメーション）、#13（render tree と DOM tree の対応）、#16+#17（rule tree と context tree の対比）、#3+#4（WebKit と Gecko のフロー対比）。

---

## C. 補完二次資料（原典の穴を埋める、出典明記）

以下は**原典（2011年執筆 / 2013年更新）には無い**内容であり、初回ノートが「現代の実装と乖離している」と指摘した箇所を、一次に近い公式資料で具体的に補うものである。**原典の記述ではないことを必ず区別して扱うこと。**

### C-1. MDN「Populating the page: how browsers work」

- 公開URL: `https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work`
- 本ノートでの取得元（全文取得済み）: `https://raw.githubusercontent.com/mdn/content/HEAD/files/en-us/web/performance/guides/how_browsers_work/index.md`（HTTP 200, 22,350 bytes）
- 位置づけ: **原典と同名テーマの現行版・公式ドキュメント。**原典が扱っていないネットワーク段階・compositing・アクセシビリティツリー・計測指標をカバーしている。

**構成（実測の見出し）**: Overview → Navigation（DNS lookup / TCP handshake / TLS negotiation）→ Response（Congestion control / TCP slow start）→ Parsing（Building the DOM tree / **Preload scanner** / Building the CSSOM tree / Other processes: JavaScript compilation・**Building the accessibility tree**）→ Render（Style / Layout / Paint / **Compositing**）→ Interactivity。

原典との対応と、原典に無い追加事項（出典: 上記MDN）:

| 原典（2011/2013） | MDN現行版が加えていること |
| --- | --- |
| ネットワークは「8kBチャンクで取得する」の一言のみ | **Navigation 段階を DNS lookup / TCP handshake / TLS negotiation に分解。**さらに **TCP slow start（輻輳制御）**を説明: 送出セグメント数は輻輳ウィンドウ CWND で制御され、**CWND の初期値は 1, 2, 4, または 10 MSS（Ethernet では MSS = 1500 bytes）。ACK を受け取れば CWND は倍に、受け取れなければ半分になる** |
| **Speculative parsing**（WebKit/Firefox が別スレッドで先読み、外部リソース参照のみパース、DOMは触らない） | 同じ機構を **"preload scanner"** と呼ぶ。「メインスレッドがDOMツリーを構築している間、preload scanner が利用可能なコンテンツをパースし、CSS・JavaScript・Webフォントのような**高優先度リソース**を先行要求する」 |
| 「スタイルシートが読み込み中はスクリプトがブロックされる（Firefoxは全スクリプト、WebKitは影響するプロパティにアクセスしたときだけ）」 | 現代的な言い換え: 「**CSSの取得待ちはHTMLのパースやダウンロードをブロックしないが、JavaScript はブロックする。JavaScript はしばしば要素に対するCSSプロパティの影響を問い合わせるからである**」 |
| JavaScript は「インタプリタがパース・実行する」とだけ | **スクリプトは抽象構文木（AST）にパースされ、一部のエンジンはASTをコンパイラに渡して bytecode を出力する（JavaScript compilation）。大半はメインスレッドで解釈されるが、Web Workers のような例外がある** |
| （記述なし） | **アクセシビリティツリー / AOM**: ブラウザは支援技術がコンテンツを解釈するためのアクセシビリティツリーも構築する。**AOM は DOM の意味的（semantic）バージョンであり、DOM が更新されるとブラウザがアクセシビリティツリーを更新する。支援技術側からは変更できない。AOM が構築されるまでコンテンツはスクリーンリーダーからアクセスできない** |
| render tree に載る／載らない要素 | **原典と一致することを確認**: `<head>` とその子、`display: none` のノードは render tree に含まれない。**`visibility: hidden` のノードは場所を占めるので含まれる**（原典の記述を現行の公式ドキュメントが追認している ＝ 教科書で安心して断言してよい箇所） |
| Painting（背景色→背景画像→border→children→outline） | **Paint とラスタライズ、そして compositing を明確に分離。**「スムーズなスクロールとアニメーションのためには、スタイル計算・reflow・paint を含むメインスレッドの処理を **16.67ms 未満**で終える必要がある」「2048×1536 の iPad では **3,145,000 ピクセル超**を描画する必要がある」 |
| （記述なし） | **レイヤ昇格の条件**: `<video>`、`<canvas>`、および CSS の `opacity`・3D `transform`・`will-change` などを持つ要素は**自分自身のレイヤに描画される（子孫も一緒に）**。「レイヤは性能を改善するがメモリ管理の観点では高コストなので、乱用すべきでない」 |
| （記述なし） | **Compositing**: 文書の各部が別レイヤに描かれ重なる場合、正しい順序で画面に描くために compositing が必要。**reflow は repaint と re-composite を引き起こす**。「画像の寸法を指定していれば reflow は不要だった」 |
| （記述なし） | **Interactivity / TTI**: Time to Interactive は、最初のリクエスト（DNS lookup と TCP接続）から**ページがインタラクティブになるまで**の計測。インタラクティブとは First Contentful Paint 以降で**ユーザ操作に 50ms 以内で応答する**時点。メインスレッドが JavaScript のパース・コンパイル・実行で占有されていると、この応答ができない |

### C-2. Chrome「Inside look at modern web browser」（Mariko Kosaka, 2018-09-05, 全4部）

- 著者: Mariko Kosaka（`authors: - kosamari`）、公開日: **2018-09-05**
- 公開URL（リポジトリのパス `site/en/blog/inside-browser-partN/` から導かれるもの）: `https://developer.chrome.com/blog/inside-browser-part1` 〜 `part4`
- 本ノートでの取得元（4部とも全文取得済み）: `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/HEAD/site/en/blog/inside-browser-partN/index.md`
- 位置づけ: **原典の「ブラウザの高レベル構造」「レンダリングエンジン」の、Chromium現代版に相当する公式解説。**原典が「Chrome はタブごとに別プロセス」と一行で書いた話を、プロセスモデル・サンドボックス・Site Isolation・compositing まで展開している。

#### part 1: アーキテクチャ（構成: CPU/GPU/Memory とマルチプロセス → Process と Thread → Browser Architecture → どのプロセスが何を制御するか → マルチプロセスの利点 → Servicification → **Site Isolation**）

- **Chrome の主要プロセスと責務**（原文の表を要約）:

| プロセス | 制御するもの |
| --- | --- |
| **Browser** | アドレスバー・ブックマーク・戻る／進むボタンなどアプリの "chrome" 部分。**加えて、ネットワークリクエストやファイルアクセスといった、目に見えない特権的な部分**を扱う |
| **Renderer** | Webサイトが表示されるタブの中身すべて |
| **Plugin** | サイトが使うプラグイン（例: flash） |
| **GPU** | GPUタスクを他プロセスから隔離して扱う |

（ほかに Extension プロセスや utility プロセスもある。Chrome のタスクマネージャで実際のプロセス一覧を見られる。）

- **マルチプロセスの利点**: ①1つのタブが応答しなくなっても他のタブは生きている、②**セキュリティとサンドボックス化** ―「OSがプロセスの権限を制限する手段を提供しているので、ブラウザは特定のプロセスを特定の機能からサンドボックスできる。**たとえば Chrome は、レンダラプロセスのように任意のユーザ入力を扱うプロセスに対して、任意のファイルアクセスを制限している**」
- **コスト**: プロセスは各自のプライベートメモリ空間を持つため、V8 のような共通インフラのコピーを各プロセスが持つ。そのため **Chrome は起動できるプロセス数に上限を設けており、上限に達すると同一サイトの複数タブを1つのプロセスにまとめる。**
- **Servicification**: ブラウザプロセスの各部をサービスとして動かし、強力なハードウェアではプロセスに分割して安定性を高め、リソース制約のあるデバイスでは1プロセスに統合してメモリを節約する。
- **Site Isolation** ★初回ノートの〔補足〕を公式資料で裏付け:
  - **「クロスサイトの iframe ごとに別のレンダラプロセスを走らせる機能」**。
  - **「Same Origin Policy はWebの中核的セキュリティモデルであり、あるサイトが同意なく他サイトのデータにアクセスできないことを保証する。このポリシーのバイパスはセキュリティ攻撃の主要な目標である。プロセス分離はサイトを分離する最も効果的な方法である。」**
  - **「Meltdown と Spectre によって、プロセスを使ってサイトを分離する必要性がいっそう明白になった。」**
  - **「デスクトップでは Chrome 67 以降、Site Isolation がデフォルトで有効。タブ内の各クロスサイト iframe が別のレンダラプロセスを得る。」**
  - 「Site Isolation の実現は複数年のエンジニアリング努力だった。**iframe 同士の通信方法を根本的に変えるもの**であり、DevTools も、ページ内を Ctrl+F で検索することさえ、異なるレンダラプロセスを跨いで行う必要がある。」

#### part 3: レンダリングパイプライン（原典の「レンダリングエンジン」章の現代版）

- **レンダラプロセスの内部スレッド構成**: **main thread（メインスレッド）／worker threads（web worker・service worker）／compositor thread（コンポジタスレッド）／raster thread（ラスタスレッド）。**
  → 原典の「**レンダリングエンジンはシングルスレッド**」という記述が、現在は成り立たないことの具体的な中身。
- **Preload scanner の実装的な説明**: 「`<img>` や `<link>` のようなものがHTML文書にあると、**preload scanner は HTMLパーサが生成したトークンを覗き見し（peeks at tokens generated by HTML parser）、ブラウザプロセス内の network thread にリクエストを送る**」
- **なぜ JavaScript がパースをブロックするのか**: 「**JavaScript は `document.write()` のようなもので文書の形を変えられるから**」— 原典の「パースの再入可能性（reentrant）」と同じ理由を、HTML仕様の `overview of the parsing model`（`https://html.spec.whatwg.org/multipage/parsing.html#overview-of-the-parsing-model`）へのリンク付きで説明している。
- **ブラウザのデフォルトスタイルシート**: 原典が「ブラウザのデフォルトスタイルシート」と呼ぶものの実体は Chromium では **`third_party/blink/renderer/core/html/resources/html.css`**（原文にソースへのリンクあり）。
- **レイヤツリー**: 「どの要素がどのレイヤに入るべきかを決めるため、**メインスレッドが layout tree を歩いて layer tree を作る**（DevTools の performance パネルでは **"Update Layer Tree"** と表示される部分）。スライドインするサイドメニューのように、別レイヤになるべき部分がレイヤを得ていない場合は、CSS の **`will-change`** でブラウザにヒントを与えられる。」
- **ラスタライズと合成がメインスレッドの外で行われる**: 「layer tree が作られ描画順が決まると、**メインスレッドはその情報を compositor thread にコミットする。compositor thread は各レイヤをラスタライズする。レイヤはページ全長のように大きいことがあるので、compositor thread はそれらを tile（タイル）に分割し、各タイルを raster thread に送る。raster thread が各タイルをラスタライズし、GPUメモリに格納する。**」
- **Compositing の定義**: 「**ページの各部をレイヤに分離し、それぞれを個別にラスタライズし、compositor thread という別スレッドでページとして合成する技法。**スクロールが起きてもレイヤは既にラスタライズ済みなので、新しいフレームを合成するだけでよい。アニメーションも同様にレイヤを動かして新フレームを合成することで実現できる。」
- **フレーム予算**: 「ほとんどのディスプレイは毎秒60回（60fps）画面を更新する。フレーム間でアニメーションが取りこぼされるとページは "janky"（カクつく）に見える。」「レンダリング処理が画面更新に追いついていても、**それらの計算はメインスレッドで走っているので、アプリケーションがJavaScriptを実行しているとブロックされうる。**」→ 対策として `requestAnimationFrame()` による分割、Web Workers。
- **パイプラインの依存関係**: 「**各ステップで前の処理の結果が新しいデータを作るのに使われる。たとえば layout tree で何かが変われば、文書の影響を受ける部分について Paint の順序を再生成する必要がある。**」

#### part 2 / part 4（教科書の別章で効く内容、見出しのみ記録）

- **part 2「What happens in navigation」**: Handling input → Start navigation → Read response → **Find a renderer process** → **Commit navigation** → Initial load complete。別サイトへのナビゲート、**Service Worker がある場合**、**Navigation Preload**。
- **part 4「Input is coming to the Compositor」**: ブラウザから見た入力イベント、compositor が入力イベントを受ける、**non-fast scrollable region の理解**、**イベントハンドラを書くときの注意**、**イベントが cancelable かのチェック**、**イベントターゲットの探索**、**メインスレッドへのイベントディスパッチの最小化**、**`getCoalescedEvents()` によるフレーム内イベント取得**。

〔補足（一般知識）〕part 4 の「non-fast scrollable region」と「イベントターゲットの探索」は、`pointer-events` やオーバーレイを使うUI攻撃（クリックジャッキング）・入力横取りの技術的前提として、教科書の該当章から参照する価値が高い。ただし**その接続自体は原典にもこの記事にも書かれていない、本ノートの提案である。**

---

## D. 「読者が自分で開くべき資料」増補

初回ノートの同名節を置き換えるのではなく、**代替手段（alternatives）を具体化して補う。**

### D-1. 担当URL本体

| 項目 | 内容 |
| --- | --- |
| **URL** | `https://www.html5rocks.com/tutorials/internals/howbrowserswork/` |
| **なぜ自動取得できないか** | このセッションの egress プロキシが当該ホストへの CONNECT を **403（組織のegressポリシー拒否）**で拒否。公式リダイレクト先の `web.dev`、`web.archive.org`、`developer.chrome.com`、`developer.mozilla.org`、`html.spec.whatwg.org`、`taligarsiel.com`、日本語訳の `cou929.nu` も同様に到達不可。環境の `/root/.ccr/README.md` が「403/407は再試行・迂回をせず報告せよ」と定めているため、これらを迂回する試みは行っていない。**なお html5rocks.com はサイト自体が閉鎖済みで、現在の正本は web.dev 側である。** |
| **読者が読むべきポイント** | 下記 D-2 |
| **代替手段** | 下記 D-3 |

### D-2. 読者が自分で開いたときの読みどころ（初回ノートの7項目に追加する3項目）

初回ノートの7項目（図を見る／"Not a context free grammar" の3理由／"Browsers' error tolerance" の5実例／"Sharing style data" の10条件とハッシュマップ最適化／dirty bit と同期layout／painting order と stacking context／末尾 Resources）に、以下を追加する。

8. **本文に埋め込まれた注記番号 `(1.1)` `(2.2)` `(3.1)` `(3.5)` `(3.6)` `(4.1)` を追うこと。**「95%以上の規則を除外できる」(4.1)、「tableは複数パスを要する」(3.5)、「incremental layout は dirty な renderer とその子だけ」(3.6) といった**定量的・断定的な主張には、必ず一次文献が紐づいている。**教科書でこれらの数字を引用するなら、注記先まで辿るのが誠実。**注記番号は web.dev 版では削除されているため、これを読む目的でだけは html5rocks 版（またはそのソース）を見る価値がある。**
9. **Preface のリンク先 `taligarsiel.com`。**本記事は著者個人サイトの研究を html5rocks 編集部が整理して再掲したもので、原初の出典は著者サイトである（Preface に明記）。著者のクライアントサイド性能ガイド `http://taligarsiel.com/ClientSidePerformance.html` も同様。
10. **「読んではいけない部分」の見極め。**対象ブラウザの節（StatCounter 2013年6月のシェア）、Rendering engines の節（IE=Trident 等）、Data storage の WebSQL は、**現在の事実としては引用してはならない。**これらは「2013年時点のスナップショット」としてのみ読む。逆に、パースアルゴリズム・エラー寛容性・カスケード／詳細度・stacking context の記述は**現在も有効**（MDN の現行版が同内容を追認していることを C-1 で確認済み）。

### D-3. 代替手段（このセッションで実際に到達を確認したものには ✅）

**(a) 原典・現行版の本文そのものを読む**

| 手段 | URL | 状態 |
| --- | --- | --- |
| 現行の正本（**読者にはこれを推奨**） | `https://web.dev/articles/howbrowserswork` | このセッションからは403。通常の環境では到達可 |
| ✅ 現行版のソースMarkdown（全文） | `https://raw.githubusercontent.com/Youssef1313/web.dev/HEAD/src/site/content/en/blog/howbrowserswork/index.md` | **HTTP 200 で取得確認済み**。図は `{% Img %}` ショートコードのままだが、本文は完全 |
| ✅ 原典 html5rocks 版のソースHTML（全文、**注記番号とTOC入り**） | `https://raw.githubusercontent.com/hungdt138/html5rocks/HEAD/www.html5rocks.com/content/tutorials/internals/howbrowserswork/en/index.html` | **HTTP 200 で取得確認済み**。ネットワーク制限下でも原典を読める唯一の経路 |
| Internet Archive | `https://web.archive.org/web/2013/https://www.html5rocks.com/tutorials/internals/howbrowserswork/` | このセッションでは403。制限のない環境では図つきで読める見込み |

**(b) 図を見る**

- 記事本体（`https://web.dev/articles/howbrowserswork`）を開くのが最短。
- 個別に参照したい場合は B節の表の画像IDを `https://web-dev.imgix.net/image/T4FyVKpzu4WKF1kBNvXepbi08t52/<ID>` に当てはめる（**当セッションでは未検証**）。
- ✅ ミラーリポジトリには**画像は含まれない**（`layers.png` 等はすべて HTTP 404 で実測確認）。図だけはテキストミラーでは代替できない。

**(c) 日本語で読む（原典の Translations 節が挙げるもの）**

- `http://cou929.nu/docs/how-browsers-work/`（@_kosei_ 訳）※当セッションでは403
- `http://shanon-tech.blogspot.com/2011/09/web.html`（@ikeike443 / @kiyoto01 訳）
- 〔注意〕**いずれも2011年版の翻訳**であり、本ノートの差分表にある web.dev 版の更新（Blink、モバイルブラウザ、ストレージ機構など）は反映されていない。

**(d) 同等以上の無料資料で補う（このセッションで全文取得済み。C節に内容あり）**

| 資料 | 公開URL | ✅ 取得確認済みのソース | 何を補うか |
| --- | --- | --- | --- |
| MDN「Populating the page: how browsers work」 | `https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work` | `https://raw.githubusercontent.com/mdn/content/HEAD/files/en-us/web/performance/guides/how_browsers_work/index.md` | ネットワーク段階（DNS/TCP/TLS/slow start）、preload scanner、AOM、compositing、TTI。**原典と同テーマの現行公式版** |
| Chrome「Inside look at modern web browser」part 1 | `https://developer.chrome.com/blog/inside-browser-part1` | `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/HEAD/site/en/blog/inside-browser-part1/index.md` | **プロセスモデル、サンドボックス、Site Isolation（Chrome 67〜）** |
| 同 part 2 | `.../inside-browser-part2` | `.../site/en/blog/inside-browser-part2/index.md` | ナビゲーションの全工程、Service Worker、Navigation Preload |
| 同 part 3 | `.../inside-browser-part3` | `.../site/en/blog/inside-browser-part3/index.md` | **レンダラの4種スレッド、レイヤツリー、タイル分割とラスタ、compositing**（原典の「シングルスレッド」記述の更新版） |
| 同 part 4 | `.../inside-browser-part4` | `.../site/en/blog/inside-browser-part4/index.md` | 入力イベントと compositor、non-fast scrollable region |
| WHATWG HTML Standard（パースアルゴリズムの現行正本） | `https://html.spec.whatwg.org/multipage/parsing.html` | 当セッションでは到達不可 | 原典が参照している `whatwg.org/specs/web-apps/current-work/multipage/parsing.html` の現在の場所。tokenizer の全 state と insertion modes の完全な一覧はここにしかない |

〔注意〕**Chrome シリーズの公開URL（`developer.chrome.com/blog/inside-browser-partN`）は、リポジトリのディレクトリ構成から導いたものであり、当セッションでは当該ホストが403のため実際に開いて確認していない。**確実に到達できるのは上表の `raw.githubusercontent.com` 側である。

---

## 補完パスの結論

- **原典の本文・コード・図の情報は、テキストとして取得可能な範囲ではすべて揃った。**残る欠落は**図の画像そのもの**のみで、これはこのセッションのネットワーク制限（画像CDNが403、テキストミラーに画像なし）による構造的な制約であり、別手段では埋められない。B節の表により、読者は各図を一意に特定して自分で開ける。
- 初回ノートの推測3件（注記 (1.1)/(3.6)/(4.1) の対応）は**原典HTMLの `id` 属性で裏付けが取れ、確定に格上げした。**
- 初回ノートの欠落2件（Layout 節の注記 (3.5)、Preface の TechCrunch リンクと「著者サイトからの再掲」という出自）を**追記した。**
- 原典側の不整合1件（FOUC のアンカーが `4_5` で `4_4` が欠番）を**記録した。**
- 原典が古びている箇所（ネットワーク、スレッドモデル、compositing、プロセス分離）は、**MDN と Chrome 公式の現行資料を全文取得して C 節で補った。すべて出典URLを併記しており、原典の記述とは節を分けて区別してある。**
