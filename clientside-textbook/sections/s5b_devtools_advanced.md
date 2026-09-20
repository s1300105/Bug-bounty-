## source map・local overrides を使った動的解析

クライアントサイド脆弱性ハンティングでは、配布されている本番用JavaScriptはほぼ例外なく minify（変数名や改行を削除して圧縮すること）・bundle（複数モジュールを1ファイルに結合すること）された状態で届く。生のまま読んでも `sink`（外部入力が最終的に実行・解釈される危険な代入先。例: `innerHTML` への代入、`eval()` の引数など）の位置を追うのは非現実的である。本節では、ブラウザDevTools標準機能である **source map** と **Local Overrides（ローカルオーバーライド）** を軸に、「読めない本番コードを読める形に戻し、実際に手を入れて挙動を観察する」ための動的解析手法を扱う。これはXSS・DOM Clobbering・prototype pollution・postMessage起因の脆弱性など、あらゆるクライアントサイド脆弱性調査の前提技術となる。

### なぜ動的解析が必要か

静的なソース閲覧（View Source やビルド前リポジトリの読解）だけでは、以下の情報が欠落する。

- 実行時に動的生成されるDOM構造やイベントリスナー(`addEventListener`で後付けされたコードは静的解析ツールに現れないことが多い)
- Webpack/Viteなどのバンドラが変数名を`a`, `b`, `e`のような1文字に短縮した後の実際の変数束縛関係
- 条件分岐がどのランタイム値でどちらに倒れるか(A/Bテスト、feature flag、UAごとの分岐など)

これらを解決する最短経路が「ブラウザ上で実行中のコードにブレークポイントを置いて止め、その場でスタックとスコープを見る」動的デバッグであり、そのためには (1) 圧縮前ソースへ視点を戻す source map、(2) 変更を試して即座に効果を確認する local overrides、の2本柱が要になる。

---

### source map の仕組み

#### 内部構造

source map はJSON形式のファイルで、ビルド後（圧縮後）のコード上の位置と、ビルド前（元のTypeScript/JSX/未圧縮JS）のコード上の位置を対応づけるテーブルを持つ。主要フィールドは次の通り。

```json
{
  "version": 3,
  "sources": ["src/utils/sanitize.ts", "src/components/Search.tsx"],
  "names": ["userInput", "renderResult", "dangerouslySetInnerHTML"],
  "mappings": "AAAA,SAASA,GAAGC,GAAG...",
  "sourcesContent": ["export function sanitize(userInput) { ... }", "..."]
}
```

- `sources`: 元ファイルのパス一覧
- `names`: 圧縮で消えた元の識別子名一覧
- `mappings`: 生成コードの各セグメントを`sources`と`names`のインデックスへ対応づける、Base64 VLQ（可変長量子化）でエンコードされた差分データ。これにより生成後1行1万文字のコードでも、元の何行目・何文字目・どの変数名だったかを1トークン単位で逆引きできる
- `sourcesContent`: 元ソースの全文そのものを埋め込むオプションフィールド。これがあれば、サーバー側に元ファイルが残っていなくてもDevTools側だけで元コードを完全復元できる

圧縮後ファイルの末尾には次のようなコメントが付き、DevToolsはこれを読んでsource mapを自動取得する。

```
//# sourceMappingURL=app.min.js.map
```

> 出典: Chrome DevTools JavaScript Debugging Complete Guide 2026 — https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/

この仕組み上、**source mapは「minifyされたコードと元コードの対応表」でしかなく、実行そのものは常に圧縮後コードで行われる**。DevToolsのSourcesパネルは、ブレークポイントや変数表示を元コード側の見た目で「代理表示」しているだけであり、Networkパネルで見えるレスポンスは依然として圧縮後コードである点を理解しておくと、なぜ「表示は綺麗だがブレークポイントの位置がずれる」といった不具合が起きるかが分かる（バンドラのソースマップ生成ロジックにバグがあると`mappings`のVLQ計算がずれ、1行分表示位置がぶれることがある）。

#### 脆弱性ハンティングにおける価値とリスク

セキュリティ調査者にとってsource mapは「サーバー側の意図せぬソース開示」という副産物的価値を持つ。本番ビルドでsource mapを公開設定のまま配信している、あるいは`sourcesContent`まで含めてしまっているケースでは、コメント・内部API名・未使用の管理者向けルート・ハードコードされた鍵の痕跡などが漏洩する。これは典型的な「情報漏洩」系の指摘対象になるため、調査時は以下を確認する。

- `Network`タブで`.js.map`が実際にHTTPで200を返すか（本番で意図的に無効化されているか）
- `sourcesContent`が含まれているか(含まれていれば元ソース全文がクライアントから取得可能ということ)
- map内に社内リポジトリパス・ステージング環境URL・コメントアウトされたデバッグコードが残っていないか

ただし本教科書はハンティングの土台技術書であり、実在サービスへの無許可アクセスや本番環境への破壊的検証は行わない。source mapの有無確認は「公開されている自分のレスポンス・自分が権限を持つテスト環境」または許可されたスコープ内でのみ行うこと。

#### DevToolsでのsource map操作

Chrome DevToolsのSourcesパネルでは、ファイルツリーが自動的に「圧縮後ファイル」ではなく「map経由で復元された元のディレクトリ構造」で表示される（`webpack://`のような仮想プロトコル配下に元のパスがそのままツリー化される）。

source mapがデプロイされていない、あるいは意図的に読み込ませたい別バージョンのmapがある場合、手動で紐付けることができる。

1. Sourcesパネルで対象の圧縮後ファイルを右クリック
2. 「Add source map…」を選択
3. ローカルファイルパスまたは非公開URLを指定する

> 出典: Chrome DevTools JavaScript Debugging Complete Guide 2026 — https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/

これは、たとえば自分でビルドし直した検証用バンドルのmapを本番配信コードに手動で当てて読みやすくする、といった防御側のコードレビュー作業で有用である。設定は`chrome://settings`相当のDevTools Settings → Preferences内、「Enable JavaScript source maps」トグルでON/OFFを切り替えられる（誤ってOFFのまま調査すると、圧縮後コードのままデバッグすることになるので注意）。

#### 版依存・時事性の注意

source map仕様自体は「Source Map Revision 3 Proposal」がデファクト標準として長年安定しているが、DevTools側のUI（メニュー名・設定項目の位置）はChromeのメジャーバージョンごとに変わることがある。本節執筆時点（2026年）で参照した一次情報はChrome DevTools 2026年時点のUIを前提にしている。手元の挙動が異なる場合は、使用しているChromeのバージョン（`chrome://version`で確認）を明記した上で照合すること。またAI等ツール経由の二次情報は検証範囲が浅い場合があるため、挙動の細部（メニュー文言など）は自分の手元のDevToolsで必ず実機確認する姿勢が重要である。

---

### Local Overrides（ローカルオーバーライド）の仕組み

#### 何を解決する機能か

通常、DevTools上でJavaScriptファイルの中身を書き換えて動作確認しても、ページをリロードすればサーバーから配信された元のコードに戻ってしまう。Local Overridesは「特定のURLへのレスポンスを、ローカルディスク上に保存したファイルで恒久的に差し替える」機能で、リロードをまたいで変更が持続する点が最大の特徴である。

セットアップ手順は次の通り。

1. Sources パネル → Filesystem タブ → 「Add folder to workspace」でローカルの空フォルダ（または任意の作業用フォルダ）を選択
2. ブラウザからのファイルシステムアクセス許可ダイアログで「許可」を選ぶ
3. Overridesタブが有効化された状態で、任意のスクリプト/CSS/HTMLファイルをSourcesパネルで直接編集して保存(Ctrl/Cmd+S)すると、そのファイルの内容がフォルダ内にコピーされ、以後同一URLへのリクエストはこのローカルコピーで自動的に上書きされる

> 出典: Chrome DevTools JavaScript Debugging Complete Guide 2026 — https://devplaybook.cc/blog/chrome-devtools-javascript-debugging-guide-2026/

CSSの変更は再読み込みなしに即座に反映される（スタイル再計算のみで完結するため）。一方でJavaScriptファイルを上書きした場合は、多くのケースでスクリプトの再実行が必要になるためページのリロードを伴う。これはブラウザがCSSOMは動的に再適用できるのに対し、実行済みJavaScriptの副作用（すでに登録されたイベントリスナーや生成済みDOM、確立済みのクロージャ）を巻き戻すことができないという、実行モデル上の制約に起因する。

#### 内部的に何が起きているか

Local Overridesは、ネットワークレイヤーでのインターセプト（プロキシツールで行うような通信の書き換え）ではなく、**DevTools Protocol経由でChromeのリソースローディング機構に「このURLはローカルファイルを使え」という指示を注入する**形で実現されている。したがって次の性質を持つ。

- HTTPレスポンスヘッダーそのもの（`Content-Security-Policy`や`Cache-Control`など）は基本的にオーバーライドの対象外であり、別途「Request blocking」やヘッダーのオーバーライド専用機能（`.headers`ファイルによるレスポンスヘッダー上書き）を併用する必要がある
- CORSやCSPの実際のブラウザ側評価はネットワーク経由のレスポンスと同様に行われるため、ローカルに差し替えたスクリプトが元のCSPポリシーに反する場合はブロックされる。つまりLocal Overridesは「配信元を偽装」しているのではなく「配信されたリソースの中身だけを差し替えている」

#### ハンティングでの使いどころ

- 難読化・圧縮された本番JSに対し、`console.log`やデバッガ用の`debugger;`文を差し込んだ改変版を保存し、リロード後も継続して変数の実行時値を観察する
- クライアントサイドでの入力サニタイズ処理（例: DOMPurifyの設定オブジェクトやカスタムエスケープ関数）を一時的にコメントアウトし、「もしこのサニタイズが失敗したら、その後どのsinkに到達するか」をコードフロー上で確認する（＝自分が権限を持つ検証環境でのホワイトボックス的動作確認であり、本番改ざんではない）
- postMessageハンドラや`window.onmessage`のコールバック内にログを仕込み、実際に飛んでくるオリジン・データ構造をリロードなしで継続観測する

いずれも「本番サービスの実データや他ユーザーに影響を与える改変」ではなく、**自分のブラウザローカルの表示だけを変える無害な操作**である点が重要で、スコープ上も安全に倒すことができる代表的テクニックである。ただし調査対象が第三者の実サービスである場合、Local Overridesでの挙動確認自体は自分のクライアント内で完結するため許可の要否は薄いが、そこで得た知見を実際に悪用ペイロードとして送信して検証する行為（能動的攻撃）は、本教科書のスコープ外（許可されたスコープ・自分の管理下の環境でのみ実施すべき）である。

---

### 基本デバッグ操作のおさらい

source mapとLocal Overridesを使いこなす前提として、Sources パネルでの基礎的なデバッグ操作を押さえておく。

#### ブレークポイントの設置

Sources パネル（`F12`または`Ctrl+Shift+I`で開く）で対象の`.js`ファイルを開き、行番号を右クリックして「Add Breakpoint」を選ぶと、その行の実行直前でスクリプトの実行が一時停止する。

> 出典: How to Debug JavaScript in Chrome（BrowserStack） — https://www.browserstack.com/guide/how-to-debug-js-in-chrome

一時停止中はページの他のJavaScript実行も止まるため、たとえば「入力値がどのタイミングで`innerHTML`に渡るか」を1ステップずつ確認できる。ステップ実行には主に3種類あり、使い分けが重要である。

- **Step over**: 現在行の関数呼び出しには入らず、次の行へ進む（ライブラリ内部まで潜りたくない場合）
- **Step into**: 現在行が関数呼び出しなら、その関数の内部の最初の行まで入る（sink候補の関数実装を追いたい場合）
- **Step out**: 現在の関数の残りを実行しきり、呼び出し元に戻る

#### スコープ・Watch・コールスタックの確認

一時停止中、Scopeパネルにはローカル変数・クロージャ変数・グローバル変数が階層表示され、値の閲覧だけでなく直接書き換えて以降の分岐を変えることもできる。Watchパネルでは`+ Add expression`から任意の式（例: `document.location.hash`や`this.props.userInput`）を登録し、ステップごとに評価結果を継続監視できる。Call Stackパネルは現在の一時停止地点に至るまでの呼び出し連鎖を表示し、「どのイベントハンドラが起点でこのsinkに到達したか」という攻撃経路（source→sink間のデータフロー）の逆引きに直結する。

> 出典: How to Debug JavaScript in Chrome（BrowserStack） — https://www.browserstack.com/guide/how-to-debug-js-in-chrome

#### 条件付きブレークポイント

行番号を右クリックし「Add conditional breakpoint」を選ぶと、任意のJavaScript式を条件として指定できる。

```js
user.isLoggedIn === true
```

条件式が`true`と評価されたときのみ一時停止する。これは特定のユーザー状態・特定の入力値のときだけ発火する脆弱な分岐（例: 管理者フラグが立っているときだけ実行されるデバッグ用sink）を、無関係な実行を何百回もステップ実行せずにピンポイントで捕捉するために極めて有効である。

> 出典: How to Debug JavaScript in Chrome（BrowserStack） — https://www.browserstack.com/guide/how-to-debug-js-in-chrome

#### ログポイント（logpoint）

条件付きブレークポイントと似た仕組みで、行番号右クリックから「Add logpoint」を選ぶと、実行を止めずにコンソールへ式の評価結果を出力し続けられる。`console.log`をソースコードに直接書き込む代わりに使え、Local Overridesで恒久的にコードを改変しなくても一時的なトレースが可能という点で、まず最初に試すべき軽量な手段である。

#### ブラックボックス（ignore list）

Sourcesパネルでライブラリファイルを右クリックし「Add script to ignore list」を選ぶと、そのファイルはステップ実行時にスキップされるようになる。

> 出典: How to Debug JavaScript in Chrome（BrowserStack） — https://www.browserstack.com/guide/how-to-debug-js-in-chrome

React・jQueryなど巨大なサードパーティライブラリの内部実装に毎回ステップインしてしまうと、目的のアプリケーションコードにたどり着くまでに何百ステップも消費する。ブラックボックス設定はこれを避け、「自分たちのコード（あるいは調査対象のアプリケーションコード）」だけを実行フローに残すためのノイズ除去手段である。

#### スニペット（Snippets）

Sourcesパネル内のSnippetsサブパネルでは、任意のJavaScriptコード片を保存し、`Ctrl+S`で保存、`Ctrl+Enter`で現在のページコンテキスト上で実行できる。

> 出典: How to Debug JavaScript in Chrome（BrowserStack） — https://www.browserstack.com/guide/how-to-debug-js-in-chrome

これはConsoleへの1行入力よりも複雑な多行スクリプト（例: ページ内の全`postMessage`リスナーを列挙する、DOM内の`javascript:`スキームを持つ属性を洗い出す、といった調査補助スクリプト）を保持・再利用するのに向いている。

#### エディタ連携

Chrome DevToolsはVS Codeの「Debugger for Chrome」相当の拡張と連携でき、エディタ側でブレークポイントを設置したまま`F5`でデバッガをアタッチしたChromeを起動できる。

> 出典: How to Debug JavaScript in Chrome（BrowserStack） — https://www.browserstack.com/guide/how-to-debug-js-in-chrome

大規模なコードベースを継続的に調査する場合、DevTools単体よりも使い慣れたエディタ上でブレークポイント管理を行いたいケースがあり、この連携はワークフロー効率化に寄与する。

---

### source map と Local Overrides を組み合わせた調査フロー（防御的検証の一例）

1. **可読化**: 対象の圧縮JSにsource mapが公開されていればDevToolsが自動で元コード相当のビューを復元する。公開されていなければ、正規表現ベースのビューティファイア（Sourcesパネル下部の`{}`ボタンによる整形表示）で最低限インデントだけでも復元する
2. **経路の仮説立て**: URLパラメータ・postMessage・`localStorage`など外部から制御可能なsourceの一覧を洗い出し、それぞれにログポイントを置いて実際に値が流れてくるかを確認する
3. **sinkへの到達確認**: 疑わしい`innerHTML`・`document.write`・`eval`系APIにブレークポイントを置き、Call Stackで起点まで遡って本当にsourceからsinkへ制御可能な値が届いているかを検証する
4. **恒久的な計測・改変**: 一時的なログポイントでは追いきれない複雑な処理（例: 何段階もの変換関数を経由するデータ）には、Local Overridesでコードにトレース用の出力やダミーのサニタイズ無効化コードを恒久的に差し込み、リロードを繰り返しながら挙動を観察する
5. **再現性の記録**: 得られた条件（どの入力・どの状態でsinkに到達するか）をメモし、実際の攻撃ペイロード送信を伴う検証は許可されたスコープ内でのみ、かつ本番の実データ・他ユーザーに影響を与えない形で行う

この一連の流れは、あらゆるDOM-based脆弱性（DOM XSS、クライアントサイドprototype pollution、postMessageの検証不備など）の調査における共通の骨格であり、以降の章で扱う個別の脆弱性クラスの解析でも同じ手順を土台として使うことになる。

### まとめ

- source mapは「圧縮後コードと元コードの対応表」であり、実行自体は常に圧縮後コードで行われる。VLQでエンコードされた`mappings`により、DevToolsは1トークン単位で元の変数名・行位置を逆引きできる
- source mapの公開状態や`sourcesContent`の有無は情報漏洩の観点で確認する価値があるが、確認は許可されたスコープ内で行う
- Local Overridesはネットワーク層の書き換えではなく、DevTools Protocol経由でリソースの中身だけをローカルファイルに差し替える仕組みであり、CSP等のブラウザ側ポリシー評価は素通りしない
- ブレークポイント・条件付きブレークポイント・ログポイント・ブラックボックス・スニペットといった基礎機能を適切に使い分けることで、source→sink間のデータフローを効率よく追跡できる
- 本節の技術はあくまで「読み解き・観察」のための土台であり、実際の攻撃的検証は許可されたスコープでのみ実施する
