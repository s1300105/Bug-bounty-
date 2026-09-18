# CSP（コンテンツセキュリティポリシー）の基礎 — XSSを封じる「第二の壁」の作り方

> **この節で分かること**
> - CSPが「同一オリジンポリシーだけでは防げないXSS」に対する多層防御であることを、設計意図から説明できる。
> - `Content-Security-Policy`ヘッダの3つの配信方法と、ソース許可リストの文法・キーワードを読み解ける。
> - なぜインラインスクリプトと`eval`が禁止されるのか、nonce・hashでどう例外を作るのかを説明できる。
> - 「許可リスト型CSP」がなぜ弱く、「strict CSP」がなぜ推奨されるのかを判断できる。
> - 診断・バグバウンティの現場で、与えられたCSP文字列の弱点（バイパス可能な箇所）を自分で評価できる。
> - `strict-dynamic`のLimitationsとTrusted Types（`require-trusted-types-for`）でDOM XSSの残存リスクをどう埋めるかを説明できる。

**元資料**:
- https://web.dev/articles/csp （原典は取得できず、GoogleChrome/web.devリポジトリの原稿Markdownから全量取得＝二次情報ベース）
- https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html （原典は取得できず、OWASP/CheatSheetSeriesリポジトリの原稿Markdownから全量取得＝二次情報ベース）
- 補助: https://web.dev/strict-csp/ ・ https://web.dev/trusted-types/ （同じく原稿Markdownから取得）

**関連する節**: 同一オリジンポリシー（SOP）の節、XSSの節、DOM XSSの節

---

## 1. CSPとは何か — なぜ生まれたのか

### 1.1 出発点は同一オリジンポリシー（SOP）

Webのセキュリティモデルの根幹は**同一オリジンポリシー（Same-Origin Policy, SOP）**である。SOPとは、あるオリジンのコードは同じオリジンのデータにしかアクセスできない、という隔離ルールのこと。たとえば`https://mybank.com`のコードは`https://mybank.com`のデータにだけアクセスでき、`https://evil.example.com`は決してそこへアクセスできない。

各オリジンはWebの残りの部分から隔離され、開発者に安全なサンドボックス（隔離された実行区画）が与えられる。web.dev原文はこれを「理論上はこれで完璧（perfectly brilliant）」と表現している。だが実際には、攻撃者はこの仕組みを覆す巧妙な手段を見つけてきた。

### 1.2 SOPを回り込むのがXSS

**XSS（クロスサイトスクリプティング, Cross-site Scripting）**とは、サイトを騙して「意図されたコンテンツと一緒に悪意あるコードを配信させる」ことで同一オリジンポリシーを回避する攻撃のこと。これが大問題になる理由は1つに尽きる。

**ブラウザは、ページ上に現れるすべてのコードを、そのページのセキュリティオリジンの正当な一部として信頼してしまう**からである。攻撃者が注入したスクリプトも、正規のスクリプトも、ブラウザには区別がつかない。両方とも「そのページのコード」として同じ権限で走る。

攻撃者がどんなコードでも1つ注入に成功したら、web.dev原文の言葉では「pretty much game over（ほぼ勝負あり）」である。ユーザーのセッションデータは侵害され、秘密であるべき情報が攻撃者へ流出する。

### 1.3 CSPは「第二の壁（多層防御）」

**CSP（コンテンツセキュリティポリシー, Content Security Policy）**とは、`Content-Security-Policy`というHTTPレスポンスヘッダで「このページは何を読み込み・実行してよいか」をブラウザに宣言する仕組みのこと。SOPだけでは防げないXSSに対する**多層防御（defense in depth）の第二層**として働く。

多層防御とは、1枚の壁が破られても次の壁で被害を食い止める、という設計思想のこと。OWASPチートシートは、CSPを「XSSに対する実効的な第二層（second layer）の保護」と位置づける。ただし重要な注意がある。

- CSPはWebアプリが脆弱性を*含むこと*自体は防げない。防げるのは、その脆弱性を攻撃者が**悪用するのを著しく困難にする**ことである。
- したがって**CSPをXSSに対する唯一の防御機構として頼ってはならない（should not）**。入力のサニタイズなど良い開発プラクティスの上に、追加のセキュリティ層としてCSPを重ねる。

### 1.4 許可リストの発想

攻撃者が突く問題の本質は、繰り返すが「ブラウザがアプリの一部であるスクリプトと第三者が悪意で注入したスクリプトを区別できない」ことである。web.dev原文の例では、ページ下部のGoogle +1ボタンが`https://apis.google.com/js/plusone.js`のコードをこのページのオリジンのコンテキストで読み込み実行する。我々はそのコードを信頼しているが、ブラウザが自力で「`apis.google.com`のコードは素晴らしいが`apis.evil.example.com`のコードはそうでない」と判断することは期待できない。

そこでCSPは、信頼するコンテンツのソース（出所）の**許可リスト（allowlist）**を作り、「それらのソース由来のリソースのみを実行・描画せよ」とブラウザに指示する。攻撃者がスクリプトを注入する穴を見つけても、そのスクリプトは許可リストに合致しないので実行されない。

```http
Content-Security-Policy: script-src 'self' https://apis.google.com
```

このポリシーは、`script-src`（スクリプト関連の権限を制御するディレクティブ）に対して、`'self'`（現在のページのオリジン）と`https://apis.google.com`の2つを有効なスクリプトソースとして指定している。ブラウザはこの2つ以外からのJavaScriptを実行しない。

許可リストに反するスクリプトを読み込もうとすると、ブラウザはエラーを投げてブロックする。web.dev原文がコンソール出力として挙げているのは次のメッセージである。

```
Refused to load the script 'http://evil.example.com/evil.js' because it violates the following Content Security Policy directive: script-src 'self' https://apis.google.com
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: web.dev「Content security policy」 — https://web.dev/articles/csp
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側のegress制限で`web.dev:443`へのアクセスが403で拒否され、web.archive.orgも同様に拒否された）。以下の記述はGoogleChrome/web.devリポジトリの原稿Markdown（メタデータ上は`date: 2012-06-15 / updated: 2020-06-19`）にもとづく要約であり、ライブページがその後改訂されている可能性がある。
> **読みどころ**:
> 1. 「Policy applies to a wide variety of resources」節のディレクティブ一覧。ライブページはCSP Level 3の現状に合わせて更新されている可能性が高いので、`worker-src`や`frame-src`の実装状況はライブ版とMDNで確認する。
> 2. 「Implementation details」節のsource list文法とワイルドカード規則。CSPバイパス判定の核になる。
> 3. 「Inline code is considered harmful」節とnonce/hashの使い方。
> 4. 「Reporting」節の違反レポートJSONのキー構造。
> 5. 3つのUse case（social media widgets / lockdown / SSL only）の完成ポリシー文字列。
> **代替手段**: MDNのCSP解説（https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy ）、および https://content-security-policy.com/ が同等の無料資料。

---

## 2. CSPの配信方法 — 3つの届け方

CSPをブラウザに届ける方法は3つある。設計意図（何のために使い分けるか）とともに整理する。

| 配信方法 | 書き方 | 特徴・制限 |
|---|---|---|
| `Content-Security-Policy`ヘッダ | HTTPレスポンスヘッダ | **推奨。CSPの全機能をサポート**。強制（ブロック）モード。indexページだけでなくすべてのHTTPレスポンスで送る。 |
| `Content-Security-Policy-Report-Only`ヘッダ | HTTPレスポンスヘッダ | **強制されない（非ブロッキング／"fail open"＝違反を検知しても読み込みを止めない・防御としては開いたまま）**。違反はコンソールに出力され、`report-to`/`report-uri`があればレポートが送られる。強制展開の前段としてよく使う。 |
| `<meta http-equiv="...">`タグ | HTMLマークアップ内 | ヘッダを制御できないCDNデプロイ等で使う。ただし**`frame-ancestors`・`sandbox`・レポート系（`report-to`）は使えない**。 |

meta配信の書き方は次のとおり。

```html
<meta http-equiv="Content-Security-Policy" content="default-src https://cdn.example.net; child-src 'none'; object-src 'none'">
```

### 2.1 Report-Onlyは「観測用」

`Content-Security-Policy-Report-Only`は、リソースをブロックせずに違反だけを報告するモードである。CSPを始めたばかりのときは、いきなり強制すると正規の機能まで壊れかねない。そこでまずReport-Onlyで観測し、違反を修正してから強制へ移す、というのが定石。

強力なのは、**両方のヘッダを同時に送れる**点である。片方（強制）で現行ポリシーを守りつつ、もう片方（Report-Only）で新しい厳しいポリシーの影響を監視できる。ブラウザはこの併用を完全にサポートする。

### 2.2 使ってはならないヘッダ

古いチュートリアルには`X-WebKit-CSP`や`X-Content-Security-Policy`が出てくるが、**これらは使ってはならない（DO NOT）**。OWASP原文は「実装がobsolete（Firefox 23以降・Chrome 25以降で廃止）、限定的、非一貫的で、信じられないほどバグが多い（incredibly buggy）」と明言している。プレフィクス無しの`Content-Security-Policy`を使う。

〔補足〕診断の観点では、`X-`プレフィクス版だけが設定されているサイトは「CSPを設定したつもりで実質無防備」であることが多い。ヘッダ名を正確に見ること。

### 2.3 ブラウザ対応と普及状況

CSPは新しい技術ではなく、主要ブラウザで長く実装されてきた。導入をためらう理由はほぼない、という点を押さえておく。

- **CSP 1**はChrome・Safari・Firefoxでかなり実用的だが、**IE 10ではサポートが非常に限定的**だった。
- **CSP Level 2はChrome 40以降**で利用可能。
- 標準の`Content-Security-Policy` / `Content-Security-Policy-Report-Only`ヘッダは**Firefox 23+・Chrome 25+・Opera 19+**でサポートされる（W3C Specの標準ヘッダ）。
- **TwitterやFacebookのような巨大サイトがすでにこのヘッダを展開済み**である。Twitterのケーススタディが公開されている（blog.twitter.com、下記📌参照）。

つまり「対応ブラウザが少ないから入れない」という言い訳は現状成り立たない。標準は自サイトへ展開を始められる状態にある。

〔補足〕`strict-dynamic`を含むCSP Level 3の機能も、現在は主要なモダンブラウザエンジンで広くサポートされている（§7・§8参照）。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Twitter Engineering「Improving browser security with CSP」 — https://blog.twitter.com/engineering/en_us/a/2011/improving-browser-security-with-csp.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 外部サイトのため未取得。web.dev原稿が参照として挙げていたもの）。以下の記述はweb.dev原稿の言及にもとづく。
> **読みどころ**:
> 1. 大規模サイトが実運用でCSPをどう段階展開したか（Report-Onlyから強制へ）の実例。
> 2. インラインスクリプトの排除で直面した実務上の課題。
> **代替手段**: web.dev「Content security policy」（https://web.dev/articles/csp ）のReal World Usage節が同等の内容を要約している。

---

## 3. ソース許可リストの文法 — どこがバイパスの入口か

CSPを読めるようになる第一歩は、`script-src`などのディレクティブが受け取る「ソースの書き方」を正確に理解することである。ここはCSPバイパス判定の核心なので、丁寧に見る。

### 3.1 ソースの指定の仕方

| 書き方 | 例 | マッチする範囲 |
|---|---|---|
| スキームのみ | `data:` `https:` | そのスキームすべて |
| ホスト名のみ | `example.com` | **そのホスト上の任意のオリジン（任意のスキーム・任意のポート）** |
| 完全修飾 | `https://example.com:443` | HTTPSのみ・`example.com`のみ・ポート443のみ |

「ホスト名のみ」の指定が任意スキーム・任意ポートにマッチする点は見落としやすい。`example.com`と書くと`http://example.com:8080`のようなものまで許可される。

### 3.2 ワイルドカードの位置

ワイルドカード`*`は受け付けられるが、**スキーム・ポート・ホスト名の最左位置のみ**に置ける。ここが重要な落とし穴を生む。

```text
*://*.example.com:*
```

この指定は`example.com`の**全サブドメイン**に（任意スキーム・任意ポートで）マッチするが、**`example.com`自身にはマッチしない**。逆に言えば、サブドメインのどれか1つでも攻撃者が制御できる（サブドメイン乗っ取りなど）と、このCSPは突破される。

### 3.3 4つのキーワード — シングルクォート必須

ソースリストには特別なキーワードがある。

| キーワード | 意味 |
|---|---|
| `'none'` | 何にもマッチしない（matches nothing）。 |
| `'self'` | 現在のオリジンにマッチする。ただし**そのサブドメインにはマッチしない**。 |
| `'unsafe-inline'` | インラインJavaScriptとCSSを許可する。 |
| `'unsafe-eval'` | `eval`のようなtext-to-JavaScript機構を許可する。 |

OWASPの原文表（逐語）では`'self'`を次のように定義している。

```text
'self' — Refers to the origin site with the same scheme and port number.
```

これらのキーワードには**シングルクォートが必須**である。ここは初学者が最も間違えるポイント。

- `script-src 'self'`（クォート付き）＝現在のホストからのJavaScript実行を認可する。
- `script-src self`（クォート無し）＝「`self`という名前のサーバー」からのJavaScriptを許可し、**現在のホストからは許可しない**。

つまりクォートを忘れると、意図とまったく違うポリシーになる。診断時にクォートの有無は必ず確認する。

### 3.4 ページ単位・ディレクティブ単位のルール

- ポリシーは**ページ単位（page-by-page basis）**で定義される。保護したいすべてのレスポンスにヘッダを付ける必要がある。1ページだけ設定しても他ページは無防備。
- 同じディレクティブを2回書くと**2つ目は無視される**。`script-src https://host1.com; script-src https://host2.com`と書くと、`https://host2.com`は効かない。正しくは1つにまとめる。

```http
script-src https://host1.com https://host2.com
```

これは診断で頻出のパターンである。「ポリシー文字列の見た目」と「実効値」がずれる典型なので、重複ディレクティブを見たら実効値を確認する。

---

## 4. ディレクティブの全体像 — 4つの分類で覚える

ディレクティブは種類が多い。OWASPチートシートは4分類で整理しており、これが最も実務的である。

```text
CSPディレクティブ
├── Fetch系      … リソースをどこから読み込んでよいか
│    ├── default-src  (他のfetch系のフォールバック)
│    ├── script-src   (他のscript系のフォールバック)
│    │    ├── script-src-elem  (<script>要素の実行)
│    │    └── script-src-attr  (イベントハンドラの実行)
│    ├── style-src / style-src-elem / style-src-attr
│    ├── img-src / font-src / media-src / connect-src
│    ├── child-src / worker-src / manifest-src / object-src
│    └── (prefetch-src は Level 3 で削除)
├── Document系   … ドキュメントの性質
│    ├── base-uri / plugin-types / sandbox
├── Navigation系 … どこへ遷移・埋め込みできるか
│    ├── form-action / frame-ancestors
└── Reporting系  … 違反をどこへ送るか
     ├── report-to (現行) / report-uri (deprecated)
```

### 4.1 Fetch系ディレクティブ

Fetch系は「ブラウザが信頼してリソースを読み込む場所」を伝える。主なものを挙げる。

| ディレクティブ | 説明 |
|---|---|
| `default-src` | 他のfetch系のフォールバック。**指定されたディレクティブは継承しないが、指定されなかったディレクティブは`default-src`の値にフォールバックする**。 |
| `script-src` | スクリプトを実行できる場所。**他のscript系ディレクティブのフォールバック**。 |
| `script-src-elem` | `<script>`要素の実行（リクエストとブロック）を制御。 |
| `script-src-attr` | **イベントハンドラの実行**を制御。 |
| `style-src` | スタイルが適用される場所（`<link>`、`@import`、`Link`ヘッダ由来）。 |
| `style-src-elem` / `style-src-attr` | インライン属性を除くスタイル／スタイル属性を制御。 |
| `connect-src` | fetch、XHR、eventsource、beacon、websockets接続を制御。 |
| `img-src` / `font-src` / `media-src` | 画像／フォント／動画・音声・text trackの読み込み元。たとえばGoogleのWebフォントは`font-src https://themes.googleusercontent.com`で有効化できる。 |
| `child-src` | ネストしたブラウジングコンテキスト（フレーム）とworker実行コンテキストの読み込み元。たとえば`child-src https://youtube.com`とすると、YouTubeからの動画埋め込みは許可されるが他オリジンからはできない。 |
| `object-src` | プラグインを読み込めるURL。 |
| `manifest-src` | アプリケーションマニフェストの読み込み元。 |
| `prefetch-src` | prefetch/prerender用の**実験的**ディレクティブだった。**CSP Level 3仕様から削除され、モダンブラウザでは無視される**。防御目的で依存してはならない。 |

`script-src-elem`と`script-src-attr`の違いは要注意である。前者は`<script>`要素そのもの、後者は`onclick`などのイベントハンドラ属性を制御する。

### 4.2 デフォルトは「全開」

CSPの落とし穴として、**設定しなかったディレクティブは既定で全開（wide open）**という挙動がある。たとえば`font-src`を設定しなければ、`font-src *`と書いたのと同じ（どこからでもフォントを読める）になる。

この既定を締めるのが`default-src`である。`default-src`は指定しなかったほとんどの`-src`系ディレクティブの既定値を定める。ただし**`default-src`にフォールバックしないディレクティブ**があり、これらを設定しないことは「何でも許す」のと同じである。web.dev原文の逐語リストを示す。

```text
* base-uri
* form-action
* frame-ancestors
* plugin-types
* report-uri
* sandbox
```

診断上のポイントは、`default-src 'none'`があっても`base-uri`・`form-action`・`frame-ancestors`が未指定なら、それらは無防備という点である。

### 4.3 Document系・Navigation系

| ディレクティブ | 分類 | 説明 |
|---|---|---|
| `base-uri` | Document | `<base>`要素が使えるURLを制限。`<base>`注入を防ぐ。 |
| `plugin-types` | Document | ドキュメントに読み込めるリソースの**種類（type）**を制限（例`application/pdf`）。対象の`<embed>`・`<object>`には3つのルールが適用される。(1)要素は自分のtypeを明示的に宣言する必要がある。(2)要素のtypeは宣言されたtypeと一致する必要がある。(3)要素のリソースは宣言されたtypeと一致する必要がある。 |
| `sandbox` | Document | フォーム送信などページの動作を制限。**`Content-Security-Policy`ヘッダと共に使う場合のみ適用**。値なし（`sandbox;`）だと全制限が有効。 |
| `form-action` | Navigation | フォームの送信先URLを制限。フィッシングフォーム注入を防ぐ。 |
| `frame-ancestors` | Navigation | 自ページを`<frame>`/`<iframe>`/`<object>`/`<embed>`/`<applet>`に埋め込めるURLを制限。 |

`frame-ancestors`には重要な性質が3つある。(1)`<meta>`タグで指定された場合は無視される。(2)`default-src`にフォールバックしない。(3)`X-Frame-Options`はこのディレクティブによってobsoleteとなり、UAに無視される。クリックジャッキングやクロスサイトリーク（cross-site leaks, xs-leaks）を防ぐ主役である。

**クロスサイトリーク（xs-leaks）**とは、あるサイトが別サイトの状態（ログイン有無・特定ユーザーかどうか等）を、読み込み時間やフレーム挙動などのサイドチャネル（本来の通信経路以外から漏れる手がかり）を通じて推測する、クロスサイトの情報漏えい系攻撃のこと。自ページを勝手にフレーム埋め込みさせないことが、こうした計測の足場を奪う防御になる。

`sandbox`は少し毛色が違い、「ページが読み込めるリソース」ではなく「ページが取れる動作（actions）」に制限をかける。これがあると、ページは`sandbox`属性付き`<iframe>`の中に読み込まれたかのように扱われ、一意のオリジン（unique origin）に強制されたりフォーム送信を防いだりする。

### 4.4 Reporting系

Reporting系は違反を指定の場所へ送る。**単独では意味を持たず、他のディレクティブに依存する**。

| ディレクティブ | 説明 |
|---|---|
| `report-to` | CSP Level 3・Reporting APIと共に使う**現行の主要ディレクティブ**。`Reporting-Endpoints`（レガシーは`Report-To`）ヘッダで定義したグループ名を参照する。 |
| `report-uri` | **`report-to`に置き換えられdeprecated**。レポート送信先のURIを直接取る。 |

後方互換のため**両方を併記**する。`report-to`をサポートするブラウザはそれを使い`report-uri`を無視し、古いブラウザは`report-uri`にフォールバックする。書式は次のとおり。

```http
Content-Security-Policy: report-uri https://example.com/csp-reports
```

### 4.5 実世界の3つのユースケース（完成ポリシー雛形）

抽象的なディレクティブ説明だけでは、いざ自分のサイトに書こうとすると手が止まる。web.dev原文は「まず`default-src 'none'`から始め、コンソールを見ながら、必要なリソースを1つずつ許可していく」手順を推奨したうえで、代表的な3つの完成ポリシーを示している。これらは実務で最初に真似する雛形として役に立つ。

#### ユースケース1: ソーシャルメディアウィジェット

Google +1・Facebook Like・Twitter（当時）のTweetボタンを載せる場合。要点は次のとおり。

- **Facebook**のLikeボタンは`<iframe>`版が推奨（サイトの他の部分から安全にサンドボックスされるため）。動かすには`child-src https://facebook.com`が必要。既定でFacebookが提供する`<iframe>`は相対URL`//facebook.com`を読み込むので、**明示的にHTTPSを指定して`https://facebook.com`に変える**こと。
- **Twitter**のTweetボタンはスクリプトとフレームの両方が`https://platform.twitter.com`に依存する。`script-src https://platform.twitter.com; child-src https://platform.twitter.com`で対応する（提供されるインラインスニペットは外部JSファイルへ移す）。
- コツは、**まず`default-src 'none'`にしてコンソールを見ながら、ウィジェットを動かすのに必要なリソースを判定する**こと。

3つのウィジェットをすべて使うなら、同種リソースを1つのディレクティブにまとめて次のようになる。

```http
script-src https://apis.google.com https://platform.twitter.com; child-src https://plusone.google.com https://facebook.com https://platform.twitter.com
```

#### ユースケース2: ロックダウン（銀行など）

**自分たちが書いたリソースしか読み込ませたくない**場合。`default-src 'none'`（すべてブロック）から始めて積み上げる。画像・スタイル・スクリプトをCDN`https://cdn.mybank.net`から、XHRを`https://api.mybank.com/`へ、フレームはサイトローカルのみ、という前提での最も制限的なヘッダはこうなる。

```http
Content-Security-Policy: default-src 'none'; script-src https://cdn.mybank.net; style-src https://cdn.mybank.net; img-src https://cdn.mybank.net; connect-src https://api.mybank.com; child-src 'self'
```

#### ユースケース3: SSLのみ

第三者製フォーラムソフトを使っていてインラインを消す能力はないが、**すべてのリソースを安全なチャネル経由でのみ**読み込ませたい場合。次が効果的。

```http
Content-Security-Policy: default-src https:; script-src https: 'unsafe-inline'; style-src https: 'unsafe-inline'
```

**重要な注意**: `default-src`に`https:`を指定していても、`script-src`と`style-src`はそのソースを自動的に継承しない。**各ディレクティブは、その特定のリソース種別についての既定値を完全に上書きする（Each directive completely overwrites the default for that specific type of resource.）**。だから`script-src https: 'unsafe-inline'`のように毎回明示する必要がある。この挙動はCSP全体で共通の重要ポイントなので、§4.2・§12でも繰り返し確認する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP Content Security Policy Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側のegress制限で`cheatsheetseries.owasp.org:443`へのアクセスが403で拒否された）。内容はOWASP/CheatSheetSeriesリポジトリの原稿Markdownから全量取得したが、このページはGitHub上で更新が続くため最新版を確認すること。
> **読みどころ**:
> 1. 「Detailed CSP Directives」節の4分類（Fetch / Document / Navigation / Reporting）。分類で覚えるのが最も実務的。
> 2. 「Strict CSP」節の2つの推奨ポリシー（nonce-based / hash-based）。逐語で暗記してよい3行で、`object-src 'none'`と`base-uri 'none'`を落とさない。
> 3. nonceのWarning（全scriptタグを機械的にnonce化するミドルウェアを作るな）。実装レビューで最頻出の致命的アンチパターン。
> 4. `report-to`と`report-uri`の関係（後方互換のため両方書く）。
> 5. References節のツール類（CSP Evaluator、report-uri.comのhash generator、CSP Generator拡張）。
> **代替手段**: 同じ内容のGitHub版Markdown（OWASP/CheatSheetSeriesリポジトリの`cheatsheets/Content_Security_Policy_Cheat_Sheet.md`）。Scott Helmeの https://scotthelme.co.uk/csp-cheat-sheet/ も無料の同等資料。

---

## 5. 「インラインコードは有害」— なぜ全面禁止なのか

### 5.1 許可リストだけでは足りない

CSPは許可リスト型のオリジン指定に基づくが、オリジンベースの許可リストは**XSS最大の脅威である「インラインスクリプト注入」を解決しない**。攻撃者が悪意あるペイロードを直接含むタグ`<script>sendMyDataToEvilDotCom()</script>`を注入できる場合、ブラウザはそれを正当なインラインscriptタグと区別できない。

そこでCSPは**インラインスクリプトを全面禁止する**ことでこの問題を解く。web.dev原文の言葉では「それが確実であるための唯一の方法（it's the only way to be sure）」である。

この禁止は`<script>`タグの中身だけでなく、次のものも含む。

- **インラインイベントハンドラ**（`onclick="..."`など）
- **`javascript:` URL**（`<a href="javascript:...">`など）

これらは外部ファイルへ移すか、`addEventListener()`呼び出しに置き換える。書き換えの前後を示す。

書き換え前（CSP下でブロックされる）:

```html
<script>
    function doAmazingThings() {
    alert('YOU AM AMAZING!');
    }
</script>
<button onclick='doAmazingThings();'>Am I amazing?</button>
```

書き換え後（外部ファイル＋addEventListener）:

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

インラインスタイルも同様に扱われる。CSSが可能にする「驚くほど巧妙な」データ漏洩手法への防御のため、`style`属性も`<style>`タグも外部スタイルシートへ統合すべきである。

### 5.2 evalも禁止

攻撃者が直接スクリプトを注入できなくても、アプリを騙して「本来不活性なテキストを実行可能なJavaScriptに変換して実行させる」ことがある。CSPは既定でこれらの経路を完全にブロックする。対象は次の4つ。

- `eval()`
- `new Function()`
- `setTimeout([string], ...)`
- `setInterval([string], ...)`

`setTimeout`/`setInterval`に文字列を渡す書き方はブロックされる。関数を渡す書き方に直す。

ブロックされる（文字列渡し）:

```js
setTimeout("document.querySelector('a').style.display = 'none';", 10);
```

推奨（関数渡し）:

```js
setTimeout(function () {
    document.querySelector('a').style.display = 'none';
}, 10);
```

- JSONは`eval`ではなく組み込みの`JSON.parse`でパースする（IE8以降で利用可能・完全に安全）。
- 実行時テンプレーティングを避ける。多くのテンプレートライブラリは`new Function()`を多用するため危険。プリコンパイルを提供する言語（Handlebarsのプリコンパイル等）を選ぶ。CSPを標準サポートし、`eval`がない環境では堅牢なパーサーにフォールバックするフレームワークもある。**AngularJSの`ng-csp`ディレクティブ**（https://docs.angularjs.org/api/ng/directive/ngCsp ）がその好例で、これを付けるとAngularJSが`eval`／`new Function`を使わないCSP互換モードで動く。
- どうしても`eval`が必要なら`script-src`に`'unsafe-eval'`を足せば有効化できるが、web.dev原文は**強く非推奨（strongly discourage）**とする。

### 5.3 OWASPが挙げるCSPの5つの防御効果

OWASPチートシートは、CSPがXSSを防ぐ仕組みを具体的な注入例とともに5つ挙げている。

| 防御 | ブロックされる注入例 |
|---|---|
| インラインスクリプトの制限 | `<script>document.body.innerHTML='defaced'</script>` |
| リモートスクリプトの制限 | `<script src="https://evil.com/hacked.js"></script>` |
| 危険なJavaScriptの制限 | `eval(`${op1} + ${op2}`)`（URLパラメータをevalに渡す計算機） |
| フォーム送信の制限 | 偽ログインフォームを注入し`https://evil.com/collect`へ送信させる攻撃 |
| objectの制限 | 悪意あるflash/Java/レガシー実行可能物を`<object>`で注入する攻撃 |

`frame-ancestors`によるフレーミング攻撃（クリックジャッキング、xs-leaks）の防御も加わる。歴史的には`X-Frame-Options`が使われたが、`frame-ancestors`がそれをobsoleteにした。

### 5.4 Subresource Integrity（SRI）の強制

**Subresource Integrity（SRI）**とは、`<script>`や`<link>`に`integrity`属性でリソースのハッシュを書いておき、ダウンロードした中身がそのハッシュと一致したときだけ実行・適用する仕組みのこと。中身が1バイトでも変われば読み込みが拒否される。

OWASPチートシートは、**ユーザー入力を一切受け付けない完全な静的サイトであっても、CSPを使ってSRIの使用を強制できる**と述べている。これが効くのは次のような場面である。

- アナリティクスや広告などの**第三者スクリプトをホストしているサイトの1つが侵害され**、配信ファイルが差し替えられた場合。SRIを強制していれば、ハッシュ不一致でその改竄スクリプトはブロックされ、自サイト上で実行されない。

つまりSRIは「許可リストに載っているホストが乗っ取られた」という、ホスト許可リスト型CSPだけでは防げない事態への追加の一手になる。多層防御の一部として、静的サイトでも検討する価値がある。

〔補足〕SRIハッシュの生成方法や`integrity`属性の書式そのものはCSPの範囲外だが、CSPと組み合わせると「信頼したホストであっても、中身が想定どおりのときだけ実行する」という強い保証になる。

---

## 6. nonceとhash — インラインを個別に許可する

インラインスクリプトを全面禁止するのが原則だが、どうしても消せないインラインが残ることがある。CSP Level 2は**nonce**と**hash**という2つの後方互換の仕組みを用意している。

### 6.1 nonce（number used once）

**nonce**とは、一度だけ使うランダムな使い捨ての値のこと。信頼する`<script>`タグに`nonce`属性として付け、同じ値をCSPヘッダに書く。両者が一致したスクリプトだけが実行を許される。

```html
<script nonce="EDNnf03nceIOfn39fn3e9h3sdfa">
    // Some inline code I can't remove yet, but need to asap.
</script>
```

```http
Content-Security-Policy: script-src 'nonce-EDNnf03nceIOfn39fn3e9h3sdfa'
```

nonceが安全であるための条件は厳格である。web.dev原文の逐語では「must be regenerated for every page request and they must be unguessable（ページリクエストごとに再生成され、推測不能でなければならない）」。web.dev/strict-cspが挙げる具体的条件は次の3点。

- 暗号学的に強いランダム値（理想的には128ビット以上の長さ）
- レスポンスごとに新規生成
- Base64エンコード

**診断ポイント**: nonceが毎レスポンスで変わっていなければ（同じ値が使い回されていれば）、攻撃者はその値を注入スクリプトに付けられるので、nonceはXSS緩和として無価値になる。

### 6.2 hash

**hash**とは、入力を圧縮した数値に変換する数学的関数の出力のこと。インラインスクリプトの中身から`SHA-256`などのハッシュを計算し、`script-src`に書くと、そのスクリプトだけが実行を許される。

```html
<script>alert('Hello, world.');</script>
```

に対して:

```http
Content-Security-Policy: script-src 'sha256-qznLcsROx4GACP2dm0UCKCzCG-HiZ1guq6ZZDob_Tng='
```

hashの注意点は次のとおり。

- `sha256-`/`sha384-`/`sha512-`の3種をサポート。
- ハッシュ生成時に`<script>`タグ自体は含めない（中身だけ）。
- **大文字小文字と空白（先頭・末尾を含む）が効く**。コードをフォーマットしただけ、空白1文字変えただけでもハッシュが変わり、スクリプトが動かなくなる。これは運用リスク。
- Chrome 40以降ではDevToolsを開いてページを再読み込みすると、Consoleに正しいsha256ハッシュを含む違反メッセージが表示される。ここからコピーできる。

OWASPが挙げるhash generatorは https://report-uri.com/home/hash 。

---

## 7. 許可リスト型 vs strict CSP — なぜ後者が推奨か

### 7.0 strict CSPが守る攻撃対象

先に「何のためにstrict CSPを入れるのか」を明確にしておく。OWASPチートシートは、strict policyの役割を**古典的なstored XSS・reflected XSS・および一部のDOM XSS攻撃から保護すること**と定め、**CSPを実装しようとするあらゆるチームにとって最適な目標であるべき**だとしている。

- **stored XSS（格納型XSS）**: 攻撃者の入力がサーバーに保存され、他ユーザーの閲覧時に実行されるXSS。
- **reflected XSS（反射型XSS）**: URLパラメータなどの入力が同じレスポンスにそのまま反映されて実行されるXSS。
- **一部のDOM XSS**: JavaScriptがsourceからsinkへ危険なデータを流すことで起きるXSS（残りはTrusted Typesで補う。§10・§11参照）。

### 7.1 許可リスト型は「ほとんどバイパス可能」

CSP構築の元来の機構は許可リスト（allowlist）型だった。しかしOWASP・web.dev両方が現在の推奨として**strict CSP**を挙げている。理由は明確である。

web.dev/strict-cspは、`script-src www.googleapis.com`のような許可リスト型CSPには2つの欠点があるとする。

- **多くのカスタマイズを必要とする**（アプリごとに手作りが必要）。
- **ほとんどの構成でバイパスできる**（したがってXSS防止として実効性が低い）。

バイパス可能性の実証データは、Googleの論文 "CSP Is Dead, Long Live CSP!"（pub45542）にある。web.dev/strict-cspの比較表（逐語）を示す。

| Allowlist CSP（worse） | Strict CSP（better） |
|---|---|
| Doesn't effectively protect your site. ❌ | Effectively protects your site. ✅ |
| Must be highly customized. 😓 | Always has the same structure. 😌 |

### 7.2 strict CSPの推奨形

strict CSPとは、nonceまたはhashに`'strict-dynamic'`・`object-src 'none'`・`base-uri 'none'`を組み合わせたポリシーのこと。OWASP・web.devが示す推奨形（逐語）は次の2つ。

**Nonce-based strict CSP**:

```text
Content-Security-Policy:
  script-src 'nonce-{RANDOM}' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
```

**Hash-based strict CSP**:

```text
Content-Security-Policy:
  script-src 'sha256-{HASHED_INLINE_SCRIPT}' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
```

これらを"strict"（ゆえに安全）にしている性質は次のとおり。

- nonce/hashで、**どの`<script>`が開発者に信頼されているか**を示す。
- **`'strict-dynamic'`**（すでに信頼されたスクリプトが作ったスクリプトの実行を自動的に許可）で展開の労力を減らし、多くの第三者ライブラリの利用も解禁する。
- **URL許可リストに基づかない**ため、一般的なCSPバイパスの影響を受けない。
- インラインイベントハンドラや`javascript:` URIのような信頼されないインラインをブロックする。
- **`object-src`を制限**してFlashなど危険なプラグインを無効化。
- **`base-uri`を制限**して`<base>`タグ注入をブロック（攻撃者が相対URLスクリプトの読み込み先を変えるのを防ぐ）。
- **常に同じ構造**なのでアプリごとのカスタマイズが不要。

### 7.3 strict-dynamicとは

`strict-dynamic`はCSP Level 3の機能で、hashまたはnonceと組み合わせて使う。正しいnonce/hashを持つスクリプトが追加のDOM要素を作りその中でJSを実行する場合、`strict-dynamic`はそれらの要素も信頼するようブラウザに伝える。各要素に明示的にnonce/hashを付ける必要がなくなる。CSP Level 3はモダンブラウザで広くサポートされている。

### 7.4 非Strictな基本ポリシー

strict CSPを作れない場合の折衷案として、OWASPは**cross-site framingとcross-site form-submissionを防ぐ**基本ポリシーを挙げている。

```text
Content-Security-Policy: default-src 'self'; frame-ancestors 'self'; form-action 'self';
```

さらに締めるなら:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; frame-ancestors 'self'; form-action 'self';
```

その他の実用スニペット:

```text
Content-Security-Policy: upgrade-insecure-requests;
Content-Security-Policy: frame-ancestors 'none';
Content-Security-Policy: frame-ancestors 'self';
Content-Security-Policy: frame-ancestors trusted.com;
```

---

## 8. strict CSPの導入手順 — 5ステップ

web.dev/strict-cspが示す導入手順を整理する。診断者もこの手順を知っておくと、対象サイトの実装の甘さを見抜きやすい。

### 8.1 Step 1: nonceベースかhashベースか決める

| 方式 | 向いている対象 |
|---|---|
| Nonce-based | レスポンスごとに新しいランダムトークンを作れる、**サーバーでレンダリングされるHTMLページ** |
| Hash-based | **静的配信・キャッシュが必要なページ**。例: Angular/Reactなどで作りSSRなしで静的配信されるSPA |

### 8.2 Step 2: CSPを設定しスクリプトを準備する

nonceの生成例（Express, 逐語）:

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

nonce生成はサーバーサイドフレームワーク側の機能を使うのが実務的である。web.dev原文は上のExpress（JavaScript）に加え、**Django（Python）の`django-csp`**（https://django-csp.readthedocs.io/en/latest/nonce.html ）を例として挙げている。自分のスタックに用意された仕組みを使えば、レスポンスごとの再生成やテンプレートへのnonce注入を安全に扱える。

すべての`<script>`要素にこのnonceを付ける（全スクリプトが同じnonceでよい）。

許可される例:

```html
<script nonce="${NONCE}" src="/path/to/script.js"></script>
<script nonce="${NONCE}">foo()</script>
```

**gotcha**: CSPに`'strict-dynamic'`があれば、初期HTMLレスポンスに存在する`<script>`にだけnonceを付ければよい。動的に追加されたスクリプトは、信頼済みスクリプトが読み込む限り実行が許される。

hashベースの場合、外部スクリプトは**インラインスクリプト経由で動的に読み込む**必要がある（CSPハッシュはブラウザ横断ではインラインのみサポートされるため）。

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

このインラインのSHA-256ハッシュは https://strict-csp-codelab.glitch.me/csp_sha256_util.html で計算できる。

上のスニペットのコメントや細部には、動作を理解するうえで大事な点が詰まっている。原文の補足を噛み砕くと次のとおり。

- `s.async = false`は、（barが先にダウンロードされても）fooをbarより先に実行させ、**実行順序を保つ**ための指定である。
- ただし**このスニペットでは`s.async = false`はスクリプト読み込み中にパーサーをブロックしない**。スクリプトが動的に追加されているためで、パーサーは`async`スクリプトと同様、スクリプトが実行されるときにのみ止まる。
- そのため片方または両方のスクリプトが**ドキュメントのダウンロード完了前に実行される可能性がある**。実行時にDOMが準備済みであってほしければ、appendする前に`DOMContentLoaded`イベントを待つ。それがパフォーマンス問題（ダウンロード開始が遅すぎる）を起こすなら、ページのより早い位置で**preloadタグ**を使う。
- **`<script>`に`defer = true`を付けても、この動的追加の書き方では何もしない**。deferの挙動が必要なら、実行したいタイミングで手動でスクリプトを走らせる必要がある。

### 8.3 Step 3: 非互換パターンのリファクタリング

インラインイベントハンドラと`javascript:` URIを`addEventListener`に置き換える。

ブロックされる → 許可される:

```html
<span onclick="doThings();">A thing.</span>
```

```html
<span id="things">A thing.</span>
<script nonce="${nonce}">
  document.getElementById('things')
          .addEventListener('click', doThings);
</script>
```

`eval()`は`JSON.parse()`にリファクタリングする（そちらの方が速い）。取り除けない場合は`'unsafe-eval'`が必要になるが、ポリシーの安全性はわずかに落ちる。

### 8.4 Step 4（任意）: 古いブラウザ向けフォールバック

strict CSPはすべてのモダンブラウザエンジンでサポートされるので、古いブラウザを支える必要がなければフォールバックは不要。必要なら次を足す。

```text
Content-Security-Policy:
  script-src 'nonce-{random}' 'strict-dynamic' https: 'unsafe-inline';
  object-src 'none';
  base-uri 'none';
```

`https:`は古いSafari向け、`'unsafe-inline'`は非常に古いブラウザ向けのフォールバックである。重要なのは、**`strict-dynamic`をサポートするモダンブラウザは`https:`と`'unsafe-inline'`を無視する**ので、ポリシーの安全性は下がらない、という点。

### 8.5 Step 5: 展開

1. まず`Content-Security-Policy-Report-Only`でreport-onlyモード展開（何も壊さずに違反を観測）。
2. 破壊がないと確信できたら`Content-Security-Policy`で強制展開。**ここで初めてCSPがXSSから保護し始める**。

展開時のgotcha: 使っているCSPが本当に"strict"かを**CSP Evaluator（https://csp-evaluator.withgoogle.com ）またはLighthouse**で確認する。ポリシーのわずかな変更でもセキュリティが大幅に下がりうる。本番では拡張やマルウェア由来のノイズが違反レポートに混じる点にも注意。

**Lighthouseの使い方（補足）**: このプロセス全体を通じて、**Lighthouse（v7.3.0以上）**の**Best Practices監査**を使うと、サイトにCSPがあるか、そしてXSSに対して有効なほどstrictかを確認できる。実験的なCSP監査を有効にするには`--preset=experimental`フラグを付けて実行する。CSPが未設定・非強制の場合、レポートには「no CSP is found in enforcement mode（強制モードのCSPが見つからない）」のような警告が出る。診断でもこの監査は「対象サイトがReport-Onlyのまま放置していないか」を素早く見る手掛かりになる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: web.dev「Mitigate cross-site scripting (XSS) with a strict Content Security Policy (CSP)」 — https://web.dev/strict-csp/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: web.devのegress制限で403拒否）。内容は原稿Markdown（`date: 2021-03-15 / updated: 2023-06-10`, 著者lwe）から取得した要約である。
> **読みどころ**:
> 1. strict CSP導入の5ステップとExpressのnonce生成コード。
> 2. Safari/古いブラウザ向けフォールバック（`https:`と`'unsafe-inline'`）の正確な意味。
> 3. **Limitations節**（strict CSPでも守れない5パターン）。診断者はここを暗記すべき。
> **代替手段**: 根拠論文 "CSP Is Dead, Long Live CSP!"（https://research.google/pubs/pub45542/ ）と、ポリシー評価ツール https://csp-evaluator.withgoogle.com/ 。

---

## 9. 違反レポート — どこにXSSの穴があるか教えてもらう

CSPがクライアント側でリソースをブロックできるのは大きいが、そもそも注入を許したバグを潰すには、サーバー側へ違反を通知してもらうと役立つ。`report-uri`（または`report-to`）で指定した場所へ、ブラウザがJSONの違反レポートを`POST`する。

```http
Content-Security-Policy: default-src 'self'; ...; report-uri /my_amazing_csp_report_parser;
```

レポートの中身（逐語）:

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

| キー | 意味 |
|---|---|
| `document-uri` | 違反が起きたページ |
| `referrer` | そのページのreferrer（**綴りに注意**: HTTPヘッダの`Referer`はrが1つだが、このキーは正しく`referrer`） |
| `blocked-uri` | ポリシーに違反したリソース |
| `violated-directive` | 違反された具体的なディレクティブ |
| `original-policy` | ページの完全なポリシー |

Report-Onlyモード（`Content-Security-Policy-Report-Only`）でこのレポートだけを集めると、強制する前にアプリの現状を評価できる。強制ポリシーと同時に走らせて、新ポリシーの影響を監視するのが定石である。

---

## 10. strict CSPのLimitations — 「守れない穴」を暗記する

strict CSPは強力だが万能ではない。web.dev/strict-cspの**Limitations節**は、strict CSPでも守れないケースを挙げている。ここは診断・コードレビューで最重要のチェックリストである。

- **nonceを付けたスクリプトの`<script>`要素のbody内、または`src`パラメータに直接注入がある場合。** nonceは「この要素は信頼」と言うだけで、その中身に注入があれば実行される。
- **動的に作られるスクリプト（`document.createElement('script')`）の位置に注入がある場合。** 引数からscript DOMノードを作るライブラリ関数も対象。具体的には**jQueryの`.html()`**、**jQuery < 3.0の`.get()`と`.post()`**が該当。
- **旧AngularJSアプリでテンプレート注入がある場合。** AngularJSテンプレートを注入できれば任意JS実行に至る。
- **ポリシーが`'unsafe-eval'`を含む場合**の`eval()`・`setTimeout()`等への注入。
- コードレビューとセキュリティ監査でこれらのパターンに特に注意を払う。

原文は結びとして「**Trusted Typesはstrict CSPを非常によく補完し、これらの制約の一部を効率的に守れる**」と述べている。次節につながる。

---

## 11. Trusted Types — DOM XSSの残存リスクを埋める

### 11.1 DOM-based XSSとsource/sink

**DOM-based XSS（DOM XSS）**とは、ユーザーが制御する*source*（ユーザー名やURLフラグメントなど）のデータが、任意のJavaScriptを実行できる*sink*（`eval()`のような関数や`.innerHTML`のようなプロパティセッタ）に到達したときに起きる脆弱性のこと。最も一般的なWeb脆弱性の1つで、アプリに持ち込みやすい。

前節で見たとおり、strict CSPでもDOM XSSは残ることがある。これを埋めるのが`require-trusted-types-for 'script'`（Trusted Types）である。Trusted TypesはChrome 83でサポートされ、他ブラウザ向けにpolyfillがある。

### 11.2 Trusted Typesがロックダウンするsink一覧

Trusted Typesは、危険なWeb API（sink）を「素の文字列では呼べない」ようにすることで機能する。ロックダウン対象の一覧を示す。

| カテゴリ | sink（逐語） |
|---|---|
| Script manipulation | `<script src>`、および`<script>`要素のtext content設定 |
| Generating HTML from a string | `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `<iframe> srcdoc`, `document.write`, `document.writeln`, `DOMParser.parseFromString` |
| Executing plugin content | `<embed src>`, `<object data>`, `<object codebase>` |
| Runtime JavaScript code compilation | `eval`, `setTimeout`, `setInterval`, `new Function()` |

Trusted Types有効時、これらに素の文字列を渡すとブラウザは*TypeError*を投げる。

```javascript
anElement.innerHTML  = location.href;   // TypeError（worse）
anElement.innerHTML = aTrustedHTML;     // Trusted Typeオブジェクトなら通る（better）
```

`TrustedHTML`のほか、`TrustedScript`・`TrustedScriptURL`がある。

### 11.3 展開手順

#### 準備: 違反レポートを受け取れるようにする

report-onlyヘッダを付ける前に、まず**違反レポートをどこで受けるか**を用意しておく。web.dev原文が挙げる選択肢は次のとおり。

- オープンソースのレポートコレクタ**go-csp-collector**（https://github.com/jacobbednarz/go-csp-collector ）を立てるか、商用の同等品を使う。
- 手早く様子を見たいなら、**ブラウザ内で違反イベントを直接ログに出す**方法もある。次の1行をページに入れておくと、Trusted Types違反を含むCSP違反がコンソールに出る。

```js
document.addEventListener('securitypolicyviolation',
    console.error.bind(console));
```

〔補足〕`securitypolicyviolation`イベントは、Trusted Typesに限らずCSP違反全般で発火する。診断で「このページは何をブロックしているか」を手元でざっと観察するのにも使える。

なお、DOM XSSにつながる怪しいsink利用の多くは、実行前に**静的リンタ**でも見つけられる。web.dev原文は`eslint-plugin-no-unsanitized`（https://github.com/mozilla/eslint-plugin-no-unsanitized ）をコードベースに走らせることを勧めている。ただし**CSP違反レポートも併せて分析すべき**である。理由は、リンタが拾えるのは静的に見えるコードだけなのに対し、CSP違反は**非準拠のコードが実際に実行されたときにトリガーされる**ため、動的に組み立てられる危険な経路を実行時に捕捉できるからである。

#### report-onlyで観測 → 強制へ

準備ができたら、まずreport-onlyで導入し、動作を止めずに違反を集める。

```text
Content-Security-Policy-Report-Only: require-trusted-types-for 'script'; report-uri //my-csp-endpoint.example
```

Trusted TypesはHTTPSや`localhost`のようなsecure contextでのみ利用可能である点に注意。違反が起きると、コードのどこがDOM XSSを持ち込んでいるかを示すレポートが届く（逐語）。

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

§9のCSP違反レポートと同じく、主要なキーの意味を押さえておくと、届いたレポートから「コードのどこがDOM XSSを持ち込んでいるか」を素早く特定できる。

| キー | 意味 |
|---|---|
| `violated-directive` | 違反されたディレクティブ。ここでは`require-trusted-types-for`。 |
| `disposition` | 適用モード。`report`ならreport-only（観測中で未ブロック）、`enforce`なら強制（実際にブロックした）。 |
| `blocked-uri` | 何がブロックされたか。Trusted Types違反では`trusted-types-sink`という特別な値になり、「危険なsinkに素の文字列が渡された」ことを表す。 |
| `line-number` / `column-number` | 違反を起こしたコードの行・桁。 |
| `source-file` | 違反を起こしたスクリプトファイルのURL。 |
| `script-sample` | 問題の入力の断片（例: `Element innerHTML <img src=x`）。どんなペイロードがsinkに渡ったかの手掛かり。 |

〔補足〕`disposition`が`report`のままなら、それは**まだ何もブロックしていない**（fail open）という意味である。§2の`Content-Security-Policy-Report-Only`と同じく、防御として数えるには強制モードへ切り替える必要がある。

違反を全部潰したら強制へ切り替える。

```text
Content-Security-Policy: require-trusted-types-for 'script'; report-uri //my-csp-endpoint.example
```

これで、アプリがどれほど複雑でも、DOM XSSを持ち込みうるのは**ポリシーの中のコードだけ**に絞られる。

### 11.4 違反の直し方 — 4つの選択肢

1. **コードを書き換える**: `el.innerHTML = '<img src=xyz.jpg>'`を`createElement`＋`appendChild`に直す。
2. **ライブラリを使う**: DOMPurifyでサニタイズ。`el.innerHTML = DOMPurify.sanitize(html, {RETURN_TRUSTED_TYPE: true});`。ただしDOMPurifyのロジックにバグがあれば依然XSSが残りうる。
3. **Trusted Typeポリシーを作る**: `trustedTypes.createPolicy()`でファクトリを定義する。

```javascript
if (window.trustedTypes && trustedTypes.createPolicy) { // Feature testing
  const escapeHTMLPolicy = trustedTypes.createPolicy('myEscapePolicy', {
    createHTML: string => string.replace(/\</g, '&lt;')
  });
}
```

4. **デフォルトポリシーを使う**: 第三者ライブラリなどコードを変えられない場合の最終手段。ただし控えめに使い、通常のポリシーへのリファクタリングを優先する。

〔補足〕Trusted Typesの詳細な展開手順とsink表は、DOM XSSの節（ch03）で改めて扱う。ここではstrict CSPを補完する存在として押さえておけばよい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: web.dev「Prevent DOM-based cross-site scripting vulnerabilities with Trusted Types」 — https://web.dev/trusted-types/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: web.devのegress制限で403拒否）。内容は原稿Markdown（`date: 2020-03-25`, 著者koto）から取得した要約である。
> **読みどころ**:
> 1. `require-trusted-types-for 'script'`の展開手順（report-only → enforce）。
> 2. DOM XSS sinkの完全表。DOM XSSのsource/sink表の原典として使える。
> 3. 4つの違反修正パターン（書き換え / DOMPurify / ポリシー / デフォルトポリシー）とそれぞれのcaution。
> **代替手段**: Trusted Types仕様ドラフト（https://w3c.github.io/trusted-types/dist/spec/ ）、DOMPurify（https://github.com/cure53/DOMPurify ）。

---

## 12. 診断・バグバウンティ観点の整理

〔補足〕以下は上記4本の原典の事実を「CSPの評価手順」として並べ替えたものである（新しい事実の追加ではない）。**許可された診断・バグバウンティ・自分で立てた検証環境**を前提に使う。CSPは防御の話でもあるので、各項目は「攻撃者が突く点」と「守り方」を対にして読む。

1. **ヘッダを確認する**: `Content-Security-Policy`か`-Report-Only`か。後者は**fail open（＝違反を検知しても止めない・防御としては開いたまま）**なのでXSS緩和として数えない。`<meta>`配信なら`frame-ancestors`/`sandbox`/レポート系が効かない。
2. **`script-src`（なければ`default-src`）を見る**: `'unsafe-inline'`があり（かつnonce/hashがなければ）インライン注入で即実行。`'unsafe-eval'`があれば`eval()`/`setTimeout(string)`/`new Function()`経路が開く。
3. **nonce/hashの有無と品質**: nonceが毎レスポンスで変わるか（同一値の再利用は無価値）。推測不能な長さ・生成方法か（推奨は128bit以上・Base64）。
4. **許可リスト型かどうか**: ホスト名列挙型は「ほとんどの構成でバイパス可能」（pub45542）。`csp-evaluator.withgoogle.com`やLighthouse Best Practicesで評価する。
5. **`object-src`と`base-uri`**: strict CSPの必須2点。`object-src`未制限ならプラグイン経由、`base-uri`未制限なら`<base>`注入で相対URLスクリプトの読み込み先を奪える。これらは`default-src`にフォールバックしないものがある。
6. **`form-action`/`frame-ancestors`**: フィッシングフォーム注入とクリックジャッキング/xs-leaksの防御。どちらも`default-src`にフォールバックしないので、未設定なら「何でも許す」。
7. **`strict-dynamic`の有無**: あれば動的生成スクリプトが信頼される。逆に`document.createElement('script')`の`src`に注入できる箇所（jQuery `.html()`、jQuery<3.0の`.get()`/`.post()`）が残ればstrict CSPでも実行に至る。
8. **`require-trusted-types-for 'script'`の有無**: なければDOM XSS sinkは素の文字列を受け付ける。あっても`default`ポリシーが雑ならバイパスの余地。
9. **ディレクティブの重複**: 同じディレクティブを2回書くと2つ目は無視される。見た目と実効値がずれる典型。
10. **各ディレクティブは`default-src`を完全に上書きする**: `default-src https:`があっても`script-src`を別に書けばそこに`https:`は継承されない。

---

## 手を動かす

1. **自分のブラウザで現状のCSPを見る**: 任意のサイトを開き、DevToolsの「Network」タブでトップドキュメントのレスポンスを選び、Response Headersに`Content-Security-Policy`があるか確認する。無ければそのサイトはCSP未導入である。
2. **違反を体験する**: ローカルに簡単なHTMLを置き、レスポンスヘッダ（またはmetaタグ）で`Content-Security-Policy: script-src 'self'`を設定する。次にページ内に`<script>alert(1)</script>`を書いて再読み込みし、Consoleに`Refused to execute inline script...`が出てブロックされることを確認する。
3. **hashを取得する**: 手順2のインラインスクリプトについて、Consoleの違反メッセージに含まれる`'sha256-...'`をコピーし、`script-src 'sha256-...'`に足すと実行が通ることを確認する。空白を1つ足すとまた壊れることも試す。
4. **nonceを試す**: `script-src 'nonce-abc123'`を設定し、`<script nonce="abc123">alert(1)</script>`が通ること、`nonce`属性を消すとブロックされることを確認する。
5. **CSP Evaluatorにかける**: 手元のポリシー文字列を https://csp-evaluator.withgoogle.com/ に貼り、`'unsafe-inline'`や許可リスト型の弱点が指摘されるのを見る。
6. **Report-Onlyで観測する**: `Content-Security-Policy-Report-Only`に切り替え、`report-uri`を自分の受信エンドポイント（ローカルの簡易サーバ）に向け、違反レポートJSONの`blocked-uri`や`violated-directive`を実際に受け取る。

## つまずきポイント

- **キーワードのクォート忘れ**: `script-src self`はクォート無しだと「selfという名のホスト」の意味になり、現在のホストを許可しない。`'self'`と書く。
- **`default-src`を過信する**: `base-uri`・`form-action`・`frame-ancestors`・`sandbox`・`plugin-types`・`report-uri`は`default-src`にフォールバックしない。`default-src 'none'`でも別途書かないと無防備。
- **Report-Onlyを防御と勘違いする**: Report-Onlyは何もブロックしない。XSS緩和として数えてはいけない。
- **nonceの使い回し**: 全レスポンスで同じnonceを使うと、攻撃者が注入スクリプトに同じnonceを付けられて無意味になる。毎レスポンス新規生成が必須。
- **全scriptを機械的にnonce化する**: 「全`<script>`タグにnonceを付けるミドルウェア」を作ると、攻撃者が注入したスクリプトにもnonceが付いてしまう。実際のテンプレートエンジンでレンダリング時に付ける。
- **hashと空白**: `<script>`の中身の空白・改行・大文字小文字が1文字でも変わるとハッシュが変わり動かなくなる。フォーマッタに注意。
- **strict CSP＝完璧という誤解**: nonce付きスクリプトの中身への注入、`createElement('script')`の位置への注入、旧AngularJSテンプレート注入、`'unsafe-eval'`下の`eval`は残る。Trusted Typesで補う。
- **`X-`プレフィクスヘッダ**: `X-Content-Security-Policy`/`X-WebKit-CSP`はobsoleteで使ってはならない。
- **ディレクティブの二重指定**: 同じディレクティブを2回書くと2つ目は無視される。1つにまとめる。

## この節のまとめ

- CSPは同一オリジンポリシーだけでは防げないXSSに対する**多層防御の第二層**であり、`Content-Security-Policy`ヘッダで「何を読み込み・実行してよいか」をブラウザに宣言する。
- 配信は3方法。`Content-Security-Policy`（推奨・全機能）、`-Report-Only`（非強制・観測用）、`<meta>`（`frame-ancestors`/`sandbox`/レポート系は不可）。`X-`プレフィクス版は使わない。
- ソース文法はスキーム・ホスト名・完全修飾の3形。ワイルドカードは最左位置のみ。`*://*.example.com:*`は`example.com`自身にマッチしない。キーワードはシングルクォート必須。
- ディレクティブはFetch/Document/Navigation/Reportingの4分類。未設定ディレクティブは既定で全開。`default-src`は多くをフォールバックするが、`base-uri`・`form-action`・`frame-ancestors`等はフォールバックしない。
- インラインスクリプト・インラインイベントハンドラ・`javascript:` URL・`eval`系はCSP既定で全面禁止。これがCSP最大のセキュリティ上の勝利。
- 例外を作るにはnonce（毎レスポンス再生成・推測不能・128bit以上・Base64）かhash（`sha256-`等、`<script>`タグは含めない、空白・大小が効く）を使う。
- 許可リスト型CSPは「ほとんどの構成でバイパス可能」で実効性が低い。現在の推奨は**strict CSP**（nonce/hash + `'strict-dynamic'` + `object-src 'none'` + `base-uri 'none'`）。
- 導入はReport-Onlyで観測 → 違反修正 → 強制の5ステップ。CSP EvaluatorやLighthouseでstrictさを確認する。
- 違反は`report-uri`（deprecated）/`report-to`（現行）でJSONレポートとして収集する。`document-uri`/`referrer`/`blocked-uri`/`violated-directive`/`original-policy`が入る。
- strict CSPでも守れない残存リスク（nonce付きスクリプト中身への注入、`createElement('script')`、jQuery `.html()`、旧AngularJS、`'unsafe-eval'`）があり、`require-trusted-types-for 'script'`（Trusted Types）で補う。
- 診断では、ヘッダ種別・`'unsafe-inline'`/`'unsafe-eval'`・nonce品質・許可リスト型か・`object-src`/`base-uri`・`form-action`/`frame-ancestors`・`strict-dynamic`・Trusted Types・重複指定・上書き挙動の10点を順に見る。

## 理解度チェック

1. CSPはXSSそのものを「なくす」技術か。
   ▶ 答え: いいえ。CSPは脆弱性を含むこと自体は防げない。攻撃者がその脆弱性を悪用するのを著しく困難にする「第二層（多層防御）」であり、入力サニタイズなどの上に重ねて使う。

2. `script-src self`と`script-src 'self'`の違いは。
   ▶ 答え: クォート無しの`self`は「`self`という名前のホスト」を許可する意味になり、現在のホストを許可しない。現在のオリジンを許可したいなら必ず`'self'`とクォートを付ける。

3. `*://*.example.com:*`は`example.com`自身にマッチするか。
   ▶ 答え: しない。このワイルドカード指定は全サブドメインにマッチするが、`example.com`本体にはマッチしない。逆に、サブドメインを1つでも攻撃者が握れば突破される。

4. `default-src 'none'`と書けばフォームの送信先やフレーム埋め込みも制限されるか。
   ▶ 答え: されない。`form-action`・`frame-ancestors`・`base-uri`・`sandbox`・`plugin-types`・`report-uri`は`default-src`にフォールバックしないので、個別に指定しないと無防備。

5. なぜ「全`<script>`タグにnonceを付けるミドルウェア」を作ってはいけないのか。
   ▶ 答え: 攻撃者が注入したスクリプトにもnonceが付いてしまい、nonceが意味をなさなくなるから。実際のテンプレートエンジンでレンダリング時に、開発者が意図したタグにだけ付ける。

6. hashベースCSPで、動くはずのスクリプトが急に動かなくなった。よくある原因は。
   ▶ 答え: `<script>`の中身の空白・改行・大文字小文字が変わったこと。フォーマットしただけでもハッシュが変わり、ポリシーの`sha256-...`と一致しなくなる。

7. 許可リスト型CSPとstrict CSPはどちらが推奨で、なぜか。
   ▶ 答え: strict CSP。許可リスト型は多くのカスタマイズが必要でほとんどの構成でバイパス可能（Google論文pub45542が実証）。strict CSPはnonce/hash + `strict-dynamic` + `object-src 'none'` + `base-uri 'none'`で、URL許可リストに依存せず常に同じ構造。

8. strict CSPを入れても残るDOM XSSリスクを1つ挙げ、その対策を述べよ。
   ▶ 答え: 例として、nonce付きスクリプトの`src`や中身への注入、`document.createElement('script')`の位置への注入（jQuery `.html()`など）。対策は`require-trusted-types-for 'script'`（Trusted Types）で危険なsinkを素の文字列で呼べなくすること。

9. CSPの違反レポートJSONで、綴りに注意すべきキーは。
   ▶ 答え: `referrer`。HTTPヘッダの`Referer`はrが1つだが、レポートのキーは正しく`referrer`（rが2つ）で綴られている。

10. 診断で対象サイトのCSPが`Content-Security-Policy-Report-Only`だけだった。XSS緩和として数えてよいか。
    ▶ 答え: 数えてはいけない。Report-Onlyは違反を報告するだけで何もブロックしない（fail open）。実際に守るには`Content-Security-Policy`（強制モード）が必要。

## 出典

- https://web.dev/articles/csp
- https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- https://web.dev/strict-csp/
- https://web.dev/trusted-types/
- https://research.google/pubs/pub45542/
- https://csp-evaluator.withgoogle.com/
- https://www.w3.org/TR/CSP3/
- https://w3c.github.io/webappsec-csp/#strict-dynamic-usage
- https://strict-csp-codelab.glitch.me/csp_sha256_util.html
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
- https://report-uri.com/home/hash
- https://github.com/cure53/DOMPurify
- https://blog.twitter.com/engineering/en_us/a/2011/improving-browser-security-with-csp.html
- https://docs.angularjs.org/api/ng/directive/ngCsp
- https://django-csp.readthedocs.io/en/latest/nonce.html
- https://github.com/jacobbednarz/go-csp-collector
- https://github.com/mozilla/eslint-plugin-no-unsanitized

<!-- sources: https://web.dev/articles/csp, https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html, https://web.dev/strict-csp/, https://web.dev/trusted-types/, https://research.google/pubs/pub45542/, https://csp-evaluator.withgoogle.com/, https://www.w3.org/TR/CSP3/, https://blog.twitter.com/engineering/en_us/a/2011/improving-browser-security-with-csp.html -->
<!-- terms: コンテンツセキュリティポリシー（CSP）, 同一オリジンポリシー（SOP）, XSS, stored XSS, reflected XSS, DOM-based XSS, 多層防御（defense in depth）, ソース許可リスト（allowlist）, ディレクティブ, default-src, script-src, object-src, base-uri, frame-ancestors, form-action, plugin-types, child-src, font-src, unsafe-inline, unsafe-eval, nonce, hash, strict-dynamic, strict CSP, Content-Security-Policy-Report-Only, fail open, report-uri, report-to, Trusted Types, require-trusted-types-for, sink, source, Subresource Integrity（SRI）, クロスサイトリーク（xs-leaks）, CSP Evaluator, Lighthouse, DOMPurify, go-csp-collector, eslint-plugin-no-unsanitized, ng-csp -->

<!-- self-read: https://web.dev/articles/csp | サイト側egress制限で403拒否・原稿Markdownからの二次情報ベース -->
<!-- self-read: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html | サイト側egress制限で403拒否・原稿Markdownからの二次情報ベース -->
<!-- self-read: https://web.dev/strict-csp/ | サイト側egress制限で403拒否・原稿Markdownからの二次情報ベース -->
<!-- self-read: https://web.dev/trusted-types/ | サイト側egress制限で403拒否・原稿Markdownからの二次情報ベース -->
<!-- self-read: https://blog.twitter.com/engineering/en_us/a/2011/improving-browser-security-with-csp.html | 外部サイトで未取得・web.dev原稿の言及ベース -->
