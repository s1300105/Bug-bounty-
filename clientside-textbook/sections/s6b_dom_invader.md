## DOM Invader の仕組みとcanary追跡

DOM型XSS（DOM-based XSS）は、反射型（reflected）XSSや格納型（stored）XSSと違い、脆弱なコードがサーバーレスポンスの中に現れない。攻撃者が制御できる入力（source、入力の出発点）から、危険な処理へ渡される変数（sink、入力が最終的に実行・解釈される危険な代入先）までの流れが、すべてブラウザ上のJavaScriptの中だけで完結してしまうためだ。ミニファイされ難読化された数千行のバンドルJSの中から、どの変数がどのsourceに由来し、どのsinkに流れ込むかを手作業で追うのは非現実的な作業量になる。

DOM Invaderは、この「source→sinkの追跡」という本質的に困難な作業を自動化するために、PortSwiggerのBurp Suite内蔵ブラウザ（Chromiumベース）に組み込まれたブラウザ拡張機能である。DevToolsに専用パネルとして追加され、ページを普通に操作しているだけでDOM型脆弱性の手がかりを収集してくれる。本節では、その中核メカニズムである「拡張DOM（Augmented DOM）」と「canary（カナリア）によるsource/sink追跡」の仕組みを、原理レベルで解説する。

### DOM Invaderが解決する問題

まず前提として、DOM型XSSの手動診断がなぜ難しいかを整理しておく。

- サーバーサイドの反射型XSSであれば、リクエストに入れた文字列がレスポンスHTMLのどこに出現するかをBurpのレスポンスビューで直接確認できる。
- しかしDOM型の場合、入力は`location.hash`や`document.referrer`のようなDOM API経由でJavaScriptに読み込まれ、複数の関数・ライブラリを経由して変形されたのち、`innerHTML`代入や`eval()`呼び出しのような危険な操作（sink）に到達する。この経路はレスポンスHTMLを見ても分からず、実行時のJavaScript内部状態を追わないと発見できない。

DOM Invaderは、この「実行時に何が起きているか」をブラウザに介入して可視化することで、DOM型XSSを実質的に反射型XSSのように検査できる状態に落とし込む、という設計思想を持つ。PortSwiggerの紹介記事はこれを次のように説明している。

> DOM Invaderの狙いは、拡張DOM機能によってDOM XSSを反射型XSSと同じような感覚で検出可能にすることである。従来は開発者がChrome DevToolsのイベントリスナーやブレークポイント機能に頼っていたが、変数の中身を確認するにも手作業でJavaScriptを書いて調べる必要があった。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader

### 拡張DOM（Augmented DOM）とは何か

「拡張DOM」とは、実際のDOMツリーに対してDOM Invaderが情報を上乗せ（オーグメント）して表示する、専用のツリービューのことである。通常のDevToolsの「Elements」パネルはHTML要素の階層構造しか見せないが、拡張DOMビューでは、ページ内でDOM Invaderが検出したsourceとsinkが階層構造の中にマーキングされて表示される。

具体的には、DOM Invaderはページ読み込み時および実行時に、JavaScriptエンジンのグローバルオブジェクトやDOM APIに対してフック（横取り処理）を仕込む。これにより、

1. `location`、`location.href`、`location.hash`、`location.search`、`document.URL`、`window.name`、`document.referrer`、`document.cookie`といった、攻撃者が値を操作しやすい代表的なsourceへのアクセスを監視する。
2. `eval`、`jQuery.globalEval`のようなコード実行系の関数呼び出しや、`location.search`への再代入のようなsink相当の操作を監視する。

PortSwiggerのブログ記事では、これらのsinkに「危険度ランキング」が付与されていることが示されている。

> ソースの一覧には、`location`、`location.href`、`location.hash`、`location.search`、`document.URL`、`window.name`、`document.referrer`、`document.cookie`が含まれる。シンクは危険度によってランク付けされており、`eval`はランク2、`jQuery.globalEval`はランク1、比較的危険度の低い`location.search`のような書き込み先はランク83といった具合に序列化されている。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader

このランキングの仕組みには明確な理由がある。難読化されたバンドルJSでは、sinkとして扱いうる操作（DOM書き換え、URL遷移、コード実行など）が非常に多数存在し、そのすべてを均等に人間がチェックするのは現実的でない。そこで「攻撃者が最終的にコード実行やスクリプト注入まで到達できる可能性が高い順」に低い数値（ランク1、2…）を割り当て、拡張DOMビュー上で優先的に表示することで、診断者は最も危険なsinkから順に確認していけばよくなる。これは静的解析ツールにおける「重大度スコアリング」と同じ発想であり、ノイズの多い自動検出結果から人間の注意力を効率的に配分するための工夫である。

拡張DOMビューでは、あるsinkに実際に攻撃者制御可能な値（後述のcanaryを含む値）が到達していることが確認できた場合、そのsinkがハイライト表示され、「どのXSSコンテキストに出力されているか（HTML本文、HTML属性、JavaScript文字列リテラル、URLなど）」と「どのようなサニタイズ処理を経て出力されているか（HTMLエンティティエンコードされているか、そのまま出力されているか等）」が併記される。これにより診断者は、単に「sourceからsinkへ到達した」という事実だけでなく、「その経路で実際に攻撃可能なコンテキストが残っているか」まで一度に判断できる。

### canaryによるsource/sink追跡の仕組み

DOM Invaderの中核アイデアが「canary」である。canaryとは、ある入力が実行時にsink内のどこに反映されるかを追跡するために使われる、一意な（ユニークな）識別文字列である。

> canaryは、ユーザー入力がsinkのどこに反映されているかを追跡するために使われる一意な文字列である。デフォルトではDOM Invaderがランダムな値を生成するが、この値は任意の文字列にカスタマイズできる。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader

仕組みを分解すると次のようになる。

1. **canaryの生成**: DOM Invaderは診断開始時に、他の文字列と衝突しにくいランダムな文字列（例えば`domInvaderCanary1234`のような形式）を1つ生成する。これがそのセッションの「合言葉」になる。canaryはBurpのDOM Invader設定パネル（Canary settings）でユーザーが任意の値に変更することもできる。固定値にしておくと、複数回のテストを跨いで同じ文字列で検索・grepしやすくなるという実務上の利点がある。
2. **sourceへの自動注入**: DOM Invaderは、監視対象のsource（`location.search`や`location.hash`など、URLやフォーム経由でユーザーが操作可能な値）に対して、このcanary文字列を実際に注入する。たとえばURLのクエリパラメータやハッシュフラグメント、あるいはページ内のフォーム要素の値に、DOM Invaderが自動的にcanary文字列を書き込む形でページを操作する。これは、診断者が手作業で「このパラメータにテスト文字列を入れて、次にこのパラメータにも入れて…」と一つずつ試す作業を代替するものである。
3. **sinkでの検出**: ページの実行が進み、JavaScriptが何らかの処理を経てDOM操作や関数呼び出し（sink）を行うと、DOM Invaderはフックしている各sinkに渡ってくる値の中にcanary文字列（またはその変形）が含まれていないかを検査する。含まれていれば、「このsourceからこのsinkまで、攻撃者が制御可能な値が到達する経路が存在する」ことが実証されたことになり、拡張DOMビュー上でそのsinkがcanaryとともにハイライトされる。

この「一意な文字列を入れて、出力側でその文字列（の痕跡）を探す」という手法自体は、手動ペネトレーションテストにおける古典的なテクニック（例えばランダムな英数字列をパラメータに入れてレスポンス中を検索する）と同じ原理である。DOM Invaderの価値は、この作業をJavaScript実行時のsinkレベルまで自動化し、かつ複数のsource・sinkの組み合わせを同時並行で監視できる点にある。

さらに重要な工夫として、DOM Invaderはcanary文字列だけでなく、「canaryに追加の文字を付与した値」を使ってエンコード処理の有無を検証するプロセスを組み込んでいる。たとえばcanaryの末尾に`<`や`"`のような、HTMLコンテキストで意味を持つ特殊文字（メタキャラクタ）を付加した値を注入し、その値がsinkに到達した際にエンコードされずそのまま出現するか、あるいはHTMLエンティティ化（`&lt;`のような変換）されているかを比較する。これにより、単に「到達する」だけでなく「サニタイズされずに到達する」という、実際に悪用可能かどうかの判定材料まで得られる。これは実務上decisiveな違いで、到達するがエンコードされているsinkは（少なくともそのエンコード方式が正しい前提では）安全であり、優先度を下げて良いと判断できる。

### Web messageの傍受と再送信

DOM Invaderはpostmessageベースの脆弱性も対象にしている。`window.postMessage()`によってページ間・フレーム間でやり取りされるメッセージは、送信元オリジンの検証漏れや`data`の内容検証漏れによってDOM XSSやプロトタイプ汚染の入口になりやすい、代表的なDOM型sourceの一つである。

> postmessageインターセプション機能により、Webメッセージの型、送信元オリジン、実際のデータ内容、スタックトレースを可視化でき、オリジンをスプーフィング（偽装）した状態での検証も行える。

> 出典: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader

これにより診断者は、ページが受信したメッセージのログを一覧し、任意のメッセージを選んで内容（`data`フィールド）や送信元オリジンを書き換えたうえで再送信できる。これは、実際の攻撃者が悪意あるiframeや別ウィンドウから偽装メッセージを送りつける状況を、ブラウザ内で安全に再現するための機能であり、「送信元検証の欠落」（`event.origin`のチェック漏れ）という典型的な脆弱性パターンを、実際にコードを書かずに検証できる。

### プロトタイプ汚染とDOM clobberingの自動検出

DOM Invaderのドキュメントは、クライアントサイドのプロトタイプ汚染（prototype pollution）とDOM clobberingについても自動検出機能を持つとしている。

> augmented DOM viewは操作可能なsinkを自動識別し、XSSコンテキストと入力のサニタイズ方法を表示する。また、プロトタイプ汚染のsourceを自動的に識別し、悪用可能なgadget（汚染された値を最終的に危険な処理へ伝播させるコード経路）を走査する。DOM clobbering脆弱性についても自動検出を行う。

> 出典: DOM Invader（公式ドキュメント） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader

プロトタイプ汚染の検出は、canaryと同様の考え方を`Object.prototype`のプロパティに対して適用したものと理解するとよい。DOM Invaderは、URLパラメータ経由で`__proto__.<プロパティ名>`のような形の入力を受け取り、それが実際に`Object.prototype`まで汚染として伝播するかどうかをsource側で検出する（プロトタイプ汚染のsource探索）。そのうえで、汚染された値を読み取って危険な処理（`innerHTML`代入や`eval`実行など）に渡してしまうコードパス、いわゆる「gadget」を、ページ内の既存コードを実際に動かしながら探索する。汚染source単体では実害がなくても、gadgetと組み合わさって初めてXSSやコード実行に発展するため、この「source探索」と「gadget探索」を分離しつつ両方自動化している点が実務上重要である。

DOM clobberingは、攻撃者が挿入したHTML要素の`id`や`name`属性を使って、本来JavaScriptのグローバル変数やDOM APIプロパティであるべき名前を、DOM要素の参照で上書き（clobbering、「潰す」）してしまう手法である。たとえば`<img name="config">`のような要素が存在すると、`window.config`が本来の値ではなくその`<img>`要素への参照に置き換わってしまうことがある。これを悪用したコードインジェクションは静的解析でもcanary手法でも見つけにくいが、DOM Invaderは既知のclobbering可能なパターン（id/name属性による既存プロパティの上書きが可能な箇所）を実行時に走査することで自動検出を試みる。

### 有効化と設定項目

DOM Invaderを利用するには、Burp Suite内蔵ブラウザでDevToolsを開き、「DOM Invader」タブを選択したうえで拡張機能を有効化する。設定パネルは複数のカテゴリに分かれており、公式ドキュメントの目次には次のセクションが列挙されている。

- Main settings（DOM Invader全体の有効/無効、対象ドメインの絞り込みなど基本設定）
- Attack types（DOM XSS、Web message経由のDOM XSS、プロトタイプ汚染、DOM clobberingのどれを監視対象にするかの選択）
- Web message settings（postmessage傍受の挙動設定）
- Prototype pollution settings（プロトタイプ汚染source/gadget探索の挙動設定）
- Misc settings（その他の細かな挙動設定）
- Canary settings（canary文字列そのものをランダム生成にするかカスタム値にするかの切り替え）

> 出典: DOM Invader（公式ドキュメント） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader

> ⚠️ **未取得の資料**: 公式ドキュメントページ内の「Enabling DOM Invader」「Canary settings」など各サブセクションの本文（具体的なクリック手順やUIスクリーンショットの説明文）は、自動取得の要約では省略・簡略化され、詳細な逐語テキストは取得できませんでした（理由: ページ本体がリンク集中心の構成で、サブページごとの詳細説明がトップレベルの自動抽出に含まれなかったため）。正確なUI操作手順は以下のURLからご自身で直接ご覧ください: https://portswigger.net/burp/documentation/desktop/tools/dom-invader
>
> （以下は未取得資料の補足として一般知識に基づく解説です）実務上は、Burpの内蔵ブラウザでDevToolsを開き「DOM Invader」タブに切り替えると初回はツールの無効化状態になっているため、まず有効化トグルをオンにする。次に「Attack types」で今回の診断対象（例えばDOM XSSとプロトタイプ汚染のみ、など）を絞り込むと、拡張DOMビューに表示されるノイズを減らせる。canary値は、複数タブ・複数セッションで同一の値を使い回したい場合や、ログ・HTTP履歴上で目視しやすい独自の識別子（例えば診断案件名を含む文字列）にしたい場合に、Canary settingsからカスタム値へ切り替えるとよい。ランダム値のままにしておくと、テストのたびに異なるcanaryが生成されるため、複数回の診断ログを横断してgrepする際に不便になることがある。

### 診断ワークフローとしての使い方（防御的検証の範囲内で）

DOM Invaderを使った典型的な調査の流れは次のようになる。これはあくまで自組織が保有する、または明示的にテスト許可を得たアプリケーションに対して行う前提の一般的な手順である。

1. 対象ページをBurp内蔵ブラウザで開き、DOM InvaderのAttack typesで確認したい脆弱性クラス（DOM XSS、Web message、プロトタイプ汚染、DOM clobbering）を選択する。
2. ページを通常操作どおりに一通り触る（URLパラメータの変化するリンクをクリックする、フォームを送信する、SPAの各画面を遷移するなど）。この過程でDOM Invaderがsourceにcanaryを注入し、sinkでの出現を監視する。
3. 拡張DOMビューを確認し、ランク値の低い（危険度の高い）sinkから順に、canaryが到達しているかどうか、到達している場合はエンコードされているかどうかを確認する。
4. postmessageを利用する画面では、Web messageログでオリジン検証の有無を確認し、必要に応じてオリジンやdataを書き換えて再送信し、挙動を観察する。
5. プロトタイプ汚染やDOM clobberingについては、自動検出結果として提示されたsourceとgadgetの組を確認し、実際にsinkまで到達する具体的な入力値の組み合わせを特定する。

いずれの段階でも、DOM Invaderが提示するのは「到達可能性の証拠（canaryが痕跡として残っているという事実）」であり、それをもって直ちに悪用可能と断定するのではなく、実際のコンテキスト（HTML本文かJS文字列かURLか）とサニタイズの有無を人間が最終確認する、という位置づけで使うのが正しい運用である。

### まとめ

DOM Invaderは、DOM型XSSの検出を難しくしている「実行時にしか観測できない source→sink の経路」という根本課題に対して、(1) 拡張DOMによる危険度ランキング付きの可視化と、(2) 一意な識別文字列（canary）をsourceに注入しsink側での出現・エンコード状況を追跡する、という2つの仕組みを組み合わせて解決するツールである。この設計思想は2021年6月の公開当初（Gareth Heyes氏によるブログ記事「Introducing DOM Invader」で発表）から一貫しており、その後Web message傍受、プロトタイプ汚染source/gadget探索、DOM clobbering自動検出へと機能が拡張されてきた。canaryという単純な「マーカー文字列を仕込んで痕跡を追う」という古典的な発想を、ブラウザ実行時のフックという形で自動化・スケールさせた点が、このツールの本質的な価値である。
