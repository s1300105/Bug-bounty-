## Trusted Types / strict CSP

DOMベースXSSの最大の問題は、「文字列」という信頼できない値がそのまま `innerHTML` や `eval` のような**sink**（入力が最終的に実行・解釈される危険な代入先。例: `innerHTML`、`document.write`、`Function`、`script.src` など）に流れ込んでしまう構造そのものにある。どれだけ入力検証やサニタイズのルールを整備しても、コードベースのどこか一箇所でも「未検証の文字列をsinkに渡す」コードが混入すれば、そこがXSSになる。**Trusted Types** は、この問題を「言語仕様・ブラウザAPIのレベル」で構造的に解決しようとするW3Cの仕様であり、Content Security Policy(CSP)の `require-trusted-types-for` ディレクティブと組み合わせることで、DOM XSSを機構的に不可能にする防御である。本節ではTrusted Typesの仕組みと、それを支える"strict CSP"（strict-dynamicベースの堅牢なCSP設計）を体系的に学ぶ。

### 1. Trusted Typesとは何か、なぜ必要か

#### 1.1 従来の防御の限界

サニタイズライブラリ（DOMPurifyなど）を使っていても、次のようなコードは開発者が気づかないままリポジトリに紛れ込みうる。

```javascript
// どこか別のファイルで、レビューを通り抜けたコード
element.innerHTML = userSuppliedString; // サニタイズ漏れ
```

この種の「danger sinkへの生文字列代入」は、静的解析やlintでは検出漏れが起きやすく、大規模なコードベース（数百〜数千ファイル）では特に深刻になる。従来のCSPの `script-src` は「どのスクリプトを実行してよいか」を制御するが、**DOM API経由で新たにDOM要素やインラインイベントハンドラを注入する攻撃（DOM XSS）そのものを直接止める仕組みではない**。

#### 1.2 Trusted Typesの基本アイデア

Trusted Typesは、ブラウザの危険なDOM API（sink）の引数として「生の文字列(string)」を受け付けなくし、代わりに**専用のオブジェクト型**（`TrustedHTML`、`TrustedScript`、`TrustedScriptURL`）のみを受け付けるように強制する。これらのオブジェクトは、開発者が明示的に定義した**ポリシー(Policy)**関数を通してしか生成できない。

```javascript
// ポリシーを作成する（アプリ起動時に一度だけ）
const policy = trustedTypes.createPolicy('my-policy', {
  createHTML: (input) => DOMPurify.sanitize(input),
});

// ポリシー経由でTrustedHTMLオブジェクトを生成
const safeHTML = policy.createHTML(userSuppliedString);

// sinkにはTrustedHTML型オブジェクトしか渡せない
element.innerHTML = safeHTML; // OK
element.innerHTML = userSuppliedString; // TypeErrorで例外、実行時に検出される
```

`element.innerHTML = userSuppliedString` のように生文字列を直接渡そうとすると、ブラウザが `TypeError` を投げて代入自体を拒否する。これは**「実行時に強制されるコンパイルエラーのようなもの」**であり、サニタイズ漏れのコードがあっても、本番環境やCI上のテストで例外として顕在化する。つまりTrusted Typesは「バグを未然に防ぐ」というより「バグを検出可能にする（サイレントな脆弱性を作らせない）」ための仕組みだと理解するのが正確である。

> ⚠️ **未取得の資料**: 「web.dev: Prevent DOM-based cross-site scripting vulnerabilities with Trusted Types」は自動取得できませんでした（理由: 環境のegressプロキシによりweb.devドメインへのアクセスがブロックされたため）。以下のURLからユーザーご自身で直接ご覧ください: https://web.dev/articles/trusted-types
>
> （以下は未取得資料の補足として一般知識およびWeb検索で得た断片情報に基づく解説です）

上記記事の要旨（Web検索結果からも裏付けられる内容）として、Trusted Types APIは「入力を、実行される可能性のあるAPIに渡す前に、開発者が指定した変換関数を必ず通過させる」ことを保証する仕組みであり、`trustedTypes.createPolicy()` によって作られたポリシーだけが `TrustedHTML` / `TrustedScript` / `TrustedScriptURL` を生成できる。有効なTrusted Typeオブジェクトは必ずいずれかのポリシーに由来するため、**アプリ全体のDOM XSS攻撃対象領域(attack surface)を「ポリシー定義部分」だけに縮小できる**という点が最大の利点である。裏を返せば、レビューやセキュリティ監査の労力も、全コードベースからポリシー定義箇所のみに絞り込める。

#### 1.3 対象となるsink（危険なDOM API）

Trusted Typesが介入する代表的なsinkは以下の通りである。

| カテゴリ | 対象sink | 要求される型 |
|---|---|---|
| HTML注入 | `Element.innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `document.writeln`, `DOMParser.parseFromString` (一部) | `TrustedHTML` |
| スクリプト実行 | `Function()` コンストラクタ, `eval()`, `setTimeout(string)`, `setInterval(string)` | `TrustedScript` |
| スクリプトURL | `HTMLScriptElement.src`, `Worker()`, `SharedWorker()`, `<iframe>` の一部属性 | `TrustedScriptURL` |

これらは全て、歴史的にDOM XSSの主要な原因となってきたAPI群である。Trusted Typesが有効化された環境では、これらのsinkに生文字列を渡すと例外が発生する（`require-trusted-types-for 'script'` が有効な場合）。

### 2. CSPによる強制: `require-trusted-types-for` と `trusted-types`

Trusted Types APIそのものは「ポリシーを定義する仕組み」を提供するだけであり、**それを使うかどうかは開発者の任意**である。この「任意性」を強制に変えるのがCSPの2つのディレクティブである。

```
Content-Security-Policy:
  require-trusted-types-for 'script';
  trusted-types my-policy dompurify-policy;
```

- **`require-trusted-types-for 'script'`**: これを指定すると、ブラウザは危険なsink（前節の表）が生文字列を受け取ることを一律で拒否するようになる。これが「強制」の本体である。
- **`trusted-types <許可ポリシー名のリスト>`**: どのポリシー名を `createPolicy()` で作成してよいかをホワイトリスト化するディレクティブ。これにより、攻撃者が仮に任意コード実行の糸口（例えば `<script>` タグの挿入以外の経路）を得たとしても、勝手に独自の「何でも許すポリシー」（`createHTML: (s) => s` のような無検証ポリシー）を作成して防御を無力化することを防げる。名前が指定されていないポリシーの `createPolicy()` 呼び出しは例外を投げて失敗する。
- **`trusted-types 'allow-duplicates'`**: 同名ポリシーの複数回作成を許可する特殊キーワード。開発中やホットリロード環境では便利だが、本番では攻撃者に同名ポリシーの上書き（後述するpolicy overrideの脆弱性クラス）を許す可能性があるため、通常は付けない。

> Trusted TypesのCSPディレクティブが**評価される仕組み**は、通常の `script-src` などのソース許可評価（URLやハッシュ・nonceとの文字列比較）とは異なり、**JavaScript実行時にDOM API呼び出しをフックし、渡された値の内部型タグ（ブランド）を検査する**という点に注意したい。CSPパーサーが静的にHTMLを解析するのではなく、ブラウザのDOM実装内部でsink呼び出しのたびに動的にチェックが入る。これはXSS対策の中でも「実行時強制型（runtime enforcement）」に分類される防御であり、静的なホワイトリスト評価しか行わない従来のCSPディレクティブより一段深いレイヤーで動作する。

#### 2.1 デフォルトポリシー(default policy)

サードパーティライブラリなど、Trusted Typesに対応していないコードが `element.innerHTML = str` のような呼び出しを行う場合に備え、名前を `'default'` としたポリシーを1つだけ定義できる。

```javascript
trustedTypes.createPolicy('default', {
  createHTML: (input) => {
    // 全ての生文字列innerHTML代入がここを通過する
    return DOMPurify.sanitize(input);
  },
});
```

`default` ポリシーが存在すると、Trusted Types未対応コードからの生文字列代入は例外を出さず、自動的にこのポリシーを通過してから実行される。移行期（レガシーコードとの共存期間）に有用だが、**全てのHTML注入がこの1つのサニタイズ関数に依存することになるため、そのサニタイズ関数自体にバグがあれば防御全体が崩れる**という一点集中リスクがある点に注意。

### 3. 攻撃者視点: Trusted Typesの回避手法

Trusted Typesは強力だが、「導入されていれば絶対に安全」というわけではない。実務・バグバウンティで観測される回避パターンを整理する。

#### 3.1 ポリシー名の推測・再利用によるバイパス

アプリが `trusted-types` ディレクティブで複数のポリシー名を許可しており、かつそのうちの1つが「入力をそのまま返す」ような緩いポリシー（デバッグ用、サードパーティ製ライブラリ互換用など）だった場合、攻撃者はJavaScript実行のプリミティブ（例えばプロトタイプ汚染や別のDOM XSSギャジェット）を経由して、その緩いポリシーを呼び出すだけでサニタイズをバイパスできる。

```javascript
// アプリがデバッグ用に緩いポリシーを許可していた場合
const p = trustedTypes.getExposedPolicy ? trustedTypes.getExposedPolicy('legacy-noop') : null;
// あるいは既存ポリシーオブジェクトへの参照を何らかの経路で取得し、
// policy.createHTML('<img src=x onerror=alert(1)>') を呼び出す
```

これが動く理由は、**Trusted Types自体は「どのポリシーが安全な実装か」を検証しない**ためである。ポリシー名をホワイトリストに載せる `trusted-types` ディレクティブは「誰が新規にポリシーを作成できるか」を制限するものであり、既に作られたポリシー実装のロジックの安全性までは保証しない。したがって、緩い実装のポリシーが1つでも存在すれば、それを呼び出せる経路がある限り防御は崩れる。

#### 3.2 `default`ポリシーの未定義によるサイレント許可の誤解

`require-trusted-types-for 'script'` が有効でも `default` ポリシーが定義されていない場合、Trusted Types未対応のサードパーティスクリプトが `innerHTML` に生文字列を代入しようとすると**例外が発生してその代入は失敗する**（サイレントに許可されるわけではない）。しかし、開発者が「動くから安全」と誤解し、エラーを握りつぶす `try/catch` でラップしてしまうと、機能は壊れたまま気づかれず、結果として`default`ポリシーを急いで追加する際に検証が甘くなりがちである。この運用上の落とし穴は実務でよく見られる。

#### 3.3 DOM Clobbering・プロトタイプ汚染との組み合わせ

Trusted Typesは「sinkに渡る値の型」を検査するが、**ポリシー関数自身のロジックにDOM Clobbering**（HTML要素の `id`/`name` 属性によってグローバル変数やDOMプロパティを意図せず上書きする手法）**やプロトタイプ汚染の影響が及ぶ場合**、ポリシー関数が誤ったサニタイズ結果を返す余地が生まれる。例えばポリシー内部で `Object.prototype` のメソッドや、グローバルに公開された設定オブジェクトのプロパティを参照している場合、事前にプロトタイプ汚染で該当プロパティを書き換えておけば、サニタイズ処理の分岐を狂わせられる可能性がある。Trusted Types自体はこの種の間接攻撃を防がないため、ポリシー実装は外部から汚染されうるグローバル状態に依存しないよう設計する必要がある。

#### 3.4 Trusted Types非対応ブラウザでの防御無効化（フォールバック問題）

Trusted TypesはBaseline化が進んでいるものの、対応が最終的に揃ったのは比較的最近である（Web検索結果によれば、Firefoxが2026年2月に対応を完了し、主要ブラウザ全体でBaselineとなったとされる）。したがって、Trusted Types自体はブラウザの機能検出に基づく段階的強化(progressive enhancement)として設計されており、**未対応の古いブラウザやTrusted Types機能を無効化した環境では、CSPの `require-trusted-types-for` ディレクティブ自体が単に無視され、生文字列のsink代入がそのまま通ってしまう**。これはTrusted Types自体の欠陥ではないが、「CSPヘッダーにTrusted Typesを設定したから安全」という早合点は禁物であり、**Trusted Typesは他の防御（strict CSPのscript-src側、入力バリデーション）と重ねて使うべき多層防御の一部**として理解する必要がある。

### 4. strict CSP（`strict-dynamic` + nonce/hash）との関係

Trusted Typesは「DOM API経由でのHTML/スクリプト注入」を防ぐが、そもそも**攻撃者が任意の `<script>` タグをHTMLレスポンスに直接挿入できるサーバサイドXSS（反射型・格納型）**には無力である。これを防ぐのがCSPの `script-src` 側での**strict CSP**設計であり、両者は補完関係にある。

strict CSPの核心は、URLホワイトリスト方式（`script-src https://cdn.example.com`）を捨て、**nonceまたはhashベースの許可**に切り替える点にある。

```
Content-Security-Policy:
  script-src 'nonce-r4nd0mBase64Value' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
```

- **`'nonce-...'`**: サーバがレスポンスごとにランダム生成したnonce値を `<script nonce="r4nd0mBase64Value">` に埋め込む。CSPはこのnonce値が一致するスクリプトタグのみ実行を許可する。攻撃者は各リクエストごとに変わるこの値を事前に予測できないため、たとえHTMLインジェクション（反射型XSSの入口）が起きても、攻撃者が挿入した `<script>` タグにはnonceが付与できず実行されない。
- **`'strict-dynamic'`**: nonceやhashで許可された「信頼できるスクリプト」が動的に生成・挿入する追加のスクリプト（例: バンドローダーが後続チャンクを `document.createElement('script')` で挿入するようなケース）にも信頼を伝播させるキーワード。これがないと、モダンなバンドラー（webpackのコード分割等）を使うアプリでCSPが機能しなくなる。`strict-dynamic` が指定されている場合、URLベースの許可リスト（`https:` や特定ドメイン）は**無視される**という仕様上の挙動があり、これによりホワイトリスト方式にありがちな「JSONPエンドポイントやオープンリダイレクトを経由したCSPバイパス」というクラスの攻撃を根本的に排除できる。
- **`object-src 'none'`**: `<object>`/`<embed>` 経由でのFlashなどのプラグインベースのXSS（レガシー環境で問題になった）を塞ぐ。
- **`base-uri 'none'`**: `<base href="https://attacker.example/">` によるsrc相対パスの乗っ取り（base tag injection）を防ぐ。nonce方式のCSPは「正しいnonceが付いたスクリプトタグ」のみを信頼するが、ページ内の相対パスの基準を書き換えられると、意図しないリソースを読み込ませられる場合があるため、この防御を必ず併用する。

#### なぜURLホワイトリスト方式は脆弱なのか（原理）

`script-src https://cdn.example.com https://*.googleapis.com` のようなホワイトリスト方式は、CSPが「文字列としてのオリジンマッチ」しか見ていないことに起因する構造的な弱点を抱える。許可された巨大なCDNやクラウドサービスのドメイン配下に、攻撃者が制御可能なJSONPエンドポイント、オープンリダイレクト、あるいはユーザーアップロード可能なファイル領域（GCS/S3バケット等）が1つでも存在すれば、そこを踏み台にして任意のJavaScriptを「許可されたオリジンから」読み込ませることができる。これは2015年前後からGoogle等の研究で繰り返し指摘されてきた、**ホワイトリスト方式CSPのバイパス手法として広く知られる問題である**。nonceベースのstrict CSPはこの「オリジン単位の粗い許可」ではなく、「サーバが発行した個別のトークン単位の許可」に切り替えることで、この攻撃クラスを構造的に排除する。

> ⚠️ **未取得の資料**: 「Chrome for Developers: Mitigate DOM-based XSS with Trusted Types (Lighthouse)」は自動取得できませんでした（理由: 環境のegressプロキシによりdeveloper.chrome.comドメインへのアクセスがブロックされたため）。以下のURLからユーザーご自身で直接ご覧ください: https://developer.chrome.com/docs/lighthouse/best-practices/trusted-types-xss
>
> （以下は未取得資料の補足として一般知識およびWeb検索で得た断片情報に基づく解説です）

Web検索結果から確認できた要点として、Lighthouseの「trusted-types-xss」監査項目は、**レスポンスのCSPヘッダーに `require-trusted-types-for` ディレクティブが `script` を値として含む形で設定されているかどうか**を機械的にチェックするものであり、設定されていない場合、あるいはCSPヘッダー自体が存在しない場合に監査failとなる。これはLighthouseの「ベストプラクティス」カテゴリの一項目として、サイト運営者がTrusted Types導入状況を継続的に可視化・追跡できるようにする目的で提供されている。関連する別の監査項目「csp-xss」は、strict CSP（nonce/hashベースかつ `'unsafe-inline'` を含まない設計）が実際に有効かどうかをより広く評価するものであり、両者は「sinkレベルの防御(Trusted Types)」と「スクリプト注入経路レベルの防御(strict CSP)」という異なるレイヤーを補完的にチェックしていると理解してよい。

### 5. 導入戦略と実務上の注意点

1. **段階的導入(Report-Onlyモード)**: `require-trusted-types-for` にはReport-Onlyモードが存在する。

   ```
   Content-Security-Policy-Report-Only:
     require-trusted-types-for 'script';
     report-uri /csp-violation-report
   ```

   これにより、実際にsink呼び出しをブロックせず「どこで違反が発生するか」だけをレポートさせ、既存コードの改修範囲を洗い出してから本番強制(enforce)に移行できる。

2. **ライブラリ対応状況の確認**: DOMPurifyは公式にTrusted Types出力オプション(`RETURN_TRUSTED_TYPE: true`)を持つなど対応が進んでいるが、対応していないサードパーティスクリプトが多いアプリでは`default`ポリシーへの依存度が高くなり、前述のリスクを抱える。

3. **フレームワーク側のサポート**: Angularは早くからTrusted Types対応を組み込んでおり、Reactも `dangerouslySetInnerHTML` 相当の箇所にポリシーを適用する運用が推奨される。新規プロジェクトではフレームワークのデフォルト設定でTrusted Types対応が有効になっているかを確認するのが効率的である。

4. **CSPとTrusted Typesは"サーバ側インジェクション対策"の代替にはならない**: 繰り返しになるが、これらはあくまで「クライアントサイドでの実行系統をどう絞り込むか」という防御であり、テンプレートエンジンでのエスケープ処理やサーバサイドの出力エンコーディングを省略してよい理由にはならない。多層防御の一段として位置づけることが重要である。

### まとめ

- Trusted Typesは、危険なDOM sinkに生文字列を渡すことをブラウザレベルで禁止し、明示的なポリシー関数を通過した型付きオブジェクトのみを受理させることで、DOM XSSの攻撃対象領域を「ポリシー定義箇所」に限定する。
- CSPの `require-trusted-types-for 'script'` がこの強制を有効化し、`trusted-types <名前リスト>` がポリシー作成自体をホワイトリスト制御する。
- 防御バイパスは「緩いポリシーの悪用」「ポリシー内部ロジックへのプロトタイプ汚染・DOM Clobberingの影響」「未対応ブラウザでのフォールバック無視」という経路で起こりうる。導入していれば絶対安全、という誤解を避ける必要がある。
- strict CSP（nonce/hashベース + `strict-dynamic` + `object-src 'none'` + `base-uri 'none'`）は、そもそも攻撃者にスクリプトタグを注入させない「入口側」の防御であり、Trusted Typesという「sink側」の防御と組み合わせることで、DOM XSSに対する多層防御が完成する。
- LighthouseなどのツールはCSPヘッダーの機械的チェックにより、これらの防御の導入状況を継続的に監視する手段を提供する。

