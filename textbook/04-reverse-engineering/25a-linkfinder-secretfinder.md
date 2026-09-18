# LinkFinderでJavaScriptから隠れたエンドポイントを掘り出す

> **この節で分かること**
> - LinkFinder（リンクファインダー）が「なぜ」攻撃対象領域の発見に効くのかを、設計思想から説明できる
> - LinkFinderの中核である1本の大きな正規表現が「何を拾い、何を拾わないか」をテスト付きで説明できる
> - `-i` `-o` `-d` `-r` などのCLIオプションを、READMEと実装の差まで含めて自分で使い分けられる
> - Burp入力・ドメインモード・Chrome拡張といった実運用の使い方を自分で試せる
> - LinkFinderの限界（クォート必須・拡張子ホワイトリスト・1MB閾値）を理解し、誤検出・検出漏れを見抜ける
> - 派生ツールSecretFinder（シークレットファインダー）が何を目的に、どこを作り替えた別物なのかを説明できる

**元資料**: https://github.com/GerbenJavado/LinkFinder （原典取得済み）, https://github.com/m4ll0k/SecretFinder （原典取得済み）
**関連する節**: SecretFinderの検出ルール・Burp拡張の詳細は続く節（25b）で扱う

---

## 1. なぜJavaScriptからエンドポイントを探すのか

### 1-1. 攻撃対象領域（Attack Surface）はJSの中に隠れている

現代のWebアプリは、画面の裏でブラウザ内のJavaScriptがサーバのAPIを呼び出して動く。
そのAPIのURL（エンドポイント）は、HTMLのリンクとして見えるとは限らず、JavaScriptファイルの中に文字列として埋め込まれていることが多い。

エンドポイント（endpoint）とは、アプリがデータをやり取りする「入口となるURLやパス」のこと。
たとえば `/api/v1/user/2` や `/admin/create.php` のような、リクエストを送る宛先を指す。

LinkFinderのREADMEはこのツールの目的を次のように説明する。
JavaScriptファイル中のエンドポイントとそのパラメータを発見することで、ペネトレーションテスターやバグハンターは、テスト対象サイト上の**新たな、隠れたエンドポイント**を収集できる。
結果として新しいテスト対象領域（new testing ground）が得られ、そこには新たな脆弱性が含まれている可能性がある、というものだ。

### 1-2. 「攻撃者はどこを突くのか」の起点

画面を普通に操作しているだけでは、開発者が用意した「表の導線」しか通らない。
だが、JSの中には管理機能・デバッグ用API・旧バージョンの残骸など、UIからは到達しないエンドポイントが残っていることがある。
攻撃者（そして許可を得たバグハンター）は、まずこうした「隠れた入口」を洗い出し、そこから認可不備・パラメータ改ざんといった脆弱性を探す。
LinkFinderは、その最初の一歩である「入口の一覧化」を機械的に行うツールである。

### 1-3. grepではなくLinkFinderを使う理由

素朴には `cat app.js | grep -oE '/[a-z/]+'` のように正規表現でパスを拾うこともできる。
LinkFinderが優れているのは、次の2点である。

- **整形（beautify）してから拾う**ので、圧縮された1行のJS（minified）でも、マッチ箇所の「前後の文脈（コンテキスト）」を人間が読める形で見せてくれる。
- **URLらしい形だけを狙う専用正規表現**を持ち、`UserModel.name` のような「ただのプロパティアクセス」を弾く工夫が入っている。

---

## 2. LinkFinderの全体像

### 2-1. 何でできているか

LinkFinderは Gerben Javado 氏によるMITライセンスのPython 3スクリプトである。
READMEいわく、実現方法は「python向けの jsbeautifier と、かなり大きな1本の正規表現の組み合わせ」だ。

jsbeautifier（ジェイエス・ビューティファイア）とは、圧縮されたJavaScriptを読みやすいインデント付きに整形するライブラリのこと。
LinkFinderはこれでJSを整形してから正規表現を当てる。

### 2-2. 検出する4カテゴリ

READMEは「この正規表現は4つの小さな正規表現から構成される」と述べ、次の4つの責務を挙げている（原文の記法のまま）。

| カテゴリ | 例 | 説明 |
|---|---|---|
| Full URLs | `https://example.com/*` | スキーム付きの完全なURL |
| Absolute URLs or dotted URLs | `/\*` や `../*` | 絶対パス、または `../` `./` で始まるパス |
| Relative URLs with at least one slash | `text/test.php` | スラッシュを1つ以上含む相対URL |
| Relative URLs without a slash | `test.php` | スラッシュを含まないファイル名 |

出力はHTMLかプレーンテキスト。
実装上はこの4カテゴリが5つの選択肢（後述）に展開されている。

### 2-3. 処理の流れ（ASCII図）

```
入力(-i)  ─┬─ URL       → send_request でHTTP取得
           ├─ file://   → ローカル読み込み
           ├─ ワイルドカード(*.js) → glob で複数展開
           └─ Burpファイル(-b) → XMLをパースしbase64デコード
                 │
                 ▼
        parser_file: jsbeautifier で整形（1MB以下のとき）
                 │
                 ▼
        中核の正規表現 regex_str を re.finditer で総当たり
                 │
                 ▼
        group(1) を「リンク」として採用、重複排除
                 │
         ┌───────┴────────┐
         ▼                ▼
   -o cli → 標準出力    -o output.html → 黄色ハイライトHTML＋ブラウザ自動起動
```

---

## 3. インストールと依存関係

### 3-1. 入れ方

READMEは「LinkFinderは Python 3 をサポートする」と明記する。
インストール手順は原文のまま次のとおり。

```bash
$ git clone https://github.com/GerbenJavado/LinkFinder.git
$ cd LinkFinder
$ python setup.py install
```

依存関係は `argparse` と `jsbeautifier` のPythonモジュール。
READMEは「これらの依存関係はすべて pip を使ってインストールできる」と述べる。

```bash
$ pip3 install -r requirements.txt
```

### 3-2. 依存は実質1つだけ

実際の `requirements.txt` の中身は1行だけである。

```text
jsbeautifier
```

`setup.py` の全文は次のとおり。

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

〔補足〕`setup.py` のバージョンは 1.0 固定で、`install_requires` は `jsbeautifier` のみ。
`argparse` は Python 3 の標準ライブラリなので別途インストールは不要である。

### 3-3. Dockerで動かす

READMEはDockerでの実行も示している（原文のまま）。

```bash
docker build -t linkfinder
docker run --rm -v $(pwd):/linkfinder/output linkfinder -i http://example.com/1.js -o /linkfinder/output/output.html
```

READMEは「出力パスには `/linkfinder/output` を使うこと。さもないとコンテナ終了時に出力が失われる」と注意している。

〔補足〕READMEのビルドコマンドはビルドコンテキスト（末尾の `.`）が欠けているため、実際には `docker build -t linkfinder .` と補う必要がある。

`Dockerfile` の全文は次のとおり。

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

ベースは `python:3.7.3-alpine3.9`。
非rootユーザ `linkfinder`（シェルは `/sbin/nologin`）で動き、ENTRYPOINTが `linkfinder.py` なので `docker run <image> -i ... -o ...` のようにオプションだけを渡す設計になっている。

### 3-4. ライセンスと原典メモ

LinkFinderは **MITライセンス**（Copyright (c) 2019 Gerben Janssen van Doorn）で公開されている。MITライセンスとは、著作権表示を残せば改変・再配布・商用利用も自由という、制約のゆるいオープンソースライセンスのこと。
このゆるさが、後述のSecretFinderのように**派生ツールを作り替えて公開すること**を法的に容易にしている。

READMEの末尾（Final remarks）には作者の言葉が残っている。原文の要点は次のとおり。

- これは作者が**初めて公開したツール**であり、貢献（Contributions）を歓迎する。
- LinkFinderは前掲のMITライセンスで公開されている。
- フィードバックをくれた [@jackhcable](https://twitter.com/jackhcable) への謝辞。
- プロジェクトをずっと綺麗で良いものにしてくれた [@edoverflow](https://twitter.com/edoverflow) への特別な感謝。

〔補足〕本教科書の執筆時に実際にクローンして確認した原典の実測情報は次のとおり。教科書本文の理解には不要だが、「どの時点のコードを読んだか」を明確にするために記録しておく。

| 項目 | 値 |
|---|---|
| デフォルトブランチ | `master` |
| ブランチ一覧 | `master`, `chrome_extension`（前者が本体、後者が節12のChrome拡張） |
| 取得時点の最終コミット | `1debac5dace4724fd6187c06f133578dae51c86f`（2024-04-13） |

なおSecretFinder側は本体がGPLv3、同梱のBurp拡張ディレクトリだけがMITという二重ライセンスになっているが、その詳細は続く節（25b）で扱う。

---

## 4. CLIオプション（READMEと実装の差を押さえる）

### 4-1. READMEの表

READMEに載っている全オプションは次の7つである（原文のまま）。

| Short | Long | Description |
|---|---|---|
| `-i` | `--input` | Input a: URL, file or folder. For folders a wildcard can be used (e.g. '/*.js'). |
| `-o` | `--output` | "cli" to print to STDOUT, otherwise where to save the HTML file Default: output.html |
| `-r` | `--regex` | RegEx for filtering purposes against found endpoints (e.g. ^/api/) |
| `-d` | `--domain` | Toggle to use when analyzing an entire domain. Enumerates over all found JS files. |
| `-b` | `--burp` | Toggle to use when inputting a Burp 'Save selected' file containing multiple JS files |
| `-c` | `--cookies` | Add cookies to the request |
| `-h` | `--help` | show the help message and exit |

### 4-2. 実装にはREADMEにない `-t/--timeout` がある

`linkfinder.py` の argparse 定義を読むと、READMEにない `-t/--timeout` が追加されている。
以下は実装の逐語引用である。

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

### 4-3. 実装から読み取れる差分の一覧

| オプション | 型 | 既定値 | 注意点 |
|---|---|---|---|
| `-d, --domain` | フラグ | False | 値を取らないトグル。ドメイン自体は `-i` に渡す |
| `-i, --input` | store | 必須 | URL / ファイル / フォルダ（ワイルドカード可） |
| `-o, --output` | store | `output.html` | `cli` を指定するとSTDOUT出力になる |
| `-r, --regex` | store | なし | 検出済みエンドポイントに対する**後段フィルタ** |
| `-b, --burp` | フラグ | False | 実装の help は空文字列。仕様説明はREADMEだけ |
| `-c, --cookies` | store | `""` | `Cookie` ヘッダとしてそのまま送られる |
| `-t, --timeout` | store(int) | `10` | **READMEに存在しない**。取得のタイムアウト秒数 |
| `-h, --help` | 自動生成 | — | — |

### 4-4. `-o cli` はなぜ速いのか

`main` の冒頭で、入力末尾のスラッシュを落とし、出力モードを決める。

```python
    if args.input[-1:] == "/":
        args.input = args.input[:-1]

    mode = 1
    if args.output == "cli":
        mode = 0
```

`mode=1` は「周辺のコンテキストを結果に含める」モード、`mode=0` はリンクのみのモードである。
`-o cli` のとき `mode=0` になり、**jsbeautifierによる整形が丸ごとスキップされる**。
READMEが「doesn't use jsbeautifier, which makes it very fast（jsbeautifierを使わないので非常に速い）」と書くのはこのためだ。

---

## 5. 使用例（READMEのExamples）

READMEのExamples節から、代表的なコマンドを原文のまま示す。

```bash
# オンラインのJSファイルからエンドポイントを探しHTML出力
python linkfinder.py -i https://example.com/1.js -o results.html

# CLI/STDOUT出力（jsbeautifierを使わないので非常に速い）
python linkfinder.py -i https://example.com/1.js -o cli

# ドメイン全体とそのJSファイルを解析
python linkfinder.py -i https://example.com -d

# Burp入力
python linkfinder.py -i burpfile -b

# フォルダ内のJSを列挙し、/api/ で始まるものだけ抽出して保存
python linkfinder.py -i 'Desktop/*.js' -r ^/api/ -o results.html
```

Burp入力の作り方はREADMEの括弧内が手順そのものになっている。
**Burpの Target で保存したいファイルを選択 → 右クリック → `Save selected items` → そのファイルを `-i` に渡し `-b` を付ける**。

ユニットテストの実行はREADMEいわく次のとおり。

```bash
pytest test_parser.py
```

---

## 6. 中核の正規表現 `regex_str`（LinkFinderの心臓）

### 6-1. なぜ正規表現がそのまま仕様書なのか

LinkFinderの本体は、たった1本の正規表現である。
`re.VERBOSE`（冗長モード）でコンパイルされるため、コメントとインデントをそのまま書ける。
つまりソース中のコメントがそのまま「何を拾うか」の仕様書になっている。
以下は `linkfinder.py` からの逐語引用である（コメント含む、改変なし）。

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

### 6-2. 両端のデリミタ ── 最大の前提であり最大の限界

正規表現の最初と最後にある `(?:"|')` は、**マッチが必ずシングルクォートかダブルクォートで囲まれた文字列リテラルの内側にある**ことを要求する。
これがLinkFinderの最大の前提であり、同時に最大の限界でもある。

JS中で文字列連結（`"/api/" + ver + "/user"`）やテンプレートリテラル（バッククォートで組む文字列）で作られたURLは、この「クォートで囲まれた1つの塊」の形にならないので拾えない。
攻撃者視点で言えば、LinkFinderが見逃したエンドポイントは「連結で組まれている」可能性がある、というヒントにもなる。

### 6-3. 5つの選択肢を分解して読む

外側の `( ... )` がグループ1で、ここが「リンク」として取り出される。
`parser_file` は `m.group(1)` を採用する。
内側は次の5つの選択肢に分かれている。

1. **スキーム付きURL** … `(?:[a-zA-Z]{1,10}://|//)` はスキーム名が英字1〜10文字、または**プロトコル相対の `//`**。`http`/`https` 限定ではない点が重要で、テストには `smb://example.com` も入っている。
2. **絶対パス／ドット相対パス** … `(?:/|\.\./|\./)` で始まる。直後の1文字は `>` `<` `,` `;` `|` 空白 `*` `(` `)` `%` `$` `^` `/` `\` `[` `]` を除外する。これらの記号やスラッシュを直後に許さないことで、`//` のようなプロトコル相対の断片や `</div>` のようなHTMLタグの断片を「パス」と勘違いする誤検出を避けている。とくに**この「次の1文字で `/` を禁止」が、`//`（プロトコル相対URL）をただのパスとして誤検出しないための仕掛け**である。
3. **スラッシュを含む相対エンドポイント＋拡張子** … 拡張子は**英字1〜4文字、または `action`**（Struts等の `.action` を意識）。末尾で `?`/`#` 以降のパラメータを任意で取り込む。
4. **拡張子なしのREST API** … コメントは「まともなRESTエンドポイントは通常3文字以上」。`api/user`, `v1/create`, `api/v1/user/2` が拾える。
5. **スラッシュなしのファイル名** … 拡張子は `php|asp|aspx|jsp|json|action|html|js|txt|xml` の**10種のホワイトリスト**に限定。だから `UserModel.name` は拾われず、`main.js` や `robots.txt` は拾われる。

`context_delimiter_str = "\n"` はコンテキスト抽出の区切りで、「マッチの前後を改行まで広げて1行を文脈として見せる」ことを意味する。

〔補足〕原文の選択肢2には `(%%$^` のように `%%` と `((` の重複がそのまま残っている（書式文字列の名残と思われる）が、文字クラス内なので実害は小さい。

---

## 7. 入力の解釈：5つのメソッド

`parser_input` は入力文字列を見て、5種類の解釈に振り分ける。
逐語引用は次のとおり。

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

各メソッドの仕様を表にまとめる。

| Method | 条件 | 挙動 |
|---|---|---|
| 1. URL | `http://` `https://` `file://` `ftp://` `ftps://` で始まる | そのまま1件のURLとして扱う |
| 2. Firefoxソース表示 | `view-source:` で始まる | 先頭12文字を切り落として素のURLにする |
| 3. Burpファイル | `-b` 指定時 | 入力を**XMLとしてパース**し、各itemの `<response>` を**base64デコード**、`<url>` と組にして返す |
| 4. ワイルドカード | 入力に `*` を含む | `glob` で展開しファイルのみに絞り `file://` を前置。0件ならエラー |
| 5. ローカルファイル | 上記以外 | `file://` + 絶対パス。存在しなければ "file could not be found ..." |

Burp入力が **XML形式で、レスポンス本文がbase64である**という点は覚えておくとよい。
Burpの "Save selected items" が出す形式がまさにこれである。

---

## 8. HTTP取得と解析の実装

### 8-1. 送信するヘッダは固定

`send_request` はブラウザを装う固定ヘッダでJSを取得する。逐語引用は次のとおり。

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

固定ヘッダの値は、WAF（Webアプリファイアウォール）のフィンガープリントやログ突合に使えるので押さえておく価値がある。

| ヘッダ | 値 |
|---|---|
| `User-Agent` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36` |
| `Accept` | `text/html, application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8` |
| `Accept-Language` | `en-US,en;q=0.8` |
| `Accept-Encoding` | `gzip` |
| `Cookie` | `-c/--cookies` の値（既定は空文字列） |

〔補足〕`try`/`except` の中身が同一なので、事実上「1回リトライするだけ」の構造になっている。
`ssl.create_default_context()` を使っているので**証明書検証は有効**であり、自己署名証明書のステージング環境ではSSLエラーで落ちる（この点は後述のSecretFinderと対照的）。

〔補足〕`deflate` 分岐の `data = response.read().read()` は**そのままでは動かないバグ**である。`response.read()` は `bytes`（バイト列）を返すのに、その戻り値にもう一度 `.read()` を呼んでいるためで、`bytes` に `.read()` メソッドは存在しない。
ただしこのコードは `Accept-Encoding: gzip` しか送らない設計になっているため、サーバが `Content-Encoding: deflate` を返すことは通常なく、この分岐には**実際には到達しない**。だから表面上は問題が起きないだけで、コード自体は成立していない、という典型例である。

### 8-2. 1MB閾値と整形

`parser_file` は解析の本体である。逐語引用は次のとおり。

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

重要な数値と挙動は次のとおり。

- **1,000,000文字（約1MB）が閾値**。これを超えるコンテンツにはjsbeautifierをかけず、`;` を `;\r\n` に、`,` を `,\r\n` に置換するだけの「軽量整形」を行う。巨大なwebpack出力などでjsbeautifierが終わらない問題への対処である。
- 重複排除は **link単位**（コンテキストは数えない）。
- `more_regex`（＝`-r` の値）は**最終段のフィルタ**で、`re.search` にマッチしたものだけ残す。つまり `-r` は検出用ではなく絞り込み用である。

### 8-3. コンテキスト抽出 ── grepとの決定的な差

`getContext` は、マッチ位置から前後に改行まで走査して「その行全体」をコンテキストにする。逐語引用は次のとおり。

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

jsbeautifierで整形済みなので、整形後の1行がそのまま意味のある1文になる。
`fetch(...)` や `$.ajax({url: ...})` のような呼び出し文脈が人間に読める形で残る。
これがgrepにはない、LinkFinderの決定的な強みである。

---

## 9. ドメインモード `-d` の中身

### 9-1. 深さ1の再帰

`-d` を付けると、入力ページを1回パースして見つかった `.js` を全部取得し、それぞれをもう一度パースする。
その際の除外判定を行うのが `check_url` である。逐語引用は次のとおり。

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

仕様は次のとおり。

- **`.js` で終わるURLだけを再帰対象にする**。クエリ付き（`app.js?v=3`）やSourceMap（`.js.map`）は対象外になる。
- **`nopelist = ["node_modules", "jquery.js"]`** … パスをスラッシュで分割した要素がこの2つのどちらかに一致したらスキップ。ノイズの多いライブラリを弾く最小限のブラックリスト。
- プロトコル相対 `//cdn.example.com/x.js` には `https:` を前置。`http` で始まらない場合は `args.input` を前置して絶対化する。

### 9-2. 進捗表示と失敗時の挙動

`-d` 本体（`main` 内）の逐語引用は次のとおり。

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

進捗は `Running against: <url>` として標準出力に出る。
失敗しても `Invalid input defined or SSL error for: <url>` を出して次へ進む。

〔補足〕`-d` はHTMLの `<script src>` を明示的にパースするのではなく、**同じエンドポイント抽出正規表現がたまたま拾った `.js` 文字列**を使う。したがって `<script src=...>` があってもクォート内の形が正規表現に合わなければ拾えない。後述のSecretFinderの `-e` がlxml XPathで `//script/@src` を取るのとは設計思想が異なる。

---

## 10. HTML出力とブラウザ自動起動

### 10-1. `template.html` を差し込む

`html_save` はHTMLファイルを保存し、ブラウザで開く。逐語引用は次のとおり。

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

ポイントは次のとおり。

- `string.Template` を使い、テンプレート中の `$content` を差し込む。テンプレートは `sys.path[0]` 直下（＝スクリプトと同じディレクトリ）の `template.html`。**`template.html` が無いと出力に失敗する**。
- 完了時に `URL to access output: file://<絶対パス>` を表示し、**自動でブラウザを開く**（Linuxは `xdg-open`、それ以外は `webbrowser.open`）。
- `os.dup(1)` / `os.close(1)` などは、ブラウザ起動時の余計な標準出力を一時的に `/dev/null` へ捨てる仕掛け。

〔補足〕`linkfinder.py` のファイル先頭には `os.environ["BROWSER"] = "open"` という1行があり、コメントに `Fix webbrowser bug for MacOS` と付いている。
これはmacOSで `webbrowser.open` が正しく動かない不具合への回避策で、ブラウザ起動コマンドを `open`（macOSの標準コマンド）に固定している。
まったく同じ行は後述するSecretFinder側の冒頭にも出てくる（節13-1のコード）ので、両ツールが同じ出自であることを示す小さな痕跡として見比べるとよい。

### 10-2. 黄色ハイライトの組み立て

エンドポイントごとのHTML断片は次のように組み立てられる（`main` 内、逐語）。

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

コンテキスト中のリンク部分は `<span style='background-color:yellow'>...</span>` で**黄色ハイライト**される。
すべて `html.escape` を通す。これは、出力HTMLを開く自分自身がXSS（後述）を食らわないための処置である。

### 10-3. `template.html` は編集可能

`template.html` の全文は次のとおり。

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

注目すべきは `<body contenteditable="true">` である。
出力HTMLはブラウザ上でそのまま編集でき、不要な行を消しながらトリアージ（結果の選別）できる設計になっている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: LinkFinder README の埋め込みスクリーンショット "LinkFinder in action" — https://github.com/GerbenJavado/LinkFinder （画像 https://i.imgur.com/JfcpYok.png ）
> **なぜ**: 本教科書の執筆環境からはHTML/CSSは逐語収録できたが、実際の見た目（黄色ハイライトされたコンテキスト、`contenteditable` なページ）そのものは画像でしか分からない（理由: スライド画像／画面のスクリーンショット）。以下の記述はテンプレートのソースにもとづく。
> **読みどころ**:
> 1. 黄色ハイライトされたエンドポイントが、周辺コンテキストの中でどう見えるかを確認する
> 2. ページ全体が編集可能で、不要行を消しながらトリアージできる操作感をつかむ
> **代替手段**: 自分で `python linkfinder.py -i <対象JS> -o out.html` を実行し、生成された `out.html` をブラウザで開けば同じ画面が得られる

### 10-4. CLI出力の癖

CLI出力側は極めて素朴である。

```python
def cli_output(endpoints):
    '''
    Output to CLI
    '''
    for endpoint in endpoints:
        print(html.escape(endpoint["link"]).encode(
            'ascii', 'ignore').decode('utf8'))
```

**`html.escape` を通した上で非ASCII文字を捨てる**（`encode('ascii','ignore')`）。
したがってCLI出力では `&` が `&amp;` に、`<` が `&lt;` になり、非ASCIIを含むパスは欠落する。
パイプで後段ツールへ流す際の既知の癖として覚えておくとよい。

---

## 11. テストが事実上の正規表現仕様書

### 11-1. なぜテストを読むのか

LinkFinderの検出仕様を一番正確に示すのは、READMEではなく `test_parser.py` である。
逐語引用は次のとおり。

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

### 11-2. 検出／非検出の境界表

テストから確定できる境界は、教科書の表としてそのまま使える。

| 入力（クォート込み） | 結果 | 理由 |
|---|---|---|
| `"http://example.com"` | 検出 | スキーム付きURL |
| `"smb://example.com"` | **検出** | スキームは英字1〜10文字なら何でも通る |
| `"https://www.example.co.us"` | 検出 | 多段TLD対応 |
| `"/path/to/file"` | 検出 | 絶対パス |
| `"../path/to/file"` | 検出 | ドット相対 |
| `"./path/to/file"` | 検出 | ドット相対 |
| `"/user/create.action?user=Test"` | 検出 | `.action` ＋クエリ |
| `"/api/create.php?user=test&pass=test#home"` | 検出 | クエリ＋フラグメント |
| `"/wrong/file/test<>b"` | **非検出** | `<` `>` が除外文字クラスに入っている |
| `"api/create.php"` | 検出 | スラッシュあり相対＋拡張子 |
| `"user/create.notaext?user=Test"` | **非検出** | 拡張子が5文字（1〜4文字 or `action` のみ許可） |
| `"api/user"` `"v1/create"` `"api/v1/user/2"` | 検出 | 拡張子なしREST |
| `"api/v1/search?text=Test Hello"` | 検出 | **クエリ内の空白は許容される** |
| `"test_1.json"` | 検出 | スラッシュなしファイル名（ホワイトリスト） |
| `"test2.aspx?arg1=tmp1+tmp2&arg2=tmp3"` | 検出 | `aspx` はホワイトリスト内 |
| `"addUser.action"` `"main.js"` `"index.html"` `"robots.txt"` `"users.xml"` | 検出 | 同上 |
| `"UserModel.name"` | **非検出** | `name` はホワイトリスト外 → プロパティアクセスの誤検出防止 |
| `"app/admin/admin.controller.js"` | 検出 | ドットを複数含むパスも可 |
| 同一リンクの2回出現 | 1件のみ | `no_dup=1` |

---

## 12. Chrome拡張（ブラウジング連動運用）

### 12-1. 何をするものか

READMEが言及しているのは karel_origin 氏製の Chrome 拡張で、`chrome_extension` ブランチにある。
READMEの説明の要点は次のとおり。

- ブラウジング中に読み込まれた**すべてのJavaScriptファイルをPythonスクリプトに送り返し**、そのスクリプトがLinkFinderを呼んで結果を出力する。
- ドメインのホワイトリスト指定ができるので、結果が欲しいドメインだけをスキャンできる。
- 内部では LinkFinder の **`-o cli` オプション**を使うので非常に高速で、数秒で複数のJSファイルを処理できる。

### 12-2. セットアップ手順

READMEのセットアップ手順（原文の番号のまま。原文では番号3が2回現れる）。

1. このブランチをクローンする
2. Chromeの `chrome://extensions/` で `Developer Mode` にしてExtensionフォルダを読み込む
3. `http-server.py` の変数 `path_linkfinder` を LinkFinder.py をインストールしたディレクトリに向けて編集する（または LinkFinder.py を `http-server.py` があるフォルダに移動する）
3. Pythonスクリプトを実行する（`python http-server.py`）。**ポート8080**でリスナが起動する
4. 拡張のアイコンをクリックし settings タブへ行き、On/Offスイッチを押して有効化する
5. 見つかったJavaScriptファイルがターミナルに表示され、LinkFinderに流される

Optionalな機能として、Scope（正規表現またはドメイン名でスキャン対象を絞る、既定は `.*`）、Save Urls（見つけたエンドポイントを保存し `Download Urls` でダウンロード）、ユニークURL数のグラフ、そして通知がある。
通知のキーワードは改行で区切る。原文の例は次のとおり。

```text
admin
login
php
asp
swf
```

READMEのTroubleshooting節には、運用でつまずきやすい3点への対処が書かれている。実際に動かすと高確率で当たるので押さえておく。

| 症状 | 原因 | 対処 |
|---|---|---|
| 通知が全部来ない | Chromeは同時に3件までしか通知を表示できない（他の方法は現状なし） | キーワードは最重要のものに絞る（登録自体は無制限にできる） |
| ブラウジングしてもターミナルに何も出ない | (1) スコープを現在のターゲットに変更し忘れている (2) HTTPサーバに接続できず拡張がオフになっている | まず `http-server.py` を起動し、そのあとで拡張アイコン → settingsタブ → Extensionスイッチをオンにする（サーバが起動していないとスイッチは数秒後に再びオフに戻る） |
| `http-server.py` が `linkfinder.py` を見つけられない | 拡張ブランチには `linkfinder.py` が入っておらず、別途用意する必要がある | mainブランチから `linkfinder.py` をクローンし、`http-server.py` のパス変数（`path_linkfinder`）を設定するか、`linkfinder.py` をExtensionフォルダに置く |

とくに2番目（出力が出ない）は「サーバ起動 → スイッチON」の順番を守るのが肝で、順番を逆にするとスイッチが勝手にオフへ戻る。

### 12-3. `http-server.py` はPython 2系で、外部公開してはいけない

`http-server.py` の全文（逐語）は次のとおり。**Python 2系のコード**である点に注意（`BaseHTTPServer`, `urlparse`）。

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

ここから読み取れる重要なセキュリティ上の教訓がある。

- サーバは既定で `--ip 0.0.0.0 --port 8080`、つまり**あらゆるインターフェースで待ち受ける**。
- 受け取った `url` を `os.popen` のシェル文字列に埋めて実行している。`url.replace('"', '\\"')` でダブルクォートだけはエスケープしているが、シェルメタ文字一般は素通りする構造である。
- Cookieもそのまま LinkFinder に渡るので、認証済みセッションのJSも解析できる。

**攻撃者はどこを突くか**: このサーバをローカル限定でない環境に置くと、外部から任意のURLを送り込んでコマンドを実行させられる恐れがある。
**どう守るか**: 自分の解析用ツールは外部公開しない、という原則の実例である。ローカルホストに限定し、外に晒さないこと。

### 12-4. READMEの Upcoming Features と Final Notes

拡張のREADMEは末尾に、開発状況を示す2つの節を置いている。

- **Upcoming Features** … 「`8080` 以外のポートでのリッスン」が今後の予定として挙がっている。ただしこれは記述と実装が食い違っている例で、`http-server.py` にはすでに `--port` 引数（既定 `8080`）が実装されており、ポート変更は現時点でも可能である。READMEが実装に追いついていない典型なので、ツールを使うときは**READMEより実装（argparse定義）を信じる**という前節（節4）の教訓がここでも効く。
- **Final Notes** … 「まだ開発段階なのでバグや不完全さがあるかもしれない。見つけたら遠慮なく issue を出してほしい」という趣旨の断り書きがある。つまり拡張は実験的な位置づけで、動作が不安定でも織り込み済みだということ。

> ### 📌 ここは自分で開いて読んでください
> **資料**: LinkFinder Chrome拡張の実装（`chrome_extension` ブランチ） — https://github.com/GerbenJavado/LinkFinder/tree/chrome_extension
> **なぜ**: 本ノートでは README と `http-server.py` を全文収録したが、拡張側（`popup/popup.js`, `background.js`）のスコープ判定・通知・グラフ描画の実装は未収録である（理由: サイト側のディレクトリ構成が深く、自動取得の対象外）。
> **読みどころ**:
> 1. `popup.js` がどうやってブラウジング中のJSを検知し、`http-server.py` にPOSTしているかを読む
> 2. スコープ（正規表現/ドメイン）判定の実装を確認し、ブラウジング連動型の運用を自作するときの参考にする
> **代替手段**: なし（同等の無料資料は同ブランチのソースそのもの）

> ### 📌 ここは自分で開いて読んでください
> **資料**: js-beautify（両ツールの前処理の心臓部） — https://github.com/beautify-web/js-beautify
> **なぜ**: LinkFinder/SecretFinder が整形に使うライブラリで、1MB超で整形がスキップされる挙動を理解するにはこちら側のオプション（インデント、行分割の規則）を知ると有利だが、本ノートには収録していない（理由: 別リポジトリで範囲外）。
> **読みどころ**:
> 1. インデントや行分割のオプションを読み、整形後の「1行＝1コンテキスト」がどう決まるかを理解する
> 2. なぜ巨大バンドルで整形が現実的でなくなるのかを、実装の観点からつかむ
> **代替手段**: なし（公式リポジトリのREADMEが一次資料）

---

## 13. 派生ツール SecretFinder 入門

### 13-1. 何が違うのか ── エンドポイントではなく「秘密」を探す

SecretFinder は m4ll0k 氏によるGPLv3のPythonスクリプトで、LinkFinderをベースにしている。
ただし探す対象が違う。SecretFinderは**JavaScriptファイル内の apikeys, accesstoken, authorization, jwt などの機密データ（sensitive data）を発見する**ために作り替えられた別物である。

APIキー（apikey）とは、サービスを呼び出す際の認証用の文字列のこと。
アクセストークン（accesstoken）やJWT（ジョット、JSON Web Token）も同様に、漏れると他人になりすませてしまう「秘密」である。
これらがJSに埋め込まれて公開されていると、そのまま悪用され得る。

実現方法はLinkFinderと同じで「python向け jsbeautifier と、かなり大きな正規表現の組み合わせ」。
出力もHTMLかプレーンテキストである。

派生元の痕跡はREADMEの文面にも残っている。SecretFinderのREADMEは**LinkFinderの文言をそのまま引き継いで**、「正規表現は4つの小さな正規表現から構成され、それらがJSファイル上の任意のものを見つけ・検索する責務を持つ」と書いている。
だが実際のSecretFinderは後述のとおり31個の名前付き正規表現で「秘密」を探すツールに作り替えられており、この「4つの小さな正規表現」という説明は**LinkFinder時代の名残**で、SecretFinderの実装とは合っていない。READMEを鵜呑みにせず実装を読む、という姿勢がここでも要る。
なおSecretFinderのREADMEにも動作画面のスクリーンショット（`https://i.imgur.com/D7MT2KL.png`）が埋め込まれている。

ヘッダコメント（`SecretFinder.py` 冒頭、逐語）にも派生元が明記されている。

```python
#!/usr/bin/env python
# SecretFinder - Tool for discover apikeys/accesstokens and sensitive data in js file
# based on LinkFinder - github.com/GerbenJavado
# By m4ll0k (@m4ll0k2) github.com/m4ll0k
```

冒頭でPython 3を強制している（逐語）。

```python
import os,sys
if not sys.version_info.major >= 3:
    print("[ + ] Run this tool with python version 3.+")
    sys.exit(0)
os.environ["BROWSER"] = "open"
```

### 13-2. オプションはLinkFinderより多い

SecretFinderのヘルプ出力（READMEのHelp節、逐語で完全再現）は次のとおり。

```text
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

実装側の `add_argument` 定義（逐語、既定値まで含む）は次のとおり。

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

### 13-3. LinkFinderとの対応表（`-r` の意味が逆転する点に注意）

| Short | Long | 既定 | 説明 | LinkFinderとの関係 |
|---|---|---|---|---|
| `-e` | `--extract` | False | ページ内の全JSリンクを抽出して処理 | LinkFinderの `-d` に相当（実装は lxml XPath で `//script/@src`） |
| `-i` | `--input` | 必須 | URL / ファイル / フォルダ | 同じ |
| `-o` | `--output` | `output.html` | 保存先。`cli` でSTDOUT | 同じ |
| `-r` | `--regex` | なし | **意味が違う**: 指定した正規表現を検出ルールとして**追加**する | 挙動が逆（LinkFinderは絞り込み） |
| `-b` | `--burp` | False | Burpのエクスポートファイルに対応 | 同じ |
| `-c` | `--cookie` | `""` | Cookie（**単数形 `--cookie`**） | 名前が違う（LinkFinderは `--cookies`） |
| `-g` | `--ignore` | `""` | 指定文字列を含むJS URLを無視（`;` 区切り） | LinkFinderに無い |
| `-n` | `--only` | `""` | 指定文字列を含むJS URLだけ処理（`;` 区切り） | LinkFinderに無い |
| `-H` | `--headers` | `""` | ヘッダ設定 | LinkFinderに無い |
| `-p` | `--proxy` | `""` | プロキシ設定 `host:port` | LinkFinderに無い |

**同じ `-r` でも、LinkFinderは「結果の絞り込みフィルタ」、SecretFinderは「検出ルールの追加」で意味が真逆になる**。取り違えやすい代表例なので注意する。
なお `-t/--timeout` はSecretFinderには存在しない（requestsの既定に従う）。

### 13-4. インストールと依存

SecretFinderのインストール（README、逐語）は次のとおり。

```bash
$ git clone https://github.com/m4ll0k/SecretFinder.git secretfinder
$ cd secretfinder
$ python -m pip install -r requirements.txt or pip install -r requirements.txt
$ python3 SecretFinder.py
```

`requirements.txt` の全文（逐語）は次のとおり。

```text
requests_file
requests 
jsbeautifier
lxml
```

LinkFinderが標準ライブラリ `urllib` だけで済ませているのに対し、SecretFinderは **requests（HTTP）／requests_file（`file://` アダプタ）／lxml（HTMLパース）** を追加で必要とする。
検出ルールの中身・Burp拡張・既知の限界（TLS検証無効など）は続く節（25b）で扱う。

---

## 手を動かす

1. LinkFinderをクローンして依存を入れる。
   ```bash
   git clone https://github.com/GerbenJavado/LinkFinder.git
   cd LinkFinder
   pip3 install -r requirements.txt
   ```
2. 自分で立てた検証用サイト（または明示的に許可されたバグバウンティ対象）のJSファイルに対し、まずCLI出力で高速に一覧を得る。
   ```bash
   python linkfinder.py -i https://YOUR-TARGET.example/app.js -o cli
   ```
3. コンテキスト付きで見たいときはHTML出力にする。生成された `output.html` がブラウザで自動的に開き、エンドポイントが黄色でハイライトされる。
   ```bash
   python linkfinder.py -i https://YOUR-TARGET.example/app.js -o results.html
   ```
4. `/api/` で始まるものだけに絞る（LinkFinderの `-r` は絞り込み）。
   ```bash
   python linkfinder.py -i https://YOUR-TARGET.example/app.js -r ^/api/ -o cli
   ```
5. ページ全体を対象にして、そこから見つかる `.js` を深さ1で再帰解析する。
   ```bash
   python linkfinder.py -i https://YOUR-TARGET.example -d -o cli
   ```
6. ローカルに保存済みのJS群をまとめて処理する（ワイルドカードはクォートで囲む）。
   ```bash
   python linkfinder.py -i 'Downloads/*.js' -o cli
   ```
7. 検出境界を自分の目で確かめるため、テストを走らせる。
   ```bash
   pytest test_parser.py
   ```
8. SecretFinderも入れて、同じJSに対し「秘密」を探してみる（許可された対象のみ）。
   ```bash
   git clone https://github.com/m4ll0k/SecretFinder.git secretfinder
   cd secretfinder
   pip install -r requirements.txt
   python3 SecretFinder.py -i https://YOUR-TARGET.example/app.js -o cli
   ```

## つまずきポイント

- **LinkFinderはクォートで囲まれた文字列しか拾えない**。`"/api/" + version + "/users"` のような連結や、テンプレートリテラル（バッククォート）で組まれたURLは検出できない。検出漏れは「連結されている」サインでもある。
- **拡張子ホワイトリストは10種のみ**（`php|asp|aspx|jsp|json|action|html|js|txt|xml`）。`.do`, `.cgi`, `.graphql` などはスラッシュなしファイル名ルートでは拾えない。
- **1MB超のJSは整形されない**ため、コンテキストが「`;` か `,` で切った断片」になり読みづらくなる。
- **`-d` は深さ1**で、`.js` で終わるURLのみが対象。SourceMap（`.js.map`）やクエリ付き（`app.js?v=2`）は対象外。
- **LinkFinderの `-r` は絞り込み、SecretFinderの `-r` はルール追加**。同じ短縮形で意味が逆。
- **`-c` の綴りが違う**。LinkFinderは `--cookies`（複数形）、SecretFinderは `--cookie`（単数形）。
- **どちらも完了時にブラウザを自動起動する**（Linuxは `xdg-open`）。CI/バッチで回すときは `-o cli` を使う。
- **`template.html` はスクリプトと同じディレクトリから読まれる**。`python setup.py install` でパッケージ化するとHTML出力が失敗することがある。
- **Chrome拡張の `http-server.py` は外部公開しない**。0.0.0.0で待ち受け、入力をシェル文字列に埋めるので危険。ローカル限定で使う。

## この節のまとめ

- LinkFinderは、JSファイルから隠れたエンドポイントを機械的に洗い出し、新しい攻撃対象領域を見つけるためのPython 3ツール（MITライセンス、Gerben Javado作）である。
- 実体は「jsbeautifierで整形 → 1本の大きな正規表現で総当たり」という構成で、正規表現のコメントがそのまま仕様書になっている。
- 検出するのは4カテゴリ（フルURL／絶対・ドット相対／スラッシュあり相対＋拡張子／スラッシュなしファイル名）で、実装上は5つの選択肢に展開される。
- マッチは必ずクォートで囲まれた文字列の内側でなければならず、連結やテンプレートリテラルは拾えない。これが最大の前提かつ限界。
- スラッシュなしファイル名の拡張子は10種のホワイトリスト（`php|asp|aspx|jsp|json|action|html|js|txt|xml`）に限定され、`UserModel.name` のような誤検出を防いでいる。
- `getContext` が前後を改行まで広げて「その行全体」をコンテキストにするため、grepにはない読みやすい文脈が得られる。
- CLIオプションは7つ＋実装追加の `-t/--timeout`（既定10秒）。`-o cli` にすると整形がスキップされ非常に速い。
- `-r` は検出用ではなく後段フィルタ。`-d` は深さ1の再帰で `.js` のみが対象、`node_modules` と `jquery.js` は除外。
- 入力は5メソッド（URL／view-source／Burp XML＋base64／ワイルドカード／ローカルファイル）に振り分けられる。
- HTML出力は `template.html` に差し込まれ、エンドポイントが黄色ハイライトされ、`contenteditable` で編集しながらトリアージできる。
- 検出境界は `test_parser.py` が最も正確な仕様書であり、境界表として活用できる。
- Chrome拡張はブラウジング連動でJSを送り返し `-o cli` で高速処理するが、`http-server.py` は0.0.0.0待ち受け＋シェル実行なので外部公開してはならない。
- SecretFinderはLinkFinder派生（GPLv3、m4ll0k作）で、探す対象がエンドポイントから apikey/token/jwt などの機密データに変わっている。
- SecretFinderはオプションが多く（`-e` `-g` `-n` `-H` `-p`）、`-r` の意味がLinkFinderと逆で、依存に requests/requests_file/lxml を要する。

## 理解度チェック

1. LinkFinderがJSからエンドポイントを探すと、バグハンターにとって何が得られるのか。
   ▶ 答え: テスト対象サイト上の新たな、隠れたエンドポイントが得られる。それは新しいテスト対象領域（new testing ground）となり、新たな脆弱性を含む可能性がある。

2. LinkFinderの正規表現が「クォートで囲まれた文字列の内側」しか拾わないことの実務的な帰結は何か。
   ▶ 答え: 文字列連結（`"/api/" + ver + "/user"`）やテンプレートリテラルで組まれたURLは検出できない。逆に、検出漏れは「連結で組まれている」ヒントにもなる。

3. `"UserModel.name"` がLinkFinderで非検出になるのはなぜか。
   ▶ 答え: スラッシュなしファイル名ルートの拡張子ホワイトリスト（`php|asp|aspx|jsp|json|action|html|js|txt|xml`）に `name` が含まれないため。JSのプロパティアクセスを誤検出しないための設計である。

4. `-o cli` を指定するとなぜ速くなるのか。
   ▶ 答え: `mode=0` になり、jsbeautifierによる整形が丸ごとスキップされるため。ただしコンテキスト（周辺の文脈）は結果に含まれなくなる。

5. LinkFinderの `-r` とSecretFinderの `-r` は何が違うか。
   ▶ 答え: LinkFinderの `-r` は検出済みエンドポイントに対する後段フィルタ（絞り込み）。SecretFinderの `-r` は検出ルールを1つ追加するもの。同じ短縮形で意味が逆である。

6. `-d`（ドメインモード）の再帰の深さと対象は何か。
   ▶ 答え: 深さ1。入力ページを1回パースして見つかった `.js` で終わるURLだけを取得し、それぞれをもう一度パースする。`node_modules` と `jquery.js` は除外され、クエリ付きやSourceMapは対象外。

7. Burp入力（`-b`）を作る手順と、その内部形式は何か。
   ▶ 答え: BurpのTargetで対象ファイルを選び、右クリック → `Save selected items` で保存し、そのファイルを `-i` に渡して `-b` を付ける。内部はXML形式で、各レスポンス本文はbase64エンコードされている。

8. Chrome拡張の `http-server.py` を外部公開してはいけない理由を2つ挙げよ。
   ▶ 答え: (1) 既定で 0.0.0.0:8080 とあらゆるインターフェースで待ち受ける。(2) 受け取ったURLを `os.popen` のシェル文字列に埋めて実行し、シェルメタ文字が素通りするため、外部から任意コマンドを実行される恐れがある。

9. SecretFinderはLinkFinderと目的がどう違い、依存関係はどう増えるか。
   ▶ 答え: 目的はエンドポイントではなく apikey/accesstoken/authorization/jwt などの機密データの発見。依存は urllib だけでなく requests・requests_file・lxml が必要になる。

## 出典

- https://github.com/GerbenJavado/LinkFinder
- https://raw.githubusercontent.com/GerbenJavado/LinkFinder/master/linkfinder.py
- https://raw.githubusercontent.com/GerbenJavado/LinkFinder/master/template.html
- https://raw.githubusercontent.com/GerbenJavado/LinkFinder/master/test_parser.py
- https://github.com/GerbenJavado/LinkFinder/tree/chrome_extension
- https://github.com/m4ll0k/SecretFinder
- https://raw.githubusercontent.com/m4ll0k/SecretFinder/master/SecretFinder.py
- https://github.com/beautify-web/js-beautify

<!-- sources: https://github.com/GerbenJavado/LinkFinder, https://raw.githubusercontent.com/GerbenJavado/LinkFinder/master/linkfinder.py, https://raw.githubusercontent.com/GerbenJavado/LinkFinder/master/template.html, https://raw.githubusercontent.com/GerbenJavado/LinkFinder/master/test_parser.py, https://github.com/GerbenJavado/LinkFinder/tree/chrome_extension, https://github.com/m4ll0k/SecretFinder, https://raw.githubusercontent.com/m4ll0k/SecretFinder/master/SecretFinder.py, https://github.com/beautify-web/js-beautify -->
<!-- terms: LinkFinder, SecretFinder, エンドポイント, 攻撃対象領域, jsbeautifier, 正規表現, プロトコル相対URL, テンプレートリテラル, 拡張子ホワイトリスト, コンテキスト, ドメインモード, Burp Save selected items, base64, contenteditable, APIキー, アクセストークン, JWT, 機密データ, xdg-open, MITライセンス, Content-Encoding -->

<!-- self-read: https://github.com/GerbenJavado/LinkFinder | スライド画像/スクリーンショット（HTML出力の見た目は画像でしか分からない） -->
<!-- self-read: https://github.com/GerbenJavado/LinkFinder/tree/chrome_extension | サイト側のディレクトリが深く拡張本体の実装が未収録 -->
<!-- self-read: https://github.com/beautify-web/js-beautify | 別リポジトリで範囲外、整形オプションは未収録 -->
