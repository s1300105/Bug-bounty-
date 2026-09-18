# HTML5 セキュリティ実践編 — 診断チェックリスト・sandbox・セキュリティヘッダ・Reverse Tabnabbing・WebSocket 実装原則

> **この節で分かること**
> - OWASP HTML5 Security Cheat Sheet の推奨事項を「診断で何を見るか」に変換したチェックリストを使える
> - `iframe` の `sandbox` 属性が持つ全14トークンと、`allow-scripts`＋`allow-same-origin` によるサンドボックス脱出を説明できる
> - OWASP Secure Headers プロジェクトが推奨する「追加13件・削除90件」のヘッダを診断に使える
> - Reverse Tabnabbing が「2023年以降モダンブラウザで修正済み」であることを踏まえ、重大度を正しく判定できる
> - WebSocket 認証の根本原則（ブラウザが自動送信しないトークンを使う）が CSWSH をなぜ構造的に防ぐのかを説明できる

**元資料**: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html （原典は raw.githubusercontent の同内容 Markdown, commit `00f27a7` を取得済み。描画版サイトはエグレスポリシーで取得不可）
**関連する節**: 「HTML5 セキュリティ基礎編」（postMessage / CORS / Web Storage / Service Worker 本文。本節はその実践・補完編にあたる part 2）

---

## 1. この節の位置づけ

本節は OWASP HTML5 Security Cheat Sheet の「実践・補完編」である。基礎編（part 1）が postMessage、CORS、WebSocket、Server-Sent Events、Web Storage、Service Worker といった各 API の推奨事項を1つずつ解説したのに対し、本節は次の4つを扱う。

1. 基礎編で説明した推奨事項を、**診断（テスト）時に何を見るか**へ変換した一枚のチェックリスト表。
2. チートシート本文が**列挙を放棄している**（＝外部へ委譲している）情報の実体。具体的には `iframe sandbox` の全トークン、HTTP セキュリティヘッダの具体名、Reverse Tabnabbing の攻撃詳細、旧 WebSocket 実装原則の4つ。

チートシートは短いガイドであり、細部を WHATWG 仕様・MDN・OWASP の別プロジェクトへ委譲している。委譲先を読まないと推奨事項の半分が欠落する。本節はその委譲先を一次資料から取得して埋めたものである。

### 用語の最小限の前提

同一オリジンポリシー（Same-Origin Policy, SOP）とは、あるオリジン（scheme + ホスト + ポートの組）から読み込まれた文書やスクリプトが、別オリジンのリソースへ勝手にアクセスできないようにするブラウザの基本規則のこと。本節の `sandbox`、`opener`、CORS ヘッダはいずれもこの SOP を土台に「どこを緩めるか／締めるか」を制御する仕組みである。

---

## 2. 診断チェックリスト（原文の推奨事項の否定形）

チートシートは「安全に実装するための推奨事項リスト」である。診断側から見れば、**各推奨事項の否定形がそのままテスト項目**になる。たとえば「targetOrigin を明示せよ」は「targetOrigin が `*` になっていないか」というチェックに変換できる。

### 2.1 対応表

下表の各行は「危険な実装（アンチパターン）を見つけたら、正しい実装へ直す」という読み方をする。「原文の根拠」列は、基礎編で解説した各節を指す（捏造項目はない）。

| # | API / 機能 | 危険な実装（アンチパターン） | 正しい実装 | 原文の根拠 |
| --- | --- | --- | --- | --- |
| 1 | `postMessage`（送信） | 第2引数が `*` | 期待するオリジンを明示指定 | Web Messaging 1 |
| 2 | `postMessage`（受信） | `origin` 未検証 | `origin` を FQDN 完全一致で検証 | Web Messaging 2, 6 |
| 3 | `postMessage`（受信） | `indexOf(".owasp.org")!=-1` 等の部分一致 | 完全一致（`owasp.org.attacker.com` が通る） | Web Messaging 6 |
| 4 | `postMessage`（受信） | `data` を `innerHTML` / `eval()` へ | `textContent` を使う／データとしてのみ扱う | Web Messaging 4, 5 |
| 5 | `postMessage` | `data` の形式を信頼 | `data` に入力検証（送信側 XSS 1件で任意形式が来る） | Web Messaging 2, 3 |
| 6 | 埋め込みガジェット | 信頼できないコンテンツを素の iframe で | `sandbox` 属性（そもそも highly discouraged） | Web Messaging 7 / Sandboxed frames |
| 7 | CORS | `Access-Control-Allow-Origin: *` を機密URLに | 必要なURLにのみ、選別した信頼ドメインを許可 | CORS 2, 3 |
| 8 | CORS | `Origin` を無検証でエコー | allow-list 方式 | CORS 3 |
| 9 | CORS | CORS で CSRF 対策済みと考える | 別途 CSRF 対策を実施 | CORS 4 |
| 10 | CORS | プリフライトだけでアクセス制御 | `GET`/`POST` 単体でもアクセス制御 | CORS 5 |
| 11 | CORS | HTTPS オリジンからの平文 HTTP を受理 | 破棄する（mixed content） | CORS 6 |
| 12 | CORS | `Origin` ヘッダのみでアクセス制御 | アプリレベルのプロトコルで保護（ブラウザ外では偽装可） | CORS 7 |
| 13 | `XMLHttpRequest` | `open` の URL が未検証（特に絶対URL） | URL を検証 | CORS 1 |
| 14 | SSE | `EventSource` の URL が未検証 | same-origin 限定でも URL を検証 | SSE 1 |
| 15 | SSE | `event.data` を HTML/スクリプトとして評価 | データとして処理 | SSE 2 |
| 16 | SSE | `event.origin` 未検証 | 常にチェック、allow-list | SSE 3 |
| 17 | `localStorage` | セッションID・機密を保存 | 保存しない。Cookie + `httpOnly` を使う | Local Storage 1, 4, 7 |
| 18 | `localStorage` | 永続不要なのに localStorage | `sessionStorage`（タブを閉じるまで） | Local Storage 3 |
| 19 | `localStorage` | 同一オリジンに複数アプリ相乗り | 別サブドメインへ分離（パス分離は不可） | Local Storage 8 |
| 20 | `localStorage` | 読み出し値を信頼して DOM へ | untrusted source として検証 | Local Storage 5 |
| 21 | クライアントDB | Web SQL を使用 | 使わない（全主要ブラウザで削除、Chromium 119） | Client-side databases 1 |
| 22 | クライアントDB | IndexedDB に秘密を平文保存 | 保存しない。例外は non-extractable `CryptoKey` 等での暗号化 | Client-side databases 3 |
| 23 | クライアントDB | IndexedDB の内容を信頼 | untrusted input 扱い＋入力検証・出力エンコーディング | Client-side databases 4, 5 |
| 24 | Geolocation | ページ読込時に自動で位置要求 | ユーザー操作を起点に `getCurrentPosition`/`watchPosition` | Geolocation |
| 25 | Web Workers | ユーザー入力から Worker スクリプト生成 | 禁止。Worker コードが悪意ないことを保証 | Web Workers 2 |
| 26 | Web Workers | Worker とのメッセージで JS 片を `eval()` | メッセージを検証、`eval()` しない | Web Workers 3 |
| 27 | Web Workers | Worker の CORS 経路を放置 | Worker も CORS 節の対策対象 | Web Workers 1 |
| 28 | 新規タブを開くリンク | `target` 指定のみで `rel` なし | `rel="noopener noreferrer"` を全リンクに | Tabnabbing |
| 29 | `window.open` | windowFeatures に指定なし | `'noopener,noreferrer,' + windowFeatures` ＋ `newWindow.opener = null;` | Tabnabbing（`openPopup`） |
| 30 | referrer 漏洩 | Referrer-Policy 未設定 | 全レスポンスに `Referrer-Policy: no-referrer` | Tabnabbing |
| 31 | フレーミング | framebusting JS で対処 | `X-Frame-Options`（`deny` / `same-origin`）。framebusting は非推奨 | Sandboxed frames 5 |
| 32 | sandbox iframe | sandbox のみを唯一の防御に | 追加の防御層として使う／非対応ブラウザでは属性が無視される | Sandboxed frames 4 |
| 33 | 資格情報・PII 入力 | 属性なしの `<input>` | `spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"` | PII Input hints |
| 34 | オフライン | appcache / `.appcache` / `<html manifest="...">` | Service Worker + Cache API へ移行（Firefox 85, Chrome 93 で削除） | Offline Applications 1 |
| 35 | Service Worker | 広いスコープ、HTTP 配信、任意オリジン登録 | 自オリジンのみ、HTTPS のみ、`sw.<hash>.js`、`scope`/`Service-Worker-Allowed` で制限 | Offline Applications 2 |
| 36 | Service Worker | 機密レスポンスをキャッシュ | `Cache-Control: no-store` | Offline Applications 2 |
| 37 | Service Worker | 停止手段なし | 文書化されたキルスイッチ（unregister フロー） | Offline Applications 2 |
| 38 | レガシー互換 | Flash / Java applet / Silverlight / ActiveX へフォールバック | capability detection ＋ ネイティブ HTML5（`<video>`, `<audio>`, `<canvas>`, WebAssembly） | Progressive Enhancements |
| 39 | WebSocket | `ws://`、`Origin` 未検証、`eval()` | `wss://`、`Origin` allowlist、`JSON.parse()`、`maxPayload`、`perMessageDeflate: false` | WebSocket 委譲先／旧版 |

### 2.2 この表の使い方

診断では、表の「危険な実装」列を上から順に対象アプリで探す。1つ見つかるたびに、その行の「正しい実装」が修正提案になり、「原文の根拠」が根拠づけになる。攻撃側の探索辞書としても、防御側のレビュー観点としても同じ1枚が使える。

---

## 3. `iframe` の `sandbox` 属性 — 全トークンとサンドボックス脱出

チートシート本文は「信頼できないコンテンツを埋め込むなら `sandbox` 属性を使え」「値で細かく制御できる」と述べるだけで、**トークン一覧も脱出条件も載せていない**。ここが最大の欠落だった。実体は MDN（`mdn/content` リポジトリの Markdown）から取得した。

### 3.1 なぜこうなっているのか（設計意図）

`sandbox` とは、`<iframe>` に埋め込んだコンテンツへ**制限をかける**属性のこと。MDN の説明を逐語訳すると次のとおり。

> `sandbox` は `<iframe>` に埋め込まれたコンテンツに適用される制限を制御する。属性の値は、すべての制限を適用するために空にすることもでき、あるいは特定の制限を解除する（lift particular restrictions）ためのスペース区切りトークンにすることもできる。

重要なのは**方向**である。`sandbox=""`（値なし）が**最も強い**状態で、そこにトークンを1つ足すごとに**穴が1つ開く**。つまりトークンは「許可を追加する」ものだ。診断では「どのトークンが付いているか」を数え、多いほど危険と判断する。

```text
sandbox=""                          最も安全（全制限）
   │  ← トークンを足すたびに穴が開く
   ▼
sandbox="allow-scripts allow-forms allow-same-origin ..."   ゆるい
```

### 3.2 どう動くのか（全14トークン）

| トークン（逐語） | 解除される制限（MDN の説明） |
| --- | --- |
| `allow-downloads` | `<a>` / `<area>` の `download` 属性経由、およびファイルダウンロードに至るナビゲーション経由でのファイルダウンロードを許可。ユーザーがクリックしたか JS が開始したかを問わず動作する |
| `allow-forms` | フォーム送信を許可。未指定ならフォームは表示されるが送信しても何も起きない |
| `allow-modals` | `alert()` / `confirm()` / `print()` / `prompt()` のモーダル表示を許可（`<dialog>` は無関係に許可）。`BeforeUnloadEvent` の受信も許可 |
| `allow-orientation-lock` | 画面の向きのロックを許可 |
| `allow-pointer-lock` | Pointer Lock API の使用を許可 |
| `allow-popups` | ポップアップ（`Window.open()` や `target="_blank"` 等）を許可。未指定なら黙って失敗（silently fail）する |
| `allow-popups-to-escape-sandbox` | サンドボックス化された文書が、サンドボックスフラグを強制せずに新しいブラウジングコンテキストを開くことを許可。具体的なユースケースとして MDN は「サードパーティ広告を安全にサンドボックス化しつつ、広告のリンク先ページには同じ制限を強制しない」場合を挙げる。無ければリダイレクト先・ポップアップ・新規タブは元の `<iframe>` と同じ制限を受ける |
| `allow-presentation` | iframe が presentation session を開始できるかを埋め込み側が制御することを許可 |
| `allow-same-origin` | このトークンを使わない場合、リソースは「常に SOP に失敗する特別なオリジン」から来たものとして扱われる（ストレージ／Cookie や一部 JS API を阻止） |
| `allow-scripts` | スクリプト実行を許可（ただしポップアップ作成は許可しない）。未指定なら不許可 |
| `allow-storage-access-by-user-activation` | （experimental）Storage Access API による非分割 Cookie アクセス要求を許可 |
| `allow-top-navigation` | 最上位ブラウジングコンテキスト（`_top`）のナビゲーションを許可 |
| `allow-top-navigation-by-user-activation` | 同上だが、ユーザージェスチャで開始された場合のみ |
| `allow-top-navigation-to-custom-protocols` | 非 `http` プロトコルへのナビゲーションを許可。`allow-popups` または `allow-top-navigation` によっても有効化される |

### 3.3 攻撃者はどこを突くのか（サンドボックス脱出）

MDN が明示する**最大の罠**は、`allow-scripts` と `allow-same-origin` の同時指定である。逐語で引用する。

```text
When the embedded document has the same origin as the embedding page, it is
strongly discouraged to use both allow-scripts and allow-same-origin, as that
lets the embedded document remove the sandbox attribute — making it no more
secure than not using the sandbox attribute at all.
```

日本語にすると、埋め込まれた文書が埋め込み側ページと**同一オリジン**のとき、`allow-scripts` と `allow-same-origin` の両方を使うことは**強く非推奨**である。なぜなら、それは埋め込まれた文書が `sandbox` 属性そのものを取り除くことを可能にし、結果として `sandbox` をまったく使わないのと同程度の安全性しか残らないからだ。

これがなぜ起きるか。同一オリジンのフレーム内スクリプトは、親ページの DOM を通じて自分自身の `<iframe>` 要素にアクセスできる。そこで自分の要素の `sandbox` 属性を書き換えて再読み込みすれば、制限のない状態で動き直せる。これが**サンドボックス脱出（sandbox escape）**である。

```text
親ページ (origin A)
 └─ <iframe sandbox="allow-scripts allow-same-origin" src="A/user.html">
        └─ フレーム内スクリプト（origin A なので親 DOM に届く）
              parent.document.querySelector('iframe').removeAttribute('sandbox')
              → iframe.contentWindow.location.reload()
              → 制限なしで再実行  ← 脱出成立
```

診断では、`sandbox="allow-scripts allow-same-origin"` を持つ**同一オリジンの** iframe を探すだけでよい。ユーザー投稿コンテンツを「sandbox 付きだから安全」と称して同一オリジンで表示している実装は、この2トークン同時指定を見つけるだけで落ちることがある。

MDN はさらに2つの落とし穴を挙げる（逐語訳）。

> サンドボックス化は、攻撃者がサンドボックス化された `iframe` の外側でコンテンツを表示できてしまうなら無意味である（例: 閲覧者がそのフレームを新しいタブで開いた場合）。被害を限定するため、そうしたコンテンツは別オリジンから配信すべきである。

つまりユーザー投稿 HTML を `sandbox` iframe で表示していても、その HTML が `/uploads/xxx.html` のように**直接URLでも到達可能**なら、sandbox を経由せず素のオリジンで実行できてしまう。「sandbox iframe 経由だけ」を前提にした防御は、直接アクセス経路の有無を必ず確認する。

> `allow-same-origin` があるとき、同一オリジンの親文書は、`allow-scripts` が設定されていなくても iframe の DOM にアクセスし操作できる。`allow-scripts` は埋め込まれたブラウジングコンテキスト内でのスクリプト実行のみを制御し、親からの DOM アクセスには影響しない。

もう1点、`sandbox` 付き `<iframe>` 内のページからリダイレクトやポップアップで新しいタブを開くと、**新しいブラウジングコンテキストも同じ `sandbox` 制限を受ける**。たとえば `allow-forms` も `allow-popups-to-escape-sandbox` もない iframe 内のページが別タブで新サイトを開くと、そのタブでのフォーム送信は黙って失敗する。

### 3.4 どう守るのか

- ユーザー投稿コンテンツを sandbox で囲うなら、**別オリジン**（別サブドメイン等）から配信する。
- 同一オリジンで表示せざるを得ない場合、`allow-scripts` と `allow-same-origin` を**同時に付けない**。どちらか一方に絞る。
- sandbox iframe に入れた HTML の**直接URLを塞ぐ**（直接アクセスで素のオリジン実行を許さない）。
- sandbox は「追加の防御層」であり唯一の防御にしない（チェックリスト表 #32）。

〔補足（一般知識・原文外）〕`sandbox` は PDF ビューア等のブラウザ組み込み機能をブロックすることがある点も MDN が注記している。

> ### 📌 ここは自分で開いて読んでください
> **資料**: WHATWG HTML 仕様 — `iframe` の `sandbox` 属性 — https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 未検証ホスト。担当ページが fine-grained control の参照先として挙げる一次仕様だが取得試行外）。以下の記述は MDN（描画版は egress 不可のため `mdn/content` リポジトリの Markdown を取得）にもとづく要約である。
> **読みどころ**:
> 1. 各 `sandbox` トークンが立てる「sandboxing flag」の正式定義（sandboxed scripting / sandboxed origin / sandboxed forms / sandboxed top-level navigation 等）を確認する。
> 2. 「なぜ `allow-scripts`＋`allow-same-origin` で属性を外せるのか」の規範的な根拠は仕様側にある。脱出を正確に説明したいならここが原典。
> **代替手段**: 正典ソースは `https://github.com/whatwg/html`（`source` ファイル）。実務上は MDN で足りる。

---

## 4. HTTP セキュリティヘッダ — OWASP Secure Headers プロジェクトの正典リスト

チートシートの「HTTP Headers to enhance security」節は**具体的ヘッダを一切列挙せず**、OWASP Secure Headers プロジェクトへ丸ごと委譲している。そのプロジェクトが機械可読形式で公開している正典リスト（JSON、`last_update_utc: 2026-09-13 06:28:41`）を取得した。

### 4.1 追加すべきヘッダ（13件）

| # | ヘッダ名（逐語） | 推奨値（逐語） |
| --- | --- | --- |
| 1 | `Cache-Control` | `no-store, max-age=0` |
| 2 | `Clear-Site-Data` | `"cache","cookies","storage"` |
| 3 | `Content-Security-Policy` | `default-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests` |
| 4 | `Cross-Origin-Embedder-Policy` | `require-corp` |
| 5 | `Cross-Origin-Opener-Policy` | `same-origin` |
| 6 | `Cross-Origin-Resource-Policy` | `same-origin` |
| 7 | `Permissions-Policy` | `accelerometer=(), autoplay=(), camera=(), cross-origin-isolated=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), keyboard-map=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), sync-xhr=(self), usb=(), web-share=(), xr-spatial-tracking=(), clipboard-read=(), clipboard-write=(), gamepad=(), hid=(), idle-detection=(), interest-cohort=(), serial=(), unload=()` |
| 8 | `Referrer-Policy` | `no-referrer` |
| 9 | `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |
| 10 | `X-Content-Type-Options` | `nosniff` |
| 11 | `X-DNS-Prefetch-Control` | `off` |
| 12 | `X-Frame-Options` | `deny` |
| 13 | `X-Permitted-Cross-Domain-Policies` | `none` |

`Permissions-Policy`（#7）の値は逐語で載せると1セルが極端に長くなるが、要点は「各機能を `()`（空の許可リスト＝どのオリジンにも許可しない）で**無効化**している」点にある。とくに **`geolocation=()`, `camera=()`, `microphone=()`** の3つ（位置情報・カメラ・マイクの無効化）が診断で真っ先に確認する要点である。全機能を1つずつ潰していく書き方なので、必要な機能だけを `(self)` などに開ければよい（例では `sync-xhr=(self)` だけが自オリジンに開かれている）。

### 4.2 チートシート本文との結びつき

このリストは孤立していない。基礎編で説明した推奨事項の多くを、ヘッダレベルで裏づける。

- `Referrer-Policy: no-referrer` は Tabnabbing 節の推奨（「全レスポンスに付けよ」）と**値まで完全一致**する。
- `X-Frame-Options: deny` は Sandboxed frames 節の推奨と一致する。加えて CSP 推奨値に **`frame-ancestors 'none'`** が含まれ、`X-Frame-Options` と**併記**する構成が OWASP の推奨である（現代の標準的なクリックジャッキング対策は CSP の `frame-ancestors` だが、古いブラウザ向けに `X-Frame-Options` も残す）。
- `Cache-Control: no-store, max-age=0` は Service Worker 節の「機密レスポンスを Cache API に保持させない」と整合する。
- `Permissions-Policy` に **`geolocation=()`** が含まれる点は、Geolocation 節（ユーザー操作を起点にせよ）への**サーバ側の補完的な統制**である。
- **`Cross-Origin-Opener-Policy: same-origin`** は Tabnabbing（`opener` 経由の親ページ操作）に対する**ヘッダレベルの根本対策**で、`rel="noopener"` 系と同じ脅威に効く。チートシートはこのヘッダに言及していないため、Secure Headers 側からの補完であることを明示して載せる。

### 4.3 削除すべきヘッダ（90件）— 攻撃者の recon 辞書でもある

削除推奨の90件は、いずれも**製品名・バージョン・内部ホスト名・トレースIDを漏らすフィンガープリンティング／情報漏洩ヘッダ**である。診断レポートで「情報漏洩（低）」を挙げる際の網羅的チェックリストになる。

```text
$wsep, Host-Header, K-Proxy-Request, Liferay-Portal, OracleCommerceCloud-Version,
Pega-Host, Powered-By, Product, Server, SourceMap, TeamCity-Node-Id,
X-AspNet-Version, X-AspNetMvc-Version, X-Atmosphere-error,
X-Atmosphere-first-request, X-Atmosphere-tracking-id, X-B3-ParentSpanId,
X-B3-Sampled, X-B3-SpanId, X-B3-TraceId, X-BEServer, X-Backside-Transport,
X-CF-Powered-By, X-CMS, X-CalculatedBETarget, X-Cocoon-Version,
X-Content-Encoded-By, X-Datadog-Origin, X-Datadog-Parent-Id,
X-Datadog-Sampling-Priority, X-Datadog-Tags, X-Datadog-Trace-Id, X-DiagInfo,
X-Envoy-Attempt-Count, X-Envoy-External-Address, X-Envoy-Internal,
X-Envoy-Original-Dst-Host, X-Envoy-Upstream-Service-Time, X-FEServer,
X-Framework, X-Generated-By, X-Generator, X-Gitlab-Meta, X-Jitsi-Release,
X-Joomla-Version, X-Kong-Admin-Latency, X-Kong-Client-Latency,
X-Kong-Proxy-Latency, X-Kong-Request-Id, X-Kong-Response-Latency,
X-Kong-Third-Party-Latency, X-Kong-Total-Latency, X-Kong-Upstream-Latency,
X-Kong-Upstream-Status, X-Kubernetes-PF-FlowSchema-UI,
X-Kubernetes-PF-PriorityLevel-UID, X-LiteSpeed-Cache, X-LiteSpeed-Purge,
X-LiteSpeed-Tag, X-LiteSpeed-Vary, X-Litespeed-Cache-Control,
X-Mod-Pagespeed, X-Nextjs-Cache, X-Nextjs-Matched-Path, X-Nextjs-Page,
X-Nextjs-Redirect, X-OWA-Version, X-Old-Content-Length,
X-OneAgent-JS-Injection, X-Page-Speed, X-Php-Version, X-Powered-By,
X-Powered-By-Plesk, X-Powered-CMS, X-Redirect-By, X-Server-Powered-By,
X-SourceFiles, X-SourceMap, X-Turbo-Charged-By, X-Tyk-Trace-Id,
X-Umbraco-Version, X-Varnish-Backend, X-Varnish-Server,
X-Woodpecker-Version, X-dtAgentId, X-dtHealthCheck, X-dtInjectedServlet,
X-ruxit-JS-Agent
```

このリストは実質「**どのミドルウェア／APM／プロキシ／CMS が使われているかを当てるためのヘッダ辞書**」でもある。偵察（recon）の観点では、削除推奨リストのヘッダが**残っていれば**技術スタックが判明する。たとえば `X-Kong-*` → Kong API Gateway、`X-Envoy-*` → Envoy/Istio、`X-dt*` / `X-ruxit-*` → Dynatrace、`X-Nextjs-*` → Next.js、`X-Atmosphere-*` → Atmosphere framework、といった具合だ。防御側チェックリストと攻撃側 recon 辞書が**同一のリスト**である好例である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP Secure Headers Project — https://owasp.org/www-project-secure-headers/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限 = `owasp.org` / `owasp.github.io` が egress ポリシーで拒否）。上記の値は同プロジェクトの機械可読 JSON（`ci/headers_add.json` / `ci/headers_remove.json`）から取得した。
> **読みどころ**:
> 1. 各ヘッダの**解説文と非推奨化の経緯**（JSON には値しか無い）。
> 2. **ブラウザ対応状況の表**。
> 3. 各言語／フレームワークでの**設定サンプル**。
> **代替手段**: 値だけなら `https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json` と `.../headers_remove.json` で取得できる（本節の表はこれに基づく）。

---

## 5. Reverse Tabnabbing — 2023年以降の重大な留保

チートシートの Tabnabbing 節は攻撃の詳細を OWASP www-community 記事へ委譲している。その記事を取得したところ、**チートシート本文には一切書かれていない重大な留保**が冒頭にあった。バグバウンティの重大度判定に直結するので、独立した小節として扱う。

### 5.1 【最重要】記事冒頭の「Update 2023」

記事は冒頭第一節でこう述べている（原文逐語）。

```text
## Update 2023 - this is fixed in modern, evergreen, browsers

Links that use `target="_blank"`  now have implicit `rel="noopener"` in
modern browsers, so this vulnerability isn't as widespread and critical
as before. This implicit rule is also a part of the
[HTML standard](https://github.com/whatwg/html/issues/4078).
According to Caniuse.com evergreen browsers support implicit `rel="noopener"`
from about 2018, but there are still some browsers out there that doesn't support
it, so please consider your userbase when/if deciding to
drop `rel="noopener"`.

Using `rel="noreferrer"` implies also `rel="noopener"`, so if you have
chosen to use `rel="noreferrer"`, the use of `rel="noopener"` isn't required.
```

日本語で要点を整理すると次のとおり。

- **2023年更新 — これはモダンな evergreen ブラウザでは修正済み**。evergreen ブラウザとは、Chrome / Firefox / Edge のように自動更新で常に最新に保たれるブラウザのこと。
- `target="_blank"` を使うリンクは、モダンブラウザでは**暗黙的に `rel="noopener"` を持つ**ため、この脆弱性は以前ほど広範でも重大でもない。この暗黙ルールは **HTML 標準の一部**でもある（whatwg/html issue #4078）。
- Caniuse.com によれば evergreen ブラウザは**2018年頃から**暗黙の `rel="noopener"` をサポートする。ただしサポートしないブラウザもまだ存在するので、`rel="noopener"` を外すかは**自分のユーザー層を考慮せよ**。
- **`rel="noreferrer"` は `rel="noopener"` も含意する**ので、`rel="noreferrer"` を選んだなら `rel="noopener"` の併記は不要。

### 5.2 教科書での扱い（防御と診断で結論が違う）

チートシートの Tabnabbing 節は「全リンクに `rel="noopener noreferrer"` を付けよ」と**無条件に**書き、この暗黙 noopener に**一切触れていない**。したがって防御側と診断側で結論を分けて書く必要がある。

1. **防御側の推奨は依然「明示的に付ける」**。理由は3つ。チートシートがそう言っていること、古いブラウザ対応、そして `window.open()` は暗黙化の**対象外**であること。
2. **診断側の重大度評価は変わった**。`target="_blank"` だけで `rel` が無いリンクを見つけても、モダンブラウザでは `window.opener` が `null` になるため**実際には悪用できない**ことが多い。バグバウンティで「reverse tabnabbing」を単独で報告しても、**Informational / N/A になるのが通常**である。悪用可能性を主張するなら、(a) `window.open()` 経路（暗黙 noopener の対象外）である、(b) 対象がサポート外の古いブラウザを公式サポートしている、(c) `opener` を実際に読み書きできることを PoC で示す、のいずれかが必要。

この「暗黙 noopener」を知らずに報告する例が非常に多い。重大度を過大評価しないための知識として重要である。

### 5.3 攻撃の仕組み（Description）

Reverse tabnabbing とは、対象ページからリンクされたページが、**その対象ページ（元のタブ）を書き換えられる**攻撃である。たとえば元のタブをフィッシングサイトに置き換える。ユーザーは元々正しいページにいたので、それがすり替わったことに気づきにくい。ユーザーがこの偽ページに認証すると、資格情報は正規サイトではなくフィッシングサイトへ送られる。

記事は攻撃が**典型的に成立する前提条件**も明示している。すなわち、発信元サイトが html リンクの `target` 命令で「target loading location」（現在のロケーションを置き換えずに読み込む先）を指定し、**現在のウィンドウ／タブを利用可能なまま残し**、かつ後述の予防策（`rel="noopener"` 等）を**いずれも含んでいない**場合である。この3条件がそろって初めて攻撃が成り立つので、診断ではまずこの前提が満たされているか（開いた新タブから元タブがまだ触れるか）を確認する。

そのうえで、とくに重要な留保が2つある。

- リンク先サイト自身が上書きできるだけでなく、**ユーザーが安全でないネットワーク（公共 WiFi 等）にいる場合、任意の http リンクが偽装されて対象ページを上書きできる**。しかも**対象サイトが https のみで提供されていてもこの攻撃は成立する**。攻撃者はリンク先の http サイトを偽装すればよいだけだからだ。つまり「自サイトが HTTPS なら関係ない」は誤りで、**リンク先が http の外部サイト**なら中間者がレスポンスを差し替えて `window.opener.location` を書ける。
- **`window.open` javascript 関数で開かれたリンクでも同様に成立する**（前述のとおり暗黙 noopener の対象外なので、こちらは今でも生きている）。

### 5.4 攻撃コード（原文逐語）

脆弱なページ:

```html
<html>
 <body>
  <li><a href="bad.example.com" target="_blank">Vulnerable target using html link to open the new page</a></li>
  <button onclick="window.open('https://bad.example.com')">Vulnerable target using javascript to open the new page</button>
 </body>
</html>
```

リンクされる悪意あるサイト:

```html
<html>
 <body>
  <script>
   if (window.opener) {
      window.opener.location = "https://phish.example.com";
   }
  </script>
 </body>
</html>
```

ユーザーが Vulnerable Target のリンク／ボタンをクリックすると、Malicious Site が新しいタブで開かれる（期待どおり）が、**元のタブにあった対象サイトはフィッシングサイトに置き換えられる**。悪意側のコードは `if (window.opener) { window.opener.location = ... }` の**2行だけ**。PoC が極めて短いので、診断ではまず `window.opener` が `null` かどうか（暗黙 noopener が効いているか）を先に確認する。

### 5.5 クロスオリジン時に `opener` から読める7プロパティ

悪意あるサイトが**クロスオリジン**アクセスの場合、`opener`（実体は `window` インスタンスへの参照）から**アクセスできるのは次の7プロパティのみ**である。

| プロパティ（逐語） | 原文の説明 |
| --- | --- |
| `opener.closed` | ウィンドウが閉じられたかどうかの boolean を返す |
| `opener.frames` | 現在のウィンドウ内のすべての iframe 要素を返す |
| `opener.length` | 現在のウィンドウ内の iframe 要素の数を返す |
| `opener.opener` | そのウィンドウを作成したウィンドウへの参照を返す |
| `opener.parent` | 現在のウィンドウの親ウィンドウを返す |
| `opener.self` | 現在のウィンドウを返す |
| `opener.top` | 最上位のブラウザウィンドウを返す |

ドメインが同一の場合は `window` が公開するすべてのプロパティにアクセスできる。ここから分かるのは、クロスオリジンでも `location` への**書き込み**は可能（だから攻撃が成立する）だが、**読み取り**は上記7つに限られるということ。つまり reverse tabnabbing は「親ページの内容を盗む」攻撃ではなく「**親ページを置き換える**」攻撃である。影響を記述する際にこの区別を誤らないこと。`opener.frames` / `opener.length` からフレーム数という**わずかな情報漏洩**が生じる点は押さえておく。

### 5.6 どう守るのか（Prevention）

記事は予防策を自前で書かず、「冒頭の Update 2023 を見よ。今はモダンな evergreen ブラウザで自動的に防止される。予防策の情報は HTML5 Cheat Sheet を見よ」と述べている。つまり**担当ページと www-community 記事は相互参照の関係**にある。担当ページ＝対策（`rel`, windowFeatures, `Referrer-Policy`）、www-community 記事＝攻撃の説明と2023年の留保。教科書ではこの2つを合わせて1つの節にするのが正しい。具体策はチェックリスト表の #28〜#30、および `Cross-Origin-Opener-Policy: same-origin`（4.2）である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Reverse Tabnabbing の解説図（`TABNABBING_OVERVIEW_WITH_LINK.png` / `..._WITHOUT_LINK.png`）— https://owasp.org/www-community/attacks/Reverse_Tabnabbing
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限 = `owasp.org` が egress 拒否、かつ画像を解釈していない）。本文は同記事の正典 Markdown から取得済みだが、図版2枚は取得していない。
> **読みどころ**:
> 1. 戻りリンクあり／なしの親子ページ関係図で、`rel="noopener"` の有無により `opener` 参照がどう切れるかを1枚で確認する。
> 2. 教科書の Tabnabbing 図を自作する際の参考にする。
> **代替手段**: `https://raw.githubusercontent.com/OWASP/www-community/master/assets/images/` から直接取得できる可能性が高い（同リポジトリの Markdown は取得成功済み）。

### 5.7 記事末尾の参照一覧（原典リンク）

記事末尾には参考文献一覧があり、暗黙 noopener の一次情報として WHATWG issue #4078、Caniuse、Chrome Platform Status、各ブラウザのバグトラッカー（Chromium 898942 / Mozilla 1522083 / WebKit 190481）が挙げられている。それに加えて、Reverse Tabnabbing を実例・デモで学ぶための一次リンクが次のとおり列挙されている。バグバウンティで攻撃を実証したり、報告書に一次情報を添えたりするときに直接あたるとよい。

| 参照（逐語タイトル） | URL |
| --- | --- |
| The `target="_blank"` vulnerability by example（dev.to） | https://dev.to/ben/the-targetblank-vulnerability-by-example |
| About `rel="noopener"` attribute values（Mathias Bynens） | https://mathiasbynens.github.io/rel-noopener/ |
| `target="_blank"` — the most underestimated vulnerability ever（Medium / jitbit） | https://medium.com/@jitbit/target-blank-the-most-underestimated-vulnerability-ever-96e328301f4c |
| Cure53 Browser Security WhitePaper | https://github.com/cure53/browser-sec-whitepaper/raw/master/browser-security-whitepaper.pdf |
| Reverse tabnabbing and blankshield demo | https://danielstjules.github.io/blankshield/ |

このうち Mathias Bynens の `rel-noopener` は暗黙 noopener が標準化される前から `rel="noopener"` の効果を解説した定番資料で、blankshield demo は攻撃を実際に体験できる。Cure53 の WhitePaper はブラウザセキュリティ全般の網羅的な一次資料で、Tabnabbing 以外の攻撃面も俯瞰できる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Caniuse — implicit `rel="noopener"` when using `target="_blank"` — https://caniuse.com/mdn-html_elements_a_implicit_noopener
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: JS 必須のためテキスト取得に不向き、取得試行外）。
> **読みどころ**:
> 1. 暗黙 `rel="noopener"` を「サポートしないブラウザ」が具体的にどれかを確認する。
> 2. 「2018年頃から」「一部の非対応ブラウザが残る」という記述を、診断時の重大度判定に使えるブラウザ・バージョン表に落とすため。
> **代替手段**: 同種の情報は MDN の browser-compat-data（`https://github.com/mdn/browser-compat-data`、JSON）から取得できる。

---

## 6. WebSocket 認証の根本原則 — 旧版チートシートが持っていた設計指針

2025年10月の改訂で WebSocket の詳細記述はチートシートから削除され、独立した WebSocket Security Cheat Sheet へ移動した。しかし**削除された旧版にだけ明示されていた設計原則**があり、これが CSWSH（Cross-Site WebSocket Hijacking）の根本対策を理解する鍵になる。Git 履歴から旧版を取り出して確認した。

削除の規模は数値で見ると実感しやすい。旧版（`28151e3^` = SHA `9e82856…`）は **985行 / 48,915バイト**あり、そのうち WebSocket 実装ヒントだけで数百行を占めていた。対して現行版は **160行 / 16,118バイト**にまで縮んでいる。つまり旧版の6割以上が削られ、その大半が Java の実装コード付き WebSocket 節だった。以下ではその削られた散文部分を Git 履歴から取り出して補う（Java コード本体は分量が大きく現行版にも存在しないため、成果物の見出し・行位置・役割の一覧として示す）。

### 6.1 「ブラウザが自動送信しないトークン」原則

旧 `Authentication and Input/Output validation` 節の散文を逐語で引用する。

```text
When using websocket as communication channel, it's important to use an authentication method allowing the user to receive an access *Token* that is not automatically sent by the browser and then must be explicitly sent by the client code during each exchange.

HMAC digests are the simplest method, and [JSON Web Token](https://jwt.io/introduction/) is a good feature rich alternative, because it allows the transport of access ticket information in a stateless and not alterable way. Moreover, it defines a validity timeframe. You can find additional information about JWT hardening on this [cheat sheet](JSON_Web_Token_for_Java_Cheat_Sheet.md).

[JSON Validation Schema](http://json-schema.org/) are used to define and validate the expected content in input and output messages.
```

日本語で要点を整理する。

1. WebSocket を通信チャネルに使う場合、「**ブラウザによって自動的に送られるのではなく、クライアントコードが各やり取りのたびに明示的に送らなければならない**」アクセス *Token* をユーザーが受け取る認証方式を使うことが重要である。
2. **HMAC ダイジェストが最も単純**、**JWT（JSON Web Token）が機能豊富な良い代替**。JWT はステートレスかつ改変不可能な形でアクセスチケット情報を運べ、さらに有効期間を定義できる。
3. **JSON Validation Schema** を使って、入力メッセージと出力メッセージの**両方**について期待される内容を定義し検証する。

#### 旧版が持っていた認証まわりの Java 成果物（インベントリ）

旧版はこの認証方式を、動く Java コードの成果物として提示していた。コード本体は数百行あり現行版にも存在しないため全文引用はしないが、**どんな部品で WebSocket 認証を組んでいたか**の全体像は、見出し・旧版での行位置・役割の一覧として押さえておく価値がある（サンプルアプリ全体は `https://github.com/righettod/poc-websocket`）。

| 成果物（原文の太字見出し） | 旧版の行 | 役割（原文の説明） |
| --- | --- | --- |
| **Authentication Web Socket endpoint** | 248 | 認証のやり取りを可能にする WebSocket エンドポイントを提供する |
| **Authentication message handler** | 328 | すべての認証リクエストを処理する |
| **Utility class to manage JWT** | 416 | アクセストークンの発行と検証を扱う（例では単純な JWT を使用） |
| **JSON schema of the input and output authentication message** | 479 | 認証エンドポイントの視点から、入力・出力メッセージの期待される構造を定義する |
| **Authentication message decoder and encoder** | 526 | 専用の JSON Schema を使って JSON のシリアライズ／デシリアライズと入出力検証を行い、エンドポイントが受信・送信する全メッセージが期待構造を厳密に守ることを体系的に保証する |

ここで押さえるべき設計原則が、旧版の節末に逐語で書かれている。

```text
Note that the same approach is used in the messages handling part of the POC. All messages exchanged between the client and the server are systematically validated using the same way, using dedicated JSON schemas linked to messages dedicated Encoder/Decoder (serialization/deserialization).
```

つまり、この JSON スキーマ＋Encoder/Decoder による検証は認証メッセージだけの話ではない。**クライアントとサーバ間で交換される「すべてのメッセージ」が、メッセージ専用の Encoder/Decoder に紐づけた専用 JSON スキーマによって、体系的に同じ方法で検証される**——という原則で POC 全体が貫かれていた。診断観点では「入力だけでなく出力も」「一部のメッセージだけでなく全メッセージを」スキーマ検証しているか、を見るとこの設計思想に沿っているかが判定できる。

### 6.2 なぜこれが CSWSH の根本対策なのか

CSWSH とは、攻撃者の悪意あるサイトが、被害者のブラウザに開かせた WebSocket 接続を乗っ取る攻撃のこと。CSRF の WebSocket 版と考えるとよい。現行の WebSocket Security Cheat Sheet は「ブラウザはハンドシェイクに Cookie を含めるので CSWSH に脆弱」と**結果**を述べるだけだが、旧版はその**設計原則**を明示していた。

CSWSH が成立する条件は「**認証情報がブラウザによって自動送信される**」ことそのものである。だから「自動送信される Cookie を WebSocket 認証に使うな。クライアントコードが明示的に毎メッセージ送るトークンを使え」という原則を守れば、CSWSH は**構造的に**成立しない。攻撃者のサイトから接続を開いても、攻撃者はそのトークンを知らないので送れないからだ。

```text
Cookie ベース認証            トークンベース認証（旧版の推奨）
 ハンドシェイクに             接続確立後、クライアント JS が
 ブラウザが Cookie を自動付与  各メッセージにトークンを明示付与
   │                            │
 攻撃サイトからでも            攻撃サイトはトークンを知らない
 Cookie が飛ぶ → CSWSH 成立    → CSWSH は構造的に不成立
```

`Origin` 検証は**緩和策**、この原則が**根本対策**という2層構造で理解すると筋が通る。

### 6.3 認可の順序とトークンの明示的失効

旧 `Authorization and access token explicit invalidation` 節の散文を逐語で引用する。

```text
Authorization information is stored in the access token using the JWT *Claim* feature (in the POC the name of the claim is *access_level*). Authorization is validated when a request is received and before any other action using the user input information.

The access token is passed with every message sent to the message endpoint and a denylist is used in order to allow the user to request an explicit token invalidation.

Explicit token invalidation is interesting from a user's point of view because, often when tokens are used, the validity timeframe of the token is relatively long (it's common to see a valid timeframe superior to 1 hour) so it's important to allow a user to have a way to indicate to the system "OK, I have finished my exchange with you, so you can close our exchange session and cleanup associated links".

It also helps the user to revoke itself of current access if a malicious concurrent access is detected using the same token (case of token stealing).
```

要点は次のとおり。

1. 認可情報は JWT の *Claim* 機能でトークン内に格納する（POC の claim 名は **`access_level`**）。**認可はリクエスト受信時に、かつユーザー入力を使う他のどの処理よりも前に検証する**。「認可チェックをユーザー入力を触る前に置く」という**順序**まで指定している点が現行版より具体的だ。
2. アクセストークンは全メッセージに付与し、ユーザーが明示的にトークンを無効化できるよう **denylist** を使う。
3. トークンの有効期間は長いことが多い（1時間超もよくある）ため、ユーザーが「もうやり取りは終わった」とシステムに伝えてセッションを閉じる手段が重要。
4. 同じトークンでの悪意ある同時アクセス（トークン盗用）が検出された場合、ユーザー自身がアクセスを取り消せる。

この認可・失効の仕組みも、旧版では Java 成果物として提示されていた（コード本体は未引用。見出し・行位置・役割を一覧で示す）。

| 成果物（原文の太字見出し） | 旧版の行 | 役割（原文の説明） |
| --- | --- | --- |
| **Token denylist** | 740 | 使用を許可しなくなったトークンの**ハッシュ**の一時リストを、**メモリ上の時間制限付きキャッシュ（memory and time limited Caching）**で維持する |
| **Message handling** | 827 | リストへのメッセージ追加要求を処理する。**認可検証アプローチの実例**を示す |

診断観点では「denylist にトークンそのものではなく**ハッシュ**を入れる」「**TTL 付きキャッシュ**で持つ（トークンの有効期限より長く保持する必要はない）」の2点が、ログアウト実装をレビューする際の具体的チェック項目になる。現行版（WebSocket 委譲先）が言う「ユーザーがログアウトしたら全 WebSocket 接続を直ちに閉じる」の**実装レベルの中身**が、この denylist 設計にあたる。

### 6.4 機密性・完全性 — `ws://` の危険を1行で示す

旧 `Confidentiality and Integrity` 節から、`ws://` の危険性を実演する部分を逐語で引用する。

```text
If the raw version of the protocol is used (protocol `ws://`) then the transferred data is exposed to eavesdropping and potential on-the-fly alteration.
```

```shell
$ grep -aE '(password)' capture.pcap
{"login":"bob","password":"bob123"}
```

平文の `ws://` を使うと、転送データは盗聴と飛行中の改変に晒される。Wireshark で取得した PCAP ファイルを `grep` するだけで、パスワードが**平文でそのまま**出てくる。現行版の「暗号化されていない `ws://` は盗聴と改ざんを許す」という抽象的記述より、**pcap を grep するだけで資格情報が取れる**という具体性が説得力を持つ。

サーバ側でチャネルが安全かを確認する方法として、旧版は `session` オブジェクトの `isSecure()` メソッドを呼ぶ実装例を示していた。

```java
/**
 * Handle the beginning of an exchange
 *
 * @param session Exchange session information
 */
@OnOpen
public void start(Session session) {
    ...
    //Affect a new message handler instance in order to process the exchange only if the channel is secured
    if(session.isSecure()) {
        session.addMessageHandler(new AuthenticationMessageHandler(session.getBasicRemote()));
    }else{
        LOG.info("[AuthenticationEndpoint] Session {} do not use a secure channel so no message handler " +
                 "was affected for processing and session was explicitly closed !", session.getId());
        try{
            session.close(new CloseReason(CloseReason.CloseCodes.CANNOT_ACCEPT,"Insecure channel used !"));
        }catch(IOException e){
            LOG.error("[AuthenticationEndpoint] Session {} cannot be explicitly closed !", session.getId(),
                      e);
        }

    }
    LOG.info("[AuthenticationEndpoint] Session {} message handler affected for processing", session.getId());
}
```

`@OnOpen` で `session.isSecure()` が真のときだけメッセージハンドラを取り付け、偽なら `CloseReason.CloseCodes.CANNOT_ACCEPT` と理由文字列 `"Insecure channel used !"` でセッションを明示的に閉じている。診断観点では、サーバが `wss://` を**強制しているか**を見る。ここで `isSecure()` が偽になる仕組みを補っておく。`isSecure()` は「アプリのコンテナが受け取っている接続そのものが TLS で暗号化されているか」を返すメソッドである。ところが実務では、TLS 終端（暗号化の解除）を前段のリバースプロキシ（例: Nginx）に任せる構成が多い。この場合、プロキシがブラウザとの間を `https`/`wss` で暗号化し、**プロキシから後ろの Java コンテナへは平文で転送する**ため、コンテナから見た接続は平文になり `isSecure()` は `false` を返してしまう。ブラウザ側は暗号化されているのに、アプリ側のこのチェックだけを信じると正常な接続まで拒否したり、逆にこのチェックを外して**本当に平文の `ws://` まで受け付けてしまう**、という取り違えが起きやすい（プロキシ経由の暗号化は `X-Forwarded-Proto` ヘッダ等で判定する必要がある）。結論として、WebSocket エンドポイントは `wss://` のみで公開する。

### 6.5 旧版と現行版は入れ替えではなく相補的

| 旧版（HTML5 チートシート内、〜2025-10） | 現行の所在 | 差分の性質 |
| --- | --- | --- |
| Access filtering（`Origin` allow-list、CSWSH 言及） | WebSocket 委譲先 Origin 検証（Node.js `verifyClient` の例に置換） | 保持。言語が Java → JavaScript に |
| Authentication and I/O validation（「自動送信されないトークン」原則、JWT、JSON Schema） | WebSocket 委譲先 トークン認証 / 入力検証 | 一部希薄化。**原則の明示は現行版にない**（本節が唯一の記録） |
| Authorization and token explicit invalidation（JWT claim、denylist、明示的失効） | WebSocket 委譲先 Message-Level Authorization / ログアウト時全接続クローズ | 一部希薄化。denylist のハッシュ／TTL という実装粒度は現行版にない |
| Confidentiality and Integrity（`ws://` の pcap grep、`isSecure()`） | WebSocket 委譲先 Always Use WSS | 保持されたが実例は削除 |
| （旧版に無し・現行版の新規追加） | WebSocket 委譲先: `permessage-deflate` の無効化（CRIME・BREACH 対策）、バックプレッシャー・DoS 対策、ロギング、テスト、フレームワーク別ベストプラクティス | **新規**。旧版にはなかった観点。詳細は基礎編（part 1）の WebSocket 節を参照 |

この最終行は「削除」ではなく「追加」の記録である。旧版が持たず現行版で新たに加わった観点（圧縮に絡む CRIME/BREACH 対策としての `permessage-deflate` 無効化、DoS を防ぐバックプレッシャー制御など）がここに入る。したがって旧版と現行版の関係は、削られた部分（上4行）と加わった部分（この行）の両方向がある。

WebSocket の防御を書くなら、現行版を骨格にしつつ、旧版から (a)「自動送信されない資格情報」原則、(b) `ws://` の pcap grep 実演、(c) トークン明示失効の denylist 設計、の3点を「旧版の記述」と明記して補うのが最も内容が濃くなる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: righettod/poc-websocket（旧版が挙げる WebSocket 実装サンプルアプリ）— https://github.com/righettod/poc-websocket
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 本ノートの範囲外と判断し未取得）。
> **読みどころ**:
> 1. 旧 WebSocket 節の Java 実装例が動くアプリとしてどう組まれているかを確認する。
> 2. `checkOrigin` の allow-list、JWT 発行・検証、JSON Schema による Encoder/Decoder、トークン denylist が1つのアプリ内でどう結線されるかを通しで見る。
> **代替手段**: `git clone https://github.com/righettod/poc-websocket`。ただし旧版由来で、現行の WebSocket Security Cheat Sheet とは構成が異なる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Cross-Site WebSocket Hijacking（Christian Schneider、CSWSH の原典解説）— https://www.christian-schneider.net/CrossSiteWebSocketHijacking.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 取得試行外／`web.archive.org` も egress 拒否）。
> **読みどころ**:
> 1. CSWSH の初出解説を読む。攻撃の4ステップの原典。
> 2. 検出方法と PoC の作り方まで踏み込んでいるとされるので、バグバウンティで CSWSH を実証するなら原典を当たる。
> **代替手段**: 読者の環境では `https://web.archive.org/web/2023/https://www.christian-schneider.net/CrossSiteWebSocketHijacking.html` が有効なはず。

---

## 手を動かす

1. 対象アプリのページを開き、DevTools のコンソールで `document.querySelectorAll('iframe[sandbox]')` を実行し、各 iframe の `sandbox` 属性値を書き出す。`allow-scripts` と `allow-same-origin` が**同時に**付いていて、かつ `src` が**同一オリジン**のものを探す。見つかれば §3.3 のサンドボックス脱出候補である。
2. 同じくコンソールで、そのフレームが直接URLでも到達できるか確認する。`fetch(iframe.src).then(r=>r.status)` で 200 が返り、ブラウザのアドレスバーに直接貼っても素のオリジンで表示されるなら、sandbox を迂回できる。
3. レスポンスヘッダを確認する。`curl -sI https://target.example/` を実行し、§4.1 の13件のうち欠けているものと、§4.3 の90件のうち残っているもの（＝技術スタックの漏洩）を突き合わせる。
4. Reverse Tabnabbing 候補を探す。ページ内の `target="_blank"` かつ `rel` 無しのリンク、および `window.open(...)` を呼ぶ箇所を列挙する。次にコンソールで、そのリンクを開いた新タブ側から `window.opener` の値を確認する。`null` なら暗黙 noopener が効いており（§5.2）、単独では報告価値が低い。`window.open()` 経路で `opener` が非 null なら悪用可能性がある。
5. WebSocket を使うアプリなら、接続 URL が `wss://` か `ws://` かを Network タブで確認する。`ws://` なら §6.4 のとおり `tcpdump`/Wireshark で pcap を取り、`grep -aE '(password|token)' capture.pcap` で平文の資格情報が出るかを自分の検証環境で試す（許可された対象・自前環境に限る）。
6. 見つけた項目を §2 のチェックリスト表の行番号に対応づけ、「危険な実装／正しい実装／原文の根拠」の3列でレポートにまとめる。

---

## つまずきポイント

- **`sandbox` のトークンは「許可を足す」もの**。`sandbox=""` が最強で、トークンが多いほど危険。「トークンが付いている＝制限されている」と逆に読み間違えやすい。
- **`allow-scripts`＋`allow-same-origin` は、別オリジンなら実務上必要な組み合わせでもある**。危険なのは**同一オリジン**のときだけ。オリジンを必ず確認すること。
- **「自サイトが HTTPS だから Reverse Tabnabbing は無関係」は誤り**。危険なのは**リンク先が http の外部サイト**のケースで、中間者がそれを差し替える（§5.3）。
- **Reverse Tabnabbing を単独で高重大度報告するのは通常 N/A**。モダンブラウザの暗黙 noopener（2018年頃〜）で `window.opener` が `null` になるため。`window.open()` 経路や古いブラウザサポートなど、悪用可能性の追加根拠が要る。
- **`rel="noreferrer"` を付けたなら `rel="noopener"` は不要**（前者が後者を含意する）。両方書いても間違いではないが、片方だけを見て「noopener が無い」と誤判定しないこと。
- **Secure Headers の90件削除リストは、そのまま recon 辞書**。防御レビューと偵察で同じリストを使う。
- **CSWSH の根本原因は「Cookie の自動送信」**。`Origin` 検証は緩和策にすぎない。ログイン方式そのものを見ないと本質を外す。
- **`ws://` は grep 一発で資格情報が漏れる**。「暗号化されていないだけ」と軽く見ず、pcap の実演で危険度を体感すること。

---

## この節のまとめ

- チートシートの推奨事項は否定形にすると診断チェックリストになり、§2 の39項目の表がその一覧である。
- `iframe sandbox` は空が最強で、14トークンを足すごとに穴が開く。診断では付いているトークンを数える。
- `sandbox="allow-scripts allow-same-origin"` は**同一オリジン**のとき、埋め込み文書が sandbox 属性を自ら外せる＝サンドボックス脱出になる。
- sandbox iframe の中身が**直接URLで到達可能**なら、sandbox を迂回して素のオリジンで実行できる。別オリジン配信が防御。
- OWASP Secure Headers は追加13件・削除90件を推奨し、`Referrer-Policy: no-referrer`・`X-Frame-Options: deny`＋CSP `frame-ancestors 'none'`・`Cross-Origin-Opener-Policy: same-origin` などがチートシート本文の推奨を裏づける。
- 削除推奨90件は技術スタックを漏らすヘッダで、防御チェックリストと攻撃 recon 辞書が同一リストになっている。
- Reverse Tabnabbing は2023年以降モダンブラウザ（暗黙 `rel="noopener"`、2018年頃〜）で修正済み。防御は「明示的に付ける」、診断は「単独では Informational」が原則。
- クロスオリジンの `opener` から読めるのは7プロパティのみ。読み取りではなく `location` の**書き込み**で親タブを置き換える攻撃である。
- WebSocket 認証の根本原則は「ブラウザが自動送信しない、クライアントが毎メッセージ明示送信するトークンを使う」。これが CSWSH を構造的に防ぐ。
- 認可はユーザー入力を触る前に検証し、トークン失効は denylist（トークンのハッシュを TTL キャッシュで保持）で行う。
- `ws://` は Wireshark の pcap を `grep` するだけで平文の資格情報が漏れる。エンドポイントは `wss://` のみで公開し、サーバは `isSecure()` で強制する。
- 旧版 WebSocket 記述と現行版は相互補完的で、旧版の設計原則を「旧版の記述」と明記して補うと最も濃い解説になる。

---

## 理解度チェック

1. `sandbox` 属性で、埋め込みコンテンツを**最も強く**制限するのはどう書いたときか。
   ▶ 答え: `sandbox=""`（値なし／空）のとき。トークンを足すごとに制限が解除され、穴が開いていく。

2. `sandbox="allow-scripts allow-same-origin"` が危険になるのはどんな条件のときか。理由も述べよ。
   ▶ 答え: 埋め込み文書が埋め込み側と**同一オリジン**のとき。フレーム内スクリプトが親 DOM 経由で自分の `<iframe>` の `sandbox` 属性を外して再読み込みでき、sandbox を使わないのと同程度の安全性しか残らない（サンドボックス脱出）。

3. ユーザー投稿 HTML を sandbox iframe で表示している。他に何を確認すれば sandbox 迂回を防げるか。
   ▶ 答え: その HTML が `/uploads/xxx.html` のように**直接URLでも到達可能**でないか。直接アクセスできれば sandbox を経由せず素のオリジンで実行される。加えて別オリジンから配信されているかも確認する。

4. OWASP Secure Headers の削除推奨90件が、攻撃者にとってなぜ有用か。
   ▶ 答え: それらは製品名・バージョン・APM・プロキシ・CMS を漏らすフィンガープリンティングヘッダで、残っていれば技術スタックが判明する（例: `X-Kong-*`→Kong、`X-Envoy-*`→Envoy、`X-dt*`→Dynatrace）。防御チェックリストがそのまま recon 辞書になる。

5. `target="_blank"` かつ `rel` 無しのリンクを見つけた。バグバウンティで高重大度として報告してよいか。
   ▶ 答え: 通常はよくない。2018年頃以降のモダンブラウザは暗黙 `rel="noopener"` を持ち `window.opener` が `null` になるため、単独では Informational / N/A になりがち。`window.open()` 経路や古いブラウザ公式サポート、`opener` を実際に操作できる PoC などの追加根拠が要る。

6. 対象サイトが HTTPS のみで提供されていれば Reverse Tabnabbing は成立しないか。
   ▶ 答え: 成立しうる。危険なのは**リンク先が http の外部サイト**の場合で、公共 WiFi 等で中間者がそのレスポンスを差し替え、`window.opener.location` を書けば元タブを上書きできる。自サイトの HTTPS 化だけでは防げない。

7. クロスオリジンの悪意サイトが `opener` から**読める**プロパティは何個で、Reverse Tabnabbing は「読む」攻撃か「書く」攻撃か。
   ▶ 答え: 7個（`closed`, `frames`, `length`, `opener`, `parent`, `self`, `top`）のみ読める。攻撃は `location` への**書き込み**で親タブを置き換えるもので、内容を盗む攻撃ではない。

8. CSWSH の根本対策は何か。`Origin` 検証との関係も述べよ。
   ▶ 答え: 「ブラウザが自動送信する Cookie を WebSocket 認証に使わず、クライアントコードが毎メッセージ明示的に送るトークン（HMAC / JWT 等）を使う」こと。自動送信される資格情報がなければ攻撃サイトから接続を開いても認証できず、CSWSH は構造的に不成立になる。`Origin` 検証は緩和策で、こちらが根本対策。

9. `ws://` の危険性を1行のコマンドで示すと、旧版チートシートの例ではどうなるか。
   ▶ 答え: `grep -aE '(password)' capture.pcap` を実行すると `{"login":"bob","password":"bob123"}` が平文でそのまま出てくる。Wireshark で取った pcap を grep するだけで資格情報が読める。

10. WebSocket のトークン denylist を実装する際、旧版が示した2つの具体ポイントは何か。
    ▶ 答え: (1) denylist にはトークンそのものではなく**ハッシュ**を入れる、(2) **メモリ上の TTL（時間制限）付きキャッシュ**で保持する（トークンの有効期限より長く保つ必要はない）。

---

## 出典

- https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html （担当ページ。実取得は https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md, commit `00f27a7`）
- https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/html/reference/elements/iframe/index.md （`sandbox` 全トークンと脱出警告）
- https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json （追加13件、`last_update_utc: 2026-09-13`）
- https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_remove.json （削除90件）
- https://raw.githubusercontent.com/OWASP/www-community/master/pages/attacks/Reverse_Tabnabbing.md （Reverse Tabnabbing 全文、Update 2023）
- 旧版 HTML5 Cheat Sheet（`git show 9e82856c01f415ca1b5978b1ba1701a3769090a2:cheatsheets/HTML5_Security_Cheat_Sheet.md`、旧 WebSocket implementation hints）
- https://owasp.org/www-project-secure-headers/ （描画版。egress 不可）
- https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox （sandboxing flag の規範的定義）
- https://caniuse.com/mdn-html_elements_a_implicit_noopener （暗黙 noopener のブラウザ対応）
- https://owasp.org/www-community/attacks/Reverse_Tabnabbing （図版含む描画版）
- https://github.com/righettod/poc-websocket （旧版 WebSocket 実装サンプル）
- https://www.christian-schneider.net/CrossSiteWebSocketHijacking.html （CSWSH 原典）

<!-- sources: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html, https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/html/reference/elements/iframe/index.md, https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json, https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_remove.json, https://raw.githubusercontent.com/OWASP/www-community/master/pages/attacks/Reverse_Tabnabbing.md, https://owasp.org/www-project-secure-headers/, https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox, https://caniuse.com/mdn-html_elements_a_implicit_noopener, https://github.com/righettod/poc-websocket, https://www.christian-schneider.net/CrossSiteWebSocketHijacking.html -->
<!-- terms: sandbox, allow-scripts, allow-same-origin, サンドボックス脱出, Cross-Origin-Opener-Policy, OWASP Secure Headers, X-Frame-Options, frame-ancestors, Reverse Tabnabbing, 暗黙のnoopener, rel=noopener, rel=noreferrer, window.opener, CSWSH, Cross-Site WebSocket Hijacking, wss, isSecure, JWT, denylist, JSON Schema, Permissions-Policy, フィンガープリンティング -->
<!-- self-read: https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox | 未検証ホスト、sandboxing flag の規範定義の原典 -->
<!-- self-read: https://owasp.org/www-project-secure-headers/ | owasp.org が egress 拒否、各ヘッダの解説文と対応状況表は描画版のみ -->
<!-- self-read: https://owasp.org/www-community/attacks/Reverse_Tabnabbing | owasp.org が egress 拒否、図版2枚を取得・解釈していない -->
<!-- self-read: https://caniuse.com/mdn-html_elements_a_implicit_noopener | JS 必須でテキスト取得に不向き、非対応ブラウザ表は現地確認が必要 -->
<!-- self-read: https://github.com/righettod/poc-websocket | 本ノート範囲外で未取得、動くアプリとしての結線は現地確認が必要 -->
<!-- self-read: https://www.christian-schneider.net/CrossSiteWebSocketHijacking.html | 取得試行外、CSWSH の検出方法と PoC は原典確認が必要 -->
