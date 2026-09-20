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
