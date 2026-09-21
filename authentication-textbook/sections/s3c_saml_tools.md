## SAML Raiderと署名ラッピング（XSW）

SAMLの署名検証は「XMLパーサがどのノードを検証したか」と「アプリケーションがどのノードを処理に使うか」が食い違うと、致命的な認証バイパスにつながります。この節では、その検証を実務で行うためのBurp Suite拡張「SAML Raider」の機能と、XSW（XML Signature Wrapping、XML署名ラッピング）攻撃の8つのバリエーション（XSW1〜XSW8）の仕組みを、原理レベルで解説します。

### SAML Raiderとは何か

SAML Raiderは、SAML2ベースの認証基盤をテストするために作られたBurp Suite拡張機能です。スイスの技術大学（HSR：現OST）の卒業論文プロジェクトとして、Roland BischofbergerとEmanuel Dudaによって開発されました。MITライセンスで公開されており、Burp Suiteの「BApp Store」から検索してインストールするのが推奨されている方法です。手動でインストールする場合は、リリースされているJARファイル（例: `saml-raider-2.5.2.jar`）をダウンロードし、Burpの拡張機能タブから読み込みます。

> 出典: SAML Raider (Burp拡張) — https://github.com/CompassSecurity/SAMLRaider

SAML Raiderは大きく分けて2つの機能を提供します。

1. **メッセージエディタ（Message Editor）**: BurpでインターセプトしたSAMLメッセージ（`SAMLRequest`パラメータや`SAMLResponse`パラメータ）をデコードして表示・編集し、XSW攻撃やXXE（XML外部エンティティ）、XSLTインジェクションなどのペイロードをワンクリックで挿入できます。POSTバインディング、Redirectバインディング、SOAPバインディング、URIバインディングに対応しており、SAML Webブラウザ SSOプロファイルとWeb Services Security SAML Token Profileの両方を扱えます。
2. **証明書管理（Certificates）**: X.509証明書のインポート・エクスポート（PEM/DER形式）、証明書チェーンの取り込み、秘密鍵（PKCS#8形式やRSA PEM形式）のインポート・エクスポート、そして証明書の**クローン化**や**自己署名**（自分の鍵で新しい証明書を作る）機能を持ちます。

なぜ証明書管理機能が重要かというと、XSW攻撃の中には「攻撃者が自分の署名鍵で偽の署名を付与する」パターンがあり、そのためには検証対象のIdP（Identity Provider、SAMLアサーションを発行する側）証明書を「クローン」して自己署名した偽証明書を用意する必要があるからです。SAML Raiderはこの一連の作業をGUI上で完結させます。

実務上の設定のコツとして、Burpのインターセプトルールに「パラメータ名が`SAMLResponse`を含むリクエストを対象にする」という条件を追加しておくと、SSOフロー中のレスポンスを確実に捕捉できます。カスタムパラメータ名（`SAMLResponse`以外の名前でSAMLメッセージをやり取りする実装）を使う場合は、SAML Raiderの証明書タブ側でパラメータ名を設定できます。また、XXE攻撃を試す際には、XMLの整形（pretty print）によってペイロードが壊れることがあるため、「Raw モード」での編集が推奨されています。

> 出典: SAML Raider (Burp拡張) — https://github.com/CompassSecurity/SAMLRaider

### XSW（XML Signature Wrapping）とは何か：根本原理

XSW攻撃は、XML署名（XML Digital Signature）の検証プロセスと、アプリケーションがビジネスロジックで実際に読み取るデータ構造が「別物」であるというギャップを突く攻撃です。

通常、SAMLレスポンスの処理は次の2ステップに分かれます。

1. **署名検証（Signature Validation）**: XML署名ライブラリが、署名対象として指定された要素（`<ds:Reference URI="#...">`で参照されるID）のダイジェスト（ハッシュ値）を再計算し、格納されている`<ds:SignatureValue>`と照合する。
2. **ビジネスロジック処理（Assertion Processing）**: アプリケーション（Service Provider、以下SP）側のコードが、XMLドキュメントをXPathやDOM APIで走査し、「どこかにある`<saml:Assertion>`」を取り出してユーザー名や属性を読み取る。

この2つのステップが**同じ要素**を対象にしていれば問題はありません。しかし、多くの実装では、ステップ1は「署名が指す`Reference URI`のID」を厳密に見て検証する一方、ステップ2は「ドキュメント中で最初に見つかった、あるいは特定のXPathにマッチする`Assertion`要素」を読み取る、という実装になりがちです。ここに**署名検証の対象**と**処理対象**の不一致が生まれます。

攻撃者はこの不一致を突き、次のようなXMLを作ります。

- 元の（正規にIdPが署名した）`Assertion`はそのままドキュメント内に残す（署名検証はこれを見て「正当」と判定する）。
- その隣、あるいは入れ子構造の中に、攻撃者が改ざんした**署名なしの偽Assertion**を追加する（アプリケーションのビジネスロジックはこちらを読んでしまう）。

XMLパーサとXPathの「兄弟要素・親子要素・同一ID属性の重複」に対する寛容さ（曖昧な扱い）が、この攻撃を成立させる土台になっています。これがXSWの核心原理です。

この攻撃を最初に体系化したのはSomorovskyらによる2012年の研究（"On Breaking SAML: Be Whoever You Want to Be"）で、そこで8種類の典型的なXSWバリエーションが定義されました。SAML Raiderはこの8種類（XSW1〜XSW8）をワンクリックで生成できるテンプレートとして実装しています。

### XSW1〜XSW8：各バリエーションの構造と狙い

以下、SAML Raiderが提供する8種類の代表的なXSWパターンを、DOM構造レベルで説明します。実際のXMLの詳細な属性名は実装により差がありますが、「どこに何を挿入し、署名検証と処理対象がどうズレるか」という構造原理は共通です。

#### XSW1：Response全体を複製して署名の外側に追加

```xml
<samlp:Response ID="original-id" ...>
  <ds:Signature>...署名: original-id を参照...</ds:Signature>
  <saml:Assertion>...正規の（署名対象の）Assertion...</saml:Assertion>
</samlp:Response>

<!-- XSW1が追加する偽Responseは元Responseの兄弟として、
     または元Response配下の末尾に挿入される -->
<samlp:Response ID="evil-id" ...>
  <saml:Assertion>...攻撃者が改ざんしたAssertion（署名なし）...</saml:Assertion>
</samlp:Response>
```

XSW1はResponseメッセージ全体を複製し、正規の署名済みResponseの後ろに、署名を持たない偽Responseを追加します。SPの実装が「ドキュメント内で最後に見つかったResponse（またはAssertion）」を処理に使うタイプの場合、署名検証は元のResponseに対して成功する一方、実際にログインに使われるのは末尾の偽Responseになります。これは最も単純な「パーサがどの要素を拾うか」への依存を突く攻撃です。

#### XSW2：XSW1に近いが、挿入位置・IDの扱いが異なるバリエーション

XSW2はXSW1と似た構造ですが、偽Responseの挿入位置や属性の持たせ方（例えば元のResponseのIDを流用しない、または別の位置関係にする）が異なる亜種です。SPのパース実装によって「最初に見つかった要素を使うか」「最後に見つかった要素を使うか」の挙動が異なるため、XSW1とXSW2はペアで用意され、どちらのパース戦略の実装にも対応できるようにしてあります。

#### XSW3・XSW4：Assertionを入れ子にして「外側」を読ませる

```xml
<saml:Assertion ID="evil-id">          <!-- 署名なしの攻撃者Assertion（外側） -->
  <saml:Subject>attacker@evil.example</saml:Subject>
  <saml:AttributeStatement>...改ざんした属性...</saml:AttributeStatement>

  <saml:Assertion ID="original-id">     <!-- 元の署名済みAssertion（内側） -->
    <ds:Signature>...original-id を参照...</ds:Signature>
    <saml:Subject>victim@example.com</saml:Subject>
  </saml:Assertion>
</saml:Assertion>
```

XSW3・XSW4は、正規の署名済みAssertionを、攻撃者が作った偽Assertionの**内側（子要素）**として埋め込みます。署名検証ライブラリはID参照で`original-id`を見つけ、その部分木のダイジェストを計算するので検証は成功します。しかし、多くのSP実装は「ドキュメントのルート、あるいはXPathで最初にマッチしたAssertion要素」を処理対象にするため、外側の攻撃者Assertion（`evil-id`）の属性が読み取られてしまいます。XSW3とXSW4は、この入れ子構造を`Response`直下に置くか`Assertion`自身の中に置くかなど、挿入位置の違いによる亜種です。

#### XSW5・XSW6：署名そのものを攻撃者の要素に「移設」する

XSW5は一歩進んで、元のAssertionから`<ds:Signature>`要素そのものを取り出し、攻撃者が作った偽Assertionの中に移設します。この状態で、署名の`Reference URI`は元のAssertionのIDを指したままにしておくと、署名ライブラリは「ID参照先の部分木」のダイジェストを計算して検証には成功しますが、SPが実際に読み取る「署名を含んでいる要素」としては攻撃者のAssertionが選ばれてしまう実装があります。これは「署名がどのAssertionに“属している”とSP側のコードが判断するか」というロジックの曖昧さを突くパターンです。

XSW6はXSW5をさらに発展させ、元の署名済みAssertionを、攻撃者Assertionの`<Extensions>`要素（拡張用の任意要素を格納する場所）の中に移動させます。多くのXMLパーサやXPathクエリは`Extensions`要素の中身を「本文とは別の付随情報」として扱うため、ビジネスロジックが誤って外側の攻撃者Assertionを本体として処理してしまう可能性が高まります。

#### XSW7：Extensions要素を悪用した属性追加型

XSW7は、正規の署名済みAssertion自体は変更せず、その`<Extensions>`要素の中に攻撃者の偽データを追加するパターンです。署名対象の範囲設定（署名が`Extensions`要素の中身の変更を検知できるかどうか）が実装によって曖昧な場合、署名検証を壊さずに追加情報を混入させられることがあります。

#### XSW8：Object要素を使ってSOAP/Assertion単体メッセージを狙う

```xml
<saml:Assertion ID="original-id">
  <ds:Signature>
    <ds:SignedInfo>...</ds:SignedInfo>
    <ds:SignatureValue>...</ds:SignatureValue>
    <ds:KeyInfo>...</ds:KeyInfo>
    <ds:Object>
      <!-- ここに元のAssertionのコピー（署名を除去したもの）を格納 -->
      <saml:Assertion ID="evil-id">...改ざんしたコピー...</saml:Assertion>
    </ds:Object>
  </ds:Signature>
  <saml:Subject>victim@example.com</saml:Subject>
</saml:Assertion>
```

XSW8は、Assertion単体（Response全体ではなくAssertionメッセージ単体、例えばWeb Services Security SAML Token ProfileのようなSOAPベースの文脈）を対象にした亜種です。XML署名の`<ds:Object>`要素（署名本体とは別に任意のデータを格納できる場所）の中に、署名を取り除いた偽Assertionのコピーを埋め込みます。SP側の実装が「署名要素の中まで探索してAssertionを拾ってしまう」ような雑なXPathクエリ（例: `//saml:Assertion`のようにドキュメント全体から無条件にマッチさせるクエリ）を使っていると、このObject内の偽データが処理対象として選ばれてしまいます。

> 出典: SAML Raider (Burp拡張) — https://github.com/CompassSecurity/SAMLRaider

### なぜこれが成立するのか：仕組みレベルの整理

XSW攻撃全体に共通する原理は、次の3点に集約できます。

1. **署名検証はID参照（`Reference URI="#id"`）で対象を特定する**。XML文書内に同じ構造や似た要素が複数存在しても、署名検証ライブラリは指定されたIDの部分木さえ見つければ検証を通してしまう。XML仕様上、同一ドキュメント内でIDの一意性が保証されない、あるいはパーサがそれを強制しない実装が存在することが前提になる。
2. **ビジネスロジックはXPathやDOM APIの「最初にマッチした要素」「特定の位置」を素朴に信頼する**。多くの実装は「署名を検証したら、その署名がどの要素にかかっていたかを厳密に追跡する」のではなく、「ドキュメントのどこかにあるAssertion要素を読む」という素朴な実装になりがちである。
3. **署名検証とビジネスロジックが別々のコードパス（多くの場合、別ライブラリ・別処理フェーズ）で動く**。検証結果（真偽値）だけがビジネスロジック側に渡され、「どの具体的なDOMノードを検証したか」という情報が引き継がれないと、検証済みノードと処理対象ノードの同一性を保証できなくなる。

つまりXSWは、暗号アルゴリズム自体の弱点ではなく、**「検証した対象」と「使用した対象」の同一性検証の欠落**という、実装・パーサレベルの設計ミスを突く攻撃です。これは同種の脆弱性がSAML以外（例えばJWTの`kid`ヘッダ改ざんや、XML全般を扱うプロトコル）でも繰り返し現れる典型的なパターンであり、理解しておく価値があります。

### 防御策

- **署名検証後、実際にビジネスロジックで処理する要素が「検証済みの署名が指すノードそのもの」であることを、DOMノードの参照（オブジェクトID）レベルで確認する**。XPathで再検索するのではなく、署名ライブラリが返す「検証済みノードへの参照」をそのまま後続処理に渡す実装にする。
- **ドキュメント内に許可された数以上のSignature要素・Assertion要素・Response要素が存在する場合はエラーとして拒否する**（構造的な異常を検知して弾く）。
- **信頼できるSAMLライブラリ（OpenSAML、Duende、Sustainsys.Samlなど、XSW対策済みとして知られる実装）を使い、自前でXMLをパースして署名検証を行う実装を避ける**。
- 定期的にSAML Raiderなどのツールで自組織のSP実装に対してXSW1〜XSW8のパターンを（許可された検証環境でのみ）試験し、いずれのパターンでも認証バイパスが成立しないことを確認する。

> ⚠️ **未取得の資料**: 「SAML From A Hackers Perspective Part 4 - XSW」（YouTube動画）は、字幕・文字起こしを自動取得できませんでした（理由: YouTubeの動画ページはナビゲーション要素のみが取得され、字幕データやトランスクリプトが取得対象に含まれていないため）。以下のURLからご自身で直接ご覧ください: https://www.youtube.com/watch?v=ALakvKDsZLo
>
> （以下は未取得資料の補足として一般知識に基づく解説です）この動画は2018年9月に公開された、SAMLをハッカー視点で解説する連続シリーズの第4回で、タイトルが示す通りXSW（Signature Wrapping Attacks）をテーマにしています。シリーズの構成（第1回: 導入、第2回: SAMLフローの分析、第3回: アサーションの詳細）から見て、この第4回では前述のXSW1〜XSW8のようなバリエーションを、実際のSAMLレスポンスのXML構造を見せながらデモンストレーションし、Burp SuiteやSAML Raiderのような拡張を使って手を動かして再現する内容であると推測されます。動画の具体的な発言内容や画面上のペイロードの一字一句については、本節の説明はあくまで一般的なXSWの知識に基づくものであり、動画そのものの検証結果ではない点に留意してください。

### まとめ

SAML Raiderは、SAML実装のXSW脆弱性を実務レベルで検証するための代表的なBurp Suite拡張であり、8種類の典型的なラッピングパターン（XSW1〜XSW8）をワンクリックで生成できます。これらの攻撃はいずれも「署名検証の対象」と「アプリケーションが実際に読み取る対象」がズレるという共通の原理に基づいており、防御側は署名ライブラリが返す検証済みノードをそのまま後続処理に使う、構造的な異常（重複するSignature/Assertion/Response要素）を拒否する、といった対策を実装レベルで徹底する必要があります。
