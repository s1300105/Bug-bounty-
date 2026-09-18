# [10] OWASP「HTTP Security Response Headers Cheat Sheet」精読ノート（想定章: ch02）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html | full | Bash curl → `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTTP_Headers_Cheat_Sheet.md`（HTTP 200 / 21,499 bytes） | **レンダリング済みHTMLは取得不可**。`cheatsheetseries.owasp.org` は本環境のegressプロキシで拒否（WebFetch: `EGRESS_BLOCKED`、curl: `CONNECT tunnel failed, response 403 / connect_rejected`）。`web.archive.org` も同様に403で拒否。そのため**当該HTMLページの生成元である正典Markdownソース（OWASP/CheatSheetSeries リポジトリ master ブランチ）を取得**し、全文（見出し・本文・表・コードブロック・推奨値文字列・リンク）を逐語で確保した。内容欠落なしと判断し `full` とする。`main` ブランチは存在せず404、`master`/`HEAD` が同一内容。 |
| （参照先1）https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Session_Management_Cheat_Sheet.md | full（Cookies節を抽出） | Bash curl（HTTP 200 / 54,326 bytes） | 原典が Set-Cookie の詳細をこの資料に委譲しているため補完取得。原典本体ではない参照先資料。 |
| （参照先2）https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json および `ci/headers_remove.json` | full | Bash curl（両方 HTTP 200） | 原典の References に載る OWASP Secure Headers Project の機械可読な推奨ヘッダ定義。原典に無い `Clear-Site-Data` / `X-Permitted-Cross-Domain-Policies` の推奨値と、削除すべきヘッダ全リストを含む。`last_update_utc: 2026-09-13 06:28:41`。 |
| https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/index.md | partial | Bash curl（HTTP 200 / 638 bytes） | 中身は `https://owasp.github.io/www-project-secure-headers/index/` へのリダイレクト用スタブのみ。実質的な情報なし。 |

## 要約（3〜10行）

- 本チートシートは「HTTPレスポンスヘッダは実装が容易なわりに効果の大きいセキュリティ強化手段」という立場で、XSS・クリックジャッキング・情報開示などの脆弱性を軽減するヘッダを列挙し、各ヘッダごとに **推奨値を1行の引用ブロック（「> （引用記号）＋コード体の `Header: value`」の形式）で明示**する構成を取る。
- 大きく3部構成: (1) Security Headers（各ヘッダの説明＋Recommendation）、(2) Adding HTTP Headers in Different Technologies（PHP / Apache / IIS / HAProxy / Nginx / Express の設定例）、(3) Testing Proper Implementation（Mozilla Observatory、SmartScanner）。
- **非推奨ヘッダには見出しに ❌ が付く**: `Expect-CT ❌`（Mozillaが回避・既存コードからの削除を推奨）と `Public-Key-Pins (HPKP) ❌`（2018年にChromiumから削除、全モダンブラウザで非サポート）。`X-XSS-Protection` は「安全なサイトにXSSを作り込みうる」ため `0` で明示的にオフにするか設定しないことが推奨。
- 複雑なヘッダ（CSP、HSTS、Set-Cookie）は専用チートシートへ委譲する設計。CSP は `Content_Security_Policy_Cheat_Sheet.md`、HSTS は `HTTP_Strict_Transport_Security_Cheat_Sheet.md`、Cookie属性は `Session_Management_Cheat_Sheet.html#cookies`。
- **適用範囲に関する繰り返される注意**: ヘッダはブラウザが解釈して初めて意味を持つため、リダイレクトやJSONを返すAPIレスポンスでは `X-Frame-Options` は何も守らない（操作対象＝リンクやボタンが無い）。CSP も「スクリプトやコードを読み込んで解釈するページ」に意味があり、レンダリングされないREST APIレスポンスでは無意味な場合がある。COOP/COEP/CORP も非ブラウザクライアント向けAPIには適用意義が薄い。
- 情報漏えい系ヘッダ（`Server`, `X-Powered-By`, `X-AspNet-Version`, `X-AspNetMvc-Version`）は削除または非情報値に。ただし**いずれの項にも「攻撃者はサーバ技術をフィンガープリンティングする別手段を持つ」という注意が明記**されており、過大評価しないことが原典の姿勢。
- 新しめの項として `X-Robots-Tag`（クローラ制御。準拠クローラのみ従い、かつヘッダを読むにはHTTPリクエストが必要という限界を明記）、`Cache-Control`（`no-cache` はキャッシュを防がない、という誤解の明示的な訂正）、`Secure File Download Headers`（ユーザ提供ファイル配信時の3ヘッダ組み合わせ）がある。

---

## 詳細ノート

### 【早見表】全ヘッダの推奨値と理由（出典: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html）

原典は表形式ではなく節ごとの記述だが、後工程での参照性のため原典の推奨値文字列を**逐語のまま**表に再構成した（値は一切改変していない）。

| # | ヘッダ | 原典の推奨値（逐語） | 目的／推奨理由（原典の記述） | 原典の注記・区分 |
|---|---|---|---|---|
| 1 | `X-Frame-Options` | `X-Frame-Options: DENY` | `<frame>` / `<iframe>` / `<embed>` / `<object>` でのレンダリング可否を示し、自サイトのコンテンツが他サイトに埋め込まれないようにしてクリックジャッキングを防ぐ | 可能なら CSP `frame-ancestors` を使う。対応ブラウザでは CSP frame-ancestors が X-Frame-Options を obsolete にする。リダイレクトやJSONを返すAPIでは無意味 |
| 2 | `X-XSS-Protection` | `X-XSS-Protection: 0` | 反射型XSSを検出してページ読み込みを停止するIE/Chrome/Safariの機能。**ただし本来安全なサイトにXSS脆弱性を作り出す場合がある** | WARNING付き。インラインJavaScriptを禁じるCSPを使うのが推奨。設定しない、または明示的にオフ（`0`） |
| 3 | `X-Content-Type-Options` | `X-Content-Type-Options: nosniff` | Content-Type で宣言したMIMEタイプに従わせ、推測（MIMEスニッフィング）を禁じる。非実行MIMEタイプが実行可能MIMEタイプに変換される「MIME Confusion Attacks」をブロック | 併せてサイト全体で Content-Type を正しく設定すること |
| 4 | `Referrer-Policy` | `Referrer-Policy: strict-origin-when-cross-origin` | Referer ヘッダで送られるリファラ情報の量を制御 | ブラウザは2014年から対応。現代ブラウザの既定は「同一サイトには全情報、他サイトにはoriginのみ」だが、最新ブラウザでないユーザもいるため全レスポンスで明示送信することを推奨 |
| 5 | `Content-Type` | `Content-Type: text/html; charset=UTF-8` | リソースの元のメディアタイプを示す。誤設定だと画像などがHTMLとして解釈されXSSが成立し得る | `charset` 属性は**HTML**ページのXSS防止に必須。値は任意のMIMEタイプでよい。「レンダリングされる意図があり、かつリソースが信頼できない（ユーザ提供・改変可能）」場合にのみ脆弱性となる |
| 6 | `Cache-Control` | （単一の推奨文字列ではなく箇条書き指針。下記本文参照） | ブラウザと中間キャッシュによるレスポンスのキャッシュ方法を定義 | 機微データには `no-store`。`private` は非共有キャッシュのみ許可（ただしprivateキャッシュは残り得る）。**`no-cache` はキャッシュを防がない** |
| 7 | `Set-Cookie` | （原典に推奨値なし。Session Management Cheat Sheet に委譲） | サーバからUAへCookieを送る。複数Cookieは同一レスポンス内に複数の Set-Cookie ヘッダで送る | **それ自体はセキュリティヘッダではないが、そのセキュリティ属性が極めて重要** |
| 8 | `Strict-Transport-Security` (HSTS) | `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` | ユーザがHTTPで接続しようとしてもHTTPSのみでアクセスするようブラウザに指示 | 使う前に動作を熟読すること。誤設定やSSL/TLS証明書の問題（長い期間設定＋証明書の期限切れ・失効）で**正規ユーザがmax-age満了までアクセス不能**になり得る |
| 9 | `Expect-CT` ❌ | **使用しない** | Certificate Transparency 要件の報告をオプトインする。主流クライアントが既にCT適格性を要求するため、残る価値は report-uri への報告のみ。今は強制よりも検出/報告の位置づけ | Mozillaが回避を推奨。可能なら既存コードからも削除 |
| 10 | `Content-Security-Policy` (CSP) | （原典に推奨値なし。CSP Cheat Sheet に委譲） | 読み込み許可するコンテンツのoriginを指定。XSSやデータインジェクション（データ窃取・サイト改ざん・マルウェア配布に使われる）を検出・軽減する追加の層 | 設定と維持が複雑。スクリプト/コードを読み込み解釈するページに意味があり、レンダリングされないREST APIレスポンスでは無意味な場合がある |
| 11 | `Access-Control-Allow-Origin` | `Access-Control-Allow-Origin: https://yoursite.com` | CORSヘッダ。レスポンスを指定originの要求コードと共有してよいかを示す。**このヘッダを使わなければサイトは既定でSame Origin Policy(SOP)に守られており、このヘッダはその制御を特定条件下で緩めるもの** | `*` ではなく具体的なoriginを設定する。ただし任意originからアクセスされるべき公開APIなど、`*` が必要な場合もある |
| 12 | `Cross-Origin-Opener-Policy` (COOP) | `Cross-Origin-Opener-Policy: same-origin` | トップレベル文書がクロスオリジン文書とブラウジングコンテキストグループを共有しないことを保証。ブラウジングコンテキストを同一オリジン文書のみに隔離 | COEP・CORPと連携。**同一ブラウジングコンテキストグループ内リソースに対するSOPの境界を越えうるSpectreのような攻撃**を防ぐ。非ブラウザ/REST APIには適用意義が薄い |
| 13 | `Cross-Origin-Embedder-Policy` (COEP) | `Cross-Origin-Embedder-Policy: require-corp` | 文書に明示的な許可（CORP または CORS）を与えないクロスオリジンリソースの読み込みを禁止。文書は同一オリジン、または他オリジンから読み込み可と明示されたリソースのみ読める | 有効化すると**正しく設定されていないクロスオリジンリソースの読み込みがブロックされる**。特定リソースは `crossorigin` 属性で回避可 |
| 14 | `Cross-Origin-Resource-Policy` (CORP) | `Cross-Origin-Resource-Policy: same-site` | あるリソースをinclude（埋め込み）できるoriginの集合を制御。現在のリソース読み込みを自サイトとサブドメインのみに限定 | **レスポンスが攻撃者のプロセスに入る前にブロックできる**ため Spectre のような攻撃に対する堅牢な防御 |
| 15 | `Permissions-Policy`（旧 Feature-Policy） | `Permissions-Policy: geolocation=(), camera=(), microphone=()` | どのoriginがどのブラウザ機能を使えるかを、トップレベルページと埋め込みフレームの双方で制御。機能は現在の文書/フレームのoriginが許可リストに合致する場合のみ有効 | 不要な機能は全て無効化、または認可ドメインのみ許可。**XSSなどのインジェクションがカメラ・マイク等を有効化することを防ぐ**。例は全ドメインに対し geolocation/camera/microphone を無効化 |
| 16 | `Server` | `Server: webserver` | リクエストを処理したオリジンサーバのソフトウェアを記述 | セキュリティヘッダではないが使い方がセキュリティに関係。削除するか非情報値に。攻撃者は他の手段でもサーバ技術を特定できることを忘れない |
| 17 | `X-Powered-By` | **全て削除** | Webサーバが使う技術を記述し、攻撃者に情報を露出する。これにより攻撃者は脆弱性を見つけやすくなる | 攻撃者は他の手段でも技術スタックを特定できることを忘れない |
| 18 | `X-AspNet-Version` | 送信を無効化（`web.config` の `<system.web>` に設定追加） | .NETのバージョン情報を提供する | 同上の注記 |
| 19 | `X-AspNetMvc-Version` | 送信を無効化（`Global.asax` に1行追加） | .NETのバージョン情報を提供する | 同上の注記 |
| 20 | `X-Robots-Tag` | 非公開/機微コンテンツ: `X-Robots-Tag: noindex, nofollow` ／ 公開コンテンツ: `X-Robots-Tag: index, follow` | 検索エンジンや自動クローラがPDF・画像などの非HTMLリソースをどうインデックス・表示するかを制御。`<meta name="robots">` タグと同様の機能をHTTPレスポンスヘッダで適用でき柔軟性が高い（非HTMLファイルやサーバ全体ルールに使える） | **準拠クローラのみがディレクティブを尊重し、しかもヘッダを読むには先にHTTPリクエストを行う必要がある**。`noarchive` / `nosnippet` / `noimageindex` も利用可。ファイル種別ごとの選択的適用も可 |
| 21 | `X-DNS-Prefetch-Control` | `X-DNS-Prefetch-Control: off` | DNSプリフェッチ（ユーザが辿るかもしれないリンクや、画像・CSS・JavaScript等の参照URLに対しブラウザが先行してドメイン名解決を行う機能）を制御 | 既定のDNSキャッシュ動作は大半のサイトにとって良い。**自サイト上のリンクを自分で制御していない場合**、それらドメインへの情報漏えいを避けるため `off` にするとよい。標準でなく完全サポートでもなく実装がブラウザ間で異なるため、**本番で重要な用途に依存してはならない** |
| 22 | `Public-Key-Pins` (HPKP) ❌ | **使用しない**。本番から `Public-Key-Pins` および `Public-Key-Pins-Report-Only` を削除 | 特定の公開鍵をWebサーバに紐付け、偽造証明書によるMITMを軽減するために使われていた | 2018年にChromiumから削除され、全モダンブラウザで非サポート。**ピンニングの運用上の脆さなしに優れた侵害検知を提供する Certificate Transparency (CT) と CAA DNSレコードに依拠せよ** |
| 23 | Secure File Download（3点セット） | `Content-Disposition: attachment` ／ `Content-Type: application/octet-stream` ／ `X-Content-Type-Options: nosniff` | ユーザ提供ファイルを配信する際、ブラウザでの意図しない実行を防ぐ。inlineレンダリングではなくダウンロードを強制／不明・バイナリファイル向け／MIMEスニッフィング防止 | これらのヘッダがXSSや意図しないファイル実行のリスクを低減する |

---

### Introduction（出典: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html）

HTTPヘッダは実装が容易でありながらWebセキュリティを大きく押し上げる手段である。適切なHTTPレスポンスヘッダは、クロスサイトスクリプティング、クリックジャッキング、情報開示などのセキュリティ脆弱性の防止に役立つ。

本チートシートでは、セキュリティ関連のHTTPヘッダすべてをレビューし、推奨設定を示し、複雑なヘッダについては他の情報源を参照する。

---

### X-Frame-Options（出典: 同上）

`X-Frame-Options` HTTPレスポンスヘッダは、ブラウザがそのページを `<frame>`、`<iframe>`、`<embed>`、`<object>` の中でレンダリングすることを許すかどうかを示すために使える。サイトはこれを用いて、自分のコンテンツが他サイトに埋め込まれないことを保証することで[クリックジャッキング](https://owasp.org/www-community/attacks/Clickjacking)攻撃を避けられる。

Content Security Policy (CSP) の `frame-ancestors` ディレクティブは、サポートするブラウザにおいて X-Frame-Options を obsolete（陳腐化）させる（[source: MDN X-Frame-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options)）。

X-Frame-Options ヘッダが有用なのは、それが含まれるHTTPレスポンスに**何か操作する対象（リンク、ボタンなど）がある場合に限られる**。HTTPレスポンスがリダイレクトである場合や、JSONデータを返すAPIである場合、X-Frame-Options は何のセキュリティも提供しない。

#### Recommendation（逐語対応）

- 可能であれば Content Security Policy (CSP) の `frame-ancestors` ディレクティブを使う。
- ページのフレーム内表示を許可しない。
  > `X-Frame-Options: DENY`

〔補足（一般知識）〕バグバウンティ観点では「X-Frame-Options が無い」だけでは通常低〜情報レベル扱いであり、実際にクリックジャッキングで達成できる状態変更操作（ワンクリックでの設定変更・削除・購入等）まで示す必要がある。この「操作対象があるレスポンスでのみ意味を持つ」という原典の記述はその判断基準そのものである。

---

### X-XSS-Protection（出典: 同上）

HTTP `X-XSS-Protection` レスポンスヘッダは Internet Explorer、Chrome、Safari の機能で、反射型クロスサイトスクリプティング (XSS) 攻撃を検出したときにページの読み込みを停止させる。

WARNING: このヘッダは CSP を未サポートの古いWebブラウザのユーザを保護できるものの、**場合によっては、そうでなければ安全なWebサイトにXSS脆弱性を作り出してしまうことがある**（[source: MDN X-XSS-Protection](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-XSS-Protection)）。

#### Recommendation（逐語対応）

- インラインJavaScriptの使用を無効化する Content Security Policy (CSP) を使う。
- このヘッダを設定しない、または明示的にオフにする。
  > `X-XSS-Protection: 0`

詳細は [Mozilla X-XSS-Protection](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-XSS-Protection) を参照。

**ch02で強調すべき点**: 「X-XSS-Protection が無い／0 になっている」ことを脆弱性として報告するのは誤りである。原典は明確に「設定しないか、明示的に `0` にせよ」と推奨している。

---

### X-Content-Type-Options（出典: 同上）

`X-Content-Type-Options` レスポンスHTTPヘッダは、Content-Type ヘッダで広告されたMIMEタイプに従い、推測（guess）してはならないことをブラウザに示すためにサーバが使う。

このヘッダはブラウザの[MIMEタイプスニッフィング](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types#mime_sniffing)をブロックするために使われる。MIMEタイプスニッフィングは、**非実行MIMEタイプを実行可能MIMEタイプに変換してしまう**（[MIME Confusion Attacks](https://blog.mozilla.org/security/2016/08/26/mitigating-mime-confusion-attacks-in-firefox/)）。

#### Recommendation（逐語対応）

サイト全体で Content-Type ヘッダを正しく設定する。

> `X-Content-Type-Options: nosniff`

---

### Referrer-Policy（出典: 同上）

`Referrer-Policy` HTTPヘッダは、リクエストにどれだけのリファラ情報（Referer ヘッダ経由で送られる）を含めるかを制御する。

#### Recommendation（逐語対応）

Referrer policy は2014年以来ブラウザにサポートされている。今日のモダンブラウザの既定動作は、**すべてのリファラ情報（origin、path、クエリ文字列）を同一サイトへ送るのをやめ、他サイトへは origin のみを送る**というものである。しかし、すべてのユーザが最新ブラウザを使っているとは限らないため、この動作を全レスポンスでこのヘッダを送ることで強制することを提案する。

> `Referrer-Policy: strict-origin-when-cross-origin`

- *NOTE:* このヘッダの設定に関する詳細は [Mozilla Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy) を参照。

〔補足（一般知識）〕診断上は「URLのクエリ文字列やパスに秘密（トークン、リセットキー、セッションID）が含まれているページから外部リソース（画像、解析スクリプト、外部リンク）を読み込んでいるか」を見る。Referrer-Policy が緩いとその秘密が Referer で外部に漏れる。原典が「全レスポンスで明示せよ」と言う理由はここにある。

---

### Content-Type（出典: 同上）

`Content-Type` representation ヘッダは、（送信のためのコンテンツエンコーディング適用前の）リソースの元のメディアタイプを示すために使われる。正しく設定されていないと、リソース（例: 画像）がHTMLとして解釈され、**XSS脆弱性が成立し得る**。

`Content-Type` ヘッダは常に正しく設定することが推奨されるが、**脆弱性を構成するのは、そのコンテンツがクライアントによってレンダリングされる意図があり、かつリソースが信頼できない（ユーザによって提供または改変された）場合のみ**である。

#### Recommendation（逐語対応）

> `Content-Type: text/html; charset=UTF-8`

- *NOTE:* `charset` 属性は **HTML** ページにおけるXSS防止に必要である
- *NOTE:* `Content-Type` は取り得る[MIMEタイプ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types)のいずれでもよい

〔補足（一般知識）〕`charset` 未指定が問題になる典型はUTF-7系や、ブラウザが文字セットを推測して `<` に相当するバイト列がタグとして解釈されるケース。原典は理由を「XSS防止に必要」と述べるのみで機序は説明していないため、教科書側で補う際は補足として明示すること。

---

### Cache-Control（出典: 同上）

`Cache-Control` ヘッダは、レスポンスがブラウザおよび中間キャッシュによってどのようにキャッシュされるかを定義する。

#### Recommendation（逐語対応の箇条書き）

- 機微なデータには `no-store` を使い、あらゆる形態のキャッシュを防ぐ。
- `private` を使って非共有（ユーザ固有）キャッシュでのみキャッシュを許可し、共有キャッシュへの保存を防ぐ（**private キャッシュは依然としてレスポンスを保持し続ける可能性がある**点に注意）。
- 機微または保護されたコンテンツについて、**既定のキャッシュ動作に依存することを避ける**。
- **`no-cache` はキャッシュを防がないことを認識する**。`no-cache` はキャッシュがレスポンスを保存することを許し、再利用前にオリジンサーバでの再検証を要求するだけである。

これらのディレクティブは機微データがキャッシュを通じて保存・露出されるリスクを減らすのに役立つが、機微データの保存を厳密に防がねばならない場合は `no-store` を使うこと。

#### References（原典のまま）

- [MDN - Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control)

---

### Set-Cookie（出典: 同上）

`Set-Cookie` HTTPレスポンスヘッダは、サーバからユーザエージェントへCookieを送るために使われ、ユーザエージェントは後でそれをサーバに送り返せる。**複数のCookieを送るには、同一レスポンス内で複数の Set-Cookie ヘッダを送るべきである。**

これは厳密にはセキュリティヘッダそのものではないが、**そのセキュリティ属性は極めて重要 (crucial)** である。

#### Recommendation（逐語対応）

- Cookie設定オプションの詳細な説明は [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookies) を読むこと。

> 原典はここで詳細を委譲しているため、**その委譲先の内容を下記「参照先資料1」に完全収録した**。ch02 の Set-Cookie 節はそちらを主材料にすること。

---

### Strict-Transport-Security (HSTS)（出典: 同上）

HTTP `Strict-Transport-Security` レスポンスヘッダ（しばしば HSTS と略される）は、ユーザがHTTPで接続しようとした場合でも、HTTPSのみを使ってWebサイトにアクセスするようブラウザに指示する。

#### Recommendation（逐語対応）

> `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`

- *NOTE:* **このヘッダを使う前にどう動作するかを注意深く読むこと**。HSTSヘッダが誤設定されている場合、あるいは使用中のSSL/TLS証明書に問題がある場合、正規ユーザがWebサイトにアクセスできなくなるおそれがある。たとえば HSTS ヘッダに非常に長い期間が設定されており、SSL/TLS証明書が期限切れまたは失効した場合、**HSTSヘッダの期間が満了するまで正規ユーザはWebサイトにアクセスできなくなるおそれがある**。

詳細は [HTTP Strict Transport Security Cheat Sheet](HTTP_Strict_Transport_Security_Cheat_Sheet.md) を参照（＝ `https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html`）。

〔補足（一般知識）〕`max-age=63072000` は 2年（63,072,000秒 = 730日 × 86,400秒）。`preload` は [https://hstspreload.org/](https://hstspreload.org/) への登録を前提とするオプトインで、原典の References にも HSTS Preload List が挙がっている。

---

### Expect-CT ❌（出典: 同上）

`Expect-CT` ヘッダは、Certificate Transparency (CT) 要件の報告をサイトがオプトインできるようにするものである。主流クライアントが既にCT適格性を要求している現状では、**残る唯一の価値は、ヘッダ内で指名された report-uri の値にそうした事象を報告すること**である。このヘッダは今や強制よりも検出/報告に関するものになっている。

#### Recommendation（逐語対応）

**使わないこと。** Mozilla はこれを避けること、そして可能であれば既存のコードから削除することを[推奨している](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Expect-CT)。

---

### Content-Security-Policy (CSP)（出典: 同上）

Content Security Policy (CSP) は、Webサイトまたはウェブアプリケーションで読み込みが許可されるコンテンツのoriginを指定するために使われるセキュリティ機能である。これは、**クロスサイトスクリプティング (XSS) やデータインジェクション攻撃を含む特定の種類の攻撃を検出し軽減する**のに役立つ追加のセキュリティ層である。これらの攻撃は、データ窃取からサイト改ざん、マルウェア配布に至るまであらゆることに使われる。

- *NOTE:* このヘッダは**スクリプトやコードを読み込んで解釈できるページに適用することに意義がある**が、レンダリングされないコンテンツを返す REST API のレスポンスでは無意味な場合がある。

#### Recommendation（逐語対応）

Content Security Policy は設定と維持が複雑である。カスタマイズオプションの説明は [Content Security Policy Cheat Sheet](Content_Security_Policy_Cheat_Sheet.md) を読むこと（＝ `https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html`）。

〔補足（原典のReferences由来）〕原典の References には CSP の実用リファレンスとして [Content Security Policy Reference](https://content-security-policy.com/) が挙げられている。また「参照先資料2」に OWASP Secure Headers Project による具体的な推奨CSP文字列がある（後述）。

---

### Access-Control-Allow-Origin（出典: 同上）

**このヘッダを使わないなら、サイトは既定で Same Origin Policy (SOP) によって保護されている。このヘッダがするのは、指定された状況下でその制御を緩めること (relax) である。**

`Access-Control-Allow-Origin` は CORS（cross-origin resource sharing）ヘッダである。このヘッダは、それが関連するレスポンスが、与えられたoriginの要求コードと共有され得るかを示す。言い換えれば、siteA が siteB からリソースを要求する場合、siteB は自身の `Access-Control-Allow-Origin` ヘッダで siteA がそのリソースを取得してよいことを示すべきであり、そうでなければ Same Origin Policy (SOP) によりアクセスはブロックされる。

#### Recommendation（逐語対応）

使う場合は `*` ではなく具体的な[origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin)を設定する。詳細は [Access-Control-Allow-Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Origin) を参照。

> `Access-Control-Allow-Origin: https://yoursite.com`

- *NOTE:* ニーズによっては `*` の使用が必要な場合もある。たとえば任意のoriginからアクセス可能であるべき公開APIでは `*` を許可する必要があるかもしれない。

**原典の範囲に関する注記**: 本チートシートが扱う `Access-Control-*` は `Access-Control-Allow-Origin` のみである。`Access-Control-Allow-Credentials` / `Access-Control-Allow-Methods` / `Access-Control-Allow-Headers` / `Access-Control-Expose-Headers` / `Access-Control-Max-Age` は本チートシートに節がない（後述「原典に含まれていなかった重点項目」参照）。

---

### Cross-Origin-Opener-Policy (COOP)（出典: 同上）

HTTP `Cross-Origin-Opener-Policy` (COOP) レスポンスヘッダにより、**トップレベル文書がクロスオリジン文書とブラウジングコンテキストグループを共有しないことを保証**できる。

このヘッダは、以下で説明する Cross-Origin-Embedder-Policy (COEP) および Cross-Origin-Resource-Policy (CORP) と連携して動作する。

このメカニズムは、**同一ブラウジングコンテキストグループ内のリソースに対して Same Origin Policy (SOP) が確立したセキュリティ境界を越えることができる Spectre のような攻撃から保護する**。

これらのヘッダはブラウザに非常に関係が深いため、REST API や非ブラウザのクライアントに適用することは意味をなさない場合がある。

#### Recommendation（逐語対応）

ブラウジングコンテキストを同一オリジン文書のみに隔離する。

> `Cross-Origin-Opener-Policy: same-origin`

---

### Cross-Origin-Embedder-Policy (COEP)（出典: 同上）

HTTP `Cross-Origin-Embedder-Policy` (COEP) レスポンスヘッダは、文書に対して明示的に許可を与えていない（[CORP](#cross-origin-resource-policy-corp) または CORS を使って）クロスオリジンリソースを、その文書が読み込むことを防ぐ。

- *NOTE:* これを有効化すると、**正しく設定されていないクロスオリジンリソースの読み込みがブロックされる**。

#### Recommendation（逐語対応）

文書は、同一オリジンからのリソース、または他のオリジンから読み込み可能と明示的にマークされたリソースのみを読み込める。

> `Cross-Origin-Embedder-Policy: require-corp`

- *NOTE:* `crossorigin` 属性を付けることで特定のリソースについてこれをバイパスできる:
- `<img src="https://thirdparty.com/img.png" crossorigin>`

---

### Cross-Origin-Resource-Policy (CORP)（出典: 同上）

`Cross-Origin-Resource-Policy` (CORP) ヘッダにより、**あるリソースをinclude（含める／埋め込む）権限を与えられるoriginの集合を制御**できる。これは [Spectre](https://meltdownattack.com/) のような攻撃に対する堅牢な防御であり、**ブラウザが当該レスポンスを、それが攻撃者のプロセスに入る前にブロックできる**ようにする。

#### Recommendation（逐語対応）

現在のリソース読み込みを、そのサイトとサブドメインのみに限定する。

> `Cross-Origin-Resource-Policy: same-site`

〔補足（原典のReferences由来）〕原典 References には [Resource Policy Reference](https://resourcepolicy.fyi/) が挙げられている。なお「参照先資料2」の OWASP Secure Headers Project は CORP について `same-origin` を推奨しており、**原典チートシート（`same-site`）とは値が異なる**。教科書ではこの差異を明示すること。

---

### Permissions-Policy（旧 Feature-Policy）（出典: 同上）

Permissions-Policy により、**どのoriginがどのブラウザ機能を使えるかを、トップレベルのページと埋め込みフレームの両方で制御**できる。Feature Policy によって制御される各機能について、その機能は、現在の文書またはフレームのoriginが許可されたoriginのリストに合致する場合にのみ有効になる。これはつまり、**カメラやマイクが決して有効化されないようサイトを設定できる**ということである。これにより、**たとえばXSSのようなインジェクションがカメラやマイク、その他のブラウザ機能を有効化することを防げる**。

詳細: [Permissions-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy)

#### Recommendation（逐語対応）

これを設定し、サイトが必要としないすべての機能を無効化するか、認可されたドメインにのみ許可する:

> `Permissions-Policy: geolocation=(), camera=(), microphone=()`

- *NOTE:* この例はすべてのドメインに対して geolocation、camera、microphone を無効化している。

〔補足（参照先資料2由来）〕OWASP Secure Headers Project はさらに網羅的な推奨値を持つ（後述の逐語値を参照）。

---

### Server（出典: 同上）

`Server` ヘッダは、リクエストを処理したオリジンサーバ ── すなわちレスポンスを生成したサーバ ── によって使われているソフトウェアを記述する。

これはセキュリティヘッダではないが、**どのように使われるかはセキュリティに関係する**。

#### Recommendation（逐語対応）

このヘッダを削除するか、非情報的な値を設定する。

> `Server: webserver`

- *NOTE:* 攻撃者はサーバ技術をフィンガープリンティングする**他の手段を持っている**ことを忘れないこと。

---

### X-Powered-By（出典: 同上）

`X-Powered-By` ヘッダは、Webサーバによって使われている技術を記述する。この情報はサーバを攻撃者に露出させる。このヘッダの情報を使って、攻撃者はより容易に脆弱性を見つけることができる。

#### Recommendation（逐語対応）

すべての `X-Powered-By` ヘッダを削除する。

- *NOTE:* 攻撃者は技術スタックをフィンガープリンティングする他の手段を持っていることを忘れないこと。

---

### X-AspNet-Version（出典: 同上）

.NET のバージョンに関する情報を提供する。

#### Recommendation（逐語対応）

このヘッダの送信を無効化する。削除するには `web.config` の `<system.web>` セクションに次の行を追加する。

#### コード/コマンド（原文のまま逐語）

```xml
<httpRuntime enableVersionHeader="false" />
```

- *NOTE:* 攻撃者は技術スタックをフィンガープリンティングする他の手段を持っていることを忘れないこと。

---

### X-AspNetMvc-Version（出典: 同上）

.NET のバージョンに関する情報を提供する。

#### Recommendation（逐語対応）

このヘッダの送信を無効化する。`X-AspNetMvc-Version` ヘッダを削除するには、`Global.asax` ファイルに下記の行を追加する。

#### コード/コマンド（原文のまま逐語）

```lang-none
MvcHandler.DisableMvcResponseHeader = true;
```

- *NOTE:* 攻撃者は技術スタックをフィンガープリンティングする他の手段を持っていることを忘れないこと。

---

### X-Robots-Tag（出典: 同上）

HTTP `X-Robots-Tag` レスポンスヘッダは、検索エンジンやその他の自動クローラが、PDF・画像・その他の非HTMLコンテンツといったリソースをどのようにインデックスし表示するかを制御する。
これは `<meta name="robots">` タグと同様に機能するが、HTTPレスポンスヘッダ経由で適用されるため、より大きな柔軟性を持つ（例: 非HTMLファイルに対して、あるいはサーバ全体のルールとして）。

#### コード/コマンド（原文のまま逐語）

```none
X-Robots-Tag: noindex, nofollow
```

- **Note:** **準拠するクローラのみがこれらのディレクティブを尊重する。しかもクローラは、コンテンツをどう扱うか決める前に、ヘッダを読むためにHTTPリクエストを行わなければならない。**

#### Recommendation（逐語対応）

`X-Robots-Tag` ヘッダを使ってクローラの振る舞いを制御する:

- **非公開または機微なコンテンツ**でインデックスされたくないもの:

  > `X-Robots-Tag: noindex, nofollow`
  > これにより、準拠する検索エンジンがそのリソースをインデックスすることや、そこにあるリンクを辿ることを防ぐ。

- **公開コンテンツ**でインデックスされ発見されるべきもの（例: ドキュメンテーション、データセット）:

  > `X-Robots-Tag: index, follow`
  > これにより検索エンジンはそのリソースをインデックスし、そのリンクを辿れる。

必要に応じて `noarchive`、`nosnippet`、`noimageindex` といった他のディレクティブも使える。
サーバ設定でこのヘッダを選択的に適用することもできる ── 例えば特定のファイルタイプ（PDFや画像など）にのみ。

---

### X-DNS-Prefetch-Control（出典: 同上）

`X-DNS-Prefetch-Control` HTTPレスポンスヘッダはDNSプリフェッチを制御する。DNSプリフェッチとは、**ユーザが辿ることを選ぶかもしれないリンク、および文書から参照されるアイテム（画像、CSS、JavaScriptなどを含む）のURLの両方**について、ブラウザが先回りしてドメイン名解決を行う機能である。

#### Recommendation（逐語対応）

ブラウザの既定動作はDNSキャッシュを行うことであり、これは大半のWebサイトにとって良いことである。
自分のWebサイト上のリンクを自分で制御していない場合は、それらのドメインへの情報漏えいを避けるためにDNSプリフェッチを無効化する値 `off` を設定したいかもしれない。

> `X-DNS-Prefetch-Control: off`

- *NOTE:* **本番で機微な用途については、この機能に依存してはならない**。これは標準ではなく、完全にサポートされているわけでもなく、実装はブラウザ間で異なる場合がある。

---

### Public-Key-Pins (HPKP) ❌（出典: 同上）

HTTP `Public-Key-Pins` レスポンスヘッダは、特定の暗号公開鍵をWebサーバに関連付けて、**偽造証明書によるMITM攻撃を軽減する**ために使われていた。これは2018年にChromiumから削除され、すべてのモダンブラウザで非サポートである。

#### Recommendation（逐語対応）

**使用しないこと。** 本番から `Public-Key-Pins` および `Public-Key-Pins-Report-Only` ヘッダをすべて削除する。**ピンニングの運用上の脆さ (operational brittleness) なしに優れた侵害検知を提供する Certificate Transparency (CT) と CAA DNSレコードに依拠する**こと。

---

### Secure File Download Headers（出典: 同上）

ユーザ提供のファイルを配信するとき、**ブラウザでの意図しない実行を防ぐために適切なHTTPヘッダを使うべきである**。

- `Content-Disposition: attachment` を使って、inline レンダリングではなくダウンロードを強制する。
- 不明なファイルやバイナリファイルには `Content-Type: application/octet-stream` を使う。
- MIMEタイプスニッフィングを防ぐために `X-Content-Type-Options: nosniff` が設定されていることを確実にする。

これらのヘッダは、クロスサイトスクリプティング (XSS) や意図しないファイル実行といったリスクを減らすのに役立つ。

〔補足（一般知識）〕バグバウンティでの典型は、ユーザがアップロードしたSVG/HTML/PDFが `Content-Type: image/svg+xml` や `text/html` で inline 配信され、同一オリジンでスクリプトが走る「stored XSS via file upload」。この3ヘッダ組み合わせはその主要な防御線である。

---

### Adding HTTP Headers in Different Technologies（出典: 同上）

すべて `X-Frame-Options` を例に設定方法を示している。

#### PHP

下記のサンプルコードはPHPで `X-Frame-Options` ヘッダを設定する。

#### コード/コマンド（原文のまま逐語）

```php
header("X-Frame-Options: DENY");
```

#### Apache

以下はApacheで `X-Frame-Options` ヘッダを設定する `.htaccess` のサンプル設定である。

[Apacheのドキュメント](https://httpd.apache.org/docs/2.4/mod/mod_headers.html#header)に記述されているとおり、`Header set`（既定は `onsuccess`）と `Header always set` は**別々の内部ヘッダテーブル**に対して動作する。

場合によっては両方のヘッダテーブルが使われることがあり、同じヘッダが両方のコンテキストで設定されていると**ヘッダの重複 (duplicate headers)** が生じ得る。

ヘッダを完全に削除する必要がある場合は、**両方のコンテキスト (`onsuccess` と `always`) で unset すべきである**。

重複を避け、かつすべてのレスポンスでヘッダが送られることを保証するには、まず unset してから `always set` を使う:

#### コード/コマンド（原文のまま逐語）

```lang-bsh
<IfModule mod_headers.c>
  Header unset X-Frame-Options
  Header always set X-Frame-Options "DENY"
</IfModule>
```

#### IIS

IISで `X-Frame-Options` ヘッダを送るには、下記の設定を `Web.config` に追加する。

#### コード/コマンド（原文のまま逐語）

```xml
<system.webServer>
...
 <httpProtocol>
   <customHeaders>
     <add name="X-Frame-Options" value="DENY" />
   </customHeaders>
 </httpProtocol>
...
</system.webServer>
```

#### HAProxy

`X-Frame-Options` ヘッダを送るには、front-end、listen、または backend の設定に下記の行を追加する。

#### コード/コマンド（原文のまま逐語）

```lang-none
http-response set-header X-Frame-Options DENY
```

#### Nginx

以下はNginxで `X-Frame-Options` ヘッダを設定するサンプル設定である。**`always` オプションがないと、[nginxのドキュメント](https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header)に記述されているとおり、特定のステータスコードに対してのみヘッダが送られる**点に注意。

#### コード/コマンド（原文のまま逐語）

```lang-none
add_header "X-Frame-Options" "DENY" always;
```

#### Express

Expressでは [helmet](https://www.npmjs.com/package/helmet) を使ってHTTPヘッダを設定できる。下記は `X-Frame-Options` ヘッダを追加するサンプルである。

#### コード/コマンド（原文のまま逐語）

```javascript
const helmet = require('helmet');
const app = express();
// Sets "X-Frame-Options: SAMEORIGIN"
app.use(
 helmet.frameguard({
   action: "sameorigin",
 })
);
```

**ch02 での診断上の重要ポイント（原典由来）**: Apache の `onsuccess` / `always` の二重テーブル、および Nginx の `always` 省略時の挙動は、**「200では正しいヘッダが付くが、エラーページ（4xx/5xx）やリダイレクトにはヘッダが付かない」という実務で頻出する抜け穴**の原因である。ヘッダ検査は 200 だけでなく 30x / 40x / 50x でも行うべき根拠になる。

---

### Testing Proper Implementation of Security Headers（出典: 同上）

#### Mozilla Observatory

[Mozilla Observatory](https://observatory.mozilla.org/) は、自分のWebサイトのヘッダ状態を確認するのに役立つオンラインツールである。

#### SmartScanner

[SmartScanner](https://www.thesmartscanner.com/) は、HTTPヘッダのセキュリティをテストするための専用の[テストプロファイル](https://www.thesmartscanner.com/docs/configuring-security-tests)を持つ。
オンラインツールは通常、与えられたアドレスのホームページのみをテストする。しかし SmartScanner はWebサイト全体をスキャンする。したがって、**すべてのWebページに正しいHTTPヘッダが配置されていることを確かめられる**。

〔補足（一般知識）〕「オンラインツールはトップページしか見ない」という原典の指摘は診断上重要で、ヘッダがリバースプロキシ層で付与されている場合、アプリが直接返すパス（API、静的配信、エラーページ、別オリジンのサブドメイン）では欠落することがある。

---

### References（原典のリンク一覧を逐語で再現）

- [MDN Web Docs: Content-Disposition](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition)
- [MDN Web Docs: Content-Type](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type)
- [MDN Web Docs: X-Content-Type-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options)
- [MDN Web Docs: X-Frame-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options)
- [MDN Web Docs: X-XSS-Protection](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-XSS-Protection)
- [MDN Web Docs: Strict-Transport-Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security)
- [MDN Web Docs: Expect-CT](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Expect-CT)
- [MDN Web Docs: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)
- [MDN Web Docs: Cross-Origin-Opener-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy)
- [MDN Web Docs: Cross-Origin-Resource-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Resource-Policy)
- [MDN Web Docs: Cross-Origin-Embedder-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy)
- [MDN Web Docs: Server](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server)
- [HSTS Preload List](https://hstspreload.org/)
- [Content Security Policy Reference](https://content-security-policy.com/)
- [Resource Policy Reference](https://resourcepolicy.fyi/)
- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/)

---

## 参照先資料1: Set-Cookie 属性の詳細（出典: OWASP Session Management Cheat Sheet の "Cookies" 節 / https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookies）

> 原典 HTTP Headers Cheat Sheet が Set-Cookie の詳細をここに委譲しているため、その節を取得して収録する。

Cookieに基づくセッションID交換メカニズムは、セッションIDの交換を保護するために使えるCookie属性という形で複数のセキュリティ機能を提供する。

### Secure 属性

`Secure` Cookie属性は、暗号化されたHTTPS (SSL/TLS) 接続を通じてのみCookieを送るようWebブラウザに指示する。**このセッション保護メカニズムは、MitM (Man-in-the-Middle) 攻撃によるセッションIDの漏えいを防ぐために必須 (mandatory) である。**攻撃者がWebブラウザのトラフィックから単純にセッションIDを捕捉できないことを保証する。

**`Secure` Cookieが設定されていなければ、（Webアプリケーションホストで TCP/80 (HTTP) が閉じられていても）Webアプリケーションに通信でHTTPSのみを使わせることはセッションID漏えいを防げない** ── Webブラウザは騙されて、暗号化されていないHTTP接続でセッションIDを開示させられ得る。攻撃者は被害者ユーザのトラフィックを傍受・操作し、WebアプリケーションへのHTTP非暗号化参照を注入して、WebブラウザにセッションIDを平文で送信させることができる。

参照: [SecureFlag](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#Secure_and_HttpOnly_cookies)

### HttpOnly 属性

`HttpOnly` Cookie属性は、スクリプト（JavaScriptやVBscriptなど）が DOM の `document.cookie` オブジェクト経由でCookieにアクセスする能力を許さないようWebブラウザに指示する。**このセッションID保護は、XSS攻撃によるセッションID窃取を防ぐために必須である。**ただし、XSS攻撃がCSRF攻撃と組み合わされた場合、ブラウザはリクエスト送信時に常にCookieを含めるため、Webアプリケーションに送られるリクエストにはセッションCookieが含まれる。**`HttpOnly` Cookieが保護するのはCookieの機密性のみであり、攻撃者はXSS攻撃のコンテキスト外・オフラインでそれを使うことはできない。**

OWASP [XSS (Cross Site Scripting) Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) を参照。

参照: [HttpOnly](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#Secure_and_HttpOnly_cookies)

### SameSite 属性

`SameSite` 属性は、ブラウザがクロスサイトリクエストでCookieを送るかどうかを制御する。`SameSite=Strict` はクロスサイトリクエストを排除し、`SameSite=Lax` は安全なHTTPメソッドを使うトップレベルのクロスサイトナビゲーションを許可する。`SameSite` は **CSRFに対する多層防御 (defense in depth) として扱い、CSRFトークンの代替としては扱わないこと**。セッションCookieは `SameSite=Strict`（推奨）または `SameSite=Lax` を明示的に設定しなければならない。**`Secure` なしで `SameSite=None` を使ってはならない**。また、**ブラウザとバージョンによって異なるブラウザ既定値に依存してはならない**。

参照: [SameSite](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#samesitesamesite-value)

### Cookie Name Prefixes（Cookie名プレフィックス）

Cookieをブラウザレベルでセキュリティ特性に束縛するために、Cookie名プレフィックスを使うこと（[RFC 6265bis §4.1.3](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis)）:

| プレフィックス | 強制される条件 | 効果・推奨度 |
|---|---|---|
| `__Host-` | Cookieは `Secure` 付きで設定されなければならず、`Domain` 属性を持ってはならず、`Path=/` を使わなければならない | サブドメインによる偽造 (subdomain forgery) とHTTPSダウングレード攻撃を防ぐ。**セッションIDに推奨 (Recommended for session IDs)** |
| `__Secure-` | Cookieは `Secure` 付きで設定されなければならない | サブドメイン共有が必要な場合にのみ使う |

#### コード/コマンド（原文のまま逐語）

```http
Set-Cookie: __Host-SessionID=<value>; Secure; HttpOnly; SameSite=Strict; Path=/
```

### Domain および Path 属性

[`Domain` Cookie属性](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#Directives)は、指定されたドメインと**そのすべてのサブドメイン**にのみCookieを送るようWebブラウザに指示する。属性が設定されていない場合、既定ではCookieはオリジンサーバにのみ送られる。[`Path` Cookie属性](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#Directives)は、Webアプリケーション内の指定されたディレクトリまたはサブディレクトリ（あるいはパスやリソース）にのみCookieを送るようWebブラウザに指示する。属性が設定されていない場合、既定ではCookieは要求されたリソースおよびCookieを設定したリソースのディレクトリ（パス）に対してのみ送られる。

**これら2つの属性には狭い／制限されたスコープを使うことが推奨される。**この意味で、`Domain` 属性は設定すべきでなく（Cookieをオリジンサーバのみに制限する）、`Path` 属性はセッションIDを利用するWebアプリケーションのパスに対して可能な限り制限的に設定すべきである。

`Domain` 属性に `example.com` のような過度に寛容な値を設定すると、**同一ドメインに属する異なるホストやWebアプリケーション間でセッションIDに対する攻撃（cross-subdomain cookies として知られる）を仕掛けられる**。たとえば `www.example.com` の脆弱性により、攻撃者が `secure.example.com` のセッションIDにアクセスできるかもしれない。

さらに、**異なるセキュリティレベルのWebアプリケーションを同一ドメイン上に混在させないことが推奨される**。一方のWebアプリケーションの脆弱性により、攻撃者が（`example.com` のような）寛容な `Domain` 属性を使って、同一ドメイン上の別のWebアプリケーションのセッションIDを設定できてしまう。これは[セッションフィクセーション攻撃](https://www.acrossecurity.com/papers/session_fixation.pdf)に使えるテクニックである。

`Path` 属性は同一ホスト上で異なるパスを使う異なるWebアプリケーション間でセッションIDを隔離できるが、**異なるWebアプリケーション（特に異なるセキュリティレベルやスコープのもの）を同一ホスト上で動かさないことが強く推奨される**。これらのアプリケーションは `document.cookie` オブジェクトのような他の方法でセッションIDにアクセスできる。また、**どのWebアプリケーションもそのホスト上の任意のパスに対してCookieを設定できる**。

CookieはDNSスプーフィング／ハイジャック／ポイズニング攻撃に脆弱であり、攻撃者はDNS解決を操作して、与えられたホストまたはドメインのセッションIDをWebブラウザに開示させることができる。

### Expire および Max-Age 属性

Cookieに基づくセッション管理メカニズムは2種類のCookieを使い得る: 非永続的（またはセッション）Cookieと、永続的Cookieである。Cookieが（`Expires` より優先される）[`Max-Age`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#Directives) 属性、または [`Expires`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#Directives) 属性を持つ場合、それは永続的Cookieとみなされ、有効期限までWebブラウザによってディスク上に保存される。

典型的には、認証後にユーザを追跡するセッション管理機能は非永続的Cookieを使う。これにより、現在のWebブラウザインスタンスが閉じられるとセッションがクライアントから消える。したがって、**セッション管理目的には非永続的Cookieを使うことが強く推奨される**。そうすればセッションIDが長期間Webクライアントのキャッシュに残らず、攻撃者がそこから取得することもできない。

チェックリスト（原文の箇条書き）:

- 機微な情報が永続化されないこと、暗号化されること、必要な期間のみ保存されることを確実にして、機微情報が危険に晒されないようにする
- Cookieの操作によって認可されていない活動が行われ得ないことを確実にする
- 非セキュアな方法で誤ってネットワーク上を送信されることを防ぐため secure フラグが設定されていることを確実にする
- アプリケーションコード中のすべての状態遷移がCookieを適切に検査し、その使用を強制しているかを判断する
- 機微データがCookieに永続化される場合はCookie全体が暗号化されるべきことを確実にする
- アプリケーションが使用するすべてのCookieについて、その名前と必要な理由を定義する

### （参照先資料1の続き）HTML5 Web Storage API に関するセキュリティ警告

> ch02のヘッダ章に直結する重要な警告なので併せて収録する。

WHATWG は HTML5 Web Storage API（`localStorage` と `sessionStorage`）をクライアント側で名前-値ペアを保存するメカニズムとして記述している。HTTP Cookie とは異なり、`localStorage` と `sessionStorage` の内容はブラウザによってリクエストやレスポンスに自動的に含められることはなく、クライアント側でのデータ保存に使われる。

> **[!WARNING]（原文の警告ブロック）**
> **認証トークン、セッションID、JWT、リフレッシュトークン、その他いかなるクレデンシャルも `localStorage` や `sessionStorage` に保存してはならない。** これらのAPIはそのオリジンで実行される**あらゆる**JavaScriptからアクセス可能であり、**単一のXSS脆弱性ですべてのトークンが漏えいする**。`HttpOnly; Secure; SameSite=Strict` Cookie（推奨）または Backend-for-Frontend (BFF) パターンを使うこと。[OAuth 2.0 for Browser-Based Apps](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps) を参照。

- **localStorage のスコープ**: 同一オリジン（scheme `https://`、host `example.com`、port `443`、domain/realm `example.com`）から読み込まれたページからアクセス可能。Cookieの `secure` フラグと同程度のアクセス制御に相当し、`https` から保存したデータは `http` 経由では取得できない。別ウィンドウ/スレッドからの同時アクセスがあり得るため、`localStorage` に保存したデータは共有アクセスの問題（レースコンディションなど）を受けやすく、non-locking と考えるべき（[Web Storage API Spec](https://html.spec.whatwg.org/multipage/webstorage.html#the-localstorage-attribute)）。
- **localStorage の持続期間**: ブラウジングセッションを越えて永続化され、他のシステムユーザからアクセス可能になる時間枠が広がる。
- **localStorage のオフラインアクセス**: 標準は保存時暗号化 (encrypted-at-rest) を要求していないため、**ディスクから直接データにアクセスできる可能性がある**。
- **localStorage の用途**: WHATWG は、ウィンドウやタブを越えて、複数セッションを越えてアクセスする必要があるデータ、および性能上の理由で大容量（数メガバイト）のデータを保存する必要がある場合を示唆。
- **sessionStorage のスコープ**: 呼び出したウィンドウコンテキスト内にデータを保存する。つまり **Tab 1 は Tab 2 から保存されたデータにアクセスできない**。また `localStorage` と同様、同一オリジンから読み込まれたページからアクセス可能。
- **sessionStorage の持続期間**: 現在のブラウジングセッションの間のみデータを保存。タブが閉じられればそのデータは取得不能になる。**ただしタブが再利用されたり開いたままにされた場合にアクセスを必ず防げるわけではない**。ガベージコレクションイベントまでメモリ内に残る場合もある。
- **sessionStorage のオフラインアクセス**: 標準は保存時暗号化を要求していないため、ディスクから直接アクセスできる可能性がある。
- **sessionStorage の用途**: WHATWG は、チケット予約の詳細のように1つのワークフローのインスタンスに関係し、かつ他タブで複数のワークフローが並行実行され得るデータを示唆。ウィンドウ/タブに束縛される性質が、別タブのワークフロー間でのデータ漏出を防ぐ。

**Web Workers**（同節より）: Web Worker は現在のウィンドウとは別のグローバルコンテキストでJavaScriptコードを実行する。メイン実行ウィンドウとの通信チャネルが存在し、これは `MessageChannel` と呼ばれる。ページリフレッシュを越えた保存の永続性が要件でない場合、Web Worker は（セッション）シークレットのブラウザ保存の代替となる。Web Workerが安全なブラウザ保存を提供するには、シークレットを必要とするコードはすべてWeb Worker内に存在すべきであり、シークレットはメインウィンドウのコンテキストへ決して送信してはならない。**Web Workerのメモリ内にシークレットを保存することは HttpOnly Cookie と同じセキュリティ保証を提供する（シークレットの機密性が保護される）。それでも XSS 攻撃を使って Web Worker にメッセージを送り、シークレットを必要とする操作を実行させることはできる**（Web Workerは操作結果をメイン実行スレッドに返す）。HttpOnly Cookie と比較した Web Worker 実装の利点は、隔離されたJavaScriptコードがシークレットにアクセスできることであり、HttpOnly Cookie はいかなるJavaScriptからもアクセスできない。フロントエンドJavaScriptコードがシークレットへのアクセスを必要とする場合、**Web Worker実装がシークレットの機密性を保つ唯一のブラウザ保存オプションである**。

参照リンク（原文のまま）:

- [Web Storage APIs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API)
- [LocalStorage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [SessionStorage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)
- [WHATWG Web Storage Spec](https://html.spec.whatwg.org/multipage/webstorage.html#webstorage)

---

## 参照先資料2: OWASP Secure Headers Project の機械可読な推奨定義（出典: https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json および `ci/headers_remove.json`、`last_update_utc: 2026-09-13 06:28:41`）

> 原典 HTTP Headers Cheat Sheet の References に挙がる [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/) の推奨値。**原典に節が無い `Clear-Site-Data` と `X-Permitted-Cross-Domain-Policies` を含む。** 値はJSONから逐語で転記（`Clear-Site-Data` の値はJSONエスケープを解いた実ヘッダ値で示す）。

### 追加すべきヘッダ（headers_add.json、全13件・逐語）

| ヘッダ | 推奨値（逐語） |
|---|---|
| `Cache-Control` | `no-store, max-age=0` |
| `Clear-Site-Data` | `"cache","cookies","storage"` |
| `Content-Security-Policy` | `default-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests` |
| `Cross-Origin-Embedder-Policy` | `require-corp` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Permissions-Policy` | `accelerometer=(), autoplay=(), camera=(), cross-origin-isolated=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), keyboard-map=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), sync-xhr=(self), usb=(), web-share=(), xr-spatial-tracking=(), clipboard-read=(), clipboard-write=(), gamepad=(), hid=(), idle-detection=(), interest-cohort=(), serial=(), unload=()` |
| `Referrer-Policy` | `no-referrer` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Frame-Options` | `deny` |
| `X-Permitted-Cross-Domain-Policies` | `none` |

**原典チートシートとの値の差異（教科書で明示すべき）**

| ヘッダ | HTTP Headers Cheat Sheet | Secure Headers Project |
|---|---|---|
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `no-referrer` |
| `Cross-Origin-Resource-Policy` | `same-site` | `same-origin` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | `max-age=63072000; includeSubDomains`（`preload` なし） |
| `Cache-Control` | 箇条書き指針のみ（機微データは `no-store`） | `no-store, max-age=0` |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()`（例示） | 29機能を網羅的に無効化（上記逐語値） |
| `Clear-Site-Data` | **節なし** | `"cache","cookies","storage"` |
| `X-Permitted-Cross-Domain-Policies` | **節なし** | `none` |
| `X-Frame-Options` | `DENY`（大文字） | `deny`（小文字） |

### 削除すべきヘッダ（headers_remove.json、全89件・逐語リスト）

`$wsep`, `Host-Header`, `K-Proxy-Request`, `Liferay-Portal`, `OracleCommerceCloud-Version`, `Pega-Host`, `Powered-By`, `Product`, `Server`, `SourceMap`, `TeamCity-Node-Id`, `X-AspNet-Version`, `X-AspNetMvc-Version`, `X-Atmosphere-error`, `X-Atmosphere-first-request`, `X-Atmosphere-tracking-id`, `X-B3-ParentSpanId`, `X-B3-Sampled`, `X-B3-SpanId`, `X-B3-TraceId`, `X-BEServer`, `X-Backside-Transport`, `X-CF-Powered-By`, `X-CMS`, `X-CalculatedBETarget`, `X-Cocoon-Version`, `X-Content-Encoded-By`, `X-Datadog-Origin`, `X-Datadog-Parent-Id`, `X-Datadog-Sampling-Priority`, `X-Datadog-Tags`, `X-Datadog-Trace-Id`, `X-DiagInfo`, `X-Envoy-Attempt-Count`, `X-Envoy-External-Address`, `X-Envoy-Internal`, `X-Envoy-Original-Dst-Host`, `X-Envoy-Upstream-Service-Time`, `X-FEServer`, `X-Framework`, `X-Generated-By`, `X-Generator`, `X-Gitlab-Meta`, `X-Jitsi-Release`, `X-Joomla-Version`, `X-Kong-Admin-Latency`, `X-Kong-Client-Latency`, `X-Kong-Proxy-Latency`, `X-Kong-Request-Id`, `X-Kong-Response-Latency`, `X-Kong-Third-Party-Latency`, `X-Kong-Total-Latency`, `X-Kong-Upstream-Latency`, `X-Kong-Upstream-Status`, `X-Kubernetes-PF-FlowSchema-UI`, `X-Kubernetes-PF-PriorityLevel-UID`, `X-LiteSpeed-Cache`, `X-LiteSpeed-Purge`, `X-LiteSpeed-Tag`, `X-LiteSpeed-Vary`, `X-Litespeed-Cache-Control`, `X-Mod-Pagespeed`, `X-Nextjs-Cache`, `X-Nextjs-Matched-Path`, `X-Nextjs-Page`, `X-Nextjs-Redirect`, `X-OWA-Version`, `X-Old-Content-Length`, `X-OneAgent-JS-Injection`, `X-Page-Speed`, `X-Php-Version`, `X-Powered-By`, `X-Powered-By-Plesk`, `X-Powered-CMS`, `X-Redirect-By`, `X-Server-Powered-By`, `X-SourceFiles`, `X-SourceMap`, `X-Turbo-Charged-By`, `X-Tyk-Trace-Id`, `X-Umbraco-Version`, `X-Varnish-Backend`, `X-Varnish-Server`, `X-Woodpecker-Version`, `X-dtAgentId`, `X-dtHealthCheck`, `X-dtInjectedServlet`, `X-ruxit-JS-Agent`

**診断上の使い方**: このリストは「レスポンスに現れたら技術スタック・内部ホスト名・トレースIDが漏れているサイン」となるヘッダの辞書として使える。特に `X-Nextjs-Matched-Path` / `X-Nextjs-Page`（内部ルーティング）、`X-Envoy-Original-Dst-Host` / `X-BEServer` / `X-FEServer` / `X-CalculatedBETarget`（内部バックエンドのホスト名 → SSRF/内部ネットワーク探索の手掛かり）、`X-SourceFiles` / `X-SourceMap` / `SourceMap`（ソースファイルパス・ソースマップの露出 → クライアントサイドのコード読解に直結）、`X-Datadog-*` / `X-B3-*`（分散トレーシングID）は、クライアントサイド脆弱性ハンティングの初期偵察で価値が高い。

---

## 原典に含まれていなかった重点項目（正直な差分報告）

担当指示の重点リストのうち、**原典 HTTP Headers Cheat Sheet に節が存在しないもの**:

1. **`Clear-Site-Data`** — 原典に節なし。ただし原典 References のリンク先である OWASP Secure Headers Project が推奨値 `"cache","cookies","storage"` を定義しており、上記「参照先資料2」に収録済み。〔補足（一般知識）〕仕様上のディレクティブは `"cache"`, `"cookies"`, `"storage"`, `"executionContexts"`, `"*"` で、値は二重引用符付きの文字列リストであり、ログアウト応答に付けてクライアント側の残存状態を消すのが主用途。原典に記述がないため、教科書では「OWASP HTTP Headers Cheat Sheet 由来ではない」と明記すること。
2. **`Access-Control-Allow-Credentials` / `-Allow-Methods` / `-Allow-Headers` / `-Expose-Headers` / `-Max-Age`** — 原典は `Access-Control-Allow-Origin` のみを扱う。CORS全体は別資料（OWASPの他チートシート、MDN、PortSwigger の CORS 解説）で補うこと。
3. **`Set-Cookie` 各属性の具体的推奨値** — 原典は委譲のみ。「参照先資料1」に完全収録した。
4. **`Content-Security-Policy` の具体的ディレクティブ設計** — 原典は委譲のみ。`Content_Security_Policy_Cheat_Sheet.html` が必要。ただし Secure Headers Project の推奨CSP文字列（`default-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests`）は「参照先資料2」で確保済み。
5. **`Expect-CT` の構文（`max-age`, `enforce`, `report-uri`）** — 原典は「使うな」の方針のみで構文は示していない。`report-uri` という語のみ登場。

---

## 読者が自分で開くべき資料

本環境では `cheatsheetseries.owasp.org` および `web.archive.org` への到達がegressプロキシで拒否された（`connect_rejected` / `EGRESS_BLOCKED`）ため、レンダリング済みHTMLページは閲覧できなかった。内容は正典Markdownソース（`OWASP/CheatSheetSeries` master）から全文取得済みだが、以下は読者自身がブラウザで開く価値がある。

### 1. https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html（本ノートの原典・レンダリング版）

**なぜ開くか**: 本ノートは同一内容のMarkdownソースから作成したため情報欠落はないが、公開ページは随時更新される。読みどころ:

1. 見出しに付く **❌ マーク**（`Expect-CT ❌`、`Public-Key-Pins (HPKP) ❌`）── 非推奨ヘッダの一目での識別。
2. 各節末の **推奨値の引用ブロック（`> ` に続くコード体のヘッダ値）**── コピー&ペースト可能な推奨値そのもの。本ノートの早見表と突き合わせて最新版との差分を確認する。
3. **「Adding HTTP Headers in Different Technologies」節**── Apache の `onsuccess`/`always` 二重テーブル問題と Nginx の `always` 省略時挙動。実務でヘッダが一部レスポンスにしか付かない原因の一次記述。
4. **各情報漏えいヘッダ節の *NOTE***── 「攻撃者は他の手段でフィンガープリンティングできる」という繰り返しの注意。レポートの深刻度判断に使う。
5. **References のリンク集**── MDN各ヘッダ、hstspreload.org、content-security-policy.com、resourcepolicy.fyi、OWASP Secure Headers Project への導線。

### 2. https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

**なぜ開くか**: 原典が CSP の詳細を完全に委譲している。読みどころ: (1) `default-src` からのホワイトリスト設計、(2) `nonce` / `strict-dynamic` を使ったインラインスクリプト対策、(3) `frame-ancestors` による X-Frame-Options の置き換え、(4) CSP の典型的バイパス（JSONP エンドポイント、寛容な `script-src` ホスト、`unsafe-eval`）、(5) `report-uri` / `report-to` による違反監視。

### 3. https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html

**なぜ開くか**: 原典が HSTS の詳細を委譲している。読みどころ: (1) `max-age` の適切な値と段階的な引き上げ手順、(2) `includeSubDomains` を付ける前の前提確認、(3) `preload` 登録の不可逆性とロールバック困難性、(4) HSTS が守らない範囲（初回アクセス／preload未登録時）。

### 4. https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookies

**なぜ開くか**: Set-Cookie 属性の一次情報。本ノート「参照先資料1」に全文相当を収録済みだが、`#cookies` 以降の Session ID Life Cycle 節（セッションID生成、有効期限、ログアウト、同時セッション、セッション固定対策）は本ノートの範囲外。読みどころ: (1) `__Host-` プレフィックスがセッションIDに推奨される理由、(2) `SameSite` を CSRF トークンの代替にしてはならない理由、(3) `Domain` 属性を設定しないことによる cross-subdomain cookie 攻撃の防止、(4) localStorage にトークンを置くなという WARNING ブロック、(5) Web Worker によるシークレット保持の設計。

### 5. https://owasp.org/www-project-secure-headers/ ならびに https://owasp.github.io/www-project-secure-headers/index/

**なぜ開くか**: 本環境では `owasp.org` の当該ページも取得せず、GitHubリポジトリの機械可読JSON（`ci/headers_add.json` / `ci/headers_remove.json`）のみを取得した。公開ページには各ヘッダの解説、ブラウザ対応状況、主要サイトのヘッダ実態調査、各種サーバ/フレームワークごとの設定例がある。読みどころ: (1) 推奨値の一覧表（本ノート収録の値の最新版）、(2) 削除すべきヘッダの一覧とそれぞれが露出する情報、(3) `Clear-Site-Data` と `X-Permitted-Cross-Domain-Policies` の解説（原典チートシートに節が無い部分）、(4) 各ヘッダのブラウザ互換性、(5) 各言語/サーバ向けライブラリ・設定スニペット。

### 6. https://observatory.mozilla.org/ / https://www.thesmartscanner.com/

**なぜ開くか**: 原典が推奨する検証ツール。読みどころ: (1) Observatory のスコアリング基準（どのヘッダに何点を配分しているか）、(2) 「オンラインツールはホームページのみを検査する」という原典の限界指摘、(3) SmartScanner のテストプロファイル設定 (`https://www.thesmartscanner.com/docs/configuring-security-tests`)。

---

## ch02 執筆時のメモ（後工程向け）

- **早見表は表として必ず転記する**（23行）。原典の推奨値文字列は1文字も変えないこと。特に `max-age=63072000; includeSubDomains; preload` のセミコロンとスペース、`Permissions-Policy` の `=()` 構文、`Clear-Site-Data` の二重引用符。
- **「無いこと＝脆弱性」ではないヘッダ**を明示する節を作る: `X-XSS-Protection`（`0` が正解）、`Expect-CT` / `Public-Key-Pins`（削除が正解）、`X-Frame-Options`（JSON API・リダイレクトでは無意味）、`CSP`（レンダリングされないAPIレスポンスでは無意味）、`X-DNS-Prefetch-Control`（本番で依存すべきでない）。
- **レスポンスコード横断の検査**を診断手順に組み込む根拠は Apache の `onsuccess`/`always` と Nginx の `always` の記述にある。
- **二つのOWASP資料の推奨値が食い違う**（Referrer-Policy、CORP、HSTSのpreload、X-Frame-Optionsの大小文字）。教科書では差異表をそのまま載せ、「OWASP内でも一枚岩ではない」と書くのが誠実。
- 原典は各ヘッダの**ブラウザ対応状況をほとんど書いていない**（例外: Referrer-Policy「2014年以来」、HPKP「2018年にChromiumから削除」、Expect-CT「主流クライアントは既にCT要求」）。対応状況を書く場合は必ず〔補足（一般知識）〕を付けること。
