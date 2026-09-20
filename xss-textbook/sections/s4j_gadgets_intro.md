## Script Gadgets（CSP Evaluator / Black Hat論文）

これまでの章では、CSP（Content Security Policy）を「攻撃者が任意のスクリプトを注入しても実行させない仕組み」として学んできた。しかし現実のWebアプリケーションには、jQueryやAngularJS、Bootstrap、あるいは自社のフロントエンドコードなど、大量の**信頼された（allowlistに載っている、あるいはページに元から存在する）JavaScriptライブラリ**が動いている。

**Script Gadgets（スクリプトガジェット）** とは、こうした「正規の、悪意のないJavaScriptコード」でありながら、**攻撃者が制御できるDOM要素（属性・クラス名・data属性など）を読み取り、その内容に基づいてスクリプトを実行してしまう副作用を持つコード片**のことを指す。攻撃者は、CSPやサニタイザ、WAF（Web Application Firewall）を通過できる「無害に見えるHTMLタグ・属性」だけを注入し、ページ上に既に存在するgadget（正規コード）に「解釈」させることで、間接的にスクリプトを実行させる。つまり、**攻撃者は`<script>`を注入する必要がない**。ページ側のライブラリが、注入されたマークアップを見て「これはUIコンポーネントの初期化指示だ」と誤解し、自らJavaScriptを実行してしまうのである。

この章では、この技法を体系化した研究（Black Hat USA 2017発表)と、CSPポリシーの脆弱性を機械的に検出するGoogleのツール「CSP Evaluator」を扱う。両者は表裏一体の関係にある。CSP Evaluatorは「このホストを許可すると、そこにScript Gadgetsが存在するかもしれない」という観点でポリシーを評価するツールであり、Script Gadgets研究はその脅威モデルの土台を作った論文だからである。

### 1. なぜCSPだけでは不十分なのか（背景となる原理）

CSPの`script-src`ディレクティブは基本的に「**どこから読み込まれたスクリプトか（送信元）**」を制御する仕組みであり、「**そのページに元から存在する正規のJavaScriptが、DOM上の何を読んで何をするか**」までは一切関知しない。

例えば以下のような、一見「安全そう」なCSPを考える。

```
Content-Security-Policy: script-src 'self' https://cdn.jquery.com;
```

このポリシーは、インラインスクリプト（`unsafe-inline`）を禁止し、外部スクリプトも`self`と信頼できるCDNからのみ許可している。素朴な反射型XSS（`<script>alert(1)</script>`や`<img onerror=alert(1)>`のようなインラインイベントハンドラ）は、CSPによって実行がブロックされる。

しかし、ページ上で読み込まれている`jQuery`自体（あるいはBootstrap、AngularJSなど）が、**DOM要素の属性を条件分岐なく解釈してコード実行に繋げる処理**を持っていた場合、攻撃者は`<script>`タグではなく、**一見無害な`<div>`や`<a>`タグに特定の属性を仕込むだけ**で、その正規コードにトリガーを引かせられる。これがScript Gadgetsの核心である。

つまり脅威モデルはこうなる。

- **前提1**: 何らかのHTMLインジェクション（サニタイザのバイパス、DOM-based XSSのマークアップ挿入ポイントなど）によって、攻撃者は**タグ名や属性値は制御できるが、`<script>`タグやインラインイベントハンドラ（`onerror`等）や`javascript:`スキームは使えない**（CSPやサニタイザがブロックするため）。
- **前提2**: ページには既に、DOM上の属性・クラス名を読んで処理を行うJavaScriptライブラリ（jQuery、AngularJS、Bootstrapの各種プラグインなど）がロードされている。
- **結果**: 攻撃者が挿入した「無害なマークアップ」を、そのライブラリが「実行指示」として誤読し、結果的に任意コード実行に至る。

この構造は、バイナリエクスプロイトにおける **ROP（Return-Oriented Programming、既存の実行可能コード断片＝gadgetをつなぎ合わせて任意の処理を組み立てる手法）** に類似することから、研究者らは「Webのコード再利用攻撃（Code-Reuse Attacks for the Web）」と呼んでいる。ROPが「バイナリ中の既存の命令列を再利用する」のに対し、Script Gadgetsは「ページ中の既存のJavaScriptロジックを再利用する」という対応関係にある。

### 2. Black Hat USA 2017論文「Don't Trust The DOM: Bypassing XSS Mitigations Via Script Gadgets」

#### 2.1 概要と位置づけ

本論文はSebastian Lekies、Krzysztof Kotowicz、Eduardo Vela Nava（Google）によって2017年のBlack Hat USAで発表された（同年ACM CCS 2017にも "Code-Reuse Attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets" として採録されている）。研究の核心は、当時「XSS対策の決定打」と考えられていた複数の技術――

- Content Security Policy（CSP）
- DOM Sanitizer（DOMPurifyなど）
- WAF（Web Application Firewall）
- ブラウザ組み込みのXSS Auditor / Filter（当時Chrome/IEに存在した）

――が、いずれも「**タグ・属性の並びだけを見て『危険かどうか』を判定する**」という設計上の限界を持っており、ページに元からロードされている**JavaScriptライブラリの実装次第で回避可能である**ことを、大規模な実証実験で示した点にある。

#### 2.2 手法（gadgetの探索）

研究チームは、Alexaランキング上位で広く使われる**主要なJavaScriptライブラリ（jQuery、AngularJS、Polymer、Bootstrap、Knockout、Ember、Google Closure、MooTools、YUI、Prototype.js など、論文では複数バージョンにわたり多数のライブラリ）を対象に静的・動的解析を行い、DOM要素の属性・クラス名・データ属性等を読み取ってコード実行につながる「gadget」を機械的に洗い出した**。

その結果、調査対象とした主要ライブラリの**ほぼすべてに1つ以上のgadgetが存在する**ことが判明した。これは「有名で信頼されたライブラリだから安全」という前提そのものを覆す結果であり、CSPの許可リストに「信頼できるCDNだから」という理由だけでライブラリのホストを追加することの危険性を裏付けた。

> ⚠️ **未取得の資料に関する補足**: Black HatのPDF本体（`blackhat.com`）は本環境のネットワーク制限により直接取得できませんでした。理由: 当該ドメインがegressプロキシでブロックされているため。原文は以下からユーザーご自身でご覧いただけます: https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf
> （以下は未取得資料の補足として、公開されている検索結果・関連論文情報・一般知識に基づく解説です。定量的な数値・図表・スライドの詳細な文言については、必ず原典PDFを直接ご確認ください。）

#### 2.3 具体的なgadgetの例（jQueryを題材に）

論文・関連発表で繰り返し取り上げられる典型例が、jQueryの**セレクタ処理とDOM挿入APIの組み合わせ**である。jQueryには、`$()`関数に渡された文字列がCSSセレクタなのかHTML断片なのかを内部でヒューリスティックに判定するロジックがあり、また多くのUIプラグイン（例えば旧式の`jQuery Mobile`や各種タブ/モーダルプラグイン）が「**特定の`data-*`属性やクラス名を持つ要素を見つけたら、その値をHTMLとして`.html()`や同種のsinkに渡して展開する**」という処理を実装していた。

例えば、次のような疑似コードのgadgetを考える（jQuery Mobileの一部で実際に確認された種類のパターンを単純化したもの）。

```html
<!-- 攻撃者が注入できるのは <script> ではなく、この無害に見えるタグと属性のみ -->
<div data-role="popup" data-content="<img src=x onerror=alert(document.domain)>"></div>
```

このマークアップ自体には`<script>`もインラインイベントハンドラの直接記述もなく、CSPの`script-src`にも、サニタイザの「危険タグの除去」にも引っかからないように見える。しかしページ上でjQuery Mobileの初期化コードが走ると、そのライブラリが`data-role="popup"`を持つ要素を自動的に検出し、`data-content`の値を**信頼して**`.html()`（内部的には`innerHTML`と同等）に渡して描画する。この結果、`data-content`内の`<img src=x onerror=...>`がDOM上に実体化され、`onerror`イベントハンドラとして攻撃者のJavaScriptが実行される。

- **なぜ動くか**: サニタイザやCSPは「注入されたタグそのもの」しか見ていないが、ライブラリの初期化コードは**属性の値を後からHTMLとして再解釈（パーサ再解釈）してDOMに書き戻す**。この「一度は無害な形で通過したデータが、後段の正規コードによって危険なsinkに渡される」という時間差・経路の分離が、静的フィルタリングの検出網をすり抜ける根本原因である。

もう一つの典型パターンは、AngularJS（1.x系、当時のsandbox機構がまだ存在した/その後撤廃された時期）における**テンプレートインジェクション系gadget**である。AngularJSは`ng-`から始まる属性やdouble-mustache構文（`{{ }}`）をテンプレートとして評価するため、攻撃者が`ng-app`や`ng-csp`が有効なページに対して、以下のような属性だけを注入できれば、AngularJSの式評価エンジンを経由してコード実行に到達できる場合があった。

```html
<div ng-app ng-csp>{{constructor.constructor('alert(1)')()}}</div>
```

- **なぜ動くか**: AngularJSのテンプレートエンジンは`{{ }}`内の文字列をJavaScript式として評価する。`constructor.constructor('alert(1)')()`は、任意のオブジェクトの`constructor`プロパティ（プロトタイプチェーンを辿って到達する`Function`コンストラクタ）を取得し、それを使って動的に新しい関数を生成・実行する**サンドボックス脱出（sandbox escape）**の定石パターンである。`<script>`タグを一切使わずに、AngularJS自身の式評価器（eval相当の機能）を「借用」して任意コードを実行させている点が、まさにScript Gadgetの本質を示している。

これらの例が示す共通原理は次の通りである。

1. **sink（危険な処理の最終到達点。例: `innerHTML`, `eval`, `Function`コンストラクタ, jQueryの`.html()`）そのものは、攻撃者が直接注入したコードから呼ばれるのではなく、ページに元から存在する正規のライブラリコードの内部から呼ばれる。**
2. 攻撃者が制御できるのは、そのライブラリが「設定・データ」として信頼して読み取る**属性値やテキストコンテンツ**のみ。
3. サニタイザ・CSP・WAFは「タグ名/属性名/URLスキーム」という**構文レベル**でしか判定できないため、「その属性がどのライブラリにどう解釈されるか」という**意味レベル**の危険性までは把握できない。この構文と意味のギャップこそがScript Gadgetsが成立する原理である。

#### 2.4 影響範囲と結論

論文は、CSP・サニタイザ・WAFのいずれも単独では「防御しきれない」ことを示し、次のような結論・提言を行った。

- 大手企業サイトを含む実運用サイトの多くで、CSPを導入していても信頼するホスト（CDN等）にScript Gadgetsを含むライブラリが配置されており、**理論上バイパス可能な状態**にあった。
- 対策として、CSPは**nonceベース／hashベースのstrict-dynamic方式**（許可リスト方式ではなく、サーバが発行した使い捨てトークンで個々の`<script>`要素を認可する方式）へ移行すべきであると提言した。これはホスト許可リスト自体を廃止し、「そのホストにgadgetがあるかどうか」という問題設定自体を無効化するアプローチである。
- サニタイザについては、**属性・タグの許可リストを最小限にし、DOM操作系ライブラリが読む可能性のある`data-*`属性やaria属性等も含めて慎重に扱う**必要性が指摘された。
- 根本的な教訓として、「信頼されたライブラリ（trusted code）」という概念そのものが、DOM入力に対しては相対的でしかなく、**ライブラリの実装詳細まで踏み込んだ脅威分析なしにCSPやサニタイザだけで『安全』と判断してはならない**という考え方が業界に広まった。

> 出典: Don't Trust The DOM: Bypassing XSS Mitigations Via Script Gadgets — https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf

### 3. Google CSP Evaluator

#### 3.1 ツールの位置づけ

**CSP Evaluator**（https://csp-evaluator.withgoogle.com/）は、Googleが公開している無料のWebツール・ライブラリで、URLを入力するかCSPポリシー文字列を直接貼り付けると、そのポリシーに含まれる**構文的・意味的な弱点**を自動的に検出し、重大度（高・中・情報）付きで一覧表示してくれる。CSPをレビューする際の「静的解析器」として、Bug Bountyやセキュリティ診断の現場でも広く使われている。

> ⚠️ **未取得の資料に関する補足**: `csp-evaluator.withgoogle.com`自体も本環境のegressプロキシによりブロックされ、直接の内容取得はできませんでした。以下のURLからユーザーご自身で直接ご覧いただき、実際に自社のCSPを貼り付けて挙動を確認することを推奨します: https://csp-evaluator.withgoogle.com/
> （以下は未取得資料の補足として、一般に公開されている情報・検索結果・一般知識に基づく解説です。）

#### 3.2 検出する主な問題カテゴリ（原理レベルの説明）

CSP Evaluatorが指摘する代表的な弱点は、いずれも「**許可リストという発想そのものの限界**」に起因する。

**(1) `unsafe-inline`の使用**

```
Content-Security-Policy: script-src 'self' 'unsafe-inline';
```

`unsafe-inline`が指定されると、ページ上のあらゆるインラインスクリプト・インラインイベントハンドラが実行可能になる。これは攻撃者が注入したインラインスクリプトも区別なく許可してしまうため、**CSPが本来防ぎたい素朴なXSSすら防げなくなる**。CSP Evaluatorはこれを最高重要度で警告する。

- **なぜ危険か（原理）**: CSPのソース許可は「スクリプトがどこから来たか」を判定基準にしているが、`unsafe-inline`はこの判定機構自体を無効化するキーワードである。ブラウザは`unsafe-inline`が指定されたポリシーでは、インラインスクリプトに対して送信元チェックを一切行わない。

**(2) 広すぎるホスト許可リスト（wildcardや大手CDN全体の許可）**

```
Content-Security-Policy: script-src 'self' https://*.googleapis.com https://*.cloudflare.com;
```

ワイルドカード（`*`）や、大規模で多目的なCDNドメイン全体を許可すると、そのドメイン配下でホストされている**無数のJavaScriptファイルのどれか一つでもJSONPエンドポイントやオープンリダイレクト、あるいは前章までで学んだScript Gadgetsを含んでいれば**、攻撃者はそのURLを`<script src="...">`として読み込ませることでCSPをバイパスできる。CSP Evaluatorは、既知のJSONPエンドポイントやgadgetを含むことが報告されているドメイン（AngularJSやjQueryなど、Script Gadgets研究で指摘されたライブラリを配信しているCDN等）を許可リストに含めている場合、具体的にそのドメインを名指しして警告する仕組みを持つ。

- **なぜ危険か（原理）**: CSPの「送信元（オリジン）ベースの許可」は、「そのオリジンにあるファイルはすべて等しく信頼できる」という強い前提の上に成り立っている。しかし実際には、同一オリジン上にJSONPエンドポイント（クエリパラメータの値をそのままJavaScriptとして返すAPI）や、前節で述べたScript Gadgetsを含むライブラリが同居していることが多く、**オリジン単位の粒度では「安全なファイル」と「危険なファイルの入口」を区別できない**。これがCSPの構造的弱点であり、CSP Evaluatorが最も重視する検査観点である。

**(3) `base-uri`の未設定・過剰許可**

```
Content-Security-Policy: script-src 'self';
<!-- base-uri が未指定 -->
```

`<base href="...">`タグはページ内の相対URL解決の基準を変更する。`base-uri`ディレクティブが指定されていない、あるいは`*`のように緩い場合、攻撃者がHTMLインジェクションによって`<base href="https://attacker.example/">`を挿入できれば、ページ内のすべての相対パス指定のスクリプト読み込み（`<script src="/app.js">`など）が**攻撃者のサーバから読み込まれるように書き換わる**。CSPの`script-src`が`'self'`のみを許可していても、`self`が指す実体自体を`<base>`タグで攻撃者ドメインにすり替えられてしまえば意味がなくなる。

- **なぜ危険か（原理）**: ブラウザは相対URLを解決する際、`document.baseURI`（`<base>`タグによって変更可能）を基準にする。CSPの`script-src 'self'`は「現在のオリジンから読み込まれたスクリプト」を許可するチェックだが、その「現在のオリジン」の解釈基準そのものが`<base>`タグで書き換え可能であるため、**チェックの前提条件自体が攻撃者に操作されてしまう**。CSP Evaluatorはこのため`base-uri 'none'`または`base-uri 'self'`の明示的な設定を強く推奨する。

**(4) `object-src`の未設定**

Flashなど、プラグイン（`<object>`, `<embed>`）経由でのコード実行を防ぐため、`object-src 'none'`の明示も併せてチェックされる。Flashは現在ほぼ廃止されているが、レガシー環境向けの防御として引き続き評価項目に含まれる。

**(5) strict-dynamicとnonce/hashベースの推奨**

CSP Evaluatorは、上記のような許可リスト方式に起因する問題を回避する解決策として、**`'strict-dynamic'`とnonceまたはhashを組み合わせた「Strict CSP」**を推奨する。

```
Content-Security-Policy: script-src 'nonce-<ランダム値>' 'strict-dynamic'; object-src 'none'; base-uri 'none';
```

- **なぜ有効か（原理）**: `'strict-dynamic'`が指定されると、ブラウザは**ホスト許可リストを完全に無視**し、代わりに「ページ内で信頼された（nonceまたはhashが一致した）スクリプトによって動的に生成・挿入されたスクリプトは、その出自を継承して信頼する」という**伝播ベースの信頼モデル**に切り替える。これにより、「どのホストを許可リストに入れるべきか」という、Script Gadgets研究が突いた根本的な弱点（ホスト単位では安全性を判定できない）そのものを解消できる。逆に言えば、ホスト許可リスト方式のCSPを使い続ける限り、Script Gadgetsによるバイパスの理論的リスクは残り続ける、というのがこのツールとBlack Hat論文に共通するメッセージである。

#### 3.3 実務上の使い方まとめ

1. 本番導入前のCSPポリシーをCSP Evaluatorに貼り付け、高重要度（赤色）の指摘（`unsafe-inline`、広すぎるワイルドカード、`base-uri`未設定など）を必ず解消する。
2. 許可リストにCDNやサードパーティドメインを追加する際は、そのドメインが**JSONPエンドポイントやScript Gadgetsを含むことが知られていないか**を必ず確認する（CSP Evaluatorや各種CSPバイパス集の突合が有効）。
3. 可能であれば早期に**nonceベースのstrict-dynamic方式**へ移行し、ホスト許可リスト方式そのものから脱却することを目指す。

> 出典: CSP Evaluator — https://csp-evaluator.withgoogle.com/

### 4. まとめ：この章の核心

Script GadgetsとCSP Evaluatorの関係を一言でまとめると、次のようになる。

- **Script Gadgets研究**は、「CSPやサニタイザは構文（タグ・属性・URLスキーム）しか見ておらず、ページ上の正規JavaScriptが持つ『意味』までは検証できない」という**構造的な限界**を実証した。
- **CSP Evaluator**は、その限界の中でも「せめて機械的に検出できる危険パターン（`unsafe-inline`、広すぎる許可リスト、`base-uri`の欠落など）」を洗い出し、より堅牢な**nonce/strict-dynamic方式**への移行を促す実務ツールである。

この章で学ぶべき最重要ポイントは、**「CSPを設定した」「サニタイザを通した」という事実だけでは、Webページ上に存在する正規コードの挙動まで保証されない**という点である。次章以降では、この考え方をさらに発展させ、具体的なDOM Clobberingやミューテーションベースのサニタイザバイパスなど、より高度な「信頼された正規コードの誤用」パターンを扱っていく。
