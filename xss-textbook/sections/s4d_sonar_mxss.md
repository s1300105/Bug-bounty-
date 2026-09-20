## mXSS解説とチートシート（Sonar）

このセクションでは、セキュリティ企業 Sonar（旧 SonarSource）が公開した2つの資料 ―― 解説記事「mXSS: The Vulnerability Hiding in Your Code」と、GitHub 上の「SonarSource/mxss-cheatsheet（mXSS チートシート）」―― を軸に、**mXSS（Mutation XSS、変異型クロスサイトスクリプティング）** を体系的に学びます。反射型XSSのような「入力した文字列がそのまま実行される」タイプとは違い、mXSSは「サニタイズ（入力に含まれる危険な文字列を無害な形に変換・除去する処理）を通過した"安全に見える"文字列が、ブラウザによって再解釈される瞬間に危険なコードへ"変異（mutation）"する」という、より一段深い現象を扱います。ここが本セクション最大の学びどころです。

> ⚙️ **本セクションの資料取得に関する注記（透明性のため明記）**: 担当した2つの一次資料URL（`sonarsource.com` のブログ記事、および `github.com/SonarSource/mxss-cheatsheet`）は、いずれも本実行環境の**ネットワーク送出プロキシによる遮断**（sonarsource.com / sonarsource.github.io は egress ブロック、GitHub は当セッションのリポジトリ許可ポリシー外のためAPI・raw ともに 403/404）により、**直接取得できませんでした**。そのため本文は、Web検索で得られた各記事のスニペット・二次言及、および同一トピックを扱う権威ある二次資料（Michał Bentkowski / Securitum、Daniel Santos、cure53 DOMPurify Wiki、mXSS 原論文など）と執筆者の専門知識を統合して**復元・再構成**しています。厳密な原文照合が必要な場合は、末尾の各URLをご自身でご確認ください。該当箇所には規定の警告ブロックを挿入してあります。

---

### mXSS（Mutation XSS）とは何か ―― 核心の一文

mXSS の核心は次の一文に集約されます。

> **サニタイザ（無害化処理）の目には「ただのテキスト（raw text）」として映る文字列を、ブラウザに渡した瞬間に「HTMLタグ」として解釈させる方法を見つけること。**

- **通常のXSS**: 攻撃者の `<script>` や `onerror=` が、フィルタの不備を"すり抜けて"そのまま出力される。
- **mXSS**: 攻撃文字列はサニタイズの段階では**確かに無害**である（サニタイザは正しく仕事をしている）。ところがその「無害化済みHTML文字列」を**ブラウザが描画のために再びパース（構文解析）し直す**とき、HTMLパーサの"癖"によって文字列の構造が組み替えられ（＝mutation／変異）、結果として `<img onerror=...>` のような実行可能な要素が出現してしまう。

つまり mXSS は「フィルタのバグ」ではなく、**"サニタイザが見たDOMツリー" と "ブラウザが最終的に構築したDOMツリー" が食い違う** という、パーサ（構文解析器）の仕様レベルの落とし穴を突きます。ここでいう **DOM（Document Object Model、HTMLをブラウザがツリー構造として保持したもの）** が、同じ入力文字列から2回作られるのに一致しない、という点が本質です。

#### 歴史的経緯（なぜ「mutation」と呼ぶのか）

- **2007年**: Yosuke Hasegawa（長谷川陽介）氏が、Internet Explorer で `innerHTML`（要素の中身をHTML文字列として読み書きするプロパティ）を読み戻すと文字列が"勝手に書き換わる"挙動を最初に報告。これが mXSS の原点とされます。
- **2013年**: Mario Heiderich らの論文 *"mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations"*（ACM CCS 2013）が、この現象を体系化し **mXSS** と名付けました。論文は、当時広く使われていたサーバサイドのサニタイザ（HTML Purifier, kses, htmlLawed, Google Caja 等）、クライアント側フィルタ（旧 IE XSS Filter、Chrome XSS Auditor）、WAF、IDS/IPS のいずれもが mXSS ベクタで回避されうることを示し、大きな衝撃を与えました。

> 出典: mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations（Heiderich et al., ACM CCS 2013） — https://cure53.de/fp170.pdf
> 出典: mXSS（The Spanner, Gareth Heyes, 2014） — https://thespanner.co.uk/2014/05/06/mxss

---

### なぜ mutation が起きるのか ―― パーサ差分（parser differential）

Sonar の記事が繰り返し強調する mXSS の根本原因は **パーサ差分（parser differential / parser discrepancy）** です。これは「**同じHTML文字列を、別々のパーサに食わせると、違うDOMツリーが出来上がる**」現象を指します（parser differential ＝ パーサ同士の解釈のズレ）。

mXSS が成立する典型的な処理フローは次の通りです。

1. **サニタイズ段階**: アプリが受け取ったHTMLを、サニタイザ（例: サーバ側のライブラリ）のパーサでツリー化 → 危険な要素・属性を除去 → **文字列にシリアライズ（DOMツリーを再びHTML文字列に書き戻すこと）** して保存・送信する。
2. **描画段階**: そのHTML文字列を、ブラウザのパーサが**もう一度パース**してDOMを構築し、画面に表示する。

ここで鍵になるのが、**「シリアライズ → 再パース」というラウンドトリップが冪等（べきとう＝何回やっても同じ結果になる性質）ではない**という事実です。cure53 の DOMPurify Wiki は mXSS をずばり次のように定義しています。

> serialize（文字列化）してから parse（解析）し直しても、必ずしも元のDOMツリーには戻らない ―― この非対称性こそが mXSS の温床である。

Sonar 記事の重要な主張は、この差分の"避けられなさ"に関するものです。

- HTMLのパースは極めて複雑で、しかも配信先のパーサは1つではない（Firefox / Chrome / Safari …とエンジンごとに微妙に挙動が違う）。
- したがって **「HTMLを解析する場所」と「最終的に描画する場所」が異なる限り、パーサ差分を完全に無くすことは原理的に不可能**である。
- ゆえに **サーバサイドのサニタイザは構造的に mXSS に弱く**、**描画するのと同じブラウザ上で無害化するクライアントサイド・サニタイザ（DOMPurify など）** の方が、差分を最小化できるぶん安全性が高い。

これが Sonar の防御指針の理論的な背骨になっています（後述の「防御策」で具体化します）。

> 出典: mXSS: The Vulnerability Hiding in Your Code（Sonar） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/
> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

---

### ブラウザ HTMLパーサの再解釈メカニズム（原理編）

mXSS を"暗記"ではなく"理解"するには、**なぜ再パースで構造が変わるのか**をパーサの仕組みで押さえる必要があります。これが本教科書の価値の中心です。以下、mXSS を生む主要な5つのメカニズムを分解します。

#### 1. 名前空間（namespace）の切り替え ―― HTML / SVG / MathML

HTMLパーサは、DOMツリーの各要素に **名前空間（namespace）** という属性を割り当てます（namespace ＝ その要素がどの言語のルールで解釈されるかを示す"文法モード"）。名前空間は3種類あります。

- **HTML 名前空間**（既定）
- **SVG 名前空間**
- **MathML 名前空間**

既定では全要素が HTML 名前空間に置かれますが、パーサが `<svg>` に出会うと **SVG 名前空間へ切り替わり**、`<math>` に出会うと **MathML 名前空間へ切り替わります**。そして SVG と MathML の中身は **foreign content（外来コンテンツ＝HTML以外の文法で解釈される領域）** として扱われ、**通常のHTMLとは異なるパースルールが適用されます**。

この差が最もはっきり出るのが `<style>` 要素の扱いです。

| 文脈 | `<style>` の中身の扱い | 子要素を持てるか | HTMLエンティティのデコード |
|---|---|---|---|
| **HTML 名前空間** | raw text（テキストのみ。CSSとしてのみ扱う） | 持てない | されない |
| **foreign content（SVG/MathML内）** | 通常のHTMLとして解釈しうる | **子要素を持てる** | **デコードされる** |

攻撃者はこの差を突きます。**サニタイザが `<style>` の中身を「ただのテキスト」だと信じて素通しした要素が、名前空間が切り替わった再パース時に「本物のHTML要素（＝`<img onerror>` など）」として蘇る** ―― これが名前空間混同（namespace confusion）型 mXSS の骨格です。

> 出典: Mutation XSS via namespace confusion – DOMPurify +2.0.17 bypass（Michał Bentkowski / Securitum） — https://www.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass.html

#### 2. インテグレーションポイント（integration points）と mglyph / malignmark の罠

名前空間はどこでも自由に切り替わるわけではなく、**インテグレーションポイント（integration point、＝外来コンテンツの中に"HTMLの島"を作れる境界要素）** という特別な要素で HTML に戻れます。HTML標準（WHATWG）が定めるものは主に次の通りです。

- **MathML text integration points（MathMLテキスト統合点）**: `<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>` ―― これらの直下に置かれた要素は HTML 名前空間で解釈される。
- **HTML integration points（HTML統合点）**:
  - `<annotation-xml>` で **`encoding` 属性が `text/html` または `application/xhtml+xml`** の場合。
  - SVG の `<foreignObject>`、`<desc>`、`<title>`。

さらに厄介なのが **`<mglyph>` と `<malignmark>`** です。この2つは、**MathMLテキスト統合点の直下にあるときだけ MathML 名前空間に属する**（他の要素は既定でHTML名前空間になるのに対して例外的な挙動）。攻撃者は「HTML島の中にあるはずなのに、この2要素だけは MathML 側に引き戻される」というこの非対称性を使って、サニタイザの名前空間判定を欺きます。

`<annotation-xml>` の `encoding` の値ひとつで「中身をHTMLとして解釈するか、XML風の外来コンテンツとして解釈するか」が切り替わる点も、サニタイザと実ブラウザで判定がズレやすい古典的な mXSS ポイントです。

> 出典: `<annotation-xml> - MathML`（MDN） — https://developer.mozilla.org/en-US/docs/Web/MathML/Element/annotation-xml
> 出典: mXSS cheatsheet — Explained（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/explained/

#### 3. raw text 要素 / RCDATA 要素と「scripting フラグ」

HTMLには、中身をタグとして解釈せず**テキストとして丸ごと読み込む特別な要素**があります。挙動により2種類に分かれます。

- **raw text 要素**: `<style>`, `<script>`, `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`（中身はテキスト。HTMLエンティティのデコードもされない）
- **RCDATA 要素**: `<textarea>`, `<title>`（中身はテキストだが、HTMLエンティティ `&lt;` などは**デコードされる**）

問題は、これらの「テキストとして扱う範囲」がサニタイザと実ブラウザでズレると、閉じタグの位置がずれ、後続の文字列が"タグの外"に飛び出して実行可能要素になることです。

とりわけ有名なのが **`<noscript>`** の「scripting フラグ依存」挙動です。

- ブラウザの **`DOMParser` API**（文字列からDOMを作る仕組み。サニタイザ内部でよく使われる）で解析すると、**スクリプト無効**とみなされ、`<noscript>` の中身は **raw text（ただのテキスト）** として扱われる。
- ところが、その結果を実ページに挿入すると、実ページでは**スクリプト有効**なので、`<noscript>` の中身が **再びHTMLとして解釈・実行される**。

この「解析時はスクリプト無効／描画時はスクリプト有効」という文脈差が、`<noscript>` 系 mXSS（Firefox の CVE-2021-23974 が代表例）を生みます。同様に、`<template>` 要素もスクリプト有効/無効で中身のパースが変わる"パース非対称性の地雷"であり、特にサーバサイドでは避けるべき要素です。

> 出典: 1528997 - (CVE-2021-23974) mXSS: Potential XSS via noscript tags parsed by DOMParser APIs（Bugzilla@Mozilla） — https://bugzilla.mozilla.org/show_bug.cgi?id=1528997

#### 4. foster parenting（テーブルの"里子出し"）

`<table>` 系の要素は、HTMLパースの中でも特に癖の強い**独自のパース状態**を持ちます。テーブルの中に置いてはいけない要素（例: `<a>` や `<div>`）が現れると、パーサはそれを**テーブルの直前へ勝手に移動**させます。この現象を **foster parenting（里子出し）** と呼びます。

```
入力:  <table><a>x</table>
再構築後: <a>x</a><table></table>   ← <a> がテーブルの外へ"追い出される"
```

攻撃者は、サニタイズ時には「テーブルの中の無害な位置」にあった要素を、再パース時の里子出しによって**別の文脈（例えば `<style>` の外）へ移動させ**、実行可能な位置に運びます。`<table>` を `<mglyph>` や `<svg>` と組み合わせると、**2回目の再パースを経ても変異が持続する**強力なペイロードが作れることが知られています。

> 出典: mXSS cheatsheet（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/

#### 5. HTMLエンティティのデコード差分 と 属性の再解釈

- **エンティティ・デコード差分**: 前述の通り、同じ `<style>` でも名前空間により `&lt;` を `<` に戻すかどうかが変わります。RCDATA 要素（`<textarea>`, `<title>`）でもデコードが起きます。「サニタイザは `&lt;img ...&gt;`（無害なテキスト）と見なしたが、再パースの文脈ではデコードされて `<img ...>`（本物のタグ）になった」という典型パターンを生みます。
- **属性の再解釈（backtick 等）**: 歴史的には、Hasegawa 氏が発見した「バッククォート `` ` `` を含む属性」の癖が有名です。IE は `alt=\`\`onerror=alert(1)` のようにバッククォートで囲まれた属性値を再シリアライズする際に引用符を落とし、`onerror` が独立した属性として復活してしまいました。属性値のクォート（引用符）の付け外しがサニタイザと実装でズレると、属性境界が壊れて新たなイベントハンドラ属性が生まれます。

> 出典: mXSS Attacks（Heiderich et al., 2013） — https://cure53.de/fp170.pdf
> 出典: [mXSS] Consider making HTML parsing of `style`, `script`, `xmp` etc consistent between SVG, MathML, HTML（whatwg/html #11397） — https://github.com/whatwg/html/issues/11397

---

### 一次資料①: Sonar「mXSS: The Vulnerability Hiding in Your Code」

> ⚠️ **未取得の資料**: 「mXSS: The Vulnerability Hiding in Your Code（Sonar）」は自動取得できませんでした（理由: `sonarsource.com` が本環境のネットワーク送出プロキシで egress ブロックされているため。WebFetch/curl とも接続不可）。以下のURLからユーザーご自身で直接ご覧ください: https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/

（以下は取得できなかった資料の補足として、Web検索で得た当記事のスニペット・二次言及と一般的な知識に基づく再構成解説です。）

Sonar のこの記事は、mXSS を「あなたのコードに潜む脆弱性」として、実在のバグ事例を交えて解説する啓発記事です。要点は以下の通りです。

#### mXSS の定義（記事の表現）

> mXSS は、HTMLの"寛容さ"（malformed／壊れたマークアップも受け入れて自動修正する性質）を悪用する。ペイロードはサニタイズ中は無害に見えるが、ブラウザが描画のために再パースした瞬間、悪意あるコードへと変異する。

#### mXSS の4つのサブカテゴリへの分類

記事は「mXSS」という総称を、理解のために **4つのサブカテゴリに分割**して整理しています（検索結果から、分類の存在と観点は確認できましたが、4カテゴリの正式名称の一字一句までは一次原文照合ができていません。観点は概ね次の軸に対応します）。

1. **名前空間の混同（namespace confusion）**: SVG/MathML への切り替えと foreign content による `<style>` 等の解釈変化を突くもの（本セクション原理編の①②）。
2. **文脈/コンテキストの移動**: 再パース時に要素が text content・属性値・コメントの"外"へ飛び出して実行可能位置に移るもの（③④⑤）。
3. **raw text / 特殊要素の解釈差**: `<noscript>`・`<template>`・`<textarea>` などスクリプトフラグや文脈でパースが変わる要素を突くもの。
4. **エンティティ・属性の変異**: デコード差分や属性境界の再構成を突くもの。

> ⚠️ 上記4分類の名称は再構成です。正確な区分は原文をご確認ください（URLは上記警告ブロック参照）。

#### 実在事例（記事の核）

記事の説得力は、Sonar 自身が発見した実在の脆弱性に裏打ちされています。

- **Skiff（プライバシー重視Webメール）**: サニタイズ時に `<style>` が **SVGルールで**パースされ、再パース時に **HTMLルールで**パースされる差を突いて、`<img>` 要素をDOMに挿入し `onerror` を発火させる mXSS。Proton Mail の脆弱性で使ったのとよく似たペイロードで、Skiff のサニタイズ処理を回避できた。Webメールは Electron（ChromiumをデスクトップアプリにするフレームワークでNode.js権限を持つ）で動くことも多く、**サニタイザのパーサとレンダラ（Electron）のパーサの差分**が致命傷になりうる。
- **Joplin（ノートアプリ、CVE-2023-33726）**: サニタイズ回避（mXSS を含む攻撃チェーン）が最終的に**任意コマンド実行（RCE）**にまで至った。mXSS が単なる「アラートを出す遊び」ではなく、デスクトップアプリでは OS レベルの侵害に直結しうることを示す事例。

#### 記事の結論・防御の推奨

- **クライアントサイドのサニタイザ（DOMPurify 等）を使うこと。** 描画するのと同じブラウザ上で無害化すればパーサ差分のリスクを避けられる。逆にサーバサイドのサニタイザは、配信先ブラウザの多様さゆえに差分を排除できず**構造的に失敗しやすい**。
- **サニタイズ後にHTMLを再加工・再パースしないこと（desanitization の回避）。** サニタイズ済みの文字列にアプリが後から手を加える（文字列連結・再パース・別ライブラリ通過など）と、無害化が台無しになり注入ベクタが復活しうる。
- 目的は「開発者と研究者が、この問題に自信を持って対処できるように武装させること」だと記事は締めくくっている。

> 出典: mXSS: The Vulnerability Hiding in Your Code（Sonar） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/
> 出典: Code Vulnerabilities Put Skiff Emails at Risk（Sonar） — https://www.sonarsource.com/blog/code-vulnerabilities-put-skiff-emails-at-risk
> 出典（二次言及）: mXSS: The Vulnerability Hiding in Your Code（Security Boulevard 転載） — https://securityboulevard.com/2024/05/mxss-the-vulnerability-hiding-in-your-code/

---

### 一次資料②: SonarSource mXSS チートシート

> ⚠️ **未取得の資料**: 「SonarSource mXSS チートシート（github.com/SonarSource/mxss-cheatsheet）」は自動取得できませんでした（理由: 当セッションの GitHub アクセスは許可リポジトリのみに制限されており、当リポジトリは対象外のため API・raw・blob いずれも 403/404。ミラーの `sonarsource.github.io` も egress ブロック）。以下のURLからユーザーご自身で直接ご覧ください: https://github.com/SonarSource/mxss-cheatsheet （ミラー: https://sonarsource.github.io/mxss-cheatsheet/ ）

（以下は取得できなかった資料の補足として、Web検索で得たリポジトリ説明・各ページのスニペットと一般的な知識に基づく再構成解説です。）

#### チートシートの位置づけと構成

リポジトリ説明文（検索で取得）は次の通りです。

> "This repository is a one-stop shop for diving deep into the fascinating world of mXSS (mutations caused by browser quirks in HTML parsing), providing a curated list of examples that showcase unexpected HTML behaviors."
> （＝ブラウザのHTMLパース時の癖が引き起こす mutation を深掘りするためのワンストップ資料。予期しないHTML挙動の実例を厳選して収録。）

主なファイル/ページ構成:

- **`explained.md`（mXSS Explained）**: 理論編。mXSS の定義と、なぜ mutation が起きるかを分類とともに解説。
- **`examples.md`（Payload examples）**: 実践編。過去にサニタイザ回避に使われた**新規ベクタ/新技法を含むペイロードだけを厳選**して収録（既知の焼き直しは除外）。
- **`tools`**: mXSS を試す/確認するためのツール類（`livedom.lab.xss.academy` のような、入力HTMLがブラウザでどう再解釈されるかを可視化する DOM ビューワなど）。
- GitHub Pages 版（`sonarsource.github.io/mxss-cheatsheet/`）で読みやすく公開。

#### チートシートが採る分類（parser 再解釈の分類）

`explained.md` は mXSS を「パーサの再解釈がどこで起きるか」で整理しています（検索スニペットから復元）。

1. **Parser Discrepancies（パーサの不一致）**: そもそもの根本原因。サニタイザのパースアルゴリズムと、レンダラ（ブラウザ）のパースアルゴリズムのミスマッチ。
2. **Namespace and Context Issues（名前空間と文脈の問題）**: サニタイズ時はある名前空間で安全に見えた要素が、ブラウザの2回目のパースで別の名前空間へ移り、text content・属性値・コメントの"外"へ飛び出して変異する。
3. **Raw Text Elements（raw text 要素）**: `<noscript>` のようにスクリプト有効/無効で解釈が変わる要素。本文の解釈規則が文脈依存で変化する。

このチートシートの発想の中核は、繰り返しになりますが「**サニタイザには raw text（テキスト）として見え、ブラウザには HTML として解釈される文字列を作る**」ことにあります。

> 出典: SonarSource/mxss-cheatsheet（README / explained） — https://github.com/SonarSource/mxss-cheatsheet
> 出典: mXSS Explained（GitHub Pages ミラー） — https://sonarsource.github.io/mxss-cheatsheet/explained/

---

### 代表的なペイロード集（チートシート・二次資料からの再現）

以下は、チートシートおよび権威ある二次資料の検索スニペットから再現した代表的 mXSS ペイロードです。各ペイロードには **「なぜ動くのか」** を必ず添えます。実運用での検証時は、対象ブラウザ・対象サニタイザのバージョンで挙動が変わるため、必ず原典と実機でご確認ください。

#### 例1: 古典 ―― `<listing>` / エンティティ・デコード（IE時代の原点）

```html
<listing>&lt;img src=1 onerror=alert(1)&gt;</listing>
```

- **なぜ動くのか**: 攻撃者は一見「エスケープ済みの安全なテキスト」`&lt;img ...&gt;` を渡している。しかし当時の IE は `<listing>`（古い整形済みテキスト要素）の `innerHTML` を読み戻すときにエンティティを `<`/`>` へデコードしてしまい、返り値が `<img src=1 onerror=alert(1)>` という**本物のタグ**に変異した。文字列を再取得・再挿入するコードがあると、この変異した本物のタグが実行される。mXSS の"原点"となった挙動。

> 出典: mXSS Attacks（Heiderich et al., 2013） — https://cure53.de/fp170.pdf

#### 例2: `<noscript>` × `DOMParser`（scripting フラグ依存）

```html
<noscript><p title="</noscript><img src=x onerror=alert(1)>">
```

- **なぜ動くのか**: サニタイザ内部の `DOMParser` はスクリプト無効とみなすため、`<noscript>` の中身を raw text として扱い、`</noscript>` までを"ただのテキスト"だと判断して素通しする。ところが実ページはスクリプト有効なので、同じ文字列を再パースすると `<noscript>` の中身が**HTMLとして再解釈**され、`<img onerror>` が本物の要素として出現・発火する。Firefox の CVE-2021-23974 が実例。

> 出典: CVE-2021-23974（Bugzilla@Mozilla） — https://bugzilla.mozilla.org/show_bug.cgi?id=1528997

#### 例3: MathML `<mglyph>` + `<style>`（名前空間による style 解釈差）

```html
<math><mtext><table><mglyph><style><img src="x" onerror="alert(1)"></style></mglyph></table></mtext></math>
```

- **なぜ動くのか**: `<mtext>` は MathMLテキスト統合点。`<mglyph>` はその直下にあるとき MathML 名前空間に留まる特殊要素。この文脈での `<style>` は foreign content の style となり、サニタイザ側では「`<style>` の中身は raw text」だと判断して `<img onerror>` を無害なテキスト扱いで残す。ところが `<table>` の foster parenting（里子出し）や名前空間の再解決を経て再パースすると、`<img>` が `<style>` の"外"の HTML 要素として実体化し、`onerror` が発火する。「style の中に隠したタグを、再パースで style の外へ運び出す」典型。

> 出典: mXSS cheatsheet（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/examples/

#### 例4: DOMPurify < 2.0.17 名前空間混同（Michał Bentkowski）

```html
<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">
```

- **なぜ動くのか**: `<form>` の入れ子と MathML/SVG の名前空間切り替えを組み合わせ、DOMPurify のパースと実ブラウザのパースで **`<style>` の閉じ位置と要素の所属名前空間がズレる**ように仕組む。DOMPurify（2.0.17 未満）は `<style>` の中身 `</style><img onerror=alert(1) src>` を raw text として安全と判断するが、シリアライズ→再パースの過程で `</style>` が本物の閉じタグとして効き、続く `<img onerror>` が独立したHTML要素として蘇る。修正では「要素が本当に正しい名前空間にあるか、親要素の名前空間を辿って検証する」対策が導入された（Bentkowski の提案が採用）。

> 出典: Mutation XSS via namespace confusion – DOMPurify +2.0.17 bypass（Michał Bentkowski / Securitum） — https://www.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass.html
> 出典: Jak pomogłem zabezpieczyć DOMPurify（Sekurak, Bentkowski） — https://sekurak.pl/jak-pomoglem-zabezpieczyc-dompurify/

#### 例5: DOMPurify < 2.2.2 「From SVG and back」（Daniel Santos）

```html
<svg></p><textarea><title><style></textarea><img src=x onerror=alert(1)></style></title></svg>
```

- **なぜ動くのか**: `<svg>` で SVG 名前空間に入ると、`<style>` の子孫は（HTML名前空間の同名要素＝homograph と異なり）**通常のHTMLとして描画されうる**。SVG の `<path>` の `id` 属性のような"自由記述の安全なテキスト"に見える箇所へ攻撃コードを潜ませ、SVG から HTML へ"戻る（back）"境界の解釈差で `<img onerror>` を実体化させる。`</p>` や `<textarea>`/`<title>`（RCDATA要素）を挟んでパース状態を意図的にずらしているのがポイント。DOMPurify 2.2.2 で修正。

> 出典: From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass（Daniel Santos / vovohelo） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f

#### 例6: `<foreignObject>` × テーブル × コメント breakout

```html
<svg><a><foreignobject><a><table><a></table><style><!--</style></svg><a id="-><img src onerror=alert(1)>">
```

- **なぜ動くのか**: `<foreignObject>` は HTML統合点なので、その内部でHTML島が作られる。`<table>` の foster parenting、`<style>` の raw text 解釈、HTMLコメント `<!-- -->` の閉じ位置解釈を重ね合わせ、サニタイザには「コメント/スタイル内の無害な文字列」に見えるものを、再パース時に `id="...">` の属性境界を破って `<img onerror>` として外へ出す。**複数のパース癖を"直列"に積み上げて差分を最大化する**、チートシート上級ベクタの典型。

> 出典: mXSS cheatsheet — Payload examples（SonarSource） — https://sonarsource.github.io/mxss-cheatsheet/examples/

---

### DOMPurify バイパスの歴史とバージョン依存（陳腐化への注意）

mXSS ペイロードは**サニタイザのバージョンに強く依存**します。「どのバージョンで何が直ったか」を押さえないと、古い攻撃を最新版に撃って外したり、逆に古い依存を使い続けて被弾したりします。以下は DOMPurify（最も広く使われるクライアントサイド・サニタイザ）の主要な mXSS 関連バイパスと修正の時系列です（公開年・対象バージョンを明記）。

| 時期 | バイパスの種類 | 影響バージョン | 修正バージョン | 備考 |
|---|---|---|---|---|
| 2020 | MathML 名前空間混同（Bentkowski, 例4） | < 2.0.17 | **2.0.17** | 親名前空間の検証を導入 |
| 2020 | SVG 名前空間混同「From SVG and back」（Santos, 例5） | < 2.2.2 | **2.2.2** | SVG→HTML 境界の解釈差 |
| 2020–2021 | 追加の名前空間/mglyph 系（2.2.x で継続的に修正） | 2.2.x 系 | 2.2.3 / 2.2.4 / 2.2.6 ほか | いたちごっこが続いた時期 |
| 2024公開 | **ネスト（入れ子）ベース mXSS**（CVE-2024-47875） | 修正前の全般 | **2.5.0 / 3.1.3** | 深い入れ子で再パース挙動が発散。**最大ネスト深さ ≈500** の上限を 3.1.1 で導入し対策 |
| 2025公開 | **テンプレートリテラル正規表現の不備**（CVE-2025-26791） | < 3.2.4（`SAFE_FOR_TEMPLATES: true` 時） | **3.2.4** | 誤った正規表現で mXSS |
| 2025公開 | **`<textarea>` raw text 検証漏れ**（`SAFE_FOR_XML`、CVE-2025-15599） | 3.1.3–3.2.6 / 2.5.3–2.5.8 | **3.2.7**（3.x 系）。**2.x 系は未修正のまま** | 2.x を使い続けるのは危険 |
| 2026公開 | **プロトタイプ汚染 → カスタム要素処理のフォールバック経由 XSS**（CVE-2026-41238 ほか） | 該当版 | 以降のリリースで対応 | `CUSTOM_ELEMENT_HANDLING` 起点 |

**バージョン依存に関する実務上の教訓（重要）**:

- **常に最新の DOMPurify（本稿執筆時点で 3.4.x 系）へ更新する。** mXSS 修正は"追いつき"の連続であり、古い版に固定するとその後に発見された回避に必ず晒される。
- **2.x 系は一部 CVE（例: CVE-2025-15599）が未修正のまま**。2.x を継続利用しているプロジェクトは 3.x への移行を検討すべき。
- **非デフォルト設定は攻撃面を広げる**。`SAFE_FOR_TEMPLATES`（CVE-2025-26791）や `SAFE_FOR_XML`／`CUSTOM_ELEMENT_HANDLING`（CVE-2025-15599 / CVE-2026-41238）のように、既定から外れたオプションが新たなバイパスの入口になった例が複数ある。**必要のないオプションは有効化しない。**

> 出典: Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
> 出典: CVE-2024-47875（Nesting-based mXSS） — https://osv.dev/vulnerability/CVE-2024-47875
> 出典: CVE-2025-26791（template literal regex mXSS, fixed 3.2.4） — https://security.snyk.io/vuln/SNYK-JS-DOMPURIFY-8722251
> 出典: DOMPurify XSS via Textarea Rawtext Bypass in SAFE_FOR_XML（CVE-2025-15599, fixed 3.2.7） — https://www.vulncheck.com/advisories/dompurify-xss-via-textarea-rawtext-bypass-in-safe-for-xml
> 出典: CVE-2026-41238（Prototype Pollution to XSS via CUSTOM_ELEMENT_HANDLING） — https://github.com/advisories/GHSA-v9jr-rg53-9pgp

---

### 防御策のまとめ

mXSS への対策は「サニタイザを信じきる」ことではなく、「**パーサ差分が生まれないように処理フロー全体を設計する**」ことです。

1. **クライアントサイド・サニタイザ（DOMPurify）を、描画する場所と同じブラウザで使う。** サーバサイドのサニタイズは配信先ブラウザの多様さゆえに差分を排除できず、mXSS に構造的に弱い（Sonar の中心的主張）。どうしてもサーバ側で無害化する場合でも、クライアント側で最終防衛のサニタイズを重ねる。
2. **サニタイズ後にHTMLを一切再加工しない（desanitization の回避）。** サニタイズ済み文字列の連結・再パース・別ライブラリへの再投入は、無害化を無効化しうる。「サニタイズは最終工程」を原則にする。
3. **サニタイザを常に最新へ保つ。** mXSS 修正はバージョンで積み上がる。依存の自動更新（Dependabot / Renovate 等）と、既知 CVE のバージョン確認を運用に組み込む。非デフォルト・オプションは必要最小限に。
4. **多層防御を敷く**:
   - **CSP（Content Security Policy、実行可能なスクリプトの出所をブラウザ側で制限する仕組み）** を設定し、万一 mutation で `<script>`/`onerror` が生まれても実行を止める（`script-src` の厳格化、`'unsafe-inline'` の排除、nonce/hash 方式）。
   - **Trusted Types**（DOM の危険な sink（＝ユーザー入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`）への文字列代入を、検証済みの型でしか許さないブラウザ機構）を導入し、`innerHTML` 直代入を排除する。
5. **危険な要素を避ける設計**: `<template>` や `<noscript>` はスクリプトフラグ依存でパースが変わる"パース非対称性の地雷"。特にサーバサイド処理では扱わない。ユーザーHTMLに SVG/MathML を許可する必要がなければ許可タグから外す。
6. **名前空間を意識した検証**: 自前でサニタイズを実装する場合は「要素がどの名前空間に属するか」を親要素まで辿って確認する（DOMPurify が 2.0.17 で採った対策と同じ発想）。

なお、WHATWG では `<style>`/`<script>`/`<xmp>` 等のパースを SVG・MathML・HTML の間で**一貫させる**提案（whatwg/html #11397）が議論されており、将来的にはブラウザ標準の側から mXSS の温床が減っていく可能性があります。とはいえ現時点では、上記の"差分を作らない設計"が現実的な防御です。

> 出典: mXSS: The Vulnerability Hiding in Your Code（Sonar, 防御指針） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/
> 出典: [mXSS] Consider making HTML parsing consistent between SVG, MathML, HTML（whatwg/html #11397） — https://github.com/whatwg/html/issues/11397

---

### このセクションの要点（まとめ）

- mXSS の核心は **「サニタイザの目には raw text、ブラウザの目には HTML」** となる文字列を作ること。バグではなく**パーサ差分（parser differential）**という仕様レベルの落とし穴を突く。
- 変異を生む主因は **名前空間切り替え（HTML/SVG/MathML）・インテグレーションポイント・raw text/scripting フラグ・foster parenting・エンティティ/属性の再解釈** の5つ。
- Sonar は実在事例（Skiff, Proton Mail, Joplin=RCE）で mXSS の実害を示し、**クライアントサイド・サニタイズ＋サニタイズ後に再加工しない**ことを推奨する。
- SonarSource mXSS チートシートは **parser 再解釈の分類（Parser Discrepancies / Namespace & Context / Raw Text Elements）** に沿って、新規ベクタを厳選収録した実務資料。
- ペイロードは**サニタイザのバージョンに強く依存**する。DOMPurify は 2.0.17 → 2.2.2 →（CVE-2024-47875）2.5.0/3.1.3 →（CVE-2025-26791）3.2.4 →（CVE-2025-15599）3.2.7 …と修正を重ねており、**常に最新版**を使うことが最重要。

---

### 出典一覧

**担当した一次資料（いずれも直接取得は環境制約で不可。上記各所に警告ブロックを明記）**

- mXSS: The Vulnerability Hiding in Your Code（Sonar） — https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/
- SonarSource / mxss-cheatsheet（GitHub） — https://github.com/SonarSource/mxss-cheatsheet （ミラー: https://sonarsource.github.io/mxss-cheatsheet/ ／ explained: https://sonarsource.github.io/mxss-cheatsheet/explained/ ／ examples: https://sonarsource.github.io/mxss-cheatsheet/examples/ ）

**内容の復元・裏付けに用いた二次資料**

- Code Vulnerabilities Put Skiff Emails at Risk（Sonar） — https://www.sonarsource.com/blog/code-vulnerabilities-put-skiff-emails-at-risk
- mXSS: The Vulnerability Hiding in Your Code（Security Boulevard 転載） — https://securityboulevard.com/2024/05/mxss-the-vulnerability-hiding-in-your-code/
- Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
- Mutation XSS via namespace confusion – DOMPurify +2.0.17 bypass（Michał Bentkowski / Securitum） — https://www.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass.html
- From SVG and back … DOMPurify < 2.2.2 bypass（Daniel Santos / vovohelo） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f
- mXSS Attacks: Attacking well-secured Web-Applications by using innerHTML Mutations（Heiderich et al., ACM CCS 2013） — https://cure53.de/fp170.pdf
- CVE-2021-23974 mXSS via noscript / DOMParser（Bugzilla@Mozilla） — https://bugzilla.mozilla.org/show_bug.cgi?id=1528997
- CVE-2024-47875 Nesting-based mXSS（OSV） — https://osv.dev/vulnerability/CVE-2024-47875
- CVE-2025-26791 template literal regex mXSS（Snyk） — https://security.snyk.io/vuln/SNYK-JS-DOMPURIFY-8722251
- CVE-2025-15599 Textarea Rawtext Bypass in SAFE_FOR_XML（VulnCheck） — https://www.vulncheck.com/advisories/dompurify-xss-via-textarea-rawtext-bypass-in-safe-for-xml
- CVE-2026-41238 Prototype Pollution → XSS via CUSTOM_ELEMENT_HANDLING（GitHub Advisory） — https://github.com/advisories/GHSA-v9jr-rg53-9pgp
- `<annotation-xml>`（MDN） — https://developer.mozilla.org/en-US/docs/Web/MathML/Element/annotation-xml
- whatwg/html #11397（style/script/xmp のパース一貫化提案） — https://github.com/whatwg/html/issues/11397
- MXSS Evolution and Timeline: A primer to MXSS（s1r1us） — https://s1r1us.ninja/posts/mxss-101/
