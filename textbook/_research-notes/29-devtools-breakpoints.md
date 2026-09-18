# [29] Chrome DevTools: ブレークポイントでコードを一時停止する（Pause your code with breakpoints）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://developer.chrome.com/docs/devtools/javascript/breakpoints | full | raw.githubusercontent（公式ドキュメントのソースMarkdownを原典として取得） | WebFetchは `EGRESS_BLOCKED`（developer.chrome.com はネットワーク egress プロキシでブロック）。curl直接も `CONNECT tunnel failed, response 403`。そこで**同一ページの原典ソース**である公式リポジトリ GoogleChrome/developer.chrome.com の `site/en/docs/devtools/javascript/breakpoints/index.md`（HTTP 200 / 17,594 bytes）を取得し、**本文・手順・コード・表を逐語で全取得**した。レンダリング後のHTMLではなくソースMarkdownなので、テンプレート記法（`{% Img %}` 等）は画像・動画の挿入位置として本ノートに注記した。本文テキストの欠落はない。 |
| （補助）https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems | full | raw.githubusercontent（`site/en/blog/csp-issues/index.md`, HTTP 200 / 14,529 bytes） | 原典ページが Trusted Type ブレークポイント節から明示的にリンクしている参照先。Trusted Types / CSP 違反ブレークポイントの背景を補うために取得した（担当URL外の補助資料として明記）。 |

**原典メタデータ（frontmatterより逐語）**

| 項目 | 値 |
| --- | --- |
| title | `Pause your code with breakpoints` |
| authors | `kaycebasques`, `sofiayem` |
| date | `2017-02-03` |
| updated | `2023-04-03` |
| description | `Learn about all the ways you can pause your code in Chrome DevTools.` |
| tags | `javascript` |
| 埋め込み動画 | ページ冒頭に YouTube 動画 `{% YouTube id='JyHjoaUhAus' %}` |

## 要約（3〜10行）

- Chrome DevTools で JavaScript の実行を一時停止する手段は「行単位（line-of-code）」だけではなく、**条件付き行ブレークポイント / logpoint / DOM変更 / XHR・fetch / イベントリスナ / 例外（caught・uncaught）/ 関数（`debug()`）/ Trusted Type（CSP違反）** の全8系統が存在する。
- 原典の主張の核心は「line-of-code ブレークポイントは、**どこを見ればよいか分からない場合や大規模コードベースでは設定が非効率**であり、他の種類を知っていればデバッグ時間を節約できる」という点。
- クライアントサイド脆弱性ハンティングの文脈では、**「値がどこから来たか（source）」ではなく「どこで危険な操作が起きたか（sink）」から逆向きに辿る**ための装置としてこれらが機能する。DOM変更ブレークポイントは DOM-based XSS の書き込み地点特定、XHR/fetch ブレークポイントは不正URLを組み立てているコードの特定、イベントリスナブレークポイントはイベント起点のハンドラ特定、Trusted Type の Sink Violations は「sink へ生文字列が渡った瞬間」の特定に直結する。
- DevTools は line-of-code ブレークポイントでは**必ずその行が実行される前に**停止する。XHR/fetch では **XHR が `send()` を呼ぶ行**で停止する。`debug(fn)` は**関数の先頭行に line-of-code ブレークポイントを置くのと等価**。
- Trusted Type ブレークポイントは UI 上 **Sources > Breakpoints ペインの「CSP Violation Breakpoints」セクション**にあり、**Sink Violations** と **Policy Violations** の2つのチェックボックスから成る。
- 例外ブレークポイントは caught / uncaught を独立に有効化できるが、**Node.js デバッグセッションだけは例外**で、caught で止めるには uncaught も同時に有効にする必要がある（Chromium bug #1382762）。

---

## 詳細ノート

### 導入（出典: https://developer.chrome.com/docs/devtools/javascript/breakpoints ）

ブレークポイントを使って JavaScript コードを一時停止する。このガイドは DevTools で利用可能な**各種ブレークポイントの種類**と、**いつ使うか・どう設定するか**を説明する。デバッグ手順のハンズオンチュートリアルは [Get Started with Debugging JavaScript in Chrome DevTools]（リンク先 `/docs/devtools/javascript`）を参照。

### 各ブレークポイント種別をいつ使うかの概観（Overview of when to use each breakpoint type, アンカー `#overview`）

最もよく知られているのは line-of-code（行単位）ブレークポイントである。しかし line-of-code ブレークポイントは、**正確にどこを見るべきか分かっていない場合**、あるいは**大規模なコードベースを扱っている場合**には、設定するのが非効率になりうる。他の種類のブレークポイントの使い方と使い分けを知っておくことで、デバッグ時間を節約できる。

#### 原典の表（逐語・完全再現）

| Breakpoint Type | Use this when you want to ... |
| --- | --- |
| Line-of-code（アンカー `#loc`） | Pause on an exact region of code. |
| Conditional line-of-code（アンカー `#conditional-loc`） | Pause on an exact region of code, but only when some other condition is true. |
| Logpoint（アンカー `#log-loc`） | Log a message to the **Console** without pausing the execution. |
| DOM（アンカー `#dom`） | Pause on the code that changes or removes a specific DOM node, or its children. |
| XHR（アンカー `#xhr`） | Pause when an XHR URL contains a string pattern. |
| Event listener（アンカー `#event-listeners`） | Pause on the code that runs after an event, such as `click`, is fired. |
| Exception（アンカー `#exceptions`） | Pause on the line of code that is throwing a caught or uncaught exception. |
| Function（アンカー `#function`） | Pause whenever a specific function is called. |
| Trusted Type（アンカー `#trusted-type`） | Pause on [Trusted Type](https://www.w3.org/TR/trusted-types/) violations. |

（表中の「Trusted Type」行のリンク先は W3C 仕様 `https://www.w3.org/TR/trusted-types/` が逐語で指定されている。）

〔補足（一般知識）〕原典の概観表には「CSP violation」という独立行はない。UI 上の「CSP Violation Breakpoints」セクションが Trusted Type 違反（Sink Violations / Policy Violations）を担当しているため、原典では Trusted Type 節がそれを兼ねている。

---

### 1. Line-of-code ブレークポイント（アンカー `#loc`）

調査したいコードの**正確な領域が分かっている**ときに使う。DevTools は**常に（_always_）この行のコードが実行される前に**一時停止する。

DevTools で line-of-code ブレークポイントを設定する手順（原典の番号付き手順を逐語で）:

1. **Sources** タブをクリックする。
2. ブレークしたい行を含むファイルを開く。
3. その行へ移動する。
4. 行の左側が行番号カラムである。そこをクリックする。行番号カラムの上に**青いアイコン**が表示される。

（画像: `IcMBSM988092ZFocJ1LJ.png`, alt `A line-of-code breakpoint.`, 800x554）

この例は**29 行目**に設定された line-of-code ブレークポイントを示している。

**調査での使い方**〔補足（一般知識）〕: sink（`innerHTML` 代入、`eval`、`location` 代入、`postMessage` ハンドラ内など）の該当行が既に特定できている場合の最終確認に使う。停止後に Call Stack と Scope を読み、データの出自（source）を上流へ辿る。

#### 1-1. コード側に置く line-of-code ブレークポイント（`debugger`, アンカー `#debugger`）

コードから `debugger` を呼ぶと、その行で一時停止する。これは [line-of-code ブレークポイント] と**等価**であり、違いは**ブレークポイントが DevTools の UI ではなくコード内に設定される**点だけである。

##### コード（原文のまま逐語）

```js
console.log('a');
console.log('b');
debugger;
console.log('c');
```

**調査での使い方**〔補足（一般知識）〕: 自分が用意した PoC ページやテスト用スクリプトの中に仕込む。難読化された対象コードを Overrides で書き換えて `debugger` を挿し込むという使い方もできる。

---

### 2. 条件付き line-of-code ブレークポイント（Conditional line-of-code breakpoints, アンカー `#conditional-loc`）

**ある条件が真のときだけ**実行を止めたい場合に使う。こうしたブレークポイントは、**自分のケースに無関係なブレークをスキップしたいとき、とくにループ内で**有用である。

設定手順（逐語）:

1. **Sources** タブを開く。
2. ブレークしたい行を含むファイルを開く。
3. その行へ移動する。
4. 行の左側が行番号カラムである。そこを**右クリック**する。
5. **Add conditional breakpoint** を選ぶ。行の下にダイアログが表示される。
6. ダイアログに条件を入力する。
7. <kbd>Enter</kbd> を押してブレークポイントを有効化する。行番号カラムの上に**疑問符付きのオレンジ色のアイコン**が表示される。

（画像: `W2xfoXd2E6y9k4xYfSjX.png`, alt `A conditional line-of-code breakpoint.`, 800x807）

この例は、ループ内で `x` が `10` を超えた反復 `i=6` のときにだけ発火した条件付き line-of-code ブレークポイントを示している。

**調査での使い方**〔補足（一般知識）〕: 共通ユーティリティ（サニタイザ、URL ビルダ、メッセージディスパッチャ）に1つブレークポイントを置き、条件で自分のマーカー文字列だけに絞る。例: `url.includes('MYMARKER')`、`e.data && String(e.data).includes('xss')`。条件式は副作用も持てるため、`(console.trace(), false)` のように「止めずにスタックだけ取る」使い方も可能（ただし公式には logpoint が正攻法）。

---

### 3. ログ line-of-code ブレークポイント（Logpoint, アンカー `#log-loc`）

log line-of-code breakpoints（**logpoints**）は、**実行を止めずに**、かつ**コードを `console.log()` 呼び出しで散らかさずに**、**Console** にメッセージを出力するために使う。

設定手順（逐語）:

1. **Sources** タブを開く。
2. ブレークしたい行を含むファイルを開く。
3. その行へ移動する。
4. 行の左側が行番号カラムである。そこを**右クリック**する。
5. **Add logpoint** を選ぶ。行の下にダイアログが表示される。
6. ダイアログにログメッセージを入力する。[`console.log(message)`](https://developer.mozilla.org/docs/Web/API/Console/log) 呼び出しと**同じ構文**を使える。

   たとえば次のようにログできる:

##### コード（原文のまま逐語）

```js
"A string " + num, str.length > 1, str.toUpperCase(), obj
```

   この場合、出力されるメッセージは次のようになる:

```js
// str = "test"
// num = 3
// obj = {attr: "x"}
A string 42 true TEST {attr: 'x'}
```

7. <kbd>Enter</kbd> を押してブレークポイントを有効化する。行番号カラムの上に**2つのドットを持つピンク色のアイコン**が表示される。

（画像: `daHPau6iUXfqFJSZ61Lh.png`, alt `A logpoint that logs a string and a variable value to the Console.`, 800x548）

この例は **30 行目**の logpoint が、文字列と変数値を **Console** に出力する様子を示している。

**調査での使い方**〔補足（一般知識）〕: 大量に呼ばれる sink（`innerHTML` setter、`eval` ラッパ、`postMessage` ハンドラ）で、止めずに全引数とスタックを収集する。`console.trace()` を logpoint 式に入れるとスタック付きで記録できる。ブラックボックス調査で「どの入力がどの sink に到達するか」を一括観測するのに向く。

---

### 4. line-of-code ブレークポイントの編集（Edit line-of-code breakpoints, アンカー `#manage-loc`）

**Breakpoints** ペインを使って、line-of-code ブレークポイントを**無効化・編集・削除**する。

#### 4-1. ブレークポイントのグループ編集（Edit groups of breakpoints, アンカー `#manage-groups`）

**Breakpoints** ペインはブレークポイントを**ファイル単位でグループ化**し、**行番号と列番号**の順に並べる。グループに対して次のことができる:

- グループを折りたたむ／展開するには、その**名前をクリック**する。
- グループまたは個々のブレークポイントを有効化／無効化するには、グループまたはブレークポイントの隣の**チェックボックス**（アイコン `hmp8j3HiLMCcqPArD9yt.svg`, alt `Checkbox.`, 22x22）をクリックする。
- グループを削除するには、その上にホバーして**閉じるアイコン**（`gtAWQj5HMLjKYPqU9dBP.svg`, alt `Close.`, 24x24）をクリックする。

（動画: `UslK4pKSMUfuzuzE29gx.mp4`）この動画は、グループを折りたたむ方法と、ブレークポイントを1つずつまたはグループ単位で無効化／有効化する方法を示している。**ブレークポイントを無効化すると、Sources パネルは行番号の隣のマーカーを半透明にする。**

グループにはコンテキストメニューがある。**Breakpoints** ペインでグループを右クリックして選ぶ（画像: `BN1wTH94xG36ffQm33ue.png`, alt `The context menu of a group.`, 800x749）:

##### グループのコンテキストメニュー項目（原文のまま逐語）

- Remove all breakpoints in file (group).
- Disable all breakpoints in file.
- Enable all breakpoints in file.
- Remove all breakpoints (in all files).
- Remove other breakpoints (in other groups).

#### 4-2. ブレークポイントの編集（Edit breakpoints, アンカー `#edit-breakpoints`）

ブレークポイントを編集するには:

- ブレークポイントの隣の**チェックボックス**（`hmp8j3HiLMCcqPArD9yt.svg`, alt `Checkbox.`, 22x22）をクリックして有効化／無効化する。無効化すると **Sources** パネルは行番号隣のマーカーを半透明にする。
- ブレークポイントにホバーして、**編集アイコン**（`k3WKQOAItcJ2pliOyD47.svg`, alt `Edit.`, 24x24）で編集、**閉じるアイコン**（`gtAWQj5HMLjKYPqU9dBP.svg`, alt `Close.`, 24x24）で削除する。
- ブレークポイントを編集しているとき、**インラインエディタのドロップダウンリストから種類（type）を変更できる**（画像: `nokI9Jswa1DfxNd9cLoO.png`, alt `Changing the type of a breakpoint.`, 800x600）。
  - 〔補足（一般知識）〕これは「通常のブレークポイント ↔ 条件付き ↔ logpoint」を後から切り替えられることを意味する。
- ブレークポイントを右クリックしてコンテキストメニューを表示し、オプションを選ぶ（画像: `FCsRKMDAEccIPT3ecc0B.png`, alt `The context menu of a breakpoint.`, 800x749）:

##### ブレークポイントのコンテキストメニュー項目（原文のまま逐語）

- Remove breakpoint.
- Edit condition or logpoint.
- Reveal location.
- Remove all breakpoints (in all files).
- Remove other breakpoints (in other files).

動画（`lfy2SaF34u32cXyORfR7.mp4`）では、各種編集操作が実演される: **無効化・削除・条件の編集・メニューからの位置の表示（reveal location）・種類の変更**。

---

### 5. DOM 変更ブレークポイント（DOM change breakpoints, アンカー `#dom`）

**DOM ノードまたはその子を変更するコードで停止したい**ときに DOM 変更ブレークポイントを使う。

設定手順（逐語）:

1. **Elements** タブをクリックする。
2. ブレークポイントを設定したい要素へ移動する。
3. その要素を**右クリック**する。
4. **Break on** にホバーし、**Subtree modifications**、**Attribute modifications**、**Node removal** のいずれかを選ぶ。

（画像: `XsXVifCHA03yWaSJHeUR.png`, alt `The context menu for creating a DOM change breakpoint.`, 800x756）この例は DOM 変更ブレークポイントを作成するコンテキストメニューを示している。

DOM 変更ブレークポイントの一覧は次の場所で確認できる:

- **Elements** > **DOM Breakpoints** ペイン。
- **Sources** > **DOM Breakpoints** サイドペイン。

（画像: `ffaxCrSKWLf8ulyuYePH.png`, alt `Lists of DOM Breakpoints in the Elements and Sources panels.`, 800x582）

そこでは次のことができる:

- **チェックボックス**（`hmp8j3HiLMCcqPArD9yt.svg`）で有効化／無効化する。
- 右クリック > **Remove** または **Reveal**（DOM 内で位置を表示）。

#### 5-1. DOM 変更ブレークポイントの種類（Types of DOM change breakpoints, アンカー `#dom-types`）

**原典の定義を逐語ベースで正確に:**

| 種類（原文表記） | 発火条件（原文の意味を落とさず） |
| --- | --- |
| **Subtree modifications** | 現在選択されているノードの**子が削除または追加されたとき**、あるいは**子の内容（contents）が変更されたとき**に発火する。**子ノードの属性変更では発火しない**。また**現在選択されているノード自身へのいかなる変更でも発火しない**。 |
| **Attributes modifications** | 現在選択されているノードに**属性が追加または削除されたとき**、あるいは**属性値が変わったとき**に発火する。 |
| **Node Removal** | 現在選択されているノードが**削除されたとき**に発火する。 |

（注: コンテキストメニューのラベルは **Attribute modifications**、種類の解説見出しは **Attributes modifications** と原文で表記が揺れている。原文のまま両方記録する。）

**調査での使い方**（DOM-based XSS ハンティングの主力）〔補足（一般知識）〕:
- 「ページのどこかに自分の注入文字列が現れるが、書き込んでいるコードが分からない」場合、**注入文字列が出現した要素の親**に **Subtree modifications** を設定してリロードすると、書き込みを行った sink の呼び出し行でスタック付きに停止する。
- 属性ベースの注入（`href`、`src`、`onerror`、`style` など）を追うときは **Attribute modifications** を対象要素に設定する。
- 重要な落とし穴として、**Subtree modifications は選択ノード自身の属性変更や自身の変更では発火しない**ため、「親に subtree、当該要素に attribute」の二段構えで張るのが確実。
- SPA でノードが差し替えられて消える現象（デバッグ対象が消滅する）の追跡には **Node removal** が有効。

---

### 6. XHR/fetch ブレークポイント（XHR/fetch breakpoints, アンカー `#xhr`）

**XHR のリクエスト URL が指定した文字列を含むときに**ブレークしたい場合に使う。DevTools は **XHR が `send()` を呼ぶコード行**で一時停止する。

これが役に立つ一例: **ページが誤った URL をリクエストしているのが分かり、その誤ったリクエストを引き起こしている AJAX または Fetch のソースコードを素早く見つけたい**とき。

設定手順（逐語）:

1. **Sources** タブをクリックする。
2. **XHR Breakpoints** ペインを展開する。
3. **追加アイコン**（`YihNsXarRhDgEi9rOT4H.svg`, alt `Add.`, 24x24）**Add breakpoint** をクリックする。
4. ブレークしたい文字列を入力する。**DevTools は、この文字列が XHR のリクエスト URL のどこかに存在すると一時停止する**（＝**部分一致**）。
5. <kbd>Enter</kbd> を押して確定する。

（画像: `AAL4i6FKWOaIEdreyLjE.png`, alt `Creating an XHR/fetch breakpoint.`, 800x756）

この例は、**URL に `org` を含む任意のリクエスト**に対して **XHR/fetch Breakpoints** で XHR/fetch ブレークポイントを作る方法を示している。

（注: パネル名は原文中で **XHR Breakpoints** と **XHR/fetch Breakpoints** の両表記が現れる。どちらも同じペインを指す。原文どおり両方記録する。）

**調査での使い方**〔補足（一般知識）〕: SSRF 的なプロキシエンドポイント、オープンリダイレクト、API キーの漏えい経路などで「このパスを叩いているのは誰か」を特定する。空文字列に近い短い文字列（例: `/api/`）を入れると広く捕まる。URL 部分一致なのでクエリパラメータ名やホスト名の断片でも指定できる。

---

### 7. イベントリスナブレークポイント（Event listener breakpoints, アンカー `#event-listeners`）

**イベント発火後に走るイベントリスナのコードで停止したい**ときに使う。`click` のような**特定のイベント**、またはマウスイベント全部のような**イベントのカテゴリ**を選べる。

手順（逐語）:

1. **Sources** タブをクリックする。
2. **Event Listener Breakpoints** ペインを展開する。DevTools は **Animation** などの**イベントカテゴリの一覧**を表示する。
3. そのカテゴリのいずれかのイベントが発火したときに必ず停止させたい場合はカテゴリにチェックを入れる。あるいは**カテゴリを展開して特定のイベントにチェック**を入れる。

（画像: `aFFgOPi3outuMb32WO3k.png`, alt `Creating an event listener breakpoint.`, 800x726）

この例は **`deviceorientation`** に対するイベントリスナブレークポイントを作る方法を示している。

さらに、**Elements** > **Event Listeners** ペインでイベントリスナの一覧を確認できる。

**原典に明記されているカテゴリ・イベント名（逐語）**: カテゴリ例として **Animation**、特定イベント例として **`deviceorientation`**、および概観表の例として **`click`**、マウスイベント全体というカテゴリ概念。

〔補足（一般知識）〕原典はカテゴリの完全な一覧を載せていない。実際の DevTools には Animation、Canvas、Clipboard、Control、Device、DOM Mutation、Drag / drop、Geolocation、Keyboard、Load、Media、Mouse、Notification、Parse、Pick Element、Pointer、Script、Timer、Touch、Window、WebAudio、Worker、XHR といった系統のカテゴリが並ぶ（Chrome のバージョンにより増減するため、**教科書では「一覧は自分の Chrome で展開して確認する」と書くのが正確**）。脆弱性ハンティングでは特に次が有用:
- **Window > message**（`postMessage` 受信ハンドラの特定。クロスオリジンメッセージ経由の DOM XSS 調査の入口）
- **Load > load / hashchange / popstate**（URL フラグメント起点の DOM XSS）
- **Clipboard > paste / copy**（クリップボード経由の注入、コピージャッキング調査）
- **Control > submit / change**（フォーム送信直前の値の加工箇所）
- **Timer**（遅延実行で sink に到達するパターン）
- **Script > Script First Statement**（難読化ローダの最初の一文で止める）

---

### 8. 例外ブレークポイント（Exception breakpoints, アンカー `#exceptions`）

**caught（捕捉された）または uncaught（捕捉されない）例外を投げているコード行で停止したい**ときに使う。**[Node.js](https://nodejs.org/) 以外のあらゆるデバッグセッションでは、この2種の例外で独立に停止できる。**

#### 注意（原典の Aside 'gotchas' を逐語ベースで）

> 現在、**Node.js デバッグセッションでは、uncaught 例外でも停止する設定にしている場合にのみ caught 例外で停止できる**。詳細は [Chromium bug #1382762](https://crbug.com/1382762) を参照。

**Sources** タブの **Breakpoints** ペインで、次のオプションのいずれか、または両方を有効にしてからコードを実行する:

- **Pause on uncaught exceptions** にチェック（チェックボックス `hmp8j3HiLMCcqPArD9yt.svg`）。
  （画像: `gVGWABNL2GgZYl2BoMHb.png`, alt `Paused on an uncaught exception when the corresponding checkbox is enabled.`, 800x687）この例では、実行が **uncaught 例外**で一時停止している。
- **Pause on caught exceptions** にチェック（同チェックボックス）。
  （画像: `ruYVlG9CAdb86DmnRdsK.png`, alt `Paused on a caught exception when the corresponding checkbox is enabled.`, 800x687）この例では、実行が **caught 例外**で一時停止している。

**調査での使い方**〔補足（一般知識）〕: 「try/catch で黙って握り潰されているエラー」を可視化する。sanitizer や JSON パーサが例外を投げて別経路にフォールバックしている箇所、Trusted Types の enforced モードで投げられる例外（後述のとおり enforced な TT 違反は例外を発生させる）を捕まえるのに使う。**Pause on caught exceptions** は巨大サイトではノイズが多いので、目的の操作の直前に有効化するのが実践的。

---

### 9. 関数ブレークポイント（Function breakpoints, アンカー `#function`）

**特定の関数が呼ばれるたびに停止したい**ときは、`debug(functionName)` を呼ぶ（`functionName` はデバッグしたい関数）。`debug()` は（`console.log()` 文のように）**コード内に挿入**することもできるし、**DevTools の Console から呼ぶ**こともできる。`debug()` は、**その関数の最初の行に line-of-code ブレークポイントを設定するのと等価**である。

#### コード（原文のまま逐語）

```js
function sum(a, b) {
  let result = a + b; // DevTools pauses on this line.
  return result;
}
debug(sum); // Pass the function object, not a string.
sum();
```

（コメントが示す重要点: **文字列ではなく関数オブジェクトを渡す**こと。停止するのは関数本体の最初の行。）

#### 9-1. 対象関数がスコープ内にあることを確認する（Make sure the target function is in scope, アンカー `#scope`）

デバッグしたい関数が**スコープ内にない場合、DevTools は `ReferenceError` を投げる**。

##### コード（原文のまま逐語）

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

DevTools の Console から `debug()` を呼ぶ場合、対象関数がスコープ内にあることを保証するのは厄介になりうる。次の戦略がある（逐語）:

1. その関数がスコープ内にある場所のどこかに **line-of-code ブレークポイント**を設定する。
2. そのブレークポイントを発火させる。
3. **line-of-code ブレークポイントでコードが停止したままの状態で**、DevTools の Console から `debug()` を呼ぶ。

**調査での使い方**〔補足（一般知識）〕: 難読化されたバンドルで「関数名は分かるが定義箇所が分からない」場合に強力。`debug(window.eval)` のようにネイティブ／グローバル関数へ張って sink 呼び出しを一括で捕まえる用途にも使える（対応する解除は `undebug(fn)`。`undebug` は原典には記載がない点に注意）。Console の `monitor(fn)` / `queryObjects()` などの Utilities API と組み合わせると、停止せずに呼び出しを観測できる。

---

### 10. Trusted Type ブレークポイント（Trusted Type breakpoints, アンカー `#trusted-type`）／UI 上は「CSP Violation Breakpoints」

[Trusted Type API](https://developer.mozilla.org/docs/Web/API/Trusted_Types_API) は、**[クロスサイトスクリプティング](https://owasp.org/www-community/attacks/xss/)（XSS）攻撃**として知られるセキュリティ上の悪用に対する保護を提供する。

#### 原典の Aside 'key-term'（逐語ベース・重要定義）

> **DOM-based cross-site scripting** は、ユーザが制御可能な _source_（ユーザ名や、URL フラグメントから取られたリダイレクト URL など）のデータが、`eval()` のような関数や `.innerHTML` のようなプロパティセッタ、すなわち**任意の JavaScript コードを実行しうる _sink_** に到達したときに発生する。

（この定義は教科書の source/sink 章の一次引用として使える。原文の例示は「username」「redirect URL taken from the URL fragment」＝source、「`eval()`」「`.innerHTML`」＝sink。）

**設定手順（逐語）**: **Sources** タブの **Breakpoints** ペインで、**CSP Violation Breakpoints** セクションへ行き、次のオプションのいずれか、または両方を有効にしてからコードを実行する:

| オプション（原文表記） | 内容 | 画像 |
| --- | --- | --- |
| **Sink Violations** | この例では、実行が **sink violation**（sink 違反）で一時停止している。 | `0XBZkraxRXNBOP7W82K8.png`, alt `Paused on a sink violation when the corresponding checkbox is enabled.`, 800x687 |
| **Policy Violations** | この例では、実行が **policy violation**（ポリシー違反）で一時停止している。Trusted Type ポリシーは [`trustedTypes.createPolicy`](https://developer.mozilla.org/docs/Web/API/TrustedTypePolicyFactory/createPolicy) を使ってセットアップされる。 | `n4ml9mus6jP2pl11HNeA.png`, alt `Paused on a policy violation when the corresponding checkbox is enabled.`, 800x687 |

API の使用に関する詳細情報（原典が挙げる2本・逐語）:

- セキュリティ目的を進めるには [Prevent DOM-based cross-site scripting vulnerabilities with Trusted Types](https://web.dev/articles/trusted-types) を参照。
- デバッグについては [Implementing CSP and Trusted Types debugging in Chrome DevTools](/blog/csp-issues/#debugging-trusted-types-problems)（= `https://developer.chrome.com/blog/csp-issues/#debugging-trusted-types-problems`）を参照。

**調査での使い方**〔補足（一般知識）〕: Trusted Types を導入しているサイト（`require-trusted-types-for 'script'` を送っているサイト）では、**Sink Violations** を有効にすると「生文字列が sink に渡った瞬間」で必ず止まるので、**DOM XSS の候補地点を機械的に列挙できる**。report-only モードでも違反は報告されるため、**攻撃が成立しなくても「どの sink が生文字列を受け取っているか」を棚卸しできる**点が診断上重要。**Policy Violations** はポリシー関数（`createPolicy` の `createHTML` など）が拒否した／呼ばれた地点を捕まえる。

---

### 補助資料からの背景（出典: https://developer.chrome.com/blog/csp-issues/ ＝原典がリンクする参照先）

原典 Trusted Type 節がデバッグ用として明示リンクしているブログから、教科書に必要な**逐語の事実**のみ抜き出す。

- CSP（Content Security Policy）は、ウェブサイト内の特定の振る舞いを制限してセキュリティを高める。たとえば CSP は**インラインスクリプトの禁止**や **[`eval`](https://tc39.es/ecma262/#sec-eval-x) の禁止**に使え、どちらも **XSS の攻撃面を減らす**。
- Trusted Types（TT）ポリシーは**動的解析を可能にし、ウェブサイトに対する広範な種類のインジェクション攻撃を体系的に防止できる**。TT は、**`innerHTML` のような DOM sink に代入できるものを特定の型だけに限定するようウェブサイトが自身の JavaScript を取り締まる**のを支援する。
- ウェブサイトは特定の HTTP ヘッダを含めることで CSP を有効化できる。**ヘッダ例（原文のまま逐語）**:

#### コード/ヘッダ（原文のまま逐語）

```
content-security-policy: require-trusted-types-for 'script'; trusted-types default
```

- 各ポリシーは次のいずれかのモードで動作する（逐語）:
  - **enforced mode** — あらゆるポリシー違反がエラーになる。
  - **report-only mode** — エラーメッセージを警告として報告するが、ウェブページの失敗は引き起こさない。
- 実験用のデモページ（逐語・URL そのまま）:
  - CSP issues: `https://csp-issues.glitch.me/`
  - Trusted Types violations: `https://tt-enforced.glitch.me/`
  - Trusted Types violations - report only mode: `https://tt-report-only.glitch.me/`
  - （原文の指示: 「open the demo with the **Issues** tab open」＝ **Issues** タブを開いた状態でデモを開く）
- Break-on-violation（report-only モードでの）節より（逐語ベース）: 「現時点で **TT 違反をデバッグする唯一の方法は JS 例外にブレークポイントを設定すること**である。enforced な TT 違反は**例外を発生させる**ため、この機能はある程度は使える。しかし現実のシナリオでは TT 違反に対するより細かい制御が必要で、とくに **TT 違反だけで止めたい（他の例外では止めたくない）**、**report-only モードでも止めたい**、**異なる種類の TT 違反を区別したい**」。
  - 実装面の記述: 新しい CDP コマンド `setBreakOnTTViolation` を導入し、バックエンド（Blink）の `InspectorDOMDebuggerAgent` が `onTTViolation()` という probe を提供して、TT 違反が起きるたびに呼ばれる。`InspectorDOMDebuggerAgent` がその違反がブレークポイントを発火させるべきか判定し、該当すればフロントエンドに実行停止のメッセージを送る。
  - CSP 違反関連の CDP 型として `ContentSecurityPolicyViolationType`、`contentSecurityPolicyViolationType` フィールドが登場する。バックエンド側のフック地点は [`ContentSecurityPolicy::ReportViolation`](https://source.chromium.org/chromium/chromium/src/+/master:third_party/blink/renderer/core/frame/csp/content_security_policy.cc;l=1128;drc=c7101018b828047f762bab9f0f129cdd53e03180)（report-only モード用のボトルネックを流用）。
  - ページ上の CSP issues は [CSP 違反専用のタブ](/blog/new-in-devtools-89/#csp) でも発見できる。

（この補助資料は担当URLの参照先であり、**担当URL本体の内容ではない**ことを明記する。）

---

## 原典末尾の参照リンク（逐語・完全再現）

```
[1]: /docs/devtools/javascript
[2]: #loc
[3]: #conditional-loc
[4]: #dom
[5]: #xhr
[6]: #event-listeners
[7]: #exceptions
[8]: #function
[9]: #loc
[10]: https://developer.mozilla.org/docs/Web/API/Fetch_API
[11]: #loc
[12]: #loc
```

（注: `[2]`〜`[8]`, `[10]` は本文からの参照が現状の版では使われていない、または表内のリンクに置き換えられている。`[10]` の MDN Fetch API リンクは XHR/fetch 節に対応する参照として定義されている。）

---

## ブレークポイント全種の早見表（本ノートのまとめ）

| 種別 | 設定場所 | 設定操作 | 停止/動作タイミング | マーカー | 主な調査用途 |
| --- | --- | --- | --- | --- | --- |
| Line-of-code | Sources > 行番号カラム | クリック | その行の実行**前**に必ず停止 | 青いアイコン | sink 行の確定、Call Stack / Scope の読み取り |
| `debugger` 文 | コード内 | `debugger;` を書く | その行 | （なし） | PoC ページ、Overrides で注入 |
| Conditional line-of-code | Sources > 行番号カラム右クリック | **Add conditional breakpoint** → 条件入力 → Enter | 条件が真のときだけ | 疑問符付きオレンジ | ループ/共通関数でマーカー文字列だけに絞る |
| Logpoint | Sources > 行番号カラム右クリック | **Add logpoint** → メッセージ入力 → Enter | 停止せず Console に出力 | 2ドットのピンク | 高頻度 sink の全引数・スタック収集 |
| DOM: Subtree modifications | Elements > 要素右クリック > **Break on** | 選択 | 子の追加/削除/子の内容変更時（子の属性変更・自ノード変更では発火せず） | DOM Breakpoints ペインに列挙 | DOM XSS の書き込み地点特定 |
| DOM: Attribute modifications | 同上 | 選択 | 選択ノードの属性追加/削除/値変更時 | 同上 | `href`/`src`/イベント属性注入の追跡 |
| DOM: Node removal | 同上 | 選択 | 選択ノードが削除された時 | 同上 | ノード差し替えで消える挙動の追跡 |
| XHR/fetch | Sources > **XHR Breakpoints** ペイン | **Add breakpoint** → 文字列 → Enter | URL に文字列が**どこかに含まれる**とき、XHR が `send()` を呼ぶ行 | ペイン内に列挙 | 不正 URL を組み立てる AJAX/Fetch の特定 |
| Event listener | Sources > **Event Listener Breakpoints** ペイン | カテゴリ or 個別イベントにチェック | 該当イベント発火後のリスナコード | チェックボックス | `message`、`hashchange`、`paste` 等の起点特定 |
| Exception (uncaught) | Sources > **Breakpoints** ペイン | **Pause on uncaught exceptions** | uncaught 例外を投げる行 | チェックボックス | 未処理エラー、enforced TT 違反 |
| Exception (caught) | 同上 | **Pause on caught exceptions** | caught 例外を投げる行 | チェックボックス | try/catch で握り潰された失敗の可視化 |
| Function | DevTools Console またはコード | `debug(fn)`（関数オブジェクトを渡す） | 関数の最初の行（line-of-code と等価） | （Breakpoints に反映） | 難読化コードでの関数捕捉 |
| Trusted Type: Sink Violations | Sources > **Breakpoints** > **CSP Violation Breakpoints** | チェック | sink 違反時 | チェックボックス | 生文字列が sink に渡る地点の機械的列挙 |
| Trusted Type: Policy Violations | 同上 | チェック | ポリシー違反時（`trustedTypes.createPolicy` で設定されたポリシー） | チェックボックス | ポリシー拒否地点の特定 |

---

## 読者が自分で開くべき資料

本担当URL自体は**原典ソースMarkdownの全文取得に成功（full）**しており、本文の欠落はない。ただし以下は**取得できなかった／本ノートに再現できなかった要素**であり、読者自身がブラウザで開く価値がある。

### なぜ一部を自分で開く必要があるか

- **developer.chrome.com はこの作業環境のネットワーク egress ポリシーでブロックされていた**（WebFetch: `EGRESS_BLOCKED`、curl: `CONNECT tunnel failed, response 403`）。そのため**レンダリング済みページそのもの**は閲覧できず、公式リポジトリのソースMarkdownから本文を復元した。
- 結果として、**スクリーンショット画像（14点前後）と操作デモ動画2本、冒頭の YouTube 動画**は内容を確認できていない。DevTools の UI 位置・アイコン形状・実際のペイン配置は画像でしか伝わらない。
- ページは `updated: 2023-04-03` 版である。**その後 Chrome に追加されたブレークポイント種別やUI変更は反映されていない可能性がある**。
- **Event Listener Breakpoints のカテゴリ完全一覧が原文に存在しない**（例示は `Animation` と `deviceorientation`、`click` のみ）。

### 読みどころ（読者が開いたときに必ず見るべき項目）

1. **Sources パネル右側（または下部）のペイン構成を実物で確認する**: `Breakpoints` / `XHR Breakpoints`（=XHR/fetch Breakpoints）/ `DOM Breakpoints` / `Event Listener Breakpoints` / `CSP Violation Breakpoints` が縦に並ぶ配置と、各ペインの展開方法。これが本ノートの全手順の前提。
2. **`Event Listener Breakpoints` を実際に全部展開し、カテゴリとイベント名の一覧を自分の Chrome で書き出す**。特に `Window > message`、`Load > hashchange / popstate`、`Clipboard > paste`、`Script > Script First Statement` の有無と正確なラベルを確認する（原文に一覧がないため、ここは実機確認が唯一の正解源）。
3. **3種のマーカーの見分け**: line-of-code=青、conditional=疑問符付きオレンジ、logpoint=2ドットのピンク、無効化時=半透明。スクリーンショット `IcMBSM988092ZFocJ1LJ.png` / `W2xfoXd2E6y9k4xYfSjX.png` / `daHPau6iUXfqFJSZ61Lh.png` に対応。
4. **`Breakpoints` ペインの編集動画2本（`UslK4pKSMUfuzuzE29gx.mp4`, `lfy2SaF34u32cXyORfR7.mp4`）**: グループ折りたたみ、グループ単位の有効化/無効化、インラインエディタでの**ブレークポイント種別の切り替え**（通常↔条件付き↔logpoint）の操作感。テキストでは伝わらない部分。
5. **DOM 変更ブレークポイントのコンテキストメニュー（`Break on` サブメニュー）の実物**: `Subtree modifications` / `Attribute modifications` / `Node removal` の並びと、`Elements > DOM Breakpoints` および `Sources > DOM Breakpoints` の両方に同じ一覧が出ること。
6. **Trusted Type / CSP Violation Breakpoints の実挙動**: 原典がリンクするデモ `https://tt-enforced.glitch.me/` と `https://tt-report-only.glitch.me/` を **Issues タブを開いた状態で**開き、`Sink Violations` と `Policy Violations` を個別にオンにして停止位置の違いを確認する。これは DOM XSS 診断で最も実戦価値が高い。
7. **ページ冒頭の YouTube 動画 `https://www.youtube.com/watch?v=JyHjoaUhAus`**: 全ブレークポイント種別の概観デモ。
8. **最新版ページとの差分**: 本ノートは 2023-04-03 版に基づく。現行 Chrome では UI ラベルや種別が変わっている可能性があるため、`https://developer.chrome.com/docs/devtools/javascript/breakpoints` を直接開いて差分を確認すること。

### 併読が推奨される原典内リンク

| リンク先（逐語） | 内容 |
| --- | --- |
| `/docs/devtools/javascript` | Get Started with Debugging JavaScript in Chrome DevTools（デバッグ手順のハンズオン） |
| `https://www.w3.org/TR/trusted-types/` | Trusted Types W3C 仕様 |
| `https://developer.mozilla.org/docs/Web/API/Trusted_Types_API` | MDN: Trusted Types API |
| `https://developer.mozilla.org/docs/Web/API/TrustedTypePolicyFactory/createPolicy` | MDN: `trustedTypes.createPolicy` |
| `https://web.dev/articles/trusted-types` | Prevent DOM-based cross-site scripting vulnerabilities with Trusted Types |
| `/blog/csp-issues/#debugging-trusted-types-problems` | Implementing CSP and Trusted Types debugging in Chrome DevTools |
| `https://owasp.org/www-community/attacks/xss/` | OWASP: XSS |
| `https://developer.mozilla.org/docs/Web/API/Console/log` | MDN: `console.log()`（logpoint の構文の根拠） |
| `https://developer.mozilla.org/docs/Web/API/Fetch_API` | MDN: Fetch API |
| `https://crbug.com/1382762` | Node.js で caught 例外のみの停止ができない既知バグ |
| `https://nodejs.org/` | Node.js |

---

## 教科書執筆時の注意（このノートの信頼範囲）

- 本ノートの**手順・ラベル・コード・例外条件はすべて原典ソースMarkdownからの逐語または直訳**であり、捏造はない。
- 〔補足（一般知識）〕を付けた箇所は**原典に記述がない**。とくに「Event Listener Breakpoints のカテゴリ一覧」「`undebug(fn)`」「`monitor(fn)` / `queryObjects()`」「二段構えの DOM ブレークポイント設置」は原典外の一般知識であり、教科書に載せる場合は実機確認の上で「原典外」と分かる書き方をすること。
- 画像・動画の内容は未確認（環境がドメインをブロック）。UI のスクリーンショット断定記述は避けること。
- すべての記述は**許可された検証・バグバウンティを前提とした防御／診断目的の技術解説**として扱う。
