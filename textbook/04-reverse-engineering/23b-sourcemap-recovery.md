# Source Map 復元の実務 — ツールのセキュリティ・webpack `devtool`・開発史から読み解く

> **この節で分かること**
> - 復元ツール（sourcemapper / unwebpack-sourcemap）自体が「向きの反転した脆弱性」の標的になる仕組みと、その守り方を説明できる
> - webpack の `devtool` 設定を公式ドキュメントの逐語にもとづいて分解し、`.map` 漏洩の「質」を即断できる
> - 本番に `.map` があることが「事故」ではなく「設定」である理由と、webpack 公式の警告文を根拠に報告文を書ける
> - git 履歴から両ツールのセキュリティ設計の変遷を追い、なぜその防御コードが必要なのかを説明できる
> - `)]}` プレフィックス（XSSI 対策）や `x_` 拡張フィールドなど、診断で必ず踏む罠を回避できる
> - 許可された診断・バグバウンティ・自前ラボの範囲で、source map 復元の実務ワークフローを最後まで通せる

**元資料**: https://webpack.js.org/configuration/devtool/ ほか（原典 `webpack.js.org` はegressブロックで取得できず、公式サイトのソースが GitHub 管理されていたため `raw.githubusercontent.com/webpack/webpack.js.org/main/src/content/configuration/devtool.mdx` から内容を完全回収。git 履歴は `git clone` で取得した一次資料）
**関連する節**: 本ノートの前半（Source Map の構造・発見方法・復元手順・両ツールの基本、§1〜§6）を前提にする

---

## 0. この節の位置づけ

この節は「Source Map からの SPA ソースコード復元」の後半である。前半では、source map（`.js.map`）とは何か、`sourcesContent` フィールドに元ソースそのものが埋まる仕組み、`.map` の 4 つの発見経路、そして代表ツール 2 本（Python 製の **unwebpack-sourcemap**、Go 製の **sourcemapper**）の基本的な使い方を扱った。

後半のこの節は、そこから一歩踏み込む。**「復元する側」がどう攻撃されうるか**、**webpack がどんな設定で `.map` を吐くのか（公式ドキュメントの逐語）**、**両ツールのセキュリティ設計がなぜ今の形なのか（git 履歴）**、そして**診断者が必ず踏む罠**をまとめる。最後に、これらを統合した実務ワークフローを示す。

最小限の前提だけ補っておく。source map は圧縮・トランスパイル後の JavaScript と元ソースを対応づける JSON ファイルで、`sources`（元ファイルの擬似パスの配列）と `sourcesContent`（元ソースの中身そのものの配列）を持つ。復元とは、この 2 つを組にして `sources` のパスをディレクトリツリーとして書き出すだけの単純な操作である。

---

## 1. 復元ツール自体が攻撃対象になる — 向きが反転した脆弱性

### 1.1 なぜツールが狙われるのか（設計意図）

source map 復元の面白い（そして危険な）点は、**信頼関係が逆転している**ことにある。通常の脆弱性は「攻撃者がサーバを攻撃する」向きだが、ここでは**復元ツールを走らせる診断者が被害者になる**。

理由は単純である。`sources` は**診断対象サイト（＝攻撃者が制御しうる文字列）**であり、復元ツールはそれをファイルパスとしてそのまま使う。つまり悪意ある `.map` を食わせれば、ツールの実行者の環境で悪さができる。攻撃の型は 3 つある。

| 攻撃 | 何が起きるか | 悪用される入力 |
| --- | --- | --- |
| (a) パス・トラバーサル書き込み | `../../` を含む `sources` で、出力ディレクトリの外に任意ファイルを書き込む | `sources[i]` の値 |
| (b) 強制リクエスト / SSRF | 対象 JS の `sourceMappingURL` が指す任意 URL に GET が飛ぶ | `sourceMappingURL` の URL |
| (c) ローカルファイル読み出し | `sourceMappingURL` に `file:` 相当のパスを書き、ツールに手元のファイルを読ませる | `sourceMappingURL` のスキーム |

「復元ツールが攻撃対象になる」という論点は、実際の修正履歴として 8 年分残っている（後述の §4）。

### 1.2 (a) パス・トラバーサルによる任意ファイル書き込み — どう動くか、どう守るか

sourcemapper の防御コードは `main.go` にある。コメントに意図が明記されているので**逐語**で見る。

```go
	for i, sourcePath := range sm.Sources {
		sourcePath = "/" + sourcePath // path.Clean will ignore a leading '..', must be a '/..'
		// If on windows, clean the sourcepath.
		if runtime.GOOS == "windows" {
			sourcePath = cleanWindows(sourcePath)
		}

		// Use filepath.Join. https://parsiya.net/blog/2019-03-09-path.join-considered-harmful/
		scriptPath, scriptData := filepath.Join(outdir, filepath.Clean(sourcePath)), sm.SourcesContent[i]
		err := writeFile(scriptPath, scriptData)
		if err != nil {
			log.Printf("Error writing %s file: %s", scriptPath, err)
		}
	}
```

防御の要点は 3 つで、いずれもコメントが根拠を示している。

1. **先頭に `/` を足してから `filepath.Clean` する。** コメント逐語: `// path.Clean will ignore a leading '..', must be a '/..'`。Go の `Clean` は `"../../etc/passwd"` を**そのまま返す**（相対パス先頭の `..` は除去できない仕様）。しかし `"/../../etc/passwd"` を渡せば `"/etc/passwd"` に正規化され、`..` が根元で吸収される。
2. **`path.Join` ではなく `filepath.Join` を使う。** `path.Join` はスラッシュ前提で Windows のバックスラッシュを区切りとみなさないため、`..\..\` による脱出を許す（この根拠は §5.5 で扱う）。
3. **Windows では追加のサニタイズを行う。**

```go
// cleanWindows replaces the illegal characters from a path with `-`.
func cleanWindows(p string) string {
	m1 := regexp.MustCompile(`[?%*|:"<>]`)
	return m1.ReplaceAllString(p, "")
}
```

正規表現の逐語は `` [?%*|:"<>] ``（`?` `%` `*` `|` `:` `"` `<` `>` の 8 文字）。これにより Windows の代替データストリーム（`file.txt:hidden`）や不正文字によるエラーを防ぐ。

> 〔補足〕この関数はコメントに「`-` に置換する」と書いているが、実装は `ReplaceAllString(p, "")` で**空文字に削除**している。コメントと実装が食い違っている実例で、コードを読むときはコメントを鵜呑みにしない教訓になる。

書き込み時のパーミッションも厳格である（`writeFile` 逐語）。

```go
// writeFile writes content to file at path p.
func writeFile(p string, content string) error {
	p = filepath.Clean(p)

	if _, err := os.Stat(filepath.Dir(p)); os.IsNotExist(err) {
		// Using MkdirAll here is tricky, because even if we fail, we might have
		// created some of the parent directories.
		err = os.MkdirAll(filepath.Dir(p), 0700)
		if err != nil {
			return err
		}
	}

	log.Printf("[+] Writing %d bytes to %s.\n", len(content), p)
	return os.WriteFile(p, []byte(content), 0600)
}
```

ディレクトリは **0700**、ファイルは **0600**（他ユーザに読めない）で作られ、`filepath.Clean` が書き込み直前にもう一度適用される（二重防御）。

unwebpack-sourcemap は別方式で守る。sourcemapper が「パスを正規化して出力配下に押し込める」のに対し、unwebpack は「**パス構成要素ごとに文字ホワイトリストを適用し、`..` を無害化し、最後に出力ルート配下かを前方一致で検証する**」。副作用として、ディレクトリ名から `:` などが消え（`webpack:` → `webpack`）復元ツリーの見た目が元と少し変わる。sourcemapper は Unix では `webpack:/` をそのままディレクトリ名にするので元の見た目に忠実、という違いがある。

> 〔補足〕診断者向けの実務推奨。**信用できない `.map` を展開するときは、使い捨てのディレクトリ・コンテナ・非特権ユーザで実行する**。ツールの防御に依存しきらない。特に `-dir` で第三者提供の map をまとめて処理するときは、`docker run --rm -v "$PWD/out:/out" --network none` のような隔離を併用する。

### 1.3 (b) 強制リクエスト / SSRF — sourcemapper の README が明示的に警告

SSRF（Server-Side Request Forgery、サーバ側リクエスト強要）とは、攻撃者が別のプログラムに「攻撃者の指定した URL へリクエストを送らせる」こと。ここでは診断者の端末がその踏み台になる。

sourcemapper の README 末尾には**逐語**でこう書かれている。

> **Note: sourcemapper will retrieve any URL referenced as a sourcemap, so a malicious JavaScript file parsed with sourcemapper can force sourcemapper to make a GET request to any URL**

コード側のコメントも同じ点を警告している（逐語）。

```go
	// this introduces a forced request bug if the JS file we're parsing is
	// malicious and forces us to make a request out to something dodgy - take care
```

`-jsurl` モード（対象 JS を渡して、そこから `sourceMappingURL` を抽出させるモード）では、その URL が指す**任意のアドレスに GET が飛ぶ**。診断者の端末が社内ネットワークにいれば、内部サービスへの SSRF 踏み台になりうる。守り方は 3 つ。

- `-proxy` で必ず Burp などを通し、送信先を可視化する
- `-url` に手で指定した URL しか触らせない
- 隔離ネットワークで実行する

### 1.4 (c) ローカルファイル読み出しの防止 — `remoteSource` フラグ

`getSourceMap` の docstring（逐語）に、信頼境界の考え方がそのまま書かれている。

```go
// getSourceMap retrieves a sourcemap from a URL or a local file and returns
// its sourceMap. If remoteSource is true, only http/https/data schemes are
// allowed. Local file access is blocked to prevent arbitrary file reads from
// attacker-controlled sourceMappingURL values.
```

実装は 2 箇所（逐語）。

```go
	u, err := url.ParseRequestURI(source)
	if err != nil {
		if remoteSource {
			log.Fatalf("[!] Refusing to read local file from remote sourceMappingURL: %s", source)
		}
```

```go
		} else {
			if remoteSource {
				log.Fatalf("[!] Refusing to read local file from remote sourceMappingURL: %s", source)
			}
			// If it's a file, read it.
			body, err = os.ReadFile(source)
```

つまり `-jsurl` 経由（`remoteSource=true`）では、`http` / `https` / `data` 以外のスキーム、および URL としてパースできない文字列（＝ローカルパス）を**拒否して即終了する**。一方 `-url` / `-dir` はユーザが明示指定した入力なので `remoteSource=false` でローカル読み出しを許す。**信頼境界をフラグ 1 個で表現している良い設計例**である。

### 1.5 (d) `-insecure` の扱い

`-insecure` は `tls.Config{InsecureSkipVerify: true}` を設定する。壊れた証明書のラボホストには便利だが、**本番診断で常用してはいけない**（MITM を招く）。

---

## 2. 防御側の対策（開発者向け）

「ソースが漏れる」問題の当事者は開発者である。unwebpack-sourcemap の README には「I'm a developer and this scares me. What do?（開発者だけど怖い、どうすれば？）」という節があり、選択肢を **逐語訳**で挙げている。

1. **本番では source map を完全にオフにする。**
2. **source map をプライベートなサーバに push し、source map の URI を開発者のみに ACL する。**
3. **source map をローカルソースからのみ読み込み、本番に push しない。**

これに実務的な補足を足す。

- webpack の `devtool` の区別が重要。`source-map` は `.map` を出力し `sourceMappingURL` コメントも付ける。`hidden-source-map` は `.map` を出力するがコメントを付けない（Sentry 等へのアップロード用途）。ただし **`hidden-source-map` は「隠している」わけではない** — `.map` が同じディレクトリに置かれていれば URL 推測で取れてしまう。本番配信ディレクトリから `.map` を物理的に削除（または CDN で 403）するところまでやらないと対策にならない。
- `eval-source-map` 系の `eval` 系は開発専用。本番に出ていれば「dev ビルドが本番にある」明確な所見になる。
- Sentry などのエラー追跡サービスに map をアップロードする運用では、**アップロード後に公開ディレクトリから map を消す CI ステップ**を入れる。
- `.map` を消しても、**`sourcesContent` を含むインライン data URI が JS に残っていないか**を必ず確認する（`grep -l 'sourceMappingURL=data:' dist/`）。
- `.css.map`、`.wasm` のカスタムセクション、`stats.json`、`asset-manifest.json` も同じ扱いで棚卸しする。
- 検出の自動化: CI に「ビルド成果物ディレクトリに `*.map` が存在したら fail」「配信中サイトの全 JS/CSS に `.map` を付けて GET し 200 なら fail」のテストを入れる。

これらの助言の大半は、webpack 公式ドキュメントの逐語に置き換えられる（次の §3）。特に「`hidden-source-map` は隠していない」という指摘は、後述する公式の警告文そのままである。

---

## 3. webpack 公式 `devtool` ドキュメント — 漏洩の「質」を即断する

ここからは webpack 公式ドキュメントの逐語にもとづく。診断で `webpack.config.js` や `stats.json` を読めたとき、`devtool` の値を見て**何がどこまで漏れるか**を即断できるようになるのが目標である。

### 3.1 既定値 — 本番の `.map` は事故ではなく設定

`devtool` オプションは source map を**生成するかどうか、およびどう生成するか**を制御する。型は `string` / `Array<{ type, use }>` / `false` の 3 つ。

**既定値の逐語訳（重要）**: 「既定は `false` である。`mode: 'development'` では JavaScript について `'eval'` が既定になる（`experiments.css` が有効なら CSS には `'source-map'` が加わる）。ただし `module` または `modern-module` の library type を出力する場合は `false` のままになる。」

診断上の意味は決定的である。**本番ビルド（`mode: 'production'`）で `devtool` を書かなければ source map は出ない。** つまり「`.map` が本番にある」＝誰かが明示的に `devtool` を設定したか、dev 設定のまま本番ビルドしたか、のどちらか。**事故ではなく設定である**点を報告文に書ける。

webpack **5.105.0 以降**は、`devtool` をアセット種別ごとの配列で設定できる（逐語の例）。

```js
export default {
  // ...
  devtool: [
    { type: "javascript", use: "source-map" },
    { type: "css", use: "inline-source-map" },
  ],
};
```

`type` は `"all"`（JS と CSS 両方）/ `"javascript"` / `"css"`。文字列を渡した場合は `{ type: "all", use: "<その文字列>" }` として扱われる。**JS 側だけ落としても CSS 側に残る設定がありうる**ので、`.css.map` を必ず別に確認する根拠がここにある。

### 3.2 命名パターン — 28 値を 1 行で分解する

ドキュメントの Tip ブロック（逐語訳）: 「devtool 名を検証する際に一定のパターンを期待している。devtool 文字列の順序を混ぜないよう注意すること。パターンは次のとおり:」

```text
[inline-|hidden-|eval-][nosources-][cheap-[module-]]source-map[-debugids]
```

この 1 行で **28 通りの値が機械的に分解できる**。漏洩に関わる修飾子だけ表にする。

| 修飾子 | 公式説明（逐語訳） | 漏洩の観点での意味 |
| --- | --- | --- |
| `inline-` | source map を別ファイルにせず元ファイルにインライン化する | **`.map` ファイルが存在しない**。バンドル本体に `data:` URI で埋まる。`.map` を GET して 404 でも安心できない決定的理由 |
| `hidden-` | source map への参照を付けない（デプロイはしないがエラー報告目的で生成はしたい場合） | `sourceMappingURL` コメントが**無い**だけ。`.map` は生成されるので**URL 推測で取れる**。「隠す」機能ではない |
| `eval-` | モジュールごとに SourceMap を生成し `eval` 経由で添付する（リビルド性能が改善するため開発向け推奨。なお Windows Defender の問題でウイルススキャンによる大幅な低下が起きる点に注意） | **開発専用**。本番に出ていれば「dev ビルドが本番にある」明確な所見 |
| `nosources-` | source code を SourceMap に含めない（元ファイルを参照させたい場合に有用。さらに設定が必要） | **`sourcesContent` が無い**。原本は取れないが**ファイル名と構造は漏れる** |
| `cheap-` | column マッピングを持たない | 漏洩の質には影響しない（位置精度のみ） |
| `cheap-module-` | loader の Source Map を 1 行 1 マッピングに簡約する | 同上 |
| `-debugids` | パターン中にのみ登場する新しいサフィックス | 同上 |

漏洩に直結するのは `inline-` / `hidden-` / `nosources-` の 3 つだけ。`cheap-` 系は位置精度の話で漏洩の質には無関係である、と覚える。

### 3.3 本番向けの値と公式警告文 — 「公式ガイダンス違反」と書ける

ドキュメントの「Production」節から、本番で使われる値と、それに付いた **Warning ブロックの逐語訳**を並べる。

| 値 | 公式説明（逐語訳） | 公式警告（逐語訳） |
| --- | --- | --- |
| `(none)`（`devtool: false`） | SourceMap は出力されない。**始めるのに良い選択肢** | （警告なし） |
| `source-map` | 完全な SourceMap が別ファイルとして出力され、バンドルに参照コメントを追加する | **「通常の利用者が Source Map ファイルにアクセスできないようサーバを設定すべきである！」** |
| `hidden-source-map` | `source-map` と同じだがバンドルに参照コメントを追加しない | **「Source Map ファイルを web サーバにデプロイすべきではない。代わりにエラー報告ツールのためだけに使うこと。」** |
| `nosources-source-map` | `sourcesContent` を含まない SourceMap。**web サーバにデプロイしてよい。** | **「それでも逆コンパイルのためのファイル名と構造は露出する。ただし元のコードは露出しない。」** |

`production` 列が `yes` の値は全 5 つ（`(none)` / `source-map` / `nosources-source-map` / `hidden-nosources-source-map` / `hidden-source-map`）で、**残りの 23 値はすべて `production: no`**（`eval-*` / `inline-*` / `cheap-*` 系）。

報告文に直接使える公式根拠は次のとおり。

1. `source-map` を本番で使い `.map` を誰でも取れる → **webpack 自身が「`.map` へのアクセスを禁止するようサーバを設定せよ」と明示的に要求している**のに従っていない、と書ける。
2. `hidden-source-map` で `.map` が配信されている → **webpack 自身が「web サーバにデプロイするな」と警告している**設定を、警告どおりに運用していない、と書ける。
3. `nosources-source-map` は**公式が「デプロイしてよい」と言っている唯一の map 出力**。したがってこれ単体を高リスク所見にするのは筋が悪い。ただし公式警告どおり**ファイル名と構造は漏れる**ので、`sources` / `names` からの内部構成・命名規則の収集として報告する。

### 3.4 品質（quality）の語彙 — 何が復元されるかの公式定義

「復元結果が TS の原本なのか、トランスパイル後の JS なのか」は品質の語彙で決まる。逐語訳で対応表にする。

| 品質 | 公式定義（逐語訳） | 復元されるもの |
| --- | --- | --- |
| `bundled code` | 生成コード全体が 1 つの大きな塊として見える | バンドルそのまま（map 無し） |
| `generated code` | 各モジュールが分離され、webpack 変換後のコードが見える | webpack 変換後 |
| `transformed code` | webpack 変換前・Loader トランスパイル後のコードが見える | トランスパイル後（TS の型は消えている） |
| `original source` | **各モジュールが分離され、モジュール名が注記され、トランスパイル前の、あなたが書いたままのコードが見える**（Loader の対応に依存する） | **原本（TS/JSX/Vue SFC のまま）← 本命** |
| `without source content` | ソース内容は含まれない | 内容なし（`nosources-*`） |
| `(lines only)` | 1 行 1 マッピングに簡約 | 位置精度のみ低下 |

**`quality: original` の値だけが「原本が読める」**。復元結果が TS ではなくトランスパイル後の JS だった場合、`cheap-*` / `transformed` 系が使われていると推定でき、逆に設定を推測する手がかりになる。

### 3.5 追跡すべき関連オプション

設定ファイルや `stats.json` が読めたとき追うべきキー。

- `output.sourceMapFilename` — Source Map のファイル名をカスタマイズする。**`.map` が `<bundle>.js.map` という素朴な名前でない可能性**。`.map` 総当りが失敗しても map が無いとは限らない。
- `output.devtoolModuleFilenameTemplate` — `nosources-*` で `sources` の URL を実在パスに合わせる設定。**ここに開発機の絶対パスを入れている現場があり、`sources` から内部ディレクトリ構造が漏れる**。
- `SourceMapDevToolPlugin` / `EvalSourceMapDevToolPlugin` — `devtool` オプションの代わりに直接使うプラグイン（併用禁止）。**`devtool` が設定ファイルに無くてもプラグイン側で map が出ている**ことがある。「`devtool` が無いから安全」とは言えない。
- `Rule.extractSourceMap` — 既存の source map を扱うためのルール。
- ミニマイザ差し替え時の注記（逐語訳）: 「既定の webpack `minimizer` を上書きしている場合、その代替にも `sourceMap: true` を設定して SourceMap 対応を有効にすること。」
- webpack リポジトリには**全 `devtool` 値の効果を示す公式サンプル**がある（https://github.com/webpack/webpack/tree/master/examples/source-map ）。各値でビルドして出力物を比較する**ラボ教材として最適**。

---

## 4. 両ツールの開発史 — git 履歴から読むセキュリティ設計の変遷

DeepWiki（自動生成ウィキ）は取得できなかったが、原典リポジトリの完全な git 履歴を `git clone` で取得できたので、それで代替する。以下のハッシュ・日付・メッセージ・差分はすべて実物の逐語である。

### 4.1 sourcemapper の年表（全 40 コミット、2018-09-07 〜 2026-07-24）

HEAD は `f739bd5`（完全ハッシュ `f739bd5dd266b0d0e2cfa17c0a132f79bd9a5ba9`、コミット日時 2026-07-24 21:12:36 +1200）。**タグ／リリースは 1 つも打たれていない**（`git tag -l` が空）ので、`go install ...@latest` は常に main HEAD を取る。診断で使うなら**コミットハッシュを記録せよ**（バージョン番号で固定できない）。記録するときは短縮ハッシュではなく、上記のような完全ハッシュを残しておくと後で再現・照合しやすい。

セキュリティ・機能上の主要コミット（逐語メッセージ付き）。

| 日付 | ハッシュ | 作者 | メッセージ（逐語） | 意味 |
| --- | --- | --- | --- | --- |
| 2018-09-07 | `e01f4d2` | DoI | `Initial commit` | 初版。`path.Join` + `path.Clean` のみ |
| **2018-09-11** | **`c0d4beb`** | DoI | **`Fixed dir traversal on leading ..`** | **リリース 4 日で脆弱と判明したトラバーサル修正** |
| 2019-07-31 | `23ac2f5` | DoI | `Added link to sourcemapper post` | README に pulsesecurity 記事リンク追加 |
| **2020-05-27** | **`eee1d1a`** | **parsiya** | `Added a few features...` | **`path.Join`→`filepath.Join` + Windows サニタイズ** |
| 2020-06-24 | `d396eef` | DoI | **`...Folders on *nix were created with mode 000`** | **パーミッションのバグ修正** |
| 2020-12-19 | `7468a04` | R3zk0n | `Added Cookie parameter` | **`-header` の前身**。まず Cookie 専用の認証対応が入った（Cookie 専用 → 汎用への物語の起点） |
| 2020-12-21 | `0308323` | DoI | `Add multi-header support...` | Cookie 専用 → 汎用 `-header` に置換 |
| 2021-03-14 | `62e0fdd` | DoI | `Added -insecure flag...` | `-insecure` 導入 |
| 2021-03-16 | `baaed2b` ほか | poptart | `Added explicit proxy handling` | `-proxy` 導入 |
| 2022-03-25 | `d1b85c4` | DoI | `Create go mod file` | `go.mod`（`go 1.16`）追加。**2018〜2022 は go.mod 無しだった** |
| 2023-07-24 | `0adc84c` | DoI | `Added processing logic for non-200 responses` | 非200でも body があれば続行 |
| 2023-07-24 | `02d6d3e` | DoI | `Better warning for json deserialization problems` | JSON パース失敗時の警告改善（XSSI プレフィックスを踏んだときの手がかりになる） |
| **2024-01-05** | **`c55342b`** | DoI | **`Added sourcemap extraction from JavaScript files`** | **`-jsurl` モードと `data:` URI 対応** |
| 2024-03-22 | `f1becf5` | Alexandre ZANNI (noraj) | `add BA install step` | README に BlackArch の `pacman -S sourcemapper` を追記 |
| **2026-04-17** | **`a5c8b89`** | **gnomegl** | **`Add -dir flag for batch processing...`** | **`-dir` モード導入** |
| **2026-07-24** | **`f739bd5`** | DoI | **`prevent remote sourcemapping urls from reading local file paths`** | **`remoteSource` によるローカル読み出し防止（最新）** |

`-dir` 導入コミット `a5c8b89` の本文（逐語、抜粋）は設計意図を明記している。

> Recursively walks a directory, finds all .map files, and extracts their sources into the output directory. Useful for offline analysis of sourcemaps already on disk (prior downloads, CI artifacts, etc).
>
> ... Batch mode logs errors and continues on bad files; single-file mode (-url/-jsurl) preserves the existing log.Fatal behavior on empty or invalid sourcemaps.

「CI アーティファクトや事前ダウンロード済みの map をオフライン解析する」用途が作者自身の言葉で示されている。また「バッチモードはエラーをログして継続、単一ファイルモードは `log.Fatal` を維持」という**挙動差が意図的**である点も確定する。

### 4.2 セキュリティ修正 3 件の実物差分

#### (1) 2018-09-11 `c0d4beb` — トラバーサル修正の原型

```diff
 	for i, sourcePath := range sm.Sources {
+        sourcePath = "/" + sourcePath // path.Clean will ignore a leading '..', must be a '/..'
 		scriptPath, scriptData := path.Join(*outDir, path.Clean(sourcePath)), sm.SourcesContent[i]
 		writeFile(scriptPath, scriptData)
 	}
```

初版は `path.Join(*outDir, path.Clean(sourcePath))` だけだった。つまり **`sources` に `../../../../etc/cron.d/x` を仕込んだ悪意ある `.map` で、ツール実行者のファイルシステムに任意書き込みができた**。修正はたった 1 行、`sourcePath = "/" + sourcePath` の追加。「ライブラリの正規化関数を呼んでいるから安全」ではないことの具体例である。

#### (2) 2020-05-27 `eee1d1a`（parsiya）— `path` → `filepath` への移行

```diff
-    p = path.Clean(p)
+	p = filepath.Clean(p)
...
+		if runtime.GOOS == "windows" {
+			sourcePath = cleanWindows(sourcePath)
+		}
+		// Use filepath.Join. https://parsiya.net/blog/2019-03-09-path.join-considered-harmful/
+		scriptPath, scriptData := filepath.Join(*outDir, filepath.Clean(sourcePath)), sm.SourcesContent[i]
```

**教科書的に面白い点**: コード内コメントが引用する記事 `https://parsiya.net/blog/2019-03-09-path.join-considered-harmful/` の**著者本人（`parsiya`）が、この修正コミットの作者である**。「`path.Join` は Windows のバックスラッシュを区切りと見なさないためトラバーサルを許す」と論じた人が、その知見を実際の OSS に適用した形。

同コミットは README の Limitations も書き換えている（逐語）。

```diff
-Paths such as 'webpack:/~/src/whatever/omg.js' are pretty common, so this tool will likely fail on NTFS file systems. EXT4 works fine though :D
+Paths such as 'webpack:/~/src/whatever/omg.js' are pretty common, so this tool cleans them up on windows.
```

**2018〜2020 の sourcemapper は NTFS（Windows）上では動かないと README が公言していた**（`webpack:/~/...` の `:` が Windows で不正文字だったため）。

#### (3) 2020-06-24 `d396eef` — パーミッションのバグ

```diff
-		err = os.MkdirAll(filepath.Dir(p), os.ModeDir)
+		err = os.MkdirAll(filepath.Dir(p), 0700)
```

`os.ModeDir` は**パーミッションビットではなくファイル種別ビット**（`d`）である。これを mode 引数に渡すと**許可ビットが全てゼロ（mode 000）のディレクトリ**が作られ、作成直後に自分でも中に入れない。**Go の `FileMode` 型が種別と許可を同じ型で表すことに起因する古典的な取り違え**である。

> 〔補足〕もう 1 件、2024-01-05 の `c55342b` で `-jsurl` を入れたとき、ログ出力に `source[:1024]` というスライス式を書いてしまい、URL が 1024 バイト未満だと `panic: slice bounds out of range` で必ず落ちるバグが入った。**同日**の `45f19bd` で書式指定子 `%.1024s`（`fmt` の精度は安全に切り詰める）に置き換えて修正している。前半ノートが引用した `%.1024s` はこの修正後の姿である。

### 4.3 unwebpack-sourcemap の年表と、記事公開前日の README

**最重要の発見**: 初公開コミット `8cb367c` は **2019-06-12**、Medium 記事の公開日は **2019-06-13**。つまり**リポジトリ公開の翌日に記事が出ている**。そして `8cb367c:README.md` の冒頭は、記事の中心的主張と**実質同一のテキスト**である。以下が 2019-06-12 時点の README 冒頭の逐語（英語原文）。

> As single-page applications take over the world, more and more is being asked of the browser as a client. It is common for SPAs to use [Webpack](https://webpack.js.org/) to handle browser script build processes. ...
>
> ... developers of SPAs assume the use of JavaScript as an **intermediate representation**. ... If this is the case, the sourcemap is akin to leaking your source alongside the "binary" (bundle) you have made. The bundle can be reverse engineered just as a binary can, but sourcemaps make this far easier.

「JavaScript を中間表現（intermediate representation）として扱う」「バイナリ出荷への類比」「source map はバイナリと一緒にソースを漏らすのに等しい」という論旨は、**記事公開前日に著者自身が英語で書いた文章として現存する**。教科書で引用する際はこの README（コミット `8cb367c`, 2019-06-12）を出典にすれば、Medium 記事を読めなくても一次資料として引用できる。

unwebpack の主要コミット（逐語メッセージ付き）。

| 日付 | ハッシュ | 作者 | メッセージ（逐語） | 意味 |
| --- | --- | --- | --- | --- |
| **2019-06-12** | `8cb367c` | rarecoil | `first public commit` | **Medium 記事公開の前日**。README・本体・ラボが一度に公開 |
| 2019-11-02 | `cb6c65f` | dependabot | `Bump lodash from 4.17.10 to 4.17.15 in /example-react-ts-app` | 同梱ラボアプリの依存更新（自動 PR） |
| 2019-11-02 | `453c5c7` | rarecoil | `npm audit fix` | 同梱ラボの依存脆弱性の自動修正 |
| 2019-12-08 | `9e3dc1e` | rarecoil | `security patches` | 同梱ラボの依存脆弱性対応 |
| 2020-03-19 | `86bd230` | rarecoil | `fix #5` | Issue #5 の修正 |
| 2020-10-14 | `fb558a8` | Agus Setya R | `Fix UnicodeEncodeError...in Python3` | Windows 既定コードページでの書き出し失敗を修正 |
| 2021-01-22 | `dc91d9c` | RA80533 | `Strip whitespace before splitting file contents` | 末尾改行で最終行が空になる検出漏れを修正 |
| 2021-01-22 | `25b373a` | RA80533 | `Change False to None` | 戻り値の型整理（`False` → `None`） |
| 2021-01-22 | `f814cd6` | RA80533 | `Recurse on redirects` | リダイレクト再帰処理の由来 |
| 2021-01-22 | `8c30252` | RA80533 | `Update _get_remote_data()` | リモート取得処理の整理 |
| 2021-04-10 | `1ccd5e0` | Arthur A | `Add --disable-ssl-verification` | SSL 検証無効フラグ |
| 2021-05-27 | `00beb3e` | dee-see | `Do not crash on empty content` | `sourcesContent` に null/空が混じる map への対策 |
| **2021-05-31** | **`b9570b2`** | Kartik Soneji | **`Fix \r\r for source files with CRLF line endings`** | **`newline=''` の由来** |
| 2021-05-31 | `4336d0e` | Kartik Soneji | `Refactor source writing loop.` | 書き出しループの整理 |
| **2022-04-15** | `7fa8ef2` | rarecoil | `Update README.md` | **アーカイブ通知の追記（最後のコミット）** |

`b9570b2` の差分（逐語）。

```diff
-                    with open(write_path, 'w', encoding='utf-8', errors='ignore') as f:
+                    with open(write_path, 'w', encoding='utf-8', errors='ignore', newline='') as f:
```

Python のテキストモード書き込みは既定で `\n` を OS の行区切りに変換する。`sourcesContent` が既に CRLF（`\r\n`）を含むと、変換で **`\r\r\n` になってしまう**。`newline=''` は変換を無効化して原本のバイト列を保つ。**復元ソースをそのまま diff や再ビルドに使う診断では、この 1 引数の有無で結果が壊れる**。

> 〔補足〕リポジトリは 2022-04-15 にアーカイブ宣言されたが、2026-09 時点で **`git clone` はまだ成功する**（README の「最終的に削除する」は未実行）。必要なら手元に `git clone` して保全しておくのが安全。

### 4.4 同梱ラボアプリ — 事故の最小再現

unwebpack には `example-react-ts-app/` という「意図的に source map を漏らす TypeScript+React サンプル」が同梱されている。本番設定 `configs/webpack/prod.js` の全文（逐語）。

```js
// production config
const merge = require('webpack-merge');
const {resolve} = require('path');

const commonConfig = require('./common');

module.exports = merge(commonConfig, {
  mode: 'production',
  entry: './index.tsx',
  output: {
    filename: 'js/bundle.[hash].min.js',
    path: resolve(__dirname, '../../dist'),
    publicPath: '/',
  },
  devtool: 'source-map',
  plugins: [],
});
```

**`mode: 'production'` と `devtool: 'source-map'` が同居している**。これが §3.3 の公式警告（「利用者が Source Map ファイルにアクセスできないようサーバを設定すべき！」）に対応せず本番ビルドする、という**現実の事故の最小再現**である。出力名 `js/bundle.[hash].min.js` から `.map` は `dist/js/bundle.<hash>.min.js.map` に出る（`output.sourceMapFilename` 未設定なので既定の `[file].map`）。

対して**開発側の設定** `configs/webpack/dev.js` は `devtool: 'cheap-module-eval-source-map'` を使っている。これは **webpack 4 時代の名称**で、webpack 5 では `eval-cheap-module-source-map` に相当する（§3.2 の命名パターンの順序に合わせて綴りが変わった）。ここが教訓で、**dev には `eval-` 系（開発専用・リビルド高速）、prod には `source-map`（別ファイル）** と、開発用と本番用で明確に別の値を割り当てている。事故はこの設計自体ではなく、**`source-map` を選んだうえで `.map` へのアクセス制御をしないまま公開する**点にある。

#### 復元後に何が見えるはずか — 完全なファイル構成

このラボを復元したとき、`output/` にどんなツリーが出るはずかを事前に知っておくと「取りこぼしなく復元できたか」の答え合わせになる。`git ls-files` で得た**実物のファイル一覧**は次のとおり（`App.tsx` と `.scss` だけでなく、テスト・モック・各種設定ファイルまで含まれる）。

```text
example-react-ts-app/src/components/App.tsx
example-react-ts-app/src/index.tsx
example-react-ts-app/src/index.html.ejs
example-react-ts-app/src/assets/scss/App.scss
example-react-ts-app/src/assets/img/react_logo.svg
example-react-ts-app/tests/App.test.tsx
example-react-ts-app/tests/__mocks__/fileMock.js
example-react-ts-app/tests/__mocks__/shim.js
example-react-ts-app/tests/__mocks__/styleMock.js
example-react-ts-app/configs/webpack/common.js
example-react-ts-app/configs/webpack/dev.js
example-react-ts-app/configs/webpack/prod.js
example-react-ts-app/configs/jest.json
example-react-ts-app/configs/jest.preprocessor.js
example-react-ts-app/express.js
example-react-ts-app/tsconfig.json
example-react-ts-app/tslint.json
```

ここで注目すべきは、`sources` に**テストコード（`tests/App.test.tsx`）・Jest のモック（`__mocks__/*.js`）・`tsconfig.json` / `tslint.json` といった設定ファイル**まで含まれうる点である。実際の診断でも、復元ソースにテストやモックが混じっていれば**そこにダミーでない資格情報や内部エンドポイントが残っている**ことがあり、読む価値が高い（§7 の手順 9 で「テストコードやモックに残った資格情報」を挙げているのはこのためである）。

このラボを `npm run build` → `express.js` で配信 → `unwebpack_sourcemap.py --detect http://localhost:<port>/ output` と回せば、**`output/src/components/App.tsx` が TSX のまま出る**ことを確認でき、上の一覧と突き合わせて**期待した全ファイルが揃ったか**を検証できる。`.scss` も `sources` に含まれるので `.css.map` の話ともつなげられる。手順 1〜9（後述の §7）を通しで練習できる格好の教材である。

---

## 5. 周辺公式ドキュメントからの補完 — 診断者が必ず踏む罠

### 5.1 XSSI 対策の `)]}` プレフィックス

XSSI（Cross-Site Script Inclusion、クロスサイトスクリプトインクルージョン）とは、他サイトの JSON 等を `<script src>` で読み込んで秘密を盗む古典的攻撃。その対策として、Ryan Seddon の 2012 年の記事（現 `developer.chrome.com/blog/sourcemaps/`、原稿の front matter には `is_outdated: true` と後継 `https://web.dev/source-maps/` が明記）は次を推奨している。逐語訳。

> ... これを緩和するため、**source map の 1 行目の先頭に `)]}` を付けて意図的に JavaScript として不正にし、構文エラーを投げさせる**ことが推奨される。WebKit の開発ツールはこれを既に扱える。

消費側の処理（逐語）。

```js
if (response.slice(0, 3) === ")]}") {
    response = response.substring(response.indexOf('\n'));
}
```

**診断上の帰結**（ここはコードを読んだ上での推論）。

- **`)]}` で始まる `.map` は JSON パーサが必ず失敗する。** sourcemapper は `json.Unmarshal` を、unwebpack は `json.loads` を直接呼び、**どちらも先頭行を剥がす処理を持たない**。よって XSSI 対策済みの map には「Failed to parse sourcemap ... Are you sure this is a sourcemap?」等で落ちる。
- したがって**ツールがパースに失敗しても「これは source map ではない」と結論してはいけない。** `head -c 16 foo.js.map` で先頭を見て、`)]}` 系があれば `tail -n +2` で剥がしてから再投入する。
- 防御側の助言としても使えるが、**これは情報漏洩対策ではない** — `.map` を fetch/curl できる相手には中身がそのまま読まれる。「XSSI 対策したから安全」と混同させないこと。

#### `sourcesContent` が登場する前の map の形

同じ記事の「The anatomy of a source map」節は、当時（2012 年）の map の例 JSON を **Closure Compiler が生成する形**として載せている（逐語）。

```json
{
    version : 3,
    file: "out.js",
    sourceRoot : "",
    sources: ["foo.js", "bar.js"],
    names: ["src", "maps", "are", "fun"],
    mappings: "AAgBC,SAAQ,CAAEA"
}
```

注目すべきは、**この頃の map には `sourcesContent` フィールドがまだ無い**点である。`version` / `file` / `sourceRoot` / `sources` / `names` / `mappings` の 6 つだけで、**元ソースの中身そのものは含まれていない**。現代の map（§5.2 で見る web.dev の例）が `sourcesContent` を持つのと対比すると、「原本が丸ごと復元できる」という本章の前提は**`sourcesContent` が普及した後の話**だと分かる。古い map や `nosources-*` 設定の map では `sources`（ファイル名の並び）と `names`（識別子の並び）しか得られないことがある。

各フィールドの説明（逐語訳）。

- `sourceRoot` — 「ソースにフォルダ構造を前置できる。**これも省スペース技法である**」（全 `sources` に共通の接頭辞を 1 か所にまとめて重複を減らす）。
- `names` — 「コード全体に現れる**全ての変数名／メソッド名**を含む」。よって `sourcesContent` が無くても、`names` から内部の命名規則・API 名の語彙は読める。
- `mappings` — 「**Base64 VLQ 値を使って魔法が起きる場所**。真の省スペースはここで行われる」。生成コードの位置と元コードの位置の対応が、この一見ランダムな文字列に符号化されている。

この記事は当時の V3 仕様を **Google Docs** として参照しているが、**現在の規範は TC39 の https://tc39.es/source-map-spec/ に移っている**。教科書では TC39 版を引くべきで、Google Docs 版は歴史的文脈としてのみ触れる。また記事は `sourceURL` / `displayName` の慣習も紹介しており、**`eval` されたコードに `sourceURL` が残っていると、そこからも map を辿れる**。

### 5.2 web.dev「What are source maps?」（2023）— 拡張フィールドと限界

後継記事（著者 jecelynyeen、2023-03-31）から 2 点。

この記事が載せる**典型的な map の実例（逐語）**は、§5.1 で見た 2012 年の形と違い **`sourcesContent` を含む現代的な形**である。

```js
{
  "mappings": "AAAAA,SAASC,cAAc,WAAWC, ...",
  "sources": ["src/script.ts"],
  "sourcesContent": ["document.querySelector('button')..."],
  "names": ["document","querySelector", ...],
  "version": 3,
  "file": "example.min.js.map"
}
```

`sources[i]` にファイル名、`sourcesContent[i]` に**その中身そのもの**が入る。この 1 対 1 対応こそが「原本を丸ごと復元できる」根拠であり、§5.1 の 6 フィールド時代との決定的な差である。

記事は `mappings` を復号したときの表記として `65-> 2:2` という読み方も示している。意味は「**生成コード側では圧縮後の位置 65 から始まり、元コード側では 2 行 2 列から始まる**」。可視化ツールに map を投げるとこの形で対応が表示されるので、記法を知っておくと読み解きが速い。

**`x_` 拡張フィールドの規約（逐語訳）**: 「source map は拡張をサポートする。拡張は **`x_` という命名規約で始まるカスタムフィールド**である。一例が Chrome DevTools が提案した `x_google_ignoreList` である。」→ 診断では `jq 'keys' foo.js.map` で map のトップレベルキーを必ず列挙し、見慣れない `x_*` の中身を確認する（ビルドツール独自の情報が入っていることがある）。

**map の限界（「It's not perfect」節、逐語訳）**: 「例では変数 `greet` がビルド過程で最適化により消えた。値は最終的な文字列出力に直接埋め込まれた。（…）コードをデバッグしても開発ツールは実際の値を推論・表示できないことがある。（…）**コードの監視と解析も難しくする**。」→ **診断上の含意**: 復元したソースは「開発者が書いた原本」だが、**最適化で消えた変数・インライン化された定数は、復元ソースを読んでも実行時の値が分からない**。ハードコード値を探すときは、復元ソースとバンドル本体（minified JS）の**両方**を grep する。

記事はビルドツールとして TypeScript, Dart, CoffeeScript, SCSS, LESS, PostCSS, Angular, React, Vue, Svelte, Next.js, Nuxt, Astro などを列挙しており、**`webpack://` 以外の擬似スキームもありうる**ことを示唆する。バンドラごとに `sources` の語彙は次のように違う。

| バンドラ／言語 | `sources` に現れる語彙の例 |
| --- | --- |
| webpack | `webpack://<プロジェクト名>/./src/...` |
| Next.js | `webpack-internal:///` |
| Vite | `/@fs/`（実ファイルの絶対パス）、`\0` 付きの仮想モジュール（プラグイン生成のモジュールは先頭にヌル文字 `\0` が付く） |
| esbuild | 相対パスがそのまま入ることが多い |
| Dart | ソース名が `.dart` 拡張子で現れる |

これらは丸暗記するものではなく、**復元前に `sources` を一覧して語彙を観察する**のが正しい。復元前に語彙を掴むには次を打つ。

```bash
jq -r '.sources[]' foo.js.map | sed 's|/[^/]*$||' | sort -u | head -50
```

可視化ツール（`mappings` の Base64 VLQ を目で追いたいとき）は https://sokra.github.io/source-map-visualization/ （webpack 作者製）、https://evanw.github.io/source-map-visualization/ （esbuild 作者製）。**mappings の手計算は不要、可視化ツールに投げるのが実務的**。

なお記事は、最適化で消えた変数を map で追えないという限界の解決には「source map 仕様と実装をエコシステム全体で改善する必要がある」と述べ、その活発な議論として https://github.com/source-map/source-map-rfc/issues/12 （**スコープ情報を source map に含める将来の拡張**の議論）を挙げている。教科書で「今後」を語るなら参照する価値がある。

### 5.3 MDN: `SourceMap` レスポンスヘッダ（規範の裏取り）

MDN 本文の逐語訳。

> HTTP **`SourceMap`** レスポンスヘッダは、そのリソースに対する source map の場所を提供する。HTTP `SourceMap` ヘッダは**ソースアノテーション（`sourceMappingURL=path-to-map.js.map`）より優先され**、両方が存在する場合はヘッダの URL が使われる。

構文（逐語）。

```http
SourceMap: <url>
X-SourceMap: <url> (deprecated)
```

例（逐語）。

```http
HTTP/1.1 200 OK
Content-Type: text/javascript
SourceMap: /path/to/file.js.map

<optimized-javascript>
```

「ヘッダはアノテーションより優先」「`X-SourceMap` は非推奨」「**ヘッダ値は相対 URL でもよい**（リクエスト URL 基準で解決）」の 3 点を、MDN からも裏取りできる。

### 5.4 Firefox DevTools「Use a source map」— 別ホストを指す例

Firefox の DevTools ドキュメント本文（逐語訳、要点）。

> ... source map を扱えるようにするには、source map を生成し、**変換後のファイルに source map を指すコメントを含める**。コメントの構文は次のようになる:

```javascript
//# sourceMappingURL=http://example.com/path/to/your/sourcemap.map
```

**ブラウザベンダのドキュメントが「絶対 URL（別ホスト）を書く例」を示している**点が診断上有用である。`sourceMappingURL` が**別ホスト**を指す運用が現実にあり、対象ドメインだけを見ていると map の在処を見落とす。

### 5.5 「path.Join Considered Harmful」— コードコメントが引用する記事

sourcemapper のコメントが引用する記事（著者 parsiya、2019-03-09）の中身。TL;DR は逐語で「Instead of path.join use filepath.Join.」。

問題の核心（逐語訳）: 「`path.Join` は複数のパスを連結する。問題は、**OS に関係なく `/` を区切りとして使う**ことである。ソースを見れば分かる:」記事は根拠として Go 標準ライブラリ `path.Join` の実装そのものを引用している（逐語）。

```go
func Join(elem ...string) string {
	for i, e := range elem {
		if e != "" {
			return Clean(strings.Join(elem[i:], "/")) // <---
		}
	}
	return ""
}
```

`strings.Join(elem[i:], "/")` の部分がすべてで、**連結に必ず `/` を使う**（`runtime.GOOS` を一切見ない）。だから Windows でも区切りは `/` になる。「なぜ壊れるか」の根拠は結論ではなくこの 1 行にある。記事の最小再現例（逐語）。

```go
	path1 := "c:\\windows\\system32"
	path2 := "drivers\\etc\\hosts"
	fmt.Println(path.Join(path1, path2))
```

結果（逐語）。

```text
c:\windows\system32/drivers\etc\hosts
```

正しくない壊れたパスが出る。対策は `filepath.Join`（OS 固有の区切りを使う）か、全パスを `/` に正規化する方法である。後者について記事著者は、自分の別ツール **borrowedtime** で「全パスを `/` に正規化する」対策を実際に採ったと、コミットへのリンク付きで書いている（`https://github.com/parsiya/borrowedtime/commit/e35b32d891bb160e8b03903de5ebdfd3f2db083b`）。`c:/windows/system32/drivers/etc/hosts` のように `/` 区切りにしても Windows のパスとして受け入れられるため成立する。

**重要な留保**（記事とコードを突き合わせた推論）。

- **記事の主題は「セキュリティ」ではなく「Windows での正しさ（correctness）」である。** 記事は traversal や脆弱性という語を使っていない。
- しかし sourcemapper の文脈ではこれが直接セキュリティ問題になる。`path.Clean` も `/` 区切り前提なので、Windows 上で `sources` に `..\..\..\Windows\System32\drivers\etc\hosts` のような値が入ると、**`\` が区切りと認識されず `..` が正規化されない**。§4.2(2) の防御はこの穴を閉じている。
- したがって教科書では「記事は correctness の話として書かれており、sourcemapper がそれをセキュリティ境界の話として適用した」という順序で紹介するのが正確。コミット `eee1d1a` の作者が記事著者本人である事実と合わせると、筋の通った物語になる。

Go 公式ドキュメント（`pkg.go.dev/path`）の逐語も主張と一致する。

> Package path implements utility routines for manipulating slash-separated ... operating system paths, use the path/filepath package.

---

## 6. 自分で開くべき資料

本セッションの執筆環境からは、記事本体（Medium / DeepWiki / Pulse Security）が組織egressポリシーで取得できなかった。要点は上記のとおり一次資料（README・git 履歴・公式ドキュメント）で代替済みだが、原典を自分の環境で開くと得られるものを示す。

> ### 📌 ここは自分で開いて読んでください
> **資料**: rarecoil「SPA source code recovery by un-Webpacking source maps」 — https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `medium.com` がegress許可リスト外で CONNECT 403、ミラーも全滅、Medium は JS 前提でテキスト化不可）。以下の記述は同著者の初版 README（git 履歴）と二次情報にもとづく要約である。
> **読みどころ**:
> 1. 「JavaScript を中間表現として扱う」論点と、source map 漏洩を「バイナリと一緒にソースを出荷すること」に喩える議論（導入の比喩。ただし §4.3 の初版 README で代替可能）
> 2. **`--detect` 機能を作った動機と設計判断**（なぜ「HTML の `<script src>` を列挙 → 各 JS の末尾行を見る」順にしたのか。これは記事にしか無い情報）
> 3. 復元後のディレクトリ構造のスクリーンショット（「開発者が見ていた構造に極めて近い」実際の見た目）
> 4. TypeScript の型宣言が復元される意味（ブラックボックス → グレーボックスへの格上げ）
> 5. 記事末尾の remediation（本番で source map を有効にしない）
> **代替手段**: 記事公開前日（2019-06-12）の初版 README が論旨と実質同一。`git clone https://github.com/rarecoil/unwebpack-sourcemap.git` → `git show 8cb367c:README.md`（§4.3 に逐語収録済み）。自分の環境からなら素の Medium URL、次に `https://freedium.cfd/<Medium URL>` を試す〔後者は一般に知られた Medium リーダーだが本セッションでは到達性を確認できていない〕。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DeepWiki「denandz/sourcemapper」 — https://deepwiki.com/denandz/sourcemapper
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `deepwiki.com` がegress許可リスト外で CONNECT 403）。DeepWiki は当該 GitHub リポジトリの自動生成ウィキであり、原典（README 全文・`main.go` 全文・全 40 コミット履歴）を直接取得したため、実装・使い方・変更経緯の欠落は無い。
> **読みどころ**:
> 1. 自動生成されたアーキテクチャ図／呼び出しグラフ（`main` → `getSourceMapFromJS` → `getSourceMap` → `processSourceMap` → `writeFile` の流れ）
> 2. 対話質問機能で「`remoteSource` はどこで true になるか」等をコード横断で聞ける
> 3. コミット履歴を踏まえた説明（§4.1・§4.2 で全 40 コミットの年表と差分を収録済み。`-jsurl` は `c55342b`、`-dir` は `a5c8b89`、`remoteSource` は `f739bd5`）
> **代替手段**: `git clone https://github.com/denandz/sourcemapper.git` → `git log --reverse` と `git show <hash>`。未取得は (a) 自動生成図、(b) コード横断リンク、(c) 対話質問の 3 点のみ。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Pulse Security「Getting JavaScript source from sourcemaps」 — https://pulsesecurity.co.nz/articles/javascript-from-sourcemaps
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `pulsesecurity.co.nz` がegress許可リスト外で CONNECT 403、アーカイブも全滅）。sourcemapper README が「その目的を説明した記事」として挙げる姉妹記事。以下は git 履歴から得た文脈情報にもとづく。
> **読みどころ**:
> 1. sourcemapper を書くに至ったペネトレーションテストの実例と、診断がどう変わったか
> 2. Go 実装を選んだ理由と Python 版（unwebpack）との棲み分け
> 3. 診断レポートでの所見の書き方（source map 漏洩を単独報告するか、他所見の前提とするか）
> 4. README の Docker Hub の実例（23MB の map から 1,828 ファイル・20MB 復元）の開示プロセス
> **代替手段**: 記事本文の代わりに、§4.3 の初版 README の論旨・§3.3 の webpack 公式警告文・後述 §7-10 の報告方針で目的は代替できる。記事へのリンクが README に追加されたのは 2019-07-31（`23ac2f5`）で、ツール公開（2018-09-07）の約 11 か月後なので、`-jsurl`/`-dir`/`remoteSource`（2024〜2026）の説明は記事に無いと考えてよい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: TC39 Source Map 仕様 — https://tc39.es/source-map-spec/
> **なぜ**: 本文の内容は `raw.githubusercontent.com/tc39/source-map/main/spec.emu` から取得済みだが、整形済みの規範文を読むには公式ページが見やすい。
> **読みどころ**:
> 1. フィールド定義の規範文と `sourcemap` / `x-sourcemap` ヘッダの優先順位
> 2. `#linking-generated-code` 節（sourcemapper が準拠を宣言している箇所）
> 3. index source map の `sections`
> **代替手段**: `git clone https://github.com/tc39/source-map.git` で `spec.emu` をテキストで読める。

---

## 7. 実務ワークフローまとめ（ch04 の手順案）

> 〔補足〕以下は本ノートで集めた一次資料の機能を組み合わせた手順案であり、原文にそのまま書かれた手順ではない。**許可された診断・バグバウンティのスコープ内、または自前ラボ**での実施を前提とする。

1. **棚卸し**: 対象 SPA を読み込み、ロードされた全 JS / CSS / WASM の URL を列挙する（DevTools Network、または Burp の Target マップ）。
2. **ヘッダ確認**: 全 JS/CSS レスポンスで `SourceMap:` と `X-SourceMap:` を grep。ヘッダはコメントより優先される。
3. **先頭バイトの目視 → コメント確認**: `.map` を落としたら必ず `head -c 16 <file>` で先頭を見る。**`)]}` で始まっていたら XSSI 対策済み**で、両ツールとも JSON パースに失敗するので `tail -n +2 foo.js.map > foo.fixed.map` で 1 行目を剥がす。各アセットで `//[@#]\s*sourceMappingURL=` を grep（`//@` とスペース有無の両方を許す正規表現）。`data:` 埋め込みならその場で base64 デコードする。
4. **推測・総当り（ただし 404 でも諦めない）**: コメントの無いアセットにも `.map` を付けて GET し、`Content-Type: application/json` かつ先頭 `{"version":3` で判定（ステータスだけで判断しない）。`.map` が 404 でも諦めない理由が 2 つある — (i) `inline-source-map` 系では `.map` が存在せずバンドルに `data:` で埋まる、(ii) `output.sourceMapFilename` で map 名を変更できる。`asset-manifest.json` / `stats.json` / チャンク名テーブルから実名を拾う。**CSS 側は独立に確認する**（webpack 5.105.0+ は JS/CSS で別 `devtool`）。
5. **まとめて取得 → ローカル一括復元**: 見つけた `.map` を全部ディレクトリに落とし、`sourcemapper -dir ./maps -output ./src`（隔離環境で実行）。認証が要れば `-header "Cookie: ..."`、送信は `-proxy` で Burp 経由にする。
6. **index map の手当て**: `jq -e '.sections' *.map` でヒットしたものは `jq '.sections[].map' > part_N.map` に分解してから再投入（ツールは `sections` 非対応）。
7. **`sourceRoot` の手当て**: `jq -r '.sourceRoot' *.map` が空でない map は、復元ツリーの起点を手で補正する。
8. **ノイズ除去とキー列挙**: `jq 'keys' foo.js.map` で必ずトップレベルキーを列挙し、`x_*` の中身を確認する。`ignoreList` / `x_google_ignoreList` があればそのインデックスを除外。無ければ `node_modules` / `~/` を含むパスを除外して**自社コードだけ**にする。`jq -r '.sources[]' | sed 's|/[^/]*$||' | sort -u` で `sources` の語彙も観察する。
9. **読む順序**: 認可・ルーティング・API クライアント → 設定/定数（ハードコード鍵・内部ホスト名） → feature flag / 未公開画面 → `TODO` / `FIXME` / `HACK` / `XXX` コメント → テストコードやモックに残った資格情報。**復元ソースだけでは足りない** — 最適化で消えた値は**バンドル本体（minified JS）も併せて grep** する。
10. **報告**: 「source map 漏洩」自体を情報漏洩として報告し、そこから導出した個別脆弱性（IDOR、認可欠落、鍵漏洩など）を別所見として、**復元ソースの該当行を引用して**書く。対策は防御節の 3 択（本番オフ / ACL / 本番に置かない）＋ CI チェックを提案する。**公式ガイダンス違反として書ける**根拠は §3.3（`source-map` は「アクセスを禁止せよ」、`hidden-source-map` は「デプロイするな」）。`mode: 'production'` の既定は `false` なので「`.map` があるのは事故ではなく設定」と指摘すると是正の優先度が上がる。

---

## 手を動かす

自前ラボ（unwebpack 同梱の `example-react-ts-app`）で通しの演習をする。

1. リポジトリを取得し、ラボアプリの本番設定を確認する。

```bash
git clone https://github.com/rarecoil/unwebpack-sourcemap.git
cd unwebpack-sourcemap
cat example-react-ts-app/configs/webpack/prod.js   # mode:'production' + devtool:'source-map' を確認
```

2. sourcemapper を用意し、git 履歴でセキュリティ修正を実物で読む。

```bash
git clone https://github.com/denandz/sourcemapper.git
cd sourcemapper
git log --reverse --date=short --pretty='%h %ad %an | %s'   # 全 40 コミットの年表
git show c0d4beb   # 2018年のトラバーサル修正（1行）
git show eee1d1a   # path.Join → filepath.Join + Windows サニタイズ
git show f739bd5   # remoteSource によるローカル読み出し拒否
```

3. XSSI プレフィックスの罠を体験する。`)]}` で始まる `.map` を用意して `head -c 16` で先頭を見て、`tail -n +2` で剥がしてから復元ツールに渡す。

```bash
head -c 16 foo.js.map            # )]} で始まっていないか確認
tail -n +2 foo.js.map > foo.fixed.map
```

4. 復元後、トップレベルキーと `sources` の語彙を観察する。

```bash
jq 'keys' foo.js.map                                   # x_* 拡張フィールドを確認
jq -r '.sources[]' foo.js.map | sed 's|/[^/]*$||' | sort -u | head -50
```

5. 信用できない `.map` は隔離環境で展開する。

```bash
docker run --rm -v "$PWD/out:/out" --network none <image> sourcemapper -dir /maps -output /out
```

---

## つまずきポイント

- **`.map` が 404 だから map は無い、と即断する。** `inline-source-map` 系は `.map` を作らずバンドルに `data:` で埋める。`output.sourceMapFilename` で名前も変えられる。コメント grep と manifest を先に見る。
- **ツールがパースに失敗した＝source map ではない、と誤読する。** 先頭が `)]}` の XSSI 対策済み map は両ツールとも必ず失敗する。`head -c 16` で先頭を見て `tail -n +2` で剥がす。
- **JS だけ見て CSS を忘れる。** webpack 5.105.0+ は JS/CSS で別 `devtool` を設定できる。`.css.map` は独立に確認する。
- **`hidden-source-map` を「隠しているから安全」と思う。** コメントが無いだけで `.map` は生成される。URL 推測で取れる。webpack 公式自身が「デプロイするな」と警告している。
- **復元した原本だけを読む。** 最適化で消えた変数・インライン化された定数は原本を読んでも実行時の値が分からない。バンドル本体も grep する。
- **信用できない `.map` を素の環境で展開する。** `sources` は攻撃者制御下。`../../` 書き込み・SSRF・ローカル読み出しのリスクがある。使い捨てコンテナ・非特権ユーザで、`-jsurl` は `-proxy` 経由で。
- **`nosources-source-map` を単体で高リスク所見にする。** 公式が「デプロイしてよい」と言う唯一の値。原本は出ない。ファイル名・構造の露出として報告する。

---

## この節のまとめ

- source map 復元は信頼関係が逆転しており、**復元ツールを走らせる診断者が被害者になりうる**（パス・トラバーサル書き込み・強制リクエスト/SSRF・ローカルファイル読み出し）。
- sourcemapper は先頭 `/` 付与 + `filepath.Clean` + Windows サニタイズでトラバーサルを防ぎ、ディレクトリ 0700 / ファイル 0600 で書き込む。unwebpack は文字ホワイトリスト + 出力ルート検証で守る。
- SSRF は README が明示警告しており、`-jsurl` では `-proxy`・隔離ネットワークが必須。`remoteSource` フラグはローカル読み出しを 1 個のフラグで拒否する。
- webpack の `mode: 'production'` の `devtool` 既定は `false` なので、**本番の `.map` は事故ではなく設定**。報告文でこの点を突ける。
- `devtool` は 28 値あるが `[inline-|hidden-|eval-][nosources-][cheap-[module-]]source-map[-debugids]` の 1 行で分解でき、漏洩に直結するのは `inline-`・`hidden-`・`nosources-` の 3 修飾子だけ。
- webpack 公式は `source-map` に「アクセスを禁止せよ」、`hidden-source-map` に「デプロイするな」、`nosources-source-map` に「デプロイしてよいがファイル名と構造は露出する」と逐語で書いている。これが報告の公式根拠になる。
- `quality: original` の値だけが「原本（TS/JSX のまま）が読める」。復元結果がトランスパイル後 JS なら `cheap-*`/`transformed` 系が推定できる。
- 両ツールのセキュリティ設計は git 履歴で 8 年分追える。sourcemapper は初版 4 日後にトラバーサル修正、2020 年に `path.Join`→`filepath.Join`（記事著者本人による貢献）、mode 000 バグ修正、2026 年にローカル読み出し防止。
- unwebpack の初版 README（2019-06-12、記事公開前日）が記事の論旨と実質同一で、一次資料として引用できる。同梱ラボは `mode:'production'` + `devtool:'source-map'` の事故の最小再現。
- `)]}` プレフィックス（XSSI 対策）で始まる `.map` は両ツールとも必ずパース失敗する。`head -c 16`→`tail -n +2` で剥がす。
- `x_` で始まる拡張フィールドがあるので `jq 'keys'` でトップレベルキーを必ず列挙する。`webpack://` 以外の擬似スキーム（Vite/Next.js/esbuild/Dart）もあるので `sources` の語彙を先に観察する。
- 復元ソースだけでは足りない。最適化で消えた値はバンドル本体（minified JS）も grep する。
- ヘッダ（`SourceMap:`）はコメントより優先し、値は相対 URL でもよい。`sourceMappingURL` は別ホストの絶対 URL でもよいので、対象ドメインだけ見ていると map を見落とす。

---

## 理解度チェック

1. 本番環境に `.map` があったとき、なぜ「事故ではなく設定」と言えるのか。
   ▶ 答え: webpack の `mode: 'production'` では `devtool` の既定値が `false` であり、何も書かなければ source map は出ない。`.map` があるのは、誰かが明示的に `devtool` を設定したか、dev 設定のまま本番ビルドしたかのどちらかだから。

2. `devtool: 'hidden-source-map'` で本番配信されている `.map` を見つけた。報告文でどんな公式根拠を引けるか。
   ▶ 答え: webpack 公式が `hidden-source-map` に「Source Map ファイルを web サーバにデプロイすべきではない。エラー報告ツールのためだけに使うこと」という警告を付けている。この公式警告どおりに運用していない（公式ガイダンス違反）と書ける。「hidden＝隠している」ではなく、コメントが無いだけで `.map` は URL 推測で取れる。

3. `.map` を GET したら 404 だった。map は存在しないと結論してよいか。
   ▶ 答え: よくない。(1) `inline-source-map` 系では `.map` ファイルがそもそも存在せずバンドルに `data:` URI で埋まる、(2) `output.sourceMapFilename` で `.map` の名前を `[file].map` 以外に変更できる。コメント grep・`asset-manifest.json`・`stats.json`・CSS 側の `.css.map` を別途確認する。

4. 復元ツールにかけたら「Failed to parse sourcemap」で落ちた。どう対処するか。
   ▶ 答え: XSSI 対策の `)]}` プレフィックスが 1 行目に付いている可能性が高い。両ツールとも先頭行を剥がさないので JSON パースが必ず失敗する。`head -c 16` で先頭を確認し、`tail -n +2` で 1 行目を剥がしてから再投入する。パース失敗＝source map ではない、と誤読しない。

5. sourcemapper で `sources` に `../../../../etc/passwd` を含む悪意ある `.map` を食わせても任意書き込みできないのはなぜか。
   ▶ 答え: `sourcePath = "/" + sourcePath` で先頭に `/` を足してから `filepath.Clean` するため。Go の `Clean` は相対パス先頭の `..` を除去できないが、`"/../../..."` にすれば根元で `..` が吸収されて出力ディレクトリ外に出られない。加えて `filepath.Join` の使用と Windows サニタイズで守っている。

6. `-jsurl` モードの SSRF リスクとは何か。どう緩和するか。
   ▶ 答え: 対象 JS の `sourceMappingURL` が指す任意 URL に GET が飛ぶため、診断者の端末が内部サービスへの SSRF 踏み台になりうる（README が明示警告）。緩和策は `-proxy` で Burp を通して送信先を可視化する、`-url` で手動指定した URL しか触らせない、隔離ネットワークで実行する。

7. 復元した TypeScript 原本にハードコードされた API キーがあるはずだが見当たらない。どこを見るか。
   ▶ 答え: 最適化で消えた変数やインライン化された定数は、復元した原本を読んでも実行時の値が分からない（web.dev「It's not perfect」）。値はバンドル本体（minified JS）に直接埋め込まれていることがあるので、復元ソースとバンドル本体の両方を grep する。

8. `nosources-source-map` の map を見つけた。単体で高リスクの情報漏洩として報告すべきか。
   ▶ 答え: 筋が悪い。`nosources-source-map` は webpack 公式が「web サーバにデプロイしてよい」と言う唯一の値で、`sourcesContent` を含まず原本は復元できない。ただし公式警告どおりファイル名と構造（`sources` / `names`）は露出するので、内部モジュール構成・命名規則の情報収集として報告するのが妥当。

9. 診断で使う sourcemapper のバージョンをどう記録すべきか。
   ▶ 答え: sourcemapper はタグ／リリースが 1 つも打たれておらず `go install ...@latest` は常に main HEAD を取る。バージョン番号で固定できないので、使ったコミットハッシュを記録する。

---

## 出典

- https://webpack.js.org/configuration/devtool/ （原稿: https://raw.githubusercontent.com/webpack/webpack.js.org/main/src/content/configuration/devtool.mdx ）
- https://github.com/webpack/webpack/tree/master/examples/source-map
- https://github.com/denandz/sourcemapper （README・`main.go`・全 40 コミット履歴。`git clone` で取得）
- https://github.com/rarecoil/unwebpack-sourcemap （README・`unwebpack_sourcemap.py`・`example-react-ts-app/`・全 30 コミット履歴。`git clone` で取得）
- https://developer.chrome.com/blog/sourcemaps/ （原稿: https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/sourcemaps/index.md ）
- https://web.dev/articles/source-maps （原稿: https://raw.githubusercontent.com/GoogleChrome/web.dev/main/src/site/content/en/blog/source-maps/index.md ）
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/SourceMap （原稿: `mdn/content` リポジトリ）
- https://firefox-source-docs.mozilla.org/devtools-user/debugger/how_to/use_a_source_map/index.html （原稿: `mozilla/gecko-dev` ミラー）
- https://parsiya.net/blog/2019-03-09-path.join-considered-harmful/ （原稿: `git clone https://github.com/parsiya/parsiya.net.git`）
- https://pkg.go.dev/path ・ https://pkg.go.dev/path/filepath
- https://tc39.es/source-map-spec/ （原稿: https://raw.githubusercontent.com/tc39/source-map/main/spec.emu ）
- https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d （取得できず。初版 README で代替）
- https://deepwiki.com/denandz/sourcemapper （取得できず。原典リポジトリで代替）
- https://pulsesecurity.co.nz/articles/javascript-from-sourcemaps （取得できず）

<!-- sources: https://webpack.js.org/configuration/devtool/, https://github.com/denandz/sourcemapper, https://github.com/rarecoil/unwebpack-sourcemap, https://developer.chrome.com/blog/sourcemaps/, https://web.dev/articles/source-maps, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/SourceMap, https://firefox-source-docs.mozilla.org/devtools-user/debugger/how_to/use_a_source_map/index.html, https://parsiya.net/blog/2019-03-09-path.join-considered-harmful/, https://tc39.es/source-map-spec/, https://github.com/webpack/webpack/tree/master/examples/source-map -->
<!-- terms: source map, sourcesContent, devtool, sourceMappingURL, hidden-source-map, nosources-source-map, inline-source-map, XSSI, )]} プレフィックス, SSRF, 強制リクエスト, パス・トラバーサル, path.Join, filepath.Join, remoteSource, x_google_ignoreList, sourceRoot, names, mappings, Base64 VLQ, index source map, SourceMap ヘッダ, sourcemapper, unwebpack-sourcemap, cheap-module-eval-source-map -->

<!-- self-read: https://medium.com/@rarecoil/spa-source-code-recovery-by-un-webpacking-source-maps-ef830fc2351d | medium.com がegress許可リスト外で CONNECT 403、ミラーも全滅 -->
<!-- self-read: https://deepwiki.com/denandz/sourcemapper | deepwiki.com がegress許可リスト外で CONNECT 403（原典リポジトリで代替済み） -->
<!-- self-read: https://pulsesecurity.co.nz/articles/javascript-from-sourcemaps | pulsesecurity.co.nz がegress許可リスト外で CONNECT 403、アーカイブも全滅 -->
<!-- self-read: https://tc39.es/source-map-spec/ | 整形済み規範文は公式ページが見やすい（本文は spec.emu から取得済み） -->
