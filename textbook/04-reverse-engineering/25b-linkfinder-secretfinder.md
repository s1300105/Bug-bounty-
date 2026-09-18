# SecretFinder でJavaScriptから機密情報を掘り出す — 検出ルール・内部動作・Burp拡張・実務運用

> **この節で分かること**
> - SecretFinder の使い方（入力の種類・主要オプション）を、原文のコマンドどおりに自分で実行できる
> - SecretFinder が持つ31本の検出正規表現が「何を狙い、どこで誤検出するか」を説明できる
> - `parser_file` / `getContext` / `send_request` の内部動作を読み、なぜ `-o cli` が速く安全なのかを説明できる
> - `BurpSuite-SecretFinder`（Jython拡張）が Passive/Active スキャンでシークレットを検出する仕組みを説明できる
> - LinkFinder と SecretFinder を組み合わせ、`cat *.js | grep` の代替として攻撃対象領域を洗い出す運用を自分で組める
> - 検出結果を「報告物」ではなく「手で確認する候補リスト」として扱うべき理由を説明できる

**元資料**: https://github.com/m4ll0k/SecretFinder （原典取得済み） / https://github.com/GerbenJavado/LinkFinder （原典取得済み）
**関連する節**: 「[25a] LinkFinder — JavaScriptからのエンドポイント抽出」（同じノートの前半。LinkFinder本体の正規表現とオプションを扱う）

---

## 0. 前提：LinkFinder と SecretFinder の関係（最小限のおさらい）

この節は前半（25a）の続きである。まず両ツールの関係だけ1〜2文で確認しておく。

**LinkFinder** とは、JavaScript（以下JS）ファイルの中から「エンドポイントとそのパラメータ」を発見する Python 3 スクリプトのこと。エンドポイントとは、`/api/v1/users` のようにサーバ側の機能を呼び出すURLの経路部分を指す。バグハンターはこれで「隠れたテスト対象領域（new testing ground）」を増やす。

**SecretFinder** とは、その LinkFinder をベースに作り替えた派生ツールで、エンドポイントではなく **APIキー・アクセストークン・秘密鍵などの機密データ**をJSから探すもの。作者は m4ll0k、ライセンスは GPLv3 である。この節では主に SecretFinder 側の中身と、両者を組み合わせた実務運用を扱う。

```
JSファイル / URL / フォルダ / Burp XML
        │
        ├─► LinkFinder  → エンドポイント一覧（攻撃面の地図）
        │
        └─► SecretFinder → 機密データ一覧（APIキー・トークン・鍵）
```

### 0-1. ライセンスは3つが併存している（成果物に組み込む前に要確認）

この2ツールを自分の診断で「使う」だけなら気にしなくてよいが、**コードやルールを自作ツール・社内スクリプト・配布物に組み込む**なら、ライセンスの違いを先に押さえておく必要がある。実は本節が扱うコード群は、**1つのライセンスではなく3つが併存**している。

| 対象 | ライセンス | 要点 |
|---|---|---|
| LinkFinder（本体） | MIT | 制約が緩く、著作権表示さえ残せば組み込みやすい |
| SecretFinder（本体、リポジトリ直下） | GPLv3 | **コピーレフト**。組み込んだ側のソースもGPLで公開する義務が生じうる |
| SecretFinder の Burp拡張ディレクトリ（`BurpSuite-SecretFinder/`） | MIT | 同じリポジトリ内だが本体とは別ライセンス |

ここで注意すべきは、**SecretFinder 本体（`SecretFinder.py`）は GPLv3** である点。GPLv3（GNU General Public License version 3）とは、そのコードを取り込んだ派生物にも同じGPLでのソース公開を求める「コピーレフト（copyleft）」型ライセンスのこと。つまり `_regex` 辞書や `parser_file` を自作の配布ツールにコピーして使うと、こちら側のコードもGPLで公開しなければならなくなる可能性がある。一方、LinkFinder（MIT）と Burp拡張ディレクトリ（MIT）は制約が緩い。**同じ話題の3つのコードでライセンスが違うので、成果物に組み込む前には「どの部分を、どのライセンスで取り込むのか」を必ず確認すること。**（単にツールとして実行して診断する分には、これらの義務は発生しない。）

---

## 1. SecretFinder の使い方（基本形）

SecretFinder の使用例は README の "Usage" 節にまとまっている。以下は原文のコマンドをそのまま並べたものである。まずは形を覚えるより、上から順に「入力」と「出力」の組み合わせを眺めてほしい。

### 1-1. もっとも基本的な使い方（HTML出力）

オンライン上のJSファイルに既定の正規表現を当て、結果を `results.html` に書き出す。

```bash
python3 SecretFinder.py -i https://example.com/1.js -o results.html
```

`-i` が入力、`-o` が出力先である。`-o` にファイル名を渡すと HTML が生成され、完了時にブラウザが自動で開く。

### 1-2. CLI/標準出力（高速）

```bash
python3 SecretFinder.py -i https://example.com/1.js -o cli
```

README は括弧書きで「これは jsbeautifier を使わないので**非常に速い**（doesn't use jsbeautifier, which makes it very fast）」と明記している。jsbeautifier とは、圧縮された（minifyされた）JSを人間が読める形に整形するライブラリのこと。整形をスキップする分だけ速いわけである。パイプ処理やバッチには基本この `-o cli` を使う。

### 1-3. ドメイン全体を解析する（`-e`）

```bash
python3 SecretFinder.py -i https://example.com/ -e
```

`-e/--extract` を付けると、渡したHTMLページの中にある `<script src>` を全部拾って、それぞれのJSを処理する。**HTMLページを渡すときは `-e` が必須**である。付け忘れると、HTML本文そのものに正規表現を当てるだけになってしまう。

### 1-4. 特定のJSを除外／限定する（`-g` / `-n`）

外部ライブラリなど、見なくてよいJSを除外する。

```bash
python3 SecretFinder.py -i https://example.com/ -e -g 'jquery;bootstrap;api.google.com'
```

逆に、特定のJSだけを処理する。

```bash
python3 SecretFinder.py -i https://example.com/ -e -n 'd3i4yxtzktqr9n.cloudfront.net;www.myexternaljs.com'
```

`-g/--ignore`（除外）と `-n/--only`（限定）はどちらも `;`（セミコロン）区切りで、**JSのURLに対する部分一致**で効く。

### 1-5. 自分の正規表現を使う（`-r`）

```bash
python3 SecretFinder.py -i https://example.com/1.js -o cli -r 'apikey=my.api.key[a-zA-Z]+'
```

`-r` の意味は後述するが（3章）、LinkFinder の `-r` とは意味が逆なので注意が必要である。

### 1-6. ヘッダ・プロキシ・Cookie を足す

README の "Other options" の例。

```bash
python3 SecretFinder.py -i https://example.com/ -e -o cli -c 'mysessionid=111234' -H 'x-header:value1\nx-header2:value2' -p 127.0.0.1:8080 -r 'apikey=my.api.key[a-zA-Z]+'
```

`-c` が Cookie、`-H` がヘッダ、`-p` がプロキシである。ただし `-H` は実装に不整合があり、現状はそのままでは動かない（7章で詳述）。

---

## 2. 受け付ける入力の種類

SecretFinder が受け付ける入力は README に列挙されている（逐語）。

| 入力の種類 | 例 | 備考 |
|---|---|---|
| URL（HTMLページ） | `https://www.google.com/` | `-e` が必須 |
| JSのURL | `https://www.google.com/1.js` | そのまま解析 |
| フォルダ（ワイルドカード） | `myjsfiles/*` | ローカルの複数JSを一括 |
| ローカルファイル | `/js/myjs/file.js` | 単一ファイル |

この振り分けを実際に行っているのが `parser_input` 関数である（逐語）。

```python
def parser_input(input):
    ''' Parser Input '''
    # method 1 - url
    schemes = ('http://','https://','ftp://','file://','ftps://')
    if input.startswith(schemes):
        return [input]
    # method 2 - url inpector firefox/chrome
    if input.startswith('view-source:'):
        return [input[12:]]
    # method 3 - Burp file
    if args.burp:
        jsfiles = []
        items = []

        try:
            items = xml.etree.ElementTree.fromstring(open(args.input,'r').read())
        except Exception as err:
            print(err)
            sys.exit()
        for item in items:
            jsfiles.append(
                {
                    'js': base64.b64decode(item.find('response').text).decode('utf-8','replace'),
                    'url': item.find('url').text
                }
            )
        return jsfiles
    # method 4 - folder with a wildcard
    if '*' in input:
        paths = glob.glob(os.path.abspath(input))
        for index, path in enumerate(paths):
            paths[index] = "file://%s" % path
        return (paths if len(paths)> 0 else parser_error('Input with wildcard does not match any files.'))

    # method 5 - local file
    path = "file://%s"% os.path.abspath(input)
    return [path if os.path.exists(input) else parser_error('file could not be found (maybe you forgot to add http/https).')]
```

### 2-1. 読み取れる設計意図

- **なぜこうなっているか**: 入力の形（`http://`で始まる／`view-source:`で始まる／ワイルドカード `*` を含む／ただのパス）を先頭で見分けて、それぞれ適切な取得方法に振り分けている。診断中に手元にあるJSは「URL」「ブラウザで表示中のソース」「ダウンロード済みファイル群」「Burpから書き出したXML」のいずれかであることが多く、その全部を1つの引数で受けられるようにしている。
- **Burpファイル（method 3）**: Burp Suite の Target で選択して書き出したXMLを読む。`<response>` が Base64、`<url>` がURL、という形式は LinkFinder と同一である。ただし SecretFinder 版はパース失敗時に例外内容を `print` して `sys.exit()` する。
- **LinkFinder版との差**: ワイルドカード展開（method 4）で SecretFinder は**ディレクトリを除外しない**（LinkFinder は `os.path.isfile` で絞る）。フォルダを渡すときはJSファイルだけがマッチするパターンにするのが安全である。

---

## 3. 検出ルール `_regex` — 何を探しているのか

SecretFinder の心臓部は `_regex` という辞書（名前→正規表現の対応表）である。ここで**「README に載っているバージョン」と「実際に動くバージョン」に差がある**という、教科書として押さえるべき重要点がある。

### 3-1. README が示すカスタムルールの足し方

README の "add Regex" 節は「`SecretFinder.py` を開いて自分の正規表現を追加せよ」と指示し、次のコードを見せる（逐語・抜粋）。

```python
_regex = {
    'google_api'     : r'AIza[0-9A-Za-z-_]{35}',
    'google_captcha' : r'6L[0-9A-Za-z-_]{38}|^6[0-9a-zA-Z_-]{39}$',
    'google_oauth'   : r'ya29\.[0-9A-Za-z\-_]+',
    'amazon_aws_access_key_id' : r'A[SK]IA[0-9A-Z]{16}',
    # ... 中略 ...
    'json_web_token' : r'ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$',

    'name_for_my_regex' : r'my_regex',
    # for example
    'example_api_key'    : r'^example\w+{10,50}'
}
```

つまりカスタム検出ルールの追加方法は「**`_regex` 辞書に `'名前' : r'正規表現'` の1行を足す**」だけである。名前は出力の見出しになり、`_`（アンダースコア）は空白に置換される（`google_api` → `google api`）。

### 3-2. 実際に動く31エントリ

README のコードにはプレースホルダ（`name_for_my_regex`, `example_api_key`）が混じっているが、**実際に動くのは `SecretFinder.py`（master）の `_regex`** である（逐語・抜粋）。

```python
# regex
_regex = {
    'google_api'     : r'AIza[0-9A-Za-z-_]{35}',
    'firebase'  : r'AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}',
    'google_captcha' : r'6L[0-9A-Za-z-_]{38}|^6[0-9a-zA-Z_-]{39}$',
    'google_oauth'   : r'ya29\.[0-9A-Za-z\-_]+',
    'amazon_aws_access_key_id' : r'A[SK]IA[0-9A-Z]{16}',
    'amazon_mws_auth_toke' : r'amzn\\.mws\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    'amazon_aws_url' : r's3\.amazonaws.com[/]+|[a-zA-Z0-9_-]*\.s3\.amazonaws.com',
    'amazon_aws_url2' : r"(" \
           r"[a-zA-Z0-9-\.\_]+\.s3\.amazonaws\.com" \
           r"|s3://[a-zA-Z0-9-\.\_]+" \
           r"|s3-[a-zA-Z0-9-\.\_\/]+" \
           r"|s3.amazonaws.com/[a-zA-Z0-9-\.\_]+" \
           r"|s3.console.aws.amazon.com/s3/buckets/[a-zA-Z0-9-\.\_]+)",
    'facebook_access_token' : r'EAACEdEose0cBA[0-9A-Za-z]+',
    'authorization_basic' : r'basic [a-zA-Z0-9=:_\+\/-]{5,100}',
    'authorization_bearer' : r'bearer [a-zA-Z0-9_\-\.=:_\+\/]{5,100}',
    'authorization_api' : r'api[key|_key|\s+]+[a-zA-Z0-9_\-]{5,100}',
    'mailgun_api_key' : r'key-[0-9a-zA-Z]{32}',
    'twilio_api_key' : r'SK[0-9a-fA-F]{32}',
    'twilio_account_sid' : r'AC[a-zA-Z0-9_\-]{32}',
    'twilio_app_sid' : r'AP[a-zA-Z0-9_\-]{32}',
    'paypal_braintree_access_token' : r'access_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}',
    'square_oauth_secret' : r'sq0csp-[ 0-9A-Za-z\-_]{43}|sq0[a-z]{3}-[0-9A-Za-z\-_]{22,43}',
    'square_access_token' : r'sqOatp-[0-9A-Za-z\-_]{22}|EAAA[a-zA-Z0-9]{60}',
    'stripe_standard_api' : r'sk_live_[0-9a-zA-Z]{24}',
    'stripe_restricted_api' : r'rk_live_[0-9a-zA-Z]{24}',
    'github_access_token' : r'[a-zA-Z0-9_-]*:[a-zA-Z0-9_\-]+@github\.com*',
    'rsa_private_key' : r'-----BEGIN RSA PRIVATE KEY-----',
    'ssh_dsa_private_key' : r'-----BEGIN DSA PRIVATE KEY-----',
    'ssh_dc_private_key' : r'-----BEGIN EC PRIVATE KEY-----',
    'pgp_private_block' : r'-----BEGIN PGP PRIVATE KEY BLOCK-----',
    'json_web_token' : r'ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$',
    'slack_token' : r"\"api_token\":\"(xox[a-zA-Z]-[a-zA-Z0-9-]+)\"",
    'SSH_privKey' : r"([-]+BEGIN [^\s]+ PRIVATE KEY[-]+[\s]*[^-]*[-]+END [^\s]+ PRIVATE KEY[-]+)",
    'Heroku API KEY' : r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
    'possible_Creds' : r"(?i)(" \
                    r"password\s*[`=:\"]+\s*[^\s]+|" \
                    r"password is\s*[`=:\"]*\s*[^\s]+|" \
                    r"pwd\s*[`=:\"]*\s*[^\s]+|" \
                    r"passwd\s*[`=:\"]+\s*[^\s]+)",
}
```

### 3-3. README版と実装版の差分（必ず押さえる）

| 項目 | README版 | 実装版（master） |
|---|---|---|
| `firebase` | 無い | **ある** `AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}` |
| `amazon_aws_url2` | 無い | **ある**（S3のURL形5パターン） |
| `slack_token` | 無い | **ある** `\"api_token\":\"(xox[a-zA-Z]-[a-zA-Z0-9-]+)\"` |
| `SSH_privKey` | 無い | **ある**（BEGIN〜END を丸ごと捕まえる） |
| `Heroku API KEY` | 無い | **ある**（UUID形） |
| `possible_Creds` | 無い | **ある**（password/pwd/passwd の代入形） |
| `authorization_basic` | `basic\s*[a-zA-Z0-9=:_\+\/-]+` | `basic [a-zA-Z0-9=:_\+\/-]{5,100}`（長さ上限5〜100に変更） |
| `authorization_bearer` | `bearer\s*[a-zA-Z0-9_\-\.=:_\+\/]+` | `bearer [a-zA-Z0-9_\-\.=:_\+\/]{5,100}` |
| `authorization_api` | `api[key\|\s*]+[a-zA-Z0-9_\-]+` | `api[key\|_key\|\s+]+[a-zA-Z0-9_\-]{5,100}` |
| プレースホルダ | 含む | 含まない |

**設計意図**: README は「概念（こう足せる）」を見せる教材用、実装は「その後に追加された実戦ルール」を含む最新版、という関係になっている。ツールの挙動を予測したいなら README ではなく `SecretFinder.py` を直接読むのが正しい。

### 3-4. 31ルールの一覧と「何を狙っているか」

出力の見出しは `_` を空白に置換したものになる。

| # | ルール名 | 正規表現（逐語） | 何を狙っているか |
|---|---|---|---|
| 1 | `google_api` | `AIza[0-9A-Za-z-_]{35}` | Google API キー（`AIza`＋35文字） |
| 2 | `firebase` | `AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}` | Firebase Cloud Messaging サーバキー |
| 3 | `google_captcha` | `6L[0-9A-Za-z-_]{38}\|^6[0-9a-zA-Z_-]{39}$` | reCAPTCHA のサイト/シークレットキー |
| 4 | `google_oauth` | `ya29\.[0-9A-Za-z\-_]+` | Google OAuth アクセストークン |
| 5 | `amazon_aws_access_key_id` | `A[SK]IA[0-9A-Z]{16}` | AWS アクセスキーID（`AKIA`／`ASIA`＋16文字） |
| 6 | `amazon_mws_auth_toke` | `amzn\\.mws\\.[0-9a-f]{8}-...-[0-9a-f]{12}` | Amazon MWS 認証トークン（名前の綴りは原文どおり "toke"） |
| 7 | `amazon_aws_url` | `s3\.amazonaws.com[/]+\|[a-zA-Z0-9_-]*\.s3\.amazonaws.com` | S3 バケットURL |
| 8 | `amazon_aws_url2` | （S3の5表記の選択） | S3の各種URL（仮想ホスト・`s3://`・`s3-`・パス・コンソール） |
| 9 | `facebook_access_token` | `EAACEdEose0cBA[0-9A-Za-z]+` | Facebook アクセストークン |
| 10 | `authorization_basic` | `basic [a-zA-Z0-9=:_\+\/-]{5,100}` | `Authorization: Basic <base64>` のハードコード |
| 11 | `authorization_bearer` | `bearer [a-zA-Z0-9_\-\.=:_\+\/]{5,100}` | `Authorization: Bearer <token>` のハードコード |
| 12 | `authorization_api` | `api[key\|_key\|\s+]+[a-zA-Z0-9_\-]{5,100}` | `apikey=`, `api_key=` 等に続く値 |
| 13 | `mailgun_api_key` | `key-[0-9a-zA-Z]{32}` | Mailgun APIキー |
| 14 | `twilio_api_key` | `SK[0-9a-fA-F]{32}` | Twilio APIキー |
| 15 | `twilio_account_sid` | `AC[a-zA-Z0-9_\-]{32}` | Twilio アカウントSID |
| 16 | `twilio_app_sid` | `AP[a-zA-Z0-9_\-]{32}` | Twilio アプリSID |
| 17 | `paypal_braintree_access_token` | `access_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}` | PayPal/Braintree 本番アクセストークン |
| 18 | `square_oauth_secret` | `sq0csp-[ 0-9A-Za-z\-_]{43}\|...` | Square OAuth シークレット |
| 19 | `square_access_token` | `sqOatp-[0-9A-Za-z\-_]{22}\|EAAA[a-zA-Z0-9]{60}` | Square アクセストークン |
| 20 | `stripe_standard_api` | `sk_live_[0-9a-zA-Z]{24}` | Stripe 本番シークレットキー |
| 21 | `stripe_restricted_api` | `rk_live_[0-9a-zA-Z]{24}` | Stripe 制限キー |
| 22 | `github_access_token` | `[a-zA-Z0-9_-]*:[a-zA-Z0-9_\-]+@github\.com*` | GitHub の URL 埋め込み認証情報 |
| 23 | `rsa_private_key` | `-----BEGIN RSA PRIVATE KEY-----` | RSA秘密鍵のヘッダ |
| 24 | `ssh_dsa_private_key` | `-----BEGIN DSA PRIVATE KEY-----` | DSA秘密鍵 |
| 25 | `ssh_dc_private_key` | `-----BEGIN EC PRIVATE KEY-----` | EC秘密鍵（名前の綴りは原文どおり `ssh_dc_`） |
| 26 | `pgp_private_block` | `-----BEGIN PGP PRIVATE KEY BLOCK-----` | PGP秘密鍵ブロック |
| 27 | `json_web_token` | `ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$` | JWT（`ey` で始まる3パート） |
| 28 | `slack_token` | `\"api_token\":\"(xox[a-zA-Z]-[a-zA-Z0-9-]+)\"` | JSON中の Slack トークン |
| 29 | `SSH_privKey` | `([-]+BEGIN [^\s]+ PRIVATE KEY[-]+...END...[-]+)` | 秘密鍵ブロック全体（種類を問わず） |
| 30 | `Heroku API KEY` | `[0-9a-fA-F]{8}-...-[0-9a-fA-F]{12}` | Heroku APIキー（UUID形） |
| 31 | `possible_Creds` | `(?i)(password\s*[` + "`" + `=:\"]+...)` | 平文パスワードの代入 |
| +1 | `custom_regex` | `-r` の値 | 実行時に辞書へ追加される |

### 3-5. 攻撃者はどこを突くのか — 構造的に誤検出が多いルール

正規表現ベースの検出は「当たりすぎる」方向に壊れやすい。教科書として特に注意すべきルールは次のとおり。

- **`Heroku API KEY`**: 任意のUUID（`8-4-4-4-12` の16進）にマッチする。JSバンドルにはUUIDが山ほど埋まっているため、ほぼ常にノイズを出す。
- **`json_web_token`**: `ey` で始まる base64url 風文字列に広くマッチする。末尾に `$` があるため、複数行の扱いによって結果がぶれる。
- **`authorization_api`** の `api[key|_key|\s+]+`: これは**文字クラス**であり、`a`,`p`,`i` の後に `k`,`e`,`y`,`|`,`_`,空白 のいずれかが1個以上続けばマッチしてしまう。作者が意図した「apikey または api_key」より広く当たる（文字クラス `[...]` と選択 `(?:key|_key)` の混同）。

  〔補足〕正規表現の `[ ]`（文字クラス）とは「この中に書いた文字のいずれか1文字」を表す記法のこと。一方 `( | )`（選択）は「`|` で区切ったパターンのどれか」を表す。両者は見た目が似ているが意味が違う。`api[key|_key|\s+]+` では、`[ ]` の中に書いた `k`・`e`・`y`・`|`・`_`・空白（`\s`）が**すべて「そのいずれか1文字」の意味**になってしまう。そのため `api` の後に `k`/`e`/`y`/`|`/`_`/空白 のどれかが続けば当たり、作者が狙った「`apikey` または `api_key`」だけを拾うつもりが、はるかに広い文字列に反応する。狙いどおりにするには文字クラスではなく選択 `api(?:key|_key)` と書く必要があった、というわけである。
- **`possible_Creds`**: `password:` のようなキー名だけの出現でも後続の非空白文字を拾うので、ライブラリのバリデーションメッセージなどを大量に拾う。
- **`twilio_*`**: 2文字プレフィクス＋32文字なので、ハッシュ値に偶然マッチしうる。

〔補足〕SecretFinder は正規表現を `re.VERBOSE|re.I` でコンパイルする。`re.VERBOSE` では**文字クラスの外にある未エスケープの空白がパターンから無視される**ため、`'basic [a-zA-Z0-9=:_\+\/-]{5,100}'` の `basic` と `[` の間の空白は無効になり、実質 `basic[...]` として動く。逆に `sq0csp-[ 0-9A-Za-z\-_]{43}` のように**文字クラス内の空白は残る**。`re.I` により全ルールが大文字小文字を区別しない。

---

## 4. 検出の内部動作 — `parser_file` と `getContext`

「どこを突くか」を正しく理解するには、実際の照合ループを読むのが早い。

### 4-1. コンテキスト再検索：`getContext`（逐語）

```python
def getContext(matches,content,name,rex='.+?'):
    ''' get context '''
    items = []
    matches2 =  []
    for  i in [x[0] for x in matches]:
        if i not in matches2:
            matches2.append(i)
    for m in matches2:
        context = re.findall('%s%s%s'%(rex,m,rex),content,re.IGNORECASE)

        item = {
            'matched'          : m,
            'name'             : name,
            'context'          : context,
            'multi_context'    : True if len(context) > 1 else False
        }
        items.append(item)
    return items
```

**どう動くか**: マッチした値 `m` の前後を `.+?`（既定の `rex`）で挟んだ正規表現を作り直し、`re.findall` で「その値が出てくる周辺コード」を再検索する。同じ値が複数箇所に出ていれば `context` が複数件になり `multi_context` が True になる。LinkFinder の `getContext` とはまったく違う実装である。

〔補足〕この方式は、マッチ値に正規表現メタ文字（`.`, `+`, `$`, `(`, `[` など）が含まれると再コンパイルが崩れる（`re.escape` していない）。秘密鍵ヘッダやJWTは `.` や `+` を含むため、コンテキストが取れない・意図しない箇所に当たることがある。

### 4-2. 本体ループ：`parser_file`（逐語）

```python
def parser_file(content,mode=1,more_regex=None,no_dup=1):
    ''' parser file '''
    if mode == 1:
        if len(content) > 1000000:
            content = content.replace(";",";\r\n").replace(",",",\r\n")
        else:
            content = jsbeautifier.beautify(content)
    all_items = []
    for regex in _regex.items():
        r = re.compile(regex[1],re.VERBOSE|re.I)
        if mode == 1:
            all_matches = [(m.group(0),m.start(0),m.end(0)) for m in re.finditer(r,content)]
            items = getContext(all_matches,content,regex[0])
            if items != []:
                all_items.append(items)
        else:
            items = [{
                'matched' : m.group(0),
                'context' : [],
                'name'    : regex[0],
                'multi_context' : False
            } for m in re.finditer(r,content)]
```

### 4-3. 読み取るべき要点

- **閾値1,000,000文字は LinkFinder と同じ**。JSが100万文字を超えると jsbeautifier による整形をやめ、`;`→`;\r\n`、`,`→`,\r\n` の軽量整形だけを行う。大きなバンドルほどコンテキストが「セミコロンやカンマで切っただけの断片」になり読みづらくなる。
- **全ルールを1本ずつループで当てる**。LinkFinder が1本の巨大正規表現を作るのに対し、SecretFinder は31本を順に当てる。ルール数×コンテンツ長のコストがかかる。
- **採用するのは `m.group(0)`（マッチ全体）**。LinkFinder が `group(1)` を使うのと違い、`slack_token` のようにキャプチャグループを持つルールでも `"api_token":"xox..."` 全体が `matched` になる。
- **重複排除は `matched` 値単位**（`no_dup`）。
- `mode == 0`（`-o cli`）のときは `getContext` を呼ばず、`context` を空にして高速に列挙する。ここが「cli は速い」の正体である。

〔補足〕`mode == 1` のとき `all_items.append(items)` がif文の内と外で2回実行され、同じ結果が二重に積まれる（後段の重複排除で吸収される）。実装は粗いので、教科書としては「出力を鵜呑みにせず必ず手で確認する」という姿勢を推奨する。

---

## 5. `-e/--extract` — HTMLからJS一覧を作る

`-e` を付けたときにHTMLから `<script src>` を集めているのが `extractjsurl` である（逐語・抜粋）。

```python
def extractjsurl(content,base_url):
    ''' JS url extract from html page '''
    soup = html.fromstring(content)
    all_src = []
    urlParser(base_url)
    for src in soup.xpath('//script'):
        src = src.xpath('@src')[0] if src.xpath('@src') != [] else []
        if src != []:
            if src.startswith(('http://','https://','ftp://','ftps://')):
                if src not in all_src:
                    all_src.append(src)
            elif src.startswith('//'):
                src = 'http://'+src[2:]
                if src not in all_src:
                    all_src.append(src)
            elif src.startswith('/'):
                src = urlParser.this_root + src
                if src not in all_src:
                    all_src.append(src)
            else:
                src = urlParser.this_path + src
                if src not in all_src:
                    all_src.append(src)
    if args.ignore and all_src != []:
        temp = all_src
        ignore = []
        for i in args.ignore.split(';'):
            for src in all_src:
                if i in src:
                    ignore.append(src)
        if ignore:
            for i in ignore:
                temp.pop(int(temp.index(i)))
        return temp
    if args.only:
        temp = all_src
        only = []
        for i in args.only.split(';'):
            for src in all_src:
                if i in src:
                    only.append(src)
        return only
    return all_src
```

### 5-1. 仕様

- **lxml の `html.fromstring` で本物のHTMLパーサを使う**。LinkFinder の `-d` が正規表現任せなのに対し、SecretFinder は XPath `//script` の `@src` を収集する。**`<script>` のインライン本文は対象外**で、`src` 属性を持つものだけを拾う。
- URLの絶対化ルール:

| src の書き方 | 補完のしかた |
|---|---|
| `http://` `https://` `ftp://` `ftps://` 始まり | そのまま |
| `//` 始まり | **`http://` を前置**（httpsではない点に注意） |
| `/` 始まり | `scheme://netloc` を前置 |
| それ以外（相対） | `scheme://netloc/path` を前置 |

- `-g/--ignore` は `;` で分割して**部分一致した src を除去**、`-n/--only` は `;` で分割して**部分一致した src だけを残す**。
- **`-g` と `-n` は同時に使えない**。実装上 `ignore` が先に評価され、`-g` があればその時点で return するので `-n` は効かない。

`main` 側の分岐（逐語）。

```python
    if args.extract:
        content = send_request(args.input)
        urls = extractjsurl(content,args.input)
    else:
        # convert input to URLs or JS files
        urls = parser_input(args.input)
```

処理ループの先頭では必ず `[ + ] URL: <url>` が標準出力に出る（逐語: `print('[ + ] URL: '+url)`）。これは `-o cli` の結果と混ざるので、パイプ処理時にはこの行を除く必要がある（後述）。

---

## 6. HTTP取得 — `send_request` と TLS検証無効

JSを取りに行く関数が `send_request` である（逐語・抜粋）。

```python
def send_request(url):
    ''' Send Request '''
    if 'file://' in url:
        s = requests.Session()
        s.mount('file://',FileAdapter())
        return s.get(url).content.decode('utf-8','replace')
    headers = {}
    default_headers = {
        'User-Agent'      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
        'Accept'          : 'text/html, application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language' : 'en-US,en;q=0.8',
        'Accept-Encoding' : 'gzip'
    }
    if args.headers:
        for i in args.header.split('\\n'):
            name,value = i.replace(' ','').split(':')
            headers[name] = value
    if args.cookie:
        headers['Cookie'] = args.cookie
    headers.update(default_headers)
    proxies = {}
    if args.proxy:
        proxies.update({
            'http'  : args.proxy,
            'https' : args.proxy,
        })
    try:
        resp = requests.get(
            url = url,
            verify = False,
            headers = headers,
            proxies = proxies
        )
        return resp.content.decode('utf-8','replace')
    except Exception as err:
        print(err)
        sys.exit(0)
```

### 6-1. 既定ヘッダ

| ヘッダ | 値 |
|---|---|
| `User-Agent` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36` |
| `Accept` | `text/html, application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8` |
| `Accept-Language` | `en-US,en;q=0.8` |
| `Accept-Encoding` | `gzip` |

### 6-2. 重要な実装事実

- **`verify = False`**。冒頭で `urllib3.disable_warnings(...)` も実行するので、**TLS証明書を検証せず警告も出さない**。自己署名のステージング環境をそのまま叩けるが、通信の安全性はツール側で担保されない。
- `-p/--proxy` は `http` と `https` の両方に同じ値を設定する。**Burp Suite を `127.0.0.1:8080` に挟んで全リクエストを記録する運用**ができる（READMEの例そのまま）。
- `file://` を含むURLは `requests_file` の `FileAdapter` を使って読む。
- `-c/--cookie` の値は `Cookie` ヘッダにそのまま入る。
- **`headers.update(default_headers)` がユーザ指定ヘッダの後に実行される**ため、`-H` で `User-Agent` を上書きしようとしても既定値に戻される。

### 6-3. `-H` は現状あてにしない

`-H` のパース行は `for i in args.header.split('\\n'):` と書かれているが、argparse の属性名は `args.headers` である。〔補足〕Namespace に `header` という属性は作られないので、`-H` を指定すると `AttributeError` になる不整合がある。さらに `i.replace(' ','')` で**ヘッダ値からすべての空白を除去**してから `:` で split するため、空白や `:` を含むヘッダ値は壊れる。**回避策は「`-H` を使わず、`-p 127.0.0.1:8080` で Burp / mitmproxy を挟んでプロキシ側でヘッダを差し替える」ことである。**

> ### 📌 ここは自分で開いて読んでください
> **資料**: dashea/requests-file（SecretFinder が `file://` を読むために使う FileAdapter の実装）— https://github.com/dashea/requests-file
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 本ノートは SecretFinder 本体のみを収録し、依存ライブラリの内部は未収録）。以下の記述は SecretFinder 側の使い方（`requests.Session` に `mount` して `file://` を読む）にもとづく要約である。
> **読みどころ**:
> 1. `FileAdapter` がローカルファイルをどう `requests` の応答に見せているか。ローカルJSの大量処理（ワイルドカード入力）時の挙動を確認するため。
> 2. `file://` のパス解決やエンコーディングの扱い。文字化けや読み込み失敗の原因切り分けに役立つ。
> **代替手段**: PyPI の `requests-file` ページ（同等の説明）

---

## 7. `-r` のカスタム正規表現 — LinkFinder と意味が逆

`-r` の処理（逐語）。

```python
    if args.regex:
        # validate regular exp
        try:
            r = re.search(args.regex,''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(random.randint(10,50))))
        except Exception as e:
            print('your python regex isn\'t valid')
            sys.exit()

        _regex.update({
            'custom_regex' : args.regex
        })
```

- **検証方法が独特**: 長さ10〜50のランダムな英大文字＋数字に対して `re.search` を試し、例外が出たら `your python regex isn't valid` と表示して終了する（コンパイル可能性の確認だけ）。
- 検証を通ると `_regex` に **`custom_regex` という名前で追加**される。
- ヘルプ文は LinkFinder から引き継いだ "RegEx for filtering purposes against found endpoint (e.g: ^/api/)" のままだが、**実際の意味はフィルタではなく「検出ルールの追加」**である。
- **ここが最大の取り違えポイント**: LinkFinder の `-r` は「見つけたエンドポイントを絞り込むフィルタ」、SecretFinder の `-r` は「検出ルールを1本足す」。同じ短縮形で意味が正反対なので、両ツールを続けて使うときに混乱しやすい。
- 追加できるのは1本だけ（同名キーで上書き）。複数入れたいときは `SecretFinder.py` の `_regex` を直接編集する。

---

## 8. 出力 — CLI と HTML

### 8-1. CLI出力（`-o cli`）

```python
def cli_output(matched):
    ''' cli output '''
    for match in matched:
        print(match.get('name')+'\t->\t'+match.get('matched').encode('ascii','ignore').decode('utf-8'))
```

**出力形式は `<ルール名>\t->\t<マッチした値>`**。タブ区切りなので `cut -f1`（ルール名）や `cut -f3`（値）で機械処理しやすい。非ASCII文字は落ちる。

### 8-2. HTML出力とその危険性

HTMLテンプレート `_template` は Python ファイル内に文字列で埋め込まれている（LinkFinder は外部 `template.html`）。実装事実として重要なのは、**プレースホルダが `$content` ではなく `$$content$$`、issue リンク先が SecretFinder、`<title>` は `LinkFinder Output` のまま**という点である（逐語・抜粋）。

```python
_template = '''
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
       h1 {
          font-family: sans-serif;
       }
       a {
          color: #000;
       }
       .text {
          font-size: 16px;
          font-family: Helvetica, sans-serif;
          color: #323232;
          background-color: white;
       }
       .container {
          background-color: #e9e9e9;
          padding: 10px;
          margin: 10px 0;
          font-family: helvetica;
          font-size: 13px;
          border-width: 1px;
          border-style: solid;
          border-color: #8a8a8a;
          color: #323232;
          margin-bottom: 15px;
       }
       .button {
          padding: 17px 60px;
          margin: 10px 10px 10px 0;
          display: inline-block;
          background-color: #f4f4f4;
          border-radius: .25rem;
          text-decoration: none;
          -webkit-transition: .15s ease-in-out;
          transition: .15s ease-in-out;
          color: #333;
          position: relative;
       }
       .button:hover {
          background-color: #eee;
          text-decoration: none;
       }
       .github-icon {
          line-height: 0;
          position: absolute;
          top: 14px;
          left: 24px;
          opacity: 0.7;
       }
  </style>
  <title>LinkFinder Output</title>
</head>
<body contenteditable="true">
  $$content$$

  <a class='button' contenteditable='false' href='https://github.com/m4ll0k/SecretFinder/issues/new' rel='nofollow noopener noreferrer' target='_blank'><span class='github-icon'><svg height="24" viewbox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg></span> Report an issue.</a>
</body>
</html>
'''
```

CSS は LinkFinder の `template.html` とほぼ同一で、検出結果の1件1件を `.container`（薄いグレー背景 `#e9e9e9`＋灰色の枠線 `#8a8a8a`）で囲み、マッチした値の周辺コードを黄色（`background-color:yellow`）のスパンで強調する見た目である。末尾の `Report an issue.` ボタン（`.button`／GitHubアイコンのSVGパス）はSecretFinderのIssue投稿ページへのリンクになっている。

HTMLを書き出す `html_save`（逐語・抜粋）。

```python
def html_save(output):
    ''' html output '''
    hide = os.dup(1)
    os.close(1)
    os.open(os.devnull,os.O_RDWR)
    try:
        text_file = open(args.output,"wb")
        text_file.write(_template.replace('$$content$$',output).encode('utf-8'))
        text_file.close()

        print('URL to access output: file://%s'%os.path.abspath(args.output))
        file = 'file:///%s'%(os.path.abspath(args.output))
        if sys.platform == 'linux' or sys.platform == 'linux2':
            subprocess.call(['xdg-open',file])
        else:
            webbrowser.open(file)
    except Exception as err:
        print('Output can\'t be saved in %s due to exception: %s'%(args.output,err))
    finally:
        os.dup2(hide,1)
```

- 見出しは**ルール名の `_` を空白に置換したもの**（`google_api` → `google api`）。コンテキストは `<span style="background-color:yellow">` で黄色ハイライトされる。
- **完了時にブラウザを自動起動する**（Linux は `xdg-open`）。CI やバッチで回すときは `-o cli` を使うのが安全である。

`$$content$$` に埋め込む本文（`output`）を組み立てているループも読んでおく価値がある（逐語）。

```python
            output += '<h1>File: <a href="%s" target="_blank" rel="nofollow noopener noreferrer">%s</a></h1>'%(escape(url),escape(url))
            for match in matched:
                _matched = match.get('matched')
                _named = match.get('name')
                header = '<div class="text">%s'%(_named.replace('_',' '))
                body = ''
                # find same thing in multiple context
                if match.get('multi_context'):
                    # remove duplicate
                    no_dup = []
                    for context in match.get('context'):
                        if context not in no_dup:
                            body += '</a><div class="container">%s</div></div>'%(context)
                            body = body.replace(
                                context,'<span style="background-color:yellow">%s</span>'%context)
                            no_dup.append(context)
                        # --
                else:
                    body += '</a><div class="container">%s</div></div>'%(match.get('context')[0] if len(match.get('context'))>1 else match.get('context'))
                    body = body.replace(
                        match.get('context')[0] if len(match.get('context')) > 0 else ''.join(match.get('context')),
                        '<span style="background-color:yellow">%s</span>'%(match.get('context') if len(match.get('context'))>1 else match.get('context'))
                    )
                output += header + body
```

〔補足〕この断片組み立ては実装が粗い。`multi_context`（同じ値が複数箇所に出た）のときは重複を除いた各コンテキストを `.container` で並べるが、`else`（1箇所だけ）の分岐は `match.get('context')[0] if len(match.get('context'))>1 else match.get('context')` のように**判定と取り出しがちぐはぐ**で、`len(...)>1` でないと `[0]` を取らず**リストそのもの**を文字列に埋め込む場面が生じる。つまり「コンテキストが1件だけのとき、`['...']` というリスト表記のまま黄色スパンに入りうる」ような壊れ方をしている。4-3で触れた `parser_file` の二重 `append` バグと同様、HTML出力側の断片組み立ても信頼しきれない。この意味でも**出力を鵜呑みにせず手で確認する**姿勢が要る。

〔補足〕LinkFinder は `html.escape` をコンテキストにも適用するが、**SecretFinder はコンテキスト文字列を `escape()` せずにHTMLへ直接埋め込む**（`escape` を通すのはファイルURLのみ）。解析対象JSの中身がそのまま出力HTMLに入り、しかも `<body contenteditable="true">` なので、**生成した `output.html` をブラウザで開く行為自体に自己XSS（self-XSS）のリスクがある**。自己XSSとは、自分が生成・入力したデータによって自分のブラウザ上でスクリプトが実行されてしまう状態のこと。診断用ホストで開く、あるいは `-o cli` を使うのが安全である。

---

## 8b. Burp Suite 拡張（`BurpSuite-SecretFinder/`）

SecretFinder リポジトリには **Burp Suite 用の拡張**が同梱されている。README の要点（逐語）は次のとおり。

> A Burp Suite extension to help pentesters to discover a apikeys,accesstokens and more sensitive data using a regular expressions. SecretFinder process any HTTP response (support javascript file) and support Passive and Active scan.

- **バージョンは beta v0.1**。
- **任意のHTTPレスポンスを処理する**（JSファイルにも対応）。**Passive scan と Active scan の両方をサポート**。
- **Requirements: `jython` と `burpsuite`**。Jython とは Java 上で動く Python 実装のこと。Burp の Extender で Python 環境として Jython の standalone JAR を指定する必要がある。

### 8b-1. どう組み立てているか

Burp API のうち `IBurpExtender` / `IScannerCheck` / `IScanIssue` を使い、`BurpExtender` が両方を実装する（逐語）。

```python
class BurpExtender(IBurpExtender, IScannerCheck):
    def	registerExtenderCallbacks(self, callbacks):
        self._callbacks = callbacks
        self._callbacks.setExtensionName("SecretFinder")
        self._callbacks.registerScannerCheck(self)
        return

    def consolidateDuplicateIssues(self, existingIssue, newIssue):
        if (existingIssue.getIssueDetail() == newIssue.getIssueDetail()):
            return -1
        else:
            return 0
```

拡張名は `SecretFinder`。`registerScannerCheck(self)` でスキャナチェックとして登録し、`consolidateDuplicateIssues` は Issue Detail が同一なら `-1`（既存を保持）を返して重複を抑える。

### 8b-2. Burp版の正規表現は CLI版と別物（37エントリ）

Burp版の辞書 `regexs` は CLI版（31件）とは中身が違い、37エントリある。まず全文を逐語で示す。

```python
    # add your regex here
    regexs = {
        'google_api' : 'AIza[0-9A-Za-z-_]{35}',
        'docs_file_exetension' : '^.*\.(xls|xlsx|doc|docx)$',
        'bitcoin_address' : '([13][a-km-zA-HJ-NP-Z0-9]{26,33})',
        'slack_api_key' : 'xox.-[0-9]{12}-[0-9]{12}-[0-9a-zA-Z]{24}',
        'us_cn_zipcode' : '/(^\d{5}(-\d{4})?$)|(^[ABCEGHJKLMNPRSTVXY]{1}\d{1}[A-Z]{1} *\d{1}[A-Z]{1}\d{1}$)/',
        'google_cloud_platform_auth' : '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
        'google_cloud_platform_api' : '[A-Za-z0-9_]{21}--[A-Za-z0-9_]{8}',
        'amazon_secret_key' : '[0-9a-zA-Z/+]{40}',
        'gmail_auth_token' : '[0-9(+-[0-9A-Za-z_]{32}.apps.qooqleusercontent.com',
        'github_auth_token' : '[0-9a-fA-F]{40}',
        'Instagram_token' : '[0-9a-fA-F]{7}.[0-9a-fA-F]{32}',
        'twitter_access_token' : '[1-9][ 0-9]+-(0-9a-zA-Z]{40}',
        'firebase' : 'AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}',
        'google_captcha' : '6L[0-9A-Za-z-_]{38}|^6[0-9a-zA-Z_-]{39}$',
        'google_oauth' : 'ya29\.[0-9A-Za-z\-_]+',
        'amazon_aws_access_key_id' : 'A[SK]IA[0-9A-Z]{16}',
        'amazon_mws_auth_toke' : 'amzn\\.mws\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
        'amazon_aws_url' : 's3\.amazonaws.com[/]+|[a-zA-Z0-9_-]*\.s3\.amazonaws.com',
        'facebook_access_token' : 'EAACEdEose0cBA[0-9A-Za-z]+',
        'authorization_basic' : 'basic\s*[a-zA-Z0-9=:_\+\/-]+',
        'authorization_bearer' : 'bearer\s*[a-zA-Z0-9_\-\.=:_\+\/]+',
        'authorization_api' : 'api[key|\s*]+[a-zA-Z0-9_\-]+',
        'mailgun_api_key' : 'key-[0-9a-zA-Z]{32}',
        'twilio_api_key' : 'SK[0-9a-fA-F]{32}',
        'twilio_account_sid' : 'AC[a-zA-Z0-9_\-]{32}',
        'twilio_app_sid' : 'AP[a-zA-Z0-9_\-]{32}',
        'paypal_braintree_access_token' : 'access_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}',
        'square_oauth_secret' : 'sq0csp-[ 0-9A-Za-z\-_]{43}|sq0[a-z]{3}-[0-9A-Za-z\-_]{22,43}',
        'square_access_token' : 'sqOatp-[0-9A-Za-z\-_]{22}|EAAA[a-zA-Z0-9]{60}',
        'stripe_standard_api' : 'sk_live_[0-9a-zA-Z]{24}',
        'stripe_restricted_api' : 'rk_live_[0-9a-zA-Z]{24}',
        'github_access_token' : '[a-zA-Z0-9_-]*:[a-zA-Z0-9_\-]+@github\.com*',
        'rsa_private_key' : '-----BEGIN RSA PRIVATE KEY-----',
        'ssh_dsa_private_key' : '-----BEGIN DSA PRIVATE KEY-----',
        'ssh_dc_private_key' : '-----BEGIN EC PRIVATE KEY-----',
        'pgp_private_block' : '-----BEGIN PGP PRIVATE KEY BLOCK-----',
        'json_web_token' : 'ey[A-Za-z0-9_-]*\.[A-Za-z0-9._-]*|ey[A-Za-z0-9_\/+-]*\.[A-Za-z0-9._\/+-]*'
    }
```

CLI版との差分は次のとおり。

- **Burp版のみ**（各ルールの正規表現と狙い）:

| ルール名 | 正規表現（逐語） | 狙い |
|---|---|---|
| `docs_file_exetension`（綴り原文どおり） | `^.*\.(xls\|xlsx\|doc\|docx)$` | Office文書のファイル名／パス |
| `bitcoin_address` | `([13][a-km-zA-HJ-NP-Z0-9]{26,33})` | ビットコインアドレス（`1`/`3` 始まり） |
| `slack_api_key` | `xox.-[0-9]{12}-[0-9]{12}-[0-9a-zA-Z]{24}` | Slack APIキー（`xox?-` ＋数字ブロック） |
| `us_cn_zipcode` | `/(^\d{5}(-\d{4})?$)\|(^[ABCEGHJKLMNPRSTVXY]{1}\d{1}[A-Z]{1} *\d{1}[A-Z]{1}\d{1}$)/` | 米国ZIP／カナダ郵便番号 |
| `google_cloud_platform_auth` | `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` | GCP 認証識別子（16進のブロック） |
| `google_cloud_platform_api` | `[A-Za-z0-9_]{21}--[A-Za-z0-9_]{8}` | GCP APIキー（21文字＋`--`＋8文字） |
| `amazon_secret_key` | `[0-9a-zA-Z/+]{40}` | AWSシークレットキー（**40文字のbase64風文字列すべてに当たる超広域ルール**） |
| `gmail_auth_token` | `[0-9(+-[0-9A-Za-z_]{32}.apps.qooqleusercontent.com` | Gmail/Google OAuth クライアント（※後述のとおり壊れている） |
| `github_auth_token` | `[0-9a-fA-F]{40}` | GitHub トークン（**任意のSHA-1ハッシュ全部に当たる**） |
| `Instagram_token` | `[0-9a-fA-F]{7}.[0-9a-fA-F]{32}` | Instagram トークン（16進7文字＋任意1文字＋16進32文字） |
| `twitter_access_token` | `[1-9][ 0-9]+-(0-9a-zA-Z]{40}` | Twitter アクセストークン（※後述のとおり壊れている） |
- **CLI版のみ**: `amazon_aws_url2`, `slack_token`（JSON形）, `SSH_privKey`, `Heroku API KEY`, `possible_Creds`
- `authorization_basic`/`bearer`/`api` は Burp版が**長さ上限なしの README 版と同じ書き方**
- `json_web_token` は Burp版が別定義（末尾 `$` なし）

〔補足〕Burp版の `gmail_auth_token` は `[0-9(+-[0-9A-Za-z_]{32}.apps.qooqleusercontent.com` と、**角括弧が閉じておらず**ドメインも "qooqleusercontent"（`googleusercontent` のtypo）になっている。`twitter_access_token` の `[1-9][ 0-9]+-(0-9a-zA-Z]{40}` も括弧の対応が壊れている。**そのままでは意図どおり動かない（コンパイルエラーや意図外のマッチ）ため、使う前に読んで直す前提**で扱うべきである。

### 8b-3. 「値らしい文脈」だけを拾うラッパ

Burp版は各ルールをそのまま当てるのではなく、前後がデリミタであることを要求するラッパ正規表現に差し込む（逐語）。

```python
    regex = r"[:|=|\'|\"|\s*|`|´| |,|?=|\]|\|//|/\*}](%%regex%%)[:|=|\'|\"|\s*|`|´| |,|?=|\]|\}|&|//|\*/]"
    issuename = "SecretFinder: %s"
    issuelevel = "Information"
    issuedetail = r"""Potential Secret Find: <b>%%regex%%</b>
    <br><br><b>Note:</b> Please note that some of these issues could be false positives, a manual review is recommended."""
```

- 各ルールは `%%regex%%` の位置に差し込まれ、**前後が `:` `=` `'` `"` 空白 `` ` `` `,` `]` `}` `&` `//` `/*` `*/` などのデリミタ**であることを要求する。これが「JSONやJSの値として書かれている箇所だけを拾う」ための工夫である。
- **Issue名は `SecretFinder: <名前>`**。名前は `google_api` → `Google Api` のように整形される。
- **Severity は `Information` 固定、Confidence は `Tentative` 固定**（`getConfidence` が `return "Tentative"`）。
- Issue詳細には毎回「一部は誤検出の可能性があり手動レビューを推奨する」という注意書きが付く。

〔運用上の落とし穴〕Severity が `Information` 固定ということは、**Burpの Issue 一覧を重要度（High → Low → Information）で並べると、SecretFinderの検出結果は常に最下段に押し込まれて埋もれる**。他の重要度の高いIssueに紛れて見落としやすい。そのため実務では、重要度順で眺めるのではなく、**Extender → Output タブの逐次出力を追うか、Issue 一覧を Issue 名 `SecretFinder:` でフィルタして絞り込む運用**が必要になる。「重要な発見だから上に出る」わけではない、という前提で見に行く癖をつけるとよい。

### 8b-4. Passive でも全ルールが走る

`doActiveScan` と `doPassiveScan` は**同一のロジック**（`doActiveScan` に引数 `pa` があるだけ）である（逐語・抜粋）。

```python
    def doActiveScan(self, baseRequestResponse,pa):
        scan_issues = []
        tmp_issues = []
        self._CustomScans = CustomScans(baseRequestResponse, self._callbacks)
        for reg in self.regexs.items():
            tmp_issues = self._CustomScans.findRegEx(
                BurpExtender.regex.replace(r'%%regex%%',reg[1]),
                BurpExtender.issuename%(' '.join([x.title() for x in reg[0].split('_')])),
                BurpExtender.issuelevel,
                BurpExtender.issuedetail
                )
            scan_issues = scan_issues + tmp_issues
        if len(scan_issues) > 0:
            return scan_issues
        else:
            return None
```

つまり**プロキシを通しただけの Passive スキャンでも全ルールが走る**。ブラウジングしているだけでレスポンスからシークレット候補が拾われる、ということである。

検出本体 `CustomScans.findRegEx` の要点（逐語・抜粋）。

```python
    def findRegEx(self, regex, issuename, issuelevel, issuedetail):
        ...
        if self._callbacks.isInScope(self._helpers.analyzeRequest(self._requestResponse).getUrl()):
            myre = re.compile(regex, re.VERBOSE)
            encoded_resp=binascii.b2a_base64(self._helpers.bytesToString(response))
            decoded_resp=base64.b64decode(encoded_resp)
            decoded_resp = saxutils.unescape(decoded_resp)
            match_vals = myre.findall(decoded_resp)
            for ref in match_vals:
                ...
                scan_issues.append(ScanIssue(...))
        return (scan_issues)
```

- **`findRegEx` の冒頭で `print(self._mime_type)` を呼び、さらに `if '.js' in str(self._requestResponse.getUrl()):` が真のとき、もう一度 MIME タイプとそのURLを `print` する**。つまり `.js` を含むURLを処理するたびに MIME タイプとURLが Output タブに出る仕組みになっている。
- **`isInScope()` により Burp のターゲットスコープ内のURLだけを検査する**。運用上、まずスコープ設定を正しく入れることが前提になる。
- レスポンスは Base64 の往復を経て `xml.sax.saxutils.unescape` でXML実体参照を戻してから照合する（`&amp;quot;` 等でエスケープされたJSON中のトークンも拾う狙い）。
- `re.compile(regex, re.VERBOSE)` — **CLI版と違い `re.I` は付かないので、Burp版は大文字小文字を区別する**。
- `applyMarkers(...)` により、Issue画面でレスポンス中の該当箇所がハイライトされる。
- `print(...)` が複数あり、**Extender → Output タブに MIME タイプや `.js` のURL、`<ルール名> : <マッチ値>` が逐次出る**。

`ScanIssue` は `IScanIssue` の実装で、`getIssueType()` は `0`、`getConfidence()` は `"Tentative"` を返す。さらに `getRemediationDetail()`（修正方法の詳細）、`getIssueBackground()`（脆弱性の背景説明）、`getRemediationBackground()`（修正の背景説明）は**いずれも `None` を返す**。つまりIssueには「対策の手引き」や「背景解説」が一切付かず、`getIssueDetail()` の "Potential Secret Find: ..." と手動レビュー推奨の注意書きだけが表示される。

> ### 📌 ここは自分で開いて読んでください
> **資料**: BurpSuite-SecretFinder（README の3枚の画像。追記箇所 `LBtfhkt.png`、検出例 `unM06Hg.png`、インストール手順GIF `nIPR037.gif`）— https://github.com/m4ll0k/SecretFinder/tree/master/BurpSuite-SecretFinder
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: スライド画像・GIF動画のため）。以下の記述は README のテキストと拡張本体のソース逐語にもとづく要約である。
> **読みどころ**:
> 1. インストール手順GIF（`nIPR037.gif`）— Extender タブでの Jython standalone JAR の指定〜拡張読み込みの流れを視覚的に確認するため。初回セットアップで最も詰まりやすい箇所。
> 2. 検出例のIssue画面（`unM06Hg.png`）— `SecretFinder: <名前>` の Issue がどう表示され、レスポンスのどこがハイライトされるかを確認するため。
> **代替手段**: なし（画像・GIFは本文に収録できない）

---

## 8c. Docker での一括処理

SecretFinder の Dockerfile 全文（逐語）。

```dockerfile
# usage:
# while read url; do docker run -t wfnintr/secretfinder -i $url -o cli | tee -a js_results.txt;done < urls.txt
from python:alpine
LABEL source="SecretFinder <github.com/m4ll0k/SecretFinder>"
LABEL maintainer="wfnintr@null.net"
RUN apk update && \
        apk add --virtual build-deps \
        build-base gcc python3-dev && \
        apk add libxml2-dev libxslt-dev && \
        wget https://raw.githubusercontent.com/m4ll0k/SecretFinder/master/requirements.txt -qO - | pip3 install -r /dev/stdin && \
        wget https://raw.githubusercontent.com/m4ll0k/SecretFinder/master/SecretFinder.py -qO /usr/local/bin/SecretFinder.py && \
        chmod +x /usr/local/bin/SecretFinder.py && \
        apk del build-deps
ENTRYPOINT [ "SecretFinder.py" ]
```

- **公開イメージ名は `wfnintr/secretfinder`**、メンテナは `wfnintr@null.net`。
- 冒頭コメントが**公式のバッチ実行レシピ**である（逐語）。

```bash
while read url; do docker run -t wfnintr/secretfinder -i $url -o cli | tee -a js_results.txt;done < urls.txt
```

`urls.txt` に1行1URLでJSのURLを並べておき、それを順に SecretFinder に流して結果を `js_results.txt` に追記していく。lxml のビルドに `libxml2-dev`, `libxslt-dev` などが必要で、ビルド後に `apk del build-deps` で削っている。

---

## 9. 実務：`cat *.js | grep` の代替として

### 9-1. なぜ grep では足りないのか

- **LinkFinder 側**: 素朴な `grep -oE "https?://[^\"']+"` はフルURLしか拾えない。LinkFinder は「絶対パス `/api/...`」「ドット相対 `../api/...`」「拡張子なしREST `api/v1/user/2`」「スラッシュなしファイル名 `main.js`」の4カテゴリを網羅し、さらに jsbeautifier で整形してから当てるので、minified な1行コードでも文脈付きで結果が読める。1行10万文字のバンドルで文脈が取れない、という grep 最大の弱点を解消する。
- **SecretFinder 側**: 31本の名前付きルールを一度に当て、結果を「ルール名 → 値」で出す。`grep -i apikey` では `AIza...` も `sk_live_...` も `-----BEGIN RSA PRIVATE KEY-----` も拾えない。

### 9-2. 基本の型（原文のコマンドをそのまま）

| # | 目的 | コマンド |
|---|---|---|
| 1 | 単一JSのエンドポイント抽出（HTML） | `python linkfinder.py -i https://example.com/1.js -o results.html` |
| 2 | 単一JS（パイプ用・高速） | `python linkfinder.py -i https://example.com/1.js -o cli` |
| 3 | ページ全体を辿る | `python linkfinder.py -i https://example.com -d` |
| 4 | ローカルJS群を `/api/` に絞る | `python linkfinder.py -i 'Desktop/*.js' -r ^/api/ -o results.html` |
| 5 | Burp XML をまとめて処理 | `python linkfinder.py -i burpfile -b` |
| 6 | 同じJSからシークレット | `python3 SecretFinder.py -i https://example.com/1.js -o cli` |
| 7 | ページ内全JS＋外部ライブラリ除外 | `python3 SecretFinder.py -i https://example.com/ -e -g 'jquery;bootstrap;api.google.com'` |
| 8 | 自社CDNのJSだけ | `python3 SecretFinder.py -i https://example.com/ -e -n 'd3i4yxtzktqr9n.cloudfront.net;www.myexternaljs.com'` |
| 9 | Burp経由で記録しながら | `python3 SecretFinder.py -i https://example.com/ -e -o cli -c 'mysessionid=111234' -H 'x-header:value1\nx-header2:value2' -p 127.0.0.1:8080 -r 'apikey=my.api.key[a-zA-Z]+'` |
| 10 | Docker で一括 | `while read url; do docker run -t wfnintr/secretfinder -i $url -o cli | tee -a js_results.txt;done < urls.txt` |

### 9-3. 認証が必要なJSの扱い

- LinkFinder: `-c/--cookies`（`Cookie` ヘッダに直入れ）。
- SecretFinder: `-c/--cookie`（単数形）。`-H` は前述の不整合があるので、ヘッダを足したいときは `-p 127.0.0.1:8080` で Burp / mitmproxy を挟んでプロキシ側で書き換えるのが確実。
- LinkFinder の Chrome 拡張は**ブラウザが実際に読み込んだJSを Cookie 付きで転送する**ので、ログイン後だけ配信されるJS（管理画面のチャンク等）を取りこぼしにくい。

### 9-4. 二段構え（LinkFinder → SecretFinder）

〔補足〕両ツールは入力（JSファイル／URL／ワイルドカード／Burp XML）が同じなので、同じJS集合に対して「エンドポイント抽出」と「シークレット検出」を並行して回すのが定石である。LinkFinder の `-o cli` の出力（1行1エンドポイント）はそのままファジング用URLリストに、SecretFinder の `-o cli` の出力（`name\t->\tvalue`）は `cut -f3` で値だけ取り出してトリアージリストにできる。ただし LinkFinder の CLI 出力は HTMLエスケープ済み（`&` → `&amp;`）である点に注意する。

### 9-5. 誤検出との付き合い方（どう守るか）

Burp拡張のIssue本文は毎回こう述べる（逐語）: "Please note that some of these issues could be false positives, a manual review is recommended."（これらのIssueの一部は誤検出の可能性があり、手動レビューを推奨する）。Confidence も `Tentative`、Severity も `Information` 固定である。**SecretFinder の出力は「報告物」ではなく「手で確認すべき候補リスト」**として扱うのが原著者の想定である。とくに `Heroku API KEY`（任意のUUID）、`github_auth_token`（任意のSHA-1、Burp版）、`amazon_secret_key`（任意の40文字、Burp版）は構造的にノイズが多い。

〔補足〕検出したキーが本当に有効かどうかは、**そのキーの正当な発行元サービスに対し、許可された範囲内で最小限の検証（例: 読み取り専用APIの呼び出し）**を行って確認する。バグバウンティでは対象プログラムのスコープと規約に従い、他者データへのアクセスや破壊的操作は行わない。公開JSに含まれるキーは「そもそも公開前提の識別子（例: reCAPTCHAサイトキー、Firebase の `apiKey`）」であることも多いため、**影響（何ができるか）を示せない限り報告価値は低い**という判断軸を持つべきである。

---

## 10. 読者が自分で開くべき資料

両URL（LinkFinder / SecretFinder）は完全に取得できたため「取得できなかった資料」は無いが、以下は本ノートに収録しきれない、または画像・動画であるため、読者自身がブラウザで開く価値が高い。

> ### 📌 ここは自分で開いて読んでください
> **資料**: LinkFinder の README スクリーンショット（`https://i.imgur.com/JfcpYok.png`、"LinkFinder in action"）— https://github.com/GerbenJavado/LinkFinder
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 画像のため本文に埋め込めない）。以下の記述はHTMLテンプレートの逐語収録にもとづく要約である。
> **読みどころ**:
> 1. HTML出力の実際の見た目（黄色ハイライトされたコンテキスト、`contenteditable` なページ）。本ノートは HTML/CSS を逐語収録しているが、見た目そのものは画像でしか分からない。
> 2. どのくらいの量のエンドポイントが1画面に並ぶか。トリアージの体感をつかむため。
> **代替手段**: 自分で `-o results.html` を実行して生成物を（診断用ホストで）開く

> ### 📌 ここは自分で開いて読んでください
> **資料**: LinkFinder Chrome拡張（`chrome_extension` ブランチの `popup.js` / `background.js`）— https://github.com/GerbenJavado/LinkFinder/tree/chrome_extension
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 本ノートは README と `http-server.py` のみ収録し、拡張本体の実装は未収録）。以下は README にもとづく要約である。
> **読みどころ**:
> 1. 拡張側のスコープ判定・通知・グラフ描画の実装。ブラウジング連動型の運用を自作する際の参考になる。
> 2. ブラウザが読み込んだJSをどう収集・転送するか。ログイン後のJSを取りこぼさない仕組みの理解のため。
> **代替手段**: なし

> ### 📌 ここは自分で開いて読んでください
> **資料**: LinkFinder の Issues / Pull Request（正規表現の改善・誤検出報告が集まる場所）— https://github.com/GerbenJavado/LinkFinder/issues
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 動的なHTMLページで、内容が時々刻々変わる）。最終コミットが2024-04-13の Merge PR #133 であることは取得済みである。
> **読みどころ**:
> 1. 正規表現の細かな調整はPR履歴を追うのが早い。どのパターンが誤検出を生んだかの実例が集まる。
> 2. 自分が遭遇した取りこぼし・誤検出が既知かどうかの確認。
> **代替手段**: なし

> ### 📌 ここは自分で開いて読んでください
> **資料**: beautify-web/js-beautify（両ツールの前処理の心臓部）— https://github.com/beautify-web/js-beautify
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 本ノートは SecretFinder / LinkFinder 本体のみ収録）。以下は両ツールが「1MB超で整形をスキップする」という実装事実にもとづく要約である。
> **読みどころ**:
> 1. インデントや行分割のオプション。閾値100万文字を超えて整形がスキップされたときに、なぜコンテキストが読みづらくなるかを理解するため。
> 2. 整形の限界（難読化されたコードは整形しても読めない）。
> **代替手段**: PyPI の `jsbeautifier` ページ

---

## 手を動かす

以下は自分で立てた検証環境、または許可されたバグバウンティ対象に対してのみ実行すること。

1. まず両ツールを用意する。

```bash
git clone https://github.com/GerbenJavado/LinkFinder.git
git clone https://github.com/m4ll0k/SecretFinder.git
cd SecretFinder && pip3 install -r requirements.txt && cd ..
```

2. 検証用に、自分で用意したJSファイル（わざとダミーのキーを埋めたもの）を1枚作る。実在サービスの本物のキーは書かない。

```bash
cat > test.js <<'EOF'
var cfg = {
  gmap: "AIza_REDACTED_EXAMPLE",
  stripe: "sk_live_REDACTED_EXAMPLE_KEY_EXAMPLE_KEY_EXAMPLE_KEY_EXAMPLE_KEY",
  token: "eyJ.REDACTED_EXAMPLE_JWT"
};
EOF
```

3. SecretFinder を CLI 出力で当てる。ルール名と値がタブ区切りで出る。

```bash
python3 SecretFinder.py -i test.js -o cli
```

4. 値だけを取り出してトリアージリストにする。

```bash
python3 SecretFinder.py -i test.js -o cli | cut -f3 | sort -u
```

5. 同じJSに LinkFinder を当て、エンドポイント側も見る。

```bash
python linkfinder.py -i test.js -o cli
```

6. HTMLページ全体を対象にするときは `-e` を付ける（自分の検証サイトで）。`-g` で外部ライブラリを外す。

```bash
python3 SecretFinder.py -i http://localhost:8080/ -e -g 'jquery;bootstrap' -o cli
```

7. Burp を挟んで全リクエストを記録したいときは `-p` を使う（`-H` は使わない）。

```bash
python3 SecretFinder.py -i http://localhost:8080/ -e -o cli -p 127.0.0.1:8080
```

8. Burp拡張を試す場合は、Extender → Options で Jython の standalone JAR を指定し、Extensions で `BurpSuite-SecretFinder/SecretFinder.py` を Python 拡張として読み込む。ターゲットスコープを正しく設定してから対象をブラウジングし、Extender の Output タブと Issue 名 `SecretFinder:` を見る。

---

## つまずきポイント

- **`-r` の意味が LinkFinder と SecretFinder で逆**。LinkFinder は「絞り込みフィルタ」、SecretFinder は「検出ルールの追加」。ヘルプ文が LinkFinder のまま残っているので誤解しやすい。
- **HTMLページを渡すのに `-e` を付け忘れる**と、HTML本文そのものに正規表現を当てるだけになり、`<script src>` のJSは処理されない。
- **`-g` と `-n` は併用できない**。`-g` があるとそこで return するので `-n` は無視される。
- **`-H` はそのままでは動かない**（`args.header` 参照のAttributeError、値の空白除去・`:` split の破綻）。ヘッダ操作は `-p` でプロキシを挟むのが確実。
- **`-p` で `User-Agent` を上書きできない**。`headers.update(default_headers)` がユーザ指定の後に走るため既定値に戻る。
- **HTML出力はコンテキストをエスケープしない**。生成物を開くと自己XSSの恐れ。診断用ホストで開くか `-o cli` を使う。
- **完了時にブラウザが自動起動する**（Linux は `xdg-open`）。CI/バッチでは `-o cli` を使う。
- **`verify=False`**。TLS検証をしないので、MITM検出には使えず、改竄されたJSを解析する可能性もある。
- **誤検出の多いルールを鵜呑みにしない**。`Heroku API KEY`（任意のUUID）、Burp版の `github_auth_token`（任意のSHA-1）・`amazon_secret_key`（任意の40文字）は特にノイズが多い。
- **Burp版の正規表現には壊れたものがある**（`gmail_auth_token`, `twitter_access_token`）。使う前に読んで直す前提。
- **Burp拡張のIssueは Severity=`Information` 固定**なので、重要度順に並べると常に最下段に埋もれる。Output タブか Issue 名 `SecretFinder:` でフィルタして見に行く運用が必要。
- **1MB超のJSは整形されない**ため、コンテキストが `;`・`,` で切った断片になり読みづらい。
- **ライセンスは3つ併存**（LinkFinder=MIT、SecretFinder本体=GPLv3、Burp拡張ディレクトリ=MIT）。ツールとして実行する分にはよいが、コードやルールを自作の配布物に組み込むなら、特に GPLv3 の本体を取り込むと自分側もGPL公開義務が生じうるので**組み込む前に要確認**。

---

## この節のまとめ

- SecretFinder は LinkFinder の派生で、エンドポイントではなく APIキー・トークン・秘密鍵などの機密データをJSから探す（作者 m4ll0k、GPLv3）。
- 入力はURL・JSのURL・フォルダ（ワイルドカード）・Burp XML の4種で、HTMLページを渡すときは `-e` が必須。
- 出力は `-o results.html`（HTML、ブラウザ自動起動）と `-o cli`（タブ区切り、jsbeautifier を使わず高速）。パイプ・バッチには `-o cli` を使う。
- 検出ルール `_regex` は README版と実装版で差があり、**実際に動くのは実装版の31エントリ**。README ではなく `SecretFinder.py` を読むべき。
- 31ルールのうち `Heroku API KEY`・`json_web_token`・`authorization_api`・`possible_Creds`・`twilio_*` は構造的に誤検出が多い。
- 内部では全ルールを1本ずつループで当て、`m.group(0)`（マッチ全体）を採用し、`matched` 値単位で重複排除する。`-o cli`（mode 0）はコンテキスト再検索を省くので速い。
- `send_request` は `verify=False` でTLS検証をしない。`-p` で Burp / mitmproxy を挟める。`-H` は実装不整合で動かない。
- `-r` は「検出ルールを1本追加」する（`custom_regex` として登録）。LinkFinder の `-r`（絞り込み）とは意味が逆。
- HTML出力はコンテキストをエスケープしないため、生成物を開くと自己XSSのリスクがある。
- 同梱の Burp拡張（beta v0.1、Jython必須）は Passive/Active 両方で任意のHTTPレスポンスに37ルールを当て、`SecretFinder: <名前>`（Information / Tentative 固定）の Issue を起票する。Passive だけでも全ルールが走る。
- Burp版の正規表現は CLI版と別物で、一部は括弧・綴りが壊れているので直して使う。
- 公式Dockerイメージは `wfnintr/secretfinder`、Dockerfile冒頭に URL リストを流すバッチレシピがある。
- LinkFinder（エンドポイント）と SecretFinder（シークレット）は入力が同じなので二段構えで回すのが定石。`grep -i apikey` より網羅的。
- SecretFinder の出力は「報告物」ではなく「手で確認する候補リスト」。有効性は正当な発行元に許可された範囲で最小限に検証し、影響を示せて初めて報告価値が出る。

---

## 理解度チェック

1. SecretFinder に `https://example.com/` を渡すとき、必ず付けなければならないオプションは何か。付けないとどうなるか。
   ▶ 答え: `-e/--extract` を付ける。付けないと、HTMLページ内の `<script src>` を辿らず、そのHTML本文自体に正規表現を当てるだけになる。

2. `SecretFinder.py` の `_regex` が README のコードと違う点を、少なくとも2つ挙げよ。
   ▶ 答え: 実装版には README に無い `firebase`, `amazon_aws_url2`, `slack_token`, `SSH_privKey`, `Heroku API KEY`, `possible_Creds` がある。また `authorization_basic`/`bearer`/`api` に長さ上限（`{5,100}` など）が付いた。README にあるプレースホルダ `name_for_my_regex`, `example_api_key` は実装版には無い。

3. `-o cli` が `-o results.html` より速い理由を、内部動作から説明せよ。
   ▶ 答え: `-o cli`（mode 0）は jsbeautifier による整形を行わず、`getContext` によるコンテキストの再検索も行わずにマッチだけを列挙するため。

4. LinkFinder の `-r` と SecretFinder の `-r` はどう違うか。
   ▶ 答え: LinkFinder の `-r` は見つけたエンドポイントを絞り込むフィルタ。SecretFinder の `-r` は検出ルールを1本 `custom_regex` として `_regex` に追加する。意味が逆。

5. `Heroku API KEY` ルールが「構造的に誤検出が多い」のはなぜか。
   ▶ 答え: 正規表現が `8-4-4-4-12` の16進、すなわち任意のUUIDにマッチする。JSバンドルにはUUIDが多数含まれるため、ほぼ常にノイズを出す。

6. SecretFinder が生成した `output.html` をむやみにブラウザで開くべきでないのはなぜか。
   ▶ 答え: SecretFinder はコンテキスト文字列をHTMLエスケープせずに埋め込み、しかも `<body contenteditable="true">` なので、解析対象JSの中身によって自己XSSが起きる恐れがあるため。診断用ホストで開くか `-o cli` を使う。

7. Burp拡張版が「Passive スキャンだけでも検出が動く」と言えるのはなぜか。
   ▶ 答え: `doPassiveScan` と `doActiveScan` が同一ロジックで、どちらも全ルールを当てるため。プロキシを通しただけのレスポンスでも（スコープ内なら）検出が走る。

8. Burp拡張の Issue は Severity と Confidence が固定されている。それぞれ何か。運用上どう扱うべきか。
   ▶ 答え: Severity は `Information`、Confidence は `Tentative` 固定。重要度で並べると埋もれるので、Output タブか Issue 名 `SecretFinder:` でフィルタし、誤検出前提で手動レビューする。

9. SecretFinder で認証が必要なJSを取得したいが `-H` が動かない。どう回避するか。
   ▶ 答え: `-c/--cookie` で Cookie を渡すか、`-p 127.0.0.1:8080` で Burp / mitmproxy を挟み、プロキシ側でヘッダを差し替える。

10. 公開JSから見つけた reCAPTCHA サイトキーや Firebase の `apiKey` の報告価値が低いことが多いのはなぜか。
    ▶ 答え: これらは「そもそも公開前提の識別子」であり、単に存在するだけでは何もできない。何ができるか（影響）を示せない限り脆弱性として成立しにくいため。

---

## 出典

- https://github.com/m4ll0k/SecretFinder
- https://raw.githubusercontent.com/m4ll0k/SecretFinder/master/SecretFinder.py
- https://github.com/m4ll0k/SecretFinder/tree/master/BurpSuite-SecretFinder
- https://github.com/GerbenJavado/LinkFinder
- https://github.com/GerbenJavado/LinkFinder/tree/chrome_extension
- https://github.com/GerbenJavado/LinkFinder/issues
- https://github.com/beautify-web/js-beautify
- https://github.com/dashea/requests-file

<!-- sources: https://github.com/m4ll0k/SecretFinder, https://raw.githubusercontent.com/m4ll0k/SecretFinder/master/SecretFinder.py, https://github.com/m4ll0k/SecretFinder/tree/master/BurpSuite-SecretFinder, https://github.com/GerbenJavado/LinkFinder, https://github.com/GerbenJavado/LinkFinder/tree/chrome_extension, https://github.com/GerbenJavado/LinkFinder/issues, https://github.com/beautify-web/js-beautify, https://github.com/dashea/requests-file -->
<!-- terms: SecretFinder, LinkFinder, jsbeautifier, エンドポイント, APIキー, アクセストークン, JWT, 正規表現, re.VERBOSE, 誤検出, 自己XSS, Burp Suite, Jython, IScannerCheck, Passive scan, Active scan, ターゲットスコープ, TLS検証, プロキシ, FileAdapter, 攻撃対象領域 -->

<!-- self-read: https://github.com/dashea/requests-file | 本ノートは依存ライブラリの内部を未収録のため -->
<!-- self-read: https://github.com/m4ll0k/SecretFinder/tree/master/BurpSuite-SecretFinder | スライド画像・GIF動画のため -->
<!-- self-read: https://i.imgur.com/JfcpYok.png | 画像のため本文に埋め込めない -->
<!-- self-read: https://github.com/GerbenJavado/LinkFinder/tree/chrome_extension | 拡張本体の実装は未収録のため -->
<!-- self-read: https://github.com/GerbenJavado/LinkFinder/issues | 動的なHTMLページで内容が変わるため -->
<!-- self-read: https://github.com/beautify-web/js-beautify | 本ノートはツール本体のみ収録のため -->
