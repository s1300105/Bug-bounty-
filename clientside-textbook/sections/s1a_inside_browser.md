## Inside look at modern web browser（プロセスモデルとレンダリング）

クライアントサイドの脆弱性ハンティングは、突き詰めれば「ブラウザという巨大な実行環境の、どこに信頼境界が引かれているか」を当てる作業である。XSS は「攻撃者の文字列がレンダラプロセスの JavaScript 実行エンジンに到達した」状態であり、UXSS は「レンダラ内部のオリジン分離が壊れた」状態であり、サンドボックスエスケープは「レンダラプロセスから OS 権限へ抜けた」状態である。どれも *プロセス境界* と *レンダリングパイプライン* を知らないと、同じ「JavaScript が動いた」という現象にしか見えない。

本節では、Google の Mariko Kosaka 氏による全4部の連載「Inside look at modern web browser」のうち第1〜3部を読み解き、(A) Chrome のマルチプロセスアーキテクチャ、(B) ナビゲーション時にブラウザプロセスとレンダラプロセスの間で何が受け渡されるか、(C) レンダラプロセス内部の parse → style → layout → paint → composite を、脆弱性ハンターの視点で再構成する。

> **バージョンについての注意**: 原典3本はいずれも 2018年9月 公開・更新（第1部 2018-09-05、第2部 2018-09-07、第3部 2018-09-20）で、当時の Chrome（Chrome 67〜69 前後）の実装を説明している。8年近く経った現在は、後述する RenderingNG（2021年〜）や ORB（Opaque Response Blocking）など、置き換わった要素がある。原典の記述と、現在の状況に関する補足は本節内で明確に区別する。

---

### 1. プロセスとスレッド ―― マルチプロセスアーキテクチャの土台

#### 1.1 CPU / GPU / OS という前提

原典は、まずハードウェアから説明を始める。

- **CPU（Central Processing Unit）**: 「コンピュータの脳」。1つのコアは、事務員が仕事を1件ずつ片付けるように、多様なタスクを *順番に* 処理する。現代の端末はマルチコアで、並列性はここから来る。
- **GPU（Graphics Processing Unit）**: 「単純なタスクを、多数のコアで同時に」処理するのが得意。元々は描画専用だったが、今は GPU アクセラレーテッドコンピューティング一般に使われる。

アプリケーションがこれらを使うときは、必ず **OS（Operating System）が提供する仕組み** を経由する。この「OS を経由する」という一点が、後のサンドボックスの前提になる。OS を経由するということは、OS が権限を絞れる、ということだからだ。

#### 1.2 プロセスとスレッド、そして IPC

原典の定義はシンプルである。

- **プロセス（process）**: 「アプリケーションの実行中のプログラム」。OS はプロセスごとに **専用のメモリ空間** を割り当て、アプリの状態はその私的な領域に保持される。
- **スレッド（thread）**: 「プロセスの中に住み、そのプロセスのプログラムの一部を実行するもの」。

ここが決定的に重要である。**プロセス A のメモリは、プロセス B からは直接読めない。** 読みたければ OS に仲介してもらうしかない。その仲介の仕組みが **IPC（Inter-Process Communication、プロセス間通信）** である。

> 用語補足: **IPC** とは、別々のメモリ空間を持つプロセス同士が、OS の提供するチャネル（パイプ、共有メモリ、ソケットなど）を通じてメッセージをやり取りする仕組み。Chrome では Mojo と呼ばれる IPC フレームワークが使われている（Mojo は原典の範囲外だが、現在の Chrome を読む上での必須語彙）。

IPC で分離されているおかげで、片方のワーカープロセスが応答不能になっても、他を巻き込まずに再起動できる ―― これが原典の言う「ある1つのワーカープロセスを、他を止めずに再起動できる」という利点である。

#### 1.3 Chrome のプロセス構成

原典が挙げる Chrome のプロセスは以下の通り。

| プロセス | 役割（原典の記述） |
| --- | --- |
| **Browser process（ブラウザプロセス）** | ブラウザの「クローム」部分（アドレスバー、ブックマーク、戻る/進むボタン）を制御する。加えて、**ネットワークリクエストやファイルアクセスといった「目に見えない特権部分」** も担当する |
| **Renderer process（レンダラプロセス）** | 「タブの中で Web サイトが表示される領域すべて」を制御する |
| **Plugin process** | Flash など、サイトが使うプラグインを制御する |
| **GPU process** | GPU のタスクを、他のプロセスから隔離して処理する |

このほか、拡張機能（Extension）プロセスやユーティリティプロセスも存在する。レンダラプロセスは複数同時に走り、**原則としてタブごとに1つ**、ただし端末のリソース状況に応じて Chrome が割り当てを調整する。

実際に目で確認できる。Chrome 右上のオプションメニュー → **その他のツール → タスク マネージャ** を開くと、現在動いているプロセスの一覧と、それぞれの CPU / メモリ使用量が表示される。脆弱性検証の際、「今、この iframe は別プロセスになっているか？」をまず確認する場所がここである。

#### 1.4 マルチプロセスにする理由 ―― 安定性と、セキュリティ

原典が挙げる利点は2つ。

**(1) 安定性と応答性**: あるタブが応答不能になっても、そのタブだけ閉じれば済む。シングルプロセスモデルなら、1タブのフリーズが全タブを道連れにする。

**(2) セキュリティとサンドボックス**: OS はプロセス単位で権限を制限できる。だから Chrome は、レンダラプロセスから特定の機能を取り上げることができる。原典の表現を引用する。

> 「the Chrome browser restricts arbitrary file access for processes that handle arbitrary user input like the renderer process.」
> （Chrome ブラウザは、レンダラプロセスのように *任意のユーザー入力* を扱うプロセスに対し、任意のファイルアクセスを制限する）

**これが脆弱性ハンターにとっての最重要文である。** 「レンダラプロセスは、攻撃者が制御しうる入力（＝あらゆる Web ページ）を処理する場所だから、はじめから信用されていない」。つまり、

- レンダラプロセス内で任意コード実行（RCE）を得ても、それは *まだ* 端末の侵害ではない。ファイルは読めない、ネットワークも勝手には出せない。
- 端末を取るには、**レンダラ RCE + サンドボックスエスケープ**（ブラウザプロセスや GPU プロセス、あるいは OS カーネルへの2段目のバグ）という **チェーン** が必要になる。Pwn2Own 等のフルチェーンが常に複数バグで構成されるのはこのためである。
- 逆に言えば、バグバウンティで「レンダラプロセス内で閉じる」種類のバグ（DOM XSS など）の評価額は、サンドボックス境界を越えるバグより低く見積もられるのが通例である。

**トレードオフはメモリ**。原典いわく「プロセスは自分専用のメモリ空間を持つため、共通基盤（Chrome の JavaScript エンジンである V8 など）のコピーを各プロセスが持つことが多い」。したがって Chrome は端末のハードウェアに応じて同時プロセス数に上限を設け、上限に達したら複数タブを1プロセスに相乗りさせる。**「タブ＝プロセス」は保証ではない**という点は、検証時に必ず意識すべきである。原典は、割り当て方針が「できる限りタブごとにプロセス」から「**できる限りサイトごとにプロセス（process-per-site）**」へ移っていると述べている。

#### 1.5 Servicification（サービス化）

Chrome は、ブラウザプログラムの各部分を「サービス」として切り出し、プロセスへの割り当てを動的に決めるアーキテクチャ改修（**Servicification**）を進めてきた。強力なハードウェアでは、Network Service、Storage Service などを **別プロセスに分割して安定性を上げ**、リソースの乏しい端末では **1プロセスに統合してメモリを節約する**。この「統合してメモリを節約する」手法は、もともと Android で使われていたものだ。

セキュリティ的には、**Network Service が別プロセスに切り出されたかどうか**で、ネットワークスタックのバグの到達範囲（＝どのプロセスが落ちるか、どのメモリが読めるか）が変わる。同じバグでも構成によって深刻度が変わる、という感覚を持っておきたい。

#### 1.6 Site Isolation と OOPIF ―― 同一オリジンポリシーをプロセス境界で担保する

第1部の山場である。原典を引用する。

> 「The Same Origin Policy is the core security model of the web; it makes sure one site cannot access data from other sites without consent.」
> （同一オリジンポリシーは Web の中核的なセキュリティモデルであり、あるサイトが他サイトのデータに、同意なくアクセスできないことを保証する）

問題は、Site Isolation 以前の Chrome では、`a.com` のページと、その中に埋め込まれた `b.com` の iframe が **同じレンダラプロセス・同じメモリ空間** で動きうる点にあった。同一オリジンポリシーは、あくまで **レンダラプロセス内のソフトウェア的なチェック** で実装されている。したがって、レンダラのバグ（型混乱、UAF など）でそのチェックを回避できれば、`a.com` から `b.com` のメモリ上のデータを読めてしまう。これが **UXSS（Universal XSS）** の本質である ―― 単一サイトの XSS ではなく、*オリジン分離そのものの破壊* だ。

**Site Isolation** は、この保証を **OS のプロセス境界** に押し上げる。原典の定義は「runs a separate renderer process for each cross-site iframe」（クロスサイトの iframe ごとに別々のレンダラプロセスを走らせる）。この「別プロセスになった iframe」を **OOPIF（Out-of-Process iframe、プロセス外 iframe）** と呼ぶ。

> 「With Meltdown and Spectre, it became even more apparent that we need to separate sites using processes.」

**Meltdown / Spectre（2018年1月公開）** は CPU の投機的実行に起因するサイドチャネル攻撃で、「同一プロセスのメモリ空間なら、本来読めないはずの領域も *タイミングを通じて* 読める」という性質を持つ。これはソフトウェア的な境界チェックでは防げない。**同じプロセスに置かない**ことが唯一の実効的な対策だった。

原典時点で、**デスクトップ版 Chrome は 67 から Site Isolation をデフォルト有効**にしている。

> （以下は原典刊行後の状況について、一般知識に基づく補足です）Android 版は端末メモリの制約からしばらく部分適用にとどまり、Chrome 77 以降でログイン等の機微なサイトに限定した Site Isolation、その後段階的に適用範囲が拡大されている。検証時は `chrome://process-internals/#site-isolation` で実際の適用状況を確認できる。

原典は実装の難しさにも触れている ―― プロセスをまたぐ iframe は相互通信の仕組みが変わり、DevTools は複数プロセスの情報を1つに見せるためにバックエンドを改修する必要があり、Ctrl+F のページ内検索すら複数レンダラプロセスにまたがって動かさねばならなかった。**「1つのタブが1つのプロセス」という素朴な前提の上に作られた機能は、すべて書き直しが必要になった**。脆弱性ハンターにとっては、この「書き直された境界越えの機能群」（フォーカス管理、印刷、フルスクリーン、ドラッグ&ドロップ、find-in-page）こそが、論理バグの温床になりやすい領域だと読める。

> 出典: Inside look at modern web browser (part 1) — https://developer.chrome.com/blog/inside-browser-part1

---

### 2. ナビゲーションで何が起きるか ―― ブラウザプロセスからレンダラプロセスへの受け渡し

#### 2.1 ブラウザプロセスの中のスレッド

第2部は、ブラウザプロセス内部のスレッド分割から始まる。

- **UI thread**: ボタン、入力欄、アドレスバーを描画する
- **network thread**: ネットワークスタックを通じてインターネットからデータを受け取る
- **storage thread**: ファイルアクセスとデータ永続化を制御する

以降の手順は、この3スレッド（＋レンダラプロセス）の間のメッセージ交換として理解する。

#### 2.2 ナビゲーションの各ステップ

**Step 1: 入力のハンドリング（handling input）**
ユーザーがアドレスバーに文字を打つと、UI スレッドはそれが **検索クエリなのか URL なのか** を判定し、検索エンジンに送るか、サイトへのリクエストにするかを決める。

> セキュリティ的含意: 「検索か URL か」の判定は Chrome の **omnibox** のヒューリスティックであり、`javascript:` スキームの貼り付け無効化や、紛らわしいホスト名（IDN ホモグラフ）の表示正規化など、**フィッシング/UI スプーフィング系の防御がここに集中している**。

**Step 2: ナビゲーションの開始（start navigation）**
Enter が押されると、UI スレッドが network スレッドにネットワーク呼び出しを依頼し、**DNS ルックアップ**と、HTTPS なら **TLS ハンドシェイク** が行われる。この間、タブにはローディングスピナーが表示される。

**Step 3: レスポンスの読み取り（read response）**
レスポンスヘッダが返ってくると、network スレッドはまず `Content-Type` を見る。原典の記述：

> 「The response's Content-Type header should say what type of data it is, but since it may be missing or wrong, MIME Type sniffing is done here.」
> （レスポンスの Content-Type ヘッダがデータの種別を示すはずだが、欠けていたり間違っていたりすることがあるため、ここで MIME Type sniffing が行われる）

> **これはクライアントサイド脆弱性の古典的な温床である。** `Content-Type` が欠落している、あるいは `text/plain` なのに中身が HTML である場合、ブラウザが「気を利かせて」HTML として解釈してしまうと、ファイルアップロード機能や API レスポンスが **そのまま XSS の実行面** になる。防御側の結論は一つ ―― **`X-Content-Type-Options: nosniff` を全レスポンスに付け、`Content-Type` を正しく明示する**。加えて、ユーザー由来コンテンツは別ドメイン（サンドボックスドメイン）から配信し、`Content-Disposition: attachment` を併用する。

**Step 4: セキュリティチェック**
ここで2つの検査が走る。

> 「This is also where the SafeBrowsing check happens. If the domain and the response data seems to match a known malicious site, then the network thread alerts to display a warning page.」

- **SafeBrowsing**: ドメインとレスポンスデータを既知の悪性サイトのリストと照合し、一致すれば警告ページを表示するよう network スレッドが通知する。
- **CORB（Cross Origin Read Blocking）**:

> 「Cross Origin Read Blocking (CORB) check happens in order to make sure sensitive cross-site data does not make it to the renderer process.」
> （機微なクロスサイトデータがレンダラプロセスに *到達しない* ことを保証するために、CORB チェックが行われる）

**CORB の設計思想を正確に理解しておきたい。** 同一オリジンポリシーは「読んだデータを JavaScript から取り出せない」ことを保証するが、Spectre のようなサイドチャネルの世界では「**レンダラのメモリ空間に入ってしまった時点で負け**」である。そこで CORB は、たとえば `<img src="https://bank.example/api/balance.json">` のようにクロスオリジンで取得された「明らかに画像ではない機微なリソース（HTML/XML/JSON）」を、**レンダラに渡す前に network 側でブロック**する。判定には `Content-Type` と、`nosniff` の有無、そして内容のスニッフィングが使われる。ここでも `nosniff` と正しい `Content-Type` が、CORB を確実に効かせる鍵になる。

> （以下は補足として一般知識に基づく解説です）CORB は後継の **ORB（Opaque Response Blocking / Cross-Origin Resource Blocking）** に置き換えが進められている。ORB は「JSON か HTML か」という型ベースの判定から、「**このリクエストの destination（画像・スクリプト・メディア等）として妥当なレスポンスか**」という観点に一般化したもので、ブロック対象が広がる。さらにアプリケーション側からは **CORP（`Cross-Origin-Resource-Policy`）** ヘッダで「自分は同一オリジン/同一サイトからしか埋め込ませない」と宣言でき、COOP/COEP と組み合わせて **クロスオリジン分離（cross-origin isolated）** 状態を作ることで、`SharedArrayBuffer` のような高精度タイマー系 API を安全に使えるようにする、という体系になっている。

**Step 5: レンダラプロセスを探す（find a renderer process）**
すべてのチェックを通過し「これは HTML だ」と確定すると、network スレッドは UI スレッドにデータの準備完了を伝える。UI スレッドはレンダラプロセスを見つける、または新規に起動する。**最適化として、ネットワークリクエストを投げるのと並行して、UI スレッドは投機的にレンダラプロセスを起動しておく**。ただしリダイレクトで別サイトに飛ばされると、起動しておいたプロセスは使えず、別のプロセスが必要になる。

**Step 6: ナビゲーションのコミット（commit navigation）**

> 「Now that the data and the renderer process is ready, an IPC is sent from the browser process to the renderer process to commit the navigation. It also passes on the data stream so the renderer process can keep receiving HTML data.」
> （データとレンダラプロセスが揃ったので、ナビゲーションをコミットするための IPC がブラウザプロセスからレンダラプロセスへ送られる。同時に **データストリーム** も引き渡され、レンダラプロセスは HTML データを受け取り続けられるようになる）

ブラウザプロセスはレンダラから「コミットした」という確認を受け取り、そこで初めて **ナビゲーションが完了**する。このタイミングで、

- **アドレスバーの表示が更新される**
- セキュリティインジケータ（鍵アイコン等）とサイト設定 UI が、新しいページのものに更新される
- **セッション履歴（戻る/進む）にエントリが記録される**

> セキュリティ的含意: **アドレスバー・スプーフィング** の脆弱性は、まさにこの「URL 表示の更新」と「実際にレンダリングされている内容」のタイミングがずれる隙間に生じる。たとえば、コミット前にレンダラ側が別の描画を始める、あるいはコミット後に旧ページが `history` API で URL だけ書き換える、といった状態遷移の穴である。ハントするなら、遅いレスポンス・リダイレクトチェーン・`window.open` + `document.write` の組み合わせなど、**「コミット前後の中間状態を引き延ばせる操作」** を探す。

**Step 7: 初期読み込みの完了**
レンダラプロセスがリソースを読み終え `onload` を発火すると（サブフレームを含むすべてのフレームで）、IPC でブラウザプロセスに通知し、UI スレッドはスピナーを止める。**ここで「完了」なのは *初期読み込み* だけで、以降 JavaScript が追加リソースを読み込み続け、新しいビューを描画してよい**。

#### 2.3 別サイトへのナビゲーション ―― beforeunload と unload

> 「When the new navigation is made to a different site than currently rendered one, a separate render process is called in to handle the new navigation while current render process is kept around to handle events like `unload`.」
> （現在表示中のサイトとは *別サイト* へのナビゲーションが行われると、新しいナビゲーションを処理するために別のレンダラプロセスが呼ばれ、一方で現在のレンダラプロセスは `unload` のようなイベントを処理するために残される）

つまり **移行中の一瞬、2つのレンダラプロセスが同時に生きている**。加えて、ナビゲーション開始の前に、ブラウザプロセスは現在のレンダラに `beforeunload` ハンドラの有無を問い合わせる。原典の警告：

> 「**Caution:** Do not add unconditional `beforeunload` handlers. It creates more latency because the handler needs to be executed before the navigation can even be started.」
> （無条件の `beforeunload` ハンドラを追加してはならない。ナビゲーションを開始することすらできる前にハンドラを実行する必要があるため、余計なレイテンシを生む）

```js
// 悪い例: ナビゲーションのたびに必ずレンダラへの往復が発生し、
// ページ離脱が常に1ラウンドトリップ分遅くなる
window.addEventListener('beforeunload', (e) => {
  e.preventDefault();
  e.returnValue = '';
});

// 良い例: 「本当に失うデータがあるときだけ」登録する
let dirty = false;
form.addEventListener('input', () => { dirty = true; });
window.addEventListener('beforeunload', (e) => {
  if (!dirty) return;           // 未編集なら何もしない = ダイアログも出ない
  e.preventDefault();
  e.returnValue = '';
});
```

「なぜそうなるのか」: ナビゲーションは **ブラウザプロセス主導** だが、`beforeunload` は **レンダラプロセス内の JavaScript** である。ブラウザプロセスは自分でその中身を知り得ないので、必ず IPC でレンダラに問い合わせ、返事を待つ。ハンドラが登録されているだけでこの往復が必須になる ―― プロセス分離のコストが、そのまま API のコストとして現れている例である。

> UX 攻撃の観点: `beforeunload` ダイアログは、ユーザーの離脱を妨げる「ページ離脱阻止」の道具にも使われてきた。そのためブラウザ側は、**ユーザーがそのページと実際にインタラクションしていない場合はダイアログを出さない**（user activation の要求）という緩和を導入している。防御実装としては、自前の確認 UI ではなく標準の `beforeunload` を条件付きで使うのが素直である。

#### 2.4 Service Worker が絡む場合

> 「When a navigation happens, network thread checks the domain against registered service worker scopes, if a service worker is registered for that URL, the UI thread finds a renderer process in order to execute the service worker code.」

Service Worker は「ネットワークプロキシをページ側に持ってくる」仕組みなので、**ナビゲーションの経路そのものが変わる**。network スレッドはまず登録済みの **スコープ（scope）** と URL を照合し、該当すれば UI スレッドがレンダラプロセスを用意して Service Worker のコードを実行する。Service Worker がキャッシュから応答すれば、**ネットワークリクエストは一切発生しない**（cache-first 戦略）。

ただしこの「まず Service Worker を起こす」手順は、起動コストの分だけ遅くなる。そこで **Navigation Preload** がある。

> 「It marks these requests with a header, allowing servers to decide to send different content for these requests; for example, just updated data instead of a full document.」

Service Worker の起動と **並行して** ネットワークリクエストを先行発行し、そのリクエストには専用ヘッダ（`Service-Worker-Navigation-Preload`）が付くので、サーバー側は「これはプリロードだ」と判別して、完全な文書ではなく更新差分だけを返す、といった最適化ができる。

> **脆弱性ハンターにとっての Service Worker**: Service Worker はオリジン単位で永続化し、`fetch` イベントで **同一スコープ配下の全リクエストを書き換えられる**。したがって、任意のオリジンに任意の JS ファイルをアップロードできて、かつそれが `text/javascript` として同一オリジンから配信される状況では、`navigator.serviceWorker.register()` が成立し、**サイト全体を恒久的に乗っ取る**ことにつながりうる。防御側の要点は、(1) ユーザーアップロードを別オリジンに置く、(2) `Service-Worker-Allowed` ヘッダを安易に広げない、(3) Service Worker スクリプトの配信パスを厳格に固定する、(4) CSP の `script-src` / `worker-src` を絞る、である。なお本書の方針に従い、実在サービスへの無許可の検証は行わない。

> 出典: Inside look at modern web browser (part 2) — https://developer.chrome.com/blog/inside-browser-part2

---

### 3. レンダラプロセスの内部 ―― parse → style → layout → paint → composite

#### 3.1 レンダラプロセス内のスレッド

レンダラプロセスは「タブの中で起きるすべて」を担当する。その責務は、**HTML・CSS・JavaScript を、ユーザーが操作できる Web ページに変換すること**である。内部には次のスレッドがある。

- **メインスレッド（main thread）**: ユーザーに送られてくるコードの大半を処理する。DOM 構築、スタイル計算、レイアウト、ペイント記録、そして **JavaScript の実行**。
- **ワーカースレッド（worker threads）**: Web Worker / Service Worker の JavaScript を実行する。
- **コンポジタスレッド（compositor thread）**: ページを効率よく滑らかに描画する。
- **ラスタスレッド（raster threads）**: 描画情報を実際のピクセルに変換する。

**「メインスレッドが1本しかない」という事実が、ページのあらゆる性能問題とタイミング系の挙動の根源である。** DOM 操作も JS も、すべてこの1本を取り合う。

#### 3.2 Parsing ―― DOM 構築

メインスレッドは HTML テキストを **DOM（Document Object Model）** に変換する。DOM は、ブラウザ内部のページ表現であると同時に、開発者が JavaScript からアクセスするデータ構造/API でもある。変換規則は **HTML Standard** が定めており、**壊れた（不正な）マークアップに対する寛容なエラー回復**まで仕様として規定されている ―― 「`<p>` を閉じ忘れてもエラーにならない」のは、仕様がそう書いてあるからだ。

> **これが mXSS（mutation XSS）の土壌である。** サニタイザが「この文字列は安全だ」と判断した *文字列* と、HTML パーサが実際に構築する *DOM ツリー* が一致するとは限らない。`<template>`、`<svg>` / `<math>`（foreign content）、`<noscript>`、テーブル内のコンテンツ移動（foster parenting）といった箇所では、パーサが要素を **移動・再解釈** する。サニタイズ後に `innerHTML` で再シリアライズ→再パースが起きると、無害だった文字列がスクリプト実行可能な木に「変異」しうる。防御の原則は、**文字列を経由せず DOM を直接扱う**（`textContent`、`setAttribute` の値としての扱い）か、**ブラウザ内蔵の HTML Sanitizer API / Trusted Types を使う**こと。自前の正規表現サニタイザは、パーサと同じ仕様を実装していない限り必ず負ける。

#### 3.3 サブリソースの読み込みと preload scanner

ページは画像・CSS・JS を伴う。これらを HTML パーサが出会った順に直列で読むのでは遅すぎるので、**preload scanner（プリロードスキャナ）** が **HTML のパースと並行して** 生の HTML を先読みし、`<img>` や `<link>` を見つけて network スレッドに先行取得を依頼する。

> 攻撃面の視点: preload scanner は「まだ DOM になっていないバイト列」を投機的に解釈する。この性質は **dangling markup injection**（属性値の引用符を閉じずに注入し、後続の HTML を丸ごと属性値に飲み込ませて外部へ送信させる手法）が成立する背景の一つである。防御は、注入点で `"` `'` `<` を必ずエスケープすることに加え、CSP の `img-src` / `form-action` / `base-uri` を絞って外部への送出口を塞ぐこと。

#### 3.4 なぜ `<script>` はパースを止めるのか

HTML パーサは `<script>` タグに出会うと **パースを中断し、スクリプトの実行を待つ**。原典の理由付けはこうである ―― 「JavaScript は `document.write()` のようなもので **ドキュメントの形そのものを変えられる** から」。

```html
<p>before</p>
<script>
  // パーサが「今どこを読んでいるか」に、このテキストが挿入される。
  // だからパーサは、このスクリプトが終わるまで先へ進めない。
  document.write('<p>inserted right here</p>');
</script>
<p>after</p>
```

**原理**: HTML パースは「入力ストリームを読みながら木を作る」ストリーミング処理である。`document.write()` は **その入力ストリームに直接テキストを挿し込む** API なので、スクリプト実行の結果が、その後にパースされる内容を変えてしまう。したがってパーサは、スクリプトの実行が終わるまで自分の状態を確定できない。「同期スクリプトがパーサをブロックする」のは、実装の手抜きではなく **仕様上の必然** である。

回避のためのヒント（原典が挙げるもの）：

```html
<!-- async: 取得と実行を非同期に。取得完了次第、パースを中断して即実行される。
     実行順序は保証されない。互いに独立した計測用スクリプト等に向く -->
<script async src="analytics.js"></script>

<!-- defer: 取得は並行、実行は HTML パース完了後（DOMContentLoaded の直前）。
     文書順の実行順序が保証される。DOM に依存するアプリコードに向く -->
<script defer src="app.js"></script>

<!-- JS モジュール: type="module" は既定で defer 相当の振る舞い -->
<script type="module" src="app.mjs"></script>

<!-- preload: 「このリソースは絶対に必要だから先に取ってくれ」というヒント。
     取得するだけで実行はしない -->
<link rel="preload" as="font" href="font.woff2" crossorigin>
```

> セキュリティ的含意: `async` / `defer` は **実行タイミングと順序** を変える。CSP の nonce ベース許可や、初期化順序に依存した「安全のための上書き」（例: 危険な関数をラップする防御コードを先に走らせる）が、`async` を付けた瞬間に順序保証を失って無効化される、という事故が起きうる。防御コードは `async` にしてはならない。

#### 3.5 Style（スタイル計算）

メインスレッドは CSS をパースし、セレクタのマッチング結果から **各 DOM ノードの computed style（算出スタイル）** を決める。DevTools の Elements → Computed で見えるものがこれである。開発者が CSS を1行も書かなくても、ブラウザは既定スタイルシートを適用しており、Chrome の既定値は Chromium のソースで確認できる。

#### 3.6 Layout（レイアウト）

スタイルが決まっても、**画面上のどこに、どんな大きさで置かれるか** はまだ分からない。これを決めるのが Layout で、メインスレッドは DOM ツリーと算出スタイルを突き合わせ、**レイアウトツリー（layout tree）** を作る。レイアウトツリーの各ノードは、x/y 座標とバウンディングボックスのサイズを持つ。

原典が強調する、DOM ツリーとの重要な差異：

- **`display: none` の要素はレイアウトツリーに含まれない**（場所を取らないので座標を持たない）
- **`visibility: hidden` の要素は含まれる**（見えないが場所は取る）
- **DOM には存在しない擬似要素が含まれる**。例: `p::before { content: "Hi!" }` で生成されたテキストは、レイアウトツリーには存在するが DOM ツリーには存在しない

```css
/* このテキストは画面に出るが、document.querySelector('p').textContent には現れない */
p::before { content: "Hi!"; }
```

> **ここは情報漏洩サイドチャネルの温床である。** 「DOM に無いのにレイアウトには影響する」「見えないのに場所は取る」という非対称性は、*測定* を通じた情報取得に使える。典型例が **CSS injection による属性値の窃取**（属性セレクタで1文字ずつ一致を判定し、一致したときだけ背景画像を読みに行かせる）や、**`:visited` を用いた履歴スニッフィング**（訪問済みリンクのスタイルがレイアウト/ペイントに与える差を測る）である。ブラウザ側は `:visited` に対して `getComputedStyle` を嘘の値で返す、適用可能なプロパティを色系に限定する、といった緩和を長年積み重ねてきた。アプリ側の防御は、**CSS を注入させないこと**（スタイル属性・`<style>` への未検証入力の混入を断つ）と、**CSP の `style-src` を絞ること** に尽きる。

レイアウトは、原典が言う通り「非常に難しい」工程である ―― フォントサイズ、改行位置、float、overflow によるマスク、書字方向（縦書きや RTL）まで考慮する必要がある。

#### 3.7 Paint（ペイント）

次に必要なのは **描く順序** である。メインスレッドはレイアウトツリーを走査して **ペイントレコード（paint record）** ―― 「まず背景、次にテキスト、次に矩形」といった、描画操作の順序付きリスト ―― を生成する。

順序が重要なのは、**HTML のマークアップ順にそのまま描くと結果が間違う**からだ。`z-index` などのプロパティが重なり順を変える以上、パーサが読んだ順序 ≠ 描く順序である。

> クライアントサイドの観点: `z-index`、`opacity`、`pointer-events`、`transform` の組み合わせで「見えているものと、クリックを受け取るもの」を分離できる ―― これが **クリックジャッキング / UI redressing** の技術的な基盤である。防御は `X-Frame-Options` ではなく現行の **CSP `frame-ancestors`** で埋め込みを制限すること、重要な操作には user activation を要求することである。

#### 3.8 パイプライン更新はなぜ高価なのか

パイプラインの各段は **直前の段の出力を入力にする**。そのため、レイアウトツリーが変われば、影響範囲のペイント順序を作り直さなければならない。

```
DOM ──▶ Style ──▶ Layout ──▶ Paint ──▶ Raster ──▶ Composite
       ↑ 幾何に関わる変更（width/top/font-size など）は Layout から全部やり直し
                    ↑ 色や背景だけの変更は Paint から
                              ↑ transform / opacity だけの変更は Composite だけで済む
```

ほとんどのディスプレイは **60 fps**（1秒間に60コマ）でリフレッシュされるので、アニメーションを滑らかに見せるには **1フレームあたり約16.6ミリ秒以内** にこの更新を終える必要がある。間に合わずフレームを落とすと、ユーザーには「**jank（ジャンク、カクつき）**」として知覚される。

さらに厄介なのは、**JavaScript もメインスレッドで動く**ことだ。長い JS があると、その間レンダリング更新が始められず、アニメーションが止まる。原典が挙げる対策：

```js
// 対策1: requestAnimationFrame() —— 重い処理を細切れにして、各フレームの
// 描画直前のタイミングに小分けで載せる。メインスレッドを長時間占有しない。
function chunk(items, i = 0) {
  const deadline = performance.now() + 5;   // 1フレーム16.6msのうち5msだけ使う
  while (i < items.length && performance.now() < deadline) {
    process(items[i++]);
  }
  if (i < items.length) requestAnimationFrame(() => chunk(items, i));
}

// 対策2: Web Worker —— そもそもメインスレッドから追い出す
const w = new Worker('heavy.js');
w.postMessage(data);
w.onmessage = (e) => render(e.data);
```

> タイミング攻撃の観点: `requestAnimationFrame` はフレーム境界に同期した **高精度に近いクロック** として働く。`performance.now()` の解像度が Spectre 対策で意図的に粗くされ（クロスオリジン分離されていない文脈では 100µs 程度に丸められる）た後も、rAF のフレームカウントや「レンダリングが何フレーム遅れたか」を数えることで、**クロスオリジンなコンテンツのレイアウト/描画コストを推測する** 手口（XS-Leaks の一種）が研究されている。防御側は、機微なレスポンスに対して `Cross-Origin-Resource-Policy`、`Cross-Origin-Opener-Policy`、`SameSite=Lax/Strict` クッキー、`Fetch Metadata`（`Sec-Fetch-Site` 等）による **クロスサイト読み込みの遮断** を重ねるのが基本戦略になる。

#### 3.9 Compositing（合成）―― メインスレッドから独立させる

素朴に実装するなら「ビューポートに見えている部分だけをラスタライズし、スクロールしたら足りない分を描き足す」という方法もある。Chrome の初期はそうだった。しかしこれでは、スクロールのたびにラスタライズが追いつかず jank が出る。

現代の手法が **コンポジティング（compositing、合成）** である ―― **ページを複数のレイヤーに分け、それぞれ別々にラスタライズし、最後にコンポジタスレッドで合成する**。こうすると、スクロール時は「すでにラスタライズ済みのレイヤーを、位置だけずらして新しいフレームとして合成する」だけで済み、**再描画が不要**になる。

**レイヤーツリー（layer tree）**: メインスレッドがレイアウトツリーを走査して作る。DevTools の **Layers パネル** で、ページがどうレイヤーに分割されたかを可視化できる。どこをレイヤーにすべきかブラウザが判断できない場合、開発者は CSS の **`will-change`** でヒントを与えられる。

```css
/* 「この要素は transform が変化する」と事前に伝える。
   ブラウザは専用レイヤーを用意し、変化時に Layout/Paint を省略できる */
.card { will-change: transform; }
```

> **注意（原典が明示している罠）**: レイヤーを増やせば速くなる、ではない。**レイヤーが多すぎると、フレームごとにページの小領域をラスタライズするより遅くなる**。`will-change` を全要素に付けるのは典型的なアンチパターンで、GPU メモリを食い潰す。必ず計測すること。

**ラスタライズと合成（メインスレッドの外で）**: レイヤーツリーとペイント順序が確定すると、メインスレッドはそれをコンポジタスレッドに **commit** する。以降はメインスレッドの出番はない。

1. コンポジタスレッドは、各レイヤーを **タイル（tiles）** に分割する
2. タイルを **ラスタスレッド群** に配る。ラスタスレッドは各タイルをビットマップ化し、**GPU メモリに格納する**
3. コンポジタは、ビューポートに近いタイルを優先してラスタライズし、ズームに備えて **複数解像度のタイリング** を保持する
4. ラスタライズが済むと、コンポジタスレッドは **draw quad（ドロークアッド）** を集める。draw quad は「そのタイルがメモリのどこにあるか」「ページのどこに、どう描くか」という情報を持つ
5. draw quad を集めたものが **コンポジタフレーム（compositor frame）** ―― ページ1フレーム分の表現である
6. コンポジタフレームは **IPC でブラウザプロセスに提出** され、UI スレッド（ブラウザ UI）や拡張機能の別のコンポジタフレームと合流し、**GPU に送られて画面に表示される**

**なぜこれが重要か**: 原典の結論はこうである ―― **合成（compositing）はメインスレッドから独立して行える**。コンポジタスレッドはスタイル計算も JavaScript 実行も必要としない。だから、

> **「compositing only animations」（合成だけで済むアニメーション）が最も高性能である。メインスレッドは待つ必要がない。**

```css
/* 良い: transform / opacity のみ → Composite だけで完結し、
   メインスレッドが JS で詰まっていてもアニメーションは滑らかに続く */
.good { transition: transform .3s, opacity .3s; }

/* 悪い: left / width は Layout からやり直し → メインスレッドを毎フレーム叩く */
.bad  { transition: left .3s, width .3s; }
```

逆にレイアウトやペイントの再計算が必要になると、**メインスレッドが巻き込まれ、この利点は失われる**。

> 出典: Inside look at modern web browser (part 3) — https://developer.chrome.com/blog/inside-browser-part3

---

### 4. まとめ ―― この地図をどう使うか

本節の内容を、クライアントサイド脆弱性ハンティングの「地図」として整理しておく。

| 境界 | 何が守られているか | 破れたときに何と呼ばれるか |
| --- | --- | --- |
| OS プロセス境界（ブラウザ ↔ レンダラ） | レンダラは任意のファイルアクセス不可 | **サンドボックスエスケープ** |
| OS プロセス境界（レンダラ ↔ レンダラ、Site Isolation / OOPIF） | クロスサイトのデータが同一メモリ空間に同居しない | **UXSS**、Spectre 系サイドチャネル |
| network スレッドでの CORB / ORB | 機微なクロスサイトデータがレンダラに *到達しない* | クロスオリジン情報漏洩 |
| レンダラ内のオリジンチェック（SOP） | JS から他オリジンの DOM / レスポンスを読めない | **XSS / CSRF / XS-Leaks** |
| HTML パーサとサニタイザの一致 | 文字列と DOM 木の解釈が一致する | **mXSS** |
| commit navigation とアドレスバー更新 | 表示 URL と実コンテンツが一致する | **アドレスバースプーフィング** |
| ペイント順序と入力ヒットテスト | 見えているものがクリックを受ける | **クリックジャッキング** |

そして、防御実装者としての最小セット（本節の各所で導出したもの）：

1. すべてのレスポンスに正しい `Content-Type` と `X-Content-Type-Options: nosniff` を付ける（MIME sniffing と CORB/ORB の前提）
2. ユーザー生成コンテンツは別オリジンから配信する（Site Isolation を味方につける／Service Worker 登録を防ぐ）
3. `Content-Security-Policy` で `script-src`（nonce/hash）、`frame-ancestors`、`base-uri`、`form-action`、`style-src` を絞る
4. HTML を組み立てるときは文字列連結をやめ、Trusted Types / Sanitizer API か DOM API を使う
5. 機微なエンドポイントには `Cross-Origin-Resource-Policy`、`Cross-Origin-Opener-Policy`、`SameSite` クッキー、Fetch Metadata による検証を重ねる
6. `beforeunload` は条件付きでのみ登録し、`will-change` は計測に基づいて最小限に使う

> **最後に、陳腐化への注意**: 原典3本は 2018年時点の Chromium の姿である。その後、Chrome のレンダリング基盤は **RenderingNG**（2021年に公開されたアーキテクチャ刷新。LayoutNG、CompositeAfterPaint、Viz による表示合成の一元化などを含む）へと大きく作り替えられ、CORB は ORB へ、Site Isolation は Android へも拡大している。**パイプラインの各段が何をしているか**という本節の骨格は今も有効だが、**個々の実装の細部と、各機能がいつからデフォルトになったか**は、検証時に必ず対象のブラウザバージョンで確認すること。Chrome なら `chrome://version`、`chrome://process-internals`、`chrome://gpu`、DevTools の Performance / Layers パネルが一次情報源になる。
