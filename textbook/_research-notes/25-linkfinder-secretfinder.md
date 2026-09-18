# [25] LinkFinder と SecretFinder — JavaScriptファイルからのエンドポイント抽出とシークレット検出

想定章: ch04（JavaScript解析 / 攻撃対象領域の発見）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://github.com/GerbenJavado/LinkFinder | full | raw.githubusercontent (README.md) + `git clone --depth 1`（master / chrome_extension 両ブランチ） | GitHubのHTMLページ自体は WebFetch で HTTP 503。README全文・`linkfinder.py` 全文・`template.html`・`test_parser.py`・`Dockerfile`・`setup.py`・`requirements.txt`・`LICENSE` を取得済み。スター数等のメタ情報のみ未取得（api.github.com がプロキシ経由で空応答、MCP github ツールは当セッションで当リポジトリ非許可） |
| https://github.com/m4ll0k/SecretFinder | full | raw.githubusercontent (README.md) + `git clone --depth 1` | README全文・`SecretFinder.py` 全文・`BurpSuite-SecretFinder/`（README・拡張本体 `SecretFinder.py`・LICENSE）・`Dockerfile`・`requirements.txt` を取得済み。メタ情報（スター数）のみ未取得 |

補助的に取得したもの（いずれも上記2リポジトリ内のファイル。外部の二次情報は使っていない）:

- `https://raw.githubusercontent.com/GerbenJavado/LinkFinder/master/linkfinder.py`（14,018 bytes）
- `https://raw.githubusercontent.com/GerbenJavado/LinkFinder/master/template.html`（2,088 bytes）
- `https://raw.githubusercontent.com/GerbenJavado/LinkFinder/master/test_parser.py`（3,449 bytes）
- `https://raw.githubusercontent.com/GerbenJavado/LinkFinder/master/Dockerfile` / `setup.py` / `requirements.txt`
- LinkFinder `chrome_extension` ブランチ（`README.md`, `http-server.py`, `LinkFinder-Extension/`）
- `https://raw.githubusercontent.com/m4ll0k/SecretFinder/master/SecretFinder.py`（17,355 bytes）
- `m4ll0k/SecretFinder` の `BurpSuite-SecretFinder/SecretFinder.py`（8,516 bytes）, `BurpSuite-SecretFinder/README.md`, `Dockerfile`

リポジトリの実測情報:

| 項目 | LinkFinder | SecretFinder |
|---|---|---|
| デフォルトブランチ | master | master |
| ブランチ一覧（`git ls-remote --heads`） | `master`, `chrome_extension` | `master` のみ |
| 最終コミット（取得時点） | `1debac5dace4724fd6187c06f133578dae51c86f` / 2024-04-13 11:53:27 +0200 / "Merge pull request #133 from SyedaliHOH/patch-2" | `d06119dedd9c1505137d1ec4792d5d5b65c7425d` / 2024-05-26 16:36:41 +0700 / "Update SecretFinder.py" |
| ライセンス | MIT License, Copyright (c) 2019 Gerben Janssen van Doorn | GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007（リポジトリ直下）／`BurpSuite-SecretFinder/LICENSE` は MIT License, Copyright (c) 2019 evilbit \| m4ll0k |
| ルート直下のファイル | `.dockerignore`, `.gitignore`, `Dockerfile`, `LICENSE`, `README.md`, `linkfinder.py`, `requirements.txt`, `setup.py`, `template.html`, `test_parser.py` | `.gitignore`（内容は `*.html`）, `BurpSuite-SecretFinder/`, `Dockerfile`, `LICENSE`, `README.md`, `SecretFinder.py`, `requirements.txt` |

## 要約

- **LinkFinder**（Gerben Javado、MIT）は JavaScript ファイル中の「エンドポイントとそのパラメータ」を発見する Python 3 スクリプト。python版 jsbeautifier で JS を整形したうえで、**4つの小さな正規表現を束ねた1本の大きな正規表現**（実装上は5つの選択肢）を当てる。出力は HTML かプレーンテキスト（`-o cli`）。
- 検出する4カテゴリは README の言葉で「フルURL（`https://example.com/*`）」「絶対URL/ドット付きURL（`/\*` や `../*`）」「スラッシュを1つ以上含む相対URL（`text/test.php`）」「スラッシュなしの相対URL（`test.php`）」。
- CLIオプションは README 記載が `-i/--input`, `-o/--output`, `-r/--regex`, `-d/--domain`, `-b/--burp`, `-c/--cookies`, `-h/--help` の7つ。**実装にはREADME未記載の `-t/--timeout`（既定10秒）が追加されている**。
- **SecretFinder**（m4ll0k、GPLv3）は LinkFinder をベースに、エンドポイントではなく **apikey / accesstoken / authorization / jwt などの機密データ**を JS から探すよう作り替えた派生ツール。`_regex` 辞書に31個の名前付き正規表現を持ち、`-r` で1個だけ `custom_regex` として追加できる。
- SecretFinder は LinkFinder に無い機能を持つ: `-e/--extract`（HTMLページ内の `<script src>` を lxml XPath で列挙して全部処理）、`-g/--ignore` / `-n/--only`（JS URLの部分一致フィルタ、`;` 区切り）、`-H/--headers`、`-p/--proxy`。requests ベースで `verify=False`（TLS検証無効）。
- SecretFinder リポジトリには **Burp Suite 拡張（`BurpSuite-SecretFinder/`, beta v0.1, Jython必須）** が同梱され、`IScannerCheck` の Passive / Active 両スキャンで**任意のHTTPレスポンス**に37個の正規表現を当てて "SecretFinder: <名前>" という Information / Tentative の Issue を起票する。
- 実務上の位置づけ: 素朴な `cat *.js | grep -i apikey` の代替。SecretFinder のDockerfile冒頭には URL リストを流す1行レシピが公式に書かれている。

---

## 詳細ノート

# A. LinkFinder （出典: https://github.com/GerbenJavado/LinkFinder）

### A-1. About LinkFinder（READMEの内容）

LinkFinder は「JavaScriptファイル内のエンドポイントとそのパラメータを発見するために書かれた python スクリプト」である。READMEはその目的をこう説明する: これによりペネトレーションテスター／バグハンターは、テスト対象のウェブサイト上で**新たな、隠れたエンドポイント**を収集できる。結果として新しいテスト対象領域（new testing ground）が得られ、そこには新たな脆弱性が含まれている可能性がある。

実現方法は「python 向けの [jsbeautifier](https://github.com/beautify-web/js-beautify) と、かなり大きな1本の正規表現の組み合わせ」。READMEは「この正規表現は4つの小さな正規表現から構成される」と述べ、それぞれの責務を次のように列挙している（原文の記法をそのまま）:

- Full URLs (`https://example.com/*`)
- Absolute URLs or dotted URLs (`/\*` or `../*`)
- Relative URLs with at least one slash (`text/test.php`)
- Relative URLs without a slash (`test.php`)

出力は HTML またはプレーンテキストで与えられる。また [@karel_origin](https://twitter.com/karel_origin) が LinkFinder 用の Chrome 拡張を書いており、それは `chrome_extension` ブランチ（https://github.com/GerbenJavado/LinkFinder/tree/chrome_extension ）にある。

READMEには "Screenshots" 節があり、動作画面の画像 `https://i.imgur.com/JfcpYok.png`（"LinkFinder in action"）と、冒頭のロゴ画像 `https://user-images.githubusercontent.com/18099289/62728809-f98b0900-ba1c-11e9-8dd8-67111263a21f.png`（幅650px指定）が埋め込まれている。

### A-2. インストールと依存関係

READMEは「LinkFinder は **Python 3** をサポートする」と明記する。

#### コード/コマンド（原文のまま逐語）

```
$ git clone https://github.com/GerbenJavado/LinkFinder.git
$ cd LinkFinder
$ python setup.py install
```

依存関係について README は「LinkFinder は `argparse` と `jsbeautifier` の Python モジュールに依存する。これらの依存関係はすべて [pip](https://pypi.python.org/pypi/pip) を使ってインストールできる」と述べる。

```
$ pip3 install -r requirements.txt
```

実際の `requirements.txt` の中身は1行だけ:

```
jsbeautifier
```

`setup.py` の全文（逐語）:

```python
#!/usr/bin/env python
from setuptools import setup, find_packages

setup(
    name='LinkFinder',
    packages=find_packages(),
    version='1.0',
    description="A python script that finds endpoints in JavaScript files.",
    long_description=open('README.md').read(),
    author='Gerben Javado',
    url='https://github.com/GerbenJavado/LinkFinder',
    py_modules=['linkfinder'],
    install_requires=['jsbeautifier'],
)
```

〔補足（一般知識）〕`setup.py` のバージョンは 1.0 固定であり、`install_requires` は `jsbeautifier` のみ。`argparse` は Python 3 標準ライブラリなので別途インストールは不要。

### A-3. 全CLIオプション（READMEの表を完全再現）

Short Form    | Long Form     | Description
------------- | ------------- |-------------
-i            | --input       | Input a: URL, file or folder. For folders a wildcard can be used (e.g. '/*.js').
-o            | --output      | "cli" to print to STDOUT, otherwise where to save the HTML file Default: output.html
-r            | --regex       | RegEx for filtering purposes against found endpoints (e.g. ^/api/)
-d            | --domain      | Toggle to use when analyzing an entire domain. Enumerates over all found JS files.
-b            | --burp        | Toggle to use when inputting a Burp 'Save selected' file containing multiple JS files
-c            | --cookies     | Add cookies to the request
-h            | --help        | show the help message and exit

**実装（`linkfinder.py` の argparse）に現れる定義は README と細部が違う。** 以下は `linkfinder.py` 内の `add_argument` 呼び出しの逐語引用:

```python
    parser = argparse.ArgumentParser()
    parser.add_argument("-d", "--domain",
                        help="Input a domain to recursively parse all javascript located in a page",
                        action="store_true")
    parser.add_argument("-i", "--input",
                        help="Input a: URL, file or folder. \
                        For folders a wildcard can be used (e.g. '/*.js').",
                        required="True", action="store")
    parser.add_argument("-o", "--output",
                        help="Where to save the file, \
                        including file name. Default: output.html",
                        action="store", default="output.html")
    parser.add_argument("-r", "--regex",
                        help="RegEx for filtering purposes \
                        against found endpoint (e.g. ^/api/)",
                        action="store")
    parser.add_argument("-b", "--burp",
                        help="",
                        action="store_true")
    parser.add_argument("-c", "--cookies",
                        help="Add cookies for authenticated JS files",
                        action="store", default="")
    default_timeout = 10
    parser.add_argument("-t", "--timeout",
                        help="How many seconds to wait for the server to send data before giving up (default: " + str(default_timeout) + " seconds)",
                        default=default_timeout, type=int, metavar="<seconds>")
    args = parser.parse_args()
```

実装から読み取れる差分・要点を表にまとめる:

| オプション | 実装上の型 | 既定値 | READMEとの差異・注意点 |
|---|---|---|---|
| `-d, --domain` | `store_true`（フラグ） | False | 実装のhelpは "Input a domain to recursively parse all javascript located in a page"。**値を取らないトグル**であり、「`-d domain` のように引数を与える」形式ではない。ドメイン自体は `-i` に渡す |
| `-i, --input` | `store` | 必須（`required="True"`） | URL / ファイル / フォルダ（ワイルドカード可） |
| `-o, --output` | `store` | `output.html` | `cli` を指定すると `mode = 0` になり STDOUT 出力。READMEはこの分岐を明示、実装のhelp文は保存先だけを説明 |
| `-r, --regex` | `store` | なし | 検出済みエンドポイントに対する**後段フィルタ**。例 `^/api/` |
| `-b, --burp` | `store_true`（フラグ） | False | **実装の help は空文字列**（`help=""`）。仕様説明はREADMEにしかない |
| `-c, --cookies` | `store` | `""` | 認証済みJSファイル取得用のCookie。`Cookie` ヘッダとしてそのまま送られる |
| `-t, --timeout` | `store`（`type=int`, `metavar="<seconds>"`） | `10` | **READMEの表に存在しない**。`urlopen(..., timeout=args.timeout, ...)` に渡される |
| `-h, --help` | argparse自動生成 | — | — |

また `main` 冒頭で入力末尾のスラッシュが落とされる:

```python
    if args.input[-1:] == "/":
        args.input = args.input[:-1]

    mode = 1
    if args.output == "cli":
        mode = 0
```

`mode` の意味は `parser_file` の docstring に書かれている（後述 A-7）: `mode=1` は「周辺のコンテキストを結果に含める」モード、`mode=0` はリンクのみ。`-o cli` のとき `mode=0` になるため、**jsbeautifier による整形が丸ごとスキップされ、非常に高速になる**（READMEの "doesn't use jsbeautifier, which makes it very fast" と対応）。

### A-4. 使用例（READMEの Examples 節、逐語）

- Most basic usage to find endpoints in an online JavaScript file and output the HTML results to results.html:

`python linkfinder.py -i https://example.com/1.js -o results.html`

- CLI/STDOUT output (doesn't use jsbeautifier, which makes it very fast):

`python linkfinder.py -i https://example.com/1.js -o cli`

- Analyzing an entire domain and its JS files:

`python linkfinder.py -i https://example.com -d`

- Burp input (select in target the files you want to save, right click, `Save selected items`, feed that file as input):

`python linkfinder.py -i burpfile -b`

- Enumerating an entire folder for JavaScript files, while looking for endpoints starting with /api/ and finally saving the results to results.html:

`python linkfinder.py -i 'Desktop/*.js' -r ^/api/ -o results.html`

Burp入力の作り方はREADMEの括弧内が手順そのもの: **Burp の Target で保存したいファイルを選択 → 右クリック → `Save selected items` → そのファイルを `-i` に渡し `-b` を付ける**。

### A-5. Docker（READMEの Docker 節、逐語）

- Build the Docker image:

  ``` docker build -t linkfinder```

- Run with Docker

  ` docker run --rm -v $(pwd):/linkfinder/output linkfinder -i http://example.com/1.js -o /linkfinder/output/output.html`

  Make sure to use the path `/linkfinder/output` in your output path, or the output will be lost when the container exits.

〔補足（一般知識）〕READMEのビルドコマンドはビルドコンテキストの指定（末尾の `.`）が欠けているため、通常は `docker build -t linkfinder .` と補って実行する必要がある。

`Dockerfile` の全文（逐語）:

```dockerfile
FROM python:3.7.3-alpine3.9

RUN apk add --no-cache shadow bash && \
    mkdir -p /linkfinder/output && \
    useradd --create-home --shell /sbin/nologin linkfinder

COPY . /linkfinder/

WORKDIR /linkfinder/

RUN chown -R linkfinder:linkfinder /linkfinder && \
    python3 setup.py install

USER linkfinder

ENTRYPOINT ["/linkfinder/linkfinder.py"]
```

ポイント: ベースは `python:3.7.3-alpine3.9`、出力ディレクトリ `/linkfinder/output` をイメージ内に作成、非rootユーザ `linkfinder`（シェルは `/sbin/nologin`）で実行、ENTRYPOINT が `linkfinder.py` なので `docker run <image> -i ... -o ...` のようにオプションだけを渡す。

### A-6. ユニットテスト（READMEの Unit-test 節）

- Require pytest

`pytest test_parser.py`

### A-7. 内部実装：中核の正規表現 `regex_str`（逐語・全文）

LinkFinder の本体はこの1本の正規表現である。`re.VERBOSE` でコンパイルされるため、コメントとインデントがそのまま仕様書になっている。**以下は `linkfinder.py` からの逐語引用（コメント含む、改変なし）**:

```python
# Regex used
regex_str = r"""

  (?:"|')                               # Start newline delimiter

  (
    ((?:[a-zA-Z]{1,10}://|//)           # Match a scheme [a-Z]*1-10 or //
    [^"'/]{1,}\.                        # Match a domainname (any character + dot)
    [a-zA-Z]{2,}[^"']{0,})              # The domainextension and/or path

    |

    ((?:/|\.\./|\./)                    # Start with /,../,./
    [^"'><,;| *()(%%$^/\\\[\]]          # Next character can't be...
    [^"'><,;|()]{1,})                   # Rest of the characters can't be

    |

    ([a-zA-Z0-9_\-/]{1,}/               # Relative endpoint with /
    [a-zA-Z0-9_\-/.]{1,}                # Resource name
    \.(?:[a-zA-Z]{1,4}|action)          # Rest + extension (length 1-4 or action)
    (?:[\?|#][^"|']{0,}|))              # ? or # mark with parameters

    |

    ([a-zA-Z0-9_\-/]{1,}/               # REST API (no extension) with /
    [a-zA-Z0-9_\-/]{3,}                 # Proper REST endpoints usually have 3+ chars
    (?:[\?|#][^"|']{0,}|))              # ? or # mark with parameters

    |

    ([a-zA-Z0-9_\-]{1,}                 # filename
    \.(?:php|asp|aspx|jsp|json|
         action|html|js|txt|xml)        # . + extension
    (?:[\?|#][^"|']{0,}|))              # ? or # mark with parameters

  )

  (?:"|')                               # End newline delimiter

"""

context_delimiter_str = "\n"
```

この正規表現の仕組みを分解して読むと次のようになる。

1. **両端のデリミタ** `(?:"|')` … マッチは必ず**シングルクォートかダブルクォートで囲まれた文字列リテラルの内側**でなければならない。これがLinkFinderの最大の前提であり同時に最大の限界である。JS中で文字列連結（`"/api/" + ver + "/user"`）やテンプレートリテラル（バッククォート）で組み立てられるURLは、この形では拾えない。
2. **グループ1（外側の `( ... )`）** が「リンク」として取り出される部分。`parser_file` は `m.group(1)` を採用する。内部の5つの選択肢はそれぞれサブグループになっており、コード内に「Remove other capture groups from regex results」というコメントがある（結果としては group(1) のみ使用）。
3. **選択肢1：スキーム付きURL** `(?:[a-zA-Z]{1,10}://|//)` … スキーム名は英字1〜10文字、または**プロトコル相対の `//`**。続いて `[^"'/]{1,}\.` でドメイン名（クォートとスラッシュ以外＋ドット）、`[a-zA-Z]{2,}[^"']{0,}` でTLDとパス。**`http`/`https` 限定ではない**点が重要で、テストには `smb://example.com` も入っている。
4. **選択肢2：絶対パス／ドット相対パス** `(?:/|\.\./|\./)` で始まる。直後の1文字は `[^"'><,;| *()(%%$^/\\\[\]]` に含まれない文字であってはならない（つまり `>`, `<`, `,`, `;`, `|`, 空白, `*`, `(`, `)`, `%`, `$`, `^`, `/`, `\`, `[`, `]` を除外）。以降は `[^"'><,;|()]{1,}`。**この「次の1文字で `/` を禁止」が `//` をパスとして誤検出しないための仕掛け**になっている。なお原文には `%%` と `((` の重複がそのまま残っている（`(%%$^` の部分。書式文字列の名残と思われる）が、文字クラス内なので実害は少ない。
5. **選択肢3：スラッシュを含む相対エンドポイント＋拡張子** `[a-zA-Z0-9_\-/]{1,}/` ＋ リソース名 ＋ `\.(?:[a-zA-Z]{1,4}|action)`。拡張子は**英字1〜4文字、または `action`**（Struts等の `.action` を意識）。末尾に `(?:[\?|#][^"|']{0,}|)` で `?`/`#` 以降のパラメータを任意で取り込む。
6. **選択肢4：拡張子なしのREST API** `[a-zA-Z0-9_\-/]{1,}/` ＋ `[a-zA-Z0-9_\-/]{3,}`。コメントは「まともなRESTエンドポイントは通常3文字以上」。`api/user`, `v1/create`, `api/v1/user/2` が拾える。
7. **選択肢5：スラッシュなしのファイル名** `[a-zA-Z0-9_\-]{1,}` ＋ `\.(?:php|asp|aspx|jsp|json|action|html|js|txt|xml)`。**拡張子はこの10種のホワイトリストに限定**。だから `UserModel.name` は拾われず（テストで明示）、`main.js` や `robots.txt` は拾われる。

`context_delimiter_str = "\n"` はコンテキスト抽出の区切り文字であり、「マッチの前後を改行まで広げて1行を文脈として見せる」ことを意味する。

### A-8. 入力の解釈：`parser_input` の5メソッド（逐語）

```python
def parser_input(input):
    '''
    Parse Input
    '''

    # Method 1 - URL
    if input.startswith(('http://', 'https://',
                         'file://', 'ftp://', 'ftps://')):
        return [input]

    # Method 2 - URL Inspector Firefox
    if input.startswith('view-source:'):
        return [input[12:]]

    # Method 3 - Burp file
    if args.burp:
        jsfiles = []
        items = xml.etree.ElementTree.fromstring(open(args.input, "r").read())

        for item in items:
            jsfiles.append({"js":base64.b64decode(item.find('response').text).decode('utf-8',"replace"), "url":item.find('url').text})
        return jsfiles

    # Method 4 - Folder with a wildcard
    if "*" in input:
        paths = glob.glob(os.path.abspath(input))
        file_paths = [p for p in paths if os.path.isfile(p)]
        for index, path in enumerate(file_paths):
            file_paths[index] = "file://%s" % path
        return (file_paths if len(file_paths) > 0 else parser_error('Input with wildcard does \
        not match any files.'))

    # Method 5 - Local file
    path = "file://%s" % os.path.abspath(input)
    return [path if os.path.exists(input) else parser_error("file could not \
be found (maybe you forgot to add http/https).")]
```

読み取れる仕様:

| Method | 条件 | 挙動 |
|---|---|---|
| 1. URL | `http://`, `https://`, `file://`, `ftp://`, `ftps://` で始まる | そのまま1件のURLとして扱う |
| 2. URL Inspector Firefox | `view-source:` で始まる | 先頭12文字を切り落として素のURLにする（Firefoxのソース表示URLを貼れる） |
| 3. Burp file | `-b` 指定時 | 入力ファイルを**XMLとしてパース**し、各 item の `<response>` を **base64デコード**、`<url>` と組にして `{"js": ..., "url": ...}` のリストを返す。デコード不能文字は `replace` |
| 4. ワイルドカード | 入力に `*` を含む | `glob.glob(os.path.abspath(input))` で展開、**ファイルのみ**に絞り `file://` を前置。0件なら "Input with wildcard does not match any files." でエラー終了 |
| 5. ローカルファイル | 上記以外 | `file://` + 絶対パス。存在しなければ "file could not be found (maybe you forgot to add http/https)." |

Burp入力が **XML（Burpの "Save selected items" が出す形式）で、レスポンス本文がbase64である**という点はch04で必ず触れるべき実装事実。

### A-9. HTTP取得：`send_request`（逐語）

```python
def send_request(url):
    '''
    Send requests with Requests
    '''
    q = Request(url)

    q.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
        AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36')
    q.add_header('Accept', 'text/html,\
        application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8')
    q.add_header('Accept-Language', 'en-US,en;q=0.8')
    q.add_header('Accept-Encoding', 'gzip')
    q.add_header('Cookie', args.cookies)

    try:
        sslcontext = ssl.create_default_context()
        response = urlopen(q, timeout=args.timeout, context=sslcontext)
    except:
        sslcontext = ssl.create_default_context()
        response = urlopen(q, timeout=args.timeout, context=sslcontext)

    if response.info().get('Content-Encoding') == 'gzip':
        data = GzipFile(fileobj=readBytesCustom(response.read())).read()
    elif response.info().get('Content-Encoding') == 'deflate':
        data = response.read().read()
    else:
        data = response.read()

    return data.decode('utf-8', 'replace')
```

固定で送られるヘッダの値は逐語で押さえておく価値がある（WAFのフィンガープリントやログ突合に使える）:

| ヘッダ | 値 |
|---|---|
| `User-Agent` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36`（ソース上は行継続のため間に空白が入る） |
| `Accept` | `text/html, application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8`（同様に行継続の空白を含む） |
| `Accept-Language` | `en-US,en;q=0.8` |
| `Accept-Encoding` | `gzip` |
| `Cookie` | `-c/--cookies` の値（既定は空文字列） |

〔補足（一般知識）〕`try`/`except` の中身が完全に同じであるため、事実上「1回リトライする」だけの構造になっている。また `deflate` 分岐の `response.read().read()` は `bytes` に `.read()` を呼ぶことになり成立しないコードで、`Accept-Encoding: gzip` しか送らない設計のため通常は到達しない。`ssl.create_default_context()` を使っているので**証明書検証は有効**（SecretFinder と対照的）。ゆえに自己署名証明書のステージング環境では `parser_error("invalid input defined or SSL error: %s")` に落ちる。

### A-10. 解析本体：`parser_file` と `getContext`（逐語）

```python
def parser_file(content, regex_str, mode=1, more_regex=None, no_dup=1):
    '''
    Parse Input
    content:    string of content to be searched
    regex_str:  string of regex (The link should be in the group(1))
    mode:       mode of parsing. Set 1 to include surrounding contexts in the result
    more_regex: string of regex to filter the result
    no_dup:     remove duplicated link (context is NOT counted)

    Return the list of ["link": link, "context": context]
    The context is optional if mode=1 is provided.
    '''
    global context_delimiter_str

    if mode == 1:
        # Beautify
        if len(content) > 1000000:
            content = content.replace(";",";\r\n").replace(",",",\r\n")
        else:
            content = jsbeautifier.beautify(content)

    regex = re.compile(regex_str, re.VERBOSE)

    if mode == 1:
        all_matches = [(m.group(1), m.start(0), m.end(0)) for m in re.finditer(regex, content)]
        items = getContext(all_matches, content, context_delimiter_str=context_delimiter_str)
    else:
        items = [{"link": m.group(1)} for m in re.finditer(regex, content)]

    if no_dup:
        # Remove duplication
        all_links = set()
        no_dup_items = []
        for item in items:
            if item["link"] not in all_links:
                all_links.add(item["link"])
                no_dup_items.append(item)
        items = no_dup_items

    # Match Regex
    filtered_items = []
    for item in items:
        # Remove other capture groups from regex results
        if more_regex:
            if re.search(more_regex, item["link"]):
                filtered_items.append(item)
        else:
            filtered_items.append(item)

    return filtered_items
```

重要な数値と挙動:

- **1,000,000 文字（約1MB）が閾値**。これを超えるコンテンツには jsbeautifier をかけず、`;` を `;\r\n` に、`,` を `,\r\n` に置換するだけの「軽量整形」を行う。巨大な minified バンドル（webpack出力など）で jsbeautifier が現実的な時間で終わらない問題への対処。
- `re.compile(regex_str, re.VERBOSE)`。
- `mode == 1` では `(m.group(1), m.start(0), m.end(0))` のタプル列を作り `getContext` に渡す。`mode == 0` では `{"link": m.group(1)}` だけ。
- 重複排除は **link 単位**（コンテキストは数えない）。docstring 明記。
- `more_regex`（= `-r` の値）は **最終段のフィルタ**で、`re.search(more_regex, item["link"])` にマッチしたものだけ残す。つまり `-r` は検出用ではなく絞り込み用。

```python
def getContext(list_matches, content, include_delimiter=0, context_delimiter_str="\n"):
    '''
    Parse Input
    list_matches:       list of tuple (link, start_index, end_index)
    content:            content to search for the context
    include_delimiter   Set 1 to include delimiter in context
    '''
    items = []
    for m in list_matches:
        match_str = m[0]
        match_start = m[1]
        match_end = m[2]
        context_start_index = match_start
        context_end_index = match_end
        delimiter_len = len(context_delimiter_str)
        content_max_index = len(content) - 1

        while content[context_start_index] != context_delimiter_str and context_start_index > 0:
            context_start_index = context_start_index - 1

        while content[context_end_index] != context_delimiter_str and context_end_index < content_max_index:
            context_end_index = context_end_index + 1

        if include_delimiter:
            context = content[context_start_index: context_end_index]
        else:
            context = content[context_start_index + delimiter_len: context_end_index]

        item = {
            "link": match_str,
            "context": context
        }
        items.append(item)

    return items
```

要するに**マッチ位置から前後に改行まで走査して「その行全体」をコンテキストにする**。jsbeautifier で整形済みなので、整形後の1行＝意味のある1文になり、`fetch(...)`, `$.ajax({url: ...})` のような呼び出し文脈が人間に読める形で残る。これが grep との決定的な差。

### A-11. `-d`（ドメインモード）と `check_url` の除外リスト（逐語）

```python
def check_url(url):
    nopelist = ["node_modules", "jquery.js"]
    if url[-3:] == ".js":
        words = url.split("/")
        for word in words:
            if word in nopelist:
                return False
        if url[:2] == "//":
            url = "https:" + url
        if url[:4] != "http":
            if url[:1] == "/":
                url = args.input + url
            else:
                url = args.input + "/" + url
        return url
    else:
        return False
```

仕様:

- **`.js` で終わるURLだけを再帰対象にする**（`url[-3:] == ".js"`）。クエリ付き（`app.js?v=3`）は対象外になる。
- **`nopelist = ["node_modules", "jquery.js"]`** … パスをスラッシュで分割した要素がこの2つのどちらかに一致したらスキップ。ノイズの多いライブラリを弾く最小限のブラックリスト。
- プロトコル相対 `//cdn.example.com/x.js` → `https:` を前置。
- `http` で始まらない場合、`/` 始まりなら `args.input + url`、そうでなければ `args.input + "/" + url` で絶対化。

`-d` の本体（`main` 内）:

```python
        endpoints = parser_file(file, regex_str, mode, args.regex)
        if args.domain:
            for endpoint in endpoints:
                endpoint = html.escape(endpoint["link"]).encode('ascii', 'ignore').decode('utf8')
                endpoint = check_url(endpoint)
                if endpoint is False:
                    continue
                print("Running against: " + endpoint)
                print("")
                try:
                    file = send_request(endpoint)
                    new_endpoints = parser_file(file, regex_str, mode, args.regex)
                    ...
                except Exception as e:
                    print("Invalid input defined or SSL error for: " + endpoint)
                    continue
```

つまり **`-d` は「入力ページを1回パースして見つかった `.js` を全部取得し、それぞれをもう一度パースする」深さ1の再帰**。進捗は `Running against: <url>` として標準出力に出る。失敗しても `Invalid input defined or SSL error for: <url>` を出して次へ進む。

〔補足（一般知識）〕`-d` はHTML中の `<script src>` を明示的にパースするのではなく、**同じエンドポイント抽出正規表現がたまたま拾った `.js` 文字列**を使う。したがってHTMLに `<script src=...>` があってもクォート内の形が正規表現に合わない場合は拾えない。SecretFinder の `-e` が lxml XPath で `//script/@src` を取るのと対比すると設計差がはっきりする。

### A-12. HTML出力：`html_save` と `template.html`

```python
def html_save(html):
    '''
    Save as HTML file and open in the browser
    '''
    hide = os.dup(1)
    os.close(1)
    os.open(os.devnull, os.O_RDWR)
    try:
        s = Template(open('%s/template.html' % sys.path[0], 'r').read())

        text_file = open(args.output, "wb")
        text_file.write(s.substitute(content=html).encode('utf8'))
        text_file.close()

        print("URL to access output: file://%s" % os.path.abspath(args.output))
        file = "file:///%s" % os.path.abspath(args.output)
        if sys.platform == 'linux' or sys.platform == 'linux2':
            subprocess.call(["xdg-open", file])
        else:
            webbrowser.open(file)
    except Exception as e:
        print("Output can't be saved in %s \
            due to exception: %s" % (args.output, e))
    finally:
        os.dup2(hide, 1)
```

- `string.Template` を使い、**テンプレート中の `$content` を差し込む**。テンプレートは `sys.path[0]` 直下の `template.html`（＝スクリプトと同じディレクトリ）。**`template.html` が無いと出力に失敗する**（`python setup.py install` でパッケージ化したとき注意）。
- 完了時に `URL to access output: file://<絶対パス>` を表示し、**自動でブラウザを開く**（Linux は `xdg-open`、それ以外は `webbrowser.open`）。ファイル先頭のコード `os.environ["BROWSER"] = "open"` は macOS 向けの回避策（コメント "Fix webbrowser bug for MacOS"）。
- `os.dup(1)` / `os.close(1)` / `os.open(os.devnull, ...)` / `finally: os.dup2(hide, 1)` は、ブラウザ起動時の余計な標準出力を一時的に `/dev/null` へ捨てるための仕掛け。

各エンドポイントのHTML断片の組み立て（`main` 内、逐語）:

```python
            output += '''
                <h1>File: <a href="%s" target="_blank" rel="nofollow noopener noreferrer">%s</a></h1>
                ''' % (html.escape(url), html.escape(url))

            for endpoint in endpoints:
                url = html.escape(endpoint["link"])
                header = "<div><a href='%s' class='text'>%s" % (
                    html.escape(url),
                    html.escape(url)
                )
                body = "</a><div class='container'>%s</div></div>" % html.escape(
                    endpoint["context"]
                )
                body = body.replace(
                    html.escape(endpoint["link"]),
                    "<span style='background-color:yellow'>%s</span>" %
                    html.escape(endpoint["link"])
                )

                output += header + body
```

構造: ファイルごとに `<h1>File: <a ...>URL</a></h1>`、その下にエンドポイントごとの `<div><a class='text'>リンク</a><div class='container'>コンテキスト</div></div>`。コンテキスト中のリンク部分は `<span style='background-color:yellow'>...</span>` で**黄色ハイライト**される。すべて `html.escape` を通す（出力HTMLを開く自分自身が XSS を食らわないための処置）。

`template.html` の全文（逐語）:

```html
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
  $content
  
  <a class='button' contenteditable='false' href='https://github.com/GerbenJavado/LinkFinder/issues/new' rel='nofollow noopener noreferrer' target='_blank'><span class='github-icon'><svg height="24" viewbox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg></span> Report an issue.</a>
</body>
</html>
```

注目すべきは `<title>LinkFinder Output</title>` と **`<body contenteditable="true">`**。出力HTMLはブラウザ上でそのまま編集でき、不要な行を消しながらトリアージできる設計になっている（"Report an issue." ボタンだけ `contenteditable='false'`）。

CLI出力側は極めて素朴:

```python
def cli_output(endpoints):
    '''
    Output to CLI
    '''
    for endpoint in endpoints:
        print(html.escape(endpoint["link"]).encode(
            'ascii', 'ignore').decode('utf8'))
```

**`html.escape` を通した上で非ASCII文字を捨てる**（`encode('ascii','ignore')`）。したがってCLI出力では `&` が `&amp;` に、`<` が `&lt;` になり、非ASCIIを含むパスは欠落する。パイプで後段ツールへ流す際の既知の癖として教科書に書く価値がある。

### A-13. `test_parser.py` が事実上の正規表現仕様書（逐語・全文）

LinkFinderの検出仕様を一番正確に示すのはREADMEではなくテストである。

```python
#!/usr/bin/env python
# -*- coding: utf-8 -*-

import pytest
from linkfinder import regex_str, parser_file

# Imitate cli_output function
def get_parse_cli(str):
    endpoints = parser_file(str, regex_str, mode=0)
    ret = []
    for endpoint in endpoints:
        ret.append(endpoint["link"])
    return ret

def test_parser_cli():
    assert get_parse_cli("\"http://example.com\"") == ["http://example.com"]
    assert get_parse_cli("\"smb://example.com\"") == ["smb://example.com"]
    assert get_parse_cli("\"https://www.example.co.us\"") == ["https://www.example.co.us"]

    assert get_parse_cli("\"/path/to/file\"") == ["/path/to/file"]
    assert get_parse_cli("\"../path/to/file\"") == ["../path/to/file"]
    assert get_parse_cli("\"./path/to/file\"") == ["./path/to/file"]
    assert get_parse_cli("\"/user/create.action?user=Test\"") == ["/user/create.action?user=Test"]
    assert get_parse_cli("\"/api/create.php?user=test&pass=test#home\"") == ["/api/create.php?user=test&pass=test#home"]
    assert get_parse_cli("\"/wrong/file/test<>b\"") == []

    assert get_parse_cli("\"api/create.php\"") == ["api/create.php"]
    assert get_parse_cli("\"api/create.php?user=test\"") == ["api/create.php?user=test"]
    assert get_parse_cli("\"api/create.php?user=test&pass=test\"") == ["api/create.php?user=test&pass=test"]
    assert get_parse_cli("\"api/create.php?user=test#home\"") == ["api/create.php?user=test#home"]
    assert get_parse_cli("\"user/create.action?user=Test\"") == ["user/create.action?user=Test"]
    assert get_parse_cli("\"user/create.notaext?user=Test\"") == []

    assert get_parse_cli("\"/path/to/file\"") == ["/path/to/file"]
    assert get_parse_cli("\"../path/to/file\"") == ["../path/to/file"]
    assert get_parse_cli("\"./path/to/file\"") == ["./path/to/file"]
    assert get_parse_cli("\"/wrong/file/test<>b\"") == []

    # REST API (no extension)
    assert get_parse_cli("\"api/user\"") == ["api/user"]
    assert get_parse_cli("\"v1/create\"") == ["v1/create"]
    assert get_parse_cli("\"api/v1/user/2\"") == ["api/v1/user/2"]
    assert get_parse_cli("\"api/v1/search?text=Test Hello\"") == ["api/v1/search?text=Test Hello"]

    assert get_parse_cli("\"test_1.json\"") == ["test_1.json"]
    assert get_parse_cli("\"test2.aspx?arg1=tmp1+tmp2&arg2=tmp3\"") == ["test2.aspx?arg1=tmp1+tmp2&arg2=tmp3"]
    assert get_parse_cli("\"addUser.action\"") == ["addUser.action"]
    assert get_parse_cli("\"main.js\"") == ["main.js"]
    assert get_parse_cli("\"index.html\"") == ["index.html"]
    assert get_parse_cli("\"robots.txt\"") == ["robots.txt"]
    assert get_parse_cli("\"users.xml\"") == ["users.xml"]
    assert get_parse_cli("\"UserModel.name\"") == []

    assert get_parse_cli("\"app/admin/admin.controller.js\"") == ["app/admin/admin.controller.js"]
    assert get_parse_cli("\"services/customer.services.js\"") == ["services/customer.services.js"]

def test_parser_cli_multi():
    assert set(get_parse_cli("href=\"http://example.com\";href=\"/api/create.php\"")) == set(["http://example.com", "/api/create.php"])

def test_parser_unique():
    '''
    Should return only unique link
    '''
    assert get_parse_cli("href=\"http://example.com\";document.window.location=\"http://example.com\"") == ["http://example.com"]
    assert set(get_parse_cli("href=\"http://example.com\";<img src=\"http://example.com\">;href=\"/api/create.php\"")) == set(["http://example.com", "/api/create.php"])
```

テストから確定できる検出／非検出の境界（教科書の表にそのまま使える）:

| 入力（クォート込み） | 結果 | 理由 |
|---|---|---|
| `"http://example.com"` | 検出 | スキーム付きURL |
| `"smb://example.com"` | **検出** | スキームは英字1〜10文字なら何でも通る（http限定でない） |
| `"https://www.example.co.us"` | 検出 | 多段TLD対応 |
| `"/path/to/file"` | 検出 | 絶対パス |
| `"../path/to/file"` | 検出 | ドット相対 |
| `"./path/to/file"` | 検出 | ドット相対 |
| `"/user/create.action?user=Test"` | 検出 | `.action` ＋クエリ |
| `"/api/create.php?user=test&pass=test#home"` | 検出 | クエリ＋フラグメント |
| `"/wrong/file/test<>b"` | **非検出** | `<` `>` が除外文字クラスに入っている |
| `"api/create.php"` | 検出 | スラッシュあり相対＋拡張子 |
| `"user/create.notaext?user=Test"` | **非検出** | 拡張子が5文字（1〜4文字 or `action` のみ許可） |
| `"api/user"`, `"v1/create"`, `"api/v1/user/2"` | 検出 | 拡張子なしREST |
| `"api/v1/search?text=Test Hello"` | 検出 | **クエリ内の空白は許容される** |
| `"test_1.json"` | 検出 | スラッシュなしファイル名（拡張子ホワイトリスト） |
| `"test2.aspx?arg1=tmp1+tmp2&arg2=tmp3"` | 検出 | `aspx` はホワイトリスト内 |
| `"addUser.action"`, `"main.js"`, `"index.html"`, `"robots.txt"`, `"users.xml"` | 検出 | 同上 |
| `"UserModel.name"` | **非検出** | `name` はホワイトリスト外 → JSのプロパティアクセスを誤検出しないための設計 |
| `"app/admin/admin.controller.js"` | 検出 | ドットを複数含むパスも可 |
| 同一リンクの2回出現 | 1件のみ | `no_dup=1` |

### A-14. Chrome拡張（`chrome_extension` ブランチ、出典: https://github.com/GerbenJavado/LinkFinder/tree/chrome_extension ）

READMEが言及している karel_origin 製の拡張。ブランチ直下の構成は `README.md`, `http-server.py`, `LinkFinder-Extension/`（`background.js`, `manifest.json`, `materialize/`（css, js, LICENSE, README.md）, `popup/`（`popup.html`, `popup.js`, `popup.css`, `jquery.js`, `graph/`））。

READMEの説明（要点を日本語で、固有名詞・数値はそのまま）:

- この Chrome 拡張は**ブラウジング中に読み込まれたすべてのJavaScriptファイルをPythonスクリプトに送り返し**、そのスクリプトが LinkFinder を呼んで結果を出力する。
- ドメインのホワイトリスト指定ができるので、結果が欲しいドメインだけをスキャンできる。
- 内部では LinkFinder の **`-o cli` オプション**を使っており、それゆえ非常に高速で、数秒で複数のJSファイルを処理できる。

セットアップ手順（原文の番号付けをそのまま。原文では番号 3 が2回現れる）:

1. このブランチをクローンする
2. Chrome の `chrome://extensions/` で `Developer Mode` にして Extension フォルダを読み込む
3. `http-server.py` の変数 `path_linkfinder` を LinkFinder.py をインストールしたディレクトリに向けて編集する。または LinkFinder.py を Extension のルートフォルダ（`http-server.py` があるフォルダ）に移動する
3. Python スクリプトを実行する（`python http-server.py`）。**ポート 8080** でリスナが起動する
4. 拡張のアイコンをクリックして settings タブへ行き、Extension の On/Off スイッチを押して有効化する
5. 見つかった JavaScript ファイルがターミナル（`http-server.py`）に表示され、LinkFinder に流される

Optional（原文の要点）:

- **Scope** … settings タブの 'Scope' フィールドで変更。指定スコープ内のJSファイルだけをスキャンする。スコープは正規表現（既定は `.*`）でも単なるドメイン名（`example.com`）でもよい。
- **Save Urls** … On にすると LinkFinder が見つけたエンドポイントを保存でき、ホームページの `Download Urls` ボタンでテキストファイルとしてダウンロードできる。
- **グラフ** … 3ページ目に、見つかったユニークURL数と時刻のグラフがある。`Save Urls` が有効なときのみ動作する。原文は「まだ少しバグっぽく、グラフが少し変に見えるかもしれないが改善中」と述べている。
- **通知** … LinkFinder が返したエンドポイントに特定のキーワードが含まれていたら通知を受け取れる。キーワードは改行（Enterキー）で区切る。原文の例:

  ```
  admin
  login
  php
  asp
  swf
  ```

Troubleshooting（原文の要点）:

- **通知が全部来ない** … Chrome は同時に3件までしか通知を表示できない。他の方法を探しているが現状は無い。ゆえにキーワードは最重要のものに絞る必要がある（登録自体は無限にできる）。
- **ブラウジングしてもターミナルに出力がない** … 原因は2つ。(1) スコープを現在のターゲットに変更し忘れている。(2) HTTPサーバに接続できず拡張がオフになっている。`http_server.py` を起動してから、拡張アイコン → settings タブ → Extension スイッチをオンにする（起動していないと数秒後に再びオフになる）。
- **`http-server.py` が `linkfinder.py` を見つけられない** … `http-server.py` は `linkfinder.py` を必要とする。main ブランチからクローンし、`http-server.py` のパス変数を設定するか、`linkfinder.py` を Extension フォルダに置く。

Upcoming Features には「`8080` 以外のポートでのリッスン」が挙がっている（ただし後述のとおり `--port` 引数は既に存在する）。Final Notes は「まだ開発段階でバグや不完全さがあるかもしれない。見つけたら遠慮なく issue を出してほしい」。

`http-server.py` の全文（逐語）— **Python 2 系のコード**である点に注意（`BaseHTTPServer`, `urlparse`）:

```python
from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer
from urlparse import unquote
import os, re, platform, argparse

parser = argparse.ArgumentParser()
parser.add_argument("--ip", default="0.0.0.0", type=str, help="IP to listen on (0.0.0.0 by default")
parser.add_argument("--port", default="8080", type=int, help="port to listen on (8080 by default)")

args = parser.parse_args()

class S(BaseHTTPRequestHandler):
    def _set_headers(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/plain')
        self.end_headers()

    def do_GET(self):
        self._set_headers()
        self.wfile.write("OK")
        
    def do_POST(self):
        content_length = int(self.headers.getheader("content-length", 0))
        body = self.rfile.read(content_length)

        url = getParameter("url", body)
        cookies = getParameter("cookies", body)

        self._set_headers()
        self.wfile.write(LinkFinder(url, cookies))

    def log_message(self, format, *args):
        # Prevent the python script from logging every request.
        return
    
def getParameter(param, body):
    return unquote(re.findall("%s=([^&]*)" % param, body).pop(0))

def LinkFinder(url, cookies):
    output = os.popen("python -u %s -o cli -i %s -c %s" % (path_linkfinder, ('"' + url.replace('"', '\\"') + '"'), ('"' + cookies.replace('"', '\\"') + '"'))).read()
    print("JS File: %s\n\n%s\n---------------------" % (url, output))

    return output

def run(server_class=HTTPServer, handler_class=S, port=args.port, ip=args.ip):
    global path_linkfinder
    
    # Change this path to where linkfinder.py is located, Example path:
    # path_linkfinder = "C:\\Users\\karel\\Documents\\LinkFinder\\linkfinder.py"

    # Default path
    path_linkfinder = "./linkfinder.py"
    
    if os.path.isfile(path_linkfinder) == False:
        print("Path '%s' is invalid" % path_linkfinder)
        raise SystemExit

    server_address = (ip, port)
    httpd = server_class(server_address, handler_class)
    print("Listening on %s:%s" % (ip, port))
    httpd.serve_forever()

run()
```

読み取れること:

- 拡張は POST body に `url=...&cookies=...` を送る。サーバは正規表現 `"<param>=([^&]*)"` で取り出して `unquote` する。
- 実行コマンドは `python -u <path_linkfinder> -o cli -i "<url>" -c "<cookies>"` を `os.popen` で起動。**Cookie もそのまま LinkFinder に渡るので、認証済みセッションのJSも解析できる**。
- 既定の待ち受けは `--ip 0.0.0.0 --port 8080`。**0.0.0.0 で待ち受け、かつ入力を `os.popen` のシェル文字列に埋めている**ため、ローカル限定でない環境に置くべきではない。`url.replace('"', '\\"')` でダブルクォートだけはエスケープしているが、シェルメタ文字一般は素通りする構造である（自分の解析用ツールを外部公開しないという原則の実例として教科書に使える）。
- `log_message` を潰してリクエストログを抑制している。
- ターミナル出力形式は `JS File: <url>` の後に LinkFinder の CLI 出力、続いて `---------------------`。

### A-15. Final remarks（README、逐語の要点）

- This is the first time I publicly release a tool. Contributions are much appreciated!
- LinkFinder is published under the [MIT License](https://github.com/GerbenJavado/LinkFinder/blob/master/LICENSE).
- Thanks to [@jackhcable](https://twitter.com/jackhcable) for providing me with feedback.
- Special thanks [@edoverflow](https://twitter.com/edoverflow) for making this project a lot cleaner and awesome.

---

# B. SecretFinder （出典: https://github.com/m4ll0k/SecretFinder）

### B-1. about SecretFinder（READMEの内容）

SecretFinder は [LinkFinder](https://github.com/GerbenJavado/LinkFinder) をベースにした python スクリプトで、**JavaScriptファイル内の apikeys, accesstoken, authorizations, jwt ...等の機密データ（sensitive data）を発見するために書かれた**。実現方法は LinkFinder と同じで「python向け jsbeautifier と、かなり大きな正規表現の組み合わせ」。READMEは（LinkFinderの文言を引き継いで）「正規表現は4つの小さな正規表現から構成され、それらがJSファイル上の任意のものを見つけ・検索する責務を持つ」と書いている。出力は HTML またはプレーンテキスト。スクリーンショットは `https://i.imgur.com/D7MT2KL.png`。

ヘッダコメント（`SecretFinder.py` 冒頭、逐語）:

```python
#!/usr/bin/env python
# SecretFinder - Tool for discover apikeys/accesstokens and sensitive data in js file
# based on LinkFinder - github.com/GerbenJavado
# By m4ll0k (@m4ll0k2) github.com/m4ll0k
```

冒頭で Python 3 を強制している（逐語）:

```python
import os,sys
if not sys.version_info.major >= 3:
    print("[ + ] Run this tool with python version 3.+")
    sys.exit(0)
os.environ["BROWSER"] = "open"
```

### B-2. ヘルプ出力（READMEの Help 節、逐語で完全再現）

```
usage: SecretFinder.py [-h] [-e] -i INPUT [-o OUTPUT] [-r REGEX] [-b]
                       [-c COOKIE] [-g IGNORE] [-n ONLY] [-H HEADERS]
                       [-p PROXY]

optional arguments:
  -h, --help            show this help message and exit
  -e, --extract         Extract all javascript links located in a page and
                        process it
  -i INPUT, --input INPUT
                        Input a: URL, file or folder
  -o OUTPUT, --output OUTPUT
                        Where to save the file, including file name. Default:
                        output.html
  -r REGEX, --regex REGEX
                        RegEx for filtering purposes against found endpoint
                        (e.g: ^/api/)
  -b, --burp            Support burp exported file
  -c COOKIE, --cookie COOKIE
                        Add cookies for authenticated JS files
  -g IGNORE, --ignore IGNORE
                        Ignore js url, if it contain the provided string
                        (string;string2..)
  -n ONLY, --only ONLY  Process js url, if it contain the provided string
                        (string;string2..)
  -H HEADERS, --headers HEADERS
                        Set headers ("Name:Value\nName:Value")
  -p PROXY, --proxy PROXY
                        Set proxy (host:port)

```

実装側の `add_argument` 定義（逐語、既定値まで含む）:

```python
    parser.add_argument("-e","--extract",help="Extract all javascript links located in a page and process it",action="store_true",default=False)
    parser.add_argument("-i","--input",help="Input a: URL, file or folder",required="True",action="store")
    parser.add_argument("-o","--output",help="Where to save the file, including file name. Default: output.html",action="store", default="output.html")
    parser.add_argument("-r","--regex",help="RegEx for filtering purposes against found endpoint (e.g: ^/api/)",action="store")
    parser.add_argument("-b","--burp",help="Support burp exported file",action="store_true")
    parser.add_argument("-c","--cookie",help="Add cookies for authenticated JS files",action="store",default="")
    parser.add_argument("-g","--ignore",help="Ignore js url, if it contain the provided string (string;string2..)",action="store",default="")
    parser.add_argument("-n","--only",help="Process js url, if it contain the provided string (string;string2..)",action="store",default="")
    parser.add_argument("-H","--headers",help="Set headers (\"Name:Value\\nName:Value\")",action="store",default="")
    parser.add_argument("-p","--proxy",help="Set proxy (host:port)",action="store",default="")
```

オプション一覧表（LinkFinder との対応付き）:

| Short | Long | 型 | 既定 | 説明 | LinkFinderとの関係 |
|---|---|---|---|---|---|
| `-h` | `--help` | — | — | ヘルプ | 同じ |
| `-e` | `--extract` | フラグ | False | ページ内の全JavaScriptリンクを抽出して処理する | LinkFinder の `-d/--domain` に相当（実装は lxml XPath で `//script/@src`） |
| `-i` | `--input` | store（必須） | — | URL / ファイル / フォルダ | 同じ |
| `-o` | `--output` | store | `output.html` | 保存先（ファイル名含む）。`cli` で STDOUT | 同じ |
| `-r` | `--regex` | store | なし | **SecretFinderでは意味が違う**: 指定した正規表現が `_regex` 辞書に `custom_regex` として**追加**される（LinkFinderは結果の絞り込みフィルタ） | 挙動が異なる |
| `-b` | `--burp` | フラグ | False | Burpのエクスポートファイルに対応 | 同じ |
| `-c` | `--cookie` | store | `""` | 認証済みJSファイル用のCookie（**単数形 `--cookie`**、LinkFinderは `--cookies`） | 名前が異なる |
| `-g` | `--ignore` | store | `""` | JS URL が指定文字列を含むなら無視。`;` 区切りで複数 | LinkFinderに無い |
| `-n` | `--only` | store | `""` | JS URL が指定文字列を含むものだけ処理。`;` 区切りで複数 | LinkFinderに無い |
| `-H` | `--headers` | store | `""` | ヘッダ設定 `"Name:Value\nName:Value"` | LinkFinderに無い |
| `-p` | `--proxy` | store | `""` | プロキシ設定 `host:port` | LinkFinderに無い |

`-t/--timeout` は SecretFinder には存在しない（requests の既定＝無制限）。

### B-3. インストール（README、逐語）

SecretFinder supports Python 3.

```
$ git clone https://github.com/m4ll0k/SecretFinder.git secretfinder
$ cd secretfinder
$ python -m pip install -r requirements.txt or pip install -r requirements.txt
$ python3 SecretFinder.py
```

`requirements.txt` の全文（逐語、`requests` の後に行末空白あり）:

```
requests_file
requests 
jsbeautifier
lxml
```

LinkFinder が標準ライブラリ `urllib` だけで済ませているのに対し、SecretFinder は **requests（HTTP）／requests_file（`file://` アダプタ）／lxml（HTMLパース）** を追加で必要とする。

### B-4. 使用例（READMEの Usage 節、逐語で全件）

- Most basic usage to find the sensitive data with default regex in an online JavaScript file and output the HTML results to results.html:

`python3 SecretFinder.py -i https://example.com/1.js -o results.html`

- CLI/STDOUT output (doesn't use jsbeautifier, which makes it very fast):

`python3 SecretFinder.py -i https://example.com/1.js -o cli`

- Analyzing an entire domain and its JS files:

`python3 SecretFinder.py -i https://example.com/ -e`

- Ignore certain js file (like external libs) provided by `-g --ignore`

`python3 SecretFinder.py -i https://example.com/ -e -g 'jquery;bootstrap;api.google.com'`

- Process only certain js file provided by `-n --only`:

`python3 SecretFinder.py -i https://example.com/ -e -n 'd3i4yxtzktqr9n.cloudfront.net;www.myexternaljs.com'`

- Use your regex:

`python3 SecretFinder.py -i https://example.com/1.js -o cli -r 'apikey=my.api.key[a-zA-Z]+'`

- Other options: add headers,proxy and cookies:

``python3 SecretFinder.py -i https://example.com/ -e -o cli -c 'mysessionid=111234' -H 'x-header:value1\nx-header2:value2' -p 127.0.0.1:8080 -r 'apikey=my.api.key[a-zA-Z]+'``

### B-5. 受け付ける入力の種類（README、逐語）

- Input accept all this entries:

 - Url: e.g. https://www.google.com/ [-e] is required
 - Js url: e.g. https://www.google.com/1.js
 - Folder: e.g. myjsfiles/*
 - Local file: e.g /js/myjs/file.js

**HTMLページを渡す場合は `-e` が必須**という点が重要（`-e` 無しでHTMLを渡すと、そのHTML本文自体に正規表現を当てるだけになる）。

`parser_input` の実装（逐語）:

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

LinkFinder版との差: Burpファイルのパース失敗時に例外内容を `print` して `sys.exit()` する、ワイルドカード展開でディレクトリを除外しない（LinkFinderは `os.path.isfile` で絞る）。Burpファイルの形式（XML、`<response>` がbase64、`<url>`）は同一。

### B-6. 検出対象の正規表現（READMEの "add Regex" 節、逐語）

READMEは「`SecretFinder.py` を開いて自分の正規表現を追加せよ」と指示し、以下のコードを示す。**これはREADMEに載っているバージョンであり、実際の `SecretFinder.py` とは差分がある（B-7参照）。**

```py
_regex = {
    'google_api'     : r'AIza[0-9A-Za-z-_]{35}',
    'google_captcha' : r'6L[0-9A-Za-z-_]{38}|^6[0-9a-zA-Z_-]{39}$',
    'google_oauth'   : r'ya29\.[0-9A-Za-z\-_]+',
    'amazon_aws_access_key_id' : r'A[SK]IA[0-9A-Z]{16}',
    'amazon_mws_auth_toke' : r'amzn\\.mws\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    'amazon_aws_url' : r's3\.amazonaws.com[/]+|[a-zA-Z0-9_-]*\.s3\.amazonaws.com',
    'facebook_access_token' : r'EAACEdEose0cBA[0-9A-Za-z]+',
    'authorization_basic' : r'basic\s*[a-zA-Z0-9=:_\+\/-]+',
    'authorization_bearer' : r'bearer\s*[a-zA-Z0-9_\-\.=:_\+\/]+',
    'authorization_api' : r'api[key|\s*]+[a-zA-Z0-9_\-]+',
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

    'name_for_my_regex' : r'my_regex',
    # for example
    'example_api_key'    : r'^example\w+{10,50}'
}

```

つまりカスタム検出ルールの追加方法は「**`_regex` 辞書に `'名前' : r'正規表現'` の1行を足す**」だけである。名前はHTML出力・CLI出力の見出しになる（後述、`_` は空白に置換される）。

### B-7. 実装版 `_regex` の全31エントリ（`SecretFinder.py` master、逐語）

**これが実際に動くルールセットである。**

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

**READMEと実装の差分（教科書に書くべき点）**:

| 項目 | README版 | 実装版（master） |
|---|---|---|
| `firebase` | 無い | **ある** `AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}` |
| `amazon_aws_url2` | 無い | **ある**（S3のURL形5パターン） |
| `slack_token` | 無い | **ある** `\"api_token\":\"(xox[a-zA-Z]-[a-zA-Z0-9-]+)\"` |
| `SSH_privKey` | 無い | **ある**（BEGIN〜END を丸ごと捕まえる） |
| `Heroku API KEY` | 無い | **ある**（UUID形） |
| `possible_Creds` | 無い | **ある**（password/pwd/passwd の代入形） |
| `authorization_basic` | `basic\s*[a-zA-Z0-9=:_\+\/-]+` | `basic [a-zA-Z0-9=:_\+\/-]{5,100}` （**長さ上限5〜100に変更**） |
| `authorization_bearer` | `bearer\s*[a-zA-Z0-9_\-\.=:_\+\/]+` | `bearer [a-zA-Z0-9_\-\.=:_\+\/]{5,100}` |
| `authorization_api` | `api[key|\s*]+[a-zA-Z0-9_\-]+` | `api[key|_key|\s+]+[a-zA-Z0-9_\-]{5,100}` |
| プレースホルダ | `name_for_my_regex`, `example_api_key` を含む | 含まない |

### B-8. 検出対象一覧表（実装版31ルールの完全な表）

| # | ルール名（出力見出しは `_`→空白） | 正規表現（逐語） | 何を狙っているか |
|---|---|---|---|
| 1 | `google_api` | `AIza[0-9A-Za-z-_]{35}` | Google API キー（`AIza` プレフィクス＋35文字） |
| 2 | `firebase` | `AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}` | Firebase Cloud Messaging のサーバキー（`AAAA`＋7文字＋`:`＋140文字） |
| 3 | `google_captcha` | `6L[0-9A-Za-z-_]{38}\|^6[0-9a-zA-Z_-]{39}$` | reCAPTCHA のサイト/シークレットキー |
| 4 | `google_oauth` | `ya29\.[0-9A-Za-z\-_]+` | Google OAuth アクセストークン |
| 5 | `amazon_aws_access_key_id` | `A[SK]IA[0-9A-Z]{16}` | AWS アクセスキーID（`AKIA`／`ASIA`＋16文字） |
| 6 | `amazon_mws_auth_toke` | `amzn\\.mws\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` | Amazon MWS 認証トークン（※名前の綴りは原文どおり "toke"） |
| 7 | `amazon_aws_url` | `s3\.amazonaws.com[/]+\|[a-zA-Z0-9_-]*\.s3\.amazonaws.com` | S3 バケットURL |
| 8 | `amazon_aws_url2` | `([a-zA-Z0-9-\.\_]+\.s3\.amazonaws\.com\|s3://[a-zA-Z0-9-\.\_]+\|s3-[a-zA-Z0-9-\.\_\/]+\|s3.amazonaws.com/[a-zA-Z0-9-\.\_]+\|s3.console.aws.amazon.com/s3/buckets/[a-zA-Z0-9-\.\_]+)` | S3 の各種URL表記（仮想ホスト形式・`s3://`・`s3-`・パス形式・コンソールURL） |
| 9 | `facebook_access_token` | `EAACEdEose0cBA[0-9A-Za-z]+` | Facebook アクセストークン |
| 10 | `authorization_basic` | `basic [a-zA-Z0-9=:_\+\/-]{5,100}` | `Authorization: Basic <base64>` のハードコード |
| 11 | `authorization_bearer` | `bearer [a-zA-Z0-9_\-\.=:_\+\/]{5,100}` | `Authorization: Bearer <token>` のハードコード |
| 12 | `authorization_api` | `api[key\|_key\|\s+]+[a-zA-Z0-9_\-]{5,100}` | `apikey=`, `api_key=` 等に続く値 |
| 13 | `mailgun_api_key` | `key-[0-9a-zA-Z]{32}` | Mailgun APIキー |
| 14 | `twilio_api_key` | `SK[0-9a-fA-F]{32}` | Twilio APIキー |
| 15 | `twilio_account_sid` | `AC[a-zA-Z0-9_\-]{32}` | Twilio アカウントSID |
| 16 | `twilio_app_sid` | `AP[a-zA-Z0-9_\-]{32}` | Twilio アプリSID |
| 17 | `paypal_braintree_access_token` | `access_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}` | PayPal/Braintree 本番アクセストークン |
| 18 | `square_oauth_secret` | `sq0csp-[ 0-9A-Za-z\-_]{43}\|sq0[a-z]{3}-[0-9A-Za-z\-_]{22,43}` | Square OAuth シークレット |
| 19 | `square_access_token` | `sqOatp-[0-9A-Za-z\-_]{22}\|EAAA[a-zA-Z0-9]{60}` | Square アクセストークン |
| 20 | `stripe_standard_api` | `sk_live_[0-9a-zA-Z]{24}` | Stripe 本番シークレットキー |
| 21 | `stripe_restricted_api` | `rk_live_[0-9a-zA-Z]{24}` | Stripe 制限キー |
| 22 | `github_access_token` | `[a-zA-Z0-9_-]*:[a-zA-Z0-9_\-]+@github\.com*` | GitHub の URL 埋め込み認証情報 |
| 23 | `rsa_private_key` | `-----BEGIN RSA PRIVATE KEY-----` | RSA秘密鍵のヘッダ |
| 24 | `ssh_dsa_private_key` | `-----BEGIN DSA PRIVATE KEY-----` | DSA秘密鍵 |
| 25 | `ssh_dc_private_key` | `-----BEGIN EC PRIVATE KEY-----` | EC秘密鍵（名前の綴りは原文どおり `ssh_dc_`） |
| 26 | `pgp_private_block` | `-----BEGIN PGP PRIVATE KEY BLOCK-----` | PGP秘密鍵ブロック |
| 27 | `json_web_token` | `ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$` | JWT（`ey` で始まるbase64url 3パート） |
| 28 | `slack_token` | `\"api_token\":\"(xox[a-zA-Z]-[a-zA-Z0-9-]+)\"` | JSON中の `"api_token":"xox?-..."` 形の Slack トークン |
| 29 | `SSH_privKey` | `([-]+BEGIN [^\s]+ PRIVATE KEY[-]+[\s]*[^-]*[-]+END [^\s]+ PRIVATE KEY[-]+)` | 秘密鍵ブロック全体（種類を問わず） |
| 30 | `Heroku API KEY` | `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` | Heroku APIキー（UUID形） |
| 31 | `possible_Creds` | `(?i)(password\s*[`=:\"]+\s*[^\s]+\|password is\s*[`=:\"]*\s*[^\s]+\|pwd\s*[`=:\"]*\s*[^\s]+\|passwd\s*[`=:\"]+\s*[^\s]+)` | `password = ...`, `password is ...`, `pwd:...`, `passwd="..."` 等の平文パスワード |
| +1 | `custom_regex` | `-r` の値 | 実行時に辞書へ追加される |

**誤検出（false positive）が構造的に多いルール**として、教科書では特に次を挙げるべきである:

- `Heroku API KEY` は**任意のUUID**にマッチする。JSバンドル内のUUIDは山ほどあるため、ほぼ常にノイズを出す。
- `json_web_token` は `ey` で始まる base64url 風文字列に広くマッチする。末尾 `$` があるため VERBOSE/複数行の扱いに依存する。
- `authorization_api` の `api[key|_key|\s+]+` は**文字クラス**なので、`a`,`p`,`i` の後に `k`,`e`,`y`,`|`,`_`,空白 のいずれかが1個以上続けばよく、意図した「apikey または api_key」より広くマッチする（正規表現の書き方としては文字クラスと選択（`(?:key|_key)`）の混同）。
- `possible_Creds` は `password:` 等の**キー名だけの出現**でも後続の非空白文字を拾うため、ライブラリのバリデーションメッセージなどを大量に拾う。
- `twilio_account_sid` / `twilio_app_sid` / `twilio_api_key` は 2文字プレフィクス＋32文字なので、ハッシュ値に偶然マッチしうる。

〔補足（一般知識）〕Python の `re.VERBOSE`（後述のとおり SecretFinder は `re.VERBOSE|re.I` でコンパイルする）では、**文字クラスの外にある未エスケープの空白文字がパターンから無視される**。そのため `'basic [a-zA-Z0-9=:_\+\/-]{5,100}'` の `basic` と `[` の間の空白は無効化され、実質 `basic[a-zA-Z0-9...]{5,100}` として動く（`Basic dXNlcjpwYXNz` のような空白区切りの実物より、`basicXXXX...` のような連続形に当たりやすくなる）。一方 `sq0csp-[ 0-9A-Za-z\-_]{43}` のように**文字クラス内の空白は保持される**。`re.I` が付くため全ルールは大文字小文字を区別しない（`AIza`／`Bearer`／`BEGIN RSA PRIVATE KEY` 等も大小混在で当たる）。

### B-9. 解析本体：`parser_file` と `getContext`（逐語）

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

LinkFinder の `getContext` とは全く違う実装。**マッチ文字列の前後を `.+?`（既定の `rex`）で挟んだ正規表現を作り直して `re.findall` でコンテキストを再検索する**。同じ値が複数箇所に出ていれば `context` が複数件になり `multi_context` が True になる。

〔補足（一般知識）〕この方式は、マッチ文字列に正規表現メタ文字（`.`, `+`, `$`, `(`, `[` 等）が含まれていると再コンパイルが崩れる（`re.escape` していない）。秘密鍵ヘッダやJWTは `.` や `+` を含むため、コンテキストが取れない・意図しない箇所に当たることがある。

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
        if items != []:
            all_items.append(items)
    if all_items != []:
        k = []
        for i in range(len(all_items)):
            for ii in all_items[i]:
                if ii not in k:
                    k.append(ii)
        if k != []:
            all_items = k

    if no_dup:
        all_matched = set()
        no_dup_items = []
        for item in all_items:
            if item != [] and type(item) is dict:
                if item['matched'] not in all_matched:
                    all_matched.add(item['matched'])
                    no_dup_items.append(item)
        all_items = no_dup_items

    filtered_items = []
    if all_items != []:
        for item in all_items:
            if more_regex:
                if re.search(more_regex,item['matched']):
                    filtered_items.append(item)
            else:
                filtered_items.append(item)
    return filtered_items
```

要点:

- **閾値1,000,000文字は LinkFinder と同じ**。超えたら `;`→`;\r\n`、`,`→`,\r\n` の軽量整形のみ。
- `_regex` の**全ルールを1本ずつループで当てる**（LinkFinder のように1本の巨大正規表現ではない）。ルール数×コンテンツ長のコストがかかる。
- 採用するのは **`m.group(0)`（マッチ全体）**。LinkFinder が `group(1)` を使うのと違い、`slack_token` のようにキャプチャグループを持つルールでも `"api_token":"xox..."` 全体が `matched` になる。
- 重複排除は `matched` 値単位。
- `more_regex` は `parser_file(file, mode)` の呼び出しでは渡されていない（`main` 内の呼び出しは `matched = parser_file(file,mode)`）。`-r` は `_regex` への追加として作用する。

〔補足（一般知識）〕`mode == 1` のとき `all_items.append(items)` が**if文の中と外で2回実行される**ため同じ結果が二重に積まれる（後段の `k` 構築と `no_dup` で吸収される）。また `no_dup` ブロックは `type(item) is dict` の要素だけを残すため、`mode == 0`（`-o cli`）でリスト構造が残っていると落ちる可能性がある構造になっている。教科書では「このツールは実務では `-o cli` で使われることが多いが、実装は粗いので出力を鵜呑みにせず必ず手で確認する」という注意として書くのが妥当。

### B-10. `-e/--extract`：HTMLからJSを列挙する（逐語）

```python
def urlParser(url):
    ''' urlParser '''
    parse = urlparse(url)
    urlParser.this_root = parse.scheme + '://' + parse.netloc
    urlParser.this_path = parse.scheme + '://' + parse.netloc  + '/' + parse.path

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

仕様:

- **lxml の `html.fromstring` で HTML をパースし、XPath `//script` の `@src` を収集**。LinkFinder の `-d` が正規表現任せなのに対し、こちらは本物のHTMLパーサを使う（`<script>` インライン本文は対象外＝`src` 属性のあるものだけ）。
- URL の絶対化ルール: `http://`/`https://`/`ftp://`/`ftps://` 始まりはそのまま／`//` 始まりは **`http://` を前置**（httpsではない点に注意）／`/` 始まりは `scheme://netloc` を前置／それ以外は `scheme://netloc/path` を前置。
- `-g/--ignore` は `;` で分割し、**部分一致した src をリストから除去**。`-n/--only` は `;` で分割し、**部分一致した src だけを残す**。実装上 `ignore` が先に評価され、`-g` が指定されていればその時点で return するので **`-g` と `-n` を同時に指定すると `-n` は効かない**。
- 重複は `if src not in all_src` で除去。

`main` 側の分岐（逐語）:

```python
    if args.extract:
        content = send_request(args.input)
        urls = extractjsurl(content,args.input)
    else:
        # convert input to URLs or JS files
        urls = parser_input(args.input)
```

処理ループの先頭で必ず `[ + ] URL: <url>` が標準出力に出る（逐語: `print('[ + ] URL: '+url)`）。これは `-o cli` の結果と混ざるので、パイプ処理時にはこの行を除く必要がある。

### B-11. HTTP取得：`send_request`（逐語）

```python
def send_request(url):
    ''' Send Request '''
    # read local file
    # https://github.com/dashea/requests-file
    if 'file://' in url:
        s = requests.Session()
        s.mount('file://',FileAdapter())
        return s.get(url).content.decode('utf-8','replace')
    # set headers and cookies
    headers = {}
    default_headers = {
        'User-Agent'      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
        'Accept'          : 'text/html, application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language' : 'en-US,en;q=0.8',
        'Accept-Encoding' : 'gzip'
    }
    if args.headers:
        for i in args.header.split('\\n'):
            # replace space and split
            name,value = i.replace(' ','').split(':')
            headers[name] = value
    # add cookies
    if args.cookie:
        headers['Cookie'] = args.cookie

    headers.update(default_headers)
    # proxy
    proxies = {}
    if args.proxy:
        proxies.update({
            'http'  : args.proxy,
            'https' : args.proxy,
            # ftp
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

既定ヘッダ（逐語、LinkFinderとほぼ同一だが行継続による余分な空白がない）:

| ヘッダ | 値 |
|---|---|
| `User-Agent` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36` |
| `Accept` | `text/html, application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8` |
| `Accept-Language` | `en-US,en;q=0.8` |
| `Accept-Encoding` | `gzip` |

重要な実装事実:

- **`verify = False`**。冒頭で `urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)` も実行しているので、**TLS証明書の検証を行わず警告も出さない**。自己署名のステージング環境をそのまま叩けるが、通信の安全性はツール側で担保されない。
- `-p/--proxy` は `http` と `https` の両方に同じ値を設定する（コメント `# ftp` はftp未対応の名残）。**Burp Suite を `127.0.0.1:8080` で挟んで全リクエストを記録する運用ができる**（READMEの例そのまま）。
- `file://` を含むURLは `requests_file` の `FileAdapter` を `requests.Session` に `mount` して読む。
- `-c/--cookie` の値は `Cookie` ヘッダにそのまま入る。
- **`headers.update(default_headers)` がユーザ指定ヘッダの後に実行される**ため、`-H` で `User-Agent` などを上書きしようとしても既定値に戻される。
- `-H` のパース行は `for i in args.header.split('\\n'):` と書かれており、argparse の属性名は `args.headers` である。〔補足（一般知識）〕Namespace には `header` という属性が作られないため、`-H` を指定すると `AttributeError` になる実装上の不整合がある。また `i.replace(' ','')` で**ヘッダ値からすべての空白を除去**してから `:` で split するので、空白を含む値は壊れ、値に `:` を含むヘッダ（例: 時刻やURL）は `ValueError` になる。教科書では「`-H` は現状あてにせず、代わりに `-p` で Burp/mitmproxy を挟んでヘッダを差し替える」という回避策を示すのが実用的。

### B-12. `-r` のカスタム正規表現の扱い（逐語）

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

- **検証方法が独特**: 長さ10〜50のランダムな英大文字＋数字の文字列に対して `re.search` を試し、例外が出たら `your python regex isn't valid` と表示して終了する（＝コンパイル可能性の確認）。
- 検証を通ると `_regex` に **`custom_regex` という名前で追加**される。ヘルプ文は LinkFinder から引き継いだ "RegEx for filtering purposes against found endpoint (e.g: ^/api/)" のままだが、**実際の意味はフィルタではなく「検出ルールの追加」**である。この食い違いは教科書で明示すべき重要な落とし穴。
- 追加できるのは1本だけ（同名キーなので上書き）。複数入れたい場合は `SecretFinder.py` の `_regex` を直接編集する（READMEの "add Regex" 節の指示どおり）。

### B-13. 出力：CLIとHTML（逐語）

```python
def cli_output(matched):
    ''' cli output '''
    for match in matched:
        print(match.get('name')+'\t->\t'+match.get('matched').encode('ascii','ignore').decode('utf-8'))
```

**CLI出力形式は `<ルール名>\t->\t<マッチした値>`**。タブ区切りなので `cut -f1`/`cut -f3` で機械処理しやすい。非ASCII文字は落ちる。

HTML出力のテンプレート `_template` は Python ファイル内に文字列として埋め込まれている（LinkFinder は外部 `template.html`）。**LinkFinder の `template.html` とCSSはほぼ同一だが、プレースホルダが `$content` ではなく `$$content$$`、issue リンク先が SecretFinder、`<title>` は `LinkFinder Output` のまま**である点が実装事実として重要。

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

`html_save` と HTML断片の組み立て（逐語）:

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

要点: 見出しは **ルール名の `_` を空白に置換したもの**（`google_api` → `google api`）。コンテキストは `<span style="background-color:yellow">` で黄色ハイライト。`multi_context` が True のときは重複を除いた全コンテキストを並べる。

〔補足（一般知識）〕LinkFinder は `html.escape` をコンテキストにも適用するが、**SecretFinder はコンテキスト文字列を `escape()` せずにHTMLへ直接埋め込んでいる**（`escape` を通しているのはファイルURLのみ）。解析対象JSの中身が出力HTMLにそのまま入るため、生成された `output.html` をブラウザで開く行為自体に自己XSSのリスクがある（しかも `<body contenteditable="true">`）。診断用ホストで開く、あるいは `-o cli` を使うのが安全という注意を教科書に入れるべき。

### B-14. Burp Suite 拡張：`BurpSuite-SecretFinder/`

`BurpSuite-SecretFinder/README.md`（逐語の要点）:

> ## Burp Suite - Secret Finder (beta v0.1)
>
> A Burp Suite extension to help pentesters to discover a apikeys,accesstokens and more sensitive data using a regular expressions. SecretFinder process any HTTP response (support javascript file) and support Passive and Active scan. This extension has been developed by (@m4ll0k).

- **バージョンは beta v0.1**。
- **任意のHTTPレスポンスを処理する**（JavaScriptファイルにも対応）。**Passive scan と Active scan の両方をサポート**。
- Add RegEx: 「SecretFinder をダウンロードして任意のエディタで開く」「正規表現を追加してファイルを保存する」。図は `https://i.imgur.com/LBtfhkt.png`。
- Example: `https://i.imgur.com/unM06Hg.png`。
- Install: 「`SecretFinder` をダウンロードする」。手順GIFは `https://i.imgur.com/nIPR037.gif`。
- **Requirements: `jython` と `burpsuite`**（Burpの Extender で Python 環境として Jython の standalone JAR を指定する必要がある）。

拡張本体 `BurpSuite-SecretFinder/SecretFinder.py` の構造（逐語引用と解説）。クレジットコメント:

```python
# SecretFinder: Burp Suite Extension to find and search apikeys/tokens from a webpage
# by m4ll0k
# https://github.com/m4ll0k

# Code Credits:
# OpenSecurityResearch CustomPassiveScanner: https://github.com/OpenSecurityResearch/CustomPassiveScanner
# PortSwigger example-scanner-checks: https://github.com/PortSwigger/example-scanner-checks
# https://github.com/redhuntlabs/BurpSuite-Asset_Discover/blob/master/Asset_Discover.py
```

使用するBurp API:

```python
from burp import IBurpExtender
from burp import IScannerCheck
from burp import IScanIssue
from array import array
import re
import binascii
import base64
import xml.sax.saxutils as saxutils
```

登録処理（逐語）:

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

拡張名は `SecretFinder`。`registerScannerCheck(self)` でスキャナチェックとして登録。`consolidateDuplicateIssues` は Issue Detail が同一なら `-1`（既存を保持）を返す。

**Burp版の正規表現辞書は CLI 版と別物で、37エントリある（逐語・全文）**:

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

**CLI版（31件）との差分**:

- Burp版のみ: `docs_file_exetension`（綴り原文どおり）, `bitcoin_address`, `slack_api_key`（`xox.-[0-9]{12}-[0-9]{12}-[0-9a-zA-Z]{24}`）, `us_cn_zipcode`, `google_cloud_platform_auth`, `google_cloud_platform_api`, `amazon_secret_key`（`[0-9a-zA-Z/+]{40}` — 40文字のbase64風文字列すべてに当たる超広域ルール）, `gmail_auth_token`, `github_auth_token`（`[0-9a-fA-F]{40}` — SHA-1ハッシュ全部に当たる）, `Instagram_token`, `twitter_access_token`
- CLI版のみ: `amazon_aws_url2`, `slack_token`（JSON形）, `SSH_privKey`, `Heroku API KEY`, `possible_Creds`
- `authorization_basic`/`bearer`/`api` は Burp 版は**長さ上限なしの README 版と同じ書き方**
- `json_web_token` は Burp 版が別定義: `ey[A-Za-z0-9_-]*\.[A-Za-z0-9._-]*|ey[A-Za-z0-9_\/+-]*\.[A-Za-z0-9._\/+-]*`（末尾 `$` なし）
- 〔補足（一般知識）〕Burp版の `gmail_auth_token` は `[0-9(+-[0-9A-Za-z_]{32}.apps.qooqleusercontent.com` と、角括弧が閉じておらずドメイン名も "qooqleusercontent"（`googleusercontent` のtypo）になっている。`twitter_access_token` の `[1-9][ 0-9]+-(0-9a-zA-Z]{40}` も括弧の対応が壊れている。これらは**そのままでは意図どおりに動かない（あるいはコンパイルエラー/意図外のマッチになる）**ため、拡張を使う場合は自分で修正する前提で読むべき。

**マッチを「値らしい文脈」に限定するラッパ正規表現とIssue定義（逐語）**:

```python
    regex = r"[:|=|\'|\"|\s*|`|´| |,|?=|\]|\|//|/\*}](%%regex%%)[:|=|\'|\"|\s*|`|´| |,|?=|\]|\}|&|//|\*/]"
    issuename = "SecretFinder: %s"
    issuelevel = "Information"
    issuedetail = r"""Potential Secret Find: <b>%%regex%%</b>
    <br><br><b>Note:</b> Please note that some of these issues could be false positives, a manual review is recommended."""
```

- 各ルールは `%%regex%%` の位置に差し込まれ、**前後がデリミタ（`:` `=` `'` `"` 空白 `` ` `` `´` `,` `]` `}` `&` `//` `/*` `*/` など）である**ことを要求する形に組み立てられる。これが「JSONやJSの値として書かれている箇所だけを拾う」ための工夫。
- **Issue名は `SecretFinder: <名前>`**。名前は `' '.join([x.title() for x in reg[0].split('_')])` により `google_api` → `Google Api` のように整形される（逐語: `BurpExtender.issuename%(' '.join([x.title() for x in reg[0].split('_')]))`）。
- **Severity は `Information` 固定、Confidence は `Tentative` 固定**（`getConfidence` が `return "Tentative"`）。
- Issue詳細本文は `Potential Secret Find: <b>…</b>` に続いて「これらのIssueの一部は誤検出（false positives）の可能性があるので手動レビューを推奨する」という注意書きが必ず付く。

Passive / Active の実体（逐語、両者は同一内容）:

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

`doPassiveScan(self, baseRequestResponse)` も**まったく同じロジック**（引数 `pa` が無いだけ）。つまり Passive スキャンだけでも全ルールが走る＝**プロキシを通しただけで検出が動く**。

検出処理 `CustomScans.findRegEx`（逐語）:

```python
class CustomScans:
    def __init__(self, requestResponse, callbacks):
        self._requestResponse = requestResponse
        self._callbacks = callbacks
        self._helpers = self._callbacks.getHelpers()
        self._mime_type = self._helpers.analyzeResponse(self._requestResponse.getResponse()).getStatedMimeType()
        return

    def findRegEx(self, regex, issuename, issuelevel, issuedetail):
        print(self._mime_type)
        if '.js' in str(self._requestResponse.getUrl()):
            print(self._mime_type)
            print(self._requestResponse.getUrl())
        scan_issues = []
        offset = array('i', [0, 0])
        response = self._requestResponse.getResponse()
        responseLength = len(response)

        if self._callbacks.isInScope(self._helpers.analyzeRequest(self._requestResponse).getUrl()):
            myre = re.compile(regex, re.VERBOSE)
            encoded_resp=binascii.b2a_base64(self._helpers.bytesToString(response))
            decoded_resp=base64.b64decode(encoded_resp)
            decoded_resp = saxutils.unescape(decoded_resp)

            match_vals = myre.findall(decoded_resp)

            for ref in match_vals:
                url = self._helpers.analyzeRequest(self._requestResponse).getUrl()
                offsets = []
                start = self._helpers.indexOf(response,
                                    ref, True, 0, responseLength)
                offset[0] = start
                offset[1] = start + len(ref)
                offsets.append(offset)

                try:
                    print("%s : %s"%(issuename.split(':')[1],ref))
                    scan_issues.append(ScanIssue(self._requestResponse.getHttpService(),
                        self._helpers.analyzeRequest(self._requestResponse).getUrl(),
                        [self._callbacks.applyMarkers(self._requestResponse, None, offsets)],
                        issuename, issuelevel, issuedetail.replace(r"%%regex%%", ref)))
                except:
                    continue
        return (scan_issues)
```

要点:

- **`isInScope()` によりBurpのターゲットスコープ内のURLだけを検査する**。運用上、まずスコープ設定を正しく入れることが前提。
- レスポンスは `binascii.b2a_base64` → `base64.b64decode` を経て（実質的にバイト列の往復）、`xml.sax.saxutils.unescape` でXML実体参照を戻してから正規表現を当てる。`&amp;quot;` 等でエスケープされたJSON中のトークンも拾える狙い。
- `re.compile(regex, re.VERBOSE)` — CLI版と違い `re.I` は付かない。**Burp版は大文字小文字を区別する**。
- `applyMarkers(self._requestResponse, None, offsets)` により、Burpの Issue 画面でレスポンス中の該当箇所がハイライトされる。
- `print(...)` が複数あり、**Burpの Extender → Output タブに MIME タイプや `.js` のURL、`<ルール名> : <マッチ値>` が逐次出力される**。

`ScanIssue` クラスは `IScanIssue` の実装で、`getIssueType()` は `0`、`getRemediationDetail()` / `getIssueBackground()` / `getRemediationBackground()` は `None`、`getConfidence()` は `"Tentative"` を返す。

### B-15. Dockerfile（SecretFinder、逐語・全文）

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
- 冒頭コメントが**公式のバッチ実行レシピ**である（逐語）:

```
while read url; do docker run -t wfnintr/secretfinder -i $url -o cli | tee -a js_results.txt;done < urls.txt
```

- lxml のビルドに `libxml2-dev`, `libxslt-dev`, `build-base`, `gcc`, `python3-dev` が必要で、ビルド後に `apk del build-deps` で削っている。

---

# C. 実務での使い方 — `cat *.js | grep` の代替として

〔このセクションは、原文（両README・両ソース）に書かれている事実を組み合わせた実務手順である。原文に無い一般知識は個別に印を付ける。〕

### C-1. なぜ grep では足りないのか（原文の根拠から）

- **LinkFinder**: 素朴な `grep -oE "https?://[^\"']+"` はフルURLしか拾えない。LinkFinder の正規表現は「絶対パス `/api/...`」「ドット相対 `../api/...`」「拡張子なしREST `api/v1/user/2`」「スラッシュなしファイル名 `main.js`」まで4カテゴリを網羅し、さらに `UserModel.name` のようなプロパティアクセスを拡張子ホワイトリストで除外する（A-7, A-13）。加えて**jsbeautifier で整形してから当てるため、minified な1行コードでも「行」という単位が生まれ、コンテキスト（周辺コード）付きで結果が読める**（A-10）。これが grep の最大の弱点（1行10万文字のバンドルでは文脈が取れない）を解消する。
- **SecretFinder**: 31本の名前付きルールを一度に当て、結果を「ルール名 → 値」で出す（B-8, B-13）。`grep -i apikey` では `AIza...` も `sk_live_...` も `-----BEGIN RSA PRIVATE KEY-----` も拾えない。

### C-2. 基本の型（原文のコマンドをそのまま使う）

1. 単一JSのエンドポイント抽出（HTML出力・ブラウザで読む）:
   `python linkfinder.py -i https://example.com/1.js -o results.html`
2. 単一JSのエンドポイント抽出（パイプ用・高速）:
   `python linkfinder.py -i https://example.com/1.js -o cli`
3. ページ全体を辿る:
   `python linkfinder.py -i https://example.com -d`
4. `/api/` だけに絞ってローカルのJS群を一括処理:
   `python linkfinder.py -i 'Desktop/*.js' -r ^/api/ -o results.html`
5. Burpで集めたJSをまとめて処理（Target で選択 → 右クリック → `Save selected items`）:
   `python linkfinder.py -i burpfile -b`
6. 同じJSからシークレットを探す:
   `python3 SecretFinder.py -i https://example.com/1.js -o cli`
7. ページ内の全JSに対してシークレット検出、外部ライブラリを除外:
   `python3 SecretFinder.py -i https://example.com/ -e -g 'jquery;bootstrap;api.google.com'`
8. 自社CDNのJSだけに絞る:
   `python3 SecretFinder.py -i https://example.com/ -e -n 'd3i4yxtzktqr9n.cloudfront.net;www.myexternaljs.com'`
9. Burpを経由させて全リクエストを記録しながら実行:
   `python3 SecretFinder.py -i https://example.com/ -e -o cli -c 'mysessionid=111234' -H 'x-header:value1\nx-header2:value2' -p 127.0.0.1:8080 -r 'apikey=my.api.key[a-zA-Z]+'`
10. URLリストをDockerで一括処理（SecretFinder Dockerfile 記載のレシピ）:
    `while read url; do docker run -t wfnintr/secretfinder -i $url -o cli | tee -a js_results.txt;done < urls.txt`

### C-3. 認証が必要なJSの扱い

- LinkFinder: `-c/--cookies`（`Cookie` ヘッダに直入れ、A-9）。
- SecretFinder: `-c/--cookie`（単数形）。`-H` は前述の実装不整合があるため、ヘッダを足したい場合は `-p 127.0.0.1:8080` で Burp/mitmproxy を挟んでプロキシ側で書き換えるのが確実（B-11）。
- LinkFinder Chrome拡張は**ブラウザが実際に読み込んだJSを Cookie 付きで転送する**ので、ログイン後のみ配信されるJSバンドル（管理画面のチャンク等）を取りこぼしにくい（A-14）。

### C-4. 二段構え（LinkFinder → SecretFinder）の運用

〔補足（一般知識）〕両ツールは入力が同じ（JSファイル／URL／ワイルドカード／Burp XML）なので、同じJS集合に対して「エンドポイント抽出」と「シークレット検出」を並行して回すのが定石である。LinkFinder の `-o cli` の出力（1行1エンドポイント）はそのままファジング用のURLリストに、SecretFinder の `-o cli` の出力（`name\t->\tvalue`）は `cut -f3` で値だけ取り出してトリアージリストにできる。ただし LinkFinder の CLI 出力は HTMLエスケープ済み（`&` → `&amp;`）である点に注意が必要（A-12）。

### C-5. 誤検出との付き合い方（原文の注意書きに基づく）

Burp拡張のIssue本文は毎回こう述べている（逐語）: "Please note that some of these issues could be false positives, a manual review is recommended."（これらのIssueの一部は誤検出の可能性があり、手動レビューを推奨する）。Confidence も `Tentative`、Severity も `Information` 固定である。**SecretFinder の出力は「報告物」ではなく「手で確認すべき候補リスト」**として扱うのが原著者の想定である。とくに `Heroku API KEY`（任意のUUID）、`github_auth_token`（任意のSHA-1、Burp版）、`amazon_secret_key`（任意の40文字、Burp版）は構造的にノイズが多い（B-8, B-14）。

〔補足（一般知識）〕検出したキーが本当に有効かどうかは、**そのキーの正当な発行元サービスに対して、許可された範囲内で最小限の検証（例: 読み取り専用APIの呼び出し）を行う**ことで確認する。バグバウンティでは対象プログラムのスコープと規約に従い、他者データへのアクセスや破壊的操作は行わない。公開JSに含まれるキーは「そもそも公開前提の識別子（例: reCAPTCHAサイトキー、Firebase の apiKey）」であることも多いため、**影響（何ができるか）を示せない限り報告価値は低い**という判断軸を持つべきである。

---

## 読者が自分で開くべき資料

両URLとも完全に取得できたため「取得できなかった資料」は無い。ただし以下は**本ノートに含めきれない／画像・動画であるため、読者自身がブラウザで開く価値が高い**。

1. **https://github.com/GerbenJavado/LinkFinder** — README の埋め込みスクリーンショット `https://i.imgur.com/JfcpYok.png`（"LinkFinder in action"）。HTML出力の実際の見た目（黄色ハイライトされたコンテキスト、`contenteditable` なページ）を確認するために見ておくとよい。本ノートはHTML/CSSを逐語収録しているが、見た目そのものは画像でしか分からない。
2. **https://github.com/GerbenJavado/LinkFinder/tree/chrome_extension** — Chrome拡張の `LinkFinder-Extension/popup/popup.js` と `background.js` の実装。本ノートでは README と `http-server.py` を全文収録したが、拡張側のスコープ判定・通知・グラフ描画の実装は未収録。ブラウジング連動型の運用を自作する際の参考になる。
3. **https://github.com/GerbenJavado/LinkFinder/issues** および Pull Request — 正規表現の改善提案（誤検出報告）が集まる場所。最終コミットが2024-04-13のMerge PR #133であることから、正規表現の細かな調整はPR履歴を追うのが早い。
4. **https://github.com/m4ll0k/SecretFinder/tree/master/BurpSuite-SecretFinder** — README中の3枚の画像。`https://i.imgur.com/LBtfhkt.png`（正規表現の追記箇所）、`https://i.imgur.com/unM06Hg.png`（検出例のIssue画面）、`https://i.imgur.com/nIPR037.gif`（Burpへのインストール手順のGIF）。特にGIFは Extender タブでの Jython 設定〜拡張読み込みの流れを視覚的に示しており、初回セットアップで参照する価値がある。
5. **https://github.com/beautify-web/js-beautify** — 両ツールの前処理の心臓部。閾値1MBを超えたときに整形がスキップされる挙動を理解するには、jsbeautifier 側のオプション（インデント、行分割の規則）を知っておくと有利。
6. **https://github.com/dashea/requests-file** — SecretFinder が `file://` を読むために使う `FileAdapter` の実装。ローカルJSの大量処理時の挙動を確認したい場合に。

## 落とし穴・既知の限界（ch04でそのまま注意書きに使える）

1. **LinkFinder はクォートで囲まれた文字列しか拾えない**。`"/api/" + version + "/users"` のような連結や、テンプレートリテラル（バッククォート）で組まれたURLは検出できない（A-7の両端デリミタ `(?:"|')`）。
2. **拡張子ホワイトリストは10種のみ**（`php|asp|aspx|jsp|json|action|html|js|txt|xml`）。`.do`, `.cgi`, `.graphql`, `.api` などは「スラッシュなしファイル名」ルートでは拾えない（A-7選択肢5, A-13）。
3. **1MB超のJSは整形されない**ため、コンテキストが「`;` か `,` で切った断片」になり読みづらくなる（A-10, B-9）。
4. **LinkFinder の `-d` は深さ1**、かつ `.js` で終わるURLのみ、`node_modules`/`jquery.js` は除外（A-11）。SourceMap（`.js.map`）やクエリ付き（`app.js?v=2`）は対象外。
5. **LinkFinder の `-r` は絞り込み、SecretFinder の `-r` は検出ルール追加**。同じ短縮形で意味が逆なので取り違えやすい（A-10 vs B-12）。
6. **SecretFinder は TLS検証を行わない（`verify=False`）**。MITM検出に使えないし、意図せず改竄されたJSを解析する可能性もある（B-11）。
7. **SecretFinder の `-H/--headers` は実装不整合で例外になる**（`args.header` 参照）。さらに値から空白を除去してから `:` で split するので値に空白や `:` を含むヘッダは扱えない（B-11）。
8. **SecretFinder の `-g` と `-n` は併用できない**（`-g` があるとそこで return する、B-10）。
9. **SecretFinder の HTML 出力はコンテキストをエスケープしない**ため、生成した `output.html` を開く際は自己XSSに注意（B-13）。
10. **どちらのツールも完了時にブラウザを自動起動する**（Linux は `xdg-open`）。CI/バッチで回すときは `-o cli` を使うか、ヘッドレス環境での挙動に注意（A-12, B-13）。
11. **LinkFinder は `template.html` をスクリプトと同じディレクトリから読む**（`sys.path[0]`）。インストール方法によってHTML出力が失敗する（A-12）。
12. **Burp拡張は `Information` / `Tentative` 固定**。Burpのスキャン結果を重要度で並べると埋もれるので、Extender の Output タブか Issue 名 `SecretFinder:` でフィルタして見る運用が必要（B-14）。
13. **Burp拡張の正規表現には明らかな綴り・括弧のミスが残っている**（`gmail_auth_token`, `twitter_access_token`）。使う前に読んで直す前提（B-14）。
14. **ライセンスが異なる**: LinkFinder は MIT、SecretFinder 本体は GPLv3、SecretFinder の Burp 拡張ディレクトリは MIT。成果物に組み込む場合は要確認。
