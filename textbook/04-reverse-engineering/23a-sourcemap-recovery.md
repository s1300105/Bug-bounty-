# Source Map から SPA のソースコードを丸ごと復元する

> **この節で分かること**
> - source map（`.js.map`）とは何か、なぜ本番環境に残っていると「ブラックボックス診断」が「グレーボックス診断」に化けるのかを説明できる
> - source map の JSON 構造（`sources` / `sourcesContent` / `mappings` など）を規範仕様のレベルで読み解き、どのフィールドが情報漏洩の本体かを指摘できる
> - `.js.map` を見つける 4 つの経路（コメント・HTTP ヘッダ・`data:` URI・総当り）を自分で試せる
> - `unwebpack-sourcemap`（Python）と `sourcemapper`（Go）を使って、`webpack://` 擬似パスから元のディレクトリツリーを復元できる
> - 「復元ツール自体が攻撃対象になる」というリスク（パス・トラバーサル、SSRF、ローカルファイル読み出し）を理解し、安全に使える

**元資料**: https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d （原典は取得できず二次情報ベース。ただし同著者の姉妹リポジトリ `rarecoil/unwebpack-sourcemap` の README とツール本体、`denandz/sourcemapper` の README と実装全文、TC39 Source Map 仕様書は原典取得済み）
**関連する節**: 本章の後続節（webpack `devtool` 設定と、両ツールのセキュリティ修正の歴史）

---

## 1. まず結論 — source map が診断で決定的になる理由

### 1.1 source map とは何か

source map（ソースマップ）とは、**圧縮・変換された後の JavaScript を、変換前の元ソースに対応づけるための地図ファイル**のこと。拡張子は `.js.map` が一般的で、中身は JSON である。

現代の SPA（Single Page Application, シングルページアプリケーション。ページ遷移をせずに JavaScript で画面を描き替える Web アプリ）は、React・Vue・TypeScript などで書かれる。これらはブラウザがそのまま実行できないため、**Webpack**（https://webpack.js.org/ ）などのバンドラ（複数のソースを 1 個にまとめる道具）が、トランスパイル（別言語への変換）と minify（変数名短縮・空白削除による圧縮）を行い、**単一のバンドル**としてブラウザに配信する。

このとき Webpack はデバッグ支援のために source map も生成する。何か問題が起きたとき、ブラウザのデバッガは source map を使って「圧縮後のこの行は、元の TypeScript のこの行だ」と指し示せる。開発者にとっては便利な機能である。

### 1.2 なぜこれが情報漏洩になるのか

問題は、source map の `sourcesContent`（後述）というフィールドに**元ソースの中身そのものが文字列として埋め込まれ得る**点にある。本番環境に `.map` が残っていれば、TypeScript / JSX / Vue SFC / SASS などの**未コンパイルの原本を、コメント込みで丸ごと復元できてしまう**。

姉妹リポジトリ `unwebpack-sourcemap` の README は、この状況をこう説明している（原文の主張を日本語化）。

- SPA の開発者は **JavaScript を「中間表現（intermediate representation）」として扱う**。中間表現とは、最終成果物ではなく途中の変換形式のこと。彼らにとっての本物のソースは TypeScript などであり、配信される JS はその「翻訳結果」にすぎない。
- このモデルは**バイナリ出荷に酷似**している。ソースをコンパイルして実行可能な版を出荷する、という構図だ。
- だとすると、**source map を一緒に置くことは、作った「バイナリ」（バンドル）と一緒にソースを漏らすのに等しい**。バンドルはバイナリ同様リバースエンジニアリング可能だが、**source map はそれを遥かに容易にする**。
- そして README は「**大半の開発者は source map を適切に保護せず、本番環境に出荷してしまう**」と断じている。多くの開発者は source map に**何が含まれているのか**を理解していない。

### 1.3 診断上の意味 — ブラックボックスがグレーボックスになる

これがなぜ決定的か。通常のバグバウンティは外から見える挙動だけを頼りにする「ブラックボックス診断」だ。ところが source map が漏れていると、**フロントエンド開発者が見ているのと同じ形でソースが読める**。復元されるものには**型宣言を伴う実際の TypeScript ファイル**が含まれる。

これによって、次のようなものが一気に読めるようになる。

- SPA の隠しルート（まだ公開していない管理画面など）
- feature flag（機能の有効・無効を切り替えるフラグ）
- 内部 API のエンドポイント一覧
- 権限判定ロジック（「この操作は管理者だけ」の実装）
- ハードコードされた鍵・トークン
- `TODO` / `FIXME` コメント（未対応の弱点が書いてあることがある）

つまり、外からは推測しかできなかった内部構造が、ソースを読んで確認できる「グレーボックス診断」に格上げされる。これが source map ハンティングの威力である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: SPA source code recovery by un-Webpacking source maps（rarecoil, 2019） — https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `medium.com` が組織のegressポリシーで全面ブロックされ、ミラーもすべて 403）。以下の記述は同著者の README（一次資料）と検索結果の二次情報にもとづく要約である。
> **読みどころ**:
> 1. 「JavaScript を中間表現として扱う」という論点と、source map 漏洩を「バイナリと一緒にソースを出荷すること」に喩える比喩。導入の考え方として価値がある。
> 2. `--detect` 機能をなぜ「HTML の `<script src>` を列挙 → 各 JS の末尾行を見る」という順序にしたのか、という設計判断。ここは記事にしか無い情報。
> 3. 復元後のディレクトリ構造のスクリーンショット。「開発者が書いていたときの構造に極めて近い」ものが実際どう見えるか。
> 4. TypeScript の型宣言が復元されることの意味（ブラックボックス → グレーボックスへの格上げ）の具体例。
> 5. 記事末尾の remediation（本番で source map を有効にしない）と、その理由づけ。
> **代替手段**: 記事公開前日（2019-06-12）の初版 README が記事冒頭の論旨と実質同一のテキストとして GitHub 履歴に残っている。`git clone https://github.com/rarecoil/unwebpack-sourcemap.git` の後 `git show 8cb367c:README.md` で読める。egress 制限下でも `git clone` は通る。読者自身の環境なら素の Medium URL、次に `https://freedium.cfd/<Medium URL>` を試すとよい〔freedium は一般に知られた Medium リーダーだが本セッションでは到達性未確認〕。

---

## 2. Source Map の構造（規範的定義）

ここからは TC39 Source Map 仕様書（https://github.com/tc39/source-map ）の記述にもとづき、source map の中身を正確に読み解く。TC39 とは、JavaScript の標準化を行う委員会のこと。

### 2.1 全体は 1 個の JSON オブジェクト

source map は**トップレベル JSON オブジェクトを 1 つ含む JSON ドキュメント**である。仕様書が例示する JSON は次の形をしている。

```json
  {
    "version" : 3,
    "file": "out.js",
    "sourceRoot": "",
    "sources": ["foo.js", "bar.js"],
    "sourcesContent": [null, null],
    "names": ["src", "maps", "are", "fun"],
    "mappings": "A,AAAB;;ABCDE",
    "ignoreList": [0]
  }
```

### 2.2 フィールドごとの意味とハンティング上の価値

各フィールドの規範的定義と、診断でどう使えるかを表にまとめる。

| フィールド | 必須/任意 | 規範的定義 | ハンティング上の意味 |
| --- | --- | --- | --- |
| `version` | 必須 | 常に整数の **3** でなければならない。他の値なら拒否されてよい | v3 以外は実質存在しない。パーサの妥当性判定に使う |
| `file` | 任意 | この source map が関連づく**生成コードの名前**。URL か相対パスか単なるベース名かは規定なし | `main.a1b2c3.js` など、対応するバンドルの実名が分かる |
| `sourceRoot` | 任意 | **source root 文字列**。sources 各エントリの先頭に連結される | 実サーバ上のソース配置パスが漏れることがある。復元時はこれを前置してから解決する |
| `sources` | 必須 | mappings が使う**元ソースのリスト**。各エントリは URL 文字列、不明なら `null` | **復元後のディレクトリツリーそのもの**。`webpack://` 擬似スキームや実ファイルパスが入る |
| `sourcesContent` | 任意 | **元ソースの内容そのもの**の文字列リスト。sources と同じ順序。取得すべきものは `null` になりうる | **情報漏洩の本体**。ここが埋まっていれば原本が丸ごと読める。`null` なら sources の URL を別途取りに行く |
| `names` | 任意 | mappings が使いうる**シンボル名のリスト** | 難読化前の変数名・関数名・プロパティ名の語彙が得られる。`sourcesContent` が `null` でも命名規則や API 名を推測できる |
| `mappings` | 必須 | **エンコードされたマッピングデータ**の文字列（Base64 VLQ） | 位置対応の復元に使う。ソース本文の復元には不要 |
| `ignoreList` | 任意 | **サードパーティコードと見なすべきインデックスのリスト**（フレームワークやバンドラ生成コード） | ここに載っていないインデックスが「自社コード」。node_modules のノイズを機械的に除去できる |
| `sections` | index map 専用 | 後述の index source map で使う | — |

仕様書は拡張性についてこう述べる（逐語訳）。「**source map の消費側は、認識できない追加プロパティを、source map を拒否する理由とせず無視しなければならない**。」つまり見慣れないフィールドがあっても壊れない設計になっている。

ハンティング視点で最重要なのは **`sourcesContent`**。ここが埋まっていれば原本が丸ごと手に入る。次点が **`sources`**（ディレクトリツリー）と **`names`**（`sourcesContent` が空でも命名規則が読める）である。

### 2.3 `mappings` の構造は復元には要らない

`mappings` は Base64 VLQ（可変長数値エンコード）で位置対応を表す。仕様書によれば、`;`（セミコロン）で生成ファイルの行を区切り、`,`（カンマ）で各セグメントを区切り、各セグメントは 1・4・5 個のフィールドからなる。

ただし**ソース本文（`sourcesContent`）を取り出すだけなら `mappings` は解読不要**である。`mappings` が要るのは、圧縮後の行とソースの行を正確に対応づけたいときだけ。バグハンティングでは大抵ソース本文が読めれば十分なので、この部分は飛ばしてよい。〔補足〕仕様書の注記では、この VLQ エンコーディングは Google Calendar のテストで source map を旧提案比 50% 削減したとある。サイズ削減が目的の設計だ。

### 2.4 `sources` の解決規則

`sources` のエントリが絶対 URL でない場合、仕様は「**`sourceRoot` を前置した後でも絶対 URL でなければ、source map に対して相対的に解決する**（HTML の script `src` と同様）」と定める。重要なのは、`sourceRoot` が `/` で終わっていなければ `/` が補われてから連結される点。手作業で復元パスを再現するときもこの規則を守ると、開発機上の実パスを正確に再現できる。

### 2.5 index source map（`sections`）という落とし穴

生成コードの連結などに対応するため、`sources` を直接持たず `sections` 配列を持つ「index source map」も仕様で認められている。各 section は `offset`（`line` と `column`）と `map`（通常の source map）を持つ。

**診断上の重要な注意**: index map では `sources` / `sourcesContent` がトップレベルに無く、`sections[].map` の中にある。**トップレベルの `sources` しか見ないツールは index map を取りこぼす**。後述の sourcemapper・unwebpack-sourcemap はいずれもトップレベルしか見ないため、index map は「no sources found」で落ちる。この場合は次のように各セクションを取り出して個別処理する。

```bash
jq '.sections[].map' target.js.map
```

---

## 3. `.js.map` を見つける 4 つの経路

source map を復元するには、まず `.map` の在り処を突き止める必要がある。仕様書と両ツールの実装から、経路は 4 つに整理できる。

### 3.1 経路 (1): インラインコメント `//# sourceMappingURL=`

バンドルの末尾には、多くの場合こういうコメントが付く。

```javascript
//# sourceMappingURL=main.a1b2c3.js.map
```

仕様書は URL の抽出に使う規範的な正規表現を定めている（逐語）。

```text
^[@#]\s*sourceMappingURL=(\S*?)\s*$
```

歴史的な注意が 2 つある。第 1 に、このアノテーションのプレフィックスは当初 `//@` だったが、**Internet Explorer の Conditional Compilation と衝突した**ため `//#` に変更された。仕様は「**生成側は `//#` のみを出力しなければならない。消費側は `//@` と `//#` の両方を受け入れなければならない**」と定める。したがって**診断で grep するときは `//#` だけでなく `//@` も対象にする**。

第 2 に、コメントは**パースの仕方で結果が変わる曖昧なケース**がある。仕様が挙げる例。

```javascript
let a = `
//# sourceMappingURL=foo.js.map
// `
```

これはパースすると `foo.js.map` を抽出するが、単純な行走査だと `null` になる。すべての抽出方法で結果が一致するとき「曖昧さなくリンクする」と言う。

### 3.2 経路 (2): HTTP レスポンスヘッダ

サーバが `sourcemap` ヘッダを付けて配信することもできる。

```text
sourcemap: <url>
```

仕様の注記（逐語訳）: 「**本文書の以前の版はヘッダ名 `x-sourcemap` を推奨していた。これは現在非推奨であり、`sourcemap` が期待される。**」また「**HTTP `sourcemap` ヘッダはソースアノテーションより優先される**」。両方あればヘッダの URL を使う。

診断では **`SourceMap:` と `X-SourceMap:` の両方**を全 JS レスポンスで確認する。Burp / ZAP のレスポンスヘッダ grep 対象に入れておくとよい。sourcemapper も `SourceMap` → 無ければ `X-SourceMap` の順で見る実装になっている。

### 3.3 経路 (3): `data:` URI によるインライン埋め込み

仕様は「source map URL は **data URI であってもよい**」と定める。`data:` URI と `sourcesContent` を併用すると**完全に自己完結した source map** が作れる。この場合、`.map` ファイルは存在せず、バンドルの末尾に次のような巨大な行が埋まる。

```javascript
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjoz...
```

`.map` ファイルが無いからといって漏洩が無いとは限らない。base64 部分をデコードすれば中身が読める。

### 3.4 経路 (4): `.map` の総当り・ディレクトリ推測

〔補足（一般知識）〕以下は仕様書・README に明記されていない実務手順だが、両ツールの設計（`.map` を直接渡せる、`--local` でダウンロード済み map を処理できる）が前提としている運用である。

1. `sourceMappingURL` コメントは**本番ビルドで意図的に削除されることが多い**（webpack の `hidden-source-map` は「map は生成するがコメントは付けない」設定）。しかし **`.map` ファイル自体はデプロイ先に残る**。「コメントが無い＝map が無い」ではない。
2. ロードされた全アセット URL に `.map` を素朴に付加して GET する。`main.a1b2c3.js` → `main.a1b2c3.js.map`、`app.css` → `app.css.map`。
3. `sources` / `file` / `sourceRoot` から判明した別チャンクのパスを使って、まだ取っていない map を追う。webpack のコード分割では `1.chunk.js.map`, `2.chunk.js.map` … と連番になることが多い。
4. デプロイ由来の副産物も狙う。`/static/js/`, `/assets/`, `/_next/static/`, `/build/` などのディレクトリ一覧、`asset-manifest.json`, `manifest.json`, `stats.json`（webpack の `--json` 出力）。`stats.json` が公開されているとモジュール一覧が丸ごと得られる。
5. 応答判定: `.map` は `Content-Type: application/json` で、**先頭が `{"version":3` である**ことをシグネチャにする。SPA のフォールバックで 200 + `index.html` が返ることがあるため、**ステータスコードだけで判定してはいけない**。
6. 総当りは**必ず許可された対象・スコープ内**で、レート制御しつつ行う。

### 3.5 CSS と WebAssembly も忘れない

source map は JS 専用ではない。仕様は CSS・WebAssembly についても抽出方法を定める。

- **CSS**: `/* ... */` 形式のコメントのみをサポートする点を除けば JS と同様。`.css.map` を忘れないこと。SASS/LESS の元ソース、未使用のクラス名（隠し機能の痕跡）、社内デザインシステムのパスが漏れる。
- **WebAssembly**: `.wasm` はコメントを持てないため、`sourceMappingURL` という名前のカスタムセクションに URL を埋める。`.wasm` を落としてこのセクションを探すと Rust/C++ の原ソースが取れることがある。

---

## 4. `webpack://` パスからソースツリーを復元する

`.map` が手に入ったら、`sources[i]` と `sourcesContent[i]` を対応づけてファイルに書き出すだけで復元できる。

### 4.1 復元の中核ロジックは 3 行

両ツール共通で、復元の核はこれだけ。

1. `sources` と `sourcesContent` を**同じインデックスで zip する**（対にする）。
2. `sources[i]` から擬似スキームを剥がし、出力ディレクトリ配下の安全なパスに正規化する。
3. 親ディレクトリを作って `sourcesContent[i]` を書き出す。

### 4.2 `webpack://` 擬似パスの語彙

`sources` のエントリは、webpack の場合スキーム付きの擬似 URL になる。sourcemapper の README にある Dockerhub の実例では、こういうパスが並ぶ。

```text
[+] Writing 9076765 bytes to dhubsrc/webpack:/js/client.356c14916fb23f85707f.js
[+] Writing 1014 bytes to dhubsrc/webpack:/webpack/bootstrap 356c14916fb23f85707f
[+] Writing 3174 bytes to dhubsrc/webpack:/app/scripts/client.js
[+] Writing 281 bytes to dhubsrc/webpack:/~/babel-runtime/helpers/interop-require-default.js
```

このパス断片の意味を知っておくと、復元後にどこを読むべきか一瞬で判断できる。

| `sources` のパス断片 | 意味 | 診断上の扱い |
| --- | --- | --- |
| `webpack:///` または `webpack://` | webpack の擬似スキーム。プロジェクトルート | 剥がす。unwebpack は空文字に置換、sourcemapper は `webpack:/` ディレクトリとして保存 |
| `webpack:///./src/...` | プロジェクト内の**自社コード**（`./` 始まり） | **最優先で読む**。認可ロジック・API クライアント・ルーティングがある |
| `webpack:///~/<pkg>/...` | `~` は **`node_modules` の省略記法**。例 `~/babel-runtime/...` | 第三者ライブラリ。後回し。ただしバージョン特定 → 既知脆弱性照合に使える |
| `webpack:///node_modules/...` | 第三者コード（`~` の展開形） | 同上 |
| `webpack:///webpack/bootstrap <hash>` | webpack ランタイムの bootstrap（**パスにスペースを含む**） | チャンク読み込みロジック・publicPath が読める |
| `webpack:///(webpack)/...` | webpack が注入したコード（hot-reload 等） | dev ビルドが本番に出ている兆候 |
| `webpack:///../<何か>` | プロジェクトルートより**上**のパス | **トラバーサル要注意**。unwebpack は `parent_dir/` に付け替える |
| `webpack:///external "..."` | 外部モジュール参照（本体が `sourcesContent` に無い） | unwebpack は警告してスキップ |

### 4.3 復元後は「開発者が見ていた構造」が再現される

sourcemapper の README では、復元後にこう観察できる。

```text
doi@asov:~/dhubsrc$ du -hs .
20M     .
doi@asov:~/dhubsrc$ cd webpack\:/app/scripts/
actions/     components/  middlewares/ reducers/    selectors/   stores/      vendor/
```

Redux らしいディレクトリ構成（`actions` `reducers` `selectors` `stores`）がそのまま見える。**開発者がアプリを書いていたときに見ていたであろう構造**が再現されるわけだ。

### 4.4 復元前の健全性チェック

両ツールは書き出し前にこういう検査を入れている。どれかに当たったら復元が不完全だと疑う。

| 状態 | ツールの反応 |
| --- | --- |
| `sources` が空 | 抽出不能（sourcemapper: `no sources found`） |
| `sourcesContent` が空 | 中身が無い。sources の URL を個別に取りに行く（sourcemapper: `no source content found`） |
| `len(sources) != len(sourcesContent)` | **ファイル名と内容がずれる可能性**（unwebpack: `WARNING: sources != sourcesContent, filenames may not match content`） |
| `version != 3` | 未検証（sourcemapper: `[!] Sourcemap is not version 3. This is untested!`） |

---

## 5. ツール 1: unwebpack-sourcemap（Python3 / rarecoil / MIT）

冒頭の Medium 記事の著者 rarecoil が公開した Python ツール。

### 5.1 まず知るべき「アーカイブ通知」

README 冒頭には 2022 年 4 月 15 日のアーカイブ通知があり、「私にはメンテナンスする時間がない。フォークしたい人のために暫くアーカイブ状態で残すが、**最終的にはこのリポジトリを削除する**」とある。

つまり**原リポジトリは将来消える可能性がある**。現役メンテのものが必要なら、後述の sourcemapper（Go）か PyPI 配布フォークを使う。

### 5.2 依存関係とバージョンの注意

README は Python3・`BeautifulSoup4`・`requests` を要求する。ただし `requirements.txt` のピン留めは 2019 年当時のもので、`urllib3==1.25.3` / `requests==2.22.0` はいずれも現在では既知の脆弱性を含む古い版だ。〔補足〕**診断端末で使う場合は必ず venv（仮想環境）に隔離**し、可能なら PyPI 配布フォークか sourcemapper を使う。

### 5.3 使い方（「騒がしさ」の小さい順）

README は「騒がしさ（対象サーバへのアクセス量）の小さい順」で 3 つの使い方を示す。

```bash
# 最も静か: ローカルのダウンロード済み map を展開
./unwebpack_sourcemap.py --local /path/to/source.map output
```

```bash
# リモートの map を直接展開
./unwebpack_sourcemap.py https://pathto.example.com/source.map output
```

```bash
# 最も騒がしい: HTML の全 <script src> を辿って map を自動検出
./unwebpack_sourcemap.py --detect https://pathto.example.com/spa_root/ output
```

いずれも、スクリプトと並んで `output` ディレクトリを先に作っておく前提だ（`mkdir output`）。

### 5.4 オプション一覧

| オプション | 動作 |
| --- | --- |
| `-l`, `--local` | 引数をローカルファイルとして扱う |
| `-d`, `--detect` | 取得した HTML の JS アセットから source map を検出する |
| `--make-directory` | 出力ディレクトリが無ければ作る |
| `--dangerously-write-paths` | 「フルパスで書く。信頼できないソースからディレクトリを引くので注意」（help 文） |
| `--disable-ssl-verification` | サイトの SSL 証明書を検証しない |

**実装上の重要な指摘**: `--dangerously-write-paths` は `argparse` に定義されているが、**実際のコードからは一切参照されていない**。したがってこのフラグを付けても挙動は変わらず、**常にサニタイズが適用される**。フラグ名に反して危険な生パス書き込みは実際には行われない（少なくともアーカイブ時点の master では）。安全側に倒れた実装漏れだ。

### 5.5 `--detect` 検出ロジックの限界

`--detect` は HTML を取り、`<script src>` の各 JS の**最終行だけ**に正規表現をかける。診断者が手で補うべき限界がいくつもある。

- 正規表現は **`//#` のみ**で、仕様が「両方受け入れよ」とする **`//@` を拾わない**。
- **最終行だけ**を見るため、`sourceMappingURL` の後にフッタコメントが続くビルドを取りこぼす。
- **`data:` URI 埋め込みに未対応**。
- **`SourceMap:` / `X-SourceMap:` ヘッダを見ない**。
- `<script src>` のみ対象で、**動的注入チャンクや `.css.map` を追わない**。
- 相対 URL 解決が単純連結なので `<base href>` やサブディレクトリで誤る。

要するに `--detect` は「取っかかり」であり、これで空振りしても map が無いとは言えない。ヘッダ確認・`data:` URI・総当りは自分で補う。

### 5.6 パス・トラバーサル防御の実体（`PathSanitiser`）

このツールの核心は `webpack://` パスの正規化にある。攻撃者が `sources` に `../../` を仕込んでも安全なファイル名に落とす、4 段構えの防御が入っている。

1. **Unicode 正規化 + ASCII 強制**（`normalize('NFKD', ...).encode('ascii','ignore')`）: 全角・互換文字による正規化差分攻撃を潰す。
2. **パス区切りをアンダースコアに置換**: `os.path.sep` と Windows の `/`（altsep）の両方を、パス構成要素ごとに `_` に。
3. **ホワイトリスト文字のみ許可**: `-_.() ` + ASCII 英数のみ。これにより `..` は「英数ゼロ」になる。
4. **`EMPTY_NAME`（`"empty"`）+ 連番に置換**: `..` は `empty_0`, `empty_1`, … という実在しない安全な名前になる。

さらに最終防衛線として、生成した絶対パスが出力ルート配下にあることを**構成要素の前方一致で検証**する。〔補足〕この「**文字列を連結してから絶対パス化して検証する**」二重チェックは、パス・トラバーサル防御の教科書的パターン（正規化 → 検証の順序を守る）。逆に検証してから正規化すると `a/../../b` を見逃す。

### 5.7 認証が必要な環境では使いにくい

`_get_remote_data` は `requests.get(uri)` を呼ぶだけで、**Cookie / Authorization ヘッダを渡すオプションが無い**。ログイン後の管理画面バンドルを狙うなら、後述の sourcemapper の `-header` を使うか、先に手で `.map` を落として `--local` で処理する。

### 5.8 検証用の脆弱アプリが同梱されている

README によれば、リポジトリ内の `example-react-ts-app` に**意図的に source map を漏らす TypeScript+React サンプル**が同梱されている。ラボ演習素材としてそのまま使える。対応範囲は「**TypeScript+React と TypeScript+Vue のテンプレートでのみ動作することを意図**」とあり、アルファ品質と自称している。

### 5.9 PyPI 配布フォーク（jamesmishra）

James Mishra が PyPI 向けにパッケージ化したフォークがあり、インストールが容易だ。

```bash
python3 -m venv venv
source venv/bin/activate
python3 -m pip install unwebpack-sourcemap
unwebpack-sourcemap --help
```

フォーク README は「依存関係がシステムの Python と衝突しうるので**常に virtualenv の中にインストールすることが重要**」と強調している。使用例は `--make-directory` で出力先を自動作成する形。

```bash
unwebpack-sourcemap --make-directory --local /path/to/source.map output_dir
unwebpack-sourcemap --make-directory --detect https://pathto.example.com/spa_root/ output_dir
```

---

## 6. ツール 2: sourcemapper（Go / denandz）

もう 1 本の代表ツール。現役メンテで BlackArch Linux に収録されている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: sourcemapper の DeepWiki（自動生成ウィキ） — https://deepwiki.com/denandz/sourcemapper
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `deepwiki.com` がegressポリシーでブロック）。ただし DeepWiki は当該 GitHub リポジトリの自動生成物であり、本節は原典である `README.md` 全文と `main.go` 全文を直接読んで書いているため、実装・使い方・オプションの情報欠落はほぼ無い。
> **読みどころ**:
> 1. 自動生成されたアーキテクチャ図／呼び出しグラフ（`main` → `getSourceMapFromJS` → `getSourceMap` → `processSourceMap` → `writeFile`）を図で確認できる。
> 2. 対話質問機能で「`remoteSource` フラグはどこで true になるか」等をコード横断で聞ける。
> 3. あわせて https://deepwiki.com/rarecoil/unwebpack-sourcemap を開くと、Python 版・Go 版のサニタイズ方針の違いを比較しやすい。
> **代替手段**: リポジトリを `git clone https://github.com/denandz/sourcemapper.git` して `README.md` と `main.go` を直接読めば、実装・使い方・オプション・変更経緯まで代替できる。DeepWiki 固有の未取得分は「自動生成図」と「対話質問」の 2 点のみ。

### 6.1 概要とインストール

README（逐語訳）: 「Sourcemapper は、webpack などが生成した source map をパースして元の JavaScript を吐き出し、**source map 内のファイルパスに基づいてソースツリーを再構成する** golang の小物である。」`go.mod` は `go 1.16`。

```bash
# 最近の Go があれば
go install github.com/denandz/sourcemapper@latest
```

```bash
# clone してビルド
git clone https://github.com/denandz/sourcemapper
cd sourcemapper
go get
go build
```

```bash
# BlackArch Linux
pacman -S sourcemapper
```

### 6.2 オプションと 3 つの入力モード

`-help` 出力から。

| フラグ | 説明（逐語） | 備考 |
| --- | --- | --- |
| `-output` | `Source file output directory - REQUIRED` | **必須**。未指定なら usage を出して終了 |
| `-url` | `URL or path to the Sourcemap file` | **URL でもディスク上の map ファイルパスでも可** |
| `-jsurl` | `URL to JavaScript file` | JS を取得して source map 参照を自動発見 |
| `-dir` | `Directory of .map files to process recursively` | 再帰的に `.map` を一括処理 |
| `-proxy` | `Proxy URL` | Burp 等に通せる |
| `-insecure` | `Ignore invalid TLS certificates` | 自己署名証明書を無視 |
| `-header` | `A header to send with the request, similar to curl's -H` | **認証後のバンドルを取れる決定的な機能**。複数指定可 |

README の制約（逐語）: 「**Only one of `-url`, `-jsurl`, or `-dir` can be specified at a time.**」`-url`・`-jsurl`・`-dir` は同時に 1 つだけ。

### 6.3 モード 1: `-url`（map の URL / ローカルファイル）

`.map` の URL でも、ディスク上の map ファイルパスでも渡せる。README の実例（※Dockerhub は既にこの map を削除済み）。

```text
doi@asov:~$ ./sourcemapper -output dhubsrc -url https://hub.docker.com/public/js/client.356c14916fb23f85707f.js.map
[+] Read 23045027 bytes, parsing JSON
[+] Retrieved Sourcemap with version 3, containing 1828 entries
...
[+] done
```

**実績値**: 取得した map は **約 23MB**、version 3、**1,828 エントリ**、復元後のツリーは **20MB**。単一の `.map` から 1,828 ファイル・20MB のソースが復元された具体例だ。

README の補足（逐語訳）: 「**source map をファイルに抽出することで、`sourceMappingURL=data:application/json;.... base64 blob...` として設定された source map を、blob をファイルにデコードしてからそのファイルパスを sourcemapper に渡すという手順で回避できる。**」つまり `data:` URI は手でデコードして `-url` に渡す運用もできる。

### 6.4 モード 2: `-dir`（`.map` ディレクトリを一括処理）

ディレクトリを再帰的に walk して、見つかった全 `.map` から抽出する。**不正・空の source map はログに記録してスキップ**されるので、1 個の壊れたファイルがバッチ全体を止めない。拡張子判定は小文字化してから `.map` を見るので `.MAP` も拾う。

```text
$ ./sourcemapper -dir ./maps -output ./src
[+] Found 12 .map files in ./maps
[+] Processing: maps/app.js.map
...
[+] Done
```

**診断ワークフローとして最も実用的**: Burp の「Save all site responses」や `wget -r` で `.map` を全部落としてから `-dir` で一括復元すれば、認証やレート制限の問題を切り離せる。

### 6.5 モード 3: `-jsurl`（JS から自動発見）

JS ファイルを読み、source map 参照（絶対・相対・`data:`）を判定して自動ダウンロードする。inline source map の例。

```text
$ ./sourcemapper -output test -jsurl http://localhost:8080/main.js
[.] Found SourceMap in JavaScript body: data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjoz...
[+] Read 4708918 bytes, parsing JSON.
[+] Retrieved Sourcemap with version 3, containing 535 entries.
```

**実績値**: data URI 埋め込みの inline source map から **約 4.7MB**、**535 エントリ**を復元。

発見ロジックの優先順位が実装から読み取れる。まず `SourceMap` / `X-SourceMap` ヘッダを見て、無ければ JS 本文を正規表現で走査する。

```go
	// check for SourceMap and X-SourceMap (deprecated) headers
	if sourceMap = res.Header.Get("SourceMap"); sourceMap == "" {
		sourceMap = res.Header.Get("X-SourceMap")
	}
	...
		re := regexp.MustCompile(`\/\/[@#] sourceMappingURL=(.*)`)
		match := re.FindAllSubmatch(body, -1)
		if len(match) != 0 {
			// only the sourcemap at the end of the file should be valid
			sourceMap = string(match[len(match)-1][1])
		}
```

**正規表現の逐語**: `` `\/\/[@#] sourceMappingURL=(.*)` ``。`//@` と `//#` の両方を受け入れる（仕様準拠）が、`[@#]` の直後に**リテラルの半角スペース 1 個**が必須なので、`//#sourceMappingURL=`（スペースなし）や `//#  sourceMappingURL=`（スペース 2 個）は**マッチしない**。手作業で grep するなら、スペースの有無を問わない `//[@#]\s*sourceMappingURL=` を使うのが安全。また複数見つかったら**最後のもの**を採用する。

### 6.6 `-header`（認証済み診断で必須）

複数の `-header` を CRLF で連結し、MIME ヘッダとしてパースする。README の例そのまま。

```bash
./sourcemapper --header "Cookie: session=bar" --header "Authorization: blerp"
```

これが unwebpack との決定的な差だ。**ログイン後のバンドルを取れる**。

### 6.7 非 200 応答も取りこぼさない設計

```go
			if res.StatusCode != 200 && len(body) > 0 {
				log.Printf("[!] WARNING - non-200 status code: %d - Confirm this URL contains valid source map manually!", res.StatusCode)
			}
```

`.map` を 404 で返しつつボディに中身を入れる設定（SPA のフォールバックなど）を取りこぼさないための意図的な設計。人間に手で確認させる警告を出す。ただし `-jsurl` 側では JS 本体は 200 必須。

### 6.8 パースする構造体は最小限

sourcemapper がパースする構造体はこれだけ。

```go
type sourceMap struct {
	Version        int      `json:"version"`
	Sources        []string `json:"sources"`
	SourcesContent []string `json:"sourcesContent"`
}
```

つまり **`names` / `mappings` / `sourceRoot` / `ignoreList` / `sections` はパースしない**。よって sourcemapper は `sourceRoot` を前置せず、index map（`sections`）も処理しない。この 2 点は診断者が `jq` で手当てする必要がある。

---

## 7. 復元ツール自体が攻撃対象になる

ここは本節でもっとも重要な安全上の論点だ。`sources` の各エントリは**攻撃者が制御できる文字列**である。悪意ある人物が細工した `.map` を診断者に処理させると、次の 3 つのリスクが生じる。

### 7.1 リスク (a): パス・トラバーサル書き込み

`sources` に `../../etc/crontab` のようなパスが入っていると、素朴なツールは出力ディレクトリの**外**にファイルを書いてしまう。だから両ツールとも 4.2 / 5.6 で見たようなサニタイズを必ず通す。unwebpack は `../` を `parent_dir/` に付け替え、最終的に出力ルート配下かを検証する。

### 7.2 リスク (b): 強制 GET（SSRF / forced request）

攻撃者の JS に仕込まれた `sourceMappingURL` が、任意の URL を指していることがある。ツールがそれを自動 GET すると、**診断者の端末から意図しない URL へリクエストが飛ぶ**（SSRF, Server-Side Request Forgery 的な forced request）。sourcemapper の README はこの SSRF リスクを明示的に警告している。

### 7.3 リスク (c): ローカルファイル読み出し

`-url` はローカルパスも受け付けるため、細工次第でローカルファイルを読ませる余地がある。sourcemapper はこの手のローカル読み出しを防ぐ修正を後年入れている（詳細は本章の後続節）。

### 7.4 安全に使うための原則

- **信頼できない `.map` は隔離環境（VM / コンテナ）で処理する**。
- **出力先は必ず空の専用ディレクトリ**にし、書き出されたパスをレビューしてから開く。
- **プロキシ（Burp）越しに走らせて**、ツールが飛ばすリクエストを可視化する。
- 診断は**許可されたスコープ内**でのみ行う。

---

## 手を動かす

以下はすべて**自分で立てた検証環境、または許可されたバグバウンティ対象**でのみ行うこと。

1. まず sourcemapper を入れる。
   ```bash
   go install github.com/denandz/sourcemapper@latest
   ```
2. 検証用の脆弱アプリを用意する。unwebpack-sourcemap 同梱のサンプルが手早い。
   ```bash
   git clone https://github.com/rarecoil/unwebpack-sourcemap.git
   cd unwebpack-sourcemap/example-react-ts-app
   ```
   （ビルド手順は同ディレクトリの README に従う。`mode: 'production'` + `devtool: 'source-map'` で `.map` が出るのがポイント。）
3. 対象の JS を 1 本開き、末尾の `sourceMappingURL` を確認する。
   ```bash
   curl -s https://TARGET/static/js/main.js | tail -c 300
   ```
   `//# sourceMappingURL=main.js.map` か、`data:application/json;base64,...` が見えるはず。
4. ヘッダも確認する。
   ```bash
   curl -sI https://TARGET/static/js/main.js | grep -i 'sourcemap'
   ```
5. `-jsurl` で JS から自動発見させる（プロキシ越しに）。
   ```bash
   ./sourcemapper -output ./out -jsurl https://TARGET/static/js/main.js -proxy http://127.0.0.1:8080
   ```
6. 認証が要るなら `-header` を付ける。
   ```bash
   ./sourcemapper -output ./out -jsurl https://TARGET/app.js --header "Cookie: session=..."
   ```
7. 復元されたツリーで**自社コードだけ**を読む。`~/` や `node_modules` はノイズなので除外。
   ```bash
   cd out && find . -path '*/node_modules/*' -prune -o -name '*.ts' -print
   ```
8. 秘密情報とエンドポイントを grep する。
   ```bash
   grep -rniE 'api[_-]?key|secret|token|Bearer|/api/|/admin|TODO|FIXME' .
   ```
9. `.css.map` も忘れず確認する。
   ```bash
   curl -sI https://TARGET/static/css/main.css.map | head -1
   ```
10. index map が疑われる（`no sources found` が出る）なら `jq` で分解する。
    ```bash
    jq '.sections[].map' target.js.map
    ```

---

## つまずきポイント

- **`.map` が無い＝漏洩無し、ではない**。`hidden-source-map` はコメントだけ消して map は残す。総当りとヘッダ確認を必ず併用する。
- **ステータスコードで判定しない**。SPA は存在しないパスに 200 + `index.html` を返す。`{"version":3` で始まるかを見る。
- **`//@` を見落とす**。多くの grep 例は `//#` だけを見る。仕様は両方受け入れよと定める。
- **sourcemapper の正規表現はスペースに厳しい**。`//[@#] sourceMappingURL=` はスペース 1 個必須。手 grep では `//[@#]\s*sourceMappingURL=` を使う。
- **index map を取りこぼす**。両ツールともトップレベルの `sources` しか見ない。`sections` があれば `jq` で分解。
- **unwebpack は認証を渡せない**。ログイン後のバンドルには sourcemapper の `-header`、または `--local` を使う。
- **`--dangerously-write-paths` は効かない**。名前に反して実際にはサニタイズが常に適用される（アーカイブ時点の master では）。
- **復元ソースだけ読んで満足しない**。細工された `.map` はツール自体を狙う。隔離環境・プロキシ越し・専用出力ディレクトリで扱う。

---

## この節のまとめ

- source map（`.js.map`）は圧縮後 JS と元ソースを対応づける JSON の地図で、`sourcesContent` に**元ソースの中身そのもの**が入りうる。
- 本番に `.map` が残ると、TypeScript / JSX / Vue / SASS の原本がコメント込みで復元でき、**ブラックボックス診断がグレーボックス診断に化ける**。
- 構造で最重要なのは `sourcesContent`（漏洩の本体）・`sources`（ディレクトリツリー）・`names`（命名規則）。`mappings` は本文復元には不要。
- `version` は常に 3。仕様は未知フィールドを無視せよと定め、拡張に強い。
- `.map` の発見経路は 4 つ: (1) `//# sourceMappingURL=` コメント（`//@` も）、(2) `SourceMap:` / `X-SourceMap:` ヘッダ、(3) `data:` URI 埋め込み、(4) `.map` 総当り・ディレクトリ推測。
- CSS（`.css.map`）と WebAssembly（カスタムセクション）も漏れうる。忘れない。
- index source map は `sections[].map` に構造を持ち、トップレベルしか見ないツールは取りこぼす。`jq` で分解する。
- 復元は `sources[i]` と `sourcesContent[i]` を対にして書き出すだけ。`webpack:///./src/...`（自社コード）を最優先で読み、`~/` や `node_modules` は後回し。
- unwebpack-sourcemap（Python, rarecoil）は 2022 年にアーカイブ宣言済み。`--local` / リモート / `--detect` の 3 モード。認証を渡せず、`--detect` の検出は限定的。
- sourcemapper（Go, denandz）は現役で、`-url` / `-jsurl` / `-dir` の 3 モードと `-header` / `-proxy` / `-insecure` を持ち、認証済み診断に強い。
- 実績値: 単一の map から 1,828 エントリ・20MB、inline から 535 エントリ・4.7MB を復元した例がある。
- **復元ツール自体が攻撃対象**: (a) パス・トラバーサル書き込み、(b) SSRF / forced request、(c) ローカルファイル読み出し。両ツールとも防御コードを持つが、隔離環境・プロキシ越し・専用出力ディレクトリで扱う。

---

## 理解度チェック

1. source map が本番に残っていると、なぜ診断が「グレーボックス化」するのか。
   ▶ 答え: `sourcesContent` に元ソースの中身が丸ごと入りうるため、TypeScript などの原本をコメント込みで復元でき、内部ロジック（認可・API・隠しルート）をソースで直接読めるようになるから。外から推測するしかなかった内部が確認できるようになる。

2. source map の JSON で、情報漏洩の「本体」にあたるフィールドはどれか。またディレクトリツリーになるのはどれか。
   ▶ 答え: 本体は `sourcesContent`（元ソースそのもの）。ディレクトリツリーになるのは `sources`（`webpack://` 擬似パスや実パス）。

3. `.map` を見つける 4 つの経路を挙げよ。
   ▶ 答え: (1) バンドル末尾の `//# sourceMappingURL=` コメント、(2) HTTP ヘッダ `SourceMap:` / `X-SourceMap:`、(3) `data:application/json;base64,...` のインライン埋め込み、(4) `.map` の総当り・ディレクトリ推測。

4. `sourceMappingURL` コメントを grep するとき `//#` だけでは不十分な理由は。
   ▶ 答え: 仕様は「生成側は `//#` のみ出力、消費側は `//@` と `//#` の両方を受け入れよ」と定めるため。歴史的に `//@` が使われていたビルドがあり、`//@` も対象にしないと取りこぼす。

5. `.map` を GET したときステータスコードだけで存在判定してはいけないのはなぜか。
   ▶ 答え: SPA は存在しないパスにも 200 + `index.html` を返すフォールバックがあるため。逆に 404 でもボディに map を返す設定もある。`{"version":3` で始まるか（`Content-Type: application/json` か）をシグネチャにする。

6. sourcemapper の 3 つの入力モードと、それぞれの用途を述べよ。
   ▶ 答え: `-url`（map の URL / ローカルパスを直接処理）、`-jsurl`（JS を読んで map 参照を自動発見。`data:` URI も可）、`-dir`（ディレクトリ内の `.map` を再帰的に一括処理。壊れた map はスキップ）。

7. ログイン後の管理画面バンドルの source map を復元したい。unwebpack と sourcemapper のどちらが適切か、理由とともに。
   ▶ 答え: sourcemapper。`-header` で Cookie / Authorization を渡せる。unwebpack は `requests.get(uri)` を呼ぶだけでヘッダを渡すオプションが無いため、認証環境では手で `.map` を落として `--local` するか sourcemapper を使う。

8. 「復元ツール自体が攻撃対象になる」とはどういうことか。3 つのリスクを挙げよ。
   ▶ 答え: `sources` は攻撃者が制御できる文字列なので、(a) `../../` によるパス・トラバーサル書き込み、(b) 細工された `sourceMappingURL` による任意 URL への強制 GET（SSRF / forced request）、(c) ローカルファイル読み出しが起きうる。だから隔離環境・プロキシ越し・専用出力ディレクトリで扱う。

9. index source map（`sections`）が両ツールで落ちるのはなぜか。どう対処するか。
   ▶ 答え: 両ツールともトップレベルの `sources` / `sourcesContent` しか見ないが、index map ではそれらが `sections[].map` の中にあるため「no sources found」で落ちる。`jq '.sections[].map'` で各セクションを取り出して個別処理する。

10. unwebpack-sourcemap を診断で使うとき、依存関係についての注意は。
    ▶ 答え: `requirements.txt` のピン留めが 2019 年当時のもので `urllib3` / `requests` が既知脆弱性を含む古い版。必ず venv に隔離する。加えてリポジトリは 2022 年にアーカイブ宣言され将来削除されうるので、PyPI 配布フォークか sourcemapper の利用も検討する。

---

## 出典

- https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d （原典取得できず。同著者 README と二次情報で補完）
- https://raw.githubusercontent.com/rarecoil/unwebpack-sourcemap/HEAD/README.md
- https://raw.githubusercontent.com/rarecoil/unwebpack-sourcemap/HEAD/unwebpack_sourcemap.py
- https://raw.githubusercontent.com/jamesmishra/unwebpack-sourcemap/HEAD/README.md
- https://raw.githubusercontent.com/denandz/sourcemapper/HEAD/README.md
- https://raw.githubusercontent.com/denandz/sourcemapper/HEAD/main.go
- https://raw.githubusercontent.com/tc39/source-map/main/spec.emu
- https://deepwiki.com/denandz/sourcemapper （取得できず。原典リポジトリで代替）
- https://pulsesecurity.co.nz/articles/javascript-from-sourcemaps （取得できず）

<!-- sources: https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d, https://raw.githubusercontent.com/rarecoil/unwebpack-sourcemap/HEAD/README.md, https://raw.githubusercontent.com/rarecoil/unwebpack-sourcemap/HEAD/unwebpack_sourcemap.py, https://raw.githubusercontent.com/jamesmishra/unwebpack-sourcemap/HEAD/README.md, https://raw.githubusercontent.com/denandz/sourcemapper/HEAD/README.md, https://raw.githubusercontent.com/denandz/sourcemapper/HEAD/main.go, https://raw.githubusercontent.com/tc39/source-map/main/spec.emu, https://deepwiki.com/denandz/sourcemapper, https://pulsesecurity.co.nz/articles/javascript-from-sourcemaps -->
<!-- terms: source map, sourcesContent, sourceMappingURL, webpack, SPA, グレーボックス診断, unwebpack-sourcemap, sourcemapper, index source map, パス・トラバーサル, SSRF, data URI, TC39 Source Map仕様, ignoreList, Base64 VLQ -->
<!-- self-read: https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d | medium.comが組織egressポリシーで全面ブロック（403）、ミラーも全滅 -->
<!-- self-read: https://deepwiki.com/denandz/sourcemapper | deepwiki.comがegressポリシーでブロック（自動生成図・対話機能のみ未取得、原典リポジトリで代替済み） -->
