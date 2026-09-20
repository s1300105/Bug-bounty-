## source mapの回収とソースツリー復元

前節までで、本番のフロントエンドが minify（識別子短縮・空白除去）や難読化を経て「読みにくいバンドル」として配信されることを見てきた。しかし現実には、そうした逆コンパイル的な苦労を **完全に不要にしてしまう**成果物がしばしば同じサーバに転がっている。それが **source map（ソースマップ）** である。

source map が公開されていれば、minify・トランスパイル前の **元ソース（TypeScript / JSX / Vue SFC など）を、コメント・変数名・ディレクトリ構造ごとほぼ丸ごと復元できる**。本節は「なぜそんなことが可能なのか」をファイル形式の内部仕様から解き、復元ツール（`unwebpack-sourcemap`、`sourcemapper`）が具体的に何をしているか、そしてこの露出がなぜ脆弱性として扱われるかを、防御側の視点で解説する。

> **スコープ注意**: 本節は防御目的（自社アプリの監査、CI での露出検知、修正設定の設計）で記述する。実在サービスや本番環境への無許可のアクセス・検証、破壊的な手順は扱わない。以降のツール実行例は、自分が管理する成果物、または明示的な許諾のある検証環境を対象とすること。

### source mapとは何か — なぜ「元ソースが復元できる」のか

現代のフロントエンドはブラウザにそのまま送られるわけではない。TypeScript・JSX・SCSS・最新構文が、webpack / Vite / esbuild / Rollup などの **バンドラ**によって、(1) トランスパイル（古いJSへ変換）、(2) バンドル（多数のモジュールを少数のファイルへ結合）、(3) minify（短縮）される。結果として配信される `main.abc123.js` は、行番号も変数名も元と一致しない別物になる。

これではブラウザの DevTools でデバッグできない。そこで **source map** が導入された。source map は「変換後コードの各位置（行・桁）が、変換前のどのファイルのどの位置に対応するか」を記述した **対応表（写像）**である。ブラウザはこれを読み込むと、DevTools 上で minify されたコードの裏に元ソースを重ね、あたかも元のコードをデバッグしているかのように振る舞える。

ここが本節の核心だが、source map は「位置の対応表」だけでなく、**元ソースの本文そのもの**を埋め込むことができる。次項で見る `sourcesContent` フィールドがそれで、これが存在する map ファイルは、実質的に **元ソースコードのアーカイブ**である。攻撃者・監査者から見れば、`.map` を1つ落とすだけでフロントエンドのソースツリー全体が手に入る。

> Source map exposure が生まれる根本原因は、多くのバンドラが「開発時のデバッグ利便」のために source map を生成し、その設定が本番ビルドに漏れ出す点にある。source map 自体は正常な機能であり、問題は **本番で誰でもダウンロードできる状態に置かれること**（= exposure）である。

### `.map` ファイルの内部構造 — Source Map Revision 3

source map は JSON ファイル（慣例的に `*.js.map`）で、フォーマットは **Source Map Revision 3**（`version: 3`）が事実上の標準である。主要フィールドは次の通り。

| フィールド | 意味 | 復元における重要度 |
| --- | --- | --- |
| `version` | フォーマット版。現行は `3` | 判別に使う |
| `file` | この map が対応する生成ファイル名（例 `main.js`） | 参考情報 |
| `sourceRoot` | `sources` の各パスに前置される基準パス | パス復元に影響 |
| `sources` | 元ファイルのパス配列（例 `webpack:///src/App.tsx`） | **ツリー構造の復元に使う** |
| `sourcesContent` | 各元ファイルの **本文（文字列）** の配列。`sources` と並行（同じ添字が対応） | **★ソース本文の復元源そのもの** |
| `names` | 元の識別子名の配列（minify で失われた変数名） | シンボル復元 |
| `mappings` | VLQ（可変長量）でエンコードされた位置対応データ | 位置マッピング用 |

復元ツールが決定的に依存するのは `sources` と `sourcesContent` の **2つの並行配列**である。`sources[i]` が「元ファイルのパス」、`sourcesContent[i]` が「そのファイルの中身」で、この2つを添字 `i` で対にして走査し、パスの位置に本文を書き出せば、元のディレクトリツリーが丸ごと復元できる。`mappings` の複雑な VLQ デコードは、位置対応が要らない「ソース復元」目的では **一切不要**である点に注意したい（ツールは `mappings` を無視する）。

生成ファイル側には、map の在り処を示す **`sourceMappingURL` コメント**が末尾に付く。

```javascript
//# sourceMappingURL=main.abc123.js.map
```

ブラウザはこのコメント、または HTTP レスポンスヘッダ `SourceMap:`（旧称 `X-SourceMap:`。TC39 / ソースマップ仕様で規定）を見て map を取得する。復元ツールもこの同じ手がかりを辿る。

> 出典: Source Map Exposure の解説と影響・対策 — https://www.raijuna.com/knowledge/source-map-exposure
> 出典: Abusing Exposed Sourcemaps (Sentry Blog) — https://blog.sentry.security/abusing-exposed-sourcemaps/

#### なぜ `sourcesContent` に本文が入るのか（バンドラの devtool 設定）

`sourcesContent` の有無・map の生成有無はバンドラ設定で決まる。webpack では `devtool` オプションがこれを制御し、値の名前が map の性質を表す。

| `devtool` の値 | 性質 |
| --- | --- |
| `source-map` | 完全な外部 `.map` を生成。`sourcesContent` に元本文を含む。本番で誤って露出すると全ソースが漏れる |
| `eval-source-map` | 各モジュールを `eval()` 内に map 付きで埋め込む（開発向け・高速） |
| `hidden-source-map` | map は生成するが `sourceMappingURL` コメントを付けない。ファイル名を推測されれば取得可能 |
| `cheap-module-source-map` | 桁情報を省いた軽量版。ただし本文は含みうる |
| `false` | source map を生成しない（本番推奨） |

要点は、`hidden-source-map` は「コメントを消すだけ」で map ファイル自体は配信ディレクトリに置かれることが多く、`main.js` → `main.js.map` と **ファイル名を推測して `.map` を付けるだけで取得できてしまう**ことである。「コメントを消したから安全」は誤りで、これは典型的な *security by obscurity（隠蔽による安全性）* の失敗にあたる。

> 出典: Devtool | webpack — https://webpack.js.org/configuration/devtool/
> 出典: Source Map Exposure — https://www.raijuna.com/knowledge/source-map-exposure

### source mapの発見方法

監査時、source map の露出は次の手順で確認できる（すべて自分の管理対象・許諾済み環境に対して）。

1. **`sourceMappingURL` コメントの確認**: 配信されている `.js` を取得し、末尾に `//# sourceMappingURL=...` があるか見る。相対URLなら `.js` の位置を基準に解決する。
2. **`.map` 直付け推測**: 観測した JS の URL に `.map` を付けて取得を試す（`hidden-source-map` の取りこぼしを拾う）。
3. **HTTP ヘッダ確認**: レスポンスに `SourceMap:` / `X-SourceMap:` ヘッダがないか。
4. **DevTools での読み込み**: 取得した map を DevTools の Sources パネルに読ませ、元ツリーが復元されるか目視。

正規表現ベースの `sourceMappingURL` 抽出は、ツール（後述）でも次のようなパターンで行われる。

```
\/\/\#\s*sourceMappingURL=(.*)$
```

行末（`$`）にマッチさせるのは、`sourceMappingURL` コメントが慣例的にファイル末尾（最終行）に置かれるためである。

> 出典: Source Map Exposure — https://www.raijuna.com/knowledge/source-map-exposure

### ツール(1): unwebpack-sourcemap（rarecoil）

rarecoil の記事「SPA source code recovery by un-Webpacking source maps」は、この復元手法を広く知らしめた古典的資料である。中心的な主張は次の一点に集約される。**JavaScript バンドルはコンパイル済みバイナリのような「中間表現」だが、source map を一緒に配ってしまうと、バイナリにソースコードを添付して出荷するのと同じことになる。** その結果、コメントアウトされた関数、開発者名やメールアドレス、ドキュメント文字列、想定される API レスポンス例までもが、元ソースとして復元されてしまう。

> ⚠️ **未取得の資料**: 「SPA source code recovery by un-Webpacking source maps（rarecoil, Medium, 2019-06-13）」は自動取得できませんでした（理由: Medium が HTTP 403 Forbidden を返しブロック）。以下のURLからご自身で直接ご覧ください: https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d
> なお、記事本文で解説されている手法・ツールの実体は、著者自身の公開リポジトリ `rarecoil/unwebpack-sourcemap` から復元できたため、以下はそのリポジトリ（README・ソースコード）に基づく忠実な解説である。

`unwebpack-sourcemap` は Python 3 製のツールで、`sourcesContent` を持つ webpack source map から元ソースツリーを再構築する。依存は `requests` と `BeautifulSoup4`。3つの動作モードを持つ。

```bash
# ローカルの .map を処理
./unwebpack_sourcemap.py --local /path/to/source.map output/

# リモートの .map を直接取得して展開
./unwebpack_sourcemap.py https://example.com/source.map output/

# HTML から自動検出: <script src> を辿り JS を集め、sourceMappingURL を探して map を回収
./unwebpack_sourcemap.py --detect https://example.com/spa_root/ output/
```

主な CLI フラグ:

- `--local (-l)`: リモートではなくローカルファイルを処理
- `--detect (-d)`: 取得した HTML 内の JS アセットから source map を自動検出
- `--make-directory`: 出力先ディレクトリを無ければ作成
- `--dangerously-write-paths`: 信頼できないソースから来た **フルパスをそのまま書き込む**（危険。後述のパストラバーサル保護を無効化する意味を持つ）
- `--disable-ssl-verification`: SSL 証明書検証をスキップ

> 補足（バージョン/状態）: 本リポジトリは 2022年4月にアーカイブ済み（メンテ停止）。動作原理の学習には十分だが、現行環境では後述の `sourcemapper`（Go製）も併せて検討するとよい。

> 出典: unwebpack-sourcemap README / source — https://github.com/rarecoil/unwebpack-sourcemap

#### コアロジック: `_parse_sourcemap`

復元の中核は、`sources` と `sourcesContent` を `zip` で対にして走査し、各本文をサニタイズ済みパスへ書き出す部分である。実物のコードを見ると、`mappings` を一切触らず、2配列だけで復元が完結していることが分かる。

```python
def _parse_sourcemap(self, target, is_str=False):
    # ... map_data を読み込み ...
    try:
        map_object = json.loads(map_data)
    except json.JSONDecodeError:
        print("ERROR: Failed to parse sourcemap %s. Are you sure this is a sourcemap?" % target)
        return False

    # sources と sourcesContent が両方無ければ復元不能
    if 'sources' not in map_object or 'sourcesContent' not in map_object:
        print("ERROR: Sourcemap does not contain sources and/or sourcesContent, cannot extract.")
        return False

    # 添字対応が崩れていれば警告（ファイル名と中身がずれる可能性）
    if len(map_object['sources']) != len(map_object['sourcesContent']):
        print("WARNING: sources != sourcesContent, filenames may not match content")

    # ★ 2つの並行配列を zip して対にし、パスへ本文を書き出す
    for source, content in zip(map_object['sources'], map_object['sourcesContent']):
        write_path = self._get_sanitised_file_path(source)   # パスをサニタイズ
        if write_path is None:
            print("ERROR: Could not sanitize path %s" % source)
            continue
        os.makedirs(os.path.dirname(write_path), mode=0o755, exist_ok=True)
        with open(write_path, 'w', encoding='utf-8', errors='ignore', newline='') as f:
            print("Writing %s..." % os.path.basename(write_path))
            f.write(content)
```

なぜこれで復元できるのか。`sources[i]`（例 `webpack:///src/components/Button.tsx`）が **どこに書くか**を、`sourcesContent[i]`（そのファイルの生テキスト）が **何を書くか**を与える。この対応は map 仕様上「同じ添字が同じファイルを指す」と保証されているため、単純な `zip` で元のツリーが再現できる。`sourcesContent` が無い map（`sources` だけの map）は本文を持たないので、このツールは「復元不能」として明示的に弾く。

> 出典: unwebpack-sourcemap source (unwebpack_sourcemap.py) — https://github.com/rarecoil/unwebpack-sourcemap/blob/master/unwebpack_sourcemap.py

#### なぜパストラバーサル対策が要るのか（`webpack:///` と `../`）

ここが「復元ツールを自作・実行する側」が必ず理解すべき論点である。map の `sources` は **信頼できない入力**である。攻撃者が map を細工すれば、`sources` に `webpack:///../../../../etc/passwd` のようなパスを仕込める。ツールがこれを素直に `os.path.join(outdir, source)` すると、**出力ディレクトリの外へファイルを書き出す**（= 任意ファイル書き込み・パストラバーサル）危険が生じる。復元ツールは「攻撃者が用意した map を解析する」ことがまさに用途なので、この防御は必須である。

`unwebpack-sourcemap` の `_get_sanitised_file_path` は、まず `webpack:///` プレフィックスと相対パス記法を無害化（defang）する。

```python
def _get_sanitised_file_path(self, sourcePath):
    """Sanitise webpack paths for separators/relative paths"""
    sourcePath = sourcePath.replace("webpack:///", "")   # 疑似スキームを除去
    exts = sourcePath.split(" ")
    if exts[0] == "external":
        print("WARNING: Found external sourcemap %s, not currently supported. Skipping" % exts[1])
        return None

    path, filename = os.path.split(sourcePath)
    if path[:2] == './':                 # 先頭の ./ を除去
        path = path[2:]
    if path[:3] == '../':                # ★ ../ を親ディレクトリ脱出させず
        path = 'parent_dir/' + path[3:]  #    literal な 'parent_dir/' に置換して無害化
    if path[:1] == '.':                  # 残る先頭 . を空に
        path = ""
    filepath = self._path_sanitiser.make_valid_file_path(path, filename)
    return filepath
```

肝は `../` を「親へ上がる制御」としてではなく **文字列 `parent_dir/` に置換**する点である。これで `../` の意味論的な脱出能力が消える。しかしこの前処理だけでは取りこぼしがあるため、最終防衛線として `PathSanitiser` が絶対パスに正規化してから「本当に出力ルート配下か」を検証する。

```python
def make_valid_file_path(self, path=None, filename=None):
    root_path = self.get_root_path()
    # ... path/filename をファイルシステム的に無害化して結合 ...
    complete_path = os.path.abspath(complete_path)          # 絶対パスへ正規化
    if self.check_if_path_is_under(root_path, complete_path):
        return complete_path                                # ルート配下なら許可
    else:
        return None                                         # 脱出していたら拒否（=書き込まない）

def check_if_path_is_under(self, parent_path, child_path):
    child_parts  = self.path_split_into_list(child_path)
    parent_parts = self.path_split_into_list(parent_path)
    if len(parent_parts) > len(child_parts):
        return False
    # child のパス要素の先頭が parent のパス要素と完全一致するか
    return all(part1 == part2 for part1, part2 in zip(child_parts, parent_parts))
```

`os.path.abspath` で `..` を解決した後にルート配下判定を行うのが正攻法である。パス文字列を単純比較するのではなく、**要素（ディレクトリ名）のリストに分割して先頭一致を見る**ことで、`/root_evil` が `/root` 配下と誤判定される「プレフィックス文字列一致」の罠を避けている。ルート外なら `None` を返し、呼び出し側は書き込みをスキップする。前述の `--dangerously-write-paths` は、この保護をあえて外して「map に書かれたフルパスのまま書き出す」フラグであり、信頼できる map にのみ使うべきものだ。

> 出典: unwebpack-sourcemap source — https://github.com/rarecoil/unwebpack-sourcemap/blob/master/unwebpack_sourcemap.py

#### 検出モード（`--detect`）の仕組み

`--detect` は「SPA のルート URL から始めて map を自動発見する」モードで、内部の `_detect_js_sourcemaps` は次を行う。

1. 対象 URL の HTML を取得
2. `BeautifulSoup` で `<script src>` タグを抽出
3. 各 JS を取得し、**最終行**を正規表現 `\/\/\#\s*sourceMappingURL=(.*)$` で検査
4. 相対 map URL を JS の位置を基準に絶対化
5. 検出した map URI 群を返し、順に展開

このモードはリモートの JS をダウンロードして中身を辿る性質上、**細工した JS を食わせると任意 URL へ取得要求を出させる（SSRF 的な悪用）**余地がある点に注意する。監査時は対象を自分の管理下に限定すること。

> 出典: unwebpack-sourcemap README — https://github.com/rarecoil/unwebpack-sourcemap

### ツール(2): sourcemapper（Go製）

`denandz/sourcemapper` は同じ目的（source tree の再構築）を Go で実装したツールで、シングルバイナリで動く・並行処理・プロキシや独自ヘッダ対応など、実務的な取り回しの良さが特徴である。設計は `unwebpack-sourcemap` と本質的に同じで、`sourceMap` 構造体は `Version`（期待値 3）・`Sources`・`SourcesContent` を持ち、**2つの並行配列を同時に走査**して元ツリーを書き出す。

2つの動作モードを持つ。

```bash
# モード1: -url で .map を直接指定して取得・展開
sourcemapper -url https://example.com/bundle.js.map -outdir ./sources

# モード2: -jsurl で JS を指定し、そこから map を発見して展開
sourcemapper -jsurl https://example.com/bundle.js -outdir ./sources

# ネットワーク制御（プロキシ経由・独自ヘッダ・証明書検証スキップ）
sourcemapper -url map.js.map -outdir ./out -proxy http://proxy:8080 \
  -header "Authorization: Bearer token" -insecure
```

主な設定項目（`config` 構造体）:

- `outdir`: 展開先ディレクトリ（必須）
- `url` / `jsurl`: map 直指定 / JS からの発見（相互排他）
- `proxy`: 上流プロキシ（Burp などへ通す）
- `insecure`: TLS 証明書検証のスキップ
- `headers`: `-header` を複数指定でき、`textproto.Reader` で HTTP ヘッダとして解釈される（Go の `flag.Value` を実装した `headerList` 型で累積）

`-url` の取得（`getSourceMap()`）は3プロトコルに対応する: **HTTP/HTTPS**、**Data URI**（Base64 で URL に埋め込まれた map。`eval-source-map` 系や inline map で現れる）、**ローカルファイル**。`-jsurl` モードは (1) JS を取得 → (2) まず HTTP ヘッダ（TC39 仕様の `SourceMap:`）を確認し、無ければ `sourceMappingURL` コメントを解析 → (3) 発見した map を取得、という3段構えで map を探す。ここでも「細工した JS が任意 URL へ要求を出させうる」点が明記されており、`unwebpack-sourcemap` と同じ SSRF 的リスクを共有する。

パスの扱いも同様で、特に Windows 向けにプラットフォーム固有のパスクリーニングを行い、ファイル書き込み時のディレクトリトラバーサルを防ぐ。出力は `sources` 配列の構造に従い、例えば `webpack:/app/components/Button.js` は出力ルート下に同じ階層を作って書き出される。

> 出典: sourcemapper（DeepWiki） — https://deepwiki.com/denandz/sourcemapper

#### 2ツールの使い分け

| 観点 | unwebpack-sourcemap (Python) | sourcemapper (Go) |
| --- | --- | --- |
| 実行形態 | Python 3 + 依存パッケージ | シングルバイナリ |
| HTML からの自動検出 | `--detect` あり | `-jsurl`（単一 JS 起点） |
| Data URI / inline map | 主に外部 map 向け | `getSourceMap` が Data URI 対応 |
| プロキシ/ヘッダ | SSL 検証スキップ等 | `-proxy` / `-header` が充実 |
| メンテ状態 | 2022年アーカイブ | 継続的（Go 実装） |

どちらも「`sources` × `sourcesContent` を対で書き出す」中核は同じである。CI に組み込んで「自社の本番 URL に map が露出していないか」を定期チェックする用途では、依存の少ない Go 版が扱いやすい。

### 露出の実被害 — Sentry Blog の実例

Sentry Security Blog「Abusing Exposed Sourcemaps」は、露出した map が単なる情報漏洩を超えて **アカウント乗っ取りの起点**になった実例を示している。ポイントは「UI から消えても、バックエンドの機能は生きている」ことが map から露見する構図である。

研究者は対象アプリの露出 `.map` を復元し、UI からは呼ばれていないのにコード上は生きている関数 `updateUserData` を発見した。

```json
{
  key: "updateUserData",
  value: function updateUserData(account, userId, email, firstName,
  lastName, password, accessToken) {
    var path = '/user/update-user-data';
    var body = { account, userId, email, firstName, lastName, password, accessToken };
    return this.request.post(body, path);
  }
}
```

この関数は「ユーザーID・メール・パスワード等を受け取り、`/user/update-user-data` に POST する」ことを、**エンドポイントのパスとパラメータ名まで丸ごと**明かしている。攻撃連鎖は次の通り。

1. **列挙**: `/account/user-lookup/` を使って有効なユーザーを特定し、`userId` を取得。
2. **不正更新**: 判明した `/user/update-user-data` に、`password` を差し替えた POST を送る。応答は `HTTP 200 OK` で、認証情報の変更が成立した。

つまり map から得たのは「隠されていたはずのエンドポイントの完全な仕様」であり、それがそのまま **認可されていないパスワード変更 = アカウント乗っ取り**に繋がった。記事はこの教訓を *"obscurity is not security"（隠蔽は安全性ではない）* とまとめ、UI から要素を消しても対応するバックエンド機能を無効化しない限り悪用可能だと強調する。

同記事は他にも、map 経由で **ハードコードされた Stripe の API シークレットキー**が露出した事例を挙げている。復元後の探索は単純な grep で足りる。

```bash
# 復元ツリー内から機密の痕跡を探す（自分の成果物・許諾環境に対してのみ）
grep -r "API_KEY" output/
grep -r "password" output/
grep -rE "sk_live_|secret|token|Bearer " output/
```

> 出典: Abusing Exposed Sourcemaps (Sentry Blog) — https://blog.sentry.security/abusing-exposed-sourcemaps/

### 影響の整理と分類

source map の露出（Source Map Exposure）は、単体で直接コードを実行させる脆弱性ではないが、**偵察（recon）を桁違いに加速する**点で重大に扱われる。手作業のエンドポイント列挙を「`.map` を1つ落とす」だけに置き換えてしまうからだ。露出により典型的に判明するもの:

- **内部 API ルート**: 公開ドキュメントにないエンドポイントのパス・メソッド・パラメータ・レスポンス構造
- **コメント内の資格情報**: ビルド時点のコメントに残った API キー・トークン
- **ビジネスロジック**: クライアント側バリデーション規則、フィーチャーフラグ、権限チェックの実装
- **サードパーティ連携**: 設定定数、Webhook URL、サービス識別子
- **アーキテクチャ詳細**: 内部サービス名、マイクロサービスのエンドポイント、インフラ構成の手掛かり

分類・重大度（Raijuna の解説より）:

- **OWASP**: A05:2021（Security Misconfiguration / セキュリティ設定ミス）
- **CWE**: CWE-540（Inclusion of Sensitive Information in Source Code）
- **一般的な深刻度**: High（ただし復元された内容の機微さに依存する）
- **攻撃フェーズ**: 偵察の加速。大規模な脆弱性同定を容易にする

> 出典: Source Map Exposure — https://www.raijuna.com/knowledge/source-map-exposure

### 防御 — 露出させないための設定

修正の第一選択は **本番で source map を生成・配信しない**ことである。バンドラ別の設定と、配信層での遮断を組み合わせる。

**webpack（本番ビルド）:**

```javascript
// webpack.config.js
module.exports = {
  mode: 'production',
  devtool: false,   // 本番出力に source map を含めない
};
```

**主要バンドラ/フレームワークの既定と要注意点:**

| ツール | 本番設定 | 注意 |
| --- | --- | --- |
| webpack | `devtool: false` | 一部プリセットで既定有効。`hidden-source-map` はコメントを消すだけで map 自体は残るので不十分 |
| Vite | `build.sourcemap: false` | 本番は既定で無効。ただし明示 `true` に注意 |
| Rollup / esbuild | `sourcemap: false` | 設定次第。CI で出力を確認 |
| Create React App | `GENERATE_SOURCEMAP=false` | ビルド時の環境変数で抑止 |

**配信層での遮断（生成が避けられない場合の多層防御）:**

```nginx
# nginx: .map への要求を拒否
location ~* \.map$ {
    deny all;
    return 403;
}
```

代替として、map を生成しても **デプロイ成果物から `.map` を除外**する、あるいは **認証必須の内部パスにのみ配置**して Sentry などのエラートラッキングにだけ読ませる運用が有効である。`hidden-source-map` を使う場合でも、ファイル名推測で取得されうるため、必ず配信層の遮断か認証と併用すること。

さらに Sentry Blog の教訓を制度化するなら、**「UI から機能を消すときは、対応するバックエンドのエンドポイントも同時に無効化する」**ことをリリース手順に組み込む。map の露出対策と、隠れエンドポイントの棚卸しは、セットで初めて意味を持つ。

> 出典: Source Map Exposure — https://www.raijuna.com/knowledge/source-map-exposure
> 出典: Abusing Exposed Sourcemaps (Sentry Blog) — https://blog.sentry.security/abusing-exposed-sourcemaps/

### まとめ

- source map は minify/トランスパイル後コードと元ソースの対応表だが、`sourcesContent` フィールドに **元ソース本文を丸ごと埋め込む**ため、露出すればフロントエンドのソースツリー全体が漏れる。
- 復元の中核は `sources` と `sourcesContent` の **2つの並行配列を対で書き出す**だけで、`mappings` の VLQ デコードは不要。`unwebpack-sourcemap`（Python, 2022アーカイブ）と `sourcemapper`（Go）は共にこの原理で動く。
- map の `sources` は信頼できない入力なので、復元ツールは `../` の無害化・絶対パス正規化・ルート配下判定で **パストラバーサル**を防ぐ。`--detect` / `-jsurl` は細工 JS による **SSRF 的悪用**の余地があるため、対象は自分の管理下に限る。
- 露出は OWASP A05:2021 / CWE-540 に相当し、偵察を劇的に加速する。実例では隠れエンドポイント `/user/update-user-data` の露見からアカウント乗っ取りに至った。
- 防御は「本番で生成しない（`devtool: false` 等）」を第一に、配信層での `.map` 遮断・認証保護、そして「UI 撤去とバックエンド無効化をセットで行う」運用を組み合わせる。
