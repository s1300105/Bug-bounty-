## DOM XSS・web message・prototype pollution の追跡ワークフロー

前節でDOM Invaderの仕組み（canary文字列の注入と拡張DOMによるsource→sink追跡）の全体像を押さえました。本節はその「使い方」を、実際の診断で手を動かす順番に沿って3本のワークフローに分解します。すなわち、(1) 反射型XSSと同じ感覚でDOM XSSを追う基本ワークフロー、(2) `postMessage`（ウィンドウ間メッセージング）を改変・再送してDOM XSSを検証するワークフロー、(3) プロトタイプ汚染（prototype pollution）のsourceとgadgetを自動走査するワークフローです。最後に、DOM Invaderを補完する軽量ツールとしてFrans RosénのpostMessage-tracker拡張の内部実装を読み解きます。

いずれも「防御目的での検証」を前提とします。ここで解説する操作は、自分が管理するテスト環境・ローカルのデモページ・明示的に許可された対象に対してのみ行うものであり、実在サービスや本番環境への無許可の注入・破壊的操作は行いません。

用語を最初に固定しておきます。**source（ソース）**とは攻撃者が制御できる入力の出発点（例: `location.hash`、`document.referrer`、`postMessage`で届く`event.data`）、**sink（シンク）**とは入力が最終的に実行・解釈される危険な代入先（例: `innerHTML`への代入、`eval()`、`document.write()`）です。DOM XSSは「sourceからsinkまで、危険なデータが無害化されずに流れ込む」ことで成立します。

### ワークフロー1: 反射型XSSのようにDOM XSSを追う

#### canaryとは何か、なぜ「印」を追うのか

DOM Invaderの中核は**canary（カナリア）**と呼ぶ特徴的な英数字文字列です。ページのソース（URLパラメータ、フォーム、`postMessage`など）にこのcanaryを注入し、DOM Invaderがブラウザ内でJavaScriptの実行を計装（instrument）して、そのcanaryが「どのsinkに、どんな文脈で到達したか」を自動追跡します。公式ドキュメントはこの手法を「反射型XSS（サーバーが入力をそのまま応答に反射するタイプ）を探すのと同じ感覚でDOM XSSを見つけられる」と表現します。DOM XSSは本来、数千行のminified（圧縮難読化）コードの中でデータフローを追わねばならず難易度が高いのですが、canaryという目印を機械的に追跡させることで、その労力を劇的に減らせます。

> 出典: Testing for DOM XSS (DOM Invader) — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss

#### 手順: 注入 → sink特定 → 文脈把握

DOM InvaderはブラウザのDevTools内に専用タブとして常駐します。基本ワークフローは次の順です。

1. **canaryを取得して注入する。**
   - **手動注入**: DOM Invaderタブの「Copy canary」でcanary文字列をクリップボードにコピーし、クエリパラメータ・フォーム項目など任意のsourceに貼り付ける。
   - **自動注入（Inject URL params）**: 各クエリパラメータにcanaryを注入し、パラメータごとに別タブで一斉テストする。
   - **自動注入（Inject forms）**: ページ内で検出したHTMLフォームの各項目にcanaryを自動投入する（ただしフォームの送信自体は手動）。

   > 注意点として公式は、複数のsourceを同時にテストするとサイトの正常な動作が壊れる場合があるため、原則として1つずつ順番にテストすることを推奨しています。これは、canaryが本来数値や特定形式を期待するパラメータに入るとJavaScriptが例外で止まり、以降のデータフローが観測できなくなるためです。

2. **到達したsinkを特定する。** 注入後、DOM Invaderはcanaryを含むsinkを自動検出し、DOM view（拡張DOMのビュー）に**exploitability（悪用しやすさ）順にソート**して表示します。「どのsinkにcanaryが届いたか」がここで一覧化されます。

3. **文脈（context）を把握する。** これが最も重要です。単に「`innerHTML`に届いた」だけではペイロードは作れません。DOM Invaderは各sinkについて次を提示します。
   - そのsinkがHTMLとして解釈されるのか、JavaScriptとして実行されるのか（HTML sinkかJS実行sinkか）
   - canaryの前後を囲む特殊文字（クォート、タグ、属性など）
   - 適用されているバリデーション・サニタイズ・加工の有無
   - 外側のHTML構造（outer HTML）
   - フレームのパス（どのiframe内か）
   - 関連づけられたJavaScriptイベント

   canaryの後ろに特殊文字（例: `"`, `'`, `<`, `>`）を付け足して再注入すると、「何がエスケープ・エンコードされ、何が素通りするか」が判別でき、そこからそのsinkの文脈を破る（break out する）ためのペイロードを組み立てられます。たとえばcanaryが二重引用符付き属性値の内側に入っているなら、`"`が素通りするかどうかで属性を抜け出せるかが決まります。

> 出典: Testing for DOM XSS (DOM Invader) — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss

#### 入力がsinkに届かなくなったとき: スタックトレースで分岐を暴く

実際の診断では「あるペイロードは届くのに、少し変えると届かない」という壁に頻繁にぶつかります。途中にバリデーションや条件分岐があるからです。DOM Invaderはこの調査を次の手順で支援します。

1. 動作することが分かっているペイロードを注入する。
2. DOM view上の該当sinkの**Stack Traceリンク**をクリックする。
3. ブラウザのコンソールに完全なスタックトレース（呼び出し履歴）が出る。
4. トレースの最上段のリンクをクリックすると、入力がsinkに流れ込む**まさにその行のコード**にジャンプする。

この行の周辺を読むことで、「どの条件分岐（`if`）や正規表現によるチェックがペイロードを弾いているのか」を仕組みレベルで特定できます。なぜスタックトレースが効くかというと、DOM Invaderがsinkへの代入をフックしており、代入が発生した瞬間のJavaScriptコールスタックをそのまま記録しているためです。つまり「結果（sinkに届いた／届かない）」から「原因（どのコードパスを通ったか）」へと逆向きにたどれるわけです。ここで見つけた分岐条件を満たす形にペイロードを整形すれば、フィルタを回避できるかどうかが判断できます。

> 出典: Testing for DOM XSS (DOM Invader) — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss

#### 設定項目

DOM Invaderは、追跡対象のsource一覧・sink一覧・canary文字列そのもの・リダイレクト抑止（redirection prevention）・イベントの自動発火（auto-fire events）・`postMessage`傍受・プロトタイプ汚染検出などを細かくカスタマイズできます。たとえばリダイレクト抑止は、ページが`location`を書き換えて別ページへ飛ぼうとするのを止め、注入直後の状態を観察し続けるための機能です。イベント自動発火は、`onclick`等のイベントが起点となるsinkを、手動操作なしに発火させて到達を試すための機能です。

> 出典: Testing for DOM XSS (DOM Invader) — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss

### ワークフロー2: web message（postMessage）の改変・再送

#### なぜweb messageが危険なのか

`window.postMessage()`は、異なるオリジン（プロトコル・ホスト・ポートの組）のウィンドウやiframe間で文字列やオブジェクトを送り合うためのAPIです。受信側は`window.addEventListener('message', handler)`でハンドラを登録し、`event.data`（送られてきたデータ）、`event.origin`（送信元オリジン）、`event.source`（送信元ウィンドウ参照）を受け取ります。ここでの典型的な脆弱性は次の2つです。

- **オリジン検証の欠落・不備**: ハンドラが`event.origin`を一切見ない、あるいは`origin.indexOf('example.com') !== -1`のような甘い部分一致で済ませていると、攻撃者が用意した任意のページ（`example.com.attacker.net`など）からのメッセージを受理してしまう。
- **`event.data`のsinkへの流し込み**: 受け取ったデータをそのまま`innerHTML`や`eval`に渡すと、送信元を偽装できた攻撃者がDOM XSSを成立させられる。

DOM Invaderはこの2点を、実際にメッセージを改変・再送しながら検証します。

#### postMessage傍受の有効化

`postMessage`傍受はサイトの正常動作を阻害しうるため、デフォルトでは**無効**です。有効化手順は次の通りです。

1. DOM Invaderの設定メニューを開く。
2. **Postmessage interception**のスイッチをオンにする。
3. ブラウザをリロードして設定を反映する。

リロードが必要なのは、傍受がページ読み込みのごく初期（メッセージハンドラが登録される前）にフックを仕込む必要があるためです。

> 出典: Testing for DOM XSS using web messages (DOM Invader) — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages

#### Messagesビュー: 何が自動で行われるか

傍受を有効にすると、**Messages**ビューに傍受した`postMessage`呼び出しが並び、悪用の可能性があるものが自動でフラグ付けされます。DOM Invaderはこの際、次の2つの改変を自動で試みます。

- **canary注入**: メッセージの`data`プロパティにcanary文字列を差し込み、そのメッセージデータがsinkまで流れるかを追跡する。
- **オリジン偽装（origin spoofing）**: オリジンを「ターゲットに似せた偽ドメイン」に差し替えて送り、オリジン検証ロジックの不備を炙り出す。

各メッセージにはseverity（深刻度）とconfidence（確度）の評価が付き、すべてのメッセージは最低でも「Information」（情報）分類を受けます。

メッセージ詳細を開くと、次の「何がアクセスされたか」が観測できます。これがオリジン検証の有無を判定する鍵です。

- **Origin accessed（オリジンがアクセスされたか）**: クライアントコードがメッセージの送信元を検証しているかを示す。公式は明言します——「クライアント側のコードがメッセージの`origin`プロパティに一切アクセスしないなら、オリジンはおそらく検証されていない」。つまり、ハンドラ内で`event.origin`を読んだ形跡がなければ、送信元は誰でもよい＝オリジン偽装が通る可能性が高い、と機械的に判断できます。
- **Data accessed（データがアクセスされたか）**: ペイロードを運ぶ`data`フィールドがsinkまで流れているかを確認する。これが悪用の必須条件。
- **Source accessed（ソースがアクセスされたか）**: `window`参照（多くはiframe）が検証されているかを示す。

> 出典: Testing for DOM XSS using web messages (DOM Invader) — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages

#### 手動再送ワークフロー: Burp Repeaterのように

改変・再送の流れは、HTTPリクエストを繰り返し送るBurp Repeaterの操作感をそのまま`postMessage`に持ち込んだものです。

1. Messagesビューから対象メッセージの詳細を開く。
2. **Data**フィールドをテスト用ペイロードに編集する。
3. **Send**をクリックして改変済みメッセージを送信する。

これを繰り返し（iterate）、どの文字がエスケープされるか、どのエンコードが必要か、sinkがどう振る舞うかを一手ずつ確かめます。たとえば`data`にHTML断片を入れて再送し、それが`innerHTML`に届いて解釈されるなら、あとは文脈に合わせてペイロードを詰めるだけ、という具合に絞り込めます。

なお、オリジン検証が検出された場合、DOM Invaderは該当コード行へのスタックトレースを提示し、検証ロジックのどこにバイパスの余地があるか（甘い部分一致か、完全一致かなど）を調べる手がかりを与えます。canary注入とオリジン偽装は、特定のテストシナリオで邪魔になる場合、設定で個別に無効化できます。

#### PoCの生成

悪用可能と確認できたら、次の手順で概念実証（PoC: Proof of Concept）を作れます。

1. 脆弱なメッセージを選ぶ。
2. 値をエクスプロイトの形に書き換える。
3. **Build PoC**をクリックすると、`alert()`を発火させるような攻撃用HTMLが生成され、クリップボードにコピーされる。

このHTMLは「攻撃者ページから対象へ`postMessage`を送る」形の最小再現コードで、報告書に添付して修正を促すために使います（防御目的の再現に限る）。

> 出典: Testing for DOM XSS using web messages (DOM Invader) — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages

### ワークフロー3: プロトタイプ汚染のsourceとgadget走査

#### プロトタイプ汚染とは（前提の確認）

JavaScriptのオブジェクトは、`Object.prototype`という共通の祖先からプロパティを継承します。**プロトタイプ汚染（prototype pollution）**とは、攻撃者が`Object.prototype`に任意のプロパティ（例: `Object.prototype.isAdmin = true`）を書き込めてしまう脆弱性です。汚染されたプロパティは以降に作られるすべての普通のオブジェクトに継承されるため、アプリの意図しない挙動を引き起こします。単独では直ちに危険とは限りませんが、汚染したプロパティを実際に読んで危険な処理に使うコード——これを**gadget（ガジェット）**と呼びます——が存在すると、DOM XSSやその他の攻撃に連鎖します。DOM Invaderのクライアントサイド・プロトタイプ汚染検出機能は「source（汚染できる入口）」と「gadget（汚染を悪用する出口）」の両方を探します。

#### 有効化

プロトタイプ汚染検出も、対象サイトの動作を阻害しうるためデフォルト無効です。設定メニューの**Attack types**からこの機能を有効化し、ブラウザをリロードします。

> 出典: Testing for DOM XSS (prototype pollution / DOM Invader) — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/prototype-pollution

#### source検出と手動確認（Testボタン）

有効化するとDOM Invaderは自動でページを走査し、`Object.prototype`に任意プロパティを追加できるsourceを特定します。公式によれば、検査対象は「URL、およびweb message経由で送られるJSONオブジェクト」です。1つのsourceから複数の悪用テクニックを検出することもあり、ドキュメントの例では`location.hash`を使った2通りの手法を発見しています（URLのフラグメント`#`以降を、`__proto__[x]=y`のようなキー・値のペアとして解釈させる典型パターンです）。

potentialなsourceが見つかると、**Test**ボタンで検証できます。

1. DOM Invaderが新しいタブを開き、そのsourceを使って実際に`Object.prototype`を汚染する。
2. ブラウザのコンソールに、汚染後のプロトタイプの状態が自動表示される。
3. テスターは新しいオブジェクト（例: `let x = {}`）を作り、注入したプロパティが継承されているか（例: `x.injectedProp`が意図した値になっているか）を確認する。

この「別タブで実際に汚染して継承を確かめる」段階を踏むことで、gadget走査に進む前に汚染が本物かを切り分けられます。

#### gadget走査（Scan for gadgetsボタン）

sourceが確認できたら、次は「その汚染を悪用できる出口」を探します。手作業で全コードからgadgetを探すのは非常に骨が折れますが、**Scan for gadgets**ボタンがこれを自動化します。

- ボタンを押すとDOM Invaderは新しいタブを開き、適したgadgetの走査を開始する。
- 走査完了後、発見したgadget経由で到達可能なsinkを表示する。ドキュメントの例では`innerHTML`が挙げられている。

内部的には、DOM Invaderが多数の候補プロパティで`Object.prototype`を汚染した状態でページの処理を走らせ、「汚染したプロパティが最終的にsinkに読み込まれるか」を観測してgadgetを特定します。

#### エクスプロイト（Exploitボタン）

機能するgadgetとsinkの組み合わせが見つかると、**Exploit**ボタンが概念実証を生成し、`alert()`の実行成功によって脆弱性を確認できます。これで「source（例: `location.hash`で`__proto__`を汚染）→ gadget（汚染プロパティを読むコード）→ sink（`innerHTML`）」という一連のチェーンが、DOM Invader上で最初から最後まで裏付けられます。

> 出典: Testing for DOM XSS (prototype pollution / DOM Invader) — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/prototype-pollution

### 補完ツール: postMessage-tracker でハンドラ登録を可視化する

DOM Invaderは強力ですが、`postMessage`のハンドラ調査に特化した軽量ツールとして、Frans Rosénの**postMessage-tracker**（Chrome拡張、MITライセンス、OWASP AppSec Europe 2018で発表）を併用すると、「そもそもどのフレームがメッセージリスナーを登録しているか」の全体像を素早く掴めます。DOM Invaderが「メッセージを改変して届くか試す」ツールなのに対し、こちらは「リスナーの登録そのものを列挙・可視化する」偵察（recon）ツールという位置づけです。

> 出典: postMessage-tracker (Frans Rosén) — https://github.com/fransr/postMessage-tracker

#### 何をするか

- 現在のウィンドウに登録されている`message`リスナーの**数をアイコンのインジケータ**として表示する。
- **すべてのサブフレームをまたいで**リスナーを追跡し、ユーザー操作で一時的に登録される短命なリスナーも捕捉する（iframe内で一瞬だけ登録されて消えるハンドラは、手動では見つけにくいため、これが有用）。
- オプションで**Log URL**エンドポイントを設定すると、検出したリスナー情報を後で分析するために送信できる。
- ウィンドウ間のやり取りをコンソールに表示し、**メッセージを自分で再送（replay）するために使えるパス表記**でウィンドウを指定する。

このパス表記が肝で、拡張はウィンドウ階層を`top.frames[2].frames[0]`のような形で表現し、送信元と送信先を人間が読める形で示します。トップフレームと異なるウィンドウ文脈のときは`diffwin`と表記します。これにより「どのフレームからどのフレームへメッセージが飛んだか」を把握し、同じ経路で自分で再送して検証できます。

> 出典: postMessage-tracker (Frans Rosén) — https://github.com/fransr/postMessage-tracker

#### 仕組み: addEventListener と onmessage のフック

なぜサイト側のコードに手を入れずにリスナーを列挙できるのか。答えは、拡張がページ読み込みのごく初期（`run_at: document_start`）に、すべてのフレーム（`all_frames: true`）でリスナー登録APIを上書き（フック）しているからです。マニフェストは次の要点を持ちます（原典より）。

```json
{
  "manifest_version": 2,
  "permissions": ["tabs", "storage", "http://*/", "https://*/"],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content_script.js"],
    "run_at": "document_start",
    "all_frames": true
  }],
  "background": "background.js"
}
```

`document_start`で全フレームに注入されることが決定的に重要です。サイトのスクリプトが`addEventListener('message', ...)`を呼ぶ前にフックを仕込めるため、登録される瞬間を漏らさず捕捉できます。フックの中身は、`Window.prototype.addEventListener`を差し替える形です（原典より）。

```javascript
Window.prototype.addEventListener = function(type, listener, useCapture) {
    if (type == 'message') {
        // listenerが関数なら中身を文字列化してログ
        if (typeof listener == "function") {
            listener = unwrap(listener);
            l(listener, /* ... */);
        }
    }
    return msgeventlistener.apply(this, arguments);  // 本来の処理へ委譲
};
```

ポイントは最後の`msgeventlistener.apply(this, arguments)`です。フックは記録を取ったあと、必ず**元の`addEventListener`にそのまま処理を渡す**ため、サイトの動作を壊しません。同様に、`window.onmessage = ...`という代入形式のハンドラ登録も、セッター（setter）を差し替えて捕捉します（原典より）。

```javascript
window.__defineSetter__('onmessage', function(listener) {
    if (listener) {
        l(listener.toString());  // ハンドラ本体を文字列化してログ
    }
    original_setter(listener);   // 本来のセッターへ委譲
});
```

`addEventListener`形式だけでなく`onmessage`プロパティ代入形式も押さえることで、両方のハンドラ登録パターンを取りこぼしません。

#### エラー監視ラッパーの「巻き戻し」

実務で厄介なのは、多くのサイトがRaven（旧Sentry）・New Relic・Rollbar・Bugsnag・jQueryといったエラー監視/ユーティリティのラッパーでリスナーを包んでいる点です。素朴に文字列化すると、開発者が書いた本物のハンドラではなく、ラッパー関数のコードが表示されてしまい、どこがsinkかが見えません。postMessage-trackerはこれらのラッパーを検出し、内側の本物の関数を取り出して（unwrapして）表示します。検出は関数の文字列表現に対するパターンマッチで行われます（原典より、概念を示す抜粋）。

```javascript
var listener_str = originalFunctionToString.apply(listener);
if (listener_str.match(/\.deep.*apply.*captureException/s)) return 'raven';
// 以下、newrelic / rollbar / bugsnag / sentry などのパターンを判定
```

巻き戻し（unwrap）は、ラッパーが元関数を退避しているプロパティ——たとえば`listener["nr@original"]`（New Relic）や`listener.__sentry_original__`（Sentry）——から本体を復元します。匿名関数はChromeが文字列化できないため、`bound`という表記で示されます。捕捉したイベント情報は`CustomEvent('postMessageTracker')`として`document`にディスパッチされ、そこから`chrome.runtime.sendMessage()`で拡張本体（background）へ中継され、アイコンのバッジ表示やログ送信につながります。

なお、この拡張はXHTML名前空間で提供されるXMLファイルのDOMに紛れ込む挙動が過去に問題になりましたが、`document.contentType`が`application/xml`のときはコンテンツスクリプトをDOMに追加しないよう修正されています。

> 出典: postMessage-tracker (Frans Rosén) — https://github.com/fransr/postMessage-tracker

### まとめ: 3つのワークフローの接続

本節のワークフローは、実際のクライアントサイド診断で次のように連結して使います。

1. **偵察**: postMessage-trackerで、ページとサブフレームがどんな`message`リスナーを登録しているかを列挙し、`postMessage`の攻撃面（どのフレームが何を受け取るか）を把握する。DOM Invaderのイベント自動発火・source/sink一覧で、URL・フォーム・フラグメント由来の攻撃面も洗い出す。
2. **DOM XSS追跡（ワークフロー1）**: canaryを注入し、到達したsinkと文脈を特定。届かなければスタックトレースで分岐条件を暴き、フィルタ回避の可否を判断する。
3. **web message検証（ワークフロー2）**: 傍受を有効にしてMessagesビューを観察。`origin`が読まれていない（=検証されていない）メッセージを狙い、Dataを改変・再送してsink到達を確認し、Build PoCで再現コードを得る。
4. **prototype pollution検証（ワークフロー3）**: 汚染sourceをTestで確認し、Scan for gadgetsでgadget→sink（例: `innerHTML`）のチェーンを発見、Exploitで裏付ける。

DOM Invaderが自動でやってくれる「canary追跡」「オリジン偽装」「gadget走査」の各段階も、その裏では本節で説明したフック・スタックトレース・プロトタイプ操作といった素の仕組みが動いています。仕組みを理解しておくことで、ツールが「見つけられなかった」ときに、どこを手動で補えばよいか——たとえばリスナーがラッパーで包まれていないか、sourceがJSON以外の経路（`WebSocket`や`localStorage`）から来ていないか——を判断できるようになります。これらの検証は必ず、許可された防御目的の環境に限って行ってください。
