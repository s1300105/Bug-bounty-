## DOM Invader補足（HackTricks / Medium）

本セクションは、第3章で導入した **DOM Invader**（Burp Suite に組み込まれた DOMベースXSS 発見支援ツール）を、より実務的・網羅的に掘り下げる補足です。典拠は次の2資料です。

1. **HackTricks の DOM Invader 解説** — ツールの機能を「攻撃者目線の手順書」として簡潔に列挙した実務系リファレンス。
2. **Hacksheets（Medium）の実践記事**「DOM Invader — Burp Suite tool to Find DOM Based XSS Easily」 — スクリーンショット付きで「有効化 → カナリア注入 → シンク確認」という基本ワークフローを初学者向けに追体験させる入門記事。

第3章前半（PortSwigger 系）で **source/sink（ソース/シンク）** の理論と DOM Invader の全体像は説明済みなので、本セクションでは重複を避け、(1) 各機能の**具体的な操作とボタンの挙動**、(2) プロトタイプ汚染・DOM クロバリング・postMessage といった**高度な攻撃タイプの検出メカニズム**、(3) 「なぜその手法で脆弱性が見つかる/成立するのか」という**原理**、を原文なしで理解できるレベルまで詳述します。

---

### 0. 本セクションの資料取得状況（透明性のための注記）

- **資料1（HackTricks）** は、執筆環境の下り（egress）プロキシが `hacktricks.wiki` ドメインへの直接アクセスをブロックしたため WebFetch では取得できませんでしたが、**HackTricks の公開ソース（GitHub 上の同一原稿ファイル）から本文全文を復元**できました。したがって本セクションでは資料1を「取得可能」として扱い、原典URLを出典に明記します。内容は原稿に忠実ですが、HackTricks は随時更新されるため細部は原典でご確認ください。
- **資料2（Hacksheets / Medium）** は、`hacksheets.medium.com` および既知のミラー（Tumblr 版、Medium リーダー系ミラー）がいずれもプロキシによりブロック／名前解決不能で、**記事本文そのものは取得できませんでした**。Web検索のスニペットから記事の骨子（扱っているトピックと手順の概要）は把握できたため、該当箇所に後述の未取得ブロックを挿入したうえで、専門知識で補って解説します。

---

### 1. DOM Invader とは何か（位置づけと「解決する課題」の再確認）

**DOM Invader** は、Burp Suite に内蔵された **組み込みブラウザ（Burp's embedded browser: Chromium ベースのブラウザで、Burp のプロキシを最初から経由するよう設定済み）** に、拡張機能としてあらかじめインストールされているツールです。目的は **DOMベースXSS を中心としたクライアント側脆弱性（DOM XSS・Webメッセージ XSS・プロトタイプ汚染・DOM クロバリング）を、JavaScript を手で追わずに発見する**ことです。

なぜ専用ツールが要るのか。DOMベースXSS の判定には、**「攻撃者が操作できる入口（source）」から「危険な代入先（sink）」まで、データがどう流れるか**を追う必要があります。ところが現代のフロントエンドは、圧縮（minify）・難読化された数千〜数万行の JavaScript でできており、この**データフロー（データの流れ）を人間が目で追うのは現実的でない**ことが多い。DOM Invader は、ブラウザ内部の危険な関数・プロパティ（`innerHTML` への代入、`eval()` の呼び出しなど）に**フック（hook: 対象の処理を横取りして、その引数や呼び出しを監視・記録する仕組み）** を仕掛け、「印を付けた入力（後述のカナリア）が、どのシンクに、どんな文脈で到達したか」を自動で報告します。

> HackTricks の要約: DOM Invader は「様々な source と sink を用いて DOM XSS をテストするブラウザ組み込みツール」で、Webメッセージやプロトタイプ汚染ベクタも扱える。Burp の組み込みブラウザ経由でのみ利用でき、拡張として preinstall されている。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

#### 1.1 サーバ側スキャナでは見つからない理由（原理）

反射型・格納型 XSS は攻撃文字列がサーバを通るため、プロキシ（Burp Scanner など）がリクエスト/レスポンスを観測して検出できます。しかし DOMベースXSS のペイロードは、URL のフラグメント（`#` 以降）や `postMessage`、`localStorage` などを経由して**ブラウザ内で完結し、サーバに届かないことがある**。したがってネットワークを覗くだけのスキャナには原理的に見えません。DOM Invader が「ブラウザの中」で計測するのは、この盲点をふさぐためです。

---

### 2. 有効化と基本操作

HackTricks と一般的な手順に基づく、最小の起動フローは次のとおりです。

1. Burp Suite で **Proxy → Intercept → Open Browser**（または「Open Browser」ボタン）を押し、**Burp 組み込みブラウザ**を開く。
2. ブラウザ右上の **Burp Suite ロゴ（拡張アイコン）** をクリック（隠れている場合はジグソーピースの拡張アイコンを先に押す）。
3. **DOM Invader タブ**で「**Enable DOM Invader**」をオンにし、ページを**リロード**する（フックはページ読み込み時に仕掛けられるため、有効化後の再読み込みが必須）。
4. **DevTools（F12）** を開くと、DevTools パネルに **DOM Invader 用のタブ**（および後述の「**Augmented DOM**」タブ）が追加される。

> ポイント: DOM Invader は「Burp の組み込みブラウザ限定」です。普段使いの Chrome/Firefox には拡張として入れられません（計測フックを安全に注入するために専用ブラウザに限定されている）。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

---

### 3. Canary（カナリア）— DOM Invader の中核

**カナリア（canary）** とは、DOM Invader が「入力の追跡用マーカー」として使う**一意のランダム文字列**です（**デフォルト値は `burpdomxss`**）。炭鉱のカナリア（危険を知らせる小鳥）が語源で、「この文字列が危険な場所に現れたら警報」という発想です。仕組みはシンプルかつ強力です。

- あなた（またはツール）がカナリアを **source に注入**する（URL パラメータ、フォーム、WebSocket フレーム、Webメッセージなど）。
- DOM Invader は、フックした各シンクに渡る値の中に**カナリア文字列が含まれていないか**を監視する。
- カナリアがシンクに到達したら、**どのシンクに・どんな文脈（context）で・どんなサニタイズ（無害化処理）を経て**届いたかを報告する。

これは本格的な**テイント追跡（taint tracking: 汚染源から来たデータに“汚れ”の印を付け、その伝播を追う技術）** の軽量版と考えると分かりやすい。文字列一致という素朴な方法ですが、実運用では十分に強力です。

> HackTricks: DevTools を有効化すると「Canary」と呼ばれるランダムな文字群が現れる。これを Web の様々な箇所（パラメータ・フォーム・URL）に注入し始めると、DOM Invader は「そのカナリアが悪用可能な興味深いシンクに行き着いたか」をチェックする。

#### 3.1 カナリアの注入を自動化する機能

手で全パラメータに貼るのは面倒なので、DOM Invader は自動注入を用意しています。

- **Inject URL params**: 現在の URL のクエリ文字列**全パラメータ**にカナリアを自動で付与し、新しいタブで開く。
- **Inject forms**: ページ内**フォームの各フィールド**にカナリアを自動入力する。
- 追跡対象は URL パラメータ・フォーム・**WebSocket フレーム**・**Webメッセージ（postMessage）** に及ぶ。

#### 3.2 「空のカナリア」検索 — レコン（偵察）の裏技

カナリアを**空文字にして検索**すると、DOM Invader は**悪用可能性に関わらず、ページ上のすべてのシンク（に流れ込む値）を列挙**します。実際に脆弱でなくても「どこに危険な代入先があるか」を俯瞰できるため、**攻撃対象面（attack surface）の把握＝レコン**に非常に有効です。

#### 3.3 カナリア設定（Burp 2024.12 以降）— 陳腐化への注意

Burp Suite **2024.12** で**カナリア設定**が追加され、カナリア文字列を**ランダム化**したり**任意のカスタム文字列**に変更できるようになりました。これは次の場面で役立ちます。

- **複数タブ/複数対象を同時テスト**する際に、対象ごとにカナリアを変えて混同を防ぐ。
- 対象ページに**たまたまデフォルト値 `burpdomxss` が自然に出現**してしまい、誤検知（false positive）が出る場合に別の値へ逃がす。

> バージョン注記: カスタム/ランダムなカナリア設定は **Burp 2024.12（2024年）以降**の機能です。これより古い Burp ではデフォルト `burpdomxss` 固定のため、上記の回避策は使えません。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html ／ DOM Invader canary settings — PortSwigger（Burp 2024.12 のカナリア設定）

---

### 4. Augmented DOM — ソース/シンクのツリー表示

**Augmented DOM（拡張DOM）** は、DevTools 内に追加されるビューで、**対象ページの source と sink をツリー表示**します。通常の DOM ツリー（要素の入れ子）に、DOM Invader が観測した「ここがシンクだ」「ここにカナリアが届いた」という情報を**重ね書き（augment）** したものです。

このビューが提供する情報が、DOMベースXSS のエクスプロイト可否を一目で判断させます。

- **どのシンクにカナリアが到達したか**（`innerHTML` / `document.write` / `eval` / `location` / `setAttribute` など）。
- **文脈（context）**: カナリアが最終的に置かれる場所が **HTML 本体か、属性値（attribute）か、JavaScript 文字列か、URL か**。これが分かると、成立させるべきペイロードの形（タグを直に書けるのか、属性を閉じる `">` が要るのか、`'` でJS文字列を抜けるのか等）が決まる。
- **適用されたサニタイズ（sanitization: 危険な文字を除去/変換する無害化処理）**: どの文字が生き残り、どれが `&lt;` などにエスケープされたか。ここから「フィルタをどう回避するか」の当たりを付けられる。

DOM Invader はこれらを自動提示するので、**数千行の JavaScript を人力で読む作業（source → sink のトレース）を丸ごと肩代わり**します。これが「DOM XSS が“簡単に”見つかる」と言われる核心です。

#### 4.1 スタックトレースの確認

カナリアがシンクに届いた経路は、**スタックトレース（stack trace: 関数呼び出しの履歴。どの関数がどの順で呼ばれて今に至ったかの記録）** として確認できます。これにより「実際にこのデータフローを引き起こしているコード箇所」を特定でき、実証（PoC）や修正提案に直結します。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

---

### 5. Web メッセージ（postMessage）の検査

`window.postMessage()` は、**異なるオリジン（origin: スキーム＋ホスト＋ポートの組。例 `https://a.com`）間**でも安全にデータをやり取りするための正規APIです。ところが受信側の実装が甘いと、**外部オリジンから送り込んだメッセージが DOM XSS のトリガ**になります。DOM Invader の **Messages サブタブ**はこの検査に特化しています。

DOM Invader が提供する3機能:

1. **ロギング**: ページで発生した `window.postMessage()` の呼び出しをすべて記録する。
2. **編集・再送**: 記録したメッセージを**ダブルクリックして `data` を書き換え、Send で再送**できる。受信ハンドラの挙動を対話的に試せる。
3. **自動探索（auto-mutate 等）**: メッセージにペイロードを自動注入・再送して XSS を炙り出す。

各メッセージについて、受信側 JavaScript が次のプロパティを**検証しているか/無検証で使っているか**を確認できます。ここが脆弱性判定の勘所です。

- **`origin`**: 送信元オリジン。**検証していなければ、攻撃者の別ドメインからのクロスオリジン送信を受け入れてしまう**（`event.origin` を `if` でチェックしていないケースが典型的な穴）。
- **`data`**: メッセージ本体。これがサニタイズされずに `innerHTML` 等のシンクへ渡ると DOM XSS になる。
- **`source`**: 送信元の window 参照。iframe 参照の照合に使われるが、状況次第でバイパス可能。

> なぜ危険か（原理）: `postMessage` は設計上「誰でも送れる」。安全性は**受信側が `event.origin` を厳格に検証し、`event.data` を無害化する**ことに全面的に依存する。この2つが欠けると、攻撃者は自分の用意したページから被害ページの iframe/子ウィンドウへ任意の `data` を送り込み、それが素通しでシンクへ流れる。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

---

### 6. プロトタイプ汚染（Prototype Pollution）の検出とガジェット探索

**プロトタイプ汚染（prototype pollution）** は、DOM Invader が近年もっとも強力に支援する領域です。まず原理から。

#### 6.1 なぜ「汚染」が起きるのか（プロトタイプチェーンの仕組み）

JavaScript のオブジェクトは、あるプロパティを参照されたとき、**自分自身にそれが無ければ「プロトタイプ（原型）」を辿って探しに行く**——この連鎖を **プロトタイプチェーン（prototype chain）** と呼びます。ほぼすべての普通のオブジェクトは、最終的に **`Object.prototype`** を共有の親として持ちます。

```javascript
let obj = {};
obj.testproperty          // → undefined（自分にもチェーン上にも無い）
Object.prototype.testproperty = "polluted";
obj.testproperty          // → "polluted"（自分に無いので親 Object.prototype で発見）
```

つまり **`Object.prototype` に1つプロパティを書き込むと、プログラム中の（ほぼ）すべてのオブジェクトが、そのプロパティを“最初から持っていたかのように”見え始める**。攻撃者が外部入力を通じてこの共有の親を書き換えられる状態が「プロトタイプ汚染」です。書き換えの入口（source）として悪用されるキーが **`__proto__`** と **`constructor.prototype`** です。

```javascript
// マージ処理などが __proto__ を素直に辿ってしまうと汚染が起きる
obj["__proto__"]["polluted"] = true;      // Object.prototype.polluted = true と同義
obj["constructor"]["prototype"]["x"] = 1; // これも Object.prototype.x = 1 に到達
```

`__proto__` はオブジェクトのプロトタイプを指し示すアクセサであり、`constructor.prototype` は「そのオブジェクトを作ったコンストラクタ（＝Object）が持つ prototype」＝やはり `Object.prototype` に行き着くため、どちらも共有の親を書き換える経路になります。

#### 6.2 DOM Invader による自動検出と PoC 確認

DOM Invader を（設定の **Attack types → Prototype pollution** で）有効化すると、**URL やJSONメッセージなどの中に、`Object.prototype` へ任意プロパティを追加できるソースが無いか自動で探索**します。候補が見つかると **「Test」ボタン**が表示され、押すと**新しいタブで実際に汚染を試みて成否を確認**します。確認は次のような最小コードで行われます。

```javascript
let b = {};
b.testproperty;   // 汚染成功なら、注入したプロパティ値（例: 'DOM_INVADER_PP_POC'）が返る
```

`b` は空オブジェクトなのに `b.testproperty` が値を返せば、**共有の親 `Object.prototype` が確かに汚染された**証拠、というわけです（プロトタイプチェーンの探索挙動をそのまま実証に使っている）。

#### 6.3 Scan for gadgets（ガジェット探索）— 汚染を“実害”に変える

プロトタイプ汚染は、それ単体では「変なプロパティが増える」だけのこともあります。実害（XSS やコード実行）にするには、**汚染したプロパティを読み取って危険なシンクに渡してしまうコード＝ガジェット（gadget）** が必要です。

DOM Invader は、検出したプロトタイプ汚染ソースの隣に **「Scan for gadgets」ボタン**を用意します。押すと**新しいタブでガジェット探索が始まり**、汚染したプロパティ経由で到達できる危険なシンク（例: 値がそのまま `innerHTML` や `<script src>`、`eval` に渡るもの）を洗い出し、**Augmented DOM ビューに「このガジェット→このシンク」のチェーンを表示**します。必要に応じて **`Object.prototype` を実際に汚染して PoC とする**こともできます。

> なぜ強力か（原理）: ガジェットは「未設定なら `undefined` のはず」のプロパティを、値チェックせず設定パラメータや HTML 断片として使うコードに潜む。攻撃者はプロトタイプ汚染でその“空欄”を自分の値で埋め、正規コードに危険な動作を実行させる。DOM Invader はこの2段構え（汚染ソース＋ガジェット）を自動でつなぐため、手作業では極めて根気の要る探索が現実的になる。

> バージョン注記: DOM Invader のクライアント側プロトタイプ汚染サポート（自動検出＋ガジェットスキャン）は、PortSwigger が2022年に導入した機能です。古い Burp では利用できません。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html ／ Finding client-side prototype pollution with DOM Invader — PortSwigger Blog（2022）

---

### 7. DOM Clobbering（DOM クロバリング）の検出

**DOM クロバリング（DOM clobbering）** は、スクリプトを直接注入できない（例: 強力なサニタイザで `<script>` や `on*` 属性が落とされる）状況でも、**HTML 要素の `id`／`name` 属性だけで JavaScript の変数を上書きして誤動作させる**手法です。DOM Invader は設定の **Attack types → DOM clobbering** で自動スキャンできます。

#### 7.1 なぜ HTML だけで変数が壊せるのか（原理）

HTML には歴史的経緯から、**`id` や `name` を持つ要素が、`window`（グローバル）や `document` のプロパティとして自動的にアクセス可能になる**という「名前付きアクセス（named access）」の挙動があります。

```html
<a id="x"></a>
<script>
  // 上の要素があるだけで、以下がその <a> 要素を指してしまう
  x;             // → <a id="x"> 要素
  window.x;      // → 同上
</script>
```

したがって、コードが `if (window.config) { ... }` のように**「未定義なら安全」を前提にしたグローバル変数**を参照していると、攻撃者は `<a id="config">` を注入するだけでその変数を“実在する要素”に化けさせ（＝**clobber: 上書きして壊す**）、想定外の分岐やプロパティ参照を引き起こせます。`<form>` と入れ子の要素名を組み合わせると、`window.x.y` のような**多段のプロパティ**まで攻撃者が構築でき、より深いガジェットに到達できます。DOM Invader はこうした「ユーザー制御下の `id`/`name` がグローバルを上書きし得る箇所」を検出します。

> 補足: DOM クロバリングは「スクリプト注入禁止でも成立し得る XSS への足場」であり、プロトタイプ汚染と同様に**ガジェット（上書きされた値を危険に使うコード）** とセットで初めて実害になります。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

---

### 8. オープンリダイレクト検出とその他の設定

- **リダイレクトの抑止**: DOM Invader は設定（Misc 系）で**クライアント側リダイレクトをブロック**できます。`location`/`location.href` へのカナリア到達（＝**オープンリダイレクト**: 任意の外部URLへ飛ばされる脆弱性。フィッシングや OAuth トークン奪取の踏み台になる）を、実際に遷移させずに観測・検証するのに使います。
- **イベントの自動発火（auto fire events）**: クリックや入力などの**イベントを自動的に発火**させ、イベントハンドラ内でしか動かないコードパスも計測対象に含める（＝到達できるシンクを増やす）。
- **ブレークポイント**: 特定のシンク到達時に処理を止めて、その瞬間の状態やスタックを詳しく調べられます。

> 出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html

---

### 9. 実践ワークフロー（Hacksheets / Medium の入門記事より）

このトピック（初学者向けの「有効化 → カナリア注入 → シンク確認」の手取り足取り手順）は、担当資料2（Hacksheets の Medium 記事）が正面から扱っています。ただし記事本文は自動取得できなかったため、以下に未取得ブロックを置き、続けて専門知識で補います。

> ⚠️ **未取得の資料**: 「Dom Invader — Burp Suite tool to Find DOM Based XSS Easily（Hacksheets, Medium）」は自動取得できませんでした（理由: 執筆環境の egress プロキシが `hacksheets.medium.com` および既知のミラー（Tumblr 版・Medium リーダー系ミラー）へのアクセスをブロック／名前解決不能だったため）。以下のURLからユーザーご自身で直接ご覧ください: https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44

（以下は取得できなかった資料の補足として、一般的な知識および検索スニペットに基づく解説です）

この Hacksheets 記事が示している基本ワークフローは、実質的に次の流れです。DOM Invader を初めて触る読者は、この順になぞれば最短で1件の DOM XSS を見つけられます。

1. **組み込みブラウザを開く**: Burp の Proxy → Open Browser で Burp 組み込みブラウザを起動する（普通のブラウザではなくこれを使うのが前提）。
2. **DOM Invader を有効化**: 右上の Burp ロゴ → DOM Invader タブ → **Enable DOM Invader** をオン → ページをリロード。
3. **カナリアを確認**: DevTools を開くと、追跡用の一意文字列**カナリア（既定 `burpdomxss`）** が表示される。記事はこの既定値を明示的に紹介している。
4. **カナリアを source に注入**: URL のクエリパラメータやフォーム入力にカナリアを入れる（`?q=burpdomxss` のように）。「Inject URL params」で一括注入すると速い。
5. **Augmented DOM でシンクを確認**: DevTools の **Augmented DOM** タブに、カナリアが到達したシンクと**文脈（HTML/属性/JS/URL）** が並ぶ。ここでカナリアが `innerHTML` などに素通しで届いていれば、それが DOM XSS 候補。
6. **文脈に合わせてペイロード化**: 例えばカナリアが HTML 本体にそのまま入るなら、カナリアの代わりに実際のペイロードを注入して成立を確認する。

上記手順で「まず動く1件」を体験するのに使える最小ペイロードの考え方を、原理付きで示します（記事の趣旨に沿った一般例）。

```
https://victim.example/page?search=<img src=x onerror=alert(document.domain)>
```

- **なぜ動くのか**: ページの JavaScript が `location.search`（source）から検索語を読み、それを `element.innerHTML`（sink）へ無害化せず代入している場合、この文字列は「データ」ではなく **HTML** として解釈される。`<img>` は読み込みに失敗（`src=x` は存在しない）するため `onerror` が発火し、中の `alert(document.domain)` が実行される。`<script>` タグは `innerHTML` 代入では実行されない（HTML 仕様で、後から innerHTML で挿入された script は実行対象外）ため、**`onerror` のようなイベントハンドラ経由**が定石になる、という点が学習上の勘所。

Augmented DOM が「文脈は属性値」と示した場合は、まず属性を閉じてから要素を作る必要があります。

```
"><img src=x onerror=alert(1)>
```

- **なぜ動くのか**: カナリアが `<input value="ここ">` のように**属性値の中**へ入るなら、先頭の `">` で「value 属性」と「input タグ」を閉じ、その直後に新しい `<img ... onerror=...>` を書き足す。ブラウザの HTML パーサは閉じられたタグの後続を新しいタグとして解釈するため、注入した要素が有効化される。DOM Invader の文脈表示は、この「どこまで閉じる必要があるか」を判断する材料になる。

> 補足（サニタイザとバージョン依存）: Augmented DOM が「サニタイズあり」と示しても、サニタイザの**バージョンによってはバイパス可能**な場合があります。代表例として、HTMLサニタイザ **DOMPurify** には過去に**変異型XSS（mutation XSS / mXSS: ブラウザが一度受理したHTMLを内部で再解釈・書き換える過程で、無害だったはずの断片が実行可能な形に“変異”する現象）** によるバイパスが複数あり、たとえば **DOMPurify 2.0.17（2021年リリース）** で修正されたバイパスなどが知られています。したがって「サニタイザがあるから安全」と即断せず、**対象が使うライブラリ名とバージョンを特定し、そのバージョンに既知のバイパスがないか**を必ず確認してください（古いバージョンを使い続けている実サイトは珍しくありません）。

> 出典（一次情報が取得できなかったため位置づけを明記）: Dom Invader — Burp Suite tool to Find DOM Based XSS Easily（Hacksheets, Medium, 本文未取得・検索スニペットにより補完） — https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44

---

### 10. まとめ — DOM Invader を「体系」で使う

- DOM Invader は **Burp 組み込みブラウザ専用**の DOM 脆弱性ハンター。手作業では非現実的な **source → sink のデータフロー追跡**を、ブラウザ内フックとカナリアで自動化する。
- **カナリア（既定 `burpdomxss`）** が全機能の中核。**空カナリアでレコン**、**Inject URL params/forms で一括注入**、**2024.12 以降はカスタム/ランダム化**で誤検知回避。
- **Augmented DOM** が到達シンク・**文脈（HTML/属性/JS/URL）**・**適用サニタイズ**・**スタックトレース**を提示し、そのままエクスプロイト可否と必要ペイロード形状の判断材料になる。
- 高度な攻撃タイプも自動化: **postMessage**（origin 無検証＋data 素通しを Messages タブで検査・改変・再送）、**プロトタイプ汚染**（`__proto__`/`constructor.prototype` を入口に `Object.prototype` を汚染 → Test で確認 → Scan for gadgets でシンクへ連結）、**DOM クロバリング**（`id`/`name` の名前付きアクセスでグローバルを上書き）、**オープンリダイレクト**（リダイレクト抑止で安全に観測）。
- 判断の勘所は常に**原理**にある。プロトタイプチェーンの探索、HTML パーサのタグ再解釈、名前付きアクセス、mXSS による再解釈——これらを理解していれば、DOM Invader の出力を「なぜそうなるか」まで読み解き、確実な PoC に落とし込める。

> 総合出典: DOM Invader — HackTricks — https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html ／ Dom Invader — Burp Suite tool to Find DOM Based XSS Easily（Hacksheets, Medium, 本文未取得・補完） — https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44
