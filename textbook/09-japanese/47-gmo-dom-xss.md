# DOM based XSS の検出方法を理解する（ソースとシンクをたどる）

> **この節で分かること**
> - DOM based XSS が反射型・蓄積型 XSS と何が違うのか、なぜ「サーバのレスポンスを見ても検出できない」のかを説明できる。
> - 「ソース（source）」と「シンク（sink）」という中核概念を使って、脆弱なデータの流れを言葉で説明できる。
> - Burp Suite でレスポンス raw を確認し、検査文字列を注入して DOM based XSS を手動で検出する手順を自分でたどれる。
> - Chrome DevTools（Elements / Sources パネル、ブレークポイント）で、生成後の DOM を見ながらソースからシンクへの流れを追える。
> - `textContent` への置換・DOMPurify・Trusted Types という「三段の梯子」で、どう守るかを実装レベルで説明できる。
> - 代表的なソース／シンクの一覧を参照して、コードのどこが危険かを見分けられる。

**元資料**: https://developers.gmo.jp/technology/15402/ （原典は取得できず二次情報ベース。ただし対策パートは OWASP / DOMPurify / W3C の一次資料を逐語取得済み）
**関連する節**: 反射型・蓄積型 XSS の節、Same-Origin Policy と CSP の節、Burp Suite の使い方の節

---

## 1. この節の元になった記事について

### 1-1. どんな記事か

この節は、GMO インターネットグループの技術ブログ「GMO Developers」に掲載された記事**「DOM based XSS の検出方法を理解する」**（記事 ID 15402）を土台にしている。書いたのはグループのセキュリティエンジニアで、二次情報によれば 2018 年に入社し、SOC（Security Operation Center, セキュリティ監視チーム）の新規立ち上げと、Web アプリケーションの脆弱性診断の内製化を担当した人物とされる。SOC とは、企業のシステムへの攻撃を監視・分析する専門チームのこと。

記事の狙いは、脆弱性診断の実務経験を踏まえて、**DOM based XSS が自動診断ツールで見落とされやすい理由と、診断員が手動で検出する具体的な手順**を、実際のツール操作とともに解説することにある。「まずはこういう攻撃手法があると認識すること」が第一歩、という平易なメッセージで締めくくられている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: GMO Developers「DOM based XSS の検出方法を理解する」（記事 ID 15402） — https://developers.gmo.jp/technology/15402/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 組織のネットワーク egress ポリシーにより `developers.gmo.jp` への接続が 403 で拒否された。Wayback Machine 経由の取得も同じ理由で不可）。以下の記述は検索結果の引用断片にもとづく要約であり、逐語の本文・コード・スクリーンショットは未確認である。
> **読みどころ**:
> 1. **スクリーンショットの対比**: Burp Suite のレスポンス raw 画面と、ブラウザで `alert` が発火した画面を並べ、「レスポンスに文字列が無いのにポップアップが出る」ことを視覚的に示していると推測される。ここが記事の核心図。
> 2. **題材にしたラボ**: PortSwigger Web Security Academy のどのラボ（`location.search`→`innerHTML` か `document.write` か等）を使っているか、ソース／シンクの正確な組み合わせと URL。
> 3. **検査文字列の正確な形**: `"><svg onload=alert(1)>` 以外に挙げているペイロードがあるか、Burp の検索でヒットしない様子。
> 4. **DevTools の具体操作**: Elements パネルだけか、Sources パネル／ブレークポイントにも踏み込んでいるか。
> 5. **対策セクションの原文**: `textContent` 置換・サニタイズがどう書かれているか。
> **代替手段**: Wayback Machine のスナップショット（`https://web.archive.org/web/2022/https://developers.gmo.jp/technology/15402/` など、推定公開年は 2022 年）、はてなブックマークのコメント欄、同一著者の姉妹記事（後述）。

### 1-2. 同じシリーズの姉妹記事

同ブログには姉妹記事「**画面を見ながら理解する蓄積型クロスサイトスクリプティングの脆弱性とは**」（記事 ID 27567）があり、XSS を種類別に解説する一連のシリーズの一部と位置づけられる。記述スタイル（スクリーンショット主導の説明、検査文字列の見せ方）が同一なので、担当記事の構成を推し量る手がかりになる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: GMO Developers「画面を見ながら理解する蓄積型クロスサイトスクリプティングの脆弱性とは」（記事 ID 27567） — https://developers.gmo.jp/technology/27567/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 同じドメインの egress ブロック）。以下の記述は二次情報にもとづく。
> **読みどころ**:
> 1. 蓄積型 XSS と DOM based XSS を同じシリーズの文体で読み比べ、XSS 三分類の全体像を日本語の同一出典でそろえる。
> 2. スクリーンショット主導の説明の型を、担当記事（15402）の構成推定に使う。
> **代替手段**: なし（同一シリーズの日本語資料としては本記事が最も近い）。

---

## 2. XSS の三分類 — DOM based XSS は何が違うのか

### 2-1. まず XSS とは

XSS（クロスサイトスクリプティング, Cross-Site Scripting）とは、攻撃者が用意した JavaScript を、被害者のブラウザ上で「そのサイトの正規のスクリプト」として実行させてしまう脆弱性のこと。たとえば掲示板に悪意あるスクリプトを書き込み、それを他の利用者が開いたときに勝手に実行される、といった被害が起きる。

XSS は一般に三つに分類される。DOM based XSS を理解する近道は、まず他の二つとの違いを押さえることである。

### 2-2. 三分類の対応表

| 種類 | 発生の起点 | ペイロードがサーバのレスポンスに含まれるか | 主因 |
|---|---|---|---|
| 反射型（Reflected） | リクエスト中のスクリプトがレスポンスにそのまま出力される | 含まれる（レスポンス内で確認可能） | サーバ側コードの出力処理の不備 |
| 蓄積型（Stored） | 保存されたスクリプトが別ユーザーの閲覧時に発火 | 含まれる（保存され再出力される） | サーバ側コードの出力処理の不備 |
| **DOM based** | **ブラウザ上の JavaScript が DOM を操作する過程で発火** | **含まれない（サーバを経由せず発火しうる）** | **フロントエンド（JavaScript）の処理の不備** |

ここで DOM（Document Object Model, 文書オブジェクトモデル）とは、ブラウザが HTML を読み込んで作る「ページの内部構造をプログラムから触れる形にしたもの」のこと。JavaScript は DOM を書き換えることで、ページの見た目や中身を動的に変える。

### 2-3. DOM based XSS の設計上の特徴

DOM based XSS は、**JavaScript から動的に HTML を操作するアプリケーション**で起きる。正規のスクリプトの動きを悪用して、不正なスクリプトを実行させる。反射型・蓄積型との決定的な違いは次の点である。

- 攻撃者の不正スクリプトは、**サーバを経由せず、被害者のブラウザ上で直接実行される**。原因は JavaScript の不適切な処理にある。
- そのため**通信が必ずしもサーバに到達するとは限らない**。典型的には URL のフラグメント（`#` 以降 = `location.hash`）はサーバに送信されないため、サーバ側でいくらサニタイズしても防げない。

〔補足〕URL フラグメント（`#...`）は HTTP リクエストのパスやクエリとしてサーバに送られない。したがって「サーバ側のログにも WAF にも痕跡が残らないのに、クライアントで JavaScript が発火する」という DOM based XSS 特有の状況が生じる。これが「サーバのレスポンスを見ても検出できない」現象の技術的な裏付けである。WAF（Web Application Firewall）とは、Web への通信を監視して攻撃らしいパターンを遮断する防御装置のこと。

> ### 📌 ここは自分で開いて読んでください
> **資料**: gihyo.jp 連載「JavaScript セキュリティ」DOM-based XSS 回 — https://gihyo.jp/dev/serial/01/javascript-security/0006 （および `/0007`, `/0008`）
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `gihyo.jp` の egress ブロック）。以下の記述はノートの二次情報にもとづく。
> **読みどころ**:
> 1. 日本語で source / sink を体系的に説明した早期の資料。訳語（「入力元／出力先」「発生源／到達点」など）の揺れを整理する参照基準になる。
> 2. 「DOM-based XSS はサーバ側対策では防げない」ことの日本語での論証。本節 §2・§4 の裏取りに使える。
> 3. `location.hash` を使った脆弱コード例とその修正例（日本語コメント付き）。
> **代替手段**: IPA「安全なウェブサイトの作り方」（https://www.ipa.go.jp/security/vuln/websecurity.html ）の XSS 章。日本語の公的資料で DOM-based XSS にも言及がある。JVN iPedia の DOM XSS 事例も日本語。

---

## 3. 核心概念: ソース（source）とシンク（sink）

### 3-1. なぜこの二語が中核なのか

DOM based XSS を追うときは、「攻撃者が値を入れられる入口」と「その値が危険な形で使われる出口」を分けて考えると、ほぼ機械的に脆弱性を探せる。この入口を**ソース**、出口を**シンク**と呼ぶ。GMO 記事の中核概念であり、PortSwigger（Web セキュリティの学習で広く使われる資料）が定義した用語である。

### 3-2. ソースとシンクの定義

- **ソース（source）**: DOM based XSS を引き起こす原因となる文字列の入力元。攻撃者が制御可能な箇所。代表例は `location.hash`。
- **シンク（sink）**: ソースの文字列から JavaScript／HTML を生成・実行してしまう箇所。代表例は `innerHTML`、`document.write`、`eval`。
- **攻撃が成立する条件**: 「ソース → シンク」というデータの流れ（経路）が存在すること。

PortSwigger による原文の定義（逐語, 英語）は次のとおりである。

```text
A source is a JavaScript property that accepts data that is potentially attacker-controlled. An example of a source is the location.search property because it reads input from the query string... This includes the referring URL (exposed by the document.referrer string), the user's cookies (exposed by the document.cookie string), and web messages.
```

```text
A sink is a potentially dangerous JavaScript function or DOM object that can cause undesirable effects if attacker-controlled data is passed to it. For example, the eval() function is a sink because it processes the argument that is passed to it as JavaScript. An example of an HTML sink is document.body.innerHTML because it potentially allows an attacker to inject malicious HTML and execute arbitrary JavaScript.
```

### 3-3. シンクの性質の違い

同じ「危険なシンク」でも、何ができてしまうかは異なる。GMO 記事が整理していると考えられる代表例は次のとおり。

| シンク | 何ができてしまうか |
|---|---|
| `innerHTML` | タグの挿入が可能（任意の HTML を組み立てられる） |
| `eval` | コードの直接実行（渡された文字列を JavaScript として評価） |
| `document.write` | HTML 構造の変更が可能 |

この違いは検出でも重要になる。`innerHTML` のような **HTML シンク**には `"><svg onload=alert(1)>` のようにタグを組み立てるペイロードが効き、`eval` のような **JavaScript 実行シンク**には `alert(1)//` のようにコードとして評価される形のペイロードを組む必要がある（詳しくは §6）。

### 3-4. 代表的なソースとシンク（概観）

完全な一覧は §10 の逐語チートシートにあるが、まず概観をつかむと次のとおり。

- **代表的なソース**: `document.URL`, `document.documentURI`, `document.baseURI`, `location`（`location.search` = クエリ文字列, `location.hash` = フラグメント）, `document.cookie`, `document.referrer`（遷移元 URL）, `window.name`, `history.pushState`/`replaceState`, `localStorage`, `sessionStorage`, `IndexedDB`。
- **代表的な HTML シンク**: `document.write()`, `document.writeln()`, `element.innerHTML`, `element.outerHTML`, `element.insertAdjacentHTML`, `element.onevent`。
- **JavaScript インジェクション系シンク**: `eval()`, `Function()`, `setTimeout()`, `setInterval()`, `setImmediate()`, `execCommand()`, `execScript()`, `range.createContextualFragment()` 等。
- **jQuery のシンク**: `.html()`, `.append()`, `.after()`, `.before()`, `.prepend()`, `.replaceWith()`, `.wrap()`, `$.parseHTML()` 等（`$("#id").html(text)` は `innerHTML` と同様に任意 HTML を生成する）。

---

## 4. なぜ DOM based XSS はツールで検出しにくいのか

これが GMO 記事の中核メッセージである。二次情報で一貫して確認できた要点は次の四つ。

### 4-1. レスポンス raw にペイロードが出ない

検査文字列 `"><svg onload=alert(1)>` をソースに注入し、ブラウザ上で JavaScript のポップアップ（`alert`）が実際に表示されても、**サーバレスポンスの raw データには該当文字列が出力されていない**。ペイロードがサーバを往復せず、クライアント側 JavaScript が DOM を組み立てる過程で初めて具現化するためである。ここで「raw データ」とは、サーバから返ってきた加工前の生の HTTP レスポンス本文のこと。

### 4-2. 従来型スキャナが効かない

多くの自動診断ツールは、「特定のペイロードを送信し、それが**サーバのレスポンスに反射しているか**を観測する」方式で XSS を判定する。DOM based XSS ではレスポンスに現れないため、この方式では検出できない。

### 4-3. WAF・ブラウザ XSS フィルタでも防ぎにくい

ペイロードがリクエスト／レスポンスの本文に現れない（またはフラグメントとしてサーバに届かない）ため、シグネチャベースの WAF や、かつてのブラウザ XSS フィルタでもブロックが難しい。

### 4-4. 結論 — 手動検証が必要

DOM based XSS は「ツールでは検出しにくく、WAF・XSS フィルタでもブロックしにくい厄介な脆弱性」であり、**手動での検証が必要**になる。まずは「こういう攻撃手法が存在する」と認識することが第一歩、というのが記事の締めくくりである。

〔補足〕サーバサイド静的解析（SAST, Static Application Security Testing）や IAST の多くはサーバ言語のコードや HTTP リクエストに焦点を当て、ブラウザで実行される JavaScript を追跡しないため DOM based XSS を見落としやすい。検出には、ブラウザ内で「ソースからシンクへ実際にデータがどう流れるか（テイントフロー, taint flow = 汚染された値の追跡）」を追う必要がある。

この「ツールでは検出しにくい／WAF でもブロックしにくい」という主張は、独立した一次資料（OWASP）とも一致する。OWASP は「レスポンス中の JavaScript 全体を走査して汚染出力を推定するのは現実的でない」と明記しており、HTTP レスポンス側のインターセプタやフィルタは DOM based XSS に無効だとしている（§9 で詳述）。

---

## 5. 検出手順(1): ローカルプロキシ（Burp Suite）でレスポンス raw を確認する

### 5-1. ローカルプロキシとは

ローカルプロキシとは、自分のブラウザとサーバの間に立ち、通信をすべて覗いたり書き換えたりできる中継ソフトのこと。代表格が **Burp Suite**。診断ではこれを使って、リクエストとレスポンスの中身を 1 バイト単位で確認する。

### 5-2. GMO 記事が示す一連の流れ

原典由来と考えられる手順は次のとおり。

1. **Burp Suite でレスポンス raw データを確認**し、コンテンツがどのように出力されているかを把握する。
2. **トリガーパターンの特定**: JavaScript コード中の `innerHTML`（および `document.write` など）といった、DOM based XSS を引き起こしうるシンクの記述を探す。
3. **検査文字列の注入**: ソースに相当する箇所（URL のクエリ・ハッシュ等）へ、検査用の XSS コードを挿入する。
4. **検証**: ブラウザ上で `alert(1)` が発火すれば脆弱性あり。ただしこのとき**レスポンス raw データには該当文字列が出力されていない**ことを併せて確認する。これが「ツールで検出できない」ことの実証になる。

### 5-3. 検査に用いる文字列（逐語）

原文由来と考えられる検査ペイロードは次のとおり。

```html
"><svg onload=alert(1)>
```

〔補足〕`"><svg onload=alert(1)>` は「まず属性値や既存タグを `">` で閉じ、続けて `<svg>` 要素を挿入し、その `onload` イベントハンドラで `alert(1)` を実行する」という、HTML シンク（`innerHTML` 等）向けの定番検査ペイロード。`<img src=x onerror=alert(1)>` も同様の目的で使われる。診断では `alert(1)` の代わりに `alert(document.domain)` を使い、どのオリジンで発火したかを可視化することも多い。オリジン（origin）とは「スキーム＋ホスト＋ポート」の組で、ブラウザが「どこのサイトか」を区別する単位のこと。

> ### 📌 ここは自分で開いて読んでください
> **資料**: PortSwigger Web Security Academy「DOM-based XSS」 — https://portswigger.net/web-security/cross-site-scripting/dom-based
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `portswigger.net` の egress ブロック）。以下の記述はノートの要約と、逐語取得できた別資料の定義にもとづく。
> **読みどころ**:
> 1. **source / sink の定義の原典**。GMO 記事の中核概念はここに由来し、§3 の英語定義はこのページのものである。
> 2. **「Testing HTML sinks」「Testing source → sink」の手順**: ランダム文字列（例 `abc123`）をソースに入れ、DevTools の Elements パネルで出現箇所と文脈（タグ内／属性値内／`<script>` 内）を特定する型。
> 3. **ラボ（演習）一覧**: 「DOM XSS using web messages」「DOM XSS in jQuery `$()` selector sink using a hashchange event」「DOM XSS using `document.write` with `location.search`」等。無料アカウントで実行できる。
> 4. **sink ごとのペイロード組み立て**: HTML sink（`innerHTML`）と JS 実行 sink（`eval`）でペイロードの形が変わる理由。
> 5. **DOM Invader のドキュメント**（https://portswigger.net/burp/documentation/desktop/tools/dom-invader ）: canary 注入で source→sink を自動追跡する仕組み。
> **代替手段**: OWASP DOM based XSS Prevention Cheat Sheet（§8・§9 で逐語引用済み）、MDN の `Element.innerHTML`「Security considerations」節（https://developer.mozilla.org ）。

---

## 6. 検出手順(2): ブラウザ開発者ツールで生成後の DOM を見る

### 6-1. なぜ「View source」では駄目なのか

DOM based XSS は JavaScript による DOM 変更の結果として現れる。そのため、ブラウザの「**View source（ページのソースを表示）**」では検出できない。View source は JavaScript による変更を反映せず、サーバから来た元の HTML を表示するだけだからである。

代わりに **Chrome DevTools の Elements パネルで「実際に生成された DOM」を確認**し、注入した検査文字列がどこに、どんな形で反映されたかを見る。DevTools（開発者ツール）とは、ブラウザに標準搭載された、ページの内部を調べるツール群のこと。多くのブラウザで `F12` キーで開く。

### 6-2. 手動検査フローの型（PortSwigger 手法に準拠）

〔補足〕以下は一般知識による実務的な手動検査フローで、記事本文に同じ手順があるかは未確認だが、記事の手順を追体験するのに有用である。

1. **HTML シンクのテスト**: ソース（例 `location.search`）にランダムな英数字列（例 `abc123`）を入れてページを読み込み、**Elements パネル**でその文字列が DOM のどこに出現するかを検索する。出現箇所の文脈（タグの内側か、属性値か、`<script>` 内か）に応じて、タグを閉じるための `<>` や `"` を含む適切なペイロードに差し替える。
2. **Sources パネルでのソース検索**: `Ctrl+Shift+F`（全ファイル横断検索）で、ページの JavaScript 全体から `location`, `document.referrer`, `innerHTML`, `document.write`, `eval` などのソース／シンク参照を検索する。
3. **ブレークポイントによるテイント追跡**: `innerHTML` / `document.write()` / `eval()` を呼ぶ行に**ブレークポイント**（実行をそこで一時停止させる印）を設定し、URL パラメータやハッシュを変えて再読み込みする。ブレークが当たったらコールスタック（関数の呼び出し履歴）を検査し、シンクに渡される値（＝ソースから来た文字列）を確認する。
4. **DOM 変更ブレークポイント**: Elements パネルで対象要素を右クリック →「**Break on › subtree modifications**（サブツリーの変更で停止）」を選ぶと、その要素の子が書き換わるたびに実行が止まり、書き換えた JavaScript まで遡れる。
5. JavaScript 実行シンク（`eval`, `setTimeout(string)` 等）の場合は、ソース文字列が「HTML」ではなく「JavaScript コード」として評価されるため、`alert(1)//` のようにコンテキストに合わせてペイロードを組み立てる。

### 6-3. 検査の流れを図で

```text
[攻撃者制御の入口: ソース]         [危険な出口: シンク]
 location.hash / location.search ─┐
 document.referrer                ├─▶ innerHTML / document.write / eval ─▶ 発火
 window.name / postMessage ───────┘        （DOM 上で HTML/JS が生成・実行される）

 ※この経路（ソース→シンク）が JavaScript 内に存在すると DOM based XSS。
 ※サーバのレスポンス raw には痕跡が出ないことがある（特に location.hash 経由）。
```

---

## 7. 検出の高度化: DOM Invader と自動化

〔補足〕以下は一般知識による補足で、GMO 記事がこれらに言及しているかは未確認である。ただし手動検査を補助する実務ツールとして広く使われる。

### 7-1. DOM Invader

**DOM Invader** は Burp Suite に内蔵された、DOM XSS 検出を支援する機能である。要点は次のとおり。

- Burp 内蔵の Chromium ブラウザに組み込まれ、JavaScript のソースとシンクを自動的に計装（instrument = 監視用のフックを仕込むこと）して、DOM XSS などクライアント側脆弱性の検出を支援する。
- **カナリア（canary）** と呼ぶ一意な文字列（既定値 `burpdomxss`、任意文字列に変更可。Burp 2024.12 でランダム化／カスタム設定が追加）をソースに注入し、どのシンクに到達したかを追跡する。カナリアとは「目印として仕込む固有の文字列」のこと。
- DevTools 内の「**Augmented DOM**」タブで、カナリアを含むソース／シンクをツリー表示で確認できる。
- `postMessage()` によるウェブメッセージのログ・編集・再送も可能で、web message 経由の DOM XSS も試験できる。

### 7-2. 静的解析による自動検出

OWASP は "Detect DOM XSS using variant analysis" として、次の脆弱コードに対する **Semgrep ルール**（https://semgrep.dev/s/we30 ）を紹介している。Semgrep とは、コードのパターンを検索して脆弱な書き方を機械的に見つける静的解析ツールのこと。

```html
<script>
  var x = location.hash.split("#")[1];
  document.write(x);
</script>
```

このコードは、ソース `location.hash` の値をそのままシンク `document.write` に渡している典型的な DOM based XSS である。〔補足〕他に `eval` を計装する DevTools 拡張（Eval Villain 等）もある。ただし DOM based XSS は文脈依存が強く、最終判断は手動検証が前提になる。

---

## 8. どう守るか — 三段の梯子

守り方は「まず sink を変える → どうしても HTML が必要なら安全に作る → 組織全体で新規の脆弱性を止める」の三段で考えると、GMO 記事の「まず認識すること」というメッセージから実装レベルまで一本につながる。

```text
(1) sink を変える         element.textContent = 入力;         ← 最優先・最も簡単
        ↓ HTML をどうしても動的描画したい場合
(2) 安全に HTML を作る      DOMPurify.sanitize(入力)           ← 実績あるサニタイザ
        ↓ 組織全体で新規の DOM XSS を根絶したい場合
(3) 型で sink を封じる       Trusted Types（CSP で強制）        ← クラスごと消滅させる
```

### 8-1. 第一段: 危険なシンクを避ける

GMO 記事由来と考えられる方針は次のとおり。

- シンクの特性を理解し、**危険なシンクに未検証のユーザー入力を渡さない**。
- **`innerHTML` の代わりに `textContent`（または `innerText`）を使う**。ユーザー入力を文字列としてのみ表示し、HTML／スクリプトとして解釈させない。
- コンテキストに応じたエンコード／エスケープを行い、フレームワークの自動エスケープを無効化しない。

OWASP の RULE #6 も「最も基本的な安全策は `textContent` への代入」とし、`element.textContent = untrustedData;` はコードを実行しないと述べている。RULE #7 の修正例（逐語）は次のとおり。

```html
<b>Current URL:</b> <span id="contentholder"></span>
<script>
  document.getElementById("contentholder").textContent = document.baseURI;
</script>
```

OWASP が挙げる「Safe Sinks（安全な出力先）」のリストは、`innerHTML` からのリファクタ先としてそのまま使える。

```js
elem.textContent = dangerVariable;
elem.insertAdjacentText(dangerVariable);
elem.className = dangerVariable;
elem.setAttribute(safeName, dangerVariable);
formfield.value = dangerVariable;
document.createTextNode(dangerVariable);
document.createElement(dangerVariable);
elem.innerHTML = DOMPurify.sanitize(dangerVar);
```

- **`eval()` / `Function()` / `setTimeout(文字列)` / `setInterval(文字列)` にユーザー入力を渡さない**。
- React 等の SPA（Single Page Application）では `dangerouslySetInnerHTML`（Vue の `v-html`、Angular の `bypassSecurityTrustHtml`）が新たな DOM based XSS の入口になりうる。フレームワークのエスケープを迂回する API の使用箇所を重点的に監査する。

### 8-2. 第二段: DOMPurify で安全に HTML を作る

どうしても HTML を動的描画したい場合は、実績あるサニタイザ（許可タグのみ残す設定）を通す。**DOMPurify** は OWASP が HTML サニタイズ用に名指しで推奨するライブラリで、汚れた HTML 文字列を受け取り、危険な要素・属性を除去した文字列を返す。ブラウザ内蔵のパーサを使うため高速である。

最小の使い方は次のとおり。

```js
const clean = DOMPurify.sanitize(dirty);
// プロファイル指定（HTML のみ許可）
const clean = DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true } });
```

README が挙げる無害化の実例は、どういう入力がどう削られるかの対応表になっている。

| 入力 | サニタイズ後 |
|---|---|
| `<img src=x onerror=alert(1)//>` | `<img src="x">` |
| `<svg><g/onload=alert(2)//<p>` | `<svg><g></g></svg>` |
| `<p>abc<iframe//src=jAva&Tab;script:alert(3)>def</p>` | `<p>abc</p>` |

DOMPurify を使うときの落とし穴（README が明記）は次のとおり。

- **サニタイズ後に文字列を加工すると防御が無効化される**（OWASP も同じ警告をしている）。サニタイズは「最後の工程」でなければならない。
- サニタイズ結果を別ライブラリに渡す場合、そのライブラリが文字列を変形（mutate）しないか確認する。
- **定期的なアップデートが必須**。ブラウザの挙動変更に伴いバイパスが継続的に発見されている。
- **入力側のドキュメントコンテキストを混ぜない**。DOM API で組んだノードや XML/XHTML としてパースしたノードは、HTML パーサでは作れない形の木を作れるため、文字列サニタイザには見えないが再パース時に脱出しうる（DOMPurify 3.4.14 以降はこの経路も硬化されている）。

### 8-3. 第三段: Trusted Types で sink を型で封じる

**Trusted Types** は、DOM XSS の sink（`innerHTML`, `outerHTML`, `document.write`, `script.src` 等）が**素の文字列を受け付けなくなる**ようにするブラウザ API である。OWASP は「DOM XSS のクラス全体を緩和ではなく消滅させる数少ない対策の一つ」と評価している。

- **有効化**: CSP（Content Security Policy, コンテンツセキュリティポリシー）ヘッダに `require-trusted-types-for 'script'` を付ける（Chromium 系）。`trusted-types <policy-name>` で許可ポリシー名を絞れる。CSP とは、ブラウザに「どこからのスクリプトを実行してよいか」等を指示する HTTP ヘッダのこと。
- **対応状況**: Chromium 83 以降でネイティブ対応。それ以外のブラウザには polyfill（機能を補う互換実装）がある。
- **使い方の骨格**:

```js
const p = trustedTypes.createPolicy('foo', { createHTML: (s) => sanitizeSomehow(s) });
document.body.innerHTML = p.createHTML(userInput); // OK
document.body.innerHTML = userInput;               // 強制有効時は例外
```

Trusted Types が有効なとき、`innerHTML` に素の文字列を代入すると実行時に例外になり、登録済みポリシーが生成した `TrustedHTML` だけが受け付けられる。素の文字列代入という「攻撃の入口そのもの」が実行時に禁止されるので、うっかり書いた 1 行の脆弱性も止められるのが強みである。

### 8-4. DOMPurify と Trusted Types を組み合わせる

両者は連携できる。自前ポリシーの `createHTML` の中から DOMPurify を呼ぶ形が推奨される。

```js
trustedTypes.createPolicy('myPolicy', {
  createHTML: (to_escape) => DOMPurify.sanitize(to_escape, { RETURN_TRUSTED_TYPE: false }),
});
```

〔補足〕`createHTML` は通常の文字列を期待するため、この中で DOMPurify を呼ぶときは `RETURN_TRUSTED_TYPE: false` が必要になる（逆に単体で `TrustedHTML` を返させたいときは `RETURN_TRUSTED_TYPE: true`）。原則は「自分のポリシーが DOMPurify を呼ぶ」が正しく、「DOMPurify が自分のラップポリシーを呼ぶ」は循環になり誤り（DOMPurify は無限再帰を防ぐため `TypeError` を投げる）。

---

## 9. OWASP に学ぶ「直感に反する」事実

対策を正しく実装するには、初心者が引っかかりやすい「見た目と結果が食い違う」点を知っておくとよい。以下はいずれも OWASP DOM based XSS Prevention Cheat Sheet に基づく一次情報である。

### 9-1. DOM based XSS もアプリ所有者の責任

反射型・蓄積型は**サーバ側**のインジェクション問題、DOM based XSS は**クライアント（ブラウザ）側**のインジェクション問題である。ただし XSS はどの種類でも「実行」はブラウザで起き、そのクライアント側 JavaScript を配信しているのはサーバ（＝アプリ所有者）なので、**DOM based XSS もアプリ所有者の責任**だと OWASP は明言している。「フロントの問題だから」と切り離せない。

### 9-2. 複数のコンテキストが入れ子になる

ブラウザはレンダリング中に複数のコンテキスト（HTML／HTML 属性／URL／CSS の「レンダリングコンテキスト」と、JavaScript の「実行コンテキスト」）を切り替え、それぞれで解釈規則が違う。DOM based XSS が難しいのは、JavaScript 実行コンテキストの中に上記 4 つのサブコンテキストが入れ子で現れるため、必要なエスケープが「JS エスケープ」と「HTML エスケープ」の組み合わせになり、順序を間違えると防御が崩れるからである。典型的な脆弱パターンは次のとおり。

```html
<script>
  var x = '<%= taintedVar %>';   // ← サーバがテンプレートで埋め込む
  var d = document.createElement('div');
  d.innerHTML = x;               // ← sink。ここで HTML として解釈される
  document.body.appendChild(d);
</script>
```

### 9-3. RULE #1〜#7 の要点

| ルール | 対象 | 要点 |
|---|---|---|
| RULE #1 | 実行コンテキスト内の **HTML サブコンテキスト**（`innerHTML` / `outerHTML` / `document.write` / `document.writeln`） | **HTML エンコード → その後 JavaScript エンコード**の 2 段。順序が重要 |
| RULE #2 | 実行コンテキスト内の **HTML 属性サブコンテキスト** | コードを実行しない属性には **JavaScript エンコードのみ**。HTML 属性エンコードを重ねると二重エンコードで表示が壊れる（例: `Johnson & Johnson` が `Johnson &#x26;amp; Johnson` になる） |
| RULE #3 | **イベントハンドラ属性 / JavaScript コード**サブコンテキスト | **そもそも信頼できないデータを入れない**のが第一推奨。JavaScript エンコードはこの文脈では防御にならない |
| RULE #4 | **CSS 属性**サブコンテキスト | `url()` に渡す値は URL エンコード。`expression()` は実務上無効化済み |
| RULE #5 | **URL 属性**サブコンテキスト | **URL エンコード → JavaScript エンコード**。完全修飾 URL に適用するとスキームのコロンまでエンコードされリンクが壊れる点に注意 |
| RULE #6 | 安全な埋め込み | **最も基本的な安全策は `textContent` への代入**。`element.textContent = untrustedData;` はコードを実行しない |
| RULE #7 | 既存脆弱性の修正 | 正しい出力先（sink）を選ぶのが本筋。`div` に文字を出すなら `innerHTML` ではなく `innerText` / `textContent`。**`eval` にユーザー入力を渡すのは 99% が悪い／怠惰な実装の兆候であり、サニタイズを頑張るのではなく「やらない」が正解** |

### 9-4. 「同じエンコードが逆の結果になる」核心

1. **JavaScript エンコードはイベントハンドラ文脈では効かない**。`x.setAttribute("onclick", "alert(22)")` は `alert(22)` として**実行される**。`setAttribute(name, value)` は value を name の属性データ型に暗黙変換するため、name がイベントハンドラなら value は JavaScript コードとして評価される。`setTimeout` / `setInterval` / `new Function` も同種の問題を持つ。一方、HTML パーサ側のイベントハンドラ属性（`<a onclick="a...">`）では JavaScript エンコードが防御として機能する。**同じ見た目のエンコードが、HTML パーサ経由か DOM API 経由かで結果が逆になる**——これが DOM based XSS の厄介さの核心である。
2. **`innerText` は「だいたい安全」だが絶対ではない**。OWASP は "Usually Safe Methods" として、`<script>` 要素に対して `tag.innerText = untrustedData` とするとコードが実行されうると警告している。要素の種類に依存する。
3. **HTML エンコードと JavaScript エンコードは対称ではない**。HTML ではタグ名をエンコードするとタグとして解釈されなくなる（＝無力化になる）が、JavaScript では ECMAScript の仕様上、識別子をエンコードしても有効な識別子のままになる（＝無力化にならない）。
4. **HTTP レスポンス側のインターセプタ／フィルタ（および同型の WAF 的アプローチ）は DOM based XSS に無効**。OWASP は "Interceptors not effective against DOM-based XSS" として明記しており、これは §4 の「ツールでは検出しにくい／WAF でもブロックしにくい」という GMO 記事の主張の独立した裏取りになる。

### 9-5. 「やってはいけない対策」

OWASP が常に推奨する 3 本柱は、(1) フレームワークの保護機構（自動エスケープ）を活かす、(2) 文脈に応じた出力エンコード、(3) HTML サニタイズ。その上での追加の層が Cookie 属性・CSP・Trusted Types である。逆に、アンチパターンとして名指しされているものは次のとおり。

- **CSP ヘッダだけに頼る**（ブラウザの対応差、レガシーアプリでの適用困難）。CSP は「主防御にしてはいけない、追加の層」と位置づけられている。
- **HTTP インターセプタ／フィルタに頼る**（文脈ごとに必要なエンコードが違う、二重エンコードで表示が壊れる、DOM based XSS に無効、内部 API / 内部 DB 由来の汚染データを見落とす）。
- フレームワークの**エスケープ回避 API**を無検証で使う（React の `dangerouslySetInnerHTML` など。`javascript:` / `data:` URL は React でも専用の検証が必要）。

---

## 10. ソース／シンク 逐語チートシート

以下は GitHub の `Sivnerof/Sources-And-Sinks-Cheatsheet` README（全文 PortSwigger 由来）を逐語収録したもの。GMO 記事とは別資料だが、コードのどこがソースでどこがシンクかを見分けるための参照表として完全な形で載せる。原文（英語）のまま。

### 10-1. Sources（common）

```text
document.URL
document.documentURI
document.URLUnencoded
document.baseURI
location
document.cookie
document.referrer
window.name
history.pushState
history.replaceState
localStorage
sessionStorage
IndexedDB (mozIndexedDB, webkitIndexedDB, msIndexedDB)
Database
```

### 10-2. DOM-XSS Sinks

```text
document.write()
document.writeln()
document.domain
element.innerHTML
element.outerHTML
element.insertAdjacentHTML
element.onevent
```

jQuery functions that are sinks:

```text
add()  after()  append()  animate()  insertAfter()  insertBefore()  before()
html()  prepend()  replaceAll()  replaceWith()  wrap()  wrapInner()  wrapAll()
has()  constructor()  init()  index()  jQuery.parseHTML()  $.parseHTML()
```

### 10-3. その他のシンク（カテゴリ別）

```text
# Open-Redirection Sinks
location   location.host   location.hostname   location.href   location.pathname
location.search   location.protocol   location.assign()   location.replace()
open()   element.srcdoc   XMLHttpRequest.open()   XMLHttpRequest.send()
jQuery.ajax()   $.ajax()

# Cookie Manipulation Sink
document.cookie

# JavaScript Injection Sinks
eval()   Function()   setTimeout()   setInterval()   setImmediate()
execCommand()   execScript()   msSetImmediate()
range.createContextualFragment()   crypto.generateCRMFRequest()

# Document-Domain Manipulation Sink
document.domain

# WebSocket-URL Poisoning Sink
WebSocket

# Link Manipulation Sinks
element.href   element.src   element.action

# Ajax Request-Header Manipulation Sinks
XMLHttpRequest.setRequestHeader()   XMLHttpRequest.open()   XMLHttpRequest.send()
jQuery.globalEval()   $.globalEval()

# Local File-Path Manipulation Sinks
FileReader.readAsArrayBuffer()   FileReader.readAsBinaryString()
FileReader.readAsDataURL()   FileReader.readAsText()   FileReader.readAsFile()
FileReader.root.getFile()

# Client-Side SQL-Injection Sink
executeSql()

# HTML5 Storage Manipulation Sinks
sessionStorage.setItem()   localStorage.setItem()

# XPath Injection Sinks
document.evaluate()   element.evaluate()

# Client-Side JSON Injection Sinks
JSON.parse()   jQuery.parseJSON()   $.parseJSON()

# DOM-Data Manipulation Sinks
script.src   script.text   script.textContent   script.innerText
element.setAttribute()   element.search   element.text   element.textContent
element.innerText   element.outerText   element.value   element.name
element.target   element.method   element.type   element.backgroundImage
element.cssText   element.codebase   document.title
document.implementation.createHTMLDocument()   history.pushState()   history.replaceState()

# Denial Of Service Sinks
requestFileSystem()   RegExp()
```

〔補足〕このチートシートは「危険なリストの網羅」ではなく「まず疑う場所の索引」として使う。実際に脆弱かどうかは、そのシンクに渡る値がソース由来か（＝攻撃者が制御できるか）を DevTools で確認して初めて判断できる。

---

## 11. 検証時の倫理と法

DOM based XSS の検証は、必ず許可された環境で行う。

- 検証は**本番環境では行わず、非本番環境や専用のテストサイトで行う**こと。
- GMO 記事は PortSwigger の **Web Security Academy** のラボ（DOM XSS 系の演習ページ）を題材に手順を示している。これらは学習・検証が許可された環境である。無料アカウントで実行できる。
- 〔補足〕実サイトへの検査は、バグバウンティのスコープ（許可された対象範囲）内、または明示的な許可（診断契約等）がある場合に限る。無許可の検査は不正アクセス禁止法等に抵触しうる。

---

## 手を動かす

以下は、許可された学習環境（PortSwigger Web Security Academy の無料ラボや、自分で立てた検証ページ）を前提とした手順である。

1. **検証ページを用意する**。自分の PC に次の 1 ファイル（`domxss.html`）を作り、ローカルで開く。これはソース `location.hash` をシンク `innerHTML` に直結した、意図的に脆弱なページである。

```html
<!doctype html>
<div id="out"></div>
<script>
  // location.hash（ソース）を innerHTML（シンク）にそのまま渡す＝脆弱
  document.getElementById("out").innerHTML = decodeURIComponent(location.hash.slice(1));
</script>
```

2. **正常な値で動作を見る**。`domxss.html#hello` のように `#` の後ろに文字を付けて開き、`hello` が表示されることを確認する。

3. **検査文字列を注入する**。URL の末尾を次に変えて再読み込みする。ポップアップ（`alert(1)`）が出れば脆弱性が発火している。

```text
domxss.html#<svg onload=alert(1)>
```

4. **レスポンス raw に痕跡が無いことを確認する**。ブラウザで「ページのソースを表示（View source）」を開く。`<svg onload=...>` はソース表示には**現れない**。`location.hash` はサーバに送られず、DOM 組み立て時に初めて具現化するためである。これが「レスポンスを見ても検出できない」ことの体感である。

5. **DevTools で生成後の DOM を見る**。`F12` で開発者ツールを開き、Elements パネルで `#out` の中を見る。注入した `<svg>` 要素が DOM に挿入されているのが分かる。

6. **ブレークポイントで流れを追う**。Sources パネルで `Ctrl+Shift+F` を押し、`innerHTML` を検索してその行にブレークポイントを置く。再読み込みして停止したら、`innerHTML` に渡される値（＝ `location.hash` から来た文字列）を確認する。

7. **守り方に書き換える**。`innerHTML` を `textContent` に変えて再読み込みし、同じ URL でポップアップが出なくなることを確認する。文字がそのまま文字として表示されれば成功である。

```html
document.getElementById("out").textContent = decodeURIComponent(location.hash.slice(1));
```

---

## つまずきポイント

- **「レスポンスに文字列が無いから安全」ではない**。DOM based XSS はレスポンス raw に痕跡が出ないのが普通。Burp のレスポンス検索で引っかからないことは、むしろ DOM based XSS を疑う理由になる。
- **View source で確認しようとする**。View source はサーバから来た元 HTML を表示するだけで、JavaScript による変更が反映されない。必ず DevTools の Elements パネルで「生成後の DOM」を見る。
- **`location.hash` がサーバに届くと思い込む**。`#` 以降はサーバに送信されない。だからサーバ側のサニタイズや WAF では防げない。
- **`innerHTML` と `eval` で同じペイロードを使う**。HTML シンクには `"><svg onload=alert(1)>`、JavaScript 実行シンクには `alert(1)//` のように、文脈に合わせて形を変える必要がある。
- **エスケープすれば必ず安全と考える**。JavaScript エンコードはイベントハンドラ文脈（`setAttribute("onclick", ...)` など）では防御にならない。同じエンコードが HTML パーサ経由か DOM API 経由かで結果が逆になる。
- **DOMPurify のサニタイズ後に文字列を加工する**。サニタイズは最後の工程でなければ無効化される。加工してから渡すのは危険。
- **CSP や WAF を主防御にする**。どちらも「追加の層」であり、DOM based XSS には無効または不十分。sink を変える／サニタイズする／Trusted Types で封じる、が本筋。
- **本番サイトで試す**。検証は必ず許可された環境で。無許可の検査は法に触れうる。

---

## この節のまとめ

- 元記事「DOM based XSS の検出方法を理解する」（GMO Developers, 記事 ID 15402）は、DOM based XSS が自動ツールで見落とされる理由と、手動での検出手順を実例で解説する。
- XSS は反射型・蓄積型・DOM based の三分類。反射型・蓄積型はサーバ側の問題で、ペイロードがレスポンスに含まれる。DOM based はフロントエンド（JavaScript）の問題で、ペイロードがレスポンスに含まれないことがある。
- 中核概念は**ソース**（攻撃者が制御できる入口。例 `location.hash`）と**シンク**（危険な出口。例 `innerHTML`, `document.write`, `eval`）。「ソース → シンク」の経路があると DOM based XSS が成立する。
- DOM based XSS は、ペイロードがサーバのレスポンス raw に現れないため、従来型スキャナ・WAF・XSS フィルタで検出／防御しにくい。だから手動検証が必要になる。
- 検出手順(1): Burp Suite でレスポンス raw を確認し、`innerHTML` 等のシンクを探し、`"><svg onload=alert(1)>` を注入して `alert` の発火とレスポンス raw への非出現を同時に確認する。
- 検出手順(2): View source では見えないので、DevTools の Elements パネルで生成後の DOM を見る。Sources パネルの横断検索とブレークポイントでソース→シンクの流れを追う。DOM 変更ブレークポイントも有効。
- 高度化ツールとして DOM Invader（カナリア `burpdomxss` を注入して source→sink を追跡、Augmented DOM タブで可視化）、静的解析（Semgrep）がある。ただし最終判断は手動。
- 守り方は三段の梯子: (1) `textContent` へ置換、(2) HTML が必要なら DOMPurify でサニタイズ、(3) 組織全体なら Trusted Types で sink を型で封じる。
- OWASP RULE #6/#7 も `textContent` を最優先とし、「`eval` にユーザー入力を渡すのはやらないが正解」と強く述べる。DOMPurify はサニタイズを最後の工程にすること、定期更新が必須。
- Trusted Types は CSP の `require-trusted-types-for 'script'` で有効化し、素の文字列を sink に渡すと実行時例外になる。DOM XSS のクラス全体を消滅させうる。
- 「直感に反する」注意: JavaScript エンコードはイベントハンドラ文脈では効かない、`innerText` も `<script>` 相手では危険、HTTP レスポンス側のフィルタ／WAF は DOM based XSS に無効。
- ソース／シンクのチートシート（§10）は「まず疑う場所の索引」。実際の危険性はそのシンクに渡る値がソース由来かを DevTools で確認して判断する。
- 検証は本番環境で行わず、PortSwigger のラボや自作の検証ページなど、許可された環境で行う。

---

## 理解度チェック

1. 反射型 XSS と DOM based XSS の最大の違いを一言で言うと何か。
   ▶ 答え: ペイロードがサーバのレスポンスに含まれるか否か。反射型は含まれる（サーバ側の問題）、DOM based は含まれないことがある（フロントエンドの JavaScript の問題）。

2. 「ソース」と「シンク」をそれぞれ定義し、代表例を一つずつ挙げよ。
   ▶ 答え: ソースは攻撃者が制御できる入力元（例 `location.hash`）。シンクはその値から HTML/JS を生成・実行してしまう危険な箇所（例 `innerHTML`, `document.write`, `eval`）。両者を結ぶ経路があると DOM based XSS になる。

3. なぜ従来型の自動スキャナは DOM based XSS を検出しにくいのか。
   ▶ 答え: 多くのスキャナは「送ったペイロードがサーバのレスポンスに反射しているか」で判定するが、DOM based XSS ではペイロードがレスポンス raw に現れないため。特に `location.hash` はサーバに送信されない。

4. ページの生成後の DOM を確認するのに「View source（ページのソースを表示）」を使ってはいけないのはなぜか。代わりに何を使うか。
   ▶ 答え: View source はサーバから来た元 HTML を表示するだけで、JavaScript による DOM 変更を反映しないため。代わりに Chrome DevTools の Elements パネルで生成後の DOM を見る。

5. HTML シンク（`innerHTML`）向けの定番検査ペイロードを一つ書け。
   ▶ 答え: `"><svg onload=alert(1)>`（既存タグ／属性値を `">` で閉じ、`<svg>` を挿入し `onload` で `alert(1)` を実行する）。

6. DOM based XSS の守り方「三段の梯子」を順に述べよ。
   ▶ 答え: (1) 危険な sink を避け `textContent` に置き換える → (2) HTML が必要なら DOMPurify でサニタイズ → (3) 組織全体なら Trusted Types で sink を型で封じる。

7. DOMPurify を使うときに「サニタイズは最後の工程でなければならない」のはなぜか。
   ▶ 答え: サニタイズ後に文字列を加工すると、その加工で危険なパターンが再び生じ得て防御が無効化されるため。

8. Trusted Types はどう有効化し、有効化すると `innerHTML` に素の文字列を代入するとどうなるか。
   ▶ 答え: CSP ヘッダに `require-trusted-types-for 'script'` を付けて有効化する。有効化後に素の文字列を代入すると実行時に例外になり、登録済みポリシーが生成した `TrustedHTML` だけが受け付けられる。

9. 「JavaScript エンコードは必ず XSS を防ぐ」は正しいか。反例を挙げよ。
   ▶ 答え: 正しくない。`x.setAttribute("onclick", "alert(22)")` のようなイベントハンドラ文脈では JavaScript エンコードは防御にならず、値がコードとして実行される。同じエンコードが HTML パーサ経由か DOM API 経由かで結果が逆になる。

10. 実際のサイトで DOM based XSS を検証してよいのはどんな場合か。
    ▶ 答え: 自分で立てた検証環境、PortSwigger のラボなど許可された環境、またはバグバウンティのスコープ内・明示的な診断許可がある場合に限る。無許可の検査は不正アクセス禁止法等に触れうる。

---

## 出典

- GMO Developers「DOM based XSS の検出方法を理解する」（記事 ID 15402）: https://developers.gmo.jp/technology/15402/ （原典は本環境で取得できず、二次情報で再構成）
- GMO Developers「画面を見ながら理解する蓄積型クロスサイトスクリプティングの脆弱性とは」（記事 ID 27567）: https://developers.gmo.jp/technology/27567/
- PortSwigger Web Security Academy「DOM-based XSS」: https://portswigger.net/web-security/cross-site-scripting/dom-based
- PortSwigger「DOM Invader」ドキュメント: https://portswigger.net/burp/documentation/desktop/tools/dom-invader
- gihyo.jp 連載「JavaScript セキュリティ」: https://gihyo.jp/dev/serial/01/javascript-security/0006
- GitHub `Sivnerof/Sources-And-Sinks-Cheatsheet` README（PortSwigger 由来の source/sink 一覧、逐語取得）: https://raw.githubusercontent.com/Sivnerof/Sources-And-Sinks-Cheatsheet/HEAD/README.md
- OWASP DOM based XSS Prevention Cheat Sheet（逐語取得）: https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.md （公開版: https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html ）
- OWASP Cross Site Scripting Prevention Cheat Sheet（逐語取得）: https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.md
- DOMPurify README（逐語取得）: https://raw.githubusercontent.com/cure53/DOMPurify/main/README.md （リポジトリ: https://github.com/cure53/DOMPurify ）
- W3C Trusted Types README（逐語取得）: https://raw.githubusercontent.com/w3c/trusted-types/main/README.md （リポジトリ: https://github.com/w3c/trusted-types ）
- Semgrep DOM XSS ルール: https://semgrep.dev/s/we30

<!-- self-read: https://developers.gmo.jp/technology/15402/ | 原典。組織 egress ポリシーで 403 拒否、Wayback も不可。スクリーンショット・題材ラボ・対策原文を要確認 -->
<!-- self-read: https://developers.gmo.jp/technology/27567/ | 姉妹記事。同じドメインの egress ブロックで未取得。記述スタイルの参照用 -->
<!-- self-read: https://portswigger.net/web-security/cross-site-scripting/dom-based | source/sink 定義とテスト手順・ラボの原典。egress ブロックで未取得 -->
<!-- self-read: https://gihyo.jp/dev/serial/01/javascript-security/0006 | 日本語で source/sink を体系的に解説。egress ブロックで未取得 -->

<!-- sources: https://developers.gmo.jp/technology/15402/, https://developers.gmo.jp/technology/27567/, https://portswigger.net/web-security/cross-site-scripting/dom-based, https://portswigger.net/burp/documentation/desktop/tools/dom-invader, https://gihyo.jp/dev/serial/01/javascript-security/0006, https://raw.githubusercontent.com/Sivnerof/Sources-And-Sinks-Cheatsheet/HEAD/README.md, https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.md, https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html, https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.md, https://raw.githubusercontent.com/cure53/DOMPurify/main/README.md, https://raw.githubusercontent.com/w3c/trusted-types/main/README.md, https://semgrep.dev/s/we30 -->
<!-- terms: DOM based XSS, クロスサイトスクリプティング, 反射型XSS, 蓄積型XSS, ソース, シンク, location.hash, innerHTML, document.write, eval, textContent, DOM, DOMPurify, Trusted Types, CSP, WAF, Burp Suite, DOM Invader, カナリア, Chrome DevTools, Elements パネル, Sources パネル, ブレークポイント, テイントフロー, サニタイズ, Semgrep, dangerouslySetInnerHTML, Same-Origin Policy, SOC -->
