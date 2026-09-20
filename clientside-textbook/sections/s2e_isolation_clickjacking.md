## Site Isolation・Spectre緩和・クリックジャッキング前提

### この節で扱うこと

ここまでの節で扱ってきた同一オリジンポリシー（SOP）・CORS・Cookie属性・CSPは、いずれも**レンダラプロセスの内側で、ブラウザが自主的に守るルール**でした。ところが2018年のSpectre／Meltdown公表以降、「レンダラプロセスの内側のルールは、CPUのサイドチャネルやレンダラの脆弱性の前では前提が崩れる」ことが明確になりました。そこでChromeが導入したのが **Site Isolation（サイト分離）** ——「異なるサイトのコンテンツを、そもそも同じOSプロセスのメモリ空間に同居させない」という、OSレベルの防御線です。

本節では次の3つを、原典に沿って仕組みレベルで解説します。

1. **Spectre／Meltdown がWebに何を要求したか**（高精度タイマー規制、`SharedArrayBuffer` 無効化、V8の緩和）
2. **Site Isolation の設計**（「サイト」の定義、OOPIF、CORB／ORB、脅威モデル、メモリコスト、開発者から見た挙動変化）
3. **クリックジャッキング（UI redress）の前提と防御**（`frame-ancestors`、`X-Frame-Options`、SameSite、なぜ素朴なframe busterは破られるか）

この3つを1つの節にまとめるのは偶然ではありません。いずれも「**攻撃者のページが、あなたのページやデータを自分のプロセス／自分のフレームツリーに引き込めるか**」という同一の問いに対する、別々のレイヤの答えだからです。Spectreは「引き込まれたデータはメモリから読まれ得る」と教え、Site Isolation／CORBは「そもそも引き込ませない」で応え、クリックジャッキング防御は「そもそも埋め込ませない」で応えます。

> **スコープの注意**: 本節は防御・検出のための解説です。記載する設定・スクリプト・挙動の確認手順は、自分が所有するか明示的な許可を得た環境でのみ試してください。実在サービスの本番環境への無許可検証は行わないでください。

---

### 1. Spectre／Meltdown ——「同じプロセスにあるメモリは読まれうる」

#### 1.1 何が起きたのか

2018年1月3日に公表された Meltdown と Spectre は、ソフトウェアのバグではなく、**現代CPUの投機的実行（speculative execution）というマイクロアーキテクチャ上の最適化そのもの**に起因する脆弱性です。Chrome for Developers の解説記事は、この一次情報（Project Zero のブログ等）を前提としたうえで、「Webプラットフォームにとって何が変わるか」に話を絞っています。

> ⚠️ 原典（`developer.chrome.com/blog/meltdown-spectre`）は投機的実行やキャッシュタイミングの仕組み自体は既存の解説に譲っており、具体的な数値やバージョンも記載していません。**（以下1.2のCPU側の仕組みと、1.3の数値・バージョンは、原典の内容を理解するための一般知識に基づく補足です。）**

#### 1.2 仕組み（補足）

投機的実行とは、CPUが分岐の結果を待たずに「たぶんこちらに進む」と予測して先に命令を実行しておき、予測が外れたらアーキテクチャ上の状態（レジスタやメモリ）を巻き戻す仕組みです。問題は、**巻き戻されるのはアーキテクチャ状態だけで、CPUキャッシュの状態は巻き戻らない**点にあります。

典型的な Spectre variant 1（境界チェックバイパス）の骨格はこうです。

```c
// 攻撃者が index を制御できる。array1_size より大きい値を渡す。
if (index < array1_size) {          // ← 分岐予測を「成立する」と訓練しておく
    y = array2[ array1[index] * 4096 ];  // ← 投機的に境界外読み出しが実行される
}
```

1. 攻撃者は `index` に正常値を何度も渡し、分岐予測器に「この分岐は成立する」と学習させる。
2. その後 `index` に境界外の値を渡す。CPUは `array1_size` のロード完了を待たずに投機実行し、**本来読めないはずの `array1[index]`（＝秘密の1バイト）**を読む。
3. その値を添字に使って `array2` を触るため、**秘密の値に対応するキャッシュラインだけがキャッシュに載る**。
4. 分岐が実は不成立だと判明し、投機はロールバックされる。しかしキャッシュは汚れたまま。
5. 攻撃者は `array2` の各要素へのアクセス時間を測り、**速く読めた要素の添字＝秘密の値**として復元する（フラッシュ＆リロード）。

ここでWeb特有の重要点は、**この攻撃はJavaScriptからも成立しうる**ことです。JITコンパイルされたJSコードも同じCPU上で投機実行されるため、「攻撃者のJSが、同じレンダラプロセスのアドレス空間にある他サイトのデータを読む」という、SOPを完全に無効化するシナリオが現実味を帯びました。

#### 1.3 ブラウザ側の緩和 —— タイマーを鈍らせる

上記ステップ5が示すとおり、この攻撃は**高精度な時間計測能力**に依存します。そこで主要ブラウザは真っ先にタイマーを潰しました。原典は次のように述べています。

- **`performance.now()` の分解能低下**: 「すべての主要ブラウザが `performance.now()` の分解能を下げた」。
  - （補足: Chrome 64（2018年1月）では分解能を **20µs から 100µs** へ粗くし、さらに**ランダムなジッタ（揺らぎ）**を加えました。ジッタが重要なのは、単に丸めただけでは「同じ測定を何千回も繰り返して平均を取る」ことで分解能を復元できてしまうためです。後年、クロスオリジン分離（COOP+COEP）済みのページに限って 5µs へ戻されています。）
- **`SharedArrayBuffer` の無効化**: 原典は「他の緩和が整うまで `SharedArrayBuffer` を無効化することを決めた」と述べています。これが必要だったのは、SABがあれば**自前の高精度タイマーを作れてしまう**からです。

```js
// SharedArrayBuffer を使った「自作タイマー」の原理（歴史的な攻撃手法の説明）
// Worker 側: 共有メモリ上のカウンタをひたすらインクリメントし続ける
const counter = new Uint32Array(sharedBuffer);
while (true) { Atomics.add(counter, 0, 1); }
// メイン側: 計測前後でカウンタを読むだけで、ナノ秒級の相対時間が得られる
```

`performance.now()` をいくら鈍らせても、SABとWorkerの組み合わせでこのような**インクリメント・カウンタ**を作られれば分解能規制は無意味になります。だからSABは「タイマー規制の抜け穴」として一時的に全面停止されました。
（補足: SABは Chrome 68 でデスクトップに復活したのち、2021年の Chrome 92 以降は **`Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy: require-corp` を両方設定した「クロスオリジン分離」状態のページでのみ利用可能**という条件付き復帰になりました。後述のCOOP/COEPが「高精度機能を使うためのパスポート」になっている背景がこれです。）

- **V8 の変更**: V8チームは既知のPoCに対する緩和を実装し、TurboFan（V8の最適化コンパイラ）のコード生成を変更しました。原典は「これらのコード生成の変更は性能上のペナルティを伴いうる」と明記しています。

そして原典は、これらはあくまで対症療法であり、**本命の防御は Site Isolation** だと位置づけます。「異なるWebサイトのページは常に異なるプロセスに置かれ、それぞれがサンドボックス内で動作する」——つまり、**読まれて困るデータをそもそも攻撃者のプロセスに入れない**というアプローチです。当時のユーザは `chrome://flags#enable-site-per-process` でオプトインできました。

> 出典: Meltdown/Spectre — https://developer.chrome.com/blog/meltdown-spectre

---

### 2. Site Isolation の設計

#### 2.1 「サイト（site）」とは何か —— オリジンとの違い

Site Isolation の設計を理解する最大の鍵は、分離の単位が**オリジンではなく「サイト」**である点です。Chromium公式ドキュメントの定義はこうです。

> サイトとは「**スキーム（scheme）と、パブリックサフィックスを含む登録済みドメイン名**。ただしサブドメイン・ポート・パスは無視する」

したがって：

| URL | オリジン | サイト |
|---|---|---|
| `https://foo.example.com:8080/a` | `https://foo.example.com:8080` | `https://example.com` |
| `https://bar.example.com/b` | `https://bar.example.com` | `https://example.com` |
| `http://example.com/` | `http://example.com` | `http://example.com`（スキームが違うので別サイト） |
| `https://user.github.io/` | `https://user.github.io` | `https://user.github.io`（`github.io` はパブリックサフィックス） |

ここで「登録済みドメイン名（registrable domain）」は、Public Suffix List（`.com`、`.co.jp`、`.github.io` などの一覧）を引いて決まる eTLD+1 です。`user.github.io` が独立したサイトになるのは、`github.io` がパブリックサフィックスとして登録されているためで、これが無ければユーザ投稿ページ同士が同一プロセスに同居してしまいます。

**なぜオリジンではなくサイトなのか**。原典は互換性を理由に挙げています。古いWebページは `document.domain` を書き換えて `a.example.com` と `b.example.com` を同一オリジン扱いにする（＝同期的にDOMを触り合う）ことができ、これは**同一プロセスでなければ実装できません**。オリジン単位で分離してしまうとこの機能が壊れるため、分離の粒度をサイトまで緩めた、という設計上のトレードオフです。

（補足・時事性: この `document.domain` による緩和は非推奨化が進み、**Chrome 115（2023年）以降はデフォルトで `document.domain` の設定が効かなくなりました**。そのため「サイト単位で妥協する理由」は今後弱まっていきます。より厳密な分離を望む場合の手段は、実験的な `chrome://flags#strict-origin-isolation`（原典に記載。`document.domain` の書き換えが壊れると明記）と、サーバが宣言する **`Origin-Agent-Cluster: ?1`** ヘッダです。後者は「このオリジンは `document.domain` を使わないので、オリジン単位のエージェントクラスタに置いてよい」とブラウザに伝えるもので、ブラウザはそれをプロセス分離のヒントとして利用できます。）

#### 2.2 脅威モデル —— 何から守るのか

原典は3つの攻撃ベクタを挙げています。

1. **侵害されたレンダラプロセス（compromised renderer）**
   レンダラは巨大なパーサとJITの塊であり、バグは現実に存在します。原典は「M69 ではレンダラコンポーネントに悪用可能性のあるバグが10件」あり、以降のリリースでも同様の件数だと述べています。つまり「レンダラは落ちる前提で設計する」のが出発点です。レンダラが乗っ取られても、そのプロセスに他サイトのデータが無ければ盗めません。

2. **Universal XSS（UXSS）**
   プロセスを完全に掌握しなくても、**レンダラ内部のSOPチェックを回避する**種類のバグ。SOPが「同じプロセス内のソフトウェアチェック」である以上、チェックそのものにバグがあれば破れます。プロセス境界はソフトウェアチェックではなくOSの保護なので、この層を迂回できません。

3. **サイドチャネル攻撃（Spectre系）**
   原典の表現では「Chrome にバグが無くても、レンダラプロセスのメモリを任意に読める」。バグではないので、パッチでは塞げません。**メモリ空間を分ける以外に根本策が無い**というのが、Site Isolation が最重要である理由です。

#### 2.3 実装 —— OOPIF とデータブロッキング

**Out-of-Process iframes（OOPIF）**: 原典いわく「クロスサイトのドキュメントは、現在のタブ内・新しいタブ・iframe のいずれのナビゲーションであっても、常に異なるプロセスに置かれる」。従来「1タブ＝1レンダラプロセス」だったモデルが、「1フレームツリー＝複数プロセスにまたがる」モデルに変わります。各プロセスはChromeのサンドボックス内で動き、できることが制限されます。

**データブロッキング**: 「クロスサイトのデータ（HTML、XML、JSON、PDFなど）は、サーバが（CORSを用いて）許可すると言わない限り、Webページのプロセスに配送されない」。これが次節のCORBです。

#### 2.4 プラットフォームとコスト

| プラットフォーム | 状況 |
|---|---|
| デスクトップ（Windows / Mac / Linux / ChromeOS） | **Chrome 67 で全サイトに対してデフォルト有効**（2018年） |
| Android | **Chrome 77 以降、RAM 2GB以上の端末**で、まずユーザがログインするサイト（認証サイト）を対象に有効化。のちにOAuthサイトやCOOP採用サイトへ拡大 |
| Android WebView / RAM 2GB未満の端末 | 非対応 |

メモリオーバーヘッドの実測値（原典記載）:

- デスクトップ Chrome 67: 多数のタブを開いて**全サイトを分離した場合に約 10〜13%**
- Android Chrome 77: **ログイン対象サイトのみを分離して約 3〜5%**

Androidが「全サイト」ではなく「ログインするサイト」に絞ったのは、この数字がそのまま理由です。プロセスごとにV8ヒープやレンダラの常駐コストが乗るため、分離するサイト数とメモリは比例します。

#### 2.5 設定・検証方法

```text
# 全サイト分離（デスクトップは既定で有効。Android等で強制したい場合）
chrome://flags#enable-site-per-process
--site-per-process
エンタープライズポリシー: SitePerProcess / SitePerProcessAndroid

# 特定オリジンだけを（サイトより細かく）分離
chrome://flags/#isolate-origins
--isolate-origins=https://foo.example.com,https://[*.]corp.example.com
エンタープライズポリシー: IsolateOrigins / IsolateOriginsAndroid

# 実験的な厳密オリジン分離（document.domain の書き換えが壊れる）
chrome://flags#strict-origin-isolation
```

有効になっているかの確認手順（原典記載）:

1. クロスサイトiframeを含むテストページを開く（原典の例: `http://csreis.github.io/tests/cross-site-iframe.html`）
2. **Chromeのタスクマネージャ（Shift+Esc）**を開き、メインページとサブフレームが**別プロセス**として並んでいることを確認する
3. `chrome://process-internals` で現在の設定状態を確認する

なお、ローカル開発で `--disable-web-security` を使う場合、原典は **`--disable-features=IsolateOrigins,site-per-process` も併せて指定する必要がある**と注意しています。プロセスが分かれているとSOP無効化フラグが期待どおりに効かないためです。

> 出典: Site Isolation（Chromium） — https://www.chromium.org/Home/chromium-security/site-isolation/

---

### 3. Cross-Origin Read Blocking（CORB）

#### 3.1 何をするものか

Site Isolation でプロセスを分けても、**攻撃者のページが自分のプロセスに他サイトのデータを「正規の手順で」引き込めてしまえば**意味がありません。`<img>` や `<script>` はCORSなしでクロスオリジンのバイトを取得できるからです。

CORBは、**レンダラプロセスが機微なクロスオリジンのデータリソース（HTML・XML・JSON）を受け取ること自体を防ぎ、代わりに空のレスポンスを見せる**仕組みです。重要なのは「リクエスト自体はバックグラウンドで発生する」点——ネットワーク的な副作用（キャッシュ、Cookie送信、サーバ側の処理）は起きますが、**バイト列がレンダラのメモリに入らない**ようにします。Spectre対策としてはこれで十分です。「読めないメモリ」は投機実行でも読めません。

#### 3.2 CORBが守る具体的な攻撃

原典が挙げる例:

```html
<!-- 攻撃者のページ。どちらも CORS プリフライトなしにリクエストが飛ぶ -->
<img src="https://your-bank.example/balance.json" />
<script src="https://your-bank.example/balance.json"></script>
```

`balance.json` は画像でもJSでもないので、**描画も実行もされません**（そこは従来どおり）。しかしCORBが無ければ、**そのJSONのバイト列は攻撃者ページのレンダラプロセスのメモリ上に一度載ります**。Spectre があれば、そこから読み出される可能性がある——これがCORBの動機です。

#### 3.3 判定ロジックと `nosniff` の役割

CORBがクロスオリジンのデータリソースをブロックする条件（原典の記述）:

- レスポンスに **`X-Content-Type-Options: nosniff`** が付いている、**かつ**
- CORSヘッダが明示的にアクセスを許可していない

`nosniff` が無い場合、CORBは**コンテンツスニッフィング**（中身のバイト列を覗いてMIMEタイプを推測する）を行います。なぜそんな面倒なことをするかというと、現実のサーバは `Content-Type` を間違えるからです（原典の例: 画像を `text/html` で配信する）。

そしてここが実務上もっとも重要な点です。**スニッフィングは「寛容side」に倒れるよう設計されています**。理由は、正規のJavaScriptファイルを誤ってブロックしてしまえばサイトが壊れるからです。つまり、

> スニッフィングに頼ると「ブロックされるべきだがされない」ケースが残る。明示的なヘッダを付けることが、より強い保護になる。

Chromium公式も同じことを別の言い方で述べています——CORBは「ベストエフォートのアプローチ」であり、ラベルの誤ったリソースとの互換性維持という制約を負っている、と。

#### 3.4 開発者がすべきこと

```http
# 1. 正しい Content-Type を付ける
Content-Type: application/json; charset=utf-8     # JSON API
Content-Type: text/html; charset=utf-8            # HTML
Content-Type: application/xml                     # XML

# 2. スニッフィングをオプトアウトする（特にユーザ固有・機微な内容のURL全て）
X-Content-Type-Options: nosniff
```

Meltdown/Spectre記事側の推奨も合わせると、開発者向けのチェックリストは次のとおりです。

- `SameSite` Cookie属性を使う（「Cookieは同一サイト由来のリクエストにのみ付与されるべき」）
- `HttpOnly` を付け、`document.cookie` の読み出しを最小化する（＝Cookie値をレンダラのJSヒープに載せない）
- **ユーザ固有・機微な内容を持つ全URLに `X-Content-Type-Options: nosniff` を付ける**
- `target="_blank"` で外部リンクを開くときは `rel="noopener"` を付ける（開いた側とのプロセス／ウィンドウ参照を切る）

（補足・時事性: CORBは2023年前後から **ORB（Opaque Response Blocking）** に置き換えが進んでいます。CORBが「HTML/XML/JSONという特定のタイプをブロックする」ブロックリスト的発想だったのに対し、ORBは「`no-cors` で取得したレスポンスは、画像・メディア・スクリプト等として正当に解釈できるものを除き**すべて**不透明化してブロックする」というアロー／デニーの向きを反転させた設計です。開発者側の対処——正しい `Content-Type` と `nosniff`——は変わりません。）

> 出典: Site Isolation for web developers — https://developer.chrome.com/blog/site-isolation

---

### 4. 開発者から見た挙動変化 —— 「同期的な全ページレイアウト」の終わり

Site Isolation はセキュリティ機能ですが、**Webプラットフォームの観測可能な挙動を変えました**。バグハンティングでも「なぜこのpostMessageが届かないのか」「なぜこのビーコンが欠測するのか」を判断するのに必要な知識です。

#### 4.1 クロスオリジンのレイアウトは非同期になった

Chromium公式の表現: 「**ページのフレームが複数プロセスに分散しうるため、全ページレイアウトはもはや同期的ではない**」。

壊れるパターンの典型:

```js
// 親フレーム側（アンチパターン）
const iframe = document.querySelector('#child');   // クロスオリジンの iframe
iframe.style.width = '800px';                      // ① リサイズ
iframe.contentWindow.postMessage('resized', '*');  // ② 直後に通知

// 子フレーム側
addEventListener('message', () => {
  // ③ ここで document.documentElement.clientWidth を読むと、
  //    まだ古い幅（リサイズ前）が返る可能性がある
});
```

**なぜそうなるか**: ①のレイアウト変更は親プロセスで起き、新しいサイズが子プロセスへ伝播するのは**プロセス間通信（IPC）経由の非同期処理**です。一方②の `postMessage` も別のIPCで飛びます。同一プロセス時代は①が同期的に子のレイアウトまで更新していたので順序が保証されていましたが、プロセスが分かれると**2つのメッセージの到着順や反映タイミングが保証されません**。

**対処**: サイズに依存する処理は、子フレーム側で `resize` イベントを待つなど、**イベント駆動**に書き換えます。「親が通知したから子のレイアウトは更新済みのはず」という仮定を置かないことです。

#### 4.2 `unload` ハンドラは信頼できない

原典が挙げる2つの変化:

1. **タイムアウト**: 同一プロセスの `unload` ハンドラは従来（事実上）いつまでも走れましたが、**クロスプロセスの `unload` ハンドラは閾値を超えると打ち切られます**。
2. **並列実行**: 従来は厳密にトップダウン順（親→子）に実行されていたものが、**プロセスをまたぐハンドラは並列に実行される**ようになりました。

さらにChromium公式は「`unload` ハンドラは実行されないことがあり、`unload` ハンドラからの `postMessage` は失敗する」と明記しています。

```js
// アンチパターン: unload で時間のかかる処理
addEventListener('unload', () => {
  doSomethingThatMightTakeALongTime();  // 打ち切られる可能性がある
});
```

**セッション終了ping等の推奨形**:

```js
// 推奨1: sendBeacon（ブラウザがページ破棄後もリクエストを送り切ることを保証する）
addEventListener('pagehide', () => {
  navigator.sendBeacon('/end-of-session');
});

// 推奨2: fetch の keepalive（ペイロードやメソッドを制御したい場合）
addEventListener('pagehide', () => {
  fetch('/end-of-session', {keepalive: true});
});
```

原典は「信頼性の理由から、`beforeunload` や `unload` より **`pagehide` イベントを使うことを推奨する**」と述べています。これは Site Isolation とは独立の理由（bfcache＝バックフォワードキャッシュとの相性、モバイルでのプロセス強制終了）もあります。`sendBeacon` / `keepalive` が効くのは、**リクエストの送信主体がレンダラではなくブラウザプロセス側のネットワークサービスに移譲される**ためで、レンダラが消えても送信が継続します。

#### 4.3 DevToolsの制約

原典の記述: 「`unload` ハンドラに対するDevToolsのサポートはほぼ欠落している。たとえば `unload` ハンドラ内のブレークポイントは効かず、`unload` 中に発行されたリクエストはNetworkパネルに現れず、`console.log` の出力も表示されないことがある」（Chromium issue #851882）。

**ハンター視点**: 「Networkパネルに出ていないから通信していない」は誤りです。ページ遷移直前に送出されるビーコンやテレメトリは、DevToolsの "Preserve log" を有効にしてもなお取りこぼされることがあります。プロキシ（自分の検証環境で）やネットワークレベルの観測で裏取りするのが確実です。

> 出典: Site Isolation for web developers — https://developer.chrome.com/blog/site-isolation

#### 4.4 Post-Spectre Web Development —— サーバ側で引ける3本の線

Chromium公式は、Site Isolation のある／ないブラウザ双方でコンテンツを守るため、**「Post-Spectre Web Development」のガイドラインに従うこと**を強く推奨しています。具体的なレスポンスヘッダとして挙げられているのは次の3つです。

| ヘッダ | 役割 |
|---|---|
| `Cross-Origin-Resource-Policy`（CORP） | **どのプロセスがこのリソースを読み込めるか**を制御する。`same-origin` / `same-site` / `cross-origin` |
| `Cross-Origin-Opener-Policy`（COOP） | **プロセス境界の追加制御**。`same-origin` にすると、`window.open` 等で開かれた／開いた相手との `window` 参照を切り、別プロセスに追い出せる |
| `Sec-Fetch-*` | サーバ側で**リクエストの発生源を検証**できるようにするフェッチメタデータ（`Sec-Fetch-Site`、`Sec-Fetch-Mode`、`Sec-Fetch-Dest`） |

実務上の最小構成の例:

```http
# 機微なAPIレスポンス／ユーザ固有の画像などに
Cross-Origin-Resource-Policy: same-origin
X-Content-Type-Options: nosniff
Content-Type: application/json; charset=utf-8

# トップレベルドキュメントに（SharedArrayBuffer等が必要なら COEP と併用）
Cross-Origin-Opener-Policy: same-origin
```

**なぜCORPが効くのか**: CORBが「ブラウザがヒューリスティックで機微そうなものを守る」仕組みなのに対し、CORPは**サーバ自身が「これは他サイトのプロセスに渡すな」と宣言する**仕組みです。ヒューリスティック（スニッフィング）に依存しないので、画像やスクリプトのような「CORBが守れないタイプ」も守れます。つまり CORB／ORB のベストエフォート性を、サーバ側の明示宣言で補う関係にあります。

**`Sec-Fetch-*` によるサーバ側検証の例**:

```
GET /api/me HTTP/1.1
Sec-Fetch-Site: cross-site      ← 他サイトからの読み込み
Sec-Fetch-Mode: no-cors         ← <img>/<script> 等での埋め込み
Sec-Fetch-Dest: image           ← 画像として使おうとしている
```

JSON APIに対してこの組み合わせが来たら、それは正当な利用ではありません（Resource Isolation Policyとして拒否できる）。CSRFやクロスサイトのデータ吸い出しに対する、Origin/Refererより堅い判定材料になります。

> 出典: Site Isolation（Chromium） — https://www.chromium.org/Home/chromium-security/site-isolation/

---

### 5. クリックジャッキング（UI redress）—— 「埋め込ませない」防御

ここまでは「データを攻撃者のプロセスに渡さない」話でした。クリックジャッキングは逆向きで、「**攻撃者のページの中に、あなたのページを（ユーザのCookie付きで）埋め込まれる**」ことが出発点です。

#### 5.1 攻撃の構造

OWASPの定義: クリックジャッキング（別名 UI redress attack）は、**フレームやiframe内のコンテンツに要素を重ね合わせ、ユーザに隠れた要素をクリックさせる**攻撃です。

原理は単純です。攻撃者は自分のページに被害サイトを `<iframe>` で読み込み、CSSで `opacity: 0` にして透明化し、その下（または上）に「ここをクリック」と書いた餌を置きます。ユーザは餌をクリックしたつもりで、実際には**被害サイト上のボタン（送金確定、権限付与、連携アプリ承認など）を、自分のログインセッションで押している**ことになります。ブラウザから見れば、これは正真正銘ユーザ本人のクリックなので、CSRFトークンも効きません（リクエストは被害サイト自身のフォームから正しいトークン付きで飛ぶ）。

したがって防御は「リクエストを検証する」側ではなく、「**そもそも埋め込みを許さない**」側で行う必要があります。

#### 5.2 第一の防御: CSP `frame-ancestors`

`frame-ancestors` ディレクティブは、**ブラウザにページのフレーム内レンダリングを拒否させます**。

```http
# すべての埋め込みを禁止（OWASPが既定として推奨）
Content-Security-Policy: frame-ancestors 'none';

# 同一オリジンからの埋め込みのみ許可
Content-Security-Policy: frame-ancestors 'self';

# 複数ドメインを許可
Content-Security-Policy: frame-ancestors 'self' *.somesite.com https://myfriend.site.com;
```

**なぜ `frame-ancestors` が `X-Frame-Options` より優れるのか**: ①ワイルドカードを含む複数オリジンを列挙できる、②**フレームツリー全体（祖先すべて）**を検査対象にするので入れ子フレームでも正しく動く、③CSPという統一された仕組みの一部として管理できる、の3点です。

**制限（原典記載）**: 古いブラウザ（Chrome 40、Firefox 35として原典が挙げるもの）は、仕様の要求に反して `frame-ancestors` より `X-Frame-Options` を優先することがあります。現代のブラウザでは `frame-ancestors` が優先されますが、両方を出すのが安全です（矛盾する場合は `frame-ancestors` が勝つ、と覚えておけば運用できます）。

なお `frame-ancestors` は `<meta>` タグでは指定できません。**HTTPレスポンスヘッダでのみ有効**です（ページの一部がレンダリングされた後でフレーム拒否を決めても手遅れだからです）。

#### 5.3 第二の防御: `X-Frame-Options`（XFO）

3つの値があります。

| 値 | 意味 | 評価 |
|---|---|---|
| `DENY` | いかなるフレーミングも禁止 | **推奨** |
| `SAMEORIGIN` | 同一オリジンからのフレーミングのみ許可 | 条件付きで可 |
| `ALLOW-FROM uri` | 特定ドメインからのみ許可 | **廃止済み。現代のブラウザでは fail open（＝無視され、防御が無くなる）** |

`ALLOW-FROM` の「fail open」は特に危険です。`ALLOW-FROM https://partner.example` と書いてあると担当者は「制限できている」と誤解しますが、実際にはヘッダ全体が無視され、**どこからでも埋め込める**状態になります。監査時の定番の指摘項目です。

OWASPが挙げるXFOの制限:

- **ページ単位の設定が必要**で、サイト全体に一括適用する仕組みがない（実際にはWebサーバやリバースプロキシで全レスポンスに付与するのが定石）
- **複数ドメイン許可のシナリオに対応できない**
- `ALLOW-FROM` は非推奨かつ現行ブラウザで機能しない
- **Webプロキシがヘッダを削除してしまうことがある**（企業プロキシ等がヘッダを書き換える環境では防御が消える）
- `SAMEORIGIN` / `ALLOW-FROM` は**トップレベルのコンテキストのみを見る**仕様だったため、入れ子フレーム（攻撃者 → 同一オリジン → 被害ページ）で期待どおり働かないことがある

最後の項目が `frame-ancestors` への移行を決定づけた理由です。ブラウザによっては `SAMEORIGIN` の判定で**直近の親だけ**を見るか**最上位だけ**を見るかが異なり、「攻撃者ページ → 被害サイトの別ページ → 被害ページ」という二段構えで回避される余地がありました。`frame-ancestors` は祖先チェーン全体を検査するので、この穴がありません。

#### 5.4 第三の防御: SameSite Cookie

`SameSite=Strict` または `SameSite=Lax` が付いたCookieは、**クロスオリジンのiframeからのリクエストには送信されません**。クリックジャッキングは「被害者のセッションで操作させる」攻撃なので、セッションCookieが送られなければ、埋め込まれたページは未ログイン状態で表示され、攻撃は成立しません。

ただしOWASPは補助的手段と位置づけています。理由:

- **ユーザが認証されていることが前提の攻撃にしか効かない**（未認証でも意味のある操作があるなら守れない）
- 原典の数字として「**2020年11月時点で約6%のブラウザが未対応**」
- 他の防御と**併用**すべき

（補足・時事性: 2020年以降、Chromeは `SameSite` 未指定のCookieを `Lax` 相当として扱う方針を段階的に展開しました。したがって現代の主要ブラウザでは「明示的に `SameSite=None; Secure` を付けたCookieだけがクロスサイトiframeに送られる」状態が既定です。逆に言えば、埋め込み用途のためにやむを得ず `SameSite=None` にしているサービスでは、この防御層が最初から存在しません。そういうサービスこそ `frame-ancestors` を厳密に設定する必要があります。）

#### 5.5 `window.confirm()` による緩和

どうしてもフレーム可能なままにしなければならない場合、OWASPは `window.confirm()` の利用を挙げています。

**なぜ効くのか**: `confirm()` が表示するダイアログは**フレーム内に埋め込めないブラウザUI**であり、かつ**呼び出し元のドメインを表示します**。攻撃者は透明iframeの上にこのダイアログを隠すことも、見た目を偽装することもできません。ユーザは「いま自分が操作しているのはこのドメインだ」と気づけるため、ソーシャルエンジニアリングへの気づきを与えられます。根本対策ではなく、あくまで「フレーム可能でなければならない」制約下での次善策です。

#### 5.6 レガシー向け frame breaker —— なぜ素朴な実装は破られるか

ヘッダに対応しない古いブラウザ向けに、JavaScriptで「自分がフレーム内にいたら最上位に脱出する」frame buster（フレームバスター）を書く手法があります。しかし**素朴な実装はほぼ確実に破られます**。OWASPが挙げる破り方を、仕組みとともに見ていきます。

**(a) 二重フレーミング（Double Framing）**
攻撃者は被害ページを**2枚のフレームで入れ子に**します。`parent.location = self.location` と書いた frame buster は、`parent`（＝攻撃者が作った中間フレーム）が**クロスオリジンなので `location` への代入がセキュリティ違反となり例外になる**、あるいはナビゲーションが無効化されます。結果、脱出できません。`top.location` を使えば回避できますが、それも次の手で潰されます。

**(b) `onBeforeUnload` ハンドラ**
フレーミング側のページが `beforeunload` ハンドラを登録しておくと、frame buster が `top.location` を書き換えようとした瞬間に、ブラウザが「このページを離れますか？」という確認ダイアログを出します。攻撃者はそのメッセージに「PayPalを終了しますか？」のような偽のテキストを仕込み、ユーザに**キャンセルを押させます**。ユーザがキャンセルすれば、正当な脱出ナビゲーションが取り消されます。

**(c) No-Content フラッシング（204応答の連打）**
攻撃者は `204 No Content` を返すURLへ**繰り返しナビゲーションを発行します**。204はページを遷移させないため、ブラウザはリクエストパイプラインをフラッシュするだけで、**ユーザへのプロンプトなしに、到着中のナビゲーション（＝frame busterの脱出）をキャンセル**できます。(b)のようにユーザの操作を必要としない点でより強力です。

**(d) `sandbox` 属性**
`<iframe sandbox>` は、`allow-scripts` を与えない限り**サブフレーム内のJavaScriptを完全に無効化します**。frame buster はJavaScriptなので、実行されずに終わります。しかも攻撃者は `allow-forms` だけを与える、といった選択が可能なので、**フォーム送信は機能するがスクリプトは死ぬ**という、クリックジャッキングに最適な状態を作れます。Firefox の `designMode` にも類似の効果があります。

> **これが最重要の結論です**: JavaScriptベースの frame buster は、**フレームの外側にいる攻撃者が常に有利**です。攻撃者はフレームツリーの親として、子のナビゲーション・スクリプト実行・イベントを制御できるからです。防御は必ず**ブラウザがレンダリング前に判断できるHTTPヘッダ**（`frame-ancestors` / `X-Frame-Options`）で行い、スクリプトは互換性のための補助に留めてください。

**OWASP推奨の「現時点で最善のレガシー向け frame breaking スクリプト」**:

```html
<style id="antiClickjack">body{display:none !important;}</style>
<script type="text/javascript">
if (self === top) {
    var antiClickjack = document.getElementById("antiClickjack");
    antiClickjack.parentNode.removeChild(antiClickjack);
} else {
    top.location = self.location;
}
</script>
```

**なぜこの形なのか**（ここが設計の妙です）:

1. **CSSで先に `body` を隠す**。`<head>` 内に置くため、`body` がレンダリングされる前に `display: none !important` が適用されます。つまり**デフォルトが「見えない」**状態です。
2. **フレーム内でないと確認できたときだけ、そのstyle要素をDOMから削除して表示する**（`self === top`）。
3. フレーム内なら `top.location = self.location` で脱出を試みる。
4. 仮に(a)〜(d)の手法で**脱出に失敗しても、`body` は隠れたまま**です。クリックジャッキングは「見えている（あるいは透明に重ねられた）UIを押させる」攻撃なので、**押すべきボタンがレンダリングされていなければ攻撃は成立しません**。
5. スクリプトが `sandbox` で殺された場合も、**style要素を削除する処理が走らない**ので `body` は隠れたままです。**フェイルセーフ（失敗時に安全側に倒れる）**設計になっています。

原典が「両方の保護を `<head>` に置くことで、1回の実装で済む」と述べているのはこの点です。

（注意: 当然ながら、JSが無効な正規ユーザにもページが見えなくなります。ヘッダが使える現代環境では、このスクリプトは不要か、明確に古いブラウザを支える必要がある場合の選択肢です。）

#### 5.7 多層防御としてのまとめ

OWASPの推奨をそのまま実装順に並べると:

1. **`Content-Security-Policy: frame-ancestors` または `X-Frame-Options` ヘッダを最優先で設定する**（両方出すのが確実。既定は `frame-ancestors 'none'` ＋ `X-Frame-Options: DENY`）
2. 認証セッションに **SameSite Cookie** を設定する
3. 古いブラウザ互換が要るなら、上記の **frame breaking スクリプト**を `<head>` に入れる
4. フレーム可能でなければならないページでは **`window.confirm()`** で操作ドメインをユーザに提示する

> 出典: Clickjacking Defense Cheat Sheet（OWASP） — https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html

---

### 6. 実務チェックリスト

**防御側（サービス実装者）**

- [ ] 全HTMLレスポンスに `Content-Security-Policy: frame-ancestors 'none'`（埋め込みが必要なら明示的な許可リスト）＋ `X-Frame-Options: DENY`／`SAMEORIGIN`
- [ ] `X-Frame-Options: ALLOW-FROM ...` を使っていないか（使っていたら実質無防備）
- [ ] ユーザ固有・機微な内容を返す全URLに `X-Content-Type-Options: nosniff`
- [ ] JSON/HTML/XMLの `Content-Type` が正確か（CORB/ORBのスニッフィングに頼らない）
- [ ] 機微なリソースに `Cross-Origin-Resource-Policy: same-origin`
- [ ] トップレベルドキュメントに `Cross-Origin-Opener-Policy: same-origin`（`SharedArrayBuffer` 等が必要なら COEP と併用）
- [ ] セッションCookieに `SameSite=Lax`（または `Strict`）＋ `HttpOnly` ＋ `Secure`
- [ ] `Sec-Fetch-Site` / `Sec-Fetch-Dest` によるリソース分離ポリシーの導入検討
- [ ] `target="_blank"` の外部リンクに `rel="noopener"`
- [ ] `unload` 依存の処理を `pagehide` + `sendBeacon` / `fetch(keepalive)` へ移行

**分析側（許可された範囲でのテスト）**

- [ ] 対象ページのレスポンスヘッダに `frame-ancestors` / `X-Frame-Options` があるか。**すべてのページ**にあるか（ページ単位設定の漏れは典型的な欠落）
- [ ] 状態変更を伴う操作（承認、連携、削除、送金確定など）を持つページが埋め込み可能になっていないか
- [ ] 埋め込み可能なページに対し、セッションCookieが `SameSite=None` になっていないか
- [ ] JSON APIが `nosniff` 無し・不正確な `Content-Type` で配信されていないか
- [ ] タスクマネージャ（Shift+Esc）や `chrome://process-internals` で、検証環境のプロセス分離状態を把握しておく

---

### 7. この節のまとめ

- **Spectre は「同じプロセスにあるデータは読まれうる」という前提をWebに突きつけた**。タイマー規制（`performance.now()` の分解能低下、`SharedArrayBuffer` の一時無効化）は対症療法であり、本命は**プロセス分離**である。
- **Site Isolation** は分離の単位を「スキーム＋登録済みドメイン（eTLD+1）」＝**サイト**とし、クロスサイトのドキュメントを OOPIF で別プロセスに置く。デスクトップは Chrome 67 から既定有効（メモリ約10〜13%増）、Android は Chrome 77 から RAM 2GB以上の端末で認証サイト優先（約3〜5%増）。
- **CORB／ORB** は、CORSで許可されないクロスオリジンのデータリソースがレンダラのメモリに入ること自体を防ぐ。ただし**ベストエフォート**なので、開発者側で `Content-Type` の正確化と `nosniff` が必須。
- プロセス分離の副作用として、**クロスオリジンのレイアウトは非同期**になり、**`unload` ハンドラは打ち切られ・並列実行され・実行されないことすらある**。`pagehide` + `sendBeacon` / `keepalive` へ移行する。
- サーバ側で引ける追加の線が **CORP / COOP / `Sec-Fetch-*`**（Post-Spectre Web Development）。ヒューリスティックに頼らず、明示的にプロセス境界を宣言できる。
- **クリックジャッキング**の根本防御は `frame-ancestors`（＋ `X-Frame-Options`）という**ヘッダ**である。`ALLOW-FROM` は fail open で無意味。JavaScript の frame buster は、二重フレーミング・`onBeforeUnload`・204フラッシング・`sandbox` 属性で破られるため、**「デフォルト非表示＋フレーム外でのみ表示」というフェイルセーフ構造**で書く以外に使い道がない。
