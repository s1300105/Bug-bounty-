# ブラウザの内部構造とレンダリングパイプライン（前編）— 高レベル構造からパース・レンダーツリー・スタイル計算まで

> **この節で分かること**
> - ブラウザが 7 つのコンポーネント（UI／ブラウザエンジン／レンダリングエンジン／ネットワーク／UI backend／JavaScript インタプリタ／データストレージ）に分かれる理由と、それぞれがどの信頼境界に属するかを説明できる。
> - レンダリングエンジンの「メインフロー」（HTML パース→DOM→レンダーツリー→レイアウト→ペイント）が段階的に進む仕組みを図で説明できる。
> - HTML パーサがなぜ「構文エラーを絶対に出さず」不正な入力を必ず修復するのか、その具体例（`</br>`、stray table、入れ子 form、20 段超の同種タグ）を挙げられる。
> - HTML パーサのエラー耐性・`document.write` による reentrant なパース・DOM とレンダーツリーが 1:1 でない点が、mutation XSS やサニタイザ回避、UI redressing の土台になる理由を説明できる。
> - CSS パースとスタイル計算（カスケード順・specificity・スタイル共有）の仕組みを自分で追跡できる。

**元資料**: https://codeburst.io/how-browsers-work-6350a4234634 （原典は取得できず二次情報ベース。実体は下記の一次資料に置き換えて執筆）
**関連する節**: 07b（同じ原典の後編：レイアウト・ペイント・スレッドモデル・視覚モデル）

---

## 0. この節の材料について（重要な前提）

この節は本来、codeburst.io の記事「How Browsers Work」を教材にする予定だった。だがこの記事は、独立した研究ではなく **Tali Garsiel と Paul Irish による古典的名著「How browsers work: behind the scenes of modern web browsers」（HTML5Rocks, 2011 年 8 月 5 日初出）の読解ノート**である。正式タイトルは「Notes on "How Browsers Work"」であり、複数の第三者リポジトリの引用からもそれが裏付けられている。

そのため本節は、codeburst 記事の代わりに **その原典そのものの全文**（WebPlatform Docs に再掲された Markdown 版）と、原典を逐語引用しつつ現代的な補強を加えた二次資料をおもな典拠とする。codeburst 記事の本文そのものは執筆環境から 1 文字も取得できなかったので、その記事固有の言い回しや独自の図は本節では一切主張しない。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Notes on "How Browsers Work"（codeburst.io） — https://codeburst.io/how-browsers-work-6350a4234634
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側（エグレスプロキシ）の制限で `codeburst.io` / `medium.com` への接続が組織ポリシーで拒否され、アーカイブや抽出プロキシもすべて遮断された）。記事が Medium の Member-only（有料会員限定）かどうかは執筆環境では確認できていない。以下の記述は原典と二次情報にもとづく要約である。
> **読みどころ**:
> 1. まず記事の位置づけを確認する。これは Garsiel & Irish 原典の読解ノートなので、「原典のどの節を要約し、どこを著者が独自に補ったか」を意識して読む。
> 2. ブラウザの高レベル構造の図（7 コンポーネント）と、メインフローの図（HTML Parser→DOM Tree→Render Tree→Layout→Painting、CSS Parser の合流）。
> 3. HTML パースの 2 段（tokenization と tree construction）とステートマシンの状態名。脆弱性ハンティングで最も使う知識。
> 4. エラー耐性の実例（`</br>`、stray table、入れ子 form の無視など）。mXSS とサニタイザ回避の理論的基礎。
> **代替手段**: 最優先の代替は原典そのもの（GitHub 経由で読める Garsiel & Irish の全文）。Medium 側 `https://medium.com/codeburst/how-browsers-work-6350a4234634` でも同じ記事に到達でき、無料枠・シークレットウィンドウ・ログインで読めることが多い。同等の無料資料として MDN と Chrome 公式ドキュメント（本節 07b で扱う）。

原典自身が、内部構造を学ぶ意義をこう述べている。

> learning the internals of browser operations helps you make better decisions and know the justifications behind development best practices

つまり「ブラウザ内部を学ぶことが、より良い判断と、開発ベストプラクティスの根拠の理解につながる」ということ。バグバウンティにおいても、脆弱性の多くはブラウザ内部の仕様や実装のクセを突くものなので、この土台は避けて通れない。

> 〔補足〕原典は 2011 年の記述である。Blink の登場（2013）、Chrome の Site Isolation、コンポジタスレッドの分離、`requestAnimationFrame` を含む現代のレンダリングフレームライフサイクル、Stylo（Firefox の並列 CSS エンジン）などは扱っていない。ここでは「古典として押さえる骨格」を学び、現代的な補足は後編（07b）や公式ドキュメントで埋める。

---

## 1. ブラウザの主機能

ブラウザの主機能はシンプルで、「ユーザが選んだ Web リソースをサーバに要求し、ブラウザウィンドウに表示すること」である。リソースは通常 HTML 文書だが、PDF・画像などほかの型もあり得る。リソースの位置はユーザが **URI（Uniform Resource Identifier）** で指定する。URI とは、Web 上の資源の在りかを一意に示す文字列のこと。アドレスバーに打ち込む `https://example.com/...` がその例である。

HTML と CSS の解釈・表示方法の仕様は **W3C（World Wide Web Consortium）** が管理している。W3C とは、Web の技術標準を策定する国際的な標準化団体のこと。長年ブラウザは仕様の一部にしか準拠せず独自拡張を作ったため深刻な互換性問題が生じたが、現在はおおむね準拠している。

### 1.1 UI はどの仕様にも定義されていない

ブラウザ UI の共通要素は次のとおり（原文の箇条書き）。

- Address bar for inserting the URI（URI を入れるアドレスバー）
- Back and forward buttons（戻る／進む）
- Bookmarking options（ブックマーク）
- A refresh and stop buttons（再読込・停止）
- Home button（ホーム）

特筆すべきは、**ブラウザの UI はどの正式仕様にも定義されていない**という点である。長年の慣行と相互模倣で形成されたものにすぎない。HTML5 仕様はブラウザが備えるべき UI 要素を定義せず、address bar / status bar / tool bar といった一般的要素を列挙するのみである。この「仕様に書かれていないのに事実上共通している挙動」という性質は、後で見る HTML のエラー耐性とも通じる、ブラウザ理解の重要なテーマである。

---

## 2. ブラウザの高レベル構造（7 コンポーネント）

原典はブラウザを 7 つの主要コンポーネントに分ける。まずこの分割を頭に入れることが、後の「どこに脆弱性が生まれるか」を考える骨格になる。

| # | コンポーネント | 役割 |
|---|---|---|
| 1 | **The user interface（UI）** | アドレスバー、戻る／進むボタン、ブックマークメニューなど。要求したページが表示されるメインウィンドウを**除く**ブラウザ表示の全部分。 |
| 2 | **The browser engine（ブラウザエンジン）** | UI とレンダリングエンジンの間のアクションを仲介（marshalls）する。 |
| 3 | **The rendering engine（レンダリングエンジン）** | 要求されたコンテンツの表示を担当。HTML なら HTML と CSS をパースして画面に表示する。 |
| 4 | **Networking（ネットワーク）** | HTTP リクエストなどのネットワーク呼び出し。プラットフォーム非依存のインタフェースと各プラットフォーム向け実装を持つ。 |
| 5 | **UI backend** | コンボボックスやウィンドウなど基本ウィジェットの描画。プラットフォーム非依存の汎用インタフェースを露出し、内部では OS の UI メソッドを使う。 |
| 6 | **JavaScript interpreter（JS インタプリタ）** | JavaScript コードのパースと実行。 |
| 7 | **Data storage（データストレージ）** | 永続化層。Cookie などをディスクに保存する。HTML5 仕様は 'web database'（ブラウザ内の軽量だが完全なデータベース）を定義。 |

これらは **Figure 1: Browser main components** という積層図で示される。二次資料も同じ図（`layers.png`）を使っている。

### 2.1 タブごとに別プロセス

原典は Chrome の特徴を明記している。

> Chrome, unlike most browsers, holds multiple instances of the rendering engine - one for each tab. Each tab is a separate process.

つまり「Chrome はほかの多くのブラウザと違い、タブごとに 1 つのレンダリングエンジンインスタンスを持ち、各タブが別プロセスになっている」。この「プロセスを分ける」という発想は、後に Site Isolation（サイトごとにレンダラプロセスを分ける仕組み）へと発展し、クライアントサイドセキュリティの根幹をなす。詳細は後編（07b）で扱う。

二次資料は Data storage の項を現代化し、Cookie だけでなく **localStorage / IndexedDB / FileSystem** を列挙している。

### 2.2 どの層で脆弱性が起きるか

> 〔補足〕この 7 分割は現代の Chrome（Browser process / Renderer process / GPU process / Network service / Utility process などのマルチプロセス構成）と厳密には一致しない。だが「どの機能がどの信頼境界に属するか」を考える骨格としては今も有効である。クライアントサイド脆弱性は主に **3（レンダリングエンジン）・6（JS エンジン）・7（データストレージ）** の境界で起きる。たとえば XSS はレンダリングエンジンと JS エンジンの境界、Cookie 盗難やストレージ経由の攻撃は 7 の境界で起きる、というように対応づけて考えるとよい。

---

## 3. レンダリングエンジン

レンダリングエンジンの責務は「要求されたコンテンツをブラウザ画面に表示すること」である。既定で HTML・XML 文書と画像を表示でき、プラグインや拡張を通じてほかの型（例: PDF ビューアプラグインによる PDF 表示）も扱える。原典の本編は「CSS で整形された HTML と画像の表示」という主要ユースケースに集中している。

原典の対応関係では、Firefox は Mozilla 自作の **Gecko**、Safari と Chrome は **WebKit** を使う。WebKit は Linux 向けエンジンとして始まり、Apple が Mac/Windows 対応に改変したオープンソースエンジンである。

### 3.1 現代のエンジン対応表

二次資料は、より新しいエンジン対応表を提供している（原文の表そのまま）。

| Browser | Engine |
|---|---|
| Chrome | Blink (a fork of WebKit) |
| Firefox | Gecko |
| Safari | Webkit |
| Opera | Blink (Presto if < v15) |
| Internet Explorer | Trident |
| Edge | Blink (EdgeHTML if < v79) |

Blink は WebKit のフォーク（分岐）として 2013 年に生まれたエンジンで、現在は Chrome・Opera・新しい Edge が採用している。脆弱性ハンティングでは「どのブラウザがどのエンジンを使うか」を知っておくと、あるバグが Chromium 系だけに効くのか、Gecko でも効くのかを見分けられる。

---

## 4. メインフロー（レンダリングの骨格）

ここが本節の中心である。レンダリングエンジンはネットワーク層から文書の内容を取得し始める。原典によれば、これは **通常 8KB チャンク単位**で行われる（"This will usually be done in 8K chunks."）。

### 4.1 基本の 5 ステップ

原典の基本フロー（**Figure 2: Rendering engine basic flow**）は次のとおり。

1. HTML 文書のパースを開始し、タグを **DOM ノード**に変換して **"content tree"** と呼ばれる木を作る。
2. 外部 CSS ファイルと `style` 要素の両方のスタイルデータをパースする。
3. スタイル情報と HTML 内の視覚的指示を合わせて、もう一つの木 = **render tree** を作る。render tree は色や寸法などの視覚属性を持つ矩形を含み、画面に表示される正しい順序で並ぶ。
4. render tree 構築後に **"layout"** 処理を通す。各ノードに画面上の正確な座標を与える。
5. 次の段が **painting**。render tree を走査し、各ノードを **UI backend レイヤ**を使って描画する。

図で表すと次のような流れである。

```
[ネットワークから 8KB チャンクで受信]
        |
        v
   HTML Parser  --->  DOM Tree（content tree）
        |                       \
        |                        \  (Attachment / スタイル解決)
   CSS Parser   --->  Style Rules  ->  Render Tree
                                          |
                                          v
                                       Layout（各ノードに座標を付与）
                                          |
                                          v
                                       Painting（画面へ描画）
```

### 4.2 段階的（gradual）であること

原典が繰り返し強調する重要点は、この処理が **段階的**に進むということである。より良い UX のため、レンダリングエンジンは可能な限り早く内容を画面に出そうとする。**HTML が全部パースされるのを待ってから render tree の構築とレイアウトを始めるのではない。** 一部の内容をパースして表示しつつ、ネットワークから届く残りの処理を続ける。

この「待たずに部分的に進める」性質こそが、後述する `document.write` による reentrant なパースや、スクリプトによるパース停止といった、脆弱性に関わる複雑な挙動の背景にある。

### 4.3 WebKit と Gecko の用語差

原典は「WebKit と Gecko は用語が少し違うだけでフローは基本的に同じ」と述べる（**Figure 3: Webkit main flow**、**Figure 4: Mozilla's Gecko rendering engine main flow**）。用語対応は次のとおり。

| 概念 | WebKit | Gecko |
|---|---|---|
| 視覚整形された要素の木 | **Render Tree**（要素は **Render Object**） | **Frame tree**（要素は **Frame**） |
| 要素の配置処理 | **layout** | **Reflow** |
| DOM ノード＋視覚情報を結合して render tree を作る処理 | **Attachment** | （対応語なし） |
| HTML と DOM の間の追加レイヤ | なし | **content sink**（DOM 要素を作るファクトリ） |

この対応表は、ブラウザ実装のブログや WebKit/Gecko のソースを読むときに必須の対訳になる。同じ現象を指す言葉が違うだけだと知っておけば、混乱せずに読める。

### 4.4 Critical Rendering Path としての 4 ステップ

二次資料は「最も単純なケース（テキストと画像 1 枚のプレーンな HTML ページ）」に対する処理を、より細かい 4 段で説明している。DOM がどう組み立てられるかを分解して理解するのに便利である。

1. **Conversion（変換）**: ブラウザは HTML の生バイトをディスクまたはネットワークから読み、ファイルに指定されたエンコーディング（例: UTF-8）に基づいて個々の文字に変換する。
2. **Tokenizing（トークン化）**: 文字列を W3C HTML5 標準が規定する個別のトークンに変換する。たとえば「`<html>`」「`<body>`」など、山括弧内の文字列。各トークンは特別な意味と規則の集合を持つ。
3. **Lexing（字句解析）**: 発行されたトークンを、プロパティと規則を定義する「オブジェクト」に変換する。
4. **DOM construction（DOM 構築）**: HTML マークアップはタグ間の関係（あるタグが別のタグに包含される）を定義するので、生成されたオブジェクトは元マークアップの親子関係を捉えた木構造にリンクされる。HTML オブジェクトは body オブジェクトの親、body は paragraph オブジェクトの親、という具合である。

このプロセス全体の最終出力が、そのページの **DOM（Document Object Model）** であり、ブラウザはページのその後のすべての処理でこれを用いる。DOM とは、HTML 文書をオブジェクトの木として表現したもので、JavaScript から HTML を読み書きする際の窓口になる。

二次資料の計測例では、HTML バイト列のチャンクを DOM ツリーに変換するのに **約 5ms** かかる。ページが大きければ大幅に長くなり、大量の HTML を処理する場合これがボトルネックになり得る。Chrome DevTools の timeline で実際の所要時間を確認できる。

> 〔補足〕現在の Google 系ドキュメントでは、これに CSS 側の **CSSOM 構築**を並べ、DOM + CSSOM → Render Tree → Layout → Paint を「Critical Rendering Path」と呼ぶ。CSSOM とは、CSS をオブジェクトの木として表現したもの（後述 7 章）。

---

## 5. パース理論の基礎

HTML パーサの特殊さを理解するには、まず「普通のパース」がどういうものかを知っておく必要がある。

### 5.1 パースとは何か

**パース**とは文書を「意味のある構造」= コードが理解して使える形へ翻訳することである。結果は通常、文書構造を表すノードの木（**parse tree / syntax tree**）になる。たとえば式 `2 + 3 - 1` は、演算子と数値を節点とする木として表現できる（**Figure 5: mathematical expression tree node**）。

パースは、文書が従う構文規則に基づく。パース可能なあらゆる形式は、語彙（vocabulary）と構文規則（syntax rules）からなる決定的な文法を持たねばならない。これを **文脈自由文法（context free grammar, CFG）** と呼ぶ。文脈自由文法とは、周囲の文脈に関係なく規則を適用できる文法のこと。人間の言語はそうではない（文脈で意味が変わる）ため、従来のパース技術では解析できない。この「HTML は文脈自由文法ではない」という事実が、後で決定的に効いてくる。

### 5.2 Lexer と Parser の分業

パースは 2 つの下位処理に分けられる。

- **Lexical analysis（字句解析）**: 入力をトークンに分割する処理。トークンは言語の語彙、すなわち妥当な構成要素の集合である。人間の言語なら、その言語の辞書に載る全単語に相当する。
- **Syntax analysis（構文解析）**: 言語の構文規則の適用。

実装は通常 2 コンポーネントに分業する。**lexer**（tokenizer とも呼ぶ。入力を妥当なトークンに分割する）と **parser**（構文規則に従って文書構造を解析し parse tree を構築する）である。lexer は空白や改行のような無関係な文字を除去する方法を知っている（**Figure 6: from source document to parse trees**）。

パースは反復的に進む。parser は lexer に新しいトークンを求め、構文規則のいずれかに一致させようとする。規則が一致すればトークンに対応するノードを parse tree に追加し、次のトークンを求める。一致する規則がなければトークンを内部に保存し、内部保存した全トークンに一致する規則が見つかるまでトークンを要求し続ける。**規則が見つからなければ parser は例外を投げる。これは文書が妥当でなく構文エラーを含んでいたことを意味する。** ── ここが HTML パーサとの決定的な違いである（後述）。

### 5.3 文法の形式定義（逐語）

原典は具体例として、整数・プラス・マイナスからなる小さな言語を定義している。語彙は正規表現で次のように定義される。

```text
INTEGER :0|[1-9][0-9]*
PLUS : +
MINUS: -
```

構文は **BNF（Backus–Naur Form）** で定義される。BNF とは、プログラミング言語などの文法を規則の集合として厳密に書き表す記法のこと。

```text
expression :=  term  operation  term
operation :=  PLUS | MINUS
term := INTEGER | expression
```

原典は「文法が **context free grammar** ならその言語は通常の parser でパースできる」とし、その直感的定義を「**BNF で完全に表現できる文法**」としている。

入力 `2 + 3 - 1` の解析では、最初に規則に一致する部分文字列は `2`（term）。2 番目の一致は `2 + 3`（term + operation + term = expression）。そして `2 + 3 - 1` 全体が expression になる。一方 `2 + +` はどの規則にも一致せず不正な入力である。

### 5.4 top down / bottom up と shift-reduce

parser には 2 つの基本型がある。

- **top down parser**: 構文の高レベル構造から見て一致させようとする。最高レベルの規則を起点にする。
- **bottom up parser**: 入力から始め、低レベル規則から高レベル規則へ段階的に還元していく。部分一致した式は parser のスタックに置かれる。

bottom up の動作はスタック遷移表で理解できる（原文の逐語）。

| Stack | Input |
|---|---|
| （空） | `2 + 3 - 1` |
| term | `+ 3 - 1` |
| term operation | `3 - 1` |
| expression | `- 1` |
| expression operation | `1` |
| expression | （空） |

このタイプの bottom up parser を **shift-reduce parser** と呼ぶ。入力を右へシフトし、段階的に構文規則へ還元（reduce）するためである。

文法（語彙と構文規則）を与えると parser を生成するツールを **parser generator** と呼ぶ。**WebKit は lexer 生成に Flex、parser 生成に Bison を使う**（Lex / Yacc という名でも遭遇する）。Flex の入力はトークンの正規表現定義を含むファイル、Bison の入力は BNF 形式の言語構文規則である。

---

## 6. HTML パーサ ── 脆弱性ハンティングの心臓部

ここからが本節でもっとも重要な部分である。HTML パーサの特殊性は、クライアントサイド脆弱性のかなりの部分の土台になっている。

### 6.1 HTML は文脈自由文法ではない

HTML の語彙と構文は W3C の仕様で定義される。だが **従来のパーサ理論は HTML には適用できない**（CSS と JavaScript のパースには使う）。HTML は parser が必要とする文脈自由文法で簡単には定義できないからである。

HTML を定義する形式手段として **DTD（Document Type Definition）** はあるが、これは文脈自由文法ではない。DTD とは、SGML 系言語で許可される要素・属性・階層を定義する形式のこと。当時の strict DTD は `http://www.w3.org/TR/html4/strict.dtd` にあった。

HTML は XML に近いのに、なぜパースが難しいのか。答えは **HTML のアプローチが「寛容（forgiving）」**だからである。暗黙に補われるタグ、開始／終了タグの省略などを許す。全体として「ソフトな」構文であり、XML の硬く厳格な構文とは対照的である。この一見小さな違いが決定的で、一方では HTML の人気の主因（ミスを許し著者を楽にする）であり、他方では形式文法を書くのを困難にする。まとめると、**HTML は文脈自由文法でないため、従来の parser でも XML parser でも簡単にはパースできない。**

### 6.2 DOM とマークアップの対応

パーサの出力木は **DOM 要素ノードと属性ノードの木**である。DOM は HTML 文書のオブジェクト表現であり、JavaScript のような外界に対する HTML 要素のインタフェースになる。**DOM はマークアップとほぼ 1 対 1 の関係**を持つ。二次資料の追記によれば、木の根は **"Document" object** である。

次のマークアップ（原文のまま）は、

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

対応する DOM ツリー（**Figure 8: DOM tree of the example markup**）に変換される。

### 6.3 パースアルゴリズムは 2 段のステートマシン

HTML が通常の top down / bottom up parser でパースできない理由は 3 つある（原文の逐語訳）。

1. 言語の寛容な性質（The forgiving nature of the language）。
2. ブラウザには、よく知られた不正 HTML のケースをサポートするための伝統的なエラー耐性があるという事実。
3. **パース処理が reentrant（再入可能）であること。** 通常はパース中にソースが変わらないが、HTML では **`document.write` を含む script タグが余分なトークンを追加できる**ので、**パース処理が入力自体を変更する**。

この 3 番目が特に重要である。パース対象の文字列そのものが、パースの途中で書き換わる。これは静的解析（実際に動かさずコードを調べる手法）による防御を根本から難しくする。

そこでブラウザは HTML 用のカスタムパーサを作る。アルゴリズムは HTML5 仕様に詳述され、**tokenization（トークン化）と tree construction（ツリー構築）の 2 段**からなる（**Figure 9: HTML parsing flow**）。Tokenization は字句解析で、HTML のトークンには start tags、end tags、attribute names、attribute values がある。tokenizer はトークンを認識して tree constructor に渡し、次の文字を消費する。

### 6.4 トークン化のステートマシン

トークン化アルゴリズムは **ステートマシン**として表現される。各状態は入力ストリームの 1 文字以上を消費し、それらの文字に応じて次状態を更新する。重要なのは、**判断が現在のトークン化状態とツリー構築状態の両方に影響される**点である。つまり同じ文字を消費しても、現在の状態によって正しい次状態は異なる。

次の入力（原文のまま）を例に取る。

```text
 <html>
   <body>
     Hello world
   </body>
 </html>
```

状態遷移は次のように進む（状態名は原文のまま）。

```
"Data state"（初期状態）
  │  '<' を消費
  ▼
"Tag open state"
  │  a-z を消費 → "Start tag token" 生成
  ▼
"Tag name state"（'>' まで留まる。各文字をタグ名に追加 → html トークン）
  │  '>' を消費 → トークン emit
  ▼
"Data state"（<body> も同手順。html と body を emit 済み）
  │  'H' を消費 → 文字トークンを生成・emit（Hello world の各文字ごとに 1 トークン）
  ▼
"Tag open state"（</body> の '<'）
  │  '/' を消費 → end tag token 生成
  ▼
"Tag name state"（'>' まで留まる）→ emit → "Data state"（</html> も同様）
```

各状態の名前（"Data state" / "Tag open state" / "Tag name state"）は、HTML5 仕様に実際に書かれている状態名である。この遷移を **Figure 10: Tokenizing the example input** が示している。脆弱性ハンティングでは、サニタイザ回避のペイロードがどの状態遷移を引き起こすかを考えるとき、これらの状態名が直接効いてくる。

### 6.5 ツリー構築と挿入モード

parser が生成されるとき **Document オブジェクト**が作られる。ツリー構築段では Document を根とする DOM ツリーが変更され、要素が追加される。tokenizer が発行した各トークンについて、どの DOM 要素が該当しどれを生成すべきかを仕様が定義している。

要素は DOM ツリーに追加されるだけでなく、**open elements のスタック**にも追加される。**このスタックは入れ子の不整合や未閉鎖タグの修正に使われる。** このアルゴリズムもステートマシンで、その状態は **"insertion modes"（挿入モード）** と呼ばれる。

先ほどと同じ入力での挿入モード遷移は次のとおり（状態名は原文のまま）。

```
"initial mode"
  │  html トークン
  ▼
"before html" → HTMLHtmlElement を生成、Document に追加
  │
  ▼
"before head" → ここで body トークンを受信
  │  （head トークンがないのに HTMLHeadElement を暗黙生成）
  ▼
"in head" → "after head" → body トークン再処理 → HTMLBodyElement 生成
  ▼
"in body" → "Hello world" の文字トークンで Text ノード生成、残りを追加
  ▼
"after body"（body 終了トークン）
  ▼
"after after body"（html 終了タグ）
  ▼
end of file トークンでパース終了
```

ここで注目すべきは、**head タグが書かれていないのに HTMLHeadElement が暗黙に生成される**点である。これがまさに「寛容な HTML」の実装であり、著者の省略をブラウザが補っている。

パースが完了すると、ブラウザは文書を **interactive** とマークし、**"deferred" モードのスクリプト**（文書パース後に実行されるべきもの）のパースを開始する。その後、文書状態が **"complete"** に設定され、**"load" イベント**が発火する。

### 6.6 エラー耐性 ── 「構文エラーは絶対に出ない」

原典が断言する、脆弱性ハンティングでもっとも重要な一文がこれである。

> You never get an "Invalid Syntax" error on an HTML page. Browsers fix any invalid content and go on.

「HTML ページで『構文エラー』が出ることは決してない。ブラウザは不正な内容を必ず修復して先へ進む」。原典が挙げる不正 HTML の例（逐語）。

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

`mytag` は標準タグではなく、`p` と `div` の入れ子も誤っている。それでもブラウザは正しく表示し、文句を言わない。パーサコードの多くが、HTML 著者のミスを修復しているのである。

驚くべきことに、このエラー処理はブラウザ間でかなり一貫しているのに、**現行 HTML 仕様の一部ではなかった**（歴史的にブラウザの中で発達し、HTML5 仕様がその一部を後から定義した）。WebKit の HTML パーサクラスの冒頭コメントが、修復すべきエラー条件を列挙している（逐語）。

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

### 6.7 エラー耐性の 4 つの実例（WebKit のコード）

原典は WebKit の実コードとともに、具体的な修復の例を 4 つ挙げている。これらはすべて「**パーサが入力を書き換える**」実例であり、mXSS の核心である。

**(1) `</br>` を `<br>` として扱う。** 一部サイトが `<br>` の代わりに `</br>` を使う。IE や Firefox と互換にするため、WebKit はこれを `<br>` として扱う。

```cpp
if (t->isCloseTag(brTag) && m_document->inCompatMode()) {
     reportError(MalformedBRError);
     t->beginTag = true;
}
```

エラー処理は内部的で、ユーザには提示されない（`Note - the error handling is internal - it won't be presented to the user.`）。

**(2) Stray table（迷子のテーブル）。** テーブルのセル内ではなく、別のテーブルのコンテンツ内に置かれたテーブル。

```html
 <table>
     <table>
         <tr><td>inner table</td></tr>
     </table>
     <tr><td>outer table</td></tr>
 </table>
```

WebKit はこれを 2 つの兄弟テーブルに変える。

```html
 <table>
     <tr><td>outer table</td></tr>
 </table>
 <table>
     <tr><td>inner table</td></tr>
 </table>
```

対応するコード。

```cpp
if (m_inStrayTableContent && localName == tableTag)
        popBlock(tableTag);
```

内側のテーブルを外側のテーブルのスタックから pop することで、結果としてテーブルが兄弟になる。

**(3) 入れ子の form 要素。** form の中に form を入れると、**2 番目の form は無視される**。

```cpp
if (!m_currentFormElement) {
        m_currentFormElement = new HTMLFormElement(formTag,    m_document);
}
```

**(4) 深すぎるタグ階層。** WebKit のコメント（逐語）。

> www.liceo.edu.mx is an example of a site that achieves a level of nesting of about 1500 tags, all from a bunch of `<b>`s. We will only allow at most 20 nested tags of the same type before just ignoring them all together.

つまり同種タグの入れ子は 20 段までしか許さず、それ以降はまとめて無視する。

```cpp
bool HTMLParser::allowNestedRedundantTag(const AtomicString& tagName)
{

unsigned i = 0;
for (HTMLStackElem* curr = m_blockStack;
         i < cMaxRedundantTagDepth && curr && curr->tagName == tagName;
     curr = curr->next, i++) { }
return i != cMaxRedundantTagDepth;
}
```

**(5) 位置のおかしい html / body 終了タグ。** WebKit のコメント（逐語）。

> Support for really broken html. We never close the body tag, since some stupid web pages close it before the actual end of the doc. Let's rely on the end() call to close things.

```cpp
if (t->tagName == htmlTag || t->tagName == bodyTag )
        return;
```

原典はこう締めくくる。「Web 著者は注意せよ ── WebKit のエラー耐性コードのスニペット例に登場したくなければ、well-formed な HTML を書くこと。」

### 6.8 なぜこれが脆弱性の土台になるのか

> 〔補足〕この節の内容は、クライアントサイド脆弱性ハンティングにおける **mutation XSS（mXSS）** と **サニタイザ回避** の直接的な理論的基礎である。mXSS とは、サニタイズ（危険なマークアップを除去する処理）で一度「安全」にされた文字列が、ブラウザの再パース過程で危険なマークアップに「変異（mutate）」して実行される攻撃のこと。
>
> サニタイザ（サーバ側のライブラリや DOMPurify など）が想定する構文木と、ブラウザのエラー修復後に実際に構築される DOM が食い違うと、サニタイズ済みの「安全な」文字列が再シリアライズ・再パースの過程で実行可能なマークアップに変異する。上の「stray table を兄弟に移動する」「form の入れ子は無視する」「同種タグ 20 段超は捨てる」「`</br>` を `<br>` として扱う」はいずれも、この「パーサが入力を書き換える」実例である。攻撃者はこのズレを狙う。
>
> また 6.3 の 3 番目、`document.write` による reentrant なパースは、スクリプト注入がパース対象そのものを変える点で、防御側の静的解析を無効化しうる。バグバウンティで HTML サニタイザのバイパスを探すときは、「サニタイザが見た文字列」と「ブラウザが最終的に組み立てる DOM」の差分を常に意識することになる。

---

## 7. CSS パース

HTML とは対照的に、**CSS は文脈自由文法**であり、5 章で述べた種類の parser でパースできる。CSS 仕様は CSS の字句文法と構文文法を `http://www.w3.org/TR/CSS2/grammar.html` に定義している。

### 7.1 CSS の字句文法と構文文法（逐語）

字句文法（語彙）は正規表現で定義される（原文のまま）。

```text
comment   \/\*[^*]*\*+([^/*][^*]*\*+)*\/
num   [0-9]+|[0-9]*"."[0-9]+
nonascii  [\200-\377]
nmstart   [_a-z]|{nonascii}|{escape}
nmchar    [_a-z0-9-]|{nonascii}|{escape}
name    {nmchar}+
ident   {nmstart}{nmchar}*
```

原典の説明では、`ident` は identifier の略でクラス名のようなもの、`name` は（`#` で参照される）要素の id である。

構文文法（BNF）は次のとおり（原文のまま）。

```text
ruleset
  : selector [ ',' S* selector ]*
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

ruleset の具体例（逐語）。

```css
div.error , a.error {
  color:red;
  font-weight:bold;
}
```

`div.error` と `a.error` がセレクタ、波括弧内がこの ruleset で適用される規則である。BNF の意味は「ruleset はセレクタ 1 つ、または任意個のセレクタをカンマと空白で区切ったもの。ruleset は波括弧を含み、その中に宣言 1 つ、または任意個の宣言をセミコロンで区切ったものを含む」。

### 7.2 WebKit / Firefox の CSS パーサ

WebKit は **Flex と Bison** の parser generator を使い、CSS 文法ファイルから parser を自動生成する。Bison は bottom up の shift-reduce parser を作る。一方 **Firefox は手書きの top down parser を使う**。いずれの場合も各 CSS ファイルは **StyleSheet オブジェクト**にパースされ、各オブジェクトは CSS ルールを含む。CSS ルールオブジェクトはセレクタオブジェクトと宣言オブジェクトを含む（**Figure 12: parsing CSS**）。

### 7.3 セレクタは右から左にマッチする

二次資料の重要な追記がこれである。

> CSS Selectors are matched by browser engines from right to left.

ブラウザがセレクタマッチングを行うとき、スタイルを決めたい 1 要素があり、すべての規則・セレクタの中からどれがその要素に一致するかを探す。これは jQuery のように「1 つのセレクタに一致する全要素を探す」のとは逆で、**要素側から右から左へセレクタをたどる**。たとえば `table div { ... }` なら、まず「div か」を判定し、その後で祖先に table があるかを上へたどる。この方向を知っておくと、後述のスタイル計算の最適化や性能問題が腑に落ちる。

CSSOM が木構造である理由も二次資料が説明している。ある要素の最終スタイルを計算するとき、ブラウザはそのノードに適用可能な**最も一般的な規則**から始め（例: body の子なら body のスタイルが適用される）、より具体的な規則を再帰的に適用して計算済みスタイルを洗練していく。すなわち規則は「カスケードダウン」する。これが CSS の「カスケード（cascade、上から下へ流れ落ちる）」の由来である。

---

## 8. スクリプトとスタイルシートの処理順序

パースの途中でスクリプトやスタイルシートに出会ったとき、ブラウザがどう振る舞うかは、タイミング依存の脆弱性を考えるうえで重要である。

### 8.1 スクリプトは同期的にパースを止める

**Web のモデルは同期的**である。著者は parser が `<script>` タグに到達した時点でスクリプトが即座にパース・実行されることを期待する。**スクリプトが実行されるまで文書のパースは停止する。** スクリプトが外部なら、まずネットワークからリソースを取得しなければならず、これも同期的で、取得までパースが停止する。これが長年のモデルで、HTML4/HTML5 仕様にも規定されている。

著者はスクリプトを **"defer"** とマークでき、その場合は文書のパースを止めず、パース後に実行される。**HTML5 はスクリプトを asynchronous とマークするオプションを追加**し、別スレッドでパース・実行される。

### 8.2 Speculative parsing（投機的パース）

**WebKit と Firefox はともにこの最適化を行う。** スクリプトを実行している間、別スレッドが文書の残りをパースし、ネットワークから読み込む必要のあるほかのリソースを見つけて先読みする。これによりリソースを並列接続で読み込め、全体の速度が向上する。

**注意すべきは、投機的パーサは DOM ツリーを変更しない**点である。それはメインパーサに任せ、外部スクリプト・スタイルシート・画像のような外部リソースへの参照のみをパースする。

### 8.3 スタイルシートがスクリプトをブロックする条件

スタイルシートは別のモデルである。概念的には DOM ツリーを変えないので、待つ理由はなく文書のパースを止める必要はない。**しかし文書パース段でスクリプトがスタイル情報を問い合わせる問題がある。** スタイルが未読込・未パースならスクリプトは誤った答えを得る。これは多くの問題を起こし、エッジケースに見えて実はかなり一般的である。

対処はブラウザで異なる。**Firefox は、読み込み・パース中のスタイルシートがある場合、すべてのスクリプトをブロックする。WebKit は、未読込のスタイルシートに影響される可能性がある特定のスタイルプロパティにアクセスしようとしたときだけスクリプトをブロックする。**

> 〔補足〕この「スクリプトは同期でパースを止める」「スタイルシートがスクリプトをブロックする」という挙動は、脆弱性の側面では**タイミング依存の攻撃面**を作る。スタイルシートの読み込み待ちでスクリプト実行が遅延する隙に DOM の状態が変わる、あるいは `document.write` を含む注入がパースキューに割り込む、といった順序依存の挙動が、実際の DOM XSS の成立条件になることがある。

---

## 9. レンダーツリー構築

DOM ツリーが構築される間、ブラウザは**もう一つの木 = render tree** を構築する。これは表示される順序に並んだ視覚要素の木であり、文書の視覚的表現である。**この木の目的は、内容を正しい順序で描画（paint）できるようにすることにある。**

用語は前述のとおりで、**Firefox は要素を "frames" と呼び、WebKit は renderer / render object と呼ぶ**。renderer は自身と子をレイアウト・描画する方法を知っている。WebKit の RenderObject 基底クラスは次のとおり（逐語）。

```cpp
class RenderObject{
  virtual void layout();
  virtual void paint(PaintInfo);
  virtual void rect repaintRect();
  Node* node;  //the DOM node
  RenderStyle* style;  // the computed style
  RenderLayer* containgLayer; //the containing z-index layer
}
```

各 renderer は、通常ノードの CSS ボックスに対応する矩形領域を表し、幅・高さ・位置といった幾何情報を含む。**ボックス型は、そのノードに適用される `display` スタイル属性に影響される。** display 属性による renderer 生成の分岐は次のコードで表される（逐語）。

```cpp
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

注目すべきは `case NONE:` が何も生成せず `break` する点である。つまり `display:none` の要素は renderer を作らない。要素型も考慮され、フォームコントロールやテーブルは特別なフレームを持つ。WebKit では特別な renderer を作りたい要素が `createRenderer` メソッドをオーバーライドする。

### 9.1 DOM と render tree は 1:1 ではない

ここが脆弱性ハンティングで効く重要点である。renderer は DOM 要素に対応するが、**関係は 1 対 1 ではない**。原典の列挙は次のとおり。

- **非視覚的な DOM 要素は render tree に挿入されない。** 例: `head` 要素。
- **`display` 属性が "none" の要素も木に現れない。** 一方、**`visibility` 属性が "hidden" の要素は木に現れる。**
- **複数の視覚オブジェクトに対応する DOM 要素**がある。たとえば `select` 要素は 3 つの renderer を持つ ── 表示領域用、ドロップダウンリストボックス用、ボタン用。また幅が 1 行に足りずテキストが複数行に分割される場合、新しい行は追加の renderer になる。
- 複数 renderer の別例は**壊れた HTML** である。CSS 仕様によれば inline 要素はブロック要素のみ、または inline 要素のみを含まなければならない。混在した場合、inline 要素を包む **anonymous block renderer** が生成される。
- **一部の render object は DOM ノードに対応するが、木の中の同じ場所にはない。** float と absolute 配置要素は **out of flow** で、木の別の場所に置かれる。本来あるべき場所には **placeholder frame** が置かれる。

「Viewport」は initial containing block（最初の包含ブロック）であり、WebKit では **RenderView** オブジェクトになる（**Figure 13: The render tree and the corresponding DOM tree**）。

> 〔補足〕`display:none` は render tree に載らず、`visibility:hidden` は載る ── この差は、クリックジャッキング／UI redressing（ユーザに気づかれず操作させる攻撃）や「見えない要素の座標・寸法が取得できるか」を考えるうえで決定的である。UI redressing とは、透明化や重ね合わせで、ユーザが意図しない要素をクリックさせる攻撃の総称。
> また `select` が 3 renderer を持つ、混在コンテンツで anonymous block が作られる、といった「DOM と視覚構造のズレ」は、DOM ベースのサニタイズやセレクタベースの防御が、視覚的な実体と一致しないことの根拠になる。

### 9.2 木構築のフロー

**Firefox** では presentation が DOM 更新のリスナとして登録され、フレーム生成を `FrameConstructor` に委譲する。constructor がスタイルを解決してフレームを作る。

**WebKit** ではスタイル解決と renderer 生成のプロセスを **"attachment"** と呼ぶ。すべての DOM ノードは "attach" メソッドを持ち、**attachment は同期的で、DOM ツリーへのノード挿入が新ノードの "attach" メソッドを呼ぶ**。

html と body タグの処理により render tree の根が構築される。ルート render object は CSS 仕様が **containing block** と呼ぶもの（ほかの全ブロックを含む最上位ブロック）に対応し、その寸法は **viewport = ブラウザウィンドウの表示領域**の寸法になる。**Firefox は `ViewPortFrame`、WebKit は `RenderView` と呼ぶ。**

---

## 10. スタイル計算（Style Computation）

render tree 構築には、各 render object の視覚プロパティ計算が必要で、それは各要素のスタイルプロパティ計算によって行われる。スタイルは、様々な由来のスタイルシート・インライン style 要素・HTML の視覚属性（`bgcolor` 等。対応する CSS プロパティに翻訳される）を含む。

スタイルシートの由来（origins）は 3 つある。**ブラウザの既定スタイルシート**、**ページ著者が提供するスタイルシート**、**ユーザスタイルシート**（ブラウザ利用者が提供。Firefox では "Firefox Profile" フォルダに置く）である。この 3 つの由来が後述のカスケード順に関わる。

### 10.1 スタイル計算の 3 つの困難

原典はスタイル計算が難しい理由を 3 点挙げる。

1. **スタイルデータは非常に大きな構造**で、膨大なスタイルプロパティを保持するため**メモリ問題**を引き起こしうる。
2. **各要素に一致する規則を見つける処理は、最適化しなければ性能問題**になる。要素ごとに規則リスト全体を走査するのは重い。セレクタは複雑な構造を持ち得るため、有望に見えて無駄と判明する経路からマッチングを始め、別の経路を試す必要が生じる。原文の例は次のとおり。

```css
     div div div div{
       ...
     }
```

これは「3 つの div の子孫である `<div>`」に適用される。ある div にこれが適用されるか確認するため木を上へたどるが、div が 2 つしかなくて適用されないと分かるまで上へたどる必要があるかもしれず、その後で別の経路を試すことになる。7.3 で見た「右から左」のマッチングと合わせて理解するとよい。

3. **規則の適用には、規則の階層を定義するかなり複雑なカスケード規則が絡む。**

### 10.2 スタイルデータの共有（WebKit の 10 条件）

WebKit のノードは style オブジェクト（**RenderStyle**）を参照し、一定条件下でノード間で共有できる。共有できれば計算とメモリを節約できる。共有できるのはノードが兄弟または従兄弟（cousins）であって、かつ次の 10 条件すべてを満たすときである（逐語訳）。

1. 要素は同じマウス状態でなければならない（一方が `:hover` で他方がそうでない、はだめ）。
2. どちらの要素も id を持っていてはならない。
3. タグ名が一致しなければならない。
4. class 属性が一致しなければならない。
5. マップされた属性の集合が同一でなければならない。
6. リンク状態が一致しなければならない。
7. フォーカス状態が一致しなければならない。
8. どちらの要素も属性セレクタの影響を受けてはならない（「影響を受ける」= セレクタ内のどの位置であれ属性セレクタを使うセレクタマッチを持つこと）。
9. 要素にインライン style 属性があってはならない。
10. 兄弟セレクタが一切使われていてはならない。**WebCore は兄弟セレクタに遭遇するとグローバルスイッチを投げ、それが存在する場合は文書全体でスタイル共有を無効化する。** これは `+` セレクタや `:first-child` / `:last-child` のようなセレクタを含む。

### 10.3 Firefox の rule tree / style context tree

Firefox はスタイル計算を容易にする **2 つの追加の木 ── rule tree と style context tree** を持つ。WebKit も style オブジェクトは持つが、そのような木には格納せず、DOM ノードが関連 style を指すだけである（**Figure 14: Firefox style context tree**）。

**style contexts は最終値（end values）を含む。** 値は、一致するすべての規則を正しい順序で適用し、論理値から具体値へ変換して計算される（例: 画面のパーセンテージを絶対単位に変換）。rule tree の巧妙さは、これらの値をノード間で共有して再計算を避けられる点にある。空間も節約する。

一致したすべての規則が木に格納される。**経路の下位ノードほど優先度が高い。** 木は見つかった規則マッチの全経路を含み、**格納は遅延（lazily）して行われる**。あるノードのスタイルを計算する必要が生じたときに、計算済み経路が木に追加される。「木の経路を辞書の単語と見る」という発想で、たとえば経路 A-B-E-I-L が計算済みで、別の要素の一致規則が B-E-I なら、その経路は既に存在するので作業が減る。

**Division into structs（構造体への分割）**: style contexts は struct（構造体）に分割される。struct は border や color といった特定カテゴリのスタイル情報を含む。struct 内の全プロパティは inherited（継承される）か non inherited のどちらかである。inherited プロパティは、要素が定義しない限り親から継承される。non inherited（**"reset" プロパティ**）は未定義なら既定値を使う。下位ノードが struct の定義を提供していなければ、上位ノードのキャッシュ済み struct を使える。

rule tree を使った style context の計算は、経路の最下位ノード（最高優先度、通常は最も具体的なセレクタ）から始めて struct が埋まるまで木を上へたどる。ノードに struct の指定がなければ、struct を完全に指定するノードが見つかるまで上へ行き、単にそれを指す（これが最良の最適化で struct 全体が共有される）。struct の定義が全く見つからず、その struct が "inherited" 型なら context tree 内の親の struct を指す。reset struct なら既定値を使う。要素に同じ木ノードを指す兄弟がいれば、style context 全体を共有できる。

### 10.4 rule tree の具体例（逐語）

原典の例。次の HTML と CSS を考える。

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
div {margin:5px;color:black}
.err {color:red}
.big {margin-top:3px}
div span {margin-bottom:4px}
#div1 {color:blue}
#div2 {color:green}
```

簡略化のため color struct と margin struct の 2 つだけを埋めるとする（**Figure 15: The rule tree**、**Figure 16: The context tree**）。2 番目の `<div>`（div2）に到達したとき、一致する規則は **1, 2, 6** と判明する。既存経路が使えるので、規則 6 用のノード（rule tree のノード **F**）を 1 つ追加すればよい。

- margin struct: 最後の rule ノード F は margin に何も追加しないので、計算済みキャッシュが見つかるまで木を上へ行く。margin を指定した最上位ノード **B** で見つかり、それを使う。
- color struct: 定義があるのでキャッシュを使えない。color は属性 1 つなので上へ行く必要はなく、最終値を計算（文字列を RGB に変換等）してこのノードにキャッシュする。
- 2 番目の `<span>` は、前の span と同様に規則 **G** を指すと結論できる。同じノードを指す兄弟があるので **style context 全体を共有**し、前の span の context を指すだけでよい。

継承されるプロパティを含む struct のキャッシュは context tree 上で行われる（color は実際には継承されるが、Firefox は reset として扱い rule tree にキャッシュする）。

一方 **WebKit（rule tree を持たない）は、一致した宣言を 4 回走査する**。順に、(1) non important high priority プロパティ（ほかが依存するため先に適用すべきもの。例: `display`）、(2) high priority important、(3) normal priority non important、(4) normal priority important である。これで複数回現れるプロパティが正しいカスケード順で解決され、**最後が勝つ（The last wins）**。

### 10.5 マッチを容易にするための規則のハッシュマップ化

スタイル規則のソースは 3 つある（逐語コード付き）。

- CSS 規則（外部スタイルシートまたは style 要素内）: `p {color:blue}`
- インライン style 属性: `<p style="color:blue" />`
- HTML 視覚属性（対応するスタイル規則にマップ）: `<p bgcolor="blue" />`

後ろの 2 つは要素が style を所有するので容易にマッチする。厄介なのは CSS 規則マッチ（困難 #2）である。そこでスタイルシートをパースした後、規則はセレクタに応じて **複数のハッシュマップ**のいずれかに追加される。**id 別、クラス名別、タグ名別のマップと、それらに当てはまらないもの用の汎用マップ**がある。

この加工により規則マッチがはるかに容易になる。全宣言を見る必要はなく、マップから要素に関連する規則を抽出できる。**この最適化は規則の 95% 以上を除去し、マッチング処理で考慮すらされなくなる。** 例（逐語）。

```css
p.error {color:red}
#messageDiv {height:50px}
div {margin:5px}
```

1 番目はクラスマップ、2 番目は id マップ、3 番目はタグマップに入る。次の HTML に対して、

```html
 <p class="error">an error occurred </p>
 <div id=" messageDiv">this is a message</div>
```

まず p 要素の規則をクラスマップの "error" キーから探し、`p.error` を見つける。div は id マップとタグマップに関連規則を持つ。残る作業は、抽出された規則のうちどれが実際に一致するかを見つけることだけである。たとえば div の規則が `table div {margin:5px}` なら、**キーは最右のセレクタ**なのでタグマップから抽出されるが、table の祖先を持たない当該 div には一致しない（ここでも「右から左」が効いている）。この加工は WebKit と Firefox の両方が行う。

### 10.6 カスケード順と Specificity

一致したどの規則でもプロパティが定義されない場合、一部は親から継承され、他は既定値を持つ。同じプロパティが複数の規則で定義されたときにどれが勝つかを決めるのがカスケード順である。

**Style sheet cascade order**（CSS2 仕様、低→高）。

| 優先度 | 宣言の種類 |
|---|---|
| 1（最低） | Browser declarations |
| 2 | User normal declarations |
| 3 | Author normal declarations |
| 4 | Author important declarations |
| 5（最高） | User important declarations |

ブラウザ宣言が最も弱く、**ユーザは `!important` とマークした場合にのみ著者を上書きできる**。同じ順位の宣言は **specificity（詳細度）** でソートされ、次に指定された順序でソートされる。HTML 視覚属性は低優先度の author 規則として扱われる。

**Specificity** は次の 4 値 a-b-c-d で決まる（CSS2 仕様、逐語訳）。

- 宣言が `style` 属性由来なら 1、そうでなければ 0（= a）
- セレクタ内の ID 属性の数（= b）
- セレクタ内のその他の属性と擬似クラスの数（= c）
- セレクタ内の要素名と擬似要素の数（= d）

4 つの数 a-b-c-d を（大きな基数の数体系で）連結すると specificity になる。原典の例（逐語）。

```text
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

二次資料は同じ規則を 3 値換算で示す（注: 二次資料はコメント中で b/c のラベルが原典と 1 つずれているが、数値結果は整合する。逐語のまま記録する）。

```text
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

規則がマッチした後、カスケード規則に従ってソートされる。**WebKit は小さいリストにはバブルソート、大きいリストにはマージソートを使う**。WebKit は `>` 演算子をオーバーライドしてソートを実装する（逐語）。

```cpp
static bool operator >(CSSRuleData& r1, CSSRuleData& r2)
{
    int spec1 = r1.selector()->specificity();
    int spec2 = r2.selector()->specificity();
    return (spec1 == spec2) : r1.position() > r2.position() : spec1 > spec2;
}
```

### 10.7 段階的なスタイル適用と FOUC

WebKit は「（`@imports` を含む）すべてのトップレベルスタイルシートが読み込まれたか」を示すフラグを使う。**attach 時にスタイルが完全に読み込まれていなければプレースホルダが使われ、文書にマークされ、スタイルシートが読み込まれた後に再計算される。**

> 〔補足〕この「未読込スタイルシートでのプレースホルダ」の挙動は、歴史的に **FOUC（Flash Of Unstyled Content、スタイル未適用コンテンツの一瞬の表示）問題**として知られる（原典の参考文献に David Hyatt, "The FOUC Problem", webkit.org/blog/66/ が挙げられている）。

---

## 手を動かす

以下は、許可された環境（自分で立てたローカルの HTML ファイルや、自分が所有するページ）で試すことを前提とする。

1. **DOM 構築を DevTools で観察する。** 任意のページを開き、Chrome DevTools（F12）の「Performance」タブで記録を開始→リロード→停止する。タイムライン上の「Parse HTML」イベントを探し、HTML から DOM を組み立てる処理に実際どれだけ時間がかかっているかを見る。二次資料の例では約 5ms だった。

2. **エラー耐性を自分で確かめる。** 次の内容で `broken.html` を作り、ブラウザで開く。エラーは一切出ず、ブラウザが勝手に修復して表示することを確認する。

```html
<html>
  <mytag></mytag>
  <div>
  <p>
  </div>
    Really lousy HTML
  </p>
</html>
```

3. **修復後の DOM を見る。** そのページで DevTools の「Elements」タブを開き、**あなたが書いたソースと、ブラウザが最終的に組み立てた DOM ツリーが違う**ことを確認する。`View Source`（Ctrl+U）の生ソースと Elements パネルを見比べると、「パーサが入力を書き換えた」結果がはっきり分かる。

4. **`</br>` の修復を確認する。** `<div>a</br>b</div>` を含むページを開き、Elements パネルで `</br>` が `<br>` として扱われていることを確認する。

5. **DOM とレンダーツリーのズレを確認する。** `<div style="display:none">A</div><div style="visibility:hidden">B</div>` を含むページを開く。Elements パネルにはどちらも存在するが、`display:none` の方は render tree に載らないため画面領域を占めず、`visibility:hidden` の方は場所だけ占める（見えないが空白がある）ことを確認する。

6. **specificity を検証する。** 同じ要素に `#id`、`.class`、タグセレクタで別々の色を指定し、DevTools の「Styles」パネルで打ち消し線（override された宣言）を見て、10.6 の表のとおりに勝敗が決まることを確認する。

---

## つまずきポイント

- **「HTML パースはエラーで止まる」と思い込む。** 実際には決して止まらない。ブラウザは必ず修復して先へ進む。この誤解があると、サニタイザ回避の発想（サニタイザとブラウザの解釈のズレ）にたどり着けない。
- **DOM とマークアップ、DOM とレンダーツリーを混同する。** DOM はマークアップとほぼ 1:1 だが、レンダーツリーとは 1:1 ではない。`head` や `display:none` は DOM にはあるが render tree にはない。`select` は 1 つの DOM 要素で 3 renderer になる。
- **`display:none` と `visibility:hidden` を同じだと思う。** 前者は render tree に載らない、後者は載る。UI redressing や情報漏えいの成否がここで変わる。
- **CSS セレクタが「左から右」にマッチすると思う。** ブラウザは要素側から**右から左**にたどる。性能特性も最適化（ハッシュマップ化）も、この方向を前提にしている。
- **specificity を単純な桁数の足し算だと思う。** a-b-c-d の各カテゴリは独立にカウントされ、大きな基数で連結される。`#id` 1 個はクラス 100 個より強い、という非直感的な結果になる。
- **投機的パーサが DOM を変えると思う。** 投機的パーサは外部リソースの先読みだけを行い、DOM ツリーは変更しない。DOM 変更はメインパーサの仕事である。
- **`document.write` を「ただの出力」だと思う。** これはパース対象そのものを書き換える reentrant な操作で、静的解析を無効化しうる。

---

## この節のまとめ

- ブラウザの主機能は「ユーザが選んだ Web リソースを要求し、ウィンドウに表示すること」。UI はどの正式仕様にも定義されず、慣行で形成された。
- ブラウザは 7 コンポーネント（UI／ブラウザエンジン／レンダリングエンジン／ネットワーク／UI backend／JS インタプリタ／データストレージ）に分かれる。クライアントサイド脆弱性は主にレンダリングエンジン・JS エンジン・データストレージの境界で起きる。
- Chrome はタブごとに別プロセスでレンダリングエンジンを持つ。これが後の Site Isolation につながる。
- 主要エンジンは Chrome=Blink、Firefox=Gecko、Safari=WebKit。Blink は WebKit のフォーク。
- レンダリングのメインフローは HTML パース→DOM（content tree）→レンダーツリー→レイアウト→ペイント。ネットワークからは通常 8KB チャンクで取り込み、処理は段階的（HTML を全部読み終える前に表示を始める）。
- WebKit と Gecko は用語が違うだけでフローは同じ（Render Tree/RenderObject/layout/Attachment ↔ Frame tree/Frame/Reflow/content sink）。
- 二次資料の Critical Rendering Path は Conversion→Tokenizing→Lexing→DOM construction の 4 段。
- 普通のパースは lexer と parser の分業で、規則に一致しなければ例外（構文エラー）を投げる。WebKit は Flex と Bison で parser を自動生成する。
- **HTML は文脈自由文法ではない。** 寛容な構文・伝統的なエラー耐性・`document.write` による reentrant なパースのため、専用のカスタムパーサを使う。
- HTML パースは tokenization（"Data state" などの状態を持つステートマシン）と tree construction（"initial"→"before html"→…→"after after body" の挿入モード）の 2 段。head がなくても暗黙生成される。
- **HTML では「構文エラー」が絶対に出ない。** ブラウザは不正な内容を必ず修復する（`</br>`→`<br>`、stray table を兄弟化、入れ子 form を無視、同種タグ 20 段超を破棄、body 終了タグを無視）。これが mXSS とサニタイザ回避の理論的基礎。
- CSS は文脈自由文法でパースでき、セレクタは**右から左**にマッチする。規則はハッシュマップ化され 95% 以上が事前に除外される。
- スクリプトは同期的にパースを止める（defer/async で変わる）。スタイルシートはスクリプトのスタイル問い合わせをブロックしうる。これがタイミング依存の攻撃面を作る。
- レンダーツリーと DOM は 1:1 ではない。`head`・`display:none` は載らず、`visibility:hidden` は載る。`select` は 3 renderer、out-of-flow 要素には placeholder frame。UI redressing の前提。
- スタイル計算はメモリ・マッチング・カスケードの 3 難点を抱える。WebKit は 10 条件でスタイル共有し、Firefox は rule tree / context tree で再計算を避ける。
- カスケード順は Browser < User normal < Author normal < Author important < User important。同順位は specificity（a-b-c-d）と指定順で決まる。

## 理解度チェック

1. ブラウザの 7 コンポーネントのうち、クライアントサイド脆弱性が主に発生するのはどれか。
   ▶ 答え: 3（レンダリングエンジン）・6（JS インタプリタ）・7（データストレージ）の境界。

2. レンダリングエンジンのメインフローの 5 ステップを順に挙げよ。
   ▶ 答え: (1) HTML パースで DOM（content tree）を作る、(2) CSS をパースする、(3) スタイルと視覚情報を合わせて render tree を作る、(4) layout で各ノードに座標を与える、(5) painting で描画する。

3. 「HTML ページで構文エラーが出ることは決してない」とはどういう意味か。脆弱性ハンティングにどう関わるか。
   ▶ 答え: ブラウザは不正な HTML を必ず修復して先へ進む。サニタイザが想定する構文木と、修復後に実際に作られる DOM がズレると、安全化したはずの文字列が実行可能なマークアップに変異する（mutation XSS）。この修復＝入力の書き換えを突くのがサニタイザ回避。

4. `display:none` と `visibility:hidden` は render tree の扱いがどう違うか。なぜ攻撃で重要か。
   ▶ 答え: `display:none` は render tree に載らない（renderer を作らない）が、`visibility:hidden` は載る（場所を占めるが見えない）。見えない要素の座標・寸法が取得できるか否かが変わり、UI redressing や情報漏えいの成否に関わる。

5. HTML パースが reentrant であるとはどういうことか。原典が挙げる原因は何か。
   ▶ 答え: パース中に入力そのものが書き換わること。原因は `document.write` を含む script タグがパース入力に余分なトークンを追加できること。静的解析を無効化しうる。

6. CSS セレクタはどの方向でマッチされるか。`table div {}` を例に説明せよ。
   ▶ 答え: 右から左。まず対象要素が `div` かを判定し、その後で祖先に `table` があるかを上へたどる。ハッシュマップのキーも最右のセレクタになる。

7. specificity で `#id`（1 個）と `.class`（100 個）ではどちらが勝つか。理由は。
   ▶ 答え: `#id` が勝つ。specificity は a-b-c-d を大きな基数で連結するので、ID の桁はクラスの桁より上位。クラスをいくら並べても ID 1 個を超えない。

8. スクリプトとスタイルシートは、それぞれパースにどう影響するか。
   ▶ 答え: スクリプトは同期的にパースを止める（外部なら取得までも止まる。defer/async で回避可）。スタイルシートは、スクリプトが未読込スタイルの情報を問い合わせようとするとスクリプトをブロックしうる（Firefox は全スクリプト、WebKit は特定プロパティアクセス時のみ）。

9. HTML パースの 2 段は何と何か。それぞれのステートマシンの状態は何と呼ばれるか。
   ▶ 答え: tokenization と tree construction。tokenization の状態は "Data state"/"Tag open state"/"Tag name state" など、tree construction の状態は insertion modes（"initial"→"before html"→"in body"→"after after body" など）と呼ばれる。

10. WebKit のエラー耐性の実例を 2 つ挙げよ。
    ▶ 答え: 次のうち 2 つ ── `</br>` を `<br>` として扱う、stray table を 2 つの兄弟テーブルに変える、入れ子 form の 2 つ目を無視する、同種タグ 20 段超を破棄する、位置のおかしい html/body 終了タグを無視する。

## 出典

- https://codeburst.io/how-browsers-work-6350a4234634 （取得失敗。実体は下記原典の読解ノート）
- https://raw.githubusercontent.com/webplatform/docs/HEAD/concepts/Internet_and_Web/how_browsers_work/index.md （Tali Garsiel & Paul Irish, "How browsers work: behind the scenes of modern web browsers", 2011-08-05。本節の主な典拠）
- https://raw.githubusercontent.com/vasanthk/how-web-works/HEAD/README.md （二次資料。エンジン対応表・CRP の 4 段・右から左のマッチング）
- https://www.w3.org/TR/CSS2/grammar.html （CSS2 の字句・構文文法。原典が参照）

<!-- sources: https://codeburst.io/how-browsers-work-6350a4234634, https://raw.githubusercontent.com/webplatform/docs/HEAD/concepts/Internet_and_Web/how_browsers_work/index.md, https://raw.githubusercontent.com/vasanthk/how-web-works/HEAD/README.md, https://www.w3.org/TR/CSS2/grammar.html -->
<!-- terms: URI, W3C, DOM, レンダリングエンジン, WebKit, Gecko, Blink, render tree, Attachment, Reflow, Critical Rendering Path, トークン化, 挿入モード, ステートマシン, 文脈自由文法, BNF, DTD, エラー耐性, mutation XSS, サニタイザ回避, document.write, 投機的パース, speculative parsing, CSSOM, specificity, カスケード, rule tree, style context, スタイル共有, UI redressing, display:none, visibility:hidden, FOUC -->
<!-- self-read: https://codeburst.io/how-browsers-work-6350a4234634 | サイト側（エグレスプロキシ）の制限で取得不能。原典と二次情報で代替 -->
