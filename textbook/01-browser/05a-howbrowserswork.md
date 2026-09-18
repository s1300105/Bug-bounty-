# ブラウザの仕組み(1) パースからスタイル計算まで — 攻撃面の土台

> **この節で分かること**
> - ブラウザの7つの主要コンポーネントと、レンダリングの「段階的（gradual）」な基本フローを説明できる。
> - HTMLが文脈自由文法（context free grammar）でない3つの理由と、トークン化・ツリー構築という2段のパースアルゴリズムを説明できる。
> - ブラウザのエラー寛容性が、実際のWebKitコードで壊れたHTMLをどう書き換えるかを追える（parser differential・mXSSの土台）。
> - CSSのパース、スクリプトとスタイルシートの処理順序、スタイル計算の3つの最適化（共有・rule tree・ハッシュマップ）を説明できる。
> - カスケード順序と詳細度（specificity）の計算規則を自分で計算できる。
> - これらのブラウザ内部の挙動が、クライアントサイド脆弱性のどこに接続するかを指摘できる。

**元資料**: https://www.html5rocks.com/tutorials/internals/howbrowserswork/ （現行の正本は https://web.dev/articles/howbrowserswork ）（原典取得済み。担当URLへの直接アクセスは執筆環境のegressポリシーで拒否されたため、GitHubミラーから原典HTMLと現行版Markdownの全文を復元し、見出し集合の完全一致を確認して作成した）
**関連する節**: 「ブラウザの仕組み(2)」（Layout・Painting・スレッドモデルを扱う。本節の続き）

---

## 1. この節の地図と、読む前の時代的注意

### 1.1 この節が扱う範囲

この節は、Tali Garsiel と Paul Irish の古典的な解説記事「How Browsers Work」を土台に、**ブラウザがHTMLとCSSを受け取ってから、画面に描く一歩手前（レイアウト直前）まで**の内部処理を追う。具体的には、コンポーネント構成 → レンダリングの基本フロー → HTMLのパース → CSSのパース → スクリプト処理順序 → render tree の構築 → スタイル計算、という流れである。レイアウト（layout）と描画（painting）、スレッドモデルは続きの節で扱う。

なぜバグバウンティを目指す読者がブラウザ内部を学ぶのか。記事の共著者 Paul Irish（Chrome Developer Relations）はこう書いている。

> Web開発者として、ブラウザ内部の動作を学ぶことは、より良い判断を下し、開発のベストプラクティスの根拠を知る助けになる。これはかなり長い文書だが、時間をかけて掘り下げることを推奨する。読んで良かったと思えることを保証する。

クライアントサイドの脆弱性 ―― mutation XSS（mXSS）、DOM clobbering、クリックジャッキングなど ―― は、いずれも「ブラウザがマークアップやスタイルをどう解釈し、どう構造化するか」という**内部の挙動の隙間**に生まれる。攻撃者が突くのはまさにこの内部処理なので、内部を知らずに勘だけで探すのは効率が悪い。

### 1.2 この記事は「古典」である ―― 何を信じ、何を疑うか

元資料は2011年に html5rocks.com で公開され、2013年ごろ web.dev に移管・更新された。**パースアルゴリズムやエラー寛容性、カスケード・詳細度、スタイル計算の考え方は現在も有効**だが、ブラウザ名やシェアの数字、一部の実装詳細は古びている。教科書として誠実に扱うため、時代的な注意を先に表にまとめる。

| 記述 | 原典（2011/2013） | 現在 |
| --- | --- | --- |
| レンダリングエンジン | 「Chrome と Safari は WebKit」 | Chrome と Opera（v15以降）は **Blink**（WebKitのfork）。IE の Trident は Edge（現在Chromiumベース）に後継 |
| HTML仕様の正本 | 「W3C HTML5」 | **WHATWG HTML Standard** が単一の正本 |
| Data storage | 「web database」 | localStorage / IndexedDB / FileSystem など。**WebSQL は廃止方向** |
| 並列コネクション数 | 「通常2〜6」 | HTTP/1.1 前提。HTTP/2 以降は多重化 |
| スレッド | 「レンダリングエンジンはシングルスレッド」 | compositor スレッドやワーカーがあり、現在は単純化しすぎ |

したがって本節では、**ブラウザ名・シェア・ストレージ機構のような「時点のスナップショット」は現在の事実として引用せず**、パース・スタイルの仕組みのような「今も有効な原理」を中心に読む。

### 1.3 図（Figure）について ―― 本文は図に強く依存している

原典・現行版とも、本文は多数の図（全27図＋著者写真1点）に強く依存している。**本教科書の執筆環境では記事本体にも図の画像CDNにも到達できなかった**ため、以下では図を文章とASCIIアートで再構成しているが、細部は原典の図を自分で見るのが最良である。とくに次の6枚は優先度が高い。

- HTML5仕様由来の「HTMLパースフロー図」
- トークナイザの状態遷移図
- tree construction のアニメーション（GIF。insertion mode の遷移が動いて見える）
- render tree と DOM tree の対応図
- rule tree と context tree の対比図
- WebKit と Gecko のフロー対比図

> ### 📌 ここは自分で開いて読んでください
> **資料**: How Browsers Work: Behind the Scenes of Modern Web Browsers（Tali Garsiel / Paul Irish） — https://web.dev/articles/howbrowserswork （旧 https://www.html5rocks.com/tutorials/internals/howbrowserswork/ ）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限＝組織のegressポリシーによる403、および記事中の図がすべて画像でテキストミラーには含まれない）。以下の記述は、原典HTMLと現行版Markdownのソース全文（GitHubミラー）にもとづく要約であり、図のキャプションと本文は逐語で確認したが、図そのものは再現できていない。
> **読みどころ**:
> 1. 上に挙げた優先度の高い6枚の図を必ず見る。とくに tree construction のGIFは、insertion mode の状態遷移が動きで理解できる。
> 2. 「Not a context free grammar」と「The parsing algorithm」の3つの理由（本節2.5・3.1）。ここがHTMLパーサ実装差異の根本で、mXSS・サニタイザバイパスを理解する起点になる。
> 3. 「Browsers' error tolerance」のWebKitソースコメントと5つの実例（本節4）。壊れたHTMLをブラウザがどう書き換えるかの一次資料的スニペットはここにしかない。
> **代替手段**: 原典HTMLのソースは `https://raw.githubusercontent.com/hungdt138/html5rocks/HEAD/www.html5rocks.com/content/tutorials/internals/howbrowserswork/en/index.html` 、現行版Markdownは `https://raw.githubusercontent.com/Youssef1313/web.dev/HEAD/src/site/content/en/blog/howbrowserswork/index.md` で全文が読める（いずれもテキストのみで図は含まない）。図つきで読むなら記事本体か Internet Archive（`https://web.archive.org/web/2013/https://www.html5rocks.com/tutorials/internals/howbrowserswork/`）を制限のない環境で開く。

---

## 2. ブラウザの主機能と7つの主要コンポーネント

### 2.1 ブラウザの主機能

ブラウザの主機能は、**選ばれたWebリソースをサーバに要求し、ブラウザウィンドウに表示すること**である。リソースは通常HTML文書だが、PDF・画像・その他でもよい。リソースの場所は、利用者が **URI（Uniform Resource Identifier、統一資源識別子）** で指定する。URIとは、Web上の資源の場所や名前を一意に指すための文字列のこと。アドレスバーに打ち込む `https://example.com/page` がその例である。

ブラウザがHTMLをどう解釈・表示するかは、HTMLとCSSの仕様が規定する。これらの仕様はWebの標準化団体 **W3C（World Wide Web Consortium）** が保守してきた（現在のHTMLパースの正本は WHATWG HTML Standard）。長年ブラウザは仕様の一部にしか準拠せず独自拡張を作ったため、深刻な互換性問題を生んだ。今日ではほとんどのブラウザが多かれ少なかれ仕様に準拠している。

面白いことに、アドレスバー・戻る/進む・ブックマーク・更新/停止・ホームといった**ブラウザのUIは、いかなる公式仕様でも規定されていない**。長年の経験とブラウザ同士の模倣から生まれたグッドプラクティスにすぎない。

### 2.2 高レベル構造 ―― 7つのコンポーネント

ブラウザは7つの主要コンポーネントからなる。原典はこの列挙に注記 **(1.1)**（Grosskurth, Alan「A Reference Architecture for Web Browsers」）を付けており、これは学術的な参照アーキテクチャに由来する分類である。

| # | コンポーネント | 責務 |
| --- | --- | --- |
| 1 | **ユーザインタフェース（user interface）** | アドレスバー、戻る/進む、ブックマーク等。要求ページを映すウィンドウを除く、表示のすべての部分 |
| 2 | **ブラウザエンジン（browser engine）** | UIとレンダリングエンジンの間でアクションを取り次ぐ（marshal する） |
| 3 | **レンダリングエンジン（rendering engine）** | 要求コンテンツの表示に責任を持つ。HTMLなら、HTMLとCSSをパースし画面に表示する |
| 4 | **ネットワーキング（networking）** | HTTPリクエスト等。プラットフォーム非依存のインタフェースの背後に、OSごとの実装を持つ |
| 5 | **UIバックエンド（UI backend）** | コンボボックスやウィンドウなど基本ウィジェットの描画。汎用インタフェースの内側でOSのUIメソッドを使う |
| 6 | **JavaScriptインタプリタ（JavaScript interpreter）** | JavaScriptコードのパースと実行 |
| 7 | **データストレージ（data storage）** | 永続化層。クッキーなどをローカルに保存。localStorage / IndexedDB / WebSQL / FileSystem もサポート |

図で表すと、UIの下にブラウザエンジンがあり、そこからレンダリングエンジンがぶら下がり、レンダリングエンジンがネットワーキング・JavaScriptインタプリタ・UIバックエンドを使う、という配置になる（原典の図「Browser components」）。

```
┌───────────────────────────────────────────────┐
│                User Interface                  │
├───────────────────────────────────────────────┤
│                Browser Engine                  │
├───────────────────────────────────────────────┤
│              Rendering Engine                  │
│  ┌───────────┐ ┌───────────┐ ┌──────────────┐ │
│  │Networking │ │JS Interp. │ │ UI Backend   │ │
│  └───────────┘ └───────────┘ └──────────────┘ │
├───────────────────────────────────────────────┤
│                Data Storage                    │
└───────────────────────────────────────────────┘
```

### 2.3 タブごとに別プロセス ―― 攻撃面の出発点

重要な注記として、**Chrome のようなブラウザはレンダリングエンジンのインスタンスを複数実行する ―― タブごとに1つ。各タブは別プロセスで動く**（原典では「Chrome は他の多くのブラウザと違って」とChrome固有の特徴として書かれていた）。

〔補足〕この「タブごとに別プロセス」が、のちの Site Isolation（サイト単位のプロセス分離）の土台になる。クライアントサイドの攻撃面を考えるとき、「どのオリジンが同じプロセスに載るか」は重要な前提になる。原典に Site Isolation の記述はないが、続きの節と、Chrome公式の「Inside look at modern web browser」シリーズ（プロセスモデルとSite Isolationを扱う）で補う。

---

## 3. レンダリングエンジンと「段階的」なメインフロー

### 3.1 レンダリングエンジンの責務と種類

レンダリングエンジンの責務は、**要求されたコンテンツをブラウザ画面に表示すること**。既定ではHTML文書・XML文書・画像を表示でき、プラグイン/拡張で他の種類（PDFなど）も扱える。本節が焦点を当てるのは主要ユースケース、すなわち**CSSで整形されたHTMLと画像の表示**である。

ブラウザごとに使うエンジンが異なる。現行の対応は次のとおり。

| ブラウザ | レンダリングエンジン |
| --- | --- |
| Internet Explorer | Trident |
| Firefox | Gecko |
| Safari | WebKit |
| Chrome / Opera（v15以降） | Blink（WebKitのfork） |

WebKit はオープンソースのエンジンで、Linux向けとして始まり、Apple が Mac/Windows をサポートするよう改変した（`http://webkit.org/`）。原典（2011年版）では「Firefox=Gecko、Chrome/Safari=WebKit」とされていた点に注意する。

### 3.2 基本フロー ―― HTMLからピクセルまで

レンダリングエンジンは、要求文書のコンテンツをネットワーキング層から取得し始める。これは通常 **8kB チャンク**（原典では 8K チャンク）で行われる。その後の基本フローは次のとおり。

1. **HTML文書をパース**し、要素を **DOMノード**に変換して **"content tree"** と呼ぶツリーを作る。
2. **スタイルデータをパース**する（外部CSSファイル内と style 要素内の両方）。
3. スタイル情報とHTML内の視覚的指示を合わせ、**もう1つのツリー ―― render tree** を作る。
4. render tree は**色・寸法などの視覚属性を持つ矩形**を含み、矩形は表示すべき正しい順序で並ぶ。
5. render tree 構築後、**layout（レイアウト）** を通る。各ノードに、画面上に現れるべき正確な座標を与える。
6. 次に **painting（描画）**。render tree を走査し、各ノードを **UIバックエンド層**で描画する。

```
Byte stream ──▶ [HTMLパース] ──▶ DOM (content tree)
                                     │
CSS (外部/style要素) ─▶ [スタイルパース] │
                          └──────┬─────┘
                                 ▼
                            render tree (視覚要素の矩形)
                                 │
                                 ▼   layout（座標決定）
                                 │
                                 ▼   painting（UIバックエンドで描画）
                               画面
```

### 3.3 「段階的（gradual）」であることが最重要

**このフローが段階的（gradual）に進むことを理解するのが重要**である。より良い体験のため、レンダリングエンジンはできるだけ早くコンテンツを画面に出そうとする。**render tree の構築とレイアウトを始める前に、全HTMLがパースされるのを待たない**。一部がパース・表示され、その間もネットワークから届く残りの処理が進む。

〔補足〕この「待たずに段階的に処理する」性質は、後述するスクリプトの同期実行や投機的パースと組み合わさって、リソース読み込み順の操作やレース条件の温床になる。原理としてここを押さえておく。

### 3.4 WebKit と Gecko の用語対応

WebKit と Gecko はやや異なる用語を使うが、**フローは基本的に同じ**である。用語対応を押さえておくと、両エンジンの資料を読み分けられる。

| 概念 | WebKit | Gecko (Firefox) |
| --- | --- | --- |
| 視覚整形された要素のツリー | Render Tree | Frame tree |
| ツリーの構成要素 | Render Objects（renderer） | frame（各要素が1つのframe） |
| 要素の配置処理 | layout | Reflow |
| DOMと視覚情報を結ぶ処理 | Attachment（attach） | FrameConstructor によるframe生成 |
| 追加レイヤ | なし | "content sink"（DOM要素を作るファクトリ） |

---

## 4. パースの一般論 ―― 文法・レクサ・パーサ

### 4.1 パースとは、文法とは

**文書をパースするとは、コードが使える構造に翻訳すること**。結果は通常、文書構造を表すノードのツリーで、これを **parse tree（パースツリー）** または **syntax tree（構文木）** と呼ぶ。たとえば式 `2 + 3 - 1` をパースすると、演算子を節点とするツリーが返る。

パースは、文書が従う構文規則に基づく。**パースできるフォーマットは、語彙（vocabulary）と構文規則（syntax rules）からなる決定的な文法を持たねばならず、これを文脈自由文法（context free grammar）と呼ぶ**。人間の言語はそうでないので、従来のパース技法ではパースできない。ここが後で効いてくる ―― HTMLも文脈自由文法ではないのである。

### 4.2 レクサとパーサ ―― 2つのサブプロセス

パースは2つのサブプロセスに分けられる。

- **字句解析（lexical analysis）**: 入力を**トークン**に分割する。トークンとは、言語の語彙 ―― 有効な構成要素の最小単位のこと。人間の言語なら辞書に載る単語に相当する。
- **構文解析（syntax analysis）**: 言語の構文規則を適用する。

対応するコンポーネントは次の2つ。

- **lexer（レクサ、tokenizer とも）**: 入力を有効なトークンに分割する。空白や改行のような無関係な文字を取り除く方法も知っている。
- **parser（パーサ）**: 構文規則に従って文書構造を解析し、パースツリーを構築する。

```
source document ──▶ [ lexer ] ──tokens──▶ [ parser ] ──▶ parse tree
```

パースは**反復的（iterative）**である。パーサはレクサに新しいトークンを要求し、構文規則にマッチさせようとする。マッチすれば対応ノードをツリーに追加し、次のトークンを要求する。マッチしなければトークンを内部に保存し、保存した全トークンにマッチする規則が見つかるまで要求を続ける。見つからなければ**パーサは例外を投げる** ―― 文書が妥当でなく構文エラーを含んでいた、という意味である。

### 4.3 玩具の数式言語で見るパース

単純な数式言語を定義すると理解しやすい。**この言語は整数、プラス記号、マイナス記号を含む**。構文は次のとおり。

1. 構成要素は **expression（式）、term（項）、operation（演算）**。
2. 任意個の expression を含める。
3. **expression** は「term → operation → term」。
4. **operation** はプラスまたはマイナス。
5. **term** は整数または expression。

入力 `2 + 3 - 1` の解析はこう進む。

- 最初にマッチする部分文字列は `2`（規則5で term）。
- 次に `2 + 3` が規則3にマッチ（term operation term）。
- 末尾まで進むと `2 + 3 - 1` 全体が expression（`2 + 3` が既に term なので、term + operation + term）。
- `2 + +` はどの規則にもマッチしないので**不正な入力**。

語彙は通常**正規表現**で表す。

```js
INTEGER: 0|[1-9][0-9]*
PLUS: +
MINUS: -
```

構文は通常 **BNF（Backus–Naur Form）** で定義する。

```js
expression :=  term  operation  term
operation :=  PLUS | MINUS
term := INTEGER | expression
```

**文脈自由文法の直感的な定義は「BNFで完全に表現できる文法」**である。文法が文脈自由なら通常のパーサでパースできる。

### 4.4 パーサの2種類 ―― top down と bottom up

- **top down パーサ（下降型）**: 構文の高レベル構造から始め、規則のマッチを探す。例では `2 + 3` を expression と識別し、次に `2 + 3 - 1` を expression と識別する（出発点は最高レベルの規則）。
- **bottom up パーサ（上昇型）**: 入力から始め、低レベルの規則から高レベルへ段階的に変換する。規則がマッチするまで入力をスキャンし、マッチ部分を規則で置き換える。部分的にマッチした expression は**パーサのスタック**に置かれる。

bottom up パーサのスタック遷移は次のように進む。

| Stack | Input |
| --- | --- |
| （空） | 2 + 3 - 1 |
| term | + 3 - 1 |
| term operation | 3 - 1 |
| expression | - 1 |
| expression operation | 1 |
| expression | - |

この種の bottom up パーサを **shift-reduce parser（シフト還元パーサ）** と呼ぶ。入力を右へシフト（ポインタが先頭から右へ動く）しながら、段階的に構文規則へ還元（reduce）するためである。

### 4.5 パーサの自動生成 ―― Flex と Bison

言語の文法（語彙と構文規則）を与えると、動作するパーサを生成するツールがある。最適化されたパーサを手で書くのは容易でないため、**パーサジェネレータ**は有用である。

**WebKit は2つのよく知られたパーサジェネレータを使う: レクサ生成に Flex、パーサ生成に Bison**（Lex/Yacc という名前でも出会う）。

- **Flex の入力**: トークンの正規表現定義を含むファイル。
- **Bison の入力**: BNF形式の言語構文規則。

この Flex+Bison が、後で見るCSSパーサの実装に使われる。

---

## 5. HTMLパーサ ―― なぜ文脈自由文法でないのか（核心）

### 5.1 XMLとの違いは「寛容さ」

HTMLの語彙と構文はW3Cの仕様で定義される。しかし**従来のパーサの話題はHTMLには当てはまらない**。HTMLは、パーサが必要とする文脈自由文法では簡単に定義できないのである。

HTMLを定義する形式的フォーマットとして **DTD（Document Type Definition）** はあるが、**これは文脈自由文法ではない**。一見奇妙に思える ―― HTMLはXMLに近く、XMLパーサは多数あり、HTMLのXML版（XHTML）もある。ではなぜ違うのか。

**違いはHTMLのアプローチがより「寛容（forgiving）」なこと**である。特定タグの省略を許し（省略タグは暗黙に追加される）、開始/終了タグの省略を許すことがある。XMLの硬直的で厳格な構文に対して、HTMLは「柔らかい（soft）」構文である。この一見小さな差異が世界ほどの違いを生む ―― 一方でHTMLが普及した理由（ミスを許す）であり、他方で形式的文法を書くことを困難にする。**まとめると、HTMLは文脈自由でないため従来のパーサでは簡単にパースできず、XMLパーサでもパースできない**。

〔補足〕この「エラー寛容性」と「形式文法で書けない」という性質こそ、クライアントサイド脆弱性ハンティングで決定的に重要である。**サニタイザ／WAF／テンプレートエンジンが持つHTMLパース実装と、ブラウザの実装との差（parser differential、パーサ差異）**が、mutation XSS（mXSS）やフィルタバイパスの根本原因になる。用語を先に置いておくと、mXSSとは、サニタイザが安全と判断したHTMLが、ブラウザで再パース・直列化される過程で構造が変化し、結果としてスクリプトが実行されてしまう脆弱性のこと。原典はこの含意を述べていないが、教科書ではここが土台になる。

### 5.2 HTML DTD の補足

HTMLの定義はDTDフォーマットで書かれ、これは **SGML** ファミリの言語を定義するのに使う。DTDは許容される全要素・属性・階層を定義する。DTDには **strict モード**（仕様のみに準拠）と、過去のマークアップをサポートするモードがあり、後者の目的は古いコンテンツとの後方互換性である。

### 5.3 DOM ―― JavaScriptに対するHTMLのインタフェース

パースの出力ツリーは **DOM要素ノードと属性ノードのツリー**である。DOM は **Document Object Model** の略。HTML文書のオブジェクト表現であり、**JavaScript のような外部世界に対するHTML要素のインタフェース**である。ツリーのルートは **"Document"** オブジェクト。

**DOMはマークアップとほぼ1対1の関係**を持つ。次のマークアップは、下のようなDOMツリーに変換される。

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

```
Document
└─ html
   └─ body
      ├─ p
      │  └─ "Hello World"
      └─ div
         └─ img (src="example.png")
```

「ツリーがDOMノードを含む」とは、**ツリーがDOMインタフェースの1つを実装する要素で構成されている**という意味である。ブラウザは内部用の追加属性を持つ具体的な実装を使う。

〔補足〕「DOMはJavaScriptに対するHTML要素のインタフェース」という一文は、**DOM clobbering**（DOMクロバリング）の前提そのものである。DOM clobbering とは、`id` や `name` 属性を持つHTML要素が、JavaScriptのグローバル変数やオブジェクトのプロパティを上書きしてしまう挙動を悪用する手法のこと。HTML要素がJSから名前でアクセスできるからこそ成立する。

---

## 6. HTMLパースアルゴリズム ―― 2段の状態機械

### 6.1 なぜカスタムパーサが必要か（3つの理由）

前節のとおり、**HTMLは通常の top down / bottom up パーサではパースできない**。理由は3つ。

1. **言語の寛容な性質（forgiving nature）**。
2. **ブラウザが、よく知られた不正HTMLのケースをサポートするための伝統的なエラー寛容性を持つこと**。
3. **パースプロセスが再入可能（reentrant）であること**。他の言語ではパース中にソースは変わらないが、HTMLでは動的コード（`document.write()` を含む script 要素など）が余分なトークンを追加でき、**パースプロセスが実際に入力を書き換える**。

このため**ブラウザはHTML専用のカスタムパーサを作る**。パースアルゴリズムは HTML5 仕様に詳細記述されており、原典はそのURLとして `http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html` を挙げている（現在の正本は WHATWG HTML Standard の parsing.html）。**アルゴリズムは2段からなる: tokenization（トークン化）と tree construction（ツリー構築）**。

```
Network ─▶ Byte stream ─▶ [ Tokeniser ] ─▶ [ Tree construction ] ─▶ DOM
                              ▲                     │
                              └── script実行 / ─────┘
                                  document.write によるフィードバック
```

〔補足〕理由3の再入性は、`document.write()` によるパース中のDOM注入や、スクリプト実行タイミングの操作という攻撃観点の土台になる。上の図の「フィードバックループ」がその経路である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: WHATWG HTML Standard「Parsing HTML documents」 — https://html.spec.whatwg.org/multipage/parsing.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限。当セッションからは到達不可）。以下のトークン化・ツリー構築の記述は、原典が挙げた状態名（Data state / Tag open state / Tag name state など）と例に基づく要約であり、全状態と全 insertion mode の完全な一覧は含んでいない。
> **読みどころ**:
> 1. tokenizer の全 state 一覧（RCDATA state、RAWTEXT state、Script data state、Comment state など）。同じ文字が state によって意味を変える理由を、状態の一覧として確認する。
> 2. tree construction の全 insertion modes と「stack of open elements」「list of active formatting elements」の正確な定義。「入力したHTMLと最終DOMが一致しない」現象の一次規範がここにある。
> 3. foreign content（SVG/MathML）の扱い。文脈を跨いだ再パースがなぜ mXSS を生むかを、仕様のレベルで裏取りする。
> **代替手段**: なし（この仕様が全状態を列挙する唯一の一次資料である。原典の該当箇所は `http://www.w3.org/TR/html5/syntax.html#html-parser` でも参照されている）。

### 6.2 トークン化（tokenization）―― 状態機械

トークン化はアルゴリズムの前段（字句解析）で、出力はHTMLトークンである。HTMLトークンには **開始タグ（start tags）、終了タグ（end tags）、属性名（attribute names）、属性値（attribute values）** がある。tokenizer はトークンを認識して tree constructor に渡し、次の文字を消費して次のトークンを認識する ―― これを入力末尾まで続ける。

**アルゴリズムは状態機械（state machine）として表現される。各状態は入力ストリームの1文字以上を消費し、その文字に応じて次の状態を更新する。判断は「現在のトークン化状態」と「tree construction の状態」の両方に影響される**。つまり**同じ消費文字が、現在の状態によって異なる結果（次の状態）をもたらす**。

次のHTMLをトークン化する例で原理を追う。

```html
<html>
  <body>
    Hello world
  </body>
</html>
```

状態遷移はこう進む。

1. 初期状態は **"Data state"**。
2. `<` に遭遇すると **"Tag open state"** へ。
3. `a-z` を消費すると **"Start tag token"** が作られ、**"Tag name state"** へ。
4. `>` が消費されるまでこの状態に留まり、**各文字を新しいトークンの名前に追加**する。ここでは `html` トークン。
5. `>` に達すると**現在のトークンが emit（発行）** され、状態は "Data state" に戻る。
6. `<body>` も同じ手順。ここまでで `html` と `body` が emit された。
7. `Hello world` の `H` を消費すると**文字トークン（character token）が作られて emit**、これが `</body>` の `<` に達するまで続く（**各文字に対して文字トークンを1つ emit**）。
8. また "Tag open state" に戻り、`/` を消費すると **end tag token** が作られ "Tag name state" へ。`>` まで留まり、emit して "Data state" へ。
9. `</html>` も同様に扱われる。

```
Data state ──'<'──▶ Tag open state ──'a-z'──▶ Tag name state ──'>'──▶ (emit) ──▶ Data state
   │                                                                                │
   └────── 'H','e','l',...（各文字ごとに character token を emit）───────────────────┘
```

〔補足〕この「状態機械であり、同じ文字が状態によって違う意味になる」性質が、なぜ文脈ごとにエスケープ規則が違うのかを説明する。`<textarea>`／`<title>` は RCDATA、`<script>`／`<style>` は RAWTEXT、コメント、foreign content（SVG/MathML）は、それぞれ tokenizer の異なる state で処理される。だから同じ `<` でも状態次第で「タグの開始」にも「ただの文字」にもなる。**文脈を跨いだ再パース**（ある文脈で安全に見えた文字列が、別の文脈で再解釈される）が mXSS を生む理由がここにある。原典はこの例の範囲（Data / Tag open / Tag name）の state しか列挙していないので、全 state は前掲のWHATWG仕様で確認する。

### 6.3 ツリー構築（tree construction）―― insertion modes

**パーサが作られたとき Document オブジェクトが作られる**。tree construction 段階では、ルートに Document を持つDOMツリーが変更され、要素が追加されていく。

- tokenizer が emit した各トークンを tree constructor が処理する。
- 各トークンについて、**仕様が関連するDOM要素を定義**しており、そのトークンのためにその要素が作られる。
- 要素はDOMツリーに追加され、**同時に「open elements のスタック（stack of open elements）」にも追加**される。このスタックは、**ネストの不一致（nesting mismatches）と閉じられていないタグ（unclosed tags）を修正**するために使う。
- **アルゴリズムもまた状態機械で、状態は "insertion modes"（挿入モード）と呼ばれる**。

同じ例に対する tree construction の遷移はこう進む。

```html
<html>
  <body>
    Hello world
  </body>
</html>
```

1. 入力は tokenization からのトークン列。
2. 最初は **"initial mode"**。"html" トークンで **"before html"** へ移り、**そのモードでトークンを再処理（reprocessing）**。**HTMLHtmlElement** が作られ Document に追加。
3. **"before head"** へ。次に "body" トークンを受け取る。**"head" トークンが無いのに HTMLHeadElement が暗黙に作られ**追加される。
4. **"in head"** → **"after head"** へ。body トークンが再処理され、**HTMLBodyElement** が作られ挿入、**"in body"** へ。
5. "Hello world" の文字トークン。**最初の1つが "Text" ノードの作成・挿入を起こし、残りはそのノードに追加**。
6. body 終了トークンで **"after body"** へ。
7. html 終了タグで **"after after body"** へ。
8. **end of file トークンでパース終了**。

本文が明示的に挙げる insertion mode 一覧: `initial` → `before html` → `before head` → `in head` → `after head` → `in body` → `after body` → `after after body`。

〔補足〕この「head トークンが無くても HTMLHeadElement が暗黙に作られる」「stack of open elements でネスト不一致を修正する」という挙動こそ、**入力したHTMLと最終DOMが一致しない**ことの一般原理である。攻撃観点では、暗黙の要素生成・構造正規化が、サニタイザの想定するDOMとブラウザの実際のDOMをずらす。

### 6.4 パース完了時の動作

この段階でブラウザは次を行う。

1. 文書を **"interactive"** とマークする。
2. **"deferred" モードのスクリプト**（文書パース後に実行されるべきもの）のパースを開始する。
3. 文書の状態を **"complete"** に設定する。
4. **"load" イベントを発火**する。

トークン化とツリー構築の完全なアルゴリズムは、原典が挙げる `http://www.w3.org/TR/html5/syntax.html#html-parser`（現在の正本は前掲WHATWG仕様）で読める。

---

## 7. ブラウザのエラー寛容性 ―― 壊れたHTMLをどう書き換えるか

### 7.1 「Invalid Syntax」は絶対に出ない

**HTMLページで "Invalid Syntax" エラーを受け取ることは絶対にない。ブラウザは不正なコンテンツをすべて修正して先へ進む**。次のような、いくつもの規則に違反したマークアップでも、ブラウザは文句を言わず表示する。

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

`mytag` は標準タグでなく、`p` と `div` のネストは間違っている。それでもブラウザは正しく表示する。**つまりパーサのコードの多くは、HTML著者のミスを修正することに費やされている**。

**エラー処理はブラウザ間でかなり一貫しているが、驚くべきことに長らくHTML仕様の一部になってこなかった**。ブックマークや戻る/進むボタンと同様、長年ブラウザで発達したものにすぎない。多くのサイトで繰り返される既知の不正HTML構文があり、ブラウザは他ブラウザと整合する形でそれらを修正しようとする（HTML5仕様はこの要件の一部を定義するようになった）。

WebKit はこれをHTMLパーサクラス冒頭のコメントで要約している。

> パーサはトークン化された入力を document にパースし、document tree を構築していく。文書が well-formed なら、パースは素直である。
>
> 残念ながら、well-formed でないHTML文書を多数扱わなければならないので、パーサはエラーに対して寛容でなければならない。
>
> 少なくとも以下のエラー条件に対処しなければならない:
>
> 1. 追加される要素が、ある外側のタグの内部で明示的に禁止されている。この場合、その要素を禁止しているタグまですべてのタグを閉じ、その後に要素を追加する。
> 2. その要素を直接追加することが許されていない。書いた人が間のタグを忘れた（または省略可能）のかもしれない。次のタグで起こりうる: HTML HEAD BODY TBODY TR TD LI。
> 3. インライン要素の内部にブロック要素を追加したい。次の上位のブロック要素まですべてのインライン要素を閉じる。
> 4. それでも解決しない場合、要素を追加できるようになるまで要素を閉じる ―― あるいはタグを無視する。

以下、WebKit のエラー寛容性の実例を5つ見る。**いずれも「壊れたHTMLをブラウザがどう書き換えるか」の一次資料的スニペット**であり、mXSSやサニタイザバイパスを考えるときの具体例になる。

### 7.2 実例1: `</br>` を `<br>` として扱う

一部のサイトは `<br>` の代わりに `</br>` を使う。**IE と Firefox と互換にするため、WebKit はこれを `<br>` のように扱う**。

```js
if (t->isCloseTag(brTag) && m_document->inCompatMode()) {
     reportError(MalformedBRError);
     t->beginTag = true;
}
```

このエラー処理は内部的なもので、ユーザには提示されない。

### 7.3 実例2: はぐれテーブル（stray table）

stray table とは、**テーブルセルの内部ではなく、別のテーブルの内部にあるテーブル**のこと。

```html
<table>
  <table>
    <tr><td>inner table</td></tr>
  </table>
  <tr><td>outer table</td></tr>
</table>
```

**WebKit は階層を2つの兄弟テーブルに変更する**。

```html
<table>
  <tr><td>outer table</td></tr>
</table>
<table>
  <tr><td>inner table</td></tr>
</table>
```

```js
if (m_inStrayTableContent && localName == tableTag)
        popBlock(tableTag);
```

WebKit は現在の要素コンテンツ用のスタックを使い、内側のテーブルを外側のテーブルのスタックから pop する。これでテーブル同士が兄弟になる。

〔補足〕この「階層が入れ替わる」種類の正規化（foster parenting 的挙動）は、**サニタイザがHTMLをパース→直列化→ブラウザが再パースする際に構造が変化する典型例**であり、mXSSの主要な発生経路の1つである。入力時の入れ子と、ブラウザが最終的に作るDOMの入れ子が食い違う点に注目する。

### 7.4 実例3: 入れ子の form 要素

form の中に別の form を置くと、**2番目の form は無視される**。

```js
if (!m_currentFormElement) {
        m_currentFormElement = new HTMLFormElement(formTag,    m_document);
}
```

〔補足〕「内側の form が無視される」挙動は、フォーム構造を前提にした防御（CSRFトークンの配置など）を解析するときに重要になる。設計者が「このformの中に入る」と思っていた入力が、実は別のformに属することが起こりうる。

### 7.5 実例4: 深すぎるタグ階層

WebKit のコメントが自ら語る。

> `www.liceo.edu.mx` は、大量の `<b>` だけで約 1500 タグのネストレベルを達成しているサイトの例である。
> 同じ型のネストしたタグは最大 20 個までしか許さず、それを超えたら全部まとめて無視する。

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

数値を押さえる: 実例サイトのネストレベルは**約1500**、同型タグの許容ネスト上限は **20**（`cMaxRedundantTagDepth`）。この上限を超えた分は無視されるので、入力の入れ子と実際のDOMの深さは一致しない。

### 7.6 実例5: 誤った位置の html / body 終了タグ

再びコメントが自ら語る。

> 本当に壊れたHTMLのサポート。
> body タグは決して閉じない。一部の愚かなWebページが、文書の実際の終わりより前に body を閉じてしまうからだ。
> 物事を閉じるのは `end()` 呼び出しに任せよう。

```js
if (t->tagName == htmlTag || t->tagName == bodyTag )
        return;
```

原典は「だからWeb著者は気をつけて ―― WebKitのエラー寛容性コードのスニペットに実例として登場したくないなら、well-formed なHTMLを書こう」と締めくくる。診断者の側から言い換えると、**「早すぎる `</body>` や `</html>` はブラウザに無視される」**ので、これを前提にした入力の切り分けは危険である。

---

## 8. CSSのパース ―― 文脈自由文法だから素直

### 8.1 CSSは通常のパーサでパースできる

**HTMLと違い、CSSは文脈自由文法であり、序論で説明した種類のパーサでパースできる**。CSS仕様はCSSの字句文法（語彙）と構文文法を定義している（`http://www.w3.org/TR/CSS2/grammar.html`）。字句文法は各トークンの正規表現で定義される。

```markup
comment   \/\*[^*]*\*+([^/*][^*]*\*+)*\/
num       [0-9]+|[0-9]*"."[0-9]+
nonascii  [\200-\377]
nmstart   [_a-z]|{nonascii}|{escape}
nmchar    [_a-z0-9-]|{nonascii}|{escape}
name      {nmchar}+
ident     {nmstart}{nmchar}*
```

ここで **"ident" は identifier の略でクラス名のようなもの**、**"name" は要素の id（"#" で参照されるもの）**を表す。構文文法はBNFで記述される。

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

次の ruleset を例に取る。

```css
div.error, a.error {
  color:red;
  font-weight:bold;
}
```

`div.error` と `a.error` がセレクタ、波括弧の内側がこの ruleset で適用される規則である。上のBNFは「**ruleset は1つ以上のセレクタ（カンマと空白 S で区切る）と、波括弧内の1つ以上の declaration（セミコロンで区切る）からなる**」ことを意味する。

### 8.2 WebKit と Firefox のCSSパーサ

- **WebKit は Flex と Bison を使い、CSS文法ファイルからパーサを自動生成**する。**Bison は bottom up の shift-reduce パーサ**を作る。
- **Firefox は手書きの top down パーサ**を使う。
- どちらの場合も、**各CSSファイルは StyleSheet オブジェクトにパース**される。各オブジェクトはCSS rule を含み、**CSS rule オブジェクトはセレクタオブジェクトと declaration オブジェクト**などを含む。

HTMLとCSSで実装アプローチが対照的（HTMLは専用カスタムパーサ、CSSはジェネレータ生成/手書き）である点が、両者の「文法の性質の違い」を反映している。

---

## 9. スクリプトとスタイルシートの処理順序

### 9.1 スクリプトは同期モデル ―― パースを止める

- **Webのモデルは同期的（synchronous）**。パーサが `<script>` タグに達したとき、スクリプトが即座にパース・実行されることを著者は期待する。
- **スクリプトが実行されるまで文書のパースは停止（halt）する**。
- **外部スクリプトの場合、まずリソースをネットワークから取得**しなければならない。これも同期的で、取得までパースは停止する。
- これは長年のモデルで、**HTML4/HTML5 の仕様でも規定**されている。
- 著者は **`defer` 属性**を追加でき、その場合パースを止めず**文書がパースされた後に実行**される。
- **HTML5 はスクリプトを非同期（`async`）としてマークするオプション**を追加し、別スレッドでパース・実行させる。

```
...HTMLパース中... ──▶ <script src=...>  ⏸ パース停止
                          │ ネットワークから取得（同期）
                          │ 実行
                          ▼
...パース再開...
```

### 9.2 投機的パース（speculative parsing）/ preload scanner

**WebKit と Firefox は投機的パースという最適化を行う。スクリプトを実行している間、別スレッドが文書の残りをパースし、ネットワークから読み込む必要がある他のリソースを見つけて読み込む**。これでリソースが並列コネクションで読み込まれ、全体が速くなる。

**注意: 投機的パーサは外部スクリプト・スタイルシート・画像といった外部リソースへの参照だけをパースする。DOMツリーは変更しない ―― それはメインパーサに任される**。

〔補足（出典: MDN「Populating the page: how browsers work」）〕現行のMDNドキュメントは同じ機構を **"preload scanner"（プリロードスキャナ）** と呼ぶ。「メインスレッドがDOMツリーを構築している間、preload scanner が利用可能なコンテンツをパースし、CSS・JavaScript・Webフォントのような高優先度リソースを先行要求する」。Chrome公式の解説では「preload scanner は HTMLパーサが生成したトークンを覗き見し、network thread にリクエストを送る」と実装的に説明されている。原典の「speculative parsing」と同じものを指す、現行の呼び名だと理解しておく。

### 9.3 スタイルシートはスクリプトをブロックしうる

スタイルシートは異なるモデルを持つ。概念的にはDOMツリーを変えないので、待つ理由はないように見える。**しかし、パース段階中にスクリプトがスタイル情報を要求するという問題がある**。スタイルがまだ読み込み・パースされていなければスクリプトは間違った答えを得るため、これが多くの問題を引き起こす（エッジケースに見えて、実はかなり一般的である）。

- **Firefox は、まだ読み込み・パース中のスタイルシートがあるとき、すべてのスクリプトをブロックする**。
- **WebKit は、スクリプトが未読み込みのスタイルシートに影響される可能性のある特定のスタイルプロパティにアクセスしようとしたときにだけブロックする**。

〔補足（出典: MDN）〕現代的な言い換えでは「CSSの取得待ちはHTMLのパースやダウンロードをブロックしないが、JavaScript はブロックする。JavaScript はしばしば要素に対するCSSプロパティの影響を問い合わせるからである」となる。

〔補足〕この「スクリプト実行がパースを止める／スタイルがスクリプトを止める」という同期関係は、**読み込み順を操作するレース攻撃**や、**パフォーマンス計測を使ったサイドチャネル**の前提知識になる。原典はセキュリティ的含意を述べていないが、順序に依存する挙動は攻撃者にとって観測・操作の対象である。

---

## 10. render tree の構築 ―― DOMと1対1でない視覚ツリー

### 10.1 render tree とは

DOMツリーが構築されている間、ブラウザは別のツリー ―― **render tree** を構築する。**これは表示される順序に並んだ視覚要素のツリーであり、文書の視覚的表現**である。目的は、コンテンツを正しい順序で描画できるようにすること。Firefox はこの要素を **"frames"**、WebKit は **renderer / render object** と呼ぶ。renderer は自分自身と自分の子をレイアウトし描画する方法を知っている。

WebKit の RenderObject クラス（renderer の基底クラス）はこう定義される。

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

（注: 原文のスペルのまま `containgLayer`。コメントも原文のまま。）**各 renderer は、通常ノードのCSSボックス（CSS2仕様が記述するもの）に対応する矩形領域**を表し、幅・高さ・位置といった幾何情報を含む。

**ボックスの型は、ノードの style 属性の "display" 値に影響される**。DOMノードにどの型の renderer を作るかを決めるWebKitのコードは次のとおり。

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

要素の型も考慮される（フォームコントロールやテーブルは特別な frame を持つ）。WebKit では、特別な renderer を作りたい要素は `createRenderer()` メソッドをオーバーライドする。

### 10.2 render tree と DOM tree は1対1でない

**renderer は DOM 要素に対応するが、関係は1対1ではない**。ここは診断で頻繁に効くので表にまとめる。

| 関係のパターン | 内容 |
| --- | --- |
| render tree に入らない | **非視覚的なDOM要素は render tree に入らない**（例: `head`）。また **`display: none` の要素はツリーに現れない**（一方 **`visibility: hidden` の要素は現れる**） |
| 1 DOM要素 → 複数の視覚オブジェクト | 単一の矩形で記述できない複雑な構造。例: **`select` は3つの renderer**（表示領域・ドロップダウン・ボタン）。また**テキストが複数行に分割されると、新しい行が余分な renderer として追加**される |
| 壊れたHTMLによる複数 renderer | CSS仕様では**インライン要素はブロック要素のみ、またはインライン要素のみを含む**べき。混在時は、インライン要素を包む **anonymous block renderer（無名ブロックレンダラ）** が作られる |
| ツリー上の位置がDOMと違う | **float と絶対配置の要素は out of flow**（フローの外）で、ツリーの別の部分に置かれる。本来の場所には **placeholder frame（プレースホルダフレーム）** が置かれる |

render tree のルートは、**"Viewport"（initial containing block）**に対応する。WebKit ではこれが **"RenderView"** オブジェクトになる。

〔補足〕**`display:none` は render tree に載らないが、`visibility:hidden` は載る**という区別は、「見えないが存在する」要素を扱う診断で重要である（隠しフィールド、オフスクリーン要素の調査など）。この区別は現行のMDNドキュメントも同内容で追認しているので、安心して断言してよい箇所である。

### 10.3 ツリー構築の流れ（attachment）

- **Firefox では、presentation が DOM 更新のリスナとして登録され、frame 生成を `FrameConstructor` に委譲**。constructor がスタイルを解決して frame を作る。
- **WebKit では、スタイルを解決して renderer を作るプロセスを "attachment"（アタッチメント）と呼ぶ**。すべてのDOMノードが `attach` メソッドを持ち、**Attachment は同期的**で、DOMツリーへのノード挿入が新しいノードの `attach` を呼ぶ。

html と body の処理でルートが構築される。ルートの render object は CSS仕様の **containing block**（他の全ブロックを含む最上位ブロック）に対応し、その寸法は viewport（ブラウザウィンドウの表示領域）の寸法。Firefox は `ViewPortFrame`、WebKit は `RenderView` と呼ぶ。

---

## 11. スタイル計算 ―― 3つの課題と3つの最適化

### 11.1 スタイルの出自と3つの課題

render tree の構築には、各 render object の視覚プロパティを計算する必要がある。スタイルには、さまざまな**出自（origins）**のスタイルシート、インライン style 要素、HTML内の視覚プロパティ（`bgcolor` のようなもの）が含まれる（後者は対応するCSSプロパティに変換される）。

スタイルシートの出自は次の3つ。

1. **ブラウザのデフォルトスタイルシート**
2. **ページ著者が提供するスタイルシート**
3. **ユーザスタイルシート**（ブラウザの利用者が提供。Firefoxなら "Firefox Profile" フォルダに置く）

スタイル計算には3つの困難がある。

1. **スタイルデータは非常に大きな構造**で、多数のプロパティを保持するため、メモリの問題を起こしうる。
2. **各要素にマッチする規則を見つけるのが重い**。要素ごとに規則リスト全体を走査するのは高コストで、セレクタは複雑な構造を持ちうるため、有望に見えたパスが無駄と判明することもある。次の複合セレクタを見る。

   ```css
   div div div div{
   ...
   }
   ```

   これは「3つのdivの子孫である `<div>`」に適用される。ある `<div>` にこれが適用されるか調べるには、ツリーを上に辿るパスを選ぶ。**divが2つしかなく適用されないと判明するためだけに、ノードツリーを上に辿り、別のパスを試す**羽目になりうる。
3. **規則の適用には、規則の階層を定義するかなり複雑なカスケード規則**が関わる。

以下、この3課題を解く**3つの最適化**（データの共有・Firefoxのrule tree・ハッシュマップ）を順に見る。

### 11.2 最適化1: スタイルデータの共有（RenderStyle の10条件）

**WebKit のノードは style オブジェクト（RenderStyle）を参照し、一定条件下でノード間で共有できる**。ノードが兄弟（siblings）または「いとこ（cousins）」であり、次の10条件をすべて満たす場合に共有できる。

| # | 共有条件 |
| --- | --- |
| 1 | 同じマウス状態であること（一方が `:hover` で他方がそうでない、は不可） |
| 2 | どちらの要素も id を持たないこと |
| 3 | タグ名が一致すること |
| 4 | class 属性が一致すること |
| 5 | マップされた属性の集合が同一であること |
| 6 | リンク状態（link states）が一致すること |
| 7 | フォーカス状態（focus states）が一致すること |
| 8 | どちらの要素も属性セレクタの影響を受けないこと（「影響を受ける」＝セレクタ内の任意の位置で属性セレクタを使うマッチを持つこと） |
| 9 | インライン style 属性が存在しないこと |
| 10 | 兄弟セレクタ（sibling selectors）が一切使われていないこと。**WebCore は兄弟セレクタに遭遇すると単純にグローバルスイッチを投げ、それらが存在する間は文書全体でスタイル共有を無効化する**（`+` セレクタ、`:first-child`、`:last-child` を含む） |

これで課題1（データ量）と課題3（カスケード）の一部が緩和される。

### 11.3 最適化2: Firefox の rule tree と style context tree

**Firefox はスタイル計算を容易にするため2つの追加ツリーを持つ: rule tree（ルールツリー）と style context tree（スタイルコンテキストツリー）**。WebKit も style オブジェクトを持つが、こうしたツリーには格納せず、DOMノードが関連スタイルを指すだけである。

**style context は end values（最終値）を含む**。値は、マッチする全規則を正しい順序で適用し、論理値から具体値へ変換して計算される（例: 画面のパーセンテージを絶対単位に変換）。

**rule tree のアイデアは巧妙で、これらの値をノード間で共有して再計算を避ける**（空間も節約する）。

- マッチした全規則はツリーに格納され、**パス上の下の方のノードほど高い優先度**を持つ。
- ツリーは、見つかった規則マッチの全パスを含む。
- **格納は遅延的（lazily）**。最初に全ノードを計算するのではなく、あるノードのスタイル計算が必要になったとき、そのパスがツリーに追加される。

**アイデアはツリーのパスを辞書（lexicon）の単語のように見ること**。すでに `A-B-E-I-L` のパスが計算済みだとする。別要素のマッチ規則が（正しい順序で）`B-E-I` だと判明したとき、`A-B-E-I-L` のパスが既にあるので、このパスは再利用でき、作業が減る。

```
rule tree（例）          再利用の考え方
   A                     ある要素のマッチが B-E-I
   └─ B                  → A-B-E-I-L が既にあるので
      └─ E                  そのパス上を辿るだけでよい
         └─ I
            └─ L
```

#### structs への分割

**style context は structs（構造体）に分割される**。各 struct は border や color といった特定カテゴリの情報を含み、**1つの struct 内の全プロパティは、継承される（inherited）か継承されない（non inherited）かのどちらかに揃っている**。

- **継承プロパティ（inherited）**: 要素で定義されていなければ親から継承。
- **非継承プロパティ（"reset" プロパティ）**: 定義されていなければデフォルト値。

**ツリーは、計算済み end values を含む struct 全体をツリー内にキャッシュ**することで役立つ。下のノードが struct を定義しなければ、上のノードのキャッシュ済み struct を使える。

#### rule tree を使った style context の計算（手順）

ある要素の style context を計算するとき、次の手順を踏む。

1. まず rule tree 内のパスを計算するか、既存のものを使う。
2. パス上の規則を適用し、新しい style context の structs を埋める。**パスの最下ノード（最も優先度が高い＝通常は最も詳細度の高いセレクタ）から始め、struct が埋まるまでツリーを上へ辿る**。
3. その rule node に struct の指定がなければ大きく最適化できる。**struct を完全に指定するノードが見つかるまで上へ行き、それを指すだけ**（struct 全体を共有 ―― 計算とメモリを節約）。
4. 部分的な定義が見つかった場合は、struct が埋まるまで上へ行く。
5. **struct の定義が全く見つからない場合、"inherited" 型なら context tree の親の struct を指す**（この場合も共有成功）。reset struct ならデフォルト値を使う。
6. 最も詳細なノードが値を追加する場合は、実際の値に変換する追加計算が必要。**結果をツリーノードにキャッシュ**し子が使えるようにする。
7. **同じツリーノードを指す兄弟があれば、style context 全体を共有できる**。

具体例を追う。次のHTMLとCSSを使う。

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

```css
div {margin: 5px; color:black}
.err {color:red}
.big {margin-top:3px}
div span {margin-bottom:4px}
#div1 {color:blue}
#div2 {color:green}
```

埋めるべきは2つの structs だけとする ―― color struct（メンバは color 1つ）と margin struct（4辺）。**2番目の `<div>`（div2）** に到達したときの処理は次のとおり。

1. このノード用の style context を作り、structs を埋める必要がある。
2. 規則をマッチさせ、div にマッチするのは規則 **1, 2, 6** と判明する。使えるパスは既にあり、**規則6のためのノードを1つ追加するだけでよい（rule tree のノードF）**。
3. style context を作り context tree に置く。新しい style context は rule tree のノードFを指す。
4. margin struct を埋める。**最後の rule node（F）は margin に何も追加しないので、上へ辿ってキャッシュ済み struct（ノードBで margin を指定）を使う**。
5. color struct は定義があるのでキャッシュは使えない。color は属性1つなので上へ行く必要はなく、**end value を計算（文字列→RGB）してこのノードにキャッシュ**。
6. 2番目の `<span>` はさらに簡単。前の span と同様に規則Gを指すと分かり、同じノードを指す兄弟があるので、**style context 全体を共有**（前の span の context を指すだけ）。

**親から継承される structs のキャッシュは context tree 上で行われる**（color は実際には継承されるが、Firefox は reset として扱い rule tree にキャッシュする）。たとえば段落にフォント規則を足すと、

```css
p {font-family: Verdana; font size: 10px; font-weight: bold}
```

（注: 原文のまま `font size` と誤記。正しくは `font-size`。）div の子である段落は、段落に font 規則が指定されていなければ親と同じ font struct を共有できたはずである。

**rule tree を持たない WebKit では、マッチした declarations が4回走査される**。

| 順序 | 走査内容 |
| --- | --- |
| 1回目 | non-important high priority properties（他がそれに依存するため最初。例: `display`） |
| 2回目 | high priority important |
| 3回目 | normal priority non-important |
| 4回目 | normal priority important |

これで複数回現れるプロパティが正しいカスケード順序で解決される（**最後が勝つ ―― The last wins**）。まとめると、style オブジェクトの共有（全体または一部の structs）が課題1・3を解決し、Firefox の rule tree はプロパティを正しい順序で適用することにも役立つ。

### 11.4 最適化3: マッチを容易にするハッシュマップ（95%以上を除去）

スタイル規則の出所は3種類ある。

| # | 出所 | 例 |
| --- | --- | --- |
| 1 | CSS rules（外部スタイルシート内、または style 要素内） | `p {color: blue}` |
| 2 | Inline style attributes | `<p style="color: blue" />` |
| 3 | HTML visual attributes（関連するスタイル規則にマップ） | `<p bgcolor="blue" />` |

**後の2つは要素に容易にマッチ**する（要素自身が style 属性を持ち、HTML属性は要素をキーにマップできる）。厄介なのは課題#2の CSS 規則のマッチングで、これを解くため**規則をアクセスしやすく加工する**。

**スタイルシートをパースした後、規則はセレクタに応じて複数のハッシュマップのいずれかに追加される**。id によるマップ、class name によるマップ、tag name によるマップ、そしてどれにも収まらないものの汎用マップがある。セレクタが id なら id マップへ、class なら class マップへ、という具合である。**この加工により、全 declaration を見る必要がなくなり、マップから要素に関連する規則を抽出できる。この最適化は規則の 95% 以上を除去する**（原典の注記 (4.1)）。

例の規則:

```css
p.error {color: red}
#messageDiv {height: 50px}
div {margin: 5px}
```

1番目は class マップ、2番目は id マップ、3番目は tag マップに挿入される。次のHTML断片を処理する。

```html
<p class="error">an error occurred</p>
<div id=" messageDiv">this is a message</div>
```

（原文の `id=" messageDiv"` の先頭空白もそのまま。）まず p 要素の規則を探す ―― class マップの "error" キーの下に "p.error" が見つかる。div 要素は id マップと tag マップに関連規則を持つ。あとは、抽出された規則のうちどれが本当にマッチするかを見るだけである。

**キーは最右のセレクタ（the rightmost selector）**である点が重要。たとえば div の規則が次だとする。

```css
table div {margin: 5px}
```

これは tag マップから**依然として抽出される（キーが最右セレクタ `div` だから）**が、table の祖先を持たない div にはマッチしない。WebKit と Firefox の両方がこの加工を行う。

> ### 📌 ここは自分で開いて読んでください
> **資料**: David Hyatt「Implementing CSS (part 1)」（原典の注記 (4.1) が指す一次資料）／ L. David Baron「Faster HTML and CSS: Layout Engine Internals for Web Developers」（注記 (3.1)）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: いずれも2006〜2010年頃のWebKit/Mozilla関連リンクで、リンク切れの可能性が高く、当セッションからは未取得）。「規則の95%以上を除去する」「render tree と DOM tree の対応」といった**定量的・断定的な主張の根拠**は、これら一次文献に紐づいている。
> **読みどころ**:
> 1. 「95%以上を除去」という数字の出どころと、ハッシュマップ最適化の実装詳細（Implementing CSS）。教科書でこの数字を引用するなら、ここまで辿るのが誠実。
> 2. レイアウトエンジンの内部（Faster HTML and CSS）。セレクタパフォーマンスとスタイル再計算の実務判断の根拠。
> **代替手段**: 注記番号 (1.1)(2.2)(3.1)(3.5)(3.6)(4.1) は現行の web.dev 版では削除されているため、本文のどの記述がどの文献に由来するかを追うには、原典 html5rocks 版のソースHTML（`https://raw.githubusercontent.com/hungdt138/html5rocks/HEAD/www.html5rocks.com/content/tutorials/internals/howbrowserswork/en/index.html`。各文献に `id="4_1"` 等が振られ、本文から `href="#4_1"` でリンクされている）を見る。同等の現行資料としては MDN「Populating the page: how browsers work」の Style 節が使える。

---

## 12. カスケード順序と詳細度（specificity）

### 12.1 正しいカスケード順序で規則を適用する

style オブジェクトは全視覚属性に対応するプロパティを持つ。プロパティがどの規則でも定義されていなければ、**一部は親要素の style から継承**でき、他はデフォルト値を持つ。問題は**定義が複数あるとき**に始まり、ここで**カスケード順序**が解決する。

あるプロパティの declaration は、複数のスタイルシートに現れることも、1つのシート内で複数回現れることもある。だから**適用順序が非常に重要**で、これを "cascade" 順序と呼ぶ。CSS2仕様によれば、カスケード順序は低→高で次のとおり。

| 優先度 | declaration の種類 |
| --- | --- |
| 1（最低） | Browser declarations（ブラウザ宣言） |
| 2 | User normal declarations（ユーザの通常宣言） |
| 3 | Author normal declarations（著者の通常宣言） |
| 4 | Author important declarations（著者の important 宣言） |
| 5（最高） | User important declarations（ユーザの important 宣言） |

**ブラウザ宣言が最も弱く、ユーザが著者を上書きできるのは宣言が important のときだけ**である。同じ順位の宣言は **specificity（詳細度）** でソートされ、その後に指定された順序でソートされる。HTMLの視覚属性は対応するCSS宣言に変換され、**低優先度の著者規則**として扱われる。

### 12.2 詳細度（specificity）の計算

セレクタの詳細度は CSS2仕様で次のように定義される。

1. 宣言がセレクタを持つ規則ではなく `style` 属性由来なら 1、そうでなければ 0（= **a**）
2. セレクタ内の ID 属性の数（= **b**）
3. セレクタ内の他の属性および擬似クラスの数（= **c**）
4. セレクタ内の要素名および擬似要素の数（= **d**）

**4つの数 a-b-c-d を（大きな基数の数体系で）連結すると詳細度**になる。使う基数は、いずれかのカテゴリの最大カウントで決まる（例: a=14 なら16進基数、a=17 のようなありそうもないケースでは17桁の基数。後者は `html body div div p…` のようにタグが17個あるセレクタで起こりうる）。具体例は次のとおり。

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

### 12.3 規則のソート

マッチ後、規則はカスケード規則に従ってソートされる。**WebKit は小さいリストにはバブルソート、大きいリストにはマージソート**を使い、規則の `>` 演算子をオーバーライドしてソートを実装する。

```css
static bool operator >(CSSRuleData& r1, CSSRuleData& r2)
{
    int spec1 = r1.selector()->specificity();
    int spec2 = r2.selector()->specificity();
    return (spec1 == spec2) : r1.position() > r2.position() : spec1 > spec2;
}
```

（注: 原文のまま。三項演算子の `?` が抜けている原文の誤植を含む。意図は「詳細度が同じなら位置で比較、異なれば詳細度で比較」である。原典はこのC++コードを ` ```css ``` のコードフェンスで囲んでいる。）

### 12.4 段階的プロセスとFOUC対策

最後に、スタイルの読み込みが間に合わない場合の扱いを見る。**WebKit は、すべてのトップレベルのスタイルシート（`@imports` を含む）が読み込まれたかを示すフラグを使う**。attach 時にスタイルが完全に読み込まれていなければ、**プレースホルダが使われ、文書にそれがマークされる。スタイルシートが読み込まれたら再計算される**。

〔補足〕記事末尾の Resources に David Hyatt「The FOUC Problem」(`http://webkit.org/blog/66/the-fouc-problem/`) が挙げられており、この節は FOUC（Flash Of Unstyled Content、スタイル未適用コンテンツの一瞬の表示）対策の実装に対応する。FOUCとは、CSSが適用される前の素のHTMLが一瞬見えてしまう現象のこと。

---

## 13. 内部挙動と脆弱性の接続点（まとめ表）

ここまでの各トピックが、クライアントサイド脆弱性ハンティングのどこに繋がるかを一覧にする。**いずれも許可された診断・バグバウンティ・自分で立てた検証環境を前提とした技術解説**であり、必ず防御・検出と対で考える。

| 本節の記述 | 脆弱性ハンティングへの接続 |
| --- | --- |
| HTMLは文脈自由文法でない／エラー寛容 | サニタイザ・WAF・テンプレートのHTMLパースとブラウザのパースの差（**parser differential**）→ **mXSS**、フィルタバイパス |
| tokenizer が状態機械で、同じ文字が状態次第で意味を変える | RCDATA/RAWTEXT/コメント/foreign content ごとにエスケープ要件が違う理由。**文脈を跨いだ再パースの危険** |
| tree construction の stack of open elements / insertion modes / 暗黙の要素生成 | 「入力したHTMLと最終DOMが一致しない」ことの一般原理。stray table の兄弟化、form のネスト無視など構造正規化 |
| `document.write()` によるパースの再入性 | パース中のDOM注入、スクリプト実行タイミングの操作 |
| DOM は「JavaScriptに対するHTML要素のインタフェース」 | **DOM clobbering**（HTML要素が JS のグローバル／プロパティを上書き）の前提 |
| スクリプトが同期的にパースを止める／投機的パーサが外部リソースだけ先読み | リソース読み込み順の操作、レース条件、preload scanner 由来の副作用 |
| painting order / render tree に載る要素（詳細は続きの節） | クリックジャッキング、UI redressing の診断 |
| render tree に載らない要素（`display:none`）と載る要素（`visibility:hidden`） | 「見えないが存在する」要素の扱い。隠しフィールド・オフスクリーン要素の調査 |
| タブごとの別プロセス | プロセス／サイト分離の前提。同一プロセスに載るオリジンの組み合わせを考える出発点 |

---

## 手を動かす

以下は、自分のブラウザ（自分の環境）とローカルの検証ファイルだけで完結する、安全な観察手順である。他人のサイトに対しては行わない。

1. **エラー寛容性を自分の目で見る（stray table）**。ローカルに `stray.html` を作り、次を保存してブラウザで開く。

   ```html
   <table>
     <table>
       <tr><td>inner table</td></tr>
     </table>
     <tr><td>outer table</td></tr>
   </table>
   ```

   開いたら開発者ツール（F12）の Elements パネルを見る。**入力の入れ子と、実際のDOMの入れ子が違う**（内側テーブルが兄弟に切り出されている）ことを確認する。これが「入力HTML ≠ 最終DOM」の実物である。

2. **暗黙の要素生成を確認する**。`<html><body>Hello</body></html>` だけのファイルを開き、Elements パネルで `<head>` が勝手に生成されていることを確認する（本節6.3の insertion mode の話の実物）。

3. **`display:none` と `visibility:hidden` の違いを確認する**。2つの `<div>` にそれぞれ `style="display:none"` と `style="visibility:hidden"` を付け、開発者ツールの Layout / Computed で、前者はボックスを持たず後者は場所を占めることを見る。

4. **詳細度を計算して答え合わせする**。1つの要素に複数のCSS規則（例: `div`、`.err`、`#div1`）を当て、本節12.2の a-b-c-d 規則で手計算した勝者と、開発者ツールの Styles パネルで「効いている宣言／打ち消された宣言」が一致するか確認する。

5. **スクリプトがパースを止めることを観察する**。`<script>` の前後に見える要素を置き、`<script>` 内で重い同期ループを回すと、スクリプト実行が終わるまで後続がレンダリングされないことを見る（本節9.1）。`defer` を付けると挙動が変わることも確認する。

## つまずきポイント

- **「原典＝現在の事実」ではない**。ブラウザ名（Chrome/Safariのエンジン）、シェアの数字、WebSQL、並列コネクション「2〜6」は2011/2013時点のスナップショット。**パース・スタイルの原理は今も有効だが、実装名や数値は現行資料（WHATWG仕様・MDN）で裏を取る**。
- **「HTMLパーサ」と「XMLパーサ」を混同しない**。HTMLは文脈自由文法でなく専用のカスタムパーサが要る。XHTML/XMLはXMLパーサでパースできる。この違いが parser differential の起点。
- **tokenizer と tree construction を1つの工程だと思わない**。前段（字句解析＝状態機械でトークンを作る）と後段（insertion modes でDOMを組む）は別の状態機械であり、それぞれに攻撃観点がある。
- **エラー寛容性の実例を「昔話」と切り捨てない**。`</br>`→`<br>`、stray table の兄弟化、form のネスト無視、同型タグ20個上限、早すぎる `</body>` の無視は、いずれも「入力と最終DOMがずれる」具体例で、mXSS/サニタイザバイパスの考え方そのもの。
- **詳細度は「桁上がりする10進数」ではない**。a-b-c-d は独立した4つのカウントで、基数は最大カウントで決まる。`0,0,1,3`（属性1・要素3）と `0,0,2,1`（属性2・要素1）では後者が勝つ、のように**上位の桁が優先**される。
- **`display:none` と `visibility:hidden` を同一視しない**。前者は render tree に載らず、後者は載る（場所を占める）。「見えない＝存在しない」ではない。
- **specificity の演算子コードの `?` 欠落は原典の誤植**。自分で書き写すときは正しい三項演算子にする。

## この節のまとめ

- ブラウザは7つの主要コンポーネント（UI／ブラウザエンジン／レンダリングエンジン／ネットワーキング／UIバックエンド／JSインタプリタ／データストレージ）からなり、Chrome系はレンダリングエンジンをタブごとに別プロセスで持つ。これがSite Isolationの土台。
- レンダリングの基本フローは「HTMLパース→DOM→スタイルパース→render tree→layout→painting」で、全HTMLを待たず**段階的（gradual）**に進む。
- WebKitとGeckoは用語が違うだけでフローは同じ（Render Tree/renderer/layout ↔ Frame tree/frame/Reflow）。
- パースは字句解析（レクサ／tokenizer）と構文解析（パーサ）に分かれ、文脈自由文法はBNFで表せて通常のパーサでパースできる。パーサには top down と bottom up（shift-reduce）があり、WebKitはFlex+Bisonを使う。
- **HTMLは文脈自由文法でない**。理由は寛容な構文・伝統的エラー寛容性・`document.write()`による再入性の3つ。だから専用カスタムパーサが要る。
- HTMLパースは2段の状態機械。**tokenization**（Data/Tag open/Tag name などの state。同じ文字が状態で意味を変える）と**tree construction**（insertion modes と stack of open elements。暗黙の要素生成やネスト修正を行う）。
- **DOMはJavaScriptに対するHTML要素のインタフェース**。これがDOM clobberingの前提。
- ブラウザは不正HTMLで「Invalid Syntax」を出さず必ず修正する。WebKitの実例5つ（`</br>`→`<br>`、stray tableの兄弟化、内側formの無視、同型タグ上限20、早すぎる`</body>`の無視）は「入力≠最終DOM」の具体例。
- **CSSは文脈自由文法**なので素直にパースでき、WebKitはFlex+Bison生成パーサ、Firefoxは手書きtop downパーサを使う。各CSSファイルはStyleSheetオブジェクトになる。
- スクリプトは同期モデルでパースを止める（`defer`/`async`で緩和）。**投機的パース／preload scanner**は別スレッドで外部リソース参照だけ先読みしDOMは触らない。スタイルシートは、スクリプトがスタイルを問い合わせる可能性があるためスクリプトをブロックしうる（Firefoxは全スクリプト、WebKitは該当プロパティにアクセス時のみ）。
- render treeは視覚要素の順序付きツリーで、DOMと1対1でない。`head`と`display:none`は載らず、`visibility:hidden`は載る。`select`は3つ、複数行テキストは行ごとにrenderer、float/絶対配置はout of flowでplaceholder frameを残す。
- スタイル計算の3課題（データ量・マッチの重さ・カスケードの複雑さ）を、3つの最適化で解く: RenderStyleの共有（10条件）、Firefoxのrule tree＋style context tree（structs単位でキャッシュ共有、遅延格納）、セレクタ最右辺をキーにしたid/class/tagハッシュマップ（**規則の95%以上を除去**）。
- カスケード順序は低→高で「ブラウザ→ユーザ通常→著者通常→著者important→ユーザimportant」。同順位は詳細度→指定順でソート。詳細度はa-b-c-d（style属性/ID/属性・擬似クラス/要素・擬似要素）。
- これらの内部挙動は、mXSS・parser differential・DOM clobbering・レース／サイドチャネル・クリックジャッキング・プロセス分離など、クライアントサイド脆弱性の土台に直結する。

## 理解度チェック

1. HTMLが「文脈自由文法でない」とされる3つの理由を挙げよ。
   ▶ 答え: ①言語の寛容な性質（タグ省略などを許す）、②よく知られた不正HTMLをサポートする伝統的エラー寛容性、③`document.write()`などによりパース中に入力自体が書き換わる再入可能（reentrant）性。

2. HTMLパースアルゴリズムの2つの段階の名前と、それぞれの役割を述べよ。
   ▶ 答え: **tokenization（トークン化）**＝字句解析で、入力を開始タグ・終了タグ・属性名・属性値などのトークンに分ける状態機械。**tree construction（ツリー構築）**＝トークンからDOM要素を作りツリーに追加する状態機械で、状態は insertion modes と呼ばれ、stack of open elements でネスト不一致や未閉じタグを修正する。

3. tokenizer で「同じ消費文字が異なる結果をもたらす」のはなぜか。攻撃観点との関係も述べよ。
   ▶ 答え: 判断が現在のトークン化状態と tree construction 状態の両方に影響されるため、同じ文字でも状態次第で次の状態が変わる。これが RCDATA/RAWTEXT/コメント/foreign content で文脈ごとにエスケープ規則が違う理由であり、文脈を跨いだ再パースがmXSSを生む起点になる。

4. `display:none` と `visibility:hidden` は render tree での扱いがどう違うか。
   ▶ 答え: `display:none` の要素は render tree に現れない（ボックスを持たない）が、`visibility:hidden` の要素は render tree に現れ、場所を占める。「見えないが存在する」要素の扱いとして診断で重要。

5. WebKit のエラー寛容性の実例を2つ挙げ、それぞれ入力と最終DOMがどうずれるか説明せよ。
   ▶ 答え（例）: ①stray table ―― テーブルの直下にあるテーブルは、2つの兄弟テーブルに切り出される。②入れ子の form ―― form の中の2番目の form は無視される。他に `</br>`→`<br>`、同型タグの許容ネスト上限20（`cMaxRedundantTagDepth`）超過分の無視、早すぎる `</body>`/`</html>` の無視、も可。

6. スタイル計算の3つの課題は何か。それぞれを緩和する最適化を1つずつ挙げよ。
   ▶ 答え: ①データ量が巨大 → RenderStyle の共有（またはstruct単位のキャッシュ共有）、②各要素のマッチが重い → セレクタ最右辺をキーにしたハッシュマップ（95%以上を除去）、③カスケードが複雑 → Firefox の rule tree（正しい順序での適用）や共有。

7. セレクタ `ul ol li.red` の詳細度 a-b-c-d を計算せよ。
   ▶ 答え: a=0（style属性でない）、b=0（IDなし）、c=1（クラス `.red` が1つ）、d=3（要素名 ul, ol, li が3つ）で、specificity = 0,0,1,3。

8. カスケード順序を低→高で並べよ。ユーザが著者のスタイルを上書きできるのはどんなときか。
   ▶ 答え: 低→高で「ブラウザ宣言 → ユーザ通常宣言 → 著者通常宣言 → 著者important宣言 → ユーザimportant宣言」。ユーザが著者を上書きできるのは、ユーザの宣言が important とマークされているときだけ。

9. 投機的パース（speculative parsing / preload scanner）は何をして、何をしないか。
   ▶ 答え: スクリプト実行中に別スレッドが文書の残りをパースし、外部スクリプト・スタイルシート・画像といった外部リソースへの参照を見つけて先読み・並列取得する。ただし**DOMツリーは変更しない**（それはメインパーサの仕事）。

10. 「DOMはJavaScriptに対するHTML要素のインタフェースである」という性質は、どのクライアントサイド攻撃の前提になるか。
    ▶ 答え: DOM clobbering。HTML要素（`id`/`name` を持つもの）がJavaScriptのグローバル変数やプロパティ名でアクセスでき、それらを上書きしてしまう挙動を悪用する。

## 出典

- How Browsers Work: Behind the Scenes of Modern Web Browsers（Tali Garsiel / Paul Irish） 原典: https://www.html5rocks.com/tutorials/internals/howbrowserswork/
- 同 現行の正本（web.dev版）: https://web.dev/articles/howbrowserswork
- 原典HTMLソース（GitHubミラー、全文・注記番号入り）: https://raw.githubusercontent.com/hungdt138/html5rocks/HEAD/www.html5rocks.com/content/tutorials/internals/howbrowserswork/en/index.html
- 現行版Markdownソース（GitHubミラー、全文）: https://raw.githubusercontent.com/Youssef1313/web.dev/HEAD/src/site/content/en/blog/howbrowserswork/index.md
- WHATWG HTML Standard「Parsing HTML documents」: https://html.spec.whatwg.org/multipage/parsing.html
- MDN「Populating the page: how browsers work」: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work
- 原典が参照する一次資料（注記先）: David Hyatt「Implementing CSS (part 1)」／ L. David Baron「Faster HTML and CSS: Layout Engine Internals for Web Developers」／ Grosskurth, Alan「A Reference Architecture for Web Browsers」／ David Hyatt「The FOUC Problem」 http://webkit.org/blog/66/the-fouc-problem/

<!-- self-read: https://web.dev/articles/howbrowserswork | egress 403でサイト到達不可、かつ図がすべて画像でテキストミラーに含まれない -->
<!-- self-read: https://html.spec.whatwg.org/multipage/parsing.html | 当セッションから到達不可。tokenizerの全stateとinsertion modesの完全一覧はこの一次資料にしかない -->
<!-- self-read: http://webkit.org/blog/66/the-fouc-problem/ | 注記先の一次資料（2006〜2010年頃のリンクでリンク切れの可能性が高く未取得）。95%除去などの定量的主張の根拠 -->

<!-- sources: https://www.html5rocks.com/tutorials/internals/howbrowserswork/, https://web.dev/articles/howbrowserswork, https://raw.githubusercontent.com/hungdt138/html5rocks/HEAD/www.html5rocks.com/content/tutorials/internals/howbrowserswork/en/index.html, https://raw.githubusercontent.com/Youssef1313/web.dev/HEAD/src/site/content/en/blog/howbrowserswork/index.md, https://html.spec.whatwg.org/multipage/parsing.html, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work, http://webkit.org/blog/66/the-fouc-problem/ -->
<!-- terms: レンダリングエンジン, WebKit, Gecko, Blink, DOM, content tree, render tree, パースツリー, 文脈自由文法, BNF, レクサ, tokenizer, shift-reduce parser, Flex, Bison, DTD, tokenization, tree construction, insertion modes, stack of open elements, document.write, 再入可能, エラー寛容性, parser differential, mXSS, DOM clobbering, anonymous block renderer, display:none, visibility:hidden, RenderObject, RenderView, attachment, speculative parsing, preload scanner, RenderStyle, rule tree, style context tree, struct, カスケード順序, specificity, 詳細度, FOUC, viewport, containing block -->
