## SAMLの仕組みと攻撃の基礎

### SAMLとは何か

SAML（Security Assertion Markup Language）は、XMLベースの標準規格で、**IdP（Identity Provider、認証を行う主体）とSP（Service Provider、サービスを提供する主体）の間で認証・認可情報を交換する**ために使われる。企業のSSO（シングルサインオン）基盤の中核として、Okta・Azure AD（Entra ID）・PingFederate・ADFS・Shibolethなど多くの製品が実装しており、OAuth 2.0/OIDCと並んで「認証を第三者に委譲する」プロトコルファミリーの代表格である。

SAMLの認証フロー（SP-initiated flow）は次のように進む。

1. ユーザーがSP（例: 業務SaaS）のログインページにアクセスする。
2. SPは`AuthnRequest`（認証要求）を生成し、ブラウザ経由でIdPへリダイレクトする。
3. IdPがユーザーを認証する（パスワード入力、既存セッションの再利用など）。
4. IdPは認証結果を`SAML Response`として生成し、`Assertion`（アサーション、「このユーザーは誰であり、いつ、どのように認証されたか」という主張）を含めて**デジタル署名**する。
5. ブラウザはこの`SAML Response`をPOSTでSPへ送信する（HTTP-POST Binding）。
6. SPは署名を検証し、正当なIdPからの応答であることを確認してからログインを許可する。

このフローの核心は、**SPがIdPを直接信頼しているのではなく、「IdPの秘密鍵で署名されたXML文書」を信頼している**という点にある。つまりSAMLのセキュリティは、突き詰めれば「XML署名検証の実装が正しいか」にほぼ全面的に依存する。この章で扱う攻撃の大半は、この署名検証ロジックと、XMLパーサの実際の解釈（どの要素を「検証対象」とし、どの要素を「処理対象」とするか）との間にズレがある場合に成立する。

`Assertion`要素には代表的に以下が含まれる。

- `Subject` / `NameID`: 認証されたユーザーの識別子
- `Conditions`: `NotBefore`（有効開始時刻）、`NotOnOrAfter`（有効期限）、`AudienceRestriction`（このアサーションを受理してよいSPの制限）
- `SubjectConfirmationData`: `Recipient`（このアサーションの送付先URL）、`InResponseTo`（対応する`AuthnRequest`のID）
- `AttributeStatement`: ユーザーの属性（メールアドレス、ロールなど）

SAML ResponseはHTTP-POST Bindingの場合、生のXMLをBase64エンコードしてフォームに埋め込むだけだが、HTTP-Redirect Bindingの場合は**DEFLATE圧縮してからBase64エンコードし、さらにURLエンコード**する。この形式（deflate + base64）ゆえに、SAML関連のペイロードはBurp SuiteなどでSAML専用のデコード機能（SAML Raider拡張やインラインのデコーダ）が必要になる。

> 出典: Red Siege — Attacking SAML implementations — https://redsiege.com/tools-techniques/2021/11/attacking-saml-implementations/

### 攻撃の全体像 — なぜ「署名検証」が壊れるのか

SAML攻撃の大半は、次の2つの実装ミスのいずれかに起因する。

1. **署名検証そのものが甘い、または欠落している**（署名除去・署名置換・証明書偽造など）
2. **「署名を検証する対象」と「実際に処理される対象」が別のXML要素になり得る**（XML Signature Wrapping、XSLTインジェクション、XXEなど、XMLパーサ特有の脆弱性）

とりわけ2番目は、SAMLに限らずXML署名（XMLDSig）を使うあらゆるプロトコルに共通する根深い問題である。XML文書は「同じ意味のデータを複数の場所に書ける」「IDによる参照で任意の要素を指し示せる」という柔軟性を持つため、**署名アルゴリズムがXPathやIDリファレンスで指し示した特定のノードだけを検証し、アプリケーションロジックが「文書内で最初に見つかったAssertion」のような別の基準で処理対象を選ぶ**と、両者の間にズレが生じる。このズレを突くのがXML Signature Wrapping (XSW) 攻撃である。

### XML Signature Wrapping（XSW）攻撃

XSWは2012年に学術研究で体系化された攻撃手法で、**「署名済みの正規のAssertion」をXML文書内の別の場所へ移動・複製し、攻撃者が改ざんした新しいAssertionを「本来処理されるべき位置」に挿入する**ことで、署名検証は正規のAssertionに対して行われつつ、アプリケーションは改ざん済みのAssertionを処理してしまう状態を作り出す攻撃である。

代表的な8種類のバリエーションが知られている（HackTricksおよびRITVNの整理による）。

| 種別 | 対象 | 手口の概要 |
|---|---|---|
| XSW #1 | Response | 署名済みResponseを複製し、新しいルート要素として追加 |
| XSW #2 | Response | 署名要素を分離し、別の場所へ移す |
| XSW #3 | Assertion | 改ざんしたAssertionを、署名済みAssertionと同じ階層に重複配置 |
| XSW #4 | Assertion | 改ざんしたAssertionを、署名済みAssertionの内部に入れ子配置 |
| XSW #5 | Assertion | 署名を残したまま値を書き換え、非標準の位置に署名構造を配置 |
| XSW #6 | Assertion | 署名なしの偽Assertionを追加しつつ構造を工夫 |
| XSW #7 | Assertion | スキーマ検証の緩い`Extensions`要素の中に偽Assertionを埋め込む |
| XSW #8 | Assertion | `Object`ブロックなど署名関連の補助要素の中に偽Assertionを埋め込む |

たとえばXSW #1の典型的な構造は次のようになる（概念図。実際のペイロードはSAML Raiderが自動生成する）。

```xml
<samlp:Response>
  <!-- 攻撃者が追加した「処理される」偽Response（署名なし、NameIDを admin に改ざん） -->
  <samlp:Response ID="_evil">
    <Assertion>
      <Subject><NameID>admin@victim.com</NameID></Subject>
      ...
    </Assertion>
  </samlp:Response>

  <!-- 元の署名済みResponse（署名検証はこちらに対して行われる） -->
  <ds:Signature>...IdPの正規署名...</ds:Signature>
  <Assertion>
    <Subject><NameID>attacker@example.com</NameID></Subject>
    ...
  </Assertion>
</samlp:Response>
```

ここで問題になるのは、**XMLパーサが「文書順で最初に現れるResponse/Assertion」をアプリケーションロジックに渡す一方、署名検証ライブラリは`Reference URI`（署名対象を指すID参照）で指定された、元の位置にある要素だけを検証する**というギャップである。署名検証コンポーネントと業務ロジックが別々のXMLパーサ呼び出し、あるいは別々のパースツリーを使っている実装で特に起こりやすい。防御側の観点では、**署名検証後に「検証したのと同一のノード（同一オブジェクト参照）」だけを後続処理に渡す**ことが根本対策であり、IDによる再検索ではなく、検証済みDOMノードそのものを引き渡す実装にする必要がある。

> 出典: RITVN — Burp SuiteでSAML署名ラッピングを検証 — https://ritvn.com/how-to-use-burp-suite-to-verify-saml-signature-wrapping-attack/
> 出典: HackTricks — SAML Attacks — https://angelica.gitbook.io/hacktricks/pentesting-web/saml-attacks

### Burp Suite（SAML Raider）でのXSW検証手順

RITVNの記事は、SAML Raiderという無料のBurp拡張を使ったXSW検証の実務手順を示している。これは**防御側が自社のSP実装を検証するための手順**として理解するべきである。

1. Burp Suiteの「Extender」（新しいUIでは「Extensions」）→「BApp Store」から「SAML Raider」をインストールする。
2. Proxyでログインフローをインターセプトし、SPへPOSTされる`SAMLResponse`パラメータを含むリクエストを捕捉する。
3. Burpの「SAML Raider」タブでリクエストのXMLがデコードされて表示される（deflate+base64の自動デコード/エンコードをSAML Raiderが担う）。
4. 「SAML Raider」の「Attack」パネルでXSWの種別（XSW #1〜#8）を選択し、「Apply XSW」を実行すると、上記の構造に沿った改ざんリクエストが自動生成される。
5. 生成されたリクエストをSPへ送信し、**署名検証エラーにならず、かつ改ざんしたNameID等の内容でログインが成立してしまうかどうか**を確認する。

検証がすべて失敗する（=署名検証が正しく機能し、改ざんが弾かれる）ことが「安全である」ことの確認になる。逆にいずれかのXSWパターンでログインが成立してしまった場合、そのSP実装は署名検証と処理対象ノードの一致を保証できていないことを意味する。

> 出典: RITVN — Burp SuiteでSAML署名ラッピングを検証 — https://ritvn.com/how-to-use-burp-suite-to-verify-saml-signature-wrapping-attack/

### 署名除去（Signature Exclusion / Stripping）

もっとも単純だが、実務でも今なお見つかる不具合が「署名要素そのものを取り除くと検証がスキップされてしまう」パターンである。実装によっては、

```xml
<!-- 攻撃者が Signature 要素を丸ごと削除した Response -->
<samlp:Response>
  <Assertion>
    <Subject><NameID>admin@victim.com</NameID></Subject>
    ...
  </Assertion>
</samlp:Response>
```

のように`ds:Signature`要素自体を除去したSAML Responseを送ると、「署名があれば検証する」という**存在チェック依存の実装**では、署名が「ない」ため検証ロジックそのものが呼ばれず、そのままNameIDが信頼されてログインが成立してしまう。これは典型的な「セキュアバイデフォルトではない」実装ミスで、正しい実装は「SPポリシー上、署名は必須である」ことを前提に、**署名が存在しない、または検証に失敗した場合は無条件で拒否する**必要がある。

> 出典: Red Siege — Attacking SAML implementations — https://redsiege.com/tools-techniques/2021/11/attacking-saml-implementations/
> 出典: Medium（Snehal J）— Exploiting SAML implementation weaknesses — https://medium.com/@snehal_j/exploiting-saml-implementation-weaknesses-aa5c432f8a8f

### 署名置換（Signature Replacement / 証明書偽造）

これは「攻撃者が自分の証明書と鍵ペアを使ってAssertionを自己署名し、その公開鍵をResponseに同梱してSPへ送る」攻撃である。脆弱なSP実装は、

- **Responseに埋め込まれた証明書自体を信頼**し、その証明書で署名検証を通してしまう（=「あらかじめ登録済みのIdP証明書のフィンガープリントと一致するか」を確認していない）

というミスを犯す。正しい実装では、SPは事前にIdPと帯域外（メタデータ交換など）で証明書のフィンガープリントを共有・固定しておき、**Response内に埋め込まれた証明書ではなく、この事前登録済みの証明書に対してのみ**署名検証を行う必要がある。これは実質的に「証明書ピンニングを行わないTLSクライアント」と同じ構造の脆弱性であり、SAMLにおける信頼の起点（Root of Trust）をどこに置くかという設計原則の誤りに起因する。

> 出典: Red Siege — Attacking SAML implementations — https://redsiege.com/tools-techniques/2021/11/attacking-saml-implementations/

### XSLTインジェクション（署名前処理を悪用する攻撃）

一部のSAML実装、特にIdP側が受け取ったXMLに対してXSLT変換（XMLを別のXMLやテキストへ変換する変換言語）を適用する場合がある。ここで本質的に重要なのは、**XSLT変換は署名検証より前の段階で実行される**という処理順序である。つまり署名が無効、あるいは署名自体が存在しない状態でも、XSLTスタイルシートの中身は解釈・実行されてしまう。

XSLT 1.0/2.0処理系の多くは`document()`関数や、拡張関数（例: EXSLTの`exsl:document`、あるいはSaxonなど実装依存の`unparsed-text()`）を通じて、

```xml
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <xsl:value-of select="unparsed-text('file:///etc/passwd')"/>
  </xsl:template>
</xsl:stylesheet>
```

のようなスタイルシートをResponse内の変換指定として渡すことで、**ローカルファイルの読み取りや、外部URLへのアウトバウンド通信（SSRFに類似する挙動）**を引き起こせる場合がある。これはXML署名の検証順序を、暗号学的な安全性の話ではなく「そもそもいつ・何に対して行われるか」というパイプライン設計の問題として捉える必要がある好例である。対策は、XSLT変換機能自体を無効化するか、少なくとも署名検証を完了し信頼されたAssertionに対してのみ、かつサンドボックス化された安全な変換エンジン（外部エンティティ解決やファイルアクセスを禁止した設定）で処理することである。

> 出典: Medium（Snehal J）— Exploiting SAML implementation weaknesses — https://medium.com/@snehal_j/exploiting-saml-implementation-weaknesses-aa5c432f8a8f
> 出典: HackTricks — SAML Attacks — https://angelica.gitbook.io/hacktricks/pentesting-web/saml-attacks

### XXE（XML External Entity）とSAML

SAML ResponseはXML文書そのものであるため、SP側やIdP側のXMLパーサがDTD（文書型定義）の外部実体参照を許可する設定になっていれば、通常のXXE攻撃と同様の手口が成立し得る。

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<samlp:Response>
  <Assertion>
    <Subject><NameID>&xxe;</NameID></Subject>
  </Assertion>
</samlp:Response>
```

このようなペイロードを送信し、`NameID`の値としてファイル内容がエコーバックされる、あるいはSSRF（サーバー内部からの意図しない外部/内部通信）を誘発できるかを確認する。多くの現代的なXMLライブラリはデフォルトで外部実体解決を無効化しているが、**古いバージョンのライブラリや、独自にDTD処理を有効化した実装**では今なお成立し得る。防御は、XMLパーサの設定で外部DTD・外部実体・パラメータ実体のすべてを無効化することに尽きる（言語・ライブラリごとに設定方法は異なるため、使用しているXMLパーサのセキュア設定ガイドを個別に確認する必要がある)。

> 出典: HackTricks — SAML Attacks — https://angelica.gitbook.io/hacktricks/pentesting-web/saml-attacks

### XML丸めトリップ（Round-trip）の不整合

署名は通常、XML文書を正規化（Canonicalization、要素の順序・空白・名前空間宣言などを一意な形式に揃える処理）してからハッシュを計算する。ところが、**署名時に使われたXMLパーサと、検証後に実際のアプリケーションロジックが再パースする際のXMLパーサが異なるライブラリ・異なるバージョンである**場合、同じバイト列でも異なる木構造として解釈されることがある。

HackTricksが言及する具体例では、「REXML（RubyのXMLライブラリ）3.2.4以前において、署名検証前の子要素と、検証後に再パースされた子要素が異なる結果になりうる」という不整合が報告されている。この種の脆弱性はライブラリのバージョンとパーサ実装に強く依存するため、**自社が使用しているXML/SAMLライブラリの既知CVEを継続的に確認し、パッチを適用し続けること**が唯一の実務的対策になる。

> 出典: HackTricks — SAML Attacks — https://angelica.gitbook.io/hacktricks/pentesting-web/saml-attacks

### Condition検証の欠落（トークンの誤受理・受信者混乱攻撃）

`Assertion`の`Conditions`要素には、`NotBefore`/`NotOnOrAfter`（有効期限）や`AudienceRestriction`（どのSP向けかの制限）が指定される。また`SubjectConfirmationData`の`Recipient`属性は「このアサーションがどのURLに提出されるべきか」を、`InResponseTo`は「どの`AuthnRequest`への応答か」を示す。

これらの検証を省略しているSP実装では、次のような問題が生じる。

- **有効期限を検証しない**: 一度傍受・記録したSAML Responseを、期限が過ぎた後も再送（リプレイ）してログインできてしまう。
- **`AudienceRestriction`/`Recipient`を検証しない**: 同一IdPを複数のSPが信頼している構成（多くの企業SSO環境で一般的）で、あるSP-B向けに発行されたAssertionを、別のSP-Aへそのまま提出しても受理されてしまう（「受信者混乱攻撃」）。これはIdPがマルチテナント/マルチSP構成である場合に特に影響が大きい。
- **`InResponseTo`を検証しない**: IdP-initiatedフローでは`InResponseTo`が存在しないことがあり実装差が出やすいが、SP-initiatedフローで検証を省略すると、CSRF（クロスサイトリクエストフォージェリ、攻撃者が用意した別のセッションのログイン結果を被害者のブラウザに強制的に取り込ませる手口）に近い形で、攻撃者自身のアカウントへ被害者をログインさせ、被害者の操作結果を攻撃者アカウントに記録させる「ログインCSRF」が成立し得る。

対策は単純で、SP実装が**`NotBefore`/`NotOnOrAfter`・`AudienceRestriction`・`Recipient`・`InResponseTo`のすべてを仕様通りに検証する**ことである。これらはSAML 2.0仕様上「検証すべき」と明記されている項目だが、実装によっては開発の簡略化のために省略されるケースが後を絶たない。

> 出典: HackTricks — SAML Attacks — https://angelica.gitbook.io/hacktricks/pentesting-web/saml-attacks

### ログアウト機能における反射型XSS

SAMLのSingle Logout（SLO）フローでは、ログアウト後のリダイレクト先URLをクエリパラメータ等で受け渡す実装が多い。このパラメータのサニタイズが不十分な場合、

```
https://sp.example.com/saml/logout?RelayState=javascript:alert(123);
```

のようなペイロードが、ログアウト完了ページ内でそのまま出力・実行されてしまう反射型XSS（Reflected XSS、攻撃者が仕込んだスクリプトがサーバーを経由して被害者のブラウザ上で実行される脆弱性）につながることがある。これはSAML固有の脆弱性というより、SAML関連エンドポイントが受け取るあらゆるパラメータに対して、通常のWebアプリケーションと同じ入力検証・出力エンコーディングの原則が適用されるべきだという教訓である。

> 出典: HackTricks — SAML Attacks — https://angelica.gitbook.io/hacktricks/pentesting-web/saml-attacks

### 実務で使うツール

- **SAML Raider**（Burp Suite拡張、BApp Storeから無料でインストール可能）: SAML Responseのデコード表示、証明書の生成・置換、XSW #1〜#8の自動生成、署名の除去などを一括して行える、SAMLセキュリティ検証の事実上の標準ツール。
- **SAMLExtractor**: 対象アプリケーション群からSAMLのACS（Assertion Consumer Service、SPがSAML Responseを受け取るエンドポイント）URLを一括抽出するための補助ツール。

これらはいずれも「自社が管理するSP/IdP環境に対する許可された検証」を前提としたツールであり、実在の本番サービスに対して無許可で使用してはならない。

> 出典: Red Siege — Attacking SAML implementations — https://redsiege.com/tools-techniques/2021/11/attacking-saml-implementations/
> 出典: HackTricks — SAML Attacks — https://angelica.gitbook.io/hacktricks/pentesting-web/saml-attacks

### 防御のまとめ

本章で扱った攻撃はいずれも、SAML実装の以下のポイントに集約される。

1. **署名検証を必須化する**: 署名の有無をチェックするのではなく、「署名がなければ即拒否」をポリシーとして固定する。
2. **信頼の起点をResponse内の証明書に置かない**: 検証に使う証明書は、事前にIdPと帯域外で交換・登録したものだけを使う。
3. **検証済みノードと処理対象ノードを一致させる**: XSW対策として、署名検証ライブラリが検証したのと同一のDOMオブジェクトを、後続のビジネスロジックにそのまま渡す実装にする。IDによる再検索や、文書内の「最初に見つかった要素」を信頼しない。
4. **XML処理の周辺機能を最小化する**: XSLT変換・外部DTD/外部実体解決・XInclude等、署名検証前に任意のコードや外部リソースへアクセスし得る機能はすべて無効化する。
5. **Conditions・Recipient・InResponseToを仕様通り検証する**: 有効期限切れ・対象外SP・対象外エンドポイント向けのアサーションを確実に拒否する。
6. **周辺パラメータの入力検証も怠らない**: RelayStateなどSAML以外の一般的なWebパラメータにも、通常のXSS/インジェクション対策を適用する。

これらはいずれも、実在サービスへの無許可な検証ではなく、**自社が管理するSAML実装（テスト環境のIdP/SPや、SAML Raiderのようなツールで用意したローカルの検証環境）に対して**確認すべき項目である。
