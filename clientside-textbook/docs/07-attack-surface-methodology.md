# 第7章 クライアントサイド攻撃面のマッピングと方法論


## DOM-based脆弱性のsource/sink体系

DOM-based脆弱性は、サーバーサイドのコードやレスポンスを一切変更せずとも、クライアント側のJavaScriptだけで成立する脆弱性群である。反射型/格納型XSSがサーバー側テンプレートやレスポンス生成の欠陥であるのに対し、DOM-basedはブラウザ内で実行されるJavaScriptが「攻撃者が制御できるデータ」を「危険な処理に渡してしまう」ことで発生する。この章では、その根幹をなす「source（入力源）」と「sink（危険な代入先）」という2つの概念を体系的に整理する。この分類は本章以降、DOM XSS・postMessage脆弱性・DOM clobbering・プロトタイプ汚染などクライアントサイド全般を横断して使う共通言語になる。

### source と sink という考え方

**source（ソース）** とは、「攻撃者が値をコントロールできる可能性のあるJavaScriptのプロパティやAPI」を指す。典型例は `location.search`（URLのクエリ文字列）で、攻撃者はリンクを作って被害者に踏ませるだけでこの値を自由に書き換えられる。

**sink（シンク）** とは、「攻撃者に制御されたデータが渡されると、望ましくない挙動（コード実行、リダイレクト、情報漏洩など）を引き起こしうる、危険なJavaScript関数やDOMオブジェクトへの代入先」を指す。典型例は `eval()` や `document.body.innerHTML` である。

> 出典: DOM-based vulnerabilities — https://portswigger.net/web-security/dom-based

PortSwiggerの定義を借りれば、DOM-based脆弱性は「ウェブサイトがsourceからsinkへとデータを渡し、そのsinkがクライアントのセッションのコンテキストで安全でない方法でデータを処理してしまう」ときに発生する。つまり脆弱性の本質は「入力そのもの」でも「出力そのもの」でもなく、**入力から出力へのデータフロー（source → sink の経路）** にある。この考え方は静的解析ツール（taint解析）の設計原理そのものであり、手動で脆弱性を探す際にも「まずsinkを見つけ、そこに流れ込むデータを逆算してsourceを探す」というテイント解析的な思考法が最も効率的である。

なぜこの分離が重要かというと、同じsinkでも「どのsourceからデータが来ているか」によって攻撃可能性が変わり、同じsourceでも「どのsinkに流れるか」によって発生する脆弱性の種類（XSS、オープンリダイレクト、Cookie操作など）が変わるからである。source/sinkのマトリクスで考えることで、コードレビューやブラックボックス診断の際に「見るべき場所」を体系的に絞り込める。

### 代表的なsource一覧

以下はクライアントサイドの診断で必ず確認すべき代表的なsourceである。いずれも「ユーザーの操作」「URL」「ネットワークからの受信データ」「ブラウザのストレージ」のいずれかに由来し、多くの場合ページの読み込み元URLや被害者のブラウザ状態を通じて攻撃者が値を注入できる。

- `location`（および `location.href` / `location.search` / `location.hash` / `location.pathname`）— URL全体やクエリ文字列、フラグメント識別子。特に `location.hash` はサーバーへ送信されないため、サーバーサイドのログや WAF では検知できない点が重要。
- `document.URL`、`document.documentURI`、`document.baseURI` — 現在のページURLを別の形式で取得するプロパティ群。
- `document.referrer` — 遷移元ページのURL。攻撃者が用意したページからリンクを踏ませれば任意の値を注入できる。
- `window.name` — ウィンドウ間で永続化される文字列プロパティ。同一タブ内でナビゲーションをまたいでも値が保持されるため、`window.open()` で開いた別オリジンのページから設定した値をトップページのJSが読み取ってしまう、といった経路が生まれる。
- `document.cookie` — Cookieの値。サーバーが発行したCookieだけでなく、同一サイトの別ページやサブドメインから書き込まれた値が読み込まれることもある。
- `localStorage` / `sessionStorage` / `IndexedDB` — Web Storage API。XSSの永続化や、同一オリジンの別ページが書き込んだ値の読み出しに使われる。
- 反射データ・格納データ（reflected / stored data）— Ajaxレスポンスやサーバーが返すJSON中の値など、サーバーを経由して戻ってくるユーザー入力。
- Web message（`message` イベントの `event.data`）— `postMessage()` によって別ウィンドウ・別iframeから送られてくるデータ。本章後半で詳しく扱う。

> 出典: DOM-based vulnerabilities — https://portswigger.net/web-security/dom-based

### 代表的なsinkの分類とコード例

sinkは「何が起きるか」で分類すると理解しやすい。PortSwiggerの分類に沿って整理すると次のようになる。

| 脆弱性の種類 | 代表的なsink | 概要 |
|---|---|---|
| DOM XSS | `document.write()`、`.innerHTML`、`eval()` | HTMLやJavaScriptとして解釈される文脈にデータが渡り、任意コードが実行される |
| オープンリダイレクト | `window.location`、`location.href` | 攻撃者が指定した任意サイトへ遷移させられる |
| Cookie操作 | `document.cookie` | セッション固定化などに悪用されうる |
| JavaScript injection | `eval()`、`setTimeout()`（文字列引数）、`Function()` | 文字列がそのままJavaScriptとして実行される |
| WebSocket URL汚染 | `WebSocket()` のコンストラクタ引数 | 通信先を攻撃者のサーバーに向けられる |
| リンク操作 | `<a>` タグの `href` 属性など | フィッシングサイトへの誘導 |
| Ajaxリクエストヘッダ操作 | `XMLHttpRequest.setRequestHeader()` | HTTPヘッダインジェクションに近い挙動 |
| クライアントサイドSQLインジェクション | `executeSql()`（Web SQL） | ローカルDBに対する不正クエリ |
| JSON injection | `JSON.parse()` | パース処理自体の脆弱性やプロトタイプ汚染の入口になりうる |

> 出典: DOM-based vulnerabilities — https://portswigger.net/web-security/dom-based

代表的なDOM XSSのコードパターンを示す。

```html
<!-- 脆弱なコード: location.search（source）が innerHTML（sink）にそのまま渡る -->
<script>
  var params = new URLSearchParams(location.search);
  var name = params.get('name');
  document.getElementById('greeting').innerHTML = 'こんにちは、' + name + 'さん';
</script>
```

このコードに対して `?name=<img src=x onerror=alert(document.domain)>` というURLでアクセスさせると、`innerHTML` に代入された文字列がHTMLとしてパースされ、`<img>` タグの `onerror` イベントハンドラがJavaScriptとして実行される。**なぜこうなるのか**という仕組みレベルの理由は、`innerHTML` への代入がブラウザのHTMLパーサーを再度呼び出し、代入された文字列を「信頼されたマークアップ」と同じ扱いでDOMツリーに構築し直すためである。テキストとして表示したいだけの文字列であっても、パーサーはそれをHTML構文として解釈してしまう。これはサーバーサイドのテンプレートエンジンにおける「未エスケープ出力」とまったく同じ構造の問題が、クライアント側のDOM構築処理で起きているのだと理解すると本質が掴みやすい。

同様に `eval()` に代入されるパターンも仕組みは同じで、ブラウザのJavaScriptエンジンが文字列をソースコードとして再パース・再実行するために起きる。

```javascript
// 脆弱なコード: location.hash がそのまま eval される
var expr = decodeURIComponent(location.hash.slice(1));
eval(expr); // location.hash="#alert(1)" で任意コード実行
```

`location.hash` は先述の通りサーバーへ送信されないため、サーバーサイドのログ監視やWAFのシグネチャベース検知をすり抜けやすいという特性がある。診断や脆弱性調査の際、URLフラグメントを軽視してはならない理由はここにある。

### DOM clobbering と client-side prototype pollutionとの関係

DOM-based脆弱性のsource/sink体系を理解する上で押さえておくべき隣接概念が2つある。

**DOM clobbering** は、HTML要素の `id` や `name` 属性を使って、JavaScript側が期待しているグローバル変数やオブジェクトのプロパティを、HTML要素そのもので「上書き（clobber）」してしまう手法である。例えば `document.getElementById` を使わず `window.config` のようなグローバル変数を直接参照しているコードに対し、攻撃者が `<img name="config">` のようなタグを注入できれば、`window.config` がその `<img>` 要素そのものに置き換わってしまう。これは新規のsourceというより「HTML注入がクライアントサイドの変数評価というsinkに影響する」経路であり、CSP等でスクリプト実行そのものは防がれていても、HTMLインジェクションだけで悪用可能な点が実務上重要である。

**client-side prototype pollution** は、`Object.prototype` にサーバーサイドと同様の手口で不正なプロパティを注入し、その後のコード内で意図しないプロパティ（例えば `isAdmin` や `innerHTML` にあたる設定値）が「存在する」ものとして扱われてしまう脆弱性である。DOM-basedの文脈では、`location.search` のクエリ文字列をライブラリの `merge()`/`extend()` 関数でオブジェクトに変換する処理などがsourceとなり、その結果汚染されたプロパティが後段でsink（`innerHTML`への代入やスクリプトタグの`src`設定など）に流れ込むことでXSSに発展する「ガジェットチェーン」を形成する。つまりprototype pollution単体は直接の実行にはつながらず、既存コード中の「汚染可能なsink的コードパス（ガジェット）」と組み合わさって初めて実害化する点が、通常のsource/sinkモデルとの違いである。

### 防御の原則

PortSwiggerが示す防御の基本方針は明快である。

> 出典: DOM-based vulnerabilities — https://portswigger.net/web-security/dom-based

第一に、**信頼できないsourceのデータを、そのままの形でsinkに渡さない**こと。可能であれば、ユーザー入力を危険なsinkに一切近づけない設計（`textContent` を使う、`innerHTML` の代わりにDOM APIで要素を組み立てる等）が最も確実である。

第二に、データフローを断てない場合は、**挿入先の文脈（HTML本文・属性値・JavaScript文字列・URLなど）に応じたエスケープ・サニタイズ・ホワイトリスト検証**を行う。文脈を誤ったエスケープ（例えばHTMLエスケープだけを行いJavaScript文字列コンテキストのエスケープを怠る）は防御として機能しないため、「どのsinkに、どういう文脈で入るか」を正確に特定した上でエスケープ方式を選ぶ必要がある。

第三に、CSP（Content Security Policy）のような多層防御はDOM XSSの被害範囲を縮小できるが、DOM clobberingのようにスクリプト実行を伴わない攻撃には効果が限定的である点に注意する。source/sinkの経路そのものを断つ設計判断が根本対策であり、CSPはあくまで保険的な位置づけと理解しておくべきである。

### postMessageにおけるsource/sinkの落とし穴

`window.postMessage()` は異なるオリジン間でメッセージをやり取りするための標準API（[HTML Living Standard, Web messaging](https://html.spec.whatwg.org/multipage/web-messaging.html)）であり、正しく使えば同一オリジンポリシーを迂回しつつ安全にクロスオリジン通信ができる。しかし受信側の実装ミスにより、`event.data`（前節のsource一覧における「Web message」）が危険なsinkへ直結してしまうケースが極めて多い。

基本的な送受信パターンは次の通りである。

```javascript
// 送信側（親ウィンドウやiframe）
targetWindow.postMessage(data, targetOrigin);

// 受信側
window.addEventListener("message", (event) => {
  // event.origin の検証が必須
  // event.data がsource、後続処理がsink
});
```

#### origin検証の欠如・誤り

受信側のハンドラは、まず送信元オリジン（`event.origin`）を検証するのが基本である。「これは受信データが機微な処理を駆動する場合には必須の確認事項である」（HackTricks原文の要旨）。ところが、この検証を文字列比較の甘い実装で済ませてしまう例が頻発する。

```javascript
// 脆弱な検証例1: indexOf() による部分一致チェック
if (event.origin.indexOf("https://app-sj17.marketo.com") === 0) {
  handleMessage(event.data);
}
```

一見厳格に見えるが、`"https://app-sj17.marketo.com.attacker.com"` のような文字列も `indexOf` が0番目からマッチしてしまえば通過してしまう。**なぜ危険か**というと、`indexOf()`は「その文字列がどこかに含まれているか」「先頭に一致するか」を見るだけであり、オリジンという「スキーム＋ホスト＋ポート」の厳密な構造を検証する仕組みではないためである。攻撃者は正規オリジンを部分文字列として含む任意のドメイン（`https://app-sj17.marketo.com.evil.com` のようなサブドメイン偽装）を取得すれば検証を通過できる。

```javascript
// 脆弱な検証例2: 正規表現のドット未エスケープ
if (/https:\/\/app-sj17\.marketo.com/.test(event.origin)) { // ".com" の "." がエスケープされていない
  handleMessage(event.data);
}
```

正規表現中の `.` はエスケープしない限り「任意の1文字」にマッチするワイルドカードとして解釈される。これにより `marketoXcom` のような偽ドメインや、意図しないサブドメイン構造もマッチしてしまう可能性がある。**仕組みレベルでの理由**は正規表現エンジンの仕様そのものであり、レビュー時には `.` が全てエスケープされているか、かつ `^`（先頭）`$`（末尾）でアンカーされているかを必ず確認する必要がある。

> 出典: PostMessage Vulnerabilities (HackTricks) — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html
> ⚠️ 上記2件のコード例および説明は、HackTricksの当該ページが直接取得できなかった（HTTPステータス 402 Payment Required によりブロック）ため、同プロジェクトのGitHubリポジトリのraw原本（`https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/postmessage-vulnerabilities/README.md`）から抽出した内容に基づく。

#### targetOrigin `'*'` の危険性

送信側で `postMessage(data, '*')` のように第二引数（targetOrigin）へワイルドカードを指定すると、送信時点のiframeの現在のオリジンがどこであっても無条件にメッセージが配送される。これ自体は「受信」側の脆弱性ではないが、**フレーミング攻撃と組み合わさることで深刻化する**。攻撃者は対象ページがフレーム化可能（`X-Frame-Options` や `frame-ancestors` の設定が無い、または緩い）であれば、そのページを自分のオリキンでiframeし、さらに子iframe（本来のメッセージ送信先）を攻撃者が制御するオリジンへナビゲートさせることができる。この状態で親から `postMessage(secret, '*')` が発火すると、本来送るはずだった正規の子ウィンドウではなく、攻撃者が用意したオリジンへ機密データが送信されてしまう。

**仕組み**としては、`postMessage` のtargetOriginはあくまで「送信時にメッセージを配送してよい相手のオリジン」を制限するものであり、`'*'` はこの制限を放棄することを意味する。加えてブラウザは、iframe要素自体の参照（`window`オブジェクトの参照）が有効である限り、そのiframeの「現在のドキュメントのオリジン」がナビゲーションによって変わっていても同じ`window`参照に対してメッセージを送り続ける。つまり開発者が想定した「最初にロードしたページのオリジン」と「実際にメッセージ送信時点でロードされているページのオリジン」は必ずしも一致しないという、ブラウザのナビゲーションモデルに起因する落とし穴である。

#### dataの検証不備とsinkへの直結

origin検証を正しく行っていたとしても、`event.data` の中身（構造・型・値）を検証せずに危険なsinkへ渡してしまえば、通常のDOM-based脆弱性と同じ構造の問題が発生する。

```javascript
// 脆弱なパターン: origin検証はあるが、data の中身を無検証でinnerHTMLへ
window.addEventListener("message", (e) => {
  if (e.origin !== "trusted.com") return;
  document.body.innerHTML = e.data; // origin=trusted.com が乗っ取られればXSSになる
});
```

> 出典: PostMessage Vulnerabilities (HackTricks) — https://hacktricks.wiki/en/pentesting-web/postmessage-vulnerabilities/index.html（GitHub raw原本より抽出）

このコードの本質的な弱点は、「origin検証さえ通せば安全」という誤った前提にある。**なぜ危険か**というと、`trusted.com` というオリジン自体にXSSやサブドメイン乗っ取りなどの別の脆弱性が存在すれば、攻撃者はそのオリジンから正規のポストメッセージを送信でき、origin検証を正しく実装していても防げないためである。HackTricksはこれを「trusted-originの脆弱性」として整理しており、埋め込んだサードパーティiframeにXSSが存在する場合、攻撃者は「リレーガジェット」を使って信頼済みオリジンからの正規メッセージを装うことができるとしている。したがって防御の本質は、origin検証に加えて **`event.data` の構造・型・値そのものを、danger sinkへ渡す直前に厳格に検証すること**であり、これはpostMessageもDOM XSSのsource/sink体系の一部にすぎないという、この章の主題を裏付ける事例になっている。

#### 防御策のまとめ

- **origin検証は完全一致（`===`）で行う**。`indexOf`・`includes`・末尾アンカーの無い正規表現・`endsWith`単体（サブドメイン偽装に弱い）は避ける。ホワイトリストに複数オリジンを許可する場合も配列に対する完全一致比較を用いる。
- **`event.source` も可能な範囲で検証する**。origin文字列だけでなく、期待するウィンドウ参照からのメッセージであることを確認する（すべてのケースで実装可能とは限らないが、リレー攻撃への追加の防御層になる）。
- **`event.isTrusted` に依存しない**。これはメッセージがユーザーやブラウザ自身の操作によって生成されたか（対 スクリプトによる合成）を示すプロパティであり、送信元オリジンの正当性を示すものではない。
- **`event.data` の構造を検証してからsinkへ渡す**。期待するスキーマ（型・必須フィールド・許容される値の範囲）と一致しない場合は処理を中断する。文字列であれば `JSON.parse` 前後でtry/catchし、想定外の型は拒否する。
- **danger sinkへの到達を避ける**。`innerHTML`ではなく`textContent`、`eval`系ではなくJSON専用パーサ、`location`系への代入では許可リストによる遷移先検証、といった対策をpostMessage経由のデータにも同様に適用する。
- **送信側は`targetOrigin`にワイルドカード`'*'`を使わず、意図する具体的なオリジンを明示する**。特に機密情報を送る通信では必須。

### まとめ

DOM-based脆弱性を理解する鍵は、「攻撃者がどこまで値を制御できるか（source）」と「その値がどこに渡ると危険か（sink）」を分けて考え、両者を結ぶデータフローを追跡することにある。`location`系・Cookie・Web Storage・`postMessage`の`event.data`といった代表的なsourceと、`innerHTML`・`eval`・`document.write`・`location`代入・`setRequestHeader`といった代表的なsinkの対応関係を頭に入れておけば、DOM clobberingやclient-side prototype pollution、postMessage脆弱性といった一見別々に見える脆弱性群も、すべて「source/sinkモデルの具体的な発現形」として統一的に理解できる。次節以降で扱うクライアントサイド攻撃面の具体的なマッピング手法も、この分類を土台として進める。

## postMessageハンドラの列挙と検証ロジック評価

クライアントサイド攻撃面のマッピングにおいて、`postMessage` の受信ハンドラは見落とされやすく、かつ高インパクトなDOM-based XSS・情報漏えいへ直結しやすい対象である。本節では、防御・診断の観点から「ページ内にどんな `message` 受信ハンドラが存在するか」を体系的に列挙する手法と、そのハンドラが行う**検証ロジック（origin 検証・型検証・値検証）が本当に堅牢か**を評価する方法を、仕組みのレベルで解説する。

> 本節はすべて防御・自己所有環境での診断を目的とする。実在サービスや本番環境への無許可検証、破壊的な手順は扱わない。以降のコード例は、いずれも自分で立てた検証用ページ（`http://localhost` など自己管理下のオリジン）で挙動を確認する前提とする。

### なぜ postMessage が攻撃面になるのか（前提の整理）

まず用語をかみ砕く。**オリジン（origin）**とは「スキーム + ホスト名 + ポート」の組（例: `https://app.example.com:443`）であり、ブラウザのセキュリティ境界の単位である。通常、あるオリジンのスクリプトは別オリジンの `document` や変数へアクセスできない。これが**同一オリジンポリシー（Same-Origin Policy, SOP）**である。

`window.postMessage()` は、この SOP を意図的に「安全に越える」ために用意された API で、あるウィンドウ（親ページ・別タブ・`iframe` など）から別のウィンドウへ、構造化データを非同期に送るための仕組みである。送信側の構文は次の通り。

```javascript
targetWindow.postMessage(message, targetOrigin, [transfer]);
```

- `targetWindow`: 送信先ウィンドウの参照（`iframe.contentWindow`、`window.opener`、`window.parent`、`window.open()` の戻り値など）。
- `message`: 送るデータ本体。構造化クローンアルゴリズムでコピーされるためオブジェクトも送れる。
- `targetOrigin`: 「このオリジンに向けてのみ配送してよい」という宛先指定。`"*"`（ワイルドカード）を指定すると**どのオリジンが受信側にいても送ってしまう**。
- `transfer`: 所有権を移譲する転送可能オブジェクト（`ArrayBuffer` など）。省略可。

受信側は `message` イベントを購読する。

```javascript
window.addEventListener("message", (event) => {
    // event.data   … 送られてきたデータ本体
    // event.origin … 送信元のオリジン（ブラウザが付与する、偽装不能な値）
    // event.source … 送信元ウィンドウの参照
});
```

ここで**攻撃面が生まれる本質的な理由**は2つある。

1. **`event.data` は攻撃者が完全に制御できる入力である。** 攻撃者が用意した任意のページを被害者に開かせ、そのページから被害者オリジンのウィンドウ（`iframe` に読み込んだり `window.open` で開いたり）へ `postMessage` を送れる。受信ハンドラが `event.data` を **sink（入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`・`eval`・`location.href`）** へ渡していれば、攻撃者はその値を操作してコード実行や画面改ざんを引き起こせる。
2. **`event.origin` の検証を書くのは開発者の責任であり、ブラウザは強制しない。** 受信ハンドラが origin を確認しない、あるいは緩い文字列マッチで確認していると、攻撃者オリジンからのメッセージが「信頼済み」として処理されてしまう。

つまり postMessage の脆弱性ハンティングは、突き詰めると「**どのハンドラが存在し（列挙）**」「**そのハンドラの origin 検証と値の扱いが正しいか（検証ロジック評価）**」の2軸に集約される。以降、この2軸を順に扱う。

> 出典: An Introduction to postMessage Vulnerabilities（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities

### 第1軸: message 受信ハンドラの列挙

ハンドラは「静的（ソースコードを読む）」と「動的（実行中のブラウザで観測する）」の両面から洗い出す。片方だけでは、難読化・遅延登録・サードパーティSDK内の登録などを取りこぼす。

#### 静的探索: ソースコード内のパターン検索

読み込まれるすべての JavaScript（インラインスクリプト、外部 `.js`、バンドル済みチャンク、サードパーティSDK）を対象に、次のパターンを検索する。

```text
addEventListener('message',      // 標準的な登録
addEventListener("message",
window.onmessage =                // プロパティ代入形式
.on("message", ...)              // jQuery など一部ライブラリの糖衣
postMessage(                      // 送信側。宛先や送信データの手がかりになる
```

見つけたハンドラでは、`event.data`（あるいは分割代入された `data`・`e.data`）が**どこへ流れるか**、つまりデータフローを追跡する。`event.data → 変数 → 関数引数 → sink` という経路の終端に危険な代入先がないかを確認するのが要点だ。

> 注意: 難読化・minify されたコードでは `addEventListener` の第1引数が変数化されていたり、`n.addEventListener(t,r)` のように短縮されていることがある。静的検索だけに頼らず、必ず動的探索を併用する。

#### 動的探索(1): DevTools の Global Listeners / Event Listener Breakpoints

Chrome/Chromium 系 DevTools では、実行中に登録済みハンドラを直接列挙できる。手順は次の通り（対象は自己管理下の検証ページ）。

1. DevTools を開く（F12）。
2. **Sources**（Debugger）タブを開く。
3. 右側パネルの **Global Listeners**（またはページ選択時の Event Listeners）を展開する。
4. `message` プロパティを展開すると、登録されている `message` ハンドラの一覧と、それぞれの登録元スクリプト位置（ファイル・行）が表示される。
5. さらに、**Event Listener Breakpoints** の中の `Window` → `message`（`DOMWindow.message`）にブレークポイントを設定すると、メッセージ受信のたびに実行が一時停止する。停止時点で `event.data`・`event.origin`・`event.source` の実際の値をスコープ上で確認でき、ハンドラがどの分岐をどう通るかをステップ実行で追える。

この「受信のたびに止めて中身を見る」やり方は、遅延登録される（例: SDK 読み込み後に登録される）ハンドラや、条件分岐で処理が分かれるハンドラの検証ロジックを、実物の値で観察できるため特に有用である。

#### 動的探索(2): addEventListener のモンキーパッチ（フック）

登録の瞬間そのものを捕捉したい場合は、`addEventListener` を自前の関数で包む（**モンキーパッチ**＝実行時に既存関数を差し替えて挙動を観測する手法）。検証ページのコンソールで、対象スクリプトが読み込まれる**前**に次を実行しておく。

```javascript
// 自己管理下の検証ページでのみ実行する観測用スニペット
const _orig = window.addEventListener;
window.addEventListener = function (type, listener, options) {
    if (type === "message") {
        console.log("[message listener registered]", listener.toString());
    }
    return _orig.call(this, type, listener, options);
};
```

これにより、`message` ハンドラが登録されるたびに**そのハンドラ関数のソース**（`listener.toString()`）がコンソールに出力される。難読化されていても関数本体が読めるため、origin 検証の有無や sink への流れを即座に確認できる。

同様に、送信側を観測したい場合は `window.postMessage`（および `iframe.contentWindow.postMessage`）を包み、どんなデータがどの `targetOrigin` へ送られているかを記録する。ワイルドカード `"*"` 送信の検出にはこれが直接役立つ。

#### 補助ツール

手作業の列挙を補助するツール群も知られている。用途を理解した上で使うとよい。

- **Burp Suite の DOM Invader**: ページ内の postMessage トラフィックを監視し、ハンドラを検出、XSS 観点での自動テストも行う。
- **postMessage-Tracker（Chrome 拡張）** / **PMHook（Tampermonkey ベースのロギング）**: すべての postMessage 通信を origin 付きでログする。
- **MessPostage / Posta**: メッセージの列挙・可視化・再送を支援する調査用ツール。
- **Untrusted Types 系拡張**: データが危険な sink まで流れる経路を追跡する。

> ツールはあくまで列挙とデータフロー可視化の補助であり、最終的な「検証ロジックが正しいか」の判断は人間が行う。ツールの検出結果を鵜呑みにせず、必ずハンドラのソースと実際の値で裏取りする。

> 出典: Exploiting PostMessage Vulnerabilities（Intigriti） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities

### 第2軸: 検証ロジックの評価

列挙したハンドラごとに、次の観点で検証ロジックを評価する。核心は「**origin 検証**」と「**`event.data` の扱い（型・値・sink）**」である。

#### パターンA: origin 検証が存在しない

最も基本的かつ危険なパターン。ハンドラが `event.origin` を一切確認せず、`event.data` を sink へ渡す。

```javascript
// 脆弱: origin 検証なし、data を location.href（sink）へ
window.addEventListener("message", function (event) {
    const data = event.data;
    location.href = data.redirect_url;
});
```

なぜ危険か。`location.href` は `javascript:` スキームの URL を代入されると、そのJavaScriptを現在のオリジンのコンテキストで実行し得る sink である。origin 検証がないため、攻撃者は任意ページから被害者ウィンドウへ次のように送るだけで成立する。

```javascript
// 攻撃者ページ側（原理説明用。検証は自己管理下のみ）
const targetFrame = document.getElementById('target');
targetFrame.contentWindow.postMessage({
    type: 'oauth_callback',
    success: true,
    token: 'sample token',
    return_url: 'javascript:alert(document.domain)'
}, '*');
```

同種の最小例として、`href` 属性を組み立てるだけでもXSSになり得る。

```javascript
// 脆弱: 受信側 2.html — origin 検証なしで href を組み立てる
window.addEventListener("message", (event) => {
    document.getElementById("redirection").href = `${event.data.url}`;
});
```

```html
<!-- 攻撃者ページ 3.html（原理説明用）: 脆弱ページを iframe に読み込み、値を注入 -->
<iframe id="frame" src="2.html"></iframe>
<script>
    let msg = { url: "javascript:prompt(1)" };
    var iFrame = document.getElementById("frame");
    iFrame.contentWindow.postMessage(msg, '*');
</script>
```

`event.data.url` が `javascript:prompt(1)` になり、その値が `<a>` の `href` に入る。リンクがクリック（またはプログラム的に発火）されると、`javascript:` URL が被害者オリジンで実行される。ここでの本質は「**origin 検証がないため攻撃者オリジンからの `event.data` を信頼してしまう**」点と、「**`href` という sink が `javascript:` を解釈してしまう**」点の掛け合わせである。評価時は、この2条件が同時に成立していないかを確認する。

> 出典: PostMessage Vulnerabilities Part I（Jorge Lajara） — https://jlajara.gitlab.io/Dom_XSS_PostMessage

#### パターンB: origin 検証が「緩い」文字列マッチ

origin 検証を書いてはいるが、比較方法が甘いケース。ここが**検証ロジック評価で最も差がつく**ポイントである。`indexOf`・`startsWith`・`includes`・アンカーのない正規表現は、いずれもバイパス可能な典型である。

```javascript
// 脆弱: 部分一致（indexOf）による検証 → 偽陽性
if (event.origin.indexOf('example.com') !== -1) {
    location.href = event.data.redirect_url;
}
```

なぜバイパスできるのか。`indexOf('example.com') !== -1` は「文字列 `example.com` を**どこかに含む**か」を見るだけである。したがって攻撃者は次のようなオリジンを用意すれば通過する。

- `https://example.com.attacker.io` … `example.com` を部分文字列として含む（サブドメイン風に見せた**攻撃者所有ドメイン**）。
- `https://attacker-example.com` … 同じく部分一致する。

同様に危険なパターンを整理する。

| 検証コード | バイパス例 | 理由 |
|---|---|---|
| `origin.indexOf('example.com') !== -1` | `https://example.com.attacker.io` | 部分文字列としてどこにでも含めばよい |
| `origin.startsWith('https://example.com')` | `https://example.com.attacker.io` | 先頭一致は「その後に続く任意文字列」を許す |
| `origin.endsWith('example.com')` | `https://attackerexample.com` | 末尾一致は境界（`.`）を見ない |
| `origin.includes('example.com')` | `https://example.com.evil.tld` | `indexOf` と同型 |
| `/^https:\/\/payments\.example\.com/` | `https://payments.example.com.attacker.io` | 末尾を `$` でアンカーしていない正規表現 |

正規表現の例をもう少し掘り下げる。`/^https:\/\/payments\.example\.com/` は「先頭が `https://payments.example.com`」だけを要求し、**末尾を固定していない**。よって `https://payments.example.com.attacker.io` は先頭部分が一致するため通過する。加えて、正規表現内で `.` をエスケープし忘れる（`payments.example.com` を `payments\.example\.com` にしていない）と、`.` が任意1文字にマッチし、`paymentsXexampleXcom` のようなドメインでも通ってしまう。評価時は「**アンカー（`^` と `$`）の有無**」と「**メタ文字のエスケープ**」を必ず確認する。

正しい実装は、部分一致ではなく**完全一致（厳密等価）**である。

```javascript
// 安全: 厳密等価で origin を検証
if (event.origin !== 'https://trusted-origin.com') {
    return; // 期待オリジン以外は即座に破棄
}
// ここから先で event.data を処理する
```

複数オリジンを許可する必要がある場合も、部分一致ではなく**許可リスト（allowlist）への完全一致包含**で判定する。

```javascript
// 安全: 許可リストへの完全一致
const ALLOWED = ["https://app.example.com", "https://admin.example.com"];
if (!ALLOWED.includes(event.origin)) return;
```

> 検証ロジック評価のチェックリスト:（1）`event.origin` を参照しているか、（2）比較は `===`/`!==` あるいは配列 `.includes(origin)` の**完全一致**か、（3）`indexOf`/`startsWith`/`endsWith`/アンカーなし正規表現を使っていないか、（4）`event.origin` ではなく `event.data` 内の自己申告フィールド（例: `data.sender`）で送信元を判断していないか（`event.data` は偽装自在なので送信元判定に使ってはならない）。

> 出典: Exploiting PostMessage Vulnerabilities（Intigriti） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities

#### パターンC: 送信側のワイルドカードによる情報漏えい

これまでは受信側の話だったが、**送信側**にも別種の脆弱性がある。`targetOrigin` に `"*"` を指定すると、送信先ウィンドウがどのオリジンに遷移していても、そのデータが配送される。機密データ（トークン等）を `"*"` で送っていると、盗聴される。

```javascript
// 脆弱: OAuth トークンを任意オリジンへ送信
iframe.contentWindow.postMessage({
    type: 'oauth_callback',
    token: 'sensitive_token_here'
}, '*'); // ワイルドカード = どの受信側でも受け取れる
```

```javascript
// 攻撃者ページ: 自分が受信側になれれば盗聴できる
window.addEventListener("message", function (event) {
    if (event.data.type === 'oauth_callback') {
        console.log('Token:', event.data.token); // 漏えい
    }
});
```

仕様上の警告として「悪意あるサイトが、あなたの知らぬ間にウィンドウの location を変更し、データを傍受し得る」ことが挙げられている。`iframe` に読み込んだページが攻撃者オリジンへ遷移したり、`window.open` した先が別オリジンだったりすると、`"*"` 送信はそのままそこへ届く。評価時は「機密を含む送信で `targetOrigin` が `"*"` になっていないか」を確認し、必ず**具体的な期待オリジン**を指定させる。

```javascript
// 安全: 送信先オリジンを明示
child.postMessage(msg, 'https://target-domain.com');
```

> 出典: An Introduction to postMessage Vulnerabilities（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities ／ PostMessage Vulnerabilities Part I（Jorge Lajara） — https://jlajara.gitlab.io/Dom_XSS_PostMessage

#### 主要な sink の一覧と、なぜ危険か

origin 検証を通過（または不在）した `event.data` が、最終的にどこへ流れるかを評価する。以下は代表的な危険 sink である。

- `innerHTML` / `outerHTML`: HTML 文字列として解釈される。`<img src=x onerror=...>` 等でスクリプト実行に至る（`<script>` 直挿しは実行されないが、イベントハンドラ属性経由で実行される）。
- `eval()` / `Function()`: 文字列をそのままJavaScriptとして実行する。最も直接的。
- `document.write()`: ドキュメントにHTMLを書き込み、解釈させる。
- `location.href` / `location` 代入: `javascript:` スキームでコード実行、または任意リダイレクト。
- `setAttribute()` によるイベントハンドラ属性（`onclick` 等）や `href`/`src` の設定: `javascript:` や `data:` 経由の実行。

評価の原則は、「**信頼できない `event.data` を、これらの sink へ、無害化（サニタイズ・エスケープ・スキーム検証）なしに渡していないか**」である。

### 検証ロジック評価の実践フロー（まとめ）

診断・防御レビューでは、次の順で機械的に確認するとよい。

1. **列挙**: 静的検索（`addEventListener('message'`, `onmessage`）＋ 動的観測（Global Listeners / Event Listener Breakpoints / `addEventListener` フック）で、すべての `message` ハンドラを洗い出す。
2. **origin 検証の有無**: 各ハンドラで `event.origin` を参照しているか。参照なしなら**パターンA**（要修正）。
3. **origin 検証の厳密性**: 参照ありでも、`indexOf`/`startsWith`/`endsWith`/`includes`/アンカーなし正規表現なら**パターンB**（バイパス可）。完全一致・許可リストのみ可とする。
4. **送信元判定の取り違え**: `event.data` 内の自己申告値で送信元を判断していないか（偽装自在なので不可）。
5. **データフローと sink**: `event.data` が `innerHTML`/`eval`/`document.write`/`location.href`/`setAttribute` 等へ、無害化なしに流れていないか。
6. **送信側のワイルドカード**: 機密送信で `targetOrigin` が `"*"` になっていないか（**パターンC**）。

#### 安全な受信ハンドラのリファレンス実装

評価の到達点として、堅牢なハンドラの形を示す。origin の厳密検証 → データ形式の検証 → 安全なAPIの使用、の3段で構成する。

```javascript
window.addEventListener("message", (event) => {
    // 1) origin を厳密に検証（完全一致）
    if (event.origin !== "https://trusted-origin.com") return;

    // 2) データ形式（型・スキーマ）を検証
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    if (data.type !== "expected_type") return;

    // 3) sink へ渡す前に値を検証・無害化
    //    例: URL は許可スキーム（http/https）に限定し、javascript: を排除
    const url = String(data.url || "");
    if (!/^https?:\/\//.test(url)) return;      // javascript:/data: を弾く
    document.getElementById("redirection").href = url;
    //    HTML を扱う場合は innerHTML ではなく textContent、
    //    あるいは DOMPurify 等でサニタイズする
});
```

この形が満たすのは、YesWeHack・Intigriti・Jorge Lajara の各資料が共通して挙げる原則、すなわち「**不要な message リスナーは置かない／期待オリジンを明示する（送受信とも `"*"` を避ける）／処理前に `event.origin` を検証する／受信データの構文・型を検証する／危険な DOM API に信頼できない入力を渡さない**」である。列挙で見つけた各ハンドラを、この基準に照らして一つずつ評価していくのが、postMessage 攻撃面マッピングの実務となる。

> 出典: An Introduction to postMessage Vulnerabilities（YesWeHack） — https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities ／ Exploiting PostMessage Vulnerabilities（Intigriti） — https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities ／ PostMessage Vulnerabilities Part I（Jorge Lajara） — https://jlajara.gitlab.io/Dom_XSS_PostMessage

## モダンWeb技術の攻撃面マッピング（Frans Rosén）

Frans Rosén（Detectify、HackerOne 歴代ランキング上位の著名ハンター）が OWASP AppSec EU 2018（2018年7月5日、ロンドン）で行った講演 *Attacking "Modern" Web Technologies* は、本章のテーマである「クライアントサイド攻撃面のマッピング」の実例集として極めて優れている。この講演が教科書的に重要なのは、個々のバグの派手さではなく、**「ブラウザが新しく獲得した機能（AppCache、直アップロード、postMessage）は、それ自体が新しい信頼境界を作り、その境界の定義が曖昧なまま実装されるため、必ず穴が開く」** という攻撃面の見つけ方を示している点にある。

本節では講演を3つの柱（AppCache / バケットのアップロードポリシー / postMessage）に分解し、それぞれ「仕組み → なぜ破れるのか → 実際の事例 → 防御」の順で解説する。

> ⚠️ **未取得の資料**: 「Attacking Modern Web Technologies（講演動画版）」は自動取得できませんでした（理由: YouTube のページが動的レンダリングのため、取得できたのはフッターのナビゲーションと著作権表記のみで、説明文・字幕いずれも本文が含まれていなかった）。以下のURLからご自身で直接ご覧ください: https://www.youtube.com/watch?v=vRqcUS4CPFs
>
> （以下は未取得資料の補足として一般知識に基づく解説です）動画版は約43分で、スライドとほぼ同一の構成です。スライドだけでは伝わりにくい「デモの時間軸」——とくに後述するクライアントサイド・レースコンディションで、攻撃者側のメッセージが被害者側の初期化シーケンスをどう追い越すか——は動画で見ると理解が早いので、本節を読んだあとに視聴することを勧めます。以降の技術的内容は、同一講演のスライド版から抽出したものです。

---

### AppCache — 仕様の曖昧さが「ドメイン全体の傍受」になる

#### AppCache とは何だったのか

AppCache（Application Cache）は、Service Worker 以前に存在した「オフライン対応」の仕組みである。HTML に `<html manifest="/manifest.appcache">` と書くと、ブラウザはそのマニフェストを取得し、記載されたリソースを**オリジン単位の専用キャッシュ**に保存する。マニフェストの構文は次のようなプレーンテキストである。

```
CACHE MANIFEST

CACHE:
/app.js
/style.css

NETWORK:
*

FALLBACK:
/ /offline.html
```

ここで決定的に重要なのが `FALLBACK:` セクションだ。`FALLBACK:` の各行は「**名前空間（namespace）** ␣ **代替リソース**」という組で、「この URL プレフィックス配下へのリクエストが *取得できなかった* 場合、代わりにこのキャッシュ済みファイルを返す」という意味を持つ。上の例なら、`/` 配下（＝サイト全体）のリクエストが失敗したとき `/offline.html` の中身が返る。

つまり **FALLBACK は、ネットワークエラー時にブラウザが「別のコンテンツを、リクエストされた URL のふりをして」返す仕組み**である。返された `/offline.html` の中身は、あくまで「元の URL のドキュメント」としてそのオリジン上で実行される。ここが攻撃面になる。

#### 破れ方1: 「取得失敗」は攻撃者が作れる

FALLBACK が発動するのは「リクエストが失敗したとき」だ。では失敗をどう作るか。Rosén が使ったのが **cookie bombing（cookie stuffing）** である。

攻撃者のページから、対象ドメイン（またはその親ドメイン）に対して巨大な Cookie を大量に書き込む。サーバは受け取ったリクエストヘッダのサイズが上限（典型的には 8KB〜16KB）を超えるため、**すべてのページに対して 400 / 431 / 500 系のエラーを返すようになる**。被害者のブラウザから見ると「サイト全体が取得失敗」であり、AppCache の FALLBACK が全面的に発動する。

> 補足: cookie bombing 自体は「相手のサイトを自分のブラウザ上で壊す」だけなら単なる自己 DoS だが、**FALLBACK のような「失敗時に別の挙動へ切り替わる機構」と組み合わさった瞬間に、任意タイミングで発動できるトリガーへ昇格する**。これは「無害に見える原始的なバグが、別機能と噛み合って攻撃面になる」典型例で、攻撃面マッピングの思考法として覚えておきたい。

#### 破れ方2: マニフェストの配置パスが強制されていなかった

W3C の AppCache 仕様では、FALLBACK の名前空間は**マニフェスト自身と同じパス配下**でなければならない、と定められていた。`/u/2241902/manifest.txt` に置かれたマニフェストは `/u/2241902/` 配下しか fallback できないはずである。

しかし当時の主要ブラウザ実装はこのパス制約を強制していなかった。Rosén のスライドは端的にこう述べている。

```
Manifest placed in /u/2241902/manifest.txt
Would use the FALLBACK for EVERYTHING, even outside the dir
```

深い階層に置いたマニフェストが、**オリジン全体（`/`）に対する FALLBACK を登録できてしまう**。これにより、「サブディレクトリにファイルを1つ置ける」だけの権限が、「そのオリジン上の任意 URL のレスポンスを差し替えられる」権限に化ける。

#### Dropbox での実例

この2つを繋いだのが Dropbox のケースである。

1. ユーザコンテンツ配信ドメイン `dl.dropboxusercontent.com` では、**XML ファイルが HTML として解釈・実行される**経路が存在した（XHTML 名前空間を含む XML は、ブラウザによってはマークアップとしてレンダリングされる）。
2. そこに `manifest` 属性を持つドキュメントを仕込み、ユーザのパス配下に置いたマニフェストを、実質的に**ルートレベルの FALLBACK として登録**する。
3. 被害者に cookie bombing を仕掛けてドメイン全体を 500 状態にする。
4. 以後、被害者が開く `dl.dropboxusercontent.com` 上の**すべてのシークレットリンク**が、攻撃者の用意した FALLBACK ページに差し替わる。そのページは正規オリジン上で動くため、リクエストされた URL（＝秘密の共有リンク）を `location.href` から読み取り、攻撃者のログ収集サイトへ送信できる。

報奨金は **Dropbox から $12,845**、加えて**各ブラウザベンダから計 $3,000**。Dropbox 側の恒久対策は次の通りだった。

- `dl.dropboxusercontent.com` で XML を HTML として実行させない
- 全ブラウザベンダへ協調報告（Chromium バグ #696806 など）し、**パス配下でないルート FALLBACK を禁止**させる
- ユーザファイルを**ランダムなサブドメイン**に分離し、1ファイルの侵害が他ファイルへ波及しないようにする

最後の「ランダムサブドメインへの分離」は、クライアントサイド防御の王道である。**同一オリジンに置かれた時点で、そこに置かれたすべてのものは互いを侵害できる**という前提から逃れる唯一の方法がオリジン分離だからだ。

#### 2026年時点の状況（陳腐化への注記）

AppCache は現在では**完全に消滅した技術**である。Chrome は 85（2020年）で非推奨警告、**Chrome 95（2021年10月）で完全削除**。Firefox は 84（2020年12月）で削除、Safari も同時期に撤去した。したがって「AppCache のバグを探す」こと自体は、2026年現在では対象外と考えてよい。

しかし**原理はそのまま Service Worker に引き継がれている**。Service Worker は `fetch` イベントを介して、スコープ配下の**すべてのリクエストのレスポンスを合成できる**。そして「スコープ」は登録スクリプトの配置パスで決まる（`/sw.js` を登録できればオリジン全体）。つまり本節で学ぶべき教訓は次の一文に集約される。

> **「任意のファイルをオリジンのルートに置ける」は、それ自体が「オリジン全体の恒久的な乗っ取り」と等価である。**

Service Worker の場合は `Service-Worker-Allowed` ヘッダによるスコープ拡張という追加の考慮点もあるが、防御の本質は同じ——ユーザがアップロードしたコンテンツを、アプリ本体と同じオリジンの、しかも浅いパスに置かないことだ。

> 出典: OWASP AppSecEU 2018 – Attacking "Modern" Web Technologies — https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies

---

### バケットのアップロードポリシー（AWS S3 / Google Cloud Storage）

#### ブラウザ直アップロードの仕組み

大容量ファイルをアプリサーバ経由で中継するのは非効率なので、現代のアプリは**ブラウザから直接 S3 / GCS へ POST させる**設計を取る。このときサーバは「何をどこに置いてよいか」を記述した **POST policy**（JSON）を作り、それを Base64 エンコードし、秘密鍵で署名してブラウザに渡す。ブラウザは `multipart/form-data` にポリシー・署名・実ファイルを詰めて S3 に送る。S3 は署名を検証したうえで、**ポリシーの `conditions` に書かれた条件をすべて満たすかどうか**だけをチェックする。

つまり **`conditions` が、そのアップロードに対する唯一のアクセス制御である**。ここが緩ければ、攻撃者は正規に発行されたポリシー（自分のアップロード画面から普通に取得できる）を使って、想定外の操作を行える。実際のポリシーは次のような形をしている。

```json
{
 "expiration": "2018-07-31T13:55:50Z",
 "conditions": [
  {"bucket": "bucket-name"},
  ["starts-with", "$key", "acc123"],
  {"acl": "public-read"},
  {"success_action_redirect": "https://dashboard.example.com/"},
  ["starts-with", "$Content-Type", ""],
  ["content-length-range", 0, 524288]
 ]
}
```

`["starts-with", "$key", "acc123"]` は「オブジェクトキーは `acc123` で始まること」という意味。`$key` はアップロード先のパスそのものである。

#### 落とし穴4種（講演で挙げられた原文そのまま）

スライドに列挙された S3 の pitfalls は次の4つである。

```
starts-with $key does not contain anything
  -> We can replace any file in the bucket!

starts-with $key does not contain path-separator
  -> We can place stuff in root

$Content-Type uses empty starts-with + content-disp
  -> We can now upload HTML-files: Content-type: text/html

$Content-Type uses starts-with = image/jpeg
  -> We can still upload HTML: Content-type: image/jpegz;text/html
```

それぞれ「なぜそうなるのか」を押さえる。

**(1) `["starts-with", "$key", ""]`（空文字）**
前方一致の対象が空文字なので、**あらゆるキーが条件を満たす**。攻撃者は `index.html` でも `assets/app.js` でも、バケット内の既存ファイルを上書きできる。そのバケットが静的サイトや JS 配信に使われていれば、その時点で保存型 XSS かつサプライチェーン汚染である。

**(2) パスセパレータを含まない前方一致**
`["starts-with", "$key", "acc123"]` は一見ユーザ領域に閉じ込めているようだが、**`acc123` の直後に `/` が要求されていない**。よって `acc123-evil.html` や、ディレクトリ境界を無視した任意の名前が通る。さらに `["starts-with","$key","user/123"]` のような場合でも、`user/123../` のような正規化で親へ抜ける経路が残ることがある。

Rosén がこれを重視するのは、**ルート直下にファイルを置けること自体が致命的**だからだ。前節の AppCache マニフェスト、そして Service Worker の登録スクリプトは、いずれも「どのパスに置かれたか」でスコープが決まる。ルートに置ければオリジン全体を握れる。つまり `$key` の前方一致は、単なるファイル配置の話ではなく**スコープの話**である。

**(3) `["starts-with", "$Content-Type", ""]` と Content-Disposition 欠如**
Content-Type が実質無制限なら `text/html` を指定できる。さらにポリシーで `Content-Disposition: attachment` を強制していない場合、S3 はデフォルトで**インライン表示**する。結果、そのバケットのドメイン上で HTML/JS が実行される。

**(4) `image/jpegz;text/html` という古典的バイパス**
`["starts-with", "$Content-Type", "image/jpeg"]` と制限してもバイパスされる。理由は2層ある。

- **S3 側**: `starts-with` は文字列の単純な前方一致にすぎない。`image/jpegz;text/html` は `image/jpeg` で始まるので条件を通過する。MIME 型として妥当かどうかは検証されない。
- **ブラウザ側**: 保存された Content-Type ヘッダをブラウザがパースするとき、`;` より後ろはパラメータ部として扱われる……はずだが、実装によっては不正な型（`image/jpegz`）を解釈できず、フォールバック処理やスニッフィングを経て `text/html` 側が効いてしまうケースがあった。

教訓は普遍的である。**`starts-with` のようなプレフィックス一致で構造化された値（MIME 型、パス、オリジン）を検証してはいけない。** 構造を持つ値は、構造を理解したうえで完全一致か厳格なパースで検証する。この原則は後述の postMessage の origin 検証でもまったく同じ形で再登場する。

#### 署名付き URL（signed URL）をユーザ入力から作ってはいけない

講演は「ポリシーそのものは正しくても、アプリ側の独自ロジックが署名付き URL を漏らす」ケースも扱っている。核心は次の一文だ。

> "being able to get a signed GET-URL to the root of the bucket will show you the file-listing"

バケットのルートに対する署名付き GET URL を得られれば、**バケット全体のファイル一覧が見える**。実例として3パターンが挙げられている（いずれも報告済み・修正済みの事例）。

1. **パラメータのパストラバーサル**: `get-image?key=../../../` のように、キーを遡らせてルートに到達させる
2. **URL パースの誤り**: `https://.x./example-bucket` のような壊れた URL を投げると、ホスト名抽出のロジック（多くは雑な正規表現）が誤判定し、ルートを指す署名付き URL が返る
3. **パラメータ注入**: `s3_key="/"` をそのまま渡すと、ルートの一覧 URL が生成される

これらの合計報奨金は **約 $15,000**。

#### 防御チェックリスト

講演の推奨事項（スライドの原文の趣旨）をまとめる。

| 項目 | 正しい設定 | なぜ |
|---|---|---|
| `$key` | `starts-with` を使わず**完全に確定**させる。ランダムなパス＋ランダムなファイル名 | 上書き・ルート配置・トラバーサルを構造的に排除 |
| `Content-Type` | `starts-with` ではなく**明示的な完全一致** | プレフィックス一致は `image/jpegz;text/html` で抜ける |
| `Content-Disposition` | `attachment` を**ポリシーで強制** | インライン実行（XSS・マニフェスト）を封じる |
| `acl` | `private`、または指定しない | `public-read` は意図せぬ公開を生む |
| 署名付き URL | **ユーザ入力を一切もとにしない** | ルートを指す URL が作れれば全ファイル列挙 |
| ホスティング先 | ユーザコンテンツはアプリ本体と**別オリジン** | 1ファイルの侵害をオリジン境界で止める |

> 出典: OWASP AppSecEU 2018 – Attacking "Modern" Web Technologies — https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies
> 出典: Bypassing and exploiting Bucket Upload Policies and Signed URLs（Detectify Labs, 2018-08-02） — https://labs.detectify.com/2018/08/02/bypassing-exploiting-bucket-upload-policies-signed-urls/

---

### postMessage — 見えない攻撃面を可視化する

#### 前提の整理

`window.postMessage()` は、**異なるオリジンのウィンドウ／フレーム間でデータを送る、同一オリジンポリシーの公式な抜け道**である。送信側は `target.postMessage(data, targetOrigin)`、受信側は `window.addEventListener('message', handler)` で受ける。ハンドラが受け取る `MessageEvent` には少なくとも次が含まれる。

- `event.data` — 送られたデータ（構造化クローン）
- `event.origin` — **送信元のオリジン（ブラウザが保証する、偽装不能な値）**
- `event.source` — 送信元の `WindowProxy`（返信に使える）

セキュリティは完全に**アプリ側の2つの責務**に委ねられている。

1. **送信時**: `targetOrigin` に `'*'` を使わない（使うと、遷移した先の任意のオリジンにデータが渡る）
2. **受信時**: `event.origin` を**厳密に**検証する

この「アプリ任せ」が、後述するすべてのバグの共通原因である。

#### なぜ専用ツールが必要か: postMessage-tracker

postMessage の攻撃面は**DOM を見ても分からない**。リスナーは JavaScript の内部状態であり、しかも実運用では次の事情で観測が難しい。

- リスナーが**短命**（特定の UI 操作の間だけ登録され、すぐ `removeEventListener` される）
- リスナーが**ラッパで包まれている**。Raven.js（Sentry）、Rollbar、Bugsnag、New Relic といった監視ライブラリは `addEventListener` をフックして全ハンドラを try/catch でラップする。そのため `toString()` してもラッパのコードしか見えず、**本体の関数が特定できない**
- **jQuery** 経由（`$(window).on('message', ...)`）で登録された場合、実体は jQuery の内部ストア（`$._data` / `.expando` / `.events`）に入り、バージョンごとに格納場所が違う
- **無名関数**は Chrome では `Function.toString()` から元の定義位置を辿れない

Rosén はこの可視化のために Chrome 拡張 **postMessage-tracker** を公開している。機能の要点は次の通り。

- ページと**すべてのサブフレーム**の `message` リスナー数をアイコンにバッジ表示する
- 監視ライブラリや jQuery のラッパを**アンラップ**して、DevTools 上で「本当の受信関数」の定義にジャンプできるようにする
- ウィンドウ間のメッセージ流を**コンソールにログ出力**し、送信元・受信先を読みやすいパス表記（別ウィンドウは `diffwin` 識別子）で示す
- オプションで **Log URL** を設定すると、検出したリスナーの関数シグネチャとメタ情報を外部エンドポイントへ送信し、短命・隠れリスナーを後から分析できる
- 関数を文字列化できない場合（無名関数など）は `"bound"` と表示する

方法論としての含意は明確だ。**攻撃面マッピングとは「見えないものを見えるようにする計測器を先に作る」作業である。** どんなに手で探しても、リスナーが 200ms しか存在しなければ見つからない。

> 出典: postMessage-tracker（GitHub） — https://github.com/fransr/postMessage-tracker

#### パターン A: そのまま XSS になる受信ハンドラ

もっとも単純な型。受け取ったデータを、そのまま **sink（入力が最終的に実行・解釈される危険な代入先。`eval`、`innerHTML`、`script.src`、`location` など）** に流してしまう実装である。講演のペイロード例はこうだ。

```js
b.postMessage({"JSloadScript":{"value":"data:text/javascript,alert(...)"}}, '*')
```

受信側は `JSloadScript.value` を `<script src=...>` の `src` に代入していた。`data:` URI を受け付けるため、**外部ドメインを一切使わずに**対象オリジン上で任意 JS が走る。`data:text/javascript,` が使われているのは、CSP の `script-src` にホスト名ベースのホワイトリストしかない場合でも通ることがあるためだ（`data:` を明示的に禁じていない CSP は意外に多い）。

同型のバリエーションとして、受信データが `iframe.src` や `location.href` に入るケースがあり、その場合は `javascript:` スキームが sink になる。

#### パターン B: 設定投入型のデータ抽出

より巧妙なのが、**「XSS ではないが、メッセージで挙動を設定できる」機能を悪用する型**である。アナリティクスや A/B テスト系のタグは、親ウィンドウから「ルールセット」を受け取って動作する設計になっていることが多い。ルールは典型的に「CSS セレクタで要素を選び、その値を取り、指定先へ送る」という形をしている。

攻撃者が任意のルールセットを postMessage で注入できると、コードを実行しなくても

```
セレクタ: input[name=csrf_token]  → 値を攻撃者のエンドポイントへ送る
```

という指示だけで **CSRF トークンや個人情報を吸い出せる**。講演ではこれを "action-rules and element selectors" による data extraction として紹介している。

**教訓**: postMessage の危険度を「eval に届くか」だけで判定してはいけない。**「攻撃者がハンドラの設定空間をどこまで支配できるか」**が本当の評価軸である。

#### パターン C: サンドボックスドメインの XSS を本体へ橋渡しする

ドキュメント変換サービス（アップロードされた文書をプレビュー表示するタイプ）では、安全のためレンダリングを**隔離ドメイン**の iframe 内で行う設計が定石である。オリジンが違うので、そこで XSS が起きても本体のセッションは守られる——はずだった。

ところが、そのサンドボックス iframe は本体と `postMessage` で会話している。攻撃者がサンドボックスドメイン上で XSS を取ると、そこから `window.opener` や `parent`、あるいは `event.source` を辿って、**攻撃者が開いた別ウィンドウへ、被害者がアップロードした文書の中身を postMessage で流出させる**ことができる。

ここでの原理は **「オリジン分離は、その境界を越える通信路を開けた瞬間に、通信路の強さまで弱まる」** という点だ。サンドボックス化は万能薬ではなく、**境界を越えるメッセージの種類と方向を最小化して初めて効く**。

#### パターン D: クライアントサイド・レースコンディション（その1）

講演の白眉がここからの2つである。

対象は locale（多言語化）サービス。ページ読み込み時に、JavaScript のロードと iframe のロードが**並行して**走り、両者が postMessage でハンドシェイクする。ここには「JS はもう読み込まれたが、iframe の origin 検証ロジックがまだ初期化されていない」という**時間的な隙間**が存在した。

その隙間に攻撃者がメッセージを送り込むと、注入値が読み込み中のスクリプトに取り込まれる。スライドにあるペイロードは次の通り。

```
&osl='-alert(1)-'
```

これは `osl` パラメータの値が、生成される JavaScript の**文字列リテラルの中**に補間されていることを示している。`'` でリテラルを閉じ、`-` で式を連結し、`alert(1)` を評価させ、再び `-'` で後続のクォートと辻褄を合わせる。`+` ではなく `-`（減算）を使うのは、URL 中で `+` が空白にデコードされる問題を避けるためで、JS インジェクションの定番テクニックである。

さらにスライドには、`alert` が使えない状況での回避として **iframe の `contentWindow` を使う手法**が挙げられている。ページ側で `window.alert` が潰されていても、新たに生成した同一オリジン iframe の `contentWindow.alert` は手つかずで残っているため、PoC の証明に使える。

#### パターン E: origin 正規表現のバグ ＋ 決済フローのレース（その2）

最も実害の大きい事例。決済処理（Stripe 連携）を行うページで、受信側の origin 検証が**動的に組み立てた正規表現**で行われていた。

```js
// 意図: "*.example.co.nz" からのメッセージだけを受け付けたい
var domain = '.example.co.nz';
var re = '^https:\\/\\/.*(' + domain.replace('.', '\\.') + ')$';
Boolean("https://www.exampleaco.nz".match(re));  // => true  ← 通ってしまう
```

**なぜ通るのか**。JavaScript の `String.prototype.replace()` は、**第1引数が文字列の場合、最初に一致した1箇所しか置換しない**（全置換には正規表現 `/\./g` が必要）。したがって `.example.co.nz` は `\.example.co.nz` になり、**先頭のドットだけがエスケープされ、`example.co.nz` の中の2つのドットは未エスケープのまま**残る。正規表現では未エスケープの `.` は「任意の1文字」である。

組み上がったパターンを文字単位で当ててみる。

```
パターン: ^https:\/\/.*(\.example.co.nz)$
入力:      https://www.exampleaco.nz

  ^https:\/\/  →  "https://"
  .*           →  "www"
  \.           →  "."        (エスケープ済みの本物のドット)
  example      →  "example"
  .            →  "a"        ★任意文字なのでドット以外にもマッチ
  co           →  "co"
  .            →  "."
  nz           →  "nz"
  $            →  終端
```

つまり攻撃者が `exampleaco.nz` というドメインを取得すれば、`*.example.co.nz` 専用のはずの origin 検証を突破できる。

そのうえで**レース**が仕掛けられる。正規のフローは、フレーム間で `INIT` → `LOAD` といった順序でハンドシェイク（スライドの表現で "INIT-dance"）してから Stripe の公開鍵を確定させる。攻撃者は自分の（検証を通過する）ドメインから、`setInterval` で **`LOAD` メッセージを高頻度に連射（spray）** し、正規の `LOAD` より先に自分のメッセージを届かせる。

```js
// 概念コード（学習用。実サービスに対して実行しないこと）
setInterval(function () {
  victimFrame.postMessage({ type: 'LOAD', stripeKey: ATTACKER_PUBLISHABLE_KEY }, '*');
}, 1);
```

結果、決済フォームは**攻撃者のマーチャントアカウントの公開鍵**で初期化される。被害者が入力したクレジットカード情報は、正規の見た目のまま**攻撃者の Stripe アカウントへトークン化されて送られる**。UI 上の異常は一切ない。

この事例が教えるのは2点。

1. **origin 検証を文字列操作や動的正規表現で書いてはいけない。** 正しくは `event.origin === 'https://app.example.com'` の完全一致、または許可リストへの `includes()`。サブドメインを許したいなら `new URL(event.origin)` でパースして `hostname` を `.example.co.nz` で `endsWith` 判定するなど、構造を理解した比較を行う。
2. **クライアントサイドにも競合状態がある。** サーバ側のレースコンディションは広く知られているが、「複数のフレーム／スクリプトが非同期に初期化し、その間に状態が確定していない」という状況は、JS が単一スレッドであっても**イベントループ上の順序として**存在する。ハンドシェイクの各ステップは、**一度だけ受け付ける／nonce と突き合わせる／初期化完了フラグを立てる**という形で冪等化・順序固定するべきである。

> 出典: OWASP AppSecEU 2018 – Attacking "Modern" Web Technologies — https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies

---

### 方法論としてのまとめ: 攻撃面をどう列挙するか

本節の3つの柱は、表面的にはバラバラの技術だが、攻撃面マッピングの観点では**同じ4つの質問**に還元できる。実際の調査では、対象アプリに対してこの4問を機械的に当てていくとよい。

| 質問 | AppCache の場合 | バケットの場合 | postMessage の場合 |
|---|---|---|---|
| **① この機能はどの信頼境界を跨ぐか** | オフラインキャッシュがオリジン全体のレスポンスを合成する | ブラウザから直接ストレージへ書き込む | 異なるオリジンのウィンドウ間 |
| **② 境界を定義しているのは誰か** | マニフェストの配置パス（＝仕様。ただし当時ブラウザが未強制） | ポリシーの `conditions`（＝アプリが生成） | `event.origin` の検証コード（＝アプリが実装） |
| **③ その定義は構造を理解して検証されているか** | パス制約が無視されていた | `starts-with` による**プレフィックス一致** | 動的組み立ての**正規表現** |
| **④ 攻撃者が制御できるタイミング／状態は何か** | cookie bombing で「取得失敗」を任意発動 | 正規ポリシーを自分の画面から取得して再利用 | 初期化前の隙間にメッセージを連射 |

そして、この講演全体を貫く2つの原則を最後に置く。

- **プレフィックス一致・部分一致・自作正規表現で、構造を持つ値（オリジン、MIME 型、パス）を検証しない。** 必ずパースするか完全一致で比較する。`indexOf()`、`startsWith()`、`String.replace()` を使った origin チェックは、それだけで脆弱性報告に値する。
- **「ファイルを1つ置ける」を軽視しない。** 置ける場所がオリジンのルートに近いほど、それは「オリジン全体の恒久的な制御」に近づく。AppCache は消えたが、Service Worker という後継が同じ性質を持っている。

なお本節の内容は、いずれも**適切な許可のもとで行われたバグバウンティ調査の報告済み・修正済み事例**である。読者が同種の検証を行う場合は、必ず自分で構築した検証環境か、明示的にスコープが許可されたプログラム上で行うこと。実在サービスの本番環境に対して無許可でこれらの手法を試すことは、本書の目的の範囲外であり、また法的に許されない。

> 出典: OWASP AppSecEU 2018 – Attacking "Modern" Web Technologies — https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies
> 出典: Attacking Modern Web Technologies（講演動画・未取得） — https://www.youtube.com/watch?v=vRqcUS4CPFs

## client-side recon と自分のチェックリスト作り

クライアントサイド脆弱性（XSS、DOM Clobbering、postMessage の検証漏れ、prototype pollution など）は「どこにコードがあり、そのコードが何を入力として受け取っているか」を把握して初めて狙える。ソースを読まずに手当たり次第ペイロードを投げても再現性のある発見にはならない。本節では、対象アプリケーションのクライアントサイド攻撃面を体系的に洗い出す **recon（reconnaissance、偵察）** の手順を、受動的情報収集・能動的情報収集・JavaScript 特化パイプライン・継続的な差分監視の4段階に分けて解説し、最後に自分専用のチェックリストへ落とし込む方法を示す。

### 7.4.1 recon が地味だが核心である理由

クライアントサイド攻撃面のハンティングは、次の連鎖で成立している。

1. **どのJSファイルが読み込まれているか**（自ドメイン／サードパーティCDN／サブリソース）を把握する
2. その中から**エンドポイント・パラメータ名・関数名**を抽出する
3. 抽出した情報から「ユーザー入力が **sink**（入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`, `eval`, `document.write`, `location.href` への直接代入）に届く経路」を探す
4. 見つけた経路に対してペイロードを試す

多くのハンターはステップ4から始めてしまい、攻撃面の8割を見落とす。実際には、対象が読み込んでいるJSファイルの本数がそのまま「攻撃対象になり得るコードパスの量」に直結するため、収集の網羅性が脆弱性発見率を支配する。これは後述する資料1が明言している原則「more files = more paths, parameters → more vulns（ファイルが増えるほどパスとパラメータが増え、脆弱性も増える）」そのものである。

### 7.4.2 受動的情報収集（passive recon）

受動的収集とは「対象サーバーに一切パケットを送らず、公開データソースだけから情報を得る」フェーズを指す。具体的には以下のソースを使う。

- **証明書透明性ログ（Certificate Transparency, CT log）**: `crt.sh` などで、対象ドメイン宛に発行されたTLS証明書のSAN（Subject Alternative Name）欄からサブドメインを列挙できる。CAはドメイン検証済み証明書を発行するたびにCTログへ登録する義務があるため、開発中や社内限定のサブドメインでも一度でも証明書を発行されていれば痕跡が残る。
- **DNSの公開レコードとパッシブDNS**: 過去に解決されたA/CNAMEレコードの履歴から、現在は直接リンクされていないホストを発見できる。
- **Web アーカイブ・URLコレクタ**: Wayback Machine、Common Crawl、URLScan.io、AlienVault OTX などが保持する「過去にクロールされたURL一覧」を使う。これらのサービスは自前でクロールした結果をデータベース化しているため、対象に一度もリクエストを送らずに大量のURL（＝JSファイルのパスも含む）を得られる。
- **ツール**: `subfinder`、`amass`、`assetfinder` はこれらのソースをまとめて叩き、サブドメイン候補を出力する。

受動収集の利点は「検知されない」ことだけでなく、**現在はリンクされていないが依然としてデプロイされている古いJSバンドル**（バージョン管理ミスで残存したデバッグビルドなど）を掘り出せる点にある。クライアントサイド脆弱性は、最新版では修正済みでも、CDNキャッシュや旧デプロイに残る古いバンドルにまだ存在していることが少なくない。

### 7.4.3 能動的情報収集（active recon）

受動的ソースが尽きたら、対象に直接リクエストを送る段階に移る。

- **DNSブルートフォース**: `puredns` のようなツールでワードリストを使い、辞書順に名前解決を試す。
- **HTTPプロービング**: `httpx` は生存しているホストの検出に加えて、レスポンスヘッダやHTMLからフレームワーク・CMS・JSライブラリのバージョンを指紋照合（フィンガープリンティング）する。これによりReact/Vue/AngularなどSPAフレームワークの有無や、依存ライブラリの既知バージョン（＝既知CVEの有無）を早期に把握できる。
- **ポートスキャン**: `naabu`、`masscan` で開いているポートを把握し、管理画面や別オリジンで動いているフロントエンド資産（別のクライアントサイド攻撃面）を見つける。
- **コンテンツ探索**: `ffuf`、`feroxbuster`、`gobuster` でディレクトリ・ファイル名をワードリストと突き合わせ、`/static/js/`配下の隠れたビルド成果物や `.map` ファイルを探す。

この段階を経て、資産マッピングの流れは概念的に次のように整理できる。

```
サブドメイン列挙 → DNS解決 → 生存ホスト検出 → ポート検出
  → URLクロール → パラメータ抽出 → （ここでJS特化reconへ分岐）
```

> 出典: Comprehensive Recon Guide — https://chs.us/guides/recon/

このガイドが強調する原則は **「Passive first, then active」**（まず受動、次に能動）である。これは単に検知回避のためだけではなく、受動収集で得た「既知のホスト名・既知のパス」を辞書としてブルートフォースの精度を上げる、という実務上の合理性もある。

また同ガイドは2020年代後半のクラウドネイティブな攻撃面として、GraphQL イントロスペクション（スキーマ自己公開機能を悪用したAPI全容把握）、コンテナレジストリの列挙、サーバーレス関数のエンドポイント発見、**source map解析**、機械学習を使ったサブドメイン名の予測生成を挙げている。このうちsource map解析はクライアントサイド脆弱性ハンティングと直結するため、7.4.4で詳しく扱う。

⚠️ **未取得の資料に関する補足**: 上記の `chs.us` ガイドは要約取得ができたが、個々のコマンドオプションや詳細な出力例までは原文から抽出できなかった。ここに記載したツール名（subfinder、amass、httpx、naabu、ffuf など）は業界で広く使われている実在ツールであり、（以下は一般知識に基づく補足として）用途の説明を付した。正確な使用例は各ツールの公式リポジトリで確認してほしい。

### 7.4.4 JavaScript特化reconパイプライン

サブドメイン・生存ホストが揃ったら、クライアントサイド脆弱性ハンティングの本丸である「JSファイルの収集と解析」に入る。以下は資料1（JS Reconnaissance Guide）が示すワークフローを、各ステップの「なぜそうするのか」という仕組みレベルの説明とともに再構成したものである。

#### ステップ1: JSファイルの収集

```bash
# 対象ドメイン配下の全URLから .js を含み .json を除外して収集
gau paypal.com | grep -iE '\.js' | grep -ivE '\.json' | sort -u >> paypalJS.txt
```

`gau`（GetAllUrls）は前述のWayback Machine・Common Crawl・OTX などのパッシブソースを横断的に叩き、対象ドメインに紐づくURLを大量に返す。ここでの狙いは自社ドメインのJSだけでなく、**サードパーティCDNにホストされたJS**（アナリティクス、決済ウィジェット、チャットボット等）も対象に含めることである。サードパーティスクリプトはビルド設定が甘く、デバッグ用エンドポイントやAPIキーが残っていることが多いため、スコープ内であれば見逃せない攻撃面になる。

> **スコープ注意（本教科書の方針）**: スコープ外のホストに対する能動的なリクエスト送信や検証は行わない。パッシブソースから見つかったスコープ外URLは記録に留め、プログラムのスコープ規定に従うこと。

#### ステップ2: 生存確認

```bash
cat paypalJS.txt | antiburl > paypalJSAlive.txt
```

`antiburl` は各URLにHTTPリクエストを送り、200応答を返すものだけを残す。収集したURLの多くは既に削除・移設済みで404を返すため、この足切りをしないと後続の解析コストが無駄に膨らむ。

#### ステップ3: パスとパラメータの抽出

```bash
cat paypalJS.txt | xargs -n2 -I@ bash -c \
  "python3 linkfinder.py -i @ -o cli" | python3 collector.py output
```

`linkfinder` はJSソース中の文字列リテラルを正規表現でスキャンし、`/api/`のようなパスパターンやフルURLを抽出するツールである。JavaScriptの静的解析としては簡易な部類（AST解析ではなく正規表現ベース）だが、難読化されていないコードであれば十分な再現率が出る。`collector.py` はその出力をJS・URL・パラメータ名などのカテゴリ別ファイルに仕分けし、後続の解析を体系立てる。ここで得られる**パラメータ名の一覧こそが、DOM XSSの候補となるクエリ文字列・ハッシュフラグメントの当たりを付ける材料**になる。たとえば `redirect`、`callback`、`next`、`returnUrl` のような名前は、`location.href` や `window.open` に生入力のまま渡されるsinkと結びつきやすい典型パターンである。

#### ステップ4: 機密情報の検出

`SecretFinder` はJS中の文字列に対して、AWSキーの接頭辞（`AKIA`）やJWTの構造（`eyJ` で始まる3パート・ドット区切りのBase64URL文字列）といった既知のシグネチャ、および高エントロピー文字列の検出ロジックを組み合わせ、APIキー・トークン・内部エンドポイントを洗い出す。クライアントサイドに埋め込まれたシークレットは、直接的な認証情報漏えいであると同時に、内部APIの存在を教えてくれる副産物として攻撃面拡大にも使える。

#### ステップ5: 危険なsinkパターンの検出

`jsAlert.py`（および類似の`getScriptTagContent.py`）は、`innerHTML`、`postMessage`、`document.write`、`eval`、`dangerouslySetInnerHTML` のような危険なキーワードをコード中から機械的にgrepし、目視レビューすべき箇所に優先順位を付ける。これは脆弱性の確定ではなく「読むべきコード片の絞り込み」であることに注意する。実際にsinkへ到達するかは、その変数がどこから来た値か（sourceからsinkまでのデータフロー）を人間が追跡して初めて判断できる。

> 出典: My JavaScript Recon Process — https://gist.github.com/pikpikcu/b034a7e3b8bf966a6eba95acb1fbfe08

#### source map解析（chs.usの指摘との接続）

多くのフロントエンドビルド（webpack, Viteなど）は、圧縮・トランスパイル後のJSファイル末尾に

```javascript
//# sourceMappingURL=app.min.js.map
```

というコメントを埋め込む。これはブラウザの開発者ツールに「元のソースファイル構成やシンボル名の対応表はこのJSONファイルにある」と伝えるための仕組みで、本番運用でも`devtool: 'source-map'`のようなwebpack設定のまま出荷されると、この`.map`ファイルが公開ディレクトリに残ってしまう。攻撃者（および防御側の監査担当）は`.map`ファイルを取得できれば、圧縮前の変数名・コメント・ファイル分割構造をほぼそのまま復元できるため、difficultyの低いソースコード解析が可能になる。reconの一環として、収集したJS一覧に対し`.map`拡張子や`sourceMappingURL`コメントの有無を機械的にチェックする価値は高い。防御側の対策としては、本番ビルドで`devtool: false`または`hidden-source-map`（コメントを埋め込まずmapファイルのみ生成しCI/エラートラッキング基盤にのみ渡す）を使うことが基本である。

### 7.4.5 差分監視（diffing）でJSの変更を継続的に追う

一度きりの収集で終わらせず、**同じJSファイルを定期的に再取得してハッシュを比較する**ことで、デプロイのたびに追加された新機能・新エンドポイント・修正漏れを検知できる。仕組みは単純で、各JSファイルのSHA-256などのハッシュ値を記録しておき、次回取得時に差分があればdiffツール（`diff`コマンドやJS beautify後の行単位diff）で変更箇所だけを確認する。

```bash
# 前回取得分と突き合わせてハッシュが変わったファイルだけ抽出する例
sha256sum *.js > current.hashes
diff previous.hashes current.hashes | grep '^>' 
```

この手法が有効な理由は、SPAのリリースサイクルが頻繁である一方、レビュー側の人手は限られるため、**「変わった箇所だけを見る」ことで解析コストを一定に保ちながら継続的にカバレッジを維持できる**からである。新しく追加されたAPI呼び出しや新しいpostMessageハンドラは、実装直後でまだ入力検証が甘いことが多く、差分監視は費用対効果の高い継続的recon手法として知られている。

### 7.4.6 自分のチェックリストの作り方

ここまでの手順を、案件ごとに使い回せるチェックリストとして固定化しておくと、抜け漏れなく・再現性を持って攻撃面を洗い出せる。以下はテンプレート例である。実務では自分のツールセットや対象の技術スタックに応じて増減させる。

1. **受動収集**: crt.sh / amass / subfinder でサブドメイン一覧を作成し、gauでURL一覧（JS含む）を取得したか
2. **能動収集**: httpxで生存確認・技術指紋を取得し、フレームワーク／ライブラリのバージョンを記録したか
3. **JS収集**: 自ドメイン＋許可されたサードパーティホストのJSを漏れなく集め、antiburlで生存フィルタをかけたか
4. **抽出**: linkfinder等でパス・パラメータ・エンドポイント候補を洗い出し、カテゴリ別に保存したか
5. **秘密情報チェック**: SecretFinder等で埋め込みキー・トークンの有無を確認したか（見つけた場合は速やかにプログラム運営者へ報告し、悪用しない）
6. **sink候補の洗い出し**: `innerHTML`/`eval`/`postMessage`/`document.write`等の危険キーワードをgrepし、優先読解リストを作ったか
7. **source map確認**: `.map`ファイルや`sourceMappingURL`コメントの有無を確認し、あれば元コード構造を把握したか
8. **差分監視の登録**: 継続案件であれば、主要JSファイルのハッシュを記録し、定期チェックの仕組み（cronやスケジューラ）に載せたか
9. **記録**: 収集したパス・パラメータ・sink候補・仮説を、案件ごとのノート（後述の第◯章のトリアージ記法に準拠）にまとめたか

このチェックリストの本質は「収集→抽出→絞り込み→継続監視」という一方向のパイプラインを、毎回同じ順序・同じ粒度で回すことにある。順序を崩すと（たとえば収集を飛ばしていきなりsink探しから始めると）、見えているコードの範囲がそもそも狭く、母数バイアスによって脆弱性の見逃しが発生する。recon工程への投資は、その後のsource-to-sink分析（第7章後半・第8章以降で扱う）の精度と網羅性を直接左右する、地味だが最も費用対効果の高い工程だと理解しておきたい。

すべての手順は防御目的の学習・許可されたスコープ内での監査を前提とする。実在サービスや第三者の本番環境に対して無許可でスキャン・収集・検証を行ってはならない。

---

[← 第6章 プロキシと専用ツールによる動的解析](06-proxy-and-dom-invader.md) ｜ [📖 目次](index.md) ｜ [第8章 発展的なクライアントサイド技術領域 →](08-advanced-client-side.md)
