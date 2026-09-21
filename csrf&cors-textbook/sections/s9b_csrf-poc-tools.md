## CSRF PoC生成ツールとツール一覧

本節では、CSRF（Cross-Site Request Forgery）の検証用PoC（Proof of Concept、脆弱性の存在を証明する最小限の再現コード）を作るための代表的なツールと、CORS（Cross-Origin Resource Sharing）の設定不備を発見するためのツール群を扱う。いずれも防御側がテスト環境や自社アプリケーションの診断に使うことを前提とし、許可を得ていない実サービスへの適用は行わない。

### 9.9.1 Burp SuiteのCSRF PoC Generator

PortSwiggerのWeb Security Academyには、CSRF対策が一切実装されていないラボ「CSRF vulnerability with no defenses」が用意されている。認証情報は `wiener:peter` で、攻撃対象は「メールアドレス変更機能」である。このラボはBurp Suiteに内蔵された「Engagement tools」配下のCSRF PoC生成機能の使い方を学ぶための教材として設計されている。

#### 手順（Burp Suite Professional）

1. アプリケーション上で「Update email」フォームを実際に送信し、そのリクエストをBurp Proxyの`HTTP history`タブで確認する。
2. 対象リクエストを右クリックし、`Engagement tools` → `Generate CSRF PoC` を選択する。これによりBurpは、そのリクエストのメソッド・パラメータをそのまま再現する自動送信フォームのHTMLを生成する。
3. 生成画面には「Include auto-submit script」（自動送信スクリプトを含める）というオプションがあり、これを有効にすると、被害者がPoCページを開いた瞬間に`onload`相当のタイミングでフォームが自動送信されるスクリプトが付与される。

Burp Suiteがこの機能を提供できる理由は、CSRFの本質が「リクエストの再現性」にあるからである。CSRFは、脆弱なエンドポイントが（1)Cookieなどのセッション識別子を自動的に検証に使い、かつ(2)リクエストの送信元（Origin/Referer）やCSRFトークンといった「リクエストが正規のページから発行されたか」を検証していない場合に成立する。攻撃者は被害者のブラウザに「正しい形式のリクエスト」さえ送信させればよく、その内容はProxyでキャプチャした本物のリクエストをそのまま模倣すれば十分である。Burpはこの「模倣コードの自動生成」を行っているに過ぎない。

#### 生成されるHTML（Community Editionでも同様の構造を手動作成する）

Burp Suite Community Editionには自動生成機能が無いため、公式ドキュメントでは以下のようなテンプレートを手動で作成する方法が示されている。

```html
<form method="POST" action="https://YOUR-LAB-ID.web-security-academy.net/my-account/change-email">
  <input type="hidden" name="email" value="anything@web-security-academy.net">
</form>
<script>
  document.forms[0].submit();
</script>
```

このコードが機能する理由を仕組みレベルで説明する。

- **HTMLの`<form>`要素によるクロスオリジン送信はSame-Origin Policy（SOP、同一生成元ポリシー。あるオリジンのスクリプトが別オリジンのリソースを読み取ることを制限する仕組み）の対象外である。** SOPはあくまで「レスポンスの読み取り」を制限するものであり、「リクエストの送信」自体は制限しない。フォームのPOST送信はページ遷移と同じ扱いで、ブラウザはこれを禁止する理由を持たない。
- **Cookieはリクエスト対象のドメイン（`YOUR-LAB-ID.web-security-academy.net`）宛てに、ブラウザによって自動的に付与される。** これはCookieが「そのCookieを発行したドメインへのリクエストに自動添付される」という設計だからであり、送信元のページがどのオリジンであるかは無関係である。したがって被害者が攻撃者のページ（例えば`evil.example.com`）を開いているだけで、被害者のセッションCookieが正規サイト宛てのリクエストに乗ってしまう。
- **`document.forms[0].submit()`は被害者のクリックなどのユーザー操作なしにフォームを送信する。** ページが読み込まれた時点でスクリプトが実行されるため、被害者は自分がリクエストを送信したことにすら気づかない。

なお、2020年以降主要ブラウザ（Chrome 80以降など）はCookieの`SameSite`属性のデフォルトを`Lax`に変更しており、`Lax`設定下ではクロスサイトの単純な`GET`によるトップレベルナビゲーションはCookieが送られるが、上記のような他オリジンからの自動`POST`送信では多くの場合Cookieが送信されなくなる。したがって、このPoCがそのまま通用するかどうかは、対象アプリケーションが発行するCookieの`SameSite`属性の設定に依存する。ラボ環境（PortSwigger Web Security Academy）は意図的にこの防御を無効化した状態で提供されているため、PoCがそのまま機能するように設計されている点に注意する。実運用アプリケーションで同様のテストを行う場合は、対象Cookieの`Set-Cookie`ヘッダーに`SameSite=Strict`や`SameSite=Lax`が設定されていないか、事前にレスポンスヘッダーを確認する必要がある。

#### Exploitサーバーでの実行フロー

PortSwigger Web Security Academyの各ラボには専用の「Exploit server」（攻撃者ホスト役を模擬する、ラボごとに割り当てられる検証用サーバー）が付属しており、実際にPoCを配信するには以下の手順を踏む。

1. Exploitサーバーの管理画面にある「Body」欄に、生成したHTML（フォーム＋自動送信スクリプト）を貼り付ける。
2. 「Store」ボタンを押してコンテンツを保存する。
3. 「View exploit」を押し、自分のブラウザ（自分のセッション）でPoCが意図通りに動作するか確認する。
4. 動作確認ができたら、テスト用と本番exploit用とでメールアドレスを変更した上で、「Deliver to victim」を押すことでラボ内の被害者（シミュレートされたユーザー）にPoCを配信する。

ここでドキュメントが明示している重要な注意点は、「既に登録済みのメールアドレスは変更先として使用できない」という制約である。つまり、動作確認時に使用したメールアドレスと、最終的に被害者へ配信する際に使用するメールアドレスは異なるものにしなければならない。同じ値を使い回すと、システムが重複エラーを返しラボがクリアできない。これはCSRFの脆弱性そのものとは無関係な、アプリケーション側のバリデーション仕様に起因する実務上のハマりどころである。

> 出典: What is CSRF (Cross-site request forgery)? Tutorial & Examples — https://portswigger.net/web-security/csrf/lab-no-defenses

#### Burp以外のCSRF PoC生成手段

Burp Suiteの機能を使わずとも、CSRFのPoCは以下のような方法で作成できる。原理はいずれも同じで、「対象のリクエストと同じメソッド・パラメータ・Content-Typeを再現するHTML/JSを書く」ことに尽きる。

- **手動HTMLフォーム**: 上記のテンプレートのように、`<form>`と`<script>`だけで完結する。`Content-Type: application/x-www-form-urlencoded`または`multipart/form-data`を使うリクエストにはこの方式がそのまま使える。
- **`fetch`/`XMLHttpRequest`を使ったJSON CSRF PoC**: `Content-Type: application/json`を要求するAPIエンドポイントに対しては、通常の`<form>`では`application/json`を送信できない（フォームが送信可能なContent-Typeは限定されている）ため、`fetch`に`mode: "no-cors"`を指定するか、`text/plain`として解釈させる小細工（サーバー側でContent-Typeの検証が緩い場合に有効）を使う手法がある。これは「サーバーがContent-Typeを検証していない」という別の弱点を突く応用形であり、CSRF対策としてContent-Typeチェックだけに頼ることの危険性を示す実例でもある。
- **OWASP ZAPの`CSRF Vulnerability`フィルタ/自動診断**: ZAPのActive Scanは、フォームにCSRFトークンが存在しないパラメータを検出すると警告を出す。手動でPoCを作る前段階の「発見」を助けるツールであり、生成そのものはBurpほど作り込まれていない。
- **オンラインCSRF PoC生成サービス**: リクエストのcurlコマンドやHTTPリクエストテキストを貼り付けるとHTMLを出力してくれるWebツールも存在するが、社内の非公開エンドポイントの情報を外部サービスに貼り付ける行為自体が情報漏えいリスクになるため、社内診断では自前のスクリプトかBurp/ZAPのようなローカル動作ツールを使うことが望ましい。

### 9.9.2 CORS設定不備を検出するツール一覧

> ⚠️ **未取得の資料**: 「A list of tools to find CORS(Cross-Origin Resource Sharing)」(loyalonlytoday, Medium)は自動取得できませんでした（理由: サーバーがHTTP 403 Forbiddenを返し本文を取得できなかったため。検索エンジン経由でも記事本文の全文は取得できず、関連する技術記事・GitHubリポジトリの断片情報のみ確認できた）。以下のURLからご自身で直接ご覧ください: https://medium.com/@loyalonlytoday/a-list-of-tools-to-find-cors-cross-origin-resource-sharing-37f4c5ead5a1

（以下は未取得資料の補足として一般知識に基づく解説です）

CORSの設定不備検出ツールは、共通して次の原理で動作する。

1. 対象APIエンドポイントに対し、`Origin`ヘッダーを様々な値（攻撃者が管理できそうな任意ドメイン、`null`、対象ドメインの部分文字列を含む類似ドメインなど）に書き換えたリクエストを送信する。
2. レスポンスの`Access-Control-Allow-Origin`ヘッダーが、送信した任意の`Origin`値をそのまま反映（reflect）していないかを確認する。
3. 同時に`Access-Control-Allow-Credentials: true`が返っているかを確認する。この2つが同時に成立すると、攻撃者が用意した任意のオリジンから、被害者のブラウザに認証情報（Cookieなど）付きのクロスオリジンリクエストを許可してしまう、深刻な設定不備となる。

これは、CORSの仕様上、`Access-Control-Allow-Origin: *`（ワイルドカード）は`Access-Control-Allow-Credentials: true`と同時に使用できない（ブラウザが仕様違反としてレスポンスを拒否する）という制約を、開発者が「ワイルドカードの代わりにリクエストの`Origin`ヘッダーの値をそのままオウム返しする」という実装で回避してしまうことに起因する典型的な誤りである。ツールはこの誤りを機械的に走査して発見する。

一般に知られている代表的なツール群は次の通りである（いずれもオープンソースで、CLIから対象URLに対してOriginヘッダーを変化させたリクエストを送り、レスポンスヘッダーを解析して誤設定を報告する設計を採る）。

- **CORScanner**（chenjj/CORScanner、Python製）: 複数のCORS誤設定パターン（Originの完全反映、サブドメイン許可の不備、`null` Originの許可など）を分類して検出する初期の代表的ツール。
- **Corsy**（s0md3v/Corsy、Python製）: リクエストを送りAccess-Control-Allow-OriginとAllow-Credentialsの組み合わせを解析するシンプルなスキャナ。多くの後発ツールがこれを参考実装として挙げている。
- **CorsMe**（Shivangx01b/CorsMe、Go製）: CORScannerやCorsy、cors-blimeyのアイデアを踏まえて再実装された、高速性を重視したスキャナ。
- **cors-blimey**: 誤設定パターンの分類ロジックを提供する小規模ツールで、他ツールの検出ロジックの土台としてしばしば参照される。
- **Burp Suite拡張機能（BApp Store経由のCORS関連スキャナ）**: Burpのプロキシ機能と統合し、傍受済みのリクエスト群に対してOriginヘッダーを差し替えた再送信を自動化できる。
- **ブラウザの開発者ツール／`curl`による手動検証**: 自動化ツールに頼らずとも、以下のように`curl`で最小限の確認ができる。

```bash
curl -s -i \
  -H "Origin: https://attacker.example.com" \
  -H "Cookie: session=<診断用の自分のセッションCookie>" \
  https://target.example.com/api/account
```

このレスポンスヘッダーに

```
Access-Control-Allow-Origin: https://attacker.example.com
Access-Control-Allow-Credentials: true
```

が含まれていれば、その時点で「任意オリジンからの認証情報付きクロスオリジン読み取りが可能」という設定不備が確認できたことになる。ここで`Access-Control-Allow-Credentials: true`が付いている場合、ブラウザ上の`fetch`は`credentials: "include"`を指定することで、被害者のCookieを添付したままレスポンス本文を読み取れてしまう。これは通常のCSRF（リクエストを送るだけで結果を読み取れない攻撃）と異なり、**レスポンスの中身そのものを攻撃者が窃取できる**点で影響がより大きい。

ツールを使う際の注意点として、これらのスキャナは対象に対して大量のリクエストを送信するため、本文でも繰り返しているとおり、事前に許可を得た環境以外に対して実行してはならない。また、`null` Originのテスト（`<iframe sandbox>`から送信されるリクエストなど、ブラウザが`Origin: null`を送出する特殊なケースの検証）は、対象サーバーの実装によっては意図しない副作用（ログの汚染、レートリミットの誤検知など）を招くことがあるため、診断対象システムの管理者と事前にスキャン内容をすり合わせておくことが望ましい。

以上のように、CSRFのPoC生成は「本物のリクエストを模倣する」ことが核心であり、CORSの検出ツールは「Originヘッダーへの応答の一貫性のなさを機械的に走査する」ことが核心である。どちらも、対策としてはサーバー側で「リクエストの送信元を正しく検証する」（CSRFトークン、SameSite Cookie、Originヘッダーの厳格な検証、許可オリジンのホワイトリスト化など）ことに帰着する、という共通の教訓を押さえておくとよい。
