# [09] OWASP HTML5 Security Cheat Sheet 精読ノート（Web Messaging / CORS / WebSocket / SSE / クライアントストレージ / Tabnabbing / sandbox iframe / Service Worker）

想定章: ch02（クライアントサイドの攻撃面とブラウザAPIの安全な使い方）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html | full（本文は全文逐語で取得） | 描画済みHTMLは取得不可 → 正典ソースの Markdown を `curl` で取得: `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md`（160行 / 16,118バイト / md5 `4122279b7adafce78734c2b4286fc4c3`） | WebFetch は `EGRESS_BLOCKED`（`cheatsheetseries.owasp.org`）、`curl` も プロキシが CONNECT に 403。当該サイトは同リポジトリの Markdown から MkDocs で生成されているため、本文は完全に同一。取得時点のファイル最終コミットは `00f27a7`（2026-05-29, PR #2188 "Fix factually outdated guidance in DOM XSS, HTML5, and TLS cheat sheets"） |
| https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md | full | `curl -sSL`（HTTP 200） | 上記の実取得元。逐語引用はすべてこのファイルに基づく |
| https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/WebSocket_Security_Cheat_Sheet.md | full（補助資料） | `curl -sSL`（HTTP 200, 274行 / 12,527バイト） | 担当ページの WebSockets 節が「詳細はこちら」と丸ごと委譲している先。委譲先を読まないと WebSocket の推奨事項が全部欠落するため補助的に全文取得。最終コミット `05dcd35`（2026-03-02, PR #2040 replay対策追記）。対応する描画URLは `https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html`（同じくegress不可） |
| https://web.archive.org/web/2024/https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html | failed（2026-09-18 に再試行、同じく失敗） | WebFetch / `curl` 双方 | プロキシが `web.archive.org:443` への CONNECT を 403 で拒否。**組織のエグレスポリシーによる拒否**であり一時障害ではない（プロキシ手引きは「403/407 は再試行も迂回もせず報告せよ」と明記）。旧版の確認は代わりに Git 履歴（`git clone --filter=blob:none` + `git show`）で行った（付録A・付録D-4） |

### 補完工程（2026-09-18）で追加取得した資料（詳細は付録D）

| URL | 状態 | 取得方法 | 何を埋めたか |
| --- | --- | --- | --- |
| https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/html/reference/elements/iframe/index.md | full | `curl -sSL --compressed`（HTTP 200 / 8,754バイト） | **`iframe sandbox` 属性のトークン全14種**と、`allow-scripts`+`allow-same-origin` によるサンドボックス脱出の警告。初版が「本チートシートには無い／WHATWG 側にある」と明記していた欠落（→ 付録D-1）。描画版 `developer.mozilla.org` は `EGRESS_BLOCKED` |
| https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json | full | `curl -sSL --compressed`（HTTP 200 / 1,738バイト / `last_update_utc: 2026-09-13 06:28:41`） | 担当ページの「HTTP Headers to enhance security」節が丸ごと委譲していた**推奨ヘッダ13件の実際の名前と値**（→ 付録D-2-a）。描画版 `owasp.org` / `owasp.github.io` は双方 `EGRESS_BLOCKED` |
| https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_remove.json | full | 同上（HTTP 200 / 2,235バイト） | 同プロジェクトの**削除すべきヘッダ90件**の全リスト（→ 付録D-2-b） |
| https://raw.githubusercontent.com/OWASP/www-community/master/pages/attacks/Reverse_Tabnabbing.md | full | `curl -sSL --compressed -A "Mozilla/5.0"`（HTTP 200 / 6,063バイト） | Tabnabbing 節が詳細を委譲していた OWASP 記事の全文。とくに**「Update 2023 — モダンブラウザでは修正済み（`target="_blank"` に暗黙の `rel="noopener"`）」**という、担当ページに一切書かれていない重大な留保（→ 付録D-3）。描画版 `owasp.org/www-community/...` は `EGRESS_BLOCKED` |
| `git show 9e82856c01f415ca1b5978b1ba1701a3769090a2:cheatsheets/HTML5_Security_Cheat_Sheet.md`（= `28151e3^`） | full | `git clone --filter=blob:none --no-checkout` + `git show`（985行 / 48,915バイト） | 初版 付録A-2 が「Java コードが数百行あるため全文引用していない」とした**旧 WebSocket implementation hints の残り3節の散文**（→ 付録D-4） |

〔補足（一般知識）〕上表の「取得方法」に挙げた raw.githubusercontent 経由は、OWASP Cheat Sheet Series の公開サイトが同リポジトリの `cheatsheets/*.md` を MkDocs でビルドしている、という公開された構成に基づく。差分が出る可能性があるのはナビゲーション・フッタ（最終更新日表示）等のサイト装飾部分のみで、本文・箇条書き・コード例は同一である。同じ理屈が MDN（`mdn/content` リポジトリ）、OWASP www-community、OWASP Secure Headers にも当てはまる（いずれも GitHub 上の Markdown / JSON を入力として各サイトが生成されている）。

### 担当URLの内容が最新であることの再確認（2026-09-18）

担当URLの正典ソースを本工程で再取得したところ、**160行 / 16,118バイト / md5 `4122279b7adafce78734c2b4286fc4c3`** で初版取得時と**バイト単位で完全一致**した。したがって **commit `00f27a7`（2026-05-29）以降、担当ページには改訂が入っていない**ことが確認できた。本ノートの逐語引用は 2026-09-18 時点で有効である。

## 要約

- OWASP HTML5 Security Cheat Sheet は、HTML5 が持ち込んだブラウザAPI群（Web Messaging, CORS, WebSocket, Server-Sent Events, Web Storage, クライアントDB, Geolocation, Web Workers, sandbox iframe, オフライン機能）を「安全に実装するための推奨事項リスト」である。攻撃手法カタログではなく、開発者向けチェックリスト形式。
- 全体を貫く原則は3つ。(1) 受信したものは常に**データとして扱い、コードやHTMLとして解釈しない**（`eval()` 禁止・`innerHTML` 禁止・`textContent` を使う）。(2) **オリジンは完全一致で検証する**（部分一致・`indexOf` は不可、`*` ワイルドカードは不可、allow-list 方式）。(3) **クライアント側の保存領域に機密を置かない**（XSS 1件で全部読まれる／ディスク上のプロファイルから読まれる）。
- postMessage は「送信側は targetOrigin を明示（`*` 禁止）」「受信側は `origin` 検証 + `data` の入力検証」「`data` を信用しない（送信ページの XSS 1件で任意形式のメッセージが飛んでくる）」の3点セット。
- CORS については、`Access-Control-Allow-Origin: *` を機密URLに付けない、ドメイン全体に付けない、`Origin` ヘッダを無検証でエコーしない、CORS は CSRF 対策にならない（別途CSRF対策必須）、プリフライトに依存せず `GET`/`POST` 単体でもアクセス制御する、といった具体項目が列挙される。
- 2023〜2026年の改訂で、**Web SQL Database は全主要ブラウザから削除**（Chromium 119 / 2023-10）、**Application Cache（appcache）も削除**（Firefox 85 / Chrome 93）となり、記述はそれぞれ「IndexedDB（+必要なら sqlite-wasm + OPFS）」と「Service Worker + Cache API」へ移行する内容に書き換えられた。Service Worker 固有のリスク（スコープ内の全リクエストを傍受可能、キルスイッチを用意せよ）が新規に追記されている。
- Tabnabbing（Reverse Tabnabbing）対策として `rel="noopener noreferrer"`、`window.open` の windowFeatures に `noopener,noreferrer`、`newWindow.opener = null`、`Referrer-Policy: no-referrer` が具体コード付きで示される。
- 2025年10月の改訂（PR #1824）で WebSocket の詳細記述は本ページから削除され、独立した **WebSocket Security Cheat Sheet** に移動した。したがって WebSocket の推奨事項（WSS必須、`Origin` 検証、CSWSH、`JSON.parse()`、`maxPayload`、`perMessageDeflate` 無効化等）は委譲先を読む必要がある（付録B に全項目を収録）。

補完工程（2026-09-18）で判明した、**担当ページを読むだけでは得られない重要事項**（詳細は付録D）:

- **Tabnabbing の重大度は 2023年に実質的に変わった。** OWASP 自身の www-community 記事は冒頭で「**これはモダンな evergreen ブラウザでは修正済み**」と明言している: `target="_blank"` は今や暗黙に `rel="noopener"` を持ち、これは **HTML 標準の一部**である（evergreen ブラウザは概ね2018年から対応）。また **`rel="noreferrer"` は `rel="noopener"` を含意する**ので併記は不要。**担当の HTML5 チートシートはこの留保に一切触れず「全リンクに付けよ」と無条件に書いている**ため、防御側の推奨（付ける）と診断側の重大度評価（単独では Informational になりがち）を教科書では必ず区別すること（付録D-3-a）。
- **`sandbox` 属性の最大の罠は `allow-scripts` と `allow-same-origin` の同時指定**である。MDN は「埋め込み文書が同一オリジンのとき両方を使うことは**強く非推奨**。それは**埋め込み文書が `sandbox` 属性自体を取り除くことを可能にし**、sandbox を使わないのと同程度の安全性しか残らない」と明記する。担当ページは「`sandbox` 属性を使え」「値で細かく制御できる」と述べるだけで、**トークン一覧もこの脱出条件も載せていない**（付録D-1）。
- **担当ページが列挙を放棄している HTTP セキュリティヘッダの実体**は、OWASP Secure Headers プロジェクトの機械可読リスト（`last_update_utc: 2026-09-13`）にあり、**追加すべき13件**と**削除すべき90件**からなる。推奨 CSP 値には **`frame-ancestors 'none'`** が含まれ、`X-Frame-Options: deny` と**併記**する構成が OWASP の推奨である（＝本ノートが〔補足〕で述べた CSP 代替論の裏づけ）。また **`Cross-Origin-Opener-Policy: same-origin`** は Tabnabbing と同じ脅威に効くヘッダレベルの根本対策だが、担当ページは言及していない（付録D-2）。
- **CSWSH の「根本原因」は旧版にだけ明示されていた。** 削除された旧 WebSocket 節は「**ブラウザが自動的に送るのではなく、クライアントコードが各やり取りごとに明示的に送るアクセストークンを使う認証方式を採れ**」という設計原則を掲げていた。現行版は「ブラウザが Cookie を自動で付けるので CSWSH に脆弱」と結果だけを述べる。`Origin` 検証は緩和策、この原則が根本対策という**2層構造**で書くと筋が通る（付録D-4-a）。

## 詳細ノート

以下、原文の見出し構造をそのまま保持する。出典はすべて
（出典: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html 、実取得は raw.githubusercontent の同内容 Markdown, commit `00f27a7`）。
箇条書きは原文の1 bullet = 1項目として漏れなく対応させ、コード・ヘッダ値・属性値・正規表現的な文字列は原文のまま逐語で示す。

---

### Introduction（はじめに）

原文はきわめて短い。「以下のチートシートは、HTML 5 を安全な方法で実装するためのガイドとして役立つ」（The following cheat sheet serves as a guide for implementing HTML 5 in a secure fashion.）とだけ述べる。つまりこの文書の位置づけは**実装ガイド／セキュア設計チェックリスト**であり、脆弱性の悪用手順書ではない。診断側から見れば「ここに書かれた各項目の否定形」がそのままテスト項目になる（例: targetOrigin が `*` になっていないか、origin 検証が部分一致になっていないか）。

---

### Communication APIs（通信API）— 大見出し

配下に Web Messaging / Cross Origin Resource Sharing / WebSockets / Server-Sent Events の4節を持つ。

---

#### Web Messaging（別名: Cross Domain Messaging、`postMessage`）

**前提の説明（原文の導入文）**: Web Messaging（Cross Domain Messaging とも呼ばれる）は、異なるオリジンのドキュメント間でメッセージを交換する手段を提供する。これは、過去に同じ目的のために使われてきた数々の hack（回避策）よりも一般に安全である。ただし、なお念頭に置くべき推奨事項がいくつか残っている。

原文の推奨事項（8項目、すべて列挙）:

1. **メッセージ送信時は、期待するオリジンを `postMessage` の第2引数として明示的に指定し、`*` を使わない。** 理由: リダイレクトやその他の手段でターゲットウィンドウのオリジンが変わった後に、未知のオリジンへメッセージを送ってしまうことを防ぐため。
   - 教科書向けの読み替え: `targetOrigin` を `*` にしていると、遷移先が攻撃者制御のオリジンに変わったタイミングでメッセージ（しばしばトークンやユーザー情報を含む）が漏れる。バグバウンティでは `postMessage(data, "*")` は定番の探索対象。
2. **受信側ページは「常に（always）」次の2つを行う**（原文は always を強調）。
   - 送信者の `origin` 属性をチェックし、データが期待した場所から来ていることを検証する。
   - イベントの `data` 属性に対して入力検証（input validation）を行い、想定した形式であることを確認する。
3. **`data` 属性を自分が制御できていると仮定しないこと。** 送信側ページに Cross Site Scripting（XSS）の欠陥が1つでもあれば、攻撃者は任意の形式のメッセージを送り込める。
4. **双方のページは、交換されるメッセージを「データ」としてのみ解釈すること。** 渡されたメッセージを決してコードとして評価（例: `eval()` 経由）したり、ページの DOM に挿入（例: `innerHTML` 経由）したりしてはならない。そうすると DOM-based XSS 脆弱性を作り込むことになる。詳細は DOM based XSS Prevention Cheat Sheet を参照。
5. **要素にデータ値を代入するときは、`element.innerHTML=data;` のような安全でない方法ではなく、より安全な `element.textContent=data;` を使う。**
6. **オリジンのチェックは、期待する FQDN に厳密一致（exactly match）させる。** 次のコードは非常に安全でなく、期望どおりの動作をしない: `if(message.origin.indexOf(".owasp.org")!=-1) { /* ... */ }` — なぜなら `owasp.org.attacker.com` がマッチしてしまうため。
7. **外部コンテンツ／信頼できないガジェットを埋め込み、かつユーザー制御のスクリプトを許可する必要がある場合**（これは強く非推奨 highly discouraged）、sandboxed frames の情報を参照すること。
8. （1〜7で全項目。原文の bullet 数は8で、うち1つは受信側の2つのサブ項目を持つ入れ子構造。）

##### コード/コマンド（原文のまま逐語）

安全でないオリジン検証の例（原文がアンチパターンとして提示）:

```javascript
if(message.origin.indexOf(".owasp.org")!=-1) { /* ... */ }
```

安全でない代入 / 安全な代入（原文の表記どおり）:

```javascript
element.innerHTML=data;   // insecure method（原文: a insecure method like）
element.textContent=data; // the safer option（原文: use the safer option）
```

〔補足（一般知識）〕原文が明示していない実装上の対応関係のみ補う: `postMessage` の第2引数は仕様上 `targetOrigin` と呼ばれる引数であり、受信側の `origin` は `MessageEvent.origin`、`data` は `MessageEvent.data` に対応する。原文はこれらを属性名 `origin` / `data` として参照している。

##### 診断観点（原文の各推奨の否定形として導出）

- `postMessage(..., "*")` を使っている送信側（第2引数が `*`、変数、あるいは `document.location.origin` 等の動的値）。
- `addEventListener("message", ...)` ハンドラで `event.origin` を一切見ていない、または `indexOf` / `startsWith` / 正規表現の部分一致で見ている（`owasp.org.attacker.com` 型のバイパス）。
- ハンドラ内で `event.data` を `innerHTML` / `document.write` / `eval` / `setTimeout(string)` / jQuery の `$()` 等に渡している（DOM-based XSS）。
- `event.data` を JSON として `eval()` でパースしている。
- 送信側の XSS が受信側の postMessage 経路に連鎖する構造（原文の推奨事項3が指摘している脅威モデル）。

---

#### Cross Origin Resource Sharing（CORS）

原文の推奨事項（7項目、すべて列挙）:

1. **`XMLHttpRequest.open` に渡される URL を検証する。** 現在のブラウザはこれらの URL がクロスドメインであることを許容しており、この挙動はリモートの攻撃者によるコードインジェクションにつながり得る。**絶対URL（absolute URLs）には特に注意を払う。**
2. **`Access-Control-Allow-Origin: *` で応答する URL に、機密のコンテンツや情報（攻撃者のさらなる攻撃を助けるような情報）を含めない。** `Access-Control-Allow-Origin` ヘッダは、クロスドメインでアクセスされる必要がある選ばれた URL に対してのみ使う。**ドメイン全体に対してこのヘッダを使わない。**
3. **`Access-Control-Allow-Origin` ヘッダでは、選別された信頼できるドメインのみを許可する。** 任意のドメインをブロックしたり許可したりするよりも、特定のドメインを許可する方式を選ぶ（`*` ワイルドカードを使わない、また `Origin` ヘッダの内容を何のチェックもせず盲目的に返さない do not use `*` wildcard nor blindly return the `Origin` header content without any checks）。
4. **CORS は、要求されたデータが権限のない場所へ行くことを防がないことを念頭に置く。** サーバ側で通常の CSRF 対策を行うことは依然として重要である。
5. **Fetch Standard は `OPTIONS` verb によるプリフライトリクエストを推奨しているが、現在の実装はこのリクエストを行わない場合がある。** そのため「通常の」（`GET` および `POST`）リクエストにおいても、必要なアクセス制御を実施することが重要である。
6. **HTTPS のオリジンから平文 HTTP 上で受信したリクエストは破棄する**（mixed content のバグを防ぐため）。
7. **アクセス制御のチェックを `Origin` ヘッダのみに依存しない。** ブラウザは CORS リクエストにおいて常にこのヘッダを送るが、ブラウザ外ではスプーフィング（偽装）され得る。機密データを保護するにはアプリケーションレベルのプロトコルを使うべきである。

##### 逐語で記録すべきヘッダ・語句

| 項目 | 原文の文字列（逐語） | 原文での扱い |
| --- | --- | --- |
| 危険な許可 | `Access-Control-Allow-Origin: *` | 機密情報を含むURLに付けてはならない |
| 対象ヘッダ | `Access-Control-Allow-Origin` | 選別した信頼ドメインのみ。ドメイン全体には付けない |
| 禁止パターン | `*` wildcard / blindly return the `Origin` header content | どちらも禁止（allow-list を使う） |
| プリフライト | `OPTIONS` | Fetch Standard が推奨するが、実装が送らないこともある |
| 通常リクエスト | `GET`, `POST` | これ単体でもアクセス制御を実施すること |
| 参照仕様 | https://fetch.spec.whatwg.org/#http-cors-protocol | Fetch Standard の HTTP CORS protocol 節 |
| 関連チートシート | Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md | CORS は CSRF 対策の代替にならない |
| 対象API | `XMLHttpRequest.open` | 渡すURLを検証。絶対URLに特に注意 |

##### 診断観点

- `Access-Control-Allow-Origin` に `Origin` をそのまま反射しており、かつ `Access-Control-Allow-Credentials: true` が付いている構成（原文の推奨3「盲目的に Origin を返すな」の直接の違反）。
- `Access-Control-Allow-Origin: *` を返す API が、認証不要でも「攻撃者の次の一手を助ける情報」（内部ホスト名、バージョン、ユーザー列挙材料など）を返していないか（推奨2）。
- ドメイン全体・全パスに一律で CORS ヘッダが付与されていないか（推奨2の後段）。
- CORS を「CSRF 対策済み」と誤認している実装（推奨4）。
- プリフライトの検証に依存し、単純リクエスト（`GET`/`POST` で simple content-type）でのアクセス制御が抜けていないか（推奨5）。
- HTTPS オリジンからの平文 HTTP リクエストを受け付けていないか（推奨6）。
- `XMLHttpRequest.open` の URL がユーザー入力（location.hash など）で組み立てられていないか（推奨1）。

---

#### WebSockets

**現行版の本文は1項目のみ**（2025年10月の PR #1824 で詳細が独立チートシートへ移動したため）:

- WebSocket 固有の保護策については WebSocket Security Cheat Sheet を参照すること。（原文: Check out [WebSocket Security Cheat Sheet](WebSocket_Security_Cheat_Sheet.md) to learn about WebSocket specific protections.）

→ **この委譲先の内容は本ノート「付録B」に全項目を収録した。** 旧版に載っていた WebSocket の推奨事項（RFC 6455、`ws://` 禁止、`Origin` 検証など）は「付録A」に逐語で保存した。教科書では、この2つを合わせて WebSocket 節を構成するのが正しい（現行の HTML5 チートシートだけを読むと WebSocket の中身がゼロになる）。

---

#### Server-Sent Events（SSE / `EventSource`）

原文の推奨事項（3項目、すべて列挙）:

1. **`EventSource` コンストラクタに渡される URL を検証する。** たとえ same-origin の URL のみが許可されているとしても検証すること（even though only same-origin URLs are allowed）。
2. **前述のとおり、メッセージ（`event.data`）はデータとして処理し、その内容を HTML やスクリプトコードとして評価してはならない。**
3. **メッセージの origin 属性（`event.origin`）を常にチェックし、メッセージが信頼できるドメインから来ていることを保証する。allow-list 方式を使う。**（原文: Use an allow-list approach.）

##### 逐語で記録すべきAPI名

- コンストラクタ: `EventSource`
- データ: `event.data`
- オリジン: `event.origin`

〔補足（一般知識）〕SSE は HTTP 上の単方向（サーバ→クライアント）ストリームで、`text/event-stream` を用いる。原文はメディアタイプに言及していないため、教科書に書く場合はこの補足であることを明示すること。

---

### Storage APIs（ストレージAPI）— 大見出し

配下に Local Storage / Client-side databases の2節。

---

#### Local Storage（別名: Offline Storage, Web Storage）

原文の推奨事項（8項目、すべて列挙）:

1. **Offline Storage、Web Storage とも呼ばれる。基盤となる保存メカニズムはユーザーエージェントごとに異なり得る。** 言い換えると、**アプリケーションが要求するあらゆる認証は、データが保存されているマシンに対してローカル権限を持つユーザーによってバイパスされ得る。** したがって、認証が前提とされるような機密情報を local storage に保存することは避けるべきである。
2. **ブラウザのセキュリティ保証により、データへのアクセスが認証・認可を前提としない場合には local storage の利用は適切である。**（＝機密でないデータには使ってよい、という肯定側の記述）
3. **永続的な保存が不要なら `localStorage` ではなく `sessionStorage` オブジェクトを使う。** `sessionStorage` オブジェクトは、そのウィンドウ／タブが閉じられるまで、そのウィンドウ／タブにのみ利用可能である。
4. **XSS が1件あれば、これらのオブジェクト内の全データを盗み出せる。** 繰り返すが、機密情報を local storage に保存しないことが推奨される。
5. **XSS が1件あれば、これらのオブジェクトに悪意あるデータを読み込ませることもできる。** したがって、これらの中のオブジェクトを信頼できるものと見なしてはならない（＝読み出し時に信頼しない）。
6. **HTML5 ページ内に実装された `localStorage.getItem` および `setItem` の呼び出しには特に注意を払う。**（原文は引用符付きで "localStorage.getItem" と "setItem" と記述）これは、開発者が機密情報を local storage に置くような実装をしている箇所を検出する助けになる。そのデータに対する認証・認可が誤って前提とされている場合、深刻なリスクになり得る。
7. **セッション識別子を local storage に保存してはならない。** データは常に JavaScript からアクセス可能だからである。**Cookie であれば `httpOnly` フラグを使ってこのリスクを軽減できる。**
8. **HTTP Cookie の `path` 属性のように、オブジェクトの可視範囲を特定のパスに制限する方法は存在しない。** すべてのオブジェクトはオリジン内で共有され、Same Origin Policy によって保護される。**同一オリジン上で複数のアプリケーションをホストすることは避ける**（それらはすべて同じ localStorage オブジェクトを共有してしまう）。**代わりに異なるサブドメインを使う。**

##### 逐語で記録すべきAPI名・フラグ

| 項目 | 原文の文字列（逐語） |
| --- | --- |
| 永続ストレージ | `localStorage` |
| セッション限定ストレージ | `sessionStorage`（ウィンドウ/タブを閉じるまで、そのウィンドウ/タブのみ） |
| 監視すべき呼び出し | `localStorage.getItem`, `setItem` |
| Cookie 側の緩和策 | `httpOnly` フラグ |
| Cookie にあって Web Storage にない機能 | Cookie の `path` 属性相当のパス制限（存在しない） |
| 保護境界 | オリジン単位（Same Origin Policy）。パス単位の分離は不可 |

##### 診断観点

- `localStorage` にセッショントークン / JWT / API キー / PII を保存している（推奨1・4・7）。
- 同一オリジン（同一ホスト・同一ポート・同一スキーム）に複数アプリを相乗りさせている → 片方の XSS で他方のストレージも読める（推奨8）。**対策は「別サブドメインに分ける」**。
- `localStorage` から読んだ値を検証せずに DOM に流している（推奨5：書き込み側も汚染され得るため、ストレージは untrusted source として扱う）。
- 永続不要なのに `localStorage` を使っている（推奨3）。

---

#### Client-side databases（クライアント側データベース）

**この節は2026年5月の PR #2188 で全面的に書き換えられた**（旧版は「Web SQL は2010年に非推奨」「WebDatabase は SQL インジェクションの可能性」という記述だった。旧文言は付録A参照）。現行の推奨事項（5項目、すべて列挙）:

1. **Web SQL Database は 2010年に W3C により非推奨とされ、すべての主要ブラウザから削除されている（removed from all major browsers）**: **Chromium はバージョン 119（2023年10月）でサポートを打ち切り**、Safari / Firefox はサードパーティオリジン向けには一度も出荷しなかった。**Web SQL を使ってはならない。** ブラウザ内で特に SQL インターフェースが必要な場合は、公式の **SQLite WebAssembly ビルド（`sqlite-wasm`）** のような組み込みエンジンを、**IndexedDB** または **Origin Private File System（OPFS）** を永続化層として動かす方式を選ぶこと。
   - 参照URL（原文）: https://sqlite.org/wasm/doc/trunk/about.md
2. **クライアント側の構造化ストレージの現行標準は IndexedDB である。** トランザクショナルな key-value ストアで、**2015年以降 W3C 勧告（W3C Recommendation）**であり、すべての evergreen ブラウザでサポートされる。
   - 参照URL（原文）: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
3. **基盤の保存メカニズムはユーザーエージェントと OS によって異なる。** ブラウザのプロファイルディレクトリに対するディスク上の読み取りアクセスを持つユーザー（**あるいはそのユーザー権限で動作する任意のプロセス、マルウェアを含む**）は、保存データを読み取り・改変できる。したがって**クライアント側ストレージが機密性を提供すると仮定してはならない**。**セッショントークン、資格情報、その他の秘密を IndexedDB に保存してはならない** — ただし、**それ自体がブラウザから復元できない鍵で暗号化されている場合は例外**（例: 永続化されないユーザー入力のパスフレーズから導出した鍵、あるいは **extractable でない（non-extractable）Web Crypto の `CryptoKey`** でラップした場合）。
   - 参照URL（原文）: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
4. **XSS が1件あれば IndexedDB 内の任意のデータを読み書きできる。** 読み出し時、その内容は untrusted input（信頼できない入力）として扱うこと。
5. **IndexedDB から来るデータには、ネットワークから来るデータと同じ入力検証・出力エンコーディングのルールを適用すること。**

##### 逐語で記録すべき固有名詞・バージョン

| 項目 | 原文の記述（逐語の要点） |
| --- | --- |
| Web SQL Database | W3C が 2010年に非推奨。全主要ブラウザから削除。**使用禁止** |
| Chromium | **version 119（October 2023）** でサポート打ち切り |
| Safari / Firefox | サードパーティオリジン向けには**一度も出荷せず**（never shipped it for third-party origins） |
| SQL が必要な場合の代替 | `sqlite-wasm`（公式 SQLite WebAssembly ビルド） |
| `sqlite-wasm` の永続化先 | IndexedDB または **Origin Private File System (OPFS)** |
| 現行標準 | **IndexedDB**（transactional key-value store, **W3C Recommendation since 2015**, 全 evergreen ブラウザ対応） |
| 機密を置く場合の唯一の例外 | ブラウザから復元不可能な鍵での暗号化。例: 永続化しないユーザー入力パスフレーズ由来の鍵、**non-extractable な Web Crypto `CryptoKey`** によるラップ |
| XSS の影響 | IndexedDB の任意データを read/write 可能。読み出し時は untrusted input 扱い |
| 適用すべきルール | ネットワーク由来データと同じ入力検証・出力エンコーディング |

---

### Geolocation（位置情報）

原文の推奨事項（1項目）:

- **Geolocation API は、位置を計算する前にユーザーエージェントがユーザーの許可を求めることを要求している。** この決定が記憶されるか、またどのように記憶されるかはブラウザによって異なる。**一部のユーザーエージェントでは、許可を求めずに位置を取得できる状態をオフにするには、ユーザーがそのページを再訪する必要がある。** そのため、**プライバシー上の理由から、`getCurrentPosition` または `watchPosition` を呼ぶ前にユーザーの入力（明示的な操作）を要求することが推奨される。**
  - 参照URL（原文）: https://www.w3.org/TR/2021/WD-geolocation-20211124/#security （Geolocation API の Working Draft 2021-11-24 の security 節）

##### 逐語で記録すべきAPI名

- `getCurrentPosition`
- `watchPosition`

##### 設計上のポイント（原文の趣旨の言い換え）

ページ読み込み直後に自動で位置情報を要求する設計は、(a) ユーザーが意図せず許可してしまうリスク、(b) 一度許可すると「取り消すにはページ再訪が必要」なブラウザ実装のため取り消しが困難、という2点で問題がある。**ユーザーのクリック等の明示的操作をトリガにしてから API を呼ぶ**のが原文の推奨。

---

### Web Workers

原文の推奨事項（3項目、すべて列挙）:

1. **Web Workers は `XMLHttpRequest` オブジェクトを使って、ドメイン内および Cross Origin Resource Sharing のリクエストを行うことが許されている。** CORS のセキュリティを確保するため、本チートシートの該当節を参照すること。
2. **Web Workers は呼び出し元ページの DOM にはアクセスできないが、悪意ある Web Worker は計算のために過剰な CPU を使い、Denial of Service 状態を引き起こしたり、Cross Origin Resource Sharing を悪用してさらなる攻撃を行うことができる。** すべての Web Worker スクリプト内のコードが悪意のないものであることを保証すること。**ユーザー提供の入力から Web Worker スクリプトを作成することを許してはならない。**
3. **Web Worker とやり取りするメッセージを検証すること。** `eval()` などで評価するための JavaScript の断片を交換しようとしてはならない。それは DOM Based XSS 脆弱性を導入し得る。

##### 診断観点

- `new Worker(userControlledUrl)` / `new Worker(URL.createObjectURL(new Blob([userInput])))` のように、ユーザー入力から Worker スクリプトを生成している（推奨2の直接の違反）。
- Worker と main thread 間の `postMessage` で JS コード文字列を送り、受け側で `eval()` している（推奨3）。
- Worker 内の `XMLHttpRequest`／fetch が CORS 経路を持つため、Worker は「DOM にアクセスできない代わりに、ネットワークアクセスを持つ実行環境」であることを忘れないこと（推奨1・2）。

---

### Tabnabbing（リバース・タブナビング）

**攻撃の説明（原文）**: 攻撃は OWASP の記事 https://owasp.org/www-community/attacks/Reverse_Tabnabbing に詳述されている。

**要約（原文の記述）**: 新しく開かれたページから、**opener** という JavaScript オブジェクトインスタンスが露出させる「戻りリンク（back link）」経由で、**親ページのコンテンツまたはロケーションに対して操作できてしまう能力**である。

**適用範囲（原文）**: これは、`target` 属性／命令を使って**現在のロケーションを置き換えない読み込み先（target loading location）**を指定し、その結果として現在のウィンドウ／タブを（新ページから）利用可能にしてしまう、HTML のリンクまたは JavaScript の `window.open` 関数に該当する。
- 参照URL（原文）: https://www.w3schools.com/tags/att_a_target.asp

**この問題を防ぐために利用できるアクション**（原文の構造: 「親ページと子ページの間の戻りリンクを切る」）:

- **HTML リンクの場合**:
  - この戻りリンクを切るには、親ページから子ページへのリンクを作成するタグに **`rel="noopener"`** 属性を追加する。この属性値はリンクを切るが、**ブラウザによっては、子ページへのリクエストに referrer 情報が含まれたままになる**。
  - **referrer 情報も取り除くには、次の属性値を使う: `rel="noopener noreferrer"`**。
- **JavaScript の `window.open` 関数の場合**: `window.open` 関数の **windowFeatures** パラメータに **`noopener,noreferrer`** という値を追加する。
  - 参照URL（原文）: https://developer.mozilla.org/en-US/docs/Web/API/Window/open

**ブラウザ間差異への対処（原文）**: 上記の要素を使った挙動はブラウザ間で異なるため、HTML リンクを使うか JavaScript でウィンドウ（またはタブ）を開くかのいずれであっても、**クロスブラウザ対応を最大化するために次の設定を使う**:

- **HTML リンクについては、すべてのリンクに `rel="noopener noreferrer"` 属性を追加する。**
  - 参照URL（原文）: https://www.scaler.com/topics/html/html-links/
- **JavaScript については、ウィンドウ（またはタブ）を開くために次の関数を使う**（下記コード）。
- **アプリケーションが送信するすべての HTTP レスポンスに、HTTP レスポンスヘッダ `Referrer-Policy: no-referrer` を追加する**（Header Referrer-Policy information: https://owasp.org/www-project-secure-headers/ ）。この設定により、そのページからのリクエストに referrer 情報が一切送られないことが保証される。

##### コード/コマンド（原文のまま逐語）

```javascript
function openPopup(url, name, windowFeatures){
  //Open the popup and set the opener and referrer policy instruction
  var newWindow = window.open(url, name, 'noopener,noreferrer,' + windowFeatures);
  //Reset the opener link
  newWindow.opener = null;
}
```

（原文のコードブロック言語指定は ``` javascript。コメントも原文のまま。ポイントは (a) windowFeatures 文字列の**先頭**に `'noopener,noreferrer,'` を連結している点、(b) その上で **`newWindow.opener = null;` で opener を明示的にリセット**している点の二重防御。）

##### 互換性マトリクス（原文が挙げるリンク集、逐語）

| 機能 | 原文が示す互換性確認先 |
| --- | --- |
| noopener | https://caniuse.com/#search=noopener |
| noreferrer | https://caniuse.com/#search=noreferrer |
| referrer-policy | https://caniuse.com/#feat=referrer-policy |

##### 逐語で記録すべき文字列（まとめ）

| 用途 | 値（逐語） |
| --- | --- |
| HTML リンク（最小） | `rel="noopener"` |
| HTML リンク（referrer も除去、推奨） | `rel="noopener noreferrer"` |
| `window.open` の windowFeatures | `noopener,noreferrer` |
| opener の明示リセット | `newWindow.opener = null;` |
| HTTP レスポンスヘッダ | `Referrer-Policy: no-referrer` |
| 関係する HTML 属性 | `target` |
| 露出するオブジェクト | `opener` |

---

### Sandboxed frames（サンドボックス化されたフレーム）

原文の推奨事項:

1. **信頼できないコンテンツには `iframe` の `sandbox` 属性を使う。**
2. **`iframe` の `sandbox` 属性は、`iframe` 内のコンテンツに対する制限を有効にする。`sandbox` 属性が設定されているとき、次の制限が有効になる**（原文は番号付きリストで5項目）:
   1. **すべてのマークアップは、ユニークなオリジン（unique origin）から来たものとして扱われる。**
   2. **すべてのフォームとスクリプトが無効化される。**
   3. **すべてのリンクは、他のブラウジングコンテキストを target にすることを防止される。**
   4. **自動的に発火するすべての機能（All features that trigger automatically）がブロックされる。**
   5. **すべてのプラグインが無効化される。**
3. **`sandbox` 属性の値を用いて `iframe` の能力に対する細かい制御（fine-grained control）を行うことが可能である。**
   - 参照URL（原文）: https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox
4. **この機能をサポートしない古いバージョンのユーザーエージェントでは、この属性は無視される。** したがって、この機能は**追加の防御層**として使うか、あるいは**ブラウザが sandboxed frames をサポートしているかを確認し、サポートされている場合にのみ信頼できないコンテンツを表示する**ようにすること。
5. **この属性とは別に、Clickjacking 攻撃や意図しないフレーミングを防ぐため、`deny` と `same-origin` の値をサポートする `X-Frame-Options` ヘッダの使用が推奨される。** **`if(window!==window.top) { window.top.location=location;}` のような framebusting 等の他の解決策は推奨されない（are not recommended）。**

##### コード/コマンド（原文のまま逐語）

推奨されない framebusting の例（原文がアンチパターンとして提示）:

```javascript
if(window!==window.top) { window.top.location=location;}
```

##### 逐語で記録すべき属性・ヘッダ値

| 項目 | 値（逐語） | 備考 |
| --- | --- | --- |
| 属性 | `sandbox`（`iframe` の属性） | 値を指定して fine-grained control 可能 |
| ヘッダ | `X-Frame-Options` | サポート値として原文は `deny` と `same-origin` を挙げる |
| 非推奨手法 | framebusting `if(window!==window.top) { window.top.location=location;}` | 推奨されない |

〔補足（一般知識）〕原文が挙げる `X-Frame-Options` の値表記は `deny` / `same-origin`（仕様上の正式表記は `DENY` / `SAMEORIGIN`）。原文の表記をそのまま引用したうえで、教科書では現在の標準的代替が CSP の `frame-ancestors` ディレクティブであることを補足すると良い（これは原文に記載がない補足）。

---

### Credential and Personally Identifiable Information (PII) Input hints（資格情報とPIIの入力ヒント）

原文の推奨事項:

- **入力値がブラウザによってキャッシュされることから保護する。**

原文は続けて引用ブロック（> 記法）でシナリオを示す:

> 公共のコンピュータから金融口座にアクセスする。ログオフしていたとしても、ブラウザのオートコンプリート機能のせいで、次にそのマシンを使う人がログインできてしまう。これを緩和するため、入力フィールドに対して「いかなる形でも支援しないように」指示する。
> （原文: Access a financial account from a public computer. Even though one is logged-off, the next person who uses the machine can log-in because the browser autocomplete functionality. To mitigate this, we tell the input fields not to assist in any way.）

**PII（氏名、メール、住所、電話番号）およびログイン資格情報（ユーザー名、パスワード）のためのテキストエリアと入力フィールドは、ブラウザに保存されないようにすべきである。フォームから PII がブラウザに保存されるのを防ぐため、次の HTML5 属性を使う**:

- `spellcheck="false"`
- `autocomplete="off"`
- `autocorrect="off"`
- `autocapitalize="off"`

##### コード/コマンド（原文のまま逐語）

```html
<input type="text" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"></input>
```

（原文どおり。`</input>` という閉じタグ付きの表記も原文のまま。）

##### 属性一覧（表として再現）

| 属性 | 値 | 目的（原文の趣旨） |
| --- | --- | --- |
| `spellcheck` | `"false"` | スペルチェック経由での入力値の外部送信・保持を防ぐ |
| `autocomplete` | `"off"` | ブラウザのオートコンプリート／オートフィルによる保存・再現を防ぐ |
| `autocorrect` | `"off"` | 自動修正を無効化 |
| `autocapitalize` | `"off"` | 自動大文字化を無効化 |

---

### Offline Applications（オフラインアプリケーション）

**この節は2026年5月の PR #2188 で全面的に書き換えられた**（旧版は appcache の `manifest` とキャッシュポイズニングの話だった。旧文言は付録A参照）。現行の推奨事項:

1. **HTML5 Application Cache（`<html manifest="...">` と `.appcache` ファイル）は、すべての主要ブラウザから削除されている（Firefox 85, Chrome 93）。** 新規アプリケーションでは使ってはならず、残っている利用箇所は **Service Workers と Cache API** に移行すること。
   - 参照URL（原文）: https://developer.mozilla.org/en-US/docs/Web/API/Cache
2. **Service Workers は別個のスクリプト可能なスレッド上で動作し、登録されたスコープに対するネットワークリクエストを傍受（intercept）する。キャッシュ済みレスポンスを透過的に返せるため、重大なセキュリティ上の影響を持つ**（以下、原文のサブ項目4点）:
   - **自分のオリジンからのみ Service Worker を登録し、worker スクリプトは HTTPS 上でのみ配信する（only serve the worker script over HTTPS）。** キャッシュバスティングのための長いファイル名を使う（例: **`sw.<hash>.js`**）。
   - **Service Worker のスコープが制限されていることを検証する**（`scope` オプション、または `Service-Worker-Allowed` レスポンスヘッダを使う）。これにより、侵害された worker が無関係なパスを傍受できないようにする。
   - **悪意ある、あるいは侵害された Service Worker は、unregister されるかキャッシュ TTL が切れるまで、そのスコープからの *すべての* リクエストを傍受できる。** **文書化されたキルスイッチ（kill-switch）を用意すること**（例: hotfix として出荷できる unregister フロー）。
   - **機密データを含むレスポンスをキャッシュしてはならない。** そのようなレスポンスには **`Cache-Control: no-store`** を送り、Cache API が保持しないようにする。

##### 逐語で記録すべき文字列・バージョン

| 項目 | 値（逐語） |
| --- | --- |
| 廃止された機能 | HTML5 Application Cache: `<html manifest="...">`, `.appcache` ファイル |
| 削除されたバージョン | **Firefox 85, Chrome 93** |
| 移行先 | **Service Workers** + **Cache API** |
| worker スクリプトの配信条件 | 自オリジンからのみ登録、**HTTPS のみ**、キャッシュバスティング名（例 `sw.<hash>.js`） |
| スコープ制限手段 | `scope` オプション / `Service-Worker-Allowed` レスポンスヘッダ |
| 侵害時の影響範囲 | スコープ内の *every* request を傍受（unregister または cache TTL 失効まで） |
| 必須の運用策 | 文書化されたキルスイッチ（unregister フローを hotfix で配れること） |
| 機密レスポンスの扱い | **`Cache-Control: no-store`** を付与し Cache API に保持させない |

##### 診断観点

- Service Worker スクリプト（`/sw.js` など）が、ユーザーがアップロードしたファイルを配信できるパスに置ける構成になっていないか（＝任意ファイルアップロード + `Service-Worker-Allowed` の組み合わせで、スコープを広げた永続的傍受に至る）。
- `scope` が `/` に設定され、必要以上に広いリクエストを傍受していないか。
- 認証済みレスポンスを Cache API に入れていないか（`Cache-Control: no-store` の欠如）。
- Service Worker を止める手段（unregister フロー）が用意されているか。原文はこれを**キルスイッチとして文書化せよ**と明示している。

---

### Progressive Enhancements and Graceful Degradation Risks（プログレッシブ・エンハンスメントと段階的劣化のリスク）

**この節も PR #2188 で書き換えられた**（旧版は「`<video>` タグ非対応なら Flash Player にフォールバックする」という例を挙げていた。旧文言は付録A参照）。現行の推奨事項:

- **現在のベストプラクティスは、ブラウザがサポートする能力（capabilities）を判定し、直接サポートされていない能力についてのみ代替手段で補うことである。** **廃れたブラウザプラグインにフォールバックしてはならない** — **Adobe Flash Player は 2020年12月31日に end-of-life に達し、すべてのブラウザから削除されている。Java アプレット、Silverlight、ActiveX も同様にサポートされていない。** **ネイティブの HTML5（`<video>`, `<audio>`, `<canvas>`, WebAssembly）がこれらのレガシー用途をカバーする。**

##### 逐語で記録すべき固有名詞・日付

| 項目 | 原文の記述（逐語の要点） |
| --- | --- |
| Adobe Flash Player | **end-of-life on 31 December 2020**、全ブラウザから削除 |
| その他サポート外 | **Java applets, Silverlight, ActiveX** |
| ネイティブ代替 | **`<video>`, `<audio>`, `<canvas>`, WebAssembly** |
| 原則 | capability detection を行い、直接サポートされない能力のみ代替する |

〔補足（一般知識）〕原文の趣旨は「機能検出（feature detection）で分岐し、フォールバック先に旧プラグインを置かない」こと。診断側の観点としては、レガシーフォールバック経路（古いプラグイン呼び出し、`<object>`/`<embed>` の残骸、条件分岐で読み込まれる外部スクリプト）が**レビューされていないコードパス**として残りやすい点が重要（旧版原文は「various sources からの追加のスクリプトコードはコードレビューされるべき」と述べていた。付録A参照）。

---

### HTTP Headers to enhance security（セキュリティを強化するHTTPヘッダ）

原文はこの節で具体的なヘッダを列挙せず、プロジェクトへ委譲している:

- **アプリケーションがブラウザレベルでの防御を有効化するために使うべき HTTP セキュリティヘッダの一覧を得るには、OWASP Secure Headers プロジェクトを参照すること。**
  - 参照URL（原文）: https://owasp.org/www-project-secure-headers/

〔補足（一般知識）〕本チートシート本文中で個別に言及されているヘッダは次の3つだけである（＝この節以外の箇所で出てくるもの）: `Access-Control-Allow-Origin`（CORS節）、`X-Frame-Options`（sandboxed frames節）、`Referrer-Policy: no-referrer`（Tabnabbing節）、および Service Worker 節の `Service-Worker-Allowed` と `Cache-Control: no-store`。教科書のヘッダ一覧表を作る場合は、この5つが「HTML5チートシート本文に登場するヘッダ」であることを明示するとよい。

---

## 付録A: 改訂で削除された旧版の記述（Git履歴から逐語で保存）

教科書執筆時、「昔のHTML5チートシートに書かれていた内容」を参照したい場合のために、Git 履歴（`git show`）から削除済みテキストを逐語で保存する。**これらは現行版には存在しない**ので、教科書に載せる際は必ず「旧版（〜2025年/〜2026年改訂前）の記述」と明記すること。
出典: OWASP/CheatSheetSeries リポジトリ commit `28151e3`（2025-10-01, PR #1824）および `00f27a7`（2026-05-29, PR #2188）の diff。

### A-1. 旧 WebSockets 節（commit 28151e3 で削除、内容は WebSocket Security Cheat Sheet へ移動）

削除された9項目（原文のまま、英語で逐語保存）:

```text
- Drop backward compatibility in implemented client/servers and use only protocol versions above hybi-00. Popular Hixie-76 version (hiby-00) and older are outdated and insecure.
- The recommended version supported in latest versions of all current browsers is [RFC 6455](http://tools.ietf.org/html/rfc6455) (supported by Firefox 11+, Chrome 16+, Safari 6, Opera 12.50, and IE10).
- While it's relatively easy to tunnel TCP services through WebSockets (e.g. VNC, FTP), doing so enables access to these tunneled services for the in-browser attacker in case of a Cross Site Scripting attack. These services might also be called directly from a malicious page or program.
- The protocol doesn't handle authorization and/or authentication. Application-level protocols should handle that separately in case sensitive data is being transferred.
- Process the messages received by the websocket as data. Don't try to assign it directly to the DOM nor evaluate as code. If the response is JSON, never use the insecure `eval()` function; use the safe option JSON.parse() instead.
- Endpoints exposed through the `ws://` protocol are easily reversible to plain text. Only `wss://` (WebSockets over SSL/TLS) should be used for protection against Man-In-The-Middle attacks.
- Spoofing the client is possible outside a browser, so the WebSockets server should be able to handle incorrect/malicious input. Always validate input coming from the remote site, as it might have been altered.
- When implementing servers, check the `Origin:` header in the Websockets handshake. Though it might be spoofed outside a browser, browsers always add the Origin of the page that initiated the Websockets connection.
- As a WebSockets client in a browser is accessible through JavaScript calls, all Websockets communication can be spoofed or hijacked through [Cross Site Scripting](https://owasp.org/www-community/attacks/xss/). Always validate data coming through a WebSockets connection.
```

日本語要約（各項目）:
1. hybi-00 以下（Hixie-76 = hybi-00 を含む）への後方互換を捨て、それより上のプロトコルバージョンのみを使う。古いものは時代遅れで安全でない。
2. 現行ブラウザの最新版がサポートする推奨バージョンは **RFC 6455**（Firefox 11+, Chrome 16+, Safari 6, Opera 12.50, IE10 でサポート）。
3. WebSocket で TCP サービス（例: VNC, FTP）をトンネルするのは比較的容易だが、そうすると XSS があった場合にブラウザ内の攻撃者がそれらのトンネル先サービスにアクセスできてしまう。悪意あるページやプログラムから直接呼ばれる可能性もある。
4. **プロトコル自体は認可／認証を扱わない。** 機密データを転送する場合は、アプリケーションレベルのプロトコルが別途それを扱うべき。
5. WebSocket で受信したメッセージはデータとして処理する。DOM に直接代入したり、コードとして評価したりしない。レスポンスが JSON の場合、安全でない `eval()` を絶対に使わず、安全な `JSON.parse()` を使う。
6. `ws://` プロトコルで露出したエンドポイントは容易に平文に戻せる。中間者攻撃（MITM）対策のためには **`wss://`（WebSockets over SSL/TLS）のみを使うべき**。
7. ブラウザ外からのクライアント偽装は可能なので、WebSocket サーバは不正／悪意ある入力を扱えなければならない。リモート側から来る入力は改変されている可能性があるため常に検証する。
8. **サーバ実装時は、WebSocket ハンドシェイクの `Origin:` ヘッダをチェックする。** ブラウザ外では偽装され得るが、ブラウザは常に接続を開始したページの Origin を付加する。
9. ブラウザ内の WebSocket クライアントは JavaScript 呼び出しからアクセス可能なので、**すべての WebSocket 通信は XSS によって偽装・ハイジャックされ得る**。WebSocket 接続を通って来るデータは常に検証する。

### A-2. 旧「WebSocket implementation hints」節（commit 28151e3 で削除。約825行、Java の実装例つき）

削除された大節の構造と冒頭部（逐語）:

```text
## WebSocket implementation hints

In addition to the elements mentioned above, this is the list of areas for which caution must be taken during the implementation.

- Access filtering through the "Origin" HTTP request header
- Input / Output validation
- Authentication
- Authorization
- Access token explicit invalidation
- Confidentiality and Integrity

The section below will propose some implementation hints for every area and will go along with an application example showing all the points described.

The complete source code of the example application is available [here](https://github.com/righettod/poc-websocket).
```

削除された小見出し（旧版の目次）:
- `### Access filtering`
- `### Authentication and Input/Output validation`
- `### Authorization and access token explicit invalidation`
- `### Confidentiality and Integrity`

旧「Access filtering」節の本文（逐語の要点）:

```text
During a websocket channel initiation, the browser sends the **Origin** HTTP request header that contains the source domain initiation for the request to handshake. Even if this header can be spoofed in a forged HTTP request (not browser based), it cannot be overridden or forced in a browser context. It then represents a good candidate to apply filtering according to an expected value.

An example of an attack using this vector, named *Cross-Site WebSocket Hijacking (CSWSH)*, is described [here](https://www.christian-schneider.net/CrossSiteWebSocketHijacking.html).

The code below defines a configuration that applies filtering based on an "allowlist" of origins. This ensures that only allowed origins can establish a full handshake:
```

日本語: WebSocket チャネルの開始時、ブラウザはハンドシェイク要求の発信元ドメインを含む **Origin** HTTP リクエストヘッダを送る。このヘッダは（ブラウザ以外からの）偽造 HTTP リクエストでは偽装できるが、**ブラウザのコンテキストでは上書き・強制ができない**。したがって、期待値に応じたフィルタリングを適用する良い候補となる。このベクタを使った攻撃の例が **Cross-Site WebSocket Hijacking (CSWSH)** であり、christian-schneider.net の記事で説明されている。

旧版が載せていた Java 実装例（`ServerEndpointConfig.Configurator` の `checkOrigin` による allow-list 検証。原文のまま逐語）:

```java
import org.owasp.encoder.Encode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.websocket.server.ServerEndpointConfig;
import java.util.Arrays;
import java.util.List;

/**
 * Setup handshake rules applied to all WebSocket endpoints of the application.
 * Use to setup the Access Filtering using "Origin" HTTP header as input information.
 *
 * @see "http://docs.oracle.com/javaee/7/api/index.html?javax/websocket/server/
 * ServerEndpointConfig.Configurator.html"
 * @see "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin"
 */
public class EndpointConfigurator extends ServerEndpointConfig.Configurator {

    /**
     * Logger
     */
    private static final Logger LOG = LoggerFactory.getLogger(EndpointConfigurator.class);

    /**
     * Get the expected source origins from a JVM property in order to allow external configuration
     */
    private static final List<String> EXPECTED_ORIGINS =  Arrays.asList(System.getProperty("source.origins")
                                                          .split(";"));

    /**
     * {@inheritDoc}
     */
    @Override
    public boolean checkOrigin(String originHeaderValue) {
        boolean isAllowed = EXPECTED_ORIGINS.contains(originHeaderValue);
        String safeOriginValue = Encode.forHtmlContent(originHeaderValue);
        if (isAllowed) {
            LOG.info("[EndpointConfigurator] New handshake request received from {} and was accepted.",
                      safeOriginValue);
        } else {
            LOG.warn("[EndpointConfigurator] New handshake request received from {} and was rejected !",
                      safeOriginValue);
        }
        return isAllowed;
    }

}
```

注記: 旧版のサンプルアプリ全体のソースは https://github.com/righettod/poc-websocket にあると原文が示している。`### Authentication and Input/Output validation`（旧版 238〜729行）、`### Authorization and access token explicit invalidation`（730〜942行）、`### Confidentiality and Integrity`（943行〜）の詳細な Java コードは、本ノートでは全文引用していない（分量が数百行あり、かつ現行版には存在しない・現行の WebSocket Security Cheat Sheet に相当内容が再構成されている）。**必要になった場合の再取得手順**は「読者が自分で開くべき資料」節に記載した。

### A-3. 旧 Client-side databases 節（commit 00f27a7 で置換）

```text
- On November 2010, the W3C announced Web SQL Database (relational SQL database) as a deprecated specification. A new standard Indexed Database API or IndexedDB (formerly WebSimpleDB) is actively developed, which provides key-value database storage and methods for performing advanced queries.
- Underlying storage mechanisms may vary from one user agent to the next. In other words, any authentication your application requires can be bypassed by a user with local privileges to the machine on which the data is stored. Therefore, it's recommended not to store any sensitive information in local storage.
- If utilized, WebDatabase content on the client side can be vulnerable to SQL injection and needs to have proper validation and parameterization.
- Like Local Storage, a single [Cross Site Scripting](https://owasp.org/www-community/attacks/xss/) can be used to load malicious data into a web database as well. Don't consider data in these to be trusted.
```

日本語の要点（旧版）: 2010年11月に W3C が Web SQL Database（リレーショナルSQLデータベース）を非推奨仕様と発表した。新標準の Indexed Database API / IndexedDB（旧称 **WebSimpleDB**）が活発に開発されており、key-value のデータベースストレージと高度なクエリ手段を提供する。／**WebDatabase を使う場合、クライアント側の内容は SQL インジェクションに脆弱になり得るため、適切な検証とパラメータ化（parameterization）が必要**（＝クライアントサイド SQL インジェクションという攻撃面が存在したという歴史的事実。現行版はこの記述を削除し「Web SQL は使うな」に置き換えた）。／XSS 1件で web database に悪意あるデータを読み込ませられるため、中のデータを信頼するな。

### A-4. 旧 Offline Applications 節（commit 00f27a7 で置換）

```text
- Whether the user agent requests permission from the user to store data for offline browsing and when this cache is deleted, varies from one browser to the next. Cache poisoning is an issue if a user connects through insecure networks, so for privacy reasons it is encouraged to require user input before sending any `manifest` file.
- Users should only cache trusted websites and clean the cache after browsing through open or insecure networks.
```

日本語の要点（旧版）: オフラインブラウジング用のデータ保存についてユーザーエージェントがユーザーに許可を求めるか、またこのキャッシュがいつ削除されるかはブラウザによって異なる。**安全でないネットワーク経由で接続する場合はキャッシュポイズニングが問題になる**ため、プライバシー上の理由から `manifest` ファイルを送る前にユーザーの入力を要求することが推奨される。／ユーザーは信頼できるウェブサイトのみをキャッシュし、オープンな／安全でないネットワークでの閲覧後にはキャッシュを消去すべき。

### A-5. 旧 Progressive Enhancements 節（commit 00f27a7 で置換）

```text
- The best practice now is to determine the capabilities that a browser supports and augment with some type of substitute for capabilities that are not directly supported. This may mean an onion-like element, e.g. falling through to a Flash Player if the `<video>` tag is unsupported, or it may mean additional scripting code from various sources that should be code reviewed.
```

日本語の要点（旧版）: ブラウザがサポートする能力を判定し、直接サポートされない能力を何らかの代替で補うのがベストプラクティス。これは「玉ねぎ状（onion-like）の要素」、例えば `<video>` タグが未サポートなら Flash Player にフォールバックする、という形になることもあり、あるいは**さまざまなソースから来る追加のスクリプトコード（コードレビューされるべきもの）**を意味することもある。

---

## 付録B: 委譲先 WebSocket Security Cheat Sheet の全項目

（出典: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html / 実取得は https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/WebSocket_Security_Cheat_Sheet.md , commit `05dcd35`）
担当ページの WebSockets 節がこの文書に丸投げしているため、WebSocket の推奨事項を落とさないよう全項目を収録する。

### B-0. Introduction

WebSockets はクライアントとサーバ間のリアルタイム双方向通信を可能にし、チャットシステム、ライブ取引プラットフォーム、共同編集ツールなどを支える。従来の HTTP リクエストと異なり、**WebSocket 接続は開いたままで、継続的なデータ交換を許す**。

**標準的なウェブアプリのセキュリティとは異なるセキュリティ課題**（原文の5項目、逐語の見出し付き）:

| 課題 | 原文の説明 |
| --- | --- |
| **Cross-Site WebSocket Hijacking (CSWSH)** | 攻撃者が悪意あるウェブサイトから認証済み接続をハイジャックする |
| **Authentication bypass** | 組み込みの認証がないため、アクセス制御を忘れやすい |
| **Injection attacks** | WebSocket メッセージは XSS、SQL インジェクション、その他の悪意あるペイロードを運べる |
| **Denial-of-service** | 持続的接続が、接続枯渇（connection exhaustion）のような新しい DoS 攻撃ベクタを可能にする |
| **Monitoring gaps** | 従来の HTTP ログは最初の upgrade リクエストしか捕捉せず、すべてのメッセージトラフィックを取り逃す |

**実世界の脆弱性（Real-world vulnerabilities、原文が挙げる2件）**:

| 事例 | 内容 | 参照URL（原文） |
| --- | --- | --- |
| **Gitpod CSWSH (2023)** | **不十分な origin 検証**により、ハイジャックされた WebSocket 接続を介した**完全なアカウント乗っ取り**が可能だった | https://github.com/advisories/GHSA-f53g-frr2-jhpf |
| **Spring RCE vulnerability** | **CVE-2018-1270**。細工された **STOMP** メッセージを通じて攻撃者がコード実行できた | https://spring.io/security/cve-2018-1270 |

### B-1. Primary Defenses > Transport Security

**Always Use WSS (WebSocket Secure)**: 本番で暗号化されていない `ws://` 接続を決して使わない。暗号化されていない `ws://` 接続は盗聴と改ざんを許す。

```javascript
// Secure - always use this
const socket = new WebSocket('wss://app.example.com/socket');

// Insecure - never use in production
// const socket = new WebSocket('ws://app.example.com/socket');
```

参照: Transport Layer Security Cheat Sheet。

**WebSocket Protocol Configuration**:
- **モダンなプロトコルバージョンを使う**: **RFC 6455**（現行の WebSocket 標準、https://datatracker.ietf.org/doc/html/rfc6455 ）のみをサポートする。既知のセキュリティ脆弱性がある **Hixie-76**（https://datatracker.ietf.org/doc/html/draft-hixie-thewebsocketprotocol-76 ）や **hybi-00**（https://datatracker.ietf.org/doc/html/draft-ietf-hybi-thewebsocketprotocol-00 ）のような古いバージョンへの後方互換を捨てる。
- **圧縮のセキュリティ**: 特に必要でない限り **`permessage-deflate` 圧縮を無効化する**。圧縮は **CRIME/BREACH** 攻撃に似た脆弱性（圧縮と秘密データの組み合わせで情報が漏れる）を持ち込み得る。

```javascript
// Node.js - disable compression for security
const wss = new WebSocket.Server({
  perMessageDeflate: false
});
```

**Infrastructure Configuration**:
- **プロキシとロードバランサのサポート**: リバースプロキシ、ロードバランサ、CDN が WebSocket の upgrade を扱えるよう設定する。
  - プロキシが HTTP/1.1 upgrade メカニズムをサポートするよう設定する
  - `Upgrade` および `Connection: upgrade` ヘッダを正しく通す
  - 長寿命接続のために適切な read timeout を設定する
  - WebSocket トラフィックがセキュリティポリシーでブロックされないようにする
- **WAF のサポート**: WAF が最初のハンドシェイクを越えて WebSocket トラフィックを検査できるか確認する。できない場合は、サーバ側の検証とアプリケーションログに依存する。

### B-2. Authentication and Authorization

WebSockets には組み込みの認証がない。**ブラウザは WebSocket ハンドシェイクリクエストに Cookie を含める**ため、WebSocket アプリケーションは **Cross-Site WebSocket Hijacking (CSWSH)** に脆弱になる。

**CSWSH の手順（原文の番号付き4ステップ、逐語訳）**:
1. ユーザーがアプリケーションにログインする（セッション Cookie が確立される）
2. ユーザーが後に悪意あるウェブサイトを訪れる
3. 悪意あるサイトがそのアプリケーションへの WebSocket を開く。ブラウザは自動的に Cookie を送る
4. サーバが接続を受け入れる → **攻撃者はライブで認証済みの WebSocket アクセスを得る**

**Origin Header Validation**: すべてのハンドシェイクで `Origin` ヘッダを検証する。常に信頼できるオリジンの**明示的な allowlist** を使う。ブラウザはこのヘッダを含め、**悪意ある JavaScript はこれを上書きできない**。

```javascript
const wss = new WebSocket.Server({
  verifyClient: (info) => {
    const allowedOrigins = ['https://app.example.com'];
    if (!allowedOrigins.includes(info.origin)) {
      console.log(`Rejected unauthorized origin: ${info.origin}`);
      return false;
    }
    return true;
  }
});
```

**重要（原文の Important）**: **denylist ではなく allowlist を使う。ワイルドカードや部分文字列マッチ（substring matching）は誤りやすいので避ける。**

**Additional CSWSH Protections**: すでに CSRF 対策を使っているアプリでは、**WebSocket のハンドシェイクに CSRF トークンを含める**。

**Session Management**（WebSocket 接続は通常のセッションより長生きすることが多く、特別な扱いが必要）:
- **SameSite Cookie を使う**（`SameSite=Lax` または `Strict`）。クロスサイトでの Cookie 送信を防ぎ、CSWSH 防御を強化する。
- **セッション期限切れを扱う**: 長時間動作する接続に対してサーバ側の検証を実装する。セッションが期限切れになったら WebSocket 接続を閉じる。**ユーザーセッションを定期的に再検証する（30分ごとが一般的）**。

```javascript
// Example: Close WebSocket on session expiry
function validateSession(ws, sessionId) {
  if (!isSessionValid(sessionId)) {
    ws.close(1008, 'Session expired');
    return false;
  }
  return true;
}
```

- **ユーザーがログアウトしたら、そのユーザーの全 WebSocket 接続を直ちに閉じる。** セッションとアクティブ接続のマッピングを保持し、ログアウトの瞬間に WebSocket アクセスを無効化できるようにする。
- **トークンベース認証**: Cookie のみに依存せずトークンベース認証を使う。トークンはクエリ文字列で渡せる（**注意: トークンがアクセスログに現れるので redact すべき**）か、接続確立後の WebSocket メッセージの一部として渡せる。メッセージベースのトークン受け渡しはログ露出を避けられるが、プロトコル設計上の考慮が必要。
- **トークンのリフレッシュ**: 長寿命接続ではトークンをローテートし、ハイジャックされたセッションが持続しないようにする。

**Message-Level Authorization**: WebSocket 接続 = 無制限のアクセス、と仮定しない。**アクションごとに認可をチェックする**。

```javascript
ws.on('message', (data) => {
  const message = JSON.parse(data);
  
  // Check authorization for each action
  if (message.action === 'delete_user' && !user.hasRole('admin')) {
    ws.send(JSON.stringify({type: 'error', message: 'Access denied'}));
    return;
  }
  
  handleAuthorizedMessage(ws, user, message);
});
```

### B-3. Input Validation

**すべての WebSocket メッセージを untrusted input として扱う。** WebSocket メッセージは SQLi、XSS、コマンドインジェクションのようなインジェクションペイロードを運べる。

- **メッセージの構造と内容を、JSON スキーマと allow-list を使って検証する。** 妥当なサイズ制限（**典型的には 64KB 以下**）を設定し、メッセージフラッディングを防ぐためレートリミットを実装する。
- **バイナリデータについては、content-type ヘッダを信用せず magic number でファイルタイプを検証する。** 必要に応じてアップロードをマルウェアスキャンし、protobuf や MessagePack のようなプロトコルには安全なデシリアライズを使う。

```javascript
ws.on('message', (data, isBinary) => {
  if (isBinary) {
    // Validate binary data
    if (data.length > MAX_BINARY_SIZE) {
      ws.close(1009, 'Message too large');
      return;
    }
    
    // Check file type by magic numbers
    if (!isValidFileType(data)) {
      ws.close(1008, 'Invalid file type');
      return;
    }
  }
  
  processBinaryData(data);
});
```

- **メッセージのリプレイ攻撃を防ぐため**、メッセージにタイムスタンプまたは nonce を含め、重複を拒否して古いメッセージが悪意をもって再送されないようにする。

```javascript
ws.on('message', (data) => {
  const message = JSON.parse(data);
  
  // Check timestamp or nonce to prevent replay
  if (!isValidNonce(message.nonce)) {
    ws.close(1008, 'Replay detected');
    return;
  }

  processMessage(message);
});
```

- **JSON 処理には常に `eval()` ではなく `JSON.parse()` を使う** — `eval()` は信頼できない入力からのコード実行を可能にする。

```javascript
// Safe
const message = JSON.parse(data);

// Dangerous - enables code execution
// const message = eval('(' + data + ')');
```

参照: Input Validation Cheat Sheet。

### B-4. Service Tunneling Risks

WebSockets は TCP サービス（**VNC, FTP, SSH**）をトンネルできるが、これはセキュリティリスクを生む。**アプリに XSS 脆弱性があれば、攻撃者は被害者のブラウザから直接これらのサービスにアクセスできる。** トンネリングが必要なら、WebSocket 層を越えた追加の認証とアクセス制御を実装する。

### B-5. Denial-of-Service Protection

持続的な WebSocket 接続は DoS リスクを高める。

- **接続とリソースを制限する**: 総接続数を制限し、**ユーザー単位の制限（推奨）**、またはユーザー識別ができない場合は **IP 単位の制限**を実装する。
- **メッセージサイズ制限**（典型的には **64KB 以下**）を設定し、**レートリミット**でメッセージフラッディングを防ぐ — **毎分100メッセージが一般的な出発点**。
- **アイドル接続と死んだ接続を扱う**: アイドルタイムアウトで非アクティブ接続を閉じる。**ping/pong フレームによるハートビート監視**で死んだ接続を検出・クリーンアップする。
- **バックプレッシャー制御を実装する**: 速いメッセージ生成者によるメモリ枯渇を防ぐ。**多くの WebSocket 実装は適切なフロー制御を欠いており**、攻撃者が処理速度より速くメッセージを送ることでサーバメモリを圧倒できる。

```javascript
const wss = new WebSocket.Server({
  maxPayload: 64 * 1024
});
```

### B-6. Security Monitoring and Logging

従来の HTTP アクセスログは最初の WebSocket upgrade リクエストしか捕捉せず、その後のメッセージトラフィックを捕捉しない。**認証失敗、インジェクション試行、レートリミット違反、悪用を取り逃すことになる。**

- **ログすべき WebSocket イベント**: 接続の確立と終了（**ユーザー識別情報、IP、origin を含む**）、ハンドシェイクおよびメッセージ処理中の認証・認可イベント、レートリミット発動やメッセージ検証失敗のようなセキュリティ違反、異常な切断とプロトコルエラー。
- **機密データのログを避ける**: メッセージ内容の全体、認証トークン、セッションID、プライバシー規制に違反し得る個人情報を決してログしない。

参照: Logging Cheat Sheet。

### B-7. Testing WebSocket Security（診断項目とツール）

**Key security tests（原文の5項目）**:

| テスト | 内容 |
| --- | --- |
| **Origin validation** | 認可されていないドメインから接続してみる |
| **Authentication bypass** | 適切な資格情報なしでの接続を試みる |
| **Message injection** | XSS、SQL インジェクション、コマンドインジェクションのペイロードを送る |
| **DoS resistance** | 接続数上限、メッセージフラッディング、過大メッセージをテストする |
| **Session management** | セッション期限切れとログアウト処理をテストする |

**Testing tools（原文の4項目、逐語）**:
- Browser developer tools for manual testing（手動テスト用のブラウザ開発者ツール）
- **[wscat](https://github.com/websockets/wscat)** for command-line WebSocket connections（コマンドラインからの WebSocket 接続）
- Custom scripts for automated vulnerability testing（自動脆弱性テスト用のカスタムスクリプト）
- **OWASP ZAP**（WebSocket セキュリティテスト機能を含む）

### B-8. Framework-Specific Best Practices

| フレームワーク | 原文の推奨（逐語の要点） |
| --- | --- |
| **Node.js** | `verifyClient` コールバックを origin と認証のチェックに使い、`maxPayload` 制限を設定し、`perMessageDeflate` 圧縮を無効化する |
| **Python** | Django Channels では認証ミドルウェアと origin 検証を実装する。不正な WebSocket メッセージによるアプリのクラッシュを防ぐため **async の例外ハンドリング**を使う |
| **Java Spring** | 許可オリジンを明示的に設定し、認可のために Spring Security を統合する。リソース枯渇を防ぐため WebSocket コンテナ設定でメッセージサイズ制限を設定する |
| **Go** | Gorilla WebSocket を使う場合、**`CheckOrigin` 関数に検証を実装する — 単に `true` を返してはいけない**。read limit を設定し、タイムアウトを実装し、優雅な接続クリーンアップのために context cancellation を使う |

**Keep Dependencies Updated**: WebSocket ライブラリを定期的に更新し、セキュリティアドバイザリを監視する。人気ライブラリ（**`ws`、Spring STOMP、Python `websockets`**）の過去バージョンには、DoS や RCE を含む重大な脆弱性があった。

### B-9. References（原文の参照一覧、逐語）

- Cross Site Scripting Prevention Cheat Sheet
- SQL Injection Prevention Cheat Sheet
- Authentication Cheat Sheet
- Session Management Cheat Sheet
- **CWE-1385: Missing Origin Validation in WebSockets** — https://cwe.mitre.org/data/definitions/1385.html

---

## 付録C: 教科書用まとめ表（原文の推奨事項を診断チェックリスト化）

原文の各推奨事項を「診断時に何を見るか」に変換した対応表。**「原文の根拠」列は上記詳細ノートの節を指す**（捏造項目なし）。

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
| 39 | WebSocket | `ws://`、`Origin` 未検証、`eval()` | `wss://`、`Origin` allowlist、`JSON.parse()`、`maxPayload`、`perMessageDeflate: false` | 付録B（委譲先）／付録A-1（旧版） |

---

---

## 付録D: 補完工程（2026-09-18）で追加取得した委譲先・関連一次資料

本ノート初版では「取得できなかった」「委譲先なので本ノートには無い」とされていた項目のうち、**別経路で一次資料に到達できたもの**をここに追記する。すべて実取得したファイルに基づき、出典URL・取得日・サイズを併記する。到達できなかったものは次節「読者が自分で開くべき資料」に残した。

### D-0. 再取得の試行結果（2026-09-18 実施）

| 対象 | 手段 | 結果 |
| --- | --- | --- |
| `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md` | `curl -sSL --compressed` | **HTTP 200。160行 / 16,118バイト / md5 `4122279b7adafce78734c2b4286fc4c3`** ＝ 初版取得時と**完全一致**。→ **本ノートの内容は 2026-09-18 時点でも最新**（commit `00f27a7` 以降、担当ページに改訂なし）と確認できた |
| `https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html`（担当URL・描画版） | WebFetch | `EGRESS_BLOCKED`（再試行しても同じ） |
| `https://web.archive.org/web/2024/...`（初版で failed だったURL） | WebFetch / `curl` | 失敗。WebFetch は「unable to fetch」、`curl` は CONNECT に 403 |
| `https://developer.mozilla.org/...` | WebFetch | `EGRESS_BLOCKED` |
| `https://owasp.org/...` / `https://owasp.github.io/...` | WebFetch | `EGRESS_BLOCKED` |

**失敗の性質（重要）**: これらは一時的な通信エラーではなく、**本作業環境のエグレスプロキシの組織ポリシーによる拒否**である。プロキシの手引き（`/root/.ccr/README.md`）は「403 / 407 はポリシー拒否であり、再試行も迂回もせず、ブロックされたホストを報告せよ」と明記している。したがって本ノートは**迂回を試みず**、各サイトが**ビルド入力として公開している正典ソース（GitHub 上の Markdown / JSON）**を取得する方針を採った。この方法で取得できる内容は描画版と同一であり（サイト装飾部分を除く）、技術内容の欠落はない。

---

### D-1. `iframe` の `sandbox` 属性に指定できる値の完全一覧（初版で「本チートシートには無い」と明記した欠落の補完）

初版の「読者が自分で開くべき資料」に「**`sandbox` 属性に指定できる値の完全な一覧**は本チートシートには載っておらず、WHATWG 仕様側にある」と書いた箇所の補完。WHATWG / MDN の描画版は egress 不可だが、**MDN の正典ソース（mdn/content リポジトリの Markdown）**から取得できた。

出典: `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/html/reference/elements/iframe/index.md` （HTTP 200 / 8,754バイト / 取得 2026-09-18）。描画版は `https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe` （本環境では egress 不可）。

**基本の挙動（MDN 原文の逐語訳）**: 「`sandbox` は `<iframe>` に埋め込まれたコンテンツに適用される制限を制御する。属性の値は、**すべての制限を適用するために空**にすることもでき、あるいは**特定の制限を解除する（lift particular restrictions）ためのスペース区切りトークン**にすることもできる。」
→ つまり `sandbox=""`（または値なし）が**最も強い**状態であり、トークンを追加するたびに**穴が開く**。診断では「どのトークンが付いているか」を数える。

**トークン全14種（原文の英語表記を逐語、説明は原文の要約）**:

| トークン（逐語） | 解除される制限（MDN の説明） |
| --- | --- |
| `allow-downloads` | `<a>` / `<area>` の `download` 属性経由、およびファイルダウンロードに至るナビゲーション経由でのファイルダウンロードを許可。**ユーザーがリンクをクリックしたか、JS がユーザー操作なしに開始したかを問わず**動作する |
| `allow-forms` | フォーム送信を許可。未指定ならフォームは通常表示されるが、送信しても入力検証もサーバ送信もダイアログクローズも起こらない |
| `allow-modals` | `Window.alert()` / `Window.confirm()` / `Window.print()` / `Window.prompt()` によるモーダル表示を許可（`<dialog>` はこのトークンに関係なく許可）。`BeforeUnloadEvent` の受信も許可 |
| `allow-orientation-lock` | 画面の向きのロックを許可 |
| `allow-pointer-lock` | Pointer Lock API の使用を許可 |
| `allow-popups` | ポップアップ（`Window.open()` や `target="_blank"` 等で作られるもの）を許可。未指定なら**黙って失敗（silently fail）**する |
| `allow-popups-to-escape-sandbox` | **サンドボックス化された文書が、サンドボックスフラグを強制せずに新しいブラウジングコンテキストを開くことを許可。** 例: サードパーティ広告を安全にサンドボックス化しつつ、広告のリンク先ページには同じ制限を強制しない。**このフラグが無ければ、リダイレクト先ページ・ポップアップ・新規タブは元の `<iframe>` と同じサンドボックス制限を受ける** |
| `allow-presentation` | iframe が presentation session を開始できるかを埋め込み側が制御することを許可 |
| `allow-same-origin` | **このトークンを使わない場合、リソースは「常に同一オリジンポリシーに失敗する特別なオリジン」から来たものとして扱われる**（データストレージ／Cookie や一部の JavaScript API へのアクセスを潜在的に阻止する） |
| `allow-scripts` | スクリプト実行を許可（ただしポップアップの作成は許可しない）。未指定ならこの操作は許可されない |
| `allow-storage-access-by-user-activation` | **（experimental）** iframe 内の文書が Storage Access API を使って非分割（unpartitioned）Cookie へのアクセスを要求することを許可 |
| `allow-top-navigation` | 最上位ブラウジングコンテキスト（`_top`）のナビゲーションを許可 |
| `allow-top-navigation-by-user-activation` | 同上だが、**ユーザージェスチャによって開始された場合のみ** |
| `allow-top-navigation-to-custom-protocols` | ブラウザ組み込みまたはサイトが `registerProtocolHandler` で登録した非 `http` プロトコルへのナビゲーションを許可。**この機能は `allow-popups` または `allow-top-navigation` によっても有効化される** |

**MDN が明示する危険な組み合わせ（逐語、教科書に必ず載せるべき）**:

> When the embedded document has the same origin as the embedding page, it is **strongly discouraged** to use both `allow-scripts` and `allow-same-origin`, as that lets the embedded document remove the `sandbox` attribute — making it no more secure than not using the `sandbox` attribute at all.

日本語: 埋め込まれた文書が埋め込み側ページと**同一オリジン**の場合、**`allow-scripts` と `allow-same-origin` の両方を使うことは強く非推奨**である。なぜなら、それは**埋め込まれた文書が `sandbox` 属性そのものを取り除くことを可能にし**、結果として `sandbox` 属性をまったく使わないのと同程度の安全性しか残らないからである。
→ **診断観点（最重要）**: `sandbox="allow-scripts allow-same-origin"` は**サンドボックス脱出（sandbox escape）**そのもの。同一オリジンのフレーム内スクリプトが親の DOM 経由で自分の `<iframe>` 要素の `sandbox` 属性を書き換え、再読み込みすれば制限なしで動く。ユーザー投稿コンテンツを「sandbox 付きだから安全」として同一オリジンで表示している実装は、この2トークン同時指定を探すだけで落ちることがある。

> Sandboxing is useless if the attacker can display content outside a sandboxed `iframe` — such as if the viewer opens the frame in a new tab. Such content should be also served from a _separate origin_ to limit potential damage.

日本語: **攻撃者がサンドボックス化された `iframe` の外側でコンテンツを表示できてしまうなら、サンドボックス化は無意味である**（例: 閲覧者がそのフレームを新しいタブで開いた場合）。被害を限定するため、**そうしたコンテンツは別オリジンから配信すべき**である。
→ 診断観点: ユーザー投稿 HTML を `sandbox` iframe で表示していても、その HTML が**直接URLでも到達可能**（`/uploads/xxx.html` 等）なら、sandbox を経由せず素のオリジンで実行できる。「sandbox iframe 経由だけ」を前提にした防御は、直接アクセス経路の有無を必ず確認する。

> When `allow-same-origin` is present, a same-origin parent document can still access and interact with the iframe's DOM even if `allow-scripts` is not set. The `allow-scripts` token only controls script execution within the embedded browsing context and does not affect DOM access from the parent.

日本語: `allow-same-origin` があるとき、同一オリジンの親文書は、**`allow-scripts` が設定されていなくても** iframe の DOM にアクセスし操作できる。`allow-scripts` は**埋め込まれたブラウジングコンテキスト内でのスクリプト実行のみ**を制御し、親からの DOM アクセスには影響しない。

**もうひとつの落とし穴（逐語訳）**: `sandbox` 属性付き `<iframe>` 内の埋め込みページから、ユーザーをリダイレクトしたり、ポップアップや新規タブを開いたりすると、**新しいブラウジングコンテキストも同じ `sandbox` 制限を受ける**。これは問題を生み得る。例えば `sandbox="allow-forms"` も `sandbox="allow-popups-to-escape-sandbox"` も設定されていない `<iframe>` 内のページが別タブで新しいサイトを開いた場合、**その新しいブラウジングコンテキストでのフォーム送信は黙って失敗する**。

〔補足（一般知識・原文外）〕`sandbox` はPDFビューア等の組み込み機能をブロックすることがある点も MDN が注記している。原文の注記であることを明示すれば教科書に載せてよい。

---

### D-2. OWASP Secure Headers プロジェクトの正典ヘッダ一覧（初版で「委譲先」としていた欠落の補完）

担当チートシートの「HTTP Headers to enhance security」節は**具体的ヘッダを一切列挙せず**、OWASP Secure Headers プロジェクトへ丸ごと委譲している。そのプロジェクトの描画版サイト（`owasp.org/www-project-secure-headers/` および `owasp.github.io/www-project-secure-headers/index/`）は本環境では egress 不可だが、**プロジェクトが機械可読形式で公開している正典リスト（JSON）**を取得できた。

出典:
- 追加すべきヘッダ: `https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json` （HTTP 200 / 1,738バイト）
- 削除すべきヘッダ: `https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_remove.json` （HTTP 200 / 2,235バイト）
- 両ファイルの自己申告メタデータ: **`"last_update_utc": "2026-09-13 06:28:41"`**（取得 2026-09-18 ＝ 5日前更新の最新版）

#### D-2-a. 追加すべきヘッダ（13件、値は逐語）

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

**担当チートシート本文との対応（教科書で結びつけるべき点）**:
- `Referrer-Policy: no-referrer` は Tabnabbing 節の推奨と**完全に一致**する（担当ページが「全レスポンスに付けよ」と言っていた値そのもの）。
- `X-Frame-Options: deny` は Sandboxed frames 節の推奨（原文表記 `deny` / `same-origin`）と一致する。加えて CSP 推奨値に **`frame-ancestors 'none'`** が含まれており、本ノートの Sandboxed frames 節の〔補足〕で「現在の標準的代替は CSP の `frame-ancestors`」と書いた点が、**OWASP 自身の推奨値によって裏づけられる**（＝両方を出す構成が OWASP の推奨）。
- `Cache-Control: no-store, max-age=0` は Offline Applications / Service Worker 節の `Cache-Control: no-store`（機密レスポンスを Cache API に保持させない）と整合する。
- `Permissions-Policy` に **`geolocation=()`** が含まれる点は、担当ページの Geolocation 節（ユーザー操作を起点にせよ）に対する**サーバ側の補完的な統制**として教科書で並べて示すと良い。
- `Cross-Origin-Opener-Policy: same-origin` は Tabnabbing（`opener` 経由の親ページ操作）に対する**ヘッダレベルの根本対策**であり、担当ページの `rel="noopener"` 系の対策と同じ脅威に効く。担当ページはこのヘッダに言及していないので、**Secure Headers 側からの補完**であることを明示して載せる。

#### D-2-b. 削除すべきヘッダ（90件、逐語の全リスト）

いずれも**製品名・バージョン・内部ホスト名・トレースIDなどを漏らすフィンガープリンティング／情報漏洩ヘッダ**である。診断レポートで「情報漏洩（低）」として挙げる際の**網羅的チェックリスト**として使える。

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

**教科書向けの読み方**: このリストは実質「**どのミドルウェア／APM／プロキシ／CMS が使われているかを当てるためのヘッダ辞書**」でもある。偵察（recon）の観点では、削除推奨リストに載っているヘッダが**残っていれば**技術スタックが判明する（例: `X-Kong-*` → Kong API Gateway、`X-Envoy-*` → Envoy/Istio、`X-dt*` / `X-ruxit-*` → Dynatrace、`X-Nextjs-*` → Next.js、`X-Atmosphere-*` → Atmosphere framework）。防御側チェックリストと攻撃側 recon 辞書が**同一のリスト**である好例として扱える。

---

### D-3. OWASP www-community「Reverse Tabnabbing」記事の全文（担当ページが詳細を委譲している先）

担当ページの Tabnabbing 節は攻撃の詳細を `https://owasp.org/www-community/attacks/Reverse_Tabnabbing` に委譲しているが、初版ではそのURLを挙げるだけで内容を取得できていなかった。**OWASP www-community リポジトリの正典 Markdown** から取得できた。

出典: `https://raw.githubusercontent.com/OWASP/www-community/master/pages/attacks/Reverse_Tabnabbing.md` （HTTP 200 / 6,063バイト / 取得 2026-09-18）。描画版は `https://owasp.org/www-community/attacks/Reverse_Tabnabbing` （本環境では egress 不可）。

#### D-3-a. 【最重要】記事冒頭の「Update 2023」— 担当チートシートには書かれていない重大な留保

記事は**冒頭第一節**でこう述べている（原文逐語）:

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

日本語（逐語訳）:
- **「2023年更新 — これはモダンな evergreen ブラウザでは修正済み」**
- `target="_blank"` を使うリンクは、**モダンブラウザでは今や暗黙的に `rel="noopener"` を持つ**ため、この脆弱性は以前ほど広範でも重大でもない。この暗黙ルールは **HTML 標準の一部**でもある（whatwg/html issue #4078）。
- Caniuse.com によれば、evergreen ブラウザは**2018年頃から**暗黙の `rel="noopener"` をサポートしている。ただし**サポートしないブラウザもまだ存在する**ので、`rel="noopener"` を外すかどうかを決める際は**自分のユーザー層を考慮せよ**。
- **`rel="noreferrer"` は `rel="noopener"` も含意する**ので、`rel="noreferrer"` を選んだなら `rel="noopener"` の併記は不要である。

**教科書での扱い（重要な注意）**: 担当の HTML5 チートシートの Tabnabbing 節は「全リンクに `rel="noopener noreferrer"` を付けよ」と**無条件に**書いており、この暗黙 noopener の話に**一切触れていない**。したがって教科書では次の2点を必ず併記すべきである。
1. **防御側の推奨は依然「明示的に付ける」**（HTML5 チートシート／古いブラウザ対応／`window.open` は暗黙化の対象外）。
2. **診断側の重大度評価は変わった**。`target="_blank"` だけで `rel` が無いリンクを見つけても、モダンブラウザでは `window.opener` が `null` になるため**実際には悪用できない**ことが多い。バグバウンティで「reverse tabnabbing」を単独で報告しても、**Informational / N/A になるのが通常**。悪用可能性を主張するなら、(a) `window.open()` 経路（暗黙 noopener の対象外）である、(b) 対象がサポート外の古いブラウザを公式サポートしている、(c) `opener` を実際に読み書きできることを PoC で示す、のいずれかが必要。**この「暗黙 noopener」の存在を知らずに報告する例が多い**ため、教科書の重大度判定の節に入れる価値が高い。

#### D-3-b. Description（攻撃の説明、逐語訳）

- **Reverse tabnabbing とは**、対象ページからリンクされたページが、**その対象ページを書き換えられる**攻撃である。例えばフィッシングサイトに置き換える。**ユーザーは元々正しいページにいたため、それがフィッシングサイトに変わったことに気づきにくい**。とくにそのサイトが対象と同じ見た目をしている場合はなおさらである。ユーザーがこの新しいページに認証すると、資格情報（またはその他の機密データ）は正規のサイトではなく**フィッシングサイトへ送られる**。
- リンク先サイト自身が対象ページを上書きできるだけでなく、**ユーザーが安全でないネットワーク（例: 公共 WiFi ホットスポット）にいる場合、任意の http リンクが偽装（spoof）されて対象ページを上書きできる**。**対象サイトが https のみで提供されていてもこの攻撃は成立する**。攻撃者はリンク先の **http サイトを偽装すればよいだけ**だからである。
  - → 教科書向けポイント: 「自サイトが HTTPS なら関係ない」は誤り。**リンク先が http の外部サイト**であれば、中間者がそのレスポンスを差し替えて `window.opener.location` を書ける。
- 攻撃が典型的に成立するのは、**発信元サイトが html リンクの `target` 命令で、現在のロケーションを置き換えない「target loading location」を指定し、現在のウィンドウ／タブを利用可能なまま残し、かつ後述の予防策をいずれも含んでいない**場合である。
- **`window.open` javascript 関数で開かれたリンクでも同様に成立する。**

#### D-3-c. Examples（原文のコード、逐語）

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

原文の説明: ユーザーが **Vulnerable Target** のリンク／ボタンをクリックすると、**Malicious Site** が新しいタブで開かれる（期待どおり）が、**元のタブにあった対象サイトはフィッシングサイトに置き換えられる**。

→ 診断観点: 悪意側のコードは `if (window.opener) { window.opener.location = ... }` の**2行だけ**。PoC が極めて短いので、暗黙 noopener が効いていないかの確認（`window.opener` が `null` か否か）を先に必ず行う。

#### D-3-d. Accessible properties — クロスオリジン時に `opener` から読める7プロパティ（逐語）

原文: 悪意あるサイトが**クロスオリジン（クロスドメイン）**アクセスの場合、**`opener`** javascript オブジェクト参照（実体は **`window`** javascript クラスインスタンスへの参照）から**アクセスできるのは次のプロパティのみ**である:

| プロパティ（逐語） | 原文の説明 |
| --- | --- |
| `opener.closed` | ウィンドウが閉じられたかどうかを示す boolean を返す |
| `opener.frames` | 現在のウィンドウ内のすべての iframe 要素を返す |
| `opener.length` | 現在のウィンドウ内の iframe 要素の数を返す |
| `opener.opener` | そのウィンドウを作成したウィンドウへの参照を返す |
| `opener.parent` | 現在のウィンドウの親ウィンドウを返す |
| `opener.self` | 現在のウィンドウを返す |
| `opener.top` | 最上位のブラウザウィンドウを返す |

**ドメインが同一の場合は、`window` javascript オブジェクト参照が公開するすべてのプロパティにアクセスできる。**

→ 教科書向けポイント: クロスオリジンでも `location` への**書き込み**は可能（だから攻撃が成立する）が、**読み取り**は上記7つに限られる。つまり reverse tabnabbing は「親ページの内容を盗む」攻撃ではなく「**親ページを置き換える**」攻撃である。影響を記述する際にこの区別を誤らないこと。`opener.frames` / `opener.length` からフレーム数という**わずかな情報漏洩**が生じる点も押さえる。

#### D-3-e. Prevention（原文の記述）

原文は予防策を**自前で書かず**、次のように述べている（逐語訳）: 「このページの最初の見出し **Update 2023** を確認してください。これは現在、すべてのモダンな evergreen ブラウザで自動的に防止されています。予防策の情報は **HTML5 Cheat Sheet** に文書化されているものを確認してください（リンク先は `https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#tabnabbing`）。」
→ **つまり担当ページと www-community 記事は相互参照の関係**にある。担当ページ = 対策（`rel`, windowFeatures, `Referrer-Policy`）、www-community 記事 = 攻撃の説明と 2023年の留保。教科書ではこの2つを合わせて1つの節にするのが正しい。

#### D-3-f. References（原文の参照一覧、逐語のURL付き）

| 参照 | URL |
| --- | --- |
| WHATWG HTML — Windows opened via `<a target="_blank">` should not have an opener by default | https://github.com/whatwg/html/issues/4078 |
| Caniuse — implicit `rel="noopener"` when using `target="_blank"` | https://caniuse.com/mdn-html_elements_a_implicit_noopener |
| Chrome Platform Status — Anchor `target="_blank"` implies `rel="noopener"` by default | https://chromestatus.com/feature/6140064063029248 |
| Chromium Issue 898942 | https://bugs.chromium.org/p/chromium/issues/detail?id=898942 |
| Mozilla Bugzilla 1522083 | https://bugzilla.mozilla.org/show_bug.cgi?id=1522083 |
| WebKit Bugzilla 190481 | https://bugs.webkit.org/show_bug.cgi?id=190481 |
| The `target="_blank"` vulnerability by example | https://dev.to/ben/the-targetblank-vulnerability-by-example |
| About `rel="noopener"` attribute values（Mathias Bynens） | https://mathiasbynens.github.io/rel-noopener/ |
| `target="_blank"` — the most underestimated vulnerability ever | https://medium.com/@jitbit/target-blank-the-most-underestimated-vulnerability-ever-96e328301f4c |
| Cure53 Browser Security WhitePaper | https://github.com/cure53/browser-sec-whitepaper/raw/master/browser-security-whitepaper.pdf |
| Reverse tabnabbing and blankshield demo | https://danielstjules.github.io/blankshield/ |

〔注記〕原文には画像参照（`TABNABBING_OVERVIEW_WITH_LINK.png` / `TABNABBING_OVERVIEW_WITHOUT_LINK.png`、「戻りリンクあり／なしの親子ページ関係図」）が2枚あるが、本ノートは画像を取得していない。教科書に図を入れる場合は自作するか、リポジトリの `assets/images/` から取得すること。

---

### D-4. 旧「WebSocket implementation hints」節の散文部分（初版 A-2 で「全文引用していない」とした欠落の補完）

初版の付録A-2 は、削除された約825行の大節のうち **Access filtering 節のみ**を逐語で保存し、残る3節（`Authentication and Input/Output validation` / `Authorization and access token explicit invalidation` / `Confidentiality and Integrity`）は「Java コードが数百行あるため全文引用していない」とした。本工程で**その3節の散文（設計指針）部分**を取得したので、ここに保存する。**Java コードそのものは分量の都合で骨格のみ**に留め、再取得手順は初版どおり有効である。

取得方法（実施ログ）:
```bash
git clone --quiet --filter=blob:none --no-checkout https://github.com/OWASP/CheatSheetSeries.git
git rev-parse 28151e3^      # => 9e82856c01f415ca1b5978b1ba1701a3769090a2
git show 9e82856c01f415ca1b5978b1ba1701a3769090a2:cheatsheets/HTML5_Security_Cheat_Sheet.md
```
取得物: **985行 / 48,915バイト**（現行版 160行 / 16,118バイト と比較すると、削除された分量の大きさがわかる）。旧版の節開始行: `## WebSocket implementation hints` = 165行、`### Access filtering` = 180行、`### Authentication and Input/Output validation` = 238行、`### Authorization and access token explicit invalidation` = 730行、`### Confidentiality and Integrity` = 943行。

#### D-4-a. 旧 `### Authentication and Input/Output validation` 節の散文（逐語）

```text
When using websocket as communication channel, it's important to use an authentication method allowing the user to receive an access *Token* that is not automatically sent by the browser and then must be explicitly sent by the client code during each exchange.

HMAC digests are the simplest method, and [JSON Web Token](https://jwt.io/introduction/) is a good feature rich alternative, because it allows the transport of access ticket information in a stateless and not alterable way. Moreover, it defines a validity timeframe. You can find additional information about JWT hardening on this [cheat sheet](JSON_Web_Token_for_Java_Cheat_Sheet.md).

[JSON Validation Schema](http://json-schema.org/) are used to define and validate the expected content in input and output messages.
```

日本語（逐語訳）:
1. **WebSocket を通信チャネルとして使う場合、「ブラウザによって自動的に送られるのではなく、クライアントコードが各やり取りのたびに明示的に送らなければならない」アクセス *Token* をユーザーが受け取る認証方式を使うことが重要である。**
2. **HMAC ダイジェストが最も単純な方法**であり、**JSON Web Token (JWT) が機能豊富な良い代替**である。なぜなら JWT は**ステートレスかつ改変不可能な形でアクセスチケット情報を輸送**でき、さらに**有効期間（validity timeframe）を定義する**からである。JWT の堅牢化については JSON Web Token for Java Cheat Sheet を参照。
3. **JSON Validation Schema**（json-schema.org）を使って、**入力メッセージと出力メッセージの両方**について期待される内容を定義し検証する。

**これが教科書で最も価値のある部分（CSWSH の根本原因の導出）**: 現行の WebSocket Security Cheat Sheet（本ノート付録B）は「ブラウザはハンドシェイクに Cookie を含めるので CSWSH に脆弱」と**結果**を述べるが、旧版はその**設計原則**を明示していた。すなわち「**ブラウザが自動送信する資格情報（Cookie）を WebSocket の認証に使うな。クライアントコードが明示的に毎メッセージ送るトークンを使え**」。CSWSH が成立する条件は「認証情報が自動送信される」ことそのものなので、この原則を守れば CSWSH は**構造的に**成立しない。`Origin` 検証は緩和策であり、こちらが根本対策である——という2層構造で教科書に書くと筋が通る。

**削除された Java コード成果物（見出しと旧版での行位置。中身は未引用）**:

| 成果物（原文の太字見出し） | 旧版の行 | 役割（原文の説明） |
| --- | --- | --- |
| **Authentication Web Socket endpoint** | 248 | 認証のやり取りを可能にする WS エンドポイントを提供する |
| **Authentication message handler** | 328 | すべての認証リクエストを処理する |
| **Utility class to manage JWT** | 416 | アクセストークンの発行と検証を扱う。例では単純な JWT を使用（焦点はWSエンドポイント実装全体にあるため追加の堅牢化はしていない） |
| **JSON schema of the input and output authentication message** | 479 | 認証エンドポイントの視点から、入力・出力メッセージの期待される構造を定義する |
| **Authentication message decoder and encoder** | 526 | 専用の JSON Schema を使って JSON のシリアライズ／デシリアライズと入出力検証を行う。**エンドポイントが受信・送信するすべてのメッセージが、期待される構造と内容を厳密に守ることを体系的に保証できるようにする** |

節末の注記（逐語）:
```text
Note that the same approach is used in the messages handling part of the POC. All messages exchanged between the client and the server are systematically validated using the same way, using dedicated JSON schemas linked to messages dedicated Encoder/Decoder (serialization/deserialization).
```
日本語: 同じアプローチが POC のメッセージ処理部分でも使われている。クライアントとサーバ間で交換される**すべてのメッセージ**が、メッセージ専用の Encoder/Decoder（シリアライズ／デシリアライズ）に紐づけた専用 JSON スキーマによって、**体系的に同じ方法で検証される**。

#### D-4-b. 旧 `### Authorization and access token explicit invalidation` 節の散文（逐語）

```text
Authorization information is stored in the access token using the JWT *Claim* feature (in the POC the name of the claim is *access_level*). Authorization is validated when a request is received and before any other action using the user input information.

The access token is passed with every message sent to the message endpoint and a denylist is used in order to allow the user to request an explicit token invalidation.

Explicit token invalidation is interesting from a user's point of view because, often when tokens are used, the validity timeframe of the token is relatively long (it's common to see a valid timeframe superior to 1 hour) so it's important to allow a user to have a way to indicate to the system "OK, I have finished my exchange with you, so you can close our exchange session and cleanup associated links".

It also helps the user to revoke itself of current access if a malicious concurrent access is detected using the same token (case of token stealing).
```

日本語（逐語訳）:
1. **認可情報は JWT の *Claim* 機能を使ってアクセストークン内に格納される**（POC では claim 名は **`access_level`**）。**認可はリクエストを受信した時点で、かつユーザー入力情報を使う他のいかなる処理よりも前に検証される。**
   - → 教科書向け: 「**認可チェックを、ユーザー入力を触る前に置く**」という順序の明示。現行版の「アクションごとに認可をチェックせよ」（付録B-2 Message-Level Authorization）に対応するが、旧版は**順序**まで指定している点がより具体的。
2. **アクセストークンはメッセージエンドポイントに送る全メッセージに付与され、ユーザーが明示的なトークン無効化を要求できるようにするために denylist が使われる。**
3. **明示的なトークン無効化がユーザー視点で重要な理由**: トークンを使う場合、**トークンの有効期間は比較的長いことが多い（1時間超の有効期間を見ることはよくある）**。そのため、ユーザーがシステムに対して「もうやり取りは終わったので、交換セッションを閉じて関連リンクをクリーンアップしてよい」と**伝える手段を持てるようにすることが重要**である。
4. **同じトークンを使った悪意ある同時アクセスが検出された場合に、ユーザー自身が現在のアクセスを取り消せるようにも役立つ（トークン盗用のケース）。**

**削除された Java コード成果物**:

| 成果物 | 旧版の行 | 役割（原文の説明） |
| --- | --- | --- |
| **Token denylist** | 740 | 使用を許可しなくなったトークンの**ハッシュ**の一時リストを、**メモリ上の時間制限付きキャッシュ（memory and time limited Caching）**で維持する |
| **Message handling** | 827 | リストへのメッセージ追加要求を処理する。**認可検証アプローチの実例**を示す |

→ 診断観点: 「denylist に**トークンそのものではなくハッシュ**を入れる」「TTL 付きキャッシュで持つ（トークンの有効期限より長く保持する必要はない）」という2点は、ログアウト実装をレビューする際の具体的チェック項目になる。現行版（付録B-2）の「ユーザーがログアウトしたら全 WebSocket 接続を直ちに閉じる」の**実装レベルの中身**がこれである。

#### D-4-c. 旧 `### Confidentiality and Integrity` 節（散文・コードともほぼ全量、逐語）

```text
If the raw version of the protocol is used (protocol `ws://`) then the transferred data is exposed to eavesdropping and potential on-the-fly alteration.

Example of capture using [Wireshark](https://www.wireshark.org/) and searching for password exchanges in the stored PCAP file, not printable characters has been explicitly removed from the command result:
```

```shell
$ grep -aE '(password)' capture.pcap
{"login":"bob","password":"bob123"}
```

```text
There is a way to check, at WebSocket endpoint level, if the channel is secure by calling the method `isSecure()` on the *session* object instance.

Example of implementation in the method of the endpoint in charge of setup of the session and affects the message handler:
```

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

```text
Expose WebSocket endpoints only on [wss://](https://kaazing.com/html5-websocket-security-is-strong/) protocol (WebSockets over SSL/TLS) in order to ensure *Confidentiality* and *Integrity* of the traffic like using HTTP over SSL/TLS to secure HTTP exchanges.
```

日本語（逐語訳）:
1. **プロトコルの生（raw）版（`ws://`）を使うと、転送データは盗聴と、飛行中の改変（on-the-fly alteration）の可能性に晒される。**
2. **Wireshark** で取得し、保存した PCAP ファイル内でパスワードのやり取りを検索した例（コマンド結果から印字不可文字は明示的に除去済み）: `grep -aE '(password)' capture.pcap` → `{"login":"bob","password":"bob123"}` が**平文でそのまま出てくる**。
   - → 教科書向け: `ws://` の危険性を**1行のコマンドで示せる**この実例は、現行版（付録B-1「暗号化されていない `ws://` 接続は盗聴と改ざんを許す」）の抽象的な記述より説得力がある。**pcap を `grep` するだけで資格情報が取れる**という具体性が重要。
3. **WebSocket エンドポイントのレベルで、チャネルが安全かどうかを *session* オブジェクトインスタンスの `isSecure()` メソッドを呼んで確認する方法がある。**
4. 実装例（上記 Java）: `@OnOpen` で、**`session.isSecure()` が真のときにだけメッセージハンドラを取り付け**、偽なら `CloseReason.CloseCodes.CANNOT_ACCEPT` と理由文字列 `"Insecure channel used !"` で**セッションを明示的に閉じる**。
   - → 診断観点: サーバ側が `wss://` を**強制しているか**。TLS 終端をリバースプロキシに任せていて、アプリ側から見ると `isSecure()` が偽になる構成（あるいはその逆で、平文 `ws://` を受け付けてしまう構成）は実務で頻出。
5. **HTTP のやり取りを HTTP over SSL/TLS で守るのと同様に、トラフィックの *Confidentiality* と *Integrity* を保証するため、WebSocket エンドポイントは `wss://` プロトコルのみで公開する。**

#### D-4-d. 旧版 → 現行版の対応表（教科書で「なぜ削除されたか」を説明するため）

| 旧版（HTML5 チートシート内、〜2025-10） | 現行の所在 | 差分の性質 |
| --- | --- | --- |
| Access filtering（`Origin` allow-list、CSWSH 言及、Java `checkOrigin`） | 付録B-2 Origin Header Validation（Node.js `verifyClient` の例に置換） | **保持**。言語が Java → JavaScript に、記述がより網羅的に |
| Authentication and I/O validation（「自動送信されないトークン」原則、JWT、JSON Schema） | 付録B-2 トークンベース認証 / B-3 Input Validation（JSON スキーマ） | **一部希薄化**。「ブラウザが自動送信しない資格情報を使う」という**原則の明示は現行版にない** → 本ノート D-4-a が唯一の記録 |
| Authorization and access token explicit invalidation（JWT claim、denylist、明示的失効） | 付録B-2 Message-Level Authorization / ログアウト時の全接続クローズ | **一部希薄化**。denylist にハッシュを入れる／TTL キャッシュという**実装粒度は現行版にない** |
| Confidentiality and Integrity（`ws://` の pcap grep 実例、`isSecure()`） | 付録B-1 Always Use WSS | **保持されたが実例は削除**。pcap grep の実演と `isSecure()` の存在は現行版にない |
| （現行版の新規追加） | 付録B-1 `permessage-deflate` / CRIME・BREACH、B-5 バックプレッシャー・DoS、B-6 ロギング、B-7 テスト、B-8 フレームワーク別 | **新規**。旧版にはなかった観点 |

→ **結論（教科書に書くべき判断）**: 旧版と現行版は**入れ替えではなく相補的**である。WebSocket の章を書くなら、現行版（付録B）を骨格にしつつ、旧版から (a) 「自動送信されない資格情報」原則、(b) `ws://` の pcap grep 実演、(c) トークン明示失効の denylist 設計、の3点を**「旧版の記述」と明記して**補うのが最も内容が濃くなる。

## 読者が自分で開くべき資料

### 1. https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html （担当URL / 本文は本ノートに全文反映済み）

**なぜ描画済みページを開けなかったか（2026-09-18 に再試行して同じ結果）**: 本作業環境のエグレスプロキシが `cheatsheetseries.owasp.org` / `owasp.org` / `owasp.github.io` / `developer.mozilla.org` / `web.archive.org` への接続を**組織のポリシーとして拒否**している（WebFetch は `EGRESS_BLOCKED`、`curl` は CONNECT に対し 403）。プロキシの手引きは「403 / 407 はポリシー拒否であり、**再試行も迂回もせず、ブロックされたホストを報告せよ**」と定めているため、本ノートは迂回を試みず、**各サイトがビルド入力として公開している正典ソース**（raw.githubusercontent.com 上の Markdown / JSON）を取得する方針を採った。**取得できなかったのはサイトの装飾部分（ナビゲーション、サイドバー、フッタの最終更新日表示）と記事内の図版画像のみで、技術内容の欠落はない。**

**読者がブラウザで開いたときの読みどころ**（★＝補完工程で本ノートに取り込み済み。読者が開く必要性は下がったが、原典確認用に残す）:
1. **本ノートより新しい改訂が入っていないかの確認** — 本ノートは 2026-05-29 の commit `00f27a7` 時点。**2026-09-18 時点では改訂なしと確認済み**（正典ソースが md5 まで一致）。以降の差分はページ下部／リポジトリのコミット履歴で確認する。**これが読者が実際に開く最大の理由**。
2. ★ **`sandbox` 属性に指定できる値の完全な一覧** — 本チートシートには載っておらず WHATWG / MDN 側にある、と初版で指摘した欠落。**付録D-1 に全14トークンと、`allow-scripts`+`allow-same-origin` によるサンドボックス脱出の警告を収録した。** WHATWG 仕様本文（`https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox`）を原典として読む場合は、各トークンが立てる「sandboxing flag」の定義（scripts / origin / forms / popups / top-level navigation 等の各フラグ）まで踏み込める点が MDN より詳しい。
3. **リンクされた兄弟チートシート** — DOM based XSS Prevention、Cross Site Scripting Prevention、CSRF Prevention、WebSocket Security。ch02 の内容はこれらと重複・補完関係にある。**本ノートでは WebSocket Security のみ全項目を取り込んだ（付録B）**ので、残る3つは別担当ノートまたは読者自身で読むこと。
4. ★ **OWASP Secure Headers プロジェクト** — 本チートシートは HTTP セキュリティヘッダの一覧を持たずここへ委譲している。**付録D-2 に、プロジェクトが公開する機械可読リスト（追加13件・削除90件、`last_update_utc: 2026-09-13`）を全件収録した。** 読者がサイト側を開く価値が残るのは、(a) 各ヘッダの**解説文と非推奨化の経緯**（JSON には値だけしか無い）、(b) **ブラウザ対応状況の表**、(c) 各言語／フレームワークでの**設定サンプル**の3点。
5. ★ **Reverse Tabnabbing の解説記事**（https://owasp.org/www-community/attacks/Reverse_Tabnabbing ） — Tabnabbing 節が詳細を委譲している先。**付録D-3 に全文（Update 2023 の留保、攻撃コード例、クロスオリジンで読める `opener` の7プロパティ、参照一覧）を収録した。** 記事には図版が2枚（`TABNABBING_OVERVIEW_WITH_LINK.png` / `..._WITHOUT_LINK.png` ＝ 戻りリンクあり／なしの親子ページ関係図）あり、**画像は本ノートに取り込めていない**。教科書に図を入れるなら読者が開いて確認するか、`https://raw.githubusercontent.com/OWASP/www-community/master/assets/images/` から取得すること。
6. **フッタの「最後に更新された日」表示** — MkDocs が生成する部分で正典 Markdown には含まれない。本ノートは代わりに **Git のコミット日時（`00f27a7` = 2026-05-29）**を使っているので、日付の食い違いが気になる場合のみ確認すればよい。

### 2. https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html （委譲先 / 付録B に全項目反映済み）

**読みどころ**:
1. **CSWSH の4ステップの流れ**と、Gitpod (2023) / CVE-2018-1270 の実例リンク。
2. **フレームワーク別ベストプラクティス表**（Node.js の `verifyClient`/`maxPayload`/`perMessageDeflate`、Go の `CheckOrigin`、Django Channels、Spring）。
3. **テスト項目とツール**（wscat、OWASP ZAP の WebSocket 機能）。
4. コード例の最新版（本ノート作成時点の commit は `05dcd35`）。

### 3. 旧版の WebSocket 実装例（Java、約825行）を読みたい場合の再取得手順

現行版・委譲先のいずれにも存在しないため、Git 履歴から取り出す必要がある。本ノート作成時に実際に成功した手順:

```bash
git clone --filter=blob:none --no-checkout https://github.com/OWASP/CheatSheetSeries.git
cd CheatSheetSeries
# WebSocket 詳細が削除される直前の版を全文表示
git show 28151e3^:cheatsheets/HTML5_Security_Cheat_Sheet.md
# 削除差分だけを見る
git show 28151e3 -- cheatsheets/HTML5_Security_Cheat_Sheet.md
# クライアントDB/オフライン/漸進的強化の書き換え差分
git show 00f27a7 -- cheatsheets/HTML5_Security_Cheat_Sheet.md
```

旧版の小見出しと該当行（`28151e3^` 時点）: `### Access filtering`（180行〜）、`### Authentication and Input/Output validation`（238行〜）、`### Authorization and access token explicit invalidation`（730行〜）、`### Confidentiality and Integrity`（943行〜）。サンプルアプリ全体は https://github.com/righettod/poc-websocket 。

旧版の小見出しと該当行（`28151e3^` 時点）については本節の上記記載のほか、**付録D-4 に3節分の散文を逐語収録した**（初版では未収録だった部分）。`28151e3^` の実体 SHA は **`9e82856c01f415ca1b5978b1ba1701a3769090a2`** で、`git show <SHA>:cheatsheets/HTML5_Security_Cheat_Sheet.md` で 985行 / 48,915バイトが得られる。**依然として本ノートに未収録なのは Java コードの本体**（`Authentication Web Socket endpoint`、`Authentication message handler`、`Utility class to manage JWT`、`JSON schema of the input and output authentication message`、`Authentication message decoder and encoder`、`Token denylist`、`Message handling` の7成果物、合計数百行）。**読者がこれを開くべき目的**: JSON Schema による入出力両方向の系統的検証を Java の Encoder/Decoder に結線する具体的な実装パターンを見るため。そこまでの実装粒度が教科書に不要なら、付録D-4 の散文だけで足りる。

### 4. 本ノートの逐語引用の検証方法

```bash
# 担当ページ本文および委譲先（現行版）
curl -sSL "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md"
curl -sSL "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/WebSocket_Security_Cheat_Sheet.md"
# 補完工程（付録D）で追加取得したもの
curl -sSL "https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/html/reference/elements/iframe/index.md"
curl -sSL "https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json"
curl -sSL "https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_remove.json"
curl -sSL "https://raw.githubusercontent.com/OWASP/www-community/master/pages/attacks/Reverse_Tabnabbing.md"
```

本ノート作成時の取得物: HTML5 = 160行 / 16,118バイト / md5 `4122279b7adafce78734c2b4286fc4c3`（**2026-09-18 に再取得して一致を確認**）、WebSocket = 274行 / 12,527バイト。補完工程の取得物: MDN iframe = 8,754バイト、headers_add.json = 1,738バイト、headers_remove.json = 2,235バイト（両JSON の `last_update_utc` = `2026-09-13 06:28:41`）、Reverse_Tabnabbing.md = 6,063バイト。

### 5. 本環境からは到達できず、内容を一切取り込めていない資料（読者が開く必要があるもの）

以下はいずれも**エグレスポリシーで拒否**され、正典ソースの代替も用意できなかったため、**本ノートには「そこに何が書かれているか」を書いていない**。教科書で該当箇所を扱う場合は読者が自分で開く必要がある。

| URL | 自動取得できない理由 | 読者が読むべきポイント（何を学ぶために読むか） | 代替手段 |
| --- | --- | --- | --- |
| https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox | 未試行（`html.spec.whatwg.org` は本環境で未検証。担当ページが `sandbox` の fine-grained control の参照先として挙げている一次仕様） | **各 `sandbox` トークンが立てる「sandboxing flag」の正式定義**（sandboxed scripting / sandboxed origin / sandboxed forms / sandboxed top-level navigation 等）。付録D-1 の MDN 記述は「何が許可されるか」の実務説明であり、**「なぜ `allow-scripts`+`allow-same-origin` で属性を外せるのか」の規範的な根拠**は仕様側にある。教科書でサンドボックス脱出を正確に説明するならここが原典 | 正典ソースは `https://github.com/whatwg/html`（`source` ファイル、巨大な単一 HTML）。実務上は MDN（付録D-1）で足りる |
| https://caniuse.com/mdn-html_elements_a_implicit_noopener | 未試行（`caniuse.com` は JS 必須のためテキスト取得に不向き） | **暗黙 `rel="noopener"` を「サポートしないブラウザ」が具体的にどれか**。付録D-3-a の「2018年頃から」「一部の非対応ブラウザが残る」という記述を、**診断時の重大度判定に使える具体的なブラウザ・バージョン表**に落とすため。`rel="noopener"` を外してよいかの判断材料でもある | 同種の情報は MDN の browser-compat-data（`https://github.com/mdn/browser-compat-data`、JSON）から取得可能。担当ページが挙げる `https://caniuse.com/#search=noopener` / `#search=noreferrer` / `#feat=referrer-policy` も同様 |
| https://owasp.org/www-community/assets/images/TABNABBING_OVERVIEW_WITH_LINK.png （および `..._WITHOUT_LINK.png`） | `owasp.org` が `EGRESS_BLOCKED`。また本ノートは画像を取得・解釈していない | **戻りリンクあり／なしの親子ページ関係図**。`rel="noopener"` の有無で `opener` 参照がどう切れるかを1枚で示す図。教科書の Tabnabbing 節に図を入れるなら流用または自作の参考にする | `https://raw.githubusercontent.com/OWASP/www-community/master/assets/images/` から直接取得できる可能性が高い（同リポジトリの Markdown は取得成功済み） |
| https://github.com/righettod/poc-websocket | 未取得（旧版が挙げるサンプルアプリ本体。本ノートの範囲外と判断） | 旧 WebSocket 節の Java 実装例が**動くアプリとして**どう組まれているか。`checkOrigin` の allow-list、JWT 発行・検証、JSON Schema による Encoder/Decoder、トークン denylist が**1つのアプリ内でどう結線されるか**を通しで見るため | `git clone https://github.com/righettod/poc-websocket`。ただし旧版由来であり現行の WebSocket Security Cheat Sheet（付録B）とは構成が異なる点に注意 |
| https://sqlite.org/wasm/doc/trunk/about.md | 未試行（担当ページが Web SQL の代替として挙げる参照先） | **`sqlite-wasm` が IndexedDB / OPFS をどう永続化層として使うか**。担当ページは「SQL インターフェースが必要ならこれを使え」と言うだけなので、**OPFS を使う構成のセキュリティ含意**（同一オリジン内で XSS 1件あれば DB ファイル全体が読める、等）は原典で確認する必要がある | 同内容は `https://github.com/sqlite/sqlite-wasm` 等のミラーにもある |
| https://www.christian-schneider.net/CrossSiteWebSocketHijacking.html | 未試行（旧版が CSWSH の原典として挙げる記事） | **CSWSH の初出解説**。付録B-2 は攻撃の4ステップを示すが、この記事は**検出方法と PoC の作り方**まで踏み込んでいるとされる。バグバウンティで CSWSH を実証するなら原典 | `web.archive.org` は本環境では不可。読者の環境では `https://web.archive.org/web/2023/https://www.christian-schneider.net/CrossSiteWebSocketHijacking.html` が有効なはず |

〔重要な注記〕**上表の「読者が読むべきポイント」は、各資料が扱う主題から導いた「何を確認するために開くか」の指示であり、その資料の内容を読んだ上での要約ではない。** 本ノートは未取得資料の中身を一切記述していない。
