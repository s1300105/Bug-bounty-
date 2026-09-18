# DOM Invader の Web メッセージ機能と postMessage-tracker で postMessage 脆弱性を狩る

> **この節で分かること**
> - `window.postMessage()`（Web メッセージ）がなぜ危険になり得るのか、DOM Invader の Messages ビューがそれをどうログ化・編集・再送するのかを説明できる。
> - メッセージ詳細ダイアログの `origin` / `data` / `source` アクセスインジケータを読んで、受信側ハンドラの origin 検証の甘さと、データがどの sink へ流れるかを判断できる。
> - Web メッセージ設定の現行5項目（origin 偽装・canary 注入・重複フィルタ・自動生成・クロスドメインリーク検出）を使い分けられる。
> - Severity/Confidence の自動フラグと **Build PoC** ボタンを使って、発見した脆弱性を HTML の PoC まで持っていける。
> - postMessage-tracker 拡張がどのようにリスナを列挙・アンパックし、Log URL で外部へ送るのかを説明でき、両ツールを組み合わせて postMessage 脆弱性を自力で狩る手順を実行できる。

**元資料**:
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages
- https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/web-messages
- https://github.com/fransr/postMessage-tracker

PortSwigger 公式ページ（上2件）は、本教科書の執筆環境からは `portswigger.net` が組織の egress プロキシで恒久遮断されているため**直接は取得できなかった**。そこで同一内容の公式 HTML を、GitHub 上の公式ドキュメント丸ごとミラー（`1tbfree/BurpSuitePro-SourceLeak`）および公式日本語翻訳ミラー（`ankokuty/burp-resources-ja`）から full 取得し、さらに DOM Invader 拡張本体の UI ソース（`panels/postmessage.html`）で列見出し・ボタン名を確定した。本文・表・逐語訳はすべてこの公式原文にもとづく。postMessage-tracker（`github.com/fransr/postMessage-tracker`）は `raw.githubusercontent.com` 経由で README と全ソースを**原典取得済み**（画像バイナリのみ未取得）。

**関連する節**: DOM Invader の基本と有効化（DOM Invader メインの節）／DOM XSS の検出（DOM Invader XSS の節）／postMessage 由来 DOM XSS の sink 一覧（sink の節）。本節はそれらの前提の上に「Web メッセージ（postMessage）」だけを深掘りする。

> 注意: 本節の攻撃手法は、**許可された診断・バグバウンティ・自分で立てた検証環境**を前提とした、防御／検出のための技術解説である。無許可の対象に用いてはならない。

---

## 1. なぜ postMessage を狙うのか — Web メッセージと DOM Invader の位置づけ

### Web メッセージ（postMessage）とは

Web メッセージ（Web Messages）とは、ブラウザの中で**異なるウィンドウやフレーム同士がデータをやり取りするための仕組み**のこと。送る側は `window.postMessage()` というメソッドを呼び、受け取る側は `message` イベントのリスナ（`addEventListener('message', ...)` や `window.onmessage = ...`）で受け取る。たとえば、親ページと `iframe`（ページの中に埋め込まれた別のページ）が、広告・チャットウィジェット・決済フォームなどのために通信するときに使われる。

`iframe` とは、ある Web ページの中に別の Web ページを窓のように埋め込むための HTML 要素（`<iframe src="...">`）のこと。

### なぜ postMessage が脆弱性の温床になるのか（設計意図）

通常、ブラウザには**同一オリジンポリシー（Same-Origin Policy, SOP）**という壁がある。SOP とは、あるオリジン（スキーム＋ホスト＋ポートの組。たとえば `https://example.com`）のページは、別オリジンのページのデータに勝手に触れない、という安全のための基本ルールのこと。ところが正当な用途として「別オリジンと意図的に通信したい」場面はある。そこで**オリジンの壁を越えてメッセージを送るために設計された正規の抜け道**が postMessage である。

抜け道である以上、安全に使うには受信側が2つの責任を果たさねばならない。第一に「**誰から来たメッセージか**」を `event.origin` で必ず検証すること。第二に「**送られてきたデータ**」（`event.data`）を無検証で危険な処理に渡さないこと。この2つのどちらかを怠ると、攻撃者は自分が用意したページ（多くは被害ページを `iframe` に埋め込んだもの）から任意のメッセージを送り込める。origin 検証が甘ければ「他人からのメッセージ」を「身内からのメッセージ」と誤認させられ、`data` の扱いが甘ければそのデータが DOM XSS などの脆弱性に直結する。

DOM XSS（DOM-based Cross-Site Scripting）とは、サーバを介さず、ブラウザ内の JavaScript が攻撃者の制御下にあるデータ（source）を危険な出力先（sink）にそのまま渡してしまうことで起きるスクリプト実行のこと。postMessage の `event.data` は代表的な source の1つである。

### DOM Invader の Web メッセージ機能の位置づけ

DOM Invader は、Burp Suite の内蔵 Chromium ブラウザに同梱されるブラウザツールで、JavaScript の source と sink を自動計装して DOM XSS 等の検出を支援する（有効化や基本操作は DOM Invader メインの節を参照）。その中の **Web メッセージ（Messages）機能**は、ページ上で `postMessage()` によって送受信される Web メッセージを**すべてログ化**し、Burp Proxy が HTTP 履歴を一覧表示するのと同じように並べて見せる。

さらに各メッセージは**編集して再送（modify and resend）**できる。これは Burp Repeater が改変した HTTP リクエストを再発行するのと同じ発想で、Web メッセージに対する手動プロービング（探り）を可能にする。つまり Web メッセージ機能は、**postMessage 版の Proxy 履歴＋Repeater** だと考えるとよい。

```
HTTP の世界                     Web メッセージの世界
------------------------        ------------------------
Proxy の HTTP 履歴          ⇔   Messages ビュー（全 postMessage をログ）
Repeater（改変して再送）    ⇔   メッセージ詳細ダイアログ（Data 編集 → Send）
```

---

## 2. Web メッセージ機能の3本柱と有効化

### 機能の3本柱（公式原文）

公式ページ「**Testing for DOM XSS using web messages**」は、この機能が提供するものを次の3つとして説明している。

1. **ページ上で `postMessage()` により送られる任意の Web メッセージを、有用な詳細情報とともにログ化する**（Burp Proxy が HTTP 履歴を表示するのと同様）。
2. **Web メッセージを編集・再送して DOM XSS を手動でプロービングできる**（Burp Repeater が改変 HTTP リクエストを再発行するのと同様）。
3. **DOM Invader が代わりに Web メッセージを自動改変・送信して DOM XSS を探る**。

これらはすべて **DOM Invader の Messages ビュー**からアクセスする。使う前に、まず設定メニューから **Postmessage interception（postmessage 傍受）を有効化**する必要がある。

### なぜ既定で無効なのか、そして有効化手順

対象サイトの機能への干渉を避けるため、DOM Invader の Web メッセージ機能は**既定で無効**になっている。攻撃者視点では便利でも、傍受・自動送信は正規のページ動作を壊しかねないからだ。有効化は次の手順で行う（公式手順の逐語）。

1. **DOM Invader 設定メニュー**へ行く。
2. **Postmessage interception スイッチ**を選択する。
3. **Reload をクリック**してブラウザを再読み込みする（変更を反映するために必須）。

3番の「Reload が必須」を忘れると、傍受フックがページに注入されず、メッセージが1件も出ないことがある。

### Messages ビューの開き方

1. DevTools（開発者ツール）の **DOM Invader** タブを選択する。
2. 右側パネルから **Messages** を選択する。
3. 記録された Web メッセージの一覧が表示される。

DevTools とは、ブラウザに組み込まれた開発者向けの検査ツール（`F12` で開く）のこと。DOM Invader は有効化するとこの DevTools の中に独自パネルを追加する。

---

## 3. Messages ビューの一覧と列

### 列の見た目（拡張 UI ソースで確定）

Messages の一覧テーブルは、DOM Invader 拡張の実 UI ソース（`panels/postmessage.html`）で次の列見出しを持つことが確認できる。

| 列 | 内容 |
| --- | --- |
| `ID` | ログ済みメッセージの数値 ID。後述のとおり、DOM Invader が自動生成したメッセージには ID が付かず**空欄**になる。 |
| `Type` | メッセージ種別。 |
| `Origin` | メッセージの origin。 |
| `Data` | メッセージのデータ（ペイロード）。 |
| `From frame` | 送信元のフレーム（`top`, `top.frames[0]` 形式）。 |
| `To frame` | 宛先のフレーム。 |
| `Stack trace` | このメッセージに関係する JS のスタックトレース（呼び出し履歴）。 |

一覧の上部には **Search / Search for Canary / Clear all** の操作があり、メッセージが1件も無いときは **(No messages)** と表示される。`Search for Canary` は、DOM Invader が注入した canary（後述の目印文字列）を含むメッセージだけを絞り込むのに使える。

### DOM Invader が自動生成したメッセージの見分け方

Web メッセージ傍受を有効化すると、DOM Invader は `postMessage()` で送られるメッセージを自動ログするだけでなく、**既定で、検出した message イベントハンドラに対して自分自身のメッセージを生成・送信する**。この「自分で作ったメッセージ」と「ページが本当に送ったメッセージ」を混同すると診断を誤る。

区別は簡単で、**ログされたメッセージには数値 ID が付くが、DOM Invader が生成したメッセージは Messages ビューで数値 ID を持たない**（ID 列が空欄）。つまり ID 欄を見れば、それが実サイトのトラフィックか、ツールが打ち込んだ探りかが分かる。

---

## 4. メッセージ詳細ダイアログ（Replay Postmessage）

Messages ビューの任意のメッセージをクリック（ダブルクリック）すると、**Replay Postmessage** という詳細ダイアログが開く。ここが postMessage 版の Repeater にあたる中心画面である。

### ダイアログの全フィールド（拡張 UI ソースで確定）

拡張の実ソースから、このダイアログが持つ要素は次のとおり。

| 要素 | 役割 |
| --- | --- |
| **Spoof origin** チェックボックス | この1メッセージだけに origin 偽装を適用する。 |
| **Origin** 入力フィールド | origin を手動で書き換える。 |
| **Data** 入力フィールド | ペイロード（`event.data`）を編集する。ここに sink を突くエクスプロイトを書く。 |
| **Show** ドロップダウン | **Original data ↔ Manipulated data** を切り替え、ページが送った原データと、canary 自動注入後のデータを見比べる。 |
| **Message type** 表示 | DOM Invader が推定したデータ形式。`json-object` / `json-string` / `string` のいずれか。 |
| **Severity** / **Confidence** 表示 | DOM Invader が推定した重大度・確信度（後述）。 |
| **Origin accessed** / **Data accessed** / **Source accessed** | 受信側 JS が各プロパティに実際に触れたかを示すインジケータ。 |
| **Title** / **SINK** / **Description** | 説明テンプレート。例文: 「Web message data is being sent via ORIGINAL ORIGIN to origin ORIGIN from a postMessage request.」「This event listener {does/does not} check the origin before accessing data.」 |
| 下部ボタン | **Close** ／ **Log** ／ **Stack trace** ／ **Build PoC** ／ **Send (CTRL+Enter)** |

自動生成メッセージを開いた場合は「This message was automatically generated by DOM Invader.」の注記が出る。スタックトレースは「Press escape to open the console or click to the console tab to view the stack trace」の導線でコンソールに表示できる。

### origin / data / source アクセスインジケータの読み方（攻撃者はどこを突くか）

このダイアログの核心は、受信側の JavaScript（`message` ハンドラ）が、そのメッセージの `origin` / `data` / `source` のどれに**触れたか**を教えてくれる点にある。これは受信側コードの検証の甘さを外から推し量る指標になる。

| プロパティ | インジケータ | 意味と診断上の含意 |
| --- | --- | --- |
| **`origin`** | Origin accessed | クライアントコードが `origin` に**一度も触れていなければ、origin 検証をしていない可能性が高い**。その場合、任意の外部ドメインからクロスオリジンでハンドラにメッセージを送り込める。触れていても、正規表現や文字列一致のロジックが甘ければ回避の余地がある。回避策を探すため、DOM Invader は**スタックトレース経由で該当コード行へのリンク**を提供する。 |
| **`data`** | Data accessed | `data` は**ペイロードの投入先**。JS がこのプロパティに触れなければ、データは sink に渡り得ず、そのメッセージは攻撃に**無関係**（利用価値がない）と判断できる。 |
| **`source`** | Source accessed | `source` は送信元 window オブジェクトへの参照（通常は `iframe`）。サイトは origin より堅牢な手段として `source` を検証することがある。ただし触れていても、検証を回避できないとは限らない。 |

`event.source` を使う検証（送ってきた window オブジェクトそのものを見る）は、文字列の origin 比較より偽装しにくい。したがってインジケータで `Source accessed` が立っていれば、単純な origin 偽装だけでは通らない可能性を疑う。逆に `Origin accessed` が立っていない listener は、**origin 無検証**の第一候補として最優先で調べる価値がある。

### メッセージの編集と再送（公式手順）

1. **Messages ビュー**で任意のメッセージをクリックし、メッセージ詳細ダイアログを開く。
2. **Data フィールド**を必要に応じて編集する。
3. **Send** をクリックする（`CTRL+Enter` でも送信できる）。

公式の代表例はこうだ。origin を検証せず `data` を `element.innerHTML` という sink に渡すメッセージを特定したとする。`element.innerHTML` は、渡した文字列を HTML として解釈して描画する典型的な危険 sink である。まず `<`・`>`・`"` の各文字がエスケープ（無害化）されるかどうかを、それらの文字を含むメッセージを送って確認する。エスケープされないなら、それらの文字を使って PoC ペイロードを作成・送信する。

〔補足〕postMessage 経由 DOM XSS の代表的な sink には、`element.innerHTML`・`document.write`・`eval`・`location` / `location.href`・`setTimeout`（文字列引数）・`Function` などがある。origin 検証の甘い listener が `event.data` をこれらに渡していれば、外部オリジンからの postMessage だけで任意スクリプト実行に繋がり得る（各 sink の詳細は sink の節を参照）。

---

## 5. Automated web message analysis（自動フラグ付け）

DOM Invader の強みは、ただログするだけでなく「**面白い（悪用できそうな）メッセージ**」を自動で見分けてくれる点にある。公式原文によれば、有効化後 DOM Invader は自動ログに加えて、**既定でメッセージを次の2通りに改変**して自動判定する。

1. **メッセージの `data` プロパティに canary を注入**し、そのデータが流れ込む sink を（DOM view と同様に）特定する。canary（カナリア）とは、注入した文字列がどこに出てくるかを追跡するための、一意で目立つ目印文字列のこと。たとえば注入した canary が `innerHTML` に到達すれば、その経路が sink に繋がっていると分かる。
2. **メッセージの origin を、期待ドメイン名で始まりかつ終わる偽 origin に置換**し、origin 検証ロジックや正規表現に欠陥のあるハンドラを自動特定する。

観測した挙動にもとづき、DOM Invader は**悪用可能と判断したメッセージに、推定 Issue Severity（重大度）と Confidence（確信度）を表示してフラグ付けする**。重要なのは、**ページ上で送られた全メッセージは、DOM Invader が自動検出できない脆弱性を含み得るため、少なくとも Information 重大度で一覧される**という点だ。つまり「Information だから安全」ではなく、「自動判定が引っかからなかっただけ」であり、手動で調べる価値は残っている。

この2つの自動改変（canary 注入・偽 origin 置換）は、次節の設定メニューから個別に無効化できる。ページの正規動作を壊したくないときや、ノイズを減らしたいときに切る。

### PoC 生成 ＝ Build PoC ボタン

悪用可能な脆弱性を Web メッセージで特定できたら、DOM Invader は**レポートに載せられる HTML の PoC を生成できる**。手順は次のとおり。

1. 脆弱なメッセージを選択してメッセージ詳細ダイアログを開く。
2. エクスプロイトに必要な値へ改変する（Data フィールド等）。
3. **Build PoC をクリック**する。**HTML がクリップボードに保存される**。

つまり「値を改変する」だけでは PoC は出ない。専用の **Build PoC ボタン**が、被害ページに postMessage を送る HTML を組み立ててクリップボードにコピーしてくれる。バグバウンティの報告では、この生成 HTML をそのまま再現手順として添付できる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Testing for DOM XSS using web messages / Web message settings（PortSwigger 公式）— https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages と https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/web-messages
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `portswigger.net` が組織の egress プロキシで恒久遮断され、`WebFetch` は EGRESS_BLOCKED、`curl` も 403 になる。Web アーカイブやキャッシュも同様に遮断）。本文テキストは公式ドキュメントの GitHub ミラーから逐語取得したが、**Messages ビューや詳細ダイアログの実スクリーンショット（画像）だけはミラーにも無く、目視が必要**である。
> **読みどころ**:
> 1. Messages ビュー／Replay Postmessage ダイアログの**実スクリーンショット**。列やボタンが画面上でどう並ぶかを目で確認する。
> 2. **Automated web message analysis** の節で、Severity/Confidence フラグが実際にどう表示されるか。
> 3. **Build PoC** ボタンで生成される HTML PoC の中身。自分の検証環境で1回押して、出力 HTML を読む。
> 4. `innerHTML` sink を例にした `<`・`>`・`"` のエスケープ確認 → PoC 作成の具体例。
> 5. 関連ラボ「Lab: DOM XSS using web messages」（https://portswigger.net/web-security/dom-based/controlling-the-web-message-source/lab-dom-xss-using-web-messages ）と、公式が張る Web Security Academy トピック「Controlling the web message source」「Bypassing flawed origin validation」で手を動かす。
> **代替手段**: 本文テキストと同一内容が GitHub raw ミラーで読める。英語版は `https://raw.githubusercontent.com/1tbfree/BurpSuitePro-SourceLeak/main/resources/Documentation/burp/documentation/desktop/tools/dom-invader/web-messages.html`（設定は同 repo の `.../settings/web-messages.html`）、日本語版は `https://raw.githubusercontent.com/ankokuty/burp-resources-ja/master/Documentation/burp/documentation/desktop/tools/dom-invader/web-messages.html`。第三者リポジトリのため最新性は原典で要確認。

---

## 6. Web メッセージ設定（cog アイコン）— 現行の5項目

Messages ビューの **Postmessage interception** オプションの隣にある **cog（歯車）アイコン**をクリックすると、Web メッセージ取り扱い時の DOM Invader の挙動を微調整する設定が開く。公式の現行 `settings/web-messages` ページに**実在する設定は次の5つのみ**である。

| 現行の公式ラベル（英／日） | 有効時の挙動 |
| --- | --- |
| **Postmessage origin spoofing**／Postmessage のオリジン偽装 | 送信される任意メッセージの origin を、**本来の origin のドメイン名で始まりかつ終わる偽 origin に自動置換**する。`startsWith()` / `endsWith()` などでドメイン名を検証するハンドラはこの手法で簡単に回避され得るため、そうした**欠陥ロジック／正規表現を持つハンドラを自動特定**できる。無効時でも、再送時に **Spoof origin チェックボックス**を選ぶか、**Origin 入力フィールドで手動置換**すれば個別に偽装できる。 |
| **Canary injection into intercepted messages**／インターセプトしたメッセージへカナリアを挿入 | ページ上で送られる任意メッセージの `data` に **canary を自動注入**する。期待データが **JSON 文字列／JSON オブジェクト／プレーン文字列**のどれかを判定し、正しい形式で注入する。詳細ダイアログの **Show ドロップダウン**で、原データと自動注入後データを切り替えて見比べられる。 |
| **Filter messages with duplicate values**／重複する値を持つメッセージのフィルタリング | 同一メッセージをグループ化してノイズを減らす。全メッセージを個別に見たい（＝実際に何度送信されているか確認したい）場合は無効化する。 |
| **Generate automated messages**／自動メッセージの生成 | 発見した任意の message イベントリスナへ**自ら生成したメッセージを送信**する。通常のページ操作ではイベントを起こせない脆弱ハンドラのテストに有用。各ハンドラが期待するデータ構造を推測して適切なメッセージを生成し、リスナの処理挙動に応じて**より危険な sink へ到達する追加コードパスを狙った後続メッセージ**も生成する。**生成メッセージは Messages ビューで数値 ID を持たない**ため判別できる。 |
| **Detect cross-domain leaks**／クロスドメインリークの検出 | **現在のページが URL 由来のデータを含む Web メッセージを、現在ページとは異なる origin 宛てに送信したときにレポート**する。これは DOM XSS ではなく**クロスドメイン情報漏えい**の検出機能である（後述）。 |

### 「Generate automated messages（メッセージ生成）」の仕組み

この設定が有効なとき、DOM Invader はページ上で特定した**任意の message イベントリスナに対して、自ら生成したメッセージを送信**する。これは、脆弱かもしれないハンドラをテストしたいのに、通常のページ操作では `message` イベントをトリガできない場合に有用だ。

DOM Invader は、各ハンドラが期待しているデータ構造を推測し、その情報で適切なメッセージを生成・送信する。さらにリスナが各メッセージをどう処理したかに応じて、**追加のコードパスに到達するよう調整した後続メッセージ**（さらに危険な sink に届き得る）を生成できる。手で総当たりするのが難しい深いコードパスを、ツールに探させられるということだ。

### Detect cross-domain leaks — DOM XSS ではなく情報漏えいの検出

この項目だけは他の4つと毛色が違う。有効時、DOM Invader は「現在のページが、**URL 由来のデータ**（クエリ文字列やフラグメントなど）を含む Web メッセージを、**現在ページとは別の origin 宛てに送った**」ことを検出してレポートする。

なぜ危険か。攻撃者は、そのデータを抽出するイベントリスナを仕込んだ自分のページを用意し、**被害ページを `iframe` に埋め込む**。すると被害ページが「URL の中の機密情報」を外部 origin へ postMessage したとき、攻撃者のリスナがそれを受け取れてしまう。典型的には **OAuth トークン**（サービス間の認可に使う一時的な資格情報）のような機密が、この経路で盗まれ得る。DOM XSS のようなスクリプト実行ではなく、**クロスドメインでの機密データ漏えい**を狙う機能だと理解しておく。

### 〔要注意〕過去の記述に出てくる設定名について

古い二次情報（HackTricks や検索スニペット）には「**Filter by stack trace（スタックトレースでフィルタ）**」「**Auto-fire events（イベント自動発火）**」という設定が Web メッセージ設定として載っていることがある。しかし現行の公式 `settings/web-messages` ページに**この2つは存在しない**（旧バージョンの名残か、DOM view 側／その他設定の別項目に由来する可能性が高く、要検証扱い）。教科書としては、上の5項目を正典とし、この2つは「現行の Web メッセージ設定には無い」と押さえておく。

### 〔補足〕どう守るか（防御・検出）

DOM Invader が突く弱点は、そのまま防御チェックリストになる。受信側の実装者は次を守るべきである。

- `event.origin` を**完全一致で**検証する（許可オリジンを配列で持ち `===` で比較）。`indexOf()` / `startsWith()` / `endsWith()` / `search()` / `match()` による部分一致や緩い正規表現は使わない（偽 origin 偽装に破られる）。
- `event.data` は**信頼できない入力**として扱い、`innerHTML` などの sink に渡す前に検証・無害化する。可能なら構造化データとして厳格にパースする。
- 送信側は `postMessage(data, targetOrigin)` の `targetOrigin` に `'*'`（誰でも可）を使わず、宛先オリジンを明示する。これは Detect cross-domain leaks が狙う漏えいの直接の対策になる。
- 検出側（ブルーチーム）は、`Detect cross-domain leaks` のような観点で「URL 由来データが外部 origin へ postMessage されていないか」を定期診断する。

---

## 7. postMessage-tracker 拡張の概要

DOM Invader が「メッセージそのもの」を扱うのに対し、**postMessage-tracker** は「**どんなリスナが登録されているか**」を洗い出すことに特化した別ツールである。両者は相補的で、実務では組み合わせて使う。

### 何者か

- 作者は **Frans Rosén**（@fransrosen）。
- 2018年の OWASP AppSec Europe 講演「Attacking modern web technologies」（動画 https://www.youtube.com/watch?v=oJCCOnF25JU 、スライド https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies ）で発表され、**2020年5月に公開**された。
- 実体は **Chrome 拡張**で、現在のウィンドウに登録された postMessage リスナを監視し、**リスナ数のインジケータ（バッジ）**をアイコンに表示する。

### 主な特徴（README 逐語要点）

- **ウィンドウの全サブフレームのリスナ追跡**をサポートする。
- **短命なリスナ（short-lived listeners）**や、**操作（interaction）によって有効化されるリスナ**も追跡する。ページ読み込み直後に一瞬だけ登録されて消えるリスナや、クリックして初めて付くリスナも捕まえられる。
- **Log URL オプション**を使えば、各リスナ関数とその位置をログして後で見返せる。これにより**`iframe` 内で短時間だけ有効化される隠れたリスナ**を発見できる。
- ウィンドウ間の相互作用をコンソールに表示し、**自分で replay（再送）に使えるパス**でウィンドウを特定する（例: `top.frames[0]` 形式。後述）。
- コンソールで **`diffwin`** を送信元／受信先の指標に使い、別ウィンドウ間で起きる通信も追える。

### ラッパの「アンパック」対応

現実のサイトは、`message` リスナをエラー監視ライブラリで包んでいることが多い。すると DevTools でリスナを見ても、ライブラリのラッパ関数しか見えず、本物のハンドラが分からない。postMessage-tracker は **Raven / New Relic / Rollbar / Bugsnag / Sentry / jQuery** のラッパをサポートし、それらを「アンパック」して**本物のリスナ**を見せる。

- ラッパをバイパス・再ルートし、DevTools コンソールが適切なリスナを表示するよう試みる（README には New Relic / jQuery の before/after スクリーンショットがある）。
- **Log URL** は拡張のオプション画面で設定でき、各リスナに関する全情報（リスナと関数）を送ることで、後から全リスナを見返せる。
- **匿名関数（anonymous functions）**もサポートする。Chrome は匿名関数を文字列化できないため、匿名関数の場合はリスナとして `bound`（`bound ...`）文字列が表示される。

### 既知の問題（Known issues）

一部のサイトは XHTML 名前空間を持つ XML として配信される。この場合、拡張がプレーンな XML ファイルにも自身を付加し、XML の先頭にレンダリングされて混乱を招くことがあった。現在は、Chrome が XML をレンダリングして `document.contentType` が `application/xml` になる場合、コンテンツスクリプトを DOM に追加しないよう修正済みである。

---

## 8. postMessage-tracker の内部実装（仕組み）

ここが本節の技術的な核心である。postMessage-tracker のソースを読むと、「ブラウザのどこをフックすればリスナを漏れなく捕まえられるか」という**列挙の設計思想**が分かる。それはそのまま、自分でリスナを探すときの着眼点になる。

### 8.1 マニフェスト（chrome/manifest.json）

拡張は **Manifest V2** の Chrome 拡張である（Manifest V2 とは、Chrome 拡張の旧世代の定義フォーマット。バックグラウンドを常駐スクリプトで書ける）。`<all_urls>`（全 URL）に対し `run_at: document_start`（ページ読み込みの最初期）かつ `all_frames: true`（全フレーム）で `content_script.js` を注入する。

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

`run_at: document_start` と `all_frames: true` が重要だ。リスナは早い段階で登録されるので、**ページより先に**フックを仕込まないと登録を捕まえ損なう。だから最初期・全フレームに注入する。permissions は `tabs`, `storage`, `http://*/`, `https://*/`。

### 8.2 何をフックするのか（設計思想）

コンテンツスクリプト（content script、拡張がページに注入する JS）の冒頭コメントに、フックの意図が明記されている（逐語）。

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

フック対象を表にすると次のとおり。「リスナはこの何通りかの方法で登録される」という知識自体が、手動でコードを読むときの検索対象になる。

| フック対象 | 何のためか |
| --- | --- |
| `History.prototype.pushState` | pushState による履歴変更を乗っ取り、ページ遷移かフラグメント変更かを判別する（リスナ一覧のリセット判断に使う）。 |
| `Window.prototype.addEventListener` | `type == 'message'` で登録される message ハンドラを捕捉し、登録時にリスナ本体とスタックトレースを記録する。 |
| `window.__defineSetter__('onmessage', ...)` | 旧来の `window.onmessage = ...` によるハンドラ設定を捕捉する。 |
| `MessagePort.prototype.addEventListener` | MessageChannel の port 経由の message も監視する。 |
| `beforeunload` | ページ変更（フラグメント変更／pushState と本当のロケーション変更の区別がつかないため）を追跡する。 |
| jQuery 対応 | リスナ内に `event.dispatch.apply` があれば jQuery のディスパッチャと判断し、スタックの1つ手前の行を採用。さらに `jQuery` を含むグローバルの expando を探し、後から jQuery 経由で追加されるイベントを特定する。 |

prototype（プロトタイプ）とは、JavaScript で同じ種類のオブジェクトが共有する「元となる定義」のこと。`Window.prototype.addEventListener` を書き換えると、そのページのすべての window の `addEventListener` 呼び出しをまとめて横取りできる。

### 8.3 注入方式 — ページの実行コンテキストへ

コンテンツスクリプトは通常「隔離された世界（isolated world）」で動き、ページ側の prototype を直接は書き換えられない。そこで postMessage-tracker は、フック本体である巨大な関数 `injectedJS` を**文字列化し、`<script>` タグとしてページ側に注入**して、ページの実世界で prototype を書き換える。

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

ページ世界と拡張世界は直接は通信できないので、間を **CustomEvent** で橋渡しする。CustomEvent とは、開発者が任意のデータ（`detail`）を載せて発火できる自作イベントのこと。ページ側の注入コードは記録したい情報を `CustomEvent('postMessageTracker', {detail:...})` として `document.dispatchEvent` し、コンテンツスクリプト側がそれを受けて `chrome.runtime.sendMessage` で background に転送する。`document.contentType == 'application/xml'` のときは注入しない（前述の既知の問題対策）。

構造を図にするとこうなる。

```
[ページの実世界]                          [拡張の世界]
injectedJS（prototype を書換）
  addEventListener('message') を横取り
      │ 記録したい情報を載せて
      ▼
  CustomEvent('postMessageTracker')
      document.dispatchEvent  ──────►  content_script.js
                                         document.addEventListener(
                                           'postMessageTracker')
                                             │
                                             ▼
                                         chrome.runtime.sendMessage
                                             │
                                             ▼
                                         background.js
                                         リスナを蓄積・バッジ更新・Log-URL へ POST
```

### 8.4 ウィンドウ経路（hops）の算出 — `h()` 関数

`diffwin`（別ウィンドウ）／`top`／`top.frames[i].frames[j]...` の形で、メッセージの送信元・受信先を**replay に使えるパス文字列**として表す。これがあると、コンソールに出た `top.frames[0]` をそのままコピーして `top.frames[0].postMessage(...)` と手で再送できる。

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

親フレームをたどりながら「自分は親の何番目のフレームか」を求め、`top.frames[x]...` を組み立てる。同じ `top` を共有していない別ウィンドウは `diffwin` になる。

```
top
├─ frames[0]            → "top.frames[0]"
│   └─ frames[1]        → "top.frames[0].frames[1]"
└─ frames[1]            → "top.frames[1]"
別の window（top が違う）→ "diffwin"
```

### 8.5 スタックトレースから登録位置を取る — `l()` 関数

`throw new Error('')` でスタックトレースを取得し、`offset`（既定 3 ＋ ラッパ分の追加オフセット）行目を「リスナの登録位置」として採用する。スタックトレースとは、その時点の関数呼び出しの履歴一覧のこと。jQuery ディスパッチャ検出時は `pattern_before` 正規表現で1つ手前の行を選ぶ。`listener.__postmessagetrackername__`（アンパック済みの本物のリスナ名／匿名時の `bound ...`）があればそれを表示に使う。

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

### 8.6 エラー監視ラッパの判定 — `c()` 関数

リスナの文字列表現を正規表現で照合し、Raven / New Relic / Rollbar / Bugsnag / Sentry / Bugsnag2 のどのラッパかを判定する。判定に使う正規表現・プロパティ名は、そのまま「このサイトは何のエラー監視を使っているか」を示す**指紋**になる。

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

### 8.7 addEventListener フックとアンパック処理（核心）

`type=='message'` の登録を捕捉し、`unwrap()` で各種ラッパを剥がして本物のリスナへ辿り、`l()` で記録する。ラッパ種別ごとに `offset` を増やし、スタックトレースの読み位置を補正しているのがポイントだ。

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
```

`unwrap()` は再帰的にラッパを剥がしていく。剥がすたびに `offset++` することで、最終的にスタックトレースが「開発者が書いた本物のリスナの登録行」を指すよう調整している。最後は元の `addEventListener`（`msgeventlistener`）を呼んで、ページの正規動作は壊さない。

### 8.8 コンソールへのメッセージ可視化 — `onmsg()` / `onmsgport()`

受信した message を、`送信元hops → 受信先hops [port数] data` の形で色分けしてコンソールに出す。`data` はオブジェクトなら `j ` + JSON を付けて表示する。

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

### 8.9 旧式 onmessage setter と pushState フック

`window.onmessage = ...` という古い書き方も、`__defineSetter__` で捕捉する。pushState は「ページ遷移ではない履歴変更」を検知するために記録する。

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

### 8.10 jQuery イベントの回収 — `jqc()`

`Object.getOwnPropertyNames(window)` を走査して名前に `jQuery` を含むグローバルを探し、`_data(window,'events')` や expando（`window[key].expando` → `window[expando + i]`）から登録済みイベントハンドラを取り出して記録する。jQuery で `$(window).on('message', ...)` のように登録されたハンドラも、これで拾える。

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

### 8.11 バッジ・Log URL・履歴管理 — background.js

background スクリプトは、コンテンツスクリプトから来た `msg.listener` をタブ単位で蓄積し、拡張アイコンの**バッジにリスナ数を表示**する（0 より大きければ赤背景）。`log_url` が設定されていれば、各リスナ情報を JSON で POST する。ブラウザ組み込みの `function () { [native code] }` は無視する。

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

`chrome.tabs.onUpdated` / `onActivated` / `onConnect` により、ページ status が `complete` でバッジを更新し、`loading` でリスナ配列を条件付きリセットし、popup からの接続で `tab_listeners` を返す。原文には、pushState/hash 変更時にはリセットしない工夫がコメントで残されている。

### 8.12 ポップアップとオプション画面

popup は background に接続してリスナ一覧を取得し、各リスナについて **domain・window/hops・stack（`title` 属性に fullstack を全文格納）・リスナ本体（`<pre>`）**を表示する。

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

オプション画面は `chrome.storage.sync` に **Log-URL** を保存・復元するだけの単純なものだ。

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

```html
	<div id="options">
		Log-URL:
		<input type="text" id="log-url" size="40" />
		<button id="save">Save</button>
		<div id="status"></div>
	</div>
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: postMessage-tracker（Frans Rosén）— https://github.com/fransr/postMessage-tracker
> **なぜ**: README・全ソースはテキストとして取得できたが、**README 中の画像（バッジ／ポップアップ／コンソール表示や、New Relic・jQuery の before/after スクリーンショット）はバイナリのため未取得**であり、**講演動画とスライドも動画・スライド画像のため自動取得できない**。以下の記述はテキストとソースにもとづく要約である。
> **読みどころ**:
> 1. README の画像で、実際のバッジ／ポップアップ／コンソール表示、New Relic・jQuery の before/after を目で確認する。ラッパのアンパックが「見た目でどう変わるか」を掴む。
> 2. 講演動画（https://www.youtube.com/watch?v=oJCCOnF25JU ）とスライド（https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies ）で、この拡張が生まれた背景（設計思想と実戦例）を学ぶ。
> 3. `chrome/content_script.js` の**最新版**。本節は master 時点のソースにもとづくため、ラッパ判定正規表現やフック対象が更新されている可能性がある。
> 4. `chrome/manifest.json` の**最新版**（本節は Manifest V2。MV3 化やパーミッション変更の有無を確認）。
> **代替手段**: ソース一式は `raw.githubusercontent.com/fransr/postMessage-tracker/master/chrome/...` から個別ファイルとして読める（本節のコードはそこから取得したもの）。動画・スライドに無料の代替は特に無し。

---

## 9. postMessage-tracker のインストールと使い方

### インストール手順

〔補足（一般知識）〕README には明示手順が無いが、Manifest V2 の非ストア拡張なので一般的な手順で読み込む。

1. リポジトリを取得する（`git clone https://github.com/fransr/postMessage-tracker` など）。
2. Chrome で `chrome://extensions` を開き、右上の **Developer mode（デベロッパーモード）** を ON にする。
3. **Load unpacked（パッケージ化されていない拡張機能を読み込む）** をクリックし、リポジトリ内の **`chrome/`** ディレクトリを選ぶ（`manifest.json` がここにある）。

### 使い方（README ＋実装より）

- 対象ページを開くと、拡張アイコンの**バッジ**に現在タブの message リスナ数が表示される（0 超で赤）。
- アイコン（ポップアップ）をクリックすると、各リスナの **domain / window・hops / スタック上の登録位置（マウスオーバーで fullstack 全文）/ リスナ関数本体**が一覧表示される。
- **コンソール**には、ウィンドウ間で流れる message が `送信元hops → 受信先hops [portN] data`（data はオブジェクトなら `j ` + JSON）の色分け形式で表示される。表示された hops（例 `top.frames[0]`）は、そのまま自分で **replay（`win.postMessage(...)`）** に使えるパスである。
- 別ウィンドウ由来は `diffwin` と表示され、`diffwin` を送受信の指標に通信を追える。
- `chrome://extensions` の拡張オプションで **Log-URL** を設定すると、検出した全リスナ情報（listener 本体・関数・stack など）が JSON で当該 URL に POST され、短時間だけ有効な隠れリスナも後から精査できる。
- Raven / New Relic / Rollbar / Bugsnag / Sentry / jQuery のラッパは自動でアンパックされ、コンソール／ポップアップに**本物のリスナ**が出る。匿名関数は `bound ...` と表示される。

〔注意〕**Log-URL には検出した全リスナの情報が送られる**。自分の管理下の受信エンドポイントだけを指定し、第三者サイトのリスナ情報を無関係なサーバへ送らないこと（診断範囲・データ取り扱いの逸脱になり得る）。

---

## 10. 両ツールの使い分け — postMessage 脆弱性ハンティングの手順

〔補足（一般知識・両資料の統合）〕クライアントサイドの postMessage 脆弱性ハンティングは、おおむね次の流れになる。postMessage-tracker（リスナ列挙）と DOM Invader（メッセージ操作）は相補的だ。

### ステップ1: リスナ列挙（postMessage-tracker が主役）

postMessage-tracker のバッジ・ポップアップ・Log URL で、**サブフレーム・短命・操作起動を含む** message リスナと登録位置（スタック）を洗い出す。DevTools の `getEventListeners(window)` や Elements ➜ Event Listeners、ソース中の `window.addEventListener('message', ...)` / `$(window).on(...)` 検索も併用する。ここで「どのフレームに、何を期待するリスナが、どこに登録されているか」の地図を作る。

### ステップ2: origin 検証の甘さ確認（DOM Invader が主役）

DOM Invader の **Postmessage origin spoofing**（origin をドメイン名で挟んだ偽 origin に置換）で、`indexOf()` / `search()` / `match()` などの緩い検証や正規表現の欠陥を自動検出する。詳細ダイアログの `Origin accessed` インジケータで「そもそも origin を見ているか」を確かめる。

〔補足〕`event.isTrusted` を認可の根拠に使う実装は無意味である（`isTrusted` はイベントがユーザ操作由来かを示すだけで、送信元の正当性を保証しない）。origin 無検証・緩い検証のハンドラは最優先の調査対象になる。

### ステップ3: data → sink の追跡（DOM Invader が主役）

DOM Invader のメッセージ詳細で、ハンドラが `data` を参照し `innerHTML` などの sink に渡すかを確認する。`Data accessed` が立っていなければそのメッセージは無関係と切れる。**Canary injection** / **Generate automated messages** を使えば、sink 到達可否とより深いコードパスを自動で探れる。

### ステップ4: PoC 作成・再送

DOM Invader で `Data` を sink 種別に合わせて編集し **Send**、悪用可能なら **Build PoC** で HTML PoC を生成する。postMessage-tracker のコンソールに出た hops パス（例 `top.frames[0]`）を使えば手動 replay もできる。

〔補足〕許可された検証範囲での典型パターンとして、`<iframe onload="this.contentWindow.postMessage('javascript:print()//http:','*')">` のように substring スキームチェックを突破する例や、`window.open()` ＋ `postMessage`（＋ `setTimeout`）で `X-Frame-Options` / CSP `frame-ancestors` によるフレーム化防御を回避してから postMessage を送る例がある。これらは HackTricks の PostMessage Vulnerabilities などにまとまっている。

### どう守るか（各ステップの裏返し）

| 攻撃者が突く点 | 防御・検出 |
| --- | --- |
| origin 無検証・緩い検証（`startsWith`/`indexOf` 等） | 許可オリジンを配列で持ち `event.origin === '...'` の完全一致で検証する。 |
| `event.data` を無検証で sink へ | data を信頼しない入力として検証・無害化し、`innerHTML`/`eval` 等へ直接渡さない。 |
| URL 由来データの外部 origin 送信（トークン漏えい） | 送信側は `postMessage(data, targetOrigin)` の宛先を明示（`'*'` を避ける）。DOM Invader の Detect cross-domain leaks 観点で定期診断する。 |
| フレーム化して被害ページを埋め込む | `X-Frame-Options` / CSP `frame-ancestors` で埋め込みを制限する（ただし `window.open` 経由の回避に注意）。 |

---

## 手を動かす

前提として、Burp Suite の内蔵ブラウザで DOM Invader を有効化しておく（有効化手順は DOM Invader メインの節を参照）。以下は**自分で立てた検証ページ**、または**明示的に許可された対象**でのみ行う。

1. **DOM Invader で Web メッセージ傍受を有効化する。**
   - DOM Invader 設定メニュー ➜ **Postmessage interception** スイッチを ON ➜ **Reload** をクリック。
2. **Messages ビューを開く。**
   - DevTools（`F12`）➜ **DOM Invader** タブ ➜ 右側パネルの **Messages** を選択。ページに postMessage があれば一覧に出る。無ければ **(No messages)**。
3. **自動生成メッセージと実トラフィックを見分ける。**
   - 一覧の `ID` 列を見る。**数値 ID があるものはページ本来のメッセージ、空欄は DOM Invader の自動生成**。
4. **1件クリックして Replay Postmessage ダイアログを開く。**
   - **Origin accessed / Data accessed / Source accessed** を確認する。`Origin accessed` が立っていなければ origin 無検証の可能性が高い（最優先で調査）。
5. **sink への到達を確認する。**
   - **Show** ドロップダウンで **Manipulated data** に切り替え、canary がどこに出るか（`Data accessed` と `SINK` 表示）を見る。
6. **プロービングして PoC を作る。**
   - **Data** フィールドに、まず `<`・`>`・`"` を含む文字列を入れて **Send**。エスケープされなければ PoC ペイロードに差し替えて再送。
   - 悪用可能と確認できたら **Build PoC** をクリック ➜ クリップボードの HTML を検証環境に貼って再現を確認する。
7. **postMessage-tracker でリスナ側を確認する。**
   - `chrome://extensions` ➜ Developer mode ON ➜ **Load unpacked** で `chrome/` を読み込む。
   - 対象ページを開き、アイコンの**バッジ**でリスナ数を確認。アイコンをクリックして各リスナの domain / hops / stack / 本体を読む。
   - 必要ならオプションで **Log-URL**（自分の受信エンドポイント）を設定し、短命リスナも後から精査する。
8. **コンソールの hops で手動 replay する。**
   - コンソールに出た `top.frames[0]` 等をコピーし、`top.frames[0].postMessage('...', '*')` を手で打って挙動を確かめる。

---

## つまずきポイント

- **Postmessage interception を ON にしても Reload を押していない。** 傍受フックはリロードで初めて注入されるため、Reload を忘れるとメッセージが1件も出ない。
- **「Information 重大度だから安全」と誤解する。** 全メッセージは最低でも Information で一覧される。DOM Invader が自動検出できない脆弱性もあるので、手動調査を省いてはいけない。
- **自動生成メッセージを実トラフィックと取り違える。** `ID` が空欄のものは DOM Invader が打ち込んだ探りである。実サイトの挙動を論じるときは数値 ID 付きを見る。
- **古い設定名を探してしまう。** 「Filter by stack trace」「Auto-fire events」は現行の Web メッセージ設定には無い。現行は5項目（origin 偽装・canary 注入・重複フィルタ・自動生成・クロスドメインリーク検出）。
- **Detect cross-domain leaks を DOM XSS 検出と混同する。** これは DOM XSS ではなく、URL 由来データが外部 origin へ漏れる（OAuth トークン窃取等）ことの検出機能である。
- **postMessage-tracker のリスナが 0 に見える。** 短命・操作起動・サブフレームのリスナは一瞬で消える／後から付く。Log-URL を使って記録し続けるか、操作を再現してから確認する。
- **ラッパ関数を本物のリスナと勘違いする。** New Relic / Sentry / jQuery などは message リスナを包む。postMessage-tracker のアンパックや `getEventListeners` の中身をよく見て、実際のハンドラを特定する。
- **`event.isTrusted` を認可根拠にしている実装を「安全」と判断する。** `isTrusted` は送信元の正当性を保証しない。origin の完全一致検証が無ければ脆弱と疑う。

---

## この節のまとめ

- postMessage（Web メッセージ）は、同一オリジンポリシーを越えてウィンドウ／フレーム間で通信するための正規の仕組みで、受信側の **origin 検証の甘さ**と **data の無検証な sink 渡し**が脆弱性の二大原因である。
- DOM Invader の Web メッセージ機能は「**postMessage 版の Proxy 履歴＋Repeater**」であり、(1) 全 postMessage のログ化、(2) 編集・再送、(3) 自動改変送信の3本柱を持つ。
- 使う前に**設定メニューで Postmessage interception を有効化し、Reload する**必要がある（既定は無効）。
- Messages 一覧の列は `ID / Type / Origin / Data / From frame / To frame / Stack trace`。**DOM Invader 生成メッセージは ID が空欄**で見分けられる。
- 詳細ダイアログ（Replay Postmessage）の **Origin/Data/Source accessed** インジケータで、ハンドラが各プロパティに触れたかが分かり、origin 検証の有無や sink 到達を推定できる。
- DOM Invader は canary 注入と偽 origin 置換で「面白い」メッセージを自動判定し、**Severity/Confidence** を付ける。全メッセージは最低 Information で一覧される。
- 悪用可能な脆弱性は **Build PoC** ボタンで HTML PoC としてクリップボードに生成でき、そのままレポートに使える。
- Web メッセージ設定の現行5項目は **Postmessage origin spoofing / Canary injection into intercepted messages / Filter messages with duplicate values / Generate automated messages / Detect cross-domain leaks**。旧名「Filter by stack trace」「Auto-fire events」は現行ページに無い。
- **Detect cross-domain leaks** は DOM XSS ではなく、URL 由来データの異オリジン送信＝OAuth トークン窃取のような情報漏えいを検出する。
- postMessage-tracker（Frans Rosén、2020年5月公開の Chrome 拡張、Manifest V2）は、`Window.prototype.addEventListener`・`window.onmessage` setter・`MessagePort.prototype.addEventListener`・`History.prototype.pushState` をフックしてリスナを列挙し、アイコンのバッジに数を表示する。
- 全サブフレーム・短命・操作起動のリスナを追跡し、**Raven/New Relic/Rollbar/Bugsnag/Sentry/jQuery** のラッパを**アンパック**して本物のリスナを見せる。匿名関数は `bound ...` と表示。
- コンテンツスクリプトは prototype を書き換えるため `injectedJS` を `<script>` でページ世界に注入し、**CustomEvent → chrome.runtime.sendMessage** でページ世界と拡張世界を橋渡しする。
- `h()` はウィンドウ経路を `top.frames[0]` 形式（別ウィンドウは `diffwin`）の**replay 可能なパス**として算出し、`l()` はスタックトレースからリスナ登録位置を取る。
- **Log-URL** を設定すると全リスナ情報が JSON で外部へ POST され、短命な隠れリスナも後から精査できる（送信先は自分の管理下に限る）。
- ハンティングは **リスナ列挙（tracker）→ origin 検証の甘さ確認（DOM Invader）→ data→sink 追跡 → PoC 作成・再送** の順で進める。各ステップの裏返しがそのまま防御になる。

---

## 理解度チェック

1. DOM Invader の Web メッセージ機能を Burp のどのツールに例えると分かりやすいか。2つ挙げよ。
   - ▶ 答え: 全 postMessage をログ化する点は **Proxy の HTTP 履歴**、メッセージを編集して再送する点は **Repeater** に相当する。

2. Postmessage interception を ON にしてもメッセージが1件も出ないとき、まず疑うべき操作漏れは何か。
   - ▶ 答え: **Reload（ブラウザ再読み込み）**を押していない。傍受フックはリロードで注入されるため、Reload は変更反映に必須。

3. Messages ビューで、DOM Invader が自動生成したメッセージとページ本来のメッセージをどう見分けるか。
   - ▶ 答え: **`ID` 列**を見る。ログされた本来のメッセージには数値 ID が付くが、DOM Invader 生成メッセージは **ID が空欄**。

4. 詳細ダイアログで `Origin accessed` が立っていないとき、何が推測できるか。
   - ▶ 答え: 受信側コードが `origin` に一度も触れていない＝**origin 検証をしていない可能性が高い**。任意の外部ドメインからクロスオリジンでメッセージを送り込める疑いがある。最優先で調査する。

5. Web メッセージ設定の現行5項目をすべて挙げよ。旧記述にあって現行に無い項目も1つ挙げよ。
   - ▶ 答え: 現行は **Postmessage origin spoofing / Canary injection into intercepted messages / Filter messages with duplicate values / Generate automated messages / Detect cross-domain leaks**。現行に無い旧項目は **Filter by stack trace**（または **Auto-fire events**）。

6. Detect cross-domain leaks は何を検出する機能か。DOM XSS とどう違うか。
   - ▶ 答え: 現在ページが **URL 由来のデータを含む Web メッセージを別 origin 宛てに送った**ことを検出する。DOM XSS（スクリプト実行）ではなく、**OAuth トークンなどの機密データがクロスドメインで漏えい**することの検出機能である。

7. postMessage-tracker がリスナを漏れなく捕まえるためにフックしている4つの JavaScript API（＋履歴 API）を挙げよ。
   - ▶ 答え: `Window.prototype.addEventListener`（`type=='message'`）、`window.__defineSetter__('onmessage', ...)`（旧式 setter）、`MessagePort.prototype.addEventListener`、`History.prototype.pushState`（＋ `beforeunload` でページ変更追跡）。

8. postMessage-tracker のコンソールに出る `top.frames[0]` のような hops 表記は、診断上どう役立つか。
   - ▶ 答え: そのウィンドウを指す**replay 可能なパス**なので、`top.frames[0].postMessage('...', '*')` のように**手動で再送**して挙動を確かめられる。別ウィンドウは `diffwin` と表示される。

9. New Relic や jQuery で包まれた message リスナを、postMessage-tracker はどう扱うか。匿名関数はどう表示されるか。
   - ▶ 答え: ラッパを**アンパック**して本物のリスナを見せる（`c()` で種別判定、`unwrap()` で剥がす）。Chrome が文字列化できない**匿名関数は `bound ...`** として表示される。

10. postMessage-tracker の Log-URL を使うときに気をつけるべきことは何か。
    - ▶ 答え: 検出した**全リスナ情報が JSON で指定 URL へ POST される**ため、送信先は**自分の管理下のエンドポイント**に限る。第三者サイトのリスナ情報を無関係なサーバへ送るのは診断範囲・データ取り扱いの逸脱になり得る。

---

## 出典

- PortSwigger: Testing for DOM XSS using web messages — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages （公式テキストは GitHub ミラー `1tbfree/BurpSuitePro-SourceLeak`・`ankokuty/burp-resources-ja` および拡張 UI ソース `panels/postmessage.html` から取得）
- PortSwigger: Web message settings — https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/web-messages
- PortSwigger: Testing workflow — DOM XSS using web messages — https://portswigger.net/burp/documentation/desktop/testing-workflow/input-validation/xss/web-message-dom-xss
- PortSwigger Web Security Academy Lab: DOM XSS using web messages — https://portswigger.net/web-security/dom-based/controlling-the-web-message-source/lab-dom-xss-using-web-messages
- PortSwigger blog: Introducing DOM Invader — https://portswigger.net/blog/introducing-dom-invader
- Frans Rosén: postMessage-tracker — https://github.com/fransr/postMessage-tracker （README・全ソースは `raw.githubusercontent.com` 経由で取得）
- Frans Rosén: OWASP AppSec EU 2018「Attacking modern web technologies」動画 — https://www.youtube.com/watch?v=oJCCOnF25JU
- Frans Rosén: 同スライド — https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies
- HackTricks: DOM Invader — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html
- HackTricks: PostMessage Vulnerabilities（postMessage-tracker / Posta を列挙ツールとして紹介）

<!-- sources: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages, https://portswigger.net/burp/documentation/desktop/tools/dom-invader/settings/web-messages, https://portswigger.net/burp/documentation/desktop/testing-workflow/input-validation/xss/web-message-dom-xss, https://portswigger.net/web-security/dom-based/controlling-the-web-message-source/lab-dom-xss-using-web-messages, https://portswigger.net/blog/introducing-dom-invader, https://github.com/fransr/postMessage-tracker, https://www.youtube.com/watch?v=oJCCOnF25JU, https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies, https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html -->
<!-- terms: Web メッセージ（Web Messages）, postMessage, 同一オリジンポリシー（Same-Origin Policy, SOP）, オリジン（Origin）, DOM XSS, sink, source, canary（カナリア）, iframe, Postmessage interception, Replay Postmessage ダイアログ, Origin accessed, Data accessed, Source accessed, Severity（重大度）, Confidence（確信度）, Build PoC, Postmessage origin spoofing, Canary injection into intercepted messages, Filter messages with duplicate values, Generate automated messages, Detect cross-domain leaks, OAuth トークン, postMessage-tracker, Frans Rosén, Manifest V2, content script, background script, prototype, CustomEvent, MessagePort, MessageChannel, スタックトレース（stack trace）, hops, diffwin, Log-URL, getEventListeners, X-Frame-Options, CSP frame-ancestors -->

<!-- self-read: https://portswigger.net/burp/documentation/desktop/tools/dom-invader/web-messages | portswigger.net が egress プロキシで遮断され、実スクリーンショット画像はミラーにも無く目視が必要 -->
<!-- self-read: https://github.com/fransr/postMessage-tracker | README 画像・講演動画・スライドが画像／動画バイナリのため自動取得不可 -->
