# ナビゲーションで何が起きるか — ブラウザがページを表示する準備をする全工程

> **この節で分かること**
> - URL をアドレスバーに入れてから画面にページが出るまでの「ナビゲーション」を、ブラウザプロセスのスレッド間 IPC の流れとして順を追って説明できる。
> - MIME Type sniffing がなぜ存在し、`Content-Type` の欠落・誤設定・`X-Content-Type-Options: nosniff` の有無がどうやって XSS につながるかを、Chromium のソースコードを根拠に説明できる。
> - CORB／ORB が「どのデータを」「いつ」「なぜ」レンダラに渡さないのか、そして `Cross-Origin-Resource-Policy` が最後の鍵である理由を説明できる。
> - コミット（commit）の瞬間にオリジンとアドレスバーが確定するという仕組みから、URL spoofing を論じる語彙（last committed / pending / visible URL）を使えるようになる。
> - Service Worker と Navigation Preload がナビゲーションにどう割り込むか、`Service-Worker-Navigation-Preload` ヘッダとは何かを説明できる。
> - `beforeunload` / `unload` / `onload` の役割を区別し、「onload で読み込みは終わり」という前提がクライアントサイド診断でなぜ危険かを説明できる。

**元資料**: https://developer.chrome.com/blog/inside-browser-part2 （原典はレンダリング版が取得できず、GoogleChrome/developer.chrome.com リポジトリ上の原稿 Markdown から本文・見出し・図キャプション・注記を逐語取得。図の PNG 12 点のみ未取得。CORB/ORB・現行仕様は Chromium ソースツリーおよび W3C 仕様のソースから一次取得）

**関連する節**: 本節はシリーズ第2回「ナビゲーション」を扱う。プロセス／スレッド構成の全体像は第1回（`01-inside-browser-part1`）、コミット後にレンダラが HTML/CSS/JS をどう評価してページを描くかは第3回（`03-inside-browser-part3`）で扱う。

---

## 1. なぜ「ナビゲーション」だけを取り出して学ぶのか

### ナビゲーションとは何か

**ナビゲーション（navigation）とは、ユーザーがサイトを要求してから、ブラウザがそのページをレンダリングする準備を整えるまでの工程のこと。** アドレスバーに URL を打ち込む、リンクをクリックする、`window.location` を書き換える——こうした「別のページへ移る」操作すべてが起点になる。

この節が題材にするのは、次のごく単純なユースケースだ。「ブラウザに URL を打ち込む → ブラウザがインターネットからデータを取得する → ページを表示する」。原文はこの中でも、**ユーザーがサイトを要求し、ブラウザがページのレンダリング準備をする部分＝ナビゲーション**に焦点を当てる。原文の一文を引く。

> In this post, we'll focus on the part where a user requests a site and the browser prepares to render a page - also known as a navigation.

### なぜセキュリティの視点でここが重要なのか（設計意図）

近代ブラウザは仕事を複数のプロセスに分けている。**ブラウザプロセス（browser process）**は特権を持つ司令塔で、**レンダラプロセス（renderer process）**はサンドボックス（外部から来たコードを閉じ込めて動かす隔離された箱）の中で Web ページを描く側だ。

この分担が、ナビゲーションを独立して学ぶ理由そのものになる。ナビゲーションは**ブラウザプロセス（特権側）が主導し、レンダラ（攻撃者の制御下に置かれうる側）は要求元・被通知者にすぎない**。オリジンの決定、アドレスバーの表示、鍵アイコンなどのセキュリティ表示は、すべてブラウザプロセス側の責務だ。

〔補足〕ここが本章を通じての勘所になる。もしブラウザプロセスがレンダラの主張を鵜呑みにすると、「アドレスバーは銀行の URL なのに中身は攻撃者のページ」という URL spoofing や、サイト分離（Site Isolation）のバイパスが起きる。ナビゲーションの各ステップで「いまどちらのプロセスが何を決めているか」を追うことが、脆弱性を見つける目になる。

## 2. すべてはブラウザプロセスから始まる

### ブラウザプロセスの中のスレッド

シリーズ第1回で見たとおり、**タブの外側で起きることはすべてブラウザプロセスが扱う**。ブラウザプロセスは複数のスレッド（1 つのプロセスの中で並行して動く実行の流れ）を持つ。ここでいう「スレッド」は、UI 描画・ネットワーク・ファイルアクセスといった役割ごとに分かれた作業係だと考えればよい。

| スレッド | 原文の説明（逐語） | 役割 |
|---|---|---|
| UI thread | "the UI thread which draws buttons and input fields of the browser" | ブラウザのボタン類・入力フィールドを描画する。アドレスバーへの入力を最初に処理する |
| network thread | "the network thread which deals with network stack to receive data from the internet" | ネットワークスタックを扱い、インターネットからデータを受け取る |
| storage thread | "the storage thread that controls access to the files" | ファイルへのアクセスを制御する |
| （その他） | "and more" | 上記以外にも存在する |

**アドレスバーに URL を入力すると、その入力はまずブラウザプロセスの UI スレッドが処理する。** 図キャプション（逐語）はこう書く。

> Figure 1: Browser UI at the top, diagram of the browser process with UI, network, and storage thread inside at the bottom

### IPC という言葉

このあと何度も出てくるのが **IPC（プロセス間通信, Inter-Process Communication）**だ。IPC とは、別々のプロセスがメッセージをやり取りする仕組みのこと。プロセスは互いのメモリを直接読めないので、「データの準備ができた」「このページを描け」といった指示は IPC を通じて送られる。ナビゲーションとは、突き詰めれば**スレッド間・プロセス間の IPC の連鎖**である。

## 3. ナビゲーション全工程の見取り図

まず全体像を1本の流れとして示す。以降の各ステップの詳細は、この地図の上のどの点かを意識しながら読むとよい。

```
[ユーザー] アドレスバーに入力
   │
   ▼
[ブラウザプロセス UIスレッド] 検索クエリか URL か判定（Step 1）
   │  Enter
   ▼
[UIスレッド → networkスレッド] ネットワーク要求開始・スピナー表示（Step 2）
   │                              ┊（並行）レンダラを投機的に確保/起動（Step 4の最適化）
   ▼
[networkスレッド] DNS lookup → TLS 接続 → HTTP 要求
   │  ← HTTP 301 等なら UIスレッドへ通知し別URLでやり直し
   ▼
[networkスレッド] レスポンス先頭を検査（Step 3）
   │  MIME sniffing / SafeBrowsing / CORB
   │  HTML → レンダラへ ／ zip 等 → ダウンロードマネージャへ
   ▼
[networkスレッド → UIスレッド]「データの準備ができた」（Step 4）
   │
   ▼
[UIスレッド] レンダラプロセスを確定
   │
   ▼
[ブラウザプロセス → レンダラ（IPC）] コミット＋データストリーム引き渡し（Step 5）
   │  ← レンダラがコミット確認（ack）を返す
   ▼
ナビゲーション完了 → document loading フェーズ開始
   アドレスバー更新・セキュリティ表示更新・セッション履歴更新（ディスク保存）
   │
   ▼
[レンダラ → ブラウザプロセス（IPC）] 全フレームの onload 完了後に通知 → スピナー停止（Extra）
```

同じ流れを表でも押さえておく。原文の記述を 1 本に整理したものだ。

| # | 主体 | 起きること |
|---|---|---|
| 0 | ユーザー | アドレスバーに入力 |
| 1 | ブラウザプロセス UIスレッド | 入力を受け取り「検索クエリか URL か」を判定 |
| 2 | UIスレッド → networkスレッド | Enter でネットワーク呼び出し開始。タブにスピナー表示。**同時に**遷移先向けのレンダラを投機的に確保/起動 |
| 3 | networkスレッド | DNS lookup、TLS 接続確立、HTTP 要求送出 |
| 3b | networkスレッド → UIスレッド | HTTP 301 等のリダイレクトヘッダを受けたら通知し、別 URL 要求としてやり直す |
| 4 | networkスレッド | レスポンスヘッダ＋payload 先頭数バイトを検査: MIME sniffing → HTML ならレンダラ行き / zip 等ならダウンロードマネージャ行き |
| 5 | networkスレッド | SafeBrowsing チェック、CORB チェック |
| 6 | networkスレッド → UIスレッド | 「データの準備ができた」と通知 |
| 7 | UIスレッド | レンダラプロセスを確定（投機起動が使えなければ別プロセス） |
| 8 | ブラウザプロセス → レンダラ（IPC） | **コミット**。データストリームも引き渡す |
| 9 | レンダラ → ブラウザプロセス | コミット確認。ナビゲーション完了、document loading フェーズ開始 |
| 10 | UIスレッド | アドレスバー更新、セキュリティ表示・サイト設定 UI 更新、セッション履歴更新（ディスクにも保存） |
| 11 | レンダラ → ブラウザプロセス（IPC） | 全フレームの `onload` 完了後に通知 → スピナー停止（ただし JS はこの後も動く） |

原典のレンダリング版には、これらの各ステップを描いた図が 12 点ある。本教科書の環境では図の画像そのものを取得できなかったため、次のブロックで原典を直接開くことを勧める。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Inside look at modern web browser (part 2) — https://developer.chrome.com/blog/inside-browser-part2
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 組織の egress プロキシが `developer.chrome.com:443` への接続を 403 で拒否。図の PNG 12 点も CDN の `storage.googleapis.com` が 403 のため未取得）。本文・見出し・図キャプション・注記は原稿 Markdown から逐語取得済みだが、**図そのものは現物を見るのが最良**である。
> **読みどころ**:
> 1. Figure 1〜12 の**プロセス／スレッド間の矢印の向き**。どちらが要求元でどちらが被通知者か、本文より図の方が IPC の方向関係が明瞭。
> 2. Figure 3（レスポンスヘッダ＋payload の絵）、Figure 6（コミットの IPC）、Figure 9（新レンダラへの描画指示と旧レンダラへの unload 指示という 2 本の IPC）。
> 3. Figure 10〜12 の Service Worker スコープ照合と Navigation Preload の並列実行。
> **代替手段**: 本節のシーケンス表と ASCII 図で流れは追える。記事末尾の part1/part3/part4 リンクからシリーズを通読すると理解が速い。

## 4. Step 1: 入力の処理 — 検索クエリか URL か

### アドレスバーは検索窓も兼ねている

ユーザーがアドレスバーに入力を始めると、UI スレッドが最初に問うのは **"Is this a search query or URL?"**（これは検索クエリか、それとも URL か？）である。Chrome のアドレスバー（**omnibox** とも呼ぶ。URL 入力と検索入力を兼ねた欄のこと）は検索窓も兼ねているため、UI スレッドは入力をパースして、**検索エンジンへ送るのか、要求されたサイトへ送るのか**を判断しなければならない。

図キャプション（逐語）は次のとおり。

> Figure 1: UI Thread asking if the input is a search query or a URL

（※原文では図番号「Figure 1」がここでも使われている。原稿ママ。）

### どこを突くのか

〔補足〕この「クエリか URL か」の曖昧さは、omnibox のパース差異として実際のバグ源になる。検証の観点になるのは次のようなものだ。

- **スキーム省略**（`example.com` を URL とみなすか検索語とみなすか）。
- **危険スキームの貼り付け**（`javascript:` や `data:` を貼ったときの扱い）。
- **Unicode / IDN（国際化ドメイン名）による見た目の同一化**。IDN とは、日本語などの非 ASCII 文字を含むドメイン名のこと。内部では **punycode**（`xn--` で始まる ASCII 表現）に変換される。見た目がそっくりな別文字（ホモグラフ）で正規サイトになりすます手口の温床になる。
- **`@` を含む URL のオーソリティ解釈**（`https://good.com@evil.com/` の実際の接続先はどこか）。

これらは「ブラウザプロセスがユーザー入力をどう解釈するか」という、まさに Step 1 の領域である。

## 5. Step 2: ナビゲーション開始 — DNS・TLS・リダイレクト

### Enter を押すと何が始まるか

ユーザーが Enter を押すと、**UI スレッドがサイトコンテンツを取得するためのネットワーク呼び出しを開始**する。タブの隅に**ローディングスピナー**が表示され、**network スレッドは DNS lookup（ドメイン名を IP アドレスに変換する問い合わせ）や、その要求のための TLS 接続確立といった適切なプロトコル処理**を行う。TLS とは通信を暗号化する仕組みで、`https://` の「s」がこれにあたる。

図キャプション（逐語）:

> Figure 2: the UI thread talking to the network thread to navigate to mysite.com

### リダイレクトは「別の URL 要求」としてやり直す

この時点で、network スレッドは **HTTP 301 のようなサーバリダイレクトヘッダ**を受け取ることがある。HTTP 301 とは「このリソースは別の URL に移動した」というサーバからの応答だ。その場合、**network スレッドは UI スレッドに「サーバがリダイレクトを要求している」と伝え、改めて別の URL 要求が開始される**。原文を引く。

> At this point, the network thread may receive a server redirect header like HTTP 301. In that case, the network thread communicates with UI thread that the server is requesting redirect. Then, another URL request will be initiated.

〔補足〕リダイレクトが「新しい URL 要求としてやり直される」点は後述の Step 4（投機的レンダラ起動）が無駄になる条件と直結する。診断上の観点としては、**オープンリダイレクト**（任意の外部 URL へ飛ばせてしまう欠陥）、**リダイレクト時の `Authorization` / `Cookie` の再送**、**リダイレクト先での CSP / COOP / COEP の再評価**などが挙がる。

〔補足〕現行の Chromium ドキュメント "Life of a Navigation" では、リダイレクトについてより厳密に「応答コードと `Location` ヘッダに基づいて別の要求を出し、**エラーか成功応答に至るまでリダイレクトを追い続ける**」とある。また **307 / 308 は元のメソッドとボディを保持する**（それ以外は通常 GET に変わる）点も、リクエスト改ざん系の検証で押さえておきたい。

## 6. Step 3: レスポンスの読み取り — 3 つの関門

### 先頭数バイトを見る理由

レスポンスボディ（payload、実際のデータ本体）が届き始めると、**network スレッドは必要に応じてストリームの先頭数バイトを見る**。レスポンスの **`Content-Type` ヘッダ**は、それがどんな種類のデータか（HTML なのか画像なのか）を示すべきものだが、**欠けていたり間違っていたりすることがある**。そこで **MIME Type sniffing** が行われる。

**MIME Type sniffing とは、`Content-Type` を鵜呑みにせず、データの中身（先頭バイト）を見て本当のデータ種別を推測する処理のこと。** 原文はこれを Chromium のソースコードのコメントを引いて **"tricky business"（厄介な仕事）**と表現し、「そのコメントを読めば、各ブラウザが content-type と payload の組み合わせをどう扱うかがわかる」と、読者に一次情報を読むよう促している。原文を引く。

> Once the response body (payload) starts to come in, the network thread looks at the first few bytes of the stream if necessary. The response's Content-Type header should say what type of data it is, but since it may be missing or wrong, MIME Type sniffing is done here. This is a "tricky business" as commented in the source code. You can read the comment to see how different browsers treat content-type/payload pairs.

### 行き先を分ける

**レスポンスが HTML ファイルなら、次のステップはデータをレンダラプロセスに渡すこと**だ。**しかし zip ファイルやその他のファイルなら、それはダウンロード要求を意味するので、データをダウンロードマネージャに渡す。** 図キャプション（逐語）:

> Figure 4: Network thread asking if response data is HTML from a safe site

### SafeBrowsing と CORB

ここは **SafeBrowsing チェック**が行われる場所でもある。SafeBrowsing とは、既知の悪性サイトのリストと突き合わせる Google の仕組みのこと。**ドメインとレスポンスデータが既知の悪性サイトに一致するように見える場合、network スレッドは警告ページを表示するようアラートする**。

さらに **CORB（クロスオリジン読み取りブロック, Cross Origin Read Blocking）チェック**が行われ、**機微なクロスサイトデータがレンダラプロセスに到達しないこと**を保証する。原文を引く。

> This is also where the SafeBrowsing check happens. If the domain and the response data seems to match a known malicious site, then the network thread alerts to display a warning page. Additionally, **C**ross **O**rigin **R**ead **B**locking (**CORB**) check happens in order to make sure sensitive cross-site data does not make it to the renderer process.

原文がこの箇所で張っているリンクは次のとおり（逐語）。

| 語 | リンク先 URL（逐語） |
|---|---|
| MIME Type sniffing | https://developer.mozilla.org/docs/Web/HTTP/Basics_of_HTTP/MIME_types |
| the source code | https://cs.chromium.org/chromium/src/net/base/mime_sniffer.cc?sq=package:chromium&dr=CS&l=5 |
| SafeBrowsing | https://safebrowsing.google.com/ |
| Cross Origin Read Blocking (CORB) | https://www.chromium.org/Home/chromium-security/corb-for-developers |

〔補足〕このステップは、**ネットワーク由来のデータがサンドボックス外の特権プロセスで検査され、レンダラへ渡る前の最後の関門**である点が重要だ。ハンティング観点では、(1) `Content-Type` の欠落／誤設定＋sniffing による「アップロードしたファイルが HTML として描画される」タイプの XSS、(2) `X-Content-Type-Options: nosniff` の有無、(3) CORB/ORB がどの MIME タイプに効くか、(4) SafeBrowsing 警告の迂回（ドメイン新規性・短縮 URL・HTTPS 配信）が検証項目になる。

## 7. MIME sniffing の一次情報を読む — なぜ `Content-Type` 誤設定が XSS になるか

原文が「the source code を読め」と名指ししているのは Chromium の `net/base/mime_sniffer.cc` だ。ここを読むと、「`Content-Type` を間違えると、なぜファイルが HTML として実行されうるのか」が根拠つきで分かる。以下は同ファイルから逐語で採録した内容にもとづく。

### まず設計思想 — 互換性とセキュリティの綱引き

冒頭のコメントは、sniffing が「互換性の懸念とセキュリティ問題のバランスを取る、厄介な仕事」だと述べ、各ブラウザの挙動を調査したうえで Chrome の方針を決めている。以下がそのサーベイの逐語である。

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

このサーベイを表にまとめると次のようになる（内容はコメントのまま）。

| payload | Content-Type | Chrome の決定 |
|---|---|---|
| HTML | （なし） | **Render as HTML** |
| HTML | `text/plain` | **Render as text**（`text/plain` のときは危険な MIME タイプ＝スクリプト実行可能なものを検出しない） |
| HTML | `application/octet-stream` | **Download as application/octet-stream**（より安全な選択） |
| GIF | （なし） | **Render as GIF** |
| GIF | `text/plain` | **Render as GIF** |
| GIF | `application/octet-stream` | **Download as application/octet-stream**（octet-stream からは一切 sniff しない方が互換性が良い） |

読み解くと、**HTML の中身を持つデータに `Content-Type` が付いていない場合、Chrome はそれを HTML として描画する**。これがそのまま攻撃面になる。防御側の要点は「`text/plain` を付ければ危険な MIME タイプ（スクリプト実行可能なもの）は検出されない」と「`application/octet-stream` からは sniff しない」の 2 点である。

### 実装の公式警告 — sniffer を拡張するな

ヘッダファイル `net/base/mime_sniffer.h` には、この機能をこれ以上広げるなという強い警告が置かれている（逐語）。

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

つまり sniffing は「多くのサイトが既存挙動に依存しているから残しているだけで、良い設計だから残しているのではない」と公式に認めている。sniffing はレガシー救済であって推奨機能ではない、というのが読者の持つべき前提だ。

### sniffing の境界条件（逐語）

先頭を何バイトまで見るかは定数で決まっている（逐語）。

```c
const int kMaxBytesToSniff = 1024;
static const size_t kBytesRequiredForMagic = 42;
```

**先頭 1024 バイト以内**しか見ない。ここが「攻撃者が先頭にどんなバイトを置くか」の攻防の物理的な境界になる。

そして sniff するかどうかの判定に、**`X-Content-Type-Options: nosniff` が効く**。判定コード（`ShouldSniffMimeType`）の逐語を示す。

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

**`X-Content-Type-Options: nosniff`（大文字小文字を問わない）が付いていれば sniffing は行われない。** これが最も重要な防御ヘッダである。Fetch 仕様どおり、最初に一致したヘッダだけを見る点も押さえておく。

### どの `Content-Type` が sniff 対象か

sniff の対象になる `Content-Type` は列挙されている（`kSniffableTypes`、逐語）。

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

さらに「不明な MIME タイプ」の定義（`IsUnknownMimeType`、逐語）がある。ここに該当する値も HTML として sniff される候補になる。

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

**空文字列、`unknown/unknown`、`application/unknown`、`*/*`、そしてスラッシュを含まない値**は「不明」扱いとなり、HTML として sniff される。

### HTML と判定されるタグ

HTML として sniff されるタグの一覧（`kSniffableTags`、逐語）。先頭がこれらのいずれかで始まるデータは HTML と見なされうる。

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

コメント自身が **"text/xml is just as powerful as HTML"（text/xml は HTML と同じくらい強力）**と述べている点に注意。`<?xml` で始まるデータも `text/xml` として扱われ、HTML 同等の権能を持つ。

HTML／バイナリを sniff する条件のコメント（逐語）も要点だ。

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

### どこを突くのか

〔補足〕以上を組み合わせると、ハンティングでの着眼点が明確になる。ファイルアップロード機能を持つサイトで、アップロードした物が次の条件を満たすと、HTML として描画されうる。

1. `Content-Type` が「なし」「`text/plain` 以外の不明値」「スラッシュなしの壊れた値」のいずれか、かつ
2. `X-Content-Type-Options: nosniff` が付いておらず、かつ
3. ダウンロードを強制する `Content-Disposition: attachment` も付いていない、かつ
4. 先頭 1024 バイト以内・空白スキップののち、`kSniffableTags` のいずれか（`<script`、`<html`、`<!--`、`<?xml` など）で始まる。

ただし実際にどのオリジン上で描画されるかは、レスポンスのオリジンとサンドボックス設定次第である。検証は**許可された対象・自分で立てた検証環境**に対してのみ行うこと。防御側の結論はシンプルで、**正しい `Content-Type` を付け、`X-Content-Type-Options: nosniff` を付け、ダウンロードさせたいものは `Content-Disposition: attachment` を付ける**——これで sniffing 起因の描画はほぼ塞げる。

## 8. CORB — 機微データをレンダラに渡さない仕組み

Step 3 で登場した CORB を掘り下げる。原文がリンクしていた `www.chromium.org/Home/chromium-security/corb-for-developers` は本環境から取得できなかったため、以下は同じ Chromium プロジェクトの一次文書 `services/network/cross_origin_read_blocking_explainer.md` から読み取った内容にもとづく。

### CORB は何を守るのか（設計意図）

同文書の冒頭定義（逐語・冒頭 2 文）。

> This document outlines Cross-Origin Read Blocking (CORB), an algorithm by which dubious cross-origin resource loads may be identified and blocked by web browsers before they reach the web page.
> CORB reduces the risk of leaking sensitive data by keeping it further from cross-origin web pages.

CORB とは、**怪しいクロスオリジンの読み込みを「ウェブページに届く前に」識別してブロックするアルゴリズムのこと。** ここで前提になるのが**同一オリジンポリシー（Same-Origin Policy, SOP）**——別オリジンのデータを読むことを原則禁じるルールだ。ところが `<img>` や `<script>` のような歴史的に許されてきた埋め込み手段や、CORS（クロスオリジンでの選択的許可の仕組み）による例外がある。

ポイントは、**JSON のように「歴史的に許されたどの文脈でも意味のある読み取りができない」型が存在する**ことだ。JSON を `<img>` に入れればデコードエラー、`<script>` に入れれば no-op か構文エラーになり、観測可能な形で読めるのは `fetch()` / `XMLHttpRequest`（＝ CORS が仲介する経路）だけである。だから**画像デコーダや JavaScript パーサに渡る前に落とせば**、その先の段に潜むサイドチャネル脆弱性ごと封じられる。**Site Isolation（サイトごとにレンダラプロセスを分ける仕組み）があるブラウザでは、信頼できないレンダラプロセスからデータを完全に排除できる**ため、Spectre のような投機的サイドチャネル攻撃にも効く。

### どんな攻撃を緩和するのか

| 攻撃 | 要旨 |
|---|---|
| **XSSI（Cross-Site Script Inclusion）** | `<script>` を JavaScript でない資源に向け、JavaScript として解釈された副作用を観測する手法。古典例は Array コンストラクタを上書きして `<script src="https://example.com/secret.json">` の JSON リストの中身を傍受するもの。XSRF トークンや JSON セキュリティプレフィクスといった他の防御が無い場合に CORB が特に効く。逆に **JSON セキュリティプレフィクスの存在は「この資源は CORB 保護すべき」というシグナル**として使える |
| **投機的サイドチャネル攻撃（Spectre など）** | 攻撃者は `<img src="https://example.com/secret.json">` で秘密を**自分の JS が動くプロセスのメモリに引き込み**、Spectre で読み出す。CORB は Site Isolation と併用して、その JSON がクロスサイトページをホストするプロセスのメモリに存在しないようにする |

### 「ブロック」はレンダラ側からどう見えるか

同文書 "How does CORB 'block' a response?" より、CORB がブロックしたレスポンスは次のように扱われる。

- **レスポンスボディは空のボディに置き換えられる。**
- **レスポンスヘッダは除去される**（ただし CORS のエラーメッセージ改善のため `Access-Control-*` ヘッダは残す）。
- 投機的サイドチャネルに効かせるには、**クロスオリジンの要求元をホストするプロセスにレスポンスが到達する前に**ブロックしなければならない。一時的にも短時間でも、保護データがそのプロセスのメモリに存在してはならない。

〔補足〕診断の目線では、「クロスオリジンで JSON を読もうとしたら**空ボディが返り、ヘッダも消えている**」という観測が CORB 作動のサインになる。

### どの要求が対象か — ナビゲーション本体は対象外

CORB の適用対象には除外がある。**CORB-exempt（対象外）**は次のとおり。

- **navigation request**、および request destination が `object` / `embed` の要求。クロスオリジンの `<iframe>` / `<object>` / `<embed>` は別のセキュリティコンテキスト（Site Isolation があれば別プロセス）を作るため、漏洩リスクが低い。
- **ダウンロード要求**。データはディスクに保存されクロスオリジンのコンテキストに共有されないため。

**ここが記事 Step 3 を読むうえで重要な帰結**になる。記事が扱っている「ナビゲーションのためのレスポンス」そのものは navigation request なので **CORB-exempt** である。つまり記事の「CORB check が行われる」という記述は、**ナビゲーション時に network スレッドが通る一連のチェック群の一部としての言及**であって、ナビゲーション本体の HTML が CORB でブロックされるという意味ではない。

**CORB-eligible（対象になりうる）**は上記以外すべて。同文書が挙げるのは XHR と `fetch()`、`ping`、`navigator.sendBeacon()`、`<link rel="prefetch">`、そして request destination が image / script-like（`<script>`、`importScripts()`、`navigator.serviceWorker.register()` 等）/ audio / video / track / font / style / report のもの、である。

### 保護される型と判定ルール

CORB が保護するのは基本的に **JSON / HTML / XML** の 3 種だ。判定ルールを表にまとめる（内容は同文書のまま）。

| 条件 | 保護対象になる Content-Type |
|---|---|
| `X-Content-Type-Options: nosniff` がある | HTML／XML（`image/svg+xml` は除外）／JSON／**`text/plain`** |
| **206 レスポンス** | HTML／XML（`image/svg+xml` 除外）／JSON |
| それ以外（**ボディを sniff して確認**） | HTML MIME タイプで HTML と sniff される／XML MIME タイプ（`image/svg+xml` 除外）で XML と sniff される／JSON MIME タイプで JSON と sniff される／**`text/plain` で JSON・HTML・XML と sniff される**／**`text/css` 以外で JSON セキュリティプレフィクスで始まる**もの |

JSON セキュリティプレフィクスとは、レスポンス先頭に置いて `<script>` からの直接実行を壊す慣習的な文字列のこと。同文書が実在例として挙げるのは **`)]}'`**（angular.js、Java Spring。google.com で広く観測）、**`{} &&`**（歴史的に Java Spring）、**`for(;;);`** のような無限ループ（facebook.com で広く観測）だ。ただし **`text/css` は例外**で、`)]}'` で始まりつつスタイルシートとしても妥当なファイルが理論上作れるため、CSS にはプレフィクス sniff を行わない。

一方で、**CORB が保護しないもの**も明示されている。ここが攻撃面として重要だ。

- **`multipart/*` とラベルされた応答**（入れ子パートを解析しないため）。
- **`Content-Type` ヘッダが無い応答。**
- **`text/javascript` などの JavaScript MIME タイプの応答。JSONP（JSON with padding）もここに含まれる。**

同文書は、開発者への推奨として「**最善のセキュリティのため、(1) 正しい `Content-Type` を付け、(2) `X-Content-Type-Options: nosniff` で sniffing をオプトアウトすること**」を挙げている。また **sniffing 無しでは約 16 倍の応答がブロックされてしまう**ため、sniffing は互換性維持に必須だとしている。実測（2018 年 2 月の Chrome Canary）では、**CORB 対象応答のうちブロックされたのは 0.961%**、そのうち非空は 0.456%、観測可能な影響が出うるのは 0.115% にとどまる、と報告している。

### どこを突くのか

〔補足〕以上から、ハンティングで直接使える判断材料が導ける。

1. **JSON API が機微データを返すのに `)]}'` 等のプレフィクスも `nosniff` も無い**場合、CORB/ORB の保護は sniff の成否に依存する。空でないオブジェクトリテラル（`{"key":"value"}`）は保護されやすいが、**配列やスカラを返すエンドポイントは保護が弱い**（同文書自身が「完全な JSON バリデータが必要」と認める領域）。
2. **`Content-Type` が無い応答は CORB 保護されない**ので、機微データを Content-Type 無しで返すエンドポイントは XSSI の検討対象。
3. **JSONP は明示的に保護外**であり、コールバック名を制御できる JSONP エンドポイントは従来どおり情報漏洩の経路。
4. `<script>` からの読み込みで**構文エラーの有無（`window.onerror`）が観測できる**ことは、CORB の有無を外から判定する副次的シグナルになる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: CORB for developers（Chromium 公式）— https://www.chromium.org/Home/chromium-security/corb-for-developers
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: egress プロキシが `www.chromium.org` への接続を 403 で拒否）。内容の大半は同プロジェクトの一次文書 `cross_origin_read_blocking_explainer.md` から取得済みだが、**開発者向けの実務手順・DevTools に出る CORB 警告メッセージの文面**はページ側にある可能性がある。
> **読みどころ**:
> 1. 「あなたのサイトが壊れたときの対処」（explainer は設計文書なので実務手順はページ側）。
> 2. DevTools コンソールに出る **CORB 警告メッセージの文面と読み方**。
> 3. CORB から ORB への移行に関する公式アナウンスの有無。
> **代替手段**: (a) `https://source.chromium.org/chromium/chromium/src/+/main:services/network/cross_origin_read_blocking_explainer.md`（ブラウザ閲覧版）、(b) `https://github.com/chromium/chromium/blob/main/services/network/cross_origin_read_blocking_explainer.md`。

## 9. ORB — CORB の後継（CORB++）

CORB には後継の提案がある。**ORB（不透明レスポンスブロック, Opaque Response Blocking）**、別名 CORB++ だ。出典は提案リポジトリ `annevk/orb` の README と、Chromium 実装 `services/network/public/cpp/orb/orb_api.h` である。

### 何を目指すのか

目的（逐語）。

> To block as many opaque responses as possible while remaining web compatible.

**「ウェブ互換を保ちながら、可能な限り多くの不透明（opaque）レスポンスをブロックする」**——これが ORB のねらいだ。高レベルの考え方はこうだ。CSS・JavaScript・画像・メディアは CORS なしでクロスオリジン要求できる。理想的には**これらのいずれでもない応答を可能な限りブロック**して、サイドチャネルからの内容漏洩を避ける。

### CORB との最大の違い — ブロックリストから許可リストへ

CORB が保護したのは HTML/XML/JSON の 3 種だった。ORB は方向を反転させ、「安全な型を許可リストにし、それ以外は sniff すらせずブロックする」に拡張する。

| 集合 | 定義 |
|---|---|
| **opaque-safelisted MIME type** | JavaScript MIME タイプ、または essence が `text/css` もしくは `image/svg+xml` |
| **opaque-blocklisted MIME type** | HTML／JSON／XML |
| **opaque-blocklisted-never-sniffed MIME type** | sniff せず常にブロック。`application/pdf`、`application/zip`、`application/gzip`、`application/x-protobuf`、`application/dash+xml`、`text/event-stream`、`text/csv`、`text/vtt`、Microsoft Office 系など |

**つまり ORB では PDF・ZIP・CSV・SSE（Server-Sent Events）・Office 文書などが「sniff すらせず」ブロックされる。** これは CORB explainer の "Future work" が予告していた方向の具体化である。

### CORP が最後の鍵

ORB のアルゴリズムは、ヘッダ判定 → メディア／画像のパターンマッチ → 「JavaScript としてパースでき、かつ JSON としてパースできないなら許可」といった段を踏む。ここで最重要の注記が README にある（逐語）。

> Note: responses for which the above algorithm returns true and contain secrets are strongly encouraged to be protected using `Cross-Origin-Resource-Policy`.

**ORB を通過してしまう（＝許可される）応答に秘密が含まれるなら、`Cross-Origin-Resource-Policy`（CORP）で守れ**、という明示的な指示だ。CORP とは、レスポンスヘッダで「この資源をどのオリジンから読み込ませてよいか」をサーバ自身が宣言する仕組みのこと。教科書的に要約すると、**CORB/ORB は網であって鍵ではない。鍵は CORP** である。

### 実装から読み取れる設計

Chromium の `orb_api.h` の逐語（識別子とコメント）。

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

読み取れる事実は 3 つ。第一に、**`ResponseAnalyzer` は CORB でも ORB でも実装できる純粋仮想インタフェース**で、両者が同じ枠組みに載っている。第二に、判定結果は **`kAllow` / `kBlock` / `kSniffMore`** の 3 値であり、`kSniffMore` の存在が「ヘッダだけでは決まらず本文の先頭を読む」という設計（記事 Step 3 の「先頭数バイトを見る」）と直結する。第三に、ブロックの見せ方が **`kEmptyResponse`（空応答）** と **`kNetworkError`（ネットワークエラー）** の 2 通りあり、診断時の見分けに関わる。

〔補足〕README には「**"subsequent"（メディアの続きの range 要求）の設定は容易に侵害されないプロセスで行うのが望ましい**。値を偽装できれば ORB を回避できる」という注意がある。これは「レンダラ（＝侵害されうる側）が申告する状態をネットワーク側が信じると保護が抜ける」という、本節の主題そのものの構図だ。

> ### 📌 ここは自分で開いて読んでください
> **資料**: CORB デモページ（xsdb-demo）— https://anforowicz.github.io/xsdb-demo/index.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限で未取得）。CORB explainer が案内しているデモで、**CORB のブロックをブラウザ上で実際に観測する**ためのページである。
> **読みどころ**:
> 1. クロスオリジンで機微データを読み込もうとしたとき、レスポンスボディが空になりヘッダが除去される様子を DevTools のネットワークタブで確認する。
> 2. `<script>` 経由と `<img>` 経由で観測される挙動の違いを見る。
> **代替手段**: 自分で用意した検証環境で、JSON を返すエンドポイントを別オリジンから `fetch()` / `<script>` / `<img>` で読み込み、`nosniff` の有無で挙動が変わるかを比較する。

## 10. Step 4: レンダラプロセスを見つける — 投機的起動

### 待ち時間を隠す最適化

すべてのチェックが済み、network スレッドが「ナビゲートしてよい」と確信できたら、**network スレッドは UI スレッドに「データの準備ができた」と伝える**。UI スレッドはそこで、ページのレンダリングを引き継ぐレンダラプロセスを探す。図キャプション（逐語）:

> Figure 5: Network thread telling UI thread to find Renderer Process

ネットワーク要求は応答が返るまでに数百ミリ秒（several hundred milliseconds）かかりうる。そこで最適化が施されている。**Step 2 で UI スレッドが network スレッドに URL 要求を送る時点で、UI スレッドはすでにどのサイトへ遷移するかを知っている**。だから **UI スレッドはネットワーク要求と並行して、レンダラプロセスを先回りで探すか起動する**。うまくいけば、データが届いたときにはレンダラプロセスがスタンバイ状態になっている。

ただし例外がある。原文（逐語）。

> This standby process might not get used if the navigation redirects cross-site, in which case a different process might be needed.

**ナビゲーションがクロスサイトにリダイレクトされると、このスタンバイプロセスは使われないことがある**（別のプロセスが必要になるため）。Step 2 で見た「リダイレクトは別の URL 要求としてやり直す」がここに響く。

### Spare Process — 最適化の現在形

〔補足〕現行の Chromium ドキュメント `docs/process_model_and_site_isolation.md` は、この最適化を **Spare Process** という語で説明している（逐語）。

```text
Spare Process: Chromium often creates a spare RenderProcessHost with a live but
unlocked renderer process, which is used the next time a renderer process is
needed. This avoids the need to wait for a new process to start.
```

**「生きているが、まだどのサイトにもロックされていない（unlocked）レンダラプロセス」を予備として持ち、次にレンダラが必要になったときに使う**という仕組みだ。「クロスサイトへリダイレクトされるとスタンバイプロセスが使われないことがある」という記事の記述は、**サイトにロックされたプロセスは別サイトに再利用できない**という Site Isolation の帰結として読める。

## 11. Step 5: コミット — オリジンとアドレスバーが確定する瞬間

### コミットで何が起きるか

データとレンダラプロセスが揃うと、**ブラウザプロセスからレンダラプロセスへ IPC が送られ、ナビゲーションをコミット（commit）する**。このとき**データストリームも引き渡され、レンダラは HTML データを受け取り続けられる**。**ブラウザプロセスがレンダラでコミットが起きたという確認を受け取ると、ナビゲーションは完了し、document loading フェーズが始まる。**

コミットの瞬間に起こること（原文の列挙）。

- **アドレスバーが更新される。**
- **セキュリティインジケータとサイト設定 UI が、新しいページのサイト情報を反映する。**
- **そのタブのセッション履歴が更新され、戻る/進むボタンが今ナビゲートしたサイトを辿れるようになる。**
- **タブ/セッション復元を可能にするため、セッション履歴はディスクに保存される。**

図キャプション（逐語）:

> Figure 6: IPC between the browser and the renderer processes, requesting to render the page

### コミットの厳密な定義（現行仕様）

〔補足〕現行の "Life of a Navigation" は、コミットをさらに厳密に定義している。ブラウザプロセスは応答のオリジンとヘッダ、現在のプロセスモデル・分離ポリシーに基づいて適切なレンダラプロセスを選ぶ。**応答ヘッダがオリジンに影響することがある**（例: `Content-Security-Policy: sandbox;` によって文書が opaque origin になる）。その後 **"commit" IPC** で応答を送り、レンダラが文書を作って **Mojo コールバックで確認応答（ack）**を返すのを待つ。**この ack を受け取った時点が、そのナビゲーションの権威ある _commit 時刻_** であり、**ブラウザプロセスが新しい文書を反映してセキュリティ状態を切り替えるのはこの時点**だ。

〔補足〕さらに現行仕様は、記事が触れていない**非コミットで終わる 2 ケース**を明示している。**(1) HTTP 204 / 205**（成功だが内容が無いので現在の文書がアクティブのまま残る）、**(2) `Content-Disposition` 応答ヘッダでダウンロード扱いになる場合**だ。記事は「zip ならダウンロードマネージャへ」とだけ述べたが、この 204/205 と `Content-Disposition` は「**アドレスバーの表示と実際に描画されている文書がずれる**」URL spoofing を論じる際の中心材料になる。

## 12. Extra Step: 初期ロード完了 — 「onload で終わり」ではない

### スピナーが止まるまで

ナビゲーションがコミットされると、レンダラはリソースの読み込みを続けてページを描く。**レンダラがレンダリングを「終える」と、ブラウザプロセスへ IPC を送り返す。これはページ内の全フレームで `onload` イベントが発火し、実行が完了した後である。** この時点で **UI スレッドはタブのローディングスピナーを止める**。図キャプション（逐語）:

> Figure 7: IPC from the renderer to the browser process to notify the page has "loaded"

### なぜ「終わり」に鉤括弧が付くのか

原文はここで重要な注記を置く（逐語）。

> I say "finishes", because client side JavaScript could still load additional resources and render new views after this point.

つまり「完了」は名目上のもので、**クライアントサイド JavaScript はこの後も追加リソースを読み込み、新しいビューを描画しうる**。

〔補足〕この一文はクライアントサイド脆弱性ハンティングの前提そのものだ。スキャナや手動確認が `onload` 時点の DOM だけを見ると、その後の**クライアントサイドルーティング**（画面遷移を JS が担う SPA など）、**遅延投入される sink**（危険な代入先）、**動的に読み込まれるサードパーティスクリプト**を見落とす。DOM XSS の探索は「ロード完了後も継続する」ことが必要になる。

〔補足〕現行仕様が **navigation フェーズと loading フェーズを分ける**のも同じ話だ。loading は残りの応答データの読み取り・パース・描画・スクリプト実行・サブリソース読み込みからなる。分ける理由は**コミット前後でエラーの扱いが違う**こと。サーバが HTTP エラーコードを返しても**ブラウザは文書をコミットする（それがエラーページ）**が、成功してコミットし loading に入った後で接続が切れた場合は、**エラーページを出さずに読めた分だけ表示する**。

## 13. 別サイトへの移動 — `beforeunload`・`unload`・URL spoofing の語彙

### `beforeunload` はレンダラに聞かないと分からない

単純なナビゲーションは完了した。では**別の URL をもう一度入力したら**どうなるか。ブラウザプロセスは同じ手順を踏むが、その前に、**現在レンダリングされているサイトが `beforeunload` イベントを気にしているかを確認する必要がある**。

**`beforeunload` とは、ユーザーが他所へ移動したりタブを閉じようとしたときに「Leave this site?（このサイトを離れますか？）」というアラートを出せるイベントのこと。** タブの内側にあるものは JavaScript を含めてすべてレンダラプロセスが扱うので、新しいナビゲーション要求が来ると、ブラウザプロセスは現在のレンダラに確認を取らねばならない。図キャプション（逐語）:

> Figure 8: IPC from the browser process to a renderer process telling it that it's about to navigate to a different site

原文はここに強い注意書き（Aside、逐語）を置いている。

```liquid
{% Aside 'caution' %}
Do not add unconditional `beforeunload` handlers. It creates more latency because the 
handler needs to be executed before the navigation can even be started. This event handler should 
be added only when needed, for example if users need to be warned that they might lose data they've 
entered on the page.
{% endAside %}
```

訳すと「**無条件の `beforeunload` ハンドラを追加してはならない。ナビゲーションを開始する前にハンドラを実行しなければならず、レイテンシが増える。このハンドラは必要なとき——たとえば入力データを失うと警告する必要があるとき——だけ追加すべきだ**」。

### レンダラ起点でも、まずレンダラが `beforeunload` を確認する

**レンダラプロセス起点のナビゲーション**——リンククリック、あるいは JS が `window.location = "https://newsite.com"` を実行した場合——でも、**まずレンダラプロセスが `beforeunload` ハンドラを確認する**。その後はブラウザプロセス起点と同じ流れになる。唯一の違いは、ナビゲーション要求がレンダラからブラウザプロセスへ向けてキックオフされる点だ。

**現在のサイトとは異なるサイトへ遷移する場合、新しいナビゲーションを扱うために別のレンダラプロセスが呼び出され、現在のレンダラは `unload` のようなイベントを処理するために生かしておかれる**。原文（逐語）。

> When the new navigation is made to a different site than currently rendered one, a separate render process is called in to handle the new navigation while current render process is kept around to handle events like `unload`.

図キャプション（逐語）:

> Figure 9: 2 IPCs from a browser process to a new renderer process telling to render the page and telling old renderer process to unload

〔補足〕現行仕様では、この unload の順序がプロセス構成で違うと明示している。**同一レンダラプロセス内に留まる場合は、新文書の作成前に旧文書を unload する**（登録済み unload ハンドラの実行を含む）。**クロスプロセスになる場合は、unload ハンドラは前の文書のプロセスで、新プロセスでの新文書作成と並行して実行される**。

〔補足〕`beforeunload` がブラウザプロセス→レンダラの同期的な問い合わせを要求するという構造は、いくつかの検証観点につながる。(1) unload/beforeunload ループによるユーザー拘束（"leave site" スパム）、(2) ナビゲーション開始からコミットまでの**時間差**を突く race（アドレスバーが新 URL、内容が旧文書という状態）、(3) 旧レンダラが `unload` 中に行える処理（`sendBeacon` 等）の悪用、である。

### URL spoofing を語る 3 つの URL

ここが本節の山場だ。現行の "Navigation Concepts" は、URL spoofing を論じるための語彙を与える。アドレスバーの表示が正しいかを判断するには、次の 3 つを区別する必要がある。

| 用語 | 意味 |
|---|---|
| **last committed URL** | いま実際にフレームに入っている文書の URL/Origin。**アドレスバーの表示とは無関係**。鍵アイコンなどアドレスバー直結の機能以外は、ほぼ常にこれを使うべき |
| **pending URL** | メインフレームのナビゲーションが開始したが、まだコミットしていない URL。ユーザーに見えることもあるが、常にではない |
| **visible URL** | **アドレスバーが表示している URL** |

ブラウザは、**URL spoof に悪用されにくく安全な場合にのみ pending URL を表示し、そうでなければ last committed を表示する**という規則で visible URL を決めている。

- **browser-initiated ナビゲーション**（入力 URL やブックマーク。セッション履歴ナビゲーションを除く）では **pending URL** を表示。キャンセルされると空になる。
- **renderer-initiated ナビゲーション**では **last committed URL** を表示（攻撃者が文書内容と pending URL の両方を制御できる可能性があるため）。
- renderer-initiated の URL が pending 中に見えるのは、**未変更の新しいタブで開く場合のみ**（役に立たない `about:blank` を見せないため）で、他の文書がその initial empty document にアクセスしようとするまで。**攻撃者のウィンドウが遅い被害者 URL で新タブを開き、あたかもその URL がコミットしたかのように initial `about:blank` 文書へコンテンツを注入する**シナリオでは、**visible URL は URL spoof を避けるために `about:blank` に戻る**。

ここで重要なのが **browser-initiated と renderer-initiated の信頼差**だ。**browser-initiated の方が信頼される**（通常はアドレスバーやブックマークというユーザー操作の結果で、`file://` や `chrome://` へ行ける高い権限を持つ）。**renderer-initiated は信頼度が低く、特権 URL を対象にできない**。ウェブコンテンツが `file://` や `chrome://` へナビゲートできてしまうと権限昇格やプライバシー漏洩の踏み台になるからだ。

〔補足〕URL spoofing の報告を書くときは、「アドレスバーは last committed を基本とし、安全な場合だけ pending を見せる」という**設計上の防御のどの規則が破れているのか**を、この語彙で述べられると説得力が出る。これは記事 Step 5（コミット時にアドレスバーが更新される）と直結している。

## 14. Service Worker がナビゲーションに介入する

### Service Worker とは

このナビゲーションプロセスへの近年の変更の一つが **Service Worker（SW）**だ。原文の定義（逐語）。

> Service worker is a way to write network proxy in your application code; allowing web developers to have more control over what to cache locally and when to get new data from the network.

**SW とは、アプリケーションコードの中にネットワークプロキシを書く方法のこと。** 何をローカルにキャッシュし、いつネットワークから新しいデータを取るかを開発者が制御できる。SW がキャッシュからページを返すよう設定されていれば、ネットワークに要求する必要はない。

**覚えておくべき重要な点は、SW はレンダラプロセスで動く JavaScript コードだということ**である。ではナビゲーション要求が来たとき、ブラウザプロセスはそのサイトが SW を持つとどうやって知るのか。

### スコープの照合

答えは「スコープ」だ。**SW が登録されるとき、その SW の「スコープ」が参照として保持される**（スコープとは SW が制御する URL のパス範囲のこと）。**ナビゲーションが起きると、network スレッドはドメインを登録済みの SW スコープと照合する。そのURLに対して SW が登録されていれば、UI スレッドは SW のコードを実行するためにレンダラプロセスを見つける。** 原文（逐語）。

> When a navigation happens, network thread checks the domain against registered service worker scopes, if a service worker is registered for that URL, the UI thread finds a renderer process in order to execute the service worker code.

図キャプション（逐語）:

> Figure 10: the network thread in the browser process looking up service worker scope
> Figure 11: the UI thread in a browser process starting up a renderer process to handle service workers; a worker thread in a renderer process then requests data from the network

### どこを突くのか

〔補足〕SW がナビゲーションに介入できるという事実は、ハンティングでは非常に大きい。**SW を登録できてしまえば**（例: 任意ファイルアップロード＋適切な `Content-Type` と `Service-Worker-Allowed`、あるいは XSS からの `navigator.serviceWorker.register()`）、そのスコープ配下のナビゲーション応答を攻撃者のコードが**持続的に差し替えられる**。SW のスコープはパス単位であり、スコープを親方向へ拡張するには `Service-Worker-Allowed` ヘッダが要る、というのが実務上の境界条件だ。SW の登録有無は DevTools の Application パネル、あるいは `navigator.serviceWorker.getRegistrations()` で確認できる。

## 15. Navigation Preload — `Service-Worker-Navigation-Preload` ヘッダ

### 往復の遅延を隠す

SW が結局ネットワークにデータを要求すると決めた場合、ブラウザプロセスとレンダラプロセスの間のこの往復（round trip）が遅延になりうる。**Navigation Preload は、SW の起動と並行してリソースを読み込むことでこの過程を高速化する仕組み**だ。

**これらの要求にはヘッダが付与され、サーバはこの要求に対して別のコンテンツを返す判断ができる。** たとえば完全なドキュメントの代わりに、更新されたばかりのデータだけを返す、といったことだ。原文（逐語）。

> It marks these requests with a header, allowing servers to decide to send different content for these requests; for example, just updated data instead of a full document.

図キャプション（逐語）:

> Figure 12: the UI thread in a browser process starting up a renderer process to handle service worker while kicking off network request in parallel

### ヘッダ名は `Service-Worker-Navigation-Preload`

原文は「a header」とだけ書き、ヘッダ名を明示していない。W3C Service Worker 仕様のソース（`w3c/ServiceWorker/main/index.bs`）から、このヘッダ名が確定できる。仕様の該当行（逐語）。

```text
[=header list/Append=] to |preloadRequestHeaders| a new [=header=] whose
[=header/name=] is `Service-Worker-Navigation-Preload` and [=header/value=] is
|registration|'s [=navigation preload header value=].
```

教科書に書ける確定事項は次のとおり。

1. **記事の「a header」は `Service-Worker-Navigation-Preload` である。**
2. **既定値は `true`** で、開発者は `registration.navigationPreload.setHeaderValue(value)` 相当の操作で任意の値に変えられる。サーバはこのヘッダを見て「完全な文書ではなく更新分だけ返す」判断ができる、という記事の記述はこれで裏が取れる。
3. **preload が走る前提条件**は「navigation request」「メソッドが `GET`」「active worker が `fetch` を扱う」「fetch リスナが空でない」「navigation preload が有効」。
4. **preload 要求は service-workers mode = `none`** なので、preload 自体が再び SW に捕まって無限に入れ子になることはない。

〔補足〕サーバが `Service-Worker-Navigation-Preload` の有無や値で**応答内容を切り替える**設計を採ると、**同じ URL に対して「SW の preload 経由」と「通常のナビゲーション」で別の内容が返る**ことになる。キャッシュキーにこのヘッダが含まれない場合のキャッシュ汚染、あるいは「preload 用の軽量応答」がセキュリティヘッダ（CSP/COOP/COEP）を欠く、といった不整合は検証に値する（一般論であり、特定サイトの挙動を主張するものではない）。

## 16. 現行仕様で補う — 観測点とキャンセル規則

記事は 2018 年の概説だ。同じ題材を扱う現行の Chromium ドキュメントを対照させると、記事が省いた「観測点の正式名」と「介入点」が埋まる。ここは診断ツールや拡張の挙動を理解するときに効く。

### WebContentsObserver — 各段階の正式なイベント名

Chromium は各段階を `WebContentsObserver` のメソッドとして公開している。

| 分類 | メソッド | 呼ばれるタイミング |
|---|---|---|
| Navigation | `DidStartNavigation` | `beforeunload` 実行後、最初のネットワーク要求の前 |
| Navigation | `DidRedirectNavigation` | サーバリダイレクトのたび |
| Navigation | `ReadyToCommitNavigation` | コミットすると決めレンダラを選んだが、まだ送っていない時点（same-document では呼ばれない） |
| Navigation | `DidFinishNavigation` | コミット完了時（成功文書でもエラーページでも） |
| Loading | `DidStartLoading` | WebContents ごとに 1 回、ナビゲーション開始直前。**スピナーを出し始めるのと等価** |
| Loading | `DOMContentLoaded` | RenderFrameHost ごと。文書自体の読み込み完了（サブリソースは未完了でよい） |
| Loading | `DidFinishLoad` | RenderFrameHost ごと。文書とすべてのサブリソースの完了 |
| Loading | `DidStopLoading` | WebContents ごとに 1 回。全フレーム・全サブリソース完了時。**スピナーを止めるのと等価** |
| Loading | `DidFailLoad` | RenderFrameHost ごと。読み切る前に接続が切れた等の失敗時 |

**記事 Extra Step の「スピナーが止まる」は `DidStopLoading` に対応**し、「全フレームの `onload` 完了後」という記事の記述と整合する。

### NavigationThrottle — ナビゲーションへの介入点

**NavigationThrottle は、ナビゲーションの観測・遅延・ブロック・キャンセルを可能にする仕組み**だ。主なイベントは `WillStartRequest`（ネットワーク要求前）／`WillRedirectRequest`（リダイレクト時）／`WillProcessResponse`（応答受領後）で、**URLLoader を必要とするナビゲーションでのみ呼ばれる**。

〔補足〕重要なのは、**プレレンダリング済みページのアクティベーションや back-forward cache（BFCache）からの復帰のような page-activation ナビゲーションは、NavigationThrottle を完全にスキップする**という点だ。拡張機能・エンタープライズポリシー・セキュリティ機能がナビゲーションを検査する前提で作られている場合、prerender / BFCache 経由のアクティベーションが検査を通らない可能性を示唆する観点になる（実際の可否は当該機能の実装次第）。

### エラーページとインタースティシャル

〔補足〕記事 Step 3 の「SafeBrowsing が警告ページを表示するようアラートする」は、実装としては**インタースティシャル**（画面全体を覆う警告ページ）として現れる。現行仕様では、インタースティシャルは**コミット済みのエラーページとして実装されている**（かつてはオーバーレイだったが現在は許されない）。しかも**ページがコミットした後にインタースティシャルが出ることもある**（サブリソースの読み込みが Safe Browsing エラーを起こした場合など）。警告の迂回やクリックスルー後の挙動を検証する際の前提になる。

〔補足〕サーバがカスタムエラーページ（4xx/5xx）を返した場合は成功ナビゲーションとほぼ同様にそのサイト用のプロセスで描画され、`NavigationHandle::IsErrorPage()` が true になる。一方、サーバから応答が得られない場合（DNS 失敗等）や、拡張 API・NavigationThrottle にブロックされた場合のエラーページは、**どのサイトにも属さない特別なエラーページ用プロセス**で表示される。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Life of a Navigation 講演（Chrome University）— https://youtu.be/mX7jQsGCF6E ／ スライド: https://docs.google.com/presentation/d/1YVqDmbXI0cllpfXD7TuewiexDNZYfwk6fRdmoXJbBlM/edit
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 動画・スライド画像のため）。Chromium 公式ドキュメント `docs/navigation.md` が案内している。
> **読みどころ**:
> 1. 記事 part2 と同じ流れを、Chromium 開発者の言葉で通して聞く。BeforeUnload → ネットワーク → コミット → loading の順が、本節の 5 ステップとどう対応するかを確認する。
> 2. スライドで各段階の IPC・プロセス選択の図解を見る。
> **代替手段**: テキスト版として `https://github.com/chromium/chromium/blob/main/docs/navigation.md`（Life of a Navigation）と `https://github.com/chromium/chromium/blob/main/docs/navigation_concepts.md`（Navigation Concepts）を読む。本節の内容はこの 2 文書から取得している。

## 手を動かす

以下は**自分で立てた検証環境、または許可された対象**に対してのみ実施すること。

1. **ナビゲーションの観測点を見る。** DevTools を開き、Network タブと Performance タブを表示したまま任意のページへ移動する。リダイレクト（3xx）が挟まる URL を選ぶと、Step 2 の「別 URL 要求としてやり直す」が Network タブに複数行として現れるのが分かる。

2. **`onload` 後も動くことを確かめる。** DevTools の Console で次を実行し、ページ読み込み完了後もタイマーで DOM が変わり続ける様子を見る（自分の検証ページで）。
   ```js
   window.addEventListener('load', () => console.log('onload fired'));
   setTimeout(() => { document.body.append('later'); console.log('added after load'); }, 3000);
   ```
   `onload` が出た後にも要素が追加される。これが「onload で終わりではない」の実演だ。

3. **`X-Content-Type-Options` の効きを確かめる。** 自分のローカルサーバで、先頭が `<script>alert(1)</script>` のファイルを `Content-Type` を付けずに返すエンドポイントと、`X-Content-Type-Options: nosniff` を付けて返すエンドポイントを用意し、ブラウザで直接開いて挙動の差を見る。nosniff 側は sniffing が止まる（`mime_sniffer.cc` の `ShouldSniffMimeType` の判定）。

4. **Service Worker の登録を確認する。** SW を使うサイト（自分の PWA など）で、Console から次を実行する。
   ```js
   navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => console.log(r.scope, r.active)));
   ```
   返ってきた `scope` が、そのオリジンのどのパス範囲を SW が制御しているかを示す。

5. **CORB の作動を観測する。** 別オリジンの JSON エンドポイント（自分で用意）を、`<img src>` と `fetch()` の両方で読み込み、Network タブでレスポンスボディが空になっているか、ヘッダが除去されているかを見る。`)]}'` プレフィクスや `nosniff` を付けた場合との差も比較する。

## つまずきポイント

- **「CORB check がナビゲーション本文をブロックする」と誤解しやすい。** 記事は Step 3 で「CORB check が行われる」と書くが、CORB explainer によれば **navigation request は CORB-exempt**。ナビゲーション本体の HTML は CORB でブロックされない。CORB が効くのは XHR/`fetch()`・`<img>`・`<script>` などの**サブリソース読み込み**である。
- **`Content-Type` を付ければ安全、とは限らない。** `text/plain` や壊れた値（スラッシュなし）は「不明」扱いで HTML sniff の候補になる。安全なのは「正しい `Content-Type`」＋「`nosniff`」の組み合わせだ。
- **図番号「Figure 1」が原文で 2 回出る。** 誤植ではなく原稿ママ。ブラウザプロセスの図と「クエリか URL か」の図の両方に Figure 1 が振られている。
- **`beforeunload` を無条件に付けると遅くなる。** ハンドラの実行がナビゲーション開始の前提になるため。原文が明確に警告している。
- **アドレスバーの URL＝いま描画中の文書、ではない。** visible URL・pending URL・last committed URL は別物。URL spoofing はこの 3 者のズレを突く。
- **onload 時点の DOM だけを見る診断は不完全。** クライアントサイド JS は onload 後も sink を生む。SPA では特に。
- **`Content-Type` が無い応答は CORB も保護しない。** 「ヘッダを付け忘れた」ことがそのまま XSSI の穴になりうる。
- **CORB/ORB を通ったら安全、ではない。** ORB README が言うとおり、通過する応答に秘密があるなら `Cross-Origin-Resource-Policy` で守る必要がある。網（CORB/ORB）と鍵（CORP）は別。

## この節のまとめ

- ナビゲーションとは、ユーザーがサイトを要求してからブラウザがレンダリング準備を整えるまでの工程で、**特権を持つブラウザプロセスが主導し、サンドボックス化されたレンダラは要求元・被通知者にすぎない**。
- ブラウザプロセスは **UI スレッド**（入力処理）、**network スレッド**（DNS/TLS/HTTP）、**storage スレッド**（ファイル）などを持ち、各処理は**スレッド間・プロセス間の IPC** でつながる。
- 工程は **Step 1 入力の解釈 → Step 2 ナビゲーション開始（リダイレクトは別 URL 要求としてやり直す）→ Step 3 レスポンス読み取り（MIME sniffing・SafeBrowsing・CORB）→ Step 4 レンダラ確保（投機的起動／Spare Process）→ Step 5 コミット → Extra 初期ロード完了** の順に進む。
- **MIME Type sniffing** は `Content-Type` を鵜呑みにせず先頭 1024 バイト（`kMaxBytesToSniff`）を見る処理で、`Content-Type` の欠落・不明値では HTML として描画されうる。**`X-Content-Type-Options: nosniff` があれば sniffing は止まる**。
- Chromium のソースコメントは「sniffing は良い設計ではなく互換性のために残している」と明言し、`kSniffableTags` に `<script`・`<html`・`<?xml` などが並ぶ。`text/xml` は「HTML と同じくらい強力」と注記される。
- **CORB** は機微なクロスサイトデータ（JSON/HTML/XML）を、画像デコーダや JS パーサに渡る前に落とす仕組み。ブロック時は**空ボディ＋ヘッダ除去**として見える。**navigation request・ダウンロード・`Content-Type` 無し・JavaScript MIME・JSONP は対象外**。
- **CORB は XSSI と Spectre を緩和し、Site Isolation と組むとサイドチャネルにも効く**。`)]}'` などの JSON セキュリティプレフィクスは保護の強いシグナルになる。
- **ORB（CORB++）** は「安全な型を許可リスト、それ以外は sniff せずブロック」へ拡張し、PDF・ZIP・CSV・SSE・Office 文書も守る。通過する応答の秘密は **`Cross-Origin-Resource-Policy` で守れ**というのが明示の指示。
- **コミット（commit）の瞬間**にオリジンが確定し、アドレスバー・セキュリティ表示・セッション履歴が更新される。厳密には**レンダラからの ack をブラウザプロセスが受け取った時点**がコミット時刻。**204/205 や `Content-Disposition` は非コミット**で終わる。
- **`onload`（初期ロード完了）で読み込みが終わるわけではない**。クライアントサイド JS は後も動くため、DOM XSS 探索はロード後も継続する必要がある。
- **別サイトへの移動では、まず現レンダラに `beforeunload` を確認**し、新レンダラで描画しつつ旧レンダラは `unload` 処理のために残す。**無条件の `beforeunload` は付けない**。
- **URL spoofing の語彙は last committed / pending / visible URL**。browser-initiated は信頼され pending を表示、renderer-initiated は信頼が低く last committed を表示する、という規則で visible URL が決まる。
- **Service Worker はナビゲーションに介入できる**。登録時にスコープが保持され、ナビゲーション時に network スレッドがスコープと照合する。SW を登録できると応答を持続的に差し替えられるため、スコープと `Service-Worker-Allowed` が境界条件になる。
- **Navigation Preload** は SW 起動と並行してネットワーク要求を走らせる最適化で、要求には **`Service-Worker-Navigation-Preload`**（既定値 `true`）ヘッダが付く。preload 要求は service-workers mode = `none`。
- 現行 Chromium ドキュメントでは、各段階が `WebContentsObserver`（`DidStartNavigation`〜`DidStopLoading`）として観測でき、**NavigationThrottle** で介入できるが、**prerender/BFCache の page-activation はスキップされる**。

## 理解度チェック

1. ナビゲーションを主導するのはブラウザプロセスとレンダラプロセスのどちらか。またオリジンの決定やアドレスバー表示はどちらの責務か。
   ▶ 答え: どちらもブラウザプロセス。レンダラはサンドボックス化された側で、要求元・被通知者にすぎない。ブラウザプロセスがレンダラの主張を過信すると URL spoofing やサイト分離バイパスにつながる。

2. `Content-Type` が付いていない HTML データを Chrome はどう扱うか。また、それを描画させないためにサーバが付けるべきヘッダは何か。
   ▶ 答え: `Content-Type` が無ければ HTML として描画する。防ぐには `X-Content-Type-Options: nosniff`（＋正しい `Content-Type`）を付ける。`mime_sniffer.cc` の `ShouldSniffMimeType` は nosniff があれば sniff しない。

3. Chrome が MIME sniffing で見るのは先頭何バイトか。その定数名は。
   ▶ 答え: 先頭 1024 バイト。定数名は `kMaxBytesToSniff = 1024`。

4. CORB が保護する主なデータ型を 3 つ挙げよ。逆に CORB が保護しないケースを 2 つ挙げよ。
   ▶ 答え: 保護するのは JSON / HTML / XML。保護しないのは、navigation request、ダウンロード要求、`Content-Type` が無い応答、JavaScript MIME タイプ（JSONP を含む）など（2 つ以上挙げれば可）。

5. 記事は Step 3 で「CORB check が行われる」と書くが、ナビゲーション本体の HTML は CORB でブロックされるか。理由も述べよ。
   ▶ 答え: ブロックされない。navigation request は CORB-exempt だから。CORB が効くのは XHR/`fetch()`・`<img>`・`<script>` などのサブリソース読み込み。

6. ORB が CORB から拡張した最大の点は何か。また、ORB を通過する応答に秘密がある場合に使うべきヘッダは。
   ▶ 答え: ブロックリスト方式（HTML/XML/JSON のみ保護）から許可リスト方式（安全な型だけ許可し、PDF・ZIP・CSV・SSE 等は sniff せずブロック）へ拡張した点。通過応答の秘密は `Cross-Origin-Resource-Policy`（CORP）で守る。

7. コミット（commit）の瞬間に起こることを 2 つ挙げよ。また、非コミットで終わるケースを 1 つ挙げよ。
   ▶ 答え: アドレスバー更新、セキュリティ表示・サイト設定 UI 更新、セッション履歴更新（ディスク保存）などのうち 2 つ。非コミットで終わるのは HTTP 204/205、または `Content-Disposition` によるダウンロード。

8. 「ページの `onload` が発火してスピナーが止まった」時点で DOM の探索を終えてよいか。理由も述べよ。
   ▶ 答え: よくない。原文が明言するとおり、クライアントサイド JS は onload 後も追加リソースを読み込み新しいビューを描画しうる。DOM XSS 探索はロード後も継続する必要がある。

9. URL spoofing を論じるときに区別すべき 3 つの URL は何か。renderer-initiated ナビゲーションで visible URL に表示されるのはどれか。
   ▶ 答え: last committed URL / pending URL / visible URL の 3 つ。renderer-initiated では（攻撃者が内容と pending URL を制御しうるため）last committed URL が表示される。

10. Navigation Preload の要求に付くヘッダ名と、その既定値は何か。
    ▶ 答え: ヘッダ名は `Service-Worker-Navigation-Preload`、既定値は `true`（W3C Service Worker 仕様のソースで確定）。

## 出典

- Inside look at modern web browser (part 2): https://developer.chrome.com/blog/inside-browser-part2
- 記事原稿（原典の生成元 Markdown）: https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part2/index.md
- Chromium MIME sniffer 実装: https://raw.githubusercontent.com/chromium/chromium/main/net/base/mime_sniffer.cc
- Chromium MIME sniffer ヘッダ: https://raw.githubusercontent.com/chromium/chromium/main/net/base/mime_sniffer.h
- Chromium CORB explainer: https://raw.githubusercontent.com/chromium/chromium/main/services/network/cross_origin_read_blocking_explainer.md
- ORB 提案 (annevk/orb): https://raw.githubusercontent.com/annevk/orb/main/README.md
- Chromium ORB 実装 API: https://raw.githubusercontent.com/chromium/chromium/main/services/network/public/cpp/orb/orb_api.h
- Chromium "Life of a Navigation": https://raw.githubusercontent.com/chromium/chromium/main/docs/navigation.md
- Chromium "Navigation Concepts": https://raw.githubusercontent.com/chromium/chromium/main/docs/navigation_concepts.md
- Chromium プロセスモデルとサイト分離: https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md
- Chromium RenderDocument: https://raw.githubusercontent.com/chromium/chromium/main/docs/render_document.md
- W3C Service Worker 仕様ソース: https://raw.githubusercontent.com/w3c/ServiceWorker/main/index.bs
- MIME types（MDN）: https://developer.mozilla.org/docs/Web/HTTP/Basics_of_HTTP/MIME_types
- SafeBrowsing: https://safebrowsing.google.com/
- CORB for developers（Chromium）: https://www.chromium.org/Home/chromium-security/corb-for-developers
- beforeunload（MDN）: https://developer.mozilla.org/docs/Web/Events/beforeunload
- Service Workers（primer）: https://developers.google.com/web/fundamentals/primers/service-workers/
- Navigation Preload: https://developers.google.com/web/updates/2017/02/navigation-preload

<!-- self-read: https://developer.chrome.com/blog/inside-browser-part2 | developer.chrome.com が egress プロキシで 403、図PNG 12点も storage.googleapis.com が 403 で未取得 -->
<!-- self-read: https://www.chromium.org/Home/chromium-security/corb-for-developers | www.chromium.org への CONNECT が egress プロキシで 403 -->
<!-- self-read: https://anforowicz.github.io/xsdb-demo/index.html | CORB のブロックをブラウザ上で観測するデモページ、本環境未取得 -->
<!-- self-read: https://youtu.be/mX7jQsGCF6E | Life of a Navigation 講演は動画のため自動取得不可 -->

<!-- sources: https://developer.chrome.com/blog/inside-browser-part2, https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/inside-browser-part2/index.md, https://raw.githubusercontent.com/chromium/chromium/main/net/base/mime_sniffer.cc, https://raw.githubusercontent.com/chromium/chromium/main/net/base/mime_sniffer.h, https://raw.githubusercontent.com/chromium/chromium/main/services/network/cross_origin_read_blocking_explainer.md, https://raw.githubusercontent.com/annevk/orb/main/README.md, https://raw.githubusercontent.com/chromium/chromium/main/services/network/public/cpp/orb/orb_api.h, https://raw.githubusercontent.com/chromium/chromium/main/docs/navigation.md, https://raw.githubusercontent.com/chromium/chromium/main/docs/navigation_concepts.md, https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md, https://raw.githubusercontent.com/w3c/ServiceWorker/main/index.bs, https://developer.mozilla.org/docs/Web/HTTP/Basics_of_HTTP/MIME_types, https://safebrowsing.google.com/, https://www.chromium.org/Home/chromium-security/corb-for-developers, https://developer.mozilla.org/docs/Web/Events/beforeunload, https://developers.google.com/web/updates/2017/02/navigation-preload -->
<!-- terms: ナビゲーション, ブラウザプロセス, レンダラプロセス, UIスレッド, networkスレッド, storageスレッド, IPC, MIME Type sniffing, Content-Type, X-Content-Type-Options: nosniff, SafeBrowsing, CORB, ORB, Cross-Origin-Resource-Policy, XSSI, Spectre, Site Isolation, 同一オリジンポリシー, Service Worker, Navigation Preload, Service-Worker-Navigation-Preload, beforeunload, unload, onload, コミット, オリジン, omnibox, punycode, Spare Process, NavigationThrottle, WebContentsObserver, last committed URL, pending URL, visible URL, インタースティシャル, JSONP, CORS -->
