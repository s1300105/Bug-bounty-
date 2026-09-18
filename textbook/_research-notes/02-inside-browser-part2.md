# [02] Inside look at modern web browser (part 2) — ナビゲーションで何が起きるか

原題: **Inside look at modern web browser (part 2)** / 副題(description): "Learn how browser handles navigation request."
著者: kosamari (Mariko Kosaka) / 公開: 2018-09-07 / 更新: 2018-09-21
全4回シリーズの第2回（part1 = プロセス/スレッド構成、part3 = レンダラプロセスの内部、part4 = コンポジタ）。

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://developer.chrome.com/blog/inside-browser-part2 | full（本文は逐語で完全取得） | WebFetch と curl は egress proxy に **403 CONNECT denied（組織のegressポリシーで developer.chrome.com 自体がブロック）**。代替として同サイトの公式ソースリポジトリから記事の**原稿Markdownを直接取得**: `https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part2/index.md`（HTTP 200 / 15,119 bytes / 309行） | 本文・見出し・図キャプション・Aside（注意書き）・リンク先URL・front matter を**すべて逐語で保有**。ただし **12点の図（PNG画像そのもの）は未取得**（キャプションのみ逐語で再現）。web.archive.org / developers.google.com / web.dev / r.jina.ai も同proxyで403のため使用不可 |
| （補助）https://raw.githubusercontent.com/chromium/chromium/main/net/base/mime_sniffer.cc | full | curl（HTTP 200 / 33,309 bytes） | 原文が「the source code」としてリンクしている MIME sniffing 実装。原文リンクは `https://cs.chromium.org/chromium/src/net/base/mime_sniffer.cc?sq=package:chromium&dr=CS&l=5`（cs.chromium.org は現 source.chromium.org）。冒頭コメントの「ブラウザ別挙動サーベイ」を逐語で採録 |
| （補助）https://raw.githubusercontent.com/chromium/chromium/main/net/base/mime_sniffer.h | full | curl | `kMaxBytesToSniff` 等の定数と「MIME sniffer を拡張するな」という公式警告を逐語採録 |
| （参考・未取得）https://www.chromium.org/Home/chromium-security/corb-for-developers | failed | curl（接続不能 / 000） | CORB の詳細は担当外URL。読みどころは末尾「## 読者が自分で開くべき資料」に記載。**→ 第2パス追記**: 原因は egress proxy の CONNECT 403 と判明（ページ自体は依然未取得）。**内容は Chromium ソースツリー公式の CORB explainer で代替取得済み（本ノート「補足資料B」）。後継の ORB は「補足資料C」** |
| （第2パス・代替一次情報）https://raw.githubusercontent.com/chromium/chromium/main/services/network/cross_origin_read_blocking_explainer.md ほか計9本 | full | curl（HTTP 200） | CORB explainer / ORB 提案 / Chromium の navigation・navigation_concepts・process_model・render_document docs / Service Worker 仕様ソース / Fetch 仕様ソース。詳細は末尾「# 補完パス（第2パス）」の取得ログ表を参照 |

## 要約

- 本稿は「URLをアドレスバーに入力してからページのレンダリング準備が整うまで」＝**ナビゲーション**の全工程を、プロセス／スレッド間のIPCの流れとして解説する。
- 主役は**ブラウザプロセス**の中の **UIスレッド**（ボタンや入力欄を描画）、**networkスレッド**（ネットワークスタック）、**storageスレッド**（ファイルアクセス）。タブの外側はすべてブラウザプロセスが扱う。
- 工程は5段階＋1: ①入力の解釈（検索クエリかURLか）→②ナビゲーション開始（DNS lookup、TLS接続確立、HTTP 301等のリダイレクトはnetworkスレッド→UIスレッドに通知して再要求）→③レスポンス読み取り（**先頭数バイトを見る MIME Type sniffing**、**SafeBrowsing**、**CORB**、HTMLならレンダラへ・zip等ならダウンロードマネージャへ）→④レンダラプロセスの確保（**ネットワーク要求と並行して投機的に起動**しておく最適化。クロスサイトリダイレクトで無駄になることもある）→⑤**コミット**（IPCでレンダラに通知し、データストリームも渡す。コミット確認をもって navigation 完了、document loading フェーズ開始。アドレスバー・セキュリティ表示・サイト設定UI・セッション履歴が更新され、履歴はディスクに保存）→Extra: 全フレームの `onload` 完了後にレンダラ→ブラウザへIPC、ローディングスピナー停止。
- 別サイトへ移動するときは、まず現在のレンダラプロセスに **`beforeunload`** ハンドラの有無を問い合わせる必要がある（JSはレンダラ側にしか無いため）。**無条件の `beforeunload` は遅延を生むので付けるな**と明確に警告している。レンダラ起点のナビゲーション（リンククリック、`window.location = "https://newsite.com"`）でも同様に、まずレンダラが `beforeunload` を確認する。
- 異なるサイトへ遷移する場合は**新しいレンダラプロセスが別に立ち上がり、旧レンダラは `unload` 等のイベント処理のために生かされたまま**になる。
- **Service Worker** はナビゲーションに介入する。SW登録時にその**スコープ**が参照として保持され、ナビゲーション時に networkスレッドがドメイン／URLを登録済みスコープと照合し、該当すればUIスレッドがSWコードを実行するためのレンダラプロセスを確保する。SWはキャッシュから返すこともネットワークに取りに行くこともできる。
- SWが結局ネットワークへ行く場合、ブラウザプロセス↔レンダラプロセスの往復が遅延になる。これを**SW起動と並行してリソース取得を走らせる**仕組みが **Navigation Preload**。preload要求には**ヘッダが付与され**、サーバ側はこの要求に対して別のコンテンツ（例: 完全なドキュメントではなく更新分データのみ）を返す判断ができる。

## 詳細ノート

### What happens in navigation（ナビゲーションで何が起きるか） （出典: https://developer.chrome.com/blog/inside-browser-part2）

本稿は Chrome の内部構造を扱う4部シリーズの第2回。第1回ではブラウザの各部分を異なるプロセスとスレッドがどう分担するかを見た。第2回では、**ウェブサイトを表示するために各プロセス・スレッドがどう通信するか**をより深く掘る。

題材は「ブラウザにURLを打ち込む → ブラウザがインターネットからデータを取得する → ページを表示する」という単純なウェブ閲覧のユースケース。本稿が焦点を当てるのは、**ユーザーがサイトを要求し、ブラウザがページのレンダリング準備をする部分＝ナビゲーション（navigation）** である。

逐語引用:
> In this post, we’ll focus on the part where a user requests a site and the browser prepares to render a page - also known as a navigation.

〔補足（一般知識）〕クライアントサイド脆弱性ハンティングの文脈では、この「ナビゲーション」という語の切り出し方が重要になる。ナビゲーションはブラウザプロセス（特権側）が主導し、レンダラ（サンドボックス側、＝攻撃者制御下に置かれうる側）は要求元・被通知者にすぎない。オリジン決定・アドレスバー表示・セキュリティインジケータはブラウザプロセス側の責務であり、ここがレンダラの主張を過信すると URL spoofing やサイト分離のバイパスになる。

### It starts with a browser process（すべてはブラウザプロセスから始まる） （出典: 同上）

part 1（"CPU, GPU, Memory, and multi-process architecture"）で扱ったとおり、**タブの外側で起きることはすべてブラウザプロセスが扱う**。ブラウザプロセスは次のようなスレッドを持つ。

| スレッド | 原文の説明（逐語） | 役割（日本語） |
|---|---|---|
| UI thread | "the UI thread which draws buttons and input fields of the browser" | ブラウザのボタン類・入力フィールドを描画する。アドレスバーへの入力を最初に処理する |
| network thread | "the network thread which deals with network stack to receive data from the internet" | ネットワークスタックを扱い、インターネットからデータを受け取る |
| storage thread | "the storage thread that controls access to the files" | ファイルへのアクセスを制御する |
| （その他） | "and more" | 上記以外にも存在する |

**アドレスバーにURLを入力すると、その入力はブラウザプロセスのUIスレッドが処理する。**

図キャプション（逐語）:
> Figure 1: Browser UI at the top, diagram of the browser process with UI, network, and storage thread inside at the bottom

### A simple navigation / Step 1: Handling input（入力の処理） （出典: 同上）

ユーザーがアドレスバーに入力を始めると、UIスレッドが最初に問うのは **"Is this a search query or URL?"**（これは検索クエリか、それともURLか？）である。Chrome のアドレスバーは検索入力フィールドも兼ねているため、UIスレッドは入力をパースして、**検索エンジンへ送るのか、要求されたサイトへ送るのか**を判断しなければならない。

図キャプション（逐語）:
> Figure 1: UI Thread asking if the input is a search query or a URL

（※原文では図番号「Figure 1」が2回現れる。原稿ママ。）

〔補足（一般知識）〕この「クエリかURLか」の曖昧性は omnibox のパース差異として実際のバグ源になる。スキーム省略、`javascript:` や `data:` のような危険スキームの貼り付け、Unicode/IDN（punycode）による見た目の同一化、`@` を含むURLのオーソリティ解釈などが典型的な検証ポイント。

### Step 2: Start navigation（ナビゲーション開始） （出典: 同上）

ユーザーが Enter を押すと、**UIスレッドがサイトコンテンツを取得するためのネットワーク呼び出しを開始**する。タブの隅に**ローディングスピナー**が表示され、**networkスレッドは DNS lookup や、その要求のための TLS 接続確立といった適切なプロトコル処理を行う**。

図キャプション（逐語）:
> Figure 2: the UI thread talking to the network thread to navigate to mysite.com

この時点で、networkスレッドは **HTTP 301 のようなサーバリダイレクトヘッダ**を受け取ることがある。その場合、**networkスレッドはUIスレッドに「サーバがリダイレクトを要求している」と伝え、改めて別のURL要求が開始される**。

逐語引用:
> At this point, the network thread may receive a server redirect header like HTTP 301. In that case, the network thread communicates with UI thread that the server is requesting redirect. Then, another URL request will be initiated.

〔補足（一般知識）〕リダイレクトが「新しいURL要求としてやり直される」点は、Step 4 の投機的レンダラ起動が無駄になる条件（クロスサイトリダイレクト）と直結する。診断上は、オープンリダイレクト、リダイレクト時の Authorization/Cookie の再送、リダイレクト先での CSP/COOP/COEP の再評価などが観点になる。

### Step 3: Read response（レスポンスの読み取り） （出典: 同上）

図キャプション（逐語）:
> Figure 3: response header which contains Content-Type and payload which is the actual data

レスポンスボディ（payload）が届き始めると、**networkスレッドは必要に応じてストリームの先頭数バイトを見る**。レスポンスの **`Content-Type` ヘッダ**はそれがどんな種類のデータかを示すべきものだが、**欠けていたり間違っていたりすることがあるため、ここで MIME Type sniffing が行われる**。原文はこれを Chromium のソースコードのコメントを引いて **"tricky business"** と表現し、**「そのコメントを読めば、各ブラウザが content-type と payload の組み合わせをどう扱うかがわかる」**と読者に一次情報を読むよう促している。

逐語引用:
> Once the response body (payload) starts to come in, the network thread looks at the first few bytes of the stream if necessary. The response's Content-Type header should say what type of data it is, but since it may be missing or wrong, MIME Type sniffing is done here. This is a "tricky business" as commented in the source code. You can read the comment to see how different browsers treat content-type/payload pairs.

**レスポンスがHTMLファイルなら次のステップはデータをレンダラプロセスに渡すこと**だが、**zipファイルやその他のファイルであれば、それはダウンロード要求を意味するのでデータをダウンロードマネージャに渡す必要がある**。

図キャプション（逐語）:
> Figure 4: Network thread asking if response data is HTML from a safe site

ここは **SafeBrowsing チェック**が行われる場所でもある。**ドメインとレスポンスデータが既知の悪性サイトに一致するように見える場合、networkスレッドは警告ページを表示するようアラートする**。さらに、**CORB（Cross Origin Read Blocking）チェック**が行われ、**機微なクロスサイトデータがレンダラプロセスに到達しないこと**を保証する。

逐語引用:
> This is also where the SafeBrowsing check happens. If the domain and the response data seems to match a known malicious site, then the network thread alerts to display a warning page. Additionally, **C**ross **O**rigin **R**ead **B**locking (**CORB**) check happens in order to make sure sensitive cross-site data does not make it to the renderer process.

原文が張っているリンク（逐語）:

| 語 | リンク先URL（逐語） |
|---|---|
| MIME Type sniffing | https://developer.mozilla.org/docs/Web/HTTP/Basics_of_HTTP/MIME_types |
| the source code | https://cs.chromium.org/chromium/src/net/base/mime_sniffer.cc?sq=package:chromium&dr=CS&l=5 |
| SafeBrowsing | https://safebrowsing.google.com/ |
| Cross Origin Read Blocking (CORB) | https://www.chromium.org/Home/chromium-security/corb-for-developers |

〔補足（一般知識）〕このステップは**ネットワーク由来のデータがサンドボックス外の特権プロセスで検査され、レンダラへ渡る前の最後の関門**である点が重要。ハンティング観点では (1) `Content-Type` 欠落/誤設定＋sniffing による「アップロードしたファイルがHTMLとして描画される」タイプのXSS、(2) `X-Content-Type-Options: nosniff` の有無、(3) CORB/ORB によるクロスオリジン読み取りの遮断が「どのMIMEタイプに対して効くか」、(4) SafeBrowsing 警告の迂回（ドメイン新規性、短縮URL、HTTPSでの配信）などが検証項目になる。

### Step 4: Find a renderer process（レンダラプロセスを見つける） （出典: 同上）

すべてのチェックが済み、networkスレッドが「ブラウザは要求されたサイトへナビゲートしてよい」と確信できたら、**networkスレッドはUIスレッドに「データの準備ができた」と伝える**。**UIスレッドはそこでウェブページのレンダリングを引き継ぐレンダラプロセスを探す**。

図キャプション（逐語）:
> Figure 5: Network thread telling UI thread to find Renderer Process

**最適化**: ネットワーク要求は応答が返るまでに数百ミリ秒（several hundred milliseconds）かかりうるため高速化が施されている。**Step 2 でUIスレッドがnetworkスレッドにURL要求を送る時点で、UIスレッドはすでにどのサイトへ遷移するかを知っている**。そこで **UIスレッドはネットワーク要求と並行して、レンダラプロセスを先回りで探すか起動する**。うまくいけば、networkスレッドがデータを受け取ったときには**レンダラプロセスがすでにスタンバイ状態**になっている。ただし**ナビゲーションがクロスサイトにリダイレクトされた場合、このスタンバイプロセスは使われないことがある**（別のプロセスが必要になるため）。

逐語引用:
> This standby process might not get used if the navigation redirects cross-site, in which case a different process might be needed.

### Step 5: Commit navigation（ナビゲーションのコミット） （出典: 同上）

データとレンダラプロセスが揃ったので、**ブラウザプロセスからレンダラプロセスへ IPC が送られ、ナビゲーションをコミットする**。このとき**データストリームも引き渡され、レンダラプロセスはHTMLデータを受け取り続けられる**。**ブラウザプロセスがレンダラプロセスでコミットが起きたという確認を受け取ると、ナビゲーションは完了し、document loading フェーズが始まる。**

この時点で起こること（原文の列挙）:
- **アドレスバーが更新される**。
- **セキュリティインジケータとサイト設定UI（site settings UI）が、新しいページのサイト情報を反映する**。
- **そのタブのセッション履歴が更新され、戻る/進むボタンが今ナビゲートしたサイトを辿れるようになる**。
- **タブやウィンドウを閉じたときのタブ/セッション復元を可能にするため、セッション履歴はディスクに保存される**。

図キャプション（逐語）:
> Figure 6: IPC between the browser and the renderer processes, requesting to render the page

〔補足（一般知識）〕「コミット」という語はブラウザセキュリティの議論で頻出する。コミットの瞬間にドキュメントのオリジンが確定し、アドレスバー表示が切り替わる。ナビゲーションが**コミットされるかどうか**（例: ダウンロード、204、キャンセルは非コミット）は、アドレスバーの表示内容と実際に描画されている文書がずれる URL spoofing 系バグの中心的な論点になる。

### Extra Step: Initial load complete（初期ロード完了） （出典: 同上）

ナビゲーションがコミットされると、**レンダラプロセスはリソースの読み込みを続け、ページをレンダリングする**（この段階の詳細は次回の記事で扱う、と原文は述べる）。**レンダラプロセスがレンダリングを「終える」と、ブラウザプロセスへIPCを送り返す。これはページ内の全フレームで `onload` イベントが発火し、実行が完了した後である。** この時点で **UIスレッドはタブのローディングスピナーを止める**。

原文の注意（逐語）:
> I say "finishes", because client side JavaScript could still load additional resources and render new views after this point.

つまり「完了」は名目上のものであり、**クライアントサイドJavaScriptはこの後も追加リソースを読み込み、新しいビューを描画しうる**。

図キャプション（逐語）:
> Figure 7: IPC from the renderer to the browser process to notify the page has "loaded"

〔補足（一般知識）〕この一文はクライアントサイド脆弱性ハンティングの前提そのものである。スキャナや手動確認が `onload` 時点のDOMだけを見ると、その後のクライアントサイドルーティング・遅延投入されるsink・動的に読み込まれるサードパーティスクリプトを見落とす。DOM XSS の探索は「ロード完了後も継続する」ことが必要。

### Navigating to a different site（別サイトへのナビゲーション） （出典: 同上）

単純なナビゲーションは完了した。では**ユーザーがアドレスバーに別のURLをもう一度入力したら**どうなるか。ブラウザプロセスは同じ手順を踏むが、**その前に、現在レンダリングされているサイトが `beforeunload` イベントを気にしているかどうかを確認する必要がある**。

**`beforeunload` は、ユーザーが他所へナビゲートしようとしたりタブを閉じようとしたときに "Leave this site?" というアラートを出せる。** **タブの内側にあるものはJavaScriptコードを含めてすべてレンダラプロセスが扱うので、新しいナビゲーション要求が来たとき、ブラウザプロセスは現在のレンダラプロセスに確認を取らなければならない。**

原文の Aside（`{% Aside 'caution' %}`、逐語）:
> Do not add unconditional `beforeunload` handlers. It creates more latency because the handler needs to be executed before the navigation can even be started. This event handler should be added only when needed, for example if users need to be warned that they might lose data they've entered on the page.

（訳: 無条件の `beforeunload` ハンドラを追加してはならない。ナビゲーションを開始する前にハンドラを実行しなければならないため、レイテンシが増える。このイベントハンドラは必要なときだけ——たとえばページに入力したデータを失うかもしれないとユーザーに警告する必要があるときだけ——追加すべきである。）

図キャプション（逐語）:
> Figure 8: IPC from the browser process to a renderer process telling it that it's about to navigate to a different site

**レンダラプロセス起点のナビゲーション**（ユーザーがリンクをクリックした、あるいはクライアントサイドJavaScriptが `window.location = "https://newsite.com"` を実行した場合）では、**まずレンダラプロセスが `beforeunload` ハンドラを確認する**。その後はブラウザプロセス起点のナビゲーションと同じ流れになる。**唯一の違いは、ナビゲーション要求がレンダラプロセスからブラウザプロセスへ向けてキックオフされる点である。**

**現在レンダリング中のサイトとは異なるサイトへ新しいナビゲーションが行われる場合、新しいナビゲーションを扱うために別のレンダラプロセスが呼び出され、現在のレンダラプロセスは `unload` のようなイベントを処理するために生かしておかれる。**

逐語引用:
> When the new navigation is made to a different site than currently rendered one, a separate render process is called in to handle the new navigation while current render process is kept around to handle events like `unload`.

原文はさらに、ページライフサイクルの状態とイベントの概要、および Page Lifecycle API を参照するよう案内している。

| 語 | リンク先URL（逐語） |
|---|---|
| `beforeunload` | https://developer.mozilla.org/docs/Web/Events/beforeunload |
| an overview of page lifecycle states | https://developers.google.com/web/updates/2018/07/page-lifecycle-api#overview_of_page_lifecycle_states_and_events |
| the Page Lifecycle API | https://developers.google.com/web/updates/2018/07/page-lifecycle-api |

図キャプション（逐語）:
> Figure 9: 2 IPCs from a browser process to a new renderer process telling to render the page and telling old renderer process to unload

〔補足（一般知識）〕`beforeunload` がブラウザプロセス→レンダラの同期的な問い合わせを要求するという構造は、(1) ナビゲーション妨害（unload/beforeunload ループによるユーザー拘束、いわゆる "leave site" スパム）、(2) ナビゲーション開始から実際のコミットまでの**時間差**を突く race（アドレスバーが新URL、内容が旧文書という状態を作る類）、(3) 旧レンダラが `unload` 中に行える処理（sendBeacon 等）の悪用、といった検証観点につながる。

### In case of Service Worker（Service Worker がある場合） （出典: 同上）

このナビゲーションプロセスに対する近年の変更の一つが **service worker** の導入である。原文の定義（逐語）:
> Service worker is a way to write network proxy in your application code; allowing web developers to have more control over what to cache locally and when to get new data from the network.

すなわち **SW はアプリケーションコードの中にネットワークプロキシを書く方法**であり、**何をローカルにキャッシュするか、いつネットワークから新しいデータを取るかをウェブ開発者がより制御できるようにする**。**SWがキャッシュからページを読み込むよう設定されていれば、ネットワークにデータを要求する必要はない。**

**覚えておくべき重要な点は、service worker はレンダラプロセスで動くJavaScriptコードだということである。** ではナビゲーション要求が来たとき、**ブラウザプロセスはそのサイトが service worker を持っていることをどうやって知るのか**？

図キャプション（逐語）:
> Figure 10: the network thread in the browser process looking up service worker scope

答え: **service worker が登録されるとき、その service worker の「スコープ」が参照として保持される**（スコープについては "The Service Worker Lifecycle" 記事を参照、と案内）。**ナビゲーションが起きると、networkスレッドはドメインを登録済みの service worker スコープと照合する。そのURLに対して service worker が登録されていれば、UIスレッドは service worker のコードを実行するためにレンダラプロセスを見つける。service worker はキャッシュからデータを読み込んでネットワークへの要求を不要にすることもあれば、ネットワークに新しいリソースを要求することもある。**

逐語引用:
> When a navigation happens, network thread checks the domain against registered service worker scopes, if a service worker is registered for that URL, the UI thread finds a renderer process in order to execute the service worker code.

図キャプション（逐語）:
> Figure 11: the UI thread in a browser process starting up a renderer process to handle service workers; a worker thread in a renderer process then requests data from the network

| 語 | リンク先URL（逐語） |
|---|---|
| service worker | https://developers.google.com/web/fundamentals/primers/service-workers/ |
| The Service Worker Lifecycle | https://developers.google.com/web/fundamentals/primers/service-workers/lifecycle |

〔補足（一般知識）〕SWがナビゲーションに介入できるという事実は、クライアントサイド脆弱性ハンティングでは非常に大きい。SWを登録できてしまえば（例: 任意ファイルアップロード＋適切な `Content-Type` と `Service-Worker-Allowed`、あるいはXSSからの `navigator.serviceWorker.register()`）、そのスコープ配下のナビゲーション応答を攻撃者のコードが持続的に差し替えられる。SWのスコープはパス単位であり、スコープ拡張には `Service-Worker-Allowed` ヘッダが要る、という点が実務上の境界条件になる。SWの登録有無は DevTools の Application パネル、あるいは `navigator.serviceWorker.getRegistrations()` で確認できる。

### Navigation Preload（ナビゲーションプリロード） （出典: 同上）

**service worker が結局ネットワークにデータを要求すると決めた場合、ブラウザプロセスとレンダラプロセスの間のこの往復（round trip）が遅延になりうる**ことがわかる。**Navigation Preload は、service worker の起動と並行してリソースを読み込むことでこの過程を高速化する仕組みである。**

**これらの要求にはヘッダが付与され、サーバはこれらの要求に対して別のコンテンツを送る判断ができる。たとえば、完全なドキュメントの代わりに、更新されたばかりのデータだけを返す、といったことである。**

逐語引用:
> It marks these requests with a header, allowing servers to decide to send different content for these requests; for example, just updated data instead of a full document.

図キャプション（逐語）:
> Figure 12: the UI thread in a browser process starting up a renderer process to handle service worker while kicking off network request in parallel

| 語 | リンク先URL（逐語） |
|---|---|
| Navigation Preload | https://developers.google.com/web/updates/2017/02/navigation-preload |

〔補足（一般知識）〕原文は「a header」とだけ書いてヘッダ名を明示していない。実装上のヘッダ名は原文からは確定できないため、本ノートでは推測を書かない（読者は上記 Navigation Preload 記事、および Service Worker 仕様の navigation preload の節を参照すべき）。
**→ 第2パスで解消済み**: W3C Service Worker 仕様のソース（https://raw.githubusercontent.com/w3c/ServiceWorker/main/index.bs ）から、このヘッダ名が **`Service-Worker-Navigation-Preload`**（既定値 `true`）であることを一次情報で確定した。発動条件・preload要求の性質とあわせて**本ノート末尾「補足資料E」**を参照。

### Wrap-up（まとめ） （出典: 同上）

本稿ではナビゲーション中に何が起こるか、そして**レスポンスヘッダやクライアントサイドJavaScriptといった「あなたのウェブアプリケーションのコード」がブラウザとどう相互作用するか**を見た。**ブラウザがネットワークからデータを得るために踏む手順を知っておくと、navigation preload のようなAPIがなぜ開発されたのかが理解しやすくなる。** 次回はブラウザがHTML/CSS/JavaScriptをどう評価してページをレンダリングするかに踏み込む。

末尾には著者 [@kosamari](https://twitter.com/kosamari) への連絡の呼びかけと、次回へのボタンリンクがある。

#### コード/コマンド（原文のまま逐語）

原文の本文にコードブロックは無い。逐語で現れる識別子・文字列・マークアップは以下のとおり。

```
beforeunload
unload
onload
window.location = "https://newsite.com"
HTTP 301
Content-Type
"Leave this site?"
"Is this a search query or URL?"
CORB (Cross Origin Read Blocking)
SafeBrowsing
```

原稿（index.md）の front matter とテンプレートタグ（逐語）:

```yaml
layout: 'layouts/blog-post.njk'
title: Inside look at modern web browser (part 2)
description: >
  Learn how browser handles navigation request.
authors:
  - kosamari
date: 2018-09-07
updated: 2018-09-21
```

```liquid
{% Aside 'caution' %}
Do not add unconditional `beforeunload` handlers. It creates more latency because the 
handler needs to be executed before the navigation can even be started. This event handler should 
be added only when needed, for example if users need to be warned that they might lose data they've 
entered on the page.
{% endAside %}
```

```html
<a class="button button-primary gc-analytics-event attempt-right"
   href="https://developers.google.com/web/updates/2018/09/inside-browser-part3"
   data-category="InsideBrowser" data-label="Part2 / Next">
  Next: Inner workings of a Renderer Process
</a>
```

### 図一覧（キャプション逐語・全12点） （出典: 同上）

画像そのものは未取得（egressブロック）。キャプションは原稿から逐語で再現。画像URLのパス断片も原稿ママ（CDNベースは `image/T4FyVKpzu4WKF1kBNvXepbi08t52/`）。

| # | 画像ファイル（逐語） | alt（逐語） | キャプション（逐語） |
|---|---|---|---|
| Figure 1 | lo3x7Zt4LZ4ltsQQjLns.png (800x466) | Browser processes | Browser UI at the top, diagram of the browser process with UI, network, and storage thread inside at the bottom |
| Figure 1（原文重複） | HDAB6c70Jo2IvsUl0giY.png (800x466) | Handling user input | UI Thread asking if the input is a search query or a URL |
| Figure 2 | nSD7ognQ9hNFoFOnFQlw.png (800x466) | Navigation start | the UI thread talking to the network thread to navigate to mysite.com |
| Figure 3 | PTmbGdEyTDdLDrAbJw4v.png (720x363) | HTTP response | response header which contains Content-Type and payload which is the actual data |
| Figure 4 | pn0zlnxoYgbyzFVKoTc9.png (800x466) | MIME type sniffing | Network thread asking if response data is HTML from a safe site |
| Figure 5 | VAR3s7k8rIgTrfwEWMIo.png (800x466) | Find renderer process | Network thread telling UI thread to find Renderer Process |
| Figure 6 | kL6CLP7fLay9L99vRR3F.png (800x466) | Commit the navigation | IPC between the browser and the renderer processes, requesting to render the page |
| Figure 7 | DwMkwQndYadDqnMtp8T3.png (800x466) | Page finish loading | IPC from the renderer to the browser process to notify the page has "loaded" |
| Figure 8 | u7EEPH9S2PpycpbQQRFk.png (800x466) | beforeunload event handler | IPC from the browser process to a renderer process telling it that it's about to navigate to a different site |
| Figure 9 | 5tThsmZamrpxFydJFePg.png (800x466) | new navigation and unload | 2 IPCs from a browser process to a new renderer process telling to render the page and telling old renderer process to unload |
| Figure 10 | x65o4xjohKMgf5QDEWPG.png (800x493) | Service worker scope lookup | the network thread in the browser process looking up service worker scope |
| Figure 11 | fuk5vjgLg4sZZTLAMCEB.png (800x466) | serviceworker navigation | the UI thread in a browser process starting up a renderer process to handle service workers; a worker thread in a renderer process then requests data from the network |
| Figure 12 | xAESXRJNybpxPK5dL3m7.png (800x466) | Navigation preload | the UI thread in a browser process starting up a renderer process to handle service worker while kicking off network request in parallel |

### ナビゲーション全工程のシーケンス（原文の記述を1本にまとめた整理） （出典: 同上）

| # | 主体 | 起きること |
|---|---|---|
| 0 | ユーザー | アドレスバーに入力 |
| 1 | ブラウザプロセス UIスレッド | 入力を受け取り「検索クエリかURLか」を判定 |
| 2 | UIスレッド → networkスレッド | Enterでネットワーク呼び出し開始。タブにスピナー表示。**同時に**（Step 4の最適化）遷移先サイト向けのレンダラプロセスを投機的に確保/起動 |
| 3 | networkスレッド | DNS lookup、TLS接続確立、HTTP要求送出 |
| 3b | networkスレッド → UIスレッド | HTTP 301等のリダイレクトヘッダを受けたら通知し、別URL要求としてやり直す |
| 4 | networkスレッド | レスポンスヘッダ＋payload先頭数バイトを検査: MIME sniffing → HTMLならレンダラ行き / zip等ならダウンロードマネージャ行き |
| 5 | networkスレッド | SafeBrowsing チェック（悪性一致なら警告ページ表示をアラート）、CORB チェック（機微なクロスサイトデータをレンダラに渡さない） |
| 6 | networkスレッド → UIスレッド | 「データの準備ができた」と通知 |
| 7 | UIスレッド | レンダラプロセスを確定（投機起動が使えなければ別プロセス。クロスサイトリダイレクト時に発生） |
| 8 | ブラウザプロセス → レンダラ（IPC） | **コミット**。データストリームも引き渡す |
| 9 | レンダラ → ブラウザプロセス | コミット確認。ナビゲーション完了、document loading フェーズ開始 |
| 10 | UIスレッド | アドレスバー更新、セキュリティインジケータとサイト設定UI更新、セッション履歴更新（ディスクにも保存） |
| 11 | レンダラ → ブラウザプロセス（IPC） | 全フレームの `onload` 完了後に通知 → UIスレッドがスピナー停止（ただしJSはこの後も動く） |
| ※ | 別サイトへ遷移する場合 | ブラウザプロセス → 現レンダラへ `beforeunload` 確認のIPC → 新レンダラでレンダリング、旧レンダラは `unload` 処理のため保持 |
| ※ | SWがある場合 | networkスレッドがドメインを登録済みSWスコープと照合 → 該当すればUIスレッドがSW実行用レンダラを起動 → SWがキャッシュ応答 or ネットワーク要求。Navigation Preload が有効ならSW起動と並行してネットワーク要求も走る |

## 補足資料A: MIME sniffing の一次情報（原文が読むよう指示しているソースコメント）

〔補足（原典がリンクしている一次情報。出典: https://raw.githubusercontent.com/chromium/chromium/main/net/base/mime_sniffer.cc ／原文のリンクは cs.chromium.org 版）〕
原文は "This is a 'tricky business' as commented in the source code. You can read the comment to see how different browsers treat content-type/payload pairs." と明示的に一次情報の参照を指示しているため、その該当コメントを**逐語**で採録する。教科書では「なぜ `Content-Type` の誤設定がXSSになるのか」の根拠として使える。

```c
// Detecting mime types is a tricky business because we need to balance
// compatibility concerns with security issues.  Here is a survey of how other
// browsers behave and then a description of how we intend to behave.
//
// HTML payload, no Content-Type header:
// * IE 7: Render as HTML
// * Firefox 2: Render as HTML
// * Safari 3: Render as HTML
// * Opera 9: Render as HTML
//
// Here the choice seems clear:
// => Chrome: Render as HTML
//
// HTML payload, Content-Type: "text/plain":
// * IE 7: Render as HTML
// * Firefox 2: Render as text
// * Safari 3: Render as text (Note: Safari will Render as HTML if the URL
//                                   has an HTML extension)
// * Opera 9: Render as text
//
// Here we choose to follow the majority (and break some compatibility with IE).
// Many folks dislike IE's behavior here.
// => Chrome: Render as text
// We generalize this as follows.  If the Content-Type header is text/plain
// we won't detect dangerous mime types (those that can execute script).
//
// HTML payload, Content-Type: "application/octet-stream":
// * IE 7: Render as HTML
// * Firefox 2: Download as application/octet-stream
// * Safari 3: Render as HTML
// * Opera 9: Render as HTML
//
// We follow Firefox.
// => Chrome: Download as application/octet-stream
// One factor in this decision is that IIS 4 and 5 will send
// application/octet-stream for .xhtml files (because they don't recognize
// the extension).  We did some experiments and it looks like this doesn't occur
// very often on the web.  We choose the more secure option.
//
// GIF payload, no Content-Type header:
// * IE 7: Render as GIF
// * Firefox 2: Render as GIF
// * Safari 3: Download as Unknown (Note: Safari will Render as GIF if the
//                                        URL has an GIF extension)
// * Opera 9: Render as GIF
//
// The choice is clear.
// => Chrome: Render as GIF
// Once we decide to render HTML without a Content-Type header, there isn't much
// reason not to render GIFs.
//
// GIF payload, Content-Type: "text/plain":
// * IE 7: Render as GIF
// * Firefox 2: Download as application/octet-stream (Note: Firefox will
//                              Download as GIF if the URL has an GIF extension)
// * Safari 3: Download as Unknown (Note: Safari will Render as GIF if the
//                                        URL has an GIF extension)
// * Opera 9: Render as GIF
//
// Displaying as text/plain makes little sense as the content will look like
// gibberish.  Here, we could change our minds and download.
// => Chrome: Render as GIF
//
// GIF payload, Content-Type: "application/octet-stream":
// * IE 7: Render as GIF
// * Firefox 2: Download as application/octet-stream (Note: Firefox will
//                              Download as GIF if the URL has an GIF extension)
// * Safari 3: Download as Unknown (Note: Safari will Render as GIF if the
//                                        URL has an GIF extension)
// * Opera 9: Render as GIF
//
// We used to render as GIF here, but the problem is that some sites want to
// trigger downloads by sending application/octet-stream (even though they
// should be sending Content-Disposition: attachment).  Although it is safe
// to render as GIF from a security perspective, we actually get better
// compatibility if we don't sniff from application/octet stream at all.
// => Chrome: Download as application/octet-stream
//
// Note that our definition of HTML payload is much stricter than IE's
// definition and roughly the same as Firefox's definition.
```

要点（表に整形。上記コメントの内容のみ）:

| payload | Content-Type | IE 7 | Firefox 2 | Safari 3 | Opera 9 | Chrome の決定 |
|---|---|---|---|---|---|---|
| HTML | （なし） | Render as HTML | Render as HTML | Render as HTML | Render as HTML | **Render as HTML** |
| HTML | `text/plain` | Render as HTML | Render as text | Render as text（URLがHTML拡張子ならHTML） | Render as text | **Render as text**（`text/plain` のときは危険なMIMEタイプ＝スクリプト実行可能なものを検出しない） |
| HTML | `application/octet-stream` | Render as HTML | Download | Render as HTML | Render as HTML | **Download as application/octet-stream**（より安全な選択） |
| GIF | （なし） | Render as GIF | Render as GIF | Download as Unknown | Render as GIF | **Render as GIF** |
| GIF | `text/plain` | Render as GIF | Download | Download as Unknown | Render as GIF | **Render as GIF** |
| GIF | `application/octet-stream` | Render as GIF | Download | Download as Unknown | Render as GIF | **Download as application/octet-stream**（octet-stream からは一切sniffしない方が互換性が良い） |

### sniffing の実装上の境界条件（逐語）

〔補足（一次情報: net/base/mime_sniffer.h および mime_sniffer.cc）〕

ヘッダの公式警告（逐語）:
```c
// When the MIME type of a resource is sniffed, it will potentially be used in
// a manner other than that the server-provided Content-Type indicated it should
// be used in. This may have security implications. As such, MIME sniffing
// should generally not be expanded to cover more types of files, to sniff more
// files, or to more aggressively sniff already supported MIME types.
//
// Please do not increased the capabilities of the MIME sniffer. MIME sniffing
// only continues to be supported because of the many sites that depend on the
// existing behavior, not because it's a good idea. Most sites are working with
// the MIME sniffer as-is, so there's no need to expand upon it.
```

定数（逐語）:
```c
const int kMaxBytesToSniff = 1024;
static const size_t kBytesRequiredForMagic = 42;
```
```c
enum class ForceSniffFileUrlsForHtml {
  kDisabled,
  kEnabled,
};
```

sniff するか否かの判定（`ShouldSniffMimeType`、逐語）:
```c
  bool sniffable_scheme = url.is_empty() || url.SchemeIsHTTPOrHTTPS() ||
#if BUILDFLAG(IS_ANDROID)
                          url.SchemeIs("content") ||
#endif
                          url.SchemeIsFile() || url.SchemeIsFileSystem();
  if (!sniffable_scheme) {
    return false;
  }

  // If the "x-content-type-options" header is "nosniff", do not sniff. Only the
  // first matching header is checked, per the fetch spec.
  if (http_response_headers) {
    std::optional<std::string_view> header =
        http_response_headers->EnumerateHeader(/*iter=*/nullptr,
                                               "x-content-type-options");
    if (header && base::EqualsCaseInsensitiveASCII(*header, "nosniff")) {
      return false;
    }
  }
```
→ **`X-Content-Type-Options: nosniff`（大文字小文字不問）があれば sniffing しない。Fetch仕様どおり最初のヘッダのみを見る。**

sniff 対象となる Content-Type 一覧（`kSniffableTypes`、逐語）:
```c
  static const char* const kSniffableTypes[] = {
    // Many web servers are misconfigured to send text/plain for many
    // different types of content.
    "text/plain",
    // We want to sniff application/octet-stream for
    // application/x-chrome-extension, but nothing else.
    "application/octet-stream",
    // XHTML and Atom/RSS feeds are often served as plain xml instead of
    // their more specific mime types.
    "text/xml",
    "application/xml",
    // Check for false Microsoft Office MIME types.
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel.sheet.macroenabled.12",
    "application/vnd.ms-word.document.macroenabled.12",
    "application/vnd.ms-powerpoint.presentation.macroenabled.12",
    "application/mspowerpoint",
    "application/msexcel",
    "application/vnd.ms-word",
    "application/vnd.ms-word.document.12",
    "application/vnd.msword",
  };
```

「不明なMIMEタイプ」の定義（`IsUnknownMimeType`、逐語）:
```c
  static const char* const kUnknownMimeTypes[] = {
    // Empty mime types are as unknown as they get.
    "",
    // The unknown/unknown type is popular and uninformative
    "unknown/unknown",
    // The second most popular unknown mime type is application/unknown
    "application/unknown",
    // Firefox rejects a mime type if it is exactly */*
    "*/*",
  };
  ...
  if (mime_type.find('/') == std::string_view::npos) {
    // Firefox rejects a mime type if it does not contain a slash
    return true;
  }
```
→ **空、`unknown/unknown`、`application/unknown`、`*/*`、およびスラッシュを含まない値は「不明」扱いとなり、HTMLとして sniff される候補になる。**

HTML として sniff されるタグ一覧（`kSniffableTags`、逐語）:
```c
static const MagicNumber kSniffableTags[] = {
  // XML processing directive.  Although this is not an HTML mime type, we sniff
  // for this in the HTML phase because text/xml is just as powerful as HTML and
  // we want to leverage our white space skipping technology.
  MAGIC_NUMBER("text/xml", "<?xml"),  // Mozilla
  // DOCTYPEs
  MAGIC_HTML_TAG("!DOCTYPE html"),  // HTML5 spec
  // Sniffable tags, ordered by how often they occur in sniffable documents.
  MAGIC_HTML_TAG("script"),  // HTML5 spec, Mozilla
  MAGIC_HTML_TAG("html"),  // HTML5 spec, Mozilla
  MAGIC_HTML_TAG("!--"),
  MAGIC_HTML_TAG("head"),  // HTML5 spec, Mozilla
  MAGIC_HTML_TAG("iframe"),  // Mozilla
  MAGIC_HTML_TAG("h1"),  // Mozilla
  MAGIC_HTML_TAG("div"),  // Mozilla
  MAGIC_HTML_TAG("font"),  // Mozilla
  MAGIC_HTML_TAG("table"),  // Mozilla
  MAGIC_HTML_TAG("a"),  // Mozilla
  MAGIC_HTML_TAG("style"),  // Mozilla
  MAGIC_HTML_TAG("title"),  // Mozilla
  MAGIC_HTML_TAG("b"),  // Mozilla
  MAGIC_HTML_TAG("body"),  // Mozilla
  MAGIC_HTML_TAG("br"),
  MAGIC_HTML_TAG("p"),  // Mozilla
};
```

`SniffMimeType` の分岐の要点（逐語コメント）:
```c
  // First check for HTML, unless it's a file URL and
  // |allow_sniffing_files_urls_as_html| is false.
  ...
    // We're only willing to sniff HTML if the server has not supplied a mime
    // type, or if the type it did supply indicates that it doesn't know what
    // the type should be.
  ...
  // We're only willing to sniff for binary in 3 cases:
  // 1. The server has not supplied a mime type.
  // 2. The type it did supply indicates that it doesn't know what the type
  //    should be.
  // 3. The type is "text/plain" which is the default on some web servers and
  //    could be indicative of a mis-configuration that we shield the user from.
```

Chrome 拡張（CRX）の sniffing（逐語）:
```c
  static const struct MagicNumber kCRXMagicNumbers[] = {
      MAGIC_NUMBER("application/x-chrome-extension", "Cr24\x02\x00\x00\x00"),
      MAGIC_NUMBER("application/x-chrome-extension", "Cr24\x03\x00\x00\x00")};

  // Only consider files that have the extension ".crx".
  if (!url.path().ends_with(".crx")) {
    return false;
  }
```

〔補足（一般知識）〕ハンティングでの使い方: ファイルアップロード機能を持つサイトで、アップロード物が「Content-Type なし」「`text/plain` 以外の不明値」「スラッシュなしの壊れた値」で返され、かつ `X-Content-Type-Options: nosniff` が無く、ダウンロードが `Content-Disposition: attachment` でもない場合、上記 `kSniffableTags` のいずれかで始まるファイル（先頭1024バイト以内・空白スキップあり）は HTML として描画されうる。`<?xml` から始まるものは `text/xml` として扱われ、これも HTML 同等の権能を持つ（コメント自身が "text/xml is just as powerful as HTML" と述べている）。ただし本家サイトのオリジン上で描画されるかはレスポンスのオリジンとサンドボックス設定次第であり、実際の検証時は許可された対象に対してのみ行うこと。

## 読者が自分で開くべき資料

以下は本ノート作成時に**egressポリシーで取得できなかった／担当外だが原文がリンクしている**資料。教科書に転記すべき「読みどころ」を併記する。

### 1. https://developer.chrome.com/blog/inside-browser-part2（原典のレンダリング版）
取得できなかった理由: この環境の egress proxy が `developer.chrome.com:443` への CONNECT を **403（組織のegressポリシー拒否）** で拒否。web.archive.org、developers.google.com、web.dev も同様に403。本文はGitHub上の原稿Markdownから完全取得済みだが、**図（PNG 12点）は未取得**。
読みどころ:
1. Figure 1〜12 の**プロセス／スレッド間の矢印の向き**（どちらが要求元か）。本文よりも図の方がIPCの方向関係が明瞭。
2. Figure 3 の「レスポンスヘッダ＋payload」の絵（`Content-Type` と実データの関係）。
3. Figure 9 の「新レンダラへのレンダリング指示」と「旧レンダラへの unload 指示」という**2本のIPC**の並び。
4. Figure 10〜12 の Service Worker スコープ照合と Navigation Preload の並列実行の図解。
5. 記事末尾の part1/part3/part4 へのナビゲーションリンク（シリーズ全体で読むと理解が早い）。

### 2. https://www.chromium.org/Home/chromium-security/corb-for-developers （CORB の公式解説。本ノートでは未取得）
取得できなかった理由: curl が接続不能（HTTP 000）。
読みどころ:
1. **CORB が保護対象とする Content-Type**（HTML / XML / JSON、および `nosniff` 付きレスポンスの扱い）。
2. CORB が**どのタイミングで**（レンダラに渡る前、つまり本記事 Step 3）働くか。
3. CORB でブロックされたレスポンスがレンダラ側でどう見えるか（空のレスポンスとして観測される点）。
4. JSON に対する**JSONパーサ破壊プレフィクス（`)]}'` 等）**との関係と、`X-Content-Type-Options: nosniff` を付けるべき理由。
5. CORB の後継である **ORB (Opaque Response Blocking)** への言及があれば、その差分。
6. サイト分離（Site Isolation）とSpectre系サイドチャネルという CORB 導入の動機。

### 3. https://cs.chromium.org/chromium/src/net/base/mime_sniffer.cc?sq=package:chromium&dr=CS&l=5 （原文が指定するソース）
状態: cs.chromium.org は現在 source.chromium.org にリダイレクトされるためリンク自体は古い。本ノートでは GitHub ミラー（raw.githubusercontent.com/chromium/chromium/main/net/base/mime_sniffer.cc）から**同内容を逐語取得済み**。上記「補足資料A」を参照。
読みどころ:
1. 冒頭の「ブラウザ別挙動サーベイ」コメント（本ノートに全文採録）。
2. `kSniffableTags` / `kSniffableTypes` / `kUnknownMimeTypes` の各リスト。
3. `kMaxBytesToSniff = 1024` と `kBytesRequiredForMagic = 42`。
4. `ShouldSniffMimeType` の `nosniff` 判定とスキーム制限。

### 4. その他、原文がリンクしている資料（教科書の資料索引に転記すべきURL）
| 資料 | URL（原文逐語） |
|---|---|
| part 1: CPU, GPU, Memory, and multi-process architecture | https://developers.google.com/web/updates/2018/09/inside-browser-part1 |
| part 3: Inner workings of a Renderer Process | https://developers.google.com/web/updates/2018/09/inside-browser-part3 |
| MIME types（MDN） | https://developer.mozilla.org/docs/Web/HTTP/Basics_of_HTTP/MIME_types |
| SafeBrowsing | https://safebrowsing.google.com/ |
| CORB for developers | https://www.chromium.org/Home/chromium-security/corb-for-developers |
| beforeunload（MDN） | https://developer.mozilla.org/docs/Web/Events/beforeunload |
| Page Lifecycle API / 状態とイベントの概要 | https://developers.google.com/web/updates/2018/07/page-lifecycle-api#overview_of_page_lifecycle_states_and_events |
| Page Lifecycle API | https://developers.google.com/web/updates/2018/07/page-lifecycle-api |
| Service Workers（primer） | https://developers.google.com/web/fundamentals/primers/service-workers/ |
| The Service Worker Lifecycle | https://developers.google.com/web/fundamentals/primers/service-workers/lifecycle |
| Navigation Preload | https://developers.google.com/web/updates/2017/02/navigation-preload |
| 著者 | https://twitter.com/kosamari |

（注: `developers.google.com/web/updates/...` 系のURLは現在 developer.chrome.com / web.dev へ移行済みだが、**原文の記載どおり**に上表へ転記した。）

---

# 補完パス（第2パス）: 取得漏れの補充

## 第2パス取得ログ（2026-09-18 実施）

| 対象 | 結果 | 手段と観測された挙動 |
|---|---|---|
| https://developer.chrome.com/blog/inside-browser-part2 | 依然 **failed**（本文は第1パスでGitHub原稿から完全取得済みなので実害なし） | WebFetch → `EGRESS_BLOCKED (domain developer.chrome.com)`。curl → `CONNECT tunnel failed, response 403` |
| 記事の図PNG 12点 | **failed（未取得のまま）** | `storage.googleapis.com/web-dev-uploads/image/T4FyVKpzu4WKF1kBNvXepbi08t52/<file>` → HTTP **403**（XMLエラー応答）。`wd.imgix.net` / `web-dev.imgix.net` / `developer-chrome-com.imgix.net` → いずれも CONNECT 403。`web.archive.org/web/2024/<URL>` → CONNECT 403。`r.jina.ai/<URL>` → CONNECT 403 |
| https://www.chromium.org/Home/chromium-security/corb-for-developers | **failed（ページ自体は未取得）** | WebFetch → `EGRESS_BLOCKED (domain www.chromium.org)`。curl（UA差し替え・`-L`・`--compressed`・末尾スラッシュ有無・`chromium.org` 直指定の4通り）→ すべて `CONNECT tunnel failed, response 403`。**第1パスで「接続不能 / 000」と記録した原因は、DNSやサーバ側ではなく egress proxy の CONNECT 403（組織のegressポリシー）であることが判明した**（第1パスの記述はこの行で補正する） |
| chromium-website リポジトリ内の該当Markdown | **failed（不在）** | `raw.githubusercontent.com/chromium/chromium-website/main/` 配下の `site/chromium-security/corb-for-developers/index.md`、`site/Home/chromium-security/corb-for-developers/index.md`、`site/chromium-security/corb-for-developers.md` はいずれも **404**。GitHub の code search API はこのセッションでは利用不可（`sessions are bound to their configured repositories`） |
| **代替一次情報①** https://raw.githubusercontent.com/chromium/chromium/main/services/network/cross_origin_read_blocking_explainer.md | **full（HTTP 200 / 展開後 38,173 bytes / 741行）** | curl。**Chromium プロジェクト公式の CORB 説明文書（ソースツリー内）**。chromium.org の "CORB for developers" が扱う内容の一次情報にあたる |
| **代替一次情報②** https://raw.githubusercontent.com/annevk/orb/main/README.md | full（HTTP 200） | curl。CORB の後継 **ORB (Opaque Response Blocking, aka CORB++)** の提案本文 |
| **代替一次情報③** https://raw.githubusercontent.com/chromium/chromium/main/services/network/public/cpp/orb/orb_api.h ／ `orb_impl.h` | full（HTTP 200 / 4,023 bytes・3,771 bytes） | curl。Chromium における ORB 実装の公開API。`services/network/public/cpp/corb/corb_api.h` は **404**（CORB専用ヘッダは現在このパスに無い） |
| **代替一次情報④** https://raw.githubusercontent.com/chromium/chromium/main/docs/navigation.md（"Life of a Navigation"） | full（HTTP 200） | curl。**本記事と同じ題材の Chromium 公式ドキュメント。記事(2018年)より新しく、記事が省いた分岐（204/205、`Content-Disposition`、エラーページ、commit の厳密な定義）を補える** |
| **代替一次情報⑤** https://raw.githubusercontent.com/chromium/chromium/main/docs/navigation_concepts.md（"Navigation Concepts"） | full（HTTP 200） | curl。same-document/cross-document、browser-initiated/renderer-initiated、**last committed / pending / visible URL（URL spoof の中心概念）**、server redirect と client redirect の違い |
| **代替一次情報⑥** https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md | full（HTTP 200 / 33,585 bytes） | curl。**Spare Process**（記事 Step 4 の「先回りでレンダラを用意する」最適化の現在の姿）の定義 |
| **代替一次情報⑦** https://raw.githubusercontent.com/chromium/chromium/main/docs/render_document.md | full（HTTP 200） | curl。RenderDocument（ドキュメントごとに新しい RenderFrameHost を使う方向） |
| **代替一次情報⑧** https://raw.githubusercontent.com/w3c/ServiceWorker/main/index.bs | full（HTTP 200 / 297,377 bytes） | curl。**Service Worker 仕様のソース。記事が「a header」とだけ書いたヘッダ名を確定できる**（`docs/index.bs` は404、リポジトリ直下 `index.bs` が正） |
| **代替一次情報⑨** https://raw.githubusercontent.com/whatwg/fetch/main/fetch.bs | full（HTTP 200 / 444,022 bytes / 10,593行） | curl。Fetch 標準のソース。**取得時点のこのファイルに対する grep では `CORB` / `Cross-Origin Read Blocking` / `Opaque Response Blocking` / `opaque-safelisted` / `opaque-blocklisted` はいずれも0件**だった（`nosniff` は11件）。したがって「Fetch 標準本体の CORB 節」を一次情報として引くことは現時点ではできない（後述の ORB 上流化状況と整合） |
| 到達不能だったその他 | failed | `developer.mozilla.org`、`w3c.github.io`、`fetch.spec.whatwg.org` はいずれも CONNECT 403。**仕様・MDNの本文はレンダリング版では読めないため、上記のとおり仕様ソース（GitHub raw）を使った** |
| WebSearch | 使用不可 | このセッションの WebSearch 予算（200回）が枯渇しており、二次情報の検索は実施できなかった。したがって本補完パスは**一次情報（Chromium ソースツリー／W3C・WHATWG 仕様ソース／提案リポジトリ）のみ**で構成している |

## 補足資料B: CORB の公式解説（記事 Step 3 の "CORB check" の中身）

出典: **https://raw.githubusercontent.com/chromium/chromium/main/services/network/cross_origin_read_blocking_explainer.md**（Chromium ソースツリー内の公式文書 "Cross-Origin Read Blocking (CORB)"）。
記事本文がリンクしていた `https://www.chromium.org/Home/chromium-security/corb-for-developers` は本環境から取得できなかったため、**同じプロジェクトの一次文書で代替している**（両者は同一文書ではない。以下は上記 explainer から読み取った内容のみを書く）。

### B-1. CORB とは何を守る仕組みか

同文書の冒頭定義（逐語・冒頭2文）:
> This document outlines Cross-Origin Read Blocking (CORB), an algorithm by which dubious cross-origin resource loads may be identified and blocked by web browsers before they reach the web page.
> CORB reduces the risk of leaking sensitive data by keeping it further from cross-origin web pages.

要点:
- **「ウェブページに届く前に」怪しいクロスオリジン読み込みを識別してブロックする**アルゴリズム。多くのブラウザでは信頼できないスクリプト実行コンテキストからデータを遠ざける。**Site Isolation があるブラウザでは、信頼できないレンダラプロセスからデータを完全に排除できるため、サイドチャネル攻撃にも効く**（同文書は Site Isolation へリンク: https://www.chromium.org/Home/chromium-security/site-isolation ）。
- 問題設定: same-origin policy は原則クロスオリジンの読み取りを防ぐが、`<img>` や `<script>` のような歴史的に許されてきた埋め込み、および CORS による選択的許可のために例外がある。**JSON のように「歴史的に許されたどの文脈でも意味のある読み取りができない」型が存在する**（`<img>` ではデコードエラー、`<script>` では no-op か構文エラー、観測可能な形で読めるのは `fetch()` / `XMLHttpRequest` = CORS が仲介する経路のみ）。
- したがって**画像デコーダや JavaScript パーサに渡る前に落とせば**、スキップした段（デコーダ／パーサ）に潜むサイドチャネル脆弱性も封じられる。

### B-2. 緩和する攻撃（同文書 "What attacks does CORB mitigate?"）

| 攻撃 | 同文書の説明の要旨 |
|---|---|
| **XSSI (Cross-Site Script Inclusion)** | `<script>` を JavaScript でない資源に向け、JavaScript として解釈された副作用を観測する手法。2006年の初期例として **Array コンストラクタを上書きして `<script src="https://example.com/secret.json">` で JSONリストの中身を傍受する**攻撃を挙げる。Array コンストラクタ版は現在のブラウザでは修正済みだが、その後10年で類似の攻撃が多数発見・修正されてきた（同文書は OWASP London 2016 の JSON Hijacking スライドPDFへリンク）。CORB はこの系統を封じる（CORB保護対象はクロスサイトの `<script>` 要素に配送されない）。**XSRFトークンや JSON セキュリティプレフィクスといった他の XSSI 防御が無い場合に特に価値がある**。逆に、**JSONセキュリティプレフィクスの存在は「この資源は CORB 保護すべき」というシグナルとして使える** |
| **投機的サイドチャネル攻撃（Spectre など）** | 攻撃者は `<img src="https://example.com/secret.json">` でクロスサイトの秘密を**自分のJSが動いているプロセスのメモリに引き込み**、Spectre 等で読み出せる。**CORB は Site Isolation と併用することで、その JSON がクロスサイトページをホストするプロセスのメモリに存在しないようにする** |

### B-3. 「ブロック」の実装（レンダラ側からどう見えるか）

同文書 "How does CORB 'block' a response?" より:
- **レスポンスボディは空のボディに置き換えられる。**
- **レスポンスヘッダは除去される。**（同文書中の注記では、Chromium は CORS のエラーメッセージ改善のため `Access-Control-*` ヘッダは残していると述べている）
- 投機的サイドチャネルに効かせるには、**クロスオリジンの要求元をホストするプロセスにレスポンスが到達する前に**ブロックしなければならない。すなわち**一時的にも短時間でも、CORB保護データがそのプロセスのメモリに存在してはならない**。これは Fetch 仕様の filtered response（CORS filtered / opaque filtered）とは異なる概念で、filtered response は内部レスポンスに完全なデータを保持したままの「限定的なビュー」であり、レンダラプロセス内部で実装されうる。
- デモページとして https://anforowicz.github.io/xsdb-demo/index.html を案内している（本環境では未取得）。

### B-4. どの要求が CORB の対象か（"What kinds of requests are CORB-eligible?"）

**CORB-exempt（対象外）**:
- **navigation request**、および request destination が `object` / `embed` の要求。クロスオリジンの `<iframe>` / `<object>` / `<embed>` は**別のセキュリティコンテキストを作る**ため漏洩リスクが低い（Site Isolation があるブラウザでは別プロセスになるので、悪意あるページのアドレス空間にデータが入らない）。
- **ダウンロード要求**（initiator が `download`）。データはディスクに保存されクロスオリジンのコンテキストに共有されないため、CORB 保護の恩恵がない。

→ **記事 Step 3 の文脈で重要な帰結**: 記事が扱っている「ナビゲーションのためのレスポンス」そのものは navigation request なので **CORB-exempt** である。記事の「CORB check が行われる」という記述は、**ナビゲーション時にネットワークスレッドが通る一連のチェック群の一部としての言及**であり、ナビゲーション本体のHTMLがCORBでブロックされるという意味ではない（この切り分けは explainer の上記リストから導かれる）。

**CORB-eligible（対象になりうる）**: 上記以外すべて。同文書が明示列挙するもの:
- XHR と `fetch()`
- `ping`、`navigator.sendBeacon()`
- `<link rel="prefetch" ...>`
- request destination が次のもの: **image**（`<img>`、`/favicon.ico`、SVG の `<image>`、CSS の `background-image` 等）、**script-like**（`<script>`、`importScripts()`、`navigator.serviceWorker.register()`、`audioWorklet.addModule()` 等）、**audio / video / track**、**font**、**style**、**report**（CSPレポート、NELレポート等）

同文書が述べる CORB の本質的アイデア（要旨）: **上記のあらゆる文脈で「使い道がない」資源かどうかを考える。どの使い方をしても CORS エラー・構文/デコードエラー・観測可能な影響なしのいずれかに終わるなら、観測可能な結果を変えずにブロックできる。**

### B-5. 保護される型: JSON / HTML / XML

- **JSON**: ウェブで広く使われ、ユーザーデータを含む可能性が高い。画像やHTMLと違い**CORS以前のレガシーなクロスオリジン埋め込み手段が存在しない**。JavaScript との polyglot に注意が必要で、同文書は次を区別する。
  - **空でない JSON オブジェクトリテラル**（例 `{"key": "value"}`）: **JavaScript としては構文エラーになる部分集合**（最初の文字列リテラル直後のコロンで構文エラー）。**Content-Type が違っていてもボディを sniff して保護できる。**
  - **それ以外の JSON リテラル**（`null`、`[1, 2, "3"]` 等）: JavaScript としても妥当で、値式なので副作用は無い。検出には**完全な JSON 構文を理解するバリデータ**が必要。JSON の Content-Type が付いていない場合は**全体をバッファして検証**する必要がある（`[1, 2, "3"].map(...)` のように副作用を持つ妥当な JS になりうるため）。JSON の Content-Type が付いている場合は**一定バイト数までの sniff で確認**してよい（無制限のメモリ消費を避けるため）。
  - **XSSI対策プレフィクス付き JSON**: 実在する慣習として同文書が挙げるもの — **`)]}'`**（angular.js、Java Spring に組み込まれ、google.com ドメインで広く観測される）、**`{} &&`**（歴史的に Java Spring に組み込まれていた）、**`for(;;);` のような無限ループ**（facebook.com ドメインで広く観測される）。これらの存在は**強いシグナル**であり、後に何が続いていてもほぼ常に CORB 保護を発動させる。安全と論じられる理由は、(a) JS MIME タイプで配信された文書にこれらがあれば構文エラーかハングになる、(b) 画像・動画・フォントのようなバイナリ資源（先頭数バイトが固定、例 `image/jpeg` の `FF D8 FF`）とは衝突しないと知られている、の2点。**ただし `text/css` は例外**（JSONセキュリティプレフィクスで始まりつつスタイルシートとしても妥当なファイルが理論上作れるため。同文書は `)]}'` / `{}` / `h1 { color: red; }` という例を挙げる）。
  - `<link rel="manifest">` のようにウェブ機能が JSON を使う例もあるが、クロスオリジン指定時は CORS が必要なので `fetch()` と同じ扱いになる。
- **HTML**: `<iframe>` でのクロスオリジン埋め込みを除けば、HTML文書は `fetch()`/XHR でしか読めず、どちらも CORS が必要。HTML の sniffing は既によく理解されているので JSON より識別が容易。**ただし HTML 形式のコメントは JavaScript の構文の一部**（同文書は ECMA-262 の HTML-like comments を参照）なので保守的に扱う: **CORB は sniff 時に HTMLコメントブロックを読み飛ばし、`<!--` を見ただけでは HTML と確定しない（後に妥当な HTML タグが続く必要がある）**。さらに HTML コメント終了後は**行終端文字まで読み飛ばす**（`SingleLineHTMLCloseComment` が `-->` の後の文字を消費しうるため）。同文書は実サイトで観測された HTML/JavaScript polyglot の例も2つ挙げている。
- **XML**: JSON 同様に広く使われるデータ交換形式であり、XMLHttpRequest 経由でウェブプラットフォームに組み込まれた文書形式。**確認は容易で、先行する空白の後の `<?xml` パターンで識別できる**。特別扱いが必要なのは**画像型である `image/svg+xml` のみ（CORB-exempt）**で、それ以外の XML MIME タイプはすべて CORB 保護対象。

### B-6. CORB 保護の判定ルール（"Determining whether a response is CORB-protected"）

同文書のルールを表に整理（内容は同文書のまま）:

| 条件 | 保護対象になる Content-Type |
|---|---|
| `X-Content-Type-Options: nosniff` ヘッダがある | HTML MIME タイプ／XML MIME タイプ（`image/svg+xml` は除外）／JSON MIME タイプ／**`text/plain`** |
| **206 レスポンス** | HTML MIME タイプ／XML MIME タイプ（`image/svg+xml` 除外）／JSON MIME タイプ |
| それ以外（**ボディを sniff して確認**） | HTML MIME タイプで HTML と sniff される／XML MIME タイプ（`image/svg+xml` 除外）で XML と sniff される／JSON MIME タイプで JSON と sniff される／**`text/plain` で JSON・HTML・XML と sniff される**／**`text/css` 以外で JSONセキュリティプレフィクスで始まる**もの |

sniffing に関する同文書の補足:
- **sniffing は「誤ラベルのクロスオリジン応答に依存している既存ページ」を壊さないために必要**であり、**sniffing 無しなら約16倍の応答がブロックされてしまう**。
- **CORB は Content-Type ヘッダに基づく分類を「確認する」方向にしか sniff しない**（`text/json` なら JSON だけを sniff し、HTML や XML の sniff はしない）。
- CORB保護型と非保護型で構文要素が共有される場合、その要素は sniff から除外しなければならない（HTMLコメントの例）。これは**他の文脈で使われる MIME sniffing のルールとは異なる**。
- 同文書の推奨（逐語・要旨）: **「最善のセキュリティのため、ウェブ開発者は (1) 正しい `Content-Type` ヘッダを付け、(2) `X-Content-Type-Options: nosniff` で sniffing をオプトアウトすること」**。

**CORB 保護されないもの**（同文書の明示）:
- `multipart/*` とラベルされた応答（入れ子パートの content type を解析しないため。**機微な文書に対して multipart range request をサポートしないことを推奨**している）。
- **`Content-Type` ヘッダが無い応答。**
- **`text/javascript` などの JavaScript MIME タイプの応答。JSONP（JSON with padding）もここに含まれる**（JSONP は JSON と違いクロスオリジン文脈で読まれ実行されることを意図した形式であるため）。

### B-7. 互換性への影響（"CORB and web compatibility" と実測値）

観測可能な差が出るかどうかの整理（同文書の例より）:

| 埋め込み文脈 | ボディ | Content-Type | nosniff | 同文書の結論 |
|---|---|---|---|---|
| `<img>` | HTML文書 | `text/html` | なし | **観測可能な差なし**（HTMLを画像として描こうとしても、空応答を描こうとしても同じ broken image） |
| `<img>` | 画像 | `text/html`（誤ラベル） | なし | **差なし**（sniff で CORB保護型でないと判るので許可される） |
| `<img>` | 画像 | `text/html`（誤ラベル） | **あり** | **観測可能な差あり**（nosniff のため Content-Type に従うしかなく、誤分類してブロックしてしまう） |
| `<script>` | HTML文書 | `text/html` | なし | **観測可能な差あり**（通常なら構文エラーで `onerror` が発火するが、CORBブロック後の空ボディは JS として正しくパースされるので構文エラーが消える） |
| `<script>` | 正しいJS | `text/html`（誤ラベル） | なし | **差なし**（sniff で許可。HTML と JS で共有される構文要素＝コメントにも耐性がある） |
| `<script>` | 正しいJS | `text/html`（誤ラベル） | **あり** | **観測可能な差なし**（CORB の有無に関係なく、nosniff により JS MIME タイプでない応答はブロックされる。これは Fetch 仕様の要求） |
| `<link rel="stylesheet">` | 任意 | `text/css` 以外 | なし/あり | **観測可能な差なし**（CORB が無くてもクロスオリジンCSSは正しい Content-Type を要求される。HTML仕様が `text/css` でなければスタイルシート生成手順を走らせないと定めている） |
| `<link rel="stylesheet">` | JSONセキュリティプレフィクスで始まるCSS | `text/css` | なし | **差なし**（`text/css` に対してはプレフィクスの sniff を行わないため） |

同文書は `<img>` の例が `/favicon.ico`、SVG の `<image>`、`<link rel="preload" as="image">`、CSS の `background-image`、`<canvas>` への描画にも当てはまるとし、各ケースに対応する WPT（Web Platform Tests）のファイル名（`fetch/corb/...`）を併記している。CORB が影響しないものとして **XHR/fetch（もともと同一オリジンポリシーが適用される）**、**prefetch（レンダラには渡さないがブラウザプロセスのキャッシュは可能）**、**トラッキング/レポート（応答内容に依存しない）**、**Service Worker（SW内部で人工的に構成した応答はブロックしない。実際のクロスオリジン応答をキャッシュする場合は 'opaque' なのでCORBがブロックしても振る舞いは変わらない）**、**Blob/File API**、**content script とプラグイン（CORB の対象外。別の仕組みでポリシーが守られている前提）** を挙げる。

実測値（2018年2月の Chrome Canary データに基づく同文書の数値）:
- **CORB対象応答のうち 0.961% がブロックされた。** ただしその半分以上はもともと空の応答（`Content-Length: 0`）で実質的な挙動変化はない。**sniffing を省けば約20%がブロックされてしまうため、sniffing は明確に必須。**
- **非空かつブロックされたのは 0.456%。** 大半は「トラッキングピクセルとして `<img>` に配送される HTML 応答」のような観測不能カテゴリ。
- **0.115% が nosniff ヘッダまたは range request に起因して観測可能にブロックされた可能性がある。** そのうち **95.16% は「HTML とラベルされた nosniff 応答を `<img>` が要求した」ケース**、**3.76% は media 文脈からの `text/plain` の range request**。
- **0.014% は script タグへの不正な入力**（CORB sniffing で HTML/XML/JSON と判明したもの）。

### B-8. 将来の拡張（"Appendix: Future work"）

- **より多くの MIME タイプを対象にする**: HTML/XML/JSON を**ブロックリスト方式**で列挙する代わりに、`<img>` / `<audio>` / `<video>` / `<script>` 等でクロスオリジン埋め込み可能な MIME タイプを**許可リスト**にして、それ以外すべてを保護する方式。許可リスト候補として JavaScript MIME タイプ、`text/css`、`image/*`、`audio/*`・`video/*`・`application/ogg`、`font/*` とレガシーフォント型、`application/octet-stream`、`text/vtt` を挙げる。これにより **PDF や ZIP も CORB 保護できるようになる**（HTML/XML/JSON 以外に対しては確認sniffは行わない方針）。
- **CORB オプトインヘッダ**: 通常はクロスオリジン埋め込みが許される資源（画像や JavaScript、JSONP を含む）をサーバが明示的に保護できるようにする案。同文書の注記では検討中のシグナルとして **`From-Origin:` / `Cross-Origin-Resource-Policy:`** と **`Isolate-Me`** を挙げている。
- 標準化状況（同文書時点）: **Fetch 仕様の CORB 節は 2018年5月から nosniff と 206 応答の扱いをカバーしている**が、**CORB の確認sniffingは標準化されていない**。実装追跡バグとして Chrome（crbug 268640 / 802835）、Edge、Firefox（bugzilla 1459357）、Safari/WebKit（webkit bug 185331）を列挙。

〔補足（一般知識・ハンティング観点）〕上の一次情報から、クライアントサイド脆弱性ハンティングで直接使える判断材料は次の通り。(1) **JSON APIが機微データを返すのに `)]}'` 等のプレフィクスも `nosniff` も無い**場合、CORB/ORB の保護は「sniff が成功するか」に依存する。空でないオブジェクトリテラルなら保護されやすいが、**配列やスカラを返すエンドポイントは保護が弱い**（explainer が「完全なJSONバリデータが必要」と認めている領域）。(2) **`Content-Type` が無い応答は CORB 保護されない**と明記されているので、機微データを Content-Type 無しで返すエンドポイントは XSSI の検討対象。(3) **JSONP は明示的に保護外**であり、コールバック名を制御できる JSONP エンドポイントは従来どおり情報漏洩の経路。(4) `<script>` からの読み込みで**構文エラーの有無（`window.onerror`）が観測できる**ことは、CORB の有無を外から判定する副次的シグナルになる。

## 補足資料C: ORB（Opaque Response Blocking / CORB++）— CORB の後継

出典:
- **https://raw.githubusercontent.com/annevk/orb/main/README.md**（提案リポジトリ本文、"Opaque Response Blocking (ORB, aka CORB++)"）
- **https://raw.githubusercontent.com/chromium/chromium/main/services/network/public/cpp/orb/orb_api.h** と **orb_impl.h**（Chromium の実装API）

### C-1. 位置づけと状態

- 目的（逐語）:
> To block as many opaque responses as possible while remaining web compatible.
- 高レベルの考え方: **CSS・JavaScript・画像・メディア（音声/動画）は CORS なしでクロスオリジン要求できる。CSS 以外は MIME タイプの強制がない。理想的には、これらのいずれでもない応答を可能な限りブロックしてサイドチャネルからの内容漏洩を避ける。**
- 状態（README 記載）: **Fetch 標準へ PR #1442 で上流化作業中**であり、統合後のプレビューは `https://whatpr.org/fetch/1442.html` で見られるとされる。PR は "mvp" ラベルの issue 解決待ちで、**PR の方が README 本文より進んでいるので、実装者・レビュアは PR を出発点にすべき**と明記されている。
- **本環境で取得した `whatwg/fetch` の `fetch.bs`（main）には CORB も ORB も現れなかった**（前掲 grep 結果）。つまり「Fetch 標準本体に ORB が入った」とは本ノートの取得データからは言えない。**一方 Chromium 側には `services/network/public/cpp/orb/` として ORB の実装が存在する**（下記）。
- 謝辞に Jake Archibald、Lukasz Anforowicz、Nathan Froyd、Chromium の CORB プロジェクト関係者が挙がっており、CORB の系譜であることが読み取れる。

### C-2. ORB が導入する MIME タイプ集合（README 逐語の定義を日本語化）

| 集合 | 定義 |
|---|---|
| **opaque-safelisted MIME type** | JavaScript MIME タイプ、または essence が `text/css` もしくは `image/svg+xml` のもの |
| **opaque-blocklisted MIME type** | HTML MIME タイプ、JSON MIME タイプ、XML MIME タイプ |
| **opaque-blocklisted-never-sniffed MIME type** | （sniff せず常にブロックする型）`application/pdf`、`application/zip`、`application/gzip`、`application/x-gzip`、`application/x-protobuf`、`application/x-protobuffer`、`application/dash+xml`、`application/vnd.apple.mpegurl`、`audio/mpegurl`、`multipart/byteranges`、`multipart/signed`、`text/event-stream`、`text/csv`、`text/vtt`、および Microsoft Office 系の多数の型（`application/msword`、`application/vnd.ms-excel`、`application/vnd.openxmlformats-officedocument.*`、macroenabled 系、`application/vnd.ces-quick*` 等） |

**CORB との最大の違いはここ**: CORB が保護したのは HTML/XML/JSON の3種だったが、ORB は「安全な型（JS・CSS・SVG・画像・メディア）を許可リストにし、PDF・ZIP・CSV・SSE・Office文書などは sniff すらせずブロックする」方向に拡張している（CORB explainer の "Future work" が述べていた方向性の具体化）。

### C-3. ORB のアルゴリズム（README の手順を要約）

1. 応答ヘッダから MIME タイプを取り出し、`nosniff` を判定する。
2. MIME タイプが取れた場合: **opaque-safelisted なら許可**／**opaque-blocklisted-never-sniffed なら拒否**／**status 206 かつ opaque-blocklisted なら拒否**／**`nosniff` が真で opaque-blocklisted または essence が `text/plain` なら拒否**。
3. request の **no-cors media request state が "subsequent" なら許可**（メディアの続きの range 要求）。
4. 206 応答で partial response の検証が invalid なら拒否。
5. **応答の先頭 1024 バイト（または EOF まで）を待つ。**
6. **音声/動画のパターンマッチに当たれば**、state が "initial" で status が 200/206 のときだけ許可（それ以外は拒否）。
7. state が "N/A" でなければ拒否。
8. **画像のパターンマッチに当たれば許可。**
9. `nosniff` が真なら拒否。status が ok でなければ拒否。MIME タイプが取れていなければ許可。
10. essence が `audio/`・`image/`・`video/` で始まるなら拒否。
11. **ボディの EOF まで待ち、「JavaScript としてパースでき、かつ JSON としてパースできない」なら許可、そうでなければ拒否。** README は注記で「JavaScript の部分パースは現実的でないため、この段に到達した応答のサイズが漏れる可能性がある」と認めている（annevk/orb issue #22）。

README の注記（逐語）:
> Note: responses for which the above algorithm returns true and contain secrets are strongly encouraged to be protected using `Cross-Origin-Resource-Policy`.

→ **ORB を通過してしまう（＝許可される）応答に秘密が含まれるなら、`Cross-Origin-Resource-Policy` で守れ**、という明示的な指示。教科書ではここを「CORB/ORB は網であって鍵ではない。鍵は CORP」と要約できる。

その他 README の "Findings":
- `X-Content-Type-Options` が画像/メディアの sniff の**後**にしか効かないのは残念だが、当時 Firefox が画像に対して強制するのはウェブ互換ではなかった。
- スタイルシート取得の仕組み上、**MIME タイプが取り出せない応答は保護できない**。
- **メディア要素は常に range 要求を行う。**
- 実装上の注意: **"subsequent" の設定は容易に侵害されないプロセスで行うのが望ましい**（値を偽装できれば ORB を回避できるため）。信頼できるプロセスが「同じURLの応答が過去に音声/動画として sniff された」と検証できる場合にのみ "subsequent" を許すべき。

〔補足（一般知識・ハンティング観点）〕最後の一文は攻撃者視点そのもので、**レンダラ（＝侵害されうる側）が申告する状態をネットワーク側が信じると保護が抜ける**という、記事part2のテーマ（特権プロセスとサンドボックスの責務分離）と同じ構図である。

### C-4. Chromium 実装から読み取れること（orb_api.h / orb_impl.h）

`services/network/public/cpp/orb/orb_api.h` の要点（逐語の識別子とコメント）:
```c
// Used to strip response headers if CORB made a decision to block the response.
void SanitizeBlockedResponseHeaders(network::mojom::URLResponseHead& response);

// Per-URLLoaderFactory state (used by ORB for marking specific URLs as media
// and allowing them in subsequent range requests;  constructed and passed both
// for CORB and ORB for consistency and ease of implementation).
using PerFactoryState = std::set<GURL>;

// ResponseAnalyzer is a pure, virtual interface that can be implemented by
// either CORB or ORB.
class ResponseAnalyzer {
  enum class Decision { kAllow, kBlock, kSniffMore, };
  enum class BlockedResponseHandling { kEmptyResponse, kNetworkError, };
```
読み取れる事実:
- **`ResponseAnalyzer` は CORB でも ORB でも実装できる純粋仮想インタフェース**として定義されており、Chromium 内部で両者が同じ枠組みに載っている。
- 判定結果は **`kAllow` / `kBlock` / `kSniffMore`** の3値。**`kSniffMore` の存在が「ヘッダだけでは決まらず本文の先頭を読む」という CORB/ORB 共通の設計**を示す（記事 Step 3 の「先頭数バイトを見る」と直結）。
- ブロックの通知方法が **`kEmptyResponse`（空応答）** と **`kNetworkError`（ネットワークエラー）** の2通りある。**CORB explainer が述べる「空ボディ＋ヘッダ除去」は前者**であり、ORB ではネットワークエラーとして見せる選択肢もあることがわかる（レンダラ側から観測される挙動が変わるため、診断時の見分けに関わる）。
- `SanitizeBlockedResponseHeaders` というAPIが「ブロック時にヘッダを剥がす」処理として存在する（explainer の記述と実装が対応）。

## 補足資料D: Chromium 公式 "Life of a Navigation" / "Navigation Concepts"（記事本文の現在版・詳細版）

出典:
- **https://raw.githubusercontent.com/chromium/chromium/main/docs/navigation.md**（"Life of a Navigation"）
- **https://raw.githubusercontent.com/chromium/chromium/main/docs/navigation_concepts.md**（"Navigation Concepts"）
- **https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md**（Spare Process の定義）
- **https://raw.githubusercontent.com/chromium/chromium/main/docs/render_document.md**（RenderDocument）

記事（2018年）は概説であり、以下は同じ題材を扱う**現行の Chromium 公式ドキュメント**の内容。記事の5ステップと対照させると、記事が省いた分岐と厳密な定義が埋まる。

### D-1. Life of a Navigation の流れ（記事との対照）

| 段階 | Chromium ドキュメントの記述 | 記事（part2）との関係 |
|---|---|---|
| **BeforeUnload** | URLが入力されたら、**ナビゲーションの最初のステップは、既に文書が読み込まれている場合に前の文書の `beforeunload` ハンドラを実行すること**。ユーザーがキャンセルすればナビゲーションは中止され、それ以上の作業は行われない | 記事は `beforeunload` を「別サイトへ移動するとき」の節で後回しに説明しているが、**Chromium の整理では beforeunload がステップ1**。記事の「ブラウザプロセスは現在のレンダラに確認を取らねばならない」と同じ話 |
| **Network Request and Response** | 指定URLへネットワーク要求を出す。**ただしすべてのナビゲーションが実際のネットワークに行くわけではない**（ServiceWorker、WebUI、キャッシュ、`data:` 等）。HTTP応答コードで 2xx / 3xx / 4xx・5xx を判別 | 記事の Step 2・Step 3。記事が触れていない「ネットワークに行かない経路」を明示している |
| **非コミットで終わる2ケース** | **(1) HTTP 204 / 205**（成功だが内容がないので**現在の文書がアクティブのまま残る**）、**(2) `Content-Disposition` 応答ヘッダでダウンロード扱いになる場合** | 記事は「zipならダウンロードマネージャへ」とだけ述べた。**204/205 と `Content-Disposition` は記事に無い重要な分岐**で、「アドレスバーと表示内容の不一致」を論じる際の中心材料 |
| **リダイレクト** | 応答コードと `Location` ヘッダに基づいて別の要求を出し、**エラーか成功応答に至るまでリダイレクトを追い続ける** | 記事の「HTTP 301 を受けたら別のURL要求をやり直す」の詳細版 |
| **MIME sniffing の条件** | リダイレクトが尽きたら、ネットワークスタックが sniffing の必要性を判断する。**必要になるのは、応答が 204/205 でもダウンロードでもなく、`Content-Type` 応答ヘッダを既に持たず、`X-Content-Type-Options: nosniff` も含まない場合**。必要なら**コミット前に実データの小さなチャンクを読む** | 記事の「先頭数バイトを見る」に対応。なお**実装（`net/base/mime_sniffer.cc`、本ノート補足資料A）では `text/plain` など特定の Content-Type も sniff 対象**であり、この docs の記述は概説である点に注意 |
| **Commit** | 応答がネットワークスタックからブラウザプロセスへ渡る。**ブラウザプロセスは、応答のオリジンとヘッダ、および現在のプロセスモデル・分離ポリシーに基づいて適切なレンダラプロセスを選ぶ**。**応答ヘッダがオリジンに影響することがある**（例: `Content-Security-Policy: sandbox;` によって文書が opaque origin になる）。その後 **"commit" IPC** で応答を送り、レンダラが文書を作って **Mojo コールバックで確認応答**を返すのを待つ。**ブラウザプロセスがこの確認応答を受け取った時点が、そのナビゲーションの権威ある _commit 時刻_** であり、**ブラウザプロセスが新しい文書を反映してセキュリティ状態を変え、前の文書のセッション履歴エントリを作る**のはこの時点 | 記事 Step 5 の厳密版。**「commit の確定はレンダラからの ack 受領時」「セキュリティ状態の切り替えはそこで起きる」**という2点が、URL spoofing を論じるときの土台になる |
| **旧文書の unload** | **同一レンダラプロセス内に留まるナビゲーションでは、新文書の作成前に Blink が旧文書を unload する（登録済み unload ハンドラの実行を含む）。クロスプロセスになるナビゲーションでは、unload ハンドラは前の文書のプロセスで、新プロセスでの新文書作成と並行して実行される** | 記事の「旧レンダラは `unload` を処理するために生かしておかれる」の詳細。**同一プロセス時と跨ぐ時で順序が違う**点は記事に無い |
| **Loading** | ナビゲーション完了後もユーザーにはまだ新ページは見えていない。**Chromium は「navigation フェーズ」と「loading フェーズ」を分ける**。loading は残りの応答データの読み取り・パース・描画・スクリプト実行・サブリソース読み込みからなる。**分ける主な理由はコミット前後でエラーの扱いが違うこと**: サーバがHTTPエラーコードを返した場合も**ブラウザは文書をコミットする（それがエラーページ）**。逆に成功してコミットし loading に入った後で接続が切れた場合は、**エラーページを出さずに読めた分だけ表示する** | 記事の「コミット確認をもって navigation 完了、document loading フェーズ開始」および Extra Step に対応する |

### D-2. WebContentsObserver のイベント（観測点の公式な名前）

Chromium は各段階を `WebContentsObserver` のメソッドとして公開している（同 docs より）:

| 分類 | メソッド | 呼ばれるタイミング |
|---|---|---|
| Navigation | `DidStartNavigation` | **`beforeunload` ハンドラ実行後、最初のネットワーク要求の前** |
| Navigation | `DidRedirectNavigation` | サーバリダイレクトに遭遇するたび |
| Navigation | `ReadyToCommitNavigation` | **ブラウザプロセスがコミットすると決め、レンダラプロセスを選んだが、まだ送っていない時点**（same-document ナビゲーションでは呼ばれない） |
| Navigation | `DidFinishNavigation` | コミット完了時（成功文書でもエラーページでも） |
| Loading | `DidStartLoading` | WebContents ごとに1回、ナビゲーション開始直前（`beforeunload` 実行後）。**ブラウザUIがスピナーを出し始めるのと等価**で、`DidStartNavigation` より前 |
| Loading | `DOMContentLoaded` | RenderFrameHost ごと。文書自体の読み込み完了（サブリソースは未完了でよい） |
| Loading | `DidFinishLoad` | RenderFrameHost ごと。文書とすべてのサブリソースの読み込み完了 |
| Loading | `DidStopLoading` | WebContents ごとに1回。**トップレベル文書・そのサブリソース・全サブフレーム・そのサブリソースがすべて完了**した時。**ブラウザUIがスピナーを止めるのと等価** |
| Loading | `DidFailLoad` | RenderFrameHost ごと。応答データを読み切る前に接続が切れた等の失敗時 |

→ **記事 Extra Step の「スピナーが止まる」は `DidStopLoading` に対応**し、「全フレームの `onload` 完了後」という記事の記述と整合する。

### D-3. NavigationThrottle（ナビゲーションへの介入点）

同 docs より: **NavigationThrottle はナビゲーションの観測・遅延・ブロック・キャンセルを可能にする**。主なイベントは **`WillStartRequest`（ネットワーク要求前）／`WillRedirectRequest`（リダイレクト時）／`WillProcessResponse`（応答受領後）** で、**URLLoader を必要とするナビゲーションでのみ呼ばれる**。same-document ナビゲーションや `about:blank` のような非URLLoaderナビゲーションを捕まえたい場合は別の登録経路が必要で、`WillCommitWithoutUrlLoader` が1回だけ来る。**プレレンダリング済みページのアクティベーションや back-forward cache からの復帰のような page-activation ナビゲーションは、NavigationThrottle を完全にスキップする。**

〔補足（一般知識）〕page-activation が throttle を飛ばすという事実は、**拡張機能やエンタープライズポリシー、あるいはセキュリティ機能がナビゲーションを検査する前提で作られている場合、prerender / BFCache 経由のアクティベーションが検査を通らない**可能性を示唆する観点になる（実際の可否は当該機能の実装次第）。

### D-4. Navigation Concepts（URL spoofing を論じるための必読概念）

**(a) same-document と cross-document**: cross-document は既存文書を置き換える新文書を作るもの。same-document は新文書を作らず状態だけ変えるが、**セッション履歴エントリは作られる**。same-document になるのは、既存文書内のフラグメントへの移動（`https://foo.com/1.html#fragment`）、`history.pushState()` / `history.replaceState()`、`document.open()` による新文書作成（**呼び出し元の文書に合わせて URL が変わることがあり、その呼び出し元は別フレームでもありうる**）、同一文書に留まるセッション履歴ナビゲーション。

**(b) browser-initiated と renderer-initiated**: **browser-initiated の方が信頼される**（通常はアドレスバーやブックマークというブラウザUIへのユーザー操作の結果であり、`file://` や `chrome://` URL へ行ける高い権限を持つ）。**renderer-initiated はレンダラプロセス起点**（リンククリックやJSコード）で、**user activation を伴えば "user-initiated" とみなされるものもある**（リンク）が、スクリプトによるナビゲーションはそうではない。**renderer-initiated は信頼度が低く、特権URLを対象にできない**。同 docs はその理由を明示している（要旨）: **ウェブコンテンツが `file://` や `chrome://` へナビゲートできてしまうと権限昇格の踏み台（ファイルを開いて別のバグでその内容にアクセスする等）やプライバシー上の懸念（存在や内容をサイドチャネルで漏らす）になり、中程度の深刻度のリスクになる**。
この区別は「**進行中のナビゲーションを新しいナビゲーションがキャンセルすべきか**」「**ナビゲーション先URLをアドレスバーに表示するか**」という判断にも使われる。

**(c) last committed / pending / visible URL（この3つの区別が URL spoofing の核心）**:
- **last committed**: いま実際にフレームに入っている文書の URL/Origin。**アドレスバーの表示とは無関係**。アドレスバーに明示的に紐づく機能（鍵アイコン等）以外は、ほぼ常にこれを使うべき。コミットが一度も起きていなければ空。
- **pending**: メインフレームのナビゲーションが開始したがまだコミットしていない URL。**ユーザーに見えることもあるが常にではない**。
- **visible**: **アドレスバーが表示している URL**。同 docs は「**URL spoof attack（攻撃者が被害者のURLから来たかのように内容を表示できる攻撃）に悪用されにくく安全な場合にのみ pending URL を表示し、そうでなければ last committed を表示する**」と慎重に管理していると述べ、規則を列挙する:
  - **browser-initiated（入力URLやブックマーク。セッション履歴ナビゲーションを除く）では pending URL** を表示。ナビゲーションがキャンセルされると空になる。
  - **renderer-initiated では last committed URL** を表示（攻撃者が文書内容と pending URL を制御できる可能性があるため）。進行中のナビゲーションが無いときもこれ。
  - **renderer-initiated のURLが pending 中に見えるのは、未変更の新しいタブで開く場合のみ**（役に立たない `about:blank` を見せないため）で、**他の文書が新タブの initial empty document にアクセスしようとするまで**。同 docs が挙げる攻撃シナリオ（要旨）: **攻撃者のウィンドウが遅い被害者URLで新しいタブを開き、あたかもその遅いURLがコミットしたかのように initial `about:blank` 文書へコンテンツを注入する**。これが起きた場合、**visible URL は URL spoof を避けるために `about:blank` に戻る**。新タブで最初のナビゲーションがコミットした後は、pending の renderer-initiated URL はもう表示されない。

〔補足（一般知識）〕この節は「アドレスバーは last committed を基本とし、安全な場合だけ pending を見せる」という**設計上の防御そのもの**の説明であり、URL spoofing の報告を書くときは「どの規則が破れているのか」をこの語彙で述べられると強い。記事part2の Step 5（コミット時にアドレスバーが更新される）と直結する。

**(d) Virtual URL**: 一部の機能は**実際にコミットされた URL とは違う表示**をユーザーに見せる（`view-source:` プレフィクスは実際のコミットURLには無い、DOM Distiller は複雑な distiller URL ではなく元URLを表示する）。BrowserURLHandler で実装される。

**(e) server redirect と client redirect の違い**:
- **server redirect**: **文書がコミットする前**に 300番台の応答コードを受け取り、別URL（クロスオリジンでもよい）を要求する。**新しい要求は通常 HTTP GET になるが、307/308 は元のメソッドとボディを保持する**。**単一の NavigationRequest が管理し、セッション履歴に文書はコミットされないが、元URLはリダイレクトチェーンに残る。**
- **client redirect**: **文書がコミットした後**に、HTML（meta タグやJavaScript）が新文書の要求を指示するもの。**Blink は経過時間などから client redirect と分類する**。この場合**リダイレクトした文書のセッション履歴項目が作られるが、実際の宛先文書がコミットすると置き換えられる**。**2つ目のナビゲーションには別の NavigationRequest が使われる。**

**(f) 同時進行するナビゲーション**: 各フレームは独立で、フレームごとに NavigationRequest が付く。1フレーム内で同時に存在しうるのは、**(i) 最終応答を待っている cross-document ナビゲーション（フレームあたり最大1つ。この段階は数秒かかりうる。`about:blank`、`about:srcdoc`、MHTML のようにネットワーク要求を使わない特殊ケースはこの段階を飛ばす）**、**(ii) "ready to commit" と "commit" の間にある cross-document ナビゲーションのキュー（レンダラが遅いと複数同時になりうる。通常は短命）**、**(iii) same-document ナビゲーション（renderer-initiated の `pushState` やフラグメントリンク、browser-initiated の omnibox でのフラグメント変更）**。

**(g) ナビゲーションをキャンセルする規則**: **乱用ページがユーザーを移動させないようにするのを防ぎたい**ので、一般に新しいナビゲーションは既存のものをキャンセルするが、例外として **「進行中の browser-initiated ナビゲーションがあり、新しい renderer-initiated ナビゲーションが user activation を欠く場合に限り、後者は無視される」**（`Navigator::ShouldIgnoreIncomingRendererRequest`）。ユーザーをページに閉じ込める行為への対策として **History Manipulation Intervention** も参照されている。また同 docs は **「ナビゲーションをキャンセルして新しく始めることでリダイレクトを模倣するのは安全ではない」**と強く注意している（ReloadType、CSP 状態、`Sec-Fetch-Metadata` 状態、リダイレクトチェーン等の文脈が失われるため）。

**(h) エラーページ**: サーバがカスタムエラーページ（4xx/5xx）を返した場合は**成功ナビゲーションとほぼ同様にそのサイト用のプロセスで描画**され、`NavigationHandle::IsErrorPage()` が true になる。**サーバから応答が得られない場合（DNS失敗等）のエラーページは、メインフレームでは特別なエラーページ用プロセス**（どのサイトにも属さず、ウェブからの信頼できない内容を含まない）で表示される。**ブロックされた場合（拡張APIやNavigationThrottleによる）も同様に特別なプロセスのエラーページ**になるが、**ブロック時は後で再読み込みを試みない**。

**(i) インタースティシャル**: **コミット済みのエラーページとして実装されている**（かつてはオーバーレイだったが現在は許されない）。インタースティシャル表示時に元の進行中ナビゲーションはキャンセルされ、ユーザーが「続行」を選ぶとナビゲーションをやり直す。**ページがコミットした後にインタースティシャルが出ることもある**（サブリソースの読み込みが Safe Browsing エラーを引き起こした場合など）。その場合は元のページからインタースティシャルへナビゲートして NavigationEntry を置き換えるが、**元の NavigationEntry は `entry_replaced_by_post_commit_error_` に保存され、ユーザーがインタースティシャルを閉じて戻れるようにしてある**。

〔補足（一般知識）〕記事 Step 3 の「SafeBrowsing が警告ページを表示するようアラートする」は、実装としては**インタースティシャル＝コミット済みエラーページ**であり、**サブリソース起因なら「ページがコミットした後」にも起こる**——この2点が Chromium docs 側から補える。警告の迂回やクリックスルー後の挙動を検証する際の前提になる。

### D-5. Spare Process（記事 Step 4 の最適化の現在形）

`docs/process_model_and_site_isolation.md` の逐語（"Spare Process" の項）:
> **Spare Process**: Chromium often creates a spare RenderProcessHost with a live but unlocked renderer process, which is used the next time a renderer process is needed. This avoids the need to wait for a new process to start.

→ **「生きているがまだどのサイトにもロックされていない（unlocked）レンダラプロセス」を予備として持ち、次にレンダラが必要になったときに使う**。記事が「ネットワーク要求と並行してレンダラプロセスを探すか起動する」と書いた最適化の、**プロセスモデル側の用語**がこれである。記事の「クロスサイトへリダイレクトされるとスタンバイプロセスが使われないことがある」という記述は、**サイトにロックされたプロセスは別サイトに再利用できない**というサイト分離の帰結として読める。

### D-6. RenderDocument（記事にはない、現在進行中の変更）

`docs/render_document.md` より: **従来 Chromium は「レンダラプロセスが前と違う場合にのみ」新しい `RenderFrameHost` に切り替えていたが、RenderDocument プロジェクトはこれを無条件に切り替えるようにするもの**。効果として、**同一 RenderFrameHost 内でナビゲートするためのロジックが不要になる／ブラウザプロセスの RenderFrameHost が Document と 1:1 になる／「間違った文書のデータや権能を再利用する」類のセキュリティバグを防げる**。段階は **crashed-frames → subframes → main frames** の3つがフラグ付きで存在する。

〔補足（一般知識）〕「RenderFrameHost と Document が 1:1 でない」状態が**取り違えによるセキュリティバグの温床**だと公式に述べられている点は、記事part2で学ぶ「プロセス／文書／ナビゲーションの対応関係」を脆弱性の言葉に翻訳する良い材料になる。

## 補足資料E: Navigation Preload のヘッダ名を一次情報で確定（記事の未確定点の解消）

**本ノート冒頭の Navigation Preload 節では「原文は『a header』とだけ書いてヘッダ名を明示していないため推測しない」と保留していた。第2パスで Service Worker 仕様のソースから確定できたので、ここで補う**（元の保留記述は正しいので削除しない）。

出典: **https://raw.githubusercontent.com/w3c/ServiceWorker/main/index.bs**（W3C Service Worker 仕様のソース）

仕様本文から読み取れる事実（逐語の定義名と値）:
- service worker registration は **`navigation preload enabled flag`**（初期値: 未設定）と **`navigation preload header value`**（バイト列。**初期値は `true`**）を持つ。
- `NavigationPreloadManager` の各メソッドが、この enabled フラグの設定／解除、header value の設定を行い、`getState()` が `enabled` と `headerValue` を返す。
- Handle Fetch の中で、**要求が navigation request であり、メソッドが `GET` であり、active worker の「扱うイベント型の集合」に `fetch` が含まれ、`all fetch listeners are empty flag` が立っていない**場合に、**navigation preload enabled flag が設定されていれば**次を行う:
  - 要求を**クローン**して preload 要求を作り、
  - **`Service-Worker-Navigation-Preload`** という名前のヘッダを、値を registration の `navigation preload header value` として**追加する**（該当行の逐語）:
    > [=header list/Append=] to |preloadRequestHeaders| a new [=header=] whose [=header/name=] is \`<code>Service-Worker-Navigation-Preload</code>\` and [=header/value=] is |registration|'s [=navigation preload header value=].
  - **preload 要求の service-workers mode を `none` に設定**する（＝この preload 要求自体は service worker を経由しない）。
  - **`in parallel` で fetch を走らせ**、fetchController の状態が `terminated` / `aborted` になったら中断する。応答が error 型なら `preloadResponse` を `TypeError` で reject し、そうでなければ preload の Response オブジェクトで resolve する。
- 上記の直後の分岐には、**navigation preload が有効でなくても、ユーザーエージェントが「fetch イベント生成と並行して投機的にネットワーク要求を出してよい」**という許可（"A user agent may speculatively dispatch a network request in parallel with creating a fetch event in order to minimize the bootstrap cost."）があり、同仕様には**静的ルーティング（router source）や race response**といった、より新しい仕組みも記述されている。

まとめ（教科書に書ける確定事項）:
1. **記事の「a header」は `Service-Worker-Navigation-Preload` である。**
2. **既定値は `true`** で、開発者は `registration.navigationPreload.setHeaderValue(value)` 相当の操作で任意の値に変えられる（仕様は `navigation preload header value` の設定として記述）。サーバはこのヘッダを見て「完全な文書ではなく更新分だけ返す」といった判断ができる、という記事の記述はこれで裏が取れる。
3. **preload が走る前提条件**は「navigation request」「`GET`」「active worker が `fetch` を扱う」「fetch リスナが空でない」「navigation preload が有効」。
4. **preload 要求は service-workers mode = `none`** なので、preload 自体が再び SW に捕まって無限に入れ子になることはない。

〔補足（一般知識・ハンティング観点）〕サーバ側が `Service-Worker-Navigation-Preload` の有無や値で**応答内容を切り替える**設計を採ると、**同じURLに対して「SWのpreload経由」と「通常のナビゲーション」で別の内容が返る**ことになる。キャッシュキーにこのヘッダが含まれない場合のキャッシュ汚染、あるいは「preload用の軽量応答」がセキュリティヘッダ（CSP/COOP/COEP等）を欠く、といった不整合は検証に値する観点である（一般論であり、特定サイトの挙動を主張するものではない）。

## 読者が自分で開くべき資料（第2パスでの更新）

第1パスの「読者が自分で開くべき資料」節は有効なので残す。第2パスで**状態が変わったもの／新たに推奨するもの**を以下に追記する。

### 更新1. https://www.chromium.org/Home/chromium-security/corb-for-developers （CORB 公式解説）
- **状態**: 依然として本環境からは取得できない（**egress proxy が `www.chromium.org` への CONNECT を 403 で拒否**。第1パスの「接続不能(000)」はこの403が原因）。
- **ただし内容の大半は代替一次情報で埋めた**: Chromium ソースツリーの `services/network/cross_origin_read_blocking_explainer.md` から、保護対象Content-Type・ブロックの見え方（空ボディ＋ヘッダ除去）・`)]}'` 等のJSONパーサ破壊プレフィクスとの関係・`nosniff` を付けるべき理由・Site Isolation と Spectre という動機まで取得済み（**補足資料B**）。ORB との差分は **補足資料C**。
- **なお読者がこのページを開く価値があるポイント**（補足資料Bで埋まらない可能性がある部分）:
  1. **開発者向けの「あなたのサイトが壊れたときの対処」**（explainer は設計文書なので、開発者向けの実務手順はページ側にある可能性がある）。
  2. **DevTools のコンソールに出る CORB 警告メッセージの文面と読み方**。
  3. **ページが最後に更新された時点での「CORB から ORB への移行」に関する公式アナウンス**の有無。
  4. explainer に無い**FAQ形式の設問**（どのヘッダを付ければよいか、どの応答が影響を受けるか）。
- **代替手段**: (a) 本ノート補足資料B（explainer 全体の要約・主要リストは逐語で採録済み）、(b) `https://source.chromium.org/chromium/chromium/src/+/main:services/network/cross_origin_read_blocking_explainer.md`（同じ文書のブラウザ閲覧版）、(c) `https://github.com/chromium/chromium/blob/main/services/network/cross_origin_read_blocking_explainer.md`、(d) `https://web.archive.org/web/2023/https://www.chromium.org/Home/chromium-security/corb-for-developers/`（本環境からは到達不能だが、読者の環境なら開ける可能性が高い）。

### 更新2. 記事の図（PNG 12点）
- **状態**: 第2パスでも取得できず（CDN・アーカイブ・テキスト抽出プロキシすべて egress 拒否、`storage.googleapis.com` は 403）。キャプションと alt は第1パスで逐語取得済み。
- **読者がやるべきこと**: 記事URLを直接開き、**第1パスの図一覧表（Figure 1〜12）と対応させながら矢印の向きを確認する**。特に **Figure 9（新レンダラへのレンダリング指示と旧レンダラへの unload 指示の2本のIPC）** は、補足資料D-1 の「同一プロセスなら新文書作成前に unload、クロスプロセスなら並行して unload」という現行仕様と突き合わせると理解が深まる。

### 更新3. 新たに推奨する無料の一次資料（すべて本ノートで取得・引用済み。読者が原典を確認するためのURL）
| 資料 | URL | 何を学ぶために読むか |
|---|---|---|
| Chromium "Life of a Navigation" | https://chromium.googlesource.com/chromium/src/+/main/docs/navigation.md ／ https://github.com/chromium/chromium/blob/main/docs/navigation.md | 記事part2の**現行・詳細版**。204/205 と `Content-Disposition` による非コミット、commit の厳密な定義（レンダラからの ack 受領時）、unload の順序、navigation と loading の分離、`WebContentsObserver` の各イベント名 |
| Chromium "Navigation Concepts" | https://github.com/chromium/chromium/blob/main/docs/navigation_concepts.md | **URL spoofing を語る語彙**（last committed / pending / visible URL）、browser-initiated と renderer-initiated の信頼差、server redirect と client redirect、ナビゲーションキャンセル規則、エラーページとインタースティシャル |
| Chromium CORB explainer | https://github.com/chromium/chromium/blob/main/services/network/cross_origin_read_blocking_explainer.md | **記事 Step 3 の CORB の中身**。XSSI と Spectre、保護型の判定表、互換性の実測値 |
| ORB 提案 (annevk/orb) | https://github.com/annevk/orb | CORB の後継。**許可リスト方式**、`never-sniffed` 型（PDF/ZIP/CSV/SSE 等）、`Cross-Origin-Resource-Policy` を使えという明示的推奨 |
| Fetch 標準の ORB 統合プレビュー | https://whatpr.org/fetch/1442.html （annevk/orb README が案内するURL） | ORB の**仕様化された最新版**。README より進んでいると README 自身が述べている |
| Service Worker 仕様 | https://github.com/w3c/ServiceWorker/blob/main/index.bs （レンダリング版: https://w3c.github.io/ServiceWorker/ ） | **`Service-Worker-Navigation-Preload` ヘッダ**の定義、preload の発動条件、静的ルーティングや race response といった記事以後の新機能 |
| Chromium プロセスモデルとサイト分離 | https://github.com/chromium/chromium/blob/main/docs/process_model_and_site_isolation.md | **Spare Process**（記事 Step 4 の最適化）、エラーページ専用プロセス、サイト分離の全体像 |
| RenderDocument | https://github.com/chromium/chromium/blob/main/docs/render_document.md | RenderFrameHost と Document の 1:1 化という現在進行中の変更と、その**セキュリティ上の動機** |
| Life of a Navigation 講演（Chrome University） | https://youtu.be/mX7jQsGCF6E ／ スライド: https://docs.google.com/presentation/d/1YVqDmbXI0cllpfXD7TuewiexDNZYfwk6fRdmoXJbBlM/edit （`docs/navigation.md` が案内） | 動画・スライドなので自動取得できない。**記事part2と同じ流れを Chromium 開発者の言葉で通して聞く**ために有用 |
| CORB デモページ | https://anforowicz.github.io/xsdb-demo/index.html （CORB explainer が案内） | CORB のブロックを**ブラウザ上で実際に観測**するため（本環境未取得） |
| Chromium docs（関連） | `docs/session_history.md`、`docs/special_case_urls.md`、`docs/security/origin-vs-url.md`（いずれも github.com/chromium/chromium/blob/main/ 配下） | それぞれ**戻る/進むの仕組み**、**特殊URL（`about:blank`、`data:`、`chrome://` 等）のナビゲーション上の例外**、**Origin と URL のどちらで判定すべきか**。`navigation_concepts.md` が参照している |
