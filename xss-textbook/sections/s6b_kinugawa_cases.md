## Kinugawaの実例（Teams Pwn2Own / Shadow DOM）

このセクションでは、日本を代表するXSSリサーチャーである衣川将平（Masato Kinugawa）氏が公開した3つの発表資料を題材に、(1) Microsoft TeamsをハックしてPwn2Ownで$150,000（約2,000万円）を獲得した実例、(2) その日本語での詳細版、(3) Shadow DOMとセキュリティの関係、という3つのテーマを扱う。反射型XSSの基礎は前提とし、ここでは「複数の弱点を組み合わせて初めて成立する高度な攻撃チェーン」と「ブラウザの新しいDOM機構（Shadow DOM）がもたらす新種の攻撃面」という、より上級者向けの視点を学ぶ。

### 1. Microsoft Teamsハッキングと Pwn2Own（$150,000）

> ⚠️ **未取得の資料**: 「How I Hacked Microsoft Teams and got $150,000 in Pwn2Own」は自動取得できませんでした（理由: 資料ホストのspeakerdeck.comがこの環境のegressプロキシでブロックされているため）。以下のURLからユーザーご自身で直接ご覧ください: https://speakerdeck.com/masatokinugawa/how-i-hacked-microsoft-teams-and-got-150000-dollars-in-pwn2own

公開情報（Pwn2Own Vancouver 2022の公式結果および各種セキュリティメディアの報道）によると、事実関係は次の通りである。

- **大会**: Pwn2Own Vancouver 2022（開催年: 2022年）
- **対象**: Microsoft Teamsデスクトップアプリケーション
- **成果**: 「injection（注入）→ misconfiguration（設定不備）→ sandbox escape（サンドボックス脱出）」という **3段階のバグチェーン** を使い、Teamsの一般ユーザー環境でリモートコード実行（RCE）相当の影響を実証
- **報奨金**: $150,000（Master of Pwnポイント15点）
- Teams全体では、この日（Day 1）に複数チームの合計で$450,000が支払われており、Kinugawa氏のチェーンはその中でも最高額の一つであった

（以下は未取得資料の補足として一般知識に基づく解説です）

この種の「チャットアプリ×Electron製デスクトップアプリ」に対する典型的な攻撃チェーンの仕組みを一般論として整理する。Teamsのようなデスクトップアプリの多くはElectron（Chromiumレンダラ+Node.jsランタイムを組み合わせたフレームワーク）で作られている。Electronアプリに対する多段階攻撃は、概ね次の3層で構成されることが多い。

1. **injection（メッセージ内へのコード注入）**
   チャットメッセージや通知、リンクプレビューなどのリッチコンテンツをレンダリングする際、サニタイズ（危険なタグ・属性の除去）が不十分だと、送られてきたHTML/Markdown由来の文字列がDOMに`innerHTML`のような**sink（入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`、`eval`、`document.write`）**へ渡り、任意のHTML/JSがレンダラ内で実行される。これが「反射型/持続型XSS」に相当する第一段階である。

2. **misconfiguration（CSPやオリジン許可設定の不備）**
   Electronアプリの多くはメインウィンドウにCSP（Content Security Policy）を設定しているが、`script-src`にワイルドカードサブドメイン（例: `*.example.com`）や、アプリの他機能（SSO・Botフレームワーク・添付ファイルプレビューなど）用に許可した信頼済みドメインが含まれることがある。攻撃者はこの「信頼されているが実際は攻撃者が内容を制御できるオリジン」（例: サブドメインテイクオーバーや、オープンリダイレクト/JSONPエンドポイントが存在する社内サービス）を悪用し、CSPを迂回して外部から任意スクリプトを読み込ませる。CSPのソース許可は文字列としてのオリジン一致でしか評価されないため、「そのオリジンの中身を誰が管理しているか」までは検証できない、という設計上の限界が悪用される。

3. **sandbox escape（レンダラプロセスからホストOSへの脱出）**
   Electronのレンダラプロセスは本来`contextIsolation: true`かつ`nodeIntegration: false`であればWeb相当のサンドボックスに閉じ込められるが、（a）プリロードスクリプトが`contextBridge`を使わずにNode.js API（`require`や`ipcRenderer.sendSync`など）をレンダラ側の`window`に直接晒している、（b）IPC（プロセス間通信）ハンドラがレンダラから渡された引数を検証せずファイル読み書きやプロセス起動を行っている、といった不備があると、レンダラで実行したJSからホストOS上で任意コード実行が可能になる。これが「サンドボックス脱出」であり、ブラウザの通常のタブ分離モデルの外側にある、デスクトップアプリ特有の攻撃面である。

この3段階はそれぞれ単独では「重大だが限定的」な脆弱性（XSSだけならタブ内、CSP不備だけなら理論上のリスク、IPC不備だけなら到達手段が必要）だが、**チェーンとして繋ぐことで初めてフルのRCEに到達する**という点が、Pwn2Ownのような実演型コンテストで高額報奨が支払われる理由である。バグバウンティにおいても、「単体では低〜中評価の脆弱性を複数組み合わせて重大な影響を証明する」ことは評価額を大きく引き上げる典型パターンである。

> 出典: How I Hacked Microsoft Teams and got $150,000 in Pwn2Own — https://speakerdeck.com/masatokinugawa/how-i-hacked-microsoft-teams-and-got-150000-dollars-in-pwn2own （本文取得不可のため、公開情報とWeb検索結果に基づき要約・補足）

### 2. 日本語詳細版: Pwn2OwnでTeamsをハッキングして2000万円（Shibuya.XSS techtalk #12）

> ⚠️ **未取得の資料**: 「Pwn2OwnでMicrosoft Teamsをハッキングして2000万円を獲得した方法 / Shibuya.XSS techtalk #12」は自動取得できませんでした（理由: 資料ホストのspeakerdeck.comがこの環境のegressプロキシでブロックされているため）。以下のURLからユーザーご自身で直接ご覧ください: https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-12

この回はShibuya.XSS勉強会（日本のXSS・Webセキュリティ専門コミュニティ）での発表で、上記の英語スライドと同じ$150,000（当時のレートで約2,000万円）のTeams脆弱性チェーンを、日本語でより噛み砕いて解説したものと位置づけられる。公開情報として確認できる要点は次の通り。

- タイトルが示す通り「injection → misconfiguration → sandbox escape」の3バグチェーンを、日本語コミュニティ向けに再構成して発表
- 発表はPwn2Own本番から一定期間後に行われており、ZDI（Zero Day Initiative）による開示ポリシー上の**公開猶予期間（エンバーゴ）を経てから技術詳細が語られる**という、Pwn2Own系脆弱性の一般的な開示フローに沿っている

（以下は未取得資料の補足として一般知識に基づく解説です）

Pwn2Ownのようなコンテストでは、実演後すぐに全容を公表することはできない。ベンダー（この場合Microsoft）が修正パッチを配布し終えるまでは詳細を伏せる必要があり、その間は「脆弱性が存在した事実」と「おおまかな分類（3バグチェーンである、注入系である、等）」のみが公表される。技術者コミュニティ向けの詳細発表がPwn2Own本番から数ヶ月〜1年以上遅れて行われるのはこのためである。読者がバグバウンティや脆弱性開示を行う際も、レポート提出後にベンダーの修正を待たずに詳細をブログ等で公開すると、開示ポリシー違反（Coordinated Disclosureの逸脱）として報奨金の減額・没収や法的リスクにつながりうる点は実務上重要である。

> 出典: Pwn2OwnでMicrosoft Teamsをハッキングして2000万円を獲得した方法 / Shibuya.XSS techtalk #12 — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-12 （本文取得不可のため、公開情報とWeb検索結果に基づき要約・補足）

### 3. Shadow DOMとセキュリティ（Shibuya.XSS techtalk #13）

> ⚠️ **未取得の資料**: 「Shadow DOMとセキュリティ - 光と影の境界を探る / Shibuya.XSS techtalk #13」は自動取得できませんでした（理由: 資料ホストのspeakerdeck.comがこの環境のegressプロキシでブロックされているため）。以下のURLからユーザーご自身で直接ご覧ください: https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-13

英語版タイトルは "Shadow DOM & Security - Exploring the boundary between light and shadow" として公開されている。公開情報によれば、この発表に関連してKinugawa氏は **ShadowBreakers** というGitHubリポジトリを公開しており、Shadow DOMのカプセル化（内部構造を外部から隠す仕組み）を破る/漏洩させるAPI・手法を一覧化している。

（以下は未取得資料の補足として一般知識に基づく解説です）

#### Shadow DOMとは何か、なぜセキュリティ上重要か

**Shadow DOM**は、Web Componentsの一部として標準化された仕組みで、あるDOM要素（ホスト要素）の内部に、通常のDOMツリー（Light DOM）とは別の「隠された」DOMサブツリー（Shadow Tree）を持たせる機能である。目的はCSS・JSのスタイル漏れやセレクタ衝突を防ぐ「カプセル化」であり、`<video>`や`<input type="date">`のようなブラウザ組み込みUIも内部的にShadow DOMで実装されている。

Shadow DOMには2種類のモードがある。

- `mode: "closed"`: ホスト要素の`shadowRoot`プロパティが`null`を返し、外部JSから内部構造に一切アクセスできない（`attachShadow`の呼び出し元だけが参照を保持できる）
- `mode: "open"`: `element.shadowRoot`で外部からも内部DOMにアクセス可能

一見、`closed`モードを使えば「内部のセキュリティトークンやウィジェットの実装を外部の悪意あるスクリプトから完全に隠せる」ように思えるが、実際にはブラウザの様々な**橋渡し機構（bridge）**によってカプセル化が漏れる、あるいは意図せず破られるケースが多数存在する、というのがこの発表の核心的な問題意識だと考えられる。代表的な漏洩経路を仕組みレベルで整理する。

#### (a) イベントの再ターゲティング（retargeting）と`composed`フラグ

Shadow DOM内で発生したイベントは、`composed: true`（クリックやキー入力など多くの標準イベントはデフォルトでこれが true）であればShadowツリーの境界を越えて外側のLight DOMまで伝播（バブリング）する。このとき、イベントの`target`プロパティは境界を越えるたびに「retargeting（再ターゲティング）」され、外側から見るとホスト要素そのものがtargetであるかのように書き換えられる。

```html
<script>
document.addEventListener('click', (e) => {
  console.log(e.target); // shadow内の実要素ではなく、ホスト要素として見える
  console.log(e.composedPath()); // ただし composedPath() で内部要素まで辿れてしまう
});
</script>
```

`target`は隠されていても、`e.composedPath()`を呼べばイベント伝播経路上の**すべての要素（closedなShadow DOM内部の要素も含む）が配列として取得できてしまう**。これは「closedなら内部構造は絶対に見えない」という直感的な期待を裏切るAPI仕様であり、外部スクリプトが`click`や`focus`などのイベントリスナを`document`に仕掛けておくだけで、`closed` Shadow DOM内部のDOM構造・属性値（パスワードマネージャの隠しUIやウィジェットの内部状態など）を推測・列挙できる余地を生む。**なぜ動くか**: `composedPath()`はDOM標準仕様上、イベントの実際の伝播パスを返す設計になっており、`closed`モードによる保護はあくまで`shadowRoot`プロパティへの直接アクセスを塞ぐだけで、イベントAPIの経路情報までは塞いでいないため。

#### (b) `::part()`とCSS Shadow Parts

Shadow DOM内部の要素に`part`属性を付けておくと、ホスト要素の外側から`::part(name)`セレクタでスタイルを当てられる。これはカプセル化を保ちながら外部からの見た目カスタマイズを許すための正規機能だが、CSSインジェクションが可能な文脈と組み合わさると、外部から`::part()`経由でShadow DOM内部要素の`content`プロパティ（生成コンテンツ）や`background-image: url(...)`を使って、内部の状態に応じた見た目差分を外部に持ち出す「CSS-only exfiltration（JS不要のCSSだけによる情報持ち出し）」に応用される可能性がある。

#### (c) `delegatesFocus`とフォーカス関連の漏洩

`attachShadow({mode: 'closed', delegatesFocus: true})`のように`delegatesFocus`を有効にすると、ホスト要素がフォーカスされた際に自動的にShadow内部の適切な要素にフォーカスが移る。フォーカスの移動先や`:focus-within`のようなCSS擬似クラスの発火は外部から観測可能であるため、内部にどのような種類のフォーカス可能要素（`<input>`か`<button>`か等）が存在するかを、タイミングやCSSの副作用から推測できる場合がある。

#### (d) Declarative Shadow DOM とHTMLパーサの再解釈

近年（2023年前後にChromium系ブラウザで標準化）追加された**Declarative Shadow DOM**は、`<template shadowrootmode="open">`をHTML内に直接書くだけでJS不要にShadow DOMを構築できる機能である。

```html
<div id="host">
  <template shadowrootmode="open">
    <p>Shadow内のコンテンツ</p>
  </template>
</div>
```

これは「HTMLパーサが`<template shadowrootmode>`を特別扱いして、通常のtemplate要素の中身をそのままShadow DOMとして即座にアタッチする」という**パーサレベルの再解釈**によって実現されている。ここで重要なのは、サニタイザ（DOMPurifyなど）がこの新構文の存在を認識していないバージョンでは、`shadowrootmode`属性やその中の`<template>`をただの無害なマークアップとして通過させてしまい、結果として**サニタイズ後のHTMLをブラウザに挿入した瞬間にJS実行を伴わないマークアップだけでShadow DOMが構築され、その中にさらに危険な要素（例えば別のイベントハンドラを持つ要素）を仕込める**、という新しい種類のサニタイザバイパスが生まれうる。これは「XSS対策ライブラリが特定のHTMLバージョン時点の仕様を前提にホワイトリスト/ブラックリストを作っている場合、ブラウザの仕様追加によって既存の防御が陳腐化する」という、本教科書で繰り返し出てくる原理（パーサとサニタイザの認識のズレ）の典型例である。

#### (e) iframeとShadow DOMの相互作用

`<iframe>`はもともとオリジン境界によるサンドボックスを提供する要素だが、Shadow DOM内に`<iframe>`を配置した場合や、逆にiframe内のドキュメントがShadow DOMを使う場合、CSPの`frame-ancestors`評価やpostMessageの送信元検証（`event.origin`のチェック漏れ）といった既存の防御が、開発者の想定と異なるタイミング・スコープで評価されることがある。特に、Shadow DOMのホスト要素が持つイベントリスナが`composed`イベントを受け取れることを利用し、iframe内からのユーザー操作イベントが外側のShadow DOM経由で意図せず親ページのハンドラに届く、といった設計ミスが生まれやすい。

#### なぜこの発表が重要か

Shadow DOMは「カプセル化＝セキュリティ境界」であるかのように誤解されやすいが、実際には**プレゼンテーション層の分離を目的とした仕様であり、セキュリティ境界として設計されたものではない**。この前提のズレを突く形で、`composedPath()`・CSS Parts・`delegatesFocus`・Declarative Shadow DOMのような「便利な新機能」が、意図しない情報漏洩やサニタイザバイパスの経路になり得る。上級者がXSSやサンドボックス設計を学ぶ上では、「新しいブラウザ機能が追加されるたびに、既存のサニタイザ・CSP・オリジン分離の前提が静かに崩れていないかを疑う」という姿勢が本発表全体を貫く教訓だと言える。

> 出典: Shadow DOMとセキュリティ - 光と影の境界を探る / Shibuya.XSS techtalk #13 — https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-13 （本文取得不可のため、公開情報とWeb検索結果に基づき要約・補足。個々のAPI仕様に関する説明はShadow DOM仕様・DOM標準に基づく一般知識による補足であり、発表スライド本文の再現ではない）

### まとめ

- Teams Pwn2Ownの事例は、**単体では中程度の複数の弱点（XSS的な注入・CSP等の設定不備・サンドボックス実装の不備）を1本のチェーンに繋ぐことで、初めてクリティカルな影響を実証できる**という、現代の高度な脆弱性評価の典型を示している。
- Shadow DOMの事例は、**「カプセル化」という開発者向けの機能が、そのままセキュリティ境界として機能するとは限らない**こと、そしてブラウザに新機能が追加されるたびにサニタイザやCSPの前提が古くなるリスクを示している。
- いずれも、原文スライドは本教科書の自動取得環境では参照できなかったため、詳細な図解・実際のペイロード・PoCコードについては、上記の一次情報URLを直接参照することを強く推奨する。
