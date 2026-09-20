## リサーチャー索引（Gareth Heyes / Kinugawa）

XSS(クロスサイトスクリプティング)の研究は、ブラウザベンダーの仕様書だけを読んでいても追いつけない。実際には、パーサの実装間の微妙な「解釈のズレ」や、DOMの標準API同士の予期しない相互作用を、日々ブラウザのソースコードと格闘しながら見つけているリサーチャーたちがいる。本節では、この分野で最も継続的かつ体系的に成果を出し続けている2人の第一人者、**Gareth Heyes**(ガレス・ヘイズ、PortSwigger社)と**Masato Kinugawa**(衣川昌人、日本の著名なセキュリティ研究者)の研究領域を索引としてまとめる。個々の攻撃の完全な技術詳細は他章(mXSS章、DOM Clobbering章など)に譲り、ここでは「誰が」「何を」「なぜ重要か」という見取り図を提供し、実際の発表資料へ読者を橋渡しする。

> ⚠️ **未取得の資料**: 「Gareth Heyes個人サイト」(https://garethheyes.co.uk/) は自動取得できませんでした(理由: 環境のegressプロキシによりこのドメインへのアクセスがブロックされているため)。以下のURLからユーザーご自身で直接ご覧ください: https://garethheyes.co.uk/
>
> ⚠️ **未取得の資料**: 「Masato Kinugawa Speaker Deckプロフィール」(https://speakerdeck.com/masatokinugawa) は自動取得できませんでした(理由: 環境のegressプロキシによりこのドメインへのアクセスがブロックされているため)。以下のURLからユーザーご自身で直接ご覧ください: https://speakerdeck.com/masatokinugawa

（以下は未取得資料の補足として、公開情報の検索結果と筆者の一般知識に基づく解説です。個々の発表スライドの正確な図版・詳細ペイロードは、上記URLを直接参照してください。）

### なぜ「リサーチャー索引」が必要か

XSS対策のチートシートやスキャナのルールは、常に「後追い」である。新しいsink(シンク。ユーザー入力が最終的に実行・解釈されてしまう危険な代入先。例: `innerHTML`, `eval()`, `location.href`)や、新しいパーサの挙動は、まずリサーチャーが手作業でブラウザの実装差異を突いて発見し、そのあとでベンダーが修正し、さらにそのあとでOWASPのチートシートやスキャナが追随する、という順序で世に出る。したがって、上級者が実務でゼロデイ級の迂回策を発見・追跡するには、個々のリサーチャーの発表履歴を定点観測することが最も効率のよい情報源になる。Gareth HeyesとMasato Kinugawaは、その代表格である。

### Gareth Heyes(PortSwigger社)の研究領域

Gareth Heyesは、PortSwigger社(Burp Suiteの開発元)のリサーチャーであり、同社が公開している業界標準の「XSS Cheat Sheet」の主著者としても知られる。彼の研究の特徴は、**JavaScriptパーサそのものの奇妙な仕様**を突く点にある。代表的な業績は次の通り。

#### 1. AngularJSサンドボックスの破壊

AngularJS(1.x系)は、テンプレート内で任意のJavaScript式が実行されるのを防ぐために「サンドボックス」機構を持っていたが、Heyesは複数回にわたってこのサンドボックスを完全に脱出する式を発見した。例えば、AngularJSのオブジェクトから`constructor`プロパティを辿ってグローバルの`Function`コンストラクタに到達し、任意コードを実行するという手法である。

```html
{{constructor.constructor('alert(1)')()}}
```

**なぜ動くか**: JavaScriptでは、あらゆる関数オブジェクトは`constructor`プロパティを通じて自身を生成した`Function`コンストラクタに到達できる(プロトタイプチェーンをたどる、いわゆる「コンストラクタチェーン」)。AngularJSのサンドボックスは「危険な特定のプロパティ名」をブラックリスト方式で禁止していたが、`constructor`という一見無害なプロパティを経由する経路までは塞ぎきれず、結果として任意のJavaScriptコードを文字列から動的生成・実行できてしまう。この「ブラックリストは必ず漏れがある」という教訓は、後述のDOM Clobbering対策やCSPのバイパス研究全般に通底する原理である。

#### 2. mXSS(Mutation XSS)とDOMPurifyのバイパス

Heyesは、業界標準のサニタイザライブラリ「DOMPurify」を繰り返しバイパスする研究を公表している。mXSSとは、「サニタイザがチェックした時点の文字列表現」と「ブラウザがその文字列をパースし直して実際にDOMツリーへ変換した結果」が食い違うことを悪用する攻撃である。

**仕組み(パーサ再解釈の原理)**: HTMLサニタイザの多くは、入力文字列を一度DOMにパースし、危険なノード・属性を除去したあと、**再びHTMLの文字列にシリアライズ(直列化)**して返す。ここで問題になるのは、「除去後の安全なDOM」を文字列化する処理と、その文字列を**呼び出し元のブラウザが再度パースする**処理が、必ずしも同じルールで動くとは限らないという点である。特定のタグのネスト構造(例えば`<style>`や`<noscript>`、名前空間をまたぐSVG/MathMLの要素)は、シリアライズ→再パースの過程で構造が「突然変異(mutation)」し、サニタイズ前には存在しなかった実行可能なコンテキストが生成されてしまう。

```html
<svg><style><img src=x onerror=alert(1)></style></svg>
```

**なぜ動くか(一般的な原理の例)**: `<style>`要素の内部はCSSとしてパースされるべきだが、名前空間の切り替わり(SVGコンテキスト内)やブラウザ実装の差異によって、内部のHTML的なマークアップがテキストとして無害化されずに残存し、サニタイザが一度目のパースで「安全」と判定した構造が、ブラウザの実際のレンダリング時には別のツリー構造として再解釈される。これにより`onerror`属性を持つ`<img>`要素が実DOMに出現し、スクリプトが実行される。

> 出典: Researcher - Gareth Heyes - PortSwigger — https://portswigger.net/research/gareth-heyes (取得不可、検索結果に基づく要約)

#### 3. スクリプトガジェット(Script Gadgets)によるサニタイザ回避

Heyesは、Vue.jsなどのフロントエンドフレームワークが持つ「一見安全なHTML属性」を悪用する「スクリプトガジェット」研究も発表している(2021年)。サニタイザ自体はどの属性も危険とみなさず素通りさせるが、ページ上で実際に使われているJSフレームワークがその属性を「自分向けの指示」として解釈し、結果的にスクリプト実行に至る。

```html
<div v-html="'<img src=x onerror=alert(1)>'"></div>
```

**なぜ動くか**: これはサニタイザの脆弱性というより、「サニタイザは汎用的なHTML/DOMの危険性だけを判定しており、そのページで動いている特定のJSライブラリが独自にDOM上の属性・要素を解釈して副作用を起こすこと」までは判定できない、という設計上の死角を突いている。同じマークアップでも、Vue.jsやAngularJSなど特定のフレームワークが読み込まれている環境でだけ発火する「環境依存の攻撃対象面(アタックサーフェス)」がある、という点が本質である。

#### 4. JavaScript for Hackers(体系書)

Heyesは自身の研究を集約した書籍『JavaScript for Hackers』(Leanpub/Google Books経由で入手可能)を出版しており、ECMAScript仕様の隅々にある「ハッカー的に有用な奇妙な挙動」(型変換、正規表現の副作用、プロトタイプ汚染など)を体系的に扱っている。

> 出典: JavaScript for hackers: Learn to think like a hacker - Gareth Heyes - Google Books — https://books.google.com/books/about/JavaScript_for_hackers.html?id=FVWjEAAAQBAJ

### Masato Kinugawa(衣川昌人)の研究領域

Masato Kinugawaは、日本発のセキュリティ研究者として世界的に高く評価されており、GoogleやMicrosoftなど主要ベンダーへの脆弱性報告実績を多数持つ。彼の研究の特徴は、**ブラウザの実装差異とHTML/CSS/JSの仕様の境界領域**を極めて精密に検証する点にある。

#### 1. Google検索におけるmXSSの発見(2019年2月)

Kinugawaは2019年2月、Google検索自体に存在するmXSS脆弱性を発見しGoogleへ報告した。これは前述のHeyesのDOMPurify研究と並び、mXSSが「特定のライブラリの実装バグ」ではなく「HTML標準のパース規則そのものに内在する構造的な脆弱性クラス」であることを裏付ける重要な事例である。ブラウザごとにHTMLのパース・シリアライズの解釈が微妙に異なるため、サニタイズ処理を自前で持つ大規模サービスであっても、まったく同じ罠にはまりうるという教訓を示した。

> 出典: Mutation XSS in Google Search | Acunetix — https://www.acunetix.com/blog/web-security-zone/mutation-xss-in-google-search/ (検索結果に基づく要約)

#### 2. DOM Clobberingによる CSP `strict-dynamic` の迂回

Kinugawaは、Content Security Policy(CSP。ブラウザに「このページではこのソース・この方式のスクリプトだけ実行してよい」と指示するHTTPレスポンスヘッダ)の中でも最も強力とされる`strict-dynamic`モードを、DOM Clobbering(DOMクロバリング。HTML要素の`id`属性や`name`属性が、同名のグローバル変数やDOMプロパティを「上書き」してしまう現象)を用いて迂回するシナリオを示した。

```html
<a id="currentScript"></a>
```

**なぜ動くか(CSPソース許可評価との関係)**: `strict-dynamic`を採用したページは、しばしば「信頼されたスクリプトが動的に読み込む後続スクリプトも信頼する」という伝播モデルを実現するために、JavaScript側で`document.currentScript`のようなDOM APIを参照し、その戻り値を使って新しい`<script>`要素を安全に生成しようとする「シム(shim、簡易的な互換実装コード)」を自前で用意することがある。ここでHTML要素のid属性によって`document.currentScript`のようなグローバル参照が、攻撃者の注入した無害な`<a>`要素などに「なりすまし」的に上書きされてしまうと、シムのロジックが想定と異なるオブジェクトを参照し、結果として攻撃者が用意したスクリプトが「信頼されたスクリプトの後続」として誤って実行されてしまう。CSPの許可判定自体はブラウザのネイティブ機構が正しく行っていても、**ページ側のJavaScriptロジックがDOM上の値を無条件に信頼していた場合、CSPの防御思想全体が迂回されうる**という、CSPバイパス研究における重要な原理を示す事例である。

#### 3. Shadow DOMとセキュリティ境界

Kinugawaの発表「Shadow DOM & Security - Exploring the boundary between light and shadow」は、Web Componentsの一部であるShadow DOM(要素のサブツリーをカプセル化し、通常のDOM操作やCSSから隔離する仕組み)について、実際のWebアプリケーションを攻撃する中で得られた知見をまとめたものである。Shadow DOMは「隔離されているから安全」と誤解されやすいが、`slot`要素を介したコンテンツの受け渡しや、Shadow Root自体の`mode`(`open`/`closed`)設定の実装差異によって、意図しない情報漏洩やスクリプト実行の経路が生じうることを示している。

> 出典: Shadow DOM & Security - Exploring the boundary between light and shadow - Speaker Deck — https://speakerdeck.com/masatokinugawa/shadow-dom-and-security-exploring-the-boundary-between-light-and-shadow (取得不可、検索結果に基づく要約)

#### 4. JavaScriptによるDoS、Electronのコンテキスト分離欠如、ブラウザのレガシー機能

その他、Kinugawaは以下のようなテーマでも発表を行っている。

- **「JSでDoSる」**(Shibuya.XSS techtalk #11): JavaScriptの言語仕様上の特性(正規表現の破滅的バックトラッキングなど)を悪用したクライアントサイドDoSの手法。
- **「Electron: Abusing the lack of context isolation」**: Electron製デスクトップアプリで`contextIsolation`が無効(Electron 12未満ではデフォルトが`false`だったが、Electron 12以降はデフォルトが`true`に変更された)な場合に、レンダラープロセスのJavaScriptからNode.js API・特権APIへ到達しリモートコード実行に発展しうる問題。
- **「ブラウザのレガシー・独自機能を愛でる」**(Browser Crash Club #1): Firefoxに存在した4つの脆弱性を扱った発表で、標準化されていない・忘れられがちなブラウザ独自機能が攻撃対象面になりうることを示す。
- **「XSS Attacks through PATH」**: URLのパス部分を経由したXSSベクタの研究。

> 出典: Masato Kinugawa (@masatokinugawa) on Speaker Deck — https://speakerdeck.com/masatokinugawa (取得不可、検索結果に基づく要約)

### 2人の研究スタイルの対比と学習への活かし方

| 観点 | Gareth Heyes | Masato Kinugawa |
|---|---|---|
| 主戦場 | JavaScriptパーサ/評価器の仕様の隙間、サニタイザ(DOMPurify等)のバイパス | HTMLパーサの実装差異、DOM API同士の相互作用、フレームワーク/実行環境固有の境界 |
| 代表的手法 | プロトタイプチェーンの悪用、mXSS、スクリプトガジェット | mXSS(独自発見)、DOM Clobbering、Shadow DOM境界の検証 |
| 発表媒体 | PortSwigger Research、自身のブログ(garethheyes.co.uk)、書籍 | Speaker Deck、Shibuya.XSS techtalk、各種カンファレンス(CureCon等) |
| 学習者への示唆 | 「言語仕様のブラックリストは必ず漏れる」という原則をコード実行系で学べる | 「標準仕様の解釈は実装ごとに違う」という原則をパーサ・DOM API系で学べる |

両者に共通するのは、**個別のペイロード集めではなく「なぜその挙動が起きるのか」という仕組みレベルの理解を積み上げている**点である。実務でXSSの新しい迂回策を発見したい場合、この2人が定期的に公開する発表資料・ブログを継続的にウォッチすることが、チートシートの更新を待つよりも早く最前線の知見に触れる最良の方法である。読者は本節で紹介した各URLを直接開き、実際のスライド内のデモやコード片を手元のブラウザで再現しながら学習することを強く推奨する。

### 防御側への示唆

- **サニタイザは銀の弾丸ではない**: DOMPurifyのような高品質なライブラリであっても、mXSSクラスの脆弱性は「パーサの再解釈」という構造的な問題に起因するため、バージョンアップと最新のバイパス研究の追跡が不可欠である。
- **CSPは単体で完全ではない**: `strict-dynamic`のような強力なCSPモードでも、ページ側のJavaScriptロジック(DOM Clobberingに対する耐性がないシムコードなど)次第で迂回されうる。DOM上のグローバル参照に依存するコードは、`id`/`name`属性による汚染を防ぐため、`Object.freeze`や名前空間の分離、あるいは`document.getElementById`の結果を信頼する前の型チェックなど、追加の防御が必要である。
- **フレームワーク固有のアタックサーフェスを意識する**: スクリプトガジェットの研究が示すように、サニタイザが「安全」と判定した出力であっても、同じページで動いている別のJSライブラリがその出力を独自に解釈し直すことで危険な処理に至る場合がある。サニタイズ処理の設定は、実際にページで使用しているフレームワークの挙動を踏まえて個別にチューニングする必要がある。
