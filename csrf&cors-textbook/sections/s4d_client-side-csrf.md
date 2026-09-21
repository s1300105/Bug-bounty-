## client-side CSRF（学術研究→実務）

### この節のねらい

古典的な CSRF（Cross-Site Request Forgery）は「サーバが受け取ったリクエストの出所を検証していない」ことを突く攻撃だった。攻撃者は `<form>` や `<img>` を仕込んだ罠ページを用意し、被害者のブラウザに勝手にリクエストを送らせる。これに対して防御側は CSRF トークン・`SameSite` Cookie・Origin/Referer 検証といった対策を積み上げてきた。第4章のここまでで見たとおり、`SameSite=Lax` の普及によって「クロスサイトの `<form>` から勝手に POST される」古典的 CSRF は大きく封じられた。

しかし「CSRF は死んだ」わけではない。攻撃の起点が**サーバ側からクライアント側（ブラウザ内で動く JavaScript）へ移動した**のである。本節では、この潮流を代表する 2 つのテーマを扱う。

- **client-side CSRF（クライアントサイド CSRF）**: ページ内の JavaScript が、攻撃者の操作できる入力（URL のフラグメントや `postMessage` など）をもとに HTTP リクエストを組み立ててしまう脆弱性。学術研究 **JAW**（USENIX Security 2021）がこの問題を体系化した。
- **CSPT2CSRF（Client-Side Path Traversal → CSRF）**: フロントエンドが組み立てる API リクエストの**パス**に攻撃者入力が素通りし、`../` によって別のエンドポイントへ「再ルーティング」される脆弱性。Doyensec が 2024 年に「CSRF is dead, long live CSRF」というスローガンとともに実務向けに再定義した。

どちらも共通しているのは、「リクエストを実際に送るのはページ自身の正規コード（`fetch`/`XMLHttpRequest` 等）である」点だ。だからこそ Cookie は自動付与され、`SameSite` はページと同一サイト扱いになり、CSRF トークンさえ正規コードが勝手に付けてくれることすらある。従来対策の前提を根こそぎ崩すのがこの新潮流である。

---

### client-side CSRF とは何か（JAW の定義）

**client-side CSRF** とは、ページ内で動く JavaScript プログラムが、攻撃者が制御できる入力を使って、認証済みの HTTP リクエストを生成・送信してしまう脆弱性である。古典的 CSRF が「攻撃者のページが直接リクエストを作る」のに対し、client-side CSRF では「被害者ページの正規 JS を騙して、意図しないリクエストを作らせる」。

Khodayari らの定義を、脆弱性解析の共通言語である **source（ソース）** と **sink（シンク）** で整理すると理解しやすい。

- **source（ソース）** = 攻撃者が値を注入できる入力元。ここでは「攻撃者が制御可能なデータの入口」を指す。JAW が追跡する主なソースは次のとおり。
  - `window.location`（`href` / `pathname` / `search` / `hash`）—— とくに **URL フラグメント（`#` 以降）** はサーバに送られずブラウザ内だけで処理されるため、罠 URL を踏ませるだけで JS に値を渡せる典型的なソース。
  - `postMessage` で受信したデータ（`event.data`）
  - `document.referrer`
  - `localStorage` / `sessionStorage`（WebStorage）
- **sink（シンク＝入力が最終的に「HTTP リクエスト送信」として実行される危険な代入先）** = リクエストを実際に発火させる API。JAW が追跡する主なシンクは次のとおり。
  - `fetch()`
  - `XMLHttpRequest`（`open()`/`send()`）
  - `window.open()`
  - jQuery の `$.ajax()`
  - フォーム送信（`form.submit()`）

ソースからシンクまで攻撃者データが**データフロー上つながっている**とき、そのリクエストは攻撃者が細工できる＝ **forgeable request（偽造可能リクエスト）** となる。

#### なぜ危険なのか（原理）

このリクエストを送るのは被害者ページ自身の正規コードなので、次が同時に成立する。

1. **Cookie が自動的に付く**（同一オリジンへのリクエスト）。認証セッションが乗る。
2. **`SameSite` は無力**。攻撃者ページから直接送るのではなく、被害者が正規サイトを開いた状態の中で JS が送るため、リクエストはファーストパーティ（同一サイト）扱いになる。`SameSite=Lax`/`Strict` でも Cookie は付く。
3. **CSRF トークンさえ回避されうる**。正規のリクエスト生成コードがトークンをヘッダやボディに自動付与する実装であれば、攻撃者がパラメータだけ差し替えても有効なトークンが付いたまま送られてしまう。

つまり client-side CSRF は「古典的 CSRF 対策の外側」で成立する。だからこそ `SameSite` 時代の高度な CSRF として重要なのである。

具体的なコード例で見てみよう。次のようなコードは典型的な脆弱パターンだ。

```javascript
// 脆弱例: URL の一部（フラグメント）を検証せずにリクエストのパスへ流し込む
var ajaxloc = window.location.href;          // source: WIN.LOC
$.ajax({
  url: ajaxloc + "/bearer1234/",             // sink: $.ajax の url に攻撃者データが到達
  type: "POST",
  data: { action: "delete" }
});
```

被害者が `https://victim.example/#https://attacker.example` のような URL を踏むと、`ajaxloc` に攻撃者ドメインが混入し、認証付き POST の宛先や中身を攻撃者が左右できる。JAW は実際にこの形の検出結果を次のように出力する。

```
[*] Tags: ['WIN.LOC']
[*] Template: ajaxloc + "/bearer1234/"
1:['WIN.LOC'] variable=ajaxloc
    0 (loc:6)- var ajaxloc = window.location.href
```

`Tags: ['WIN.LOC']` は「このリクエストは `window.location` 経由で偽造可能」というセマンティックなタグ付けであり、`Template` はリクエスト URL がどんな文字列連結で組み立てられているか（＝攻撃者がどこを制御できるか）を示す。

> 出典: CISPA — It's all about who's asking（JAW 一般向け解説） — https://cispa.de/en/jaw

---

### JAW: 大規模解析でわかったこと（USENIX Security 2021）

**JAW** は Soheil Khodayari と Giancarlo Pellegrino（CISPA）が開発した、client-side CSRF を大規模に発見するための静的・動的ハイブリッド解析フレームワークである。論文タイトルは "JAW: Studying Client-side CSRF with Hybrid Property Graphs and Declarative Traversals"。

#### なぜ「ハイブリッド」なのか

JavaScript は動的な言語（実行時に型やコード構造が変わる、イベント駆動で呼び出し順が読みにくい、DOM やネットワークに依存する）であり、静的解析だけでは「どのソースがどのシンクに届くか」を正確に追えない。そこで JAW は次の 2 つを組み合わせる。

- **静的成分**: `esprima` パーサ（EsTree/SpiderMonkey 仕様準拠）で AST（抽象構文木）を構築し、データフロー・制御フローを解析する。
- **動的成分**: Selenium / Puppeteer / Playwright（テイント追跡付き）でページを実際にクロールし、実行時に飛んだ**ネットワークリクエスト・発火したイベント・Cookie・DOM スナップショット**を収集する。

#### Hybrid Property Graph（HPG）と宣言的トラバーサル

JAW の中核は **HPG（ハイブリッド・プロパティ・グラフ）** というデータモデルである。プログラムの AST・制御フロー・データフロー・（PDG など）意味情報に、動的に集めた実行時情報を「ノードとエッジ」として統合し、**Neo4j グラフデータベース**に格納する。

セキュリティ上の性質（「ソースからシンクへ到達可能か」等）を、解析ロジックを自作する代わりに **Cypher（Neo4j のクエリ言語）による宣言的トラバーサル（declarative traversal）** として書く。これが「declarative traversals」の意味である。JAW はこの仕組みで次を判定する。

- **データフロー解析**: プログラムスライスをたどり、変数の代入連鎖を追う
- **制御フロー解析**: 実行経路をたどる
- **到達可能性解析（reachability）**: シンクがソースから到達可能かを判定
- **パターンマッチ**: 脆弱性シグネチャに一致する部分グラフを探す

処理パイプラインはおおむね次の順序で動く。

```
1. クロール       : Selenium/Puppeteer/Playwright でページを取得（テイント追跡）
2. HPG 構築       : node engine/cli.js  → ノード/エッジの CSV を生成
3. Neo4j へインポート: python3 -m hpg_neo4j.hpg_import
4. 解析          : Python スクリプトから Cypher クエリで問い合わせ
5. 出力          : sink.flows.out に、タグ付きの脆弱性フローを書き出す
```

JAW は client-side CSRF だけでなく、**DOM Clobbering**（HTML の `id`/`name` 属性で JS のグローバル変数を上書きし、`window.x` 的な参照を攻撃者が乗っ取る手法）、**Request Hijacking**、**Open Redirect** も同じ HPG 基盤で検出できる。GitHub 版ではこれらの検出クエリが同梱されている。

#### 主要な数値と結論

論文が示したスケールと結果は次のとおり（USENIX Security 2021 時点、Bitnami カタログの Web アプリを対象）。

- 解析対象: **106 個の Web アプリケーション**、**約 2 億 2,800 万行（228M lines）の JavaScript**
- 発見: **12,701 件の偽造可能リクエスト（forgeable requests）**
- 影響: **106 個中 87 個のアプリに脆弱性**が存在
- 実証: **203 件が実際に悪用可能**、うち **7 アプリで動作する PoC** を確認、**25 種の request template（リクエスト雛形）** を特定
- 悪用能力: 古典的 CSRF では届かない経路を通じて、**サーバ側状態の任意改変・XSS・SQL インジェクション**まで到達しうる

結論として、client-side CSRF は「古典的手法の枠を超えた追加の攻撃面（additional attack vectors）を開く」ものであり、`SameSite` 等でサーバ側 CSRF を塞いでも残る、独立した脅威クラスであることが大規模データで裏づけられた。

> 出典: USENIX Security 2021 — JAW: Studying Client-side CSRF with Hybrid Property Graphs and Declarative Traversals（Khodayari & Pellegrino） — https://www.usenix.org/conference/usenixsecurity21/presentation/khodayari
>
> 出典: JAW GitHub（HPG / DOM Clobbering / open redirect / CSRF 検出クエリ） — https://github.com/SoheilKhodayari/JAW

---

### CSPT2CSRF: パスの穴から蘇る CSRF（実務の新潮流）

学術研究が体系化した client-side CSRF を、実務のバグバウンティ文脈で鋭く再定義したのが Doyensec の **CSPT2CSRF**（2024 年）である。標語は "CSRF is dead, long live CSRF"（CSRF は死んだ、CSRF 万歳）。

#### Client-Side Path Traversal（CSPT）とは

**CSPT（クライアントサイド・パストラバーサル）** とは、フロントエンドが `fetch`/`XHR` で API を叩くとき、URL の**パス部分**に攻撃者入力がエンコードされずに埋め込まれ、`../` によって別のエンドポイントへ到達してしまう脆弱性である。

原理はシンプルだ。ブラウザ（と多くのサーバ）は URL を送信・処理する前に**パス正規化（path normalization）** を行い、`a/b/../c` を `a/c` に畳み込む。したがって、パスに埋め込まれた `../` は「上のディレクトリへ戻る」ように働き、開発者が想定していないエンドポイントへリクエストが着地する。

```
本来の想定:
  画面 https://example.com/static/cms/news.html?newsitemid=123
  が   https://example.com/newitems/123  を fetch する

攻撃 (?newsitemid= に細工):
  ?newsitemid=../pricing/default.js?cb=alert(document.domain)//
  → 正規化後、/pricing/... へ再ルーティングされる
```

このリクエストを送るのはページ自身なので、**Cookie も認証トークンも自動で付く**。ここが CSRF に化ける鍵である。

#### なぜ CSPT が CSRF になるのか（source / sink モデル）

Doyensec は CSPT2CSRF を、client-side CSRF と同じく **source / sink** で記述する。ただし語義がやや実務寄りだ。

- **source（ソース）** = 被害者の代わりに HTTP リクエストを発火させる「起点となる操作」であり、攻撃者がその入力（＝パスに入る値）を制御できる箇所。ソースの現れ方には **DOM 型・Reflected（反射）型・Stored（保存）型** の 3 つがある。これは XSS の分類と同じ発想で、攻撃者データがどこ経由でパスに届くか（URL からその場で／サーバの反射応答経由／保存データ経由）を表す。
- **sink（シンク）** = 実際にリクエストを送る API 呼び出し（`fetch`/`XHR` 等）。CSPT2CSRF の場合、**再ルーティングされる先の正規 API リクエスト**がシンクにあたる。

決定的に重要なのが次の制約だ。**攻撃者が制御できるのは基本的に URL のパスだけ**である。CSPT は「既存の正規 API リクエストを別のパスへ流用する」攻撃なので、HTTP メソッド・ヘッダ・ボディは元のリクエストのものが使われ、攻撃者は原則いじれない。裏を返せば、狙える着地先エンドポイントは「元リクエストと同じメソッド・同じボディ形状で意味を持つもの」に限られる。したがって攻撃を記述するときは「どのソース（＝どの HTTP verb を発火する操作）か」を必ず特定する。同じフロントエンドでも、GET を撃つソース・POST を撃つソース・PATCH/PUT/DELETE を撃つソースは別物だからだ。

#### 古典的 CSRF に対する優位点（ここが核心）

CSPT2CSRF が「CSRF 万歳」と言われる理由は、従来の CSRF 対策を軒並みすり抜けるからである。

- **POST/PATCH/PUT/DELETE でも成立**: 古典的 CSRF が単純な `<form>` GET/POST に縛られたのに対し、CSPT は正規コードが撃つ任意メソッドのリクエストを再ルーティングできる。
- **CSRF トークンを回避**: パスだけ差し替えるため、正規コードが付与した有効なトークンがそのまま乗る。
- **`SameSite=Lax` を回避**: リクエストはページ自身（ファーストパーティ）から出るため Cookie が付く。
- **1-click 化**: 被害者に罠リンクを 1 回踏ませるだけで発火する構成が可能。
- **GET シンクの連鎖**: 状態変更できない GET シンクの CSPT2CSRF でも、別の状態変更 CSPT2CSRF と連鎖させる（ファイルのアップロード/ダウンロード機能を「ガジェット」として悪用する）ことで攻撃を成立させられる場合がある。

#### 公開されている実例（防御・修正状況の把握のため）

以下は Doyensec 等が公表した、修正済みの代表事例である（攻略手順ではなく、影響と対象バージョンの把握を目的に列挙する）。

- **Mattermost（CVE-2023-45316）**: POST シンクの悪用。次のようにパスへ `../` を仕込み、内部 API `/api/v4/caches/invalidate` へ再ルーティングされた。
  ```
  /<team>/channels/channelname?telem_action=under_control&telem_run_id=../../../../../../api/v4/caches/invalidate
  ```
  `telem_run_id` パラメータがパスに素通りしていたことが原因。
- **Rocket.Chat**: 1-click の CSPT2CSRF。
- **Grafana（CVE-2023-5123）**: JSON API Plugin での悪用。
- **Jupyter**: 複数 CVE の連鎖によるトークン漏えい。

> ⚠️ **未取得の資料**: Doyensec の原典解説「Exploiting Client-Side Path Traversal to Perform CSRF — Introducing CSPT2CSRF」および同社ホワイトペーパー「CSRF is dead, long live CSRF」は、本節では PayloadsAllTheThings 経由の内容と検索結果に基づいて要約しています。一次情報を精読したい場合は次を直接ご覧ください: https://blog.doyensec.com/2024/07/02/cspt2csrf.html ／ https://www.doyensec.com/resources/Doyensec_CSPT2CSRF_Whitepaper.pdf
>
> 出典: PayloadsAllTheThings — Client Side Path Traversal（CSPT2CSRF） — https://swisskyrepo.github.io/PayloadsAllTheThings/Client%20Side%20Path%20Traversal/

---

### 検出と防御

#### 検出（防御目的の自己診断）

- **JAW**（研究者・大規模監査向け）: HPG + Cypher で「ソース→シンク」の偽造可能フローを網羅的に洗い出す。自社アプリの JS を Neo4j に取り込み、同梱クエリで client-side CSRF・DOM Clobbering・open redirect を検査できる。
- **CSPTBurpExtension**（実務向け）: Burp Suite 拡張。クライアント制御可能なソースと、パスに到達するリクエストシンクを突き合わせて CSPT を発見する。
- **CSPTPlayground**: 手法を安全に学ぶための練習用ラボ環境。

いずれも自分が管理する（または許可を得た）対象に対してのみ用いること。実在サービスや本番環境への無許可の検証・破壊的操作は行わない。

#### 防御（設計原則）

client-side CSRF / CSPT2CSRF は「ソースからシンクへ攻撃者データが素通りする」ことが根本原因なので、対策も同じ軸で立てる。

1. **入力の出所を信用しない**: `location.hash` / `location.search` / `postMessage` の `event.data` / `document.referrer` / WebStorage は攻撃者制御下にありうる。これらをリクエスト URL に流す前に検証する。
2. **`postMessage` は必ず `origin` を検証**する。送信側も `targetOrigin` を明示する。
3. **リクエスト URL の組み立てを安全化**する。
   - パスに入れる値は `encodeURIComponent()` でエンコードし、`../` が「ディレクトリ移動」として解釈されないようにする。
   - **URL パーツを文字列連結で組まない**。`URL` オブジェクトや、ベース URL を固定したうえでのパラメータ API（`URLSearchParams`）を使い、パスの分節を安全に扱う。
   - 宛先を**許可リスト（allowlist）** で制約する。可変にするなら「識別子（数値 ID 等）」のみを受け取り、パス構造そのものを攻撃者に決めさせない。
4. **サーバ側で正規化後のパス／エンドポイントを検証**する。想定外のエンドポイントへの内部リクエストを弾く。
5. **CSP（Content Security Policy）** で `connect-src` を絞り、意図しない宛先への `fetch`/`XHR` を抑止する（多層防御）。
6. **DOM Clobbering 対策**: グローバル変数を DOM 要素で上書きされない書き方（`window.x` に頼らない、`Object.freeze`、明示的な型チェック）を徹底する。

要するに、`SameSite` や CSRF トークンといった「サーバ側 CSRF 対策」は client-side CSRF / CSPT2CSRF には効かないことを前提に、**クライアント側のデータフロー（source→sink）を断つ**設計が本質的な防御になる。

> 出典: JAW GitHub — https://github.com/SoheilKhodayari/JAW ／ PayloadsAllTheThings — Client Side Path Traversal — https://swisskyrepo.github.io/PayloadsAllTheThings/Client%20Side%20Path%20Traversal/

---

### まとめ

- 古典的 CSRF が `SameSite` 等で封じられても、攻撃の起点はクライアント側 JavaScript へ移った。リクエストを送るのがページ自身の正規コードである以上、Cookie は自動付与され、`SameSite` やトークンは前提から崩れる。
- **client-side CSRF**（JAW, USENIX Sec 2021）は、`window.location`・`postMessage` 等の **source** から `fetch`・`XHR` 等の **sink** へ攻撃者データが到達し、偽造可能リクエストが生まれる問題。106 アプリ / 2.28 億行の解析で 87 アプリに脆弱性、12,701 件の偽造可能リクエスト、203 件が悪用可能という規模で実在が示された。
- **CSPT2CSRF**（Doyensec, 2024）は、フロントエンドが組む API パスに `../` を注入して正規リクエストを別エンドポイントへ再ルーティングする実務的手口。POST/PATCH/DELETE でも成立し、CSRF トークンと `SameSite=Lax` を回避しうる。攻撃者が握るのは原則「パスのみ」という制約が攻防の鍵。
- 防御は一貫して「クライアント側の source→sink を断つ」こと。入力の出所を信用せず、パスを安全に組み立て（`encodeURIComponent`・allowlist）、`postMessage` の origin を検証し、CSP で宛先を絞る。
