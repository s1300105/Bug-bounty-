# ブラウザ内部の全体像 ― CPU・GPU・メモリとマルチプロセス構成

> **この節で分かること**
> - CPU と GPU、プロセスとスレッド、IPC という「計算機の基礎語彙」を、ブラウザの文脈で説明できる。
> - Chrome がなぜ1つのプログラムではなく複数のプロセスに分かれているのか（マルチプロセス構成の設計意図）を説明できる。
> - どのプロセスが「特権（ネットワーク・ファイルアクセス）」を持ち、どのプロセスが「信頼できない Web コンテンツ」を扱うのかを図で示せる。
> - なぜ「レンダラプロセス内でのコード実行」だけでは足りず、「サンドボックス脱出」が別に必要になるのかを説明できる。
> - Same Origin Policy（同一オリジンポリシー）が Web のコアセキュリティモデルであり、その回避が攻撃の主目的であることを理解し、Site Isolation（サイト分離）がそれをどう守るのかを説明できる。
> - Chrome の Task Manager や `chrome://process-internals/` を使って、プロセスとサイトの割り当てを自分の目で確認できる。

**元資料**: https://developer.chrome.com/blog/inside-browser-part1 （原典取得済み。ただし発行元 `developer.chrome.com` は執筆環境から到達できなかったため、公式リポジトリ `GoogleChrome/developer.chrome.com` の記事ソース Markdown と、初出版 `google/WebFundamentals` の本文・図画像から全文を回収した）
**関連する節**: 本記事は4部構成シリーズの第1部である。第2部「ナビゲーションで何が起きるか」、第3部「レンダラプロセスの内部」、第4部「入力とコンポジタ」は別の節で扱う。

---

## 0. この節の位置づけ ― なぜ最初にブラウザの中身を学ぶのか

クライアントサイドの脆弱性（vulnerability）とは、Web サイトの「サーバ側」ではなく「利用者のブラウザの中」で成立するバグのことである。XSS（Cross-Site Scripting、クロスサイトスクリプティング）やクリックジャッキング、アドレスバー偽装などがこれにあたる。こうしたバグを自力で見つけられるようになるには、まず「ブラウザという実行環境がどう組み立てられているか」を知っておく必要がある。

なぜなら、クライアントサイドの脆弱性はすべて **「ブラウザが引いた境界（boundary）を越えられるかどうか」** の話に還元できるからだ。どこに境界があり、どちら側が「特権」を持ち、どちら側が「信頼できない入力」を扱っているのかが分からなければ、「これは越えてはいけない線を越えている」という判断ができない。

この節は、そのための土台となる回である。攻撃手法そのものはまだ出てこない。だが、ここで身につける「プロセス」「スレッド」「IPC」「サンドボックス」「Same Origin Policy」「Site Isolation」という語彙が、以降の章すべての前提になる。

元資料は Google Chrome チームの Mariko Kosaka（`@kosamari`）氏が2018年に書いた入門記事「Inside look at modern web browser (part 1)」である。第1部の副題は原文で `## CPU, GPU, Memory, and multi-process architecture`（CPU・GPU・メモリ、そしてマルチプロセスアーキテクチャ）となっている。

原文には次の注記（Aside）がある。

> *"If you are familiar with the idea of CPU/GPU and process/thread you may skip to Browser Architecture."*

CPU/GPU とプロセス/スレッドの概念にすでに馴染みがあるなら、記事内の「Browser Architecture」節（アンカー `#browser-architecture`）まで飛ばしてよい、という意味である。本書では基礎から積み上げるので飛ばさない。

なお元記事は2018年9月（Chrome 67 時点）の解説であり、その後にネットワークスタックの独立プロセス化やモバイルへの Site Isolation 展開が進んでいる。本節では「2018年時点でこう書かれていた」ことと「2026年現在はこうなっている」ことを、Chromium の公式設計ドキュメントを引きながら区別して示す。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Inside look at modern web browser (part 1) 原典ページ — https://developer.chrome.com/blog/inside-browser-part1
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 発行元ドメインがプロキシで拒否され `EGRESS_BLOCKED` / 403 になる）。本文・見出し・図キャプション・表・リンクはすべて公式リポジトリの記事ソースから完全に回収済みなので**内容の欠落はない**が、レンダリング後のページ体験（アニメーション再生・目次・シリーズナビ・コメント欄）だけは読者自身が開く必要がある。以下の記述はその回収済みソースにもとづく要約である。
> **読みどころ**:
> 1. **Figure 8（Chrome のマルチプロセス構成図）** を自分の目で見る。各プロセスの箱の中に描かれた「点線の魚（＝スレッド）が持っているアイコン」まで見ると、どのプロセスがどんな仕事を抱えているかが一目で入る。
> 2. **Figure 9（プロセスとブラウザ UI の対応図）** の「黄色い枠が引かれている位置」を確認する。その黄色い線がそのまま「Web コンテンツが触れてよい範囲」の境界であり、UI 偽装系バグの定義そのものである。
> 3. **Figure 12（Site Isolation）** の a.com / iframe b.com / iframe c.com が3つの別プロセスに割り当てられる絵を見る。クロスサイト iframe を含むページを診断するときの前提になる。
> **代替手段**: 公式ミラー（本ノートで実際に使用）＝記事ソース Markdown `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part1/index.md`。初出版のソース＋図の実体＝`https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/2018/09/inside-browser-part1.md`。

---

## 1. コンピュータの中核 ― CPU と GPU

### なぜここから始めるのか

ブラウザが動作している「環境」を理解するには、いくつかのコンピュータ部品とその役割を理解する必要がある、というのが原文の出発点である。ブラウザは OS の上で動くアプリケーションであり、その OS はハードウェア（CPU/GPU）の上で動く。だから最下層から順に見ていく。

### CPU とは

CPU とは、Central Processing Unit（中央処理装置）の略で、コンピュータの「脳」と考えてよい部品のこと。多種多様なタスクを1つずつ順番に処理する、汎用（general-purpose）のプロセッサである。

原文は CPU コアを「机に座ったオフィスワーカー」として描く（Figure 1）。入ってくるさまざまなタスクを、1つずつ順に片付けていくイメージである。原文の比喩を引くと次のようになる。

> *"It can handle everything from math to art while knowing how to reply to a customer call."*
> （数学からアートまで何でも扱え、かつ顧客からの電話への応答の仕方も知っている）

ここで強調されているのは **汎用性** である。1つのコアが計算も描画もこなす。

**コア（core）** とは、同じチップの中に住む「もう1つの CPU」のようなもの、と説明できる。過去はほとんどの CPU が単一チップだったが、現代のハードウェアでは1つ以上のコアを持つことが多く、スマートフォンやラップトップに計算能力を与えている。

原文 Figure 1 のキャプション（原文逐語）は次のとおり。

> Figure 1: 4 CPU cores as office workers sitting at each desk handling tasks as they come in

実際の絵（画像を回収して確認済み）では、4体の同型キャラクタが描かれている。頭がスマイリーフェイスの長方形で、片手にレンチ（工作＝汎用作業）、もう片手に電卓（計算）を持ち、それぞれ机に着いている。右下から波打つベルトコンベアが流れてきて、その上に `Task ... Task ... Task ...` の文字が繰り返し書かれている。つまり **「1コアはレンチも電卓も両方持つ万能ワーカーで、到着する多様なタスクを1つずつ順に片付ける。ただしコア数は4しかない」** ことを表している。

### GPU とは

GPU とは、Graphics Processing Unit（グラフィックス処理装置）の略で、単純なタスクを多数のコアで同時に（across multiple cores at the same time）処理するのが得意な部品のこと。名前が示すとおり、最初はグラフィックスを扱うために開発された。

そのためグラフィックスの文脈では、**"using GPU"** や **"GPU-backed"** という表現が「高速なレンダリング（描画）と滑らかなインタラクション」と結び付けられる。近年は GPU-accelerated computing（GPU アクセラレーテッドコンピューティング）により、GPU 単独で可能な計算が増え続けている。

原文 Figure 2 のキャプション（原文逐語）は次のとおり。

> Figure 2: Many GPU cores with wrench suggesting they handle a limited task

実際の絵では、約20体（5行×4列）の小さな正方形スマイリーが整列し、**全員が「レンチ1本だけ」を持っている**（CPU 側にはあった電卓が無い）。上部中央に `Task` の吹き出しと `Order In!!` の文字があり、1つの命令が全員に一斉に降りてくる様子が描かれている。

### CPU と GPU の対比

図1と図2の対比が要点である。表にすると次のようになる。

| 部品 | 得意なこと | コアの数 | 図の比喩 |
| --- | --- | --- | --- |
| CPU | 多種多様なタスクを1つずつ順に（汎用・逐次） | 少数（図では4） | 工具2種（レンチ＋電卓）を持つ少数の万能ワーカー |
| GPU | 単純なタスクを大量に同時に（限定・並列） | 多数（図では約20） | 工具1種（レンチのみ）を持つ大量の単能ワーカー |

〔補足〕この CPU/GPU の分業は、後の章（第4部）で扱う「合成（compositing）」や「GPU-backed なスクロール・アニメーション」の話につながる。今は「ブラウザは CPU も GPU も使う」という事実だけ押さえておけばよい。

---

## 2. 3層モデル ― ハードウェア / OS / アプリケーション

### 設計意図: アプリはハードウェアに直接触らない

コンピュータやスマートフォンでアプリを起動すると、アプリに力を与えているのは CPU と GPU である。ただし通常、**アプリは Operating System（OS、基本ソフト）が提供するメカニズムを介して CPU と GPU 上で動く**。アプリがハードウェアを直接叩くのではなく、必ず OS を経由する。

原文 Figure 3 のキャプション（原文逐語）は次のとおり。

> Figure 3: Three layers of computer architecture. Machine Hardware at the bottom, Operating System in the middle, and Application on top.

下から順に3段重ねになっている。

```
┌─────────────────────────────┐
│   Application（アプリ）        │  ← ブラウザなどのプログラム
├─────────────────────────────┤
│   Operating System（OS）      │  ← CPU/GPU への窓口。特権を絞れる層
├─────────────────────────────┤
│   Machine Hardware            │  ← CPU / GPU など物理的な部品
└─────────────────────────────┘
```

実際の絵では、最下段（ハードウェア）の板の上に Figure 1 の CPU ワーカー群と Figure 2 の GPU グリッドがそのまま描かれ、中段（OS）を通過するところで薄いグレーに退色し、最上段（Application）の板は白紙で左上隅にウィンドウの信号機ボタン（赤・黄・緑の3点）だけが描かれている。

### なぜこの図が重要なのか（セキュリティの前提）

この「アプリは OS を経由してしかハードウェアに触れない」という構造が、後で出てくる **サンドボックス（sandboxing）** の前提である。OS がアプリとハードウェアの間に立っているからこそ、OS は「このプロセスにはファイルアクセスを許さない」「このプロセスの権限はここまで」と特権を絞ることができる。

つまり Figure 3 は、単なる概念図ではなく、「なぜブラウザは特定のプロセスの権限を落とせるのか」という設計の土台を示している。ここを押さえておくと、後の「利点2: セキュリティとサンドボックス」の話が腹落ちする。

---

## 3. プロセスとスレッド ― プログラムを実行する単位

### プロセスとは

ブラウザアーキテクチャに入る前に、もう1つ掴むべき概念がプロセスとスレッドである。

**プロセス（process）** とは、アプリケーションの実行中プログラム（an application's executing program）のこと。たとえば、あなたがブラウザやテキストエディタを起動した瞬間に生まれる「動いているプログラムの実体」がプロセスである。

**スレッド（thread）** とは、プロセスの内側に住み、そのプロセスのプログラムのいずれかの部分を実行するもののこと。1つのプロセスは、作業を助けるために複数のスレッドを作ることもあるが、それは任意（optional）である。

### プロセスとメモリ ― 「slab（ひと塊）」

ここが重要である。**OS はプロセスに作業用のメモリの「slab（ひと塊）」を与え、アプリケーションの全状態はその private memory space（私有メモリ空間）に保持される。** そしてアプリを閉じるとプロセスも消え、OS がそのメモリを解放する。

原文 Figure 4・Figure 5 のキャプション（原文逐語）は次のとおり。

> Figure 4: Process as a bounding box, threads as abstract fish swimming inside of a process
>
> Figure 5: Diagram of a process using memory space and storing application data

Figure 4 の実際の絵では、太い角丸の長方形（＝プロセスの枠）の内側に、点線でできた魚形のループが2匹泳いでいる（＝スレッド）。**スレッドはプロセスの枠の内側にしか存在しない。** 以降の全図で、この「点線の魚＝スレッド」という記法が一貫して使われる。

Figure 5 の実際の絵では、プロセスがモニタとして立ち、その足元に大きな格子（メモリの板）が広がる。プロセスの真下の一部セルが緑色に塗られており、これが **OS がこのプロセスに与えた slab** である。その緑のセルの中に小さな黄色の三角形（＝アプリのデータ）が置かれ、右側のウィンドウには大きな黄色い三角形が表示されている。

```
[プロセス(画面)]              [ウィンドウに見えるもの]
    ├ Thread                     ▲ ▲   ← このデータの実体は…
    └ Thread                     ────
┌──┬──┬──┬──┬──┐              ────
│  │▲ │▲ │  │  │ ← 緑の slab の中にある（私有メモリ）
└──┴──┴──┴──┴──┘
        Memory
```

つまり **「画面に見えているデータの実体は、プロセスの私有メモリの中にある」** ことを可視化している。「アプリケーションの全状態は private memory space に保持される」という本文の絵解きである。

### なぜ「私有メモリ」が効いてくるのか

「プロセスごとにメモリが分かれている」という一点が、後のセキュリティの話でくり返し効いてくる。あるプロセスのメモリは別のプロセスからは（原則）見えない。だから「別々のサイトを別々のプロセスに入れれば、片方のサイトのバグでもう片方のサイトのメモリを読めなくなる」という発想が成り立つ。この発想が Site Isolation（後述）である。

---

## 4. 複数プロセスと IPC ― 特権境界の正体

### プロセスは増やせる。ただしメモリは共有しない

プロセスは OS に対して、別のタスクを走らせるための別プロセスの起動を依頼できる。そうすると新しいプロセスにはメモリの別の部分が割り当てられる（＝メモリ空間は共有されない）。

では、分かれたプロセス同士が会話する必要が出たらどうするのか。ここで登場するのが **IPC** である。

**IPC** とは、Inter Process Communication（プロセス間通信）の略で、2つのプロセスが会話するための手段のこと。メモリを共有していない以上、プロセス間でデータをやり取りするには、この明示的な通路を通るしかない。

原文 Figure 6 のキャプション（原文逐語）は次のとおり。

> Figure 6: Diagram of separate processes communicating over IPC

実際の絵では、同じメモリの板の上にプロセスのスクリーンが2枚立ち、**左のプロセスの取り分は緑のセル群、右のプロセスの取り分は青のセル群**で、緑と青は重なっていない。2枚のスクリーンの上部を点線の曲線矢印が結び、その上に `Inter Process Communication` と明記されている。

```
[Process A]  ← 緑のメモリ      [Process B]  ← 青のメモリ
    │                              │
    └───── IPC（点線1本）──────────┘
         この線を通らないと会話できない
```

### なぜマルチプロセスにするのか（設計意図）

多くのアプリケーションがこの「複数プロセス＋IPC」方式で設計されている理由を、原文はこう述べる。

> *"...so that if a worker process get unresponsive, it can be restarted without stopping other processes which are running different parts of the application."*
> （ワーカープロセスが応答不能になっても、アプリの別部分を走らせている他プロセスを止めずに再起動できるから）

つまり「1か所が固まっても全体を巻き込まない」ための設計である。

### 攻撃者はどこを突くのか

ここが脆弱性ハンティングの観点で決定的である。**メモリが分かれている以上、あるプロセスから別のプロセスに影響を及ぼす道は、原則この IPC の線1本しかない。** Figure 6 の「点線1本」が、後の章で扱う「サンドボックス脱出は IPC を通るしかない」という話の図解になっている。

〔補足〕Chrome の IPC は **Mojo** というメッセージパッシング基盤で実装されている。原文にはこの名称は登場しないが、「サンドボックス化された renderer が browser process に対して行う IPC 呼び出し」が特権境界そのものになる。攻撃者はこの IPC インタフェースに「本来送れないはずのメッセージ」を送り込めないか、「ブラウザ側の検証漏れ」がないかを探す。出典: Chromium `docs/mojo_and_services.md`。

> ### 📌 ここは自分で開いて読んでください
> **資料**: アニメーション版の図（Figure 5 メモリ / Figure 6 ワーカープロセスと IPC / Figure 10 タブのクラッシュ / Figure 11 サービス化）
> **なぜ**: 本教科書の執筆環境からは発行元ページを自動取得できなかった（理由: サイト側のドメイン制限。静止画は初出版リポジトリから回収したが、動きの部分は静止画では落ちる）。2018年版ではこれらの図は「クリックすると CSS アニメーションが再生される SVG」だった。特に Figure 6 は「メモリは分かれている／会話は IPC を通る」という2つの事実が同時にアニメートされるので、後続章の「サンドボックス脱出は IPC を通るしかない」という話が腹落ちする。
> **読みどころ**:
> 1. Figure 6（IPC）: 2プロセスがそれぞれ別区画を確保し、IPC のメッセージが両者の間を飛ぶ様子を見る。
> 2. Figure 5（メモリ）: プロセスがメモリの slab を確保し、アプリのデータ（黄色い三角）がそこに書き込まれ画面に現れるまでを見る。
> **代替手段**: 恒久 URL（コミット SHA 固定、`raw.githubusercontent.com` 経由で到達可能）。ベース `https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/images/inside-browser/part1/` に `memory.svg` / `workerprocess.svg` / `tabs.svg` / `servicfication.svg`（スペルは原文のまま `servicfication`）を付ける。

---

## 5. ブラウザアーキテクチャに「標準仕様」はない

### 問いと答え

では Web ブラウザは、プロセスとスレッドを使ってどう作られているのか。原文の答えは「一通りではない」である。

- 「多数の異なるスレッドを持つ1プロセス」でもありうる。
- 「少数のスレッドを持つ多数のプロセスが IPC 越しに通信する」形でもありうる。

原文 Figure 7 のキャプション（原文逐語）は次のとおり。

> Figure 7: Different browser architectures in process/thread diagram

これは2案の対比図である。左案は「大きな箱1つ（Browser Process）＋点線の魚4匹（＝1プロセス多スレッド）」、右案は「小さな箱が複数並び、それぞれ点線の魚を1〜2匹含み、箱の間を大量の点線 IPC が交差する（＝多プロセス少スレッド）」。

### 最重要の注意点

原文が "The important thing to note here" として強調するのは次の3点である。

> *"The important thing to note here is that these different architectures are implementation details. There is no standard specification on how one might build a web browser. One browser's approach may be completely different from another."*

- これら異なるアーキテクチャは **実装詳細（implementation details）** である。
- Web ブラウザをどう作るべきかの **標準仕様（standard specification）は存在しない。**
- あるブラウザのアプローチは別のブラウザと完全に異なりうる。

この事実は診断の実務で重要である。「Chrome ではこうだから Firefox でも Safari でも同じはず」とは限らない。プロセス分離の粒度やサンドボックスの強さはブラウザごと、プラットフォームごとに違う。だから「どのブラウザの、どのバージョンの、どのプラットフォームで検証したのか」を常に意識する必要がある。

〔補足〕本節が扱う「Network Process が独立ボックスとして描かれている」という Figure 7 右案の細部は、実は2018年時点で既に「サービス化後の到達点」を先取りして描いていた。この点は後述の Servicification 節で説明する。

---

## 6. Chrome のマルチプロセス構成

### 全体像

ここからは Chrome（当時＝2018年）の実際のアーキテクチャを見る。原文は次のように述べる。

> *"Until very recently, Chrome gave each tab a process when it could; now it tries to give each site its own process, including iframes (see Site Isolation)."*
> （ごく最近までは、Chrome は可能なときに各タブへ1プロセスを与えていた。現在は iframe も含め、各サイトに自前のプロセスを与えようとしている）

構成は「最上位に browser process があり、アプリケーションの異なる部分を担当する他プロセスと協調する」形である。renderer process については複数プロセスが作られ、各タブに割り当てられる。

原文 Figure 8 のキャプション（原文逐語）は次のとおり。

> Figure 8: Diagram of Chrome's multi-process architecture. Multiple layers are shown under Renderer Process to represent Chrome running multiple Renderer Processes for each tab.

実際の絵（画像を回収して確認済み）の配置は次のとおりである。

```
        ┌────────────────────┐        ┌─────────────────┐
        │  Browser Process   │────────│  Utility Process │
        │  (network / wifi / │        │   (レンチ)        │
        │   storage の3スレッド)│        └─────────────────┘
        └───────┬──────┬─────┘                 
                │      │           ┌─────────────────┐
     ┌──────────┘      └───────────│   GPU Process    │
     │                             │  (ピクセルグリッド) │
 ┌───┴──────────────┐              └────────┬─────────┘
 │ Renderer Process  │ ←3枚重ね              │
 │ (parse / paint)   │──────────────────────┘
 │ ※タブ/サイトごとに増える│
 └───────────────────┘        ┌─────────────────┐
                              │  Plugin Process   │ ←重ね描き
                              │  (ジグソーピース)   │
                              └─────────────────┘
```

読み取れる主張は次のとおり。**Browser Process が中心のハブ**であり、**Renderer と Plugin だけが「複数枚重ね」＝サイト/タブごとに増える**。Renderer は GPU とも直接線を持つ（描画コマンドの経路）。Utility Process も図の中に明示されている。

### 各プロセスの役割

原文が挙げるプロセスを整理すると次のようになる。

| プロセス | 数 | 役割 |
| --- | --- | --- |
| Browser（ブラウザプロセス） | 1（中心） | ブラウザ全体を統括する。UI と特権機能を担当（次節の表を参照） |
| Renderer（レンダラプロセス） | 複数（タブ/サイトごと） | Web サイトが表示されるタブの内側を担当 |
| Plugin（プラグインプロセス） | 複数 | サイトが使うプラグイン（例: flash）を担当 |
| GPU（GPUプロセス） | 1 | GPU タスクを他プロセスから隔離して扱う |
| Utility / Extension | 複数 | 汎用の低特権プロセス、拡張機能など |

原文はさらにこう述べる。

> *"There are even more processes like the Extension process and utility processes."*
> （Extension process や utility processes のような、さらに多くのプロセスも存在する）

---

## 7. どのプロセスが何を制御するか ― 特権の所在

### 原文の表（逐語）

原文は「The following table describes each Chrome process and what it controls」として次の表を提示する。列見出しは原文どおり `Process and What it controls`。原文の HTML をそのまま引くと次のとおり。

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

日本語で内容を落とさずに書き直すと次のとおりである。

| プロセス | 制御対象 |
| --- | --- |
| **Browser（ブラウザプロセス）** | アプリの「chrome」部分、すなわち**アドレスバー、ブックマーク、戻る/進むボタン**を制御する。加えて、**ネットワークリクエストやファイルアクセスといった、Web ブラウザの「目に見えない特権的な部分（the invisible, privileged parts）」も扱う。** |
| **Renderer（レンダラプロセス）** | **Web サイトが表示されるタブの内側のあらゆるもの**を制御する。 |
| **Plugin（プラグインプロセス）** | Web サイトが使うプラグイン（例: flash）を制御する。 |
| **GPU（GPUプロセス）** | **GPU タスクを他プロセスから隔離して**扱う。GPU は複数アプリからのリクエストを扱い、それらを**同一のサーフェス（same surface）に描画するため**、別プロセスに分離されている。 |

### 「chrome」という語に注意

ここでの **"chrome"（小文字）は、ブラウザ UI の枠部分**を指す一般語であり、製品名 Chrome とは別物である。アドレスバー・ブックマーク・戻る進むは browser process の管轄で、Web コンテンツ（renderer）からは直接触れない。

### 攻撃者はどこを突くのか（特権の所在と UI 偽装）

この表から、脆弱性ハンティングにとって決定的な2つの事実が読み取れる。

1. **特権は browser process 側にある。** ネットワークリクエストとファイルアクセスは browser process の職責である。renderer からこれらに触るには IPC を渡る必要があり、そこがサンドボックス脱出の攻撃面になる。
2. **UI（アドレスバー・ブックマーク・戻る進む）は browser process の管轄。** Web コンテンツが描けるのはタブの内側だけである。だから「アドレスバー偽装」「オムニボックス偽装」「ダイアログ偽装」といった **UI スプーフィング（UI spoofing、UI 偽装）** が別カテゴリのバグとして特別扱いされる。本来 renderer が触れないはずの UI 表示に、renderer が影響を及ぼせたら、それ自体が境界侵犯だからである。

原文 Figure 9 のキャプション（原文逐語）は次のとおり。

> Figure 9: Different processes pointing to different parts of browser UI

実際の絵では、Chrome ウィンドウの線画の外枠全体が黄色い点線で囲まれ、コンテンツ領域の左右に黄色い縦バーが引かれて領域を区切っている。各プロセスから矢印が伸びる。

```
┌═══════════════════════════════════┐ ← 黄色枠（Browser Process の描画物）
║ ← → ⟳  [ omnibox: https://…    ]  ⋮ ║
╠───────────────────────────────────╣
║┃                                 ┃║ ← 黄色い縦バー
║┃   ページのコンテンツ領域          ┃║   （この内側だけが Renderer の描画範囲）
║┃   (Renderer Process が描く)      ┃║
║┃                                 ┃║
╚═══════════════════════════════════╝
  Browser → 枠(chrome部分)   Renderer → 内側   GPU → ページ描画   Plugin → 埋め込み領域
```

**この黄色い線がそのまま「Web コンテンツが触れてよい範囲」の境界**である。アドレスバー・タブ・ボタンは Browser Process の描画物であり、Renderer が正規の手段で描けるのは黄色バーの内側だけ。ここを越えた「表示の偽装」ができれば、それは脆弱性である。

### どう守るのか（防御・検出）

〔補足〕Chromium の脅威モデル文書（`docs/security/compromised-renderers.md`）は、この Figure 9 に直結する原則を明言している。

> *"Compromised renderers shouldn't be able to influence/spoof security-sensitive UI elements."*
> （侵害されたレンダラは、セキュリティ上重要な UI 要素に影響を与えたり偽装したりできてはならない）

具体例として、Omnibox の URL 表示、Secure / not secure チップ（HTTP サイトに固定されたレンダラが鍵アイコンを出させてはならない）、コンテンツ設定アイコン（マイク権限を得たレンダラがマイクアイコンを消せてはならない）、権限ダイアログ中のオリジン表示が挙げられている。防御実装としては、レンダラが主張するコミット内容をブラウザ側で検証し、不正ならプロセスを kill（強制終了）する `RenderFrameHostImpl::CanCommitOriginAndUrl` などが使われる。診断側は「renderer が UI 表示に干渉できる隙間がないか」を探し、防御側は「ブラウザ側で必ず検証してからでないと表示を確定しない」ことで守る。出典: `https://raw.githubusercontent.com/chromium/chromium/main/docs/security/compromised-renderers.md`。

〔補足〕2018年の原文の表では「ネットワークリクエストは browser process が扱う」と書かれているが、Figure 7 の右案と Figure 11 の右側（After）には既に `Network Process` が独立ボックスとして明示的に描かれている（さらに `UI Process` / `Storage Process` / `Device Process` も）。つまり **本文の表＝当時の実装、図7右・図11右＝サービス化の到達目標** という二層構造で読むのが正確である。この点は次節で扱う。

---

## 8. マルチプロセスの利点1 ― クラッシュ耐性（障害の隔離）

### どう動くのか

Chrome は複数の renderer process を使う。最も単純なケースとして「各タブが自分の renderer process を持つ」と考えられる。3つのタブを開いていて、各タブが独立した renderer process で動いているとする。

このとき、1つのタブが応答不能（unresponsive）になったら、**その応答不能なタブだけを閉じて、他のタブを生かしたまま作業を続けられる。** もし全タブが1プロセスで動いていたら、1タブが応答不能になると全タブが応答不能になる。原文の感想はそのまま "That's sad."（それは悲しい）である。

原文 Figure 10 のキャプション（原文逐語）は次のとおり。

> Figure 10: Diagram showing multiple processes running each tab

実際の絵では、タブが3枚開いた Chrome ウィンドウに対し、左2つの Renderer Process が1枚目・2枚目のタブへ矢印を向け、3つ目のボックスだけが灰色に塗られて「Aw, Snap!」のクラッシュアイコンを表示し、3枚目のタブへ矢印を向けている。1つのタブのレンダラが死んでも、他の2タブのレンダラは生きている、という可視化である。

---

## 9. マルチプロセスの利点2 ― セキュリティとサンドボックス（最重要）

### 設計意図と仕組み

これがクライアントサイド脆弱性ハンティングにとって最も重要な節である。原文を逐語で引く。

> *"Another benefit of separating the browser's work into multiple processes is security and sandboxing. Since operating systems provide a way to restrict processes' privileges, the browser can sandbox certain processes from certain features. For example, the Chrome browser restricts arbitrary file access for processes that handle arbitrary user input like the renderer process."*

要点を分解すると次のとおり。

- ブラウザの仕事を複数プロセスに分けるもう1つの利点は、**セキュリティとサンドボックス**である。
- OS はプロセスの特権（privileges）を制限する手段を提供するので、ブラウザは特定のプロセスを特定の機能からサンドボックス化できる。
- 具体例（重要）: Chrome ブラウザは、**renderer process のように「任意のユーザ入力（arbitrary user input）を扱うプロセス」に対して、任意のファイルアクセス（arbitrary file access）を制限する。**

**サンドボックス（sandboxing）** とは、OS のプロセス特権制限機構を使い、特定のプロセスから特定の機能を遮断すること。たとえば「このプロセスにはファイルを読ませない」「このプロセスからは OS の危険な API を呼ばせない」といった制限をかける。

### 攻撃者にとっての意味 ― 2段構えの脅威モデル

ここが土台の核心である。renderer process は「信頼できない入力＝Web コンテンツ」を処理する側なので、**意図的に低特権に落とされている**。だから次のことが言える。

- 「renderer 内でのコード実行」だけでは、ファイル読み出しや OS 操作には到達しない。
- 本当に危険なことをするには、**サンドボックス脱出（sandbox escape）**、すなわち IPC 経由で browser process を攻撃して特権側へ抜ける必要がある。

つまり Chrome の脅威モデルは「Web ページ由来のバグは原則 renderer 内に閉じ込められる」という前提の上に立っている。攻撃は「①renderer を侵害する → ②IPC を悪用して browser process へ抜ける」という2段構えになる。

```
[Web コンテンツ由来のバグ]
        │ ①renderer 内で任意コード実行（それでも低特権）
        ▼
┌──────────────────────┐
│ Renderer Process      │  権限: 低い（ファイルアクセス制限あり）
│  = 信頼できない入力を扱う │
└──────────┬───────────┘
           │ ②IPC（Mojo）越しに browser を攻撃 = サンドボックス脱出
           ▼
┌──────────────────────┐
│ Browser Process       │  権限: 高い（ネットワーク・ファイル）
│  = the privileged parts│
└──────────────────────┘
```

### どう守るのか

〔補足〕Chromium の設計原則に **Rule of 2** がある。「①信頼できない入力を扱う」「②メモリ安全でない言語（C/C++ など）で書かれている」「③高い特権で動く」の3条件を**同時に満たしてはならない**という原則である。だからこそ、信頼できない入力をパースする処理（画像デコーダやパーサ類）は、サンドボックス化された低特権プロセスに追い出される。パーサがもし高特権プロセスにあってメモリ破壊バグがあれば一発で終わりだが、低特権プロセスに置いてあれば「侵害されても renderer 内に閉じる」設計になる。出典: `https://raw.githubusercontent.com/chromium/chromium/main/docs/security/rule-of-2.md`。

---

## 10. 代償 ― メモリ増とプロセス数の上限

### なぜメモリが増えるのか

マルチプロセスにはコストがある。原文を逐語で引く。

> *"Because processes have their own private memory space, they often contain copies of common infrastructure (like V8 which is a Chrome's JavaScript engine). This means more memory usage as they can't be shared the way they would be if they were threads inside the same process."*

- プロセスはそれぞれ私有メモリ空間を持つため、**共通インフラのコピーをしばしば各プロセスが抱える。** 原文が挙げる例は **V8**（Chrome の JavaScript エンジン）である。
- これは「同一プロセス内のスレッドであれば共有できたものが共有できない」ため、メモリ使用量の増加を意味する。

**V8** とは、Chrome の JavaScript エンジンのこと。各プロセスが私有メモリにそのコピーを抱えるため、プロセスが増えるとメモリ消費が直接増える例として挙げられている。

### プロセス数の上限

そこで Chrome はプロセス数に上限を設ける。原文を逐語で引く。

> *"In order to save memory, Chrome puts a limit on how many processes it can spin up. The limit varies depending on how much memory and CPU power your device has, but when Chrome hits the limit, it starts to run multiple tabs from the same site in one process."*

- メモリを節約するため、Chrome は起動できるプロセス数に上限を設けている。
- 上限はデバイスのメモリ量と CPU 性能によって変わる。
- Chrome が上限に達すると、**同一サイト（the same site）からの複数タブを1プロセスで動かし始める。**

### 診断への含意

〔補足〕この「上限に達すると同一サイトのタブを同居させる」挙動を知っておくと、診断中に「別タブなのに同じプロセスだった」という現象を説明できる。重要なのは、**上限を超えても「別サイトなら新プロセス」は守られる**という点である（詳細は次々節の現行仕様で確認する）。つまりプロセス数上限はメモリ節約のためのものであって、セキュリティ境界（別サイトを分ける線）を壊すものではない。

---

## 11. Servicification（サービス化）― 分割も統合もできる

### 設計意図

同じ「プロセスを分割するか統合するか」という調整を、browser process そのものにも適用したのが Servicification である。

**Servicification（サービス化）** とは、ブラウザプログラムの各部分を「サービス（service）」として実装し、環境に応じてプロセス分割（安定性重視）と集約（メモリ節約）を切り替えられるようにするアーキテクチャ変更のこと。

原文の一般的な考え方（General idea）は次のとおり。

- **強力なハードウェア上**で動いているときは、各サービスを別プロセスに分割し、より高い安定性（more stability）を得る。
- **リソース制約のあるデバイス上**では、サービスを1プロセスに統合し、メモリフットプリントを節約する。

メモリ削減のためにプロセスを統合する同様のアプローチは、この変更以前から Android のようなプラットフォームで使われていた。

原文 Figure 11 のキャプション（原文逐語）は次のとおり。

> Figure 11: Diagram of Chrome's servicification moving different services into multiple processes and a single browser process

実際の絵は「左（Before）→ 太い矢印 → 右（After）」の変換図である。

```
   Before（統合）                        After（分割）
┌──────────────────┐            ┌─────────┐ ┌─────────┐ ┌─────────┐
│  Browser Process  │            │ Network │ │ Browser │ │   UI    │
│  ├ network        │  ══════▶   │ Process │ │ Process │ │ Process │
│  ├ wifi           │            └────┬────┘ └────┬────┘ └────┬────┘
│  └ storage        │            ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
└──────────────────┘            │ Storage │ │  GPU    │ │ Device  │
   (低スペック端末向け)              │ Process │ │ Process │ │ Process │
                                 └─────────┘ └─────────┘ └─────────┘
                                  ※点線 IPC が総当たりで交差
```

読み取れる主張は、servicification とは **browser process の内側にいた「魚（スレッド）」を1匹ずつ外に出して独立プロセスにする**操作、ということである。逆向きに読めば「低スペック端末では箱を畳んで browser process に戻す」構成になる（本文の「集約してメモリを節約」）。

### 一次資料による裏付け

〔補足〕この「分割も統合もできる」というのは比喩ではなく、実際にコマンドラインスイッチ1つで切り替わる。Chromium の `docs/servicification.md` は次のように述べる。

> *"with the Network Service in place we can now run the entire network stack either inside or outside of the browser process with the flip of a command-line switch. Client code using the Network Service stays the same, independent of that switch."*
> （Network Service が整備された今、コマンドラインスイッチ1つで、ネットワークスタック全体を browser process の内側でも外側でも動かせる。利用側コードはそのスイッチに関係なく同じままである）

**Network Service** とは、ネットワークスタックを切り出したサービスのこと。原文2018年版の本文の表では「ネットワークは browser process が扱う」と書かれていたが、その後サービスとして独立プロセス化された。出典: `https://raw.githubusercontent.com/chromium/chromium/main/docs/servicification.md`。

### セキュリティ的含意

Figure 11 の After の図では **IPC 線の本数が激増している**。分離が進むほど「プロセス境界＝攻撃面（IPC インタフェース）の数」も増える、という事実が絵の上で一目で分かる。また、**低スペック端末やモバイルでは分離が弱い構成になり得る**ため、プラットフォーム差が防御の強さに直結する。「PC では別プロセスに分かれているものが、モバイルでは同居している」という状況は、攻撃面の広さが変わることを意味する。

---

## 12. Site Isolation（サイト分離）― Same Origin Policy を守る最終手段

### 設計意図: なぜサイトごとにプロセスを分けるのか

**Site Isolation（サイト分離）** とは、クロスサイト iframe のそれぞれに別個の renderer process を走らせる機能のこと。Chrome 67 以降、デスクトップで既定（デフォルト）で有効になっている。

**iframe** とは、あるページの中に別のページを埋め込む HTML 要素のこと。たとえば a.com のページの中に、広告として b.com のフレームが埋め込まれている、という状況が日常的にある。「クロスサイト iframe」とは、外側のページとは別のサイトの iframe を指す。

それまで話してきた「1タブ1 renderer process」モデルでは、クロスサイト iframe が単一の renderer process 内で動き、異なるサイト間で**メモリ空間を共有していた**。a.com と b.com を同じ renderer process で動かすのは、一見問題ないように思えるかもしれない。しかし、そうではない。

### 核心の3文（原文逐語）

原文の次の3文が、本章の論旨の骨格そのものである。

> *"The Same Origin Policy is the core security model of the web; it makes sure one site cannot access data from other sites without consent. Bypassing this policy is a primary goal of security attacks. Process isolation is the most effective way to separate sites."*

- **Same Origin Policy（同一オリジンポリシー、SOP）** は Web のコアセキュリティモデルであり、「1つのサイトが同意なしに他サイトのデータへアクセスできないこと」を保証する。
- **このポリシーの回避（Bypassing this policy）は、セキュリティ攻撃の主要な目標（a primary goal of security attacks）である。**
- **プロセス分離はサイトを分離する最も効果的な方法（the most effective way to separate sites）である。**

**Same Origin Policy（同一オリジンポリシー）** とは、Web のもっとも基本的なセキュリティの約束事のこと。「あるオリジンの JavaScript は、別のオリジンのデータ（クッキー、DOM、レスポンス本文など）に勝手にアクセスできない」というルールである。これが崩れると、あるサイトを開いただけで別サイトの機密情報が抜かれてしまう。

この一文は、クライアントサイド脆弱性の分類全体を1本の軸に整列させる。XSS、CSRF、クリックジャッキング、CORS 誤設定、postMessage の検証漏れ、XS-Leaks などはすべて「Same Origin Policy をどう回避するか」という共通の目標に向かった手口として理解できる。

### Meltdown と Spectre が突きつけたもの

原文は続けてこう述べる。

> *"With Meltdown and Spectre, it became even more apparent that we need to separate sites using processes. With Site Isolation enabled on desktop by default since Chrome 67, each cross-site iframe in a tab gets a separate renderer process."*

**Meltdown / Spectre** とは、CPU の投機実行（speculative execution）という高速化のしくみを悪用して、本来読めないはずのメモリ内容を読み取れてしまう脆弱性のこと。これが公開されたことで、「同一プロセス内にいる別サイトのメモリは、ソフトウェアの Same Origin Policy だけでは守り切れない」ことが明白になった。

なぜか。Meltdown / Spectre はソフトウェアのポリシーチェックを飛び越えて、同じプロセスのメモリ空間を読んでしまうからである。つまり **a.com と b.com が同じ renderer process に同居している限り、b.com のバグ（や投機実行サイドチャネル）で a.com のメモリを読める可能性がある。** これを構造的に断つには、そもそもサイトを別プロセスに分けてメモリ空間ごと分離するしかない。それが Site Isolation である。

原文 Figure 12 のキャプション（原文逐語）は次のとおり。

> Figure 12: Diagram of site isolation; multiple renderer processes pointing to iframes within a site

実際の絵では、1枚のタブに `a.com` のページがあり、その中に `iframe b.com` と `iframe c.com` が縦に並ぶ。右側の Renderer Process が a.com 本体へ、左側の2つの Renderer Process がそれぞれ b.com / c.com の iframe へ矢印を向ける。

```
┌───────────────────────── tab: a.com ─────────────────────────┐
│  a.com のドキュメント本体  ───────────────▶ [Renderer #1] (a.com) │
│  ┌────────────────────┐                                      │
│  │ iframe b.com        │ ────────────────▶ [Renderer #2] (b.com) │
│  └────────────────────┘                                      │
│  ┌────────────────────┐                                      │
│  │ iframe c.com        │ ────────────────▶ [Renderer #3] (c.com) │
│  └────────────────────┘                                      │
└──────────────────────────────────────────────────────────────┘
   → 1タブ・1ページの中にサイトが3つあれば、レンダラプロセスは3つ
```

**Site Isolation の分離粒度は「タブ」ではなく「フレーム内のサイト」である。** これがクロスサイト iframe を含むページを診断するときの決定的な前提になる。

### 実装がどれほど大変だったか

原文は Site Isolation の実装コストを強調している。

> *"Site Isolation isn't as simple as assigning different renderer processes; it fundamentally changes the way iframes talk to each other."*
>
> *"Even running a simple Ctrl+F to find a word in a page means searching across different renderer processes."*

- Site Isolation の有効化は複数年にわたるエンジニアリング努力（a multi-year engineering effort）だった。
- 「異なる renderer process を割り当てるだけ」の単純な話ではなく、**iframe 同士の会話のしかたを根本的に変える**ものだった。
- 異なるプロセスで動く iframe を含むページで DevTools を開くと、DevTools 側が「シームレスに見せるための裏方作業」を実装しなければならない。
- 単純な Ctrl+F でページ内の語を探すことすら、**異なる renderer process をまたいで検索する**ことを意味する。

〔補足〕この「プロセスをまたぐ協調処理」自体が、新しい攻撃面（クロスプロセス IPC の検証漏れ）を生む。分離を実現するために増えた通路が、そのまま新たな検証ポイントになる、という点は覚えておきたい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: 原文が張っている3本の外部リンク（Site Isolation 解説 / Same Origin Policy / Meltdown and Spectre）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `developer.chrome.com` / `developers.google.com` / `developer.mozilla.org` がいずれもプロキシで 403 になる）。以下の記述は原文本文と目次・二次情報にもとづく要約である。part1 本文はこの3本を「詳しくはこちら」として参照しているだけで、定義の詳細はリンク先にある。
> **読みどころ**:
> 1. **Site Isolation 解説**（原文リンクは `https://developers.google.com//web/updates/2018/07/site-isolation`＝ダブルスラッシュは移植時のバグ。現行は `https://developer.chrome.com/blog/site-isolation`）: **site の定義（scheme + eTLD+1）** と **CORB** の説明。part1 が省略した「なぜオリジンでなくサイト単位なのか」がここにある。
> 2. **Same Origin Policy**（`https://developer.mozilla.org/ja/docs/Web/Security/Same-origin_policy`、日本語版あり）: **オリジンの定義（scheme + host + port）** と、`document.domain`・CORS・`postMessage` など**例外の一覧**。Site Isolation との粒度差を理解する前提。
> 3. **Meltdown and Spectre**（原文リンク `https://developers.google.com/web/updates/2018/02/meltdown-spectre`、現行 `https://developer.chrome.com/blog/meltdown-spectre`）: **なぜ「同一プロセス内なら読めてしまう」のか**。`SharedArrayBuffer` の一時停止と `performance.now()` の粗粒度化という Web API 側の対応も書かれており、後の COOP/COEP・`crossOriginIsolated` へ繋がる。
> **代替手段**: Same Origin Policy は MDN 日本語版が読みやすい。Site Isolation と Meltdown/Spectre は上記「現行」URL（`developer.chrome.com/blog/...`）が正規の移設先。

---

## 13. site と origin の粒度差、そして現行の分離モード

### なぜ「オリジン」ではなく「サイト」なのか

原文は「site」と「origin」の違いを明示していないが、ここは診断で必ず効くので押さえる。

- **オリジン（origin）** = scheme + host + port（例: `https://a.example.com:443`）。Same Origin Policy が用いる単位。
- **サイト（site）** = scheme + eTLD+1（例: `https://example.com`）。Site Isolation が用いる分離単位。

Chromium の `docs/process_model_and_site_isolation.md` は、site をこう定義している（逐語）。

> *"Sites are defined as scheme plus eTLD+1, since different origins within a given site may have synchronous access to each other if they each modify their document.domain."*

つまり、`document.domain` を書き換えれば同一サイト内の異なるオリジンが互いに同期アクセスできてしまうため、分離単位はオリジンより1段粗い「サイト」になっている。その結果、`a.example.com` と `b.example.com` は**同一サイト扱いで同一プロセスに入りうる。**

| 単位 | 定義 | 使う場面 | 例（同じ？） |
| --- | --- | --- | --- |
| オリジン | scheme + host + port | Same Origin Policy | `a.example.com` と `b.example.com` は**別オリジン** |
| サイト | scheme + eTLD+1 | Site Isolation のプロセス分離 | `a.example.com` と `b.example.com` は**同一サイト** |

この粒度差が、後続章（Spectre 系サイドチャネル、COOP/COEP、`Origin-Agent-Cluster`）へ直接つながる。

### 現行は4モードある（原文の「Chrome 67 以降デスクトップ既定有効」の精密版）

〔補足〕2018年の原文は「Chrome 67 以降デスクトップで既定有効」としか書いていないが、現実の分離はプラットフォームでずっと複雑である。`docs/process_model_and_site_isolation.md` によれば次の4モードがある。

| モード | 対象プラットフォーム | 内容 |
| --- | --- | --- |
| **Full Site Isolation**（site-per-process） | デスクトップ | すべてのサイトを別プロセスに分ける。侵害レンダラと Spectre 系攻撃の両方から保護される |
| **Partial Site Isolation** | Android（RAM 2GB 以上） | 一部のサイトだけを専用（ロック済み）プロセスに入れる。対象は**ユーザがパスワードを入力したサイト、OAuth でログインしたサイト、COOP ヘッダを返したサイト**などのヒューリスティクスで決まる |
| **No Site Isolation** | RAM 2GB 未満の Android / Android WebView / iOS 版 Chrome | サイト分離なし（iOS は WebKit ベースのため OOPIF 非対応） |
| **Origin Isolation** | オプトイン | `--isolate-origins=`、`chrome://flags#isolate-origins`、エンタープライズポリシー `IsolateOrigins`、`Origin-Agent-Cluster` レスポンスヘッダによる |

**Origin-Agent-Cluster** とは、オリジン単位のプロセス分離を要求するレスポンスヘッダのこと。ただし公式ドキュメントは *"This is not a security guarantee and may not always be honored"*（これはセキュリティ保証ではなく、常に尊重されるとは限らない）と明記している点に注意する。

診断上の意味は大きい。**「Android WebView や古い端末では、そもそもサイト分離が効いていない」** ため、Meltdown/Spectre 系や cross-site のメモリ開示が成立し得る土俵が変わる。「PC の Chrome で守られている」ことは「全プラットフォームで守られている」ことを意味しない。出典: `https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md`。

### プロセス数上限の現行仕様

前の節で触れた「上限に達すると同一サイトのタブを同居」の精密版が、同じドキュメントの **soft process limit（ソフト上限）** である（逐語）。

> *"Soft Process Limit: On desktop platforms, Chromium sets a 'soft' process limit based on the memory available on a given client. ... Chromium makes an attempt to start randomly reusing same-site processes when over this limit."*

例として次のように書かれている。上限が100プロセスで、ユーザが `example.com` を50タブ、`example.org` を50タブ開いているとき、新しい `example.com` タブは既存の `example.com` プロセスのどれかとランダムに同居するが、`chromium.org` の新タブは101番目のプロセスを作る。つまり **上限を超えても「別サイトなら新プロセス」は守られる**（上限はセキュリティ境界を壊さない）。

---

## 14. 脆弱性ハンティングへの橋渡し ― 「侵害レンダラ」を前提に考える

### レンダラは「すでに乗っ取られている」と仮定する

ここまでの土台の上に、現代の Chrome の脅威モデルを重ねる。Chromium の `docs/security/compromised-renderers.md` はこう始まる（逐語）。

> *"Given the complexity of the browser, our threat model must use a 'defense in depth' approach to limit the damage that occurs if an attacker finds a way around the Same Origin Policy or other security logic in the renderer process. For example, the combination of Chrome's sandbox, IPC security checks, and Site Isolation limit what an untrustworthy renderer process can do."*

そして「侵害されたレンダラ（compromised renderer）」を次のように定義する。

> *"In a compromised renderer, an attacker is able to execute arbitrary native (i.e. non-JavaScript) code within the renderer process's sandbox. A compromised renderer can forge malicious IPC messages, impersonate a Chrome Extension content script, or use other techniques to trick more privileged parts of the browser."*

**侵害されたレンダラ（compromised renderer）** とは、レンダラのサンドボックス内で**任意のネイティブコード（非 JavaScript）**が実行されている状態のこと。この状態のレンダラは、悪意ある IPC メッセージを偽造したり、拡張機能のコンテンツスクリプトになりすましたりできる。

重要なのは、**Chrome の脅威モデルはこの「レンダラは既に乗っ取られている」状態を前提に置いている**という点である。つまり **「レンダラを侵害できた」だけでは脅威モデル上は想定内**であり、そこから何が守られているか（＝この文書の各節）を破ることが脆弱性になる。

### この文書の目次がそのまま攻撃面のチェックリストになる

`compromised-renderers.md` は「侵害レンダラから守るべきもの」を節として列挙している。この見出しの並びが、そのままバグハンティングの探索対象になる。

- Site Isolation foundations（サイト分離の基盤）
- Cross-Origin HTTP resources（クロスオリジンの HTTP リソース）
- Contents of cross-site frames（クロスサイトフレームの内容）
- Cookies / Passwords（クッキー・パスワード）
- **Security-sensitive UI/chrome elements（例: Omnibox）** ← 第7節の Figure 9 に直結
- Permissions / Web storage / Messaging / JavaScript code cache
- Cross-Origin-Resource-Policy / frame-ancestors CSP と X-Frame-Options
- HTTP request headers / SameSite cookies（作業中）/ User gestures（作業中）
- Web Accessible Resources of Chrome Extensions / Non-Web resources
- **Android-specific protection gaps（Android 固有の保護の穴）**
- Renderer processes hosting DevTools frontend

また、原文には無い重要な「既知のギャップ」も明記されている（逐語）。

- *"No form of Site Isolation is active in Android WebView."*（Android WebView ではいかなる形の Site Isolation も動いていない）
- *"Frames with `<iframe sandbox>` attribute are not isolated from their non-opaque precursor origin."*
- *"`file:` frames may share a process with other `file:` frames."*

なお同文書は、こうした保護の穴が新たに見つかれば脆弱性として扱われ、報奨金の対象になり得ることを明言している（逐語）。

> *"Newly discovered holes in this protection would be considered security bugs and possibly eligible for the Chrome Vulnerability Rewards Program."*

出典: `https://raw.githubusercontent.com/chromium/chromium/main/docs/security/compromised-renderers.md`。

### IPC 境界で「何を検証しているか」を知ると探索方針が立つ

〔補足〕browser process 側は、受信した IPC を鵜呑みにせず検証している。`docs/process_model_and_site_isolation.md` によれば、次のような仕組みがある。

- **ProcessLock**: RenderProcessHost に割り当てられ、そのプロセスにロードしてよいサイトとアクセスしてよいデータを制限する。粒度はサイト単位 / オリジン単位 / スキーム単位（`file://`）/ allow-any-site。`chrome://` URL は決して他サイトとプロセスを共有しない。ロックはナビゲーション開始時かレスポンス開始時（コミット直前）に必ず割り当てられ、一度サイト固定されると RenderProcessHost の生存期間中は不変である。
- **CanAccessDataForOrigin**: 受信した IPC がそのオリジンの権限を主張してよいかを、プロセスロックと突き合わせて検証する関数。
- **GetLastCommittedOrigin()**: レンダラの自己申告ではなく、ブラウザ側で計算した信頼できるオリジンで判断する。

診断側の発想はこうなる。**「ブラウザが IPC 境界で何を検証しているか」が分かれば、「その検証が漏れている経路＝バグ」という探索方針が立つ。** レンダラが「自分は origin X だ」と主張したときに、ブラウザがそれを ProcessLock と突き合わせずに信じてしまう箇所があれば、それがサイト分離を破る糸口になる。出典: `https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md`。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Chromium 公式設計ドキュメント群（compromised-renderers.md / process_model_and_site_isolation.md / servicification.md / mojo_and_services.md / design/sandbox.md / security/rule-of-2.md / security/side-channel-threat-model.md）
> **なぜ**: 本教科書の執筆環境からは正式な閲覧先 `chromium.googlesource.com` に到達できなかった（理由: プロキシで 403）。本文は `raw.githubusercontent.com` のミラー経由で回収済みだが、常に最新版を追うには読者自身が原典を開く必要がある。
> **読みどころ**:
> 1. `compromised-renderers.md`: 「レンダラ侵害は前提、そこから何を守るか」の公式チェックリスト。各節の見出しがそのまま探索対象になる。VRP（報奨金）対象であることも明記。
> 2. `process_model_and_site_isolation.md`: Full / Partial / No / Origin の4モード、ProcessLock、soft process limit。Android と iOS では分離が弱い/無いという、原文（2018）では読めない事実。
> 3. `rule-of-2.md`: 「信頼できない入力 × メモリ安全でない言語 × 高特権」の3つを同時に満たすなという原則。なぜパーサが低特権プロセスに追い出されるのかが分かる。
> 4. `mojo_and_services.md`: Chrome の IPC の実体 Mojo。特権境界を越える唯一の通路なので、サンドボックス脱出を扱う章の前提。
> **代替手段**: すべて GitHub ミラー `https://raw.githubusercontent.com/chromium/chromium/main/docs/...` で到達可能（例: `docs/security/compromised-renderers.md`）。

---

## 手を動かす

原文の主張（「1タブ1プロセス」「同一サイトは同居」「iframe ごとに分離」）を、自分の Chrome で実際に確かめる。

1. **Task Manager（タスクマネージャ）を開く。** 原文の操作手順は次のとおり（原文逐語ベース）。

   ```text
   click the options menu icon (more_vert) at the top right corner
     -> select More Tools
     -> select Task Manager
   This opens up a window with a list of processes that are currently running
   and how much CPU/Memory they are using.
   ```

   すなわち、右上の三点メニュー（`more_vert`）→ その他のツール（More Tools）→ タスク マネージャ（Task Manager）の順にクリックする。デスクトップ版では **Shift+Esc** のショートカットでも開ける（原文には無い〔補足〕）。開くと、現在実行中のプロセス一覧と、それぞれの CPU / メモリ使用量が表示される。

2. **3パターンでプロセス数の増え方を観察する。**
   - タブを増やす（別サイトのページを複数開く）→ プロセスが増える。
   - 同一サイトのタブを増やす（同じ `example.com` を複数タブで開く）→ 上限付近では同居しやすい。
   - クロスサイト iframe を含むページを開く → iframe のサイトごとに renderer が増える。

   この3つを比べると、「1タブ1プロセス」「同一サイトは同居」「iframe ごとに分離」が同時に確認できる。

3. **`chrome://process-internals/#web-contents` を開く。** アドレスバーにこの URL を入力する。フレームツリーと、各フレームのプロセス ID／SiteInstance が一覧できる。これで Figure 12 の絵が「実データ」として見える。

4. **現在の分離モードを確認する。** `chrome://flags/#site-isolation-trial-opt-out` や `--isolate-origins=` を触る前に、まず `chrome://process-internals/` で現在の分離モードを確認する。Partial Site Isolation の端末では挙動が変わることを体感できる。

5. **次に進む。** 原文末尾のボタン **"Next: What happens in navigation"** から part 2 へ進む。原文 HTML は次のとおり。

   ```html
   <a class="button button-primary gc-analytics-event attempt-right"
      href="/blog/inside-browser-part2"
      data-category="InsideBrowser" data-label="Part1 / Next">Next: What happens in navigation</a>
   ```

   part 1 は土台（用語とプロセス構成）だけである。実際の攻撃面（ナビゲーション処理、レンダラ内部のパイプライン、コンポジタと入力処理）は part 2〜4 で扱う。

---

## つまずきポイント

- **「chrome」＝製品名 Chrome、と混同する。** 表の中の "chrome" は小文字で、ブラウザ UI の枠部分（アドレスバー・ボタン等）を指す一般語である。製品名の Chrome とは別。
- **「renderer で JavaScript が実行できた＝致命的」と早合点する。** renderer は意図的に低特権に落とされているので、renderer 内のコード実行だけではファイルや OS には届かない。本当に危険にするにはサンドボックス脱出（IPC 経由で browser process へ）が別途必要、という2段構えを忘れない。
- **「サイト（site）」と「オリジン（origin）」を同じものだと思う。** Site Isolation はサイト単位（scheme + eTLD+1）、Same Origin Policy はオリジン単位（scheme + host + port）。`a.example.com` と `b.example.com` は別オリジンだが同一サイトなので、同じプロセスに入りうる。
- **「Chrome 67 以降デスクトップ既定有効」だから全環境で守られている、と思う。** 現実は Full / Partial / No / Origin の4モードがあり、Android WebView や iOS、低 RAM 端末では分離が弱い、または無い。プラットフォームで攻撃面が変わる。
- **2018年の原文の記述を「今もそのまま」と読む。** 本文の表では network を browser process の職責と書いているが、その後 Network Service として独立プロセス化され、現在はコマンドラインスイッチ1つで内外を切り替えられる。図7右・図11右は当時から「到達目標」を先取りして描いていた。
- **プロセス数上限が「セキュリティ境界を壊す」と誤解する。** 上限を超えても同居するのは同一サイト同士だけで、別サイトには必ず新プロセスが作られる。上限はメモリ節約のためで、分離の線は壊さない。
- **静止画だけで理解しようとする。** Figure 5/6/10/11 は本来アニメーションで「メモリ確保」「IPC のメッセージ往来」「タブのクラッシュ」「サービスが外へ出る」という動きを見せる図。静止画では動きの情報が落ちる。

---

## この節のまとめ

- CPU は多種多様なタスクを1つずつ順に処理する汎用・少数コアのプロセッサ、GPU は単純なタスクを多数コアで同時に処理する限定・多数コアのプロセッサである。
- アプリはハードウェアに直接触れず、必ず OS を経由する（ハードウェア→OS→アプリの3層モデル）。この構造が、OS がプロセス特権を絞れる＝サンドボックスの前提になる。
- プロセスはアプリの実行中プログラムで、OS からメモリの「slab」を与えられ、全状態を私有メモリ空間に保持する。スレッドはプロセスの内側で動く実行単位で、作成は任意。
- プロセスはメモリを共有しないので、会話するには IPC（プロセス間通信）を使う。この IPC の線が、後の「サンドボックス脱出は IPC を通る」という話の起点になる。
- ブラウザの作り方に標準仕様はない。マルチプロセス構成は実装詳細であり、ブラウザやプラットフォームで異なりうる。
- Chrome は Browser（統括・特権）、Renderer（タブ内・低特権）、Plugin、GPU、Utility などのプロセスに分かれる。Renderer と Plugin はサイト/タブごとに増える。
- 特権（ネットワーク・ファイルアクセス）は browser process 側にある。UI（アドレスバー等）も browser process の管轄で、Web コンテンツからは触れない。だから UI 偽装が別カテゴリのバグになる。
- マルチプロセスの利点は、クラッシュ耐性（1タブが死んでも他は生きる）とセキュリティ（renderer を低特権にサンドボックス化）である。
- 代償はメモリ増（V8 などのコピーを各プロセスが抱える）。そのため Chrome はプロセス数に上限を設け、上限超過時は同一サイトのタブを同居させる（別サイトは新プロセス）。
- Servicification により、ブラウザの各機能はサービスとして分割も統合もできる。Network Service はコマンドラインスイッチ1つで browser process の内外を切り替えられる。分離が進むほど IPC 境界＝攻撃面の数も増える。
- Same Origin Policy は Web のコアセキュリティモデルであり、その回避が攻撃の主目的。Site Isolation はクロスサイト iframe ごとに別プロセスを割り当て、サイトをメモリ空間ごと分離する最も効果的な手段である。
- Meltdown / Spectre により、「同一プロセス内の別サイトのメモリは読めてしまう」ことが明白になり、プロセスによるサイト分離の必要性が確定した。
- 分離単位はオリジン（scheme+host+port）ではなくサイト（scheme+eTLD+1）で、オリジンより粗い。現行の分離は Full / Partial / No / Origin の4モードがあり、プラットフォームで守りの強さが変わる。
- Chrome の脅威モデルは「レンダラは既に侵害されている」を前提に置く。侵害レンダラから守るべきものの一覧（compromised-renderers.md の各節）が、そのまま攻撃面のチェックリストになる。
- ProcessLock や CanAccessDataForOrigin など、ブラウザが IPC 境界で何を検証しているかを知ると、「その検証漏れ＝バグ」という探索方針が立つ。

---

## 理解度チェック

1. CPU と GPU の違いを「コアの数」と「処理の仕方」の観点で説明せよ。

   ▶ 答え: CPU はコア数が少なく、多種多様なタスクを1つずつ順に処理する汎用プロセッサ。GPU はコア数が多く、単純なタスクを多数コアで同時に処理する限定・並列型のプロセッサである。

2. 「プロセスは私有メモリ空間を持つ」という性質は、なぜセキュリティ上重要なのか。

   ▶ 答え: あるプロセスのメモリは別のプロセスから（原則）見えないため、別々のサイトを別々のプロセスに入れれば、片方のサイトのバフや投機実行サイドチャネルでも、もう片方のサイトのメモリを読めなくなる。これが Site Isolation の発想の核心である。

3. 「renderer process 内で任意コードが実行できた」だけでは攻撃として不十分なのはなぜか。

   ▶ 答え: renderer は任意のユーザ入力（Web コンテンツ）を扱うため、意図的に低特権に落とされており、任意のファイルアクセスなどが制限されている。ファイル読み出しや OS 操作に到達するには、IPC 経由で高特権の browser process を攻撃する「サンドボックス脱出」が別途必要になる。

4. アドレスバー偽装（UI スプーフィング）が「別カテゴリのバグ」として扱われる構造的な理由を、プロセスの役割の観点で説明せよ。

   ▶ 答え: アドレスバーやボタンなどの UI（chrome 部分）は browser process の管轄で描画され、Web コンテンツを扱う renderer process からは直接触れない。Web コンテンツが描けるのはタブ内側だけである。よって renderer 側から UI 表示に影響を及ぼせたら、それ自体が本来越えられない境界を越えたことになる。

5. Same Origin Policy（同一オリジンポリシー）とは何か。原文はこれと「攻撃の目的」をどう関係づけているか。

   ▶ 答え: Same Origin Policy は Web のコアセキュリティモデルで、あるサイトが同意なしに他サイトのデータへアクセスできないことを保証する。原文は「このポリシーの回避（bypass）がセキュリティ攻撃の主要な目標である」と明言している。

6. Site Isolation の分離単位は「タブ」か「サイト」か。また、その「サイト」の定義を述べよ。

   ▶ 答え: 分離単位はタブではなく「フレーム内のサイト」である。サイトは scheme + eTLD+1 で定義される。`document.domain` を書き換えれば同一サイト内の異なるオリジンが同期アクセスし得るため、分離単位はオリジンより1段粗いサイトになっている。

7. Meltdown / Spectre は、Site Isolation の必要性をなぜ高めたのか。

   ▶ 答え: Meltdown / Spectre は CPU の投機実行を悪用し、ソフトウェアのポリシーチェックを飛び越えて同一プロセスのメモリを読んでしまう。したがって別サイトが同じ renderer process に同居している限り危険であり、これを構造的に断つには、そもそもサイトを別プロセスに分けてメモリ空間ごと分離するしかない、と明白になった。

8. プロセス数の上限に達したとき、Chrome はどう振る舞うか。それはセキュリティ境界を壊すか。

   ▶ 答え: 上限に達すると、同一サイトからの複数タブを1プロセスで動かし始める（同一サイトのプロセスをランダムに再利用する）。ただし別サイトには必ず新しいプロセスを作るため、上限はメモリ節約のためのものであり、別サイトを分ける境界は壊さない。

9. 「Chrome 67 以降デスクトップで既定有効」という2018年の記述に対し、現行仕様ではどんなモードの違いがあるか。診断上なぜ重要か。

   ▶ 答え: 現行は Full Site Isolation（デスクトップ）、Partial Site Isolation（Android 2GB 以上）、No Site Isolation（低 RAM Android / Android WebView / iOS）、Origin Isolation（オプトイン）の4モードがある。プラットフォームによって分離が弱い、または無いため、「PC で守られている＝全環境で守られている」ではなく、環境ごとに攻撃面が変わる。

10. Chromium の脅威モデルが「侵害されたレンダラ（compromised renderer）」を前提に置くとは、バグハンティングにとってどういう意味か。

    ▶ 答え: レンダラは「既に任意ネイティブコードが実行されている」状態を前提に設計されている。よって「レンダラを侵害できた」だけでは脅威モデル上は想定内であり、その状態から守られているもの（Cookie、クロスサイトフレームの内容、UI 要素、権限など compromised-renderers.md の各節）を破ることが脆弱性になる。この各節がそのまま攻撃面のチェックリストになる。

---

## 出典

- Inside look at modern web browser (part 1) — https://developer.chrome.com/blog/inside-browser-part1
- 記事ソース Markdown（現行版ミラー） — https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part1/index.md
- 初出版ソース＋図の実体（2018年 Web Fundamentals） — https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/2018/09/inside-browser-part1.md
- 図画像ベース URL（恒久） — https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/images/inside-browser/part1/
- Site Isolation 解説（現行） — https://developer.chrome.com/blog/site-isolation
- Same Origin Policy（MDN 日本語版） — https://developer.mozilla.org/ja/docs/Web/Security/Same-origin_policy
- Meltdown and Spectre（現行） — https://developer.chrome.com/blog/meltdown-spectre
- 侵害されたレンダラの脅威モデル — https://raw.githubusercontent.com/chromium/chromium/main/docs/security/compromised-renderers.md
- プロセスモデルと Site Isolation — https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md
- Servicification — https://raw.githubusercontent.com/chromium/chromium/main/docs/servicification.md
- Mojo & Services — https://raw.githubusercontent.com/chromium/chromium/main/docs/mojo_and_services.md
- Rule of 2 — https://raw.githubusercontent.com/chromium/chromium/main/docs/security/rule-of-2.md
- サンドボックス設計 — https://raw.githubusercontent.com/chromium/chromium/main/docs/design/sandbox.md
- サイドチャネル脅威モデル — https://raw.githubusercontent.com/chromium/chromium/main/docs/security/side-channel-threat-model.md

<!-- sources: https://developer.chrome.com/blog/inside-browser-part1, https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part1/index.md, https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/2018/09/inside-browser-part1.md, https://developer.chrome.com/blog/site-isolation, https://developer.mozilla.org/ja/docs/Web/Security/Same-origin_policy, https://developer.chrome.com/blog/meltdown-spectre, https://raw.githubusercontent.com/chromium/chromium/main/docs/security/compromised-renderers.md, https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md, https://raw.githubusercontent.com/chromium/chromium/main/docs/servicification.md, https://raw.githubusercontent.com/chromium/chromium/main/docs/mojo_and_services.md, https://raw.githubusercontent.com/chromium/chromium/main/docs/security/rule-of-2.md -->
<!-- terms: CPU, GPU, コア, プロセス, スレッド, IPC, slab, 私有メモリ空間, Browser プロセス, Renderer プロセス, Plugin プロセス, GPU プロセス, Utility プロセス, サンドボックス, Servicification, Network Service, Mojo, Site Isolation, Same Origin Policy, オリジン, サイト, Meltdown / Spectre, V8, UI スプーフィング, 侵害されたレンダラ, ProcessLock, CanAccessDataForOrigin, Origin-Agent-Cluster, soft process limit, Rule of 2, Full Site Isolation, Partial Site Isolation -->
<!-- self-read: https://developer.chrome.com/blog/inside-browser-part1 | 発行元ドメインがプロキシで拒否され EGRESS_BLOCKED / 403。本文は公式リポジトリのソースから全文回収済みだが、レンダリング後のページ体験（アニメーション・目次・シリーズナビ）は読者が開く必要がある -->
<!-- self-read: https://raw.githubusercontent.com/google/WebFundamentals/fde6de49a430f816197c3e048b73fad1c7e2e917/src/content/en/updates/images/inside-browser/part1/ | 図5/6/10/11 のアニメーション（memory.svg / workerprocess.svg / tabs.svg / servicfication.svg）は静止画では動きの情報が落ちる。発行元ページは到達不能だが恒久 URL は raw.githubusercontent.com 経由で開ける -->
<!-- self-read: https://developer.chrome.com/blog/site-isolation | developer.chrome.com がプロキシで 403。site の定義（scheme+eTLD+1）と CORB の詳細はこのリンク先にある。part1 本文は参照のみ -->
<!-- self-read: https://developer.mozilla.org/ja/docs/Web/Security/Same-origin_policy | developer.mozilla.org がプロキシで 403。オリジンの定義（scheme+host+port）と document.domain/CORS/postMessage など例外の一覧はこのリンク先にある -->
<!-- self-read: https://developer.chrome.com/blog/meltdown-spectre | developer.chrome.com がプロキシで 403。なぜ同一プロセス内なら読めてしまうのか、SharedArrayBuffer 停止と performance.now() 粗粒度化という Web API 側の対応はこのリンク先にある -->
<!-- self-read: https://raw.githubusercontent.com/chromium/chromium/main/docs/security/compromised-renderers.md | 正式閲覧先 chromium.googlesource.com がプロキシで 403。侵害レンダラから守るべきものの公式チェックリスト（各節がそのまま探索対象）と VRP 対象の明記は原典で最新版を追う価値がある -->
<!-- self-read: https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md | 正式閲覧先 chromium.googlesource.com がプロキシで 403。Full/Partial/No/Origin の4モード、ProcessLock、soft process limit、Android/iOS の分離差は原典で確認する価値がある -->
