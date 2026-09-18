# [01] Inside look at modern web browser (part 1) — CPU, GPU, Memory, and multi-process architecture

想定章: ch01（ブラウザの内部構造とプロセスモデル ― クライアントサイド脆弱性ハンティングの土台）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://developer.chrome.com/blog/inside-browser-part1 | full | GitHub raw（原典ソース） `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part1/index.md` | WebFetch は `EGRESS_BLOCKED`（developer.chrome.com はプロキシで拒否）。curl も `CONNECT tunnel failed, response 403`。web.archive.org も WebFetch 不可。**フォールバック(b)** として、developer.chrome.com の公式リポジトリ `GoogleChrome/developer.chrome.com` の記事ソース Markdown（310行 / 14,314バイト）を全文取得。本文・見出し・図キャプション・HTMLテーブル・リンクはすべて**原典の執筆ソースそのまま**なので、レンダリング後ページより忠実。 |
| （付随）本文中の図画像 12点 | **full**（補完工程で回収） | `raw.githubusercontent.com` 経由で **原典2018年版（google/WebFundamentals）の画像ファイル本体**を取得し、**12点すべてを実際に閲覧した** | 初回工程では wd.imgix.net / web-dev.imgix.net / storage.googleapis.com/web-dev-uploads がいずれも 000 / 403 で取得不能だった。補完工程で、この記事の**初出版（2018年 developers.google.com/web/updates/2018/09/inside-browser-part1）のソースリポジトリ `google/WebFundamentals`** に同一の図が `src/content/en/updates/images/inside-browser/part1/*.png` として置かれていることを突き止め、**PNG 12点＋アニメーション SVG 4点＋カバー画像1点を取得・閲覧済み**。下記「図の実物を確認しての記述」節は**実画像を見て書いたもの**。 |
| （原典・初出版）https://developers.google.com/web/updates/2018/09/inside-browser-part1 の記事ソース | full | `https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/2018/09/inside-browser-part1.md` | 2018年の初出版 Markdown（15,041バイト / 310行）。developer.chrome.com 版と**本文テキストは完全一致**（差分は front matter・リンク表記・アニメーション注記のみ。下記「原典2018年版との差分」節）。図の実体ファイルはこちらのリポジトリにのみ存在する。 |
| （付随）シリーズ part2/3/4 の題名確認 | full | 同リポジトリの各 `index.md` の `title:` と最初の `## ` 見出し | シリーズ構成を正確に書くための裏取りのみ。内容は別担当。 |

**メタ情報（原文 front matter より逐語）**

```yaml
layout: 'layouts/blog-post.njk'
title: Inside look at modern web browser (part 1)
description: >
  Learn how browser turn your code into functional website from high-level architecture to the specifics of the rendering pipeline.
authors:
  - kosamari
date: 2018-09-05
updated: 2018-09-21
```

- 著者: kosamari（Mariko Kosaka）。記事末尾に Twitter `@kosamari`（`https://twitter.com/kosamari`）。
- 初出 2018-09-05、更新 2018-09-21。**Chrome 67 時点**の記述（Site Isolation のデスクトップ既定有効化が Chrome 67）。教科書では「2018年時点の解説であり、以後 Network Service の独立プロセス化や Site Isolation のモバイル展開などが進んでいる」と注記するのが望ましい。

## 要約

- 4部構成シリーズの第1部。ブラウザが「コードを動く Web サイトに変える」仕組みを、高レベルアーキテクチャからレンダリングパイプラインまで解説するシリーズの土台となる回。
- 前半は計算機の基礎語彙: **CPU**（Central Processing Unit、汎用・逐次・コア数は少ない）と **GPU**（Graphics Processing Unit、単純タスクを多数コアで同時処理）、そして「Machine Hardware → Operating System → Application」の3層モデル。
- 次に **プロセス**（アプリの実行中プログラム。OS から「slab」＝専用メモリ空間を与えられ、全アプリ状態をその私有メモリに保持。終了すると OS がメモリを解放）と **スレッド**（プロセス内部に住み、プロセスのプログラムの一部を実行する）。プロセス間通信は **IPC**（Inter Process Communication）。あるワーカープロセスが応答しなくなっても、他を止めずに再起動できる設計にできる。
- ブラウザの作り方には**標準仕様が存在しない**（実装詳細）。Chrome は「最上位に browser process、その下に各タブへ割り当てられる複数の renderer process、他に GPU / Plugin、さらに Extension プロセスや utility プロセス」という**マルチプロセス**構成。
- マルチプロセスの利点: (1) 1タブが固まっても他タブが生存、(2) **セキュリティとサンドボックス**（OS のプロセス権限制限を使い、任意のユーザ入力を扱う renderer process から任意ファイルアクセスを剥奪）。代償: プロセスごとに私有メモリを持つため **V8 など共通インフラのコピーが複製されメモリ使用量が増える**。そのため Chrome はプロセス数に上限を設け、上限に達すると**同一サイトの複数タブを1プロセスに同居**させる。上限はデバイスのメモリと CPU 性能で変動。
- **Servicification（サービス化）**: browser process 内の各機能をサービスとして実装し、強力なハードウェアでは別プロセスに分割して安定性を上げ、リソース制約デバイスでは1プロセスに統合してメモリを節約する。Android では以前から同様の統合手法が使われていた。
- **Site Isolation（サイト分離）**: クロスサイト iframe ごとに別 renderer process を走らせる機能。Chrome 67 以降デスクトップで既定有効。従来の「1タブ1プロセス」では a.com と b.com が同一 renderer process でメモリ空間を共有していた。Web のコアセキュリティモデルは **Same Origin Policy** であり、**その回避（bypass）が攻撃の主目的**。プロセス分離がサイトを分ける最も有効な手段で、**Meltdown / Spectre** によって必要性が一層明白になった。実現は複数年のエンジニアリングで、iframe 間の通信方式そのものを変え、DevTools やページ内検索（Ctrl+F）が複数 renderer process をまたぐ実装を要した。

## 詳細ノート

### 導入（出典: https://developer.chrome.com/blog/inside-browser-part1）

原文冒頭（第1節見出しは `## CPU, GPU, Memory, and multi-process architecture`）。

- この4部構成のブログシリーズでは、Chrome ブラウザの内部を**高レベルアーキテクチャからレンダリングパイプラインの詳細まで**見ていく。
- 想定読者: 「ブラウザが自分のコードをどうやって機能する Web サイトにするのか気になったことがある人」「特定のテクニックがなぜパフォーマンス改善として推奨されるのか分からない人」。
- part 1 では **core computing terminology（計算機の中核用語）** と **Chrome のマルチプロセスアーキテクチャ** を扱う。
- 原文には注記（Aside）がある。逐語: *"If you are familiar with the idea of CPU/GPU and process/thread you may skip to [Browser Architecture](#browser-architecture)."* → CPU/GPU とプロセス/スレッドの概念に馴染みがあるなら `#browser-architecture` へ飛んでよい。

### At the core of the computer are the CPU and GPU（コンピュータの中核は CPU と GPU）（出典: 同上）

導入文の主旨: **ブラウザが動作している「環境」を理解するには、いくつかのコンピュータ部品とその役割を理解する必要がある**。

#### CPU

- 正式名: **C**entral **P**rocessing **U**nit（中央処理装置）。
- 位置づけ: **「コンピュータの脳」と考えてよい**。
- CPU コアは（図1で）**デスクに座るオフィスワーカー**として描かれる。**入ってくる多種多様なタスクを1つずつ順に処理できる**。
- 原文の比喩を逐語で: *"It can handle everything from math to art while knowing how to reply to a customer call."*（数学からアートまで何でも扱い、かつ顧客電話への応答の仕方も知っている）→ **汎用性**の強調。
- 歴史: **過去はほとんどの CPU が単一チップだった**。**コアとは「同じチップの中に住むもう1つの CPU」のようなもの**。
- 現代ハードウェアでは**1つ以上のコアを持つことが多く**、スマートフォンやラップトップに計算能力を与えている。

図1キャプション（逐語）:
> Figure 1: 4 CPU cores as office workers sitting at each desk handling tasks as they come in

#### GPU

- 正式名: **G**raphics **P**rocessing **U**nit（グラフィックス処理装置）。コンピュータのもう1つの部品。
- CPU と違い、**GPU は単純なタスクを得意とするが、それを複数コアで同時に（across multiple cores at the same time）処理する**。
- 名前が示すように**最初はグラフィックスを扱うために開発された**。
- そのためグラフィックスの文脈では **"using GPU"** や **"GPU-backed"** という表現が、**高速なレンダリングと滑らかなインタラクション**と結び付けられる。
- 近年は **GPU-accelerated computing**（GPU アクセラレーテッドコンピューティング）により、**GPU 単独で可能な計算が増え続けている**。

図2キャプション（逐語）:
> Figure 2: Many GPU cores with wrench suggesting they handle a limited task

（＝多数の GPU コアがそれぞれレンチを1本持っている絵。「限定された1種類のタスクしか扱わない」ことの表現。CPU 側＝万能なオフィスワーカー、GPU 側＝同じ工具を持った大量の作業者、という対比。）

#### 3層モデル（ハードウェア / OS / アプリケーション）

- コンピュータやスマートフォンでアプリを起動すると、**アプリに力を与えているのは CPU と GPU**。
- 通常、**アプリは Operating System（OS）が提供するメカニズムを介して CPU と GPU 上で動く**。

図3キャプション（逐語）:
> Figure 3: Three layers of computer architecture. Machine Hardware at the bottom, Operating System in the middle, and Application on top.

（＝下から **Machine Hardware** → **Operating System** → **Application** の3段重ね。教科書ではこの図を「アプリはハードウェアに直接触れず、必ず OS のメカニズムを経由する」＝後述のサンドボックス（OS によるプロセス権限制限）が成立する前提として引用するとよい。）

### Executing program on Process and Thread（プロセスとスレッドの上でプログラムを実行する）（出典: 同上）

ブラウザアーキテクチャに入る前に掴むべきもう1つの概念が **Process（プロセス）** と **Thread（スレッド）**。

- **プロセス**: 「**アプリケーションの実行中プログラム（an application's executing program）**」と説明できる。
- **スレッド**: 「**プロセスの内側に住み、そのプロセスのプログラムのいずれかの部分を実行するもの**」。
- アプリを起動すると**プロセスが1つ作られる**。プログラムは作業を助けるために**スレッドを作ることもあるが、それは任意（optional）**。
- **OS はプロセスに作業用のメモリの「slab（ひと塊）」を与え、アプリケーションの全状態はその private memory space（私有メモリ空間）に保持される**。
- アプリを閉じると**プロセスも消え、OS がメモリを解放する**。

図4キャプション（逐語）:
> Figure 4: Process as a bounding box, threads as abstract fish swimming inside of a process

（＝プロセスは外枠の箱、スレッドはその中を泳ぐ抽象的な魚として描かれる。）

図5キャプション（逐語）:
> Figure 5: Diagram of a process using memory space and storing application data

（＝1つのプロセスがメモリ空間を使い、アプリケーションデータを格納している図。）

#### 複数プロセスと IPC

- **プロセスは OS に対して、別のタスクを走らせるための別プロセスの起動を依頼できる**。
- そうすると**新しいプロセスにはメモリの別の部分が割り当てられる**（＝メモリ空間は共有されない）。
- **2つのプロセスが会話する必要があるときは、**I**nter **P**rocess **C**ommunication（**IPC**）を使う**。
- **多くのアプリケーションがこの方式で設計されている理由**（逐語の主旨）: *"so that if a worker process get unresponsive, it can be restarted without stopping other processes which are running different parts of the application."* → **ワーカープロセスが応答不能になっても、アプリの別部分を走らせている他プロセスを止めずに再起動できるから**。

図6キャプション（逐語）:
> Figure 6: Diagram of separate processes communicating over IPC

（＝分離された複数プロセスが IPC 越しに通信している図。）

〔補足（一般知識）〕Chrome の IPC は Mojo というメッセージパッシング基盤で実装されており、「サンドボックス化された renderer が browser process に対して行う IPC 呼び出し」が特権境界そのものになる。原文にはこの名称は登場しない。

### Browser Architecture（ブラウザアーキテクチャ）（出典: 同上、アンカー `#browser-architecture`）

- 問い: 「では Web ブラウザはプロセスとスレッドを使ってどう作られているのか?」
- 答え: **「多数の異なるスレッドを持つ1プロセス」でもありうるし、「少数のスレッドを持つ多数のプロセスが IPC 越しに通信する」形でもありうる**。

図7キャプション（逐語）:
> Figure 7: Different browser architectures in process/thread diagram

（＝プロセス/スレッド図で表した異なるブラウザアーキテクチャの並列比較。単一プロセス・多スレッド型と、多プロセス・少スレッド型の対比。）

**最重要の注意点（原文が "The important thing to note here" として強調）**:

- **これら異なるアーキテクチャは実装詳細（implementation details）である。**
- **Web ブラウザをどう作るべきかの標準仕様（standard specification）は存在しない。**
- **あるブラウザのアプローチは別のブラウザと完全に異なりうる。**

→ 本シリーズでは以下の図に示す **Chrome の（当時の）最近のアーキテクチャ** を使う。

- **最上位に browser process があり、アプリケーションの異なる部分を担当する他プロセスと協調（coordinating）する。**
- **renderer process については複数プロセスが作られ、各タブに割り当てられる。**
- **ごく最近までは、Chrome は可能なときに各タブへ1プロセスを与えていた。現在は iframe も含め、各サイトに自前のプロセスを与えようとしている**（→ Site Isolation 節へ）。

図8キャプション（逐語）:
> Figure 8: Diagram of Chrome's multi-process architecture. Multiple layers are shown under Renderer Process to represent Chrome running multiple Renderer Processes for each tab.

（＝Chrome のマルチプロセスアーキテクチャ図。**Renderer Process の下に複数の層（重ね描き）が示され、Chrome がタブごとに複数の Renderer Process を走らせていることを表す**。）

### Which process controls what?（どのプロセスが何を制御するか）（出典: 同上）

原文は「The following table describes each Chrome process and what it controls:」として HTML テーブルを提示。**原文の表を逐語で完全再現**（列見出しは原文どおり `Process and What it controls`）:

| Process | What it controls（原文逐語） |
| --- | --- |
| Browser | Controls "chrome" part of the application including address bar, bookmarks, back and forward buttons. Also handles the invisible, privileged parts of a web browser such as network requests and file access. |
| Renderer | Controls anything inside of the tab where a website is displayed. |
| Plugin | Controls any plugins used by the website, for example, flash. |
| GPU | Handles GPU tasks in isolation from other processes. It is separated into different process because GPUs handles requests from multiple apps and draw them in the same surface. |

日本語訳（内容を落とさず）:

| プロセス | 制御対象 |
| --- | --- |
| **Browser（ブラウザプロセス）** | アプリケーションの「chrome」部分、すなわち**アドレスバー、ブックマーク、戻る/進むボタン**を制御する。**加えて、ネットワークリクエストやファイルアクセスといった、Web ブラウザの「目に見えない特権的な部分（the invisible, privileged parts）」も扱う。** |
| **Renderer（レンダラプロセス）** | **Web サイトが表示されるタブの内側のあらゆるもの**を制御する。 |
| **Plugin（プラグインプロセス）** | Web サイトが使うプラグイン（**例: flash**）を制御する。 |
| **GPU（GPUプロセス）** | **GPU タスクを他プロセスから隔離して**扱う。**GPU は複数アプリからのリクエストを扱い、それらを同一のサーフェス（same surface）に描画するため**、別プロセスに分離されている。 |

- 用語メモ: ここでの **"chrome"（小文字）はブラウザ UI の枠部分**を指す一般語であり、製品名 Chrome とは別。**アドレスバー・ブックマーク・戻る進むは browser process の管轄で、Web コンテンツ（renderer）からは直接触れない** ＝ これが「UI スプーフィング系バグ」「アドレスバー偽装」が特別扱いされる構造的理由。

図9キャプション（逐語）:
> Figure 9: Different processes pointing to different parts of browser UI

（＝異なるプロセスがブラウザ UI の異なる部分を指し示す図。UI の枠＝Browser、タブ内の描画領域＝Renderer、といった対応付け。）

#### さらに存在するプロセスと Task Manager の確認手順

- 原文: **「Extension process や utility processes のような、さらに多くのプロセスも存在する」**（*"There are even more processes like the Extension process and utility processes."*）。
- 自分の Chrome で何個のプロセスが動いているかを見る手順（**原文の操作手順を逐語ベースで**）:
  1. 右上隅の **options menu icon（`more_vert`、いわゆる三点リーダ）** をクリック
  2. **More Tools** を選択
  3. **Task Manager** を選択
- すると**現在実行中のプロセス一覧と、それぞれの CPU / Memory 使用量**を示すウィンドウが開く。

〔補足（一般知識）〕原文が列挙するのは Browser / Renderer / Plugin / GPU / Extension / Utility。担当タスクで挙がっていた **Network プロセス（Network Service）** は、原文の表には独立プロセスとして載っておらず、表では「browser process がネットワークリクエストを扱う」と書かれている。独立プロセス化は次節の **Servicification** の一環として進んだもので、原文執筆時点（2018）では移行途中だった。教科書では「2018年の原文では network は browser process の職責として書かれている／servicification により Network Service として切り出された」と時系列を分けて書くと正確。

**［補完工程での訂正・追加］** 実画像を回収して確認した結果、**原文の Figure 7（右案）と Figure 11（右側＝After）には `Network Process` が独立ボックスとして明示的に描かれている**（さらに `UI Process` / `Storage Process` / `Device Process` も）。つまり **2018年の原文でも「図のレベルでは」既に Network Service 分離後の姿が提示されていた**。正確には「**本文の表＝当時の実装、図7右・図11右＝servicification の到達目標**」という二層構造。Chromium 公式の `docs/servicification.md` は *"with the Network Service in place we can now run the entire network stack either inside or outside of the browser process with the flip of a command-line switch"* と述べており、**現在は両構成が切替可能**（出典: `https://raw.githubusercontent.com/chromium/chromium/main/docs/servicification.md`）。

### The benefit of multi-process architecture in Chrome（Chrome におけるマルチプロセスアーキテクチャの利点）（出典: 同上）

**利点1: 障害の隔離（クラッシュ耐性）**

- Chrome は複数の renderer process を使う。**最も単純なケースとして「各タブが自分の renderer process を持つ」と考えられる**。
- 例: **3つのタブを開いていて、各タブが独立した renderer process で動いている**とする。
- **1つのタブが応答不能（unresponsive）になったら、その応答不能なタブだけを閉じて、他のタブを生かしたまま作業を続けられる。**
- **もし全タブが1プロセスで動いていたら、1タブが応答不能になると全タブが応答不能になる。**原文の感想はそのまま *"That's sad."*

図10キャプション（逐語）:
> Figure 10: Diagram showing multiple processes running each tab

**利点2: セキュリティとサンドボックス**

- 原文: *"Another benefit of separating the browser's work into multiple processes is security and sandboxing."*
- **OS はプロセスの特権（privileges）を制限する手段を提供する**ので、**ブラウザは特定のプロセスを特定の機能からサンドボックス化できる**。
- **具体例（重要）: Chrome ブラウザは、renderer process のように「任意のユーザ入力（arbitrary user input）を扱うプロセス」に対して、任意のファイルアクセス（arbitrary file access）を制限する。**

→ 脆弱性ハンティングの観点で最重要の一文。**renderer process は「信頼できない入力＝Web コンテンツ」を処理する側なので、意図的に低特権に落とされている**。したがって「renderer 内でのコード実行」だけではファイル読み出しや OS 操作に到達せず、**サンドボックス脱出（IPC 経由での browser process への攻撃）が別途必要**という2段構えの脅威モデルになる。

**代償: メモリ使用量の増加**

- **プロセスはそれぞれ私有メモリ空間を持つため、共通インフラのコピーをしばしば各プロセスが抱える**。**原文が挙げる例: V8（Chrome の JavaScript エンジン）**。
- **これは「同一プロセス内のスレッドであれば共有できたものが共有できない」ため、メモリ使用量の増加を意味する。**
- **メモリを節約するため、Chrome は起動できるプロセス数に上限（a limit on how many processes it can spin up）を設けている。**
- **上限はデバイスのメモリ量と CPU 性能によって変わる。**
- **Chrome が上限に達すると、同一サイト（the same site）からの複数タブを1プロセスで動かし始める。**

〔補足（一般知識）〕この「上限に達すると同一サイトのタブを同居させる」挙動は、後の Site Isolation 世代でも「プロセス数上限に達したら同一サイト単位で再利用する」形で残る。診断時に「別タブなのに同じプロセスだった」現象の説明になる。

### Saving more memory - Servicification in Chrome（さらなるメモリ節約 ― Chrome のサービス化）（出典: 同上）

- **同じアプローチ（プロセス分割・統合の調整）が browser process にも適用される。**
- **Chrome は、ブラウザプログラムの各部分を「サービス（service）」として動かすアーキテクチャ変更を進行中であり、これにより「異なるプロセスへ容易に分割する」ことも「1つに集約する」ことも可能になる。**
- **一般的な考え方（General idea）**:
  - **強力なハードウェア上で動いているときは、各サービスを別プロセスに分割し、より高い安定性（more stability）を得る。**
  - **リソース制約のあるデバイス（resource-constraint device）上では、サービスを1プロセスに統合し、メモリフットプリントを節約する。**
- **メモリ使用量削減のためにプロセスを統合する同様のアプローチは、この変更以前から Android のようなプラットフォームで使われていた。**

図11キャプション（逐語）:
> Figure 11: Diagram of Chrome's servicification moving different services into multiple processes and a single browser process

（＝Chrome の servicification が、異なるサービス群を「複数プロセスへ」あるいは「単一の browser process へ」移動させる様子を示す図。左右で「分割構成」と「集約構成」を対比する図。）

### Per-frame renderer processes - Site Isolation（フレーム単位のレンダラプロセス ― サイト分離）（出典: 同上、アンカー `#site-isolation`）

**原文リンク（逐語）**:
- Site Isolation: `https://developers.google.com//web/updates/2018/07/site-isolation`（※原文のダブルスラッシュ表記のまま。現在は `https://developer.chrome.com/blog/site-isolation` 相当へ転送される）
- Same Origin Policy: `https://developer.mozilla.org/docs/Web/Security/Same-origin_policy`
- Meltdown and Spectre: `https://developers.google.com/web/updates/2018/02/meltdown-spectre`

内容:

- **Site Isolation は Chrome に最近導入された機能で、「クロスサイト iframe のそれぞれに別個の renderer process を走らせる」。**
- **それまで話してきた「1タブ1 renderer process」モデルでは、クロスサイト iframe が単一の renderer process 内で動き、異なるサイト間でメモリ空間を共有していた。**
- **「a.com と b.com を同じ renderer process で動かすのは、一見問題ないように思えるかもしれない。」**
- しかし **Same Origin Policy は Web のコアセキュリティモデル（the core security model of the web）であり、「1つのサイトが同意なしに他サイトのデータへアクセスできないことを保証する」もの**。
- **「このポリシーの回避（Bypassing this policy）は、セキュリティ攻撃の主要な目標（a primary goal of security attacks）である。」** ← 教科書 ch01 の核心の一文。
- **「プロセス分離はサイトを分離する最も効果的な方法（the most effective way to separate sites）である。」**
- **Meltdown と Spectre によって、「プロセスを使ってサイトを分離する必要がある」ことが一層明白になった。**
- **Chrome 67 以降、デスクトップで Site Isolation が既定で有効になり、タブ内の各クロスサイト iframe が別個の renderer process を得る。**

図12キャプション（逐語）:
> Figure 12: Diagram of site isolation; multiple renderer processes pointing to iframes within a site

（＝サイト分離の図。複数の renderer process が、あるサイト内の各 iframe を指し示している。1つのタブ／1つのページの中に、埋め込みサイトごとに別プロセスが割り当てられる様子。）

**実装コストの話（原文が強調する部分）**:

- **Site Isolation の有効化は複数年にわたるエンジニアリング努力（a multi-year engineering effort）だった。**
- **Site Isolation は「異なる renderer process を割り当てるだけ」の単純な話ではなく、iframe 同士の会話のしかたを根本的に変える（fundamentally changes the way iframes talk to each other）。**
- **異なるプロセスで動く iframe を含むページで DevTools を開くということは、DevTools 側が「シームレスに見せるための裏方作業」を実装しなければならないことを意味した。**
- **単純な Ctrl+F でページ内の語を探すことすら、異なる renderer process をまたいで検索することを意味する。**
- **だからこそブラウザエンジニアが Site Isolation のリリースを「major milestone（大きな節目）」と語る理由が分かる。**

〔補足（一般知識）〕原文は「site」と「origin」の違いを明示していないが、Site Isolation の分離単位は**サイト（scheme + eTLD+1）**であり、Same Origin Policy の単位である**オリジン（scheme + host + port）より粗い**。そのため `a.example.com` と `b.example.com` は同一サイト扱いで同一プロセスに入りうる。教科書ではこの粒度差を明示すると、後続章（Spectre 系サイドチャネル、COOP/COEP、`Origin-Agent-Cluster`）につながる。

### Wrap-up（まとめ）（出典: 同上）

- この投稿では **ブラウザアーキテクチャの高レベルな見取り図** と **マルチプロセスアーキテクチャの利点** を扱った。
- **マルチプロセスアーキテクチャと深く関係する Chrome の Servicification と Site Isolation** も扱った。
- **次の投稿では、Web サイトを表示するためにこれらプロセスとスレッドの間で何が起きるのかに踏み込む。**
- 著者からの呼びかけ: 質問や今後の投稿への提案はコメント欄か Twitter `@kosamari` へ。
- 末尾のナビゲーションボタン（逐語のリンクとラベル）: `href="/blog/inside-browser-part2"` / ラベル **"Next: What happens in navigation"**。

## シリーズ構成（裏取り済み）

| Part | title（原文 front matter 逐語） | 最初の節見出し（逐語） | URL |
| --- | --- | --- | --- |
| 1 | Inside look at modern web browser (part 1) | `## CPU, GPU, Memory, and multi-process architecture` | https://developer.chrome.com/blog/inside-browser-part1 |
| 2 | Inside look at modern web browser (part 2) | `## What happens in navigation` | https://developer.chrome.com/blog/inside-browser-part2 |
| 3 | Inside look at modern web browser (part 3) | `## Inner workings of a Renderer Process` | https://developer.chrome.com/blog/inside-browser-part3 |
| 4 | Inside look at modern web browser (part 4) | `## Input is coming to the Compositor` | https://developer.chrome.com/blog/inside-browser-part4 |

## 図の内容を文章で再現（Figure 1〜12）

［注記］この表は初回工程の成果物で、当時は画像を取得できず**原文キャプション（逐語）＋本文の記述からのみ**再現したもの。補完工程で実画像を回収・閲覧した結果、**この表の記述はすべて実画像と矛盾しないことを確認済み**（誤りは見つからなかった）。ただし実画像にはここに書かれていない情報が多数あるため、**執筆時は次節「図の実物を確認しての記述」を正とすること**。］

| 図 | キャプション（原文逐語） | 文章での再現 |
| --- | --- | --- |
| Figure 1 | 4 CPU cores as office workers sitting at each desk handling tasks as they come in | CPU の4コアを、それぞれ机に座った4人のオフィスワーカーとして描く。入ってきたタスクを1つずつ順に処理する＝**汎用だが逐次的**であることの表現。 |
| Figure 2 | Many GPU cores with wrench suggesting they handle a limited task | GPU の多数コアを、**レンチ（工具）を持った大量の作業者**として描く。工具が1種類しかない＝**限定されたタスクしか扱わないが並列度が高い**ことの表現。 |
| Figure 3 | Three layers of computer architecture. Machine Hardware at the bottom, Operating System in the middle, and Application on top. | 3層のスタック図。下から **Machine Hardware**、**Operating System**、**Application**。アプリはハードウェアに直接触らず、OS のメカニズム越しに CPU/GPU を使う。 |
| Figure 4 | Process as a bounding box, threads as abstract fish swimming inside of a process | プロセスを**外枠の箱**、スレッドを**その中を泳ぐ抽象的な魚**として描く。スレッドはプロセスの境界の内側にしか存在できない。 |
| Figure 5 | Diagram of a process using memory space and storing application data | 1つのプロセスがメモリ空間を占有し、その中にアプリケーションデータを保存している図。OS が与えた「slab」の可視化。 |
| Figure 6 | Diagram of separate processes communicating over IPC | 2つ（以上）の分離されたプロセスが、それぞれ別のメモリ領域を持ちながら **IPC** の矢印で通信している図。 |
| Figure 7 | Different browser architectures in process/thread diagram | ブラウザの作り方の選択肢を並べた比較図。「1プロセス＋多数スレッド」型と「多数プロセス＋少数スレッド＋IPC」型。**どちらも仕様上許される実装詳細**。 |
| Figure 8 | Diagram of Chrome's multi-process architecture. Multiple layers are shown under Renderer Process to represent Chrome running multiple Renderer Processes for each tab. | Chrome のマルチプロセス構成図。**最上位に Browser Process**、その下に **Renderer Process（複数枚重ね＝タブごとに複数存在）**、および **GPU Process / Plugin Process** が並ぶ。Browser Process が他プロセスを統括する。 |
| Figure 9 | Different processes pointing to different parts of browser UI | Chrome のウィンドウのスクリーンショット的な絵に、どの部分がどのプロセスの管轄かを矢印で示す図。UI の外枠（アドレスバー等）→ Browser、タブ内のページ → Renderer、といった対応。 |
| Figure 10 | Diagram showing multiple processes running each tab | 3つのタブがそれぞれ独立した renderer process で動く図。1つが応答不能になっても他が生き残ることの説明。 |
| Figure 11 | Diagram of Chrome's servicification moving different services into multiple processes and a single browser process | Servicification の図。同じサービス群が、**「複数プロセスに分割された構成」** と **「単一 browser process に集約された構成」** の両方に配置され得ることを対比して示す。 |
| Figure 12 | Diagram of site isolation; multiple renderer processes pointing to iframes within a site | サイト分離の図。1ページ内の各クロスサイト iframe に対して、別々の renderer process が対応付けられている。 |

## 図の実物を確認しての記述（Figure 1〜12・**実画像を取得して閲覧済み**）

**出典**: 本記事の初出版（2018年 Web Fundamentals）の画像ファイル本体。恒久 URL（コミット SHA 固定）:
`https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/images/inside-browser/part1/<ファイル名>`

すべて **kosamari 氏による手描きモノクロ線画**（一部に緑・青・黄のアクセント色）。以下は**実際に画像を開いて見た内容**であり、キャプションからの推測ではない。

### Figure 1 — `CPU.png`（856×491）

- 4体の同型キャラクタ。**頭＝スマイリーフェイスの付いた長方形**で、**片手にレンチ、もう片手に電卓**を持ち、それぞれ机に着いている。机の上にはアイコンの並んだキーボード状のコンソール。
- 右下から**波打つリボン（ベルトコンベア）**が流れてきて、その上に **`Task ... Task ... Task ...`** の文字が繰り返し書かれている＝**タスクが列をなして到着する**様子。
- 中央に **`+ − × ÷` の演算記号**と**立方体（3Dオブジェクト）**が浮かび、1体が **`DONE!`** と書かれた紙を放り投げている。
- 左下に大きく **`CPU` / `Central Processing Unit`**。
- **読み取れる主張**: 1コア＝**レンチ（工作）も電卓（計算）も両方持つ万能ワーカー**。到着する多様なタスクを**1つずつ順に**片付ける。**コア数は4しかない**。

### Figure 2 — `GPU.png`（856×491）

- **5行×4列＝約20体**の小さな正方形スマイリーが**整列**。**全員が「レンチ1本だけ」を持っている**（電卓は無い）。
- 上部中央に **`Task` と書かれた吹き出しアイコン＋矢印＋ `Order In!!`** の文字＝**1つの命令が全員に一斉に降りてくる**。
- 左下に **`GPU` / `Graphics Processing Unit`**。
- **読み取れる主張**: Figure 1 との対比が図の全て。**CPU＝少数の万能ワーカー（工具2種）／GPU＝多数の単能ワーカー（工具1種）を一斉駆動**。

### Figure 3 — `hw-os-app.png`（856×446）

- **平行四辺形の板を3枚、アイソメトリック（斜め上から）に積み重ねた図**。各板の左辺に沿ってラベル。下から **`Machine Hardware`** → **`Operating System`** → **`Application`**。
- **最下段（ハードウェア）の板の上には、Figure 1 の CPU ワーカー群と Figure 2 の GPU グリッドがそのまま描かれている**。
- それらは**中段（OS）の板を通過するところで薄いグレーに退色**して描かれ、**最上段（Application）の板は白紙**で、左上隅に**ウィンドウの信号機ボタン（赤・黄・緑の小さな3点）**だけが描かれている。
- **読み取れる主張**: アプリ（白紙＝これから描かれるウィンドウ）は**ハードウェアに直接触らない**。CPU/GPU の姿は **OS 層を経由するとぼやける**＝アプリから見たハードウェアは OS 越しの抽象。**サンドボックス＝OS がプロセス特権を絞れる、という後段の話の前提図**。

### Figure 4 — `process-thread.png`（856×546）

- **太い角丸の長方形が1つ**。左下に **`Process`** のラベル。
- その内側に、**点線でできた魚形のループが2匹**。それぞれ**スマイリーの顔**と**「≫」型の尾ひれ**を持ち、**互いに逆向き**に泳いでいる。
- 2匹ともから引き出し線があり **`Thread`** とラベル。
- **読み取れる主張**: **スレッドはプロセスの枠の内側にしか存在しない**。枠＝プロセス境界。以降の全図で、この「点線の魚」＝スレッドの記法が一貫して使われる。

### Figure 5 — `memory.png`（865×505）+ アニメーション版 `memory.svg`

- 左: Figure 4 のプロセス（点線の魚2匹入りの箱）が、**モニタ／スクリーンとして立っている**。その足元に**大きな格子（グリッド）の板**が広がり、板の左下辺に沿って **`Memory`** のラベル。
- **プロセスの真下の 3×2 セル分の格子が緑色に塗られている**＝**OS がこのプロセスに与えた「slab」**。その緑のセルの中に**小さな黄色の三角形が2つ**置かれている。
- 右: **信号機ボタン（赤・黄・緑）付きのウィンドウ**。中に額縁状の枠があり、**大きな黄色い三角形が2つ**（左の伏せた三角と右の立った三角）、その下に**本文を表す横線が4本**。
- **読み取れる主張**: **画面に見えているデータ（黄色い三角形）の実体は、プロセスの私有メモリ（緑のセル）の中にある**。「アプリケーションの全状態は private memory space に保持される」という本文の可視化。
- `memory.svg` は**同じ絵の CSS アニメーション版**（`@keyframes memory / process / app / obj / smallobj / line`、各 10 秒ループ）。原文では図をクリックするとアニメが見られる作りだった。

### Figure 6 — `workerprocess.png`（865×515）+ アニメーション版 `workerprocess.svg`

- Figure 5 と同じ **`Memory` グリッド板**の上に、**プロセスのスクリーンが2枚**立っている（左上と右）。どちらも中に点線の魚（スレッド）が2匹。
- **左のプロセスの取り分は緑のセル群**、**右のプロセスの取り分は青のセル群**。**緑と青は重なっていない**（格子上の別の場所）。
- 2枚のスクリーンの上部を**点線の曲線矢印**が結び、その上に **`Inter Process Communication`** と明記。
- **読み取れる主張**: **プロセスが増えるとメモリは「別の区画」が割り当てられる（共有されない）**。だから**会話するには IPC という明示的な線を通るしかない**。→ **この点線1本が、後の「サンドボックス脱出は IPC を通る」という話の図解になっている**。

### Figure 7 — `browser-arch.png`（865×259）

**左右2案の対比図**。

- **左案**: 大きな角丸ボックス1つ、ラベル **`Browser Process`**。中に**点線の魚（スレッド）が4匹**、それぞれ**別々のアイコン**を抱えている（ルータ／モデム風の機器、Wi-Fi アンテナ風の電波、サーバ／ストレージ風の箱、本を読みながら道具を使う姿）。＝**1プロセス＋多数スレッド**。
- **右案**: **小さなボックスが8つ**並び、それぞれ**点線の魚を1〜2匹**含む。ラベルは上段左から **`Network Process`** / **`Browser Process`** / **`UI Process`**、中段 **`Storage Process`** / **`GPU Process`**、下段 **`Device Process`** / **`Renderer Process`**（**カードを3枚重ねた描き方**＝複数インスタンス）/ **`Plugin Process`**。**ボックス間を大量の点線（IPC）が交差して結ぶ**。
- **読み取れる主張**: 同じ機能を**「1プロセス多スレッド」でも「多プロセス少スレッド＋IPC」でも作れる**＝実装詳細。
- **重要な気づき（初回ノートへの訂正情報）**: **この図の右案には既に `Network Process` が独立ボックスとして描かれている**。本文の表（Which process controls what?）では「ネットワークリクエストは browser process が扱う」と書かれているが、**図のレベルでは 2018 年時点で既に Network Service 独立プロセス化後の姿が示されている**。教科書では「本文の表＝当時の実装、図7/図11の右側＝servicification 後の到達点」と整理すると正確。

### Figure 8 — `browser-arch2.png`（865×499）

Chrome の実アーキテクチャ図。**ボックスの配置と結線まで含めて以下のとおり**。

- **左上（最大のボックス）: `Browser Process`**。中に**点線の魚が3匹**、それぞれ**ルータ／モデム風アイコン（ネットワーク）**、**Wi-Fi／電波アイコン**、**サーバ／ストレージ箱アイコン**を持つ。
- **右上: `Utility Process`**（魚1匹＋**レンチ**）。
- **右中: `GPU Process`**（魚1匹＋**ピクセルグリッド状のアイコン**）。
- **左下: `Renderer Process`** — **カードを3枚重ねた描き方**（＝複数インスタンス）。各カードの中に**魚が2匹**、片方は**本（パース／解析）**、もう片方は**描画道具（ペイント）**のアイコンを持つ。
- **右下: `Plugin Process`** — こちらも**カードを重ねた描き方**。魚は**ジグソーパズルのピース**を持つ。
- **結線（太い点線＋接点の黒丸）**: Browser↔Utility、Browser↔Renderer、Browser↔GPU、Browser↔Plugin、Renderer↔GPU、Plugin↔GPU。
- **読み取れる主張**: **Browser Process が中心のハブ**。**Renderer と Plugin だけが「複数枚重ね」＝サイト/タブごとに増える**。**Renderer は GPU とも直接線を持つ**（描画コマンドの経路）。**Utility Process は図の中に明示されている**（本文では列挙のみ）。

### Figure 9 — `browserui.png`（865×441）

- 中央に **Chrome ウィンドウの線画**（タブ1枚のタブストリップ、戻る・進む・リロードボタン、オムニボックス、右端に三点メニュー）。
- **ウィンドウの外枠全体が黄色い点線の矩形で囲まれ**、さらに**コンテンツ領域の左右に黄色い実線の縦バー**が引かれて領域を区切っている。
- 4つのボックスから矢印:
  - **左上 `Browser Process`** → **ウィンドウの枠（chrome 部分）**を指す**実線矢印**。
  - **左下 `GPU Process`** → **ページ領域**への**点線矢印**。
  - **右 `Renderer Process`** → **ページのコンテンツ領域**を指す**実線矢印**。
  - **右下 `Plugin Process`** → **ページ内部に描かれた黄色枠の小さな矩形**（＝ページ内に埋め込まれたプラグイン領域）を指す**実線矢印**。
- **読み取れる主張**: **UI スプーフィングの境界線がそのまま絵になっている**。**アドレスバー・タブ・ボタンは Browser Process の描画物**で、**Web コンテンツ（Renderer）が描けるのは黄色バーの内側だけ**。教科書 ch01 で「なぜアドレスバー偽装が別カテゴリの脆弱性なのか」を説明する図として最適。

### Figure 10 — `tabs.png`（865×494）+ アニメーション版 `tabs.svg`

- **タブが3枚**開いた Chrome ウィンドウ。
- 上に3つのボックス。**左2つは `Renderer Process`**（各々魚2匹）で、**1枚目・2枚目のタブへ矢印**。
- **3つ目のボックスだけが灰色に塗られ**、中身は**「Aw, Snap!」のクラッシュアイコン（×印の目をした悲しい顔のページアイコン）と `Aw, Snap!` の文字**。そこから**3枚目のタブへ矢印**。
- タブストリップの右端に **`meow`** の文字（著者のジョーク）。
- **読み取れる主張**: **1つのタブのレンダラが死んでも、他の2タブのレンダラは生きている**。「そのタブだけ閉じて作業を続けられる」の可視化。

### Figure 11 — `servicfication.png`（950×310）+ アニメーション版 `servicfication.svg`

**左（Before）→ 太い灰色の矢印3本 → 右（After）** の変換図。

- **左（Before）**: **`Browser Process`** の大箱の中に**魚が3匹（ルータ／モデム、Wi-Fi、ストレージ箱）**＝**ネットワーク・デバイス・ストレージの機能が browser process の内側に同居**。周囲に **`Utility Process`**、**`GPU Process`**、**`Plugin Process`（重ね描き）**、**`Renderer Process`（重ね描き）**。
- **右（After）**: **Figure 7 の右案とまったく同じ配置** — **`Network Process`** / **`Browser Process`** / **`UI Process`** / **`Storage Process`** / **`GPU Process`** / **`Device Process`** / **`Renderer Process`（重ね描き）** / **`Plugin Process`（重ね描き）** が**それぞれ独立ボックス**になり、**点線 IPC が総当たりで交差**。
- **読み取れる主張**: servicification とは、**browser process の内側にいた魚（スレッド）を1匹ずつ外に出して独立プロセスにする**操作。**逆向きに読めば「低スペック端末では箱を畳んで browser process に戻す」構成**になる（本文の「集約してメモリを節約」）。
- **セキュリティ的含意**: **After の図では IPC 線の本数が激増している**。分離が進むほど**プロセス境界＝攻撃面（IPC インタフェース）の数も増える**ことが、絵の上で一目で分かる。

### Figure 12 — `isolation.png`（865×443）

- 中央に Chrome ウィンドウ。**ページの右上に `a.com` のラベル**（＝トップレベルドキュメントは a.com）。
- ページの中に**大きな矩形が縦に2つ**、それぞれ **`iframe b.com`**、**`iframe c.com`** とラベル。
- **右側の `Renderer Process` ボックス → a.com のページ本体**へ矢印。
- **左側に `Renderer Process` ボックスが2つ**、それぞれ **`iframe b.com`** と **`iframe c.com`** へ矢印。
- **読み取れる主張**: **1タブ・1ページの中にサイトが3つあれば、レンダラプロセスは3つ**。Site Isolation の粒度が「タブ」ではなく「**フレーム内のサイト**」であることの決定的な絵。

### 図のファイル対応表（恒久 URL）

ベース URL: `https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/images/inside-browser/part1/`

| 図 | 現行 developer.chrome.com 版のパス | 原典2018年版のファイル名 | 静止画サイズ | アニメ版 |
| --- | --- | --- | --- | --- |
| Figure 1 | `image/T4Fy.../Wx90M7DlxzVdXEeg5UhL.png` | `CPU.png` | 856×491 | — |
| Figure 2 | `image/T4Fy.../W6kFjvrwk1yDEhs8lFm1.png` | `GPU.png` | 856×491 | — |
| Figure 3 | `image/T4Fy.../9M8aKlSl3207o9C3QVVp.png` | `hw-os-app.png` | 856×446 | — |
| Figure 4 | `image/T4Fy.../ICtmZ85CWgSJ7UZjomd1.png` | `process-thread.png` | 856×546 | — |
| Figure 5 | `image/T4Fy.../x5h2ZL6SWI1vF5jSa8YB.svg` | `memory.png` | 865×505 | `memory.svg` |
| Figure 6 | `image/T4Fy.../OdFbLc2ufRmkJoHinTUL.svg` | `workerprocess.png` | 865×515 | `workerprocess.svg` |
| Figure 7 | `image/T4Fy.../BG4tvT7y95iPAelkeadP.png` | `browser-arch.png` | 865×259 | — |
| Figure 8 | `image/T4Fy.../JvSL0B5q1DmZAKgRHj42.png` | `browser-arch2.png` | 865×499 | — |
| Figure 9 | `image/T4Fy.../vl5sRzL8pFwlLSN7WW12.png` | `browserui.png` | 865×441 | — |
| Figure 10 | `image/T4Fy.../ZVkrl0QErFtITKPwa6Cq.png` | `tabs.png` | 865×494 | `tabs.svg` |
| Figure 11 | `image/T4Fy.../8zHB7KNXrIKv5yAWvtBy.svg` | `servicfication.png` | 950×310 | `servicfication.svg`（※原文のスペルミス `servicfication` のまま） |
| Figure 12 | `image/T4Fy.../7ilepBEw6b2yUuyABbpZ.png` | `isolation.png` | 865×443 | — |

シリーズ共通のカバー画像は `https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/images/inside-browser/cover.png`。

**本セッションでのローカル保存先**（セッション限りのスクラッチパッド。永続化が必要なら上記恒久 URL から再取得すること）:
`/tmp/claude-0/-home-user-Bug-bounty-/32de2d37-9918-5d2d-9855-7e3b08d1c1c2/scratchpad/imgs/`

## 原典2018年版（Web Fundamentals）との差分

現行 `developer.chrome.com/blog/inside-browser-part1` と、初出版 `developers.google.com/web/updates/2018/09/inside-browser-part1` の**記事ソースを機械的に文単位で突き合わせた結果**:

- **本文（地の文・見出し・図キャプション・表の中身）は完全に一致**。移植で内容は一切変わっていない。**したがって初回ノートの本文記述はそのまま有効**。
- 差分は以下の4点のみ:
  1. **front matter の形式**（Web Fundamentals は `{# wf_published_on #}` 等のコメント記法、developer.chrome.com は YAML）。
  2. **リンク表記**: 2018年版は `/web/updates/2018/07/site-isolation`、`/web/updates/2018/02/meltdown-spectre`（サイト内相対パス）、MDN は `/en-US/` 付き。→ **現行版の `https://developers.google.com//web/updates/2018/07/site-isolation` というダブルスラッシュは、移植時に混入したバグ**であることが確定した。
  3. **アニメーション注記**: 2018年版には Figure 5 / 6 / 10 / 11 に `click on the image to see animation`（再生アイコン付き）という一文があり、**静止 PNG をクリックすると CSS アニメーション SVG に飛ぶ**作りだった。**現行版ではこの注記が削除され、SVG が直接埋め込まれている**。
  4. **末尾**: 2018年版には `## Feedback` 節と RSS ウィジェットのインクルードがあった（現行版では削除）。
- **教科書的な含意**: 図5・6・10・11 は**本来アニメーションで理解させる意図の図**。静止画だけでは「メモリが割り当てられる」「IPC でメッセージが飛ぶ」「タブが落ちる」「サービスが外に出ていく」という**動きの部分が落ちる**。上記 SVG URL を読者に案内する価値が高い。

## コード/コマンド（原文のまま逐語）

この記事には実行コードは無い。原文に含まれる**マークアップ／操作手順／リンク**を逐語で記録する。

**(1) 記事末尾のナビゲーションボタン（原文 HTML そのまま）**

```html
<a class="button button-primary gc-analytics-event attempt-right"
   href="/blog/inside-browser-part2"
   data-category="InsideBrowser" data-label="Part1 / Next">Next: What happens in navigation</a>
```

**(2) 「Which process controls what?」の表（原文 HTML そのまま）**

```html
<table class="responsive">
  <tr>
    <th colspan="2">Process and What it controls</th>
  </tr>
  <tr>
    <td>Browser</td>
    <td>
      Controls "chrome" part of the application including address bar, bookmarks, back and 
      forward buttons. <br>Also handles the invisible, privileged parts of a web browser such as 
      network requests and file access.
    </td>
  </tr>
  <tr>
    <td>Renderer</td>
    <td>Controls anything inside of the tab where a website is displayed.</td>
  </tr>
  <tr>
    <td>Plugin</td>
    <td>Controls any plugins used by the website, for example, flash.</td>
  </tr>
  <tr>
    <td>GPU</td>
    <td>
      Handles GPU tasks in isolation from other processes. It is separated into different process 
      because GPUs handles requests from multiple apps and draw them in the same surface.
    </td>
  </tr>
</table>
```

**(3) Chrome のプロセス一覧を見る操作手順（原文の指示を逐語ベースで）**

```text
click the options menu icon (more_vert) at the top right corner
  -> select More Tools
  -> select Task Manager
This opens up a window with a list of processes that are currently running
and how much CPU/Memory they are using.
```

〔補足（一般知識）〕同等の情報は Chrome のショートカット `Shift+Esc`（デスクトップ）でも開ける。また `chrome://process-internals/` でプロセスとサイトインスタンスの割り当てを、`chrome://process-internals/#web-contents` でフレームツリーとプロセス ID の対応を確認できる。原文には記載されていない。

**(4) 本文中のリンク（原文の href を逐語）**

```text
#browser-architecture                                                  （記事内アンカー）
https://developers.google.com//web/updates/2018/07/site-isolation      （Site Isolation。原文はスラッシュ2重のまま）
https://developer.mozilla.org/docs/Web/Security/Same-origin_policy     （Same Origin Policy）
https://developers.google.com/web/updates/2018/02/meltdown-spectre     （Meltdown and Spectre）
https://twitter.com/kosamari                                           （著者 Twitter）
/blog/inside-browser-part2                                             （次回）
```

**(5) 図の画像ショートコード（原文のまま。画像パスは教科書で図を差し替える際の手がかり）**

```text
Figure 1  image/T4FyVKpzu4WKF1kBNvXepbi08t52/Wx90M7DlxzVdXEeg5UhL.png  800x459  alt="CPU"
Figure 2  image/T4FyVKpzu4WKF1kBNvXepbi08t52/W6kFjvrwk1yDEhs8lFm1.png  800x459  alt="GPU"
Figure 3  image/T4FyVKpzu4WKF1kBNvXepbi08t52/9M8aKlSl3207o9C3QVVp.png  800x417  alt="Hardware, OS, Application"
Figure 4  image/T4FyVKpzu4WKF1kBNvXepbi08t52/ICtmZ85CWgSJ7UZjomd1.png  800x510  alt="process and threads"
Figure 5  image/T4FyVKpzu4WKF1kBNvXepbi08t52/x5h2ZL6SWI1vF5jSa8YB.svg  273x150  alt="process and memory"
Figure 6  image/T4FyVKpzu4WKF1kBNvXepbi08t52/OdFbLc2ufRmkJoHinTUL.svg  273x150  alt="worker process and IPC"
Figure 7  image/T4FyVKpzu4WKF1kBNvXepbi08t52/BG4tvT7y95iPAelkeadP.png  800x240  alt="browser architecture"
Figure 8  image/T4FyVKpzu4WKF1kBNvXepbi08t52/JvSL0B5q1DmZAKgRHj42.png  800x462  alt="browser architecture"
Figure 9  image/T4FyVKpzu4WKF1kBNvXepbi08t52/vl5sRzL8pFwlLSN7WW12.png  800x408  alt="Chrome processes"
Figure 10 image/T4FyVKpzu4WKF1kBNvXepbi08t52/ZVkrl0QErFtITKPwa6Cq.png  800x457  alt="multiple renderer for tabs"
Figure 11 image/T4FyVKpzu4WKF1kBNvXepbi08t52/8zHB7KNXrIKv5yAWvtBy.svg  273x150  alt="Chrome servification"
Figure 12 image/T4FyVKpzu4WKF1kBNvXepbi08t52/7ilepBEw6b2yUuyABbpZ.png  800x410  alt="site isolation"
```

## 原文の重要センテンス逐語集（教科書引用用）

教科書で引用・訳出する価値の高い原文をそのまま保存する。

1. *"The important thing to note here is that these different architectures are implementation details. There is no standard specification on how one might build a web browser. One browser's approach may be completely different from another."*
2. *"Until very recently, Chrome gave each tab a process when it could; now it tries to give each site its own process, including iframes (see Site Isolation)."*
3. *"Also handles the invisible, privileged parts of a web browser such as network requests and file access."*（Browser プロセスの説明）
4. *"Another benefit of separating the browser's work into multiple processes is security and sandboxing. Since operating systems provide a way to restrict processes' privileges, the browser can sandbox certain processes from certain features. For example, the Chrome browser restricts arbitrary file access for processes that handle arbitrary user input like the renderer process."*
5. *"Because processes have their own private memory space, they often contain copies of common infrastructure (like V8 which is a Chrome's JavaScript engine). This means more memory usage as they can't be shared the way they would be if they were threads inside the same process."*
6. *"In order to save memory, Chrome puts a limit on how many processes it can spin up. The limit varies depending on how much memory and CPU power your device has, but when Chrome hits the limit, it starts to run multiple tabs from the same site in one process."*
7. *"The Same Origin Policy is the core security model of the web; it makes sure one site cannot access data from other sites without consent. Bypassing this policy is a primary goal of security attacks. Process isolation is the most effective way to separate sites."*
8. *"With Meltdown and Spectre, it became even more apparent that we need to separate sites using processes. With Site Isolation enabled on desktop by default since Chrome 67, each cross-site iframe in a tab gets a separate renderer process."*
9. *"Site Isolation isn't as simple as assigning different renderer processes; it fundamentally changes the way iframes talk to each other."*
10. *"Even running a simple Ctrl+F to find a word in a page means searching across different renderer processes."*

## セキュリティ／脆弱性ハンティング観点の橋渡しメモ（ch01 執筆用）

原文の記述から**直接導ける**論点のみを整理する（推測は〔補足〕で明示）。

1. **信頼境界は「プロセス境界」に一致する。** renderer は「任意のユーザ入力を扱うプロセス」として任意ファイルアクセスを剥奪されている（原文）。よって「Web ページ由来のバグ」は原則 renderer 内に閉じ込められる設計。
2. **特権は browser process 側にある。** ネットワークリクエストとファイルアクセスは browser process の職責（原文の表）。renderer からこれらに触るには IPC を渡る必要があり、そこが**サンドボックス脱出の攻撃面**になる。
3. **UI（アドレスバー・ブックマーク・戻る進む）は browser process の管轄。** Web コンテンツが描けるのはタブ内部だけ。ここからアドレスバー偽装・オムニボックス偽装・ダイアログ偽装といった「UI スプーフィング」がなぜ別カテゴリのバグなのかが説明できる。
4. **Same Origin Policy こそが Web のコアセキュリティモデルであり、その bypass が攻撃の主目的**（原文の明言）。クライアントサイド脆弱性の分類（XSS, CSRF, クリックジャッキング, CORS 誤設定, postMessage の検証漏れ, XS-Leaks など）は「SOP をどう回避するか」という一本の軸に整列できる。
5. **同一プロセス同居はメモリ空間共有を意味する。** 原文は「1タブ1プロセスモデルではクロスサイト iframe が単一 renderer process で動き、異なるサイト間でメモリ空間を共有していた」と明言。つまり **メモリ開示系バグ（UAF, OOB read）や投機実行サイドチャネルは、同居しているサイトのデータを読める**。Site Isolation はこれを構造的に断つ。
6. **プロセス数上限により「同一サイトのタブが同居する」ことがある**（原文）。診断時に「別タブなのにプロセスが同じ」現象は、この上限の結果として起こりうる。
7. **Servicification は「同じ機能が別プロセスにも同一プロセスにも配置され得る」ことを意味する**（原文）。つまり**低スペック端末やモバイルでは分離が弱い構成になり得る**。プラットフォーム差が防御の強さに直結する。
8. **Site Isolation の副作用として、ページ内検索や DevTools が複数プロセスにまたがる**（原文）。〔補足（一般知識）〕この「プロセスをまたぐ協調処理」自体が新しい攻撃面（クロスプロセス IPC の検証漏れ）を生む。
9. 〔補足（一般知識）〕原文が触れていない現代の関連機構: **CORB / ORB**（クロスオリジンのリソースを renderer に渡さない）、**Cross-Origin-Opener-Policy (COOP)**、**Cross-Origin-Embedder-Policy (COEP)**、**crossOriginIsolated** と `SharedArrayBuffer` の再有効化、**Origin-Agent-Cluster** ヘッダによるオリジン単位のプロセス分離ヒント。これらはすべて「プロセス分離 + SOP」という原文の骨格の延長。

## 公式一次資料による補強（Chromium ソースツリーの設計ドキュメント）

原文は 2018 年の入門記事なので、**2026 年現在の正確な挙動は Chromium 本体の設計ドキュメントで裏を取る**。以下はすべて `raw.githubusercontent.com` 経由で**本文を実際に取得して読んだ**もの（本セッションでは `chromium.googlesource.com` / `www.chromium.org` はエグレスポリシーで到達不能だったため GitHub ミラーを使用）。

### (a) 侵害されたレンダラの脅威モデル

- 出典: `https://raw.githubusercontent.com/chromium/chromium/main/docs/security/compromised-renderers.md`
  （正式な閲覧先: `https://chromium.googlesource.com/chromium/src/+/main/docs/security/compromised-renderers.md`）
- 逐語（冒頭）: *"Given the complexity of the browser, our threat model must use a 'defense in depth' approach to limit the damage that occurs if an attacker finds a way around the Same Origin Policy or other security logic in the renderer process. For example, the combination of Chrome's sandbox, IPC security checks, and Site Isolation limit what an untrustworthy renderer process can do."*
- 逐語（定義）: *"In a compromised renderer, an attacker is able to execute arbitrary native (i.e. non-JavaScript) code within the renderer process's sandbox. A compromised renderer can forge malicious IPC messages, impersonate a Chrome Extension content script, or use other techniques to trick more privileged parts of the browser."*
- 逐語（報奨金との接続）: *"Newly discovered holes in this protection would be considered security bugs and possibly eligible for the Chrome Vulnerability Rewards Program."*
- **バグバウンティ上の意味**: Chrome は「**レンダラは既に乗っ取られている**」と仮定して設計されている。つまり **「レンダラを侵害できた」だけでは脅威モデル上は想定内**であり、**そこから何が守られているか（＝この文書の各節）を破ることが脆弱性**になる。
- 同文書が列挙する「侵害レンダラから守るべきもの」の節（＝**攻撃面のチェックリストとしてそのまま使える**）: Site Isolation foundations / Cross-Origin HTTP resources / Contents of cross-site frames / Cookies / Passwords / **Security-sensitive UI/chrome elements (e.g. Omnibox)** / Permissions / Web storage / Messaging / JavaScript code cache / Cross-Origin-Resource-Policy / frame-ancestors CSP と X-Frame-Options / HTTP request headers / SameSite cookies (WIP) / User gestures (WIP) / Web Accessible Resources of Chrome Extensions / Non-Web resources / **Android-specific protection gaps** / Renderer processes hosting DevTools frontend。
- **原文 Figure 9（UI とプロセスの対応図）に直結する逐語**: *"Compromised renderers shouldn't be able to influence/spoof security-sensitive UI elements."* 具体例として **Omnibox の URL 表示**、**Secure / not secure チップ（HTTP サイトに固定されたレンダラが鍵アイコンを出させてはならない）**、**コンテンツ設定アイコン（マイク権限を得たレンダラがマイクアイコンを消せてはならない）**、**権限ダイアログ中のオリジン表示**を挙げる。防御実装は `RenderFrameHostImpl::CanCommitOriginAndUrl`（レンダラが主張するコミット内容を検証し、不正ならプロセスを kill する）。
- **既知のギャップ（原文には無い重要情報）**: *"No form of Site Isolation is active in Android WebView."* / *"Frames with `<iframe sandbox>` attribute are not isolated from their non-opaque precursor origin."* / *"`file:` frames may share a process with other `file:` frames."*

### (b) プロセスモデルと Site Isolation の現行仕様

- 出典: `https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md`
- **site の定義（逐語）**: *"Sites are defined as scheme plus eTLD+1, since different origins within a given site may have synchronous access to each other if they each modify their document.domain."* → 初回ノートの〔補足〕どおり、**分離単位はオリジンより粗い「サイト」**であることが一次資料で確認できた。
- **モードが4つある**（原文の「Chrome 67 以降デスクトップ既定有効」より現実はずっと複雑）:
  - **Full Site Isolation (site-per-process)** — デスクトップ。*"This mode provides all sites protection against compromised renderers and Spectre-like attacks."*
  - **Partial Site Isolation** — **Android（RAM 2GB 以上）**。*"Chromium only uses dedicated (locked) processes for some sites, putting the rest in unlocked processes that can be used for any web site."* 隔離対象は**ユーザがパスワードを入力したサイト、OAuth でログインしたサイト、COOP ヘッダを返したサイト**などのヒューリスティクスで決まる。
  - **No Site Isolation** — **RAM 2GB 未満の Android / Android WebView / iOS 版 Chrome（WebKit のため OOPIF 非対応）**。
  - **Origin Isolation** — `--isolate-origins=`、`chrome://flags#isolate-origins`、エンタープライズポリシー `IsolateOrigins`、および **`Origin-Agent-Cluster` レスポンスヘッダ**によるオプトイン。ただし逐語で *"This is not a security guarantee and may not always be honored"* と明記されている点に注意。
- **プロセス数上限の現行仕様（原文の「上限に達すると同一サイトのタブを同居」の精密版）**: *"Soft Process Limit: On desktop platforms, Chromium sets a 'soft' process limit based on the memory available on a given client. While this can be exceeded ... Chromium makes an attempt to start randomly reusing same-site processes when over this limit."* 例として *"if the limit is 100 processes and the user has 50 open tabs to `example.com` and 50 open tabs to `example.org`, then a new `example.com` tab will share a process with a random existing `example.com` tab, while a `chromium.org` tab will create a 101st process."* → **上限超過後も「別サイトなら新プロセス」は守られる**（＝上限はセキュリティ境界を壊さない）。
- **ProcessLock（原文に無い最重要概念）**: *"Chromium assigns a ProcessLock to some or all RenderProcessHosts, to restrict which sites are allowed to load in the process and which data the process has access to."* 粒度は**サイト単位 / オリジン単位 / スキーム単位（`file://`）/ allow-any-site**。*"`chrome://` URLs are never allowed to share a process with other sites"*。ロックは**ナビゲーション開始時か `OnResponseStarted` 時＝コミット直前に必ず割り当てられ**、一度サイト固定されると **RenderProcessHost の生存期間中は不変**。
- **ブラウザ側の検証関数**: `CanAccessDataForOrigin`（受信した IPC がそのオリジンを主張してよいかを**プロセスロックと突き合わせて検証**）、`URLLoaderFactory` の `request_initiator_origin_lock`（レンダラに渡す能力を**オリジンに束縛**）、`RenderFrameHost::GetLastCommittedOrigin()`（**ブラウザ側で計算した信頼できるオリジン**で判断する）。→ **「IPC 境界で何を検証しているか」が分かると、検証漏れ＝バグという探索方針が立つ**。

### (c) Servicification の一次資料

- 出典: `https://raw.githubusercontent.com/chromium/chromium/main/docs/servicification.md`
- 逐語: *"Servicification embodies the ongoing process of servicifying Chromium features and subsystems, or refactoring these collections of library code into services with well-defined public API boundaries and very strong runtime isolation via Mojo interfaces."*
- 逐語（原文の「分割も統合もできる」の裏付け）: *"with the Network Service in place we can now run the entire network stack either inside or outside of the browser process with the flip of a command-line switch. Client code using the Network Service stays the same, independent of that switch."*
- → **原文 Figure 11 の「左（統合）⇄右（分割）」は比喩ではなく、実際にコマンドラインスイッチ1つで切り替わる**。初回ノートの「Network Service として切り出された」という記述は一次資料で裏付けられた。
- 関連: `https://raw.githubusercontent.com/chromium/chromium/main/docs/mojo_and_services.md`（**Mojo** の入門。原文には名前が出てこないが、Chrome の IPC の実体であり、レンダラ⇄ブラウザの特権境界そのもの）。

### (d) サンドボックスとサイドチャネル

- `https://raw.githubusercontent.com/chromium/chromium/main/docs/design/sandbox.md` — 原文の「OS のプロセス特権制限」の実装詳細（Windows のトークン/ジョブ/デスクトップ、Linux の namespace/seccomp-bpf など）。
- `https://raw.githubusercontent.com/chromium/chromium/main/docs/security/side-channel-threat-model.md` — 原文が挙げる **Meltdown / Spectre** に対する現行の脅威モデル。
- `https://raw.githubusercontent.com/chromium/chromium/main/docs/security/rule-of-2.md` — 「信頼できない入力 × メモリ安全でない言語 × 高特権」の3つを同時に満たすなとする **Rule of 2**。**なぜパーサ類をサンドボックス化された低特権プロセスに置くのか**という、原文の設計思想の明文化。

## 読者が自分で開くべき資料

**このノートの取得状況（補完工程完了時点）**

- **本文・見出し・図キャプション・表・リンク**: **取得済み（full）**。公式リポジトリの記事ソース Markdown から逐語で確保。
- **図の画像12点**: **取得済み（full）**。初出版（Web Fundamentals）の画像ファイル本体を回収し、**12点すべてを実際に閲覧**して記述した（「図の実物を確認しての記述」節）。
- **残る制約**: **`developer.chrome.com` そのものは本セッションのエグレスポリシーで到達不能**（WebFetch は `EGRESS_BLOCKED`、curl は `CONNECT tunnel failed, response 403`）。`web.archive.org`、`developers.google.com`、`web.dev`、`developer.mozilla.org`、`wd.imgix.net`、`r.jina.ai` も同様に 403 / 到達不能。**到達できたのは `raw.githubusercontent.com` と GitHub の匿名 git read のみ**。したがって**レンダリング後のページ体験（アニメーション再生、目次、コメント欄、シリーズナビ）だけは読者自身が開く必要がある**。

### 1. 原典ページ（必読）

- URL: `https://developer.chrome.com/blog/inside-browser-part1`
- **なぜ自動取得できなかったか**: 組織のエグレスポリシーによる 403（プロキシ側でのドメイン拒否）。記事の内容そのものは公式リポジトリのソースから完全に回収済みなので、**内容の欠落はない**。
- **読みどころ（何を学ぶために読むか）**:
  1. **Figure 8（Chrome のマルチプロセス構成図）を自分の目で見る** — 各プロセスの箱の中に描かれた「点線の魚（スレッド）が持っているアイコン」まで見ると、**どのプロセスがどんな仕事を抱えているか**が一目で入る。本ノートの記述と突き合わせて理解を固定する。
  2. **Figure 9（プロセスとブラウザ UI の対応図）** — **黄色い枠が引かれている位置**を確認する。**その黄色い線がそのまま「Web コンテンツが触れてよい範囲」の境界**であり、UI スプーフィング系バグの定義そのもの。
  3. **Figure 12（Site Isolation）** — a.com / iframe b.com / iframe c.com が**3つの別プロセスに割り当てられる**絵。クロスサイト iframe を含むページを診断するときの前提。
  4. **本文の表「Which process controls what?」** — Browser プロセスの説明にある *"the invisible, privileged parts"*（ネットワークとファイルアクセス）という言い回し。**特権がどこにあるかの宣言**として読む。
  5. **Site Isolation 節の3文**（SOP はコアセキュリティモデル／その bypass が攻撃の主目的／プロセス分離が最も有効な分離手段）— **ch01 の論旨の骨格そのもの**なので、訳ではなく原文で読む。
- **代替手段**（本セッションでは到達不能だが、読者の環境では使える可能性がある）:
  - アーカイブ: `https://web.archive.org/web/2019/https://developers.google.com/web/updates/2018/09/inside-browser-part1`
  - **公式ミラー（確実・本ノートで実際に使用）**: 記事ソース Markdown
    `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part1/index.md`
  - **初出版のソース（図の実体もここにある）**:
    `https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/2018/09/inside-browser-part1.md`

### 2. アニメーション版の図（静止画では落ちる情報がある。必見）

原文の Figure 5 / 6 / 10 / 11 は、2018年版では**クリックで CSS アニメーションが再生される SVG**にリンクしていた。ブラウザで直接開ける。

| 図 | 何が動いて何が分かるか | URL |
| --- | --- | --- |
| Figure 5 | **プロセスがメモリの slab を確保し、アプリのデータ（黄色い三角）がそこに書き込まれ、画面に現れる**までの流れ | `https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/images/inside-browser/part1/memory.svg` |
| Figure 6 | **2プロセスがそれぞれ別の区画（緑／青）を確保し、IPC のメッセージが両者の間を飛ぶ**様子 | 同ベース + `workerprocess.svg` |
| Figure 10 | **1タブのレンダラが落ちて "Aw, Snap!" になっても他タブが生きている**様子 | 同ベース + `tabs.svg` |
| Figure 11 | **browser process の内側にいたサービスが1つずつ外へ出て独立プロセスになる**様子（servicification の本質） | 同ベース + `servicfication.svg`（※スペルは原文のまま `servicfication`） |

- **読みどころ**: 特に **Figure 6 のアニメーション**。「メモリは分かれている／会話は IPC を通る」という**2つの事実が同時に animate される**ので、後続章の「サンドボックス脱出は IPC を通るしかない」という話が腹落ちする。

### 3. 原文が張っている3本のリンク（ch01 の補強に必須）

| 資料 | URL（原文の href → 現行） | 読みどころ |
| --- | --- | --- |
| Site Isolation 解説 | 原文 `https://developers.google.com//web/updates/2018/07/site-isolation`（ダブルスラッシュは移植時のバグ）→ 現行 `https://developer.chrome.com/blog/site-isolation` | **site の定義（scheme + eTLD+1）**と **CORB** の説明。原文 part1 が省略した「なぜオリジンでなくサイトなのか」がここにある |
| Same Origin Policy | `https://developer.mozilla.org/ja/docs/Web/Security/Same-origin_policy`（日本語版あり） | **オリジンの定義（scheme + host + port）**と、`document.domain`・CORS・`postMessage` など**例外の一覧**。Site Isolation の粒度差を理解する前提 |
| Meltdown and Spectre | 原文 `https://developers.google.com/web/updates/2018/02/meltdown-spectre` → 現行 `https://developer.chrome.com/blog/meltdown-spectre` | **なぜ「同一プロセス内なら読めてしまう」のか**。`SharedArrayBuffer` 停止と `performance.now()` 粗粒度化という**Web API 側の対応**も書かれており、COOP/COEP・`crossOriginIsolated` へ繋がる |

### 4. 現行仕様で裏を取るための一次資料（2018年の記述との差分を埋める）

| 資料 | URL | 読みどころ（何を学ぶために読むか） |
| --- | --- | --- |
| 侵害レンダラの脅威モデル | `https://chromium.googlesource.com/chromium/src/+/main/docs/security/compromised-renderers.md`（ミラー: `https://raw.githubusercontent.com/chromium/chromium/main/docs/security/compromised-renderers.md`） | **「レンダラ侵害は前提、そこから何を守るか」の公式チェックリスト**。各節の見出しがそのまま**バグハンティングの探索対象**になる。VRP 対象であることも明記されている |
| プロセスモデルと Site Isolation | `https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md` | **Full / Partial / No / Origin の4モード**と、**ProcessLock**、**soft process limit** の実際。**Android と iOS では分離が弱い / 無い**という、原文（2018）では読めない事実 |
| Rule of 2 | `https://chromium.googlesource.com/chromium/src/+/main/docs/security/rule-of-2.md` | 「信頼できない入力 × メモリ安全でない言語 × 高特権」の**3つ同時は禁止**。**なぜパーサが低特権プロセスに追い出されるのか**という設計原理 |
| サンドボックス設計 | `https://chromium.googlesource.com/chromium/src/+/main/docs/design/sandbox.md` | 原文が1行で済ませた「OS がプロセス特権を制限する」の**実装（Windows のトークン/ジョブ、Linux の seccomp-bpf/namespace）** |
| Mojo & Services | `https://chromium.googlesource.com/chromium/src/+/main/docs/mojo_and_services.md` | **Chrome の IPC の実体**。原文には名前すら出ないが、**特権境界を越える唯一の通路**なので、サンドボックス脱出を扱う章の前提 |
| サイドチャネル脅威モデル | `https://chromium.googlesource.com/chromium/src/+/main/docs/security/side-channel-threat-model.md` | Meltdown/Spectre 以後、**ブラウザが何を守れて何を守れないと宣言しているか** |

### 5. 手を動かして確かめる（原文の主張を自分で検証する）

1. **Task Manager**（右上メニュー → その他のツール → タスク マネージャ、または **Shift+Esc**）を開く。タブを増やす・同一サイトのタブを増やす・**クロスサイト iframe を含むページ**を開く、の3パターンで**プロセス数の増え方が違う**ことを観察する。→ 原文の「1タブ1プロセス」「同一サイトは同居」「iframe ごとに分離」が同時に確認できる。
2. **`chrome://process-internals/#web-contents`** を開く。**フレームツリーと各フレームのプロセス ID／SiteInstance** が一覧できる。→ Figure 12 の絵が実データとして見える。
3. **`chrome://flags/#site-isolation-trial-opt-out`** や `--isolate-origins=` を触る前に、まず **`chrome://process-internals/`** で**現在の分離モード**を確認する。→ Partial Site Isolation の端末では挙動が変わることを体感できる。

### 6. 次に読むべきもの

- 原文末尾のボタン **"Next: What happens in navigation"**（`https://developer.chrome.com/blog/inside-browser-part2`）から **part 2 へ進む**。**part 1 は土台（用語とプロセス構成）だけ**で、実際の攻撃面（ナビゲーション処理、レンダラ内部のパイプライン、コンポジタと入力処理）は **part 2〜4** にある。本ノートの「シリーズ構成（裏取り済み）」表に4部すべての URL と最初の節見出しを載せてある。

### 【他担当ノートへの申し送り】developer.chrome.com がブロックされている環境での取得レシピ

本工程で確立し、**part 2 / 3 / 4 についても実際に到達を確認した**手順。`developer.chrome.com`・`developers.google.com`・`web.dev`・`web.archive.org`・`wd.imgix.net`・`r.jina.ai` がすべて 403 でも、**`raw.githubusercontent.com` だけは到達できる**。

1. **本文（現行版）**: `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part{N}/index.md`
   → 本文・見出し・図キャプション・表・リンクが**執筆ソースそのまま**で取れる（レンダリング後ページより忠実）。**ただし図は imgix のハッシュ名パスで参照されており、実体は取れない。**
2. **本文（2018年初出版）＋図の実体**: `google/WebFundamentals` リポジトリ。ただし**現在の `main` / `master` からは `src/content/` が削除済み**なので、**古いブランチかコミット SHA を指定する必要がある**。本ノートでは `fde6de49a430f816197c3e048b73fad1c7e2e917`（`gitlocalize-12069` ブランチの HEAD）を使用。ブランチ一覧は `git ls-remote --heads https://github.com/google/WebFundamentals` で取得できる（匿名 git read は通る。`github.com` への HTTPS は 403 でも ls-remote は成功する）。
   - 記事: `.../{SHA}/src/content/en/updates/2018/09/inside-browser-part{N}.md`
   - **パス変換規則**: 記事中の `<img src="/web/updates/images/...">` の **先頭 `/web` を `src/content/en` に置き換える**。
     例: `/web/updates/images/inside-browser/part3/renderer.png` → `src/content/en/updates/images/inside-browser/part3/renderer.png`
3. **到達確認済みの図の点数**（`img src` のユニーク数）: **part1 = 12点（＋アニメ SVG 4点）／part2 = 13点／part3 = 18点／part4 = 9点**。いずれも上記規則で **HTTP 200 を確認済み**。
4. **Chromium の公式設計ドキュメント**も `https://raw.githubusercontent.com/chromium/chromium/main/docs/...` で取得できる（`chromium.googlesource.com` は 403）。

## 用語集候補（付録用）

| 用語 | 原文表記 | 定義（原文準拠） |
| --- | --- | --- |
| CPU | Central Processing Unit | コンピュータの「脳」。多種多様なタスクを1つずつ順に処理する汎用プロセッサ。コアは同一チップ内に住む別の CPU のようなもの。 |
| GPU | Graphics Processing Unit | 単純なタスクを複数コアで同時に処理するのが得意なプロセッサ。元はグラフィックス用。"GPU-backed" は高速描画・滑らかな操作と結び付く。 |
| プロセス | Process | アプリケーションの実行中プログラム。OS からメモリの「slab」を与えられ、全アプリ状態をその私有メモリ空間に保持する。 |
| スレッド | Thread | プロセスの内側に住み、そのプロセスのプログラムの一部を実行するもの。作成は任意。 |
| IPC | Inter Process Communication | 2つのプロセスが会話するための手段。ワーカープロセスが応答不能になっても他を止めずに再起動できる設計を可能にする。 |
| Browser プロセス | Browser process | アドレスバー・ブックマーク・戻る進むなど「chrome」部分と、ネットワークリクエストやファイルアクセスといった不可視かつ特権的な部分を担当。 |
| Renderer プロセス | Renderer process | Web サイトが表示されるタブの内側すべてを担当。任意のユーザ入力を扱うため任意ファイルアクセスを制限される。 |
| Plugin プロセス | Plugin process | サイトが使うプラグイン（例: flash）を担当。 |
| GPU プロセス | GPU process | GPU タスクを他プロセスから隔離して扱う。GPU は複数アプリのリクエストを同一サーフェスに描くため分離される。 |
| Extension / Utility プロセス | Extension process / utility processes | 原文が「さらに存在する」と挙げるプロセス群。 |
| サンドボックス | sandboxing | OS のプロセス特権制限機構を使い、特定プロセスから特定機能を遮断すること。 |
| Servicification | Servicification | ブラウザの各部分をサービスとして実装し、環境に応じてプロセス分割（安定性重視）と集約（メモリ節約）を切り替えられるようにするアーキテクチャ変更。 |
| Site Isolation | Site Isolation | クロスサイト iframe ごとに別 renderer process を走らせる機能。Chrome 67 以降デスクトップ既定有効。 |
| Same Origin Policy | Same Origin Policy | Web のコアセキュリティモデル。あるサイトが同意なく他サイトのデータへアクセスできないことを保証する。その bypass が攻撃の主目的。 |
| Meltdown / Spectre | Meltdown and Spectre | プロセスによるサイト分離の必要性を一層明白にした投機実行脆弱性。 |
| V8 | V8 | Chrome の JavaScript エンジン。各プロセスが私有メモリにコピーを抱えるため、プロセス増はメモリ増に直結する例として挙げられる。 |

**（補完工程で追加。出典は Chromium 公式設計ドキュメント。原文 part1 には登場しない語だが、ch01 の記述に必要）**

| 用語 | 原文表記 | 定義（出典付き） |
| --- | --- | --- |
| Mojo | Mojo | Chrome の IPC（メッセージパッシング）基盤。サービス間・プロセス間のインタフェースを定義する。出典: `docs/mojo_and_services.md` |
| Network Service | Network Service | ネットワークスタックを切り出したサービス。**コマンドラインスイッチ1つで browser process の内外どちらでも動かせる**。出典: `docs/servicification.md` |
| Utility Process | Utility process | 汎用の低特権プロセス。原文 Figure 8 に明示されている。 |
| 侵害されたレンダラ | compromised renderer | レンダラのサンドボックス内で**任意のネイティブコード**が実行されている状態。悪意ある IPC の偽造や拡張機能コンテンツスクリプトのなりすましが可能。**Chrome の脅威モデルはこれを前提に置く**。出典: `docs/security/compromised-renderers.md` |
| ProcessLock | ProcessLock | RenderProcessHost に割り当てられ、**そのプロセスにロードしてよいサイトとアクセスしてよいデータを制限**する仕組み。粒度はサイト／オリジン／スキーム／allow-any-site。出典: `docs/process_model_and_site_isolation.md` |
| CanAccessDataForOrigin | `CanAccessDataForOrigin` | ブラウザプロセス側で、**受信 IPC がそのオリジンの権限を主張してよいか**をプロセスロックと突き合わせて検証する関数。出典: `docs/security/compromised-renderers.md` |
| Full / Partial / No Site Isolation | Full Site Isolation (site-per-process) / Partial Site Isolation / No Site Isolation | デスクトップは全サイト分離、Android(2GB+) は**パスワード入力・OAuth ログイン・COOP 返却などのサイトのみ**分離、**2GB 未満 Android・Android WebView・iOS は分離なし**。出典: `docs/process_model_and_site_isolation.md` |
| Origin-Agent-Cluster | `Origin-Agent-Cluster` | オリジン単位のプロセス分離を要求するレスポンスヘッダ。ただし公式に *"This is not a security guarantee and may not always be honored"* と明記。出典: `docs/process_model_and_site_isolation.md` |
| soft process limit | soft process limit | デスクトップのプロセス数の**ソフト上限**。超過すると**同一サイトのプロセスをランダムに再利用**するが、**別サイトには新プロセスを作る**（上限はセキュリティ境界を壊さない）。出典: `docs/process_model_and_site_isolation.md` |
| Rule of 2 | Rule of 2 | 「信頼できない入力」「メモリ安全でない言語」「高特権」の3条件を**同時に満たしてはならない**という Chromium のセキュリティ設計原則。出典: `docs/security/rule-of-2.md` |
