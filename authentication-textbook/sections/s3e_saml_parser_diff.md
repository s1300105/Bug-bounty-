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
