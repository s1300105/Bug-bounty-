# [35] DOM Invader の Web メッセージ機能 と postMessage-tracker 拡張

想定章: ch06（クライアントサイド脆弱性ハンティング／postMessage 追跡）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages | **full（公式ミラー経由）** | portswigger.net 本体は EGRESS_BLOCKED / CONNECT 403 で恒久遮断。**GitHub 上の PortSwigger ドキュメント丸ごとミラー `1tbfree/BurpSuitePro-SourceLeak`（raw.githubusercontent.com、200）から公式 HTML を full 取得**し、公式テキストで全面裏取り・加筆した | `resources/Documentation/.../dom-invader/web-messages.html`（本ページ原文）、`.../settings/web-messages.html`、`.../testing-workflow/.../web-message-dom-xss.html` を取得。日本語版は公式翻訳ミラー `ankokuty/burp-resources-ja` から。さらに **DOM Invader 拡張の実 UI ソース** `resources/Browser/ChromiumExtension/dom-invader-extension/panels/postmessage.html` で列見出し・ボタン名を確定 |
| https://github.com/fransr/postMessage-tracker | full | github.com 本体は 403 だが raw.githubusercontent.com は 200。README＋拡張のソース一式（chrome/ 配下：manifest.json, content_script.js, background.js, popup.html, popup.js, options.html, options.js, LICENSE）を全て取得 | README・全ソースを逐語で保持。画像バイナリのみ未取得 |

> **【補完エージェントによる更新 2026-09】** 前工程では portswigger.net 遮断のため partial だったが、本工程で **GitHub 上の公式ドキュメント完全ミラー（`1tbfree/BurpSuitePro-SourceLeak`）と公式日本語翻訳ミラー（`ankokuty/burp-resources-ja`）、および DOM Invader 拡張本体の UI ソース**を発見・full 取得。これにより (a) **Build PoC ボタン**、(b) **Severity/Confidence による自動フラグ付け**、(c) 設定「**Detect cross-domain leaks（クロスドメインリークの検出）**」、(d) **Show ドロップダウン（Original/Manipulated data）**、(e) Messages ビューの**正確な列見出し**、(f) 設定セクションの**正確な現行名称**を新たに確定。旧記述で二次情報由来だった「Filter by stack trace / Auto-fire events」は現行 `settings/web-messages` ページには存在せず、要注意（§3 で明記）。以下、公式原文で確定した内容を各節に追記した（出典 = PortSwigger 公式ページの GitHub ミラー）。

補助的に取得できた関連資料（内容の裏取りに使用、いずれも full）:
- HackTricks `dom-invader.md`（raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/xss-cross-site-scripting/dom-invader.md）
- HackTricks `dom-invader.md` 別ミラー（temphylic/hackxyz）
- HackTricks `postmessage-vulnerabilities/README.md`（postMessage-tracker/Posta を列挙者ツールとして言及）

## 要約（3〜10行）

DOM Invader は Burp 内蔵 Chromium ブラウザに同梱される DOM XSS ハンティング支援ツールで、その **Web メッセージ（Messages）機能** は、ページ上で `window.postMessage()` により送受信される web message をすべてログ化し、Burp Proxy の HTTP 履歴のように一覧表示する。各メッセージをダブルクリック（クリック）すると詳細ダイアログが開き、`Data` フィールドを編集して **Send** で再送できる（Burp Repeater 相当の手動プロービング）。メッセージ詳細では、受信側ハンドラが `origin` / `data` / `source` のどれを参照したかが分かり、データがどの sink に流れるかを推定できる。さらに DOM Invader は各メッセージに推定 **Severity（重大度）と Confidence（確信度）** を付けて自動フラグし、悪用可能と判断すれば詳細ダイアログの **Build PoC** ボタンで HTML PoC をクリップボードに生成できる。設定（cog アイコン）の**現行の正式項目は5つ**——**Postmessage origin spoofing**（origin 検証バイパスの自動検出）／**Canary injection into intercepted messages**（canary 自動注入）／**Filter messages with duplicate values**（同一メッセージのグループ化）／**Generate automated messages**（リスナへ自動生成メッセージを送信）／**Detect cross-domain leaks**（URL 由来データの異オリジン送信を検出＝OAuth トークン窃取等の情報漏えい検出）——であり、DOM Invader が自ら生成したメッセージは Messages ビューで数値 ID を持たない点で区別できる。〔前工程が挙げた "Filter by stack trace"・"Auto-fire events" は現行 settings/web-messages には存在せず要検証。§3.5 で訂正〕
一方 **postMessage-tracker**（Frans Rosén 作、2020年5月公開の Chrome 拡張）は、`Window.prototype.addEventListener`・`window.onmessage` setter・`MessagePort.prototype.addEventListener`・`History.prototype.pushState` をフックして、現在ウィンドウ（全サブフレーム含む）に登録された message リスナ数をバッジ表示し、各リスナのソースコードとスタックトレース上の登録位置を記録・表示する。Raven / New Relic / Rollbar / Bugsnag / Sentry / jQuery のラッパを「アンパック」して本物のリスナを見せ、`Log URL` オプションで全リスナ情報を外部エンドポイントへ POST でき、コンソールにはウィンドウ間の通信を `top.frames[0]` のような「replay 可能なパス」付きで可視化する。両者は「postMessage リスナ列挙 → origin 検証の甘さ確認 → data を sink へ流す PoC 作成」という同じハンティング手順を支える。

---

## 詳細ノート

> 注意: 本節の攻撃手法は、許可された検証・バグバウンティを前提とした防御／診断目的の技術解説として記述する。

### 1. DOM Invader とは（前提） （出典: HackTricks dom-invader.md, PortSwigger docs 二次情報）

DOM Invader は **Burp Suite の内蔵 Chromium ブラウザ** にインストールされているブラウザツールで、JavaScript の source と sink を自動的に計装（instrument）することで **DOM XSS やその他クライアントサイド脆弱性**（プロトタイプ汚染、DOM clobbering など）の検出を支援する。拡張は Burp に同梱されており、有効化するだけで使える。

DOM Invader はブラウザの DevTools パネルに独自タブを追加し、以下を可能にする:
1. **制御可能な sink をリアルタイムに特定**（文脈：attribute / HTML / URL / JS と、適用されているサニタイズ内容を含む）。
2. **`postMessage()` の web message をログ化・編集・再送**、または拡張に自動変異（mutate）させる。
3. クライアントサイド **プロトタイプ汚染の source を検出し、gadget→sink の連鎖をスキャン**（PoC を動的生成）。
4. **DOM clobbering ベクタを発見**（例: `id` / `name` の衝突でグローバル変数を上書き）。
5. 豊富な **Settings UI**（カスタム canary、自動注入、リダイレクトブロック、source/sink リスト等）で挙動を微調整。

〔補足（一般知識）〕本ノートは担当ID 35 の重点である「Web メッセージ（postMessage）機能」に絞って詳述する。プロトタイプ汚染・DOM clobbering・canary の詳細は他担当ノートに委ねる。

#### DOM Invader の有効化手順（Messages 機能を使う前提）
1. Burp の **Proxy ➜ Intercept ➜ Open Browser**（Burp 内蔵ブラウザ）を開く。
2. 右上の **Burp Suite** ロゴをクリック（隠れていれば先にジグソー（拡張）アイコンをクリック）。
3. **DOM Invader** タブで **Enable DOM Invader** を ON にし、**Reload** を押す。
4. DevTools を開き（`F12` または右クリック ➜ Inspect）ドックする。新しい **DOM Invader** パネルが現れる。

> Burp はプロファイル単位で状態を記憶する。必要なら *Settings ➜ Tools ➜ Burp's browser ➜ Store settings...* で無効化できる。

---

### 2. Web メッセージ（Messages）ビュー （出典: PortSwigger `tools/dom-invader/web-messages` 二次情報, HackTricks）

DOM Invader は、ページ上で `postMessage()` メソッドにより送られる **すべての web message をログ化** し、Burp Proxy が HTTP リクエスト／レスポンスの履歴を表示するのと同様に、有用な詳細情報とともに一覧表示する。ユーザーは web message を **編集して再送（modify and resend）** でき、これは Burp Repeater が改変した HTTP リクエストを再発行するのと同様に、DOM XSS 脆弱性を手動でプロービングするのに使える。

**Messages サブタブ** は、ページ上のすべての `window.postMessage()` 呼び出しを記録し、`origin` / `source` / `data` の使われ方を表示する。

これらの機能を使うには、まず **DOM Invader の設定メニューから Postmessage interception（postmessage 傍受）を有効化** する必要がある。

#### Messages ビューの開き方（手順）
1. DevTools の **DOM Invader** タブを選択する。
2. 右側パネルから **Messages** を選択する。
3. 記録された web message の一覧が表示される。

#### メッセージ詳細ダイアログ（message details dialog）
Messages ビュー内の任意のメッセージを **クリック（ダブルクリック）** すると、メッセージ詳細ダイアログが開く。ここでは、クライアントサイド JavaScript（受信側イベントハンドラ）が、そのメッセージの **`origin` / `data` / `source` プロパティのどれにアクセスしたか** が分かる。これにより、データが最終的にどの種類の sink に流れ込むかを識別できる。

各プロパティの意味と、脆弱性診断上の含意:

| プロパティ | 意味／診断上の含意 |
| --- | --- |
| **`origin`** | メッセージの origin 情報がハンドラで **チェックされていない** 場合、任意の外部ドメインからクロスオリジンでイベントハンドラにメッセージを送れる可能性がある。チェックされていても、正規表現・文字列一致のロジックが甘ければなお安全ではない（バイパスの余地あり）。ハンドラが `event.origin` を検証するか否かの指標。 |
| **`data`** | ペイロードが送られる場所。この `data` が受信側で使われていなければ、その sink は攻撃に無関係（利用価値がない）。ペイロードの投入先。 |
| **`source`** | `source` プロパティ（通常は iframe/window 参照）が origin の代わりに検証されているかを評価する。これがチェックされていても、検証をバイパスできないとは限らない。origin の厳密チェックより弱いことが多い。 |

#### メッセージの編集と再送（Reply / resend a message）— 手順
1. **Messages** ビューから任意のメッセージをクリックし、メッセージ詳細ダイアログを開く。
2. メッセージ情報を確認し、データが流れ込む **sink の種類を特定** する。
3. **`Data` フィールド** を、その sink の種類に合致するエクスプロイトに編集する。
4. **Send** をクリックする。

典型例: origin を検証せず `data` を `element.innerHTML` sink に渡すハンドラを見つけたとする。まず `<`・`>`・`"` の各文字がエスケープされるかをメッセージ送信で確認し、エスケープされないなら、それらの文字を使って PoC ペイロードを作成・送信する。

#### PoC の生成
悪用可能な脆弱性を発見したら、DOM Invader で PoC を生成できる。脆弱なメッセージを選択してメッセージ詳細ダイアログを開き、値をエクスプロイトに必要な形へ改変する。

#### DOM Invader が自動生成したメッセージの見分け方
web message 傍受を有効化すると、DOM Invader は `postMessage()` で送られる web message を自動ログするだけでなく、**デフォルトで、検出した message event ハンドラに対して自分自身のメッセージを生成・送信する**。ログされたメッセージには数値 ID が付くが、**DOM Invader が生成したメッセージは Messages ビューで数値 ID を持たない** ため区別できる。

---

### 2.5. 【公式原文で確定】Web メッセージ機能の正確な仕様 （出典: PortSwigger 公式ページ `tools/dom-invader/web-messages`／`testing-workflow/.../web-message-dom-xss` を GitHub ミラー `1tbfree/BurpSuitePro-SourceLeak` から full 取得。UI 文言は DOM Invader 拡張 `panels/postmessage.html` の実ソースで確認）

前工程が二次情報で再構成した §2 の内容は、公式原文で裏付けられた。加えて公式原文でのみ判明した重要事項を以下に確定情報として追記する。

#### (1) Web メッセージ機能が提供する3本柱（公式原文の逐語訳）
公式ページ「**Testing for DOM XSS using web messages**」冒頭の記述:
1. **ページ上で `postMessage()` メソッドにより送られる任意の web message を、有用な詳細情報とともにログ化する**（Burp Proxy が HTTP リクエスト／レスポンス履歴を表示するのと同様）。
2. **web message を編集・再送して DOM XSS を手動でプロービングできる**（Burp Repeater が改変 HTTP リクエストを再発行するのと同様）。
3. **DOM Invader が代わりに web message を自動改変・送信して DOM XSS を探る**。

これらはすべて **DOM Invader の Messages ビュー**からアクセスする。使用前に**設定メニューから Postmessage interception を有効化**する必要がある（詳細は Main settings）。

#### (2) Web メッセージ傍受の有効化（公式手順・逐語）
> 対象サイトの機能への干渉を避けるため、DOM Invader の web メッセージ機能は**既定で無効**。有効化するには:
> 1. **DOM Invader 設定メニュー**へ行く。
> 2. **Postmessage interception スイッチ**を選択する。
> 3. **Reload をクリック**してブラウザを再読み込みする（変更を反映するために必須）。

#### (3) 「Automated web message analysis」＝ Severity/Confidence による自動フラグ付け 【新規・前工程で欠落】
公式原文によれば、有効化後 DOM Invader は自動ログに加え、**既定でメッセージを次の2通りに改変して「面白い」メッセージを自動判定する**:
- **メッセージの `data` プロパティに canary を注入**し、そのデータが流れ込む sink を DOM view と同様に特定する。
- **メッセージの origin を、期待ドメイン名で始まりかつ終わる偽 origin に置換**し、origic 検証ロジックや正規表現に欠陥のあるハンドラを自動特定する。

観測した挙動に基づき、DOM Invader は**悪用可能と判断したメッセージに推定 Issue Severity（重大度）と Confidence（確信度）を表示してフラグ付けする**。**ページ上で送られた全メッセージは、DOM Invader が自動検出できない脆弱性を含み得るため、少なくとも Information 重大度で一覧される**。（拡張 UI ソースにも `Severity` / `Confidence` フィールドが実在。）

> 〔注〕この2つの自動改変（canary 注入・偽 origin 置換）は設定メニューから個別に無効化できる（§3 参照）。

#### (4) Messages ビューの一覧・列（拡張 UI ソース `postmessage.html` で確定）
Messages 一覧テーブルの**列見出し**は実 UI 上、次の通り:
`ID` ／ `Type` ／ `Origin` ／ `Data` ／ `From frame` ／ `To frame` ／ `Stack trace`。
- `ID`: ログ済みメッセージの数値 ID（**DOM Invader 生成メッセージは ID なし**＝空欄で区別）。
- `Type`: メッセージ種別。
- `From frame` / `To frame`: 送信元・宛先のフレーム（`top`, `top.frames[0]` 形式）。
- 一覧上部に **Search / Search for Canary / Clear all** の操作、メッセージが無い時は **(No messages)** 表示。

#### (5) メッセージ詳細ダイアログ（Replay Postmessage ダイアログ）の全フィールド 【UI ソースで確定】
メッセージをクリックすると **Replay Postmessage** ダイアログが開く。実 UI が持つ要素（拡張ソースより）:
- **Spoof origin** チェックボックス（この1メッセージだけ origin 偽装を適用）。
- **Origin** 入力フィールド（手動で origin を書き換え可能）。
- **Data** 入力フィールド（ペイロード編集）。
- **Show** ドロップダウン: **Original data ↔ Manipulated data** を切替（ページが送った原データと、canary 自動注入後データを見比べる）。
- **Message type** 表示: `json-object` / `json-string` / `string`（DOM Invader が推定したデータ形式）。
- **Severity** / **Confidence** 表示。
- **Origin accessed** / **Data accessed** / **Source accessed** インジケータ（受信側 JS が各プロパティに触れたか）。
- **Title** / **SINK** / **Description**（例文テンプレート: 「Web message data is being sent via ORIGINAL ORIGIN to origin ORIGIN from a postMessage request.」「This event listener {does/does not} check the origin before accessing data.」）。
- 下部ボタン: **Close** ／ **Log** ／ **Stack trace** ／ **Build PoC** ／ **Send (CTRL+Enter)**。
- 自動生成メッセージには「This message was automatically generated by DOM Invader.」の注記が出る。
- スタックトレースは「Press escape to open the console or click to the console tab to view the stack trace」の導線でコンソール表示できる。

#### (6) メッセージの編集・再送（公式手順・逐語）
1. **Messages ビュー**で任意メッセージをクリックし、メッセージ詳細ダイアログを開く。
2. **Data フィールド**を必要に応じて編集する。
3. **Send** をクリックする。

例（公式原文）: origin を検証せず `data` を `element.innerHTML` sink に渡すメッセージを特定したら、まず `<`・`>`・`"` がエスケープされるか送信して確認し、されないならそれらの文字で PoC ペイロードを作成・送信する。

#### (7) PoC 生成 ＝「Build PoC」ボタン 【新規・前工程で欠落／重要】
公式原文: 悪用可能な脆弱性を web message で特定できたら、DOM Invader は**レポートに載せられる HTML の PoC を生成できる**。手順:
1. 脆弱なメッセージを選択してメッセージ詳細ダイアログを開く。
2. エクスプロイトに必要な値へ改変する。
3. **Build PoC をクリック**する。**HTML がクリップボードに保存される**。

> 前工程ノートは「値を改変する」までしか記していなかったが、正確には専用の **Build PoC ボタンが HTML PoC をクリップボードへコピー**する。

#### (8) 各プロパティ（origin / data / source）の公式定義（§2 表を補強）
- **Origin accessed**: クライアントコードが origin プロパティに一度も触れなければ、**origin 検証をしていない可能性が高く**、任意外部ドメインからクロスオリジンでイベントハンドラにメッセージを送れる可能性がある。触れていても検証を回避できることがある。回避策探索のため、DOM Invader は**スタックトレース経由で該当コード行へのリンク**を提供する（→「Studying the client-side code」）。
- **Data accessed**: `data` はペイロード投入先。JS がこのプロパティに触れなければ sink に渡り得ず、そのメッセージは無関係。
- **Source accessed**: `source` は送信元 window オブジェクト参照（通常 iframe）。Web サイトは origin より堅牢な手段として `source` を検証することがある。ただし触れていても検証・回避不能を保証しない。

---

### 3. Web メッセージ設定（cog アイコン） （出典: PortSwigger `settings/web-messages` 二次情報, HackTricks）

**Postmessage interception** オプションの隣の **cog（歯車）アイコン** をクリックすると、web message 取り扱い時の DOM Invader の挙動を微調整する追加設定にアクセスできる。主な設定は以下。

| 設定 | 有効時の挙動 |
| --- | --- |
| **Spoof origin**（origin 偽装） | 送信される任意のメッセージの origin を、**本来の origin のドメイン名で始まりかつ終わる偽の origin** に自動的に置き換える。これにより、メッセージの origin 検証に**欠陥のあるロジックや正規表現**を用いているイベントハンドラを自動で特定できる。 |
| **Auto-inject canary**（canary 自動注入） | ページ上で送られる任意のメッセージの `data` プロパティに canary を自動注入する。期待されるデータが JSON 文字列 / JSON オブジェクト / プレーン文字列のどれかを判定し、正しい形式で canary を注入する。 |
| **Group identical messages**（同一メッセージのグループ化） | 同一のメッセージをまとめてノイズを削減する。すべてのメッセージを個別に見たい場合は、この設定を無効化するとよい。 |
| **Filter by stack trace**（スタックトレースでフィルタ） | 有効時、各エントリのスタックトレースを比較し、既存エントリと **コード上の同じ位置** を指すものを隠す。大量に発火するメッセージによるノイズ問題（同一コード位置の重複）に対処する。 |
| **Auto-fire events**（イベント自動発火） | 有効時、ページ読み込み直後に **すべての要素に対して click と mouseover イベントを自動発火** する。注入したペイロードが、これらのイベント発生時にのみ sink に到達するケースで有用。 |
| **Auto-mutate / message 生成**（自動変異・メッセージ生成） | 有効時、DOM Invader は canary ベースのペイロードを生成し、ハンドラへ再生（replay）する。ページ上で検出した任意の message event リスナに対して、自ら生成したメッセージを送信する。 |

#### メッセージ生成（message listeners への自動送信）の仕組み
この設定が有効なとき、DOM Invader はページ上で特定した **任意の message event リスナに対して、自ら生成したメッセージを送信** する。これは、脆弱かもしれないイベントハンドラをテストしたいが、通常のページ操作では message イベントをトリガできない場合に有用。

DOM Invader は、各イベントハンドラが期待しているデータ構造を推測しようと試み、その情報を使って適切なメッセージを生成・送信する。リスナが各メッセージをどう処理するかに基づいて、**追加のコードパスに到達するよう調整した後続メッセージ**（さらに危険な sink へ到達し得る）を生成できる。

〔補足（一般知識）〕`element.innerHTML`・`document.write`・`eval`・`location`/`location.href`・`setTimeout`（文字列引数）・`Function` などが postMessage 経由 DOM XSS の代表的 sink。origin 検証の甘い listener が `event.data` をこれらに渡していれば、外部オリジンからの postMessage で任意スクリプト実行に繋がり得る（各 sink の詳細は sink 一覧担当ノート参照）。

---

### 3.5. 【公式原文で確定】Web メッセージ設定の現行・正確な一覧 （出典: PortSwigger 公式 `settings/web-messages`（英語 GitHub ミラー `1tbfree/BurpSuitePro-SourceLeak`）＋公式日本語訳ミラー `ankokuty/burp-resources-ja`。両者 full 取得）

> **重要な訂正**: §3 の表は二次情報（HackTricks・検索スニペット）由来で、ラベル名が**現行公式ページと一致しない**。現行の `settings/web-messages` ページ（歯車アイコン → 開く設定）に**実在する設定は次の5つのみ**。前工程が挙げた「**Filter by stack trace（スタックトレースでフィルタ）**」「**Auto-fire events（イベント自動発火）**」は**この現行ページには存在しない**（旧バージョンか、DOM view 側／Misc 設定の別項目に由来する可能性が高い＝要検証扱い）。以下が公式原文で確定した現行設定。

| 現行の公式ラベル（英／日） | 有効時の挙動（公式原文の訳） | 前工程ノートの旧ラベルとの対応 |
| --- | --- | --- |
| **Postmessage origin spoofing**／**Postmessage のオリジン偽装** | 送信される任意メッセージの origin を、**本来の origin のドメイン名で始まりかつ終わる偽 origin に自動置換**。`startsWith()` / `endsWith()` 等でドメイン名を検証するハンドラは、この手法で簡単に回避され得るため、そうした**欠陥ロジック／正規表現を持つハンドラを自動特定**できる。無効時でも、再送時に **Spoof origin チェックボックス**を選ぶか、**Origin 入力フィールドで手動置換**すれば個別に偽装可能。 | 旧「Spoof origin」に相当（＝正式名は "Postmessage origin spoofing"） |
| **Canary injection into intercepted messages**／**インターセプトしたメッセージへカナリアを挿入** | ページ上で送られる任意メッセージの `data` プロパティに **canary を自動注入**。期待データが **JSON 文字列／JSON オブジェクト／プレーン文字列**のどれかを判定し、正しい形式で注入する。メッセージ詳細では **Show ドロップダウン**で「ページが送った原データ」と「自動注入後データ」を切替表示できる。 | 旧「Auto-inject canary」に相当 |
| **Filter messages with duplicate values**／**重複する値を持つメッセージのフィルタリング** | 同一メッセージをグループ化してノイズ低減。全メッセージを個別に見たい（＝実際に送信されているか確認したい）場合は無効化する。 | 旧「Group identical messages」に相当 |
| **Generate automated messages**／**自動メッセージの生成** | 発見した任意の message event リスナへ**自ら生成したメッセージを送信**。通常のページ操作ではイベントを起こせない脆弱ハンドラのテストに有用。各ハンドラが期待するデータ構造を推測し適切なメッセージを生成、リスナの処理挙動に応じて**より危険な sink へ到達する追加コードパスを狙った後続メッセージ**も生成する。**生成メッセージは Messages ビューで数値 ID を持たない**ため判別できる。 | 旧「Auto-mutate／メッセージ生成」に相当 |
| **Detect cross-domain leaks**／**クロスドメインリークの検出** 【前工程で完全欠落・新規】 | 有効時、**現在のページが URL 由来のデータを含む web message を、現在ページとは異なる origin 宛てに送信したときにレポート**する。この場合、攻撃者はデータを抽出するイベントリスナを仕込んだページを **iframe に埋め込む**ことで、**OAuth トークン等の機密データを窃取**できる可能性がある（DOM XSS ではなく **クロスドメイン情報漏えい**の検出機能）。 | 旧ノートに項目なし（本工程で追加） |

〔要点〕現行公式の設定は上記5項目。**Detect cross-domain leaks は DOM XSS ではなく機密データ漏えい（OAuth トークン窃取等）の検出**という、他の4項目と毛色の異なる機能である点に注意。旧ノートの「Filter by stack trace」「Auto-fire events」は現行 `settings/web-messages` に無いため、教科書化の際は本 3.5 節の現行ラベルを正典とし、旧 §3 表は「過去の記述・要検証」として扱うこと。

---

### 4. postMessage-tracker 拡張の概要 （出典: fransr/postMessage-tracker README, full 取得）

作者は **Frans Rosén**（@fransrosen）。2018年の OWASP AppSec Europe の講演「Attacking modern web technologies」（動画 https://www.youtube.com/watch?v=oJCCOnF25JU 、スライド https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies ）で発表され、**2020年5月に公開** された。

この **Chrome 拡張** は、現在のウィンドウにおける postMessage リスナを監視し、**リスナ数のインジケータ（バッジ）** を表示する。

主な特徴（README 逐語要点）:
- **ウィンドウの全サブフレームのリスナ追跡** をサポート。
- **短命なリスナ（short-lived listeners）** や **操作（interaction）によって有効化されるリスナ** も追跡する。
- 拡張の **Log URL オプション** を使えば、リスナ関数とその位置をログし後で見返せる。これにより、**iframe 内で短時間だけ有効化される隠れたリスナ** を発見できる。
- ウィンドウ間の相互作用をコンソール内に表示し、**自分で replay（再送）に使えるパス** でウィンドウを特定する（例: 後述の `top.frames[0]` 形式）。
- コンソールで **`diffwin`** を送信元／受信先として使い、異なるウィンドウ間で発生する通信も追跡できる。

#### ラッパの「アンパック」対応
- **Raven, New Relic, Rollbar, Bugsnag, jQuery** のラッパをサポートし、それらを「アンパック」して **本物のリスナ** を見せる。
- ラッパをバイパス・再ルートし、DevTools コンソールが適切なリスナを表示するよう試みる（README には New Relic / jQuery の before/after スクリーンショットあり）。
- **Log URL** は `chrome://extensions` ページで拡張をクリックした際の Extension Options（オプション）で設定でき、各リスナに関するすべての情報（リスナと関数）を送信することで、後から全リスナを見返せる。
- **匿名関数（anonymous functions）** をサポート。Chrome は匿名関数を文字列化できないため、匿名関数の場合はリスナとして `bound`（`bound ...`）文字列が表示される。

#### 既知の問題（Known issues）
一部のウェブサイトは XHTML 名前空間を持つ XML として配信されるため、拡張がプレーンな XML ファイルにも自身を付加し XML の先頭にレンダリングされることがあった（ブラウザで XML ファイルを見る際に混乱を招く）。→ 現在は、Chrome が XML ファイルをレンダリングする際に `document.contentType` が `application/xml` になる場合、コンテンツスクリプトを DOM に追加しないよう修正済み。

---

### 5. postMessage-tracker の内部実装（仕組み） （出典: fransr/postMessage-tracker chrome/*.js, full 取得）

拡張は Manifest V2 の Chrome 拡張。`<all_urls>` に対し `run_at: document_start` かつ `all_frames: true` で `content_script.js` を注入する。permissions は `tabs`, `storage`, `http://*/`, `https://*/`。

#### 5.1 マニフェスト（chrome/manifest.json） — 逐語
```json
{
  "manifest_version": 2,
  "name": "postMessage-tracker",
  "description": "Monitors and indicates postMessage-listeners in the current window.",
  "version": "1.0.0",
  "background": {
    "scripts": [
      "background.js"
    ]
  },
  "content_scripts": [
    {
      "matches": [
        "<all_urls>"
      ],
      "js": [
        "content_script.js"
      ],
      "run_at": "document_start",
      "all_frames": true
    }
  ],
  "options_ui": {
    "page": "options.html",
    "chrome_style": true
  },
  "browser_action": {
    "default_popup": "popup.html"
  },
  "permissions": [
    "tabs",
    "storage",
    "http:\/\/*\/",
    "https:\/\/*\/"
  ]
}
```

#### 5.2 フックの全体像（content_script.js のヘッダコメント原文）
コンテンツスクリプト冒頭のコメントに、フックの意図が明記されている（逐語）:
```
/*
History is needed to hijack pushState-changes
addEventListener to hijack the message-handlers getting registered
defineSetter to handle old way of setting onmessage
beforeunload to track page changes (since we see no diff btw fragmentchange/pushstate and real location change

we also look for event.dispatch.apply in the listener, if it exists, we find a earlier stack-row and use that one
also, we look for jQuery-expandos to identify events being added later on by jQuery's dispatcher
*/
```

つまりフックする対象は:
- **`History.prototype.pushState`**: pushState による履歴変更を乗っ取り、ページ遷移かフラグメント変更かを判別する（リスナ一覧のリセット判断に使う）。
- **`Window.prototype.addEventListener`**: `type == 'message'` で登録される message ハンドラを乗っ取り、登録時にリスナ本体とスタックトレースを記録。
- **`window.__defineSetter__('onmessage', ...)`**: 旧来の `window.onmessage = ...` によるハンドラ設定を捕捉。
- **`MessagePort.prototype.addEventListener`**: MessageChannel の port 経由の message も監視。
- **`beforeunload`**: ページ変更（フラグメント変更／pushstate と本当のロケーション変更の区別がつかないため）を追跡。
- **jQuery 対応**: リスナ内に `event.dispatch.apply` があれば jQuery のディスパッチャと判断し、スタックの1つ前の行を採用。さらに `jQuery` を含むグローバルの expando を探し、後から jQuery ディスパッチャ経由で追加されるイベントを特定。

#### 5.3 注入方式（ページの実行コンテキストへ）
コンテンツスクリプトは、フック本体である巨大な関数 `injectedJS` を文字列化し、`History.prototype.pushState`・`Window.prototype.addEventListener`・`MessagePort.prototype.addEventListener` を引数に **即時実行関数として `<script>` タグでページ側に注入** する（isolated world ではなくページの実世界で prototype を書き換えるため）。逐語:
```javascript
injectedJS = '(' + injectedJS.toString() + ')'+
             '(History.prototype.pushState, Window.prototype.addEventListener, MessagePort.prototype.addEventListener)';

document.addEventListener('postMessageTracker', function(event) {
	chrome.runtime.sendMessage(event.detail);
});

//we use this to separate fragment changes with location changes
window.addEventListener('beforeunload', function(event) {
	var storeEvent = new CustomEvent('postMessageTracker', {'detail':{changePage:true}});
	document.dispatchEvent(storeEvent);
});

(function() {
    switch(document.contentType) {
        case 'application/xml':
            return;
    }
    var script = document.createElement("script");
    script.setAttribute('type', 'text/javascript')
    script.appendChild(document.createTextNode(injectedJS));
    document.documentElement.appendChild(script);
})();
```
ページ側の注入コードは、記録したい情報を `CustomEvent('postMessageTracker', {detail:...})` として `document.dispatchEvent` し、コンテンツスクリプト側がそれを受けて `chrome.runtime.sendMessage` で background に転送する（ページ世界 → 拡張世界のブリッジ）。`document.contentType == 'application/xml'` のときは注入しない（既知の問題対策）。

#### 5.4 ウィンドウ経路（hops）の算出 — `h()` 関数（逐語）
`diffwin`（別ウィンドウ）／`top`／`top.frames[i].frames[j]...` の形で、メッセージ送信元・受信先を **replay に使えるパス文字列** として表現する。
```javascript
	var h = function(p) {
		var hops="";
        try {
        		if(!p) p=window;
        		if(p.top != p && p.top == window.top) {
        			var w = p;
        			while(top != w) { 
        				var x = 0; 
        				for(var i = 0; i < w.parent.frames.length; i++) { 
        					if(w == w.parent.frames[i]) x=i; 
        				}; 
        				hops="frames["+x+"]" + (hops.length?'.':'') + hops; 
        				w=w.parent; 
        			}; 
        			hops="top"+(hops.length?'.'+hops:'')
        		} else {
        			hops=p.top == window.top ? "top" : "diffwin";
        		}
        } catch(e) {

        }
		return hops;
	};
```

#### 5.5 スタックトレースからリスナ登録位置を取る — `l()` 関数（逐語）
`throw new Error('')` でスタックを取得し、`offset`（既定 3 ＋ ラッパ分の追加オフセット）行目を「登録位置」として採用する。jQuery ディスパッチャ検出時は `pattern_before` 正規表現で1つ手前の行を選ぶ。`listener.__postmessagetrackername__`（アンパック済みの本物のリスナ名／匿名時の `bound ...`）があればそれを表示文字列に使う。
```javascript
	var l = function(listener, pattern_before, additional_offset) {
		offset = 3 + (additional_offset||0)
		try { throw new Error(''); } catch (error) { stack = error.stack || ''; }
		stack = stack.split('\n').map(function (line) { return line.trim(); });
		fullstack = stack.slice();
		if(pattern_before) {
			nextitem = false;
			stack = stack.filter(function(e){
				if(nextitem) { nextitem = false; return true; }
				if(e.match(pattern_before))
					nextitem = true;
				return false;
			});
			stack = stack[0];
		} else {
			stack = stack[offset];
		}
		listener_str = listener.__postmessagetrackername__ || listener.toString();
		m({window:window.top==window?'top':window.name,hops:h(),domain:document.domain,stack:stack,fullstack:fullstack,listener:listener_str});
	};
```

#### 5.6 各種エラー監視ラッパの判定 — `c()` 関数（逐語）
リスナの文字列表現を正規表現で照合し、Raven / New Relic / Rollbar / Bugsnag / Sentry / Bugsnag2 のいずれのラッパかを判定する。判定に使う正規表現・プロパティ名はそのまま診断上の指紋になる。
```javascript
	var c = function(listener) {
		var listener_str = originalFunctionToString.apply(listener)
		if(listener_str.match(/\.deep.*apply.*captureException/s)) return 'raven';
		else if(listener_str.match(/arguments.*(start|typeof).*err.*finally.*end/s) && listener["nr@original"] && typeof listener["nr@original"] == "function") return 'newrelic';
		else if(listener_str.match(/rollbarContext.*rollbarWrappedError/s) && listener._isWrap && 
					(typeof listener._wrapped == "function" || typeof listener._rollbar_wrapped == "function")) return 'rollbar';
		else if(listener_str.match(/autoNotify.*(unhandledException|notifyException)/s) && typeof listener.bugsnag == "function") return 'bugsnag';
		else if(listener_str.match(/call.*arguments.*typeof.*apply/s) && typeof listener.__sentry_original__ == "function") return 'sentry';
		else if(listener_str.match(/function.*function.*\.apply.*arguments/s) && typeof listener.__trace__ == "function") return 'bugsnag2';
		return false;
	}
```

#### 5.7 addEventListener フックとアンパック処理 — 逐語（核心）
`type=='message'` の登録を捕捉し、`unwrap()` でラッパを剥がして本物のリスナへ辿り、`l()` で記録する。ラッパ種別ごとに `offset` を増やし、スタックトレースの読み位置を補正する。
```javascript
	Window.prototype.addEventListener = function(type, listener, useCapture) {
		if(type=='message') {
			var pattern_before = false, offset = 0;
			if(listener.toString().indexOf('event.dispatch.apply') !== -1) {
				m({log:'We got a jquery dispatcher'});
				pattern_before = /init\.on|init\..*on\]/;
				if(loaded) { setTimeout(j, 100); }
			}
			var unwrap = function(listener) {
				found = c(listener);
				if(found == 'raven') {
					var fb = false, ff = false, v = null;
					for(key in listener) {
						var v = listener[key];
						if(typeof v == "function") { ff++; f = v; }
						if(typeof v == "boolean") fb++;
					}
					if(ff == 1 && fb == 1) {
						m({log:'We got a raven wrapper'});
						offset++;
						listener = unwrap(f);
					}
				} else if(found == 'newrelic') {
					m({log:'We got a newrelic wrapper'});
					offset++;
					listener = unwrap(listener["nr@original"]);
				} else if(found == 'sentry') {
					m({log:'We got a sentry wrapper'});
					offset++;
					listener = unwrap(listener["__sentry_original__"]);
				} else if(found == 'rollbar') {
					m({log:'We got a rollbar wrapper'});
					offset+=2;
				} else if(found == 'bugsnag') {
					offset++;
					var clr = null;
					try { clr = arguments.callee.caller.caller.caller } catch(e) { }
					if(clr && !c(clr)) { //dont care if its other wrappers
						m({log:'We got a bugsnag wrapper'});
						listener.__postmessagetrackername__ = clr.toString();
					} else if(clr) { offset++ }
				} else if(found == 'bugsnag2') {
					offset++;
					var clr = null;
					try { clr = arguments.callee.caller.caller.arguments[1]; } catch(e) { }
					if(clr && !c(clr)) { //dont care if its other wrappers
                        listener = unwrap(clr);
						m({log:'We got a bugsnag2 wrapper'});
						listener.__postmessagetrackername__ = clr.toString();
					} else if(clr) { offset++; }
				}
				if(listener.name.indexOf('bound ') === 0) {
					listener.__postmessagetrackername__ = listener.name;
				}
				return listener;
			};

            if(typeof listener == "function") {
    			listener = unwrap(listener);
			    l(listener, pattern_before, offset);
            }
		}
		return msgeventlistener.apply(this, arguments);
	};
	window.addEventListener('load', j);
	window.addEventListener('postMessageTrackerUpdate', j);
};
```

#### 5.8 コンソールへのメッセージ可視化 — `onmsg()` / `onmsgport()`（逐語）
受信した message を、送信元 hops → 受信先 hops、port 数、`data`（文字列 or `j ` + JSON）を色分けしてコンソールに出す。
```javascript
    var onmsgport = function(e){
        var p = (e.ports.length?'%cport'+e.ports.length+'%c ':'');
        var msg = '%cport%c→%c' + h(e.source) + '%c ' + p + (typeof e.data == 'string'?e.data:'j '+JSON.stringify(e.data));
        if (p.length) {
            console.log(msg, "color: blue", '', "color: red", '', "color: blue", '');
        } else {
            console.log(msg, "color: blue", '', "color: red", '');
        }
    };
    var onmsg = function(e){
        var p = (e.ports.length?'%cport'+e.ports.length+'%c ':'');
        var msg = '%c' + h(e.source) + '%c→%c' + h() + '%c ' + p + (typeof e.data == 'string'?e.data:'j '+JSON.stringify(e.data));
        if (p.length) {
            console.log(msg, "color: red", '', "color: green", '', "color: blue", '');
        } else {
            console.log(msg, "color: red", '', "color: green", '');
        }
    };
	window.addEventListener('message', onmsg)
    MessagePort.prototype.addEventListener = function(type, listener, useCapture) {
        if (!this.__postmessagetrackername__) {
            this.__postmessagetrackername__ = true;
            this.addEventListener('message', onmsgport);
        }
        return msgporteventlistener.apply(this, arguments);
    }
```

#### 5.9 旧式 onmessage setter と pushState フック（逐語）
```javascript
	History.prototype.pushState = function(state, title, url) {
		m({pushState:true});
		return pushstate.apply(this, arguments);
	};
	var original_setter = window.__lookupSetter__('onmessage');
	window.__defineSetter__('onmessage', function(listener) {
		if(listener) {
			l(listener.toString());
		}
		original_setter(listener);
	});
```

#### 5.10 jQuery イベントの回収（逐語・要点）
`Object.getOwnPropertyNames(window)` を走査して名前に `jQuery` を含むグローバルを探し、`_data(window,'events')` や expando（`window[key].expando` → `window[expando + i]`）から登録済みイベントハンドラを取り出して記録する。
```javascript
	var jqc = function(key) {
		m({log:['Found key', key, typeof window[key], window[key] ? window[key].toString(): window[key]]});
		if(typeof window[key] == 'function' && typeof window[key]._data == 'function') {
			m({log:['found jq function', window[key].toString()]});
			ev = window[key]._data(window, 'events');
			jq(ev);
		} else if(window[key] && (expando = window[key].expando)) {
			m({log:['Use expando', expando]});
			var i=1; while(instance = window[expando + i++]) {
				jq(instance.events);
			}
		} else if(window[key]) {
			m({log:['Use events directly', window[key].toString()]});
			jq(window[key].events);
		}
	};
```

#### 5.11 バッジ表示・Log URL 送信・履歴管理 — background.js（逐語）
background は、コンテンツスクリプトから来た `msg.listener` をタブ単位で蓄積し、拡張アイコンのバッジにリスナ数を表示（0より大きければ赤背景）。`log_url` が設定されていれば各リスナ情報を JSON で POST する。`function () { [native code] }` は無視。pushState はページリセット扱いにしない工夫がある。
```javascript
var tab_listeners = {};
var tab_push = {}, tab_lasturl = {};
var selectedId = -1;

function refreshCount() {
	txt = tab_listeners[selectedId] ? tab_listeners[selectedId].length : 0;
	chrome.tabs.get(selectedId, function() {
		if (!chrome.runtime.lastError) {
			chrome.browserAction.setBadgeText({"text": ''+txt, tabId: selectedId});
			if(txt > 0) {
				chrome.browserAction.setBadgeBackgroundColor({ color: [255, 0, 0, 255]});
			} else {
				chrome.browserAction.setBadgeBackgroundColor({ color: [0, 0, 255, 0] });
			}
		}
	});
}

function logListener(data) {
	chrome.storage.sync.get({
		log_url: ''
	}, function(items) {
		log_url = items.log_url;
		if(!log_url.length) return;
		data = JSON.stringify(data);
		try {
			fetch(log_url, {
				method: 'post',
				headers: {
					"Content-type": "application/json; charset=UTF-8"
				},
				body: data
			});
		} catch(e) { }
	});
}

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
	console.log('message from cs', msg);
	tabId = sender.tab.id;
	if(msg.listener) {
		if(msg.listener == 'function () { [native code] }') return;
		msg.parent_url = sender.tab.url;
		if(!tab_listeners[tabId]) tab_listeners[tabId] = [];
		tab_listeners[tabId][tab_listeners[tabId].length] = msg;
		logListener(msg);
	}
	if(msg.pushState) {
		tab_push[tabId] = true;
	}
	if(msg.changePage) {
		delete tab_lasturl[tabId];
	}
	if(msg.log) {
		console.log(msg.log);
	} else {
		refreshCount();
	}
});
```
（`chrome.tabs.onUpdated` / `onActivated` / `onConnect` により、ページ status が `complete` でバッジ更新、`loading` でリスナ配列を条件付きリセット、popup からの接続で `tab_listeners` を返す。原文では pushState/hash 変更時にリセットしない分岐がコメントで残されている。）

#### 5.12 ポップアップ表示 — popup.js（逐語・要点）
popup は background に接続してリスナ一覧を取得し、各リスナについて **domain・window/hops・stack（`title` 属性に fullstack を全文格納）・listener 本体（`<pre>`）** を表示する。
```javascript
function listListeners(listeners) {
	var x = document.getElementById('x');
	x.parentElement.removeChild(x);
	x = document.createElement('ol');
	x.id = 'x';
	document.getElementById('h').innerText = listeners.length ? listeners[0].parent_url : '';

	for(var i = 0; i < listeners.length; i++) {
		listener = listeners[i]
		el = document.createElement('li');

		bel = document.createElement('b');
		bel.innerText = listener.domain + ' ';
		win = document.createElement('code');
		win.innerText = ' ' + (listener.window ? listener.window + ' ' : '') + (listener.hops && listener.hops.length ? listener.hops : '');
		el.appendChild(bel);
		el.appendChild(win);

		sel = document.createElement('span');
		if(listener.fullstack) sel.setAttribute('title', listener.fullstack.join("\n\n"));
		seltxt = document.createTextNode(listener.stack);
		
		sel.appendChild(seltxt);
		el.appendChild(sel);

		pel = document.createElement('pre');
		pel.innerText = listener.listener;
		el.appendChild(pel);

		x.appendChild(el);
	}
	document.getElementById('content').appendChild(x);
}
```

#### 5.13 オプション画面 — options.js / options.html（逐語・要点）
`chrome.storage.sync` に **Log-URL** を保存／復元する。
```javascript
function save_options() {
	var log_url = document.getElementById('log-url').value;
	chrome.storage.sync.set({
		log_url: log_url.length > 0?log_url:''
	}, function() {
		var status = document.getElementById('status');
		status.textContent = 'Options saved.';
		setTimeout(function() {
			status.textContent = '';
			window.close();
		}, 750);
	});
}
```
options.html の主要 UI（逐語）:
```html
	<div id="options">
		Log-URL:
		<input type="text" id="log-url" size="40" />
		<button id="save">Save</button>
		<div id="status"></div>
	</div>
```

---

### 6. postMessage-tracker のインストールと使い方 （出典: README ＋実装から再構成）

インストール（README には明示手順がないが、Manifest V2 の非ストア拡張のため一般的手順）:
〔補足（一般知識）〕
1. リポジトリを取得（`git clone https://github.com/fransr/postMessage-tracker` など）。
2. Chrome で `chrome://extensions` を開き、右上の **Developer mode（デベロッパーモード）** を ON。
3. **Load unpacked（パッケージ化されていない拡張機能を読み込む）** をクリックし、リポジトリ内の **`chrome/`** ディレクトリを選択する（`manifest.json` がここにある）。

使い方（README ＋実装より）:
- 対象ページを開くと、拡張アイコンの **バッジ** に現在タブの message リスナ数が表示される（0 超で赤）。
- アイコン（browser_action ポップアップ）をクリックすると、各リスナの **domain / window・hops / スタック上の登録位置（マウスオーバーで fullstack 全文）/ リスナ関数本体** が一覧表示される。
- **コンソール** には、ウィンドウ間で流れる message が `送信元hops → 受信先hops [portN] data`（data はオブジェクトなら `j ` + JSON）の色分け形式で表示される。表示された hops（例 `top.frames[0]`）はそのまま自分で **replay（`win.postMessage(...)`）** に使えるパス。
- 別ウィンドウ由来は `diffwin` と表示され、`diffwin` を送受信の指標に通信を追える。
- `chrome://extensions` の拡張オプションで **Log-URL** を設定すると、検出した全リスナ情報（listener 本体・関数・stack など）が JSON で当該 URL に POST され、短時間だけ有効な隠れリスナも後から精査できる。
- Raven / New Relic / Rollbar / Bugsnag / Sentry / jQuery のラッパは自動でアンパックされ、コンソール／ポップアップに **本物のリスナ** が出る。匿名関数は `bound ...` と表示される。

---

### 7. DOM Invader と postMessage-tracker の使い分け（ハンティング手順）

〔補足（一般知識・両資料の統合）〕クライアントサイドの postMessage 脆弱性ハンティングは概ね次の流れになる。両ツールは相補的:
1. **リスナ列挙**: postMessage-tracker（バッジ＋ポップアップ＋Log URL）で、サブフレーム・短命・操作起動を含む message リスナと登録位置（スタック）を洗い出す。DevTools の `getEventListeners(window)` や Elements ➜ Event Listeners、コードの `window.addEventListener('message', ...)` / `$(window).on(...)` 検索も併用。
2. **origin 検証の甘さ確認**: DOM Invader の **Spoof origin**（origin をドメイン名で挟んだ偽 origin に置換）で、`indexOf()`/`search()`/`match()` などの緩い検証・正規表現の欠陥を自動検出。`event.isTrusted` を認可に使う実装は無意味（送信元の正当性を保証しない）。
3. **data → sink の追跡**: DOM Invader のメッセージ詳細で、ハンドラが `data` を参照し innerHTML 等の sink に渡すかを確認。**Auto-inject canary** / **Auto-mutate** で自動的に sink 到達可否を探る。
4. **PoC 作成・再送**: DOM Invader で `Data` を sink 種別に合わせ編集し **Send**。postMessage-tracker のコンソールに出た hops パスで手動 replay も可能。`<iframe onload="this.contentWindow.postMessage('javascript:print()//http:','*')">` のように substring チェックを突破する例、`window.open()`＋`postMessage`（+ setTimeout）で X-Frame-Options/CSP frame-ancestors のフレーム化防御を回避する例などを、許可された検証範囲で用いる。

---

## 読者が自分で開くべき資料

### A. PortSwigger 公式「Testing for DOM XSS using web messages」（本ノートの主対象・**本文は公式ミラーから full 取得済み**／原サイトは遮断のまま）
- 原典 URL（本セッションからは遮断）: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages
- **なぜ原サイトを自動取得できないか**: 本セッションの組織 egress ポリシーにより **portswigger.net が恒久遮断**（WebFetch=EGRESS_BLOCKED、curl=CONNECT 403、web.archive.org / r.jina.ai / Google キャッシュも同様に 403）。WebSearch も本セッションでは予算枯渇（200/200）。
- **本工程で用いた到達可能な代替アクセス（読者もこの手で原文テキストを読める）**:
  - 英語・公式ドキュメント丸ごとミラー（GitHub raw、到達可）:
    - 本ページ: `https://raw.githubusercontent.com/1tbfree/BurpSuitePro-SourceLeak/main/resources/Documentation/burp/documentation/desktop/tools/dom-invader/web-messages.html`
    - 設定ページ: 同 repo `.../dom-invader/settings/web-messages.html`
    - テスト手順版: 同 repo `.../testing-workflow/input-validation/xss/web-message-dom-xss.html`
    - DOM Invader 拡張の実 UI ソース（列見出し・ボタン名の一次資料）: 同 repo `resources/Browser/ChromiumExtension/dom-invader-extension/panels/postmessage.html`
  - 日本語・公式翻訳ミラー（GitHub raw、到達可）: `https://raw.githubusercontent.com/ankokuty/burp-resources-ja/master/Documentation/burp/documentation/desktop/tools/dom-invader/web-messages.html`（および `.../settings/web-messages.html`）
  - ※これらは第三者リポジトリのため、**最新性・改変有無は原典で要確認**。本ノートは取得時点の内容で裏取り済み。
- **読みどころ（原典または上記ミラーで確認すべき点）**:
  1. **スクリーンショット画像**（Messages ビュー／詳細ダイアログの実表示）。HTML テキストはミラーで読めるが**画像だけは目視が必要**。
  2. **Automated web message analysis** の Severity/Confidence フラグ表示の実際（§2.5(3) で確定済み、見た目の確認）。
  3. **Build PoC** ボタンの実操作と、生成される HTML PoC の中身（§2.5(7)）。
  4. innerHTML sink を例にした `<`・`>`・`"` エスケープ確認 → PoC 作成の具体例。
  5. 関連ラボ「Lab: DOM XSS using web messages」（https://portswigger.net/web-security/dom-based/controlling-the-web-message-source/lab-dom-xss-using-web-messages ）と、公式が張る Web Security Academy の関連トピック「Controlling the web message source」「Bypassing flawed origin validation」での実践。
- 併読すべき公式ページ（原典 URL。テキストは上記 GitHub ミラーで取得可）:
  - Web message settings: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/web-messages （**現行の正式設定名**は §3.5 参照＝Postmessage origin spoofing／Canary injection into intercepted messages／Filter messages with duplicate values／Generate automated messages／Detect cross-domain leaks）
  - Testing workflow 版: https://portswigger.net/burp/documentation/desktop/testing-workflow/input-validation/xss/web-message-dom-xss
  - 導入ブログ: https://portswigger.net/blog/introducing-dom-invader

### B. postMessage-tracker（GitHub・原文は full 取得済み、ただし要確認事項あり）
- URL: https://github.com/fransr/postMessage-tracker
- 取得状況: github.com 本体は 403 だが raw.githubusercontent.com 経由で README・全ソースを取得済み。**README 中の画像（listener-uber.png, console.png, before/after 各種, options.png, anonymous.png）はバイナリのため未取得**。
- 読みどころ（自分でアクセスしたとき）:
  1. README 画像で、実際のバッジ／ポップアップ／コンソール表示・New Relic・jQuery の before/after を目で確認。
  2. 講演動画 https://www.youtube.com/watch?v=oJCCOnF25JU とスライド https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies （設計思想と実戦例）。
  3. `chrome/content_script.js` の最新版（本ノートは master 時点。ラッパ判定正規表現やフック対象が更新される可能性）。
  4. `chrome/manifest.json`（Manifest V2。MV3 化やパーミッション変更の有無）。

### C. 補完に使った関連資料（読者の追加学習に有用）
- HackTricks DOM Invader: https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html
- HackTricks PostMessage Vulnerabilities: postMessage-tracker / Posta（https://github.com/benso-io/posta ）をリスナ列挙ツールとして紹介。origin 検証バイパス（indexOf/search/match、`document.domain`、sandbox iframe の `null==null`、`e.source` の null 化）、substring スキームチェック突破、フレーム化防御回避などの実例が豊富。
