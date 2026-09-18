# HTTPセキュリティレスポンスヘッダ完全ガイド — 何を送り、どこを突き、どう守るか

> **この節で分かること**
> - HTTPレスポンスヘッダがなぜ「安く効果の大きい」防御手段なのか、そしてブラウザが解釈して初めて意味を持つという適用範囲の限界を説明できる。
> - `X-Frame-Options` から `Permissions-Policy` まで、主要なセキュリティヘッダ23種類の推奨値と目的を一覧で言える。
> - Cookieの `Secure` / `HttpOnly` / `SameSite` 属性と `__Host-` プレフィックスがそれぞれ何を守り、何を守らないかを区別できる。
> - 「ヘッダが無い＝脆弱性」という早合点がなぜ誤りになるヘッダ（`X-XSS-Protection`・`Expect-CT`・HPKP・API向けの `X-Frame-Options` など）を挙げられる。
> - `X-Powered-By` や `X-Nextjs-Matched-Path` のような情報漏えいヘッダを、偵察（recon）でどう手掛かりにするかを自分でチェックできる。
> - サーバ設定（Apache / Nginx など）の落とし穴が原因で、200応答だけにヘッダが付きエラーページやリダイレクトに付かない抜け穴を検査できる。

**元資料**: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html （原典取得済み。ただしレンダリング済みHTMLページは執筆環境のプロキシで遮断されたため、同一内容の正典Markdownソース〔`OWASP/CheatSheetSeries` リポジトリ master ブランチ〕から全文を逐語取得した）
**関連する節**: 同一オリジンポリシー（Same-Origin Policy）とCORSの節、Content Security Policy（CSP）の節、クリックジャッキングの節

---

## 1. なぜヘッダで守るのか — 設計思想と「効かない場所」

### HTTPレスポンスヘッダとは

HTTPレスポンスヘッダとは、サーバがコンテンツ本体（HTMLやJSONなど）とは別に、レスポンスの先頭で送る「付帯情報」のこと。`名前: 値` という1行ずつの形で送られる。たとえば `Content-Type: text/html` はブラウザに「これはHTMLだ」と伝える。

このうち一部のヘッダは、ブラウザに対して「このページはフレームに入れるな」「HTTPSでしか通信するな」といった**安全側の指示**を与える。原典はこれらを「実装が容易でありながらWebセキュリティを大きく押し上げる手段」と位置づけている。適切なヘッダは、クロスサイトスクリプティング（Cross-Site Scripting, XSS）、クリックジャッキング、情報開示といった脆弱性の防止に役立つ。

XSSとは、攻撃者が仕込んだJavaScriptが被害者のブラウザ上で実行されてしまう脆弱性のこと。クリックジャッキングとは、透明なフレームなどで正規サイトを覆い、ユーザに気づかせないまま危険な操作をクリックさせる攻撃のこと。これらの「軽減層」を1行のヘッダで足せるのがヘッダ防御の魅力である。

### 設計意図: 多層防御（defense in depth）

ヘッダによる防御は、アプリ本体のバグを完全になくすものではない。あくまで「もしXSSが混入しても被害を小さくする」「もし証明書が偽造されても影響を減らす」といった**多層防御（defense in depth）**の一枚として設計されている。多層防御とは、防御を1つに頼らず何重にも重ねて、どれか1つが破られても全体が守られるようにする考え方のこと。

この視点は診断の判断基準にも直結する。あるヘッダが欠けていても、それだけでは「悪用可能な脆弱性」とは限らない。実際に何が達成できるかを示せて初めてバグとして成立する。

### 「効かない場所」を最初に押さえる — ブラウザが解釈して初めて意味を持つ

原典が繰り返し強調する最重要ポイントがこれである。**セキュリティヘッダは、ブラウザがそのレスポンスを解釈して初めて意味を持つ。**

- `X-Frame-Options` は、そのレスポンスに「操作する対象（リンクやボタン）」がある場合にだけ意味がある。リダイレクトやJSONを返すAPIレスポンスでは、クリックジャッキングの対象そのものが無いため、何のセキュリティも提供しない。
- CSPは「スクリプトやコードを読み込んで解釈するページ」に適用する意義があるが、レンダリングされないコンテンツを返すREST APIのレスポンスでは無意味な場合がある。
- COOP / COEP / CORP（後述）は「ブラウザに非常に関係が深い」ため、REST APIや非ブラウザのクライアントに適用しても意味をなさない場合がある。

```
[サーバ] --HTTPレスポンス+ヘッダ--> [ブラウザ]
                                       |
                    ここでヘッダが解釈されて初めて防御が働く
                                       |
    ・HTML/スクリプトを描画するページ → ヘッダが効く
    ・JSONだけ返すAPI / 生バイナリ    → 多くのヘッダは意味なし
    ・curl等の非ブラウザクライアント  → ヘッダを無視できる（攻撃者は従わない）
```

つまり、ヘッダは「善意のブラウザ」に守ってもらう仕組みであって、攻撃者が使う `curl` やスクリプトはヘッダを平気で無視できる。この非対称性を理解しておくと、後半の「無いこと＝脆弱性ではない」の議論がすっきり読める。

### この節の読み方

以降は、原典の各ヘッダを **なぜそうなっているのか（設計意図）→ どう動くのか（仕組み）→ 攻撃者はどこを突くのか → どう守るのか** の順で見ていく。まず全体像として早見表を置き、その後にグループごとに掘り下げる。

---

## 2. 全セキュリティヘッダ早見表（23項目）

原典は表ではなく節ごとの記述だが、参照しやすいよう推奨値を**逐語のまま**表に再構成した（値は一切改変していない）。`❌` が付くヘッダは非推奨で、後述する。

| # | ヘッダ | 推奨値（逐語） | 目的の要旨 |
|---|---|---|---|
| 1 | `X-Frame-Options` | `X-Frame-Options: DENY` | フレーム埋め込みを禁じクリックジャッキングを防ぐ |
| 2 | `X-XSS-Protection` | `X-XSS-Protection: 0` | 旧XSSフィルタ。**明示的にオフが推奨** |
| 3 | `X-Content-Type-Options` | `X-Content-Type-Options: nosniff` | MIMEスニッフィングを禁じる |
| 4 | `Referrer-Policy` | `Referrer-Policy: strict-origin-when-cross-origin` | Refererで送る情報量を制御 |
| 5 | `Content-Type` | `Content-Type: text/html; charset=UTF-8` | メディアタイプを正しく宣言する |
| 6 | `Cache-Control` | （箇条書き指針。本文参照） | キャッシュのされ方を制御 |
| 7 | `Set-Cookie` | （委譲。属性が重要） | Cookieを送る。属性のセキュリティが要 |
| 8 | `Strict-Transport-Security` | `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` | HTTPS通信を強制 |
| 9 | `Expect-CT` ❌ | **使用しない** | Certificate Transparencyの報告。回避推奨 |
| 10 | `Content-Security-Policy` | （委譲。CSP専用チートシートへ） | 読み込み許可originを指定しXSSを軽減 |
| 11 | `Access-Control-Allow-Origin` | `Access-Control-Allow-Origin: https://yoursite.com` | SOPを特定条件下で緩めるCORSヘッダ |
| 12 | `Cross-Origin-Opener-Policy` (COOP) | `Cross-Origin-Opener-Policy: same-origin` | ブラウジングコンテキストを隔離 |
| 13 | `Cross-Origin-Embedder-Policy` (COEP) | `Cross-Origin-Embedder-Policy: require-corp` | 許可なきクロスオリジン読み込みを禁止 |
| 14 | `Cross-Origin-Resource-Policy` (CORP) | `Cross-Origin-Resource-Policy: same-site` | 埋め込み可能なoriginを制限 |
| 15 | `Permissions-Policy` | `Permissions-Policy: geolocation=(), camera=(), microphone=()` | ブラウザ機能の使用可否を制御 |
| 16 | `Server` | `Server: webserver` | 削除または非情報値に |
| 17 | `X-Powered-By` | **全て削除** | 技術スタックを露出させる |
| 18 | `X-AspNet-Version` | 送信を無効化 | .NETのバージョンを露出 |
| 19 | `X-AspNetMvc-Version` | 送信を無効化 | .NETのバージョンを露出 |
| 20 | `X-Robots-Tag` | `noindex, nofollow` ／ `index, follow` | クローラのインデックスを制御 |
| 21 | `X-DNS-Prefetch-Control` | `X-DNS-Prefetch-Control: off` | DNSプリフェッチを制御 |
| 22 | `Public-Key-Pins` (HPKP) ❌ | **使用しない** | 公開鍵ピンニング。全モダンブラウザで非対応 |
| 23 | Secure File Download（3点） | `Content-Disposition: attachment` ／ `Content-Type: application/octet-stream` ／ `X-Content-Type-Options: nosniff` | ファイル配信時の意図しない実行を防ぐ |

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP HTTP Headers Cheat Sheet（レンダリング版）— https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `cheatsheetseries.owasp.org` および `web.archive.org` が egress プロキシで遮断され、`connect_rejected` / `EGRESS_BLOCKED` になった）。以下の記述は、このページの生成元である正典Markdownソース（`OWASP/CheatSheetSeries` master、内容は同一）にもとづく。公開ページは随時更新されるため最新版の確認は自分で行うこと。
> **読みどころ**:
> 1. 見出しに付く `❌` マーク（`Expect-CT ❌`、`Public-Key-Pins (HPKP) ❌`）で、非推奨ヘッダを一目で見分ける。
> 2. 各節末の引用ブロックにある推奨値そのもの（コピー&ペースト用）。本節の早見表と突き合わせて差分を確認する。
> 3. 「Adding HTTP Headers in Different Technologies」節。Apacheの `onsuccess`/`always` 問題やNginxの `always` 省略時挙動の一次記述。
> 4. 各情報漏えいヘッダ節の NOTE。「攻撃者は他の手段でフィンガープリンティングできる」という繰り返しの注意。深刻度判断に使う。
> 5. References のリンク集。MDN各ヘッダ、hstspreload.org、content-security-policy.com、resourcepolicy.fyi、OWASP Secure Headers Project への導線。
> **代替手段**: 同内容のMarkdownソースが `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTTP_Headers_Cheat_Sheet.md` にある。

---

## 3. クリックジャッキングを防ぐ: X-Frame-Options

### なぜ存在するか

`X-Frame-Options` は、ブラウザがそのページを `<frame>` / `<iframe>` / `<embed>` / `<object>` の中でレンダリングすることを許すかどうかを示すヘッダである。サイトはこれを使って、自分のコンテンツが他サイトに埋め込まれないことを保証し、クリックジャッキング攻撃を避けられる。

### どう動くか

推奨は「フレーム内表示を一切許可しない」設定である。

```http
X-Frame-Options: DENY
```

より新しい仕組みとして、CSPの `frame-ancestors` ディレクティブがある。対応ブラウザでは、この `frame-ancestors` が `X-Frame-Options` を obsolete（陳腐化）させる。したがって原典は「可能であればCSPの `frame-ancestors` を使う」ことを第一に挙げている。

### 攻撃者はどこを突くか / 診断の勘所

`X-Frame-Options` が有用なのは、それが含まれるレスポンスに**何か操作する対象（リンク、ボタンなど）がある場合に限られる**。レスポンスがリダイレクトである場合、あるいはJSONを返すAPIである場合、このヘッダは何のセキュリティも提供しない。

〔補足（一般知識）〕バグバウンティ観点では「`X-Frame-Options` が無い」だけでは通常、低〜情報レベル扱いにとどまる。実際にクリックジャッキングで達成できる状態変更操作（ワンクリックでの設定変更・アカウント削除・購入など）まで示して初めて評価される。原典の「操作対象があるレスポンスでのみ意味を持つ」という記述は、その判断基準そのものである。

### どう守るか（各技術での設定例）

具体的なサーバ設定は本節の「15. 技術スタック別のヘッダ設定」でまとめて扱う。

---

## 4. コンテンツの解釈を握る: nosniff / Content-Type / セキュアなダウンロード

このグループは「ブラウザがバイト列を何として扱うか」を制御し、ファイルアップロード起点のXSSなどを塞ぐ。

### X-Content-Type-Options（MIMEスニッフィングの禁止）

MIMEタイプとは、データの種類を表す識別子のこと。たとえば `text/html`（HTML）、`image/png`（PNG画像）など。ブラウザはこれを見て「HTMLとして描画するか、画像として表示するか」を決める。

MIMEスニッフィング（MIME sniffing）とは、ブラウザが `Content-Type` の宣言を信用せず、中身から種類を推測してしまう挙動のこと。これが悪用されると、**非実行のMIMEタイプが実行可能なMIMEタイプに変換されてしまう**（MIME Confusion Attacks）。たとえば「画像のつもりでアップロードされたファイルがHTML/スクリプトとして実行される」といった事故が起きる。

`nosniff` は、この推測を禁じ、宣言された `Content-Type` に従わせる。

```http
X-Content-Type-Options: nosniff
```

原典は「併せてサイト全体で `Content-Type` を正しく設定すること」を求めている。

### Content-Type（誤設定はXSSになる）

`Content-Type` は、リソースの元のメディアタイプを示すヘッダである。これが正しく設定されていないと、リソース（例: 画像）がHTMLとして解釈され、XSS脆弱性が成立し得る。

```http
Content-Type: text/html; charset=UTF-8
```

重要な条件がある。**脆弱性を構成するのは、そのコンテンツがクライアントによってレンダリングされる意図があり、かつリソースが信頼できない（ユーザによって提供または改変された）場合のみ**である。原典の NOTE は次の2点を挙げる。

- `charset` 属性は **HTML** ページにおけるXSS防止に必要である。
- `Content-Type` の値は取り得る任意のMIMEタイプでよい。

〔補足（一般知識）〕`charset` 未指定が問題になる典型は、ブラウザが文字セットを推測し、`<` に相当するバイト列がタグとして解釈されるケースである。原典は「XSS防止に必要」とだけ述べ機序は説明していないため、機序は補足として理解しておく。

### Secure File Download Headers（3点セット）

ユーザ提供のファイルを配信するときは、ブラウザでの意図しない実行を防ぐために次の3つを組み合わせる。

- `Content-Disposition: attachment` — inlineレンダリングではなくダウンロードを強制する。
- `Content-Type: application/octet-stream` — 不明なファイルやバイナリファイルに使う。
- `X-Content-Type-Options: nosniff` — MIMEスニッフィングを防ぐ。

これらがXSSや意図しないファイル実行のリスクを減らす。

〔補足（一般知識）〕バグバウンティでの典型は、ユーザがアップロードしたSVG / HTML / PDF が `Content-Type: image/svg+xml` や `text/html` でinline配信され、同一オリジンでスクリプトが走る「stored XSS via file upload」である。この3ヘッダの組み合わせがその主要な防御線になる。逆に診断側は「アップロードしたファイルがどの `Content-Type` で、`attachment` 付きで返るか」を必ず確認する。

---

## 5. XSS対策の新旧: X-XSS-Protection と CSP

### X-XSS-Protection — 「無い／0」が正解という逆説

`X-XSS-Protection` は Internet Explorer・Chrome・Safari が持っていた機能で、反射型XSS攻撃を検出したときにページの読み込みを停止させるものだった。反射型XSSとは、URLパラメータなどに入れた攻撃コードがそのまま応答に反映されて実行される種類のXSSのこと。

ここに落とし穴がある。原典は WARNING として、このヘッダが「**場合によっては、そうでなければ安全なWebサイトにXSS脆弱性を作り出してしまうことがある**」と明記している。フィルタ自体が新たな穴になり得るのである。

そのため推奨は次のとおりで、フィルタを明示的にオフにするか設定しないことである。

```http
X-XSS-Protection: 0
```

原典の推奨は「インラインJavaScriptの使用を無効化するCSPを使う」ことと、「このヘッダを設定しない、または明示的にオフにする」ことの2点。

**診断上の要点**: 「`X-XSS-Protection` が無い／`0` になっている」ことを脆弱性として報告するのは誤りである。原典は明確に「設定しないか、明示的に `0` にせよ」と推奨している。自動スキャナがこれを指摘してきても、そのまま提出してはならない。

### Content-Security-Policy（CSP）— 追加の防御層

CSPとは、Webサイトで読み込みが許可されるコンテンツのoriginを指定するセキュリティ機能のこと。オリジン（origin）とは「スキーム + ホスト名 + ポート番号」の組のことで、`https://example.com:443` のように識別される。

CSPは、XSSやデータインジェクション攻撃を含む特定の攻撃を検出・軽減するのに役立つ追加の層である。これらの攻撃はデータ窃取からサイト改ざん、マルウェア配布まであらゆることに使われる。

原典の NOTE: このヘッダは**スクリプトやコードを読み込んで解釈できるページに適用することに意義がある**が、レンダリングされないコンテンツを返すREST APIのレスポンスでは無意味な場合がある。

CSPは設定と維持が複雑なため、原典は詳細を専用の Content Security Policy Cheat Sheet に委譲している。〔補足（原典のReferences由来）〕原典のReferencesには実用リファレンスとして Content Security Policy Reference（https://content-security-policy.com/ ）が挙がっている。また後述する OWASP Secure Headers Project が具体的な推奨CSP文字列を持つ。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `cheatsheetseries.owasp.org` が egress プロキシで遮断された）。原典 HTTP Headers Cheat Sheet はCSPの詳細をこの資料に完全委譲しており、CSPの実装はここを読まないと組めない。
> **読みどころ**:
> 1. `default-src` からのホワイトリスト設計の考え方。
> 2. `nonce` / `strict-dynamic` を使ったインラインスクリプト対策。
> 3. `frame-ancestors` による `X-Frame-Options` の置き換え。
> 4. CSPの典型的バイパス（JSONPエンドポイント、寛容な `script-src` ホスト、`unsafe-eval`）。診断で「CSPがあるのにXSSが成立する」根拠になる。
> 5. `report-uri` / `report-to` による違反監視。
> **代替手段**: 同内容のMarkdownソースが `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Content_Security_Policy_Cheat_Sheet.md` にある。

---

## 6. リファラとキャッシュ: Referrer-Policy と Cache-Control

### Referrer-Policy — 秘密のURL漏れを防ぐ

`Referrer-Policy` は、リクエストにどれだけのリファラ情報を含めるかを制御するヘッダである。リファラ（referrer）とは、「どのページから来たか」を示す情報で、`Referer` ヘッダ（歴史的な綴りミスで1つの `r` が欠けている）で送られる。

Referrer policyは2014年以来ブラウザにサポートされている。今日のモダンブラウザの既定動作は、**すべてのリファラ情報（origin、path、クエリ文字列）を同一サイトへ送るのはやめず、他サイトへはoriginのみを送る**というもの。しかし全ユーザが最新ブラウザとは限らないため、原典はこの動作を全レスポンスで明示的に送って強制することを提案している。

```http
Referrer-Policy: strict-origin-when-cross-origin
```

〔補足（一般知識）〕診断では「URLのクエリ文字列やパスに秘密（トークン、パスワードリセットキー、セッションID）が含まれているページから、外部リソース（画像、解析スクリプト、外部リンク）を読み込んでいるか」を見る。`Referrer-Policy` が緩いと、その秘密が `Referer` として外部ドメインに漏れる。原典が「全レスポンスで明示せよ」と言う理由はここにある。

### Cache-Control — 「no-cache はキャッシュを防がない」

`Cache-Control` は、レスポンスがブラウザおよび中間キャッシュによってどうキャッシュされるかを定義するヘッダである。中間キャッシュとは、ブラウザとサーバの間にあるCDNやプロキシなど、応答を一時保存する仕組みのこと。

原典の推奨は単一の値ではなく、次の箇条書き指針である。

- 機微なデータには `no-store` を使い、あらゆる形態のキャッシュを防ぐ。
- `private` を使って非共有（ユーザ固有）キャッシュでのみキャッシュを許可し、共有キャッシュへの保存を防ぐ（ただし privateキャッシュは依然としてレスポンスを保持し続ける可能性がある）。
- 機微または保護されたコンテンツについて、既定のキャッシュ動作に依存することを避ける。
- **`no-cache` はキャッシュを防がないことを認識する。** `no-cache` はキャッシュがレスポンスを保存することを許し、再利用前にオリジンサーバでの再検証を要求するだけである。

機微データの保存を厳密に防がねばならない場合は `no-store` を使う。

**診断の勘所**: 「機微な個人情報や残高が表示されるページに `Cache-Control: no-store` が付いているか」「`no-cache` を `no-store` のつもりで使っていないか」を見る。共有端末やプロキシキャッシュに機微データが残る事故は、`no-cache` の誤解から起きやすい。

---

## 7. Cookieのセキュリティ属性: Set-Cookie

`Set-Cookie` は、サーバからユーザエージェント（ブラウザ）へCookieを送るヘッダである。ユーザエージェントは後でそれをサーバへ送り返す。**複数のCookieを送るには、同一レスポンス内で複数の `Set-Cookie` ヘッダを送る。**

原典は「これは厳密にはセキュリティヘッダそのものではないが、そのセキュリティ属性は極めて重要 (crucial) である」と述べ、詳細を OWASP Session Management Cheat Sheet に委譲している。ここではその委譲先の内容を主材料に、属性を1つずつ見ていく。

### Secure — HTTPSでしか送らせない（必須）

`Secure` 属性は、暗号化されたHTTPS（SSL/TLS）接続を通じてのみCookieを送るようブラウザに指示する。このセッション保護メカニズムは、**MitM（Man-in-the-Middle, 中間者）攻撃によるセッションID漏えいを防ぐために必須（mandatory）**である。中間者攻撃とは、通信経路に割り込んで盗聴・改ざんする攻撃のこと。

原典は重要な注意を付けている。**`Secure` が設定されていなければ、たとえサーバ側でHTTP（TCP/80）を閉じていても、セッションID漏えいは防げない。** 攻撃者は被害者のトラフィックを傍受・操作し、WebアプリへのHTTP非暗号化参照を注入して、ブラウザにセッションIDを平文で送らせることができるからである。

### HttpOnly — JavaScriptから読めなくする（必須）

`HttpOnly` 属性は、スクリプト（JavaScriptなど）が DOM の `document.cookie` オブジェクト経由でCookieにアクセスすることを許さないようブラウザに指示する。DOMとは、ページの構造をJavaScriptから操作できるようにしたオブジェクト表現のこと。

このセッションID保護は、**XSS攻撃によるセッションID窃取を防ぐために必須**である。ただし限界も明記されている。XSSがCSRF攻撃と組み合わされた場合、ブラウザはリクエスト送信時に常にCookieを含めるため、Webアプリに送られるリクエストにはセッションCookieが含まれてしまう。CSRF（Cross-Site Request Forgery, クロスサイトリクエストフォージェリ）とは、ログイン状態を悪用して意図しないリクエストを送らせる攻撃のこと。つまり **`HttpOnly` が保護するのはCookieの機密性のみ**であり、攻撃者はXSSのコンテキスト外・オフラインでそれを使えないというだけである。

### SameSite — CSRFへの多層防御（トークンの代替にはならない）

`SameSite` 属性は、ブラウザがクロスサイトリクエストでCookieを送るかどうかを制御する。

- `SameSite=Strict` はクロスサイトリクエストを排除する。
- `SameSite=Lax` は安全なHTTPメソッドを使うトップレベルのクロスサイトナビゲーションを許可する。

原典の重要な指示は次のとおりである。

- `SameSite` は **CSRFに対する多層防御として扱い、CSRFトークンの代替として扱ってはならない**。
- セッションCookieは `SameSite=Strict`（推奨）または `SameSite=Lax` を明示的に設定しなければならない。
- **`Secure` なしで `SameSite=None` を使ってはならない。**
- ブラウザとバージョンによって異なる既定値に依存してはならない。

### Cookie名プレフィックス — ブラウザに強制させる

Cookie名の先頭に特定のプレフィックスを付けると、ブラウザがそのCookieに対して属性の条件を強制するようになる（RFC 6265bis §4.1.3）。

| プレフィックス | 強制される条件 | 効果・推奨度 |
|---|---|---|
| `__Host-` | `Secure` 付きで設定され、`Domain` 属性を持たず、`Path=/` を使う | サブドメインによる偽造（subdomain forgery）とHTTPSダウングレード攻撃を防ぐ。**セッションIDに推奨** |
| `__Secure-` | `Secure` 付きで設定される | サブドメイン共有が必要な場合にのみ使う |

セッションIDに推奨される具体形は次のとおり。

```http
Set-Cookie: __Host-SessionID=<value>; Secure; HttpOnly; SameSite=Strict; Path=/
```

〔補足〕`__Host-` が強力なのは、名前を見ただけでブラウザが「`Domain` 無し・`Path=/`・`Secure`」を機械的に強制する点にある。設定漏れをブラウザ側が拒否してくれる。

### Domain と Path — スコープは狭く

`Domain` 属性は、指定ドメインと**そのすべてのサブドメイン**にCookieを送るよう指示する。設定しない場合、既定ではオリジンサーバにのみ送られる。`Path` 属性は、指定ディレクトリ以下にのみCookieを送るよう指示する。

原典は「これら2つには狭い／制限されたスコープを使うこと」を推奨する。具体的には**`Domain` 属性は設定すべきでなく**（Cookieをオリジンサーバのみに制限する）、`Path` 属性はセッションIDを使うパスに可能な限り制限的に設定すべきである。

攻撃面の説明も明快である。`Domain` に `example.com` のような過度に寛容な値を設定すると、同一ドメインの異なるホスト間でセッションIDへの攻撃（cross-subdomain cookies）が可能になる。たとえば `www.example.com` の脆弱性を突いて、攻撃者が `secure.example.com` のセッションIDにアクセスできるかもしれない。さらに、寛容な `Domain` を使えば別アプリのセッションIDを設定でき、これはセッションフィクセーション攻撃（攻撃者が用意したセッションIDを被害者に使わせる攻撃）に使える。原典は「異なるセキュリティレベルのアプリを同一ドメインに混在させないこと」も勧めている。

### Expire と Max-Age — セッションは非永続Cookieで

Cookieは、非永続的（セッション）Cookieと永続的Cookieに分かれる。`Max-Age`（`Expires` より優先される）または `Expires` を持つCookieは永続的とみなされ、期限までディスクに保存される。

原典は**セッション管理には非永続的Cookieを強く推奨**する。ブラウザインスタンスが閉じられればセッションがクライアントから消え、セッションIDが長期間キャッシュに残って攻撃者に取得される事態を避けられるからである。

原典のチェックリスト（逐語の箇条書き）:

- 機微情報が永続化されないこと、暗号化されること、必要な期間のみ保存されることを確実にする。
- Cookieの操作によって認可されていない活動が行われ得ないことを確実にする。
- `secure` フラグが設定されていることを確実にする。
- アプリケーションコード中のすべての状態遷移がCookieを適切に検査し、その使用を強制しているか判断する。
- 機微データがCookieに永続化される場合はCookie全体が暗号化されるべきことを確実にする。
- 使用するすべてのCookieについて、その名前と必要な理由を定義する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP Session Management Cheat Sheet — Cookies 節 — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookies
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `cheatsheetseries.owasp.org` が egress プロキシで遮断された）。上記の属性解説は、この資料の生成元Markdownから逐語取得した内容にもとづく。ただし `#cookies` 以降のセッションIDライフサイクル節（ID生成、有効期限、ログアウト、同時セッション、セッション固定対策）は本節の範囲外なので自分で読む価値がある。
> **読みどころ**:
> 1. `__Host-` プレフィックスがセッションIDに推奨される理由。
> 2. `SameSite` をCSRFトークンの代替にしてはならない理由。
> 3. `Domain` 属性を設定しないことによる cross-subdomain cookie 攻撃の防止。
> 4. `localStorage` にトークンを置くなという WARNING ブロック（次の小節で扱う）。
> 5. Web Worker によるシークレット保持の設計。
> **代替手段**: 同内容のMarkdownソースが `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Session_Management_Cheat_Sheet.md` にある。

---

## 8. トークンをどこに置くか: localStorage / sessionStorage / Web Worker

Cookieの話と表裏一体で、原典の参照先はHTML5 Web Storage APIについて強い警告を出している。ヘッダ章に直結するので併せて扱う。

### Web Storageとは

HTML5 Web Storage API（`localStorage` と `sessionStorage`）は、クライアント側で名前-値ペアを保存する仕組みである。HTTP Cookieと異なり、`localStorage` と `sessionStorage` の内容は**ブラウザによってリクエストやレスポンスに自動で含められることはなく**、クライアント側でのデータ保存に使われる。

### 最重要の警告（原文の WARNING ブロック）

> **[!WARNING]** 認証トークン、セッションID、JWT、リフレッシュトークン、その他いかなるクレデンシャルも `localStorage` や `sessionStorage` に保存してはならない。これらのAPIはそのオリジンで実行される**あらゆる**JavaScriptからアクセス可能であり、**単一のXSS脆弱性ですべてのトークンが漏えいする**。`HttpOnly; Secure; SameSite=Strict` Cookie（推奨）または Backend-for-Frontend (BFF) パターンを使うこと。

JWT（JSON Web Token）とは、署名付きでユーザ情報などを載せられるトークン形式のこと。BFFパターンとは、フロントエンド専用のバックエンドを1枚挟み、トークンをブラウザに渡さずサーバ側で保持する設計のこと。

**診断の勘所**: これは「`localStorage` にトークンがあり、かつXSSが1つ見つかれば全アカウント奪取まで一直線」という攻撃連鎖の根拠になる。DevToolsのApplicationタブで `localStorage` を開き、`token` / `jwt` / `access_token` のようなキーがあるかを最初に確認する。

### localStorage の性質

- **スコープ**: 同一オリジン（scheme `https://`、host `example.com`、port `443`）から読み込まれたページからアクセス可能。`https` から保存したデータは `http` 経由では取得できない。別ウィンドウ/スレッドから同時アクセスがあり得るため non-locking と考えるべきで、レースコンディション（複数処理が同時アクセスして結果が壊れる問題）を受けやすい。
- **持続期間**: ブラウジングセッションを越えて永続化し、他のシステムユーザからアクセス可能になる時間枠が広がる。
- **オフラインアクセス**: 標準は保存時暗号化（encrypted-at-rest）を要求していないため、ディスクから直接データにアクセスできる可能性がある。
- **用途**: WHATWG は、ウィンドウやタブ・複数セッションを越えてアクセスする必要があるデータや、性能上の理由で大容量（数メガバイト）を保存する場合を示唆している。

### sessionStorage の性質

- **スコープ**: 呼び出したウィンドウコンテキスト内にデータを保存する。つまり **Tab 1 は Tab 2 が保存したデータにアクセスできない**。同一オリジン制約は `localStorage` と同じ。
- **持続期間**: 現在のブラウジングセッションの間のみ保存し、タブが閉じられれば取得不能になる。ただしタブが再利用・開いたままの場合にアクセスを必ず防げるわけではなく、ガベージコレクションまでメモリに残る場合もある。
- **オフラインアクセス**: 同様に保存時暗号化は要求されず、ディスクから直接アクセスできる可能性がある。
- **用途**: WHATWG は、チケット予約の詳細のように1ワークフローに閉じたデータを示唆する。タブに束縛される性質が、別タブのワークフロー間でのデータ漏出を防ぐ。

### Web Worker — シークレット保持の代替

Web Worker とは、現在のウィンドウとは別のグローバルコンテキストでJavaScriptを実行する仕組みのこと。メイン実行ウィンドウとの通信チャネル（`MessageChannel`）が存在する。

ページリフレッシュを越えた永続性が要件でない場合、Web Worker は（セッション）シークレットのブラウザ保存の代替になる。条件は、**シークレットを必要とするコードはすべてWeb Worker内に置き、シークレットをメインウィンドウのコンテキストへ決して送信しない**こと。

Web Workerのメモリ内にシークレットを保存することは、HttpOnly Cookie と同じセキュリティ保証（シークレットの機密性の保護）を提供する。それでもXSSを使ってWeb Workerにメッセージを送り、シークレットを必要とする操作を実行させることはできる（結果はメインスレッドに返る）。HttpOnly Cookie と比べた利点は、隔離されたJavaScriptコードがシークレットにアクセスできる点である。フロントエンドのJSコードがシークレットへのアクセスを必要とする場合、**Web Worker実装がシークレットの機密性を保つ唯一のブラウザ保存オプション**である。

---

## 9. 通信を守る: HSTS（Strict-Transport-Security）

### なぜ・どう動くか

`Strict-Transport-Security`（HSTS）は、ユーザがHTTPで接続しようとした場合でも、HTTPSのみを使ってサイトにアクセスするようブラウザに指示するヘッダである。

```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

- `max-age=63072000` は「この秒数だけHTTPS強制を覚えておけ」という指示。〔補足〕63,072,000秒 = 730日 = 2年である。
- `includeSubDomains` はサブドメインにも同じ強制を及ぼす。
- `preload` は、ブラウザにあらかじめ組み込んでもらう登録リスト（https://hstspreload.org/ ）へのオプトインである。原典のReferencesにも HSTS Preload List が挙がっている。

### 攻撃者はどこを突くか / 運用リスク

原典は強い NOTE を付けている。**このヘッダを使う前にどう動作するかを注意深く読むこと。** 誤設定や証明書の問題があると、正規ユーザがアクセスできなくなる。たとえば非常に長い `max-age` を設定した状態でSSL/TLS証明書が期限切れ・失効すると、**`max-age` の期間が満了するまで正規ユーザはサイトにアクセスできなくなる**おそれがある。攻撃というより自傷リスクだが、これはHSTS特有の「効きすぎる」危険である。

HSTSは初回アクセス（まだヘッダを受け取っていない状態）やpreload未登録の場面では守れない、という限界もある。詳細は専用チートシートに委譲されている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP HTTP Strict Transport Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `cheatsheetseries.owasp.org` が egress プロキシで遮断された）。原典はHSTSの詳細をこの資料に委譲している。誤設定でサイト全体をアクセス不能にし得るため、導入前に読む価値が高い。
> **読みどころ**:
> 1. `max-age` の適切な値と段階的な引き上げ手順（いきなり2年にしない）。
> 2. `includeSubDomains` を付ける前の前提確認。
> 3. `preload` 登録の不可逆性とロールバックの困難さ。
> 4. HSTSが守らない範囲（初回アクセス／preload未登録時）。
> **代替手段**: 同内容のMarkdownソースが `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.md` にある。

---

## 10. オリジン境界の制御: CORS とクロスオリジン隔離

### Access-Control-Allow-Origin — SOPを「緩める」ヘッダ

まず前提として、原典の重要な一文がある。**このヘッダを使わないなら、サイトは既定で同一オリジンポリシー（Same-Origin Policy, SOP）によって保護されている。このヘッダがするのは、指定された状況下でその制御を緩める（relax）ことである。**

同一オリジンポリシーとは、あるオリジンのページが別オリジンのリソースを勝手に読めないようにするブラウザの基本ルールのこと。CORS（Cross-Origin Resource Sharing, オリジン間リソース共有）は、その壁に安全な穴を開ける仕組みである。

`Access-Control-Allow-Origin` は、レスポンスを、与えられたoriginの要求コードと共有してよいかを示す。siteA が siteB からリソースを要求する場合、siteB は自身のこのヘッダで「siteA が取得してよい」と示す必要があり、そうでなければSOPによりアクセスはブロックされる。

```http
Access-Control-Allow-Origin: https://yoursite.com
```

原典は「`*`（ワイルドカード=すべて許可）ではなく具体的なoriginを設定する」ことを推奨する。ただし NOTE で、任意originからアクセス可能であるべき公開APIなど `*` が必要な場合もあると認めている。

**原典の範囲に関する注記**: 本チートシートが扱う `Access-Control-*` は `Access-Control-Allow-Origin` のみである。`Access-Control-Allow-Credentials` / `-Allow-Methods` / `-Allow-Headers` / `-Expose-Headers` / `-Max-Age` には節がない。CORS全体の診断（特に `Access-Control-Allow-Credentials: true` と反射的origin許可の組み合わせによる情報奪取）は別資料で補う必要がある。

### COOP / COEP / CORP — Spectre対策のオリジン隔離

この3つは、CPUの投機的実行の副作用を突く Spectre のような攻撃に対して、ブラウザのプロセス境界でオリジンを隔離するための新しいヘッダ群である。Spectre とは、本来アクセスできないはずのメモリ内容を、実行時間の差などを通じて推測できてしまう脆弱性のこと。SOPが確立したセキュリティ境界を越えられてしまう点が問題だった。

**COOP（Cross-Origin-Opener-Policy）** は、トップレベル文書がクロスオリジン文書とブラウジングコンテキストグループを共有しないことを保証する。ブラウジングコンテキストとは、ページが表示されるタブやウィンドウの実行環境のこと。COOPはブラウジングコンテキストを同一オリジン文書のみに隔離する。

```http
Cross-Origin-Opener-Policy: same-origin
```

**COEP（Cross-Origin-Embedder-Policy）** は、文書に明示的な許可（CORP または CORS）を与えていないクロスオリジンリソースの読み込みを禁止する。有効化すると、正しく設定されていないクロスオリジンリソースの読み込みがブロックされる点に注意。

```http
Cross-Origin-Embedder-Policy: require-corp
```

特定のリソースは `crossorigin` 属性で例外にできる。

```html
<img src="https://thirdparty.com/img.png" crossorigin>
```

**CORP（Cross-Origin-Resource-Policy）** は、あるリソースをinclude（埋め込み）できるoriginの集合を制御する。現在のリソース読み込みを自サイトとサブドメインのみに限定する。**ブラウザが当該レスポンスを、それが攻撃者のプロセスに入る前にブロックできる**ため、Spectreのような攻撃に対する堅牢な防御になる。

```http
Cross-Origin-Resource-Policy: same-site
```

これら3つは連携して動く。ただしいずれもブラウザに深く関係するため、REST APIや非ブラウザのクライアント向けには適用意義が薄い。

〔補足（原典のReferences由来）〕原典ReferencesにはCORPの実用リファレンスとして Resource Policy Reference（https://resourcepolicy.fyi/ ）が挙がっている。なお後述の OWASP Secure Headers Project はCORPに `same-origin` を推奨しており、**原典チートシート（`same-site`）とは値が異なる**。

---

## 11. ブラウザ機能を絞る: Permissions-Policy

`Permissions-Policy`（旧 Feature-Policy）は、どのoriginがどのブラウザ機能を使えるかを、トップレベルのページと埋め込みフレームの両方で制御するヘッダである。各機能は、現在の文書またはフレームのoriginが許可リストに合致する場合にのみ有効になる。

これにより、たとえば**カメラやマイクが決して有効化されないようサイトを設定できる**。結果として、XSSのようなインジェクションがカメラ・マイク等を有効化することを防げる。

```http
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

`=()`（空の許可リスト）は「どのoriginにもこの機能を許可しない」という意味の構文である。上の例は、すべてのドメインに対して geolocation（位置情報）・camera・microphone を無効化している。

原典の推奨は「サイトが必要としないすべての機能を無効化するか、認可されたドメインにのみ許可する」こと。〔補足（参照先資料2由来）〕OWASP Secure Headers Project はさらに網羅的な推奨値（29機能を列挙）を持つ。これは本節「16.」で逐語掲載する。

---

## 12. 情報漏えいを減らす: Server / X-Powered-By ほか

このグループは「攻撃者に技術スタックのヒントを渡すヘッダ」を削るためのものである。原典は各項でひとつの重要な但し書きを繰り返す — **攻撃者はサーバ技術をフィンガープリンティングする別の手段を持っている**。フィンガープリンティングとは、応答のクセや挙動から使用技術・バージョンを特定すること。だからこれらは「消せば安全」ではなく「無用な露出を減らす」程度に評価すべきである。

### 各ヘッダの扱い

- **Server**: リクエストを処理したオリジンサーバのソフトウェアを記述する。セキュリティヘッダではないが使い方が関係する。削除するか非情報的な値にする。
  ```http
  Server: webserver
  ```
- **X-Powered-By**: Webサーバが使う技術を記述し、攻撃者が脆弱性を見つけやすくなる。すべて削除する。
- **X-AspNet-Version / X-AspNetMvc-Version**: .NETのバージョン情報を露出する。送信を無効化する。設定方法は「15.」で扱う。

### 削除すべきヘッダは89種類ある

原典本体が挙げるのは上記だけだが、原典のReferencesにある OWASP Secure Headers Project は「削除すべきヘッダ」を機械可読リスト（`ci/headers_remove.json`）として89件公開している。全リストは「16.」に逐語掲載する。ここでは診断上とくに価値の高いものだけ先に挙げる。

| ヘッダ例 | 漏らすもの | ハンティングでの意味 |
|---|---|---|
| `X-Nextjs-Matched-Path` / `X-Nextjs-Page` | 内部ルーティング | フレームワークと内部パス構造の特定 |
| `X-Envoy-Original-Dst-Host` / `X-BEServer` / `X-FEServer` / `X-CalculatedBETarget` | 内部バックエンドのホスト名 | SSRF・内部ネットワーク探索の手掛かり |
| `X-SourceFiles` / `X-SourceMap` / `SourceMap` | ソースファイルパス・ソースマップ | クライアントサイドのコード読解に直結 |
| `X-Datadog-*` / `X-B3-*` | 分散トレーシングID | 内部システム構成の推測 |

SSRF（Server-Side Request Forgery, サーバサイドリクエストフォージェリ）とは、サーバに攻撃者の指定した先へリクエストさせる脆弱性のこと。ソースマップ（source map）とは、圧縮・変換されたJSを元のソースに対応づける情報で、漏れるとクライアントコードを読みやすくなる。

〔補足〕これらは「レスポンスに現れたら内部情報が漏れているサイン」となるヘッダの辞書として使える。クライアントサイド脆弱性ハンティングの初期偵察（recon）で、まずレスポンスヘッダをこのリストと突き合わせるとよい。

---

## 13. クローラとDNS: X-Robots-Tag / X-DNS-Prefetch-Control

### X-Robots-Tag — クローラのインデックス制御

`X-Robots-Tag` は、検索エンジンなどの自動クローラが、PDF・画像・その他の非HTMLコンテンツをどうインデックス・表示するかを制御するヘッダである。`<meta name="robots">` タグと同様に機能するが、HTTPレスポンスヘッダ経由なので柔軟性が高い（非HTMLファイルやサーバ全体ルールに使える）。

```none
X-Robots-Tag: noindex, nofollow
```

原典の Note が限界を明示している。**準拠するクローラのみがこれらのディレクティブを尊重する。しかもクローラは、コンテンツをどう扱うか決める前に、ヘッダを読むためにHTTPリクエストを行わなければならない。** つまりアクセス制御ではない。悪意あるクローラは無視するし、ヘッダを読む時点でリクエスト自体は届いている。

原典の推奨は用途で分ける。

- 非公開または機微なコンテンツ（インデックスされたくない）:
  ```none
  X-Robots-Tag: noindex, nofollow
  ```
- 公開コンテンツ（インデックスされ発見されるべき。例: ドキュメント、データセット）:
  ```none
  X-Robots-Tag: index, follow
  ```

必要に応じて `noarchive` / `nosnippet` / `noimageindex` も使える。特定のファイルタイプ（PDFや画像）にのみ選択的に適用することもできる。

### X-DNS-Prefetch-Control — 本番で頼ってはいけない制御

`X-DNS-Prefetch-Control` はDNSプリフェッチを制御するヘッダである。DNSプリフェッチとは、ユーザが辿るかもしれないリンクや、文書から参照されるアイテム（画像・CSS・JavaScriptなど）のURLについて、ブラウザが先回りしてドメイン名解決を行う機能のこと。

```http
X-DNS-Prefetch-Control: off
```

ブラウザの既定はDNSキャッシュを行うことで、これは大半のサイトにとって良い。ただし**自サイト上のリンクを自分で制御していない場合**は、それらのドメインへの情報漏えいを避けるため `off` にするとよい。

原典の NOTE は明確な限界を述べている。**本番で機微な用途については、この機能に依存してはならない。** これは標準ではなく、完全にサポートされているわけでもなく、実装はブラウザ間で異なる場合がある。

---

## 14. 非推奨ヘッダと「無い＝脆弱性ではない」の判断

### Expect-CT ❌ — 使わない

`Expect-CT` は、Certificate Transparency（CT）要件の報告をサイトがオプトインできるようにするヘッダだった。CTとは、発行された証明書を公開ログに記録し、不正発行を検知できるようにする仕組みのこと。主流クライアントが既にCT適格性を要求している現状では、残る唯一の価値はヘッダ内で指名された `report-uri` への報告のみで、いまや強制よりも検出/報告の位置づけになっている。

推奨は「**使わないこと。** Mozillaが回避を推奨し、可能なら既存コードから削除する」である。〔補足〕原典は「使うな」の方針のみで、`max-age` / `enforce` / `report-uri` といった構文は示していない（`report-uri` という語だけが登場する）。

### Public-Key-Pins（HPKP）❌ — 使わない

`Public-Key-Pins`（HPKP）は、特定の暗号公開鍵をWebサーバに関連付けて、偽造証明書によるMITM攻撃を軽減するために使われていたヘッダである。これは2018年にChromiumから削除され、すべてのモダンブラウザで非サポートである。

推奨は「**使用しないこと。** 本番から `Public-Key-Pins` および `Public-Key-Pins-Report-Only` をすべて削除する」こと。原典は代わりに、ピンニングの運用上の脆さ（operational brittleness）なしに優れた侵害検知を提供する **Certificate Transparency（CT）と CAA DNSレコード**に依拠せよと述べる。CAA DNSレコードとは、どの認証局がそのドメインの証明書を発行してよいかをDNSで宣言する仕組みのこと。

### 「無いこと＝脆弱性」ではないヘッダの整理

ここまでの内容を、診断で早合点しないための一覧にまとめる。これは自動スキャナの指摘をそのまま提出しないための判断基準になる。

| ヘッダ | 「無い/オフ」が問題にならない理由 |
|---|---|
| `X-XSS-Protection` | `0`（オフ）が正解。あるとかえってXSSを作り得る |
| `Expect-CT` | 削除が正解。回避が推奨されている |
| `Public-Key-Pins`（HPKP） | 削除が正解。全モダンブラウザで非対応 |
| `X-Frame-Options` | JSON APIやリダイレクトのレスポンスでは意味を持たない |
| `Content-Security-Policy` | レンダリングされないAPIレスポンスでは無意味な場合がある |
| `X-DNS-Prefetch-Control` | 本番で依存すべき機能ではない |

---

## 15. 技術スタック別のヘッダ設定と診断の落とし穴

原典は `X-Frame-Options` を例に、各技術でのヘッダ設定方法を示している。値は逐語である。

### 各技術の設定例

**PHP**:
```php
header("X-Frame-Options: DENY");
```

**Apache**（`.htaccess`）:
```lang-bsh
<IfModule mod_headers.c>
  Header unset X-Frame-Options
  Header always set X-Frame-Options "DENY"
</IfModule>
```

**IIS**（`Web.config`）:
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

**HAProxy**:
```lang-none
http-response set-header X-Frame-Options DENY
```

**Nginx**:
```lang-none
add_header "X-Frame-Options" "DENY" always;
```

**Express**（helmet）:
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

情報漏えいヘッダを消す `.NET` 側の設定も原典にある。

**X-AspNet-Version の無効化**（`web.config` の `<system.web>`）:
```xml
<httpRuntime enableVersionHeader="false" />
```

**X-AspNetMvc-Version の無効化**（`Global.asax`）:
```lang-none
MvcHandler.DisableMvcResponseHeader = true;
```

### 診断上いちばん重要な落とし穴 — ステータスコードによる抜け

Apache と Nginx の設定には、実務で頻出する抜け穴の原因が書かれている。

- **Apache**: `Header set`（既定は `onsuccess`）と `Header always set` は**別々の内部ヘッダテーブル**に対して動作する。両方が使われると同じヘッダが重複（duplicate headers）し得る。ヘッダを完全に削除するには両方のコンテキスト（`onsuccess` と `always`）で unset する必要がある。重複を避けつつ全レスポンスで送るには、まず unset してから `always set` を使う（上のApache例がまさにその形）。
- **Nginx**: `always` オプションがないと、特定のステータスコードに対してのみヘッダが送られる。

ここから導かれる実務ルールがこれである。**ヘッダ検査は 200 応答だけでなく、30x（リダイレクト）・40x・50x（エラーページ）でも行う。**

```
よくある抜け穴:
  GET /              200  →  X-Frame-Options: DENY  ✅（ここだけ見て「対策済み」と誤判定）
  GET /nonexistent   404  →  （ヘッダ無し）          ❌ エラーページはフレーム可能
  GET /old-path      301  →  （ヘッダ無し）          ❌ リダイレクトも要注意
```

エラーページやリダイレクトに操作対象のコンテンツが載っていれば、そこがクリックジャッキングの実行面になり得る。

---

## 16. OWASP Secure Headers Project の推奨値と原典との差異

原典のReferencesに載る OWASP Secure Headers Project は、推奨ヘッダを機械可読なJSON（`ci/headers_add.json` / `ci/headers_remove.json`）で公開している。ここには**原典チートシートに節が無い `Clear-Site-Data` と `X-Permitted-Cross-Domain-Policies` が含まれる**。以下はそのJSONからの逐語（取得時の `last_update_utc: 2026-09-13 06:28:41`）。

### 追加すべきヘッダ（全13件・逐語）

| ヘッダ | 推奨値（逐語） |
|---|---|
| `Cache-Control` | `no-store, max-age=0` |
| `Clear-Site-Data` | `"cache","cookies","storage"` |
| `Content-Security-Policy` | `default-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests` |
| `Cross-Origin-Embedder-Policy` | `require-corp` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Referrer-Policy` | `no-referrer` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Frame-Options` | `deny` |
| `X-Permitted-Cross-Domain-Policies` | `none` |

`Permissions-Policy` は29機能を網羅的に無効化する長い値なので単独で示す（逐語）。

```none
Permissions-Policy: accelerometer=(), autoplay=(), camera=(), cross-origin-isolated=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), keyboard-map=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), sync-xhr=(self), usb=(), web-share=(), xr-spatial-tracking=(), clipboard-read=(), clipboard-write=(), gamepad=(), hid=(), idle-detection=(), interest-cohort=(), serial=(), unload=()
```

### 原典に無い2ヘッダの補足

- **`Clear-Site-Data`**: 〔補足（一般知識）〕仕様上のディレクティブは `"cache"`, `"cookies"`, `"storage"`, `"executionContexts"`, `"*"` で、値は二重引用符付きの文字列リスト。主にログアウト応答に付けて、クライアント側の残存状態（キャッシュ・Cookie・ストレージ）を消すために使う。**これは原典 HTTP Headers Cheat Sheet の記述ではなく**、OWASP Secure Headers Project 由来である点に注意。
- **`X-Permitted-Cross-Domain-Policies`**: Adobe系（Flash/PDF）のクロスドメインポリシーを制御するヘッダで、推奨値は `none`。これも原典チートシートには節が無い。

### 2つのOWASP資料で推奨値が食い違う点（誠実に併記する）

OWASP内でも推奨値は一枚岩ではない。教科書としてはこの差異をそのまま示すのが誠実である。

| ヘッダ | HTTP Headers Cheat Sheet | Secure Headers Project |
|---|---|---|
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `no-referrer` |
| `Cross-Origin-Resource-Policy` | `same-site` | `same-origin` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | `max-age=63072000; includeSubDomains`（`preload` なし） |
| `Cache-Control` | 箇条書き指針のみ（機微データは `no-store`） | `no-store, max-age=0` |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()`（例示） | 29機能を網羅的に無効化（上記逐語値） |
| `Clear-Site-Data` | 節なし | `"cache","cookies","storage"` |
| `X-Permitted-Cross-Domain-Policies` | 節なし | `none` |
| `X-Frame-Options` | `DENY`（大文字） | `deny`（小文字） |

### 削除すべきヘッダ（全89件・逐語リスト）

このリストは「レスポンスに現れたら技術スタック・内部ホスト名・トレースIDが漏れているサイン」となるヘッダの辞書として使える（`ci/headers_remove.json` から逐語）。

```none
$wsep, Host-Header, K-Proxy-Request, Liferay-Portal, OracleCommerceCloud-Version, Pega-Host, Powered-By, Product, Server, SourceMap, TeamCity-Node-Id, X-AspNet-Version, X-AspNetMvc-Version, X-Atmosphere-error, X-Atmosphere-first-request, X-Atmosphere-tracking-id, X-B3-ParentSpanId, X-B3-Sampled, X-B3-SpanId, X-B3-TraceId, X-BEServer, X-Backside-Transport, X-CF-Powered-By, X-CMS, X-CalculatedBETarget, X-Cocoon-Version, X-Content-Encoded-By, X-Datadog-Origin, X-Datadog-Parent-Id, X-Datadog-Sampling-Priority, X-Datadog-Tags, X-Datadog-Trace-Id, X-DiagInfo, X-Envoy-Attempt-Count, X-Envoy-External-Address, X-Envoy-Internal, X-Envoy-Original-Dst-Host, X-Envoy-Upstream-Service-Time, X-FEServer, X-Framework, X-Generated-By, X-Generator, X-Gitlab-Meta, X-Jitsi-Release, X-Joomla-Version, X-Kong-Admin-Latency, X-Kong-Client-Latency, X-Kong-Proxy-Latency, X-Kong-Request-Id, X-Kong-Response-Latency, X-Kong-Third-Party-Latency, X-Kong-Total-Latency, X-Kong-Upstream-Latency, X-Kong-Upstream-Status, X-Kubernetes-PF-FlowSchema-UI, X-Kubernetes-PF-PriorityLevel-UID, X-LiteSpeed-Cache, X-LiteSpeed-Purge, X-LiteSpeed-Tag, X-LiteSpeed-Vary, X-Litespeed-Cache-Control, X-Mod-Pagespeed, X-Nextjs-Cache, X-Nextjs-Matched-Path, X-Nextjs-Page, X-Nextjs-Redirect, X-OWA-Version, X-Old-Content-Length, X-OneAgent-JS-Injection, X-Page-Speed, X-Php-Version, X-Powered-By, X-Powered-By-Plesk, X-Powered-CMS, X-Redirect-By, X-Server-Powered-By, X-SourceFiles, X-SourceMap, X-Turbo-Charged-By, X-Tyk-Trace-Id, X-Umbraco-Version, X-Varnish-Backend, X-Varnish-Server, X-Woodpecker-Version, X-dtAgentId, X-dtHealthCheck, X-dtInjectedServlet, X-ruxit-JS-Agent
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP Secure Headers Project — https://owasp.org/www-project-secure-headers/ ならびに https://owasp.github.io/www-project-secure-headers/index/
> **なぜ**: 本教科書の執筆環境からは当該HTMLページを取得せず、GitHubリポジトリの機械可読JSON（`ci/headers_add.json` / `ci/headers_remove.json`）のみを取得した。公開ページには各ヘッダの解説、ブラウザ対応状況、主要サイトのヘッダ実態調査、各サーバ/フレームワーク向け設定例がある。
> **読みどころ**:
> 1. 推奨値の一覧表（本節掲載値の最新版）。
> 2. 削除すべきヘッダの一覧と、それぞれが露出する情報。
> 3. `Clear-Site-Data` と `X-Permitted-Cross-Domain-Policies` の解説（原典チートシートに節が無い部分）。
> 4. 各ヘッダのブラウザ互換性。
> 5. 各言語/サーバ向けのライブラリ・設定スニペット。
> **代替手段**: 機械可読JSONが `https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json` および同 `ci/headers_remove.json` にある（本節はこれを逐語収録した）。

---

## 17. 実装の検証ツール

原典は実装確認のツールを2つ挙げている。

- **Mozilla Observatory**（https://observatory.mozilla.org/ ）: 自分のサイトのヘッダ状態を確認するオンラインツール。
- **SmartScanner**（https://www.thesmartscanner.com/ ）: HTTPヘッダのセキュリティをテストする専用のテストプロファイルを持つ。

原典は重要な限界を指摘している。**オンラインツールは通常、与えられたアドレスのホームページのみをテストする。** SmartScanner はサイト全体をスキャンするため、すべてのページに正しいヘッダが配置されているか確かめられる。

〔補足（一般知識）〕「オンラインツールはトップページしか見ない」という指摘は診断上とても重要である。ヘッダがリバースプロキシ層で付与されている場合、アプリが直接返すパス（API、静的配信、エラーページ、別オリジンのサブドメイン）では欠落することがある。「15.」で見たステータスコード横断の検査と合わせて、トップページだけを見て「対策済み」と判断しないこと。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Mozilla Observatory / SmartScanner — https://observatory.mozilla.org/ / https://www.thesmartscanner.com/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 外部サイトの制限）。原典が推奨する検証ツールなので、実際に自分のサイトや検証環境で挙動を確かめる価値がある。
> **読みどころ**:
> 1. Observatory のスコアリング基準（どのヘッダに何点を配分しているか）。
> 2. 「オンラインツールはホームページのみを検査する」という原典の限界指摘の実地確認。
> 3. SmartScanner のテストプロファイル設定（https://www.thesmartscanner.com/docs/configuring-security-tests ）。
> **代替手段**: `curl -sI https://target/` でヘッダを直接見る、Burp などのプロキシで全パスのレスポンスヘッダを横断確認する、といった手動確認で代替できる。

---

## 手を動かす

前提: 対象は**自分で立てた検証環境、または許可されたバグバウンティ/診断対象**に限る。以下はレスポンスヘッダの観察であり、破壊的操作は含まない。

1. **1本のURLのヘッダを丸ごと見る。** ターミナルで次を打つ。`-I` はヘッダのみ取得（HEAD相当）、`-s` は進捗非表示。
   ```bash
   curl -sI https://example.com/
   ```
2. **早見表と突き合わせる。** 出力の中に `X-Frame-Options` / `X-Content-Type-Options` / `Strict-Transport-Security` / `Content-Security-Policy` / `Referrer-Policy` があるか、値が本節の推奨と合うかを確認する。無い場合でも「無い＝脆弱性」ではない点（本節14.）を思い出す。
3. **ステータスコードを横断して検査する。** トップだけでなく、存在しないパス（404）とリダイレクトされるパス（30x）でもヘッダを見る。リダイレクトを追う場合は `-L` を外して**各段の**ヘッダを個別に見るのがコツ。
   ```bash
   curl -sI https://example.com/this-path-does-not-exist   # 404 のヘッダ
   curl -sI https://example.com/old-path                   # 30x のヘッダ
   ```
4. **情報漏えいヘッダを探す。** 出力を「16.」の削除対象89件リストと突き合わせる。とくに `X-Powered-By`、`Server` の詳細値、`X-Nextjs-Matched-Path`、`X-Envoy-Original-Dst-Host`、`X-SourceMap` などがあればメモする。
   ```bash
   curl -sI https://example.com/ | grep -iE 'server|x-powered-by|x-nextjs|x-envoy|sourcemap|x-aspnet'
   ```
5. **Cookieの属性を確認する。** ログイン後のレスポンスで `Set-Cookie` を見て、セッションCookieに `Secure` `HttpOnly` `SameSite` が付いているか、`__Host-` プレフィックスかを確認する。
   ```bash
   curl -sI https://example.com/ | grep -i 'set-cookie'
   ```
6. **localStorage を覗く。** ブラウザのDevToolsを開き（多くは F12）、Application タブ → Local Storage を選ぶ。`token` / `jwt` / `access_token` のようなキーにクレデンシャルが入っていれば、XSSとの連鎖リスクとして記録する（本節8.）。
7. **CSPの有無と中身を見る。** `Content-Security-Policy` があれば、`script-src` に `'unsafe-inline'` や `'unsafe-eval'`、寛容なホストが無いかを見る。詳細評価は委譲先のCSP専用チートシート（本節5.の📌）で学ぶ。
8. **検証ツールで裏取りする。** 自分のサイト/検証環境なら Mozilla Observatory にかけ、手動の観察と食い違わないか比べる。ただしトップページしか見ない点を忘れない。

---

## つまずきポイント

- **「ヘッダが無い＝すぐバグ」ではない。** `X-XSS-Protection` は `0`（オフ）が正解、`Expect-CT` とHPKPは削除が正解。API/リダイレクトの `X-Frame-Options` 欠如も無意味。自動スキャナの指摘をそのまま提出しない。
- **`no-cache` はキャッシュを防がない。** キャッシュを禁じたいなら `no-store`。`no-cache` は「再利用前に再検証を要求するだけ」で、レスポンスは保存され得る。
- **トップページだけ見て「対策済み」と判断する。** Apacheの `onsuccess`/`always`、Nginxの `always` 省略により、200にはヘッダが付くのに404/30x/APIパスには付かないことがある。必ず横断検査する。
- **`HttpOnly` があればXSSでセッションは安全、と考える。** `HttpOnly` はCookieの機密性を守るだけ。XSS+CSRFの連鎖では、ブラウザが自動でCookieを付けるためリクエストは通ってしまう。
- **`SameSite` をCSRFトークンの代わりにする。** `SameSite` は多層防御の一枚であり、トークンの代替ではない。`Secure` なしの `SameSite=None` は禁止。
- **`Domain` 属性を広く設定する。** `example.com` のような値はサブドメイン間のCookie攻撃・セッションフィクセーションを招く。既定（未設定）でオリジン限定にするのが安全。
- **トークンを `localStorage` に置く。** オリジンの任意JSから読めるため、XSSひとつで全トークンが漏れる。`HttpOnly; Secure; SameSite=Strict` Cookie かBFF、必要ならWeb Workerを使う。
- **HSTSの `max-age` をいきなり長大にする。** 証明書トラブル時に `max-age` 満了までアクセス不能になる。段階的に上げ、`preload` の不可逆性を理解してから登録する。
- **OWASPの2資料の推奨値が違うのを見落とす。** `Referrer-Policy`・CORP・HSTSの `preload`・`X-Frame-Options` の大小文字などで食い違う。どちらか一方だけを「正解」と決めつけない。
- **`Clear-Site-Data` を原典由来と誤解する。** これは原典 HTTP Headers Cheat Sheet に節が無く、Secure Headers Project 由来である。出典を混同しない。

---

## この節のまとめ

- HTTPセキュリティレスポンスヘッダは、実装が容易で効果の大きい多層防御の手段だが、**ブラウザが解釈して初めて意味を持つ**。リダイレクト・JSON API・非ブラウザクライアントでは効かないヘッダが多い。
- `X-Frame-Options: DENY`（可能ならCSPの `frame-ancestors`）でクリックジャッキングを防ぐが、操作対象があるレスポンスでのみ意味を持つ。
- `X-Content-Type-Options: nosniff` はMIMEスニッフィングを禁じ、`Content-Type` の誤設定はXSSになり得る。ユーザ提供ファイルは `Content-Disposition: attachment` + `application/octet-stream` + `nosniff` の3点で守る。
- `X-XSS-Protection` は `0`（オフ）が推奨で、あるとかえってXSSを作り得る。XSS対策の本命はCSPで、詳細は専用チートシートに委譲されている。
- `Referrer-Policy: strict-origin-when-cross-origin` でURL内の秘密の漏れを抑える。`Cache-Control` は機微データに `no-store`、`no-cache` はキャッシュを防がない。
- Cookieは `Secure`（HTTPS限定・必須）・`HttpOnly`（JSから隠す・必須）・`SameSite`（CSRF多層防御・トークン代替不可）で守り、セッションIDには `__Host-` プレフィックスと非永続Cookieが推奨される。`Domain` は広げない。
- クレデンシャルを `localStorage`/`sessionStorage` に置いてはならない。XSSひとつで全トークンが漏れる。代替はHttpOnly Cookie、BFF、Web Worker。
- HSTS（`max-age=63072000; includeSubDomains; preload`）はHTTPSを強制するが、誤設定・証明書失効で正規ユーザを締め出す危険があるため慎重に導入する。
- CORSの `Access-Control-Allow-Origin` はSOPを緩めるヘッダで、`*` ではなく具体的なoriginを指定する。COOP/COEP/CORPはSpectre対策のオリジン隔離で、非ブラウザ向けには意義が薄い。
- `Permissions-Policy` で不要なブラウザ機能（カメラ・マイク・位置情報など）を無効化し、XSSが機能を有効化するのを防ぐ。
- `Server`・`X-Powered-By`・`X-AspNet(Mvc)-Version` などの情報漏えいヘッダは削るが、攻撃者は他手段でも技術特定できるため過大評価しない。Secure Headers Project の削除対象は89件あり、`X-Nextjs-*`・`X-Envoy-*`・`X-SourceMap` などは偵察の宝庫。
- `X-Robots-Tag` は準拠クローラにしか効かず、`X-DNS-Prefetch-Control` は本番で依存すべきでない。`Expect-CT` とHPKPは非推奨（削除が正解）。
- サーバ設定の癖（Apacheの `onsuccess`/`always`、Nginxの `always` 省略）で、200にだけヘッダが付き404/30x/APIに付かない抜けが生じる。ヘッダ検査はステータスコードを横断して行う。
- OWASP内でも HTTP Headers Cheat Sheet と Secure Headers Project で推奨値が食い違う（`Referrer-Policy`・CORP・HSTSの `preload`・大小文字など）。差異を認識して使い分ける。
- 検証は Mozilla Observatory / SmartScanner や `curl -sI` で行うが、オンラインツールはトップページしか見ないことを前提に、全パスを手動で確認する。

---

## 理解度チェック

1. あるAPIがJSONだけを返し `X-Frame-Options` が無い。これはクリックジャッキング脆弱性として報告すべきか。
   ▶ 答え: 報告すべきでない。`X-Frame-Options` は操作対象（リンクやボタン）があるレスポンスでのみ意味を持ち、JSONを返すAPIレスポンスでは何のセキュリティも提供しない。原典もそう明記している。

2. `Cache-Control: no-cache` を機微データの保存防止のつもりで付けた。これは正しいか。
   ▶ 答え: 誤り。`no-cache` はキャッシュへの保存を許し、再利用前にオリジンサーバでの再検証を要求するだけである。保存を厳密に防ぐには `no-store` を使う。

3. `HttpOnly` が付いていればXSSが起きてもセッションは安全と言えるか。
   ▶ 答え: 言えない。`HttpOnly` はCookieの機密性（JSから `document.cookie` で読めないこと）を守るだけで、XSSがCSRFと組み合わされると、ブラウザが自動でCookieを付けるためリクエスト自体は通ってしまう。

4. セッションIDのCookieに推奨されるプレフィックスと、その具体的な `Set-Cookie` 行を挙げよ。
   ▶ 答え: `__Host-` プレフィックス。具体形は `Set-Cookie: __Host-SessionID=<value>; Secure; HttpOnly; SameSite=Strict; Path=/`。`__Host-` は `Secure` 付き・`Domain` 無し・`Path=/` をブラウザが強制する。

5. `localStorage` にJWTを保存する設計のリスクは何か。推奨される代替は。
   ▶ 答え: そのオリジンで実行されるあらゆるJavaScriptから読めるため、単一のXSSで全トークンが漏れる。代替は `HttpOnly; Secure; SameSite=Strict` Cookie、BFFパターン、（永続性が不要なら）Web Workerによる保持。

6. トップページには `X-Frame-Options: DENY` が付くのに、404エラーページには付かない構成が起きる技術的理由を1つ挙げよ。
   ▶ 答え: Nginxで `always` オプションを省略すると特定のステータスコードにしかヘッダが送られない、あるいはApacheで `Header set`(onsuccess) と `always set` が別テーブルで動くため。だからヘッダ検査は200だけでなく404/30x/50xでも行う必要がある。

7. `X-XSS-Protection` が `0` になっている。これは脆弱性か。
   ▶ 答え: 脆弱性ではない。原典は「設定しないか、明示的に `0`（オフ）にせよ」と推奨している。このフィルタは、そうでなければ安全なサイトにXSSを作り出す場合があるためである。

8. 偵察中にレスポンスで `X-Envoy-Original-Dst-Host` や `X-SourceMap` を見つけた。それぞれ何のヒントになるか。
   ▶ 答え: `X-Envoy-Original-Dst-Host` は内部バックエンドのホスト名を露出し、SSRFや内部ネットワーク探索の手掛かりになる。`X-SourceMap` はソースマップの場所を露出し、クライアントサイドのコード読解に直結する。どちらもSecure Headers Projectの削除対象89件に含まれる。

9. HSTSに非常に長い `max-age` を設定した状態で証明書が失効すると何が起きるか。
   ▶ 答え: `max-age` の期間が満了するまで、正規ユーザがサイトにHTTPSでアクセスできなくなるおそれがある。HSTSは導入前に挙動を熟読し、`max-age` を段階的に上げるべきである。

10. `Referrer-Policy` について、OWASP HTTP Headers Cheat Sheet と OWASP Secure Headers Project の推奨値はどう違うか。
    ▶ 答え: 前者は `strict-origin-when-cross-origin`、後者は `no-referrer`。OWASP内でも推奨は一枚岩ではなく、CORP（`same-site` 対 `same-origin`）やHSTSの `preload` の有無などでも食い違う。

---

## 出典

- OWASP HTTP Headers Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
- 同・正典Markdownソース: https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTTP_Headers_Cheat_Sheet.md
- OWASP Session Management Cheat Sheet（Cookies節）: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookies
- OWASP Content Security Policy Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- OWASP HTTP Strict Transport Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html
- OWASP Secure Headers Project: https://owasp.org/www-project-secure-headers/
- 同・機械可読推奨定義: https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json および ci/headers_remove.json
- Mozilla Observatory: https://observatory.mozilla.org/
- SmartScanner: https://www.thesmartscanner.com/
- HSTS Preload List: https://hstspreload.org/
- Content Security Policy Reference: https://content-security-policy.com/
- Resource Policy Reference: https://resourcepolicy.fyi/

<!-- self-read: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html | レンダリング版HTMLがegressプロキシで遮断。正典Markdownソースから全文取得済みだが公開ページは随時更新されるため -->
<!-- self-read: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html | egressプロキシで遮断。原典がCSP詳細を完全委譲しており実装に必須 -->
<!-- self-read: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html | egressプロキシで遮断。原典がHSTS詳細を委譲。誤設定でサイト全体をアクセス不能にし得る -->
<!-- self-read: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookies | egressプロキシで遮断。#cookies以降のセッションIDライフサイクル節は本節の範囲外 -->
<!-- self-read: https://owasp.org/www-project-secure-headers/ | HTMLページは取得せず機械可読JSONのみ取得。ブラウザ対応状況や設定スニペットは公開ページ側にある -->
<!-- self-read: https://observatory.mozilla.org/ | 外部サイトの制限で自動取得できず。原典推奨の検証ツールで実挙動の確認が必要 -->

<!-- sources: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html, https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTTP_Headers_Cheat_Sheet.md, https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookies, https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html, https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html, https://owasp.org/www-project-secure-headers/, https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_add.json, https://raw.githubusercontent.com/OWASP/www-project-secure-headers/master/ci/headers_remove.json, https://observatory.mozilla.org/, https://www.thesmartscanner.com/, https://hstspreload.org/, https://content-security-policy.com/, https://resourcepolicy.fyi/ -->
<!-- terms: HTTPレスポンスヘッダ, 多層防御, X-Frame-Options, クリックジャッキング, X-Content-Type-Options, MIMEスニッフィング, MIME Confusion Attacks, Content-Type, Secure File Download Headers, X-XSS-Protection, 反射型XSS, Content-Security-Policy, オリジン, Referrer-Policy, Cache-Control, no-store, no-cache, Set-Cookie, Secure属性, HttpOnly属性, SameSite属性, CSRF, __Host-, __Secure-, Cookieプレフィックス, Domain属性, Path属性, セッションフィクセーション, cross-subdomain cookies, localStorage, sessionStorage, Web Storage, Web Worker, BFFパターン, JWT, Strict-Transport-Security, HSTS, preload, Access-Control-Allow-Origin, 同一オリジンポリシー, CORS, COOP, COEP, CORP, Spectre, Permissions-Policy, Server, X-Powered-By, X-AspNet-Version, X-AspNetMvc-Version, X-Robots-Tag, X-DNS-Prefetch-Control, Expect-CT, Certificate Transparency, Public-Key-Pins, HPKP, CAA DNSレコード, Clear-Site-Data, X-Permitted-Cross-Domain-Policies, OWASP Secure Headers Project, Mozilla Observatory, SmartScanner, フィンガープリンティング, ソースマップ, SSRF -->
