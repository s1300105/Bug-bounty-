## DOM Invader補足（HackTricks / Medium）

DOM Invaderは、Burp Suite Professional/Community 2023年以降のバージョンに同梱されている、DOM Invaderという名の**ブラウザ内蔵型の解析ツール**です。Burpの組み込みブラウザ（Chromiumベース）に拡張機能としてプリインストールされており、DOMベースXSS・クライアントサイドprototype pollution・DOM clobberingという3系統の脆弱性を、手動でJavaScriptコードを1行1行追わなくても発見できるように設計されています。本節では、公式のPortSwiggerドキュメントで機能・操作手順を正確に押さえたうえで、HackTricksとMedium記事が強調している実践的なワークフローを補足します。ラボの具体的な攻略手順（どのペイロードでどのラボを解くか）には立ち入らず、あくまで**ツールの仕組みと使い方**に焦点を当てます。

### DOM Invaderとは何か、なぜ必要か

古典的な反射型XSSは「サーバのHTTPレスポンスに攻撃者の入力がそのまま出力される」というモデルで説明できるため、Burp Proxyの履歴やRepeaterで入出力を突き合わせれば発見できます。しかしDOMベースXSSは違います。攻撃者の入力（`location.hash`、`document.referrer`、`postMessage`のデータなど）はサーバを経由せず、**ブラウザ内のJavaScriptが直接読み取り、DOM操作用の危険なAPI（sink）に渡す**ことで初めて脆弱性になります。つまり脆弱性の発生地点はHTTPレスポンスの中ではなく、実行時のJavaScriptの制御フローの中にあります。

このため、DOMベースXSSを見つけるには本来「ページ内の全JavaScriptを読み、どの変数がユーザ入力に由来し、それがどの危険な関数に渡っているか」をソースコードレベルで追跡する必要があり、難読化されたコードやバンドルされたコードでは非常に手間がかかります。DOM Invaderはこの追跡作業を自動化し、ブラウザが実際にコードを実行する瞬間にsource/sinkの経路を計装（instrument）して捕捉します。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

### 有効化の手順（公式ドキュメントに基づく正確な操作）

DOM InvaderはBurpの組み込みブラウザに標準搭載されていますが、**デフォルトでは無効**になっています。誤って一般サイトの動作を妨げないようにするための安全策です。有効化手順は次の通りです。

1. Burp Suiteの「Proxy」タブ内「Intercept」から、組み込みブラウザ（Burpのブラウザ）を起動する。
2. ブラウザ右上のBurp Suiteロゴ（パズルピースアイコン）をクリックする。ロゴが見えない場合は、拡張機能アイコンからジグソーパズルのアイコンを探してクリックする。これで「Navigation Recorder」と「DOM Invader settings」の2つのパネルが開く。
3. 「DOM Invader settings」の中の "**DOM Invader is on**" というトグルスイッチをオンにする。
4. 「Reload」ボタンをクリックして設定変更をページに反映させる（DOM Invaderはページ読み込み時にJavaScriptを計装する仕組みのため、既に開いているページには反映されない）。
5. ブラウザ上で右クリック→「Inspect」でDevToolsを開くと、新しく「DOM Invader」タブが追加されている。パネルはDevToolsの下部にドッキングしておくと最も使いやすい。

さらに、「Settings > Tools > Burp's browser」で「**Store settings and history after closing**」をオフにしておくと、DOM Invaderの状態（有効化フラグやcanary値など）がブラウザを閉じた際にリセットされる。逆にオンのままにしておけば設定が永続化される。

> 出典: PortSwigger公式ドキュメント（Enabling DOM Invader） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/enabling

### canary（カナリア）という中核概念

DOM Invaderの動作原理の核は「**canary**」と呼ばれる、通常の利用者の入力には決して現れないユニークな英数字文字列です。PortSwigger公式は次のように定義しています。

> 「an arbitrary but distinct string of alphanumeric characters that you can inject into different sources to see which sinks they flow into」（さまざまなソースに注入し、それがどのシンクに流れ込むかを観察するための、任意だが他と区別できる英数字文字列）

デフォルト値はツールによって`burpdomxss`のような固定文字列が使われることが多く（Medium記事では初期値の例として言及）、設定画面からカスタムの値に変更できます。HackTricksが強調しているポイントとして、**canaryの値は他の一般的な文字列（`test`など）と被らない、十分にユニークな文字列にすべき**という注意があります。理由は単純で、ページ内のJavaScriptやCSSセレクタ、正規表現の中にたまたま`test`という文字列が既に存在していると、DOM Invaderがそれを「注入した入力がsinkに到達した」と誤検知（false positive）してしまうためです。ユニークなcanaryを使うことで、DOMツリー内に出現する箇所は「本当に自分が注入した経路」だけに限定できます。

canary文字列はDevToolsのDOM Invaderパネル左上に常に表示されており、これを見ながら「今どの文字列を追跡しているか」を確認する運用になります。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html
> 出典: DOM Invader: Burp Suite tool to find DOM based XSS easily — Medium (hacksheets) — https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44

### DOM XSS検出の仕組みとワークフロー

#### 注入方法

DOM Invaderはcanaryをページに送り込む方法として複数の手段を用意しています。

- **手動注入**: 開発者自身がURLのクエリパラメータやフォーム入力欄に、DevToolsパネルからコピーしたcanary文字列を貼り付ける。
- **Inject URL params**: DOM Invaderが自動的にページ内のクエリパラメータ一つひとつにcanaryを注入し、それぞれ別タブで開いて結果を観察する。手動で全パラメータを試す手間を省ける。
- **Inject forms**: ページ内のHTMLフォームフィールドに自動的にcanaryを注入して送信する。

#### sinkの自動検出とコンテキスト表示

canaryが注入されたページがロードされると、DOM Invaderは**DOMを解析し、canary文字列がどのsink（危険なAPI呼び出し）に流れ込んでいるかを自動的に特定**します。検出結果は関連度順にソートされて一覧表示されます。

各検出結果に対して、DOM Invaderは次のようなコンテキスト情報を提示します。

- そのsinkがHTMLコンテキストなのかJavaScriptコンテキストなのか（例えば`innerHTML`に代入されるのか、`eval()`に渡されるのか、で必要なペイロードの形が変わる）。
- 注入した文字列の前後にどのような特殊文字が存在するか（属性値の中なのか、タグの外なのか、JS文字列リテラルの中なのかを見分けるために重要）。
- sinkの種類に応じて「Outer HTML」（周辺のHTML構造）、「Frame path」（iframeのネストがある場合の経路）、「Event」（イベントハンドラ経由の場合、どのイベントが引き金か）といった付加情報。

さらに「**Check the Stack Trace in DevTools Console**」の機能により、canaryがsinkに到達する直前のJavaScript呼び出しスタックをそのままDevToolsコンソールに表示させ、**該当するソースコードの行に直接ジャンプ**できます。これにより、脆弱性が「本当にサニタイズされずにsinkへ届いているか」をコード上で確認し、実際に有効なXSSペイロードを組み立てる段階に進めます。

> 出典: PortSwigger公式ドキュメント（DOM XSS） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
> 出典: DOM Invader: Burp Suite tool to find DOM based XSS easily — Medium (hacksheets) — https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44

#### Medium記事が示す一連の操作フロー

Medium記事（hacksheets）は、初学者向けに以下の6ステップの実践フローとしてまとめています（ラボの解答そのものではなく、汎用的な手順として引用します）。

1. Burpの「Proxy」タブから組み込みブラウザを開き、拡張機能設定からDOM Invaderを有効化する。
2. 必要であればcanary文字列を分かりやすい値（記事の例では`hacksheetsdomxss`のような識別しやすい文字列）に変更し、リロードする。
3. DevToolsを開き（`Ctrl+Shift+I`）、「DOM Invader」タブ（記事内ではAugmented DOM Tabと呼ばれるDOMビュー）を表示する。
4. 対象ページを開き、疑わしいクエリパラメータにcanaryを注入する。
5. DOM Invaderのパネルで、注入したcanaryが何らかのsinkに反映されているかを確認する。
6. sinkに到達していることが確認できたら、DevToolsコンソール側でスタックトレースを辿り、実行箇所を特定したうえで、実際に動作するXSSペイロードへ組み替えて検証する。

このフローの意義は、「どこに脆弱性があるか」を機械的に絞り込んだうえで、「実際に悪用可能か」の判断と最終的なペイロード作成は引き続き人間が行う、という役割分担にあります。DOM Invaderは発見（discovery）を効率化するツールであり、悪用可能性の最終判定やCSPバイパスの組み立てそのものは代行しません。

> 出典: DOM Invader: Burp Suite tool to find DOM based XSS easily — Medium (hacksheets) — https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44

### クライアントサイドprototype pollutionの自動検出

DOM InvaderはXSS検出だけでなく、**クライアントサイドprototype pollution**（JavaScriptの`Object.prototype`に任意のプロパティを追加できてしまう脆弱性クラス）の発見も自動化します。これは第4章で扱うmXSS/プロトタイプ汚染の話題とも接続する重要な機能です。

#### ソース検出

有効化するには、DOM Invader設定の「Attack types」セクション内で「**Prototype pollution**」のトグルをオンにし、リロードする必要があります（これもデフォルトでは無効。理由はDOM XSS検出と同様、対象サイトの通常動作に干渉しないようにするためです）。

有効化後、DOM Invaderはページを自動的にスキャンし、「`Object.prototype`に任意のプロパティを追加できる可能性のある経路（ソース）」を探索します。公式ドキュメントが例示する典型例は、URLの`location.hash`（フラグメント識別子）を経由するもので、`__proto__.xxx=yyy`のようなキーをフラグメントに含めたときに、ページ内のマージ処理コード（例えばjQueryの拡張関数や独自実装のdeep-mergeユーティリティ）が`__proto__`という特別なキー名をチェックせずにオブジェクトへ代入してしまうケースです。この種のコードは次のような形になっていることが多いです。

```javascript
// 危険なマージ処理の典型例（概念コード）
function merge(target, source) {
  for (const key in source) {
    if (typeof source[key] === 'object') {
      target[key] = target[key] || {};
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
```

このコードに`source`として`{"__proto__": {"polluted": "yes"}}`のようなオブジェクトを渡すと、`target.__proto__`（すなわち`Object.prototype`そのもの）に`polluted`プロパティが追加され、以降**そのページ内で生成される全てのオブジェクトが`polluted`プロパティを継承してしまいます**。これがプロトタイプ汚染の基本原理です。DOM Invaderはこのような危険なマージ処理をブラウザ実行時に検知します。

#### 検証（Test）とgadget探索

ソースが検出されると、DOM Invaderは「**Test**」ボタンを提示します。これをクリックすると新しいタブが開き、DOM Invaderが実際に検証用のプロパティ（proof-of-concept property）を`Object.prototype`に追加しようと試みます。ブラウザのコンソールを開いて`Object.prototype`を調べたり、新しいオブジェクトリテラル`{}`を作成してそのプロパティが継承されているかを確認したりすることで、汚染が実際に成立するかを人間の目で確かめられます。

汚染そのものが成立しても、それだけでは「見た目が変わる」以上の実害はまだありません。実際にXSSなどへ昇華させるには、汚染したプロパティを**サニタイズせずに危険なsinkへ渡してしまうコード（gadget）**が別途ページ内に存在する必要があります。DOM Invaderの用語で言う「gadget」とは、公式ドキュメントの定義を借りれば「any user-controllable property that is passed to a sink without being properly sanitized」（サニタイズされずにsinkへ渡される、ユーザーが制御可能なプロパティ）です。

DOM Invaderは「**Scan for gadgets**」ボタンにより、この汚染可能なプロパティ経由でsinkに到達しうるgadgetを自動的に探索し、見つかったsinkをDevToolsパネルに一覧表示します。さらに、ソース・gadget・sinkの3点が揃うと、DOM Invaderは「**それらを組み合わせたPoC（概念実証コード）を自動生成**」する機能まで備えています。これにより、手作業でsourceからsinkまでの実行チェーンを1つずつ追跡する必要がなくなり、「汚染可能な入り口はあるが、実際に悪用可能なgadgetが存在するか」という、従来は非常に時間のかかっていた確認作業が大幅に効率化されます。

HackTricksでは2023年6月版（v2023.6）のBurp Suiteで、専用の「Prototype-pollution」タブが追加され、`__proto__`や`constructor.prototype`といった典型的なプロトタイプ汚染用キー名をパラメータ名に対して自動的に変異（mutate）させ、sink地点での汚染発生を検出する機能が実装されたと説明されています。これはDOM Invaderが単なる「文字列追跡ツール」ではなく、JavaScriptのオブジェクトモデル（プロトタイプチェーン）の挙動そのものを実行時に監視する設計になっていることを示しています。

> 出典: PortSwigger公式ドキュメント（Prototype pollution） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/prototype-pollution
> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

### web message（postMessage）の解析機能

第3章の他節で扱う`postMessage`ベースのDOM XSSについて、DOM Invaderは専用の解析パネルを持ちます。設定の「Attack types」内の「**Postmessage interception**」をオンにしてリロードすると、以下の機能が有効になります。

- **ロギング**: ページ上で`postMessage()`メソッドにより送信された全てのweb messageを記録する。
- **手動編集・再送信**: Burp Repeaterのように、記録したメッセージの内容を書き換えて再送信できる。具体的には「Messages」ビューで対象メッセージを選択し、「Data」フィールドの中身を書き換えたうえで「Send」をクリックする。
- **自動解析**: DOM Invaderは2つの方法で自動的にメッセージを改変し、脆弱性の兆候を探る。
  1. **canaryをメッセージの`data`プロパティに注入**し、脆弱なsinkに到達するかを調べる。
  2. **メッセージの送信元origin情報を偽のoriginに置き換え**、受信側の`postMessage`イベントリスナーが`event.origin`の検証をきちんと行っているか（バリデーションの不備）を検出する。

脆弱性が確認できた場合は、「**Build PoC**」をクリックすることで、悪用可能なHTMLコードが自動生成されクリップボードにコピーされます。これは、攻撃者が用意した悪意あるページから被害者のタブへ偽装メッセージを送りつける、という典型的なpostMessage攻撃の雛形を素早く作るための機能です。

> 出典: PortSwigger公式ドキュメント（Web messages） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages

### DOM clobberingの自動検出

DOM Invaderはさらに、DOM clobbering（HTMLタグのid属性やname属性を利用して、ページ内のJavaScript変数を意図せず上書き・偽装する手法。第4章で詳述）の自動検出にも対応しています。公式ドキュメントの定義は簡潔に「DOM clobbering is a technique in which you inject HTML into a page to manipulate the DOM」（ページにHTMLを注入することでDOMを操作する手法）としています。

有効化するには、設定の「Attack types」内で「**DOM clobbering**」のトグルをオンにし、ブラウザをリロードします。有効化後は、通常のブラウジング中に自動的にDOM clobberingの脆弱性パターンをスキャンします。これも他の攻撃タイプ同様デフォルトでは無効であり、対象サイトの挙動を不用意に変えないための配慮です。

> 出典: PortSwigger公式ドキュメント（DOM Clobbering） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-clobbering

### 設定項目の全体像

PortSwigger公式ドキュメントによれば、DOM Invaderの設定パネル（ブラウザ右上のBurp Suiteロゴをクリックして開く「DOM Invader」タブ）は次の6カテゴリに整理されています。

1. **Main settings** — DOM Invader全体のオン/オフなど基本設定。
2. **Attack types** — DOM XSS、Prototype pollution、DOM clobbering、Postmessage interceptionなど、どの検出機能を有効にするかを個別に切り替える。
3. **Web message settings** — postMessage解析に関する詳細オプション。
4. **Prototype pollution settings** — プロトタイプ汚染検出に関する詳細オプション（対象プロパティ名の絞り込みなど）。
5. **Misc settings** — その他雑多な設定。
6. **Canary settings** — canary文字列のカスタマイズや、注入対象とするソース・パラメータのアローリスト（許可リスト）設定。

HackTricksの解説では、canary設定において「全ソースへの自動注入」を有効にできる一方で、**注入対象のソースやパラメータ名をアローリストで絞り込む設定も可能**であると触れられています。大規模なSPA（Single Page Application）など、あらゆるパラメータに自動注入すると誤検知やノイズが増えすぎる場合、対象を絞ることで実務上のシグナル/ノイズ比を改善できます。

> 出典: PortSwigger公式ドキュメント（DOM Invader Settings） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings
> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

### Burp Repeater/Proxyとの連携という実務上の勘所

HackTricksが指摘している実務上重要なポイントとして、DOM Invaderは単体で完結するツールではなく、**Burp RepeaterやProxyと組み合わせて使う**ことで真価を発揮します。DOM Invaderのブラウザ内での検出は「ブラウザの実行時状態」に基づくものであり、それを引き起こした「HTTPリクエスト/レスポンスの組」を再現できなければ、報告書やチーム内共有のための再現手順が書けません。そのため実際のワークフローでは、

1. Burpの組み込みブラウザ上でDOM Invaderにより脆弱なsinkを特定する。
2. Burp Proxyの履歴から、そのページ・パラメータに対応するHTTPリクエストを特定する。
3. Burp Repeaterでそのリクエストを再現し、微修正しながら最終的なペイロードを固める。

という一連の流れが推奨されます。DOM Invaderは「どこに脆弱性がありそうか」を高速に絞り込む探索ツールであり、最終的な悪用可能性の確認と報告用の再現手順の確立は、従来通りBurpの他の機能と組み合わせて行う、という位置づけを正しく理解しておくことが重要です。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

### まとめ

DOM Invaderは、DOMベースXSS・クライアントサイドprototype pollution・DOM clobbering・postMessage関連の脆弱性という、いずれも「ブラウザの実行時にしか観測できない」タイプの脆弱性クラスに対して、canaryという追跡可能な文字列を軸に、ソースからsinkまでの実行経路を自動計測・可視化するツールです。有効化はデフォルトでオフになっており、Attack typesごとに個別にオン/オフを切り替え、そのたびにブラウザのリロードが必要という運用上の癖があります。canaryは他の文字列と衝突しないユニークな値を選ぶことが誤検知を避けるうえで重要であり、prototype pollutionについては「汚染可能なソースの発見」と「実害につながるgadgetの発見」が別工程として提供されている点、postMessageについては「ロギング・改変再送・自動解析・PoC生成」までが一気通貫でサポートされている点が実務上の強みです。最終的な悪用可能性の判断とレポーティングのための再現手順は、引き続きBurp Repeater/Proxyとの連携によって固めることになります。
