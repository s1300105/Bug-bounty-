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
