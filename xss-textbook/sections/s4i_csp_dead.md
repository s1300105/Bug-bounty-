## CSPの限界（CSP Is Dead 論文）

CSP（Content Security Policy、コンテンツセキュリティポリシー）は、ブラウザにHTTPレスポンスヘッダとして「どのオリジンからスクリプトを読み込んでよいか」を宣言することで、反射型・格納型を問わずXSSの実行を防ぐ目的で設計された多層防御機構である。しかし2016年、Googleのセキュリティチーム（Lukas Weichselbaum, Michele Spagnuolo, Sebastian Lekies, Artur Janc）が発表した論文 **"CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy"**（ACM CCS 2016）は、実運用されているCSPの**94.72%が回避可能**であることを大規模実測で示し、業界に衝撃を与えた。本節では、なぜホワイトリスト方式のCSPが機能しないのか、その仕組み上の理由と、代替として提案された「strict CSP（nonceベースCSP）」の設計原理を学ぶ。

### CSPの基本的な考え方（前提の整理）

CSPは以下のようなヘッダで配信される。

```
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com https://www.google.com
```

ブラウザは、HTMLをパース中にスクリプトタグやインラインスクリプトの実行要求に遭遇するたびに、そのスクリプトの「ソース（読み込み元URL、あるいはインラインかどうか）」を`script-src`ディレクティブの許可リスト（ホワイトリスト）と照合する。一致しなければブロックし、コンソールに違反ログを出す。これにより、攻撃者が`<script>alert(1)</script>`のような任意のインラインスクリプトを注入できても、CSPが`'unsafe-inline'`を許可していなければ実行されない、というのが素朴な期待である。

この「ホワイトリスト方式」は直感的でわかりやすいが、論文が指摘したのは、**実際のWebサイトが必要とする外部スクリプトの多くが、それ自体XSSに悪用可能な「JSONPエンドポイント」や「古いライブラリバージョン」を抱えている**という現実である。

### なぜホワイトリストは機能しないか：仕組みレベルの説明

論文はGoogleの検索エンジンインデックス（約1000億ページ、10億ホストの規模）を使い、CSPを配信している168万ホスト・26,011個のユニークなポリシーを収集して自動解析した。その結果、94.72%のポリシーがバイパス可能と判定された。バイパスの主な原因は次の3種類に整理できる。

#### 1. ホワイトリストに含まれるドメインの「脇道」の悪用

CSPは**オリジン（プロトコル+ホスト+ポート）単位**でしか許可・拒否を判定できず、そのオリジン配下のどのパス・どのファイルが安全かまでは検証しない。したがって、`script-src https://www.google.com`のように大手CDNやプラットフォームのドメインをまるごと許可すると、そのドメイン配下にたまたま存在する以下のようなリソースが「合法な攻撃経路」になる。

- **JSONPエンドポイント**：`https://accounts.google.com/o/oauth2/revoke?callback=alert(1)`のように、クエリパラメータの値をそのままJavaScriptとして実行するcallback系API。CSPの`script-src`は「そのオリジンから読み込まれたスクリプト」を許可しているだけなので、攻撃者がその許可オリジン上のJSONPエンドポイントを見つけてcallback引数に任意コードを注入すれば、CSPを一切迂回せずに任意JS実行が成立する。
- **アップロード機能を持つエンドポイント**：ユーザーがファイル（JSやHTMLとして解釈されうるファイル）をアップロードできる、許可済みドメイン上の機能（例：`docs.google.com`のようなオフィス系サービスや、掲示板・CMSのアバターアップロード機能）。
- **古いライブラリバージョンの温存**：`ajax.googleapis.com`や`cdnjs.cloudflare.com`のような公開CDNをまるごと許可すると、攻撃者はそのCDNがホストする「脆弱なバージョンの古いAngularJS」等を`<script>`で読み込ませることができる。AngularJSの一部バージョンには、テンプレートインジェクション経由でサンドボックスを脱出しCSPをすり抜けて任意コードを実行できる既知の脆弱性があり（例：AngularJS 1.6系まで存在した`{{constructor.constructor('alert(1)')()}}`系のサンドボックス回避）、CSPが「AngularJSの配布元ドメイン」を許可している場合、攻撃者はそのドメインから脆弱バージョンを読み込むだけでCSPの許可リストの内側から攻撃を完結できる。

これらはいずれも「ドメイン単位の許可」という設計そのものに起因する。CSPの評価アルゴリズムはURLのオリジン部分しか見ないため、パス以下にどんな機能があるかは一切考慮しない。**任意のJSライブラリを許可オリジン配下でホスト可能な仕組み（アップロード、オープンリダイレクト、JSONP、ファイル共有）が1つでも存在すれば、そのドメインを許可した時点でCSPは事実上無効化される**。論文はこのような「バイパス可能なホスト」を大量にリスト化し、Google自身のドメインを含む主要CDN・クラウドサービスの多くがこれに該当することを示した。

#### 2. `'unsafe-inline'`と`'unsafe-eval'`の常態的な使用

移行コストの問題から、多くのサイトは`script-src 'self' 'unsafe-inline'`のように`'unsafe-inline'`を付けたままCSPを運用していた。`'unsafe-inline'`が付いている場合、CSPは実質的に「インラインスクリプト注入を防ぐ」という最も基本的な役割さえ果たせない。反射型XSSで`<script>`タグを注入できるなら、CSPの有無に関わらず実行されてしまう。論文の統計では、多数の実運用ポリシーがこの状態にあり、CSPが「あるのに機能していない」典型例だった。

#### 3. 複雑なポリシー構文の誤設定

`script-src`を指定し忘れて`default-src`だけに頼っている、ワイルドカード（`*`）を安易に使っている、あるいは`https:`のようなスキームだけを許可してあらゆるHTTPSオリジンを許可してしまっている、といった設定ミスも多数観測された。`script-src https:`は「HTTPSであれば任意のドメイン」を許可するため、上記のJSONP/アップロード型バイパスの標的が実質無限に広がる。

> 出典: CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy — https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/

> ⚠️ **未取得の資料**: 「CSP Is Dead, Long Live CSP! On the Insecurity of Whitelists and the Future of Content Security Policy（research.google 掲載版）」は自動取得できませんでした（理由: 実行環境のegressプロキシにより research.google ドメインへのアクセスがブロックされているため）。以下のURLからユーザーご自身で直接ご覧ください: https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/
>
> （以下は未取得資料の補足として、Web検索で得られた公開情報および一般知識に基づく解説です）論文本体はACM CCS 2016（Proceedings of the 2016 ACM SIGSAC Conference on Computer and Communications Security）に採録され、著者はLukas Weichselbaum、Michele Spagnuolo、Sebastian Lekies、Artur Jancの4名（いずれもGoogleのセキュリティチーム）。調査対象はおよそ1000億ページ・10億ホスト規模の検索インデックスから抽出した168万ホスト・26,011件のユニークCSPポリシーであり、これは当時「最大規模のCSP実測調査」と位置づけられた。中心的な結論は「ホワイトリスト方式のCSPは94.72%のケースでバイパス可能」というものであり、この結果を受けて論文はホワイトリストに依存しない新しいCSPの書き方として、CSP Level 3で標準化された`'strict-dynamic'`キーワードの採用を提案している。

### 代替アプローチ：nonceベースの「strict CSP」

論文が提案し、その後Googleが`strict-csp`として一般に啓発した設計は、「ドメインを信頼する」のではなく「個々のスクリプトを信頼する」という発想の転換に基づく。具体的な推奨ポリシーは次の形を取る。

```
Content-Security-Policy:
  script-src 'nonce-{RANDOM}' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
```

各ディレクティブの役割と、なぜこの組み合わせが従来のホワイトリストより堅牢なのかを、仕組みレベルで見ていく。

#### `'nonce-{RANDOM}'`：ドメインではなくトークンで許可する

サーバーはページを描画するたびに暗号学的に安全な乱数（nonce、one-time token）を生成し、レスポンスヘッダの`script-src`と、許可したい各`<script>`タグの`nonce`属性の両方に同じ値を埋め込む。

```html
<script nonce="r4nd0mBase64Value123">
  doSomething();
</script>
```

ブラウザはスクリプトを実行する前に、そのスクリプトタグの`nonce`属性値がCSPヘッダに書かれたnonce値と**文字列として完全一致するか**だけを確認する。攻撃者がXSSでインラインスクリプトを注入できたとしても、レスポンスヘッダに載っている正しいnonce値をリアルタイムで知る手段がなければ（HTTPレスポンスヘッダはJavaScriptから直接読み取れず、ページごとに値が変わる）、注入したスクリプトにその場でnonceを付与することはできない。これが「ドメインの脇道」を悪用する既存のバイパス手法をすべて無効化する理由である。JSONPエンドポイントや脆弱ライブラリを許可オリジン内に見つけたとしても、そのURLを`<script src="...">`で読み込ませようとする行為自体が、正しいnonceを持たない限りブロックされる。

#### `'strict-dynamic'`：正規スクリプトが動的に生成する子スクリプトだけを連鎖的に信頼する

現代のWebアプリは、`nonce`付きの最初の`<script>`が、さらに別の`<script>`要素をJavaScriptで動的に生成してDOMに挿入する、という構成（バンドラやトラッキングタグ、A/Bテストのローダーなど）を多用する。素朴なnonce方式だと、動的生成されたすべての子スクリプトタグに毎回nonceを付け直す必要があり非現実的になる。

`'strict-dynamic'`は、「正しいnonce（またはハッシュ）を持つスクリプトが、自分自身の実行中にJavaScriptのDOM API（`document.createElement('script')`など）を使って生成した新しいスクリプトは、そのnonceを持たなくても信頼する」という**伝播（プロパゲーション）ルール**をCSPに追加する。信頼の起点はあくまで「正しいnonceを持つ最初のスクリプト」であり、そこから動的に生成された子だけが連鎖的に信頼される。逆に、攻撃者がXSSで注入したスクリプトは、この信頼の連鎖の外側にあるため、たとえ`document.createElement`を呼んでも新たな信頼は生まれない。

`'strict-dynamic'`が指定されている場合、ブラウザはCSP Level 3対応環境において**それ以前に書かれたドメインホワイトリスト部分（例: `https://cdn.example.com`）を無視する**。これは後方互換性のための意図的な仕様で、CSP3非対応の古いブラウザでは従来のホワイトリストにフォールバックしつつ、対応ブラウザではnonceベースの厳格な検証に一本化される（`script-src 'nonce-XXX' 'strict-dynamic' https: http:`のように`https:`等を後方互換用に併記するのが定石）。

#### `object-src 'none'`：プラグイン経由の実行経路を封じる

`<object>`、`<embed>`、`<applet>`タグはFlashなど旧来のプラグインを読み込むためのもので、こうしたプラグイン内で実行されるコンテンツはCSPの`script-src`の管理下に入らず、独自にJavaScriptに似たコードを実行できる場合があった（例: 古いFlashの`ExternalInterface`経由でのJS実行）。`object-src 'none'`は、この「CSPの監視が及ばない実行経路」自体を完全に塞ぐ。nonce/strict-dynamicでスクリプトタグ経路をどれだけ堅牢にしても、プラグイン経由の抜け道を残せば無意味になるため、strict CSPでは必須のディレクティブとされる。

#### `base-uri 'none'`：`<base>`タグによる相対パス書き換え攻撃を封じる

HTMLの`<base href="...">`タグは、ページ内のすべての相対URL（`<script src="app.js">`のようなパス）の基準となるオリジンを書き換える。もし攻撃者がHTMLインジェクションで`<base href="https://attacker.example/">`を注入できれば、正規のページが`<script src="app.js">`のように相対パスでスクリプトを読み込んでいる箇所を、攻撃者のサーバーから配信される悪意あるコードにすり替えることができる。これはスクリプトタグ自体を新規に注入する必要がなく、既存の正規スクリプトタグの「読み込み先」を差し替えるだけなので、nonce検証を回避しうる。`base-uri 'none'`（または`base-uri 'self'`）はこの`<base>`タグの機能自体を無効化・制限し、相対パス書き換えによる読み込み先ハイジャックを防ぐ。

### strict CSPの効果と限界

DeepSec 2016のスライド版（"CSP Is Dead, Long Live Strict CSP!"）では、この設計をGoogle社内の主要プロダクト（例: Gmail等）に段階的に導入した経緯と、nonceベースCSPが従来のドメインホワイトリスト方式に比べて実際に高いXSS防御力を示したことが報告されている。ポイントは、CSPの信頼モデルを「どこから来たか（Where）」から「誰が生成したか（Who／実行系譜）」へ転換したことにあり、これによりオリジン単位の脇道探索という攻撃面をほぼ排除できる。

ただし、strict CSPも万能ではない。以下のような限界が残る。

- **DOM-based XSSでnonceを盗めるケース**：ページ内に既存の脆弱性（例: nonce値をDOMやJavaScript変数として露出させてしまう実装ミス、あるいはXSSではなく別の情報漏洩経路）があれば、攻撃者がnonce値そのものを取得して正規のnonce付きスクリプトタグを偽装できる可能性がある。nonceはHTTPレスポンスヘッダとHTML内にしか本来存在しないが、テンプレートエンジンの実装次第では`window.__nonce__ = "..."`のようにJS変数へ複製してしまう実装ミスが起こりうる。
- **`'unsafe-inline'`との共存不可**：strict CSPを機能させるには`'unsafe-inline'`を完全に廃止し、すべてのインラインスクリプト・イベントハンドラ属性（`onclick="..."`等）をnonce付き外部スクリプトまたは別の許可手段（ハッシュベース許可）に置き換える必要があり、レガシーなコードベースでは移行コストが高い。
- **信頼された型（Trusted Types）との併用が推奨**：nonceベースCSPはスクリプトの「読み込み」を制御するが、`innerHTML`等のsinkへのDOM-based XSSそのものを防ぐわけではないため、後続の防御層としてTrusted Types等の併用が推奨される（本教科書の別セクションで扱う）。
- **レポート専用モード（`Content-Security-Policy-Report-Only`）からの段階移行が前提**：既存の大規模サイトがいきなり強制ブロックモードに切り替えると正規機能を壊すリスクが高いため、まず違反レポートのみを収集するモードで実運用データを集め、誤検知を潰してから本番適用する運用が推奨される。

> ⚠️ **未取得の資料**: 「CSP Is Dead, Long Live Strict CSP! （Lukas Weichselbaum, DeepSec 2016 スライド）」は自動取得できませんでした（理由: 実行環境のegressプロキシにより deepsec.net ドメインへのアクセスがブロックされているため。GitHub上の代替ミラーも確認できませんでした）。以下のURLからユーザーご自身で直接ご覧ください: https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf
>
> （以下は未取得資料の補足として、Web検索で得られた公開情報および一般知識に基づく解説です）本スライドは同名論文の著者Lukas WeichselbaumがDeepSec 2016カンファレンスで行った発表資料であり、論文の学術的な統計結果（94.72%バイパス可能）を踏まえて、実運用者向けに「strict CSP」導入の具体的な手順・ポリシー例・移行のベストプラクティスを提示する内容とされる。公開されているGoogleの啓発サイト（Content Security Policyの実践ガイド）でも同様の推奨ポリシーが示されており、代表例は次の形である。
>
> ```
> Content-Security-Policy:
>   object-src 'none';
>   script-src 'nonce-{random}' 'strict-dynamic' https: http: 'unsafe-inline';
>   base-uri 'none';
>   report-uri https://your-report-collector.example.com/
> ```
>
> ここで末尾に付く`https: http: 'unsafe-inline'`は、CSP Level 3（`'strict-dynamic'`とnonceを理解する対応ブラウザ）では無視される「意図的なフォールバック」であり、CSP3非対応の古いブラウザ向けに最低限のホワイトリスト＋`'unsafe-inline'`相当の緩い保護を残すためのものである。CSP3対応ブラウザは仕様上、`'strict-dynamic'`が存在する場合はホワイトリストと`'unsafe-inline'`を無視してnonce検証のみを行うため、新旧両対応のポリシーとして機能する。`report-uri`（および後継の`report-to`）は違反が起きた際にブラウザから自動的にJSON形式のレポートを指定エンドポイントへ送信させる仕組みで、本番投入前の検証や、投入後の攻撃観測・回帰検知に用いられる。

### まとめ：CSPを学ぶ上での要点

1. **ドメインホワイトリスト方式のCSPは、許可したドメインの中に「攻撃者が制御できる実行経路」（JSONP、アップロード機能、脆弱な古いライブラリ）が1つでもあれば実質的に無力化される**。これはCSPがオリジン単位でしか検証を行わないという設計上の制約に起因する、構造的な弱点である。
2. **nonceベースの`strict-dynamic`方式は、「どこから読み込むか」ではなく「誰（どの信頼された実行系譜）が生成したか」で許可を判定する**ことで、ドメイン単位の脇道探索という攻撃面そのものを消し去る。
3. `object-src 'none'`と`base-uri 'none'`は、スクリプトタグ以外の実行経路・書き換え経路を塞ぐための必須の補助ディレクティブである。
4. CSPは「多層防御の一層」であり、単体でXSSを根絶する銀の弾丸ではない。sink側の対策（安全なDOM API利用、Trusted Types等）と組み合わせて初めて実効性を持つ、という認識が本章全体を貫く前提となる。
