# Chrome DevTools のブレークポイントでコードを止めて追う

> **この節で分かること**
> - Chrome DevTools のブレークポイントには全8系統があることを説明でき、どの調査場面でどれを使うかを選べる
> - line-of-code / 条件付き / logpoint の3つを自分で設定・編集・削除できる
> - DOM 変更・XHR/fetch・イベントリスナ・例外・関数（`debug()`）・Trusted Type の各ブレークポイントを設定できる
> - 「危険な操作が起きた場所（sink）」から「値の出どころ（source）」へ逆向きにコードを辿る発想を身につける
> - DOM-based XSS を診断するとき、どのブレークポイントが最短経路になるかを判断できる

**元資料**: https://developer.chrome.com/docs/devtools/javascript/breakpoints （原典取得済み。公式ドキュメントのソース Markdown を逐語取得。ただし作業環境から developer.chrome.com へのアクセスは egress ポリシーでブロックされていたため、掲載スクリーンショット・デモ動画・冒頭 YouTube 動画は未確認）
**関連する節**: source と sink の考え方（DOM-based XSS の基礎）、Trusted Types による DOM XSS 対策

---

## 1. なぜブレークポイントを学ぶのか

### ブレークポイントとは

ブレークポイント（breakpoint）とは、JavaScript の実行を指定した地点で一時的に止める仕掛けのこと。止まった瞬間に、その時点の変数の値（Scope）や、どの関数を経由して今ここに来たか（Call Stack）を読める。たとえば、あるボタンを押した瞬間だけコードを凍結して中身を覗く、といった使い方ができる。

デバッグ用ではあるが、クライアントサイドの脆弱性ハンティングでは中心的な道具になる。攻撃者が制御できる値が、危険な処理へ流れ込む経路を実際に目で追えるからだ。

### なぜ「行単位」だけでは足りないのか（設計意図）

最もよく知られているのは line-of-code（行単位）ブレークポイントである。ソースコードの特定の行を指定して止める、いちばん素朴な方式だ。

しかし原典は、この方式が万能ではないとはっきり述べている。line-of-code ブレークポイントは、**正確にどこを見るべきか分かっていない場合**、あるいは**大規模なコードベースを扱っている場合**には、設定するのが非効率になりうる。膨大なコードのどこに値が流れ込むのか見当がつかないとき、当てずっぽうに行を選んでも当たらない。

そこで DevTools は、行番号を指定せずに「DOM が変わったら止める」「特定の URL を叩いたら止める」「例外が飛んだら止める」といった**イベントや条件で止める**ブレークポイントを用意している。他の種類の使い方と使い分けを知っておくことで、デバッグ時間を大きく節約できる、というのが原典の核心である。

### 脆弱性ハンティングにおける発想: sink から source へ

クライアントサイド脆弱性、とくに DOM-based XSS の調査では、**「値がどこから来たか（source）」ではなく「どこで危険な操作が起きたか（sink）」から逆向きに辿る**ことが多い。

- sink（シンク）とは、渡された文字列を実際に危険な形で使ってしまう場所のこと。たとえば `eval()` や `.innerHTML` への代入など、任意の JavaScript を実行しうる地点。
- source（ソース）とは、攻撃者が値を注入できる入口のこと。たとえば URL のフラグメント（`#` 以降）やユーザ名など。

行単位ブレークポイントは source を知っている前提で使いやすいが、実際の調査では sink 側の「症状」だけが見えていることが多い。イベント駆動のブレークポイントは、この sink や症状を起点にして、そこへ至った呼び出し元を Call Stack でさかのぼるための装置として働く。

---

## 2. ブレークポイント全種の概観

原典は、いつどのブレークポイントを使うかを一覧表で示している。まずこの全体像を頭に入れておくと、後の各節が位置づけやすい。

### 原典の「いつ使うか」対応表

| ブレークポイントの種類 | こう使いたいときに選ぶ |
| --- | --- |
| Line-of-code（行単位） | コードの正確な地点で止めたい |
| Conditional line-of-code（条件付き行単位） | コードの正確な地点で、ただし別の条件が真のときだけ止めたい |
| Logpoint | 実行を止めずに Console へメッセージを出したい |
| DOM | 特定の DOM ノードやその子を変更・削除するコードで止めたい |
| XHR | XHR の URL が指定文字列を含むときに止めたい |
| Event listener | `click` などのイベント発火後に走るコードで止めたい |
| Exception | caught / uncaught 例外を投げている行で止めたい |
| Function | 特定の関数が呼ばれるたびに止めたい |
| Trusted Type | Trusted Type 違反で止めたい |

Trusted Type 行のリンク先は、原典で W3C 仕様 `https://www.w3.org/TR/trusted-types/` が指定されている。

〔補足〕原典の概観表には「CSP violation」という独立行はない。UI 上の「CSP Violation Breakpoints」というセクションが Trusted Type 違反（Sink Violations / Policy Violations）を担当しているため、原典では Trusted Type 節がそれを兼ねている。

### 調査用途での早見表

この節全体をまとめた対応表を先に置く。各行の詳細は後続の小節で説明する。

| 種別 | 設定場所 | 設定操作 | 停止/動作タイミング | マーカー | 主な調査用途 |
| --- | --- | --- | --- | --- | --- |
| Line-of-code | Sources > 行番号カラム | クリック | その行の実行**前**に必ず停止 | 青いアイコン | sink 行の確定、Call Stack / Scope の読み取り |
| `debugger` 文 | コード内 | `debugger;` を書く | その行 | （なし） | PoC ページ、Overrides で注入 |
| Conditional line-of-code | Sources > 行番号カラム右クリック | Add conditional breakpoint → 条件入力 → Enter | 条件が真のときだけ | 疑問符付きオレンジ | ループ/共通関数でマーカー文字列だけに絞る |
| Logpoint | Sources > 行番号カラム右クリック | Add logpoint → メッセージ入力 → Enter | 停止せず Console に出力 | 2ドットのピンク | 高頻度 sink の全引数・スタック収集 |
| DOM: Subtree modifications | Elements > 要素右クリック > Break on | 選択 | 子の追加/削除/子の内容変更時 | DOM Breakpoints ペインに列挙 | DOM XSS の書き込み地点特定 |
| DOM: Attribute modifications | 同上 | 選択 | 選択ノードの属性追加/削除/値変更時 | 同上 | `href`/`src`/イベント属性注入の追跡 |
| DOM: Node removal | 同上 | 選択 | 選択ノードが削除された時 | 同上 | ノード差し替えで消える挙動の追跡 |
| XHR/fetch | Sources > XHR Breakpoints ペイン | Add breakpoint → 文字列 → Enter | URL に文字列が含まれるとき、`send()` の行 | ペイン内に列挙 | 不正 URL を組み立てる AJAX/Fetch の特定 |
| Event listener | Sources > Event Listener Breakpoints ペイン | カテゴリ or 個別イベントにチェック | 該当イベント発火後のリスナコード | チェックボックス | `message`、`hashchange`、`paste` 等の起点特定 |
| Exception (uncaught) | Sources > Breakpoints ペイン | Pause on uncaught exceptions | uncaught 例外を投げる行 | チェックボックス | 未処理エラー、enforced TT 違反 |
| Exception (caught) | 同上 | Pause on caught exceptions | caught 例外を投げる行 | チェックボックス | try/catch で握り潰された失敗の可視化 |
| Function | DevTools Console またはコード | `debug(fn)`（関数オブジェクトを渡す） | 関数の最初の行 | Breakpoints に反映 | 難読化コードでの関数捕捉 |
| Trusted Type: Sink Violations | Sources > Breakpoints > CSP Violation Breakpoints | チェック | sink 違反時 | チェックボックス | 生文字列が sink に渡る地点の機械的列挙 |
| Trusted Type: Policy Violations | 同上 | チェック | ポリシー違反時 | チェックボックス | ポリシー拒否地点の特定 |

> ### 📌 ここは自分で開いて読んでください
> **資料**: Pause your code with breakpoints（原典ページ） — https://developer.chrome.com/docs/devtools/javascript/breakpoints
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で developer.chrome.com のレンダリング済みページと画像・動画にアクセスできず、公式リポジトリのソース Markdown から本文を復元した）。以下の記述は原典ソース Markdown の逐語と目次にもとづく要約である。掲載されている 14 点前後のスクリーンショットと操作デモ動画2本、冒頭の YouTube 動画は内容を確認できていない。
> **読みどころ**:
> 1. Sources パネルのペイン構成（Breakpoints / XHR Breakpoints / DOM Breakpoints / Event Listener Breakpoints / CSP Violation Breakpoints が縦に並ぶ配置）を実物で確認する。これが全手順の前提。
> 2. 3種のマーカー（青=通常、疑問符付きオレンジ=条件付き、2ドットのピンク=logpoint、無効化時=半透明）の見分けを画像で確認する。
> 3. Breakpoints ペインの編集デモ動画で、グループ折りたたみやインラインでの種別切り替えの操作感をつかむ。
> **代替手段**: 原典は 2023-04-03 更新版。現行 Chrome の UI ラベルとの差分を確認するには自分の Chrome DevTools を直接開いて突き合わせるのが確実。

---

## 3. Line-of-code（行単位）ブレークポイント

### どう動くのか

調査したいコードの**正確な領域が分かっている**ときに使う。DevTools は**常に（always）この行のコードが実行される前に**一時停止する。「実行後」ではなく「実行前」で止まる点が重要で、その行が何をするかを、まだ起きていない状態で観察できる。

### 設定手順

原典の番号付き手順は次のとおり。

1. Sources タブをクリックする。
2. ブレークしたい行を含むファイルを開く。
3. その行へ移動する。
4. 行の左側が行番号カラムである。そこをクリックする。行番号カラムの上に**青いアイコン**が表示される。

原典の例は 29 行目に設定された line-of-code ブレークポイントを示している。

### 攻撃者はどこを突くのか / 調査での使い方

〔補足〕sink（`innerHTML` 代入、`eval`、`location` 代入、`postMessage` ハンドラ内など）の該当行が既に特定できている場合の最終確認に使う。停止後に Call Stack と Scope を読み、データの出自（source）を上流へ辿る。

### コード側に置くブレークポイント: `debugger` 文

コードから `debugger` を呼ぶと、その行で一時停止する。これは line-of-code ブレークポイントと**等価**であり、違いは**ブレークポイントが DevTools の UI ではなくコード内に設定される**点だけである。

```js
console.log('a');
console.log('b');
debugger;
console.log('c');
```

〔補足〕自分が用意した PoC ページやテスト用スクリプトの中に仕込む。難読化された対象コードを Overrides（DevTools のローカル上書き機能）で書き換えて `debugger` を挿し込むという使い方もできる。

---

## 4. 条件付き line-of-code ブレークポイント

### なぜ必要か

**ある条件が真のときだけ**実行を止めたい場合に使う。原典は、**自分のケースに無関係なブレークをスキップしたいとき、とくにループ内で**有用だと述べている。ループが 1000 回まわる中で 1 回だけ調べたいとき、通常のブレークポイントでは毎回止まってしまい実用にならない。

### 設定手順

1. Sources タブを開く。
2. ブレークしたい行を含むファイルを開く。
3. その行へ移動する。
4. 行の左側が行番号カラムである。そこを**右クリック**する。
5. Add conditional breakpoint を選ぶ。行の下にダイアログが表示される。
6. ダイアログに条件を入力する。
7. Enter を押してブレークポイントを有効化する。行番号カラムの上に**疑問符付きのオレンジ色のアイコン**が表示される。

原典の例は、ループ内で `x` が `10` を超えた反復 `i=6` のときにだけ発火した様子を示している。

### 調査での使い方

〔補足〕共通ユーティリティ（サニタイザ、URL ビルダ、メッセージディスパッチャ）に1つブレークポイントを置き、条件で自分のマーカー文字列だけに絞る。例:

```js
url.includes('MYMARKER')
```

```js
e.data && String(e.data).includes('xss')
```

条件式は副作用も持てるため、`(console.trace(), false)` のように「止めずにスタックだけ取る」使い方も可能である。ただし公式には、止めずに記録する用途は次の logpoint が正攻法である。

---

## 5. Logpoint（ログ用ブレークポイント）

### なぜ必要か

log line-of-code breakpoints（logpoints）は、**実行を止めずに**、かつ**コードを `console.log()` 呼び出しで散らかさずに**、Console にメッセージを出力するために使う。対象のソースを書き換えずに、その行を通過するたびに変数の中身をログできるのが利点だ。

### 設定手順

1. Sources タブを開く。
2. ブレークしたい行を含むファイルを開く。
3. その行へ移動する。
4. 行の左側の行番号カラムを**右クリック**する。
5. Add logpoint を選ぶ。行の下にダイアログが表示される。
6. ダイアログにログメッセージを入力する。`console.log(message)` 呼び出しと**同じ構文**を使える。たとえば次のように書ける。

```js
"A string " + num, str.length > 1, str.toUpperCase(), obj
```

この場合、出力されるメッセージは次のようになる。

```js
// str = "test"
// num = 3
// obj = {attr: "x"}
A string 42 true TEST {attr: 'x'}
```

7. Enter を押して有効化する。行番号カラムの上に**2つのドットを持つピンク色のアイコン**が表示される。

原典の例は 30 行目の logpoint が文字列と変数値を Console に出力する様子を示している。

### 調査での使い方

〔補足〕大量に呼ばれる sink（`innerHTML` setter、`eval` ラッパ、`postMessage` ハンドラ）で、止めずに全引数とスタックを収集する。`console.trace()` を logpoint 式に入れるとスタック付きで記録できる。ブラックボックス調査で「どの入力がどの sink に到達するか」を一括観測するのに向く。

---

## 6. 行単位ブレークポイントの編集

Breakpoints ペインを使って、line-of-code ブレークポイントを**無効化・編集・削除**する。設定したブレークポイントは一覧管理でき、まとめて操作できる。

### グループ編集

Breakpoints ペインはブレークポイントを**ファイル単位でグループ化**し、**行番号と列番号**の順に並べる。グループに対して次のことができる。

- グループを折りたたむ／展開するには、その**名前をクリック**する。
- グループまたは個々のブレークポイントを有効化／無効化するには、隣の**チェックボックス**をクリックする。
- グループを削除するには、その上にホバーして**閉じるアイコン**をクリックする。

原典の動画は、グループの折りたたみと、1つずつまたはグループ単位での有効化／無効化を示している。**ブレークポイントを無効化すると、Sources パネルは行番号の隣のマーカーを半透明にする。**

グループを右クリックするとコンテキストメニューが出る。原文の項目は次のとおり。

```text
Remove all breakpoints in file (group).
Disable all breakpoints in file.
Enable all breakpoints in file.
Remove all breakpoints (in all files).
Remove other breakpoints (in other groups).
```

### 個々のブレークポイントの編集

- 隣の**チェックボックス**で有効化／無効化する。無効化するとマーカーが半透明になる。
- ブレークポイントにホバーし、**編集アイコン**で編集、**閉じるアイコン**で削除する。
- 編集中は、**インラインエディタのドロップダウンリストから種類（type）を変更できる**。〔補足〕これは「通常のブレークポイント ↔ 条件付き ↔ logpoint」を後から切り替えられることを意味する。
- ブレークポイントを右クリックするとコンテキストメニューが出る。原文の項目は次のとおり。

```text
Remove breakpoint.
Edit condition or logpoint.
Reveal location.
Remove all breakpoints (in all files).
Remove other breakpoints (in other files).
```

原典の編集デモ動画では、無効化・削除・条件の編集・メニューからの位置表示（reveal location）・種類の変更が実演される。

---

## 7. DOM 変更ブレークポイント

### なぜ必要か（DOM XSS ハンティングの主力）

**DOM ノードまたはその子を変更するコードで停止したい**ときに使う。DOM-based XSS を追うときの主力になる。「ページ上に自分の注入文字列が現れているのに、どのコードがそこへ書き込んだのか分からない」という状況を、書き込みの瞬間で止めて解決できるからだ。

### 設定手順

1. Elements タブをクリックする。
2. ブレークポイントを設定したい要素へ移動する。
3. その要素を**右クリック**する。
4. Break on にホバーし、Subtree modifications、Attribute modifications、Node removal のいずれかを選ぶ。

設定した DOM 変更ブレークポイントの一覧は、Elements > DOM Breakpoints ペイン、および Sources > DOM Breakpoints サイドペインの両方で確認できる。そこではチェックボックスで有効化／無効化でき、右クリックから Remove（削除）や Reveal（DOM 内で位置を表示）ができる。

### 3種類の発火条件

| 種類（原文表記） | 発火条件 |
| --- | --- |
| Subtree modifications | 現在選択されているノードの**子が削除または追加されたとき**、あるいは**子の内容（contents）が変更されたとき**に発火する。**子ノードの属性変更では発火しない**。また**現在選択されているノード自身へのいかなる変更でも発火しない**。 |
| Attributes modifications | 現在選択されているノードに**属性が追加または削除されたとき**、あるいは**属性値が変わったとき**に発火する。 |
| Node Removal | 現在選択されているノードが**削除されたとき**に発火する。 |

原文ではコンテキストメニューのラベルが Attribute modifications、種類の解説見出しが Attributes modifications と表記が揺れている。どちらも同じものを指す。

### 攻撃者はどこを突くのか / 調査での使い方

〔補足〕
- 「ページのどこかに自分の注入文字列が現れるが、書き込んでいるコードが分からない」場合、**注入文字列が出現した要素の親**に Subtree modifications を設定してリロードすると、書き込みを行った sink の呼び出し行でスタック付きに停止する。
- 属性ベースの注入（`href`、`src`、`onerror`、`style` など）を追うときは Attribute modifications を対象要素に設定する。
- 重要な落とし穴として、**Subtree modifications は選択ノード自身の属性変更や自身の変更では発火しない**ため、「親に subtree、当該要素に attribute」の二段構えで張るのが確実。
- SPA（Single Page Application, ページ遷移なしで内容を書き換えるアプリ）でノードが差し替えられて消える現象の追跡には Node removal が有効。

---

## 8. XHR/fetch ブレークポイント

### なぜ必要か

**XHR のリクエスト URL が指定した文字列を含むときに**ブレークしたい場合に使う。XHR（XMLHttpRequest）とは、ページが裏側でサーバと通信する仕組みのこと。DevTools は **XHR が `send()` を呼ぶコード行**で一時停止する。

原典が挙げる典型例: **ページが誤った URL をリクエストしているのが分かり、その誤ったリクエストを引き起こしている AJAX または Fetch のソースコードを素早く見つけたい**とき。

### 設定手順

1. Sources タブをクリックする。
2. XHR Breakpoints ペインを展開する。
3. 追加アイコン（Add breakpoint）をクリックする。
4. ブレークしたい文字列を入力する。**DevTools は、この文字列が XHR のリクエスト URL のどこかに存在すると一時停止する**（＝**部分一致**）。
5. Enter を押して確定する。

原典の例は、URL に `org` を含む任意のリクエストに対してブレークポイントを作る方法を示している。パネル名は原文中で XHR Breakpoints と XHR/fetch Breakpoints の両方の表記が現れるが、同じペインを指す。

### 調査での使い方

〔補足〕SSRF 的なプロキシエンドポイント、オープンリダイレクト、API キーの漏えい経路などで「このパスを叩いているのは誰か」を特定する。空文字列に近い短い文字列（例: `/api/`）を入れると広く捕まる。URL 部分一致なので、クエリパラメータ名やホスト名の断片でも指定できる。

---

## 9. イベントリスナブレークポイント

### なぜ必要か

**イベント発火後に走るイベントリスナのコードで停止したい**ときに使う。イベントリスナとは、クリックやメッセージ受信などの出来事に応じて実行される関数のこと。`click` のような**特定のイベント**、またはマウスイベント全部のような**イベントのカテゴリ**を選べる。

### 設定手順

1. Sources タブをクリックする。
2. Event Listener Breakpoints ペインを展開する。DevTools は Animation などの**イベントカテゴリの一覧**を表示する。
3. そのカテゴリのいずれかのイベントで必ず止めたい場合はカテゴリにチェックを入れる。あるいは**カテゴリを展開して特定のイベントにチェック**を入れる。

原典の例は `deviceorientation` に対するブレークポイントを作る方法を示している。さらに Elements > Event Listeners ペインでリスナ一覧を確認できる。原典が明記しているのはカテゴリ例の Animation、特定イベント例の `deviceorientation`、概観表の例の `click`、そしてマウスイベント全体というカテゴリ概念である。

### 調査で有用なカテゴリ

〔補足〕原典はカテゴリの完全な一覧を載せていない。実際の DevTools には Animation、Canvas、Clipboard、Control、Device、DOM Mutation、Drag / drop、Geolocation、Keyboard、Load、Media、Mouse、Notification、Parse、Pick Element、Pointer、Script、Timer、Touch、Window、WebAudio、Worker、XHR といった系統が並ぶ。Chrome のバージョンで増減するため、**一覧は自分の Chrome で展開して確認する**のが正確。脆弱性ハンティングで特に有用なもの。

- **Window > message**: `postMessage` 受信ハンドラの特定。クロスオリジンメッセージ経由の DOM XSS 調査の入口。
- **Load > load / hashchange / popstate**: URL フラグメント起点の DOM XSS。
- **Clipboard > paste / copy**: クリップボード経由の注入、コピージャッキング調査。
- **Control > submit / change**: フォーム送信直前の値の加工箇所。
- **Timer**: 遅延実行で sink に到達するパターン。
- **Script > Script First Statement**: 難読化ローダの最初の一文で止める。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Event Listener Breakpoints のカテゴリ完全一覧（原典ページの当該節） — https://developer.chrome.com/docs/devtools/javascript/breakpoints#event-listeners
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で画像・実 UI を確認できず、加えて原典本文にカテゴリの完全一覧そのものが存在しない）。上記のカテゴリ列挙は一般知識にもとづく参考であり、正確なラベルは実機でしか確定できない。
> **読みどころ**:
> 1. Event Listener Breakpoints ペインを実際に全部展開し、カテゴリとイベント名を自分の Chrome で書き出す。
> 2. 特に `Window > message`、`Load > hashchange / popstate`、`Clipboard > paste`、`Script > Script First Statement` の有無と正確なラベルを確認する。
> **代替手段**: なし（実機確認が唯一の正解源）。

---

## 10. 例外ブレークポイント

### なぜ必要か

**caught（捕捉された）または uncaught（捕捉されない）例外を投げているコード行で停止したい**ときに使う。例外とは、コードの実行中に起きたエラーのこと。`try/catch` で受け止められたものが caught、受け止められず外まで漏れたものが uncaught である。**Node.js 以外のあらゆるデバッグセッションでは、この2種を独立に有効化できる。**

### Node.js の注意点

原典の Aside には次の注意がある。

> 現在、Node.js デバッグセッションでは、uncaught 例外でも停止する設定にしている場合にのみ caught 例外で停止できる。詳細は Chromium bug #1382762 を参照。

### 設定手順

Sources タブの Breakpoints ペインで、次のいずれか、または両方を有効にしてからコードを実行する。

- **Pause on uncaught exceptions** にチェック。実行が uncaught 例外で一時停止する。
- **Pause on caught exceptions** にチェック。実行が caught 例外で一時停止する。

### 調査での使い方

〔補足〕「try/catch で黙って握り潰されているエラー」を可視化する。sanitizer や JSON パーサが例外を投げて別経路にフォールバックしている箇所、Trusted Types の enforced モードで投げられる例外（後述のとおり enforced な TT 違反は例外を発生させる）を捕まえるのに使う。Pause on caught exceptions は巨大サイトではノイズが多いので、目的の操作の直前に有効化するのが実践的。

---

## 11. 関数ブレークポイント（`debug()`）

### なぜ必要か

**特定の関数が呼ばれるたびに停止したい**ときは、`debug(functionName)` を呼ぶ。`debug()` はコード内に挿入することもできるし、DevTools の Console から呼ぶこともできる。`debug()` は、**その関数の最初の行に line-of-code ブレークポイントを設定するのと等価**である。行番号が分からなくても関数名だけで張れるのが利点だ。

```js
function sum(a, b) {
  let result = a + b; // DevTools pauses on this line.
  return result;
}
debug(sum); // Pass the function object, not a string.
sum();
```

コメントが示す重要点: **文字列ではなく関数オブジェクトを渡す**こと（`debug('sum')` ではなく `debug(sum)`）。停止するのは関数本体の最初の行。

### 対象関数がスコープ内にあることを確認する

デバッグしたい関数が**スコープ内にない場合、DevTools は `ReferenceError` を投げる**。スコープとは、その名前が見えている有効範囲のこと。

```js
(function () {
  function hey() {
    console.log('hey');
  }
  function yo() {
    console.log('yo');
  }
  debug(yo); // This works.
  yo();
})();
debug(hey); // This doesn't work. hey() is out of scope.
```

Console から `debug()` を呼ぶとき、対象関数がスコープ内にあることを保証するのは厄介になりうる。原典の戦略は次のとおり。

1. その関数がスコープ内にある場所のどこかに line-of-code ブレークポイントを設定する。
2. そのブレークポイントを発火させる。
3. **line-of-code ブレークポイントで停止したままの状態で**、Console から `debug()` を呼ぶ。

### 調査での使い方

〔補足〕難読化されたバンドルで「関数名は分かるが定義箇所が分からない」場合に強力。`debug(window.eval)` のようにネイティブ／グローバル関数へ張って sink 呼び出しを一括で捕まえる用途にも使える。解除は `undebug(fn)`（この解除関数は原典には記載がない点に注意）。Console の `monitor(fn)` / `queryObjects()` などの Utilities API と組み合わせると、停止せずに呼び出しを観測できる。

---

## 12. Trusted Type ブレークポイント（UI 上は CSP Violation Breakpoints）

### 設計意図: Trusted Types と DOM XSS

Trusted Type API は、**クロスサイトスクリプティング（XSS）攻撃**として知られるセキュリティ上の悪用に対する保護を提供する。原典は DOM-based XSS を次のように定義している（source/sink の定義として重要）。

> DOM-based cross-site scripting は、ユーザが制御可能な source（ユーザ名や、URL フラグメントから取られたリダイレクト URL など）のデータが、`eval()` のような関数や `.innerHTML` のようなプロパティセッタ、すなわち任意の JavaScript コードを実行しうる sink に到達したときに発生する。

ここで例示された source は「username」「URL フラグメントから取ったリダイレクト URL」、sink は「`eval()`」「`.innerHTML`」である。Trusted Types は、`innerHTML` のような DOM sink に代入できるものを特定の型だけに限定させることで、この経路を体系的にふさぐ仕組みだ。

### 設定手順

Sources タブの Breakpoints ペインで、**CSP Violation Breakpoints** セクションへ行き、次のいずれか、または両方を有効にしてからコードを実行する。

| オプション（原文表記） | 内容 |
| --- | --- |
| Sink Violations | 実行が sink violation（sink 違反）で一時停止する。 |
| Policy Violations | 実行が policy violation（ポリシー違反）で一時停止する。Trusted Type ポリシーは `trustedTypes.createPolicy` を使ってセットアップされる。 |

API の詳細について原典が挙げる2本は次のとおり。

- セキュリティ目的を進めるには「Prevent DOM-based cross-site scripting vulnerabilities with Trusted Types」（https://web.dev/articles/trusted-types ）。
- デバッグについては「Implementing CSP and Trusted Types debugging in Chrome DevTools」（https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems ）。

### 攻撃者はどこを突くのか / 調査での使い方

〔補足〕Trusted Types を導入しているサイト（`require-trusted-types-for 'script'` を送っているサイト）では、**Sink Violations** を有効にすると「生文字列が sink に渡った瞬間」で必ず止まるので、**DOM XSS の候補地点を機械的に列挙できる**。report-only モードでも違反は報告されるため、**攻撃が成立しなくても「どの sink が生文字列を受け取っているか」を棚卸しできる**点が診断上重要。**Policy Violations** はポリシー関数（`createPolicy` の `createHTML` など）が拒否した／呼ばれた地点を捕まえる。

### 背景: CSP と Trusted Types（原典がリンクする補助資料より）

原典の Trusted Type 節がデバッグ用にリンクしているブログ（https://developer.chrome.com/blog/csp-issues/ ）から、逐語の事実だけを補う。

- CSP（Content Security Policy）は、ウェブサイト内の特定の振る舞いを制限してセキュリティを高める。たとえば**インラインスクリプトの禁止**や **`eval` の禁止**に使え、どちらも XSS の攻撃面を減らす。
- Trusted Types（TT）ポリシーは動的解析を可能にし、`innerHTML` のような DOM sink に代入できるものを特定の型だけに限定するよう、ウェブサイトが自身の JavaScript を取り締まるのを支援する。
- CSP を有効化する HTTP ヘッダ例（原文のまま）。

```text
content-security-policy: require-trusted-types-for 'script'; trusted-types default
```

- 各ポリシーは次のいずれかのモードで動作する。
  - **enforced mode** — あらゆるポリシー違反がエラーになる。
  - **report-only mode** — エラーメッセージを警告として報告するが、ウェブページの失敗は引き起こさない。
- 実験用のデモページ（URL そのまま）。開くときは原文の指示どおり Issues タブを開いた状態で開く。

```text
CSP issues:                           https://csp-issues.glitch.me/
Trusted Types violations:             https://tt-enforced.glitch.me/
Trusted Types violations (report only): https://tt-report-only.glitch.me/
```

- Break-on-violation の背景（逐語ベース）: 現時点で TT 違反をデバッグする素朴な方法は JS 例外にブレークポイントを設定することである。enforced な TT 違反は例外を発生させるため、この方法はある程度使える。しかし現実には、TT 違反だけで止めたい（他の例外では止めたくない）、report-only モードでも止めたい、異なる種類の TT 違反を区別したい、といった細かい制御が必要になる。これを実現するために CDP コマンド `setBreakOnTTViolation` が導入され、Blink 側の `InspectorDOMDebuggerAgent` が `onTTViolation()` という probe を提供して、TT 違反ごとに呼ばれる仕組みになっている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Implementing CSP and Trusted Types debugging in Chrome DevTools（原典がリンクするブログ） — https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems
> **なぜ**: developer.chrome.com のレンダリング済みページと、glitch のデモページの実挙動は本執筆環境から確認できなかった（理由: サイト側の egress 制限）。上記はソース Markdown の逐語にもとづく要約である。
> **読みどころ**:
> 1. `https://tt-enforced.glitch.me/` と `https://tt-report-only.glitch.me/` を Issues タブを開いた状態で開き、Sink Violations と Policy Violations を個別にオンにして停止位置の違いを確認する。これは DOM XSS 診断で最も実戦価値が高い。
> 2. enforced モードと report-only モードで、違反時の挙動（エラーか警告か）がどう変わるかを観察する。
> **代替手段**: Trusted Types の解説として MDN の Trusted Types API（https://developer.mozilla.org/docs/Web/API/Trusted_Types_API ）と web.dev の記事（https://web.dev/articles/trusted-types ）。

---

## 手を動かす

以下は、自分で立てた検証環境や、許可されたバグバウンティ対象での DOM XSS 調査を想定した基本演習である。

1. Chrome を開き、任意のページで F12（または右クリック > 検証）を押して DevTools を起動する。
2. Sources タブを開き、右側（または下部）に Breakpoints / XHR Breakpoints / DOM Breakpoints / Event Listener Breakpoints / CSP Violation Breakpoints のペインが縦に並ぶことを確認する。
3. 適当な JavaScript ファイルを開き、任意の行の行番号カラムをクリックして line-of-code ブレークポイントを張り、青いアイコンが出ることを確認する。ページを操作して、その行の実行「前」で止まることを確かめる。
4. 同じ行を右クリックして Add logpoint を選び、`console.trace()` を入力する。止めずに Console にスタックが出ることを確認する。
5. Elements タブで任意の要素を右クリックし、Break on > Subtree modifications を設定する。その要素の中身が JavaScript で書き換わる操作をして、書き込んだコードで停止し、Call Stack が読めることを確認する。
6. Sources > XHR Breakpoints で追加アイコンから `/api/` などの文字列を登録し、通信が走ったときに `send()` の行で止まることを確認する。
7. Sources > Event Listener Breakpoints を展開し、`Window > message` にチェックを入れる。`postMessage` を受けるページで、受信ハンドラの先頭に止まることを確認する。
8. Trusted Types を使うデモ（`https://tt-enforced.glitch.me/` など）を Issues タブを開いた状態で開き、CSP Violation Breakpoints の Sink Violations をオンにして、生文字列が sink に渡る地点で止まることを確認する。

## つまずきポイント

- line-of-code ブレークポイントは「実行後」ではなく「実行前」に止まる。止まった行の代入結果はまだ反映されていないので、値を見るには一歩進める（Step）必要がある。
- Subtree modifications は**選択ノード自身の属性変更や自身の変更では発火しない**。属性注入を追うなら Attribute modifications を、確実に捕まえたいなら「親に subtree、当該要素に attribute」の二段構えで張る。
- `debug()` には**文字列ではなく関数オブジェクト**を渡す。`debug('sum')` では動かない。対象がスコープ外だと `ReferenceError` になるので、先に line-of-code ブレークポイントで止めてから Console で `debug()` を呼ぶ。
- XHR/fetch ブレークポイントの文字列は**部分一致**。長すぎる文字列を入れると一致せず、短すぎると広く止まりすぎる。
- Pause on caught exceptions は巨大サイトでノイズが多い。目的の操作の直前だけ有効化する。
- Node.js デバッグでは caught 例外だけで止められない。uncaught も同時に有効化する必要がある（Chromium bug #1382762）。
- UI のラベルは版で揺れる／変わる。Attribute と Attributes、XHR Breakpoints と XHR/fetch Breakpoints のように原文でも表記揺れがある。原典は 2023-04-03 版なので、現行 Chrome との差分は自分で確認する。

## この節のまとめ

- Chrome DevTools のブレークポイントは line-of-code だけでなく全8系統（行単位／条件付き／logpoint／DOM／XHR／イベントリスナ／例外／関数／Trusted Type）がある。
- 行単位だけでは、どこを見ればよいか分からない大規模コードでは非効率。イベント・条件で止める種類を使い分けると調査が速くなる。
- 脆弱性ハンティングでは、sink（危険な操作地点）から source（値の出どころ）へ Call Stack を逆にたどる発想が中心。
- line-of-code ブレークポイントはその行の実行「前」に必ず止まる。`debugger` 文はコード内に置く等価物。
- 条件付きブレークポイントはループや共通関数で、マーカー文字列だけに絞って止めるのに使う。
- logpoint は実行を止めずに Console へログする。ピンクの2ドットマーカー。高頻度 sink の観測に向く。
- DOM 変更ブレークポイントは DOM XSS の書き込み地点特定の主力。Subtree / Attribute / Node removal の3種で発火条件が違う。
- XHR/fetch ブレークポイントは URL の部分一致で、`send()` の行で止まる。不正 URL を組み立てるコードの特定に使う。
- イベントリスナブレークポイントは `message`、`hashchange`、`paste` などイベント起点のハンドラを特定する。カテゴリ一覧は実機で確認する。
- 例外ブレークポイントは caught / uncaught を独立に有効化できる（Node.js を除く）。握り潰されたエラーや enforced TT 違反を可視化する。
- 関数ブレークポイントは `debug(fn)` で関数オブジェクトを渡す。関数の最初の行に張るのと等価。難読化コードで有効。
- Trusted Type ブレークポイント（CSP Violation Breakpoints）の Sink Violations は「生文字列が sink に渡る瞬間」を機械的に列挙でき、report-only でも報告されるため DOM XSS 診断で最も価値が高い。
- 掲載画像・動画・現行 UI ラベルは自分の Chrome と原典ページで確認する必要がある。

## 理解度チェック

1. line-of-code ブレークポイントは、指定行の実行「前」と「後」のどちらで止まるか。
   ▶ 答え: 常に実行「前」に止まる。原典は always その行が実行される前に一時停止すると述べている。

2. 大規模コードで「値がどこへ流れるか分からない」とき、行単位ブレークポイントが向かない理由は何か。
   ▶ 答え: どの行に張ればよいか事前に分からないため、設定が非効率になる。だから DOM 変更・XHR・イベントリスナなど、条件やイベントで止める種類を使い分ける。

3. logpoint と通常のブレークポイントの最大の違いは何か。
   ▶ 答え: logpoint は実行を止めず、コードを書き換えずに Console へメッセージを出力する。マーカーは2ドットのピンク色。

4. DOM の Subtree modifications が発火しないのはどんな変更か。
   ▶ 答え: 選択ノード自身へのいかなる変更、および子ノードの属性変更では発火しない。子の追加・削除・子の内容変更で発火する。

5. XHR/fetch ブレークポイントに登録した文字列は、URL とどう照合されるか。また実行はどの行で止まるか。
   ▶ 答え: URL への部分一致（どこかに含まれれば一致）。XHR が `send()` を呼ぶ行で止まる。

6. `debug()` に関数を渡すとき、`debug('sum')` と `debug(sum)` のどちらが正しいか。理由は。
   ▶ 答え: `debug(sum)` が正しい。文字列ではなく関数オブジェクトを渡す必要がある。対象がスコープ外だと `ReferenceError` になる。

7. Node.js のデバッグセッションで caught 例外だけを止めることはできるか。
   ▶ 答え: できない。uncaught 例外でも止める設定を同時に有効にしている場合にのみ caught で止められる（Chromium bug #1382762）。

8. DOM XSS の診断で Trusted Type の Sink Violations が診断上とくに有用なのはなぜか。
   ▶ 答え: 生文字列が sink に渡った瞬間に必ず止まるため、DOM XSS 候補地点を機械的に列挙できる。report-only モードでも違反が報告されるので、攻撃が成立しなくても「どの sink が生文字列を受け取っているか」を棚卸しできる。

9. `postMessage` 経由の DOM XSS を追うとき、どのイベントリスナブレークポイントが入口になるか。
   ▶ 答え: Window カテゴリの message イベント。クロスオリジンメッセージ受信ハンドラを特定できる。

## 出典

- Pause your code with breakpoints — https://developer.chrome.com/docs/devtools/javascript/breakpoints
- Implementing CSP and Trusted Types debugging in Chrome DevTools — https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems
- Trusted Types 仕様（W3C） — https://www.w3.org/TR/trusted-types/
- Trusted Types API（MDN） — https://developer.mozilla.org/docs/Web/API/Trusted_Types_API
- Prevent DOM-based cross-site scripting vulnerabilities with Trusted Types — https://web.dev/articles/trusted-types
- console.log()（MDN） — https://developer.mozilla.org/docs/Web/API/Console/log
- OWASP: XSS — https://owasp.org/www-community/attacks/xss/
- Chromium bug #1382762 — https://crbug.com/1382762

<!-- sources: https://developer.chrome.com/docs/devtools/javascript/breakpoints, https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems, https://www.w3.org/TR/trusted-types/, https://developer.mozilla.org/docs/Web/API/Trusted_Types_API, https://web.dev/articles/trusted-types, https://developer.mozilla.org/docs/Web/API/Console/log, https://owasp.org/www-community/attacks/xss/, https://crbug.com/1382762 -->
<!-- terms: ブレークポイント, line-of-code ブレークポイント, debugger文, 条件付きブレークポイント, logpoint, DOM変更ブレークポイント, Subtree modifications, Attribute modifications, Node removal, XHR/fetchブレークポイント, イベントリスナブレークポイント, 例外ブレークポイント, caught例外, uncaught例外, 関数ブレークポイント, debug(), Trusted Type, CSP Violation Breakpoints, Sink Violations, Policy Violations, source, sink, DOM-based XSS, Content Security Policy, Trusted Types, Call Stack, Scope -->
<!-- self-read: https://developer.chrome.com/docs/devtools/javascript/breakpoints | サイト側egress制限でレンダリング済みページ・画像・動画を自動取得できず、ソースMarkdownから復元した -->
<!-- self-read: https://developer.chrome.com/docs/devtools/javascript/breakpoints#event-listeners | Event Listener Breakpointsのカテゴリ完全一覧が原典本文に存在せず、正確なラベルは実機確認が必要 -->
<!-- self-read: https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems | サイト側egress制限でブログ本体とglitchデモの実挙動を確認できなかった -->
