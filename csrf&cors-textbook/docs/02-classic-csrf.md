# 第2章 古典的CSRFのエクスプロイト

## CSRF PoC生成の型と学習パス

CSRF(Cross-Site Request Forgery、サイト間リクエスト偽造。攻撃者が用意した別サイトから、被害者のブラウザに正規サイトへ意図しないリクエストを「代理送信」させる攻撃)を実際に手を動かして検証するとき、最初にぶつかる壁は「PoC(Proof of Concept、脆弱性が実在することを示す最小限の実証コード)をどう組み立てればよいか」という点である。本節では、PortSwiggerのCSRFラーニングパスが示す学習の全体地図と、最も基本的な「防御なしCSRF」ラボを題材に、PoC生成の型・仕組み・落とし穴を体系的に整理する。ラボの攻略テクニック自体を目的にするのではなく、「なぜそのPoCが成立するのか」という原理を掴むことがここでの目標である。

### 1. 学習パス全体の地図

PortSwiggerのCSRF学習パスは、単発のテクニック集ではなく、CSRFという脆弱性クラスを「基礎理解 → 攻撃構築 → 配送 → 防御 → 防御の破り方」という順序で段階的に積み上げる構成になっている。

> 出典: Web Security Academy: CSRF learning path — https://portswigger.net/web-security/learning-paths/csrf

学習パスの構成は次の通りである。

1. **What is CSRF?**(CSRFとは何か) — 定義と影響範囲の理解
2. **How CSRF works**(CSRFの仕組み) — 攻撃リクエストの構築方法
3. **Delivering exploits**(エクスプロイトの配送) — 被害者に踏ませる手法
4. **Common defenses**(一般的な防御策) — CSRFトークン、SameSite Cookie、Refererヘッダ検証
5. **Token validation flaws**(トークン検証の不備) — トークンがリクエストメソッド依存で検証されない、トークンの有無自体がチェックされない、トークンがセッションに紐付いていない、非セッションCookieにしか紐付いていない、Cookie重複による回避など
6. **SameSite cookie bypasses**(SameSite Cookieのバイパス) — GETへのメソッド変換によるLaxの回避、サイト内ガジェットの悪用など
7. **Referer-based defense bypasses**(Referer検証のバイパス) — Refererヘッダの省略・偽装・脆弱な姉妹ドメインの悪用

このロードマップが示す最も重要な設計思想は、**CSRFは「防御の不在」と「防御の実装ミス」の二層構造で理解すべき**だということである。防御が全く無い状態(本節で扱う`lab-no-defenses`)を基準点として押さえておかないと、後続の「トークンはあるのに破られる」ケースで何が本質的に違うのかが見えなくなる。したがって本節ではまず最も単純な「防御なし」のケースでPoC生成の型を完全に理解し、次章以降でトークン検証不備・SameSiteバイパス・Referer検証バイパスへと発展させる、という学習順序が合理的である。

なお、ラボは全11個で「PRACTITIONER」(実務者向け中級)難易度に分類されており、実際に手を動かしてBurp Suiteでリクエストを観察し、PoCを生成し、Exploit Server(PortSwiggerが用意する攻撃配信用のサンドボックス環境)経由で被害者役に配送する、という一連のワークフローを繰り返し訓練する設計になっている。

### 2. CSRFが成立するための3条件(仕組みレベルの整理)

具体的なラボに入る前に、CSRFがなぜ機能するのかをブラウザとサーバの内部動作から整理しておく。CSRFは次の3条件がすべて揃ったときに成立する。

1. **状態変更を伴うアクションが存在する**(メール変更、パスワード変更、送金、権限変更など、サーバ側の状態を変えるリクエスト)
2. **リクエストの正当性判定がCookie(セッションCookie)だけに依存している**——つまりサーバは「このリクエストにセッションCookieが付いているか」しか見ておらず、「このリクエストが本当にそのユーザーの意図した操作か」を別の方法で確認していない
3. **リクエストのパラメータをすべて攻撃者が予測・構築できる**(ワンタイムトークンのような、攻撃者が知り得ない値がリクエストに含まれていない)

ここで理解すべき核心は、**ブラウザはCookieを「送信先のオリジンに紐付けて自動的に付与する」仕組みを持っている**という点である。`<form>`タグでのPOST送信であれ、`<img>`タグでのGET送信であれ、ブラウザはユーザーがそのサイトに対して保存しているCookie(セッションCookieを含む)を、リクエスト送信時に自動的にHTTPヘッダへ添付する。これはSame-Origin Policy(同一オリジンポリシー、あるオリジンのスクリプトが別オリジンのリソースに自由にアクセスすることを制限する仕組み)の対象外の挙動である。Same-Origin Policyは「レスポンスの読み取り」を制限するものであり、「リクエストの送信」自体は制限しない。したがって、攻撃者のサイトに置かれたHTMLフォームが正規サイトへPOSTリクエストを送信すること自体はブラウザに許可されており、そのリクエストには被害者のセッションCookieが自動的に同梱される。サーバ側がCookie以外の検証手段(CSRFトークン、Origin/Refererヘッダ検証、SameSite属性など)を持たない限り、このリクエストは「本人が意図的に送った正規のリクエスト」と区別がつかない。

この「送信は許可されるが読み取りは許可されない」という非対称性こそが、CSRFという脆弱性クラスが存在する根本原理である。逆に言えば、CSRF対策のほとんど(トークン検証、SameSite Cookie、Referer/Origin検証)は、すべてこの非対称性を埋めるための後付けの防御機構にすぎない。

### 3. Lab: CSRF vulnerability with no defenses(防御なしCSRF)

このラボは、CSRFの最も基本形——防御機構が一切実装されていないケース——を扱う。

> 出典: Lab: CSRF vulnerability with no defenses — https://portswigger.net/web-security/csrf/lab-no-defenses

#### 3.1 ラボのシナリオと脆弱な処理

ラボにはユーザー`wiener`(パスワード`peter`)でログインする。マイアカウントページにはメールアドレス変更機能があり、内部的には次のようなリクエストが発行される。

```
POST /my-account/change-email HTTP/1.1
Host: YOUR-LAB-ID.web-security-academy.net
Cookie: session=...
Content-Type: application/x-www-form-urlencoded
Content-Length: 30

email=wiener%40normal-user.net
```

このエンドポイントの実装上の問題は、リクエストの正当性判定材料が**セッションCookieのみ**である点にある。CSRFトークンのような、リクエストごとに発行され照合される値が存在しない。つまりサーバ側のロジックを擬似的に書くと次のようになっている。

```
if session_cookie is valid:
    update email of that user to the "email" parameter
```

ここには「このPOSTがユーザー自身の意図した操作かどうか」を確認するステップが存在しない。攻撃者は`email`パラメータの値を完全に予測・指定できるため、あとは被害者のブラウザにこのPOSTを送信させればよいだけである。

#### 3.2 攻撃リクエストの再現(HTMLフォーム)

攻撃者は、被害者が訪問しそうな別サイト(攻撃者が用意したサイト)に、次のような自動送信フォームを設置する。

```html
<html>
  <body>
    <form action="https://YOUR-LAB-ID.web-security-academy.net/my-account/change-email" method="POST">
      <input type="hidden" name="email" value="pwned@evil-user.net" />
    </form>
    <script>
      document.forms[0].submit();
    </script>
  </body>
</html>
```

この仕組みを一行ずつ確認する。

- `<form action="...">`: 送信先を正規サイトの脆弱なエンドポイントに固定する。攻撃者は正規サイトのオリジンへリクエストを送るだけであり、正規サイトの認証情報(セッションCookie)を盗む必要はない——ブラウザが自動的に付けてくれるからである。
- `<input type="hidden" name="email" value="pwned@evil-user.net">`: 変更後のメールアドレスを攻撃者が指定する隠しフィールド。ユーザーには見えない。
- `document.forms[0].submit()`: ページ読み込み直後にJavaScriptでフォームを自動送信する。ユーザーのクリックなどのアクションを一切要求しない、いわゆる「ゼロクリックCSRF」の形である。

被害者がこのHTMLをブラウザで開いた第間、ブラウザは`YOUR-LAB-ID.web-security-academy.net`宛のPOSTリクエストを生成し、その際に被害者が保持している当該ドメインのセッションCookieを自動的に添付する。サーバ側は「有効なセッションCookieが付いたPOSTリクエスト」として処理し、メールアドレスを書き換えてしまう。この後の典型的な悪用パターンは、変更したメールアドレス宛にパスワードリセットリンクを送らせ、アカウントを完全に乗っ取ることである(本教科書ではその後続の乗っ取り手順は防御目的の解説対象外とし、扱わない)。

#### 3.3 Burp Suiteを使ったPoC生成の型

手作業でHTMLを書く代わりに、Burp SuiteにはリクエストからワンクリックでCSRF PoCを生成する機能が用意されている。この機能を使う手順は次の型に集約できる。

1. Burpのプロキシ(Proxy)でメールアドレス変更フォームを実際に送信し、対応するHTTPリクエストを`Proxy > HTTP history`で捕捉する。
2. そのリクエストを右クリックし、`Engagement tools > Generate CSRF PoC`(Burp Suite Professionalの機能)を選択する。
3. 生成されたHTMLのオプションで「Include auto-submit script」(自動送信スクリプトを含める)を有効にする。
4. 生成されたPoCを`Test in browser`でその場でテストするか、コピーしてExploit Server(PortSwiggerが提供する攻撃配信用サーバ)の`Body`欄に貼り付ける。
5. Exploit Serverの`Store`でホストし、`Deliver exploit to victim`で被害者(ラボのシミュレートされたユーザー)にリンクを配送する。

Burp Suite Community Edition(無償版)にはこの自動生成機能が無いため、前節で示したようなテンプレートを手動で作成し、`action`属性とパラメータ値だけを対象リクエストに合わせて書き換える形になる。この「テンプレートの雛形を覚えて対象ごとに書き換える」やり方こそが、CSRF PoC作成における最も基本的な型である。

> ⚠️ **未取得の資料**: 「System Weakness: PortSwigger Web Security Academy CSRF Lab #1 walkthrough」(https://systemweakness.com/portswigger-web-security-academy-csrf-lab-1-9e6772f8f070 )は自動取得できませんでした(理由: HTTP 403 Forbiddenが返却され、ページ本文を取得できなかったため)。以下のURLからご自身で直接ご覧ください: https://systemweakness.com/portswigger-web-security-academy-csrf-lab-1-9e6772f8f070
>
> (以下は未取得資料の補足として、同種の複数の公開ウォークスルー記事の内容を踏まえた一般知識に基づく解説です)本ラボの一般的な攻略記事群は、おおむね上記3.1〜3.3の流れ——ログイン、脆弱なメール変更リクエストの捕捉、Burp CSRF PoC Generatorによる生成(またはCommunity Editionでの手動テンプレート作成)、Exploit Serverへの格納と配信——を、スクリーンショット付きで追う構成になっている。技術的な要点として繰り返し強調されているのは、(a) このエンドポイントがCSRFトークンもRefererチェックもSameSite制限も持たない「最弱形」であること、(b) `document.forms[0].submit()`によるゼロクリック自動送信が成立の鍵であること、(c) 検証にはBurpのProxyでリクエストの構造(パラメータ名・Content-Type)を正確に把握する必要があること、の3点である。これらはいずれも本節の3.1〜3.3で既に技術的に説明済みであり、内容の重複はない。

#### 3.4 なぜこのPoCが「最小限」で機能するのか

このPoCが極めて短いコードで成立する理由を、ブラウザとHTTPの仕様レベルで補足する。

- **フォーム送信はクロスオリジンでも許可される**: `<form>`要素の`action`は任意のオリジンを指定でき、ブラウザはこれをブロックしない。ブロックされるのは「レスポンスをJavaScriptから読み取る」行為(Fetch APIのCORSなど)であり、「リクエストを送る」行為自体はブロック対象ではない。
- **Content-Typeが単純リクエストの範囲に収まる**: `<form>`のデフォルト`enctype`は`application/x-www-form-urlencoded`であり、これはCORSにおける「プリフライト不要な単純リクエスト」の条件を満たす。そのためブラウザはOPTIONSでの事前確認(プリフライトリクエスト)を行わず、即座に本リクエストを送信する。これがCSRFにおいてPOSTベースの攻撃が(GETと並んで)非常に一般的である理由の一つである。
- **Cookieはオリジン単位で自動送信される**: `SameSite`属性が指定されていないCookie(あるいは`SameSite=None`)は、クロスサイトの文脈からのトップレベルナビゲーションやフォーム送信でも送信される。ラボの環境ではこの属性による制限が設定されていないため、Cookieがそのまま漏れなく送信される。

これら3つの仕様(フォーム送信のオリジン非制限、単純リクエストのプリフライト免除、Cookieの自動添付)が組み合わさることで、攻撃者は認証情報を一切知らずに、被害者の権限でリクエストを「代理送信」できてしまう。

### 4. PoC生成の型を一般化する

ここまでの内容を、任意の対象に応用できる汎用的なチェックリストとして整理する。

1. **対象リクエストをキャプチャする**: プロキシツール(Burp等)で、状態変更を伴う操作(メール変更、パスワード変更、設定変更、送金など)のリクエストをそのままの形(メソッド、パス、パラメータ、Content-Type)で記録する。
2. **正当性の担保が何に依存しているかを特定する**: レスポンスやリクエストの中にCSRFトークンらしきフィールド(`csrf_token`、`_token`、`authenticity_token`等)が無いか、Cookieの`SameSite`属性がどう設定されているか、Refererヘッダを検証していそうな挙動がないかを確認する。これらが一つも見当たらなければ「防御なし」の可能性が高い。
3. **リクエストと同型のPoCを構築する**: GETであれば`<img src="...">`や`<a href="...">`+自動クリック、POST(urlencoded)であれば`<form>`+自動送信スクリプト、JSON POSTであればXHR/Fetchによる送信(ただしContent-Typeによってはプリフライトが発生し得るため、`enctype`や`Content-Type`ヘッダの扱いを慎重に確認する)といったように、元のリクエストの形式に合わせてPoCの送信手段を選ぶ。
4. **自動送信の仕組みを組み込む**: `onload`やインラインの`<script>`で`submit()`を呼び出し、被害者の操作を要求しない形にする(ユーザーのクリックを必要とする形にすることも可能だが、実証としてはゼロクリックの方が影響を明確に示しやすい)。
5. **配送経路を用意する**: 学習環境ではExploit Server、実際の診断では許可された範囲のホスティング環境を用いる。本教科書は防御目的の学習を対象とするため、実在サービスや無許可の本番環境に対してこの種のPoCを配信する行為は対象外であり、行ってはならない。

この型を身につけておくと、後続の章で扱う「トークンはあるがセッションに紐付いていない」「SameSite=Laxだが仕様上バイパス可能」といった、より複雑な防御回避のケースでも、「まず正常なリクエストの構造を把握し、PoCの送信手段をその構造に合わせて選ぶ」という基本姿勢がそのまま活きてくる。逆に言えば、防御が破られるすべてのケースは、この最も単純な「防御なし」のPoCに、検証をすり抜けるための1〜2手順(正しいトークン値の入手、SameSite制限を回避する送信経路の選択など)が追加されただけの派生形として理解できる。

### まとめ

- CSRFは「ブラウザがCookieをオリジン単位で自動送信する」という仕様と、「サーバがCookieの存在だけを正当性の根拠にしている」という実装上の弱点が組み合わさって成立する。
- 「防御なしCSRF」ラボは、CSRFの成立条件を最も単純な形で観察できる基準点であり、ここでのPoC構築の型(リクエストのキャプチャ→送信手段の選定→自動送信の実装)を理解することが、後続の防御回避パターンを学ぶ土台になる。
- Burp SuiteのCSRF PoC Generatorは、キャプチャしたリクエストから自動送信フォームを生成する補助ツールであり、Community Editionでは同等のテンプレートを手動で作成する必要がある。
- PoCが成立するかどうかは、対象のContent-Typeがプリフライト不要な「単純リクエスト」に該当するか、CookieのSameSite属性がどう設定されているかに強く依存する。この2点は次章以降で扱うSameSiteバイパスやトークン検証不備の理解にも直結する。

## CSRFリファレンスとテスト手法

本節では、CSRF（Cross-Site Request Forgery、クロスサイトリクエストフォージェリ）の実戦的なペイロード集・攻撃バリエーション・体系的なテスト手順を、3つの一次資料から整理する。前節までで扱った「なぜCookieが自動送信されるのか」という基礎理論を土台に、ここでは「実際に手を動かすときにどのリクエストをどう作るか」「どのようなアプリケーション実装がCSRF対策を無効化してしまうのか」という実務的な視点にフォーカスする。すべて防御・診断目的の解説であり、無許可の本番環境への適用は行わないこと。

### 1. PayloadsAllTheThings: CSRF ― PoCペイロード集

PayloadsAllTheThingsのCSRFセクションは、実際に攻撃者が使うPoC（Proof of Concept、脆弱性の実在を証明する最小限の攻撃コード）のテンプレート集としてよく参照される。ここでの要点は「攻撃対象のHTTPメソッドやContent-Typeに応じて、被害者のブラウザにどうやって“意図せぬ自動送信”をさせるか」である。

#### GETリクエストへのCSRF（ユーザー操作不要）

状態変更操作がGETで実装されている場合、被害者は画像を読み込むだけで攻撃が成立する。

```html
<img src="http://www.example.com/api/setusername?username=CSRFd">
```

**仕組み**: `<img>` タグの `src` 属性はブラウザによって自動的にHTTPリクエストとして解決される。ブラウザは「このリクエストが正規のナビゲーションか、攻撃者が仕込んだものか」を区別する手段を持たないため、対象サイトのCookie（セッションID等のambient credential、明示的な指定なしに自動付与される認証情報）をそのまま付けてリクエストを送ってしまう。GETは元来「副作用のない参照系操作」に使うべきというHTTPの設計思想（冪等性・安全性の原則）に反してGETで状態変更APIを作ると、この種の攻撃に対して構造的に脆弱になる。

#### POSTリクエストへのCSRF（自動送信フォーム）

POSTは`<img>`だけでは送れないため、隠しフォームを自動送信させる手法が使われる。

```html
<form id="autosubmit" action="http://www.example.com/api/setusername" enctype="text/plain" method="POST">
 <input name="username" type="hidden" value="CSRFd" />
</form>
<script>
 document.getElementById("autosubmit").submit();
</script>
```

**なぜ `enctype="text/plain"` が使われるのか**: 通常のHTMLフォームは `application/x-www-form-urlencoded` または `multipart/form-data` でエンコードされるが、`text/plain` を指定すると、フォームの `name=value` の組がほぼそのままの平文としてボディに送られる。攻撃者はこの性質を利用して、サーバー側が期待するJSON構造に近い文字列を `name` 属性に埋め込み、`Content-Type: text/plain` のリクエストとしてJSON APIエンドポイントに送りつける（詳細は後述の「JSON CSRF」を参照）。また、`<form>` はHTMLの標準機能であるため、CORSのプリフライト（事前確認リクエスト）の対象にならない「単純リクエスト（simple request）」の条件を満たしやすく、クロスオリジンからでも制約なく送信できる点が攻撃を容易にしている。

> 出典: PayloadsAllTheThings: Cross-Site Request Forgery — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Cross-Site%20Request%20Forgery

#### ファイルアップロードを伴うCSRF

同資料では、`DataTransfer` APIを使ってJavaScript側でファイルオブジェクトを動的に生成し、`<input type="file">` にプログラム的にセットしてフォームを自動送信する手法も紹介されている。通常、ブラウザはセキュリティ上の理由から `input[type=file].value` へのJavaScriptからの直接代入を禁止しているが、`DataTransfer` オブジェクトを介して `FileList` を構築し `files` プロパティに割り当てることで、ユーザーの明示的なファイル選択操作なしにファイルアップロードを伴うリクエストを合成できる場合がある。これはブラウザやAPI仕様のバージョンによって挙動が変わりうる領域であり、対象ブラウザのエンジン（Chromium/Firefox等）とバージョンごとに検証が必要である。

#### JSON CSRF（Content-Type偽装）

多くのモダンAPIは `application/json` を前提に実装されているが、CSRF対策としてContent-Typeを検証していないと、以下のように `text/plain` を使ってJSONに酷似したペイロードを送り込める。

```html
<script>
var xhr = new XMLHttpRequest();
xhr.open("POST", "http://www.example.com/api/setrole");
xhr.setRequestHeader("Content-Type", "text/plain");
xhr.send('{"role":admin}');
</script>
```

**仕組み**: `XMLHttpRequest` や `fetch` で `Content-Type` を `text/plain`（または `application/x-www-form-urlencoded`、`multipart/form-data` のいずれか）に指定すると、CORSの「単純リクエスト」の条件に該当し、プリフライト（`OPTIONS`）が発生しない。つまりブラウザは事前許可を取らずに直接リクエストを送信してしまう。サーバー側が「Content-Typeがtext/plainでも、ボディをJSONとしてパースできればJSONとして扱う」という寛容な実装（多くのWebフレームワークのデフォルト挙動、あるいはリバースプロキシの設定次第でこうなる）になっていると、このリクエストはAPIに正常なJSONとして受理されてしまう。これがJSON APIであってもCSRF対策が必要な理由である。「JSONだから安全」という誤解は非常によくある設計ミスであり、必ずCSRFトークンやSameSite属性など別レイヤーの防御を併用する必要がある。

`withCredentials = true` を設定した複雑なリクエスト（カスタムヘッダー付き等）はCORSのプリフライトを発生させるが、プリフライトはあくまで「レスポンスを読み取れるかどうか」を制御するものであり、**リクエスト自体はプリフライトの許可の有無にかかわらず対象サーバーに到達し処理される**（`no-cors`モードのfetchと同様の考え方）。この「レスポンス閲覧の可否」と「副作用の発生」を混同しないことが、CORSとCSRFの関係を理解するうえで最重要のポイントである。

#### ツール: CSRF PoC自動生成

PayloadsAllTheThingsではBurp Suiteの「Generate CSRF PoC」機能や、`csrf-poc-generator` のようなスタンドアロンツールも紹介されている。これらは捕捉したHTTPリクエスト（メソッド・パラメータ・Content-Type）から、上記のような自動送信HTMLを機械的に生成するもので、診断作業を効率化する。

> 出典: PayloadsAllTheThings: Cross-Site Request Forgery — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Cross-Site%20Request%20Forgery

---

### 2. HackTricks: CSRF ― 攻撃手法の網羅的まとめ

HackTricksのCSRFページは、上記の基本形に加えて、実務で遭遇する「CSRF対策の実装ミスをどう見抜き、どう突破するか」という応用パターンを豊富に扱っている。

#### 前提条件の整理

HackTricksはCSRFが成立する3条件を明確に定義している。

1. **価値のある操作が存在すること**（パスワード変更、権限昇格、送金など、攻撃者に利益のある状態変更）
2. **ambient credentialが自動的に付与されること**（Cookie、Basic認証情報など、ブラウザが「勝手に」付けてくれる認証情報）
3. **予測不可能なパラメータが欠如していること**（CSRFトークンのような、攻撃者が事前に知り得ない値がリクエストに含まれていない）

この3条件は診断のチェックリストとしてそのまま使える。1つでも欠ければCSRFは成立しない。

#### 様々なHTMLタグを使ったGET型CSRF

```html
<img src="http://example.com?param=VALUE" style="display:none" />
<iframe src="http://example.com/action"></iframe>
<script src="http://example.com/endpoint"></script>
```

`<embed>`、`<audio>`、`<video>`、`<source>`、`<link>`、`<object>`、`<bgsound>`、`<track>`、`<input type="image">` など、外部リソースを読み込む属性を持つタグは軒並みGETリクエストのトリガーになりうる。これはWAF（Web Application Firewall）やCSPが `<img>` や `<iframe>` だけをブロックしていても、他のタグで迂回されるケースがあることを意味する。診断時は特定タグのみでの検証で終わらせず、複数のタグでの再現性を確認すべきである。

#### 隠しiframe経由のPOST（レスポンスを画面遷移させない）

```html
<iframe style="display:none" name="csrfframe"></iframe>
<form method="POST" action="/change-email" id="csrfform" target="csrfframe">
  <input type="hidden" name="email" value="attacker@example.com" />
</form>
<script>document.forms[0].submit()</script>
```

**仕組み**: `target` 属性で送信先を非表示iframeに指定することで、フォーム送信後のページ遷移が被害者の閲覧中のページに影響しない。被害者は攻撃が実行されたことに気づきにくく、これがCSRFの「静かな攻撃」としての性質を強めている。

#### `fetch`/`XMLHttpRequest`によるPOST

```javascript
var xhr = new XMLHttpRequest();
xhr.withCredentials = true;
xhr.open("POST", "http://example.com/change-email");
xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
xhr.send("email=attacker@example.com");

// fetch版
fetch("http://example.com/change-email", {
  method: "POST",
  credentials: "include",
  body: new URLSearchParams({email: "attacker@example.com"})
});
```

`credentials: "include"`（またはXHRの`withCredentials = true`）を指定しない限り、クロスオリジンの`fetch`/XHRはデフォルトでCookieを送らない。これはCSRF対策として意図された挙動ではなく、あくまでクロスオリジン通信の既定動作だが、攻撃者は明示的にこのフラグを立てることでCookieを含めた攻撃リクエストを組み立てる。逆に言えば、開発者が誤って `credentials: "include"` を必要以上に広いオリジンに対して許可するCORS設定（次節で扱う）と組み合わせると、レスポンスの窃取まで可能になる場合がある。

#### トークン窃取・リプレイ攻撃（同一オリジン内で完結する変種）

```javascript
function getTokenAndSubmit() {
  var xhr = new XMLHttpRequest();
  xhr.responseType = "document";
  xhr.withCredentials = true;
  xhr.open("GET", "http://example.com/form", true);
  xhr.onload = function() {
    var token = xhr.response.getElementById("token").value;
    submitWithToken(token);
  };
  xhr.send(null);
}
```

このパターンは、CORSが正しく設定されていれば本来レスポンスを読み取れないはずだが、対象サイトのCORS設定が緩い（`Access-Control-Allow-Origin` にワイルドカードや広すぎるオリジンを許可し、かつ `Access-Control-Allow-Credentials: true` を返す設定ミス）場合に成立する、CSRFとCORS誤設定の複合攻撃である。CSRFトークンによる防御が「トークンの値自体を盗まれる」ことで無力化される典型例であり、CSRF対策とCORS設定は独立ではなく相互に依存する防御であることを示している。

#### 対策バイパス1: POST→GETへのメソッド変換

多くの実装は「CSRFトークンの検証をPOSTのときだけ行う」という不完全な対策をしている。

**元のPOST（トークンあり）:**
```http
POST /action HTTP/1.1
Content-Type: application/x-www-form-urlencoded

__csrf_token=abc123&action=change_email
```

**GETへの変換によるバイパス:**
```http
GET /action?action=change_email&__csrf_token=abc123 HTTP/1.1
```

サーバー側フレームワークが `$_REQUEST`（PHPの例。GET・POST・Cookieのパラメータを区別なくマージして扱うスーパーグローバル変数）のようにメソッドを問わずパラメータを取得する実装になっていると、同じハンドラがGETでも呼び出せてしまう。この場合、トークンごと省略してGETリクエストのみで攻撃が成立することすらある。**教訓**: 状態変更エンドポイントはGETで到達可能にしてはならず、CSRF対策はHTTPメソッドに依存せず全リクエストパスに対して行う必要がある。

#### 対策バイパス2: トークン未検証・空文字許容

```http
POST /admin/users/role HTTP/2
Host: example.com
Content-Type: application/x-www-form-urlencoded

username=guest&role=admin&csrf=
```

サーバーが「csrfパラメータが**存在するかどうか**」だけを見ていて、値の正当性（セッションに紐づく期待値と一致するか）を検証していない実装だと、空文字や適当な文字列でも通ってしまう。これは「パラメータの有無チェック」と「値の妥当性チェック」を混同した典型的な実装バグである。

対応する自動送信PoC:
```html
<form action="https://example.com/admin/users/role" method="POST">
  <input type="hidden" name="username" value="guest" />
  <input type="hidden" name="role" value="admin" />
  <input type="hidden" name="csrf" value="" />
</form>
<script>history.pushState('', '', '/'); document.forms[0].submit();</script>
```

`history.pushState('', '', '/')` は、フォーム送信前にブラウザのアドレスバー表示とReferer/Originのふるまいに影響を与えず(実際にはこの呼び出し自体はナビゲーション履歴の書き換えであり、直接的なReferer偽装ではないが、後述の「Refererバイパス」のテクニックと組み合わせて使われることが多い)、被害者に違和感を与えないためのUX偽装として使われる。

#### 対策バイパス3: トークンがセッションに紐付いていない

CSRFトークンが「セッションごとに一意」ではなく「サーバー全体で共有されるグローバルなプール」から発行されている実装ミスがある。この場合:

1. 攻撃者が自分自身のアカウントでログインする
2. 自分に対して発行された有効なCSRFトークンを取得する
3. そのトークンを被害者に対する攻撃リクエストに埋め込む

サーバー側はトークンの値の正当性しか見ておらず「そのトークンが本当にこのリクエストを送っているユーザーのセッションに属しているか」を確認していないため、これが通ってしまう。**正しい実装**は、トークンをサーバー側のセッションストア（またはトークン自体にセッションIDを暗号署名で埋め込む方式）と紐付け、検証時に必ずリクエスト元のセッションと突き合わせることである。

#### 対策バイパス4: HTTPメソッドオーバーライド

一部のWebフレームワーク（Rails、Laravelなど）は、実際のHTTPメソッドをPOSTボディやヘッダーで上書きできる機能（RESTfulでないブラウザのフォームがPUT/DELETEを擬似的に送るための仕組み）を持つ。

```http
POST /users/delete HTTP/1.1
Host: example.com
Content-Type: application/x-www-form-urlencoded

username=admin&_method=DELETE
```

CSRF対策が「POSTだけ」「特定のメソッドだけ」に適用されていて、`_method` パラメータや `X-HTTP-Method-Override` などのオーバーライドヘッダーを考慮していない場合、見かけ上は保護対象外のメソッド（DELETE等）としてルーティングされるが、実際のトランスポート層はブラウザから送信可能な単純なPOSTのままなので、CSRF攻撃が成立してしまう。

```html
<form method="POST" action="/users/delete">
  <input name="username" value="admin">
  <input type="hidden" name="_method" value="DELETE">
  <button type="submit">Delete User</button>
</form>
```

#### 対策バイパス5: カスタムヘッダートークン検証の抜け穴

`X-CSRF-Token` のようなカスタムHTTPヘッダーでトークンを送らせる方式は、HTMLフォーム単体ではヘッダーを付与できない（`<form>`要素にはカスタムヘッダーを設定する属性がない）ため、比較的強固な対策とされる。しかし以下の実装漏れがあると突破される。

- ヘッダー自体が**存在しない**リクエストを許可してしまう（「ヘッダーがあれば検証、なければスキップ」というフェイルオープンな実装）
- ヘッダーの**値の長さだけ**を見て中身を検証していない

これらはいずれも「防御機構は入れたが、検証ロジックが甘い」という、実装レビューで見抜くべき典型パターンである。

#### 対策バイパス6: Content-Type偽装によるプリフライト回避

```html
<form id="form" method="post" action="https://example.com/api" enctype="text/plain">
  <input name='{"action":"' value='", "target": "admin"}' />
</form>
<script>form.submit()</script>
```

PayloadsAllTheThingsのJSON CSRFと同じ原理だが、HackTricksでは`enctype="text/plain"`によって `name` と `value` がどう連結されてボディになるかまで踏み込んで説明している。フォームの各input要素は `name` + `=` + `value` の形でボディに連結されるため、`name` 属性自体にJSON構造の前半、`value`属性に後半を仕込むことで、パーサーが許容する範囲で実質的なJSONペイロードを合成できる。

#### 対策バイパス7: Referer/Origin検証の回避

Refererヘッダーを検証してCSRFを防ぐ実装は珍しくないが、以下のように回避されうる。

**Refererの完全な抑制:**
```html
<meta name="referrer" content="never">
```
`Referrer-Policy`（HTMLの`<meta>`タグやHTTPレスポンスヘッダーで設定可能）を`no-referrer`相当に設定すると、リクエストにRefererヘッダー自体が付かなくなる。サーバー側が「Refererが**ない**場合は許可する」というフェイルオープンな実装だと、これだけで検証を素通りできる。

**正規表現チェックの回避（部分一致の悪用）:**
```html
<meta name="referrer" content="unsafe-url" />
<form action="https://victim.com/change-email" method="POST">
  <input type="hidden" name="email" value="attacker@example.com" />
</form>
<script>
  history.pushState("", "", "?victim.com");
  document.forms[0].submit();
</script>
```

`history.pushState` で現在のURLのクエリ文字列部分に `?victim.com` を追加してからフォームを送信すると、送信元ページのURL（したがってReferer/Originに反映される値）に `victim.com` という文字列が部分文字列として含まれることになる。サーバー側の検証が `Referer` に `victim.com` という文字列が「含まれているか」を正規表現やstartsWith的な緩い判定で見ているだけだと、これを騙し通せる。**正しい検証**は、Refererを完全なURLとしてパースし、そのオリジン（スキーム＋ホスト＋ポート）が許可リストと厳密一致するかを確認することである。文字列の部分一致・前方一致による判定は原理的に迂回可能と考えるべきである。

#### 対策バイパス8: HEADメソッドによるGET制限の迂回

GETメソッドへのアクセス制限のみを実装しているエンドポイントに対し、一部のWebフレームワーク/Webサーバーの実装ではHEADリクエストが内部的にGETハンドラーにルーティングされ、レスポンスボディだけが省略される。

```http
HEAD /restricted-action?param=value HTTP/1.1
```

HTTPの意味論上HEADは副作用を持たないはずだが、サーバー実装がGETハンドラをそのまま流用していて、そのハンドラ内で状態変更処理を行っていた場合（設計自体の誤り）、HEADリクエストでも状態変更が実行されてしまう可能性がある。

#### CSPT2CSRF: クライアントサイドパストラバーサル経由のCSRF

比較的新しい攻撃クラスとして、SPA（Single Page Application）がURLパラメータやフラグメント、アップロードされたJSONの値を検証なしにAPIパスの一部として組み込んでいる場合に発生する。

```javascript
// 脆弱なパターン: ユーザー入力がfetchのパスに直接連結される
let userId = new URLSearchParams(location.search).get('id');
fetch(`/api/users/${userId}/promote`, {
  method: "POST",
  credentials: "include"
});
```

攻撃者は `id` パラメータに `../../admin/elevate` のようなパストラバーサル文字列を仕込んだURLを被害者に踏ませることで、クライアントサイドJavaScriptに意図しないAPIパスを組み立てさせ、結果的にCSRFトークンの検証をすり抜けたり、本来到達不能な管理APIを呼び出させたりする。

```
https://victim.com/page?id=../../admin/elevate
```

これは伝統的なCSRFとサーバーサイドのパストラバーサルの中間に位置する比較的新しい攻撃パターンであり、フロントエンドの実装がAPIパスの構築にユーザー入力を許してしまっている設計そのものが根本原因である。診断時は「サーバー側だけでなく、クライアントサイドのルーティング/fetch呼び出しロジック」も監査対象に含める必要がある。

#### SameSite=Laxの限界

```html
<a href="https://victim.com/change-email?email=attacker@example.com">Click here</a>
```

`SameSite=Lax`（多くの主要ブラウザで2020年前後からデフォルト値として採用されている）は、クロスサイトの「トップレベルナビゲーション」かつ「安全なメソッド（実質GET）」であるリンククリックやフォームのGET送信ではCookieを送信してしまう。つまり、状態変更操作をGETに実装しているアプリケーションは、SameSite属性だけでは守られない。SameSite属性はあくまで多層防御の1枚であり、「CSRFトークン不要」を意味しない。

#### ローカル/内部サービスに対するCSRF

```html
<iframe name="sink" hidden></iframe>
<form id="f" action="http://127.0.0.1:8080/admin/restart"
      method="POST" target="sink">
  <input type="hidden" name="action" value="restart_service">
</form>
<script>document.getElementById("f").submit()</script>
```

開発者向けの管理画面やローカルAPI（`127.0.0.1`、`localhost`、`0.0.0.0`宛て）が「ローカルホストからのアクセスだから安全」という誤った前提で認証を省いている場合、被害者のブラウザ経由でこれらの内部サービスに到達できてしまう。ブラウザの視点では「ページが127.0.0.1宛てにリクエストを送っているだけ」であり、それが被害者のPC上で動くDockerのAPIやElectronアプリのローカルサーバーであっても区別しない。**教訓**: バインドアドレスがループバックであることは認証の代替にならない。

#### 格納型CSRF（Stored CSRF）

リッチテキストエディタがHTMLタグの入力を許可している場合、攻撃者が`<img>`タグ経由のCSRFペイロードをコンテンツとして保存させ、後から閲覧した別ユーザーのブラウザ上で自動発火させる手法。

```html
<img src="https://example.com/account/settings?newEmail=attacker@example.com" alt="">
```

トークンがグローバル（セッション非依存）である場合、投稿時点で攻撃者が知っている自分のトークンをそのまま埋め込んでおけば、閲覧した被害者のセッションでもそのトークンが「有効な値」として通ってしまう（前述の「トークンがセッションに紐付いていない」問題と同根）。

#### ログインCSRF + 格納型XSSの連鎖

```html
<form action="https://example.com/login" method="POST">
  <input type="hidden" name="username" value="attacker@example.com" />
  <input type="hidden" name="password" value="StrongPass123!" />
</form>
<script>
  history.pushState('', '', '/');
  document.forms[0].submit();
  setTimeout(() => location = 'https://example.com/profile', 2000);
</script>
```

「ログインフォーム自体にCSRF対策が施されていない」というのは軽視されがちだが、被害者を攻撃者が用意したアカウントへ強制的にログインさせることで、被害者の入力（検索履歴、フォーム投稿など）を攻撃者のアカウント配下に記録させたり、そのアカウントに格納型XSSを仕込んでおいて被害者のブラウザ上でJavaScriptを実行させたりする複合攻撃の起点になる。ログインエンドポイントもCSRF対策の対象に含めるべき理由がここにある。

> 出典: HackTricks: CSRF (Cross Site Request Forgery) — https://hacktricks.wiki/en/pentesting-web/csrf-cross-site-request-forgery.html

#### まとめとツール

HackTricksは最後に対策として、SameSite Cookie、CORSポリシー、パスワード再確認/CAPTCHAなどのユーザー検証、Referer/Origin検証（許可リストとの厳密一致、両方欠落時はデフォルト拒否）、セッションに紐付いたCSRFトークンを挙げ、診断・攻撃補助ツールとして XSRFProbe（CSRF監査・悪用の自動化ツール）、csrf-poc-generator、Burp Suite Professional の PoC生成機能、eval-villain（`fetch`/XHRなどのsinkを計装して観測するブラウザ拡張）、CSPTBurpExtension（CSPT2CSRFのsourceとsinkを相関分析するBurp拡張）を紹介している。

---

### 3. OWASP WSTG: Testing for Cross Site Request Forgery ― 体系的テスト手順

OWASP Web Security Testing Guide（WSTG）v4.1のCSRFテスト項目（WSTG-SESS-05）は、ペイロードのバリエーションよりも「診断の進め方」に主眼を置いた資料である。ペネトレーションテストの現場でCSRFの有無をどう体系的に判定するかを定義している。

#### テスト目的

WSTGはテストの目的を明確に一文で定義している。

> 「ユーザーが意図していないリクエストを、そのユーザーに代わって開始できるかどうかを判定すること」

この定義のポイントは、「悪意あるコードが実行できるか」（XSS）ではなく「**意図しないリクエストを発生させられるか**」に焦点を絞っている点である。CSRFはコード実行の脆弱性ではなく、リクエストの真正性検証が欠落している設計上の欠陥として扱われる。

#### 診断のコアアプローチ: セッション管理方式の確認

WSTGはまず、対象アプリケーションのセッション管理が「クライアントサイドの値のみに依存しているか」を確認するよう指示する。具体的には、CookieやHTTP Basic認証の認証情報のように、**ブラウザが自動的に付与する**認証情報だけでセッションが維持されている場合、CSRFの土壌がある。一方、フォームベース認証（毎回のリクエストでアプリケーションレベルの秘密情報の入力を求める方式）はこの種の脆弱性を構造的に生まない、としている。これは前述のHackTricksの「ambient credential」の概念と対応しており、両資料が同じ原理を異なる言葉で説明していることが分かる。

#### GETリクエストの脆弱性判定

WSTGは、状態変更操作がGETで実装されている時点で「本質的に脆弱」とみなす。セッショントークンがCookieのみに存在する構成では、アプリケーションはリクエストが「正規のユーザー操作によるものか」「攻撃者が用意したリンク/画像経由のものか」を区別する手段を持たない。これは実装の巧拙の問題ではなく、GETでの状態変更設計そのものが原理的に区別不能性を生む、という指摘である。

#### POSTリクエストのテスト手順

WSTGはPOSTであっても手間がかかるだけで防御にはならないとし、具体的な攻撃HTMLのテンプレートを示している。

```html
<html>
<body onload='document.CSRF.submit()'>
<form action='http://targetWebsite/Authenticate.jsp' method='POST' name='CSRF'>
    <input type='hidden' name='name' value='Hacked'>
    <input type='hidden' name='password' value='Hacked'>
</form>
</body>
</html>
```

**手順**: このHTMLを攻撃者が管理する外部サイトに設置し、ソーシャルエンジニアリング（メールやチャットでのリンク送付など）で被害者に閲覧させる。`onload` イベントでフォームが自動送信されるため、被害者はページを開いた瞬間に気づかぬままリクエストを送信してしまう。この例は認証(Authenticate)エンドポイントを対象にしているが、これは「ログイン処理自体もCSRFの対象になり得る」ことを示す実例であり、HackTricksの「ログインCSRF」の項と符合する。

#### JSONベースアプリケーションのテスト

WSTGもPayloadsAllTheThings/HackTricksと同様、JSON APIに対しては`enctype`の偽装を使う。

```html
<form action='http://victimsite.com' method='POST' enctype='text/plain'>
    <input type='hidden' name='{"name":"hacked","password":"hacked","padding":"' value='something"}' />
</form>
```

このテンプレートは、`name`属性にJSONオブジェクトの開始部分（`{"name":"hacked","password":"hacked","padding":"`）を仕込み、`value`属性で残りの文字列（`something"}`）を補うことで、`text/plain`ボディとして送信されたときに全体が有効なJSON文字列として解釈されるよう設計されている。サーバー側がボディをJSONとしてパースする際に「多少余分なpaddingフィールドが混ざっていても、必要なフィールド（name, password）が取得できれば処理を続行する」という寛容な実装だと、この偽装JSONがそのまま処理されてしまう。3資料すべてがこの`enctype="text/plain"`偽装に言及していることから、JSON API特有のCSRF対策漏れが業界的に共通した弱点であることが裏付けられる。

#### 修復ガイダンス

WSTG自体は具体的な対策の実装詳細には踏み込まず、「OWASP CSRF Prevention Cheat Sheet」を参照するよう促している点が特徴的である。これはWSTGが「診断の仕方」に特化したガイドであり、対策の実装詳細は別のCheat Sheetシリーズに委ねるという役割分担がOWASPドキュメント群の設計思想であることを示している（実装レベルの防御手法は本教科書の別章・別資料で扱う）。

#### 推奨ツールと参考文献

WSTGが挙げる診断支援ツールは以下の通りである。

- **OWASP ZAP**: 無償のWebアプリケーション脆弱性スキャナ。CSRFトークンの有無や再利用可能性を自動検出する機能を持つ。
- **CSRF Tester**: CSRF専用の診断・PoC生成ツール。
- **Pinata-csrf-tool**: 同じくCSRF診断補助ツール。

参考文献としては、Peter W.による「Cross-Site Request Forgeries」の初期研究、Thomas Schreiberの「Session Riding」分析（CSRFの初期の呼称の一つ）、OWASPのCSRF FAQ、SANSによる複数POSTを連鎖させるCSRF攻撃の解説が挙げられている。これらは2000年代半ばにCSRFという攻撃概念が確立していく過程の一次資料であり、CSRFが決して新しい攻撃クラスではなく、20年近い歴史を持つ「枯れた」しかし今なお有効な脆弱性クラスであることを裏付けている。

> 出典: OWASP WSTG v4.1 — Testing for Cross Site Request Forgery — https://owasp.org/www-project-web-security-testing-guide/v41/4-Web_Application_Security_Testing/06-Session_Management_Testing/05-Testing_for_Cross_Site_Request_Forgery

---

### 4. 3資料の比較から見えるテスト・実装上の要点

最後に、3つの資料に共通して現れたポイントを診断チェックリストとして整理する。

| 観点 | 確認すべきこと |
|---|---|
| HTTPメソッド | 状態変更操作がGETで実装されていないか。CSRF対策がPOSTにしか適用されていないか |
| メソッドオーバーライド | `_method`パラメータや`X-HTTP-Method-Override`ヘッダーで検証済みメソッドを迂回できないか |
| Content-Type | `text/plain`や`application/x-www-form-urlencoded`で偽装したJSON類似ペイロードを受理してしまわないか |
| トークン検証 | トークンの「存在確認」だけで「値の正当性」「セッションとの紐付け」を検証していないケースがないか |
| Referer/Origin | 完全一致による許可リスト方式か、それとも部分一致・正規表現で回避可能な緩い検証になっていないか。ヘッダー欠落時の挙動はフェイルクローズ（拒否）か |
| SameSite | Lax設定に依存しすぎて、GETベースの状態変更操作を見落としていないか |
| ログイン/内部API | 認証エンドポイントやループバックアドレス宛ての管理APIもCSRF対策の対象に含まれているか |

これらはいずれも「対策を入れたつもりが、検証ロジックの甘さや設計上の見落としで実質的に無効化されている」というパターンであり、単に「CSRFトークンを実装したか」ではなく「実装がどこまで厳密か」を確認することが、実務上の診断における最重要ポイントである。


---

## ナビゲーション

[← 第1章 前提 — Cookie・オリジン・SameSiteの基礎](01-fundamentals.md)　｜　[📚 目次（ホーム）](index.md)　｜　[第3章 CSRFトークン・防御ロジックのバイパス →](03-token-bypass.md)
