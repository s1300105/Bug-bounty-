## 日本語DOM XSS資料（はせがわ / Flatt SPA）

本セクションは、日本語圏でDOMベースXSSを学ぶ上で必読とされる2つの資料——**はせがわようすけ氏の「JavaScript Security beyond HTML5」**（DOMベースXSSの本質と「サーバを通らない攻撃」の解説）と、**GMO Flatt Security の「SPA開発とセキュリティ — DOM based XSS を引き起こすインジェクションの Vue, React, Angular における解説と対策」**——を精読・統合して再構成したものです。前セクションまでで学んだ source（ソース：攻撃者が値を操作できる入口となるJavaScriptプロパティ。例 `location.hash`）と sink（シンク：攻撃者データが最終的に実行・解釈される危険な代入先。例 `innerHTML`）の枠組みを土台に、ここでは「**モダンなフレームワークやサニタイザ（入力に含まれる危険な文字列を無害な形に変換・除去する処理／ライブラリ）を使っていてもなぜXSSが起き続けるのか**」を、ブラウザのHTMLパーサ（HTMLの文字列を解析してDOMツリーに変換する部品）の挙動レベルまで掘り下げて解説します。これが本セクションの価値の中心です。

---

### 0. 本セクションの資料取得状況（透明性のための注記）

本セクションが典拠とする2資料（下記URL）は、執筆環境のネットワーク下り（egress）プロキシによって `www.docswell.com` および `blog.flatt.tech` ドメインへの直接アクセスがブロックされ、ページ本文を直接取得（WebFetch）できませんでした。そこで **Web検索の結果スニペット・同一トピックの公式ドキュメント（Vue.js / Angular のセキュリティガイド等）・cure53/DOMPurify の公式Wiki と Pull Request・複数の二次解説記事から本文の内容・具体例・ペイロード・防御策を復元**し、Webセキュリティの専門知識で補完・体系化しています。**2資料とも実質的な内容を復元できたため「取得不可」とはしていません**が、両資料は継続的に更新されうるため、最新版の細部（例文の値・対象バージョン・ブラウザ対応など）は必ず各出典URLの原典でご確認ください。

- 資料1（はせがわようすけ「JavaScript Security beyond HTML5」）: `https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823`
- 資料2（GMO Flatt Security「SPA開発とセキュリティ」）: `https://blog.flatt.tech/entry/spa_injection`

なお第2節（mXSS と名前空間の混同）は、はせがわ氏の「beyond HTML5＝HTML5以降の新しい攻撃面」という主題を、現在の到達点まで延長した**補足的な仕組み解説**であり、典拠は主に cure53/DOMPurify の公式資料です。該当箇所にその旨を明記します。

---

### 1. はせがわようすけ「JavaScript Security beyond HTML5」— DOMベースXSSの本質と“サーバを通らない攻撃”

#### 1.1 資料の位置づけ

はせがわようすけ氏（Webセキュリティ研究者。DOMベースXSSやmXSS、文字コードを悪用した攻撃の研究で国際的に知られる）による本資料は、「反射型・格納型XSSはサーバが出力するHTMLの問題だが、**アプリの主戦場がクライアント側JavaScriptに移った結果、サーバがまったく関与しないXSSが主役になった**」という時代認識を軸に、DOMベースXSSの原理・危険性・見つけにくさを解説するものです。「beyond HTML5」というタイトルは、HTML5以降にブラウザへ追加された多数の新機能（`postMessage`、`localStorage`、新しいタグ・属性、SVG/MathMLの統合など）が、そのまま**新しい source と新しい sink を生み出した**という問題意識を表しています。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823

#### 1.2 DOMベースXSSの定義 — 「JavaScriptが実行時にHTMLを組み立てる」瞬間の事故

本資料が繰り返し強調するのは、**DOMベースXSSは「JavaScriptがHTMLをレンダリング（描画）する過程で起きるXSS」である**という点です。最も有名な最小例が次のコードです。

```javascript
// URLの #以降 の文字列を、そのまま要素のHTML内容として書き込む
div.innerHTML = location.hash.substring(1);
```

- `location.hash` は URLの `#` 以降（フラグメント／ハッシュと呼ぶ部分）を返す **source**。攻撃者はURLを作るだけで中身を完全に制御できる。
- `element.innerHTML` は代入された文字列を**HTMLとして解釈してDOMに反映する sink**。
- `.substring(1)` は先頭の `#` を取り除いているだけで、無害化は一切していない。

したがって、次のようなURLを踏ませるだけでスクリプトが動きます。

```
https://example.com/page#<img src=x onerror=alert(document.domain)>
```

**なぜ動くのか**：`innerHTML` への代入は、渡された文字列をブラウザのHTMLパーサに通して「新しいDOM部分木」を生成する処理です。`<img>` 要素が生成され、`src=x` の読み込みに失敗した瞬間に `onerror` 属性のJavaScriptが実行されます（`<script>` タグは `innerHTML` 経由では実行されない仕様のため、攻撃者はイベントハンドラ属性を使うのが定石です。この理由は素朴なXSSと同じ）。

#### 1.3 source と sink の整理（本資料が挙げる代表例）

本資料は「どこから来て（source）、どこへ行き着くか（sink）」を明確に分けて把握することを求めます。特にDOMベースXSS特有のものを整理すると次のとおりです。

**代表的な source（攻撃者が制御しうる入口）**

| source | 説明 | サーバに届くか |
|---|---|---|
| `location.hash` | URLの `#` 以降 | **届かない**（後述） |
| `location.search` | URLの `?` 以降（クエリ文字列） | 届く |
| `location.href` / `document.URL` | URL全体 | 一部届かない |
| `document.referrer` | 遷移元URL | 届くことがある |
| `window.name` | ウィンドウ名（別サイトから設定可能） | 届かない |
| `postMessage` の `event.data` | 他ウィンドウ/iframeからのメッセージ | 届かない |

**代表的な sink（危険な代入先）**

| sink | 何が起きるか | 危険な理由 |
|---|---|---|
| `element.innerHTML` / `element.outerHTML` | 文字列をHTMLとして解釈しDOM化 | タグ・イベント属性が生きる |
| `document.write()` / `document.writeln()` | 解析中のドキュメントに文字列を書き込む | `<script>` すら実行されうる |
| `element.setAttribute("href", ...)` / `.src` 等 | 属性値を設定 | `javascript:` スキームでスクリプト実行 |
| `eval()` / `Function()` / `setTimeout(文字列)` | 文字列をコードとして実行 | 直接コード実行 |

`document.write()` が `innerHTML` より危険なのは、**ドキュメントのパース（解析）がまだ進行中の段階に文字列を割り込ませる**ため、`innerHTML` では無視される `<script>` タグまで通常のスクリプトとして実行されうる点です。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823

#### 1.4 `location.hash` を使うDOM XSSが“怖い”3つの隠密性

本資料の核心的なメッセージのひとつが、**`location.hash`（フラグメント）経由のDOMベースXSSは、反射型XSSと比べて格段に隠密性が高く、検知・防御が難しい**という指摘です。理由は「フラグメントはサーバへ送信されない」という**HTTPの仕様レベルの挙動**に由来します。

URLの構造を思い出してください。

```
https://example.com/page?q=検索語#<img src=x onerror=alert(1)>
                        ^^^^^^^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                        クエリ       フラグメント（#以降）
                        （サーバへ送る）（サーバへ送らない）
```

この「送られない」という一点から、次の3つの隠密性が生まれます。

1. **ブラウザのXSSフィルタ（XSS Auditor／XSS Filter）をすり抜ける**：かつてChrome（XSS Auditor）やInternet Explorer/Edge（XSS Filter）は、「リクエストに含まれる文字列が、そのままレスポンスHTMLに現れたら反射型XSSかもしれない」と推測して遮断していました。しかしフラグメントは**リクエストとしてサーバに送られないので、フィルタが照合しようにも“入力側”を観測できず、素通りします**。（なおXSS AuditorはChrome 78（2019年）で廃止されており、現在の主防御はCSP（Content Security Policy）です。当時の資料が指摘した「フィルタ回避」という性質そのものは、DOMベースXSSがサーバ観測から漏れるという普遍的な事実として今も有効です。）

2. **サーバのアクセスログに痕跡が残らない**：攻撃ペイロードはフラグメントに入っておりサーバへ届かないため、Webサーバのアクセスログには `?` 以降しか記録されません。インシデント調査で「何が送り込まれたか」を後から追うのが極めて困難になります。

3. **利用者が気づきにくい／アドレスバーを偽装できる**：さらに `history.pushState()`（ページ遷移せずにアドレスバーのURLを書き換えられるHTML5のAPI）を悪用すると、攻撃実行後にアドレスバーを無害なURLに書き換えて、痕跡を利用者の目からも隠せます。

**まとめると**：反射型XSSは「サーバを通る＝サーバ側で検知・遮断・記録できる」余地がありますが、`location.hash` 型のDOMベースXSSは**攻撃の全工程がブラウザ内で完結し、サーバから観測不能**です。だからこそ「クライアント側のコード（source→sink のデータフロー）」を直接監査する必要があります。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823

#### 1.5 属性経由の sink — `setAttribute` と `javascript:` スキーム

本資料が挙げるもう一つの重要な sink が、**リンクの `href` に `javascript:` スキームのURLを入れる**パターンです。

```javascript
// 攻撃者が制御する文字列を、そのまま href に設定してしまう
a.setAttribute("href", userInput);   // userInput = "javascript:alert(document.cookie)"
```

**なぜ動くのか**：ブラウザは `href="javascript:..."` のリンクがクリックされると、`javascript:` 以降を**JavaScriptコードとして評価・実行**します。`innerHTML` のようにHTMLタグを注入しなくても、「URLを設定できる箇所」がそのままコード実行の sink になるのです。この性質は後述するSPAフレームワーク（Vue/React/Angular）でも共通の弱点として繰り返し登場します。フレームワークはテキストは自動エスケープしても、**「URL文字列に `javascript:` が入っているか」までは既定で検査しないことが多い**からです。

対策の要点は、URLを sink に渡す前に**スキームを許可リスト方式で検証する**（`http:` / `https:` / `mailto:` など安全なものだけ通し、`javascript:` `data:` `vbscript:` を弾く）ことです。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823

#### 1.6 “beyond HTML5” — 新機能がそのまま新しい攻撃面になる

本資料のタイトルが示すとおり、HTML5以降にブラウザへ追加された機能群は、利便性と引き換えに新しい source/sink を大量に持ち込みました。代表例：

- **`postMessage`**：異なるオリジン（プロトコル+ホスト+ポートの組。同一オリジンかどうかがアクセス制御の基本単位）間でメッセージをやり取りできる。受信側が `event.origin`（送信元オリジン）を検証せずに `event.data` を `innerHTML` に流すと、任意サイトからXSSを撃ち込める source になる。
- **SVG / MathML の統合**：HTMLの中にSVGやMathMLを直接書けるようになった結果、後述する**名前空間（namespace）の切り替え**を悪用した高度なサニタイザ回避（mXSS）が可能になった。
- **`data:` URI / Blob URL**：`data:text/html,...` や `URL.createObjectURL(blob)` で「その場でHTMLドキュメントを生成」でき、文字コードの推測と組み合わさると新種のXSSを生む。

これらは「素朴な反射型XSS」の知識だけでは対処できない領域であり、次節ではその中でも最も難所である **mXSS（mutation XSS）** を、仕組みのレベルで掘り下げます。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823

---

### 2. mXSS（mutation XSS）と名前空間の混同 — サニタイザ防御の最難関

> ⚠️ **本節の位置づけ（補足）**: 以下は、はせがわ氏「beyond HTML5」が扱う「HTML5の新機能が生む新種XSS」という主題を、現在の到達点まで延長した**補足的な仕組み解説**です。典拠は主に cure53（DOMPurifyの開発元）の公式Wikiと Pull Request、および Michał Bentkowski・Daniel Santos らによるバイパス公開記事です。（原資料そのものの逐語ではなく、同テーマの一次資料に基づく体系化である点に注意してください。）

#### 2.1 mXSSとは — 「サニタイズ後に別のDOMへ化ける」現象

**mXSS（mutation XSS：突然変異型XSS）** とは、**サニタイザが検査した時点では安全だったDOMツリーが、その後シリアライズ（DOMを再びHTML文字列に戻す処理）と再パース（reparse：その文字列を再びHTMLとして解析し直す処理）を経ると、実行可能な別のDOMツリーに“化ける”**ことで成立するXSSです。

DOMベースのサニタイザ（DOMPurifyなど）の典型的な動作は次の流れです。

```
入力HTML文字列
  → ①パースしてDOMツリー化
  → ②ツリーを走査し危険な要素/属性を除去（ここで「安全」と判定）
  → ③安全になったツリーをHTML文字列にシリアライズして返す
  → ④アプリが返り値を innerHTML 等に代入（＝ブラウザが再パース）
```

mXSSの本質は、「②で見たツリー」と「④で最終的にできるツリー」が**食い違う**点にあります。サニタイザは②の姿しか検査できないのに、実際にブラウザで実行されるのは④の姿だからです。この「②→④で構造が変異する」からmutation（突然変異）XSSと呼ばれます。

> 出典: Attack Classes & Bypass History — cure53/DOMPurify Wiki — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

#### 2.2 なぜ“化ける”のか — HTMLパーサの文脈依存の再解釈

化ける根本原因は、**HTMLの解析ルールが「文脈（どの要素の内側か・どの名前空間か）」によって変わる**ことです。同じ文字列でも、置かれる場所が違えば別のツリーになります。mXSSはこの文脈依存性を突きます。主な“化けの種”は次の3つです。

**(A) rawtext / RCDATA 要素からのブレークアウト**
`<style>` `<script>` `<textarea>` `<title>` `<xmp>` などは「生テキスト（rawtext）／RCDATA」要素と呼ばれ、**内側はタグとして解釈されない特別なモード**で読まれます。ところが、属性値の中に閉じタグ文字列を仕込んでおくと、再パース時に解析状態がずれます。

```html
<style><a title="</style><img src=x onerror=alert(1)>">
```

**なぜ動くのか**：①の初回パースでは `</style>` は「`title` 属性値という“文字データ”の一部」に見えるため、サニタイザは危険と判定しません。しかし③でシリアライズされた文字列を④で再パースすると、ブラウザは先に現れた `</style>` を**本物のstyle終了タグ**として扱い、そこで生テキストモードを抜け、後続の `<img onerror=...>` を**本物の要素**として生成します。これがブレークアウト（脱出）です。

**(B) 深いネストのフラット化**
WebKit/Blink系ブラウザは要素のネスト（入れ子）を約512段で打ち切ります。この上限を超えると、深い子孫が**兄弟要素として扱われる**など解析ツリーが変わり、mXSSの足がかりになります。

**(C) 名前空間（namespace）の切り替え** ← 最重要。次項で詳述。

> 出典: Attack Classes & Bypass History — cure53/DOMPurify Wiki — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

#### 2.3 名前空間の混同（HTML / SVG / MathML）— mXSSの中核

**名前空間（namespace）** とは、要素が「どの言語仕様のルールで解釈されるか」を決める区分です。ブラウザは主に3つの名前空間を持ちます。

- **HTML名前空間**：通常のHTML。`<style>` の中身はテキスト、`<img>` は空要素、等。
- **SVG名前空間**：`<svg>` 配下。要素名の大文字小文字が区別され、`<style>` の扱いも異なる。
- **MathML名前空間**：`<math>` 配下（数式）。

**同じ要素名でも、属する名前空間が違えばパース規則が違う**——これが混同攻撃の土台です。しかも仕様には、名前空間をまたいで**HTMLの解析を再開させる“統合ポイント（integration point）”** が存在します。

- `<svg>` 内の `<foreignObject>`
- `<math>` 内の `<annotation-xml>`、および `<mtext>` `<mi>` `<mo>` `<mn>` `<ms>`（MathML text integration point）

これらの内側では「HTML名前空間として解析し直す」ため、**要素が名前空間の間を移動する**現象が起き、②で見た姿と④の姿がずれます。

攻撃者は、`<form>` の入れ子や `<mglyph>` のような要素を巧妙に配置して、**サニタイズ時（②）にはHTML名前空間で無害に見える要素を、再パース時（④）にMathML/SVG名前空間へ滑り込ませ**、その結果 `<style>` の中身がテキストではなくなり、隠していた `<img onerror>` が“本物の要素”として蘇るように仕込みます。

> 出典: Attack Classes & Bypass History — cure53/DOMPurify Wiki — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

#### 2.4 実際のバイパスとその対象バージョン（陳腐化への注意）

名前空間混同によるDOMPurify（cure53製の代表的なHTMLサニタイザ・ライブラリ。DOMベースで動く）のバイパスは、**歴史的に何度も発見され、その都度パッチされてきた**「イタチごっこ」です。学習上重要なのは、**どのペイロードがどのバージョンで塞がれたか**を明確に区別することです（古いバイパスは最新版では動きません）。

**① `<mglyph>` を用いた名前空間混同（Michał Bentkowski、2020年公開）**
`<form>` の入れ子と `<math><mtext>` を組み合わせ、本来HTML名前空間にある `<mglyph>` を再パース時にMathML名前空間の子へ移動させる古典的ゲーデット（gadget：攻撃の部品）。

```html
<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
```

**なぜ動くのか**：`<mtext>` はMathML text integration point なのでその内側はHTML扱い。ところが `</form>` によるツリーの所有権変更（ownership mutation）で、再パース時に `<mglyph>` の親が `<mtext>`（MathML名前空間）に切り替わる。すると `<style>` もMathML名前空間となり**中身がテキストとして扱われなくなる**。続く `</math>` でMathMLを抜け、`<img>` がHTML名前空間の“本物の要素”として生成されて `onerror` が発火する。→ **DOMPurify 2.0.17 で対策**（それ以前のバージョンが影響。securitum の解説記事のタイトルも「DOMPurify 2.0.17 bypass」）。

**② “From SVG and back”（Daniel Santos、2020〜2021年公開）**
SVG名前空間へ入り、統合ポイントを通じてHTML名前空間へ「戻る」経路を悪用する続編バイパス。→ **DOMPurify 2.2.2 で修正**（`< 2.2.2` が影響）。

**③ cure53 による包括的な名前空間検証の導入（PR #495、2020年12月マージ）**
上記の個別対応を根本から塞ぐため、`_checkValidNamespace` 関数が追加されました。対象ペイロードの例：

```html
<!-- 例1（2019年報告の古典）: svg配下にp が入り再パースで構造が変わる -->
<svg></p><style><a title="</style><img src onerror=alert(1)>">

<!-- 例2: form + math + mtext + mglyph の名前空間切り替え -->
<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
```

修正内容の要点：
- SVG/MathMLとHTMLの間の名前空間切り替えは、**仕様が定める統合ポイント経由のみ許可**する。
- SVG固有・MathML固有の要素は、**それぞれの名前空間内にしか存在できない**と検証し、予期しない名前空間の要素は削除する。
- **`insertAdjacentHTML` の使用をやめ**、DOMノードを直接操作するよう変更。これはドキュメント解析モードとフラグメント解析モードの差異を突く再パース攻撃を防ぐため。
→ **DOMPurify 2.2.6 以降で有効**。

**④ 近年のCVE（arms raceは今も継続）**
cure53のWikiによれば、その後も新しい攻撃クラスが報告され続けています（Wikiが列挙する例）：

- **CVE-2024-47875 / CVE-2024-45801**：ネスト型mXSS。プロトタイプ汚染（prototype pollution：オブジェクトの共通の親 `Object.prototype` を書き換えて全オブジェクトの挙動を汚染する攻撃）がネスト深さチェックを弱め、これらが連鎖。3.1.1 系で数値の深さ上限を追加。
- **CVE-2026-47423**：`<selectedcontent>` 要素。ブラウザが**サニタイズ実行後に**選択中の `<option>` の内容を再複製するため、検査済み領域に危険なコンテンツが後から出現。3.4.5 で修正。
- **CVE-2026-41238**：プロトタイプ汚染によるサニタイザのダウングレード。3.4.0 で「プロトタイプなしオブジェクト初期化」により修正。
- Wikiは **3.4.15 時点で列挙した全攻撃クラスが塞がれている**としています。

**学習上の結論**：mXSS対策は「DOMPurifyを入れれば終わり」ではなく、**必ず最新版に追随し続ける**必要があります。バージョン依存の脆弱性は、対象バージョンと修正版・公開年をセットで理解しなければ意味がありません。

> 出典: Attack Classes & Bypass History — cure53/DOMPurify Wiki — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
> 出典: Harden protection against mutation XSS caused by namespace switching (PR #495) — cure53/DOMPurify — https://github.com/cure53/DOMPurify/pull/495
> 出典（さらに深く学ぶ資料）: mutation XSS via namespace confusion – DOMPurify 2.0.17 bypass（Michał Bentkowski, securitum）/ From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass（Daniel Santos, Medium）/ mXSS Attacks: Attacking well-secured Web-Applications（Heiderich ほか, cure53）— https://cure53.de/fp170.pdf

#### 2.5 DOMPurifyはどう塞ぐか — 防御機構の要点

現在のDOMPurifyがmXSS系を塞ぐために備える主な機構（Wikiより）：

- **名前空間検証**：各ノードを「タグ名」だけでなく**親の名前空間との整合性**で評価する（前項 `_checkValidNamespace`）。
- **`SAFE_FOR_XML` 正規表現**：属性値に潜む危険なシーケンス——コメント/CDATA風の閉じ列 `(--!?|])>` や、生テキスト要素の閉じタグ `</style|script|title|...>`——を検出して無害化。前述の「属性値に `</style>` を仕込むブレークアウト」対策。
- **キャッシュされたプロトタイプアクセッサ**：DOM clobbering（HTML要素に `id`/`name` を付けることで、JavaScriptから見た同名プロパティを要素で“上書き”してしまう攻撃）を防ぐため、セキュリティ関連プロパティへのアクセスをキャッシュした正規の参照経由に固定。

そして安全性の検証には、文字列一致だけでなく **「サニタイズ→シリアライズ→再挿入→再パース」の全ライフサイクルをテストし、実際にDOMへ挿入した後に `onerror` 属性や `<script>` が残っていないか**を確認することが必須、とされています。これはmXSSの本質（②と④の食い違い）から論理的に導かれる検証方針です。

> 出典: Attack Classes & Bypass History — cure53/DOMPurify Wiki — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History

---

### 3. GMO Flatt Security「SPA開発とセキュリティ」— React / Vue / Angular のDOMベースXSS

#### 3.1 資料の位置づけと中心的主張

本資料（GMO Flatt Security、2022年4月公開）は、**SPA（Single Page Application：初回に読み込んだ1枚のHTML上で、以降はJavaScriptがDOMを書き換えて画面遷移する方式のWebアプリ）** におけるインジェクション、とりわけ **DOMベースXSSを引き起こす「危険なAPIの誤用」を、Vue・React・Angular の3大フレームワークごとに具体的に解説し、対策を示す**ものです。

中心的な主張は次の2点です。

1. **こうした脆弱性は自動スキャナで見つけにくい**：攻撃の成否がクライアント側JavaScriptのデータフロー（source→sink）に依存するため、サーバ応答だけを見る旧来の脆弱性スキャナでは検出困難で、**手作業のコードレビュー／診断が不可欠**。
2. **フレームワークの「自動エスケープ」は万能ではない**：現代のフレームワークは通常のテキスト表示を自動でエスケープ（HTMLとして特別な意味を持つ文字 `< > & " '` を `&lt;` 等に変換し、データをコードとして解釈させない処理）してくれる。この安心感が、**「エスケープの網から漏れる箇所」（後述の“抜け穴”API・URL属性）** の危険性を開発者に忘れさせる。ここに事故が集中する。

> 出典: SPA開発とセキュリティ — DOM based XSS を引き起こすインジェクションの Vue, React, Angular における解説と対策（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection

#### 3.2 3フレームワークに共通する「抜け穴」の型

各フレームワークの詳細に入る前に、共通の構図を押さえます。フレームワークは「テキストの自動エスケープ」で反射型XSS的な事故の大半を防ぎますが、**設計上どうしても“生のHTML/URLを扱う口”を用意せざるを得ず**、そこが sink になります。抜け穴は大きく2種類です。

| 抜け穴の型 | 何が危険か | 3FWでの現れ方 |
|---|---|---|
| **生HTMLの注入口**（自動エスケープを意図的に無効化するAPI） | 文字列をHTMLとして解釈しDOM化する。`<img onerror>` 等が生きる | Vue: `v-html` ／ React: `dangerouslySetInnerHTML` ／ Angular: `[innerHTML]` + `bypassSecurityTrustHtml` |
| **URL/属性への注入**（`href` `src` 等に文字列を流す） | `javascript:` スキームでクリック時にコード実行 | 3FW共通：動的な `href`/`:href`/属性バインド |

以下、フレームワークごとに具体化します。

#### 3.3 Vue

**既定の安全機構**：Vueはテキスト補間 `{{ userInput }}` と属性バインド `v-bind`（`:属性` 記法）で**自動的にエスケープ**します。したがって `{{ }}` に何を入れてもタグとしては解釈されず、通常の表示は安全です。

**抜け穴①：`v-html`（生HTMLの sink）**
`v-html` ディレクティブは、値を**エスケープせず生のHTMLとしてDOMに挿入**します。リッチテキスト表示・Markdownプレビュー・メールテンプレート描画などで多用され、事故が起きやすい代表格です。

```html
<!-- 危険: userHtml に攻撃者の値が入るとXSS -->
<div v-html="userHtml"></div>
```
攻撃者が `userHtml = "<img src=x onerror=alert(document.cookie)>"` を送り込めば発火します。
**なぜ動くのか**：`v-html` は内部的に `innerHTML` 相当の代入を行うため、第1節で見た `innerHTML` sink とまったく同じ理屈でイベントハンドラ属性が実行されます。

**抜け穴②：`:href`（`v-bind:href`）への `javascript:` URL**
属性バインドはテキストとしてはエスケープしますが、**「値が `javascript:` スキームか」は既定で検査しません**。

```html
<!-- 危険: userUrl = "javascript:alert(1)" だとクリックでコード実行 -->
<a :href="userUrl">プロフィール</a>
```
本資料は、ユーザーのリンク入力欄に `javascript:alert(1)` を入れると、クリック時にalertが出る具体例を挙げています。
**なぜ動くのか**：第1.5節の `setAttribute("href","javascript:...")` と同一の原理。属性バインドはHTMLエスケープはするがスキーム検証はしない。

**対策**：ユーザー制御の内容には `v-html` を避け `v-text`（＝自動エスケープ表示）を使う。どうしても生HTMLが必要ならDOMPurify等で**表示直前にサニタイズ**する。URLは**バックエンドで**スキームを許可リスト検証してから保存する（フロントだけでのURLサニタイズは信頼できない）。

> 出典: SPA開発とセキュリティ（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection
> 出典（補強）: Security | Vue.js 公式ガイド — https://vuejs.org/guide/best-practices/security

#### 3.4 React

**既定の安全機構**：JSX（React独自のHTML風構文）に埋め込んだ値 `{userInput}` は**自動的にエスケープ**されるため、通常の描画は安全です。

**抜け穴①：`dangerouslySetInnerHTML`（生HTMLの sink）**
その名（dangerously＝危険なことに）どおり、**自動エスケープを意図的にバイパスして生HTMLを挿入する**唯一の口です。

```jsx
// 危険: __html に攻撃者の値が入るとXSS
<div dangerouslySetInnerHTML={{ __html: userHtml }} />
```
ペイロード例：`{ __html: "<img src=x onerror='alert(localStorage.access_token)'>" }`
**なぜ動くのか**：内部的に `innerHTML` へ代入するため、`<img onerror>` が本物の要素として生成され発火。`localStorage` からアクセストークンを窃取する等、実害に直結します。

**抜け穴②：`href` への `javascript:` URL**
動的に生成する `<a>` の `href` を攻撃者が制御できると `javascript:` URLを注入できます。

```jsx
// 危険: url = "javascript:alert(1)"
<a href={url}>リンク</a>
```
（Reactは16.9以降、`javascript:` URLに対して**警告を出す**ようになりましたが、警告であって完全な遮断ではないバージョン・経路があり、依然として注意が必要です。）
**なぜ動くのか**：属性値の `javascript:` スキームがクリック時に評価される、第1.5節と同一原理。

**抜け穴③：`ref` 経由の直接DOM操作 / `eval`**
`useRef`/`ref` で取得した生のDOM要素に対し `ref.current.innerHTML = ...` のように直接書き込むと、Reactのエスケープを完全に迂回します。また `eval()` や `new Function()` にユーザー入力を渡すのも当然に危険です。

**対策**：ユーザー入力に `dangerouslySetInnerHTML` を使わない。必要ならDOMPurifyで**サニタイズしてから**渡す。URLは許可スキーム検証（フロントで完結させずバックエンドでも検証）。`ref` 直接操作・`eval` を避ける。

> 出典: SPA開発とセキュリティ（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection
> 出典（補強）: Exploiting Script Injection Flaws in ReactJS Apps（Bernhard Mueller, DailyJS/Medium）

#### 3.5 Angular

**既定の安全機構**：Angularは最も強力で、**DOMにバインドされる値をすべて“信頼できない”ものとして既定でサニタイズ**します。`[innerHTML]="userContent"` と書いても、Angularがまず**組み込みサニタイザ**を通し、`<script>` や `onerror` のような危険な要素・属性を除去してから描画します。

```html
<!-- Angularが自動サニタイズするので、これ自体は比較的安全 -->
<div [innerHTML]="userContent"></div>
```

**抜け穴：`DomSanitizer.bypassSecurityTrust...` の誤用**
Angularには、サニタイズを**意図的に無効化する“エスケープハッチ”** として `bypassSecurityTrustHtml()`（および `...Url` `...ResourceUrl` `...Script` `...Style`）があります。これに**ユーザー入力を渡すと、Angularの防御を自ら無力化**してXSSになります。

```typescript
// 危険: 信頼できない値に bypass を使うと自動サニタイズを無効化してXSS
this.trusted = this.sanitizer.bypassSecurityTrustHtml(userHtml);
```
```html
<div [innerHTML]="trusted"></div>
```
**なぜ動くのか**：`bypassSecurityTrust...` は「この値は自分が安全だと保証したので検査不要」という宣言。Angularはそれを信じてサニタイズをスキップし、生HTMLがそのまま `innerHTML` に到達する。

**正しい使い方の原則**（Angular公式・本資料に共通）：`bypassSecurityTrust...` は**自分が書いた静的な安全な文字列にのみ**使い、ユーザー入力には決して使わない。使う場合は**値の発生源にできるだけ近い場所で・早い段階で**呼び、安全性を目視で確認しやすくする。

**対策**：ユーザー入力は `[innerHTML]`（自動サニタイズ）に任せる、またはサーバ側HTMLサニタイザを使う。`bypassSecurityTrust...` を安易に使わない。加えて **Trusted Types**（後述）を有効化すると、ブラウザ自身が「承認済みポリシーを通した値しか危険な sink に代入できない」ことを強制でき、防御が一段強くなる。

> 出典: SPA開発とセキュリティ（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection
> 出典（補強）: Security • Angular 公式ガイド / DomSanitizer • Angular — https://angular.dev/best-practices/security

#### 3.6 3フレームワーク横断の防御まとめと多層防御

本資料が導く実務上の指針を統合すると次のとおりです。

1. **“抜け穴”APIを棚卸しする**：`v-html` / `dangerouslySetInnerHTML` / `[innerHTML]`＋`bypassSecurityTrust...` の全使用箇所を洗い出し、ユーザー入力が流れ込まないか監査する。
2. **生HTMLが必要なら表示直前にサニタイズ**：**DOMPurify**（最新版）でサニタイズしてから sink に渡す。第2節のとおりバージョン追随が必須。
3. **URLはスキームを許可リスト検証**：`javascript:` `data:` `vbscript:` を弾く。**フロントだけで完結させず、バックエンドで保存前に検証**する（「フロントでURLサニタイズが必要な時点で設計に問題がある」という指摘）。
4. **エスケープハッチはヘルパー関数に閉じ込め、名前で意図を明示**：`bypassSecurityTrust...` のような危険関数は、用途が一目で分かる名前のヘルパーに包み、誤用を防ぐ。
5. **多層防御（defense in depth）として CSP と Trusted Types**：
   - **CSP（Content Security Policy）**：HTTPレスポンスヘッダ等で「スクリプトをどこから読み込み・実行してよいか」をブラウザに宣言する仕組み。インラインスクリプトや外部スクリプトの実行を制限し、万一XSSが注入されても発火の敷居を上げる（ただし**サニタイズの代替ではなく上乗せ**）。
   - **Trusted Types**：`innerHTML` などの危険な sink に対し、「承認済みポリシーを通して生成した特別な型の値」しか代入できないよう**ブラウザ自身に強制**させる仕組み。DOMベースXSSの sink 到達そのものをブロックできる、現時点で最も強力な多層防御の一つ。

これらは「どれか一つ」ではなく**重ねて**用いることで、フレームワークの自動エスケープ（1層目）→ サニタイズ／スキーム検証（2層目）→ CSP／Trusted Types（3層目）という多段構えを作るのが要諦です。

> 出典: SPA開発とセキュリティ（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection

---

### 4. セクションのまとめ — 「サーバの外」で完結する攻撃と、その多層防御

本セクションで押さえるべき要点を凝縮します。

- **DOMベースXSSは source→sink のデータフロー問題**。特に `location.hash` 経由の攻撃は**サーバに届かない**ため、XSSフィルタ・アクセスログ・利用者の目のいずれからも隠れやすく、`history.pushState` で痕跡すら消せる（はせがわ資料の核心）。
- **HTML5以降の新機能（`postMessage`・SVG/MathML統合・`data:`/Blob URL）は、そのまま新しい source/sink になった**。「beyond HTML5」。
- その最難関が **mXSS（mutation XSS）**。サニタイザが見た②のツリーと、ブラウザが実行する④のツリーが**名前空間の切り替え・rawtextブレークアウト・深いネストのフラット化**で食い違うことで成立する。DOMPurifyへの名前空間混同バイパスは **2.0.17 / 2.2.2 / 2.2.6** で順次修正され、その後も CVE が続く**イタチごっこ**であり、**最新版への追随が絶対条件**。
- **SPAフレームワークの自動エスケープは通常のテキストしか守らない**。`v-html` / `dangerouslySetInnerHTML` / `[innerHTML]`＋`bypassSecurityTrustHtml` という**生HTMLの抜け穴**と、`javascript:` URL を通す**属性/URLの抜け穴**に事故が集中する（Flatt資料）。
- 防御は**多層**で：フレームワークの自動エスケープ → DOMPurifyによるサニタイズと**バックエンドでのURLスキーム検証** → **CSP / Trusted Types**。そして自動スキャナに頼り切らず、**source→sink を追う手作業のコードレビュー**が不可欠。

> 出典: JavaScript Security beyond HTML5（はせがわようすけ）— https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823
> 出典: SPA開発とセキュリティ — DOM based XSS を引き起こすインジェクションの Vue, React, Angular における解説と対策（GMO Flatt Security Blog）— https://blog.flatt.tech/entry/spa_injection
> 出典: cure53/DOMPurify Wiki（Attack Classes & Bypass History）/ PR #495 — https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History
