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
