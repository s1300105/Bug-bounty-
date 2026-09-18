# Sourcesパネルの周辺機能とクライアントサイド脆弱性ハンティングへの応用

> **この節で分かること**
> - Sourcesパネルが持つ周辺機能（Snippets、Workspace、ライブ編集、キーボードショートカット）が何のためにあるのかを説明できる
> - Local Overrides（ローカルオーバーライド）でレスポンスヘッダやレスポンス本体をサーバに触らずに差し替え、脆弱性の成立条件を安全に検証できる
> - source maps（ソースマップ）とpretty printで、minify（縮小化）・バンドルされた配布コードを著者コードとして読み解ける
> - Ignore List（無視リスト）とForce script executionで、フレームワークの雑音やアンチデバッグを排除して自分のコードに集中できる
> - `debug()` / `monitor()` / `monitorEvents()` / `getEventListeners()` / `queryObjects()` などConsole Utilities API（コンソール・ユーティリティAPI）をデバッガと組み合わせて使える
> - source（入力）→ sink（危険な出力先）のデータフローを追い、DOM XSS などクライアントサイド脆弱性の起点をブレークポイントで特定できる

**元資料**: https://developer.chrome.com/docs/devtools/sources ／ https://developer.chrome.com/docs/devtools/overrides ／ https://developer.chrome.com/docs/devtools/javascript/source-maps ／ https://developer.chrome.com/docs/devtools/settings/ignore-list ／ https://developer.chrome.com/docs/devtools/console/utilities ほか（原典取得済み。ただしライブHTMLは執筆環境のegress制限で取得できず、Google公式リポジトリ `GoogleChrome/developer.chrome.com` の原稿Markdownを取得したもの）
**関連する節**: 「Chrome DevTools による JavaScript デバッグ入門」（同章・本節の前半パート。Sourcesパネルの3ペイン構成、ブレークポイントの種類、ステップ実行、Scope/Watch/Call Stackは前半で扱う）

---

## 0. この節の前提（1分の復習）

Sourcesパネルとは、DevTools のなかで JavaScript をデバッグする場所のこと。「File Navigator（Page）ペイン／Code Editor ペイン／JavaScript Debugging ペイン」の3部構成で、コードの任意地点で実行を止め、その瞬間の全変数を観測できる。

ブレークポイント（breakpoint）とは、コード実行を意図的に停止させる地点のこと。停止中はその瞬間の全変数値を検査できる。line-of-code（行）／conditional（条件付き）／logpoint（ログ）／DOM／XHR-fetch／event listener／exception／function／Trusted Type の9種類がある（詳細は本節前半パート）。

本パートで最終的に扱う目標のひとつが DOM XSS の起点特定である。DOM XSS（DOM-based Cross-Site Scripting）とは、サーバではなく**ブラウザ内の JavaScript が DOM を操作する過程**で、攻撃者の入力が任意スクリプトとして実行されてしまう脆弱性のこと。たとえば URL の `#...`（フラグメント）に入れた文字列を、ページの JavaScript がそのまま `element.innerHTML` に代入すると、そこに書いたスクリプトが動いてしまう。この「入力（source）が危険な出力先（sink）に届く経路」を追うことが本パートの応用の中心になる（§8 で詳説）。

本パートでは、これら中核機能の**周辺にある道具**（Snippets、Local Overrides、source maps、Ignore List、Console Utilities API）と、それらを**脆弱性ハンティングへどう応用するか**を扱う。

---

## 1. Sourcesパネルの全体像と周辺機能

### 1.1 Sourcesパネルの5つの用途

公式ドキュメントは Sources パネルの用途を次のように挙げている（原文逐語訳）。

- ファイルを表示する。
- CSS と JavaScript を編集する。
- 任意のページで実行できる **Snippets** を作成・保存する。**Snippets は bookmarklet に似ている。**
- JavaScript をデバッグする。
- **Workspace** を設定して、DevTools での変更をファイルシステム上のコードに保存する。

### 1.2 View files — Page ペインの木構造

Page ペインとは、ページが読み込んだすべてのリソースを一覧するファイルツリーのこと。原文の説明では次の階層構造を持つ。

```
top                                  ← HTML frame（メインドキュメントのフレーム。あらゆるページに存在）
 └ developers.google.com             ← origin（オリジン）
    └ _static/19aa27122b/css/        ← ディレクトリ
       └ devsite-googler-button      ← リソース
```

- 最上位（例: `top`）は HTML frame を表す。`top` は訪問するあらゆるページに存在し、メインドキュメントのフレームを表す。
- 第2レベル（例: `developers.google.com`）は origin を表す。オリジンとは、スキーム・ホスト・ポートの3つ組で決まる、Webの安全境界の単位のこと。
- 第3レベル以降は、その origin から読み込まれたディレクトリとリソースを表す。

Page ペインでファイルをクリックすると Editor ペインに内容が表示される。任意の種類のファイルを表示でき、画像はプレビューが表示される。

> **Note（原文）**: Page ペインは、読み込まれデプロイされたスタイルシートのみを列挙する。

脆弱性ハンティングの観点では、この木構造が「そのページが**どのオリジンから何を読み込んでいるか**」の地図になる。見知らぬサードパーティのオリジンや、想定外のスクリプトの読み込みを最初に発見する場所である。

### 1.3 Edit CSS and JavaScript — ライブ編集の落とし穴

Editor ペインで CSS と JavaScript を直接編集できる。DevTools は新しいコードを実行するようページを更新する。さらに Editor は、構文エラーやその他の問題（失敗した CSS `@import` と `url()` 文、無効な URL を持つ HTML `href` 属性など）の隣に下線とインラインのエラーツールチップを表示する。

CSS の変更（例: `background-color`）は即座に反映される。一方 JavaScript は次の点に注意する。

- JavaScript の変更を反映するには `Command`+`S`（Mac）または `Control`+`S`（Windows, Linux）を押す。
- **DevTools はスクリプトを再実行しない。** そのため反映される JavaScript の変更は、**関数の内部で行ったものだけ**である。

たとえば次のような違いが生じる。

```js
console.log('A'); // トップレベル（関数の外）→ 保存しても再実行されないので反映されない
function f() {
  console.log('B'); // 関数の内部 → 次に f() が呼ばれたときに反映される
}
```

もし DevTools が保存時にスクリプト全体を再実行していたなら、テキスト `A` が Console にログされていたはずである。実際にはされない。この挙動を知らないと「編集したのに変わらない」と誤解しやすい。

なお **DevTools はページをリロードすると CSS と JavaScript の変更を消去する。** 変更を永続化したい場合は Workspace を使う。

### 1.4 Snippets — 使い回すJavaScriptを保存する

Snippets（スニペット）とは、Sources パネル内で作成・実行できる小さなスクリプトのこと。任意のページからアクセス・実行でき、**実行すると現在開いているページのコンテキストで実行される**。原文いわく「bookmarklet の代替」であり、Console で同じコードを繰り返し実行しているなら Snippet として保存するとよい。Sources パネルで作成し、任意のページおよびシークレットモードでも実行できる。

原文が最初に挙げる動機の例は、jQuery のようなライブラリをページに注入する次のような Console コードである（原文のまま逐語）。こういう「毎回打つ定型コード」こそ Snippet に保存する候補になる。

```js
let script = document.createElement('script');
script.src = 'https://code.jquery.com/jquery-3.2.1.min.js';
script.crossOrigin = 'anonymous';
script.integrity = 'sha256-hwg4gsxgFZhOsEEamdOYGBf13FyQuiTwlAQgxVSNgt4=';
document.head.appendChild(script);
```

Snippets の入門用サンプルとしては、次の `Hello, Snippets!` コードが原文に載っている（原文のまま逐語）。

```js
console.log('Hello, Snippets!');
document.body.innerHTML = '';
const p = document.createElement('p');
p.textContent = 'Hello, Snippets!';
document.body.appendChild(p);
```

Run ボタンをクリックすると、Console ドロワーがポップアップして `Hello, Snippets!` メッセージを表示し、ページの内容が変わる。

Snippets ペインを開く方法は2通り。

1. **Sources** > **More tabs** > **Snippets** に移動する。
2. Command Menu から: `Control`+`Shift`+`P`（Windows/Linux）または `Command`+`Shift`+`P`（Mac）で Command Menu を開き、`Snippets` と入力して **Show Snippets** を選び `Enter`。

Snippet の実行方法。

- **Sources パネルで実行**: Snippet 名をクリックし、エディタ下部のアクションバーの **Run**、または `Control`+`Enter`（Windows/Linux）／`Command`+`Enter`（Mac）。
- **Command Menu から実行**: `Control`+`O`（Windows/Linux）または `Command`+`O`（Mac）で開き、`!` 文字に続けて Snippet 名を入力して `Enter`。

Snippets ペインは snippet を**アルファベット順**に並べる。作成・編集・改名・削除は Snippets ペインでの操作、または Command Menu の **Create new snippet** から行う。編集中は snippet 名の隣のアスタリスクが未保存の変更を示す。具体的なメニュー名は次のとおり。

- **作成**: Snippets ペインで **New snippet**、または Command Menu で **Create new snippet**。
- **改名**: Snippets ペインで snippet 名を**右クリック**し **Rename** を選ぶ。
- **削除**: Snippets ペインで snippet 名を**右クリック**し **Remove** を選ぶ。

> **保存先についての原文の食い違い**: Sources パネル概要ページには「DevTools は Snippet をファイルシステムに保存する」とある。一方 Snippets 専用ページには次の Aside がある。「**DevTools は snippet をローカルの preferences として保存する。設定と一緒に同期（sync）せず、ファイルシステム経由でアクセスすることもできない。**」原文が両ページで食い違っているため、ここでは両方を記録しておく。少なくとも「他人と再現手順を共有する用途には向かない」と理解しておくのが安全。

### 1.5 Focus only on your code — 自分のコードだけに集中する

> **Note（原文）**: 以下の機能は Chrome バージョン 106 から利用できる。

現代の Web はフレームワークやビルドツールが大量のコードを生む。DevTools はその雑音をフィルタして、自分が書いたコードだけに集中できるようにする。具体的には次を行う。

- **著者コードとデプロイコードを分離する。** Sources パネルは、あなたが書いたコードを bundle・minify されたコードから分離する。
- **既知のサードパーティコードを無視する:**
  - Sources パネルはそうしたソースを Page ペインのファイルツリーから隠す。
  - Console はスタックトレースからそうしたフレームを隠す。
  - Open File メニューは検索結果からそうしたファイルを隠す。

さらにフレームワークが対応していれば、デバッガの Call Stack と Console のスタックトレースが非同期処理の完全な履歴を表示する。

### 1.6 Set up a Workspace — DevToolsをコードエディタにする

Workspace（ワークスペース）とは、DevTools での変更をファイルシステムに保存できるようにする仕組みのこと。既定では Sources パネルでの編集はリロードで失われるが、Workspace を設定すると変更がファイルに書き戻され、要するに DevTools をコードエディタとして使えるようになる。

---

## 2. キーボードショートカット（Sourcesパネル／Code Editor）

デバッグは操作の速さがそのまま調査効率になる。以下は公式のショートカット表を逐語で再現したもの。

### 2.1 Sources panel keyboard shortcuts

| Action | Mac | Windows / Linux |
| --- | --- | --- |
| Pause script execution (if currently running) or resume (if currently paused) | `F8` or `Command`+`\` | `F8` or `Control`+`\` |
| Step over next function call | `F10` or `Command`+`'` | `F10` or `Control`+`'` |
| Step into next function call | `F11` or `Command`+`;` | `F11` or `Control`+`;` |
| Step out of current function | `Shift`+`F11` or `Command`+`Shift`+`;` | `Shift`+`F11` or `Control`+`Shift`+`;` |
| Continue to a certain line of code while paused | Hold `Command` and then click the line of code | Hold `Control` and then click the line of code |
| Select the call frame below / above the currently-selected frame | `Control`+`.` / `Control`+`,` | `Control`+`.` / `Control`+`,` |
| Save changes to local modifications | `Command`+`S` | `Control`+`S` |
| Save all changes | `Command`+`Option`+`S` | `Control`+`Alt`+`S` |
| Go to line | `Control`+`G` | `Control`+`G` |
| Jump to a line number of the currently-open file | `Command`+`O` で Command Menu を開き、`:` に続けて行番号、`Enter` | `Control`+`O` で Command Menu を開き、`:` に続けて行番号、`Enter` |
| Jump to a column（例: 5行9列） | `Command`+`O` → `:` → 行番号 → もう一度 `:` → 列番号 → `Enter` | `Control`+`O` → `:` → 行番号 → `:` → 列番号 → `Enter` |
| Go to a function declaration / rule set | `Command`+`Shift`+`O` して名前を入力/選択 | `Control`+`Shift`+`O` して名前を入力/選択 |
| Close the active tab | `Option`+`W` | `Alt`+`W` |
| Open next or previous tab | `Function`+`Command`+`Up`/`Down` | `Control`+`Page Up`/`Page Down` |
| Toggle the Navigation sidebar on the left | `Command`+`Shift`+`Y` | `Control`+`Shift`+`Y` |
| Toggle the Debugger sidebar on the right | `Command`+`Shift`+`H` | `Control`+`Shift`+`H` |

### 2.2 Code Editor keyboard shortcuts

| Action | Mac | Windows / Linux |
| --- | --- | --- |
| Delete all characters in the last word, up to the cursor | `Option`+`Delete` | `Control`+`Delete` |
| Add or remove a line-of-code breakpoint | カーソルを行に置いて `Command`+`B` | カーソルを行に置いて `Control`+`B` |
| Open the breakpoint edit dialog（conditional / logpoint 編集） | カーソルを行に置いて `Command`+`Alt`+`B` | カーソルを行に置いて `Control`+`Alt`+`B` |
| Go to matching bracket | `Control`+`M` | `Control`+`M` |
| Toggle single-line comment | `Command`+`/` | `Control`+`/` |
| Select / de-select the next occurrence of the current word | `Command`+`D` / `Command`+`U` | `Control`+`D` / `Control`+`U` |

〔補足（一般知識）〕リファレンス本文中では step を `F9`、resume を `F8` と表記している箇所がある。上表では step over が `F10`、step into が `F11`。`F9` は歴史的に step の別名として DevTools に残っており、原文の両方の記述をそのまま記録している。実際のキー割り当ては自分の OS で確認するとよい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DevTools keyboard shortcuts（Sources 節） — https://developer.chrome.com/docs/devtools/shortcuts#sources
> **なぜ**: 本教科書の執筆環境からは developer.chrome.com のライブHTMLを自動取得できなかった（理由: サイト側のegress制限。同一内容を生成する公式リポジトリ原稿から取得している）。上表は原稿Markdownの逐語だが、キー割り当てはOSやChromeバージョンで差が出うる。
> **読みどころ**:
> 1. 自分のOSでの実際のキー割り当て（特にstepの `F9`/`F10`/`F11` 表記）を確認する。
> 2. Command Menu（`Control`/`Command`+`O` → `:` 行番号）でのジャンプ操作を体で覚える。
> **代替手段**: なし（機能自体はDevToolsを開けば手元で確認できる）

---

## 3. Local Overrides — サーバに触らず応答を差し替える

### 3.1 なぜあるのか（設計意図）

Local Overrides（ローカルオーバーライド）とは、HTTP レスポンスヘッダと web コンテンツ（XHR と fetch リクエストを含む）を上書きし、**アクセス権がないリモートリソースでもモックできる**機能のこと。これによりバックエンドの対応を待たずに変更をプロトタイプできる。しかも Local Overrides は、DevTools で行った変更を**ページ読み込みをまたいで保持する**。ここが Editor での一時的なライブ編集（リロードで消える）との決定的な違いである。

### 3.2 どう動くのか（仕組み）

- DevTools で変更を加えると、DevTools は変更されたファイルのコピーを指定したフォルダに保存する。
- ページをリロードすると、DevTools はネットワークリソースではなく**ローカルの変更済みファイル**を提供する。

```
[通常]     ブラウザ → ネットワーク → サーバの応答をそのまま表示
[Override] ブラウザ → DevTools が横取り → ローカルの変更済みファイルを応答として返す
```

制約（Limitations）もある。

- DevTools は Elements パネルの DOM ツリーで行った変更を保存しない。
- Styles ペインで編集した CSS のソースが HTML ファイルである場合、変更を保存しない（代わりに Sources パネルで HTML を編集する）。
- source-mapped されたファイルは上書きできない。Network で右クリック **Override content** を選ぶと、DevTools は元のソースファイルへ案内するダイアログを表示する。

### 3.3 手を動かす — セットアップ

1. DevTools を開き、**Network** パネルに移動し、上書きしたいリクエストを右クリックして **Override headers** または **Override content** を選ぶ。
2. まだ設定していない場合、上部のアクションバーで DevTools が促す。
   1. オーバーライドファイルを保存する **Select a folder**（フォルダを選択）。
   2. **Allow** をクリックして DevTools にアクセス権を付与する。
3. 設定済みだが無効なら、DevTools が自動的に有効化する。
4. 有効化後、web コンテンツ変更なら **Sources** パネル、レスポンスヘッダ変更なら **Network** > **Headers** > **Response Headers** のエディタへ移動する。

一時無効化や全削除は、**Sources** > **Overrides** で **Enable Local Overrides** チェックボックスをクリアするか **Clear** をクリックする。個別削除は同ペインでファイル／フォルダを右クリック **Delete** → **OK**。この操作は取り消せず、削除したオーバーライドは手動で再作成する必要がある。すべてのオーバーライドを素早く見るには、Network でリクエストを右クリック **Show all overrides**。

### 3.4 レスポンスヘッダを上書きする

Network パネルから、**Web サーバへのアクセス権なしに** HTTP レスポンスヘッダを上書きできる。原文が例に挙げるのは次のヘッダ群（これに限らない）。

- Cross-Origin Resource Sharing (CORS) Headers
- Permissions-Policy Headers
- Cross-Origin Isolation Headers

手順（原文のデモページ https://cors-demo-devtools.glitch.me/ を例に）。

1. Local Overrides を設定する。
2. Network でリクエストを右クリック **Override headers**。DevTools が **Headers** > **Response Headers** エディタに移動する。
3. レスポンスヘッダの値にホバーする、または編集アイコンをクリックする。
4. ヘッダを修正または新規追加する。値の編集はクリック、追加は **Add header**、削除は隣の削除アイコン。DevTools は修正したヘッダを**緑**でハイライトし、削除したオーバーライドを**赤の取り消し線**で示す。
5. ページを **Refresh** して変更を適用する。

原文の例で CORS エラーを解消するために追加しているヘッダ（原文のまま逐語）。

```
Access-Control-Allow-Origin: *
```

### 3.5 `.headers` ファイルとワイルドカード

複数のオーバーライドをまとめて編集するには、**Response Headers** セクションの隣の **Header overrides** をクリックする。DevTools は **Sources** > **Overrides** の対応する **`.headers` ファイル**に移動する。

- 新しいオーバーライドルールを追加するには **Add override rule**。ここでのルールは、「ヘッダと値の集合」と「それを適用する単一または複数のリクエスト」の組である。
- 複数リクエストを一度に指定するにはワイルドカードを使う。**複数文字は `*`、単一文字は `?`** で指定する。
- 保存は `Command` / `Control` + `S`、適用は **Refresh**。

なお XHR/fetch のコンテンツをモックする場合は、Network で XHR/fetch をフィルタして右クリック **Override content** → データを変更して保存 → **Refresh** で確認する。加えた変更は **Changes** ドロワータブで一箇所に追跡できる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Override web content and HTTP response headers locally — https://developer.chrome.com/docs/devtools/overrides
> **なぜ**: 本文はGoogle公式リポジトリの原稿から取得しているが、ライブHTMLは執筆環境のegress制限で自動取得できなかった。`.headers` ファイルの実際の書式、ワイルドカード（`*` / `?`）の使用例、緑ハイライト・赤取り消し線の見え方はスクリーンショットで確認するのが速い。
> **読みどころ**:
> 1. `.headers` ファイルにおけるルール（対象URLパターン＋ヘッダ集合）の具体的なJSON的書式。
> 2. ワイルドカードで複数リクエストへ一括適用する実例。
> **代替手段**: なし（自分のChromeでNetwork右クリック→Override headersから実物を作れる）

---

## 4. source maps — minifyされたコードを著者コードとして読む

### 4.1 なぜあるのか

配布される JavaScript は、結合（bundle）・縮小化（minify）・コンパイルを経て人間には読めない1行の塊になる。source maps（ソースマップ）とは、その圧縮済みコードを**元のソースコードに対応づける地図ファイル**のこと。Sources パネルで source maps を使うと、Chrome は実際には minify されたコードを実行するが、Sources パネルは**あなたが書いたコード**を見せる。ソースファイルにブレークポイントを設定してステップでき、すべてのエラー・ログ・ブレークポイントが自動的にマップされる。

### 4.2 どう動くのか

Sources パネルで source maps を使う前提は2つ。

- source maps を生成できるプリプロセッサのみを使う。
- Web サーバが source maps を配信できることを確認する。

source maps と組み合わせて使われる代表的なプリプロセッサ（原文逐語、これに限らない）。

| 分類 | ツール（原文表記） |
| --- | --- |
| Transpilers | Babel |
| Compilers | TypeScript, Dart |
| Minifiers | terser |
| Bundlers and development servers | Webpack, Vite, esbuild, Parcel |

有効化は **Settings** > **Preferences** > **Sources** で **Enable JavaScript source maps** をチェックする（**Enable CSS source maps** も必要ならチェック）。

### 4.3 手を動かす — source mapsでデバッグする

原文のデモ（https://github.com/jecfish/parcel-demo）を使う手順。

1. Sources パネルで Web サイトのソースを開く。
2. ファイルツリーで authored（著者）と deployed（配布）をグループ化し、**Authored** セクションを展開して元ソースを Editor で開く。
3. ブレークポイント（例: logpoint）を通常どおり設定してコードを実行する。
4. Editor 下部のステータスバーに **deployed ファイルへのリンク**が置かれることに注目する。
5. Console ドロワーを開く。logpoint のメッセージの隣に、deployed ではなく**元のファイルへのリンク**が表示される。
6. ブレークポイント種類を通常のものに変えて再実行すると停止する。**Call Stack** ペインが deployed ではなく**元のファイル名**を表示することに注目する。
7. Editor 下部の deployed ファイルへのリンクをクリックすると、Sources パネルが対応するファイルへ移動する。

任意の deployed ファイルを開いたとき、DevTools は `//# sourceMappingURL` コメントと関連する元ファイルを見つけたかどうかを通知する。Editor は deployed ファイルを自動的に pretty-print する（実際には `//# sourceMappingURL` コメントを除いて全コードが1行に入っている）。

### 4.4 `#sourceURL` — eval生成コードに名前を付ける

`//# sourceURL=/path/to/source.file` コメントは、`eval()` を使うときにブラウザにソースファイルを探すよう指示する。これにより evaluation やインラインスクリプト・スタイルに名前を付けられる。

```
//# sourceURL=/path/to/source.file
```

```
//# sourceMappingURL
```

〔補足（一般知識）〕`//# sourceURL` は動的に評価されたスクリプト（`eval`、`new Function`、インジェクトされたインラインスクリプト）に名前を与える仕組みであり、DOM XSS 解析時に「どの eval 由来のコードか」を追跡する手掛かりになる。

### 4.5 source mapが読み込めているか確認する（Developer Resources）

Developer Resources タブを使って、DevTools が source maps の読み込みに成功したかを確認できる。DevTools を開くと source maps があれば読み込みを試み、失敗すると Console が同様のエラーをログする。

確認手順。

1. DevTools を開き、source maps を有効化し、三点メニュー > **More tools** > **Developer Resources** に移動する。
2. テーブルの列を確認する。**Status**（読み込み成功か失敗か）、**Error**（エラーメッセージ）。上部テキストボックスで URL やエラーによる絞り込みもできる。

**Troubleshoot**: 既定では **DevTools がサイトではなく source maps を要求する**。そのリクエストは cross-origin として扱われ、通らない場合がある。Web サイト側に先に要求させるには、Developer Resources 右上の **Enable loading through target** をチェックする。

**手動ロード（Load a source map manually）** — 読み込み失敗時や、**source maps を持たない本番サイトで元コードをデバッグしたい**場合に有効。

1. source maps をサポートするツールで source maps を生成する。
2. source maps をローカルにホストする。
3. 対象ページで DevTools を開き、source maps を有効化する。
4. Sources で deployed（処理済み）ファイルを開き、Editor で右クリック → **Add source map**。
5. テキストボックスに source map の URL を指定し **Add**。
6. Developer Resources に source map が現れ、元ファイルがファイルツリーに現れたか確認する。
7. 元ファイルのデバッグに進む。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Debug original code with source maps / Developer Resources — https://developer.chrome.com/docs/devtools/javascript/source-maps ／ https://developer.chrome.com/docs/devtools/developer-resources
> **なぜ**: ライブHTMLをegress制限で自動取得できず公式リポジトリ原稿から要約している。**Add source map** ダイアログや **Enable loading through target** のトグル、Developer Resources の Status/Error 列の見え方は実物で確認するのが確実。
> **読みどころ**:
> 1. source mapが読み込めない典型エラー（cross-originで弾かれる）と、その回避（Enable loading through target）。
> 2. source mapを持たない本番サイトへ手動ロードして著者コードを復元する手順。
> **代替手段**: なし

---

## 5. ノイズ除去とアンチデバッグ対策

### 5.1 Ignore List（旧 blackbox）

Ignore List（無視リスト）とは、デバッガが無視するスクリプトの一覧のこと（旧称 blackbox）。フレームワークや拡張のコードでいちいち停止してしまう雑音を消すためにある。

**メインスイッチ**: **Settings** > **Ignore List** タブで **Enable Ignore Listing** をチェックまたはクリアする。これがすべての ignore-listing 機能のメインスイッチである。

主な設定項目。

| 設定（原文名） | 何をするか |
| --- | --- |
| Enable Ignore Listing | ignore-listing 全体のメインスイッチ |
| Add content scripts to ignore list | Chrome 拡張の content script で停止しないようにする |
| Automatically add known third-party scripts to ignore list | source maps の `ignoreList` プロパティに基づき既知のサードパーティを自動追加（Angular や Nuxt などが対応。フレームワーク/バンドラが情報を供給する必要がある） |
| Custom exclusion rules | 無視するスクリプト名、または**スクリプト名のRegExパターン**を **Add pattern** で追加 |

カスタムパターンの追加手順。

1. **Settings** > **Ignore List** > **Enable Ignore Listing** をチェックする。
2. **Custom exclusion rules** で **Add pattern** をクリックする。
3. 無視するスクリプト名または RegEx パターンを指定する。
4. **Add** で保存する。

個別の有効／無効は同セクションのチェックボックスで切り替え、編集・削除はホバーで現れるボタンから行う。無視したフレームも見たいときは、Call Stack セクションの **Show ignore-listed frames** で完全なスタックを一時表示できる。

### 5.2 Force script execution と Deactivate breakpoints

- **Force script execution**: Resume（再開）ボタンを**長押し**して選択すると、すべてのブレークポイントを無視して再開する。
- **Deactivate breakpoints**: 設定済みの全ブレークポイントを DevTools に一括で無視させるトグル。

〔補足（一般知識）〕悪意あるページは `debugger` 文を無限ループで撒いてデバッグを妨害する（アンチデバッグ）ことがある。これに対しては、**Force script execution**、**Deactivate breakpoints**、および該当スクリプトの **Ignore List への追加**が実務的な対処になる。

### 5.3 Disable JavaScript

JavaScript を無効にしたときのページの見え方・振る舞いを確認できる。手順。

1. DevTools を開く。
2. `Control`+`Shift`+`P`（Windows/Linux）または `Command`+`Shift`+`P`（Mac）で Command Menu を開く。
3. `javascript` と入力し **Disable JavaScript** を選んで `Enter`。

無効時は Chrome がアドレスバーに対応アイコンを、DevTools が Sources の隣に警告アイコンを表示する。**JavaScript は DevTools を開いている限りこのタブで無効のまま維持される。** 再有効化は Command Menu で **Enable JavaScript** を実行するか、DevTools を閉じる。Settings の Debugger からも切り替えられる。

〔補足（一般知識）〕JS を切ると「サーバがそもそも何を素の HTML として返しているか」「JS 非依存で露出する情報や機能は何か」が見え、クライアント側の防御に頼っている箇所を炙り出せる。

---

## 6. Sources / Debugger の設定項目

Settings の主要項目を表で整理する（原文の説明を逐語訳）。

### 6.1 Sources 設定

| 設定（原文名） | 内容 | 備考 |
| --- | --- | --- |
| Search in anonymous and content scripts | Search タブで、Chrome 拡張内を含む全 JS ファイルを検索できるようにする | 〔補足〕拡張や匿名スクリプトに埋もれた sink 検索に有用 |
| Automatically reveal files in sidebar | Editor のタブ切替時に Page ペインで該当ファイルを選択 | — |
| Enable JavaScript source maps | 生成/minify 済み JS のソースを DevTools が見つけられるようにする | source maps 利用可能時のみ機能 |
| Enable tab moves focus | `Tab` キーで Tab 文字挿入ではなくフォーカス移動 | リロード必要。Default indentation を無効化 |
| Detect indentation | 開いたソースのインデントに合わせる | リロード必要。Default indentation を上書き |
| Show whitespace characters | 空白文字を表示（None / All / Trailing） | リロード必要 |
| Autocompletion | Editor で補完候補を有効化 | — |
| Bracket matching | 対応のない括弧を下線＋薄い赤で表示 | — |
| Code folding | 波括弧内のコードブロックを折りたたみ/展開 | リロード必要 |
| Display variable values inline while debugging | 停止中に代入文の隣へ変数値を表示 | inline evaluation に対応 |
| Focus Sources panel when triggering a breakpoint | 停止させたブレークポイント行で Sources > Editor を開く | — |
| Enable CSS source maps | 生成済み CSS（例: `.scss`）のソースを表示 | Authored に `.scss` を表示 |
| Allow scrolling past end of file | 最終行より先までスクロール可 | — |
| Allow DevTools to load resources ... from remote file paths | **既定で無効（セキュリティ上の理由）** | 原文Caution:「Remote file paths are a security vulnerability。結果を理解している場合のみ使うのが最善」 |
| Default indentation | `Tab` の挿入空白数（2 / 4 / 8 spaces / Tab character） | Detect indentation が上書き |

### 6.2 Debugger 設定

| 設定（原文名） | 内容 |
| --- | --- |
| Disable JavaScript | JS 無効時のページの見え方・振る舞いを確認できる。無効時はアドレスバーに対応アイコン、Sources の隣に警告アイコン |
| Disable async stack traces | Call Stack における非同期処理の「全体像（full story）」を隠す。既定ではフレームワークが対応していれば非同期を追跡する |

---

## 7. Console Utilities API — デバッガと連携するコマンド

Console Utilities API とは、Console から呼べる特別なヘルパー関数群のこと。ここではデバッガと直接連携する主要関数を扱う（原文逐語＋コード）。

### 7.1 関数を捕まえる — `debug()` / `undebug()`

`debug(function)`: 指定した関数が呼ばれたとき、デバッガが起動し Sources パネルでその**関数内部で break** するので、ステップ実行できる。

```js
debug(getData);
```

break を止めるには `undebug(fn)` を使うか、UI で全ブレークポイントを無効化する。

```js
undebug(getData);
```

### 7.2 呼び出しを記録する — `monitor()` / `unmonitor()`

`monitor(function)`: 指定した関数が呼ばれるたびに、関数名と渡された引数が Console にログされる。

```js
function sum(x, y) {
  return x + y;
}
monitor(sum);
```

停止は `unmonitor(function)`。

```js
unmonitor(getData);
```

### 7.3 イベントを監視する — `monitorEvents()`

`monitorEvents(object [, events])`: 指定オブジェクトで指定イベントが発生したとき、Event オブジェクトが Console にログされる。単一イベント、イベント配列、または事前定義された汎用イベント "types" のいずれかを指定できる。

```js
monitorEvents(window, "resize");
```

```js
monitorEvents(window, ["resize", "scroll"])
```

汎用イベント "types" と対応イベントのマッピング（原文逐語）。

| Event type | Corresponding mapped events |
| --- | --- |
| mouse | "mousedown", "mouseup", "click", "dblclick", "mousemove", "mouseover", "mouseout", "mousewheel" |
| key | "keydown", "keyup", "keypress", "textInput" |
| touch | "touchstart", "touchmove", "touchend", "touchcancel" |
| control | "resize", "scroll", "zoom", "focus", "blur", "select", "change", "submit", "reset" |

Elements で現在選択中の要素（`$0`）に対して "key" タイプを使う例。

```js
monitorEvents($0, "key");
```

停止は `unmonitorEvents(object[, events])`。

```js
unmonitorEvents(window);
```

### 7.4 リスナとインスタンスを列挙する — `getEventListeners()` / `queryObjects()`

`getEventListeners(object)`: 指定オブジェクトに登録されたイベントリスナを返す。戻り値は、登録された各イベント種別（例: `click`、`keydown`）ごとに配列を含むオブジェクトで、各配列のメンバーがリスナを記述するオブジェクトである。

```js
getEventListeners(document);
```

`queryObjects(Constructor)`: 指定コンストラクタで作られたオブジェクトの配列を返す。スコープは Console で現在選択中の実行コンテキスト。

- `queryObjects(Promise)` — すべての `Promise` インスタンス。
- `queryObjects(HTMLElement)` — すべての HTML 要素。
- `queryObjects(foo)` — `new foo()` でインスタンス化された全オブジェクト。

### 7.5 その他の主要ユーティリティ

- `inspect(object/function)` — 指定要素/オブジェクトを適切なパネルで開く（DOM要素なら Elements、ヒープオブジェクトなら Profiles）。関数を渡すと Sources でドキュメントを開ける。

  ```js
  inspect(document.body);
  ```

- `$_` — 最後に評価された式の値。
- `$0`〜`$4` — Elements で検査した直近5要素への参照。
- `$(selector [, startNode])` — CSS セレクタに一致する最初の DOM 要素。
- `$$(selector [, startNode])` — CSS セレクタに一致する要素の配列。
- `$x(path [, startNode])` — XPath 式に一致する DOM 要素の配列。
- `copy(object)` — オブジェクトの文字列表現をクリップボードへコピー。

  ```js
  copy($0);
  ```

- `clear()` — Console 履歴のクリア。
- `dir(object)` / `dirxml(object)` — `console.dir()` / `console.dirxml()` のショートカット。
- `keys(object)` / `values(object)` — プロパティ名／値の配列。
- `table(data [, columns])` — `console.table()` のショートカット。

  ```js
  let names = [
    { firstName: "John", lastName: "Smith" },
    { firstName: "Jane", lastName: "Doe" },
  ];
  table(names);
  ```

- `profile([name])` / `profileEnd([name])` — JS CPU プロファイリング開始/終了。結果を Performance > Main に表示。ネスト可。

  ```js
  profile("Profile 1")
  profileEnd("Profile 1")
  ```

---

## 8. クライアントサイド脆弱性ハンティングへの応用

ここからは原典の機能記述を、**許可された診断・バグバウンティ・自分で立てた検証環境**を前提とした作業手順へ翻訳する。機能名・挙動は原典どおりであり、応用の観点には〔補足（一般知識）〕を付す。攻撃手法は必ず防御・検出と対で理解すること。

### 8.1 source → sink のデータフローを追う

DOM XSS（DOM-based Cross-Site Scripting）とは、サーバではなく**ブラウザ内の JavaScript が DOM を操作する過程**で任意スクリプトが実行される脆弱性のこと。原典（breakpoints ページの Trusted Type 節）の定義がそのまま方法論になる。

- **source（ソース）** = ユーザが制御できる入力。ユーザ名、URL フラグメント（`#...`）由来の redirect URL など。
- **sink（シンク）** = `eval()` のような関数や `.innerHTML` のようなプロパティ setter で、**任意 JS を実行できる**もの。

source のデータが sink に到達すると DOM XSS が発生する。

```
source（#フラグメント / postMessage / location など）
   │  … データが流れる …
   ▼
sink（.innerHTML / eval() / document.write / new Function など）→ 任意JS実行
```

〔補足（一般知識）〕原典の機能を組み合わせた具体的な追跡手順。

1. **CSP Violation Breakpoints > Sink Violations** を有効化する。Trusted Types を導入したページでは sink 到達点で実行が止まるため、source → sink の経路を Call Stack で一気に特定できる。Trusted Types とは、危険な sink に文字列を直接渡せなくし、検証済みの型オブジェクトだけを通す DOM XSS 対策の仕組みのこと。
2. Trusted Types 未導入のページでは、**Event Listener Breakpoints**（`click`、`hashchange`、`message` など）と **DOM change breakpoints（Subtree modifications）** を併用する。`.innerHTML` による書き込みは DOM 変更ブレークポイントで停止し、Call Stack が書き込み元のコードを示す。
3. `debug(fn)` を Console から呼び、疑わしいテンプレート展開関数・sanitize（無害化）関数の入口で必ず止める（対象関数がスコープ内にある状態で呼ぶ。スコープ外だと `ReferenceError`）。
4. `getEventListeners(window)` / `getEventListeners(document)` で `message` / `hashchange` リスナを列挙し、`postMessage` 経由の source を洗い出す。`monitorEvents(window, "message")` で実際に飛んでくるイベントをログする。

**どう守るか**: Trusted Types の導入、sink 手前での適切なサニタイズ／エンコード、`innerHTML` の代わりに `textContent` を使う、CSP（Content Security Policy）で `eval` を禁止する、などが基本。DevTools はまさにこの「source が sink に届いていないか」を検証する道具になる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Trusted Types による DOM XSS 対策（web.dev） — https://web.dev/articles/trusted-types ／ CSP/Trusted Types のデバッグ — https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems
> **なぜ**: この外部文書は執筆環境から自動取得できていない（原典の breakpoints ページが参照しているのみ）。以下の記述は原典側の参照リンクにもとづく。Trusted Types の実装方法とDevToolsでの違反デバッグは一次情報を読む価値が高い。
> **読みどころ**:
> 1. Trusted Types をCSPで有効化する具体的なヘッダ（`Content-Security-Policy: require-trusted-types-for 'script'`）とポリシー定義の書き方を学ぶ。
> 2. CSP Violation Breakpoints の Sink Violations / Policy Violations が、どの違反でどう止まるかを対応づける。
> **代替手段**: MDN の Trusted Types / CSP のドキュメント（無料）

### 8.2 通信境界で止める

| 道具 | 原典の挙動 | 〔補足〕応用（許可された診断前提） |
| --- | --- | --- |
| XHR/fetch breakpoint | 要求 URL が指定文字列を含むとき `send()` の行で停止 | API パス片（`/api/`、`token=` など）を指定すれば、トークン組み立てやリクエスト署名ロジックの直前で止められる |
| Local Overrides（ヘッダ上書き） | `Access-Control-Allow-Origin: *` などを追加できる | CORS・`Permissions-Policy`・COOP/COEP の有無が脆弱性の成立条件になる場合、サーバを触らず「このヘッダが無かったら／緩かったら何が起きるか」を安全に検証できる。`.headers` と wildcard（`*`=複数文字、`?`=単一文字）で適用範囲を指定 |
| Local Overrides（XHR/fetch本体上書き） | レスポンス本体をモックできる | サーバ応答を改変したときのクライアント側の扱い（型混同、`innerHTML` への流し込み、プロトタイプ汚染の起点）を確認できる |

**防御の視点**: これらは「クライアントがサーバ応答を過信していないか」を試す。守る側は、応答値を DOM に入れる前に検証する、CORS を必要最小限に絞る、クライアントで受けた JSON を安全に扱う（`Object.prototype` を汚染しない解析）ことが対策になる。

### 8.3 minify・バンドルされたコードを読む

- **source maps**（`Enable JavaScript source maps`、Authored/Deployed グルーピング、`Add source map` の手動ロード、Developer Resources の Status/Error 列）で bundle から著者コードへ復元する。
- source maps が無くても **Editor 左下の `{ }`（pretty print）** と **カンマ区切り式のステップ実行（Chrome 108+）** で minify コードを行単位で追える。
- `//# sourceURL=/path/to/source.file` により `eval()` 生成コードに名前が付くので、動的生成コードの出自を追える。

〔補足（一般知識）〕公開サイトが誤って source maps を配信したままにしていると、著者コードがほぼそのまま復元でき、内部構造や隠しエンドポイントが露出する。守る側は本番で source maps を公開しない（または認証をかける）ことを検討する。

### 8.4 ノイズの除去とアンチデバッグ対策

- **Ignore List**（`Enable Ignore Listing` / `Add content scripts to ignore list` / `Automatically add known third-party scripts to ignore list` / `Custom exclusion rules` の RegEx）で拡張・サードパーティのフレームを除外し、必要なときだけ **Show ignore-listed frames** で全スタックを見る。
- **Force script execution**（Resume 長押し）で全ブレークポイントを無視して再開。`debugger` 文を撒くアンチデバッグには、これと **Deactivate breakpoints**、該当スクリプトの Ignore List 追加が実務的対処。
- **Conditional breakpoint / logpoint** でループ内の大量停止を避け、実行を止めずに値の履歴だけを取る。

### 8.5 再現性・記録

- **Copy stack trace**（出力形式は `関数名 (ファイル:行)` の行連結）で PoC レポートに貼る呼び出し経路を取得する。
- **Snippets** に診断コード（リスナ列挙、prototype 汚染検査、sink の網掛けなど）を保存して任意ページ・シークレットモードで再利用する。〔補足〕原典は Snippets を bookmarklet の代替と位置付けるが、同期されず／ファイルシステム経由でアクセスできないと明記されているため、レポートの再現手順共有には向かない。コードは別途テキストで残すのが安全。
- **Changes ドロワータブ**で DevTools 上の変更差分を一箇所で確認する。
- **Disable JavaScript** で「JS 非依存で何が露出するか」を確認する。

---

## 手を動かす

以下は自分で立てた検証環境、または明示的に許可されたバグバウンティ対象で行うこと。

1. **Snippetを1つ作る**: Sources > More tabs > Snippets を開き、**New snippet**。名前を付けて次を貼り、**Run**（または `Control`/`Command`+`Enter`）で実行する。

   ```js
   console.log('Hello, Snippets!');
   document.body.innerHTML = '';
   const p = document.createElement('p');
   p.textContent = 'Hello, Snippets!';
   document.body.appendChild(p);
   ```

2. **リスナを列挙する**: Console で `getEventListeners(window)` を実行し、`message` や `hashchange` があるか見る。あれば `monitorEvents(window, "message")` で実際のイベントをログする。
3. **DOM書き換え元を特定する**: Elements で書き換わる要素を右クリック > **Break on** > **Subtree modifications**。ページを操作して停止したら Call Stack で書き込み元をたどる。
4. **通信直前で止める**: JavaScript Debugging ペインの **XHR/fetch Breakpoints** に `/api/` を追加。リクエスト送信時に `send()` 手前で止まるので、引数と Call Stack を確認する。
5. **レスポンスヘッダを上書きする**: Network で対象リクエストを右クリック > **Override headers** > フォルダを選び **Allow**。`Access-Control-Allow-Origin: *` を **Add header** で加え、**Refresh** して挙動の変化を観察する。
6. **配布コードを復元する**: Settings > Preferences > Sources で **Enable JavaScript source maps** をチェック。読み込み状況は More tools > **Developer Resources** の Status/Error 列で確認。読めない minify コードは Editor 左下の `{ }` で pretty print する。
7. **雑音を消す**: Settings > **Ignore List** で **Enable Ignore Listing** と **Automatically add known third-party scripts to ignore list** をチェック。停止が自分のコードだけになることを確認する。

## つまずきポイント

- **ライブ編集が反映されない**: DevTools は保存時にスクリプトを再実行しない。反映されるのは**関数の内部**の変更だけ。トップレベルの `console.log('A')` は保存しても実行されない。
- **編集がリロードで消える**: Editor のライブ編集は一時的。読み込みをまたいで残したいなら **Local Overrides** か **Workspace** を使う。
- **source-mapped ファイルを上書きしようとして失敗**: source maps されたファイルは Override できない。DevTools が元ソースへ案内するので、そちらを編集する。
- **source map が cross-origin で読めない**: 既定では DevTools がソースマップを要求し cross-origin 扱いになる。Developer Resources の **Enable loading through target** で回避する。
- **Snippetを共有しようとする**: Snippets は同期されず、ファイルシステムからもアクセスできない（原典明記。ただし保存先については原典内でも記述が食い違う）。共有用のコードは別途テキストで管理する。
- **`debug(fn)` / `queryObjects()` で ReferenceError**: 対象がその実行コンテキスト（スコープ）内にないと参照できない。停止中の適切なフレームや実行コンテキストを選んでから呼ぶ。
- **step の `F9` と `F10`/`F11`**: 原文はショートカット表と本文で `F9`（step）と `F10`/`F11`（step over/into）が混在する。自分の OS/バージョンで実キーを確認する。

## この節のまとめ

- Sources パネルの用途は「ファイル表示・CSS/JS 編集・Snippets・JS デバッグ・Workspace」の5つ。
- Page ペインは `top`（frame）→ origin → ディレクトリ/リソースの木構造で、ページがどのオリジンから何を読んでいるかの地図になる。
- Editor のライブ編集は保存時にスクリプトを再実行せず、関数内部の変更だけが反映され、リロードで消える。
- Snippets はページのコンテキストで実行できる保存済みスクリプトで bookmarklet の代替。ただし同期されずファイルシステムからアクセスできない。
- Local Overrides はレスポンスヘッダと本体（XHR/fetch 含む）をサーバに触らず差し替え、変更を読み込みをまたいで保持する。`.headers` とワイルドカード（`*`/`?`）で適用範囲を指定する。
- Local Overrides は `Access-Control-Allow-Origin: *` などヘッダ追加で CORS 等の成立条件をローカル検証でき、DOM 変更や Elements の変更は保存しないなどの制約がある。
- source maps は minify/bundle されたコードを著者コードとして表示し、ブレークポイント・ログ・エラーが自動でマップされる。Developer Resources で読み込み状況を確認し、手動ロードもできる。
- `//# sourceURL` は eval 生成コードに名前を付け、動的生成コードの出自追跡に使える。
- Ignore List（旧 blackbox）はデバッガが無視するスクリプトを管理し、Custom exclusion rules で RegEx 指定できる。
- Force script execution（Resume 長押し）と Deactivate breakpoints、Ignore List 追加が `debugger` 撒きなどアンチデバッグへの対処になる。
- Console Utilities API の `debug()` は関数内部で break、`monitor()` は呼び出しをログ、`monitorEvents()` はイベントをログ、`getEventListeners()` はリスナ列挙、`queryObjects()` はインスタンス列挙。
- DOM XSS は source（ユーザ制御入力）が sink（`eval()`・`.innerHTML` など）に到達して起きる。CSP Violation Breakpoints・DOM change breakpoint・Event Listener Breakpoint・`debug()`・`getEventListeners()` を組み合わせて経路を追う。
- XHR/fetch breakpoint は通信境界、Local Overrides は成立条件の検証、source maps はコード読解、Ignore List はノイズ除去という役割分担で使う。
- 攻撃的な検証は必ず防御（Trusted Types、サニタイズ、CSP、CORS 最小化、本番で source maps を公開しない）とセットで理解する。

## 理解度チェック

1. Editor で JavaScript を編集して保存しても反映されないコードがあるのはなぜか。
   ▶ 答え: DevTools は保存時にスクリプトを再実行しないため。反映されるのは関数の内部で行った変更だけで、トップレベルのコード（例: `console.log('A')`）は次に実行される機会がないため反映されない。

2. Local Overrides が Editor のライブ編集と決定的に違う点は何か。
   ▶ 答え: Local Overrides は変更をローカルファイルとして保存し、**ページ読み込みをまたいで保持する**。Editor のライブ編集はリロードで消える。

3. `.headers` ファイルで複数のリクエストに一括でヘッダを適用するには何を使うか。記号の意味も答えよ。
   ▶ 答え: ワイルドカード。複数文字は `*`、単一文字は `?` で指定する。

4. source maps を使うと Chrome が実際に実行するコードと Sources パネルに表示されるコードはどう異なるか。
   ▶ 答え: Chrome は実際には minify（縮小化）されたコードを実行するが、Sources パネルは著者が書いた元のコードを表示する。エラー・ログ・ブレークポイントは自動的にマップされる。

5. DOM XSS における source と sink をそれぞれ例を挙げて説明せよ。
   ▶ 答え: source はユーザが制御できる入力（ユーザ名、URL フラグメント由来の redirect URL など）。sink は `eval()` のような関数や `.innerHTML` のようなプロパティ setter で、任意 JS を実行できるもの。source のデータが sink に到達すると DOM XSS が起きる。

6. Console から関数 `getData` が呼ばれたときにその関数内部で自動的に break させるにはどうするか。
   ▶ 答え: Console で `debug(getData)` を実行する。解除は `undebug(getData)`。

7. `monitorEvents(window, "message")` は何をするか。脆弱性ハンティングでどう役立つか。
   ▶ 答え: window で `message` イベントが発生するたびに Event オブジェクトを Console にログする。`postMessage` 経由の source（ユーザ制御入力の入口）を洗い出すのに役立つ。

8. `debugger` 文を無限ループで撒くアンチデバッグに遭遇した。DevTools 側の対処を3つ挙げよ。
   ▶ 答え: Force script execution（Resume 長押しで全ブレークポイントを無視して再開）、Deactivate breakpoints（全ブレークポイント一括無視）、該当スクリプトを Ignore List に追加する。

9. 本番サイトが source maps を配信していない。それでも著者コードをデバッグするにはどうするか。
   ▶ 答え: 対応ツールで source maps を生成してローカルにホストし、Sources で deployed ファイルを右クリック > **Add source map** で URL を指定して手動ロードする。cross-origin で弾かれる場合は Developer Resources の **Enable loading through target** を使う。

10. Ignore List を有効にする「メインスイッチ」に相当する設定項目は何か。
    ▶ 答え: **Settings** > **Ignore List** の **Enable Ignore Listing**。これがすべての ignore-listing 機能のメインスイッチである。

## 出典

- https://developer.chrome.com/docs/devtools/sources
- https://developer.chrome.com/docs/devtools/shortcuts
- https://developer.chrome.com/docs/devtools/javascript/snippets
- https://developer.chrome.com/docs/devtools/overrides
- https://developer.chrome.com/docs/devtools/javascript/source-maps
- https://developer.chrome.com/docs/devtools/developer-resources
- https://developer.chrome.com/docs/devtools/settings/ignore-list
- https://developer.chrome.com/docs/devtools/javascript/disable
- https://developer.chrome.com/docs/devtools/settings/preferences
- https://developer.chrome.com/docs/devtools/console/utilities
- https://developer.chrome.com/docs/devtools/javascript/breakpoints
- https://web.dev/articles/trusted-types
- https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems

<!-- sources: https://developer.chrome.com/docs/devtools/sources, https://developer.chrome.com/docs/devtools/shortcuts, https://developer.chrome.com/docs/devtools/javascript/snippets, https://developer.chrome.com/docs/devtools/overrides, https://developer.chrome.com/docs/devtools/javascript/source-maps, https://developer.chrome.com/docs/devtools/developer-resources, https://developer.chrome.com/docs/devtools/settings/ignore-list, https://developer.chrome.com/docs/devtools/javascript/disable, https://developer.chrome.com/docs/devtools/settings/preferences, https://developer.chrome.com/docs/devtools/console/utilities, https://developer.chrome.com/docs/devtools/javascript/breakpoints, https://web.dev/articles/trusted-types -->
<!-- terms: Sourcesパネル, Snippets, Workspace, Local Overrides, source maps, sourceURL, sourceMappingURL, Ignore List, Force script execution, Deactivate breakpoints, Disable JavaScript, Developer Resources, debug(), monitor(), monitorEvents(), getEventListeners(), queryObjects(), inspect(), source, sink, DOM XSS, Trusted Types, CSP Violation Breakpoints, XHR/fetch breakpoint, DOM change breakpoint, pretty print, Changes ドロワータブ -->
<!-- self-read: https://developer.chrome.com/docs/devtools/shortcuts#sources | ライブHTMLがegress制限で自動取得できずキー割り当ての実機確認が必要 -->
<!-- self-read: https://developer.chrome.com/docs/devtools/overrides | ライブHTMLがegress制限で自動取得できず.headersファイル書式とワイルドカードのスクリーンショット確認が必要 -->
<!-- self-read: https://developer.chrome.com/docs/devtools/javascript/source-maps | ライブHTMLがegress制限で自動取得できずAdd source map等のUI確認が必要 -->
<!-- self-read: https://web.dev/articles/trusted-types | 外部一次資料が執筆環境から自動取得できずTrusted Types実装の詳細確認が必要 -->
