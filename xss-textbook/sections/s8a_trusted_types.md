## Trusted Types / strict CSP

これまでの章では、`innerHTML` への未検証な文字列代入や `eval` 系APIの誤用といった **DOM-based XSS**、そしてそれを防ぐはずの **CSP（Content Security Policy）** が現実には97%近くバイパス可能である事情（「CSP Is Dead」論文、第4章参照）を見てきました。CSPの `script-src`／`object-src` によるホワイトリストは「どのスクリプトを実行してよいか」をURLやハッシュで宣言する仕組みですが、これはあくまで**スクリプトの出どころ**を制限するものであり、「アプリのコード自身が信頼できない文字列をDOM XSSシンクに流し込む」というバグそのものは塞ぎません。本節で扱う **Trusted Types** は、この「コードの出どころ」問題ではなく「**シンクに渡る値の型**」問題に踏み込んで、DOM-based XSSをブラウザレベルで構造的に潰そうとする、比較的新しいWebプラットフォームのセキュリティ機構です。

### Trusted Typesが解決しようとしている問題

Googleの分析によれば、2020年前後の実世界のXSS脆弱性のうち相当割合が「反射型／格納型」ではなく、クライアントサイドJavaScript自身が原因のDOM-based XSSでした。典型的な脆弱パターンは次のようなものです。

```javascript
// 攻撃者が制御できる可能性のある値を、
// そのまま危険なシンクに渡している
element.innerHTML = location.hash.slice(1);
```

`innerHTML` に代入された文字列は、ブラウザの**HTMLパーサ**によって再解釈され、`<img src=x onerror=alert(1)>` のようなペイロードがそのままDOM要素として構築されてしまいます。これは「文字列としては正しいデータだが、実行コンテキストに置かれた瞬間にコードとして再解釈される」という、XSSに共通する構造的な脆弱性です。

Trusted Typesのアイデアは単純です。**「危険なシンク（sink）関数に、生の文字列（string）を渡すこと自体を、ブラウザのレベルで禁止する」**。そのうえで、文字列の代わりに `TrustedHTML` / `TrustedScript` / `TrustedScriptURL` という特別なラッパー型のオブジェクトだけをシンクに渡せるようにし、そのラッパーオブジェクトは開発者が明示的に定義した「**ポリシー（policy）**」関数を通してしか生成できないようにします。つまり、アプリ内で文字列がシンクに到達しうる経路を、あらかじめ定義された少数のポリシー関数に強制的に集約させるわけです。

> 出典: web.dev — Trusted Types — https://web.dev/articles/trusted-types

### 危険なシンク関数の一覧

Trusted Typesが監視対象とするDOM XSSシンクは、大きく次のカテゴリに分かれます。

- **HTML注入系**: `Element.innerHTML`、`Element.outerHTML`、`Element.insertAdjacentHTML()`
- **ドキュメント書き換え系**: `document.write()`、`document.writeln()`
- **パーサ呼び出し系**: `DOMParser.parseFromString()`
- **`<script>` 要素の内容設定**: `HTMLScriptElement` のテキストコンテンツやsrc属性
- **プラグイン実行系**: `<embed src>`、`<object data>`
- **動的コード実行系**: `eval()`、`setTimeout()`／`setInterval()`（文字列を渡す形式）、`new Function()`

これらはすべて「文字列 → ブラウザ内部でのコード／マークアップとしての再解釈」という同じ危険パターンを持つため、Trusted Typesはこれらの引数の型シグネチャを、単なる `string` から `TrustedHTML` や `TrustedScript` などに置き換えます。ブラウザは、これらのシンクに素の文字列が渡されると、Trusted Types強制モードでは **`TypeError` を投げて実行を止めます**。

### CSPディレクティブによる有効化

Trusted Typesは新しいCSPディレクティブとして提供されます。導入は通常2段階で行います。

**第1段階: `Report-Only` モードで違反を可視化する**

```
Content-Security-Policy-Report-Only: require-trusted-types-for 'script';
  report-uri //my-csp-endpoint.example
```

このヘッダはページの動作をブロックせず、「もし enforcing モードだったらブロックされていたはずの箇所」をレポートとして送信するだけです。既存の大規模アプリでは、どこにどれだけ危険なシンク呼び出しが残っているか事前に把握できないことが多いため、まずreport-onlyで全違反を洗い出すのが定石です。

**第2段階: 違反箇所を修正したうえで `enforcing` モードに切り替える**

```
Content-Security-Policy: require-trusted-types-for 'script';
  report-uri //my-csp-endpoint.example
```

`require-trusted-types-for 'script'` が指定されると、対象ページ内のすべての危険シンクは、生の文字列ではなくTrusted Type値しか受け付けなくなります。さらに `trusted-types` ディレクティブを組み合わせることで、「そのページ上でどの名前のポリシーの作成を許可するか」を宣言できます（後述）。

`require-trusted-types-for` は**サイト全体ではなく個々のドキュメント（HTMLレスポンス）単位**で効きます。したがって、機能を段階的にロールアウトしたいアプリケーションは、ページ単位でこのヘッダを有効化していくことができます。

### なぜ仕組みとして有効なのか——ポリシーへの集約

Trusted Typesが強力なのは、「シンクに到達する経路を1か所に集約させる」設計にあります。ポリシーはTrusted Typeオブジェクトのファクトリであり、次のように作成します。

```javascript
if (window.trustedTypes && trustedTypes.createPolicy) {
  const escapeHTMLPolicy = trustedTypes.createPolicy('myEscapePolicy', {
    createHTML: string => string.replace(/</g, '&lt;')
  });
}
```

`createPolicy()` の第一引数はポリシー名、第二引数はルールオブジェクトです。ルールオブジェクトに定義できるメンバーは `createHTML`／`createScript`／`createScriptURL` の3つで、それぞれ対応するTrusted Type（`TrustedHTML`／`TrustedScript`／`TrustedScriptURL`）を生成する関数です。重要なのは、**これらの関数自体は普通の文字列を返してよい**という点です。ブラウザは、ポリシー経由で返された文字列を自動的に対応するラッパー型でラップして返します。つまりセキュリティ上の意味は「関数の戻り値が安全であること」ではなく「**その文字列がこのポリシー関数を通過したという証跡があること**」にあります。

```javascript
const escaped = escapeHTMLPolicy.createHTML('<img src=x onerror=alert(1)>');
console.log(escaped instanceof TrustedHTML);  // true
el.innerHTML = escaped;  // 実際にDOMに入るのは '&lt;img src=x onerror=alert(1)>'
```

ここでの `escaped` は生の文字列ではなく `TrustedHTML` インスタンスなので、`el.innerHTML = escaped` はTrusted Types強制下でも許可されます。逆に `el.innerHTML = someRawString` のようにポリシーを経由しない文字列を直接渡すコードは、強制モードで即座に `TypeError` になります。

この仕組みが効くのは、**「ポリシー内のロジックが壊れていない限り」** という前提があるからです。言い換えると、Trusted Typesはアプリ全体に散らばっていた「文字列→シンク」の危険な経路を、開発者が明示的に作った少数の `createHTML`/`createScript`/`createScriptURL` 実装に強制的に集約させます。セキュリティレビューやコードオーディットは、アプリ全体を洗うのではなく、**このポリシー関数群だけを重点的に見ればよい**ことになります。web.dev の記事はこれを「enforcement後はDOM XSSの攻撃対象領域がポリシーコード内に限定される」と表現しています。

### `default` ポリシーとサニタイザ統合

すべての `innerHTML` 代入箇所を手作業でポリシー呼び出しに書き換えるのは、大規模な既存コードベースでは現実的でないことがあります。そのための例外的な仕組みが **`default` という予約名のポリシー** です。名前が `default` のポリシーを一つ定義しておくと、ポリシーを経由せずに素の文字列がシンクに渡された場合、ブラウザはまずこの `default` ポリシーを暗黙に適用してからシンクに渡します。

```javascript
if (window.trustedTypes && trustedTypes.createPolicy) {
  trustedTypes.createPolicy('default', {
    createHTML: (string, sink) =>
      DOMPurify.sanitize(string, { RETURN_TRUSTED_TYPE: true })
  });
}
```

ここで使われている **DOMPurify**（第4章で扱ったHTMLサニタイズライブラリ）は `RETURN_TRUSTED_TYPE: true` オプションに対応しており、サニタイズ結果を生文字列ではなく `TrustedHTML` として返せます。これにより、「既存コードは書き換えずに、シンクに到達するすべての文字列を自動的にサニタイズにかける」という後方互換的な導入経路が成立します。

ただし、web.dev の記事は明確に注意を添えています。**default policyはあくまで移行期の便法であり、恒久的な設計としては個々の呼び出し箇所を専用ポリシーにリファクタリングするほうが望ましい**、という趣旨です。理由は、default policyがアプリ内のすべての未分類の文字列を一手に引き受けてしまうため、「本来は文字列を通すべきでない完全に信頼できないシンク呼び出し」までもがサニタイズさえ通ればブロックされずに素通りしてしまう、粒度の粗さにあります。さらに、サニタイズロジック自体にバグがあれば（第4章のmXSSやDOMPurifyのミューテーションXSSの議論を参照）、Trusted Typesを導入していてもDOM-based XSSは残存しうる、という限界も明記されています。

### 違反レポートの取得方法

Trusted Types違反は、CSP違反と同じ `securitypolicyviolation` イベント、またはより汎用的な `ReportingObserver` API で捕捉できます。

```javascript
const observer = new ReportingObserver((reports, observer) => {
  for (const report of reports) {
    if (report.type !== 'csp-violation' ||
        report.body.effectiveDirective !== 'require-trusted-types-for') {
      continue;
    }
    const violation = report.body;
    console.log('Trusted Types Violation:', violation);
  }
}, { buffered: true });
observer.observe();
```

`buffered: true` を指定すると、オブザーバー登録より前に発生していた違反もバッファから取得できます。`report.body.effectiveDirective` が `'require-trusted-types-for'` であるものだけをフィルタすることで、通常のCSP違反（`script-src` 違反など）と区別してTrusted Types固有の違反だけを収集できます。本番導入の実務では、これをサーバーサイドの `report-uri`／`report-to` エンドポイントで集約し、report-onlyフェーズでの「未対応シンク一覧」の洗い出しに使います。

> 出典: web.dev — Trusted Types — https://web.dev/articles/trusted-types

### ブラウザ対応状況（2026年時点）

Trusted Typesは長らくChromium系ブラウザだけの機能でしたが、対応状況は近年大きく前進しています。

| ブラウザ | 対応バージョン | 対応時期 |
|---|---|---|
| Chrome / Edge | 83以降 | 2020年5月 |
| Safari | 26以降 | 2025年9月 |
| Firefox | 対応版以降 | 2026年2月 |

Firefoxが2026年2月に対応したことで、Trusted Typesは主要4ブラウザすべてで動作する **Baseline**（Web機能の相互運用性を示すステータス）に到達しました。未対応ブラウザ向けには公式のポリフィル（`w3c/trusted-types` リポジトリで提供）が用意されており、`trustedTypes` オブジェクトが存在しない環境でもポリシー生成コードを分岐なく書けるようにできます。

```javascript
if (window.trustedTypes && trustedTypes.createPolicy) {
  // Trusted Types対応ブラウザのみ実行
}
```

この `window.trustedTypes && trustedTypes.createPolicy` という feature-detection パターンは、web.devの例でも一貫して使われており、未対応ブラウザではこのブロックがまるごとスキップされて通常のDOM操作にフォールバックする、後方互換な書き方になっています。

### `trusted-types` ディレクティブによるポリシー名の制限

`require-trusted-types-for 'script'` だけでは「どのコードがどんな名前のポリシーを作れるか」までは制限されません。攻撃者がインジェクションによって独自の `default` という名前のポリシーを新たに登録できてしまえば、正規のポリシーを上書き（あるいは先取り）して攻撃者の任意のcreateHTML実装を仕込む「**ポリシー注入**」が理論上可能になります。これを防ぐのが `trusted-types` ディレクティブです。

```
Content-Security-Policy:
  require-trusted-types-for 'script';
  trusted-types myEscapePolicy default;
```

このように許可するポリシー名を明示的に列挙しておくと、リストにない名前で `createPolicy()` を呼んでもブラウザは例外を投げて拒否します。さらに `trusted-types` ディレクティブに `'allow-duplicates'` を指定しない限り、同名のポリシーを二重登録することもデフォルトで禁止されます。これにより、「攻撃者が任意のJS実行を1回だけ得たとしても、既存のポリシー名を乗っ取ることはできない」という追加の防御層が成立します。

### Lighthouseの監査項目「Trusted Types」

Chrome DevToolsに統合された監査ツール **Lighthouse** には、Best Practices カテゴリの一項目として "Mitigate DOM-based XSS with Trusted Types"（DOM-based XSSをTrusted Typesで緩和する）という監査が存在します。この監査は、レスポンスのCSPヘッダを検査し、`require-trusted-types-for` ディレクティブが設定されているかどうかを機械的にチェックします。

監査に合格するための最小要件は、次のヘッダをページのCSPに含めることです。

```
Content-Security-Policy: require-trusted-types-for 'script';
```

Chrome開発者ドキュメントの説明では、Trusted Typesは「危険なインジェクションポイント（`.innerHTML` など）で未検証の文字列が使われることをブロックする、Webプラットフォームのセキュリティ機能」と位置づけられています。監査自体はヘッダの**有無**を機械的に見るだけであり、ポリシー内部のサニタイズロジックの妥当性までは検証しません。したがって、この監査に合格していること自体は「Trusted Typesが有効化されている」ことの証明にはなっても、「default policyの実装が安全である」ことの証明には**なりません**——ここは監査結果を過信しないうえで押さえておくべき注意点です。

> 出典: Chrome for Developers — Trusted Types（Lighthouse Best Practices） — https://developer.chrome.com/docs/lighthouse/best-practices/trusted-types-xss

### strict CSPとの関係——両者は補完関係にある

第4章で見た「strict CSP」（`'strict-dynamic'` とnonce/hashを組み合わせたCSP）は、「**どのスクリプトの実行を許可するか**」という出所ベースの制御でした。一方Trusted Typesは、「**アプリ自身のコードが、信頼できない文字列を危険なシンクに渡すこと自体**」を防ぐ、実行時の型制約です。両者が対象とする攻撃面は重なりません。

- strict CSPだけを導入した場合: 攻撃者が外部から `<script src=//evil.com>` を注入するタイプの攻撃(第三者スクリプトの持ち込み)は防げますが、アプリ自身のコードが `el.innerHTML = userInput` のようにDOM-based XSSを埋め込んでいれば、そのコードは「正規のインラインスクリプト」として実行されてしまうため無力です。
- Trusted Typesだけを導入した場合: DOM-based XSSのシンク経路は塞げますが、サーバーサイドの反射型XSSのように、そもそも攻撃者の `<script>` タグがマークアップとしてページに書き出されてしまうケースまでは防げません（それを防ぐのはCSPの `script-src` 側の役割です）。

したがって実務上の到達点は、**strict CSPで「未承認スクリプトの実行」を止め、Trusted Typesで「アプリ自身のコードが引き起こすDOM-based XSS」を止める**、という二層防御の組み合わせです。CSPヘッダに両方のディレクティブを同時に指定すること自体は問題なく可能です。

```
Content-Security-Policy:
  script-src 'nonce-RANDOM123' 'strict-dynamic';
  object-src 'none'; base-uri 'none';
  require-trusted-types-for 'script';
  trusted-types default;
```

### 導入フローのまとめ

1. **Report-Onlyで観測**: `require-trusted-types-for 'script'` をreport-onlyヘッダで先行導入し、`report-uri`／`ReportingObserver` で違反箇所を洗い出す。
2. **危険シンクの棚卸し**: `innerHTML`／`document.write`／`eval` などの呼び出し箇所を特定し、可能な限り安全なAPI（`textContent`、`setAttribute` など）への置き換え、またはDOMPurifyのような検証済みサニタイザを介したポリシー呼び出しに書き換える。
3. **ポリシーの命名と制限**: `trusted-types` ディレクティブで許可するポリシー名を明示的に宣言し、ポリシー注入・二重登録を防ぐ。
4. **段階的にenforcingへ移行**: すべての既知の違反が解消されたことを確認したうえで、`Content-Security-Policy-Report-Only` から `Content-Security-Policy` に切り替える。
5. **strict CSPと併用**: `script-src` 側のホワイトリスト回避（第4章参照）を防ぐため、nonceベースのstrict CSPと組み合わせて多層防御とする。

Trusted Typesは万能薬ではありません。既存の巨大なコードベースへの導入コストは高く、default policyに頼りすぎればサニタイズの粒度が粗くなり、そのサニタイザ自体のバグ（mXSSなど）はTrusted Types自体では検出できません。しかし、「DOM-based XSSの発生源をアプリ内の少数の監査可能な地点に強制的に集約する」という設計思想は、CSPのホワイトリストが構造的に抱えていた「回避経路の多さ」という問題（第4章「CSP Is Dead」参照）とは異なる角度からXSSを封じ込める、現時点でもっとも仕組みレベルで筋の良い防御策の一つです。
