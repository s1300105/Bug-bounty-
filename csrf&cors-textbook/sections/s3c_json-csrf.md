## JSON CSRF（text/plainでsimple request化）

### なぜ「JSON APIはCSRFに強い」と誤解されるのか

多くの開発者は「JSONを受け付けるAPIエンドポイントはCSRFの心配がない」と考えがちです。その根拠は、通常JSONを送信する際にはブラウザの`fetch`や`XMLHttpRequest`（XHR）を使い、`Content-Type: application/json`を明示的に指定するため、ブラウザが「単純ではないリクエスト（non-simple request）」と判断し、実際のリクエストを送る前に**プリフライトリクエスト（preflight request）**――サーバに「このオリジンからのこのメソッド・ヘッダーでのリクエストを許可するか」を`OPTIONS`メソッドで事前に問い合わせる仕組み――を発生させる、という前提にあります。プリフライトでサーバがクロスオリジンを許可しなければ、ブラウザは実リクエストの送信自体を止めてくれます。

しかし、この防御は「攻撃者が`application/json`というContent-Typeを律儀に使う」ことを前提にしています。攻撃者はブラウザの標準的な**HTMLフォーム**を使ってCSRFを仕掛けるため、実際にはブラウザが定義する「simple request（単純リクエスト）」の条件さえ満たせば、プリフライトを一切発生させずにJSON相当のペイロードをサーバへ送り込めてしまいます。これがJSON CSRF、特に「`text/plain`によるsimple request化」と呼ばれる攻撃の核心です。

> 出典: PentesterLab Glossary — JSON CSRF — https://pentesterlab.com/glossary/json-csrf

### CORSのsimple requestとは何か（仕組みレベルの理解）

Fetch/CORS仕様では、以下の条件をすべて満たすリクエストを「simple request」として扱い、プリフライトを省略してよいと定義しています。

- メソッドが `GET` / `HEAD` / `POST` のいずれかである
- 送信するリクエストヘッダーが、`Accept`・`Accept-Language`・`Content-Language`・`Content-Type`（下記の制限付き）など、あらかじめ許可された「CORS-safelisted request-header」の範囲に収まる
- `Content-Type`ヘッダーの値が、`application/x-www-form-urlencoded`・`multipart/form-data`・**`text/plain`**のいずれかである

つまり、`Content-Type: application/json`はこのリストに含まれないため通常はプリフライトが発生しますが、**`Content-Type: text/plain`を指定した瞬間、リクエストは「simple」に分類され、プリフライトなしでサーバへ届いてしまう**のです。ブラウザ自身はJSONかどうかという中身（ボディの内容）を検査しません。CORSの判定はあくまで「メソッド」と「ヘッダー」という外形的な条件だけを見ており、ボディに何を書くかは関知しないという実装上の割り切りが、この抜け穴の根本原因です。

さらに重要なのは、HTMLの`<form>`要素には標準で`enctype="text/plain"`という属性値が用意されている、という事実です。フォームの`enctype`に`text/plain`を指定すると、ブラウザはXHR/fetchを一切使わずに、**通常のフォーム送信（ページ遷移を伴うPOST）**として`Content-Type: text/plain`のリクエストを生成できます。これはCORSの土俵にすら乗らない、古典的なクロスサイトのフォーム送信であり、そもそもプリフライトという概念自体が適用されません。攻撃者にとっては、CORSの穴を突くよりもさらに単純な経路です。

### 攻撃手法1: `enctype="text/plain"`フォームでJSONを偽装する

`enctype="text/plain"`のフォームは、`name=value`の各フィールドを改行区切りで連結してボディを作ります。たとえば以下のフォームを考えます。

```html
<form action="https://victim.example/api/updateUserInfo" method="POST" enctype="text/plain">
  <input type="hidden" name='{"accountName":"attacker-controlled","role":"admin", "ignore_me":"' value='"}'>
</form>
<script>document.forms[0].submit()</script>
```

このフォームが生成する生ボディは次のようになります。

```
{"accountName":"attacker-controlled","role":"admin", "ignore_me":"="}
```

一見奇妙に見えますが、ポイントは**`name`属性そのものにJSONの前半部分（キーの並びとコロン）を押し込み、`value`属性にJSONの後半（末尾の`"}`）を押し込む**ことで、`name=value`という強制フォーマットの中に完全な1行のJSON文字列を成立させている点です。サーバ側のJSONパーサーが多少の余分な空白や末尾のノイズに寛容であれば、このボディはそのまま正規のJSONオブジェクトとして解釈されます。

この手法は、DirectDefenseの記事でも同様の考え方として、`"foo="` のようなキーに`"bar"`のような値を割り当てて等号(`=`)を含む文字列を作り、フォームの`name=value`構造をJSONの構文に無理やり適合させる例として紹介されています。要は「フォームのエンコーディング規則とJSONの構文規則の交差点」を突く攻撃です。

> 出典: DirectDefense — CSRF in the Age of JSON — https://www.directdefense.com/csrf-in-the-age-of-json/

サーバがこの`text/plain`ボディを受け取ったときに何が起きるかは、フレームワークのボディパーサー実装に依存します。多くのWebフレームワーク（Express+body-parser、Djangoのミドルウェア構成、一部のtRPC実装など）は、パフォーマンスや利便性のために「Content-Typeにかかわらずボディの先頭が`{`や`[`ならJSONとしてパースを試みる」という**寛容なcontent-typeスニッフィング（推測処理）**を実装していることがあり、これがJSON CSRFを成立させる直接の技術的原因になります。逆に、Content-Typeを厳密にチェックし`application/json`以外を無条件に拒否するサーバでは、この経路は成立しません。

### 攻撃手法2: CORSの動的Origin反射 + `credentials: true`による「本物の」JSON CSRF

上記のtext/plain偽装は「JSONに見せかけたテキスト」を送る手法でしたが、サーバ側のCORS設定に不備があれば、攻撃者は**正真正銘の`application/json`リクエストを、認証Cookie付きで**クロスオリジンから送信できてしまいます。条件は次の2つです。

1. `Access-Control-Allow-Origin`（ACAO）ヘッダーが固定のホワイトリストではなく、**リクエストの`Origin`ヘッダーをそのまま反射（エコー）**して返している
2. `Access-Control-Allow-Credentials: true` が同時に返っている

CORS仕様では、ワイルドカード`*`とAllow-Credentials: trueの組み合わせはブラウザ側でエラーとして拒否されるため、Cookie付きのクロスオリジンアクセスを許可したいサーバの多くは、代わりに「リクエストの`Origin`をそのまま返す」実装を選びがちです。これは一見ホワイトリスト運用に見えて、実質的にはあらゆるオリジンを許可しているのと同じであり、攻撃者は自分のドメインから次のようなコードを実行するだけで済みます。

```javascript
const xhr = new XMLHttpRequest();
xhr.open("POST", "https://victim.example/api/transfer", true);
xhr.withCredentials = true; // Cookieを含めて送信させる
xhr.setRequestHeader("Content-Type", "application/json");
xhr.onload = () => { /* レスポンスも読み取れてしまう */ };
xhr.send(JSON.stringify({ toAccount: "attacker-account", amount: 100000 }));
```

`withCredentials = true`は「このクロスオリジンXHRにCookie等の資格情報を含めて送信し、レスポンスも読み取りたい」という明示的な指定です。プリフライトは発生しますが、サーバが動的にOriginを反射している限りプリフライトにも通過してしまい、実リクエストが認証Cookie付きで届きます。これは単なるCSRF（送信のみ、レスポンス閲覧は不可）を超えて、**レスポンスの読み取りまで可能になる**点で、通常のCSRFより危険度が高いことにも注意が必要です。銀行の送金APIのように、エンドポイントやパラメータ名が全ユーザーで共通・固定であるほど、攻撃者は値だけを差し替えた汎用ペイロードを用意できます。

> 出典: DirectDefense — CSRF in the Age of JSON — https://www.directdefense.com/csrf-in-the-age-of-json/

### 攻撃手法3: リクエストボディを消してクエリパラメータ化し、simple requestに落とし込む

もう一つの実戦的なバイパスとして、「JSONボディで送るはずのパラメータを、URLのクエリ文字列に移し替えてしまう」手法があります。ある非公開バグバウンティ案件の報告によれば、対象APIは本来`Content-Type: application/json`のボディでメールアドレス変更などの操作を受け付けており、CORSも正しく設定されていたためXHRベースの非simpleリクエストは正しくブロックされていました。しかし調査の結果、**リクエストボディを空にし、本来ボディに入れるはずだったパラメータ（例: `email`）をクエリパラメータとしてURLに付与するだけで、サーバは同じ処理を実行してしまう**ことが判明しました。ボディを使わずクエリパラメータだけで完結する`POST`リクエストは、Content-Typeの指定すら不要な単純リクエストとして成立するため、通常の`<form>`によるGET/POST送信、あるいは`<img>`タグの`src`に相当するテクニックだけでCSRFが成立します。

```html
<form action="https://victim.example/api/updateEmail?email=attacker@evil.example" method="POST"></form>
<script>document.forms[0].submit()</script>
```

これは「JSONのパース経路」ではなく「サーバが同じロジックにたどり着く別入力経路（クエリパラメータ）を残していた」という**入力経路の非対称性**を突くものです。JSON専用のCSRF対策（Content-Type検証やJSONボディ内のトークン確認）を実装していても、サーバ実装のどこかでクエリパラメータからも同じフィールドを読み取れる設計になっていると、対策そのものを迂回されてしまいます。

> 出典: InfoSec Writeups — Busting CSRF: The Hidden Dangers of JSON Exploited — https://infosecwriteups.com/busting-csrf-the-hidden-dangers-of-json-exploited-fd4aeb4cf47e （直接取得は403でブロックされ、検索結果の要約から内容を再構成しています）

### 攻撃手法4: フォーム送信そのものによるContent-Type不問突破、および関連バイパスの分類

System Weaknessの解説記事は、JSON CSRFの成立条件を実装側の防御レベルに応じて次の4パターンに整理しています。

1. **Content-Typeを一切検証しない**場合: 通常のHTMLフォーム（`enctype="text/plain"`や`application/x-www-form-urlencoded`）でそのまま攻撃可能
2. **POSTデータの形式（パース可能性）だけを検証**する場合: `fetch`をフォーム経由の`no-cors`モードやリンクタグと組み合わせ、パース可能な形式に整形したペイロードを送る
3. **Content-Typeを厳密に`application/json`のみに限定**している場合: XHR/`fetch`を使う必要があるため、前述のCORS誤設定（動的Origin反射＋credentials true）が必須条件になる
4. **CORSも正しく設定されている**場合: レガシーな手法（Flashベースのクロスドメインリクエストなど）が使われた歴史があるが、現代の主要ブラウザではFlash自体が廃止・無効化されているため、実務上のリスクはほぼ解消されている

この整理から分かるのは、「JSON CSRFが成立するかどうか」は単一の脆弱性ではなく、**Content-Type検証の厳密さ・ボディパーサーの寛容さ・CORS設定・CSRFトークンの有無という複数の防御層のうち、どれか一つでも欠けると突破される**という多層防御の考え方です。加えて、`X-HTTP-Method-Override`のようなメソッドオーバーライドヘッダーを悪用してフォームのPOSTをPUT/DELETE相当として処理させる、あるいはJSONボディを`multipart/form-data`のFormDataに変換して送るといった派生テクニックも報告されており、いずれも「サーバが期待するContent-Typeを厳密に強制していない」という同根の弱点を突いています。

> 出典: System Weakness — Ways To Exploit JSON CSRF (Simple Explanation) — https://systemweakness.com/ways-to-exploit-json-csrf-simple-explanation-5e77c403ede6 （直接取得は403でブロックされ、検索結果の要約から内容を再構成しています）

### 実例で見るtext/plain偽装の生ペイロード

実際の脆弱性報告（プロフィール更新APIを対象としたペネトレーションテスト）では、次のようなリクエストが有効な攻撃として成立したと報告されています。

```
POST /trpc/users.updateUserInfo?batch=1 HTTP/1.1
Host: victim.example
Content-Type: text/plain
Cookie: session=<被害者のセッションCookie>

{"0":{"accountName":"hacked","name":"tes edf","subscribed":"on","phone":"1099424297","country":"EG"}}
```

このケースでは、セッションCookieに`SameSite=None`が設定されており（クロスサイトでも自動送信される）、かつサーバが`Content-Type: text/plain`のボディも`application/json`同様にパースしていたため、CSRFトークンなしでプロフィール情報の書き換えが成立しました。メールアドレス変更フィールドだけは別途保護されていたため完全なアカウント乗っ取りには至りませんでしたが、氏名・電話番号・国コードなどの個人情報が任意に書き換え可能でした。ここでの技術的な急所は、`?batch=1`というtRPC特有のバッチ処理形式に対しても、`text/plain`という「simple」なContent-Typeで通るリクエストがそのまま同じディスパッチ処理に到達してしまう点です。JSONの中身がどれほど複雑・多層的な構造（配列・ネストしたオブジェクト）であっても、Content-Typeの検証さえ緩ければCSRFの成立条件には影響しません。

（本項の実例は、対象記事が直接取得できなかったため、同種の技術を報告した公開ライトアップの内容を要約したものです。詳細な一次情報は上記URLからご確認ください。）

### 防御策のまとめ

- **Content-Typeの厳密な検証**: `application/json`を要求するエンドポイントでは、`text/plain`や`application/x-www-form-urlencoded`など他のContent-Typeで届いたリクエストを無条件に拒否する。ボディの先頭文字列から推測してパースするような寛容な実装（content-type sniffing）は避ける。
- **CSRFトークンの導入**: JSONボディの中に、予測不可能なノンス（一度きりの推測困難な値）を含め、サーバ側で検証する。DirectDefenseも「最善の対策は依然として、リクエストに含まれる予測不可能なノンスをアプリケーションが検証することだ」と結論づけています。
- **Cookieの`SameSite`属性**: セッションCookieに`SameSite=Strict`（理想）または少なくとも`SameSite=Lax`を設定し、クロスサイトの通常フォーム送信でCookieが自動送信されないようにする。`SameSite=None`はクロスサイトでの利用を明示的に許可するものであり、CSRF対策とは併用が必須である点に注意する。
- **CORSの原点回帰**: `Access-Control-Allow-Origin`をリクエストOriginの単純な反射にせず、事前に定義した信頼できるオリジンのホワイトリストと突き合わせる。`Access-Control-Allow-Credentials: true`を使う場合は特に厳格な検証が求められる。
- **クエリパラメータ経由の迂回経路を塞ぐ**: ボディで受け取るべき機微なパラメータを、同じハンドラがクエリパラメータや別のエンコーディングからも受理してしまわないよう、入力経路を一本化する。
- **Origin/Refererヘッダーの検証**: CSRFトークンやSameSite Cookieを補完する多層防御として、サーバ側でOriginまたはRefererヘッダーが期待するホストと一致するかを確認する。

> 出典: DirectDefense — CSRF in the Age of JSON — https://www.directdefense.com/csrf-in-the-age-of-json/
> 出典: PentesterLab Glossary — JSON CSRF — https://pentesterlab.com/glossary/json-csrf
