# DOM Invader 完全ガイド ― Burp内蔵ブラウザでDOM脆弱性を狩る

> **この節で分かること**
> - DOM Invader が何をするツールか、なぜ Burp の内蔵ブラウザ専用なのかを説明できる
> - canary（カナリア）を注入して DOM XSS の source から sink への流れを可視化できる
> - web message（`postMessage()`）・prototype pollution・DOM clobbering をこのツールで半自動的にテストできる
> - 各設定項目（Main / Attack types / Misc / Canary）の意味と、既定の on/off を把握して段階的に有効化できる
> - DOM Invader が追跡する source / sink の一覧と、その重要度ランキングの読み方を説明できる
> - 対象サイトを壊さないための実務上の運用手順（一度に1 source など）を身につける

**元資料**: https://portswigger.net/burp/documentation/desktop/tools/dom-invader （原典は取得できず二次情報ベース。ただし文面は Burp 同梱の公式オフラインドキュメントと同一）
**関連する節**: DOM-based 脆弱性の基礎、prototype pollution、DOM clobbering、web message（`postMessage`）の各節

---

## 1. DOM Invader とは何か

### 1.1 一言でいうと

DOM Invader（ドム・インベーダー）とは、**DOM XSS をはじめとするクライアントサイド脆弱性のテストを補助する、ブラウザ内蔵型の解析ツール**のこと。Burp Suite に同梱されている内蔵ブラウザ（Burp's browser）専用の拡張機能として提供される。

公式の定義（原文）は次のとおりである。

> DOM Invader is a browser-based tool that helps you test for DOM XSS vulnerabilities using a variety of sources and sinks, including both web message and prototype pollution vectors. It is available exclusively via Burp's built-in browser, where it comes preinstalled as an extension.

つまり DOM Invader は、**さまざまな source と sink（web message ベクタおよび prototype pollution ベクタを含む）を使って DOM XSS をテストするためのツール**であり、**Burp の内蔵ブラウザ経由でのみ利用できる**。そこに拡張としてプリインストールされている。対応エディションは **Professional / Community の両方**であり、無料版でも使える。

〔補足〕通常の Chrome や Firefox に自分で入れられる配布形態は提供されていない。使うには Burp の内蔵ブラウザを開くしかない。

### 1.2 なぜこのツールが必要なのか（設計意図）

DOM XSS とは、サーバではなくブラウザ内の JavaScript が、ユーザの入力（source）を危険な処理（sink）へ安全でない形で渡すことで起きる脆弱性のこと。たとえば URL の `location.hash` を読み取って `element.innerHTML` に書き込むコードがあれば、そこは DOM XSS の温床になる。

公式ドキュメントはこのテストの辛さをこう述べている。

> Testing for DOM XSS can be tedious as it often involves manually tracking the flow of your input through complex JavaScript, which may stretch to thousands of lines of code. DOM Invader greatly simplifies this process by instantly showing you any sinks that your input flows into, along with the surrounding context.

要するに、DOM XSS のテストは**数千行に及ぶ複雑な JavaScript の中を入力が流れる経路を手作業で追わねばならず退屈**である。DOM Invader は、**入力が流れ込む sink とその周囲のコンテキストを即座に表示する**ことで、この作業を劇的に楽にする。反射型 XSS を URL パラメータに `<script>` を入れて確かめるのと同じ感覚で、DOM XSS を扱えるようにする、というのが設計の狙いである。

### 1.3 4本柱（主要機能）

DOM Invader を有効化すると、**ブラウザの DevTools パネルに新しい「DOM Invader」タブが追加**され、次の4つの大きな仕事ができるようになる。

1. **DOM XSS を反射型 XSS のようにテストする。** augmented DOM（拡張DOM）ビューにより、ページ上の「制御可能な sink」を即座に特定でき、**XSS コンテキスト**と**入力がどうサニタイズされているか**の両方が見える。
2. **`postMessage()` で流れる web message をログ・改変・再送する。** Burp Proxy / Repeater が HTTP に対して行うことを、web message に対して行える。さらに DOM Invader 自身が細工したメッセージを送り、代わりに脆弱性を探らせることもできる。
3. **クライアントサイド prototype pollution の source を自動特定し、危険な sink に渡される制御可能な gadget をスキャンする。**
4. **DOM clobbering 脆弱性を自動特定する。**

原文はさらに「DOM Invader is highly configurable（高度に設定可能）」と述べ、サイトやユースケースに合わせて挙動を微調整できる点を強調している。

### 1.4 用語の整理

| 用語 | 意味 |
| --- | --- |
| source（ソース） | ユーザが制御できる入力を許す JavaScript オブジェクト。例: `location.search`, `location.hash`, `window.name` |
| sink（シンク） | JavaScript / HTML の実行を許す関数やセッター。例: `eval`, `document.write`, `element.innerHTML` |
| canary（カナリア） | source に注入する識別用の文字列。DOM を解析してこれが現れた sink を探す目印になる |
| augmented DOM / DOM view | DOM Invader が計装した source / sink をツリー表示する画面。旧UIでは「Augmented DOM」パネルと呼ぶ |
| 計装（instrumentation） | 対象の関数やプロパティにフックを仕込み、値の出入りを観測できるようにすること |

### 1.5 ドキュメントの階層（原典）

公式ドキュメントは Support Center > Documentation > Desktop editions > Tools > DOM Invader の下にあり、次のように分かれている。

```
dom-invader/
├── index               ― DOM Invader（トップ）
├── enabling            ― 有効化
├── dom-xss             ― DOM XSS のテスト
├── web-messages        ― web message 経由の DOM XSS
├── prototype-pollution ― クライアントサイド prototype pollution
├── dom-clobbering      ― DOM clobbering
└── settings/
    ├── index           ― 設定トップ
    ├── main            ― Main settings
    ├── attack-types    ― Attack types
    │   ├── web-messages         ― Web message settings
    │   └── prototype-pollution  ― Prototype pollution settings
    ├── misc            ― Misc settings
    └── canary          ― Canary settings
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOM Invader 公式ドキュメント（トップ） — https://portswigger.net/burp/documentation/desktop/tools/dom-invader
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で CONNECT に 403）。以下の記述は Burp 同梱のオフライン版ドキュメント（文面は公式と同一だが版が固定）と二次情報にもとづく要約である。
> **読みどころ**:
> 1. トップページのサイドバー／本文リンクに、本ノートに載っていない新しいサブページ（例: shadow DOM 対応、canary の注入先を細かく制御する新設定など）が増えていないかを最初に確認する。
> 2. 各サブページの見出し構成が本節と一致するかを見て、リリースで追加された機能を補う。
> **代替手段**: Burp を自分でインストールすれば、同梱のオフラインドキュメント（`resources/Documentation/...` 配下の HTML）で同一文面を読める。

---

## 2. 有効化の手順

### 2.1 なぜ既定で無効なのか

DOM Invader は内蔵ブラウザにプリインストールされているが、**既定では無効**である。理由は原文が明言している。

> DOM Invader is preinstalled in Burp's browser, but is disabled by default as some of its features may interfere with your other testing activities.

つまり**一部の機能が他のテスト作業を妨げうる**ため、初期状態ではオフにしてある。計装は対象サイトの JavaScript の挙動を変える可能性があるので、必要なときだけ有効にする、という思想である。

### 2.2 有効化5ステップ

1. **Proxy > Intercept** タブへ行き、**Open Browser** で Burp のブラウザを開く。
2. ブラウザウィンドウの**右上の Burp Suite ロゴ**をクリックする。ロゴが見えない場合は、まず**ジグソーパズル（拡張機能）アイコン**をクリックする。パネルが開き、**Burp Suite Navigation Recorder** と **DOM Invader 設定メニュー**のタブが現れる。
3. DOM Invader 設定で、**「DOM Invader is on」**になるようトグルスイッチを切り替える。
4. **Reload** をクリックしてブラウザを更新する。**変更を反映させるにはこれが必須。**
5. メインのブラウザウィンドウ上で**右クリック → Inspect** して DevTools を開き、**「DOM Invader」タブ**が追加されていることを確認する。パネルは**ブラウザウィンドウの下部にドッキングするのが推奨**（原文: "For the best experience, we recommend docking the panel to the bottom of the browser window."）。

### 2.3 設定が記憶される点に注意

原文の Note にあるとおり、既定で DOM Invader は**前回の設定（オン/オフを含む）を記憶する**。

> By default, DOM Invader remembers your previous settings, including whether it was on or off. Keep this in mind if you close Burp's browser while DOM Invader is still enabled. To disable this behavior, go to **Settings > Tools > Burp's browser** and deselect **Store settings and history after closing**.

有効のままブラウザを閉じると、次回開いたときも有効のままになる。スコープ外のサイトを巡回する前にオフにし忘れないよう注意すること。記憶をやめさせたい場合は **Settings > Tools > Burp's browser** で **「Store settings and history after closing」のチェックを外す**。

---

## 3. DOM XSS のテスト

DOM XSS 関連の機能の大半は、拡張の **DOM ビュー**（旧UIの「Augmented DOM」パネル）からアクセスする。

### 3.1 canary を注入する（仕組み）

DOM Invader の心臓部が canary である。原文は次のように説明する。

> DOM Invader works by automatically parsing the DOM to look for occurrences of a predefined "canary" string. This is an arbitrary but distinct string of alphanumeric characters that you can inject into different sources to see which sinks they flow into.

つまり DOM Invader は、**あらかじめ定義された canary 文字列の出現箇所を探して DOM を自動的にパースする**ことで動く。canary は**任意だが識別性の高い英数字列**で、いろいろな source に注入し、それがどの sink へ流れるかを観察する。現在追跡中の canary は **DOM ビューの左上**に表示され、後述の canary 設定で**任意のカスタム文字列に変更できる**。

canary を手動で注入する手順は次のとおり。

1. DevTools の **DOM Invader** タブへ行く。
2. **DOM ビュー**にいることを確認する。
3. **Copy canary** をクリックし、追跡中の canary をクリップボードにコピーする。
4. テストしたい入力（URL クエリパラメータ、フォームフィールドなど）に canary を貼り付ける。

どこが source になりうるかは、Web Security Academy の DOM-based vulnerabilities トピックが参考になる。

### 3.2 複数の source へ一括注入

手動で貼るほかに、注入を自動化する2つのボタンがある。

| ボタン | 動作 |
| --- | --- |
| **Inject URL params** | URL 内の**すべてのクエリパラメータ**に canary を自動注入する。**パラメータごとに別タブ**を使う（原文: "using a separate tab for each parameter"） |
| **Inject forms** | ページ上で検出された**すべての HTML フォームフィールド**に canary を自動注入する。ただし**注入を効かせるにはフォームを手動で送信する必要がある**（原文: "you still need to submit the form manually"） |

ここで重要な注意がある。原文の Note は次のように警告している。

> Injecting the canary into all URL parameters and form fields at once may prevent the site from working properly. For the best results, we recommend testing one source at a time.

全 URL パラメータ・全フォームフィールドに一度に注入すると**サイトが正常動作しなくなることがある**。最良の結果を得るには**一度に1つの source をテストする**のが推奨である。この「一度に1 source」は DOM Invader を使ううえでの基本作法として覚えておきたい。

### 3.3 制御可能な sink を特定する

canary を注入すると、DOM Invader は自動的に DOM をパースして **canary が現れる sink** を特定し、**「どれだけ面白いか（how interesting they are）」の順にソートして DOM ビューに表示**する。危険度の高い sink が上に並ぶので、目grep を省ける。

### 3.4 XSS コンテキストを判定する（攻撃者が突く箇所）

制御可能な sink を見つけたら、次は**注入したペイロードがどんなコンテキストに現れるか**を調べる。判定すべきは次の3点である。

- **HTML 実行 sink なのか、JavaScript 実行 sink なのか。**
- **入力が、脱出しなければならない特殊文字（クォート、タグ、属性など）に囲まれているか。**
- **sink に到達する前にサイトがどんな検証（validation）・サニタイズ（sanitization）・その他の処理を行っているか。**

DOM Invader は **sink の内容**、すなわち canary と、自分が注入した周囲の文字が DOM 上でどう見えるかを表示する。したがって **canary に特殊文字を付け足して、それがエスケープ／エンコードされているかを簡単に確認できる**。原文の例では、さまざまな有用な文字の注入に成功している様子が示されている。

sink の種類に応じて、さらに次の情報が表示される。

| 表示項目 | 意味 |
| --- | --- |
| **Outer HTML** | canary を囲んでいる HTML 要素（原文: "The HTML element that surrounds your canary."） |
| **Frame path** | canary が sink に渡されたフレーム（どの iframe か。原文: "The frame in which your canary is passed to the sink."） |
| **Event** | canary が sink に渡されたときに発生する JavaScript イベント |

これにより XSS コンテキストが一目で分かり、**どの文字・どのイベントが必要か**をテストできる。原文の例では、二重引用符で囲まれた文字列とそれを囲む `<span>` からのブレイクアウトに成功し、XSS の PoC を注入できている。

### 3.5 クライアントサイドコードを調べる（stack trace の使い方）

いろいろな注入を試していると、**急に入力が sink に流れなくなる**ことがある。原文はその理由をこう説明する。

> This could be because you can only reach the sink via a specific code path, such as one branch of a conditional statement.

つまり、**条件分岐の特定のブランチなど、あるコードパスを通らないと sink に到達しない**ことがあるためである。DOM Invader は、**入力が sink に渡されるコード上の地点へ直接ジャンプ**できるので、そこから手前を読めば**sink に到達するために入力が満たすべき条件**が分かる。

該当行を表示する手順は次のとおり。

1. **sink に確実に到達すると分かっているペイロードを注入する。**
2. DOM ビューで、**Stack Trace 列のリンク**をクリックする。これで**ブラウザのコンソールにスタックトレースが出力される**。
3. DevTools で **Console** タブに切り替える。
4. スタックトレースの中の**一番上のリンク**をクリックする（リンクが1つのこともある）。**Sources タブでクライアントサイド JavaScript が開き、入力が sink に渡される行にフォーカス**される。

この「Stack Trace 列 → Console → 最上位リンク → Sources タブ」という導線は、DOM XSS ハンティングの中核となる操作なので、実機で必ず一度なぞっておくとよい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOM Invader ― Testing for DOM XSS の "Studying the client-side code" 節 — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限）。スクリーンショット（`dom-invader-payload.png`, `dom-invader-unescaped-chars.png`）を実際に見ると理解が速い。
> **読みどころ**:
> 1. XSS コンテキスト判定（どの文字がエスケープされるか）の実際の画面を確認する。
> 2. Stack Trace から Sources タブへジャンプする導線を、スクリーンショットで追う。
> **代替手段**: Web Security Academy の DOM-based vulnerabilities ラボ（無料）で同じ操作を練習できる。

---

## 4. web message 経由の DOM XSS テスト

`postMessage()` とは、あるウィンドウ（iframe など）から別のウィンドウへメッセージを送るためのブラウザ API のこと。受け取る側がメッセージの内容や送信元を十分に検証しないと、DOM XSS やデータ窃取につながる。DOM Invader はこの経路を専門にテストできる。

### 4.1 提供機能

原文が挙げる3機能は次のとおり。

1. **ページ上で `postMessage()` により送信されたすべての web message を、有用な詳細つきでログする**（Burp Proxy が HTTP 履歴を見せるのに相当）。
2. **web message を改変して再送し、手動で DOM XSS を探る**（Burp Repeater に相当）。
3. **DOM Invader が代わりに web message を自動で改変・送信して DOM XSS を探る。**

これらはすべて **Messages ビュー**からアクセスする。利用には**設定メニューで「Postmessage interception」を有効化**する必要がある。

### 4.2 傍受の有効化

対象サイトの機能を妨げないため、web message 機能は**既定で無効**。有効化手順は次のとおり。

1. DOM Invader 設定メニューへ行く。
2. **Postmessage interception** スイッチを選択する。
3. **Reload** をクリックしてリロードする（**変更反映に必須**）。

有効化すると、`postMessage()` で流れる web message が自動ログされ、**既定で、検出した message event handler に対して DOM Invader 自身が生成したメッセージを送る**。

### 4.3 web message の自動解析（攻撃者が突く箇所）

DOM Invader は既定で「興味深いメッセージ」を自動的に特定・フラグ付けする。そのために**メッセージを次の2通りに改変する**。

1. **メッセージの `data` プロパティ経由で canary を注入する。** これで、DOM ビューでの他の source と同様に、**このデータが流れ込む sink を特定**できる。
2. **メッセージの origin を、期待されるドメイン名で「始まり、かつ終わる」偽の origin に置き換える。** これで、**受信メッセージの origin 検証に不備のあるロジックや正規表現に依存するハンドラを自動的に特定**できる。

どちらも設定メニューから無効化できる（→ Web message settings）。DOM Invader は、悪用可能と判断したメッセージに**推定される Issue の Severity（深刻度）と Confidence（確信度）を表示してフラグを立てる**。ページ上で送信されたすべてのメッセージは、自動検出できない脆弱性を含む可能性を踏まえ、**少なくとも Information の Severity** で列挙される。

### 4.4 メッセージ詳細の読み方

各メッセージをクリックすると、**クライアントサイド JavaScript が `origin` / `data` / `source` のどのプロパティにアクセスしたか**が分かる。ここが脆弱性判断の勘所である。

| プロパティ | 読み方 |
| --- | --- |
| **origin accessed** | クライアントコードが `origin` に**一度もアクセスしていない**なら、**origin 検証がされていない可能性が高い**（任意の外部ドメインからクロスオリジンで送れるかもしれない）。ただしアクセスしていても**安全とは限らず**、検証をバイパスできることがある。手がかりとして DOM Invader はスタックトレース経由で該当コード行へのリンクを提供する |
| **data accessed** | `data` は**ペイロードを注入する場所**。JavaScript がこのプロパティにアクセスしないなら**sink に渡されようがなく、そのメッセージは無価値** |
| **source accessed** | `source` は**送信元の `window` オブジェクトへの参照**（実務上はたいてい iframe への参照）。サイトは origin の代わりに `source` を検証することが多い（特定の信頼された iframe から来たことを保証する、より堅牢な方法だから）。ただし**アクセス＝検証、とは限らない** |

### 4.5 web message を再送する

Burp Repeater と同様に、web message を改変して再送できる。

1. **Messages** ビューで任意のメッセージをクリックし、詳細ダイアログを開く。
2. **Data** フィールドを必要に応じて編集する。
3. **Send** をクリックする。

原文の例では、origin を検証せず data を `element.innerHTML` に渡すメッセージを見つけたら、まず `<`, `>`, `"` がエスケープされるかをテストするメッセージを送り、通ればそれらの文字で PoC ペイロードを作って送ればよい、としている。

### 4.6 PoC を生成する

悪用可能と分かったら、レポートに載せられる HTML の PoC を DOM Invader が生成できる。

1. 脆弱なメッセージを選択して詳細ダイアログを開く。
2. エクスプロイトに必要な値を修正する。
3. **Build PoC** をクリックする。**HTML がクリップボードに保存される。**

---

## 5. クライアントサイド prototype pollution のテスト

prototype pollution（プロトタイプ汚染）とは、JavaScript の `Object.prototype` に攻撃者が任意のプロパティを追加できてしまう脆弱性のこと。すべてのオブジェクトがそのプロパティを継承するため、後段のコードの挙動を乗っ取れることがある。

### 5.1 主要タスクと有効化

原文が挙げる3タスクは次のとおり。

1. **URL および web message で送られる JSON オブジェクトの中から、prototype pollution の source を自動検出する**（同じ source を使う代替テクニックの検出も含む）。
2. **発見した source を使って `Object.prototype` を汚染し、PoC を生成する**（その後ブラウザコンソールで手動検証できる）。
3. **エクスプロイト作成に使える gadget 候補をスキャンする。**

対象サイトの機能を妨げないため**既定で無効**。有効化手順は次のとおり。

1. DOM Invader 設定メニューへ行く。
2. **Attack types** の下で、**「Prototype pollution is on」**になるようトグルする。
3. **Reload** をクリックする（**変更反映に必須**）。

### 5.2 source を検出し、手動確認する

有効化すると、**`Object.prototype` に任意のプロパティを追加できる source をページ上から自動チェック**する。見つかった source は DOM ビューに表示される。原文の例では、`location.hash` source を使って `Object.prototype` を汚染する2つの潜在的テクニックを特定している。

該当 source の隣の **Test** ボタンで手動確認できる。

1. **Test** ボタンをクリックする。DOM Invader が**新しいタブを開き、選択した source を使って `Object.prototype` に任意のプロパティを追加する**。
2. 新しいタブでコンソールを開き、DOM Invader が自動的に `Object.prototype` を出力していることを確認する。
3. ノードを展開し、PoC の **`testproperty`** が含まれることを確認する。
4. コンソールで新しいオブジェクトを作る。
5. 新しいオブジェクトがプロトタイプチェーン経由で `testproperty` を継承していることを確認する。

原文のコードは次のとおり（逐語）。

```javascript
let myObject = {};
```

```javascript
console.log(myObject.testproperty);
// Output: 'DOM_INVADER_PP_POC'
```

つまり PoC の値は **`DOM_INVADER_PP_POC`** である。空のオブジェクトを作っただけなのに `testproperty` が読めるなら、`Object.prototype` が汚染されている証拠になる。

### 5.3 gadget をスキャンする

原文は gadget の重要性をこう述べる。

> A prototype pollution source is of no use unless you also have access to a "gadget" property. This is any user-controllable property that is passed to a sink without being properly sanitized. Finding such a gadget manually is extremely tedious, but DOM Invader can automate this process.

すなわち prototype pollution の source は、**gadget プロパティにもアクセスできなければ無意味**である。gadget とは、**適切にサニタイズされずに sink に渡される、ユーザ制御可能な任意のプロパティ**のこと。手動探索は極めて退屈だが、DOM Invader が自動化してくれる。

1. DOM ビューで、見つかった source の隣の **Scan for gadgets** ボタンをクリックする。**新しいタブが開き、適合する gadget のスキャンが始まる。**
2. **同じタブ**で DevTools の **DOM Invader** タブを開く。スキャンが終わると、**特定した gadget 経由でアクセスできた sink が DOM ビューに表示**される。原文の例では、`html` という gadget プロパティが `innerHTML` sink に渡された。

### 5.4 PoC エクスプロイトの生成

gadget が見つかると、DOM Invader は **source + gadget + sink を組み合わせて XSS を確認する PoC を自動生成**できる。**発見された sink の隣の Exploit ボタンをクリックするだけ**で、DOM Invader が新しいウィンドウを開き、**`alert()` の呼び出しに成功する**。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOM Invader ― Prototype pollution settings の Techniques ダイアログ — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/prototype-pollution
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限）。**Techniques ダイアログに列挙されるテクニック名の実物**（`__proto__` / `constructor` 系の具体名）はノートで確認できていない。
> **読みどころ**:
> 1. 実機の Techniques 画面を開き、どのテクニックが用意されているかを一覧する。
> 2. サイトごとに一部を無効化して検証する運用（後述）と突き合わせる。
> **代替手段**: Web Security Academy の prototype pollution ラボ（無料）で挙動を確認できる。

---

## 6. DOM clobbering のテスト

DOM clobbering（DOM クロバリング）とは、原文の定義によれば次のとおり。

> DOM clobbering is a technique in which you inject HTML into a page to manipulate the DOM in a way that enables you to change the behavior of JavaScript on the page.

すなわち、**ページに HTML を注入して DOM を操作し、そのページの JavaScript の振る舞いを変えるテクニック**である。たとえば `id` や `name` 属性を持つ要素を注入すると、同名のグローバル変数を上書きできてしまうことがある。DOM Invader はこれを自動テストできる。

対象サイトの機能を妨げないため**既定で無効**。有効化手順は次のとおり。

1. DOM Invader 設定メニューへ行く。
2. **Attack types** の下で、**DOM clobbering** が on になるようトグルする。
3. **Reload** をクリックする（**変更反映に必須**）。

以後、ブラウジング中に DOM clobbering 脆弱性をスキャンするようになる。解説と練習用ラボは Web Security Academy の DOM clobbering トピックにある。

---

## 7. 設定を理解する

### 7.1 なぜ設定が重要か

原文は設定の存在理由をこう述べる。

> Testing for DOM-based vulnerabilities can cause side-effects that prevent the website you're testing from working correctly. DOM Invader is highly configurable, ensuring that you can fine-tune its behavior to achieve the best results.

DOM ベース脆弱性のテストは、**対象サイトが正しく動かなくなる副作用**を起こしうる。DOM Invader が高度に設定可能なのは、そうした副作用を抑えつつ最良の結果を得るためである。

設定メニューへは、全ページ共通で**ブラウザ右上の Burp Suite ロゴ → DOM Invader タブ**からアクセスする。設定は4カテゴリに分かれる。

| カテゴリ | 内容 |
| --- | --- |
| **Main settings** | DOM Invader の有効化 / Postmessage interception / sources と sinks のカスタマイズ |
| **Attack types** | Prototype pollution / DOM clobbering（配下に Web message settings、Prototype pollution settings） |
| **Misc settings** | スタックトレースによるメッセージフィルタ、自動イベント発火、リダイレクト防止、リダイレクト前ブレークポイント、全 source への canary 注入、コールバック設定、Permissions-Policy 除去 |
| **Canary settings** | canary のコピー・変更・ランダム化 |

### 7.2 Main settings

**Enable DOM Invader** は全体のグローバルトグルで、既定は無効。原文いわく、一部機能が対象サイトの機能に干渉して他のテストに影響しうるためである。有効化すると DevTools の DOM Invader タブからアクセスできる。

**Postmessage interception** を有効にすると、Messages ビューで web message の DOM XSS をテストできる。さらに細かいサブ設定は Web message settings にある。

**sources と sinks のカスタマイズ**は、メインの DOM Invader スイッチの隣の**歯車（cog）アイコン**から開く。原文の要点は次のとおり。

> From here, you can control which sources and sinks DOM Invader instruments. By default, all sources are hidden and only the most interesting sinks are instrumented.

つまり**どの source / sink を計装するか**を制御でき、**既定ではすべての source が非表示で、最も興味深い sink のみが計装される**。サイトが正しく動かなくなる場合は**特定の sink の計装を無効化**するとよい。原文は具体例として、**`eval()` を計装するとその挙動が変わり、関連機能が壊れることがある**と述べている。

〔補足（拡張UIの実物）〕拡張 v1.6.9 の設定画面には **Sinks / Sources / Messages の3タブ**があり、Sinks タブには **None / All / Interesting / Reset / Save**、Sources タブには **None / All / Reset / Save** のボタンがある。既定の「Interesting」が上記「最も興味深い sink のみ」に対応する。

### 7.3 Attack types

既定では**通常の DOM XSS の source / sink のみ**を自動で探る。オプションで他の攻撃も試せる。

| 設定 | 内容 |
| --- | --- |
| **Prototype pollution** | 有効にすると、通常の DOM XSS に**加えて**クライアントサイド prototype pollution の source を自動特定しようとする。隣の歯車アイコンから追加設定にアクセスできる |
| **DOM clobbering** | 有効にすると、DOM clobbering 脆弱性を自動特定しようとする |

〔補足（二次情報）〕JaewoongMoon 氏のブログには、**Prototype pollution と DOM clobbering はトグル動作で、一方をチェックするともう一方が外れる**（同時には使えない）との記述がある。ただし公式ドキュメントには明記がないため、実機で確認したい。

### 7.4 Web message settings

**Postmessage interception** の隣の歯車アイコンから開く。

| 設定 | 内容 |
| --- | --- |
| **Postmessage origin spoofing** | メッセージの origin を「本物の origin のドメイン名で始まり、かつ終わる」偽の origin に自動置換する。例: `startsWith()` や `endsWith()` でドメイン名を検証するサイトは簡単にバイパスできる。無効でも、再送時に **Spoof origin** チェックボックスで個別に偽装したり、フィールドで手動編集したりできる |
| **Canary injection into intercepted messages** | 送られるメッセージの `data` に canary を自動注入する。期待データが **JSON 文字列 / JSON オブジェクト / プレーン文字列**のどれかを判定し、正しい形式で注入する。詳細画面の **Show ドロップダウン**で「元データ」と「自動注入込みデータ」を切り替えられる |
| **Filter messages with duplicate values** | 同一メッセージをグループ化してノイズを減らす。1件ずつ見たいときは無効にする |
| **Generate automated messages** | 特定したすべての message event listener に対し、DOM Invader が自作メッセージを生成・送信する。各ハンドラが期待するデータ構造を推測し、処理のされ方に応じて追加のコードパスに到達する追跡メッセージを作る（より危険な sink に至る可能性）。生成メッセージは**数値 ID を持たない**ことで見分けられる |
| **Detect cross-domain leaks** | 現在のページが URL 由来のデータを含む web message を別オリジンへ送信した場合に報告する。攻撃者は当該ページを `iframe` に埋め込み、データ抽出リスナーを併用して **OAuth トークンなどの機密データを窃取**できる可能性がある |

### 7.5 Prototype pollution settings

**Prototype pollution** の隣の歯車アイコンから開く。既定値（on/off）に注目すること。

| 設定 | 既定 | 内容 |
| --- | --- | --- |
| **Scan for gadgets** | on | ページロードのたびに gadget を自動スキャンする。source がまだ見つかっていない場合の代替手段として、また「将来悪用されうる gadget が自サイトに無いか」の確認にも使える。有効にすると残りの pp 設定を自動調整する（手動上書き可） |
| **Auto-scale amount of properties per frame** | on | gadget スキャン時に1フレームあたりのプロパティ数を自動スケールする。性能は改善するが**偽陰性**（注入プロパティが例外を起こし、同じ iframe 内の他の gadget をテストできなくなる）で gadget を見逃すことがある。無効にしてスライダーで固定上限を設定できる（下げると遅いが見逃し減、上げると逆） |
| **Scan nested properties** | on | 他のプロパティに入れ子になったプロパティも再帰的にスキャンする。無効にすると各オブジェクトのトップレベルのみ |
| **Query string injection** | on | クエリ文字列のパラメータでテストする。サイトが壊れる場合は無効化 |
| **Hash injection** | on | URL の hash（フラグメント）部分でテストする |
| **JSON injection** | on | JSON ベースの web message を注入してテストする |
| **Verify onload** | on | ページのロード完了を待ってから報告する（gadget が最終 DOM にまだ存在することを保証）。無効にすると見つけ次第報告＝速いが**偽陽性**が出うる |
| **Remove CSP header** | off | すべてのレスポンスから `Content-Security-Policy` ヘッダを除去する。CSP が XSS ベクタや gadget スキャン用 iframe をブロックするのを防ぐ |
| **Remove X-Frame-Options header** | off | すべてのレスポンスから `X-Frame-Options` ヘッダを除去する。gadget スキャン用 iframe のブロックを防ぐ |
| **Scan each technique in separate frame** | off | 既定はトップフレームでスキャンするが、複数テクニックが干渉して見逃すことがある（例: `__proto__` と `constructor` を同時に試すと `constructor` 単独なら動くサイトでも失敗）。有効にするとテクニックごとに別 iframe を使い、偽陰性が減る |

入れ子プロパティのスキャン対象を理解するため、原文のコード例を引く（逐語）。

```javascript
const user = {
    id: 1337,
    name: "carlos",
    contactInfo: {
        email: "carlos@ginandjuice.shop",
        phone: 0161133713371
    }
}
```

既定では DOM Invader はこの `user` の**全プロパティ**をテストする。**Scan nested properties を無効にすると、`user.contactInfo.email` と `user.contactInfo.phone` の両方がスキップされる。**

#### テクニックを無効化する

原文は次のように述べる。

> DOM Invader uses a number of different techniques for prototype pollution. You may find that using all of these techniques at once prevents the attack from working on certain sites.

**全テクニックを一度に使うと、特定サイトでは攻撃が成立しない**ことがあるため、一部を無効化する／一度に1つだけ使うのがよい場合がある。手順は次のとおり。

1. **Attack types** の下、**Prototype pollution** スイッチの隣の歯車アイコンをクリックする。
2. ダイアログで **Techniques** ボタンをクリックする。
3. スイッチで必要に応じてテクニックを有効／無効にする。
4. **Save** をクリックし、次に **Reload** をクリックする（**変更反映に必須**）。

〔補足（拡張UIの実物）〕設定画面には **"Techniques configuration"** ダイアログがあり、**None / Reset / Save** ボタンを備える。**"Amount of properties to scan per iframe"** のスライダーには **"Slower more accurate" ←→ "Faster less accurate"** のラベルが付く。

### 7.6 Misc settings

| 設定 | 内容 |
| --- | --- |
| **Message filtering by stack trace** | 大量のメッセージでノイズが多いサイト向け。各エントリのスタックトレースを比較し、既存と同じコード位置を指すものを隠す |
| **Auto-fire events** | ページロード直後に全要素へ **click と mouseover** イベントを自動発火する。注入ペイロードがこれらのイベント発生時にしか sink に到達しない場合に有用 |
| **Redirection prevention** | クライアントサイドリダイレクトが起きると、見つけた source / sink がクリアされてしまう。有効にするとリダイレクトをブロックして同じページに留まる。ただし **`javascript:` URL へのリダイレクト**と、**Inject URL ボタンが開始したリダイレクト**は通常どおり動く |
| **Add breakpoint before redirect** | リダイレクトを丸ごと止める代わりに、リダイレクトを起こすコードの直前にブレークポイントを設定する。**これは Chrome 標準の DevTools では現状不可能**。コールスタックでリダイレクト箇所を確認でき、デバッグに有用 |
| **Inject canary into all sources** | ページ上で特定したすべての source に canary を自動注入する。**source ごとに固有の文字列を canary に付加**するので、どの source がどの sink に流れたかを識別しやすい。歯車から、(1) 特定 source を無効化してスキップ、(2) canary を注入する特定パラメータをカンマ区切りで指定、ができる |
| **Configuring callbacks** | source / sink / web message を特定したときに実行するカスタムコールバック関数を設定できる。既定のもの（結果をコンソールにログ出力してエクスポート）を使うか自作する。**制御可能な sink を特定したときに `debugger` 文でスクリプトを一時停止**してコールスタックを調べる、といった使い方もできる |
| **Remove Permissions-Policy header** | レスポンスに `Permissions-Policy` ヘッダがあれば自動除去する。一部サイトはこのヘッダで**同期 XHR（synchronous XHR）**など DOM Invader に必須の機能をブロックする。その場合 DOM Invader はコンソールで通知し、この設定を有効にするよう促す |

#### 既定コールバックの有効化手順（原文7ステップ）

1. メインの DOM Invader スイッチの隣の歯車アイコンをクリックして sources / sinks 設定を開く。
2. 結果の種類に応じて **Sources** / **Sinks** / **Messages** タブを選ぶ。
3. **Callback configuration** ボタンをクリックし、既定のコールバック関数を表示する（**初期状態では非アクティブ**）。
4. **スクリプトが入っているテキストフィールドをクリックしてアクティブ化**する。
5. そのままにするか変更を加えて **Save** をクリックする。
6. **Reload** をクリックする（**変更反映に必須**）。
7. 通常どおり使い、コールバックが期待どおり動くか確認する。

〔補足（拡張UIの実物）〕コールバック設定ダイアログには **"This is for advanced users only. Please ensure this is valid JavaScript."**（上級者専用。有効な JavaScript であることを確認してください）という警告があり、**Sink callback / Source callback / Message callback** の3種がある。各ダイアログに **Close / Reset / Save** ボタンがある。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOM Invader ― Misc settings / Main settings — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/misc
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限）。設定項目はリリースごとに増えやすい。
> **読みどころ**:
> 1. 「Inject canary into all sources」の歯車配下（source 個別の有効/無効、カンマ区切りのパラメータ指定）の最新仕様を確認する。
> 2. 「Configuring callbacks」と「Remove Permissions-Policy header」が現行でも同じかを確認する。
> **代替手段**: Burp を自分でインストールし、設定画面を直接開いて突き合わせる。

### 7.7 Canary settings

設定メニューの**最下部**に、現在追跡中の canary 文字列が表示される。

| 操作 | 内容 |
| --- | --- |
| **Copying the canary** | **Copy** で現在の canary をクリップボードにコピーする（手動注入に便利） |
| **Changing the canary** | ランダム生成された既定の canary を、いつでも独自のカスタム文字列に置き換えられる |

canary 変更手順は次のとおり。

1. 使いたい文字列を入力する。あるいは **Randomize** で新しいランダム文字列を生成する。
2. **Update canary** をクリックする。
3. **Reload** をクリックする（**変更反映に必須**）。

原文の Note は重要な注意を与える。

> To avoid false positives, make sure that the string you use doesn't occur naturally on the page.

**偽陽性を避けるため、ページ上に自然に出現しない文字列**を canary にすること。`test` のようなありふれた語は避けるべきである。

---

## 8. DOM Invader が追跡する source / sink 一覧

以下は PortSwigger 公式ブログ "Introducing DOM Invader" に掲載されたコードで、**2021年7月時点の内容**である（現行版では増減しうる）。それでも「DOM Invader が何を source / sink とみなし、どんな重要度を付けているか」を知る一次に近い資料として価値が高い。

### 8.1 Sources（原文のまま）

```javascript
const sourcesList = [
    "location",
    "location.href",
    "location.hash",
    "location.search",
    "location.pathname",
    "document.URL",
    "window.name",
    "document.referrer",
    "document.documentURI",
    "document.baseURI",
    "document.cookie"
];
```

これらはすべて、攻撃者が値に影響を与えうる入力口である。とくに `location.hash`（URL の `#` 以降）や `location.search`（`?` 以降のクエリ）はサーバに送信されずブラウザだけで処理されることが多く、DOM XSS の典型的な起点になる。

### 8.2 Sinks（ランキング付き・原文のまま）

数値が小さいほど「面白い（＝危険度が高い）」sink として上位に表示される。1 が最も危険で、コード実行に直結する `jQuery.globalEval` や `eval`、`Function` が上位を占める。

```javascript
const sinkRanking = {
    "jQuery.globalEval":1,
    "eval":2,
    "Function":3,
    "execScript":4,
    "setTimeout":5,
    "setInterval":6,
    "setImmediate":7,
    "msSetImmediate":7,
    "script.src":8,
    "script.textContent":9,
    "script.text":10,
    "script.innerText":11,
    "script.innerHTML":12,
    "script.appendChild":13,
    "script.append":14,
    "document.write": 15,
    "document.writeln": 16,
    "jQuery":17,
    "jQuery.$":18,
    "jQuery.constructor":19,
    "jQuery.parseHTML":20,
    "jQuery.has":20,
    "jQuery.init":20,
    "jQuery.index":20,
    "jQuery.add": 20,
    "jQuery.append": 20,
    "jQuery.appendTo": 20,
    "jQuery.after": 20,
    "jQuery.insertAfter": 20,
    "jQuery.before": 20,
    "jQuery.insertBefore": 20,
    "jQuery.html": 20,
    "jQuery.prepend": 20,
    "jQuery.prependTo": 20,
    "jQuery.replaceWith": 20,
    "jQuery.replaceAll": 20,
    "jQuery.wrap": 20,
    "jQuery.wrapAll": 20,
    "jQuery.wrapInner": 20,
    "jQuery.prop.innerHTML": 20,
    "jQuery.prop.outerHTML": 20,
    "element.innerHTML":21,
    "element.outerHTML":22,
    "element.insertAdjacentHTML":23,
    "iframe.srcdoc": 24,
    "location.href":25,
    "location.replace":26,
    "location.assign":27,
    "location":28,
    "window.open":29,
    "iframe.src":30,
    "javascriptURL":31,
    "jQuery.attr.onclick":32,
    "jQuery.attr.onmouseover":32,
    "jQuery.attr.onmousedown":32,
    "jQuery.attr.onmouseup":32,
    "jQuery.attr.onkeydown":32,
    "jQuery.attr.onkeypress":32,
    "jQuery.attr.onkeyup":32,
    "element.setAttribute.onclick":33,
    "element.setAttribute.onmouseover":33,
    "element.setAttribute.onmousedown":33,
    "element.setAttribute.onmouseup":33,
    "element.setAttribute.onkeydown":33,
    "element.setAttribute.onkeypress":33,
    "element.setAttribute.onkeyup":33,
    "createContextualFragment":34,
    "document.implementation.createHTMLDocument": 35,
    "xhr.open":36,
    "xhr.send": 36,
    "fetch": 36,
    "fetch.body": 36,
    "xhr.setRequestHeader.name": 37,
    "xhr.setRequestHeader.value": 38,
    "jQuery.attr.href":39,
    "jQuery.attr.src":40,
    "jQuery.attr.data":41,
    "jQuery.attr.action":42,
    "jQuery.attr.formaction":43,
    "jQuery.prop.href":44,
    "jQuery.prop.src":45,
    "jQuery.prop.data":46,
    "jQuery.prop.action":47,
    "jQuery.prop.formaction":48,
    "form.action":49,
    "input.formaction":50,
    "button.formaction":51,
    "button.value": 52,
    "element.setAttribute.href":53,
    "element.setAttribute.src":54,
    "element.setAttribute.data":55,
    "element.setAttribute.action":56,
    "element.setAttribute.formaction":57,
    "webdatabase.executeSql": 58,
    "document.domain":59,
    "history.pushState":60,
    "history.replaceState":61,
    "xhr.setRequestHeader":62,
    "websocket":63,
    "anchor.href":64,
    "anchor.target": 65,
    "JSON.parse": 66,
    "document.cookie":67,
    "localStorage.setItem.name": 68,
    "localStorage.setItem.value": 69,
    "sessionStorage.setItem.name": 70,
    "sessionStorage.setItem.value": 71,
    "element.outerText": 72,
    "element.innerText": 73,
    "element.textContent": 74,
    "element.style.cssText": 75,
    "RegExp":76,
    "window.name":77,
    "location.pathname": 78,
    "location.protocol": 79,
    "location.host": 80,
    "location.hostname": 81,
    "location.hash": 82,
    "location.search": 83,
    "input.value": 84,
    "input.type": 85,
    "document.evaluate": 86
};
```

このランキングは、DOM Invader が結果を「面白い順」に並べる根拠そのものである。sink の名前を眺めるだけでも、`innerHTML` 系（21〜23）は HTML 実行、`eval`/`Function`（2〜3）は JS 実行、`location.href`/`location.assign`（25〜27）はリダイレクトやオープンリダイレクト、というように**どの sink がどんな悪用につながるか**の地図になる。

### 8.3 ブログが述べる Augmented DOM の要点

- 内蔵ブラウザで DevTools を開くと **Augmented DOM タブ**が現れ、**canary 値を含む source と sink**、および**利用可能なすべての source / sink のツリービュー**が表示される。
- 興味深い sink では、含まれる値と**スタックトレース**を見られ、**canary がハイライト表示**される。カスタム canary が正しくエンコードされているかも検査できる。
- その他の機能として、**sink に送られた値の検索**と、**URL パラメータ／フォーム要素への canary の自動注入**がある。
- **source** ＝ ユーザ制御可能な入力を許す任意の JavaScript オブジェクト。**sink** ＝ JavaScript/HTML の実行を許す任意の関数やセッター。
- 必要バージョンは **Burp Suite Professional / Community 2021.7 以降**（ブログ執筆時点）。

> ### 📌 ここは自分で開いて読んでください
> **資料**: PortSwigger ブログ "Introducing DOM Invader" — https://portswigger.net/blog/introducing-dom-invader
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限）。上記 `sourcesList` / `sinkRanking` は2021年7月時点の翻訳ミラー経由の断片であり、現行版では増減しうる。
> **読みどころ**:
> 1. `sourcesList` / `sinkRanking` の**現行版**を確認し、追加された source / sink を補う。
> 2. Augmented DOM の紹介と初期のスクリーンショットで、ツールの全体像を掴む。
> **代替手段**: Burp のリリースノート（https://portswigger.net/burp/releases）を「DOM Invader」で検索し、機能追加の時系列を辿る。

---

## 9. 拡張機能の内部構造（UI 実物）

出典は Burp 同梱の Chromium 拡張 `burp-chromium-extension`（`"name": "Burp Suite", "version": "1.6.9"`）。やや古い版のため最新項目（DOM clobbering、Detect cross-domain leaks、Remove Permissions-Policy header 等）は含まれないが、**UI 上の実文言の一例**として参考になる。

### 9.1 Augmented DOM パネルの可視テキスト

```
DOM Invader Augmented DOM
Feature disabled.
Use the DOM Invader settings, in the top right, to enable Augmented DOM.
View documentation
In order for changed settings to take effect, you must reload your browser.
DOM Invader
Search
Search for Canary
Inject URL
Inject forms
Copy canary
Clear all
Sinks (0)
Sources (0)
```

パネルは **sink ツリーと source ツリーの2本立て**で、それぞれ件数が出る。**Search**（任意キーワード検索）と **Search for Canary**（canary 検索）が分かれている点に注意。公式ドキュメントが「DOM view」と呼ぶものが、この「Augmented DOM」パネルにあたる（**Inject URL params** は旧UIでは **Inject URL**）。

### 9.2 各設定の既定 on/off（実物から確認）

設定画面のトグル文言をそのまま並べると、どれが既定で on / off かが読み取れる。

**既定で on** のもの: DOMInvader（この個体では有効化済み）、Scan for gadgets、Auto scale amount of properties per frame、Scan nested properties、Query string injection、Hash injection、JSON injection、Verify onload。

**既定で off** のもの: Postmessage interception、Postmessage origin spoofing、Canary injection into intercepted messages、Filter messages with duplicate values、Generate automated messages、Message filtering by stack trace、Auto fire events、Redirection prevention、Add breakpoint before redirect、Remove CSP header、Remove X-Frame-Options header、Scan each technique in separate frame、Prototype pollution、Inject canary into all sources。

### 9.3 全フレームへの計装（なぜ Frame path が見えるのか）

manifest のコンテンツスクリプト構成（逐語）は次のとおり。

```json
"content_scripts": [
    {
      "run_at": "document_start",
      "matches": ["http://*/*", "https://*/*"],
      "js": [
        "./dom-invader-extension/content-scripts/read-settings.js",
        "./dom-invader-extension/content-scripts/connection.js",
        "./dom-invader-extension/content-scripts/postmessage.js",
        "./dom-invader-extension/content-scripts/augmented-dom.js",
        "./navigation-recorder/content-scripts/classes/Recorder.js"
      ],
      "all_frames": true,
      "match_about_blank": false
    }
],
"devtools_page": "./dom-invader-extension/devtools/devtools.html",
```

ポイントは **`document_start` で、すべてのフレーム（`all_frames: true`）に注入**される点である。これが、iframe 単位で source / sink が見え、`Frame path` 列に「どの iframe か」が表示される仕組みの土台になっている。

---

## 10. 実務運用のコツ（コミュニティの慣行）

以下は公式ドキュメントではなく、第三者のノート（HackTricks、SecNote、JaewoongMoon 氏のブログ）由来である。**コミュニティの慣行**として扱うこと。

### 10.1 推奨初期設定（SecNote より）

1. 「DOM invader is on」にする。sink は **Interesting** のままでよい。**source は `window.name` を有効にしない**。
2. **Misc の「Auto fire events」を on** にする。
3. **その他は全部 off**。

- **自動テスト**: 「Inject canary into all sources is on」（既定では入れないこと。ページに影響が出る）→ リロード → F12 → **Inject URL params**。
- **手動テスト**: canary をコピーし、注入したい箇所に貼り付け → リロード。

### 10.2 ページが壊れるときの対処（JaewoongMoon 氏より）

「Inject canary into all sources」を on にするとページロードでエラーが出ることがある。その場合は**いったん off でページを読み込み、その後に on にしてから機能を操作する**。

### 10.3 HackTricks の運用ノート

- **空の canary で検索**すると、悪用可能性に関係なく**すべての sink を洗い出せる**（偵察に有効）。
- `test` のようなありふれた文字列を canary にしない（偽陽性の原因）。
- ページ機能を壊す場合は **`eval` や `innerHTML` など重い sink の計装を一時的に無効化**する。
- **source/sink はブラウジングコンテキスト（フレーム）単位で表示**されるため、iframe 内の脆弱性は手動でフォーカスが必要なことがある。
- Burp Repeater / Proxy と組み合わせ、脆弱な状態を生んだリクエスト／レスポンスを再現して最終的な攻撃 URL を組み立てる。

### 10.4 防御側・検出側の視点

DOM Invader の各機能は、防御にも直結する。**Scan for gadgets** は「自サイトに将来悪用されうる gadget が無いか」の確認に使えると原文が述べているとおり、開発者は自分のアプリを内蔵ブラウザで巡回して、canary が危険な sink（`innerHTML`, `eval` など）に流れないかを確認できる。web message については、受信ハンドラで `origin` と `data` を必ず検証し、`startsWith()`/`endsWith()` のような緩い検証を避けること。prototype pollution は `Object.freeze(Object.prototype)` や安全な JSON マージ実装で緩和できる。

なお、DOM Invader の **CSP / X-Frame-Options / Permissions-Policy 除去機能は自分のブラウザ内のレスポンス処理を変えるだけ**で、対象サイトの設定を恒久的に変えるものではない。それでも**スコープ外のサイトで有効にしたまま巡回しない**こと。

---

## 手を動かす

1. Burp を起動し、**Proxy > Intercept** タブで **Open Browser** をクリックして内蔵ブラウザを開く。
2. ブラウザ右上の **Burp Suite ロゴ**（見えなければジグソーパズルアイコン）をクリックし、**DOM Invader** タブへ切り替える。
3. **DOM Invader is on** にトグルし、**Reload** をクリックする。
4. Web Security Academy の DOM-based vulnerabilities ラボ（例: `location.hash` を `innerHTML` に渡すもの）を開く。
5. ページ上を右クリック → **Inspect** で DevTools を開き、**DOM Invader** タブを下部にドッキングする。
6. **Copy canary** で canary をコピーし、URL の `#` の後ろに貼り付けてリロードする。あるいは **Inject URL params** を押して自動注入する。
7. DOM ビューに現れた sink（例: `element.innerHTML`）をクリックし、**Outer HTML** と表示コンテキストを確認する。
8. canary に `"><img src=x>` のような特殊文字を足して再注入し、それがエスケープされずに出るか確認する。
9. 入力が急に流れなくなったら、**Stack Trace 列のリンク → Console タブ → 最上位リンク → Sources タブ**の順にたどり、到達条件を読む。
10. web message を試すなら、**Postmessage interception** を on にしてリロードし、**Messages** ビューを観察する。origin/data/source のアクセス状況を見て、**Build PoC** で PoC を作る。
11. prototype pollution を試すなら、**Attack types** で **Prototype pollution** を on にしてリロードし、source の **Test** → コンソールで `let x={}; console.log(x.testproperty);` が `DOM_INVADER_PP_POC` を返すか確認する。続けて **Scan for gadgets** → **Exploit** で `alert()` まで確認する。

## つまずきポイント

- **設定を変えたのに反映されない**: DOM Invader は**設定変更のたびに Reload が必須**。オンにしただけ、トグルしただけでは効かない。
- **DOM Invader タブが出てこない**: DevTools を開かないと現れない。メインウィンドウ上で右クリック → Inspect すること。パネルは下部ドッキング推奨。
- **サイトが壊れる／ロードエラー**: 一度に全 source へ注入している可能性が高い。**一度に1 source**に戻すか、`eval`/`innerHTML` など重い sink の計装を一時的に切る。
- **canary が大量に誤検出される**: `test` などページに自然に出る語を canary にしている。ランダム文字列に変えること。
- **origin にアクセスしている＝安全、と早合点する**: origin/source をアクセスしていても検証が甘い（`startsWith`/`endsWith` など）ことがあり、バイパスできる場合がある。
- **prototype pollution の gadget が見つからない**: `Auto-scale amount of properties per frame` による偽陰性の可能性。オフにして固定上限を上げる、または `Scan each technique in separate frame` を試す。
- **ブラウザを閉じても有効のまま**: DOM Invader は前回設定を記憶する。スコープ外を巡回する前にオフにするか、Store settings のチェックを外す。
- **本ノートの版が古い**: 拠り所にした拡張は v1.6.9 で DOM clobbering 等が未搭載。UI 文言は最新版と異なることがあるので、実機で確認する。

## この節のまとめ

- DOM Invader は Burp の**内蔵ブラウザ専用**の拡張で、Professional / Community の両方で使える。既定では無効。
- 有効化すると DevTools に **DOM Invader タブ**が追加され、source から sink への流れを可視化する。
- 中核は **canary**。source に注入し、DOM を解析して canary が現れた sink を「面白い順」に表示する。
- 4本柱は **DOM XSS / web message / prototype pollution / DOM clobbering**。
- 設定は **Main / Attack types / Misc / Canary** の4カテゴリで、変更のたびに **Reload が必須**。
- 既定では**すべての source が非表示で、最も興味深い sink のみが計装**される（Interesting）。
- **Inject URL params / Inject forms** で一括注入できるが、一度に全部やるとサイトが壊れうるので**一度に1 source**が基本。
- XSS コンテキスト判定は **Outer HTML / Frame path / Event** を手がかりに行う。
- 入力が流れなくなったら **Stack Trace → Console → Sources** の導線で到達条件を読む。
- web message では **origin / data / source のアクセス有無**が脆弱性判断の勘所。ただしアクセス＝検証とは限らない。
- prototype pollution の PoC 値は **`DOM_INVADER_PP_POC`**。gadget が見つかれば **Exploit** で `alert()` まで自動化できる。
- source は `location.*`、`window.name`、`document.cookie` など、sink は `eval`(2) や `innerHTML`(21) など重要度ランキングで並ぶ。
- **Remove CSP / X-Frame-Options / Permissions-Policy** は自分のブラウザ内の処理だけを変える。スコープ外で有効化したまま巡回しないこと。
- 拡張は **`document_start` で全フレームに注入**されるため、iframe 単位で source/sink（Frame path）が見える。
- 偽陽性を避けるため canary は**ページに自然に出ない文字列**にする。

## 理解度チェック

1. DOM Invader はどのブラウザで使えるか。通常の Chrome に入れられるか。
   ▶ 答え: Burp Suite の内蔵ブラウザ専用。通常の Chrome / Firefox に入れる配布形態は提供されていない。

2. canary とは何で、何のために使うか。
   ▶ 答え: 任意だが識別性の高い英数字列。source に注入し、DOM を解析してそれがどの sink に現れるかを追跡するための目印。

3. 設定を変えた後に必ず必要な操作は何か。
   ▶ 答え: Reload（ブラウザのリロード）。これをしないと変更が反映されない。

4. 既定では source と sink はどう計装されているか。
   ▶ 答え: すべての source は非表示、最も興味深い sink のみが計装される（Interesting）。

5. web message の詳細で「クライアントコードが `origin` に一度もアクセスしていない」ことは何を示唆するか。
   ▶ 答え: origin 検証がされていない可能性が高く、任意の外部ドメインからクロスオリジンでイベントハンドラにメッセージを送れるかもしれない。ただしアクセスしていても安全とは限らない。

6. prototype pollution の Test ボタンで確認できる PoC の値は何か。
   ▶ 答え: `DOM_INVADER_PP_POC`。空のオブジェクトの `testproperty` を読むとこの値が返る。

7. sink ランキングで最も危険（値が最小）なのはどれか。上位の代表例を挙げよ。
   ▶ 答え: `jQuery.globalEval`(1)。続いて `eval`(2)、`Function`(3) など JS 実行に直結するもの。

8. 一度に全 URL パラメータ・全フォームに canary を注入するとどうなるか。推奨される方法は。
   ▶ 答え: サイトが正常動作しなくなることがある。一度に1つの source をテストするのが推奨。

9. 入力が急に sink へ流れなくなったとき、到達条件を調べる導線は。
   ▶ 答え: DOM ビューの Stack Trace 列リンク → Console タブ → 最上位リンク → Sources タブで該当行にフォーカス。

10. なぜ iframe 単位（Frame path）で source/sink が見えるのか。
    ▶ 答え: 拡張のコンテンツスクリプトが `document_start` で `all_frames: true`、すなわち全フレームに注入されるため。

## 出典

- https://portswigger.net/burp/documentation/desktop/tools/dom-invader
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/enabling
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/prototype-pollution
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-clobbering
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/main
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/attack-types
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/web-messages
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/prototype-pollution
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/misc
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/canary
- https://portswigger.net/blog/introducing-dom-invader
- https://portswigger.net/burp/releases

<!-- sources: https://portswigger.net/burp/documentation/desktop/tools/dom-invader, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/enabling, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/prototype-pollution, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-clobbering, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/main, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/attack-types, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/web-messages, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/prototype-pollution, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/misc, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/canary, https://portswigger.net/blog/introducing-dom-invader, https://portswigger.net/burp/releases -->
<!-- terms: DOM Invader, canary, source, sink, augmented DOM, DOM XSS, web message, postMessage, prototype pollution, gadget, DOM clobbering, Postmessage interception, Postmessage origin spoofing, XSSコンテキスト, Frame path, Inject URL params, Inject canary into all sources, Remove CSP header, Permissions-Policy, sinkRanking, sourcesList, 計装, Burp内蔵ブラウザ -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/dom-invader | サイト側の egress 制限で自動取得できず、同梱オフライン版と二次情報で代替 -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss | サイト側の egress 制限で自動取得できず、スクリーンショットは要実機確認 -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/prototype-pollution | Techniques ダイアログの実テクニック名がノートで未確認 -->
<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/misc | 設定項目がリリースごとに増えるため最新仕様は要確認 -->
<!-- self-read: https://portswigger.net/blog/introducing-dom-invader | sourcesList/sinkRanking は2021年7月時点の翻訳ミラー経由の断片 -->
