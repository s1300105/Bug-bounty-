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
