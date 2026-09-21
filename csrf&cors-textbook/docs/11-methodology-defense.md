# 第11章 発展・方法論・防御の理解

## 防御メカニズムと体系的テスト方法論

これまでの章でCSRF（Cross-Site Request Forgery、攻撃者が被害者のブラウザに「本人が意図していないリクエスト」を代理送信させる攻撃）とCORS（Cross-Origin Resource Sharing、ブラウザがオリジンをまたぐリクエストの可否をサーバーの応答ヘッダーで判定する仕組み）の個別のテクニックを見てきた。本節では視点を変え、(1) 防御側が実際にどのメカニズムを、どう組み合わせて実装すべきか、(2) 診断者・監査者がどのような体系立った手順で検証すべきか、という「防御と方法論」を一段上のレイヤーから整理する。参照元はOWASPの公式チートシートとテストガイドであり、いずれも実務での標準的な参照点になっている。

### 1. 防御の全体設計：多層防御としてのCSRF対策

OWASP CSRF Prevention Cheat Sheetは、単一の対策に依存せず複数の防御を重ねる「多層防御（defense in depth）」を前提としている。中心となるのは以下の4系統である。

#### 1.1 Synchronizer Token Pattern（同期トークンパターン）

もっとも古典的かつ確実な方式で、サーバー側がセッションごと（あるいはリクエストごと）に予測不可能なトークンを生成し、状態変更を伴うリクエストに必ずそのトークンを含めさせ、サーバー側で検証する。

```html
<form action="/transfer.do" method="post">
  <input type="hidden" name="CSRFToken"
    value="OWY4NmQwODE4ODRjN2Q2NTlhMmZlYWEwYzU1YWQwMTVhM2JmNGYxYjJiMGI4MjJjZDE1ZDZMGYwMGEwOA==">
</form>
```

なぜこれで防げるのか。攻撃者はサーバーが発行した秘密のトークン値を知りようがない（同一オリジンポリシーによりレスポンスを読み取れない）ため、攻撃者が用意した外部サイトのフォームやリンクにはこの値を仕込めない。したがって偽造リクエストにはトークンが欠落するか値が一致せず、サーバー側の検証で弾かれる。

チートシートは、トークンを隠しフィールドではなく**カスタムHTTPヘッダー経由でJavaScriptから送信する**方式を推奨している。これは、カスタムヘッダーを付与したクロスオリジンリクエストはブラウザのCORSプリフライト（後述）の対象になり、単純なHTMLフォームでは再現できないためである。つまりトークンの値そのものだけでなく、「送信経路をJavaScript経由に限定する」という設計自体が防御になっている。

#### 1.2 Double-Submit Cookie Pattern（二重送信クッキーパターン）

サーバー側にセッション状態を持たせたくない（ステートレスにしたい）場合の代替策。

**署名付き（Signed）二重送信クッキー — 推奨方式**

サーバー側の秘密鍵を使ってHMACでトークンをセッションに暗号学的に結び付ける。原文の擬似コードは次の通り。

```
secret = getSecretSecurely("CSRF_SECRET")
sessionID = session.sessionID
randomValue = cryptographic.randomValue(64)

message = sessionID.length + "!" + sessionID + "!" +
          randomValue.length + "!" + randomValue.toHex()
hmac = hmac("SHA256", secret, message)
csrfToken = hmac.toHex() + "." + randomValue.toHex()

response.setCookie("csrf_token=" + csrfToken + "; Secure")
```

検証側も同じ計算を再現し、`constantTimeEquals()`（比較にかかる時間を入力値に依存させない比較関数）でHMACを突き合わせる。ここで**定数時間比較が必須**である理由は、通常の文字列比較（先頭から不一致が出た時点で早期リターンする実装）だとバイトごとの一致・不一致で処理時間にわずかな差が生じ、攻撃者が繰り返し観測することでトークンをバイト単位で推測できてしまう「タイミング攻撃」を許してしまうからである。

**素朴な（Naive）二重送信クッキー — 非推奨**

ランダム値をクッキーとリクエストパラメータの両方に格納し一致を見るだけの方式。攻撃者はクロスサイトからクッキーの値を読めないため理論上は防げるように見えるが、**サブドメインが侵害されている場合や、上位ドメインへのクッキー書き込みが可能な状況（クッキーインジェクション）では、攻撃者が正規の値と一致するクッキーを注入できてしまう**。チートシートはこの方式を「署名付き方式が実装困難な場合の次善策」と明確に位置づけている。

#### 1.3 Fetch Metadata ヘッダー

モダンブラウザは`Sec-Fetch-Site`などの`Sec-Fetch-*`ヘッダーを自動付与し、リクエストの発生元とターゲットの関係（`same-origin`／`same-site`／`cross-site`／`none`）をサーバーに伝える。

```javascript
const SAFE_METHODS = new Set(['GET','HEAD','OPTIONS']);
const site = req.get('Sec-Fetch-Site');

if (site === 'cross-site' && !SAFE_METHODS.has(req.method)) {
    return false; // このリクエストを拒否する
}
```

これはブラウザが付与し、JavaScriptから偽装できないヘッダーである点が重要。トークンを持たない旧来のフォームやAPIエンドポイントに対しても、「明らかにクロスサイトから来た非安全メソッドのリクエスト」を機械的に弾ける。ただし2023年3月時点でグローバルカバレッジは98%超とはいえ、対応していない旧ブラウザのために**Origin/Refererヘッダーによる検証をフォールバックとして残す**必要がある。

#### 1.4 カスタムリクエストヘッダー（Ajax/API向け）

`X-CSRF-Token`のような独自ヘッダーをXHR/fetchで付与させる方式。単純なHTML `<form>`送信や`<img>`タグでは任意ヘッダーを付けられず、JavaScriptから`setRequestHeader`する場合はcrosss-originだとCORSのプリフライトチェックにかかるため、攻撃者の作る外部フォームでは再現できない。サーバー側の状態管理が不要という利点がある。

### 2. 補助的・多層的な防御

#### 2.1 SameSite クッキー属性

| 値 | 挙動 |
|---|---|
| `Strict` | すべてのクロスサイトリクエストでクッキー送信をブロック（最も安全だが、外部サイトからのリンク遷移で意図せずログアウト状態になるなど利便性を損なう） |
| `Lax`（多くのブラウザの既定値） | トップレベルナビゲーションかつ安全なメソッド（GET/HEAD/OPTIONS）のみクッキーを許可 |
| `None` | `Secure`属性必須。クロスサイトでも常にクッキーを送信 |

```
Set-Cookie: JSESSIONID=xxxxx; SameSite=Lax; Secure
```

重要な限界がある。`Lax`は非安全メソッド（POST等）のクロスサイト送信をブロックするに過ぎず、**GETで状態変更を行うエンドポイントは防御されない**。また`SameSite`の判定は「オリジン」ではなく「登録可能ドメイン（registrable domain、例: `example.com`）」単位であるため、**サブドメイン間では保護が効かない**。DNSテイクオーバー等でサブドメインが侵害されればこの防御は迂回される。さらに`SameSite`はクライアント側JavaScriptが能動的に偽装リクエストを組み立てる「クライアントサイドCSRF」（後述）には無力である。チートシートは、SameSite単独で十分と言えるのは「信頼できないサービスと登録可能ドメインを共有しない」「すべての状態変更がPOST/PUT/PATCH/DELETEに限定されている」「`Strict`を`__Host-`プレフィックスと併用している」「非対応ブラウザを許容できる」という条件がすべて揃った場合に限られるとしている。つまり**SameSiteは単独の防御ではなく多層防御の一枚と位置づけるべき**である。

#### 2.2 Origin/Referer ヘッダー検証

```
sourceOrigin = Origin または Referer ヘッダーの値
targetOrigin = Host または X-Forwarded-Host の値

if (sourceOrigin != targetOrigin) {
    リクエストを拒否
}
```

`Origin`ヘッダーはクロスサイトのPOST/DELETE/PUTなどで送信されるため優先的に確認し、無ければ`Referer`にフォールバックする。プロキシ配下では`Host`ヘッダーがプロキシによって書き換えられうるため、`X-Forwarded-Host`を使う方が安全というのが原文の推奨である。ただし、プライバシー保護目的の拡張機能や一部の遷移パターンでは`Origin`/`Referer`自体が送信されないケース（原文では全トラフィックの1〜2%程度と言及）があり、サーバー側の設計として「ヘッダー欠落時にどう扱うか」を明示的に決めておく必要がある。

#### 2.3 クッキープレフィックスによるオリジン固定

`__Host-`プレフィックスを付けたクッキーは、`Domain`属性の指定を禁止し`Path=/`と`Secure`を強制されるため、**サブドメインからの上書きを防げる**。`__Secure-`プレフィックスは`Secure`のみを強制し`Domain`指定やサブドメインからの上書きを許すため防御力は弱い。

```
Set-Cookie: __Host-token=RANDOM; path=/; Secure; SameSite=Strict
```

これは前述の「素朴な二重送信クッキーがサブドメイン侵害で破られる」問題への直接的な緩和策になる。

### 3. クライアントサイドCSRF — トークン防御をすり抜ける新しい問題

従来のCSRF対策はすべて「サーバーへのリクエストが攻撃者の制御するオリジンから直接送られる」ことを前提にしていた。しかし近年注目されているのが、**被害者と同一オリジンのJavaScriptが、URLフラグメント（`#`以降）やウィンドウ名、`postMessage`など攻撃者が操作可能な入力をもとにリクエストの送信先やメソッドを組み立ててしまう**脆弱性である。この場合、正規のJavaScriptが正規のトークンやクッキーを付けてリクエストを送るため、Synchronizer TokenもSameSiteも一切機能しない。

```javascript
const ajaxLoad = () => {
    const hashFragment = window.location.hash.slice(1);

    if (hashFragment.includes(';')) {
        const [method, endpoint] = hashFragment.match(/^(get|post);(.*)$/);

        // 脆弱：URLフラグメントの値をそのままリクエスト先に使っている
        fetch(endpoint, { method, headers: {'X-CSRF-Token': token} });
    }
};
window.addEventListener('DOMContentLoaded', ajaxLoad);
```

攻撃者は`https://site.com/#post;/admin/delete-user?id=123`のようなURLを被害者に踏ませるだけでよい。フラグメント部分はサーバーに送信されずブラウザ内のJavaScriptだけが読むため、通常のサーバーログやWAFでは検知しづらい点も厄介である。

対策としてチートシートは次を挙げる。
1. リクエスト先・メソッドを攻撃者が制御可能な入力（URL、ウィンドウ名、`document.referrer`、`postMessage`）から直接導出しない。
2. どうしても分離できない場合は形式を厳格に検証する（許可されたプレフィックスのみ、GETのみに制限するなど）。
3. 最も安全なのは、**フラグメント値を「あらかじめコード内に定義された安全なエンドポイント集合」への添字（キー）としてのみ使う**ことである。

```javascript
const SAFE_ENDPOINTS = {
    'action1': { method: 'POST', url: '/api/safe-endpoint' },
    'action2': { method: 'GET', url: '/api/list' }
};
const action = hashFragment;
fetch(SAFE_ENDPOINTS[action].url, { method: SAFE_ENDPOINTS[action].method });
```

この設計変更により、攻撃者はフラグメントの値を通じて「あらかじめ開発者が安全だと決めたリクエストの中から選ぶ」ことしかできなくなり、任意のURLやメソッドを注入できなくなる。

### 4. ログインフォームCSRF（Login CSRF）

「未認証ユーザーは攻撃対象にならない」という思い込みから、ログインフォーム自体にはCSRF対策を入れないケースがある。しかし攻撃者は被害者に**攻撃者自身のアカウントで強制ログインさせる**ことができ、被害者がその状態のままクレジットカード情報などを入力してしまうと、攻撃者のアカウントにその情報が渡ってしまう（Login CSRF）。対策は、認証前の「プレセッション」段階からトークンを発行してログインフォームに含め、**認証成功後は必ずプレセッションを破棄し新しい認証済みセッションを生成する**（セッション固定化攻撃対策も兼ねる）ことである。

### 5. すべてを無力化するXSS、そしてGETの禁忌

チートシートが繰り返し強調する警告が2点ある。第一に、**XSS（Cross-Site Scripting、攻撃者が被害者のブラウザ上で任意のJavaScriptを実行できる脆弱性）が存在すれば、CSRFトークンはページのDOMやJavaScript変数から読み取られてしまい、どのCSRF対策も意味をなさない**。CSRF対策とXSS対策（出力エンコーディング、CSP）は独立ではなく前提関係にある。第二に、**状態変更にGETメソッドを使ってはならない**。GETのURLはブラウザ履歴・プロキシログ・`Referer`ヘッダーを通じて漏えいしやすく、トークンをクエリパラメータに含めてしまうとその漏えい経路がそのままトークン漏えい経路になる。

> 出典: OWASP Cheat Sheet Series — Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

### 6. 体系的テスト方法論としてのOWASP WSTG

防御を実装しただけでは十分か検証できない。OWASP WSTG（Web Security Testing Guide、現行安定版はv4.2、v5.0が開発中）は、場当たり的なペネトレーションテストを再現可能な手順に落とし込むためのフレームワークである。全体は12の大分類・300以上の個別テストケースで構成される。

1. Information Gathering（情報収集）
2. Configuration and Deployment Management Testing（構成・デプロイ管理）
3. Identity Management Testing（アイデンティティ管理）
4. Authentication Testing（認証）
5. Authorization Testing（認可）
6. Session Management Testing（セッション管理 — **CSRFテストはここに分類される**）
7. Input Validation Testing（入力値検証。インジェクション系・XSSを含む最大のカテゴリ）
8. Error Handling Testing（エラーハンドリング）
9. Cryptography Testing（暗号）
10. Business Logic Testing（ビジネスロジック）
11. Client-side Testing（DOMベースXSS、CORS、クリックジャッキングなど）
12. API Testing（GraphQLなどAPI固有の検証）

この分類の意義は、CSRFを「セッション管理」の一項目として位置づけている点にある。CSRFはセッション（クッキー等の資格情報が自動送信される仕組み）に依存する脆弱性であり、独立した攻撃手法である以上に「セッション管理の設計不備の一種」として扱うことで、SameSiteやクッキー属性、セッション固定化といった隣接領域と合わせて体系的に検証できる。一方でCORSの誤設定は「Client-side Testing」に分類されており、両者は前章までで見た通り原理も検証観点も異なる（CSRFはリクエストの偽造そのもの、CORSはレスポンス内容の読み取り可否の制御）ため、テスト計画上も別の観点でチェックリストを分ける必要がある。

WSTGのセッション管理カテゴリにおけるCSRFテスト（WSTG-SESS-05、"Testing for Cross Site Request Forgery"）の要点は以下の通り。

**テスト目的**: 「ユーザー本人が意図していない、ユーザーになりすましたリクエストを開始できるかどうかを判定する」こと。

**監査アプローチ**: セッション管理がクライアント側の値（クッキーやHTTP認証情報）のみに依存しているかを確認する。GETでアクセス可能なURLは容易に悪用できるが、POSTリクエストも自動送信フォームによって同様に悪用可能である点に注意する。

**GETリクエストのテスト**: 攻撃者はメールや外部サイトに悪意あるリンクを埋め込む。認証済みユーザーがそのリンクをクリックすると、ブラウザが自動的にセッションクッキーを付与してしまい、意図しない操作が実行される。

**POSTリクエストのテスト**: 隠しフィールドに悪意あるペイロードを仕込んだ自己送信フォームを作成して検証する。

```html
<form action='target-url' method='POST' name='CSRF'>
  <input type='hidden' name='field' value='malicious-value'>
</form>
```

**JSONペイロードのテスト**: JSON APIを狙う場合、`<form>`の`enctype='text/plain'`属性を使うことで、通常はJSONのContent-Typeを要求してブロックされるはずのリクエストを、単純フォーム送信の制約（プリフライト不要な"simple request"の枠）内でJSONに近い形のプレーンテキストとして送りつけられないか確認する、という考え方が示されている。これはブラウザのCORS仕様上「シンプルリクエスト」とみなされる条件（`Content-Type`が`text/plain`等に限定される）を利用したテスト観点であり、サーバー側がContent-Typeを厳密に検証しているかどうかの確認につながる。

**ツール例**: OWASP ZAP、CSRF Tester、Pinata-csrf-tool。

**改善策**: WSTG自体は具体的な実装は示さず「OWASP CSRF Prevention Cheat Sheetを参照せよ」としており、本節前半で解説した防御メカニズム群がそのまま改善策として接続される。

WSTG全体は特定のSDLC（ソフトウェア開発ライフサイクル）フェーズ、すなわち開発前・要件定義/設計時・開発中・デプロイ時・保守/運用時のいずれでもテストを組み込めるよう設計されており、単発の診断だけでなく継続的なセキュリティ品質保証のプロセスに組み込むことを意図している。CSRF/CORSの検証も、リリース前の一回きりの手動テストで終わらせるのではなく、この5フェーズのどこに組み込むか（例えば設計時にトークン方式を決定し、実装中にヘッダー検証ロジックをレビューし、デプロイ時にSameSite属性の本番設定を確認する）を意識すると、体系的な防御運用につながる。

> 出典: OWASP Foundation — OWASP Web Security Testing Guide (latest / v4.2) — https://owasp.org/www-project-web-security-testing-guide/latest/

### 7. まとめ：防御を選ぶ判断軸

最後に実務での判断軸を整理する。

- ステートフルな伝統的Webアプリ（サーバーセッションを保持できる）→ Synchronizer Token Patternを第一選択とする。
- ステートレスAPIやマイクロサービス構成でセッションを持ちたくない → 署名付き二重送信クッキー、またはカスタムヘッダー方式。
- レガシーブラウザ対応が不要でモダンブラウザのみ相手にする → Fetch Metadataヘッダー（`Sec-Fetch-Site`）を主防御にしつつOrigin/Refererを保険として残す。
- すべての構成に共通の下敷きとして → `SameSite=Lax`以上のクッキー属性、`__Host-`プレフィックス、そして何よりXSS対策を並行して行う。
- 実装後の検証は、WSTGのセッション管理カテゴリの手順（GET/POST双方、JSON APIのContent-Type検証を含む）に沿って、単一の対策だけでなく多層防御全体が機能しているかを確認する。

単一の「銀の弾丸」は存在せず、トークン・SameSite・Origin検証・XSS対策・そして体系的テストの組み合わせによって初めて実用的な防御水準に到達する、というのがOWASPの一貫したメッセージである。

## 発展学習リソース

本節では、CSRF（Cross-Site Request Forgery：攻撃者が用意した罠ページ経由で、被害者のブラウザに保持された認証情報を悪用し、被害者の意図しないリクエストを正規サイトへ送らせる攻撃）とCORS（Cross-Origin Resource Sharing：ブラウザの同一オリジンポリシーを緩和し、異なるオリジン間でのリソース共有を許可する仕組み）の理解をさらに深めるための、実務寄り・研究最前線寄りの2つのリソースを紹介する。どちらも「本文で学んだ原理を、実際の脆弱性報告や最新の攻撃手法にどう接続するか」という橋渡しの役割を持つ。

### 1. Bug Bounty Bootcamp（Vickie Li, No Starch Press）

#### 書誌情報と位置づけ

- 著者: Vickie Li（Facebook、Yelp、Starbucksなど複数の企業へ脆弱性を報告した実績を持つセキュリティ研究者）
- 出版: No Starch Press、2021年11月刊行
- 体裁: 416ページ、ISBN-13: 9781718501546

本書は「バグバウンティで実際に稼ぐ」ことを目的にした実務書であり、脆弱性クラスごとに「原理」「見つけ方」「実際の報告例」を1章単位で扱う構成になっている。全体は4部構成で、第I部が業界解説（プログラム選定、継続的に成果を出す方法）、第II部がインターネットの基礎知識・環境構築・偵察、第III部が個別の脆弱性クラス（XSSからリモートコード実行まで16章）、第IV部がコードレビューやAndroidアプリ診断、API診断、ファジングといった専門技法を扱う。

本節のテーマに直接関わるのは第III部で、以下の章が該当する。

- **第8章「Clickjacking」**: クリックジャッキング（透明なiframeを正規ページの上に重ね、ユーザーに意図しないクリックをさせる攻撃）を専門的に扱う章。CSRFトークンで防げるはずの操作が、UI層でのなりすましによって迂回されるケースを扱っており、CSRF対策（トークン検証）とクリックジャッキング対策（`X-Frame-Options`ヘッダーやCSPの`frame-ancestors`ディレクティブ）が独立した防御レイヤーであることを実例で示す。
- **第9章「Cross-Site Request Forgery」**: 本教科書の中核テーマそのものを扱う章。トークン検証の欠如や、トークンの検証ロジックが甘い実装（例えばトークンの有無だけをチェックしてトークンの値そのものを検証しない、あるいはトークンをリクエストボディではなくCookieからのみ読み取り再送してしまう実装ミス）を実際のバグバウンティ報告の事例に基づいて解説している。CSRFの検出手順として、リクエストからトークンパラメータを削除して送信する、トークンを別セッションの値に差し替えて送信する、GETメソッドへの変換を試すといった、実務で使われる具体的なテスト手順が紹介されている。
- **第20章「Single-Sign-On Issues」**: 目次上は「OAuth」という単語こそ明記されていないが、SSO（シングルサインオン）実装の不備を扱うこの章は、実質的にOAuthやOpenID Connectのフロー不備を扱う章にあたる。CORSの誤設定がOAuthのトークンエンドポイントやユーザー情報エンドポイントと組み合わさることで、本来クロスオリジンから読めないはずのアクセストークンやユーザー情報が漏洩する複合的な脆弱性パターン（本教科書の他章で扱うCORS×認証情報漏洩の実例）の背景知識として役立つ。

#### 本書がCSRF/CORSの学習に持つ意味

本教科書で学ぶCSRF/CORSの「原理」（同一オリジンポリシー、SameSite Cookie属性、プリフライトリクエストの仕組みなど）は、いわば静的な設計図の理解にあたる。一方でBug Bounty Bootcampが提供するのは、その設計図の「どこに実装者がよくミスをするか」という経験則である。たとえば同書のCSRF章で紹介される「トークンは存在するが、サーバー側がユーザーのセッションに紐づけずグローバルに1つのトークンを使い回している」という実装ミスは、プロトコルレベルの説明だけでは気づきにくいが、実際の診断・報告事例を多数読むことで初めて「よくあるパターン」として認識できるようになる。CSRFやクリックジャッキングは対策自体は比較的シンプル（トークン検証、SameSite Cookie、frame-ancestors）である一方、その対策の「実装の甘さ」を突く部分にこそ実務上の価値があり、本書はまさにその実装の甘さのカタログとして機能する。

> ⚠️ **未取得の資料の一部について**: 出版社ページからは目次の章立てと概要は取得できたが、各章本文（具体的なペイロード例やコードスニペット)そのものは書籍の性質上、公開ページには掲載されておらず取得できなかった。詳細な演習・具体例は書籍本体を直接参照されたい。（以下は未取得部分の補足として一般知識に基づく解説です）CSRFの検出パターンとしては、リクエストのメソッドを`POST`から`GET`に変えてもサーバーが処理を続行するか、トークンパラメータ名を大文字小文字違いに変えて送っても通るか、といった「バリデーションの実装漏れ」を突く手法が実務では広く使われている。これらはOWASP Testing GuideのCSRFテスト項目とも重なる内容であり、本書はそれをバグバウンティの実例に落とし込んで解説している点に価値がある。

> 出典: Bug Bounty Bootcamp — https://nostarch.com/bug-bounty-bootcamp

### 2. James Kettle 研究ポートフォリオ（jameskettle.com）

#### プロフィールと位置づけ

James Kettle（ハンドル名albinowax）は、Burp Suiteの開発元であるPortSwiggerの研究部門責任者（Director of Research）であり、Web攻撃技術の分野で10年以上にわたり毎年Black Hat USAなどの主要カンファレンスで新しい攻撃クラスを発表し続けている研究者である。本人のポートフォリオサイトは、CSRF/CORSそのものの解説ではなく、「クロスオリジン境界を突破する新しい攻撃手法を継続的に追いかけるための起点」として位置づけられる。CSRFやCORSはいずれも「ブラウザが管理するオリジン境界（プロトコル・ホスト・ポートの組で識別される信頼境界）」を守るための仕組みであり、Kettleの研究の多くはまさにこの境界がどこで、どのように破られるかを扱っている。

#### 本教科書のテーマと直結する研究

- **Exploiting CORS Misconfigurations for Bitcoins and Bounties（2016年発表）**: 本教科書のCORS章のテーマそのものを扱う代表的な研究。CORSの誤設定パターンを体系的に整理したもので、代表的な誤りとして次のようなものが知られている。

```http
# 脆弱なサーバーの応答例（Originをそのまま反射してしまう実装）
GET /api/wallet/balance HTTP/1.1
Host: victim.example
Origin: https://evil.example
Cookie: session=abcdef123456

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://evil.example
Access-Control-Allow-Credentials: true
```

  なぜこれが危険なのか。`Access-Control-Allow-Origin`にリクエストの`Origin`ヘッダーの値をそのまま反射し、かつ`Access-Control-Allow-Credentials: true`を返してしまうと、ブラウザは「このオリジンからのクレデンシャル付きクロスオリジンリクエストへのレスポンス読み取り」を許可されたと解釈する。つまり`evil.example`上のJavaScriptが、被害者のCookie（セッション情報）を使って`victim.example`のAPIを呼び出し、そのレスポンス本文（残高やAPIキーなど）をJavaScript側で読み取れてしまう。これはCSRFと似ているが決定的に異なる点があり、CSRFは「リクエストを送らせる（書き込み系操作の悪用）」ことが主眼であるのに対し、CORS誤設定の悪用は「レスポンスを読み取る（読み取り系情報の窃取)」ことが主眼になる。この研究では、正規表現でOriginを緩く許可してしまうパターン（例えば`https://victim\.example.*`のような、末尾に任意の文字列を許すミス）や、`null` Originを許可してしまうパターン（サンドボックス化されたiframeやローカルファイルからのリクエストが`Origin: null`を送ることを悪用される）なども整理されており、ビットコイン取引所などの実際のバグバウンティ報奨金獲得事例として紹介された点が話題となった。

- **HTTP Desync Attacks: Request Smuggling Reborn（2019年）およびBrowser-Powered Desync Attacks（2022年）**: 直接のテーマはHTTPリクエストスマグリング（フロントエンドとバックエンドのサーバーが、リクエストの境界（Content-LengthヘッダーとTransfer-Encodingヘッダーの解釈の食い違い）を巡って認識をズラされ、後続のリクエストが別ユーザーのものとして処理されてしまう攻撃）だが、CSRF/CORSの学習者にとって重要な示唆がある。CSRFやCORSはいずれも「どのオリジン・どのリクエストが誰のものか」というリクエストの帰属を前提にした防御であるのに対し、リクエストスマグリングは「そもそもリクエストの境界がサーバー間で一致しない」という、より低いプロトコル層の脆弱性を突く。Browser-Powered Desync Attacksでは、ブラウザ自体を踏み台にしてこの攻撃を任意の被害者に対して発動させる手法が示されており、CSRFの「被害者のブラウザに正規のリクエストを送らせる」という構図と発想の系譜が近い。

- **Web Cache Poisoning関連研究（2018年のPractical Web Cache Poisoning、2020年のWeb Cache Entanglement）**: キャッシュキーに含まれないヘッダー（`X-Forwarded-Host`など）を細工したリクエストをキャッシュさせ、後続の全ユーザーに悪意あるレスポンスを配信する攻撃。CORSの理解に必須の「どのリクエストヘッダーがレスポンスの内容やキャッシュ可否に影響するか」という考え方を、キャッシュという別の切り口から深掘りする内容であり、CORSプリフライトの`Vary`ヘッダーの扱いを誤ると、CORS由来のレスポンスがキャッシュ汚染と結合するリスクにもつながる。

- **Smashing the state machine（2023年、Webレースコンディション）**: CSRFトークンの発行・検証や、OAuthの認可コード交換といった「状態を1回だけ消費する」処理が、並行リクエストによって複数回消費されてしまう不具合（TOCTOU: Time-Of-Check to Time-Of-Useのズレ）を扱う。CSRFトークンをワンタイム化する対策自体が、実装によっては競合状態によって回避され得ることを示しており、本教科書のCSRF対策章で触れる「トークンのワンタイム性」という防御を、より実装レベルで検証する視点を与える。

#### なぜこのポートフォリオを追う価値があるか（仕組みレベルの補足）

CORSやCSRFの仕様（W3CのFetch仕様やHTTP仕様）自体は年単位で大きくは変わらないが、それを実装するブラウザやサーバーソフトウェアの挙動には常に新しい抜け道が発見され続けている。例えばCORSプリフライトの要否を決める「シンプルリクエスト」の判定基準（Content-Typeが`text/plain`、`application/x-www-form-urlencoded`、`multipart/form-data`のいずれかで、かつカスタムヘッダーを含まない場合はプリフライトが省略される、というFetch仕様上の規則）は、攻撃者にとって「プリフライトを回避してPOSTリクエストを送りつつ、レスポンスの中身だけは読めない」という条件を作り出す。Kettleの研究群は、こうした「仕様上は正しいがサーバー実装が想定していない組み合わせ」を継続的に発掘するものであり、CSRF/CORSの原理を学んだ読者が次に読むべき「最前線の実例集」として最適な情報源になっている。研究内容の多くはPortSwiggerのResearchブログ（portswigger.net/research）およびBurp Suiteのドキュメントとしても展開されており、実際にBurp Suiteの拡張機能（Param Miner、Turbo Intruderなど）として手元で再現・検証できる形になっている点も実務的な価値が高い。

> ⚠️ **未取得の資料**: jameskettle.com のトップページからはプロフィールと研究タイトル一覧の概要は取得できたが、各講演・論文本文（スライドPDFや詳細な技術ペイロード）は個別のリンク先ページであり、本節の取得手順では実物のダウンロードには至っていない。詳細な攻撃ペイロードや実演内容を確認したい場合は、上記URLから該当講演のページ（例: portswigger.net/research 配下の各記事、または対応するBlack Hat/DEF CONのスライド）を直接参照されたい。（以下は未取得資料の補足として一般知識に基づく解説です）CORS研究における代表的な検出手法として、`Origin`ヘッダーに任意の値（存在しないドメインや、対象ドメイン名を含む別ドメイン）を設定してリクエストを送り、レスポンスの`Access-Control-Allow-Origin`がその値をそのまま反射するかを確認する手法が広く知られている。これはBurp SuiteのCORS関連の自動チェックや、OWASP Testing Guideでも標準的なテスト手順として採用されている。

> 出典: James Kettle 研究ポートフォリオ — https://jameskettle.com/

### まとめ

Bug Bounty Bootcampは「CSRF/クリックジャッキング/OAuth・SSOの実装ミスをどう見つけ、どう報告するか」という実務のカタログとして、James Kettleの研究ポートフォリオは「CORSを中心としたクロスオリジン境界の攻防が今どこまで進んでいるか」という最前線の定点観測として、それぞれ本教科書で学んだ原理を実務・最新動向へ接続する役割を果たす。両者とも継続的に更新される性質のリソースであるため、学習後も定期的に参照し、CSRFトークン検証やCORSポリシー設計のベストプラクティスが陳腐化していないかを確認することを推奨する。


---

## ナビゲーション

[← 第10章 実例・CVE・報奨事例](10-real-cases-cve.md)　｜　[📚 目次（ホーム）](index.md)　｜　[付録 →](99-appendix.md)
