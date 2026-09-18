# [34] DOM Invader — 「DOM XSS を reflected XSS のように見つける」ための Burp 内蔵ツール（ch06）

## 取得状況

> **【補完工程での更新 / 重要】** 前工程では担当 URL 2 本とも `failed`（組織エグレスポリシーによる `portswigger.net` 全面ブロック）だったが、**補完工程で両方とも本文全文の取得に成功した**。ブロックされているのは `portswigger.net` というホストへの接続であって、コンテンツ自体は GitHub 上に完全な形で存在していた。したがって**本ノートの中心記述は間接情報ではなく一次情報（原文全文）に基づく**。以下、前工程の「（間接: WebSearch 経由）」という但し書きは、**本補完工程で原文により裏取り済みの箇所についてはすべて撤回**する。撤回できなかった箇所は明示する。

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://portswigger.net/blog/introducing-dom-invader | **full**（本文全文・原文英語） | curl → `raw.githubusercontent.com/bosterptr/nthwse/HEAD/scraper/raw/2206.html`（HTTP 200, 58,623 bytes） | **原典ブログを丸ごとスクレイプした生 HTML** がこのリポジトリに保存されていた。`<title>` が `Introducing DOM Invader: DOM XSS just got a whole lot easier to find \| Blog - PortSwigger` で一致。本文・`sourcesList`・`sinkRanking`（1〜86 の完全版）・Team effort 節・Eating our own dog food 節まで全て含む。抽出テキストは `scratchpad/dom34/blog_text.txt`（14,184 字） |
| https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss | **full**（本文全文・原文英語＋公式日本語版） | curl → Burp 同梱ドキュメントのミラー 2 本（下記） | Burp Suite は**公式ドキュメントのオフライン版を製品に同梱**しており、そのリソースツリーが GitHub 上に丸ごと置かれていた。パスが `Documentation/burp/documentation/desktop/tools/dom-invader/dom-xss.html` と**公開 URL のパス構造と完全一致**するため、対象 URL と同一コンテンツと判断できる |
| （原典B 英語）https://raw.githubusercontent.com/1tbfree/BurpSuitePro-SourceLeak/HEAD/resources/Documentation/burp/documentation/desktop/tools/dom-invader/dom-xss.html | **full** | curl（HTTP 200, 8,678 bytes） | 英語原文。逐語引用はここから取った |
| （原典B 日本語）https://raw.githubusercontent.com/ankokuty/burp-resources-ja/HEAD/Documentation/burp/documentation/desktop/tools/dom-invader/dom-xss.html | **full** | curl（HTTP 200, 9,339 bytes） | **PortSwigger 公式日本語ドキュメント**（Burp 同梱の ja リソース）。UI 名称の日本語訳を確定させるのに使用。見出しの `id` 属性（`injecting-a-canary` 等）が英語版と一致し、対応関係が検証できる |
| （原典A 裏取り）https://raw.githubusercontent.com/izj007/wechat/HEAD/articles/[未分類]-2021-8-21-DOM Invader_ 让DOM XSS的发现变得更加容易 · Chen's Blog.md | **full** | curl（HTTP 200, 8,163 bytes） | 原典ブログの中国語翻訳（訳者 key / Chen's Blog、原文 URL を明記）。`sourcesList` と `sinkRanking` をコードブロックで**逐語転載**しており、スクレイプ版と 1 文字違わず一致した。→ **sinkRanking の完全性を独立ソースで二重確認済み** |
| （補助）https://raw.githubusercontent.com/wrench1997/Jackdaw/HEAD/domxss/dom_xss_zx.js | **full** | curl（HTTP 200, 11,603 bytes） | DOM Invader の**実際の注入スクリプトから定数部を抽出・逆難読化したとみられるファイル**（非公式・バージョン不明）。`FOLLOW_UP_CHARACTERS` / `jsSinks` / `htmlSinks` / `urlSinks` / `extensionExcludedSinks` / `PROTOTYPE_POLLUTION_TECHNIQUES` など、**ブログにも公式ドキュメントにも載っていない内部定数**が含まれる。ファイル後半（`//以下都是Claude的软件开发` 以降）はリポジトリ作者の自作コードなので DOM Invader とは無関係 — 混同しないこと |
| （併読）DOM Invader 公式ドキュメント 全 13 ページ | **full** | curl（同ミラー、英語版・日本語版） | `index` / `enabling` / `dom-xss` / `web-messages` / `prototype-pollution` / `dom-clobbering` / `settings/{index,main,attack-types,web-messages,prototype-pollution,misc,canary}` |
| （代替1）https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/dom-invader.md | **full** | curl（HTTP 200, 7,506 bytes） | HackTricks 現行版。前工程で取得済み。公式で裏が取れた記述はそちらを優先し、HackTricks 独自の運用助言だけ残した |
| （代替2）https://raw.githubusercontent.com/temphylic/hackxyz/master/pentesting-web/xss-cross-site-scripting/dom-invader.md | **full** | curl（HTTP 200, 7,809 bytes） | 旧 HackTricks 版。同上 |
| （代替3）https://raw.githubusercontent.com/Sivnerof/Sources-And-Sinks-Cheatsheet/HEAD/README.md | **full** | curl（HTTP 200, 11,606 bytes） | PortSwigger の DOM-based 脆弱性レッスンから抽出した source/sink 一覧 |
| （代替4）https://raw.githubusercontent.com/PortSwigger/autovader/HEAD/README.md | **full** | curl（HTTP 200, 5,114 bytes） | PortSwigger 公式・Gareth Heyes 作「AutoVader」README |
| （代替5）https://raw.githubusercontent.com/leuras/portswigger-academy/HEAD/xss/dom-based/innerhtml-sink/README.md | **full** | curl（HTTP 200) | Web Security Academy ラボ writeup。`innerHTML` の注意書きの**正しい出典**を特定するのに使用（後述の「前工程の誤りの訂正」参照） |

> **到達性に関する注記（再現手順）**: `portswigger.net` / `web.archive.org` / `medium.com` / `r.jina.ai` 等はプロキシが CONNECT に 403 を返し、補完工程でも到達不能のままだった（`curl -sS "$HTTPS_PROXY/__agentproxy/status"` で `connect_rejected` として記録される）。README（`/root/.ccr/README.md`）の指示に従い TLS 検証無効化等の迂回は一切行っていない。**突破口は「到達可能なホスト（github.com / raw.githubusercontent.com）上に、目的コンテンツの完全なコピーが存在しないか GitHub コード検索で探す」ことだった。** 検索に使った有効なクエリは次の 3 本:
> - `"sinkRanking" "globalEval"` → 中国語翻訳とスクリプト抽出ファイルがヒット
> - `"DOM XSS just got a whole lot easier to find"` → ブログのスクレイプ HTML がヒット
> - `"DOM Invader" "Copy canary" "Inject URL params"` → Burp 同梱ドキュメントのミラー 2 本がヒット
>
> なお `gitlab.com`（301）と `bitbucket.org`（200）も到達可能であることを確認したが、今回は GitHub だけで足りたため使用していない。

## 要約

- DOM Invader は Burp Suite 内蔵ブラウザ（embedded browser）に**拡張としてプリインストール**された DOM XSS 専用ツール。公式定義は「**a browser-based tool that helps you test for DOM XSS vulnerabilities using a variety of sources and sinks, including both web message and prototype pollution vectors. It is available exclusively via Burp's built-in browser, where it comes preinstalled as an extension.**」。**Professional / Community 両エディション**で使える（ドキュメント各ページに `Professional` `Community` のラベルが付く）。
- 初出は **Burp Suite Professional / Community 2021.7（Early Adopter チャネル）**。作者は PortSwigger Research の **Gareth Heyes**、ブログ公開は **2021 年 6 月 30 日 16:47 UTC**、タグは `XSS` / `DOM` / `Hacking Tools`。
- 設計思想は **「DOM XSS を reflected XSS のように探せるようにする」**。ブログの中心フレーズが `"The Augmented DOM allows you to find DOM XSS as if it were reflected XSS."`。DOM を instrument して JavaScript の source と sink を横取りし、DevTools の増設タブにツリー表示する。
- **タブ名は改称されている**: 2021 年の初期リリースでは DevTools に **`Augmented DOM` タブ**が増設された。**現行版では DevTools のタブ名が `DOM Invader`、その中のビュー名が `DOM` ビュー（と `Messages` ビュー）**になっている。公式ドキュメントは "the extension's **DOM** view" と書き、index ページだけが説明文として "The augmented DOM view" という語を残している。教科書では**両方の名前を併記**すること。
- 中核メカニズムは **canary**。公式定義「**an arbitrary but distinct string of alphanumeric characters that you can inject into different sources to see which sinks they flow into**」。**既定はランダム生成文字列**（ブログ: "By default, DOM Invader uses a random canary, but you can customize this value to whatever you like."）。現在の canary は **DOM ビューの左上**と**設定メニューの最下部**に表示される。
- sink は「**面白い順**」に並ぶ。実装上の根拠が `sinkRanking` で、**値が小さいほど重要**（ブログ: "The lower the value, the more important the sink is."）。**完全版（1〜86）を本ノートに収録済み**。
- DOM XSS の標準手順は **canary を注入 → DOM ビューで sink を特定 → Value と Outer HTML / Frame path / Event を見て XSS コンテキストを判定 → 特殊文字を canary に足してエスケープ状況を実測 → payload を組む → Stack Trace 列からクライアントコードへジャンプして到達条件を調べる**。
- **DOM XSS 単体に「Exploit ボタン」は存在しない**（前工程の記述は誤り）。`Exploit` ボタンは**プロトタイプ汚染の gadget 発見後**にだけ現れる。web message には `Build PoC` ボタンがある。
- 現行版は DOM XSS 以外に **web message（postMessage）の記録・改変・再送・自動生成・origin 偽装**、**クライアントサイド prototype pollution（source 検出 → gadget スキャン → Exploit で PoC 自動生成）**、**DOM clobbering** をカバーする。
- **実績**: ブログ末尾で作者自身が「DOM Invader の機能テスト中に著名なバグバウンティプログラムで金脈を掘り当てた」と述べ、**PayPal の DOM XSS** を発見したと明言している。

---

## 詳細ノート

### 1. 原典A: ブログ "Introducing DOM Invader: DOM XSS just got a whole lot easier to find"（全文取得済み）

**書誌**: Gareth Heyes | **30 June 2021 at 16:47 UTC** | タグ: XSS / DOM / Hacking Tools。冒頭に「Academy のラボを DOM Invader で解く YouTube 動画」へのリンクがある（動画自体は本セッションでは視聴不能）。

#### 1-1. 導入（逐語）

> **Of the three main types of XSS, DOM-based XSS is by far the most difficult to find and exploit.** But we come bearing good news! PortSwigger just released a new tool for Burp Suite Professional and Burp Suite Community Edition that's going to make testing for DOM XSS much easier - and we think you're going to like it. Meet: DOM Invader.

（XSS の主要 3 分類のうち、**DOM ベース XSS は群を抜いて発見も悪用も難しい**。）

#### 1-2. Background（逐語）

> Most modern sites use multiple JavaScript libraries - and have many lines of complex, minified code. **This makes testing for DOM XSS a real headache.** PortSwigger Research has specifically developed DOM Invader to make this process much easier.

> **"The Augmented DOM allows you to find DOM XSS as if it were reflected XSS."**

> Through its Augmented DOM, DOM Invader will provide you with a convenient tree view of all of your target's sources and sinks. This greatly simplifies the task of hunting for DOM XSS, and will be big news for the bug bounty hunting and pentest communities.

→ 教科書の導入にそのまま使える一次表現。**「複数の JS ライブラリ＋minify された大量のコード」が DOM XSS テストを頭痛の種にしている**、という問題設定。

#### 1-3. How to get started（逐語＋要点）

> DOM Invader is a **completely new Burp Suite tool, implemented as an extension in the embedded browser**. Simply update your version of Burp Suite Professional or Burp Suite Community Edition to **2021.7 on the Early Adopter channel** to start using it.

> **By default, DOM Invader is turned off (because it alters site behavior).** Turn it on by clicking the icon in the top right hand corner of Burp Suite's embedded browser.

→ **既定 OFF の理由が「サイトの挙動を変えてしまうから」と明記されている**。これは教科書の注意喚起に必須。公式ドキュメント側も同趣旨で「some of its features may interfere with your other testing activities」と書く。

#### 1-4. source / sink の定義（ブログ版・逐語）

> DOM Invader **instruments** your target's DOM, **intercepting any JavaScript sources and sinks** it might come across, and organizing them ready for you to play with. **A "source" could be any JavaScript object that allows user-controlled input (for example: `location.search`), while a "sink" is any function or setter that allows JavaScript/HTML execution.** One notorious example of a sink is the `eval` function.

> **"Helpfully, DOM Invader orders sinks so that the most interesting ones appear first."**

#### 1-5. canary の定義（ブログ版・逐語）

> With DOM Invader, we're going to be working a lot with canaries. **A canary is a unique string that's used to see where your user input is reflected inside a sink.** **By default, DOM Invader uses a random canary, but you can customize this value to whatever you like.**

→ **前工程が保留していた「既定値 `burpdomxss` 説」は、原典により否定された**。原典は一貫して「ランダムな canary が既定」と述べている。公式 canary 設定ページも "**the randomly generated default canary**" と書く。`burpdomxss` は**教科書に書かないこと**。

#### 1-6. How DOM Invader works（逐語・本章の核心）

> ... you're going to be spending a lot of your time using the tool in the Augmented DOM. **The Augmented DOM will show you all the sources and sinks contained within your target, and allows you to find DOM XSS as if it were reflected XSS - by inspecting the value sent to the sink.**

> Essentially, you'll load up the site you want to test, and insert your canary into a query parameter or other such source. Opening DevTools in Burp Suite's embedded browser, you'll be able to click on a new **"Augmented DOM"** tab - which will show you any sources and sinks containing the canary value - as well as a tree view of all the sources and sinks available. Helpfully, DOM Invader orders sinks so that the most interesting ones appear first.

> When you find an interesting sink, DOM Invader will allow you to see **the value contained in it**, as well as **a stack trace**. It'll even **highlight your canary** for you. At this point, you might like to **add some extra characters to your canary** in the URL parameter or another source. You can then **check the canary value in the Augmented DOM to see if those characters have been correctly encoded**.

> Other useful features include the ability to **search values sent to a sink**, as well as **automatically injecting canaries into URL parameters and form elements**.

→ **「canary の後ろに特殊文字を足して、エンコードされたかを Augmented DOM で見る」**という操作が、DOM Invader の最重要テクニック。次節の `FOLLOW_UP_CHARACTERS` と対応する。

#### 1-7. Web messages in DOM Invader（逐語・前工程より大幅に詳細）

> When testing sites, we've always found it cumbersome to test for web-message vulnerabilities. Sure, you can add event listeners and breakpoints in Chrome - but there's no easy way to edit them without going to the effort of writing some JavaScript code.

> **"DOM Invader is capable of manipulating web messages and spoofing their origin automatically, if you so wish."**

> DOM Invader lets you see web messages and easily reissue them in its **Postmessage tab**. ... to access this functionality, just click on DOM Invader's icon in the embedded browser, and turn on **"Postmessage interception"**.

> Through the Postmessage tab, you'll be able to see a bunch of useful information about any web messages your target sends. This includes **their type (e.g. JSON string/JavaScript object), origin, actual data sent, and the location in the code where they occur (the Stack Trace)**.

> You can then click through to open a web message, where you can manipulate the data sent. You can also have DOM Invader **spoof the origin** of a web message, simply by clicking the **"Spoof origin" check box**.

> If you find a vulnerable event listener and you've successfully crafted an exploit in the data box, then you can generate a proof of concept at the touch of a button. Simply click the **"Build PoC" button, and your PoC will be copied to the clipboard**.

**severity / confidence のグレーディング（原典のみに載る重要記述・逐語）**:

> DOM Invader also **attempts to grade the severity and confidence of messages it sees based on several factors - including if the message data was found in a sink and what type of sink it was**. When messages are manipulated, **DOM Invader will attempt to do a follow up with more interesting characters. If this is successful it will upgrade the severity and confidence based on the follow up characters that were found unencoded in the sink.**

→ **これが DOM Invader の「自動トリアージ」の正体**。①message data が sink に届いたか、②その sink がどの種類か、で初期グレードを決め、③**follow-up 文字（次節の `FOLLOW_UP_CHARACTERS`）が未エンコードで sink に残っていれば severity / confidence を格上げする**。教科書の「ツールの出す severity をどう読むか」の節に必須。

#### 1-8. List of sources and sinks を公開した理由（逐語）

> Whilst developing DOM Invader we quite naturally needed a list of sources and sinks so we decided to produce one and put it into DOM Invader. **We decided to release this list and terminology as it was trivial to extract from the source anyway.** This will be included in the XSS cheat sheet when it's updated - but for now the current list will be added to this post. **We use the sink ranking terminology in order to decide which sink is more important than others. The lower the value, the more important the sink is.**

→ **この一覧は PortSwigger が意図的に公開したもの**であり、引用して教科書の付録にしてよい性質のもの。

#### 1-9. Team effort（謝辞 — 設計の系譜がわかる）

- **アイデアの発案は James Kettle**（「拡張として作る」という案）。さらに **James は Cure53 の Filedescriptor（@filedescriptor）が作った類似ツールに着想を得た**と明記されている。→ DOM Invader は無から生まれたのではなく、**Cure53 の先行ツール → James Kettle の着想 → Gareth Heyes の実装**という系譜を持つ。教科書の「ツールの歴史」欄に使える。
- 開発時、Gareth Heyes は **一時的に PortSwigger の Scanner チームに参加**して開発した。
- その他の謝辞: Patrick Albinson（リファクタリング / Gradle）、Alex（リファクタリングと大幅な改良）、Paul Wilshaw（UI、特に Postmessage 周り）、Nolan Ward（動画編集・アニメーション）、Matt Atkinson（コピー編集）、**Nigel Evans（ドキュメント）**、Chris Wood（UI セッションの運営）、UX テスト協力: James Kettle / Michael Stepankin / Andrzej Matykiewicz / Trikster。

#### 1-10. Eating our own dog food（一次情報としての発見実績）

> Hopefully, you're now raring to go and find some DOM XSS with DOM Invader. We think there's plenty out there. In fact, we know there is, because **we recently struck gold on a well-known bug bounty program while testing DOM Invader's functionality. Head over to the research channel to read up about the PayPal DOM XSS I found.**

→ **DOM Invader 自身のドッグフーディングで PayPal の DOM XSS を発見**した、と作者本人が一次情報として書いている。前工程には二次情報（Medium の $500 事例）しかなかったので、**教科書の「実際の発見例」はまずこれを一次事例として挙げるべき**。ただし PayPal 案件の詳細記事本体（research channel 側）は本セッションでは未取得。

---

### 2. 原典B: 公式ドキュメント "Testing for DOM XSS"（全文取得済み・英語原文＋公式日本語訳）

対象 URL そのもの。ページ構成は **導入 → Injecting a canary（＋Injecting a canary into multiple sources）→ Identifying controllable sinks → Determining the XSS context → Studying the client-side code → Read more** の 5 節。エディションラベルは `Professional` `Community`。

#### 2-0. 導入（逐語・英／公式日本語訳）

> **Testing for DOM XSS can be tedious as it often involves manually tracking the flow of your input through complex JavaScript, which may stretch to thousands of lines of code. DOM Invader greatly simplifies this process by instantly showing you any sinks that your input flows into, along with the surrounding context.**
>
> You can access most of the related features from the extension's **DOM** view.

公式日本語訳（Burp 同梱 ja リソース）:

> 「DOM XSS のテストで入力の流れを追跡する際、多くの場合 JavaScript が複雑でときには数千行に及ぶこともあるため、面倒な作業になることがあります。DOM Invader はこのプロセスを大幅に簡素化し、**入力がたどり着くシンクを関連するコンテキストとともに即座に表示**します。」「拡張機能の **DOM** ビューから、ほとんどの機能にアクセスできます。」

→ **公式日本語訳では source/sink を「ソース」「シンク」、canary を「カナリア」と訳している**。教科書の訳語はこれに合わせるのが安全。

#### 2-1. Injecting a canary（逐語）

> DOM Invader works by **automatically parsing the DOM to look for occurrences of a predefined "canary" string. This is an arbitrary but distinct string of alphanumeric characters that you can inject into different sources to see which sinks they flow into.**
>
> **You can see the current canary that DOM Invader is tracking in the upper-left corner of the DOM view.** Note that you can change the canary to a custom string if you prefer.

**手動注入の正式手順（4 ステップ・逐語）**:

1. Go to the **DOM Invader** tab in the browser's DevTools panel.
2. Make sure that you are in the **DOM** view.
3. Click **Copy canary**. The canary that DOM Invader is tracking is copied to your clipboard.
4. Paste the canary into any inputs that you want to test. This could be query parameters in the URL, form fields, and so on.

→ 前工程は step 1 を「ブラウザウィンドウを右クリック → Inspect」と書いていたが、**それは `enabling` ページ（初回セットアップ）の手順**であり、`dom-xss` ページ本体の手順は上記 4 ステップ。教科書では分けて書くこと。

#### 2-2. Injecting a canary into multiple sources（逐語）

> - **Inject URL params** - Automatically injects the canary into **every query parameter in the URL, using a separate tab for each parameter**.
> - **Inject forms** - Automatically injects the canary into any HTML form fields detected on the page. **Note that you still need to submit the form manually for the injection to take effect.**

> **Note**: **Injecting the canary into all URL parameters and form fields at once may prevent the site from working properly. For the best results, we recommend testing one source at a time.**

→ **`Inject forms` は「フォームに値を入れるだけ」で、送信は手動**。ここを知らないと「Inject forms を押したのに何も出ない」と誤解する。前工程のノートにはなかった重要な運用注意。
→ 公式が **「一度に 1 つの source をテストすることを推奨」**と明言している点も重要（全注入はサイトを壊す）。

#### 2-3. Identifying controllable sinks（逐語）

> After you inject a canary, DOM Invader **automatically parses the DOM to identify any sinks in which your canary appears**. It then displays these sinks in the **DOM** view, **sorted in order of how interesting they are**.

#### 2-4. Determining the XSS context（逐語・本章の核心）

> Once you have identified a controllable sink, the next step is to study the context in which your injected payload appears. This includes determining the following information:
>
> - Whether you're working with an **HTML or JavaScript execution sink**.
> - Whether your input is **surrounded by any special characters that you need to break out of**. These include quotes, tags, attributes, and so on.
> - What kind of **validation, sanitization, or other processing** the website performs on your input before it reaches the sink.

> To help you with this, DOM Invader displays the sink's contents, including both your canary and any surrounding characters that you inject as they appear in the DOM. **This means you can append special characters to your canary in order to easily see whether they are being escaped or encoded.** In the following example, you can see that we're able to successfully inject a variety of useful characters.

**sink の種類に応じて追加表示される 3 つの情報（逐語）— 前工程のノートに完全に欠落していた項目**:

> You can also see the following details depending on the type of sink DOM Invader has identified:
>
> - **Outer HTML** - The HTML element that surrounds your canary.
> - **Frame path** - The frame in which your canary is passed to the sink.
> - **Event** - The JavaScript event that occurs when your canary is passed to the sink.

公式日本語訳:

> - **Outer HTML** — カナリアを囲む HTML 要素。
> - **Frame path** — カナリアがシンクにたどり着くフレーム。
> - **Event** — カナリアがシンクにたどり着いたときに発生する JavaScript イベント。

> This information enables you to easily see the XSS context and test which characters and events you need to craft an exploit. In the following example, **we've successfully broken out of the double-quoted string and surrounding `<span>` in order to inject our XSS proof-of-concept exploit**.

→ この 3 列は教科書の「コンテキスト判定」節の中心。特に:
- **Outer HTML** … 「どのタグの中に落ちているか」が一目でわかる → ブレイクアウトに必要な閉じタグが決まる。
- **Frame path** … **iframe 内で起きている脆弱性を識別する公式手段**。前工程が HackTricks 経由で書いていた「iframe は手動でフォーカスが要る」問題は、この列で所在を特定してから対処する。
- **Event** … `Auto-fire events` 設定（後述）と対で読む。「click したときだけ sink に届く」ケースを可視化する。

#### 2-5. Studying the client-side code（逐語・4 ステップ）

> When experimenting with different injections, you might find that **your input suddenly stops flowing into the sink. This could be because you can only reach the sink via a specific code path, such as one branch of a conditional statement.**
>
> DOM Invader enables you to **jump straight to the point in the client-side code where your input is passed to the sink**. You can then study the preceding code to identify **what conditions your input must meet in order to reach the sink**.

**正式手順（逐語）**:

1. Inject a payload that you know will reach the sink.
2. In DOM Invader's **DOM** view, **click the link in the `Stack Trace` column**. This **outputs a stack trace to the browser's console**.
3. In the DevTools panel, **switch to the `Console` tab**.
4. In the stack trace, **click the uppermost link** (there may only be one). This **opens the client-side JavaScript in the `Sources` tab and focuses on the line where your input is passed to the sink**.

→ 前工程は「sink をクリックするとジャンプできる」と曖昧に書いていたが、**正しくは `Stack Trace` 列のリンク → Console タブ → 一番上のリンク → Sources タブ**という 4 手。教科書には必ずこの順で書くこと。

#### 2-6. このページに「Exploit ボタン」は登場しない（前工程の誤りの訂正）

`dom-xss` ページの全文には **`Exploit` という語が 1 度も出てこない**。ページは `Studying the client-side code` の次に `Read more`（settings への導線）で終わる。前工程のノートは手順 8 に「Exploit ボタンをクリックすると PoC で sink をテストし、`alert()` が呼べたら確定」と書いていたが、**これはプロトタイプ汚染のページ（`prototype-pollution`）の記述の混入**である。正しくは:

- **DOM XSS**: Exploit ボタンなし。payload を自分で組んで実行を確認する。
- **prototype pollution**: gadget 発見後に **`Exploit` ボタン**が現れ、source + gadget + sink を連鎖した PoC を新ウィンドウで自動実行して `alert()` を出す。
- **web message**: **`Build PoC` ボタン**で HTML PoC をクリップボードにコピー。

#### 2-7. 参照している画像（本セッションでは未取得）

`dom-invader-innerHTML-sink.png`（alt: "DOM Invader によるDOM XSS のテスト"）/ `dom-invader-unescaped-chars.png`（alt: **"反射型 XSS のように DOM XSS をテスト"**）/ `dom-invader-payload.png`（alt: "エクスプロイトの作成"）。**UI の見た目だけは読者自身が原典で確認する必要がある**（後述「読者が自分で開くべき資料」参照）。

---

### 3. DOM Invader 内部定数（非公式抽出・出典: wrench1997/Jackdaw `domxss/dom_xss_zx.js`）

> **信頼度の注意**: これは DOM Invader の注入スクリプトから定数部を抜き出したとみられる**非公式ファイル**で、対応する Burp のバージョンは不明。ただし収録された `sinkRanking` が**原典ブログの掲載内容と 1 文字違わず一致**し（`__proto__: null` と一部の追加エントリを除く）、かつ公式ドキュメントの記述とも整合するため、**内容の信憑性は高い**。教科書に載せる場合は「非公式に抽出された内部定数」と明記すること。

#### 3-1. `FOLLOW_UP_CHARACTERS` — DOM Invader が自動で足す特殊文字

```javascript
const FOLLOW_UP_CHARACTERS = "\\<>'\":";
```

すなわち **バックスラッシュ `\`、小なり `<`、大なり `>`、シングルクォート `'`、ダブルクォート `"`、コロン `:`** の 6 文字。

**意味**: 公式ドキュメントの「**you can append special characters to your canary in order to easily see whether they are being escaped or encoded**」と、ブログの「**DOM Invader will attempt to do a follow up with more interesting characters ... it will upgrade the severity and confidence based on the follow up characters that were found unencoded in the sink**」が指しているのが、この文字集合。手で canary に足すときも**まずこの 6 文字を試すのが公式実装と同じ基準**になる。

- `< >` … HTML タグを作れるか
- `' "` … 文字列/属性からブレイクアウトできるか
- `\` … JS 文字列内でエスケープを崩せるか
- `:` … `javascript:` スキームを作れるか（`javascriptURL` sink ランク 31 に対応）

#### 3-2. sink の 3 分類（DOM Invader 自身の分類）

公式ドキュメントが「**Whether you're working with an HTML or JavaScript execution sink**」と問うている、その「種類」の実体がこれ。

**`jsSinks`（JavaScript 実行 sink, 30 個）**
`jQuery.globalEval`, `eval`, `Function`, `execScript`, `setTimeout`, `setInterval`, `setImmediate`, `msSetImmediate`, `script.textContent`, `script.text`, `script.innerText`, `script.innerHTML`, `script.appendChild`, `script.append`, `javascriptURL`, `jQuery.attr.on{click,mouseover,mousedown,mouseup,keydown,keypress,keyup}`, `element.setAttribute.on{click,mouseover,mousedown,mouseup,keydown,keypress,keyup}`, `element.setAttribute.on*`

**`htmlSinks`（HTML 実行 sink, 32 個）**
`document.write`, `document.writeln`, `jQuery`, `jQuery.$`, `jQuery.constructor`, `jQuery.parseHTML`, `jQuery.has`, `jQuery.init`, `jQuery.index`, `jQuery.add`, `jQuery.append`, `jQuery.appendTo`, `jQuery.after`, `jQuery.insertAfter`, `jQuery.before`, `jQuery.insertBefore`, `jQuery.html`, `jQuery.prepend`, `jQuery.prependTo`, `jQuery.replaceWith`, `jQuery.replaceAll`, `jQuery.wrap`, `jQuery.wrapAll`, `jQuery.wrapInner`, `jQuery.prop.innerHTML`, `jQuery.prop.outerHTML`, `element.innerHTML`, `element.outerHTML`, `element.insertAdjacentHTML`, `iframe.srcdoc`, `createContextualFragment`, `document.implementation.createHTMLDocument`

**`urlSinks`（URL sink, 25 個）**
`location.href`, `location.replace`, `location.assign`, `location`, `window.open`, `iframe.src`, `script.src`, `jQuery.attr.{href,src,data,action,formaction}`, `jQuery.prop.{href,src,data,action,formaction}`, `form.action`, `input.formaction`, `button.formaction`, `element.setAttribute.{href,src,data,action,formaction}`

```javascript
const interestingSinks = [ ...jsSinks, ...htmlSinks, ...urlSinks ];
```

→ **教科書での使い方**: DOM ビューに出た sink 名をこの 3 分類に当てると、次に打つべき payload の形がただちに決まる。
- `jsSinks` → クォート/括弧のブレイクアウトだけ考える（`\` と `'` `"` が効くか）
- `htmlSinks` → タグを作れるか（`<` `>`）、作れるならイベントハンドラ属性へ
- `urlSinks` → `javascript:` が通るか（`:`）。通らなければオープンリダイレクトとして扱う

#### 3-3. `sourcesList`（抽出版）

```javascript
const sourcesList = [
    "location", "location.href", "location.hash", "location.search", "location.pathname",
    "document.URL", "window.name", "document.referrer", "document.documentURI",
    "document.baseURI", "document.cookie", "URLSearchParams"
];
```

→ **2021 年のブログ掲載版（11 個）に `URLSearchParams` が加わって 12 個**になっている。`new URLSearchParams(location.search).get('x')` という現代的な書き方を捕捉するための追加とみられる（Academy の innerHTML ラボの脆弱コードがまさにこの形）。

#### 3-4. `extensionExcludedSinks` — 拡張版で instrument されない sink

```javascript
const extensionExcludedSinks = [
    "button.value", "webdatabase.executeSql", "anchor.target",
    "element.outerText", "element.innerText", "element.textContent",
    "element.style.cssText", "RegExp", "input.value", "input.type", "document.evaluate"
];
const sinksList = Object.keys(sinkRanking).filter(key => !extensionExcludedSinks.includes(key));
```

→ **ランキング表に載っていても、ブラウザ拡張としての DOM Invader では監視されない sink がある**（ランク 52, 58, 65, 72〜76, 84〜86 のほぼ全部）。つまり **`element.textContent` や `input.value` に canary が届いても DOM ビューには出ない**。「出なかった＝存在しない」と結論してはいけない、という false negative の根拠。公式の `settings/main` も「**By default, all sources are hidden and only the most interesting sinks are instrumented.**」と書いており整合する。

#### 3-5. `mouseEvents` / `keyboardEvents`

```javascript
const mouseEvents = ["mouseover", "click", "mousedown", "mouseup"];
const keyboardEvents = ["keydown", "keypress", "keyup"];
```

→ 公式の **`Auto-fire events`** 設定（「click と mouseover をページ読込時に全要素で発火」）と、`jQuery.attr.on*` / `element.setAttribute.on*` sink 群に対応する。

#### 3-6. `PROTOTYPE_POLLUTION_TECHNIQUES` — 汚染手法は 4 種

抽出ファイルには 4 つの手法オブジェクトがあり、それぞれ `source` 文字列を持つ:

| # | `source`（手法の表記） |
| --- | --- |
| 1 | `constructor[prototype][property]=value` |
| 2 | `constructor.prototype.property=value` |
| 3 | `__proto__.property=value` |
| 4 | `__proto__[property]=value` |

各手法は `hashIdentifier` / `searchIdentifier` の 2 種の識別子を持つ（**URL の hash 経由の汚染と、クエリ文字列経由の汚染を区別するため**）。ソース名には `PROTOTYPE_POLLUTION_SOURCE_PREFIX = "Prototype pollution: "` が付く。また `Error.stackTraceLimit = 20` に設定される（スタックトレース取得のため）。

→ 公式 `settings/prototype-pollution` の **`Disabling prototype pollution techniques`**（Techniques ボタンで手法を個別 ON/OFF）で操作できるのが、この 4 手法。「`__proto__` と `constructor` を同時に試すと壊れるサイトがある」という公式の記述とも対応する。

---

### 4. `sinkRanking` 完全版（1〜86）— 原典ブログ掲載・逐語

> **出典と検証**: 原典ブログ本文のコードブロック。**中国語翻訳版（Chen's Blog）の逐語転載と 1 文字違わず一致**することを確認済み。さらに非公式抽出ファイル `dom_xss_zx.js` の `sinkRanking` ともランク番号が完全一致（抽出版には `element.setAttribute.on*:33`, `fetch.url:36`, `fetch.header:36` が追加されている＝後のバージョンでの追加）。**前工程で「26 以降は復元不能」としていた部分はこれで完全に埋まった。**
>
> **読み方の原則（ブログ逐語）**: "**The lower the value, the more important the sink is.**"（値が小さいほど重要）

```javascript
const sinkRanking = {
    "jQuery.globalEval":1,
    "eval":2,
    "Function":3,
    "execScript":4,
    "setTimeout":5,
    "setInterval":6,
    "setImmediate":7,
    "msSetImmediate":7,
    "script.src":8,
    "script.textContent":9,
    "script.text":10,
    "script.innerText":11,
    "script.innerHTML":12,
    "script.appendChild":13,
    "script.append":14,
    "document.write": 15,
    "document.writeln": 16,
    "jQuery":17,
    "jQuery.$":18,
    "jQuery.constructor":19,
    "jQuery.parseHTML":20,
    "jQuery.has":20,
    "jQuery.init":20,
    "jQuery.index":20,
    "jQuery.add": 20,
    "jQuery.append": 20,
    "jQuery.appendTo": 20,
    "jQuery.after": 20,
    "jQuery.insertAfter": 20,
    "jQuery.before": 20,
    "jQuery.insertBefore": 20,
    "jQuery.html": 20,
    "jQuery.prepend": 20,
    "jQuery.prependTo": 20,
    "jQuery.replaceWith": 20,
    "jQuery.replaceAll": 20,
    "jQuery.wrap": 20,
    "jQuery.wrapAll": 20,
    "jQuery.wrapInner": 20,
    "jQuery.prop.innerHTML": 20,
    "jQuery.prop.outerHTML": 20,
    "element.innerHTML":21,
    "element.outerHTML":22,
    "element.insertAdjacentHTML":23,
    "iframe.srcdoc": 24,
    "location.href":25,
    "location.replace":26,
    "location.assign":27,
    "location":28,
    "window.open":29,
    "iframe.src":30,
    "javascriptURL":31,
    "jQuery.attr.onclick":32,
    "jQuery.attr.onmouseover":32,
    "jQuery.attr.onmousedown":32,
    "jQuery.attr.onmouseup":32,
    "jQuery.attr.onkeydown":32,
    "jQuery.attr.onkeypress":32,
    "jQuery.attr.onkeyup":32,
    "element.setAttribute.onclick":33,
    "element.setAttribute.onmouseover":33,
    "element.setAttribute.onmousedown":33,
    "element.setAttribute.onmouseup":33,
    "element.setAttribute.onkeydown":33,
    "element.setAttribute.onkeypress":33,
    "element.setAttribute.onkeyup":33,
    "createContextualFragment":34,
    "document.implementation.createHTMLDocument": 35,
    "xhr.open":36,
    "xhr.send": 36,
    "fetch": 36,
    "fetch.body": 36,
    "xhr.setRequestHeader.name": 37,
    "xhr.setRequestHeader.value": 38,
    "jQuery.attr.href":39,
    "jQuery.attr.src":40,
    "jQuery.attr.data":41,
    "jQuery.attr.action":42,
    "jQuery.attr.formaction":43,
    "jQuery.prop.href":44,
    "jQuery.prop.src":45,
    "jQuery.prop.data":46,
    "jQuery.prop.action":47,
    "jQuery.prop.formaction":48,
    "form.action":49,
    "input.formaction":50,
    "button.formaction":51,
    "button.value": 52,
    "element.setAttribute.href":53,
    "element.setAttribute.src":54,
    "element.setAttribute.data":55,
    "element.setAttribute.action":56,
    "element.setAttribute.formaction":57,
    "webdatabase.executeSql": 58,
    "document.domain":59,
    "history.pushState":60,
    "history.replaceState":61,
    "xhr.setRequestHeader":62,
    "websocket":63,
    "anchor.href":64,
    "anchor.target": 65,
    "JSON.parse": 66,
    "document.cookie":67,
    "localStorage.setItem.name": 68,
    "localStorage.setItem.value": 69,
    "sessionStorage.setItem.name": 70,
    "sessionStorage.setItem.value": 71,
    "element.outerText": 72,
    "element.innerText": 73,
    "element.textContent": 74,
    "element.style.cssText": 75,
    "RegExp":76,
    "window.name":77,
    "location.pathname": 78,
    "location.protocol": 79,
    "location.host": 80,
    "location.hostname": 81,
    "location.hash": 82,
    "location.search": 83,
    "input.value": 84,
    "input.type": 85,
    "document.evaluate": 86
};
```

#### `sourcesList`（原典ブログ掲載版・逐語）

```javascript
const sourcesList = [
    "location",
    "location.href",
    "location.hash",
    "location.search",
    "location.pathname",
    "document.URL",
    "window.name",
    "document.referrer",
    "document.documentURI",
    "document.baseURI",
    "document.cookie"
];
```

#### ランキングの帯別の読み方（教科書向けトリアージ順序）

| 帯 | ランク | 内容 | ハンターの判断 |
| --- | --- | --- | --- |
| A | 1–7 | `jQuery.globalEval`, `eval`, `Function`, `execScript`, `setTimeout`, `setInterval`, `setImmediate` | **JS 直接実行**。クォート/括弧のブレイクアウトだけで即実行。最優先 |
| B | 8–14 | `script.src` と `script.*`（本体書き込み） | **スクリプトの中身か読み込み元**を握れる。`script.src` は CSP `script-src` 次第 |
| C | 15–24 | `document.write(ln)`, jQuery の HTML 挿入 API 群, `element.innerHTML/outerHTML/insertAdjacentHTML`, `iframe.srcdoc` | **HTML 挿入**。`document.write` は `<script>` が効くが `innerHTML` 系は効かない（後述） |
| D | 25–31 | `location.*`, `window.open`, `iframe.src`, `javascriptURL` | **ナビゲーション**。`javascript:` が通れば XSS、通らなければオープンリダイレクト |
| E | 32–33 | `jQuery.attr.on*`, `element.setAttribute.on*` | **イベントハンドラ属性**。値がそのまま JS として評価される |
| F | 34–35 | `createContextualFragment`, `createHTMLDocument` | HTML パースの別経路 |
| G | 36–38 | `xhr.open/send`, `fetch`, `xhr.setRequestHeader.*` | **SSRF 風のリクエスト改竄 / ヘッダインジェクション** |
| H | 39–57 | `href`/`src`/`data`/`action`/`formaction` 系（jQuery attr/prop, form, input, button, setAttribute） | **リンク・フォーム送信先の改竄**。`formaction` は CSRF/フィッシングに化ける |
| I | 58–71 | `executeSql`, `document.domain`, `history.*`, `websocket`, `anchor.*`, `JSON.parse`, `document.cookie`, `Storage.setItem.*` | **状態汚染系**。単体では XSS にならないことが多いが、連鎖の起点になる |
| J | 72–86 | `element.outerText/innerText/textContent`, `cssText`, `RegExp`, `window.name`, `location.*`（読み取り系）, `input.value/type`, `document.evaluate` | **低危険度**。多くが `extensionExcludedSinks` に入っており既定では監視されない |

---

### 5. 有効化手順（出典: 公式 `enabling`／全文取得）

> **DOM Invader is preinstalled in Burp's browser, but is disabled by default as some of its features may interfere with your other testing activities.**

**公式手順（逐語）**:

1. Go to the **Proxy > Intercept** tab and open Burp's browser.
2. In the **upper-right corner of the browser window, click the Burp Suite logo**. **If you can't see this logo, click the jigsaw icon first.** A panel opens containing tabs for the **Burp Suite Navigation Recorder** and **DOM Invader** settings menu.
3. From the DOM Invader settings, **toggle the switch so that DOM Invader is on**.
4. **Click `Reload` to refresh the browser. This is necessary for your changes to take effect.**
5. **Right-click anywhere in the main browser window and select `Inspect`** to open the browser's DevTools panel. Note that this now contains the **DOM Invader** tab. For the best experience, we recommend **docking the panel to the bottom** of the browser window.

> **Note**: By default, DOM Invader **remembers your previous settings, including whether it was on or off**. Keep this in mind if you close Burp's browser while DOM Invader is still enabled. To disable this behavior, go to **`Settings > Tools > Burp's browser`** and deselect **`Store settings and history after closing`**.

→ **`Reload` を押さないと設定が効かない**、というのは DOM Invader のほぼ全設定に共通する落とし穴。公式は canary 変更・postmessage 有効化・prototype pollution 有効化・DOM clobbering 有効化・callback 設定のすべてで "Click **Reload**... This is necessary for your changes to take effect." と繰り返している。**教科書では「設定を変えたら必ず Reload」を独立した注意書きにすべき。**

---

### 6. 設定の完全一覧（出典: 公式 `settings/*` 全 7 ページ／全文取得）

#### 6-1. Main settings（`settings/main`）

| 設定 | 公式記述の要点 |
| --- | --- |
| **Enable DOM Invader** | グローバルトグル。既定 OFF の理由は「一部機能が対象サイトの機能を壊し、他のテスト活動に影響しうるから」 |
| **Postmessage interception** | 有効にすると DevTools の **`Messages` ビュー**で web message の DOM XSS をテストできる。歯車から詳細設定（`settings/web-messages`） |
| **Customizing sources and sinks** | メインスイッチ横の**歯車アイコン**から、instrument する source / sink を制御。**「既定ではすべての source が非表示で、最も面白い sink だけが instrument される」**。サイトが壊れるときは個別に無効化（公式の例: **「`eval()` を instrument するとその挙動が変わり関連機能が壊れることがある」**） |

#### 6-2. Attack types（`settings/attack-types`）

> **By default, DOM Invader automatically probes for ordinary DOM XSS sources and sinks, but you can optionally configure DOM Invader to attempt other attacks.**

- **Prototype pollution** — 通常の DOM XSS source/sink に加えてクライアントサイド prototype pollution の source を自動特定。歯車で詳細設定。
- **DOM clobbering** — DOM clobbering の脆弱性を自動特定。

#### 6-3. Misc settings（`settings/misc`）— 前工程より 4 項目多い

| 設定 | 公式記述の要点 |
| --- | --- |
| **Message filtering by stack trace** | 大量のメッセージを出すサイト向け。**各エントリのスタックトレースを比較し、既存エントリと同じコード位置を指すものを隠す** |
| **Auto-fire events**〔前工程に欠落〕 | **ページ読込と同時に、全要素に対して `click` と `mouseover` イベントを自動発火**する。「注入した payload が、これらのイベントが起きたときだけ sink に届く」ケースで有用 |
| **Redirection prevention** | クライアントサイドリダイレクトが起きると**それまでに見つけた source/sink がクリアされ、新しいページのもので置き換わってしまう**。有効にするとリダイレクトをブロックして同じページに留まる。**ただし `javascript:` URL へのリダイレクトと、`Inject URL` ボタンが起こしたリダイレクトは通常どおり動く** |
| **Add breakpoint before redirect** | リダイレクトをブロックする代わりに、**リダイレクトを起こすコードの直前にブレークポイントを置く**。**「現状これは Chrome の標準 DevTools では不可能」**と公式が明記。コールスタックを見てどこでリダイレクトが起きているか調べられる |
| **Inject canary into all sources** | 識別された全 source に canary を自動注入。**source ごとに canary へ一意の文字列を付加**するので「どの source がどの sink に流れたか」が判別できる。ただし「実際のところ、どこにでも注入するとサイトが正しく動かなくなる可能性が高い」。歯車から ①**特定の source を個別に無効化**（問題のある source を潰していく／逆に 1 つに絞る。**毎回手で canary を貼る手間が省ける**）②**注入対象パラメータをカンマ区切りで指定** |
| **Configuring callbacks**〔前工程に完全欠落〕 | **source / sink / web message を識別するたびにカスタムコールバック関数を実行できる**。既定のコールバックは**結果をコンソールにログ出力してエクスポートする**もの。公式が挙げるもう 1 つの用途: **`debugger` 文を入れたコールバックにして、制御可能な sink を見つけた瞬間にスクリプト実行を一時停止し、コールスタックを調べる**。有効化手順: 歯車 → `Sources` / `Sinks` / `Messages` タブを選ぶ → **`Callback configuration`** ボタン → スクリプトのテキストフィールドをクリックして有効化 → 必要なら編集して **`Save`** → **`Reload`** |
| **Remove Permissions-Policy header**〔前工程に完全欠落〕 | 応答から **`Permissions-Policy` ヘッダを除去**する。**一部サイトは `Permissions-Policy` で同期 XHR など DOM Invader に必須の機能をブロックしており、その場合 DOM Invader はコンソールで通知してこの設定を促す** |

#### 6-4. Canary settings（`settings/canary`）

- canary は**設定メニューの最下部**に表示される（DOM ビューでは左上）。
- **`Copy`** — 現在の canary をクリップボードへ。
- **変更手順**: 使いたい文字列を入力（または **`Randomize`** で新しいランダム文字列を生成）→ **`Update canary`** をクリック → **`Reload`**。
- 公式定義は「**the randomly generated default canary**」＝**既定はランダム生成**。
- **公式 Note（逐語）**: **"To avoid false positives, make sure that the string you use doesn't occur naturally on the page."**（false positive を避けるため、**ページ上に自然発生しない文字列**を使うこと）

#### 6-5. Web message settings（`settings/web-messages`）— Postmessage interception の歯車

| 設定 | 公式記述の要点 |
| --- | --- |
| **Postmessage origin spoofing** | メッセージの origin を **「本物の origin のドメイン名で始まり、かつ終わる偽 origin」** に自動置換する。**`startsWith()` / `endsWith()` でドメイン名を検証しているサイトを自動で暴く**ための仕掛け。無効にしていても、再送時に **`Spoof origin` チェックボックス**で個別に偽装でき、origin を手で編集することもできる |
| **Canary injection into intercepted messages** | ページ上で送られる全メッセージの `data` プロパティに canary を自動注入。**期待されるデータが JSON 文字列 / JSON オブジェクト / プレーン文字列のどれかを判定して正しい形式で注入する**。メッセージ詳細の **`Show` ドロップダウン**で「元のデータ」と「自動注入済みのデータ」を切り替えて見られる |
| **Filter messages with duplicate values** | 同一メッセージをグループ化してノイズを減らす。**「実際に送られているか確認したい」ときは無効化する** |
| **Generate automated messages** | 検出したイベントリスナに対し **DOM Invader が自前でメッセージを生成して送る**。「ページを普通に操作してもメッセージイベントを起こせない」ときに有用。**各ハンドラが期待するデータ構造を推測して適切なメッセージを作り、リスナの反応を見て、より危険な sink に届きうる別のコードパスを狙った follow-up メッセージを生成する**。**`Messages` ビューで数値 ID を持たないものが DOM Invader 生成のメッセージ** |
| **Detect cross-domain leaks** | **現在のページが URL 由来のデータを含む web message を別 origin に送った**ことを報告。攻撃者は当該ページを iframe に埋め込み、イベントリスナでデータを抜くことで **OAuth トークンなどの機密データを盗める**可能性がある |

#### 6-6. Prototype pollution settings（`settings/prototype-pollution`）

| 設定 | 公式記述の要点 |
| --- | --- |
| **Scan for gadgets** | ページ読込のたびに gadget を自動スキャン。**source が 1 つも見つかっていないときの代替手段**として有用（「将来悪用されうる gadget が自サイトにないか」の確認にも） |
| **Auto-scale amount of properties per frame** | gadget スキャン時の 1 フレームあたりプロパティ数を自動調整。性能は上がるが、**注入したプロパティが例外を起こして同じ iframe 内の他の gadget がテストされなくなり false negative になる**ことがある。無効にしてスライダで固定値にできる。**下げる＝遅いが取りこぼしが減る／上げる＝速いが取りこぼす** |
| **Scan nested properties** | 既定でネストしたプロパティも再帰的にスキャン。無効にするとトップレベルのみ（例の `user.contactInfo.email` / `user.contactInfo.phone` はスキップされる） |
| **Query string injection** / **Hash injection** / **JSON injection** | 汚染の注入経路 3 種（クエリ文字列 / URL フラグメント / JSON ベースの web message）。サイトが壊れるなら個別に無効化 |
| **Verify onload** | 既定ではページ読込完了を待ってから報告する（**特定した gadget が最終 DOM にも残っていることを保証するため**）。無効にするとスキャンは速いが false positive が出る（**`constructor` や `__proto__` が読込完了までにサニタイズされる**ケース） |
| **Remove CSP header** | 全応答から `Content-Security-Policy` を除去。**CSP が XSS ベクタと iframe をブロックするのを防ぐ（iframe は gadget スキャンに必須）** |
| **Remove X-Frame-Options header** | 全応答から `X-Frame-Options` を除去。**iframe を通すため（gadget スキャンに必須）** |
| **Scan each technique in separate frame** | 既定ではトップフレームでスキャンするが、手法同士が干渉して見逃すことがある（**公式の例: `__proto__` と `constructor` を同時に試すと失敗するが `constructor` 単独なら通るサイトがある**）。有効にすると手法ごとに別 iframe を使う |
| **Disabling prototype pollution techniques** | 手順: 設定メニュー → `Attack types` の `Prototype pollution` 横の歯車 → ダイアログの **`Techniques`** ボタン → スイッチで個別に ON/OFF → **`Save`** → **`Reload`** |

---

### 7. web message（postMessage）のテスト（出典: 公式 `web-messages`／全文取得）

公式の機能定義（逐語）:

> - **Logging** any web messages that are sent via the `postMessage()` method on the page, along with useful details about them. **This is similar to how Burp Proxy shows the history of your HTTP requests and responses.**
> - Enabling you to **modify and resend** web messages to manually probe for DOM XSS vulnerabilities. **This is similar to how Burp Repeater reissues modified HTTP requests.**
> - **Automatically modifying and sending** web messages to probe for DOM XSS on your behalf.

→ **Proxy ＝ログ、Repeater ＝改変再送、Scanner ＝自動プローブ**という Burp の三段構えを、web message に対してそのまま持ち込んだのが `Messages` ビュー。教科書ではこのアナロジーで説明するのが最も分かりやすい（公式自身がこのアナロジーを使っている）。

#### 7-1. 有効化

既定 OFF（「対象サイトの機能を壊さないため」）。設定メニュー → **`Postmessage interception`** スイッチ → **`Reload`**。

#### 7-2. 自動解析の中身（逐語）

> By default, DOM Invader tries to identify and flag interesting messages on your behalf. It does this by modifying the messages in the following ways:
>
> - **Injecting your canary via the message's `data` property.** DOM Invader can use this to identify any sinks that this data flows into, just like it does with other sources in the **DOM** view.
> - **Replacing the origin of the message with a fake origin that starts and ends with the expected domain name.** This enables DOM Invader to automatically identify event handlers that rely on flawed logic or regular expressions to validate the origin of incoming messages.

> Based on the observed behavior, DOM Invader automatically flags messages that it thinks are exploitable by **displaying an estimated issue severity and confidence level. All messages sent on the page are listed with at least an `Information` severity rating, as they may contain vulnerabilities that DOM Invader can't detect automatically.**

→ **「すべてのメッセージが最低でも Information で出る」**＝ **Information の行を見て「脆弱性なし」と読んではいけない**。DOM Invader が自動検出できない脆弱性がそこにある可能性がある、と公式が明言している。これは教科書の false negative 節に必須。

#### 7-3. Message details — `origin` / `data` / `source` の読み方（逐語）

メッセージをクリックすると、**`origin` / `data` / `source` の各プロパティがクライアントサイド JS から参照されたか**が分かる。

- **Origin accessed**: 「クライアントコードが `origin` プロパティを一度も参照していないなら、origin は検証されていない可能性が高い。その結果、**任意の外部ドメインからイベントハンドラへクロスオリジンのメッセージを送れる**かもしれない。**ただし `origin` を参照しているメッセージでも安全とは限らない — 検証をバイパスできる可能性がある。**」その調査のためにスタックトレース経由で該当コード行へのリンクが提供される。
- **Data accessed**: 「`data` プロパティは**あなたが payload を注入する場所**。JS がこのプロパティを一度も参照しないなら、それが sink に渡ることはない。**その場合そのメッセージは調べる価値がない。**」
- **Source accessed**: 「`source` プロパティは**メッセージの送信元 `window` オブジェクトへの参照**で、実務上はたいてい iframe への参照。**サイトは origin の代わりに `source` を検証することが多い。特定の信頼された iframe から来たことを保証するより堅牢な方法だから。** origin と同様、このプロパティを参照しているからといって検証されているとは限らないし、その検証がバイパス不能とも限らない。」

#### 7-4. 再送（Repeater 相当）と PoC 生成（逐語手順）

**再送**: `Messages` ビューで任意のメッセージをクリック → 詳細ダイアログ → **`Data` フィールドを編集** → **`Send`**。

> For example, you might identify a message where the event handler does not validate the origin and passes the data into the `element.innerHTML` sink. In this case, you could **send messages to test whether characters like `<`, `>`, and `"` are escaped**, then use these characters to create and send a proof-of-concept payload.

**PoC 生成**: 脆弱なメッセージを選ぶ → 値を編集 → **`Build PoC`** をクリック → **HTML がクリップボードに保存される**（＝レポートにそのまま貼れる HTML PoC）。

---

### 8. クライアントサイド prototype pollution（出典: 公式 `prototype-pollution`／全文取得）

公式の 3 大機能（逐語）:

> - **Automatically detect sources** for prototype pollution **in the URL and any JSON objects sent via web messages**. This includes detecting **alternative techniques using the same source**.
> - **Generate a proof of concept by polluting the `Object.prototype`** using any discovered sources. You can then manually verify the vulnerability via the browser console.
> - **Scan for potential gadgets** that you can use to craft an exploit.

**有効化**: 設定メニュー → `Attack types` → **`Prototype pollution` を ON** → **`Reload`**。

**① source の検出**: 有効化すると `Object.prototype` に任意のプロパティを追加できる source を自動チェックし、**`DOM` ビュー**に表示する。公式の例では **`location.hash` という 1 つの source に対して 2 つの手法が特定されている**（前述の 4 手法のうち該当するもの）。

**② 手動確認（逐語手順）**:

1. `DOM` ビューで該当 source 横の **`Test`** ボタンをクリック。DOM Invader が**新しいタブ**を開き、その source を使って `Object.prototype` に任意プロパティを追加する。
2. 新しいタブでブラウザコンソールへ。**DOM Invader が `Object.prototype` を自動で出力している**。
3. ノードを展開し、PoC 用の **`testproperty`** が含まれることを確認する。
4. コンソールで新しいオブジェクトを作る。
5. プロトタイプチェーン経由で `testproperty` を継承していることを確認する。

```javascript
let myObject = {};
console.log(myObject.testproperty);
// Output: 'DOM_INVADER_PP_POC'
```

**③ gadget スキャン（逐語）**:

> A prototype pollution source is of no use unless you also have access to a **"gadget" property. This is any user-controllable property that is passed to a sink without being properly sanitized.** Finding such a gadget manually is extremely tedious, but DOM Invader can automate this process.

1. `DOM` ビューで prototype pollution source 横の **`Scan for gadgets`** ボタンをクリック → **新しいタブ**が開いてスキャン開始。
2. **同じタブで** DevTools の `DOM Invader` タブを開く。スキャン完了後、**`DOM` ビューに「gadget 経由で到達できた sink」が並ぶ**。公式の例では **`html` という gadget プロパティが `innerHTML` sink に渡された**。

**④ PoC 自動生成（逐語）**:

> Once DOM Invader finds a gadget for prototype pollution, it is able to automatically generate a proof-of-concept by **combining the source, gadget, and sink** to confirm the XSS. Simply click the **`Exploit`** button next to the discovered sink. **DOM Invader opens a new window in which it successfully calls `alert()`.**

→ **`Exploit` ボタンはここにだけ存在する**（DOM XSS 単体の手順にはない）。

---

### 9. DOM clobbering（出典: 公式 `dom-clobbering`／全文取得）

> DOM clobbering is a technique in which you **inject HTML into a page to manipulate the DOM in a way that enables you to change the behavior of JavaScript on the page**.

既定 OFF。有効化: 設定メニュー → **`Attack types`** → **`DOM clobbering` を ON** → **`Reload`**。以後、**ブラウジングしている間ずっと DOM clobbering の脆弱性をスキャンし続ける**。

〔補足（HackTricks 由来・公式未確認）〕動的生成された要素の `id` / `name` がグローバル変数やフォームオブジェクトと衝突するのを監視する（例: `<input name="location">` が `window.location` を clobber する）。ユーザ制御のマークアップが変数置換につながるたびにエントリが生成される。

---

### 10. 個別 sink の扱い（innerHTML / eval / setTimeout / location など）

- **`element.innerHTML`（ランク 21）**:
  **【前工程の誤りの訂正】** 前工程は「`innerHTML` sink は `script` 要素を受け付けず `svg onload` も発火しない」という注意書きを **DOM Invader の公式ドキュメント（`dom-xss`）由来**としていたが、**`dom-xss` ページの全文にこの記述は存在しない**。正しい出典は **Web Security Academy のラボ "DOM XSS in innerHTML sink using source location.search"（https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-innerhtml-sink）のラボ説明**である。正しい逐語は:
  > The `innerHTML` sink doesn't accept `script` elements on any modern browser, nor will `svg` `onload` events fire. This means you will need to use alternative elements like `img` or `iframe`. Event handlers such as `onload` and `onerror` can be used in conjunction with these elements. For example:
  > ```javascript
  > element.innerHTML='... <img src=1 onerror=alert(document.domain)> ...'
  > ```
  DOM ビューの Value 列で「`<script>` を入れたのに何も起きない」ときに false negative と誤解しないための知識。**`Outer HTML` 列で囲みの要素を見てから `img onerror` に切り替える**のが正しい手順。
- **`eval` / `Function` / `execScript` / `jQuery.globalEval`（ランク 1〜4）**: 引数がそのまま JavaScript として評価される。canary がここに現れたら**囲みのクォート／括弧からのブレイクアウトだけが課題**。`FOLLOW_UP_CHARACTERS` のうち `\` `'` `"` の通り方を先に見る。なお**公式は「`eval()` を instrument するとその挙動が変わって関連機能が壊れることがある」と明記**しており、壊れる場合は歯車から `eval` の instrument を切る。
- **`setTimeout` / `setInterval` / `setImmediate` / `msSetImmediate`（ランク 5〜7）**: 第 1 引数が**文字列**で渡された場合に JS 実行 sink になる。関数参照なら実行にならないので DOM ビューの Value をよく見る。
- **`script.src`（ランク 8）**: 読み込み元 URL を制御できれば任意スクリプト実行に直結。**ただし CSP の `script-src` に阻まれることがある**ので実行可否は CSP とセットで判断する。〔補足（一般知識）〕
- **`script.text` / `textContent` / `innerText` / `innerHTML`（ランク 9〜12）**: `script` 要素の中身を制御する経路。既に DOM に挿入済みの `script` 要素へ後から書いても実行されない場合がある。〔補足（一般知識）〕
- **`document.write` / `document.writeln`（ランク 15〜16）**: HTML パーサに直接流し込むので `script` タグが有効。ただしページ読込完了後に呼ぶと document を上書きする。〔補足（一般知識）〕
- **`location` 系（ランク 25〜28）＋ `javascriptURL`（31）**: `javascript:` スキームが通れば XSS、通らなければ **DOM ベースのオープンリダイレクト**。**`Redirection prevention` を有効にしないと、遷移で sink 一覧が消える**（公式: 「見つかった source と sink はクリアされ、新しいページのもので置き換わる」）。ただし **`javascript:` へのリダイレクトと `Inject URL` ボタン由来のリダイレクトはブロックされない**。
- **`element.setAttribute()` 系（ランク 33 / 53〜57）**: 属性名まで制御できると `on*` / `formaction` / `href` / `src` に化ける。`element.setAttribute.on*`（ランク 33、ワイルドカード）が抽出版に存在するのは、**個別に列挙していないイベントハンドラ属性もまとめて捕捉するため**。
- **`extensionExcludedSinks` の 11 個**: `button.value`, `webdatabase.executeSql`, `anchor.target`, `element.outerText`, `element.innerText`, `element.textContent`, `element.style.cssText`, `RegExp`, `input.value`, `input.type`, `document.evaluate` は **ランキング表に載っていても拡張では監視されない**。ここに値が届いても DOM ビューには出ない。

---

### 11. false positive / false negative の見分け方（公式裏取り済みに更新）

1. **canary はページ上に自然発生しない文字列にする** — **公式 `settings/canary` の Note（逐語）**: "To avoid false positives, make sure that the string you use doesn't occur naturally on the page."。`test` のような一般語は使わない。変更は `Randomize` か custom string → `Update canary` → `Reload`。
2. **既定では「最も面白い sink だけ」しか instrument されていない** — 公式 `settings/main`: "By default, all sources are hidden and only the most interesting sinks are instrumented."。さらに `extensionExcludedSinks` の 11 個は拡張では常に対象外。**「DOM ビューに出なかった＝その sink に届いていない」ではない。**
3. **`Information` severity のメッセージを「安全」と読まない** — 公式 `web-messages`: "All messages sent on the page are listed with at least an `Information` severity rating, **as they may contain vulnerabilities that DOM Invader can't detect automatically**."
4. **Value 列でコンテキストを実測する** — canary に `FOLLOW_UP_CHARACTERS`（`\ < > ' " :`）を足して、`&quot;` や `&lt;` に変わっていないかを見る。DOM Invader 自身がこの follow-up で severity / confidence を上下させている。
5. **sink が HTML 実行系か JS 実行系かを先に決める** — `jsSinks` / `htmlSinks` / `urlSinks` の 3 分類（本ノート 3-2）に当てる。`innerHTML` 系は `script` 要素が通らないので「`<script>alert(1)</script>` が動かない＝脆弱でない」ではない。`Outer HTML` 列を見て `img onerror` 等に切り替える。
6. **`Frame path` 列でフレームを確認する** — 公式が用意した列。iframe 内の sink を見落とさないため。
7. **`Event` 列と `Auto-fire events` 設定を対で使う** — 「click / mouseover が起きたときだけ sink に届く」ケースがある。`Auto-fire events` を有効にしないと再現しない。
8. **リダイレクトで sink 一覧を失っていないか** — `Redirection prevention` が切れていると遷移で結果が消えて「何も出なかった」と誤認する。原因調査には `Add breakpoint before redirect`（**Chrome 標準 DevTools では不可能**と公式が明記する機能）。
9. **`Permissions-Policy` に殺されていないか** — 同期 XHR など DOM Invader に必須の機能が `Permissions-Policy` でブロックされると正常に動かない。**この場合 DOM Invader はコンソールで通知して `Remove Permissions-Policy header` を促す**ので、コンソールを見る癖をつける。
10. **Stack Trace でコードパスを確認する** — 同じ sink 名でも、テンプレートエンジンの内部処理で偶然 canary が通っただけの場合がある。`Message filtering by stack trace` を使うと、同じコード位置を指すエントリを畳んでノイズを圧縮できる。
11. **prototype pollution の `Verify onload`** — 無効にすると **`constructor` / `__proto__` が読込完了までにサニタイズされるケースで false positive** が出る。逆に `Auto-scale amount of properties per frame` は **例外で同一 iframe 内の残り gadget が飛んで false negative** を生む。
12. **`Inject forms` は手動送信が必要** — 公式: "you still need to submit the form manually for the injection to take effect."。押しただけで結果を待っても何も出ない。
13. **設定を変えたら必ず `Reload`** — 公式が全設定ページで繰り返す。Reload を忘れた状態のテスト結果は無効。

---

### 12. DOM Invader が扱う source / sink の母集団（出典: Sources-And-Sinks-Cheatsheet ＝ PortSwigger の DOM-based 脆弱性レッスンからの抽出、full 取得）

〔注〕この表は DOM Invader の内部リストそのものではなく（それは本ノート 3-2 / 4 節）、**PortSwigger が「DOM ベース脆弱性の source / sink」として公式に列挙しているもの**。DOM ビューに現れる名前を読むための辞書として使える。

#### 定義（PortSwigger 定義の逐語引用、cheatsheet が引用したもの）

> A source is a JavaScript property that accepts data that is potentially attacker-controlled. An example of a source is the location.search property because it reads input from the query string, which is relatively simple for an attacker to control. Ultimately, any property that can be controlled by the attacker is a potential source. This includes the referring URL (exposed by the document.referrer string), the user's cookies (exposed by the document.cookie string), and web messages.

> A sink is a potentially dangerous JavaScript function or DOM object that can cause undesirable effects if attacker-controlled data is passed to it. For example, the eval() function is a sink because it processes the argument that is passed to it as JavaScript. An example of an HTML sink is document.body.innerHTML because it potentially allows an attacker to inject malicious HTML and execute arbitrary JavaScript.

#### 代表的な source（Common Sources）

| # | source |
| --- | --- |
| 1 | `document.URL` |
| 2 | `document.documentURI` |
| 3 | `document.URLUnencoded` |
| 4 | `document.baseURI` |
| 5 | `location` |
| 6 | `document.cookie` |
| 7 | `document.referrer` |
| 8 | `window.name` |
| 9 | `history.pushState` |
| 10 | `history.replaceState` |
| 11 | `localStorage` |
| 12 | `sessionStorage` |
| 13 | `IndexedDB (mozIndexedDB, webkitIndexedDB, msIndexedDB)` |
| 14 | `Database` |

#### DOM XSS sink

| 種別 | sink |
| --- | --- |
| ネイティブ | `document.write()`, `document.writeln()`, `document.domain`, `element.innerHTML`, `element.outerHTML`, `element.insertAdjacentHTML`, `element.onevent` |
| jQuery | `add()`, `after()`, `append()`, `animate()`, `insertAfter()`, `insertBefore()`, `before()`, `html()`, `prepend()`, `replaceAll()`, `replaceWith()`, `wrap()`, `wrapInner()`, `wrapAll()`, `has()`, `constructor()`, `init()`, `index()`, `jQuery.parseHTML()`, `$.parseHTML()` |

#### JavaScript インジェクション sink

`eval()`, `Function()`, `setTimeout()`, `setInterval()`, `setImmediate()`, `execCommand()`, `execScript()`, `msSetImmediate()`, `range.createContextualFragment()`, `crypto.generateCRMFRequest()`

#### オープンリダイレクト sink

`location`, `location.host`, `location.hostname`, `location.href`, `location.pathname`, `location.search`, `location.protocol`, `location.assign()`, `location.replace()`, `open()`, `element.srcdoc`, `XMLHttpRequest.open()`, `XMLHttpRequest.send()`, `jQuery.ajax()`, `$.ajax()`

#### その他の sink（種別別）

| 種別 | sink |
| --- | --- |
| Cookie 操作 | `document.cookie` |
| document.domain 操作 | `document.domain` |
| WebSocket URL 汚染 | `WebSocket` |
| リンク操作 | `element.href`, `element.src`, `element.action` |
| Ajax リクエストヘッダ操作 | `XMLHttpRequest.setRequestHeader()`, `XMLHttpRequest.open()`, `XMLHttpRequest.send()`, `jQuery.globalEval()`, `$.globalEval()` |
| ローカルファイルパス操作 | `FileReader.readAsArrayBuffer()`, `FileReader.readAsBinaryString()`, `FileReader.readAsDataURL()`, `FileReader.readAsText()`, `FileReader.readAsFile()`, `FileReader.root.getFile()` |
| クライアントサイド SQL インジェクション | `executeSql()` |
| HTML5 ストレージ操作 | `sessionStorage.setItem()`, `localStorage.setItem()` |
| XPath インジェクション | `document.evaluate()`, `element.evaluate()` |
| クライアントサイド JSON インジェクション | `JSON.parse()`, `jQuery.parseJSON()`, `$.parseJSON()` |
| DOM データ操作 | `script.src`, `script.text`, `script.textContent`, `script.innerText`, `element.setAttribute()`, `element.search`, `element.text`, `element.textContent`, `element.innerText`, `element.outerText`, `element.value`, `element.name`, `element.target`, `element.method`, `element.type`, `element.backgroundImage`, `element.cssText`, `element.codebase`, `document.title`, `document.implementation.createHTMLDocument()`, `history.pushState()`, `history.replaceState()` |
| DoS | `requestFileSystem()`, `RegExp()` |

---

### 13. HackTricks 由来の運用助言（公式で裏が取れなかった／公式にない実務知）

前工程で HackTricks（full 取得）から採った記述のうち、公式ドキュメントで確認できなかったものを、出典を明示して残す。

- **空の canary（empty canary）で検索する** — 「悪用できなくてもページが持ちうる sink を全部見たいだけなら、空の canary で検索する」。偵察モードとして使える。**公式ドキュメントにこの記述は見つからなかった**ので、教科書に載せるなら「HackTricks が紹介する実務テクニック」として書くこと。ここに出た sink は**制御可能とは限らない**。
- **フレームスコープ** — 「source/sink はブラウジングコンテキスト単位で表示される。iframe 内の脆弱性は手動でフォーカスを当てる必要があるかもしれない」。→ 公式の **`Frame path`** 列がこの問題への公式回答なので、教科書では両方を併記するとよい。
- **重い sink の一時無効化** — 「`eval` や `innerHTML` のような重い sink は、ナビゲーション中にページ機能を壊すなら一時的に無効化する」。→ 公式 `settings/main` の「`eval()` を instrument すると挙動が変わる」と整合。
- **Canary 設定は Burp 2024.12 で導入**（HackTricks の記述）。公式ドキュメントにはバージョン情報が書かれていないため、**この年次は HackTricks 由来**として扱う。

---

### 14. AutoVader — DOM Invader の自動運転（出典: PortSwigger/autovader README ／full 取得、作者 Gareth Heyes）

DOM Invader は本来「手で canary を入れて DevTools を見る」ツールだが、公式に**自動化ラッパ**が存在する。教科書では「DOM Invader を流し込み式に回す方法」として紹介できる。

- **AutoVader** は **DOM Invader と Playwright Java を統合**して DOM ベース脆弱性を自動発見する Burp 拡張。**BApp Store で "AutoVader" を検索 → install**。要件は **Burp Suite Professional（DOM Invader に必要）** と **DOM Invader 拡張（Burp インストールから自動検出）**。
- Target / Proxy history / Repeater のリクエストを右クリックしてコンテキストメニューから実行。スキャン種別（README 逐語の見出し）:
  - **Open DOM Invader** — 手動テスト用に DOM Invader 設定済みブラウザを開く
  - **Scan all GET params** — 全クエリパラメータを列挙し canary を注入
  - **Scan all GET params for gadgets** — 設定で定義した HTML タグ・属性に canary を注入し、URL 由来の DOM gadget を検出
  - **Scan all POST params** — 全 POST パラメータに canary を注入
  - **Scan web messages** — postMessage の脆弱性をテスト、**origin を偽装**してメッセージ注入を試み、安全でないハンドラを特定
  - **Inject into all sources** — 識別されたすべての source に体系的に payload を注入
  - **Inject into all sources & click everything** — 上記に加えて **click イベントも発火**（イベントハンドラ内の脆弱性向け）
  - **Scan for client side prototype pollution** — クエリ文字列・hash・JSON 入力をテストし、自動チェックで汚染を検証
  - **Scan for client side prototype pollution gadgets** — 悪用可能な gadget（危険なプロパティ代入）を発見
  - **Intercept client side redirect** — クライアントサイドリダイレクトにブレークポイントを設定し、オープンリダイレクトを特定
- **設定項目（プロジェクト単位）**: **Path to DOM Invader** / **Path to Burp Chromium**（自動検出失敗時の上書き）、**Payload**（canary に付加するカスタム payload）、**HTML tags to scan** / **Attributes to scan**（gadget 用）、**Delay**（リクエスト間隔）、**Always open devtools**、**Remove CSP**（DOM Invader が正しく機能するよう CSP ヘッダを除去。**既定で有効**）、**Headless**、**Auto run from Repeater / Intruder / other extensions**（リクエストに `$canary` プレースホルダが必要）。
- **How It Works（README 逐語の要旨）**: 1) Playwright で DOM Invader 拡張入りのヘッドレス Chromium を起動 → 2) スキャン種別に応じて DOM Invader 設定を自動構成 → 3) payload 付き URL へ遷移 → 4) DOM Invader の検出をコールバックで捕捉して **Burp の issue として報告** → 5) issue は重複排除される。
- 特徴: **プロジェクト固有の canary**（Burp プロジェクトごとに一意な識別子）、Burp Montoya API 連携。

→ **AutoVader のスキャン種別は、DOM Invader の手動機能とほぼ 1 対 1 で対応している**（`Inject into all sources` ↔ `Inject canary into all sources` 設定、`& click everything` ↔ `Auto-fire events` 設定、`Remove CSP` ↔ prototype pollution 設定の `Remove CSP header`、`Intercept client side redirect` ↔ `Add breakpoint before redirect`）。教科書ではこの対応表を作ると、手動／自動の両方の理解が一気に進む。

---

### 15. 実際の発見例

- **【一次情報】PortSwigger 自身による PayPal の DOM XSS** — 原典ブログ "Eating our own dog food" 節で、作者 Gareth Heyes が「**DOM Invader の機能をテストしている最中に、著名なバグバウンティプログラムで金脈を掘り当てた**」「**私が見つけた PayPal の DOM XSS について research channel で読んでほしい**」と明言している。**ツール開発者自身がそのツールで実バウンティ案件を発見した**という事実は、教科書の導入として強い。ただし PayPal 案件の詳細記事本体は本セッションでは未取得（下記「読者が自分で開くべき資料」参照）。
- **【演習導線】Web Security Academy ラボ** — ブログ冒頭に「DOM Invader を使って Academy のラボを解く YouTube 動画」へのリンクがある。定番は **"Lab: DOM XSS in innerHTML sink using source location.search"**（https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-innerhtml-sink）。このラボの脆弱コードは実際には次の形で、**`URLSearchParams`（DOM Invader の source list に後から追加された項目）を使っている**点が教科書的に面白い（出典: leuras/portswigger-academy writeup、full 取得）:

```javascript
function doSearchQuery(query) {
    document.getElementById('searchMessage').innerHTML = query;   // sink
}
var query = (new URLSearchParams(window.location.search)).get('search');  // source
if (query) {
    doSearchQuery(query);
}
```

  → `innerHTML` sink（ランク 21、`htmlSinks`）＋ `URLSearchParams` source。`<script>` は効かないので `<img src=1 onerror=alert(document.domain)>` を使う。**DOM Invader で canary を search パラメータに入れると、DOM ビューに `element.innerHTML` が現れ、`Outer HTML` 列に囲みの `div` が見える**、というのが教科書に書くべき流れ。
- **【二次情報】バグバウンティでの実例** — 2023 年の報告記事 "$500 Bounty by Escalating DOM XSS to Stored XSS" では、**対象アプリのメイン検索フィールドに DOM Invader の canary を入れたところ DOM Invader が赤くなり**（"whenever it turns red, I investigate"）、sink を特定してから**単純な payload を順に試してどの文字がエンコードされるかを確認**し、最終的に悪用可能な XSS に到達して報奨金を得た、という流れが記録されている（**間接: WebSearch 経由の要約。原典 URL は https://medium.com/@rodriguezjorgex/escalating-dom-xss-to-stored-xss-eb6f3a669af3 ／medium.com は本セッションでもブロックされたままで未検証**）。
  - **教訓**: ①「canary を入れる場所」として**検索フォームは最優先**、② DOM Invader の**色/件数の変化を合図にする**、③ sink が分かってから**文字単位のエンコード実験**に移る（＝公式の `FOLLOW_UP_CHARACTERS` と同じ発想）、④ DOM XSS は保存経路に乗ると **stored XSS に昇格**しうる。
- 〔補足（一般知識）〕DOM XSS の実務では「canary が sink に届いた」段階で報告せず、**必ず `alert()` 等の実行 PoC まで作る**のが通例。web message の `Build PoC` と prototype pollution の `Exploit` ボタンはこの最終段を短縮するために用意されている。**DOM XSS 単体にはこのボタンがないので、自分で payload を組む必要がある**。

---

## 前工程（confidence=medium）からの主な訂正・追加の一覧

教科書執筆者が差分だけ確認できるようまとめる。

| # | 前工程の記述 | 補完後の事実 | 根拠 |
| --- | --- | --- | --- |
| 1 | `sinkRanking` は 25 まで＋51 付近の断片のみ、26 以降は復元不能 | **1〜86 の完全版を収録**。独立 2 ソースで一致確認 | 原典ブログ本文／中国語翻訳の逐語転載／抽出スクリプト |
| 2 | canary 既定値が `burpdomxss` という説あり（出典不明確） | **既定はランダム生成文字列**。`burpdomxss` は原典に一切現れない。教科書に書かないこと | ブログ "uses a random canary"／公式 "the randomly generated default canary" |
| 3 | DOM XSS 手順の最後に「`Exploit` ボタンで確定」 | **`dom-xss` ページに `Exploit` は存在しない**。`Exploit` は prototype pollution 専用、web message は `Build PoC` | 公式 `dom-xss` 全文 |
| 4 | `innerHTML` の `script` 不可の注意書きは DOM Invader 公式ドキュメント由来 | **Web Security Academy のラボ説明が出典**。DOM Invader ドキュメントには無い | 公式 `dom-xss` 全文／ラボ writeup |
| 5 | 「sink をクリックするとスタックトレースからジャンプできる」 | **`Stack Trace` 列のリンク → Console タブ → 一番上のリンク → Sources タブ**の 4 手 | 公式 `dom-xss` |
| 6 | （記述なし） | **`Outer HTML` / `Frame path` / `Event` の 3 列**が sink 種別に応じて表示される | 公式 `dom-xss` |
| 7 | （記述なし） | **`Auto-fire events` 設定**（click / mouseover を全要素に自動発火） | 公式 `settings/misc` |
| 8 | （記述なし） | **`Configuring callbacks`**（source/sink/message 検出時のカスタムコールバック、`debugger` 文で停止、コンソールへのエクスポート） | 公式 `settings/misc` |
| 9 | （記述なし） | **`Remove Permissions-Policy header`**（同期 XHR 等をブロックする `Permissions-Policy` の除去） | 公式 `settings/misc` |
| 10 | （記述なし） | **`FOLLOW_UP_CHARACTERS = "\\<>'\":"`**（DOM Invader が自動で足す 6 文字）と、**severity / confidence の格上げロジック** | 抽出スクリプト／原典ブログ |
| 11 | （記述なし） | **sink の 3 分類 `jsSinks` / `htmlSinks` / `urlSinks`**、**`extensionExcludedSinks` の 11 個は拡張では非監視** | 抽出スクリプト／公式 `settings/main` |
| 12 | `Inject forms` はフォームに自動注入する | **注入後、フォームは手動で送信しないと効果が出ない**。また公式は「1 回に 1 source」を推奨 | 公式 `dom-xss` |
| 13 | web message の origin 偽装の詳細不明 | **「本物のドメイン名で始まり、かつ終わる偽 origin」に置換**し、`startsWith()` / `endsWith()` 検証を暴く | 公式 `settings/web-messages` |
| 14 | （記述なし） | **全メッセージが最低 `Information` severity で出る**＝「自動検出できない脆弱性があるかもしれない」という公式の含意 | 公式 `web-messages` |
| 15 | （記述なし） | **`Detect cross-domain leaks`**（URL 由来データの別 origin 送信＝OAuth トークン窃取につながる） | 公式 `settings/web-messages` |
| 16 | prototype pollution の手法数不明 | **4 手法**（`constructor[prototype][property]` / `constructor.prototype.property` / `__proto__.property` / `__proto__[property]`）、hash 経由と search 経由で識別子が分かれる | 抽出スクリプト／公式 `settings/prototype-pollution` |
| 17 | （記述なし） | **`sourcesList` に `URLSearchParams` が追加**されている（ブログ版 11 個 → 抽出版 12 個） | 抽出スクリプト |
| 18 | 発見例は Medium の $500 事例（二次・未検証）のみ | **作者本人が DOM Invader で PayPal の DOM XSS を発見**（一次情報） | 原典ブログ "Eating our own dog food" |
| 19 | （記述なし） | **系譜**: Cure53 の Filedescriptor の類似ツール → James Kettle の発案 → Gareth Heyes の実装 | 原典ブログ "Team effort" |
| 20 | タブ名の版差が検証できていない | **2021 年版は `Augmented DOM` タブ／現行版は `DOM Invader` タブ内の `DOM` ビュー**。公式日本語訳は「DOM ビュー」 | 原典ブログ／公式 `dom-xss`（英・日） |

---

## 読者が自分で開くべき資料

> **【補完工程での更新】** 担当 URL 2 本は**本文全文を取得できたため、もはや「未取得資料」ではない**。以下に残すのは、**本文以外の要素（画像・動画）と、本文から参照されている別資料**である。

### A. https://portswigger.net/blog/introducing-dom-invader （Gareth Heyes, 2021-06-30 16:47 UTC）— 本文は取得済み

**それでも読者が開くべき理由**:

1. **スクリーンショット 4 枚** — 本文取得では画像が得られていない。特に「Augmented DOM のツリービュー」「sink が面白い順に並んだ一覧」「canary が自動ハイライトされた様子」は**UI の見た目を掴むために必須**。本ノートの記述と突き合わせて、どの列が `Value` でどこが `Stack Trace` かを目で確認すること。
2. **冒頭の YouTube 動画**（"Introducing DOM invader" / Academy ラボを DOM Invader で解くデモ） — 操作の流れ（canary をコピー → URL に貼る → タブを見る）を 1 回見ておくと、以降の手順書の理解が段違いに速い。本セッションでは動画は取得不能。
3. **"research channel" へのリンク（PayPal DOM XSS の詳細）** — 本ノートでは「PayPal の DOM XSS を見つけた」という事実までしか取れていない。**実際の攻撃経路・sink・payload は元記事側にある**ので、実例を教材にしたいなら必読。
4. **リリースノートへのリンク**（2021.7 / Early Adopter チャネル）。

### B. https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss — 本文は取得済み（英語・日本語とも）

**それでも読者が開くべき理由**:

1. **3 枚のスクリーンショット** — `dom-invader-innerHTML-sink.png`（DOM ビューに `innerHTML` sink が出た状態）、`dom-invader-unescaped-chars.png`（**特殊文字が生のまま sink に届いている様子**＝本章で最重要の画面）、`dom-invader-payload.png`（`<span>` とダブルクォートをブレイクアウトした状態）。**「エスケープされているか」を目で判断する感覚は画像でしか伝わらない**。
2. **最新版との差分確認** — 本ノートの取得元は Burp 同梱ドキュメントのミラーであり、**ミラーが作られた時点のバージョン**を反映している。現行 Burp で UI 名称や設定項目が増減していないか、実機と突き合わせること。
3. **日本語版 UI との対応** — PortSwigger は公式日本語ドキュメントを出している。`Copy canary` / `Inject URL params` / `Inject forms` / `Outer HTML` / `Frame path` / `Event` / `Stack Trace` といった**ボタン・列名は日本語版でも英語のまま**であることが確認できた。教科書もこれに倣うのが安全。

### C. 本文未取得で、読者が開くべき関連資料

- **https://portswigger.net/web-security/dom-based** — source / sink の公式一覧（本ノート 12 節の一次出典）。本セッションでは cheatsheet 経由の抽出しか得ていないので、**原典で最新の一覧を確認**すること。
- **https://portswigger.net/web-security/cross-site-scripting/dom-based** — DOM XSS ラボ群。**DOM Invader の練習台**。特に `lab-innerhtml-sink`。
- **https://portswigger.net/web-security/dom-based/controlling-the-web-message-source** — 公式 `web-messages` ページが「web message の DOM XSS を復習するならここ」と案内している Academy トピック。
- **https://portswigger.net/web-security/dom-based/origin-validation** 系（"Bypassing flawed origin validation"） — 公式 `web-messages` が `Origin accessed` の節から直接リンクしている。**`startsWith()` / `endsWith()` 検証のバイパス**を学ぶため。
- **https://portswigger.net/web-security/dom-based/dom-clobbering** — DOM clobbering の Academy トピック（公式 `dom-clobbering` ページからの導線）。
- **https://portswigger.net/burp/releases/professional-community-2021-7** — DOM Invader 初出のリリースノート。
- **PortSwigger XSS cheat sheet** — ブログ本文に「この source/sink 一覧は cheat sheet 更新時に取り込む予定」と書かれている。**更新後の cheat sheet に最新のランキングが載っている可能性がある**ので、86 項目の表が古くなっていないか確認する価値がある。

### D. 本セッションで実際に全文取得できた資料（再現可能・GitHub 経由）

原典 2 本を含め、以下はすべて `curl` で再取得できる。

- 原典A（ブログ全文）: `https://raw.githubusercontent.com/bosterptr/nthwse/HEAD/scraper/raw/2206.html`
- 原典B（公式ドキュメント英語）: `https://raw.githubusercontent.com/1tbfree/BurpSuitePro-SourceLeak/HEAD/resources/Documentation/burp/documentation/desktop/tools/dom-invader/{index,enabling,dom-xss,web-messages,prototype-pollution,dom-clobbering}.html` および `.../dom-invader/settings/{index,main,attack-types,web-messages,prototype-pollution,misc,canary}.html`
- 原典B（公式ドキュメント日本語）: `https://raw.githubusercontent.com/ankokuty/burp-resources-ja/HEAD/Documentation/burp/documentation/desktop/tools/dom-invader/...`（同じパス構造）
- 原典A の中国語翻訳（sinkRanking 逐語転載）: `https://raw.githubusercontent.com/izj007/wechat/HEAD/articles/[未分類]-2021-8-21-DOM Invader_ 让DOM XSS的发现变得更加容易 · Chen's Blog.md`
- DOM Invader 内部定数の抽出（非公式）: `https://raw.githubusercontent.com/wrench1997/Jackdaw/HEAD/domxss/dom_xss_zx.js`
- HackTricks 現行版: `https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/dom-invader.md`
- HackTricks 旧版: `https://raw.githubusercontent.com/temphylic/hackxyz/master/pentesting-web/xss-cross-site-scripting/dom-invader.md`
- source/sink cheatsheet: `https://raw.githubusercontent.com/Sivnerof/Sources-And-Sinks-Cheatsheet/HEAD/README.md`
- AutoVader README: `https://raw.githubusercontent.com/PortSwigger/autovader/HEAD/README.md`
- Academy innerHTML ラボ writeup: `https://raw.githubusercontent.com/leuras/portswigger-academy/HEAD/xss/dom-based/innerhtml-sink/README.md`

ローカル保存先: `/tmp/claude-0/-home-user-Bug-bounty-/32de2d37-9918-5d2d-9855-7e3b08d1c1c2/scratchpad/dom34/`（抽出済みテキスト `blog_text.txt` を含む）

---

## 信頼度と注意（教科書執筆者への申し送り）

- **担当 URL 2 本とも本文全文を一次情報として取得済み。** 前工程の「一次情報は 1 文字も直接取得できていない」という申し送りは**撤回する**。本ノートの `>` 引用ブロックのうち英語のものは、**原典の逐語引用として教科書に引用符付きで載せてよい**。
- **ただし取得経路はミラーである。** `portswigger.net` に直接到達したわけではなく、①ブログを丸ごとスクレイプした第三者リポジトリ、②Burp 製品に同梱されたオフライン版ドキュメントのリポジトリ、から取得している。**内容の同一性は、タイトル一致・URL パス構造の一致・独立 2 ソース間での逐語一致（sinkRanking）によって確認した**が、`portswigger.net` の**現行版と完全に一致している保証はない**。特に **UI 名称と設定項目は版差が出やすい**ので、教科書に「現行版ではこう表示される」と断定する前に実機か原典で確認すること。
- **`sinkRanking`（1〜86）は完全版。** 原典ブログ本文と中国語翻訳の逐語転載が 1 文字違わず一致し、さらに抽出スクリプトともランク番号が一致した。**抽出スクリプト版にのみ存在する 3 項目（`element.setAttribute.on*:33`, `fetch.url:36`, `fetch.header:36`）は後のバージョンでの追加**と考えられるので、付録に載せるなら注記する。
- **`dom_xss_zx.js` は非公式抽出物**（対応バージョン不明、リポジトリ作者の自作コードが後半に混在）。ここからしか取れていない情報（`FOLLOW_UP_CHARACTERS`、3 分類、`extensionExcludedSinks`、prototype pollution の 4 手法）は、**「非公式に抽出された内部定数」と明記**して載せること。ただしいずれも公式ドキュメントの記述と論理的に整合しており（例: `FOLLOW_UP_CHARACTERS` ↔ 「特殊文字を canary に足す」、`mouseEvents` ↔ `Auto-fire events`）、信憑性は高いと判断している。
- **画像と動画は未取得。** UI の見た目と操作の流れだけは読者が原典を開く必要がある（上記 A-1, A-2, B-1）。
- **PayPal DOM XSS の詳細記事は未取得。** 「作者が DOM Invader で PayPal の DOM XSS を見つけた」という事実は原典で確認済みだが、**攻撃経路の詳細は別記事にあり本セッションでは到達できていない**。
- **Medium の $500 事例は依然として未検証**（medium.com がブロック中）。教科書に載せるなら「二次情報・未検証」と明記するか、削るのが安全。
- 分量: 前工程で懸念されていた「原典不到達ゆえの情報不足」は解消した。**原典 2 本ぶんの一次情報＋公式ドキュメント 13 ページ＋内部定数で、ch06 の DOM Invader 節を単独で書き切れる密度がある。**
</content>
</invoke>
